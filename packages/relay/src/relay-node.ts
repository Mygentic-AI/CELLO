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
 *   - discard_session: remove provisional session
 *
 * DOD-M15-RELAYADMIN-DEAD-FRAMES-1 (2026-08-24): record_assignment, confirm_seal and reject_seal
 * were REMOVED from this wire protocol — no deployed directory has sent them since Option B
 * (client-presented assignments) and the internal seal-broker cutover shipped. The in-process
 * methods of the same names (below) are NOT removed: recordAssignment() is still called from the
 * client-presented path (#processClientRecordAssignment) and confirmSeal()/rejectSeal() from the
 * relay's own bilateral seal-broker flow (#maybeProcessSeal). Only the
 * DIRECTORY-DIALED WIRE FRAMES are gone. An authenticated frame naming one of the three retired
 * types now falls through to the "unknown frame type" abort below, same as any other
 * unrecognised type.
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
 *   if frameType === "discard_session":
 *     this.discardSession(session_id)
 *     stream.send(encode({ type: "discard_ok" }))
 *
 *   // record_assignment / confirm_seal / reject_seal: RETIRED (DOD-M15-RELAYADMIN-DEAD-FRAMES-1).
 *   // Falls through to the unknown-frame-type abort, same as any other unrecognised type.
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
import { verifyOnlineToken } from "@cello-protocol/interfaces";
import { DepositRateLimiter, type DepositRateLimitConfig } from "./deposit-rate-limiter.js";
import { ContentParkHandler } from "./content-park.js";
import { RelayConnectionGater, DEFAULT_SLOT_CEILING } from "./relay-connection-gater.js";
import { InMemoryVouchedKeyStore, type VouchedKeyStore } from "./adapters/file-vouched-keys.js";
import { RELAY_LEAF_KINDS, RELAY_LEAF_HASHERS } from "./relay-types.js";
import type {
  SessionAssignment,
  RelaySessionState,
  SealData,
  RelayPubkeyLookup,
  HashSubmitErrorReason,
  SessionLivenessQuery,
  ClientRecordAssignment,
  RelayAuthResponse,
  AuthFailedReason,
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
  encodeSessionInterrupted,
  encodeSessionLivenessResponse,
  decodeInboundFrame,
} from "./relay-frames.js";
import { protocolLog, truncId, truncHex } from "./protocol-log.js";

export const RELAY_PROTOCOL_ID = "/cello/relay/1.0.0";
export const DIRECTORY_RELAY_PROTOCOL_ID = "/cello/directory-relay/1.0.0";

/**
 * DOD-M15-RELAYSLOTS-1 — the most CONCURRENT sessions this relay will hold between one pair of
 * identities.
 *
 * This closes the second door into the reservation table, and it only appears once the first is
 * shut. With an online token required, an attacker can no longer mint keys — but they can register
 * two agents they own, open thousands of sessions between them, put one message down each, and take
 * the table with slots that are genuinely, correctly in use. Nothing bounded that.
 *
 * Five is chosen to be obviously past what any real pair needs: two agents holding five separate
 * live conversations with each other at the same instant is already unusual, and the sixth is far
 * more likely to be conversations that were never closed than one anybody is waiting on.
 */
export const SESSION_CAP_PER_PAIR = 5;
const AUTH_DOMAIN = "CELLO-RELAY-AUTH-v1";
const NONCE_TTL_MS = 30_000;

/**
 * How much of an unrecognised frame's `type` reaches the log.
 *
 * The field is attacker-controlled and cbor-x accepts up to 4 MiB by default, so without a bound an
 * authenticated peer can write a multi-megabyte line per refused frame. Not log forgery — the logger
 * is `JSON.stringify`, so newlines escape — but volume, and it costs the peer nothing.
 *
 * ⚠️ 64, NOT 32. I set this to 32 first and it truncated a legitimate frame type mid-word in a test.
 * The longest real type names run to the high twenties, so 32 leaves no margin and the cost of
 * getting it wrong is a diagnostic naming a frame nobody can grep for — which is most of the value of
 * logging the type at all. 64 still turns 4 MiB into a line, and fits anything real.
 */
const MAX_LOGGED_FRAME_TYPE = 64;

/**
 * DOD-M15-RELAYABUSE-1: default per-key limit on relay authentication attempts.
 *
 * Boring rather than clever, same philosophy as the deposit limiter this package already ships:
 * 20 attempts/minute is far below what a credential-stuffing or connection-flood attempt needs to
 * be effective, while leaving normal use untouched.
 *
 * ⚠️ Review F8 corrected the JUSTIFICATION, not the number. This used to claim 20/min was "far
 * above a legitimate reconnect burst (a flaky link retrying every few seconds)" — but a retry every
 * three seconds is exactly 20/min, which is AT the limit, not far above it. The arithmetic was
 * wrong and would have misled the next person to tune this. The number is still right for a
 * different reason: the daemon re-authenticates on demand — when it reserves, and when it is
 * promoted into a session — not on a fixed retry grid, so it does not produce sustained per-minute
 * bursts at all. If a client is ever changed to retry on a timer, revisit this number rather than
 * trusting this comment.
 *
 * Applied twice per attempt, at DIFFERENT points in the handshake — the peer-keyed check runs
 * BEFORE any nonce is minted (bounds one machine hammering with many claimed keys, at no crypto
 * cost, and covers a caller who opens streams and never replies at all); the pubkey-keyed check
 * runs AFTER the signature verifies (bounds one real key used from many machines). The pubkey-keyed check must never run on the claimed-but-unverified pubkey:
 * review caught that ordering letting anyone who merely KNOWS an agent's public key lock that agent
 * out by claiming it with a garbage signature — see the comment at the check site in
 * `#handleRelayStream`.
 *
 * ⚠️ Like the deposit limiter, this is a speed bump, not a gate: a rewritten client can mint a
 * fresh transport peer AND a fresh real keypair per burst and get a fresh bucket on both axes each
 * time. It raises the cost of hammering this relay; it does not make hammering impossible. The
 * relay's own enforcement is what's load-bearing here, not any assumption about client behaviour.
 */
const DEFAULT_AUTH_RATE_LIMIT: DepositRateLimitConfig = { maxPerWindow: 20, windowMs: 60_000 };

/**
 * DOD-M15-RELAYABUSE-1: default per-key limit on hash_submit, applied post-authentication.
 *
 * Sized for real conversational traffic, not the deposit path's occasional message: 120/minute
 * (2/second sustained) comfortably covers a busy back-and-forth exchange while still bounding a
 * peer trying to spend the relay's CPU, disk and per-session lock at line rate. Applied per the
 * Noise-authenticated peer id AND per the AUTHENTICATED sender pubkey — both trustworthy here,
 * since hash_submit only runs after auth (there is no pre-auth hash_submit path, unlike the auth
 * limiter above, whose peer/pubkey checks straddle the verification step for exactly that reason).
 *
 * ⚠️ Same speed-bump caveat as `DEFAULT_AUTH_RATE_LIMIT`: a rewritten client can rotate its
 * transport peer per burst and get a fresh bucket on that axis (the pubkey axis cannot be spoofed
 * post-auth, but a fresh real session under a fresh real key resets it too).
 */
const DEFAULT_HASH_SUBMIT_RATE_LIMIT: DepositRateLimitConfig = { maxPerWindow: 120, windowMs: 60_000 };

/**
 * DOD-M15-RELAYABUSE-1: default cap on a single relayed (circuit-relay) connection's DURATION.
 *
 * `applyDefaultLimit: false` (DOD-NAT-REACHABILITY-1) removed libp2p's own default — 2 minutes —
 * because it killed the exact case a relayed connection exists for: a hole-punch failure
 * (symmetric NAT, strict corporate firewall) where the relayed link IS the session, for as long as
 * the conversation runs. "Restore the cap" cannot mean putting the 2-minute value back; it means
 * bounding what was left fully unbounded. 7 days is long enough that no real CELLO conversation —
 * which reconnects and re-authenticates far more often than that in practice — should ever hit it,
 * and short enough to eventually reclaim a circuit someone is holding open indefinitely to tunnel
 * unrelated traffic through this relay. Tunable via `RELAY_CIRCUIT_DURATION_LIMIT_MS` in
 * `bin/relay.ts` without a code change, precisely because this number is a judgement call.
 */
const DEFAULT_CIRCUIT_DURATION_LIMIT_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * DOD-M15-RELAYABUSE-1: default cap on a single relayed connection's total BYTES, for the same
 * reason as the duration cap above. libp2p's own default is 128 KiB — far too small for a
 * multi-day text conversation carried entirely over a relayed link. 1 GiB is generously above any
 * realistic CELLO session's content (hash_submit/leaf_deliver frames are hundreds of bytes; parked
 * ciphertext goes through content-park, not this circuit) while still bounding a relay being used
 * as a general-purpose data tunnel. Tunable via `RELAY_CIRCUIT_DATA_LIMIT_BYTES`.
 */
const DEFAULT_CIRCUIT_DATA_LIMIT_BYTES = BigInt(1024) * BigInt(1024) * BigInt(1024);

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
  /**
   * DOD-M15-SUBMIT-ID-1 — the sender's own id for THIS SEND, stable across its retransmissions.
   *
   * Optional, because every client in the field today sends six elements and must keep working.
   * When present, the relay answers a repeat with the ORIGINAL position instead of allocating a new
   * one.
   *
   * MINTED BY THE SENDER, and it has to be: Structure 1 carries a timestamp, so a retry is
   * byte-different and unrecognisable; and `content_hash` cannot stand in for it, because sending
   * identical content twice in one conversation is two messages, not a duplicate.
   */
  submission_id?: Uint8Array;
}

function decodeStructure1(cbor: Uint8Array): Structure1Fields | null {
  let arr: unknown;
  try {
    arr = decode(cbor);
  } catch {
    return null;
  }
  /**
   * SIX OR SEVEN — `DOD-M15-SUBMIT-ID-1`, and this relaxation is the whole "tolerate first" half.
   *
   * It was `!== 6`, so a client that appended a submission id had every frame refused as
   * `signature_invalid` by any relay not yet updated — including the one deployed. The relay
   * therefore has to accept the new shape BEFORE any client emits it; a client-first rollout breaks
   * every message in flight.
   *
   * Still a fixed set of lengths rather than `>= 6`: an arbitrarily long array is a frame this
   * version does not understand, and accepting it would mean verifying a signature over bytes whose
   * meaning is not agreed.
   */
  if (!Array.isArray(arr) || (arr.length !== 6 && arr.length !== 7)) return null;

  const [_pv, _ch, _spk, _sid, _lss, _ts, _subId] = arr;

  if (typeof _pv !== "number") return null;
  const chBytes = _ch instanceof Uint8Array ? _ch : Buffer.isBuffer(_ch) ? new Uint8Array(_ch as Buffer) : null;
  const spkBytes = _spk instanceof Uint8Array ? _spk : Buffer.isBuffer(_spk) ? new Uint8Array(_spk as Buffer) : null;
  const sidBytes = _sid instanceof Uint8Array ? _sid : Buffer.isBuffer(_sid) ? new Uint8Array(_sid as Buffer) : null;
  if (!chBytes || chBytes.length !== 32) return null;
  if (!spkBytes || spkBytes.length !== 32) return null;
  if (!sidBytes || sidBytes.length !== 16) return null;
  if (typeof _lss !== "number") return null;
  if (typeof _ts !== "number" && typeof _ts !== "bigint") return null;

  let subIdBytes: Uint8Array | undefined;
  if (arr.length === 7) {
    const b = _subId instanceof Uint8Array ? _subId : Buffer.isBuffer(_subId) ? new Uint8Array(_subId as Buffer) : null;
    // Present-but-malformed is REFUSED, not ignored. Silently dropping it would give the sender a
    // fresh position for what they declared a retry — the exact defect, wearing a valid ack.
    if (!b || b.length === 0 || b.length > 32) return null;
    subIdBytes = b;
  }

  return {
    protocol_version: _pv,
    content_hash: chBytes,
    sender_pubkey: spkBytes,
    session_id: sidBytes,
    last_seen_seq: _lss,
    timestamp: _ts,
    ...(subIdBytes ? { submission_id: subIdBytes } : {}),
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
  ): Promise<
    | { ok: true }
    | {
        ok: false;
        /**
         * WHICH KIND OF FAILURE — and the caller must branch on it (`DOD-M15-TRANSPORT-TERMINAL-1`).
         *
         *   `"refused"`      a directory READ the seal and rejected it. A verdict. Terminal, because
         *                    retrying cannot change a merits decision.
         *   `"unreachable"`  no directory formed an opinion — the relay could not reach one, got no
         *                    answer, or has no libp2p node at all. **Not a verdict**, so not terminal.
         *
         * It was one free-form `reason` string, and the relay terminalised on both. A directory
         * restart, a dropped circuit or a NAT rebind therefore destroyed a healthy conversation
         * PERMANENTLY, and told both participants `session_sealed` — so each believed they held a
         * notarized receipt of something that was never notarized.
         *
         * OPTIONAL, and absence means `"refused"`. An adapter that has not been updated keeps
         * today's behaviour exactly: the conservative reading, because defaulting to `"unreachable"`
         * would make a genuine refusal retry forever and never tell the operator it was refused.
         */
        kind?: "refused" | "unreachable" | "unknown";
        reason: string;
        redirect?: { nodeId: string; peerId: string; multiaddr: string };
      }
  >;
  /**
   * FEDERATION-003 AC-005/AC-006: Look up a relay's registered public key by relayId.
   * Returns undefined if the relayId is not registered.
   * Used when verifying predecessor relay ACK signatures on re-submission.
   */
  /**
   * DOD-M15-SWEEP-1 re-review item 1: returns a discriminated result, not `string | undefined`.
   * Only `reason: "not_registered"` means the directory answered; every other failure means no
   * answer was obtained and must not be reported to an operator as "that relay is unregistered".
   */
  getRelayPublicKey?(relayId: string): Promise<RelayPubkeyLookup>;
}

export interface RelayNodeOptions {
  node: CelloNode;
  /**
   * The primary sovereign directory's Ed25519 public key.
   *
   * ⚠️ OPTIONAL, and its absence is a real deployment state rather than a test convenience: a relay
   * started without one holds nothing to verify directory signatures against. It must then REFUSE —
   * every online token, every admin frame, every assignment — because a verifier that cannot verify
   * and admits the caller anyway is how a security check ends up installed and decorative
   * (DOD-M15-RELAYSLOTS-1). `bin/relay.ts` still requires the environment variable in production;
   * this is what makes the misconfigured case fail loudly instead of open.
   */
  directoryPubkey?: Uint8Array;
  /** DOD-M15-RELAYSLOTS-1: see `SESSION_CAP_PER_PAIR`. */
  sessionCapPerPair?: number;
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
  /**
   * DOD-M15-RELAYAUTH-1: the connection gater passed into `createNode()` — see
   * `relay-connection-gater.ts` for what it enforces (dial-through gated on a real session
   * assignment; reservation grants time-boxed on proving key possession). Required so
   * `CelloRelayNode` can feed it session bindings and auth events as they happen; the relay
   * cannot function correctly with `store`/`recordAssignment` state and the gater's state
   * drifting apart.
   */
  connectionGater?: RelayConnectionGater;
  /**
   * DOD-M15-RELAYAUTH-1 review H2: where "this pubkey is a real participant" is persisted. Defaults
   * to a no-op store, which is right whenever the content store is in-memory too — with nothing
   * durable on either side there is no parked mail a restart could strand. Wire the file-backed one
   * wherever the content store is file-backed, or a relay roll leaves agents unable to collect mail
   * the relay is actively telling them about.
   */
  vouchedKeyStore?: VouchedKeyStore;
  /**
   * PERSIST-013 leaf-durability WAL. **Currently accepted and unused** — its only reader was the
   * gap-fill handler deleted in `DOD-M15-SEALWIRE-1` bullet 7, and the composition root has never
   * passed it in (see `bin/relay.ts`, unused since 2026-05-16). Kept as the injection seam so
   * wiring durability is a one-line change rather than a re-plumb; see `SessionWal`'s own header
   * for what is intent versus behaviour.
   */
  sessionWal?: SessionWal;
  /**
   * M7-MSG-001: durable store-and-forward content store. When present, the relay
   * registers the content-park protocol (deposit/pull/confirm) and notifies a
   * (re)connecting recipient that has parked content.
   */
  contentStore?: ContentStore;
  /**
   * DOD-M15-RELAYABUSE-1: per-depositor park-deposit rate limit. Defaults to 30/minute.
   * Threaded so an operator can tune it and so a test can drive the real handler cheaply.
   */
  depositRateLimit?: DepositRateLimitConfig;
  /**
   * DOD-M15-RELAYABUSE-1: per-peer AND per-claimed-pubkey relay-authentication rate limit.
   * Defaults to 20/minute (see `DEFAULT_AUTH_RATE_LIMIT`). Threaded for the same reasons as
   * `depositRateLimit`.
   */
  authRateLimit?: DepositRateLimitConfig;
  /**
   * DOD-M15-RELAYABUSE-1: per-peer AND per-authenticated-pubkey hash_submit rate limit.
   * Defaults to 120/minute (see `DEFAULT_HASH_SUBMIT_RATE_LIMIT`).
   */
  hashSubmitRateLimit?: DepositRateLimitConfig;
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
  /** `null` when no directory key is configured — see `RelayNodeOptions.directoryPubkey`. */
  readonly #directoryPubkey: Uint8Array | null;
  /** DOD-M15-RELAYSLOTS-1: see `SESSION_CAP_PER_PAIR`. */
  readonly #sessionCapPerPair: number;
  /** FED-OPTIONB-SETUP-001: consortium directory pubkeys a client-presented assignment may be signed by. */
  readonly #directoryPubkeys: Uint8Array[];
  /** DOD-SEAL-BROKER-1: directory pubkey hex -> multiaddr. Empty in single-directory deployments. */
  readonly #directoryEndpointsByPubkey: Record<string, string>;
  /** DOD-SEAL-BROKER-1: session id hex -> pubkey hex of the directory that signed its assignment. */
  readonly #sessionBrokerPubkey = new Map<string, string>();
  readonly #directory: DirectoryAdapter | null;
  readonly #store: RelayStore;
  readonly #logger: Logger;
  // Assigned, never read — see the `sessionWal` option above. Left in place rather than deleted so
  // that wiring the WAL does not require re-threading the constructor; NOT evidence that leaf
  // durability runs.
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

  /** DOD-M15-RELAYABUSE-1: auth-attempt rate limit, keyed on the Noise-authenticated peer id. */
  readonly #authPeerLimiter: DepositRateLimiter;
  /** DOD-M15-RELAYABUSE-1: auth-attempt rate limit, keyed on the CLAIMED (pre-verification) pubkey. */
  readonly #authPubkeyLimiter: DepositRateLimiter;
  /** DOD-M15-RELAYABUSE-1: hash_submit rate limit, keyed on the Noise-authenticated peer id. */
  readonly #hashSubmitPeerLimiter: DepositRateLimiter;
  /** DOD-M15-RELAYABUSE-1: hash_submit rate limit, keyed on the AUTHENTICATED sender pubkey. */
  readonly #hashSubmitPubkeyLimiter: DepositRateLimiter;

  /**
   * DOD-M15-RELAYAUTH-1: fed session bindings and auth events as they happen — see
   * `relay-connection-gater.ts`. Optional only so tests/local callers that don't need the
   * enforcement can omit it; production wiring always supplies one (`createRelayNode`).
   */
  readonly #connectionGater: RelayConnectionGater | null;

  /**
   * DOD-M15-RELAYAUTH-1: pubkeys named by at least one directory-signed assignment this relay has
   * recorded — "this is a real participant, not a bare keypair that merely authenticated." Grows
   * only via `recordAssignment()` succeeding, which requires an unforgeable directory signature —
   * unlike a peer-id-keyed cache, this is not free for an attacker to inflate at will. Never
   * pruned: a pubkey once vouched stays vouched for the relay's lifetime, matching the real
   * lifecycle (an agent that finishes one session is still the same registered agent for the next).
   */
  #vouchedPubkeys = new Set<string>();

  /**
   * Review H2: the durable half of the above. In memory alone this gate stranded parked mail across
   * every relay restart — see `file-vouched-keys.ts`. Defaults to a no-op store, which is correct
   * wherever the content store is in-memory too (tests, `CELLO_ENV=local`): nothing survives on
   * either side, so there is no mailbox to strand.
   */
  readonly #vouchedKeyStore: VouchedKeyStore;

  constructor(opts: RelayNodeOptions) {
    this.#node = opts.node;
    this.#directoryPubkey = opts.directoryPubkey ?? null;
    this.#sessionCapPerPair = opts.sessionCapPerPair ?? SESSION_CAP_PER_PAIR;
    // FED-OPTIONB-SETUP-001: the consortium set always contains the primary directoryPubkey, plus any
    // additional sovereign nodes. Deduped so a repeated pubkey doesn't cost an extra verify attempt.
    // DOD-M15-RELAYSLOTS-1: with no primary configured the set starts EMPTY rather than being padded
    // with a placeholder, so every signature check has nothing to succeed against and refuses.
    this.#directoryEndpointsByPubkey = opts.directoryEndpointsByPubkey ?? {};
    this.#directoryPubkeys = opts.directoryPubkey ? [opts.directoryPubkey] : [];
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
    this.#connectionGater = opts.connectionGater ?? null;
    // Review H2: seed from disk BEFORE the content-park handler is built, so an agent whose mail was
    // parked before a restart is already vouched the first time it asks for it.
    this.#vouchedKeyStore = opts.vouchedKeyStore ?? new InMemoryVouchedKeyStore();
    this.#vouchedPubkeys = this.#vouchedKeyStore.load();
    this.#contentParkHandler = opts.contentStore
      ? new ContentParkHandler({
          node: this.#node,
          store: opts.contentStore,
          logger: this.#logger,
          // DOD-M15-RELAYAUTH-1: pull/confirm proves the caller OWNS the recipient key (I1) but
          // that alone is not "this is a real relay participant" — see the class comment on
          // #vouchedPubkeys. Closed-over, not a snapshot: reads whatever is vouched at call time.
          isVouched: (pubkeyHex: string) => this.#vouchedPubkeys.has(pubkeyHex),
          ...(opts.depositRateLimit ? { rateLimit: opts.depositRateLimit } : {}),
        })
      : null;
    this.#contentStore = opts.contentStore ?? null;
    this.#ackSigningKeyProvider = opts.ackSigningKeyProvider ?? null;
    this.#relayId = opts.relayId ?? null;
    this.#sessionIdleTimeoutMs = opts.sessionIdleTimeoutMs;
    this.#authPeerLimiter = new DepositRateLimiter(opts.authRateLimit ?? DEFAULT_AUTH_RATE_LIMIT);
    this.#authPubkeyLimiter = new DepositRateLimiter(opts.authRateLimit ?? DEFAULT_AUTH_RATE_LIMIT);
    this.#hashSubmitPeerLimiter = new DepositRateLimiter(opts.hashSubmitRateLimit ?? DEFAULT_HASH_SUBMIT_RATE_LIMIT);
    this.#hashSubmitPubkeyLimiter = new DepositRateLimiter(opts.hashSubmitRateLimit ?? DEFAULT_HASH_SUBMIT_RATE_LIMIT);
  }

  async start(): Promise<void> {
    // CELLO-M6B-009 AC-005: explicit maxInboundStreams caps
    // DOD-M15-RELAYABUSE-1: the remotePeerId (Noise-authenticated transport identity) is threaded
    // into #handleRelayStream so auth and hash_submit can be rate-limited per PEER, not only per
    // claimed/authenticated pubkey — the same identity source content-park.ts already uses for its
    // deposit limiter.
    await this.#node.handle(RELAY_PROTOCOL_ID, (stream, remotePeerId) => {
      void this.#handleRelayStream(stream, remotePeerId);
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
      /**
       * DOD-M15-RELAYSLOTS-1: free the slot the moment the peer goes, rather than carrying it until
       * the reservation TTL runs out. The delay was never neutral — it is how an agent that
       * restarts a handful of times exhausts its own per-agent cap while holding nothing at all.
       */
      this.#connectionGater?.recordDisconnect(disconnectedPeerId);
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

      /**
       * DOD-M15-RELAYSLOTS-1: no configured directory key means nothing can authenticate as the
       * directory. Refused, and said out loud — an operator staring at a relay that ignores every
       * admin frame needs the cause, and the cause is one missing environment variable.
       */
      if (!this.#directoryPubkey) {
        this.#logger.error("relay.directory.admin.no_directory_key", {
          impact: "a directory admin frame arrived but this relay holds NO directory public key, so " +
            "its signature cannot be checked and the frame is refused. Every admin operation will " +
            "fail this way until CELLO_DIRECTORY_PUBKEY is set and the relay restarted.",
        });
        stream.send(lp.encode.single(CBOR_ENC.encode({ type: "auth_invalid" })));
        await stream.close();
        return;
      }

      if (!verify(this.#directoryPubkey, bodyBytes, directory_signature)) {
        stream.send(lp.encode.single(CBOR_ENC.encode({ type: "auth_invalid" })));
        await stream.close();
        return;
      }

      // OBS-001: directory admin authenticated
      protocolLog("RELAY", `Directory admin authenticated (pubkey ${truncHex(Buffer.from(this.#directoryPubkey).toString("hex"))})`);

      // Authenticated — process the frame
      //
      // record_assignment, confirm_seal and reject_seal were REMOVED here
      // (DOD-M15-RELAYADMIN-DEAD-FRAMES-1, 2026-08-24): no deployed directory has sent them since
      // Option B (client-presented assignments) and the seal-broker cutover shipped. A frame
      // naming one of the three now falls through to the "unknown frame type" abort below — a
      // hard fail, not silent acceptance. The in-process recordAssignment()/confirmSeal()/
      // rejectSeal() methods below are unaffected; they still serve the client-presented path and
      // the relay's own bilateral seal-broker flow.
      if (frameType === "discard_session") {
        const session_id = req["session_id"] as Uint8Array;
        this.discardSession(session_id instanceof Uint8Array ? session_id : new Uint8Array(session_id as unknown as ArrayBuffer));
        stream.send(lp.encode.single(CBOR_ENC.encode({ type: "discard_ok" })));
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

      /**
       * DOD-M15-RELAYADMIN-DEAD-FRAMES-1 re-review — **THE RELAY WAS REJECTING AN AUTHENTICATED
       * DIRECTORY FRAME AND WRITING NOTHING DOWN.**
       *
       * The abort is right: an unrecognised frame must not mutate state. But `stream.abort()` does
       * not throw locally, so the catch below never ran either, and a libp2p reset carries no reason
       * across the wire. The whole event left no trace on either machine.
       *
       * What the operator saw instead: the directory's own adapter reports
       * `reason: "relay_unavailable"` when its stream dies with no response — so a relay that is up,
       * authenticating correctly, and answering every other frame gets reported as UNAVAILABLE. That
       * is an exit-point label pointing at the network for what is a wire-protocol mismatch, and it
       * is the failure mode this repo's debugging discipline names first.
       *
       * That was survivable while only a malformed frame could land here. Deleting three named
       * frame types from this protocol made it a live version-skew path — an older directory sending
       * `record_assignment` lands exactly here — so it needs to say so.
       */
      this.#logger.warn("relay.directory.frame.unknown", {
        frameType: typeof frameType === "string" ? frameType : "(non-string)",
        impact: "an AUTHENTICATED directory frame was refused because this relay does not handle that " +
          "type. The directory will see its stream die with no response and may report the relay as " +
          "unavailable — it is not. Most likely a version skew: a directory newer or older than this " +
          "relay, or one still sending a frame type that was retired.",
      });
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
    /**
     * DOD-M15-RELAYSLOTS-1 — **THE TUPLE CAP.** Nothing bounded how many sessions two identities
     * could hold at once, and that is the second door into the reservation table: register two
     * agents you own, open four thousand sessions between them, put one message down each, and you
     * hold the whole relay with slots every "is this in use" test correctly calls busy. The
     * per-agent cap does not catch it on its own — the attacker simply uses more agents — but
     * together the two make the attack cost real registered identities per handful of slots.
     *
     * Checked BEFORE `recordSession` so a refused session leaves no trace to clean up. Counted from
     * live participant tracking, which `#cleanupSessionTracking` maintains, so sealed and swept
     * sessions do not hold the count down.
     *
     * No legitimate pair of agents needs five concurrent conversations with each other.
     */
    const aHexForCap = Buffer.from(assignment.participant_a).toString("hex");
    const bHexForCap = Buffer.from(assignment.participant_b).toString("hex");
    const concurrent = this.#concurrentSessionsBetween(aHexForCap, bHexForCap);
    if (concurrent >= this.#sessionCapPerPair) {
      this.#logger.warn("relay.session.tuple_cap_exceeded", {
        participantA: truncHex(aHexForCap),
        participantB: truncHex(bHexForCap),
        concurrent,
        cap: this.#sessionCapPerPair,
        impact: "these two identities already hold the most concurrent sessions one pair may hold " +
          "on this relay. Refused. For a real operator this means conversations with one " +
          "counterparty that were never closed — the count says how many, so they can go and close some.",
      });
      return { ok: false, reason: "session_tuple_cap_exceeded" };
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
      // DOD-M15-RELAYAUTH-1: feed the dial-through gate — see relay-connection-gater.ts. Session
      // Peer IDs are required by the client's own initiate-session path (a session cannot start
      // without both), so this is the common case, not a fallback.
      this.#connectionGater?.recordSessionBinding(
        sessionKey,
        assignment.initiator_session_peer_id,
        assignment.counterparty_session_peer_id,
      );
    }

    // M7-SESSION-001: track participant → session mapping for interrupt emission
    const aHex = Buffer.from(assignment.participant_a).toString("hex");
    const bHex = Buffer.from(assignment.participant_b).toString("hex");
    if (!this.#participantSessions.has(aHex)) this.#participantSessions.set(aHex, new Set());
    if (!this.#participantSessions.has(bHex)) this.#participantSessions.set(bHex, new Set());
    this.#participantSessions.get(aHex)!.add(sessionKey);
    this.#participantSessions.get(bHex)!.add(sessionKey);

    // DOD-M15-RELAYAUTH-1: a directory-signed assignment naming these two pubkeys IS the
    // credential — both are now vouched, regardless of which one presented the frame (the OTHER
    // participant may not have connected yet at all).
    this.#vouchedPubkeys.add(aHex);
    this.#vouchedPubkeys.add(bHex);
    // Review H2: and durably, so a restart does not strand their parked content.
    this.#vouchedKeyStore.add(aHex);
    this.#vouchedKeyStore.add(bHex);

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

  rejectSeal(sessionId: Uint8Array, reason: string): void {
    const key = Buffer.from(sessionId).toString("hex");
    this.#cleanupSessionTracking(key);
    const state = this.#store.getSession(key);
    if (state) {
      /**
       * THE CAUSE IS KEPT — review F6, Invariant 3.
       *
       * The parameter was `_reason` and reached nothing but a stdout line, so a participant asking
       * why their conversation ended got `seal_refused` and no more. `merkle_root_mismatch`,
       * `causal_chain_violated` and `leaf_signature_invalid` are three very different problems with
       * three different next steps, and collapsing them into one exit-point label is exactly what
       * this milestone exists to stop.
       */
      this.#store.setSession(key, { ...state, status: "seal_rejected", seal_rejected_reason: reason });
    }
    protocolLog("RELAY", `Seal rejected: ${truncHex(key)}, reason: ${reason}`);
  }

  // ─── Stream handler ─────────────────────────────────────────────────────────

  /**
   * DOD-M15-RELAYABUSE-1 review F7 — **A REFUSAL THAT LOSES A RACE WITH ITS OWN ABORT READS AS
   * "THE RELAY IS DOWN".**
   *
   * Every auth refusal used to be `#sendFrame(...)` followed immediately by `stream.abort(...)`.
   * `#sendFrame` does not flush, so over loopback the frame arrives and in tests everything looks
   * right — but under real backpressure the reset can beat the frame out, and the caller then sees a
   * bare stream reset with no reason at all. That defeats the first clause of this order: a refusal
   * must be loud and must name its cause, because a relay that silently drops is indistinguishable
   * from a relay that is down.
   *
   * So the refusal is sent and the stream is closed GRACEFULLY, which flushes. `abort` remains only
   * as the fallback for when the close itself fails — at which point the peer is gone anyway and
   * there is nobody left to tell.
   */
  async #refuseAuth(stream: Stream, frame: Uint8Array, reason: string): Promise<void> {
    try {
      await this.#sendFrame(stream, frame);
      await stream.close();
    } catch {
      stream.abort(new Error(reason));
    }
  }

  /**
   * DOD-M15-RELAYSLOTS-1 — verify the directory-issued online token on an auth response.
   *
   * Returns the refusal reason, or `null` when the caller is a registered agent and may proceed.
   *
   * `authedPubkeyHex` is the key whose signature has ALREADY verified on this stream. That ordering
   * is the whole reason the pubkey-binding check has teeth: the token names a key, and the caller has
   * separately proven possession of the key it presented, so requiring the two to match means a token
   * lifted from a log or a shared machine is worthless without the private key it was issued to.
   */
  #checkOnlineToken(
    resp: RelayAuthResponse,
    authedPubkeyHex: string,
    remotePeerId?: string,
  ): AuthFailedReason | null {
    if (!resp.online_token) {
      this.#logger.warn("relay.auth.online_token.missing", {
        remotePeerId: remotePeerId ?? "(none)",
        pubkey: truncHex(authedPubkeyHex),
        impact: "this auth was refused because it carried no directory-issued online token. The " +
          "caller proved it holds this key, which is free to generate — the token is what says the " +
          "key belongs to a registered agent. A current client obtains one when its directory marks " +
          "it online, so the usual cause is a client that has not reached a directory yet.",
      });
      return "online_token_required";
    }

    const verification = verifyOnlineToken(resp.online_token, this.#directoryPubkeys, Date.now());
    if (!verification.ok) {
      this.#logger.warn("relay.auth.online_token.rejected", {
        remotePeerId: remotePeerId ?? "(none)",
        pubkey: truncHex(authedPubkeyHex),
        reason: verification.reason,
        directoryKeyCount: this.#directoryPubkeys.length,
        impact: verification.reason === "online_token_no_directory_key"
          ? "this relay holds NO directory public key, so it cannot verify any token and is refusing " +
            "every agent. This is a relay misconfiguration, not a caller problem — set " +
            "CELLO_DIRECTORY_PUBKEY. Refusing is deliberate: a relay that cannot verify and admits " +
            "the caller anyway leaves the reservation table open to exactly the flood this check exists to stop."
          : "this auth was refused because the directory-issued online token did not check out. " +
            "directoryKeyCount is how many directory keys this relay would have accepted a signature " +
            "from — a signature_invalid against a plausible count usually means the token came from a " +
            "directory this relay was never told about.",
      });
      return verification.reason;
    }

    const tokenPubkeyHex = Buffer.from(verification.agentPubkey).toString("hex");
    if (tokenPubkeyHex !== authedPubkeyHex) {
      this.#logger.warn("relay.auth.online_token.pubkey_mismatch", {
        remotePeerId: remotePeerId ?? "(none)",
        authedPubkey: truncHex(authedPubkeyHex),
        tokenPubkey: truncHex(tokenPubkeyHex),
        impact: "a VALID, unexpired directory token was presented by a key it does not name. That is " +
          "what a lifted token looks like: the holder of the token is not the holder of the key. " +
          "Refused — without this comparison one leaked token would authorise every throwaway key an " +
          "attacker cares to generate.",
      });
      return "online_token_pubkey_mismatch";
    }

    return null;
  }

  async #handleRelayStream(stream: Stream, remotePeerId?: string): Promise<void> {
    /**
     * DOD-M15-RELAYABUSE-1 review F4 — **THE LIMIT NOW GUARDS THE EXPENSIVE PART, INSTEAD OF SITTING
     * BEHIND IT.**
     *
     * This check used to live further down, inside the branch handling the auth RESPONSE. Everything
     * above it ran unmetered: every new stream swept the nonce map (O(n) in nonces held), minted a
     * 32-byte nonce, stored it under a 30-second TTL, and sent a challenge. A caller that opened
     * streams and simply never replied therefore paid nothing and was never limited, while each open
     * made the next one more expensive — superlinear work driven entirely by the attacker.
     *
     * Consulting it here also changes the unit being limited, correctly: one token per stream OPENED
     * rather than per auth response RECEIVED. Opening a stream is the thing that costs the relay.
     *
     * The key is the Noise-authenticated transport identity, which a caller cannot forge, so this
     * costs one map lookup and no crypto. The CLAIMED pubkey is still not consulted until after the
     * signature verifies — see the note at the pubkey-keyed check below, which is a security
     * property, not an ordering preference.
     */
    const peerLimit = this.#authPeerLimiter.check(remotePeerId);
    if (!peerLimit.allowed) {
      this.#logger.warn("relay.auth.rate_limited", {
        remotePeerId: remotePeerId ?? "(none)",
        peerLimited: true,
        pubkeyLimited: false,
        retryAfterMs: peerLimit.retryAfterMs,
        impact: "this auth attempt was refused before any nonce was minted — the caller may retry after the window",
      });
      await this.#refuseAuth(
        stream,
        encodeAuthFailed({ type: "relay_auth_failed", reason: "rate_limited", retry_after_ms: peerLimit.retryAfterMs }),
        "rate_limited",
      );
      return;
    }
    if (remotePeerId === undefined) {
      /**
       * Review F6 — **"RUNNING BLIND" MUST NOT LOOK LIKE "NO ABUSE".**
       *
       * `DepositRateLimiter` lets an absent key through. That is safe here today because
       * `remotePeerId` comes from libp2p's `StreamHandler`, which always supplies the
       * Noise-authenticated `connection.remotePeer` — a caller cannot omit it. But "safe because of
       * a type upstream" is one refactor away from a silently unlimited path, and the content-park
       * limiter already carries a matching signal for exactly this reason. If this ever fires, the
       * assumption above has been broken and auth is no longer rate limited at all.
       */
      this.#logger.warn("relay.auth.unattributed", {
        impact: "an auth stream arrived with NO transport peer id, so the per-peer auth rate limit " +
          "could not be applied to it. This should be impossible — treat it as the limiter having " +
          "been bypassed, not as a quiet success.",
      });
    }

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

          // ⚠️ The CLAIMED pubkey is NOT checked against a rate limit here, and that is deliberate —
          // it was the defect review caught. `resp.pubkey` at this point is an UNVERIFIED ASSERTION:
          // anyone who merely KNOWS an agent's public key (which CELLO agents hand out freely so
          // others can connect) could claim it here with a garbage signature, spend the VICTIM's
          // rate-limit bucket, and lock the real key-holder out of this relay with `rate_limited` —
          // a third party denying one specific agent service, at zero cost, with no proof of key
          // possession required. The pubkey-keyed check runs only AFTER the signature verifies
          // below, so incrementing that bucket requires actually owning the key.
          //
          // The PEER-keyed limit was consulted at the top of this handler (review F4), before any
          // nonce was minted for this stream.

          const nonceEntry = this.#nonces.get(nonceHex);
          if (!nonceEntry) {
            await this.#refuseAuth(stream, encodeAuthFailed({ type: "relay_auth_failed", reason: "nonce_unknown" }), "nonce_unknown"); return;
          }
          if (Date.now() > nonceEntry.expiresAt) {
            this.#nonces.delete(nonceHex);
            await this.#refuseAuth(stream, encodeAuthFailed({ type: "relay_auth_failed", reason: "nonce_expired" }), "nonce_expired"); return;
          }
          if (nonceEntry.used) {
            await this.#refuseAuth(stream, encodeAuthFailed({ type: "relay_auth_failed", reason: "nonce_reused" }), "nonce_reused"); return;
          }
          nonceEntry.used = true;
          this.#nonces.delete(nonceHex);

          // Verify Ed25519(SHA-256("CELLO-RELAY-AUTH-v1" || nonce || pubkey)) per spec
          const domain = Buffer.from(AUTH_DOMAIN, "utf8");
          const authMsg = new Uint8Array(Buffer.concat([domain, nonce, resp.pubkey]));
          const msgHash = new Uint8Array(createHash("sha256").update(authMsg).digest());
          if (!verify(resp.pubkey, msgHash, resp.signature)) {
            await this.#refuseAuth(stream, encodeAuthFailed({ type: "relay_auth_failed", reason: "signature_invalid" }), "signature_invalid"); return;
          }

          // DOD-M15-RELAYABUSE-1: the pubkey-keyed check, now that the signature has verified — the
          // caller has just PROVEN ownership of this key, so this bucket cannot be spent on a
          // victim's behalf by anyone who does not hold their private key.
          authedPubkeyHex = Buffer.from(resp.pubkey).toString("hex");
          const pubkeyLimit = this.#authPubkeyLimiter.check(authedPubkeyHex);
          if (!pubkeyLimit.allowed) {
            this.#logger.warn("relay.auth.rate_limited", {
              remotePeerId: remotePeerId ?? "(none)",
              claimedPubkey: truncHex(authedPubkeyHex),
              peerLimited: false,
              pubkeyLimited: true,
              retryAfterMs: pubkeyLimit.retryAfterMs,
              impact: "this auth attempt was refused after a VALID signature — this key has authenticated too often too fast; the caller may retry after the window",
            });
            await this.#refuseAuth(stream, encodeAuthFailed({ type: "relay_auth_failed", reason: "rate_limited", retry_after_ms: pubkeyLimit.retryAfterMs }), "rate_limited"); return;
          }
          /**
           * DOD-M15-RELAYSLOTS-1 — **THE REGISTRATION CHECK.** Everything above this line proves the
           * caller holds the private half of `resp.pubkey`. That is not worth much on its own:
           * generating a keypair is free, so an attacker mints one per reservation slot and takes the
           * whole table while every request looks perfectly well-formed.
           *
           * The fact that separates a registered agent from a minted key lives in the DIRECTORY, and
           * this token is how it gets here — signed by a sovereign directory node when it marked the
           * agent online, bound to that agent's public key, short-lived.
           *
           * Placed HERE, after the signature and before `recordAuthenticated`, for two reasons that
           * are both load-bearing:
           *  - the pubkey the token must name is only trustworthy once the signature has verified, so
           *    checking earlier would be comparing the token against an unverified assertion;
           *  - `recordAuthenticated` is what cancels this peer's reservation-revoke timer, i.e. it is
           *    the act of KEEPING A SLOT. Nothing may reach it without a token.
           */
          const tokenRefusal = this.#checkOnlineToken(resp, authedPubkeyHex, remotePeerId);
          if (tokenRefusal) {
            await this.#refuseAuth(
              stream,
              encodeAuthFailed({ type: "relay_auth_failed", reason: tokenRefusal }),
              tokenRefusal,
            );
            return;
          }

          /**
           * DOD-M15-RELAYSLOTS-1 — attribute the slot, and decide whether this agent may keep it.
           *
           * The token above proved WHO this is. This asks whether they already hold more of this
           * relay's reservation table than one agent may. The ledger reclaims the agent's own idle
           * slots before it consults the cap, so a refusal here means every slot they hold has
           * actually carried traffic.
           *
           * On a refusal the revoke timer is deliberately LEFT RUNNING: the reservation was already
           * granted by the time we got here (it has to be — a relay cannot deny at grant time
           * without stranding every brand-new agent's first reservation), so the grace window is
           * what reclaims it. The caller is told why in the same breath.
           */
          if (remotePeerId) {
            const admission = this.#connectionGater?.admitSlot(remotePeerId, authedPubkeyHex);
            if (admission && !admission.ok) {
              await this.#refuseAuth(
                stream,
                encodeAuthFailed({
                  type: "relay_auth_failed",
                  reason: admission.reason,
                  ...(admission.reason === "slot_cap_exceeded"
                    ? { slots_held: admission.held, slot_cap: admission.cap }
                    : {}),
                }),
                admission.reason,
              );
              return;
            }
          }

          // DOD-M15-RELAYAUTH-1: this proves Ed25519 key POSSESSION, not participation in any
          // session — cancels this peer's reservation-revoke grace timer if one is running (see
          // relay-connection-gater.ts). Does NOT vouch the pubkey; that still requires a real
          // directory-signed assignment (recordAssignment(), below).
          if (remotePeerId) this.#connectionGater?.recordAuthenticated(remotePeerId);

          /**
           * DOD-M15-RELAYAUTH-1 review HIGH-1 — **A RESERVATION PROOF MUST NOT CLAIM THE DELIVERY
           * STREAM.** An agent legitimately runs several nodes against one relay: the node promoted
           * into a live session, plus the replacement standing receiver created behind it. Each
           * holds its OWN circuit reservation, so each must prove possession — but `#streams` is
           * keyed by PUBKEY, so a second full auth from the same agent overwrites the live session's
           * delivery target and its counterparty's leaves start arriving at a node with no handler.
           *
           * So a `purpose: "reservation"` auth stops here: possession is proven (recorded above,
           * which is the whole point), and nothing else is touched — no delivery registration, no
           * liveness flip, no idle-timer reset, no queued-delivery drain, no park notify. The stream
           * is closed rather than kept, because there is nothing further to say on it.
           */
          if (resp.purpose === "reservation") {
            await this.#sendFrame(stream, encodeAuthOk({ type: "relay_auth_ok" }));
            this.#logger.debug("relay.auth.reservation_proof", {
              remotePeerId: remotePeerId ?? "(none)",
              pubkey: truncHex(authedPubkeyHex),
            });
            await stream.close().catch(() => {});
            return;
          }

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

        // Authenticated: process hash_submit and the surviving session frames.
        // (`gap_fill_request` was dispatched here until `DOD-M15-SEALWIRE-1` bullet 7 deleted the
        // PERSIST-014 exchange it belonged to — see the directory-side guard for the deadness proof.)
        const parsed = decodeInboundFrame(frameBytes);
        if (!parsed) {
          /**
           * ⚠️ A REFUSED FRAME MUST NOT VANISH — my own invariant check on `DOD-M15-SEALWIRE-1`'s
           * relay leg, and it is the SAME defect I had just fixed on the directory side.
           *
           * This was a bare `continue`. The new ctrl-only guard refuses a submit that carries content
           * for a `msg` or `doc` leaf — which is a client trying to hand a relay the operator's
           * plaintext, the single thing INV-3 exists to prevent — and that refusal produced no log
           * line, no counter, and no answer to the client. The most security-relevant thing this
           * decoder can say was the thing it said least loudly: nothing.
           *
           * Two audiences, and they need different things. The relay operator needs to know a peer is
           * sending frames this build refuses, and *which*. The client needs to know its submit did
           * not land — it already does, because no `hash_submit_ack` comes back and the submit path
           * treats a missing ack as a failure; what it could not know is why, and that is what
           * `reason` is for when this is escalated to an error frame.
           *
           * WARN, not debug, and the level is the point: unlike the directory's signaling stream —
           * where an unknown frame is an ordinary version skew during a roll — every field on this
           * frame is one this build has always known. A refusal here means a malformed submit or a
           * client attempting something the relay declines to hold, and neither is routine.
           *
           * Best-effort `type`/`leaf_kind` peek: these bytes already failed a strict decode, so it
           * must not throw and must not assert the values mean anything.
           */
          let rawType = "(undecodable)";
          let rawLeafKind: number | null = null;
          let peeked: Record<string, unknown> | null = null;
          try {
            const peek = decode(frameBytes) as Record<string, unknown> | null;
            peeked = peek;
            // SLICED — review H3. `type` is attacker-controlled and cbor-x accepts up to 4 MiB by default, so
            // an authenticated client could otherwise write a multi-megabyte line per refused frame.
            if (peek && typeof peek["type"] === "string") rawType = peek["type"].slice(0, MAX_LOGGED_FRAME_TYPE);
            if (peek && typeof peek["leaf_kind"] === "number") rawLeafKind = peek["leaf_kind"];
          } catch { /* not CBOR, or not an object — "(undecodable)" is the honest answer */ }
          this.#logger.warn("relay.session.frame.refused", {
            rawType,
            leafKind: rawLeafKind,
            clientPubkey: authedPubkeyHex?.slice(0, 16) ?? "unknown",
            impact: "this frame was refused and NOT processed — no leaf was sequenced. A ctrl-only violation (content_bytes on a non-ctrl leaf) lands here: that is a client offering the relay message or document content, which this relay does not accept.",
          });
          /**
           * ⚠️ ANSWER THE CLIENT — review H2, and silence here was actively harmful rather than
           * merely unhelpful.
           *
           * Refusing by sending nothing left the client racing its ack against a 10-second timeout,
           * resolving `relay_submit_timeout`, and then RESETTING THE STREAM — which every session
           * that agent holds on this relay shares. One refused frame therefore stalled a send for ten
           * seconds, dropped every other conversation's stream, and printed a transport word for a
           * deliberate policy decision taken on a different machine under a different operator. And
           * it does not self-correct: the client re-sends the same frame next time.
           *
           * A typed, terminal answer costs one frame and names the cause. Only for a frame that
           * announced itself as a `hash_submit` — anything else is not something this stream's client
           * is waiting on an ack for, and inventing a submit error for it would be its own
           * mislabelling.
           */
          if (rawType === "hash_submit") {
            /**
             * ⚠️ CLASSIFY, DO NOT COLLAPSE — review pass 2, blocking 2.
             *
             * `!parsed` catches EVERY decode failure of a submit — nine distinct conditions — and
             * this replied `content_not_permitted` to all of them. Two of those produced a message
             * that contradicts itself:
             *
             *   - the session-binding case, which is the very check the previous pass added: a ctrl
             *     leaf whose payload names another session was told *"content_bytes is admissible on
             *     ctrl leaves only (0x02); this frame declared leaf_kind 2"* — and leaf kind 2 IS
             *     ctrl. It pointed the author at the one rule they had obeyed and said nothing about
             *     the mismatch actually detected;
             *   - a submit carrying no content at all — a bad signature length, an empty
             *     `structure1_cbor` — was reported as a content-policy violation on a frame with no
             *     content in it.
             *
             * So the reason is decided by whether the frame HAS the field, and the detail names the
             * condition observed rather than the rule that happens to be nearest.
             */
            const carriedContent = peeked !== null && peeked["content_bytes"] !== undefined;
            try {
              /**
               * ⚠️ `await`, AND ITS ABSENCE WAS A REMOTE PROCESS KILL. `#sendFrame` is async, so a
               * synchronous throw inside it becomes a REJECTED PROMISE — which this `catch` cannot
               * see. It was dead code claiming to handle precisely the failure it could not observe,
               * and nothing else handled it either, so Node's default would terminate the relay.
               *
               * That it throws is documented, not inferred: libp2p's `MessageStream.send` throws when
               * the send buffer is full or the stream is closed for writing — both reachable by any
               * authenticated client, by resetting the stream after a refused submit or by flooding
               * refused submits without draining. On a shared relay that is every session on the
               * node, killed by one peer.
               *
               * Every other `#sendFrame` call in this file awaits or attaches a `.catch()`. This one
               * was the anomaly, and lint could not see it: the config uses the non-type-checked
               * preset, which excludes `no-floating-promises`.
               */
              await this.#sendFrame(stream, encodeHashSubmitError({
                type: "hash_submit_error",
                reason: carriedContent ? "content_not_permitted" : "submit_malformed",
                detail: carriedContent
                  ? (rawLeafKind !== null && rawLeafKind !== 0x02
                      ? `content_bytes is admissible on ctrl leaves only (0x02); this frame declared leaf_kind ${rawLeafKind}`
                      : "content_bytes must decode as a SEAL payload for THIS session, and must not exceed the size bound")
                  : "the submit could not be decoded — check session_id (16 bytes), leaf_kind, structure1_cbor and a 64-byte sender_signature",
              }));
            } catch { /* the stream is going away; the WARN above is the durable record */ }
          }
          continue;
        }
        if (parsed.type === "hash_submit") {
          /**
           * DOD-M15-RELAYSLOTS-1: a submit is traffic, and traffic is what marks a slot in use.
           *
           * Recorded HERE, on the relay's own carrying path, because that is the one place that
           * cannot be wrong about it — and it is a sound signal precisely because nothing can be
           * submitted until a directory-signed assignment was presented. Recorded BEFORE the submit
           * is processed, so a submit that is refused downstream still counts: the slot is plainly
           * in use either way, and treating an ambiguous slot as idle is the one direction this
           * unit must never be wrong in.
           */
          if (remotePeerId) this.#connectionGater?.recordActivity(remotePeerId);
          await this.#processHashSubmit(stream, authedPubkeyHex!, parsed, remotePeerId);
        } else if (parsed.type === "session_liveness_query") {
          await this.#processSessionLivenessQuery(stream, authedPubkeyHex!, parsed);
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
   * M7-SESSION-003 AC-002: answer a session_liveness_query over the relay stream.
   * The relay is the session-path liveness authority for relay-mode sessions: it
   * holds the recipient's standing connection. liveness is read straight from the
   * tracked store state — 'alive' iff the standing connection is currently held,
   * 'gone' iff a disconnect was positively observed, 'unknown' iff never tracked.
   * The relay NEVER fabricates 'gone' from a missing entry.
   */
  async #processSessionLivenessQuery(stream: Stream, authedPubkeyHex: string, frame: SessionLivenessQuery): Promise<void> {
    const counterpartyHex = Buffer.from(frame.counterparty_pubkey).toString("hex");
    /**
     * ─── DOD-M15-RELAYAUTH-1: THIS WAS A PRESENCE ORACLE ──────────────────────────────────────
     *
     * The frame carries a `session_id` and this handler **echoed it back without ever reading it**,
     * then answered from `getRecipientLiveness`, which is a GLOBAL lookup by pubkey with no check
     * on who was asking. So any caller authenticated to the relay could ask "is pubkey X alive?"
     * about ANY key and get a real answer with a timestamp.
     *
     * That is not a leak of message content — it is worse in a specific way: with a list of
     * pubkeys and a loop, it builds a live map of **who is active and when**, for people the caller
     * has no relationship with. Traffic analysis without the traffic.
     *
     * Both halves of the DoD bar are enforced here, and the pattern is not new — the identical
     * participant check already guards `client_record_assignment` 500 lines above in this file:
     *   1. the caller must be a named participant of the session it names, and
     *   2. the key it asks about must be the OTHER participant of THAT session.
     *
     * (2) matters as much as (1): without it a legitimate participant of one session could still
     * enumerate everyone else, using a session they really are in as the ticket.
     */
    const sessionIdHex = Buffer.from(frame.session_id).toString("hex");
    const session = this.#store.getSession(sessionIdHex);
    const participants = session
      ? [
          Buffer.from(session.assignment.participant_a).toString("hex"),
          Buffer.from(session.assignment.participant_b).toString("hex"),
        ]
      : [];
    const callerIsParticipant = participants.includes(authedPubkeyHex);
    const subjectIsCounterparty = participants.includes(counterpartyHex) && counterpartyHex !== authedPubkeyHex;
    if (!session || !callerIsParticipant || !subjectIsCounterparty) {
      // REFUSED, and the refusal does not distinguish "no such session" from "not your session" —
      // that difference is itself the enumeration signal this exists to remove.
      this.#logger.warn("relay.liveness.query.refused", {
        sessionId: truncHex(sessionIdHex),
        caller: authedPubkeyHex.slice(0, 16),
        reason: "not_a_participant",
      });
      try {
        await this.#sendFrame(stream, CBOR_ENC.encode({ type: "session_liveness_refused", reason: "not_a_participant" }) as Uint8Array);
      } catch { /* stream going away; the WARN above is the durable record */ }
      return;
    }
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
    frame: import("./relay-types.js").HashSubmit,
    remotePeerId?: string
  ): Promise<void> {
    const sessionKey = Buffer.from(frame.session_id).toString("hex");

    // `detail` carries the UPSTREAM cause when one is known — the directory's own refusal reason,
    // which `rejectSeal` used to discard (review F6). The `reason` names the class; `detail` names
    // what actually happened. `retryAfterMs` rides only for `rate_limited` (DOD-M15-RELAYABUSE-1).
    const reply = async (error: HashSubmitErrorReason, detail?: string, retryAfterMs?: number) => {
      try {
        await this.#sendFrame(
          stream,
          encodeHashSubmitError({
            type: "hash_submit_error",
            reason: error,
            ...(detail ? { detail } : {}),
            ...(retryAfterMs !== undefined ? { retry_after_ms: retryAfterMs } : {}),
          }),
        );
      } catch (err) {
        this.#logger.error("relay.send.failed", {
          event: "hash_submit_error",
          reason: error,
          sessionId: sessionKey,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    };

    // DOD-M15-RELAYABUSE-1: rate-limit BEFORE the idle-timer reset and the per-session lock below —
    // both are per-call work an unthrottled flood would otherwise get for free. Both the sender's
    // AUTHENTICATED pubkey and the Noise-authenticated peer id are trustworthy here (unlike the
    // auth-phase limit, this runs strictly after identity is verified).
    const peerLimit = this.#hashSubmitPeerLimiter.check(remotePeerId);
    const pubkeyLimit = this.#hashSubmitPubkeyLimiter.check(senderPubkeyHex);
    if (!peerLimit.allowed || !pubkeyLimit.allowed) {
      const retryAfterMs = Math.max(peerLimit.retryAfterMs, pubkeyLimit.retryAfterMs);
      this.#logger.warn("relay.hash_submit.rate_limited", {
        remotePeerId: remotePeerId ?? "(none)",
        senderPubkey: truncHex(senderPubkeyHex),
        sessionId: truncHex(sessionKey),
        peerLimited: !peerLimit.allowed,
        pubkeyLimited: !pubkeyLimit.allowed,
        retryAfterMs,
        impact: "this submit was refused before the session lock and store write — the sender keeps its copy and may retry after the window",
      });
      await reply("rate_limited", undefined, retryAfterMs);
      return;
    }

    // M7-SESSION-001: reset idle timer on activity
    this.#resetSessionIdleTimer(sessionKey);

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
    reply: (e: HashSubmitErrorReason, detail?: string) => Promise<void>
  ): Promise<void> {
    const state = this.#store.getSession(sessionKey);
    if (!state) { await reply("session_not_found"); return; }
    if (state.status !== "active") {
      /**
       * SAY WHICH — `DOD-M15-TERMINAL-REASON-1`. This answered `session_sealed` for every non-active
       * status, and it was never true of either one that reaches here: `seal_rejected` is the
       * OPPOSITE of sealed, and `sealing` has not sealed yet. A successfully sealed session does not
       * reach this line at all, because `confirmSeal` destroys it — so success reported as
       * "not found" and refusal reported as "sealed", exactly inverted.
       *
       * The cost is not cosmetic: an operator told their conversation sealed goes looking for a
       * notarized receipt that does not exist, and stops investigating a failure that needs them.
       */
      // The directory's OWN cause rides along when we have it (review F6) — `seal_refused` names
      // that a verdict happened, `detail` names what the verdict was.
      await reply(
        state.status === "seal_rejected" ? "seal_refused" : "seal_in_progress",
        state.status === "seal_rejected" ? state.seal_rejected_reason : undefined,
      );
      return;
    }

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
      const lookup = await this.#directory.getRelayPublicKey(predecessorRelayId);
      if (!lookup.ok) {
        const s1ForLog = decodeStructure1(frame.structure1_cbor);
        const hashHex = s1ForLog ? Buffer.from(s1ForLog.content_hash).toString("hex").slice(0, 16) : "(unknown)";
        if (lookup.reason === "not_registered") {
          // AC-006: the directory answered, and it holds no key for this relay id.
          this.#logger.warn("relay.predecessor.unknown", { relayId: predecessorRelayId, hashHex });
        } else {
          /**
           * DOD-M15-SWEEP-1 re-review item 1: a DIFFERENT event, at error, because this is a
           * different problem. The refusal below is unchanged and still correct — SI-002 forbids
           * accepting an unverified ACK, so failing to reach the directory must still refuse — but
           * an operator seeing only `relay.predecessor.unknown` would go looking for a missing
           * relay registration when the actual fault is that this relay cannot reach its directory,
           * which affects far more than one ACK.
           */
          this.#logger.error("relay.predecessor.lookup_failed", {
            relayId: predecessorRelayId,
            hashHex,
            reason: lookup.reason,
            ...(lookup.error ? { error: lookup.error } : {}),
            impact: "could not ASK the directory for this relay's key, so the predecessor ACK cannot be verified and is refused. " +
              "This is NOT evidence that the relay is unregistered — the directory never answered.",
          });
        }
        await reply("RELAY_PREDECESSOR_UNKNOWN"); return;
      }
      const pubKeyHex = lookup.publicKeyHex;

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

    /**
     * A DECLARED RETRY IS ANSWERED FROM THE RECORD — `DOD-M15-SUBMIT-ID-1`.
     *
     * Before allocating anything. The sender said "this is submission X again", and the signature
     * above proves they said it, so the honest answer is the position X already has — not a new one.
     *
     * Placed after signature verification deliberately: an unsigned or forged frame must never be
     * able to read back another sender's ack. And before the sequence allocation, because
     * allocating and then discarding would still advance the counter, which is the defect.
     *
     * `last_seen_seq_ahead` is checked first and stays first: a retry whose last_seen_seq is beyond
     * what this relay has is a client that has diverged, and that is worth refusing loudly rather
     * than answering from cache.
     */
    const submissionKey = s1.submission_id
      ? `${senderPubkeyHex}:${Buffer.from(s1.submission_id).toString("hex")}`
      : null;
    if (submissionKey) {
      const already = state.issued_acks?.get(submissionKey);
      if (already) {
        this.#logger.info("relay.submit.retransmission", {
          sessionId: sessionKey,
          sequence: already.sequence_number,
          impact:
            "answered from the original ack — the sequence counter and the relay's tree are " +
            "unchanged, so this message still occupies exactly one canonical position",
        });
        try {
          await this.#sendFrame(stream, encodeHashSubmitAck(already));
        } catch (err) {
          this.#logger.error("relay.send.failed", {
            event: "hash_submit_ack_replay",
            seq: already.sequence_number,
            sessionId: sessionKey,
            err: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }
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
      // `DOD-M15-SEALWIRE-1` bullets 3+4: carry the ctrl leaf's SEAL payload into session state, so
      // `submitForSeal` and `getSealLeaves` hand it to the directory. Both build their leaf array by
      // slicing this log, so storing it here is the whole forward leg.
      leaf_log: [...state.leaf_log, { kind: leafKind, s2: s2Result.structure2, structure1_cbor: frame.structure1_cbor, ...(frame.content_bytes ? { content_bytes: frame.content_bytes } : {}) }],
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

    /**
     * RECORD BEFORE SENDING. If the send throws, the position has already been allocated and the
     * leaf is already in the tree — so the retransmission that follows must be answered with THIS
     * ack. Recording after the send would leave the one case the whole unit exists for (an ack that
     * did not arrive) as the one case that is not covered.
     */
    /**
     * DO NOT CACHE AN UNSIGNED ACK — review F4.
     *
     * The signing block above catches its own failure, logs `relay.ack.sign.failed`, and falls
     * through with an UNSIGNED frame. Caching that froze a one-off KMS blip into the record forever:
     * every retransmission of that submission replayed the unsigned ack, so the position became
     * permanently unsignable even after the signer recovered.
     *
     * That is not cosmetic. `evaluateRelayAck` stores NO receipt for an unsigned ack, and receipts
     * are the leaf chain a unilateral seal carries to the directory for an offline rebuild — so that
     * leaf could never enter a unilateral seal. Before this unit a retry would have re-signed and
     * recovered; caching converted a transient degradation into a permanent one.
     *
     * The position is already committed, so re-entering the signing path on a retry is safe and
     * idempotent.
     */
    const ackIsUsable = this.#ackSigningKeyProvider === null || ackFrame.relay_signature !== undefined;
    if (submissionKey && ackIsUsable) {
      // A COPY, not the shared reference (review F5's implementation note): `setSession`
      // shallow-spreads, so mutating in place leaves the mutation applied even if the write below
      // is skipped.
      const acks = new Map(state.issued_acks ?? []);
      acks.set(submissionKey, ackFrame);
      const latest = this.#store.getSession(sessionKey);
      if (latest) this.#store.setSession(sessionKey, { ...latest, issued_acks: acks });
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
        // FULL session id, not truncHex. Every other line here truncates for readability, and that
        // is right for log skimming — but this one is ALERTED on, and an operator holding 8 hex
        // characters cannot run `cello sealed-receipt` or `cello transcript`, which need all 32.
        // A notification whose job is to let someone act must carry enough to act with.
        sessionId: Buffer.from(sessionId).toString("hex"),
        reason: dirResult.reason,
        adjudicator,
        // WHICH directory was being asked. `adjudicator` says broker / configured / redirect, and
        // this says who that resolved to — together they are the first branch of any diagnosis of
        // this failure, and without them the alert announces a problem it cannot narrow.
        brokerPeerId: brokerTarget?.peerId ?? null,
      });
      /**
       * ONLY A VERDICT IS TERMINAL — `DOD-M15-TRANSPORT-TERMINAL-1`.
       *
       * `rejectSeal` sets `seal_rejected`, which is permanent: every later frame for this session is
       * answered `session_sealed`. That is right when a directory examined the seal and refused it,
       * and catastrophic when nobody examined anything — a momentary unreachability would end a
       * healthy conversation and report it to both sides as a completed seal.
       *
       * On the transport branch the session is LEFT ALONE. It stays active, its leaves stay
       * acceptable, and the seal can be attempted again — which is what the participants already
       * believe is happening.
       */
      /**
       * `unknown` — SENT, NO ANSWER. Neither rolled back nor terminalised (review F2).
       *
       * The directory acknowledges only AFTER its full ceremony, so silence may mean it notarized
       * this session and the acknowledgement died on the way home. Rolling back to `active` would
       * let the tree grow past a root the directory has already certified: a retry then seals a
       * LARGER leaf set as R′, both parties hold a receipt for R′, and the directory's only stored
       * notarization is R — with nothing anywhere reconciling them. Terminalising is equally wrong:
       * the seal may have succeeded, and `seal_refused` would tell both parties it did not.
       *
       * So the session stays `sealing`: non-accepting, not terminal, and honest about what is not
       * known. That is the state the OLD code left every transport failure in — correct here, wrong
       * for the case that never reached a directory at all, which is why the two are now separate.
       */
      if (dirResult.kind === "unknown") {
        this.#logger.error("relay.seal.outcome_unknown", {
          sessionId: Buffer.from(sessionId).toString("hex"),
          reason: dirResult.reason,
          adjudicator,
          impact:
            "the seal submission was SENT and no answer came back, so this relay cannot tell whether " +
            "the directory notarized it. The session is left non-accepting rather than reopened — " +
            "reopening could let the tree grow past a root that is already certified.",
          guidance:
            "Ask the directory whether it holds a notarization for this session before doing " +
            "anything else. If it does, the parties already have their receipt and this relay is " +
            "simply behind. If it does not, the seal can be retried.",
        });
        return;
      }

      if (dirResult.kind === "unreachable") {
        /**
         * ROLL THE STATUS BACK TO `active`, or this fix does nothing.
         *
         * `submitForSeal` flips the session to `"sealing"` BEFORE the directory is asked — correct,
         * since it stops a second concurrent seal attempt. But the `hash_submit` guard refuses
         * anything whose status is not `"active"` and answers `session_sealed`, so a session left in
         * `"sealing"` is just as dead as one marked `seal_rejected`, wearing a different word.
         *
         * The first version of this fix skipped `rejectSeal` and stopped there, and the test stayed
         * red for exactly that reason. The seal attempt did not happen — nobody was reached — so the
         * state it set has to be undone with it.
         */
        const sealingKey = Buffer.from(sessionId).toString("hex");
        const sealingState = this.#store.getSession(sealingKey);
        if (sealingState && sealingState.status === "sealing") {
          this.#store.setSession(sealingKey, { ...sealingState, status: "active" });
        }
        this.#logger.warn("relay.seal.deferred", {
          sessionId: Buffer.from(sessionId).toString("hex"),
          reason: dirResult.reason,
          adjudicator,
          brokerPeerId: brokerTarget?.peerId ?? null,
          impact:
            "NO directory adjudicated this seal — the relay could not reach one. The session is left " +
            "ACTIVE and the seal is still pending, rather than being marked permanently rejected: " +
            "there is no verdict to be final about.",
          guidance:
            "Check that a directory is reachable from this relay. The participants will retry; if " +
            "this repeats for every session, the relay's configured directory is down or its " +
            "address is wrong — that is an outage, not a protocol failure.",
        });
        return;
      }
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
      /**
       * DOD-M15-RELAYSLOTS-1: and reclaim reservation slots if the table is under pressure.
       *
       * It rides this sweep rather than getting a timer of its own because the two are the same
       * job at two levels — freeing capacity that nothing is using — and one fewer interval is one
       * fewer thing to remember to stop at shutdown. The reaper is a no-op below the pressure line,
       * so on an ordinary relay this costs a map scan an hour.
       */
      this.#reapSlots();
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
   * DOD-M15-RELAYSLOTS-1 — reclaim idle reservation slots, and **TELL WHOEVER LOST ONE.**
   *
   * The notice is the half that is easy to skip, and skipping it is how "my agent just stopped
   * working" happens: the relay is the only party that knows this occurred, and from the agent's
   * side an unexplained hangup is indistinguishable from the network failing. So every agent that
   * held a reaped slot AND has an authenticated stream here is sent a frame naming the cause and
   * what to do about it.
   *
   * ⚠️ Not every reaped holder has a stream to be told on, and that limit is stated rather than
   * papered over. A bare standing receiver proves its reservation and closes the stream — there is
   * nothing open to write to. For those the hangup IS the signal, and the client's own reservation
   * watchdog rebuilds the receiver; what they lose is the explanation, not the recovery.
   */
  #reapSlots(): void {
    const reaped = this.#connectionGater?.reapIdleSlots() ?? [];
    for (const slot of reaped) {
      for (const agentHex of slot.agents) {
        const stream = this.#streams.get(agentHex);
        if (!stream) continue;
        void this.#sendFrame(stream, CBOR_ENC.encode({
          type: "relay_slot_reclaimed",
          reason: "idle_capacity_reclaimed",
          idle_ms: slot.idleMs,
          detail: "This relay reclaimed your circuit reservation to free capacity. It had carried " +
            "no traffic for longer than the relay's activity floor. Your agent stays online — " +
            "reconnect to this relay, or start a new session, and a fresh reservation is taken.",
        }) as Uint8Array).catch(() => { /* the peer is going away; the reap log is the durable record */ });
      }
    }
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
  /**
   * DOD-M15-RELAYSLOTS-1: how many LIVE sessions this relay currently holds between these two
   * identities. The intersection of the two participants' live session sets — the same tracking
   * `#cleanupSessionTracking` tears down, so a sealed or swept session stops counting immediately.
   */
  #concurrentSessionsBetween(aHex: string, bHex: string): number {
    const a = this.#participantSessions.get(aHex);
    const b = this.#participantSessions.get(bHex);
    if (!a || !b) return 0;
    // Iterate the smaller set — a relay carrying a busy agent should not pay for that here.
    const [small, large] = a.size <= b.size ? [a, b] : [b, a];
    let n = 0;
    for (const sessionIdHex of small) {
      if (large.has(sessionIdHex)) n++;
    }
    return n;
  }

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
    // DOD-M15-RELAYAUTH-1: keep the dial-through gate's own copy in lockstep — a torn-down
    // session no longer authorizes a circuit dial between its two peer ids.
    this.#connectionGater?.removeSessionBinding(sessionIdHex);

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
  /** See `RelayNodeOptions.directoryPubkey` — absent means this relay can verify nothing and refuses. */
  directoryPubkey?: Uint8Array;
  /** DOD-M15-RELAYABUSE-1: per-depositor park-deposit rate limit. Forwarded to the park handler. */
  depositRateLimit?: DepositRateLimitConfig;
  /** DOD-M15-RELAYABUSE-1: per-peer AND per-claimed-pubkey relay-authentication rate limit. */
  authRateLimit?: DepositRateLimitConfig;
  /** DOD-M15-RELAYABUSE-1: per-peer AND per-authenticated-pubkey hash_submit rate limit. */
  hashSubmitRateLimit?: DepositRateLimitConfig;
  /**
   * DOD-M15-RELAYABUSE-1: cap on how long a single relayed (circuit-relay) connection may stay
   * open. Defaults to `DEFAULT_CIRCUIT_DURATION_LIMIT_MS` (7 days) — see that constant for why.
   */
  circuitDurationLimitMs?: number;
  /**
   * DOD-M15-RELAYABUSE-1: cap on how many bytes a single relayed connection may carry.
   * Defaults to `DEFAULT_CIRCUIT_DATA_LIMIT_BYTES` (1 GiB) — see that constant for why.
   */
  circuitDataLimitBytes?: bigint;
  /**
   * DOD-M15-RELAYAUTH-1: override the connection gater entirely (mainly for tests that need to
   * inspect its state directly, e.g. `pendingRevokeCount()`). Normal callers should leave this
   * unset and use `reservationGraceMs` to tune the one thing worth tuning.
   */
  connectionGater?: RelayConnectionGater;
  /** DOD-M15-RELAYAUTH-1: see `DEFAULT_RESERVATION_GRACE_MS` in relay-connection-gater.ts. */
  reservationGraceMs?: number;
  /** DOD-M15-RELAYSLOTS-1: see `SLOT_CAP_PER_AGENT` in relay-connection-gater.ts. */
  slotCapPerAgent?: number;
  /** DOD-M15-RELAYSLOTS-1: see `SESSION_CAP_PER_PAIR`. */
  sessionCapPerPair?: number;
  /** DOD-M15-RELAYAUTH-1 review H2: durable vouching — see `RelayNodeOptions.vouchedKeyStore`. */
  vouchedKeyStore?: VouchedKeyStore;
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
  // DOD-M15-RELAYAUTH-1: the gater must exist BEFORE createNode() (circuit-relay-v2's server
  // component requires a connectionGater in its DI graph) but needs a live `node` reference to
  // revoke a connection — see `attachNode` below and the class header for the full design.
  const relayLogger = opts.logger ?? { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
  const connectionGater = opts.connectionGater ?? new RelayConnectionGater({
    logger: relayLogger,
    reservationGraceMs: opts.reservationGraceMs,
    slotCapPerAgent: opts.slotCapPerAgent,
  });
  const node = await createNode({
    keyProvider,
    listenAddresses: opts.listenAddresses ?? ["/ip4/127.0.0.1/tcp/0"],
    transportPrivateKey: opts.transportPrivateKey,
    connectionGater,
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
    //   * applyDefaultLimit: true — relayed connections were capped at 2 minutes and
    //     128 KiB. That is fatal for the case that matters most: where the hole punch
    //     FAILS (symmetric NAT, strict corporate firewall) the relayed connection is not
    //     a fallback, it IS the session, and it must last as long as the conversation.
    //
    // For a relay whose entire job is carrying CELLO sessions, libp2p's toy-scale defaults were
    // wrong on both counts. maxReservations stays raised. The duration/data limit is DOD-M15-
    // RELAYABUSE-1's item 3, "restore the caps" — not the 2-min/128-KiB values (those would
    // reopen this exact defect), but a CELLO-sized cap: see DEFAULT_CIRCUIT_DURATION_LIMIT_MS /
    // DEFAULT_CIRCUIT_DATA_LIMIT_BYTES for the reasoning. An unbounded relayed connection is an
    // open door with no closing time — a circuit nobody is using for a real session can otherwise
    // sit on this relay forever.
    relayServer: {
      enabled: true,
      reservations: {
        // DOD-M15-RELAYSLOTS-1: ONE source for this number. The reaper's pressure line is a
        // fraction of the ceiling, so a ceiling that drifted from what libp2p actually enforces
        // would give a reaper that either never fires or fires constantly — and both look like the
        // reaper working.
        maxReservations: DEFAULT_SLOT_CEILING,
        applyDefaultLimit: true,
        defaultDurationLimit: opts.circuitDurationLimitMs ?? DEFAULT_CIRCUIT_DURATION_LIMIT_MS,
        defaultDataLimit: opts.circuitDataLimitBytes ?? DEFAULT_CIRCUIT_DATA_LIMIT_BYTES,
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
  connectionGater.attachNode(node);

  const relay = new CelloRelayNode({
    node,
    connectionGater,
    directoryPubkey: opts.directoryPubkey,
    sessionCapPerPair: opts.sessionCapPerPair,
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
    ...(opts.vouchedKeyStore ? { vouchedKeyStore: opts.vouchedKeyStore } : {}),
    ...(opts.depositRateLimit ? { depositRateLimit: opts.depositRateLimit } : {}),
    ...(opts.authRateLimit ? { authRateLimit: opts.authRateLimit } : {}),
    ...(opts.hashSubmitRateLimit ? { hashSubmitRateLimit: opts.hashSubmitRateLimit } : {}),
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
      // Review L1: the gater's pending-revoke timers were the one set of handles this shutdown did
      // NOT clear, so a stopped relay could still be held open by them for up to the grace window.
      connectionGater.stop();
      await node.stop();
    },
  };
}
