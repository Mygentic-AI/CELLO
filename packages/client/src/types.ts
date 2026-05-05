/**
 * @cello/client — types.ts
 *
 * Public types for the CelloClient (MSG-002, SESSION-002).
 */

// ─── Session types (SESSION-002) ──────────────────────────────────────────────

export type SessionStatus = "active" | "transport_lost" | "sealing" | "sealed";

export interface SessionRecord {
  session_id: Uint8Array;
  counterparty_pubkey: Uint8Array;
  counterparty_peer_id: string;
  counterparty_multiaddrs: string[];
  relay_endpoint: { peer_id: string; multiaddrs: string[] };
  genesis_prev_root: Uint8Array;
  last_seen_seq: number;
  status: SessionStatus;
}

/**
 * Result of receiveSessionAssignment().
 *
 * Failure reasons:
 *   directory_signature_invalid — Ed25519 verify failed; assignment discarded before any I/O.
 *   relay_auth_failed           — relay explicitly rejected the auth response (signature_invalid etc.).
 *   relay_auth_error            — could not open a stream to the relay or read the challenge.
 *   dial_counterparty_failed    — reserved for future use. Currently the counterparty dial is
 *                                 best-effort (soft failure): if the counterparty is not yet
 *                                 listening on /cello/content/1.0.0 the session is still stored
 *                                 as active and ok:true is returned. This variant will be returned
 *                                 once strict dial is required (e.g. when the session cannot
 *                                 proceed without a confirmed content channel).
 */
export type ReceiveAssignmentResult =
  | { ok: true; sessionId: Uint8Array }
  | { ok: false; reason: "directory_signature_invalid" | "relay_auth_failed" | "relay_auth_error" | "dial_counterparty_failed" };

// ─── Peer registry ───────────────────────────────────────────────────────────

export interface PeerEntry {
  /** libp2p transport Peer ID string */
  peerId: string;
  /** multiaddrs for this peer */
  multiaddrs: string[];
  /** whether a live connection exists */
  connected: boolean;
}

// ─── Send result ─────────────────────────────────────────────────────────────

export type SendFailureReason =
  | "peer_not_connected"
  | "content_too_large"
  | "peer_unreachable"
  | "remote_rejected"
  | "connection_lost"
  | "transport_not_started";

export type SendResult =
  | { delivered: true; contentHash: string }
  | { delivered: false; reason: SendFailureReason };

// ─── Received envelope ───────────────────────────────────────────────────────

export interface ReceivedEnvelope {
  content: Uint8Array;
  senderPubkey: Uint8Array;
  contentHash: Uint8Array;
  timestamp: number;
}

// ─── CelloClient interface ────────────────────────────────────────────────────

export interface CelloClient {
  /**
   * Register a peer in the local registry.
   * Called by MCP-001 cello_connect_peer after dialing succeeds.
   */
  addPeer(peerPubkeyHex: string, peerId: string, multiaddrs: string[]): void;

  /**
   * Send content to the peer identified by their K_local pubkey hex.
   * Resolves with the delivery outcome — never throws.
   */
  send(peerPubkeyHex: string, content: Uint8Array): Promise<SendResult>;

  /**
   * Register the inbound stream handler on the node.
   * Must be called once after node.start().
   */
  registerHandler(): Promise<void>;

  /**
   * Dequeue the oldest received envelope from a given sender.
   * Returns null if the queue is empty.
   */
  receive(senderPubkeyHex: string): ReceivedEnvelope | null;

  /**
   * Return all queued envelopes (in arrival order) regardless of sender.
   * Non-destructive — items remain in the queue until receive() drains them.
   */
  peekAll(): Array<{ senderPubkeyHex: string; envelope: ReceivedEnvelope }>;

  /**
   * Process an inbound SessionAssignment pushed by the directory.
   * Verifies the directory signature, computes genesis prev_root, dials the relay
   * on /cello/relay/1.0.0, authenticates, dials the counterparty on /cello/content/1.0.0,
   * and stores the session record.
   * Resolves with ok:true and the session_id on success, ok:false with a reason on failure.
   * SESSION-002 AC-002, AC-003, AC-004, AC-005, SI-003.
   */
  receiveSessionAssignment(
    assignment: import("@cello/directory").SessionAssignment,
    myPubkey: Uint8Array,
  ): Promise<ReceiveAssignmentResult>;

  /**
   * Return all currently known session records.
   * SESSION-002 AC-004.
   */
  listSessions(): SessionRecord[];
}
