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
import type { DirectoryNodeStub, StubSignParams, StubCommitment } from "@cello/crypto/frost/types.js";
import type { KeyProvider, LeafInput, IThresholdSigner } from "@cello/crypto";
import { encodeStructure2, computeGenesisPrevRoot, buildSessionEstablishmentTbs, buildSealTbs } from "@cello/protocol-types";
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
  decodeInboundSignalingFrame,
} from "./directory-frames.js";
import {
  FrostDirectoryHandler,
  FROST_PROTOCOL_ID,
} from "./frost-handler.js";
import type { FrostDirectoryHandlerOptions } from "./frost-handler.js";
import type { ShareStore } from "./share-store.js";

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
      nodeId: opts.nodeId ?? "",
      shareStore: opts.shareStore,
      onFallbackCanary: opts.onFallbackCanary,
    });
  }

  async start(): Promise<void> {
    await this.#node.handle(SIGNALING_PROTOCOL_ID, (stream) => {
      void this.#handleSignalingStream(stream);
    }, { maxInboundStreams: 512 });

    await this.#node.handle(FROST_PROTOCOL_ID, (stream) => {
      void this.#handleFrostStream(stream);
    }, { maxInboundStreams: 256 });
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
        const agentPubkeyBytes = Buffer.from(agentPubkey, "hex");
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
              } else {
                this.#sendFrame(stream, encodeSessionSealRejected(evt));
              }
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
          continue;
        }
        if (parsed.type === "session_request") {
          // AC-014 (NODE-001): refuse session_request if peer_info has not been registered
          // (neither via wire peer_info_announce nor via direct registerPeerInfo call).
          if (!this.#peerInfoAnnounced.has(authedPubkeyHex!)) {
            this.#sendFrame(stream, encodeSessionRequestError({ type: "session_request_error", reason: "peer_not_registered" }));
            continue;
          }
          // Run concurrently — ceremony_result frames must be processed by this same loop
          // while #processSessionRequest is suspended awaiting the ceremony round-trip.
          void this.#processSessionRequest(stream, authedPubkeyHex!, Buffer.from(parsed.target_pubkey).toString("hex"));
        } else if (parsed.type === "seal_frost_signature") {
          void this.#processSealFrostSignature(authedPubkeyHex!, parsed);
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

  // ─── Session request processing ──────────────────────────────────────────────

  async #processSessionRequest(
    stream: Stream,
    initiatorHex: string,
    targetHex: string
  ): Promise<void> {
    // (a) Verify target is currently authenticated
    const targetStream = this.#streams.get(targetHex);
    if (!targetStream) {
      this.#sendFrame(stream, encodeSessionRequestError({ type: "session_request_error", reason: "target_offline" }));
      return;
    }

    // SESSION-004 Step 1: Check for injected IThresholdSigner (CRITICAL-2: fail loudly if absent)
    const signer = this.#thresholdSigners.get(initiatorHex);
    process.stderr.write(`[dir] processSessionRequest: initiatorHex=${initiatorHex.slice(0,16)}... thresholdSigners keys=[${[...this.#thresholdSigners.keys()].map(k => k.slice(0,16)).join(",")}]\n`);
    if (!signer) {
      process.stderr.write(`[dir] frost_signer_not_configured for initiator ${initiatorHex.slice(0,16)}...\n`);
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

// ─── FrostHandlerStub ────────────────────────────────────────────────────────
// Adapts FrostDirectoryHandler as a DirectoryNodeStub so FrostThresholdSigner
// can use it as a ceremony participant during live (non-test) operation.
// Used by the frost_bootstrap handler to register a signer with the directory.

class FrostHandlerStub implements DirectoryNodeStub {
  readonly id: string;
  readonly #handler: FrostDirectoryHandler;
  readonly #agentPubkey: string;
  readonly #epochId: string;

  constructor(handler: FrostDirectoryHandler, agentPubkey: string, epochId: string) {
    this.id = handler.nodeId;
    this.#handler = handler;
    this.#agentPubkey = agentPubkey;
    this.#epochId = epochId;
  }

  isReachable(): boolean { return true; }

  async receiveShare(
    secret: import("@noble/curves/abstract/frost.js").FrostSecret,
    pub: import("@noble/curves/abstract/frost.js").FrostPublic,
  ): Promise<void> {
    this.#handler.injectShareForTest(this.#agentPubkey, this.#epochId, { secret, pub });
  }

  async generateCommitment(): Promise<StubCommitment> {
    const result = await this.#handler.generateCommitment(this.#agentPubkey, this.#epochId);
    if (!result.ok) throw new Error(`FrostHandlerStub.generateCommitment failed: ${result.reason}`);
    return {
      nodeId: result.nodeId,
      nonceCommitment: result.nonceCommitment,
      nonces: null as unknown as import("@noble/curves/abstract/frost.js").Nonces,
    };
  }

  async signRound(params: StubSignParams): Promise<Uint8Array | null> {
    const result = await this.#handler.signRawMessage({
      agentPubkey: this.#agentPubkey,
      epochId: this.#epochId,
      framedMsg: params.msg,
      commitmentList: params.commitmentList,
      // Use ceremonyId as peerIdString to match markInFlight in #processSessionRequest
      peerIdString: params.ceremonyId,
      ceremonyId: params.ceremonyId,
    });
    if (!result.ok) return null;
    return result.partialSignature;
  }
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
      // Re-use existing verifyFrostSignature from crypto package via dynamic import is complex;
      // use the raw ed25519_FROST verify from @noble/curves which is already a dep of @cello/directory
      const { ed25519_FROST } = require("@noble/curves/ed25519");
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
  });
  await directory.start();

  return {
    directory,
    node,
    stop: async () => { await node.stop(); },
  };
}
