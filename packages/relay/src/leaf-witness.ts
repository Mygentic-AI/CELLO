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
import { createHash } from "node:crypto";
import { verify } from "@cello-protocol/crypto";
import { encodeCbor } from "@cello-protocol/protocol-types";

export type LeafWitnessVerdict =
  /** The leaf verifies under one of the expected keys. `signer` is WHICH — never the frame's claim. */
  | { ok: true; signer: Uint8Array }
  /** The leaf verifies under NEITHER expected key — nobody in this session signed it. */
  | { ok: false; reason: "leaf_signed_by_neither_participant" };

/**
 * @param expectedKeys the session's participant pubkeys, from the recorded assignment. **Order is a
 *   performance hint only** — put the likeliest signer first (the authenticated connection's key)
 *   and the common case costs ONE Ed25519 verify on the relay's hot path instead of two. The accept
 *   set is identical whichever order they arrive in, so no caller can widen it by reordering.
 * @param structure1Cbor the exact bytes the sender signed
 * @param senderSignature the 64-byte Ed25519 signature carried on the submit (RFC 8032)
 */
export function witnessLeafSignature(
  expectedKeys: readonly Uint8Array[],
  structure1Cbor: Uint8Array,
  senderSignature: Uint8Array,
): LeafWitnessVerdict {
  for (const key of expectedKeys) {
    if (verify(key, structure1Cbor, senderSignature)) return { ok: true, signer: key };
  }
  return { ok: false, reason: "leaf_signed_by_neither_participant" };
}

/**
 * The bytes a relay signs when it reports what it witnessed — `DOD-M15-CORROBORATE-1` review F3.
 *
 * ⚠️ **MIRRORED CODEC.** `cello-client`'s `session-relay-client.ts` reconstructs these exact bytes to
 * verify the signature. The two implementations MUST stay in sync, the same contract
 * `encodeSessionLivenessResponse` carries — which is why both sides call `encodeCbor` from
 * `@cello-protocol/protocol-types` rather than each configuring an encoder.
 *
 * A fixed-order ARRAY with a domain tag in slot 0, per that module's own rule: its map encoding
 * follows insertion order and is not minimal, so no signed structure in CELLO is ever a map.
 *
 * ⚠️ **AND THE RECIPIENT IS DELIBERATELY NOT BOUND IN.** Both participants receive the same
 * observation about the same submission, so one signature covers both and binding a recipient would
 * buy nothing. What it does mean: an alert one participant holds is not distinguishable from the
 * other's. That is fine for what this is — a statement about a session, not about a person.
 */
export const RELAY_WITNESS_DOMAIN = "CELLO-RELAY-WITNESS-v1";

export function buildWitnessAlertTbs(
  sessionId: Uint8Array,
  reason: string,
  observedAt: number,
  submitterIsCounterparty: boolean,
): Uint8Array {
  const body = encodeCbor([RELAY_WITNESS_DOMAIN, sessionId, reason, observedAt, submitterIsCounterparty]);
  return new Uint8Array(createHash("sha256").update(body).digest());
}
