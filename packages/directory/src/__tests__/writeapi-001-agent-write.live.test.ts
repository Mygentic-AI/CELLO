// WRITEAPI-001 LIVE — POST /internal/agent-write against the REAL directory Postgres (docker, :5433).
//
// Proves what the stub-pool contract test cannot: that the seam PERSISTS to the real V34 schema and
// that the SI-001 directory dump holds — after attempting to smuggle a raw email and an OAuth token,
// NEITHER appears anywhere in the three write-seam tables. Gated to CELLO_ENV=local.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createInternalApiServer } from "../internal-api-server.js";

const DB_URL = process.env.DATABASE_URL ?? "postgresql://postgres:dev@localhost:5433/cello_dev";
const API_KEY = "test-writeapi-live-key";

const ACCOUNT_A = "00000000-0000-0000-0000-00000000aaa1";
const ACCOUNT_B = "00000000-0000-0000-0000-00000000bbb2";
const AGENT_A = "writeapi-live-agent-A";
const AGENT_B = "writeapi-live-agent-B";
const KP_A = "11".repeat(32);
const KP_B = "22".repeat(32);
const PP_A = "33".repeat(32);
const PP_B = "44".repeat(32);

const RAW_EMAIL = "victim-operator@example.com";
const RAW_TOKEN = "ya29.A0ARrdaM-super-secret-oauth-token-value";

const noopLogger = { info() {}, warn() {}, error() {} };
const describeLive = process.env.CELLO_ENV === "local" ? describe : describe.skip;

describeLive("WRITEAPI-001 live — /internal/agent-write (real Postgres + HTTP)", () => {
  let pool: pg.Pool;
  let server: Server;
  let base: string;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DB_URL });
    // Clean slate for our fixtures.
    await pool.query(`DELETE FROM agent_suspensions WHERE agent_id = ANY($1)`, [[AGENT_A, AGENT_B]]);
    await pool.query(`DELETE FROM identity_tree_entries WHERE agent_id = ANY($1)`, [[AGENT_A, AGENT_B]]);
    await pool.query(`DELETE FROM pickup_queue WHERE agent_id = ANY($1)`, [[AGENT_A, AGENT_B]]);
    await pool.query(`DELETE FROM agent_profiles WHERE agent_id = ANY($1)`, [[AGENT_A, AGENT_B]]);
    await pool.query(`DELETE FROM user_accounts WHERE account_id = ANY($1)`, [[ACCOUNT_A, ACCOUNT_B]]);

    for (const [acct, email] of [
      [ACCOUNT_A, "writeapi-a@example.com"],
      [ACCOUNT_B, "writeapi-b@example.com"],
    ] as const) {
      await pool.query(
        `INSERT INTO user_accounts (account_id, phone_stub_hash, email_stub_hash, chain_hash)
         VALUES ($1, $2, $3, $4)`,
        [
          acct,
          createHash("sha256").update(acct + "-phone").digest("hex"),
          createHash("sha256").update(email).digest("hex"),
          "writeapi-seed-chain",
        ],
      );
    }
    // Two agents — AGENT_A owned by ACCOUNT_A, AGENT_B owned by ACCOUNT_B.
    for (const [agentId, kp, pp, acct] of [
      [AGENT_A, KP_A, PP_A, ACCOUNT_A],
      [AGENT_B, KP_B, PP_B, ACCOUNT_B],
    ] as const) {
      await pool.query(
        `INSERT INTO agent_profiles
           (k_local_pubkey, primary_pubkey, registered_at, status, chain_hash, account_id, agent_id)
         VALUES ($1, $2, $3, 'active', $4, $5, $6)`,
        [kp, pp, Date.now(), "writeapi-seed-chain", acct, agentId],
      );
    }

    server = createInternalApiServer({ pool, internalApiKey: API_KEY, logger: noopLogger });
    await new Promise<void>((r) => server.listen(0, () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    if (server) await new Promise<void>((r) => server.close(() => r()));
    await pool.query(`DELETE FROM agent_suspensions WHERE agent_id = ANY($1)`, [[AGENT_A, AGENT_B]]).catch(() => {});
    await pool.query(`DELETE FROM identity_tree_entries WHERE agent_id = ANY($1)`, [[AGENT_A, AGENT_B]]).catch(() => {});
    await pool.query(`DELETE FROM pickup_queue WHERE agent_id = ANY($1)`, [[AGENT_A, AGENT_B]]).catch(() => {});
    await pool.query(`DELETE FROM agent_profiles WHERE agent_id = ANY($1)`, [[AGENT_A, AGENT_B]]).catch(() => {});
    await pool.query(`DELETE FROM user_accounts WHERE account_id = ANY($1)`, [[ACCOUNT_A, ACCOUNT_B]]).catch(() => {});
    await pool.end();
  });

  function write(body: unknown, key = API_KEY) {
    return fetch(`${base}/internal/agent-write`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-cello-internal-api-key": key },
      body: JSON.stringify(body),
    });
  }

  it("AC-001: A pauses its OWN agent → persisted (paused=true), then clears it → paused=false", async () => {
    const paused = await write({ accountId: ACCOUNT_A, agentId: AGENT_A, writeKind: "revocation_flag", payload: { mode: "pause" } });
    expect(paused.status).toBe(200);
    let row = await pool.query(`SELECT paused, authorized_by_account FROM agent_suspensions WHERE agent_id = $1`, [AGENT_A]);
    expect(row.rows[0].paused).toBe(true);
    expect(row.rows[0].authorized_by_account).toBe(ACCOUNT_A);

    const cleared = await write({ accountId: ACCOUNT_A, agentId: AGENT_A, writeKind: "revocation_flag", payload: { mode: "clear" } });
    expect(cleared.status).toBe(200);
    row = await pool.query(`SELECT paused FROM agent_suspensions WHERE agent_id = $1`, [AGENT_A]);
    expect(row.rows[0].paused).toBe(false);
  });

  it("AC-001 / SI-001: A may NOT write B's agent → 403, nothing persisted for B", async () => {
    const res = await write({ accountId: ACCOUNT_A, agentId: AGENT_B, writeKind: "revocation_flag", payload: { mode: "pause" } });
    expect(res.status).toBe(403);
    const row = await pool.query(`SELECT 1 FROM agent_suspensions WHERE agent_id = $1`, [AGENT_B]);
    expect(row.rowCount).toBe(0);
  });

  it("AC-002: a hash lands in the identity tree; sealed ciphertext lands in the pickup queue", async () => {
    const hash = createHash("sha256").update("a-webauthn-credential-id").digest("hex");
    const h = await write({ accountId: ACCOUNT_A, agentId: AGENT_A, writeKind: "trust_signal_hash", payload: { signalKind: "webauthn", signalHash: hash } });
    expect(h.status).toBe(200);
    const treeRow = await pool.query(`SELECT signal_hash FROM identity_tree_entries WHERE agent_id=$1 AND signal_kind='webauthn'`, [AGENT_A]);
    expect(treeRow.rows[0].signal_hash).toBe(hash);

    const sealed = Buffer.from(Uint8Array.from({ length: 80 }, (_, i) => (i * 53 + 7) % 256)).toString("base64");
    const c = await write({ accountId: ACCOUNT_A, agentId: AGENT_A, writeKind: "trust_signal_ciphertext", payload: { ciphertext: sealed, signalKind: "webauthn" } });
    expect(c.status).toBe(200);
    const pq = await pool.query(`SELECT ciphertext FROM pickup_queue WHERE agent_id=$1`, [AGENT_A]);
    expect(pq.rowCount).toBe(1);
  });

  it("SI-001: smuggled plaintext (email / OAuth token) is rejected AND never present in any seam table", async () => {
    // Try to land a raw email as a 'hash' and a raw token as 'ciphertext' — both must be rejected.
    const emailAsHash = await write({ accountId: ACCOUNT_A, agentId: AGENT_A, writeKind: "trust_signal_hash", payload: { signalKind: "webauthn", signalHash: RAW_EMAIL } });
    expect(emailAsHash.status).toBe(422);
    const tokenAsCipher = await write({ accountId: ACCOUNT_A, agentId: AGENT_A, writeKind: "trust_signal_ciphertext", payload: { ciphertext: Buffer.from(RAW_TOKEN).toString("base64"), signalKind: "webauthn" } });
    expect(tokenAsCipher.status).toBe(422);

    // Dump every byte of the three seam tables for our agents and assert the plaintext is absent.
    const dump = await pool.query(
      `SELECT 'sus' AS t, agent_id::text AS a, paused::text AS v FROM agent_suspensions WHERE agent_id = ANY($1)
       UNION ALL SELECT 'tree', agent_id, signal_hash FROM identity_tree_entries WHERE agent_id = ANY($1)
       UNION ALL SELECT 'pq', agent_id, encode(ciphertext,'escape') FROM pickup_queue WHERE agent_id = ANY($1)`,
      [[AGENT_A, AGENT_B]],
    );
    const haystack = JSON.stringify(dump.rows);
    expect(haystack).not.toContain(RAW_EMAIL);
    expect(haystack).not.toContain(RAW_TOKEN);
    expect(haystack).not.toContain("@example.com");
  });

  it("401 without the API key", async () => {
    const res = await fetch(`${base}/internal/agent-write`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountId: ACCOUNT_A, agentId: AGENT_A, writeKind: "revocation_flag", payload: { mode: "pause" } }),
    });
    expect(res.status).toBe(401);
  });
});
