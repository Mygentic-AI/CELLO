/**
 * registration-state.ts — Registration state machine types for the Operations Agent.
 *
 * Phase A — Architecture note:
 *   RegistrationState is a discriminated union on the `state` field.
 *   Each variant carries only the fields relevant to that state.
 *   RegistrationRecord wraps the state with persistent identity fields.
 *
 *   Design decisions (see schema_assessment in CELLO-OPS-AGENT-000.yaml):
 *
 *   1. chainHash is intentionally omitted from RegistrationRecord.
 *      It is a persistence-layer concern — computed and stored by the DB layer.
 *      Application code never reads or writes chainHash directly.
 *
 *   2. otpSalt is intentionally omitted from AWAITING_EMAIL_OTP.
 *      The salt is fetched from the DB row at OTP verification time.
 *      Surfacing it in the discriminated union would expose it to layers
 *      that should not need it.
 *
 *   3. RegistrationRecord is the application-layer type consumed by the state
 *      machine engine (OPS-AGENT-002). The DB repository layer has its own
 *      row type that includes chainHash, otpSalt, and other persistence fields.
 *
 * chain_hash computation (application-layer formula):
 *   Root record:  SHA-256(id)
 *   Transition:   SHA-256(prior_chain_hash || id || new_state || new_updated_at)
 *   All inputs are UTF-8 strings; new_updated_at uses ISO 8601 format.
 *   The SQL migration adds the chain_hash column with this formula in a comment.
 *   No DB trigger — this is computed in application code before each UPDATE.
 */

/**
 * RegistrationState — discriminated union of all registration state machine states.
 *
 * States:
 *   INITIAL              — record created, /start or first message received
 *   AWAITING_CONTACT     — request_contact button sent; waiting for user to share phone
 *   PHONE_CONFIRMED      — phone number verified via Telegram contact.user_id
 *   AWAITING_EMAIL       — bot prompted for email address; waiting for input
 *   AWAITING_EMAIL_OTP   — OTP sent to email; waiting for user to enter it
 *   EMAIL_CONFIRMED      — OTP verified; email confirmed
 *   PRE_AUTH_TOKEN_ISSUED — token issued and delivered to operator; terminal success state
 *   EXPIRED              — idle timeout (7 days) or OTP-exhausted; terminal failure state
 *   FAILED               — explicit failure with reason; terminal failure state
 */
export type RegistrationState =
  | { state: "INITIAL" }
  | { state: "AWAITING_CONTACT" }
  | { state: "PHONE_CONFIRMED" }
  | { state: "AWAITING_EMAIL" }
  | {
      state: "AWAITING_EMAIL_OTP";
      /** SHA-256(otp + salt) hex — stored in the record, compared at verification (SI-001) */
      otpHash: string;
      /** When this OTP expires (15-minute window) */
      otpExpiresAt: Date;
      /** Number of failed verification attempts (max 3 before requiring new OTP send) */
      attemptCount: number;
    }
  | { state: "EMAIL_CONFIRMED" }
  | { state: "PRE_AUTH_TOKEN_ISSUED" }
  | { state: "EXPIRED" }
  | { state: "FAILED"; reason: string };

/**
 * RegistrationRecord — the application-layer representation of a registration.
 * Combines the persistent identity fields with the current RegistrationState.
 *
 * NOTE: chainHash is intentionally omitted — it is a persistence-layer concern only.
 * NOTE: otpSalt is intentionally omitted from AWAITING_EMAIL_OTP — fetched from DB at verify time.
 */
export type RegistrationRecord = {
  /** UUID primary key */
  id: string;
  /** SHA-256 hash of the operator's phone stub — never the raw phone number */
  phoneStubHash: string;
  /** Channel through which this registration was initiated */
  channel: "telegram" | "whatsapp" | "cli";
  /** Channel-native user identifier (Telegram user ID, WhatsApp JID, etc.) */
  channelUserId: string;
  /** When this registration record was created */
  createdAt: Date;
  /** When this registration record was last updated */
  updatedAt: Date;
  /** When this registration record expires (7-day idle timeout) */
  expiresAt: Date;
  /**
   * SHA-256 hash of the normalized (lowercased, trimmed) email address.
   * null before the AWAITING_EMAIL_OTP transition — set when the operator provides
   * their email address and the hash is computed.
   * Mirrors the nullable email_stub_hash TEXT column in the registrations table.
   * The full email address is never persisted anywhere.
   */
  emailStubHash: string | null;
} & RegistrationState;
