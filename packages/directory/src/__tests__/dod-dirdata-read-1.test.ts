/**
 * DOD-DIRDATA-READ-1 — track-record aggregate route.
 *
 * Verifies GET /internal/track-record/:agentPubkeyHex returns correct session count and
 * clean-close rate computed from seal_notarizations + conversation_seals (both replicated).
 *
 * Gated on CELLO_ENV=local (Docker Postgres).
 *
 * ─── THIS FILE HAD NOT RUN SINCE V31 (`DOD-M15-DIRECTORY-ROT-1`) ───────────────────────────────
 *
 * Its setup used `ON CONFLICT (session_id)`. `V31__seal_notarization_superseding.sql` DROPPED that
 * constraint — a bilateral seal must be able to supersede a unilateral one — and replaced it with
 * `UNIQUE (session_id, seal_type)`. So every run since threw *"there is no unique or exclusion
 * constraint matching the ON CONFLICT specification"* out of `beforeAll`.
 *
 * **And that was invisible under the documented command.** The suite is gated on `CELLO_ENV=local`;
 * without it vitest prints eight ↓ skipped lines and a green file. With it, the throw lands in
 * `beforeAll`, so the eight tests are *still* reported as skipped — the failure is one line in a
 * 22,000-line run. Either way the track-record route, which the portal reads to show an agent's
 * clean-close rate, had **zero** executed coverage for the whole of M7 onward.
 *
 * ─── The two habits that made it a poisoner as well as a corpse ────────────────────────────────
 *
 * It wrote literal `chain_hash` strings into two chained tables and then DELETEd them in `afterAll`
 * through a superuser pool. Entry 20 proved what that does: `verifyChain` chains each row to the
 * PREVIOUS row's stored hash, so a delete invalidates every row after it, for the whole run, in
 * files that never touch seals. The rows now live inside a transaction that is always rolled back,
 * which is why there is no cleanup below — and no way to forget it.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg, { Pool } from "pg";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createInternalApiServer } from "../internal-api-server.js";
import { txnPool } from "./helpers/txn-pool.js";
import type { Logger } from "@cello-protocol/interfaces";

const describeIntegration = process.env.CELLO_ENV === "local" ? describe : describe.skip;
const noopLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };

interface TrackRecordResponse {
  session_count: number;
  clean_close_count: number;
  clean_close_rate: number | null;
  last_sealed_at: number | null;
  error?: string;
}

describeIntegration("DOD-DIRDATA-READ-1 — GET /internal/track-record/:agentPubkey", () => {
  let pool: Pool;
  let client: pg.PoolClient;
  let server: Server;
  let base: string;
  const API_KEY = "test-track-record-key";

  // Test agent: 32 random bytes → 64 hex chars
  const agentPubkey = randomBytes(32);
  const agentPubkeyHex = agentPubkey.toString("hex");
  const counterpartyPubkey = randomBytes(32);

  // We'll insert 3 seal_notarizations for this agent, with 2 corresponding conversation_seals
  // (one MUTUAL_SEAL, one EXPIRE) and one notarization with no conversation_seals row.
  const sessionIds = [randomBytes(16), randomBytes(16), randomBytes(16)];

  function sessionIdToUuid(sid: Buffer): string {
    const h = sid.toString("hex").padStart(32, "0").slice(0, 32);
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
  }

  /**
   * The transaction-bound pool. Both the fixture rows AND the server under test go through it, so
   * every query in this file lands on ONE connection inside ONE transaction. Handing the server a
   * different pool would mean it queried a connection that cannot see any of the rows below.
   */
  let txn: Pool;

  beforeAll(async () => {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL || "postgresql://postgres:dev@localhost:5433/cello_dev",
    });
    client = await pool.connect();
    await client.query("BEGIN");
    txn = txnPool(client);

    // Insert seal_notarizations rows for the test agent
    for (let i = 0; i < sessionIds.length; i++) {
      const sid = sessionIds[i];
      await txn.query(
        `INSERT INTO seal_notarizations
           (session_id, sealed_root, participant_a_pubkey, participant_b_pubkey,
            close_timestamp, frost_signature, chain_hash, seal_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'bilateral')
         ON CONFLICT (session_id, seal_type) DO NOTHING`,
        [
          sid,
          randomBytes(32),
          i % 2 === 0 ? agentPubkey : counterpartyPubkey, // alternate positions
          i % 2 === 0 ? counterpartyPubkey : agentPubkey,
          1700000000 + i * 1000,
          randomBytes(64),
          `test-chain-hash-dirdata-${i}-${agentPubkeyHex.slice(0, 8)}`,
        ],
      );
    }

    // Insert conversation_seals for 2 of the 3 sessions
    await txn.query(
      `INSERT INTO conversation_seals
         (conversation_id, merkle_root, close_type, participant_count, seal_date, chain_hash)
       VALUES ($1, $2, 'MUTUAL_SEAL', 2, '2026-01-01', $3)
       ON CONFLICT (conversation_id) DO NOTHING`,
      [
        sessionIdToUuid(sessionIds[0]),
        "abcd1234",
        `test-cs-chain-dirdata-0-${agentPubkeyHex.slice(0, 8)}`,
      ],
    );
    await txn.query(
      `INSERT INTO conversation_seals
         (conversation_id, merkle_root, close_type, participant_count, seal_date, chain_hash)
       VALUES ($1, $2, 'EXPIRE', 2, '2026-01-02', $3)
       ON CONFLICT (conversation_id) DO NOTHING`,
      [
        sessionIdToUuid(sessionIds[1]),
        "abcd5678",
        `test-cs-chain-dirdata-1-${agentPubkeyHex.slice(0, 8)}`,
      ],
    );
    // sessionIds[2] has no conversation_seals row (simulates seal without analytics record)

    server = createInternalApiServer({
      pool: txn,
      internalApiKey: API_KEY,
      logger: noopLogger,
      owningNodeId: "dirdata-test-node",
    });
    await new Promise<void>((r) => server.listen(0, () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    if (server) await new Promise<void>((r) => server.close(() => r()));
    // ROLLBACK is the cleanup. The DELETEs that used to stand here are the exact mechanism Entry 20
    // proved breaks `verifyChain` for every file that runs afterwards — and they needed a superuser
    // privilege the directory itself does not hold (V22 grants cello_service INSERT and SELECT).
    if (client) {
      await client.query("ROLLBACK").catch(() => { /* the connection is going back regardless */ });
      client.release();
    }
    await pool.end();
  });

  it("returns 401 without API key", async () => {
    const res = await fetch(`${base}/internal/track-record/${agentPubkeyHex}`);
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid pubkey (too short)", async () => {
    const res = await fetch(`${base}/internal/track-record/abcdef`, {
      headers: { "x-cello-internal-api-key": API_KEY },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as TrackRecordResponse;
    expect(body.error).toMatch(/invalid agent pubkey/);
  });

  it("returns 400 for invalid pubkey (non-hex characters)", async () => {
    const badHex = "z".repeat(64);
    const res = await fetch(`${base}/internal/track-record/${badHex}`, {
      headers: { "x-cello-internal-api-key": API_KEY },
    });
    expect(res.status).toBe(400);
  });

  it("returns zero counts for unknown agent", async () => {
    const unknownPubkey = randomBytes(32).toString("hex");
    const res = await fetch(`${base}/internal/track-record/${unknownPubkey}`, {
      headers: { "x-cello-internal-api-key": API_KEY },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as TrackRecordResponse;
    expect(body.session_count).toBe(0);
    expect(body.clean_close_count).toBe(0);
    expect(body.clean_close_rate).toBeNull();
    expect(body.last_sealed_at).toBeNull();
  });

  it("returns correct session_count (counts both participant_a and participant_b positions)", async () => {
    const res = await fetch(`${base}/internal/track-record/${agentPubkeyHex}`, {
      headers: { "x-cello-internal-api-key": API_KEY },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as TrackRecordResponse;
    // 3 seal_notarizations rows where this agent is either participant_a or participant_b
    expect(body.session_count).toBe(3);
  });

  it("returns correct clean_close_count and rate (only MUTUAL_SEAL from joined conversation_seals)", async () => {
    const res = await fetch(`${base}/internal/track-record/${agentPubkeyHex}`, {
      headers: { "x-cello-internal-api-key": API_KEY },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as TrackRecordResponse;
    // 1 MUTUAL_SEAL out of 3 sessions → clean_close_count = 1, rate = 1/3
    expect(body.clean_close_count).toBe(1);
    expect(body.clean_close_rate).toBeCloseTo(1 / 3, 5);
  });

  it("returns last_sealed_at as the max close_timestamp", async () => {
    const res = await fetch(`${base}/internal/track-record/${agentPubkeyHex}`, {
      headers: { "x-cello-internal-api-key": API_KEY },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as TrackRecordResponse;
    // max of 1700000000, 1700001000, 1700002000
    expect(body.last_sealed_at).toBe(1700002000);
  });

  it("accepts uppercase hex in pubkey", async () => {
    const res = await fetch(`${base}/internal/track-record/${agentPubkeyHex.toUpperCase()}`, {
      headers: { "x-cello-internal-api-key": API_KEY },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as TrackRecordResponse;
    expect(body.session_count).toBe(3);
  });
});
