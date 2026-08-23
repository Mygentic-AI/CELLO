/**
 * DOD-M15-CHAINROUNDTRIP-1 — every hash chain verifies AFTER the whole suite, not partway through.
 *
 * ─── Why this cannot be an ordinary test ───────────────────────────────────────────────────────
 *
 * The enforcer in `dod-m15-chainroundtrip-1.test.ts` checks the same tables, and it is worth
 * keeping — but it can only see damage done by files that happened to run BEFORE it. A test that
 * tampers a chained row and forgets to restore it is invisible to the enforcer if its file sorts
 * later, and vitest gives no ordering guarantee to rely on.
 *
 * That is not a hypothetical failure mode. It is the one that happened, twice, to one table:
 *
 *   - `persist-018` SI-003 zeroed a `frost_signature` to prove the verifier catches a tamper, and
 *     left it zeroed. `verifyChain` stops at the FIRST break, so that single row made
 *     `seal_notarizations` unverifiable for everything downstream — and it looks exactly like a
 *     production integrity defect, because a red chain cannot say whether the DATA is wrong or the
 *     CHECK is wrong. It cost three wrong diagnoses.
 *   - `m7-upgrade-001` did the identical thing in a different file. It was only caught because a
 *     full-suite run happened to order it after the enforcer.
 *
 * A global teardown runs once, after every file, in every ordering. It is the only place this
 * question can be asked and get a stable answer.
 *
 * ─── What a failure here means ─────────────────────────────────────────────────────────────────
 *
 * Almost certainly a test that tampered a chained row and did not put it back. Restore in a
 * `finally` and assert the restore worked — `persist-004`, `persist-020`, `dod-accounts-chain-1`,
 * `persist-018` and `m7-upgrade-001` all show the shape. Deleting the offending row is NOT a fix:
 * every row after it chains to its stored hash, so a delete breaks the chain permanently too.
 *
 * The other possibility is the defect this DoD line was opened for: a column whose stored type
 * round-trips to a different JavaScript value than the one that was hashed. That is a production
 * bug, and it belongs at the writer that knows the column type — never in `serializeRecord`, which
 * sees values and cannot know a schema.
 */

import pg from "pg";
import { HASH_CHAINED_TABLES } from "../../hash-chain.js";
import { PgDirectoryStore } from "../../adapters/pg-directory-store.js";
import type { Logger } from "@cello-protocol/interfaces";

const SILENT: Logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

/**
 * ─── THE WIRING, AND TWO WAYS IT SILENTLY DOES NOTHING ─────────────────────────────────────────
 *
 * Registered as vitest's `globalSetup`, and the work is the `teardown` EXPORT. Both halves of that
 * are load-bearing, and I got both wrong first:
 *
 *  1. There is no `globalTeardown` config key. Vitest ignores an unrecognised key without a word,
 *     so the suite ran green over a chain I had deliberately poisoned.
 *  2. There must be NO DEFAULT EXPORT. Vitest treats a setup module's default export as `setup`,
 *     so the check ran BEFORE the suite instead of after — reporting the previous run's state and
 *     aborting the run it was supposed to be guarding.
 *
 * Both mistakes produce something that looks configured and checks nothing, which is exactly the
 * class of defect this file exists to catch. Verified by poisoning a row on purpose and confirming
 * a non-zero exit.
 */
export function setup(): void {
  /* nothing to prepare — the chains are checked AFTER the suite, in `teardown` */
}

export async function teardown(): Promise<void> {
  // The integration suite only runs against a real database; with no database there is nothing to
  // check and nothing to claim. Staying silent here is deliberate — see the note below on why this
  // does not quietly pass.
  if (process.env["CELLO_ENV"] !== "local") return;

  const connectionString =
    process.env["DATABASE_URL"] ?? "postgresql://postgres:dev@localhost:5433/cello_dev";
  const pool = new pg.Pool({ connectionString });

  try {
    const store = new PgDirectoryStore(pool, SILENT);
    const broken: string[] = [];
    for (const table of HASH_CHAINED_TABLES) {
      const result = await store.verifyChain(table);
      if (!result.valid) broken.push(`  ${table} — break at row ${String(result.breakAtSequence)}`);
    }

    if (broken.length > 0) {
      // Thrown, not logged. A teardown that printed a warning would leave the suite green, and a
      // green suite with a broken chain is the precise condition that let this survive for months.
      throw new Error(
        `The suite finished with ${String(broken.length)} hash chain(s) that do not verify:\n` +
          `${broken.join("\n")}\n\n` +
          `Most likely a test tampered a chained row to prove the verifier catches a tamper, and ` +
          `did not put it back. Restore it in a \`finally\` and assert the restore worked. Do NOT ` +
          `delete the row — later rows chain to its stored hash, so a delete breaks the chain too.\n\n` +
          `If no test tampered it, this is the DOD-M15-CHAINROUNDTRIP-1 defect itself: a column ` +
          `whose stored type round-trips to a different value than the one that was hashed. Fix it ` +
          `at the writer that knows the column type, never in serializeRecord.`,
      );
    }
  } finally {
    await pool.end();
  }
}
