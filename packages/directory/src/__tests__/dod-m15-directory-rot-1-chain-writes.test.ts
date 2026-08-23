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

/**
 * Strip comments before scanning — the guard reads CODE, not prose about code.
 *
 * ─── Why this had to exist ─────────────────────────────────────────────────────────────────────
 *
 * Widening the insert regex (F7) immediately flagged `schema-completeness.test.ts`, whose "match"
 * is a docstring listing example SQL:
 *
 *     *   `INSERT INTO seal_notarizations ...`
 *     *   `SELECT chain_hash FROM ${tableName} ...`
 *
 * Two comment lines, no statement. This project has now been bitten by the same thing three times:
 * this, my own `persist-020` comment that quoted the SQL it was explaining, and the claims ledger
 * counting its own correction note as a claim. **A guard that reads prose punishes documentation** —
 * and the response it invites is to delete the explanation, which is precisely backwards.
 *
 * Strings are preserved: the SQL under test lives in template literals and quoted strings, and that
 * is exactly what must still be read.
 */
function stripComments(text: string): string {
  return text
    // Block comments, including docstrings. Replaced with a newline so line-shaped patterns cannot
    // accidentally join across the removal.
    .replace(/\/\*[\s\S]*?\*\//g, "\n")
    // Line comments. `//` inside a string is not matched, because the alternation consumes whole
    // quoted spans first.
    .replace(/(["'`])(?:\\.|(?!\1)[\s\S])*\1|\/\/[^\n]*/g, (m) => (m.startsWith("//") ? "" : m));
}

function testSources(): Array<{ name: string; text: string }> {
  const out: Array<{ name: string; text: string }> = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      // Review F7: `.ts`, not `.test.ts`. `helpers/seed-account.ts` and `helpers/txn-pool.ts` were
      // never read — and this guard's own failure message sends authors to `helpers/` to fix things.
      // A shared fixture helper is the highest-leverage place for a chained write to hide.
      if (entry.endsWith(".ts") && entry !== SELF) {
        out.push({ name: entry, text: stripComments(readFileSync(full, "utf8")) });
      }
    }
  };
  walk(TESTS_DIR);
  return out;
}

/**
 * ─── Review F7: three ways past the old regexes, all closed here ───────────────────────────────
 *
 * 1. `INSERT INTO <table> (…, chain_hash)` only matched when `chain_hash` appeared inside the FIRST
 *    parenthesis group. `INSERT INTO <table> VALUES (…)` with no column list never matched at all.
 *    Now: match the statement head, then look for `chain_hash` anywhere in the ~400 chars after it.
 * 2. A `DELETE FROM ${table}` built by interpolation never matched a literal table name. Now
 *    flagged separately — see `interpolatedDelete`.
 * 3. The walker took only `*.test.ts`, so `helpers/seed-account.ts` and `helpers/txn-pool.ts` were
 *    never read — and the guard's own failure message points authors at `helpers/`. Now `.ts`.
 */
function insertRegex(table: string): RegExp {
  // The statement head, then chain_hash anywhere in what follows. The window is generous rather
  // than exact: a chained INSERT spanning more than ~400 characters before naming chain_hash is not
  // a shape anyone writes, and over-matching here costs an ALLOWED_INSERTS entry, not a miss.
  return new RegExp(`INSERT\\s+INTO\\s+${table}\\b[\\s\\S]{0,400}?chain_hash`, "i");
}

function violates(text: string, kind: "insert" | "delete"): boolean {
  return HASH_CHAINED_TABLES.some((table) => {
    const re = kind === "insert"
      ? insertRegex(table)
      : new RegExp(`DELETE\\s+FROM\\s+${table}\\b`, "i");
    return re.test(text);
  });
}

/**
 * A `DELETE FROM ${…}` whose table is INTERPOLATED, in a file that also names a chained table.
 *
 * The literal-name regex cannot see these, and `writeapi-001-agent-write.live.test.ts` already uses
 * the shape (over non-chained tables today, so no live hole). Flagged rather than banned: a
 * templated delete is legitimate, it just cannot be checked by reading, so it has to be declared.
 */
function interpolatedDelete(text: string): boolean {
  if (!/DELETE\s+FROM\s+\$\{/i.test(text)) return false;
  return HASH_CHAINED_TABLES.some((t) => new RegExp(`\\b${t}\\b`).test(text));
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
/**
 * ─── Review F6: COUNTED, because this guard's own header condemns file-level exemptions ────────
 *
 * `ROLLED_BACK` used to skip the insert check for the WHOLE file, uncounted — the exact shape the
 * `ALLOWED_DELETES` header calls "a hole the size of the file", and `DOD-M15-CHAINDEBT-1` added
 * four more files to it. The concrete risk is not hypothetical: `federation-003` is now both
 * file-exempt for inserts AND the home of a whole-table `verifyChain('relay_registrations')`, so a
 * future COMMITTING insert there would be invisible to the guard and would turn that file's own
 * assertion red with nothing pointing at the cause.
 *
 * Each entry now declares how many literal-`chain_hash` inserts are rolled back. One more fails.
 */
const ROLLED_BACK: Record<string, { count: number; why: string }> = {
  "dod-dirdata-read-1.test.ts": {
    count: 3,
    why:
    "the whole suite runs on one client inside BEGIN/ROLLBACK — the server under test is handed " +
    "txnPool(client), so its reads land on the same connection as the fixture's writes. Its two " +
    "literal chain_hash inserts therefore never commit, and the DELETE cleanup they needed is gone " +
    "with them: rollback is the cleanup, and there is nothing left to forget.",
  },
  "cross-node-discovery-pg.live.test.ts": {
    count: 2,
    why:
    "its first two describe blocks wrap every test in BEGIN/ROLLBACK on the same client, so their " +
    "inserts never commit. Its third block could not (the store uses its own pool connection) and " +
    "was converted to seedAccount() + per-run ids instead.",
  },
  "dod-m15-chaindebt-1-txn-pool.test.ts": {
    count: 1,
    why:
    "DOD-M15-CHAINDEBT-1 review F1 — the file that PROVES the rollback works. Its one literal " +
    "`chain_hash` is a raw INSERT inside `inRolledBackTxn` whose entire assertion is that the row " +
    "does NOT survive; it is the strongest rollback evidence in the directory, not an exemption. " +
    "Listed rather than reworded because the guard reads source and cannot see that the test's " +
    "subject IS the rollback — and it correctly flagged this file the moment it was added, which " +
    "is the guard doing its job on its author.",
  },
  "federation-003.test.ts": {
    count: 1,
    why:
    "DOD-M15-CHAINDEBT-1 — CONVERTED. Its AC-001 block proves cello_service may INSERT and SELECT " +
    "but not UPDATE or DELETE, so the INSERT has to execute as that role; it now runs inside " +
    "BEGIN/ROLLBACK on a service client, with SAVEPOINTs around the two statements that are meant " +
    "to fail (in Postgres a failed statement aborts the transaction, so without them the DELETE " +
    "assertion would pass on 'current transaction is aborted' rather than on a permission error). " +
    "The rollback replaced a cleanup that deleted WHERE relay_id LIKE '________________________________' " +
    "— thirty-two wildcards, reaching into every other test's rows, under a .catch(() => {}).",
  },
  "persist-021-adapter-boundary-audit.test.ts": {
    count: 8,
    why:
    "DOD-M15-CHAINDEBT-1 — MISFILED AS DEBT for its inserts. All seven literal `chain_hash` " +
    "inserts (conversation_seals, conversation_attestations, conversation_participation, " +
    "notification_events, seal_notarizations, connection_requests, connections) live in the AC-001 " +
    "deserializeRow block, whose `beforeEach` opens a client with BEGIN and whose `afterEach` " +
    "ROLLBACKs it — every query in those tests runs on that client. Its two chained DELETEs were " +
    "real and are gone: one pre-cleared a randomUUID request_id against a collision that would " +
    "better fail loudly on the unique constraint, the other was cleanup for a row written through " +
    "insertWithChain, i.e. a correctly chained row whose removal would break the chain the same " +
    "test had just verified.",
  },
  "persist-006-pgaudit.test.ts": {
    count: 1,
    why:
    "DOD-M15-CHAINDEBT-1 — CONVERTED. Its AC-001 INSERT must really execute as `cello_service`, " +
    "because the assertion reads that statement back out of the container's pgaudit log — so it " +
    "could not be seeded through the chained writer or dropped. It is now wrapped in " +
    "BEGIN/ROLLBACK on a dedicated client from the service pool. pgaudit logs statements as they " +
    "EXECUTE rather than at commit, so the evidence survives and the hole does not. Verified by " +
    "running the suite: 13/13, including the assertion that finds the audit entry.",
  },
  "persist-018-seal-notarizations.test.ts": {
    count: 1,
    why:
    "DOD-M15-CHAINDEBT-1 — MISFILED AS DEBT, not converted. Its single literal `chain_hash` is the " +
    "SI-002 rollback test: it opens a dedicated client, BEGINs, writes conversation_seals and " +
    "seal_notarizations, and ROLLBACKs to prove both undo atomically when a connection drops before " +
    "COMMIT. The row is rolled back BY THE ASSERTION — the test then reads both tables and requires " +
    "zero rows. Its own comment said so at the time: 'chain_hash placeholder value is fine — this " +
    "row will be rolled back.'",
  },
  "presence-001-repository.test.ts": {
    count: 1,
    why:
    "DOD-M15-CHAINDEBT-1 — MISFILED AS DEBT, not converted. Every query in this file runs on the " +
    "one client `beforeEach` opens with BEGIN and `afterEach` ROLLBACKs; the repo functions under " +
    "test are handed that same client rather than a pool. Verified by grep rather than by reading " +
    "the intent: the only `pool.` references in the file are `connect()` and `end()`, and the word " +
    "COMMIT does not appear. So its literal `chain_hash` is inert and always was — it was on the " +
    "backlog because the guard reads source, and source cannot see a rollback.",
  },
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
 * ─── ALLOWED_INSERTS — the regex flags it, and it is NOT a hole ────────────────────────────────
 *
 * Added by `DOD-M15-CHAINDEBT-1`. The guard had two dispositions for a literal `chain_hash`:
 * rolled back, or debt. Working the backlog turned up two more, and the guard cannot tell either
 * of them apart from real debt because **it reads source**: it sees the string `chain_hash` inside
 * an INSERT and cannot see what the value is or whether the statement succeeds.
 *
 *   · **REFUSED** — an INSERT the database is supposed to REJECT, written to prove a role has no
 *     INSERT privilege. It writes nothing. Rewriting it through the chained writer would delete the
 *     assertion it exists to make.
 *   · **CORRECTLY CHAINED BY HAND** — an INSERT that reads the current chain head and computes the
 *     hash with the same helpers the writer uses. It is an ordinary valid row; there is simply no
 *     store method for that shape.
 *
 * COUNTED, for the reason `ALLOWED_DELETES` is counted: a file-level exemption is a hole the size
 * of the file, and both files below ALSO contained real debt that had to be converted separately.
 * Each entry says WHICH of the two it is, so "allowed" never means "unexamined".
 */
const ALLOWED_INSERTS: Record<string, { count: number; why: string }> = {
  "persist-003-rls.test.ts": {
    count: 1,
    why:
      "CORRECTLY CHAINED BY HAND, in a single local helper (`insertChainedSeal`) that four RLS " +
      "tests call. They each seeded conversation_seals with `chain_hash = \"0\".repeat(64)` and " +
      "COMMITTED it. They cannot be rolled back — three insert as the SUPERUSER and then assert " +
      "what cello_service can or cannot do to that row from a DIFFERENT connection, which would " +
      "not see an uncommitted one — and they cannot use `recordConversationSeal`, which also " +
      "writes participation and attestation rows these tests do not want. The helper reads the " +
      "chain head and hashes the record against it, exactly as `insertWithChain` does.",
  },
  "persist-020-connections.test.ts": {
    count: 1,
    why:
      "CORRECTLY CHAINED BY HAND. SI-001's rejected-request test needs a connection_requests row " +
      "with outcome REJECTED, and the store's only chained writer for that table hard-codes " +
      "ACCEPTED — so it cannot be seeded through the store, and it cannot be rolled back either " +
      "because `createConnection` runs on a different connection and would not see it. It now " +
      "reads the current chain head and computes the hash with `computeChainHash`/`serializeRecord`, " +
      "exactly as `insertWithChain` does, so the row is valid rather than exempt. It previously " +
      "used CHAIN_GENESIS, which is the seed for the FIRST row — correct in an empty table and a " +
      "hole in every other. The file's real debt (its seeder, two whole-table wipes and nine " +
      "cleanup deletes) was converted separately.",
  },
  "persist-008-analytics.test.ts": {
    count: 2,
    why:
      "REFUSED. SI-001 attempts an INSERT into conversation_seals and one into conversation_participation " +
      "as `cello_analytics`, and asserts both REJECT — that is the test proving the analytics role " +
      "is SELECT-only on protocol tables. Neither writes a row. The file's real debt was its " +
      "`insertSealedConversation` seeder, which committed a constant chain_hash into three chained " +
      "tables; that now goes through `recordConversationSeal`.",
  },
};

/**
 * Files that build `DELETE FROM ${…}` and also mention a chained table — declared, with the tables
 * the interpolation can actually reach. Review F7: unreadable by a source guard, so it is stated.
 */
const INTERPOLATED_DELETE_DECLARED: Record<string, string> = {
  "persist-003-rls.test.ts":
    "AC-005 loops every append-only table asserting `cello_service` is REFUSED both UPDATE and " +
    "DELETE, via `DELETE FROM ${table} WHERE false`. It deletes nothing twice over — the predicate " +
    "matches no row AND the statement is expected to throw — and the loop's whole point is that it " +
    "covers chained tables. Found by this check on its first run, which is the check working: no " +
    "literal-name regex could ever have seen it.",
  "writeapi-001-agent-write.live.test.ts":
    "Its templated deletes target `agent_profiles` and `social_verifications`, neither of which is " +
    "in HASH_CHAINED_TABLES. It names chained tables only in prose. Declared so that pointing the " +
    "same loop at a chained table becomes a deliberate edit to this entry rather than an invisible one.",
};

/** How many chained-table INSERTs supplying a literal chain_hash a source contains. */
function insertCount(text: string): number {
  return HASH_CHAINED_TABLES.reduce((n, table) => {
    const m = text.match(new RegExp(`INSERT\\s+INTO\\s+${table}\\b[\\s\\S]{0,400}?chain_hash`, "gi"));
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
const KNOWN_DEBT_INSERTS: string[] = [
  // EMPTY. Paid down 8 → 0 by DOD-M15-CHAINDEBT-1.
  //
  // The two files still matching the insert regex are in ALLOWED_INSERTS, and each entry there
  // states which of the two shapes it is. **This comment previously said persist-003-rls was there
  // because "its INSERT is the one the RLS test proves is refused" — that is FALSE and was caught
  // on review (F5).** persist-003 has no refused INSERT at all; its refusals are UPDATE (AC-003)
  // and DELETE (AC-004), and its entry twelve lines below correctly says CORRECTLY-CHAINED-BY-HAND.
  // Left recorded rather than quietly corrected: a wrong reason attached to an exemption is how the
  // exemption survives its next reader, which is this guard's own subject matter.
];

/** Still deleting from a chained table. Shrink; do not add. */
const KNOWN_DEBT_DELETES: string[] = [
  // EMPTY. Paid down 8 -> 0 by DOD-M15-CHAINDEBT-1.
];

describe("DOD-M15-DIRECTORY-ROT-1: fixtures never put a hole in a hash-chained table", () => {
  it("no NEW fixture supplies a literal chain_hash on an INSERT into a chained table", () => {
    // A chain hash must be computed against the current chain head. A value a fixture can type is,
    // by construction, not that — so it is a hole wherever it lands.
    const offenders: string[] = [];
    for (const { name, text } of testSources()) {
      if (KNOWN_DEBT_INSERTS.includes(name)) continue;
      const found = insertCount(text);
      // Review F6: ROLLED_BACK is COUNTED now, exactly like ALLOWED_INSERTS. It used to skip the
      // whole file, which is the "hole the size of the file" this guard's own header condemns —
      // and a NEW committing insert in a rolled-back file was invisible.
      const rolled = ROLLED_BACK[name];
      if (rolled) {
        if (found > rolled.count) {
          offenders.push(`${name} (${found} literal chain_hash inserts, ${rolled.count} rolled back)`);
        }
        continue;
      }
      const allowed = ALLOWED_INSERTS[name];
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

  it("no fixture DELETEs from an INTERPOLATED table name while naming a chained one", () => {
    /**
     * Review F7. `DELETE FROM ${table}` cannot be checked by reading — the table is decided at
     * runtime — so the literal-name regex above is blind to it. A file that does this AND mentions
     * a chained table is one refactor away from deleting from one.
     *
     * Declared rather than banned: the shape is legitimate (`writeapi-001` uses it today, over
     * non-chained tables only). What is not acceptable is it being invisible.
     */
    const offenders = testSources()
      .filter(({ name }) => !INTERPOLATED_DELETE_DECLARED[name])
      .filter(({ text }) => interpolatedDelete(text))
      .map(({ name }) => name);

    expect(
      offenders,
      `These fixtures DELETE from an interpolated table name and also name a hash-chained table, ` +
        `so no source-reading guard can tell whether they delete from one: ${offenders.join(", ")}. ` +
        `Declare it in INTERPOLATED_DELETE_DECLARED with the tables it can actually reach.`,
    ).toEqual([]);
  });

  it("THE BACKLOG IS EMPTY AND STAYS EMPTY", () => {
    /**
     * ─── Review F8: the stale-check went vacuous when the lists reached zero ─────────────────────
     *
     * This used to walk `KNOWN_DEBT_*` asserting every named file still violates, so a paid-down
     * name could not linger and overstate the work left. `DOD-M15-CHAINDEBT-1` emptied both lists,
     * and the walk then iterated nothing and asserted `[] === []` — green forever, testing nothing.
     * Its own comment predicted it: *"at which point the lists and this assertion go with them."*
     * They did not go, so the assertion sat there looking like coverage.
     *
     * What replaces it is the assertion that actually has teeth now: the lists must be EMPTY. A
     * ceiling of zero cannot be satisfied by adding a name, so a new violation has nowhere to be
     * parked — it has to be fixed, converted, or declared in one of the counted `ALLOWED_*` lists
     * with a reason a reader can check.
     */
    expect(
      KNOWN_DEBT_INSERTS,
      `The literal-chain_hash backlog was paid down to zero. A name here means someone re-added ` +
        `debt instead of fixing it: convert the fixture, or declare it in ALLOWED_INSERTS with which ` +
        `of the two shapes it is (REFUSED, or CORRECTLY CHAINED BY HAND).`,
    ).toEqual([]);
    expect(
      KNOWN_DEBT_DELETES,
      `The chained-DELETE backlog was paid down to zero. A name here means someone re-added debt: ` +
        `use per-run unique ids and leave the rows, or declare it in ALLOWED_DELETES with a count ` +
        `and the reason the delete IS the subject of its test.`,
    ).toEqual([]);
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
