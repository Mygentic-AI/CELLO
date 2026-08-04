/**
 * reconstructCarriedSealLeaves — FED-OPTIONB-SEAL-001 negative teeth. Under Option B the present party
 * CARRIES the unilateral-seal leaf chain (the directory no longer dials getSealLeaves), so these prove the
 * directory REFUSES a forged / omitted / unwitnessed / relabeled carry — the attacks the relay's
 * authoritative log used to make impossible.
 */
import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { generateKeypair, buildRelayAckTbs } from "@cello-protocol/crypto";
import { encodeStructure2, SCAN_RESULT_SENTINEL } from "@cello-protocol/protocol-types";
import { reconstructCarriedSealLeaves } from "../seal-unilateral-verify.js";
import type { SealUnilateralLeaf } from "../directory-types.js";

const hex = (u: Uint8Array): string => Buffer.from(u).toString("hex");

describe("reconstructCarriedSealLeaves (DOD-OPTIONB-SEAL-1) — the offline-verify teeth", () => {
  it("accepts a valid carry and rejects forged / omitted / unwitnessed / relabeled chains", async () => {
    const relay = generateKeypair();
    const relayId = hex(await relay.getPublicKey());
    const present = generateKeypair();
    const presentHex = hex(await present.getPublicKey());
    const counterpartyHex = hex(await generateKeypair().getPublicKey());

    // Build a well-formed carried leaf. (reconstructCarriedSealLeaves does not check the SENDER signature —
    // that is #verifyUnilateralChain's job — so a placeholder Structure1/sender_signature is fine here; it
    // verifies structure shape, wire/s2 seq agreement, contiguity, and the RELAY receipt on own leaves.)
    const mk = async (seq: number, kind: number, senderHex: string, withReceipt: boolean): Promise<SealUnilateralLeaf> => {
      const content_hash = new Uint8Array(randomBytes(32));
      const structure2_cbor = encodeStructure2({
        sequence_number: seq,
        sender_pubkey: Uint8Array.from(Buffer.from(senderHex, "hex")),
        content_hash,
        sender_signature: new Uint8Array(64),
        scan_result: SCAN_RESULT_SENTINEL,
        prev_root: new Uint8Array(32),
      });
      const ts = seq * 10;
      const leaf: SealUnilateralLeaf = { sequence_number: seq, leaf_kind: kind, structure2_cbor, structure1_cbor: new Uint8Array([1, 2, 3]) };
      if (withReceipt) {
        leaf.relay_id = relayId;
        leaf.relay_timestamp = ts;
        leaf.relay_signature = await relay.sign(buildRelayAckTbs(content_hash, seq, ts));
      }
      return leaf;
    };

    // ── Valid carry: own(1) msg, counterparty(2) msg (no receipt), own(3) ctrl SEAL — all contiguous ──
    const valid = [await mk(1, 0, presentHex, true), await mk(2, 0, counterpartyHex, false), await mk(3, 2, presentHex, true)];
    const ok = reconstructCarriedSealLeaves(valid, presentHex);
    expect(ok.ok, `valid carry must verify: ${JSON.stringify(ok)}`).toBe(true);
    if (ok.ok) {
      expect(ok.leaves.map((l) => l.s2.sequence_number)).toEqual([1, 2, 3]);
      expect(ok.leaves[2].kind).toBe("ctrl");
    }

    // ── empty/absent carry → unavailable ──
    expect(reconstructCarriedSealLeaves(undefined, presentHex)).toMatchObject({ ok: false, reason: "unilateral_leaves_unavailable" });
    expect(reconstructCarriedSealLeaves([], presentHex)).toMatchObject({ ok: false, reason: "unilateral_leaves_unavailable" });

    // ── FORGED receipt: tamper an own leaf's relay_signature → the relay sig no longer verifies ──
    const forged = [await mk(1, 0, presentHex, true), await mk(2, 2, presentHex, true)];
    forged[0].relay_signature = new Uint8Array(randomBytes(64));
    expect(reconstructCarriedSealLeaves(forged, presentHex)).toMatchObject({ ok: false, reason: "unilateral_receipt_invalid" });

    // ── OMITTED leaf: present 1 then 3 (seq 2 dropped) → contiguity break ──
    const omitted = [await mk(1, 0, presentHex, true), await mk(3, 2, presentHex, true)];
    expect(reconstructCarriedSealLeaves(omitted, presentHex)).toMatchObject({ ok: false, reason: "unilateral_chain_noncontiguous" });

    // ── OWN leaf WITHOUT a receipt → must be witnessed ──
    const unwitnessed = [await mk(1, 0, presentHex, false), await mk(2, 2, presentHex, true)];
    expect(reconstructCarriedSealLeaves(unwitnessed, presentHex)).toMatchObject({ ok: false, reason: "unilateral_own_leaf_unwitnessed" });

    // ── RELABELED envelope: wire sequence_number disagrees with the relay-signed Structure2 seq ──
    const relabeled = [await mk(1, 0, presentHex, true)];
    relabeled[0].sequence_number = 5; // wire says 5, the s2 inside says 1
    expect(reconstructCarriedSealLeaves(relabeled, presentHex)).toMatchObject({ ok: false, reason: "unilateral_leaf_seq_mismatch" });

    // ── A receipt signed by the WRONG relay key → invalid (the receipt must verify under relay_id) ──
    const wrongRelay = [await mk(1, 0, presentHex, true), await mk(2, 2, presentHex, true)];
    const otherRelay = generateKeypair();
    const ch = new Uint8Array(randomBytes(32));
    wrongRelay[0].structure2_cbor = encodeStructure2({ sequence_number: 1, sender_pubkey: Uint8Array.from(Buffer.from(presentHex, "hex")), content_hash: ch, sender_signature: new Uint8Array(64), scan_result: SCAN_RESULT_SENTINEL, prev_root: new Uint8Array(32) });
    wrongRelay[0].relay_signature = await otherRelay.sign(buildRelayAckTbs(ch, 1, 10)); // signed by a key != relay_id
    expect(reconstructCarriedSealLeaves(wrongRelay, presentHex)).toMatchObject({ ok: false, reason: "unilateral_receipt_invalid" });
  });

  it("F3: explicit counterparty-noncontiguous negative — a counterparty leaf with a gap is rejected", async () => {
    const relay = generateKeypair();
    const relayId = hex(await relay.getPublicKey());
    const present = generateKeypair();
    const presentHex = hex(await present.getPublicKey());
    const counterpartyHex = hex(await generateKeypair().getPublicKey());

    const mk = async (seq: number, kind: number, senderHex: string, withReceipt: boolean): Promise<SealUnilateralLeaf> => {
      const content_hash = new Uint8Array(randomBytes(32));
      const structure2_cbor = encodeStructure2({
        sequence_number: seq,
        sender_pubkey: Uint8Array.from(Buffer.from(senderHex, "hex")),
        content_hash,
        sender_signature: new Uint8Array(64),
        scan_result: SCAN_RESULT_SENTINEL,
        prev_root: new Uint8Array(32),
      });
      const ts = seq * 10;
      const leaf: SealUnilateralLeaf = { sequence_number: seq, leaf_kind: kind, structure2_cbor, structure1_cbor: new Uint8Array([1, 2, 3]) };
      if (withReceipt) {
        leaf.relay_id = relayId;
        leaf.relay_timestamp = ts;
        leaf.relay_signature = await relay.sign(buildRelayAckTbs(content_hash, seq, ts));
      }
      return leaf;
    };

    // Counterparty leaf at seq 3 with no seq 2 in between (own at 1, gap, counterparty at 3)
    // → contiguity break even though the counterparty leaf itself is well-formed.
    const noncontiguous = [
      await mk(1, 0, presentHex, true),      // own msg at seq 1 (receipted)
      await mk(3, 0, counterpartyHex, false), // counterparty msg at seq 3 — seq 2 MISSING
      await mk(4, 2, presentHex, true),       // own SEAL ctrl at seq 4 (receipted)
    ];
    const result = reconstructCarriedSealLeaves(noncontiguous, presentHex);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("unilateral_chain_noncontiguous");
    }
  });
});

describe("reconstructCarriedSealLeaves — F2 directory E2E refusal (forged carry → verification.failed)", () => {
  // F2 blocking: the directory's CONSUMER path (#processSealUnilateral) must refuse a forged carry
  // and emit session.unilateral.verification.failed, never session.unilateral.notarized. This exercises
  // the full handler via the test hook, not just the pure function.
  it("a forged carry → session.unilateral.verification.failed logged, no notarized event", async () => {
    // We need createDirectoryNode + the new triggerSealUnilateralWithLeavesForTest hook.
    const { createDirectoryNode } = await import("../directory-node.js");
    const dirKp = generateKeypair();

    interface LogEntry { event: string; context?: Record<string, unknown>; }
    const logs: LogEntry[] = [];
    const mockLogger = {
      debug(event: string, ctx?: Record<string, unknown>) { logs.push({ event, context: ctx }); },
      info(event: string, ctx?: Record<string, unknown>) { logs.push({ event, context: ctx }); },
      warn(event: string, ctx?: Record<string, unknown>) { logs.push({ event, context: ctx }); },
      error(event: string, ctx?: Record<string, unknown>) { logs.push({ event, context: ctx }); },
    };

    const mockRelay = {
      recordAssignment: () => ({ ok: true as const }),
      discardSession: () => {},
      submitForSeal: () => ({ ok: false as const, reason: "not_implemented" }),
      confirmSeal: () => {},
      rejectSeal: () => {},
    };

    const { directory, stop } = await createDirectoryNode({
      keyProvider: dirKp,
      listenAddresses: ["/ip4/127.0.0.1/tcp/0"],
      relay: mockRelay,
      relayEndpoint: { peer_id: "relay-peer-id", multiaddrs: ["/ip4/127.0.0.1/tcp/0"] },
      logger: mockLogger,
      deliveryGraceSeconds: 0,
    });

    try {
      const senderHex = randomBytes(32).toString("hex");
      const absentPartyHex = randomBytes(32).toString("hex");
      const sessionId = randomBytes(16);
      const reportedRoot = randomBytes(32);
      const mockStream = { send: () => {} } as unknown as import("@libp2p/interface").Stream;

      // Feed a FORGED carry: an own leaf with a fake relay_signature (not a valid Ed25519 sig).
      const content_hash = new Uint8Array(randomBytes(32));
      const forgedLeaves: SealUnilateralLeaf[] = [{
        sequence_number: 1,
        leaf_kind: 0,
        structure2_cbor: encodeStructure2({
          sequence_number: 1,
          sender_pubkey: Uint8Array.from(Buffer.from(senderHex, "hex")),
          content_hash,
          sender_signature: new Uint8Array(64),
          scan_result: SCAN_RESULT_SENTINEL,
          prev_root: new Uint8Array(32),
        }),
        structure1_cbor: new Uint8Array([1, 2, 3]),
        relay_id: randomBytes(32).toString("hex"),
        relay_timestamp: 100,
        relay_signature: new Uint8Array(randomBytes(64)), // FORGED — won't verify
      }];

      await directory.triggerSealUnilateralWithLeavesForTest(
        senderHex, sessionId, reportedRoot, absentPartyHex, forgedLeaves, mockStream,
      );

      // Assert: session.unilateral.verification.failed was logged (with a receipt-related reason).
      const failed = logs.find((l) => l.event === "session.unilateral.verification.failed");
      expect(failed, "must emit session.unilateral.verification.failed").toBeDefined();
      expect(failed!.context?.["reason"]).toBe("unilateral_receipt_invalid");

      // Assert: session.unilateral.notarized must NOT have been emitted.
      const notarized = logs.find((l) => l.event === "session.unilateral.notarized");
      expect(notarized, "must NOT emit session.unilateral.notarized on forged carry").toBeUndefined();
    } finally {
      await stop();
    }
  });
});

// ─── DOD-DOC-LEAF-1: leaf-kind mapping is explicit; unknown bytes are REFUSED ──
//
// The previous mapping was `w.leaf_kind === LEAF_KIND_CTRL ? "ctrl" : "msg"` — every byte
// that was not 0x02 became "msg". That is a silent relabel at a trust boundary: the
// directory would rebuild the tree hashing a document leaf under the MESSAGE domain, get a
// root the sealing party never computed, and reject the seal with an unrelated reason —
// or, worse, accept a chain whose kinds it never actually checked.
//
// This site AUTHORIZES a seal, so it refuses what it cannot name. That is the opposite of
// the tolerant `opaque` path in crypto, which merely RECOMPUTES a root — same byte, two
// sites, deliberately opposite answers.
describe("reconstructCarriedSealLeaves — leaf-kind mapping (DOD-DOC-LEAF-1)", () => {
  const mkLeaf = async (
    relay: ReturnType<typeof generateKeypair>,
    relayId: string,
    seq: number,
    kind: number,
    senderHex: string,
  ): Promise<SealUnilateralLeaf> => {
    const content_hash = new Uint8Array(randomBytes(32));
    const structure2_cbor = encodeStructure2({
      sequence_number: seq,
      sender_pubkey: Uint8Array.from(Buffer.from(senderHex, "hex")),
      content_hash,
      sender_signature: new Uint8Array(64),
      scan_result: SCAN_RESULT_SENTINEL,
      prev_root: new Uint8Array(32),
    });
    const ts = seq * 10;
    return {
      sequence_number: seq,
      leaf_kind: kind,
      structure2_cbor,
      structure1_cbor: new Uint8Array([1, 2, 3]),
      relay_id: relayId,
      relay_timestamp: ts,
      relay_signature: await relay.sign(buildRelayAckTbs(content_hash, seq, ts)),
    };
  };

  it("maps all four known bytes to their own domain — 0x04 and 0x05 are NOT 'msg'", async () => {
    const relay = generateKeypair();
    const relayId = hex(await relay.getPublicKey());
    const present = generateKeypair();
    const presentHex = hex(await present.getPublicKey());

    const carry = [
      await mkLeaf(relay, relayId, 1, 0x00, presentHex),
      await mkLeaf(relay, relayId, 2, 0x04, presentHex),
      await mkLeaf(relay, relayId, 3, 0x05, presentHex),
      await mkLeaf(relay, relayId, 4, 0x02, presentHex),
    ];
    const res = reconstructCarriedSealLeaves(carry, presentHex);
    expect(res.ok, JSON.stringify(res)).toBe(true);
    if (res.ok) expect(res.leaves.map((l) => l.kind)).toEqual(["msg", "doc", "reject", "ctrl"]);
  });

  it("REFUSES an unrecognized leaf-kind byte instead of coercing it to 'msg'", async () => {
    const relay = generateKeypair();
    const relayId = hex(await relay.getPublicKey());
    const present = generateKeypair();
    const presentHex = hex(await present.getPublicKey());

    for (const badKind of [0x01, 0x03, 0x06, 0xff]) {
      const carry = [
        await mkLeaf(relay, relayId, 1, badKind, presentHex),
        await mkLeaf(relay, relayId, 2, 0x02, presentHex),
      ];
      expect(reconstructCarriedSealLeaves(carry, presentHex)).toMatchObject({
        ok: false,
        reason: "unilateral_leaf_kind_unknown",
      });
    }
  });

  it("0x01 specifically — the internal-node prefix must never become a leaf domain", async () => {
    const relay = generateKeypair();
    const relayId = hex(await relay.getPublicKey());
    const present = generateKeypair();
    const presentHex = hex(await present.getPublicKey());
    const carry = [await mkLeaf(relay, relayId, 1, 0x01, presentHex)];
    expect(reconstructCarriedSealLeaves(carry, presentHex)).toMatchObject({
      ok: false,
      reason: "unilateral_leaf_kind_unknown",
    });
  });
});
