/**
 * CELLO-M7-UPGRADE-001 (DOD-UP-1) — directory seal_upgrade_request handler (unit)
 *
 * The directory turns a unilateral seal into a bilateral one when the previously-ABSENT party (B)
 * returns and ratifies the EXISTING sealed root R1 (Model 2 — build journal 2026-06-23). This unit
 * test drives `#processSealUpgradeRequest` via the NODE_ENV=test seam against an in-memory store
 * seeded with a unilateral notarization, and proves:
 *
 *  - Happy path: a valid ack writes a SUPERSEDING bilateral row (seal_type 'bilateral',
 *    supersedes_notarization_id → the unilateral row, frost_signature = B's ack) WITHOUT mutating
 *    the unilateral row; the dual-attestation seal_upgrade_confirmed frame carries A's original seal
 *    signature AND B's ack, both over R1 (AC-008).
 *  - AC-007 sender check: a request from anyone other than the absent party is rejected
 *    (not_absent_party) and writes NO bilateral row.
 *  - KERNEL: a forged / wrong-root ack signature is rejected (ack_signature_invalid) and writes NO
 *    bilateral row — the directory never promotes on an unverifiable ratification.
 *  - no_unilateral_seal (nothing to upgrade) and already_bilateral (idempotent) rejects.
 *  - Frame codec round-trips for seal_upgrade_request / _confirmed / _rejected.
 *
 * Pure in-memory — no Postgres, no live binaries. The full live flow is J-UPGRADE (spine, incr 7).
 */
import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { Encoder } from "cbor-x";
import { generateKeypair, verify } from "@cello-protocol/crypto";
import { InMemoryDirectoryStore } from "@cello-protocol/interfaces/stubs";
import type { Logger, SealNotarization } from "@cello-protocol/interfaces";
import { createDirectoryNode, type RelayAdapter } from "../directory-node.js";
import {
  decodeInboundSignalingFrame,
  decodeOutboundSignalingFrame,
  encodeSealUpgradeConfirmed,
  encodeSealUpgradeRejected,
} from "../directory-frames.js";

const ENC = new Encoder({ tagUint8Array: false });

interface LogEntry { level: string; event: string; ctx: Record<string, unknown> }
function makeSpyLogger(sink: LogEntry[]): Logger {
  const mk = (level: string) => (event: string, ctx?: Record<string, unknown>) =>
    sink.push({ level, event, ctx: ctx ?? {} });
  return { info: mk("info"), warn: mk("warn"), error: mk("error"), debug: mk("debug") } as unknown as Logger;
}
function makeNoopRelay(): RelayAdapter {
  return {
    recordAssignment: () => ({ ok: true as const }),
    discardSession: () => {},
    submitForSeal: () => ({ ok: false as const, reason: "not_implemented" }),
    confirmSeal: () => {},
    rejectSeal: () => {},
  };
}

/** Strip the unsigned-varint length prefix that #sendFrame adds via lp.encode.single. */
function stripLpPrefix(sent: unknown): Uint8Array {
  const flat: Uint8Array = sent instanceof Uint8Array
    ? sent
    : (sent as { subarray(): Uint8Array }).subarray();
  let i = 0, shift = 0, len = 0;
  for (;;) {
    const b = flat[i++]!;
    len |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7;
  }
  return flat.subarray(i, i + len);
}

/** Mock stream that captures the bytes passed to send(). */
function makeCaptureStream(): { stream: import("@libp2p/interface").Stream; sent: unknown[] } {
  const sent: unknown[] = [];
  const stream = { send: (b: unknown) => { sent.push(b); } } as unknown as import("@libp2p/interface").Stream;
  return { stream, sent };
}

describe("DOD-UP-1: seal upgrade frame codec", () => {
  it("seal_upgrade_request decodes only with valid 16/32/64-byte fields", () => {
    const good = ENC.encode({
      type: "seal_upgrade_request",
      session_id: randomBytes(16),
      returning_pubkey: randomBytes(32),
      ack_signature: randomBytes(64),
      leaf_count: 3,
    });
    const decoded = decodeInboundSignalingFrame(good);
    expect(decoded?.type).toBe("seal_upgrade_request");

    // Wrong signature length → null.
    expect(decodeInboundSignalingFrame(ENC.encode({
      type: "seal_upgrade_request", session_id: randomBytes(16),
      returning_pubkey: randomBytes(32), ack_signature: randomBytes(32), leaf_count: 3,
    }))).toBeNull();
    // Missing leaf_count → null.
    expect(decodeInboundSignalingFrame(ENC.encode({
      type: "seal_upgrade_request", session_id: randomBytes(16),
      returning_pubkey: randomBytes(32), ack_signature: randomBytes(64),
    }))).toBeNull();
  });

  it("seal_upgrade_confirmed / _rejected round-trip through the outbound codec", () => {
    const sessionId = randomBytes(16);
    const confirmed = encodeSealUpgradeConfirmed({
      type: "seal_upgrade_confirmed",
      session_id: sessionId,
      sealed_root: randomBytes(32),
      leaf_count: 5,
      close_timestamp: 1234,
      present_pubkey: randomBytes(32),
      present_signature: randomBytes(64),
      present_signature_type: "frost",
      returning_pubkey: randomBytes(32),
      returning_signature: randomBytes(64),
      seal_type: "BILATERAL",
    });
    const dc = decodeOutboundSignalingFrame(confirmed);
    expect(dc?.type).toBe("seal_upgrade_confirmed");
    if (dc?.type === "seal_upgrade_confirmed") {
      expect(dc.present_signature_type).toBe("frost");
      expect(dc.seal_type).toBe("BILATERAL");
      expect(dc.close_timestamp).toBe(1234);
    }

    const rejected = encodeSealUpgradeRejected({ type: "seal_upgrade_rejected", session_id: sessionId, reason: "not_absent_party" });
    const dr = decodeOutboundSignalingFrame(rejected);
    expect(dr?.type).toBe("seal_upgrade_rejected");
    if (dr?.type === "seal_upgrade_rejected") expect(dr.reason).toBe("not_absent_party");
  });
});

describe("DOD-UP-1: #processSealUpgradeRequest handler", () => {
  async function setup() {
    const logs: LogEntry[] = [];
    const store = new InMemoryDirectoryStore();
    const { directory, stop } = await createDirectoryNode({
      keyProvider: generateKeypair(),
      relay: makeNoopRelay(),
      relayEndpoint: { peer_id: "relay-peer", multiaddrs: [] },
      store,
      logger: makeSpyLogger(logs),
    });
    const keyA = generateKeypair();
    const keyB = generateKeypair();
    const aPub = new Uint8Array(await keyA.getPublicKey());
    const bPub = new Uint8Array(await keyB.getPublicKey());
    const aHex = Buffer.from(aPub).toString("hex");
    const bHex = Buffer.from(bPub).toString("hex");
    const sessionId = new Uint8Array(randomBytes(16));
    const sessionIdHex = Buffer.from(sessionId).toString("hex");
    const sealedRoot = new Uint8Array(randomBytes(32));
    const aSealSig = new Uint8Array(randomBytes(64)); // A's original unilateral seal signature
    // Seed the unilateral notarization (participant_b = the ABSENT party B).
    const uni: SealNotarization = {
      session_id: sessionId,
      sealed_root: sealedRoot,
      participant_a_pubkey: aPub,
      participant_b_pubkey: bPub,
      close_timestamp: 9999,
      frost_signature: aSealSig,
      seal_type: "unilateral",
    };
    await store.recordNotarization(uni, { correlationId: sessionIdHex });
    return { directory, stop, store, logs, keyA, keyB, aPub, bPub, aHex, bHex, sessionId, sessionIdHex, sealedRoot, aSealSig };
  }

  it("happy path: valid B ack writes a superseding bilateral row + dual-attestation confirmed frame", async () => {
    const t = await setup();
    try {
      const ackTbs = t.directory.buildSealUpgradeAckTbsForTest(t.sessionId, t.sealedRoot);
      const ackSig = new Uint8Array(await t.keyB.sign(ackTbs));
      const { stream, sent } = makeCaptureStream();

      await t.directory.triggerSealUpgradeForTest(
        t.bHex,
        { type: "seal_upgrade_request", session_id: t.sessionId, returning_pubkey: t.bPub, ack_signature: ackSig, leaf_count: 3 },
        stream,
      );

      // Store: authoritative seal is now bilateral, superseding the unilateral row.
      const authoritative = await t.store.getNotarization(t.sessionIdHex);
      expect(authoritative?.seal_type).toBe("bilateral");
      expect(Buffer.from(authoritative!.frost_signature)).toEqual(Buffer.from(ackSig)); // B's ratification
      const uniId = await t.store.getNotarizationId(t.sessionIdHex, "unilateral");
      expect(authoritative?.supersedes_notarization_id).toBe(uniId);
      expect(Buffer.from(authoritative!.sealed_root)).toEqual(Buffer.from(t.sealedRoot)); // R1 unchanged

      // session.seal.upgraded logged with the right parties.
      const up = t.logs.find((l) => l.event === "session.seal.upgraded");
      expect(up, "session.seal.upgraded must fire").toBeDefined();
      expect(up!.ctx["correlationId"]).toBe(t.sessionIdHex);

      // Dual-attestation confirmed frame: A's original seal sig + B's ack, both over R1 (AC-008).
      const decoded = decodeOutboundSignalingFrame(stripLpPrefix(sent[0]));
      expect(decoded?.type).toBe("seal_upgrade_confirmed");
      if (decoded?.type === "seal_upgrade_confirmed") {
        expect(Buffer.from(decoded.present_signature)).toEqual(Buffer.from(t.aSealSig));
        expect(Buffer.from(decoded.returning_signature)).toEqual(Buffer.from(ackSig));
        expect(Buffer.from(decoded.sealed_root)).toEqual(Buffer.from(t.sealedRoot));
        // B's returning signature genuinely verifies over the ack TBS for R1.
        expect(verify(t.bPub, ackTbs, decoded.returning_signature)).toBe(true);
      }
    } finally {
      await t.stop();
    }
  });

  it("AC-007: a request from someone other than the absent party is rejected, no bilateral row", async () => {
    const t = await setup();
    try {
      const ackTbs = t.directory.buildSealUpgradeAckTbsForTest(t.sessionId, t.sealedRoot);
      // A third party (impostor) signs a valid-looking ack but is NOT the absent party.
      const impostor = generateKeypair();
      const impostorPub = new Uint8Array(await impostor.getPublicKey());
      const impostorHex = Buffer.from(impostorPub).toString("hex");
      const ackSig = new Uint8Array(await impostor.sign(ackTbs));
      const { stream, sent } = makeCaptureStream();

      await t.directory.triggerSealUpgradeForTest(
        impostorHex,
        { type: "seal_upgrade_request", session_id: t.sessionId, returning_pubkey: impostorPub, ack_signature: ackSig, leaf_count: 3 },
        stream,
      );

      expect((await t.store.getNotarization(t.sessionIdHex))?.seal_type).toBe("unilateral"); // unchanged
      expect(await t.store.getNotarizationId(t.sessionIdHex, "bilateral")).toBeUndefined();
      const rej = t.logs.find((l) => l.event === "session.upgrade.rejected");
      expect(rej?.ctx["reason"]).toBe("not_absent_party");
      const decoded = decodeOutboundSignalingFrame(stripLpPrefix(sent[0]));
      expect(decoded?.type === "seal_upgrade_rejected" && decoded.reason).toBe("not_absent_party");
    } finally {
      await t.stop();
    }
  });

  it("AC-007 ISOLATED: a delegate on a third-party channel with B's REAL pubkey+ack is still rejected", async () => {
    // Isolates the authenticated-sender check from the frame-body check: the frame claims B's true
    // returning_pubkey and carries a VALID B-signed ack — only the authenticated senderHex differs.
    // A pure frame-body check would accept this (delegation); the senderHex==absent check must reject.
    const t = await setup();
    try {
      const ackTbs = t.directory.buildSealUpgradeAckTbsForTest(t.sessionId, t.sealedRoot);
      const validBAck = new Uint8Array(await t.keyB.sign(ackTbs)); // genuinely B's signature
      const thirdPartyHex = Buffer.from(new Uint8Array(await generateKeypair().getPublicKey())).toString("hex");
      const { stream, sent } = makeCaptureStream();

      await t.directory.triggerSealUpgradeForTest(
        thirdPartyHex, // authenticated channel identity is NOT B
        { type: "seal_upgrade_request", session_id: t.sessionId, returning_pubkey: t.bPub, ack_signature: validBAck, leaf_count: 3 },
        stream,
      );

      expect((await t.store.getNotarization(t.sessionIdHex))?.seal_type).toBe("unilateral");
      expect(await t.store.getNotarizationId(t.sessionIdHex, "bilateral")).toBeUndefined();
      const decoded = decodeOutboundSignalingFrame(stripLpPrefix(sent[0]));
      expect(decoded?.type === "seal_upgrade_rejected" && decoded.reason).toBe("not_absent_party");
    } finally {
      await t.stop();
    }
  });

  it("KERNEL: a forged ack signature is rejected (ack_signature_invalid), no bilateral row", async () => {
    const t = await setup();
    try {
      // B is the right sender, but the ack signature is over the WRONG root (a channel-swap / forgery).
      const wrongTbs = t.directory.buildSealUpgradeAckTbsForTest(t.sessionId, new Uint8Array(randomBytes(32)));
      const badSig = new Uint8Array(await t.keyB.sign(wrongTbs));
      const { stream, sent } = makeCaptureStream();

      await t.directory.triggerSealUpgradeForTest(
        t.bHex,
        { type: "seal_upgrade_request", session_id: t.sessionId, returning_pubkey: t.bPub, ack_signature: badSig, leaf_count: 3 },
        stream,
      );

      expect((await t.store.getNotarization(t.sessionIdHex))?.seal_type).toBe("unilateral");
      expect(await t.store.getNotarizationId(t.sessionIdHex, "bilateral")).toBeUndefined();
      const rej = t.logs.find((l) => l.event === "session.upgrade.rejected");
      expect(rej?.ctx["reason"]).toBe("ack_signature_invalid");
      const decoded = decodeOutboundSignalingFrame(stripLpPrefix(sent[0]));
      expect(decoded?.type === "seal_upgrade_rejected" && decoded.reason).toBe("ack_signature_invalid");
    } finally {
      await t.stop();
    }
  });

  it("no_unilateral_seal: upgrade for an unknown session is rejected", async () => {
    const t = await setup();
    try {
      const unknownSession = new Uint8Array(randomBytes(16));
      const ackTbs = t.directory.buildSealUpgradeAckTbsForTest(unknownSession, t.sealedRoot);
      const ackSig = new Uint8Array(await t.keyB.sign(ackTbs));
      const { stream, sent } = makeCaptureStream();
      await t.directory.triggerSealUpgradeForTest(
        t.bHex,
        { type: "seal_upgrade_request", session_id: unknownSession, returning_pubkey: t.bPub, ack_signature: ackSig, leaf_count: 3 },
        stream,
      );
      const decoded = decodeOutboundSignalingFrame(stripLpPrefix(sent[0]));
      expect(decoded?.type === "seal_upgrade_rejected" && decoded.reason).toBe("no_unilateral_seal");
    } finally {
      await t.stop();
    }
  });

  it("already_bilateral: a second upgrade is idempotently rejected", async () => {
    const t = await setup();
    try {
      const ackTbs = t.directory.buildSealUpgradeAckTbsForTest(t.sessionId, t.sealedRoot);
      const ackSig = new Uint8Array(await t.keyB.sign(ackTbs));
      const frame = { type: "seal_upgrade_request" as const, session_id: t.sessionId, returning_pubkey: t.bPub, ack_signature: ackSig, leaf_count: 3 };
      await t.directory.triggerSealUpgradeForTest(t.bHex, frame, makeCaptureStream().stream); // first upgrade succeeds
      const { stream, sent } = makeCaptureStream();
      await t.directory.triggerSealUpgradeForTest(t.bHex, frame, stream); // second is rejected
      const decoded = decodeOutboundSignalingFrame(stripLpPrefix(sent[0]));
      expect(decoded?.type === "seal_upgrade_rejected" && decoded.reason).toBe("already_bilateral");
    } finally {
      await t.stop();
    }
  });
});
