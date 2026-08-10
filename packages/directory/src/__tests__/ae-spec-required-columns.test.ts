/**
 * DOD-SIGNAL-REPLICATION-1 — every column a Tier-A INSERT is REQUIRED to supply must be in the spec.
 *
 * WHY THIS TEST EXISTS, AND WHY THE EXISTING ONE COULD NOT CATCH IT
 *
 * `ae-spec-schema.test.ts` asserts spec ⊆ schema: every column a spec NAMES must exist at HEAD. That
 * catches a spec naming a dropped column. It is blind in the other direction — a column the schema
 * REQUIRES that the spec never names — and that is the direction that broke `signal_records`.
 *
 * `scanner_version` is `TEXT NOT NULL` with no default (V46). It is not in `SIGNAL_RECORDS_SPEC`, and
 * `applyTierA` inserts exactly the spec's columns. So every single apply failed, by construction, on
 * `null value in column "scanner_version" violates not-null constraint` — 1530 consecutive failures
 * at the time of measurement, and not one trust-signal row has ever replicated between nodes.
 *
 * WHAT AN OPERATOR LIVED THROUGH. Trust signals existed on whichever node happened to mint them and
 * nowhere else, so which signals a counterparty could see depended on which of the three directory
 * nodes their client picked. The fork alarm climbed to 39 consecutive as a CONSEQUENCE, training
 * whoever reads it to ignore the alarm that is supposed to announce a real fork.
 *
 * Nothing caught it for the same reason nothing caught the `subject` column: the failure was a warn
 * log on a node nobody tails, the types cannot express a SQL constraint, and the unit tests pin the
 * table list rather than the columns. So: replay the migrations, recover each column's NOT NULL and
 * DEFAULT state at HEAD, and assert the spec supplies everything an INSERT must supply.
 *
 * Static — no database, runs in the normal suite.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { TIER_A_SPECS } from "../ae-table-encoders.js";

const MIGRATIONS_DIR = join(import.meta.dirname, "..", "..", "db", "migrations");

interface ColumnState {
  notNull: boolean;
  hasDefault: boolean;
}

/**
 * Columns a Tier-A INSERT legitimately does NOT carry in its spec, with the producer that supplies
 * them instead. An allowlist, not a denylist: a column that is required and unexplained must fail.
 *
 * `chain_hash` is the only member. On the `chained: true` tables `applyTierA` routes through
 * `ChainWriter.insertWithChain`, which computes the value locally and overwrites the placeholder —
 * replicating a peer's chain hash would be wrong, because each node's chain is its own.
 */
const SUPPLIED_ELSEWHERE: ReadonlyMap<string, string> = new Map([
  ["user_accounts.chain_hash", "computed locally by ChainWriter.insertWithChain — a peer's chain hash is not ours"],
  ["relay_registrations.chain_hash", "computed locally by ChainWriter.insertWithChain"],
  ["conversation_seals.chain_hash", "computed locally by ChainWriter.insertWithChain"],
  ["conversation_participation.chain_hash", "computed locally by ChainWriter.insertWithChain"],
  ["conversation_attestations.chain_hash", "computed locally by ChainWriter.insertWithChain"],
  ["seal_notarizations.chain_hash", "computed locally by ChainWriter.insertWithChain"],
]);

/** Numeric order — V9 before V10. Lexical sort would replay them wrong. */
function migrationsInOrder(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort((a, b) => {
      const n = (f: string) => Number(/^V(\d+)__/.exec(f)?.[1] ?? 0);
      return n(a) - n(b);
    });
}

/**
 * Does this column definition supply its own value when an INSERT omits the column?
 *
 * DEFAULT is the obvious case. SERIAL/BIGSERIAL and GENERATED both install one implicitly, and a
 * parser that missed them would report `id` as required on every table with a surrogate key and
 * drown the real finding in false positives.
 */
function suppliesOwnValue(definition: string): boolean {
  return /\bDEFAULT\b/i.test(definition)
    || /\b(BIG)?SERIAL\b/i.test(definition)
    || /\bGENERATED\b/i.test(definition);
}

/** Split a CREATE TABLE body on commas that are not inside parentheses (CHECK (x IN ('a','b'))). */
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of body) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else current += ch;
  }
  parts.push(current);
  return parts;
}

/**
 * Replay the DDL and recover every column's (notNull, hasDefault) at HEAD.
 *
 * Handles the four statements that can change the answer: CREATE TABLE, ADD COLUMN, DROP COLUMN, and
 * ALTER COLUMN SET/DROP NOT NULL/DEFAULT. The last one is not decoration — V12 and V15 add columns
 * `NOT NULL DEFAULT <placeholder>` and then DROP the default in the same migration, which is exactly
 * the pattern that turns a satisfied column into a required one.
 */
function columnStateAtHead(): Map<string, Map<string, ColumnState>> {
  const tables = new Map<string, Map<string, ColumnState>>();

  for (const file of migrationsInOrder()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8")
      .replace(/--[^\n]*/g, "") // strip line comments: they quote column names in prose
      .replace(/\/\*[\s\S]*?\*\//g, "");

    for (const m of sql.matchAll(
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)\s*\(([\s\S]*?)\n\s*\)\s*;/gi,
    )) {
      const table = m[1]!.toLowerCase();
      const cols = new Map<string, ColumnState>();
      for (const raw of splitTopLevel(m[2]!)) {
        const line = raw.trim();
        if (!line) continue;
        // Skip table-level constraints — they are not columns.
        if (/^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT|EXCLUDE|LIKE)\b/i.test(line)) continue;
        const name = /^([a-z_][a-z0-9_]*)/i.exec(line)?.[1];
        if (!name) continue;
        cols.set(name.toLowerCase(), {
          // PRIMARY KEY implies NOT NULL, and several tables declare it inline rather than spelling
          // out the constraint. Missing that would let a PK column go unchecked.
          notNull: /\bNOT\s+NULL\b/i.test(line) || /\bPRIMARY\s+KEY\b/i.test(line),
          hasDefault: suppliesOwnValue(line),
        });
      }
      tables.set(table, cols);
    }

    // ADD COLUMN, matched TWO-LEVEL: the statement once, then every clause inside it.
    //
    // A single-level regex requiring an `ALTER TABLE` prefix per match captures only the FIRST column
    // of `ALTER TABLE t ADD COLUMN a …, ADD COLUMN b …, …` — and V15 adds six that way, V5 eight. The
    // loss is silent, so a future Tier-A table that gains a required column through a multi-column
    // ALTER would leave this guard green while the table never replicates: the same shape as the
    // defect the guard exists to prevent.
    for (const stmt of sql.matchAll(
      /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([a-z_][a-z0-9_]*)([\s\S]*?);/gi,
    )) {
      const table = stmt[1]!.toLowerCase();
      const cols = tables.get(table);
      for (const clause of stmt[2]!.matchAll(
        /ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)((?:[^,;(]|\([^)]*\))*)/gi,
      )) {
        // A silent skip here is how a column goes missing without anyone noticing, so it throws.
        if (!cols) {
          throw new Error(
            `${file}: ADD COLUMN on '${table}', which has no CREATE TABLE the parser recognised. ` +
              `The parser is out of date with the migrations — fix it rather than letting the column vanish.`,
          );
        }
        cols.set(clause[1]!.toLowerCase(), {
          notNull: /\bNOT\s+NULL\b/i.test(clause[2]!),
          hasDefault: suppliesOwnValue(clause[2]!),
        });
      }
    }

    for (const m of sql.matchAll(
      /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([a-z_][a-z0-9_]*)\s+DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi,
    )) {
      tables.get(m[1]!.toLowerCase())?.delete(m[2]!.toLowerCase());
    }

    // ALTER TABLE <t> ... ALTER COLUMN <c> {SET|DROP} {NOT NULL|DEFAULT ...}. One statement can carry
    // several comma-separated ALTER COLUMN clauses (V15), so the table is matched once and the
    // clauses scanned within it.
    for (const stmt of sql.matchAll(
      /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([a-z_][a-z0-9_]*)([\s\S]*?);/gi,
    )) {
      const cols = tables.get(stmt[1]!.toLowerCase());
      if (!cols) continue;
      for (const clause of stmt[2]!.matchAll(
        /ALTER\s+COLUMN\s+([a-z_][a-z0-9_]*)\s+(SET|DROP)\s+(NOT\s+NULL|DEFAULT)/gi,
      )) {
        const state = cols.get(clause[1]!.toLowerCase());
        if (!state) continue;
        const setting = clause[2]!.toUpperCase() === "SET";
        if (/NOT/i.test(clause[3]!)) state.notNull = setting;
        else state.hasDefault = setting;
      }
    }
  }

  return tables;
}

describe("DOD-SIGNAL-REPLICATION-1 — a Tier-A spec supplies every column its INSERT must supply", () => {
  const schema = columnStateAtHead();

  it("parses NOT NULL and DEFAULT (guards the parser against passing vacuously)", () => {
    // Without this, a formatting change that stopped the regexes matching would leave every column
    // set empty and every assertion below would pass while checking nothing.
    expect(schema.size).toBeGreaterThan(20);
    const signals = schema.get("signal_records");
    expect(signals).toBeDefined();
    // The column this test was written for, in the exact state that breaks the insert.
    expect(signals!.get("scanner_version")).toEqual({ notNull: true, hasDefault: false });
    // ...and one that is NOT NULL but carries a default, which must NOT be reported as required.
    expect(signals!.get("is_tombstone")).toEqual({ notNull: true, hasDefault: true });
  });

  it("proves the parser reads EVERY clause of a multi-column ALTER TABLE, not just the first", () => {
    // V15 adds six columns in one statement. A single-level regex captures only `connection_id` and
    // silently drops the other five — including `status`, which is exactly the shape of column that
    // would later be mistaken for absent. Pin the LAST one in the statement.
    const conn = schema.get("connections");
    expect(conn).toBeDefined();
    // `status` is the 5th clause and is the one that proves the multi-clause parse on its own: it
    // keeps its DEFAULT 'active', while the statement's later ALTER COLUMN block drops the defaults
    // of the others. A single-level parser sees neither it nor the drop.
    expect(conn!.get("status"), "the 5th ADD COLUMN clause").toEqual({ notNull: true, hasDefault: true });
    // ...and these two prove the ADD and the DROP DEFAULT compose in the right order within one file.
    expect(conn!.get("connection_id"), "1st clause, default dropped later in V15").toEqual({ notNull: true, hasDefault: false });
    expect(conn!.get("chain_hash"), "6th and last clause, default dropped later in V15").toEqual({ notNull: true, hasDefault: false });
  });

  it("proves the parser applies DROP DEFAULT — a satisfied column becoming a required one", () => {
    // V12 adds seal_notarizations.session_id as `NOT NULL DEFAULT '\x00'` and then DROPs the default
    // in the same file. A parser that read only the ADD COLUMN would call it satisfied forever.
    const seal = schema.get("seal_notarizations");
    expect(seal).toBeDefined();
    expect(seal!.get("session_id")).toEqual({ notNull: true, hasDefault: false });
  });

  it.each(TIER_A_SPECS.map((s) => [s.table, s] as const))(
    "%s — no column is required by the schema and absent from the spec",
    (table, spec) => {
      const live = schema.get(table);
      expect(live, `${table} has no CREATE TABLE in any migration`).toBeDefined();

      const supplied = new Set<string>([...spec.naturalKey, ...spec.immutableColumns]);
      const unsupplied = [...live!.entries()]
        .filter(([name, s]) => s.notNull && !s.hasDefault && !supplied.has(name) && !SUPPLIED_ELSEWHERE.has(`${table}.${name}`))
        .map(([name]) => name);

      expect(
        unsupplied,
        `${table}: the schema REQUIRES column(s) ${unsupplied.join(", ")} (NOT NULL, no default) and ` +
          `the Tier-A spec does not carry them. applyTierA inserts exactly the spec's columns, so ` +
          `EVERY apply for this table fails with a not-null violation and the table never replicates. ` +
          `Either add the column to the spec (it must also be immutable — a mutable column belongs in ` +
          `Tier B or its own table), or give it a default in a migration.`,
      ).toEqual([]);
    },
  );
});

/**
 * ── THE COMPLEMENT CHECK: every column in a replicating table has an EXPLICIT disposition ─────────
 *
 * The guard above asks "will an apply CRASH?" — it fires only on NOT NULL columns with no default.
 * Its own parser test pins `is_tombstone` (NOT NULL, WITH default) as something it must NOT report.
 * So the entire class where replication SUCCEEDS WITH THE WRONG VALUE is invisible to it by design,
 * and that is where every replication defect this project has hit actually lived: the kill switch's
 * `agent_id`, the trust-signal tombstone, the heartbeat, the account link.
 *
 * That class also survived a real, hours-long deep dive (2026-08-07/08) because the dive tracked
 * TABLES. Two tables were closed as "solved — moved to Tier A", and Tier A carries immutable columns
 * only, so in each case the MUTABLE COLUMN the move was supposed to fix could not come along.
 * `directory_nodes` moved to Tier A specifically to get last-writer-wins on `last_heartbeat_at`; the
 * heartbeat is not in the spec and still does not replicate. The table got a tick, the requirement
 * was dropped, and nothing anywhere noticed because nothing was watching columns.
 *
 * So this asks the other question: for EVERY column in a Tier-A table, is there a decision on
 * record? Not "is it replicated" — replicating some of these would be wrong. Just: did somebody
 * decide, and write down why. A column with no entry fails the build, which means the decision is
 * forced at the moment the column is added, by the person who has the context — rather than being
 * rediscovered months later as a wrong answer in production.
 */
const ALWAYS_LOCAL: ReadonlySet<string> = new Set([
  // Surrogate row id. Per-node by construction; nothing joins across nodes on it.
  "id",
  // Each node chains in ITS OWN insertion order, so the same rows legitimately hash differently on
  // different nodes. Verified live 2026-08-10: all three nodes' user_accounts chains VALID, and
  // euw1's hashes differ from the other two because its rows arrived in a different order.
  // Replicating this column would break every node's verification.
  "chain_hash",
  // When THIS node stored it. Replicating it would overwrite each node's own record of what it knew
  // and when — which is the one thing a per-node audit trail is for.
  "created_at",
]);

/**
 * Columns present in a Tier-A table and deliberately NOT replicated, each with the reason.
 *
 * `UNDECIDED:` is a legal prefix and is pinned separately below, so an open question is visible
 * rather than dressed up as a decision. Writing a confident-sounding reason for something nobody has
 * actually decided is the failure this whole exercise exists to stop.
 */
const LOCAL_BY_DECISION: ReadonlyMap<string, string> = new Map([
  ["capability_claim_codes.redeemed_at",
   "AUDIT ONLY, verified 2026-08-10. Single-use is enforced by the nonce binder, not by this column. " +
   "pre_auth_nonce_bindings is deliberately node-local (V40): a T-of-N registration has every " +
   "participating node bind the SAME nonce at once, and replicating that would halt replication on a " +
   "concurrent same-key write. Single-use still holds because T = floor(N/2)+1 (verified in " +
   "protocol-types/registration.ts), so any two quorums share at least one node and that node rejects " +
   "the replay. NOTE this is a security property that DEPENDS on the majority threshold."],
  ["agent_profiles.status",
   "INERT TODAY, AND ARMED IF ANYONE USES IT. `NOT NULL DEFAULT 'active'`, and nothing in the " +
   "directory ever writes any other value (checked 2026-08-10 — retirement and burn go through " +
   "agent_revocations / agent_suspensions instead). So every row is 'active' on every node and the " +
   "column agrees across the fleet by accident, because the default happens to be the only value. " +
   "TWO reads gate on it — `WHERE status = 'active'` in both the profile read-through and the " +
   "load-all — so the day someone writes 'retired' here, that write does NOT travel and both gates " +
   "FAIL OPEN on the other two nodes. That is precisely the kill-switch bug this project already " +
   "shipped once (agent_id absent from this same spec meant a burned agent kept being co-signed by " +
   "every node that learned it by replication). Either delete the column or give it a Tier-B merge " +
   "BEFORE writing a second value to it."],
  ["agent_profiles.account_id",
   "DEAD COLUMN — superseded by the agent_account_links table, which IS Tier A and is converged (14 " +
   "rows on all three nodes, verified 2026-08-10). Do not add this to replication; delete it, and " +
   "move the last reader (internal-api-server.ts /internal/agent-by-pubkey) to the replicated table. " +
   "That reader feeds the portal's same-operator check, which is why this is not cosmetic: measured " +
   "live, the column reads 7/7/0 across the three nodes, so half of that security check is currently " +
   "decided by which node the portal happened to ask. Tracked as CELLO-REPL-001."],
  ["user_accounts.email_stub_hash",
   "DEAD COLUMN — superseded by the account_email_stubs table, which IS Tier A and converged. The " +
   "directory's own readers already moved (account-lookup.ts, account-facts.ts). Excluded from the " +
   "hash chain too, so it is also not tamper-evident (DOD-ACCOUNTS-EMAIL-CHAIN-1). Delete rather " +
   "than replicate."],
  ["signal_records.is_tombstone",
   "SOLVED BY A FACT TABLE, not by replication — the pattern to copy. A revocation is mutable state, " +
   "so it cannot ride Tier A; V62 puts the immutable FACT in signal_revocations (which IS Tier A) and " +
   "the signal_records_effective view unions it with the local tombstone. Replicating this column " +
   "directly would land a revocation on peers as an ACTIVE signal — caught in review before it armed."],
  ["signal_records.revoker_pubkey", "Part of the tombstone row; the fact replicates via signal_revocations. See is_tombstone."],
  ["signal_records.revoker_signature", "Part of the tombstone row; the fact replicates via signal_revocations. See is_tombstone."],
  ["signal_records.status",
   "MUTABLE BY NECESSITY and correctly excluded: revoking must not change the signal's hash, or the " +
   "directory could never find the signal it just revoked (V46). Consumers read " +
   "signal_records_effective, which DERIVES status from supersedes_hash and signal_revocations, both " +
   "replicated. Verified 2026-08-10: the view returns identical effective_status for all 17 signals " +
   "on all three nodes. The raw column diverges and is a trap for a future direct reader."],
  ["signal_records.revoked_at", "Timestamp of the mutable status above; derived by the effective view. Same reasoning."],
  ["account_email_stubs.linked_at", "Arrival time on THIS node. Zero SQL readers (checked 2026-08-10)."],
  ["agent_account_links.linked_at", "Arrival time on THIS node. Zero SQL readers (checked 2026-08-10)."],
  ["authorized_issuers.added_at", "Arrival time on THIS node. Zero SQL readers (checked 2026-08-10)."],
  ["conversation_attestations.attested_at", "Arrival time on THIS node."],
  ["signal_revocations.recorded_at", "Arrival time on THIS node; the revocation FACT is what replicates."],
  ["directory_nodes.last_heartbeat_at",
   "DECIDED: IT SHOULD TRAVEL, AND IT IS THE ONE THAT ACTUALLY NEEDS BUILDING. The only column of " +
   "the 21 with a real reader that needs a fleet-wide answer — agent-presence-repository joins it to " +
   "compute `node_fresh`. Tracked on the launch list; NOT launch-blocking because both user-visible " +
   "surfaces deliberately ignore the heartbeat and the checkpoint machinery is parked. History: " +
   "table was then closed as 'solved — moved to Tier A', which cannot carry a mutable column. The " +
   "requirement was dropped by the act of closing it. Live consequence, measured: every node reads " +
   "the other two as never-heartbeated and counts availableNodes 1 against requiredThreshold 2, so " +
   "federation checkpoints have never succeeded. Ranked NOT launch-blocking because both " +
   "user-visible surfaces deliberately ignore the heartbeat and the checkpoint machinery is parked. " +
   "Needs a real Tier-B merge, not a spec edit."],
  ["directory_nodes.endpoint",
   "NO PRODUCTION READER — and the first version of this reason was WRONG about why. It said " +
   "'never selected'; there IS a select, `SELECT * FROM directory_nodes` in getDirectoryNode, which " +
   "a column-name scan cannot see. That accessor's only caller is a TEST (deploy-001), so nothing " +
   "in production reads the column — but the evidence is 'dead accessor', not 'no query'. " +
   "Node endpoints reach CLIENTS from the SIGNED MANIFEST, never from this table, and that is the " +
   "right source: an endpoint learned from a peer's replicated row would be an unsigned address to " +
   "dial. So the 'a node learned by replication arrives undialable' worry does not bite."],
  ["directory_nodes.status",
   "NO PRODUCTION READER — same correction as endpoint above: the `SELECT *` in getDirectoryNode " +
   "reads it, and that accessor is test-only. Node liveness is answered by last_heartbeat_at below. " +
   "Nothing serves this column to a client on any wire surface."],
  ["authorized_issuers.status",
   "OPERATOR-MANAGED TABLE, and the hazard is the ASYMMETRY, not the column. No application code " +
   "writes this table at all — issuers are enrolled by hand on each node (all three were seeded " +
   "individually). `NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked'))`, one row today " +
   "(the portal's KMS key). The authority check is fail-CLOSED on every branch: no row -> " +
   "unknown_issuer, status != active -> issuer_revoked, wrong role -> issuer_wrong_role. " +
   "SO THE TRAP IS: enrollment REPLICATES (pubkey/role/label are in the spec) and revocation DOES " +
   "NOT. An operator who watched an enrollment propagate would reasonably assume a revocation does " +
   "too — it does not, and the peers keep accepting that issuer. Not reachable from code today. " +
   "Runbook rule until an issuer_revocations fact table exists (the V62 pattern): REVOKE AN ISSUER " +
   "ON ALL THREE NODES, never one."],
  ["authorized_issuers.revoked_at",
   "NO READER (table-scoped scan, 2026-08-10) — the timestamp of a status nothing in the " +
   "application writes. Rides with the status decision above."],
  ["relay_registrations.deregistered_at",
   "NO READER (table-scoped scan, 2026-08-10). Relay pool membership is decided by the /health " +
   "probe the directories run, not by this column, so a deregistration that did not travel changes " +
   "no answer anyone asks."],
  ["seal_notarizations.supersedes_notarization_id",
   "CANNOT REPLICATE BY CONSTRUCTION — it is a nullable BIGINT FK to seal_notarizations.id, and `id` " +
   "is a per-node BIGSERIAL that is itself never replicated. The same pointer value denotes a " +
   "DIFFERENT row (or no row) on another node, so carrying it would not convey the fact, it would " +
   "convey a wrong one. Same family as chain_hash. If a peer ever needs to know a notarization was " +
   "superseded, that fact must travel by session_id, not by row id."],
]);

describe("every column in a Tier-A table has an explicit disposition", () => {
  const schema = columnStateAtHead();

  it.each(TIER_A_SPECS.map((s) => [s.table, s] as const))(
    "%s — no column is silently absent from the spec",
    (table, spec) => {
      const live = schema.get(table);
      expect(live, `${table} has no CREATE TABLE in any migration`).toBeDefined();

      const declared = new Set<string>([
        ...spec.naturalKey,
        ...spec.immutableColumns,
        ...((spec as { mutableColumns?: readonly string[] }).mutableColumns ?? []),
      ]);
      const undisposed = [...live!.keys()].filter(
        (name) =>
          !declared.has(name) &&
          !ALWAYS_LOCAL.has(name) &&
          !LOCAL_BY_DECISION.has(`${table}.${name}`) &&
          !SUPPLIED_ELSEWHERE.has(`${table}.${name}`),
      );

      expect(
        undisposed,
        `${table}: column(s) ${undisposed.join(", ")} exist in the schema, are not in the Tier-A ` +
          `spec, and have no recorded decision. This will NOT fail an apply — it will replicate the ` +
          `row with this column's DEFAULT and every node will disagree quietly. Decide now and add ` +
          `an entry to LOCAL_BY_DECISION (an 'UNDECIDED:' reason is allowed and is pinned below).`,
      ).toEqual([]);
    },
  );

  /**
   * `SELECT *` DEFEATS EVERY COLUMN-NAME ARGUMENT ABOVE, so it needs a decision of its own.
   *
   * Several dispositions in this file rest on "nothing reads this column". That evidence is gathered
   * by looking for the column's NAME in a query — and `SELECT *` names nothing while reading
   * everything. The first pass of this file asserted "written and never selected" for two
   * `directory_nodes` columns while `SELECT * FROM directory_nodes` sat in the store. The conclusion
   * survived (that accessor's only caller is a test), but the reasoning was hollow and would not have
   * survived a production caller appearing.
   *
   * So: a `SELECT *` against a REPLICATING table must be listed here with the reason it is safe.
   * The listed ones are re-checked when their reason stops being true; an unlisted one fails.
   */
  const STAR_SELECTS_ON_TIER_A: ReadonlyMap<string, string> = new Map([
    ["directory_nodes",
     "getDirectoryNode (adapters/pg-directory-store.ts) — TEST-ONLY CALLER (deploy-001). It returns " +
     "every column including the two excluded from replication, so if a production caller ever " +
     "appears, re-check status and endpoint before trusting their 'no production reader' reasons."],
  ]);

  it("no SELECT * reads a replicating table without a recorded reason", () => {
    const tierATables = new Set(TIER_A_SPECS.map((s) => s.table));
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "__tests__") walk(full);
          continue;
        }
        if (!entry.name.endsWith(".ts")) continue;
        // COMMENTS FIRST. The first version of this guard scanned raw text and fired on PSEUDOCODE
        // inside a JSDoc block ("SELECT * FROM agent_profiles" documenting a method whose real query
        // is a properly-columned JOIN). A guard that cries wolf on prose gets switched off, and this
        // is the same mistake — reading comments as code — that put a wrong reason in this file an
        // hour earlier. Block comments and comment-continuation lines go before any matching.
        const src = readFileSync(full, "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .split("\n")
          .filter((l) => !/^\s*(\/\/|\*)/.test(l))
          .join("\n");
        for (const m of src.matchAll(/SELECT\s+\*\s+FROM\s+([a-z_][a-z0-9_]*)/gi)) {
          const table = m[1]!.toLowerCase();
          if (tierATables.has(table) && !STAR_SELECTS_ON_TIER_A.has(table)) {
            offenders.push(`${entry.name}: SELECT * FROM ${table}`);
          }
        }
      }
    };
    walk(join(import.meta.dirname, ".."));

    expect(
      offenders,
      `SELECT * against a replicating table reads columns this file has argued nothing reads: ` +
        `${offenders.join("; ")}. Either name the columns explicitly, or add the table to ` +
        `STAR_SELECTS_ON_TIER_A with the reason it is safe.`,
    ).toEqual([]);
  });

  it("the UNDECIDED set is pinned — an open question must not grow silently", () => {
    // A ratchet on the open questions themselves. Adding one requires editing this list, which is
    // the moment somebody has to look at it; removing one is what progress looks like.
    const undecided = [...LOCAL_BY_DECISION.entries()]
      .filter(([, reason]) => reason.startsWith("UNDECIDED:"))
      .map(([key]) => key)
      .sort();

    // ALL SEVEN CLOSED 2026-08-10, by a table-scoped scan of every SQL literal in the directory
    // (comments stripped first — the earlier bare column-name grep matched same-named columns in
    // OTHER tables and produced three wrong answers). Four turned out to have no reader at all, one
    // cannot replicate by construction, one is operator-managed with the hazard named, and exactly
    // one — directory_nodes.last_heartbeat_at — genuinely needs building.
    //
    // Keep this assertion. An empty list is the state to defend: the next column added without a
    // decision fails the test above, and the next UNDECIDED written fails this one.
    expect(undecided).toEqual([]);
  });
});
