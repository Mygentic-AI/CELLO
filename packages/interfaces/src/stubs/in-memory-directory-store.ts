/**
 * InMemoryDirectoryStore — unit-test-only stub for DirectoryStore.
 *
 * Used in tests that exercise application logic against the DirectoryStore contract
 * without needing a running Postgres container. Not used by CELLO_ENV=local at runtime
 * (which uses PgDirectoryStore against the Docker Compose container).
 *
 * Migrated from packages/directory/src/directory-store.ts.
 */

import type { AgentProfile, ConnectionRecord, PendingConnectionRequest } from "@cello-protocol/protocol-types";
import type { DirectoryStore, DirectoryNotification, SealNotarization, ConversationSealRecord, AccountRow, CreateAccountParams, AgentRevocationRecord, PickupItem } from "../directory-store.js";

const NOTIFICATION_QUEUE_BOUND = 256;
const PENDING_CONNECTION_REQUEST_BOUND = 32;

export class InMemoryDirectoryStore implements DirectoryStore {
  readonly #notarizations = new Map<string, SealNotarization>();
  readonly #notificationQueues = new Map<string, DirectoryNotification[]>();

  // REG-001: Agent profile storage
  readonly #profiles = new Map<string, AgentProfile>();
  // REG-001: phone_stub_hash → k_local_pubkey (for duplicate phone guard)
  readonly #phoneHashIndex = new Map<string, string>();

  // ACCOUNT-001: Account rows indexed by account_id
  readonly #accounts = new Map<string, AccountRow>();
  // ACCOUNT-001: phone_stub_hash → account_id (for duplicate guard)
  readonly #accountPhoneHashIndex = new Map<string, string>();
  // ACCOUNT-001: account_id → k_local_pubkey[] (for getAgentsByAccount)
  readonly #accountAgentIndex = new Map<string, string[]>();

  // CONNREQ-002: Connection records indexed by connection_id
  readonly #connections = new Map<string, ConnectionRecord>();
  // CONNREQ-002: "pubkeyA:pubkeyB" (sorted) → connection_id for O(1) pair lookup
  readonly #connectionPairs = new Map<string, string>();
  // CONNREQ-002: target_pubkey → queued pending connection requests (up to 32)
  readonly #pendingConnectionRequests = new Map<string, PendingConnectionRequest[]>();

  // DOD-UP-1: a session may hold a unilateral row AND a superseding bilateral row, so the map is
  // keyed by `${sessionIdHex}:${sealType}` (mirrors the V31 UNIQUE(session_id, seal_type)). A
  // monotonically-increasing counter stands in for the BIGSERIAL id so getNotarizationId works.
  #notarizationSeq = 0;
  readonly #notarizationIds = new Map<string, number>();

  async recordNotarization(notarization: SealNotarization, _opts?: { correlationId?: string; client?: unknown }): Promise<void> {
    const sessionHex = Buffer.from(notarization.session_id).toString("hex");
    const sealType = notarization.seal_type ?? "bilateral";
    const key = `${sessionHex}:${sealType}`;
    // Mirror the pg UNIQUE(session_id, seal_type) durable dedup: first writer wins, no mutation.
    if (this.#notarizations.has(key)) return;
    this.#notarizations.set(key, { ...notarization, seal_type: sealType });
    this.#notarizationIds.set(key, ++this.#notarizationSeq);
  }

  async getNotarization(sessionIdHex: string): Promise<SealNotarization | undefined> {
    // Prefer the superseding bilateral row when present, else the unilateral row.
    return (
      this.#notarizations.get(`${sessionIdHex}:bilateral`) ??
      this.#notarizations.get(`${sessionIdHex}:unilateral`) ??
      // Back-compat: any row written before seal_type existed defaulted to bilateral above.
      this.#notarizations.get(sessionIdHex)
    );
  }

  async getNotarizationId(
    sessionIdHex: string,
    sealType: "unilateral" | "bilateral",
  ): Promise<number | undefined> {
    return this.#notarizationIds.get(`${sessionIdHex}:${sealType}`);
  }

  // SEAL-2: relationship-graph rows, keyed by conversationId (UNIQUE, mirrors the pg constraint).
  readonly #conversationSeals = new Map<string, ConversationSealRecord>();

  async recordConversationSeal(seal: ConversationSealRecord, _opts?: { correlationId?: string; client?: unknown }): Promise<void> {
    // Mirror the pg UNIQUE(conversation_id): first writer wins (a duplicate is benign / no-op).
    if (this.#conversationSeals.has(seal.conversationId)) return;
    this.#conversationSeals.set(seal.conversationId, seal);
  }

  /** Test accessor for the recorded relationship-graph rows. */
  getConversationSealForTest(conversationId: string): ConversationSealRecord | undefined {
    return this.#conversationSeals.get(conversationId);
  }

  enqueueNotification(pubkeyHex: string, event: DirectoryNotification, _correlationId?: string): void {
    let queue = this.#notificationQueues.get(pubkeyHex);
    if (!queue) {
      queue = [];
      this.#notificationQueues.set(pubkeyHex, queue);
    }
    if (queue.length >= NOTIFICATION_QUEUE_BOUND) {
      queue.shift();
    }
    queue.push(event);
  }

  drainNotifications(pubkeyHex: string, _correlationId: string): Promise<DirectoryNotification[]> {
    const queue = this.#notificationQueues.get(pubkeyHex);
    if (!queue || queue.length === 0) return Promise.resolve([]);
    return Promise.resolve(queue.splice(0));
  }

  // ─── REG-001: Profile methods ─────────────────────────────────────────────

  // ─── ACCOUNT-001: Account identity methods ───────────────────────────────

  async createAccount(params: CreateAccountParams): Promise<AccountRow> {
    const { accountId, phoneStubHash, emailStubHash } = params;
    if (this.#accountPhoneHashIndex.has(phoneStubHash)) {
      const err = new Error(`unique constraint violation: phone_stub_hash already exists`);
      (err as unknown as { code: string }).code = "23505";
      throw err;
    }
    const row: AccountRow = {
      id: this.#accounts.size + 1,
      account_id: accountId,
      phone_stub_hash: phoneStubHash,
      email_stub_hash: emailStubHash ?? null,
      created_at: new Date().toISOString(),
      chain_hash: "",
    };
    this.#accounts.set(accountId, row);
    this.#accountPhoneHashIndex.set(phoneStubHash, accountId);
    return row;
  }

  async getAgentsByAccount(accountId: string): Promise<AgentProfile[]> {
    const pubkeys = this.#accountAgentIndex.get(accountId) ?? [];
    return pubkeys
      .map((k) => this.#profiles.get(k))
      .filter((p): p is AgentProfile => p !== undefined)
      .sort((a, b) => a.registered_at - b.registered_at);
  }

  setProfile(profile: AgentProfile, _correlationId?: string): void {
    this.#profiles.set(profile.k_local_pubkey, profile);
    this.#phoneHashIndex.set(profile.phone_stub_hash, profile.k_local_pubkey);
    // ACCOUNT-001: if account_id is set, update the account-agent index
    const accountId = (profile as AgentProfile & { account_id?: string | null }).account_id;
    if (accountId) {
      const list = this.#accountAgentIndex.get(accountId) ?? [];
      if (!list.includes(profile.k_local_pubkey)) {
        list.push(profile.k_local_pubkey);
      }
      this.#accountAgentIndex.set(accountId, list);
    }
  }

  getProfile(kLocalPubkeyHex: string): AgentProfile | undefined {
    return this.#profiles.get(kLocalPubkeyHex);
  }

  hasProfile(kLocalPubkeyHex: string): boolean {
    return this.#profiles.has(kLocalPubkeyHex);
  }

  // ─── CELLO-M7-REMOVE-001 (DOD-REMOVE-2/3): agent revocation ────────────────
  readonly #revocations = new Map<string, AgentRevocationRecord>(); // agentId → record
  readonly #revokedPubkeys = new Set<string>(); // k_local_pubkey hex

  async insertAgentRevocation(rec: AgentRevocationRecord): Promise<void> {
    if (this.#revocations.has(rec.agentId)) return; // append-only, idempotent
    this.#revocations.set(rec.agentId, rec);
    this.#revokedPubkeys.add(rec.kLocalPubkey);
  }

  isAgentRevoked(kLocalPubkeyHex: string): boolean {
    return this.#revokedPubkeys.has(kLocalPubkeyHex);
  }

  getAgentRevocation(agentId: string): AgentRevocationRecord | undefined {
    return this.#revocations.get(agentId);
  }

  // ─── CELLO-M8-LEVER-001 (DOD-INV-6): reversible suspend (pause) ──────────────
  readonly #suspendedPubkeys = new Set<string>(); // k_local_pubkey hex, currently paused

  /** Test/stub helper: set or clear the pause flag for an agent by k_local_pubkey. */
  setAgentSuspended(kLocalPubkeyHex: string, paused: boolean): void {
    if (paused) this.#suspendedPubkeys.add(kLocalPubkeyHex);
    else this.#suspendedPubkeys.delete(kLocalPubkeyHex);
  }

  async isAgentSuspended(kLocalPubkeyHex: string): Promise<boolean> {
    return this.#suspendedPubkeys.has(kLocalPubkeyHex);
  }

  /**
   * The in-memory stub models a SINGLE-node store that holds every agent it is queried about, so it
   * always reports the profile present (no spurious uncheckable warns in unit tests). Real multi-node
   * profile-absence — the single-node-honor gap — is exercised only by the pg-backed spine.
   */
  async hasAgentProfile(_kLocalPubkeyHex: string): Promise<boolean> {
    return true;
  }

  readonly #burnedPubkeys = new Set<string>();
  /** Test/stub helper: mark an agent burned (permanent). */
  setAgentBurned(kLocalPubkeyHex: string): void {
    this.#burnedPubkeys.add(kLocalPubkeyHex);
    this.#suspendedPubkeys.add(kLocalPubkeyHex);
  }
  async isAgentBurned(kLocalPubkeyHex: string): Promise<boolean> {
    return this.#burnedPubkeys.has(kLocalPubkeyHex);
  }

  async listBurnedAgentPubkeys(): Promise<string[]> {
    return [...this.#burnedPubkeys];
  }

  // ─── CELLO-M8-TRUST-001: trust-signal pickup (in-memory) ───────────────────
  readonly #pubkeyToAgentId = new Map<string, string>(); // k_local_pubkey hex → agent_id
  readonly #pickup = new Map<string, PickupItem[]>(); // agent_id → queued items

  /** Test/stub helper: register a pubkey→agent_id mapping and seed a pickup item. */
  seedPickup(kLocalPubkeyHex: string, agentId: string, item: PickupItem): void {
    this.#pubkeyToAgentId.set(kLocalPubkeyHex, agentId);
    const q = this.#pickup.get(agentId) ?? [];
    q.push(item);
    this.#pickup.set(agentId, q);
  }

  async getAgentIdByPubkey(kLocalPubkeyHex: string): Promise<string | null> {
    return this.#pubkeyToAgentId.get(kLocalPubkeyHex) ?? null;
  }

  async drainPickup(agentId: string): Promise<PickupItem[]> {
    return [...(this.#pickup.get(agentId) ?? [])];
  }

  async ackPickup(id: string, agentId: string): Promise<void> {
    // Account-scoped: only remove the row if it belongs to the ACK'ing agent.
    const items = this.#pickup.get(agentId);
    if (items) this.#pickup.set(agentId, items.filter((it) => it.id !== id));
  }

  // The in-memory stub does not model identity-tree anchors or row age, so the orphan-sweep is a no-op
  // here (it is a DB-backstop, exercised by the live test). Satisfies the interface.
  async sweepUndeliverablePickups(_ttlHours = 24): Promise<number> {
    return 0;
  }

  hasPhoneStubHash(phoneStubHashHex: string): boolean {
    return this.#phoneHashIndex.has(phoneStubHashHex);
  }

  // ─── CONNREQ-002: Connection record methods ───────────────────────────────

  async recordAcceptedConnectionRequest(_requestId: string, _requesterPseudonym: string, _targetPseudonym: string): Promise<void> {
    // In-memory stub: no persistence needed; SI-001 guard only applies to PgDirectoryStore.
  }

  async createConnection(connectionId: string, participantA: string, participantB: string, establishedAt: number, _correlationId: string): Promise<void> {
    const record: ConnectionRecord = {
      connection_id: connectionId,
      participant_a: participantA,
      participant_b: participantB,
      established_at: establishedAt,
      status: "active",
    };
    this.#connections.set(connectionId, record);
    const pairKey = [participantA, participantB].sort().join(":");
    this.#connectionPairs.set(pairKey, connectionId);
  }

  async hasConnection(pubkeyA: string, pubkeyB: string): Promise<{ connection_id: string } | null> {
    const pairKey = [pubkeyA, pubkeyB].sort().join(":");
    const connectionId = this.#connectionPairs.get(pairKey);
    if (!connectionId) return null;
    const record = this.#connections.get(connectionId);
    if (!record || record.status !== "active") return null;
    return { connection_id: connectionId };
  }

  async getConnection(connectionId: string): Promise<ConnectionRecord | null> {
    return this.#connections.get(connectionId) ?? null;
  }

  queuePendingConnectionRequest(targetPubkey: string, request: PendingConnectionRequest): boolean {
    let queue = this.#pendingConnectionRequests.get(targetPubkey);
    if (!queue) {
      queue = [];
      this.#pendingConnectionRequests.set(targetPubkey, queue);
    }
    if (queue.length >= PENDING_CONNECTION_REQUEST_BOUND) {
      queue.shift();
      queue.push(request);
      return false;
    }
    queue.push(request);
    return true;
  }

  dequeuePendingConnectionRequests(targetPubkey: string, _correlationId: string): Promise<PendingConnectionRequest[]> {
    const queue = this.#pendingConnectionRequests.get(targetPubkey);
    if (!queue || queue.length === 0) return Promise.resolve([]);
    return Promise.resolve(queue.splice(0));
  }

  // ─── M6B-010: Active connection request persistence ──────────────────────

  // In-memory stub: no-ops. Active connection request persistence is a Pg-only feature;
  // the in-memory store is used only in unit tests where restart recovery is not relevant.
  async saveActiveConnectionRequest(_params: {
    connectionRequestId: string;
    senderPubkeyHex: string;
    targetPubkeyHex: string;
    packageCbor: Uint8Array;
    disclosureRound: number;
    expiresAt: Date;
  }): Promise<void> {
    // In-memory stub: no-op.
  }

  async deleteActiveConnectionRequest(_connectionRequestId: string): Promise<void> {
    // In-memory stub: no-op.
  }

  // ─── FEDERATION-001: Session ownership methods ───────────────────────────

  // In-memory store for session ownership (sessionId → owningNodeId)
  readonly #sessionOwners = new Map<string, string>();

  async writeSession(sessionId: string, owningNodeId: string): Promise<void> {
    // In-memory stub: no hash chain; SI-001 ownership guard only applies to PgDirectoryStore.
    this.#sessionOwners.set(sessionId, owningNodeId);
  }

  async writeSessionWithParticipants(
    sessionId: string,
    owningNodeId: string,
    _initiatorPubkeyHex: string,
    _targetPubkeyHex: string,
  ): Promise<void> {
    // In-memory stub: store ownership; participant persistence is a Pg-only feature.
    this.#sessionOwners.set(sessionId, owningNodeId);
  }

  async getSessionOwner(sessionId: string): Promise<string | undefined> {
    return this.#sessionOwners.get(sessionId);
  }

  async verifyReplicatedRow(_tableName: string, _row: Record<string, unknown>): Promise<void> {
    // In-memory stub: no-op. Hash chain verification only applies to PgDirectoryStore.
  }

  // ─── FEDERATION-002: Checkpoint cross-signing ────────────────────────────

  async writeCheckpointSignature(_params: {
    checkpointId: string;
    nodeId: string;
    nodeSignature: string;
  }): Promise<void> {
    throw new Error("writeCheckpointSignature: not implemented in InMemoryDirectoryStore");
  }

  async getCheckpointSignatures(_checkpointId: string): Promise<Array<{
    id: number;
    checkpointId: string;
    nodeId: string;
    nodeSignature: string;
  }>> {
    throw new Error("getCheckpointSignatures: not implemented in InMemoryDirectoryStore");
  }

  async writeCheckpoint(_params: {
    checkpointId: string;
    mmrPeaks: string[];
    identityMerkleRoot: string;
    checkpointHash: string;
    mmrLeafCount: number;
    coordinatorNodeId: string;
  }): Promise<void> {
    throw new Error("writeCheckpoint: not implemented in InMemoryDirectoryStore");
  }

  async getCheckpointById(_checkpointId: string): Promise<{
    checkpointId: string;
    mmrLeafCount: number;
    checkpointHash: string;
    coordinatorNodeId: string;
    mmrPeaks: string[];
    identityMerkleRoot: string;
  } | undefined> {
    throw new Error("getCheckpointById: not implemented in InMemoryDirectoryStore");
  }

  async getLastCheckpointAt(): Promise<string | null> {
    throw new Error("getLastCheckpointAt: not implemented in InMemoryDirectoryStore");
  }

  async getLastCheckpointRow(): Promise<{ checkpointId: string } | null> {
    throw new Error("getLastCheckpointRow: not implemented in InMemoryDirectoryStore");
  }

  async getStagingRowsForBatch(): Promise<Array<{
    stagingId: string;
    sessionId: string;
    recordedAt: string;
  }>> {
    throw new Error("getStagingRowsForBatch: not implemented in InMemoryDirectoryStore");
  }

  async getCheckpointMmrState(): Promise<{
    mmrPeaks: string[];
    identityMerkleRoot: string;
    mmrLeafCount: number;
  }> {
    throw new Error("getCheckpointMmrState: not implemented in InMemoryDirectoryStore");
  }

  async clearStagingBatch(_stagingIds: string[]): Promise<void> {
    throw new Error("clearStagingBatch: not implemented in InMemoryDirectoryStore");
  }

  // ─── FEDERATION-003: Relay registration ──────────────────────────────────

  readonly #relayRegistrations = new Map<string, { publicKeyHex: string; region: string }>();

  // Note: InMemoryDirectoryStore has no logger — it is a unit-test stub only.
  // Observability events (relay.registered, relay.already.registered, relay.registration.conflict)
  // are emitted by CelloDirectoryNode, which owns the logger. The store layer does not log;
  // it throws RELAY_IDENTITY_CONFLICT so the caller can log and respond appropriately.
  async registerRelay(params: { relayId: string; publicKeyHex: string; region: string }): Promise<{ alreadyRegistered?: boolean }> {
    const existing = this.#relayRegistrations.get(params.relayId);
    if (existing) {
      if (existing.publicKeyHex === params.publicKeyHex) {
        // Idempotent re-registration — no-op
        return { alreadyRegistered: true };
      }
      throw new Error(`RELAY_IDENTITY_CONFLICT: relay_id '${params.relayId}' already registered with a different public key`);
    }
    this.#relayRegistrations.set(params.relayId, { publicKeyHex: params.publicKeyHex, region: params.region });
    return {};
  }

  async getRelayPublicKey(relayId: string): Promise<string | undefined> {
    return this.#relayRegistrations.get(relayId)?.publicKeyHex;
  }
}
