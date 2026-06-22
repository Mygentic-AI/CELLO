/**
 * Harness content-seal helper (M7 MSG-001-3b / DOD-MSG-7).
 *
 * Reproduces the ENCRYPT side of `sealToRecipient` from core/crypto/src/content-seal.ts
 * byte-for-byte, so the harness can seed SEALED parked content that a recipient daemon's
 * `openContentSeal` decrypts correctly. (The published @cello-protocol/crypto the e2e package
 * resolves predates the content-seal module — same skew as the manifest fixtures — so it cannot be
 * imported; this mirrors it via @noble directly. The live test is still binary-anchored: the
 * recipient DAEMON decrypts + ingests; the harness only constructs the sealed blob a real sender
 * would, and — for the tamper case — deliberately pairs it with a MISMATCHED content_hash.)
 *
 * Construction (must match content-seal.ts exactly): X25519 ephemeral-static ECDH over the
 * recipient's Ed25519→Montgomery key, HKDF-SHA256(ikm=shared, salt=ephPk, info="cello-content-
 * park-v1"), AES-256-GCM. Blob = ephPk(32) || iv(12) || ct || tag(16). RFC 7748 / 5869 / SP 800-38D.
 */
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { createCipheriv, randomBytes } from "node:crypto";

const IV_BYTES = 12;
const KEY_BYTES = 32;
const HKDF_INFO = new TextEncoder().encode("cello-content-park-v1");
const Fp = ed25519.Point.Fp;

/** Ed25519 public key (Edwards y) → Montgomery u (RFC 7748 §4.1): u = (1+y)/(1-y) mod p. */
function edwardsPubToMontgomeryU(edPub: Uint8Array): Uint8Array {
  const pt = ed25519.Point.fromBytes(edPub);
  const y = pt.toAffine().y;
  const denom = Fp.sub(Fp.ONE, y);
  if (Fp.is0(denom)) throw new Error("content-seal-fixture: invalid recipient Ed25519 public key");
  const u = Fp.div(Fp.add(Fp.ONE, y), denom);
  return Fp.toBytes(u);
}

/** Encrypt `plaintext` to a recipient's Ed25519 public key — identical to the daemon's sealToRecipient. */
export function sealToRecipient(recipientEd25519Pub: Uint8Array, plaintext: Uint8Array): Uint8Array {
  const uPub = edwardsPubToMontgomeryU(recipientEd25519Pub);
  const ephSk = x25519.utils.randomSecretKey();
  const ephPk = x25519.getPublicKey(ephSk);
  const shared = x25519.getSharedSecret(ephSk, uPub);
  const key = hkdf(sha256, shared, ephPk, HKDF_INFO, KEY_BYTES);
  const iv = new Uint8Array(randomBytes(IV_BYTES));
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key), Buffer.from(iv));
  const ct = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
  const tag = cipher.getAuthTag();
  return new Uint8Array(Buffer.concat([Buffer.from(ephPk), Buffer.from(iv), ct, tag]));
}

/** The content_hash the daemon computes + cross-checks: SHA-256(0x00 || content). */
export function contentHashHex(content: Uint8Array): string {
  return Buffer.from(sha256(new Uint8Array([0x00, ...content]))).toString("hex");
}
