/**
 * DOD-M15-CORROBORATE-1 — verify a submitted leaf against the SESSION's two expected participant
 * keys, at the moment it arrives.
 *
 * ⚠️ **THE KEY IT VERIFIES AGAINST IS THE POINT.** The relay already ran `verify(...)` on every
 * submit, against `structure1.sender_pubkey` — a key carried inside the frame being checked. That
 * proves the frame is internally consistent and nothing about WHO sent it: a signature is proof only
 * when it is checked against something the signer does not control. The two keys here come from the
 * directory-signed `SessionAssignment` the relay recorded before the conversation started, which
 * neither participant can rewrite.
 *
 * No new cryptography. This is the check `directory-node.ts` already runs over each leaf when it
 * adjudicates a seal (`verify(sender_pubkey, structure1_cbor, sender_signature)`), moved to
 * submission time. Same primitive, same bytes: the ORIGINAL `structure1_cbor` as signed, never
 * re-encoded — a re-encode changes the CBOR timestamp representation and breaks verification on
 * frames that are perfectly valid.
 *
 * Content is not read and is not required: a signature verifies against a hash and a pubkey (INV-3).
 */
import { verify } from "@cello-protocol/crypto";

export type LeafWitnessVerdict =
  /** The leaf verifies under one of the two expected keys. `signerIsA` says which. */
  | { ok: true; signerIsA: boolean }
  /** The leaf verifies under NEITHER expected key — nobody in this session signed it. */
  | { ok: false; reason: "leaf_signed_by_neither_participant" };

/**
 * @param participantA 32-byte pubkey from the recorded session assignment
 * @param participantB 32-byte pubkey from the recorded session assignment
 * @param structure1Cbor the exact bytes the sender signed
 * @param senderSignature the 64-byte Ed25519 signature carried on the submit (RFC 8032)
 */
export function witnessLeafSignature(
  participantA: Uint8Array,
  participantB: Uint8Array,
  structure1Cbor: Uint8Array,
  senderSignature: Uint8Array,
): LeafWitnessVerdict {
  if (verify(participantA, structure1Cbor, senderSignature)) return { ok: true, signerIsA: true };
  if (verify(participantB, structure1Cbor, senderSignature)) return { ok: true, signerIsA: false };
  return { ok: false, reason: "leaf_signed_by_neither_participant" };
}
