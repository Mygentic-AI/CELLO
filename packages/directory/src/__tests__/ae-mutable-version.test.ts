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
} from "../ae-mutable-version.js";
import { SUSPENSION_MERGE_COLUMNS } from "../suspension-merge.js";
import { PRESENCE_MERGE_COLUMNS } from "../presence-merge.js";

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

  it("versionColumns ⊇ the merge-consulted set (the load-bearing direction)", () => {
    // Guards the real invariant: a column the MERGE reads but the version hash omits would leave
    // two nodes silently divergent. Asserts against the columns each merge module declares it uses,
    // so adding a field to a merge without adding it to versionColumns fails here.
    for (const c of SUSPENSION_MERGE_COLUMNS) expect(SUSPENSION_VERSION_SPEC.versionColumns).toContain(c);
    for (const c of PRESENCE_MERGE_COLUMNS) expect(PRESENCE_VERSION_SPEC.versionColumns).toContain(c);
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
