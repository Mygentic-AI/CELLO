/**
 * Pre-Authorization Token Repository — OPS-AGENT-001
 *
 * Handles pre_authorization_tokens table operations for the CELLO Directory.
 *
 * Token format: "CELLO-" + 33 base58 chars (Bitcoin alphabet, no 0/O/I/l).
 * Entropy: 58^33 ≈ 2^194.9 bits — exceeds the 192-bit SI-003 minimum.
 * Generation: rejection sampling — crypto.randomBytes(25) → base58 encode → accept only if exactly 33 chars.
 *
 * Atomic consumption (SI-002, RFC 9591):
 *   UPDATE pre_authorization_tokens
 *   SET consumed_at = now()
 *   WHERE token = $1 AND consumed_at IS NULL AND expires_at > now()
 *   RETURNING id, phone_stub_hash, email_stub_hash
 * Check rowCount. If 0 → determine whether token is consumed or expired via separate SELECT.
 *
 * Account deduplication (AC-005b):
 *   lookupOrCreateAccount: INSERT INTO user_accounts ON CONFLICT DO NOTHING, then SELECT.
 *   Same phone_stub_hash → same account_id across multiple registrations.
 *
 * Crypto references:
 *   FIPS 180-4 (SHA-256 for chain_hash)
 *   RFC 9591 (FROST token consumption atomicity pattern)
 *   NIST SP 800-90A (CSPRNG — crypto.randomBytes)
 */

import { randomBytes, createHash, randomUUID } from "node:crypto";
import type pg from "pg";
import type { Logger } from "@cello-protocol/interfaces";
import { signCapability, encodeCapability } from "@cello-protocol/crypto";
import type { KeyProvider } from "@cello-protocol/crypto";

// ─── Bitcoin base58 alphabet (no 0/O/I/l) ─────────────────────────────────────

export const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

// ─── Token generation ─────────────────────────────────────────────────────────

/**
 * Generate a single-use pre-authorization token.
 *
 * Pseudocode:
 *   1. Generate 25 random bytes via CSPRNG (NIST SP 800-90A).
 *   2. Convert to a BigInt and encode in base58.
 *   3. Rejection sampling: if the encoding is not exactly 33 chars, regenerate.
 *   4. Prepend "CELLO-".
 *
 * Entropy: 58^33 ≈ 2^194.9 bits (> 192-bit minimum per SI-003).
 *
 * Rejection sampling is used instead of pad/truncate to preserve all 193.9 bits
 * of entropy. The probability of a 25-byte random input NOT producing a 33-char
 * base58 output is very small (< 2%) so rejection loops terminate quickly.
 *
 * Note: base58(25 bytes) produces 33 chars for most random inputs.
 * '1' (first base58 char) is the zero-encoding convention (Bitcoin base58).
 */
export function generatePreAuthToken(): string {
  // Loop until we get exactly 33 base58 chars — rejection sampling preserves full entropy.
  // Each iteration has > 98% probability of success so average iterations ≈ 1.02.
  for (;;) {
    // 25 bytes = 200 bits of raw entropy (NIST SP 800-90A)
    const raw = randomBytes(25);

    // Convert bytes to BigInt (big-endian)
    let n = BigInt(0);
    for (const byte of raw) {
      n = (n << 8n) | BigInt(byte);
    }

    // Base58 encode
    const digits: string[] = [];
    while (n > 0n) {
      const rem = Number(n % 58n);
      digits.unshift(BASE58_ALPHABET[rem]!);
      n = n / 58n;
    }

    // Left-pad with '1' (base58 zero-character) for leading zero bytes
    while (digits.length < 33) {
      digits.unshift("1");
    }

    // Rejection sampling: only accept exactly 33-char encodings (CRIT-2: no truncation)
    if (digits.length === 33) {
      return `CELLO-${digits.join("")}`;
    }
    // digits.length > 33 → try again with fresh random bytes
  }
}

// ─── Token issuance ───────────────────────────────────────────────────────────

export interface IssuePreAuthTokenParams {
  /** SHA-256(phone_stub) from the verified phone number */
  phoneStubHash: string;
  /** SHA-256(normalized_email) from the verified email */
  emailStubHash: string;
  /** UUID of the registration record that authorized this token */
  registrationId: string;
}

export interface IssuePreAuthTokenResult {
  /** The token string: "CELLO-" + 33 base58 chars */
  token: string;
  /** Database row UUID */
  tokenId: string;
  /** Expiry timestamp (24h TTL) */
  expiresAt: Date;
}

/**
 * Issue a pre-authorization token and persist it to the database.
 *
 * Pseudocode:
 *   1. Generate token via generatePreAuthToken().
 *   2. Compute expiresAt = now() + 24h.
 *   3. Compute chain_hash = SHA-256(id || token || issued_at).
 *      For root record (table may not be empty): use standard hash.
 *   4. INSERT into pre_authorization_tokens.
 *   5. Return { token, tokenId, expiresAt }.
 *
 * Never throws on unique constraint — retries with a new token (extremely rare).
 */
export async function issuePreAuthToken(
  pool: pg.Pool,
  params: IssuePreAuthTokenParams,
): Promise<IssuePreAuthTokenResult> {
  const TTL_MS = 24 * 60 * 60 * 1000;

  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const token = generatePreAuthToken();
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + TTL_MS);

    // Compute chain_hash — simplified for now (root-level computation)
    // The full chain-hash pattern is SHA-256(prev_chain_hash || id || token || issued_at)
    // but the id isn't known until after INSERT. We use a two-step approach:
    // first INSERT with a placeholder, then UPDATE with the real hash.
    // Simpler: use SHA-256(token || issued_at) as the genesis chain hash.
    const chainHash = createHash("sha256")
      .update(token)
      .update(issuedAt.toISOString())
      .digest("hex");

    try {
      const result = await pool.query<{ id: string }>(
        `INSERT INTO pre_authorization_tokens
           (token, phone_stub_hash, email_stub_hash, registration_id, issued_at, expires_at, consumed_at, chain_hash)
         VALUES ($1, $2, $3, $4, $5, $6, NULL, $7)
         RETURNING id`,
        [
          token,
          params.phoneStubHash,
          params.emailStubHash,
          params.registrationId,
          issuedAt.toISOString(),
          expiresAt.toISOString(),
          chainHash,
        ],
      );
      const tokenId = result.rows[0]!.id;
      return { token, tokenId, expiresAt };
    } catch (err: unknown) {
      // Only retry on unique constraint violation (duplicate token — astronomically rare)
      const pgErr = err as { code?: string };
      if (pgErr.code === "23505") {
        lastError = err;
        continue;
      }
      throw err;
    }
  }
  throw lastError ?? new Error("Failed to insert token after 3 attempts");
}

// ─── Capability issuance (M8B-PREAUTH-CAP) ──────────────────────────────────────

export interface IssuePreAuthCapabilityResult {
  /** base64url-encoded signed capability — the self-verifying credential the agent presents at DKG. */
  capability: string;
  /** #2b: the short, typeable claim-code the operator sets as CELLO_REGISTRATION_TOKEN ("CELLO-" + 33
   *  base58). The agent redeems it (redeem_claim_code) for `capability`, so the operator never handles
   *  the ~570-char blob. Stored in capability_claim_codes keyed by this code. */
  claimCode: string;
  /** The capability's random 128-bit nonce (hex) — also the audit-row key in pre_authorization_tokens. */
  nonce: string;
  /** Database row UUID of the audit record. */
  tokenId: string;
  /** Expiry timestamp (24h TTL). */
  expiresAt: Date;
}

/**
 * Issue a signed pre-authorization CAPABILITY (M8B-PREAUTH-CAP). Replaces issuePreAuthToken for T-of-N
 * registration: the returned blob is a permission slip every directory verifies independently against the
 * pinned issuer pubkey (no DB lookup, no consume race). An audit row is still written to
 * pre_authorization_tokens (keyed on the nonce, for issuance/expiry traceability); single-use is enforced
 * downstream by the directory's local nonce→epoch binding, NOT by consuming this row.
 *
 * The capability's `nonce` is a fresh 128-bit CSPRNG value (crypto.randomBytes). Crypto: RFC 8032.
 */
export async function issuePreAuthCapability(
  pool: pg.Pool,
  issuerKeyProvider: KeyProvider,
  params: IssuePreAuthTokenParams,
): Promise<IssuePreAuthCapabilityResult> {
  const TTL_MS = 24 * 60 * 60 * 1000;

  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const nonce = randomBytes(16).toString("hex"); // 128-bit replay identity
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + TTL_MS);
    const chainHash = createHash("sha256").update(nonce).update(issuedAt.toISOString()).digest("hex");

    try {
      const result = await pool.query<{ id: string }>(
        `INSERT INTO pre_authorization_tokens
           (token, phone_stub_hash, email_stub_hash, registration_id, issued_at, expires_at, consumed_at, chain_hash)
         VALUES ($1, $2, $3, $4, $5, $6, NULL, $7)
         RETURNING id`,
        [
          nonce, // the nonce is the audit-row key (the "token" column)
          params.phoneStubHash,
          params.emailStubHash,
          params.registrationId,
          issuedAt.toISOString(),
          expiresAt.toISOString(),
          chainHash,
        ],
      );
      const tokenId = result.rows[0]!.id;
      const cap = await signCapability(
        {
          nonce,
          phone_stub_hash: params.phoneStubHash,
          email_domain: params.emailStubHash,
          issued_at: issuedAt.toISOString(),
          expires_at: expiresAt.toISOString(),
        },
        issuerKeyProvider,
      );
      // #2b: mint a short claim-code and store {code -> capability} so the operator handles a short
      // typeable string instead of the ~570-char blob. Reuses generatePreAuthToken() ("CELLO-" + 33
      // base58). The code is a redeem lookup key; the capability itself is still the self-verifying gate.
      const capability = encodeCapability(cap);
      const claimCode = generatePreAuthToken();
      await pool.query(
        `INSERT INTO capability_claim_codes (code, capability, expires_at) VALUES ($1, $2, $3)`,
        [claimCode, capability, expiresAt.toISOString()],
      );
      return { capability, claimCode, nonce, tokenId, expiresAt };
    } catch (err: unknown) {
      const pgErr = err as { code?: string };
      if (pgErr.code === "23505") {
        lastError = err;
        continue;
      }
      throw err;
    }
  }
  throw lastError ?? new Error("Failed to insert capability audit row after 3 attempts");
}

// ─── Token consumption ────────────────────────────────────────────────────────

export type ConsumeTokenResult =
  | { ok: true; tokenId: string; phoneStubHash: string; emailStubHash: string }
  | { ok: false; reason: "PRE_AUTH_TOKEN_CONSUMED" | "PRE_AUTH_TOKEN_EXPIRED" | "PRE_AUTH_TOKEN_NOT_FOUND"; tokenId: string | null };

/**
 * Atomically consume a pre-authorization token.
 *
 * This is the FIRST operation that must happen in the DKG Round 1 handler.
 * No crypto must precede this call.
 *
 * Pseudocode (MED-2: single atomic UPDATE to eliminate TOCTOU):
 *   1. Atomic UPDATE: UPDATE ... SET consumed_at = now()
 *                     WHERE token = $1 AND consumed_at IS NULL AND expires_at > now()
 *                     RETURNING id, phone_stub_hash, email_stub_hash
 *   2. If rowCount = 1 → ok, return token data
 *   3. If rowCount = 0 → disambiguation SELECT to distinguish CONSUMED/EXPIRED/NOT_FOUND:
 *      SELECT id, consumed_at, expires_at FROM pre_authorization_tokens WHERE token = $1
 *      a. No row → PRE_AUTH_TOKEN_NOT_FOUND
 *      b. Row with consumed_at IS NOT NULL → PRE_AUTH_TOKEN_CONSUMED
 *      c. Row with expires_at <= now() → PRE_AUTH_TOKEN_EXPIRED
 *
 * SI-002: The UPDATE is atomic at the database level. Two concurrent UPDATE calls
 * for the same token return rowCount=1 for exactly one caller.
 * MED-2: The expiry check is inside the UPDATE predicate (not a separate SELECT),
 * eliminating the TOCTOU window where a token expiring between SELECT and UPDATE
 * could still be consumed.
 */
export async function consumePreAuthToken(
  pool: pg.Pool,
  token: string,
): Promise<ConsumeTokenResult> {
  // Step 1: Single atomic UPDATE — expiry check IS in the predicate (MED-2)
  // RFC 9591 § pattern: single-use token via conditional update.
  const updateResult = await pool.query<{
    id: string;
    phone_stub_hash: string;
    email_stub_hash: string;
  }>(
    `UPDATE pre_authorization_tokens
     SET consumed_at = now()
     WHERE token = $1 AND consumed_at IS NULL AND expires_at > now()
     RETURNING id, phone_stub_hash, email_stub_hash`,
    [token],
  );

  if (updateResult.rowCount === 1) {
    const updated = updateResult.rows[0]!;
    return {
      ok: true,
      tokenId: updated.id,
      phoneStubHash: updated.phone_stub_hash,
      emailStubHash: updated.email_stub_hash,
    };
  }

  // Step 2: rowCount = 0 → disambiguation SELECT to determine the reason
  const disambig = await pool.query<{
    id: string;
    consumed_at: Date | null;
    expires_at: Date;
  }>(
    "SELECT id, consumed_at, expires_at FROM pre_authorization_tokens WHERE token = $1",
    [token],
  );

  if (disambig.rows.length === 0) {
    return { ok: false, reason: "PRE_AUTH_TOKEN_NOT_FOUND", tokenId: null };
  }

  const row = disambig.rows[0]!;

  if (row.consumed_at !== null) {
    // Another concurrent caller consumed the token (SI-002 atomicity)
    return { ok: false, reason: "PRE_AUTH_TOKEN_CONSUMED", tokenId: row.id };
  }

  // consumed_at IS NULL but UPDATE predicate failed → expires_at <= now()
  return { ok: false, reason: "PRE_AUTH_TOKEN_EXPIRED", tokenId: row.id };
}

// ─── DKG token gate ───────────────────────────────────────────────────────────

export type DkgTokenGateResult =
  | { ok: true; tokenId: string; phoneStubHash: string; emailStubHash: string }
  | {
      ok: false;
      reason:
        | "PRE_AUTH_TOKEN_MISSING"
        | "PRE_AUTH_TOKEN_CONSUMED"
        | "PRE_AUTH_TOKEN_EXPIRED"
        | "PRE_AUTH_TOKEN_NOT_FOUND";
    };

export interface DkgTokenGateParams {
  /** The preAuthToken from the FROST DKG Round 1 frame */
  token: string | undefined | null;
  /** The agent's K_local pubkey hex (for log context) */
  agentId: string;
  /** Correlation ID minted at the start of this DKG flow */
  correlationId: string;
  /** Injected logger — never console.log */
  logger: Pick<Logger, "info" | "warn" | "error">;
}

/**
 * Validate and consume a pre-authorization token at the DKG Round 1 gate.
 *
 * This function must be called as the FIRST operation in the Round 1 handler,
 * before any FROST crypto computation. Consumption-on-presentation ensures that
 * even if DKG fails after this point, the token cannot be reused (AC-006).
 *
 * Observability events emitted:
 *   - preauth.token.consumed (INFO) on success
 *   - preauth.token.missing  (WARN) when token field is absent/empty
 *   - preauth.token.reuse.rejected (WARN) when already consumed
 *   - preauth.token.expired  (WARN) when past 24h TTL
 */
export async function validatePreAuthTokenForDkg(
  pool: pg.Pool,
  params: DkgTokenGateParams,
): Promise<DkgTokenGateResult> {
  const { token, agentId, correlationId, logger } = params;

  // AC-007: missing token → reject immediately, no DB lookup needed
  if (!token || token.length === 0) {
    logger.warn("preauth.token.missing", {
      remoteAgentId: agentId,
      correlationId,
    });
    return { ok: false, reason: "PRE_AUTH_TOKEN_MISSING" };
  }

  // Consume token atomically (FIRST crypto-gate operation)
  const result = await consumePreAuthToken(pool, token);

  if (!result.ok) {
    if (result.reason === "PRE_AUTH_TOKEN_CONSUMED") {
      // result.tokenId is the DB UUID from the disambiguation SELECT (no extra query needed)
      logger.warn("preauth.token.reuse.rejected", {
        tokenId: result.tokenId,
        correlationId,
      });
      return { ok: false, reason: "PRE_AUTH_TOKEN_CONSUMED" };
    }

    if (result.reason === "PRE_AUTH_TOKEN_EXPIRED") {
      // result.tokenId is the DB UUID from the disambiguation SELECT (no extra query needed)
      logger.warn("preauth.token.expired", {
        tokenId: result.tokenId,
        correlationId,
      });
      return { ok: false, reason: "PRE_AUTH_TOKEN_EXPIRED" };
    }

    // NOT_FOUND: MED-1 — use preauth.token.not_found (distinct from missing-field case)
    logger.warn("preauth.token.not_found", {
      tokenPrefix: token.slice(0, 8),
      correlationId,
    });
    return { ok: false, reason: "PRE_AUTH_TOKEN_MISSING" };
  }

  // Token consumed successfully — log the event
  logger.info("preauth.token.consumed", {
    tokenId: result.tokenId,
    agentId,
    correlationId,
  });

  return {
    ok: true,
    tokenId: result.tokenId,
    phoneStubHash: result.phoneStubHash,
    emailStubHash: result.emailStubHash,
  };
}

// ─── Account deduplication ────────────────────────────────────────────────────

export interface LinkAgentToAccountParams {
  /** The UUID of the agent_profiles row (from the profile just created) */
  agentProfileId: string;
  /** The agent's k_local_pubkey hex — used to UPDATE agent_profiles.account_id */
  kLocalPubkey: string;
  /** phone_stub_hash from the consumed pre-authorization token */
  phoneStubHash: string;
  /** Optional email stub hash */
  emailStubHash?: string;
}

/**
 * Look up or create an account for the given phone_stub_hash, link the agent_profile
 * to it by setting account_id, then return the account_id.
 *
 * Pseudocode (AC-005b):
 *   1. SELECT account_id FROM user_accounts WHERE phone_stub_hash = $1
 *   2. If found: use that account_id (same phone → same account)
 *   3. If not found:
 *      a. Generate a new UUID for account_id
 *      b. Compute chain_hash = SHA-256(account_id || phone_stub_hash)
 *      c. INSERT INTO user_accounts (account_id, phone_stub_hash, chain_hash, ...)
 *         ON CONFLICT (phone_stub_hash) DO NOTHING
 *      d. SELECT again (handles race where two parallel inserts both get NOT_FOUND)
 *   4. UPDATE agent_profiles SET account_id = $account_id WHERE k_local_pubkey = $kLocalPubkey
 *   5. Return account_id
 *
 * This implements the INSERT OR IGNORE pattern for account deduplication.
 * The UPDATE in step 4 closes the gap where agent_profiles.account_id would stay NULL.
 */
/**
 * Look up or create the account for a given phone_stub_hash and return its account_id.
 * Steps 1–3 of AC-005b (the deduplication half), WITHOUT touching agent_profiles.
 *
 * Extracted so the registration path can resolve account_id BEFORE it inserts the
 * agent_profiles row, and insert the row WITH account_id atomically. The prior design
 * (insert profile without account_id, then UPDATE it) raced the fire-and-forget profile
 * INSERT: the UPDATE could run on a separate pool connection before the INSERT committed,
 * match 0 rows, and leave account_id permanently NULL. Resolving first removes the race.
 */
export async function resolveAccountId(
  pool: pg.Pool,
  phoneStubHash: string,
  emailStubHash?: string,
): Promise<string> {
  // Step 1: Try to find existing account (same phone → same account).
  const existing = await pool.query<{ account_id: string }>(
    "SELECT account_id FROM user_accounts WHERE phone_stub_hash = $1",
    [phoneStubHash],
  );
  if (existing.rows.length > 0) {
    return existing.rows[0]!.account_id;
  }

  // Step 2: No account — create one (INSERT-OR-IGNORE on the UNIQUE phone_stub_hash).
  const accountId = randomUUID();
  const chainHash = createHash("sha256")
    .update(accountId)
    .update(phoneStubHash)
    .digest("hex");
  try {
    await pool.query(
      `INSERT INTO user_accounts (account_id, phone_stub_hash, email_stub_hash, chain_hash)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (phone_stub_hash) DO NOTHING`,
      [accountId, phoneStubHash, emailStubHash ?? null, chainHash],
    );
  } catch {
    // Swallow — the readback resolves any concurrent-insert race to the winner's id.
  }

  // Step 3: Read back the canonical account_id (handles two parallel inserts).
  const readback = await pool.query<{ account_id: string }>(
    "SELECT account_id FROM user_accounts WHERE phone_stub_hash = $1",
    [phoneStubHash],
  );
  if (readback.rows.length === 0) {
    throw new Error(`[pre-auth-token-repository] Failed to create or find account for phone_stub_hash ${phoneStubHash.slice(0, 8)}...`);
  }
  return readback.rows[0]!.account_id;
}

export async function linkAgentToAccount(
  pool: pg.Pool,
  params: LinkAgentToAccountParams,
): Promise<string> {
  const accountId = await resolveAccountId(pool, params.phoneStubHash, params.emailStubHash);

  // Link the agent_profile to the account by setting account_id. Uses k_local_pubkey
  // (the agent's unique identifier in agent_profiles) as the WHERE clause. NOTE: this
  // UPDATE requires the agent_profiles row to already be committed — the registration
  // path now inserts WITH account_id via resolveAccountId instead (race-free). This
  // function remains for callers that link an already-persisted profile.
  await pool.query(
    "UPDATE agent_profiles SET account_id = $1 WHERE k_local_pubkey = $2",
    [accountId, params.kLocalPubkey],
  );

  return accountId;
}

/** #2b: outcome of a claim-code redeem — distinguishes "unknown code" from "expired" (review finding 2:
 *  the raw-capability path surfaces PRE_AUTH_TOKEN_EXPIRED, so the short-code path must too). */
export type RedeemClaimCodeResult =
  | { status: "ok"; capability: string; expiresAt: Date }
  | { status: "expired" }
  | { status: "not_found" };

/**
 * #2b: redeem a claim-code for its capability. Matches by code alone (regardless of expiry) so the caller
 * can tell "unknown" (maybe not-yet-replicated on this node — see the DKG-gate retry) apart from "expired".
 * Sets redeemed_at as audit only — the capability's nonce is the real single-use gate at the nonce binder,
 * so a concurrent multi-node redeem or a re-fetch while valid is harmless. Reads replicated state, so it
 * works from whichever sovereign node the agent is connected to.
 */
export async function redeemClaimCode(pool: pg.Pool, code: string): Promise<RedeemClaimCodeResult> {
  const res = await pool.query<{ capability: string; expires_at: string; expired: boolean }>(
    `UPDATE capability_claim_codes
        SET redeemed_at = COALESCE(redeemed_at, now())
      WHERE code = $1
      RETURNING capability, expires_at, (expires_at <= now()) AS expired`,
    [code],
  );
  const row = res.rows[0];
  if (!row) return { status: "not_found" };
  if (row.expired) return { status: "expired" };
  return { status: "ok", capability: row.capability, expiresAt: new Date(row.expires_at) };
}

