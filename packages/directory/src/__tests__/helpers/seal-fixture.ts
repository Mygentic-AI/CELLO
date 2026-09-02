/**
 * The bilateral-seal fixture, shared by every test that drives the REAL `processSeal`.
 *
 * Extracted from `dod-m15-leafparties-1.test.ts` when `DOD-M15-SEALPARTIES-1` needed the same
 * leaf-forging machinery with one thing added: the ability to CARRY a SEAL payload, which is how a
 * participant states the transcript root it is approving. Two copies of a leaf forger would be two
 * places to keep in step with the wire, and the copy that drifts is the one nobody runs.
 *
 * Everything here builds REAL Ed25519 signatures and a REAL prev_root chain. Nothing is mocked:
 * a fixture that fakes a signature can only ever test the code that ignores it.
 */

import { randomBytes } from "node:crypto";
import { createHash } from "node:crypto";
import { Encoder, decode } from "cbor-x";
import { generateKeypair, buildMerkleTree, merkleRoot, buildRelayAckTbs } from "@cello-protocol/crypto";
import { buildStructure2, encodeStructure2, encodeSealPayload } from "@cello-protocol/protocol-types";
import { InMemoryDirectoryStore } from "@cello-protocol/interfaces/stubs";
import type { Logger } from "@cello-protocol/interfaces";
import { createDirectoryNode, type RelayAdapter } from "../../directory-node.js";
import type { RelaySealData, SealUnilateralLeaf } from "../../directory-types.js";

const ENC = new Encoder({ tagUint8Array: false });

export type Kp = ReturnType<typeof generateKeypair>;

export const hex = (u: Uint8Array): string => Buffer.from(u).toString("hex");

export interface LogEntry { level: string; event: string; ctx: Record<string, unknown> }

export function makeSpyLogger(sink: LogEntry[]): Logger {
  const mk = (level: string) => (event: string, ctx?: Record<string, unknown>) =>
    sink.push({ level, event, ctx: ctx ?? {} });
  return { info: mk("info"), warn: mk("warn"), error: mk("error"), debug: mk("debug") } as unknown as Logger;
}

/** Undo the length prefix `#sendFrame` writes, so a captured frame can be decoded. */
export function lpUnwrap(framed: Uint8Array): Uint8Array {
  let i = 0, shift = 0, len = 0;
  for (;;) {
    const b = framed[i++]!;
    len |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7;
  }
  return framed.subarray(i, i + len);
}

/** A client stream that records every frame the directory sends it. */
export function capturingStream(): { stream: import("@libp2p/interface").Stream; frames: () => Array<Record<string, unknown>> } {
  const captured: Uint8Array[] = [];
  return {
    stream: {
      send: (b: Uint8Array | { slice(): Uint8Array }) => {
        captured.push(b instanceof Uint8Array ? b : b.slice());
      },
    } as unknown as import("@libp2p/interface").Stream,
    frames: () =>
      captured
        .map((f) => { try { return decode(lpUnwrap(f)) as Record<string, unknown>; } catch { return null; } })
        .filter((f): f is Record<string, unknown> => f !== null),
  };
}

export function makeNoopRelay(): RelayAdapter {
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
 * for the cross-session case which session its SIGNED bytes name — and, for a ctrl leaf, whether it
 * CARRIES its SEAL payload.
 *
 * `carries` is the participant's approval. Omit it and that party has approved nothing, which is the
 * shape `DOD-M15-SEALPARTIES-1` refuses on the bilateral path. `finalRoot` overrides the honest
 * value so a test can make two parties disagree about their own transcript.
 */
export interface LeafSpec {
  key: Kp;
  kind: "msg" | "ctrl";
  signsSession?: Uint8Array;
  carries?: boolean;
  finalRoot?: Uint8Array;
}

/** SHA-256(0x02 ‖ payload) — the client's own SEAL content-hash derivation, reproduced exactly. */
function sealContentHash(payload: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(new Uint8Array([0x02])).update(payload).digest());
}

/** The root a participant's `final_root` commits to: over the content hashes of the NON-ctrl leaves. */
export function rootOverContentHashes(hashes: readonly Uint8Array[]): Uint8Array {
  return merkleRoot(buildMerkleTree(hashes.map((data) => ({ kind: "hash" as const, data }))));
}

/**
 * One participant's approval of a transcript, as it appears on a SEAL ctrl leaf: the payload bytes
 * and the content hash the participant SIGNS over them.
 *
 * Exported for the hand-rolled leaf builders that predate `buildSeal` — `DOD-M15-SEALPARTIES-1` made
 * a bilateral seal require both of these, so a fixture without them is no longer the honest case.
 */
export function sealApproval(
  sessionId: Uint8Array,
  finalRoot: Uint8Array,
  closeTimestamp: number,
): { contentBytes: Uint8Array; contentHash: Uint8Array } {
  const contentBytes = encodeSealPayload({
    session_id: sessionId,
    final_root: finalRoot,
    close_timestamp: closeTimestamp,
    attestation: "PENDING",
  });
  return { contentBytes, contentHash: sealContentHash(contentBytes) };
}

/**
 * A bilateral seal: real Ed25519 signatures, a real `prev_root` chain, `last_seen_seq` 0 everywhere
 * (always within the causal bound), and the relay's own root over `encodeStructure2`.
 *
 * A ctrl leaf with `carries: true` gets a real SEAL payload whose `final_root` is the Merkle root
 * over the content hashes of every NON-ctrl leaf — computed from the leaves built so far, which is
 * exactly what a client does when it reads its tree root before appending its own SEAL leaf. Give
 * `finalRoot` to state a different value on purpose.
 */
export async function buildSeal(specs: LeafSpec[], sessionId: Uint8Array): Promise<RelaySealData> {
  const leaves: RelaySealData["leaves"] = [];
  const encoded: Array<{ kind: "msg" | "ctrl"; data: Uint8Array }> = [];
  // The content hashes of the non-ctrl leaves, in order — what every carried final_root commits to.
  const msgHashes: Array<{ kind: "hash"; data: Uint8Array }> = [];
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i]!;
    const pub = new Uint8Array(await spec.key.getPublicKey());
    const prevRoot = i === 0 ? new Uint8Array(32) : merkleRoot(buildMerkleTree(encoded));

    let contentHash: Uint8Array;
    let contentBytes: Uint8Array | undefined;
    if (spec.kind === "ctrl" && spec.carries) {
      contentBytes = encodeSealPayload({
        session_id: sessionId,
        final_root: spec.finalRoot ?? merkleRoot(buildMerkleTree(msgHashes)),
        close_timestamp: 1_700_000_000_000 + i,
        attestation: "PENDING",
      });
      contentHash = sealContentHash(contentBytes);
    } else {
      contentHash = new Uint8Array(randomBytes(32));
    }

    const s1 = ENC.encode([1, contentHash, pub, spec.signsSession ?? sessionId, 0, 1_700_000_000_000 + i]) as Uint8Array;
    const sig = new Uint8Array(await spec.key.sign(s1));
    const s2 = buildStructure2(i + 1, pub, contentHash, sig, prevRoot);
    if (!s2.ok) throw new Error(`buildStructure2 failed at leaf ${i}`);
    leaves.push({ kind: spec.kind, s2: s2.structure2, structure1_cbor: s1, ...(contentBytes ? { content_bytes: contentBytes } : {}) });
    encoded.push({ kind: spec.kind, data: encodeStructure2(s2.structure2) });
    if (spec.kind !== "ctrl") msgHashes.push({ kind: "hash", data: contentHash });
  }
  return { leaves, seq_count: leaves.length, merkle_root: merkleRoot(buildMerkleTree(encoded)) };
}

export async function withDirectory<T>(
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
export async function registerRoster(
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

// ─── The unilateral half: the same leaf array, a different certifying path ─────────────────────

export function makeGoneRelay(): RelayAdapter {
  return makeLivenessRelay("gone");
}

/**
 * A relay that reports a chosen liveness for the counterparty — `DOD-M15-UNILATERAL-1`.
 *
 * The three answers are not interchangeable and the solo-seal gate treats each differently:
 *   `gone`    — the relay POSITIVELY observed the counterparty's standing connection drop. The only
 *               answer that satisfies the high-stakes tier.
 *   `alive`   — the relay is holding that connection right now. Refused in BOTH tiers: a reachable
 *               counterparty is never sealed out, however old the session is.
 *   `unknown` — the relay never tracked them, or the query failed. Standard proceeds (an honest
 *               party must not be stranded); high-stakes refuses rather than falling back to time.
 *
 * `omitted` builds a relay with NO `getSessionLiveness` at all — an in-process adapter that does not
 * implement it. The handler must read that as `unknown`, not crash and not as consent.
 */
export function makeLivenessRelay(liveness: "alive" | "gone" | "unknown" | "omitted"): RelayAdapter {
  const base = {
    recordAssignment: () => ({ ok: true as const }),
    discardSession: () => {},
    submitForSeal: () => ({ ok: false as const, reason: "not_implemented" }),
    confirmSeal: () => {},
    rejectSeal: () => {},
  };
  if (liveness === "omitted") return base as unknown as RelayAdapter;
  return { ...base, getSessionLiveness: async () => liveness } as unknown as RelayAdapter;
}

/**
 * A CLIENT-CARRIED unilateral chain the directory accepts today: every present-party leaf carries a
 * valid relay receipt, sequences are contiguous 1..N, the content-hash root equals `reported_root`,
 * and exactly one ctrl leaf — the present party's — closes it.
 */
export async function buildUnilateralCarry(
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

/**
 * What a solo-seal run can vary — `DOD-M15-UNILATERAL-1` added everything below `assignedTo`.
 *
 * Defaults reproduce the pre-013 run exactly: counterparty `gone`, standard tier, a zero floor and
 * a session backdated just past it. So every existing caller keeps testing what it tested.
 */
export interface RunUnilateralOpts {
  /** The session's REAL pair, when it differs from `[present, absent]` — the stranger case. */
  assignedTo?: [Kp, Kp];
  /** What the relay says about the absent party. Default `gone`. */
  liveness?: "alive" | "gone" | "unknown" | "omitted";
  /** Put the session in the HIGH-STAKES tier. Default standard. */
  highStakes?: boolean;
  /** The STANDARD tier's floor, in seconds. Default 0. */
  graceSeconds?: number;
  /** The HIGH-STAKES tier's floor, in seconds. Default 3600 (the production value). */
  highStakesGraceSeconds?: number;
  /** How old the session is. Default: the standard floor + 1s. */
  sessionAgeMs?: number;
}

export async function runUnilateral(
  specs: LeafSpec[],
  present: Kp,
  absent: Kp,
  logs: LogEntry[],
  opts: RunUnilateralOpts = {},
): Promise<{ frames: Array<Record<string, unknown>> }> {
  const store = new InMemoryDirectoryStore();
  const graceSeconds = opts.graceSeconds ?? 0;
  const { directory, stop } = await createDirectoryNode({
    keyProvider: generateKeypair(),
    relay: makeLivenessRelay(opts.liveness ?? "gone"),
    relayEndpoint: { peer_id: "relay-peer", multiaddrs: [] },
    store,
    logger: makeSpyLogger(logs),
    deliveryGraceSeconds: graceSeconds,
    ...(opts.highStakesGraceSeconds !== undefined ? { highStakesGraceSeconds: opts.highStakesGraceSeconds } : {}),
  });
  const cap = capturingStream();
  try {
    const sessionId = new Uint8Array(randomBytes(16));
    if (opts.assignedTo) await registerRoster(directory, sessionId, opts.assignedTo[0], opts.assignedTo[1]);
    const carry = await buildUnilateralCarry(specs, present, generateKeypair(), sessionId);
    await directory.triggerSealUnilateralWithLeavesForTest(
      hex(new Uint8Array(await present.getPublicKey())),
      sessionId,
      carry.reportedRoot,
      hex(new Uint8Array(await absent.getPublicKey())),
      carry.leaves,
      cap.stream,
      {
        ...(opts.highStakes !== undefined ? { highStakes: opts.highStakes } : {}),
        ...(opts.sessionAgeMs !== undefined ? { sessionAgeMs: opts.sessionAgeMs } : {}),
      },
    );
  } finally {
    await stop();
  }
  return { frames: cap.frames() };
}


