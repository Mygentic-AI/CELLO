/**
 * CELLO-MERKLE-002 — Structure 2 tests (protocol-types component)
 *
 * ACs covered here: AC-001, AC-002 (CBOR encoding), AC-003, AC-004, AC-007, AC-008
 * SIs covered here: SI-001
 * AC-005 / SI-002 are client-layer integration tests — deferred to @cello-protocol/client
 * AC-002 leaf-hash vectors and AC-006 / SI-003 domain-separation are in @cello-protocol/crypto
 *
 * Structure 1 TBS: [1, content_hash, sender_pubkey, session_id, last_seen_seq, timestamp]
 * Structure 2 wire: [sequence_number, sender_pubkey, content_hash, sender_signature, scan_result, prev_root]
 * scan_result sentinel: {score: null, verdict: "unscanned", model_hash: <32 zero bytes>}
 *
 * RFC 8949 §4.2.1: canonical CBOR
 * RFC 8032: Ed25519
 * FIPS 180-4: SHA-256
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
import { generateKeypair } from "@cello-protocol/crypto";
import { extractStructure1, buildEnvelopeV1 } from "../envelope.js";
import {
  buildStructure2,
  encodeStructure2,
  encodeScanResultSentinel,
  verifyStructure2Signature,
  SCAN_RESULT_SENTINEL,
} from "../structure2.js";

setupV3Tests();

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── helpers ──────────────────────────────────────────────────────────────────

function fromHex(h: string): Uint8Array {
  return h.length === 0 ? new Uint8Array(0) : Uint8Array.from(Buffer.from(h, "hex"));
}
function toHex(b: Uint8Array): string {
  return Buffer.from(b).toString("hex");
}

function loadStructure2Fixture() {
  return JSON.parse(
    readFileSync(join(__dirname, "../../test/vectors/structure2-canonical.json"), "utf8")
  ) as {
    inputs: {
      sequence_number: number;
      sender_pubkey_hex: string;
      content_hash_hex: string;
      sender_signature_hex: string;
      prev_root_hex: string;
    };
    expected_cbor_hex: string;
  };
}

function loadScanResultFixture() {
  return JSON.parse(
    readFileSync(join(__dirname, "../../test/vectors/scan-result-unscanned.json"), "utf8")
  ) as { expected_cbor_hex: string };
}

/** Build a real Structure 2 from a live keypair for round-trip tests. */
async function makeStructure2(seq = 1, lastSeenSeq = 0) {
  const kp = generateKeypair();
  const content = new TextEncoder().encode("merkle-002 test content");
  const sessionId = new Uint8Array(16).fill(0x10);
  const ts = 1_700_000_000_000;

  const envResult = await buildEnvelopeV1(content, kp, ts, sessionId, lastSeenSeq);
  if (!envResult.ok) throw new Error("buildEnvelopeV1 failed");

  const env = envResult.envelope;
  const prevRoot = new Uint8Array(32).fill(0x00);

  const s2Result = buildStructure2(
    seq,
    env.sender_pubkey,
    env.content_hash,
    env.sender_signature,
    prevRoot
  );
  if (!s2Result.ok) throw new Error(`buildStructure2 failed: ${s2Result.error.reason}`);

  return {
    structure2: s2Result.structure2,
    envelope: env,
    sessionId,
    lastSeenSeq,
    ts,
    kp,
  };
}

// ─── AC-001: Structure 1 canonical CBOR fixture (regression guard) ───────────

describe("AC-001: Structure 1 canonical CBOR fixture (regression guard from MSG-003)", () => {
  it("AC-001: extractStructure1 bytes still match structure1-canonical.json", () => {
    const fixture = JSON.parse(
      readFileSync(join(__dirname, "../../test/vectors/structure1-canonical.json"), "utf8")
    ) as {
      inputs: {
        content_hash_hex: string;
        sender_pubkey_hex: string;
        session_id_hex: string;
        last_seen_seq: number;
        timestamp: number;
      };
      expected_cbor_hex: string;
    };

    const fakeEnvelope = {
      protocol_version: 1 as const,
      sender_pubkey: fromHex(fixture.inputs.sender_pubkey_hex),
      content: new Uint8Array(0),
      content_hash: fromHex(fixture.inputs.content_hash_hex),
      session_id: fromHex(fixture.inputs.session_id_hex),
      last_seen_seq: fixture.inputs.last_seen_seq,
      timestamp: fixture.inputs.timestamp,
      sender_signature: new Uint8Array(64),
    };

    const bytes = extractStructure1(fakeEnvelope);
    expect(toHex(bytes)).toBe(fixture.expected_cbor_hex);
  });
});

// ─── AC-002: Structure 2 canonical CBOR fixture ───────────────────────────────

describe("AC-002: Structure 2 canonical CBOR fixture", () => {
  it("AC-002: encodeStructure2 matches structure2-canonical.json expected_cbor_hex", () => {
    const fixture = loadStructure2Fixture();
    const f = fixture.inputs;

    const s2Result = buildStructure2(
      f.sequence_number,
      fromHex(f.sender_pubkey_hex),
      fromHex(f.content_hash_hex),
      fromHex(f.sender_signature_hex),
      fromHex(f.prev_root_hex)
    );
    expect(s2Result.ok).toBe(true);
    if (!s2Result.ok) return;

    const cbor = encodeStructure2(s2Result.structure2);
    expect(toHex(cbor)).toBe(fixture.expected_cbor_hex);
  });
});

// ─── AC-003: verifyStructure2Signature — honest relay round-trip ──────────────

describe("AC-003: verifyStructure2Signature — honest relay round-trip", () => {
  it("AC-003: Structure 2 built from real Structure 1 signature verifies", async () => {
    const { structure2, envelope, sessionId, lastSeenSeq } = await makeStructure2();
    const ok = verifyStructure2Signature(structure2, sessionId, lastSeenSeq, envelope.timestamp);
    expect(ok).toBe(true);
  });
});

// ─── AC-004: forged sender_signature → verification fails ────────────────────

describe("AC-004: forged sender_signature → verification fails", () => {
  it("AC-004: Structure 2 with random 64-byte sender_signature → verifyStructure2Signature returns false", async () => {
    const { structure2, sessionId, lastSeenSeq, envelope } = await makeStructure2();
    const forgedStructure2 = {
      ...structure2,
      sender_signature: new Uint8Array(64).fill(0xff),
    };
    const ok = verifyStructure2Signature(forgedStructure2, sessionId, lastSeenSeq, envelope.timestamp);
    expect(ok).toBe(false);
  });
});

// ─── AC-007: scan_result sentinel encoding ────────────────────────────────────

describe("AC-007: scan_result sentinel canonical CBOR", () => {
  it("AC-007: encodeScanResultSentinel matches scan-result-unscanned.json expected_cbor_hex", () => {
    const fixture = loadScanResultFixture();
    const cbor = encodeScanResultSentinel();
    expect(toHex(cbor)).toBe(fixture.expected_cbor_hex);
  });

  it("AC-007: SCAN_RESULT_SENTINEL has score=null, verdict='unscanned', model_hash=32 zero bytes", () => {
    expect(SCAN_RESULT_SENTINEL.score).toBeNull();
    expect(SCAN_RESULT_SENTINEL.verdict).toBe("unscanned");
    expect(SCAN_RESULT_SENTINEL.model_hash.length).toBe(32);
    expect(SCAN_RESULT_SENTINEL.model_hash.every((b) => b === 0)).toBe(true);
  });
});

// ─── AC-008: field length validation ─────────────────────────────────────────

describe("AC-008: buildStructure2 field length validation", () => {
  const pub = new Uint8Array(32).fill(0x01);
  const hash = new Uint8Array(32).fill(0x02);
  const sig = new Uint8Array(64).fill(0x03);
  const prev = new Uint8Array(32).fill(0x04);

  it("AC-008: sender_pubkey of 31 bytes → invalid_field(sender_pubkey)", () => {
    const r = buildStructure2(1, new Uint8Array(31), hash, sig, prev);
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.reason === "invalid_field") expect(r.error.field).toBe("sender_pubkey");
  });

  it("AC-008: sender_signature of 63 bytes → invalid_field(sender_signature)", () => {
    const r = buildStructure2(1, pub, hash, new Uint8Array(63), prev);
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.reason === "invalid_field") expect(r.error.field).toBe("sender_signature");
  });

  it("AC-008: content_hash of 31 bytes → invalid_field(content_hash)", () => {
    const r = buildStructure2(1, pub, new Uint8Array(31), sig, prev);
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.reason === "invalid_field") expect(r.error.field).toBe("content_hash");
  });

  it("AC-008: prev_root of 31 bytes → invalid_field(prev_root)", () => {
    const r = buildStructure2(1, pub, hash, sig, new Uint8Array(31));
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.reason === "invalid_field") expect(r.error.field).toBe("prev_root");
  });
});

// ─── SI-001: forged Structure 2 around a tampered inner signature ─────────────

describe("SI-001: forged Structure 2 — tampered sender_signature never verifies", () => {
  it("SI-001: well-formed Structure 2 with one-bit-flipped signature → false", async () => {
    const { structure2, sessionId, lastSeenSeq, envelope } = await makeStructure2();

    const tamperedSig = Uint8Array.from(structure2.sender_signature);
    tamperedSig[0] ^= 0x01;
    const tampered = { ...structure2, sender_signature: tamperedSig };
    expect(verifyStructure2Signature(tampered, sessionId, lastSeenSeq, envelope.timestamp)).toBe(false);
  });

  it("SI-001: tampered sender_pubkey in Structure 2 → false", async () => {
    const { structure2, sessionId, lastSeenSeq, envelope } = await makeStructure2();
    const altPub = new Uint8Array(32).fill(0x99);
    const tampered = { ...structure2, sender_pubkey: altPub };
    expect(verifyStructure2Signature(tampered, sessionId, lastSeenSeq, envelope.timestamp)).toBe(false);
  });

  it("SI-001: all 256 one-bit flips on sender_signature → false", async () => {
    const { structure2, sessionId, lastSeenSeq, envelope } = await makeStructure2();
    for (let bit = 0; bit < 256; bit++) {
      const byteIdx = Math.floor(bit / 8);
      const mask = 1 << (bit % 8);
      const flipped = Uint8Array.from(structure2.sender_signature);
      flipped[byteIdx] ^= mask;
      expect(
        verifyStructure2Signature({ ...structure2, sender_signature: flipped }, sessionId, lastSeenSeq, envelope.timestamp)
      ).toBe(false);
    }
  });
});
