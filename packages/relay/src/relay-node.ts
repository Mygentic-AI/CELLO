/**
 * CELLO Relay Node — CelloRelayNode (NODE-002 + NODE-004)
 *
 * Implements the /cello/relay/1.0.0 libp2p protocol:
 *   - Ed25519 challenge-response auth (domain: "CELLO-RELAY-AUTH-v1")
 *   - hash_submit processing: Structure 1 validation, sequence assignment, Structure 2 construction
 *   - leaf_deliver to counterparty (queued if disconnected, DB-001)
 *   - in-process calls: recordAssignment, submitForSeal, confirmSeal, rejectSeal
 *
 * CELLO-NODE-004: Also implements /cello/directory-relay/1.0.0 (inbound directory admin frames):
 *   - record_assignment: register session from directory
 *   - discard_session: remove provisional session
 *   - confirm_seal: destroy session after directory verifies
 *   - reject_seal: mark session seal_rejected after directory rejects
 *
 * Auth signature over: SHA-256("CELLO-RELAY-AUTH-v1" || nonce || pubkey)
 *   per RFC 8032 (Ed25519) and FIPS 180-4 (SHA-256)
 *
 * Structure 1 CBOR layout: [1, content_hash, sender_pubkey, session_id, last_seen_seq, timestamp]
 *   per MERKLE-002 and RFC 8949 §4.2.1
 * Structure 2 construction: per MERKLE-002 (buildStructure2, encodeStructure2)
 * Leaf hash: SHA-256(leaf_kind || structure2_cbor) per MERKLE-001
 *
 * ─── Phase P: CELLO-NODE-004 Pseudocode ──────────────────────────────────────
 *
 * DIRECTORY_RELAY_PROTOCOL_ID = "/cello/directory-relay/1.0.0"
 *
 * #handleDirectoryRelayStream(stream):
 *   // Read one request frame from the directory
 *   requestBytes = await readOneFrame(stream)
 *   if requestBytes is null: stream.close(); return
 *
 *   req = cborDecode(requestBytes)
 *   frameType = req.type
 *
 *   // Extract directory_signature from the frame; verify over CBOR of frame body
 *   directory_signature = req.directory_signature
 *   body = { ...req }; delete body.directory_signature  // body without signature
 *   bodyBytes = cborEncode(body)
 *   if !verify(this.#directoryPubkey, bodyBytes, directory_signature):
 *     stream.send(encode({ type: "auth_invalid" }))
 *     stream.close(); return
 *
 *   // Process the authenticated frame
 *   if frameType === "record_assignment":
 *     // Re-verify the standard relay assignment TBS (same as in-process recordAssignment)
 *     result = this.recordAssignment({ session_id, participant_a, participant_b, session_timestamp, directory_signature })
 *     if result.ok: stream.send(encode({ type: "assignment_ok" }))
 *     else: stream.send(encode({ type: "auth_invalid" }))  // signature invalid per recordAssignment
 *
 *   if frameType === "discard_session":
 *     this.discardSession(session_id)
 *     stream.send(encode({ type: "discard_ok" }))
 *
 *   if frameType === "confirm_seal":
 *     this.confirmSeal(session_id)
 *     stream.send(encode({ type: "confirm_ok" }))
 *
 *   if frameType === "reject_seal":
 *     this.rejectSeal(session_id, reason)
 *     stream.send(encode({ type: "reject_ok" }))
 *
 *   stream.close()
 *
 * start():
 *   // Register both protocol handlers
 *   node.handle(RELAY_PROTOCOL_ID, #handleRelayStream)
 *   node.handle(DIRECTORY_RELAY_PROTOCOL_ID, #handleDirectoryRelayStream)
 *
 * ─── End Phase P Pseudocode ───────────────────────────────────────────────────
 */

import { randomBytes, createHash } from "node:crypto";
import { Encoder, decode } from "cbor-x";
import * as lp from "it-length-prefixed";
import { verify, buildMerkleTree, merkleRoot, generateKeypair, msgLeafHash, ctrlLeafHash, nodeHash, buildRelayAckTbs } from "@cello-protocol/crypto";
import type { KeyProvider, LeafInput } from "@cello-protocol/crypto";
import { buildStructure2, encodeStructure2, computeGenesisPrevRoot } from "@cello-protocol/protocol-types";
import { createNode } from "@cello-protocol/transport";
import type { CelloNode } from "@cello-protocol/transport";
import type { Stream } from "@libp2p/interface";
import type { Logger, SessionWal } from "@cello-protocol/interfaces";
import { RELAY_SESSION_UNRECOVERABLE } from "@cello-protocol/interfaces";
import type {
  SessionAssignment,
  RelaySessionState,
  SealData,
  HashSubmitErrorReason,
  GapFillRequest,
} from "./relay-types.js";
import type { RelayStore } from "./relay-store.js";
import { InMemoryRelayStore } from "./relay-store.js";
import {
  encodeAuthChallenge,
  encodeAuthFailed,
  encodeAuthOk,
  encodeHashSubmitAck,
  encodeHashSubmitError,
  encodeLeafDeliver,
  encodeGapFillResponse,
  encodeGapFillError,
  decodeInboundFrame,
} from "./relay-frames.js";
import { protocolLog, truncId, truncHex } from "./protocol-log.js";

export const RELAY_PROTOCOL_ID = "/cello/relay/1.0.0";
export const DIRECTORY_RELAY_PROTOCOL_ID = "/cello/directory-relay/1.0.0";
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

/**
 * DirectoryAdapter: in-process interface the relay calls to trigger seal processing
 * and to look up predecessor relay public keys for ACK verification (FEDERATION-003).
 * Uses structural typing so relay package does not import @cello-protocol/directory.
 */
export interface DirectoryAdapter {
  processSeal(sessionId: Uint8Array, sealData: import("./relay-types.js").SealData): Promise<{ ok: true } | { ok: false; reason: string }>;
  /**
   * FEDERATION-003 AC-005/AC-006: Look up a relay's registered public key by relayId.
   * Returns undefined if the relayId is not registered.
   * Used when verifying predecessor relay ACK signatures on re-submission.
   */
  getRelayPublicKey?(relayId: string): Promise<string | undefined>;
}

export interface RelayNodeOptions {
  node: CelloNode;
  directoryPubkey: Uint8Array;
  directory?: DirectoryAdapter;
  store?: RelayStore;
  logger?: Logger;
  /** PERSIST-014: SessionWal for gap-fill leaf serving. */
  sessionWal?: SessionWal;
  /**
   * PERSIST-012: Signing key provider for signed relay ACKs.
   * When present, the relay signs every hash_submit_ack with this key and
   * includes relay_id, relay_signature, and timestamp in the ACK frame.
   * The relay's public key must be registered with the directory at startup
   * so clients can verify ACK signatures.
   * When absent, the relay issues unsigned ACKs (backward-compatible).
   */
  ackSigningKeyProvider?: KeyProvider;
  /**
   * PERSIST-012: Stable relay identifier included in signed ACKs.
   * Required when ackSigningKeyProvider is set.
   * Clients use this to look up the relay's public key from the directory.
   */
  relayId?: string;
}

export class CelloRelayNode {
  readonly #node: CelloNode;
  readonly #directoryPubkey: Uint8Array;
  readonly #directory: DirectoryAdapter | null;
  readonly #store: RelayStore;
  readonly #logger: Logger;
  readonly #sessionWal: SessionWal | null;
  /** PERSIST-012: signing key for hash_submit_ack signatures. Null = unsigned ACKs. */
  readonly #ackSigningKeyProvider: KeyProvider | null;
  /** PERSIST-012: stable relay identifier included in signed ACKs. */
  readonly #relayId: string | null;
  /** CELLO-M6B-009: idle session sweep interval timer. */
  #idleSweepInterval: NodeJS.Timeout | null = null;

  // nonce_hex → NonceEntry
  readonly #nonces = new Map<string, NonceEntry>();

  // pubkey_hex → authenticated relay stream (for delivery)
  readonly #streams = new Map<string, Stream>();

  // per-session mutex: session_id_hex → Promise chain
  readonly #sessionLocks = new Map<string, Promise<void>>();

  // M7-WIRE-001 SI-003: session_id_hex → bound session Peer IDs.
  // Populated by recordAssignment() when initiator_session_peer_id is present.
  // Enforcement (rejecting streams whose transport Peer ID is not in this binding)
  // belongs at the session-transport layer (DAEMON-002), not here — the relay only
  // knows the signing pubkey of each stream, not the transport-layer libp2p Peer ID.
  // Private — never exposed via public API.
  readonly #sessionPeerIdBindings = new Map<string, { initiator: string; counterparty: string }>();

  constructor(opts: RelayNodeOptions) {
    this.#node = opts.node;
    this.#directoryPubkey = opts.directoryPubkey;
    this.#directory = opts.directory ?? null;
    // Logger is optional for backward compatibility; defaults to a no-op for pre-M4 callers.
    // Initialise before #store so the default InMemoryRelayStore can receive the logger.
    this.#logger = opts.logger ?? {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    };
    // Pass the logger to the default store so enqueueDelivery backpressure warnings
    // are routed through the injected logger instead of console.warn.
    this.#store = opts.store ?? new InMemoryRelayStore({ logger: this.#logger });
    this.#sessionWal = opts.sessionWal ?? null;
    this.#ackSigningKeyProvider = opts.ackSigningKeyProvider ?? null;
    this.#relayId = opts.relayId ?? null;
  }

  async start(): Promise<void> {
    // CELLO-M6B-009 AC-005: explicit maxInboundStreams caps
    await this.#node.handle(RELAY_PROTOCOL_ID, (stream) => {
      void this.#handleRelayStream(stream);
    }, { maxInboundStreams: 2048 });
    await this.#node.handle(DIRECTORY_RELAY_PROTOCOL_ID, (stream) => {
      void this.#handleDirectoryRelayStream(stream);
    }, { maxInboundStreams: 128 });
    // OBS-001 AC-001: relay startup log
    const peerId = truncId(this.#node.getPeerId());
    const addrs = this.#node.listenAddresses();
    const addr = addrs.length > 0 ? addrs[0] : "(none)";
    protocolLog("RELAY", `Started — peer ${peerId}, relay ${addr}`);

    // Log every peer connect/disconnect so operator can confirm relay↔directory
    // and relay↔client connectivity without waiting for a session request.
    this.#node.onPeerConnect((connectedPeerId) => {
      const short = truncId(connectedPeerId);
      protocolLog("RELAY", `Peer connected: ${short}`);
    });
    this.#node.onPeerDisconnect((disconnectedPeerId) => {
      const short = truncId(disconnectedPeerId);
      protocolLog("RELAY", `Peer disconnected: ${short}`);
    });
  }

  // ─── /cello/directory-relay/1.0.0 handler (CELLO-NODE-004) ─────────────────

  /**
   * Handle inbound admin frames from the directory over /cello/directory-relay/1.0.0.
   * One request/response per stream (same pattern as /cello/frost/1.0.0).
   *
   * Auth: verify Ed25519 signature over CBOR of frame body (all fields except directory_signature).
   * The directory_signature covers the full CBOR-encoded frame body (excluding itself).
   */
  async #handleDirectoryRelayStream(stream: Stream): Promise<void> {
    try {
      // Read one request frame
      let requestBytes: Uint8Array | null = null;
      for await (const chunk of lp.decode(stream)) {
        requestBytes = chunk instanceof Uint8Array ? chunk : (chunk as unknown as { slice(): Uint8Array }).slice();
        break;
      }
      if (!requestBytes) { stream.close().catch(() => {}); return; }

      const req = decode(requestBytes) as Record<string, unknown>;
      const frameType = req["type"] as string | undefined;

      // Extract and verify directory_signature
      const directory_signature = req["directory_signature"] as Uint8Array | undefined;
      if (!directory_signature || !(directory_signature instanceof Uint8Array) || directory_signature.length !== 64) {
        stream.send(lp.encode.single(CBOR_ENC.encode({ type: "auth_invalid" })));
        await stream.close();
        return;
      }

      // Build the signed body: frame CBOR without directory_signature field
      const bodyObj: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(req)) {
        if (k !== "directory_signature") bodyObj[k] = v;
      }
      const bodyBytes = CBOR_ENC.encode(bodyObj) as Uint8Array;

      if (!verify(this.#directoryPubkey, bodyBytes, directory_signature)) {
        stream.send(lp.encode.single(CBOR_ENC.encode({ type: "auth_invalid" })));
        await stream.close();
        return;
      }

      // OBS-001: directory admin authenticated
      protocolLog("RELAY", `Directory admin authenticated (pubkey ${truncHex(Buffer.from(this.#directoryPubkey).toString("hex"))})`);

      // Authenticated — process the frame
      if (frameType === "record_assignment") {
        const session_id = req["session_id"] as Uint8Array;
        const participant_a = req["participant_a"] as Uint8Array;
        const participant_b = req["participant_b"] as Uint8Array;
        const session_timestamp_raw = req["session_timestamp"] as number | bigint;
        const session_timestamp = typeof session_timestamp_raw === "bigint"
          ? Number(session_timestamp_raw)
          : session_timestamp_raw;

        // recordAssignment verifies the standard relay assignment TBS
        // (CBOR of [session_id, participant_a, participant_b, session_timestamp])
        // assignment_signature signs CBOR([session_id, participant_a, participant_b, session_timestamp])
        // — the relay's internal TBS for recordAssignment. Required field; reject if absent.
        const assignment_signature = req["assignment_signature"] as Uint8Array | undefined;
        if (!assignment_signature || !(assignment_signature instanceof Uint8Array) || assignment_signature.length !== 64) {
          stream.send(lp.encode.single(CBOR_ENC.encode({ type: "auth_invalid" })));
          await stream.close();
          return;
        }

        const result = this.recordAssignment({
          session_id: session_id instanceof Uint8Array ? session_id : new Uint8Array(session_id as unknown as ArrayBuffer),
          participant_a: participant_a instanceof Uint8Array ? participant_a : new Uint8Array(participant_a as unknown as ArrayBuffer),
          participant_b: participant_b instanceof Uint8Array ? participant_b : new Uint8Array(participant_b as unknown as ArrayBuffer),
          session_timestamp,
          directory_signature: assignment_signature,
        });

        if (result.ok) {
          stream.send(lp.encode.single(CBOR_ENC.encode({ type: "assignment_ok" })));
        } else {
          // directory_signature_invalid from recordAssignment means the assignment TBS
          // signature is wrong — this is an auth issue
          stream.send(lp.encode.single(CBOR_ENC.encode({ type: "auth_invalid" })));
        }
        await stream.close();
        return;
      }

      if (frameType === "discard_session") {
        const session_id = req["session_id"] as Uint8Array;
        this.discardSession(session_id instanceof Uint8Array ? session_id : new Uint8Array(session_id as unknown as ArrayBuffer));
        stream.send(lp.encode.single(CBOR_ENC.encode({ type: "discard_ok" })));
        await stream.close();
        return;
      }

      if (frameType === "confirm_seal") {
        const session_id = req["session_id"] as Uint8Array;
        this.confirmSeal(session_id instanceof Uint8Array ? session_id : new Uint8Array(session_id as unknown as ArrayBuffer));
        stream.send(lp.encode.single(CBOR_ENC.encode({ type: "confirm_ok" })));
        await stream.close();
        return;
      }

      if (frameType === "reject_seal") {
        const session_id = req["session_id"] as Uint8Array;
        const reason = (req["reason"] as string) ?? "unknown";
        this.rejectSeal(
          session_id instanceof Uint8Array ? session_id : new Uint8Array(session_id as unknown as ArrayBuffer),
          reason
        );
        stream.send(lp.encode.single(CBOR_ENC.encode({ type: "reject_ok" })));
        await stream.close();
        return;
      }

      // Unknown frame type — close without state mutation
      stream.abort(new Error("unknown_directory_relay_frame_type"));
    } catch {
      // stream closed or reset — normal disconnect
    } finally {
      stream.close().catch(() => {});
    }
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

    // M7-WIRE-001 AC-008: bind session Peer IDs when provided by directory.
    // Stored privately — never exposed via public API (SI-003).
    const sessionKey = Buffer.from(assignment.session_id).toString("hex");
    if (assignment.initiator_session_peer_id && assignment.counterparty_session_peer_id) {
      this.#sessionPeerIdBindings.set(sessionKey, {
        initiator: assignment.initiator_session_peer_id,
        counterparty: assignment.counterparty_session_peer_id,
      });
    }

    // OBS-001 AC-010: session assigned
    const sessionHex = truncHex(sessionKey);
    protocolLog("RELAY", `Session assigned: ${sessionHex} → slot 1`);
    return { ok: true };
  }

  discardSession(sessionId: Uint8Array): void {
    const key = Buffer.from(sessionId).toString("hex");
    this.#store.destroySession(key);
    this.#sessionPeerIdBindings.delete(key);
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

    // OBS-001 AC-010: seal submitted
    protocolLog("RELAY", `Seal submitted — session ${truncHex(key)} (${leaves.length} leaves)`);

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
    this.#sessionPeerIdBindings.delete(key);
    // OBS-001 AC-010: seal confirmed
    protocolLog("RELAY", `Seal confirmed: ${truncHex(key)}`);
  }

  rejectSeal(sessionId: Uint8Array, _reason: string): void {
    const key = Buffer.from(sessionId).toString("hex");
    const state = this.#store.getSession(key);
    if (state) {
      this.#store.setSession(key, { ...state, status: "seal_rejected" });
    }
    this.#sessionPeerIdBindings.delete(key);
    protocolLog("RELAY", `Seal rejected: ${truncHex(key)}, reason: ${_reason}`);
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
          const isReconnect = this.#streams.has(authedPubkeyHex);
          this.#streams.set(authedPubkeyHex, stream);
          authed = true;

          // OBS-001 AC-010: client authenticated
          protocolLog("RELAY", `Client ${truncHex(authedPubkeyHex)} authenticated`);

          // Confirm auth success to client — eliminates the client's 200ms race window
          await this.#sendFrame(stream, encodeAuthOk({ type: "relay_auth_ok" }));

          // Flush any queued deliveries; re-enqueue any not sent before a send failure.
          const queued = this.#store.drainDeliveries(authedPubkeyHex);
          // OBS-001 AC-010: log reconnect for each session in the queued deliveries
          if (isReconnect && queued.length > 0) {
            const sessionIds = new Set(queued.map((d) => truncHex(Buffer.from(d.session_id).toString("hex"))));
            for (const sid of sessionIds) {
              protocolLog("RELAY", `Client ${truncHex(authedPubkeyHex!)} reconnected to session ${sid}`);
            }
          }
          let sentCount = 0;
          for (const d of queued) {
            try {
              await this.#sendFrame(stream, encodeLeafDeliver({ type: "leaf_deliver", ...d }));
              sentCount++;
            } catch { break; }
          }
          for (const d of queued.slice(sentCount)) {
            this.#store.enqueueDelivery(authedPubkeyHex, d);
          }
          continue;
        }

        // Authenticated: process hash_submit and gap_fill_request frames
        const parsed = decodeInboundFrame(frameBytes);
        if (!parsed) continue;
        if (parsed.type === "hash_submit") {
          await this.#processHashSubmit(stream, authedPubkeyHex!, parsed);
        } else if (parsed.type === "gap_fill_request") {
          await this.#processGapFillRequest(stream, authedPubkeyHex!, parsed);
        }
      }
    } catch {
      // stream closed or reset — normal disconnect
    } finally {
      if (authedPubkeyHex && this.#streams.get(authedPubkeyHex) === stream) {
        this.#streams.delete(authedPubkeyHex);
      }
    }
  }

  /**
   * PERSIST-014: Process gap_fill_request from an authenticated client.
   * SI-001: Only serves leaves with seq > from_seq (last agreed).
   * Returns RELAY_SESSION_UNRECOVERABLE if WAL is unavailable.
   */
  async #processGapFillRequest(
    stream: Stream,
    senderPubkeyHex: string,
    frame: GapFillRequest,
  ): Promise<void> {
    const sessionKey = Buffer.from(frame.session_id).toString("hex");

    // Verify the requester is a participant in this session
    const state = this.#store.getSession(sessionKey);
    if (!state) {
      try {
        await this.#sendFrame(stream, encodeGapFillError({ type: "gap_fill_error", reason: "session_not_found" }));
      } catch { /* stream closed */ }
      return;
    }

    const aHex = Buffer.from(state.assignment.participant_a).toString("hex");
    const bHex = Buffer.from(state.assignment.participant_b).toString("hex");
    if (senderPubkeyHex !== aHex && senderPubkeyHex !== bHex) {
      try {
        await this.#sendFrame(stream, encodeGapFillError({ type: "gap_fill_error", reason: "not_a_participant" }));
      } catch { /* stream closed */ }
      return;
    }

    // Validate bounds before WAL access
    if (frame.from_seq < 0 || frame.to_seq < 0 || frame.from_seq > frame.to_seq || (frame.to_seq - frame.from_seq) > 1000) {
      try {
        await this.#sendFrame(stream, encodeGapFillError({ type: "gap_fill_error", reason: "wal_unavailable" }));
      } catch { /* stream closed */ }
      return;
    }

    // If no SessionWal is configured, WAL is unavailable
    if (!this.#sessionWal) {
      this.#logger.error("relay.gap.fill.failed", { sessionId: sessionKey, reason: "session_wal_not_configured" });
      try {
        await this.#sendFrame(stream, encodeGapFillError({ type: "gap_fill_error", reason: "wal_unavailable" }));
      } catch { /* stream closed */ }
      return;
    }

    const result = await this.#sessionWal.getLeaves(sessionKey, frame.from_seq, frame.to_seq);
    if (result === RELAY_SESSION_UNRECOVERABLE) {
      this.#logger.error("relay.gap.fill.failed", { sessionId: sessionKey, reason: "wal_unrecoverable" });
      try {
        await this.#sendFrame(stream, encodeGapFillError({ type: "gap_fill_error", reason: "wal_unavailable" }));
      } catch { /* stream closed */ }
      return;
    }

    // Send gap-fill response with the filtered leaves
    try {
      await this.#sendFrame(stream, encodeGapFillResponse({
        type: "gap_fill_response",
        leaves: result.map((l) => ({
          sequence_number: l.sequence_number,
          sender_pubkey: l.sender_pubkey,
          content_hash: l.content_hash,
          sender_signature: l.sender_signature,
          prev_root: l.prev_root,
          structure1_cbor: l.structure1_cbor,
        })),
      }));
    } catch { /* stream closed */ }
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
      } catch (err) {
        this.#logger.error("relay.send.failed", {
          event: "hash_submit_error",
          reason: error,
          sessionId: sessionKey,
          err: err instanceof Error ? err.message : String(err),
        });
      }
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

    // FEDERATION-003 AC-005/AC-006/SI-002: If the frame carries a predecessor relay ACK,
    // verify it before processing. SI-002: MUST NOT fall back to accepting unverified ACKs.
    // If predecessor_relay_id is present, the full signature verification is mandatory.
    if (frame.predecessor_relay_id !== undefined) {
      const predecessorRelayId = frame.predecessor_relay_id;
      const predecessorSig = frame.predecessor_relay_signature;
      const predecessorSeq = frame.predecessor_relay_sequence;
      const predecessorTs = frame.predecessor_relay_timestamp;

      // SI-002: if any predecessor ACK field is missing or the directory adapter lacks
      // getRelayPublicKey, reject — there is no fallback to accepting unverified ACKs.
      if (!predecessorSig || predecessorSeq === undefined || predecessorTs === undefined) {
        await reply("RELAY_PREDECESSOR_UNKNOWN"); return;
      }
      if (!this.#directory || !this.#directory.getRelayPublicKey) {
        // No directory adapter — cannot verify predecessor ACK; reject per SI-002.
        this.#logger.warn("relay.predecessor.unknown", { relayId: predecessorRelayId, hashHex: "" });
        await reply("RELAY_PREDECESSOR_UNKNOWN"); return;
      }

      // Look up the predecessor relay's public key from the directory (AC-005/AC-006).
      const pubKeyHex = await this.#directory.getRelayPublicKey(predecessorRelayId);
      if (!pubKeyHex) {
        // AC-006: predecessor relayId not found in directory.
        const s1ForLog = decodeStructure1(frame.structure1_cbor);
        const hashHex = s1ForLog ? Buffer.from(s1ForLog.content_hash).toString("hex").slice(0, 16) : "(unknown)";
        this.#logger.warn("relay.predecessor.unknown", { relayId: predecessorRelayId, hashHex });
        await reply("RELAY_PREDECESSOR_UNKNOWN"); return;
      }

      // Verify the predecessor ACK signature: verify(pubKey, buildRelayAckTbs(contentHash, seq, ts), sig)
      // The TBS is SHA-256(hash_bytes || seq_BE4 || ts_BE8) per PERSIST-012.
      const s1Decoded = decodeStructure1(frame.structure1_cbor);
      if (!s1Decoded) { await reply("signature_invalid"); return; }

      const predecessorTbs = buildRelayAckTbs(s1Decoded.content_hash, predecessorSeq, predecessorTs);
      const pubKeyBytes = Buffer.from(pubKeyHex, "hex");
      const sigValid = verify(pubKeyBytes, predecessorTbs, predecessorSig);
      if (!sigValid) {
        // SI-002: signature invalid — reject unconditionally, no fallback.
        const hashHex = Buffer.from(s1Decoded.content_hash).toString("hex").slice(0, 16);
        this.#logger.warn("relay.predecessor.unknown", { relayId: predecessorRelayId, hashHex });
        await reply("RELAY_PREDECESSOR_UNKNOWN"); return;
      }
      // Predecessor ACK verified — proceed to process the re-submission.
    }

    // OBS-001 AC-010: log client joining session on their first submission to this session
    const alreadySent = state.leaf_log.some(
      (l) => Buffer.from(l.s2.sender_pubkey).toString("hex") === senderPubkeyHex,
    );
    if (!alreadySent) {
      protocolLog("RELAY", `Client ${truncHex(senderPubkeyHex)} joined session ${truncHex(sessionKey)}`);
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

    // prev_root for this leaf = running root of all prior leaves (O(1) read from state).
    // The running_root is updated below via the RFC 6962 incremental stack after the leaf is appended.
    const prevRoot = state.running_root;

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

    // RFC 6962 incremental stack update: O(log n) per append.
    // Push the new leaf hash onto the stack, merging with same-height entries as needed.
    // The running_root is the right-to-left fold of the stack with nodeHash.
    const newLeafHash = leafKind === "ctrl"
      ? ctrlLeafHash(s2Cbor)
      : msgLeafHash(s2Cbor);

    const newStack: Array<{ hash: Uint8Array; height: number }> = state.tree_stack.map((e) => ({
      hash: e.hash.slice(),
      height: e.height,
    }));
    let newNode = newLeafHash;
    let height = 0;
    while (newStack.length > 0 && newStack[newStack.length - 1]!.height === height) {
      const popped = newStack.pop()!;
      newNode = nodeHash(popped.hash, newNode);
      height++;
    }
    newStack.push({ hash: newNode, height });

    // Fold stack right-to-left to produce the new running root
    let newRunningRoot = newStack[newStack.length - 1]!.hash;
    for (let i = newStack.length - 2; i >= 0; i--) {
      newRunningRoot = nodeHash(newStack[i]!.hash, newRunningRoot);
    }

    const newState: RelaySessionState = {
      ...state,
      seq_counter: seq,
      leaf_log: [...state.leaf_log, { kind: leafKind, s2: s2Result.structure2, structure1_cbor: frame.structure1_cbor }],
      tree_stack: newStack,
      running_root: newRunningRoot,
    };
    this.#store.setSession(sessionKey, newState);

    // PERSIST-012: Build signed ACK when a signing key is configured.
    // TBS = SHA-256(hash_bytes || seq_BE4 || ts_BE8) per RFC 8032, FIPS 180-4.
    const ackTimestamp = Date.now();
    let ackFrame: import("./relay-types.js").HashSubmitAck = { type: "hash_submit_ack", sequence_number: seq };
    if (this.#ackSigningKeyProvider !== null && this.#relayId !== null) {
      try {
        const tbs = buildRelayAckTbs(s1.content_hash, seq, ackTimestamp);
        const relaySig = await this.#ackSigningKeyProvider.sign(tbs);
        ackFrame = {
          type: "hash_submit_ack",
          sequence_number: seq,
          relay_id: this.#relayId,
          relay_signature: relaySig,
          timestamp: ackTimestamp,
        };
      } catch (sigErr: unknown) {
        // Signing failed — fall back to unsigned ACK; log but do not reject the submission
        this.#logger.error("relay.ack.sign.failed", {
          seq,
          sessionId: sessionKey,
          err: sigErr instanceof Error ? sigErr.message : String(sigErr),
        });
      }
    }

    try {
      await this.#sendFrame(stream, encodeHashSubmitAck(ackFrame));
    } catch (err) {
      this.#logger.error("relay.send.failed", {
        event: "hash_submit_ack",
        seq,
        sessionId: sessionKey,
        err: err instanceof Error ? err.message : String(err),
      });
    }

    const counterpartyHex = senderPubkeyHex === aHex ? bHex : aHex;
    const deliveryFrame = encodeLeafDeliver({
      type: "leaf_deliver",
      session_id: frame.session_id,
      leaf_kind: frame.leaf_kind,
      sequence_number: seq,
      structure2_cbor: s2Cbor,
      structure1_cbor: frame.structure1_cbor,
    });

    // Echo leaf_deliver back to the sender on the same stream (MSG-004: sender waits for own echo
    // to update last_seen_seq and release the per-session outbound lock).
    try {
      await this.#sendFrame(stream, deliveryFrame);
    } catch (err) {
      this.#logger.error("relay.send.failed", {
        event: "leaf_echo",
        seq,
        sessionId: sessionKey,
        err: err instanceof Error ? err.message : String(err),
      });
    }

    // Deliver to counterparty
    const counterpartyStream = this.#streams.get(counterpartyHex);
    if (counterpartyStream) {
      try {
        await this.#sendFrame(counterpartyStream, deliveryFrame);
      } catch {
        this.#streams.delete(counterpartyHex);
        this.#store.enqueueDelivery(counterpartyHex, {
          session_id: frame.session_id,
          leaf_kind: frame.leaf_kind,
          sequence_number: seq,
          structure2_cbor: s2Cbor,
          structure1_cbor: frame.structure1_cbor,
        });
      }
    } else {
      this.#store.enqueueDelivery(counterpartyHex, {
        session_id: frame.session_id,
        leaf_kind: frame.leaf_kind,
        sequence_number: seq,
        structure2_cbor: s2Cbor,
        structure1_cbor: frame.structure1_cbor,
      });
    }

    // SESSION-003: after a ctrl leaf, check if both participants have now submitted SEAL leaves.
    // Two ctrl leaves from distinct senders in the log → trigger directory processSeal.
    if (leafKind === "ctrl" && this.#directory) {
      await this.#maybeProcessSeal(frame.session_id, sessionKey);
    }
  }

  async #maybeProcessSeal(sessionId: Uint8Array, sessionKey: string): Promise<void> {
    const state = this.#store.getSession(sessionKey);
    if (!state || state.status !== "active") return;

    // Check bilateral seal condition: two ctrl leaves from distinct participants
    const ctrlLeaves = state.leaf_log.filter((l) => l.kind === "ctrl");
    if (ctrlLeaves.length < 2) return;
    const senders = new Set(ctrlLeaves.map((l) => Buffer.from(l.s2.sender_pubkey).toString("hex")));
    if (senders.size < 2) return;

    const sealResult = this.submitForSeal(sessionId);
    if (!sealResult.ok) return;

    const dirResult = await this.#directory!.processSeal(sessionId, sealResult.data);
    if (dirResult.ok) {
      this.confirmSeal(sessionId);
    } else {
      this.rejectSeal(sessionId, dirResult.reason);
    }
  }

  // ─── Idle session sweep (CELLO-M6B-009) ──────────────────────────────────────

  /**
   * Start the idle session sweep.
   *
   * Runs immediately, then every `intervalMs` milliseconds.
   * Sessions with lastActivityAt older than `maxIdleMs` and status 'active' are destroyed.
   *
   * @param intervalMs How often to run the sweep (default: 1 hour = 3_600_000ms)
   * @param maxIdleMs Sessions idle longer than this are swept (default: 24 hours = 86_400_000ms)
   */
  startIdleSweep(intervalMs: number, maxIdleMs: number): void {
    const sweep = () => {
      const swept = this.#store.sweepIdleSessions(maxIdleMs, this.#logger);
      for (const key of swept) this.#sessionPeerIdBindings.delete(key);
    };

    // Run first sweep immediately to catch sessions that were idle before the relay process started.
    // This is intentional: on relay restart after a crash, sessions from the previous process instance
    // may still be in memory (or would be persisted in a future PgRelayStore). The immediate sweep
    // catches these aged-out sessions without waiting for the first scheduled interval.
    // On a fresh relay with no sessions, this emits relay.session.sweep.complete with sweptCount: 0.
    sweep();

    // Schedule recurring sweeps
    this.#idleSweepInterval = setInterval(sweep, intervalMs);
  }

  /**
   * Stop the idle session sweep.
   * Called during shutdown (SIGTERM handler).
   */
  stopIdleSweep(): void {
    if (this.#idleSweepInterval) {
      clearInterval(this.#idleSweepInterval);
      this.#idleSweepInterval = null;
    }
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
  directory?: DirectoryAdapter;
  keyProvider?: KeyProvider;
  store?: RelayStore;
  /** Persisted transport key for stable Peer ID (32-byte Ed25519 seed) */
  transportPrivateKey?: Uint8Array;
  /** PERSIST-014: WAL for serving gap-fill leaves. Required for reconciliation support. */
  sessionWal?: SessionWal;
  /** Structured logger injected at the composition root */
  logger?: Logger;
  /**
   * PERSIST-012: Signing key provider for signed relay ACKs.
   * When present, the relay signs every hash_submit_ack.
   */
  ackSigningKeyProvider?: KeyProvider;
  /**
   * PERSIST-012: Stable relay identifier for signed ACKs.
   * Required when ackSigningKeyProvider is set.
   */
  relayId?: string;
}

/**
 * Create and start a relay node.
 *
 * **Idle session sweep is NOT started automatically.**
 * The production binary (relay.ts) calls `relay.startIdleSweep(intervalMs, maxIdleMs)`
 * after `createRelayNode` returns. Tests should not start the sweep unless they are
 * specifically testing sweep behaviour — the sweep runs setInterval and must be stopped
 * via `relay.stopIdleSweep()` or it will keep the Node.js event loop alive.
 *
 * `stop()` calls `stopIdleSweep()` unconditionally, so callers that never started the
 * sweep are safe — `stopIdleSweep()` is a no-op when no interval is running.
 */
export async function createRelayNode(opts: CreateRelayNodeOptions): Promise<{
  relay: CelloRelayNode;
  node: CelloNode;
  stop: () => Promise<void>;
}> {
  const keyProvider = opts.keyProvider ?? generateKeypair();
  const node = await createNode({
    keyProvider,
    listenAddresses: opts.listenAddresses ?? ["/ip4/127.0.0.1/tcp/0"],
    transportPrivateKey: opts.transportPrivateKey,
  });
  await node.start();

  const relay = new CelloRelayNode({
    node,
    directoryPubkey: opts.directoryPubkey,
    directory: opts.directory,
    store: opts.store,
    sessionWal: opts.sessionWal,
    logger: opts.logger,
    ackSigningKeyProvider: opts.ackSigningKeyProvider,
    relayId: opts.relayId,
  });
  await relay.start();

  return {
    relay,
    node,
    // stopIdleSweep is called first to clear the setInterval handle before the node
    // shuts down — prevents a leaked interval from keeping Node.js alive after stop().
    // It is safe to call when startIdleSweep() was never called.
    stop: async () => {
      relay.stopIdleSweep();
      await node.stop();
    },
  };
}
