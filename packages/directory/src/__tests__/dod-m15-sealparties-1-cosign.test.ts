/**
 * A CO-SIGNING DIRECTORY JUDGES THE LEAVES — `DOD-M15-SEALPARTIES-1`, work item 2.
 *
 * ─── What was being asked of a co-signer ───────────────────────────────────────────────────────
 *
 * A seal is FROST-signed with the initiator's group key, whose shares sit on the directory nodes.
 * Every node except the one that ran the verification checked that it held a share and that no
 * rival ceremony was running, and then signed whatever bytes it was handed. Three signatures, all
 * resting on one node's reading of the leaves — cryptographic weight without judgement, on a
 * threshold whose entire purpose is that no single node can produce a valid output alone.
 *
 * ─── What these tests pin ──────────────────────────────────────────────────────────────────────
 *
 * The leaves now travel with the signature request, and a co-signer rebuilds the root and the leaf
 * count from them and requires the message it is being asked to sign to be exactly the seal TBS
 * over what it derived. Every fixture here is a real Ed25519-signed leaf set: a verifier that can
 * be satisfied by a fabricated signature is not a verifier.
 *
 * The wiring — that a client actually forwards these and that a directory actually calls this
 * before signing — is proved by `j-spine`'s DOD-SPINE-7 running the whole ceremony across separate
 * OS processes. A module test cannot see a call site that stopped calling.
 */

import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { generateKeypair, buildMerkleTree, merkleRoot } from "@cello-protocol/crypto";
import { buildSealTbs } from "@cello-protocol/protocol-types";
import { decode as cborDecode } from "cbor-x";
import {
  isSealFramedMessage,
  verifySealCosignEvidence,
  SEAL_COSIGN_REASONS,
  SEAL_FROST_CONTEXT,
} from "../seal-cosign-evidence.js";
import { buildSeal, type Kp } from "./helpers/seal-fixture.js";
import type { RelaySealData } from "../directory-types.js";

/** The leaf shape that rides a `frost_sign_request` — what the client forwards, verbatim. */
function cosignLeaves(seal: RelaySealData): Array<Record<string, unknown>> {
  return seal.leaves.map((l) => ({
    structure1_cbor: l.structure1_cbor,
    sender_pubkey: l.s2.sender_pubkey,
    sender_signature: l.s2.sender_signature,
  }));
}

/** The content hash each sender SIGNED, read out of Structure 1 — never out of the envelope. */
function signedContentHash(structure1Cbor: Uint8Array): Uint8Array {
  const arr = cborDecode(structure1Cbor) as unknown[];
  return arr[1] as Uint8Array;
}

function certifiedRoot(seal: RelaySealData): Uint8Array {
  return merkleRoot(
    buildMerkleTree(seal.leaves.map((l) => ({ kind: "hash" as const, data: signedContentHash(l.structure1_cbor) }))),
  );
}

/** `context ‖ 0x00 ‖ tbs`, exactly as `FrostThresholdSigner.frameMessage` builds it. */
function framed(sessionId: Uint8Array, root: Uint8Array, leafCount: number, ts: number, legibilityTail = true): Uint8Array {
  const tbs = buildSealTbs(sessionId, root, leafCount, ts);
  const parts = [Buffer.from(SEAL_FROST_CONTEXT, "utf8"), Buffer.from([0x00]), Buffer.from(tbs)];
  if (legibilityTail) parts.push(Buffer.from(randomBytes(32)));
  return new Uint8Array(Buffer.concat(parts));
}

const CLOSE_TS = 1_800_000_000_000;

async function honestSeal(a: Kp, b: Kp, sessionId: Uint8Array): Promise<RelaySealData> {
  return buildSeal(
    [
      { key: a, kind: "msg" }, { key: b, kind: "msg" },
      { key: a, kind: "ctrl", carries: true }, { key: b, kind: "ctrl", carries: true },
    ],
    sessionId,
  );
}

describe("DOD-M15-SEALPARTIES-1: a co-signer reaches its own verdict from the leaves", () => {
  it("★ the honest case signs — with and without the bilateral legibility tail", async () => {
    const [a, b] = [generateKeypair(), generateKeypair()];
    const sessionId = new Uint8Array(randomBytes(16));
    const seal = await honestSeal(a, b, sessionId);
    const leaves = cosignLeaves(seal);

    for (const tail of [true, false]) {
      const msg = framed(sessionId, certifiedRoot(seal), seal.leaves.length, CLOSE_TS, tail);
      expect(isSealFramedMessage(msg)).toBe(true);
      const verdict = verifySealCosignEvidence(msg, leaves, CLOSE_TS);
      expect(
        verdict,
        `a guard that refuses the honest case is a wall (legibility tail: ${String(tail)})`,
      ).toEqual({ ok: true });
    }
  });

  it("★★★ LEAVES THAT DO NOT SUPPORT THE CLAIMED ROOT ARE REFUSED — the clause this exists for", async () => {
    /**
     * The verifying directory says "sign this root"; the leaves it shows produce a different one.
     * That is what a node certifying a conversation the participants did not have looks like from
     * every OTHER holder's seat, and it is the only seat that can see it.
     */
    const [a, b] = [generateKeypair(), generateKeypair()];
    const sessionId = new Uint8Array(randomBytes(16));
    const seal = await honestSeal(a, b, sessionId);
    const trueRoot = certifiedRoot(seal);

    // The message claims the root over the FULL leaf set; the evidence is missing a message.
    const msg = framed(sessionId, trueRoot, seal.leaves.length, CLOSE_TS);
    const dropped = cosignLeaves(seal).filter((_, i) => i !== 1);

    const verdict = verifySealCosignEvidence(msg, dropped, CLOSE_TS);
    expect(verdict.ok, "this node must not lend its share to a root it cannot derive").toBe(false);
    expect(verdict.reason).toBe(SEAL_COSIGN_REASONS.ROOT_UNSUPPORTED);
    expect(String(verdict.detail)).toMatch(/leaves presented/);
  });

  it("★★★ NO LEAVES AT ALL IS REFUSED — absence is the coordinator's own off-switch", async () => {
    const [a, b] = [generateKeypair(), generateKeypair()];
    const sessionId = new Uint8Array(randomBytes(16));
    const seal = await honestSeal(a, b, sessionId);
    const msg = framed(sessionId, certifiedRoot(seal), seal.leaves.length, CLOSE_TS);

    for (const nothing of [undefined, null, []]) {
      const verdict = verifySealCosignEvidence(msg, nothing, CLOSE_TS);
      expect(
        verdict.ok,
        "the party that would omit the evidence is exactly the party this check exists to catch, " +
          "so tolerating its absence would make the check optional for them",
      ).toBe(false);
    }
    expect(verifySealCosignEvidence(msg, undefined, CLOSE_TS).reason).toBe(SEAL_COSIGN_REASONS.EVIDENCE_MISSING);
  });

  it("★★ A LEAF WHOSE SIGNATURE DOES NOT VERIFY IS REFUSED — the evidence is checked, not read", async () => {
    const [a, b] = [generateKeypair(), generateKeypair()];
    const sessionId = new Uint8Array(randomBytes(16));
    const seal = await honestSeal(a, b, sessionId);
    const msg = framed(sessionId, certifiedRoot(seal), seal.leaves.length, CLOSE_TS);

    const tampered = cosignLeaves(seal);
    // Flip one byte of leaf 0's signature: everything else about the request is impeccable.
    const sig = new Uint8Array(tampered[0]!["sender_signature"] as Uint8Array);
    sig[0] = sig[0]! ^ 0xff;
    tampered[0]!["sender_signature"] = sig;

    const verdict = verifySealCosignEvidence(msg, tampered, CLOSE_TS);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe(SEAL_COSIGN_REASONS.LEAF_SIGNATURE_INVALID);
    expect(String(verdict.detail)).toContain("leaf 0");
  });

  it("★★ A LEAF FROM ANOTHER CONVERSATION IS REFUSED — read from the bytes the sender signed", async () => {
    const [a, b] = [generateKeypair(), generateKeypair()];
    const sessionId = new Uint8Array(randomBytes(16));
    /**
     * Leaf 1's signature is genuine and its author IS a participant — the sentence was simply said
     * in another room. Structure 1's signed bytes name the session, so the sender's own signature
     * already says which conversation the leaf belongs to.
     */
    const seal = await buildSeal(
      [
        { key: a, kind: "msg" },
        { key: b, kind: "msg", signsSession: new Uint8Array(randomBytes(16)) },
        { key: a, kind: "ctrl", carries: true }, { key: b, kind: "ctrl", carries: true },
      ],
      sessionId,
    );
    const msg = framed(sessionId, certifiedRoot(seal), seal.leaves.length, CLOSE_TS);

    const verdict = verifySealCosignEvidence(msg, cosignLeaves(seal), CLOSE_TS);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe(SEAL_COSIGN_REASONS.LEAF_SESSION_MISMATCH);
  });

  it("★★ A THIRD VOICE IS REFUSED — and the refusal does not name which one, because it cannot", async () => {
    const [a, b, stranger] = [generateKeypair(), generateKeypair(), generateKeypair()];
    const sessionId = new Uint8Array(randomBytes(16));
    const seal = await buildSeal(
      [
        { key: a, kind: "msg" }, { key: stranger, kind: "msg" }, { key: b, kind: "msg" },
        { key: a, kind: "ctrl", carries: true }, { key: b, kind: "ctrl", carries: true },
      ],
      sessionId,
    );
    const msg = framed(sessionId, certifiedRoot(seal), seal.leaves.length, CLOSE_TS);

    const verdict = verifySealCosignEvidence(msg, cosignLeaves(seal), CLOSE_TS);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe(SEAL_COSIGN_REASONS.THIRD_SIGNER);
    expect(
      String(verdict.detail),
      "this node did not broker the session and holds no roster, so naming a suspect would be a " +
        "false accusation dressed as a finding — say the count instead",
    ).toMatch(/not derivable from this node/);
  });

  it("★★ THE CLOSE TIMESTAMP IS BOUND, NOT TRUSTED — a wrong one produces a message that is not ours", async () => {
    /**
     * The timestamp is the one value in the TBS a co-signer cannot derive; it is the verifying
     * node's clock. It travels with the request, which would be a hole if it were simply believed.
     * It is not: it goes into the reconstruction, so a value that does not match the message the
     * coordinator is actually asking for is refused like any other mismatch.
     */
    const [a, b] = [generateKeypair(), generateKeypair()];
    const sessionId = new Uint8Array(randomBytes(16));
    const seal = await honestSeal(a, b, sessionId);
    const msg = framed(sessionId, certifiedRoot(seal), seal.leaves.length, CLOSE_TS);

    const verdict = verifySealCosignEvidence(msg, cosignLeaves(seal), CLOSE_TS + 1);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe(SEAL_COSIGN_REASONS.ROOT_UNSUPPORTED);
  });

  it("★ a ceremony that is NOT a seal is left alone — this check must not reach the DKG or a refresh", () => {
    const notASeal = new Uint8Array(
      Buffer.concat([Buffer.from("cello-frost-session-establishment-v1", "utf8"), Buffer.from([0x00]), Buffer.from(randomBytes(48))]),
    );
    expect(
      isSealFramedMessage(notASeal),
      "the DKG, the refresh and the session ceremony carry no leaves and must keep signing",
    ).toBe(false);
  });
});
