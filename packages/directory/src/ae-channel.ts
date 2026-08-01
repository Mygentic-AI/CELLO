/**
 * `/cello/anti-entropy/1.0.0` — wire protocol: mutual handshake + rounds (M12 DOD-AE-APPEND-1 /
 * DOD-AE-MUTABLE-1; design §1c + §3).
 *
 * Transport-agnostic on purpose: everything here speaks `AeWire` (one framed message in/out), so
 * the protocol logic is proven over an in-memory duplex with REAL crypto, and the libp2p wiring
 * (stream ↔ AeWire adapter, dial/reconnect, registration in CelloDirectoryNode.start()) is a thin
 * separate layer. CBOR frames per the house convention (`new Encoder({ tagUint8Array: false })`).
 *
 * Handshake (§1c, mutual, fail-closed — no unsigned variant, no log-and-continue):
 *   1. dialer  → ae_hello  { node_id_a, peer_id_a, nonce_a }
 *   2. responder → ae_auth_b { node_id_b, peer_id_b, nonce_b, timestamp, sig_b }
 *   3. dialer  → ae_auth_a { sig_a }
 * Both signatures cover the SAME TBS (`buildAePeerAuthTbs` — the shared canonical builder in
 * @cello-protocol/crypto), built INDEPENDENTLY by each side from its own view: its own identity,
 * the peer's claimed identity, both nonces, the responder-minted timestamp. A signature verifies
 * only if both views agree byte-for-byte — that agreement, checked by `verifyPeerAuthFrame`
 * against the manifest AND the live Noise PeerId, is the channel binding. Self-dial (A==B) fails
 * inside the TBS builder on both sides (anti-reflection).
 *
 * Rounds (§3): after auth the DIALER drives pulls through `RemoteStoreView` — an `AeStoreView`
 * whose advertise/serve methods cross the wire (ae_state_req/ae_pull_*) — so the round logic is
 * the ALREADY-PROVEN `runAntiEntropyRound`, not a re-implementation. The responder serves from its
 * local store and REFUSES any round frame before the handshake completed. Full convergence = both
 * nodes dial each other (each pulls what it lacks); one direction never pushes.
 */

import { randomBytes } from "node:crypto";
import { Encoder, decode as cborDecode } from "cbor-x";
import { buildAePeerAuthTbs, type AePeerAuthParams } from "@cello-protocol/crypto";
import type { ConsortiumManifest } from "@cello-protocol/protocol-types";
import { verifyPeerAuthFrame, type HandshakeFailReason } from "./ae-handshake.js";
import { bucketDigests, bucketIndex, differingBuckets } from "./set-reconciliation.js";
import {
  runAntiEntropyRound,
  type AeStoreView, type MaybePromise, type RoundResult, type TierARecord, type TierBRecord,
} from "./anti-entropy-engine.js";

export const AE_PROTOCOL_ID = "/cello/anti-entropy/1.0.0";

const CBOR = new Encoder({ tagUint8Array: false });

/** One framed message in/out. The libp2p adapter maps this onto an lp-framed stream. */
export interface AeWire {
  send(bytes: Uint8Array): void;
  /** Next framed message, or null when the wire is closed. */
  next(): Promise<Uint8Array | null>;
  close(): void;
}

/** This node's AE identity: manifest nodeId + libp2p PeerId + its node signing key. */
export interface AeNodeIdentity {
  readonly nodeId: string;
  readonly peerId: string;
  sign(tbs: Uint8Array): MaybePromise<Uint8Array>;
}

export function encodeAeFrame(frame: Record<string, unknown>): Uint8Array {
  return CBOR.encode(frame);
}
function decodeFrame(bytes: Uint8Array): Record<string, unknown> {
  return cborDecode(bytes) as Record<string, unknown>;
}

/** Protocol violation — the peer broke the frame contract (wrong type, missing field, early close).
 *  Always terminal for the stream; the message names what was violated. */
export class AeProtocolError extends Error {
  // Set explicitly: subclassing Error does NOT set `name` (it inherits "Error" from the prototype),
  // and the engine identifies wire failures structurally by name rather than by `instanceof` — it is
  // transport-agnostic and must not import this module.
  override readonly name = "AeProtocolError";
}

/** Per-frame receive deadline. A peer that goes silent mid-conversation (post-hello, mid-round)
 *  must not park this side forever — the wire is closed and the exchange fails. */
const DEFAULT_FRAME_TIMEOUT_MS = 30_000;

/** Upper bound on any wire-carried collection (hash lists, key lists, record batches, per-table
 *  version maps). Far above real data volumes; exists so an authenticated-but-hostile peer cannot
 *  stream an unbounded advertisement into memory. Exceeding it is a protocol violation. */
const MAX_WIRE_ITEMS = 250_000;

/**
 * Whole-stream idle bound for the RESPONDER's serve loop. Two orders of magnitude above the per-frame
 * deadline because it must never cut off a dialer that is simply busy applying — it exists only to
 * reap a peer that is gone.
 */
const IDLE_DEADLINE_MS = 300_000;

/** Like `nextFrame` but returns raw bytes and tolerates a clean end-of-stream (`null`). */
async function nextRawFrame(wire: AeWire, timeoutMs: number, stage: string): Promise<Uint8Array | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new AeProtocolError(`responder idle for ${timeoutMs}ms at ${stage} — peer is gone, releasing the stream`)),
      timeoutMs,
    );
    timer.unref?.();
  });
  try {
    return await Promise.race([wire.next(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function nextFrame(wire: AeWire, expectType: string, timeoutMs: number): Promise<Record<string, unknown>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AeProtocolError(`timed out after ${timeoutMs}ms waiting for ${expectType}`)), timeoutMs);
    timer.unref?.();
  });
  let bytes: Uint8Array | null;
  try {
    bytes = await Promise.race([wire.next(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (bytes === null) throw new AeProtocolError(`wire closed while waiting for ${expectType}`);
  let frame: Record<string, unknown>;
  try {
    frame = decodeFrame(bytes);
  } catch {
    throw new AeProtocolError(`malformed CBOR frame while waiting for ${expectType}`);
  }
  if (frame === null || typeof frame !== "object") {
    throw new AeProtocolError(`non-map CBOR frame while waiting for ${expectType}`);
  }
  if (frame["type"] !== expectType) {
    throw new AeProtocolError(`expected ${expectType}, got ${String(frame["type"])}`);
  }
  return frame;
}

/** Bound a wire-carried array (or map entry count) — see MAX_WIRE_ITEMS. */
function bounded<T>(items: readonly T[], what: string): readonly T[] {
  if (items.length > MAX_WIRE_ITEMS) {
    throw new AeProtocolError(`${what} exceeds the wire bound (${items.length} > ${MAX_WIRE_ITEMS})`);
  }
  return items;
}

function str(frame: Record<string, unknown>, field: string): string {
  const v = frame[field];
  if (typeof v !== "string" || v.length === 0) {
    throw new AeProtocolError(`frame field '${field}' missing or not a string`);
  }
  return v;
}
function bytesField(frame: Record<string, unknown>, field: string): Uint8Array {
  const v = frame[field];
  if (v instanceof Uint8Array) return v;
  throw new AeProtocolError(`frame field '${field}' missing or not bytes`);
}

// ── Round frames: state advertisement over the wire ──────────────────────────────────────────

/**
 * The advertisement: ONE DIGEST per table, nothing else. This is the AC — "divergence detection is
 * O(compare)" — so a converged round costs a handful of hashes on the wire regardless of how many
 * records the tables hold. Detail is fetched only for tables whose digests differ, via the bucket
 * walk (Tier-A) or a version-map request (Tier-B).
 */
interface WireState {
  tierA: Record<string, string>; // table → table digest
  tierB: Record<string, string>; // table → table digest
}

/**
 * Advertise one digest per table — WITH PER-TABLE ISOLATION.
 *
 * This loop had none, and on 2026-08-01 that turned a one-word typo into a fleet-wide outage. A
 * Tier-A spec named a column a later migration had dropped, so ONE table's digest query threw
 * `column "subject" does not exist`; the throw escaped `handling_ae_state_req`, killed the whole
 * request, and with it the peer's entire round. All ELEVEN Tier-A tables stopped replicating, on
 * all three nodes, for days — visible only as a `warn` on hosts nobody was tailing, and surfacing
 * a layer away as `CLAIM_CODE_INVALID` during Telegram registration.
 *
 * The spec bug is fixed and `ae-spec-schema.test.ts` prevents that class of it. This fixes the
 * AMPLIFIER: any future table that throws for any reason — a dropped table, a revoked grant, a type
 * change — now costs that one table's replication for the round, not everything.
 *
 * OMITTING IS THE CORRECT DEGRADATION, and specifically not "advertise an empty digest". The
 * planner iterates the PEER'S table list, and `RemoteStoreView.tierATables()` is
 * `Object.keys(state.tierA)` — so a table left out of the map disappears from the peer's list and
 * is simply not reconciled this round. Advertising `""` instead would differ from the local digest
 * and send the peer into a full bucket walk over a table we just proved we cannot read.
 *
 * `onTableError` IS NOT OPTIONAL IN SPIRIT. Swallowing the throw and quietly serving ten tables
 * would replace a loud crash with a silent fallback — a mesh that looks healthy while one table
 * drifts apart forever. The callback is how the skip stays louder than the failure it replaces.
 */
async function buildWireState(
  store: AeStoreView,
  onTableError?: (tier: "A" | "B", table: string, err: unknown) => void,
): Promise<WireState> {
  const tierA: Record<string, string> = {};
  for (const t of await store.tierATables()) {
    try {
      tierA[t] = await store.tierATableDigest(t);
    } catch (err: unknown) {
      onTableError?.("A", t, err);
    }
  }
  const tierB: Record<string, string> = {};
  for (const t of await store.tierBTables()) {
    try {
      tierB[t] = await store.tierBTableDigest(t);
    } catch (err: unknown) {
      onTableError?.("B", t, err);
    }
  }
  return { tierA, tierB };
}

/**
 * The peer's state as an AeStoreView, advertise/serve crossing the wire. Apply methods are never
 * invoked on the remote side by the engine (applies are local-only) and throw if reached.
 */
class RemoteStoreView implements AeStoreView {
  #wire: AeWire;
  #timeoutMs: number;
  #local: AeStoreView;
  #state: WireState = { tierA: {}, tierB: {} };
  constructor(wire: AeWire, timeoutMs: number, local: AeStoreView) {
    this.#wire = wire;
    this.#timeoutMs = timeoutMs;
    this.#local = local; // needed to compute OUR bucket vector for the walk
  }

  /** Fetch a fresh advertisement — one digest per table. Shape-validated (wire input). */
  async refresh(): Promise<void> {
    this.#wire.send(encodeAeFrame({ type: "ae_state_req" }));
    const frame = await nextFrame(this.#wire, "ae_state", this.#timeoutMs);
    const raw = frame["state"];
    if (raw === null || typeof raw !== "object") throw new AeProtocolError("ae_state missing state");
    const digestMap = (tier: unknown, label: string): Record<string, string> => {
      if (tier === null || typeof tier !== "object" || Array.isArray(tier)) {
        throw new AeProtocolError(`ae_state ${label} is not a map`);
      }
      const entries = Object.entries(tier as Record<string, unknown>);
      bounded(entries, `ae_state ${label}`);
      if (entries.some(([, v]) => typeof v !== "string")) {
        throw new AeProtocolError(`ae_state ${label} has a non-string digest`);
      }
      return Object.fromEntries(entries) as Record<string, string>;
    };
    this.#state = {
      tierA: digestMap((raw as { tierA?: unknown }).tierA, "tierA"),
      tierB: digestMap((raw as { tierB?: unknown }).tierB, "tierB"),
    };
  }

  tierATables(): string[] { return Object.keys(this.#state.tierA); }
  tierBTables(): string[] { return Object.keys(this.#state.tierB); }
  tierATableDigest(table: string): string { return this.#state.tierA[table] ?? ""; }
  tierBTableDigest(table: string): string { return this.#state.tierB[table] ?? ""; }

  /**
   * Tier-A detail via the BUCKET WALK (design §3 steps 1-2), invoked only when digests differ:
   * exchange 256 bucket digests, then request record hashes for ONLY the differing buckets. A
   * bucket whose digest matches has byte-identical contents on both sides, so nothing in it could
   * ever need pulling — skipping it is exact, not approximate.
   */
  async tierARecordHashes(table: string): Promise<readonly string[]> {
    this.#wire.send(encodeAeFrame({ type: "ae_buckets_req", table }));
    const bucketsFrame = await nextFrame(this.#wire, "ae_buckets", this.#timeoutMs);
    // bounded() like every other wire collection — the 4 MiB frame cap makes this a bounded
    // allocation anyway, but an omission among five neighbours that all check reads as deliberate.
    const peerBuckets = bounded((bucketsFrame["digests"] ?? []) as unknown[], "ae_buckets digests");
    if (!Array.isArray(peerBuckets) || peerBuckets.some((d) => typeof d !== "string")) {
      throw new AeProtocolError("ae_buckets digests is not a string array");
    }
    const mine = bucketDigests(await this.#local.tierARecordHashes(table));
    const want = differingBuckets(mine, peerBuckets as string[]);
    if (want.length === 0) return [];
    this.#wire.send(encodeAeFrame({ type: "ae_bucket_hashes_req", table, buckets: want }));
    const hashesFrame = await nextFrame(this.#wire, "ae_bucket_hashes", this.#timeoutMs);
    const hashes = hashesFrame["hashes"];
    if (!Array.isArray(hashes) || hashes.some((h) => typeof h !== "string")) {
      throw new AeProtocolError("ae_bucket_hashes hashes is not a string array");
    }
    return bounded(hashes as string[], `ae_bucket_hashes[${table}]`);
  }

  /** Tier-B detail: the key→versionHash map for ONE table, requested only when digests differ. */
  async tierBVersions(table: string): Promise<ReadonlyMap<string, string>> {
    this.#wire.send(encodeAeFrame({ type: "ae_versions_req", table }));
    const frame = await nextFrame(this.#wire, "ae_versions", this.#timeoutMs);
    const versions = frame["versions"];
    if (versions === null || typeof versions !== "object" || Array.isArray(versions)) {
      throw new AeProtocolError(`ae_versions['${table}'] is not a map`);
    }
    const entries = Object.entries(versions as Record<string, unknown>);
    bounded(entries, `ae_versions[${table}]`);
    if (entries.some(([, v]) => typeof v !== "string")) {
      throw new AeProtocolError(`ae_versions['${table}'] has a non-string version`);
    }
    return new Map(entries as Array<[string, string]>);
  }

  // Served records are WIRE INPUT from an authenticated-but-not-therefore-honest peer: keep only
  // records we actually REQUESTED (pull discipline enforced locally, not assumed of the peer).
  // Content-vs-address validation happens at the store (applyTierA recomputes hashes; applyTierB
  // rejects key/body mismatches) — both layers must hold independently.
  async serveTierA(table: string, hashes: readonly string[]): Promise<TierARecord[]> {
    this.#wire.send(encodeAeFrame({ type: "ae_pull_a", table, hashes: [...hashes] }));
    const frame = await nextFrame(this.#wire, "ae_records_a", this.#timeoutMs);
    const raw = frame["records"] ?? [];
    // Array-CHECKED, not cast. `bounded` only reads `.length`, so a scalar passes it and the filter
    // below then throws a TypeError — which the dialer's catch classifies as OUR fault, not the
    // peer's, filing a protocol violation under a local-defect event.
    if (!Array.isArray(raw)) throw new AeProtocolError("ae_records_a `records` is not an array");
    const records = bounded(raw as TierARecord[], "ae_records_a");
    const requested = new Set(hashes);
    // DEDUPED. `Set.has` is membership, not consumption, so a peer serving one record ten times used
    // to satisfy a ten-record plan: `pulled` reached `planned`, the shortfall alarm stayed silent, and
    // because one row DID apply the fork streak was reset. A peer withholding nine of ten
    // `agent_suspensions` rows reported as a clean converged round, forever — the kill switch not
    // replicating, with every alarm built to catch it disarmed. Dedup also caps the result at
    // `requested.size`.
    const seen = new Set<string>();
    return records.filter(
      (r) => typeof r?.hash === "string" && requested.has(r.hash) && !seen.has(r.hash) && (seen.add(r.hash), true),
    );
  }
  async serveTierB(table: string, keys: readonly string[]): Promise<TierBRecord[]> {
    this.#wire.send(encodeAeFrame({ type: "ae_pull_b", table, keys: [...keys] }));
    const frame = await nextFrame(this.#wire, "ae_records_b", this.#timeoutMs);
    const rawB = frame["records"] ?? [];
    if (!Array.isArray(rawB)) throw new AeProtocolError("ae_records_b `records` is not an array");
    const records = bounded(rawB as TierBRecord[], "ae_records_b");
    const requested = new Set(keys);
    const seenKeys = new Set<string>();
    return records.filter(
      (r) => typeof r?.key === "string" && requested.has(r.key) && !seenKeys.has(r.key) && (seenKeys.add(r.key), true),
    );
  }
  applyTierA(): never { throw new AeProtocolError("applyTierA is local-only, never remote"); }
  applyTierB(): never { throw new AeProtocolError("applyTierB is local-only, never remote"); }
}

// ── Dialer ───────────────────────────────────────────────────────────────────────────────────

export interface AeDialerInput {
  wire: AeWire;
  /** The officer-VERIFIED manifest (§1b — verify before calling; this layer pins against it). */
  manifest: ConsortiumManifest;
  identity: AeNodeIdentity;
  /** The manifest nodeId we believe we dialed. The responder must prove it IS this node. */
  remoteNodeId: string;
  /** The peer's libp2p PeerId as observed on the live Noise connection (never a wire claim). */
  actualRemotePeerId: string;
  store: AeStoreView;
  /** How many pull rounds to run after auth (each = fresh advertisement + pulls). */
  rounds?: number;
  nowMs?: () => number;
  /** Per-frame receive deadline (default 30s) — a silent peer fails the exchange, never parks it. */
  frameTimeoutMs?: number;
}

export type AeDialerResult =
  | { ok: true; rounds: RoundResult[]; unknownTables: Array<{ tier: "A" | "B"; table: string }> }
  | {
      ok: false;
      /** `node_id_mismatch`: a valid consortium member answered, but not the one we dialed —
       *  a routing/endpoint mis-binding, NOT a channel-binding failure (distinct so the §1c
       *  rotation-skew retry, keyed on peerid/pubkey mismatches, never fires on it). */
      reason: HandshakeFailReason | "node_id_mismatch" | "self_dial" | "protocol_error";
      detail?: string;
    };

/**
 * Dial-side driver: handshake (slot A), then `rounds` anti-entropy rounds pulling the peer's
 * missing state into the local store. Fail-closed: any handshake failure or protocol violation
 * terminates the wire and reports the CAUSE — no partial sync, no unsigned fallback.
 */
export async function runAeDialer(input: AeDialerInput): Promise<AeDialerResult> {
  const { wire, manifest, identity, remoteNodeId, actualRemotePeerId, store } = input;
  const nowMs = input.nowMs ?? (() => Date.now());
  const roundCount = input.rounds ?? 1;
  const timeoutMs = input.frameTimeoutMs ?? DEFAULT_FRAME_TIMEOUT_MS;

  // SELF-DIAL, refused before any I/O. A node dialing itself is knowable here — no round trip needed
  // — and every later detector names it badly: the responder's TBS builder throws on the A==B
  // anti-reflection rule, which the wire converts to `protocol_error`, so an operator whose manifest
  // lists this node under two entries (or whose endpoint resolves back to itself) was told the PEER
  // spoke the protocol wrongly. Refusing here names the actual cause, and costs nothing.
  // Keyed on nodeId ALONE, deliberately. A peerId comparison looks like a free second signal but is
  // not: peerIds are transport identities that fixtures and single-host deployments legitimately
  // share, so it produces false self-dials on connections that are fine. nodeId is the FROST
  // participant identity — two nodes sharing one is already forbidden.
  if (remoteNodeId === identity.nodeId) {
    wire.close(); // the responder is waiting on our hello; leaving it to time out is not a refusal
    return {
      ok: false,
      reason: "self_dial",
      detail: `refusing to dial self (nodeId ${identity.nodeId}) — check the manifest for a duplicate entry or an endpoint that resolves back to this node`,
    };
  }

  try {
    // 1. hello with our freshly-minted nonce (the replay gate for OUR slot).
    const nonceA = randomBytes(32).toString("hex");
    wire.send(encodeAeFrame({ type: "ae_hello", node_id: identity.nodeId, peer_id: identity.peerId, nonce: nonceA }));

    // 2. the responder's auth. It must claim the node we dialed — a valid OTHER consortium
    //    member answering here is still a mis-binding (DNS/endpoint confusion) and is refused.
    const authB = await nextFrame(wire, "ae_auth_b", timeoutMs);
    const claimedNodeId = str(authB, "node_id");
    if (claimedNodeId !== remoteNodeId) {
      wire.close();
      return { ok: false, reason: "node_id_mismatch", detail: `dialed ${remoteNodeId}, answered by ${claimedNodeId}` };
    }
    const params: AePeerAuthParams = {
      nodeIdA: identity.nodeId,
      nodeIdB: claimedNodeId,
      peerIdA: identity.peerId,
      peerIdB: str(authB, "peer_id"),
      nonceAHex: nonceA,
      nonceBHex: str(authB, "nonce"),
      timestamp: str(authB, "timestamp"),
    };
    const verdict = verifyPeerAuthFrame({
      manifest,
      peerNodeId: claimedNodeId,
      params,
      signature: bytesField(authB, "sig"),
      actualPeerId: actualRemotePeerId,
      localSlot: "A",
      localMintedNonce: nonceA,
      peerNonce: params.nonceBHex,
      nowMs: nowMs(),
    });
    if (!verdict.ok) {
      wire.close();
      return { ok: false, reason: verdict.reason };
    }

    // 3. our signature over the SAME TBS. The builder's own input validation (bad nonce shape,
    //    newline injection, A==B anti-reflection) throws on hostile wire values — every such
    //    failure is a protocol violation by the peer, converted here rather than classified by
    //    fragile message matching downstream.
    let tbsA: Uint8Array;
    try {
      tbsA = buildAePeerAuthTbs(params);
    } catch (err) {
      throw new AeProtocolError(
        `peer-supplied handshake values rejected by the TBS builder: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    // A sign() failure is OUR key infrastructure, not the peer — deliberately NOT converted.
    const sigA = await identity.sign(tbsA);
    wire.send(encodeAeFrame({ type: "ae_auth_a", sig: sigA }));

    // 4. rounds: fresh advertisement each time, then the proven engine.
    const remote = new RemoteStoreView(wire, timeoutMs, store);
    const rounds: RoundResult[] = [];
    // A table the peer advertises and we do not track is SKIPPED rather than fatal — the right call,
    // since the alternative kills every old node's rounds against new ones during a rolling deploy, in
    // the direction carrying suspensions. But a skip is a degraded round, and a degraded round that
    // says nothing is indistinguishable from a healthy one: the caller must be able to say which table
    // stopped replicating and when. Collected here and surfaced by the sync service.
    const unknownTables: Array<{ tier: "A" | "B"; table: string }> = [];
    for (let i = 0; i < roundCount; i++) {
      await remote.refresh();
      rounds.push(
        await runAntiEntropyRound(store, remote, (tier, table) => {
          if (!unknownTables.some((u) => u.tier === tier && u.table === table)) unknownTables.push({ tier, table });
        }),
      );
    }
    wire.send(encodeAeFrame({ type: "ae_done" }));
    wire.close();
    return { ok: true, rounds, unknownTables };
  } catch (err) {
    wire.close();
    if (err instanceof AeProtocolError) return { ok: false, reason: "protocol_error", detail: err.message };
    // Anything else (a local store/DB failure) is OUR fault, not the peer's — propagate so it
    // surfaces as an operational error rather than being blamed on the wire.
    throw err;
  }
}

// ── Responder ────────────────────────────────────────────────────────────────────────────────

export interface AeResponderInput {
  wire: AeWire;
  /** The officer-VERIFIED manifest (§1b). */
  manifest: ConsortiumManifest;
  identity: AeNodeIdentity;
  /** The dialer's libp2p PeerId as observed on the live Noise connection. */
  actualRemotePeerId: string;
  store: AeStoreView;
  nowMs?: () => number;
  /** Per-frame receive deadline (default 30s). */
  frameTimeoutMs?: number;
  /**
   * A table whose digest could not be computed. It is DROPPED from this round's advertisement so
   * the other tables still reconcile — see buildWireState. Wire this to a real `warn`: the skip is
   * the only signal that a table has stopped replicating, and an unwired callback turns the fix
   * into the silent fallback it exists to prevent.
   */
  onTableError?: (tier: "A" | "B", table: string, err: unknown) => void;
}

/**
 * Responder-side driver: handshake (slot B), then serve ae_state_req / ae_pull_* from the local
 * store until ae_done or wire close. THROWS on any violation — a failed handshake or a round frame
 * before auth terminates the stream (fail closed); the libp2p layer logs the §6 event.
 */
export async function serveAeResponder(input: AeResponderInput): Promise<void> {
  const { wire, manifest, identity, actualRemotePeerId, store, onTableError } = input;
  const nowMs = input.nowMs ?? (() => Date.now());
  const timeoutMs = input.frameTimeoutMs ?? DEFAULT_FRAME_TIMEOUT_MS;
  // Declared OUTSIDE the try so the catch can report where we were. "Cannot write to a stream that
  // is closed" names the mechanism; this names the moment.
  let stage = "handshake";
  try {
    // 1. the dialer's hello. Any other first frame (including round frames from an
    //    unauthenticated peer) is a violation — refuse before serving ANYTHING.
    const hello = await nextFrame(wire, "ae_hello", timeoutMs);

    // 2. our auth: mint OUR nonce + the shared timestamp; sign the shared TBS.
    //    peerIdA is the LIVE Noise-authenticated connection identity — NEVER the hello's wire
    //    claim (the ae-peer-auth MUST). An honest dialer's claim equals it, so the TBS still
    //    matches byte-for-byte; a dishonest claim makes our signature worthless to the attacker
    //    instead of turning us into a signing oracle over attacker-chosen bytes.
    const nonceB = randomBytes(32).toString("hex");
    const params: AePeerAuthParams = {
      nodeIdA: str(hello, "node_id"),
      nodeIdB: identity.nodeId,
      peerIdA: actualRemotePeerId,
      peerIdB: identity.peerId,
      nonceAHex: str(hello, "nonce"),
      nonceBHex: nonceB,
      timestamp: new Date(nowMs()).toISOString(),
    };
    let tbsB: Uint8Array;
    try {
      tbsB = buildAePeerAuthTbs(params);
    } catch (err) {
      // Hostile hello values (bad nonce shape, newline injection, A==B reflection) — the peer's
      // violation, named as such.
      throw new AeProtocolError(
        `peer-supplied hello values rejected by the TBS builder: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const sigB = await identity.sign(tbsB); // a sign() failure is OUR key infra — not converted
    wire.send(encodeAeFrame({
      type: "ae_auth_b",
      node_id: identity.nodeId,
      peer_id: identity.peerId,
      nonce: nonceB,
      timestamp: params.timestamp,
      sig: sigB,
    }));

    // 3. the dialer's counter-signature over the SAME TBS — verified against the manifest and
    //    the live connection PeerId before a single round frame is served.
    const authA = await nextFrame(wire, "ae_auth_a", timeoutMs);
    const verdict = verifyPeerAuthFrame({
      manifest,
      peerNodeId: params.nodeIdA,
      params,
      signature: bytesField(authA, "sig"),
      actualPeerId: actualRemotePeerId,
      localSlot: "B",
      localMintedNonce: nonceB,
      peerNonce: params.nonceAHex,
      nowMs: nowMs(),
    });
    if (!verdict.ok) {
      throw new AeProtocolError(`handshake failed: ${verdict.reason}`);
    }

    // 4. serve loop — one request/response at a time until ae_done or close.
    //
    // Bounded by IDLE_DEADLINE_MS, not unbounded. An earlier version delegated this to "the transport
    // layer owns idle-connection lifecycle" — I checked, and it does not: `handle` forwards only
    // maxInboundStreams and runOnLimitedConnection, and yamux has no per-stream idle close. So an
    // authenticated dialer that died without a FIN (process kill, black-holed partition) parked this
    // loop forever holding the stream, and `#serveInbound` is void-ed so nothing reaped it. With
    // maxInboundStreams: 8, eight corpses from one peer stop that peer's inbound AE entirely.
    //
    // The deadline is generous on purpose: BETWEEN requests an idle dialer is legitimate (it may be
    // applying a large batch), so this must only catch a peer that is gone, never one that is working.
    //
    // `stage` exists so a throw names the frame it died on. "Cannot write to a stream that is
    // closed" is the transport's message and identifies the mechanism, not the moment — and the
    // moment is what separates "the dialer went away" from "we died mid-response".
    stage = "awaiting_first_request";
    for (;;) {
      const bytes = await nextRawFrame(wire, IDLE_DEADLINE_MS, stage);
      if (bytes === null) return;
      let frame: Record<string, unknown>;
      try {
        frame = decodeFrame(bytes);
      } catch {
        throw new AeProtocolError("malformed CBOR frame in serve loop");
      }
      if (frame === null || typeof frame !== "object") {
        throw new AeProtocolError("non-map CBOR frame in serve loop");
      }
      stage = `handling_${String(frame["type"])}`;
      switch (frame["type"]) {
        case "ae_state_req": {
          const state = await buildWireState(store, onTableError);
          stage = "sending_ae_state";
          wire.send(encodeAeFrame({ type: "ae_state", state }));
          break;
        }
        case "ae_buckets_req": {
          const table = str(frame, "table");
          wire.send(encodeAeFrame({
            type: "ae_buckets",
            digests: bucketDigests(await store.tierARecordHashes(table)),
          }));
          break;
        }
        case "ae_bucket_hashes_req": {
          const table = str(frame, "table");
          const wanted = frame["buckets"];
          if (!Array.isArray(wanted) || wanted.some((b) => typeof b !== "number")) {
            throw new AeProtocolError("ae_bucket_hashes_req buckets is not a number array");
          }
          const want = new Set(bounded(wanted as number[], "ae_bucket_hashes_req buckets"));
          const all = await store.tierARecordHashes(table);
          wire.send(encodeAeFrame({
            type: "ae_bucket_hashes",
            hashes: all.filter((h) => want.has(bucketIndex(h))),
          }));
          break;
        }
        case "ae_versions_req": {
          const table = str(frame, "table");
          wire.send(encodeAeFrame({
            type: "ae_versions",
            versions: Object.fromEntries(await store.tierBVersions(table)),
          }));
          break;
        }
        case "ae_pull_a": {
          const rawHashes = frame["hashes"] ?? [];
          if (!Array.isArray(rawHashes)) throw new AeProtocolError("ae_pull_a `hashes` is not an array");
          const hashes = bounded(rawHashes as string[], "ae_pull_a hashes");
          const records = await store.serveTierA(str(frame, "table"), hashes);
          wire.send(encodeAeFrame({ type: "ae_records_a", records: [...records] }));
          break;
        }
        case "ae_pull_b": {
          const rawKeys = frame["keys"] ?? [];
          if (!Array.isArray(rawKeys)) throw new AeProtocolError("ae_pull_b `keys` is not an array");
          const keys = bounded(rawKeys as string[], "ae_pull_b keys");
          const records = await store.serveTierB(str(frame, "table"), keys);
          wire.send(encodeAeFrame({ type: "ae_records_b", records: [...records] }));
          break;
        }
        case "ae_done":
          return;
        default:
          throw new AeProtocolError(`unexpected frame ${String(frame["type"])} in serve loop`);
      }
    }
  } catch (err) {
    // Re-thrown with the stage attached. The caller logs the message; without the stage it reads
    // as a generic transport error and every distinct failure looks identical.
    throw err instanceof AeProtocolError
      ? new AeProtocolError(`${err.message} (stage: ${stage})`)
      : new Error(`${err instanceof Error ? err.message : String(err)} (stage: ${stage})`);
  } finally {
    wire.close();
  }
}
