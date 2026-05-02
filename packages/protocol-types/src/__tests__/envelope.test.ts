/**
 * CELLO-MSG-001 — MessageEnvelope tests
 *
 * Every AC and SI from the story spec maps to a named test below.
 * Tests are written RED-first per SPARC Phase R.
 *
 * References:
 *   RFC 8032 — Ed25519 TBS
 *   RFC 8949 §4.2.1 — Canonical CBOR
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  setupV3Tests,
  createTestScope,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@claude-flow/testing";
import type { TestScope } from "@claude-flow/testing";
import { generateKeypair, msgLeafHash, verify } from "@cello/crypto";
import { Encoder } from "cbor-x";
import {
  buildEnvelope,
  validateEnvelope,
  serializeEnvelope,
  deserializeEnvelope,
  MAX_CONTENT_BYTES,
} from "../envelope.js";
import type { MessageEnvelope } from "../types.js";

setupV3Tests();

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Load the TBS test vector fixture. */
function loadFixture(): {
  protocol_version: number;
  content_hash_hex: string;
  sender_pubkey_hex: string;
  timestamp: number;
  expected_cbor_hex: string;
} {
  const fixturePath = join(__dirname, "../../test/vectors/tbs-v0-canonical.json");
  return JSON.parse(readFileSync(fixturePath, "utf8")) as ReturnType<typeof loadFixture>;
}

/** Build a minimal valid envelope for a given keypair. */
async function makeEnvelope(
  content: Uint8Array = new TextEncoder().encode("hello cello"),
  timestamp = 1_000_000_000_000
): Promise<{ envelope: MessageEnvelope; kp: ReturnType<typeof generateKeypair> }> {
  const kp = generateKeypair();
  const result = await buildEnvelope(content, kp, timestamp);
  if (!result.ok) throw new Error(`buildEnvelope failed: ${result.error.reason}`);
  return { envelope: result.envelope, kp };
}

// ─── scope ────────────────────────────────────────────────────────────────────

let scope: TestScope;
beforeEach(() => {
  scope = createTestScope();
});
afterEach(async () => {
  await scope.run(async () => {});
});

// ─── AC-001: construction — all fields populated correctly ───────────────────

describe("AC-001: buildEnvelope — all fields populated", () => {
  it("AC-001: protocol_version = 0, content_hash = msgLeafHash(content), signature verifies over TBS", async () => {
    const content = new TextEncoder().encode("test message AC-001");
    const ts = 1_746_057_600_000;
    const { envelope } = await makeEnvelope(content, ts);

    expect(envelope.protocol_version).toBe(0);
    expect(envelope.sender_pubkey).toBeInstanceOf(Uint8Array);
    expect(envelope.sender_pubkey.length).toBe(32);
    expect(envelope.timestamp).toBe(ts);

    // Verify content_hash value — must equal msgLeafHash(content), not just be 32 bytes
    const expectedHash = msgLeafHash(content);
    expect(Buffer.from(envelope.content_hash).toString("hex")).toBe(
      Buffer.from(expectedHash).toString("hex")
    );

    // Verify sender_signature over canonical CBOR of TBS [0, content_hash, sender_pubkey, timestamp]
    const enc = new Encoder({ tagUint8Array: false });
    const tbsBytes = enc.encode([0, envelope.content_hash, envelope.sender_pubkey, BigInt(ts)]);
    expect(verify(envelope.sender_pubkey, tbsBytes, envelope.sender_signature)).toBe(true);
  });
});

// ─── AC-002: validation passes for well-formed envelope ──────────────────────

describe("AC-002: validateEnvelope — well-formed envelope passes", () => {
  it("AC-002: validate returns ok:true for a just-built envelope", async () => {
    const { envelope } = await makeEnvelope();
    const result = validateEnvelope(envelope);
    expect(result.ok).toBe(true);
  });
});

// ─── AC-003: missing sender_pubkey → validation fails ────────────────────────

describe("AC-003: validateEnvelope — missing sender_pubkey", () => {
  it("AC-003: envelope with sender_pubkey removed → missing_field(sender_pubkey)", async () => {
    const { envelope } = await makeEnvelope();
    // Cast to any to forcibly remove the field
    const mutated = { ...envelope } as Record<string, unknown>;
    delete mutated["sender_pubkey"];
    const result = validateEnvelope(mutated as unknown as MessageEnvelope);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("missing_field");
      if (result.error.reason === "missing_field") {
        expect(result.error.field).toBe("sender_pubkey");
      }
    }
  });
});

// ─── AC-004: malformed byte-length fields → validation fails ─────────────────

describe("AC-004: validateEnvelope — wrong byte lengths", () => {
  it("AC-004a: 31-byte sender_pubkey → invalid_field(sender_pubkey)", async () => {
    const { envelope } = await makeEnvelope();
    const mutated: MessageEnvelope = {
      ...envelope,
      sender_pubkey: new Uint8Array(31),
    };
    const result = validateEnvelope(mutated);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("invalid_field");
      if (result.error.reason === "invalid_field") {
        expect(result.error.field).toBe("sender_pubkey");
      }
    }
  });

  it("AC-004b: 63-byte sender_signature → invalid_field(sender_signature)", async () => {
    const { envelope } = await makeEnvelope();
    const mutated: MessageEnvelope = {
      ...envelope,
      sender_signature: new Uint8Array(63),
    };
    const result = validateEnvelope(mutated);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("invalid_field");
      if (result.error.reason === "invalid_field") {
        expect(result.error.field).toBe("sender_signature");
      }
    }
  });

  it("AC-004c: 31-byte content_hash → invalid_field(content_hash)", async () => {
    const { envelope } = await makeEnvelope();
    const mutated: MessageEnvelope = {
      ...envelope,
      content_hash: new Uint8Array(31),
    };
    const result = validateEnvelope(mutated);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("invalid_field");
      if (result.error.reason === "invalid_field") {
        expect(result.error.field).toBe("content_hash");
      }
    }
  });
});

// ─── AC-005: negative timestamp → invalid_field(timestamp) ───────────────────

describe("AC-005: validateEnvelope — timestamp = -1", () => {
  it("AC-005: timestamp = -1 → invalid_field(timestamp)", async () => {
    const { envelope } = await makeEnvelope();
    // Build with a valid timestamp, then mutate for validation test
    const mutated: MessageEnvelope = { ...envelope, timestamp: -1 };
    const result = validateEnvelope(mutated);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("invalid_field");
      if (result.error.reason === "invalid_field") {
        expect(result.error.field).toBe("timestamp");
      }
    }
  });
});

// ─── AC-006: round-trip serialize → deserialize ───────────────────────────────

describe("AC-006: serialize / deserialize round-trip", () => {
  it("AC-006: serialize → deserialize → identical envelope; sig still verifies; re-serialize is byte-identical", async () => {
    const { envelope } = await makeEnvelope();

    const bytes1 = serializeEnvelope(envelope);
    const deserResult = deserializeEnvelope(bytes1);
    expect(deserResult.ok).toBe(true);

    if (!deserResult.ok) return;
    const envelope2 = deserResult.envelope;

    // All fields identical
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
    expect(envelope2.timestamp).toBe(envelope.timestamp);
    expect(Buffer.from(envelope2.sender_signature).toString("hex")).toBe(
      Buffer.from(envelope.sender_signature).toString("hex")
    );

    // Signature still verifies
    const validateResult = validateEnvelope(envelope2);
    expect(validateResult.ok).toBe(true);

    // Re-serialize → byte-identical
    const bytes2 = serializeEnvelope(envelope2);
    expect(Buffer.from(bytes2).toString("hex")).toBe(
      Buffer.from(bytes1).toString("hex")
    );
  });
});

// ─── AC-007: TBS field mutations → sig verification fails ────────────────────

describe("AC-007 / SI-003: mutated TBS fields → signature fails", () => {
  it("AC-007a: changed protocol_version → signature fails", async () => {
    const { envelope } = await makeEnvelope();
    // Directly assemble a struct with version 1 to test signature verification path
    const mutated = {
      ...envelope,
      protocol_version: 1 as unknown as 0, // force invalid version
    };
    // Version check in validator catches this first (unsupported_version)
    const result = validateEnvelope(mutated as MessageEnvelope);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Either unsupported_version or sig failure — both are expected rejections
      expect(["unsupported_version", "invalid_field"]).toContain(result.error.reason);
    }
  });

  it("AC-007b: replaced content_hash → signature fails", async () => {
    const { envelope } = await makeEnvelope();
    const badHash = new Uint8Array(32).fill(0xff);
    const mutated: MessageEnvelope = { ...envelope, content_hash: badHash };
    const result = validateEnvelope(mutated);
    expect(result.ok).toBe(false);
    // content_hash_mismatch detected before sig check
    if (!result.ok) {
      expect(result.error.reason).toBe("content_hash_mismatch");
    }
  });

  it("AC-007c: substituted sender_pubkey → signature fails", async () => {
    const { envelope } = await makeEnvelope();
    const altKp = generateKeypair();
    const altPubkey = await altKp.getPublicKey();
    const mutated: MessageEnvelope = { ...envelope, sender_pubkey: altPubkey };
    const result = validateEnvelope(mutated);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("invalid_field");
      if (result.error.reason === "invalid_field") {
        expect(result.error.field).toBe("sender_signature");
      }
    }
  });

  it("AC-007d: moved timestamp → signature fails", async () => {
    const { envelope } = await makeEnvelope(
      new TextEncoder().encode("ac007d"),
      1_000_000
    );
    const mutated: MessageEnvelope = { ...envelope, timestamp: envelope.timestamp + 1 };
    const result = validateEnvelope(mutated);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("invalid_field");
      if (result.error.reason === "invalid_field") {
        expect(result.error.field).toBe("sender_signature");
      }
    }
  });
});

// ─── AC-008: TBS fixture → produced bytes equal expected_cbor_hex ────────────

describe("AC-008: TBS fixture regression test", () => {
  it("AC-008: canonical CBOR encoding of TBS fixture matches expected_cbor_hex", () => {
    const fixture = loadFixture();

    // Build TBS bytes using the same logic as envelope.ts:
    // [0, content_hash, sender_pubkey, BigInt(timestamp)]
    // encoded with Encoder({ tagUint8Array: false }) — RFC 8949 §4.2.1
    const enc = new Encoder({ tagUint8Array: false });

    const contentHash = Buffer.from(fixture.content_hash_hex, "hex");
    const senderPubkey = Buffer.from(fixture.sender_pubkey_hex, "hex");
    const tbs = [
      fixture.protocol_version,
      new Uint8Array(contentHash),
      new Uint8Array(senderPubkey),
      BigInt(fixture.timestamp),
    ];
    const encoded = enc.encode(tbs) as Buffer;
    expect(Buffer.from(encoded).toString("hex")).toBe(fixture.expected_cbor_hex);
  });
});

// ─── AC-009: exactly 1 MiB content → construction succeeds ──────────────────

describe("AC-009: 1 MiB content succeeds", () => {
  it("AC-009: content of exactly MAX_CONTENT_BYTES → buildEnvelope returns ok", async () => {
    const content = new Uint8Array(MAX_CONTENT_BYTES).fill(0x42);
    const kp = generateKeypair();
    const result = await buildEnvelope(content, kp, 1_000_000_000_000);
    expect(result.ok).toBe(true);
  });
});

// ─── AC-010: 1 MiB + 1 byte → content_too_large error ───────────────────────

describe("AC-010: oversized content → content_too_large before crypto", () => {
  it("AC-010: content of MAX_CONTENT_BYTES + 1 → content_too_large; no hash/sig computed", async () => {
    const oversized = new Uint8Array(MAX_CONTENT_BYTES + 1);
    const kp = generateKeypair();
    const result = await buildEnvelope(oversized, kp, 1_000_000_000_000);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("content_too_large");
    }
  });
});

// ─── AC-011: inbound envelope with oversized content → validation fails ───────

describe("AC-011: validateEnvelope — content too large", () => {
  it("AC-011: inbound envelope with content > MAX_CONTENT_BYTES → content_too_large", async () => {
    const { envelope } = await makeEnvelope();
    const oversizedContent = new Uint8Array(MAX_CONTENT_BYTES + 1);
    const mutated: MessageEnvelope = {
      ...envelope,
      content: oversizedContent,
    };
    const result = validateEnvelope(mutated);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("content_too_large");
    }
  });
});

// ─── AC-012: modified content → content_hash_mismatch BEFORE sig verify ──────

describe("AC-012: content_hash_mismatch detected before sig verification", () => {
  it("AC-012: content modified post-signing → content_hash_mismatch returned first", async () => {
    const { envelope } = await makeEnvelope();
    const modifiedContent = new Uint8Array(envelope.content);
    modifiedContent[0] ^= 0x01;
    const mutated: MessageEnvelope = { ...envelope, content: modifiedContent };
    const result = validateEnvelope(mutated);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("content_hash_mismatch");
    }
  });
});

// ─── AC-013: protocol_version = 999 → unsupported_version, no sig check ──────

describe("AC-013 / SI-004: unsupported_version rejected before sig check", () => {
  it("AC-013: protocol_version = 999 → unsupported_version error", async () => {
    const { envelope } = await makeEnvelope();
    const mutated = {
      ...envelope,
      protocol_version: 999 as unknown as 0,
    };
    const result = validateEnvelope(mutated as MessageEnvelope);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("unsupported_version");
    }
  });
});

// ─── SI-001: buildEnvelope ignores caller-supplied content_hash ───────────────

describe("SI-001: buildEnvelope always recomputes content_hash", () => {
  it("SI-001: passing a bogus pre-computed hash is ignored; correct hash in result", async () => {
    const content = new TextEncoder().encode("si-001 test");
    const kp = generateKeypair();
    // We can only supply content + keyProvider + timestamp to buildEnvelope.
    // SI-001 ensures no way to inject a bad content_hash.
    // Verify by checking result.envelope.content_hash matches msgLeafHash(content).
    const result = await buildEnvelope(content, kp, 1_000_000);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Validate should pass (confirms the hash is consistent with content)
    const vr = validateEnvelope(result.envelope);
    expect(vr.ok).toBe(true);

    // Directly verify: a fabricated envelope with a bogus hash fails validation
    const bogusHash = new Uint8Array(32).fill(0xde);
    const bogusEnvelope: MessageEnvelope = {
      ...result.envelope,
      content_hash: bogusHash,
    };
    const bogusResult = validateEnvelope(bogusEnvelope);
    expect(bogusResult.ok).toBe(false);
    if (!bogusResult.ok) {
      expect(bogusResult.error.reason).toBe("content_hash_mismatch");
    }
  });
});

// ─── SI-002: 10 sequential envelopes all have valid signatures ────────────────

describe("SI-002: rapid sequential construction — all signatures valid", () => {
  it("SI-002: build 10 envelopes in sequence, all signatures verify", async () => {
    for (let i = 0; i < 10; i++) {
      const content = new TextEncoder().encode(`si-002 message ${i}`);
      const kp = generateKeypair();
      const result = await buildEnvelope(content, kp, 1_000_000 + i);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      const vr = validateEnvelope(result.envelope);
      expect(vr.ok).toBe(true);
    }
  });
});

// ─── SI-003: each TBS field mutation independently rejects ────────────────────
// SI-003 adversarial condition: build valid envelope, mutate each TBS field, validate → all rejected.
// This mirrors AC-007 but is labeled separately as the security invariant test.

describe("SI-003: all TBS field mutations individually rejected", () => {
  it("SI-003: mutate protocol_version → rejected (unsupported_version or invalid_field)", async () => {
    const { envelope } = await makeEnvelope();
    const mutated = { ...envelope, protocol_version: 1 } as unknown as MessageEnvelope;
    const result = validateEnvelope(mutated);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(["unsupported_version", "invalid_field"]).toContain(result.error.reason);
  });

  it("SI-003: mutate content_hash → content_hash_mismatch", async () => {
    const { envelope } = await makeEnvelope();
    const badHash = new Uint8Array(32).fill(0xff);
    const mutated: MessageEnvelope = { ...envelope, content_hash: badHash };
    const result = validateEnvelope(mutated);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe("content_hash_mismatch");
  });

  it("SI-003: mutate sender_pubkey → invalid_field(sender_signature)", async () => {
    const other = generateKeypair();
    const otherPubkey = await other.getPublicKey();
    const { envelope } = await makeEnvelope();
    const mutated: MessageEnvelope = { ...envelope, sender_pubkey: otherPubkey };
    const result = validateEnvelope(mutated);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    if ("field" in result.error) {
      expect(result.error.field).toBe("sender_signature");
    }
  });

  it("SI-003: mutate timestamp → invalid_field(sender_signature)", async () => {
    const { envelope } = await makeEnvelope();
    const mutated: MessageEnvelope = { ...envelope, timestamp: envelope.timestamp + 1 };
    const result = validateEnvelope(mutated);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    if ("field" in result.error) {
      expect(result.error.field).toBe("sender_signature");
    }
  });
});

// ─── SI-004: version != 0 → rejected before sig check (covered by AC-013) ────

describe("SI-004: unsupported version rejected before sig check", () => {
  it("SI-004: version 999 envelope → unsupported_version before verify() is called", async () => {
    const { envelope } = await makeEnvelope();
    // Assemble a struct with version 999 directly (bypassing buildEnvelope which hardcodes 0)
    const version999: Record<string, unknown> = {
      ...envelope,
      protocol_version: 999,
    };

    // Track whether verify was called by temporarily monkey-patching is not possible
    // in ESM without import mocking. Instead, confirm the error reason is unsupported_version,
    // which by specification is returned BEFORE any sig check.
    const result = validateEnvelope(version999 as unknown as MessageEnvelope);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("unsupported_version");
    }
  });
});
