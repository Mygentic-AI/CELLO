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
import {
  upsertPresenceOnline,
  upsertPresenceOffline,
  refreshNodeHeartbeat,
} from "./agent-presence-repository.js";
import { Encoder, decode as cborDecode } from "cbor-x";
import * as lp from "it-length-prefixed";
import { verify, buildMerkleTree, merkleRoot, CONTEXT_SESSION_ESTABLISHMENT, FrostThresholdSigner, verifyRelayRegistrationSignature, computeCheckpointHash } from "@cello-protocol/crypto";

import type { KeyProvider, LeafInput, IThresholdSigner } from "@cello-protocol/crypto";
import { encodeStructure2, computeGenesisPrevRoot, buildSealTbs } from "@cello-protocol/protocol-types";
import type { AgentProfile } from "@cello-protocol/protocol-types";
import { createNode } from "@cello-protocol/transport";
import type { CelloNode } from "@cello-protocol/transport";
import type { Stream } from "@libp2p/interface";
import type { SessionAbandoned, SessionSealRejected, SealVerified } from "@cello-protocol/protocol-types";
import type { SealNotarization, ConversationSealRecord, ConversationCloseType, ConversationAttestation, Logger, NotificationQueue, ICheckpointTransport, CheckpointProposal, TokenValidator } from "@cello-protocol/interfaces";
import type {
  SessionAssignment,
  SessionAssignmentFrame,
  TimeSource,
  RelaySealData,
  RelaySessionAssignment,
  SealFrostSignature,
  SessionFrostSealed,
  SessionRequestErrorReason,
  SealUnilateralNotification,
  SessionSealedWithLegibility,
  SealVerifiedWithLegibility,
  SealLegibility,
} from "./directory-types.js";
import { buildSealLegibility, bindLegibilityToTbs } from "./seal-legibility.js";
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
  encodeAgentRevocationAck,
  encodeAgentRevocationError,
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
  encodeSealUpgradeConfirmed,
  encodeSealUpgradeRejected,
  encodeTrustSignalPickup,
  encodeManifestPollResponse,
  encodePong,
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
import { resolveAccountId } from "./pre-auth-token-repository.js";
import type { MmrStore } from "./mmr-store.js";
import type { RelayPoolManager } from "./relay-pool-manager.js";

export const SIGNALING_PROTOCOL_ID = "/cello/signaling/1.0.0";
const AUTH_DOMAIN = "CELLO-DIR-AUTH-v1";
const NONCE_TTL_MS = 30_000;

const CBOR_ENC = new Encoder({ tagUint8Array: false });

/**
 * CELLO-M7-UPGRADE-001 (DOD-UP-1): domain separator for the seal upgrade-ack TBS. The returning
 * absent party signs CBOR([SEAL_UPGRADE_ACK_DOMAIN, session_id, sealed_root]) with its K_local to
 * RATIFY the existing unilateral seal's root. B's daemon MUST build the byte-identical TBS — same
 * domain string, same CBOR encoder options (tagUint8Array:false). Domain separation prevents the
 * ack signature from being replayed as any other CELLO signature.
 */
const SEAL_UPGRADE_ACK_DOMAIN = "cello-seal-upgrade-ack-v1";

// M7-WIRE-001: Local TBS builder for the 10-field session-establishment TBS.
//
// SINGLE-SOURCE-OF-TRUTH NOTE (H-2): the canonical 5-field builder is
// `buildSessionEstablishmentTbs` exported from @cello-protocol/protocol-types.
// The published version (0.0.4) only supports the 5-field legacy layout — the
// 10-field M7 extension is NOT yet published — so this local copy cannot simply
// import and delegate for the 10-field path. It MUST stay byte-for-byte
// compatible with the protocol-types helper for the 5-field path and with the
// client-side verifier for the 10-field path. Drift is guarded by
// `__tests__/m7-wire-001-tbs-drift-guard.test.ts`, which fails if either layout
// diverges. Remove this copy and delegate to protocol-types after the 10-field
// helper is published (AC-021).
//
// Uses 10-field path only when ALL M7 fields are non-empty; otherwise falls back to
// 5-field legacy path so the client-side verifier reconstructs an identical TBS.
export function buildSessionEstablishmentTbsM7(
  sessionId: Uint8Array,
  pubA: Uint8Array,
  pubB: Uint8Array,
  genesisPrevRoot: Uint8Array,
  timestamp: number,
  initiatorSessionPeerId: string,
  initiatorSessionAddrs: string[],
  counterpartySessionPeerId: string,
  counterpartySessionAddrs: string[],
  transportMode: "direct" | "relay",
): Uint8Array {
  const tsEncoded = timestamp > 0xffffffff ? BigInt(timestamp) : timestamp;

  if (
    initiatorSessionPeerId &&
    counterpartySessionPeerId &&
    initiatorSessionAddrs.length > 0 &&
    counterpartySessionAddrs.length > 0
  ) {
    return CBOR_ENC.encode([
      sessionId,
      pubA,
      pubB,
      genesisPrevRoot,
      tsEncoded,
      initiatorSessionPeerId,
      JSON.stringify(initiatorSessionAddrs.slice().sort()),
      counterpartySessionPeerId,
      JSON.stringify(counterpartySessionAddrs.slice().sort()),
      transportMode,
    ]) as Uint8Array;
  }

  return CBOR_ENC.encode([
    sessionId,
    pubA,
    pubB,
    genesisPrevRoot,
    tsEncoded,
  ]) as Uint8Array;
}

/**
 * CELLO-M7-REMOVE-001 (DOD-REMOVE-2): canonical agent-revocation TBS — a BYTE-IDENTICAL local copy of
 * @cello-protocol/protocol-types buildAgentRevocationTbs (the published package lags; M7-WIRE-001
 * convention). Field order is load-bearing: [domain, agentId, kLocalPubkeyHex, epochId, reason, ts].
 * The m7-remove-001-tbs-drift-guard test + the live spine (sign-in-daemon / verify-here) catch drift.
 * Replace with a direct import once protocol-types ships this helper.
 */
export const AGENT_REVOCATION_DOMAIN = "CELLO-REVOKE-v1";
export function buildAgentRevocationTbs(
  agentId: string,
  kLocalPubkeyHex: string,
  epochId: string,
  reason: string,
  revokedAt: number | bigint,
): Uint8Array {
  const tsEncoded = typeof revokedAt === "bigint" || revokedAt > 0xffffffff ? BigInt(revokedAt) : revokedAt;
  return CBOR_ENC.encode([
    AGENT_REVOCATION_DOMAIN,
    agentId,
    kLocalPubkeyHex,
    epochId,
    reason,
    tsEncoded,
  ]) as Uint8Array;
}

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
  /**
   * SESSION-002: fetch a session's signed-leaf chain on demand so the directory can
   * rebuild + verify the root for a UNILATERAL seal (the seal_unilateral frame carries
   * no leaves). Read-only — never mutates relay session state. Resolves to the leaf
   * chain + relay-recomputed root, or null when the chain is unavailable (the directory
   * then rejects unilateral_leaves_unavailable). Optional so in-process stubs that never
   * exercise the unilateral path need not implement it.
   */
  getSealLeaves?(sessionId: Uint8Array): Promise<RelaySealData | null> | RelaySealData | null;
  /**
   * SESSION-003 / DOD-LIVE-2: ask the relay (the session-path liveness authority) whether a
   * recipient is alive/gone/unknown. The unilateral-seal ABSENT attestation reads this from
   * the relay, never self-asserted. 'unknown' (never tracked) is the fail-safe → DELIVERED.
   * Optional so in-process stubs need not implement it (absence → 'unknown').
   */
  getSessionLiveness?(counterpartyPubkey: Uint8Array): Promise<"alive" | "gone" | "unknown"> | "alive" | "gone" | "unknown";
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
  /**
   * M7-MANIFEST-002: per-node Ed25519 signing key provider.
   * When provided, the directory signs a step-5 TBS after successful client
   * authentication and includes nodeId + signature + timestamp in signaling_auth_ok.
   * When absent, signaling_auth_ok is sent without MANIFEST-002 fields (backward compat).
   */
  directoryKeyProvider?: import("@cello-protocol/interfaces").DirectoryKeyProvider;
  /**
   * M7-MANIFEST-002: consortium manifest store for manifest_poll_request handling.
   * When provided, the directory responds to manifest_poll_request frames with
   * the current manifest (manifest_poll_response).
   * When absent, manifest_poll_request frames are ignored.
   */
  directoryManifestStore?: import("@cello-protocol/interfaces").DirectoryManifestStore;
}

/** Orphan-sweep failures in a row before escalating to a distinct alarm event (~5 min at the 60s cadence). */
const SWEEP_FAILURE_ALARM_THRESHOLD = 5;

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
  // PRESENCE-001: per-node liveness heartbeat timer (refreshes directory_nodes.last_heartbeat_at).
  #presenceHeartbeat: ReturnType<typeof setInterval> | undefined;
  #burnReconcile: ReturnType<typeof setInterval> | undefined;
  /** Consecutive orphan-sweep failures — escalates to a distinct alarm event at the threshold. */
  #sweepConsecutiveFailures = 0;
  // OPS-AGENT-001: stash phone_stub_hash from consumed token for account linking after DKG completes
  // agentPubkeyHex → { phoneStubHash, emailStubHash }
  readonly #pendingPreAuthData = new Map<string, { phoneStubHash: string; emailStubHash: string }>();
  // M7-MANIFEST-002: per-node Ed25519 signing key provider for step-5 auth proof
  readonly #directoryKeyProvider: import("@cello-protocol/interfaces").DirectoryKeyProvider | undefined;
  // M7-MANIFEST-002: manifest store for manifest_poll_request responses
  readonly #directoryManifestStore: import("@cello-protocol/interfaces").DirectoryManifestStore | undefined;

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
  readonly #pendingNotifications = new Map<string, Array<SealUnilateralNotification>>();
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
    // M7-SESSION-004: legibility certificate derived at processSeal time (leaves are
    // verified there); attached to the SessionSealed frame when the FROST ceremony completes.
    // Present on the BILATERAL path; absent on the SESSION-002 unilateral path (whose
    // seal_unilateral_confirmed cert is a different frame that does not carry legibility yet).
    legibility?: SealLegibility;
    // DOD-LEG-2 (SI-002): the signed leaves the legibility was derived from, carried to the
    // SessionSealed frame so the client can re-derive + verify the published frontier itself.
    frontierLeaves?: import("./directory-types.js").SealFrontierLeaf[];
    // SESSION-002: when true this is a UNILATERAL seal — participantA is the present
    // (submitting) party, participantB is the ABSENT counterparty (never a signer). On
    // completion the directory sends seal_unilateral_confirmed + notification (cert),
    // not session_sealed.
    unilateral?: boolean;
    // DOD-LIVE-2: how the counterparty is recorded — ABSENT (relay observed it gone) or
    // DELIVERED (alive / unknown fail-safe). Determined from the relay liveness authority.
    attestation?: "ABSENT" | "DELIVERED";
  }>();

  // M7-WIRE-001: session_id_hex → counterparty session info from SessionOfferAccept
  readonly #pendingSessionOfferAccepts = new Map<string, { counterpartySessionPeerId: string; counterpartySessionAddrs: string[] }>();
  // M7-WIRE-001: session_id_hex → resolve function for waiting on Bob's SessionOfferAccept
  readonly #sessionOfferAcceptWaiters = new Map<string, () => void>();
  // M7-WIRE-001: session_id_hex → target pubkey hex (validates session_offer_accept sender)
  readonly #sessionOfferAcceptTargets = new Map<string, string>();

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
    this.#directoryKeyProvider = opts.directoryKeyProvider;
    this.#directoryManifestStore = opts.directoryManifestStore;
  }

  /**
   * PRESENCE-001: record an edge-triggered presence transition for an agent connected to THIS node.
   * Best-effort + fire-and-forget — a presence-write hiccup must never break the signaling auth or
   * disconnect path. Emits directory.presence.transition on success. (online = connect, offline =
   * disconnect; the owning node is this node, so the offline write is sovereign-scoped in SQL.)
   */
  #recordPresence(state: "online" | "offline", kLocalPubkey: string): void {
    const pool = this.#pgPool;
    if (!pool) return;
    const owningNodeId = this.#frostHandler.nodeId;
    const correlationId = randomBytes(8).toString("hex");
    const write =
      state === "online"
        ? upsertPresenceOnline(pool, kLocalPubkey, owningNodeId)
        : upsertPresenceOffline(pool, kLocalPubkey, owningNodeId);
    void Promise.resolve(write)
      .then(() => {
        this.#logger?.info("directory.presence.transition", {
          agentId: kLocalPubkey,
          owningNodeId,
          state,
          correlationId,
        });
      })
      .catch((err: unknown) => {
        this.#logger?.error("directory.presence.transition.failed", {
          agentId: kLocalPubkey,
          owningNodeId,
          state,
          reason: err instanceof Error ? err.message : String(err),
          correlationId,
        });
      });
  }

  /** PRESENCE-001: stop the liveness heartbeat (called on node shutdown). */
  /**
   * LEVER-002 burn reconcile: zero THIS node's K_server share for every burned agent. Catches the
   * idle/offline case — a node that was not asked to sign when the (replicated) burn arrived still
   * destroys its own material, so the federation-wide guarantee holds without a ceremony attempt.
   * Idempotent (zeroing an already-zeroed share is a no-op).
   */
  async reconcileBurnedShares(): Promise<void> {
    let burned: string[];
    try {
      burned = await this.#store.listBurnedAgentPubkeys();
    } catch (err) {
      // ERROR, not WARN: this is the ONLY durable path that zeroes an idle node's at-rest burned
      // share. A node that can NEVER enumerate burned agents (schema/grant regression) would silently
      // leave material un-zeroed forever — a security-control failure, not a transient hiccup. (The
      // live honor-check still refuses signing, so capability dies; this protects the at-rest erase.)
      this.#logger?.error("frost.burn.reconcile.failed", {
        reason: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    let failed = 0;
    for (const pubkey of burned) {
      try {
        await this.#frostHandler.destroyShares(pubkey);
      } catch (err) {
        failed++;
        this.#logger?.error("frost.share.destroy.failed", {
          agentShort: pubkey.slice(0, 16),
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }
    // Aggregate signal: a per-agent ERROR can scroll past, but the at-rest-erase guarantee is only as
    // good as the WHOLE sweep succeeding. Emit a sweep-level result every run so a PERSISTENT failure
    // (the same shares un-zeroed tick after tick — a grant/schema regression) is alarmable on the
    // failed>0 count, not just inferable from scattered per-agent lines. (Capability still dies via the
    // honor-check meanwhile; this protects the at-rest erase, LEVER-002.)
    if (failed > 0) {
      this.#logger?.error("frost.burn.reconcile.incomplete", { total: burned.length, failed });
    } else if (burned.length > 0) {
      this.#logger?.info("frost.burn.reconcile.complete", { total: burned.length });
    }
  }

  /**
   * TRUST-001 backstop: delete ORPHANED pending pickups (anchor-less + older than the TTL) so an
   * undeliverable sealed ciphertext cannot linger forever. Failure is logged (ERROR), never thrown — the
   * sweep retries on the next cadence; a delete count >0 is logged so an orphan being cleaned is visible.
   *
   * A single failure is transient (next tick retries). But a PERSISTENT failure (a bad plan, a revoked
   * grant, a column rename) would ERROR every 60s forever while orphaned ciphertext silently accumulates
   * and the per-tick ERROR reads as log noise. So we track CONSECUTIVE failures and, once they cross a
   * threshold, emit a DISTINCT escalation event an alarm can fire on (M4+ rule: every new failure mode
   * gets an alarm threshold). The counter resets on the next success.
   */
  async runPickupSweep(): Promise<void> {
    try {
      const swept = await this.#store.sweepUndeliverablePickups();
      if (swept > 0) this.#logger?.warn("trust_signal.pickup.swept", { count: swept });
      this.#sweepConsecutiveFailures = 0;
    } catch (err) {
      this.#sweepConsecutiveFailures++;
      this.#logger?.error("trust_signal.pickup.sweep.failed", {
        reason: err instanceof Error ? err.message : String(err),
        consecutiveFailures: this.#sweepConsecutiveFailures,
      });
      // ~5 min of unbroken failure (5 × 60s) = no longer a hiccup; escalate to a distinct, alarmable event
      // so a permanent regression can never hide behind routine retry noise.
      if (this.#sweepConsecutiveFailures === SWEEP_FAILURE_ALARM_THRESHOLD) {
        this.#logger?.error("trust_signal.pickup.sweep.persistent_failure", {
          consecutiveFailures: this.#sweepConsecutiveFailures,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  stopPresenceHeartbeat(): void {
    if (this.#burnReconcile) {
      clearInterval(this.#burnReconcile);
      this.#burnReconcile = undefined;
    }
    if (this.#presenceHeartbeat) {
      clearInterval(this.#presenceHeartbeat);
      this.#presenceHeartbeat = undefined;
    }
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

    // PRESENCE-001: start the per-node liveness heartbeat (refreshes last_heartbeat_at on a coarse
    // cadence — the read rule treats an agent as online only if its owning node's heartbeat is
    // fresh, so a crashed node's stale presence rows age out to last-seen). unref so it never keeps
    // the process alive.
    if (this.#pgPool && !this.#presenceHeartbeat) {
      const pool = this.#pgPool;
      const nodeId = this.#frostHandler.nodeId;
      const tick = () => {
        void refreshNodeHeartbeat(pool, nodeId).catch((err: unknown) => {
          this.#logger?.warn("directory.node.heartbeat.failed", {
            nodeId,
            reason: err instanceof Error ? err.message : String(err),
          });
        });
      };
      tick(); // mark fresh immediately at boot
      // Coarse cadence — one tiny per-node write (NOT per agent, NOT per ping).
      this.#presenceHeartbeat = setInterval(tick, 45_000);
      this.#presenceHeartbeat.unref?.();
    }

    // LEVER-002: burn reconcile — sweep burned agents and zero this node's shares, on boot (catches a
    // burn that arrived while the node was down) and on a coarse cadence (catches an idle agent never
    // asked to sign). Idempotent + unref'd so it never keeps the process alive.
    if (this.#pgPool && !this.#burnReconcile) {
      const tickReconcile = (): void => {
        void this.reconcileBurnedShares();
        // TRUST-001 backstop: delete orphaned (anchor-less, >TTL) pending pickups so an undeliverable
        // ciphertext (its hash write never landed) cannot linger forever. Same cadence — the sweep is a
        // cheap, age-filtered DELETE. Independent of the burn reconcile (one failing must not skip the other).
        void this.runPickupSweep();
      };
      tickReconcile();
      this.#burnReconcile = setInterval(tickReconcile, 60_000);
      this.#burnReconcile.unref?.();
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
            this.#logger?.info("relay.already.registered", { relayId, region, healthCheckUrl });
            stream.send(lp.encode.single(CBOR_ENC.encode({ type: "relay_register_ok", already_registered: true })));
          } else {
            // Log relay.registered at the handler layer.
            this.#logger?.info("relay.registered", { relayId, region, healthCheckUrl });
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

        // Update the relay adapter's dial address so recordAssignment always reaches the current IP.
        // SI-001 exemption: updateMultiaddr sets the VPC-internal /ip4/ dial path used exclusively
        // for directory→relay RPC calls (recordAssignment, confirmSeal). This is NOT the
        // client-facing manifest dial target — that path is governed by SSM DNS multiaddrs written
        // by deploy.sh and is unaffected by relay_register.
        const multiaddr = req["multiaddr"] as string | undefined;
        if (multiaddr && typeof (this.#relay as unknown as { updateMultiaddr?: unknown }).updateMultiaddr === "function") {
          (this.#relay as unknown as { updateMultiaddr: (m: string) => void }).updateMultiaddr(multiaddr);
        }

        // CELLO-M6B-006: After successful registration, re-sign manifest if healthCheckUrl changed.
        // Fire-and-forget — relay_register_ok is already sent. Manifest update failure is logged
        // but does not block the relay's operation.
        //
        // SI-001 fix: Do NOT pass multiaddr to reSignManifestForRelay. The multiaddr in
        // relay_register is the relay's current container /ip4/ address. If written into the S3
        // manifest, the next applyManifest() poll would see non-empty multiaddrs and skip the
        // SSM DNS merge — permanently overwriting DNS addresses with the raw IP.
        // multiaddrs/peerId in the S3 manifest come exclusively from deploy.sh (sign-manifest.sh).
        if (healthCheckUrl && this.#relayPoolManager) {
          void this.#relayPoolManager.reSignManifestForRelay({
            relayId,
            healthCheckUrl,
            // multiaddr intentionally omitted: relay_register must only update healthCheckUrl.
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

  /**
   * LEVER-001 honor-check (DOD-INV-6, SI-001): each honest node consults the REPLICATED suspension
   * state and refuses its FROST share for a PAUSED agent, so no threshold forms and the agent cannot
   * sign — even with a valid client share, even if the operator's own device is the compromise. The
   * block is server-side and account-authorized, never "one mandatory node withholding": every node
   * independently honors the replicated flag. Fails CLOSED — if the suspension state cannot be read,
   * the share is refused (a transient error must not let a paused agent sign; other healthy nodes
   * still serve, preserving availability/redundancy).
   */
  async #isAgentPaused(agentPubkey: string, epochId: string): Promise<boolean> {
    let paused: boolean;
    try {
      paused = await this.#store.isAgentSuspended(agentPubkey);
    } catch (err) {
      this.#logger?.error("frost.suspend_check.failed", {
        agentShort: agentPubkey?.slice(0, 16),
        epochId,
        error: err instanceof Error ? err.message : String(err),
      });
      return true; // fail closed — refuse the share when suspension state is unknown
    }
    if (paused) {
      this.#logger?.info("frost.ceremony.refused.revoked", {
        agentId: agentPubkey?.slice(0, 16),
        epochId,
        correlationId: Buffer.from(randomBytes(16)).toString("hex"),
      });
      // LEVER-002: a burn is the per-node reaction — destroy THIS node's K_server share when we
      // observe the replicated burn (eager-on-observe). Fire-and-forget cleanup: the refusal above
      // already protects; zeroing the material is the "capability dies" completeness. Idempotent.
      void this.#store.isAgentBurned(agentPubkey)
        .then((burned) => {
          if (burned) return this.#frostHandler.destroyShares(agentPubkey);
        })
        .catch((err) => {
          this.#logger?.error("frost.share.destroy.failed", {
            agentShort: agentPubkey?.slice(0, 16),
            error: err instanceof Error ? err.message : String(err),
          });
        });
    }
    return paused;
  }

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

        // LEVER-001 honor-check: refuse this node's share if the agent is paused (DOD-INV-6, SI-001).
        if (await this.#isAgentPaused(agentPubkey, epochId)) {
          stream.send(lp.encode.single(
            CBOR_ENC.encode({ type: "frost_commit_response", ok: false, reason: "AGENT_SUSPENDED" })
          ));
          await stream.close();
          return;
        }

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

        // LEVER-001 honor-check: refuse this node's signature share if the agent is paused. The
        // block is server-side — a valid client share does not help (DOD-INV-6, SI-001).
        if (await this.#isAgentPaused(agentPubkey, epochId)) {
          stream.send(lp.encode.single(
            CBOR_ENC.encode({ type: "frost_sign_response", ok: false, reason: "AGENT_SUSPENDED" })
          ));
          await stream.close();
          return;
        }

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
              emailStubHash: validationResult.emailStubHash,
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
          // PRESENCE-001: edge-triggered — this node now owns this agent's connection → online.
          this.#recordPresence("online", authedPubkeyHex);

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
          //
          // M7-MANIFEST-002 (step 5): if a DirectoryKeyProvider is configured, sign a TBS
          // that binds this directory's nodeId to the client's nonce + pubkey, and include
          // the signature in signaling_auth_ok. The client verifies this in step 6.
          //
          // TBS format (RFC 8032 Ed25519):
          //   UTF-8('cello-directory-auth-challenge-v1\n')
          //   + UTF-8(nodeId) + '\n'
          //   + UTF-8(agentPubkeyHex) + '\n'
          //   + UTF-8(nonceHex) + '\n'
          //   + UTF-8(isoTimestamp)
          if (this.#directoryKeyProvider) {
            const nodeId = this.#directoryKeyProvider.getNodeId();
            const isoTimestamp = new Date(this.#clock.now()).toISOString();
            const tbsText = [
              "cello-directory-auth-challenge-v1",
              nodeId,
              authedPubkeyHex,
              nonceHex,
              isoTimestamp,
            ].join("\n");
            const tbsBytes = new TextEncoder().encode(tbsText);
            try {
              const sigBytes = await this.#directoryKeyProvider.sign(tbsBytes);
              const sigHex = Buffer.from(sigBytes).toString("hex");
              this.#logger?.info("directory.auth.challenge.signed", {
                nodeId,
                agentPubkeyHex: authedPubkeyHex.slice(0, 16),
                correlationId: nonceHex,
              });
              this.#sendFrame(stream, encodeSignalingAuthOk({
                type: "signaling_auth_ok",
                nodeId,
                signature: sigHex,
                timestamp: isoTimestamp,
              }));
            } catch (err) {
              this.#logger?.warn("directory.auth.challenge.sign.failed", {
                nodeId,
                agentPubkeyHex: authedPubkeyHex.slice(0, 16),
                error: err instanceof Error ? err.message : String(err),
              });
              // Signing failed: fall back to bare auth_ok for availability
              this.#sendFrame(stream, encodeSignalingAuthOk({ type: "signaling_auth_ok" }));
            }
          } else {
            this.#sendFrame(stream, encodeSignalingAuthOk({ type: "signaling_auth_ok" }));
          }

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
              // notif is the full certificate frame (SESSION-002).
              this.#sendFrame(stream, encodeSealUnilateralNotification(notif));
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
                if (!p.session_id_hex || !p.sealed_root_hex) {
                  // Unrecognised payload — acknowledge to remove from queue without delivering
                  void this.#notificationQueue!.acknowledge(pgNotif.notificationId).catch(() => {});
                  continue;
                }
                // DOD-UP-1 (L2): durable seal upgrade confirmation — deliver to A so it converges to
                // bilateral if it was offline during the upgrade. Additive; the seal_unilateral path
                // below is unchanged.
                if (pgNotif.notificationType === "seal_upgrade") {
                  const conf = upgradeConfirmedFromPayload(pgNotif.payload as Record<string, unknown>);
                  if (!conf) {
                    void this.#notificationQueue!.acknowledge(pgNotif.notificationId).catch(() => {});
                    continue;
                  }
                  try {
                    this.#sendFrame(stream, encodeSealUpgradeConfirmed(conf));
                    void this.#notificationQueue!.acknowledge(pgNotif.notificationId).catch(() => {});
                  } catch {
                    this.#logger?.warn("notification.delivery.failed", {
                      notificationId: pgNotif.notificationId, recipientAgentId: authedPubkeyHex, reason: "stream_send_failed",
                    });
                    break;
                  }
                  continue;
                }
                if (pgNotif.notificationType !== "seal_unilateral") {
                  // Unrecognised type — acknowledge without delivering
                  void this.#notificationQueue!.acknowledge(pgNotif.notificationId).catch(() => {});
                  continue;
                }
                if (deliveredInMemoryIds.has(p.session_id_hex)) {
                  // Already delivered in-memory for this session — ack the Pg row without re-sending
                  void this.#notificationQueue!.acknowledge(pgNotif.notificationId).catch(() => {});
                  continue;
                }
                // SESSION-002: reconstruct the full certificate. Pre-cert rows (no signature
                // fields) cannot be delivered as a verifiable cert — ack without delivery.
                const certNotif = unilateralNotificationFromPayload(pgNotif.payload as Record<string, unknown>);
                if (!certNotif) {
                  void this.#notificationQueue!.acknowledge(pgNotif.notificationId).catch(() => {});
                  continue;
                }
                try {
                  this.#sendFrame(stream, encodeSealUnilateralNotification(certNotif));
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

          // CELLO-M8-TRUST-001: deliver queued sealed trust signals (the pickup queue), mirroring the
          // notification drain. Resolve agent_id (the queue is agent_id-keyed) → drain → send each
          // over the stream. Do NOT delete here — the daemon ACKs (trust_signal_ack) only after it
          // opens + verifies + stores, and the inbound handler deletes on that ACK (AC-001).
          try {
            const pickupAgentId = await this.#store.getAgentIdByPubkey(authedPubkeyHex);
            if (pickupAgentId) {
              const pickups = await this.#store.drainPickup(pickupAgentId);
              for (const item of pickups) {
                if (!item.signalKind || !item.signalHash) {
                  // No identity-tree anchor → the daemon could not verify openSealed(ciphertext) against
                  // a hash, so the row cannot be delivered. We do NOT delete it (an anchor may arrive: the
                  // portal writes hash then ciphertext as two calls), but we MUST NOT skip SILENTLY — a row
                  // that can be neither verified nor discarded is a quiet stall. Log it so a persistently
                  // anchor-less pickup is observable (a stale-row sweep is the follow-up, not a silent drop).
                  this.#logger?.warn("directory.trust_signal.skipped", {
                    agentId: pickupAgentId,
                    pickupId: item.id,
                    reason: "no_anchor",
                    signalKind: item.signalKind ?? null,
                    correlationId: reconnectCorrelationId,
                  });
                  continue;
                }
                try {
                  this.#sendFrame(stream, encodeTrustSignalPickup({
                    type: "trust_signal_pickup",
                    id: item.id,
                    signal_kind: item.signalKind,
                    signal_hash: item.signalHash,
                    ciphertext: item.ciphertext,
                  }));
                  this.#logger?.info("directory.trust_signal.delivered", {
                    agentId: pickupAgentId, pickupId: item.id, correlationId: reconnectCorrelationId,
                  });
                } catch {
                  break; // stream send failed — stop; the next reconnect re-drains (still unacked)
                }
              }
            }
          } catch {
            // pickup drain failed — non-blocking; signals are re-deliverable on the next reconnect
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
        } else if (parsed.type === "revoke_agent") {
          // CELLO-M7-REMOVE-001 DOD-REMOVE-2: record a self-signed agent revocation.
          void this.#processRevokeAgent(stream, authedPubkeyHex!, parsed);
        } else if (parsed.type === "trust_signal_ack") {
          // CELLO-M8-TRUST-001: the daemon opened + verified + stored a pickup → DELETE the row so no
          // sealed ciphertext lingers (AC-002). ACCOUNT-SCOPED: resolve the ACK'ing agent's agent_id
          // and delete only a row addressed to IT — pickup_queue.id is a guessable BIGSERIAL, so an
          // id-only delete would let any authed agent wipe other agents' undelivered signals.
          const ackId = parsed.id;
          const ackPubkey = authedPubkeyHex!;
          void this.#store.getAgentIdByPubkey(ackPubkey)
            .then((ackAgentId) => {
              if (!ackAgentId) return; // unknown agent — nothing it can own to ACK
              return this.#store.ackPickup(ackId, ackAgentId).then(() =>
                this.#logger?.info("directory.trust_signal.acked", { pickupId: ackId, agentId: ackPubkey.slice(0, 16) }),
              );
            })
            .catch(() => {});
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
          // CELLO-M7-REMOVE-001 DOD-REMOVE-3 (soft enforcement): refuse to broker a session if the
          // TARGET has been revoked (the AC-003 case) — or if the revoked agent is the initiator. The
          // directory does not broker or report a revoked agent as reachable.
          const sessionTargetHex = Buffer.from(parsed.target_pubkey).toString("hex");
          if (this.#store.isAgentRevoked(sessionTargetHex) || this.#store.isAgentRevoked(authedPubkeyHex!)) {
            this.#sendFrame(stream, encodeSessionRequestError({ type: "session_request_error", reason: "agent_revoked" }));
            continue;
          }
          // CELLO-M8-LEVER-001 (DOD-INV-6, SI-001): refuse to broker a session if the TARGET or the
          // INITIATOR is PAUSED (reversible suspend). Server-side block — a valid client share does
          // not help, and it holds even if the operator's own device is the compromise. A pause is
          // mutable + a security control, so this reads the live replicated row (async), not a cache.
          if ((await this.#store.isAgentSuspended(sessionTargetHex)) || (await this.#store.isAgentSuspended(authedPubkeyHex!))) {
            this.#logger?.info("frost.ceremony.refused.revoked", {
              agentId: authedPubkeyHex!.slice(0, 16),
              correlationId: Buffer.from(randomBytes(16)).toString("hex"),
            });
            this.#sendFrame(stream, encodeSessionRequestError({ type: "session_request_error", reason: "agent_suspended" }));
            continue;
          }
          // M7-WIRE-001 AC-002: Reject session_request missing initiator session Peer ID
          const parsedReq = parsed as { connection_id?: string; relay_rtt?: Record<string, number>; initiator_session_peer_id?: string; initiator_session_addrs?: string[]; transport_mode?: "direct" | "relay"; wants_session_offer?: boolean };
          if (!parsedReq.initiator_session_peer_id || !parsedReq.initiator_session_addrs || parsedReq.initiator_session_addrs.length === 0) {
            this.#sendFrame(stream, encodeSessionRequestError({ type: "session_request_error", reason: "session_request_missing_peer_id" }));
            continue;
          }
          // Run concurrently — ceremony_result frames must be processed by this same loop
          // while #processSessionRequest is suspended awaiting the ceremony round-trip.
          void this.#processSessionRequest(stream, authedPubkeyHex!, Buffer.from(parsed.target_pubkey).toString("hex"), parsedReq.connection_id, parsedReq.relay_rtt, parsedReq.initiator_session_peer_id, parsedReq.initiator_session_addrs, parsedReq.transport_mode, parsedReq.wants_session_offer === true);
        } else if (parsed.type === "session_offer_accept") {
          // M7-WIRE-001 AC-003: handle session offer acceptance from target (Bob)
          const acceptFrame = parsed as { session_id?: Uint8Array; counterparty_session_peer_id?: string; counterparty_session_addrs?: string[] };
          if (acceptFrame.session_id && acceptFrame.counterparty_session_peer_id && acceptFrame.counterparty_session_addrs && acceptFrame.counterparty_session_addrs.length > 0) {
            const acceptSessionIdHex = Buffer.from(acceptFrame.session_id).toString("hex");
            // Validate sender: session must be registered AND sender must be its target
            const expectedTarget = this.#sessionOfferAcceptTargets.get(acceptSessionIdHex);
            if (!expectedTarget || expectedTarget !== authedPubkeyHex) {
              continue; // drop — session unknown or sender is not the target
            }
            this.#pendingSessionOfferAccepts.set(acceptSessionIdHex, {
              counterpartySessionPeerId: acceptFrame.counterparty_session_peer_id,
              counterpartySessionAddrs: acceptFrame.counterparty_session_addrs,
            });
            // Resolve any pending waiter for this session_id
            const waiter = this.#sessionOfferAcceptWaiters.get(acceptSessionIdHex);
            if (waiter) {
              waiter();
              this.#sessionOfferAcceptWaiters.delete(acceptSessionIdHex);
            }
          }
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
          void this.#processSealUnilateral(stream, authedPubkeyHex!, parsed);
        } else if (parsed.type === "seal_upgrade_request") {
          // CELLO-M7-UPGRADE-001 (DOD-UP-1): returning absent party ratifies the unilateral seal
          void this.#processSealUpgradeRequest(stream, authedPubkeyHex!, parsed);
        } else if (parsed.type === "ping") {
          // M7-DIR-PING-001: heartbeat ping/pong — no state, no blocking
          this.#logger?.debug("directory.signaling.ping.received", {
            clientPubkey: authedPubkeyHex!,
            streamId: stream.id,
          });
          try {
            this.#sendFrame(stream, encodePong(parsed.ts));
            this.#logger?.debug("directory.signaling.pong.sent", {
              clientPubkey: authedPubkeyHex!,
              streamId: stream.id,
            });
          } catch (pongErr) {
            this.#logger?.debug("directory.signaling.pong.failed", {
              clientPubkey: authedPubkeyHex!,
              streamId: stream.id,
              error: pongErr instanceof Error ? pongErr.message : String(pongErr),
            });
          }
        } else if (parsed.type === "manifest_poll_request") {
          // M7-MANIFEST-002: client requests a fresh copy of the consortium manifest.
          // Respond immediately if a DirectoryManifestStore is configured.
          if (this.#directoryManifestStore) {
            const manifest = this.#directoryManifestStore.getCurrentManifest();
            this.#logger?.info("directory.manifest.poll.response", {
              agentPubkeyHex: authedPubkeyHex!.slice(0, 16),
            });
            this.#sendFrame(stream, encodeManifestPollResponse({ type: "manifest_poll_response", manifest }));
          }
          // When no store is configured, manifest_poll_request is silently ignored for backward compat.
        } else if (parsed.type === "seal_interrupted_request") {
          // M7-SESSION-001 AC-009: pass-through routing — forward to counterparty
          const targetStream = this.#streams.get(parsed.counterpartyPubkey);
          if (targetStream) {
            try {
              this.#sendFrame(targetStream, CBOR_ENC.encode(parsed));
              this.#logger?.info("directory.signaling.seal_interrupted_request.forwarded", {
                sessionId: parsed.sessionId,
                initiator: parsed.initiatorPubkey.slice(0, 16),
                target: parsed.counterpartyPubkey.slice(0, 16),
              });
            } catch (fwdErr) {
              this.#logger?.warn("directory.signaling.seal_interrupted_request.forward_failed", {
                sessionId: parsed.sessionId,
                error: fwdErr instanceof Error ? fwdErr.message : String(fwdErr),
              });
            }
          } else {
            this.#logger?.info("directory.signaling.seal_interrupted_request.target_offline", {
              sessionId: parsed.sessionId,
              target: parsed.counterpartyPubkey.slice(0, 16),
            });
          }
        } else if (parsed.type === "seal_interrupted_ack") {
          // M7-SESSION-001 AC-009: pass-through routing — forward ack back to initiator.
          // initiatorPubkey is included in the frame so the directory can route directly
          // by looking up the initiator's authenticated stream in #streams.
          const targetStream = this.#streams.get(parsed.initiatorPubkey);
          if (targetStream) {
            try {
              this.#sendFrame(targetStream, CBOR_ENC.encode(parsed));
              this.#logger?.info("directory.signaling.seal_interrupted_ack.forwarded", {
                sessionId: parsed.sessionId,
                target: parsed.initiatorPubkey.slice(0, 16),
              });
            } catch (fwdErr) {
              this.#logger?.warn("directory.signaling.seal_interrupted_ack.forward_failed", {
                sessionId: parsed.sessionId,
                error: fwdErr instanceof Error ? fwdErr.message : String(fwdErr),
              });
            }
          } else {
            this.#logger?.info("directory.signaling.seal_interrupted_ack.initiator_offline", {
              sessionId: parsed.sessionId,
              initiator: parsed.initiatorPubkey.slice(0, 16),
            });
          }
        } else if (parsed.type === "seal_interrupted_rejection") {
          // M7-SESSION-001 AC-009: pass-through routing — forward rejection back to initiator.
          // initiatorPubkey is included in the frame so the directory can route directly
          // by looking up the initiator's authenticated stream in #streams.
          const targetStream = this.#streams.get(parsed.initiatorPubkey);
          if (targetStream) {
            try {
              this.#sendFrame(targetStream, CBOR_ENC.encode(parsed));
              this.#logger?.info("directory.signaling.seal_interrupted_rejection.forwarded", {
                sessionId: parsed.sessionId,
                target: parsed.initiatorPubkey.slice(0, 16),
              });
            } catch (fwdErr) {
              this.#logger?.warn("directory.signaling.seal_interrupted_rejection.forward_failed", {
                sessionId: parsed.sessionId,
                error: fwdErr instanceof Error ? fwdErr.message : String(fwdErr),
              });
            }
          } else {
            this.#logger?.info("directory.signaling.seal_interrupted_rejection.initiator_offline", {
              sessionId: parsed.sessionId,
              initiator: parsed.initiatorPubkey.slice(0, 16),
            });
          }
        } else {
          // Unknown frame type for authenticated state — ignore
        }
      }
    } catch (streamErr) {
      const msg = streamErr instanceof Error ? streamErr.message : String(streamErr);
      protocolLog("AUTH", `Signaling stream error — peer ${authedPubkeyHex ? truncHex(authedPubkeyHex) : "unauthenticated"} error="${msg}"`);
      this.#logger?.warn("signaling.stream.error", {
        authedShort: authedPubkeyHex?.slice(0, 16) ?? "none",
        error: msg,
      });
    } finally {
      protocolLog("AUTH", `Signaling stream CLOSED — peer ${authedPubkeyHex ? truncHex(authedPubkeyHex) : "unauthenticated"} streamsMapSize=${this.#streams.size}`);
      this.#logger?.info("signaling.stream.closed", {
        authedShort: authedPubkeyHex?.slice(0, 16) ?? "none",
        streamsMapSize: this.#streams.size,
        pendingSessionsCount: this.#pendingSessions.size,
        pendingSessionKeys: [...this.#pendingSessions.keys()].map(k => truncHex(k)),
      });
      if (authedPubkeyHex && this.#streams.get(authedPubkeyHex) === stream) {
        this.#streams.delete(authedPubkeyHex);
        // PRESENCE-001: edge-triggered — the agent's stream closed → offline + last-seen (only if
        // this node still owns the row; a stale stream that was already replaced no-ops in SQL).
        this.#recordPresence("offline", authedPubkeyHex);
        protocolLog("AUTH", `Removed stream from map — peer ${truncHex(authedPubkeyHex)}`);
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
  /**
   * CELLO-M7-REMOVE-001 (DOD-REMOVE-2): record a self-signed agent revocation. Self-authorized — the
   * stream is already K_local-authenticated as `authedPubkeyHex`; the agent may revoke ONLY its own
   * agent_id, and the signature must verify against its registered K_local (SI-001). On success the
   * revocation is APPENDED (never an agent_profiles mutation — SI-002, guardrail #5); on any failure
   * NOTHING is written and a distinct reason is returned.
   */
  async #processRevokeAgent(
    stream: Stream,
    authedPubkeyHex: string,
    frame: import("./directory-types.js").RevokeAgentRequest,
  ): Promise<void> {
    // The authenticated stream key is the agent's own K_local — resolve its profile by that key.
    const profile = this.#store.getProfile(authedPubkeyHex);
    if (!profile) {
      this.#sendFrame(stream, encodeAgentRevocationError({ type: "agent_revocation_error", reason: "unknown_agent", agent_id: frame.agent_id }));
      this.#logger?.warn("agent.revocation.rejected", { agentId: frame.agent_id, reason:"unknown_agent" });
      return;
    }
    // Self-authorization (SI-001 / guardrail #1): an agent may revoke ONLY its own agent_id.
    if (profile.agent_id !== frame.agent_id) {
      this.#sendFrame(stream, encodeAgentRevocationError({ type: "agent_revocation_error", reason: "not_self_authorized", agent_id: frame.agent_id }));
      this.#logger?.warn("agent.revocation.rejected", { agentId: frame.agent_id, reason:"not_self_authorized" });
      return;
    }
    // Verify the self-signature over the canonical TBS against the registered K_local. A forged signer
    // or invalid signature is rejected and NOTHING is written (SI-001).
    const tbs = buildAgentRevocationTbs(frame.agent_id, profile.k_local_pubkey, frame.epoch_id ?? "", frame.reason ?? "", frame.revoked_at);
    let sigBytes: Uint8Array;
    try {
      sigBytes = new Uint8Array(Buffer.from(frame.signature, "hex"));
    } catch {
      sigBytes = new Uint8Array(0);
    }
    const pubBytes = new Uint8Array(Buffer.from(authedPubkeyHex, "hex"));
    if (sigBytes.length !== 64 || !verify(pubBytes, tbs, sigBytes)) {
      this.#sendFrame(stream, encodeAgentRevocationError({ type: "agent_revocation_error", reason: "signature_invalid", agent_id: frame.agent_id }));
      this.#logger?.warn("agent.revocation.rejected", { agentId: frame.agent_id, reason:"signature_invalid" });
      return;
    }
    // Verified — DURABLY append the revocation fact (idempotent). agent_profiles is left UNTOUCHED.
    // Await the commit BEFORE acking: a revocation is an authoritative, replicated fact; acking
    // "recorded" before it is durable would silently re-enable the agent on restart and disable the
    // client's re-push recovery (review HIGH / fallback-finder HIGH-1).
    try {
      await this.#store.insertAgentRevocation({
        agentId: frame.agent_id,
        kLocalPubkey: profile.k_local_pubkey,
        epochId: frame.epoch_id ?? "",
        reason: frame.reason ?? "",
        signature: sigBytes,
        revokedAt: frame.revoked_at,
      });
    } catch (err) {
      this.#logger?.error("agent.revocation.persist_failed", { agentId: frame.agent_id, error: err instanceof Error ? err.message : String(err) });
      this.#sendFrame(stream, encodeAgentRevocationError({ type: "agent_revocation_error", reason: "persist_failed", agent_id: frame.agent_id }));
      return;
    }
    this.#logger?.info("agent.revocation.recorded", { agentId: frame.agent_id });
    this.#sendFrame(stream, encodeAgentRevocationAck({ type: "agent_revocation_ack", agent_id: frame.agent_id }));
  }

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
    // DOD-DKG-1: derive the DKG topology from THIS directory's verified consortium manifest
    // (topology consensus — neither the client nor any single node dictates N; the officer-
    // signed manifest is the tamper-proof source). N = the manifest's node count; an absent or
    // single-node manifest → the single-node 2-of-2 (M6/M7 back-compat).
    const consortiumNodeCount = this.#directoryManifestStore?.getCurrentManifest()?.nodes.length ?? 1;
    // Fork B threshold: N=1 keeps 2-of-2 (both mandatory); N≥2 → T=N (= max−1: client + any
    // N−1 directory nodes; tolerates exactly ONE directory outage at SIGNING time; no single
    // directory node mandatory). `participants` is the directory-node count — runNetworkDkg adds
    // the client as +1, so FROST max = participants+1. DKG itself still needs all N+1 present.
    const dkgParticipants = consortiumNodeCount;
    const dkgThreshold = consortiumNodeCount === 1 ? 2 : consortiumNodeCount;
    // OBS-001 AC-004: DKG begin log
    protocolLog(
      "REG",
      `DKG begin — agent ${truncHex(frame.k_local_pubkey)}, ${dkgParticipants} directory nodes, threshold ${dkgThreshold}`,
    );
    this.#sendFrame(stream, encodeDkgReady({
      type: "dkg_ready",
      epochId,
      participants: dkgParticipants,
      threshold: dkgThreshold,
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

    // OPS-AGENT-001 AC-005b: Account deduplication. Resolve the account_id FIRST
    // (lookup-or-create by phone_stub_hash) so the agent_profiles row is INSERTed WITH
    // account_id atomically — the prior "insert without account_id then UPDATE it"
    // raced the fire-and-forget profile INSERT and could leave account_id permanently
    // NULL (the UPDATE matched 0 rows when it ran before the INSERT committed). Account
    // resolution failure must NOT block registration, so on error we proceed with a
    // null account_id (the profile is still created; the link is repairable later).
    this.#pendingPreAuthData.delete(frame.k_local_pubkey);
    let accountId: string | null = null;
    if (this.#pgPool && preAuthDataForHash) {
      try {
        accountId = await resolveAccountId(
          this.#pgPool,
          preAuthDataForHash.phoneStubHash,
          preAuthDataForHash.emailStubHash,
        );
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : String(err);
        this.#logger?.error("preauth.account.link.failed", { agentId, reason });
      }
    }

    const profile = {
      k_local_pubkey: frame.k_local_pubkey,
      primary_pubkey: primaryPubkeyFromDkg,
      ml_dsa_pubkey: frame.ml_dsa_pubkey,
      phone_stub_hash: phoneStubHash,  // SHA-256 only, per FIPS 180-4 — raw stub never stored
      profile: {},
      registered_at: this.#clock.now(),
      status: "active",
      agent_id: agentId,
      // setProfile inserts WITH account_id when non-null (atomic), else the no-account path.
      account_id: accountId,
    } as AgentProfile & { account_id: string | null };
    this.#store.setProfile(profile);

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
    initiatorSessionPeerId?: string,
    initiatorSessionAddrs?: string[],
    requestedTransportMode?: "direct" | "relay",
    requestWantsOffer = false,
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

    // M7-WIRE-001 AC-003: Resolve counterparty session Peer ID.
    // If an offer-accept has already arrived (race-won), use it.
    // Otherwise, check if one arrives within a brief window. If not, proceed with
    // empty defaults — the counterparty may be a pre-M7 client or the session_offer
    // notification hasn't triggered yet. Full offer-accept handshake requires a
    // session_offer frame to be sent to the target first (wired in WIRE-002).
    const sessionIdHexForWait = Buffer.from(session_id).toString("hex");
    // Register expected target so the dispatch loop can validate session_offer_accept sender
    this.#sessionOfferAcceptTargets.set(sessionIdHexForWait, targetHex);
    let counterpartySessionPeerId = "";
    let counterpartySessionAddrs: string[] = [];
    const existingAccept = this.#pendingSessionOfferAccepts.get(sessionIdHexForWait);
    if (existingAccept) {
      counterpartySessionPeerId = existingAccept.counterpartySessionPeerId;
      counterpartySessionAddrs = existingAccept.counterpartySessionAddrs;
      this.#pendingSessionOfferAccepts.delete(sessionIdHexForWait);
    } else if (requestWantsOffer && this.#streams.get(targetHex)) {
      // M7-WIRE-002: when the initiator EXPLICITLY opts in (session_request.wants_session_offer
      // — the daemon's real session path does), and the target is connected, send it a
      // session_offer carrying the initiator's session endpoint, then wait for the target's
      // session_offer_accept (the dispatch loop resolves the waiter) so the assignment carries a
      // reachable counterparty endpoint. The opt-in keeps pre-WIRE-002 callers (and the existing
      // directory tests) on the original no-offer path — no extra frame, no wait.
      const targetStream = this.#streams.get(targetHex)!;
      this.#sendFrame(
        targetStream,
        CBOR_ENC.encode({
          type: "session_offer",
          session_id,
          initiator_session_peer_id: initiatorSessionPeerId ?? "",
          initiator_session_addrs: initiatorSessionAddrs ?? [],
        }),
      );
      const accepted = await Promise.race([
        new Promise<boolean>((resolve) => {
          this.#sessionOfferAcceptWaiters.set(sessionIdHexForWait, () => resolve(true));
        }),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2_000)),
      ]);
      this.#sessionOfferAcceptWaiters.delete(sessionIdHexForWait);
      if (accepted) {
        const acceptData = this.#pendingSessionOfferAccepts.get(sessionIdHexForWait)!;
        counterpartySessionPeerId = acceptData.counterpartySessionPeerId;
        counterpartySessionAddrs = acceptData.counterpartySessionAddrs;
      }
      this.#pendingSessionOfferAccepts.delete(sessionIdHexForWait);
    } else {
      // Brief wait (100ms) for a session_offer_accept that arrived concurrently (original path).
      const accepted = await Promise.race([
        new Promise<boolean>((resolve) => {
          this.#sessionOfferAcceptWaiters.set(sessionIdHexForWait, () => resolve(true));
        }),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 100)),
      ]);
      this.#sessionOfferAcceptWaiters.delete(sessionIdHexForWait);
      if (accepted) {
        const acceptData = this.#pendingSessionOfferAccepts.get(sessionIdHexForWait)!;
        counterpartySessionPeerId = acceptData.counterpartySessionPeerId;
        counterpartySessionAddrs = acceptData.counterpartySessionAddrs;
      }
      this.#pendingSessionOfferAccepts.delete(sessionIdHexForWait);
    }
    this.#sessionOfferAcceptTargets.delete(sessionIdHexForWait);

    // NOTE (DOD-SPINE-6 / WIRE-002): when no session_offer_accept handshake supplies the
    // counterparty's SESSION endpoint, it is left empty. The target's announced peer_info
    // (`targetInfo`) is its per-agent DIRECTORY node, NOT its standing-receiver session node,
    // so it is NOT a valid content endpoint (using it yields "could not negotiate
    // /cello/content"). Communicating B's session endpoint to A requires the WIRE-002
    // session_offer→session_offer_accept round-trip — tracked as the SPINE-6 build.

    // TRANSPORT-001 stub: real AutoNAT probe not yet wired.
    // Honour client-requested transport_mode for testability; TRANSPORT-001 will
    // override with the AutoNAT probe result. Defaults to 'relay' when absent.
    const transportMode: "direct" | "relay" = requestedTransportMode ?? "relay";

    // SESSION-004 Step 3: Build TBS — single source of truth via protocol-types (HIGH-5)
    // M7-WIRE-001: Extended to 10 fields. Uses local buildSessionEstablishmentTbsM7
    // until @cello-protocol/protocol-types ≥0.0.5 is published (AC-021).
    const tbs = buildSessionEstablishmentTbsM7(
      session_id,
      new Uint8Array(initiatorPubkey),
      new Uint8Array(targetPubkey),
      genesis_prev_root,
      session_timestamp,
      initiatorSessionPeerId!,
      initiatorSessionAddrs!,
      counterpartySessionPeerId,
      counterpartySessionAddrs,
      transportMode,
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
      // M7-WIRE-001: includes session Peer IDs and transport mode
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
        initiator_session_peer_id: initiatorSessionPeerId!,
        initiator_session_addrs: initiatorSessionAddrs!,
        counterparty_session_peer_id: counterpartySessionPeerId,
        counterparty_session_addrs: counterpartySessionAddrs,
        transport_mode: transportMode,
      };

      // (e) Register with relay BEFORE delivering to clients (SI-003)
      // M7-WIRE-001 AC-009: only register with relay when transport_mode === 'relay'.
      // For direct P2P sessions, the relay has no role and must not hold session Peer IDs.
      if (transportMode === "relay") {
        // M-4: the relay binds initiator_session_peer_id / counterparty_session_peer_id
        // into #sessionPeerIdBindings. Those Peer IDs MUST be covered by the signature
        // the relay verifies, or the relay binds data the directory never authenticated.
        // Append the two Peer IDs after the original 4 fields when both are present,
        // mirroring the presence gate used for the client-facing 10-field TBS. When
        // either is absent (pre-M7 / initiator-only), fall back to the original 4-field
        // layout so legacy assignments still verify. The relay's recordAssignment uses
        // the identical gate and field order on the verification side.
        const relayTbsFields: unknown[] = [
          session_id,
          new Uint8Array(initiatorPubkey),
          new Uint8Array(targetPubkey),
          session_timestamp > 0xffffffff ? BigInt(session_timestamp) : session_timestamp,
        ];
        if (initiatorSessionPeerId && counterpartySessionPeerId) {
          relayTbsFields.push(initiatorSessionPeerId, counterpartySessionPeerId);
        }
        const relayTbs = CBOR_ENC.encode(relayTbsFields) as Uint8Array;
        const relayDirSig = new Uint8Array(await this.#keyProvider.sign(relayTbs));
        const relayAssignment: RelaySessionAssignment = {
          session_id,
          participant_a: new Uint8Array(initiatorPubkey),
          participant_b: new Uint8Array(targetPubkey),
          session_timestamp,
          directory_signature: relayDirSig,
          initiator_session_peer_id: initiatorSessionPeerId!,
          counterparty_session_peer_id: counterpartySessionPeerId,
        };
        const recorded = await this.#relay.recordAssignment(relayAssignment);
        if (recorded.ok && !this.#relayAuthenticated) {
          this.#relayAuthenticated = true;
          protocolLog("AUTH", `Relay ${truncHex(this.#relayEndpoint.peer_id)} authenticated`);
        }
        if (!recorded.ok) {
          protocolLog("SESS", `Request failed — agent ${truncHex(initiatorHex)}, reason: ${recorded.reason}`);
          this.#logger?.warn("relay.record_assignment.failed", { agentShort: truncHex(initiatorHex), reason: recorded.reason });
          this.#sendFrame(stream, encodeSessionRequestError({ type: "session_request_error", reason: "relay_unavailable" }));
          return;
        }
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
      this.#logger?.info("session.assignment.delivery.begin", {
        sessionId: truncHex(sessionIdHex),
        initiatorShort: initiatorHex.slice(0, 16),
        targetShort: targetHex.slice(0, 16),
        initiatorStreamInMap: this.#streams.get(initiatorHex) === stream,
        targetStreamInMap: !!this.#streams.get(targetHex),
        streamsMapSize: this.#streams.size,
      });

      // (f) Deliver to both clients
      const assignmentFrame: SessionAssignmentFrame = { type: "session_assignment", assignment };
      const encoded = encodeSessionAssignment(assignmentFrame);
      const pending = this.#pendingSessions.get(sessionIdHex);
      try {
        protocolLog("SESS", `Sending session_assignment to INITIATOR — session ${truncHex(sessionIdHex)}`);
        this.#sendFrame(stream, encoded);
        protocolLog("SESS", `session_assignment sent to INITIATOR OK — session ${truncHex(sessionIdHex)}`);
        this.#logger?.info("session.assignment.initiator.sent", { sessionId: truncHex(sessionIdHex), initiatorShort: initiatorHex.slice(0, 16) });
        if (pending) pending.initiatorGotAssignment = true;
      } catch (initiatorSendErr) {
        const msg = initiatorSendErr instanceof Error ? initiatorSendErr.message : String(initiatorSendErr);
        protocolLog("SESS", `session_assignment FAILED to initiator — session ${truncHex(sessionIdHex)} error="${msg}"`);
        this.#logger?.error("session.assignment.initiator.send.failed", {
          sessionId: truncHex(sessionIdHex),
          initiatorShort: initiatorHex.slice(0, 16),
          error: msg,
          initiatorStreamInMap: this.#streams.get(initiatorHex) === stream,
          streamsMapSize: this.#streams.size,
        });
        return;
      }
      try {
        protocolLog("SESS", `Sending session_assignment to TARGET — session ${truncHex(sessionIdHex)}`);
        this.#sendFrame(targetStream, encoded);
        protocolLog("SESS", `session_assignment sent to TARGET OK — session ${truncHex(sessionIdHex)}`);
        this.#logger?.info("session.assignment.target.sent", { sessionId: truncHex(sessionIdHex), targetShort: targetHex.slice(0, 16) });
        if (pending) {
          pending.targetGotAssignment = true;
          // Both frames sent — session is fully established; finally block will just clean up.
          pending.fullyEstablished = true;
        }
      } catch (targetSendErr) {
        const msg = targetSendErr instanceof Error ? targetSendErr.message : String(targetSendErr);
        protocolLog("SESS", `session_assignment FAILED to target — session ${truncHex(sessionIdHex)} error="${msg}"`);
        this.#logger?.error("session.assignment.target.send.failed", {
          sessionId: truncHex(sessionIdHex),
          targetShort: targetHex.slice(0, 16),
          error: msg,
          targetStreamInMap: !!this.#streams.get(targetHex),
          streamsMapSize: this.#streams.size,
        });
        // Target stream failed mid-delivery; session is still registered on relay.
        // Leave fullyEstablished=false so the finally block discards the relay state.
      }
      protocolLog("SESS", `Delivery complete — session ${truncHex(sessionIdHex)} initiatorGot=${pending?.initiatorGotAssignment} targetGot=${pending?.targetGotAssignment} fullyEstablished=${pending?.fullyEstablished}`);
      this.#logger?.info("session.assignment.delivery.complete", {
        sessionId: truncHex(sessionIdHex),
        initiatorGotAssignment: pending?.initiatorGotAssignment,
        targetGotAssignment: pending?.targetGotAssignment,
        fullyEstablished: pending?.fullyEstablished,
      });
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
   * SESSION-002: Process a unilateral seal request from a client. Validates that
   * delivery_grace_seconds has elapsed, FETCHES the signed-leaf chain from the relay,
   * REBUILDS + VERIFIES the root against frame.reported_root (it never trusts the reported
   * root), runs a real FROST notarization with the counterparty ABSENT, and delivers a
   * verifiable certificate. Supersedes the PERSIST-015 faith-based bookkeeping (Gap 1).
   */
  async #processSealUnilateral(
    stream: import("@libp2p/interface").Stream,
    senderHex: string,
    frame: import("./directory-types.js").SealUnilateral,
  ): Promise<void> {
    const sessionIdHex = Buffer.from(frame.session_id).toString("hex");
    const correlationId = sessionIdHex;

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

    // ── SESSION-002: verify the reported root, then FROST-notarize with B ABSENT ──
    // (Gap 1 fix — the directory no longer stores frame.reported_root on faith.)

    // Identify the present (submitting) party and the ABSENT counterparty. #sessionParticipants
    // persists beyond stream closure (set when the session was established); fall back to the
    // pending-session record if the stream is still open.
    const participants = this.#sessionParticipants.get(sessionIdHex)
      ?? (() => {
        const p = this.#pendingSessions.get(sessionIdHex);
        return p ? { initiatorHex: p.initiatorHex, targetHex: p.targetHex } : null;
      })();
    if (!participants) {
      this.#logger?.error("session.unilateral.verification.failed", {
        sessionId: sessionIdHex,
        reason: "unilateral_participants_unknown",
        correlationId,
      });
      return;
    }
    const absentPartyHex = participants.initiatorHex === senderHex
      ? participants.targetHex
      : participants.initiatorHex;

    // DOD-SEAL-1: fetch the session's signed-leaf chain from the relay (the seal_unilateral
    // frame carries no leaves). DB-001: if the chain is unavailable, reject — never seal on
    // the unverified reported_root.
    let leafData: RelaySealData | null = null;
    try {
      leafData = this.#relay.getSealLeaves
        ? (await this.#relay.getSealLeaves(frame.session_id)) ?? null
        : null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.#logger?.error("session.unilateral.verification.failed", {
        sessionId: sessionIdHex,
        reason: "unilateral_leaves_unavailable",
        error: msg,
        correlationId,
      });
      return;
    }
    if (!leafData || !leafData.leaves || leafData.leaves.length === 0) {
      this.#logger?.error("session.unilateral.verification.failed", {
        sessionId: sessionIdHex,
        reason: "unilateral_leaves_unavailable",
        correlationId,
      });
      return;
    }
    this.#logger?.info("session.unilateral.leaves.fetched", {
      sessionId: sessionIdHex,
      leafCount: leafData.leaves.length,
      correlationId,
    });

    // DOD-SEAL-1: rebuild + verify the chain and compare to frame.reported_root. Rejects
    // unilateral_root_unverifiable (mismatch / bad chain) or unilateral_seal_leaf_invalid
    // (not exactly one SEAL ctrl leaf from the present party).
    const verifyResult = this.#verifyUnilateralChain(leafData.leaves, frame.reported_root, senderHex);
    if (!verifyResult.ok) {
      this.#logger?.error("session.unilateral.verification.failed", {
        sessionId: sessionIdHex,
        reason: verifyResult.reason,
        correlationId,
      });
      return;
    }
    const recomputedRoot = verifyResult.recomputedRoot;
    const leafCount = leafData.leaves.length;
    const close_timestamp = now;
    const presentPubkey = Buffer.from(senderHex, "hex");
    const absentPubkey = Buffer.from(absentPartyHex, "hex");

    // DOD-LIVE-2: the counterparty attestation comes FROM THE RELAY (the session-path
    // liveness authority), never self-asserted. gone → ABSENT (a positive disconnect was
    // observed); alive or unknown → DELIVERED (reachable, or never-tracked fail-safe). The
    // seal completes either way — this is a timeout-driven unilateral seal; the liveness
    // only colours how the counterparty is recorded (never whether the seal happens).
    let livenessState: "alive" | "gone" | "unknown" = "unknown";
    try {
      livenessState = this.#relay.getSessionLiveness
        ? await this.#relay.getSessionLiveness(absentPubkey)
        : "unknown";
    } catch {
      livenessState = "unknown";
    }
    const attestation: "ABSENT" | "DELIVERED" = livenessState === "gone" ? "ABSENT" : "DELIVERED";
    this.#logger?.info("session.unilateral.attestation", {
      sessionId: sessionIdHex,
      absentPartyPubkey: truncHex(absentPartyHex),
      liveness: livenessState,
      attestation,
      correlationId,
    });

    // In-flight guard: set now that verification passed so a concurrent duplicate
    // seal_unilateral frame is rejected (top of method) rather than double-FROST'd. The
    // durable dedup is the seal_notarizations UNIQUE(session_id) constraint (AC-008).
    this.#unilateralSeals.set(sessionIdHex, {
      sealed_root: recomputedRoot,
      sealed_at: now,
      submitter_hex: senderHex,
    });

    // DOD-SEAL-2: notarize with the counterparty ABSENT.
    const initiatorPrimaryPubkey = this.#primaryPubkeys.get(senderHex);
    if (!initiatorPrimaryPubkey) {
      // Single-key fallback (pre-DKG / local): sign the notarization TBS with the node key.
      // The single-key certificate is rejected by M2 clients, identical to the bilateral path.
      const notarizationTbs = CBOR_ENC.encode([
        frame.session_id,
        recomputedRoot,
        close_timestamp > 0xffffffff ? BigInt(close_timestamp) : close_timestamp,
      ]);
      const notarizationSig = new Uint8Array(await this.#keyProvider.sign(notarizationTbs));
      await this.#completeUnilateralNotarization({
        sessionId: frame.session_id,
        sessionIdHex,
        sealedRoot: recomputedRoot,
        presentPubkey,
        absentPubkey,
        presentHex: senderHex,
        absentHex: absentPartyHex,
        closeTimestamp: close_timestamp,
        leafCount,
        frostSignature: notarizationSig,
        signatureType: "single",
        attestation,
        correlationId,
      });
      return;
    }

    // FROST path (D-2): the present party is the seal initiator + FROST coordinator. Push
    // seal_verified to the INITIATOR ONLY (SI-002: never to the absent counterparty), and
    // complete the notarization when the initiator returns seal_frost_signature.
    const tbs = buildSealTbs(frame.session_id, recomputedRoot, leafCount, close_timestamp);
    this.#pendingFrostSeals.set(sessionIdHex, {
      initiatorHex: senderHex,
      participantAHex: senderHex,
      participantBHex: absentPartyHex,
      sealedRoot: recomputedRoot,
      leafCount,
      timestamp: close_timestamp,
      tbs,
      correlationId,
      unilateral: true,
      attestation,
    });

    const sealVerifiedEvent: SealVerified = {
      type: "seal_verified",
      session_id: frame.session_id,
      sealed_root: recomputedRoot,
      leaf_count: leafCount,
      timestamp: close_timestamp,
    };
    const presentStream = this.#streams.get(senderHex);
    if (presentStream) {
      try {
        this.#sendFrame(presentStream, encodeSealVerified(sealVerifiedEvent));
      } catch {
        this.#store.enqueueNotification(senderHex, sealVerifiedEvent, sessionIdHex);
      }
    } else {
      // DB-002: initiator disconnected before FROST — enqueue for reconnect.
      this.#store.enqueueNotification(senderHex, sealVerifiedEvent, sessionIdHex);
    }
    // SI-002: the absent counterparty is NEVER sent seal_verified.
  }

  /**
   * SESSION-002: rebuild the Merkle root from the signed-leaf chain and verify it against
   * the present party's reported_root, mirroring the bilateral processSeal machinery but
   * requiring EXACTLY ONE SEAL control leaf (kind "ctrl") from the present party (the absent
   * party has none). Read-only; no state mutation.
   */
  #verifyUnilateralChain(
    leaves: RelaySealData["leaves"],
    reportedRoot: Uint8Array,
    presentHex: string,
  ): { ok: true; recomputedRoot: Uint8Array } | { ok: false; reason: string } {
    // (a) Rebuild the CLIENT-VERIFIABLE root and compare to the reported root. The client's
    // local SessionTree hashes each leaf as its content_hash (kind "hash"), NOT as
    // encodeStructure2(s2) — the latter is the relay/directory internal integrity root the
    // client cannot reproduce (it lacks the relay-assigned Structure 2 fields). So the root the
    // directory signs + the present party verifies is the content-hash root, rebuilt here from
    // each leaf's authenticated s2.content_hash. The encodeStructure2 chain below proves those
    // content_hashes are authentic + correctly ordered; this root is what the cert binds.
    const contentInputs: LeafInput[] = leaves.map((l) => ({ kind: "hash" as const, data: l.s2.content_hash }));
    const recomputedRoot = merkleRoot(buildMerkleTree(contentInputs));
    if (!bufEqual(recomputedRoot, reportedRoot)) {
      return { ok: false, reason: "unilateral_root_unverifiable" };
    }

    // (b–d) Per-leaf Structure 1 signature, prev_root chain, and causal-chain verification.
    let runningRoot = leaves.length > 0 ? leaves[0].s2.prev_root : new Uint8Array(32);
    for (let i = 0; i < leaves.length; i++) {
      const leaf = leaves[i];
      if (!verify(leaf.s2.sender_pubkey, leaf.structure1_cbor, leaf.s2.sender_signature)) {
        return { ok: false, reason: "unilateral_root_unverifiable" };
      }
      const s1Fields = decodeStructure1Fields(leaf.structure1_cbor);
      if (!s1Fields) return { ok: false, reason: "unilateral_root_unverifiable" };
      if (!bufEqual(leaf.s2.prev_root, runningRoot)) {
        return { ok: false, reason: "unilateral_root_unverifiable" };
      }
      const senderHex = Buffer.from(leaf.s2.sender_pubkey).toString("hex");
      let effectiveSeen = 0;
      for (let j = 0; j < i; j++) {
        const otherHex = Buffer.from(leaves[j].s2.sender_pubkey).toString("hex");
        if (otherHex !== senderHex && leaves[j].s2.sequence_number > effectiveSeen) {
          effectiveSeen = leaves[j].s2.sequence_number;
        }
      }
      if (s1Fields.last_seen_seq > effectiveSeen) {
        return { ok: false, reason: "unilateral_root_unverifiable" };
      }
      const partialInputs: LeafInput[] = leaves.slice(0, i + 1).map((l) => ({ kind: l.kind, data: encodeStructure2(l.s2) }));
      runningRoot = merkleRoot(buildMerkleTree(partialInputs));
    }

    // (e) Exactly ONE SEAL control leaf (kind "ctrl"), from the present (submitting) party.
    const ctrlLeaves = leaves.filter((l) => l.kind === "ctrl");
    if (ctrlLeaves.length !== 1) {
      return { ok: false, reason: "unilateral_seal_leaf_invalid" };
    }
    const sealLeafSender = Buffer.from(ctrlLeaves[0].s2.sender_pubkey).toString("hex");
    if (sealLeafSender !== presentHex) {
      return { ok: false, reason: "unilateral_seal_leaf_invalid" };
    }

    return { ok: true, recomputedRoot };
  }

  /**
   * SESSION-002: persist the signed unilateral SealNotarization (counterparty ABSENT) and
   * deliver the verifiable certificate to the present party (seal_unilateral_confirmed) and
   * the absent party (seal_unilateral_notification, on reconnect). Used by both the FROST
   * path (from #processSealFrostSignature) and the single-key fallback.
   */
  async #completeUnilateralNotarization(args: {
    sessionId: Uint8Array;
    sessionIdHex: string;
    sealedRoot: Uint8Array;
    presentPubkey: Uint8Array;
    absentPubkey: Uint8Array;
    presentHex: string;
    absentHex: string;
    closeTimestamp: number;
    leafCount: number;
    frostSignature: Uint8Array;
    signatureType: "frost" | "single";
    attestation: "ABSENT" | "DELIVERED";
    correlationId: string;
  }): Promise<void> {
    const {
      sessionId, sessionIdHex, sealedRoot, presentPubkey, absentPubkey, presentHex, absentHex,
      closeTimestamp, leafCount, frostSignature, signatureType, attestation, correlationId,
    } = args;

    // Persist the notarization (participant_a = present, participant_b = ABSENT). The
    // seal_notarizations UNIQUE(session_id, seal_type) constraint is the durable dedup (AC-008).
    // DOD-UP-1: this is the UNILATERAL row — a later bilateral upgrade supersedes it without
    // mutating it (append-only).
    const notarization: SealNotarization = {
      session_id: sessionId,
      sealed_root: sealedRoot,
      participant_a_pubkey: presentPubkey,
      participant_b_pubkey: absentPubkey,
      close_timestamp: closeTimestamp,
      frost_signature: frostSignature,
      seal_type: "unilateral",
    };
    await this.#store.recordNotarization(notarization, { correlationId }).catch(() => { /* logged inside */ });

    // SEAL-2: record the relationship-graph rows (best-effort). The present party is DELIVERED; the
    // absent party carries the liveness attestation (ABSENT when the relay observed it gone).
    this.#recordConversationSealBestEffort({
      sessionId, sealedRoot, closeType: "SEAL_UNILATERAL",
      participants: [
        { pubkey: presentPubkey, attestation: "DELIVERED" },
        { pubkey: absentPubkey, attestation: attestation === "ABSENT" ? "ABSENT" : "DELIVERED" },
      ],
      sealSignature: frostSignature, closeTimestamp, correlationId,
    });

    // PERSIST-017: stage sealed_root in the MMR (fire-and-forget; never blocks the seal).
    if (this.#mmrStore) {
      const sealedRootHex = Buffer.from(sealedRoot).toString("hex");
      this.#mmrStore.appendSeal(sessionIdHex, sealedRootHex, sessionIdHex).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.#logger?.warn("mmr.staging.failed", { sessionId: sessionIdHex, reason: msg });
      });
    }

    this.#logger?.info("session.unilateral.notarized", {
      sessionId: sessionIdHex,
      signatureType,
      presentPartyPubkey: truncHex(presentHex),
      absentPartyPubkey: truncHex(absentHex),
      attestation,
      leafCount,
      correlationId,
    });
    protocolLog("SEAL", `Unilateral sealed — session ${truncHex(sessionIdHex)}, root ${truncHex(Buffer.from(sealedRoot).toString("hex"))} (counterparty ${attestation})`);

    // The verifiable certificate carried on both frames.
    const cert = {
      sealed_root: sealedRoot,
      leaf_count: leafCount,
      close_timestamp: closeTimestamp,
      frost_signature: frostSignature,
      signature_type: signatureType,
      present_pubkey: presentPubkey,
      absent_pubkey: absentPubkey,
      attestation_mode: attestation,
      seal_type: "UNILATERAL" as const,
    };

    // Confirm to the present (submitting) party.
    const confirmFrame = encodeSealUnilateralConfirmed({
      type: "seal_unilateral_confirmed",
      session_id: sessionId,
      sealed_at: closeTimestamp,
      ...cert,
    });
    const presentStream = this.#streams.get(presentHex);
    if (presentStream) {
      try { this.#sendFrame(presentStream, confirmFrame); } catch { /* enqueued below if needed */ }
    }

    // Enqueue the notification (cert) for the absent party — delivered on reconnect.
    const notification: SealUnilateralNotification = {
      type: "seal_unilateral_notification",
      session_id: sessionId,
      sealed_at: closeTimestamp,
      ...cert,
    };
    let notifications = this.#pendingNotifications.get(absentHex);
    if (!notifications) {
      notifications = [];
      this.#pendingNotifications.set(absentHex, notifications);
    }
    notifications.push(notification);
    if (this.#notificationQueue) {
      const notificationId = randomUUID();
      this.#notificationQueue.enqueue(absentHex, {
        notificationId,
        notificationType: "seal_unilateral",
        payload: {
          session_id_hex: Buffer.from(sessionId).toString("hex"),
          sealed_root_hex: Buffer.from(sealedRoot).toString("hex"),
          sealed_at: closeTimestamp,
          leaf_count: leafCount,
          close_timestamp: closeTimestamp,
          frost_signature_hex: Buffer.from(frostSignature).toString("hex"),
          signature_type: signatureType,
          present_pubkey_hex: Buffer.from(presentPubkey).toString("hex"),
          absent_pubkey_hex: Buffer.from(absentPubkey).toString("hex"),
          attestation_mode: attestation,
        },
      }).catch((err: unknown) => {
        const reason = err instanceof Error ? err.message : String(err);
        this.#logger?.warn("pending_notification.enqueue.failed", {
          notificationId,
          recipientAgentId: absentHex,
          reason,
        });
      });
    }

    // Clean up the relay's per-session state — the seal is final.
    void this.#relay.confirmSeal(sessionId);

    // Evict per-session maps (bounded growth on long-running nodes). #unilateralSeals is
    // retained as the in-process duplicate guard (durable dedup is the DB constraint).
    this.#sessionParticipants.delete(sessionIdHex);
    this.#sessionLastActivity.delete(sessionIdHex);
  }

  /**
   * SEAL-2 (Sybil/relationship-farming defense): best-effort record of the relationship-graph rows
   * for a completed seal — conversation_seals + per-party conversation_participation +
   * conversation_attestations. Stores relationship METADATA + the sealed root HASH only, NEVER
   * content (INV-3). Fire-and-forget: analytics must NEVER block or fail a seal (like MMR staging).
   * conversation_id = the 16-byte session_id formatted as a UUID. The unilateral→bilateral UPGRADE
   * does NOT call this — the A↔B edge already exists from the unilateral seal (and conversation_id is
   * UNIQUE). `pseudonym` is the party's k_local pubkey hex (stable graph identity).
   *
   * CR-M1: the per-party `attestation` written here is the SEAL-TIME LIVENESS value — DELIVERED
   * (present / co-signed) or ABSENT (the relay observed the party gone). The CLEAN / FLAGGED values
   * that `pseudonym_stats` (analytics-job) counts are a DIFFERENT, RESERVED signal — the abuse /
   * reputation attestation set by the abuse-report path (DOD-LOG-3 family), which is NOT YET BUILT.
   * So `clean_count` / `flagged_count` are intentionally 0 until that lands; the Sybil graph (edges +
   * clustering) does NOT read attestation, so this is a no-op for the farming-detection signal.
   */
  #recordConversationSealBestEffort(args: {
    sessionId: Uint8Array;
    sealedRoot: Uint8Array;
    closeType: ConversationCloseType;
    participants: Array<{ pubkey: Uint8Array; attestation: ConversationAttestation }>;
    sealSignature: Uint8Array;
    closeTimestamp: number;
    correlationId: string;
  }): void {
    const sessionHex = Buffer.from(args.sessionId).toString("hex");
    // session_id (16 bytes / 32 hex) → UUID 8-4-4-4-12.
    const h = sessionHex.padStart(32, "0").slice(0, 32);
    const conversationId = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
    const sealSigHex = Buffer.from(args.sealSignature).toString("hex");
    const record: ConversationSealRecord = {
      conversationId,
      merkleRootHex: Buffer.from(args.sealedRoot).toString("hex"),
      closeType: args.closeType,
      closeTimestampMs: args.closeTimestamp,
      parties: args.participants.map((p) => ({
        pseudonym: Buffer.from(p.pubkey).toString("hex"),
        attestation: p.attestation,
        sealSignatureHex: sealSigHex,
      })),
    };
    void this.#store.recordConversationSeal(record, { correlationId: args.correlationId }).catch((err: unknown) => {
      this.#logger?.warn("conversation.seal.staging.failed", {
        sessionId: sessionHex, reason: err instanceof Error ? err.message : String(err), correlationId: args.correlationId,
      });
    });
  }

  /**
   * CELLO-M7-UPGRADE-001 (DOD-UP-1) — upgrade a unilateral seal to bilateral when the previously
   * ABSENT party returns and ratifies it.
   *
   * Model 2 (build journal 2026-06-23 decision): B does NOT re-seal over a new root. It signs an
   * attestation over the EXISTING sealed root R1 with its K_local; the directory verifies that
   * signature against the unilateral notarization's absent party (participant_b) and writes a NEW
   * bilateral notarization row that SUPERSEDES the unilateral one without mutating it (AC-006,
   * append-only). The dual-attestation cert sent to both parties carries A's original seal signature
   * + B's ratification, both over R1 — a client marks the seal bilateral only after verifying BOTH
   * (AC-008).
   *
   * KERNEL: the directory only proves B's signature is genuine over R1 (AC-007 sender check). The
   * content-possession precondition — B actually recovered + verified the content — is enforced on
   * B's daemon, which produces the ack ONLY after the content cross-check passes. Refusal on
   * unverifiable/tampered content happens there (AC-002/AC-003), never by the directory forging it.
   *
   * Refuses ONLY on unverifiability: no unilateral seal to upgrade, already bilateral, sender is not
   * the absent party, or the ack signature does not verify over R1. Never throws out of the handler.
   */
  async #processSealUpgradeRequest(
    stream: import("@libp2p/interface").Stream,
    senderHex: string,
    frame: import("./directory-types.js").SealUpgradeRequest,
  ): Promise<void> {
    const sessionIdHex = Buffer.from(frame.session_id).toString("hex");
    const correlationId = sessionIdHex;

    const reject = (reason: import("./directory-types.js").SealUpgradeRejectedReason): void => {
      this.#logger?.warn("session.upgrade.rejected", {
        sessionId: sessionIdHex, reason, returningPartyPubkey: truncHex(senderHex), correlationId,
      });
      try {
        this.#sendFrame(stream, encodeSealUpgradeRejected({ type: "seal_upgrade_rejected", session_id: frame.session_id, reason }));
      } catch { /* best-effort — the durable record is the DB, the client retries on reconnect */ }
    };

    // 1. Look up the authoritative notarization. getNotarization prefers the bilateral row, so a
    //    session that has already been upgraded reports seal_type 'bilateral' → idempotent reject.
    const existing = await this.#store.getNotarization(sessionIdHex);
    if (!existing) { reject("no_unilateral_seal"); return; }
    if (existing.seal_type === "bilateral") { reject("already_bilateral"); return; }

    // 2. AC-007: only the unilateral seal's ABSENT party (participant_b) may upgrade — and the
    //    AUTHENTICATED sender must BE that party (no delegation). The frame's claimed returning
    //    pubkey must also match, defence-in-depth against a malformed/spoofed body.
    const presentPubkey = existing.participant_a_pubkey;
    const absentPubkey = existing.participant_b_pubkey;
    const presentHex = Buffer.from(presentPubkey).toString("hex");
    const absentHex = Buffer.from(absentPubkey).toString("hex");
    if (senderHex !== absentHex) { reject("not_absent_party"); return; }
    if (Buffer.from(frame.returning_pubkey).toString("hex") !== absentHex) { reject("not_absent_party"); return; }

    // 3. Verify B's ack signature over the upgrade-ack TBS bound to the EXISTING root R1. This proves
    //    B holds R1 and ratifies it; a channel-swapped root fails the check (SI-003). The signature
    //    is B's OWN (K_local) — the directory never synthesizes B's assent (receipt-not-assent).
    const ackTbs = CBOR_ENC.encode([SEAL_UPGRADE_ACK_DOMAIN, frame.session_id, existing.sealed_root]);
    if (!verify(absentPubkey, ackTbs, frame.ack_signature)) { reject("ack_signature_invalid"); return; }

    // 4. Write the SUPERSEDING bilateral notarization (append-only; the unilateral row is untouched).
    //    frost_signature carries B's ratification; supersedes_notarization_id links to the unilateral
    //    row (which still holds A's original seal signature) — both attestations stay recoverable.
    const uniId = await this.#store.getNotarizationId(sessionIdHex, "unilateral");
    const bilateralNotarization: SealNotarization = {
      session_id: frame.session_id,
      sealed_root: existing.sealed_root,
      participant_a_pubkey: presentPubkey,
      participant_b_pubkey: absentPubkey,
      close_timestamp: existing.close_timestamp,
      frost_signature: frame.ack_signature,
      seal_type: "bilateral",
      supersedes_notarization_id: uniId ?? null,
    };
    await this.#store.recordNotarization(bilateralNotarization, { correlationId }).catch(() => { /* logged inside */ });

    this.#logger?.info("session.seal.upgraded", {
      sessionId: sessionIdHex,
      presentPartyPubkey: truncHex(presentHex),
      returningPartyPubkey: truncHex(absentHex),
      supersedesNotarizationId: uniId ?? null,
      correlationId,
    });
    protocolLog("SEAL", `Upgraded unilateral → bilateral — session ${truncHex(sessionIdHex)} (returning party ratified root ${truncHex(Buffer.from(existing.sealed_root).toString("hex"))})`);

    // 5. Deliver the dual-attestation cert to BOTH parties. present_signature is A's original seal
    //    signature (the unilateral row's frost_signature); its type follows whether A's primary_pubkey
    //    is known (FROST) or the directory node key was used (single-key fallback).
    const presentSignatureType: "frost" | "single" = this.#primaryPubkeys.has(presentHex) ? "frost" : "single";
    const confirmedFrame = encodeSealUpgradeConfirmed({
      type: "seal_upgrade_confirmed",
      session_id: frame.session_id,
      sealed_root: existing.sealed_root,
      // leaf_count is forwarded from B's request so the present party can rebuild the seal TBS and
      // verify its own attestation (AC-008). It is bound to truth at verify time: a wrong leaf_count
      // makes the present attestation fail verification at the holder of A's key.
      leaf_count: frame.leaf_count,
      close_timestamp: existing.close_timestamp,
      present_pubkey: presentPubkey,
      present_signature: existing.frost_signature,
      present_signature_type: presentSignatureType,
      returning_pubkey: absentPubkey,
      returning_signature: frame.ack_signature,
      seal_type: "BILATERAL",
    });
    // To B (the returning party) on this stream.
    try { this.#sendFrame(stream, confirmedFrame); } catch { /* best-effort */ }
    // To A (the present party) on its live stream if present...
    const presentStream = this.#streams.get(presentHex);
    if (presentStream) { try { this.#sendFrame(presentStream, confirmedFrame); } catch { /* best-effort */ } }
    // ...and DURABLY, so A converges to bilateral even if it was offline during the upgrade (L2). The
    // authoritative record is the superseding row; this queued cert lets A re-mark the seal bilateral
    // on its next reconnect (mirrors the absent-party seal_unilateral durable notification).
    if (this.#notificationQueue) {
      const upgradeNotificationId = randomUUID();
      this.#notificationQueue.enqueue(presentHex, {
        notificationId: upgradeNotificationId,
        notificationType: "seal_upgrade",
        payload: {
          session_id_hex: sessionIdHex,
          sealed_root_hex: Buffer.from(existing.sealed_root).toString("hex"),
          leaf_count: frame.leaf_count,
          close_timestamp: existing.close_timestamp,
          present_pubkey_hex: presentHex,
          present_signature_hex: Buffer.from(existing.frost_signature).toString("hex"),
          present_signature_type: presentSignatureType,
          returning_pubkey_hex: absentHex,
          returning_signature_hex: Buffer.from(frame.ack_signature).toString("hex"),
        },
      }).catch((err: unknown) => {
        this.#logger?.warn("pending_notification.enqueue.failed", {
          notificationId: upgradeNotificationId,
          recipientAgentId: presentHex,
          reason: err instanceof Error ? err.message : String(err),
        });
      });
    }
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

    // M7-SESSION-004: derive the receipt-not-assent legibility certificate from the
    // verified leaves (signed last_seen_seq, sender pubkeys, sequence numbers). Computed
    // transiently — nothing new is persisted on the directory (no Flyway migration). For
    // the FROST path this is carried in #pendingFrostSeals and attached when the ceremony
    // completes; for the single-key path it is attached to the sealed event below.
    const legibility = buildSealLegibility(leaves);
    this.#logger?.info("seal.certificate.legibility.built", {
      sessionId: sessionIdHex,
      participantCount: legibility.participants.length,
      finalMessageAnswered: legibility.final_message.answered,
      correlationId: sessionIdHex,
    });

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
    // DOD-LEG-2 NEGATIVE-TEST SEAM (env-gated, off by default): inflate every party's published
    // content_frontier_seq BEFORE the TBS binding, so the inflated value is FROST-signed (the
    // client's signature check passes) and only the client's independent re-derive can catch it.
    // This simulates a buggy/malicious directory; production never sets this env.
    const inflateBy = Number.parseInt(process.env["CELLO_DIRECTORY_INFLATE_FRONTIER_FOR_TEST"] ?? "", 10);
    // Doubly gated: never active in production, even if the env var is somehow set.
    if (process.env["CELLO_ENV"] !== "production" && !Number.isNaN(inflateBy) && inflateBy > 0) {
      for (const p of legibility.participants) p.content_frontier_seq += inflateBy;
      this.#logger?.warn("seal.certificate.frontier.inflated_for_test", { sessionId: sessionIdHex, inflateBy });
    }
    // M7 legibility-TBS-binding: fold the legibility hash into the FROST-signed TBS so a MITM
    // cannot tamper answered / content_frontier_seq / attestation_mode in transit without breaking
    // the signature. The daemon co-signs the SAME bound TBS (it receives `legibility` on seal_verified);
    // the receiving client re-binds and verifies. This `tbs` is stored in #pendingFrostSeals and is what
    // #processSealFrostSignature verifies the combined signature against (so directory + daemon agree).
    const tbs = bindLegibilityToTbs(buildSealTbs(sessionId, recomputedRoot, leafCount, close_timestamp), legibility);

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
        seal_type: "bilateral", // DOD-UP-1: both parties co-closed (single-key fallback path)
      };
      void this.#store.recordNotarization(notarization, { correlationId: sessionIdHex }).catch(() => { /* logged inside */ });
      // SEAL-2: relationship-graph rows (best-effort) — bilateral, both parties DELIVERED.
      this.#recordConversationSealBestEffort({
        sessionId, sealedRoot: recomputedRoot, closeType: "MUTUAL_SEAL",
        participants: [
          { pubkey: new Uint8Array(pA), attestation: "DELIVERED" },
          { pubkey: new Uint8Array(pB), attestation: "DELIVERED" },
        ],
        sealSignature: notarizationSig, closeTimestamp: close_timestamp, correlationId: sessionIdHex,
      });
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
      const sealedEvent: SessionSealedWithLegibility = {
        type: "session_sealed",
        signature_type: "single",
        session_id: sessionId,
        sealed_root: recomputedRoot,
        directory_signature: notarizationSig,
        close_timestamp,
        legibility,
      };
      this.#deliverOrEnqueue(participants[0] ?? "", sealedEvent, sessionIdHex);
      if (participants.length >= 2) this.#deliverOrEnqueue(participants[1], sealedEvent, sessionIdHex);
      return { ok: true };
    }

    // SESSION-005: Push seal_verified to initiator; wait for seal_frost_signature.
    // M7 legibility-TBS-binding: carry the legibility so the initiator's daemon binds the SAME
    // legibility hash into the TBS it co-signs (directory + daemon must agree on the bound TBS).
    // DOD-LEG-2: the signed leaves the legibility was derived from. Shipped on BOTH seal_verified
    // (so the initiator re-derives + refuses to co-sign an inflated frontier) and session_sealed
    // (so the receiver re-derives + refuses to accept one).
    const frontierLeaves = leaves.map((l) => ({
      structure1_cbor: l.structure1_cbor,
      sender_pubkey: l.s2.sender_pubkey,
      sender_signature: l.s2.sender_signature,
    }));

    const sealVerifiedEvent: SealVerifiedWithLegibility = {
      type: "seal_verified",
      session_id: sessionId,
      sealed_root: recomputedRoot,
      leaf_count: leafCount,
      timestamp: close_timestamp,
      legibility,
      frontier_leaves: frontierLeaves,
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
      legibility,
      frontierLeaves,
    });

    // OBS-001 AC-009: FROST seal ceremony log
    protocolLog("SEAL", `FROST seal ceremony — session ${truncHex(sessionIdHex)}`);

    // Deliver seal_verified to initiator or enqueue for deferred delivery.
    const initiatorStream = this.#streams.get(initiatorHex);
    if (initiatorStream) {
      try {
        this.#sendFrame(initiatorStream, encodeSealVerified(sealVerifiedEvent));
      } catch (error) {
        // M7-SESSION-004 AC-009 lateral catch audit: log the send failure rather than
        // swallowing it before falling back to the deferred-delivery queue.
        this.#logger?.warn("seal.certificate.delivery.stream_dead", {
          sessionId: sessionIdHex,
          pubkeyHex: initiatorHex,
          eventType: sealVerifiedEvent.type,
          reason: error instanceof Error ? error.message : String(error),
        });
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

    // SESSION-002: a UNILATERAL seal completes via the certificate path — persist the
    // notarization (counterparty ABSENT) and deliver seal_unilateral_confirmed / notification,
    // NOT session_sealed. participantA is the present party, participantB the absent one.
    if (pending.unilateral) {
      await this.#completeUnilateralNotarization({
        sessionId: frame.session_id,
        sessionIdHex,
        sealedRoot: pending.sealedRoot,
        presentPubkey: new Uint8Array(Buffer.from(pending.participantAHex, "hex")),
        absentPubkey: new Uint8Array(Buffer.from(pending.participantBHex, "hex")),
        presentHex: pending.participantAHex,
        absentHex: pending.participantBHex,
        closeTimestamp: pending.timestamp,
        leafCount: pending.leafCount,
        frostSignature: new Uint8Array(frame.frost_signature),
        signatureType: "frost",
        attestation: pending.attestation ?? "ABSENT",
        correlationId: pending.correlationId,
      });
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
      seal_type: "bilateral", // DOD-UP-1: both parties co-signed (FROST notarization path)
    };
    void this.#store.recordNotarization(notarization, { correlationId: pending.correlationId }).catch(() => { /* logged inside */ });
    // SEAL-2: relationship-graph rows (best-effort) — bilateral FROST, both parties DELIVERED.
    this.#recordConversationSealBestEffort({
      sessionId: frame.session_id, sealedRoot: pending.sealedRoot, closeType: "MUTUAL_SEAL",
      participants: [
        { pubkey: new Uint8Array(pA), attestation: "DELIVERED" },
        { pubkey: new Uint8Array(pB), attestation: "DELIVERED" },
      ],
      sealSignature: new Uint8Array(frame.frost_signature), closeTimestamp: pending.timestamp,
      correlationId: pending.correlationId,
    });

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
    // M7-SESSION-004: carry the legibility certificate derived at processSeal time.
    const sealedEvent: SessionSealedWithLegibility = {
      type: "session_sealed",
      signature_type: "frost",
      session_id: frame.session_id,
      sealed_root: pending.sealedRoot,
      frost_signature: frame.frost_signature,
      signer_pubkey: primaryPubkey,
      close_timestamp: pending.timestamp,
      leaf_count: pending.leafCount,
      legibility: pending.legibility,
      frontier_leaves: pending.frontierLeaves,
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
      } catch (error) {
        // M7-SESSION-004 AC-009 lateral catch audit: log the send failure rather than
        // swallowing it before falling back to the deferred-delivery queue.
        this.#logger?.warn("seal.certificate.delivery.stream_dead", {
          sessionId: sessionIdHex,
          pubkeyHex,
          eventType: rejectedEvent.type,
          reason: error instanceof Error ? error.message : String(error),
        });
        this.#store.enqueueNotification(pubkeyHex, rejectedEvent, sessionIdHex);
      }
    }
  }

  #deliverOrEnqueue(pubkeyHex: string, event: SessionSealedWithLegibility | SessionSealRejected, correlationId: string): void {
    // M7-SESSION-004 AC-009: encode-failure and send-failure are distinct causes and must
    // never be conflated under one silent catch. An encode failure (e.g. a malformed
    // `legibility` field) will re-fail on every retry — it is a derivation bug, logged loudly,
    // and is NOT a reason to drop the live stream. Only a send failure means the stream is dead
    // and warrants the enqueue fallback.
    let encoded: Uint8Array;
    try {
      if (event.type === "session_sealed") {
        encoded = encodeSessionSealed(event);
      } else {
        encoded = encodeSessionSealRejected(event as SessionSealRejected);
      }
    } catch (error) {
      this.#logger?.error("seal.certificate.delivery.encode_failed", {
        sessionId: correlationId,
        pubkeyHex,
        eventType: event.type,
        reason: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    const stream = this.#streams.get(pubkeyHex);
    if (stream) {
      try {
        this.#sendFrame(stream, encoded);
        return;
      } catch (error) {
        this.#logger?.warn("seal.certificate.delivery.stream_dead", {
          sessionId: correlationId,
          pubkeyHex,
          eventType: event.type,
          reason: error instanceof Error ? error.message : String(error),
        });
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
    // M7-SESSION-004 AC-009: same encode-vs-send distinction as #deliverOrEnqueue. An encode
    // failure is a derivation bug that re-fails on every retry and is logged loudly; a send
    // failure means the stream is dead.
    const sessionIdHex = Buffer.from(event.session_id).toString("hex");
    let encoded: Uint8Array;
    try {
      encoded = encodeSessionFrostSealed(event);
    } catch (error) {
      this.#logger?.error("seal.certificate.delivery.encode_failed", {
        sessionId: sessionIdHex,
        pubkeyHex,
        eventType: event.type,
        reason: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    const stream = this.#streams.get(pubkeyHex);
    if (stream) {
      try {
        this.#sendFrame(stream, encoded);
        return;
      } catch (error) {
        this.#logger?.warn("seal.certificate.delivery.stream_dead", {
          sessionId: sessionIdHex,
          pubkeyHex,
          eventType: event.type,
          reason: error instanceof Error ? error.message : String(error),
        });
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
    void this.#processSealUnilateral(mockStream, senderHex, {
      type: "seal_unilateral",
      session_id: sessionId,
      reported_root: reportedRoot,
      reported_seq: 0,
    });
  }

  /**
   * Test hook (DOD-UP-1): invoke #processSealUpgradeRequest directly. The caller must have already
   * recorded the unilateral notarization in the store (the upgrade reads it via getNotarization).
   * Returns the awaited handler promise so the test can assert on the store + mockStream afterwards.
   * Only available in NODE_ENV=test.
   */
  async triggerSealUpgradeForTest(
    senderHex: string,
    frame: import("./directory-types.js").SealUpgradeRequest,
    mockStream: Stream,
  ): Promise<void> {
    if (process.env["NODE_ENV"] !== "test") throw new Error("test-only");
    await this.#processSealUpgradeRequest(mockStream, senderHex, frame);
  }

  /** Test hook (DOD-UP-1): the exact upgrade-ack TBS B must sign — exposed so a test signs the same
   *  bytes the handler verifies. Only available in NODE_ENV=test. */
  buildSealUpgradeAckTbsForTest(sessionId: Uint8Array, sealedRoot: Uint8Array): Uint8Array {
    if (process.env["NODE_ENV"] !== "test") throw new Error("test-only");
    return CBOR_ENC.encode([SEAL_UPGRADE_ACK_DOMAIN, sessionId, sealedRoot]);
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
    void this.#processSealUnilateral(mockStream, senderHex, {
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
        const certNotif = unilateralNotificationFromPayload(pgNotif.payload as Record<string, unknown>);
        if (!certNotif) {
          void this.#notificationQueue.acknowledge(pgNotif.notificationId).catch(() => {});
          continue;
        }
        try {
          this.#sendFrame(mockStream, encodeSealUnilateralNotification(certNotif));
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

/**
 * SESSION-002: reconstruct a full unilateral-seal certificate frame from a persisted
 * NotificationQueue payload (the absent-party notification that survived a directory
 * restart). Returns null if the payload predates the certificate fields — such a row
 * cannot be delivered as a verifiable cert and is acknowledged without delivery.
 */
function unilateralNotificationFromPayload(
  p: Record<string, unknown>,
): SealUnilateralNotification | null {
  const sessionIdHex = p["session_id_hex"];
  const sealedRootHex = p["sealed_root_hex"];
  const frostSigHex = p["frost_signature_hex"];
  const sigType = p["signature_type"];
  const presentHex = p["present_pubkey_hex"];
  const absentHex = p["absent_pubkey_hex"];
  const leafCount = p["leaf_count"];
  const closeTs = p["close_timestamp"];
  const attestationMode = p["attestation_mode"];
  if (typeof sessionIdHex !== "string" || typeof sealedRootHex !== "string") return null;
  if (typeof frostSigHex !== "string" || (sigType !== "frost" && sigType !== "single")) return null;
  if (typeof presentHex !== "string" || typeof absentHex !== "string") return null;
  if (typeof leafCount !== "number" || typeof closeTs !== "number") return null;
  if (attestationMode !== "ABSENT" && attestationMode !== "DELIVERED") return null;
  return {
    type: "seal_unilateral_notification",
    session_id: new Uint8Array(Buffer.from(sessionIdHex, "hex")),
    sealed_at: typeof p["sealed_at"] === "number" ? (p["sealed_at"] as number) : closeTs,
    sealed_root: new Uint8Array(Buffer.from(sealedRootHex, "hex")),
    leaf_count: leafCount,
    close_timestamp: closeTs,
    frost_signature: new Uint8Array(Buffer.from(frostSigHex, "hex")),
    signature_type: sigType,
    present_pubkey: new Uint8Array(Buffer.from(presentHex, "hex")),
    absent_pubkey: new Uint8Array(Buffer.from(absentHex, "hex")),
    attestation_mode: attestationMode,
    seal_type: "UNILATERAL",
  };
}

/** DOD-UP-1 (L2): reconstruct a queued seal_upgrade_confirmed cert for durable A-side convergence. */
function upgradeConfirmedFromPayload(
  p: Record<string, unknown>,
): import("./directory-types.js").SealUpgradeConfirmed | null {
  const sessionIdHex = p["session_id_hex"];
  const sealedRootHex = p["sealed_root_hex"];
  const leafCount = p["leaf_count"];
  const closeTs = p["close_timestamp"];
  const presentHex = p["present_pubkey_hex"];
  const presentSigHex = p["present_signature_hex"];
  const presentSigType = p["present_signature_type"];
  const returningHex = p["returning_pubkey_hex"];
  const returningSigHex = p["returning_signature_hex"];
  if (typeof sessionIdHex !== "string" || typeof sealedRootHex !== "string") return null;
  if (typeof leafCount !== "number" || typeof closeTs !== "number") return null;
  if (typeof presentHex !== "string" || typeof presentSigHex !== "string") return null;
  if (presentSigType !== "frost" && presentSigType !== "single") return null;
  if (typeof returningHex !== "string" || typeof returningSigHex !== "string") return null;
  return {
    type: "seal_upgrade_confirmed",
    session_id: new Uint8Array(Buffer.from(sessionIdHex, "hex")),
    sealed_root: new Uint8Array(Buffer.from(sealedRootHex, "hex")),
    leaf_count: leafCount,
    close_timestamp: closeTs,
    present_pubkey: new Uint8Array(Buffer.from(presentHex, "hex")),
    present_signature: new Uint8Array(Buffer.from(presentSigHex, "hex")),
    present_signature_type: presentSigType,
    returning_pubkey: new Uint8Array(Buffer.from(returningHex, "hex")),
    returning_signature: new Uint8Array(Buffer.from(returningSigHex, "hex")),
    seal_type: "BILATERAL",
  };
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
  /**
   * M7-MANIFEST-002: per-node Ed25519 signing key provider.
   * When provided, the directory signs a step-5 TBS after successful client
   * authentication and includes nodeId + signature + timestamp in signaling_auth_ok.
   * When absent, signaling_auth_ok is sent without MANIFEST-002 fields (backward compat).
   */
  directoryKeyProvider?: import("@cello-protocol/interfaces").DirectoryKeyProvider;
  /**
   * M7-MANIFEST-002: consortium manifest store for manifest_poll_request handling.
   * When provided, the directory responds to manifest_poll_request frames with
   * the current manifest (manifest_poll_response).
   * When absent, manifest_poll_request frames are ignored.
   */
  directoryManifestStore?: import("@cello-protocol/interfaces").DirectoryManifestStore;
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
    directoryKeyProvider: opts.directoryKeyProvider,
    directoryManifestStore: opts.directoryManifestStore,
  });
  await directory.start();

  return {
    directory,
    node,
    stop: async () => { directory.stopPresenceHeartbeat(); await node.stop(); },
  };
}
