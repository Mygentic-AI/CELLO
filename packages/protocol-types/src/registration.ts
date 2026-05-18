/**
 * CELLO Registration Wire Types — REG-001
 *
 * Phase P — Pseudocode
 * ─────────────────────────────────────────────────────────────────────────────
 * Registration flow (CELLO-REG-001):
 *
 * CLIENT → DIRECTORY (on existing authenticated /cello/signaling/1.0.0 stream):
 *   1. Client generates ML-DSA-44 keypair via mlDsaKeygen() (NIST FIPS 204)
 *   2. Client sends register_request { phone_stub, k_local_pubkey, ml_dsa_pubkey }
 *
 * DIRECTORY validates:
 *   a. phone_stub non-empty → else register_error { reason: 'invalid_verification' }
 *   b. k_local_pubkey not already in AgentProfile → else register_error { reason: 'already_registered' }
 *   c. SHA-256(phone_stub) not already in any AgentProfile.phone_stub_hash → else register_error { reason: 'phone_already_claimed' }
 *   d. Must be authenticated (signaling_auth_ok) → else register_error { reason: 'not_authenticated' }
 *
 * DIRECTORY triggers FROST DKG:
 *   - Calls bootstrapKeyShares for this agent (test path: createInProcessStubs in NODE_ENV=test)
 *   - In production: real DKG over /cello/frost/1.0.0 streams
 *   - Waits for DKG to complete and primary_pubkey to be derived
 *   - If DKG fails / below threshold → register_error { reason: 'dkg_failed' }
 *
 * CLIENT → DIRECTORY (after local DKG participation):
 *   3. Client runs bootstrapNetworkKeyShares (or createInProcessStubs in test) → primary_pubkey
 *   4. Client sends dkg_complete { primary_pubkey }
 *
 * DIRECTORY verifies dkg_complete:
 *   - Checks primary_pubkey is consistent with the commitments stored during DKG
 *   - If mismatch → register_error { reason: 'dkg_verification_failed' }
 *
 * DIRECTORY on success:
 *   - Generates 16-byte CSPRNG agent_id
 *   - Stores AgentProfile { k_local_pubkey, primary_pubkey, ml_dsa_pubkey, phone_stub_hash: SHA-256(phone_stub), ... }
 *   - NEVER stores raw phone_stub (SI-001)
 *   - Sends register_success { agent_id, primary_pubkey }
 *
 * CLIENT on register_success:
 *   - Stores RegistrationState locally
 *   - register() returns RegistrationState
 *   - Subsequent register() calls return { error: 'already_registered' }
 *
 * Phone stub SHA-256: per FIPS 180-4
 * ML-DSA keypair: per NIST FIPS 204 (ML-DSA-44, 1312-byte public key)
 * primary_pubkey: derived from FROST DKG ceremony (RFC 9591)
 *
 * Security invariants:
 *   SI-001: phone_stub raw value NEVER stored, logged, or returned in any error
 *   SI-002: no profile created without successful FROST DKG with verified primary_pubkey
 *   SI-003: FROST DKG shares NEVER appear in wire messages, logs, profiles, or API responses
 *   SI-004: register_request rejected with not_authenticated if auth not completed
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── Direction: client → directory ───────────────────────────────────────────

/**
 * Step 1: Client requests registration. Sent on the authenticated signaling stream.
 * SI-004: The stream must have completed signaling_auth_ok before this frame is processed.
 */
export interface RegisterRequest {
  type: "register_request";
  /** Phone stub — validated non-empty by directory. Raw value NEVER persisted. */
  phone_stub: string;
  /** Hex-encoded K_local public key (32 bytes) */
  k_local_pubkey: string;
  /** Hex-encoded ML-DSA-44 public key (1312 bytes, NIST FIPS 204) */
  ml_dsa_pubkey: string;
}

/**
 * Step 2: Client completes local DKG and sends primary_pubkey.
 * Sent after client receives the DKG material and derives the group public key.
 * primary_pubkey is derived from FROST commitments (RFC 9591).
 */
export interface DkgComplete {
  type: "dkg_complete";
  /** Hex-encoded FROST group public key (32 bytes). Derived from DKG commitments. */
  primary_pubkey: string;
}

// ─── Direction: directory → client ───────────────────────────────────────────

/**
 * Directory authorizes the client to open DKG streams.
 * Sent on the signaling stream after register_request is validated (steps 1–3 pass).
 * Client opens /cello/frost/1.0.0 streams to each directory node and runs the DKG rounds.
 * RFC 9591 §5 (FROST DKG), sent before client opens DKG streams.
 */
export interface DkgReady {
  type: "dkg_ready";
  /** Epoch ID for this DKG instance: "${k_local_pubkey}:epoch:1" */
  epochId: string;
  /** Total number of participants in this DKG instance */
  participants: number;
  /** Minimum threshold for signing */
  threshold: number;
}

/**
 * Directory confirms successful registration.
 * primary_pubkey here is the canonical value stored in the AgentProfile.
 */
export interface RegisterSuccess {
  type: "register_success";
  /** Hex-encoded 16-byte CSPRNG agent ID */
  agent_id: string;
  /** Hex-encoded FROST group public key (32 bytes) — confirms what directory stored */
  primary_pubkey: string;
}

/**
 * Directory rejects registration.
 * SI-001: reason field NEVER carries raw phone_stub.
 */
export interface RegisterError {
  type: "register_error";
  reason: RegisterErrorReason;
  /** Only set when reason === "already_registered" — allows client to reconstruct state */
  agent_id?: string;
  primary_pubkey?: string;
  ml_dsa_pubkey?: string;
}

export type RegisterErrorReason =
  | "already_registered"     // same k_local_pubkey already has a profile
  | "phone_already_claimed"  // SHA-256(phone_stub) matches an existing profile
  | "invalid_verification"   // phone_stub is empty or otherwise invalid
  | "dkg_failed"             // FROST DKG below threshold or ceremony failure
  | "not_authenticated"      // register_request arrived before signaling_auth_ok
  | "dkg_verification_failed"; // primary_pubkey from dkg_complete doesn't match DKG commitments

// ─── AgentProfile (stored in DirectoryStore) ────────────────────────────────

/**
 * Stored profile for a registered agent.
 * Created only after successful FROST DKG (SI-002).
 * phone_stub_hash = SHA-256(phone_stub) per FIPS 180-4 — raw phone_stub never stored (SI-001).
 */
export interface AgentProfile {
  /** Hex-encoded K_local public key (32 bytes) — primary lookup key */
  k_local_pubkey: string;
  /** Hex-encoded FROST group public key (32 bytes) */
  primary_pubkey: string;
  /** Hex-encoded ML-DSA-44 public key (1312 bytes, FIPS 204) */
  ml_dsa_pubkey: string;
  /** Hex SHA-256(phone_stub) — 32 bytes per FIPS 180-4. Raw phone_stub NEVER stored. */
  phone_stub_hash: string;
  /** Extensible agent profile data — empty in M3 */
  profile: Record<string, unknown>;
  /** Unix ms timestamp of registration */
  registered_at: number;
  /** Profile status */
  status: "active";
  /** Hex-encoded 16-byte CSPRNG agent ID */
  agent_id: string;
}

// ─── RegistrationState (stored locally by client) ────────────────────────────

/**
 * Local registration state persisted by the client after register_success.
 * Returned by CelloClient.register().
 */
export interface RegistrationState {
  /** Hex-encoded 16-byte agent ID from the directory */
  agent_id: string;
  /** Hex-encoded FROST group public key (32 bytes) */
  primary_pubkey: string;
  /** Hex-encoded ML-DSA-44 public key (1312 bytes) */
  ml_dsa_pubkey: string;
  /** Unix ms timestamp of registration */
  registered_at: number;
  /** Registration status */
  status: "active";
}
