/**
 * M8B FINDING-3 (cascade-2) — a unilateral seal must yield the SAME durable, legible
 * receipt a bilateral seal does, with the counterparty recorded ABSENT.
 *
 * Root cause (directory half): the seal_unilateral_confirmed frame carried only
 * sealed_root/frost_signature/leaf_count/close_timestamp/signature_type — NO legibility
 * object — so the present party's daemon had nothing to persist and cello_get_sealed_receipt
 * returned sealed_receipt_not_found. The bilateral seal_certificate / session_sealed frame
 * carries the full legibility (receipt-not-assent, per-party frontiers, attestation modes,
 * final_message). This directory change ships that same legibility on the unilateral frame.
 *
 * TDD Phase R — these are RED until #processSealUnilateral derives the legibility from the
 * verified leaves and #completeUnilateralNotarization attaches it to the cert (and the wire
 * encoder carries it).
 *
 * Crypto refs: Ed25519 RFC 8032, CBOR canonical RFC 8949, SHA-256 FIPS 180-4.
 */
import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { decode, Encoder } from "cbor-x";
import {
  generateKeypair,
  buildMerkleTree,
  merkleRoot,
  buildRelayAckTbs,
} from "@cello-protocol/crypto";
import { buildStructure2, encodeStructure2 } from "@cello-protocol/protocol-types";
import type { Logger } from "@cello-protocol/interfaces";
import { createDirectoryNode, unilateralNotificationFromPayload, type RelayAdapter } from "../directory-node.js";
import { encodeSealUnilateralConfirmed } from "../directory-frames.js";
import { buildSealLegibility } from "../seal-legibility.js";
import type { SealUnilateralLeaf, SealFrontierLeaf } from "../directory-types.js";

const ENC = new Encoder({ tagUint8Array: false });
type Kp = ReturnType<typeof generateKeypair>;

interface LogEntry { level: string; event: string; ctx: Record<string, unknown> }
function makeSpyLogger(sink: LogEntry[]): Logger {
  const mk = (level: string) => (event: string, ctx?: Record<string, unknown>) =>
    sink.push({ level, event, ctx: ctx ?? {} });
  return { info: mk("info"), warn: mk("warn"), error: mk("error"), debug: mk("debug") } as unknown as Logger;
}

/**
 * A relay that positively reports the absent party GONE — the directory's DOD-LIVE-2
 * liveness authority. Drives the seal to record the counterparty ABSENT.
 */
function makeGoneRelay(): RelayAdapter {
  return {
    recordAssignment: () => ({ ok: true as const }),
    discardSession: () => {},
    submitForSeal: () => ({ ok: false as const, reason: "not_implemented" }),
    confirmSeal: () => {},
    rejectSeal: () => {},
    getSessionLiveness: async () => "gone" as const,
  } as unknown as RelayAdapter;
}

const hex = (u: Uint8Array): string => Buffer.from(u).toString("hex");

/**
 * Build a valid CLIENT-CARRIED unilateral leaf chain (present A, absent B):
 *   L1: A msg  seq1  last_seen 0  (own → relay-receipted)
 *   L2: B msg  seq2  last_seen 1  (counterparty → no receipt)
 *   L3: A ctrl seq3  last_seen 2  (own SEAL ceremony leaf → relay-receipted)
 *
 * Passes #verifyUnilateralChain (content-hash root == reported_root, signed Structure1,
 * prev_root chain, last_seen constraints, exactly one ctrl leaf from A) and
 * reconstructCarriedSealLeaves (own leaves witnessed, contiguous). The derived legibility
 * has A 'live' (produced the trailing SEAL ctrl), B 'absent' (content only), with
 * asymmetric content frontiers A=2, B=1.
 */
async function buildUnilateralCarry(
  keyA: Kp,
  keyB: Kp,
  relayKp: Kp,
  sessionId: Uint8Array,
): Promise<{ leaves: SealUnilateralLeaf[]; reportedRoot: Uint8Array }> {
  const pubA = new Uint8Array(await keyA.getPublicKey());
  const pubB = new Uint8Array(await keyB.getPublicKey());
  const relayId = hex(new Uint8Array(await relayKp.getPublicKey()));
  const ch1 = new Uint8Array(randomBytes(32));
  const ch2 = new Uint8Array(randomBytes(32));
  const ch3 = new Uint8Array(randomBytes(32));

  const receipt = async (ch: Uint8Array, seq: number, ts: number): Promise<Partial<SealUnilateralLeaf>> => ({
    relay_id: relayId,
    relay_timestamp: ts,
    relay_signature: new Uint8Array(await relayKp.sign(buildRelayAckTbs(ch, seq, ts))),
  });

  // L1: A msg seq1, last_seen 0, prev_root zeros
  const s1A1 = ENC.encode([1, ch1, pubA, sessionId, 0, 100]) as Uint8Array;
  const s2A1 = buildStructure2(1, pubA, ch1, new Uint8Array(await keyA.sign(s1A1)), new Uint8Array(32));
  if (!s2A1.ok) throw new Error("s2A1");
  const cA1 = encodeStructure2(s2A1.structure2);

  // L2: B msg seq2, last_seen 1, prev_root = root over [L1 msg]
  const prev2 = merkleRoot(buildMerkleTree([{ kind: "msg", data: cA1 }]));
  const s1B1 = ENC.encode([1, ch2, pubB, sessionId, 1, 101]) as Uint8Array;
  const s2B1 = buildStructure2(2, pubB, ch2, new Uint8Array(await keyB.sign(s1B1)), prev2);
  if (!s2B1.ok) throw new Error("s2B1");
  const cB1 = encodeStructure2(s2B1.structure2);

  // L3: A ctrl seq3 (SEAL), last_seen 2, prev_root = root over [L1 msg, L2 msg]
  const prev3 = merkleRoot(buildMerkleTree([{ kind: "msg", data: cA1 }, { kind: "msg", data: cB1 }]));
  const s1A2 = ENC.encode([1, ch3, pubA, sessionId, 2, 102]) as Uint8Array;
  const s2A2 = buildStructure2(3, pubA, ch3, new Uint8Array(await keyA.sign(s1A2)), prev3);
  if (!s2A2.ok) throw new Error("s2A2");

  const reportedRoot = merkleRoot(buildMerkleTree([
    { kind: "hash", data: ch1 },
    { kind: "hash", data: ch2 },
    { kind: "hash", data: ch3 },
  ]));

  const leaves: SealUnilateralLeaf[] = [
    { sequence_number: 1, leaf_kind: 0, structure2_cbor: cA1, structure1_cbor: s1A1, ...(await receipt(ch1, 1, 100)) },
    { sequence_number: 2, leaf_kind: 0, structure2_cbor: cB1, structure1_cbor: s1B1 },
    { sequence_number: 3, leaf_kind: 2, structure2_cbor: encodeStructure2(s2A2.structure2), structure1_cbor: s1A2, ...(await receipt(ch3, 3, 102)) },
  ];
  return { leaves, reportedRoot };
}

/**
 * The live-scenario chain: the absent counterparty authored NOTHING (it only RECEIVED and
 * then vanished). Present A: msg seq1 + SEAL ctrl seq2, both relay-receipted. B has no leaf.
 * The receipt must STILL name B as ABSENT (a synthetic zero-frontier participant).
 */
async function buildUnilateralCarrySilentAbsent(
  keyA: Kp,
  relayKp: Kp,
  sessionId: Uint8Array,
): Promise<{ leaves: SealUnilateralLeaf[]; reportedRoot: Uint8Array }> {
  const pubA = new Uint8Array(await keyA.getPublicKey());
  const relayId = hex(new Uint8Array(await relayKp.getPublicKey()));
  const ch1 = new Uint8Array(randomBytes(32));
  const ch2 = new Uint8Array(randomBytes(32));
  const receipt = async (ch: Uint8Array, seq: number, ts: number): Promise<Partial<SealUnilateralLeaf>> => ({
    relay_id: relayId,
    relay_timestamp: ts,
    relay_signature: new Uint8Array(await relayKp.sign(buildRelayAckTbs(ch, seq, ts))),
  });

  // L1: A msg seq1, last_seen 0
  const s1A1 = ENC.encode([1, ch1, pubA, sessionId, 0, 100]) as Uint8Array;
  const s2A1 = buildStructure2(1, pubA, ch1, new Uint8Array(await keyA.sign(s1A1)), new Uint8Array(32));
  if (!s2A1.ok) throw new Error("s2A1");
  const cA1 = encodeStructure2(s2A1.structure2);

  // L2: A ctrl (SEAL) seq2, last_seen 0 (no counterparty leaf precedes it)
  const prev2 = merkleRoot(buildMerkleTree([{ kind: "msg", data: cA1 }]));
  const s1A2 = ENC.encode([1, ch2, pubA, sessionId, 0, 101]) as Uint8Array;
  const s2A2 = buildStructure2(2, pubA, ch2, new Uint8Array(await keyA.sign(s1A2)), prev2);
  if (!s2A2.ok) throw new Error("s2A2");

  const reportedRoot = merkleRoot(buildMerkleTree([
    { kind: "hash", data: ch1 },
    { kind: "hash", data: ch2 },
  ]));
  const leaves: SealUnilateralLeaf[] = [
    { sequence_number: 1, leaf_kind: 0, structure2_cbor: cA1, structure1_cbor: s1A1, ...(await receipt(ch1, 1, 100)) },
    { sequence_number: 2, leaf_kind: 2, structure2_cbor: encodeStructure2(s2A2.structure2), structure1_cbor: s1A2, ...(await receipt(ch2, 2, 101)) },
  ];
  return { leaves, reportedRoot };
}

describe("FINDING-3 (directory): unilateral seal ships a legibility certificate", () => {
  it("records the absent counterparty ABSENT even when it authored NO leaf (received-only, then gone)", async () => {
    const logs: LogEntry[] = [];
    const dirKp = generateKeypair();
    const { directory, stop } = await createDirectoryNode({
      keyProvider: dirKp,
      listenAddresses: ["/ip4/127.0.0.1/tcp/0"],
      relay: makeGoneRelay(),
      relayEndpoint: { peer_id: "relay-peer-id", multiaddrs: ["/ip4/127.0.0.1/tcp/0"] },
      logger: makeSpyLogger(logs),
      deliveryGraceSeconds: 0,
    });
    try {
      const keyA = generateKeypair();
      const keyB = generateKeypair();
      const relayKp = generateKeypair();
      const aHex = hex(new Uint8Array(await keyA.getPublicKey()));
      const bHex = hex(new Uint8Array(await keyB.getPublicKey())); // B authors nothing
      const sessionId = new Uint8Array(randomBytes(16));
      const { leaves, reportedRoot } = await buildUnilateralCarrySilentAbsent(keyA, relayKp, sessionId);

      const mockStream = { send: () => {} } as unknown as import("@libp2p/interface").Stream;
      await directory.triggerSealUnilateralWithLeavesForTest(aHex, sessionId, reportedRoot, bHex, leaves, mockStream);

      expect(logs.find((l) => l.event === "session.unilateral.notarized"), "seal must notarize").toBeDefined();
      const legBuilt = logs.find((l) => l.event === "session.unilateral.legibility.built");
      expect(legBuilt, "legibility must be built").toBeDefined();
      // Both parties named: present A + the received-only, now-absent B.
      expect(legBuilt!.ctx["participantCount"]).toBe(2);
      expect(legBuilt!.ctx["absentAttestation"]).toBe("absent");
    } finally {
      await stop();
    }
  });


  it("the seal_unilateral_confirmed cert carries legibility — present party 'live', absent party 'absent', per-party frontiers", async () => {
    const logs: LogEntry[] = [];
    const dirKp = generateKeypair();
    const { directory, stop } = await createDirectoryNode({
      keyProvider: dirKp,
      listenAddresses: ["/ip4/127.0.0.1/tcp/0"],
      relay: makeGoneRelay(),
      relayEndpoint: { peer_id: "relay-peer-id", multiaddrs: ["/ip4/127.0.0.1/tcp/0"] },
      logger: makeSpyLogger(logs),
      deliveryGraceSeconds: 0,
    });

    try {
      const keyA = generateKeypair();
      const keyB = generateKeypair();
      const relayKp = generateKeypair();
      const aHex = hex(new Uint8Array(await keyA.getPublicKey()));
      const bHex = hex(new Uint8Array(await keyB.getPublicKey()));
      const sessionId = new Uint8Array(randomBytes(16));
      const { leaves, reportedRoot } = await buildUnilateralCarry(keyA, keyB, relayKp, sessionId);

      const mockStream = { send: () => {} } as unknown as import("@libp2p/interface").Stream;
      await directory.triggerSealUnilateralWithLeavesForTest(aHex, sessionId, reportedRoot, bHex, leaves, mockStream);

      // The seal must have completed (single-key path — no primary pubkey registered).
      const notarized = logs.find((l) => l.event === "session.unilateral.notarized");
      expect(notarized, `seal must notarize: ${JSON.stringify(logs.map((l) => l.event))}`).toBeDefined();
      expect(notarized!.ctx["attestation"]).toBe("ABSENT");

      // FINDING-3: the directory must derive + attach the legibility certificate for the
      // unilateral seal (the observability event that fires only when legibility is built).
      const legBuilt = logs.find((l) => l.event === "session.unilateral.legibility.built");
      expect(legBuilt, "directory must build legibility for the unilateral seal").toBeDefined();
      expect(legBuilt!.ctx["participantCount"]).toBe(2);
      expect(legBuilt!.ctx["absentAttestation"]).toBe("absent");
    } finally {
      await stop();
    }
  });

  it("buildSealLegibility with the absent-party override marks the counterparty 'absent' and the present party 'live'", async () => {
    // Unit-level guard on the exact derivation the handler must perform: from the verified
    // unilateral chain, the present party (produced the trailing SEAL ctrl) is 'live' and the
    // absent counterparty (content only) is 'absent', with asymmetric content frontiers.
    const keyA = generateKeypair();
    const keyB = generateKeypair();
    const relayKp = generateKeypair();
    const aHex = hex(new Uint8Array(await keyA.getPublicKey()));
    const bHex = hex(new Uint8Array(await keyB.getPublicKey()));
    const sessionId = new Uint8Array(randomBytes(16));
    const { leaves } = await buildUnilateralCarry(keyA, keyB, relayKp, sessionId);

    // Reconstruct RelaySealLeaf[] exactly as the directory does before deriving legibility.
    const { reconstructCarriedSealLeaves } = await import("../seal-unilateral-verify.js");
    const carried = reconstructCarriedSealLeaves(leaves, aHex);
    expect(carried.ok, `carry must reconstruct: ${JSON.stringify(carried)}`).toBe(true);
    if (!carried.ok) return;

    const leg = buildSealLegibility(carried.leaves, {
      attestationOverrides: new Map([[bHex, "absent"]]),
    });
    const pA = leg.participants.find((p) => hex(p.pubkey) === aHex);
    const pB = leg.participants.find((p) => hex(p.pubkey) === bHex);
    expect(pA?.attestation_mode).toBe("live");
    expect(pB?.attestation_mode).toBe("absent");
    expect(pA?.content_frontier_seq).toBe(2);
    expect(pB?.content_frontier_seq).toBe(1);
    expect(leg.attests).toBe("receipt");
    expect(leg.implies_assent).toBe(false);
  });
});

describe("FINDING-3 (directory durable path): the absent-party notification survives a restart WITH legibility", () => {
  // Reviewer Critical 1: the Postgres notification-queue payload must carry legibility too — an absent
  // party reconnecting AFTER a directory restart is served from the durable queue, not the in-memory
  // map. The reconstruction must round-trip the legibility (byte pubkeys intact via CBOR-hex).
  it("unilateralNotificationFromPayload rebuilds legibility from legibility_cbor_hex", async () => {
    const keyA = generateKeypair();
    const keyB = generateKeypair();
    const relayKp = generateKeypair();
    const aPub = new Uint8Array(await keyA.getPublicKey());
    const bPub = new Uint8Array(await keyB.getPublicKey());
    const sessionId = new Uint8Array(randomBytes(16));
    const { leaves } = await buildUnilateralCarry(keyA, keyB, relayKp, sessionId);
    const { reconstructCarriedSealLeaves } = await import("../seal-unilateral-verify.js");
    const carried = reconstructCarriedSealLeaves(leaves, hex(aPub));
    if (!carried.ok) throw new Error("carry");
    const legibility = buildSealLegibility(carried.leaves, { attestationOverrides: new Map([[hex(bPub), "absent"]]) });

    // Exactly what #completeUnilateralNotarization writes into the durable payload.
    const payload: Record<string, unknown> = {
      session_id_hex: hex(sessionId),
      sealed_root_hex: "aa".repeat(32),
      sealed_at: 102,
      leaf_count: 3,
      close_timestamp: 102,
      frost_signature_hex: "00".repeat(64),
      signature_type: "single",
      present_pubkey_hex: hex(aPub),
      absent_pubkey_hex: hex(bPub),
      attestation_mode: "ABSENT",
      legibility_cbor_hex: Buffer.from(ENC.encode(legibility)).toString("hex"),
    };

    const notif = unilateralNotificationFromPayload(payload);
    expect(notif, "payload must reconstruct").not.toBeNull();
    expect(notif!.legibility, "durable notification must carry legibility").toBeDefined();
    const pB = notif!.legibility!.participants.find((p) => hex(p.pubkey) === hex(bPub));
    expect(pB?.attestation_mode).toBe("absent");
    // Byte pubkeys must survive the CBOR round-trip (a JSON.stringify would have mangled them).
    expect(notif!.legibility!.participants.every((p) => p.pubkey instanceof Uint8Array)).toBe(true);
  });

  it("a payload WITHOUT legibility still reconstructs (pre-cascade-2 back-compat) — cert delivers, no legibility", () => {
    const payload: Record<string, unknown> = {
      session_id_hex: "11".repeat(16),
      sealed_root_hex: "aa".repeat(32),
      sealed_at: 1,
      leaf_count: 2,
      close_timestamp: 1,
      frost_signature_hex: "00".repeat(64),
      signature_type: "single",
      present_pubkey_hex: "22".repeat(32),
      absent_pubkey_hex: "33".repeat(32),
      attestation_mode: "ABSENT",
    };
    const notif = unilateralNotificationFromPayload(payload);
    expect(notif).not.toBeNull();
    expect(notif!.legibility).toBeUndefined();
  });
});

describe("FINDING-3 (directory wire): the confirmed-frame encoder carries legibility", () => {
  it("encodeSealUnilateralConfirmed round-trips the legibility object", async () => {
    const keyA = generateKeypair();
    const keyB = generateKeypair();
    const relayKp = generateKeypair();
    const aHex = hex(new Uint8Array(await keyA.getPublicKey()));
    const bHex = hex(new Uint8Array(await keyB.getPublicKey()));
    const sessionId = new Uint8Array(randomBytes(16));
    const { leaves } = await buildUnilateralCarry(keyA, keyB, relayKp, sessionId);
    const { reconstructCarriedSealLeaves } = await import("../seal-unilateral-verify.js");
    const carried = reconstructCarriedSealLeaves(leaves, aHex);
    if (!carried.ok) throw new Error("carry");
    const legibility = buildSealLegibility(carried.leaves, { attestationOverrides: new Map([[bHex, "absent"]]) });

    const bytes = encodeSealUnilateralConfirmed({
      type: "seal_unilateral_confirmed",
      session_id: sessionId,
      sealed_at: 102,
      sealed_root: new Uint8Array(randomBytes(32)),
      leaf_count: 3,
      close_timestamp: 102,
      frost_signature: new Uint8Array(64),
      signature_type: "single",
      present_pubkey: new Uint8Array(await keyA.getPublicKey()),
      absent_pubkey: new Uint8Array(await keyB.getPublicKey()),
      attestation_mode: "ABSENT",
      seal_type: "UNILATERAL",
      legibility,
    });

    const decoded = decode(bytes) as Record<string, unknown>;
    expect(decoded["legibility"], "confirmed frame must carry legibility on the wire").toBeDefined();
    const leg = decoded["legibility"] as { attests?: string; participants?: unknown[] };
    expect(leg.attests).toBe("receipt");
    expect(Array.isArray(leg.participants)).toBe(true);
    expect(leg.participants).toHaveLength(2);
  });
});

/**
 * M8B FINDING-5 (cascade-2) — the present party must be able to INDEPENDENTLY re-derive each
 * party's content_frontier_seq from the SIGNED leaves (SI-002), instead of trusting the directory's
 * published frontier on the receipt-of-last-resort. The bilateral seal_verified/session_sealed
 * frames already ship `frontier_leaves` for exactly this; the unilateral seal_unilateral_confirmed
 * frame must carry them too so the present party's daemon can re-derive + reject an inflated frontier.
 *
 * Scope: only the seal_unilateral_confirmed frame (the PRESENT party, always live/in-memory). The
 * absent party's notification is FINDING-6's concern and is left unchanged here.
 *
 * TDD Phase R — RED until #processSealUnilateral builds frontier_leaves from the verified carried
 * leaves and threads them (single-key + FROST completion paths) onto the confirmed cert, and the
 * encoder + SealUnilateralConfirmed type carry them.
 */
describe("FINDING-5 (directory): unilateral seal ships frontier_leaves for client re-derivation", () => {
  /** Strip the it-length-prefixed varint frame written by #sendFrame(stream, lp.encode.single(bytes)). */
  function lpUnwrap(framed: Uint8Array): Uint8Array {
    let i = 0;
    let shift = 0;
    let len = 0;
    for (;;) {
      const b = framed[i++];
      len |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
    }
    return framed.slice(i, i + len);
  }

  it("encodeSealUnilateralConfirmed round-trips frontier_leaves on the wire", async () => {
    const keyA = generateKeypair();
    const keyB = generateKeypair();
    const relayKp = generateKeypair();
    const aHex = hex(new Uint8Array(await keyA.getPublicKey()));
    const sessionId = new Uint8Array(randomBytes(16));
    const { leaves } = await buildUnilateralCarry(keyA, keyB, relayKp, sessionId);
    const { reconstructCarriedSealLeaves } = await import("../seal-unilateral-verify.js");
    const carried = reconstructCarriedSealLeaves(leaves, aHex);
    if (!carried.ok) throw new Error("carry");
    const frontierLeaves: SealFrontierLeaf[] = carried.leaves.map((l) => ({
      structure1_cbor: l.structure1_cbor,
      sender_pubkey: l.s2.sender_pubkey,
      sender_signature: l.s2.sender_signature,
    }));

    const bytes = encodeSealUnilateralConfirmed({
      type: "seal_unilateral_confirmed",
      session_id: sessionId,
      sealed_at: 102,
      sealed_root: new Uint8Array(randomBytes(32)),
      leaf_count: 3,
      close_timestamp: 102,
      frost_signature: new Uint8Array(64),
      signature_type: "single",
      present_pubkey: new Uint8Array(await keyA.getPublicKey()),
      absent_pubkey: new Uint8Array(await keyB.getPublicKey()),
      attestation_mode: "ABSENT",
      seal_type: "UNILATERAL",
      frontier_leaves: frontierLeaves,
    });

    const decoded = decode(bytes) as Record<string, unknown>;
    const fl = decoded["frontier_leaves"];
    expect(Array.isArray(fl), "confirmed frame must carry frontier_leaves on the wire").toBe(true);
    expect((fl as unknown[]).length).toBe(3);
    const first = (fl as Array<Record<string, unknown>>)[0];
    expect(first["structure1_cbor"]).toBeInstanceOf(Uint8Array);
    expect(first["sender_pubkey"]).toBeInstanceOf(Uint8Array);
    expect(first["sender_signature"]).toBeInstanceOf(Uint8Array);
  });

  it("#processSealUnilateral attaches frontier_leaves to the confirmed frame sent to the present party", async () => {
    const logs: LogEntry[] = [];
    const dirKp = generateKeypair();
    const { directory, stop } = await createDirectoryNode({
      keyProvider: dirKp,
      listenAddresses: ["/ip4/127.0.0.1/tcp/0"],
      relay: makeGoneRelay(),
      relayEndpoint: { peer_id: "relay-peer-id", multiaddrs: ["/ip4/127.0.0.1/tcp/0"] },
      logger: makeSpyLogger(logs),
      deliveryGraceSeconds: 0,
    });
    try {
      const keyA = generateKeypair();
      const keyB = generateKeypair();
      const relayKp = generateKeypair();
      const aHex = hex(new Uint8Array(await keyA.getPublicKey()));
      const bHex = hex(new Uint8Array(await keyB.getPublicKey()));
      const sessionId = new Uint8Array(randomBytes(16));
      const { leaves, reportedRoot } = await buildUnilateralCarry(keyA, keyB, relayKp, sessionId);

      // Capturing stream registered as the present party's directory stream.
      const captured: Uint8Array[] = [];
      const capturingStream = {
        send: (b: Uint8Array | { slice(): Uint8Array }) => {
          captured.push(b instanceof Uint8Array ? b : b.slice());
        },
      } as unknown as import("@libp2p/interface").Stream;
      await directory.triggerSealUnilateralWithLeavesForTest(aHex, sessionId, reportedRoot, bHex, leaves, capturingStream);

      const confirm = captured
        .map((framed) => {
          try { return decode(lpUnwrap(framed)) as Record<string, unknown>; } catch { return null; }
        })
        .find((f) => f && f["type"] === "seal_unilateral_confirmed");
      expect(confirm, `confirm frame must be sent: ${JSON.stringify(logs.map((l) => l.event))}`).toBeTruthy();
      const fl = confirm!["frontier_leaves"];
      expect(Array.isArray(fl), "confirmed frame must carry frontier_leaves").toBe(true);
      // 3 carried leaves (A msg, B msg, A ctrl) → the client re-derives A=2, B=1 from these.
      expect((fl as unknown[]).length).toBe(3);
    } finally {
      await stop();
    }
  });
});
