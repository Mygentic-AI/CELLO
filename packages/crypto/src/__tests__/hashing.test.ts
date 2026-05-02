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
  it("AC-006: msgLeafHash(empty) == SHA-256(0x00) — verified independently, not just against fixture", () => {
    // Compute expected independently using Node native crypto (FIPS 180-4) so this test
    // cannot pass due to a wrong fixture — it verifies the spec invariant directly.
    const expected = createHash("sha256").update(new Uint8Array([0x00])).digest("hex");
    expect(toHex(msgLeafHash(new Uint8Array(0)))).toBe(expected);
    // Also assert the fixture matches the independently computed value (catches a wrong fixture).
    expect(expected).toBe(vectors.message_leaf[0].output_hex);
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

  it("SI-001: attacker crafting msgLeaf input starting with 0x02 cannot collide with ctrlLeafHash", () => {
    // SI-001 adversarial scenario: attacker passes [0x02, <controlBytes>] to msgLeafHash,
    // hoping msgLeafHash([0x02, ...cb]) == ctrlLeafHash(cb). It cannot: msgLeaf prepends
    // its own 0x00 prefix, so the actual hashed input is [0x00, 0x02, ...cb] vs [0x02, ...cb].
    const controlBytes = new Uint8Array([0xde, 0xad]);
    const craftedInput = new Uint8Array([0x02, ...controlBytes]);
    const attackerHash = toHex(msgLeafHash(craftedInput));
    const legitimateCtrlHash = toHex(ctrlLeafHash(controlBytes));
    expect(attackerHash).not.toBe(legitimateCtrlHash);
  });

  it("SI-001: msgLeaf(0x42) != ctrlLeaf(0x42) — identical input, different domain", () => {
    const input = fromHex("42");
    expect(toHex(msgLeafHash(input))).toBe(vectors.message_leaf[1].output_hex);
    expect(toHex(ctrlLeafHash(input))).toBe(vectors.control_leaf[1].output_hex);
    expect(vectors.message_leaf[1].output_hex).not.toBe(vectors.control_leaf[1].output_hex);
  });
});

// ─── CRYPTO-002 AC-005: NIST CAVP SHA-256 vectors + CELLO fixtures ───────────
// AC-005 requires exactly 6 NIST short/long message vectors as the cross-implementation
// contract the Rust port must match, plus the 7 CELLO-specific fixtures (a)–(g).
// NIST vectors are in merkle-primitives.json under "nist_sha256".
// CELLO fixtures (a)–(g) are covered by the msgLeafHash/nodeHash/ctrlLeafHash tests above.
describe("NIST CAVP SHA-256 vectors (AC-005)", () => {
  // Guard: deleting a vector from the JSON silently drops coverage without this check.
  it("vector file contains exactly 6 NIST vectors, 3 message-leaf, 2 internal-node, 2 control-leaf", () => {
    expect(vectors.nist_sha256.vectors.length).toBe(6);
    expect(vectors.message_leaf.length).toBe(3);
    expect(vectors.internal_node.length).toBe(2);
    expect(vectors.control_leaf.length).toBe(2);
  });

  for (const v of vectors.nist_sha256.vectors) {
    it(`NIST: ${v.label}`, () => {
      expect(toHex(hash(fromHex(v.input_hex)))).toBe(v.output_hex);
    });
  }
});
