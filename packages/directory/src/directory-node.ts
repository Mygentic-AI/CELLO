/**
 * CELLO Directory Node — CelloDirectoryNode (NODE-001)
 *
 * Implements the /cello/signaling/1.0.0 libp2p protocol:
 *   - Ed25519 challenge-response auth (domain: "CELLO-DIR-AUTH-v1")
 *   - session_request processing: relay assignment, signed SessionAssignment delivery
 *   - seal processing: Merkle recomputation, signature verification, SealNotarization
 *   - notification queuing for disconnected clients (DB-002)
 *
 * Auth signature over: SHA-256("CELLO-DIR-AUTH-v1" || nonce || pubkey)
 *   per RFC 8032 (Ed25519) and FIPS 180-4 (SHA-256)
 *
 * SessionAssignment TBS: canonical CBOR of
 *   [session_id, participant_a_pubkey, participant_b_pubkey, session_timestamp]
 *   per SESSION-001.
 *
 * SESSION-004 additions:
 *   #processSessionRequest now embeds a FROST-signed SessionAssignment with:
 *     signature_type: 'frost'
 *     signer_pubkey: initiator.primary_pubkey
 *
 * ─── Phase P (rev3): SESSION-004 Pseudocode ──────────────────────────────────
 *
 * #processSessionRequest(stream, initiatorHex, targetHex) — SESSION-004 flow:
 *   // After computing session_id, session_timestamp:
 *
 *   // 1. Check for injected IThresholdSigner (CRITICAL-2: fail loudly if absent)
 *   signer = this.#thresholdSigners.get(initiatorHex)
 *   if signer is null:
 *     sendFrame(stream, encodeSessionRequestError({ reason: 'frost_signer_not_configured' }))
 *     return
 *
 *   // 2. Compute genesis_prev_root — RFC 8032 (Ed25519), FIPS 180-4 (SHA-256)
 *   genesis_prev_root = computeGenesisPrevRoot(initiatorPubkey, targetPubkey,
 *                                              session_id, session_timestamp)
 *
 *   // 3. Build TBS (HIGH-5: from protocol-types, same encoding on both sides)
 *   //    Fields: [session_id, pubA, pubB, genesis_prev_root, timestamp] — RFC 9591 / CONTEXT.md
 *   tbs = buildSessionEstablishmentTbs(session_id, initiatorPubkey, targetPubkey,
 *                                      genesis_prev_root, session_timestamp)
 *
 *   // 4. Conflict detection (MEDIUM-N1 fix + IMPORTANT-N3 fix):
 *   //    ceremonyId is unique per session → used as peerIdString so two concurrent
 *   //    ceremonies for the same agent produce different peerIdString values → conflict fires.
 *   //    IMPORTANT-N3: conflict check and early return happen BEFORE markInFlight so
 *   //    clearInFlight is only called when markInFlight was actually called.
 *   epochId = `${initiatorHex}:epoch:1`   // M2 hardcoded; M3 uses actual key epoch
 *   ceremonyId = `session-${Buffer.from(session_id).toString('hex')}`  // unique per ceremony
 *   conflict = this.#frostHandler.checkConflict(initiatorHex, epochId, ceremonyId, ceremonyId)
 *   if conflict:
 *     console.warn(`[directory] CEREMONY_CONFLICT: agent=${initiatorHex.slice(0,16)}`)
 *     sendFrame(stream, encodeSessionRequestError({ reason: 'ceremony_conflict' }))
 *     return
 *   // markInFlight AFTER early return — clearInFlight is only called when this runs
 *   this.#frostHandler.markInFlight(initiatorHex, epochId, ceremonyId, ceremonyId)
 *   try {
 *     // 5. FROST ceremony (RFC 9591 §5 coordinator flow)
 *     result = await signer.participateInCeremony(ceremonyId, tbs, CONTEXT_SESSION_ESTABLISHMENT)
 *     if result.ok is false:
 *       sendFrame(stream, encodeSessionRequestError({ reason: 'directory_below_threshold' }))
 *       return
 *     frostedSig = result.signature
 *
 *     // 6. getPrimaryPubkey() — HIGH-4: method required on IThresholdSigner interface
 *     initiatorPrimaryPubkey = signer.getPrimaryPubkey()
 *
 *     // 7. Build SessionAssignment with signature_type: 'frost' (MEDIUM-6: discriminated union)
 *     assignment = {
 *       ...(all common fields),
 *       signature_type: 'frost',
 *       signer_pubkey: initiatorPrimaryPubkey,
 *       directory_signature: frostedSig,
 *     }
 *   } finally {
 *     this.#frostHandler.clearInFlight(initiatorHex, epochId)
 *   }
 *
 *   // AC-005 test pattern: directly call frostHandler.markInFlight(initiatorHex, epochId,
 *   //   "first-ceremony-id", "first-ceremony-id") before sending the second session_request
 *   //   to simulate a competing in-flight ceremony.
 *
 * registerThresholdSigner(initiatorPubkeyHex, signer):
 *   this.#thresholdSigners.set(initiatorPubkeyHex, signer)
 *
 * DirectoryNodeOptions additions:
 *   thresholdSigners?: Map<string, IThresholdSigner>
 *
 * IThresholdSigner interface update (HIGH-4):
 *   getPrimaryPubkey(): Uint8Array  — in packages/crypto/src/frost/types.ts
 *   FrostThresholdSigner already has this; MockThresholdSigner needs a no-op stub.
 *
 * SessionRequestErrorReason additions (directory-types.ts):
 *   'frost_signer_not_configured' | 'directory_below_threshold' | 'ceremony_conflict'
 *
 * ─── End Phase P (rev3) Pseudocode ───────────────────────────────────────────
 *
 * SealNotarization TBS: canonical CBOR of
 *   [session_id, sealed_root, close_timestamp]
 *   per SESSION-003.
 */

import { randomBytes, randomUUID, createHash } from "node:crypto";
import { Encoder, decode as cborDecode } from "cbor-x";
import * as lp from "it-length-prefixed";
import { verify, buildMerkleTree, merkleRoot, CONTEXT_SESSION_ESTABLISHMENT, FrostThresholdSigner, verifyRelayRegistrationSignature, computeCheckpointHash } from "@cello-protocol/crypto";

import type { KeyProvider, LeafInput, IThresholdSigner } from "@cello-protocol/crypto";
import { encodeStructure2, computeGenesisPrevRoot, buildSessionEstablishmentTbs, buildSealTbs } from "@cello-protocol/protocol-types";
import type { AgentProfile } from "@cello-protocol/protocol-types";
import { createNode } from "@cello-protocol/transport";
import type { CelloNode } from "@cello-protocol/transport";
import type { Stream } from "@libp2p/interface";
import type { SessionAbandoned, SessionSealed, SessionSealRejected, SealVerified } from "@cello-protocol/protocol-types";
import type { SealNotarization, Logger, NotificationQueue, ICheckpointTransport, CheckpointProposal, TokenValidator } from "@cello-protocol/interfaces";
import type {
  SessionAssignment,
  SessionAssignmentFrame,
  TimeSource,
  RelaySealData,
  RelaySessionAssignment,
  SealFrostSignature,
  SessionFrostSealed,
  SessionRequestErrorReason,
} from "./directory-types.js";
import { WALL_CLOCK } from "./directory-types.js";
import type { DirectoryStore } from "@cello-protocol/interfaces";
import { InMemoryDirectoryStore } from "@cello-protocol/interfaces/stubs";
import {
  encodeSignalingAuthChallenge,
  encodeSignalingAuthFailed,
  encodeSignalingAuthOk,
  encodeSessionAssignment,
  encodeSessionAbandoned,
  encodeSessionSealed,
  encodeSessionSealRejected,
  encodeSessionRequestError,
  encodeNotAuthenticated,
  encodeSealVerified,
  encodeSessionFrostSealed,
  encodeRegisterSuccess,
  encodeRegisterError,
  encodeDkgReady,
  encodeConnectionRequestError,
  encodeConnectionRequestInbound,
  encodeConnectionEstablished,
  encodeConnectionRejected,
  encodeConnectionInsufficient,
  encodeDisclosureRequestInbound,
  encodeDisclosureResponseInbound,
  encodeSealRejectedTreeMismatch,
  encodeSealAttemptAck,
  encodeSealUnilateralTooEarly,
  encodeSealUnilateralConfirmed,
  encodeSealUnilateralNotification,
  decodeInboundSignalingFrame,
} from "./directory-frames.js";
import { ed25519_FROST } from "@noble/curves/ed25519.js";
import {
  FrostDirectoryHandler,
  FROST_PROTOCOL_ID,
} from "./frost-handler.js";
import type { FrostDirectoryHandlerOptions } from "./frost-handler.js";
import type { ShareStore } from "./share-store.js";
import {
  decodeFrostDkgRequest,
  encodeFrostDkgRound1Response,
  encodeFrostDkgRound2Response,
  encodeFrostDkgRound3Response,
} from "./frost-dkg-frames.js";
import { protocolLog, truncId, truncHex } from "./protocol-log.js";
import { linkAgentToAccount } from "./pre-auth-token-repository.js";
import type { MmrStore } from "./mmr-store.js";
import type { RelayPoolManager } from "./relay-pool-manager.js";

export const SIGNALING_PROTOCOL_ID = "/cello/signaling/1.0.0";
const AUTH_DOMAIN = "CELLO-DIR-AUTH-v1";
const NONCE_TTL_MS = 30_000;

const CBOR_ENC = new Encoder({ tagUint8Array: false });

// ─── Nonce registry ────────────────────────────────────────────────────────────

interface NonceEntry {
  nonce: Uint8Array;
  expiresAt: number;
}

// ─── RelayAdapter: in-process relay interface ─────────────────────────────────

/**
 * The directory calls these relay methods — either in-process or over the network.
 * Uses structural typing so the directory package need not import @cello-protocol/relay directly.
 *
 * CELLO-NODE-004: Methods are now async to support both in-process and network implementations.
 * In-process implementations may return sync values; callers use await to handle both cases.
 */
export interface RelayAdapter {
  recordAssignment(assignment: RelaySessionAssignment): Promise<{ ok: true } | { ok: false; reason: string }> | { ok: true } | { ok: false; reason: string };
  discardSession(sessionId: Uint8Array): Promise<void> | void;
  submitForSeal(sessionId: Uint8Array): Promise<{ ok: true; data: RelaySealData } | { ok: false; reason: string }> | { ok: true; data: RelaySealData } | { ok: false; reason: string };
  confirmSeal(sessionId: Uint8Array): Promise<void> | void;
  rejectSeal(sessionId: Uint8Array, reason: string): Promise<void> | void;
}

// ─── CelloDirectoryNode ────────────────────────────────────────────────────────

export interface DirectoryNodeOptions {
  node: CelloNode;
  keyProvider: KeyProvider;        // directory-identity signing key
  relay: RelayAdapter;
  relayEndpoint: { peer_id: string; multiaddrs: string[] };
  directoryEndpoint?: { peer_id: string; multiaddrs: string[] };
  store?: DirectoryStore;
  clock?: TimeSource;
  /** Node ID used for FROST identifier derivation (defaults to empty string) */
  nodeId?: string;
  /** K_server_X share store (defaults to InMemoryShareStore) */
  shareStore?: ShareStore;
  /** FALLBACK_CANARY event listener for conflict monitoring */
  onFallbackCanary?: FrostDirectoryHandlerOptions["onFallbackCanary"];
  /**
   * REG-001 test injection: force DKG failure for all registration attempts.
   * Used to test AC-007 (below-threshold DKG → dkg_failed).
   * Only effective in NODE_ENV=test.
   */
  forceDkgFailure?: boolean;
  /**
   * REG-001 AC-009: when true, session_request is refused with not_registered if the
   * initiator has not completed registration. Default: false (backward compatible).
   * Set to true in REG-001 tests to enforce the registration gate.
   */
  requireRegistration?: boolean;
  /**
   * SESSION-006: when true, session_request is refused with connection_id_required if
   * no connection_id is present, or no_connection if the connection_id does not match
   * an active connection between initiator and target.
   * Default: false (backward compatible).
   */
  requireConnectionGate?: boolean;
  /**
   * SI-001 test injection: intercepts package_cbor before relaying to target.
   * Simulates a malicious directory modifying the package in transit.
   * Only effective in NODE_ENV=test.
   */
  packageCborInterceptor?: (cbor: Uint8Array) => Uint8Array;
  /** Structured logger injected at the composition root */
  logger?: Logger;
  /** PERSIST-015: seconds after last activity before unilateral seal is allowed. Default: 600. */
  deliveryGraceSeconds?: number;
  /**
   * PERSIST-017: MmrStore for appending sealed sessions to the MMR staging table.
   * When provided, appendSeal() is called after every successful SealNotarization
   * (both single-key and FROST paths). Fire-and-forget with catch — MMR staging
   * failure does not block session closure.
   */
  mmrStore?: MmrStore;
  /**
   * PERSIST-023: NotificationQueue for SEAL_UNILATERAL notifications.
   * When provided, the directory will drain pending notifications for a reconnecting
   * agent and deliver them over the established signaling stream.
   * Defaults to InMemoryNotificationQueue when not provided.
   */
  notificationQueue?: NotificationQueue;
  /**
   * CELLO-RELAY-001: RelayPoolManager for dynamic relay assignment.
   * When provided, session_request uses pickRelay() to assign a relay from the
   * verified manifest instead of the hardcoded relayEndpoint.
   * If pickRelay() returns null, session_request returns relay_unavailable.
   * Backward compatible — when absent, relayEndpoint is used as before.
   */
  relayPoolManager?: RelayPoolManager;
  /**
   * FEDERATION-E2E-001: ICheckpointTransport for inter-node checkpoint cross-signing.
   * When provided, the directory registers a /cello/checkpoint/1.0.0 handler that
   * independently verifies incoming proposals and signs with the node's Ed25519 key.
   * When absent, checkpoint signing is disabled (local/test mode).
   */
  checkpointTransport?: ICheckpointTransport;
  /**
   * OPS-AGENT-001: TokenValidator for pre-authorization token gate on DKG Round 1.
   * When provided, the directory consumes the preAuthToken from the Round 1 frame
   * as the FIRST operation before any FROST crypto computation.
   * When absent (backward compat for existing tests), token gate is skipped.
   * CELLO_ENV=local: use DevTokenValidator (accepts any 'DEV-' prefix token).
   * CELLO_ENV=dev+: use DirectoryTokenValidator backed by pre_authorization_tokens table.
   */
  tokenValidator?: TokenValidator;
  /**
   * OPS-AGENT-001: Postgres pool for account deduplication (AC-005b).
   * When provided alongside tokenValidator, the directory links the new agent_profile
   * to an account after successful DKG Round 1, creating one if needed.
   * When absent, account linking is skipped (backward compat).
   */
  pgPool?: import("pg").Pool;
}

export class CelloDirectoryNode {
  readonly #node: CelloNode;
  readonly #keyProvider: KeyProvider;
  readonly #relay: RelayAdapter;
  readonly #relayEndpoint: { peer_id: string; multiaddrs: string[] };
  readonly #directoryEndpoint: { peer_id: string; multiaddrs: string[] };
  readonly #store: DirectoryStore;
  readonly #clock: TimeSource;
  readonly #frostHandler: FrostDirectoryHandler;
  readonly #logger: Logger | undefined;
  // PERSIST-017: MmrStore for appending seals to the MMR staging table after notarization
  readonly #mmrStore: MmrStore | undefined;
  // PERSIST-023: NotificationQueue for SEAL_UNILATERAL notifications
  readonly #notificationQueue: NotificationQueue | undefined;
  // CELLO-RELAY-001: RelayPoolManager for dynamic relay assignment
  readonly #relayPoolManager: RelayPoolManager | undefined;
  // FEDERATION-E2E-001: ICheckpointTransport for inter-node checkpoint signing
  readonly #checkpointTransport: ICheckpointTransport | undefined;
  // OPS-AGENT-001: TokenValidator for pre-authorization gate on DKG Round 1
  readonly #tokenValidator: TokenValidator | undefined;
  // OPS-AGENT-001: Postgres pool for account deduplication (AC-005b)
  readonly #pgPool: import("pg").Pool | undefined;
  // OPS-AGENT-001: stash phone_stub_hash from consumed token for account linking after DKG completes
  // agentPubkeyHex → { phoneStubHash, emailDomain }
  readonly #pendingPreAuthData = new Map<string, { phoneStubHash: string; emailDomain: string }>();

  // REG-001: forceDkgFailure — test injection for below-threshold DKG simulation
  readonly #forceDkgFailure: boolean;
  // REG-001 AC-009: enforce registration gate on session_request
  readonly #requireRegistration: boolean;
  // SESSION-006: enforce connection gate on session_request
  readonly #requireConnectionGate: boolean;
  // OBS-001: log relay auth once on first successful recordAssignment
  #relayAuthenticated = false;
  // SI-001 test injection: tamper with package_cbor before relay
  readonly #packageCborInterceptor: ((cbor: Uint8Array) => Uint8Array) | undefined;
  // CONNREQ-002: pending connection requests indexed by connection_request_id
  // connection_request_id → { senderHex, targetHex, packageCbor, requestId, disclosureRound }
  readonly #pendingConnectionRequests = new Map<string, {
    senderHex: string;
    targetHex: string;
    packageCbor: Uint8Array;
    requestId: string;
    disclosureRound: number; // 1 = Round 1 pending; 2 = Round 2 (disclosure requested)
  }>();

  // nonce_hex → NonceEntry
  readonly #nonces = new Map<string, NonceEntry>();

  // pubkey_hex → authenticated signaling stream
  readonly #streams = new Map<string, Stream>();

  // SESSION-004: initiator_pubkey_hex → IThresholdSigner (registered per-agent)
  readonly #thresholdSigners = new Map<string, IThresholdSigner>();
  // pubkeyHex → ClientDelegatedSigner for ceremony_result routing
  readonly #delegatedSigners = new Map<string, ClientDelegatedSigner>();

  // pubkey_hex → { peer_id, multiaddrs } (from the Noise handshake / client info)
  readonly #peerInfo = new Map<string, { peer_id: string; multiaddrs: string[] }>();

  // pubkey_hex set: tracks which authenticated agents have registered peer info.
  // Set either by the wire peer_info_announce path or by a direct registerPeerInfo() call
  // (test harness OOB path). Both paths allow subsequent session_request to proceed.
  // AC-014/AC-015 (NODE-001).
  readonly #peerInfoAnnounced = new Set<string>();

  // pubkey_hex → primary_pubkey (32-byte FROST group public key) — SESSION-005
  // Populated by registerPrimaryPubkey (called by test harness or SESSION-004 establishment flow).
  readonly #primaryPubkeys = new Map<string, Uint8Array>();

  // REG-001: k_local_pubkey_hex → shareCommitment (group public key derived from DKG)
  // Populated after DKG round3 completes; cleared after dkg_complete is received and verified.
  readonly #pendingDkgCommitments = new Map<string, Uint8Array>();
  // REG-001: k_local_pubkey_hex → resolve function for dkg_complete promise
  // Allows #processRegisterRequest to wait for the client's dkg_complete frame
  // which arrives on the same signaling stream loop.
  readonly #pendingDkgComplete = new Map<string, (primaryPubkey: string) => void>();

  // PERSIST-014: pending seal attempts — session_id_hex → { partyHex, reported_root, reported_seq }[]
  readonly #pendingSealAttempts = new Map<string, Array<{
    partyHex: string;
    reported_root: Uint8Array;
    reported_seq: number;
  }>>();

  // PERSIST-015: delivery grace period (seconds) before unilateral seal is allowed
  readonly #deliveryGraceSeconds: number;
  // PERSIST-015: session_id_hex → last activity timestamp (ms) — updated on session creation and seal attempts
  readonly #sessionLastActivity = new Map<string, number>();
  // PERSIST-015: session_id_hex → unilateral seal record
  readonly #unilateralSeals = new Map<string, { sealed_root: Uint8Array; sealed_at: number; submitter_hex: string }>();
  // PERSIST-015: pubkey_hex → pending notifications for absent party
  readonly #pendingNotifications = new Map<string, Array<{ type: "seal_unilateral_notification"; session_id: Uint8Array; sealed_root: Uint8Array; sealed_at: number }>>();
  // PERSIST-015: session participant map preserved beyond stream closure, so SEAL_UNILATERAL
  // can identify the absent party after the stream cleanup has removed the pendingSessions entry.
  readonly #sessionParticipants = new Map<string, { initiatorHex: string; targetHex: string }>();

  // session_id_hex → seal-pending state: waiting for seal_frost_signature from initiator — SESSION-005
  readonly #pendingFrostSeals = new Map<string, {
    initiatorHex: string;
    participantAHex: string;
    participantBHex: string;
    sealedRoot: Uint8Array;
    leafCount: number;
    timestamp: number;
    tbs: Uint8Array;
    correlationId: string;
  }>();

  // session_id_hex → provisional session (relay registered, frames may not yet be delivered)
  // Entry remains until the stream's finally block processes it.
  // fullyEstablished = true means both frames were sent and the session is live — no discard.
  readonly #pendingSessions = new Map<string, {
    sessionId: Uint8Array;
    initiatorHex: string;
    targetHex: string;
    initiatorGotAssignment: boolean;
    targetGotAssignment: boolean;
    fullyEstablished: boolean;
  }>();

  constructor(opts: DirectoryNodeOptions) {
    this.#node = opts.node;
    this.#keyProvider = opts.keyProvider;
    this.#relay = opts.relay;
    this.#relayEndpoint = opts.relayEndpoint;
    this.#directoryEndpoint = opts.directoryEndpoint ?? {
      peer_id: opts.node.getPeerId(),
      multiaddrs: opts.node.listenAddresses(),
    };
    this.#store = opts.store ?? new InMemoryDirectoryStore();
    this.#clock = opts.clock ?? WALL_CLOCK;
    this.#logger = opts.logger;
    this.#frostHandler = new FrostDirectoryHandler({
      // Default to libp2p peer ID so that NetworkDirectoryNode.id = peerID matches
      // the FROST identifier derivation used in DKG and signing ceremonies.
      nodeId: opts.nodeId ?? opts.node.getPeerId(),
      shareStore: opts.shareStore,
      onFallbackCanary: opts.onFallbackCanary,
      logger: opts.logger,
    });
    this.#forceDkgFailure = opts.forceDkgFailure ?? false;
    this.#requireRegistration = opts.requireRegistration ?? false;
    this.#requireConnectionGate = opts.requireConnectionGate ?? false;
    this.#packageCborInterceptor = opts.packageCborInterceptor;
    this.#deliveryGraceSeconds = opts.deliveryGraceSeconds ?? 600;
    this.#mmrStore = opts.mmrStore;
    this.#notificationQueue = opts.notificationQueue;
    this.#relayPoolManager = opts.relayPoolManager;
    this.#checkpointTransport = opts.checkpointTransport;
    this.#tokenValidator = opts.tokenValidator;
    this.#pgPool = opts.pgPool;
  }

  async start(): Promise<void> {
    await this.#node.handle(SIGNALING_PROTOCOL_ID, (stream) => {
      void this.#handleSignalingStream(stream);
    }, { maxInboundStreams: 512 });

    await this.#node.handle(FROST_PROTOCOL_ID, (stream) => {
      void this.#handleFrostStream(stream);
    }, { maxInboundStreams: 256 });

    // Relay → directory: seal_submission frames over /cello/directory-relay/1.0.0
    await this.#node.handle("/cello/directory-relay/1.0.0", (stream) => {
      void this.#handleRelayAdminStream(stream);
    }, { maxInboundStreams: 64 });

    // FEDERATION-E2E-001: inter-node checkpoint signing on /cello/checkpoint/1.0.0
    if (this.#checkpointTransport) {
      await this.#node.handle("/cello/checkpoint/1.0.0", (stream) => {
        void this.#handleCheckpointStream(stream);
      }, { maxInboundStreams: 8 });
    }

    // OBS-001 AC-002: directory startup log
    const peerId = truncId(this.#node.getPeerId());
    const addrs = this.#node.listenAddresses();
    const addr = addrs.length > 0 ? addrs[0] : "(none)";
    protocolLog("DIR", `Started — peer ${peerId}, signaling ${addr}`);

    // Log every peer connect/disconnect so operator can confirm directory↔relay
    // and directory↔agent connectivity at a glance.
    const relayPeerIdHex = this.#relayEndpoint.peer_id;
    this.#node.onPeerConnect((connectedPeerId) => {
      const short = truncId(connectedPeerId);
      const label = connectedPeerId === relayPeerIdHex ? " (relay)" : "";
      protocolLog("DIR", `Peer connected: ${short}${label}`);
    });
    this.#node.onPeerDisconnect((disconnectedPeerId) => {
      const short = truncId(disconnectedPeerId);
      const label = disconnectedPeerId === relayPeerIdHex ? " (relay)" : "";
      protocolLog("DIR", `Peer disconnected: ${short}${label}`);
    });
  }

  // ─── Relay admin stream handler (/cello/directory-relay/1.0.0) ───────────────

  async #handleRelayAdminStream(stream: Stream): Promise<void> {
    try {
      let requestBytes: Uint8Array | null = null;
      for await (const chunk of lp.decode(stream)) {
        requestBytes = chunk instanceof Uint8Array ? chunk : (chunk as unknown as { slice(): Uint8Array }).slice();
        break;
      }
      if (!requestBytes) { stream.close().catch(() => {}); return; }

      const req = cborDecode(requestBytes) as Record<string, unknown>;
      const frameType = req["type"] as string | undefined;

      // ─── relay_register: relay identifies itself at startup (FEDERATION-003 + M6B-006) ──
      // The relay sends its relayId, publicKeyHex, region, health_check_url, timestamp, and a self-signature.
      // SI-003: we verify the Ed25519 self-signature (relay_id || public_key_hex || timestamp)
      // before writing to relay_registrations. Only the holder of the private key can sign.
      // CELLO-M6B-006: after successful registration, re-sign the manifest if healthCheckUrl changed.
      if (frameType === "relay_register") {
        const relayId = req["relay_id"] as string | undefined;
        const publicKeyHex = req["public_key_hex"] as string | undefined;
        const region = req["region"] as string | undefined;
        const timestamp = req["timestamp"] as number | undefined;
        const signatureRaw = req["signature"] as Uint8Array | undefined;
        // CELLO-M6B-006: health_check_url is the relay's VPC-internal health endpoint
        const healthCheckUrl = req["health_check_url"] as string | undefined;

        // CELLO-M6B-006 AC-002: health_check_url is required — directory must validate
        // before calling registerRelay() so any relay implementation (not just CELLO's own
        // relay binary) is forced to provide the field.
        // Validate that healthCheckUrl is non-empty to prevent downstream health check failures.
        if (!relayId || !publicKeyHex || !region || typeof timestamp !== "number" || !signatureRaw || !healthCheckUrl || (typeof healthCheckUrl === "string" && healthCheckUrl.trim() === "")) {
          stream.send(lp.encode.single(CBOR_ENC.encode({ type: "relay_register_error", reason: "missing_fields" })));
          await stream.close();
          return;
        }

        // SI-003: verify Ed25519 self-signature over SHA-256(relay_id || public_key_hex || timestamp)
        // Only the relay holding the private key can produce a valid signature over its own publicKeyHex.
        const sigBytes = signatureRaw instanceof Uint8Array ? signatureRaw : new Uint8Array(signatureRaw as unknown as ArrayBuffer);
        const signatureValid = await verifyRelayRegistrationSignature(publicKeyHex, relayId, publicKeyHex, timestamp, sigBytes);
        if (!signatureValid) {
          stream.send(lp.encode.single(CBOR_ENC.encode({ type: "relay_register_error", reason: "RELAY_REGISTRATION_UNAUTHORIZED" })));
          await stream.close();
          return;
        }

        try {
          const regResult = await this.#store.registerRelay({ relayId, publicKeyHex, region });
          // CELLO-M6B-006: if relay was already registered with same key, include already_registered: true
          // so the relay can log relay.already.registered on its side (AC-002).
          // regResult may be undefined in older store implementations (backwards compat).
          if (regResult?.alreadyRegistered) {
            // Log relay.already.registered at the handler layer (M4+ convention: store layers
            // return results; handlers own observability).
            this.#logger?.info("relay.already.registered", { relayId, region });
            stream.send(lp.encode.single(CBOR_ENC.encode({ type: "relay_register_ok", already_registered: true })));
          } else {
            // Log relay.registered at the handler layer.
            this.#logger?.info("relay.registered", { relayId, region });
            stream.send(lp.encode.single(CBOR_ENC.encode({ type: "relay_register_ok" })));
          }
        } catch (err: unknown) {
          const reason = err instanceof Error ? err.message : String(err);
          if (reason.includes("RELAY_IDENTITY_CONFLICT")) {
            // Log relay.registration.conflict at the handler layer (M4+ convention).
            this.#logger?.error("relay.registration.conflict", { relayId, region });
            stream.send(lp.encode.single(CBOR_ENC.encode({ type: "relay_register_error", reason: "RELAY_IDENTITY_CONFLICT" })));
          } else {
            stream.send(lp.encode.single(CBOR_ENC.encode({ type: "relay_register_error", reason })));
          }
          await stream.close();
          return;
        }

        // CELLO-M6B-006: After successful registration, re-sign manifest if healthCheckUrl changed.
        // Fire-and-forget — relay_register_ok is already sent. Manifest update failure is logged
        // but does not block the relay's operation.
        if (healthCheckUrl && this.#relayPoolManager) {
          void this.#relayPoolManager.reSignManifestForRelay({
            relayId,
            healthCheckUrl,
            keyProvider: this.#keyProvider,
          }).catch((err: unknown) => {
            const reason = err instanceof Error ? err.message : String(err);
            // Supplementary diagnostic event (in canonical taxonomy, not a story observability AC).
            // Distinguishes config/sync issues (relay not in manifest) from operational failures
            // (S3 access, signing). Operations team needs to know whether to retry or fix config.
            if (reason.startsWith('RELAY_NOT_IN_MANIFEST:')) {
              this.#logger?.warn("relay.manifest.relay_missing", { relayId, region, reason });
            } else {
              this.#logger?.error("relay.manifest.update.failed", { relayId, region, reason });
            }
          });
        }

        await stream.close();
        return;
      }

      // ─── relay_pubkey_request: client queries relay public key for ACK verification ──
      // FEDERATION-003 AC-004: the client sends relay_id and gets back public_key_hex.
      if (frameType === "relay_pubkey_request") {
        const relayId = req["relay_id"] as string | undefined;
        if (!relayId) {
          stream.send(lp.encode.single(CBOR_ENC.encode({ type: "relay_pubkey_error", reason: "missing_relay_id" })));
          await stream.close();
          return;
        }

        const publicKeyHex = await this.#store.getRelayPublicKey(relayId);
        if (!publicKeyHex) {
          stream.send(lp.encode.single(CBOR_ENC.encode({ type: "relay_pubkey_error", reason: "not_found" })));
        } else {
          stream.send(lp.encode.single(CBOR_ENC.encode({ type: "relay_pubkey_response", relay_id: relayId, public_key_hex: publicKeyHex })));
        }
        await stream.close();
        return;
      }

      if (frameType !== "seal_submission") {
        stream.send(lp.encode.single(CBOR_ENC.encode({ type: "error", reason: "unknown_frame_type" })));
        await stream.close();
        return;
      }

      const sessionId = req["session_id"] as Uint8Array;
      const leaves = req["leaves"] as import("./directory-types.js").RelaySealData["leaves"];
      const merkle_root = req["merkle_root"] as Uint8Array;
      const seq_count = req["seq_count"] as number;

      if (!sessionId || !leaves || !merkle_root) {
        stream.send(lp.encode.single(CBOR_ENC.encode({ type: "error", reason: "missing_fields" })));
        await stream.close();
        return;
      }

      const result = await this.processSeal(sessionId instanceof Uint8Array ? sessionId : new Uint8Array(sessionId as unknown as ArrayBuffer), {
        leaves,
        merkle_root: merkle_root instanceof Uint8Array ? merkle_root : new Uint8Array(merkle_root as unknown as ArrayBuffer),
        seq_count,
      });

      if (result.ok) {
        stream.send(lp.encode.single(CBOR_ENC.encode({ type: "seal_received" })));
      } else {
        stream.send(lp.encode.single(CBOR_ENC.encode({ type: "error", reason: result.reason })));
      }
      await stream.close();
    } catch {
      stream.close().catch(() => {});
    }
  }

  // ─── Checkpoint stream handler (/cello/checkpoint/1.0.0) ────────────────────
  // FEDERATION-E2E-001: Called when a coordinator sends a checkpoint proposal.
  // This node independently recomputes the checkpoint hash from local chain state
  // and signs only if it matches — never trusting the coordinator's hash blindly.
  // (High security fix from FEDERATION-002: verifyAndSign() uses local state)

  async #handleCheckpointStream(stream: Stream): Promise<void> {
    try {
      const chunks: Uint8Array[] = [];
      for await (const chunk of lp.decode(stream)) {
        chunks.push(chunk as unknown as Uint8Array);
      }
      if (chunks.length === 0) {
        stream.close().catch(() => {});
        return;
      }

      const proposal = JSON.parse(
        Buffer.concat(chunks).toString("utf8"),
      ) as CheckpointProposal;

      // Independently compute the checkpoint hash from our local chain state.
      // Do not trust the coordinator-supplied hash — compute from local peaks (SI).
      const localMmrState = await this.#store.getCheckpointMmrState();
      const localHash = computeCheckpointHash(
        localMmrState.mmrPeaks,
        localMmrState.identityMerkleRoot,
        proposal.checkpointId,
      );

      if (localHash !== proposal.checkpointHash) {
        this.#logger?.error("federation.checkpoint.proposal.hash_mismatch", {
          checkpointId: proposal.checkpointId,
          expectedHash: proposal.checkpointHash,
          receivedHash: localHash,
        });
        stream.close().catch(() => {});
        return;
      }

      const hashBytes = Buffer.from(localHash, "hex");
      const sig = await this.#keyProvider.sign(hashBytes);
      const pubKey = await this.#keyProvider.getPublicKey();

      const response = {
        nodeId: this.#frostHandler.nodeId,
        signature: Buffer.from(sig).toString("hex"),
        publicKeyHex: Buffer.from(pubKey).toString("hex"),
      };

      const responseBytes = Buffer.from(JSON.stringify(response), "utf8");
      stream.send(lp.encode.single(responseBytes));
      await stream.close();

      this.#logger?.info("federation.checkpoint.signature.sent", {
        checkpointId: proposal.checkpointId,
        nodeId: response.nodeId,
      });
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      this.#logger?.error("federation.checkpoint.transport.handler.error", { reason });
      stream.close().catch(() => {});
    }
  }

  // ─── FROST stream handler ────────────────────────────────────────────────────

  async #handleFrostStream(stream: Stream): Promise<void> {
    // /cello/frost/1.0.0 wire protocol — one request/response per stream open.
    //
    // Frame types (CBOR, length-prefixed):
    //   Request  { type: "frost_bootstrap",      agentPubkey, epochId, secret, commitments, verifyingShares, signers }
    //   Request  { type: "frost_commit_request",  agentPubkey, epochId, peerIdString }
    //   Response { type: "frost_commit_response", nodeId, nonceCommitment }
    //   Request  { type: "frost_sign_request",    agentPubkey, epochId, tbs, context, commitmentList, ceremonyId, peerIdString }
    //   Response { type: "frost_sign_response",   ok: true, partialSignature }
    //            { type: "frost_sign_response",   ok: false, reason }
    try {
      let requestBytes: Uint8Array | null = null;
      for await (const chunk of lp.decode(stream)) {
        requestBytes = chunk instanceof Uint8Array ? chunk : (chunk as unknown as { slice(): Uint8Array }).slice();
        break;
      }
      if (!requestBytes) { stream.close().catch(() => {}); return; }

      const req = cborDecode(requestBytes) as Record<string, unknown>;
      const frameType = req["type"] as string | undefined;

      if (frameType === "frost_bootstrap") {
        // Client pushes share material from trustedDealer bootstrap.
        // CRIT-2: injectShareForTest is guarded by NODE_ENV !== 'test'. This frame is only
        // accepted in test mode. In production, injectShareForTest throws immediately.
        const agentPubkey = req["agentPubkey"] as string;
        const epochId = req["epochId"] as string;
        const secretBytes = req["secret"] as Uint8Array;
        const identifier = req["identifier"] as string;
        const commitments = req["commitments"] as Uint8Array[];
        const verifyingSharesRaw = req["verifyingShares"] as Record<string, Uint8Array>;
        const signers = req["signers"] as { min: number; max: number };

        // Reconstruct FrostSecret and FrostPublic from the serialized CBOR form.
        // Field names match @noble/curves runtime shape (verified 2026-05-09).
        const frostSecret = {
          identifier,
          signingShare: secretBytes instanceof Uint8Array ? secretBytes : new Uint8Array(secretBytes as unknown as ArrayBuffer),
        };
        const verifyingShares: Record<string, Uint8Array> = {};
        for (const [k, v] of Object.entries(verifyingSharesRaw)) {
          verifyingShares[k] = v instanceof Uint8Array ? v : new Uint8Array(v as unknown as ArrayBuffer);
        }
        const frostPub = {
          signers,
          commitments: commitments.map(c => c instanceof Uint8Array ? c : new Uint8Array(c as unknown as ArrayBuffer)),
          verifyingShares,
        };

        this.#frostHandler.injectShareForTest(agentPubkey, epochId, {
          secret: frostSecret as unknown as import("@noble/curves/abstract/frost.js").FrostSecret,
          pub: frostPub as unknown as import("@noble/curves/abstract/frost.js").FrostPublic,
        });

        // Register a ClientDelegatedSigner that, when the directory needs to run a FROST
        // ceremony, sends a ceremony_request back to the client over the signaling stream.
        // The client is the coordinator (it holds its own share in _localShares); the directory
        // only holds K_server_X shares (via FrostHandlerStub). The client runs the ceremony and
        // returns the combined signature via a ceremony_result frame.
        // primaryPubkey = commitments[0] from the shared FrostPublic (group public key)
        const primaryPubkeyFromPub = new Uint8Array(
          (frostPub as unknown as { commitments: Uint8Array[] }).commitments[0]
        );
        const delegatedSigner = new ClientDelegatedSigner(agentPubkey, primaryPubkeyFromPub);
        delegatedSigner.setStreams(this.#streams);
        this.#delegatedSigners.set(agentPubkey, delegatedSigner);
        this.registerThresholdSigner(agentPubkey, delegatedSigner);
        this.registerPrimaryPubkey(agentPubkey, primaryPubkeyFromPub);

        stream.send(lp.encode.single(CBOR_ENC.encode({ type: "frost_bootstrap_ok" })));
        await stream.close();
        return;
      }

      if (frameType === "frost_commit_request") {
        const agentPubkey = req["agentPubkey"] as string;
        const epochId = req["epochId"] as string;
        this.#logger?.info("frost.debug.frost_stream.commit_request", {
          agentShort: agentPubkey?.slice(0, 16), epochId,
          rawFrameKeys: Object.keys(req),
          agentPubkeyType: typeof agentPubkey,
          epochIdType: typeof epochId,
        });

        const result = await this.#frostHandler.generateCommitment(agentPubkey, epochId);
        this.#logger?.info("frost.debug.frost_stream.commit_response", {
          agentShort: agentPubkey?.slice(0, 16), epochId, resultOk: result.ok,
          reason: result.ok ? null : (result as { reason: string }).reason,
        });
        stream.send(lp.encode.single(
          result.ok
            ? CBOR_ENC.encode({ type: "frost_commit_response", ok: true, nodeId: result.nodeId, nonceCommitment: result.nonceCommitment })
            : CBOR_ENC.encode({ type: "frost_commit_response", ok: false, reason: (result as { reason: string }).reason })
        ));
        await stream.close();
        return;
      }

      if (frameType === "frost_sign_request") {
        const agentPubkey = req["agentPubkey"] as string;
        const epochId = req["epochId"] as string;
        const framedMsg = req["framedMsg"] as Uint8Array;
        const commitmentList = req["commitmentList"] as import("@noble/curves/abstract/frost.js").NonceCommitments[];
        const ceremonyId = req["ceremonyId"] as string;
        const peerIdString = req["peerIdString"] as string;

        this.#logger?.info("frost.debug.frost_stream.sign_request", {
          agentShort: agentPubkey?.slice(0, 16), epochId, ceremonyId,
          framedMsgLength: framedMsg?.length, framedMsgIsUint8Array: framedMsg instanceof Uint8Array,
          commitmentListLength: commitmentList?.length,
          peerIdStringShort: peerIdString?.slice(0, 16),
          rawFrameKeys: Object.keys(req),
        });

        const result = await this.#frostHandler.signRawMessage({
          agentPubkey,
          epochId,
          framedMsg: framedMsg instanceof Uint8Array ? framedMsg : new Uint8Array(framedMsg as unknown as ArrayBuffer),
          commitmentList,
          peerIdString,
          ceremonyId,
        });

        this.#logger?.info("frost.debug.frost_stream.sign_response", {
          agentShort: agentPubkey?.slice(0, 16), epochId, resultOk: result.ok,
          reason: result.ok ? null : (result as { reason: string }).reason,
          sigLength: result.ok ? (result as { partialSignature: Uint8Array }).partialSignature?.length : null,
        });

        const resp = result.ok
          ? CBOR_ENC.encode({ type: "frost_sign_response", ok: true, partialSignature: (result as { partialSignature: Uint8Array }).partialSignature })
          : CBOR_ENC.encode({ type: "frost_sign_response", ok: false, reason: (result as { reason: string }).reason });
        stream.send(lp.encode.single(resp));
        await stream.close();
        return;
      }

      // ─── DKG round frames (frost_dkg_round{1,2,3}_request) ──────────────────
      // These are separate from the signing ceremony frames above.
      // The DKG establishes the K_server_X share before any signing ceremonies.
      const dkgReq = decodeFrostDkgRequest(requestBytes);
      if (dkgReq) {
        if (dkgReq.type === "frost_dkg_round1_request") {
          // OPS-AGENT-001: Token gate — FIRST operation before any crypto computation.
          // Token must be consumed before any FROST crypto begins (AC-006: consumption-on-presentation).
          // If tokenValidator is wired, the preAuthToken is mandatory.
          if (this.#tokenValidator) {
            const correlationId = Buffer.from(randomBytes(16)).toString("hex");
            const token = dkgReq.preAuthToken;
            const agentId = truncHex(dkgReq.agentPubkey);

            // AC-007: missing token → reject immediately
            if (!token || token.length === 0) {
              this.#logger?.warn("preauth.token.missing", {
                remoteAgentId: agentId,
                correlationId,
              });
              stream.send(lp.encode.single(CBOR_ENC.encode({
                type: "preauth_error",
                reason: "PRE_AUTH_TOKEN_MISSING",
              })));
              await stream.close();
              return;
            }

            // Validate+consume token (atomic for Pg path, no-op for DevTokenValidator)
            const validationResult = await this.#tokenValidator.validateToken(token);
            if (!validationResult.valid) {
              const reason = validationResult.reason;
              // Map rejection reasons to canonical error codes
              let errorCode: string;
              if (reason.includes("CONSUMED") || reason === "PRE_AUTH_TOKEN_CONSUMED") {
                errorCode = "PRE_AUTH_TOKEN_CONSUMED";
                // HIGH-2: use DB UUID from result.tokenId (not token string prefix)
                this.#logger?.warn("preauth.token.reuse.rejected", { tokenId: validationResult.tokenId, correlationId });
              } else if (reason.includes("EXPIRED") || reason === "PRE_AUTH_TOKEN_EXPIRED") {
                errorCode = "PRE_AUTH_TOKEN_EXPIRED";
                // HIGH-2: use DB UUID from result.tokenId (not token string prefix)
                this.#logger?.warn("preauth.token.expired", { tokenId: validationResult.tokenId, correlationId });
              } else if (reason === "PRE_AUTH_TOKEN_NOT_FOUND") {
                // MED-1: NOT_FOUND is distinct from MISSING — different log event
                errorCode = "PRE_AUTH_TOKEN_MISSING";
                this.#logger?.warn("preauth.token.not_found", { tokenPrefix: token.slice(0, 8), correlationId });
              } else {
                errorCode = "PRE_AUTH_TOKEN_MISSING";
                this.#logger?.warn("preauth.token.missing", { remoteAgentId: agentId, correlationId });
              }
              stream.send(lp.encode.single(CBOR_ENC.encode({
                type: "preauth_error",
                reason: errorCode,
              })));
              await stream.close();
              return;
            }

            // AC-002: token consumed successfully — log the event
            this.#logger?.info("preauth.token.consumed", {
              tokenId: validationResult.tokenId,
              agentId,
              correlationId,
            });

            // AC-005b: after successful DKG, link agent_profile to account
            // This is done after DKG completes (see post-round3 path), but we
            // stash the token metadata here for use after DKG completes.
            // Note: account linking happens in #processRegisterRequest after
            // dkg_complete is received — we store the phone_stub_hash for that.
            // For now, we store it in a per-agent map that #processRegisterRequest reads.
            this.#pendingPreAuthData.set(dkgReq.agentPubkey, {
              phoneStubHash: validationResult.phoneStubHash,
              emailDomain: validationResult.emailDomain,
            });
          }

          const result = await this.#frostHandler.dkgRound1(
            dkgReq.agentPubkey,
            dkgReq.epochId,
            dkgReq.signers,
          );
          // OBS-001 AC-004: FROST Round 1 commit log
          protocolLog("FROST", `Round 1 commit from peer ${truncHex(dkgReq.agentPubkey)} (1/1)`);
          const resp = result.ok
            ? encodeFrostDkgRound1Response({ type: "frost_dkg_round1_response", ok: true, broadcast: result.broadcast })
            : encodeFrostDkgRound1Response({ type: "frost_dkg_round1_response", ok: false, reason: result.reason });
          stream.send(lp.encode.single(resp));
          await stream.close();
          return;
        }

        if (dkgReq.type === "frost_dkg_round2_request") {
          const result = await this.#frostHandler.dkgRound2(
            dkgReq.agentPubkey,
            dkgReq.epochId,
            dkgReq.othersRound1,
          );
          if (result.ok) {
            // Map frost-handler DkgRound2Share (identifier/targetIdentifier)
            // → protocol-types DkgRound2Share (signerIdentifier/targetIdentifier)
            const sharesForOthers: import("@cello-protocol/protocol-types").DkgRound2Share[] = result.sharesForOthers.map((s) => ({
              signerIdentifier: s.identifier,
              targetIdentifier: s.targetIdentifier,
              signingShare: s.signingShare,
            }));
            stream.send(lp.encode.single(encodeFrostDkgRound2Response({ type: "frost_dkg_round2_response", ok: true, sharesForOthers })));
          } else {
            // Map frost-handler reason → protocol-types reason
            const reason: "round1_not_complete" | "verification_failed" | "internal_error" =
              result.reason === "not_in_round1" ? "round1_not_complete" : "internal_error";
            stream.send(lp.encode.single(encodeFrostDkgRound2Response({ type: "frost_dkg_round2_response", ok: false, reason })));
          }
          await stream.close();
          return;
        }

        if (dkgReq.type === "frost_dkg_round3_request") {
          // Map protocol-types DkgRound2Share (signerIdentifier/targetIdentifier)
          // → frost-handler DkgRound2Share (identifier/targetIdentifier)
          const sharesForMe = dkgReq.sharesForMe.map((s) => ({
            identifier: s.signerIdentifier,
            targetIdentifier: s.targetIdentifier,
            signingShare: s.signingShare,
          }));
          const result = await this.#frostHandler.dkgRound3(
            dkgReq.agentPubkey,
            dkgReq.epochId,
            sharesForMe,
            dkgReq.allRound1,
          );
          // OBS-001 AC-004: FROST Round 3 sign log
          protocolLog("FROST", `Round 3 sign from peer ${truncHex(dkgReq.agentPubkey)} (1/1)`);
          if (result.ok) {
            // Store the group public key temporarily for dkg_complete verification
            this.#pendingDkgCommitments.set(dkgReq.agentPubkey, result.shareCommitment);
            stream.send(lp.encode.single(encodeFrostDkgRound3Response({
              type: "frost_dkg_round3_response", ok: true, shareCommitment: result.shareCommitment,
            })));
          } else {
            // Map frost-handler reason → protocol-types reason
            const reason: "round2_not_complete" | "share_verification_failed" | "internal_error" =
              result.reason === "not_in_round2" ? "round2_not_complete" : result.reason;
            stream.send(lp.encode.single(encodeFrostDkgRound3Response({
              type: "frost_dkg_round3_response", ok: false, reason,
            })));
          }
          await stream.close();
          return;
        }
      }

      // Unknown frame type — close without response
      stream.abort(new Error("unknown_frost_frame_type"));
    } catch {
      // stream closed or reset
    } finally {
      stream.close().catch(() => {});
    }
  }

  /**
   * Expose FrostDirectoryHandler for in-process use by tests and by the
   * full-ceremony coordinator (FrostThresholdSigner with directoryNodes).
   */
  get frostHandler(): FrostDirectoryHandler {
    return this.#frostHandler;
  }

  // ─── Stream handler ──────────────────────────────────────────────────────────

  async #handleSignalingStream(stream: Stream): Promise<void> {
    // Sweep expired nonces on each new connection
    const now = this.#clock.now();
    for (const [k, e] of this.#nonces) {
      if (now > e.expiresAt) this.#nonces.delete(k);
    }

    const nonce = new Uint8Array(randomBytes(32));
    const nonceHex = Buffer.from(nonce).toString("hex");
    this.#nonces.set(nonceHex, { nonce, expiresAt: this.#clock.now() + NONCE_TTL_MS });

    try {
      await this.#sendFrame(stream, encodeSignalingAuthChallenge({ type: "signaling_auth_challenge", nonce }));
    } catch {
      stream.abort(new Error("send_failed"));
      return;
    }

    let authedPubkeyHex: string | null = null;
    let authed = false;

    try {
      for await (const chunk of lp.decode(stream)) {
        const frameBytes = chunk instanceof Uint8Array
          ? chunk
          : (chunk as unknown as { slice(): Uint8Array }).slice();

        if (!authed) {
          const parsed = decodeInboundSignalingFrame(frameBytes);
          if (!parsed || parsed.type !== "signaling_auth_response") {
            this.#sendFrame(stream, encodeNotAuthenticated({ type: "not_authenticated" }));
            stream.abort(new Error("expected_auth_response"));
            return;
          }

          const resp = parsed;
          const nonceEntry = this.#nonces.get(nonceHex);
          if (!nonceEntry) {
            this.#sendFrame(stream, encodeSignalingAuthFailed({ type: "signaling_auth_failed", reason: "nonce_unknown" }));
            stream.abort(new Error("nonce_unknown"));
            return;
          }
          if (this.#clock.now() > nonceEntry.expiresAt) {
            this.#nonces.delete(nonceHex);
            this.#sendFrame(stream, encodeSignalingAuthFailed({ type: "signaling_auth_failed", reason: "nonce_expired" }));
            stream.abort(new Error("nonce_expired"));
            return;
          }
          this.#nonces.delete(nonceHex);

          // Verify Ed25519(SHA-256("CELLO-DIR-AUTH-v1" || nonce || pubkey)) per spec
          const domain = Buffer.from(AUTH_DOMAIN, "utf8");
          const authMsg = new Uint8Array(Buffer.concat([domain, nonce, resp.pubkey]));
          const msgHash = new Uint8Array(createHash("sha256").update(authMsg).digest());
          if (!verify(resp.pubkey, msgHash, resp.signature)) {
            this.#sendFrame(stream, encodeSignalingAuthFailed({ type: "signaling_auth_failed", reason: "signature_invalid" }));
            stream.abort(new Error("signature_invalid"));
            return;
          }

          authedPubkeyHex = Buffer.from(resp.pubkey).toString("hex");
          this.#streams.set(authedPubkeyHex, stream);

          const existingDelegated = this.#delegatedSigners.get(authedPubkeyHex);
          this.#logger?.info("frost.debug.auth.setStreams", {
            authedShort: authedPubkeyHex.slice(0, 16),
            delegatedSignerFound: !!existingDelegated,
            streamsMapSize: this.#streams.size,
            allStreamKeys: [...this.#streams.keys()].map(k => k.slice(0, 16)),
            allDelegatedKeys: [...this.#delegatedSigners.keys()].map(k => k.slice(0, 16)),
          });
          if (existingDelegated) {
            existingDelegated.setStreams(this.#streams);
            this.#logger?.info("frost.debug.auth.setStreams_called", { authedShort: authedPubkeyHex.slice(0, 16) });
          } else {
            this.#logger?.warn("frost.debug.auth.setStreams_skipped_no_delegated", { authedShort: authedPubkeyHex.slice(0, 16) });
          }

          protocolLog("AUTH", `Peer ${truncHex(authedPubkeyHex)} authenticated (signaling)`);

          // ADAPTER-003: send auth ack so client can synchronize on auth completion.
          // This allows clients to know the directory has registered their stream
          // before sending session_request frames.
          this.#sendFrame(stream, encodeSignalingAuthOk({ type: "signaling_auth_ok" }));

          // Stash peer transport info for session assignments.
          // In M1 tests the peer_id is the node's Peer ID; multiaddrs are the listen addresses.
          // The stream object doesn't expose remote multiaddrs directly; callers must register
          // peer info via registerPeerInfo before sending session_request for the target.
          if (!this.#peerInfo.has(authedPubkeyHex)) {
            this.#peerInfo.set(authedPubkeyHex, { peer_id: "", multiaddrs: [] });
          }

          authed = true;

          // PERSIST-019: correlationId for tracing the reconnect drain flow
          const reconnectCorrelationId = Buffer.from(randomBytes(16)).toString("hex");

          // Flush any queued notifications (PERSIST-019: real Postgres drain, atomic SELECT+DELETE)
          const queued = await this.#store.drainNotifications(authedPubkeyHex, reconnectCorrelationId);

          for (const evt of queued) {
            try {
              if (evt.type === "session_abandoned") {
                this.#sendFrame(stream, encodeSessionAbandoned(evt));
              } else if (evt.type === "session_sealed") {
                this.#sendFrame(stream, encodeSessionSealed(evt));
              } else if (evt.type === "seal_verified") {
                this.#sendFrame(stream, encodeSealVerified(evt));
              } else if (evt.type === "connection_established") {
                this.#sendFrame(stream, encodeConnectionEstablished(evt));
              } else {
                this.#sendFrame(stream, encodeSessionSealRejected(evt));
              }
            } catch { break; }
          }

          // PERSIST-015 AC-003: deliver queued unilateral seal notifications (absent party reconnected)
          const unilateralNotifs = this.#pendingNotifications.get(authedPubkeyHex) ?? [];
          this.#pendingNotifications.delete(authedPubkeyHex);
          // SI-003 (double-delivery prevention): track which session IDs were delivered in-memory.
          // Using a per-session set rather than a coarse count to avoid the scenario where:
          //   - Session A seals → enters #pendingNotifications AND Pg
          //   - Directory restarts → #pendingNotifications cleared, Pg row for A persists
          //   - Session B seals → enters #pendingNotifications AND Pg
          //   - Agent reconnects → in-memory has [B only], Pg drain has [A, B]
          //   A count-based guard (count > 0) would ack A without delivering it — silent loss.
          //   A per-session-id set correctly delivers A from Pg while suppressing B from Pg.
          const deliveredInMemoryIds = new Set<string>();
          for (const notif of unilateralNotifs) {
            try {
              this.#sendFrame(stream, encodeSealUnilateralNotification({
                ...notif,
                seal_type: "UNILATERAL",
              }));
              deliveredInMemoryIds.add(Buffer.from(notif.session_id).toString("hex"));
            } catch { break; }
          }

          // PERSIST-023: drain Postgres-backed SEAL_UNILATERAL notifications (dev/staging/production).
          // Delivers notifications that survived directory restarts (AC-002).
          //
          // SI-003 (double-delivery prevention): only suppress a Pg row if its session_id_hex
          // is present in deliveredInMemoryIds (i.e. that specific session was delivered in-memory).
          // Pg rows for sessions NOT in the set must be delivered normally.
          if (this.#notificationQueue) {
            try {
              const pgNotifs = await this.#notificationQueue.drainUndelivered(authedPubkeyHex);
              for (const pgNotif of pgNotifs) {
                const p = pgNotif.payload as { session_id_hex?: string; sealed_root_hex?: string; sealed_at?: number };
                if (!p.session_id_hex || !p.sealed_root_hex || pgNotif.notificationType !== "seal_unilateral") {
                  // Unrecognised payload — acknowledge to remove from queue without delivering
                  void this.#notificationQueue!.acknowledge(pgNotif.notificationId).catch(() => {});
                  continue;
                }
                if (deliveredInMemoryIds.has(p.session_id_hex)) {
                  // Already delivered in-memory for this session — ack the Pg row without re-sending
                  void this.#notificationQueue!.acknowledge(pgNotif.notificationId).catch(() => {});
                  continue;
                }
                try {
                  this.#sendFrame(stream, encodeSealUnilateralNotification({
                    type: "seal_unilateral_notification",
                    session_id: Buffer.from(p.session_id_hex, "hex"),
                    sealed_root: Buffer.from(p.sealed_root_hex, "hex"),
                    sealed_at: p.sealed_at ?? 0,
                    seal_type: "UNILATERAL",
                  }));
                  // Acknowledge on successful delivery
                  void this.#notificationQueue!.acknowledge(pgNotif.notificationId).catch(() => {});
                } catch {
                  // Stream send failed — log notification.delivery.failed and continue
                  this.#logger?.warn("notification.delivery.failed", {
                    notificationId: pgNotif.notificationId,
                    recipientAgentId: authedPubkeyHex,
                    reason: "stream_send_failed",
                  });
                  break;
                }
              }
            } catch {
              // drainUndelivered failed — continue without Pg notifications (in-memory path above is fallback)
            }
          }

          // CONNREQ-002 DB-001: deliver queued pending connection requests (target reconnected)
          // PERSIST-019: real Postgres dequeue with 24h TTL filter, atomic SELECT+DELETE
          const pendingConnRequests = await this.#store.dequeuePendingConnectionRequests(authedPubkeyHex, reconnectCorrelationId);
          for (const pending of pendingConnRequests) {
            try {
              this.#sendFrame(stream, encodeConnectionRequestInbound(pending.frame));
              // Re-register in #pendingConnectionRequests so we can route the response
              this.#pendingConnectionRequests.set(pending.connection_request_id, {
                senderHex: pending.sender_pubkey,
                targetHex: authedPubkeyHex,
                packageCbor: pending.frame.package_cbor,
                requestId: pending.connection_request_id,
                disclosureRound: 1,
              });
              // M6B-010 AC-001: persist re-delivered request so a subsequent restart can
              // still find it in active_connection_requests. Fire-and-forget — failure is
              // non-blocking; the request is already in #pendingConnectionRequests.
              void this.#store.saveActiveConnectionRequest({
                connectionRequestId: pending.connection_request_id,
                senderPubkeyHex: pending.sender_pubkey,
                targetPubkeyHex: authedPubkeyHex,
                packageCbor: pending.frame.package_cbor,
                disclosureRound: 1,
                expiresAt: new Date(this.#clock.now() + 24 * 60 * 60 * 1000),
              }).catch(() => {});
            } catch { break; }
          }
          continue;
        }

        // Authenticated: process session_request, seal_frost_signature, or ceremony_result frames
        // ceremony_result: client sends combined FROST signature after running participateInCeremony
        let rawFrame: Record<string, unknown> | null = null;
        try { rawFrame = cborDecode(frameBytes) as Record<string, unknown>; } catch { /* ignore */ }
        if (rawFrame?.["type"] === "ceremony_result") {
          const ceremonyId = rawFrame["ceremony_id"] as string | undefined;
          const sigRaw = rawFrame["signature"];
          const sig = sigRaw instanceof Uint8Array ? sigRaw
            : Buffer.isBuffer(sigRaw) ? new Uint8Array(sigRaw as Buffer) : null;
          if (ceremonyId && authedPubkeyHex) {
            const delegated = this.#delegatedSigners.get(authedPubkeyHex);
            if (delegated) delegated.resolveFromClient(ceremonyId, sig);
          }
          continue;
        }

        // FEDERATION-003 AC-004: relay_pubkey_request — authenticated clients may query
        // the directory for a relay's registered public key to verify relay ACK signatures.
        // Handled before decodeInboundSignalingFrame because that function only knows protocol types.
        let rawFrameCheck: Record<string, unknown> | null = null;
        try { rawFrameCheck = cborDecode(frameBytes) as Record<string, unknown>; } catch { /* ignore */ }
        if (rawFrameCheck?.["type"] === "relay_pubkey_request") {
          const relayId = rawFrameCheck["relay_id"] as string | undefined;
          if (!relayId) {
            stream.send(lp.encode.single(CBOR_ENC.encode({ type: "relay_pubkey_error", reason: "missing_relay_id" })));
          } else {
            const publicKeyHex = await this.#store.getRelayPublicKey(relayId);
            if (!publicKeyHex) {
              stream.send(lp.encode.single(CBOR_ENC.encode({ type: "relay_pubkey_error", reason: "not_found" })));
            } else {
              stream.send(lp.encode.single(CBOR_ENC.encode({ type: "relay_pubkey_response", relay_id: relayId, public_key_hex: publicKeyHex })));
            }
          }
          continue;
        }

        const parsed = decodeInboundSignalingFrame(frameBytes);
        if (!parsed) {
          this.#sendFrame(stream, encodeNotAuthenticated({ type: "not_authenticated" }));
          continue;
        }
        if (parsed.type === "peer_info_announce") {
          // AC-014/AC-015 (NODE-001): client announces its libp2p Peer ID and listen addresses.
          // registerPeerInfo also marks the pubkey in #peerInfoAnnounced.
          this.registerPeerInfo(authedPubkeyHex!, parsed.peer_id, parsed.multiaddrs);
          // OBS-001 AC-003: peer announced peer_id + listen addrs
          protocolLog("AUTH", `Peer ${truncHex(authedPubkeyHex!)} announced peer_id + listen addrs`);
          continue;
        }
        if (parsed.type === "dkg_complete") {
          // REG-001: client completed DKG rounds and sends the derived primary_pubkey.
          // Resolve the pending promise in #processRegisterRequest.
          const resolve = this.#pendingDkgComplete.get(authedPubkeyHex!);
          if (resolve) {
            this.#pendingDkgComplete.delete(authedPubkeyHex!);
            resolve(parsed.primary_pubkey);
          }
          continue;
        }
        if (parsed.type === "register_request") {
          // REG-001: handle registration (runs concurrently; allows dkg_complete frames
          // to be processed by this same loop while DKG is in progress)
          void this.#processRegisterRequest(stream, authedPubkeyHex!, parsed);
        } else if (parsed.type === "session_request") {
          // REG-001 AC-009: refuse session_request if registration is required and the agent
          // has not completed it. requireRegistration defaults to false for backward compat.
          if (this.#requireRegistration && !this.#store.hasProfile(authedPubkeyHex!)) {
            this.#sendFrame(stream, encodeSessionRequestError({ type: "session_request_error", reason: "not_registered" }));
            continue;
          }
          // AC-014 (NODE-001): refuse session_request if peer_info has not been registered
          // (neither via wire peer_info_announce nor via direct registerPeerInfo call).
          if (!this.#peerInfoAnnounced.has(authedPubkeyHex!)) {
            this.#sendFrame(stream, encodeSessionRequestError({ type: "session_request_error", reason: "peer_not_registered" }));
            continue;
          }
          // Run concurrently — ceremony_result frames must be processed by this same loop
          // while #processSessionRequest is suspended awaiting the ceremony round-trip.
          void this.#processSessionRequest(stream, authedPubkeyHex!, Buffer.from(parsed.target_pubkey).toString("hex"), (parsed as { connection_id?: string }).connection_id, (parsed as { relay_rtt?: Record<string, number> }).relay_rtt);
        } else if (parsed.type === "seal_frost_signature") {
          void this.#processSealFrostSignature(authedPubkeyHex!, parsed);
        } else if (parsed.type === "connection_request") {
          // CONNREQ-002: process the connection request (runs concurrently)
          void this.#processConnectionRequest(stream, authedPubkeyHex!, parsed);
        } else if (parsed.type === "connection_response") {
          // CONNREQ-002: target responds to a connection request
          void this.#processConnectionResponse(stream, authedPubkeyHex!, parsed);
        } else if (parsed.type === "disclosure_request") {
          // CONNREQ-002 Round 2: target requests more disclosure from sender
          void this.#processDisclosureRequest(stream, authedPubkeyHex!, parsed);
        } else if (parsed.type === "disclosure_response") {
          // CONNREQ-002 Round 2: sender responds to disclosure request
          void this.#processDisclosureResponse(stream, authedPubkeyHex!, parsed);
        } else if (parsed.type === "seal_attempt") {
          // PERSIST-014: process seal attempt
          this.#processSealAttempt(stream, authedPubkeyHex!, parsed);
        } else if (parsed.type === "seal_unilateral") {
          // PERSIST-015: process unilateral seal request
          this.#processSealUnilateral(stream, authedPubkeyHex!, parsed);
        } else {
          // Unknown frame type for authenticated state — ignore
        }
      }
    } catch {
      // stream closed or reset — normal disconnect
    } finally {
      if (authedPubkeyHex && this.#streams.get(authedPubkeyHex) === stream) {
        this.#streams.delete(authedPubkeyHex);
      }

      // AC-011: clean up any provisional sessions where this client was a participant
      // but the session was not fully established before the stream closed.
      if (authedPubkeyHex) {
        for (const [sessionIdHex, pending] of this.#pendingSessions) {
          if (pending.initiatorHex === authedPubkeyHex || pending.targetHex === authedPubkeyHex) {
            this.#pendingSessions.delete(sessionIdHex);
            if (pending.fullyEstablished) continue; // session is live — no relay action needed
            void this.#relay.discardSession(pending.sessionId);
            // Notify the counterparty if they already received the assignment frame.
            // Which party received the frame depends on which side is disconnecting.
            const counterpartyHex = pending.initiatorHex === authedPubkeyHex
              ? pending.targetHex
              : pending.initiatorHex;
            const counterpartyGotAssignment = pending.initiatorHex === authedPubkeyHex
              ? pending.targetGotAssignment
              : pending.initiatorGotAssignment;
            if (counterpartyGotAssignment) {
              const abandonedFrame: SessionAbandoned = { type: "session_abandoned", session_id: pending.sessionId };
              const counterpartyStream = this.#streams.get(counterpartyHex);
              if (counterpartyStream) {
                try {
                  this.#sendFrame(counterpartyStream, encodeSessionAbandoned(abandonedFrame));
                } catch {
                  this.#store.enqueueNotification(counterpartyHex, abandonedFrame, sessionIdHex);
                }
              } else {
                this.#store.enqueueNotification(counterpartyHex, abandonedFrame, sessionIdHex);
              }
            }
          }
        }
      }

      // PERSIST-014: clean up any pending seal attempts where this client was a participant
      if (authedPubkeyHex) {
        for (const [sessionIdHex, attempts] of this.#pendingSealAttempts) {
          if (attempts.some((a) => a.partyHex === authedPubkeyHex)) {
            this.#pendingSealAttempts.delete(sessionIdHex);
          }
        }
      }

      // Close the write side so yamux can fully release the stream slot.
      // Without this, the stream stays half-open until the remote side closes its read,
      // which causes yamux to count it as active and eventually hit the stream limit.
      stream.close().catch(() => {});
    }
  }

  // ─── Peer info registration ──────────────────────────────────────────────────

  /**
   * Register transport peer info for an authenticated K_local pubkey.
   * Called either by the wire peer_info_announce path (via #handleSignalingStream)
   * or directly by the test harness (OOB path). Both paths mark the agent as having
   * announced its peer info, allowing subsequent session_request to proceed.
   * AC-014/AC-015 (NODE-001).
   */
  registerPeerInfo(pubkeyHex: string, peer_id: string, multiaddrs: string[]): void {
    this.#peerInfo.set(pubkeyHex, { peer_id, multiaddrs });
    this.#peerInfoAnnounced.add(pubkeyHex);
  }

  /**
   * SESSION-004: Register a FROST threshold signer for the given initiator pubkey.
   * The signer is invoked when the initiator sends a session_request to produce
   * a FROST-signed SessionAssignment.
   */
  registerThresholdSigner(pubkeyHex: string, signer: IThresholdSigner): void {
    this.#thresholdSigners.set(pubkeyHex, signer);
  }

  /** Register a ClientDelegatedSigner so FROST ceremony results can be routed back to the client. */
  registerDelegatedSigner(pubkeyHex: string, signer: ClientDelegatedSigner): void {
    this.#delegatedSigners.set(pubkeyHex, signer);
  }

  /**
   * Register the FROST group public key (primary_pubkey) for a K_local identity.
   * SESSION-005: called by the test harness or by the SESSION-004 establishment flow
   * (once SESSION-004 is implemented) to associate a primary_pubkey with an agent.
   * The directory uses this pubkey to verify the combined FROST signature submitted
   * by the seal initiator during the seal ceremony.
   */
  registerPrimaryPubkey(pubkeyHex: string, primaryPubkey: Uint8Array): void {
    this.#primaryPubkeys.set(pubkeyHex, new Uint8Array(primaryPubkey));
  }

  // ─── REG-001: Profile accessors (proxy to store) ────────────────────────────

  hasProfile(kLocalPubkeyHex: string): boolean {
    return this.#store.hasProfile(kLocalPubkeyHex);
  }

  getProfile(kLocalPubkeyHex: string): import("@cello-protocol/protocol-types").AgentProfile | undefined {
    return this.#store.getProfile(kLocalPubkeyHex);
  }

  getThresholdSignerForTest(kLocalPubkeyHex: string): IThresholdSigner | undefined {
    if (process.env.NODE_ENV !== "test") throw new Error("test-only");
    return this.#thresholdSigners.get(kLocalPubkeyHex);
  }

  // ─── REG-001: Registration processing ───────────────────────────────────────

  /**
   * Process a register_request frame from an authenticated client.
   * REG-001 Phase P pseudocode:
   *   1. Validate phone_stub non-empty (→ invalid_verification)
   *   2. Check k_local_pubkey not already registered (→ already_registered)
   *   3. Check SHA-256(phone_stub) not already claimed (→ phone_already_claimed)
   *      SI-001: raw phone_stub NEVER stored or logged
   *   4. Send dkg_ready { epochId, participants, threshold } to client
   *      Client opens /cello/frost/1.0.0 streams, runs DKG rounds, sends dkg_complete
   *      SI-002: no profile created without successful DKG
   *      SI-003: DKG shares NEVER in wire messages or profiles
   *   5. Await dkg_complete from client with primary_pubkey
   *   6. Verify primary_pubkey matches what DKG round3 produced
   *   7. Create AgentProfile, send register_success
   *
   * RFC 9591 (FROST DKG), FIPS 180-4 (SHA-256), NIST FIPS 204 (ML-DSA)
   */
  async #processRegisterRequest(
    stream: Stream,
    authedPubkeyHex: string,
    frame: import("@cello-protocol/protocol-types").RegisterRequest,
  ): Promise<void> {
    // SI-004: auth gate — authedPubkeyHex is already verified above (only reached after auth)

    // Step 1: Validate phone_stub non-empty.
    // AC-006 (DX-001) PART 1: When #tokenValidator is wired (M6+ path), phone_stub may be
    // empty — the pre_auth_token provides the real phone_stub_hash via #pendingPreAuthData
    // (set during DKG Round 1). We defer the empty check to Step 3b (post-DKG).
    // When #tokenValidator is NOT wired (legacy/test path), reject immediately on empty.
    const phoneStubIsEmpty = !frame.phone_stub || frame.phone_stub.length === 0;
    if (phoneStubIsEmpty && !this.#tokenValidator) {
      // Legacy path: no token validator configured and empty phone_stub → reject
      this.#pendingPreAuthData.delete(frame.k_local_pubkey);
      this.#sendFrame(stream, encodeRegisterError({ type: "register_error", reason: "invalid_verification" }));
      return;
    }

    // Step 2: Check if pubkey already registered
    // Include profile data so the client can reconstruct RegistrationState without a new DKG.
    const existingProfile = this.#store.getProfile(frame.k_local_pubkey);
    if (existingProfile) {
      // HIGH-3: clean up pending pre-auth data on all early-return paths
      this.#pendingPreAuthData.delete(frame.k_local_pubkey);
      this.#sendFrame(stream, encodeRegisterError({
        type: "register_error",
        reason: "already_registered",
        agent_id: existingProfile.agent_id,
        primary_pubkey: existingProfile.primary_pubkey,
        ml_dsa_pubkey: existingProfile.ml_dsa_pubkey,
      }));
      return;
    }

    // Step 4: Run FROST DKG (real interactive DKG — REG-001)
    // Send dkg_ready — authorizes the client to open DKG streams on /cello/frost/1.0.0
    // SI-002: profile only created after successful DKG
    if (this.#forceDkgFailure) {
      // OBS-001: DKG failed log
      protocolLog("REG", `DKG failed — agent ${truncHex(frame.k_local_pubkey)}, reason: forced_failure`);
      // HIGH-3: clean up pending pre-auth data on all early-return paths
      this.#pendingPreAuthData.delete(frame.k_local_pubkey);
      this.#sendFrame(stream, encodeRegisterError({ type: "register_error", reason: "dkg_failed" }));
      return;
    }

    const epochId = `${frame.k_local_pubkey}:epoch:1`;
    // OBS-001 AC-004: DKG begin log
    // 1 directory node + 1 client = 2 total DKG participants, threshold 2
    protocolLog("REG", `DKG begin — agent ${truncHex(frame.k_local_pubkey)}, 1 directory nodes, threshold 2`);
    // DKG requires min 2 participants per @noble/curves constraint.
    // participants=1 means this directory node + the client = 2 total DKG participants.
    this.#sendFrame(stream, encodeDkgReady({
      type: "dkg_ready",
      epochId,
      participants: 1,
      threshold: 2,
    }));

    // Wait for dkg_complete from the client with primary_pubkey.
    // The client opens /cello/frost/1.0.0 streams, runs DKG rounds, derives primary_pubkey,
    // and sends dkg_complete on this signaling stream.
    // The signaling stream loop routes dkg_complete to us via #pendingDkgComplete.
    // IMPORTANT: During this await, DKG Round 1 fires on the frost stream and may call
    // #pendingPreAuthData.set(). So pendingPreAuthData IS available after this await.
    const DKG_TIMEOUT_MS = 30_000;
    let primaryPubkeyFromDkg: string;
    try {
      const clientPrimaryPubkey = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.#pendingDkgComplete.delete(frame.k_local_pubkey);
          reject(new Error("dkg_complete_timeout"));
        }, DKG_TIMEOUT_MS);
        this.#pendingDkgComplete.set(frame.k_local_pubkey, (pk) => {
          clearTimeout(timer);
          resolve(pk);
        });
      });
      primaryPubkeyFromDkg = clientPrimaryPubkey;

      // Step 5: Verify primary_pubkey matches what DKG round3 produced for this directory node.
      // The directory node's DKG round3 stores shareCommitment in #pendingDkgCommitments.
      const storedCommitment = this.#pendingDkgCommitments.get(frame.k_local_pubkey);
      this.#pendingDkgCommitments.delete(frame.k_local_pubkey);
      if (storedCommitment) {
        // Verify: client-reported primary_pubkey must match directory-computed shareCommitment
        const expectedHex = Buffer.from(storedCommitment).toString("hex");
        if (clientPrimaryPubkey !== expectedHex) {
          // HIGH-3: clean up pending pre-auth data on all early-return paths
          this.#pendingPreAuthData.delete(frame.k_local_pubkey);
          this.#sendFrame(stream, encodeRegisterError({ type: "register_error", reason: "dkg_verification_failed" }));
          return;
        }
      }
      // If no stored commitment (e.g., client connected to a different directory node),
      // accept the client's primary_pubkey as-is (multi-node DKG: threshold verification).

      // Register a ClientDelegatedSigner so future session_request can use FROST signing.
      // The directory delegates signing back to the client (which holds the coordinator share).
      // When participateInCeremony is called, the client runs the ceremony and returns the result.
      const primaryPubkeyBytes = Buffer.from(primaryPubkeyFromDkg, "hex");
      const delegatedSigner = new ClientDelegatedSigner(frame.k_local_pubkey, new Uint8Array(primaryPubkeyBytes));
      delegatedSigner.setStreams(this.#streams);
      this.#delegatedSigners.set(frame.k_local_pubkey, delegatedSigner);
      this.registerThresholdSigner(frame.k_local_pubkey, delegatedSigner);
      this.registerPrimaryPubkey(frame.k_local_pubkey, new Uint8Array(primaryPubkeyBytes));
    } catch {
      // HIGH-3: clean up pending pre-auth data on DKG failure/timeout
      this.#pendingPreAuthData.delete(frame.k_local_pubkey);
      this.#sendFrame(stream, encodeRegisterError({ type: "register_error", reason: "dkg_failed" }));
      return;
    }

    // Step 3b (post-DKG): Compute phoneStubHash now that DKG has completed and
    // #pendingPreAuthData is available (set during DKG round 1 on the frost stream).
    // AC-006 (DX-001) PART 2: Use preAuthData.phoneStubHash when pre_auth_token was consumed.
    // This MUST happen before the hasPhoneStubHash check to ensure each agent's real
    // phone hash is used for uniqueness, not SHA-256('') which would be the same for all.
    let phoneStubHash: string;
    const preAuthDataForHash = this.#pendingPreAuthData.get(frame.k_local_pubkey);
    if (preAuthDataForHash) {
      // Pre-auth path: use the token's phone_stub_hash (real phone hash, not SHA-256(''))
      phoneStubHash = preAuthDataForHash.phoneStubHash;
    } else if (phoneStubIsEmpty) {
      // No pre_auth_token and empty phone_stub: reject (should have been caught above,
      // but belt-and-suspenders guard in case #pendingPreAuthData was not set by DKG)
      this.#pendingPreAuthData.delete(frame.k_local_pubkey);
      this.#sendFrame(stream, encodeRegisterError({ type: "register_error", reason: "invalid_verification" }));
      return;
    } else {
      // Legacy path: hash the client-supplied phone_stub (SI-001: FIPS 180-4 SHA-256)
      phoneStubHash = createHash("sha256").update(frame.phone_stub, "utf8").digest("hex");
    }

    // Phone stub hash uniqueness check (SI-001: never store or log raw phone_stub)
    if (this.#store.hasPhoneStubHash(phoneStubHash)) {
      // HIGH-3: clean up pending pre-auth data on all early-return paths
      this.#pendingPreAuthData.delete(frame.k_local_pubkey);
      this.#sendFrame(stream, encodeRegisterError({ type: "register_error", reason: "phone_already_claimed" }));
      return;
    }

    // Step 6: Create AgentProfile and send register_success
    // SI-001: phone_stub raw value NEVER stored
    // SI-002: only reached after successful FROST DKG
    // SI-003: DKG shares not in profile
    const agentId = Buffer.from(randomBytes(16)).toString("hex");
    const profile: AgentProfile = {
      k_local_pubkey: frame.k_local_pubkey,
      primary_pubkey: primaryPubkeyFromDkg,
      ml_dsa_pubkey: frame.ml_dsa_pubkey,
      phone_stub_hash: phoneStubHash,  // SHA-256 only, per FIPS 180-4 — raw stub never stored
      profile: {},
      registered_at: this.#clock.now(),
      status: "active",
      agent_id: agentId,
    };
    this.#store.setProfile(profile);

    // OPS-AGENT-001 AC-005b: Account deduplication — link agent_profile to account.
    // This runs fire-and-forget: account linking failure does not block registration.
    // Note: preAuthDataForHash was fetched above in Step 3b; use it here to avoid a second
    // map lookup. Also delete the entry from #pendingPreAuthData (cleanup on success path).
    this.#pendingPreAuthData.delete(frame.k_local_pubkey);
    if (this.#pgPool && preAuthDataForHash) {
      void linkAgentToAccount(this.#pgPool, {
        agentProfileId: agentId,
        kLocalPubkey: frame.k_local_pubkey,
        phoneStubHash: preAuthDataForHash.phoneStubHash,
      }).catch((err: unknown) => {
        const reason = err instanceof Error ? err.message : String(err);
        this.#logger?.error("preauth.account.link.failed", {
          agentId,
          reason,
        });
      });
    }

    // OBS-001 AC-004: agent registered log
    protocolLog("REG", `Agent ${truncHex(frame.k_local_pubkey)} registered — primary_pubkey ${truncHex(primaryPubkeyFromDkg)}`);

    this.#sendFrame(stream, encodeRegisterSuccess({
      type: "register_success",
      agent_id: agentId,
      primary_pubkey: primaryPubkeyFromDkg,
    }));
  }

  // ─── CONNREQ-002: Connection request processing ──────────────────────────────

  /**
   * Process a connection_request frame from sender A directed at target B.
   * CONNREQ-002 Phase P:
   *   1. requireRegistration gate: sender must be registered
   *   2. target must be registered (profile exists)
   *   3. no existing active connection between A and B
   *   4. relay to target's stream as connection_request_inbound (or queue if offline)
   */
  async #processConnectionRequest(
    stream: Stream,
    senderHex: string,
    frame: import("@cello-protocol/protocol-types").ConnectionRequest,
  ): Promise<void> {
    const targetHex = frame.target_pubkey;

    // OBS-001 AC-005/AC-006: connection request log
    protocolLog("CONN", `Request: ${truncHex(senderHex)} → ${truncHex(targetHex)}`);
    // CONNREQ-003 AC-001/AC-002: structured event so tests can assert transport-path evidence
    this.#logger?.info("connection.request.received", { senderPubkeyHex: senderHex, targetPubkeyHex: targetHex });

    // Gate 1: sender must be registered if requireRegistration is set
    if (this.#requireRegistration && !this.#store.hasProfile(senderHex)) {
      protocolLog("CONN", `Pre-check failed: not_registered (sender: ${truncHex(senderHex)})`);
      this.#sendFrame(stream, encodeConnectionRequestError({ type: "connection_request_error", reason: "not_registered" }));
      return;
    }

    // Gate 2: target must have a profile
    if (!this.#store.hasProfile(targetHex)) {
      protocolLog("CONN", `Pre-check failed: target_not_found (sender: ${truncHex(senderHex)})`);
      this.#sendFrame(stream, encodeConnectionRequestError({ type: "connection_request_error", reason: "target_not_found" }));
      return;
    }

    // Gate 3: no existing active connection.
    // Include the connection_id so the client can hydrate and proceed without a new request.
    const existingConn = await this.#store.hasConnection(senderHex, targetHex);
    if (existingConn) {
      protocolLog("CONN", `Pre-check failed: already_connected (sender: ${truncHex(senderHex)}, connection: ${truncHex(existingConn.connection_id)})`);
      this.#sendFrame(stream, encodeConnectionRequestError({
        type: "connection_request_error",
        reason: "already_connected",
        connection_id: existingConn.connection_id,
      }));
      return;
    }

    // Assign a connection_request_id for Round 2 correlation
    const connectionRequestId = Buffer.from(randomBytes(16)).toString("hex");

    // Get sender context from profile
    const senderProfile = this.#store.getProfile(senderHex);
    const senderRegisteredAt = senderProfile?.registered_at ?? this.#clock.now();
    const senderIsProvisional = senderProfile?.status !== "active";

    const relayedPackageCbor = this.#packageCborInterceptor
      ? this.#packageCborInterceptor(frame.package_cbor)
      : frame.package_cbor;

    const inboundFrame: import("@cello-protocol/protocol-types").ConnectionRequestInbound = {
      type: "connection_request_inbound",
      from_pubkey: senderHex,
      connection_request_id: connectionRequestId,
      package_cbor: relayedPackageCbor,
      sender_registered_at: senderRegisteredAt,
      sender_is_provisional: senderIsProvisional,
    };

    // Try to deliver to target's stream
    const targetStream = this.#streams.get(targetHex);
    if (targetStream) {
      // Store pending request state for routing the response back to sender
      this.#pendingConnectionRequests.set(connectionRequestId, {
        senderHex,
        targetHex,
        packageCbor: frame.package_cbor,
        requestId: connectionRequestId,
        disclosureRound: 1,
      });
      // M6B-010 AC-001: persist to Postgres so restart recovery can reload this request.
      // Fire-and-forget — failure does not block delivery; worst case is the request is
      // not in active_connection_requests after a restart (falls back to no state).
      void this.#store.saveActiveConnectionRequest({
        connectionRequestId,
        senderPubkeyHex: senderHex,
        targetPubkeyHex: targetHex,
        packageCbor: frame.package_cbor,
        disclosureRound: 1,
        expiresAt: new Date(this.#clock.now() + 24 * 60 * 60 * 1000),
      }).catch(() => { /* persistence failure does not block in-memory delivery */ });
      // OBS-001 AC-005: relayed to target
      protocolLog("CONN", `Relayed to target ${truncHex(targetHex)}`);
      try {
        this.#sendFrame(targetStream, encodeConnectionRequestInbound(inboundFrame));
      } catch {
        // Target stream failed — queue the request
        this.#pendingConnectionRequests.delete(connectionRequestId);
        void this.#store.deleteActiveConnectionRequest(connectionRequestId).catch(() => {});
        const queued = this.#store.queuePendingConnectionRequest(targetHex, {
          connection_request_id: connectionRequestId,
          sender_pubkey: senderHex,
          frame: inboundFrame,
          queued_at: this.#clock.now(),
        });
        if (!queued) {
          // Queue was full — drop oldest occurred; notify sender
          this.#sendFrame(stream, encodeConnectionRequestError({ type: "connection_request_error", reason: "target_unavailable" }));
        }
        // Otherwise leave A waiting (timeout will fire on client side)
      }
    } else {
      // Target offline — queue the request
      const queued = this.#store.queuePendingConnectionRequest(targetHex, {
        connection_request_id: connectionRequestId,
        sender_pubkey: senderHex,
        frame: inboundFrame,
        queued_at: this.#clock.now(),
      });
      if (!queued) {
        // Queue was full
        this.#sendFrame(stream, encodeConnectionRequestError({ type: "connection_request_error", reason: "target_unavailable" }));
      }
      // Else: A waits with no immediate response — timeout fires on client side
    }
  }

  /**
   * Process a connection_response from target B.
   * Verdicts: accept → create connection + notify both; reject → notify sender; insufficient → notify sender.
   */
  async #processConnectionResponse(
    _stream: Stream,
    responderHex: string,
    frame: import("@cello-protocol/protocol-types").ConnectionResponse,
  ): Promise<void> {
    const pending = this.#pendingConnectionRequests.get(frame.connection_request_id);
    if (!pending) return;
    if (pending.targetHex !== responderHex) return; // wrong responder

    this.#pendingConnectionRequests.delete(frame.connection_request_id);
    // M6B-010 AC-001: remove from active_connection_requests so it is not reloaded on restart.
    void this.#store.deleteActiveConnectionRequest(frame.connection_request_id).catch(() => {});

    const senderStream = this.#streams.get(pending.senderHex);

    if (frame.verdict === "accept") {
      // Generate connection_id (16-byte CSPRNG per FIPS 180-4)
      const connectionId = Buffer.from(randomBytes(16)).toString("hex");
      // SI-001: record the accepted request before createConnection so the
      // PgDirectoryStore guard finds a matching ACCEPTED row.
      await this.#store.recordAcceptedConnectionRequest(
        pending.requestId,
        pending.senderHex,
        pending.targetHex,
      );
      // createConnection validates connection_id against connection_requests and logs connection.persisted.
      // pending.requestId is the correlationId minted when the connection request was received.
      await this.#store.createConnection(connectionId, pending.senderHex, pending.targetHex, this.#clock.now(), pending.requestId);

      // OBS-001 AC-005: verdict accept + connection established
      protocolLog("CONN", `Verdict accept — ${truncHex(connectionId)}`);
      protocolLog("CONN", `Connection ${truncHex(connectionId)} established: ${truncHex(pending.senderHex)} ↔ ${truncHex(pending.targetHex)}`);

      // Notify both clients
      const toSender: import("@cello-protocol/protocol-types").ConnectionEstablished = {
        type: "connection_established",
        counterparty_pubkey: pending.targetHex,
        connection_id: connectionId,
      };
      const toTarget: import("@cello-protocol/protocol-types").ConnectionEstablished = {
        type: "connection_established",
        counterparty_pubkey: pending.senderHex,
        connection_id: connectionId,
      };
      // Queue for sender (delivered on next auth). Client deduplicates via connection_id.
      this.#store.enqueueNotification(pending.senderHex, toSender, connectionId);
      // Also attempt immediate delivery if stream appears live.
      if (senderStream) {
        try { this.#sendFrame(senderStream, encodeConnectionEstablished(toSender)); } catch {}
      }
      const targetStream = this.#streams.get(pending.targetHex);
      if (targetStream) {
        try { this.#sendFrame(targetStream, encodeConnectionEstablished(toTarget)); } catch {}
      }
    } else if (frame.verdict === "reject") {
      // OBS-001: verdict reject
      protocolLog("CONN", `Verdict reject — ${frame.reason ?? "rejected"}`);
      if (senderStream) {
        try {
          this.#sendFrame(senderStream, encodeConnectionRejected({
            type: "connection_rejected",
            target_pubkey: pending.targetHex,
            reason: frame.reason ?? "rejected",
          }));
        } catch {}
      }
    } else if (frame.verdict === "insufficient") {
      // OBS-001: verdict insufficient
      protocolLog("CONN", `Verdict insufficient — unmet_requirements`);
      if (senderStream) {
        try {
          this.#sendFrame(senderStream, encodeConnectionInsufficient({
            type: "connection_insufficient",
            target_pubkey: pending.targetHex,
            unmet_requirements: frame.unmet_requirements ?? [],
          }));
        } catch {}
      }
    }
  }

  /**
   * Process a disclosure_request from target B (Round 2 initiation).
   * Relays as disclosure_request_inbound to sender A.
   */
  async #processDisclosureRequest(
    _stream: Stream,
    requesterHex: string,
    frame: import("@cello-protocol/protocol-types").DisclosureRequest,
  ): Promise<void> {
    const pending = this.#pendingConnectionRequests.get(frame.connection_request_id);
    if (!pending) return;
    if (pending.targetHex !== requesterHex) return;

    // Advance to Round 2
    pending.disclosureRound = 2;

    // OBS-001 AC-007: disclosure request forwarded (Round 2)
    protocolLog("CONN", `Disclosure request forwarded (Round 2): ${truncHex(requesterHex)} → ${truncHex(pending.senderHex)}`);

    const senderStream = this.#streams.get(pending.senderHex);
    if (senderStream) {
      try {
        this.#sendFrame(senderStream, encodeDisclosureRequestInbound({
          type: "disclosure_request_inbound",
          from_pubkey: requesterHex,
          connection_request_id: frame.connection_request_id,
          requested_items: frame.requested_items,
        }));
      } catch {}
    }
  }

  /**
   * Process a disclosure_response from sender A (Round 2 response).
   * Relays as disclosure_response_inbound to target B.
   */
  async #processDisclosureResponse(
    _stream: Stream,
    senderHex: string,
    frame: import("@cello-protocol/protocol-types").DisclosureResponse,
  ): Promise<void> {
    const pending = this.#pendingConnectionRequests.get(frame.connection_request_id);
    if (!pending) return;
    if (pending.senderHex !== senderHex) return;

    // OBS-001 AC-007: disclosure response forwarded
    protocolLog("CONN", `Disclosure response forwarded: ${truncHex(senderHex)} → ${truncHex(pending.targetHex)}`);

    const targetStream = this.#streams.get(pending.targetHex);
    if (targetStream) {
      try {
        this.#sendFrame(targetStream, encodeDisclosureResponseInbound({
          type: "disclosure_response_inbound",
          connection_request_id: frame.connection_request_id,
          package_cbor: frame.package_cbor,
        }));
      } catch {}
    }
  }

  // ─── Session request processing ──────────────────────────────────────────────

  async #processSessionRequest(
    stream: Stream,
    initiatorHex: string,
    targetHex: string,
    connectionId?: string,
    relayRtt?: Record<string, number>,
  ): Promise<void> {
    protocolLog("SESS", `Session request: ${truncHex(initiatorHex)} → ${truncHex(targetHex)}`);
    this.#logger?.info("frost.debug.session_request.enter", {
      initiatorShort: initiatorHex.slice(0, 16), targetShort: targetHex.slice(0, 16),
      connectionId, requireConnectionGate: this.#requireConnectionGate,
      streamsSize: this.#streams.size,
      allStreamKeys: [...this.#streams.keys()].map(k => k.slice(0, 16)),
      thresholdSignersSize: this.#thresholdSigners.size,
      allThresholdSignerKeys: [...this.#thresholdSigners.keys()].map(k => k.slice(0, 16)),
      delegatedSignersSize: this.#delegatedSigners.size,
    });

    // SESSION-006: enforce connection gate if configured
    if (this.#requireConnectionGate) {
      if (!connectionId) {
        protocolLog("SESS", `Request failed — agent ${truncHex(initiatorHex)}, reason: connection_id_required`);
        this.#sendFrame(stream, encodeSessionRequestError({ type: "session_request_error", reason: "connection_id_required" }));
        return;
      }
      const conn = await this.#store.hasConnection(initiatorHex, targetHex);
      if (!conn || conn.connection_id !== connectionId) {
        protocolLog("SESS", `Request failed — agent ${truncHex(initiatorHex)}, reason: no_connection`);
        this.#sendFrame(stream, encodeSessionRequestError({ type: "session_request_error", reason: "no_connection" }));
        return;
      }
    }

    // (a) Verify target is currently authenticated
    const targetStream = this.#streams.get(targetHex);
    this.#logger?.info("frost.debug.session_request.target_stream", {
      targetShort: targetHex.slice(0, 16), targetStreamFound: !!targetStream,
    });
    if (!targetStream) {
      protocolLog("SESS", `Request failed — agent ${truncHex(initiatorHex)}, reason: target_offline`);
      this.#sendFrame(stream, encodeSessionRequestError({ type: "session_request_error", reason: "target_offline" }));
      return;
    }

    // SESSION-004 Step 1: Check for injected IThresholdSigner (CRITICAL-2: fail loudly if absent)
    const signer = this.#thresholdSigners.get(initiatorHex);
    this.#logger?.info("frost.debug.session_request.signer_lookup", {
      initiatorShort: initiatorHex.slice(0, 16),
      signerFound: !!signer,
      signerType: signer?.constructor?.name ?? "null",
      delegatedSignerFound: !!this.#delegatedSigners.get(initiatorHex),
      delegatedSignerStreamsNull: (() => {
        const ds = this.#delegatedSigners.get(initiatorHex);
        if (!ds) return "no_delegated_signer";
        return (ds as unknown as { _streams?: unknown })._streams === null ? "NULL" : "SET";
      })(),
    });
    if (!signer) {
      protocolLog("SESS", `Request failed — agent ${truncHex(initiatorHex)}, reason: frost_signer_not_configured`);
      this.#sendFrame(stream, encodeSessionRequestError({ type: "session_request_error", reason: "frost_signer_not_configured" }));
      return;
    }

    // (b) Generate 16-byte CSPRNG session_id
    const session_id = new Uint8Array(randomBytes(16));

    // (d) Collect participant info
    const session_timestamp = this.#clock.now();
    const dirPubkey = await this.#keyProvider.getPublicKey();

    const initiatorInfo = this.#peerInfo.get(initiatorHex) ?? { peer_id: "", multiaddrs: [] };
    const targetInfo = this.#peerInfo.get(targetHex) ?? { peer_id: "", multiaddrs: [] };
    const initiatorPubkey = Buffer.from(initiatorHex, "hex");
    const targetPubkey = Buffer.from(targetHex, "hex");

    // SESSION-004 Step 2: Compute genesis_prev_root (RFC 8032 / FIPS 180-4)
    const genesis_prev_root = computeGenesisPrevRoot(
      new Uint8Array(initiatorPubkey),
      new Uint8Array(targetPubkey),
      session_id,
      session_timestamp,
    );

    // SESSION-004 Step 3: Build TBS — single source of truth via protocol-types (HIGH-5)
    // Fields: [session_id, pubA, pubB, genesis_prev_root, timestamp]
    const tbs = buildSessionEstablishmentTbs(
      session_id,
      new Uint8Array(initiatorPubkey),
      new Uint8Array(targetPubkey),
      genesis_prev_root,
      session_timestamp,
    );

    // SESSION-004 Step 4: Conflict detection (MEDIUM-N1 fix + IMPORTANT-N3 fix)
    // ceremonyId is unique per session_id → two concurrent ceremonies produce different
    // peerIdString values → conflict fires correctly.
    // IMPORTANT-N3: conflict check and early return happen BEFORE markInFlight so
    // clearInFlight is only called when markInFlight was actually called.
    // M2: epoch 1 hardcoded. In M3, derive from the signer's active key rotation epoch.
    const epochId = `${initiatorHex}:epoch:1`;
    const ceremonyId = `session-${Buffer.from(session_id).toString("hex")}`;  // unique per ceremony
    const conflict = this.#frostHandler.checkConflict(initiatorHex, epochId, ceremonyId, ceremonyId);
    if (conflict) {
      this.#logger?.warn("frost.ceremony.conflict", { agentId: initiatorHex.slice(0, 16) });
      this.#sendFrame(stream, encodeSessionRequestError({ type: "session_request_error", reason: "ceremony_conflict" }));
      return;
    }

    this.#frostHandler.markInFlight(initiatorHex, epochId, ceremonyId, ceremonyId);

    try {
      // SESSION-004 Step 5: FROST ceremony (RFC 9591 §5 coordinator flow)
      // OBS-001 AC-008: FROST ceremony begin
      const sessionIdHex8 = truncHex(Buffer.from(session_id).toString("hex"));
      protocolLog("FROST", `Ceremony begin — session ${sessionIdHex8}, agent ${truncHex(initiatorHex)}`);
      const result = await signer.participateInCeremony(ceremonyId, tbs, CONTEXT_SESSION_ESTABLISHMENT, (ev) => {
        if (ev.type === "commit_collected") {
          protocolLog("FROST", `Commit collected (${ev.index}/${ev.total})`);
        } else if (ev.type === "partial_sig_collected") {
          protocolLog("FROST", `Partial sig collected (${ev.index}/${ev.total})`);
        }
      });
      if (!result.ok) {
        // M6B-002: Map FROST ceremony failure reason to wire reason
        const wireReason = mapCeremonyFailure(result.error.reason);

        // M6B-002: Structured log event with distinct reason
        this.#logger?.warn("frost.ceremony.failed", {
          agentId: initiatorHex.slice(0, 16),
          reason: wireReason,
          ceremonyId: ceremonyId.slice(0, 16),
        });

        protocolLog("SESS", `Request failed — agent ${truncHex(initiatorHex)}, reason: ${wireReason}`);
        this.#sendFrame(stream, encodeSessionRequestError({ type: "session_request_error", reason: wireReason }));
        return;
      }
      const frostedSig = result.signature;

      // SESSION-004 Step 6: getPrimaryPubkey() — HIGH-4: method on IThresholdSigner interface
      const initiatorPrimaryPubkey = signer.getPrimaryPubkey();

      // CELLO-RELAY-001: Resolve relay endpoint.
      // When RelayPoolManager is configured, use pickRelay() for dynamic assignment.
      // Fall back to the hardcoded relayEndpoint for backward compatibility.
      let resolvedRelayEndpoint = this.#relayEndpoint;
      if (this.#relayPoolManager) {
        const picked = this.#relayPoolManager.pickRelay(relayRtt);
        if (!picked) {
          // AC-006: all relays unavailable — relay.pool.unavailable already logged by pickRelay()
          protocolLog("SESS", `Request failed — agent ${truncHex(initiatorHex)}, reason: relay_unavailable`);
          this.#sendFrame(stream, encodeSessionRequestError({ type: "session_request_error", reason: "relay_unavailable" }));
          return;
        }
        resolvedRelayEndpoint = {
          peer_id: picked.peerId ?? picked.relayId,
          multiaddrs: picked.multiaddrs ?? [picked.endpoint],
        };
      }

      // SESSION-004 Step 7: Build SessionAssignment with signature_type: 'frost'
      const assignment: SessionAssignment = {
        session_id,
        participant_a: { pubkey: new Uint8Array(initiatorPubkey), peer_id: initiatorInfo.peer_id, multiaddrs: initiatorInfo.multiaddrs },
        participant_b: { pubkey: new Uint8Array(targetPubkey), peer_id: targetInfo.peer_id, multiaddrs: targetInfo.multiaddrs },
        relay_endpoint: resolvedRelayEndpoint,
        directory_endpoint: this.#directoryEndpoint,
        session_timestamp,
        directory_pubkey: new Uint8Array(dirPubkey),
        directory_signature: new Uint8Array(frostedSig),
        signature_type: "frost",
        signer_pubkey: initiatorPrimaryPubkey,
      };

      // (e) Register with relay BEFORE delivering to clients (SI-003)
      // The relay verifies Ed25519 over the M1 TBS: [session_id, participant_a, participant_b, session_timestamp].
      // The client-facing assignment uses a FROST signature, so we compute a separate Ed25519 sig for the relay.
      const relayTbs = CBOR_ENC.encode([
        session_id,
        new Uint8Array(initiatorPubkey),
        new Uint8Array(targetPubkey),
        session_timestamp > 0xffffffff ? BigInt(session_timestamp) : session_timestamp,
      ]) as Uint8Array;
      const relayDirSig = new Uint8Array(await this.#keyProvider.sign(relayTbs));
      const relayAssignment: RelaySessionAssignment = {
        session_id,
        participant_a: new Uint8Array(initiatorPubkey),
        participant_b: new Uint8Array(targetPubkey),
        session_timestamp,
        directory_signature: relayDirSig,
      };
      const recorded = await this.#relay.recordAssignment(relayAssignment);
      if (recorded.ok && !this.#relayAuthenticated) {
        this.#relayAuthenticated = true;
        protocolLog("AUTH", `Relay ${truncHex(this.#relayEndpoint.peer_id)} authenticated`);
      }
      if (!recorded.ok) {
        protocolLog("SESS", `Request failed — agent ${truncHex(initiatorHex)}, reason: relay_unavailable`);
        this.#sendFrame(stream, encodeSessionRequestError({ type: "session_request_error", reason: "relay_unavailable" }));
        return;
      }

      // Track as provisional: relay has registered it, but clients haven't yet received it.
      // If the initiator's stream closes before both frames are sent, AC-011 cleanup fires.
      const sessionIdHex = Buffer.from(session_id).toString("hex");
      this.#pendingSessions.set(sessionIdHex, {
        sessionId: session_id,
        initiatorHex,
        targetHex,
        initiatorGotAssignment: false,
        targetGotAssignment: false,
        fullyEstablished: false,
      });
      // PERSIST-015: preserve participants beyond stream closure for SEAL_UNILATERAL absent-party lookup
      this.#sessionParticipants.set(sessionIdHex, { initiatorHex, targetHex });
      // PERSIST-015: record session creation time as initial last_activity_at
      this.#sessionLastActivity.set(sessionIdHex, this.#clock.now());
      // M6B-010 AC-002/AC-003: persist participants to sessions table so they survive restart.
      // Uses writeSessionWithParticipants rather than writeSession so both pubkeys are stored.
      // Fire-and-forget — failure is non-blocking; worst case is participants are not
      // available after a restart (loadActiveSessionParticipants returns nothing for this session).
      void this.#store.writeSessionWithParticipants(
        sessionIdHex,
        this.#frostHandler.nodeId,
        initiatorHex,
        targetHex,
      ).catch(() => { /* persistence failure does not block session delivery */ });

      // OBS-001 AC-008: assignment issued
      protocolLog("SESS", `Assignment issued — session ${truncHex(sessionIdHex)}`);

      // (f) Deliver to both clients
      const assignmentFrame: SessionAssignmentFrame = { type: "session_assignment", assignment };
      const encoded = encodeSessionAssignment(assignmentFrame);
      const pending = this.#pendingSessions.get(sessionIdHex);
      try {
        this.#sendFrame(stream, encoded);
        if (pending) pending.initiatorGotAssignment = true;
      } catch {
        // Initiator stream failed mid-delivery; abort — target will get a stale assignment.
        return;
      }
      try {
        this.#sendFrame(targetStream, encoded);
        if (pending) {
          pending.targetGotAssignment = true;
          // Both frames sent — session is fully established; finally block will just clean up.
          pending.fullyEstablished = true;
        }
      } catch {
        // Target stream failed mid-delivery; session is still registered on relay.
        // Leave fullyEstablished=false so the finally block discards the relay state.
      }
    } finally {
      this.#frostHandler.clearInFlight(initiatorHex, epochId);
    }
  }

  // ─── Seal processing ─────────────────────────────────────────────────────────

  /**
   * PERSIST-014: Process a seal_attempt frame from a client.
   * Collects both parties' reported roots and sequences. When both arrive:
   * - If roots match → send seal_attempt_ack to both (seal proceeds via normal flow)
   * - If roots differ → send SEAL_REJECTED_TREE_MISMATCH to both with sequence numbers
   */
  #processSealAttempt(
    stream: import("@libp2p/interface").Stream,
    senderHex: string,
    frame: import("./directory-types.js").SealAttempt,
  ): void {
    const sessionIdHex = Buffer.from(frame.session_id).toString("hex");

    // C-003: Verify sender is a legitimate participant in this session
    const pendingSession = this.#pendingSessions.get(sessionIdHex);
    if (!pendingSession || (pendingSession.initiatorHex !== senderHex && pendingSession.targetHex !== senderHex)) {
      return; // Silently reject non-participants
    }

    // PERSIST-015: update last activity on seal attempt
    this.#sessionLastActivity.set(sessionIdHex, this.#clock.now());

    let attempts = this.#pendingSealAttempts.get(sessionIdHex);
    if (!attempts) {
      attempts = [];
      this.#pendingSealAttempts.set(sessionIdHex, attempts);
    }

    // Prevent duplicate attempts from same party
    if (attempts.some((a) => a.partyHex === senderHex)) {
      return;
    }

    attempts.push({
      partyHex: senderHex,
      reported_root: frame.reported_root,
      reported_seq: frame.reported_seq,
    });

    // Need both parties before comparing
    if (attempts.length < 2) return;

    const [attemptA, attemptB] = attempts;
    this.#pendingSealAttempts.delete(sessionIdHex);

    // Compare reported roots
    const rootsMatch = Buffer.from(attemptA.reported_root).equals(Buffer.from(attemptB.reported_root));

    if (rootsMatch) {
      // AC-007: roots match → confirm seal proceeds (send ack to both)
      const ackFrame = { type: "seal_attempt_ack" as const, session_id: frame.session_id };
      const ackBytes = encodeSealAttemptAck(ackFrame);
      // Send to both parties
      const streamA = this.#streams.get(attemptA.partyHex);
      const streamB = this.#streams.get(attemptB.partyHex);
      if (streamA) { try { this.#sendFrame(streamA, ackBytes); } catch { /* */ } }
      if (streamB) { try { this.#sendFrame(streamB, ackBytes); } catch { /* */ } }
    } else {
      // PERSIST-014 AC-001: tree mismatch — notify both parties with sequence numbers
      const mismatchFrame = {
        type: "seal_rejected_tree_mismatch" as const,
        session_id: frame.session_id,
        party_a_sequence: attemptA.reported_seq,
        party_b_sequence: attemptB.reported_seq,
      };
      const mismatchBytes = encodeSealRejectedTreeMismatch(mismatchFrame);
      // Send to both parties
      const streamA = this.#streams.get(attemptA.partyHex);
      const streamB = this.#streams.get(attemptB.partyHex);
      if (streamA) { try { this.#sendFrame(streamA, mismatchBytes); } catch { /* */ } }
      if (streamB) { try { this.#sendFrame(streamB, mismatchBytes); } catch { /* */ } }
    }
  }

  /**
   * PERSIST-015: Process a unilateral seal request from a client.
   * Validates that delivery_grace_seconds has elapsed since last activity,
   * then seals on the submitter's root and records the counterparty as ABSENT.
   */
  #processSealUnilateral(
    stream: import("@libp2p/interface").Stream,
    senderHex: string,
    frame: import("./directory-types.js").SealUnilateral,
  ): void {
    const sessionIdHex = Buffer.from(frame.session_id).toString("hex");

    // SI-002: reject if session already has a unilateral seal
    if (this.#unilateralSeals.has(sessionIdHex)) {
      return; // Already sealed — ignore duplicate
    }

    // SI-001: compute elapsed time from directory's own records
    const lastActivity = this.#sessionLastActivity.get(sessionIdHex);
    if (lastActivity == null) {
      // Unknown session — silently reject without leaking session existence
      return;
    }
    const now = this.#clock.now();
    const elapsedMs = now - lastActivity;
    const graceMs = this.#deliveryGraceSeconds * 1000;

    if (elapsedMs < graceMs) {
      // AC-002: too early — reject with remaining time
      const remainingSeconds = Math.ceil((graceMs - elapsedMs) / 1000);
      const tooEarlyFrame = encodeSealUnilateralTooEarly({
        type: "seal_unilateral_too_early",
        session_id: frame.session_id,
        remaining_seconds: remainingSeconds,
      });
      this.#logger?.info("relay.seal.unilateral.rejected", {
        sessionId: sessionIdHex,
        lastActivity,
        elapsedMs,
        remainingSeconds,
      });
      try { this.#sendFrame(stream, tooEarlyFrame); } catch { /* */ }
      return;
    }

    // Seal is allowed — record the unilateral seal
    const sealedAt = now;
    this.#unilateralSeals.set(sessionIdHex, {
      sealed_root: frame.reported_root,
      sealed_at: sealedAt,
      submitter_hex: senderHex,
    });

    // Determine the absent party — use #sessionParticipants which persists beyond stream closure,
    // since #pendingSessions is cleaned up when streams close (AC-011).
    const participants = this.#sessionParticipants.get(sessionIdHex)
      ?? (() => {
        const p = this.#pendingSessions.get(sessionIdHex);
        return p ? { initiatorHex: p.initiatorHex, targetHex: p.targetHex } : null;
      })();
    let absentPartyHex: string | null = null;
    if (participants) {
      absentPartyHex = participants.initiatorHex === senderHex
        ? participants.targetHex
        : participants.initiatorHex;
    }

    // AC-003: Queue notification for absent party (delivered on reconnect)
    if (absentPartyHex) {
      // In-memory queue for CELLO_ENV=local (PERSIST-015 M4 path — InMemoryNotificationQueue)
      let notifications = this.#pendingNotifications.get(absentPartyHex);
      if (!notifications) {
        notifications = [];
        this.#pendingNotifications.set(absentPartyHex, notifications);
      }
      notifications.push({
        type: "seal_unilateral_notification",
        session_id: frame.session_id,
        sealed_root: frame.reported_root,
        sealed_at: sealedAt,
      });

      // PERSIST-023: also enqueue to the injected NotificationQueue (PgNotificationQueue for
      // dev/staging/production — notifications survive directory restarts per AC-002).
      // Fire-and-forget: if the DB enqueue fails, the in-memory queue above is the fallback.
      if (this.#notificationQueue) {
        const notificationId = randomUUID();
        this.#notificationQueue.enqueue(absentPartyHex, {
          notificationId,
          notificationType: "seal_unilateral",
          payload: {
            session_id_hex: Buffer.from(frame.session_id).toString("hex"),
            sealed_root_hex: Buffer.from(frame.reported_root).toString("hex"),
            sealed_at: sealedAt,
          },
        }).catch((err: unknown) => {
          const reason = err instanceof Error ? err.message : String(err);
          this.#logger?.warn("pending_notification.enqueue.failed", {
            notificationId,
            recipientAgentId: absentPartyHex,
            reason,
          });
        });
      }
    }

    // Send confirmation to the submitting party
    const confirmFrame = encodeSealUnilateralConfirmed({
      type: "seal_unilateral_confirmed",
      session_id: frame.session_id,
      sealed_root: frame.reported_root,
      sealed_at: sealedAt,
    });
    try { this.#sendFrame(stream, confirmFrame); } catch { /* */ }

    // Evict per-session maps to prevent unbounded growth in long-running ECS directory nodes.
    // #unilateralSeals is retained briefly for SI-002 duplicate rejection; cleared here since
    // the confirmation has been sent and no further seal attempts are valid for this session.
    this.#sessionParticipants.delete(sessionIdHex);
    this.#sessionLastActivity.delete(sessionIdHex);
    this.#unilateralSeals.delete(sessionIdHex);

    this.#logger?.info("session.unilateral.sealed", {
      sessionId: sessionIdHex,
      submitterHex: truncHex(senderHex),
      correlationId: sessionIdHex,
    });
  }

  /**
   * Process a seal submission from the relay.
   * Called in-process by the relay after both SEAL control leaves are submitted.
   * Returns a structured result; the relay calls confirmSeal or rejectSeal accordingly.
   */
  async processSeal(sessionId: Uint8Array, sealData: RelaySealData): Promise<{ ok: true } | { ok: false; reason: string }> {
    const sessionIdHex = Buffer.from(sessionId).toString("hex");
    const leaves = sealData.leaves;
    const relayRoot = sealData.merkle_root;

    // OBS-001 AC-009: initiating seal log
    protocolLog("SEAL", `Initiating seal — session ${truncHex(sessionIdHex)} (${leaves.length} leaves)`);

    // (a) Rebuild Merkle tree from scratch (SI-004)
    const leafInputs: LeafInput[] = leaves.map((l) => ({
      kind: l.kind,
      data: encodeStructure2(l.s2),
    }));
    const tree = buildMerkleTree(leafInputs);
    const recomputedRoot = merkleRoot(tree);

    if (!bufEqual(recomputedRoot, relayRoot)) {
      this.#notifySealRejected(sessionIdHex, sessionId, "merkle_root_mismatch");
      return { ok: false, reason: "merkle_root_mismatch" };
    }

    // Need the genesis prev_root to validate the first leaf's prev_root.
    // The relay computes it as SHA-256(sorted(A,B) || session_id || session_timestamp).
    // We decode it from the first leaf's Structure 2 (it carries prev_root).
    // Actually for chain verification we need the genesis_prev_root from the relay's state.
    // For M1 we get it from the first leaf's s2.prev_root directly —
    // the relay already validated it equals genesis_prev_root at submit time.
    // So we verify the chain starting from leaf[0].s2.prev_root as the genesis anchor.

    // (b–d) Verify per-leaf Structure 1 signatures, prev_root chain, last_seen_seq causal chain
    let runningRoot = leaves.length > 0 ? leaves[0].s2.prev_root : new Uint8Array(32);

    for (let i = 0; i < leaves.length; i++) {
      const leaf = leaves[i];

      // (b) Verify Structure 1 signature against the original bytes the sender signed.
      // We verify directly against structure1_cbor rather than re-encoding the TBS,
      // because any difference in CBOR encoding (float64 vs uint64 for large timestamps)
      // would cause re-encoded TBS to differ from the bytes actually signed.
      // The relay stores structure1_cbor for exactly this purpose.
      if (!verify(leaf.s2.sender_pubkey, leaf.structure1_cbor, leaf.s2.sender_signature)) {
        this.#notifySealRejected(sessionIdHex, sessionId, "leaf_signature_invalid");
        return { ok: false, reason: "leaf_signature_invalid" };
      }

      // Decode last_seen_seq for causal-chain check (step d)
      const s1Fields = decodeStructure1Fields(leaf.structure1_cbor);
      if (!s1Fields) {
        this.#notifySealRejected(sessionIdHex, sessionId, "leaf_signature_invalid");
        return { ok: false, reason: "leaf_signature_invalid" };
      }

      // (c) Verify prev_root chain
      if (!bufEqual(leaf.s2.prev_root, runningRoot)) {
        this.#notifySealRejected(sessionIdHex, sessionId, "prev_root_chain_broken");
        return { ok: false, reason: "prev_root_chain_broken" };
      }

      // (d) Verify causal-chain: declared last_seen_seq must not exceed the effective seen
      // sequence — the max sequence number assigned to any counterparty leaf strictly
      // before position i in the log. Per SESSION-003 SI-003.
      const senderHex = Buffer.from(leaf.s2.sender_pubkey).toString("hex");
      // effective_seen = max sequence_number of all leaves from other senders before index i
      let effectiveSeen = 0;
      for (let j = 0; j < i; j++) {
        const otherHex = Buffer.from(leaves[j].s2.sender_pubkey).toString("hex");
        if (otherHex !== senderHex && leaves[j].s2.sequence_number > effectiveSeen) {
          effectiveSeen = leaves[j].s2.sequence_number;
        }
      }
      if (s1Fields.last_seen_seq > effectiveSeen) {
        this.#notifySealRejected(sessionIdHex, sessionId, "causal_chain_violated");
        return { ok: false, reason: "causal_chain_violated" };
      }

      // Advance running root: after leaf i, root = merkleRoot(leaves[0..i]).
      // O(n²) per processSeal call — acceptable for M1 short sessions.
      // Production: use an incremental Merkle tree that appends in O(log n).
      const partialInputs: LeafInput[] = leaves.slice(0, i + 1).map((l) => ({
        kind: l.kind,
        data: encodeStructure2(l.s2),
      }));
      runningRoot = merkleRoot(buildMerkleTree(partialInputs));
    }

    // (e) Verify final two leaves are SEAL ctrl leaves from the two participants
    const sealCheckResult = verifySealLeaves(leaves);
    if (!sealCheckResult.ok) {
      this.#notifySealRejected(sessionIdHex, sessionId, "seal_leaves_invalid");
      return { ok: false, reason: "seal_leaves_invalid" };
    }

    // Collect participants and identify the seal initiator.
    // The seal initiator is the participant who submitted the first SEAL ctrl leaf
    // (the second-to-last leaf if both are ctrl leaves — per verifySealLeaves, the
    // last two leaves are both ctrl and from distinct participants).
    const participants = [...new Set(leaves.map((l) => Buffer.from(l.s2.sender_pubkey).toString("hex")))];
    const [pA, pB] = participants.length >= 2
      ? [Buffer.from(participants[0], "hex"), Buffer.from(participants[1], "hex")]
      : [new Uint8Array(32), new Uint8Array(32)];

    // The seal initiator is the sender of the second-to-last leaf (the first SEAL ctrl leaf).
    const secondLastLeaf = leaves[leaves.length - 2];
    const initiatorHex = Buffer.from(secondLastLeaf.s2.sender_pubkey).toString("hex");

    const close_timestamp = this.#clock.now();
    const leafCount = leaves.length;
    const tbs = buildSealTbs(sessionId, recomputedRoot, leafCount, close_timestamp);

    // Look up the seal initiator's primary_pubkey (registered by SESSION-004 or test harness).
    const initiatorPrimaryPubkey = this.#primaryPubkeys.get(initiatorHex);

    if (!initiatorPrimaryPubkey) {
      // No primary_pubkey registered for this initiator — fall back to M1 single-key notarization.
      // This path is taken in environments where SESSION-004 DKG has not been performed
      // (e.g. pure SESSION-003 test environment). The single-key path will be rejected by M2 clients.
      const notarizationTbs = CBOR_ENC.encode([
        sessionId,
        recomputedRoot,
        close_timestamp > 0xffffffff ? BigInt(close_timestamp) : close_timestamp,
      ]);
      const notarizationSig = new Uint8Array(await this.#keyProvider.sign(notarizationTbs));
      const notarization: SealNotarization = {
        session_id: sessionId,
        sealed_root: recomputedRoot,
        participant_a_pubkey: new Uint8Array(pA),
        participant_b_pubkey: new Uint8Array(pB),
        close_timestamp,
        frost_signature: notarizationSig,
      };
      void this.#store.recordNotarization(notarization, { correlationId: sessionIdHex }).catch(() => { /* logged inside */ });
      // PERSIST-017: stage sealed_root in MMR staging table (fire-and-forget).
      // MMR staging failure must not block session closure — the seal is already notarized.
      // correlationId is sessionIdHex (consistent with the pattern used in recordNotarization call sites).
      if (this.#mmrStore) {
        const sealedRootHex = Buffer.from(recomputedRoot).toString("hex");
        this.#mmrStore.appendSeal(sessionIdHex, sealedRootHex, sessionIdHex).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          this.#logger?.warn("mmr.staging.failed", { sessionId: sessionIdHex, reason: msg });
        });
      }
      // OBS-001 AC-009: sealed (single-key path)
      protocolLog("SEAL", `Sealed — session ${truncHex(sessionIdHex)}, root ${truncHex(Buffer.from(recomputedRoot).toString("hex"))}`);
      const sealedEvent: SessionSealed = {
        type: "session_sealed",
        signature_type: "single",
        session_id: sessionId,
        sealed_root: recomputedRoot,
        directory_signature: notarizationSig,
        close_timestamp,
      };
      this.#deliverOrEnqueue(participants[0] ?? "", sealedEvent, sessionIdHex);
      if (participants.length >= 2) this.#deliverOrEnqueue(participants[1], sealedEvent, sessionIdHex);
      return { ok: true };
    }

    // SESSION-005: Push seal_verified to initiator; wait for seal_frost_signature.
    const sealVerifiedEvent: SealVerified = {
      type: "seal_verified",
      session_id: sessionId,
      sealed_root: recomputedRoot,
      leaf_count: leafCount,
      timestamp: close_timestamp,
    };

    // Store pending frost seal state for when the initiator returns the signature.
    this.#pendingFrostSeals.set(sessionIdHex, {
      initiatorHex,
      participantAHex: participants[0] ?? "",
      participantBHex: participants[1] ?? "",
      sealedRoot: recomputedRoot,
      leafCount,
      timestamp: close_timestamp,
      tbs,
      correlationId: sessionIdHex,
    });

    // OBS-001 AC-009: FROST seal ceremony log
    protocolLog("SEAL", `FROST seal ceremony — session ${truncHex(sessionIdHex)}`);

    // Deliver seal_verified to initiator or enqueue for deferred delivery.
    const initiatorStream = this.#streams.get(initiatorHex);
    if (initiatorStream) {
      try {
        this.#sendFrame(initiatorStream, encodeSealVerified(sealVerifiedEvent));
      } catch {
        this.#store.enqueueNotification(initiatorHex, sealVerifiedEvent, sessionIdHex);
      }
    } else {
      // DB-003: initiator not connected — enqueue for delivery when they reconnect.
      this.#store.enqueueNotification(initiatorHex, sealVerifiedEvent, sessionIdHex);
    }

    return { ok: true };
  }

  /**
   * Process a seal_frost_signature frame from the seal initiator.
   * SESSION-005: Called from the signaling stream handler when the initiator sends
   * the combined FROST signature after completing the ceremony.
   *
   * Verifies the signature against the stored primary_pubkey for this initiator,
   * then issues the SealNotarization and notifies both clients.
   */
  async #processSealFrostSignature(
    initiatorHex: string,
    frame: SealFrostSignature,
  ): Promise<void> {
    const sessionIdHex = Buffer.from(frame.session_id).toString("hex");
    const pending = this.#pendingFrostSeals.get(sessionIdHex);

    if (!pending) return; // No pending seal for this session — ignore
    if (pending.initiatorHex !== initiatorHex) return; // Wrong sender — ignore

    this.#pendingFrostSeals.delete(sessionIdHex);

    const primaryPubkey = this.#primaryPubkeys.get(initiatorHex);
    if (!primaryPubkey) return; // Should not happen; initiator's key was present at processSeal time

    // Verify FROST signature (SI-002)
    const verifier = new FrostThresholdSigner({ threshold: 1, participants: 1 }, Buffer.from(initiatorHex, "hex"));
    const sigValid = verifier.verifySignature(
      frame.frost_signature,
      pending.tbs,
      "cello-frost-seal-v1",
      primaryPubkey,
    );

    if (!sigValid) {
      // Signature invalid — reject the seal
      const rejectedEvent: SessionSealRejected = {
        type: "session_seal_rejected",
        session_id: frame.session_id,
        reason: "seal_signature_invalid",
      };
      this.#deliverOrEnqueue(pending.participantAHex, rejectedEvent, sessionIdHex);
      if (pending.participantBHex) this.#deliverOrEnqueue(pending.participantBHex, rejectedEvent, sessionIdHex);
      void this.#relay.rejectSeal(frame.session_id, "seal_signature_invalid");
      return;
    }

    // Build SealNotarization with frost signature
    const pA = Buffer.from(pending.participantAHex, "hex");
    const pB = Buffer.from(pending.participantBHex, "hex");
    const notarization: SealNotarization = {
      session_id: frame.session_id,
      sealed_root: pending.sealedRoot,
      participant_a_pubkey: new Uint8Array(pA),
      participant_b_pubkey: new Uint8Array(pB),
      close_timestamp: pending.timestamp,
      frost_signature: new Uint8Array(frame.frost_signature),
    };
    void this.#store.recordNotarization(notarization, { correlationId: pending.correlationId }).catch(() => { /* logged inside */ });

    // PERSIST-017: stage sealed_root in MMR staging table (fire-and-forget).
    // MMR staging failure must not block session closure — the seal is already notarized.
    // correlationId is sessionIdHex (consistent with the pattern used in recordNotarization call sites).
    if (this.#mmrStore) {
      const sealedRootHex = Buffer.from(pending.sealedRoot).toString("hex");
      this.#mmrStore.appendSeal(sessionIdHex, sealedRootHex, sessionIdHex).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.#logger?.warn("mmr.staging.failed", { sessionId: sessionIdHex, reason: msg });
      });
    }

    // Confirm relay (destroys relay per-session state — AC-008)
    void this.#relay.confirmSeal(frame.session_id);

    // OBS-001 AC-009: sealed log
    protocolLog("SEAL", `Sealed — session ${truncHex(sessionIdHex)}, root ${truncHex(Buffer.from(pending.sealedRoot).toString("hex"))}`);

    // Notify both clients with session_sealed (frost variant; includes leaf_count for H-003)
    const sealedEvent: SessionSealed = {
      type: "session_sealed",
      signature_type: "frost",
      session_id: frame.session_id,
      sealed_root: pending.sealedRoot,
      frost_signature: frame.frost_signature,
      signer_pubkey: primaryPubkey,
      close_timestamp: pending.timestamp,
      leaf_count: pending.leafCount,
    };
    this.#deliverOrEnqueue(pending.participantAHex, sealedEvent, sessionIdHex);
    if (pending.participantBHex) this.#deliverOrEnqueue(pending.participantBHex, sealedEvent, sessionIdHex);
  }

  #notifySealRejected(sessionIdHex: string, sessionId: Uint8Array, reason: import("./directory-types.js").SealRejectionReason): void {
    const rejectedEvent: SessionSealRejected = { type: "session_seal_rejected", session_id: sessionId, reason };
    // M1: broadcast to all authenticated streams — clients ignore events for sessions they don't own.
    // Future: look up session participants by sessionIdHex for targeted delivery.
    for (const [pubkeyHex, stream] of this.#streams) {
      try {
        this.#sendFrame(stream, encodeSessionSealRejected(rejectedEvent));
      } catch {
        this.#store.enqueueNotification(pubkeyHex, rejectedEvent, sessionIdHex);
      }
    }
  }

  #deliverOrEnqueue(pubkeyHex: string, event: SessionSealed | SessionSealRejected, correlationId: string): void {
    const stream = this.#streams.get(pubkeyHex);
    if (stream) {
      try {
        let encoded: Uint8Array;
        if (event.type === "session_sealed") {
          encoded = encodeSessionSealed(event);
        } else {
          encoded = encodeSessionSealRejected(event as SessionSealRejected);
        }
        this.#sendFrame(stream, encoded);
        return;
      } catch {
        this.#streams.delete(pubkeyHex);
      }
    }
    if (pubkeyHex) this.#store.enqueueNotification(pubkeyHex, event, correlationId);
  }

  /**
   * Deliver a SessionFrostSealed event to both clients when a deferred seal completes.
   * SESSION-005 DB-001/DB-002/DB-003.
   */
  #deliverFrostSealed(pubkeyHex: string, event: SessionFrostSealed): void {
    const stream = this.#streams.get(pubkeyHex);
    if (stream) {
      try {
        this.#sendFrame(stream, encodeSessionFrostSealed(event));
        return;
      } catch {
        this.#streams.delete(pubkeyHex);
      }
    }
    // For session_frost_sealed, we don't persist — the client will see it on next reconnect
    // via the deferred seal retry mechanism. This is acceptable for M2.
  }

  // ─── Transport helpers ───────────────────────────────────────────────────────

  #sendFrame(stream: Stream, bytes: Uint8Array): void {
    stream.send(lp.encode.single(bytes));
  }

  // ─── Test-only helpers ───────────────────────────────────────────────────────

  /**
   * PERSIST-023 test hook: seeds session state and triggers #processSealUnilateral
   * via a mock stream. Only available in NODE_ENV=test.
   *
   * Used to exercise the fire-and-forget notificationQueue.enqueue() path and its
   * .catch() handler (pending_notification.enqueue.failed event) without requiring
   * a full libp2p auth handshake.
   *
   * @param senderHex - Hex pubkey of the sealing party
   * @param sessionId - 16-byte session ID
   * @param reportedRoot - 32-byte merkle root
   * @param absentPartyHex - Hex pubkey of the absent party (notification recipient)
   * @param mockStream - Mock stream for seal_unilateral_confirmed frame
   */
  triggerSealUnilateralForTest(
    senderHex: string,
    sessionId: Uint8Array,
    reportedRoot: Uint8Array,
    absentPartyHex: string,
    mockStream: Stream,
  ): void {
    if (process.env["NODE_ENV"] !== "test") throw new Error("test-only");
    const sessionIdHex = Buffer.from(sessionId).toString("hex");
    // Pre-seed session state: last activity far enough in the past to pass the grace period
    this.#sessionLastActivity.set(sessionIdHex, this.#clock.now() - (this.#deliveryGraceSeconds + 1) * 1000);
    this.#sessionParticipants.set(sessionIdHex, { initiatorHex: senderHex, targetHex: absentPartyHex });
    this.#processSealUnilateral(mockStream, senderHex, {
      type: "seal_unilateral",
      session_id: sessionId,
      reported_root: reportedRoot,
      reported_seq: 0,
    });
  }

  /**
   * Test hook: invoke #processSealUnilateral using the CURRENT session state (no pre-seeding).
   *
   * Unlike triggerSealUnilateralForTest, this method does not override #sessionLastActivity
   * or #sessionParticipants. The caller must have already seeded the state (e.g. via
   * restoreSessionLastActivity + restoreSessionParticipants). This allows AC-002 to verify
   * that the grace period check uses the restored genesis timestamp correctly.
   *
   * Returns the raw frame bytes sent to mockStream (the seal_unilateral_too_early frame),
   * or null if nothing was sent (e.g. if sessionId is unknown).
   *
   * Only available in NODE_ENV=test.
   */
  triggerSealUnilateralWithCurrentStateForTest(
    senderHex: string,
    sessionId: Uint8Array,
    reportedRoot: Uint8Array,
    mockStream: Stream,
  ): void {
    if (process.env["NODE_ENV"] !== "test") throw new Error("test-only");
    this.#processSealUnilateral(mockStream, senderHex, {
      type: "seal_unilateral",
      session_id: sessionId,
      reported_root: reportedRoot,
      reported_seq: 0,
    });
  }

  // ─── M6B-010: Startup state restoration ──────────────────────────────────────

  /**
   * Restore pending connection requests into #pendingConnectionRequests.
   *
   * M6B-010 AC-001: called at startup (Option B: after createDirectoryNode returns)
   * with rows returned by PgDirectoryStore.loadActiveConnectionRequests(). Populates
   * #pendingConnectionRequests so that a reconnecting target can still call
   * cello_accept_connection for requests that were delivered before the restart.
   *
   * Pseudocode:
   *   for each request in requests:
   *     #pendingConnectionRequests.set(connectionRequestId, {
   *       senderHex, targetHex, packageCbor, requestId: connectionRequestId, disclosureRound
   *     })
   *   logger.info("adapter.state.loaded", { stateType: "pending_connection_requests", count })
   *
   * SI-001: expired requests are never passed here — filtered by loadActiveConnectionRequests
   * (WHERE expires_at > NOW()). This method does not re-check expiry; it trusts the caller.
   */
  restorePendingConnectionRequests(requests: Array<{
    connectionRequestId: string;
    senderPubkeyHex: string;
    targetPubkeyHex: string;
    packageCbor: Uint8Array;
    disclosureRound: number;
    expiresAt: Date;
  }>): void {
    for (const req of requests) {
      this.#pendingConnectionRequests.set(req.connectionRequestId, {
        senderHex: req.senderPubkeyHex,
        targetHex: req.targetPubkeyHex,
        packageCbor: req.packageCbor,
        requestId: req.connectionRequestId,
        disclosureRound: req.disclosureRound,
      });
    }
    this.#logger?.info("adapter.state.loaded", {
      stateType: "pending_connection_requests",
      count: requests.length,
    });
  }

  /**
   * Restore session participants into #sessionParticipants.
   *
   * M6B-010 AC-003: called at startup with rows returned by
   * PgDirectoryStore.loadActiveSessionParticipants(). Populates #sessionParticipants
   * so that SEAL_UNILATERAL after restart can identify the absent party.
   *
   * Pseudocode:
   *   for each session in sessions:
   *     #sessionParticipants.set(sessionId, { initiatorHex, targetHex })
   *   logger.info("adapter.state.loaded", { stateType: "session_participants", count })
   */
  restoreSessionParticipants(sessions: Array<{
    sessionId: string;
    initiatorHex: string;
    targetHex: string;
    genesisTimestampMs: number;
  }>): void {
    for (const session of sessions) {
      this.#sessionParticipants.set(session.sessionId, {
        initiatorHex: session.initiatorHex,
        targetHex: session.targetHex,
      });
    }
    this.#logger?.info("adapter.state.loaded", {
      stateType: "session_participants",
      count: sessions.length,
    });
  }

  /**
   * Restore session last activity from genesis timestamps.
   *
   * M6B-010 AC-002: called at startup with rows returned by
   * PgDirectoryStore.loadActiveSessionParticipants(). Initializes #sessionLastActivity
   * to the session genesis timestamp (sessions.created_at in milliseconds).
   *
   * Using the genesis timestamp prevents two failure modes:
   *   1. lastActivity=0 would make every restored session immediately eligible for
   *      unilateral seal (since Date.now() - 0 >> deliveryGraceSeconds).
   *   2. lastActivity=undefined/missing would cause a NaN comparison and always
   *      pass the grace period check.
   *
   * By setting lastActivity=genesisTimestampMs, a session that was 30 minutes old
   * at restart will still require deliveryGraceSeconds more seconds before a
   * unilateral seal can succeed — which is the correct behavior.
   *
   * Pseudocode:
   *   for each session in sessions:
   *     #sessionLastActivity.set(sessionId, genesisTimestampMs)
   *   logger.info("adapter.state.loaded", { stateType: "session_last_activity", count })
   */
  restoreSessionLastActivity(sessions: Array<{
    sessionId: string;
    initiatorHex: string;
    targetHex: string;
    genesisTimestampMs: number;
  }>): void {
    for (const session of sessions) {
      this.#sessionLastActivity.set(session.sessionId, session.genesisTimestampMs);
    }
    this.#logger?.info("adapter.state.loaded", {
      stateType: "session_last_activity",
      count: sessions.length,
    });
  }

  /**
   * Test accessor: returns the last activity timestamp for a session ID.
   *
   * M6B-010 AC-002: verifies that restoreSessionLastActivity correctly seeds
   * #sessionLastActivity with genesisTimestampMs (not 0 or undefined).
   *
   * Only available in test/local environments.
   */
  getRestoredLastActivityForTest(sessionIdHex: string): number | undefined {
    if (process.env["NODE_ENV"] !== "test") throw new Error("test-only");
    return this.#sessionLastActivity.get(sessionIdHex);
  }

  /**
   * PERSIST-023 test hook: runs the Pg notification drain portion of the reconnect path
   * using an injected mock stream. Only available in NODE_ENV=test.
   *
   * Used to exercise drainUndelivered(), delivery, acknowledge(), and the
   * notification.delivery.failed error path without requiring a live libp2p connection.
   *
   * @param agentPubkeyHex - Hex pubkey of the reconnecting agent
   * @param mockStream - Mock stream for delivering notifications (may throw to simulate failure)
   * @returns Promise<void> — resolves after drain loop completes
   */
  async triggerPgDrainForTest(agentPubkeyHex: string, mockStream: Stream): Promise<void> {
    if (process.env["NODE_ENV"] !== "test") throw new Error("test-only");
    if (!this.#notificationQueue) return;
    try {
      const pgNotifs = await this.#notificationQueue.drainUndelivered(agentPubkeyHex);
      for (const pgNotif of pgNotifs) {
        const p = pgNotif.payload as { session_id_hex?: string; sealed_root_hex?: string; sealed_at?: number };
        if (!p.session_id_hex || !p.sealed_root_hex || pgNotif.notificationType !== "seal_unilateral") {
          void this.#notificationQueue.acknowledge(pgNotif.notificationId).catch(() => {});
          continue;
        }
        try {
          this.#sendFrame(mockStream, encodeSealUnilateralNotification({
            type: "seal_unilateral_notification",
            session_id: Buffer.from(p.session_id_hex, "hex"),
            sealed_root: Buffer.from(p.sealed_root_hex, "hex"),
            sealed_at: p.sealed_at ?? 0,
            seal_type: "UNILATERAL",
          }));
          void this.#notificationQueue.acknowledge(pgNotif.notificationId).catch(() => {});
        } catch {
          this.#logger?.warn("notification.delivery.failed", {
            notificationId: pgNotif.notificationId,
            recipientAgentId: agentPubkeyHex,
            reason: "stream_send_failed",
          });
          break;
        }
      }
    } catch {
      // drainUndelivered failed — continue without Pg notifications
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function bufEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

interface Structure1Fields {
  session_id: Uint8Array;
  last_seen_seq: number;
  timestamp: number | bigint;
}

function decodeStructure1Fields(cbor: Uint8Array): Structure1Fields | null {
  // Structure 1 TBS: [protocol_version, content_hash, sender_pubkey, session_id, last_seen_seq, timestamp]
  let arr: unknown;
  try {
    arr = cborDecode(cbor);
  } catch {
    return null;
  }
  if (!Array.isArray(arr) || arr.length !== 6) return null;
  const [, , , _sid, _lss, _ts] = arr;
  const sidBytes = _sid instanceof Uint8Array ? _sid : Buffer.isBuffer(_sid) ? new Uint8Array(_sid as Buffer) : null;
  if (!sidBytes || sidBytes.length !== 16) return null;
  if (typeof _lss !== "number") return null;
  if (typeof _ts !== "number" && typeof _ts !== "bigint") return null;
  return { session_id: sidBytes, last_seen_seq: _lss, timestamp: _ts };
}

function verifySealLeaves(
  leaves: Array<{ kind: "msg" | "ctrl"; s2: import("@cello-protocol/protocol-types").Structure2; structure1_cbor: Uint8Array }>  // RelaySealLeaf
): { ok: true } | { ok: false } {
  // Final two leaves must be ctrl-kind (0x02) from distinct participants.
  if (leaves.length < 2) return { ok: false };
  const last = leaves[leaves.length - 1];
  const secondLast = leaves[leaves.length - 2];
  if (last.kind !== "ctrl" || secondLast.kind !== "ctrl") return { ok: false };
  const lastSender = Buffer.from(last.s2.sender_pubkey).toString("hex");
  const secondLastSender = Buffer.from(secondLast.s2.sender_pubkey).toString("hex");
  if (lastSender === secondLastSender) return { ok: false };
  // M1 DEBT (SESSION-003-AC-002): directory should also verify that each SEAL leaf's payload
  // final_root matches the Merkle root at the appropriate stage (before initiator SEAL, after
  // initiator SEAL, after both). This requires the relay to include ctrl leaf content bytes in
  // SealData (currently only content_hash is available). Deferred to a follow-on story since
  // clients perform this verification locally (AC-001), maintaining the trust guarantee at the
  // client level. See: CELLO-SESSION-003 AC-002 step (f).
  return { ok: true };
}

// ─── M6B-002: mapCeremonyFailure ─────────────────────────────────────────────
// Maps ThresholdSignatureError.error.reason to SessionRequestErrorReason.
// Exhaustive switch ensures new FROST failure reasons produce a compile error.

function mapCeremonyFailure(
  reason: "DIRECTORY_BELOW_THRESHOLD" | "CEREMONY_TIMEOUT" | "CEREMONY_EXHAUSTED"
): SessionRequestErrorReason {
  switch (reason) {
    case "CEREMONY_TIMEOUT": return "ceremony_timeout";
    case "CEREMONY_EXHAUSTED": return "ceremony_exhausted";
    case "DIRECTORY_BELOW_THRESHOLD": return "directory_below_threshold";
  }
}

// ─── ClientDelegatedSigner ───────────────────────────────────────────────────
// IThresholdSigner that sends a ceremony_request frame to the client (initiator)
// over their authenticated signaling stream and waits for a ceremony_result frame.
// The client runs participateInCeremony locally (it holds the coordinator share)
// and returns the combined FROST signature.

import type { ThresholdSignature, FrostContext } from "@cello-protocol/crypto/frost/types.js";

export class ClientDelegatedSigner implements IThresholdSigner {
  readonly #agentPubkeyHex: string;
  readonly #primaryPubkey: Uint8Array;
  // Pending ceremony resolvers: ceremonyId → resolve function
  readonly #pending = new Map<string, (result: ThresholdSignature) => void>();

  // Back-reference to the directory node's stream map and CBOR encoder (set after construction)
  #streams: Map<string, import("@libp2p/interface").Stream> | null = null;

  constructor(agentPubkeyHex: string, primaryPubkey: Uint8Array) {
    this.#agentPubkeyHex = agentPubkeyHex;
    this.#primaryPubkey = primaryPubkey;
  }

  setStreams(streams: Map<string, import("@libp2p/interface").Stream>): void {
    this.#streams = streams;
  }

  getPrimaryPubkey(): Uint8Array { return new Uint8Array(this.#primaryPubkey); }

  verifySignature(signature: Uint8Array, tbs: Uint8Array, context: FrostContext, publicKey: Uint8Array): boolean {
    try {
      const ctxBytes = new TextEncoder().encode(context);
      const framed = new Uint8Array(ctxBytes.length + 1 + tbs.length);
      framed.set(ctxBytes); framed[ctxBytes.length] = 0x00; framed.set(tbs, ctxBytes.length + 1);
      return ed25519_FROST.verify(signature, framed, publicKey);
    } catch { return false; }
  }

  async participateInCeremony(
    ceremonyId: string,
    tbs: Uint8Array,
    context: FrostContext,
  ): Promise<ThresholdSignature> {
    const agentShort = this.#agentPubkeyHex.slice(0, 16);

    process.stdout.write(`[DEBUG] ClientDelegatedSigner.participateInCeremony: enter agent=${agentShort} ceremony=${ceremonyId.slice(0,16)}\n`);
    process.stdout.write(`[DEBUG] ClientDelegatedSigner: #streams=${this.#streams === null ? "NULL" : `Map(${this.#streams.size})`}\n`);

    if (!this.#streams) {
      process.stdout.write(`[DEBUG] ClientDelegatedSigner: FAIL #streams is null\n`);
      return { ok: false, error: { reason: "DIRECTORY_BELOW_THRESHOLD" } };
    }

    process.stdout.write(`[DEBUG] ClientDelegatedSigner: streams keys=[${[...this.#streams.keys()].map(k => k.slice(0,16)).join(",")}]\n`);
    process.stdout.write(`[DEBUG] ClientDelegatedSigner: looking for agentPubkeyHex=${agentShort} in streams\n`);

    const stream = this.#streams.get(this.#agentPubkeyHex);
    process.stdout.write(`[DEBUG] ClientDelegatedSigner: stream=${stream ? `found status=${(stream as unknown as { status?: string }).status ?? "unknown"}` : "NOT FOUND"}\n`);

    if (!stream) {
      process.stdout.write(`[DEBUG] ClientDelegatedSigner: FAIL agent not in #streams\n`);
      return { ok: false, error: { reason: "DIRECTORY_BELOW_THRESHOLD" } };
    }

    try {
      process.stdout.write(`[DEBUG] ClientDelegatedSigner: sending ceremony_request to agent=${agentShort}\n`);
      stream.send(lp.encode.single(CBOR_ENC.encode({
        type: "ceremony_request",
        ceremony_id: ceremonyId,
        tbs: new Uint8Array(tbs),
        context,
      })));
      process.stdout.write(`[DEBUG] ClientDelegatedSigner: ceremony_request sent OK, waiting for ceremony_result\n`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stdout.write(`[DEBUG] ClientDelegatedSigner: FAIL stream.send threw: ${msg}\n`);
      return { ok: false, error: { reason: "DIRECTORY_BELOW_THRESHOLD" } };
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#pending.delete(ceremonyId);
        process.stdout.write(`[DEBUG] ClientDelegatedSigner: TIMEOUT waiting for ceremony_result agent=${agentShort}\n`);
        resolve({ ok: false, error: { reason: "CEREMONY_TIMEOUT" } });
      }, 30_000);
      this.#pending.set(ceremonyId, (result) => {
        clearTimeout(timer);
        process.stdout.write(`[DEBUG] ClientDelegatedSigner: ceremony_result received agent=${agentShort} ok=${result.ok}\n`);
        resolve(result);
      });
    });
  }

  // Called by the signaling stream handler when ceremony_result arrives from the client
  resolveFromClient(ceremonyId: string, signature: Uint8Array | null): void {
    const resolve = this.#pending.get(ceremonyId);
    if (!resolve) return;
    this.#pending.delete(ceremonyId);
    resolve(signature
      ? { ok: true, signature }
      : { ok: false, error: { reason: "CEREMONY_EXHAUSTED" } });
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export interface CreateDirectoryNodeOptions {
  listenAddresses?: string[];
  keyProvider: KeyProvider;
  relay: RelayAdapter;
  relayEndpoint: { peer_id: string; multiaddrs: string[] };
  directoryEndpoint?: { peer_id: string; multiaddrs: string[] };
  store?: DirectoryStore;
  clock?: TimeSource;
  /** Node ID used for FROST identifier derivation */
  nodeId?: string;
  /** K_server_X share store (defaults to InMemoryShareStore) */
  shareStore?: ShareStore;
  /** FALLBACK_CANARY event listener */
  onFallbackCanary?: FrostDirectoryHandlerOptions["onFallbackCanary"];
  /** Persisted transport key for stable Peer ID (32-byte Ed25519 seed) */
  transportPrivateKey?: Uint8Array;
  /**
   * REG-001 test injection: force DKG failure for all registration attempts.
   * Only effective in NODE_ENV=test.
   */
  forceDkgFailure?: boolean;
  /**
   * REG-001 AC-009: when true, session_request is refused with not_registered if the
   * initiator has not completed registration. Default: false (backward compatible).
   */
  requireRegistration?: boolean;
  /**
   * SESSION-006: when true, session_request requires a valid connection_id.
   * Default: false (backward compatible).
   */
  requireConnectionGate?: boolean;
  /**
   * SI-001 test injection: intercepts package_cbor before relaying to target.
   * Only effective in NODE_ENV=test.
   */
  packageCborInterceptor?: (cbor: Uint8Array) => Uint8Array;
  /** Structured logger injected at the composition root */
  logger?: Logger;
  /**
   * PERSIST-015: grace period in seconds before a unilateral seal is accepted.
   * Default: 600 (10 minutes).
   */
  deliveryGraceSeconds?: number;
  /**
   * PERSIST-017: MmrStore for appending sealed sessions to the MMR staging table.
   * When provided, appendSeal() is called after every successful SealNotarization.
   */
  mmrStore?: MmrStore;
  /**
   * PERSIST-023: NotificationQueue for SEAL_UNILATERAL notifications.
   * When provided, the directory will drain and deliver pending notifications
   * for a reconnecting agent over the established signaling stream.
   */
  notificationQueue?: NotificationQueue;
  /**
   * CELLO-RELAY-001: RelayPoolManager for dynamic relay assignment from signed manifest.
   * When provided, session_request uses pickRelay() instead of the hardcoded relayEndpoint.
   * Backward compatible — when absent, relayEndpoint is used as before.
   */
  relayPoolManager?: RelayPoolManager;
  /**
   * FEDERATION-E2E-001: ICheckpointTransport for inter-node checkpoint cross-signing.
   * When provided, registers /cello/checkpoint/1.0.0 handler and enables checkpoint signing.
   */
  checkpointTransport?: ICheckpointTransport;
  /**
   * OPS-AGENT-001: TokenValidator for pre-authorization token gate on DKG Round 1.
   * When provided, the directory consumes the preAuthToken from the Round 1 frame
   * as the FIRST operation before any FROST crypto computation.
   * When absent (backward compat for existing tests), token gate is skipped.
   * CELLO_ENV=local: use DevTokenValidator (accepts any 'DEV-' prefix token).
   * CELLO_ENV=dev+: use PgTokenValidator backed by pre_authorization_tokens table.
   */
  tokenValidator?: TokenValidator;
  /**
   * OPS-AGENT-001: Postgres pool for account deduplication (AC-005b).
   * When provided alongside tokenValidator, the directory links the new agent_profile
   * to an account after successful DKG Round 1, creating one if needed.
   * When absent, account linking is skipped (backward compat).
   */
  pgPool?: import("pg").Pool;
}

export async function createDirectoryNode(opts: CreateDirectoryNodeOptions): Promise<{
  directory: CelloDirectoryNode;
  node: CelloNode;
  stop: () => Promise<void>;
}> {
  const node = await createNode({
    keyProvider: opts.keyProvider,
    listenAddresses: opts.listenAddresses ?? ["/ip4/127.0.0.1/tcp/0"],
    transportPrivateKey: opts.transportPrivateKey,
  });
  await node.start();

  const directory = new CelloDirectoryNode({
    node,
    keyProvider: opts.keyProvider,
    relay: opts.relay,
    relayEndpoint: opts.relayEndpoint,
    directoryEndpoint: opts.directoryEndpoint,
    store: opts.store,
    clock: opts.clock,
    nodeId: opts.nodeId,
    shareStore: opts.shareStore,
    onFallbackCanary: opts.onFallbackCanary,
    forceDkgFailure: opts.forceDkgFailure,
    requireRegistration: opts.requireRegistration,
    requireConnectionGate: opts.requireConnectionGate,
    packageCborInterceptor: opts.packageCborInterceptor,
    logger: opts.logger,
    deliveryGraceSeconds: opts.deliveryGraceSeconds,
    mmrStore: opts.mmrStore,
    notificationQueue: opts.notificationQueue,
    relayPoolManager: opts.relayPoolManager,
    checkpointTransport: opts.checkpointTransport,
    tokenValidator: opts.tokenValidator,
    pgPool: opts.pgPool,
  });
  await directory.start();

  return {
    directory,
    node,
    stop: async () => { await node.stop(); },
  };
}
