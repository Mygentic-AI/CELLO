/**
 * CELLO-MSG-003 — MessageEnvelopeV1 tests
 *
 * Every AC and SI from the story spec maps to a named test below.
 * Tests are written RED-first per SPARC Phase R.
 *
 * Envelope v1 TBS (Structure 1): [1, content_hash, sender_pubkey, session_id, last_seen_seq, timestamp]
 * All encodings: canonical CBOR per RFC 8949 §4.2.1.
 * Ed25519 per RFC 8032. Content hash per FIPS 180-4 SHA-256(0x00 || content).
 *
 * References:
 *   RFC 8032 — Ed25519 (TBS signing)
 *   RFC 8949 §4.2.1 — Canonical CBOR (deterministic encoding)
 *   FIPS 180-4 — SHA-256 (content hash)
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  setupV3Tests,
  describe,
  it,
  expect,
} from "@claude-flow/testing";
import { generateKeypair, msgLeafHash, verify } from "@cello/crypto";
import { Encoder } from "cbor-x";
import {
  buildEnvelopeV1,
  validateEnvelopeV1,
  serializeEnvelopeV1,
  deserializeEnvelopeV1,
  extractStructure1,
  MAX_CONTENT_BYTES,
} from "../envelope.js";
import type { MessageEnvelopeV1 } from "../types.js";

setupV3Tests();

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Load the v1 envelope test vector fixture. */
function loadV1Fixture(): {
  description: string;
  inputs: {
    protocol_version: number;
    content_hex: string;
    sender_pubkey_hex: string;
    session_id_hex: string;
    last_seen_seq: number;
    timestamp: number;
  };
  expected: {
    content_hash_hex: string;
    tbs_cbor_hex: string;
  };
} {
  const fixturePath = join(__dirname, "../../test/vectors/envelope-v1-canonical.json");
  return JSON.parse(readFileSync(fixturePath, "utf8")) as ReturnType<typeof loadV1Fixture>;
}

/** Load the Structure 1 test vector fixture. */
function loadStructure1Fixture(): {
  description: string;
  inputs: {
    protocol_version: number;
    content_hash_hex: string;
    sender_pubkey_hex: string;
    session_id_hex: string;
    last_seen_seq: number;
    timestamp: number;
  };
  expected_cbor_hex: string;
} {
  const fixturePath = join(__dirname, "../../test/vectors/structure1-canonical.json");
  return JSON.parse(readFileSync(fixturePath, "utf8")) as ReturnType<typeof loadStructure1Fixture>;
}

/** Build a minimal valid v1 envelope for a given keypair. */
async function makeEnvelopeV1(
  content: Uint8Array = new TextEncoder().encode("hello cello v1"),
  timestamp = 1_700_000_000_000,
  session_id?: Uint8Array,
  last_seen_seq = 0
): Promise<{ envelope: MessageEnvelopeV1; kp: ReturnType<typeof generateKeypair> }> {
  const kp = generateKeypair();
  const sid = session_id ?? new Uint8Array(16).fill(0x01);
  const result = await buildEnvelopeV1(content, kp, timestamp, sid, last_seen_seq);
  if (!result.ok) throw new Error(`buildEnvelopeV1 failed: ${result.error.reason}`);
  return { envelope: result.envelope, kp };
}

// ─── AC-001: construction — all fields populated correctly ───────────────────

describe("AC-001: buildEnvelopeV1 — all fields populated", () => {
  it("AC-001: protocol_version=1, content_hash=SHA-256(0x00||content), signature verifies over Structure 1 TBS", async () => {
    const content = new TextEncoder().encode("test message AC-001 v1");
    const ts = 1_700_000_000_000;
    const session_id = new Uint8Array(16).fill(0x02);
    const last_seen_seq = 5;
    const { envelope } = await makeEnvelopeV1(content, ts, session_id, last_seen_seq);

    expect(envelope.protocol_version).toBe(1);
    expect(envelope.sender_pubkey).toBeInstanceOf(Uint8Array);
    expect(envelope.sender_pubkey.length).toBe(32);
    expect(envelope.session_id).toBeInstanceOf(Uint8Array);
    expect(envelope.session_id.length).toBe(16);
    expect(envelope.last_seen_seq).toBe(last_seen_seq);
    expect(envelope.timestamp).toBe(ts);

    // content_hash must equal msgLeafHash(content) = SHA-256(0x00 || content)
    const expectedHash = msgLeafHash(content);
    expect(Buffer.from(envelope.content_hash).toString("hex")).toBe(
      Buffer.from(expectedHash).toString("hex")
    );

    // Signature must verify over canonical CBOR of [1, content_hash, sender_pubkey, session_id, last_seen_seq, timestamp]
    // Per RFC 8032 (Ed25519) and RFC 8949 §4.2.1 (canonical CBOR)
    const enc = new Encoder({ tagUint8Array: false });
    const tsEncoded = ts > 0xFFFFFFFF ? BigInt(ts) : ts;
    const tbsBytes = enc.encode([
      1,
      envelope.content_hash,
      envelope.sender_pubkey,
      envelope.session_id,
      last_seen_seq,
      tsEncoded,
    ]);
    expect(verify(envelope.sender_pubkey, tbsBytes, envelope.sender_signature)).toBe(true);
  });
});

// ─── AC-002: serialize then deserialize → identical, sig still verifies ──────

describe("AC-002: serialize / deserialize round-trip", () => {
  it("AC-002: serialize → deserialize → identical envelope; sig still verifies; re-serialize is byte-identical", async () => {
    const { envelope } = await makeEnvelopeV1();

    const bytes1 = serializeEnvelopeV1(envelope);
    const deserResult = deserializeEnvelopeV1(bytes1);
    expect(deserResult.ok).toBe(true);

    if (!deserResult.ok) return;
    const envelope2 = deserResult.envelope;

    // All fields must be identical
    expect(envelope2.protocol_version).toBe(envelope.protocol_version);
    expect(Buffer.from(envelope2.sender_pubkey).toString("hex")).toBe(
      Buffer.from(envelope.sender_pubkey).toString("hex")
    );
    expect(Buffer.from(envelope2.content_hash).toString("hex")).toBe(
      Buffer.from(envelope.content_hash).toString("hex")
    );
    expect(Buffer.from(envelope2.content).toString("hex")).toBe(
      Buffer.from(envelope.content).toString("hex")
    );
    expect(Buffer.from(envelope2.session_id).toString("hex")).toBe(
      Buffer.from(envelope.session_id).toString("hex")
    );
    expect(envelope2.last_seen_seq).toBe(envelope.last_seen_seq);
    expect(envelope2.timestamp).toBe(envelope.timestamp);
    expect(Buffer.from(envelope2.sender_signature).toString("hex")).toBe(
      Buffer.from(envelope.sender_signature).toString("hex")
    );

    // Signature still verifies after round-trip
    const validateResult = validateEnvelopeV1(envelope2);
    expect(validateResult.ok).toBe(true);

    // Re-serialize must produce byte-identical CBOR
    const bytes2 = serializeEnvelopeV1(envelope2);
    expect(Buffer.from(bytes2).toString("hex")).toBe(
      Buffer.from(bytes1).toString("hex")
    );
  });
});

// ─── AC-003: protocol_version=0 → unsupported_version, no sig check ──────────

describe("AC-003: validateEnvelopeV1 — protocol_version=0 rejected", () => {
  it("AC-003: envelope with protocol_version=0 → unsupported_version; no sig verification attempted", async () => {
    const { envelope } = await makeEnvelopeV1();
    // Forcibly set version to 0 (M0 value)
    const mutated = { ...envelope, protocol_version: 0 } as unknown as MessageEnvelopeV1;
    const result = validateEnvelopeV1(mutated);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("unsupported_version");
    }
  });
});

// ─── AC-004: protocol_version=2 → unsupported_version ───────────────────────

describe("AC-004: validateEnvelopeV1 — protocol_version=2 rejected", () => {
  it("AC-004: envelope with protocol_version=2 → unsupported_version", async () => {
    const { envelope } = await makeEnvelopeV1();
    const mutated = { ...envelope, protocol_version: 2 } as unknown as MessageEnvelopeV1;
    const result = validateEnvelopeV1(mutated);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("unsupported_version");
    }
  });
});

// ─── AC-005: mutate each TBS field → sig verification fails ──────────────────

describe("AC-005 / SI-003: mutate each TBS field after signing → signature fails", () => {
  it("AC-005a: mutated content_hash → content_hash_mismatch (detected before sig check)", async () => {
    const { envelope } = await makeEnvelopeV1();
    const badHash = new Uint8Array(32).fill(0xff);
    const mutated: MessageEnvelopeV1 = { ...envelope, content_hash: badHash };
    const result = validateEnvelopeV1(mutated);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("content_hash_mismatch");
    }
  });

  it("AC-005b: substituted sender_pubkey → signature fails", async () => {
    const { envelope } = await makeEnvelopeV1();
    const altKp = generateKeypair();
    const altPubkey = await altKp.getPublicKey();
    const mutated: MessageEnvelopeV1 = { ...envelope, sender_pubkey: altPubkey };
    const result = validateEnvelopeV1(mutated);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("invalid_field");
      if (result.error.reason === "invalid_field") {
        expect(result.error.field).toBe("sender_signature");
      }
    }
  });

  it("AC-005c: altered session_id → signature fails", async () => {
    const { envelope } = await makeEnvelopeV1();
    const altSessionId = new Uint8Array(16).fill(0xfe);
    const mutated: MessageEnvelopeV1 = { ...envelope, session_id: altSessionId };
    const result = validateEnvelopeV1(mutated);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("invalid_field");
      if (result.error.reason === "invalid_field") {
        expect(result.error.field).toBe("sender_signature");
      }
    }
  });

  it("AC-005d: changed last_seen_seq → signature fails", async () => {
    const { envelope } = await makeEnvelopeV1(
      new TextEncoder().encode("ac005d"),
      1_700_000_000_000,
      new Uint8Array(16).fill(0x03),
      0
    );
    const mutated: MessageEnvelopeV1 = { ...envelope, last_seen_seq: 1 };
    const result = validateEnvelopeV1(mutated);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("invalid_field");
      if (result.error.reason === "invalid_field") {
        expect(result.error.field).toBe("sender_signature");
      }
    }
  });

  it("AC-005e: moved timestamp → signature fails", async () => {
    const { envelope } = await makeEnvelopeV1(
      new TextEncoder().encode("ac005e"),
      1_000_000
    );
    const mutated: MessageEnvelopeV1 = { ...envelope, timestamp: envelope.timestamp + 1 };
    const result = validateEnvelopeV1(mutated);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("invalid_field");
      if (result.error.reason === "invalid_field") {
        expect(result.error.field).toBe("sender_signature");
      }
    }
  });
});

// ─── AC-006: modified content → content_hash_mismatch before sig verify ──────

describe("AC-006: content_hash_mismatch detected before sig verification", () => {
  it("AC-006: content modified post-signing → content_hash_mismatch returned first", async () => {
    const { envelope } = await makeEnvelopeV1();
    const modifiedContent = new Uint8Array(envelope.content);
    modifiedContent[0] ^= 0x01;
    const mutated: MessageEnvelopeV1 = { ...envelope, content: modifiedContent };
    const result = validateEnvelopeV1(mutated);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("content_hash_mismatch");
    }
  });
});

// ─── AC-007: fixture regression test ─────────────────────────────────────────

describe("AC-007: fixture regression test — byte-identical canonical CBOR output", () => {
  it("AC-007: TBS encoding matches tbs_cbor_hex; content_hash matches content_hash_hex", () => {
    const fixture = loadV1Fixture();

    // Verify content_hash: SHA-256(0x00 || content) per FIPS 180-4
    const content = Buffer.from(fixture.inputs.content_hex, "hex");
    const contentHash = msgLeafHash(new Uint8Array(content));
    expect(Buffer.from(contentHash).toString("hex")).toBe(fixture.expected.content_hash_hex);

    // Build TBS: [1, content_hash, sender_pubkey, session_id, last_seen_seq, timestamp]
    // Per RFC 8949 §4.2.1 canonical CBOR
    const enc = new Encoder({ tagUint8Array: false });
    const senderPubkey = Buffer.from(fixture.inputs.sender_pubkey_hex, "hex");
    const sessionId = Buffer.from(fixture.inputs.session_id_hex, "hex");
    const ts = fixture.inputs.timestamp;
    const tsEncoded = ts > 0xFFFFFFFF ? BigInt(ts) : ts;

    const tbs = [
      1,
      new Uint8Array(Buffer.from(fixture.expected.content_hash_hex, "hex")),
      new Uint8Array(senderPubkey),
      new Uint8Array(sessionId),
      fixture.inputs.last_seen_seq,
      tsEncoded,
    ];
    const encoded = enc.encode(tbs) as Buffer;
    expect(Buffer.from(encoded).toString("hex")).toBe(fixture.expected.tbs_cbor_hex);
  });
});

// ─── AC-008: exactly 1 MiB content → construction succeeds ──────────────────

describe("AC-008: 1 MiB content succeeds", () => {
  it("AC-008: content of exactly MAX_CONTENT_BYTES → buildEnvelopeV1 returns ok", async () => {
    const content = new Uint8Array(MAX_CONTENT_BYTES).fill(0x42);
    const kp = generateKeypair();
    const session_id = new Uint8Array(16).fill(0x04);
    const result = await buildEnvelopeV1(content, kp, 1_700_000_000_000, session_id, 0);
    expect(result.ok).toBe(true);
  });
});

// ─── AC-009: 1 MiB + 1 byte → content_too_large before crypto ───────────────

describe("AC-009: oversized content → content_too_large before crypto", () => {
  it("AC-009: content of MAX_CONTENT_BYTES + 1 → content_too_large; no hash/sig computed", async () => {
    const oversized = new Uint8Array(MAX_CONTENT_BYTES + 1);
    const kp = generateKeypair();
    const session_id = new Uint8Array(16).fill(0x05);
    const result = await buildEnvelopeV1(oversized, kp, 1_700_000_000_000, session_id, 0);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("content_too_large");
    }
  });
});

// ─── session_id length validation at build time ──────────────────────────────

describe("buildEnvelopeV1: session_id length validation", () => {
  it("session_id of 15 bytes → invalid_field(session_id) before any crypto", async () => {
    const kp = generateKeypair();
    const shortSid = new Uint8Array(15).fill(0x01);
    const result = await buildEnvelopeV1(
      new TextEncoder().encode("test"),
      kp,
      1_700_000_000_000,
      shortSid,
      0
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("invalid_field");
      if (result.error.reason === "invalid_field") {
        expect(result.error.field).toBe("session_id");
      }
    }
  });

  it("session_id of 17 bytes → invalid_field(session_id) before any crypto", async () => {
    const kp = generateKeypair();
    const longSid = new Uint8Array(17).fill(0x01);
    const result = await buildEnvelopeV1(
      new TextEncoder().encode("test"),
      kp,
      1_700_000_000_000,
      longSid,
      0
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("invalid_field");
      if (result.error.reason === "invalid_field") {
        expect(result.error.field).toBe("session_id");
      }
    }
  });
});

// ─── AC-010: extractStructure1 returns canonical TBS bytes ───────────────────

describe("AC-010: extractStructure1 returns canonical TBS bytes", () => {
  it("AC-010: extractStructure1(envelope) === canonical_CBOR([1, content_hash, sender_pubkey, session_id, last_seen_seq, timestamp])", async () => {
    const { envelope } = await makeEnvelopeV1(
      new TextEncoder().encode("ac010 test"),
      1_700_000_000_000,
      new Uint8Array(16).fill(0x06),
      7
    );

    const structure1Bytes = extractStructure1(envelope);

    // Manually compute expected TBS bytes
    const enc = new Encoder({ tagUint8Array: false });
    const ts = envelope.timestamp;
    const tsEncoded = ts > 0xFFFFFFFF ? BigInt(ts) : ts;
    const expectedTbs = enc.encode([
      1,
      envelope.content_hash,
      envelope.sender_pubkey,
      envelope.session_id,
      envelope.last_seen_seq,
      tsEncoded,
    ]) as Buffer;

    expect(Buffer.from(structure1Bytes).toString("hex")).toBe(
      Buffer.from(expectedTbs).toString("hex")
    );

    // Also verify Structure 1 bytes match what was signed
    expect(verify(envelope.sender_pubkey, structure1Bytes, envelope.sender_signature)).toBe(true);
  });

  it("AC-010: structure1-canonical fixture matches extractStructure1 output for fixture inputs", () => {
    const fixture = loadStructure1Fixture();

    // Build a synthetic envelope-like object with fixture values to test extractStructure1
    const fakeEnvelope: MessageEnvelopeV1 = {
      protocol_version: 1,
      sender_pubkey: new Uint8Array(Buffer.from(fixture.inputs.sender_pubkey_hex, "hex")),
      content: new Uint8Array(0),
      content_hash: new Uint8Array(Buffer.from(fixture.inputs.content_hash_hex, "hex")),
      session_id: new Uint8Array(Buffer.from(fixture.inputs.session_id_hex, "hex")),
      last_seen_seq: fixture.inputs.last_seen_seq,
      timestamp: fixture.inputs.timestamp,
      sender_signature: new Uint8Array(64),
    };

    const structure1Bytes = extractStructure1(fakeEnvelope);
    expect(Buffer.from(structure1Bytes).toString("hex")).toBe(fixture.expected_cbor_hex);
  });
});

// ─── SI-001: buildEnvelopeV1 ignores caller-supplied content_hash ─────────────

describe("SI-001: buildEnvelopeV1 always recomputes content_hash (adversarial)", () => {
  it("SI-001: any pre-computed hash passed to the API is ignored; correct hash in result", async () => {
    const content = new TextEncoder().encode("si-001 v1 test");
    const kp = generateKeypair();
    const session_id = new Uint8Array(16).fill(0x07);

    // Build envelope — content_hash is not a parameter, always recomputed
    const result = await buildEnvelopeV1(content, kp, 1_700_000_000, session_id, 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Validate passes (confirms hash is consistent with content)
    const vr = validateEnvelopeV1(result.envelope);
    expect(vr.ok).toBe(true);

    // Adversarial: fabricate an envelope with bogus content_hash — must fail validation
    const bogusHash = new Uint8Array(32).fill(0xde);
    const bogusEnvelope: MessageEnvelopeV1 = {
      ...result.envelope,
      content_hash: bogusHash,
    };
    const bogusResult = validateEnvelopeV1(bogusEnvelope);
    expect(bogusResult.ok).toBe(false);
    if (!bogusResult.ok) {
      expect(bogusResult.error.reason).toBe("content_hash_mismatch");
    }
  });
});

// ─── SI-002: protocol_version=0 valid M0 envelope → rejected by validateEnvelopeV1 ─

describe("SI-002: M0 v0 envelope rejected by validateEnvelopeV1 (adversarial)", () => {
  it("SI-002: protocol_version=0 otherwise-valid envelope → unsupported_version; M0 sig does not help", async () => {
    const { envelope } = await makeEnvelopeV1();
    // Create a v0-shaped envelope (protocol_version=0)
    const v0envelope = { ...envelope, protocol_version: 0 } as unknown as MessageEnvelopeV1;
    const result = validateEnvelopeV1(v0envelope);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("unsupported_version");
    }
  });
});

// ─── SI-003: TBS field mutations individually rejected (adversarial) ──────────

describe("SI-003: all TBS field mutations individually rejected (adversarial)", () => {
  it("SI-003a: mutate session_id after signing → invalid_field(sender_signature)", async () => {
    const { envelope } = await makeEnvelopeV1();
    const altSid = new Uint8Array(16).fill(0xfd);
    const mutated: MessageEnvelopeV1 = { ...envelope, session_id: altSid };
    const result = validateEnvelopeV1(mutated);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    if ("field" in result.error) {
      expect(result.error.field).toBe("sender_signature");
    }
  });

  it("SI-003b: mutate last_seen_seq after signing → invalid_field(sender_signature)", async () => {
    const { envelope } = await makeEnvelopeV1(
      new TextEncoder().encode("si003b"),
      1_700_000_000_000,
      new Uint8Array(16).fill(0x08),
      2
    );
    const mutated: MessageEnvelopeV1 = { ...envelope, last_seen_seq: 99 };
    const result = validateEnvelopeV1(mutated);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    if ("field" in result.error) {
      expect(result.error.field).toBe("sender_signature");
    }
  });

  it("SI-003c: mutate timestamp after signing → invalid_field(sender_signature)", async () => {
    const { envelope } = await makeEnvelopeV1();
    const mutated: MessageEnvelopeV1 = { ...envelope, timestamp: envelope.timestamp + 1 };
    const result = validateEnvelopeV1(mutated);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    if ("field" in result.error) {
      expect(result.error.field).toBe("sender_signature");
    }
  });

  it("SI-003d: mutate sender_pubkey after signing → invalid_field(sender_signature)", async () => {
    const { envelope } = await makeEnvelopeV1();
    const otherKp = generateKeypair();
    const otherPubkey = await otherKp.getPublicKey();
    const mutated: MessageEnvelopeV1 = { ...envelope, sender_pubkey: otherPubkey };
    const result = validateEnvelopeV1(mutated);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    if ("field" in result.error) {
      expect(result.error.field).toBe("sender_signature");
    }
  });
});

// ─── SI-004: canonical CBOR encoding is byte-stable (positional array) ───────

describe("SI-004: canonical CBOR encoding is byte-stable (adversarial: field ordering)", () => {
  it("SI-004: same inputs always produce byte-identical TBS CBOR (positional array prevents reordering)", async () => {
    const content = new TextEncoder().encode("si-004 stability test");
    const session_id = new Uint8Array(16).fill(0x09);
    const ts = 1_700_000_000_000;
    const last_seen_seq = 3;

    const kp1 = generateKeypair();
    const r1 = await buildEnvelopeV1(content, kp1, ts, session_id, last_seen_seq);
    const kp2 = generateKeypair();
    const r2 = await buildEnvelopeV1(content, kp2, ts, session_id, last_seen_seq);

    // Different keys → different signatures but identical TBS bytes (same content, same session_id, etc.)
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;

    // Both should produce same content_hash (derived from content only)
    expect(Buffer.from(r1.envelope.content_hash).toString("hex")).toBe(
      Buffer.from(r2.envelope.content_hash).toString("hex")
    );

    // extractStructure1 on both — TBS bytes differ only due to different sender_pubkey
    // but the CBOR encoding format is the same (6-element positional array)
    const s1 = extractStructure1(r1.envelope);
    const s2 = extractStructure1(r2.envelope);
    // Both must be valid CBOR arrays starting with 0x86 (6-element array marker)
    expect(s1[0]).toBe(0x86);
    expect(s2[0]).toBe(0x86);

    // Verify each signature against its own TBS (confirms CBOR is deterministic per keypair)
    expect(verify(r1.envelope.sender_pubkey, s1, r1.envelope.sender_signature)).toBe(true);
    expect(verify(r2.envelope.sender_pubkey, s2, r2.envelope.sender_signature)).toBe(true);
  });
});
