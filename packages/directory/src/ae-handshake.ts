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
  /** The peer is not in our manifest at all — it is not a consortium member, or our manifest is stale. */
  | "node_not_in_manifest"
  /** Present, but missing a pinned `pubkey` or `peerId` — a pre-M12 entry needing re-publication. */
  | "manifest_entry_incomplete"
  /** The TBS names the same node/peer on both sides — reflection, or two manifest entries sharing an identity. */
  | "self_dial"
  /** The TBS's claimed nodeId is not the node we dialed. */
  | "node_id_mismatch"
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
  /** The peer's libp2p PeerId as observed on the Noise-authenticated connection (never a wire claim). */
  actualPeerId: string;
  /** Which slot THIS verifier occupies — "A" if we dialed, "B" if we're the responder. */
  localSlot: "A" | "B";
  /**
   * The nonce THIS node minted for ITS OWN slot and put in ae_hello/ae_auth. This is the replay
   * gate (§1c line 85 "each side checks the one it minted"): the peer's signed TBS must contain
   * our fresh challenge, so a replayed transcript from another stream fails.
   */
  localMintedNonce: string;
  /** The nonce we RECEIVED from the peer (their slot). Checked too — both directions bind. */
  peerNonce: string;
  /** Current time (epoch ms). */
  nowMs: number;
  /** Max |now − timestamp| allowed. Default 60s. */
  maxSkewMs?: number;
}

export function verifyPeerAuthFrame(
  input: VerifyPeerAuthInput,
): { ok: true } | { ok: false; reason: HandshakeFailReason } {
  const { manifest, peerNodeId, params, signature, actualPeerId, localSlot, localMintedNonce, peerNonce, nowMs } = input;
  const maxSkewMs = input.maxSkewMs ?? 60_000;
  const peerSlot = localSlot === "A" ? "B" : "A";

  // F6: bind the TBS's OWN nodeId for the peer slot, not just its peerId. Both callers currently
  // derive the two from one value, so this is unexploitable today — but the contract at the top of
  // this file ("the peer's claimed nodeId is in the manifest") was enforced by caller discipline
  // alone, in an exported security core that is tested independently of its callers.
  const peerClaimedNodeId = peerSlot === "B" ? params.nodeIdB : params.nodeIdA;
  if (peerClaimedNodeId !== peerNodeId) return { ok: false, reason: "node_id_mismatch" };

  // F5: self-dial / reflection, checked explicitly. `buildAePeerAuthTbs` throws on
  // nodeIdA === nodeIdB, and `verifyAePeerAuth` swallows that to false — so this used to surface as
  // `signature_invalid`, pointing the operator at key material for what is actually an
  // anti-reflection violation or a manifest where two entries share an identity.
  if (params.nodeIdA === params.nodeIdB || params.peerIdA === params.peerIdB) {
    return { ok: false, reason: "self_dial" };
  }

  const node = manifest.nodes.find((n) => n.nodeId === peerNodeId);
  // THREE distinct causes, three distinct operator actions — one reason name conflated them, and
  // none of them is a "mismatch" (no pubkey is compared here). It also drove a retry: the rotation
  // -skew handler keys on `manifest_pubkey_mismatch`, so "this peer is not in my manifest at all"
  // triggered a manifest re-read plus a second full dial, per unknown peer, every interval.
  if (!node) return { ok: false, reason: "node_not_in_manifest" };
  if (!node.pubkey) return { ok: false, reason: "manifest_entry_incomplete" };
  if (!node.peerId) return { ok: false, reason: "manifest_entry_incomplete" };

  // Channel binding: the live PeerId AND the peer's TBS-bound peerId must both equal the manifest
  // peerId. (The peer occupies peerSlot in the TBS.)
  const peerClaimedPeerId = peerSlot === "B" ? params.peerIdB : params.peerIdA;
  if (actualPeerId !== node.peerId || peerClaimedPeerId !== node.peerId) {
    return { ok: false, reason: "peerid_mismatch" };
  }

  // Replay defense, BOTH directions: the peer's signed TBS must contain the nonce WE minted for our
  // slot (freshness — the load-bearing check, since we chose it) AND the nonce we received from the
  // peer for its slot. Checking only the peer's nonce would gate on a value the peer/attacker picks.
  const ourNonceInTbs = localSlot === "A" ? params.nonceAHex : params.nonceBHex;
  const peerNonceInTbs = peerSlot === "A" ? params.nonceAHex : params.nonceBHex;
  if (ourNonceInTbs !== localMintedNonce || peerNonceInTbs !== peerNonce) {
    return { ok: false, reason: "nonce_mismatch" };
  }

  // Freshness (defense-in-depth). Require an explicit UTC/offset timestamp — a tz-less ISO string
  // is parsed as LOCAL time, so two nodes in different regions would compute the window off by
  // their offset. Malformed/tz-less → fail closed.
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/.test(params.timestamp)) return { ok: false, reason: "timestamp_skew" };
  const ts = Date.parse(params.timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowMs - ts) > maxSkewMs) {
    return { ok: false, reason: "timestamp_skew" };
  }

  if (!verifyAePeerAuth(node.pubkey, params, signature)) {
    return { ok: false, reason: "signature_invalid" };
  }

  return { ok: true };
}
