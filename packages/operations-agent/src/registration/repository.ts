/**
 * repository.ts — PostgreSQL-backed repository for the registration state machine.
 *
 * Phase P — Pseudocode:
 *
 *   computeChainHash(prevChainHash, id, state, updatedAt):
 *     // Registration chain hash formula (from registration-state.ts comments)
 *     // Root: SHA-256(id)
 *     // Transition: SHA-256(prev || id || state || updatedAt_iso8601)
 *
 *   findActiveByChannelUser(pool, channel, channelUserId):
 *     SELECT * FROM registrations
 *     WHERE channel = $1 AND channel_user_id = $2
 *     AND state NOT IN ('EXPIRED','FAILED','PRE_AUTH_TOKEN_ISSUED')
 *     LIMIT 1
 *
 *   findById(pool, id):
 *     SELECT * FROM registrations WHERE id = $1
 *
 *   insert(pool, record):
 *     chain_hash = SHA-256(id)
 *     INSERT INTO registrations (...) VALUES (...)
 *
 *   update(pool, id, changes):
 *     Fetch current row to get prev chain_hash
 *     Compute new chain_hash
 *     UPDATE registrations SET ... WHERE id = $1
 *
 *   findExpiredActive(pool, now):
 *     SELECT * FROM registrations
 *     WHERE state NOT IN terminal AND expires_at < now
 *
 *   loadAllActive(pool):
 *     SELECT * FROM registrations
 *     WHERE state NOT IN terminal
 *
 *   getOtpSalt(pool, id):
 *     SELECT otp_salt FROM registrations WHERE id = $1
 *
 * Chain hash formula from registration-state.ts:
 *   Root:       SHA-256(id)
 *   Transition: SHA-256(prev_chain_hash || id || new_state || new_updated_at)
 *   Inputs are UTF-8 strings; new_updated_at uses ISO 8601 format.
 */

import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import type { RegistrationRecord, RegistrationState } from "@cello-protocol/interfaces";

// ─── Internal DB row type ────────────────────────────────────────────────────

/**
 * RegistrationRow — the raw database row from the registrations table.
 * Includes persistence-layer fields not exposed in RegistrationRecord.
 */
export type RegistrationRow = {
  id: string;
  phone_stub_hash: string;
  channel: "telegram" | "whatsapp" | "cli";
  channel_user_id: string;
  state: string;
  state_data: Record<string, unknown>;
  email_stub_hash: string | null;
  otp_hash: string | null;
  otp_salt: string | null;
  otp_expires_at: Date | null;
  otp_attempt_count: number;
  created_at: Date;
  updated_at: Date;
  expires_at: Date;
  chain_hash: string;
};

// ─── Chain hash computation ───────────────────────────────────────────────────

/**
 * Compute the root chain hash for a new record.
 * Formula: SHA-256(id)
 */
export function computeRootChainHash(id: string): string {
  return createHash("sha256").update(id, "utf8").digest("hex");
}

/**
 * Compute the chain hash for a state transition.
 * Formula: SHA-256(prev_chain_hash || id || new_state || new_updated_at)
 * All inputs are UTF-8 strings; new_updated_at uses ISO 8601 format.
 */
export function computeTransitionChainHash(
  prevChainHash: string,
  id: string,
  newState: string,
  newUpdatedAt: Date,
): string {
  return createHash("sha256")
    .update(prevChainHash + id + newState + newUpdatedAt.toISOString(), "utf8")
    .digest("hex");
}

// ─── Row → RegistrationRecord deserializer ────────────────────────────────────

/**
 * Convert a DB row to the application-layer RegistrationRecord.
 * Reconstructs the discriminated union state field from row columns.
 */
export function rowToRecord(row: RegistrationRow): RegistrationRecord {
  const baseFields = {
    id: row.id,
    phoneStubHash: row.phone_stub_hash,
    channel: row.channel,
    channelUserId: row.channel_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
    emailStubHash: row.email_stub_hash,
  };

  // Reconstruct discriminated union state
  const state = deserializeState(row);

  return { ...baseFields, ...state } as RegistrationRecord;
}

function deserializeState(row: RegistrationRow): RegistrationState {
  switch (row.state) {
    case "INITIAL":
      return { state: "INITIAL" };
    case "AWAITING_CONTACT":
      return { state: "AWAITING_CONTACT" };
    case "PHONE_CONFIRMED":
      return { state: "PHONE_CONFIRMED" };
    case "AWAITING_EMAIL":
      return { state: "AWAITING_EMAIL" };
    case "AWAITING_EMAIL_OTP":
      // otp_hash and otp_expires_at are null only via direct DB manipulation (e.g. test setup
      // or admin intervention). In normal production flow, the state machine clears OTP fields
      // via transition(id, "EMAIL_CONFIRMED", { clearOtp: true }) or transitionOnOtpLockout().
      // The new Date(0) sentinel for otp_expires_at is intentionally always < now(), but
      // #handleAwaitingEmailOtp checks !otpHash before the expiry check, so this sentinel
      // is never reached from normal code paths.
      // We use empty string as a sentinel for null otp_hash; the falsy check handles both.
      return {
        state: "AWAITING_EMAIL_OTP",
        otpHash: row.otp_hash ?? "",
        otpExpiresAt: row.otp_expires_at ?? new Date(0),
        attemptCount: row.otp_attempt_count,
      };
    case "EMAIL_CONFIRMED":
      return { state: "EMAIL_CONFIRMED" };
    case "PRE_AUTH_TOKEN_ISSUED":
      return { state: "PRE_AUTH_TOKEN_ISSUED" };
    case "EXPIRED":
      return { state: "EXPIRED" };
    case "FAILED":
      // Reason is stored in state_data.reason
      return {
        state: "FAILED",
        reason: (row.state_data["reason"] as string | undefined) ?? "unknown",
      };
    default:
      return { state: "FAILED", reason: `legacy/unknown state: ${row.state}` };
  }
}

// ─── RegistrationRepository ───────────────────────────────────────────────────

export class RegistrationRepository {
  readonly #pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.#pool = pool;
  }

  /**
   * Find an active (non-terminal) registration for the given channel+userId.
   * Returns null if none exists.
   */
  async findActiveByChannelUser(
    channel: string,
    channelUserId: string,
  ): Promise<RegistrationRecord | null> {
    const result = await this.#pool.query<RegistrationRow>(
      `SELECT * FROM registrations
       WHERE channel = $1 AND channel_user_id = $2
       AND state NOT IN ('EXPIRED', 'FAILED', 'PRE_AUTH_TOKEN_ISSUED')
       LIMIT 1`,
      [channel, channelUserId],
    );
    if (result.rows.length === 0) return null;
    return rowToRecord(result.rows[0]);
  }

  /**
   * Find the most recent completed registration (state = PRE_AUTH_TOKEN_ISSUED) for the
   * given channel+userId created within the specified age window.
   *
   * Used by the re-registration check in the engine: if a recently-completed registration
   * exists, the engine warns the user before creating a new one (AC-002, CELLO-M6B-011).
   *
   * @param channel - Channel type (telegram, whatsapp, cli)
   * @param channelUserId - Channel user identifier
   * @param maxAgeMs - Maximum age in milliseconds (e.g. 30 * 24 * 60 * 60 * 1000 for 30 days)
   * @returns { id, created_at } of the most recent completed registration, or null if none
   *   within the window.
   */
  async findCompletedByChannelUser(
    channel: string,
    channelUserId: string,
    maxAgeMs: number,
  ): Promise<{ id: string; created_at: Date; emailStubHash: string | null } | null> {
    const since = new Date(Date.now() - maxAgeMs);
    const result = await this.#pool.query<{ id: string; created_at: Date; email_stub_hash: string | null }>(
      `SELECT id, created_at, email_stub_hash FROM registrations
       WHERE channel = $1 AND channel_user_id = $2
         AND state = 'PRE_AUTH_TOKEN_ISSUED'
         AND created_at > $3
       ORDER BY created_at DESC LIMIT 1`,
      [channel, channelUserId, since],
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return { id: row.id, created_at: row.created_at, emailStubHash: row.email_stub_hash };
  }

  /**
   * Find a registration by its UUID primary key.
   * Returns null if not found.
   */
  async findById(id: string): Promise<RegistrationRecord | null> {
    const result = await this.#pool.query<RegistrationRow>(
      `SELECT * FROM registrations WHERE id = $1`,
      [id],
    );
    if (result.rows.length === 0) return null;
    return rowToRecord(result.rows[0]);
  }

  /**
   * Load all active (non-terminal) registrations.
   * Used at startup for restart recovery (AC-007).
   */
  async loadAllActive(): Promise<RegistrationRecord[]> {
    const result = await this.#pool.query<RegistrationRow>(
      `SELECT * FROM registrations
       WHERE state NOT IN ('EXPIRED', 'FAILED', 'PRE_AUTH_TOKEN_ISSUED')`,
    );
    return result.rows.map(rowToRecord);
  }

  /**
   * Find all active registrations whose expiresAt < now.
   * Used by the expiry sweep.
   */
  async findExpiredActive(now: Date): Promise<RegistrationRecord[]> {
    const result = await this.#pool.query<RegistrationRow>(
      `SELECT * FROM registrations
       WHERE state NOT IN ('EXPIRED', 'FAILED', 'PRE_AUTH_TOKEN_ISSUED')
       AND expires_at < $1`,
      [now],
    );
    return result.rows.map(rowToRecord);
  }

  /**
   * Insert a new registration record.
   * Computes the root chain hash: SHA-256(id).
   * Returns the created record with its DB-assigned id.
   */
  async insert(params: {
    phoneStubHash: string;
    channel: "telegram" | "whatsapp" | "cli";
    channelUserId: string;
    state: string;
    expiresAt: Date;
  }): Promise<RegistrationRecord> {
    const id = randomUUID();
    const now = new Date();
    const chainHash = computeRootChainHash(id);

    const result = await this.#pool.query<RegistrationRow>(
      `INSERT INTO registrations
         (id, phone_stub_hash, channel, channel_user_id, state, expires_at,
          created_at, updated_at, chain_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        id,
        params.phoneStubHash,
        params.channel,
        params.channelUserId,
        params.state,
        params.expiresAt,
        now,
        now,
        chainHash,
      ],
    );
    return rowToRecord(result.rows[0]);
  }

  /**
   * Transition the registration to a new state, updating columns as specified.
   * Computes the new chain hash from the previous one.
   * Returns the updated RegistrationRecord.
   *
   * @param updates.otpAttemptCount - When provided, sets otp_attempt_count to this value.
   *   When omitted (undefined), the existing count is preserved via COALESCE.
   *   Always pass `otpAttemptCount: 0` explicitly when transitioning to AWAITING_EMAIL_OTP
   *   to ensure the attempt counter starts fresh.
   * @param updates.clearOtp - When true, sets otp_hash, otp_salt, otp_expires_at to NULL
   *   unconditionally (ignoring otpHash/otpSalt/otpExpiresAt values if also provided).
   *   When falsy (default), uses COALESCE so omitted OTP fields preserve existing values.
   *   Use clearOtp: true when the OTP must be explicitly invalidated (e.g. EMAIL_CONFIRMED).
   */
  async transition(
    id: string,
    newState: string,
    updates: {
      phoneStubHash?: string;
      emailStubHash?: string | null;
      otpHash?: string | null;
      otpSalt?: string | null;
      otpExpiresAt?: Date | null;
      otpAttemptCount?: number;
      stateData?: Record<string, unknown>;
      expiresAt?: Date;
      clearOtp?: boolean;
    } = {},
  ): Promise<RegistrationRecord> {
    // Fetch the current row to get prev chain_hash
    const prevResult = await this.#pool.query<RegistrationRow>(
      `SELECT chain_hash FROM registrations WHERE id = $1`,
      [id],
    );
    if (prevResult.rows.length === 0) {
      throw new Error(`Registration not found: ${id}`);
    }
    const prevChainHash = prevResult.rows[0].chain_hash;
    const now = new Date();
    const newChainHash = computeTransitionChainHash(prevChainHash, id, newState, now);

    // OTP columns use COALESCE by default so omitted values preserve existing DB values.
    // When clearOtp=true, write NULL directly — bypassing COALESCE — to explicitly
    // invalidate the OTP (e.g. after successful email verification).
    const clearOtp = updates.clearOtp === true;

    const result = await this.#pool.query<RegistrationRow>(
      `UPDATE registrations SET
         state = $1,
         updated_at = $2,
         chain_hash = $3,
         phone_stub_hash = COALESCE($4, phone_stub_hash),
         email_stub_hash = COALESCE($5, email_stub_hash),
         otp_hash = CASE WHEN $6 THEN NULL ELSE COALESCE($7, otp_hash) END,
         otp_salt = CASE WHEN $6 THEN NULL ELSE COALESCE($8, otp_salt) END,
         otp_expires_at = CASE WHEN $6 THEN NULL ELSE COALESCE($9, otp_expires_at) END,
         otp_attempt_count = COALESCE($10, otp_attempt_count),
         state_data = COALESCE($11, state_data),
         expires_at = COALESCE($12, expires_at)
       WHERE id = $13
       RETURNING *`,
      [
        newState,
        now,
        newChainHash,
        updates.phoneStubHash !== undefined ? updates.phoneStubHash : null,
        updates.emailStubHash !== undefined ? updates.emailStubHash : null,
        clearOtp,
        !clearOtp && updates.otpHash !== undefined ? updates.otpHash : null,
        !clearOtp && updates.otpSalt !== undefined ? updates.otpSalt : null,
        !clearOtp && updates.otpExpiresAt !== undefined ? updates.otpExpiresAt : null,
        updates.otpAttemptCount !== undefined ? updates.otpAttemptCount : null,
        updates.stateData !== undefined ? JSON.stringify(updates.stateData) : null,
        updates.expiresAt !== undefined ? updates.expiresAt : null,
        id,
      ],
    );
    if (result.rows.length === 0) {
      throw new Error(`Registration transition failed — row not found: ${id}`);
    }
    return rowToRecord(result.rows[0]);
  }

  /**
   * Atomically transition to AWAITING_EMAIL on OTP lockout.
   * Performs in a single transaction:
   *   - Sets state = 'AWAITING_EMAIL'
   *   - Clears otp_hash, otp_salt, otp_expires_at to NULL
   *   - Resets otp_attempt_count to 0
   *   - Computes and writes new chain_hash
   *   - Sets updated_at = now()
   *
   * A crash between incrementOtpAttempt and transition would leave the record
   * in AWAITING_EMAIL_OTP with a cleared hash — a dead-end state. This method
   * ensures both operations succeed or both fail.
   */
  async transitionOnOtpLockout(id: string): Promise<RegistrationRecord> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const prevResult = await client.query<{ chain_hash: string }>(
        "SELECT chain_hash FROM registrations WHERE id = $1 FOR UPDATE",
        [id],
      );
      if (prevResult.rows.length === 0) {
        throw new Error(`Registration not found: ${id}`);
      }
      const now = new Date();
      const newChainHash = computeTransitionChainHash(
        prevResult.rows[0].chain_hash,
        id,
        "AWAITING_EMAIL",
        now,
      );
      const result = await client.query<RegistrationRow>(
        `UPDATE registrations SET
           state = 'AWAITING_EMAIL',
           updated_at = $1,
           chain_hash = $2,
           otp_hash = NULL,
           otp_salt = NULL,
           otp_expires_at = NULL,
           otp_attempt_count = 0
         WHERE id = $3
         RETURNING *`,
        [now, newChainHash, id],
      );
      await client.query("COMMIT");
      return rowToRecord(result.rows[0]);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Increment the OTP attempt count. Does not clear OTP fields — lockout uses transitionOnOtpLockout().
   * Returns the updated record.
   */
  async incrementOtpAttempt(id: string): Promise<RegistrationRecord> {
    const prevResult = await this.#pool.query<RegistrationRow>(
      `SELECT chain_hash, state FROM registrations WHERE id = $1`,
      [id],
    );
    if (prevResult.rows.length === 0) {
      throw new Error(`Registration not found: ${id}`);
    }
    const { chain_hash: prevChainHash, state } = prevResult.rows[0];
    const now = new Date();
    const newChainHash = computeTransitionChainHash(prevChainHash, id, state, now);

    const result = await this.#pool.query<RegistrationRow>(
      `UPDATE registrations SET
         otp_attempt_count = otp_attempt_count + 1,
         updated_at = $1,
         chain_hash = $2
       WHERE id = $3
       RETURNING *`,
      [now, newChainHash, id],
    );
    return rowToRecord(result.rows[0]);
  }

  /**
   * Refresh updatedAt and expiresAt for a record without changing state.
   * Used for AWAITING_CONTACT re-prompts to prevent 7-day expiry.
   */
  async touchTimestamps(id: string, newExpiresAt: Date): Promise<void> {
    const prevResult = await this.#pool.query<RegistrationRow>(
      `SELECT chain_hash, state FROM registrations WHERE id = $1`,
      [id],
    );
    if (prevResult.rows.length === 0) return;
    const { chain_hash: prevChainHash, state } = prevResult.rows[0];
    const now = new Date();
    const newChainHash = computeTransitionChainHash(prevChainHash, id, state, now);
    await this.#pool.query(
      `UPDATE registrations SET updated_at = $1, expires_at = $2, chain_hash = $3 WHERE id = $4`,
      [now, newExpiresAt, newChainHash, id],
    );
  }

  /**
   * Fetch the otp_salt for a record — used at OTP verification time.
   * otpSalt is intentionally NOT in RegistrationRecord (design decision).
   */
  async getOtpSalt(id: string): Promise<string | null> {
    const result = await this.#pool.query<{ otp_salt: string | null }>(
      `SELECT otp_salt FROM registrations WHERE id = $1`,
      [id],
    );
    if (result.rows.length === 0) return null;
    return result.rows[0].otp_salt;
  }

  /**
   * Fetch a single field from state_data JSONB for a registration record.
   * Used to retrieve expectedEmailStubHash for email continuity enforcement.
   */
  async getStateDataField(id: string, field: string): Promise<unknown> {
    const result = await this.#pool.query<{ state_data: Record<string, unknown> }>(
      `SELECT state_data FROM registrations WHERE id = $1`,
      [id],
    );
    if (result.rows.length === 0) return null;
    return result.rows[0].state_data[field] ?? null;
  }

  /**
   * Fetch the email_stub_hash for a registration record.
   * Used during email continuity enforcement to compare against expected hash.
   */
  async getEmailStubHash(id: string): Promise<string | null> {
    const result = await this.#pool.query<{ email_stub_hash: string | null }>(
      `SELECT email_stub_hash FROM registrations WHERE id = $1`,
      [id],
    );
    if (result.rows.length === 0) return null;
    return result.rows[0].email_stub_hash;
  }

  /**
   * Upsert a channel identity record. Called when a registration reaches PRE_AUTH_TOKEN_ISSUED.
   * Uses INSERT ... ON CONFLICT to update existing rows (same phone + channel = same row).
   * SI-001: channel_user_id stays in ops-agent DB, never sent to directory.
   */
  async upsertChannelIdentity(
    phoneStubHash: string,
    channel: string,
    channelUserId: string,
  ): Promise<void> {
    await this.#pool.query(
      `INSERT INTO channel_identities (phone_stub_hash, channel, channel_user_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (phone_stub_hash, channel) DO UPDATE SET
         channel_user_id = EXCLUDED.channel_user_id,
         updated_at = now()`,
      [phoneStubHash, channel, channelUserId],
    );
  }
}
