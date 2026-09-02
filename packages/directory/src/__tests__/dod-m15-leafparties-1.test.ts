/**
 * EVERY LEAF IN A SEALED CONVERSATION BELONGS TO THAT CONVERSATION'S TWO PARTICIPANTS —
 * `DOD-M15-LEAFPARTIES-1`.
 *
 * ─── The defect, as an operator would meet it ──────────────────────────────────────────────────
 *
 * 1. Two agents talk. Every message becomes a leaf.
 * 2. They close, and each signs a SEAL ctrl leaf.
 * 3. Whoever assembles the leaf array hands the directory one extra leaf — a message signed by a
 *    third key, or a real message this pair signed in a DIFFERENT conversation.
 * 4. The directory certifies it.
 *
 * The receipt then says *"here is what these two people said to each other"* and a third voice is
 * inside it, or a sentence from another room is.
 *
 * ─── What was already checked, and why it was not enough ───────────────────────────────────────
 *
 * The per-leaf loop verifies each leaf's signature **against the key the leaf itself names**, which
 * is self-consistency, not membership. `verifySealLeaves` examines only the closing ceremony pair.
 * `verifySealFinalRoots` skipped every non-ctrl leaf outright.
 *
 * One thing did catch an injected content leaf, and it was arithmetic rather than identity: an extra
 * leaf changes the root over the non-ctrl leaves, so the participants' signed `final_root` stops
 * matching. **That protection is incidental and the attacker holds its off-switch** — `content_bytes`
 * is supplied by the same party that assembles the leaves, and omitting it makes the verdict
 * `not_carried`, which the directory deliberately tolerates during the rollout. Every fixture below
 * therefore carries NO payload at all: that is the shape that certified.
 *
 * ⚠️ These tests drive the REAL `processSeal` and the REAL unilateral handler. A module-level
 * assertion would stay green if the call site stopped passing the roster.
 */

import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { Encoder } from "cbor-x";
import { generateKeypair, buildMerkleTree, merkleRoot, buildRelayAckTbs } from "@cello-protocol/crypto";
import { buildStructure2, encodeStructure2 } from "@cello-protocol/protocol-types";
import { InMemoryDirectoryStore } from "@cello-protocol/interfaces/stubs";
import type { Logger } from "@cello-protocol/interfaces";
import { createDirectoryNode, type RelayAdapter } from "../directory-node.js";
import type { RelaySealData, SealUnilateralLeaf } from "../directory-types.js";

const ENC = new Encoder({ tagUint8Array: false });
type Kp = ReturnType<typeof generateKeypair>;

const hex = (u: Uint8Array): string => Buffer.from(u).toString("hex");

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

/**
 * One leaf's identity, stated by the test rather than derived: who signs it, what domain it is in,
 * and — for the cross-session case — which session its SIGNED bytes name.
 */
interface LeafSpec { key: Kp; kind: "msg" | "ctrl"; signsSession?: Uint8Array }

/**
 * A bilateral seal the directory accepts today: real Ed25519 signatures, a real `prev_root` chain,
 * `last_seen_seq` 0 everywhere (always within the causal bound), and the relay's own root over
 * `encodeStructure2`. No SEAL payload is carried on any ctrl leaf — the rollout shape.
 */
async function buildSeal(specs: LeafSpec[], sessionId: Uint8Array): Promise<RelaySealData> {
  const leaves: RelaySealData["leaves"] = [];
  const encoded: Array<{ kind: "msg" | "ctrl"; data: Uint8Array }> = [];
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i]!;
    const pub = new Uint8Array(await spec.key.getPublicKey());
    const contentHash = new Uint8Array(randomBytes(32));
    const prevRoot = i === 0 ? new Uint8Array(32) : merkleRoot(buildMerkleTree(encoded));
    const s1 = ENC.encode([1, contentHash, pub, spec.signsSession ?? sessionId, 0, 1_700_000_000_000 + i]) as Uint8Array;
    const sig = new Uint8Array(await spec.key.sign(s1));
    const s2 = buildStructure2(i + 1, pub, contentHash, sig, prevRoot);
    if (!s2.ok) throw new Error(`buildStructure2 failed at leaf ${i}`);
    leaves.push({ kind: spec.kind, s2: s2.structure2, structure1_cbor: s1 });
    encoded.push({ kind: spec.kind, data: encodeStructure2(s2.structure2) });
  }
  return { leaves, seq_count: leaves.length, merkle_root: merkleRoot(buildMerkleTree(encoded)) };
}

async function withDirectory<T>(
  logs: LogEntry[],
  fn: (d: Awaited<ReturnType<typeof createDirectoryNode>>["directory"], store: InMemoryDirectoryStore) => Promise<T>,
): Promise<T> {
  const store = new InMemoryDirectoryStore();
  const { directory, stop } = await createDirectoryNode({
    keyProvider: generateKeypair(),
    relay: makeNoopRelay(),
    relayEndpoint: { peer_id: "relay-peer", multiaddrs: [] },
    store,
    logger: makeSpyLogger(logs),
  });
  try {
    return await fn(directory, store);
  } finally {
    await stop();
  }
}

/** The session record the directory writes when it assigns a session — the roster's real producer. */
async function registerRoster(
  directory: Awaited<ReturnType<typeof createDirectoryNode>>["directory"],
  sessionId: Uint8Array,
  a: Kp,
  b: Kp,
): Promise<void> {
  directory.restoreSessionParticipants([{
    sessionId: hex(sessionId),
    initiatorHex: hex(new Uint8Array(await a.getPublicKey())),
    targetHex: hex(new Uint8Array(await b.getPublicKey())),
    genesisTimestampMs: Date.now(),
  }]);
}

describe("DOD-M15-LEAFPARTIES-1 (bilateral): every leaf is tied to the session's two participants", () => {
  it("★ the honest case still certifies — a guard that refuses the honest case is a wall", async () => {
    const logs: LogEntry[] = [];
    await withDirectory(logs, async (directory) => {
      const [a, b] = [generateKeypair(), generateKeypair()];
      const sessionId = new Uint8Array(randomBytes(16));
      await registerRoster(directory, sessionId, a, b);
      const seal = await buildSeal(
        [{ key: a, kind: "msg" }, { key: b, kind: "msg" }, { key: a, kind: "ctrl" }, { key: b, kind: "ctrl" }],
        sessionId,
      );
      expect((await directory.processSeal(sessionId, seal)).ok).toBe(true);
    });
  }, 20_000);

  it("★★ A MESSAGE FROM A THIRD KEY IS REFUSED — with NO payload carried, which is what certified", async () => {
    /**
     * ⚠️ THE TEST THIS UNIT EXISTS FOR.
     *
     * Every signature here is genuine, the chain is intact, the ceremony pair is two distinct
     * participants and closes the log. The only thing wrong is that leaf 2 belongs to nobody in this
     * conversation — and no SEAL payload is carried, so the arithmetic that would otherwise have
     * noticed is switched off by the same party that injected the leaf.
     */
    const logs: LogEntry[] = [];
    await withDirectory(logs, async (directory) => {
      const [a, b, stranger] = [generateKeypair(), generateKeypair(), generateKeypair()];
      const sessionId = new Uint8Array(randomBytes(16));
      await registerRoster(directory, sessionId, a, b);
      const seal = await buildSeal(
        [
          { key: a, kind: "msg" },
          { key: stranger, kind: "msg" },   // ← a third voice inside the record
          { key: b, kind: "msg" },
          { key: a, kind: "ctrl" }, { key: b, kind: "ctrl" },
        ],
        sessionId,
      );
      const result = await directory.processSeal(sessionId, seal);
      expect(result.ok, "a key outside the conversation must not appear under a certified root").toBe(false);
      expect((result as { reason: string }).reason).toBe("seal_sender_not_participant");

      // The operator half: the refusal names its cause and says what to do about it.
      const refused = logs.filter((l) => l.event === "seal.final_root.refused");
      expect(refused, "a refusal nobody hears is indistinguishable from the seal never happening").toHaveLength(1);
      expect(refused[0]!.level).toBe("error");
      expect(refused[0]!.ctx["reason"]).toBe("seal_sender_not_participant");
      expect(String(refused[0]!.ctx["guidance"] ?? "").length).toBeGreaterThan(80);
    });
  }, 20_000);

  it("★★ A THIRD VOICE IS STILL CAUGHT WHEN THE ROSTER IS UNKNOWN — the federated fallback path", async () => {
    /**
     * The node that adjudicates a seal is frequently not the node that assigned the session
     * (`sessions` is per-node and is not replicated), so the roster falls back to the keys derived
     * from the leaf array itself. A third distinct sender still cannot fit in a pair of two, so the
     * ADDITION of a voice is caught even there. What that path still cannot see is a SUBSTITUTION —
     * tracked as `DOD-M15-SEALROSTER-FEDERATED-1`, and deliberately not claimed here.
     */
    const logs: LogEntry[] = [];
    await withDirectory(logs, async (directory) => {
      const [a, b, stranger] = [generateKeypair(), generateKeypair(), generateKeypair()];
      const sessionId = new Uint8Array(randomBytes(16));
      // No registerRoster — this node never assigned the session.
      const seal = await buildSeal(
        [{ key: a, kind: "msg" }, { key: stranger, kind: "msg" }, { key: a, kind: "ctrl" }, { key: b, kind: "ctrl" }],
        sessionId,
      );
      const result = await directory.processSeal(sessionId, seal);
      expect(result.ok).toBe(false);
      expect((result as { reason: string }).reason).toBe("seal_sender_not_participant");
      expect(
        logs.some((l) => l.event === "seal.final_root.roster_unknown"),
        "the degraded roster must still be announced — the refusal does not make the degradation go away",
      ).toBe(true);
    });
  }, 20_000);

  it("★★ A REAL LEAF FROM A DIFFERENT SESSION IS REFUSED — the cross-session graft", async () => {
    /**
     * The near-miss, and the easier one to reach: every key here IS a participant, and the signature
     * on leaf 2 is genuine — it was simply produced for another conversation. Structure 1's signed
     * bytes name the session (`[version, content_hash, sender_pubkey, session_id, last_seen_seq,
     * timestamp]`), so the sender's own signature already says which room the sentence was said in.
     * Nothing read it.
     */
    const logs: LogEntry[] = [];
    await withDirectory(logs, async (directory) => {
      const [a, b] = [generateKeypair(), generateKeypair()];
      const sessionId = new Uint8Array(randomBytes(16));
      const otherSession = new Uint8Array(randomBytes(16));
      await registerRoster(directory, sessionId, a, b);
      const seal = await buildSeal(
        [
          { key: a, kind: "msg" },
          { key: a, kind: "msg", signsSession: otherSession },  // ← A said this, in another room
          { key: a, kind: "ctrl" }, { key: b, kind: "ctrl" },
        ],
        sessionId,
      );
      const result = await directory.processSeal(sessionId, seal);
      expect(result.ok, "a signature valid for one conversation must not close another").toBe(false);
      expect((result as { reason: string }).reason).toBe("seal_leaf_session_mismatch");
    });
  }, 20_000);

  it("★ a ctrl leaf from a third key is refused too — the ceremony half keeps its teeth", async () => {
    /**
     * The pre-existing `SENDER_NOT_PARTICIPANT` check only ran on a ctrl leaf that CARRIED a payload.
     * With none carried it never ran at all, so this case certified as well.
     */
    const logs: LogEntry[] = [];
    await withDirectory(logs, async (directory) => {
      const [a, b, stranger] = [generateKeypair(), generateKeypair(), generateKeypair()];
      const sessionId = new Uint8Array(randomBytes(16));
      await registerRoster(directory, sessionId, a, b);
      const seal = await buildSeal(
        [{ key: a, kind: "msg" }, { key: a, kind: "ctrl" }, { key: stranger, kind: "ctrl" }],
        sessionId,
      );
      const result = await directory.processSeal(sessionId, seal);
      expect(result.ok).toBe(false);
      expect((result as { reason: string }).reason).toBe("seal_sender_not_participant");
    });
  }, 20_000);
});

// ─── The unilateral half: the same leaf array, a different certifying path ─────────────────────

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

/**
 * A CLIENT-CARRIED unilateral chain the directory accepts today: every present-party leaf carries a
 * valid relay receipt, sequences are contiguous 1..N, the content-hash root equals `reported_root`,
 * and exactly one ctrl leaf — the present party's — closes it.
 */
async function buildUnilateralCarry(
  specs: LeafSpec[],
  present: Kp,
  relayKp: Kp,
  sessionId: Uint8Array,
): Promise<{ leaves: SealUnilateralLeaf[]; reportedRoot: Uint8Array }> {
  const presentHex = hex(new Uint8Array(await present.getPublicKey()));
  const relayId = hex(new Uint8Array(await relayKp.getPublicKey()));
  const leaves: SealUnilateralLeaf[] = [];
  const encoded: Array<{ kind: "msg" | "ctrl"; data: Uint8Array }> = [];
  const contentHashes: Uint8Array[] = [];

  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i]!;
    const pub = new Uint8Array(await spec.key.getPublicKey());
    const ch = new Uint8Array(randomBytes(32));
    const prevRoot = i === 0 ? new Uint8Array(32) : merkleRoot(buildMerkleTree(encoded));
    const s1 = ENC.encode([1, ch, pub, spec.signsSession ?? sessionId, 0, 100 + i]) as Uint8Array;
    const s2 = buildStructure2(i + 1, pub, ch, new Uint8Array(await spec.key.sign(s1)), prevRoot);
    if (!s2.ok) throw new Error(`buildStructure2 failed at leaf ${i}`);
    const s2Cbor = encodeStructure2(s2.structure2);
    const leaf: SealUnilateralLeaf = {
      sequence_number: i + 1,
      leaf_kind: spec.kind === "ctrl" ? 0x02 : 0x00,
      structure2_cbor: s2Cbor,
      structure1_cbor: s1,
    };
    if (hex(pub) === presentHex) {
      leaf.relay_id = relayId;
      leaf.relay_timestamp = 100 + i;
      leaf.relay_signature = new Uint8Array(await relayKp.sign(buildRelayAckTbs(ch, i + 1, 100 + i)));
    }
    leaves.push(leaf);
    encoded.push({ kind: spec.kind, data: s2Cbor });
    contentHashes.push(ch);
  }
  return {
    leaves,
    reportedRoot: merkleRoot(buildMerkleTree(contentHashes.map((data) => ({ kind: "hash" as const, data })))),
  };
}

describe("DOD-M15-LEAFPARTIES-1 (unilateral): the absent-party seal is bound to the same pair", () => {
  async function runUnilateral(specs: LeafSpec[], present: Kp, absent: Kp, logs: LogEntry[]): Promise<void> {
    const store = new InMemoryDirectoryStore();
    const { directory, stop } = await createDirectoryNode({
      keyProvider: generateKeypair(),
      relay: makeGoneRelay(),
      relayEndpoint: { peer_id: "relay-peer", multiaddrs: [] },
      store,
      logger: makeSpyLogger(logs),
      deliveryGraceSeconds: 0,
    });
    try {
      const sessionId = new Uint8Array(randomBytes(16));
      const carry = await buildUnilateralCarry(specs, present, generateKeypair(), sessionId);
      await directory.triggerSealUnilateralWithLeavesForTest(
        hex(new Uint8Array(await present.getPublicKey())),
        sessionId,
        carry.reportedRoot,
        hex(new Uint8Array(await absent.getPublicKey())),
        carry.leaves,
        { send: () => {} } as unknown as import("@libp2p/interface").Stream,
      );
    } finally {
      await stop();
    }
  }

  it("★ the honest unilateral carry still notarizes", async () => {
    const logs: LogEntry[] = [];
    const [a, b] = [generateKeypair(), generateKeypair()];
    await runUnilateral([{ key: a, kind: "msg" }, { key: b, kind: "msg" }, { key: a, kind: "ctrl" }], a, b, logs);
    expect(
      logs.some((l) => l.event === "session.unilateral.verification.failed"),
      "an honest carry must not be refused",
    ).toBe(false);
  }, 20_000);

  it("★★ a third key's message in the carry is refused — no notarization", async () => {
    const logs: LogEntry[] = [];
    const [a, b, stranger] = [generateKeypair(), generateKeypair(), generateKeypair()];
    await runUnilateral(
      [{ key: a, kind: "msg" }, { key: stranger, kind: "msg" }, { key: b, kind: "msg" }, { key: a, kind: "ctrl" }],
      a, b, logs,
    );
    const failed = logs.filter((l) => l.event === "session.unilateral.verification.failed");
    expect(failed, "a carry containing a stranger's leaf must not be notarized").toHaveLength(1);
    expect(failed[0]!.ctx["reason"]).toBe("seal_sender_not_participant");
    expect(logs.some((l) => l.event === "session.unilateral.notarized")).toBe(false);
  }, 20_000);

  it("★★ a leaf from another session in the carry is refused", async () => {
    const logs: LogEntry[] = [];
    const [a, b] = [generateKeypair(), generateKeypair()];
    await runUnilateral(
      [
        { key: a, kind: "msg" },
        { key: b, kind: "msg", signsSession: new Uint8Array(randomBytes(16)) },
        { key: a, kind: "ctrl" },
      ],
      a, b, logs,
    );
    const failed = logs.filter((l) => l.event === "session.unilateral.verification.failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]!.ctx["reason"]).toBe("seal_leaf_session_mismatch");
  }, 20_000);
});
