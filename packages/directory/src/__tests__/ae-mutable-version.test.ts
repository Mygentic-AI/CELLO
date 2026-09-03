/**
 * DOD-AE-MUTABLE-1 — Tier-B version summaries.
 *
 * Tier-A append-only sync detects MISSING records (a key one side lacks). Tier-B tables are
 * mutable, so both sides may hold the same KEY with different CONTENT — reconciliation must also
 * detect a CHANGE. Per M12-ANTI-ENTROPY-DESIGN §3 step 4, each mutable row gets a version hash
 * SHA-256(key ‖ merge-relevant columns); differing version hashes for a shared key trigger a
 * pull-by-key, then the merge (§4 for suspensions, LWW for presence) resolves it. This module
 * produces {key, versionHash} for the mutable tables.
 */

import { describe, it, expect } from "vitest";
import {
  encodeTierBVersion,
  TIER_B_SPECS,
  SUSPENSION_VERSION_SPEC,
  PRESENCE_VERSION_SPEC,
  DIRECTORY_NODE_HEARTBEAT_VERSION_SPEC,
} from "../ae-mutable-version.js";
import { SUSPENSION_MERGE_COLUMNS } from "../suspension-merge.js";
import { PRESENCE_MERGE_COLUMNS } from "../presence-merge.js";
import { DIRECTORY_NODE_HEARTBEAT_MERGE_COLUMNS } from "../directory-node-heartbeat-merge.js";

describe("DOD-AE-MUTABLE-1: Tier-B version summaries", () => {
  const suspRow = {
    agent_id: "agent-1", paused: "true", burned: "false", reason: "compromise",
    authorized_by_account: "acct-1", suspension_seq: "3", origin_node: "gcp-usc1",
    updated_at: "2026-07-28T10:00:00Z", // wall-clock — must NOT be in the version (matches §4)
  };

  it("produces a key + 64-hex version hash", () => {
    const { key, versionHash } = encodeTierBVersion(SUSPENSION_VERSION_SPEC, suspRow);
    expect(key).toBe("agent-1");
    expect(versionHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("a change to ANY merge-relevant column changes the version hash (detects a mutation)", () => {
    const base = encodeTierBVersion(SUSPENSION_VERSION_SPEC, suspRow).versionHash;
    for (const col of SUSPENSION_VERSION_SPEC.versionColumns) {
      const mutated = { ...suspRow, [col]: String(suspRow[col as keyof typeof suspRow]) + "_x" };
      expect(encodeTierBVersion(SUSPENSION_VERSION_SPEC, mutated).versionHash, `${col} must move the version`).not.toBe(base);
    }
  });

  it("suspension version EXCLUDES wall-clock updated_at (matches the §4 merge — skew must not move it)", () => {
    const base = encodeTierBVersion(SUSPENSION_VERSION_SPEC, suspRow).versionHash;
    const skewed = encodeTierBVersion(SUSPENSION_VERSION_SPEC, { ...suspRow, updated_at: "1999-01-01T00:00:00Z" }).versionHash;
    expect(skewed).toBe(base); // clock skew alone never changes the version → never a spurious pull
  });

  it("presence version INCLUDES updated_at (LWW is wall-clock, matches the presence merge)", () => {
    const row = { k_local_pubkey: "aa".repeat(32), online: "true", owning_node_id: "n1", last_seen_at: "100", updated_at: "100" };
    const base = encodeTierBVersion(PRESENCE_VERSION_SPEC, row).versionHash;
    expect(encodeTierBVersion(PRESENCE_VERSION_SPEC, { ...row, updated_at: "200" }).versionHash).not.toBe(base);
    expect(encodeTierBVersion(PRESENCE_VERSION_SPEC, { ...row, owning_node_id: "n2" }).versionHash).not.toBe(base);
  });

  it("same content, any field order → same version hash (two nodes agree)", () => {
    const a = encodeTierBVersion(SUSPENSION_VERSION_SPEC, suspRow).versionHash;
    const reordered: typeof suspRow = { origin_node: "gcp-usc1", suspension_seq: "3", burned: "false", paused: "true", agent_id: "agent-1", reason: "compromise", authorized_by_account: "acct-1", updated_at: "2026-07-28T10:00:00Z" };
    expect(encodeTierBVersion(SUSPENSION_VERSION_SPEC, reordered).versionHash).toBe(a);
  });

  it("the version hash is table-separated (suspension vs presence never collide)", () => {
    // Even with contrived identical field values, the table name domain-separates.
    const s = encodeTierBVersion(SUSPENSION_VERSION_SPEC, suspRow).versionHash;
    const p = encodeTierBVersion(PRESENCE_VERSION_SPEC, { k_local_pubkey: "agent-1", online: "true", owning_node_id: "x", last_seen_at: "1", updated_at: "1" }).versionHash;
    expect(s).not.toBe(p);
  });

  it("every registered Tier-B spec keys on a column present in its versionColumns", () => {
    for (const spec of TIER_B_SPECS) {
      for (const k of spec.key) expect(spec.versionColumns).toContain(k);
    }
  });

  /**
   * table → the columns that table's MERGE module declares it consults. Driven off TIER_B_SPECS
   * below rather than asserted table-by-table: a hand-listed pair per table is a fact about when
   * someone last looked, and the failure it misses (a NEW Tier-B table whose spec nobody compared to
   * its merge) is the one that produces permanent silent divergence.
   */
  const MERGE_COLUMNS_BY_TABLE: ReadonlyMap<string, readonly string[]> = new Map([
    ["agent_suspensions", SUSPENSION_MERGE_COLUMNS],
    ["agent_presence", PRESENCE_MERGE_COLUMNS],
    ["directory_nodes", DIRECTORY_NODE_HEARTBEAT_MERGE_COLUMNS],
  ]);

  it("directory_nodes' heartbeat spec is REGISTERED in TIER_B_SPECS, not merely written", () => {
    // A spec that exists but is not in this list is never advertised, so a peer never learns we hold
    // the table and no pull is ever planned — replication silently does not happen, with every unit
    // test on the spec itself still green.
    expect(TIER_B_SPECS).toContain(DIRECTORY_NODE_HEARTBEAT_VERSION_SPEC);
  });

  it("every registered Tier-B spec declares its merge columns (a new table cannot skip the check)", () => {
    // Without this, adding a spec to TIER_B_SPECS and forgetting the merge registry would leave the
    // equality test below iterating over a table it never sees — green, and proving nothing.
    for (const spec of TIER_B_SPECS) {
      expect(
        MERGE_COLUMNS_BY_TABLE.has(spec.table),
        `Tier-B table '${spec.table}' has no entry in MERGE_COLUMNS_BY_TABLE — its versionColumns are unchecked against its merge`,
      ).toBe(true);
    }
  });

  it("versionColumns EQUALS the merge-consulted set, for every registered Tier-B table", () => {
    // Both directions are load-bearing and they fail differently:
    //  - a column the MERGE reads but the version hash OMITS → two nodes hold rows the merge would
    //    resolve differently while their version hashes agree, so no pull ever fires and the
    //    divergence is permanent;
    //  - a column in the version hash the merge IGNORES → the hash moves on a value that changes no
    //    outcome, so nodes pull each other forever over rows that are already converged.
    for (const spec of TIER_B_SPECS) {
      const mergeCols = MERGE_COLUMNS_BY_TABLE.get(spec.table);
      expect(mergeCols, `no merge columns registered for '${spec.table}'`).toBeDefined();
      expect(
        [...spec.versionColumns].sort(),
        `versionColumns and merge columns disagree for '${spec.table}'`,
      ).toEqual([...mergeCols!].sort());
    }
  });

  it("normalizes representation — boolean, Date, and their string forms hash identically", () => {
    // paused/burned/online are BOOLEAN (pg → JS boolean); last_seen_at/updated_at are TIMESTAMPTZ
    // (pg → JS Date). Two nodes on different drivers/casts must still agree. Was a silent-divergence
    // bug before normalization.
    const boolRow = { agent_id: "a", paused: true, burned: false, reason: null, authorized_by_account: null, suspension_seq: "1", origin_node: "n1" };
    const strRow = { ...boolRow, paused: "true", burned: "false" };
    expect(encodeTierBVersion(SUSPENSION_VERSION_SPEC, boolRow).versionHash)
      .toBe(encodeTierBVersion(SUSPENSION_VERSION_SPEC, strRow).versionHash);

    const ms = 1785200000000;
    const dateRow = { k_local_pubkey: "aa", online: true, owning_node_id: "n1", last_seen_at: new Date(ms), updated_at: new Date(ms) };
    const strTsRow = { k_local_pubkey: "aa", online: "true", owning_node_id: "n1", last_seen_at: String(ms), updated_at: String(ms) };
    expect(encodeTierBVersion(PRESENCE_VERSION_SPEC, dateRow).versionHash)
      .toBe(encodeTierBVersion(PRESENCE_VERSION_SPEC, strTsRow).versionHash);
  });
});
