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
  "cross-node-discovery-pg.live.test.ts":
    "its first two describe blocks wrap every test in BEGIN/ROLLBACK on the same client, so their " +
    "inserts never commit. Its third block could not (the store uses its own pool connection) and " +
    "was converted to seedAccount() + per-run ids instead.",
};

/**
 * COUNTED, not blanket — a file-level exemption is a hole the size of the file.
 *
 * The first version of this listed `account-001.test.ts` and skipped it entirely. Reintroducing an
 * ordinary cleanup DELETE into that file then passed the guard, because the exemption covered
 * everything in it. So each entry declares HOW MANY chained deletes are legitimate; one more fails.
 */
const ALLOWED_DELETES: Record<string, { count: number; why: string }> = {
  "account-001.test.ts": {
    count: 1,
    why:
      "AC-006 attempts a DELETE as the SERVICE role and asserts it is REFUSED. It deletes nothing, " +
      "because it fails — that is the test proving the table is append-only in production.",
  },
};

/** How many chained-table DELETEs a source contains. */
function deleteCount(text: string): number {
  return HASH_CHAINED_TABLES.reduce((n, table) => {
    const m = text.match(new RegExp(`DELETE\\s+FROM\\s+${table}\\b`, "gi"));
    return n + (m ? m.length : 0);
  }, 0);
}

/** Still committing a literal chain_hash. Shrink; do not add. DOD-M15-DIRECTORY-ROT-1 owns these. */
const KNOWN_DEBT_INSERTS = [
  "dod-dirdata-read-1.test.ts",
  "federation-003.test.ts",
  "persist-003-rls.test.ts",
  "persist-006-pgaudit.test.ts",
  "persist-008-analytics.test.ts",
  "persist-018-seal-notarizations.test.ts",
  "persist-020-connections.test.ts",
  "persist-021-adapter-boundary-audit.test.ts",
  "presence-001-repository.test.ts",
];

/** Still deleting from a chained table. Shrink; do not add. */
const KNOWN_DEBT_DELETES = [
  "dod-dirdata-read-1.test.ts",
  "federation-001.test.ts",
  "federation-003.test.ts",
  "m12-ae-store-parity.live.test.ts",
  "m6b-010-startup-state-restore.test.ts",
  "persist-003-rls.test.ts",
  "persist-004-hash-chain.test.ts",
  "persist-020-connections.test.ts",
  "persist-021-adapter-boundary-audit.test.ts",
  "persist-reconnect-session-survival.test.ts",
];

describe("DOD-M15-DIRECTORY-ROT-1: fixtures never put a hole in a hash-chained table", () => {
  it("no NEW fixture supplies a literal chain_hash on an INSERT into a chained table", () => {
    // A chain hash must be computed against the current chain head. A value a fixture can type is,
    // by construction, not that — so it is a hole wherever it lands.
    const offenders = testSources()
      .filter(({ name }) => !ROLLED_BACK[name] && !KNOWN_DEBT_INSERTS.includes(name))
      .filter(({ text }) => violates(text, "insert"))
      .map(({ name }) => name);

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

    // Lower these as files are converted; never raise them.
    expect(KNOWN_DEBT_INSERTS.length, "the insert backlog must shrink, never grow").toBeLessThanOrEqual(9);
    expect(KNOWN_DEBT_DELETES.length, "the delete backlog must shrink, never grow").toBeLessThanOrEqual(10);
  });

  it("the ROLLED_BACK and ALLOWED_DELETES entries still name files that exist", () => {
    // An allowlist that outlives its files quietly grants exceptions to nothing, and hides that the
    // constraint is now stricter than it looks.
    const present = new Set(testSources().map((f) => f.name));
    const missing = [...Object.keys(ROLLED_BACK), ...Object.keys(ALLOWED_DELETES)].filter((n) => !present.has(n));
    expect(missing, `these exemptions name files that no longer exist: ${missing.join(", ")}`).toEqual([]);
  });
});
