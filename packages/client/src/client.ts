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
 *   1. Build TBS = CBOR([session_id, participant_a.pubkey, participant_b.pubkey, session_timestamp])
 *   2. Verify Ed25519(TBS, assignment.directory_pubkey, assignment.directory_signature)
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
  computeGenesisPrevRoot,
} from "@cello/protocol-types";
import type { Structure2 } from "@cello/protocol-types";
import { verify, buildMerkleTree, merkleRoot } from "@cello/crypto";
import type { LeafInput } from "@cello/crypto";
import { CELLO_PROTOCOL_ID, CELLO_CONTENT_PROTOCOL_ID } from "@cello/transport";
import type { KeyProvider } from "@cello/crypto";
import type { CelloNode } from "@cello/transport";
import type { Stream } from "@libp2p/interface";
import type { SessionAssignment } from "@cello/protocol-types";
import type {
  CelloClient, PeerEntry, ReceivedEnvelope, SendResult, SessionRecord,
  ReceiveAssignmentResult, ReceivedMessage, SendMessageResult,
} from "./types.js";

const RELAY_PROTOCOL_ID = "/cello/relay/1.0.0";
const AUTH_DOMAIN = "CELLO-RELAY-AUTH-v1";
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

const CONTENT_GRACE_MS = 30_000;
const PENDING_CONTENT_BOUND = 256;

// ─── CelloClientImpl ─────────────────────────────────────────────────────────

class CelloClientImpl implements CelloClient {
  readonly #node: CelloNode;
  readonly #keyProvider: KeyProvider;
  #myPubkeyHex: string | null = null;

  // peer_pubkey_hex → PeerEntry
  readonly #peers = new Map<string, PeerEntry>();

  // sender_pubkey_hex → FIFO queue of received envelopes
  readonly #receiveQueues = new Map<string, ReceivedEnvelope[]>();

  // ordered arrival list for peekAll()
  readonly #arrivalLog: Array<{ senderPubkeyHex: string; envelope: ReceivedEnvelope }> = [];

  // Optional callback invoked after each successful inbound enqueue
  readonly #onMessageQueued: ((senderPubkeyHex: string) => void) | undefined;

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

  constructor(node: CelloNode, keyProvider: KeyProvider, onMessageQueued?: (senderPubkeyHex: string) => void) {
    this.#node = node;
    this.#keyProvider = keyProvider;
    this.#onMessageQueued = onMessageQueued;
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
    // Step 1: Build TBS and verify directory signature (AC-005, SI-003)
    // TBS = canonical CBOR([session_id, participant_a.pubkey, participant_b.pubkey, session_timestamp])
    // Matches directory-node.ts sign path exactly.
    const { session_id, session_timestamp } = assignment;
    const pubA = assignment.participant_a.pubkey;
    const pubB = assignment.participant_b.pubkey;

    const tbs = CBOR_ENC.encode([
      session_id,
      pubA,
      pubB,
      session_timestamp > 0xffffffff ? BigInt(session_timestamp) : session_timestamp,
    ]) as Uint8Array;

    if (!verify(assignment.directory_pubkey, tbs, assignment.directory_signature)) {
      return { ok: false, reason: "directory_signature_invalid" };
    }

    // Step 2: Determine counterparty
    const myPubkeyHex = Buffer.from(myPubkey).toString("hex");
    const pubAHex = Buffer.from(pubA).toString("hex");
    const counterparty = myPubkeyHex === pubAHex ? assignment.participant_b : assignment.participant_a;

    // Step 3: Compute genesis prev_root (AC-002)
    // SHA-256(min(pubA, pubB) || max(pubA, pubB) || session_id || timestamp_be8) per FIPS 180-4
    const genesis_prev_root = computeGenesisPrevRoot(pubA, pubB, session_id, session_timestamp);

    // Step 4: Register content protocol handler on this node (if not already registered)
    if (!this.#contentHandlerRegistered) {
      await this.#node.handle(CELLO_CONTENT_PROTOCOL_ID, (stream) => {
        void this.#handleContentStream(stream);
      });
      this.#contentHandlerRegistered = true;
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
      genesis_prev_root,
      last_seen_seq: 0,
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

  closeSession(sessionIdHex: string): void {
    this.#sessions.delete(sessionIdHex);
    this.#relayRecvSeq.delete(sessionIdHex);
    this.#readyQueue.delete(sessionIdHex);
    this.#pendingS2.delete(sessionIdHex);
    this.#pendingContent.delete(sessionIdHex);
    this.#ownPendingContent.delete(sessionIdHex);
    this.#tamperedContentClaims.delete(sessionIdHex);
    this.#ownEchoResolvers.delete(sessionIdHex);
    this.#sessionMessageQueues.delete(sessionIdHex);
    this.#outboundQueues.delete(sessionIdHex);
    const stream = this.#relayStreams.get(sessionIdHex);
    if (stream) {
      this.#relayStreams.delete(sessionIdHex);
      stream.abort(new Error("session_closed"));
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
          this.#handleInboundLeafDeliver(sessionIdHex, frame, myPubkeyHex);
        }
      }
    } catch {
      // Stream closed — relay disconnected (DB-001)
    }

    // Relay stream disconnected: mark relay stream null so sendMessage returns transport_unavailable
    if (this.#relayStreams.get(sessionIdHex) === stream) {
      this.#relayStreams.delete(sessionIdHex);
    }

    // Unblock any waiting sendMessage calls
    const ackResolve = this.#pendingAckResolvers.get(sessionIdHex);
    if (ackResolve) {
      this.#pendingAckResolvers.delete(sessionIdHex);
      ackResolve({ ok: false, reason: "transport_unavailable" });
    }
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
      }, CONTENT_GRACE_MS);

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

      // Causal chain check per SI-004: sender's claimed last_seen_seq can't exceed B's
      // highest confirmed global relay seq (session.last_seen_seq). Both represent the
      // same global counter; at this point session.last_seen_seq == local_tree_leaves.length.
      if (s1_fields.last_seen_seq > session.last_seen_seq) {
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

      // last_seen_seq tracks the highest global relay seq confirmed on this session.
      // Per SI-003: TBS last_seen_seq must equal the highest relay seq received, not
      // only own-send echoes. Updated for every confirmed leaf (own-send and counterparty).
      session.last_seen_seq = s2.sequence_number;

      if (is_own_send) {
        // Own-send echo: fire the send lock release.
        // Do NOT enqueue into receiveMessage queues — callers don't "receive" their own sends.
        echo_resolve?.();
      } else {
        // Counterparty message: enqueue for receiveMessage callers.
        const msg: ReceivedMessage = {
          content: content_bytes,
          senderPubkey: s2.sender_pubkey,
          sequenceNumber: s2.sequence_number,
          leafHash,
        };
        this.#sessionMessageQueues.get(sessionIdHex)?.push(msg);
        this.#anyMessageQueue.push({ sessionIdHex, message: msg });
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

    // Verify internal consistency: recompute content_hash
    const recomputed = new Uint8Array(
      createHash("sha256").update(new Uint8Array([0x00])).update(contentBytes).digest()
    );
    const declaredHashRaw = frame["content_hash"];
    const declaredHash = declaredHashRaw instanceof Uint8Array ? declaredHashRaw
      : Buffer.isBuffer(declaredHashRaw) ? new Uint8Array(declaredHashRaw as Buffer) : null;

    if (!declaredHash || Buffer.compare(Buffer.from(recomputed), Buffer.from(declaredHash)) !== 0) {
      // Frame internally inconsistent: declared_hash != SHA-256(0x00 || content_bytes).
      if (declaredHash) {
        const declaredHashHex = Buffer.from(declaredHash).toString("hex");
        const ps2Map = this.#pendingS2.get(sessionIdHex);
        if (ps2Map?.has(declaredHashHex)) {
          // S2 already buffered and this tampered content arrived after — desync immediately.
          const entry = ps2Map.get(declaredHashHex)!;
          clearTimeout(entry.timer_handle);
          ps2Map.delete(declaredHashHex);
          this.#desync(sessionIdHex, "content_hash_mismatch");
        } else {
          // S2 not yet arrived — remember the tampered claim so S2 can desync on arrival.
          this.#tamperedContentClaims.get(sessionIdHex)?.add(declaredHashHex);
        }
      }
      stream.close().catch(() => {});
      return;
    }

    const contentHashHex = Buffer.from(recomputed).toString("hex");

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
   * On success, relay stays silent (waiting for hash_submit frames).
   * We check for failure with a short 200ms window; timeout = success.
   *
   * KNOWN M1 LIMITATION — 200ms window fragility: if the host is under heavy CPU load
   * the relay may not send relay_auth_failed within 200ms. Long-term fix: add relay_auth_ok.
   */
  async #performRelayAuth(
    stream: Stream,
    myPubkey: Uint8Array,
  ): Promise<{ ok: true; iter: AsyncIterator<Uint8Array> } | { ok: false; reason: "relay_auth_failed" | "relay_auth_error" }> {
    // Create exactly ONE iterator for this stream's lifetime — never create a second one.
    const iter = (lp.decode(stream) as AsyncIterable<unknown>)[Symbol.asyncIterator]() as AsyncIterator<Uint8Array>;

    // Read challenge frame
    const { value: challengeRaw, done } = await iter.next();
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

    // Start a SINGLE pending next() to detect relay_auth_failed.
    // We must not call iter.next() a second time until this resolves (would be concurrent).
    const pendingNext = iter.next();

    type FrameResult =
      | { kind: "frame"; bytes: Uint8Array }
      | { kind: "done" }
      | { kind: "error" }
      | { kind: "timeout" };

    const frameRace = pendingNext.then(
      ({ value, done: d }): FrameResult => {
        if (d || value === undefined) return { kind: "done" };
        return { kind: "frame", bytes: toU8(value) };
      },
      (): FrameResult => ({ kind: "error" }),
    );
    const timerRace = new Promise<FrameResult>((resolve) => {
      setTimeout(() => resolve({ kind: "timeout" }), 200);
    });

    const result = await Promise.race([frameRace, timerRace]);

    if (result.kind === "error") {
      // Stream reset/aborted — auth rejected
      return { ok: false, reason: "relay_auth_failed" };
    }

    if (result.kind === "done") {
      // Stream ended cleanly after response — treat as success
      return { ok: true, iter };
    }

    if (result.kind === "frame") {
      // A frame arrived before timeout
      let nextFrame: Record<string, unknown>;
      try {
        nextFrame = decode(result.bytes) as Record<string, unknown>;
      } catch {
        return { ok: false, reason: "relay_auth_error" };
      }
      if (nextFrame["type"] === "relay_auth_failed") {
        return { ok: false, reason: "relay_auth_failed" };
      }
      // Non-failure frame arrived early (unexpected but not fatal).
      // Wrap iter to prepend the consumed frame so #runRelayStreamReader sees it.
      return { ok: true, iter: makePrependedIter(result.bytes, iter) };
    }

    // result.kind === "timeout": pendingNext is still in flight.
    // Wrap iter so the reader awaits the pending promise first, then continues from iter.
    // This ensures exactly one outstanding next() call at any time.
    return { ok: true, iter: makeAwaitPendingIter(pendingNext, iter) };
  }

  // ─── MSG-002 handlers ─────────────────────────────────────────────────────────

  async registerHandler(): Promise<void> {
    await this.#node.handle(CELLO_PROTOCOL_ID, (stream) => {
      void this.#handleInbound(stream);
    });
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
}

// ─── Stream iterator helpers ──────────────────────────────────────────────────

/**
 * Returns an AsyncIterator that yields `first` then delegates to `rest`.
 * Used when a non-failure frame was consumed during the auth window.
 */
function makePrependedIter(first: Uint8Array, rest: AsyncIterator<Uint8Array>): AsyncIterator<Uint8Array> {
  let yielded = false;
  return {
    next(): Promise<IteratorResult<Uint8Array>> {
      if (!yielded) {
        yielded = true;
        return Promise.resolve({ value: first, done: false });
      }
      return rest.next();
    },
    return: rest.return?.bind(rest),
    throw: rest.throw?.bind(rest),
  };
}

/**
 * Returns an AsyncIterator that awaits `pending` (one in-flight next() call from auth),
 * yields its result, then delegates to `rest`.
 * Used when the 200ms auth window timed out with a pending iter.next() still outstanding.
 */
function makeAwaitPendingIter(
  pending: Promise<IteratorResult<Uint8Array>>,
  rest: AsyncIterator<Uint8Array>,
): AsyncIterator<Uint8Array> {
  let pendingConsumed = false;
  return {
    async next(): Promise<IteratorResult<Uint8Array>> {
      if (!pendingConsumed) {
        pendingConsumed = true;
        return pending;
      }
      return rest.next();
    },
    return: rest.return?.bind(rest),
    throw: rest.throw?.bind(rest),
  };
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createClient(
  node: CelloNode,
  keyProvider: KeyProvider,
  opts?: { onMessageQueued?: (senderPubkeyHex: string) => void }
): CelloClient & {
  sendRaw(peerPubkeyHex: string, bytes: Uint8Array): Promise<SendResult>;
  openRawStream(peerPubkeyHex: string): Promise<Stream>;
  openContentStreamByPeerId(peerId: string): Promise<Stream>;
} {
  return new CelloClientImpl(node, keyProvider, opts?.onMessageQueued);
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
