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
  USER_ACCOUNTS_SPEC,
  SEAL_NOTARIZATIONS_SPEC,
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

  it("user_accounts: keyed on account_id; EXCLUDES the backfilled email_stub_hash (mutable → Tier B)", () => {
    const row = {
      id: "7",
      account_id: "uuid-1",
      phone_stub_hash: "ph".repeat(16),
      email_stub_hash: null, // absent at INSERT
      created_at: "2026-07-28T10:00:00Z",
      chain_hash: "cc".repeat(16),
    };
    const { key, hash } = encodeTierARecord(USER_ACCOUNTS_SPEC, row);
    expect(key).toBe("uuid-1");
    // Backfilling email_stub_hash later must NOT change the append-only hash (it rides Tier B):
    expect(encodeTierARecord(USER_ACCOUNTS_SPEC, { ...row, email_stub_hash: "ee".repeat(16) }).hash).toBe(hash);
    // ...nor do the local columns:
    expect(encodeTierARecord(USER_ACCOUNTS_SPEC, { ...row, id: "99", chain_hash: "ff".repeat(16), created_at: "2020-01-01T00:00:00Z" }).hash).toBe(hash);
    // ...but phone_stub_hash (immutable identity) does:
    expect(encodeTierARecord(USER_ACCOUNTS_SPEC, { ...row, phone_stub_hash: "00".repeat(16) }).hash).not.toBe(hash);
  });

  it("seal_notarizations: composite key; EXCLUDES supersedes_notarization_id (local FK) + correlation_id", () => {
    const row = {
      id: "12",
      session_id: "aa".repeat(32), // BYTEA hex
      seal_type: "bilateral",
      sealed_root: "bb".repeat(32),
      participant_a_pubkey: "cc".repeat(32),
      participant_b_pubkey: "dd".repeat(32),
      close_timestamp: "1785200000000",
      frost_signature: "ee".repeat(64),
      supersedes_notarization_id: "5", // BIGINT FK to another row's LOCAL id — forks across nodes
      correlation_id: "flow-abc", // per-flow debug id
      chain_hash: "ff".repeat(16),
      created_at: "2026-07-28T10:00:00Z",
    };
    const { key, hash } = encodeTierARecord(SEAL_NOTARIZATIONS_SPEC, row);
    expect(key).toBe(`${"aa".repeat(32)}\u0000bilateral`); // NUL-joined composite key
    // The local FK, correlation_id, and local columns must NOT change the hash (convergence):
    const otherNode = encodeTierARecord(SEAL_NOTARIZATIONS_SPEC, {
      ...row,
      id: "999",
      supersedes_notarization_id: "8888", // different local FK on the other node
      correlation_id: "flow-xyz",
      chain_hash: "11".repeat(16),
      created_at: "2020-01-01T00:00:00Z",
    }).hash;
    expect(otherNode).toBe(hash);
    // A real content column (frost_signature) does change it:
    expect(encodeTierARecord(SEAL_NOTARIZATIONS_SPEC, { ...row, frost_signature: "00".repeat(64) }).hash).not.toBe(hash);
  });

  it("EVERY hashed column of user_accounts + seal_notarizations is reflected in the hash", () => {
    // Full-column sweep (matches the part-3 specs) so dropping ANY immutable column from either
    // new spec — which would silently converge two nodes differing in that column — fails here.
    const uaRow = { account_id: "uuid-1", phone_stub_hash: "ph".repeat(16) };
    const uaBase = encodeTierARecord(USER_ACCOUNTS_SPEC, uaRow).hash;
    for (const col of USER_ACCOUNTS_SPEC.immutableColumns) {
      const mutated = { ...uaRow, [col]: String(uaRow[col as keyof typeof uaRow]) + "_x" };
      expect(encodeTierARecord(USER_ACCOUNTS_SPEC, mutated).hash, `ua.${col} must change the hash`).not.toBe(uaBase);
    }
    const snRow = {
      session_id: "aa".repeat(32), seal_type: "bilateral", sealed_root: "bb".repeat(32),
      participant_a_pubkey: "cc".repeat(32), participant_b_pubkey: "dd".repeat(32),
      close_timestamp: "1785200000000", frost_signature: "ee".repeat(64),
    };
    const snBase = encodeTierARecord(SEAL_NOTARIZATIONS_SPEC, snRow).hash;
    for (const col of SEAL_NOTARIZATIONS_SPEC.immutableColumns) {
      const mutated = { ...snRow, [col]: String(snRow[col as keyof typeof snRow]) + "_x" };
      expect(encodeTierARecord(SEAL_NOTARIZATIONS_SPEC, mutated).hash, `sn.${col} must change the hash`).not.toBe(snBase);
    }
  });

  it("no spec's immutable column set contains a known local/forking column", () => {
    // Local/mutable columns that must NEVER appear in any spec's hashed set: local surrogate/audit
    // columns, per-flow ids, local FKs, and known-backfilled columns (all fork or ride Tier B).
    const FORBIDDEN = new Set([
      "id", "chain_hash", "created_at",
      "supersedes_notarization_id", "correlation_id", "email_stub_hash", "account_id_backfill",
    ]);
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
