/**
 * CELLO Client — client.ts (MSG-002, SESSION-002)
 *
 * CelloClientImpl: peer registry, send path, inbound stream handler,
 * and receive queue for the M0 one-shot message exchange protocol.
 * SESSION-002 additions: receiveSessionAssignment, listSessions.
 *
 * PSEUDOCODE (Phase P):
 *
 * send(peerPubkeyHex, content):
 *   1. Look up peerPubkeyHex → peer_not_connected if absent
 *   2. buildEnvelope(content, keyProvider, Date.now()) → content_too_large if rejected
 *   3. serializeEnvelope → bytes
 *   4. node.newStream(peerId, CELLO_PROTOCOL_ID):
 *      - structured error → peer_unreachable or connection_lost
 *   5. stream.send(lp.encode.single(bytes))
 *   6. stream.close() — half-close write side
 *   7. Drain read side (for await lp.decode(stream)):
 *      - clean EOF → delivered:true
 *      - stream.status === 'reset' → remote_rejected
 *      - transport error → connection_lost
 *
 * inbound handler (stream):
 *   1. AbortController with 5s timeout
 *   2. Read one LP frame via lp.decode(stream) — abort if timeout fires
 *   3. deserializeEnvelope(payload) → malformed_envelope + stream.abort on error
 *   4. validateEnvelope(envelope) → stream.abort on error
 *   5. enqueue to receiveQueue keyed by sender_pubkey hex
 *   6. stream.close() — clean close signals delivered:true to sender
 *
 * sendRaw(peerPubkeyHex, bytes) [internal, exposed for tests]:
 *   Open stream, write raw bytes as single LP frame, await close type.
 *   Used by tests to inject tampered envelopes.
 *
 * receiveSessionAssignment(assignment, myPubkey):
 *   SESSION-002 AC-002, AC-003, AC-004, AC-005, SI-003
 *   SESSION-004 changes: replace M1 Ed25519 verify with FROST verify path.
 *
 *   SESSION-004 pseudocode (Phase P rev2):
 *   RFC 9591 (FROST), RFC 8032 (Ed25519), FIPS 180-4 (SHA-256)
 *
 *   1. Check signature_type (SESSION-004 SI-003, AC-003):
 *      if assignment.signature_type === 'single':
 *        return { ok:false, reason:"unsupported_signature_type" }
 *        // Hard cut — even if the single-key sig itself verifies (SI-003 is absolute)
 *        // No session record is created (SI-003). No I/O is attempted.
 *
 *   2. Determine role and verification key (SESSION-004 AC-007):
 *      isInitiator = (Buffer.from(myPubkey).equals(Buffer.from(pubA)))
 *      if isInitiator:
 *        // CRITICAL-1 FIX: initiator MUST have a thresholdSigner injected.
 *        // There is NO fallback to assignment.signer_pubkey — that is frame-provided
 *        // and attacker-controlled. Absence of a signer is a hard error.
 *        if this.#thresholdSigner is null:
 *          return { ok:false, reason:"frost_signer_not_configured" }
 *        verifyKey = this.#thresholdSigner.getPrimaryPubkey()  // HIGH-4: on IThresholdSigner
 *      else:
 *        // Counterparty: use signer_pubkey embedded in the frame (A's primary_pubkey)
 *        // TypeScript discriminated union guarantees signer_pubkey is present for 'frost' frames
 *        verifyKey = assignment.signer_pubkey  // guaranteed non-undefined by type system
 *
 *   3. Compute genesis_prev_root (same as M1):
 *      genesis_prev_root = computeGenesisPrevRoot(pubA, pubB, session_id, session_timestamp)
 *
 *   4. Build session establishment TBS (HIGH-5: uses buildSessionEstablishmentTbs from protocol-types):
 *      tbs = buildSessionEstablishmentTbs(session_id, pubA, pubB, genesis_prev_root, session_timestamp)
 *
 *   5. Verify FROST signature (SESSION-004 AC-002, SI-001):
 *      //  Use FrostThresholdSigner.verifySignature() which handles framing internally:
 *      //    framedMsg = <context>\0<tbs>  (domain separation per CONTEXT.md)
 *      //  OR use ed25519_FROST.verify(sig, frameMessage(context, tbs), verifyKey) directly
 *      //  The client imports ed25519_FROST from @noble/curves/ed25519 (not from @cello/crypto)
 *      //  to keep the verify path independent from any signer state.
 *      framedMsg = frameMessage(CONTEXT_SESSION_ESTABLISHMENT, tbs)  // context\0tbs
 *      isValid = ed25519_FROST.verify(assignment.directory_signature, framedMsg, verifyKey)
 *      if !isValid:
 *        return { ok:false, reason:"frost_signature_invalid" }
 *        // Never accept a tampered signature (SI-001 absolute)
 *
 *   6-9. (same as M1: content handler, relay auth, counterparty dial, store session)
 *
 * IMPORTANT NOTE on CelloClientImpl constructor and createClient factory changes:
 *   - Add optional #thresholdSigner: IThresholdSigner | null field
 *   - createClient accepts optional thresholdSigner in opts
 *   - No @cello/directory import — IThresholdSigner comes from @cello/crypto
 *
 * IMPORTANT NOTE on ReceiveAssignmentResult (IMPORTANT-9):
 *   Add 'frost_signature_invalid' | 'unsupported_signature_type' | 'frost_signer_not_configured'
 *   to the reason union in types.ts
 *
 *   1. Build TBS = CBOR([session_id, participant_a.pubkey, participant_b.pubkey, session_timestamp])
 *   2. Verify Ed25519(TBS, assignment.directory_pubkey, assignment.directory_signature) [M1, REMOVED in M2]
 *      → { ok:false, reason:"directory_signature_invalid" } if fails
 *   3. Determine counterparty: if myPubkey == participant_a.pubkey then counterparty = B, else A
 *   4. Compute genesis_prev_root = computeGenesisPrevRoot(pubA, pubB, session_id, session_timestamp)
 *      per FIPS 180-4 / SESSION-002
 *   5. Register /cello/content/1.0.0 handler on node (if not yet registered)
 *   6. Dial relay on /cello/relay/1.0.0, complete challenge-response auth:
 *      a. Read relay_auth_challenge frame
 *      b. Compute authMsg = SHA-256("CELLO-RELAY-AUTH-v1" || nonce || myPubkey)  [RFC 8032, FIPS 180-4]
 *      c. Sign authMsg with keyProvider → signature
 *      d. Send relay_auth_response{pubkey, signature}
 *      → { ok:false, reason:"relay_auth_failed" } or "relay_auth_error" on failure
 *   7. Dial counterparty on /cello/content/1.0.0
 *      → { ok:false, reason:"dial_counterparty_failed" } if unreachable
 *   8. Store SessionRecord with status:"active", last_seen_seq:0
 *   9. Return { ok:true, sessionId }
 */

import { createHash } from "node:crypto";
import { Encoder, decode } from "cbor-x";
import * as lp from "it-length-prefixed";
import {
  buildEnvelope, serializeEnvelope, deserializeEnvelope, validateEnvelope,
  computeGenesisPrevRoot, encodeSealPayload, buildSessionEstablishmentTbs, buildSealTbs,
  decodeConnectionPackage, validateConnectionPackage,
} from "@cello/protocol-types";
import type { Structure2 } from "@cello/protocol-types";
import { verify, buildMerkleTree, merkleRoot, verifyFrostSignature, CONTEXT_SESSION_ESTABLISHMENT, mlDsaKeygen, mlDsaVerify, FileMlDsaKeyProvider } from "@cello/crypto";
import type { LeafInput, IThresholdSigner } from "@cello/crypto";
import { CELLO_PROTOCOL_ID, CELLO_CONTENT_PROTOCOL_ID } from "@cello/transport";
import { NetworkDirectoryNode, runNetworkDkg } from "./network-directory-node.js";
import type { KeyProvider } from "@cello/crypto";
import type { CelloNode } from "@cello/transport";
import type { Stream } from "@libp2p/interface";
import type { SessionAssignment, RegistrationState } from "@cello/protocol-types";
import type {
  CelloClient, PeerEntry, ReceivedEnvelope, SendResult, SessionRecord,
  ReceiveAssignmentResult, ReceivedMessage, SendMessageResult, SessionAssignmentEvent,
  InitiateSessionResult,
} from "./types.js";
import type { Logger } from "@cello/interfaces";

const RELAY_PROTOCOL_ID = "/cello/relay/1.0.0";
const AUTH_DOMAIN = "CELLO-RELAY-AUTH-v1";
const SIGNALING_PROTOCOL_ID = "/cello/signaling/1.0.0";
const AUTH_DOMAIN_DIR = "CELLO-DIR-AUTH-v1";
const DEFAULT_INITIATE_TIMEOUT_MS = 30_000;
const CBOR_ENC = new Encoder({ tagUint8Array: false });

function toU8(v: unknown): Uint8Array {
  if (v instanceof Uint8Array) return v;
  if (Buffer.isBuffer(v)) return new Uint8Array(v as Buffer);
  // Uint8ArrayList (it-length-prefixed v10) has a .slice() method
  if (typeof (v as { slice?: unknown }).slice === "function") {
    return (v as { slice(): Uint8Array }).slice();
  }
  throw new Error(`expected bytes, got ${typeof v}`);
}

function toU8Safe(v: unknown): Uint8Array | null {
  if (v instanceof Uint8Array) return v;
  if (Buffer.isBuffer(v)) return new Uint8Array(v as Buffer);
  return null;
}

// ─── MSG-004 pending cross-check state ───────────────────────────────────────

interface Structure1Fields {
  last_seen_seq: number;
  timestamp: number | bigint;
}

interface PendingS2Entry {
  s2: Structure2;
  s2_cbor: Uint8Array;
  s1_fields: Structure1Fields;
  leaf_kind: number;
  sequence_number: number;
  content_hash: Uint8Array;
  is_own_send: boolean;
  arrived_at: number;
  timer_handle: ReturnType<typeof setTimeout>;
  echo_resolve?: () => void;
}

interface PendingContentEntry {
  content_bytes: Uint8Array;
  arrived_at: number;
}

interface ReadyEntry {
  s2: Structure2;
  s2_cbor: Uint8Array;
  s1_fields: Structure1Fields;
  leaf_kind: number;
  content_bytes: Uint8Array;
  is_own_send: boolean;
  echo_resolve?: () => void;
}

const PENDING_CONTENT_BOUND = 256;

// ─── SESSION-006 reconnect constants ─────────────────────────────────────────

/** Default reconnect timeout: 60 seconds per SESSION-006 AC-003. */
const DEFAULT_RECONNECT_TIMEOUT_MS = 60_000;

/** Initial backoff interval in ms (exponential: 200, 400, 800, …). */
const RECONNECT_INITIAL_BACKOFF_MS = 200;

/** Maximum backoff cap to avoid excessively long waits. */
const RECONNECT_MAX_BACKOFF_MS = 5_000;

/** Timeout for each individual relay auth read (challenge or ack). */
const RELAY_AUTH_TIMEOUT_MS = 5_000;

/**
 * SESSION-005: default timeout waiting for directory seal_verified + client FROST ceremony + session_sealed.
 * After bilateral SEAL exchange, if no session_sealed arrives within this window,
 * cello_close_session returns seal_type: 'bilateral'.
 */
const DEFAULT_SEAL_FROST_TIMEOUT_MS = 15_000;

/** Race an async iterator's next() call against a timeout. */
async function nextWithTimeout<T>(
  iter: AsyncIterator<T>,
  timeoutMs: number,
): Promise<IteratorResult<T>> {
  return Promise.race([
    iter.next(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("auth_timeout")), timeoutMs),
    ),
  ]);
}

// ─── CelloClientImpl ─────────────────────────────────────────────────────────

class CelloClientImpl implements CelloClient {
  readonly #node: CelloNode;
  readonly #keyProvider: KeyProvider;
  readonly #contentGraceMs: number;
  /** SESSION-006: max ms to attempt relay reconnect before giving up. */
  readonly #reconnectTimeoutMs: number;
  /** SESSION-005: optional FROST threshold signer for seal ceremony coordination. */
  #thresholdSigner: IThresholdSigner | undefined;
  /** SESSION-005: seal-frost-timeout in ms (default 15s). */
  readonly #sealFrostTimeoutMs: number;
  #myPubkeyHex: string | null = null;

  // peer_pubkey_hex → PeerEntry
  readonly #peers = new Map<string, PeerEntry>();

  // sender_pubkey_hex → FIFO queue of received envelopes
  readonly #receiveQueues = new Map<string, ReceivedEnvelope[]>();

  // ordered arrival list for peekAll()
  readonly #arrivalLog: Array<{ senderPubkeyHex: string; envelope: ReceivedEnvelope }> = [];

  // Optional callback invoked after each successful inbound enqueue
  readonly #onMessageQueued: ((senderPubkeyHex: string) => void) | undefined;

  // Callback for inbound session assignments (participant B role). MCP-002.
  #onSessionAssignmentHandler: ((event: SessionAssignmentEvent) => void) | undefined;

  // session_id_hex → SessionRecord (SESSION-002)
  readonly #sessions = new Map<string, SessionRecord>();

  // track whether content handler has been registered on this node
  #contentHandlerRegistered = false;

  // ─── MSG-004 per-session state ──────────────────────────────────────────────

  // session_id_hex → persistent relay stream
  readonly #relayStreams = new Map<string, Stream>();

  // session_id_hex → Promise<void> chain for outbound serialization
  readonly #outboundQueues = new Map<string, Promise<void>>();

  // session_id_hex → pending ack resolver (sequence_number → ack data)
  readonly #pendingAckResolvers = new Map<string, (ack: { ok: true; sequence_number: number } | { ok: false; reason: string }) => void>();

  // session_id_hex → highest seq# received from relay (tracks relay delivery order independently
  // of cross-check completion; used for sequence gap/replay detection)
  readonly #relayRecvSeq = new Map<string, number>();

  // session_id_hex → fully-ready cross-checks keyed by seqNum, awaiting in-order processing
  readonly #readyQueue = new Map<string, Map<number, ReadyEntry>>();

  // session_id_hex → pending S2 entries keyed by content_hash_hex
  readonly #pendingS2 = new Map<string, Map<string, PendingS2Entry>>();

  // session_id_hex → pending content entries keyed by content_hash_hex (counterparty-sent content)
  readonly #pendingContent = new Map<string, Map<string, PendingContentEntry>>();

  // session_id_hex → own-send pre-buffered content keyed by content_hash_hex
  // Kept separate from #pendingContent to avoid collision when both sides send identical bytes.
  readonly #ownPendingContent = new Map<string, Map<string, PendingContentEntry>>();

  // session_id_hex → set of content_hash_hex values from tampered frames (declared hash ≠ computed)
  // If a subsequent S2 arrives claiming the same hash, it immediately desync's (content_hash_mismatch).
  readonly #tamperedContentClaims = new Map<string, Set<string>>();

  // session_id_hex → own_echo_resolvers (sequence_number → resolve fn)
  readonly #ownEchoResolvers = new Map<string, Map<number, () => void>>();

  // session_id_hex → FIFO queue of ReceivedMessage (for receiveMessage)
  readonly #sessionMessageQueues = new Map<string, ReceivedMessage[]>();

  // FIFO arrival order across all sessions: { sessionIdHex, message }
  readonly #anyMessageQueue: Array<{ sessionIdHex: string; message: ReceivedMessage }> = [];

  // SESSION-007: wake resolvers for receiveMessageAsync (per-session) and receiveAnyMessageAsync
  readonly #receiveWaiters = new Map<string, Set<() => void>>();
  readonly #receiveAnyWaiters = new Set<() => void>();

  // session_id_hex → directory signaling stream (SESSION-003)
  readonly #directoryStreams = new Map<string, Stream>();

  // SESSION-006: track whether a reconnect loop is already running per session
  readonly #reconnectInProgress = new Set<string>();

  // ─── ADAPTER-003: persistent directory signaling stream ────────────────────

  /** Configured directory endpoint (required for initiateSession). ADAPTER-003. */
  readonly #directoryEndpoint: { peer_id: string; multiaddrs: string[] } | null;

  /** Single persistent signaling stream shared across all session_request outbound calls
   * and inbound session_assignment / session_sealed events. ADAPTER-003. */
  #persistentSignalingStream: Stream | null = null;
  #persistentSignalingIter: AsyncIterator<Uint8Array> | null = null;

  /** Pending resolver for the in-flight session_request → session_assignment/error.
   * At most one session_request is in-flight at a time per signaling stream.
   * Receives the raw decoded CBOR frame (session_assignment or session_request_error). */
  #pendingSessionRequestResolve: ((frame: Record<string, unknown>) => void) | null = null;

  /** In-flight promise for #openPersistentSignalingStream — prevents concurrent open attempts. */
  #openingSignalingStream: Promise<boolean> | null = null;

  // session_id_hex → Promise: set when the initiator SEAL echo is expected (SESSION-003)
  // Allows non-initiator auto-response to know when its own SEAL echo confirms the seal
  readonly #sealInitiatedSessions = new Set<string>();

  // session_id_hex: set when THIS client received seal_verified and ran the FROST ceremony.
  // Guards #handleFrostSealed to use #myPrimaryPubkey for verification (anti-substitution).
  // Distinct from #sealInitiatedSessions: a concurrent-close counterparty can call
  // initiateSessionSeal but is NOT the FROST ceremony participant.
  readonly #frostCeremonyParticipant = new Set<string>();

  // SESSION-005: session_id_hex → resolve fn for seal-frost-timeout Promise
  // The Promise resolves when session_sealed arrives; if it times out first, seal_type = 'bilateral'.
  readonly #sealFrostResolvers = new Map<string, () => void>();

  // PERSIST-014: session_id_hex → resolve callback for pending gap-fill requests
  readonly #pendingGapFillResolvers = new Map<string, (result: { ok: true; leaves: unknown[] } | { ok: false; reason: string }) => void>();

  // SESSION-005: session_id_hex → { leafCount, timestamp } from seal_verified frame.
  // Stored so #handleFrostSealed can use the authoritative values even if local_tree_leaves
  // is incomplete due to a sequence_causal_inconsistency desync race.
  readonly #sealVerifiedData = new Map<string, { leafCount: number; timestamp: number }>();

  // SESSION-005: track the primary_pubkey for this client (set after bootstrapKeyShares)
  #myPrimaryPubkey: Uint8Array | null = null;

  // ─── REG-001: Registration state ────────────────────────────────────────────

  /** Cached registration state — set after a successful register() call. */
  #registrationState: RegistrationState | null = null;

  /** Pending resolver for register_success / register_error from directory. */
  #pendingRegisterResolve: ((frame: Record<string, unknown>) => void) | null = null;
  /** Pending resolver for dkg_ready from directory (part of register flow). */
  #pendingDkgReadyResolve: ((frame: Record<string, unknown>) => void) | null = null;
  /** Pending resolver for seal_unilateral_confirmed / seal_unilateral_too_early (PERSIST-015). */
  #pendingUnilateralSealResolve: ((frame: Record<string, unknown>) => void) | null = null;

  /** Optional path for persisting the ML-DSA keypair (FileMlDsaKeyProvider). REG-001 AC-010. */
  readonly #mlDsaKeyFile: string | undefined;

  /** ML-DSA key provider stored after successful register() call. Used to sign ConnectionPackages. CELLO-MCP-003. */
  #mlDsaProvider: import("@cello/crypto").MlDsaKeyProvider | null = null;

  // ─── CONNREQ-002: Connection state ────────────────────────────────────────────

  /** connection_id → ClientConnectionRecord */
  readonly #connections = new Map<string, import("@cello/protocol-types").ClientConnectionRecord>();
  /** counterparty_pubkey_hex → connection_id (for fast lookup by peer) */
  readonly #connectionsByPeer = new Map<string, string>();

  /** Connection policy for evaluating inbound connection_request_inbound frames. Mutable via setPolicy(). */
  #connectionPolicy: import("./connection-policy.js").SignalRequirementPolicy | undefined;
  /** Overall connection timeout in ms (default 300s). Injected for tests. */
  readonly #connectionTimeoutMs: number;
  /** Round 2 silence timeout in ms (default 120s). Injected for tests. */
  readonly #round2TimeoutMs: number;
  /** If true, expose _evaluateCallCount on the instance for test assertions. */
  readonly #trackEvaluateCount: boolean;
  /** Whitelist: sender pubkeys that bypass evaluateConnectionPackage. */
  readonly #whitelist: string[];
  /** Callback fired when an inbound connection_request_inbound is queued for agent review. */
  readonly #onConnectionPendingReview: ((event: import("@cello/protocol-types").ConnectionRequestInbound) => void) | undefined;
  /** DB-003: if true, attempt cross-check of sender's ml_dsa_pubkey on inbound requests. */
  readonly #crossCheckDirectoryOnInbound: boolean;
  /** DB-003: peers whose connection was accepted without successful cross-check. */
  readonly #profileUncheckedPeers = new Set<string>();

  /** Counter incremented each time evaluateConnectionPackage is called (trackEvaluateCount=true). */
  _evaluateCallCount = 0;

  /** Callback fired when a connection_established event arrives. */
  #onConnectionEstablishedHandler: ((event: import("@cello/protocol-types").ConnectionEstablished) => void) | undefined;
  /** Callback fired when a disclosure_request_inbound arrives. */
  #onDisclosureRequestedHandler: ((event: import("@cello/protocol-types").DisclosureRequestInbound) => void) | undefined;

  /**
   * CONNREQ-003: Multi-slot resolver map for concurrent outbound connection requests.
   * Keyed by target pubkey hex — one slot per unique target.
   * Replaces the former single-slot #pendingConnectionRequestResolve field.
   * Resolves when connection_established, connection_rejected, connection_insufficient,
   * connection_request_error, or disclosure_request_inbound arrives for that target.
   *
   * Pseudocode (Phase P):
   *   requestConnection(target):
   *     if map.has(target) → log warn "connection.request.duplicate" → return error immediately
   *     mint correlationId ; log info "connection.request.sent"
   *     map.set(target, resolve)
   *     await outcome / timeout
   *     map.delete(target)
   *     on established: log info "connection.established"
   *     on error: log error "connection.request.failed"
   *
   *   signalingReader(connection_established):
   *     target = frame.counterparty_pubkey
   *     resolve = map.get(target) ; map.delete(target) ; resolve(frame)
   *     (if no resolver: B's side — fires #onConnectionEstablishedHandler)
   */
  readonly #pendingConnectionRequestResolvers = new Map<string, (frame: Record<string, unknown>) => void>();

  /**
   * CONNREQ-003: TEST-ONLY escape hatch exposing resolver map size for memory-leak assertions.
   * Read by connreq-003 tests via (client as any)._pendingConnectionRequestResolverCount.
   */
  get _pendingConnectionRequestResolverCount(): number {
    return this.#pendingConnectionRequestResolvers.size;
  }

  /**
   * CONNREQ-003: Promise queue for concurrent awaitConnectionRequest() callers.
   * Each entry is the resolve fn from one awaitConnectionRequest() call.
   * When an inbound request arrives, the first queued resolver is called (FIFO).
   * Replaces the polling-based single-caller pattern for the inbound side.
   *
   * Pseudocode (Phase P):
   *   awaitConnectionRequest(timeoutMs):
   *     if queue not empty: shift → return immediately with pending_review item
   *     create Promise, push resolve fn to #pendingAwaitConnectionRequestResolvers
   *     race against timeout
   *     on item arrival: first resolver in queue receives the item (FIFO)
   *
   *   #handleInboundConnectionRequest (after queuing to #pendingReviewQueue):
   *     if #pendingAwaitConnectionRequestResolvers.length > 0:
   *       resolver = shift ; resolver(item) ; return (don't add to #pendingReviewQueue)
   *     else: add to #pendingReviewQueue as before
   */
  readonly #pendingAwaitConnectionRequestResolvers: Array<(item: {
    connection_request_id: string;
    from_pubkey: string;
    report: Extract<import("./connection-policy.js").ConnectionReport, { verdict: "pending_agent_review" }>;
  }) => void> = [];

  /** Pending disclosure_response → resolver (connection_request_id → resolve for cello_respond_to_disclosure_request) */
  readonly #pendingDisclosureResolvers = new Map<string, (result: Record<string, unknown>) => void>();

  /**
   * In-process pending connection requests (for B's side).
   * connection_request_id → state tracking for responding/requesting disclosure.
   */
  readonly #pendingInboundRequests = new Map<string, {
    connection_request_id: string;
    from_pubkey: string;
    package_cbor: Uint8Array;
    round: number; // 1 = Round 1; 2 = Round 2 in-flight
  }>();

  /**
   * FIFO queue of inbound connection requests that need agent review.
   * Populated by #handleInboundConnectionRequest when verdict is pending_agent_review.
   * Drained by awaitConnectionRequest(). CELLO-MCP-003.
   */
  readonly #pendingReviewQueue: Array<{
    connection_request_id: string;
    from_pubkey: string;
    report: Extract<import("./connection-policy.js").ConnectionReport, { verdict: "pending_agent_review" }>;
    package_cbor: Uint8Array;
    sender_registered_at: number;
    sender_is_provisional: boolean;
  }> = [];

  /**
   * Tracks which connection_request_ids have been decided (accepted, rejected, or requested disclosure).
   * Used to prevent double-decisions. CELLO-MCP-003.
   */
  readonly #decidedRequests = new Set<string>();

  // ─── PERSIST-014: Logger (injected, defaults to no-op) ───────────────────────
  readonly #logger: Logger;

  constructor(
    node: CelloNode,
    keyProvider: KeyProvider,
    onMessageQueued?: (senderPubkeyHex: string) => void,
    contentGraceMs = 30_000,
    reconnectTimeoutMs = DEFAULT_RECONNECT_TIMEOUT_MS,
    thresholdSigner?: IThresholdSigner,
    sealFrostTimeoutMs = DEFAULT_SEAL_FROST_TIMEOUT_MS,
    directoryEndpoint: { peer_id: string; multiaddrs: string[] } | null = null,
    mlDsaKeyFile?: string,
    connectionPolicy?: import("./connection-policy.js").SignalRequirementPolicy,
    connectionTimeoutMs = 300_000,
    round2TimeoutMs = 120_000,
    trackEvaluateCount = false,
    whitelist: string[] = [],
    onConnectionPendingReview?: (event: import("@cello/protocol-types").ConnectionRequestInbound) => void,
    crossCheckDirectoryOnInbound = false,
    logger?: Logger,
  ) {
    this.#node = node;
    this.#keyProvider = keyProvider;
    this.#onMessageQueued = onMessageQueued;
    this.#contentGraceMs = contentGraceMs;
    this.#reconnectTimeoutMs = reconnectTimeoutMs;
    this.#thresholdSigner = thresholdSigner;
    this.#sealFrostTimeoutMs = sealFrostTimeoutMs;
    this.#directoryEndpoint = directoryEndpoint;
    this.#mlDsaKeyFile = mlDsaKeyFile;
    this.#connectionPolicy = connectionPolicy;
    this.#connectionTimeoutMs = connectionTimeoutMs;
    this.#round2TimeoutMs = round2TimeoutMs;
    this.#trackEvaluateCount = trackEvaluateCount;
    this.#whitelist = whitelist;
    this.#onConnectionPendingReview = onConnectionPendingReview;
    this.#crossCheckDirectoryOnInbound = crossCheckDirectoryOnInbound;
    this.#logger = logger ?? { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
  }

  /**
   * SESSION-005: Set the FROST primary_pubkey for this client.
   * Call after bootstrapKeyShares to register the group public key.
   * Used for verifying incoming session_sealed FROST signatures when this client
   * is the seal initiator.
   */
  setPrimaryPubkey(primaryPubkey: Uint8Array): void {
    this.#myPrimaryPubkey = new Uint8Array(primaryPubkey);
  }

  addPeer(peerPubkeyHex: string, peerId: string, multiaddrs: string[]): void {
    this.#peers.set(peerPubkeyHex, { peerId, multiaddrs, connected: true });
  }

  async send(peerPubkeyHex: string, content: Uint8Array): Promise<SendResult> {
    // Step 1: registry lookup
    const entry = this.#peers.get(peerPubkeyHex);
    if (!entry) {
      return { delivered: false, reason: "peer_not_connected" };
    }

    // Step 2: build envelope — catches content_too_large before any I/O
    const buildResult = await buildEnvelope(content, this.#keyProvider, Date.now());
    if (!buildResult.ok) {
      if (buildResult.error.reason === "content_too_large") {
        return { delivered: false, reason: "content_too_large" };
      }
      return { delivered: false, reason: "connection_lost" };
    }

    // Step 3: serialize
    const bytes = serializeEnvelope(buildResult.envelope);

    return this.#sendBytes(entry.peerId, bytes, buildResult.envelope.content_hash);
  }

  // Internal test escape: open a raw stream directly to peer without building an envelope.
  // Used by AC-012 to write truncated/malformed bytes.
  async openRawStream(peerPubkeyHex: string): Promise<Stream> {
    const entry = this.#peers.get(peerPubkeyHex);
    if (!entry) throw new Error(`peer_not_connected: ${peerPubkeyHex}`);
    return this.#node.newStream(entry.peerId, CELLO_PROTOCOL_ID);
  }

  // Internal test escape: open a raw content protocol stream to peer by peerId string.
  // Used by AC-003 to inject tampered content frames directly.
  async openContentStreamByPeerId(peerId: string): Promise<Stream> {
    return this.#node.newStream(peerId, CELLO_CONTENT_PROTOCOL_ID);
  }

  // Internal test escape: directly feed a leaf_deliver frame into the relay stream handler.
  // Used by AC-004 through AC-008 to inject adversarial frames without a compromised relay.
  injectLeafDeliver(sessionIdHex: string, frame: Record<string, unknown>): void {
    const myPubkeyHex = this.#myPubkeyHex;
    if (!myPubkeyHex) throw new Error("injectLeafDeliver: client not yet authenticated (no session registered)");
    this.#handleInboundLeafDeliver(sessionIdHex, frame, myPubkeyHex);
  }

  // Internal test escape: inject a minimal session record directly into #sessions.
  // Bypasses receiveSessionAssignment (which requires a real relay) for unit tests
  // that need to test session_sealed, FROST verification, etc. without a relay.
  // TEST-ONLY: only intended for use in unit tests; not exposed in the CelloClient type.
  injectTestSession(
    sessionIdHex: string,
    sessionId: Uint8Array,
    myPubkeyHex: string,
    directoryPubkey: Uint8Array,
    status: SessionRecord["status"] = "active",
    opts?: { isInitiator?: boolean },
  ): void {
    const genesis_prev_root = new Uint8Array(32);
    const counterpartyPubkey = new Uint8Array(32);
    const record: SessionRecord = {
      session_id: sessionId,
      counterparty_pubkey: counterpartyPubkey,
      counterparty_peer_id: "",
      counterparty_multiaddrs: [],
      relay_endpoint: { peer_id: "", multiaddrs: [] },
      directory_endpoint: { peer_id: "", multiaddrs: [] },
      directory_pubkey: directoryPubkey,
      genesis_prev_root,
      last_seen_seq: 0,
      last_sent_seq: 0,
      status,
      local_tree_leaves: [],
      next_expected_seq: 1,
      desynchronized: false,
    };
    this.#sessions.set(sessionIdHex, record);
    if (!this.#myPubkeyHex) {
      this.#myPubkeyHex = myPubkeyHex;
    }
    // M-001: mark as seal-initiated and FROST ceremony participant so #handleFrostSealed
    // uses own primary_pubkey for verification.
    if (opts?.isInitiator) {
      this.#sealInitiatedSessions.add(sessionIdHex);
      this.#frostCeremonyParticipant.add(sessionIdHex);
    }
  }

  // Internal test escape: directly feed a session_sealed, session_seal_rejected,
  // seal_verified, or session_frost_sealed frame into the directory stream handler —
  // bypasses the real directory signaling stream so tests can inject adversarial frames.
  injectDirectoryFrame(sessionIdHex: string, frame: Record<string, unknown>): void {
    const session = this.#sessions.get(sessionIdHex);
    if (!session) throw new Error(`injectDirectoryFrame: session not found: ${sessionIdHex}`);
    if (frame["type"] === "session_sealed") {
      this.#handleDirectorySessionSealed(sessionIdHex, frame, session.directory_pubkey);
    } else if (frame["type"] === "session_seal_rejected") {
      this.#handleDirectorySessionSealRejected(sessionIdHex, frame);
    } else if (frame["type"] === "seal_rejected_tree_mismatch") {
      this.#handleSealRejectedTreeMismatch(sessionIdHex, frame);
    } else if (frame["type"] === "seal_unilateral_confirmed") {
      this.#handleSealUnilateralConfirmed(sessionIdHex, frame);
    } else if (frame["type"] === "seal_unilateral_notification") {
      this.#handleSealUnilateralNotification(sessionIdHex, frame);
    } else if (frame["type"] === "seal_verified") {
      void this.#handleSealVerified(sessionIdHex, frame);
    } else if (frame["type"] === "session_frost_sealed") {
      this.#handleSessionFrostSealed(sessionIdHex, frame);
    }
  }

  // Internal: open stream, write LP-framed bytes, await close type.
  // Exposed as sendRaw for test injection of tampered envelopes.
  async sendRaw(peerPubkeyHex: string, bytes: Uint8Array): Promise<SendResult> {
    const entry = this.#peers.get(peerPubkeyHex);
    if (!entry) {
      return { delivered: false, reason: "peer_not_connected" };
    }
    return this.#sendBytes(entry.peerId, bytes, undefined);
  }

  async #sendBytes(
    peerId: string,
    bytes: Uint8Array,
    contentHash: Uint8Array | undefined
  ): Promise<SendResult> {
    // Step 4: open stream
    let stream: Stream;
    try {
      stream = await this.#node.newStream(peerId, CELLO_PROTOCOL_ID);
    } catch (err) {
      // node_stopped → transport issue; connection_lost from newStream means no prior
      // connection to this peer (= unreachable); protocol error also = unreachable
      const reason = isStructuredError(err, "node_stopped") ? "transport_not_started"
        : "peer_unreachable";
      return { delivered: false, reason };
    }

    try {
      // Step 5: write LP-framed bytes
      stream.send(lp.encode.single(bytes));

      // Step 6: half-close write side
      await stream.close();

      // Step 7: drain read side — the close type tells us the outcome
      try {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _ of lp.decode(stream)) {
          // Receiver never sends data — drain any unexpected bytes and discard
        }
      } catch {
        // Read side error — check stream status to classify
      }

      if (stream.status === "reset" || stream.status === "aborted") {
        return { delivered: false, reason: "remote_rejected" };
      }

      const hashHex = contentHash
        ? Buffer.from(contentHash).toString("hex")
        : "";
      return { delivered: true, contentHash: hashHex };
    } catch (err) {
      return { delivered: false, reason: mapSendError(err) };
    }
  }

  // ─── SESSION-002 ─────────────────────────────────────────────────────────────

  /**
   * Process a SessionAssignment pushed by the directory.
   * SESSION-002 AC-002, AC-003, AC-004, AC-005, SI-003.
   *
   * Crypto refs:
   *   Ed25519 verification: RFC 8032
   *   SHA-256: FIPS 180-4
   */
  async receiveSessionAssignment(
    assignment: SessionAssignment,
    myPubkey: Uint8Array,
  ): Promise<ReceiveAssignmentResult> {
    const { session_id, session_timestamp } = assignment;
    const pubA = assignment.participant_a.pubkey;
    const pubB = assignment.participant_b.pubkey;

    // SESSION-004 Step 1: Check signature_type (SI-003, AC-003)
    // M1 'single' frames are hard-refused in M2 — even if the single-key sig verifies.
    if (assignment.signature_type === "single") {
      return { ok: false, reason: "unsupported_signature_type" };
    }

    // SESSION-004 Step 2: Determine role and verification key (AC-007)
    const myPubkeyHex = Buffer.from(myPubkey).toString("hex");
    const pubAHex = Buffer.from(pubA).toString("hex");
    const isInitiator = myPubkeyHex === pubAHex;

    let verifyKey: Uint8Array;
    if (isInitiator) {
      // CRITICAL-1: initiator MUST have a thresholdSigner injected.
      // Falling back to assignment.signer_pubkey (frame-provided) would be attacker-controlled.
      if (!this.#thresholdSigner) {
        return { ok: false, reason: "frost_signer_not_configured" };
      }
      verifyKey = this.#thresholdSigner.getPrimaryPubkey();
    } else {
      // Counterparty (B): use signer_pubkey from the frame (A's primary_pubkey).
      // TypeScript discriminated union guarantees signer_pubkey is present for 'frost' frames.
      verifyKey = assignment.signer_pubkey;
    }

    // SESSION-004 Step 3: Build TBS and verify FROST signature (AC-002, SI-001)
    // TBS = canonical CBOR([session_id, pubA, pubB, genesis_prev_root, session_timestamp])
    // buildSessionEstablishmentTbs imported from protocol-types (HIGH-5: single source of truth)
    const genesis_prev_root_for_tbs = computeGenesisPrevRoot(pubA, pubB, session_id, session_timestamp);
    const tbs = buildSessionEstablishmentTbs(session_id, pubA, pubB, genesis_prev_root_for_tbs, session_timestamp);

    // Verify FROST signature with domain separation (context\0tbs framing)
    if (!verifyFrostSignature(assignment.directory_signature, tbs, CONTEXT_SESSION_ESTABLISHMENT, verifyKey)) {
      return { ok: false, reason: "frost_signature_invalid" };
    }

    // Step 4: Determine counterparty
    const counterparty = isInitiator ? assignment.participant_b : assignment.participant_a;

    // genesis_prev_root was already computed above for TBS — reuse it
    const genesis_prev_root = genesis_prev_root_for_tbs;

    // Step 4: Register content protocol handler on this node (if not already registered).
    // Set the flag before awaiting handle() to prevent concurrent calls from both registering.
    if (!this.#contentHandlerRegistered) {
      this.#contentHandlerRegistered = true;
      try {
        await this.#node.handle(CELLO_CONTENT_PROTOCOL_ID, (stream) => {
          void this.#handleContentStream(stream);
        });
      } catch {
        // Already registered by a concurrent call — safe to ignore.
      }
    }

    // Step 5: Dial relay on /cello/relay/1.0.0 and complete challenge-response auth (AC-003)
    const relayPeerId = assignment.relay_endpoint.peer_id;
    const relayMultiaddr = assignment.relay_endpoint.multiaddrs[0];

    if (relayMultiaddr) {
      try {
        await this.#node.dial(relayMultiaddr);
      } catch {
        // Connection may already exist — proceed
      }
    }

    let relayStream: Stream;
    try {
      relayStream = await this.#node.newStream(relayPeerId, RELAY_PROTOCOL_ID);
    } catch {
      return { ok: false, reason: "relay_auth_error" };
    }

    // Auth challenge-response
    // Read relay_auth_challenge, respond with relay_auth_response
    // Signature: Ed25519(SHA-256("CELLO-RELAY-AUTH-v1" || nonce || myPubkey), keyProvider) per RFC 8032, FIPS 180-4
    let relayIter: AsyncIterator<Uint8Array>;
    try {
      const authResult = await this.#performRelayAuth(relayStream, myPubkey);
      if (!authResult.ok) {
        return { ok: false, reason: authResult.reason };
      }
      relayIter = authResult.iter;
    } catch {
      return { ok: false, reason: "relay_auth_error" };
    }

    // Step 6: Dial counterparty on /cello/content/1.0.0 (AC-004)
    // Best-effort: counterparty may not yet be listening. Session is stored as active
    // regardless — the content stream will be re-established on first message.
    try {
      const counterpartyMultiaddr = counterparty.multiaddrs[0];
      if (counterpartyMultiaddr) {
        try {
          await this.#node.dial(counterpartyMultiaddr);
        } catch {
          // Already connected or not yet reachable — proceed
        }
      }
      const contentStream = await this.#node.newStream(counterparty.peer_id, CELLO_CONTENT_PROTOCOL_ID);
      // Close gracefully — content stream will be re-established per message in M1
      contentStream.close().catch(() => {});
    } catch {
      // Counterparty not yet listening — store session as active anyway.
      // Content connection will be established when first message is sent.
    }

    // Step 7: Store session record (AC-004)
    const sessionIdHex = Buffer.from(session_id).toString("hex");
    const record: SessionRecord = {
      session_id,
      counterparty_pubkey: counterparty.pubkey,
      counterparty_peer_id: counterparty.peer_id,
      counterparty_multiaddrs: counterparty.multiaddrs,
      relay_endpoint: {
        peer_id: assignment.relay_endpoint.peer_id,
        multiaddrs: assignment.relay_endpoint.multiaddrs,
      },
      directory_endpoint: {
        peer_id: assignment.directory_endpoint.peer_id,
        multiaddrs: assignment.directory_endpoint.multiaddrs,
      },
      directory_pubkey: assignment.directory_pubkey,
      genesis_prev_root,
      last_seen_seq: 0,
      last_sent_seq: 0,
      status: "active",
      local_tree_leaves: [],
      next_expected_seq: 1,
      desynchronized: false,
    };
    this.#sessions.set(sessionIdHex, record);

    // Store the relay stream and start the persistent reader loop (MSG-004)
    this.#relayStreams.set(sessionIdHex, relayStream);
    this.#relayRecvSeq.set(sessionIdHex, 0);
    this.#readyQueue.set(sessionIdHex, new Map());
    this.#pendingS2.set(sessionIdHex, new Map());
    this.#pendingContent.set(sessionIdHex, new Map());
    this.#ownPendingContent.set(sessionIdHex, new Map());
    this.#tamperedContentClaims.set(sessionIdHex, new Set());
    this.#ownEchoResolvers.set(sessionIdHex, new Map());
    this.#sessionMessageQueues.set(sessionIdHex, []);

    // Cache myPubkeyHex for the stream reader (same key across all sessions on this client)
    if (!this.#myPubkeyHex) this.#myPubkeyHex = myPubkeyHex;

    void this.#runRelayStreamReader(sessionIdHex, relayStream, myPubkeyHex, relayIter);

    // Fire inbound session handler if this client is participant B (session was initiated
    // by a remote peer). MCP-002: cello_await_session uses this to populate its queue.
    // myPubkeyHex !== pubAHex means we are B (the non-initiator).
    if (myPubkeyHex !== pubAHex && this.#onSessionAssignmentHandler) {
      this.#onSessionAssignmentHandler({
        sessionIdHex: sessionIdHex,
        counterpartyPubkeyHex: Buffer.from(counterparty.pubkey).toString("hex"),
        genesisPrevRootHex: Buffer.from(genesis_prev_root).toString("hex"),
      });
    }

    // ADAPTER-003: if the persistent signaling stream is already open (e.g. opened by
    // initiateSession), it handles session_sealed/seal_rejected events for all sessions.
    // Only open a per-session stream when the persistent stream is not available.
    if (!this.#persistentSignalingStream) {
      void this.#connectDirectorySignalingStream(sessionIdHex, assignment, myPubkey);
    }

    return { ok: true, sessionId: session_id };
  }

  listSessions(): SessionRecord[] {
    return Array.from(this.#sessions.values());
  }

  // ─── MSG-004 implementation ──────────────────────────────────────────────────

  async sendMessage(sessionIdHex: string, content: Uint8Array): Promise<SendMessageResult> {
    // Per-session outbound serialization queue: next send not started until echo received
    const prev = this.#outboundQueues.get(sessionIdHex) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((r) => { release = r; });
    this.#outboundQueues.set(sessionIdHex, prev.then(() => next));
    await prev;
    try {
      return await this.#sendMessageLocked(sessionIdHex, content);
    } finally {
      release();
    }
  }

  async #sendMessageLocked(sessionIdHex: string, content: Uint8Array): Promise<SendMessageResult> {
    const session = this.#sessions.get(sessionIdHex);
    if (!session) return { ok: false, reason: "session_not_found" };
    if (session.desynchronized) return { ok: false, reason: "session_desynchronized" };
    if (session.status === "sealing" || session.status === "sealed" || session.status === "seal_deferred") return { ok: false, reason: "session_sealed" };
    // SESSION-006 AC-001/AC-003: transport_lost means relay stream is gone or being reconnected
    if (session.status === "transport_lost") return { ok: false, reason: "transport_unavailable" };

    const relayStream = this.#relayStreams.get(sessionIdHex);
    if (!relayStream || relayStream.status !== "open") {
      return { ok: false, reason: "transport_unavailable" };
    }

    // content_hash = SHA-256(0x00 || content) per MERKLE-001
    const contentHash = new Uint8Array(
      createHash("sha256").update(new Uint8Array([0x00])).update(content).digest()
    );

    // Build Structure 1 TBS: [1, content_hash, myPubkey, session_id, last_seen_seq, timestamp]
    const myPubkeyHex = this.#myPubkeyHex!;
    const myPubkeyBytes = Buffer.from(myPubkeyHex, "hex");
    const tbs = CBOR_ENC.encode([
      1,
      contentHash,
      myPubkeyBytes,
      session.session_id,
      session.last_seen_seq,
      Date.now(),
    ]) as Uint8Array;
    const signature = await this.#keyProvider.sign(tbs);

    // Submit hash_submit to relay on the persistent relay stream
    const hashSubmitFrame = CBOR_ENC.encode({
      type: "hash_submit",
      session_id: session.session_id,
      leaf_kind: 0x00,
      structure1_cbor: tbs,
      sender_signature: signature,
    }) as Uint8Array;

    // Pre-buffer own content in a separate map so the echo cross-check finds it immediately.
    // The sender won't receive a content_frame for its own messages (it sent to counterparty,
    // not to itself). Using a separate map from #pendingContent avoids collision when both
    // participants send identical byte payloads in the same session.
    const contentHashHex = Buffer.from(contentHash).toString("hex");
    this.#ownPendingContent.get(sessionIdHex)?.set(contentHashHex, {
      content_bytes: content,
      arrived_at: Date.now(),
    });

    // Set up ack resolver before sending to avoid race with fast relay.
    // The outbound queue guarantees at most one in-flight send per session.
    // Guard here so a queue bug causes an immediate throw rather than a silent orphan.
    if (this.#pendingAckResolvers.has(sessionIdHex)) {
      throw new Error(`[cello-client] ack resolver already set for session ${sessionIdHex}; outbound queue invariant violated`);
    }
    let ackResolve!: (v: { ok: true; sequence_number: number } | { ok: false; reason: string }) => void;
    const ackPromise = new Promise<{ ok: true; sequence_number: number } | { ok: false; reason: string }>(
      (r) => { ackResolve = r; }
    );
    this.#pendingAckResolvers.set(sessionIdHex, ackResolve);

    try {
      relayStream.send(lp.encode.single(hashSubmitFrame));
    } catch {
      this.#pendingAckResolvers.delete(sessionIdHex);
      this.#ownPendingContent.get(sessionIdHex)?.delete(contentHashHex);
      return { ok: false, reason: "transport_unavailable" };
    }

    const ack = await ackPromise;
    if (!ack.ok) {
      return { ok: false, reason: "relay_rejected" };
    }
    const mySeq = ack.sequence_number;

    // Send content to counterparty on /cello/content/1.0.0
    // Best-effort: if content path fails, the receiver's 30s grace timer will desync
    const sess2 = this.#sessions.get(sessionIdHex);
    if (sess2 && !sess2.desynchronized) {
      void this.#sendContentFrame(sess2, content, contentHash);
    }

    // Wait for our own echoed leaf_deliver (unblocks when crossCheckDelivery fires echo_resolve)
    await this.#waitForOwnEcho(sessionIdHex, mySeq);

    // Re-check desync: desync() fires the resolver to unblock, but send must still fail
    const sess3 = this.#sessions.get(sessionIdHex);
    if (!sess3 || sess3.desynchronized) return { ok: false, reason: "session_desynchronized" };

    return { ok: true };
  }

  async #sendContentFrame(session: SessionRecord, content: Uint8Array, contentHash: Uint8Array): Promise<void> {
    const counterpartyPeerId = session.counterparty_peer_id;
    try {
      // Dial counterparty if not connected
      const multiaddr = session.counterparty_multiaddrs[0];
      if (multiaddr) {
        try { await this.#node.dial(multiaddr); } catch { /* already connected */ }
      }
      const contentStream = await this.#node.newStream(counterpartyPeerId, CELLO_CONTENT_PROTOCOL_ID);
      const frame = CBOR_ENC.encode({
        type: "content_frame",
        session_id: session.session_id,
        content_hash: contentHash,
        content_bytes: content,
      }) as Uint8Array;
      contentStream.send(lp.encode.single(frame));
      await contentStream.close();
    } catch {
      // Content path failure is silent; 30s grace timer fires if receiver doesn't get content
    }
  }

  async #waitForOwnEcho(sessionIdHex: string, seqNum: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const resolvers = this.#ownEchoResolvers.get(sessionIdHex);
      if (resolvers) {
        resolvers.set(seqNum, resolve);
      } else {
        resolve(); // session was closed
      }
    });
  }

  receiveMessage(sessionIdHex: string): ReceivedMessage | null {
    const queue = this.#sessionMessageQueues.get(sessionIdHex);
    if (!queue || queue.length === 0) return null;
    return queue.shift()!;
  }

  receiveAnyMessage(): { sessionIdHex: string; message: ReceivedMessage } | null {
    return this.#anyMessageQueue.shift() ?? null;
  }

  // ─── SESSION-007: async blocking receive ─────────────────────────────────────
  //
  // Pseudocode for receiveMessageAsync(sessionIdHex, timeoutMs):
  //   1. Check #sessionMessageQueues[sessionIdHex] — if non-empty, dequeue and return immediately.
  //   2. Register a wake resolver in #receiveWaiters[sessionIdHex].
  //   3. Race: wait for wakeUp() signal vs. setTimeout(timeoutMs).
  //   4. On wake: dequeue from #sessionMessageQueues. If empty (spurious wake), repeat from step 2.
  //   5. On timeout: clean up resolver, return null.
  //   6. On return: compute otherSessionsPending, log session.receive.pending_hint if non-empty.
  //
  // Pseudocode for receiveAnyMessageAsync(timeoutMs):
  //   1. Check #anyMessageQueue — if non-empty, dequeue and return immediately.
  //   2. Register a wake resolver in #receiveAnyWaiters.
  //   3. Race: wait for wakeUp() signal vs. setTimeout(timeoutMs).
  //   4. On wake: dequeue from #anyMessageQueue. Also dequeue from per-session queue.
  //   5. On timeout: return { type: 'timeout' }.
  //
  // Pseudocode for #wakeReceiveWaiters(sessionIdHex):
  //   1. Fire all resolvers in #receiveWaiters[sessionIdHex].
  //   2. Fire all resolvers in #receiveAnyWaiters.
  //   (Resolvers clear themselves on fire to avoid double-wake.)
  //
  // Pseudocode for #computeOtherSessionsPending(excludeSessionIdHex):
  //   1. For each entry in #sessionMessageQueues, skip excluded session.
  //   2. Collect sessionIdHex values where queue.length > 0.
  //   3. Return collected array.
  //
  // Pseudocode for #enqueueSessionSealedEvent(sessionIdHex, sealedRoot, closeTimestamp):
  //   1. Log session.sealed.received with {sessionId, sealedRoot (hex), closeTimestamp, checkpointStatus, correlationId}.
  //   2. Build lifecycle event: { type: "session_sealed", sessionIdHex, sealedRoot, closeTimestamp, checkpointStatus: "pending" }.
  //   3. Enqueue to #sessionMessageQueues[sessionIdHex] (create queue if missing).
  //   4. Enqueue to #anyMessageQueue.
  //   5. Call #wakeReceiveWaiters(sessionIdHex).

  #computeOtherSessionsPending(excludeSessionIdHex: string): string[] {
    const pending: string[] = [];
    for (const [sid, queue] of this.#sessionMessageQueues.entries()) {
      if (sid !== excludeSessionIdHex && queue.length > 0) {
        pending.push(sid);
      }
    }
    return pending;
  }

  #wakeReceiveWaiters(sessionIdHex: string): void {
    // Wake per-session waiters
    const sessionWaiters = this.#receiveWaiters.get(sessionIdHex);
    if (sessionWaiters) {
      for (const resolve of sessionWaiters) resolve();
      sessionWaiters.clear();
    }
    // Wake any-session waiters
    for (const resolve of this.#receiveAnyWaiters) resolve();
    this.#receiveAnyWaiters.clear();
  }

  async receiveMessageAsync(sessionIdHex: string, timeoutMs: number): Promise<ReceivedMessage | null> {
    const deadline = Date.now() + timeoutMs;

    while (true) {
      // Check queue first (fast path: already has messages)
      const queue = this.#sessionMessageQueues.get(sessionIdHex);
      if (queue && queue.length > 0) {
        const item = queue.shift()!;
        // Remove from #anyMessageQueue as well to keep in sync
        const idx = this.#anyMessageQueue.findIndex(
          (e) => e.sessionIdHex === sessionIdHex && e.message === item
        );
        if (idx !== -1) this.#anyMessageQueue.splice(idx, 1);
        // Attach otherSessionsPending
        const pending = this.#computeOtherSessionsPending(sessionIdHex);
        const result = pending.length > 0 ? { ...item, otherSessionsPending: pending } : item;
        if (pending.length > 0) {
          this.#logger.info("session.receive.pending_hint", {
            currentSessionId: sessionIdHex,
            pendingSessionCount: pending.length,
            correlationId: sessionIdHex,
          });
        }
        return result;
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) return null;

      // Register wake resolver and race against timeout
      await new Promise<void>((resolve) => {
        let set = this.#receiveWaiters.get(sessionIdHex);
        if (!set) {
          set = new Set();
          this.#receiveWaiters.set(sessionIdHex, set);
        }
        set.add(resolve);
        setTimeout(() => {
          // Remove resolver if timeout fires before wake
          this.#receiveWaiters.get(sessionIdHex)?.delete(resolve);
          resolve();
        }, remaining);
      });
    }
  }

  async receiveAnyMessageAsync(timeoutMs: number): Promise<
    | (ReceivedMessage & { sessionIdHex: string })
    | { type: "timeout" }
  > {
    const deadline = Date.now() + timeoutMs;

    while (true) {
      // Check any-session queue first (fast path)
      if (this.#anyMessageQueue.length > 0) {
        const entry = this.#anyMessageQueue.shift()!;
        // Remove from per-session queue as well
        const perSession = this.#sessionMessageQueues.get(entry.sessionIdHex);
        if (perSession) {
          const idx = perSession.indexOf(entry.message);
          if (idx !== -1) perSession.splice(idx, 1);
        }
        // Attach otherSessionsPending
        const pending = this.#computeOtherSessionsPending(entry.sessionIdHex);
        const result = pending.length > 0
          ? { ...entry.message, sessionIdHex: entry.sessionIdHex, otherSessionsPending: pending }
          : { ...entry.message, sessionIdHex: entry.sessionIdHex };
        if (pending.length > 0) {
          this.#logger.info("session.receive.pending_hint", {
            currentSessionId: entry.sessionIdHex,
            pendingSessionCount: pending.length,
            correlationId: entry.sessionIdHex,
          });
        }
        return result;
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) return { type: "timeout" };

      // Register wake resolver and race against timeout
      await new Promise<void>((resolve) => {
        this.#receiveAnyWaiters.add(resolve);
        setTimeout(() => {
          this.#receiveAnyWaiters.delete(resolve);
          resolve();
        }, remaining);
      });
    }
  }

  #enqueueSessionSealedEvent(
    sessionIdHex: string,
    sealedRoot: Uint8Array,
    closeTimestamp: number,
  ): void {
    // Use sessionIdHex as correlationId — minted at session initiation, unique per session flow.
    const correlationId = sessionIdHex;
    this.#logger.info("session.sealed.received", {
      sessionId: sessionIdHex,
      sealedRoot: Buffer.from(sealedRoot).toString("hex"),
      closeTimestamp,
      checkpointStatus: "pending",
      correlationId,
    });
    const lifecycleEvent: ReceivedMessage = {
      type: "session_sealed",
      sessionIdHex,
      sealedRoot: new Uint8Array(sealedRoot),
      closeTimestamp,
      checkpointStatus: "pending",
    };
    let queue = this.#sessionMessageQueues.get(sessionIdHex);
    if (!queue) {
      queue = [];
      this.#sessionMessageQueues.set(sessionIdHex, queue);
    }
    queue.push(lifecycleEvent);
    this.#anyMessageQueue.push({ sessionIdHex, message: lifecycleEvent });
    this.#wakeReceiveWaiters(sessionIdHex);
  }

  // ─── SESSION-003: seal ceremony ──────────────────────────────────────────────

  async initiateSessionSeal(sessionIdHex: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    const session = this.#sessions.get(sessionIdHex);
    if (!session) return { ok: false, reason: "session_not_found" };
    if (session.status !== "active") return { ok: false, reason: "session_not_active" };

    session.status = "sealing";
    this.#sealInitiatedSessions.add(sessionIdHex);

    const result = await this.#submitSealLeaf(sessionIdHex, session, "initiator");
    if (!result.ok) return result;

    // SESSION-005: if a threshold signer is configured, wait for the FROST seal ceremony.
    // The directory runs verification and FROST ceremony; if it doesn't reply within
    // sealFrostTimeoutMs, this is a bilateral seal (directory unreachable).
    // Without a threshold signer (M1 compatibility), return immediately —
    // the M1 single-key seal notification will arrive asynchronously.
    if (this.#thresholdSigner) {
      const sealReceived = new Promise<void>((resolve) => {
        this.#sealFrostResolvers.set(sessionIdHex, resolve);
      });

      const timeout = new Promise<void>((resolve) =>
        setTimeout(resolve, this.#sealFrostTimeoutMs)
      );

      await Promise.race([sealReceived, timeout]);

      // Clean up resolver
      this.#sealFrostResolvers.delete(sessionIdHex);

      // Check if session_sealed arrived (status would be 'sealed' by now)
      const sess = this.#sessions.get(sessionIdHex);
      if (sess && sess.status === "sealing") {
        // Timeout elapsed without session_sealed — bilateral fallback (DB-001)
        sess.status = "seal_deferred";
        sess.seal_type = "bilateral";
        // M-003: store the verified timestamp so #handleSessionFrostSealed can reconstruct
        // the exact TBS if the directory later completes the deferred FROST ceremony.
        const sealVerifiedEntry = this.#sealVerifiedData.get(sessionIdHex);
        if (sealVerifiedEntry) {
          sess.close_timestamp = sealVerifiedEntry.timestamp;
        }
      }
    }

    return { ok: true };
  }

  // PERSIST-015: send seal_unilateral to the directory after delivery_grace_seconds elapses.
  async initiateUnilateralSeal(
    sessionIdHex: string,
  ): Promise<
    | { ok: true; sealed_root: Uint8Array; sealed_at: number }
    | { ok: false; reason: "too_early"; remaining_seconds: number }
    | { ok: false; reason: string }
  > {
    const session = this.#sessions.get(sessionIdHex);
    if (!session) return { ok: false, reason: "session_not_found" };
    if (session.status !== "active" && session.status !== "sealing") {
      return { ok: false, reason: "session_not_active" };
    }

    if (!this.#persistentSignalingStream) {
      const opened = await this.#openPersistentSignalingStream();
      if (!opened || !this.#persistentSignalingStream) {
        return { ok: false, reason: "directory_unreachable" };
      }
    }

    const localRoot = this.#computeLocalRoot(session) ?? session.genesis_prev_root;
    const reportedSeq = session.next_expected_seq - 1;

    const frame = CBOR_ENC.encode({
      type: "seal_unilateral",
      session_id: session.session_id,
      reported_root: localRoot,
      reported_seq: reportedSeq,
    }) as Uint8Array;

    this.#persistentSignalingStream.send(lp.encode.single(frame));

    const UNILATERAL_TIMEOUT_MS = 15_000;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const responseFrame = await Promise.race<Record<string, unknown>>([
      new Promise<Record<string, unknown>>((resolve) => {
        this.#pendingUnilateralSealResolve = resolve;
      }),
      new Promise<Record<string, unknown>>((resolve) => {
        timeoutHandle = setTimeout(() => {
          this.#pendingUnilateralSealResolve = null;
          resolve({ type: "seal_unilateral_error", reason: "timeout" });
        }, UNILATERAL_TIMEOUT_MS);
      }),
    ]);
    clearTimeout(timeoutHandle);

    if (responseFrame["type"] === "seal_unilateral_confirmed") {
      const sealedRootRaw = responseFrame["sealed_root"];
      const sealedRoot = sealedRootRaw instanceof Uint8Array ? sealedRootRaw
        : Buffer.isBuffer(sealedRootRaw) ? new Uint8Array(sealedRootRaw as Buffer)
        : new Uint8Array(32);
      const sealedAt = typeof responseFrame["sealed_at"] === "number" ? responseFrame["sealed_at"] : Date.now();
      return { ok: true, sealed_root: sealedRoot, sealed_at: sealedAt };
    }

    if (responseFrame["type"] === "seal_unilateral_too_early") {
      const remainingSeconds = typeof responseFrame["remaining_seconds"] === "number"
        ? responseFrame["remaining_seconds"] : 0;
      return { ok: false, reason: "too_early", remaining_seconds: remainingSeconds };
    }

    return { ok: false, reason: (responseFrame["reason"] as string | undefined) ?? "unknown" };
  }

  async #submitSealLeaf(
    sessionIdHex: string,
    session: SessionRecord,
    _role: "initiator" | "responder",
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const relayStream = this.#relayStreams.get(sessionIdHex);
    if (!relayStream || relayStream.status !== "open") {
      return { ok: false, reason: "transport_unavailable" };
    }

    // Compute current local tree root (R_tail for initiator, root-after-initiator-SEAL for responder)
    const finalRoot = session.local_tree_leaves.length === 0
      ? session.genesis_prev_root
      : (() => {
          const inputs: LeafInput[] = session.local_tree_leaves.map(l => ({
            kind: l.kind,
            data: l.s2_cbor,
          }));
          return merkleRoot(buildMerkleTree(inputs));
        })();

    const close_timestamp = Date.now();
    const sealPayload = encodeSealPayload({
      session_id: session.session_id,
      final_root: finalRoot,
      close_timestamp,
      attestation: "PENDING",
    });

    // content_hash = SHA-256(0x02 || seal_payload) — ctrl leaf kind byte is 0x02
    const contentHash = new Uint8Array(
      createHash("sha256").update(new Uint8Array([0x02])).update(sealPayload).digest()
    );

    const myPubkeyHex = this.#myPubkeyHex!;
    const myPubkeyBytes = Buffer.from(myPubkeyHex, "hex");

    const tbs = CBOR_ENC.encode([
      1,
      contentHash,
      myPubkeyBytes,
      session.session_id,
      session.last_seen_seq,
      close_timestamp,
    ]) as Uint8Array;
    const signature = await this.#keyProvider.sign(tbs);

    const hashSubmitFrame = CBOR_ENC.encode({
      type: "hash_submit",
      session_id: session.session_id,
      leaf_kind: 0x02,
      structure1_cbor: tbs,
      sender_signature: signature,
    }) as Uint8Array;

    const contentHashHex = Buffer.from(contentHash).toString("hex");
    this.#ownPendingContent.get(sessionIdHex)?.set(contentHashHex, {
      content_bytes: sealPayload,
      arrived_at: Date.now(),
    });

    if (this.#pendingAckResolvers.has(sessionIdHex)) {
      return { ok: false, reason: "ack_resolver_conflict" };
    }
    let ackResolve!: (v: { ok: true; sequence_number: number } | { ok: false; reason: string }) => void;
    const ackPromise = new Promise<{ ok: true; sequence_number: number } | { ok: false; reason: string }>(
      (r) => { ackResolve = r; }
    );
    this.#pendingAckResolvers.set(sessionIdHex, ackResolve);

    try {
      relayStream.send(lp.encode.single(hashSubmitFrame));
    } catch {
      this.#pendingAckResolvers.delete(sessionIdHex);
      this.#ownPendingContent.get(sessionIdHex)?.delete(contentHashHex);
      return { ok: false, reason: "transport_unavailable" };
    }

    const ack = await ackPromise;
    if (!ack.ok) return { ok: false, reason: "relay_rejected" };

    const mySeq = ack.sequence_number;

    // Send SEAL payload as content_frame to counterparty so they can cross-check
    const sess2 = this.#sessions.get(sessionIdHex);
    if (sess2 && !sess2.desynchronized) {
      void this.#sendContentFrame(sess2, sealPayload, contentHash);
    }

    // Wait for own echo
    await this.#waitForOwnEcho(sessionIdHex, mySeq);

    const sess3 = this.#sessions.get(sessionIdHex);
    if (!sess3 || sess3.desynchronized) return { ok: false, reason: "session_desynchronized" };

    return { ok: true };
  }

  // ─── Directory signaling stream (SESSION-003) ────────────────────────────────

  async #connectDirectorySignalingStream(
    sessionIdHex: string,
    assignment: SessionAssignment,
    myPubkey: Uint8Array,
  ): Promise<void> {
    const dirPeerId = assignment.directory_endpoint.peer_id;
    const dirMultiaddr = assignment.directory_endpoint.multiaddrs[0];

    if (!dirPeerId) return; // no directory endpoint — skip (test env may not have one)

    try {
      if (dirMultiaddr) {
        try { await this.#node.dial(dirMultiaddr); } catch { /* already connected */ }
      }
      const SIGNALING_PROTOCOL_ID = "/cello/signaling/1.0.0";
      const AUTH_DOMAIN_DIR = "CELLO-DIR-AUTH-v1";
      let dirStream: Stream;
      try {
        dirStream = await this.#node.newStream(dirPeerId, SIGNALING_PROTOCOL_ID);
      } catch {
        return; // directory not reachable — session still active, sealed notification just won't arrive
      }

      this.#directoryStreams.set(sessionIdHex, dirStream);

      // Directory signaling auth: read challenge, sign, respond
      const iter = (lp.decode(dirStream) as AsyncIterable<unknown>)[Symbol.asyncIterator]() as AsyncIterator<Uint8Array>;
      const { value: challengeRaw, done } = await iter.next();
      if (done || challengeRaw === undefined) { dirStream.abort(new Error("dir_auth_error")); return; }

      let challengeFrame: Record<string, unknown>;
      try {
        challengeFrame = decode(toU8(challengeRaw)) as Record<string, unknown>;
      } catch { dirStream.abort(new Error("dir_auth_error")); return; }

      if (challengeFrame["type"] !== "signaling_auth_challenge") { dirStream.abort(new Error("dir_auth_error")); return; }

      const nonce = toU8(challengeFrame["nonce"]);
      const domain = Buffer.from(AUTH_DOMAIN_DIR, "utf8");
      const authMsg = new Uint8Array(Buffer.concat([domain, nonce, myPubkey]));
      const msgHash = new Uint8Array(createHash("sha256").update(authMsg).digest());
      const sig = await this.#keyProvider.sign(msgHash);

      const authResponseFrame = CBOR_ENC.encode({
        type: "signaling_auth_response",
        pubkey: myPubkey,
        signature: sig,
      }) as Uint8Array;
      dirStream.send(lp.encode.single(authResponseFrame));

      // ADAPTER-003: consume signaling_auth_ok so iter is in sync for session_sealed frames
      const { value: ackRaw2, done: ackDone2 } = await nextWithTimeout(iter, RELAY_AUTH_TIMEOUT_MS);
      if (ackDone2 || ackRaw2 === undefined) { dirStream.abort(new Error("dir_auth_error")); return; }
      let ackFrame2: Record<string, unknown>;
      try {
        ackFrame2 = decode(toU8(ackRaw2)) as Record<string, unknown>;
      } catch { dirStream.abort(new Error("dir_auth_error")); return; }
      if (ackFrame2["type"] !== "signaling_auth_ok") {
        dirStream.abort(new Error("dir_auth_error")); return;
      }

      void this.#runDirectoryStreamReader(sessionIdHex, dirStream, assignment.directory_pubkey, iter);
    } catch {
      // Directory connection failure — session still active
    }
  }

  async #runDirectoryStreamReader(
    sessionIdHex: string,
    stream: Stream,
    directoryPubkey: Uint8Array,
    iter: AsyncIterator<Uint8Array>,
  ): Promise<void> {
    try {
      while (true) {
        let result: IteratorResult<Uint8Array>;
        try {
          result = await iter.next();
        } catch { break; }
        if (result.done || result.value === undefined) break;

        let frame: Record<string, unknown>;
        try {
          frame = decode(toU8(result.value as unknown)) as Record<string, unknown>;
        } catch { continue; }

        if (frame["type"] === "session_sealed") {
          this.#handleDirectorySessionSealed(sessionIdHex, frame, directoryPubkey);
        } else if (frame["type"] === "session_seal_rejected") {
          this.#handleDirectorySessionSealRejected(sessionIdHex, frame);
        } else if (frame["type"] === "seal_rejected_tree_mismatch") {
          this.#handleSealRejectedTreeMismatch(sessionIdHex, frame);
        } else if (frame["type"] === "seal_unilateral_confirmed") {
          this.#handleSealUnilateralConfirmed(sessionIdHex, frame);
        } else if (frame["type"] === "seal_unilateral_notification") {
          this.#handleSealUnilateralNotification(sessionIdHex, frame);
        } else if (frame["type"] === "seal_verified") {
          void this.#handleSealVerified(sessionIdHex, frame);
        } else if (frame["type"] === "session_frost_sealed") {
          this.#handleSessionFrostSealed(sessionIdHex, frame);
        }
      }
    } catch { /* stream closed */ }

    if (this.#directoryStreams.get(sessionIdHex) === stream) {
      this.#directoryStreams.delete(sessionIdHex);
    }
  }

  #handleDirectorySessionSealed(
    sessionIdHex: string,
    frame: Record<string, unknown>,
    directoryPubkey: Uint8Array,
  ): void {
    const session = this.#sessions.get(sessionIdHex);
    if (!session) return;

    const signatureType = frame["signature_type"];

    // If this client has a threshold signer (M2 mode), enforce FROST-only.
    if (this.#thresholdSigner) {
      // SI-003: reject M1-era single-key seal notarizations in M2 mode
      if (signatureType === "single") {
        console.warn(`[cello-client] unsupported_signature_type: single on session ${sessionIdHex}`);
        return;
      }
      if (signatureType !== "frost") {
        // Unknown signature_type — ignore
        return;
      }
      this.#handleFrostSealed(sessionIdHex, frame, session);
    } else {
      // M1 compatibility mode: no threshold signer — verify directory_signature
      this.#handleSingleSealed(sessionIdHex, frame, directoryPubkey, session);
    }
  }

  /** No-threshold-signer path: handles both 'single' (Ed25519 dir sig) and 'frost' seal frames. */
  #handleSingleSealed(
    sessionIdHex: string,
    frame: Record<string, unknown>,
    directoryPubkey: Uint8Array,
    session: SessionRecord,
  ): void {
    const signatureType = frame["signature_type"];
    const sealedRootRaw = frame["sealed_root"];
    const sealedRoot = sealedRootRaw instanceof Uint8Array ? sealedRootRaw
      : Buffer.isBuffer(sealedRootRaw) ? new Uint8Array(sealedRootRaw as Buffer) : null;
    const ctRaw = frame["close_timestamp"];
    const closeTimestamp = typeof ctRaw === "number" ? ctRaw : typeof ctRaw === "bigint" ? Number(ctRaw) : null;
    const sidRaw = frame["session_id"];
    const sessionId = sidRaw instanceof Uint8Array ? sidRaw
      : Buffer.isBuffer(sidRaw) ? new Uint8Array(sidRaw as Buffer) : null;

    if (!sealedRoot || sealedRoot.length !== 32) return;
    if (closeTimestamp === null) return;
    if (!sessionId) return;

    if (signatureType === "frost") {
      // FROST seal received by an M1 client (no threshold signer).
      // Verify using the signer_pubkey embedded in the frame (initiator's primary_pubkey).
      const frostSigRaw = frame["frost_signature"];
      const frostSig = frostSigRaw instanceof Uint8Array ? frostSigRaw
        : Buffer.isBuffer(frostSigRaw) ? new Uint8Array(frostSigRaw as Buffer) : null;
      const signerPubkeyRaw = frame["signer_pubkey"];
      const signerPubkey = signerPubkeyRaw instanceof Uint8Array ? signerPubkeyRaw
        : Buffer.isBuffer(signerPubkeyRaw) ? new Uint8Array(signerPubkeyRaw as Buffer) : null;
      if (!frostSig || frostSig.length !== 64) return;
      if (!signerPubkey || signerPubkey.length !== 32) return;

      // Use sealVerifiedData if available (responder also gets seal_verified when M2 initiator),
      // else fall back to local_tree_leaves.length.
      const sealVerifiedEntry = this.#sealVerifiedData.get(sessionIdHex);
      const leafCount = sealVerifiedEntry?.leafCount ?? session.local_tree_leaves.length;
      const tbs = buildSealTbs(sessionId, sealedRoot, leafCount, closeTimestamp);

      if (!verifyFrostSignature(frostSig, tbs, "cello-frost-seal-v1", signerPubkey)) {
        console.warn(`[cello-client] frost_signature_invalid on session_sealed: ${sessionIdHex}`);
        return;
      }

      session.status = "sealed";
      session.sealed_root = sealedRoot;
      session.frost_signature = frostSig;
      session.signer_pubkey = signerPubkey;
      session.seal_type = "frost";
      session.close_timestamp = closeTimestamp;
      this.#sealVerifiedData.delete(sessionIdHex);
      // SESSION-007: enqueue lifecycle event for blocked cello_receive callers.
      this.#enqueueSessionSealedEvent(sessionIdHex, sealedRoot, closeTimestamp);
    } else {
      // M1 single-key: verify directory_signature against pinned directory pubkey
      const dirSigRaw = frame["directory_signature"];
      const dirSig = dirSigRaw instanceof Uint8Array ? dirSigRaw
        : Buffer.isBuffer(dirSigRaw) ? new Uint8Array(dirSigRaw as Buffer) : null;
      if (!dirSig || dirSig.length !== 64) return;

      // SI-005 (M1): verify directory signature against pinned directory pubkey
      const tbs = CBOR_ENC.encode([
        sessionId,
        sealedRoot,
        closeTimestamp > 0xffffffff ? BigInt(closeTimestamp) : closeTimestamp,
      ]) as Uint8Array;

      if (!verify(directoryPubkey, tbs, dirSig)) {
        console.warn(`[cello-client] directory_signature_invalid on session_sealed: ${sessionIdHex}`);
        return;
      }

      session.status = "sealed";
      session.sealed_root = sealedRoot;
      session.directory_signature = dirSig;
      session.close_timestamp = closeTimestamp;
      // SESSION-007: enqueue lifecycle event for blocked cello_receive callers.
      this.#enqueueSessionSealedEvent(sessionIdHex, sealedRoot, closeTimestamp);
    }

    // Resolve the seal-frost-timeout waiter
    this.#sealFrostResolvers.get(sessionIdHex)?.();
  }

  /** M2 FROST seal verification. */
  #handleFrostSealed(
    sessionIdHex: string,
    frame: Record<string, unknown>,
    session: SessionRecord,
  ): void {
    const sealedRootRaw = frame["sealed_root"];
    const sealedRoot = sealedRootRaw instanceof Uint8Array ? sealedRootRaw
      : Buffer.isBuffer(sealedRootRaw) ? new Uint8Array(sealedRootRaw as Buffer) : null;
    const frostSigRaw = frame["frost_signature"];
    const frostSig = frostSigRaw instanceof Uint8Array ? frostSigRaw
      : Buffer.isBuffer(frostSigRaw) ? new Uint8Array(frostSigRaw as Buffer) : null;
    const signerPubkeyRaw = frame["signer_pubkey"];
    const signerPubkey = signerPubkeyRaw instanceof Uint8Array ? signerPubkeyRaw
      : Buffer.isBuffer(signerPubkeyRaw) ? new Uint8Array(signerPubkeyRaw as Buffer) : null;
    const ctRaw = frame["close_timestamp"];
    const closeTimestamp = typeof ctRaw === "number" ? ctRaw : typeof ctRaw === "bigint" ? Number(ctRaw) : null;
    const sidRaw = frame["session_id"];
    const sessionId = sidRaw instanceof Uint8Array ? sidRaw
      : Buffer.isBuffer(sidRaw) ? new Uint8Array(sidRaw as Buffer) : null;
    const leafCountRaw = frame["leaf_count"];
    // Prefer stored sealVerifiedData so we use the same leafCount that was used during
    // the FROST ceremony, even if local_tree_leaves is incomplete due to a desync race.
    const sealVerifiedEntry = this.#sealVerifiedData.get(sessionIdHex);
    const leafCount = typeof leafCountRaw === "number" ? leafCountRaw
      : (sealVerifiedEntry?.leafCount ?? session.local_tree_leaves.length);
    const resolvedCloseTimestamp = closeTimestamp ?? sealVerifiedEntry?.timestamp ?? null;

    if (!sealedRoot || sealedRoot.length !== 32) return;
    if (!frostSig || frostSig.length !== 64) return;
    if (!signerPubkey || signerPubkey.length !== 32) return;
    if (resolvedCloseTimestamp === null) return;
    if (!sessionId) return;

    const tbs = buildSealTbs(sessionId, sealedRoot, leafCount, resolvedCloseTimestamp);

    // Determine verification key.
    // Use #myPrimaryPubkey only if this client ran the FROST ceremony (received seal_verified).
    // #frostCeremonyParticipant is set by #handleSealVerified before the ceremony runs —
    // a concurrent-close counterparty (in #sealInitiatedSessions but NOT #frostCeremonyParticipant)
    // must use signerPubkey from the frame (the actual initiator's key).
    const isFrostInitiator = this.#frostCeremonyParticipant.has(sessionIdHex);
    let verifyKey: Uint8Array;
    if (isFrostInitiator) {
      if (!this.#myPrimaryPubkey) {
        console.warn(`[cello-client] no primary_pubkey set on initiator for session ${sessionIdHex}`);
        return;
      }
      verifyKey = this.#myPrimaryPubkey;
    } else {
      verifyKey = signerPubkey;
    }

    // SI-001: verify FROST signature before transitioning to sealed.
    if (!this.#thresholdSigner!.verifySignature(frostSig, tbs, "cello-frost-seal-v1", verifyKey)) {
      console.warn(`[cello-client] seal_signature_invalid on session ${sessionIdHex}`);
      return;
    }

    session.status = "sealed";
    session.sealed_root = sealedRoot;
    session.frost_signature = frostSig;
    session.signer_pubkey = signerPubkey;
    session.seal_type = "frost";
    session.close_timestamp = resolvedCloseTimestamp;
    this.#sealVerifiedData.delete(sessionIdHex);
    // SESSION-007: enqueue lifecycle event for blocked cello_receive callers.
    this.#enqueueSessionSealedEvent(sessionIdHex, sealedRoot, resolvedCloseTimestamp);

    // Resolve the seal-frost-timeout waiter so initiateSessionSeal returns promptly
    this.#sealFrostResolvers.get(sessionIdHex)?.();
  }

  #handleDirectorySessionSealRejected(sessionIdHex: string, _frame: Record<string, unknown>): void {
    const session = this.#sessions.get(sessionIdHex);
    if (!session) return;
    session.status = "seal_rejected";
    // Also resolve the seal-frost-timeout waiter so initiateSessionSeal doesn't wait for the timeout
    this.#sealFrostResolvers.get(sessionIdHex)?.();
  }

  /**
   * PERSIST-014: Handle seal_rejected_tree_mismatch from the directory.
   * Determines if this client is the behind party and initiates gap-fill reconciliation.
   */
  #handleSealRejectedTreeMismatch(sessionIdHex: string, frame: Record<string, unknown>): void {
    const session = this.#sessions.get(sessionIdHex);
    if (!session) return;

    const partyASequence = typeof frame["party_a_sequence"] === "number" ? frame["party_a_sequence"] : 0;
    const partyBSequence = typeof frame["party_b_sequence"] === "number" ? frame["party_b_sequence"] : 0;

    // Determine this client's local sequence (highest seq in its Merkle tree).
    // next_expected_seq is 1-indexed: the next seq the relay will assign, so local highest = next - 1.
    const mySequence = session.next_expected_seq - 1;
    const aheadSequence = Math.max(partyASequence, partyBSequence);

    if (mySequence >= aheadSequence) {
      // We are NOT the behind party — wait for the behind party to reconcile and retry
      return;
    }

    // We are the behind party — initiate gap-fill reconciliation
    const gapSize = aheadSequence - mySequence;
    const correlationId = Buffer.from(session.session_id).toString("hex") + "-" + Date.now().toString(36);

    this.#logger.info("session.reconciliation.started", {
      sessionId: sessionIdHex,
      gapSize,
      fromSequence: mySequence,
      toSequence: aheadSequence,
      correlationId,
    });

    void this.#performGapFillReconciliation(sessionIdHex, mySequence, aheadSequence, correlationId);
  }

  /**
   * PERSIST-014: Request gap-fill leaves from the relay, verify each, advance tree, retry seal.
   */
  async #performGapFillReconciliation(
    sessionIdHex: string,
    fromSeq: number,
    toSeq: number,
    correlationId: string,
  ): Promise<void> {
    const session = this.#sessions.get(sessionIdHex);
    if (!session) return;

    const startMs = Date.now();
    const gapSize = toSeq - fromSeq;

    // Send gap_fill_request to relay
    const relayStream = this.#relayStreams.get(sessionIdHex);
    if (!relayStream || relayStream.status !== "open") {
      this.#logger.error("session.gap.fill.failed", {
        sessionId: sessionIdHex,
        reason: "relay_stream_unavailable",
        correlationId,
      });
      return;
    }

    const gapFillRequestFrame = CBOR_ENC.encode({
      type: "gap_fill_request",
      session_id: session.session_id,
      from_seq: fromSeq,
      to_seq: toSeq,
    }) as Uint8Array;

    // Register a resolver before sending so there's no race with an immediate response
    const responsePromise = new Promise<{ ok: true; leaves: unknown[] } | { ok: false; reason: string }>((resolve) => {
      this.#pendingGapFillResolvers.set(sessionIdHex, resolve);
    });

    try {
      relayStream.send(lp.encode.single(gapFillRequestFrame));
    } catch {
      this.#pendingGapFillResolvers.delete(sessionIdHex);
      this.#logger.error("session.gap.fill.failed", {
        sessionId: sessionIdHex,
        reason: "relay_send_failed",
        correlationId,
      });
      return;
    }

    // Wait for gap_fill_response or gap_fill_error from the reader loop
    const responseResult = await responsePromise;

    if (!responseResult.ok) {
      this.#logger.error("session.gap.fill.failed", {
        sessionId: sessionIdHex,
        reason: responseResult.reason,
        correlationId,
      });
      return;
    }

    // SI-002: verify each leaf's Ed25519 signature before advancing the tree
    const gapLeaves = responseResult.leaves as Array<Record<string, unknown>>;
    for (let i = 0; i < gapLeaves.length; i++) {
      const leaf = gapLeaves[i]!;
      const senderPubkey = leaf["sender_pubkey"] instanceof Uint8Array ? leaf["sender_pubkey"]
        : Buffer.isBuffer(leaf["sender_pubkey"]) ? new Uint8Array(leaf["sender_pubkey"] as Buffer) : null;
      const structure1Cbor = leaf["structure1_cbor"] instanceof Uint8Array ? leaf["structure1_cbor"]
        : Buffer.isBuffer(leaf["structure1_cbor"]) ? new Uint8Array(leaf["structure1_cbor"] as Buffer) : null;
      const senderSignature = leaf["sender_signature"] instanceof Uint8Array ? leaf["sender_signature"]
        : Buffer.isBuffer(leaf["sender_signature"]) ? new Uint8Array(leaf["sender_signature"] as Buffer) : null;

      if (!senderPubkey || !structure1Cbor || !senderSignature) {
        this.#logger.warn("session.gap.fill.leaf.invalid", {
          sessionId: sessionIdHex,
          leafIndex: i,
          reason: "missing_fields",
          correlationId,
        });
        return;
      }

      if (!verify(senderPubkey, structure1Cbor, senderSignature)) {
        this.#logger.warn("session.gap.fill.leaf.invalid", {
          sessionId: sessionIdHex,
          leafIndex: i,
          reason: "signature_invalid",
          correlationId,
        });
        return;
      }
    }

    // Advance next_expected_seq to reflect newly received leaves
    const latestSeq = gapLeaves.reduce((max, l) => {
      const seq = typeof l["sequence_number"] === "number" ? l["sequence_number"] : max;
      return Math.max(max, seq);
    }, session.next_expected_seq - 1);
    session.next_expected_seq = latestSeq + 1;

    this.#logger.info("session.reconciliation.completed", {
      sessionId: sessionIdHex,
      gapSize,
      durationMs: Date.now() - startMs,
      correlationId,
    });

    // Retry the seal attempt with the now-advanced tree
    // Re-send a seal_attempt frame with the updated local sequence so the directory
    // can re-compare roots. The directory will ack if both parties now agree.
    const localRoot = this.#computeLocalRoot(session);
    const dirStream = this.#directoryStreams.get(sessionIdHex);
    if (localRoot && dirStream && dirStream.status === "open") {
      const sealAttemptFrame = CBOR_ENC.encode({
        type: "seal_attempt",
        session_id: session.session_id,
        reported_root: localRoot,
        reported_seq: session.next_expected_seq - 1,
      }) as Uint8Array;
      try {
        dirStream.send(lp.encode.single(sealAttemptFrame));
      } catch {
        this.#logger.error("session.gap.fill.failed", {
          sessionId: sessionIdHex,
          reason: "seal_retry_send_failed",
          correlationId,
        });
      }
    }
  }

  /**
   * PERSIST-014: Handle gap_fill_response from the relay.
   * Resolves the pending reconciliation promise with the received leaves.
   */
  #handleGapFillResponse(sessionIdHex: string, frame: Record<string, unknown>): void {
    const resolver = this.#pendingGapFillResolvers.get(sessionIdHex);
    if (!resolver) return;
    this.#pendingGapFillResolvers.delete(sessionIdHex);

    const leavesRaw = Array.isArray(frame["leaves"]) ? frame["leaves"] as unknown[] : [];
    resolver({ ok: true, leaves: leavesRaw });
  }

  /**
   * PERSIST-015: Handle seal_unilateral_confirmed from the directory.
   * The submitting party receives this when the unilateral seal succeeds.
   */
  #handleSealUnilateralConfirmed(sessionIdHex: string, frame: Record<string, unknown>): void {
    const session = this.#sessions.get(sessionIdHex);
    if (!session) return;

    const sealedRootRaw = frame["sealed_root"];
    const sealedRoot = sealedRootRaw instanceof Uint8Array ? sealedRootRaw
      : Buffer.isBuffer(sealedRootRaw) ? new Uint8Array(sealedRootRaw as Buffer) : null;

    session.status = "sealed";
    if (sealedRoot) session.sealed_root = sealedRoot;
    session.seal_type = "unilateral";
    session.close_timestamp = typeof frame["sealed_at"] === "number" ? frame["sealed_at"] : Date.now();

    const correlationId = Buffer.from(session.session_id).toString("hex");
    this.#logger.info("session.sealed", {
      sessionId: sessionIdHex,
      sealType: "UNILATERAL",
      rootHash: sealedRoot ? Buffer.from(sealedRoot).toString("hex") : "unknown",
      correlationId,
    });

    // SESSION-007: enqueue lifecycle event for blocked cello_receive callers.
    if (sealedRoot) {
      this.#enqueueSessionSealedEvent(sessionIdHex, sealedRoot, session.close_timestamp ?? Date.now());
    }

    // Resolve the FROST ceremony waiter only if a bilateral seal was in-flight for this session.
    // The unilateral and FROST paths are mutually exclusive once the session seals — resolving an
    // absent FROST waiter is harmless (map miss returns undefined), but resolving a present one
    // spuriously would confuse the bilateral seal flow. Guard on whether the session was actually
    // in sealing state via the FROST path before the unilateral confirmation arrived.
    if (this.#sealInitiatedSessions.has(sessionIdHex)) {
      this.#sealFrostResolvers.get(sessionIdHex)?.();
    }
  }

  /**
   * PERSIST-015: Handle seal_unilateral_notification from the directory.
   * The absent party receives this on reconnect — verifies sealed root against local state.
   */
  #handleSealUnilateralNotification(sessionIdHex: string, frame: Record<string, unknown>): void {
    let session = this.#sessions.get(sessionIdHex);
    if (!session) {
      // Absent party reconnecting after session was sealed without them — create a minimal
      // sealed session record so the notification is observable via listSessions().
      const sessionIdRaw = frame["session_id"];
      const sessionId = sessionIdRaw instanceof Uint8Array ? sessionIdRaw
        : Buffer.isBuffer(sessionIdRaw) ? new Uint8Array(sessionIdRaw as Buffer)
        : Buffer.from(sessionIdHex, "hex");
      // Build the stub as sealed from the start — no transient "active" state visible to readers.
      // Fields like counterparty_pubkey and directory_pubkey are zeroed because the absent party
      // does not have session state; #computeLocalRoot handles the empty-leaves case explicitly.
      const stub: SessionRecord = {
        session_id: sessionId,
        counterparty_pubkey: new Uint8Array(32),
        counterparty_peer_id: "",
        counterparty_multiaddrs: [],
        relay_endpoint: { peer_id: "", multiaddrs: [] },
        directory_endpoint: { peer_id: "", multiaddrs: [] },
        directory_pubkey: new Uint8Array(32),
        genesis_prev_root: new Uint8Array(32),
        last_seen_seq: 0,
        last_sent_seq: 0,
        status: "sealed",
        seal_type: "unilateral",
        local_tree_leaves: [],
        next_expected_seq: 1,
        desynchronized: false,
      };
      this.#sessions.set(sessionIdHex, stub);
      session = stub;
    }

    const sealedRootRaw = frame["sealed_root"];
    const sealedRoot = sealedRootRaw instanceof Uint8Array ? sealedRootRaw
      : Buffer.isBuffer(sealedRootRaw) ? new Uint8Array(sealedRootRaw as Buffer) : null;

    session.status = "sealed";
    if (sealedRoot) session.sealed_root = sealedRoot;
    session.seal_type = "unilateral";
    session.close_timestamp = typeof frame["sealed_at"] === "number" ? frame["sealed_at"] : Date.now();

    // SESSION-007: enqueue lifecycle event for blocked cello_receive callers.
    if (sealedRoot) {
      this.#enqueueSessionSealedEvent(sessionIdHex, sealedRoot, session.close_timestamp);
    }

    // AC-004: Verify sealed root against local Merkle state
    const localRoot = this.#computeLocalRoot(session);

    if (localRoot == null) {
      // Cannot verify — no local leaves received yet; log distinctly rather than as mismatch
      this.#logger.info("session.unilateral.no.local.state", {
        sessionId: sessionIdHex,
        correlationId: sessionIdHex,
      });
      return;
    }

    const match = sealedRoot != null && Buffer.from(localRoot).equals(Buffer.from(sealedRoot));

    if (match) {
      this.#logger.info("session.unilateral.verified", {
        sessionId: sessionIdHex,
        match: true,
        correlationId: sessionIdHex,
      });
    } else {
      this.#logger.warn("session.unilateral.mismatch", {
        sessionId: sessionIdHex,
        localRoot: Buffer.from(localRoot).toString("hex"),
        sealedRoot: sealedRoot ? Buffer.from(sealedRoot).toString("hex") : "null",
        correlationId: sessionIdHex,
      });
    }
  }

  /**
   * PERSIST-015: Compute the local Merkle root from the session's accepted leaves.
   */
  #computeLocalRoot(session: SessionRecord): Uint8Array | null {
    if (!session.local_tree_leaves || session.local_tree_leaves.length === 0) return null;
    const leafInputs: LeafInput[] = session.local_tree_leaves.map((l) => ({
      kind: l.kind,
      data: l.s2_cbor,
    }));
    const tree = buildMerkleTree(leafInputs);
    return merkleRoot(tree);
  }

  /**
   * SESSION-005: Handle seal_verified event from the directory.
   * The directory has verified the Merkle tree; the initiator must now coordinate
   * the FROST ceremony and return the combined signature.
   */
  async #handleSealVerified(sessionIdHex: string, frame: Record<string, unknown>): Promise<void> {
    const session = this.#sessions.get(sessionIdHex);
    if (!session) return;
    if (!this.#thresholdSigner) return; // no FROST signer — bilateral only

    const sealedRootRaw = frame["sealed_root"];
    const sealedRoot = sealedRootRaw instanceof Uint8Array ? sealedRootRaw
      : Buffer.isBuffer(sealedRootRaw) ? new Uint8Array(sealedRootRaw as Buffer) : null;
    const sidRaw = frame["session_id"];
    const sessionId = sidRaw instanceof Uint8Array ? sidRaw
      : Buffer.isBuffer(sidRaw) ? new Uint8Array(sidRaw as Buffer) : null;
    const leafCountRaw = frame["leaf_count"];
    const leafCount = typeof leafCountRaw === "number" ? leafCountRaw : null;
    const tsRaw = frame["timestamp"];
    const timestamp = typeof tsRaw === "number" ? tsRaw : typeof tsRaw === "bigint" ? Number(tsRaw) : null;

    if (!sealedRoot || !sessionId || leafCount === null || timestamp === null) return;

    // Store for #handleFrostSealed so it can use the authoritative leafCount/timestamp
    // even if local_tree_leaves is incomplete due to a desync race.
    this.#sealVerifiedData.set(sessionIdHex, { leafCount, timestamp });
    // Mark this client as the FROST ceremony participant so #handleFrostSealed uses
    // #myPrimaryPubkey for verification (anti-substitution guard).
    this.#frostCeremonyParticipant.add(sessionIdHex);

    const tbs = buildSealTbs(sessionId, sealedRoot, leafCount, timestamp);

    // Participate in the FROST seal ceremony as coordinator
    const ceremonyId = `seal:${sessionIdHex}`;
    let result;
    try {
      result = await this.#thresholdSigner.participateInCeremony(
        ceremonyId,
        tbs,
        "cello-frost-seal-v1",
      );
    } catch {
      // Ceremony failed — bilateral fallback; do not send seal_frost_signature
      return;
    }

    if (!result.ok) {
      // DB-002: ceremony failed (threshold not met) — bilateral fallback
      return;
    }

    // Send seal_frost_signature to directory.
    // Prefer the per-session directory stream; fall back to the persistent signaling stream
    // (which is used when receiveSessionAssignment detects a persistent stream is already open).
    const dirStream = this.#directoryStreams.get(sessionIdHex);
    const sendStream = (dirStream && dirStream.status === "open") ? dirStream : this.#persistentSignalingStream;
    if (!sendStream) return;

    const sealFrostSigFrame = CBOR_ENC.encode({
      type: "seal_frost_signature",
      session_id: sessionId,
      frost_signature: result.signature,
    }) as Uint8Array;

    try {
      sendStream.send(lp.encode.single(sealFrostSigFrame));
    } catch {
      // Stream closed — bilateral fallback
    }
  }

  /**
   * Handle ceremony_request from the directory.
   * The directory sends this when a session_request requires a FROST ceremony but
   * the directory is not the coordinator. The client runs participateInCeremony
   * and sends back a ceremony_result with the combined signature.
   */
  async #handleCeremonyRequest(
    stream: Stream,
    frame: Record<string, unknown>,
  ): Promise<void> {
    if (!this.#thresholdSigner) return;

    const ceremonyId = frame["ceremony_id"] as string | undefined;
    const tbsRaw = frame["tbs"];
    const tbs = tbsRaw instanceof Uint8Array ? tbsRaw
      : Buffer.isBuffer(tbsRaw) ? new Uint8Array(tbsRaw as Buffer) : null;
    const context = frame["context"] as string | undefined;

    if (!ceremonyId || !tbs || !context) return;

    try {
      const result = await this.#thresholdSigner.participateInCeremony(
        ceremonyId,
        tbs,
        context as import("@cello/crypto/frost/types.js").FrostContext,
      );

      const sig = result.ok ? result.signature : null;
      stream.send(lp.encode.single(CBOR_ENC.encode({
        type: "ceremony_result",
        ceremony_id: ceremonyId,
        signature: sig ? new Uint8Array(sig) : null,
      })));
    } catch {
      stream.send(lp.encode.single(CBOR_ENC.encode({
        type: "ceremony_result",
        ceremony_id: ceremonyId,
        signature: null,
      })));
    }
  }

  /**
   * SESSION-005: Handle session_frost_sealed event — deferred FROST seal completed.
   * Sent by the directory when a previously deferred seal ceremony completes.
   * Updates the session from seal_deferred/bilateral to sealed/frost.
   */
  #handleSessionFrostSealed(sessionIdHex: string, frame: Record<string, unknown>): void {
    const session = this.#sessions.get(sessionIdHex);
    if (!session) return;

    const sealedRootRaw = frame["sealed_root"];
    const sealedRoot = sealedRootRaw instanceof Uint8Array ? sealedRootRaw
      : Buffer.isBuffer(sealedRootRaw) ? new Uint8Array(sealedRootRaw as Buffer) : null;
    const frostSigRaw = frame["frost_signature"];
    const frostSig = frostSigRaw instanceof Uint8Array ? frostSigRaw
      : Buffer.isBuffer(frostSigRaw) ? new Uint8Array(frostSigRaw as Buffer) : null;
    const signerPubkeyRaw = frame["signer_pubkey"];
    const signerPubkey = signerPubkeyRaw instanceof Uint8Array ? signerPubkeyRaw
      : Buffer.isBuffer(signerPubkeyRaw) ? new Uint8Array(signerPubkeyRaw as Buffer) : null;
    const sidRaw = frame["session_id"];
    const sessionId = sidRaw instanceof Uint8Array ? sidRaw
      : Buffer.isBuffer(sidRaw) ? new Uint8Array(sidRaw as Buffer) : null;

    if (!sealedRoot || frostSig === null || !signerPubkey || !sessionId) return;
    if (!frostSig || frostSig.length !== 64) return;
    if (!signerPubkey || signerPubkey.length !== 32) return;

    if (!this.#thresholdSigner) return;

    // Prefer stored sealVerifiedData leafCount (same as #handleFrostSealed) so verification
    // uses the count from the FROST ceremony even if local_tree_leaves is incomplete.
    const sealVerifiedEntry = this.#sealVerifiedData.get(sessionIdHex);
    const leafCount = sealVerifiedEntry?.leafCount ?? session.local_tree_leaves.length;
    // M-003: close_timestamp must be set (stored during bilateral fallback from seal_verified).
    // Without it we cannot reconstruct the exact TBS and verification would be unsound.
    const closeTimestamp = session.close_timestamp ?? sealVerifiedEntry?.timestamp;
    if (closeTimestamp === undefined) {
      console.warn(`[cello-client] session_frost_sealed: no close_timestamp for ${sessionIdHex}, cannot verify TBS`);
      return;
    }
    const tbs = buildSealTbs(sessionId, sealedRoot, leafCount, closeTimestamp);

    const isFrostInitiator = this.#frostCeremonyParticipant.has(sessionIdHex);
    let verifyKey: Uint8Array;
    if (isFrostInitiator) {
      if (!this.#myPrimaryPubkey) return;
      verifyKey = this.#myPrimaryPubkey;
    } else {
      verifyKey = signerPubkey;
    }

    if (!this.#thresholdSigner.verifySignature(frostSig, tbs, "cello-frost-seal-v1", verifyKey)) {
      console.warn(`[cello-client] session_frost_sealed: seal_signature_invalid on session ${sessionIdHex}`);
      return;
    }

    // AC-004: update session from bilateral to frost
    session.status = "sealed";
    session.sealed_root = sealedRoot;
    session.frost_signature = frostSig;
    session.signer_pubkey = signerPubkey;
    session.seal_type = "frost";
  }

  closeSession(sessionIdHex: string): void {
    this.#sessions.delete(sessionIdHex);
    const ackResolve = this.#pendingAckResolvers.get(sessionIdHex);
    if (ackResolve) {
      this.#pendingAckResolvers.delete(sessionIdHex);
      ackResolve({ ok: false, reason: "session_closed" });
    }
    this.#relayRecvSeq.delete(sessionIdHex);
    this.#readyQueue.delete(sessionIdHex);
    this.#pendingS2.delete(sessionIdHex);
    this.#pendingContent.delete(sessionIdHex);
    this.#ownPendingContent.delete(sessionIdHex);
    this.#tamperedContentClaims.delete(sessionIdHex);
    this.#ownEchoResolvers.delete(sessionIdHex);
    this.#sessionMessageQueues.delete(sessionIdHex);
    this.#outboundQueues.delete(sessionIdHex);
    this.#sealInitiatedSessions.delete(sessionIdHex);
    this.#frostCeremonyParticipant.delete(sessionIdHex);
    // Resolve seal-frost-timeout waiter so initiateSessionSeal doesn't hang
    this.#sealFrostResolvers.get(sessionIdHex)?.();
    this.#sealFrostResolvers.delete(sessionIdHex);
    this.#sealVerifiedData.delete(sessionIdHex);
    const stream = this.#relayStreams.get(sessionIdHex);
    if (stream) {
      this.#relayStreams.delete(sessionIdHex);
      stream.abort(new Error("session_closed"));
    }
    const dirStream = this.#directoryStreams.get(sessionIdHex);
    if (dirStream) {
      this.#directoryStreams.delete(sessionIdHex);
      dirStream.abort(new Error("session_closed"));
    }
  }

  // ─── Relay stream reader (MSG-004) ───────────────────────────────────────────

  async #runRelayStreamReader(
    sessionIdHex: string,
    stream: Stream,
    myPubkeyHex: string,
    iter?: AsyncIterator<Uint8Array>,
  ): Promise<void> {
    // Use the iter created by #performRelayAuth so there is never a second lp.decode
    // iterator on this stream. If iter is absent (future callers), create one now.
    const source: AsyncIterator<Uint8Array> = iter ?? (
      (lp.decode(stream) as AsyncIterable<unknown>)[Symbol.asyncIterator]() as AsyncIterator<Uint8Array>
    );
    try {
      while (true) {
        let result: IteratorResult<Uint8Array>;
        try {
          result = await source.next();
        } catch {
          break;
        }
        if (result.done || result.value === undefined) break;

        const bytes = toU8(result.value as unknown);
        let frame: Record<string, unknown>;
        try {
          frame = decode(bytes) as Record<string, unknown>;
        } catch {
          // CBOR decode failure = transport corruption (not adversarial injection — the relay
          // stream is authenticated). We skip the frame and let the sequence-gap check in
          // #handleInboundLeafDeliver detect the missing sequence number on the next valid frame.
          continue;
        }

        if (frame["type"] === "hash_submit_ack") {
          const resolve = this.#pendingAckResolvers.get(sessionIdHex);
          if (resolve) {
            this.#pendingAckResolvers.delete(sessionIdHex);
            const seqNum = typeof frame["sequence_number"] === "number" ? frame["sequence_number"] : 0;
            resolve({ ok: true, sequence_number: seqNum });
          }
        } else if (frame["type"] === "hash_submit_error") {
          const resolve = this.#pendingAckResolvers.get(sessionIdHex);
          if (resolve) {
            this.#pendingAckResolvers.delete(sessionIdHex);
            resolve({ ok: false, reason: String(frame["reason"] ?? "unknown") });
          }
        } else if (frame["type"] === "leaf_deliver") {
          const deliverSessionIdRaw = frame["session_id"];
          const deliverSessionId = deliverSessionIdRaw instanceof Uint8Array ? deliverSessionIdRaw
            : Buffer.isBuffer(deliverSessionIdRaw) ? new Uint8Array(deliverSessionIdRaw as Buffer) : null;
          const targetSessionHex = deliverSessionId
            ? Buffer.from(deliverSessionId).toString("hex")
            : sessionIdHex;
          this.#handleInboundLeafDeliver(targetSessionHex, frame, myPubkeyHex);
        } else if (frame["type"] === "gap_fill_response") {
          // PERSIST-014: reconciliation response — verify leaves, advance tree, retry seal
          this.#handleGapFillResponse(sessionIdHex, frame);
        } else if (frame["type"] === "gap_fill_error") {
          // PERSIST-014: relay could not serve gap-fill leaves
          const reason = typeof frame["reason"] === "string" ? frame["reason"] : "unknown";
          const pendingReconciliation = this.#pendingGapFillResolvers.get(sessionIdHex);
          if (pendingReconciliation) {
            this.#pendingGapFillResolvers.delete(sessionIdHex);
            pendingReconciliation({ ok: false, reason });
          }
        }
      }
    } catch {
      // Stream closed — relay disconnected (SESSION-006 DB-001)
    }

    // Relay stream disconnected: mark relay stream null so sendMessage returns transport_unavailable
    if (this.#relayStreams.get(sessionIdHex) === stream) {
      this.#relayStreams.delete(sessionIdHex);
    }

    // SESSION-006 AC-001: transition session to transport_lost and unblock pending sends
    this.#onRelayDisconnect(sessionIdHex, myPubkeyHex);
  }

  /**
   * SESSION-006 AC-001: Called when the relay stream closes unexpectedly.
   *
   * Pseudocode (Phase P):
   *   1. If session not found or already desynchronized → nothing to do
   *   2. If session already transport_lost → already handling (reconnect in progress)
   *   3. Mark session status = "transport_lost"
   *   4. Unblock any pending ack resolver with transport_unavailable
   *   5. Start reconnect loop (returns immediately, runs asynchronously)
   */
  #onRelayDisconnect(sessionIdHex: string, myPubkeyHex: string): void {
    const session = this.#sessions.get(sessionIdHex);
    if (!session) return;
    if (session.desynchronized) return;
    if (session.status === "transport_lost") return; // already reconnecting
    // Sealing/sealed/seal_rejected/seal_deferred: relay stream closing is expected; do not clobber status.
    // In SESSION-003/005, the relay triggers processSeal → confirmSeal which destroys the relay session.
    // The client's sealing→sealed transition is driven by the directory signaling stream, not relay.
    if (session.status === "sealing" || session.status === "sealed" || session.status === "seal_rejected" || session.status === "seal_deferred") return;

    // Mark session transport_lost (SESSION-006 AC-001)
    session.status = "transport_lost";

    // Unblock any waiting sendMessage calls with transport_unavailable
    const ackResolve = this.#pendingAckResolvers.get(sessionIdHex);
    if (ackResolve) {
      this.#pendingAckResolvers.delete(sessionIdHex);
      ackResolve({ ok: false, reason: "transport_unavailable" });
    }

    // Start reconnect loop asynchronously (SESSION-006 AC-002, DB-001, AC-003)
    void this.#reconnectRelayStream(sessionIdHex, myPubkeyHex);
  }

  /**
   * SESSION-006 reconnect loop with exponential backoff.
   *
   * Pseudocode (Phase P):
   *   deadline = now + reconnectTimeoutMs
   *   backoff = RECONNECT_INITIAL_BACKOFF_MS
   *   while now < deadline:
   *     try:
   *       newStream = dial relay endpoint from cached SessionAssignment
   *       complete "CELLO-RELAY-AUTH-v1" challenge-response
   *       await relay_auth_ok
   *       relay sends queued leaf_deliver frames (already implemented in NODE-002)
   *       update relayStreams[sessionIdHex] = newStream
   *       start new #runRelayStreamReader loop (passing auth iter)
   *       mark session status = "active"
   *       return
   *     catch:
   *       wait backoff ms
   *       backoff = min(backoff * 2, RECONNECT_MAX_BACKOFF_MS)
   *   // timeout elapsed
   *   session stays "transport_lost" permanently (AC-003)
   */
  async #reconnectRelayStream(sessionIdHex: string, myPubkeyHex: string): Promise<void> {
    // Guard: only one reconnect loop per session at a time
    if (this.#reconnectInProgress.has(sessionIdHex)) return;
    this.#reconnectInProgress.add(sessionIdHex);

    const deadline = Date.now() + this.#reconnectTimeoutMs;
    let backoff = RECONNECT_INITIAL_BACKOFF_MS;

    try {
      while (Date.now() < deadline) {
        const session = this.#sessions.get(sessionIdHex);
        // Stop if session was closed, desynchronized, or sealed during reconnect
        if (!session || session.desynchronized) return;
        if (session.status !== "transport_lost") return;

        try {
          const relayPeerId = session.relay_endpoint.peer_id;
          const relayMultiaddr = session.relay_endpoint.multiaddrs[0];

          if (relayMultiaddr) {
            try { await this.#node.dial(relayMultiaddr); } catch { /* already connected or not yet reachable */ }
          }

          let newStream: Stream;
          try {
            newStream = await this.#node.newStream(relayPeerId, RELAY_PROTOCOL_ID);
          } catch {
            throw new Error("relay_unreachable");
          }

          // Complete relay auth challenge-response (CELLO-RELAY-AUTH-v1)
          const myPubkey = Buffer.from(myPubkeyHex, "hex");
          const authResult = await this.#performRelayAuth(newStream, myPubkey);
          if (!authResult.ok) {
            newStream.abort(new Error("auth_failed"));
            throw new Error("relay_auth_failed");
          }

          // Re-check session state after async auth
          const sessionAfterAuth = this.#sessions.get(sessionIdHex);
          if (!sessionAfterAuth || sessionAfterAuth.desynchronized) {
            newStream.abort(new Error("session_gone"));
            return;
          }

          // Reconnect succeeded: install new stream and resume
          this.#relayStreams.set(sessionIdHex, newStream);
          sessionAfterAuth.status = "active";

          // Start the new reader loop (authResult.iter is the continuation iterator)
          void this.#runRelayStreamReader(sessionIdHex, newStream, myPubkeyHex, authResult.iter);
          return;

        } catch {
          // Reconnect attempt failed — wait with exponential backoff
          const remaining = deadline - Date.now();
          if (remaining <= 0) break;
          const waitMs = Math.min(backoff, remaining);
          await new Promise<void>((r) => setTimeout(r, waitMs));
          backoff = Math.min(backoff * 2, RECONNECT_MAX_BACKOFF_MS);
        }
      }

      // Timeout elapsed: session remains transport_lost permanently (AC-003)
      // No further state change needed — session.status is already "transport_lost"
    } finally {
      this.#reconnectInProgress.delete(sessionIdHex);
    }
  }

  // Internal test escape: forcibly close the relay stream for a session to simulate disconnect.
  // SESSION-006: used by AC-001, AC-002, DB-001 tests.
  injectRelayDisconnect(sessionIdHex: string): void {
    const stream = this.#relayStreams.get(sessionIdHex);
    const myPubkeyHex = this.#myPubkeyHex;
    if (!myPubkeyHex) return;

    // Abort the stream if it exists (this will cause #runRelayStreamReader to exit)
    if (stream) {
      this.#relayStreams.delete(sessionIdHex);
      try { stream.abort(new Error("test_inject_disconnect")); } catch { /* ignore */ }
    }

    // Directly trigger the disconnect handler
    this.#onRelayDisconnect(sessionIdHex, myPubkeyHex);
  }

  #handleInboundLeafDeliver(
    sessionIdHex: string,
    frame: Record<string, unknown>,
    myPubkeyHex: string,
  ): void {
    const session = this.#sessions.get(sessionIdHex);
    if (!session || session.desynchronized) return;

    // Decode Structure 2 CBOR
    const s2CborRaw = frame["structure2_cbor"];
    const s2Cbor = s2CborRaw instanceof Uint8Array ? s2CborRaw
      : Buffer.isBuffer(s2CborRaw) ? new Uint8Array(s2CborRaw as Buffer) : null;
    if (!s2Cbor) { this.#desync(sessionIdHex, "structure2_malformed"); return; }

    let s2Arr: unknown[];
    try {
      const decoded = decode(s2Cbor);
      if (!Array.isArray(decoded) || decoded.length !== 6) {
        this.#desync(sessionIdHex, "structure2_malformed"); return;
      }
      s2Arr = decoded;
    } catch {
      this.#desync(sessionIdHex, "structure2_malformed"); return;
    }

    // Extract Structure 2 fields: [seq, sender_pubkey, content_hash, sender_sig, scan_result, prev_root]
    const seqNum = typeof s2Arr[0] === "number" ? s2Arr[0] : null;
    if (seqNum === null) { this.#desync(sessionIdHex, "structure2_fields_invalid"); return; }

    const senderPubkey = toU8Safe(s2Arr[1]);
    const contentHash = toU8Safe(s2Arr[2]);
    const senderSig = toU8Safe(s2Arr[3]);
    // s2Arr[4] = scan_result sentinel (ignored in M1)
    const prevRoot = toU8Safe(s2Arr[5]);

    if (!senderPubkey || senderPubkey.length !== 32) { this.#desync(sessionIdHex, "structure2_fields_invalid"); return; }
    if (!contentHash || contentHash.length !== 32) { this.#desync(sessionIdHex, "structure2_fields_invalid"); return; }
    if (!senderSig || senderSig.length !== 64) { this.#desync(sessionIdHex, "structure2_fields_invalid"); return; }
    if (!prevRoot || prevRoot.length !== 32) { this.#desync(sessionIdHex, "structure2_fields_invalid"); return; }

    const s2: Structure2 = {
      sequence_number: seqNum,
      sender_pubkey: senderPubkey,
      content_hash: contentHash,
      sender_signature: senderSig,
      scan_result: { score: null, verdict: "unscanned", model_hash: new Uint8Array(32) },
      prev_root: prevRoot,
    };

    // Sequence check against relay-delivery counter (independent of cross-check completion).
    // The relay sends leaves in strict monotonic order; any deviation is an integrity violation.
    const relayRecvSeq = this.#relayRecvSeq.get(sessionIdHex) ?? 0;
    if (seqNum <= relayRecvSeq) { this.#desync(sessionIdHex, "sequence_replay"); return; }
    if (seqNum > relayRecvSeq + 1) { this.#desync(sessionIdHex, "sequence_gap"); return; }
    this.#relayRecvSeq.set(sessionIdHex, seqNum);

    // Decode Structure 1 from frame.structure1_cbor for sig verify and causal check
    const s1CborRaw = frame["structure1_cbor"];
    const s1Cbor = s1CborRaw instanceof Uint8Array ? s1CborRaw
      : Buffer.isBuffer(s1CborRaw) ? new Uint8Array(s1CborRaw as Buffer) : null;
    if (!s1Cbor) { this.#desync(sessionIdHex, "structure1_malformed"); return; }

    let s1Fields: Structure1Fields | null = null;
    try {
      const s1Decoded = decode(s1Cbor);
      if (Array.isArray(s1Decoded) && s1Decoded.length === 6) {
        const lss = s1Decoded[4];
        const ts = s1Decoded[5];
        if (typeof lss === "number" && (typeof ts === "number" || typeof ts === "bigint")) {
          s1Fields = { last_seen_seq: lss, timestamp: ts };
        }
      }
    } catch { /* fall through */ }

    if (!s1Fields) { this.#desync(sessionIdHex, "structure1_malformed"); return; }

    // Verify Ed25519 signature over the exact Structure 1 CBOR bytes the sender signed.
    // We must NOT re-encode from decoded fields — cbor-x may change timestamp representation
    // (e.g. number→float64 vs the original uint64), breaking signature verification.
    // The relay stores and forwards the original structure1_cbor unchanged, so s1Cbor
    // here is byte-identical to what the sender signed.
    if (!verify(senderPubkey, s1Cbor, s2.sender_signature)) {
      this.#desync(sessionIdHex, "signature_verification_failed"); return;
    }

    // Determine if this is our own send
    const senderHex = Buffer.from(senderPubkey).toString("hex");
    const isOwnSend = senderHex === myPubkeyHex;

    const contentHashHex = Buffer.from(contentHash).toString("hex");
    const leafKind = typeof frame["leaf_kind"] === "number" ? frame["leaf_kind"] : 0x00;

    // Check if a tampered content frame arrived earlier claiming this hash.
    // A tampered frame has declared_hash = contentHashHex but bytes that don't verify —
    // the content path already flagged this as a mismatch attempt.
    const tamperedClaims = this.#tamperedContentClaims.get(sessionIdHex);
    if (tamperedClaims?.has(contentHashHex)) {
      tamperedClaims.delete(contentHashHex);
      this.#desync(sessionIdHex, "content_hash_mismatch"); return;
    }

    // Check if matching content already arrived.
    // Own-send echoes look up #ownPendingContent (pre-buffered by #sendMessageLocked).
    // Counterparty sends look up #pendingContent (content arrived via content path).
    // Keeping them separate avoids collision when both sides send identical byte payloads.
    const ownPendingContent = isOwnSend ? this.#ownPendingContent.get(sessionIdHex) : undefined;
    const pendingContent = this.#pendingContent.get(sessionIdHex);
    const contentEntry = isOwnSend
      ? ownPendingContent?.get(contentHashHex)
      : pendingContent?.get(contentHashHex);

    // Retrieve echo resolver now (before cross-check where seq is consumed)
    let echoResolve: (() => void) | undefined;
    if (isOwnSend) {
      const resolvers = this.#ownEchoResolvers.get(sessionIdHex);
      echoResolve = resolvers?.get(seqNum);
      resolvers?.delete(seqNum);
    }

    if (contentEntry) {
      if (isOwnSend) { ownPendingContent!.delete(contentHashHex); }
      else { pendingContent!.delete(contentHashHex); }
      this.#crossCheckDelivery(sessionIdHex, s2, s2Cbor, s1Fields, leafKind, contentEntry.content_bytes, isOwnSend, echoResolve);
    } else {
      // S2 arrived before content — buffer and start 30s grace timer
      const timerHandle = setTimeout(() => {
        const ps2Map = this.#pendingS2.get(sessionIdHex);
        if (ps2Map?.has(contentHashHex)) {
          ps2Map.delete(contentHashHex);
          this.#desync(sessionIdHex, "content_missing");
        }
      }, this.#contentGraceMs);

      const entry: PendingS2Entry = {
        s2,
        s2_cbor: s2Cbor,
        s1_fields: s1Fields,
        leaf_kind: leafKind,
        sequence_number: seqNum,
        content_hash: contentHash,
        is_own_send: isOwnSend,
        arrived_at: Date.now(),
        timer_handle: timerHandle,
        echo_resolve: echoResolve,
      };
      this.#pendingS2.get(sessionIdHex)?.set(contentHashHex, entry);
    }
  }

  /**
   * Called when BOTH S2 (relay path) and content (content path) have arrived for a leaf.
   * Enqueues the entry in the ready queue keyed by seqNum, then drains in-order.
   * This defers prevRoot and causal checks until all prior leaves are confirmed, avoiding
   * false prev_root_mismatch when content for seq N-1 hasn't arrived yet.
   */
  #crossCheckDelivery(
    sessionIdHex: string,
    s2: Structure2,
    s2Cbor: Uint8Array,
    s1Fields: Structure1Fields,
    leafKind: number,
    contentBytes: Uint8Array,
    isOwnSend: boolean,
    echoResolve?: () => void,
  ): void {
    const session = this.#sessions.get(sessionIdHex);
    if (!session || session.desynchronized) return;

    const readyQ = this.#readyQueue.get(sessionIdHex);
    if (!readyQ) return;

    readyQ.set(s2.sequence_number, { s2, s2_cbor: s2Cbor, s1_fields: s1Fields, leaf_kind: leafKind, content_bytes: contentBytes, is_own_send: isOwnSend, echo_resolve: echoResolve });
    this.#drainReadyQueue(sessionIdHex);
  }

  #drainReadyQueue(sessionIdHex: string): void {
    const session = this.#sessions.get(sessionIdHex);
    const readyQ = this.#readyQueue.get(sessionIdHex);
    if (!session || !readyQ || session.desynchronized) return;

    while (true) {
      // next_expected_seq is the next seqNum to process (starts at 1)
      const nextSeq = session.next_expected_seq;
      const entry = readyQ.get(nextSeq);
      if (!entry) break; // not ready yet — wait for content to arrive
      readyQ.delete(nextSeq);

      const { s2, s2_cbor, s1_fields, leaf_kind, content_bytes, is_own_send, echo_resolve } = entry;

      // Verify prev_root now that local_tree_leaves has all leaves 1..(nextSeq-1)
      const expectedPrevRoot = session.local_tree_leaves.length === 0
        ? session.genesis_prev_root
        : (() => {
            const inputs: LeafInput[] = session.local_tree_leaves.map(l => ({
              kind: l.kind,
              data: l.s2_cbor,
            }));
            return merkleRoot(buildMerkleTree(inputs));
          })();

      if (Buffer.compare(Buffer.from(s2.prev_root), Buffer.from(expectedPrevRoot)) !== 0) {
        this.#desync(sessionIdHex, "prev_root_mismatch"); return;
      }

      // Causal chain check per MSG-004 AC-008: sender's last_seen_seq = sender's highest
      // observed counterparty seq. Receiver checks: that value can't exceed the receiver's
      // own highest echoed seq (last_sent_seq), since the sender can only have seen leaves
      // the receiver actually sent.
      // Skip this check for own-send echoes: the claim "I've seen N of B's leaves" was
      // made at send-time when we knew our own view of B's sends. We trust our own sends;
      // there's no injection risk here, and applying the check would fire a false desync
      // when our own SEAL echo arrives before all counterparty echoes complete.
      if (!is_own_send && s1_fields.last_seen_seq > session.last_sent_seq) {
        this.#desync(sessionIdHex, "sequence_causal_inconsistency"); return;
      }

      const kind: "msg" | "ctrl" = leaf_kind === 0x02 ? "ctrl" : "msg";

      // Append to local tree
      session.local_tree_leaves.push({ kind, s2_cbor });
      session.next_expected_seq += 1;

      // Compute leaf hash: SHA-256(leaf_kind_byte || s2_cbor) per MERKLE-001
      const leafHash = new Uint8Array(
        createHash("sha256").update(new Uint8Array([leaf_kind])).update(s2_cbor).digest()
      );

      if (is_own_send) {
        // Own-send echo: fire the send lock release and advance own-seq tracker.
        // Do NOT enqueue into receiveMessage queues — callers don't "receive" their own sends.
        session.last_sent_seq = s2.sequence_number;
        echo_resolve?.();
      } else {
        // last_seen_seq = highest counterparty relay seq confirmed on this session.
        // Per MSG-004: TBS last_seen_seq must equal the highest relay seq from the *counterparty*,
        // so the causal-chain check at seal can verify we couldn't have seen msgs that don't exist.
        session.last_seen_seq = s2.sequence_number;
        if (kind === "ctrl" && session.status === "active") {
          // SESSION-003: non-initiator auto-response to counterparty's SEAL leaf.
          // Transition to sealing and submit our own SEAL leaf asynchronously.
          session.status = "sealing";
          void this.#submitSealLeaf(sessionIdHex, session, "responder").then((result) => {
            if (!result.ok) {
              const s = this.#sessions.get(sessionIdHex);
              if (s && s.status === "sealing") s.status = "seal_rejected";
            }
          });
        } else {
          // Counterparty message: enqueue for receiveMessage callers.
          const msg: ReceivedMessage = {
            type: "message",
            content: content_bytes,
            senderPubkey: s2.sender_pubkey,
            sequenceNumber: s2.sequence_number,
            leafHash,
          };
          this.#sessionMessageQueues.get(sessionIdHex)?.push(msg);
          this.#anyMessageQueue.push({ sessionIdHex, message: msg });
          // SESSION-007: wake any blocked receiveMessageAsync / receiveAnyMessageAsync callers.
          this.#wakeReceiveWaiters(sessionIdHex);
        }
      }
    }
  }

  #desync(sessionIdHex: string, reason: string): void {
    const session = this.#sessions.get(sessionIdHex);
    if (!session) return;

    session.desynchronized = true;

    // Cancel pending S2 timers AND fire any migrated echo resolvers
    const ps2 = this.#pendingS2.get(sessionIdHex);
    if (ps2) {
      for (const entry of ps2.values()) {
        clearTimeout(entry.timer_handle);
        entry.echo_resolve?.();
      }
      ps2.clear();
    }

    // Fire remaining own_echo_resolvers (unblock waiting sendMessage calls)
    const resolvers = this.#ownEchoResolvers.get(sessionIdHex);
    if (resolvers) {
      for (const resolve of resolvers.values()) {
        resolve();
      }
      resolvers.clear();
    }

    this.#pendingContent.get(sessionIdHex)?.clear();
    this.#ownPendingContent.get(sessionIdHex)?.clear();
    this.#relayRecvSeq.delete(sessionIdHex);
    this.#readyQueue.get(sessionIdHex)?.clear();

    // Unblock any pending ack resolver
    const ackResolve = this.#pendingAckResolvers.get(sessionIdHex);
    if (ackResolve) {
      this.#pendingAckResolvers.delete(sessionIdHex);
      ackResolve({ ok: false, reason });
    }

    console.warn(`[cello-client] session_desynchronized: ${sessionIdHex} reason=${reason}`);
  }

  // ─── Content frame handler (MSG-004) ─────────────────────────────────────────

  async #handleContentStream(stream: Stream): Promise<void> {
    let payload: Uint8Array | undefined;
    try {
      for await (const chunk of lp.decode(stream)) {
        payload = toU8(chunk as unknown);
        break; // one frame per stream
      }
    } catch {
      stream.abort(new Error("content_stream_error"));
      return;
    }

    if (!payload) { stream.close().catch(() => {}); return; }

    let frame: Record<string, unknown>;
    try {
      frame = decode(payload) as Record<string, unknown>;
    } catch {
      stream.close().catch(() => {});
      return;
    }

    if (frame["type"] !== "content_frame") { stream.close().catch(() => {}); return; }

    const sessionIdRaw = frame["session_id"];
    const sessionIdBytes = sessionIdRaw instanceof Uint8Array ? sessionIdRaw
      : Buffer.isBuffer(sessionIdRaw) ? new Uint8Array(sessionIdRaw as Buffer) : null;
    if (!sessionIdBytes) { stream.close().catch(() => {}); return; }

    const sessionIdHex = Buffer.from(sessionIdBytes).toString("hex");
    const session = this.#sessions.get(sessionIdHex);
    if (!session || session.desynchronized) { stream.close().catch(() => {}); return; }

    const contentBytesRaw = frame["content_bytes"];
    const contentBytes = contentBytesRaw instanceof Uint8Array ? contentBytesRaw
      : Buffer.isBuffer(contentBytesRaw) ? new Uint8Array(contentBytesRaw as Buffer) : null;
    if (!contentBytes) { stream.close().catch(() => {}); return; }

    const declaredHashRaw = frame["content_hash"];
    const declaredHash = declaredHashRaw instanceof Uint8Array ? declaredHashRaw
      : Buffer.isBuffer(declaredHashRaw) ? new Uint8Array(declaredHashRaw as Buffer) : null;
    if (!declaredHash || declaredHash.length !== 32) { stream.close().catch(() => {}); return; }

    const declaredHashHex = Buffer.from(declaredHash).toString("hex");

    // If S2 is already buffered, we know the leaf_kind and can verify the hash immediately.
    // leaf_kind may be 0x00 (msg) or 0x02 (ctrl/SEAL) — the sender uses it in SHA-256(kind||bytes).
    // If S2 has not yet arrived, we cannot know the leaf_kind and must defer verification:
    // store the content and let the S2-arrival path (which has leaf_kind) verify it then.
    const ps2MapEarly = this.#pendingS2.get(sessionIdHex);
    const s2EntryEarly = ps2MapEarly?.get(declaredHashHex);

    if (s2EntryEarly) {
      // S2 already buffered — verify hash immediately using known leaf_kind.
      const recomputed = new Uint8Array(
        createHash("sha256").update(new Uint8Array([s2EntryEarly.leaf_kind])).update(contentBytes).digest()
      );
      if (Buffer.compare(Buffer.from(recomputed), Buffer.from(declaredHash)) !== 0) {
        clearTimeout(s2EntryEarly.timer_handle);
        ps2MapEarly!.delete(declaredHashHex);
        this.#desync(sessionIdHex, "content_hash_mismatch");
        stream.close().catch(() => {});
        return;
      }
    } else {
      // S2 not yet buffered — try both possible leaf_kind values: 0x00 (msg) and 0x02 (ctrl/SEAL).
      // If neither hash matches the declared hash, the frame is tampered; flag it for desync
      // when the corresponding S2 arrives.
      const msgHash = new Uint8Array(
        createHash("sha256").update(new Uint8Array([0x00])).update(contentBytes).digest()
      );
      const ctrlHash = new Uint8Array(
        createHash("sha256").update(new Uint8Array([0x02])).update(contentBytes).digest()
      );
      const matchesMsg = Buffer.compare(Buffer.from(msgHash), Buffer.from(declaredHash)) === 0;
      const matchesCtrl = Buffer.compare(Buffer.from(ctrlHash), Buffer.from(declaredHash)) === 0;
      if (!matchesMsg && !matchesCtrl) {
        this.#tamperedContentClaims.get(sessionIdHex)?.add(declaredHashHex);
        stream.close().catch(() => {});
        return;
      }
    }

    const contentHashHex = declaredHashHex;

    // Check if matching S2 is already buffered
    const ps2Map = this.#pendingS2.get(sessionIdHex);
    const s2Entry = ps2Map?.get(contentHashHex);

    if (s2Entry) {
      ps2Map!.delete(contentHashHex);
      clearTimeout(s2Entry.timer_handle);
      this.#crossCheckDelivery(
        sessionIdHex,
        s2Entry.s2,
        s2Entry.s2_cbor,
        s2Entry.s1_fields,
        s2Entry.leaf_kind,
        contentBytes,
        s2Entry.is_own_send,
        s2Entry.echo_resolve,
      );
    } else {
      // Content arrived before S2 — buffer it (no timer per AC-010)
      const pending = this.#pendingContent.get(sessionIdHex);
      if (pending) {
        if (pending.size >= PENDING_CONTENT_BOUND) {
          // Evict oldest entry (FIFO) per pseudocode M-1 fix
          const firstKey = pending.keys().next().value;
          if (firstKey !== undefined) pending.delete(firstKey);
        }
        pending.set(contentHashHex, { content_bytes: contentBytes, arrived_at: Date.now() });
        console.debug(`[cello-client] content_without_hash: session=${sessionIdHex} hash=${contentHashHex}`);
      }
    }

    stream.close().catch(() => {});
  }

  /**
   * Complete relay challenge-response auth on an open stream.
   * Returns ok:true plus the stream iterator on success, ok:false with reason on rejection.
   * The caller MUST pass the returned iterator to #runRelayStreamReader — creating a second
   * lp.decode iterator on the same stream causes frame-stealing between the two readers.
   *
   * Auth signature: Ed25519(SHA-256("CELLO-RELAY-AUTH-v1" || nonce || pubkey), privkey)
   *   per RFC 8032 (Ed25519), FIPS 180-4 (SHA-256)
   *
   * Protocol: relay sends relay_auth_challenge immediately on connect.
   * We read it, sign the nonce, send relay_auth_response.
   * On auth failure, relay sends relay_auth_failed then aborts the stream.
   * On success, relay sends relay_auth_ok then waits for hash_submit frames.
   * Protocol: challenge → response → relay_auth_ok | relay_auth_failed
   */
  async #performRelayAuth(
    stream: Stream,
    myPubkey: Uint8Array,
  ): Promise<{ ok: true; iter: AsyncIterator<Uint8Array> } | { ok: false; reason: "relay_auth_failed" | "relay_auth_error" }> {
    // Create exactly ONE iterator for this stream's lifetime — never create a second one.
    const iter = (lp.decode(stream) as AsyncIterable<unknown>)[Symbol.asyncIterator]() as AsyncIterator<Uint8Array>;

    // Read challenge frame — bounded by RELAY_AUTH_TIMEOUT_MS to prevent indefinite hang
    // if a misbehaving relay sends the challenge but never sends relay_auth_ok.
    const { value: challengeRaw, done } = await nextWithTimeout(iter, RELAY_AUTH_TIMEOUT_MS);
    if (done || challengeRaw === undefined) {
      return { ok: false, reason: "relay_auth_error" };
    }
    const challengeBytes = toU8(challengeRaw);
    let challenge: Record<string, unknown>;
    try {
      challenge = decode(challengeBytes) as Record<string, unknown>;
    } catch {
      return { ok: false, reason: "relay_auth_error" };
    }

    if (challenge["type"] !== "relay_auth_challenge") {
      return { ok: false, reason: "relay_auth_error" };
    }

    const nonce = toU8(challenge["nonce"]);
    if (nonce.length !== 32) {
      return { ok: false, reason: "relay_auth_error" };
    }

    // Build and sign auth message
    const domain = Buffer.from(AUTH_DOMAIN, "utf8");
    const authMsg = new Uint8Array(Buffer.concat([domain, nonce, myPubkey]));
    const msgHash = new Uint8Array(createHash("sha256").update(authMsg).digest());
    const signature = await this.#keyProvider.sign(msgHash);

    // Send response
    const responseFrame = CBOR_ENC.encode({
      type: "relay_auth_response",
      pubkey: myPubkey,
      signature,
    }) as Uint8Array;
    stream.send(lp.encode.single(responseFrame));

    // Read relay_auth_ok or relay_auth_failed — bounded by RELAY_AUTH_TIMEOUT_MS.
    // A relay that sends the challenge but stalls before the ack would otherwise hang here
    // indefinitely; the timeout causes #performRelayAuth to throw, which the outer reconnect
    // loop's catch block handles via backoff/deadline logic.
    const { value: ackRaw, done: ackDone } = await nextWithTimeout(iter, RELAY_AUTH_TIMEOUT_MS);
    if (ackDone || ackRaw === undefined) {
      return { ok: false, reason: "relay_auth_error" };
    }
    let ackFrame: Record<string, unknown>;
    try {
      ackFrame = decode(toU8(ackRaw)) as Record<string, unknown>;
    } catch {
      return { ok: false, reason: "relay_auth_error" };
    }

    if (ackFrame["type"] === "relay_auth_failed") {
      return { ok: false, reason: "relay_auth_failed" };
    }
    if (ackFrame["type"] !== "relay_auth_ok") {
      return { ok: false, reason: "relay_auth_error" };
    }

    return { ok: true, iter };
  }

  // ─── MSG-002 handlers ─────────────────────────────────────────────────────────

  async registerHandler(): Promise<void> {
    await this.#node.handle(CELLO_PROTOCOL_ID, (stream) => {
      void this.#handleInbound(stream);
    });

    // ADAPTER-003: if a directory endpoint is configured, pre-authenticate now.
    // This registers this client's stream with the directory so the directory can
    // deliver inbound session_assignment frames (participant B role) without waiting
    // for this client to call initiateSession first.
    // Awaited here so that by the time registerHandler returns, the stream is established
    // and the directory knows this client is reachable.
    // Best-effort: failure is non-fatal (stream will be re-opened on first initiateSession call).
    if (this.#directoryEndpoint && !this.#persistentSignalingStream) {
      await this.#openPersistentSignalingStream().catch(() => {
        // Ignore failure — stream will be opened lazily on first initiateSession call
      });
    }
  }

  // ─── REG-001: Agent registration ─────────────────────────────────────────────

  /**
   * Register this agent with the directory.
   *
   * REG-001 Phase P pseudocode:
   *   1. If already registered, return { error: 'already_registered' }
   *   2. Generate (or load) ML-DSA-44 keypair (NIST FIPS 204)
   *      - If #mlDsaKeyFile is set: FileMlDsaKeyProvider.load(path) — persists with 0o600
   *      - Otherwise: mlDsaKeygen() → InMemoryMlDsaKeyProvider
   *   3. Open (or reuse) persistent signaling stream (auth handled inside)
   *   4. Get myPubkeyHex (Ed25519 K_local)
   *   5. Send register_request { phone_stub, k_local_pubkey, ml_dsa_pubkey } on signaling stream
   *   5a. Await dkg_ready { epochId, participants, threshold } (routed by signaling reader)
   *   5b. Run real FROST DKG ceremony over /cello/frost/1.0.0 streams (RFC 9591)
   *       - Create NetworkDirectoryNode for each directory peer
   *       - runNetworkDkg(agentPubkey, { threshold, participants, directoryNodes })
   *       - Stores client share via storeDkgResult in frost-threshold-signer
   *   5c. Send dkg_complete { primary_pubkey } on signaling stream
   *   6. Await register_success or register_error (routed by #runPersistentSignalingReader)
   *      - register_error → return { error: reason }
   *      - register_success → build RegistrationState and cache it
   *   7. Return RegistrationState
   *
   * Crypto refs: NIST FIPS 204 (ML-DSA-44), RFC 9591 (FROST), FIPS 180-4 (SHA-256)
   */
  async register(phoneStub: string): Promise<RegistrationState | { error: string }> {
    // Step 1: already registered — return error
    if (this.#registrationState) {
      return { error: "already_registered" };
    }

    // Step 2: generate or load ML-DSA-44 keypair (NIST FIPS 204)
    const mlDsaProvider = this.#mlDsaKeyFile
      ? await FileMlDsaKeyProvider.load(this.#mlDsaKeyFile)
      : await mlDsaKeygen();
    const mlDsaPubkey = await mlDsaProvider.getPublicKey();
    const mlDsaPubkeyHex = Buffer.from(mlDsaPubkey).toString("hex");

    // Step 3: open persistent signaling stream (handles auth including auth_ok wait)
    const opened = await this.#openPersistentSignalingStream();
    if (!opened || !this.#persistentSignalingStream) {
      return { error: "directory_unreachable" };
    }

    // Step 4: get K_local pubkey hex
    if (!this.#myPubkeyHex) {
      const pubkey = await this.#keyProvider.getPublicKey();
      this.#myPubkeyHex = Buffer.from(pubkey).toString("hex");
    }
    const kLocalPubkeyHex = this.#myPubkeyHex;

    // Step 5: send register_request
    const regRequestFrame = CBOR_ENC.encode({
      type: "register_request",
      phone_stub: phoneStub,
      k_local_pubkey: kLocalPubkeyHex,
      ml_dsa_pubkey: mlDsaPubkeyHex,
    }) as Uint8Array;
    this.#persistentSignalingStream.send(lp.encode.single(regRequestFrame));

    // Step 5a: await dkg_ready from directory (routed by #runPersistentSignalingReader)
    const DKG_READY_TIMEOUT_MS = 15_000;
    let dkgReadyTimeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const dkgReadyFrame = await Promise.race<Record<string, unknown>>([
      new Promise<Record<string, unknown>>((resolve) => {
        this.#pendingDkgReadyResolve = resolve;
      }),
      new Promise<Record<string, unknown>>((resolve) => {
        dkgReadyTimeoutHandle = setTimeout(() => {
          this.#pendingDkgReadyResolve = null;
          resolve({ type: "register_error", reason: "timeout" });
        }, DKG_READY_TIMEOUT_MS);
      }),
    ]);
    clearTimeout(dkgReadyTimeoutHandle);

    if (dkgReadyFrame["type"] !== "dkg_ready") {
      const reason = (dkgReadyFrame["reason"] as string | undefined) ?? "unknown";
      // already_registered: directory skips dkg_ready and sends register_error directly.
      // Reconstruct RegistrationState from profile fields in the error frame.
      if (
        reason === "already_registered" &&
        dkgReadyFrame["agent_id"] &&
        dkgReadyFrame["primary_pubkey"]
      ) {
        const state: RegistrationState = {
          agent_id: dkgReadyFrame["agent_id"] as string,
          primary_pubkey: dkgReadyFrame["primary_pubkey"] as string,
          ml_dsa_pubkey: (dkgReadyFrame["ml_dsa_pubkey"] as string | undefined) ?? mlDsaPubkeyHex,
          // registered_at is set to now — the already_registered frame does not carry the
          // original timestamp. Callers must not treat this as the canonical registration time.
          registered_at: Date.now(),
          status: "active",
        };
        this.#registrationState = state;
        this.#mlDsaProvider = mlDsaProvider;
        return state;
      }
      return { error: reason };
    }

    // Step 5b: run real FROST DKG over /cello/frost/1.0.0 (RFC 9591)
    const epochId = dkgReadyFrame["epochId"] as string;
    const participants = dkgReadyFrame["participants"] as number;
    const threshold = dkgReadyFrame["threshold"] as number;
    if (!this.#directoryEndpoint) {
      return { error: "directory_unreachable" };
    }
    const dirNode = new NetworkDirectoryNode({
      id: this.#directoryEndpoint.peer_id,
      node: this.#node,
      directoryPeerId: this.#directoryEndpoint.peer_id,
      directoryMultiaddrs: this.#directoryEndpoint.multiaddrs,
    });
    // epochId is noted here for tracing; runNetworkDkg derives its own epochId internally
    void epochId;
    const kLocalPubkeyBytes = Buffer.from(kLocalPubkeyHex, "hex");
    let dkgPrimaryPubkeyHex: string;
    try {
      const dkgResult = await runNetworkDkg(kLocalPubkeyBytes, {
        threshold,
        participants,
        directoryNodes: [dirNode],
      });
      dkgPrimaryPubkeyHex = Buffer.from(dkgResult.primaryPubkey).toString("hex");
      // Store the threshold signer so ceremony_request frames can be handled.
      // The signer holds the client's local FROST share and the directory as a stub.
      this.#thresholdSigner = dkgResult.signer;
      // SESSION-005: update primary_pubkey so seal verification uses the DKG-derived key.
      this.#myPrimaryPubkey = new Uint8Array(dkgResult.primaryPubkey);
    } catch {
      return { error: "dkg_failed" };
    }

    // Step 5c: send dkg_complete with the agreed primary_pubkey
    const dkgCompleteFrame = CBOR_ENC.encode({
      type: "dkg_complete",
      primary_pubkey: dkgPrimaryPubkeyHex,
    }) as Uint8Array;
    this.#persistentSignalingStream.send(lp.encode.single(dkgCompleteFrame));

    // Step 6: await register_success or register_error (routed by #runPersistentSignalingReader)
    const REGISTER_TIMEOUT_MS = 15_000;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const responseWithTimeout = await Promise.race<Record<string, unknown>>([
      new Promise<Record<string, unknown>>((resolve) => {
        this.#pendingRegisterResolve = resolve;
      }),
      new Promise<Record<string, unknown>>((resolve) => {
        timeoutHandle = setTimeout(() => {
          this.#pendingRegisterResolve = null;
          resolve({ type: "register_error", reason: "timeout" });
        }, REGISTER_TIMEOUT_MS);
      }),
    ]);
    clearTimeout(timeoutHandle);

    if (responseWithTimeout["type"] !== "register_success") {
      const reason = (responseWithTimeout["reason"] as string | undefined) ?? "unknown";
      // already_registered: directory persisted the profile from a prior session.
      // Reconstruct RegistrationState from the profile data included in the error frame
      // so the agent can continue without a new DKG ceremony.
      if (
        reason === "already_registered" &&
        responseWithTimeout["agent_id"] &&
        responseWithTimeout["primary_pubkey"]
      ) {
        const state: RegistrationState = {
          agent_id: responseWithTimeout["agent_id"] as string,
          primary_pubkey: responseWithTimeout["primary_pubkey"] as string,
          ml_dsa_pubkey: (responseWithTimeout["ml_dsa_pubkey"] as string | undefined) ?? mlDsaPubkeyHex,
          registered_at: Date.now(),
          status: "active",
        };
        this.#registrationState = state;
        this.#mlDsaProvider = mlDsaProvider;
        return state;
      }
      return { error: reason };
    }

    // Step 7: build RegistrationState and cache
    const agentId = responseWithTimeout["agent_id"] as string;
    const primaryPubkey = responseWithTimeout["primary_pubkey"] as string;

    const state: RegistrationState = {
      agent_id: agentId,
      primary_pubkey: primaryPubkey,
      ml_dsa_pubkey: mlDsaPubkeyHex,
      registered_at: Date.now(),
      status: "active",
    };
    this.#registrationState = state;
    // Store the ML-DSA key provider so MCP tools can build ConnectionPackages (CELLO-MCP-003).
    this.#mlDsaProvider = mlDsaProvider;
    return state;
  }

  async #handleInbound(stream: Stream): Promise<void> {
    // Read one LP frame, with a 5s wall-clock timeout as a safety net.
    // DecoderOptions has no signal field — timeout is enforced by racing the
    // read promise against a timer that aborts the stream externally.
    let payload: Uint8Array | undefined;
    let timeoutFired = false;

    const readFrame = async (): Promise<void> => {
      for await (const chunk of lp.decode(stream)) {
        payload = (chunk as unknown as { slice(): Uint8Array }).slice();
        return; // got one frame
      }
    };

    let timerId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((_, reject) => {
      timerId = setTimeout(() => {
        timeoutFired = true;
        reject(new Error("truncated_frame: read timeout"));
      }, 5_000);
    });

    try {
      await Promise.race([readFrame(), timeout]);
      clearTimeout(timerId);
    } catch {
      clearTimeout(timerId);
      stream.abort(new Error(timeoutFired ? "truncated_frame: read timeout" : "truncated_frame: stream error"));
      return;
    }

    if (!payload) {
      stream.abort(new Error("truncated_frame: no frame received"));
      return;
    }

    // CBOR parse
    const deserResult = deserializeEnvelope(payload);
    if (!deserResult.ok) {
      stream.abort(new Error(`malformed_envelope: ${deserResult.error.reason}`));
      return;
    }

    // Full validation: struct → content_hash recompute → signature
    const validateResult = validateEnvelope(deserResult.envelope);
    if (!validateResult.ok) {
      stream.abort(new Error(`validation_failed: ${validateResult.error.reason}`));
      return;
    }

    // Enqueue
    const senderHex = Buffer.from(deserResult.envelope.sender_pubkey).toString("hex");
    const received: ReceivedEnvelope = {
      content: deserResult.envelope.content,
      senderPubkey: deserResult.envelope.sender_pubkey,
      contentHash: deserResult.envelope.content_hash,
      timestamp: deserResult.envelope.timestamp,
    };

    if (!this.#receiveQueues.has(senderHex)) {
      this.#receiveQueues.set(senderHex, []);
    }
    this.#receiveQueues.get(senderHex)!.push(received);
    this.#arrivalLog.push({ senderPubkeyHex: senderHex, envelope: received });
    this.#onMessageQueued?.(senderHex);

    // Clean close — signals delivered:true to sender
    await stream.close().catch(() => {});
  }

  receive(senderPubkeyHex: string): ReceivedEnvelope | null {
    const queue = this.#receiveQueues.get(senderPubkeyHex);
    if (!queue || queue.length === 0) return null;
    return queue.shift()!;
  }

  peekAll(): Array<{ senderPubkeyHex: string; envelope: ReceivedEnvelope }> {
    return [...this.#arrivalLog];
  }

  onSessionAssignment(handler: (event: SessionAssignmentEvent) => void): void {
    this.#onSessionAssignmentHandler = handler;
  }

  // ─── CONNREQ-002: Connection methods ──────────────────────────────────────────

  /**
   * Register a handler for connection_established events.
   * CONNREQ-002: fires on both the sender and the target when a connection is created.
   */
  onConnectionEstablished(handler: (event: import("@cello/protocol-types").ConnectionEstablished) => void): void {
    this.#onConnectionEstablishedHandler = handler;
  }

  /**
   * Register a handler for disclosure_request_inbound events (Round 2 notification for sender).
   * CONNREQ-002: fires on the sender when the target requests more disclosure.
   */
  onDisclosureRequested(handler: (event: import("@cello/protocol-types").DisclosureRequestInbound) => void): void {
    this.#onDisclosureRequestedHandler = handler;
  }

  /**
   * Return all active connection records for this client.
   * CONNREQ-002: used by the MCP tool layer and tests.
   */
  listConnections(): import("@cello/protocol-types").ClientConnectionRecord[] {
    return [...this.#connections.values()];
  }

  /**
   * Return the cached registration state, or null if not yet registered.
   * CELLO-MCP-003.
   */
  getRegistrationState(): import("@cello/protocol-types").RegistrationState | null {
    return this.#registrationState;
  }

  /**
   * Return the ML-DSA key provider stored after successful register(), or null.
   * Used by the MCP server to build ConnectionPackages. CELLO-MCP-003.
   * SI-001: This returns the key PROVIDER (sign/getPublicKey), not raw secret bytes.
   */
  getMlDsaProvider(): import("@cello/crypto").MlDsaKeyProvider | null {
    return this.#mlDsaProvider;
  }

  /**
   * Set the connection policy. Replaces any previously configured policy.
   * CELLO-MCP-003.
   */
  setPolicy(policy: import("./connection-policy.js").SignalRequirementPolicy): void {
    this.#connectionPolicy = policy;
  }

  /**
   * Return the current connection policy. Returns default open/deterministic if none configured.
   * CELLO-MCP-003.
   */
  getPolicy(): import("./connection-policy.js").SignalRequirementPolicy {
    return this.#connectionPolicy ?? { mode: "open", review_mode: "deterministic", requirements: [] };
  }

  /** Return the configured directory peer ID, or null if no directory endpoint was provided. */
  getDirectoryPeerId(): string | null {
    return this.#directoryEndpoint?.peer_id ?? null;
  }

  /**
   * Check if a connection exists with the given counterparty pubkey.
   * Returns the connection_id if found, null otherwise.
   * CELLO-MCP-003.
   */
  hasConnection(counterpartyPubkeyHex: string): string | null {
    return this.#connectionsByPeer.get(counterpartyPubkeyHex) ?? null;
  }

  /**
   * Accept a pending inbound connection request (inference review mode).
   * Sends connection_response { verdict: 'accept' } to the directory.
   * The directory then pushes connection_established to both parties.
   * CELLO-MCP-003.
   */
  async acceptConnection(connectionRequestId: string): Promise<
    | { accepted: true; connection_id: string }
    | { error: { reason: "no_pending_request" | "already_decided" } }
  > {
    const pending = this.#pendingInboundRequests.get(connectionRequestId);
    if (!pending) {
      if (this.#decidedRequests.has(connectionRequestId)) {
        return { error: { reason: "already_decided" } };
      }
      return { error: { reason: "no_pending_request" } };
    }
    if (this.#decidedRequests.has(connectionRequestId)) {
      return { error: { reason: "already_decided" } };
    }

    // Mark as decided before sending to prevent races
    this.#decidedRequests.add(connectionRequestId);
    this.#pendingInboundRequests.delete(connectionRequestId);

    if (!this.#persistentSignalingStream) {
      // Stream gone — still mark as decided
      return { error: { reason: "no_pending_request" } };
    }

    const responseFrame = CBOR_ENC.encode({
      type: "connection_response",
      connection_request_id: connectionRequestId,
      verdict: "accept",
    }) as Uint8Array;

    try {
      this.#persistentSignalingStream.send(lp.encode.single(responseFrame));
    } catch {
      return { error: { reason: "no_pending_request" } };
    }

    // Wait for connection_established to arrive via the signaling reader loop.
    // The signaling reader will store the connection record and fire onConnectionEstablished.
    // Poll #connections until the connection appears (or timeout).
    const deadline = Date.now() + this.#connectionTimeoutMs;
    while (Date.now() < deadline) {
      const connectionId = this.#connectionsByPeer.get(pending.from_pubkey);
      if (connectionId) {
        return { accepted: true, connection_id: connectionId };
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await new Promise<void>((resolve) => setTimeout(resolve, Math.min(20, remaining)));
    }

    return { error: { reason: "no_pending_request" } };
  }

  /**
   * Reject a pending inbound connection request (inference review mode).
   * Sends connection_response { verdict: 'reject' } to the directory.
   * CELLO-MCP-003.
   */
  async rejectConnection(connectionRequestId: string, reason?: string): Promise<
    | { rejected: true }
    | { error: { reason: "no_pending_request" | "already_decided" } }
  > {
    const pending = this.#pendingInboundRequests.get(connectionRequestId);
    if (!pending) {
      if (this.#decidedRequests.has(connectionRequestId)) {
        return { error: { reason: "already_decided" } };
      }
      return { error: { reason: "no_pending_request" } };
    }
    if (this.#decidedRequests.has(connectionRequestId)) {
      return { error: { reason: "already_decided" } };
    }

    // Mark as decided
    this.#decidedRequests.add(connectionRequestId);
    this.#pendingInboundRequests.delete(connectionRequestId);

    if (!this.#persistentSignalingStream) {
      return { rejected: true };
    }

    const payload: Record<string, unknown> = {
      type: "connection_response",
      connection_request_id: connectionRequestId,
      verdict: "reject",
    };
    if (reason !== undefined) payload["reason"] = reason;

    const responseFrame = CBOR_ENC.encode(payload) as Uint8Array;
    try {
      this.#persistentSignalingStream.send(lp.encode.single(responseFrame));
    } catch { /* stream closed */ }

    return { rejected: true };
  }

  /**
   * Request more disclosure from sender (Round 2 initiation by target).
   * Only valid when in Round 1 pending state.
   * CELLO-MCP-003.
   */
  async requestMoreDisclosure(connectionRequestId: string, requestedItems: unknown[]): Promise<
    | { request_sent: true }
    | { error: { reason: "no_pending_request" | "already_decided" | "max_rounds_reached" } }
  > {
    const pending = this.#pendingInboundRequests.get(connectionRequestId);
    if (!pending) {
      if (this.#decidedRequests.has(connectionRequestId)) {
        return { error: { reason: "already_decided" } };
      }
      return { error: { reason: "no_pending_request" } };
    }
    if (this.#decidedRequests.has(connectionRequestId)) {
      return { error: { reason: "already_decided" } };
    }
    if (pending.round >= 2) {
      return { error: { reason: "max_rounds_reached" } };
    }

    // Advance to Round 2
    pending.round = 2;

    if (!this.#persistentSignalingStream) {
      return { error: { reason: "no_pending_request" } };
    }

    const disclosureFrame = CBOR_ENC.encode({
      type: "disclosure_request",
      connection_request_id: connectionRequestId,
      requested_items: requestedItems,
    }) as Uint8Array;

    try {
      this.#persistentSignalingStream.send(lp.encode.single(disclosureFrame));
    } catch {
      return { error: { reason: "no_pending_request" } };
    }

    return { request_sent: true };
  }

  /**
   * Block until an inbound connection request arrives for agent review,
   * or until timeoutMs elapses. CELLO-MCP-003.
   *
   * CONNREQ-003: Supports multiple concurrent callers via Promise queue
   * (#pendingAwaitConnectionRequestResolvers). Each caller gets its own Promise.
   * When a new inbound request arrives, the first waiting resolver is called (FIFO).
   * If #pendingReviewQueue already has items, the caller returns immediately.
   *
   * Pseudocode (Phase P):
   *   1. if #pendingReviewQueue.length > 0: shift item and return immediately
   *   2. create Promise with timeout
   *   3. push resolve fn to #pendingAwaitConnectionRequestResolvers
   *   4. await Promise.race([itemArrived, timeout])
   *   5. on arrival: return pending_review ; on timeout: return { type: 'timeout' }
   */
  async awaitConnectionRequest(timeoutMs = 30_000): Promise<
    | {
        type: "pending_review";
        connection_request_id: string;
        from_pubkey: string;
        report: Extract<import("./connection-policy.js").ConnectionReport, { verdict: "pending_agent_review" }>;
      }
    | { type: "timeout" }
  > {
    // Fast path: if items already queued, return immediately (no Promise overhead)
    if (this.#pendingReviewQueue.length > 0) {
      const item = this.#pendingReviewQueue.shift()!;
      return {
        type: "pending_review",
        connection_request_id: item.connection_request_id,
        from_pubkey: item.from_pubkey,
        report: item.report,
      };
    }

    // CONNREQ-003: multi-slot await via Promise queue.
    // Each caller registers its resolve fn; when an inbound request arrives,
    // #handleInboundConnectionRequest calls the first waiting resolver (FIFO).
    type AwaitItem = {
      connection_request_id: string;
      from_pubkey: string;
      report: Extract<import("./connection-policy.js").ConnectionReport, { verdict: "pending_agent_review" }>;
    };

    let resolveItem!: (item: AwaitItem) => void;
    const itemPromise = new Promise<AwaitItem>((resolve) => {
      resolveItem = resolve;
    });
    this.#pendingAwaitConnectionRequestResolvers.push(resolveItem);

    const result: { item: AwaitItem | null } = { item: null };
    let timedOut = false;
    await Promise.race([
      itemPromise.then((i) => { result.item = i; }),
      new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, timeoutMs)),
    ]);

    // On timeout: remove our resolver from the queue if it hasn't been consumed yet
    if (timedOut) {
      const idx = this.#pendingAwaitConnectionRequestResolvers.indexOf(resolveItem);
      if (idx !== -1) {
        this.#pendingAwaitConnectionRequestResolvers.splice(idx, 1);
      }
      return { type: "timeout" };
    }

    const item = result.item;
    if (!item) {
      return { type: "timeout" };
    }

    return {
      type: "pending_review",
      connection_request_id: item.connection_request_id,
      from_pubkey: item.from_pubkey,
      report: item.report,
    };
  }

  /**
   * Send a connection_request to target B and wait for a final outcome.
   * Returns:
   *   { result: 'established', connection_id } — connection created
   *   { result: 'rejected', reason } — target rejected
   *   { result: 'insufficient', unmet_requirements } — target found requirements unmet
   *   { result: 'disclosure_requested', connection_request_id, requested_items } — Round 2 request (unblocks sender)
   *   { result: 'timeout' } — no response within connectionTimeoutMs
   *   { result: 'error', reason } — directory-level error (not_registered, target_not_found, etc.)
   */
  async cello_request_connection(opts: {
    target_pubkey: string;
    package_cbor: Uint8Array;
  }): Promise<
    | { result: "established"; connection_id: string }
    | { result: "rejected"; reason: string }
    | { result: "insufficient"; unmet_requirements: unknown[] }
    | { result: "disclosure_requested"; connection_request_id: string; requested_items: unknown[] }
    | { result: "timeout" }
    | { result: "error"; reason: string }
  > {
    const targetPubkeyHex = opts.target_pubkey;

    // CONNREQ-003 AC-002: reject duplicate concurrent requests to same target immediately.
    // A second call for the same target while the first is still in flight would overwrite
    // the first resolver, losing it. Instead, return an error immediately.
    if (this.#pendingConnectionRequestResolvers.has(targetPubkeyHex)) {
      this.#logger.warn("connection.request.duplicate", { targetPubkeyHex });
      return { result: "error", reason: "connection_request_in_flight" };
    }

    // CONNREQ-003: Reserve this target's slot in the map BEFORE any async work.
    // This is the earliest possible moment — before stream-open and before the
    // frame is sent — so that a concurrent duplicate call (AC-002) is rejected
    // even if the stream open is still in progress.
    let resolveOutcome!: (result: Record<string, unknown>) => void;
    const outcomePromise = new Promise<Record<string, unknown>>((resolve) => {
      resolveOutcome = resolve;
    });
    this.#pendingConnectionRequestResolvers.set(targetPubkeyHex, resolveOutcome);

    // Ensure the persistent signaling stream is open
    if (!this.#persistentSignalingStream) {
      const opened = await this.#openPersistentSignalingStream();
      if (!opened) {
        this.#pendingConnectionRequestResolvers.delete(targetPubkeyHex);
        return { result: "error", reason: "directory_unreachable" };
      }
    }

    // Mint a correlationId for this outbound connection request flow.
    // Threaded through all log events in this flow (CONNREQ-003 observability ACs).
    const correlationId = `connreq-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

    this.#logger.info("connection.request.sent", { targetPubkeyHex, correlationId });

    // Build the frame
    const frameBytes = CBOR_ENC.encode({
      type: "connection_request",
      target_pubkey: targetPubkeyHex,
      package_cbor: opts.package_cbor,
    }) as Uint8Array;

    try {
      this.#persistentSignalingStream!.send(lp.encode.single(frameBytes));
    } catch {
      this.#pendingConnectionRequestResolvers.delete(targetPubkeyHex);
      return { result: "error", reason: "directory_unreachable" };
    }

    // Race: outcome vs connectionTimeoutMs
    // DB-001: timeout cleans this slot without affecting concurrent requests to other targets.
    let frame: Record<string, unknown> | null = null;
    let timedOut = false;
    await Promise.race([
      outcomePromise.then((f) => { frame = f; }),
      new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, this.#connectionTimeoutMs)),
    ]);

    // Clean up this target's resolver slot on timeout
    // (on successful resolution, the signaling reader already deleted it)
    if (this.#pendingConnectionRequestResolvers.get(targetPubkeyHex) === resolveOutcome) {
      this.#pendingConnectionRequestResolvers.delete(targetPubkeyHex);
    }

    if (timedOut || !frame) {
      return { result: "timeout" };
    }

    const type = frame["type"] as string;

    if (type === "connection_established") {
      const connectionId = frame["connection_id"] as string;
      const counterpartyPubkey = frame["counterparty_pubkey"] as string;
      // Store connection record locally
      const record: import("@cello/protocol-types").ClientConnectionRecord = {
        connection_id: connectionId,
        counterparty_pubkey: counterpartyPubkey,
        counterparty_primary_pubkey: "",
        counterparty_ml_dsa_pubkey: "",
        established_at: Date.now(),
        status: "active",
      };
      this.#connections.set(connectionId, record);
      this.#connectionsByPeer.set(counterpartyPubkey, connectionId);
      this.#logger.info("connection.established", {
        connectionId,
        counterpartyPubkeyHex: counterpartyPubkey,
        correlationId,
      });
      return { result: "established", connection_id: connectionId };
    }

    if (type === "connection_rejected") {
      return { result: "rejected", reason: (frame["reason"] as string) ?? "rejected" };
    }

    if (type === "connection_insufficient") {
      return { result: "insufficient", unmet_requirements: (frame["unmet_requirements"] as unknown[]) ?? [] };
    }

    if (type === "connection_request_error") {
      const reason = (frame["reason"] as string) ?? "unknown";
      // already_connected: hydrate the existing connection so the caller can proceed.
      if (reason === "already_connected" && frame["connection_id"]) {
        const connectionId = frame["connection_id"] as string;
        if (!this.#connections.has(connectionId)) {
          const record: import("@cello/protocol-types").ClientConnectionRecord = {
            connection_id: connectionId,
            counterparty_pubkey: targetPubkeyHex,
            counterparty_primary_pubkey: "",
            counterparty_ml_dsa_pubkey: "",
            established_at: Date.now(),
            status: "active",
          };
          this.#connections.set(connectionId, record);
          this.#connectionsByPeer.set(targetPubkeyHex, connectionId);
        }
        this.#logger.info("connection.established", {
          connectionId,
          counterpartyPubkeyHex: targetPubkeyHex,
          correlationId,
        });
        return { result: "established", connection_id: connectionId };
      }
      this.#logger.error("connection.request.failed", { targetPubkeyHex, reason, correlationId });
      return { result: "error", reason };
    }

    if (type === "disclosure_request_inbound") {
      return {
        result: "disclosure_requested",
        connection_request_id: frame["connection_request_id"] as string,
        requested_items: (frame["requested_items"] as unknown[]) ?? [],
      };
    }

    return { result: "error", reason: "unknown" };
  }

  /**
   * Respond to a disclosure request from the target (Round 2 sender side).
   * Called after cello_request_connection returns { result: 'disclosure_requested' }.
   * Sends disclosure_response and waits for the final connection outcome.
   */
  async cello_respond_to_disclosure_request(opts: {
    connection_request_id: string;
    package_cbor: Uint8Array;
  }): Promise<
    | { result: "established"; connection_id: string }
    | { result: "rejected"; reason: string }
    | { result: "insufficient"; unmet_requirements: unknown[] }
    | { result: "timeout" }
    | { result: "error"; reason: string }
  > {
    if (!this.#persistentSignalingStream) {
      return { result: "error", reason: "directory_unreachable" };
    }

    const frameBytes = CBOR_ENC.encode({
      type: "disclosure_response",
      connection_request_id: opts.connection_request_id,
      package_cbor: opts.package_cbor,
    }) as Uint8Array;

    let resolveOutcome!: (result: Record<string, unknown>) => void;
    const outcomePromise = new Promise<Record<string, unknown>>((resolve) => {
      resolveOutcome = resolve;
    });
    this.#pendingDisclosureResolvers.set(opts.connection_request_id, resolveOutcome);

    try {
      this.#persistentSignalingStream!.send(lp.encode.single(frameBytes));
    } catch {
      this.#pendingDisclosureResolvers.delete(opts.connection_request_id);
      return { result: "error", reason: "directory_unreachable" };
    }

    let frame: Record<string, unknown> | null = null;
    let timedOut = false;
    await Promise.race([
      outcomePromise.then((f) => { frame = f; }),
      new Promise<void>((resolve) => setTimeout(() => { timedOut = true; resolve(); }, this.#connectionTimeoutMs)),
    ]);

    this.#pendingDisclosureResolvers.delete(opts.connection_request_id);

    if (timedOut || !frame) {
      return { result: "timeout" };
    }

    const type = frame["type"] as string;

    if (type === "connection_established") {
      const connectionId = frame["connection_id"] as string;
      const counterpartyPubkey = frame["counterparty_pubkey"] as string;
      const record: import("@cello/protocol-types").ClientConnectionRecord = {
        connection_id: connectionId,
        counterparty_pubkey: counterpartyPubkey,
        counterparty_primary_pubkey: "",
        counterparty_ml_dsa_pubkey: "",
        established_at: Date.now(),
        status: "active",
      };
      this.#connections.set(connectionId, record);
      this.#connectionsByPeer.set(counterpartyPubkey, connectionId);
      return { result: "established", connection_id: connectionId };
    }

    if (type === "connection_rejected") {
      return { result: "rejected", reason: (frame["reason"] as string) ?? "rejected" };
    }

    if (type === "connection_insufficient") {
      return { result: "insufficient", unmet_requirements: (frame["unmet_requirements"] as unknown[]) ?? [] };
    }

    return { result: "error", reason: "unknown" };
  }

  /**
   * Request more disclosure from the sender (Round 2, target side).
   * Returns { error: 'max_rounds_reached' } if Round 2 is already in flight.
   */
  async cello_request_more_disclosure(opts: {
    connection_request_id: string;
    requested_items: unknown[];
  }): Promise<{ error: "max_rounds_reached" } | { ok: true }> {
    const pending = this.#pendingInboundRequests.get(opts.connection_request_id);
    if (!pending) {
      return { error: "max_rounds_reached" }; // no such request or already completed
    }
    if (pending.round >= 2) {
      return { error: "max_rounds_reached" };
    }

    // Advance to Round 2 state
    pending.round = 2;

    if (!this.#persistentSignalingStream) {
      return { error: "max_rounds_reached" }; // stream gone
    }

    const frameBytes = CBOR_ENC.encode({
      type: "disclosure_request",
      connection_request_id: opts.connection_request_id,
      requested_items: opts.requested_items,
    }) as Uint8Array;

    try {
      this.#persistentSignalingStream.send(lp.encode.single(frameBytes));
    } catch {
      return { error: "max_rounds_reached" };
    }

    return { ok: true };
  }

  /**
   * Reconnect the persistent directory signaling stream and re-authenticate.
   * Called after a client reconnects and wants the directory to deliver queued
   * connection requests (CONNREQ-002 DB-001).
   */
  async reconnectDirectory(): Promise<boolean> {
    // Clear existing stream state to force a re-open
    if (this.#persistentSignalingStream) {
      try { this.#persistentSignalingStream.abort(new Error("reconnect")); } catch {}
      this.#persistentSignalingStream = null;
      this.#persistentSignalingIter = null;
    }
    const opened = await this.#openPersistentSignalingStream();
    return opened;
  }

  /**
   * TEST-ONLY escape hatch: inject a pending inbound connection request into state.
   * Used by AC-010 to test max_rounds_reached without going through the full flow.
   */
  _injectPendingConnectionRequest(opts: {
    connection_request_id: string;
    from_pubkey: string;
    package_cbor: Uint8Array;
    round: number;
  }): void {
    this.#pendingInboundRequests.set(opts.connection_request_id, {
      connection_request_id: opts.connection_request_id,
      from_pubkey: opts.from_pubkey,
      package_cbor: opts.package_cbor,
      round: opts.round,
    });
  }

  /**
   * CONNREQ-003 TEST-ONLY escape hatch: route a synthetic connection outcome frame
   * through the same resolver logic as the signaling stream reader.
   *
   * Used by SI-001 adversarial test to inject a connection_established frame for
   * target B while C's resolver is still pending, verifying that B's frame does NOT
   * resolve C's resolver (Map-keyed routing isolation guarantee).
   *
   * Accepts the same frame types that the signaling reader handles for connection
   * outcomes: connection_established, connection_rejected, connection_insufficient,
   * connection_request_error, disclosure_request_inbound.
   *
   * Does not store a connection record (connection_established frames injected in
   * tests bypass the full connection lifecycle — they test resolver routing only).
   */
  _injectConnectionFrame(frame: Record<string, unknown>): void {
    const type = frame["type"] as string;
    if (type === "connection_established") {
      const counterpartyPubkey = frame["counterparty_pubkey"] as string;
      const resolve = this.#pendingConnectionRequestResolvers.get(counterpartyPubkey);
      if (resolve) {
        this.#pendingConnectionRequestResolvers.delete(counterpartyPubkey);
        resolve(frame);
      }
    } else if (type === "disclosure_request_inbound") {
      const targetPubkeyForDisclosure = frame["from_pubkey"] as string;
      const resolve = this.#pendingConnectionRequestResolvers.get(targetPubkeyForDisclosure);
      if (resolve) {
        this.#pendingConnectionRequestResolvers.delete(targetPubkeyForDisclosure);
        resolve(frame);
      }
    } else {
      // connection_rejected, connection_insufficient, connection_request_error
      const targetPubkeyForError = frame["target_pubkey"] as string | undefined;
      if (targetPubkeyForError && this.#pendingConnectionRequestResolvers.has(targetPubkeyForError)) {
        const resolve = this.#pendingConnectionRequestResolvers.get(targetPubkeyForError)!;
        this.#pendingConnectionRequestResolvers.delete(targetPubkeyForError);
        resolve(frame);
      } else if (this.#pendingConnectionRequestResolvers.size === 1) {
        const [singleKey, singleResolve] = this.#pendingConnectionRequestResolvers.entries().next().value as [string, (frame: Record<string, unknown>) => void];
        this.#pendingConnectionRequestResolvers.delete(singleKey);
        singleResolve(frame);
      }
    }
  }

  // ─── CONNREQ-002: B-side inbound request handler ─────────────────────────────

  /**
   * Handle an inbound connection_request_inbound frame (B's side).
   * CONNREQ-002 pseudocode (connection-request.ts story):
   *   1. Check whitelist — if sender whitelisted, accept without policy evaluation
   *   2. Decode + validate the ConnectionPackage (decodeConnectionPackage + validateConnectionPackage)
   *   3. Build DirectoryContext from the frame-provided sender_registered_at / sender_is_provisional
   *   4. Call evaluateConnectionPackage (increment _evaluateCallCount if trackEvaluateCount)
   *   5a. auto_accept → send connection_response { verdict: 'accept' }
   *   5b. auto_reject → send connection_response { verdict: 'reject', reason }
   *   5c. auto_insufficient → send connection_response { verdict: 'insufficient', unmet_requirements }
   *   5d. pending_agent_review → fire onConnectionPendingReview handler; store in #pendingInboundRequests;
   *       optionally start round2TimeoutMs timer that auto-rejects on expiry
   */
  async #handleInboundConnectionRequest(frame: Record<string, unknown>): Promise<void> {
    if (!this.#persistentSignalingStream) return;

    const connectionRequestId = frame["connection_request_id"] as string;
    const fromPubkey = frame["from_pubkey"] as string;
    const packageCborRaw = frame["package_cbor"];
    const packageCbor = packageCborRaw instanceof Uint8Array ? packageCborRaw
      : Buffer.isBuffer(packageCborRaw) ? new Uint8Array(packageCborRaw as Buffer) : null;

    if (!connectionRequestId || !fromPubkey || !packageCbor) return;

    const senderRegisteredAt = typeof frame["sender_registered_at"] === "number"
      ? frame["sender_registered_at"] : 0;
    const senderIsProvisional = frame["sender_is_provisional"] === true;

    let verdict: "accept" | "reject" | "insufficient" = "reject";
    let rejectReason: string | undefined;
    let unmetRequirements: unknown[] | undefined;

    const isWhitelisted = this.#whitelist.includes(fromPubkey);

    if (isWhitelisted) {
      verdict = "accept";
    } else if (!this.#connectionPolicy) {
      // No policy configured — default to accept
      verdict = "accept";
    } else {
      // Decode and validate the package
      let pkg;
      try {
        pkg = decodeConnectionPackage(packageCbor);
      } catch {
        verdict = "reject";
        rejectReason = "package_decode_failed";
        pkg = null;
      }

      if (pkg !== null) {
        const fromPubkeyBytes = Buffer.from(fromPubkey, "hex");
        const validatedPackage = validateConnectionPackage(
          pkg,
          fromPubkeyBytes,
          Date.now(),
          mlDsaVerify,
        );

        if (!validatedPackage.valid) {
          verdict = "reject";
          rejectReason = validatedPackage.reason;
        } else {
        const context: import("@cello/protocol-types").DirectoryContext = {
          registered_at: senderRegisteredAt,
          is_provisional: senderIsProvisional,
          conversation_count: 0,
          clean_close_rate: 0,
        };

        if (this.#trackEvaluateCount) {
          this._evaluateCallCount++;
        }

        const { evaluateConnectionPackage } = await import("./connection-policy.js");
        const report = evaluateConnectionPackage(
          validatedPackage,
          this.#connectionPolicy,
          context,
          Date.now(),
        );

        if (report.verdict === "auto_accept") {
          verdict = "accept";
        } else if (report.verdict === "auto_reject") {
          verdict = "reject";
          rejectReason = report.reason;
        } else if (report.verdict === "auto_insufficient") {
          if (this.#round2TimeoutMs > 0) {
            // Round 2 enabled: send disclosure_request to ask for more
            this.#pendingInboundRequests.set(connectionRequestId, {
              connection_request_id: connectionRequestId,
              from_pubkey: fromPubkey,
              package_cbor: packageCbor,
              round: 1,
            });
            const disclosureFrame = CBOR_ENC.encode({
              type: "disclosure_request",
              connection_request_id: connectionRequestId,
              requested_items: report.unmet_requirements.map((u) => ({
                type: u.signal_type,
                condition: u.condition,
              })),
            }) as Uint8Array;
            try {
              this.#persistentSignalingStream!.send(lp.encode.single(disclosureFrame));
            } catch { /* stream closed */ }
            setTimeout(() => {
              const stillPending = this.#pendingInboundRequests.get(connectionRequestId);
              if (stillPending) {
                this.#pendingInboundRequests.delete(connectionRequestId);
                if (this.#persistentSignalingStream) {
                  const timeoutFrame = CBOR_ENC.encode({
                    type: "connection_response",
                    connection_request_id: connectionRequestId,
                    verdict: "reject",
                    reason: "disclosure_timeout",
                  }) as Uint8Array;
                  try {
                    this.#persistentSignalingStream.send(lp.encode.single(timeoutFrame));
                  } catch { /* stream closed */ }
                }
              }
            }, this.#round2TimeoutMs);
            return;
          }
          verdict = "insufficient";
          unmetRequirements = report.unmet_requirements;
        } else {
          // pending_agent_review: store for agent review and fire callback
          this.#pendingInboundRequests.set(connectionRequestId, {
            connection_request_id: connectionRequestId,
            from_pubkey: fromPubkey,
            package_cbor: packageCbor,
            round: 1,
          });

          const reviewItem = {
            connection_request_id: connectionRequestId,
            from_pubkey: fromPubkey,
            report,
            package_cbor: packageCbor,
            sender_registered_at: senderRegisteredAt,
            sender_is_provisional: senderIsProvisional,
          };

          // CONNREQ-003: Deliver to the first waiting awaitConnectionRequest() caller (FIFO),
          // or enqueue in #pendingReviewQueue if no callers are waiting.
          const awaitResolver = this.#pendingAwaitConnectionRequestResolvers.shift();
          if (awaitResolver) {
            // Direct delivery to waiting caller — do not add to #pendingReviewQueue
            awaitResolver({
              connection_request_id: connectionRequestId,
              from_pubkey: fromPubkey,
              report,
            });
          } else {
            // No caller waiting — enqueue for future awaitConnectionRequest() poll
            this.#pendingReviewQueue.push(reviewItem);
          }

          if (this.#onConnectionPendingReview) {
            this.#onConnectionPendingReview({
              type: "connection_request_inbound",
              from_pubkey: fromPubkey,
              connection_request_id: connectionRequestId,
              package_cbor: packageCbor,
              sender_registered_at: senderRegisteredAt,
              sender_is_provisional: senderIsProvisional,
            });
          }

          // Start round2TimeoutMs auto-reject timer
          if (this.#round2TimeoutMs > 0) {
            setTimeout(() => {
              const stillPending = this.#pendingInboundRequests.get(connectionRequestId);
              if (stillPending) {
                this.#pendingInboundRequests.delete(connectionRequestId);
                if (this.#persistentSignalingStream) {
                  const responseFrame = CBOR_ENC.encode({
                    type: "connection_response",
                    connection_request_id: connectionRequestId,
                    verdict: "reject",
                    reason: "disclosure_timeout",
                  }) as Uint8Array;
                  try {
                    this.#persistentSignalingStream.send(lp.encode.single(responseFrame));
                  } catch { /* stream closed */ }
                }
              }
            }, this.#round2TimeoutMs);
          }
          return; // do not send a connection_response yet
        }
        } // end of validatedPackage.valid else-branch
      } else {
        // pkg was null (decode failed) — verdict/rejectReason already set above
      }
    }

    // DB-003: cross-check logic — mark as unchecked when enabled (profile-query not yet implemented)
    if (verdict === "accept" && this.#crossCheckDirectoryOnInbound) {
      this.#profileUncheckedPeers.add(fromPubkey);
    }

    // Send connection_response to directory
    const responsePayload: Record<string, unknown> = {
      type: "connection_response",
      connection_request_id: connectionRequestId,
      verdict,
    };
    if (rejectReason !== undefined) responsePayload["reason"] = rejectReason;
    if (unmetRequirements !== undefined) responsePayload["unmet_requirements"] = unmetRequirements;

    const responseFrame = CBOR_ENC.encode(responsePayload) as Uint8Array;
    try {
      this.#persistentSignalingStream.send(lp.encode.single(responseFrame));
    } catch { /* stream closed — response lost */ }
  }

  /**
   * Handle a disclosure_response_inbound frame (B's side, Round 2).
   * Re-evaluates the updated package and sends final connection_response.
   */
  async #handleDisclosureResponse(frame: Record<string, unknown>): Promise<void> {
    if (!this.#persistentSignalingStream) return;

    const connectionRequestId = frame["connection_request_id"] as string;
    const packageCborRaw = frame["package_cbor"];
    const packageCbor = packageCborRaw instanceof Uint8Array ? packageCborRaw
      : Buffer.isBuffer(packageCborRaw) ? new Uint8Array(packageCborRaw as Buffer) : null;

    if (!connectionRequestId || !packageCbor) return;

    const pending = this.#pendingInboundRequests.get(connectionRequestId);
    if (!pending) return; // stale — already handled or timed out

    this.#pendingInboundRequests.delete(connectionRequestId);

    const fromPubkey = pending.from_pubkey;

    let verdict: "accept" | "reject" | "insufficient" = "reject";
    let rejectReason: string | undefined;
    let unmetRequirements: unknown[] | undefined;

    if (!this.#connectionPolicy) {
      verdict = "accept";
    } else {
      let pkg;
      try {
        pkg = decodeConnectionPackage(packageCbor);
      } catch {
        verdict = "reject";
        rejectReason = "package_decode_failed";
        pkg = null;
      }

      if (pkg !== null) {
        const fromPubkeyBytes = Buffer.from(fromPubkey, "hex");
        const validatedPackage = validateConnectionPackage(
          pkg,
          fromPubkeyBytes,
          Date.now(),
          mlDsaVerify,
        );

        if (!validatedPackage.valid) {
          verdict = "reject";
          rejectReason = validatedPackage.reason;
        } else {
          const context: import("@cello/protocol-types").DirectoryContext = {
            registered_at: 0,
            is_provisional: false,
            conversation_count: 0,
            clean_close_rate: 0,
          };

          if (this.#trackEvaluateCount) {
            this._evaluateCallCount++;
          }

          const { evaluateConnectionPackage } = await import("./connection-policy.js");
          const report = evaluateConnectionPackage(
            validatedPackage,
            this.#connectionPolicy,
            context,
            Date.now(),
          );

          if (report.verdict === "auto_accept") {
            verdict = "accept";
          } else if (report.verdict === "auto_reject") {
            verdict = "reject";
            rejectReason = report.reason;
          } else if (report.verdict === "auto_insufficient") {
            verdict = "insufficient";
            unmetRequirements = report.unmet_requirements;
          } else {
            // pending_agent_review in Round 2 (inference mode) — surface for agent review with is_round_2: true.
            // Build a Round 2 report by cloning the Round 1 report shape with is_round_2: true.
            const round2Report = { ...report, is_round_2: true };
            this.#pendingInboundRequests.set(connectionRequestId, {
              connection_request_id: connectionRequestId,
              from_pubkey: fromPubkey,
              package_cbor: packageCbor,
              round: 2,
            });
            this.#pendingReviewQueue.push({
              connection_request_id: connectionRequestId,
              from_pubkey: fromPubkey,
              report: round2Report,
              package_cbor: packageCbor,
              sender_registered_at: 0,
              sender_is_provisional: false,
            });
            // No response yet — wait for agent to call accept/reject.
            return;
          }
        }
      } else {
        // pkg was null (decode failed) — verdict already set
      }
    }

    const responsePayload: Record<string, unknown> = {
      type: "connection_response",
      connection_request_id: connectionRequestId,
      verdict,
    };
    if (rejectReason !== undefined) responsePayload["reason"] = rejectReason;
    if (unmetRequirements !== undefined) responsePayload["unmet_requirements"] = unmetRequirements;

    const responseFrame = CBOR_ENC.encode(responsePayload) as Uint8Array;
    try {
      this.#persistentSignalingStream.send(lp.encode.single(responseFrame));
    } catch { /* stream closed */ }
  }

  // ─── ADAPTER-003: initiateSession ──────────────────────────────────────────

  /**
   * Send a `session_request` over the persistent directory signaling stream and await
   * the `session_assignment` or error response.
   *
   * PSEUDOCODE (Phase P — ADAPTER-003):
   *
   * initiateSession(targetPubkeyHex, opts):
   *   1. If no #directoryEndpoint configured → return { ok: false, reason: 'directory_unreachable' }
   *   2. Ensure #myPubkeyHex is set (read from keyProvider if not yet set)
   *   3. Open persistent signaling stream if not already open (DB-001: single retry on failure)
   *      If stream still cannot be opened → return { ok: false, reason: 'directory_unreachable' }
   *   4. Encode session_request frame inline using CBOR (no @cello/directory import):
   *        CBOR({ type: "session_request", target_pubkey: Buffer.from(targetPubkeyHex, 'hex') })
   *      SI-001: only target_pubkey, no extra fields, no key material
   *   5. Create response Promise:
   *        Create resolve fn, store in #pendingSessionRequestResolve
   *   6. Send frame on #persistentSignalingStream
   *   7. Race: response Promise vs timeout (opts.timeoutMs ?? DEFAULT_INITIATE_TIMEOUT_MS)
   *   8. On timeout:
   *        Clear #pendingSessionRequestResolve
   *        Return { ok: false, reason: 'timeout' }
   *   9. On session_request_error frame:
   *        reason = frame['reason'] ('target_offline' | 'relay_unavailable')
   *        Return { ok: false, reason }
   *  10. On session_assignment frame:
   *        Decode assignment fields from frame['assignment']
   *        Call receiveSessionAssignment(assignment, myPubkey)
   *        If ok:true → return { ok: true, sessionId, genesisPrevRoot }
   *        If ok:false → return { ok: false, reason: 'directory_unreachable' }
   *
   * SI-002: K_local private key never appears in frame, response, or log output.
   *         keyProvider.getPublicKey() returns only the public key.
   */
  async initiateSession(
    targetPubkeyHex: string,
    opts?: {
      /** Directory peer ID to connect to (overrides configured directoryEndpoint). */
      directoryPeerId?: string;
      /** Directory multiaddr for initial dial (overrides configured directoryEndpoint). */
      directoryMultiaddr?: string;
      /** Timeout in ms. Default: 30_000. */
      timeoutMs?: number;
    },
  ): Promise<InitiateSessionResult> {
    const timeoutMs = opts?.timeoutMs ?? DEFAULT_INITIATE_TIMEOUT_MS;

    // SESSION-006: check local connections map before touching the signaling stream.
    // If we have a connection policy configured (M3 mode), require a connection.
    // If no connection policy (M2 mode), skip the gate.
    const connectionId = this.#connectionsByPeer.get(targetPubkeyHex);
    if (this.#connectionPolicy !== undefined && !connectionId) {
      return { ok: false, reason: "no_connection" } as InitiateSessionResult;
    }

    if (!this.#directoryEndpoint && !opts?.directoryPeerId) {
      return { ok: false, reason: "directory_unreachable" };
    }

    // Ensure myPubkeyHex is set (needed for receiveSessionAssignment)
    if (!this.#myPubkeyHex) {
      const pubkey = await this.#keyProvider.getPublicKey();
      this.#myPubkeyHex = Buffer.from(pubkey).toString("hex");
    }
    const myPubkey = Buffer.from(this.#myPubkeyHex, "hex");

    // Open persistent signaling stream if not already open (DB-001)
    if (!this.#persistentSignalingStream) {
      const opened = await this.#openPersistentSignalingStream(opts?.directoryPeerId, opts?.directoryMultiaddr);
      if (!opened) {
        const retried = await this.#openPersistentSignalingStream(opts?.directoryPeerId, opts?.directoryMultiaddr);
        if (!retried) {
          return { ok: false, reason: "directory_unreachable" };
        }
      }
    }

    // SESSION-006: session_request frame includes connection_id if we have one
    // Encoded inline with raw CBOR — no import from @cello/directory
    const targetPubkeyBytes = Buffer.from(targetPubkeyHex, "hex");
    const sessionRequestPayload: Record<string, unknown> = {
      type: "session_request",
      target_pubkey: new Uint8Array(targetPubkeyBytes),
    };
    if (connectionId) {
      sessionRequestPayload["connection_id"] = connectionId;
    }
    const sessionRequestFrame = CBOR_ENC.encode(sessionRequestPayload) as Uint8Array;

    // Set up Promise that resolves when the directory responds
    let responseResolve!: (frame: Record<string, unknown>) => void;
    const responsePromise = new Promise<Record<string, unknown>>((resolve) => {
      responseResolve = resolve;
    });
    this.#pendingSessionRequestResolve = responseResolve;

    try {
      this.#persistentSignalingStream!.send(lp.encode.single(sessionRequestFrame));
    } catch {
      this.#pendingSessionRequestResolve = null;
      return { ok: false, reason: "directory_unreachable" };
    }

    // Race: directory response vs timeout
    let responseFrame: Record<string, unknown> | null = null;
    let timedOut = false;
    await Promise.race([
      responsePromise.then((f) => { responseFrame = f; }),
      new Promise<void>((resolve) =>
        setTimeout(() => { timedOut = true; resolve(); }, timeoutMs)
      ),
    ]);

    if (timedOut) {
      this.#pendingSessionRequestResolve = null;
      return { ok: false, reason: "timeout" };
    }

    const frame = responseFrame!;

    if (frame["type"] === "session_request_error") {
      const reason = frame["reason"];
      if (reason === "target_offline") return { ok: false, reason: "target_offline" };
      if (reason === "relay_unavailable") return { ok: false, reason: "relay_unavailable" };
      if (reason === "frost_signer_not_configured") return { ok: false, reason: "frost_signer_not_configured" };
      if (reason === "directory_below_threshold") return { ok: false, reason: "directory_below_threshold" };
      if (reason === "ceremony_conflict") return { ok: false, reason: "ceremony_conflict" };
      if (reason === "no_connection") return { ok: false, reason: "no_connection" };
      if (reason === "connection_id_required") return { ok: false, reason: "no_connection" };
      return { ok: false, reason: "directory_unreachable" };
    }

    if (frame["type"] === "session_assignment") {
      const rawAssignment = frame["assignment"] as Record<string, unknown> | undefined;
      if (!rawAssignment) return { ok: false, reason: "directory_unreachable" };

      const assignment = parseSessionAssignment(rawAssignment);
      if (!assignment) return { ok: false, reason: "directory_unreachable" };

      const result = await this.receiveSessionAssignment(assignment, myPubkey);
      if (!result.ok) {
        return { ok: false, reason: "directory_unreachable" };
      }

      const sessionIdHex = Buffer.from(result.sessionId).toString("hex");
      const record = this.#sessions.get(sessionIdHex);
      if (!record) return { ok: false, reason: "directory_unreachable" };

      return {
        ok: true,
        sessionId: result.sessionId,
        genesisPrevRoot: record.genesis_prev_root,
      };
    }

    return { ok: false, reason: "directory_unreachable" };
  }

  /**
   * Open and authenticate the persistent directory signaling stream.
   * Returns true on success, false on failure.
   * Serializes concurrent calls: if an open is already in flight, awaits it instead of
   * starting another.
   *
   * Auth protocol: "CELLO-DIR-AUTH-v1" challenge-response (same as session-level streams).
   * Signature: Ed25519(SHA-256("CELLO-DIR-AUTH-v1" || nonce || pubkey), privkey)
   *   per RFC 8032 (Ed25519), FIPS 180-4 (SHA-256)
   */
  #openPersistentSignalingStream(directoryPeerId?: string, directoryMultiaddr?: string): Promise<boolean> {
    // If stream is already open, nothing to do
    if (this.#persistentSignalingStream) return Promise.resolve(true);
    // If an open is already in flight, share its result
    if (this.#openingSignalingStream) return this.#openingSignalingStream;

    const p = this.#doOpenPersistentSignalingStream(directoryPeerId, directoryMultiaddr).finally(() => {
      if (this.#openingSignalingStream === p) {
        this.#openingSignalingStream = null;
      }
    });
    this.#openingSignalingStream = p;
    return p;
  }

  async #doOpenPersistentSignalingStream(directoryPeerId?: string, directoryMultiaddr?: string): Promise<boolean> {
    if (!this.#directoryEndpoint && !directoryPeerId) return false;
    if (this.#persistentSignalingStream) return true;

    const dirPeerId = directoryPeerId ?? this.#directoryEndpoint!.peer_id;
    const dirMultiaddr = directoryMultiaddr ?? this.#directoryEndpoint?.multiaddrs[0];

    try {
      if (dirMultiaddr) {
        try { await this.#node.dial(dirMultiaddr); } catch { /* non-fatal */ }
      }

      let sigStream: Stream;
      try {
        sigStream = await this.#node.newStream(dirPeerId, SIGNALING_PROTOCOL_ID);
      } catch {
        return false;
      }

      const iter = (lp.decode(sigStream) as AsyncIterable<unknown>)[Symbol.asyncIterator]() as AsyncIterator<Uint8Array>;

      const { value: challengeRaw, done } = await nextWithTimeout(iter, RELAY_AUTH_TIMEOUT_MS);
      if (done || challengeRaw === undefined) { sigStream.abort(new Error("dir_auth_error")); return false; }

      let challengeFrame: Record<string, unknown>;
      try {
        challengeFrame = decode(toU8(challengeRaw)) as Record<string, unknown>;
      } catch { sigStream.abort(new Error("dir_auth_error")); return false; }

      if (challengeFrame["type"] !== "signaling_auth_challenge") {
        sigStream.abort(new Error("dir_auth_error")); return false;
      }

      const nonce = toU8(challengeFrame["nonce"]);
      if (nonce.length !== 32) { sigStream.abort(new Error("dir_auth_error")); return false; }

      if (!this.#myPubkeyHex) {
        const pubkey = await this.#keyProvider.getPublicKey();
        this.#myPubkeyHex = Buffer.from(pubkey).toString("hex");
      }
      const myPubkey = Buffer.from(this.#myPubkeyHex, "hex");

      const domain = Buffer.from(AUTH_DOMAIN_DIR, "utf8");
      const authMsg = new Uint8Array(Buffer.concat([domain, nonce, myPubkey]));
      const msgHash = new Uint8Array(createHash("sha256").update(authMsg).digest());
      const sig = await this.#keyProvider.sign(msgHash);

      const authResponseFrame = CBOR_ENC.encode({
        type: "signaling_auth_response",
        pubkey: myPubkey,
        signature: sig,
      }) as Uint8Array;
      sigStream.send(lp.encode.single(authResponseFrame));

      const { value: ackRaw, done: ackDone } = await nextWithTimeout(iter, RELAY_AUTH_TIMEOUT_MS);
      if (ackDone || ackRaw === undefined) { sigStream.abort(new Error("dir_auth_error")); return false; }
      let ackFrame: Record<string, unknown>;
      try {
        ackFrame = decode(toU8(ackRaw)) as Record<string, unknown>;
      } catch { sigStream.abort(new Error("dir_auth_error")); return false; }
      if (ackFrame["type"] !== "signaling_auth_ok") {
        sigStream.abort(new Error("dir_auth_error")); return false;
      }

      const peerInfoFrame = CBOR_ENC.encode({
        type: "peer_info_announce",
        peer_id: this.#node.getPeerId(),
        multiaddrs: this.#node.listenAddresses(),
      }) as Uint8Array;
      sigStream.send(lp.encode.single(peerInfoFrame));

      this.#persistentSignalingStream = sigStream;
      this.#persistentSignalingIter = iter;

      void this.#runPersistentSignalingReader(sigStream, iter);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Persistent signaling stream reader loop.
   * Handles frames from the directory on the shared signaling stream:
   *   - session_assignment  → routes to #pendingSessionRequestResolve (outbound init)
   *                           or fires #onSessionAssignmentHandler (inbound assignment, participant B)
   *   - session_request_error → routes to #pendingSessionRequestResolve
   *   - session_sealed       → routes to the matching session's seal handler
   *   - session_seal_rejected → routes to the matching session's seal handler
   */
  async #runPersistentSignalingReader(
    stream: Stream,
    iter: AsyncIterator<Uint8Array>,
  ): Promise<void> {
    try {
      while (true) {
        let result: IteratorResult<Uint8Array>;
        try {
          result = await iter.next();
        } catch { break; }
        if (result.done || result.value === undefined) break;

        let frame: Record<string, unknown>;
        try {
          frame = decode(toU8(result.value as unknown)) as Record<string, unknown>;
        } catch { continue; }

        if (frame["type"] === "session_assignment" || frame["type"] === "session_request_error") {
          // Route to pending session_request resolver (if one is waiting)
          const resolve = this.#pendingSessionRequestResolve;
          if (resolve) {
            this.#pendingSessionRequestResolve = null;
            resolve(frame);
          } else if (frame["type"] === "session_assignment") {
            // No pending outbound request — this is an inbound assignment (participant B role).
            // Call receiveSessionAssignment and fire the onSessionAssignment handler.
            const rawAssignment = frame["assignment"] as Record<string, unknown> | undefined;
            if (rawAssignment) {
              const assignment = parseSessionAssignment(rawAssignment);
              if (assignment && this.#myPubkeyHex) {
                const myPubkey = Buffer.from(this.#myPubkeyHex, "hex");
                void this.receiveSessionAssignment(assignment, myPubkey);
              }
            }
          }
        } else if (frame["type"] === "session_sealed") {
          // Route to matching session's seal handler
          const sessionIdRaw = frame["session_id"];
          const sessionId = sessionIdRaw instanceof Uint8Array ? sessionIdRaw
            : Buffer.isBuffer(sessionIdRaw) ? new Uint8Array(sessionIdRaw as Buffer) : null;
          if (sessionId) {
            const sessionIdHex = Buffer.from(sessionId).toString("hex");
            const session = this.#sessions.get(sessionIdHex);
            if (session) {
              this.#handleDirectorySessionSealed(sessionIdHex, frame, session.directory_pubkey);
            }
          }
        } else if (frame["type"] === "session_seal_rejected") {
          const sessionIdRaw = frame["session_id"];
          const sessionId = sessionIdRaw instanceof Uint8Array ? sessionIdRaw
            : Buffer.isBuffer(sessionIdRaw) ? new Uint8Array(sessionIdRaw as Buffer) : null;
          if (sessionId) {
            const sessionIdHex = Buffer.from(sessionId).toString("hex");
            this.#handleDirectorySessionSealRejected(sessionIdHex, frame);
          }
        } else if (frame["type"] === "seal_rejected_tree_mismatch") {
          // PERSIST-014: tree mismatch — route to reconciliation handler
          const sessionIdRaw = frame["session_id"];
          const sessionId = sessionIdRaw instanceof Uint8Array ? sessionIdRaw
            : Buffer.isBuffer(sessionIdRaw) ? new Uint8Array(sessionIdRaw as Buffer) : null;
          if (sessionId) {
            const sessionIdHex = Buffer.from(sessionId).toString("hex");
            this.#handleSealRejectedTreeMismatch(sessionIdHex, frame);
          }
        } else if (frame["type"] === "seal_unilateral_confirmed") {
          // PERSIST-015: unilateral seal confirmed — route to pending initiateUnilateralSeal caller and handler
          const sessionIdRaw = frame["session_id"];
          const sessionId = sessionIdRaw instanceof Uint8Array ? sessionIdRaw
            : Buffer.isBuffer(sessionIdRaw) ? new Uint8Array(sessionIdRaw as Buffer) : null;
          if (sessionId) {
            const sessionIdHex = Buffer.from(sessionId).toString("hex");
            this.#handleSealUnilateralConfirmed(sessionIdHex, frame);
          }
          const unilateralResolve = this.#pendingUnilateralSealResolve;
          if (unilateralResolve) {
            this.#pendingUnilateralSealResolve = null;
            unilateralResolve(frame);
          }
        } else if (frame["type"] === "seal_unilateral_notification") {
          // PERSIST-015: absent party receives unilateral seal notification
          const sessionIdRaw = frame["session_id"];
          const sessionId = sessionIdRaw instanceof Uint8Array ? sessionIdRaw
            : Buffer.isBuffer(sessionIdRaw) ? new Uint8Array(sessionIdRaw as Buffer) : null;
          if (sessionId) {
            const sessionIdHex = Buffer.from(sessionId).toString("hex");
            this.#handleSealUnilateralNotification(sessionIdHex, frame);
          }
        } else if (frame["type"] === "seal_unilateral_too_early") {
          // PERSIST-015: directory rejects unilateral seal — grace period not elapsed
          const sessionIdRaw = frame["session_id"];
          const sessionId = sessionIdRaw instanceof Uint8Array ? sessionIdRaw
            : Buffer.isBuffer(sessionIdRaw) ? new Uint8Array(sessionIdRaw as Buffer) : null;
          if (sessionId) {
            const sessionIdHex = Buffer.from(sessionId).toString("hex");
            const remainingSeconds = typeof frame["remaining_seconds"] === "number" ? frame["remaining_seconds"] : 0;
            this.#logger.warn("session.unilateral.too.early", { sessionId: sessionIdHex, remainingSeconds });
          }
          const unilateralResolve = this.#pendingUnilateralSealResolve;
          if (unilateralResolve) {
            this.#pendingUnilateralSealResolve = null;
            unilateralResolve(frame);
          }
        } else if (frame["type"] === "seal_verified") {
          // SESSION-005: route seal_verified to the FROST ceremony handler.
          // This frame arrives when the directory has verified the Merkle tree and
          // the initiator must now participate in the FROST ceremony.
          const sessionIdRaw = frame["session_id"];
          const sessionId = sessionIdRaw instanceof Uint8Array ? sessionIdRaw
            : Buffer.isBuffer(sessionIdRaw) ? new Uint8Array(sessionIdRaw as Buffer) : null;
          if (sessionId) {
            const sessionIdHex = Buffer.from(sessionId).toString("hex");
            void this.#handleSealVerified(sessionIdHex, frame);
          }
        } else if (frame["type"] === "session_frost_sealed") {
          // SESSION-005: deferred FROST seal completed — upgrade bilateral → frost.
          const sessionIdRaw = frame["session_id"];
          const sessionId = sessionIdRaw instanceof Uint8Array ? sessionIdRaw
            : Buffer.isBuffer(sessionIdRaw) ? new Uint8Array(sessionIdRaw as Buffer) : null;
          if (sessionId) {
            const sessionIdHex = Buffer.from(sessionId).toString("hex");
            this.#handleSessionFrostSealed(sessionIdHex, frame);
          }
        } else if (frame["type"] === "ceremony_request") {
          // Directory asks the client to coordinate a FROST ceremony.
          // Client runs participateInCeremony and sends ceremony_result back.
          void this.#handleCeremonyRequest(stream, frame);
        } else if (frame["type"] === "dkg_ready") {
          // REG-001: directory is ready for DKG. Route to pending register() caller.
          const resolve = this.#pendingDkgReadyResolve;
          if (resolve) {
            this.#pendingDkgReadyResolve = null;
            resolve(frame);
          }
        } else if (frame["type"] === "register_success" || frame["type"] === "register_error") {
          // REG-001: route registration response to pending register() caller.
          // already_registered arrives before dkg_ready (directory skips DKG entirely).
          // Route to both resolvers so register() unblocks regardless of which stage it is at.
          const dkgResolve = this.#pendingDkgReadyResolve;
          if (dkgResolve) {
            this.#pendingDkgReadyResolve = null;
            dkgResolve(frame);
          }
          const resolve = this.#pendingRegisterResolve;
          if (resolve) {
            this.#pendingRegisterResolve = null;
            resolve(frame);
          }
        } else if (
          frame["type"] === "connection_established" ||
          frame["type"] === "connection_rejected" ||
          frame["type"] === "connection_insufficient" ||
          frame["type"] === "connection_request_error" ||
          frame["type"] === "disclosure_request_inbound"
        ) {
          // CONNREQ-002/CONNREQ-003: route connection outcome frames.
          //
          // CONNREQ-003: The single-slot #pendingConnectionRequestResolve is replaced by
          // #pendingConnectionRequestResolvers (Map keyed by target pubkey hex).
          // Routing uses counterparty_pubkey (for established) or target_pubkey (for errors)
          // to find the exact resolver for this target — ensuring cross-target isolation (SI-001).

          if (frame["type"] === "connection_established") {
            // Store connection record locally (applies to both sender A and target B)
            const connectionId = frame["connection_id"] as string;
            const counterpartyPubkey = frame["counterparty_pubkey"] as string;
            if (connectionId && counterpartyPubkey) {
              if (!this.#connections.has(connectionId)) {
                const record: import("@cello/protocol-types").ClientConnectionRecord = {
                  connection_id: connectionId,
                  counterparty_pubkey: counterpartyPubkey,
                  counterparty_primary_pubkey: "",
                  counterparty_ml_dsa_pubkey: "",
                  established_at: Date.now(),
                  status: "active",
                };
                if (this.#profileUncheckedPeers.has(counterpartyPubkey)) {
                  record.profile_unchecked = true;
                  this.#profileUncheckedPeers.delete(counterpartyPubkey);
                }
                this.#connections.set(connectionId, record);
                this.#connectionsByPeer.set(counterpartyPubkey, connectionId);
              }
              // Fire onConnectionEstablished handler (both A and B)
              const handler = this.#onConnectionEstablishedHandler;
              if (handler) {
                handler({ type: "connection_established", counterparty_pubkey: counterpartyPubkey, connection_id: connectionId });
              }
            }
            // CONNREQ-003: Route to the resolver for this specific target (keyed by counterparty pubkey).
            // SI-001: only the resolver waiting for counterpartyPubkey is unblocked; no cross-target routing.
            const resolve = this.#pendingConnectionRequestResolvers.get(counterpartyPubkey);
            if (resolve) {
              this.#pendingConnectionRequestResolvers.delete(counterpartyPubkey);
              resolve(frame);
            } else {
              // Round 2: route to disclosure resolver if pending (no in-flight connection_request)
              for (const [id, disclosureResolve] of this.#pendingDisclosureResolvers) {
                this.#pendingDisclosureResolvers.delete(id);
                disclosureResolve(frame);
                break;
              }
            }
          } else if (frame["type"] === "disclosure_request_inbound") {
            // CONNREQ-002 Round 2: target requests more disclosure → fire onDisclosureRequested
            const disclosureHandler = this.#onDisclosureRequestedHandler;
            if (disclosureHandler) {
              disclosureHandler({
                type: "disclosure_request_inbound",
                from_pubkey: frame["from_pubkey"] as string,
                connection_request_id: frame["connection_request_id"] as string,
                requested_items: (frame["requested_items"] as import("@cello/protocol-types").DisclosureRequestItem[]) ?? [],
              });
            }
            // CONNREQ-003: disclosure_request_inbound carries from_pubkey (= target).
            // Route to the resolver for this target.
            const targetPubkeyForDisclosure = frame["from_pubkey"] as string;
            const resolve = this.#pendingConnectionRequestResolvers.get(targetPubkeyForDisclosure);
            if (resolve) {
              this.#pendingConnectionRequestResolvers.delete(targetPubkeyForDisclosure);
              resolve(frame);
            }
          } else {
            // connection_rejected, connection_insufficient, connection_request_error
            // These frames carry target_pubkey so we can route to the correct resolver.
            const targetPubkeyForError = frame["target_pubkey"] as string | undefined;
            if (targetPubkeyForError && this.#pendingConnectionRequestResolvers.has(targetPubkeyForError)) {
              const resolve = this.#pendingConnectionRequestResolvers.get(targetPubkeyForError)!;
              this.#pendingConnectionRequestResolvers.delete(targetPubkeyForError);
              resolve(frame);
            } else if (this.#pendingConnectionRequestResolvers.size === 1) {
              // Fallback: if exactly one request is in flight and frame has no target_pubkey,
              // route to that single resolver (backward-compatible with pre-CONNREQ-003 directory).
              const [singleKey, singleResolve] = this.#pendingConnectionRequestResolvers.entries().next().value as [string, (frame: Record<string, unknown>) => void];
              this.#pendingConnectionRequestResolvers.delete(singleKey);
              singleResolve(frame);
            } else {
              // Round 2: route to disclosure resolver if pending
              for (const [id, disclosureResolve] of this.#pendingDisclosureResolvers) {
                this.#pendingDisclosureResolvers.delete(id);
                disclosureResolve(frame);
                break;
              }
            }
          }
        } else if (frame["type"] === "connection_request_inbound") {
          // CONNREQ-002: inbound connection request for this client (B's side).
          // Evaluate the package using connectionPolicy and send connection_response.
          void this.#handleInboundConnectionRequest(frame);
        } else if (frame["type"] === "disclosure_response_inbound") {
          // CONNREQ-002 Round 2: A provided updated package → re-evaluate and send response.
          void this.#handleDisclosureResponse(frame);
        }
      }
    } catch { /* stream closed */ }

    // Stream closed — clear persistent stream ref
    if (this.#persistentSignalingStream === stream) {
      this.#persistentSignalingStream = null;
      this.#persistentSignalingIter = null;
    }

    // If a register() call is pending (dkg_ready phase), unblock it with a synthetic error
    const dkgReadyResolve = this.#pendingDkgReadyResolve;
    if (dkgReadyResolve) {
      this.#pendingDkgReadyResolve = null;
      dkgReadyResolve({ type: "register_error", reason: "stream_closed" });
    }

    // If a register() call is pending (register_success phase), unblock it with a synthetic error
    const regResolve = this.#pendingRegisterResolve;
    if (regResolve) {
      this.#pendingRegisterResolve = null;
      regResolve({ type: "register_error", reason: "stream_closed" });
    }

    // If a session_request is pending, unblock it with a synthetic error
    const resolve = this.#pendingSessionRequestResolve;
    if (resolve) {
      this.#pendingSessionRequestResolve = null;
      resolve({ type: "session_request_error", reason: "directory_unreachable" });
    }

    // CONNREQ-003: Unblock all pending connection request resolvers (AC-005)
    // When the signaling stream closes, all in-flight cello_request_connection calls
    // receive a synthetic connection_request_error so they can return directory_unreachable.
    for (const [targetPubkey, pendingResolve] of this.#pendingConnectionRequestResolvers) {
      this.#pendingConnectionRequestResolvers.delete(targetPubkey);
      pendingResolve({ type: "connection_request_error", reason: "directory_unreachable", target_pubkey: targetPubkey });
    }
  }
}

// ─── Stream iterator helpers ──────────────────────────────────────────────────

// ─── ADAPTER-003: parseSessionAssignment ─────────────────────────────────────

/**
 * Decode a raw CBOR-decoded object (from frame["assignment"]) into a typed SessionAssignment.
 * Returns null if any required field is missing or malformed.
 *
 * The object is already decoded by cbor-x from the outer frame — this function just
 * validates and casts the fields. No @cello/directory import needed.
 *
 * Wire shape (from encodeSessionAssignment in directory-frames.ts):
 *   {
 *     session_id: Uint8Array (16),
 *     participant_a: { pubkey: Uint8Array (32), peer_id: string, multiaddrs: string[] },
 *     participant_b: { pubkey: Uint8Array (32), peer_id: string, multiaddrs: string[] },
 *     relay_endpoint: { peer_id: string, multiaddrs: string[] },
 *     directory_endpoint: { peer_id: string, multiaddrs: string[] },
 *     session_timestamp: number,
 *     directory_pubkey: Uint8Array (32),
 *     directory_signature: Uint8Array (64),
 *   }
 */
function parseSessionAssignment(raw: Record<string, unknown>): SessionAssignment | null {
  const sessionId = toU8Safe(raw["session_id"]);
  if (!sessionId || sessionId.length !== 16) return null;

  const dirPubkey = toU8Safe(raw["directory_pubkey"]);
  if (!dirPubkey || dirPubkey.length !== 32) return null;

  const dirSig = toU8Safe(raw["directory_signature"]);
  if (!dirSig || dirSig.length !== 64) return null;

  const tsRaw = raw["session_timestamp"];
  const sessionTimestamp = typeof tsRaw === "number" ? tsRaw
    : typeof tsRaw === "bigint" ? Number(tsRaw) : null;
  if (sessionTimestamp === null) return null;

  const participantA = parseParticipantInfo(raw["participant_a"]);
  if (!participantA) return null;

  const participantB = parseParticipantInfo(raw["participant_b"]);
  if (!participantB) return null;

  const relayEndpoint = parseEndpointInfo(raw["relay_endpoint"]);
  if (!relayEndpoint) return null;

  const directoryEndpoint = parseEndpointInfo(raw["directory_endpoint"]);
  if (!directoryEndpoint) return null;

  const sigType = typeof raw["signature_type"] === "string" ? raw["signature_type"] : "single";

  if (sigType === "frost") {
    const signerPubkey = toU8Safe(raw["signer_pubkey"]);
    if (!signerPubkey || signerPubkey.length !== 32) return null;
    return {
      session_id: sessionId,
      participant_a: participantA,
      participant_b: participantB,
      relay_endpoint: relayEndpoint,
      directory_endpoint: directoryEndpoint,
      session_timestamp: sessionTimestamp,
      directory_pubkey: dirPubkey,
      directory_signature: dirSig,
      signature_type: "frost" as const,
      signer_pubkey: signerPubkey,
    };
  }

  return {
    session_id: sessionId,
    participant_a: participantA,
    participant_b: participantB,
    relay_endpoint: relayEndpoint,
    directory_endpoint: directoryEndpoint,
    session_timestamp: sessionTimestamp,
    directory_pubkey: dirPubkey,
    directory_signature: dirSig,
    signature_type: "single" as const,
  };
}

function parseParticipantInfo(raw: unknown): import("@cello/protocol-types").ParticipantInfo | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const pubkey = toU8Safe(r["pubkey"]);
  if (!pubkey || pubkey.length !== 32) return null;
  const peerId = typeof r["peer_id"] === "string" ? r["peer_id"] : null;
  if (!peerId) return null;
  const multiaddrs = parseStringArray(r["multiaddrs"]);
  if (!multiaddrs) return null;
  return { pubkey, peer_id: peerId, multiaddrs };
}

function parseEndpointInfo(raw: unknown): import("@cello/protocol-types").RelayEndpointInfo | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const peerId = typeof r["peer_id"] === "string" ? r["peer_id"] : null;
  if (!peerId) return null;
  const multiaddrs = parseStringArray(r["multiaddrs"]);
  if (!multiaddrs) return null;
  return { peer_id: peerId, multiaddrs };
}

function parseStringArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  if (!v.every((x) => typeof x === "string")) return null;
  return v as string[];
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createClient(
  node: CelloNode,
  keyProvider: KeyProvider,
  opts?: {
    onMessageQueued?: (senderPubkeyHex: string) => void;
    contentGraceMs?: number;
    /** SESSION-006: ms to attempt relay reconnect before giving up. Default: 60000. */
    reconnectTimeoutMs?: number;
    /** SESSION-004/SESSION-005: optional FROST threshold signer for initiator role and seal ceremony coordination. */
    thresholdSigner?: IThresholdSigner;
    /** SESSION-005: ms to wait for FROST seal after bilateral exchange. Default: 15000. */
    sealFrostTimeoutMs?: number;
    /** ADAPTER-003: directory endpoint for initiateSession. */
    directoryEndpoint?: { peer_id: string; multiaddrs: string[] };
    /** REG-001: path for persisting ML-DSA-44 keypair. If set, FileMlDsaKeyProvider.load() is used. */
    mlDsaKeyFile?: string;
    /** CONNREQ-002: connection policy for evaluating inbound connection_request_inbound frames. */
    connectionPolicy?: import("./connection-policy.js").SignalRequirementPolicy;
    /** CONNREQ-002: overall connection timeout in ms. Default: 300000. */
    connectionTimeoutMs?: number;
    /** CONNREQ-002: Round 2 silence timeout in ms. Default: 120000. */
    round2TimeoutMs?: number;
    /** CONNREQ-002: if true, expose _evaluateCallCount on the instance for test assertions. */
    trackEvaluateCount?: boolean;
    /** CONNREQ-002: sender pubkeys that bypass evaluateConnectionPackage. */
    whitelist?: string[];
    /** CONNREQ-002: callback fired when an inbound connection_request_inbound is queued for agent review. */
    onConnectionPendingReview?: (event: import("@cello/protocol-types").ConnectionRequestInbound) => void;
    /** DB-003: attempt cross-check of sender's ml_dsa_pubkey on inbound requests. */
    crossCheckDirectoryOnInbound?: boolean;
    /** PERSIST-014: injected logger for observability events. */
    logger?: Logger;
  }
): CelloClient & {
  sendRaw(peerPubkeyHex: string, bytes: Uint8Array): Promise<SendResult>;
  openRawStream(peerPubkeyHex: string): Promise<Stream>;
  openContentStreamByPeerId(peerId: string): Promise<Stream>;
  /** SESSION-005: register the client's FROST primary_pubkey for seal verification. */
  setPrimaryPubkey(primaryPubkey: Uint8Array): void;
  injectDirectoryFrame(sessionIdHex: string, frame: Record<string, unknown>): void;
  injectLeafDeliver(sessionIdHex: string, frame: Record<string, unknown>): void;
  injectRelayDisconnect(sessionIdHex: string): void;
  /** TEST-ONLY: register a minimal session record without a real relay connection. */
  injectTestSession(sessionIdHex: string, sessionId: Uint8Array, myPubkeyHex: string, directoryPubkey: Uint8Array, status?: SessionRecord["status"], opts?: { isInitiator?: boolean }): void;
  /** CONNREQ-002: list active connection records. */
  listConnections(): import("@cello/protocol-types").ClientConnectionRecord[];
  /** CONNREQ-002: send connection_request to target B and await final outcome. */
  cello_request_connection(opts: { target_pubkey: string; package_cbor: Uint8Array }): Promise<
    | { result: "established"; connection_id: string }
    | { result: "rejected"; reason: string }
    | { result: "insufficient"; unmet_requirements: unknown[] }
    | { result: "disclosure_requested"; connection_request_id: string; requested_items: unknown[] }
    | { result: "timeout" }
    | { result: "error"; reason: string }
  >;
  /** CONNREQ-002: respond to disclosure_request (Round 2 sender side). */
  cello_respond_to_disclosure_request(opts: { connection_request_id: string; package_cbor: Uint8Array }): Promise<
    | { result: "established"; connection_id: string }
    | { result: "rejected"; reason: string }
    | { result: "insufficient"; unmet_requirements: unknown[] }
    | { result: "timeout" }
    | { result: "error"; reason: string }
  >;
  /** CONNREQ-002: request more disclosure from sender (Round 2, target side). */
  cello_request_more_disclosure(opts: { connection_request_id: string; requested_items: unknown[] }): Promise<{ error: "max_rounds_reached" } | { ok: true }>;
  /** CONNREQ-002: register connection_established event handler. */
  onConnectionEstablished(handler: (event: import("@cello/protocol-types").ConnectionEstablished) => void): void;
  /** CONNREQ-002: register disclosure_request_inbound event handler (sender side). */
  onDisclosureRequested(handler: (event: import("@cello/protocol-types").DisclosureRequestInbound) => void): void;
  /** CONNREQ-002: reconnect the persistent directory signaling stream. */
  reconnectDirectory(): Promise<boolean>;
  /** PERSIST-015: send seal_unilateral to directory after delivery_grace_seconds. */
  initiateUnilateralSeal(sessionIdHex: string): Promise<
    | { ok: true; sealed_root: Uint8Array; sealed_at: number }
    | { ok: false; reason: "too_early"; remaining_seconds: number }
    | { ok: false; reason: string }
  >;
  /** TEST-ONLY: inject a pending inbound connection request into state. */
  _injectPendingConnectionRequest(opts: { connection_request_id: string; from_pubkey: string; package_cbor: Uint8Array; round: number }): void;
  /**
   * CONNREQ-003 TEST-ONLY: route a synthetic connection outcome frame through the
   * resolver Map — used by SI-001 adversarial test to verify cross-target isolation.
   */
  _injectConnectionFrame(frame: Record<string, unknown>): void;
  /** CONNREQ-003 TEST-ONLY: current size of the pending resolver Map. */
  _pendingConnectionRequestResolverCount: number;
  /** TEST-ONLY: evaluate call counter (only incremented when trackEvaluateCount=true). */
  _evaluateCallCount: number;
} {
  return new CelloClientImpl(
    node,
    keyProvider,
    opts?.onMessageQueued,
    opts?.contentGraceMs,
    opts?.reconnectTimeoutMs,
    opts?.thresholdSigner,
    opts?.sealFrostTimeoutMs,
    opts?.directoryEndpoint ?? null,
    opts?.mlDsaKeyFile,
    opts?.connectionPolicy,
    opts?.connectionTimeoutMs,
    opts?.round2TimeoutMs,
    opts?.trackEvaluateCount,
    opts?.whitelist,
    opts?.onConnectionPendingReview,
    opts?.crossCheckDirectoryOnInbound,
    opts?.logger,
  ) as unknown as CelloClient & {
    sendRaw(peerPubkeyHex: string, bytes: Uint8Array): Promise<SendResult>;
    openRawStream(peerPubkeyHex: string): Promise<Stream>;
    openContentStreamByPeerId(peerId: string): Promise<Stream>;
    setPrimaryPubkey(primaryPubkey: Uint8Array): void;
    injectDirectoryFrame(sessionIdHex: string, frame: Record<string, unknown>): void;
    injectLeafDeliver(sessionIdHex: string, frame: Record<string, unknown>): void;
    injectRelayDisconnect(sessionIdHex: string): void;
    injectTestSession(sessionIdHex: string, sessionId: Uint8Array, myPubkeyHex: string, directoryPubkey: Uint8Array, status?: SessionRecord["status"], opts?: { isInitiator?: boolean }): void;
    listConnections(): import("@cello/protocol-types").ClientConnectionRecord[];
    cello_request_connection(opts: { target_pubkey: string; package_cbor: Uint8Array }): Promise<
      | { result: "established"; connection_id: string }
      | { result: "rejected"; reason: string }
      | { result: "insufficient"; unmet_requirements: unknown[] }
      | { result: "disclosure_requested"; connection_request_id: string; requested_items: unknown[] }
      | { result: "timeout" }
      | { result: "error"; reason: string }
    >;
    cello_respond_to_disclosure_request(opts: { connection_request_id: string; package_cbor: Uint8Array }): Promise<
      | { result: "established"; connection_id: string }
      | { result: "rejected"; reason: string }
      | { result: "insufficient"; unmet_requirements: unknown[] }
      | { result: "timeout" }
      | { result: "error"; reason: string }
    >;
    cello_request_more_disclosure(opts: { connection_request_id: string; requested_items: unknown[] }): Promise<{ error: "max_rounds_reached" } | { ok: true }>;
    onConnectionEstablished(handler: (event: import("@cello/protocol-types").ConnectionEstablished) => void): void;
    onDisclosureRequested(handler: (event: import("@cello/protocol-types").DisclosureRequestInbound) => void): void;
    reconnectDirectory(): Promise<boolean>;
    /** PERSIST-015: send seal_unilateral to directory after delivery_grace_seconds. */
    initiateUnilateralSeal(sessionIdHex: string): Promise<
      | { ok: true; sealed_root: Uint8Array; sealed_at: number }
      | { ok: false; reason: "too_early"; remaining_seconds: number }
      | { ok: false; reason: string }
    >;
    _injectPendingConnectionRequest(opts: { connection_request_id: string; from_pubkey: string; package_cbor: Uint8Array; round: number }): void;
    _injectConnectionFrame(frame: Record<string, unknown>): void;
    _pendingConnectionRequestResolverCount: number;
    _evaluateCallCount: number;
  };
}

// ─── Error helpers ────────────────────────────────────────────────────────────

function isStructuredError(err: unknown, reason: string): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "reason" in err &&
    (err as Record<string, unknown>).reason === reason
  );
}

function mapSendError(err: unknown): "remote_rejected" | "connection_lost" | "peer_unreachable" | "transport_not_started" {
  if (isStructuredError(err, "node_stopped")) return "transport_not_started";
  if (isStructuredError(err, "connection_lost")) return "connection_lost";
  if (isStructuredError(err, "protocol_not_supported")) return "peer_unreachable";
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("reset") || msg.includes("aborted")) return "remote_rejected";
  return "connection_lost";
}
