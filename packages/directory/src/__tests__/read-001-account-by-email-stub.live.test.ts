// READ-001 LIVE — /internal/account-by-email-stub against the REAL directory Postgres.
//
// Stands up createInternalApiServer with a real pg pool to the directory's Postgres (docker,
// :5433), seeds a user_accounts row, and exercises the endpoint over real HTTP. Proves the
// account-resolution contract the portal HttpDirectoryClient depends on — against real schema +
// RLS, not a stub pool. Gated to CELLO_ENV=local (requires the directory Postgres up).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { createHash, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createInternalApiServer } from "../internal-api-server.js";
import { PgDirectoryStore } from "../adapters/pg-directory-store.js";

const DB_URL =
  process.env.DATABASE_URL ?? "postgresql://postgres:dev@localhost:5433/cello_dev";
const API_KEY = "test-read-001-key";
/**
 * UNIQUE PER RUN, so the seed never needs deleting.
 *
 * `user_accounts` is hash-chained and append-only: `verifyChain` chains each row to the previous
 * row's stored hash, so removing any row invalidates every row after it — in every other file, for
 * the rest of the run. The fixed ids here forced a delete-then-insert seed, and that delete was one
 * of the causes of `chain broke at sequence 2` turning up in suites that never touch accounts.
 *
 * Fresh ids per run cost nothing and remove the need for cleanup entirely.
 */
const RUN = randomUUID();
const ACCOUNT_ID = randomUUID();
const EMAIL = `operator+${RUN}@example.com`;
const emailStub = createHash("sha256").update(EMAIL.trim().toLowerCase()).digest("hex");
const phoneStub = createHash("sha256").update(`read-001-seed-phone-${RUN}`).digest("hex");

const noopLogger = { info() {}, warn() {}, error() {} };
const describeLive = process.env.CELLO_ENV === "local" ? describe : describe.skip;

describeLive("READ-001 live — /internal/account-by-email-stub (real Postgres + HTTP)", () => {
  let pool: pg.Pool;
  let server: Server;
  let base: string;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DB_URL });
    /**
     * SEEDED THROUGH THE CHAINED WRITER, not a raw INSERT.
     *
     * This used to insert directly with `chain_hash: "read-001-seed-chain"` — a literal string in a
     * hash-chained table. That row alone invalidated `verifyChain('user_accounts')` for every row
     * after it, which is a whole-run failure in files that have nothing to do with this one.
     *
     * `createAccount` computes the hash against the current chain head, so the seed row is a
     * genuine link rather than a hole. Combined with the per-run ids above, no cleanup is needed.
     */
    await new PgDirectoryStore(pool, noopLogger as never).createAccount({
      accountId: ACCOUNT_ID,
      phoneStubHash: phoneStub,
      emailStubHash: emailStub,
      correlationId: `read-001-seed-${RUN}`,
    });
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
    // The account row is LEFT IN PLACE — see the seed above. Deleting from a hash-chained,
    // append-only table breaks every row after it, and the per-run ids mean nothing collides.
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
