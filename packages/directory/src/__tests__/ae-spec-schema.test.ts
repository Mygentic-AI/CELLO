/**
 * DOD-M12-AE-SCHEMA-1 — every Tier-A spec column must exist in the schema at HEAD.
 *
 * WHY THIS TEST EXISTS
 *
 * `SIGNAL_RECORDS_SPEC` named a `subject` column. V46 created it; V55 dropped it. The spec was
 * written by reading V46's CREATE TABLE and nothing after, so it named a column that had not
 * existed for nine migrations.
 *
 * The blast radius was the surprising part. `handling_ae_state_req` builds a digest per Tier-A
 * table; one table's query throwing `column "subject" does not exist` aborts the whole request,
 * so the peer's entire anti-entropy round dies. ONE wrong column name in ONE spec silently
 * stopped replication of ALL eleven Tier-A tables across all three nodes — and the symptom
 * surfaced nowhere near the cause: Telegram registration failed with CLAIM_CODE_INVALID, because
 * a claim code minted on gcp-use1 never replicated to the node the client had randomly picked.
 *
 * Nothing caught it. Unit tests pin the table LIST and its ORDER, not the columns. TypeScript
 * cannot type a SQL identifier. The failure was a runtime warn log on a node nobody was tailing.
 *
 * So: parse the migrations, replay them in order, and assert every spec column survives to HEAD.
 * Static — no database required, runs in the normal suite.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { TIER_A_SPECS } from "../ae-table-encoders.js";

const MIGRATIONS_DIR = join(import.meta.dirname, "..", "..", "db", "migrations");

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
 * Replay CREATE TABLE / ALTER TABLE ADD COLUMN / DROP COLUMN to get each table's columns at HEAD.
 *
 * Deliberately ignores VIEWs: `signal_records_effective` is dropped and recreated repeatedly around
 * the very DROP COLUMN that caused this bug, and treating a view as a table would mask it.
 */
function columnsAtHead(): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>();

  for (const file of migrationsInOrder()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8")
      .replace(/--[^\n]*/g, "") // strip line comments: they quote column names in prose
      .replace(/\/\*[\s\S]*?\*\//g, "");

    for (const m of sql.matchAll(
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)\s*\(([\s\S]*?)\n\s*\)\s*;/gi,
    )) {
      const table = m[1]!.toLowerCase();
      const cols = new Set<string>();
      for (const raw of splitTopLevel(m[2]!)) {
        const line = raw.trim();
        if (!line) continue;
        // Skip table-level constraints — they are not columns.
        if (/^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT|EXCLUDE|LIKE)\b/i.test(line)) continue;
        const name = /^([a-z_][a-z0-9_]*)/i.exec(line)?.[1];
        if (name) cols.add(name.toLowerCase());
      }
      tables.set(table, cols);
    }

    for (const m of sql.matchAll(
      /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([a-z_][a-z0-9_]*)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi,
    )) {
      tables.get(m[1]!.toLowerCase())?.add(m[2]!.toLowerCase());
    }

    for (const m of sql.matchAll(
      /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([a-z_][a-z0-9_]*)\s+DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi,
    )) {
      tables.get(m[1]!.toLowerCase())?.delete(m[2]!.toLowerCase());
    }
  }

  return tables;
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

describe("DOD-M12-AE-SCHEMA-1 — Tier-A specs match the schema at HEAD", () => {
  const schema = columnsAtHead();

  it("parses the migrations (guards the parser itself against silently matching nothing)", () => {
    // If the regexes stop matching — a formatting change, a new DDL style — every table's column
    // set would be empty and the real assertions below would pass vacuously.
    expect(schema.size).toBeGreaterThan(20);
    expect(schema.get("signal_records")).toBeDefined();
  });

  it("proves the parser applies DROP COLUMN — the exact miss that broke replication", () => {
    // V46 creates signal_records.subject; V55 drops it. A parser that ignored DROP COLUMN would
    // report `subject` as present and this whole test would have missed the original bug.
    expect(schema.get("signal_records")!.has("subject_kind")).toBe(true);
    expect(schema.get("signal_records")!.has("subject")).toBe(false);
  });

  it.each(TIER_A_SPECS.map((s) => [s.table, s] as const))(
    "%s — every natural-key and immutable column exists at HEAD",
    (table, spec) => {
      const live = schema.get(table);
      expect(live, `${table} has no CREATE TABLE in any migration`).toBeDefined();

      const missing = [...spec.naturalKey, ...spec.immutableColumns].filter((c) => !live!.has(c));
      expect(
        missing,
        `${table}: spec names column(s) that do not exist at HEAD: ${missing.join(", ")}. ` +
          `A missing column throws in handling_ae_state_req and kills the peer's ENTIRE ` +
          `anti-entropy round — every Tier-A table stops replicating, not just this one.`,
      ).toEqual([]);
    },
  );
});
