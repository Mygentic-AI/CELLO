/**
 * Tier-B version summaries for anti-entropy mutable-table sync (M12 DOD-AE-MUTABLE-1;
 * M12-ANTI-ENTROPY-DESIGN §3 step 4).
 *
 * Tier-A reconciliation detects records one side is MISSING. Tier-B tables are mutable — both
 * nodes can hold the same natural key with different content — so reconciliation must also detect
 * a CHANGE. Each mutable row gets a version hash over (key ‖ merge-relevant columns); when two
 * nodes hold a shared key with differing version hashes, the reconciler pulls that key and the
 * table's merge resolves it (suspension-merge.ts §4 / presence-merge.ts LWW).
 *
 * Crucially, `versionColumns` must equal the set of columns each table's MERGE actually consults —
 * otherwise a column that changes the merge result but not the version hash would leave two nodes
 * silently divergent (their version hashes agree, so no pull is ever triggered). In particular:
 *  - agent_suspensions EXCLUDES wall-clock `updated_at` (the §4 merge forbids it as an input), so
 *    clock skew alone never moves the version → never a spurious pull, and — matching the merge —
 *    only paused/burned/reason/authorized_by_account/suspension_seq/origin_node move it.
 *  - agent_presence INCLUDES `updated_at` (its merge is wall-clock LWW), so a newer write is seen.
 *  - directory_nodes INCLUDES `last_heartbeat_at` — that column IS both the value and the LWW
 *    ordering key, so there is no second timestamp to include or exclude. It carries NONE of
 *    `region`/`endpoint`/`status`: region belongs to the same table's Tier-A spec, and the other two
 *    replicate nowhere.
 *
 * Representation normalization (load-bearing — the version hash is compared ACROSS nodes, so it
 * must not depend on how each node's driver typed the value). The mutable tables have columns pg
 * returns as native JS types, NOT strings: `paused`/`burned`/`online` are BOOLEAN (→ JS boolean),
 * `last_seen_at`/`updated_at` are TIMESTAMPTZ (→ JS Date). If one node fed `true` and another
 * `"true"`, or a `Date` vs an epoch string, the version hashes would diverge silently and no pull
 * would ever fire. So this module normalizes at the single chokepoint (like record-hash centralizes
 * NFC): boolean → "true"/"false", Date → epoch-millis string. recordHash still forbids raw
 * `number` (2^53 aliasing); BIGINT already arrives as a string.
 */

import { recordHash, type CanonicalValue } from "./record-hash.js";

/** A raw mutable row as a pg driver yields it — includes native boolean/Date before normalization. */
export type MutableRow = Record<string, CanonicalValue | Date | undefined>;

/** Normalize a raw column value to the canonical CanonicalValue the version hash is computed over. */
function normalize(v: CanonicalValue | Date | undefined): CanonicalValue {
  if (v === undefined) return null;
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v instanceof Date) return String(v.getTime()); // canonical epoch-millis, driver-format-independent
  return v;
}

export interface TierBVersionSpec {
  /** Logical table name (domain-separates the version hash across tables). */
  readonly table: string;
  /** Natural-key columns (⊆ versionColumns). */
  readonly key: readonly string[];
  /** The merge-relevant columns — MUST match what the table's merge consults (see header). */
  readonly versionColumns: readonly string[];
}

/**
 * agent_suspensions — merge-relevant set matches suspension-merge.ts (paused, burned, reason,
 * authorized_by_account, suspension_seq, origin_node) + the agent_id key. `updated_at` is
 * deliberately absent (the §4 merge forbids wall-clock as an input).
 */
export const SUSPENSION_VERSION_SPEC: TierBVersionSpec = {
  table: "agent_suspensions",
  key: ["agent_id"],
  versionColumns: ["agent_id", "paused", "burned", "reason", "authorized_by_account", "suspension_seq", "origin_node"],
};

/**
 * agent_presence — merge-relevant set matches presence-merge.ts (online, owning_node_id,
 * last_seen_at, updated_at) + the k_local_pubkey key. `updated_at` IS included: the merge is
 * wall-clock LWW.
 */
export const PRESENCE_VERSION_SPEC: TierBVersionSpec = {
  table: "agent_presence",
  key: ["k_local_pubkey"],
  versionColumns: ["k_local_pubkey", "online", "owning_node_id", "last_seen_at", "updated_at"],
};

/**
 * directory_nodes — the per-node liveness heartbeat (DOD-M15-HEARTBEAT-1). Merge-relevant set
 * matches directory-node-heartbeat-merge.ts (last_heartbeat_at) + the node_id key.
 * `last_heartbeat_at` IS included: the merge is wall-clock LWW, as presence's is.
 *
 * The same table also has a Tier-A spec, and that is deliberate rather than an oversight. The two
 * tiers carry DISJOINT columns of one row: Tier A owns the immutable identity (`node_id`, `region`)
 * under insert-if-absent, this owns the one mutable column under a merge. Splitting them is what
 * keeps a peer able to move a timestamp but unable to rewrite a node's identity. Nothing collides:
 * the wire advertises `tierA` and `tierB` as separate digest maps and pulls with separate frames,
 * so the shared table NAME is never a shared key.
 */
export const DIRECTORY_NODE_HEARTBEAT_VERSION_SPEC: TierBVersionSpec = {
  table: "directory_nodes",
  key: ["node_id"],
  versionColumns: ["node_id", "last_heartbeat_at"],
};

export const TIER_B_SPECS: readonly TierBVersionSpec[] = [
  SUSPENSION_VERSION_SPEC,
  PRESENCE_VERSION_SPEC,
  DIRECTORY_NODE_HEARTBEAT_VERSION_SPEC,
];

/**
 * The natural key + version hash for one mutable row. A shared key with a differing version hash
 * across two nodes triggers a pull-by-key; the table's merge then resolves the content.
 * Missing/undefined columns are treated as SQL NULL (deterministic across nodes).
 */
export function encodeTierBVersion(spec: TierBVersionSpec, row: MutableRow): { key: string; versionHash: string } {
  const fields: Record<string, CanonicalValue> = {};
  for (const col of spec.versionColumns) {
    fields[col] = normalize(row[col]);
  }
  const versionHash = recordHash(spec.table, fields);
  const key = spec.key.map((k) => String(normalize(row[k]))).join("\u0000");
  return { key, versionHash };
}
