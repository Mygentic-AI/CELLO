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
 * The wiring is proved TWICE, because a module test cannot see a call site that stopped calling:
 * the last describe here drives the REAL `/cello/frost/1.0.0` stream handler over a real libp2p dial
 * with a real K_local auth signature, and `j-spine`'s DOD-SPINE-7 runs the whole ceremony across
 * separate OS processes. Deleting the call in `#handleFrostStream` leaves every module test green
 * and reddens both.
 */

import { setupV3Tests, createTestScope, describe, it, expect, beforeEach, afterEach } from "@claude-flow/testing";
import { randomBytes, createHash } from "node:crypto";
import { Encoder, decode as cborDecode } from "cbor-x";
import * as lp from "it-length-prefixed";
import { generateKeypair, buildMerkleTree, merkleRoot } from "@cello-protocol/crypto";
import { createNode } from "@cello-protocol/transport";
import { buildSealTbs } from "@cello-protocol/protocol-types";
import {
  isSealFramedMessage,
  verifySealCosignEvidence,
  SEAL_COSIGN_REASONS,
  SEAL_FROST_CONTEXT,
} from "../seal-cosign-evidence.js";
import { createDirectoryNode } from "../directory-node.js";
import { buildSeal, makeNoopRelay, type Kp } from "./helpers/seal-fixture.js";
import type { RelaySealData } from "../directory-types.js";

setupV3Tests();

const CBOR_ENC = new Encoder({ tagUint8Array: false });

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

  /**
   * ⚠️ AT THE WIRING, BECAUSE A MODULE TEST CANNOT SEE A CALL SITE THAT STOPPED CALLING.
   *
   * Everything above proves the verifier's verdicts. This drives the REAL `/cello/frost/1.0.0`
   * stream handler over a REAL libp2p dial, with a REAL K_local auth signature — the same path a
   * coordinating daemon uses — and asserts the answer that comes back off the wire. Deleting the
   * call in `#handleFrostStream` leaves every test above green and this one red.
   */
  describe("over the real /cello/frost/1.0.0 stream", () => {
    let scope = createTestScope();
    beforeEach(() => { scope = createTestScope(); });
    afterEach(() => scope.run(async () => {}));

    /** SHA-256(domain ‖ pubkey ‖ epochId ‖ tail) — the directory's own `verifyFrostAuth` input. */
    async function authSigFor(agentKey: Kp, epochId: string, tail: Uint8Array): Promise<Uint8Array> {
      const pubkey = new Uint8Array(await agentKey.getPublicKey());
      const h = new Uint8Array(
        createHash("sha256")
          .update(Buffer.concat([
            Buffer.from("CELLO-FROST-AUTH-v1", "utf8"),
            Buffer.from(pubkey),
            Buffer.from(epochId, "utf8"),
            Buffer.from(tail),
          ]))
          .digest(),
      );
      return new Uint8Array(await agentKey.sign(h));
    }

    /** Open one frost stream, send a sign request, and return the decoded response. */
    async function signRequest(body: Record<string, unknown>, framedMsg: Uint8Array): Promise<Record<string, unknown>> {
      const dirKey = generateKeypair();
      const agentKey = generateKeypair();
      const epochId = "epoch:1";
      const { node: dirNode, stop } = await createDirectoryNode({
        keyProvider: dirKey,
        relay: makeNoopRelay(),
        relayEndpoint: { peer_id: "12D3KooWUnused", multiaddrs: ["/ip4/127.0.0.1/tcp/1"] },
      });
      scope.addCleanup(stop);
      const client = await createNode({ keyProvider: agentKey, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
      await client.start();
      scope.addCleanup(() => client.stop());
      await client.dial(dirNode.listenAddresses()[0]!);

      const stream = await client.newStream(dirNode.getPeerId(), "/cello/frost/1.0.0");
      const signTail = new Uint8Array(Buffer.concat([Buffer.from([0x01]), Buffer.from(framedMsg)]));
      stream.send(lp.encode.single(CBOR_ENC.encode({
        type: "frost_sign_request",
        agentPubkey: Buffer.from(await agentKey.getPublicKey()).toString("hex"),
        epochId,
        framedMsg,
        commitmentList: [],
        ceremonyId: "ceremony-1",
        peerIdString: client.getPeerId(),
        authSig: await authSigFor(agentKey, epochId, signTail),
        ...body,
      }) as Uint8Array));

      const iter = (lp.decode(stream) as AsyncIterable<unknown>)[Symbol.asyncIterator]();
      const r = await iter.next();
      const v = r.value as Uint8Array | { slice(): Uint8Array };
      return cborDecode(v instanceof Uint8Array ? v : v.slice()) as Record<string, unknown>;
    }

    it("★★★ the handler REFUSES a seal sign request with no leaves", async () => {
      const [a, b] = [generateKeypair(), generateKeypair()];
      const sessionId = new Uint8Array(randomBytes(16));
      const seal = await honestSeal(a, b, sessionId);
      const msg = framed(sessionId, certifiedRoot(seal), seal.leaves.length, CLOSE_TS);

      const resp = await signRequest({}, msg);
      expect(resp["type"]).toBe("frost_sign_response");
      expect(
        resp["ok"],
        "the check must run BEFORE the share is touched — a node that signs first and judges after " +
          "has already produced the artifact",
      ).toBe(false);
      expect(resp["reason"]).toBe(SEAL_COSIGN_REASONS.EVIDENCE_MISSING);
      expect(String(resp["detail"] ?? "").length).toBeGreaterThan(10);
    }, 30_000);

    it("★★★ and REFUSES leaves that do not support the root it was asked to sign", async () => {
      const [a, b] = [generateKeypair(), generateKeypair()];
      const sessionId = new Uint8Array(randomBytes(16));
      const seal = await honestSeal(a, b, sessionId);
      const msg = framed(sessionId, certifiedRoot(seal), seal.leaves.length, CLOSE_TS);

      const resp = await signRequest(
        { seal_leaves: cosignLeaves(seal).filter((_, i) => i !== 1), seal_close_timestamp: CLOSE_TS },
        msg,
      );
      expect(resp["ok"]).toBe(false);
      expect(resp["reason"]).toBe(SEAL_COSIGN_REASONS.ROOT_UNSUPPORTED);
    }, 30_000);

    it("★★ a NON-seal ceremony still reaches the signer — the gate must not swallow the DKG", async () => {
      /**
       * The positive control. Without it, a check that refused EVERYTHING would pass both tests
       * above and take the session ceremony, the DKG and the refresh down with it. This request has
       * no share behind it, so `AGENT_NOT_BOOTSTRAPPED` is the signer's own answer — which is the
       * point: it got past the seal gate and reached the signer.
       */
      const notASeal = new Uint8Array(
        Buffer.concat([Buffer.from("cello-frost-session-establishment-v1", "utf8"), Buffer.from([0x00]), Buffer.from(randomBytes(32))]),
      );
      const resp = await signRequest({}, notASeal);
      expect(resp["ok"]).toBe(false);
      expect(
        resp["reason"],
        "a non-seal ceremony carries no leaves and must not be refused for not carrying them",
      ).toBe("AGENT_NOT_BOOTSTRAPPED");
    }, 30_000);
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
