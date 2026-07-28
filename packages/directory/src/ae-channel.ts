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
export class AeProtocolError extends Error {}

async function nextFrame(wire: AeWire, expectType: string): Promise<Record<string, unknown>> {
  const bytes = await wire.next();
  if (bytes === null) throw new AeProtocolError(`wire closed while waiting for ${expectType}`);
  const frame = decodeFrame(bytes);
  if (frame["type"] !== expectType) {
    throw new AeProtocolError(`expected ${expectType}, got ${String(frame["type"])}`);
  }
  return frame;
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

interface WireState {
  tierA: Record<string, string[]>;
  tierB: Record<string, Record<string, string>>;
}

async function buildWireState(store: AeStoreView): Promise<WireState> {
  const tierA: Record<string, string[]> = {};
  for (const t of await store.tierATables()) tierA[t] = [...await store.tierARecordHashes(t)];
  const tierB: Record<string, Record<string, string>> = {};
  for (const t of await store.tierBTables()) {
    tierB[t] = Object.fromEntries(await store.tierBVersions(t));
  }
  return { tierA, tierB };
}

/**
 * The peer's state as an AeStoreView, advertise/serve crossing the wire. Apply methods are never
 * invoked on the remote side by the engine (applies are local-only) and throw if reached.
 */
class RemoteStoreView implements AeStoreView {
  #wire: AeWire;
  #state: WireState = { tierA: {}, tierB: {} };
  constructor(wire: AeWire) { this.#wire = wire; }

  /** Fetch a fresh advertisement — call once per round, BEFORE handing this view to the engine. */
  async refresh(): Promise<void> {
    this.#wire.send(encodeAeFrame({ type: "ae_state_req" }));
    const frame = await nextFrame(this.#wire, "ae_state");
    const state = frame["state"] as WireState | undefined;
    if (!state || typeof state !== "object") throw new AeProtocolError("ae_state missing state");
    this.#state = state;
  }

  tierATables(): string[] { return Object.keys(this.#state.tierA); }
  tierBTables(): string[] { return Object.keys(this.#state.tierB); }
  tierARecordHashes(table: string): string[] { return this.#state.tierA[table] ?? []; }
  tierBVersions(table: string): Map<string, string> { return new Map(Object.entries(this.#state.tierB[table] ?? {})); }

  async serveTierA(table: string, hashes: readonly string[]): Promise<TierARecord[]> {
    this.#wire.send(encodeAeFrame({ type: "ae_pull_a", table, hashes: [...hashes] }));
    const frame = await nextFrame(this.#wire, "ae_records_a");
    return (frame["records"] as TierARecord[] | undefined) ?? [];
  }
  async serveTierB(table: string, keys: readonly string[]): Promise<TierBRecord[]> {
    this.#wire.send(encodeAeFrame({ type: "ae_pull_b", table, keys: [...keys] }));
    const frame = await nextFrame(this.#wire, "ae_records_b");
    return (frame["records"] as TierBRecord[] | undefined) ?? [];
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
}

export type AeDialerResult =
  | { ok: true; rounds: RoundResult[] }
  | { ok: false; reason: HandshakeFailReason | "protocol_error"; detail?: string };

/**
 * Dial-side driver: handshake (slot A), then `rounds` anti-entropy rounds pulling the peer's
 * missing state into the local store. Fail-closed: any handshake failure or protocol violation
 * terminates the wire and reports the CAUSE — no partial sync, no unsigned fallback.
 */
export async function runAeDialer(input: AeDialerInput): Promise<AeDialerResult> {
  const { wire, manifest, identity, remoteNodeId, actualRemotePeerId, store } = input;
  const nowMs = input.nowMs ?? (() => Date.now());
  const roundCount = input.rounds ?? 1;
  try {
    // 1. hello with our freshly-minted nonce (the replay gate for OUR slot).
    const nonceA = randomBytes(32).toString("hex");
    wire.send(encodeAeFrame({ type: "ae_hello", node_id: identity.nodeId, peer_id: identity.peerId, nonce: nonceA }));

    // 2. the responder's auth. It must claim the node we dialed — a valid OTHER consortium
    //    member answering here is still a mis-binding (DNS/endpoint confusion) and is refused.
    const authB = await nextFrame(wire, "ae_auth_b");
    const claimedNodeId = str(authB, "node_id");
    if (claimedNodeId !== remoteNodeId) {
      wire.close();
      return { ok: false, reason: "peerid_mismatch", detail: `dialed ${remoteNodeId}, answered by ${claimedNodeId}` };
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

    // 3. our signature over the SAME TBS (throws on A==B — anti-reflection).
    const sigA = await identity.sign(buildAePeerAuthTbs(params));
    wire.send(encodeAeFrame({ type: "ae_auth_a", sig: sigA }));

    // 4. rounds: fresh advertisement each time, then the proven engine.
    const remote = new RemoteStoreView(wire);
    const rounds: RoundResult[] = [];
    for (let i = 0; i < roundCount; i++) {
      await remote.refresh();
      rounds.push(await runAntiEntropyRound(store, remote));
    }
    wire.send(encodeAeFrame({ type: "ae_done" }));
    wire.close();
    return { ok: true, rounds };
  } catch (err) {
    wire.close();
    if (err instanceof AeProtocolError) return { ok: false, reason: "protocol_error", detail: err.message };
    // buildAePeerAuthTbs input validation (bad nonce shape, A==B) fails closed as a protocol error.
    if (err instanceof Error && /nonce|nodeIdA|must differ|newline/.test(err.message)) {
      return { ok: false, reason: "protocol_error", detail: err.message };
    }
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
}

/**
 * Responder-side driver: handshake (slot B), then serve ae_state_req / ae_pull_* from the local
 * store until ae_done or wire close. THROWS on any violation — a failed handshake or a round frame
 * before auth terminates the stream (fail closed); the libp2p layer logs the §6 event.
 */
export async function serveAeResponder(input: AeResponderInput): Promise<void> {
  const { wire, manifest, identity, actualRemotePeerId, store } = input;
  const nowMs = input.nowMs ?? (() => Date.now());
  try {
    // 1. the dialer's hello. Any other first frame (including round frames from an
    //    unauthenticated peer) is a violation — refuse before serving ANYTHING.
    const hello = await nextFrame(wire, "ae_hello");

    // 2. our auth: mint OUR nonce + the shared timestamp; sign the shared TBS (throws on A==B).
    const nonceB = randomBytes(32).toString("hex");
    const params: AePeerAuthParams = {
      nodeIdA: str(hello, "node_id"),
      nodeIdB: identity.nodeId,
      peerIdA: str(hello, "peer_id"),
      peerIdB: identity.peerId,
      nonceAHex: str(hello, "nonce"),
      nonceBHex: nonceB,
      timestamp: new Date(nowMs()).toISOString(),
    };
    const sigB = await identity.sign(buildAePeerAuthTbs(params));
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
    const authA = await nextFrame(wire, "ae_auth_a");
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
    for (;;) {
      const bytes = await wire.next();
      if (bytes === null) return;
      const frame = decodeFrame(bytes);
      switch (frame["type"]) {
        case "ae_state_req": {
          wire.send(encodeAeFrame({ type: "ae_state", state: await buildWireState(store) }));
          break;
        }
        case "ae_pull_a": {
          const records = await store.serveTierA(str(frame, "table"), (frame["hashes"] as string[]) ?? []);
          wire.send(encodeAeFrame({ type: "ae_records_a", records: [...records] }));
          break;
        }
        case "ae_pull_b": {
          const records = await store.serveTierB(str(frame, "table"), (frame["keys"] as string[]) ?? []);
          wire.send(encodeAeFrame({ type: "ae_records_b", records: [...records] }));
          break;
        }
        case "ae_done":
          return;
        default:
          throw new AeProtocolError(`unexpected frame ${String(frame["type"])} in serve loop`);
      }
    }
  } finally {
    wire.close();
  }
}
