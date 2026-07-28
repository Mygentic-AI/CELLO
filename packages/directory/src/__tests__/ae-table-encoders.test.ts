/**
 * DOD-AE-APPEND-1 — Tier-A per-table record encoders.
 *
 * Each append-only table has a spec: its natural key + the STABLE columns that feed the record
 * hash. The load-bearing property is that node-LOCAL columns (BIGSERIAL `id`, table-wide
 * `chain_hash` which forks under multi-master, `created_at DEFAULT now()` stamped per node) are
 * EXCLUDED — two nodes holding the same logical record but different local columns must compute
 * the SAME record hash, or the pair never converges. Mutable columns (agent_profiles.account_id
 * backfill, .status) are also excluded — they ride the Tier-B version-summary path, not the
 * append-only record hash.
 */

import { describe, it, expect } from "vitest";
import {
  encodeTierARecord,
  TIER_A_SPECS,
  AGENT_PROFILES_SPEC,
  AGENT_REVOCATIONS_SPEC,
} from "../ae-table-encoders.js";

// A plausible agent_profiles row as the query layer yields it (BIGINT as string, per pg).
const profileRow = {
  id: "42", // BIGSERIAL — local, must NOT affect the hash
  k_local_pubkey: "aa".repeat(32),
  primary_pubkey: "bb".repeat(32),
  ml_dsa_pubkey: "cc".repeat(16),
  phone_stub_hash: "dd".repeat(32),
  registered_at: "1785200000000",
  status: "active",
  account_id: "acct-123",
  created_at: "2026-07-28T10:00:00Z", // per-node now() — must NOT affect the hash
  chain_hash: "ee".repeat(32), // forks under multi-master — must NOT affect the hash
};

describe("DOD-AE-APPEND-1: Tier-A table encoders", () => {
  it("encodes a stable natural key and a 64-hex record hash", () => {
    const { key, hash } = encodeTierARecord(AGENT_PROFILES_SPEC, profileRow);
    expect(key).toBe(profileRow.k_local_pubkey);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("LOCAL columns (id, chain_hash, created_at) do NOT change the hash — convergence guarantee", () => {
    const base = encodeTierARecord(AGENT_PROFILES_SPEC, profileRow).hash;
    const otherNode = encodeTierARecord(AGENT_PROFILES_SPEC, {
      ...profileRow,
      id: "999", // different BIGSERIAL on the other node
      chain_hash: "ff".repeat(32), // different local chain
      created_at: "2026-01-01T00:00:00Z", // different per-node stamp
    }).hash;
    expect(otherNode).toBe(base); // same logical record → same hash despite local differences
  });

  it("MUTABLE columns (account_id, status) do NOT change the append-only hash — they ride Tier B", () => {
    const base = encodeTierARecord(AGENT_PROFILES_SPEC, profileRow).hash;
    const mutated = encodeTierARecord(AGENT_PROFILES_SPEC, {
      ...profileRow,
      account_id: "acct-999", // backfilled later → Tier-B version summary, not the record hash
      status: "retired",
    }).hash;
    expect(mutated).toBe(base);
  });

  it("EVERY hashed column change changes the hash — a dropped immutable column would be caught", () => {
    // Parametrized over all of AGENT_PROFILES_SPEC.immutableColumns so dropping ANY of them from
    // the spec (which would silently converge two nodes differing in that column) fails here.
    const base = encodeTierARecord(AGENT_PROFILES_SPEC, profileRow).hash;
    for (const col of AGENT_PROFILES_SPEC.immutableColumns) {
      const mutated = { ...profileRow, [col]: (profileRow[col as keyof typeof profileRow] ?? "x") + "_changed" };
      expect(encodeTierARecord(AGENT_PROFILES_SPEC, mutated).hash, `flipping ${col} must change the hash`).not.toBe(base);
    }
  });

  it("EVERY hashed column of agent_revocations is reflected in the hash", () => {
    const revRow = { agent_id: "a", epoch_id: "e", reason: "r", signature: "00", revoked_at: "1" };
    const base = encodeTierARecord(AGENT_REVOCATIONS_SPEC, revRow).hash;
    for (const col of AGENT_REVOCATIONS_SPEC.immutableColumns) {
      const mutated = { ...revRow, [col]: String(revRow[col as keyof typeof revRow]) + "_changed" };
      expect(encodeTierARecord(AGENT_REVOCATIONS_SPEC, mutated).hash, `flipping ${col} must change the hash`).not.toBe(base);
    }
  });

  it("agent_revocations: tombstone encodes on agent_id, excludes created_at", () => {
    const revRow = {
      agent_id: "agent-x",
      epoch_id: "e1",
      reason: "compromise",
      signature: "ab".repeat(64), // BYTEA — the consumer hex-encodes it before this call (pg returns a Buffer)
      revoked_at: "1785200000000",
      created_at: "2026-07-28T10:00:00Z", // per-node — excluded
    };
    const { key, hash } = encodeTierARecord(AGENT_REVOCATIONS_SPEC, revRow);
    expect(key).toBe("agent-x");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    // created_at excluded:
    expect(encodeTierARecord(AGENT_REVOCATIONS_SPEC, { ...revRow, created_at: "2020-01-01T00:00:00Z" }).hash).toBe(hash);
  });

  it("no spec's immutable column set contains a known local/forking column", () => {
    const FORBIDDEN = new Set(["id", "chain_hash", "created_at"]);
    for (const spec of TIER_A_SPECS) {
      for (const col of spec.immutableColumns) {
        expect(FORBIDDEN.has(col), `${spec.table}.${col} is a local column and must not be hashed`).toBe(false);
      }
      // natural key columns must themselves be immutable (stable identity)
      for (const k of spec.naturalKey) {
        expect(spec.immutableColumns).toContain(k);
      }
    }
  });

  it("a missing immutable column is treated as null, not silently skipped (stable across nodes)", () => {
    const withUndef = encodeTierARecord(AGENT_REVOCATIONS_SPEC, {
      agent_id: "a", epoch_id: "e", reason: undefined as unknown as string, signature: "00", revoked_at: "1",
    });
    const withNull = encodeTierARecord(AGENT_REVOCATIONS_SPEC, {
      agent_id: "a", epoch_id: "e", reason: null, signature: "00", revoked_at: "1",
    });
    expect(withUndef.hash).toBe(withNull.hash); // undefined ≡ null → NULL column, deterministic
  });
});
