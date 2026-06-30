// LEVER-002 LIVE — burn: permanent, accountability survives (DOD-LEVER-2 contained part).
//
// Against the real directory Postgres: a burn sets a PERMANENT flag (paused + burned) that a clear
// CANNOT lift (409 burned_immutable), while the agent_profiles binding (agent_id ↔ key ↔ account) is
// left UNTOUCHED so the identity stays resolvable (SI-002). Coordinated per-node share destruction is
// the separated heavier part. Run against a DB with the full migration history (cello_spine).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createInternalApiServer } from "../internal-api-server.js";
import { PgDirectoryStore } from "../adapters/pg-directory-store.js";
import type { Logger } from "@cello-protocol/interfaces";

const DB_URL = process.env.DATABASE_URL ?? "postgresql://postgres:dev@localhost:5433/cello_spine";
const API_KEY = "test-burn-live-key";
const ACCOUNT = "00000000-0000-0000-0000-00000000bbbb";
const AGENT = "burn-live-agent";
const KP = "bb".repeat(32);
const PP = "cc".repeat(32);

const noopLogger = { info() {}, warn() {}, error() {} };
const describeLive = process.env.CELLO_ENV === "local" ? describe : describe.skip;

describeLive("LEVER-002 live — burn is permanent; accountability survives", () => {
  let pool: pg.Pool;
  let server: Server;
  let base: string;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DB_URL });
    await pool.query(`DELETE FROM agent_suspensions WHERE agent_id = $1`, [AGENT]);
    await pool.query(`DELETE FROM agent_profiles WHERE agent_id = $1`, [AGENT]);
    await pool.query(`DELETE FROM user_accounts WHERE account_id = $1`, [ACCOUNT]);
    await pool.query(
      `INSERT INTO user_accounts (account_id, phone_stub_hash, email_stub_hash, chain_hash)
       VALUES ($1, 'burn-phone', 'burn-email', 'burn-chain')`,
      [ACCOUNT],
    );
    await pool.query(
      `INSERT INTO agent_profiles (k_local_pubkey, primary_pubkey, registered_at, status, chain_hash, account_id, agent_id)
       VALUES ($1, $2, 1, 'active', 'burn-chain', $3, $4)`,
      [KP, PP, ACCOUNT, AGENT],
    );
    server = createInternalApiServer({ pool, internalApiKey: API_KEY, logger: noopLogger, owningNodeId: "test-node" });
    await new Promise<void>((r) => server.listen(0, () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    if (server) await new Promise<void>((r) => server.close(() => r()));
    await pool.query(`DELETE FROM agent_suspensions WHERE agent_id = $1`, [AGENT]).catch(() => {});
    await pool.query(`DELETE FROM agent_profiles WHERE agent_id = $1`, [AGENT]).catch(() => {});
    await pool.query(`DELETE FROM user_accounts WHERE account_id = $1`, [ACCOUNT]).catch(() => {});
    await pool.end();
  });

  function write(mode: string) {
    return fetch(`${base}/internal/agent-write`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-cello-internal-api-key": API_KEY },
      body: JSON.stringify({ accountId: ACCOUNT, agentId: AGENT, writeKind: "revocation_flag", payload: { mode } }),
    });
  }

  it("burn sets a permanent flag (paused + burned) that a clear cannot lift; the binding survives", async () => {
    const burned = await write("burn");
    expect(burned.status).toBe(200);
    let row = await pool.query<{ paused: boolean; burned: boolean }>(
      `SELECT paused, burned FROM agent_suspensions WHERE agent_id = $1`,
      [AGENT],
    );
    expect(row.rows[0]).toMatchObject({ paused: true, burned: true });

    // A clear on a BURNED agent is rejected — capability cannot be restored by clearing a flag.
    const cleared = await write("clear");
    expect(cleared.status).toBe(409);
    expect(((await cleared.json()) as { reason?: string }).reason).toBe("burned_immutable");
    // Still burned + paused after the rejected clear.
    row = await pool.query(`SELECT paused, burned FROM agent_suspensions WHERE agent_id = $1`, [AGENT]);
    expect(row.rows[0]).toMatchObject({ paused: true, burned: true });

    // SI-002: accountability survives — the agent_profiles binding (id ↔ key ↔ account) is UNTOUCHED.
    const profile = await pool.query<{ k_local_pubkey: string; account_id: string; status: string }>(
      `SELECT k_local_pubkey, account_id::text, status FROM agent_profiles WHERE agent_id = $1`,
      [AGENT],
    );
    expect(profile.rows[0]).toMatchObject({ k_local_pubkey: KP, account_id: ACCOUNT, status: "active" });
  });

  it("the burned agent is listed for the per-node reconcile sweep (LEVER-002 idle-node guarantee)", async () => {
    // The agent is burned from the prior test. The reconcile sweep lists burned agents by k_local so
    // an idle/offline node can zero its own share without a ceremony attempt.
    const store = new PgDirectoryStore(pool, { info() {}, warn() {}, error() {}, debug() {} } as unknown as Logger);
    const burned = await store.listBurnedAgentPubkeys();
    expect(burned).toContain(KP);
    expect(await store.isAgentBurned(KP)).toBe(true);
  });

  it("a pause is reversible, but once burned it stays burned (burn is monotonic)", async () => {
    // The agent is already burned from the prior test. A pause does not un-burn; a clear stays rejected.
    expect((await write("pause")).status).toBe(200);
    const row = await pool.query(`SELECT burned FROM agent_suspensions WHERE agent_id = $1`, [AGENT]);
    expect(row.rows[0].burned).toBe(true);
    expect((await write("clear")).status).toBe(409);
  });
});
