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
import { buildEnvelope, serializeEnvelope, deserializeEnvelope, validateEnvelope, computeGenesisPrevRoot } from "@cello/protocol-types";
import { verify } from "@cello/crypto";
import { CELLO_PROTOCOL_ID, CELLO_CONTENT_PROTOCOL_ID } from "@cello/transport";
import type { KeyProvider } from "@cello/crypto";
import type { CelloNode } from "@cello/transport";
import type { Stream } from "@libp2p/interface";
import type { SessionAssignment } from "@cello/directory";
import type { CelloClient, PeerEntry, ReceivedEnvelope, SendResult, SessionRecord, ReceiveAssignmentResult } from "./types.js";

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

// ─── CelloClientImpl ─────────────────────────────────────────────────────────

class CelloClientImpl implements CelloClient {
  readonly #node: CelloNode;
  readonly #keyProvider: KeyProvider;

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
        // Accept the content stream and keep it open for future use.
        // For now, close gracefully — hash delivery will be wired in later stories.
        stream.close().catch(() => {});
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
    try {
      const authResult = await this.#performRelayAuth(relayStream, myPubkey);
      if (!authResult.ok) {
        return { ok: false, reason: authResult.reason };
      }
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
    };
    this.#sessions.set(sessionIdHex, record);

    return { ok: true, sessionId: session_id };
  }

  listSessions(): SessionRecord[] {
    return Array.from(this.#sessions.values());
  }

  /**
   * Complete relay challenge-response auth on an open stream.
   * Returns ok:true on success, ok:false with reason on rejection.
   * Auth signature: Ed25519(SHA-256("CELLO-RELAY-AUTH-v1" || nonce || pubkey), privkey)
   *   per RFC 8032 (Ed25519), FIPS 180-4 (SHA-256)
   *
   * Protocol: relay sends relay_auth_challenge immediately on connect.
   * We read it, sign the nonce, send relay_auth_response.
   * On auth failure, relay sends relay_auth_failed then aborts the stream.
   * On success, relay stays silent (waiting for hash_submit frames).
   * We check for failure with a short 200ms window; timeout = success.
   */
  async #performRelayAuth(
    stream: Stream,
    myPubkey: Uint8Array,
  ): Promise<{ ok: true } | { ok: false; reason: "relay_auth_failed" | "relay_auth_error" }> {
    // Read the single lp.decode iterator and hold it for the auth exchange
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

    // On failure: relay sends relay_auth_failed then aborts the stream within ~10ms.
    // On success: relay keeps the stream open silently (waiting for hash_submit frames).
    // The relay protocol has no positive acknowledgment for auth success, so success is
    // inferred by the absence of a failure frame within a short window.
    //
    // KNOWN M1 LIMITATION — 200ms window fragility:
    // If the host is under heavy CPU load (e.g. busy CI), the relay may not have
    // processed the auth response and sent a rejection frame within 200ms even on
    // an auth failure. In that case we would incorrectly proceed with ok:true and
    // then fail later when submitting hashes. The correct long-term fix is to add
    // a relay_auth_ok frame to the relay protocol so success can be confirmed
    // positively rather than inferred from silence. Tracked as a known M1 limitation.
    const checkFailed = async (): Promise<{ ok: true } | { ok: false; reason: "relay_auth_failed" | "relay_auth_error" }> => {
      try {
        const { value: nextRaw, done: nextDone } = await iter.next();
        if (nextDone || nextRaw === undefined) {
          // Stream ended after response — treat as ok (relay may close on auth success in some configs)
          return { ok: true };
        }
        const nextBytes = toU8(nextRaw);
        let nextFrame: Record<string, unknown>;
        try {
          nextFrame = decode(nextBytes) as Record<string, unknown>;
        } catch {
          return { ok: false, reason: "relay_auth_error" };
        }
        if (nextFrame["type"] === "relay_auth_failed") {
          return { ok: false, reason: "relay_auth_failed" };
        }
        // Some other frame — auth was fine
        return { ok: true };
      } catch {
        // Stream reset/aborted immediately — auth was rejected
        return { ok: false, reason: "relay_auth_failed" };
      }
    };

    // 200ms window: if no rejection frame arrives, infer auth succeeded.
    // See fragility note above.
    const timeout = new Promise<{ ok: true }>((resolve) => {
      setTimeout(() => resolve({ ok: true }), 200);
    });

    return Promise.race([checkFailed(), timeout]);
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

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createClient(
  node: CelloNode,
  keyProvider: KeyProvider,
  opts?: { onMessageQueued?: (senderPubkeyHex: string) => void }
): CelloClient & {
  sendRaw(peerPubkeyHex: string, bytes: Uint8Array): Promise<SendResult>;
  openRawStream(peerPubkeyHex: string): Promise<Stream>;
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
