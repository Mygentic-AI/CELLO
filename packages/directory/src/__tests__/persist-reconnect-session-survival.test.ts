/**
 * Session survival tests — reconnect paths introduced during 2026-05-19 live session bring-up.
 *
 * These tests cover the four code changes that were made to fix live-session failures
 * but had no automated test coverage:
 *
 * TEST-RECONNECT-001: recordAcceptedConnectionRequest()
 *   The PgDirectoryStore.createConnection() SI-001 guard requires a matching ACCEPTED row
 *   in connection_requests before it will INSERT a connections row. This test verifies:
 *   - recordAcceptedConnectionRequest() inserts with outcome='ACCEPTED'
 *   - createConnection() succeeds after recordAcceptedConnectionRequest() is called
 *   - createConnection() throws SI-001 when recordAcceptedConnectionRequest() was NOT called
 *
 * TEST-RECONNECT-004: encodeConnectionRequestError wire encoding
 *   The encoder must include connection_id when reason is already_connected.
 *   Unit test: encode → decode → assert connection_id is present/absent per reason.
 *
 * Tests for RECONNECT-002 (already_registered with profile data) and RECONNECT-003
 * (already_connected with connection_id) require real libp2p nodes and are in:
 *   persist-reconnect-protocol.test.ts
 *
 * All integration tests require CELLO_ENV=local + running Docker Compose Postgres.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import { randomBytes } from "node:crypto";
import { decode } from "cbor-x";
import { PgDirectoryStore } from "../adapters/pg-directory-store.js";
import { encodeConnectionRequestError } from "../directory-frames.js";
import { configurePgTypes } from "../pg-type-config.js";
import type { Logger } from "@cello/interfaces";

// ─── Environment ──────────────────────────────────────────────────────────────

const isLocal = process.env["CELLO_ENV"] === "local";
const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgresql://postgres:dev@localhost:5433/cello_dev";
const SERVICE_URL = DATABASE_URL.replace(
  /^(postgres(?:ql)?):\/\/[^:]+:[^@]+@/,
  "$1://cello_service:cello_service_dev@",
);

function makeHexId(): string {
  return Buffer.from(randomBytes(16)).toString("hex");
}

function makeLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

let superPool: pg.Pool;
let servicePool: pg.Pool;

beforeAll(async () => {
  if (!isLocal) return;
  configurePgTypes();
  superPool = new pg.Pool({ connectionString: DATABASE_URL });
  servicePool = new pg.Pool({ connectionString: SERVICE_URL });
  try {
    await superPool.query("SELECT 1");
  } catch (err) {
    throw new Error(
      `[RECONNECT] CELLO_ENV=local but Postgres unreachable: ${String(err)}`,
    );
  }
});

afterAll(async () => {
  if (!isLocal) return;
  await superPool?.end();
  await servicePool?.end();
});

const describeIntegration = isLocal ? describe : describe.skip;

// ─── TEST-RECONNECT-001: recordAcceptedConnectionRequest ──────────────────────

describeIntegration("TEST-RECONNECT-001: recordAcceptedConnectionRequest()", () => {
  it("inserts an ACCEPTED row into connection_requests with correct fields", async () => {
    const requestId = makeHexId();
    const requesterPseudonym = `req_${requestId.slice(0, 8)}`;
    const targetPseudonym = `tgt_${requestId.slice(0, 8)}`;
    const store = new PgDirectoryStore(servicePool, makeLogger());

    await store.recordAcceptedConnectionRequest(requestId, requesterPseudonym, targetPseudonym);

    const result = await superPool.query(
      `SELECT request_id, requester_pseudonym, target_pseudonym, outcome
       FROM connection_requests WHERE request_id = $1`,
      [requestId],
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!["request_id"]).toBe(requestId);
    expect(result.rows[0]!["outcome"]).toBe("ACCEPTED");
    expect(result.rows[0]!["requester_pseudonym"]).toBe(requesterPseudonym);
    expect(result.rows[0]!["target_pseudonym"]).toBe(targetPseudonym);

    await superPool.query("DELETE FROM connection_requests WHERE request_id = $1", [requestId]);
  });

  it("createConnection() succeeds when recordAcceptedConnectionRequest() was called first", async () => {
    const requestId = makeHexId();
    const connectionId = makeHexId();
    const participantA = makeHexId();
    const participantB = makeHexId();
    const store = new PgDirectoryStore(servicePool, makeLogger());

    // This mirrors the exact sequence in directory-node.ts:
    await store.recordAcceptedConnectionRequest(requestId, participantA, participantB);
    await store.createConnection(connectionId, participantA, participantB, Date.now(), requestId);

    const conn = await store.hasConnection(participantA, participantB);
    expect(conn).not.toBeNull();
    expect(conn!.connection_id).toBe(connectionId);

    await superPool.query("DELETE FROM connections WHERE connection_id = $1", [connectionId]);
    await superPool.query("DELETE FROM connection_requests WHERE request_id = $1", [requestId]);
  });

  it("createConnection() throws SI-001 when recordAcceptedConnectionRequest() was NOT called", async () => {
    const connectionId = makeHexId();
    const arbitraryCorrelationId = makeHexId(); // never inserted
    const participantA = makeHexId();
    const participantB = makeHexId();
    const store = new PgDirectoryStore(servicePool, makeLogger());

    await expect(
      store.createConnection(connectionId, participantA, participantB, Date.now(), arbitraryCorrelationId),
    ).rejects.toThrow("SI-001");

    const conn = await store.hasConnection(participantA, participantB);
    expect(conn).toBeNull();
  });
});

// ─── TEST-RECONNECT-004: encodeConnectionRequestError wire encoding ───────────

describe("TEST-RECONNECT-004: encodeConnectionRequestError wire encoding", () => {
  it("encodes connection_id when reason is already_connected", () => {
    const connectionId = makeHexId();
    const encoded = encodeConnectionRequestError({
      type: "connection_request_error",
      reason: "already_connected",
      connection_id: connectionId,
    });
    const decoded = decode(Buffer.from(encoded)) as Record<string, unknown>;
    expect(decoded["type"]).toBe("connection_request_error");
    expect(decoded["reason"]).toBe("already_connected");
    expect(decoded["connection_id"]).toBe(connectionId);
  });

  it("does not include connection_id when reason is target_not_found", () => {
    const encoded = encodeConnectionRequestError({
      type: "connection_request_error",
      reason: "target_not_found",
    });
    const decoded = decode(Buffer.from(encoded)) as Record<string, unknown>;
    expect(decoded["type"]).toBe("connection_request_error");
    expect(decoded["reason"]).toBe("target_not_found");
    expect(decoded["connection_id"]).toBeUndefined();
  });

  it("does not include connection_id for not_registered or target_unavailable", () => {
    for (const reason of ["not_registered", "target_unavailable"] as const) {
      const encoded = encodeConnectionRequestError({ type: "connection_request_error", reason });
      const decoded = decode(Buffer.from(encoded)) as Record<string, unknown>;
      expect(decoded["connection_id"]).toBeUndefined();
    }
  });
});
