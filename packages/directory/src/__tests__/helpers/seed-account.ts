/**
 * seedAccount — put a `user_accounts` row in a fixture WITHOUT breaking the hash chain.
 *
 * ─── Why this exists ───────────────────────────────────────────────────────────────────────────
 *
 * `user_accounts` is hash-chained and append-only. `verifyChain` walks the table in order and
 * chains each row to **the previous row's stored hash**, seeded from `CHAIN_GENESIS`. Two fixture
 * habits break that, and both were widespread:
 *
 *   1. **A raw INSERT with a literal `chain_hash`** — `'seed'`, `'read-001-seed-chain'`. That row is
 *      a hole: it cannot verify against its predecessor, so `verifyChain` fails there and at every
 *      row after it.
 *   2. **Deleting the row afterwards** — the successor was chained to a predecessor that no longer
 *      exists, so the chain breaks from the deletion point onward.
 *
 * Either one poisons the table for the **whole run**, in every other file, which is how
 * `chain broke at sequence 2` kept surfacing in suites that never touch accounts
 * (`DOD-M15-DIRECTORY-ROT-1`, Entry 20).
 *
 * ─── How to use it ─────────────────────────────────────────────────────────────────────────────
 *
 * Call this instead of an INSERT, pass **per-run unique** ids and stubs, and do **not** clean up.
 * Uniqueness is what removes the need for a delete; `randomUUID()` and a run-salted stub cost
 * nothing. A leftover row is harmless — the table is append-only by design, and every row this
 * writes is a genuine link in the chain.
 *
 * The one legitimate raw DELETE against this table is the test that asserts the service role is
 * REFUSED one (ACCOUNT-001 AC-006). That deletes nothing, because it fails.
 */

import type pg from "pg";
import { PgDirectoryStore } from "../../adapters/pg-directory-store.js";

const SILENT = { debug() {}, info() {}, warn() {}, error() {} };

export async function seedAccount(
  pool: pg.Pool,
  params: { accountId: string; phoneStubHash: string; emailStubHash?: string; correlationId?: string },
): Promise<void> {
  // `createAccount` computes the hash against the CURRENT chain head, which is the whole point —
  // the value cannot be supplied by a caller and stay correct.
  await new PgDirectoryStore(pool, SILENT as never).createAccount({
    accountId: params.accountId,
    phoneStubHash: params.phoneStubHash,
    ...(params.emailStubHash !== undefined ? { emailStubHash: params.emailStubHash } : {}),
    correlationId: params.correlationId ?? `seed-${params.accountId}`,
  });
}
