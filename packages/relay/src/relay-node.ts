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
import { verify, buildMerkleTree, merkleRoot, generateKeypair, nodeHash, buildRelayAckTbs } from "@cello-protocol/crypto";
import type { KeyProvider, LeafInput } from "@cello-protocol/crypto";
import { buildStructure2, encodeStructure2, computeGenesisPrevRoot } from "@cello-protocol/protocol-types";
import { createNode } from "@cello-protocol/transport";
// DOD-RELAY-KEEPALIVE-1 (review F1): a NAMESPACE import, deliberately, so the version guard below
// can SEE a transport that predates the connection-monitor policy instead of dying on an opaque
// ESM link error that names a symbol rather than a cause.
import * as transport from "@cello-protocol/transport";
import type { CelloNode } from "@cello-protocol/transport";
import type { Stream } from "@libp2p/interface";
import type { Logger, SessionWal, ContentStore } from "@cello-protocol/interfaces";
import { RELAY_SESSION_UNRECOVERABLE } from "@cello-protocol/interfaces";
import { ContentParkHandler } from "./content-park.js";
import { RELAY_LEAF_KINDS, RELAY_LEAF_HASHERS } from "./relay-types.js";
import type {
  SessionAssignment,
  RelaySessionState,
  SealData,
  HashSubmitErrorReason,
  GapFillRequest,
  SessionLivenessQuery,
  ClientRecordAssignment,
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
  encodeSessionInterrupted,
  encodeSessionLivenessResponse,
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
  processSeal(
    sessionId: Uint8Array,
    sealData: import("./relay-types.js").SealData,
    /** Optional redirect target — which directory adjudicates this seal (see the adapter). */
    target?: { peerId: string; multiaddr: string },
  ): Promise<{ ok: true } | { ok: false; reason: string; redirect?: { nodeId: string; peerId: string; multiaddr: string } }>;
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
  /**
   * FED-OPTIONB-SETUP-001 (any-directory): the full set of sovereign consortium directory node
   * pubkeys. Under Option B a client presents a directory-signed session assignment to its chosen
   * relay; the relay accepts an assignment signed by ANY of these (not just `directoryPubkey`). When
   * omitted, falls back to `[directoryPubkey]` (single-node / pre-federation). The directory-ADMIN
   * frame path still authenticates against the single `directoryPubkey` only.
   */
  directoryPubkeys?: Uint8Array[];
  /**
   * DOD-SEAL-BROKER-1: directory pubkey (hex) -> libp2p multiaddr for the directories in this
   * consortium. Lets the relay call back to the directory that BROKERED a session instead of one
   * pinned in configuration with no relationship to the conversation.
   *
   * Public data supplied by the environment, the same pattern as `directoryPubkeys` — the relay
   * still holds no consortium state internally and stays a standalone artifact.
   *
   * Deliberately NOT read from the client-presented assignment: a client could then name any address
   * it liked. The relay learns WHICH directory brokered a session from the assignment SIGNATURE,
   * which it already verifies against the pubkey set, and resolves the address itself.
   */
  directoryEndpointsByPubkey?: Record<string, string>;
  directory?: DirectoryAdapter;
  store?: RelayStore;
  logger?: Logger;
  /** PERSIST-014: SessionWal for gap-fill leaf serving. */
  sessionWal?: SessionWal;
  /**
   * M7-MSG-001: durable store-and-forward content store. When present, the relay
   * registers the content-park protocol (deposit/pull/confirm) and notifies a
   * (re)connecting recipient that has parked content.
   */
  contentStore?: ContentStore;
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
  /**
   * M7-SESSION-001 AC-002: Configurable idle timeout in milliseconds.
   * When a session has no activity for this duration, the relay emits
   * session_interrupted with reason 'timeout' to the remaining participant.
   * Set to a short value (e.g. 100ms) in tests. Default: no timeout (undefined).
   * When undefined, idle timeout is disabled (only peer disconnect triggers session_interrupted).
   */
  sessionIdleTimeoutMs?: number;
}

export class CelloRelayNode {
  readonly #node: CelloNode;
  readonly #directoryPubkey: Uint8Array;
  /** FED-OPTIONB-SETUP-001: consortium directory pubkeys a client-presented assignment may be signed by. */
  readonly #directoryPubkeys: Uint8Array[];
  /** DOD-SEAL-BROKER-1: directory pubkey hex -> multiaddr. Empty in single-directory deployments. */
  readonly #directoryEndpointsByPubkey: Record<string, string>;
  /** DOD-SEAL-BROKER-1: session id hex -> pubkey hex of the directory that signed its assignment. */
  readonly #sessionBrokerPubkey = new Map<string, string>();
  readonly #directory: DirectoryAdapter | null;
  readonly #store: RelayStore;
  readonly #logger: Logger;
  readonly #sessionWal: SessionWal | null;

  /** M7-MSG-001: content-park handler (store-and-forward). null when no contentStore. */
  readonly #contentParkHandler: ContentParkHandler | null;
  /** M7-MSG-001 (AC-017c): store-and-forward content store, for the TTL sweep scheduler. null when not configured. */
  readonly #contentStore: ContentStore | null;
  /** M7-MSG-001 (AC-017c): content-store TTL sweep interval timer. */
  #contentSweepInterval: NodeJS.Timeout | null = null;
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

  /** M7-SESSION-001: configurable idle timeout in milliseconds. undefined = disabled. */
  readonly #sessionIdleTimeoutMs: number | undefined;

  /** M7-SESSION-001: per-session idle timeout timers. session_id_hex → timer handle. */
  readonly #sessionIdleTimers = new Map<string, NodeJS.Timeout>();

  /** M7-SESSION-001: pubkey_hex → set of session_id_hex where this pubkey is a participant. */
  readonly #participantSessions = new Map<string, Set<string>>();

  constructor(opts: RelayNodeOptions) {
    this.#node = opts.node;
    this.#directoryPubkey = opts.directoryPubkey;
    // FED-OPTIONB-SETUP-001: the consortium set always contains the primary directoryPubkey, plus any
    // additional sovereign nodes. Deduped so a repeated pubkey doesn't cost an extra verify attempt.
    this.#directoryEndpointsByPubkey = opts.directoryEndpointsByPubkey ?? {};
    this.#directoryPubkeys = [opts.directoryPubkey];
    for (const pk of opts.directoryPubkeys ?? []) {
      if (!this.#directoryPubkeys.some((existing) => Buffer.from(existing).equals(Buffer.from(pk)))) {
        this.#directoryPubkeys.push(pk);
      }
    }
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
    this.#contentParkHandler = opts.contentStore
      ? new ContentParkHandler({ node: this.#node, store: opts.contentStore, logger: this.#logger })
      : null;
    this.#contentStore = opts.contentStore ?? null;
    this.#ackSigningKeyProvider = opts.ackSigningKeyProvider ?? null;
    this.#relayId = opts.relayId ?? null;
    this.#sessionIdleTimeoutMs = opts.sessionIdleTimeoutMs;
  }

  async start(): Promise<void> {
    // CELLO-M6B-009 AC-005: explicit maxInboundStreams caps
    await this.#node.handle(RELAY_PROTOCOL_ID, (stream) => {
      void this.#handleRelayStream(stream);
    }, { maxInboundStreams: 2048 });
    await this.#node.handle(DIRECTORY_RELAY_PROTOCOL_ID, (stream) => {
      void this.#handleDirectoryRelayStream(stream);
    }, { maxInboundStreams: 128 });
    // M7-MSG-001: register the content-park (store-and-forward) protocol when enabled.
    await this.#contentParkHandler?.start();
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

      // SESSION-002 (unilateral seal): the directory requests a session's signed-leaf
      // chain on demand so it can rebuild + verify the root for a unilateral seal (the
      // seal_unilateral frame carries no leaves). Read-only — no state mutation.
      if (frameType === "get_seal_leaves") {
        const session_id = req["session_id"] as Uint8Array;
        const sid = session_id instanceof Uint8Array ? session_id : new Uint8Array(session_id as unknown as ArrayBuffer);
        const result = this.getSealLeaves(sid);
        if (result.ok) {
          stream.send(lp.encode.single(CBOR_ENC.encode({
            type: "seal_leaves",
            leaves: result.data.leaves,
            merkle_root: result.data.merkle_root,
            seq_count: result.data.seq_count,
          })));
        } else {
          stream.send(lp.encode.single(CBOR_ENC.encode({ type: "seal_leaves_unavailable", reason: result.reason })));
        }
        await stream.close();
        return;
      }

      // SESSION-003 / DOD-LIVE-2: the directory asks the relay (the session-path liveness
      // AUTHORITY) whether a recipient is alive/gone/unknown, so the unilateral-seal ABSENT
      // attestation comes FROM THE RELAY, never self-asserted. Read-only.
      if (frameType === "get_session_liveness") {
        const counterparty_pubkey = req["counterparty_pubkey"] as Uint8Array;
        const cp = counterparty_pubkey instanceof Uint8Array ? counterparty_pubkey : new Uint8Array(counterparty_pubkey as unknown as ArrayBuffer);
        const counterpartyHex = Buffer.from(cp).toString("hex");
        const { liveness } = this.#store.getRecipientLiveness(counterpartyHex);
        stream.send(lp.encode.single(CBOR_ENC.encode({ type: "session_liveness", liveness })));
        await stream.close();
        return;
      }

      // Unknown frame type — close without state mutation
      stream.abort(new Error("unknown_directory_relay_frame_type"));
    } catch (err: unknown) {
      // stream closed or reset — normal disconnect
      this.#logger.debug("relay.directory.stream.closed", {
        reason: err instanceof Error ? err.message : String(err),
      });
    } finally {
      stream.close().catch(() => {});
    }
  }

  // ─── In-process directory calls ─────────────────────────────────────────────

  /**
   * FED-OPTIONB-SETUP-001 (Option B): handle a CLIENT-presented session assignment over the
   * authenticated client stream. This replaces the old directory→relay `recordAssignment` dial — the
   * relay no longer has any inbound connection from the directory for session setup. The client's
   * authority is the per-node directory signature (`assignment_signature`) carried in the frame; the
   * shared `recordAssignment` below verifies it against ANY consortium directory pubkey and binds the
   * session peer IDs. No directory-ADMIN body signature is required or accepted here (the client is not
   * the directory). `session_already_exists` is success from the client's view — the OTHER party (or a
   * retry) already recorded the same assignment, which is the idempotent expected case.
   */
  async #processClientRecordAssignment(stream: Stream, authedPubkeyHex: string, frame: ClientRecordAssignment): Promise<void> {
    // Defense-in-depth (code-review L3): the authenticated client must be a PARTICIPANT of the session it
    // is recording. The assignment is already consortium-signed (unforgeable) and a non-participant can't
    // submit leaves, so this is not load-bearing — but it stops an authenticated peer from pre-recording
    // arbitrary sessions it has no part in. Reject loud rather than silently record.
    const participantAHex = Buffer.from(frame.participant_a).toString("hex");
    const participantBHex = Buffer.from(frame.participant_b).toString("hex");
    if (authedPubkeyHex !== participantAHex && authedPubkeyHex !== participantBHex) {
      this.#logger.warn("relay.assignment.rejected", { sessionId: truncHex(Buffer.from(frame.session_id).toString("hex")), source: "client", reason: "not_a_participant" });
      await this.#sendFrame(stream, CBOR_ENC.encode({ type: "assignment_invalid", reason: "not_a_participant" }) as Uint8Array);
      return;
    }
    const result = this.recordAssignment({
      session_id: frame.session_id,
      participant_a: frame.participant_a,
      participant_b: frame.participant_b,
      session_timestamp: frame.session_timestamp,
      directory_signature: frame.assignment_signature,
      initiator_session_peer_id: frame.initiator_session_peer_id,
      counterparty_session_peer_id: frame.counterparty_session_peer_id,
    } as SessionAssignment);
    const sidHex = Buffer.from(frame.session_id).toString("hex");
    if (result.ok || result.reason === "session_already_exists") {
      this.#logger.info("relay.assignment.recorded", { sessionId: truncHex(sidHex), source: "client", reason: result.ok ? "recorded" : "already_exists" });
      protocolLog("RELAY", `Client-presented assignment recorded — session ${truncHex(sidHex)} (${result.ok ? "new" : "existing"})`);
      await this.#sendFrame(stream, CBOR_ENC.encode({ type: "assignment_ok" }) as Uint8Array);
      return;
    }
    // Verification failed (directory_signature_invalid) or a non-idempotent store failure: fail LOUD so
    // a forged/non-consortium assignment is diagnosable, never silently accepted (any-directory teeth).
    this.#logger.warn("relay.assignment.rejected", { sessionId: truncHex(sidHex), source: "client", reason: result.reason });
    await this.#sendFrame(stream, CBOR_ENC.encode({ type: "assignment_invalid", reason: result.reason }) as Uint8Array);
  }

  recordAssignment(assignment: SessionAssignment): { ok: true } | { ok: false; reason: string } {
    // Verify directory signature over canonical CBOR of
    //   [session_id, participant_a, participant_b, session_timestamp]
    // plus, when both session Peer IDs are present (M-4),
    //   initiator_session_peer_id, counterparty_session_peer_id.
    // The relay binds those Peer IDs into #sessionPeerIdBindings below, so the
    // signature must cover them — otherwise the relay would bind data it never
    // authenticated. The presence gate and field order here are byte-identical to
    // the directory's producer (directory-node.ts). When either Peer ID is absent
    // (pre-M7 / initiator-only) BOTH sides fall back to the original 4-field layout
    // so legacy assignments still verify.
    const tbsFields: unknown[] = [
      assignment.session_id,
      assignment.participant_a,
      assignment.participant_b,
      assignment.session_timestamp > 0xffffffff
        ? BigInt(assignment.session_timestamp)
        : assignment.session_timestamp,
    ];
    if (assignment.initiator_session_peer_id && assignment.counterparty_session_peer_id) {
      tbsFields.push(assignment.initiator_session_peer_id, assignment.counterparty_session_peer_id);
    }
    const tbs = CBOR_ENC.encode(tbsFields);
    // FED-OPTIONB-SETUP-001 (any-directory): the assignment may be signed by ANY sovereign consortium
    // directory node — not just node 0. Accept if the signature verifies against any configured
    // directory pubkey. In a single-node deployment this set is just [directoryPubkey] (unchanged).
    // DOD-SEAL-BROKER-1: find, not some. The signature already says WHICH sovereign directory
    // brokered this session; discarding that is why the relay later fell back to a configured
    // directory unrelated to the conversation.
    const signer = this.#directoryPubkeys.find((pk) => verify(pk, tbs, assignment.directory_signature));
    if (!signer) {
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

    // DOD-SEAL-BROKER-1: the brokering directory, recorded AFTER recordSession succeeded. Setting it
    // above the `session_already_exists` return let a re-presented assignment rewrite the broker for a
    // session the store had just refused to re-record — writing state for a rejected operation.
    this.#sessionBrokerPubkey.set(sessionKey, Buffer.from(signer).toString("hex"));
    if (assignment.initiator_session_peer_id && assignment.counterparty_session_peer_id) {
      this.#sessionPeerIdBindings.set(sessionKey, {
        initiator: assignment.initiator_session_peer_id,
        counterparty: assignment.counterparty_session_peer_id,
      });
    }

    // M7-SESSION-001: track participant → session mapping for interrupt emission
    const aHex = Buffer.from(assignment.participant_a).toString("hex");
    const bHex = Buffer.from(assignment.participant_b).toString("hex");
    if (!this.#participantSessions.has(aHex)) this.#participantSessions.set(aHex, new Set());
    if (!this.#participantSessions.has(bHex)) this.#participantSessions.set(bHex, new Set());
    this.#participantSessions.get(aHex)!.add(sessionKey);
    this.#participantSessions.get(bHex)!.add(sessionKey);

    // M7-SESSION-001 AC-002: start idle timeout timer if configured
    this.#startSessionIdleTimer(sessionKey);

    // OBS-001 AC-010: session assigned
    const sessionHex = truncHex(sessionKey);
    protocolLog("RELAY", `Session assigned: ${sessionHex} → slot 1`);
    return { ok: true };
  }

  discardSession(sessionId: Uint8Array): void {
    const key = Buffer.from(sessionId).toString("hex");
    // #cleanupSessionTracking is store-independent, so it is safe to run before
    // or after destroySession; it clears the idle timer, participant refs, and
    // the Peer ID binding in one place (M-2).
    this.#cleanupSessionTracking(key);
    this.#store.destroySession(key);
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

  /**
   * SESSION-002: read-only leaf-chain fetch for a unilateral seal. Unlike
   * submitForSeal it does NOT flip the session to "sealing" — the directory may
   * fetch, find a root mismatch, and reject the unilateral seal, in which case the
   * session must remain active (the present party may retry). Returns the full
   * signed-leaf chain + the relay's recomputed root, exactly as submitForSeal packages
   * it, so the directory verifies against the same encoding the bilateral path uses.
   */
  getSealLeaves(sessionId: Uint8Array): { ok: true; data: SealData } | { ok: false; reason: string } {
    const key = Buffer.from(sessionId).toString("hex");
    const state = this.#store.getSession(key);
    if (!state) return { ok: false, reason: "session_not_found" };
    // Accept "active" (the common unilateral case: one SEAL ctrl leaf present) or
    // "sealing" (a bilateral attempt already in flight). Anything else (sealed/
    // rejected/destroyed) has no recoverable chain.
    if (state.status !== "active" && state.status !== "sealing") {
      return { ok: false, reason: "session_not_active" };
    }
    const leaves = state.leaf_log.slice();
    const leafInputs: LeafInput[] = leaves.map((l) => ({
      kind: l.kind,
      data: encodeStructure2(l.s2),
    }));
    const tree = buildMerkleTree(leafInputs);
    const root = merkleRoot(tree);
    return {
      ok: true,
      data: { leaves, seq_count: state.seq_counter, merkle_root: root },
    };
  }

  confirmSeal(sessionId: Uint8Array): void {
    const key = Buffer.from(sessionId).toString("hex");
    this.#cleanupSessionTracking(key);
    this.#store.destroySession(key);
    this.#sessionLocks.delete(key);
    // OBS-001 AC-010: seal confirmed
    protocolLog("RELAY", `Seal confirmed: ${truncHex(key)}`);
  }

  rejectSeal(sessionId: Uint8Array, _reason: string): void {
    const key = Buffer.from(sessionId).toString("hex");
    this.#cleanupSessionTracking(key);
    const state = this.#store.getSession(key);
    if (state) {
      this.#store.setSession(key, { ...state, status: "seal_rejected" });
    }
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

          // M7-SESSION-003 AC-001/AC-003: the authenticated standing connection
          // IS the session-path liveness signal for relay-mode sessions, keyed by
          // recipient pubkey (the same key as the delivery queue). Record 'alive';
          // a prior 'gone' flips back to 'alive' (never sticky across reconnect).
          if (this.#store.recordRecipientAlive(authedPubkeyHex).changed) {
            this.#logger.info("session.liveness.changed", {
              counterpartyPubkey: authedPubkeyHex,
              transportPath: "relay",
              liveness: "alive",
              observedBy: "relay",
            });
          }

          // M7-SESSION-001 AC-002: reset idle timer when a participant connects or reconnects.
          // The idle timeout measures inactivity from the last participant connection,
          // not from recordAssignment (participants may join seconds after assignment).
          for (const sessionIdHex of (this.#participantSessions.get(authedPubkeyHex) ?? [])) {
            this.#resetSessionIdleTimer(sessionIdHex);
          }

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

          // M7-MSG-001: notify a (re)connecting recipient that has parked content.
          // The notify rides the authenticated relay stream; the recipient then pulls
          // the ciphertext over the content-park protocol. Best-effort — a failure here
          // never affects the auth/delivery path.
          if (this.#contentParkHandler) {
            try {
              // F6 (review round 1): notify ONCE PER parked content_hash so each notify
              // frame carries the required content_hash field and the observability event
              // matches the spec ([recipientPubkey, contentHash]). The recipient pulls all
              // entries on the first notify; subsequent notifies for hashes already pulled
              // are harmless (the pull request is content-hash-scoped or pulls-all).
              const parkedHashes = await this.#contentParkHandler.listContentFor(authedPubkeyHex);
              for (const contentHashHex of parkedHashes) {
                await this.#sendFrame(stream, CBOR_ENC.encode({
                  type: "content_park_notify",
                  recipient_pubkey: resp.pubkey,
                  content_hash: Buffer.from(contentHashHex, "hex"),
                }) as Uint8Array);
                this.#logger.info("content.park.notified", {
                  recipientPubkey: authedPubkeyHex,
                  contentHash: contentHashHex,
                });
              }
            } catch (err: unknown) {
              this.#logger.warn("content.park.failed", {
                recipientPubkey: authedPubkeyHex,
                reason: err instanceof Error ? err.message : String(err),
              });
            }
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
        } else if (parsed.type === "session_liveness_query") {
          await this.#processSessionLivenessQuery(stream, parsed);
        } else if (parsed.type === "client_record_assignment") {
          await this.#processClientRecordAssignment(stream, authedPubkeyHex!, parsed);
        }
      }
    } catch (err: unknown) {
      // stream closed or reset — normal disconnect
      this.#logger.debug("relay.client.stream.closed", {
        reason: err instanceof Error ? err.message : String(err),
      });
    } finally {
      if (authedPubkeyHex && this.#streams.get(authedPubkeyHex) === stream) {
        this.#streams.delete(authedPubkeyHex);
        // M7-SESSION-003 AC-001: the standing connection dropped — record a
        // POSITIVE session-path 'gone' observation, keyed by recipient pubkey.
        // recordRecipientGone is a no-op for an untracked recipient (never
        // fabricates 'gone'). Emit the WARN transition exactly once.
        if (this.#store.recordRecipientGone(authedPubkeyHex).changed) {
          this.#logger.warn("session.liveness.changed", {
            counterpartyPubkey: authedPubkeyHex,
            transportPath: "relay",
            liveness: "gone",
            observedBy: "relay",
          });
        }
        // M7-SESSION-001 AC-001: emit session_interrupted to the remaining participant
        // when a peer's stream drops. Best-effort delivery — if the remaining participant
        // is also unreachable, the frame is discarded silently.
        this.#emitSessionInterrupted(authedPubkeyHex, "peer_disconnected");
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

  /**
   * M7-SESSION-003 AC-002: answer a session_liveness_query over the relay stream.
   * The relay is the session-path liveness authority for relay-mode sessions: it
   * holds the recipient's standing connection. liveness is read straight from the
   * tracked store state — 'alive' iff the standing connection is currently held,
   * 'gone' iff a disconnect was positively observed, 'unknown' iff never tracked.
   * The relay NEVER fabricates 'gone' from a missing entry.
   */
  async #processSessionLivenessQuery(stream: Stream, frame: SessionLivenessQuery): Promise<void> {
    const counterpartyHex = Buffer.from(frame.counterparty_pubkey).toString("hex");
    const { liveness, observedAt } = this.#store.getRecipientLiveness(counterpartyHex);
    try {
      await this.#sendFrame(stream, encodeSessionLivenessResponse({
        type: "session_liveness_response",
        session_id: frame.session_id,
        counterparty_pubkey: frame.counterparty_pubkey,
        liveness,
        observed_at: observedAt,
      }));
    } catch (err: unknown) {
      // Stream closed while responding — the querying client will time out and
      // fail SAFE to DELIVERED. Surface the cause; never swallow it silently.
      this.#logger.debug("relay.liveness.query.response.failed", {
        counterpartyPubkey: counterpartyHex.slice(0, 16),
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async #processHashSubmit(
    stream: Stream,
    senderPubkeyHex: string,
    frame: import("./relay-types.js").HashSubmit
  ): Promise<void> {
    const sessionKey = Buffer.from(frame.session_id).toString("hex");

    // M7-SESSION-001: reset idle timer on activity
    this.#resetSessionIdleTimer(sessionKey);

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

    // The accepted leaf domains. 0x01 is absent and must stay absent: it is the RFC 6962
    // internal-node prefix, so a leaf hashed under it aliases an internal node and forges
    // tree shape (§2.1.3). Everything outside this set is refused rather than coerced —
    // a coerced kind would hash under the wrong domain and diverge the two parties' roots.
    const leafKind = RELAY_LEAF_KINDS[frame.leaf_kind];
    if (!leafKind) {
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

    // RFC 6962 incremental stack update: O(log n) per append.
    // Push the new leaf hash onto the stack, merging with same-height entries as needed.
    // The running_root is the right-to-left fold of the stack with nodeHash.
    const newLeafHash = RELAY_LEAF_HASHERS[leafKind](s2Cbor);

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

    // OBS / DOD-SPINE-6 + DOD-INV-8: the relay witnessing + sequencing a leaf is a
    // load-bearing, observable event — the relay is the Structure-2 ordering authority.
    // Structured event for log pipelines; protocolLog line names the wire frame so the
    // witness is greppable as "hash_submit" (the DoD line: "relay log shows a hash_submit").
    // Content never appears here — only the signed hash leaf (INV-3).
    this.#logger.info("relay.hash.submitted", {
      sessionId: sessionKey,
      sequenceNumber: seq,
      senderPubkey: senderPubkeyHex,
      leafKind,
    });
    protocolLog(
      "RELAY",
      `hash_submit witnessed — session ${truncHex(sessionKey)} seq ${seq} from ${truncHex(senderPubkeyHex)} (${leafKind})`,
    );

    // PERSIST-012: Build signed ACK when a signing key is configured.
    // TBS = SHA-256(hash_bytes || seq_BE4 || ts_BE8) per RFC 8032, FIPS 180-4.
    const ackTimestamp = Date.now();
    // DOD-MSG-4: return the committed Structure2 to the SENDER so it stamps the signed ordering
    // record into its self-ordering content frame (the SAME s2Cbor delivered to the counterparty).
    let ackFrame: import("./relay-types.js").HashSubmitAck = { type: "hash_submit_ack", sequence_number: seq, structure2_cbor: s2Cbor };
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
          structure2_cbor: s2Cbor,
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
        // OBS / DOD-SPINE-6: the witnessed leaf was forwarded to the connected
        // counterparty (the DoD line: "leaf_deliver to B's session Peer ID").
        this.#logger.info("relay.leaf.delivered", {
          sessionId: sessionKey,
          sequenceNumber: seq,
          recipientPubkey: counterpartyHex,
          leafKind,
        });
        protocolLog(
          "RELAY",
          `leaf_deliver — session ${truncHex(sessionKey)} seq ${seq} to ${truncHex(counterpartyHex)}`,
        );
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

    // DOD-SEAL-BROKER-1: ask the directory that BROKERED this session, not the configured one.
    //
    // The configured directory (`relay_primary_directory`) is chosen at deploy time and has no
    // relationship to who is talking — it may be the home of one participant, or of NEITHER. The
    // brokering directory always has a relationship: it set the session up, and in the cross-directory
    // case it is the counterparty's home, so it holds at least one participant's connection.
    //
    // Falls back to the configured directory when the broker is unknown or its address is not
    // configured, so single-directory deployments are unaffected.
    const brokerTarget = this.#resolveSessionBroker(Buffer.from(sessionId).toString("hex"));
    let dirResult = await this.#directory!.processSeal(sessionId, sealResult.data, brokerTarget ?? undefined);

    // FOLLOW THE REDIRECT, once. The seal must be adjudicated by the node holding the seal
    // initiator's signaling stream: `seal_verified` is pushed from a LOCAL stream map, and
    // notification_queue is per-node and NOT replicated, so a directory that lacks that stream can
    // never deliver it — the seal would hang until both clients timed out. The configured directory
    // is the only one the relay knows statically; it tells us which node can finish the job.
    //
    // Exactly one hop: a second redirect would mean the consortium disagrees about homing, and
    // chasing it risks a loop. Better to reject with the reason than to spin.
    let adjudicator: "broker" | "configured" | "redirect" = brokerTarget ? "broker" : "configured";

    // ROUTE AROUND AN UNREACHABLE BROKER. Targeting the broker introduced a second way to fail that
    // the configured-directory path never had: the broker's address can be stale, rotated, or
    // firewalled. `processSeal` dials only the target it is given and returns the transport error as
    // `reason` with NO redirect, so without this the seal is rejected outright — one unreachable node
    // making the system unusable, which the sovereign-node redundancy invariant forbids. Before this
    // line existed the configured directory would have been asked and would have redirected.
    //
    // Any broker failure that carries no redirect earns the retry, rather than only ones that look
    // transport-shaped: misclassifying a transport error as a protocol rejection costs an available
    // seal, while the reverse costs one wasted dial. Re-adjudication cannot double-notarize — the
    // notarization is idempotent on (session_id, seal_type).
    if (!dirResult.ok && !dirResult.redirect && brokerTarget) {
      this.#logger.warn("relay.seal.broker.unreachable", {
        sessionId: truncHex(Buffer.from(sessionId).toString("hex")),
        brokerMultiaddr: brokerTarget.multiaddr,
        reason: dirResult.reason,
        action: "retrying against the configured directory",
      });
      dirResult = await this.#directory!.processSeal(sessionId, sealResult.data);
      adjudicator = "configured";
    }

    if (!dirResult.ok && dirResult.redirect) {
      const { nodeId, peerId, multiaddr } = dirResult.redirect;
      this.#logger.info("relay.seal.redirected", { nodeId, reason: dirResult.reason });
      dirResult = await this.#directory!.processSeal(sessionId, sealResult.data, { peerId, multiaddr });
      adjudicator = "redirect";
    }

    if (dirResult.ok) {
      this.confirmSeal(sessionId);
    } else {
      // F6: rejectSeal DISCARDS its reason (`_reason`) and sends nothing to the participants, so
      // without this the only trace of the cause was one stdout line — and both agents simply waited
      // out the full bilateral window and reported a timeout. The cause dies here otherwise.
      this.#logger.warn("relay.seal.rejected", {
        sessionId: truncHex(Buffer.from(sessionId).toString("hex")),
        reason: dirResult.reason,
        adjudicator,
      });
      this.rejectSeal(sessionId, dirResult.reason);
    }
  }

  /**
   * DOD-SEAL-BROKER-1: resolve the directory that brokered a session to something dialable.
   *
   * Returns null when the broker is unknown (an assignment recorded before this shipped) or when its
   * address is absent from configuration — the caller then uses the configured directory, which is
   * the pre-existing behaviour. NOT directory-presented assignments: those route through the same
   * `recordAssignment()`, so they populate the broker map too.
   *
   * peerId is derived from the multiaddr's trailing /p2p/ segment rather than configured separately,
   * so the two cannot disagree.
   */
  #resolveSessionBroker(sessionIdHex: string): { peerId: string; multiaddr: string } | null {
    const brokerPubkey = this.#sessionBrokerPubkey.get(sessionIdHex);
    if (!brokerPubkey) {
      // Logged for symmetry with the other two null branches — a silent null here is
      // indistinguishable from "no broker selection in this build" when reading a seal trace.
      this.#logger.debug("relay.seal.broker.unrecorded", {
        sessionId: truncHex(sessionIdHex),
        reason: "no broker recorded for this session — using the configured directory",
      });
      return null;
    }
    const multiaddr = this.#directoryEndpointsByPubkey[brokerPubkey];
    if (!multiaddr) {
      this.#logger.warn("relay.seal.broker.address_unknown", {
        sessionId: truncHex(sessionIdHex),
        brokerPubkey: brokerPubkey.slice(0, 16),
        reason: "no multiaddr configured for the brokering directory — falling back to the configured directory",
      });
      return null;
    }
    const peerId = multiaddr.split("/p2p/")[1]?.split("/")[0];
    if (!peerId) {
      this.#logger.warn("relay.seal.broker.multiaddr_lacks_peer_id", {
        sessionId: truncHex(sessionIdHex),
        brokerPubkey: brokerPubkey.slice(0, 16),
      });
      return null;
    }
    this.#logger.info("relay.seal.broker.resolved", {
      sessionId: truncHex(sessionIdHex),
      brokerPubkey: brokerPubkey.slice(0, 16),
    });
    return { peerId, multiaddr };
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
      // M-2: a swept session is terminal — clean ALL tracking maps (participant
      // refs, idle timer, Peer ID binding), not just the binding. The store entry
      // is already destroyed by sweepIdleSessions, so #cleanupSessionTracking must
      // be store-independent (it is) to avoid leaking participant/timer entries.
      for (const key of swept) this.#cleanupSessionTracking(key);
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

  // ─── Content-store TTL sweep (M7-MSG-001 AC-017c) ─────────────────────────────

  /**
   * Start the store-and-forward content-store TTL sweep.
   *
   * Runs immediately, then every `intervalMs` milliseconds. Each run reclaims
   * TTL-expired parked entries (CONTENT_STORE_TTL_MS) regardless of whether the
   * recipient ever reconnects. Without this, expired entries are reclaimed only on
   * next access (hasContent/pull/pullOne) — a recipient that parks content and never
   * comes back would otherwise leave entries on disk bounded only by cap eviction.
   * AC-017(c) lists "the TTL sweep runs" as an explicit reclamation trigger.
   *
   * No-op when no content store is configured (CELLO_ENV with store-and-forward off).
   * Mirrors the CELLO-M6B-009 idle-session sweep scheduler (startIdleSweep).
   *
   * @param intervalMs How often to run the sweep (production: 1 hour).
   */
  startContentSweep(intervalMs: number): void {
    const store = this.#contentStore;
    if (!store) return;
    const sweep = (): void => {
      // sweepExpired is async; the interval callback cannot await, so observe the
      // result via the logger and never let a rejection escape the timer.
      void store
        .sweepExpired()
        .then((deletedCount) => {
          this.#logger.debug("content.store.sweep.complete", { deletedCount });
        })
        .catch((err: unknown) => {
          const reason = err instanceof Error ? err.message : String(err);
          this.#logger.error("content.store.sweep.failed", { reason });
        });
    };
    // Immediate sweep catches entries that expired while the relay was down (restart).
    sweep();
    this.#contentSweepInterval = setInterval(sweep, intervalMs);
  }

  /**
   * Stop the content-store TTL sweep. Called during shutdown. Safe to call when
   * startContentSweep() was never called (no-op).
   */
  stopContentSweep(): void {
    if (this.#contentSweepInterval) {
      clearInterval(this.#contentSweepInterval);
      this.#contentSweepInterval = null;
    }
  }

  // ─── M7-SESSION-001: session tracking cleanup ──────────────────────────────

  /**
   * Single authority for tearing down ALL in-memory tracking for a terminated
   * session (M-2). Removes the idle timer, every participant→session reference,
   * and the bound session Peer IDs together, so no terminal path can forget one
   * map. Called on discardSession, confirmSeal, rejectSeal, and the idle sweep.
   *
   * Store-independent by design: it scans #participantSessions directly instead
   * of reading the store. The idle sweep destroys the store entry before this
   * runs, so a store-lookup approach would silently leak participant and timer
   * entries for swept sessions. SI-003 is preserved — this only deletes the
   * binding, it never exposes Peer ID values.
   */
  #cleanupSessionTracking(sessionIdHex: string): void {
    // Clear idle timer
    const timer = this.#sessionIdleTimers.get(sessionIdHex);
    if (timer) {
      clearTimeout(timer);
      this.#sessionIdleTimers.delete(sessionIdHex);
    }

    // Remove from participant → session mapping (store-independent scan).
    // Drop participant entries whose session set becomes empty so the map
    // does not accumulate empty Sets over the relay's lifetime.
    for (const [pubkeyHex, sessions] of this.#participantSessions) {
      if (sessions.delete(sessionIdHex) && sessions.size === 0) {
        this.#participantSessions.delete(pubkeyHex);
      }
    }

    // Remove the bound session Peer IDs (M7-WIRE-001 SI-003).
    this.#sessionPeerIdBindings.delete(sessionIdHex);

    // The brokering directory (DOD-SEAL-BROKER-1). Safe to drop here: the seal path reads it before
    // confirmSeal/rejectSeal reach cleanup. Without this the relay accumulated one entry per session
    // for its entire lifetime — and because sessionTrackingEntryCount did not report it, the eight
    // teardown-parity assertions kept passing while the leak grew.
    this.#sessionBrokerPubkey.delete(sessionIdHex);
  }

  /**
   * M-2 test/diagnostic helper. Reports how many internal tracking entries still
   * reference a session, so tests can prove teardown parity (zero leaks after a
   * terminal event or idle sweep). Returns COUNTS/booleans only — it never
   * exposes Peer ID values, so SI-003 is preserved.
   */
  sessionTrackingEntryCount(sessionIdHex: string): {
    participantRefs: number;
    hasBinding: boolean;
    hasIdleTimer: boolean;
    hasBroker: boolean;
  } {
    let participantRefs = 0;
    for (const sessions of this.#participantSessions.values()) {
      if (sessions.has(sessionIdHex)) participantRefs++;
    }
    return {
      participantRefs,
      hasBinding: this.#sessionPeerIdBindings.has(sessionIdHex),
      hasIdleTimer: this.#sessionIdleTimers.has(sessionIdHex),
      hasBroker: this.#sessionBrokerPubkey.has(sessionIdHex),
    };
  }

  // ─── M7-SESSION-001: session_interrupted emission ───────────────────────────

  /**
   * Emit session_interrupted frames to the remaining connected participant
   * when a peer disconnects or a session times out.
   *
   * Finds all active sessions where `disconnectedPubkeyHex` is a participant,
   * and sends a session_interrupted frame to the counterparty. Best-effort:
   * if the counterparty is also unreachable, the frame is discarded silently.
   *
   * @param disconnectedPubkeyHex K_local pubkey hex of the disconnected participant
   * @param reason 'peer_disconnected' or 'timeout'
   */
  #emitSessionInterrupted(disconnectedPubkeyHex: string, reason: "peer_disconnected" | "timeout"): void {
    // Scan all sessions in the store to find ones where this pubkey is a participant.
    // The relay knows participant pubkeys from the SessionAssignment recorded at session creation.
    // We iterate all session entries to find matches.
    const sessionsToNotify = this.#findSessionsForParticipant(disconnectedPubkeyHex);

    for (const { sessionIdHex, counterpartyPubkeyHex } of sessionsToNotify) {
      // Clear any idle timer for this session
      const timer = this.#sessionIdleTimers.get(sessionIdHex);
      if (timer) {
        clearTimeout(timer);
        this.#sessionIdleTimers.delete(sessionIdHex);
      }

      // M-2 / reconnect (STRUCTURAL): a peer disconnect is NOT terminal at the
      // relay. The queued-delivery + reconnect path (MSG-004 / relay-node AC-012)
      // requires the session to survive a participant dropping — A keeps
      // submitting while B is offline, and B drains the queue on reconnect. So we
      // do NOT call #cleanupSessionTracking or destroy the store entry here; the
      // session stays 'active' and discoverable. Terminal teardown belongs to the
      // seal paths (confirm/reject/discard) and the idle-timeout timer below —
      // NOT to a transient disconnect. session_interrupted is a best-effort
      // notification to the remaining participant, not a session kill.
      const counterpartyStream = this.#streams.get(counterpartyPubkeyHex);
      if (!counterpartyStream) {
        // Counterparty also unreachable — discard silently per spec
        continue;
      }

      const frame = encodeSessionInterrupted({
        type: "session_interrupted",
        sessionId: sessionIdHex,
        reason,
      });

      this.#sendFrame(counterpartyStream, frame).then(() => {
        this.#logger.info("relay.session.interrupted.emitted", {
          sessionId: sessionIdHex.slice(0, 16),
          disconnectedPeer: disconnectedPubkeyHex.slice(0, 16),
          counterparty: counterpartyPubkeyHex.slice(0, 16),
          reason,
        });
      }).catch((err: unknown) => {
        // Send failed — counterparty stream may have just closed too. Discard silently.
        this.#logger.debug("relay.session.interrupted.send.failed", {
          sessionId: sessionIdHex.slice(0, 16),
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
  }

  /**
   * Find all active sessions where `pubkeyHex` is a participant.
   * Returns the session ID and the counterparty's pubkey hex for each.
   */
  #findSessionsForParticipant(pubkeyHex: string): Array<{ sessionIdHex: string; counterpartyPubkeyHex: string }> {
    const results: Array<{ sessionIdHex: string; counterpartyPubkeyHex: string }> = [];
    // We need access to the store's sessions. Since RelayStore doesn't expose iteration,
    // we use the getSession method with known session IDs. However, we track sessions
    // in #sessionPeerIdBindings and can also scan via the store.
    // For now, we'll use a different approach: maintain a mapping from pubkey to session IDs.
    // Actually, the store's sessions are keyed by session_id_hex. We need to scan them.
    // The InMemoryRelayStore doesn't expose iteration. Let's track participant → session mappings.
    //
    // Implementation: we maintain a #participantSessions map populated in recordAssignment.
    for (const sessionIdHex of (this.#participantSessions.get(pubkeyHex) ?? [])) {
      const session = this.#store.getSession(sessionIdHex);
      if (!session || session.status !== "active") continue;

      const aHex = Buffer.from(session.assignment.participant_a).toString("hex");
      const bHex = Buffer.from(session.assignment.participant_b).toString("hex");
      const counterpartyPubkeyHex = aHex === pubkeyHex ? bHex : aHex;
      results.push({ sessionIdHex, counterpartyPubkeyHex });
    }
    return results;
  }

  /**
   * M7-SESSION-001 AC-002: Start an idle timeout timer for a session.
   * When the timer fires, emit session_interrupted with reason 'timeout'.
   */
  #startSessionIdleTimer(sessionIdHex: string): void {
    if (this.#sessionIdleTimeoutMs === undefined) return;

    // Clear any existing timer for this session
    const existing = this.#sessionIdleTimers.get(sessionIdHex);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.#sessionIdleTimers.delete(sessionIdHex);
      const session = this.#store.getSession(sessionIdHex);
      if (!session || session.status !== "active") return;

      const aHex = Buffer.from(session.assignment.participant_a).toString("hex");
      const bHex = Buffer.from(session.assignment.participant_b).toString("hex");

      // Emit timeout to both participants (whichever is still connected)
      for (const participantHex of [aHex, bHex]) {
        const participantStream = this.#streams.get(participantHex);
        if (!participantStream) continue;

        const frame = encodeSessionInterrupted({
          type: "session_interrupted",
          sessionId: sessionIdHex,
          reason: "timeout",
        });

        this.#sendFrame(participantStream, frame).then(() => {
          this.#logger.info("relay.session.interrupted.emitted", {
            sessionId: sessionIdHex.slice(0, 16),
            disconnectedPeer: "timeout",
            counterparty: participantHex.slice(0, 16),
            reason: "timeout",
          });
        }).catch((err: unknown) => {
          this.#logger.debug("relay.session.interrupted.send.failed", {
            sessionId: sessionIdHex.slice(0, 16),
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }

      // M-2: timeout interruption is terminal. Tear down all in-memory tracking
      // and destroy the store entry so the session is no longer served as
      // active. (The idle timer entry was already removed above;
      // #cleanupSessionTracking also clears participant refs and the binding.)
      this.#cleanupSessionTracking(sessionIdHex);
      this.#store.destroySession(sessionIdHex);
    }, this.#sessionIdleTimeoutMs);

    this.#sessionIdleTimers.set(sessionIdHex, timer);
  }

  /**
   * M7-SESSION-001: Reset the idle timeout timer for a session (called on activity).
   */
  #resetSessionIdleTimer(sessionIdHex: string): void {
    if (this.#sessionIdleTimeoutMs === undefined) return;
    this.#startSessionIdleTimer(sessionIdHex);
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
  /** FED-OPTIONB-SETUP-001: consortium directory pubkeys (any-directory). Falls back to [directoryPubkey]. */
  directoryPubkeys?: Uint8Array[];
  /**
   * DOD-SEAL-BROKER-1: directory pubkey (hex) -> libp2p multiaddr for the directories in this
   * consortium. Lets the relay call back to the directory that BROKERED a session instead of one
   * pinned in configuration with no relationship to the conversation.
   *
   * Public data supplied by the environment, the same pattern as `directoryPubkeys` — the relay
   * still holds no consortium state internally and stays a standalone artifact.
   *
   * Deliberately NOT read from the client-presented assignment: a client could then name any address
   * it liked. The relay learns WHICH directory brokered a session from the assignment SIGNATURE,
   * which it already verifies against the pubkey set, and resolves the address itself.
   */
  directoryEndpointsByPubkey?: Record<string, string>;
  directory?: DirectoryAdapter;
  keyProvider?: KeyProvider;
  store?: RelayStore;
  /** Persisted transport key for stable Peer ID (32-byte Ed25519 seed) */
  transportPrivateKey?: Uint8Array;
  /** PERSIST-014: WAL for serving gap-fill leaves. Required for reconciliation support. */
  sessionWal?: SessionWal;
  /** M7-MSG-001: durable store-and-forward content store (enables the content-park protocol). */
  contentStore?: ContentStore;
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
  /**
   * M7-SESSION-001 AC-002: Configurable idle timeout in milliseconds.
   * When a session has no activity for this duration, the relay emits
   * session_interrupted with reason 'timeout'. Default: no timeout (undefined).
   */
  sessionIdleTimeoutMs?: number;
}

/**
 * DOD-RELAY-KEEPALIVE-1 (review F1) — REFUSE TO RUN ON A TRANSPORT THAT IGNORES THE KEEPALIVE POLICY.
 *
 * `createRelayNode` passes `connectionMonitor: { abortConnectionOnPingFailure: false }`, and
 * @cello-protocol/transport before 0.0.44 does not READ that option — it builds the libp2p
 * connectionMonitor config from `keepAliveIntervalMs` alone. Passing it there is discarded in
 * silence: the relay comes up looking healthy and keeps severing client links on one slow ping,
 * which is the entire defect this unit exists to remove.
 *
 * This file already documents the same failure class 1,800 lines down, about a factory that copies
 * options field by field: "a new option that is not listed here is dropped in silence… That cost a
 * full deploy-and-test cycle." A source-text test cannot catch it — the source is correct, the
 * dependency is old — so the check has to run where the truth is, at module load.
 *
 * `WAN_PING_TIMEOUT_FLOOR_MS` is the marker: it ships in the same transport change as the option.
 */
if (typeof transport.WAN_PING_TIMEOUT_FLOOR_MS !== "number") {
  throw new Error(
    "@cello-protocol/transport is too old for this relay: it does not support the connectionMonitor " +
      "policy (WAN_PING_TIMEOUT_FLOOR_MS is absent, so createNode ignores " +
      "connectionMonitor.abortConnectionOnPingFailure). The relay would run libp2p's default and " +
      "abort a healthy client link on one slow ping — the DOD-RELAY-KEEPALIVE-1 defect. " +
      "Upgrade @cello-protocol/transport to >=0.0.44.",
  );
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
    // DOD-NAT-REACHABILITY-1 — THE ROOT CAUSE of "agents cannot get a reservation".
    //
    // The relay was running libp2p's DEFAULTS, which are sized for a public DHT where
    // relaying is a courtesy, not the product:
    //   * maxReservations: 15 — and a reservation is held for its FULL TTL even after
    //     the client disconnects. Every CELLO agent needs one, and every daemon restart
    //     mints a fresh peer id (new transport key) that consumes a NEW slot rather than
    //     reusing the old one. Fifteen slots are gone almost immediately in real use —
    //     after which the relay completes the handshake and silently grants NOTHING, so
    //     agents come up looking healthy and reachable by nobody.
    //   * applyDefaultLimit: true — relayed connections are capped at 2 minutes and
    //     128 KiB. That is fatal for the case that matters most: where the hole punch
    //     FAILS (symmetric NAT, strict corporate firewall) the relayed connection is not
    //     a fallback, it IS the session, and it must last as long as the conversation.
    //
    // For a relay whose entire job is carrying CELLO sessions, both defaults are wrong.
    relayServer: {
      enabled: true,
      reservations: {
        maxReservations: 4096,
        applyDefaultLimit: false,
      },
    },
    // DOD-RELAY-KEEPALIVE-1 — THE RELAY MUST NEVER SEVER A CLIENT LINK ON ONE SLOW PING.
    //
    // libp2p's ConnectionMonitor runs on every node by default: it pings each connection every
    // 10s under an adaptive timeout floored at 5s, and `abortConnectionOnPingFailure` defaults to
    // TRUE — so one ping that misses that deadline aborts the whole connection. On 2026-08-04
    // every client↔relay link died every 60-90 seconds (`reservation.lost`,
    // `relay_connection_gone`) with "The operation was aborted due to timeout", the same string
    // behind 2,061 untraced relay reader errors.
    //
    // A relay owes its clients no liveness verdict — that is the reservation TTL's job — so it
    // gives up the authority to abort. The pings KEEP FLOWING: on an otherwise idle relay link
    // they are the only traffic there is, and that traffic is what stops network-level reapers
    // (NAT conntrack, enterprise firewalls) from collecting the connection.
    connectionMonitor: {
      abortConnectionOnPingFailure: false,
    },
  });
  await node.start();

  const relay = new CelloRelayNode({
    node,
    directoryPubkey: opts.directoryPubkey,
    directoryPubkeys: opts.directoryPubkeys,
    // This factory copies options FIELD BY FIELD, so a new option that is not listed here is
    // dropped in silence — the env parses, the resolver runs, and the value is simply never there.
    // That cost a full deploy-and-test cycle: the relay logged `broker.address_unknown` for a
    // pubkey whose address was correctly present in its own environment.
    directoryEndpointsByPubkey: opts.directoryEndpointsByPubkey,
    directory: opts.directory,
    store: opts.store,
    sessionWal: opts.sessionWal,
    contentStore: opts.contentStore,
    logger: opts.logger,
    ackSigningKeyProvider: opts.ackSigningKeyProvider,
    relayId: opts.relayId,
    sessionIdleTimeoutMs: opts.sessionIdleTimeoutMs,
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
      relay.stopContentSweep();
      await node.stop();
    },
  };
}
