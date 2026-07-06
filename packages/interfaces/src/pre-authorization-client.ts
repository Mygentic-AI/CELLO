/**
 * PreAuthorizationClient — interface for requesting pre-authorization tokens
 * from the directory after a registration ceremony completes phone + email verification.
 *
 * Phase A — Architecture note:
 *   The Operations Agent state machine calls this interface after EMAIL_CONFIRMED
 *   to obtain the token that the operator sets in CELLO_REGISTRATION_TOKEN.
 *
 *   Local stub: LocalPreAuthorizationClient (returns 'DEV-CELLO-' + 16 hex chars;
 *               uses crypto.randomBytes(8) — no network, no config required)
 *   Production implementation: DirectoryPreAuthorizationClient (calls POST /internal/pre-authorize)
 *
 * Token format (production):
 *   "CELLO-" + 33 base58 chars (Bitcoin alphabet: 1-9A-HJ-NP-Za-km-z)
 *   58^33 ≈ 2^194.9 bits of entropy — exceeds the 192-bit SI-001 minimum.
 *   Generated from crypto.randomBytes(25) → base58 encode → take 33 chars.
 *
 * Token format (dev stub):
 *   "DEV-CELLO-" + 16 hex chars (from crypto.randomBytes(8))
 *   The "DEV-" prefix marks the token as a non-production stub token.
 *   Security properties of SI-001 do not apply to the dev stub.
 */

/**
 * PreAuthorizationToken — the application-layer representation of an issued token.
 * Does NOT include id or registrationId — those are persistence-layer concerns.
 * Does NOT include chainHash — that is computed and stored by the repository layer.
 */
export type PreAuthorizationToken = {
  /** Production format: "CELLO-" + 33 base58 chars (≥193 bits of entropy, SI-001) */
  token: string;
  /** SHA-256 hash of the operator's phone stub — links token to the phone-verified identity */
  phoneStubHash: string;
  /** SHA-256 hash of the normalized email — links token to the email-verified identity */
  emailStubHash: string;
  /** Timestamp when this token was issued */
  issuedAt: Date;
  /** Expiry timestamp — 24h TTL after issuance */
  expiresAt: Date;
  /** Timestamp when this token was consumed by cello_register(); null until consumed */
  consumedAt: Date | null;
};

/**
 * PreAuthorizationTokenRow — the database row representation.
 * Extends PreAuthorizationToken with the persistence-layer fields.
 * Used by the directory's repository layer only — not by application consumers.
 */
export type PreAuthorizationTokenRow = PreAuthorizationToken & {
  /** Database-assigned UUID primary key */
  id: string;
  /** UUID of the registration record that triggered token issuance */
  registrationId: string;
};

/**
 * PreAuthorizationClient — requests a pre-authorization token from the directory
 * after both phone and email verification are complete.
 */
export interface PreAuthorizationClient {
  /**
   * Request a pre-authorization token for the given phone stub hash and email stub hash.
   * The caller has already verified both; this method records the verification outcome
   * and returns the token that the operator will configure on their agent.
   *
   * Returns { token: string } — the token string only.
   * The full PreAuthorizationToken (TTL, timestamps) is managed by the directory
   * and is not surfaced to the Operations Agent.
   */
  requestToken(phoneStubHash: string, emailStubHash: string, registrationId: string): Promise<{ token: string; claimCode?: string }>;
}
