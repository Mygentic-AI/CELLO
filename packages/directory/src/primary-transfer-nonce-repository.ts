/**
 * Primary Transfer Nonce Repository — M8C-PRIMARY-1
 *
 * Local (not replicated) anti-replay for primary_transfer_request nonces, over the
 * primary_transfer_nonce_bindings table (V45). Mirrors PgNonceBinder's exact idempotent-INSERT
 * logic (pg-nonce-binder.ts, M8B-PREAUTH-CAP) but as a standalone function matching this file's
 * repository convention (primary-holder-repository.ts), and against a SEPARATE table — see V45's
 * migration comment for why reusing pre_auth_nonce_bindings would conflate two protocols' nonces.
 */
import { createHash } from "node:crypto";
import type pg from "pg";

type PgExecutor = Pick<pg.Pool, "query">;

export type PrimaryTransferNonceBindResult =
  | { bound: true }
  | { bound: false; reason: "NONCE_ALREADY_BOUND" };

/**
 * bind(nonce, new_daemon_id) is idempotent: a first bind on this node succeeds; a re-presentation
 * by the SAME new_daemon_id (e.g. a retried request after a dropped ack) also succeeds; a replay
 * attempting to bind the SAME nonce to a DIFFERENT daemon_id is rejected.
 */
export async function bindPrimaryTransferNonce(
  db: PgExecutor,
  nonce: string,
  newDaemonId: string,
): Promise<PrimaryTransferNonceBindResult> {
  const chainHash = createHash("sha256").update(nonce).update(newDaemonId).digest("hex");
  const inserted = await db.query(
    `INSERT INTO primary_transfer_nonce_bindings (nonce, bound_daemon_id, chain_hash)
     VALUES ($1, $2, $3)
     ON CONFLICT (nonce) DO NOTHING
     RETURNING nonce`,
    [nonce, newDaemonId, chainHash],
  );
  if ((inserted.rowCount ?? 0) === 1) return { bound: true };

  const existing = await db.query<{ bound_daemon_id: string }>(
    `SELECT bound_daemon_id FROM primary_transfer_nonce_bindings WHERE nonce = $1`,
    [nonce],
  );
  if (existing.rows[0]?.bound_daemon_id === newDaemonId) return { bound: true };
  return { bound: false, reason: "NONCE_ALREADY_BOUND" };
}
