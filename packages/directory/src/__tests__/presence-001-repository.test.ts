// PRESENCE-001 — agent_presence repository + the READ-001 read rule, against the REAL directory
// schema. Each test runs in a transaction that applies V33, seeds, exercises the real repo
// functions, and ROLLS BACK — so it proves the SQL against real constraints/RLS/joins with zero
// pollution of the shared flyway-managed DB. Gated CELLO_ENV=local (needs the directory Postgres).

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import pg from "pg";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  upsertPresenceOnline,
  upsertPresenceOffline,
  reconcileNodeOffline,
  listAccountAgentsWithPresence,
} from "../agent-presence-repository.js";
import { configurePgTypes } from "../pg-type-config.js";

// Match the PRODUCTION directory node, which installs a global TIMESTAMPTZ→string parser. Without
// this the test pool returns Dates and HIDES the very bug this file must guard: in prod
// last_seen_at came back as a string, so `.toISOString()` in the agents-by-account handler crashed
// (502, agents never appeared). The harness diverging from prod is what let it ship.
configurePgTypes();

const DB_URL =
  process.env.DATABASE_URL ?? "postgresql://postgres:dev@localhost:5433/cello_dev";
const V33_SQL = readFileSync(
  path.join(process.cwd(), "db/migrations/V33__agent_presence.sql"),
  "utf8",
);

const ACCOUNT = "00000000-0000-0000-0000-0000000000d1";
const KPUB_A = "kpub-presence-a";
const NODE_X = "node-x-presence";
const NODE_Y = "node-y-presence";
const FRESH_MS = 60_000;

const describeLive = process.env.CELLO_ENV === "local" ? describe : describe.skip;

describeLive("PRESENCE-001 — agent_presence repository + read rule (real schema, rolled back)", () => {
  let pool: pg.Pool;
  let client: pg.PoolClient;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DB_URL });
  });
  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    client = await pool.connect();
    await client.query("BEGIN");
    // Apply V33 only if it isn't already in the schema — the shared dev DB may be flyway-migrated
    // past V33 (e.g. after a real-directory e2e run), in which case CREATE TABLE would conflict.
    const { rows: pre } = await client.query<{ exists: boolean }>(
      `SELECT to_regclass('agent_presence') IS NOT NULL AS exists`,
    );
    if (!pre[0].exists) {
      await client.query(V33_SQL); // create agent_presence + add directory_nodes.last_heartbeat_at
    }
    await client.query(
      `INSERT INTO directory_nodes (node_id, region, last_heartbeat_at)
       VALUES ($1, 'test', now()), ($2, 'test', now())`,
      [NODE_X, NODE_Y],
    );
    await client.query(
      `INSERT INTO user_accounts (account_id, phone_stub_hash, email_stub_hash, chain_hash)
       VALUES ($1, 'presence-test-phone', 'presence-test-email', 'presence-test-chain')`,
      [ACCOUNT],
    );
    await client.query(
      `INSERT INTO agent_profiles (k_local_pubkey, primary_pubkey, account_id)
       VALUES ($1, $2, $3)`,
      [KPUB_A, "ppub-presence-a", ACCOUNT],
    );
  });
  afterEach(async () => {
    await client.query("ROLLBACK");
    client.release();
  });

  async function readAgents() {
    return listAccountAgentsWithPresence(client, ACCOUNT, FRESH_MS);
  }

  it("AC-002: a connect transition makes the agent readable as online (account-scoped)", async () => {
    await upsertPresenceOnline(client, KPUB_A, NODE_X);
    const agents = await readAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({ kLocalPubkey: KPUB_A, online: true });
    // Regression: lastSeenAt must be a real Date even under the prod string parser, so the
    // internal API's `last_seen_at.toISOString()` cannot crash (the live 502).
    expect(agents[0].lastSeenAt).toBeInstanceOf(Date);
  });

  it("AC-003: node-liveness guard — a dark node ages the agent out to last-seen", async () => {
    await upsertPresenceOnline(client, KPUB_A, NODE_X);
    expect((await readAgents())[0].online).toBe(true);

    // Node X goes dark (stale heartbeat) WITHOUT a clean disconnect — the row still says online.
    await client.query(
      `UPDATE directory_nodes SET last_heartbeat_at = now() - interval '1 hour' WHERE node_id = $1`,
      [NODE_X],
    );
    const agents = await readAgents();
    expect(agents[0].online).toBe(false); // read rule: online row but stale node → not online
    expect(agents[0].lastSeenAt).not.toBeNull(); // surfaces as last-seen
  });

  it("AC-004: sovereign write-ownership — only the owning node can flip the row", async () => {
    await upsertPresenceOnline(client, KPUB_A, NODE_X);
    // Node Y tries to mark X's agent offline → no-op.
    expect(await upsertPresenceOffline(client, KPUB_A, NODE_Y)).toBe(false);
    expect((await readAgents())[0].online).toBe(true);
    // Node X (the owner) can.
    expect(await upsertPresenceOffline(client, KPUB_A, NODE_X)).toBe(true);
    expect((await readAgents())[0].online).toBe(false);
  });

  it("startup reconciliation marks the node's online rows offline", async () => {
    await upsertPresenceOnline(client, KPUB_A, NODE_X);
    expect(await reconcileNodeOffline(client, NODE_X)).toBe(1);
    expect((await readAgents())[0].online).toBe(false);
  });

  it("edge-triggered: connect then disconnect is exactly two writes (online, offline)", async () => {
    // No write happens between — the table reflects only the transitions.
    await upsertPresenceOnline(client, KPUB_A, NODE_X);
    await upsertPresenceOffline(client, KPUB_A, NODE_X);
    const { rows } = await client.query<{ online: boolean }>(
      `SELECT online FROM agent_presence WHERE k_local_pubkey = $1`,
      [KPUB_A],
    );
    expect(rows).toHaveLength(1); // one mutable row, not append-only
    expect(rows[0].online).toBe(false);
  });
});
