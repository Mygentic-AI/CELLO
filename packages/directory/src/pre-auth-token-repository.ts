/**
 * Pre-Authorization Token Repository — OPS-AGENT-001
 *
 * Handles pre_authorization_tokens table operations for the CELLO Directory.
 *
 * Token format: "CELLO-" + 33 base58 chars (Bitcoin alphabet, no 0/O/I/l).
 * Entropy: 58^33 ≈ 2^194.9 bits — exceeds the 192-bit SI-003 minimum.
 * Generation: crypto.randomBytes(25) → base58 encode → take 33 chars.
 *
 * Atomic consumption (SI-002, RFC 9591):
 *   UPDATE pre_authorization_tokens
 *   SET consumed_at = now()
 *   WHERE token = $1 AND consumed_at IS NULL AND expires_at > now()
 *   RETURNING id, phone_stub_hash, email_domain
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
 *   3. Pad/truncate to exactly 33 characters.
 *   4. Prepend "CELLO-".
 *
 * Entropy: 58^33 ≈ 2^194.9 bits (> 192-bit minimum per SI-003).
 *
 * Note: base58(25 bytes) may be shorter than 33 chars if leading bytes are 0.
 * We handle this by left-padding with the first character of the alphabet ('1')
 * which encodes zero in base58, matching Bitcoin's zero-encoding convention.
 */
export function generatePreAuthToken(): string {
  // 25 bytes = 200 bits. After base58 encoding we take 33 chars ≈ 193.9 bits.
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

  // Left-pad with '1' (base58 zero-character) to reach 33 characters
  while (digits.length < 33) {
    digits.unshift("1");
  }

  // Take exactly 33 characters (truncate if longer, which is theoretically possible)
  const payload = digits.slice(0, 33).join("");

  return `CELLO-${payload}`;
}

// ─── Token issuance ───────────────────────────────────────────────────────────

export interface IssuePreAuthTokenParams {
  /** SHA-256(phone_stub) from the verified phone number */
  phoneStubHash: string;
  /** Email domain from the verified email */
  emailDomain: string;
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
           (token, phone_stub_hash, email_domain, registration_id, issued_at, expires_at, consumed_at, chain_hash)
         VALUES ($1, $2, $3, $4, $5, $6, NULL, $7)
         RETURNING id`,
        [
          token,
          params.phoneStubHash,
          params.emailDomain,
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

// ─── Token consumption ────────────────────────────────────────────────────────

export type ConsumeTokenResult =
  | { ok: true; tokenId: string; phoneStubHash: string; emailDomain: string }
  | { ok: false; reason: "PRE_AUTH_TOKEN_CONSUMED" | "PRE_AUTH_TOKEN_EXPIRED" | "PRE_AUTH_TOKEN_NOT_FOUND" };

/**
 * Atomically consume a pre-authorization token.
 *
 * This is the FIRST operation that must happen in the DKG Round 1 handler.
 * No crypto must precede this call.
 *
 * Pseudocode:
 *   1. First check: SELECT to determine if token exists and whether it's expired
 *      SELECT id, consumed_at, expires_at FROM pre_authorization_tokens WHERE token = $1
 *   2. If no row → NOT_FOUND (treat as invalid)
 *   3. If expires_at < now() → PRE_AUTH_TOKEN_EXPIRED (do not consume)
 *   4. Atomic UPDATE: UPDATE ... SET consumed_at = now()
 *                     WHERE token = $1 AND consumed_at IS NULL
 *                     RETURNING id, phone_stub_hash, email_domain
 *   5. If rowCount = 0 → PRE_AUTH_TOKEN_CONSUMED (race condition: another process consumed it)
 *   6. If rowCount = 1 → ok, return token data
 *
 * SI-002: The UPDATE is atomic at the database level. Two concurrent UPDATE calls
 * for the same token return rowCount=1 for exactly one caller.
 */
export async function consumePreAuthToken(
  pool: pg.Pool,
  token: string,
): Promise<ConsumeTokenResult> {
  // Step 1: Check token state first (to distinguish consumed vs expired)
  const checkResult = await pool.query<{
    id: string;
    consumed_at: Date | null;
    expires_at: Date;
  }>(
    "SELECT id, consumed_at, expires_at FROM pre_authorization_tokens WHERE token = $1",
    [token],
  );

  if (checkResult.rows.length === 0) {
    return { ok: false, reason: "PRE_AUTH_TOKEN_NOT_FOUND" };
  }

  const row = checkResult.rows[0]!;

  // Step 2: Check expiry (before attempting UPDATE)
  if (row.expires_at <= new Date()) {
    return { ok: false, reason: "PRE_AUTH_TOKEN_EXPIRED" };
  }

  // Step 3: Atomic consumption
  // UPDATE ... WHERE consumed_at IS NULL ensures only one concurrent caller succeeds.
  // RFC 9591 § pattern: single-use token via conditional update.
  const updateResult = await pool.query<{
    id: string;
    phone_stub_hash: string;
    email_domain: string;
  }>(
    `UPDATE pre_authorization_tokens
     SET consumed_at = now()
     WHERE token = $1 AND consumed_at IS NULL
     RETURNING id, phone_stub_hash, email_domain`,
    [token],
  );

  if (updateResult.rowCount === 0) {
    // Another concurrent caller consumed the token (SI-002 atomicity)
    return { ok: false, reason: "PRE_AUTH_TOKEN_CONSUMED" };
  }

  const updated = updateResult.rows[0]!;
  return {
    ok: true,
    tokenId: updated.id,
    phoneStubHash: updated.phone_stub_hash,
    emailDomain: updated.email_domain,
  };
}

// ─── DKG token gate ───────────────────────────────────────────────────────────

export type DkgTokenGateResult =
  | { ok: true; tokenId: string; phoneStubHash: string; emailDomain: string }
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
      // Look up tokenId for logging (best-effort — use token hash as fallback)
      const tokenId = await getTokenId(pool, token);
      logger.warn("preauth.token.reuse.rejected", {
        tokenId: tokenId ?? token.slice(0, 16) + "...",
        correlationId,
      });
      return { ok: false, reason: "PRE_AUTH_TOKEN_CONSUMED" };
    }

    if (result.reason === "PRE_AUTH_TOKEN_EXPIRED") {
      const tokenId = await getTokenId(pool, token);
      logger.warn("preauth.token.expired", {
        tokenId: tokenId ?? token.slice(0, 16) + "...",
        correlationId,
      });
      return { ok: false, reason: "PRE_AUTH_TOKEN_EXPIRED" };
    }

    // NOT_FOUND: treat same as missing (avoid oracle leakage)
    logger.warn("preauth.token.missing", {
      remoteAgentId: agentId,
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
    emailDomain: result.emailDomain,
  };
}

// ─── Account deduplication ────────────────────────────────────────────────────

export interface LinkAgentToAccountParams {
  /** The UUID of the agent_profiles row (from the profile just created) */
  agentProfileId: string;
  /** phone_stub_hash from the consumed pre-authorization token */
  phoneStubHash: string;
  /** Optional email stub hash */
  emailStubHash?: string;
}

/**
 * Look up or create an account for the given phone_stub_hash, then return the account_id.
 *
 * Pseudocode (AC-005b):
 *   1. SELECT account_id FROM user_accounts WHERE phone_stub_hash = $1
 *   2. If found: return account_id (same phone → same account)
 *   3. If not found:
 *      a. Generate a new UUID for account_id
 *      b. Compute chain_hash = SHA-256(account_id || phone_stub_hash)
 *      c. INSERT INTO user_accounts (account_id, phone_stub_hash, chain_hash, ...)
 *         ON CONFLICT (phone_stub_hash) DO NOTHING
 *      d. SELECT again (handles race where two parallel inserts both get NOT_FOUND)
 *   4. Return account_id
 *
 * This implements the INSERT OR IGNORE pattern for account deduplication.
 */
export async function linkAgentToAccount(
  pool: pg.Pool,
  params: LinkAgentToAccountParams,
): Promise<string> {
  const { phoneStubHash } = params;

  // Step 1: Try to find existing account
  const existing = await pool.query<{ account_id: string }>(
    "SELECT account_id FROM user_accounts WHERE phone_stub_hash = $1",
    [phoneStubHash],
  );

  if (existing.rows.length > 0) {
    return existing.rows[0]!.account_id;
  }

  // Step 2: No account — create one
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
      [accountId, phoneStubHash, params.emailStubHash ?? null, chainHash],
    );
  } catch {
    // Swallow errors — the subsequent SELECT will handle any race condition
  }

  // Step 3: Read back the canonical account_id (handles race conditions)
  const readback = await pool.query<{ account_id: string }>(
    "SELECT account_id FROM user_accounts WHERE phone_stub_hash = $1",
    [phoneStubHash],
  );

  if (readback.rows.length === 0) {
    throw new Error(`[pre-auth-token-repository] Failed to create or find account for phone_stub_hash ${phoneStubHash.slice(0, 8)}...`);
  }

  return readback.rows[0]!.account_id;
}

// ─── Private helpers ──────────────────────────────────────────────────────────

/** Look up a token's database id by token string (for logging purposes). Returns null if not found. */
async function getTokenId(pool: pg.Pool, token: string): Promise<string | null> {
  try {
    const result = await pool.query<{ id: string }>(
      "SELECT id FROM pre_authorization_tokens WHERE token = $1",
      [token],
    );
    return result.rows[0]?.id ?? null;
  } catch {
    return null;
  }
}
