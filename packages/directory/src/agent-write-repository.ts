/**
 * WRITEAPI-001 — persistence for the directory write seam.
 *
 * The seam (POST /internal/agent-write) routes one of three permitted, safe-to-replicate write
 * kinds to its target table after proving the target agent is owned by the calling account. Only
 * hashes, flags, and sealed ciphertext ever land here — never plaintext, PII, or tokens
 * (DOD-INV-2, WRITEAPI-001 SI-001). Payload-shape validation lives in `validateWritePayload`; this
 * module is the thin DB layer (ownership probe + one writer per kind).
 */

import type pg from "pg";

/** A narrowed pool — only `query` is used, so the contract tests can stub it. */
type Queryable = Pick<pg.Pool, "query">;

/**
 * Account-scoping: returns true iff `agentId` belongs to `accountId`.
 *
 * Scoping is derived from this ownership check — NOT from a request field — so a caller asserting
 * account A cannot write to account B's agent (the row simply does not exist, → false → reject).
 *
 * READS `agent_account_links` (V59), NOT `agent_profiles.account_id`. That column is mutable, Tier A
 * replicates only immutable columns by construction, and the Tier B rule the M12 design assigned it
 * was never built — so the binding has never crossed between nodes. Live on 2026-08-07 one
 * operator's three agents were linked on three different nodes (0, 2 and 1), so this check answered
 * `not_owner` on the nodes without the row and the KILL SWITCH refused two of that operator's own
 * agents. The refusal is deliberate, so the client does not fail over — correctly, which is what
 * made it terminal rather than merely slow.
 *
 * No fallback to the old column, on purpose. Falling back would put the un-replicated answer back
 * into the authorization path — the entire defect — and would do it invisibly, since on the node
 * that happens to hold the row both sources agree.
 */
export async function isAgentOwnedByAccount(
  pool: Queryable,
  agentId: string,
  accountId: string,
): Promise<boolean> {
  const result = await pool.query(
    "SELECT agent_id FROM agent_account_links WHERE agent_id = $1 AND account_id = $2",
    [agentId, accountId],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * LEVER-001 revocation flag. pause/clear are reversible; BURN is permanent. `authorized_by_account`
 * records which account authorized it (ownership already proven by the caller).
 *
 *   pause → paused=true (does not touch a prior burn).
 *   burn  → paused=true, burned=true. PERMANENT — burned is monotonic (never un-set).
 *   clear → paused=false, but ONLY if NOT burned. A clear on a BURNED agent is rejected
 *           ("burned_immutable") — capability dies, it cannot be restored by clearing a flag.
 *
 * Returns "applied" on success, or "burned_immutable" when a clear targets a burned agent (the seam
 * surfaces this as a distinct rejection rather than a silent no-op).
 */
export async function applyRevocationFlag(
  pool: Queryable,
  args: { agentId: string; mode: "pause" | "clear" | "burn"; accountId: string; originNode: string },
): Promise<"applied" | "burned_immutable"> {
  // M12 DOD-AE-MUTABLE-1: every ACCEPTED write advances suspension_seq (per-agent monotonic — the
  // row's PK is agent_id, so max(local)+1 is just current+1) and stamps the accepting node's id, so
  // the anti-entropy §4 merge can order concurrent writes across nodes. A no-op write (a clear that
  // matches no un-burned row) must NOT advance the seq — it changed nothing to order.
  if (args.mode === "clear") {
    // Only an un-burned row may be cleared. The WHERE burned=false guard makes a burn terminal.
    const res = await pool.query(
      `UPDATE agent_suspensions
          SET paused = false,
              suspension_seq = suspension_seq + 1,
              origin_node = $2,
              updated_at = now()
        WHERE agent_id = $1 AND burned = false`,
      [args.agentId, args.originNode],
    );
    if ((res.rowCount ?? 0) === 0) {
      const existing = await pool.query<{ burned: boolean }>(
        `SELECT burned FROM agent_suspensions WHERE agent_id = $1`,
        [args.agentId],
      );
      if (existing.rows[0]?.burned) return "burned_immutable";
      // No row at all → clearing a never-suspended agent is a benign no-op.
    }
    return "applied";
  }

  const burn = args.mode === "burn";
  // pause or burn: paused=true. burned is monotonic — once set it never clears (OR with the prior).
  // seq starts at 1 on insert and advances by 1 on every conflict-update.
  await pool.query(
    `INSERT INTO agent_suspensions (agent_id, paused, burned, authorized_by_account, suspension_seq, origin_node, updated_at)
     VALUES ($1, true, $2, $3, 1, $4, now())
     ON CONFLICT (agent_id) DO UPDATE
       SET paused = true,
           burned = agent_suspensions.burned OR EXCLUDED.burned,
           authorized_by_account = EXCLUDED.authorized_by_account,
           suspension_seq = agent_suspensions.suspension_seq + 1,
           origin_node = EXCLUDED.origin_node,
           updated_at = now()`,
    [args.agentId, burn, args.accountId, args.originNode],
  );
  return "applied";
}


/** TRUST-001 sealed ciphertext — the agent's daemon pulls + ACKs it. signal_kind lets the drain JOIN
 *  the authoritative identity-tree hash for verification (AC-001).
 *
 *  SUPERSEDE semantics (one-anchor-per-(agent,kind) model):
 *  a new ciphertext for an (agent, signal_kind) REPLACES any prior UNDELIVERED one for that same kind.
 *  Without this, a re-enrolled signal leaves the prior sealed value in the queue; once the anchor moves
 *  to the new hash, that stale ciphertext hashes to the SUPERSEDED anchor on every drain → a permanent
 *  hash_mismatch the daemon can never verify or ACK (a poison-pill row). Deleting the prior undelivered
 *  row for the kind keeps exactly the current value pending — consistent with the single anchor. The
 *  delete is scoped to acked_at IS NULL (delivered rows are already removed by ACK) AND to the same kind
 *  (a different kind's pending pickup is untouched). The supersede is an atomic ON CONFLICT upsert against
 *  the partial UNIQUE index `idx_pickup_queue_one_pending_per_kind` (V37, on (agent_id, signal_kind) WHERE
 *  acked_at IS NULL): the new ciphertext REPLACES the prior pending one in a single statement. The unique
 *  index makes "one pending per kind" a DB-ENFORCED invariant — not best-effort — so even two concurrent
 *  same-(agent,kind) enqueues converge to one row (one wins the INSERT, the other takes the DO UPDATE)
 *  rather than both surviving and re-arming the hash_mismatch poison pill (a READ COMMITTED race an
 *  app-level DELETE-then-INSERT could not close). A concurrent drain sees the old or the new row, never
 *  zero. (signal_kind is always set by the write seam; the NULL-kind partial-index edge cannot arise.) */
export async function enqueuePickup(
  pool: Queryable,
  args: { agentId: string; signalKind: string; ciphertext: Buffer; owningNodeId: string; signalHash?: string },
): Promise<void> {
  // M10-D22: an M10 wallet-signal delivery carries its OWN signal_hash on the row (its anchor is
  // signal_records). One pending per (agent, kind); a re-mint replaces the prior pending row,
  // INCLUDING its signal_hash, so a superseding delivery cannot leave the old hash behind).
  // M10B / M10B-D23 (V52): the conflict target is (agent_id, signal_kind, SIGNAL_HASH). It MUST match
  // the partial unique index or the upsert raises "no unique or exclusion constraint matching the ON
  // CONFLICT specification" — the index and this clause are one change, never two.
  //
  // WHY THE HASH IS IN THE KEY. Under the old (agent_id, signal_kind) key this DO UPDATE silently
  // DESTROYED the second endorsement of a subject: two people endorse Alice while she is offline, both
  // deliveries are (alice, 'endorsement'), and the second overwrote the first with no error and a
  // success return. Endorsements are inherently many-per-kind; M10's signals were not, which is why the
  // old key was correct then and data loss now. Keying on content means many distinct signals coexist
  // while a genuine re-enqueue of the IDENTICAL envelope still collapses to one row — so V37's
  // READ COMMITTED duplicate-row race stays closed.
  await pool.query(
    `INSERT INTO pickup_queue (agent_id, signal_kind, ciphertext, owning_node_id, signal_hash) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (agent_id, signal_kind, signal_hash) WHERE acked_at IS NULL
     DO UPDATE SET ciphertext = EXCLUDED.ciphertext, created_at = now()`,
    [args.agentId, args.signalKind, args.ciphertext, args.owningNodeId, args.signalHash ?? null],
  );
}
