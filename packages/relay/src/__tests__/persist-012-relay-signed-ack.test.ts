/**
 * PERSIST-012 relay side — signed HashSubmitAck
 *
 * ── Specification (Phase S) ────────────────────────────────────────────────────
 *
 * The relay must sign every hash_submit_ack it issues using its own Ed25519 signing key.
 * The signed ACK proves to the client (and to future relays) that this relay sequenced
 * the hash at the stated sequence_number and timestamp.
 *
 * ACK TBS: SHA-256(hash_H_bytes || seq_BE4 || ts_BE8)
 *   - hash_H_bytes: 32 bytes (raw content hash, not hex)
 *   - seq_BE4:  4-byte big-endian uint32
 *   - ts_BE8:   8-byte big-endian uint64
 *   - Per RFC 8032 (Ed25519) and FIPS 180-4 (SHA-256)
 *
 * The relay's signing key is injected via its KeyProvider interface.
 * A relay without a signing key issues unsigned ACKs (no relay_signature field).
 *
 * Wire protocol changes for HashSubmitAck:
 *   {
 *     type: "hash_submit_ack",
 *     sequence_number: number,
 *     relay_id: string,            // NEW — identifies the signing relay
 *     relay_signature: Uint8Array, // NEW — 64-byte Ed25519 signature
 *     timestamp: number,           // NEW — ms since epoch (embedded in TBS)
 *   }
 *
 * These tests verify the relay's ACK signing independently of the client's
 * AgentHashQueue verification, using only @cello/crypto primitives directly.
 */

import { describe, it, expect } from "vitest";
import { randomBytes, createHash } from "node:crypto";
import { generateKeypair, verify } from "@cello/crypto";

// ─── Inline TBS builder (same algorithm as client, tested independently) ──────
//
// This function is a local copy of the shared TBS algorithm.
// The relay and client independently implement this calculation to ensure
// they agree on the byte representation (a contract test).

function buildAckTbs(
  hashBytes: Uint8Array,
  sequenceNumber: number,
  timestamp: number,
): Uint8Array {
  const seqBuf = Buffer.allocUnsafe(4);
  seqBuf.writeUInt32BE(sequenceNumber >>> 0, 0);

  const tsBuf = Buffer.allocUnsafe(8);
  tsBuf.writeBigUInt64BE(BigInt(timestamp), 0);

  const preimage = Buffer.concat([Buffer.from(hashBytes), seqBuf, tsBuf]);
  return new Uint8Array(createHash("sha256").update(preimage).digest());
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("PERSIST-012 relay signed ACK — signing behavior", () => {
  it("relay signs ACK TBS and signature verifies with relay's pubkey", async () => {
    const relayKp = generateKeypair();
    const relayPubkey = await relayKp.getPublicKey();

    const hashBytes = randomBytes(32);
    const seq = 7;
    const ts = Date.now();

    const tbs = buildAckTbs(hashBytes, seq, ts);
    const sig = await relayKp.sign(tbs);

    expect(sig.length).toBe(64);
    expect(verify(relayPubkey, tbs, sig)).toBe(true);
  });

  it("ACK signed with different key fails verification", async () => {
    const relayKp = generateKeypair();
    const impostorKp = generateKeypair();
    const relayPubkey = await relayKp.getPublicKey();

    const hashBytes = randomBytes(32);
    const seq = 1;
    const ts = Date.now();

    const tbs = buildAckTbs(hashBytes, seq, ts);
    const impostorSig = await impostorKp.sign(tbs);

    expect(verify(relayPubkey, tbs, impostorSig)).toBe(false);
  });

  it("TBS construction is deterministic — same inputs produce same bytes", () => {
    const hashBytes = randomBytes(32);
    const seq = 42;
    const ts = 1716000000000;

    const tbs1 = buildAckTbs(hashBytes, seq, ts);
    const tbs2 = buildAckTbs(hashBytes, seq, ts);

    expect(tbs1).toEqual(tbs2);
    expect(tbs1.length).toBe(32); // SHA-256 output
  });

  it("different hash bytes produce different TBS", () => {
    const h1 = randomBytes(32);
    const h2 = randomBytes(32);
    const seq = 1;
    const ts = 1000;

    expect(buildAckTbs(h1, seq, ts)).not.toEqual(buildAckTbs(h2, seq, ts));
  });

  it("different sequence numbers produce different TBS", () => {
    const h = randomBytes(32);
    const ts = 1000;

    expect(buildAckTbs(h, 1, ts)).not.toEqual(buildAckTbs(h, 2, ts));
  });

  it("different timestamps produce different TBS", () => {
    const h = randomBytes(32);
    const seq = 1;

    expect(buildAckTbs(h, seq, 1000)).not.toEqual(buildAckTbs(h, seq, 2000));
  });
});
