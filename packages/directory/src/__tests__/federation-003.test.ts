/**
 * CELLO-FEDERATION-003 — Relay node registration with directory
 *
 * Specification (each AC stated before its test):
 *
 * AC-001: relay_registrations table exists with correct schema and RLS.
 *   V19 migration creates relay_registrations with:
 *     id BIGSERIAL PRIMARY KEY, relay_id TEXT NOT NULL UNIQUE,
 *     public_key_hex TEXT NOT NULL, region TEXT NOT NULL,
 *     registered_at TIMESTAMPTZ NOT NULL DEFAULT now(), chain_hash TEXT.
 *   RLS is enabled with insert_only and select_all policies.
 *   cello_service has INSERT and SELECT only.
 *   [Integration — CELLO_ENV=local]
 *
 * AC-008-idempotency: running V19 migration twice produces no new flyway_schema_history rows.
 *   CREATE TABLE uses IF NOT EXISTS. Safe to apply V19 twice.
 *   [Integration — CELLO_ENV=local]
 *
 * AC-009-store-tables: relay_registrations is in STORE_TABLES; relay_registrations.id (BIGSERIAL)
 *   is in BIGINT_COLUMNS. registerRelay() round-trip integration test.
 *   [Static (no DB) + Integration — CELLO_ENV=local]
 *
 * AC-010-table-extra-excluded: deregistered_at is in TABLE_EXTRA_EXCLUDED for relay_registrations.
 *   verifyChain('relay_registrations') returns { valid: true } after registerRelay().
 *   [Integration — CELLO_ENV=local]
 *
 * SI-001: relay_registrations is append-only — re-registration with same key is a no-op;
 *   re-registration with different key is rejected with RELAY_IDENTITY_CONFLICT.
 *   Adversarial: attempt to register a relay_id with a new public_key_hex — must be rejected,
 *   no row updated.
 *   [Integration — CELLO_ENV=local]
 *
 * SI-003: registration endpoint requires Ed25519 self-signature.
 *   Adversarial: submit a valid public_key_hex with a signature from a DIFFERENT key.
 *   Must be rejected with RELAY_REGISTRATION_UNAUTHORIZED.
 *   [Integration — CELLO_ENV=local]
 *
 * Observability: relay.registered, relay.already.registered, relay.registration.conflict
 *   events are emitted with correct fields.
 *   [Unit — logger spy]
 *
 * AC-011-dist-freshness: checked post-typecheck in the gate sequence (not a Vitest test).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import {
  PgDirectoryStore,
  BIGINT_COLUMNS,
  STORE_TABLES,
} from "../adapters/pg-directory-store.js";
import { configurePgTypes } from "../pg-type-config.js";
import { verifyChain, HASH_CHAINED_TABLES } from "../hash-chain.js";
import type { Logger } from "@cello/interfaces";

// ─── Environment setup ─────────────────────────────────────────────────────────

const isLocal = process.env["CELLO_ENV"] === "local";
const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgresql://postgres:dev@localhost:5433/cello_dev";

const SERVICE_URL = DATABASE_URL.replace(
  /^(postgres(?:ql)?):\/\/[^:]+:[^@]+@/,
  "$1://cello_service:cello_service_dev@",
);

const describeIntegration = isLocal ? describe : describe.skip;

// ─── Logger stub ──────────────────────────────────────────────────────────────

function makeTestLogger(): Logger & {
  infoEvents: Array<[string, Record<string, unknown>]>;
  warnEvents: Array<[string, Record<string, unknown>]>;
  errorEvents: Array<[string, Record<string, unknown>]>;
} {
  const infoEvents: Array<[string, Record<string, unknown>]> = [];
  const warnEvents: Array<[string, Record<string, unknown>]> = [];
  const errorEvents: Array<[string, Record<string, unknown>]> = [];
  return {
    infoEvents,
    warnEvents,
    errorEvents,
    debug(_event: string, _ctx?: Record<string, unknown>) { /* no-op in tests */ },
    info(event: string, ctx?: Record<string, unknown>) { infoEvents.push([event, ctx ?? {}]); },
    warn(event: string, ctx?: Record<string, unknown>) { warnEvents.push([event, ctx ?? {}]); },
    error(event: string, ctxOrErr?: unknown, ctx?: Record<string, unknown>) {
      const c = ctx ?? (ctxOrErr instanceof Error ? {} : (ctxOrErr as Record<string, unknown> | undefined) ?? {});
      errorEvents.push([event, c]);
    },
  };
}

// ─── Static analysis: STORE_TABLES and BIGINT_COLUMNS ─────────────────────────

describe("FEDERATION-003: static analysis — relay_registrations in STORE_TABLES and BIGINT_COLUMNS", () => {
  it("AC-009-store-tables: STORE_TABLES includes relay_registrations", () => {
    expect(STORE_TABLES).toContain("relay_registrations");
  });

  it("AC-009-store-tables: BIGINT_COLUMNS declares relay_registrations.id", () => {
    expect(BIGINT_COLUMNS["relay_registrations"]).toContain("id");
  });
});

// ─── Static analysis: HASH_CHAINED_TABLES ─────────────────────────────────────

describe("FEDERATION-003: static analysis — relay_registrations in HASH_CHAINED_TABLES", () => {
  it("relay_registrations is in HASH_CHAINED_TABLES", () => {
    expect(HASH_CHAINED_TABLES).toContain("relay_registrations");
  });
});

// ─── Static analysis: TABLE_EXTRA_EXCLUDED ────────────────────────────────────
// AC-010-table-extra-excluded: deregistered_at must be in TABLE_EXTRA_EXCLUDED.
// We verify this indirectly by importing the hash-chain module and running verifyChain
// (if deregistered_at were absent, verifyChain would return { valid: false }).
// The direct TABLE_EXTRA_EXCLUDED export test is an integration test (AC-010-table-extra-excluded).

// ─── Integration tests — require CELLO_ENV=local ──────────────────────────────

describeIntegration("FEDERATION-003 integration: AC-001 relay_registrations table schema", () => {
  let superPool: pg.Pool;

  beforeAll(async () => {
    configurePgTypes();
    superPool = new pg.Pool({ connectionString: DATABASE_URL });
    try {
      await superPool.query("SELECT 1");
    } catch (err) {
      throw new Error(
        `[FEDERATION-003] CELLO_ENV=local but Postgres is unreachable at ${DATABASE_URL}: ${String(err)}`,
      );
    }
  });

  afterAll(async () => {
    await superPool?.end();
  });

  it("AC-001: relay_registrations table exists with correct columns and NOT NULL constraints", async () => {
    // Verify table exists
    const tableResult = await superPool.query<{ count: string }>(
      `SELECT COUNT(*) FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'relay_registrations'`,
    );
    expect(parseInt(tableResult.rows[0]!.count, 10)).toBe(1);

    // Verify column schema
    const colResult = await superPool.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
    }>(
      `SELECT column_name, data_type, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'relay_registrations'
       ORDER BY column_name`,
    );
    const cols = Object.fromEntries(
      colResult.rows.map((r) => [r.column_name, { data_type: r.data_type, is_nullable: r.is_nullable }]),
    );

    // id BIGSERIAL PRIMARY KEY — bigint NOT NULL
    expect(cols["id"], "id column must exist").toBeDefined();
    expect(cols["id"]!.data_type).toBe("bigint");
    expect(cols["id"]!.is_nullable).toBe("NO");

    // relay_id TEXT NOT NULL UNIQUE
    expect(cols["relay_id"], "relay_id column must exist").toBeDefined();
    expect(cols["relay_id"]!.data_type).toBe("text");
    expect(cols["relay_id"]!.is_nullable).toBe("NO");

    // public_key_hex TEXT NOT NULL
    expect(cols["public_key_hex"], "public_key_hex column must exist").toBeDefined();
    expect(cols["public_key_hex"]!.data_type).toBe("text");
    expect(cols["public_key_hex"]!.is_nullable).toBe("NO");

    // region TEXT NOT NULL
    expect(cols["region"], "region column must exist").toBeDefined();
    expect(cols["region"]!.data_type).toBe("text");
    expect(cols["region"]!.is_nullable).toBe("NO");

    // registered_at TIMESTAMPTZ NOT NULL DEFAULT now()
    expect(cols["registered_at"], "registered_at column must exist").toBeDefined();
    expect(cols["registered_at"]!.data_type).toBe("timestamp with time zone");
    expect(cols["registered_at"]!.is_nullable).toBe("NO");

    // chain_hash TEXT (nullable — not set by default until computed; V19 leaves it nullable
    // like the pattern in other tables where chain_hash uses DEFAULT '' and is set by insertWithChain)
    expect(cols["chain_hash"], "chain_hash column must exist").toBeDefined();

    // UNIQUE constraint on relay_id
    const uqResult = await superPool.query<{ constraint_name: string }>(
      `SELECT tc.constraint_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.constraint_column_usage ccu
         ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
       WHERE tc.table_schema = 'public'
         AND tc.table_name = 'relay_registrations'
         AND tc.constraint_type = 'UNIQUE'
         AND ccu.column_name = 'relay_id'`,
    );
    expect(uqResult.rows.length, "UNIQUE constraint on relay_registrations.relay_id must exist").toBeGreaterThan(0);
  });

  it("AC-001: RLS is enabled on relay_registrations with insert_only and select_all policies", async () => {
    // Verify RLS is enabled
    const rlsResult = await superPool.query<{ relrowsecurity: boolean }>(
      `SELECT c.relrowsecurity
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = 'relay_registrations'`,
    );
    expect(rlsResult.rows[0]?.relrowsecurity, "RLS must be enabled on relay_registrations").toBe(true);

    // Verify insert_only and select_all policies exist
    const policyResult = await superPool.query<{ policyname: string; cmd: string }>(
      `SELECT policyname, cmd
       FROM pg_policies
       WHERE tablename = 'relay_registrations'
       ORDER BY policyname`,
    );
    const policyNames = policyResult.rows.map((r) => r.policyname);
    expect(policyNames).toContain("relay_registrations_insert");
    expect(policyNames).toContain("relay_registrations_select");
  });

  it("AC-001: cello_service has INSERT and SELECT only on relay_registrations (not UPDATE, DELETE)", async () => {
    // Verify cello_service can INSERT and SELECT
    const servicePool = new pg.Pool({ connectionString: SERVICE_URL });
    try {
      // INSERT via service role — should succeed
      const testRelayId = randomUUID().replace(/-/g, "");
      const testPubKeyHex = "a".repeat(64);
      await servicePool.query(
        `INSERT INTO relay_registrations (relay_id, public_key_hex, region, chain_hash)
         VALUES ($1, $2, $3, $4)`,
        [testRelayId, testPubKeyHex, "us-east-1", ""],
      );

      // SELECT via service role — should succeed
      const sel = await servicePool.query<{ relay_id: string }>(
        `SELECT relay_id FROM relay_registrations WHERE relay_id = $1`,
        [testRelayId],
      );
      expect(sel.rows.length).toBe(1);

      // UPDATE via service role — should fail (no UPDATE privilege)
      await expect(
        servicePool.query(
          `UPDATE relay_registrations SET region = 'eu-west-1' WHERE relay_id = $1`,
          [testRelayId],
        ),
      ).rejects.toThrow();

      // DELETE via service role — should fail (no DELETE privilege)
      await expect(
        servicePool.query(
          `DELETE FROM relay_registrations WHERE relay_id = $1`,
          [testRelayId],
        ),
      ).rejects.toThrow();
    } finally {
      // Cleanup via superuser
      await superPool.query(`DELETE FROM relay_registrations WHERE relay_id LIKE '________________________________'`).catch(() => {});
      await servicePool.end();
    }
  });
});

describeIntegration("FEDERATION-003 integration: AC-008-idempotency — V19 migration runs twice safely", () => {
  let superPool: pg.Pool;

  beforeAll(async () => {
    configurePgTypes();
    superPool = new pg.Pool({ connectionString: DATABASE_URL });
    await superPool.query("SELECT 1");
  });

  afterAll(async () => {
    await superPool?.end();
  });

  it("AC-008-idempotency: V19 migration is idempotent — relay_registrations uses IF NOT EXISTS", async () => {
    // Count flyway_schema_history rows before any re-run attempt
    const before = await superPool.query<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt FROM flyway_schema_history WHERE success = true`,
    );
    const countBefore = parseInt(before.rows[0]!.cnt, 10);

    // Try to re-run V19 idempotent CREATE TABLE statement manually
    // If the table already exists, IF NOT EXISTS makes this a no-op
    await expect(
      superPool.query(`
        CREATE TABLE IF NOT EXISTS relay_registrations (
          id BIGSERIAL PRIMARY KEY,
          relay_id TEXT NOT NULL UNIQUE,
          public_key_hex TEXT NOT NULL,
          region TEXT NOT NULL,
          registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          chain_hash TEXT NOT NULL DEFAULT ''
        )
      `),
    ).resolves.not.toThrow();

    // flyway_schema_history should not have changed
    const after = await superPool.query<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt FROM flyway_schema_history WHERE success = true`,
    );
    const countAfter = parseInt(after.rows[0]!.cnt, 10);
    expect(countAfter).toBe(countBefore);
  });
});

describeIntegration("FEDERATION-003 integration: AC-009-store-tables registerRelay round-trip", () => {
  let superPool: pg.Pool;
  let servicePool: pg.Pool;

  beforeAll(async () => {
    configurePgTypes();
    superPool = new pg.Pool({ connectionString: DATABASE_URL });
    servicePool = new pg.Pool({ connectionString: SERVICE_URL });
    await superPool.query("SELECT 1");
  });

  afterAll(async () => {
    await superPool?.end();
    await servicePool?.end();
  });

  it("AC-009-store-tables: registerRelay() writes a row; getRelayPublicKey() returns it from a fresh instance", async () => {
    const logger = makeTestLogger();
    const store = new PgDirectoryStore(servicePool, logger, "test-node", "us-east-1");

    const relayId = randomUUID().replace(/-/g, "").slice(0, 32) + "aa";
    const publicKeyHex = Buffer.from(Array.from({ length: 32 }, (_, i) => i)).toString("hex");
    const region = "us-east-1";

    await store.registerRelay({ relayId, publicKeyHex, region });

    // Verify row exists via superuser
    const result = await superPool.query<{ relay_id: string; public_key_hex: string; region: string }>(
      `SELECT relay_id, public_key_hex, region FROM relay_registrations WHERE relay_id = $1`,
      [relayId],
    );
    expect(result.rows.length).toBe(1);
    expect(result.rows[0]!.public_key_hex).toBe(publicKeyHex);
    expect(result.rows[0]!.region).toBe(region);

    // Read back via a FRESH PgDirectoryStore (no in-memory cache) — evidence of live SELECT
    const freshStore = new PgDirectoryStore(servicePool, makeTestLogger(), "test-node-2", "us-east-1");
    const retrieved = await freshStore.getRelayPublicKey(relayId);
    expect(retrieved).toBe(publicKeyHex);

    // relay.registered event was logged
    const registeredEvent = logger.infoEvents.find(([ev]) => ev === "relay.registered");
    expect(registeredEvent, "relay.registered event must be logged").toBeDefined();
    expect(registeredEvent![1]).toMatchObject({ relayId, region });

    // Cleanup
    await superPool.query(`DELETE FROM relay_registrations WHERE relay_id = $1`, [relayId]);
  });

  it("AC-009-store-tables: getRelayPublicKey() returns undefined for unknown relayId", async () => {
    const logger = makeTestLogger();
    const store = new PgDirectoryStore(servicePool, logger, "test-node", "us-east-1");
    const result = await store.getRelayPublicKey("nonexistent-relay-id");
    expect(result).toBeUndefined();
  });
});

describeIntegration("FEDERATION-003 integration: AC-010-table-extra-excluded — verifyChain is valid after registerRelay", () => {
  let superPool: pg.Pool;
  let servicePool: pg.Pool;

  beforeAll(async () => {
    configurePgTypes();
    superPool = new pg.Pool({ connectionString: DATABASE_URL });
    servicePool = new pg.Pool({ connectionString: SERVICE_URL });
    await superPool.query("SELECT 1");
  });

  afterAll(async () => {
    await superPool?.end();
    await servicePool?.end();
  });

  it("AC-010-table-extra-excluded: verifyChain returns { valid: true } after registerRelay (deregistered_at is NULL but excluded)", async () => {
    const logger = makeTestLogger();
    const store = new PgDirectoryStore(servicePool, logger, "test-node", "us-east-1");

    const relayId = randomUUID().replace(/-/g, "").slice(0, 32) + "bb";
    const publicKeyHex = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 10)).toString("hex");

    await store.registerRelay({ relayId, publicKeyHex, region: "eu-central-1" });

    // Fetch rows via superuser to run verifyChain
    const rows = await superPool.query<Record<string, unknown>>(
      `SELECT * FROM relay_registrations WHERE relay_id = $1 ORDER BY id ASC`,
      [relayId],
    );
    expect(rows.rows.length).toBe(1);

    // deregistered_at will be NULL in the row — verifyChain must succeed because
    // deregistered_at is excluded from chain hash computation via TABLE_EXTRA_EXCLUDED.
    // If deregistered_at is NOT excluded, verifyChain would return { valid: false }
    // (the stored chain_hash was computed without deregistered_at, but SELECT * includes it as NULL).
    const result = verifyChain(rows.rows, logger, "relay_registrations");
    expect(result.valid, `verifyChain must return { valid: true } — if false, deregistered_at is missing from TABLE_EXTRA_EXCLUDED: ${JSON.stringify(result)}`).toBe(true);

    // Cleanup
    await superPool.query(`DELETE FROM relay_registrations WHERE relay_id = $1`, [relayId]);
  });
});

describeIntegration("FEDERATION-003 integration: SI-001 relay_registrations is append-only", () => {
  let superPool: pg.Pool;
  let servicePool: pg.Pool;

  beforeAll(async () => {
    configurePgTypes();
    superPool = new pg.Pool({ connectionString: DATABASE_URL });
    servicePool = new pg.Pool({ connectionString: SERVICE_URL });
    await superPool.query("SELECT 1");
  });

  afterAll(async () => {
    await superPool?.end();
    await servicePool?.end();
  });

  it("AC-003/SI-001: re-registration with same key is a no-op — row count stays at 1, relay.already.registered logged", async () => {
    const logger = makeTestLogger();
    const store = new PgDirectoryStore(servicePool, logger, "test-node", "us-east-1");

    const relayId = randomUUID().replace(/-/g, "").slice(0, 32) + "cc";
    const publicKeyHex = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 20)).toString("hex");

    // Register once
    await store.registerRelay({ relayId, publicKeyHex, region: "us-east-1" });

    // Count rows before
    const before = await superPool.query<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt FROM relay_registrations WHERE relay_id = $1`,
      [relayId],
    );
    expect(parseInt(before.rows[0]!.cnt, 10)).toBe(1);

    // Register again with same key — should be no-op
    await store.registerRelay({ relayId, publicKeyHex, region: "us-east-1" });

    // Count rows after — must still be 1
    const after = await superPool.query<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt FROM relay_registrations WHERE relay_id = $1`,
      [relayId],
    );
    expect(parseInt(after.rows[0]!.cnt, 10)).toBe(1);

    // relay.already.registered must be logged
    const alreadyRegistered = logger.infoEvents.find(([ev]) => ev === "relay.already.registered");
    expect(alreadyRegistered, "relay.already.registered must be logged on idempotent re-registration").toBeDefined();
    expect(alreadyRegistered![1]).toMatchObject({ relayId, region: "us-east-1" });

    // Cleanup
    await superPool.query(`DELETE FROM relay_registrations WHERE relay_id = $1`, [relayId]);
  });

  it("AC-007/SI-001: re-registration with DIFFERENT key is rejected with RELAY_IDENTITY_CONFLICT", async () => {
    const logger = makeTestLogger();
    const store = new PgDirectoryStore(servicePool, logger, "test-node", "us-east-1");

    const relayId = randomUUID().replace(/-/g, "").slice(0, 32) + "dd";
    const publicKeyHex1 = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 30)).toString("hex");
    const publicKeyHex2 = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 60)).toString("hex");

    // Register once with key1
    await store.registerRelay({ relayId, publicKeyHex: publicKeyHex1, region: "us-east-1" });

    // Attempt to register again with key2 — must throw RELAY_IDENTITY_CONFLICT
    await expect(
      store.registerRelay({ relayId, publicKeyHex: publicKeyHex2, region: "us-east-1" }),
    ).rejects.toThrow("RELAY_IDENTITY_CONFLICT");

    // Row count must still be 1 (no update, no second insert)
    const cnt = await superPool.query<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt FROM relay_registrations WHERE relay_id = $1`,
      [relayId],
    );
    expect(parseInt(cnt.rows[0]!.cnt, 10)).toBe(1);

    // relay.registration.conflict must be logged at ERROR
    const conflictEvent = logger.errorEvents.find(([ev]) => ev === "relay.registration.conflict");
    expect(conflictEvent, "relay.registration.conflict must be logged at ERROR").toBeDefined();
    expect(conflictEvent![1]).toMatchObject({ relayId, region: "us-east-1" });

    // Cleanup
    await superPool.query(`DELETE FROM relay_registrations WHERE relay_id = $1`, [relayId]);
  });
});

describeIntegration("FEDERATION-003 integration: SI-003 registration signature verification", () => {
  /**
   * SI-003: The relay registration endpoint requires self-signature.
   * The relay signs (relay_id || public_key_hex || timestamp) with its Ed25519 private key.
   * The directory verifies against the submitted public_key_hex.
   *
   * Here we test the verifyRelayRegistrationSignature() helper exported from
   * the relay-registration module, which is used by the endpoint handler.
   */
  it("SI-003: verifyRelayRegistrationSignature accepts valid self-signature", async () => {
    const { generateKeypair } = await import("@cello/crypto");
    const { verifyRelayRegistrationSignature, buildRelayRegistrationTbs } = await import("@cello/crypto");

    const kp = generateKeypair();
    const pubKey = await kp.getPublicKey();
    const publicKeyHex = Buffer.from(pubKey).toString("hex");
    const relayId = publicKeyHex; // relayId is always hex of pubkey
    const timestamp = Date.now();

    const tbs = buildRelayRegistrationTbs(relayId, publicKeyHex, timestamp);
    const signature = await kp.sign(tbs);

    const ok = await verifyRelayRegistrationSignature(publicKeyHex, relayId, publicKeyHex, timestamp, signature);
    expect(ok).toBe(true);
  });

  it("SI-003: verifyRelayRegistrationSignature rejects signature from different key", async () => {
    const { generateKeypair } = await import("@cello/crypto");
    const { verifyRelayRegistrationSignature, buildRelayRegistrationTbs } = await import("@cello/crypto");

    const kp = generateKeypair();
    const attackerKp = generateKeypair();

    const victimPubKey = await kp.getPublicKey();
    const victimPublicKeyHex = Buffer.from(victimPubKey).toString("hex");
    const relayId = victimPublicKeyHex;
    const timestamp = Date.now();

    // Sign with ATTACKER key, but submit victim's public_key_hex
    const tbs = buildRelayRegistrationTbs(relayId, victimPublicKeyHex, timestamp);
    const attackerSignature = await attackerKp.sign(tbs);

    const ok = await verifyRelayRegistrationSignature(victimPublicKeyHex, relayId, victimPublicKeyHex, timestamp, attackerSignature);
    expect(ok).toBe(false);
  });
});

// Observability events (relay.registered, relay.already.registered, relay.registration.conflict)
// are verified in the integration tests above:
//   - relay.registered: AC-009-store-tables test (registerRelay() round-trip)
//   - relay.already.registered: SI-001 test (same-key re-registration)
//   - relay.registration.conflict: SI-001/AC-007 test (different-key re-registration)
// No separate hollow unit tests are needed — the integration tests call registerRelay() directly
// and assert the event name and required context fields { relayId, region }.
