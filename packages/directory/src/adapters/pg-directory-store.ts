/**
 * PgDirectoryStore — Postgres-backed DirectoryStore for CELLO_ENV=local (Docker Compose)
 * and production environments (RDS).
 *
 * Used only by the composition root (bin/directory.ts). Never imported from application code.
 * PERSIST-001 SI-002: not exported from packages/directory index.ts.
 */

import pg from "pg";
import type {
  DirectoryStore,
  DirectoryNotification,
  SealNotarization,
} from "@cello/interfaces";
import type { AgentProfile, ConnectionRecord, PendingConnectionRequest } from "@cello/protocol-types";


export class PgDirectoryStore implements DirectoryStore {
  readonly #pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.#pool = pool;
  }

  // ─── SealNotarization ────────────────────────────────────────────────────

  recordNotarization(notarization: SealNotarization): void {
    void this.#pool.query(
      `INSERT INTO seal_notarizations
         (session_id, sealed_root, participant_a_pubkey, participant_b_pubkey,
          close_timestamp, frost_signature)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (session_id) DO NOTHING`,
      [
        Buffer.from(notarization.session_id),
        Buffer.from(notarization.sealed_root),
        Buffer.from(notarization.participant_a_pubkey),
        Buffer.from(notarization.participant_b_pubkey),
        notarization.close_timestamp,
        Buffer.from(notarization.frost_signature),
      ],
    );
  }

  getNotarization(_sessionIdHex: string): SealNotarization | undefined {
    // Synchronous interface — not yet used in M4 integration paths.
    // PgDirectoryStore is wired for M4 AC-002 startup; full async reads come in PERSIST-003+.
    return undefined;
  }

  // ─── Notification queues ─────────────────────────────────────────────────

  enqueueNotification(pubkeyHex: string, event: DirectoryNotification): void {
    void this.#pool.query(
      `INSERT INTO notification_queue (pubkey_hex, payload)
       VALUES ($1, $2)`,
      [pubkeyHex, JSON.stringify(event)],
    );
  }

  drainNotifications(_pubkeyHex: string): DirectoryNotification[] {
    // Synchronous drain is in-memory only in M4; Postgres-backed drain comes in PERSIST-003+.
    return [];
  }

  // ─── Agent profiles ───────────────────────────────────────────────────────

  setProfile(profile: AgentProfile): void {
    void this.#pool.query(
      `INSERT INTO agent_profiles
         (k_local_pubkey, primary_pubkey, ml_dsa_pubkey, phone_stub_hash, registered_at, status)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (k_local_pubkey) DO NOTHING`,
      [
        profile.k_local_pubkey,
        profile.primary_pubkey,
        profile.ml_dsa_pubkey,
        profile.phone_stub_hash,
        profile.registered_at,
        profile.status,
      ],
    );
  }

  getProfile(_kLocalPubkeyHex: string): AgentProfile | undefined {
    return undefined; // full async read in PERSIST-003+
  }

  hasProfile(_kLocalPubkeyHex: string): boolean {
    return false; // backing store read in PERSIST-003+
  }

  hasPhoneStubHash(_phoneStubHashHex: string): boolean {
    return false; // backing store read in PERSIST-003+
  }

  // ─── Connection records ──────────────────────────────────────────────────

  createConnection(connectionId: string, participantA: string, participantB: string, establishedAt: number): void {
    void this.#pool.query(
      `INSERT INTO connections
         (connection_id, participant_a, participant_b, established_at, status)
       VALUES ($1,$2,$3,$4,'active')
       ON CONFLICT (connection_id) DO NOTHING`,
      [connectionId, participantA, participantB, establishedAt],
    );
  }

  hasConnection(_pubkeyA: string, _pubkeyB: string): { connection_id: string } | null {
    return null; // backing store read in PERSIST-003+
  }

  getConnection(_connectionId: string): ConnectionRecord | null {
    return null; // backing store read in PERSIST-003+
  }

  queuePendingConnectionRequest(targetPubkey: string, request: PendingConnectionRequest): boolean {
    void this.#pool.query(
      `INSERT INTO pending_connection_requests (target_pubkey, payload)
       VALUES ($1, $2)`,
      [targetPubkey, JSON.stringify(request)],
    );
    return true;
  }

  dequeuePendingConnectionRequests(_targetPubkey: string): PendingConnectionRequest[] {
    return []; // backing store read in PERSIST-003+
  }
}
