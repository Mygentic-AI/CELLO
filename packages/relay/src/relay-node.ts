/**
 * CELLO Relay Node — CelloRelayNode (NODE-002)
 *
 * Implements the /cello/relay/1.0.0 libp2p protocol:
 *   - Ed25519 challenge-response auth (domain: "CELLO-RELAY-AUTH-v1")
 *   - hash_submit processing: Structure 1 validation, sequence assignment, Structure 2 construction
 *   - leaf_deliver to counterparty (queued if disconnected, DB-001)
 *   - in-process calls: recordAssignment, submitForSeal, confirmSeal, rejectSeal
 *
 * Auth signature over: SHA-256("CELLO-RELAY-AUTH-v1" || nonce || pubkey)
 *   per RFC 8032 (Ed25519) and FIPS 180-4 (SHA-256)
 *
 * Structure 1 CBOR layout: [1, content_hash, sender_pubkey, session_id, last_seen_seq, timestamp]
 *   per MERKLE-002 and RFC 8949 §4.2.1
 * Structure 2 construction: per MERKLE-002 (buildStructure2, encodeStructure2)
 * Leaf hash: SHA-256(leaf_kind || structure2_cbor) per MERKLE-001
 */

import { randomBytes, createHash } from "node:crypto";
import { Encoder, decode } from "cbor-x";
import * as lp from "it-length-prefixed";
import { verify, buildMerkleTree, merkleRoot, generateKeypair } from "@cello/crypto";
import type { KeyProvider, LeafInput } from "@cello/crypto";
import { buildStructure2, encodeStructure2, computeGenesisPrevRoot } from "@cello/protocol-types";
import { createNode } from "@cello/transport";
import type { CelloNode } from "@cello/transport";
import type { Stream } from "@libp2p/interface";
import type {
  SessionAssignment,
  RelaySessionState,
  SealData,
  HashSubmitErrorReason,
} from "./relay-types.js";
import type { RelayStore } from "./relay-store.js";
import { InMemoryRelayStore } from "./relay-store.js";
import {
  encodeAuthChallenge,
  encodeAuthFailed,
  encodeHashSubmitAck,
  encodeHashSubmitError,
  encodeLeafDeliver,
  decodeInboundFrame,
} from "./relay-frames.js";

export const RELAY_PROTOCOL_ID = "/cello/relay/1.0.0";
const AUTH_DOMAIN = "CELLO-RELAY-AUTH-v1";
const NONCE_TTL_MS = 30_000;

const CBOR_ENC = new Encoder({ tagUint8Array: false });

// ─── Nonce registry ────────────────────────────────────────────────────────────

interface NonceEntry {
  nonce: Uint8Array;
  expiresAt: number;
  used: boolean;
}

// ─── Structure 1 CBOR decoder ─────────────────────────────────────────────────

interface Structure1Fields {
  protocol_version: number;
  content_hash: Uint8Array;
  sender_pubkey: Uint8Array;
  session_id: Uint8Array;
  last_seen_seq: number;
  timestamp: number | bigint;
}

function decodeStructure1(cbor: Uint8Array): Structure1Fields | null {
  let arr: unknown;
  try {
    arr = decode(cbor);
  } catch {
    return null;
  }
  if (!Array.isArray(arr) || arr.length !== 6) return null;

  const [_pv, _ch, _spk, _sid, _lss, _ts] = arr;

  if (typeof _pv !== "number") return null;
  const chBytes = _ch instanceof Uint8Array ? _ch : Buffer.isBuffer(_ch) ? new Uint8Array(_ch as Buffer) : null;
  const spkBytes = _spk instanceof Uint8Array ? _spk : Buffer.isBuffer(_spk) ? new Uint8Array(_spk as Buffer) : null;
  const sidBytes = _sid instanceof Uint8Array ? _sid : Buffer.isBuffer(_sid) ? new Uint8Array(_sid as Buffer) : null;
  if (!chBytes || chBytes.length !== 32) return null;
  if (!spkBytes || spkBytes.length !== 32) return null;
  if (!sidBytes || sidBytes.length !== 16) return null;
  if (typeof _lss !== "number") return null;
  if (typeof _ts !== "number" && typeof _ts !== "bigint") return null;

  return {
    protocol_version: _pv,
    content_hash: chBytes,
    sender_pubkey: spkBytes,
    session_id: sidBytes,
    last_seen_seq: _lss,
    timestamp: _ts,
  };
}

// ─── CelloRelayNode ────────────────────────────────────────────────────────────

export interface RelayNodeOptions {
  node: CelloNode;
  directoryPubkey: Uint8Array;
  store?: RelayStore;
}

export class CelloRelayNode {
  readonly #node: CelloNode;
  readonly #directoryPubkey: Uint8Array;
  readonly #store: RelayStore;

  // nonce_hex → NonceEntry
  readonly #nonces = new Map<string, NonceEntry>();

  // pubkey_hex → authenticated relay stream (for delivery)
  readonly #streams = new Map<string, Stream>();

  // per-session mutex: session_id_hex → Promise chain
  readonly #sessionLocks = new Map<string, Promise<void>>();

  constructor(opts: RelayNodeOptions) {
    this.#node = opts.node;
    this.#directoryPubkey = opts.directoryPubkey;
    this.#store = opts.store ?? new InMemoryRelayStore();
  }

  async start(): Promise<void> {
    await this.#node.handle(RELAY_PROTOCOL_ID, (stream) => {
      void this.#handleRelayStream(stream);
    });
  }

  // ─── In-process directory calls ─────────────────────────────────────────────

  recordAssignment(assignment: SessionAssignment): { ok: true } | { ok: false; reason: string } {
    // Verify directory signature over canonical CBOR of [session_id, participant_a, participant_b, session_timestamp]
    const tbs = CBOR_ENC.encode([
      assignment.session_id,
      assignment.participant_a,
      assignment.participant_b,
      assignment.session_timestamp > 0xffffffff
        ? BigInt(assignment.session_timestamp)
        : assignment.session_timestamp,
    ]);
    if (!verify(this.#directoryPubkey, tbs, assignment.directory_signature)) {
      return { ok: false, reason: "directory_signature_invalid" };
    }

    const genesisRoot = computeGenesisPrevRoot(
      assignment.participant_a,
      assignment.participant_b,
      assignment.session_id,
      assignment.session_timestamp,
    );
    const recorded = this.#store.recordSession(assignment, genesisRoot);
    if (!recorded) return { ok: false, reason: "session_already_exists" };
    return { ok: true };
  }

  submitForSeal(sessionId: Uint8Array): { ok: true; data: SealData } | { ok: false; reason: string } {
    const key = Buffer.from(sessionId).toString("hex");
    const state = this.#store.getSession(key);
    if (!state) return { ok: false, reason: "session_not_found" };
    if (state.status !== "active") return { ok: false, reason: "session_not_active" };

    const leaves = state.leaf_log.slice();
    const leafInputs: LeafInput[] = leaves.map((l) => ({
      kind: l.kind,
      data: encodeStructure2(l.s2),
    }));
    const tree = buildMerkleTree(leafInputs);
    const root = merkleRoot(tree);

    this.#store.setSession(key, { ...state, status: "sealing" });

    return {
      ok: true,
      data: {
        leaves,
        seq_count: state.seq_counter,
        merkle_root: root,
      },
    };
  }

  confirmSeal(sessionId: Uint8Array): void {
    const key = Buffer.from(sessionId).toString("hex");
    this.#store.destroySession(key);
    this.#sessionLocks.delete(key);
  }

  rejectSeal(sessionId: Uint8Array, _reason: string): void {
    const key = Buffer.from(sessionId).toString("hex");
    const state = this.#store.getSession(key);
    if (state) {
      this.#store.setSession(key, { ...state, status: "seal_rejected" });
    }
  }

  // ─── Stream handler ─────────────────────────────────────────────────────────

  async #handleRelayStream(stream: Stream): Promise<void> {
    // Sweep expired nonces on each new connection to prevent unbounded accumulation
    // from abandoned auth attempts (client opens stream but never sends a response).
    const now = Date.now();
    for (const [k, e] of this.#nonces) {
      if (now > e.expiresAt) this.#nonces.delete(k);
    }

    const nonce = new Uint8Array(randomBytes(32));
    const nonceHex = Buffer.from(nonce).toString("hex");
    this.#nonces.set(nonceHex, { nonce, expiresAt: Date.now() + NONCE_TTL_MS, used: false });

    try {
      await this.#sendFrame(stream, encodeAuthChallenge({ type: "relay_auth_challenge", nonce }));
    } catch {
      stream.abort(new Error("send_failed"));
      return;
    }

    // Use a single lp.decode iterator for the entire stream lifetime.
    // Splitting into two iterators (auth + data) causes the first iterator's cleanup
    // to signal EOF on the underlying stream, preventing the second from reading.
    let authedPubkeyHex: string | null = null;
    let authed = false;

    try {
      for await (const chunk of lp.decode(stream)) {
        const frameBytes = chunk instanceof Uint8Array
          ? chunk
          : (chunk as unknown as { slice(): Uint8Array }).slice();

        if (!authed) {
          // First frame must be relay_auth_response
          const parsed = decodeInboundFrame(frameBytes);
          if (!parsed || parsed.type !== "relay_auth_response") {
            stream.abort(new Error("expected_auth_response")); return;
          }

          const resp = parsed;
          const nonceEntry = this.#nonces.get(nonceHex);
          if (!nonceEntry) {
            await this.#sendFrame(stream, encodeAuthFailed({ type: "relay_auth_failed", reason: "nonce_unknown" }));
            stream.abort(new Error("nonce_unknown")); return;
          }
          if (Date.now() > nonceEntry.expiresAt) {
            this.#nonces.delete(nonceHex);
            await this.#sendFrame(stream, encodeAuthFailed({ type: "relay_auth_failed", reason: "nonce_expired" }));
            stream.abort(new Error("nonce_expired")); return;
          }
          if (nonceEntry.used) {
            await this.#sendFrame(stream, encodeAuthFailed({ type: "relay_auth_failed", reason: "nonce_reused" }));
            stream.abort(new Error("nonce_reused")); return;
          }
          nonceEntry.used = true;
          this.#nonces.delete(nonceHex);

          // Verify Ed25519(SHA-256("CELLO-RELAY-AUTH-v1" || nonce || pubkey)) per spec
          const domain = Buffer.from(AUTH_DOMAIN, "utf8");
          const authMsg = new Uint8Array(Buffer.concat([domain, nonce, resp.pubkey]));
          const msgHash = new Uint8Array(createHash("sha256").update(authMsg).digest());
          if (!verify(resp.pubkey, msgHash, resp.signature)) {
            await this.#sendFrame(stream, encodeAuthFailed({ type: "relay_auth_failed", reason: "signature_invalid" }));
            stream.abort(new Error("signature_invalid")); return;
          }

          authedPubkeyHex = Buffer.from(resp.pubkey).toString("hex");
          this.#streams.set(authedPubkeyHex, stream);
          authed = true;

          // Flush any queued deliveries
          const queued = this.#store.drainDeliveries(authedPubkeyHex);
          for (const d of queued) {
            try {
              await this.#sendFrame(stream, encodeLeafDeliver({ type: "leaf_deliver", ...d }));
            } catch { break; }
          }
          continue;
        }

        // Authenticated: process hash_submit frames
        const parsed = decodeInboundFrame(frameBytes);
        if (!parsed || parsed.type !== "hash_submit") continue;
        await this.#processHashSubmit(stream, authedPubkeyHex!, parsed);
      }
    } catch {
      // stream closed or reset — normal disconnect
    } finally {
      if (authedPubkeyHex && this.#streams.get(authedPubkeyHex) === stream) {
        this.#streams.delete(authedPubkeyHex);
      }
    }
  }

  async #processHashSubmit(
    stream: Stream,
    senderPubkeyHex: string,
    frame: import("./relay-types.js").HashSubmit
  ): Promise<void> {
    const sessionKey = Buffer.from(frame.session_id).toString("hex");

    const reply = async (error: HashSubmitErrorReason) => {
      try {
        await this.#sendFrame(stream, encodeHashSubmitError({ type: "hash_submit_error", reason: error }));
      } catch {}
    };

    // Serialize per-session to guarantee monotonic sequencing (SI-002)
    const prev = this.#sessionLocks.get(sessionKey) ?? Promise.resolve();
    let resolve!: () => void;
    const next = new Promise<void>((r) => { resolve = r; });
    this.#sessionLocks.set(sessionKey, prev.then(() => next));

    await prev;
    try {
      await this.#processHashSubmitLocked(stream, senderPubkeyHex, frame, sessionKey, reply);
    } finally {
      resolve();
    }
  }

  async #processHashSubmitLocked(
    stream: Stream,
    senderPubkeyHex: string,
    frame: import("./relay-types.js").HashSubmit,
    sessionKey: string,
    reply: (e: HashSubmitErrorReason) => Promise<void>
  ): Promise<void> {
    const state = this.#store.getSession(sessionKey);
    if (!state) { await reply("session_not_found"); return; }
    if (state.status !== "active") { await reply("session_sealed"); return; }

    const aHex = Buffer.from(state.assignment.participant_a).toString("hex");
    const bHex = Buffer.from(state.assignment.participant_b).toString("hex");
    if (senderPubkeyHex !== aHex && senderPubkeyHex !== bHex) {
      await reply("not_a_participant"); return;
    }

    if (frame.leaf_kind !== 0x00 && frame.leaf_kind !== 0x02) {
      await reply("leaf_kind_invalid"); return;
    }

    const s1 = decodeStructure1(frame.structure1_cbor);
    if (!s1) { await reply("signature_invalid"); return; }

    // Sender pubkey in Structure 1 must match the authenticated connection
    const s1PubkeyHex = Buffer.from(s1.sender_pubkey).toString("hex");
    if (s1PubkeyHex !== senderPubkeyHex) {
      await reply("sender_mismatch"); return;
    }

    // Verify Structure 1 signature against the original CBOR bytes (frame.structure1_cbor).
    // Re-encoding the decoded fields would change the timestamp representation (float64 vs uint64),
    // breaking signature verification. Verify the exact bytes the sender signed.
    if (!verify(s1.sender_pubkey, frame.structure1_cbor, frame.sender_signature)) {
      await reply("signature_invalid"); return;
    }

    if (s1.last_seen_seq > state.seq_counter) {
      await reply("last_seen_seq_ahead"); return;
    }

    const seq = state.seq_counter + 1;

    // Compute prev_root: genesis for seq=1, else Merkle root of all prior leaves.
    // O(n log n) per submit — acceptable for M1 short sessions; production needs
    // an incremental tree that tracks the running root across appends.
    const prevRoot = seq === 1
      ? state.genesis_prev_root
      : (() => {
          const inputs: LeafInput[] = state.leaf_log.map((l) => ({
            kind: l.kind,
            data: encodeStructure2(l.s2),
          }));
          return merkleRoot(buildMerkleTree(inputs));
        })();

    const s2Result = buildStructure2(
      seq,
      s1.sender_pubkey,
      s1.content_hash,
      frame.sender_signature,
      prevRoot
    );
    if (!s2Result.ok) { await reply("signature_invalid"); return; }

    const s2Cbor = encodeStructure2(s2Result.structure2);
    const leafKind: "msg" | "ctrl" = frame.leaf_kind === 0x02 ? "ctrl" : "msg";

    const newState: RelaySessionState = {
      ...state,
      seq_counter: seq,
      leaf_log: [...state.leaf_log, { kind: leafKind, s2: s2Result.structure2, structure1_cbor: frame.structure1_cbor }],
    };
    this.#store.setSession(sessionKey, newState);

    try {
      await this.#sendFrame(stream, encodeHashSubmitAck({ type: "hash_submit_ack", sequence_number: seq }));
    } catch {}

    const counterpartyHex = senderPubkeyHex === aHex ? bHex : aHex;
    const deliveryFrame = encodeLeafDeliver({
      type: "leaf_deliver",
      session_id: frame.session_id,
      leaf_kind: frame.leaf_kind,
      structure2_cbor: s2Cbor,
    });

    const counterpartyStream = this.#streams.get(counterpartyHex);
    if (counterpartyStream) {
      try {
        await this.#sendFrame(counterpartyStream, deliveryFrame);
        return;
      } catch {
        this.#streams.delete(counterpartyHex);
      }
    }
    this.#store.enqueueDelivery(counterpartyHex, {
      session_id: frame.session_id,
      leaf_kind: frame.leaf_kind,
      structure2_cbor: s2Cbor,
    });
  }

  // ─── Transport helpers ───────────────────────────────────────────────────────

  async #sendFrame(stream: Stream, bytes: Uint8Array): Promise<void> {
    stream.send(lp.encode.single(bytes));
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export interface CreateRelayNodeOptions {
  listenAddresses?: string[];
  directoryPubkey: Uint8Array;
  keyProvider?: KeyProvider;
  store?: RelayStore;
}

export async function createRelayNode(opts: CreateRelayNodeOptions): Promise<{
  relay: CelloRelayNode;
  node: CelloNode;
  stop: () => Promise<void>;
}> {
  const keyProvider = opts.keyProvider ?? generateKeypair();
  const node = await createNode({
    keyProvider,
    listenAddresses: opts.listenAddresses ?? ["/ip4/127.0.0.1/tcp/0"],
  });
  await node.start();

  const relay = new CelloRelayNode({
    node,
    directoryPubkey: opts.directoryPubkey,
    store: opts.store,
  });
  await relay.start();

  return {
    relay,
    node,
    stop: async () => { await node.stop(); },
  };
}
