/**
 * DOD-AE-APPEND-1 — anti-entropy handshake verification (the channel's security core).
 *
 * Verifies a peer's auth frame in the /cello/anti-entropy/1.0.0 mutual handshake
 * (M12-ANTI-ENTROPY-DESIGN §1c): the peer must prove possession of its MANIFEST-PINNED node key,
 * its live PeerId must match the manifest (channel binding), the timestamp must be fresh, and the
 * nonce must match what we exchanged. Failures name the CAUSE (§6), never an exit-point label.
 * Fails CLOSED — any check failing rejects.
 */

import { describe, it, expect } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { buildAePeerAuthTbs, type AePeerAuthParams } from "@cello-protocol/crypto";
import { verifyPeerAuthFrame } from "../ae-handshake.js";
import type { ConsortiumManifest } from "@cello-protocol/protocol-types";

const seedB = new Uint8Array(32).fill(0xb);
const pubB = Buffer.from(ed25519.getPublicKey(seedB)).toString("hex");

const manifest: ConsortiumManifest = {
  version: 1,
  not_before: "2026-01-01T00:00:00Z",
  expires: "2027-01-01T00:00:00Z",
  nodes: [
    { nodeId: "gcp-usc1", pubkey: "a".repeat(64), region: "us-central1", provider: "gcp", endpoint: "https://a", role: "validator", peerId: "12D3KooWA" },
    { nodeId: "aws-use1", pubkey: pubB, region: "us-east-1", provider: "aws", endpoint: "https://b", role: "validator", peerId: "12D3KooWB" },
  ],
  signatures: [],
};

const params: AePeerAuthParams = {
  nodeIdA: "gcp-usc1", nodeIdB: "aws-use1", peerIdA: "12D3KooWA", peerIdB: "12D3KooWB",
  nonceAHex: "aa".repeat(32), nonceBHex: "bb".repeat(32), timestamp: "2026-07-28T10:00:00Z",
};
const nowMs = Date.parse(params.timestamp) + 5_000; // 5s later, within window
const sigB = ed25519.sign(buildAePeerAuthTbs(params), seedB);

// Verify B's frame from A's perspective (B is the peer being authenticated).
const base = {
  manifest, peerNodeId: "aws-use1", params, signature: sigB,
  actualPeerId: "12D3KooWB", expectedNonce: params.nonceBHex, expectedNonceSlot: "B" as const, nowMs,
};

describe("DOD-AE-APPEND-1: verifyPeerAuthFrame", () => {
  it("accepts a valid frame signed by the manifest-pinned node key", () => {
    expect(verifyPeerAuthFrame(base)).toEqual({ ok: true });
  });

  it("rejects when the nodeId is not in the manifest → manifest_pubkey_mismatch", () => {
    expect(verifyPeerAuthFrame({ ...base, peerNodeId: "azure-xyz" })).toEqual({ ok: false, reason: "manifest_pubkey_mismatch" });
  });

  it("rejects when the live PeerId != the manifest PeerId → peerid_mismatch (channel binding)", () => {
    expect(verifyPeerAuthFrame({ ...base, actualPeerId: "12D3KooWEvil" })).toEqual({ ok: false, reason: "peerid_mismatch" });
  });

  it("rejects a stale timestamp → timestamp_skew", () => {
    expect(verifyPeerAuthFrame({ ...base, nowMs: nowMs + 120_000 })).toEqual({ ok: false, reason: "timestamp_skew" });
    expect(verifyPeerAuthFrame({ ...base, nowMs: nowMs - 200_000 })).toEqual({ ok: false, reason: "timestamp_skew" });
  });

  it("rejects when the peer's nonce != the one we exchanged → nonce_mismatch (replay defense)", () => {
    expect(verifyPeerAuthFrame({ ...base, expectedNonce: "cc".repeat(32) })).toEqual({ ok: false, reason: "nonce_mismatch" });
  });

  it("rejects a signature by the WRONG key → signature_invalid", () => {
    const wrongSig = ed25519.sign(buildAePeerAuthTbs(params), new Uint8Array(32).fill(0xc));
    expect(verifyPeerAuthFrame({ ...base, signature: wrongSig })).toEqual({ ok: false, reason: "signature_invalid" });
  });

  it("rejects when the manifest node lacks a peerId (pre-M12 manifest) → manifest_pubkey_mismatch", () => {
    const noPeerId: ConsortiumManifest = {
      ...manifest,
      nodes: manifest.nodes.map((n) => (n.nodeId === "aws-use1" ? { ...n, peerId: undefined } : n)),
    };
    expect(verifyPeerAuthFrame({ ...base, manifest: noPeerId })).toEqual({ ok: false, reason: "manifest_pubkey_mismatch" });
  });

  it("the peer's slot nonce is checked before the signature — a swapped B-nonce → nonce_mismatch", () => {
    // The peer occupies slot B; a params.nonceBHex ≠ the nonce we exchanged is caught by the nonce
    // check (which precedes signature verification), naming the replay cause, not signature_invalid.
    expect(verifyPeerAuthFrame({ ...base, params: { ...params, nonceBHex: "dd".repeat(32) } })).toEqual({ ok: false, reason: "nonce_mismatch" });
  });
});
