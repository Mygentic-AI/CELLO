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
});
