/**
 * Tests for RFC 6962 Merkle tree primitives (CELLO-MERKLE-001).
 *
 * Every AC and SI from the story YAML maps to a named test below.
 * All hashing is real SHA-256 — no mocks.
 *
 * References:
 *   RFC 6962 §2.1  — tree construction and empty-tree root
 *   RFC 6962 §2.1.1 — inclusion proof and verification
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  setupV3Tests,
  describe,
  it,
  expect,
} from "@claude-flow/testing";
import { msgLeafHash } from "../hashing.js";
import {
  buildMerkleTree,
  merkleRoot,
  inclusionProof,
  verifyInclusion,
} from "../merkle.js";

setupV3Tests();

// ── Helpers ────────────────────────────────────────────────────────────────

const fromHex = (s: string): Uint8Array =>
  s.length === 0 ? new Uint8Array(0) : Uint8Array.from(Buffer.from(s, "hex"));

const toHex = (b: Uint8Array): string => Buffer.from(b).toString("hex");

const sha256 = (data: Uint8Array): string =>
  createHash("sha256").update(data).digest("hex");

// ── Load test vector fixtures ───────────────────────────────────────────────

const vectors = JSON.parse(
  readFileSync(
    join(import.meta.dirname ?? __dirname, "../../test/vectors/merkle-tree.json"),
    "utf8"
  )
) as {
  empty_root: string;
  trees: Array<{
    description: string;
    leaves: string[];
    root: string;
    proofs: Array<{ index: number; proof: string[] }>;
  }>;
};

const leafHashVectors = JSON.parse(
  readFileSync(
    join(import.meta.dirname ?? __dirname, "../../test/vectors/leaf-hash-vectors.json"),
    "utf8"
  )
) as Array<{
  description: string;
  leaf_kind_byte: string;
  structure2_cbor_hex: string;
  expected_leaf_hash_hex: string;
}>;

// ── AC-007: empty leaf sequence ─────────────────────────────────────────────
describe("empty tree (AC-007)", () => {
  it("AC-007: empty leaf sequence produces SHA-256('') — verified independently", () => {
    const tree = buildMerkleTree([]);
    const root = merkleRoot(tree);
    expect(toHex(root)).toBe(vectors.empty_root);
    // Verify independently with Node crypto
    const expected = sha256(new Uint8Array(0));
    expect(toHex(root)).toBe(expected);
  });
});

// ── AC-001: tree sizes and root length/determinism ──────────────────────────
describe("tree construction (AC-001)", () => {
  const sizes = [1, 2, 3, 4, 5, 7, 8, 15, 16, 17];

  for (const n of sizes) {
    it(`AC-001: size=${n} — root is 32 bytes`, () => {
      const leaves = Array.from({ length: n }, (_, i) =>
        new Uint8Array([i % 256])
      );
      const tree = buildMerkleTree(leaves);
      expect(merkleRoot(tree).length).toBe(32);
    });

    it(`AC-001: size=${n} — same inputs produce same root`, () => {
      const leaves = Array.from({ length: n }, (_, i) =>
        new Uint8Array([i % 256])
      );
      const root1 = toHex(merkleRoot(buildMerkleTree(leaves)));
      const root2 = toHex(merkleRoot(buildMerkleTree(leaves)));
      expect(root1).toBe(root2);
    });
  }
});

// ── AC-002: RFC 6962 fixture vectors ────────────────────────────────────────
describe("RFC 6962 fixture vectors (AC-002)", () => {
  it("AC-002: vector file includes RFC 6962 empty-tree root", () => {
    expect(vectors.empty_root).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
  });

  for (const tree of vectors.trees) {
    it(`AC-002: fixture root matches — ${tree.description.slice(0, 60)}`, () => {
      const leaves = tree.leaves.map(fromHex);
      const built = buildMerkleTree(leaves);
      expect(toHex(merkleRoot(built))).toBe(tree.root);
    });
  }
});

// ── AC-003: produce proof for leaf i, verify against root → true ────────────
describe("inclusion proof round-trip (AC-003)", () => {
  for (const tree of vectors.trees) {
    for (const { index, proof: expectedProof } of tree.proofs) {
      it(`AC-003: tree="${tree.description.slice(0, 40)}…" leaf=${index} — proof produces expected siblings`, () => {
        const leaves = tree.leaves.map(fromHex);
        const built = buildMerkleTree(leaves);
        const proof = inclusionProof(built, index);
        expect(proof.map(toHex)).toEqual(expectedProof);
      });

      it(`AC-003: tree="${tree.description.slice(0, 40)}…" leaf=${index} — verifyInclusion returns true`, () => {
        const leaves = tree.leaves.map(fromHex);
        const built = buildMerkleTree(leaves);
        const root = merkleRoot(built);
        const lh = msgLeafHash(fromHex(tree.leaves[index]));
        const proof = inclusionProof(built, index);
        expect(verifyInclusion(lh, index, leaves.length, proof, root)).toBe(true);
      });
    }
  }
});

// ── AC-004: flip one bit of expectedRoot → false ─────────────────────────────
describe("tampered root (AC-004)", () => {
  it("AC-004: valid proof with one-bit-flipped expected_root → false", () => {
    const tree = vectors.trees[0];
    const leaves = tree.leaves.map(fromHex);
    const built = buildMerkleTree(leaves);
    const root = merkleRoot(built);
    const index = 0;
    const lh = msgLeafHash(leaves[index]);
    const proof = inclusionProof(built, index);

    const tamperedRoot = Uint8Array.from(root);
    tamperedRoot[0] ^= 0x01;

    expect(verifyInclusion(lh, index, leaves.length, proof, tamperedRoot)).toBe(false);
  });
});

// ── AC-005: valid proof, substitute different leaf_hash → false ──────────────
describe("wrong leaf hash (AC-005)", () => {
  it("AC-005: valid proof with wrong leaf_hash → false", () => {
    const tree = vectors.trees[0];
    const leaves = tree.leaves.map(fromHex);
    const built = buildMerkleTree(leaves);
    const root = merkleRoot(built);
    const index = 0;
    const proof = inclusionProof(built, index);

    // Use leaf hash of a different leaf
    const wrongLeafHash = msgLeafHash(leaves[1]);

    expect(verifyInclusion(wrongLeafHash, index, leaves.length, proof, root)).toBe(false);
  });
});

// ── AC-006: replace single sibling hash with random bytes → false ────────────
describe("tampered proof sibling (AC-006)", () => {
  const tree = vectors.trees[0];
  const leaves = tree.leaves.map(fromHex);

  for (const { index } of tree.proofs) {
    it(`AC-006: replacing any sibling in proof for leaf=${index} → false`, () => {
      const built = buildMerkleTree(leaves);
      const root = merkleRoot(built);
      const lh = msgLeafHash(leaves[index]);
      const proof = inclusionProof(built, index);

      // Replace each sibling one at a time
      for (let i = 0; i < proof.length; i++) {
        const tamperedProof = proof.map((h, j) => {
          if (j !== i) return h;
          const t = Uint8Array.from(h);
          t[0] ^= 0xff;
          return t;
        });
        expect(
          verifyInclusion(lh, index, leaves.length, tamperedProof, root)
        ).toBe(false);
      }
    });
  }
});

// ── AC-008: edge cases return false, never throw ──────────────────────────────
describe("edge cases return false, no throw (AC-008)", () => {
  it("AC-008: index out of range (index === treeSize) → false", () => {
    const leaves = [new Uint8Array([0x01])];
    const built = buildMerkleTree(leaves);
    const root = merkleRoot(built);
    const lh = msgLeafHash(leaves[0]);
    const proof = inclusionProof(built, 0);
    expect(verifyInclusion(lh, 1, 1, proof, root)).toBe(false);
  });

  it("AC-008: wrong proof length (empty proof for multi-leaf tree) → false", () => {
    const leaves = [new Uint8Array([0x01]), new Uint8Array([0x02])];
    const built = buildMerkleTree(leaves);
    const root = merkleRoot(built);
    const lh = msgLeafHash(leaves[0]);
    expect(verifyInclusion(lh, 0, 2, [], root)).toBe(false);
  });

  it("AC-008: 31-byte sibling hash in proof → false", () => {
    const leaves = [new Uint8Array([0x01]), new Uint8Array([0x02])];
    const built = buildMerkleTree(leaves);
    const root = merkleRoot(built);
    const lh = msgLeafHash(leaves[0]);
    const badProof = [new Uint8Array(31)]; // 31 bytes, not 32
    expect(verifyInclusion(lh, 0, 2, badProof, root)).toBe(false);
  });
});

// ── SI-001: second-preimage protection ────────────────────────────────────────
describe("second-preimage protection (SI-001)", () => {
  it("SI-001: leaf content that looks like an internal node still hashes differently from nodeHash", () => {
    // Attacker crafts message data that looks like 0x01 || hash_A || hash_B
    const hashA = new Uint8Array(32).fill(0xaa);
    const hashB = new Uint8Array(32).fill(0xbb);
    const craftedPayload = new Uint8Array(1 + 32 + 32);
    craftedPayload[0] = 0x01;
    craftedPayload.set(hashA, 1);
    craftedPayload.set(hashB, 33);

    // Build a single-leaf tree with crafted payload
    const tree = buildMerkleTree([craftedPayload]);
    const treeRoot = merkleRoot(tree);

    // Build a two-leaf tree so we can get nodeHash(hashA, hashB)
    // The internal node of a 2-leaf tree is the root
    const twoLeafTree = buildMerkleTree([hashA, hashB]);
    const twoLeafRoot = merkleRoot(twoLeafTree);

    // The single-leaf root (msgLeafHash of crafted payload) must not equal any internal node
    expect(toHex(treeRoot)).not.toBe(toHex(twoLeafRoot));

    // More directly: msgLeafHash(craftedPayload) must differ from what nodeHash would give
    const craftedLeafHash = msgLeafHash(craftedPayload);
    // nodeHash(hashALeaf, hashBLeaf) would be different
    expect(toHex(craftedLeafHash)).not.toBe(
      sha256(
        (() => {
          const buf = new Uint8Array(1 + 32 + 32);
          buf[0] = 0x01;
          buf.set(hashA, 1);
          buf.set(hashB, 33);
          return buf;
        })()
      )
    );
  });
});

// ── SI-002: one-bit difference in root → false ────────────────────────────────
describe("one-bit root difference (SI-002)", () => {
  it("SI-002: reconstructed root differing by one bit → verifyInclusion returns false", () => {
    const leaves = [
      new Uint8Array([0x10]),
      new Uint8Array([0x20]),
      new Uint8Array([0x30]),
    ];
    const built = buildMerkleTree(leaves);
    const root = merkleRoot(built);

    for (let bitPos = 0; bitPos < 256; bitPos++) {
      const byteIdx = Math.floor(bitPos / 8);
      const bitMask = 1 << (bitPos % 8);
      const tweaked = Uint8Array.from(root);
      tweaked[byteIdx] ^= bitMask;

      const lh = msgLeafHash(leaves[0]);
      const proof = inclusionProof(built, 0);

      expect(verifyInclusion(lh, 0, leaves.length, proof, tweaked)).toBe(false);
    }
  });
});

// ── leaf-hash-vectors.json domain separation (MERKLE-002 fixture) ─────────────
describe("leaf-hash-vectors.json fixture (MERKLE-002 domain separation)", () => {
  it("fixture file includes exactly 6 entries", () => {
    expect(leafHashVectors.length).toBe(6);
  });

  it("domain separation pair: same bytes, leaf_kind_byte 0x00 vs 0x02 produce different hashes", () => {
    const msgEntry = leafHashVectors.find(
      (v) => v.leaf_kind_byte === "00" && v.structure2_cbor_hex === "42"
    );
    const ctrlEntry = leafHashVectors.find(
      (v) => v.leaf_kind_byte === "02" && v.structure2_cbor_hex === "42"
    );
    expect(msgEntry).toBeDefined();
    expect(ctrlEntry).toBeDefined();
    expect(msgEntry!.expected_leaf_hash_hex).not.toBe(
      ctrlEntry!.expected_leaf_hash_hex
    );
  });

  for (const v of leafHashVectors) {
    it(`leaf-hash-vector: ${v.description}`, () => {
      const bytes = fromHex(v.structure2_cbor_hex);
      const prefixByte = parseInt(v.leaf_kind_byte, 16);
      const prefixed = new Uint8Array(1 + bytes.length);
      prefixed[0] = prefixByte;
      prefixed.set(bytes, 1);
      const computed = sha256(prefixed);
      expect(computed).toBe(v.expected_leaf_hash_hex);
    });
  }
});
