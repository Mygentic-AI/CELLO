/**
 * Primary Holder Repository — M8C-PRIMARY-1
 *
 * Persistence for the mutable primary_holder table (V44) — per-node record of which daemon
 * currently holds Primary status for an agent. Per
 * docs/planning/user-stories/m8c/M8C-PRIMARY-DESIGN.md (Decision 4, revised across 3 passes):
 * this is NOT a cross-node consensus table. CELLO has no cross-node RPC anywhere (confirmed by
 * reading the DKG coordination code directly). Each directory node writes ONLY what a daemon
 * directly attests to IT, mirroring agent_presence's (V33) sovereign-write-ownership shape.
 * "Exactly one Primary" is enforced by FROST's own T-of-N threshold math (an old daemon_id that
 * has been superseded at T nodes cannot gather T signers for a real ceremony), not by any single
 * row in this table — this repository is what each node consults LOCALLY when deciding whether to
 * let a given daemon_id participate in an agent's ceremony.
 *
 * Keyed by k_local_pubkey — the agent's stable Ed25519 identity, same key agent_presence uses.
 */
import type pg from "pg";

/** A pool or a pooled client — both expose `.query`, so tests can run the repo in a txn. */
type PgExecutor = Pick<pg.Pool, "query">;

export interface PrimaryHolderRow {
  kLocalPubkey: string;
  holdingDaemonId: string;
  lastAttestedAt: Date;
}

/**
 * Point-read THIS node's own recorded holder for an agent. Returns null if no row exists (e.g.
 * this node was never dialed during the agent's original DKG, or the agent has never had a
 * Primary explicitly attested here yet — the DKG-completing daemon should be the first writer,
 * see upsertPrimaryHolder's call site in the registration flow).
 */
export async function getPrimaryHolder(
  db: PgExecutor,
  kLocalPubkey: string,
): Promise<PrimaryHolderRow | null> {
  const res = await db.query<{ k_local_pubkey: string; holding_daemon_id: string; last_attested_at: string | Date }>(
    `SELECT k_local_pubkey, holding_daemon_id, last_attested_at
       FROM primary_holder
      WHERE k_local_pubkey = $1`,
    [kLocalPubkey],
  );
  if (res.rows.length === 0) return null;
  const r = res.rows[0];
  return {
    kLocalPubkey: r.k_local_pubkey,
    holdingDaemonId: r.holding_daemon_id,
    // Normalize to a real Date — the directory installs a global TIMESTAMPTZ string parser
    // (pg-type-config.ts), matching agent-presence-repository.ts's own normalization.
    lastAttestedAt: r.last_attested_at instanceof Date ? r.last_attested_at : new Date(r.last_attested_at),
  };
}

/**
 * Record THIS node's acceptance of a primary-transfer (or the very first attestation after DKG
 * completes — see the registration flow). Unconditional upsert: the caller (the transfer request
 * handler) is responsible for verifying old_daemon_id matches the CURRENT row and the release
 * signature before calling this — this function only persists the already-verified outcome.
 */
export async function upsertPrimaryHolder(
  db: PgExecutor,
  kLocalPubkey: string,
  holdingDaemonId: string,
): Promise<void> {
  await db.query(
    `INSERT INTO primary_holder (k_local_pubkey, holding_daemon_id, last_attested_at, updated_at)
     VALUES ($1, $2, now(), now())
     ON CONFLICT (k_local_pubkey) DO UPDATE
       SET holding_daemon_id = EXCLUDED.holding_daemon_id,
           last_attested_at = now(),
           updated_at = now()`,
    [kLocalPubkey, holdingDaemonId],
  );
}

/**
 * Heartbeat refresh only (no daemon_id change) — a live Primary periodically re-attests its own
 * holder status so a crashed/stale Primary's row can be distinguished from a live one, mirroring
 * agent_presence's heartbeat-freshness pattern. Scoped to the CURRENT holder — a stale/wrong
 * daemon_id's heartbeat no-ops rather than silently refreshing a row it doesn't own. Returns true
 * iff this daemon_id was in fact the recorded holder and the heartbeat was refreshed.
 */
export async function refreshPrimaryHolderHeartbeat(
  db: PgExecutor,
  kLocalPubkey: string,
  holdingDaemonId: string,
): Promise<boolean> {
  const res = await db.query(
    `UPDATE primary_holder
        SET last_attested_at = now(), updated_at = now()
      WHERE k_local_pubkey = $1 AND holding_daemon_id = $2`,
    [kLocalPubkey, holdingDaemonId],
  );
  return (res.rowCount ?? 0) > 0;
}
