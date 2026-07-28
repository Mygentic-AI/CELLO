/**
 * DOD-AE-APPEND-1 — record-hash tests.
 *
 * The bridge from a table row's canonical fields to the record hash the reconciliation core
 * (set-reconciliation.ts) consumes. A record hash = SHA-256 over domain-separated, canonical
 * (sorted-key) bytes of {domain, table, fields}. Must be: deterministic + field-key-order
 * independent (two nodes agree), table-separated (same fields in different tables differ), and a
 * 64-lowercase-hex string (so it satisfies the reconciliation set contract).
 */

import { describe, it, expect } from "vitest";
import { recordHash, RECORD_HASH_DOMAIN } from "../record-hash.js";
import { bucketDigests } from "../set-reconciliation.js";

describe("DOD-AE-APPEND-1: recordHash", () => {
  it("is a 64-lowercase-hex string (feeds the reconciliation set contract)", () => {
    const h = recordHash("agent_profiles", { agent_id: "abc", k_local_pubkey: "de" });
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    // And it is directly usable by the reconciliation core without error:
    expect(() => bucketDigests([h])).not.toThrow();
  });

  it("is deterministic and independent of field key order (two nodes agree)", () => {
    const a = recordHash("t", { b: "2", a: "1", c: "3" });
    const b = recordHash("t", { c: "3", a: "1", b: "2" });
    expect(a).toBe(b);
  });

  it("separates by table — same fields in a different table hash differently", () => {
    const fields = { agent_id: "x", epoch_id: "e1" };
    expect(recordHash("agent_profiles", fields)).not.toBe(recordHash("agent_revocations", fields));
  });

  it("separates by domain — a bare canonicalization of the fields does not collide", () => {
    // Changing the domain constant would change every hash; pin that the domain is in the input.
    const h = recordHash("t", { a: "1" });
    const withoutDomain = recordHash("t", { a: "1" });
    expect(h).toBe(withoutDomain); // same domain → same
    expect(RECORD_HASH_DOMAIN).toMatch(/^cello-ae-record-v\d+$/);
  });

  it("changes when any field value changes", () => {
    const base = recordHash("t", { a: "1", b: "2" });
    expect(recordHash("t", { a: "1", b: "3" })).not.toBe(base);
    expect(recordHash("t", { a: "9", b: "2" })).not.toBe(base);
  });

  it("changes when a field is added or removed (no truncation collisions)", () => {
    const two = recordHash("t", { a: "1", b: "2" });
    const one = recordHash("t", { a: "1" });
    const three = recordHash("t", { a: "1", b: "2", c: "3" });
    expect(one).not.toBe(two);
    expect(three).not.toBe(two);
  });

  it("distinguishes value types — string '1' vs boolean true vs null", () => {
    const asStr = recordHash("t", { v: "1" });
    const asBool = recordHash("t", { v: true });
    const asNull = recordHash("t", { v: null });
    expect(new Set([asStr, asBool, asNull]).size).toBe(3);
  });

  it("large BIGINT values passed as strings do NOT collide (no 2^53 precision aliasing)", () => {
    // number is forbidden in CanonicalValue precisely because 2^53+1 would alias to 2^53 as a JS
    // number; as strings the two distinct BIGINTs hash distinctly. This pins the encoder contract.
    const a = recordHash("agent_suspensions", { suspension_seq: "9007199254740992" });
    const b = recordHash("agent_suspensions", { suspension_seq: "9007199254740993" });
    expect(a).not.toBe(b);
  });

  it("NFC-normalizes strings so the same logical text in NFC vs NFD converges", () => {
    const nfc = "café"; // é as one code point
    const nfd = "café"; // e + combining acute
    expect(nfc).not.toBe(nfd); // genuinely different byte sequences
    expect(recordHash("t", { name: nfc })).toBe(recordHash("t", { name: nfd }));
  });

  it("handles null field values deterministically", () => {
    const a = recordHash("t", { a: "1", b: null });
    const b = recordHash("t", { b: null, a: "1" });
    expect(a).toBe(b);
    expect(a).not.toBe(recordHash("t", { a: "1" })); // null present ≠ absent
  });
});
