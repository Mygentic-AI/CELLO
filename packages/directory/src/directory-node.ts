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
import { verify, buildMerkleTree, merkleRoot, CONTEXT_SESSION_ESTABLISHMENT } from "@cello/crypto";
import type { KeyProvider, LeafInput, IThresholdSigner } from "@cello/crypto";
import { encodeStructure2, computeGenesisPrevRoot, buildSessionEstablishmentTbs } from "@cello/protocol-types";
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
} from "./directory-types.js";
import { WALL_CLOCK } from "./directory-types.js";
import type { DirectoryStore } from "./directory-store.js";
import { InMemoryDirectoryStore } from "./directory-store.js";
import {
  encodeSignalingAuthChallenge,
  encodeSignalingAuthFailed,
  encodeSessionAssignment,
  encodeSessionAbandoned,
  encodeSessionSealed,
  encodeSessionSealRejected,
  encodeSessionRequestError,
  encodeNotAuthenticated,
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
 * The directory calls these relay methods in-process.
 * Uses structural typing so the directory package need not import @cello/relay directly.
 */
export interface RelayAdapter {
  recordAssignment(assignment: RelaySessionAssignment): { ok: true } | { ok: false; reason: string };
  discardSession(sessionId: Uint8Array): void;
  submitForSeal(sessionId: Uint8Array): { ok: true; data: RelaySealData } | { ok: false; reason: string };
  confirmSeal(sessionId: Uint8Array): void;
  rejectSeal(sessionId: Uint8Array, reason: string): void;
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

  // pubkey_hex → { peer_id, multiaddrs } (from the Noise handshake / client info)
  readonly #peerInfo = new Map<string, { peer_id: string; multiaddrs: string[] }>();

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
    this.#directoryEndpoint = opts.directoryEndpoint ?? { peer_id: "", multiaddrs: [] };
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
    // /cello/frost/1.0.0 stream handler — delegates to FrostDirectoryHandler
    // Stream protocol: length-prefixed CBOR frames (same encoding as signaling)
    //
    // Inbound frame: { agentPubkey, epochId, tbs, context, commitmentList, ceremonyId }
    // Outbound frame: CeremonyRoundResult (ok/error)
    //
    // NOTE: This is the M2 skeletal registration. Full CBOR framing for the
    // /cello/frost/1.0.0 wire protocol will be implemented in the follow-on
    // stream protocol story once the wire format is finalized. For now, the
    // handler is exercised in-process (via FrostDirectoryHandler directly)
    // and the libp2p protocol is registered for discoverability.
    try {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of lp.decode(stream)) {
        // TODO (M2 follow-on): decode CBOR frame and call this.#frostHandler.handleCeremonyRound
        // For now: close stream immediately (handler is exercised in-process)
        break;
      }
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
              } else {
                this.#sendFrame(stream, encodeSessionSealRejected(evt));
              }
            } catch { break; }
          }
          continue;
        }

        // Authenticated: process session_request frames
        const parsed = decodeInboundSignalingFrame(frameBytes);
        if (!parsed || parsed.type !== "session_request") {
          this.#sendFrame(stream, encodeNotAuthenticated({ type: "not_authenticated" }));
          continue;
        }
        await this.#processSessionRequest(stream, authedPubkeyHex!, Buffer.from(parsed.target_pubkey).toString("hex"));
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
            this.#relay.discardSession(pending.sessionId);
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
   * Called by the test harness (or a future connection management layer) to
   * associate the Noise-layer Peer ID and listen multiaddrs with a K_local identity.
   */
  registerPeerInfo(pubkeyHex: string, peer_id: string, multiaddrs: string[]): void {
    this.#peerInfo.set(pubkeyHex, { peer_id, multiaddrs });
  }

  /**
   * SESSION-004: Register a FROST threshold signer for the given initiator pubkey.
   * The signer is invoked when the initiator sends a session_request to produce
   * a FROST-signed SessionAssignment.
   */
  registerThresholdSigner(pubkeyHex: string, signer: IThresholdSigner): void {
    this.#thresholdSigners.set(pubkeyHex, signer);
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
    const epochId = `${initiatorHex}:epoch:1`;  // M2 hardcoded; M3 uses actual key epoch
    const ceremonyId = `session-${Buffer.from(session_id).toString("hex")}`;  // unique per ceremony
    const conflict = this.#frostHandler.checkConflict(initiatorHex, epochId, ceremonyId, ceremonyId);
    if (conflict) {
      console.warn(`[directory] CEREMONY_CONFLICT: agent=${initiatorHex.slice(0, 16)}`);
      this.#sendFrame(stream, encodeSessionRequestError({ type: "session_request_error", reason: "ceremony_conflict" }));
      return;
    }

    // markInFlight AFTER early return — clearInFlight only called when this runs
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
      const recorded = this.#relay.recordAssignment(relayAssignment);
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

    // Sign the SealNotarization
    const close_timestamp = this.#clock.now();
    const participants = [...new Set(leaves.map((l) => Buffer.from(l.s2.sender_pubkey).toString("hex")))];
    const [pA, pB] = participants.length >= 2
      ? [Buffer.from(participants[0], "hex"), Buffer.from(participants[1], "hex")]
      : [new Uint8Array(32), new Uint8Array(32)];

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
      directory_signature: notarizationSig,
    };
    this.#store.recordNotarization(notarization);

    // Notify both clients
    const sealedEvent: SessionSealed = {
      type: "session_sealed",
      session_id: sessionId,
      sealed_root: recomputedRoot,
      directory_signature: notarizationSig,
      close_timestamp,
    };
    this.#deliverOrEnqueue(participants[0] ?? "", sealedEvent);
    if (participants.length >= 2) this.#deliverOrEnqueue(participants[1], sealedEvent);

    return { ok: true };
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
        this.#sendFrame(stream, event.type === "session_sealed"
          ? encodeSessionSealed(event)
          : encodeSessionSealRejected(event as SessionSealRejected));
        return;
      } catch {
        this.#streams.delete(pubkeyHex);
      }
    }
    if (pubkeyHex) this.#store.enqueueNotification(pubkeyHex, event);
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
}

export async function createDirectoryNode(opts: CreateDirectoryNodeOptions): Promise<{
  directory: CelloDirectoryNode;
  node: CelloNode;
  stop: () => Promise<void>;
}> {
  const node = await createNode({
    keyProvider: opts.keyProvider,
    listenAddresses: opts.listenAddresses ?? ["/ip4/127.0.0.1/tcp/0"],
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
