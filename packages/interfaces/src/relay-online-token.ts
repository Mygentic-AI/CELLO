/**
 * 008-RELAY — the relay online token.
 *
 * ─── What problem this solves ─────────────────────────────────────────────────────────────────
 *
 * A relay holds a bounded number of circuit reservation slots — the standing invitations that make
 * an agent behind NAT reachable at all. Before this, it granted them to anyone who could sign the
 * relay's own challenge. That proves possession of *a* keypair, which is free to generate, so an
 * attacker mints as many keys as there are slots and no real agent can be reached by anyone.
 *
 * The missing fact is REGISTRATION, and only a directory holds it. The directory learns an agent is
 * starting one step before the relay is contacted at all: the daemon opens its signaling stream, the
 * directory authenticates it and marks the agent online, and only THEN does the standing receiver
 * ask a relay for a slot. So the directory signs a short-lived statement — *this public key is a
 * registered agent, valid until T* — the client carries it to the relay, and the relay verifies one
 * signature against directory keys it already holds. No round trip on the reservation path.
 *
 * ─── Why the token is opaque bytes ────────────────────────────────────────────────────────────
 *
 * The client never reads it. It receives the bytes with its signaling auth acknowledgement, keeps
 * them, and hands them back when a relay asks. That is deliberate: a format the client does not
 * parse is a format the client cannot get wrong, and it keeps the client repo out of a wire change
 * that concerns only the directory and the relay.
 *
 * ─── Layout ───────────────────────────────────────────────────────────────────────────────────
 *
 *   token (104 bytes) = agent_pubkey(32) || expires_at_ms(8, big-endian) || signature(64)
 *
 *   TBS (signed bytes) = "cello-relay-online-token-v1" || 0x00 || agent_pubkey(32) || expires_at(8)
 *
 * Fixed-width fields behind a constant domain prefix. There is no length field, no optional field
 * and no canonicalisation question, so two implementations cannot disagree about what was signed —
 * which is the failure mode that makes a signature check decorative. The domain prefix is what stops
 * a directory signature produced for some OTHER structure from being replayed here.
 *
 * Ed25519 per RFC 8032: the signature is over the TBS bytes directly. Ed25519 hashes its own input,
 * so pre-hashing would add a step without adding a property.
 *
 * ─── What this token is NOT ───────────────────────────────────────────────────────────────────
 *
 * It is not authorization to talk to anyone. Who may DIAL an agent through a relay is a separate,
 * unconditional check against a directory-signed session assignment. This token answers only "is the
 * key asking for a slot a registered agent's key", which is the question the slot table needs and
 * the one nothing could answer before.
 */

import { ed25519 } from "@noble/curves/ed25519.js";

/** UTF-8 domain separator. Bump the version suffix if the layout below ever changes. */
export const ONLINE_TOKEN_DOMAIN = "cello-relay-online-token-v1";

/** agent_pubkey(32) + expires_at_ms(8) + signature(64). */
export const ONLINE_TOKEN_BYTES = 104;

const PUBKEY_BYTES = 32;
const EXPIRY_BYTES = 8;
const SIGNATURE_BYTES = 64;
const EXPIRY_OFFSET = PUBKEY_BYTES;
const SIGNATURE_OFFSET = PUBKEY_BYTES + EXPIRY_BYTES;

/**
 * The longest lifetime a VERIFIER will accept, regardless of what the signature says.
 *
 * Revocation of these tokens is deliberately nothing more than waiting for one to expire — which is
 * only true while lifetimes are short. This ceiling is what keeps that true: a directory that is
 * buggy, misconfigured or captured cannot mint a pass that outlives the incident, because the relay
 * refuses it on arrival. Two hours leaves generous room above the one-hour issuance lifetime for
 * clock skew between sovereign nodes without becoming a meaningful window.
 */
export const ONLINE_TOKEN_MAX_LIFETIME_MS = 2 * 60 * 60 * 1000;

/** How long a directory issues for. Well inside `ONLINE_TOKEN_MAX_LIFETIME_MS`. */
export const ONLINE_TOKEN_ISSUE_LIFETIME_MS = 60 * 60 * 1000;

/**
 * Refusal reasons. These travel to the operator and are branched on by the daemon, so they are
 * enumerated rather than free text — see the relay's refusal surface.
 */
export type OnlineTokenFailure =
  /** Not `ONLINE_TOKEN_BYTES` long. Refused before anything is read out of it. */
  | "online_token_malformed"
  /** Well-formed, but no configured directory key signed it. */
  | "online_token_signature_invalid"
  /** Well-formed and signed, but `expires_at_ms` has passed. */
  | "online_token_expired"
  /** Signed, unexpired, and claiming a lifetime this verifier will not honour. */
  | "online_token_lifetime_too_long"
  /**
   * The verifier holds no directory public keys, so it CANNOT check this token. It refuses. A
   * verifier that cannot verify must never wave the caller through — that is precisely how a check
   * like this becomes decorative while looking installed.
   */
  | "online_token_no_directory_key";

export type OnlineTokenVerification =
  | { ok: true; agentPubkey: Uint8Array; expiresAtMs: number }
  | { ok: false; reason: OnlineTokenFailure };

/** The exact bytes a directory signs. Exported so a test can assert the domain is really in there. */
export function onlineTokenTbs(agentPubkey: Uint8Array, expiresAtMs: number): Uint8Array {
  const domain = new TextEncoder().encode(ONLINE_TOKEN_DOMAIN);
  const tbs = new Uint8Array(domain.length + 1 + PUBKEY_BYTES + EXPIRY_BYTES);
  tbs.set(domain, 0);
  tbs[domain.length] = 0x00;
  tbs.set(agentPubkey, domain.length + 1);
  new DataView(tbs.buffer, tbs.byteOffset).setBigUint64(
    domain.length + 1 + PUBKEY_BYTES,
    BigInt(expiresAtMs),
    false,
  );
  return tbs;
}

export interface MintOnlineTokenParams {
  /** The registered agent's 32-byte Ed25519 public key (`k_local_pubkey`). */
  agentPubkey: Uint8Array;
  /** Absolute expiry, epoch milliseconds. */
  expiresAtMs: number;
  /** Ed25519 signature over the TBS bytes, by a consortium directory node's key. */
  sign: (tbs: Uint8Array) => Promise<Uint8Array>;
}

/**
 * Mint a token. Throws rather than returning a token nobody can verify — a malformed token emitted
 * here would surface much later as an unexplained refusal at a relay, far from its cause.
 */
export async function mintOnlineToken(params: MintOnlineTokenParams): Promise<Uint8Array> {
  const { agentPubkey, expiresAtMs } = params;
  if (agentPubkey.length !== PUBKEY_BYTES) {
    throw new Error(`agentPubkey must be ${String(PUBKEY_BYTES)} bytes, got ${String(agentPubkey.length)}`);
  }
  if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs < 0) {
    throw new Error(`expiresAtMs must be a non-negative safe integer, got ${String(expiresAtMs)}`);
  }

  const signature = await params.sign(onlineTokenTbs(agentPubkey, expiresAtMs));
  if (signature.length !== SIGNATURE_BYTES) {
    throw new Error(`signature must be ${String(SIGNATURE_BYTES)} bytes, got ${String(signature.length)}`);
  }

  const token = new Uint8Array(ONLINE_TOKEN_BYTES);
  token.set(agentPubkey, 0);
  new DataView(token.buffer).setBigUint64(EXPIRY_OFFSET, BigInt(expiresAtMs), false);
  token.set(signature, SIGNATURE_OFFSET);
  return token;
}

/**
 * Verify a token against the consortium directory keys this verifier holds.
 *
 * `directoryPubkeys` is the same any-directory set the relay already uses for session assignments: a
 * token is valid if ANY sovereign node in the consortium signed it, because the agent connects to
 * whichever directory it reached and it does not matter which one that was.
 */
export function verifyOnlineToken(
  token: Uint8Array,
  directoryPubkeys: readonly Uint8Array[],
  nowMs: number,
): OnlineTokenVerification {
  if (token.length !== ONLINE_TOKEN_BYTES) {
    return { ok: false, reason: "online_token_malformed" };
  }
  if (directoryPubkeys.length === 0) {
    return { ok: false, reason: "online_token_no_directory_key" };
  }

  const agentPubkey = token.slice(0, PUBKEY_BYTES);
  const expiresAtRaw = new DataView(token.buffer, token.byteOffset).getBigUint64(EXPIRY_OFFSET, false);
  const signature = token.slice(SIGNATURE_OFFSET);

  // A 64-bit expiry that does not fit a JS safe integer cannot be compared honestly, so it is
  // malformed rather than merely far in the future.
  if (expiresAtRaw > BigInt(Number.MAX_SAFE_INTEGER)) {
    return { ok: false, reason: "online_token_malformed" };
  }
  const expiresAtMs = Number(expiresAtRaw);

  const tbs = onlineTokenTbs(agentPubkey, expiresAtMs);
  const signed = directoryPubkeys.some((pk) => {
    try {
      return ed25519.verify(signature, tbs, pk);
    } catch {
      // A malformed configured key must not abort the loop — another entry may be the real signer.
      return false;
    }
  });
  if (!signed) return { ok: false, reason: "online_token_signature_invalid" };

  if (nowMs >= expiresAtMs) return { ok: false, reason: "online_token_expired" };
  if (expiresAtMs - nowMs > ONLINE_TOKEN_MAX_LIFETIME_MS) {
    return { ok: false, reason: "online_token_lifetime_too_long" };
  }

  return { ok: true, agentPubkey, expiresAtMs };
}
