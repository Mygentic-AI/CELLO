/**
 * PgNonceBinder — Postgres-backed NonceBinder over the LOCAL pre_auth_nonce_bindings table
 * (M8B-PREAUTH-CAP, migration V40). Not replicated (not in cello_pub) — see V40 for why.
 *
 * bind(nonce, epochId) is idempotent:
 *   INSERT ... ON CONFLICT (nonce) DO NOTHING RETURNING nonce
 *     • RETURNING a row               → first bind on this node → { bound: true }
 *     • no row, existing = epochId     → idempotent re-presentation (same agent) → { bound: true }
 *     • no row, existing ≠ epochId     → replay into a different agent → { bound: false, NONCE_ALREADY_BOUND }
 *
 * chain_hash = SHA-256(nonce || bound_epoch) — deterministic self-hash, matching the token/registration
 * tamper-evidence convention. The row is append-only (V40 RLS: no UPDATE/DELETE).
 */
import { createHash } from "node:crypto";
import type pg from "pg";
import type { NonceBinder, NonceBindResult } from "@cello-protocol/interfaces";

export class PgNonceBinder implements NonceBinder {
  readonly #pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.#pool = pool;
  }

  async bind(nonce: string, epochId: string): Promise<NonceBindResult> {
    const chainHash = createHash("sha256").update(nonce).update(epochId).digest("hex");
    const inserted = await this.#pool.query(
      `INSERT INTO pre_auth_nonce_bindings (nonce, bound_epoch, chain_hash)
       VALUES ($1, $2, $3)
       ON CONFLICT (nonce) DO NOTHING
       RETURNING nonce`,
      [nonce, epochId, chainHash],
    );
    if (inserted.rowCount === 1) return { bound: true }; // first bind on this node

    // Conflict — the nonce is already bound. Idempotent iff bound to the SAME epoch.
    const existing = await this.#pool.query<{ bound_epoch: string }>(
      `SELECT bound_epoch FROM pre_auth_nonce_bindings WHERE nonce = $1`,
      [nonce],
    );
    if (existing.rows[0]?.bound_epoch === epochId) return { bound: true };
    return { bound: false, reason: "NONCE_ALREADY_BOUND" };
  }
}
