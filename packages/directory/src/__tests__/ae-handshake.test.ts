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

// Verify B's frame from A's perspective: WE are the dialer (slot A), the peer is B.
const base = {
  manifest, peerNodeId: "aws-use1", params, signature: sigB, actualPeerId: "12D3KooWB",
  localSlot: "A" as const, localMintedNonce: params.nonceAHex, peerNonce: params.nonceBHex, nowMs,
};

describe("DOD-AE-APPEND-1: verifyPeerAuthFrame", () => {
  it("accepts a valid frame signed by the manifest-pinned node key", () => {
    expect(verifyPeerAuthFrame(base)).toEqual({ ok: true });
  });

  it("rejects when the nodeId is not in the manifest → manifest_pubkey_mismatch", () => {
    expect(verifyPeerAuthFrame({ ...base, peerNodeId: "azure-xyz" })).toEqual({ ok: false, reason: "manifest_pubkey_mismatch" });
  });

  it("REPLAY over a different connection: valid frame+sig but wrong live PeerId → peerid_mismatch", () => {
    // The attacker replays B's legitimately-signed frame over its own Noise connection. actualPeerId
    // is the attacker's, ≠ B's manifest peerId → rejected before the (valid) signature is trusted.
    expect(verifyPeerAuthFrame({ ...base, actualPeerId: "12D3KooWEvil" })).toEqual({ ok: false, reason: "peerid_mismatch" });
  });

  it("rejects when the peer's TBS-bound peerId != manifest peerId → peerid_mismatch (binding disjunct)", () => {
    expect(verifyPeerAuthFrame({ ...base, params: { ...params, peerIdB: "12D3KooWOther" } })).toEqual({ ok: false, reason: "peerid_mismatch" });
  });

  it("rejects a stale timestamp → timestamp_skew (both directions)", () => {
    expect(verifyPeerAuthFrame({ ...base, nowMs: nowMs + 120_000 })).toEqual({ ok: false, reason: "timestamp_skew" });
    expect(verifyPeerAuthFrame({ ...base, nowMs: nowMs - 200_000 })).toEqual({ ok: false, reason: "timestamp_skew" });
  });

  it("rejects a timezone-less or malformed timestamp → timestamp_skew (avoids local-time skew)", () => {
    expect(verifyPeerAuthFrame({ ...base, params: { ...params, timestamp: "2026-07-28T10:00:00" } })).toEqual({ ok: false, reason: "timestamp_skew" });
    expect(verifyPeerAuthFrame({ ...base, params: { ...params, timestamp: "not-a-date" } })).toEqual({ ok: false, reason: "timestamp_skew" });
  });

  it("REPLAY defense: gates on the nonce WE minted (our slot), not the peer-controlled one", () => {
    // The load-bearing fix: if the peer's TBS doesn't contain OUR fresh challenge, reject — even
    // though the peer's own nonce is fine. A verifier that (buggily) checked only the peer's slot
    // would pass this.
    expect(verifyPeerAuthFrame({ ...base, localMintedNonce: "cc".repeat(32) })).toEqual({ ok: false, reason: "nonce_mismatch" });
  });

  it("REPLAY defense: also gates on the peer's nonce we received (both directions)", () => {
    expect(verifyPeerAuthFrame({ ...base, peerNonce: "cc".repeat(32) })).toEqual({ ok: false, reason: "nonce_mismatch" });
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

  it("nonce is checked before signature — a swapped nonce names the replay cause, not signature_invalid", () => {
    expect(verifyPeerAuthFrame({ ...base, params: { ...params, nonceAHex: "dd".repeat(32) } })).toEqual({ ok: false, reason: "nonce_mismatch" });
  });
});
