import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hash, msgLeafHash, nodeHash, ctrlLeafHash } from "../hashing.js";

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
  it("AC-007: msgLeafHash(D) != nodeHash prefix applied to D", () => {
    const data = new TextEncoder().encode("test data");
    const correct = toHex(msgLeafHash(data));
    // Simulate accidentally using internal-node prefix
    const wrong = toHex(nodeHash(data, new Uint8Array(0)));
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

// ─── CRYPTO-002 AC-005: plain SHA-256 sanity ─────────────────────────────────
describe("plain hash (AC-005 sanity)", () => {
  it("hash(empty) is well-known SHA-256 of empty string", () => {
    expect(toHex(hash(new Uint8Array(0)))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
  });
});
