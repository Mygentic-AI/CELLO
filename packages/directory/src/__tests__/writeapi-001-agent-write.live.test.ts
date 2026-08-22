// WRITEAPI-001 LIVE — POST /internal/agent-write against the REAL directory Postgres (docker, :5433).
//
// Proves what the stub-pool contract test cannot: that the seam PERSISTS to the real V34 schema and
// that the SI-001 directory dump holds — after attempting to smuggle a raw email and an OAuth token,
// NEITHER appears anywhere in the three write-seam tables. Gated to CELLO_ENV=local.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { createHash, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createInternalApiServer } from "../internal-api-server.js";
import { seedAccount } from "./helpers/seed-account.js";

const DB_URL = process.env.DATABASE_URL ?? "postgresql://postgres:dev@localhost:5433/cello_dev";
const API_KEY = "test-writeapi-live-key";

/**
 * PER-RUN UNIQUE, so the account rows never need deleting.
 *
 * `user_accounts` is hash-chained and append-only: `verifyChain` chains each row to the previous
 * row's stored hash, so a delete invalidates every row after it — in every other file, for the rest
 * of the run. The fixed ids here forced a delete-then-insert seed, which was one of the causes of
 * `chain broke at sequence 2` surfacing in suites that never touch accounts.
 */
const RUN = randomUUID().slice(0, 8);
const ACCOUNT_A = randomUUID();
const ACCOUNT_B = randomUUID();
const AGENT_A = `writeapi-live-agent-A-${RUN}`;
const AGENT_B = `writeapi-live-agent-B-${RUN}`;
const KP_A = createHash("sha256").update(`writeapi-kpa-${RUN}`).digest("hex");
const KP_B = createHash("sha256").update(`writeapi-kpb-${RUN}`).digest("hex");
const PP_A = createHash("sha256").update(`writeapi-ppa-${RUN}`).digest("hex");
const PP_B = createHash("sha256").update(`writeapi-ppb-${RUN}`).digest("hex");

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
    // No pre-delete of user_accounts: the ids are per-run, and the table is append-only.

    for (const [acct, email] of [
      [ACCOUNT_A, `writeapi-a-${RUN}@example.com`],
      [ACCOUNT_B, `writeapi-b-${RUN}@example.com`],
    ] as const) {
      // Seeded through the CHAINED writer. This used to INSERT `chain_hash: 'writeapi-seed-chain'`
      // — a literal string in a hash-chained table, which is a hole that fails verifyChain at that
      // row and every row after it, for the whole run.
      await seedAccount(pool, {
        accountId: acct,
        phoneStubHash: createHash("sha256").update(acct + "-phone").digest("hex"),
        emailStubHash: createHash("sha256").update(email).digest("hex"),
      });
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

    server = createInternalApiServer({ pool, internalApiKey: API_KEY, logger: noopLogger, owningNodeId: "test-node" });
    await new Promise<void>((r) => server.listen(0, () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    if (server) await new Promise<void>((r) => server.close(() => r()));
    await pool.query(`DELETE FROM agent_suspensions WHERE agent_id = ANY($1)`, [[AGENT_A, AGENT_B]]).catch(() => {});
    await pool.query(`DELETE FROM identity_tree_entries WHERE agent_id = ANY($1)`, [[AGENT_A, AGENT_B]]).catch(() => {});
    await pool.query(`DELETE FROM pickup_queue WHERE agent_id = ANY($1)`, [[AGENT_A, AGENT_B]]).catch(() => {});
    await pool.query(`DELETE FROM agent_profiles WHERE agent_id = ANY($1)`, [[AGENT_A, AGENT_B]]).catch(() => {});
    // user_accounts rows are LEFT IN PLACE — append-only and hash-chained; deleting breaks the chain.
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

  it("M10-D18: the retired trust_signal_hash + trust_signal_ciphertext arms are rejected — nothing lands in the seam tables", async () => {
    // Trust signals now enter via the signed chokepoint (/internal/signal/submit) + deliver, NOT this seam.
    const hash = createHash("sha256").update("a-webauthn-credential-id").digest("hex");
    const h = await write({ accountId: ACCOUNT_A, agentId: AGENT_A, writeKind: "trust_signal_hash", payload: { signalKind: "webauthn", signalHash: hash } });
    expect(h.status, "trust_signal_hash is retired (unsupported_kind)").toBe(422);
    const sealed = Buffer.from(Uint8Array.from({ length: 80 }, (_, i) => (i * 53 + 7) % 256)).toString("base64");
    const c = await write({ accountId: ACCOUNT_A, agentId: AGENT_A, writeKind: "trust_signal_ciphertext", payload: { ciphertext: sealed, signalKind: "webauthn" } });
    expect(c.status, "trust_signal_ciphertext is retired (unsupported_kind)").toBe(422);
    // Nothing landed: neither seam table gained a row for this agent.
    expect((await pool.query(`SELECT 1 FROM identity_tree_entries WHERE agent_id=$1`, [AGENT_A])).rowCount).toBe(0);
    expect((await pool.query(`SELECT 1 FROM pickup_queue WHERE agent_id=$1`, [AGENT_A])).rowCount).toBe(0);
  });

  it("SI-001: smuggled plaintext (email / OAuth token) is rejected AND never present in any seam table", async () => {
    // Try to land a raw email as a 'hash' and a raw token as 'ciphertext' — both must be rejected.
    const emailAsHash = await write({ accountId: ACCOUNT_A, agentId: AGENT_A, writeKind: "trust_signal_hash", payload: { signalKind: "webauthn", signalHash: RAW_EMAIL } });
    expect(emailAsHash.status).toBe(422);
    const tokenAsCipher = await write({ accountId: ACCOUNT_A, agentId: AGENT_A, writeKind: "trust_signal_ciphertext", payload: { ciphertext: Buffer.from(RAW_TOKEN).toString("base64"), signalKind: "webauthn" } });
    expect(tokenAsCipher.status).toBe(422);
    // test-attacker finding 2: PII + non-printable padding (defeats an all-printable check) must ALSO
    // be rejected — the embedded email is a long printable run.
    const paddedEmail = Buffer.concat([
      Buffer.from(RAW_EMAIL),
      Buffer.from(Uint8Array.from({ length: 24 }, (_, i) => (i * 91 + 3) % 32)),
    ]).toString("base64");
    const paddedCipher = await write({ accountId: ACCOUNT_A, agentId: AGENT_A, writeKind: "trust_signal_ciphertext", payload: { ciphertext: paddedEmail, signalKind: "webauthn" } });
    expect(paddedCipher.status).toBe(422);

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
