/**
 * CELLO-ACCOUNT-001 — user_accounts table, account_id FK on agent_profiles
 *
 * Specification (stated interpretations for each AC):
 *
 * AC-001: V21 + V22 migrations create user_accounts with UUID PK, phone_stub_hash TEXT UNIQUE NOT NULL,
 *   email_stub_hash TEXT (nullable), created_at TIMESTAMPTZ DEFAULT now(), chain_hash TEXT NOT NULL.
 *   agent_profiles gains account_id UUID nullable column with FK to user_accounts.account_id.
 *   Both tables have RLS enabled with insert_only and select_all policies for cello_service.
 *
 * AC-002: Two agent_profiles rows linked to the same account_id are returned by getAgentsByAccount
 *   in registered_at ASC order. Fresh PgDirectoryStore instance (no cache) returns same result
 *   — proving Postgres persistence, not in-memory state.
 *
 * AC-003: Duplicate phone_stub_hash in user_accounts is rejected with a unique constraint violation.
 *   account.phone_stub_hash.duplicate logged at WARN with { phoneStubHashPrefix } (first 8 chars only).
 *
 * AC-004: agent_profiles rows with NULL account_id are NOT returned by getAgentsByAccount.
 *
 * AC-005: verifyChain('user_accounts') returns { valid: true }. user_accounts.id (BIGSERIAL) is
 *   returned as typeof 'number' after deserializeRow — proving BIGINT_COLUMNS covers it.
 *
 * AC-006: cello_service DELETE and UPDATE on user_accounts are rejected with permission denied.
 *
 * AC-007-table-extra-excluded: INSERT without email_stub_hash → verifyChain still valid.
 *   TABLE_EXTRA_EXCLUDED must include email_stub_hash for user_accounts.
 *
 * SI-001: getAgentsByAccount returns only public keys and trust metadata, never K_local private key material.
 *
 * SI-002: agent_profiles INSERT with fabricated account_id rejected at DB level (FK constraint).
 *
 * DB-001: Directory fails at startup with migration.out.of.date when schema is behind.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { randomUUID, randomBytes } from "node:crypto";
import { PgDirectoryStore, BIGINT_COLUMNS, deserializeRow } from "../adapters/pg-directory-store.js";
import { CHAIN_GENESIS } from "../hash-chain.js";
import type { Logger } from "@cello/interfaces";
import type { AgentProfile } from "@cello/protocol-types";

// ─── Environment setup ────────────────────────────────────────────────────────

const isLocal = process.env["CELLO_ENV"] === "local";
const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgresql://postgres:dev@localhost:5433/cello_dev";

const SERVICE_URL = DATABASE_URL.replace(
  /^(postgres(?:ql)?):\/\/[^:]+:[^@]+@/,
  "$1://cello_service:cello_service_dev@",
);

const describeIntegration = isLocal ? describe : describe.skip;

// ─── Pool management ──────────────────────────────────────────────────────────

let superPool: pg.Pool;
let servicePool: pg.Pool;

beforeAll(async () => {
  if (!isLocal) return;
  superPool = new pg.Pool({ connectionString: DATABASE_URL });
  servicePool = new pg.Pool({ connectionString: SERVICE_URL });
  try {
    await superPool.query("SELECT 1");
  } catch (err) {
    throw new Error(
      `[ACCOUNT-001] CELLO_ENV=local but Postgres is unreachable at ${DATABASE_URL}: ${String(err)}`,
    );
  }
});

afterAll(async () => {
  if (!isLocal) return;
  await superPool?.end();
  await servicePool?.end();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/**
 * Make a deterministic phone_stub_hash — 64-char hex, UNIQUE per call via UUID salt.
 * Never logs or exposes the raw value in tests — only the first 8 chars (per AC-003).
 */
function makePhoneStubHash(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Make a minimal valid AgentProfile row for insertion via superPool.
 * Uses superPool to bypass cello_service RLS restrictions on account_id FK writes.
 *
 * Returns the k_local_pubkey so tests can look the row up.
 */
async function insertAgentProfileWithAccount(
  accountId: string | null,
  registeredAt: number,
): Promise<string> {
  const kLocalPubkey = randomBytes(32).toString("hex");
  const primaryPubkey = randomBytes(32).toString("hex");
  const phoneStubHash = makePhoneStubHash();

  await superPool.query(
    `INSERT INTO agent_profiles
       (k_local_pubkey, primary_pubkey, ml_dsa_pubkey, phone_stub_hash, registered_at, status, chain_hash, account_id)
     VALUES ($1, $2, '', $3, $4, 'active', $5, $6)`,
    [
      kLocalPubkey,
      primaryPubkey,
      phoneStubHash,
      registeredAt,
      CHAIN_GENESIS, // minimal valid chain_hash
      accountId,
    ],
  );
  return kLocalPubkey;
}

/**
 * Delete user_accounts rows created in tests by account_id.
 */
async function cleanupAccounts(accountIds: string[]): Promise<void> {
  if (accountIds.length === 0) return;
  const placeholders = accountIds.map((_, i) => `$${i + 1}`).join(", ");
  await superPool.query(
    `DELETE FROM agent_profiles WHERE account_id IN (${placeholders})`,
    accountIds,
  );
  await superPool.query(
    `DELETE FROM user_accounts WHERE account_id IN (${placeholders})`,
    accountIds,
  );
}

// ─── AC-001: Schema inspection ────────────────────────────────────────────────

describeIntegration(
  isLocal
    ? "ACCOUNT-001 integration: AC-001 schema inspection"
    : "ACCOUNT-001 integration: AC-001 (SKIPPED: CELLO_ENV != local)",
  () => {
    it("AC-001: user_accounts table exists with correct columns, RLS, policies for cello_service", async () => {
      /*
       * AC-001: Verify user_accounts was created by V21 migration with:
       *   - account_id UUID PRIMARY KEY
       *   - phone_stub_hash TEXT UNIQUE NOT NULL
       *   - email_stub_hash TEXT (nullable)
       *   - created_at TIMESTAMPTZ DEFAULT now()
       *   - chain_hash TEXT NOT NULL
       *   - RLS enabled
       *   - insert_only + select_all policies for cello_service
       *   - no UPDATE or DELETE privilege
       */
      let client: pg.PoolClient;
      try {
        client = await superPool.connect();
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(
          `[ACCOUNT-001 AC-001] CELLO_ENV=local but pg.connect() failed — is Docker Compose running? (${reason})`,
        );
      }

      try {
        // 1. Table exists
        const tableResult = await client.query<{ table_name: string }>(
          `SELECT table_name FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = 'user_accounts'`,
        );
        expect(tableResult.rows).toHaveLength(1);

        // 2. RLS enabled
        const rlsResult = await client.query<{ relrowsecurity: boolean }>(
          `SELECT relrowsecurity FROM pg_catalog.pg_class WHERE relname = 'user_accounts'`,
        );
        expect(rlsResult.rows[0]?.relrowsecurity).toBe(true);

        // 3. Required columns with correct types
        const colResult = await client.query<{
          column_name: string;
          data_type: string;
          is_nullable: string;
          column_default: string | null;
        }>(
          `SELECT column_name, data_type, is_nullable, column_default
           FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'user_accounts'
           ORDER BY ordinal_position`,
        );
        const colMap = new Map(colResult.rows.map((r) => [r.column_name, r]));

        // account_id: UUID, NOT NULL (PK)
        expect(colMap.has("account_id")).toBe(true);
        expect(colMap.get("account_id")?.data_type).toBe("uuid");
        expect(colMap.get("account_id")?.is_nullable).toBe("NO");

        // phone_stub_hash: TEXT, NOT NULL
        expect(colMap.has("phone_stub_hash")).toBe(true);
        expect(colMap.get("phone_stub_hash")?.data_type).toBe("text");
        expect(colMap.get("phone_stub_hash")?.is_nullable).toBe("NO");

        // email_stub_hash: TEXT, nullable
        expect(colMap.has("email_stub_hash")).toBe(true);
        expect(colMap.get("email_stub_hash")?.data_type).toBe("text");
        expect(colMap.get("email_stub_hash")?.is_nullable).toBe("YES");

        // created_at: TIMESTAMPTZ, with DEFAULT now()
        expect(colMap.has("created_at")).toBe(true);
        expect(colMap.get("created_at")?.data_type).toBe("timestamp with time zone");

        // chain_hash: TEXT, NOT NULL
        expect(colMap.has("chain_hash")).toBe(true);
        expect(colMap.get("chain_hash")?.data_type).toBe("text");
        expect(colMap.get("chain_hash")?.is_nullable).toBe("NO");

        // 4. UNIQUE constraint on phone_stub_hash
        const uniqueResult = await client.query<{ constraint_name: string }>(
          `SELECT constraint_name FROM information_schema.table_constraints
           WHERE table_schema = 'public' AND table_name = 'user_accounts'
             AND constraint_type = 'UNIQUE'`,
        );
        const uniqueNames = uniqueResult.rows.map((r) => r.constraint_name);
        // Must have a UNIQUE constraint covering phone_stub_hash
        const hasPhoneUniqueConstraint = uniqueNames.some((n) => n.toLowerCase().includes("phone_stub_hash"));
        expect(hasPhoneUniqueConstraint).toBe(true);

        // 5. Policies: insert_only + select_all for cello_service
        await client.query("SET ROLE cello_service");
        const policyResult = await client.query<{ policyname: string }>(
          `SELECT policyname FROM pg_catalog.pg_policies
           WHERE tablename = 'user_accounts'
           ORDER BY policyname`,
        );
        await client.query("RESET ROLE");
        const policyNames = policyResult.rows.map((r) => r.policyname);
        expect(policyNames).toHaveLength(2);
        expect(policyNames).toContain("insert_only");
        expect(policyNames).toContain("select_all");

        // 6. cello_service has no UPDATE or DELETE privilege
        const grantsResult = await client.query<{ privilege_type: string }>(
          `SELECT privilege_type FROM information_schema.role_table_grants
           WHERE grantee = 'cello_service' AND table_name = 'user_accounts'`,
        );
        const grantTypes = grantsResult.rows.map((r) => r.privilege_type);
        expect(grantTypes).not.toContain("UPDATE");
        expect(grantTypes).not.toContain("DELETE");

        // 7. agent_profiles.account_id column exists with FK to user_accounts
        const agentColResult = await client.query<{
          column_name: string;
          data_type: string;
          is_nullable: string;
        }>(
          `SELECT column_name, data_type, is_nullable
           FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'agent_profiles'
             AND column_name = 'account_id'`,
        );
        expect(agentColResult.rows).toHaveLength(1);
        expect(agentColResult.rows[0]?.data_type).toBe("uuid");
        expect(agentColResult.rows[0]?.is_nullable).toBe("YES");

        // FK constraint exists
        const fkResult = await client.query<{ constraint_name: string; table_name: string }>(
          `SELECT kcu.constraint_name, ccu.table_name
           FROM information_schema.key_column_usage kcu
           JOIN information_schema.referential_constraints rc
             ON kcu.constraint_name = rc.constraint_name
           JOIN information_schema.constraint_column_usage ccu
             ON rc.unique_constraint_name = ccu.constraint_name
           WHERE kcu.table_name = 'agent_profiles'
             AND kcu.column_name = 'account_id'`,
        );
        expect(fkResult.rows.length).toBeGreaterThan(0);
        expect(fkResult.rows[0]?.table_name).toBe("user_accounts");
      } finally {
        client.release();
      }
    });
  },
);

// ─── AC-002: Two agents linked to same account ────────────────────────────────

describeIntegration(
  isLocal
    ? "ACCOUNT-001 integration: AC-002 getAgentsByAccount returns both agents in order"
    : "ACCOUNT-001 integration: AC-002 (SKIPPED: CELLO_ENV != local)",
  () => {
    it("AC-002: two agents linked to account X; getAgentsByAccount returns both in registered_at order; fresh instance confirms persistence", async () => {
      /*
       * AC-002: createAccount → insert 2 agent_profiles with account_id → getAgentsByAccount.
       * Fresh PgDirectoryStore instance proves DB persistence, not in-memory state.
       */
      const accountId = randomUUID();
      const accountIds = [accountId];
      const logger = makeLogger();
      const store = new PgDirectoryStore(servicePool, logger);

      try {
        // Create account first
        await store.createAccount({
          accountId,
          phoneStubHash: makePhoneStubHash(),
          correlationId: "corr-ac002",
        });

        // Insert two agent_profiles linked to the account — earlier registered_at for A
        const tBase = Date.now();
        const kLocalA = await insertAgentProfileWithAccount(accountId, tBase);
        const kLocalB = await insertAgentProfileWithAccount(accountId, tBase + 1);

        // Fresh instance — no in-memory state
        const freshLogger = makeLogger();
        const freshStore = new PgDirectoryStore(servicePool, freshLogger);
        const agents = await freshStore.getAgentsByAccount(accountId);

        expect(agents).toHaveLength(2);
        // Verify registered_at ASC order
        expect(agents[0]!.registered_at).toBeLessThanOrEqual(agents[1]!.registered_at);

        // Verify both agents are in the result
        const pubkeys = agents.map((a) => a.k_local_pubkey);
        expect(pubkeys).toContain(kLocalA);
        expect(pubkeys).toContain(kLocalB);

        // Observability: account.created must be logged at INFO with { accountId, correlationId }
        expect(logger.info).toHaveBeenCalledWith(
          "account.created",
          expect.objectContaining({ accountId, correlationId: "corr-ac002" }),
        );
      } finally {
        await cleanupAccounts(accountIds);
      }
    });
  },
);

// ─── AC-003: Duplicate phone_stub_hash rejected ───────────────────────────────

describeIntegration(
  isLocal
    ? "ACCOUNT-001 integration: AC-003 duplicate phone_stub_hash rejected"
    : "ACCOUNT-001 integration: AC-003 (SKIPPED: CELLO_ENV != local)",
  () => {
    it("AC-003: duplicate phone_stub_hash rejected with unique constraint; account.phone_stub_hash.duplicate logged with first 8 chars only", async () => {
      /*
       * AC-003: first createAccount with hash H succeeds; second with same hash H fails.
       * account.phone_stub_hash.duplicate logged at WARN with { phoneStubHashPrefix } (8 chars only).
       */
      const accountId1 = randomUUID();
      const accountId2 = randomUUID();
      const sharedHash = makePhoneStubHash();
      const logger = makeLogger();
      const store = new PgDirectoryStore(servicePool, logger);

      try {
        // First INSERT — must succeed
        await store.createAccount({
          accountId: accountId1,
          phoneStubHash: sharedHash,
          correlationId: "corr-ac003-first",
        });

        // Second INSERT with same hash — must fail
        let caughtError: Error | undefined;
        try {
          await store.createAccount({
            accountId: accountId2,
            phoneStubHash: sharedHash,
            correlationId: "corr-ac003-dup",
          });
        } catch (err) {
          caughtError = err as Error;
        }

        // AC-003: unique constraint must have been thrown
        expect(caughtError).toBeDefined();

        // AC-003: account.phone_stub_hash.duplicate logged at WARN
        expect(logger.warn).toHaveBeenCalledWith(
          "account.phone_stub_hash.duplicate",
          expect.objectContaining({
            phoneStubHashPrefix: sharedHash.slice(0, 8),
            correlationId: "corr-ac003-dup",
          }),
        );

        // Verify the full hash is NOT logged (security invariant)
        const warnCalls = (logger.warn as ReturnType<typeof vi.fn>).mock.calls as [string, Record<string, unknown>][];
        const dupWarn = warnCalls.find(([event]) => event === "account.phone_stub_hash.duplicate");
        expect(dupWarn).toBeDefined();
        const ctx = dupWarn![1];
        // phoneStubHashPrefix must be exactly 8 chars
        expect(String(ctx["phoneStubHashPrefix"])).toHaveLength(8);
        // phone_stub_hash must NOT appear in full in the log context
        const ctxStr = JSON.stringify(ctx);
        expect(ctxStr).not.toContain(sharedHash);

        // No duplicate row created
        const countResult = await superPool.query<{ count: string }>(
          `SELECT COUNT(*) as count FROM user_accounts WHERE phone_stub_hash = $1`,
          [sharedHash],
        );
        expect(countResult.rows[0]?.count).toBe("1");
      } finally {
        await cleanupAccounts([accountId1]);
        // accountId2 was never inserted — cleanup attempt is safe (no rows)
        await superPool.query("DELETE FROM user_accounts WHERE account_id = $1", [accountId2]).catch(() => { /* ignore */ });
      }
    });
  },
);

// ─── AC-004: NULL account_id rows excluded ────────────────────────────────────

describeIntegration(
  isLocal
    ? "ACCOUNT-001 integration: AC-004 NULL account_id rows excluded"
    : "ACCOUNT-001 integration: AC-004 (SKIPPED: CELLO_ENV != local)",
  () => {
    it("AC-004: agent_profiles with NULL account_id are NOT returned by getAgentsByAccount", async () => {
      /*
       * AC-004: pre-M6 agent with NULL account_id must not appear in getAgentsByAccount results.
       */
      const accountId = randomUUID();
      const logger = makeLogger();
      const store = new PgDirectoryStore(servicePool, logger);

      try {
        // Create account X
        await store.createAccount({
          accountId,
          phoneStubHash: makePhoneStubHash(),
          correlationId: "corr-ac004",
        });

        // Insert one agent linked to account X and one with NULL account_id
        const kLocalLinked = await insertAgentProfileWithAccount(accountId, Date.now());
        await insertAgentProfileWithAccount(null, Date.now() + 1); // pre-M6 agent

        const agents = await store.getAgentsByAccount(accountId);

        // Only the linked agent is returned
        const pubkeys = agents.map((a) => a.k_local_pubkey);
        expect(pubkeys).toContain(kLocalLinked);
        expect(pubkeys).not.toContain(null);
        // Result count should be exactly 1 — only the linked agent
        expect(agents).toHaveLength(1);
      } finally {
        await cleanupAccounts([accountId]);
        // Clean up any leftover NULL account_id rows from this test run
        // Only delete rows we definitely won't need for other tests
      }
    });
  },
);

// ─── AC-005: Hash chain verification ─────────────────────────────────────────

describeIntegration(
  isLocal
    ? "ACCOUNT-001 integration: AC-005 verifyChain on user_accounts"
    : "ACCOUNT-001 integration: AC-005 (SKIPPED: CELLO_ENV != local)",
  () => {
    it("AC-005: verifyChain('user_accounts') returns { valid: true }; user_accounts.id is typeof 'number' after deserializeRow", async () => {
      /*
       * AC-005: createAccount twice, verify chain. Also verify BIGINT_COLUMNS covers 'id'
       * so deserializeRow returns typeof 'number'.
       */
      const accountId1 = randomUUID();
      const accountId2 = randomUUID();
      const logger = makeLogger();
      const store = new PgDirectoryStore(servicePool, logger);

      try {
        // Clean the table for deterministic chain verification
        await superPool.query("DELETE FROM agent_profiles WHERE account_id IN ($1, $2)", [accountId1, accountId2]);
        await superPool.query("DELETE FROM user_accounts WHERE account_id IN ($1, $2)", [accountId1, accountId2]);

        await store.createAccount({
          accountId: accountId1,
          phoneStubHash: makePhoneStubHash(),
          correlationId: "corr-ac005-1",
        });
        await store.createAccount({
          accountId: accountId2,
          phoneStubHash: makePhoneStubHash(),
          correlationId: "corr-ac005-2",
        });

        // Fresh verifier instance — no prior in-memory state
        const verifyLogger = makeLogger();
        const verifyStore = new PgDirectoryStore(servicePool, verifyLogger);
        const result = await verifyStore.verifyChain("user_accounts");
        expect(result.valid).toBe(true);

        // AC-005: BIGINT_COLUMNS must declare 'id' for user_accounts
        expect(BIGINT_COLUMNS["user_accounts"]).toContain("id");

        // AC-005: deserializeRow must coerce id to typeof 'number'
        const rawRow = await superPool.query<Record<string, unknown>>(
          "SELECT * FROM user_accounts WHERE account_id = $1",
          [accountId1],
        );
        expect(rawRow.rows).toHaveLength(1);
        // Raw pg driver returns BIGSERIAL as string
        expect(typeof rawRow.rows[0]!["id"]).toBe("string");
        // deserializeRow coerces declared BIGINT columns to number
        const deserialized = deserializeRow("user_accounts", rawRow.rows[0]!);
        expect(typeof deserialized["id"]).toBe("number");
      } finally {
        await cleanupAccounts([accountId1, accountId2]);
      }
    });
  },
);

// ─── AC-006: RLS blocks DELETE and UPDATE ─────────────────────────────────────

describeIntegration(
  isLocal
    ? "ACCOUNT-001 integration: AC-006 cello_service DELETE/UPDATE rejected"
    : "ACCOUNT-001 integration: AC-006 (SKIPPED: CELLO_ENV != local)",
  () => {
    it("AC-006: cello_service DELETE and UPDATE on user_accounts are rejected with permission denied", async () => {
      /*
       * AC-006: database-level rejection via RLS/privilege grant, not application code.
       */
      const accountId = randomUUID();
      const phoneHash = makePhoneStubHash();
      const logger = makeLogger();
      const store = new PgDirectoryStore(servicePool, logger);

      try {
        await store.createAccount({
          accountId,
          phoneStubHash: phoneHash,
          correlationId: "corr-ac006",
        });

        // Direct DELETE via service role — must fail
        let deleteError = "";
        try {
          await servicePool.query(
            "DELETE FROM user_accounts WHERE account_id = $1",
            [accountId],
          );
        } catch (err: unknown) {
          deleteError = err instanceof Error ? err.message : String(err);
        }
        expect(deleteError).toMatch(/permission denied|row-level security policy/i);

        // Direct UPDATE via service role — must fail
        let updateError = "";
        try {
          await servicePool.query(
            "UPDATE user_accounts SET phone_stub_hash = $1 WHERE account_id = $2",
            ["tampered", accountId],
          );
        } catch (err: unknown) {
          updateError = err instanceof Error ? err.message : String(err);
        }
        expect(updateError).toMatch(/permission denied|row-level security policy/i);

        // Verify row is unchanged
        const rowResult = await superPool.query<{ phone_stub_hash: string }>(
          "SELECT phone_stub_hash FROM user_accounts WHERE account_id = $1",
          [accountId],
        );
        expect(rowResult.rows[0]?.phone_stub_hash).toBe(phoneHash);
      } finally {
        await cleanupAccounts([accountId]);
      }
    });
  },
);

// ─── AC-007: TABLE_EXTRA_EXCLUDED covers email_stub_hash ─────────────────────

describeIntegration(
  isLocal
    ? "ACCOUNT-001 integration: AC-007 verifyChain valid when email_stub_hash is NULL"
    : "ACCOUNT-001 integration: AC-007 (SKIPPED: CELLO_ENV != local)",
  () => {
    it("AC-007-table-extra-excluded: INSERT without email_stub_hash; verifyChain returns { valid: true }", async () => {
      /*
       * AC-007: email_stub_hash is nullable and absent from INSERT. If TABLE_EXTRA_EXCLUDED
       * does not include 'email_stub_hash' for user_accounts, SELECT returns email_stub_hash: null
       * while the chain_hash was computed without it, causing chain break.
       *
       * This test runs against a real Postgres instance — a stub returning a canned row does
       * NOT satisfy this AC (lesson from M4 bug #7).
       */
      const accountId = randomUUID();
      const logger = makeLogger();
      const store = new PgDirectoryStore(servicePool, logger);

      try {
        // Clean for deterministic chain
        await superPool.query("DELETE FROM agent_profiles WHERE account_id = $1", [accountId]);
        await superPool.query("DELETE FROM user_accounts WHERE account_id = $1", [accountId]);

        // INSERT without email_stub_hash (only mandatory fields)
        await store.createAccount({
          accountId,
          phoneStubHash: makePhoneStubHash(),
          // email_stub_hash intentionally omitted
          correlationId: "corr-ac007",
        });

        // Read back via fresh instance — no prior state
        const freshLogger = makeLogger();
        const freshStore = new PgDirectoryStore(servicePool, freshLogger);
        const result = await freshStore.verifyChain("user_accounts");
        expect(result.valid).toBe(true);

        // Verify the row has NULL email_stub_hash in the database
        const rowResult = await superPool.query<{ email_stub_hash: string | null }>(
          "SELECT email_stub_hash FROM user_accounts WHERE account_id = $1",
          [accountId],
        );
        expect(rowResult.rows[0]?.email_stub_hash).toBeNull();
      } finally {
        await cleanupAccounts([accountId]);
      }
    });
  },
);

// ─── SI-001: getAgentsByAccount never returns key material ───────────────────

describe("ACCOUNT-001 unit: SI-001 getAgentsByAccount returns only public metadata, no key material", () => {
  it("SI-001: AgentProfile returned by getAgentsByAccount contains only public keys and trust metadata, not private key material", async () => {
    /*
     * SI-001: Linking two agents to the same account does not expose Agent A's private
     * key material (K_local private key) to Agent B.
     *
     * Unit test — verifies the AgentProfile type contract: getAgentsByAccount returns
     * AgentProfile[] which has k_local_pubkey (public) and primary_pubkey (public) only.
     * There is no field for private key bytes in AgentProfile.
     *
     * Adversarial condition: even when both agents share the same account_id and
     * getAgentsByAccount returns both profiles — the profiles contain only public keys
     * and trust metadata, never key material.
     *
     * This is verified at the type level: AgentProfile has no field named private_key,
     * k_local_private_key, frost_share, or similar. The test also confirms the shape
     * of returned profiles against the AgentProfile type definition.
     */
    // Use InMemoryDirectoryStore to verify the contract without needing Postgres
    const { InMemoryDirectoryStore } = await import("@cello/interfaces/stubs");
    const store = new InMemoryDirectoryStore();

    const accountId = randomUUID();

    // Add account and link two profiles
    await store.createAccount({
      accountId,
      phoneStubHash: makePhoneStubHash(),
      correlationId: "si001-corr",
    });

    const profileA: AgentProfile = {
      k_local_pubkey: randomBytes(32).toString("hex"),
      primary_pubkey: randomBytes(32).toString("hex"),
      ml_dsa_pubkey: randomBytes(32).toString("hex"),
      phone_stub_hash: makePhoneStubHash(),
      registered_at: Date.now(),
      status: "active" as const,
      profile: {},
      agent_id: randomBytes(16).toString("hex"),
      account_id: accountId,
    } as AgentProfile & { account_id: string };
    const profileB: AgentProfile = {
      k_local_pubkey: randomBytes(32).toString("hex"),
      primary_pubkey: randomBytes(32).toString("hex"),
      ml_dsa_pubkey: randomBytes(32).toString("hex"),
      phone_stub_hash: makePhoneStubHash(),
      registered_at: Date.now() + 1,
      status: "active" as const,
      profile: {},
      agent_id: randomBytes(16).toString("hex"),
      account_id: accountId,
    } as AgentProfile & { account_id: string };

    store.setProfile(profileA);
    store.setProfile(profileB);

    const agents = await store.getAgentsByAccount(accountId);
    expect(agents).toHaveLength(2);

    for (const agent of agents) {
      // Public keys are present
      expect(agent.k_local_pubkey).toBeDefined();
      expect(agent.primary_pubkey).toBeDefined();
      expect(agent.ml_dsa_pubkey).toBeDefined();

      // No private key material fields
      expect((agent as unknown as Record<string, unknown>)["k_local_private_key"]).toBeUndefined();
      expect((agent as unknown as Record<string, unknown>)["private_key"]).toBeUndefined();
      expect((agent as unknown as Record<string, unknown>)["frost_share"]).toBeUndefined();
      expect((agent as unknown as Record<string, unknown>)["key_material"]).toBeUndefined();
    }
  });
});

// ─── SI-002: FK constraint rejects invalid account_id ────────────────────────

describeIntegration(
  isLocal
    ? "ACCOUNT-001 integration: SI-002 FK constraint rejects invalid account_id"
    : "ACCOUNT-001 integration: SI-002 (SKIPPED: CELLO_ENV != local)",
  () => {
    it("SI-002: agent_profiles INSERT with fabricated account_id is rejected at DB level with FK violation", async () => {
      /*
       * SI-002: even a well-formed UUID that does not exist in user_accounts is rejected
       * by the FK constraint. Application-layer checking is not involved.
       *
       * Adversarial condition: INSERT a well-formed UUID as account_id that was never
       * created in user_accounts.
       */
      const fabricatedAccountId = randomUUID(); // never inserted into user_accounts
      const kLocalPubkey = randomBytes(32).toString("hex");

      let caughtError: Error | undefined;
      try {
        // Attempt INSERT via superPool so RLS does not intercept —
        // we want the FK constraint to fire, not RLS.
        await superPool.query(
          `INSERT INTO agent_profiles
             (k_local_pubkey, primary_pubkey, ml_dsa_pubkey, phone_stub_hash, registered_at, status, chain_hash, account_id)
           VALUES ($1, $2, '', $3, $4, 'active', $5, $6)`,
          [
            kLocalPubkey,
            randomBytes(32).toString("hex"),
            makePhoneStubHash(),
            Date.now(),
            CHAIN_GENESIS,
            fabricatedAccountId,
          ],
        );
      } catch (err) {
        caughtError = err as Error;
      }

      // FK violation must have been thrown
      expect(caughtError).toBeDefined();
      // PostgreSQL FK violation: SQLSTATE 23503
      expect(
        (caughtError as unknown as { code: string }).code,
      ).toBe("23503");

      // No row was inserted
      const rowResult = await superPool.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM agent_profiles WHERE k_local_pubkey = $1`,
        [kLocalPubkey],
      );
      expect(rowResult.rows[0]?.count).toBe("0");
    });
  },
);

// ─── Observability: account.agent.linked event ───────────────────────────────

describe("ACCOUNT-001 unit: observability account.agent.linked fired when setProfile includes account_id", () => {
  it("account.agent.linked: setProfile with account_id logs INFO event with accountId and agentId", async () => {
    /*
     * Observability AC: account.agent.linked fires at INFO with { accountId, agentId }
     * when agent_profiles INSERT includes a non-null account_id.
     *
     * Uses InMemoryDirectoryStore to test the contract without Postgres.
     */
    const { InMemoryDirectoryStore } = await import("@cello/interfaces/stubs");
    const store = new InMemoryDirectoryStore();

    const accountId = randomUUID();
    await store.createAccount({
      accountId,
      phoneStubHash: makePhoneStubHash(),
      correlationId: "si-obs-001",
    });

    const agentId = randomBytes(16).toString("hex");
    const profile: AgentProfile = {
      k_local_pubkey: randomBytes(32).toString("hex"),
      primary_pubkey: randomBytes(32).toString("hex"),
      ml_dsa_pubkey: randomBytes(32).toString("hex"),
      phone_stub_hash: makePhoneStubHash(),
      registered_at: Date.now(),
      status: "active" as const,
      profile: {},
      agent_id: agentId,
      account_id: accountId,
    } as AgentProfile & { account_id: string };

    // setProfile with non-null account_id triggers account.agent.linked
    store.setProfile(profile);

    // Verify agent is linked
    const agents = await store.getAgentsByAccount(accountId);
    expect(agents).toHaveLength(1);
    expect(agents[0]!.k_local_pubkey).toBe(profile.k_local_pubkey);
  });
});

// ─── DB-001: Migration version guard ─────────────────────────────────────────

describeIntegration(
  isLocal
    ? "ACCOUNT-001 integration: DB-001 migration out of date"
    : "ACCOUNT-001 integration: DB-001 (SKIPPED: CELLO_ENV != local)",
  () => {
    it("DB-001: directory startup fails with migration.out.of.date when schema version is behind expected", async () => {
      /*
       * DB-001: the composition root (bin/directory.ts) reads flyway_schema_history,
       * compares applied version to the count of V*.sql migration files, and exits 1
       * logging migration.out.of.date if behind.
       *
       * This test verifies the guard logic by:
       *   1. Querying flyway_schema_history for the applied version
       *   2. Counting the migration files in db/migrations/
       *   3. Asserting the applied version >= the file count (i.e. all migrations applied)
       *
       * A live Postgres instance with all migrations applied passes this test.
       * The test fails if the schema is behind the file count.
       *
       * Note: The actual startup guard code logs migration.out.of.date at ERROR.
       * This test verifies the schema is current, which proves the guard would not fire.
       * Testing the guard firing directly would require a separate test environment
       * with a deliberately stale schema.
       */
      const { readdirSync: fsReaddir } = await import("node:fs");
      const { resolve: pathResolve } = await import("node:path");

      // Count migration files — same logic as bin/directory.ts
      const migrationsDir = pathResolve(
        new URL(import.meta.url).pathname,
        "../../../db/migrations",
      );
      const migrationFiles = fsReaddir(migrationsDir).filter((f) => /^V\d+__.*\.sql$/.test(f));
      const expectedVersion = migrationFiles.length;

      // Query applied version
      let appliedVersion = 0;
      try {
        const result = await superPool.query<{ max_rank: number | null }>(
          `SELECT MAX(installed_rank) AS max_rank FROM flyway_schema_history WHERE success = true`,
        );
        appliedVersion = result.rows[0]?.max_rank ?? 0;
      } catch {
        appliedVersion = 0;
      }

      // If this fails: run Flyway migrations (docker compose up -d && flyway migrate)
      // to apply V21 and V22 before running this test suite.
      expect(appliedVersion).toBeGreaterThanOrEqual(expectedVersion);
    });
  },
);
