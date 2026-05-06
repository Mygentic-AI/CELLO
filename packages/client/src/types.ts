/**
 * @cello/client — types.ts
 *
 * Public types for the CelloClient (MSG-002, SESSION-002, MSG-004).
 */

// ─── Session types (SESSION-002) ──────────────────────────────────────────────

export type SessionStatus = "active" | "transport_lost" | "sealing" | "sealed" | "seal_rejected" | "seal_deferred";

export interface SessionRecord {
  session_id: Uint8Array;
  counterparty_pubkey: Uint8Array;
  counterparty_peer_id: string;
  counterparty_multiaddrs: string[];
  relay_endpoint: { peer_id: string; multiaddrs: string[] };
  directory_endpoint: { peer_id: string; multiaddrs: string[] };
  directory_pubkey: Uint8Array;
  genesis_prev_root: Uint8Array;
  /**
   * MSG-004: highest global relay sequence_number of *counterparty* leaves confirmed on this session.
   * Used as `last_seen_seq` in the next outbound Structure 1 TBS.
   * Updated only when a counterparty leaf is confirmed (never on own-send echoes).
   * Starts at 0 (no counterparty messages confirmed yet).
   */
  last_seen_seq: number;

  /**
   * MSG-004: highest global relay sequence_number of *own* leaves echoed back.
   * Used by the client-side causal-chain check: incoming last_seen_seq must be <= this.
   * Updated only when own-send echoes are confirmed.
   * Starts at 0.
   */
  last_sent_seq: number;
  status: SessionStatus;

  /** Sealed root after seal completes. SESSION-003. */
  sealed_root?: Uint8Array;

  /** Directory-identity signature over the SealNotarization. SESSION-003. MCP-002 AC-004. */
  directory_signature?: Uint8Array;

  /** Unix timestamp (ms) when the seal was confirmed. SESSION-003. MCP-002 AC-004. */
  close_timestamp?: number;

  // ─── MSG-004 additions ────────────────────────────────────────────────────

  /** Ordered list of accepted leaves; used to recompute prev_root locally. MSG-004. */
  local_tree_leaves: Array<{ kind: "msg" | "ctrl"; s2_cbor: Uint8Array }>;

  /** Next expected sequence number from the relay (starts at 1). MSG-004. */
  next_expected_seq: number;

  /** Fail-closed flag. Once true all send/receive return session_desynchronized. MSG-004. */
  desynchronized: boolean;
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

// ─── Send result (M0 path) ───────────────────────────────────────────────────

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

// ─── MSG-004: session message types ──────────────────────────────────────────

/** A cross-checked, verified message delivered from a session. MSG-004. */
export interface ReceivedMessage {
  content: Uint8Array;
  senderPubkey: Uint8Array;
  sequenceNumber: number;
  /** SHA-256(leaf_kind_byte || structure2_cbor) per MERKLE-001 (RFC 6962). */
  leafHash: Uint8Array;
}

export type SendMessageFailureReason =
  | "session_not_found"
  | "session_desynchronized"
  | "session_sealed"
  | "transport_unavailable"
  | "relay_rejected"
  | "content_path_failed";

export type SendMessageResult =
  | { ok: true }
  | { ok: false; reason: SendMessageFailureReason };

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
    assignment: import("@cello/protocol-types").SessionAssignment,
    myPubkey: Uint8Array,
  ): Promise<ReceiveAssignmentResult>;

  /**
   * Return all currently known session records.
   * SESSION-002 AC-004.
   */
  listSessions(): SessionRecord[];

  // ─── MSG-004: session message send/receive ──────────────────────────────

  /**
   * Send content on an active session using the dual-path protocol:
   * hash on /cello/relay/1.0.0 and content on /cello/content/1.0.0.
   * Serializes sends per session; the next send is not constructed until
   * the relay has echoed back our own Structure 2 leaf_deliver.
   * Never throws — returns SendMessageResult.
   * MSG-004.
   */
  sendMessage(sessionIdHex: string, content: Uint8Array): Promise<SendMessageResult>;

  /**
   * Dequeue the oldest verified ReceivedMessage for the given session.
   * Returns null if the queue is empty. MSG-004.
   */
  receiveMessage(sessionIdHex: string): ReceivedMessage | null;

  /**
   * Dequeue the oldest verified ReceivedMessage from any session (FIFO arrival order).
   * Returns null if all queues are empty. MSG-004.
   */
  receiveAnyMessage(): { sessionIdHex: string; message: ReceivedMessage } | null;

  /**
   * Initiate the bilateral SEAL ceremony. Constructs and submits the initiator SEAL
   * ctrl leaf, transitions session to `sealing`. SESSION-003.
   * Returns ok:false if the session is not active, already sealing/sealed, or if the
   * relay submit fails.
   */
  initiateSessionSeal(sessionIdHex: string): Promise<{ ok: true } | { ok: false; reason: string }>;

  /**
   * Close and remove a session record. Call after a desynchronized or sealed session
   * can no longer be used. Idempotent — no-op if the session does not exist. MSG-004.
   */
  closeSession(sessionIdHex: string): void;

  /**
   * Register a handler that fires when a `session_assignment` frame arrives for an
   * inbound session (one where this client is participant B — the session was initiated
   * by a remote peer). The MCP server uses this to populate its inbound session queue
   * so `cello_await_session` can return the new session to the agent.
   *
   * The handler receives a rich event with all session fields pre-encoded as hex strings
   * so the MCP layer does not need to re-encode them.
   * Multiple calls to onSessionAssignment replace the previous handler (last-writer wins).
   * CELLO-MCP-002.
   */
  onSessionAssignment(handler: (event: SessionAssignmentEvent) => void): void;
}

/** Event fired by CelloClient when an inbound session_assignment arrives. CELLO-MCP-002. */
export interface SessionAssignmentEvent {
  /** Session ID as lowercase hex. */
  sessionIdHex: string;
  /** Counterparty K_local pubkey as lowercase hex. */
  counterpartyPubkeyHex: string;
  /** Genesis prev_root as lowercase hex. */
  genesisPrevRootHex: string;
}
