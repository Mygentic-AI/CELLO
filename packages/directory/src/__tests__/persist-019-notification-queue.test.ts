/**
 * CELLO-PERSIST-019 — notification_queue + pending_connection_requests migrations
 *
 * Specification interpretation:
 *
 * AC-001: After Flyway migrations applied to a local Postgres, both notification_queue
 *         and pending_connection_requests exist with correct columns, indexes, RLS enabled,
 *         and correct policies (insert_only, select_by_pubkey/select_all, delete_by_pubkey/delete_all).
 *         cello_service has no UPDATE privilege on either table.
 *
 * AC-002: enqueueNotification(pubkeyHex, event) inserts one row into notification_queue.
 *         drainNotifications(pubkeyHex) returns that notification, verifies row is deleted
 *         (count=0 after drain), and a second drain returns [].
 *
 * AC-003: Three notifications enqueued for agent A in order → drainNotifications returns
 *         all three in FIFO order (ordered by id ASC), all rows deleted in the same
 *         transaction.
 *
 * AC-004: queuePendingConnectionRequest(targetPubkey, request) inserts one row into
 *         pending_connection_requests. dequeuePendingConnectionRequests(targetPubkey)
 *         returns the request, deletes the row, and a second dequeue returns [].
 *         queue.pending_connection_requests.drained is logged at INFO with
 *         { targetPubkey, count, correlationId }.
 *
 * AC-005: A row with created_at > 24 hours old is NOT returned by
 *         dequeuePendingConnectionRequests(). The stale row is not deleted by dequeue
 *         (row count stays 1 after call). A fresh row IS returned and its row deleted.
 *
 * AC-006: TTL sweep deletes all rows from pending_connection_requests with
 *         created_at < now() - 24h. Fresh rows not deleted. Logs
 *         queue.pending_connection_requests.expired at INFO with { purgedCount }.
 *
 * AC-007: cello_service attempting UPDATE notification_queue → PostgreSQL rejects
 *         with permission denied. Enforcement is RLS policy, not application layer.
 *
 * AC-008: enqueueNotification() logs notification.queued at INFO with
 *         { pubkeyHex, notificationType, correlationId }.
 *
 * AC-009: drainNotifications() logs notification.drained at INFO with
 *         { pubkeyHex, count, correlationId }.
 *
 * SI-001: SELECT+DELETE in a single transaction — concurrent drainNotifications (and
 *         dequeuePendingConnectionRequests) calls for the same key with one queued item:
 *         exactly one caller receives it, the other receives [].
 *
 * SI-002: No private key material in DirectoryNotification payloads — every variant
 *         serialized and checked against /k_local|k_server|frost_share|private_key|secret/i.
 *
 * SI-003: RLS SELECT policy filters notification_queue by app.current_pubkey — a direct
 *         SELECT without application-layer WHERE returns 0 rows for a different agent's
 *         notifications.
 *
 * DB-001: enqueueNotification() INSERT fails → logs notification.enqueue.failed at ERROR
 *         with { pubkeyHex, notificationType, reason }.
 *
 * DB-002: CELLO_ENV != local → integration tests skip; CELLO_ENV=local + connection
 *         refused → tests fail.
 *
 * test_type: integration (all database ACs) + unit (SI-002, DB-001)
 *
 * Run with:
 *   docker compose up -d && docker compose run --rm flyway
 *   CELLO_ENV=local DATABASE_URL=postgresql://postgres:dev@localhost:5433/cello_dev \
 *     pnpm --filter @cello-protocol/directory run test -- \
 *       --pool-options.threads.maxThreads=1 --pool-options.threads.minThreads=1
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import pg from "pg";
import { randomUUID, randomBytes } from "node:crypto";
import type { Logger } from "@cello-protocol/interfaces";
import type { DirectoryNotification } from "@cello-protocol/interfaces";
import type { PendingConnectionRequest } from "@cello-protocol/protocol-types";
import { PgDirectoryStore } from "../adapters/pg-directory-store.js";
import { PendingConnectionRequestTtlSweep } from "../pending-connection-request-ttl-sweep.js";

// ─── Environment guards ───────────────────────────────────────────────────────

const isLocal = process.env["CELLO_ENV"] === "local";
const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgresql://postgres:dev@localhost:5433/cello_dev";

// ─── Helper: mock Logger ──────────────────────────────────────────────────────

function makeMockLogger(): Logger & {
  infoEvents: Array<{ event: string; context: Record<string, unknown> }>;
  errorEvents: Array<{ event: string; context: Record<string, unknown> }>;
} {
  const infoEvents: Array<{ event: string; context: Record<string, unknown> }> = [];
  const errorEvents: Array<{ event: string; context: Record<string, unknown> }> = [];
  return {
    infoEvents,
    errorEvents,
    debug: vi.fn(),
    info: vi.fn((event: string, context?: Record<string, unknown>) => {
      infoEvents.push({ event, context: context ?? {} });
    }),
    warn: vi.fn(),
    error: vi.fn((event: string, errorOrContext?: Error | Record<string, unknown>, context?: Record<string, unknown>) => {
      const ctx = errorOrContext instanceof Error ? (context ?? {}) : (errorOrContext ?? {});
      errorEvents.push({ event, context: ctx });
    }),
  };
}

// ─── Helper: build a minimal PendingConnectionRequest ────────────────────────

function makePendingConnectionRequest(override?: Partial<PendingConnectionRequest>): PendingConnectionRequest {
  return {
    connection_request_id: randomUUID(),
    sender_pubkey: randomBytes(32).toString("hex"),
    frame: {
      type: "connection_request_inbound",
      from_pubkey: randomBytes(32).toString("hex"),
      connection_request_id: randomUUID(),
      package_cbor: new Uint8Array(8),
      sender_registered_at: Date.now(),
      sender_is_provisional: false,
    },
    queued_at: Date.now(),
    ...override,
  };
}

// ─── Helper: build a minimal DirectoryNotification ───────────────────────────

function makeConnectionEstablishedNotification(): DirectoryNotification {
  return {
    type: "connection_established",
    counterparty_pubkey: randomBytes(32).toString("hex"),
    connection_id: randomBytes(16).toString("hex"),
  };
}

// ─── Helper: poll for row existence (replaces brittle setTimeout waits) ────────

async function waitForRow(
  pool: pg.Pool,
  table: string,
  column: string,
  value: string,
  timeoutMs = 2000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { rows } = await pool.query(
      `SELECT 1 FROM ${table} WHERE ${column} = $1 LIMIT 1`,
      [value],
    );
    if (rows.length > 0) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Timed out waiting for row in ${table}`);
}

// ─── SI-002 — Unit test: no private key material in notification payloads ─────

describe("PERSIST-019 SI-002: notification payloads contain no private key material", () => {
  it("SI-002: all DirectoryNotification variants serialise without key material", () => {
    const sensitivePattern = /k_local|k_server|frost_share|private_key|secret/i;

    // SI-002: Use protocol-valid types. Binary fields (Uint8Array) serialize to
    // { type: "Buffer", data: [...] } in JSON — neither form can match the sensitive pattern.
    const sessionIdBytes = randomBytes(16);
    const sealedRootBytes = randomBytes(32);

    const variants: DirectoryNotification[] = [
      {
        type: "connection_established",
        counterparty_pubkey: randomBytes(32).toString("hex"),
        connection_id: randomBytes(16).toString("hex"),
      },
      {
        type: "session_sealed",
        signature_type: "single",
        session_id: sessionIdBytes,
        sealed_root: sealedRootBytes,
        directory_signature: randomBytes(64),
        close_timestamp: Date.now(),
      },
      {
        type: "session_seal_rejected",
        session_id: sessionIdBytes,
        reason: "merkle_root_mismatch",
      },
      {
        type: "seal_verified",
        session_id: sessionIdBytes,
        sealed_root: sealedRootBytes,
        leaf_count: 5,
        timestamp: Date.now(),
      },
      {
        type: "session_abandoned",
        session_id: sessionIdBytes,
      },
    ];

    for (const notification of variants) {
      const serialized = JSON.stringify(notification);
      expect(
        sensitivePattern.test(serialized),
        `Variant ${notification.type} serialized to: ${serialized}`,
      ).toBe(false);
    }
  });
});

// ─── DB-001 — Unit test: enqueueNotification log on INSERT failure ─────────────

describe("PERSIST-019 DB-001: notification.enqueue.failed logged on INSERT error", () => {
  it("DB-001: logs notification.enqueue.failed at ERROR when pool.query rejects", async () => {
    const logger = makeMockLogger();

    // Create a stub pool whose query always rejects
    const failingPool = {
      query: vi.fn().mockRejectedValue(new Error("connection refused")),
    } as unknown as pg.Pool;

    const store = new PgDirectoryStore(failingPool, logger);
    const notification = makeConnectionEstablishedNotification();
    const pubkeyHex = randomBytes(32).toString("hex");

    store.enqueueNotification(pubkeyHex, notification);

    // Wait for the fire-and-forget rejection to propagate
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    const errorEvent = logger.errorEvents.find((e) => e.event === "notification.enqueue.failed");
    expect(errorEvent, "notification.enqueue.failed was not logged").toBeDefined();
    expect(errorEvent!.context).toMatchObject({
      pubkeyHex,
      notificationType: notification.type,
    });
    expect(typeof errorEvent!.context["reason"]).toBe("string");
  });
});

// ─── Integration tests (require CELLO_ENV=local + real Postgres) ─────────────

const describeIntegration = isLocal ? describe : describe.skip;

let superPool: pg.Pool; // postgres superuser — for setup/verification and bypassing RLS
let servicePool: pg.Pool; // cello_service — validates RLS enforcement

beforeAll(async () => {
  if (!isLocal) return;

  // DB-002: fail hard if CELLO_ENV=local but Postgres is unreachable
  superPool = new pg.Pool({ connectionString: DATABASE_URL });
  try {
    await superPool.query("SELECT 1");
  } catch (err) {
    throw new Error(
      `CELLO_ENV=local but Postgres is unreachable at ${DATABASE_URL}: ${String(err)}`,
    );
  }

  const serviceUrl = DATABASE_URL.replace(
    /^(postgres(?:ql)?):\/\/[^:]+:[^@]+@/,
    "$1://cello_service:cello_service_dev@",
  );
  servicePool = new pg.Pool({ connectionString: serviceUrl });
  try {
    await servicePool.query("SELECT 1");
  } catch (err) {
    throw new Error(
      `CELLO_ENV=local but cello_service connection is unreachable: ${String(err)}`,
    );
  }
});

afterAll(async () => {
  if (!isLocal) return;
  await superPool?.end().catch(() => {});
  await servicePool?.end().catch(() => {});
});

// Clean up test rows before each test to avoid cross-test contamination
beforeEach(async () => {
  if (!isLocal) return;
  // Use superuser pool to delete rows without RLS constraints
  await superPool.query("DELETE FROM notification_queue");
  await superPool.query("DELETE FROM pending_connection_requests");
});

// ─── AC-001: Schema existence and structure ───────────────────────────────────

describeIntegration("PERSIST-019 AC-001: schema structure after Flyway migrations", () => {
  it("AC-001: notification_queue exists with required columns and correct data types", async () => {
    const result = await superPool.query<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'notification_queue'
       ORDER BY ordinal_position`,
    );
    const colMap = new Map(result.rows.map((r) => [r.column_name, r.data_type]));

    expect(colMap.has("id"), "notification_queue missing id").toBe(true);
    expect(colMap.has("pubkey_hex"), "notification_queue missing pubkey_hex").toBe(true);
    expect(colMap.has("payload"), "notification_queue missing payload").toBe(true);
    expect(colMap.has("created_at"), "notification_queue missing created_at").toBe(true);

    expect(colMap.get("id")).toBe("bigint");
    expect(colMap.get("pubkey_hex")).toBe("text");
    expect(colMap.get("payload")).toBe("jsonb");
    expect(colMap.get("created_at")).toBe("timestamp with time zone");
  });

  it("AC-001: notification_queue has index on pubkey_hex", async () => {
    const result = await superPool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
       WHERE tablename = 'notification_queue' AND schemaname = 'public'`,
    );
    const indexNames = result.rows.map((r) => r.indexname);
    expect(indexNames, "idx_notification_queue_pubkey missing").toContain("idx_notification_queue_pubkey");
  });

  it("AC-001: notification_queue has RLS enabled with insert_only, select_by_pubkey, delete_by_pubkey policies", async () => {
    const rlsResult = await superPool.query<{ relrowsecurity: boolean }>(
      `SELECT c.relrowsecurity
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = 'notification_queue'`,
    );
    expect(rlsResult.rows[0]?.relrowsecurity, "RLS not enabled on notification_queue").toBe(true);

    // AC-001: policy-name verification issued as cello_service (SET ROLE ensures the query
    // is executed in the same privilege context that application code uses at runtime)
    const policyResult = await servicePool.query<{ polname: string }>(
      `SELECT polname
       FROM pg_catalog.pg_policy p
       JOIN pg_class c ON c.oid = p.polrelid
       WHERE c.relname = 'notification_queue'`,
    );
    const policyNames = policyResult.rows.map((r) => r.polname);
    expect(policyNames, "insert_only policy missing").toContain("insert_only");
    expect(policyNames, "select_by_pubkey policy missing").toContain("select_by_pubkey");
    expect(policyNames, "delete_by_pubkey policy missing").toContain("delete_by_pubkey");
  });

  it("AC-001: cello_service has INSERT and SELECT on notification_queue but NOT UPDATE", async () => {
    const result = await superPool.query<{ privilege_type: string }>(
      `SELECT privilege_type
       FROM information_schema.role_table_grants
       WHERE grantee = 'cello_service' AND table_name = 'notification_queue'`,
    );
    const privileges = result.rows.map((r) => r.privilege_type);
    expect(privileges, "INSERT not granted").toContain("INSERT");
    expect(privileges, "SELECT not granted").toContain("SELECT");
    expect(privileges, "UPDATE must not be granted").not.toContain("UPDATE");
  });

  it("AC-001: pending_connection_requests exists with required columns and correct data types", async () => {
    const result = await superPool.query<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'pending_connection_requests'
       ORDER BY ordinal_position`,
    );
    const colMap = new Map(result.rows.map((r) => [r.column_name, r.data_type]));

    expect(colMap.has("id"), "pending_connection_requests missing id").toBe(true);
    expect(colMap.has("target_pubkey"), "pending_connection_requests missing target_pubkey").toBe(true);
    expect(colMap.has("payload"), "pending_connection_requests missing payload").toBe(true);
    expect(colMap.has("created_at"), "pending_connection_requests missing created_at").toBe(true);

    expect(colMap.get("id")).toBe("bigint");
    expect(colMap.get("target_pubkey")).toBe("text");
    expect(colMap.get("payload")).toBe("jsonb");
    expect(colMap.get("created_at")).toBe("timestamp with time zone");
  });

  it("AC-001: pending_connection_requests has index on target_pubkey", async () => {
    const result = await superPool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
       WHERE tablename = 'pending_connection_requests' AND schemaname = 'public'`,
    );
    const indexNames = result.rows.map((r) => r.indexname);
    expect(indexNames, "idx_pending_conn_req_target missing").toContain("idx_pending_conn_req_target");
  });

  it("AC-001: pending_connection_requests has RLS enabled with insert_only, select_all, delete_all policies", async () => {
    const rlsResult = await superPool.query<{ relrowsecurity: boolean }>(
      `SELECT c.relrowsecurity
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = 'pending_connection_requests'`,
    );
    expect(rlsResult.rows[0]?.relrowsecurity, "RLS not enabled on pending_connection_requests").toBe(true);

    // AC-001: policy-name verification issued as cello_service (SET ROLE ensures the query
    // is executed in the same privilege context that application code uses at runtime)
    const policyResult = await servicePool.query<{ polname: string }>(
      `SELECT polname
       FROM pg_catalog.pg_policy p
       JOIN pg_class c ON c.oid = p.polrelid
       WHERE c.relname = 'pending_connection_requests'`,
    );
    const policyNames = policyResult.rows.map((r) => r.polname);
    expect(policyNames, "insert_only policy missing").toContain("insert_only");
    expect(policyNames, "select_all policy missing").toContain("select_all");
    expect(policyNames, "delete_all policy missing").toContain("delete_all");
  });

  it("AC-001: cello_service has INSERT and SELECT on pending_connection_requests but NOT UPDATE", async () => {
    const result = await superPool.query<{ privilege_type: string }>(
      `SELECT privilege_type
       FROM information_schema.role_table_grants
       WHERE grantee = 'cello_service' AND table_name = 'pending_connection_requests'`,
    );
    const privileges = result.rows.map((r) => r.privilege_type);
    expect(privileges, "INSERT not granted").toContain("INSERT");
    expect(privileges, "SELECT not granted").toContain("SELECT");
    expect(privileges, "UPDATE must not be granted").not.toContain("UPDATE");
  });
});

// ─── AC-002: enqueueNotification → drainNotifications round-trip ─────────

describeIntegration("PERSIST-019 AC-002: enqueue + drain notification round-trip", () => {
  it("AC-002: drainNotifications returns queued notification, deletes the row, second drain returns []", async () => {
    const logger = makeMockLogger();
    const store = new PgDirectoryStore(superPool, logger);

    const pubkeyHex = randomBytes(32).toString("hex");
    const notification = makeConnectionEstablishedNotification();

    store.enqueueNotification(pubkeyHex, notification);

    // Wait for fire-and-forget INSERT to land in Postgres
    await waitForRow(superPool, "notification_queue", "pubkey_hex", pubkeyHex);

    const drained = await store.drainNotifications(pubkeyHex, randomUUID());
    expect(drained).toHaveLength(1);
    expect(drained[0]).toMatchObject({ type: "connection_established" });

    // Verify row is deleted
    const countResult = await superPool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM notification_queue WHERE pubkey_hex = $1`,
      [pubkeyHex],
    );
    expect(parseInt(countResult.rows[0]!.count, 10)).toBe(0);

    // Second drain returns empty
    const drained2 = await store.drainNotifications(pubkeyHex, randomUUID());
    expect(drained2).toHaveLength(0);
  });
});

// ─── AC-003: FIFO ordering + single-transaction drain ────────────────────────

describeIntegration("PERSIST-019 AC-003: FIFO ordering and transactional delete", () => {
  it("AC-003: three notifications returned in insertion order, all deleted in one transaction", async () => {
    const logger = makeMockLogger();
    const store = new PgDirectoryStore(superPool, logger);

    const pubkeyHex = randomBytes(32).toString("hex");
    const correlationId = randomUUID();

    // Insert three distinct notifications in guaranteed order using superPool
    // (enqueueNotification is fire-and-forget so concurrent calls may race;
    //  this test verifies FIFO drain ordering, not enqueue sequencing)
    const n1: DirectoryNotification = {
      type: "connection_established",
      counterparty_pubkey: randomBytes(32).toString("hex"),
      connection_id: "conn1",
    };
    const n2: DirectoryNotification = {
      type: "session_sealed",
      signature_type: "single",
      session_id: randomBytes(16),
      sealed_root: randomBytes(32),
      directory_signature: randomBytes(64),
      close_timestamp: Date.now(),
    };
    const n3: DirectoryNotification = {
      type: "seal_verified",
      session_id: randomBytes(16),
      sealed_root: randomBytes(32),
      leaf_count: 3,
      timestamp: Date.now(),
    };

    // Sequential INSERTs via superPool guarantee id ordering
    await superPool.query(
      `INSERT INTO notification_queue (pubkey_hex, payload) VALUES ($1, $2)`,
      [pubkeyHex, JSON.stringify(n1)],
    );
    await superPool.query(
      `INSERT INTO notification_queue (pubkey_hex, payload) VALUES ($1, $2)`,
      [pubkeyHex, JSON.stringify(n2)],
    );
    await superPool.query(
      `INSERT INTO notification_queue (pubkey_hex, payload) VALUES ($1, $2)`,
      [pubkeyHex, JSON.stringify(n3)],
    );

    const drained = await store.drainNotifications(pubkeyHex, correlationId);
    expect(drained).toHaveLength(3);
    expect(drained[0]).toMatchObject({ type: "connection_established" });
    expect(drained[1]).toMatchObject({ type: "session_sealed" });
    expect(drained[2]).toMatchObject({ type: "seal_verified" });

    // All rows deleted
    const countResult = await superPool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM notification_queue WHERE pubkey_hex = $1`,
      [pubkeyHex],
    );
    expect(parseInt(countResult.rows[0]!.count, 10)).toBe(0);
  });
});

// ─── CELLO-M6B-012 AC-001: session_sealed Uint8Array field integrity ────────

describeIntegration("CELLO-M6B-012 AC-001: session_sealed Uint8Array field integrity", () => {
  it("session_id, sealed_root, directory_signature survive enqueue→drain as Uint8Array", async () => {
    const logger = makeMockLogger();
    const store = new PgDirectoryStore(superPool, logger);

    const pubkeyHex = randomBytes(32).toString("hex");
    const correlationId = randomUUID();

    // Use new Uint8Array(randomBytes(N)) for field values.
    // enqueueNotification will use jsonStringify which produces __type:Uint8Array sentinels.
    const sessionId = new Uint8Array(randomBytes(16));
    const sealedRoot = new Uint8Array(randomBytes(32));
    const dirSig = new Uint8Array(randomBytes(64));

    const notification: DirectoryNotification = {
      type: "session_sealed",
      signature_type: "single",
      session_id: sessionId,
      sealed_root: sealedRoot,
      directory_signature: dirSig,
      close_timestamp: Date.now(),
    };

    // Use enqueueNotification (production path using jsonStringify with
    // __type:Uint8Array sentinel), NOT raw superPool.query + JSON.stringify.
    store.enqueueNotification(pubkeyHex, notification, correlationId);

    // Wait for the fire-and-forget insert to land in Postgres
    await waitForRow(superPool, "notification_queue", "pubkey_hex", pubkeyHex);

    const drained = await store.drainNotifications(pubkeyHex, correlationId);
    expect(drained).toHaveLength(1);
    const n = drained[0] as DirectoryNotification & {
      session_id: Uint8Array;
      sealed_root: Uint8Array;
      directory_signature: Uint8Array;
    };

    // Type integrity — must be Uint8Array, not Buffer or plain object
    expect(n.session_id).toBeInstanceOf(Uint8Array);
    expect(n.sealed_root).toBeInstanceOf(Uint8Array);
    expect(n.directory_signature).toBeInstanceOf(Uint8Array);

    // Value integrity — bytes must survive the round-trip unchanged
    expect(Buffer.from(n.session_id).toString("hex")).toBe(
      Buffer.from(sessionId).toString("hex"),
    );
    expect(Buffer.from(n.sealed_root).toString("hex")).toBe(
      Buffer.from(sealedRoot).toString("hex"),
    );
    expect(Buffer.from(n.directory_signature).toString("hex")).toBe(
      Buffer.from(dirSig).toString("hex"),
    );
  });
});

// ─── CELLO-M6B-012 AC-002: seal_verified Uint8Array field integrity ────────

describeIntegration("CELLO-M6B-012 AC-002: seal_verified Uint8Array field integrity", () => {
  it("session_id and sealed_root survive enqueue→drain as Uint8Array", async () => {
    const logger = makeMockLogger();
    const store = new PgDirectoryStore(superPool, logger);

    const pubkeyHex = randomBytes(32).toString("hex");
    const correlationId = randomUUID();

    // Use new Uint8Array(randomBytes(N)) for field values.
    const sessionId = new Uint8Array(randomBytes(16));
    const sealedRoot = new Uint8Array(randomBytes(32));

    const notification: DirectoryNotification = {
      type: "seal_verified",
      session_id: sessionId,
      sealed_root: sealedRoot,
      leaf_count: 42,
      timestamp: Date.now(),
    };

    // Use enqueueNotification (production path)
    store.enqueueNotification(pubkeyHex, notification, correlationId);

    // Wait for the fire-and-forget insert to land in Postgres
    await waitForRow(superPool, "notification_queue", "pubkey_hex", pubkeyHex);

    const drained = await store.drainNotifications(pubkeyHex, correlationId);
    expect(drained).toHaveLength(1);
    const n = drained[0] as DirectoryNotification & {
      session_id: Uint8Array;
      sealed_root: Uint8Array;
    };

    // Type integrity — must be Uint8Array, not Buffer or plain object
    expect(n.session_id).toBeInstanceOf(Uint8Array);
    expect(n.sealed_root).toBeInstanceOf(Uint8Array);

    // Value integrity — bytes must survive the round-trip unchanged
    expect(Buffer.from(n.session_id).toString("hex")).toBe(
      Buffer.from(sessionId).toString("hex"),
    );
    expect(Buffer.from(n.sealed_root).toString("hex")).toBe(
      Buffer.from(sealedRoot).toString("hex"),
    );
  });
});

// ─── AC-004: queuePendingConnectionRequest → dequeuePendingConnectionRequests ─

describeIntegration("PERSIST-019 AC-004: queue + dequeue pending connection request", () => {
  it("AC-004: dequeue returns queued request, deletes row, logs drained event", async () => {
    const logger = makeMockLogger();
    const store = new PgDirectoryStore(superPool, logger);

    const targetPubkey = randomBytes(32).toString("hex");
    const request = makePendingConnectionRequest();
    const correlationId = randomUUID();

    store.queuePendingConnectionRequest(targetPubkey, request);

    // Wait for fire-and-forget INSERT to land in Postgres
    await waitForRow(superPool, "pending_connection_requests", "target_pubkey", targetPubkey);

    const dequeued = await store.dequeuePendingConnectionRequests(targetPubkey, correlationId);
    expect(dequeued).toHaveLength(1);
    expect(dequeued[0]!.connection_request_id).toBe(request.connection_request_id);

    // Verify row deleted
    const countResult = await superPool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM pending_connection_requests WHERE target_pubkey = $1`,
      [targetPubkey],
    );
    expect(parseInt(countResult.rows[0]!.count, 10)).toBe(0);

    // Second dequeue returns empty
    const dequeued2 = await store.dequeuePendingConnectionRequests(targetPubkey, correlationId);
    expect(dequeued2).toHaveLength(0);

    // Verify queue.pending_connection_requests.drained logged with required fields
    const drainedEvent = logger.infoEvents.find(
      (e) => e.event === "queue.pending_connection_requests.drained",
    );
    expect(drainedEvent, "queue.pending_connection_requests.drained not logged").toBeDefined();
    expect(drainedEvent!.context).toMatchObject({
      targetPubkey,
      count: 1,
      correlationId,
    });
  });
});

// ─── AC-005: Expired rows not returned by dequeue ────────────────────────────

describeIntegration("PERSIST-019 AC-005: expired pending requests not returned by dequeue", () => {
  it("AC-005: stale row (>24h) not returned; fresh row IS returned; stale row persists after dequeue", async () => {
    const targetPubkey = randomBytes(32).toString("hex");

    // Insert a backdated row (>24 hours old) directly via superuser
    const staleRequest = makePendingConnectionRequest();
    await superPool.query(
      `INSERT INTO pending_connection_requests (target_pubkey, payload, created_at)
       VALUES ($1, $2::jsonb, now() - INTERVAL '25 hours')`,
      [targetPubkey, JSON.stringify(staleRequest)],
    );

    // Insert a fresh row
    const freshRequest = makePendingConnectionRequest();
    await superPool.query(
      `INSERT INTO pending_connection_requests (target_pubkey, payload, created_at)
       VALUES ($1, $2::jsonb, now())`,
      [targetPubkey, JSON.stringify(freshRequest)],
    );

    // Verify 2 rows before call
    const countBefore = await superPool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM pending_connection_requests WHERE target_pubkey = $1`,
      [targetPubkey],
    );
    expect(parseInt(countBefore.rows[0]!.count, 10)).toBe(2);

    const logger = makeMockLogger();
    const store = new PgDirectoryStore(superPool, logger);
    const dequeued = await store.dequeuePendingConnectionRequests(targetPubkey, randomUUID());

    // Only the fresh request is returned
    expect(dequeued).toHaveLength(1);
    expect(dequeued[0]!.connection_request_id).toBe(freshRequest.connection_request_id);

    // Stale row still in DB — dequeue does NOT delete it (only TTL sweep does)
    const countAfter = await superPool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM pending_connection_requests WHERE target_pubkey = $1`,
      [targetPubkey],
    );
    expect(parseInt(countAfter.rows[0]!.count, 10)).toBe(1);
  });
});

// ─── AC-006: TTL sweep deletes expired rows ───────────────────────────────────

describeIntegration("PERSIST-019 AC-006: TTL sweep purges rows older than 24h", () => {
  it("AC-006: TTL sweep deletes expired rows, fresh rows kept, logs expired event with purgedCount=3", async () => {
    const targetA = randomBytes(32).toString("hex");
    const targetB = randomBytes(32).toString("hex");

    // Insert 3 stale rows (>24h)
    for (let i = 0; i < 3; i++) {
      const req = makePendingConnectionRequest();
      await superPool.query(
        `INSERT INTO pending_connection_requests (target_pubkey, payload, created_at)
         VALUES ($1, $2::jsonb, now() - INTERVAL '25 hours')`,
        [targetA, JSON.stringify(req)],
      );
    }

    // Insert 2 fresh rows
    for (let i = 0; i < 2; i++) {
      const req = makePendingConnectionRequest();
      await superPool.query(
        `INSERT INTO pending_connection_requests (target_pubkey, payload, created_at)
         VALUES ($1, $2::jsonb, now())`,
        [targetB, JSON.stringify(req)],
      );
    }

    const logger = makeMockLogger();
    const sweep = new PendingConnectionRequestTtlSweep(superPool, logger);
    const purgedCount = await sweep.run();

    expect(purgedCount).toBe(3);

    // Verify stale rows gone
    const staleCount = await superPool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM pending_connection_requests WHERE target_pubkey = $1`,
      [targetA],
    );
    expect(parseInt(staleCount.rows[0]!.count, 10)).toBe(0);

    // Verify fresh rows remain
    const freshCount = await superPool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM pending_connection_requests WHERE target_pubkey = $1`,
      [targetB],
    );
    expect(parseInt(freshCount.rows[0]!.count, 10)).toBe(2);

    // Verify queue.pending_connection_requests.expired logged with purgedCount
    const expiredEvent = logger.infoEvents.find(
      (e) => e.event === "queue.pending_connection_requests.expired",
    );
    expect(expiredEvent, "queue.pending_connection_requests.expired not logged").toBeDefined();
    expect(expiredEvent!.context).toMatchObject({ purgedCount: 3 });
  });
});

// ─── AC-007: cello_service cannot UPDATE notification_queue ──────────────────

describeIntegration("PERSIST-019 AC-007: UPDATE notification_queue is denied for cello_service", () => {
  it("AC-007: cello_service UPDATE notification_queue raises permission denied from RLS policy", async () => {
    // Insert a row as superuser
    const pubkeyHex = randomBytes(32).toString("hex");
    await superPool.query(
      `INSERT INTO notification_queue (pubkey_hex, payload) VALUES ($1, $2::jsonb)`,
      [pubkeyHex, JSON.stringify({ type: "connection_established", counterparty_pubkey: "x", connection_id: "y" })],
    );

    // Attempt UPDATE as cello_service — must be rejected with permission denied
    await expect(
      servicePool.query(
        `UPDATE notification_queue SET payload = '{"type":"hacked"}'::jsonb WHERE pubkey_hex = $1`,
        [pubkeyHex],
      ),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/permission denied/i),
    });

    // Row remains unchanged
    const countResult = await superPool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM notification_queue WHERE pubkey_hex = $1`,
      [pubkeyHex],
    );
    expect(parseInt(countResult.rows[0]!.count, 10)).toBe(1);
  });

  it("AC-007: cello_service UPDATE pending_connection_requests raises permission denied", async () => {
    // Insert a row as superuser
    const targetPubkey = randomBytes(32).toString("hex");
    const req = makePendingConnectionRequest();
    await superPool.query(
      `INSERT INTO pending_connection_requests (target_pubkey, payload) VALUES ($1, $2::jsonb)`,
      [targetPubkey, JSON.stringify(req)],
    );

    // Attempt UPDATE as cello_service — must be rejected with permission denied
    await expect(
      servicePool.query(
        `UPDATE pending_connection_requests SET payload = '{"type":"hacked"}'::jsonb WHERE target_pubkey = $1`,
        [targetPubkey],
      ),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/permission denied/i),
    });

    // Row remains unchanged
    const countResult = await superPool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM pending_connection_requests WHERE target_pubkey = $1`,
      [targetPubkey],
    );
    expect(parseInt(countResult.rows[0]!.count, 10)).toBe(1);
  });
});

// ─── AC-008: notification.queued logged on successful enqueue ─────────────────

describeIntegration("PERSIST-019 AC-008: notification.queued logged on INSERT", () => {
  it("AC-008: enqueueNotification logs notification.queued with { pubkeyHex, notificationType, correlationId }", async () => {
    const logger = makeMockLogger();
    const store = new PgDirectoryStore(superPool, logger);

    const pubkeyHex = randomBytes(32).toString("hex");
    const notification = makeConnectionEstablishedNotification();
    const correlationId = randomUUID();

    store.enqueueNotification(pubkeyHex, notification, correlationId);

    // Wait for fire-and-forget INSERT to land in Postgres (log happens in .then())
    await waitForRow(superPool, "notification_queue", "pubkey_hex", pubkeyHex);

    const queuedEvent = logger.infoEvents.find((e) => e.event === "notification.queued");
    expect(queuedEvent, "notification.queued was not logged").toBeDefined();
    expect(queuedEvent!.context).toMatchObject({
      pubkeyHex,
      notificationType: notification.type,
      correlationId,
    });
  });
});

// ─── AC-009: notification.drained logged on successful drain ─────────────────

describeIntegration("PERSIST-019 AC-009: notification.drained logged on drain", () => {
  it("AC-009: drainNotifications logs notification.drained with { pubkeyHex, count, correlationId }", async () => {
    const logger = makeMockLogger();
    const store = new PgDirectoryStore(superPool, logger);

    const pubkeyHex = randomBytes(32).toString("hex");
    const notification = makeConnectionEstablishedNotification();
    const correlationId = randomUUID();

    store.enqueueNotification(pubkeyHex, notification);
    await waitForRow(superPool, "notification_queue", "pubkey_hex", pubkeyHex);

    await store.drainNotifications(pubkeyHex, correlationId);

    const drainedEvent = logger.infoEvents.find((e) => e.event === "notification.drained");
    expect(drainedEvent, "notification.drained was not logged").toBeDefined();
    expect(drainedEvent!.context).toMatchObject({
      pubkeyHex,
      count: 1,
      correlationId,
    });
  });
});

// ─── SI-001: Concurrent drain — exactly one caller receives the notification ──

describeIntegration("PERSIST-019 SI-001: concurrent drain — no double delivery", () => {
  it("SI-001: two concurrent drainNotifications calls — exactly one gets the notification", async () => {
    const logger = makeMockLogger();
    const store = new PgDirectoryStore(superPool, logger);

    const pubkeyHex = randomBytes(32).toString("hex");
    const notification = makeConnectionEstablishedNotification();

    store.enqueueNotification(pubkeyHex, notification);
    await waitForRow(superPool, "notification_queue", "pubkey_hex", pubkeyHex);

    // Launch two concurrent drains — SI-001: transaction-level atomicity prevents double delivery
    const correlationId = randomUUID();
    const [result1, result2] = await Promise.all([
      store.drainNotifications(pubkeyHex, correlationId),
      store.drainNotifications(pubkeyHex, correlationId),
    ]);

    // Exactly one caller receives the notification; the other receives []
    const totalReceived = result1.length + result2.length;
    expect(totalReceived).toBe(1);

    // notification_queue must be empty
    const countResult = await superPool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM notification_queue WHERE pubkey_hex = $1`,
      [pubkeyHex],
    );
    expect(parseInt(countResult.rows[0]!.count, 10)).toBe(0);
  });
});

// ─── SI-001 (pending_connection_requests): concurrent dequeue — no double delivery ──

describeIntegration("PERSIST-019 SI-001: concurrent dequeuePendingConnectionRequests — no double delivery", () => {
  it("SI-001: two concurrent dequeuePendingConnectionRequests calls — exactly one gets the request", async () => {
    const logger = makeMockLogger();
    const store = new PgDirectoryStore(superPool, logger);

    const targetPubkey = randomBytes(32).toString("hex");
    const request = makePendingConnectionRequest();

    // Insert one row directly via superPool (avoids fire-and-forget race)
    await superPool.query(
      `INSERT INTO pending_connection_requests (target_pubkey, payload) VALUES ($1, $2::jsonb)`,
      [targetPubkey, JSON.stringify(request)],
    );

    // Launch two concurrent dequeues — SI-001: atomic CTE prevents double delivery
    const correlationId = randomUUID();
    const [result1, result2] = await Promise.all([
      store.dequeuePendingConnectionRequests(targetPubkey, correlationId),
      store.dequeuePendingConnectionRequests(targetPubkey, correlationId),
    ]);

    // Exactly one caller receives the request; the other receives []
    const totalReceived = result1.length + result2.length;
    expect(totalReceived).toBe(1);

    // pending_connection_requests must be empty after both calls
    const countResult = await superPool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM pending_connection_requests WHERE target_pubkey = $1`,
      [targetPubkey],
    );
    expect(parseInt(countResult.rows[0]!.count, 10)).toBe(0);
  });
});

// ─── SI-003: RLS SELECT policy filters by app.current_pubkey ─────────────────

describeIntegration("PERSIST-019 SI-003: RLS prevents cross-agent notification access", () => {
  it("SI-003: SELECT without WHERE clause returns 0 rows for a different agent's notifications", async () => {
    // Insert a row for agentB using superuser pool (bypasses RLS)
    const agentBPubkey = randomBytes(32).toString("hex");
    await superPool.query(
      `INSERT INTO notification_queue (pubkey_hex, payload) VALUES ($1, $2::jsonb)`,
      [
        agentBPubkey,
        JSON.stringify({ type: "connection_established", counterparty_pubkey: "x", connection_id: "y" }),
      ],
    );

    const agentAPubkey = randomBytes(32).toString("hex");

    // Connect as cello_service and set app.current_pubkey = agentA (different agent)
    const client = await servicePool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SELECT set_config('app.current_pubkey', $1, true)`, [agentAPubkey]);

      // SELECT without any application-layer WHERE clause — RLS policy enforces the filter
      const result = await client.query<{ id: number }>(
        `SELECT id FROM notification_queue`,
      );

      // SI-003: RLS SELECT policy uses current_setting('app.current_pubkey', true)
      // agentA has no rows → 0 rows returned even though agentB's row exists in the table
      expect(result.rows).toHaveLength(0);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });
});
