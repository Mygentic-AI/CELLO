/**
 * Record hash — the bridge from a table row's canonical fields to the content address the
 * anti-entropy reconciliation core keys on (M12 DOD-AE-APPEND-1; M12-ANTI-ENTROPY-DESIGN §2).
 *
 * A record hash = SHA-256 over the domain-separated, canonical bytes of `{domain, table, fields}`:
 *  - **Domain separation** (`RECORD_HASH_DOMAIN`) keeps AE record hashes from ever colliding with
 *    any other SHA-256 use in the system, matching the project's domain-separation ethos.
 *  - **Table separation**: the table name is inside the hashed bytes, so identical field values in
 *    two different tables produce different hashes — a `signal_hash` reused as an `agent_id` can
 *    never alias.
 *  - **Canonical (sorted-key) serialization** makes two nodes compute the SAME hash for the same
 *    logical record regardless of column/field order — the whole point of a content address.
 *
 * The caller supplies only the STABLE, cross-node-identical columns of a row — never local-only
 * columns (BIGSERIAL `id`, table-wide `chain_hash`) which fork under multi-master. Binary columns
 * are passed as hex/base64 strings by the per-table encoder (a later unit); this primitive takes
 * JSON-canonicalizable scalars.
 */

import { createHash } from "node:crypto";

/** Domain tag for AE record hashes. Bump the version only on a deliberate hash-format change. */
export const RECORD_HASH_DOMAIN = "cello-ae-record-v1";

/**
 * A field value that participates in a record hash.
 *
 * **No `number`** — deliberately. A JS `number` silently loses precision above 2^53, so two
 * DIFFERENT BIGINT/NUMERIC column values (e.g. `9007199254740992` and `…993`) would collapse to
 * one content address and one would never converge — silent data loss. The encoder passes ALL
 * numerics as strings (`pg` already returns BIGINT as a string for exactly this reason), which
 * also removes the `NaN`/`Infinity` → `null` collapse. Booleans and null are precision-safe.
 */
export type CanonicalValue = string | boolean | null;

/**
 * JSON.stringify replacer that sorts object keys lexicographically at every level, so the
 * serialization is independent of insertion order (same shape as the manifest canonicalization).
 */
function sortedReplacer(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[k] = (value as Record<string, unknown>)[k];
    }
    return sorted;
  }
  // NFC-normalize every string so two nodes that ingested the same logical text in different
  // Unicode forms (NFC vs NFD — Postgres does not normalize on store) compute the SAME hash and
  // converge, instead of re-exchanging that record forever. Centralized here so no per-table
  // encoder can forget it.
  if (typeof value === "string") {
    return value.normalize("NFC");
  }
  return value;
}

/**
 * Content address for one append-only record.
 *
 * @param table the logical table name (domain-separates records across tables)
 * @param fields the stable, cross-node-identical columns of the row (never local-only id/chain_hash)
 * @returns SHA-256 hex (64 lowercase hex) — directly consumable by set-reconciliation
 */
export function recordHash(table: string, fields: Record<string, CanonicalValue>): string {
  // JSON.stringify emits number/string/boolean/null distinctly (1 vs "1" vs true vs null), so
  // value-type confusion cannot collapse two different records to one hash. Keys sorted at every
  // level via sortedReplacer → order-independent canonical bytes.
  const canonical = JSON.stringify({ d: RECORD_HASH_DOMAIN, t: table, f: fields }, sortedReplacer);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
