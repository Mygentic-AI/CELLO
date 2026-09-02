/**
 * THE DIRECTORY REFUSES A SEAL OVER A TRANSCRIPT THE PARTICIPANTS DID NOT SIGN —
 * `DOD-M15-SEALWIRE-1` bullets 3 and 4, WIRED.
 *
 * ─── The attack, stated exactly, because I got it wrong the first time ─────────────────────────
 *
 * My first version of this test dropped a message leaf and expected the new check to catch it. It
 * did not get that far: `prev_root_chain_broken` fired first, and the test passed its `ok === false`
 * assertion for entirely the wrong reason. **A refusal is not evidence that YOUR check refused.**
 *
 * Tracing why the chain caught it produced the finding this test is actually built on. Structure 1 —
 * the only bytes a client signs — is `[version, content_hash, sender_pubkey, session_id,
 * last_seen_seq, timestamp]`. **`sequence_number` and `prev_root` are not in it.** Both are assigned
 * by the relay and live only in Structure 2. So the prev_root chain check is circular in the same way
 * the root comparison above it is: a relay that drops a leaf recomputes the chain over what remains,
 * and every link verifies, because the relay produces both sides.
 *
 * The one signed value that constrains a drop is `last_seen_seq` — and it constrains only the
 * counterparty's MOST RECENT leaf. Drop anything a later acknowledgement does not point past, and
 * every existing check passes.
 *
 * ─── The transcript below is that shape, and it is an ordinary one ────────────────────────────
 *
 *     A: msg ①  ─┐
 *     A: msg ②  ─┼─ three parts sent before B says anything
 *     A: msg ③  ─┘
 *     B: msg ④  "got it" — acknowledges ③, and only ③
 *     A: SEAL ⑤
 *     B: SEAL ⑥
 *
 * The relay deletes ②. B's acknowledgement pointed at ③, so nothing signed contradicts the shorter
 * log; the relay renumbers nothing, recomputes the chain, and reports the matching root. Signatures
 * verify. The chain verifies. The ceremony pair is intact. **Before this wiring the directory signed
 * a certificate over that transcript**, and both operators would hold a receipt attesting to a
 * conversation in which the second part was never sent.
 *
 * Someone sending a contract in three parts is the case that makes this concrete.
 *
 * ─── Why a wiring test and not more unit tests ─────────────────────────────────────────────────
 *
 * `seal-final-root.ts` has fourteen tests and five caught mutants, and **none of them proved the
 * directory calls it.** I ran the revert test on the wiring — replaced the call with a hardcoded
 * `{ok: true}` — and all 1154 directory tests stayed green. A verifier nothing invokes does not run.
 * So these drive the real `processSeal` end to end and assert on what an operator is left holding.
 *
 * ─── Mutants, measured, with the reason each one died ─────────────────────────────────────────
 *
 *   ✗ KILLED — the call replaced by a hardcoded `{ok: true, coverage: "both"}`. The deleted message
 *     is certified (`expected true to be false`) and `seal.final_root.not_carried` stops firing.
 *   ✗ KILLED — the refusal downgraded to log-only (`this.#logger.error(...)` kept, the `return {ok:
 *     false}` deleted). Only the deleted-message test dies, and it dies on the certificate being
 *     signed — which is the correct distinction: an accusation nobody acts on is not a guard.
 *
 *   ⚠️ SURVIVOR, stated rather than hidden: the ANCHOR test alone survives both. It asserts a
 *     `coverage: "both"` verdict, and both mutants produce one. Its job is the opposite — a canary
 *     against over-refusal — and the two ★★ tests carry the wiring. Naming it here so a future
 *     reader does not count three tests where two are load-bearing.
 */

import { describe, it, expect } from "vitest";
import { randomBytes, createHash } from "node:crypto";
import { Encoder } from "cbor-x";
import { generateKeypair, buildMerkleTree, merkleRoot } from "@cello-protocol/crypto";
import { encodeSealPayload, encodeStructure2, buildStructure2 } from "@cello-protocol/protocol-types";
import type { Structure2 } from "@cello-protocol/protocol-types";
import { createDirectoryNode, type RelayAdapter } from "../directory-node.js";
import type { RelaySealData, RelaySealLeaf } from "../directory-types.js";
import { InMemoryDirectoryStore } from "@cello-protocol/interfaces/stubs";
import type { Logger } from "@cello-protocol/interfaces";

const ENC = new Encoder({ tagUint8Array: false });
type Kp = ReturnType<typeof generateKeypair>;

interface LogEntry { level: string; event: string; ctx: Record<string, unknown> }

function makeSpyLogger(sink: LogEntry[]): Logger {
  const at = (level: string) => (event: string, ctx?: Record<string, unknown>) => {
    sink.push({ level, event, ctx: ctx ?? {} });
  };
  return { debug: at("debug"), info: at("info"), warn: at("warn"), error: at("error") } as unknown as Logger;
}

function makeNoopRelay(): RelayAdapter {
  return {
    recordAssignment: () => ({ ok: true as const }),
    discardSession: () => {},
    submitForSeal: () => ({ ok: false as const, reason: "not_implemented" }),
    confirmSeal: () => {},
    rejectSeal: () => {},
  } as unknown as RelayAdapter;
}

/**
 * `SHA-256(0x02 ‖ payload)` — the client's derivation of a SEAL leaf's content hash.
 *
 * Written out rather than imported from `seal-final-root.ts`. That module is the code under test
 * here; building the fixture with its own helper would make the binding check compare a value to
 * itself, which is the exact circularity this whole line of work exists to remove.
 */
function sealContentHash(payload: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(new Uint8Array([0x02])).update(payload).digest());
}

/** One leaf as the CLIENT authored it — everything here is inside the signature. */
interface Authored {
  by: "A" | "B";
  kind: "msg" | "ctrl";
  /** Relay-assigned at submit time. Surviving leaves keep their number when a sibling is deleted. */
  seq: number;
  last_seen_seq: number;
  content_hash: Uint8Array;
  /** Present on ctrl leaves once the relay carries the payload. */
  content_bytes?: Uint8Array;
}

/**
 * The six-leaf transcript drawn above, with real Ed25519 signatures over real Structure 1 bytes.
 *
 * `final_root` is the root over the NON-CTRL leaves — the rule the client follows, reading its tree
 * root before appending its own SEAL leaf, and never appending the counterparty's. It is computed
 * over ALL FOUR message leaves regardless of what is later presented, because that is what the
 * participants actually signed.
 */
async function authorTranscript(keyA: Kp, keyB: Kp, sessionId: Uint8Array): Promise<Authored[]> {
  const ts = Date.now();
  const m1 = new Uint8Array(randomBytes(32));
  const m2 = new Uint8Array(randomBytes(32));  // ← the part the relay will delete
  const m3 = new Uint8Array(randomBytes(32));
  const m4 = new Uint8Array(randomBytes(32));

  const finalRoot = merkleRoot(buildMerkleTree(
    [m1, m2, m3, m4].map((h) => ({ kind: "hash" as const, data: h })),
  ));
  const payload = encodeSealPayload({
    session_id: sessionId, final_root: finalRoot, close_timestamp: ts + 10, attestation: "PENDING",
  });
  const ctrlHash = sealContentHash(payload);

  return [
    { by: "A", kind: "msg", seq: 1, last_seen_seq: 0, content_hash: m1 },
    { by: "A", kind: "msg", seq: 2, last_seen_seq: 0, content_hash: m2 },
    { by: "A", kind: "msg", seq: 3, last_seen_seq: 0, content_hash: m3 },
    { by: "B", kind: "msg", seq: 4, last_seen_seq: 3, content_hash: m4 },
    { by: "A", kind: "ctrl", seq: 5, last_seen_seq: 4, content_hash: ctrlHash, content_bytes: payload },
    { by: "B", kind: "ctrl", seq: 6, last_seen_seq: 5, content_hash: ctrlHash, content_bytes: payload },
  ];
}

/**
 * What the relay HANDS OVER for a chosen subset of the authored leaves.
 *
 * The chain is rebuilt here over the presented set, exactly as a tampering relay would: `prev_root`
 * is unsigned relay state, so a deletion leaves no residue in it. The reported `merkle_root` is
 * likewise computed over what is presented. Nothing is forged — every signature is the real one the
 * client produced — and that is the point: **deletion needs no forgery.**
 */
async function present(
  authored: readonly Authored[], keyA: Kp, keyB: Kp, sessionId: Uint8Array,
  opts: { carryPayloads?: boolean } = {},
): Promise<RelaySealData> {
  const carry = opts.carryPayloads ?? true;
  const pubA = new Uint8Array(await keyA.getPublicKey());
  const pubB = new Uint8Array(await keyB.getPublicKey());
  const ts = Date.now();

  const leaves: RelaySealLeaf[] = [];
  let runningRoot: Uint8Array = new Uint8Array(32);  // the first leaf's prev_root is the anchor, unchecked

  for (const a of authored) {
    const pub = a.by === "A" ? pubA : pubB;
    const key = a.by === "A" ? keyA : keyB;
    const s1 = ENC.encode([1, a.content_hash, pub, sessionId, a.last_seen_seq, ts + a.seq]) as Uint8Array;
    const sig = new Uint8Array(await key.sign(s1));
    const built = buildStructure2(a.seq, pub, a.content_hash, sig, runningRoot);
    if (!built.ok) throw new Error(`buildStructure2 failed at seq ${a.seq}`);
    const s2: Structure2 = built.structure2;

    const leaf: RelaySealLeaf = { kind: a.kind, s2, structure1_cbor: s1 };
    if (carry && a.content_bytes) leaf.content_bytes = a.content_bytes;
    leaves.push(leaf);

    runningRoot = merkleRoot(buildMerkleTree(
      leaves.map((l) => ({ kind: l.kind, data: encodeStructure2(l.s2) })),
    ));
  }

  return { leaves, seq_count: leaves.length, merkle_root: runningRoot };
}

async function withDirectory<T>(
  fn: (d: { directory: Awaited<ReturnType<typeof createDirectoryNode>>["directory"]; logs: LogEntry[] }) => Promise<T>,
): Promise<T> {
  const logs: LogEntry[] = [];
  const { directory, stop } = await createDirectoryNode({
    keyProvider: generateKeypair(),
    relay: makeNoopRelay(),
    relayEndpoint: { peer_id: "relay-peer", multiaddrs: [] },
    store: new InMemoryDirectoryStore(),
    logger: makeSpyLogger(logs),
  });
  try { return await fn({ directory, logs }); } finally { await stop(); }
}

describe("DOD-M15-SEALWIRE-1 bullets 3+4, WIRED: the relay is checked against a client signature", () => {
  it("★ the ANCHOR — an honest carried seal is certified, and both participants were checked", async () => {
    /**
     * Pinned before any refusal, because every "must be rejected" assertion below is satisfied by a
     * directory that rejects everything — and a check that refuses honest seals is not a guard, it is
     * an outage across the federation.
     */
    await withDirectory(async ({ directory, logs }) => {
      const keyA = generateKeypair(), keyB = generateKeypair();
      const sessionId = new Uint8Array(randomBytes(16));
      const sealData = await present(await authorTranscript(keyA, keyB, sessionId), keyA, keyB, sessionId);

      const result = await directory.processSeal(sessionId, sealData);
      expect(result.ok, `an honest carried seal must certify: ${JSON.stringify(result)}`).toBe(true);

      const verified = logs.filter((l) => l.event === "seal.final_root.verified");
      expect(verified.length, "the check must actually have run — the revert test proved it did not").toBe(1);
      expect(
        verified[0]!.ctx["coverage"],
        "both participants carried a payload, so both signatures backed the certified root",
      ).toBe("both");
    });
  }, 60_000);

  it("★★ A DELETED MESSAGE IS CAUGHT — and it passes every check that existed before this one", async () => {
    /**
     * ⚠️ THE ASSERTION THIS ENTIRE LINE OF WORK EXISTS FOR.
     *
     * The relay presents A's parts ① and ③ and silently drops ②. It recomputes `prev_root` over what
     * remains — unsigned relay state, so the deletion leaves no trace — and reports the matching root.
     * B's acknowledgement pointed at ③, so no signed `last_seen_seq` contradicts the shorter log.
     *
     * The first half proves the pre-existing checks are blind to it, and it is not decoration: my
     * first attempt at this test was caught by `prev_root_chain_broken` and asserted `ok === false`
     * for a reason that had nothing to do with the code under test. So the refusal is asserted BY
     * NAME, and the blindness is asserted by removing the payloads and watching the identical
     * tampered leaf set sail through.
     */
    const keyA = generateKeypair(), keyB = generateKeypair();
    const sessionId = new Uint8Array(randomBytes(16));
    const authored = await authorTranscript(keyA, keyB, sessionId);
    const tampered = authored.filter((_, i) => i !== 1);  // delete A's second part

    /**
     * (i) WITHOUT the carried payloads — every check that is not the final-root comparison.
     *
     * ⚠️ THIS USED TO ASSERT `ok === true`, AND THE CHANGE IS NOT A WEAKENING — `DOD-M15-SEALPARTIES-1`
     * now refuses a bilateral seal that carries fewer than two approvals, so an uncarried set never
     * reaches a verdict about its contents at all. The point of this half is unchanged and the
     * assertion is what preserves it: the deletion leaves NO trace that any other check can see, so
     * the refusal here must be about the missing approvals and nothing else. If the deletion ever
     * started tripping `prev_root_chain_broken` or `merkle_root_mismatch`, this test would be
     * proving something other than what it is named for, and that is exactly what this catches.
     */
    await withDirectory(async ({ directory }) => {
      const blind = await present(tampered, keyA, keyB, sessionId, { carryPayloads: false });
      const blindResult = await directory.processSeal(sessionId, blind);
      expect(
        blindResult.ok === false ? blindResult.reason : "certified",
        `the deletion itself must remain invisible to every check but the carried root: ${JSON.stringify(blindResult)}`,
      ).toBe("seal_approval_missing");
    });

    // (ii) The SAME tampered leaf set, with the payloads the participants signed.
    await withDirectory(async ({ directory, logs }) => {
      const withPayloads = await present(tampered, keyA, keyB, sessionId);
      const result = await directory.processSeal(sessionId, withPayloads);
      expect(
        result.ok,
        "a certificate over a conversation the participants did not have must NOT be signed",
      ).toBe(false);
      expect(
        result.ok === false ? result.reason : "",
        "and refused for THIS reason — not an earlier check happening to fire",
      ).toBe("seal_final_root_disagrees");

      const refused = logs.filter((l) => l.event === "seal.final_root.refused");
      expect(refused.length, "the refusal must be recorded, not merely returned").toBe(1);
      expect(refused[0]!.level, "this is an accusation against the relay — it belongs at error").toBe("error");
      expect(
        String(refused[0]!.ctx["guidance"]),
        "and the operator must be pointed at the machine that did it",
      ).toMatch(/relay/i);
    });
  }, 60_000);

  it("★★ A BILATERAL SEAL THAT CARRIES NOTHING IS NOW REFUSED — the off-switch is closed", async () => {
    /**
     * ⚠️ THIS TEST ASSERTED THE OPPOSITE UNTIL `DOD-M15-SEALPARTIES-1`, and the reasoning it carried
     * is kept here because it was right at the time and explains why the tolerance existed:
     *
     *   > *"Every relay is un-upgraded until it upgrades, so treating an absent payload as a
     *   > disagreement would refuse every seal in the federation the moment this directory shipped."*
     *
     * That was the rollout window. It is over — nothing is registered against a client that predates
     * the carry — and the price of keeping the tolerance was named in the same breath by the code it
     * guarded: **`content_bytes` is supplied by the party assembling the leaves**, so a relay that
     * deletes a message also drops both payloads and lands in the tolerated branch, certified. A
     * check the guarded party can switch off by sending less is not a check.
     *
     * So the seal is refused, the refusal is at error rather than info (it is no longer the normal
     * case), and the `not_carried` INFO path is gone rather than downgraded.
     */
    await withDirectory(async ({ directory, logs }) => {
      const keyA = generateKeypair(), keyB = generateKeypair();
      const sessionId = new Uint8Array(randomBytes(16));
      const uncarried = await present(
        await authorTranscript(keyA, keyB, sessionId), keyA, keyB, sessionId, { carryPayloads: false },
      );

      const result = await directory.processSeal(sessionId, uncarried);
      expect(
        result.ok,
        "with no approval carried, the certificate would rest on the assembler's word alone",
      ).toBe(false);
      expect(result.ok === false ? result.reason : "").toBe("seal_approval_missing");

      expect(
        logs.filter((l) => l.event === "seal.final_root.not_carried").length,
        "the tolerated branch is deleted, not merely unused — an INFO here would mean it still runs",
      ).toBe(0);
      const refused = logs.filter((l) => l.event === "seal.final_root.refused");
      expect(refused.length).toBe(1);
      expect(refused[0]!.level, "no longer the normal case, so no longer info").toBe("error");
      expect(
        String(refused[0]!.ctx["guidance"]),
        "and the reader is pointed at the producer — the counterparty's build first, then the relay",
      ).toMatch(/relay/i);
    });
  }, 60_000);
});
