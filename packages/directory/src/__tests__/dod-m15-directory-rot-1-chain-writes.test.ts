/**
 * DOD-M15-DIRECTORY-ROT-1 — no fixture may put a hole in a hash-chained table.
 *
 * ─── The property, and why it needs a test rather than a comment ────────────────────────────────
 *
 * `verifyChain` walks a chained table in order and chains each row to **the previous row's stored
 * hash**, seeded from `CHAIN_GENESIS`. Two fixture habits break that for the WHOLE RUN, in every
 * other file:
 *
 *   1. a raw `INSERT` supplying a literal `chain_hash` — the row cannot verify against its
 *      predecessor, so verification fails there and at every row after it;
 *   2. a `DELETE` — the successor was chained to a predecessor that no longer exists.
 *
 * The symptom was `chain broke at sequence 2` appearing in suites that never touch accounts, with
 * the same hash pair every run.
 *
 * `account-001` AC-005 asserts `verifyChain('user_accounts')` over the **entire table**, and until
 * now the only thing holding that up was a comment claiming *"no row can exist that was inserted
 * outside the chain mechanism."* It was not true when it was written — this guard, run once, found
 * nineteen counter-examples. A comment is not an enforcement mechanism, so the constraint is a test
 * that iterates the directory rather than trusting a hand-kept list.
 *
 * Unconditional by design: it reads source, needs no database, and therefore runs in exactly the
 * environment where the suites it protects do not.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { HASH_CHAINED_TABLES } from "../hash-chain.js";

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const SELF = basename(fileURLToPath(import.meta.url));

function testSources(): Array<{ name: string; text: string }> {
  const out: Array<{ name: string; text: string }> = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (entry.endsWith(".test.ts") && entry !== SELF) out.push({ name: entry, text: readFileSync(full, "utf8") });
    }
  };
  walk(TESTS_DIR);
  return out;
}

function violates(text: string, kind: "insert" | "delete"): boolean {
  return HASH_CHAINED_TABLES.some((table) => {
    const re = kind === "insert"
      ? new RegExp(`INSERT\\s+INTO\\s+${table}\\s*\\([^)]*chain_hash`, "i")
      : new RegExp(`DELETE\\s+FROM\\s+${table}\\b`, "i");
    return re.test(text);
  });
}

/**
 * ─── Three lists, and the differences between them are the whole design ────────────────────────
 *
 * ROLLED_BACK — chained writes that happen inside `BEGIN`/`ROLLBACK` on the same client. They never
 * commit, so a literal `chain_hash` in them is inert. This is the pattern to prefer.
 *
 * ALLOWED_DELETES — a delete that IS the subject of its test rather than cleanup.
 *
 * KNOWN_DEBT_* — files that genuinely commit a literal `chain_hash`, or delete from a chained table,
 * and are not converted yet. A BACKLOG, not an exemption: it exists so NEW violations fail
 * immediately instead of the guard being switched off until someone has time for nineteen files.
 * The last test is what keeps it a backlog — the lists may shrink, never grow, and a name that no
 * longer violates must be removed.
 */
const ROLLED_BACK: Record<string, string> = {
  "dod-dirdata-read-1.test.ts":
    "the whole suite runs on one client inside BEGIN/ROLLBACK — the server under test is handed " +
    "txnPool(client), so its reads land on the same connection as the fixture's writes. Its two " +
    "literal chain_hash inserts therefore never commit, and the DELETE cleanup they needed is gone " +
    "with them: rollback is the cleanup, and there is nothing left to forget.",
  "cross-node-discovery-pg.live.test.ts":
    "its first two describe blocks wrap every test in BEGIN/ROLLBACK on the same client, so their " +
    "inserts never commit. Its third block could not (the store uses its own pool connection) and " +
    "was converted to seedAccount() + per-run ids instead.",
  "federation-003.test.ts":
    "DOD-M15-CHAINDEBT-1 — CONVERTED. Its AC-001 block proves cello_service may INSERT and SELECT " +
    "but not UPDATE or DELETE, so the INSERT has to execute as that role; it now runs inside " +
    "BEGIN/ROLLBACK on a service client, with SAVEPOINTs around the two statements that are meant " +
    "to fail (in Postgres a failed statement aborts the transaction, so without them the DELETE " +
    "assertion would pass on 'current transaction is aborted' rather than on a permission error). " +
    "The rollback replaced a cleanup that deleted WHERE relay_id LIKE '________________________________' " +
    "— thirty-two wildcards, reaching into every other test's rows, under a .catch(() => {}).",
  "persist-006-pgaudit.test.ts":
    "DOD-M15-CHAINDEBT-1 — CONVERTED. Its AC-001 INSERT must really execute as `cello_service`, " +
    "because the assertion reads that statement back out of the container's pgaudit log — so it " +
    "could not be seeded through the chained writer or dropped. It is now wrapped in " +
    "BEGIN/ROLLBACK on a dedicated client from the service pool. pgaudit logs statements as they " +
    "EXECUTE rather than at commit, so the evidence survives and the hole does not. Verified by " +
    "running the suite: 13/13, including the assertion that finds the audit entry.",
  "persist-018-seal-notarizations.test.ts":
    "DOD-M15-CHAINDEBT-1 — MISFILED AS DEBT, not converted. Its single literal `chain_hash` is the " +
    "SI-002 rollback test: it opens a dedicated client, BEGINs, writes conversation_seals and " +
    "seal_notarizations, and ROLLBACKs to prove both undo atomically when a connection drops before " +
    "COMMIT. The row is rolled back BY THE ASSERTION — the test then reads both tables and requires " +
    "zero rows. Its own comment said so at the time: 'chain_hash placeholder value is fine — this " +
    "row will be rolled back.'",
  "presence-001-repository.test.ts":
    "DOD-M15-CHAINDEBT-1 — MISFILED AS DEBT, not converted. Every query in this file runs on the " +
    "one client `beforeEach` opens with BEGIN and `afterEach` ROLLBACKs; the repo functions under " +
    "test are handed that same client rather than a pool. Verified by grep rather than by reading " +
    "the intent: the only `pool.` references in the file are `connect()` and `end()`, and the word " +
    "COMMIT does not appear. So its literal `chain_hash` is inert and always was — it was on the " +
    "backlog because the guard reads source, and source cannot see a rollback.",
};

/**
 * COUNTED, not blanket — a file-level exemption is a hole the size of the file.
 *
 * The first version of this listed `account-001.test.ts` and skipped it entirely. Reintroducing an
 * ordinary cleanup DELETE into that file then passed the guard, because the exemption covered
 * everything in it. So each entry declares HOW MANY chained deletes are legitimate; one more fails.
 */
const ALLOWED_DELETES: Record<string, { count: number; why: string }> = {
  "persist-004-hash-chain.test.ts": {
    count: 1,
    why:
      "AC-005 deletes a row to prove verifyChain DETECTS the gap — the delete is the subject, not " +
      "cleanup. It now runs inside inRolledBackTxn, so the break it creates is undone and no other " +
      "suite inherits an unverifiable connection_requests table. Converting it also let the test " +
      "assert breakAtSequence EXACTLY, which it previously could not: its own comment recorded that " +
      "the position 'is not predictable without full table isolation'.",
  },
  "account-001.test.ts": {
    count: 1,
    why:
      "AC-006 attempts a DELETE as the SERVICE role and asserts it is REFUSED. It deletes nothing, " +
      "because it fails — that is the test proving the table is append-only in production.",
  },
  "federation-003.test.ts": {
    count: 1,
    why:
      "DOD-M15-CHAINDEBT-1 — the surviving DELETE is the AC-001 assertion that cello_service is " +
      "REFUSED DELETE on relay_registrations. It runs inside a SAVEPOINT and is expected to throw, " +
      "so it removes nothing. The four cleanup deletes that used to sit alongside it are gone.",
  },
  "persist-003-rls.test.ts": {
    count: 1,
    why:
      "DOD-M15-CHAINDEBT-1 — the same shape as account-001 above, and it was on the debt list by " +
      "mistake. The DELETE runs as `cello_service` and the assertion is that it THROWS permission " +
      "denied; the row survives, which is the point. Removing this would delete the test that " +
      "proves conversation_seals is append-only in production — the very property the rest of this " +
      "guard exists to keep true.",
  },
};

/**
 * ─── ALLOWED_INSERTS — an INSERT that is the SUBJECT of its test and is REFUSED ────────────────
 *
 * Added by `DOD-M15-CHAINDEBT-1`. The guard had two dispositions for a literal `chain_hash`:
 * rolled back, or debt. A third case exists and had nowhere to go — an INSERT the database is
 * supposed to REJECT, written to prove a role has no INSERT privilege. It writes nothing, so it is
 * not a hole; and it cannot be "converted", because rewriting it through the chained writer would
 * delete the assertion it exists to make.
 *
 * COUNTED, for the same reason `ALLOWED_DELETES` is counted: a file-level exemption is a hole the
 * size of the file, and this file also contained a seeder that WAS real debt.
 */
const ALLOWED_INSERTS: Record<string, { count: number; why: string }> = {
  "persist-008-analytics.test.ts": {
    count: 2,
    why:
      "SI-001 attempts an INSERT into conversation_seals and one into conversation_participation " +
      "as `cello_analytics`, and asserts both REJECT — that is the test proving the analytics role " +
      "is SELECT-only on protocol tables. Neither writes a row. The file's real debt was its " +
      "`insertSealedConversation` seeder, which committed a constant chain_hash into three chained " +
      "tables; that now goes through `recordConversationSeal`.",
  },
};

/** How many chained-table INSERTs supplying a literal chain_hash a source contains. */
function insertCount(text: string): number {
  return HASH_CHAINED_TABLES.reduce((n, table) => {
    const m = text.match(new RegExp(`INSERT\\s+INTO\\s+${table}\\s*\\([^)]*chain_hash`, "gi"));
    return n + (m ? m.length : 0);
  }, 0);
}

/** How many chained-table DELETEs a source contains. */
function deleteCount(text: string): number {
  return HASH_CHAINED_TABLES.reduce((n, table) => {
    const m = text.match(new RegExp(`DELETE\\s+FROM\\s+${table}\\b`, "gi"));
    return n + (m ? m.length : 0);
  }, 0);
}

/** Still committing a literal chain_hash. Shrink; do not add. DOD-M15-DIRECTORY-ROT-1 owns these. */
const KNOWN_DEBT_INSERTS = [
  "persist-003-rls.test.ts",
  "persist-020-connections.test.ts",
  // PARTIALLY converted: its AC-001-extended block now runs in a rolled-back transaction (7 fake
  // chain_hash inserts, 7 deletes and a TRUNCATE removed). Other blocks in the file still violate.
  "persist-021-adapter-boundary-audit.test.ts",
];

/** Still deleting from a chained table. Shrink; do not add. */
const KNOWN_DEBT_DELETES = [
  "persist-020-connections.test.ts",
  "persist-021-adapter-boundary-audit.test.ts", // partially converted — see the note above
];

describe("DOD-M15-DIRECTORY-ROT-1: fixtures never put a hole in a hash-chained table", () => {
  it("no NEW fixture supplies a literal chain_hash on an INSERT into a chained table", () => {
    // A chain hash must be computed against the current chain head. A value a fixture can type is,
    // by construction, not that — so it is a hole wherever it lands.
    const offenders: string[] = [];
    for (const { name, text } of testSources()) {
      if (ROLLED_BACK[name] || KNOWN_DEBT_INSERTS.includes(name)) continue;
      const allowed = ALLOWED_INSERTS[name];
      const found = insertCount(text);
      if (allowed) {
        // Exempted for a COUNT of refused inserts, not for the file — one more is a new violation.
        if (found > allowed.count) offenders.push(`${name} (${found} literal chain_hash inserts, ${allowed.count} allowed)`);
        continue;
      }
      if (found > 0) offenders.push(name);
    }

    expect(
      offenders,
      `These fixtures INSERT into a hash-chained table while supplying chain_hash themselves: ` +
        `${offenders.join(", ")}. A hash not computed against the current chain head is a hole — ` +
        `verifyChain fails at that row and at every row after it, for the whole run, in files that ` +
        `have nothing to do with yours. Seed through the chained writer instead (see ` +
        `helpers/seed-account.ts for user_accounts), or wrap the fixture in BEGIN/ROLLBACK.`,
    ).toEqual([]);
  });

  it("no NEW fixture DELETEs from a hash-chained table", () => {
    // Deleting is worse than it looks: it does not remove one row's verifiability, it removes every
    // subsequent row's — permanently, for anyone whose database already had it. Per-run unique
    // fixture data removes the need entirely.
    const offenders: string[] = [];
    for (const { name, text } of testSources()) {
      if (KNOWN_DEBT_DELETES.includes(name)) continue;
      const allowed = ALLOWED_DELETES[name];
      const found = deleteCount(text);
      if (allowed) {
        // Exempted for a specific delete, not for the file. One more than declared is a new one.
        if (found > allowed.count) offenders.push(`${name} (${found} chained deletes, ${allowed.count} allowed)`);
        continue;
      }
      if (found > 0) offenders.push(name);
    }

    expect(
      offenders,
      `These fixtures DELETE from a hash-chained, append-only table: ${offenders.join(", ")}. ` +
        `Use per-run unique ids and leave the rows; if the delete IS the subject of the test, add it ` +
        `to ALLOWED_DELETES with the reason.`,
    ).toEqual([]);
  });

  it("THE BACKLOG ONLY SHRINKS — every named file still violates, and the counts cannot grow", () => {
    /**
     * What stops the debt lists becoming a permanent exemption nobody reads.
     *
     * A name that no longer violates must be REMOVED — otherwise the list overstates the work left
     * and hides that the constraint is already stricter than it looks. And the counts are pinned, so
     * a new violation cannot be quietly appended instead of fixed.
     */
    const sources = new Map(testSources().map((f) => [f.name, f.text]));
    const stale = (list: string[], kind: "insert" | "delete"): string[] =>
      list.filter((name) => {
        const text = sources.get(name);
        return text === undefined || !violates(text, kind);
      });

    const staleInserts = stale(KNOWN_DEBT_INSERTS, "insert");
    const staleDeletes = stale(KNOWN_DEBT_DELETES, "delete");

    expect(
      staleInserts,
      `Fixed (or gone) — remove from KNOWN_DEBT_INSERTS so the backlog reflects the work left: ${staleInserts.join(", ")}`,
    ).toEqual([]);
    expect(
      staleDeletes,
      `Fixed (or gone) — remove from KNOWN_DEBT_DELETES: ${staleDeletes.join(", ")}`,
    ).toEqual([]);

    // Lower these as files are converted; never raise them. DOD-M15-CHAINDEBT-1 owns driving both
    // to zero, at which point the lists and this assertion go with them.
    expect(KNOWN_DEBT_INSERTS.length, "the insert backlog must shrink, never grow").toBeLessThanOrEqual(3);
    expect(KNOWN_DEBT_DELETES.length, "the delete backlog must shrink, never grow").toBeLessThanOrEqual(2);
  });

  it("the ROLLED_BACK and ALLOWED_DELETES entries still name files that exist", () => {
    // An allowlist that outlives its files quietly grants exceptions to nothing, and hides that the
    // constraint is now stricter than it looks.
    const present = new Set(testSources().map((f) => f.name));
    const missing = [
      ...Object.keys(ROLLED_BACK),
      ...Object.keys(ALLOWED_DELETES),
      ...Object.keys(ALLOWED_INSERTS),
    ].filter((n) => !present.has(n));
    expect(missing, `these exemptions name files that no longer exist: ${missing.join(", ")}`).toEqual([]);
  });
});
