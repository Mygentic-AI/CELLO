/**
 * @cello/client — types.ts
 *
 * Public types for the CelloClient (MSG-002, SESSION-002, MSG-004, ADAPTER-003).
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

  /**
   * SESSION-005: seal notarization type.
   * 'frost' — directory co-signed via FROST ceremony; fully notarized.
   * 'bilateral' — directory unreachable at seal time; bilateral K_local seal only.
   * Undefined until a seal ceremony completes (status becomes 'sealed' or 'seal_deferred').
   */
  seal_type?: "frost" | "bilateral";

  /**
   * SESSION-005: FROST combined signature on the SealNotarization.
   * Populated when seal_type === 'frost'.
   */
  frost_signature?: Uint8Array;

  /**
   * SESSION-005: signer_pubkey from the session_sealed frame — initiator's primary_pubkey.
   * Used by the counterparty to verify the FROST signature without a directory lookup.
   */
  signer_pubkey?: Uint8Array;

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
 *   relay_auth_failed            — relay explicitly rejected the auth response.
 *   relay_auth_error             — could not open a stream to the relay or read the challenge.
 *   dial_counterparty_failed     — reserved for future use.
 *   unsupported_signature_type   — SESSION-004: M1 'single' signature type refused by M2+ clients.
 *   frost_signature_invalid      — SESSION-004: FROST threshold signature verification failed.
 *   frost_signer_not_configured  — SESSION-004: initiator has no IThresholdSigner injected;
 *                                  cannot derive verification key for own primary_pubkey.
 *
 * NOTE (SESSION-004 L-5): `directory_signature_invalid` has been removed.
 * It was the M1 Ed25519 single-key failure reason. In M2, `signature_type: 'single'` frames
 * are hard-refused with `unsupported_signature_type` before any signature verification,
 * and FROST signature failures surface as `frost_signature_invalid`. There is no code path
 * that returns `directory_signature_invalid` in M2.
 */
export type ReceiveAssignmentResult =
  | { ok: true; sessionId: Uint8Array }
  | {
      ok: false;
      reason:
        | "relay_auth_failed"
        | "relay_auth_error"
        | "dial_counterparty_failed"
        | "unsupported_signature_type"
        | "frost_signature_invalid"
        | "frost_signer_not_configured";
    };

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

// ─── ADAPTER-003: initiateSession ────────────────────────────────────────────

/**
 * Result of initiateSession().
 *
 * Success: session_id and genesis_prev_root from the directory-signed SessionAssignment.
 * Failure reasons:
 *   target_offline       — directory reports the target pubkey has no authenticated stream.
 *   relay_unavailable    — directory cannot assign a relay for the session.
 *   target_busy          — simultaneous initiation: target is already mid-handshake.
 *   timeout              — no directory response within the configured timeout.
 *   directory_unreachable — cannot open or authenticate the signaling stream.
 */
export type InitiateSessionResult =
  | { ok: true; sessionId: Uint8Array; genesisPrevRoot: Uint8Array }
  | { ok: false; reason: "target_offline" | "relay_unavailable" | "target_busy" | "timeout" | "directory_unreachable" | "frost_signer_not_configured" | "directory_below_threshold" | "ceremony_conflict" | "no_connection" };

// ─── CelloClient interface ────────────────────────────────────────────────────

export interface CelloClient {
  /**
   * Register this agent with the directory.
   * Generates (or loads) ML-DSA-44 keypair, opens signaling stream, and completes
   * the REG-001 registration ceremony (register_request → register_success).
   *
   * Returns RegistrationState on success, or { error: reason } on failure.
   * Idempotent: second call returns { error: 'already_registered' } if already done.
   *
   * REG-001 AC-001, AC-002, AC-008, AC-010.
   */
  register(phoneStub: string): Promise<import("@cello/protocol-types").RegistrationState | { error: string }>;

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

  /**
   * Send a `session_request` over the persistent directory signaling stream and await
   * the `session_assignment` or error response. On success, completes relay auth and
   * content-path dial (same as receiveSessionAssignment), and returns the session_id
   * and genesis_prev_root.
   *
   * Opens the signaling stream inline if not already open (DB-001: single retry).
   * Returns { ok: false, reason: 'directory_unreachable' } if the stream cannot be
   * established within the tool's timeout.
   *
   * CELLO-ADAPTER-003.
   */
  initiateSession(
    targetPubkeyHex: string,
    opts?: {
      /** Directory peer ID to connect to (overrides configured directoryEndpoint). */
      directoryPeerId?: string;
      /** Directory multiaddr for initial dial (overrides configured directoryEndpoint). */
      directoryMultiaddr?: string;
      /** Timeout in ms. Default: 30_000. */
      timeoutMs?: number;
    },
  ): Promise<InitiateSessionResult>;
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
