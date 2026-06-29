/**
 * DirectoryStore — persistence interface for directory state (PERSIST-001 / NODE-001).
 *
 * Migrated from packages/directory/src/directory-store.ts so all packages can
 * depend on the interface without pulling in the full directory implementation.
 *
 * SealNotarization is a storage-only record (never sent on the wire) and is defined
 * locally here rather than in packages/protocol-types.
 */

import type {
  SessionAbandoned,
  SessionSealed,
  SessionSealRejected,
  SealVerified,
} from "@cello-protocol/protocol-types";
import type { AgentProfile, ConnectionEstablished, ConnectionRecord, PendingConnectionRequest } from "@cello-protocol/protocol-types";

// ─── ACCOUNT-001: Account identity types ─────────────────────────────────────

/**
 * Parameters for creating a new user_accounts row.
 * ACCOUNT-001: email_stub_hash is optional — email is not required at account creation time.
 */
export interface CreateAccountParams {
  accountId: string;        // UUID
  phoneStubHash: string;    // SHA-256(phone_stub) per FIPS 180-4
  emailStubHash?: string;   // SHA-256(email_stub) per FIPS 180-4 — optional
  correlationId?: string;   // For observability threading
}

/**
 * A persisted user_accounts row.
 * ACCOUNT-001: returned by createAccount().
 */
export interface AccountRow {
  id: number;               // BIGSERIAL — internal row ordering
  account_id: string;       // UUID PRIMARY KEY
  phone_stub_hash: string;  // SHA-256(phone_stub) — stored opaque; never decrypted by directory
  email_stub_hash: string | null; // SHA-256(email_stub) — optional; null if not set
  created_at: string;       // TIMESTAMPTZ as ISO string
  chain_hash: string;       // SHA-256 hash chain value
}

/** Internal storage record for a completed FROST-notarized seal ceremony. Never sent on the wire. */
export interface SealNotarization {
  session_id: Uint8Array;           // 16 bytes
  sealed_root: Uint8Array;          // 32-byte Merkle root
  participant_a_pubkey: Uint8Array; // 32 bytes
  participant_b_pubkey: Uint8Array; // 32 bytes
  close_timestamp: number;          // Unix ms
  frost_signature: Uint8Array;      // 64-byte FROST (or legacy Ed25519) signature over the notarization
  /**
   * CELLO-M7-UPGRADE-001 (DOD-UP-1): discriminates a UNILATERAL seal (B absent — directory
   * notarizes B's liveness, B did not co-sign) from a BILATERAL seal (both parties co-signed).
   * Defaults to 'bilateral' when omitted — the directory's pre-UP-1 two-party path always
   * produced bilateral seals. Persisted to seal_notarizations.seal_type (V31). NOT on the wire.
   */
  seal_type?: "unilateral" | "bilateral";
  /**
   * DOD-UP-1: when the previously-ABSENT party returns, recovers + verifies the content, and
   * co-signs its OWN ack leaf, the directory writes a NEW bilateral row that SUPERSEDES the
   * unilateral one via this FK to the unilateral row's id. The unilateral row is never mutated
   * (append-only, AC-006). null/undefined on every non-superseding row.
   */
  supersedes_notarization_id?: number | null;
}

/** SEAL-2: the close-type discriminator on conversation_seals (V2 CHECK constraint). */
export type ConversationCloseType = "MUTUAL_SEAL" | "SEAL_UNILATERAL" | "EXPIRE" | "ABORT" | "REOPEN";

/** SEAL-2: per-party attestation on conversation_attestations (V2 CHECK constraint). */
export type ConversationAttestation = "CLEAN" | "FLAGGED" | "PENDING" | "DELIVERED" | "ABSENT";

/**
 * SEAL-2: relationship-graph rows for a completed seal — relationship metadata + the sealed root
 * HASH only, NEVER content. Consumed by the analytics graph (Sybil-farming defense).
 */
export interface ConversationSealRecord {
  /** The session id as a UUID (the directory's conversation identifier). */
  conversationId: string;
  /** The sealed Merkle root, hex (conversation_seals.merkle_root — a HASH, never content). */
  merkleRootHex: string;
  closeType: ConversationCloseType;
  /** Unix ms; stored as conversation_seals.seal_date (DATE, UTC). */
  closeTimestampMs: number;
  /**
   * The parties: `pseudonym` is the stable graph identifier (k_local pubkey hex); `attestation` is
   * this party's per-conversation attestation. participant_count = parties.length.
   */
  parties: Array<{ pseudonym: string; attestation: ConversationAttestation; sealSignatureHex: string }>;
}

export type DirectoryNotification = SessionAbandoned | SessionSealed | SessionSealRejected | SealVerified | ConnectionEstablished;

/**
 * CELLO-M7-REMOVE-001 (DOD-REMOVE-2): an append-only agent revocation fact. `agentId` is the
 * directory-assigned agent_id (agent_profiles.agent_id) — guardrail #1, never a pubkey. `kLocalPubkey`
 * is the agent's registered K_local hex; it is NOT a stored column (it lives in agent_profiles) — it is
 * carried on insert to update the in-memory revoked-pubkey index, and re-derived on read via a JOIN.
 * `signature` is the agent's own Ed25519 signature over the canonical revocation TBS.
 */
export interface AgentRevocationRecord {
  agentId: string;
  kLocalPubkey: string;
  epochId: string;
  reason: string;
  signature: Uint8Array;
  revokedAt: number;
}

/** CELLO-M8-TRUST-001: one sealed trust signal awaiting an agent's daemon, with its anchor hash. */
export interface PickupItem {
  /** pickup_queue.id — the ACK handle. */
  id: string;
  signalKind: string | null;
  /** The opaque sealed ciphertext — only the agent's k_local seed opens it. */
  ciphertext: Uint8Array;
  /** The authoritative directory hash (identity tree), hex — the daemon's verification anchor; null if no anchor. */
  signalHash: string | null;
}

export interface DirectoryStore {
  /**
   * Store a completed SealNotarization.
   *
   * PERSIST-018: async — writes to Postgres with one retry on transient failure.
   * Logs notarization.recorded at INFO on success.
   * Logs notarization.write.failed at ERROR on each failure attempt.
   * Logs notarization.duplicate.rejected at WARN on unique constraint violation.
   *
   * @param opts.correlationId - The seal-ceremony correlationId minted at ceremony
   *   initiation. Threaded through all observability events in this flow.
   * @param opts.client - Optional pre-acquired PoolClient for transactional writes.
   *   When provided, the store uses this client instead of acquiring from the pool,
   *   enabling atomic multi-table writes (e.g. conversation_seals + seal_notarizations
   *   in a single transaction). SI-002 requires this capability.
   */
  recordNotarization(notarization: SealNotarization, opts?: { correlationId?: string; client?: unknown }): Promise<void>;

  /**
   * Retrieve a notarization by session_id hex.
   *
   * PERSIST-018: async — queries Postgres. Returns undefined if no row exists.
   * Does not throw and does not log an error on absence.
   *
   * DOD-UP-1: a session may now hold up to two rows (one unilateral + one superseding
   * bilateral). This returns the AUTHORITATIVE current seal — the bilateral row when an
   * upgrade has occurred, otherwise the unilateral row. The returned record carries
   * seal_type so callers can tell which.
   */
  getNotarization(sessionIdHex: string): Promise<SealNotarization | undefined>;

  /**
   * DOD-UP-1: fetch the DB row id of a notarization by (session, seal_type). Used by the
   * upgrade ceremony to set supersedes_notarization_id on the new bilateral row, pointing
   * at the existing unilateral row. Returns undefined when no such row exists.
   */
  getNotarizationId(sessionIdHex: string, sealType: "unilateral" | "bilateral"): Promise<number | undefined>;

  /**
   * SEAL-2 (Sybil/relationship-farming defense): record the RELATIONSHIP-GRAPH rows for a completed
   * seal — conversation_seals (close_type + the sealed root HASH) + one conversation_participation
   * row per party + one conversation_attestations row per party. These feed the analytics graph
   * (conversation_graph_edges: two participants of a sealed conversation → an edge; pseudonym_stats).
   *
   * PRIVACY: stores relationship METADATA + the sealed root HASH ONLY — NEVER conversation content
   * (content stays client-side encrypted; INV-3). `pseudonym` is the party's stable identifier for
   * graph clustering (the k_local pubkey hex — the directory already holds it in seal_notarizations).
   *
   * BEST-EFFORT: this is the analytics derivative, not the authoritative seal (that is
   * seal_notarizations). It MUST NOT block or fail a seal — callers fire-and-forget and log on error,
   * exactly like the MMR staging. Each of the three tables is independently hash-chained.
   */
  recordConversationSeal(
    seal: ConversationSealRecord,
    opts?: { correlationId?: string; client?: unknown },
  ): Promise<void>;

  /**
   * Enqueue a notification event for a pubkey that has no active signaling stream.
   * Drops oldest if at the 256-event bound.
   * PERSIST-019: correlationId is optional; when provided it appears in the
   * notification.queued log event for traceability.
   */
  enqueueNotification(pubkeyHex: string, event: DirectoryNotification, correlationId?: string): void;

  /**
   * Drain the pending notification queue for a pubkey. Returns [] if none.
   * PERSIST-019: async so PgDirectoryStore can do a real SELECT+DELETE in a single
   * transaction (SI-001: prevents double delivery under concurrent reconnects).
   * correlationId appears in the notification.drained log event.
   */
  drainNotifications(pubkeyHex: string, correlationId: string): Promise<DirectoryNotification[]>;

  // ─── REG-001: Agent profile methods ──────────────────────────────────────

  /**
   * Store an AgentProfile. k_local_pubkey is the primary key.
   * Also indexes phone_stub_hash for phone_already_claimed guard.
   * REG-001 SI-002: Only called after successful FROST DKG.
   *
   * ACCOUNT-001: correlationId is optional. When the profile includes an account_id,
   * correlationId is threaded into the account.agent.linked and account.agent.link.failed
   * log events. M6 callers will populate it; pre-M6 callers pass nothing (undefined is
   * acceptable).
   */
  setProfile(profile: AgentProfile, correlationId?: string): void;

  /**
   * Retrieve a profile by k_local_pubkey hex. Returns undefined if not registered.
   */
  getProfile(kLocalPubkeyHex: string): AgentProfile | undefined;

  /**
   * Return true if an agent with this k_local_pubkey has already registered.
   */
  hasProfile(kLocalPubkeyHex: string): boolean;

  // ─── CELLO-M7-REMOVE-001 (DOD-REMOVE-2/3): agent revocation ────────────────
  // Append-only, self-signed revocation facts. Removal is RECORDED, never an
  // agent_profiles mutation or delete (design log §5; guardrail #5; SI-002).

  /**
   * Append a verified revocation (the directory verified the self-signature first). Idempotent:
   * a revocation that already exists for agent_id is a no-op. `kLocalPubkey` is the agent's
   * registered K_local (not a stored column) — passed so the in-memory revoked-pubkey index used by
   * the soft-refuse path can be updated. RESOLVES ONLY AFTER the row is DURABLY committed (the caller
   * must not ack "recorded" until then — a revocation is an authoritative, replicated security fact);
   * REJECTS if the write fails so the caller can surface a deferred/persist-failed error instead of a
   * false "recorded."
   */
  insertAgentRevocation(rec: AgentRevocationRecord): Promise<void>;

  /**
   * True if the agent whose K_local pubkey is `kLocalPubkeyHex` has a recorded revocation.
   * Synchronous (in-memory index) — used by the routing/initiation refuse gates (DOD-REMOVE-3).
   */
  isAgentRevoked(kLocalPubkeyHex: string): boolean;

  /**
   * Read a revocation back by the directory-assigned agent_id (AC-002 — verifiable from any node).
   * Returns undefined if the agent has no revocation.
   */
  getAgentRevocation(agentId: string): AgentRevocationRecord | undefined;

  // ─── CELLO-M8-LEVER-001 (DOD-INV-6): reversible suspend (pause) honor-check ──
  /**
   * True if the agent whose K_local pubkey is `kLocalPubkeyHex` is currently PAUSED (a reversible
   * suspension flag in agent_suspensions, written through the account-scoped write seam). Unlike
   * {@link isAgentRevoked} (a permanent, cacheable tombstone), a pause is MUTABLE and a security
   * control — so this reads the live replicated row directly (async) rather than an in-memory cache,
   * so an un-cleared cache can never let a paused, possibly-compromised agent sign. Each honest node
   * consults its own replicated copy and refuses its FROST share independently (T-of-N, not 2-of-2).
   */
  isAgentSuspended(kLocalPubkeyHex: string): Promise<boolean>;

  /**
   * True if THIS node holds an agent_profiles row for `kLocalPubkeyHex`. The suspension honor-check
   * ({@link isAgentSuspended}) JOINs agent_suspensions→agent_profiles, so a node with NO local profile
   * resolves every suspension to "not suspended" and signs blind. Callers use this to emit a loud
   * `frost.suspension.uncheckable` warn when a node participates in a ceremony for an agent it cannot
   * check — surfacing the single-node-honor production gap until the flag+profile are replicated to
   * every node (PRESENCE-1 / cello_pub). Observability-only; never a security gate.
   */
  hasAgentProfile(kLocalPubkeyHex: string): Promise<boolean>;

  /**
   * True if the agent has been BURNED (permanent — LEVER-002). A burned agent is also suspended; this
   * distinguishes burn (→ each node destroys its own K_server share) from a reversible pause.
   */
  isAgentBurned(kLocalPubkeyHex: string): Promise<boolean>;

  /**
   * The k_local pubkeys of ALL burned agents — for the per-node burn reconcile sweep, so a node that
   * was idle/offline when the (replicated) burn arrived still zeroes its own K_server share without
   * waiting for a ceremony attempt (LEVER-002, the federation-wide guarantee).
   */
  listBurnedAgentPubkeys(): Promise<string[]>;

  // ─── CELLO-M8-TRUST-001: trust-signal pickup delivery ──────────────────────
  /** Resolve the directory agent_id for a k_local pubkey (the pickup queue is keyed by agent_id). */
  getAgentIdByPubkey(kLocalPubkeyHex: string): Promise<string | null>;
  /** An agent's unacked sealed signals, oldest first, each with its authoritative identity-tree hash. */
  drainPickup(agentId: string): Promise<PickupItem[]>;
  /** ACK a delivered pickup: DELETE the row so no ciphertext lingers (TRUST-001 AC-002). Idempotent.
   *  ACCOUNT-SCOPED by the ACK'ing agent's agent_id — an ACK can only delete a row addressed to it
   *  (pickup_queue.id is a guessable BIGSERIAL; id-alone would allow cross-tenant deletion). */
  ackPickup(id: string, agentId: string): Promise<void>;
  /** Backstop sweep: delete ORPHANED pending pickups — anchor-less (no identity_tree entry for their
   *  (agent_id, signal_kind)) and older than ttlHours — so an undeliverable ciphertext (its hash write
   *  never landed) cannot linger forever. Returns the rows deleted. Anchored or fresh rows are untouched. */
  sweepUndeliverablePickups(ttlHours?: number): Promise<number>;

  /**
   * Return true if the given phone_stub_hash (hex SHA-256) is already claimed.
   * Used for the phone_already_claimed duplicate guard.
   * REG-001 SI-001: raw phone_stub is NEVER passed here — only the hash.
   */
  hasPhoneStubHash(phoneStubHashHex: string): boolean;

  // ─── ACCOUNT-001: Account identity methods ───────────────────────────────

  /**
   * Create a new user_accounts row with hash chain enforcement.
   *
   * ACCOUNT-001: logs account.created at INFO on success.
   * Logs account.phone_stub_hash.duplicate at WARN on unique constraint violation;
   * rethrows so the caller can handle the failure.
   *
   * @param params.accountId - UUID for the new account
   * @param params.phoneStubHash - SHA-256(phone_stub) — must be unique
   * @param params.emailStubHash - Optional SHA-256(email_stub)
   * @param params.correlationId - For observability threading
   * @throws on duplicate phone_stub_hash or other DB error
   */
  createAccount(params: CreateAccountParams): Promise<AccountRow>;

  /**
   * Return all agent_profiles rows with account_id = accountId,
   * ordered by registered_at ASC.
   *
   * ACCOUNT-001 AC-002: returns both linked agents in registration order.
   * ACCOUNT-001 AC-004: NULL account_id rows are excluded from results.
   *
   * Returns [] if no agents are linked to this account.
   * Does not throw on empty result.
   */
  getAgentsByAccount(accountId: string): Promise<AgentProfile[]>;

  // ─── CONNREQ-002: Connection record methods ───────────────────────────────

  /**
   * Record an accepted connection request in connection_requests.
   * Must be called before createConnection — the SI-001 guard in the Postgres
   * implementation validates that a matching ACCEPTED row exists.
   * Called by directory-node.ts when a connection_response { verdict: 'accept' } arrives.
   */
  recordAcceptedConnectionRequest(requestId: string, requesterPseudonym: string, targetPseudonym: string): Promise<void>;

  /**
   * Create a connection record for A–B. Indexed by both pubkeys and by connection_id.
   * CONNREQ-002: called only after directory receives connection_response { verdict: 'accept' }.
   *
   * PERSIST-020: correlationId is the connection-request-scoped ID threaded through the
   * connection acceptance flow. Required for connection.persisted observability event.
   * The Postgres implementation validates connection_id against connection_requests before
   * writing. Throws if no matching pending request is found (SI-001).
   */
  createConnection(connectionId: string, participantA: string, participantB: string, establishedAt: number, correlationId: string): Promise<void>;

  /**
   * Check if an active connection exists between pubkeyA and pubkeyB.
   * Returns the connection record if found, null if not.
   * O(1) lookup on both composite indexes (forward + reverse).
   * SESSION-006: used by session_request handler to verify connection exists.
   *
   * PERSIST-020: returns Promise to support Postgres-backed implementations.
   */
  hasConnection(pubkeyA: string, pubkeyB: string): Promise<{ connection_id: string } | null>;

  /**
   * Retrieve a connection record by connection_id hex.
   * Returns null if not found. Does not throw on missing record.
   *
   * PERSIST-020: returns Promise to support Postgres-backed implementations.
   */
  getConnection(connectionId: string): Promise<ConnectionRecord | null>;

  /**
   * Enqueue a notification for delivery. Returns true on success.
   * No queue capacity limit is enforced in M4 (see DB-003).
   */
  queuePendingConnectionRequest(targetPubkey: string, request: PendingConnectionRequest): boolean;

  /**
   * Dequeue and return all pending connection requests for a target (in arrival order).
   * Returns [] if none queued. Only returns requests within the 24-hour TTL.
   * PERSIST-019: async so PgDirectoryStore can SELECT+DELETE in a single transaction
   * (SI-001). correlationId appears in queue.pending_connection_requests.drained event.
   */
  dequeuePendingConnectionRequests(targetPubkey: string, correlationId: string): Promise<PendingConnectionRequest[]>;

  // ─── M6B-010: Active connection request persistence ──────────────────────

  /**
   * Persist a connection request that has been delivered to the target but not yet
   * accepted or rejected. Enables restart recovery of "awaiting acceptance" state.
   *
   * M6B-010 AC-001: called from directory-node.ts in the live delivery path
   * (immediately after inserting into #pendingConnectionRequests) and in the
   * reconnect drain path.
   *
   * ON CONFLICT (connection_request_id) DO NOTHING — idempotent.
   */
  saveActiveConnectionRequest(params: {
    connectionRequestId: string;
    senderPubkeyHex: string;
    targetPubkeyHex: string;
    packageCbor: Uint8Array;
    disclosureRound: number;
    expiresAt: Date;
  }): Promise<void>;

  /**
   * Delete an active connection request by ID.
   *
   * M6B-010 AC-001: called when a connection request is accepted, rejected, or
   * otherwise resolved so it is not reloaded on the next restart.
   */
  deleteActiveConnectionRequest(connectionRequestId: string): Promise<void>;

  // ─── FEDERATION-001: Session ownership methods ───────────────────────────

  /**
   * Write a sessions row with owning_node_id set to this node's node_id.
   *
   * FEDERATION-001 AC-009: inserts via the hash chain mechanism; the sessions
   * table is append-only and hash-chained. SI-001: the owning node is the sole
   * writer — callers pass the owning node's node_id explicitly so application code
   * cannot write for a foreign session.
   *
   * Throws if a sessions row for this session_id already exists (unique constraint).
   */
  writeSession(sessionId: string, owningNodeId: string): Promise<void>;

  /**
   * Write a sessions row AND store the initiator/target participant pubkeys.
   *
   * M6B-010 AC-002/AC-003: replaces writeSession() in the session request handler
   * so that #sessionParticipants survives restart via loadActiveSessionParticipants().
   *
   * If a sessions row for this session_id already exists (e.g. from a prior writeSession
   * call in a federation replication path), the participant columns are updated in place.
   *
   * Throws if the session is owned by a different node (ownership violation, SI-001).
   */
  writeSessionWithParticipants(
    sessionId: string,
    owningNodeId: string,
    initiatorPubkeyHex: string,
    targetPubkeyHex: string,
  ): Promise<void>;

  /**
   * Retrieve the owning_node_id for a session_id.
   *
   * Returns undefined if no sessions row exists for this session_id.
   * Does not throw on absence.
   */
  getSessionOwner(sessionId: string): Promise<string | undefined>;

  /**
   * Verify a single replicated row's chain hash.
   *
   * FEDERATION-001 AC-005/AC-006: called by the receiving node when a row arrives
   * via logical replication. Computes SHA-256(record_contents || previous_chain_hash)
   * and compares to the row's chain_hash field.
   *
   * On match: logs federation.replication.verified at INFO with
   *   { nodeId, sessionId, leafIndex, chainHash, durationMs }.
   * On mismatch: logs federation.replication.chain_hash_mismatch at ERROR with
   *   { nodeId, sessionId, leafIndex, expectedHash, receivedHash }, then throws so the
   *   caller can halt replication for this session's rows pending operator investigation.
   *
   * @param tableName - The name of the hash-chained table the row belongs to.
   * @param row - The row as returned by the pg driver (field values are strings/numbers/etc).
   * @throws if the chain hash does not match (caller must halt replication on throw)
   */
  verifyReplicatedRow(tableName: string, row: Record<string, unknown>): Promise<void>;

  // ─── FEDERATION-002: Checkpoint cross-signing ───────────────────────────

  /**
   * Write a checkpoint_node_signatures row.
   *
   * FEDERATION-002 AC-009-store-tables: records a single node's Ed25519 signature for
   * a confirmed checkpoint. The (checkpoint_id, node_id) UNIQUE constraint ensures the
   * same node cannot submit two signatures for the same checkpoint.
   *
   * @throws on unique constraint violation (SQLSTATE 23505) — SI-001: same node twice
   *   does not count toward the threshold.
   */
  writeCheckpointSignature(params: {
    checkpointId: string;
    nodeId: string;
    nodeSignature: string;
  }): Promise<void>;

  /**
   * Get all checkpoint_node_signatures rows for a checkpoint_id.
   *
   * FEDERATION-002 AC-009-store-tables: round-trip read.
   * BIGSERIAL id is deserialized to number.
   */
  getCheckpointSignatures(checkpointId: string): Promise<Array<{
    id: number;
    checkpointId: string;
    nodeId: string;
    nodeSignature: string;
  }>>;

  /**
   * Write a directory_checkpoints row for a confirmed checkpoint.
   *
   * FEDERATION-002: append-only, hash-chained. Called by CheckpointCoordinator after
   * collecting >= requiredThreshold signatures.
   */
  writeCheckpoint(params: {
    checkpointId: string;
    mmrPeaks: string[];
    identityMerkleRoot: string;
    checkpointHash: string;
    mmrLeafCount: number;
    coordinatorNodeId: string;
  }): Promise<void>;

  /**
   * Retrieve a directory_checkpoints row by checkpoint_id.
   *
   * FEDERATION-002: used to verify a checkpoint was committed. Returns undefined if absent.
   */
  getCheckpointById(checkpointId: string): Promise<{
    checkpointId: string;
    mmrLeafCount: number;
    checkpointHash: string;
    coordinatorNodeId: string;
    mmrPeaks: string[];
    identityMerkleRoot: string;
  } | undefined>;

  /**
   * Get the ISO-8601 timestamp of the most recent confirmed checkpoint.
   *
   * FEDERATION-002 AC-009 gap alarm. Returns null if no checkpoints exist.
   */
  getLastCheckpointAt(): Promise<string | null>;

  /**
   * Get the checkpoint_id of the most recent confirmed checkpoint.
   *
   * FEDERATION-002 AC-009 gap alarm. Returns null if no checkpoints exist.
   */
  getLastCheckpointRow(): Promise<{ checkpointId: string } | null>;

  /**
   * Get staging rows eligible for the next checkpoint batch.
   *
   * FEDERATION-002 AC-008-crash-mid-clear: excludes staging rows whose session has
   * already been committed to conversation_proof_leaf_checkpoints.
   *
   * Returns rows without a checkpoint_id that have not been previously confirmed.
   */
  getStagingRowsForBatch(): Promise<Array<{
    stagingId: string;
    sessionId: string;
    recordedAt: string;
  }>>;

  /**
   * Get the current MMR state for checkpoint hash computation.
   *
   * FEDERATION-002: returns mmrPeaks, identityMerkleRoot, and mmrLeafCount.
   */
  getCheckpointMmrState(): Promise<{
    mmrPeaks: string[];
    identityMerkleRoot: string;
    mmrLeafCount: number;
  }>;

  /**
   * Delete staging rows by stagingId after a successful checkpoint.
   *
   * FEDERATION-002 AC-003: only deletes rows in the current batch (by id),
   * leaving rows inserted after initiateCheckpoint was called.
   *
   * @param stagingIds - Array of staging row IDs to delete.
   */
  clearStagingBatch(stagingIds: string[]): Promise<void>;

  // ─── FEDERATION-003: Relay registration ──────────────────────────────────

  /**
   * Register a relay node's Ed25519 public key.
   *
   * FEDERATION-003 AC-002/AC-003: idempotent by design.
   *   - If no row exists for relayId: insert a new row and log relay.registered at INFO.
   *   - If a row exists with the SAME publicKeyHex: no-op, log relay.already.registered at INFO.
   *   - If a row exists with a DIFFERENT publicKeyHex: throw RELAY_IDENTITY_CONFLICT,
   *     log relay.registration.conflict at ERROR.
   *
   * SI-001: relay_registrations is append-only — the existing key is NEVER overwritten.
   *
   * @param params.relayId - The hex-encoded Ed25519 public key of the relay (stable identifier)
   * @param params.publicKeyHex - 64-char hex of the relay's Ed25519 public key (same as relayId by convention)
   * @param params.region - AWS region where this relay runs
   * @returns { alreadyRegistered: true } if the relay was already registered with the same key (idempotent no-op),
   *          {} (empty object) for a fresh registration
   * @throws Error with message containing "RELAY_IDENTITY_CONFLICT" if relayId already exists with a different key
   */
  registerRelay(params: { relayId: string; publicKeyHex: string; region: string }): Promise<{ alreadyRegistered?: boolean }>;

  /**
   * Retrieve the registered public key hex for a relay by its relayId.
   *
   * FEDERATION-003 AC-004: used by clients and new relays to verify relay ACK signatures.
   * Returns undefined if the relayId is not registered.
   * Does not throw on absence.
   */
  getRelayPublicKey(relayId: string): Promise<string | undefined>;
}
