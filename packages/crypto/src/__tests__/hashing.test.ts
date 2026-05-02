import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  setupV3Tests,
  describe,
  it,
  expect,
} from "@claude-flow/testing";
import { hash, msgLeafHash, nodeHash, ctrlLeafHash } from "../hashing.js";

setupV3Tests();

const vectors = JSON.parse(
  readFileSync(join(import.meta.dirname ?? __dirname, "../../test/vectors/merkle-primitives.json"), "utf8")
);

const fromHex = (s: string) => Uint8Array.from(Buffer.from(s, "hex"));
const toHex = (b: Uint8Array) => Buffer.from(b).toString("hex");

// ─── CRYPTO-002 AC-001: message leaf hash ────────────────────────────────────
describe("msgLeafHash (AC-001)", () => {
  it("returns 32 bytes", () => {
    expect(msgLeafHash(new Uint8Array(0)).length).toBe(32);
  });

  for (const v of vectors.message_leaf) {
    it(`fixture: ${v.label}`, () => {
      const result = msgLeafHash(fromHex(v.input_hex));
      expect(toHex(result)).toBe(v.output_hex);
    });
  }
});

// ─── CRYPTO-002 AC-002: internal node hash ───────────────────────────────────
describe("nodeHash (AC-002)", () => {
  it("returns 32 bytes", () => {
    expect(nodeHash(new Uint8Array(32), new Uint8Array(32)).length).toBe(32);
  });

  for (const v of vectors.internal_node) {
    it(`fixture: ${v.label}`, () => {
      const result = nodeHash(fromHex(v.left_hex), fromHex(v.right_hex));
      expect(toHex(result)).toBe(v.output_hex);
    });
  }
});

// ─── CRYPTO-002 AC-003: control leaf hash ────────────────────────────────────
describe("ctrlLeafHash (AC-003)", () => {
  it("returns 32 bytes", () => {
    expect(ctrlLeafHash(new Uint8Array(0)).length).toBe(32);
  });

  for (const v of vectors.control_leaf) {
    it(`fixture: ${v.label}`, () => {
      const result = ctrlLeafHash(fromHex(v.input_hex));
      expect(toHex(result)).toBe(v.output_hex);
    });
  }
});

// ─── CRYPTO-002 AC-004: domain separation — all three domains differ ─────────
describe("domain separation (AC-004)", () => {
  it("AC-004: msgLeaf, ctrlLeaf, and plain hash all produce different outputs for same input", () => {
    const data = new TextEncoder().encode("same input");
    const msg = toHex(msgLeafHash(data));
    const ctrl = toHex(ctrlLeafHash(data));
    const plain = toHex(hash(data));
    expect(msg).not.toBe(ctrl);
    expect(msg).not.toBe(plain);
    expect(ctrl).not.toBe(plain);
  });
});

// ─── CRYPTO-002 AC-006: empty input message leaf ─────────────────────────────
describe("empty input (AC-006)", () => {
  it("AC-006: msgLeafHash(empty) == SHA-256(0x00)", () => {
    const result = msgLeafHash(new Uint8Array(0));
    expect(toHex(result)).toBe(vectors.message_leaf[0].output_hex);
  });
});

// ─── CRYPTO-002 AC-007: domain prefix confusion guard ────────────────────────
describe("domain prefix confusion guard (AC-007)", () => {
  it("AC-007: msgLeafHash(D) != SHA-256(0x01 || D) — confused caller cannot produce the same hash", () => {
    const data = new TextEncoder().encode("test data");
    const correct = toHex(msgLeafHash(data));
    // Construct the "wrong" hash exactly as described in AC-007: a caller accidentally uses
    // the internal-node prefix 0x01 on message data instead of 0x00.
    const wrongInput = new Uint8Array(1 + data.length);
    wrongInput[0] = 0x01;
    wrongInput.set(data, 1);
    const wrong = createHash("sha256").update(wrongInput).digest("hex");
    expect(correct).not.toBe(wrong);
  });
});

// ─── CRYPTO-002 SI-001: second-preimage protection ───────────────────────────
describe("second-preimage protection (SI-001)", () => {
  it("SI-001: data starting with 0x01 followed by two hashes cannot collide with internal node hash", () => {
    // Attacker crafts a message payload that starts with 0x01 + two 32-byte values
    const fakeLeft = new Uint8Array(32).fill(0xaa);
    const fakeRight = new Uint8Array(32).fill(0xbb);
    const craftedPayload = new Uint8Array(1 + 32 + 32);
    craftedPayload[0] = 0x01;
    craftedPayload.set(fakeLeft, 1);
    craftedPayload.set(fakeRight, 33);

    // msgLeafHash applies 0x00 prefix before SHA-256 → different from nodeHash which applies 0x01
    const msgHash = toHex(msgLeafHash(craftedPayload));
    const realNodeHash = toHex(nodeHash(fakeLeft, fakeRight));
    expect(msgHash).not.toBe(realNodeHash);
  });

  it("SI-001: data starting with 0x02 cannot collide with control leaf hash using message leaf primitive", () => {
    const data = new Uint8Array([0x02, 0xde, 0xad]);
    const msg = toHex(msgLeafHash(data));
    const ctrl = toHex(ctrlLeafHash(data));
    expect(msg).not.toBe(ctrl);
  });

  it("SI-001: msgLeaf(0x42) != ctrlLeaf(0x42) — identical input, different domain", () => {
    const input = fromHex("42");
    expect(toHex(msgLeafHash(input))).toBe(vectors.message_leaf[1].output_hex);
    expect(toHex(ctrlLeafHash(input))).toBe(vectors.control_leaf[1].output_hex);
    expect(vectors.message_leaf[1].output_hex).not.toBe(vectors.control_leaf[1].output_hex);
  });
});

// ─── CRYPTO-002 AC-005: NIST CAVP SHA-256 vectors + CELLO fixtures ───────────
// AC-005 requires NIST short/long message vectors as the cross-implementation contract
// the Rust port must match, plus the 7 CELLO-specific fixtures (a)–(g).
// NIST vectors are in merkle-primitives.json under "nist_sha256".
// CELLO fixtures (a)–(g) are covered by the msgLeafHash/nodeHash/ctrlLeafHash tests above.
describe("NIST CAVP SHA-256 vectors (AC-005)", () => {
  for (const v of vectors.nist_sha256.vectors) {
    it(`NIST: ${v.label}`, () => {
      expect(toHex(hash(fromHex(v.input_hex)))).toBe(v.output_hex);
    });
  }
});
