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
 * Account-scoping: returns true iff `agentId` belongs to `accountId` (agent_profiles.account_id).
 * Scoping is derived from this ownership check — NOT from a request field — so a caller asserting
 * account A cannot write to account B's agent (the row simply does not exist, → false → reject).
 */
export async function isAgentOwnedByAccount(
  pool: Queryable,
  agentId: string,
  accountId: string,
): Promise<boolean> {
  const result = await pool.query(
    "SELECT agent_id FROM agent_profiles WHERE agent_id = $1 AND account_id = $2",
    [agentId, accountId],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * LEVER-001 reversible PAUSE flag. Mutable upsert (mirrors agent_presence): pause sets paused=true,
 * clear sets paused=false. `authorized_by_account` records which account authorized it (ownership
 * already proven by the caller). Burn is permanent and does NOT come through here.
 */
export async function upsertSuspension(
  pool: Queryable,
  args: { agentId: string; paused: boolean; accountId: string; reason: string | null },
): Promise<void> {
  await pool.query(
    `INSERT INTO agent_suspensions (agent_id, paused, reason, authorized_by_account, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (agent_id) DO UPDATE
       SET paused = EXCLUDED.paused,
           reason = EXCLUDED.reason,
           authorized_by_account = EXCLUDED.authorized_by_account,
           updated_at = now()`,
    [args.agentId, args.paused, args.reason, args.accountId],
  );
}

/** TRUST-001 trust-signal HASH — one current hash per (agent, signal kind). Hash only, never plaintext. */
export async function upsertIdentityHash(
  pool: Queryable,
  args: { agentId: string; signalKind: string; signalHash: string },
): Promise<void> {
  await pool.query(
    `INSERT INTO identity_tree_entries (agent_id, signal_kind, signal_hash, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (agent_id, signal_kind) DO UPDATE
       SET signal_hash = EXCLUDED.signal_hash, updated_at = now()`,
    [args.agentId, args.signalKind, args.signalHash],
  );
}

/** TRUST-001 sealed ciphertext — appended to the pickup queue; the agent's daemon pulls + ACKs it.
 *  signal_kind lets the drain JOIN the authoritative identity-tree hash for verification (AC-001). */
export async function enqueuePickup(
  pool: Queryable,
  args: { agentId: string; signalKind: string; ciphertext: Buffer },
): Promise<void> {
  await pool.query(
    `INSERT INTO pickup_queue (agent_id, signal_kind, ciphertext) VALUES ($1, $2, $3)`,
    [args.agentId, args.signalKind, args.ciphertext],
  );
}
