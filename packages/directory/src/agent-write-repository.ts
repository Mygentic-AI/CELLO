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
  args: { agentId: string; mode: "pause" | "clear" | "burn"; accountId: string },
): Promise<"applied" | "burned_immutable"> {
  if (args.mode === "clear") {
    // Only an un-burned row may be cleared. The WHERE burned=false guard makes a burn terminal.
    const res = await pool.query(
      `UPDATE agent_suspensions SET paused = false, updated_at = now()
        WHERE agent_id = $1 AND burned = false`,
      [args.agentId],
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
  await pool.query(
    `INSERT INTO agent_suspensions (agent_id, paused, burned, authorized_by_account, updated_at)
     VALUES ($1, true, $2, $3, now())
     ON CONFLICT (agent_id) DO UPDATE
       SET paused = true,
           burned = agent_suspensions.burned OR EXCLUDED.burned,
           authorized_by_account = EXCLUDED.authorized_by_account,
           updated_at = now()`,
    [args.agentId, burn, args.accountId],
  );
  return "applied";
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
