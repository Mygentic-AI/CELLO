/**
 * Agent Presence Repository — CELLO-M8-PRESENCE-001
 *
 * Persistence for the mutable agent_presence table (V33) + the per-node liveness heartbeat, and
 * the account-scoped agents-with-presence read (the READ-001 read rule).
 *
 * Keyed by k_local_pubkey — the agent's stable Ed25519 identity (the value the #streams auth hook
 * holds directly; UNIQUE NOT NULL on agent_profiles), so the hot connect/disconnect path needs no
 * lookup and the read joins agent_profiles cleanly for account scoping.
 *
 * Sovereign write-ownership ([[project_sovereign_nodes]]): a node writes presence ONLY for agents
 * connected to IT, recording its own node_id as owning_node_id. The offline/reconcile writes are
 * additionally scoped `WHERE owning_node_id = $node` in SQL, so a node can never flip another
 * node's row. Writes are EDGE-TRIGGERED (connect/disconnect transitions only) — never per heartbeat
 * tick; only refreshNodeHeartbeat runs on the periodic timer.
 */
import type pg from "pg";

/** A pool or a pooled client — both expose `.query`, so tests can run the repo in a txn. */
type PgExecutor = Pick<pg.Pool, "query">;

/** Mark an agent online and claim ownership for this node (one write, on the connect transition). */
export async function upsertPresenceOnline(
  db: PgExecutor,
  kLocalPubkey: string,
  owningNodeId: string,
): Promise<void> {
  await db.query(
    `INSERT INTO agent_presence (k_local_pubkey, owning_node_id, online, last_seen_at, updated_at)
     VALUES ($1, $2, true, now(), now())
     ON CONFLICT (k_local_pubkey) DO UPDATE
       SET owning_node_id = EXCLUDED.owning_node_id,
           online = true,
           last_seen_at = now(),
           updated_at = now()`,
    [kLocalPubkey, owningNodeId],
  );
}

/**
 * Mark an agent offline (one write, on the disconnect transition). Scoped to the owning node — a
 * different node's UPDATE no-ops (sovereign write-ownership). Returns true iff this node owned the
 * row and updated it.
 */
export async function upsertPresenceOffline(
  db: PgExecutor,
  kLocalPubkey: string,
  owningNodeId: string,
): Promise<boolean> {
  const res = await db.query(
    `UPDATE agent_presence
        SET online = false, last_seen_at = now(), updated_at = now()
      WHERE k_local_pubkey = $1 AND owning_node_id = $2`,
    [kLocalPubkey, owningNodeId],
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * Startup reconciliation: at boot (empty #streams) mark all of THIS node's still-online rows
 * offline, so a crash that skipped the edge-triggered offline write doesn't leave agents falsely
 * online. Returns the number reconciled.
 */
export async function reconcileNodeOffline(
  db: PgExecutor,
  owningNodeId: string,
): Promise<number> {
  const res = await db.query(
    `UPDATE agent_presence
        SET online = false, updated_at = now()
      WHERE owning_node_id = $1 AND online = true`,
    [owningNodeId],
  );
  return res.rowCount ?? 0;
}

/** Per-node liveness heartbeat — the only write on the periodic timer (~30-60s). */
export async function refreshNodeHeartbeat(db: PgExecutor, nodeId: string): Promise<void> {
  await db.query(`UPDATE directory_nodes SET last_heartbeat_at = now() WHERE node_id = $1`, [
    nodeId,
  ]);
}

export interface AgentWithPresence {
  kLocalPubkey: string;
  /** The directory-assigned stable agent_id — the key the write seam (WRITEAPI-001/LEVER-001) uses.
   *  Nullable: an agent that has not yet been assigned one is not suspendable via the seam. */
  agentId: string | null;
  online: boolean;
  lastSeenAt: Date | null;
  /** True iff a reversible suspend (pause) flag is currently set (LEVER-001) — drives the lever's
   *  Pause/Resume state and the row's suspended indicator. */
  paused: boolean;
}

/**
 * READ-001 read rule: the account's agents with HONEST presence — online iff the presence row is
 * online AND the owning node's last_heartbeat_at is fresh. A dark node (stale/NULL heartbeat) ages
 * its agents out to last-seen even though the row still says online. Read from replicated state;
 * works from any node.
 */
export async function listAccountAgentsWithPresence(
  db: PgExecutor,
  accountId: string,
  nodeFreshnessMs: number,
): Promise<AgentWithPresence[]> {
  const res = await db.query<{
    k_local_pubkey: string;
    agent_id: string | null;
    online: boolean;
    last_seen_at: Date | null;
    paused: boolean;
  }>(
    `SELECT ag.k_local_pubkey,
            ag.agent_id,
            COALESCE(
              ap.online AND dn.last_heartbeat_at > now() - ($2::bigint * interval '1 millisecond'),
              false
            ) AS online,
            ap.last_seen_at,
            COALESCE(sus.paused, false) AS paused
       FROM agent_profiles ag
       LEFT JOIN agent_presence ap ON ap.k_local_pubkey = ag.k_local_pubkey
       LEFT JOIN directory_nodes dn ON dn.node_id = ap.owning_node_id
       LEFT JOIN agent_suspensions sus ON sus.agent_id = ag.agent_id
      WHERE ag.account_id = $1
      ORDER BY ag.k_local_pubkey`,
    [accountId, nodeFreshnessMs],
  );
  return res.rows.map((r) => ({
    kLocalPubkey: r.k_local_pubkey,
    agentId: r.agent_id,
    online: r.online,
    lastSeenAt: r.last_seen_at,
    paused: r.paused,
  }));
}
