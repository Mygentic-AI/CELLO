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
  ["chain_hash", "computed locally by ChainWriter.insertWithChain — a peer's chain hash is not ours"],
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

    for (const m of sql.matchAll(
      /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([a-z_][a-z0-9_]*)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)([^;,]*)/gi,
    )) {
      tables.get(m[1]!.toLowerCase())?.set(m[2]!.toLowerCase(), {
        notNull: /\bNOT\s+NULL\b/i.test(m[3]!),
        hasDefault: suppliesOwnValue(m[3]!),
      });
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
        .filter(([name, s]) => s.notNull && !s.hasDefault && !supplied.has(name) && !SUPPLIED_ELSEWHERE.has(name))
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
