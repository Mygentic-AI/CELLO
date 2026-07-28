/**
 * Anti-entropy handshake verification — the `/cello/anti-entropy/1.0.0` channel's security core
 * (M12 DOD-AE-APPEND-1; M12-ANTI-ENTROPY-DESIGN §1c/§6).
 *
 * Verifies a peer's auth frame in the mutual, manifest-pinned handshake. A frame is accepted only
 * if ALL hold (fail closed — any failure rejects):
 *  - the peer's claimed nodeId is in the (already officer-verified) manifest, WITH a pinned pubkey
 *    and peerId;
 *  - the peer's LIVE libp2p PeerId (observed on the Noise-authenticated connection) equals the
 *    manifest-pinned peerId AND the peerId bound in the signed TBS — channel binding;
 *  - the nonce in the peer's slot equals the nonce THIS node exchanged — per-direction replay
 *    defense;
 *  - the timestamp is within the freshness window;
 *  - the signature verifies against the manifest-pinned node key (via verifyAePeerAuth).
 *
 * Failure reasons name the CAUSE (§6 observability), never an exit-point label. The caller (the
 * channel handler) is responsible for single-use nonce accounting and for taking `actualPeerId`
 * from the real Noise connection — this function verifies, it does not manage state.
 */

import { verifyAePeerAuth, type AePeerAuthParams } from "@cello-protocol/crypto";
import type { ConsortiumManifest } from "@cello-protocol/protocol-types";

export type HandshakeFailReason =
  | "manifest_pubkey_mismatch"
  | "peerid_mismatch"
  | "nonce_mismatch"
  | "timestamp_skew"
  | "signature_invalid";

export interface VerifyPeerAuthInput {
  /** The officer-verified consortium manifest (verify it BEFORE calling — see §1b). */
  manifest: ConsortiumManifest;
  /** The nodeId the peer claims to be. */
  peerNodeId: string;
  /** The agreed handshake params (byte-identical on both sides; roles A=dialer). */
  params: AePeerAuthParams;
  /** The peer's Ed25519 signature over buildAePeerAuthTbs(params). */
  signature: Uint8Array;
  /** The peer's libp2p PeerId as observed on the Noise-authenticated connection. */
  actualPeerId: string;
  /** The nonce THIS node exchanged for the peer's slot (single-use, minted by us). */
  expectedNonce: string;
  /** Which slot the PEER occupies (A=dialer, B=responder). */
  expectedNonceSlot: "A" | "B";
  /** Current time (epoch ms). */
  nowMs: number;
  /** Max |now − timestamp| allowed. Default 60s. */
  maxSkewMs?: number;
}

export function verifyPeerAuthFrame(
  input: VerifyPeerAuthInput,
): { ok: true } | { ok: false; reason: HandshakeFailReason } {
  const { manifest, peerNodeId, params, signature, actualPeerId, expectedNonce, expectedNonceSlot, nowMs } = input;
  const maxSkewMs = input.maxSkewMs ?? 60_000;

  const node = manifest.nodes.find((n) => n.nodeId === peerNodeId);
  // No manifest entry, or a pre-M12 entry lacking a pinned pubkey/peerId → cannot channel-bind.
  if (!node || !node.pubkey || !node.peerId) return { ok: false, reason: "manifest_pubkey_mismatch" };

  const claimedPeerId = expectedNonceSlot === "B" ? params.peerIdB : params.peerIdA;
  // Channel binding: the live PeerId AND the TBS-bound peerId must both equal the manifest peerId.
  if (actualPeerId !== node.peerId || claimedPeerId !== node.peerId) {
    return { ok: false, reason: "peerid_mismatch" };
  }

  const claimedNonce = expectedNonceSlot === "B" ? params.nonceBHex : params.nonceAHex;
  if (claimedNonce !== expectedNonce) return { ok: false, reason: "nonce_mismatch" };

  const ts = Date.parse(params.timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowMs - ts) > maxSkewMs) {
    return { ok: false, reason: "timestamp_skew" };
  }

  if (!verifyAePeerAuth(node.pubkey, params, signature)) {
    return { ok: false, reason: "signature_invalid" };
  }

  return { ok: true };
}
