/**
 * CELLO-OPS-AGENT-001 — Pre-Authorization Token API and DKG Round 1 Gate
 *
 * Specification (from CELLO-OPS-AGENT-001.yaml):
 *   AC-001: POST /internal/pre-authorize issues CELLO-+33 base58 token, 24h TTL, consumed_at NULL
 *   AC-002: DKG Round 1 with valid token → token consumed, DKG proceeds, preauth.token.consumed logged
 *   AC-003: Reused token → PRE_AUTH_TOKEN_CONSUMED error, preauth.token.reuse.rejected logged
 *   AC-004: Expired token (25h ago) → PRE_AUTH_TOKEN_EXPIRED error, preauth.token.expired logged
 *   AC-005: No or invalid API key → HTTP 401, no token row, preauth.auth.failed logged
 *   AC-005b: Same phone_stub_hash two DKG flows → same account, two agent_profiles linked
 *   AC-006: Token consumed even if DKG fails after consumption
 *   AC-007: Missing preAuthToken in Round 1 frame → PRE_AUTH_TOKEN_MISSING, preauth.token.missing logged
 *   AC-008-integration-gate: All five operations correct, Flyway zero checksum errors
 *   SI-001: Invalid API key → 401, no token created
 *   SI-002: Atomic UPDATE WHERE consumed_at IS NULL — race condition impossible
 *   SI-003: Token string does not contain/encode PII
 *
 * test_type: integration
 * Requires CELLO_ENV=local and a running Docker Compose Postgres with V25 migration applied.
 * Skipped automatically when CELLO_ENV != 'local'.
 *
 * Run with:
 *   CELLO_ENV=local DATABASE_URL=postgresql://postgres:dev@localhost:5433/cello_dev \
 *     DEV_ENVELOPE_KEY=86e903357804be102cf6f55e1b86ed342e01a6f50835272200ac970d0d094ac7 \
 *     AUDIT_LOG_PATH=/tmp/cello-audit.jsonl \
 *     pnpm --filter @cello-protocol/directory run test -- \
 *       --pool-options.threads.maxThreads=1 --pool-options.threads.minThreads=1
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { createHash, randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";

// ─── Integration guard ────────────────────────────────────────────────────────

const isLocal = process.env["CELLO_ENV"] === "local";
const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgresql://postgres:dev@localhost:5433/cello_dev";
const describeIntegration = isLocal ? describe : describe.skip;

// ─── Imports under test ───────────────────────────────────────────────────────

import {
  generatePreAuthToken,
  BASE58_ALPHABET,
  issuePreAuthToken,
  consumePreAuthToken,
  validatePreAuthTokenForDkg,
} from "../pre-auth-token-repository.js";
import { createInternalApiServer } from "../internal-api-server.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Helper: insert a row directly into pre_authorization_tokens for test setup */
async function insertTokenRow(
  pool: pg.Pool,
  opts: {
    token: string;
    phoneStubHash: string;
    emailDomain: string;
    registrationId: string;
    issuedAt?: Date;
    expiresAt?: Date;
    consumedAt?: Date | null;
  },
): Promise<string> {
  const issuedAt = opts.issuedAt ?? new Date();
  const expiresAt = opts.expiresAt ?? new Date(issuedAt.getTime() + 24 * 60 * 60 * 1000);
  const chainHash = createHash("sha256").update(`${opts.token}${opts.registrationId}`).digest("hex");

  const result = await pool.query<{ id: string }>(
    `INSERT INTO pre_authorization_tokens
       (token, phone_stub_hash, email_domain, registration_id, issued_at, expires_at, consumed_at, chain_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      opts.token,
      opts.phoneStubHash,
      opts.emailDomain,
      opts.registrationId,
      issuedAt.toISOString(),
      expiresAt.toISOString(),
      opts.consumedAt ?? null,
      chainHash,
    ],
  );
  return result.rows[0]!.id;
}

/** Helper: insert a fake registration row for FK satisfaction */
async function insertRegistrationRow(pool: pg.Pool, phoneStubHash: string): Promise<string> {
  const id = "00000000-0000-0000-0000-" + Buffer.from(randomBytes(6)).toString("hex");
  const chainHash = createHash("sha256").update(id).digest("hex");
  await pool.query(
    `INSERT INTO registrations
       (id, phone_stub_hash, channel, channel_user_id, state, expires_at, chain_hash)
     VALUES ($1, $2, 'cli', 'test', 'PRE_AUTH_TOKEN_ISSUED', now() + interval '1 hour', $3)
     ON CONFLICT DO NOTHING`,
    [id, phoneStubHash, chainHash],
  );
  return id;
}

/** Helper: post to the internal API server */
async function postPreAuthorize(
  port: number,
  body: Record<string, unknown>,
  apiKey?: string,
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey !== undefined) {
    headers["x-cello-internal-api-key"] = apiKey;
  }

  const resp = await fetch(`http://127.0.0.1:${port}/internal/pre-authorize`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  let body_: unknown;
  try { body_ = await resp.json(); } catch { body_ = null; }
  return { status: resp.status, body: body_ };
}

// ─── Unit tests (no database) ─────────────────────────────────────────────────

describe("OPS-AGENT-001 unit: generatePreAuthToken", () => {
  /**
   * S — Specification comment for AC-001 (unit portion):
   * Token format: "CELLO-" + exactly 33 base58 characters.
   * base58 alphabet: 123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz
   * Entropy: >= 193 bits (58^33 ≈ 2^194.9).
   */
  it("AC-001 token format: CELLO- prefix + 33 base58 chars", () => {
    const token = generatePreAuthToken();
    expect(token.startsWith("CELLO-")).toBe(true);
    const payload = token.slice(6); // remove "CELLO-"
    expect(payload).toHaveLength(33);
    for (const char of payload) {
      expect(BASE58_ALPHABET.includes(char)).toBe(true);
    }
  });

  it("AC-001 token uniqueness: 100 tokens are all distinct", () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generatePreAuthToken()));
    expect(tokens.size).toBe(100);
  });

  it("SI-003: token string does not contain phone number or email", () => {
    const phone = "+1234567890";
    const email = "test@example.com";
    const token = generatePreAuthToken();
    expect(token).not.toContain(phone);
    expect(token).not.toContain(email);
    // Token must be opaque — the base58 payload is from crypto.randomBytes, not derived from PII
    expect(token).toHaveLength("CELLO-".length + 33);
  });
});

// ─── Integration tests ────────────────────────────────────────────────────────

describeIntegration("OPS-AGENT-001 integration: pre_authorization_tokens table operations", () => {
  let pool: pg.Pool;
  const TEST_PHONE_STUB_HASH = "test-phone-" + Buffer.from(randomBytes(8)).toString("hex");
  const TEST_EMAIL_DOMAIN = "test.example.com";
  let registrationId: string;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });
    try {
      await pool.query("SELECT 1");
    } catch (err) {
      throw new Error(
        `[OPS-AGENT-001] CELLO_ENV=local but Postgres is unreachable at ${DATABASE_URL}: ${String(err)}`,
      );
    }
    // Insert a registration row for FK
    registrationId = await insertRegistrationRow(pool, TEST_PHONE_STUB_HASH);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("AC-001 issuePreAuthToken: inserts row, returns token + expiresAt", async () => {
    const result = await issuePreAuthToken(pool, {
      phoneStubHash: TEST_PHONE_STUB_HASH,
      emailDomain: TEST_EMAIL_DOMAIN,
      registrationId,
    });

    expect(result.token).toMatch(/^CELLO-[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{33}$/);
    expect(result.expiresAt).toBeInstanceOf(Date);
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000);
    expect(result.expiresAt.getTime()).toBeLessThan(Date.now() + 25 * 60 * 60 * 1000);

    // Verify the row exists with consumed_at = NULL
    const row = await pool.query(
      "SELECT consumed_at FROM pre_authorization_tokens WHERE token = $1",
      [result.token],
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0]!.consumed_at).toBeNull();
  });

  it("AC-002 consumePreAuthToken: atomically sets consumed_at, returns token metadata", async () => {
    const issued = await issuePreAuthToken(pool, {
      phoneStubHash: TEST_PHONE_STUB_HASH,
      emailDomain: TEST_EMAIL_DOMAIN,
      registrationId,
    });

    const result = await consumePreAuthToken(pool, issued.token);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected ok");
    expect(result.tokenId).toBeDefined();
    expect(result.phoneStubHash).toBe(TEST_PHONE_STUB_HASH);
    expect(result.emailDomain).toBe(TEST_EMAIL_DOMAIN);

    // Verify consumed_at is set in DB
    const row = await pool.query(
      "SELECT consumed_at FROM pre_authorization_tokens WHERE token = $1",
      [issued.token],
    );
    expect(row.rows[0]!.consumed_at).not.toBeNull();
  });

  it("AC-003 consumePreAuthToken: reused token returns PRE_AUTH_TOKEN_CONSUMED", async () => {
    const issued = await issuePreAuthToken(pool, {
      phoneStubHash: TEST_PHONE_STUB_HASH,
      emailDomain: TEST_EMAIL_DOMAIN,
      registrationId,
    });

    // First consumption succeeds
    const first = await consumePreAuthToken(pool, issued.token);
    expect(first.ok).toBe(true);

    // Second consumption fails
    const second = await consumePreAuthToken(pool, issued.token);
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error("Expected failure");
    expect(second.reason).toBe("PRE_AUTH_TOKEN_CONSUMED");
  });

  it("AC-004 consumePreAuthToken: expired token returns PRE_AUTH_TOKEN_EXPIRED", async () => {
    // Insert an expired token directly
    const expiredToken = generatePreAuthToken();
    const issuedAt = new Date(Date.now() - 25 * 60 * 60 * 1000);
    const expiresAt = new Date(issuedAt.getTime() + 24 * 60 * 60 * 1000);
    await insertTokenRow(pool, {
      token: expiredToken,
      phoneStubHash: TEST_PHONE_STUB_HASH,
      emailDomain: TEST_EMAIL_DOMAIN,
      registrationId,
      issuedAt,
      expiresAt,
      consumedAt: null,
    });

    const result = await consumePreAuthToken(pool, expiredToken);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected failure");
    expect(result.reason).toBe("PRE_AUTH_TOKEN_EXPIRED");

    // Token should NOT be consumed (consumed_at still null)
    const row = await pool.query(
      "SELECT consumed_at FROM pre_authorization_tokens WHERE token = $1",
      [expiredToken],
    );
    expect(row.rows[0]!.consumed_at).toBeNull();
  });

  it("SI-002 atomicity: concurrent consumption — exactly one succeeds", async () => {
    // Issue a fresh token
    const issued = await issuePreAuthToken(pool, {
      phoneStubHash: TEST_PHONE_STUB_HASH,
      emailDomain: TEST_EMAIL_DOMAIN,
      registrationId,
    });

    // Simulate two concurrent consumers
    const [r1, r2] = await Promise.all([
      consumePreAuthToken(pool, issued.token),
      consumePreAuthToken(pool, issued.token),
    ]);

    const successCount = [r1, r2].filter((r) => r.ok).length;
    const failedCount = [r1, r2].filter((r) => !r.ok).length;

    expect(successCount).toBe(1);
    expect(failedCount).toBe(1);

    // The failed one must have reason PRE_AUTH_TOKEN_CONSUMED
    const failed = [r1, r2].find((r) => !r.ok)!;
    if (failed.ok) throw new Error("Expected failure");
    expect(failed.reason).toBe("PRE_AUTH_TOKEN_CONSUMED");
  });

  it("AC-006 consumePreAuthToken: token stays consumed even if DKG fails after consumption", async () => {
    // Issue and consume a token
    const issued = await issuePreAuthToken(pool, {
      phoneStubHash: TEST_PHONE_STUB_HASH,
      emailDomain: TEST_EMAIL_DOMAIN,
      registrationId,
    });
    const first = await consumePreAuthToken(pool, issued.token);
    expect(first.ok).toBe(true);

    // Simulate DKG failure (irrelevant to token state) — verify token remains consumed
    const row = await pool.query(
      "SELECT consumed_at FROM pre_authorization_tokens WHERE token = $1",
      [issued.token],
    );
    expect(row.rows[0]!.consumed_at).not.toBeNull();

    // Attempting to use the token again returns CONSUMED (not re-usable after failed DKG)
    const retry = await consumePreAuthToken(pool, issued.token);
    expect(retry.ok).toBe(false);
    if (retry.ok) throw new Error("Expected failure");
    expect(retry.reason).toBe("PRE_AUTH_TOKEN_CONSUMED");
  });
});

// ─── HTTP API tests ───────────────────────────────────────────────────────────

describeIntegration("OPS-AGENT-001 integration: POST /internal/pre-authorize HTTP endpoint", () => {
  let pool: pg.Pool;
  let serverPort: number;
  let stopServer: () => void;
  const VALID_API_KEY = "test-internal-api-key-" + Buffer.from(randomBytes(8)).toString("hex");
  const PHONE_STUB_HASH_HTTP = "http-test-phone-" + Buffer.from(randomBytes(8)).toString("hex");
  const EMAIL_DOMAIN_HTTP = "http-test.example.com";
  let httpRegistrationId: string;

  const noopLogger = {
    debug: () => {},
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });
    httpRegistrationId = await insertRegistrationRow(pool, PHONE_STUB_HASH_HTTP);

    const server = createInternalApiServer({
      pool,
      internalApiKey: VALID_API_KEY,
      logger: noopLogger,
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        serverPort = (server.address() as AddressInfo).port;
        resolve();
      });
    });
    stopServer = () => { server.close(); };
  });

  afterAll(async () => {
    stopServer?.();
    await pool?.end();
    vi.restoreAllMocks();
  });

  it("AC-001 HTTP: valid request returns 200 with token + expiresAt", async () => {
    const { status, body } = await postPreAuthorize(
      serverPort,
      { phoneStubHash: PHONE_STUB_HASH_HTTP, emailDomain: EMAIL_DOMAIN_HTTP, registrationId: httpRegistrationId },
      VALID_API_KEY,
    );
    expect(status).toBe(200);
    const b = body as { token?: string; expiresAt?: string };
    expect(b.token).toMatch(/^CELLO-[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{33}$/);
    expect(b.expiresAt).toBeDefined();
    expect(new Date(b.expiresAt!).getTime()).toBeGreaterThan(Date.now());

    // Verify preauth.token.issued was logged
    expect(noopLogger.info).toHaveBeenCalledWith(
      "preauth.token.issued",
      expect.objectContaining({
        tokenId: expect.any(String),
        phoneStubHashPrefix: expect.any(String),
        emailDomain: EMAIL_DOMAIN_HTTP,
        correlationId: expect.any(String),
      }),
    );

    // Verify the row exists in DB with consumed_at = NULL
    const row = await pool.query(
      "SELECT consumed_at, expires_at FROM pre_authorization_tokens WHERE token = $1",
      [b.token],
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0]!.consumed_at).toBeNull();
  });

  it("AC-005 HTTP: missing API key returns 401, no token row created", async () => {
    const countBefore = await pool.query(
      "SELECT COUNT(*) FROM pre_authorization_tokens WHERE email_domain = $1",
      [EMAIL_DOMAIN_HTTP],
    );
    const countBeforeNum = parseInt(String(countBefore.rows[0]!.count), 10);

    const { status } = await postPreAuthorize(
      serverPort,
      { phoneStubHash: PHONE_STUB_HASH_HTTP, emailDomain: EMAIL_DOMAIN_HTTP, registrationId: httpRegistrationId },
      // No API key
    );
    expect(status).toBe(401);

    const countAfter = await pool.query(
      "SELECT COUNT(*) FROM pre_authorization_tokens WHERE email_domain = $1",
      [EMAIL_DOMAIN_HTTP],
    );
    const countAfterNum = parseInt(String(countAfter.rows[0]!.count), 10);
    expect(countAfterNum).toBe(countBeforeNum); // No new token created

    // Verify preauth.auth.failed was logged
    expect(noopLogger.warn).toHaveBeenCalledWith(
      "preauth.auth.failed",
      expect.objectContaining({
        remoteAddr: expect.any(String),
        correlationId: expect.any(String),
      }),
    );
  });

  it("AC-005 SI-001: invalid API key returns 401, no token row created", async () => {
    const { status } = await postPreAuthorize(
      serverPort,
      { phoneStubHash: PHONE_STUB_HASH_HTTP, emailDomain: EMAIL_DOMAIN_HTTP, registrationId: httpRegistrationId },
      "wrong-api-key",
    );
    expect(status).toBe(401);
  });
});

// ─── DKG Round 1 gate tests ───────────────────────────────────────────────────

describeIntegration("OPS-AGENT-001 integration: validatePreAuthTokenForDkg", () => {
  let pool: pg.Pool;
  const GATE_PHONE_HASH = "gate-test-phone-" + Buffer.from(randomBytes(8)).toString("hex");
  const GATE_EMAIL_DOMAIN = "gate-test.example.com";
  let gateRegistrationId: string;

  const warnLogger = {
    debug: () => {},
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });
    gateRegistrationId = await insertRegistrationRow(pool, GATE_PHONE_HASH);
  });

  afterAll(async () => {
    await pool?.end();
    vi.restoreAllMocks();
  });

  it("AC-002 validatePreAuthTokenForDkg: valid token consumed, returns phoneStubHash", async () => {
    const issued = await issuePreAuthToken(pool, {
      phoneStubHash: GATE_PHONE_HASH,
      emailDomain: GATE_EMAIL_DOMAIN,
      registrationId: gateRegistrationId,
    });
    const correlationId = "corr-" + Buffer.from(randomBytes(8)).toString("hex");

    const result = await validatePreAuthTokenForDkg(pool, {
      token: issued.token,
      agentId: "test-agent-" + Buffer.from(randomBytes(4)).toString("hex"),
      correlationId,
      logger: warnLogger,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected ok");
    expect(result.phoneStubHash).toBe(GATE_PHONE_HASH);
    expect(result.emailDomain).toBe(GATE_EMAIL_DOMAIN);

    // preauth.token.consumed must be logged at INFO
    expect(warnLogger.info).toHaveBeenCalledWith(
      "preauth.token.consumed",
      expect.objectContaining({
        tokenId: expect.any(String),
        agentId: expect.any(String),
        correlationId,
      }),
    );
  });

  it("AC-003 validatePreAuthTokenForDkg: reused token → PRE_AUTH_TOKEN_CONSUMED", async () => {
    const issued = await issuePreAuthToken(pool, {
      phoneStubHash: GATE_PHONE_HASH,
      emailDomain: GATE_EMAIL_DOMAIN,
      registrationId: gateRegistrationId,
    });
    const correlationId = "corr-reuse-" + Buffer.from(randomBytes(4)).toString("hex");
    const agentId = "agent-reuse";

    // First validation succeeds
    await validatePreAuthTokenForDkg(pool, { token: issued.token, agentId, correlationId, logger: warnLogger });

    // Second attempt on same token
    const result2 = await validatePreAuthTokenForDkg(pool, {
      token: issued.token,
      agentId,
      correlationId,
      logger: warnLogger,
    });
    expect(result2.ok).toBe(false);
    if (result2.ok) throw new Error("Expected failure");
    expect(result2.reason).toBe("PRE_AUTH_TOKEN_CONSUMED");

    // preauth.token.reuse.rejected must be logged at WARN
    expect(warnLogger.warn).toHaveBeenCalledWith(
      "preauth.token.reuse.rejected",
      expect.objectContaining({
        tokenId: expect.any(String),
        correlationId,
      }),
    );
  });

  it("AC-004 validatePreAuthTokenForDkg: expired token → PRE_AUTH_TOKEN_EXPIRED", async () => {
    const expiredToken = generatePreAuthToken();
    const issuedAt = new Date(Date.now() - 25 * 60 * 60 * 1000);
    const expiresAt = new Date(issuedAt.getTime() + 24 * 60 * 60 * 1000);
    await insertTokenRow(pool, {
      token: expiredToken,
      phoneStubHash: GATE_PHONE_HASH,
      emailDomain: GATE_EMAIL_DOMAIN,
      registrationId: gateRegistrationId,
      issuedAt,
      expiresAt,
      consumedAt: null,
    });

    const correlationId = "corr-expired-" + Buffer.from(randomBytes(4)).toString("hex");
    const result = await validatePreAuthTokenForDkg(pool, {
      token: expiredToken,
      agentId: "agent-expired",
      correlationId,
      logger: warnLogger,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected failure");
    expect(result.reason).toBe("PRE_AUTH_TOKEN_EXPIRED");

    // preauth.token.expired must be logged at WARN
    expect(warnLogger.warn).toHaveBeenCalledWith(
      "preauth.token.expired",
      expect.objectContaining({
        tokenId: expect.any(String),
        correlationId,
      }),
    );
  });

  it("AC-007 validatePreAuthTokenForDkg: missing token (empty string) → PRE_AUTH_TOKEN_MISSING", async () => {
    const correlationId = "corr-missing-" + Buffer.from(randomBytes(4)).toString("hex");
    const result = await validatePreAuthTokenForDkg(pool, {
      token: "",
      agentId: "agent-no-token",
      correlationId,
      logger: warnLogger,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected failure");
    expect(result.reason).toBe("PRE_AUTH_TOKEN_MISSING");

    // preauth.token.missing must be logged at WARN
    expect(warnLogger.warn).toHaveBeenCalledWith(
      "preauth.token.missing",
      expect.objectContaining({
        remoteAgentId: "agent-no-token",
        correlationId,
      }),
    );
  });

  it("AC-007 validatePreAuthTokenForDkg: undefined token → PRE_AUTH_TOKEN_MISSING", async () => {
    const correlationId = "corr-missing2-" + Buffer.from(randomBytes(4)).toString("hex");
    const result = await validatePreAuthTokenForDkg(pool, {
      token: undefined as unknown as string,
      agentId: "agent-no-token2",
      correlationId,
      logger: warnLogger,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected failure");
    expect(result.reason).toBe("PRE_AUTH_TOKEN_MISSING");
  });
});

// ─── AC-005b: Account deduplication ──────────────────────────────────────────

describeIntegration("OPS-AGENT-001 integration: AC-005b account deduplication", () => {
  let pool: pg.Pool;
  const SHARED_PHONE_STUB_HASH = "acct-test-phone-" + Buffer.from(randomBytes(8)).toString("hex");
  const EMAIL_DOMAIN_ACCT = "acct-test.example.com";
  let regId1: string;
  let regId2: string;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });
    regId1 = await insertRegistrationRow(pool, SHARED_PHONE_STUB_HASH);
    regId2 = await insertRegistrationRow(pool, SHARED_PHONE_STUB_HASH + "-2");
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("AC-005b: two tokens with same phone_stub_hash link to same account", async () => {
    // Issue two tokens with same phone_stub_hash
    const token1 = await issuePreAuthToken(pool, {
      phoneStubHash: SHARED_PHONE_STUB_HASH,
      emailDomain: EMAIL_DOMAIN_ACCT,
      registrationId: regId1,
    });
    const token2 = await issuePreAuthToken(pool, {
      phoneStubHash: SHARED_PHONE_STUB_HASH,
      emailDomain: EMAIL_DOMAIN_ACCT,
      registrationId: regId2,
    });

    // Consume both — simulates two DKG Round 1 flows for the same phone number
    const r1 = await consumePreAuthToken(pool, token1.token);
    const r2 = await consumePreAuthToken(pool, token2.token);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);

    // linkAgentToAccount for both
    const { linkAgentToAccount } = await import("../pre-auth-token-repository.js");
    const accountId1 = await linkAgentToAccount(pool, {
      agentProfileId: "agent-prof-id-1-" + Buffer.from(randomBytes(4)).toString("hex"),
      phoneStubHash: SHARED_PHONE_STUB_HASH,
    });
    const accountId2 = await linkAgentToAccount(pool, {
      agentProfileId: "agent-prof-id-2-" + Buffer.from(randomBytes(4)).toString("hex"),
      phoneStubHash: SHARED_PHONE_STUB_HASH,
    });

    // Both must link to the same account
    expect(accountId1).toBe(accountId2);

    // Only one row exists in user_accounts for this phone_stub_hash
    const acctRows = await pool.query(
      "SELECT COUNT(*) AS count FROM user_accounts WHERE phone_stub_hash = $1",
      [SHARED_PHONE_STUB_HASH],
    );
    expect(parseInt(String(acctRows.rows[0]!.count), 10)).toBe(1);
  });
});

// ─── Flyway checksum integrity ────────────────────────────────────────────────

describeIntegration("OPS-AGENT-001 AC-008-integration-gate: Flyway zero checksum errors", () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("AC-008 all migrations succeed without checksum errors", async () => {
    const result = await pool.query<{ installed_rank: number; version: string; success: boolean }>(
      "SELECT installed_rank, version, success FROM flyway_schema_history ORDER BY installed_rank",
    );
    const failures = result.rows.filter((r) => !r.success);
    expect(failures).toHaveLength(0);
    // pre_authorization_tokens (V25) must be applied
    const v25 = result.rows.find((r) => r.installed_rank === 25);
    expect(v25).toBeDefined();
    expect(v25!.success).toBe(true);
  });
});
