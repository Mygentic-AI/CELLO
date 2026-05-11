/**
 * FROST DKG frame CBOR codec — /cello/frost/1.0.0 DKG round frames
 *
 * These are the three round-trip exchanges for the real interactive DKG ceremony.
 * Each round uses a new stream (one stream per round per directory node).
 *
 * Encoding: canonical CBOR per RFC 8949 §4.2.1
 * Framing: it-length-prefixed (handled by caller)
 *
 * Crypto reference: RFC 9591 (FROST DKG), RFC 8032 (Ed25519)
 */

import { Encoder, decode } from "cbor-x";
import type {
  FrostDkgRound1Request,
  FrostDkgRound1Response,
  FrostDkgRound2Request,
  FrostDkgRound2Response,
  FrostDkgRound3Request,
  FrostDkgRound3Response,
  DkgRound1Broadcast,
  DkgRound2Share,
} from "@cello/protocol-types";

const ENC = new Encoder({ tagUint8Array: false });

// ─── Encode (client → directory) ──────────────────────────────────────────────

export function encodeFrostDkgRound1Request(req: FrostDkgRound1Request): Uint8Array {
  return ENC.encode({
    type: req.type,
    agentPubkey: req.agentPubkey,
    epochId: req.epochId,
    signers: req.signers,
  });
}

export function encodeFrostDkgRound2Request(req: FrostDkgRound2Request): Uint8Array {
  return ENC.encode({
    type: req.type,
    agentPubkey: req.agentPubkey,
    epochId: req.epochId,
    othersRound1: req.othersRound1.map(serializeRound1Broadcast),
  });
}

export function encodeFrostDkgRound3Request(req: FrostDkgRound3Request): Uint8Array {
  return ENC.encode({
    type: req.type,
    agentPubkey: req.agentPubkey,
    epochId: req.epochId,
    sharesForMe: req.sharesForMe.map(serializeRound2Share),
    allOthersRound1: req.allRound1.map(serializeRound1Broadcast),
  });
}

// ─── Encode (directory → client) ──────────────────────────────────────────────

export function encodeFrostDkgRound1Response(resp: FrostDkgRound1Response): Uint8Array {
  if (resp.ok) {
    return ENC.encode({
      type: resp.type,
      ok: true,
      broadcast: serializeRound1Broadcast(resp.broadcast),
    });
  }
  return ENC.encode({ type: resp.type, ok: false, reason: resp.reason });
}

export function encodeFrostDkgRound2Response(resp: FrostDkgRound2Response): Uint8Array {
  if (resp.ok) {
    return ENC.encode({
      type: resp.type,
      ok: true,
      sharesForOthers: resp.sharesForOthers.map(serializeRound2Share),
    });
  }
  return ENC.encode({ type: resp.type, ok: false, reason: resp.reason });
}

export function encodeFrostDkgRound3Response(resp: FrostDkgRound3Response): Uint8Array {
  if (resp.ok) {
    return ENC.encode({ type: resp.type, ok: true, shareCommitment: resp.shareCommitment });
  }
  return ENC.encode({ type: resp.type, ok: false, reason: resp.reason });
}

// ─── Decode (directory ← client) ──────────────────────────────────────────────

export function decodeFrostDkgRequest(
  bytes: Uint8Array,
): FrostDkgRound1Request | FrostDkgRound2Request | FrostDkgRound3Request | null {
  let obj: unknown;
  try { obj = decode(bytes); } catch { return null; }
  if (typeof obj !== "object" || obj === null) return null;
  const o = obj as Record<string, unknown>;

  if (o["type"] === "frost_dkg_round1_request") {
    const agentPubkey = typeof o["agentPubkey"] === "string" ? o["agentPubkey"] : null;
    const epochId = typeof o["epochId"] === "string" ? o["epochId"] : null;
    const signers = parseSigners(o["signers"]);
    if (!agentPubkey || !epochId || !signers) return null;
    return { type: "frost_dkg_round1_request", agentPubkey, epochId, signers };
  }

  if (o["type"] === "frost_dkg_round2_request") {
    const agentPubkey = typeof o["agentPubkey"] === "string" ? o["agentPubkey"] : null;
    const epochId = typeof o["epochId"] === "string" ? o["epochId"] : null;
    const othersRound1 = parseRound1BroadcastArray(o["othersRound1"]);
    if (!agentPubkey || !epochId || !othersRound1) return null;
    return { type: "frost_dkg_round2_request", agentPubkey, epochId, othersRound1 };
  }

  if (o["type"] === "frost_dkg_round3_request") {
    const agentPubkey = typeof o["agentPubkey"] === "string" ? o["agentPubkey"] : null;
    const epochId = typeof o["epochId"] === "string" ? o["epochId"] : null;
    const sharesForMe = parseRound2ShareArray(o["sharesForMe"]);
    // Accept both allOthersRound1 (new wire format from client) and allRound1 (legacy)
    const allRound1 = parseRound1BroadcastArray(o["allOthersRound1"] ?? o["allRound1"]);
    if (!agentPubkey || !epochId || !sharesForMe || !allRound1) return null;
    return { type: "frost_dkg_round3_request", agentPubkey, epochId, sharesForMe, allRound1 };
  }

  return null;
}

// ─── Decode (client ← directory) ──────────────────────────────────────────────

export function decodeFrostDkgResponse(
  bytes: Uint8Array,
): FrostDkgRound1Response | FrostDkgRound2Response | FrostDkgRound3Response | null {
  let obj: unknown;
  try { obj = decode(bytes); } catch { return null; }
  if (typeof obj !== "object" || obj === null) return null;
  const o = obj as Record<string, unknown>;

  if (o["type"] === "frost_dkg_round1_response") {
    const ok = o["ok"];
    if (ok === true) {
      const broadcast = parseRound1Broadcast(o["broadcast"]);
      if (!broadcast) return null;
      return { type: "frost_dkg_round1_response", ok: true, broadcast };
    }
    const reason = o["reason"];
    if (reason !== "already_in_progress" && reason !== "internal_error") return null;
    return { type: "frost_dkg_round1_response", ok: false, reason };
  }

  if (o["type"] === "frost_dkg_round2_response") {
    const ok = o["ok"];
    if (ok === true) {
      const sharesForOthers = parseRound2ShareArray(o["sharesForOthers"]);
      if (!sharesForOthers) return null;
      return { type: "frost_dkg_round2_response", ok: true, sharesForOthers };
    }
    const reason = o["reason"];
    if (reason !== "round1_not_complete" && reason !== "verification_failed" && reason !== "internal_error") return null;
    return { type: "frost_dkg_round2_response", ok: false, reason };
  }

  if (o["type"] === "frost_dkg_round3_response") {
    const ok = o["ok"];
    if (ok === true) {
      const sc = o["shareCommitment"];
      // shareCommitment is sent as a hex string (from directory's round3 handler)
      const shareCommitment = typeof sc === "string"
        ? new Uint8Array(Buffer.from(sc, "hex"))
        : sc instanceof Uint8Array ? sc
        : Buffer.isBuffer(sc) ? new Uint8Array(sc as Buffer)
        : null;
      if (!shareCommitment || shareCommitment.length !== 32) return null;
      return { type: "frost_dkg_round3_response", ok: true, shareCommitment };
    }
    const reason = o["reason"];
    if (reason !== "round2_not_complete" && reason !== "share_verification_failed" && reason !== "internal_error") return null;
    return { type: "frost_dkg_round3_response", ok: false, reason };
  }

  return null;
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function toUint8Array(v: unknown): Uint8Array | null {
  if (v instanceof Uint8Array) return v;
  if (Buffer.isBuffer(v)) return new Uint8Array(v as Buffer);
  return null;
}

function serializeRound1Broadcast(b: DkgRound1Broadcast): Record<string, unknown> {
  return {
    identifier: b.identifier,
    commitment: b.commitment,
    proofOfKnowledge: b.proofOfKnowledge,
  };
}

function serializeRound2Share(s: DkgRound2Share): Record<string, unknown> {
  return {
    signerIdentifier: s.signerIdentifier,
    targetIdentifier: s.targetIdentifier,
    signingShare: s.signingShare,
  };
}

function parseSigners(v: unknown): { min: number; max: number } | null {
  if (typeof v !== "object" || v === null) return null;
  const s = v as Record<string, unknown>;
  const min = typeof s["min"] === "number" ? s["min"] : null;
  const max = typeof s["max"] === "number" ? s["max"] : null;
  if (min === null || max === null) return null;
  return { min, max };
}

function parseRound1Broadcast(v: unknown): DkgRound1Broadcast | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const identifier = typeof o["identifier"] === "string" ? o["identifier"] : null;
  const proofOfKnowledge = toUint8Array(o["proofOfKnowledge"]);
  const rawCommitment = o["commitment"];
  if (!identifier || !proofOfKnowledge) return null;
  if (!Array.isArray(rawCommitment)) return null;
  const commitment: Uint8Array[] = [];
  for (const item of rawCommitment) {
    const b = toUint8Array(item);
    if (!b) return null;
    commitment.push(b);
  }
  return { identifier, commitment, proofOfKnowledge };
}

function parseRound1BroadcastArray(v: unknown): DkgRound1Broadcast[] | null {
  if (!Array.isArray(v)) return null;
  const result: DkgRound1Broadcast[] = [];
  for (const item of v) {
    const b = parseRound1Broadcast(item);
    if (!b) return null;
    result.push(b);
  }
  return result;
}

function parseRound2Share(v: unknown): DkgRound2Share | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  // Accept both "identifier" (new wire format) and "signerIdentifier" (legacy)
  const signerIdentifier =
    typeof o["identifier"] === "string" ? o["identifier"] :
    typeof o["signerIdentifier"] === "string" ? o["signerIdentifier"] :
    null;
  const targetIdentifier = typeof o["targetIdentifier"] === "string" ? o["targetIdentifier"] : null;
  const signingShare = toUint8Array(o["signingShare"]);
  if (!signerIdentifier || !targetIdentifier || !signingShare) return null;
  return { signerIdentifier, targetIdentifier, signingShare };
}

function parseRound2ShareArray(v: unknown): DkgRound2Share[] | null {
  if (!Array.isArray(v)) return null;
  const result: DkgRound2Share[] = [];
  for (const item of v) {
    const s = parseRound2Share(item);
    if (!s) return null;
    result.push(s);
  }
  return result;
}
