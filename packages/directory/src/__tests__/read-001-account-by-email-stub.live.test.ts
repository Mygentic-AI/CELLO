// READ-001 LIVE — /internal/account-by-email-stub against the REAL directory Postgres.
//
// Stands up createInternalApiServer with a real pg pool to the directory's Postgres (docker,
// :5433), seeds a user_accounts row, and exercises the endpoint over real HTTP. Proves the
// account-resolution contract the portal HttpDirectoryClient depends on — against real schema +
// RLS, not a stub pool. Gated to CELLO_ENV=local (requires the directory Postgres up).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createInternalApiServer } from "../internal-api-server.js";

const DB_URL =
  process.env.DATABASE_URL ?? "postgresql://postgres:dev@localhost:5433/cello_dev";
const API_KEY = "test-read-001-key";
const ACCOUNT_ID = "00000000-0000-0000-0000-0000000000a1";
const EMAIL = "operator@example.com";
const emailStub = createHash("sha256").update(EMAIL.trim().toLowerCase()).digest("hex");
const phoneStub = createHash("sha256").update("read-001-seed-phone").digest("hex");

const noopLogger = { info() {}, warn() {}, error() {} };
const describeLive = process.env.CELLO_ENV === "local" ? describe : describe.skip;

describeLive("READ-001 live — /internal/account-by-email-stub (real Postgres + HTTP)", () => {
  let pool: pg.Pool;
  let server: Server;
  let base: string;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DB_URL });
    // Idempotent seed: clear any prior row sharing our id/phone/email, then insert.
    // Links first: account_email_stubs carries an FK to user_accounts, so deleting the account
    // while a stub row survives is refused.
    await pool.query(`DELETE FROM account_email_stubs WHERE account_id = $1 OR email_stub_hash = $2`,
      [ACCOUNT_ID, emailStub]);
    await pool.query(
      `DELETE FROM user_accounts WHERE account_id = $1 OR phone_stub_hash = $2 OR email_stub_hash = $3`,
      [ACCOUNT_ID, phoneStub, emailStub],
    );
    await pool.query(
      `INSERT INTO user_accounts (account_id, phone_stub_hash, email_stub_hash, chain_hash)
       VALUES ($1, $2, $3, $4)`,
      [ACCOUNT_ID, phoneStub, emailStub, "read-001-seed-chain"],
    );
    // REPL-001: the lookup now resolves through the REPLICATED stub table, so the seed has to write
    // it. Seeding only the column reproduced the defect exactly — correct on the node that wrote it,
    // unknown everywhere else.
    await pool.query(
      `INSERT INTO account_email_stubs (email_stub_hash, account_id) VALUES ($1, $2)
       ON CONFLICT (email_stub_hash) DO NOTHING`,
      [emailStub, ACCOUNT_ID],
    );
    server = createInternalApiServer({ pool, internalApiKey: API_KEY, logger: noopLogger, owningNodeId: "test-node" });
    await new Promise<void>((r) => server.listen(0, () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    if (server) await new Promise<void>((r) => server.close(() => r()));
    await pool
      .query(`DELETE FROM user_accounts WHERE account_id = $1`, [ACCOUNT_ID])
      .catch(() => {});
    await pool.end();
  });

  function post(body: unknown, key?: string) {
    return fetch(`${base}/internal/account-by-email-stub`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(key ? { "x-cello-internal-api-key": key } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  it("resolves a seeded account by email_stub_hash", async () => {
    const res = await post({ emailStubHash: emailStub }, API_KEY);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ account_id: ACCOUNT_ID });
  });

  it("404 for an unknown email_stub_hash (the signpost path)", async () => {
    const res = await post({ emailStubHash: "f".repeat(64) }, API_KEY);
    expect(res.status).toBe(404);
  });

  it("401 without the API key", async () => {
    expect((await post({ emailStubHash: emailStub })).status).toBe(401);
  });
});
