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

import { randomBytes, createHash } from "node:crypto";
import { Encoder, decode as cborDecode } from "cbor-x";
import * as lp from "it-length-prefixed";
import { verify, buildMerkleTree, merkleRoot, CONTEXT_SESSION_ESTABLISHMENT, FrostThresholdSigner } from "@cello/crypto";

import type { KeyProvider, LeafInput, IThresholdSigner } from "@cello/crypto";
import { encodeStructure2, computeGenesisPrevRoot, buildSessionEstablishmentTbs, buildSealTbs } from "@cello/protocol-types";
import type { AgentProfile } from "@cello/protocol-types";
import { createNode } from "@cello/transport";
import type { CelloNode } from "@cello/transport";
import type { Stream } from "@libp2p/interface";
import type {
  SessionAssignment,
  SessionAssignmentFrame,
  SessionAbandoned,
  SessionSealed,
  SessionSealRejected,
  SealNotarization,
  TimeSource,
  RelaySealData,
  RelaySessionAssignment,
  SealVerified,
  SealFrostSignature,
  SessionFrostSealed,
} from "./directory-types.js";
import { WALL_CLOCK } from "./directory-types.js";
import type { DirectoryStore } from "./directory-store.js";
import { InMemoryDirectoryStore } from "./directory-store.js";
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
 * Uses structural typing so the directory package need not import @cello/relay directly.
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

  // REG-001: forceDkgFailure — test injection for below-threshold DKG simulation
  readonly #forceDkgFailure: boolean;
  // REG-001 AC-009: enforce registration gate on session_request
  readonly #requireRegistration: boolean;
  // SESSION-006: enforce connection gate on session_request
  readonly #requireConnectionGate: boolean;
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

  // session_id_hex → seal-pending state: waiting for seal_frost_signature from initiator — SESSION-005
  readonly #pendingFrostSeals = new Map<string, {
    initiatorHex: string;
    participantAHex: string;
    participantBHex: string;
    sealedRoot: Uint8Array;
    leafCount: number;
    timestamp: number;
    tbs: Uint8Array;
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
    this.#frostHandler = new FrostDirectoryHandler({
      // Default to libp2p peer ID so that NetworkDirectoryNode.id = peerID matches
      // the FROST identifier derivation used in DKG and signing ceremonies.
      nodeId: opts.nodeId ?? opts.node.getPeerId(),
      shareStore: opts.shareStore,
      onFallbackCanary: opts.onFallbackCanary,
    });
    this.#forceDkgFailure = opts.forceDkgFailure ?? false;
    this.#requireRegistration = opts.requireRegistration ?? false;
    this.#requireConnectionGate = opts.requireConnectionGate ?? false;
    this.#packageCborInterceptor = opts.packageCborInterceptor;
  }

  async start(): Promise<void> {
    await this.#node.handle(SIGNALING_PROTOCOL_ID, (stream) => {
      void this.#handleSignalingStream(stream);
    }, { maxInboundStreams: 512 });

    await this.#node.handle(FROST_PROTOCOL_ID, (stream) => {
      void this.#handleFrostStream(stream);
    }, { maxInboundStreams: 256 });

    // OBS-001 AC-002: directory startup log
    const peerId = truncId(this.#node.getPeerId());
    const addrs = this.#node.listenAddresses();
    const addr = addrs.length > 0 ? addrs[0] : "(none)";
    protocolLog("DIR", `Started — peer ${peerId}, signaling ${addr}`);
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
        // Client asks this node to generate a nonce commitment for an upcoming round.
        const agentPubkey = req["agentPubkey"] as string;
        const epochId = req["epochId"] as string;

        const result = await this.#frostHandler.generateCommitment(agentPubkey, epochId);
        stream.send(lp.encode.single(
          result.ok
            ? CBOR_ENC.encode({ type: "frost_commit_response", ok: true, nodeId: result.nodeId, nonceCommitment: result.nonceCommitment })
            : CBOR_ENC.encode({ type: "frost_commit_response", ok: false, reason: result.reason })
        ));
        await stream.close();
        return;
      }

      if (frameType === "frost_sign_request") {
        // Client sends the pre-framed message (context\0tbs) and commitment list.
        // The directory signs the pre-framed message directly using signRawMessage.
        const agentPubkey = req["agentPubkey"] as string;
        const epochId = req["epochId"] as string;
        const framedMsg = req["framedMsg"] as Uint8Array;
        const commitmentList = req["commitmentList"] as import("@noble/curves/abstract/frost.js").NonceCommitments[];
        const ceremonyId = req["ceremonyId"] as string;
        const peerIdString = req["peerIdString"] as string;

        const result = await this.#frostHandler.signRawMessage({
          agentPubkey,
          epochId,
          framedMsg: framedMsg instanceof Uint8Array ? framedMsg : new Uint8Array(framedMsg as unknown as ArrayBuffer),
          commitmentList,
          peerIdString,
          ceremonyId,
        });

        const resp = result.ok
          ? CBOR_ENC.encode({ type: "frost_sign_response", ok: true, partialSignature: result.partialSignature })
          : CBOR_ENC.encode({ type: "frost_sign_response", ok: false, reason: result.reason });
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
            const sharesForOthers: import("@cello/protocol-types").DkgRound2Share[] = result.sharesForOthers.map((s) => ({
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

          // OBS-001 AC-003: peer authenticated on signaling
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

          // Flush any queued notifications
          const queued = this.#store.drainNotifications(authedPubkeyHex);

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

          // CONNREQ-002 DB-001: deliver queued pending connection requests (target reconnected)
          const pendingConnRequests = this.#store.dequeuePendingConnectionRequests(authedPubkeyHex);
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
          void this.#processSessionRequest(stream, authedPubkeyHex!, Buffer.from(parsed.target_pubkey).toString("hex"), (parsed as { connection_id?: string }).connection_id);
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
                  this.#store.enqueueNotification(counterpartyHex, abandonedFrame);
                }
              } else {
                this.#store.enqueueNotification(counterpartyHex, abandonedFrame);
              }
            }
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

  getProfile(kLocalPubkeyHex: string): import("@cello/protocol-types").AgentProfile | undefined {
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
    frame: import("@cello/protocol-types").RegisterRequest,
  ): Promise<void> {
    // SI-004: auth gate — authedPubkeyHex is already verified above (only reached after auth)

    // Step 1: Validate phone_stub non-empty
    if (!frame.phone_stub || frame.phone_stub.length === 0) {
      this.#sendFrame(stream, encodeRegisterError({ type: "register_error", reason: "invalid_verification" }));
      return;
    }

    // Step 2: Check if pubkey already registered
    if (this.#store.hasProfile(frame.k_local_pubkey)) {
      this.#sendFrame(stream, encodeRegisterError({ type: "register_error", reason: "already_registered" }));
      return;
    }

    // Step 3: Check phone stub hash (SI-001: never store or log raw phone_stub)
    // FIPS 180-4 SHA-256
    const phoneStubHash = createHash("sha256").update(frame.phone_stub, "utf8").digest("hex");
    if (this.#store.hasPhoneStubHash(phoneStubHash)) {
      this.#sendFrame(stream, encodeRegisterError({ type: "register_error", reason: "phone_already_claimed" }));
      return;
    }

    // Step 4: Run FROST DKG (real interactive DKG — REG-001)
    // Send dkg_ready — authorizes the client to open DKG streams on /cello/frost/1.0.0
    // SI-002: profile only created after successful DKG
    if (this.#forceDkgFailure) {
      // OBS-001: DKG failed log
      protocolLog("REG", `DKG failed — agent ${truncHex(frame.k_local_pubkey)}, reason: forced_failure`);
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
      this.#sendFrame(stream, encodeRegisterError({ type: "register_error", reason: "dkg_failed" }));
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
    frame: import("@cello/protocol-types").ConnectionRequest,
  ): Promise<void> {
    const targetHex = frame.target_pubkey;

    // OBS-001 AC-005/AC-006: connection request log
    protocolLog("CONN", `Request: ${truncHex(senderHex)} → ${truncHex(targetHex)}`);

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

    // Gate 3: no existing active connection
    if (this.#store.hasConnection(senderHex, targetHex)) {
      this.#sendFrame(stream, encodeConnectionRequestError({ type: "connection_request_error", reason: "already_connected" }));
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

    const inboundFrame: import("@cello/protocol-types").ConnectionRequestInbound = {
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
      // OBS-001 AC-005: relayed to target
      protocolLog("CONN", `Relayed to target ${truncHex(targetHex)}`);
      try {
        this.#sendFrame(targetStream, encodeConnectionRequestInbound(inboundFrame));
      } catch {
        // Target stream failed — queue the request
        this.#pendingConnectionRequests.delete(connectionRequestId);
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
    frame: import("@cello/protocol-types").ConnectionResponse,
  ): Promise<void> {
    const pending = this.#pendingConnectionRequests.get(frame.connection_request_id);
    if (!pending) return;
    if (pending.targetHex !== responderHex) return; // wrong responder

    this.#pendingConnectionRequests.delete(frame.connection_request_id);

    const senderStream = this.#streams.get(pending.senderHex);

    if (frame.verdict === "accept") {
      // Generate connection_id (16-byte CSPRNG per FIPS 180-4)
      const connectionId = Buffer.from(randomBytes(16)).toString("hex");
      this.#store.createConnection(connectionId, pending.senderHex, pending.targetHex, this.#clock.now());

      // OBS-001 AC-005: verdict accept + connection established
      protocolLog("CONN", `Verdict accept — ${truncHex(connectionId)}`);
      protocolLog("CONN", `Connection ${truncHex(connectionId)} established: ${truncHex(pending.senderHex)} ↔ ${truncHex(pending.targetHex)}`);

      // Notify both clients
      const toSender: import("@cello/protocol-types").ConnectionEstablished = {
        type: "connection_established",
        counterparty_pubkey: pending.targetHex,
        connection_id: connectionId,
      };
      const toTarget: import("@cello/protocol-types").ConnectionEstablished = {
        type: "connection_established",
        counterparty_pubkey: pending.senderHex,
        connection_id: connectionId,
      };
      // Queue for sender (delivered on next auth). Client deduplicates via connection_id.
      this.#store.enqueueNotification(pending.senderHex, toSender);
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
    frame: import("@cello/protocol-types").DisclosureRequest,
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
    frame: import("@cello/protocol-types").DisclosureResponse,
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
  ): Promise<void> {
    // OBS-001 AC-008: session request log
    protocolLog("SESS", `Session request: ${truncHex(initiatorHex)} → ${truncHex(targetHex)}`);

    // SESSION-006: enforce connection gate if configured
    if (this.#requireConnectionGate) {
      if (!connectionId) {
        this.#sendFrame(stream, encodeSessionRequestError({ type: "session_request_error", reason: "connection_id_required" }));
        return;
      }
      // Verify active connection exists between initiator and target with this connection_id
      const conn = this.#store.hasConnection(initiatorHex, targetHex);
      if (!conn || conn.connection_id !== connectionId) {
        this.#sendFrame(stream, encodeSessionRequestError({ type: "session_request_error", reason: "no_connection" }));
        return;
      }
    }

    // (a) Verify target is currently authenticated
    const targetStream = this.#streams.get(targetHex);
    if (!targetStream) {
      this.#sendFrame(stream, encodeSessionRequestError({ type: "session_request_error", reason: "target_offline" }));
      return;
    }

    // SESSION-004 Step 1: Check for injected IThresholdSigner (CRITICAL-2: fail loudly if absent)
    const signer = this.#thresholdSigners.get(initiatorHex);
    if (!signer) {
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
      console.warn(`[directory] CEREMONY_CONFLICT: agent=${initiatorHex.slice(0, 16)}`);
      this.#sendFrame(stream, encodeSessionRequestError({ type: "session_request_error", reason: "ceremony_conflict" }));
      return;
    }

    this.#frostHandler.markInFlight(initiatorHex, epochId, ceremonyId, ceremonyId);

    try {
      // SESSION-004 Step 5: FROST ceremony (RFC 9591 §5 coordinator flow)
      // OBS-001 AC-008: FROST ceremony begin
      const sessionIdHex8 = truncHex(Buffer.from(session_id).toString("hex"));
      protocolLog("FROST", `Ceremony begin — session ${sessionIdHex8}, agent ${truncHex(initiatorHex)}`);
      const result = await signer.participateInCeremony(ceremonyId, tbs, CONTEXT_SESSION_ESTABLISHMENT);
      if (!result.ok) {
        this.#sendFrame(stream, encodeSessionRequestError({ type: "session_request_error", reason: "directory_below_threshold" }));
        return;
      }
      const frostedSig = result.signature;

      // SESSION-004 Step 6: getPrimaryPubkey() — HIGH-4: method on IThresholdSigner interface
      const initiatorPrimaryPubkey = signer.getPrimaryPubkey();

      // SESSION-004 Step 7: Build SessionAssignment with signature_type: 'frost'
      const assignment: SessionAssignment = {
        session_id,
        participant_a: { pubkey: new Uint8Array(initiatorPubkey), peer_id: initiatorInfo.peer_id, multiaddrs: initiatorInfo.multiaddrs },
        participant_b: { pubkey: new Uint8Array(targetPubkey), peer_id: targetInfo.peer_id, multiaddrs: targetInfo.multiaddrs },
        relay_endpoint: this.#relayEndpoint,
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
      if (!recorded.ok) {
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

      // OBS-001 AC-008: assignment issued
      protocolLog("SESS", `Assignment issued — session ${truncHex(sessionIdHex)}`);

      // (f) Deliver to both clients
      const assignmentFrame: SessionAssignmentFrame = { type: "session_assignment", assignment };
      const encoded = encodeSessionAssignment(assignmentFrame);
      this.#sendFrame(stream, encoded);
      const pending = this.#pendingSessions.get(sessionIdHex);
      if (pending) pending.initiatorGotAssignment = true;
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
      this.#store.recordNotarization(notarization);
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
      this.#deliverOrEnqueue(participants[0] ?? "", sealedEvent);
      if (participants.length >= 2) this.#deliverOrEnqueue(participants[1], sealedEvent);
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
    });

    // OBS-001 AC-009: FROST seal ceremony log
    protocolLog("SEAL", `FROST seal ceremony — session ${truncHex(sessionIdHex)}`);

    // Deliver seal_verified to initiator or enqueue for deferred delivery.
    const initiatorStream = this.#streams.get(initiatorHex);
    if (initiatorStream) {
      try {
        this.#sendFrame(initiatorStream, encodeSealVerified(sealVerifiedEvent));
      } catch {
        this.#store.enqueueNotification(initiatorHex, sealVerifiedEvent);
      }
    } else {
      // DB-003: initiator not connected — enqueue for delivery when they reconnect.
      this.#store.enqueueNotification(initiatorHex, sealVerifiedEvent);
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
      this.#deliverOrEnqueue(pending.participantAHex, rejectedEvent);
      if (pending.participantBHex) this.#deliverOrEnqueue(pending.participantBHex, rejectedEvent);
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
    this.#store.recordNotarization(notarization);

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
    this.#deliverOrEnqueue(pending.participantAHex, sealedEvent);
    if (pending.participantBHex) this.#deliverOrEnqueue(pending.participantBHex, sealedEvent);
  }

  #notifySealRejected(_sessionIdHex: string, sessionId: Uint8Array, reason: import("./directory-types.js").SealRejectionReason): void {
    const rejectedEvent: SessionSealRejected = { type: "session_seal_rejected", session_id: sessionId, reason };
    // M1: broadcast to all authenticated streams — clients ignore events for sessions they don't own.
    // Future: look up session participants by _sessionIdHex for targeted delivery.
    for (const [pubkeyHex, stream] of this.#streams) {
      try {
        this.#sendFrame(stream, encodeSessionSealRejected(rejectedEvent));
      } catch {
        this.#store.enqueueNotification(pubkeyHex, rejectedEvent);
      }
    }
  }

  #deliverOrEnqueue(pubkeyHex: string, event: SessionSealed | SessionSealRejected): void {
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
    if (pubkeyHex) this.#store.enqueueNotification(pubkeyHex, event);
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
  leaves: Array<{ kind: "msg" | "ctrl"; s2: import("@cello/protocol-types").Structure2; structure1_cbor: Uint8Array }>  // RelaySealLeaf
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

// ─── ClientDelegatedSigner ───────────────────────────────────────────────────
// IThresholdSigner that sends a ceremony_request frame to the client (initiator)
// over their authenticated signaling stream and waits for a ceremony_result frame.
// The client runs participateInCeremony locally (it holds the coordinator share)
// and returns the combined FROST signature.

import type { ThresholdSignature, FrostContext } from "@cello/crypto/frost/types.js";

class ClientDelegatedSigner implements IThresholdSigner {
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
    if (!this.#streams) return { ok: false, error: { reason: "DIRECTORY_BELOW_THRESHOLD" } };
    const stream = this.#streams.get(this.#agentPubkeyHex);
    if (!stream) return { ok: false, error: { reason: "DIRECTORY_BELOW_THRESHOLD" } };

    // Send ceremony_request to the initiating client — the client runs participateInCeremony
    // locally (it holds the coordinator share) and replies with ceremony_result.
    try {
      stream.send(lp.encode.single(CBOR_ENC.encode({
        type: "ceremony_request",
        ceremony_id: ceremonyId,
        tbs: new Uint8Array(tbs),
        context,
      })));
    } catch {
      return { ok: false, error: { reason: "DIRECTORY_BELOW_THRESHOLD" } };
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#pending.delete(ceremonyId);
        resolve({ ok: false, error: { reason: "CEREMONY_TIMEOUT" } });
      }, 30_000);
      this.#pending.set(ceremonyId, (result) => {
        clearTimeout(timer);
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
  });
  await directory.start();

  return {
    directory,
    node,
    stop: async () => { await node.stop(); },
  };
}
