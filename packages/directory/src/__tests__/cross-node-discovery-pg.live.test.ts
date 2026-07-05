// Cross-node topology — pg-backed proofs against the REAL directory schema (items 0 + 1).
// Gated CELLO_ENV=local (needs the directory Postgres at Docker Compose :5433, migrated to V41+).
//
//   1. FINDING-8 read-through: getProfileWithReadThrough sees an agent registered AFTER the store's
//      boot load (which getProfile, boot-only, cannot). This is the exact bug the cross-node flow
//      hits (a visiting initiator registered after the broker booted) — and the test registers the
//      row AFTER loadProfiles(), because a restart/reload would mask it.
//   2. readPresenceForDiscovery: online+fresh / offline / dark-node (stale heartbeat) / no-row, run
//      in a transaction that is rolled back — proves the SQL freshness join against real constraints.

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import pg from "pg";
import {
  upsertPresenceOnline,
  upsertPresenceOffline,
  readPresenceForDiscovery,
} from "../agent-presence-repository.js";
import { PgDirectoryStore } from "../adapters/pg-directory-store.js";
import { configurePgTypes } from "../pg-type-config.js";
import type { Logger } from "@cello-protocol/interfaces";

configurePgTypes();

const DB_URL = process.env.DATABASE_URL ?? "postgresql://postgres:dev@localhost:5433/cello_dev";
const FRESH_MS = 60_000;
const NODE_X = "node-x-xnode-disc";
const NODE_Y = "node-y-xnode-disc";
const ACCOUNT = "00000000-0000-0000-0000-0000000000e1";

const noopLogger: Logger = {
  info() {}, warn() {}, error() {}, debug() {},
} as unknown as Logger;

const describeLive = process.env.CELLO_ENV === "local" ? describe : describe.skip;

describeLive("cross-node discovery — presence read (real schema, rolled back)", () => {
  let pool: pg.Pool;
  let client: pg.PoolClient;
  const KPUB = "kpub-xnode-disc-a";

  beforeAll(async () => { pool = new pg.Pool({ connectionString: DB_URL }); });
  afterAll(async () => { await pool.end(); });

  beforeEach(async () => {
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO directory_nodes (node_id, region, last_heartbeat_at)
       VALUES ($1, 'test', now()), ($2, 'test', now())`,
      [NODE_X, NODE_Y],
    );
    await client.query(
      `INSERT INTO user_accounts (account_id, phone_stub_hash, email_stub_hash, chain_hash)
       VALUES ($1, 'xnode-disc-phone', 'xnode-disc-email', 'xnode-disc-chain')`,
      [ACCOUNT],
    );
    await client.query(
      `INSERT INTO agent_profiles (k_local_pubkey, primary_pubkey, account_id) VALUES ($1, $2, $3)`,
      [KPUB, "ppub-xnode-disc-a", ACCOUNT],
    );
  });
  afterEach(async () => { await client.query("ROLLBACK"); client.release(); });

  it("state 1: online on a fresh owning node ⇒ rawOnline+nodeFresh+owningNodeId", async () => {
    await upsertPresenceOnline(client, KPUB, NODE_X);
    const p = await readPresenceForDiscovery(client, KPUB, FRESH_MS);
    expect(p).toEqual({ hasRow: true, rawOnline: true, owningNodeId: NODE_X, nodeFresh: true });
  });

  it("state 4 (dark node): online row but stale owning-node heartbeat ⇒ nodeFresh:false", async () => {
    await upsertPresenceOnline(client, KPUB, NODE_X);
    await client.query(
      `UPDATE directory_nodes SET last_heartbeat_at = now() - interval '1 hour' WHERE node_id = $1`,
      [NODE_X],
    );
    const p = await readPresenceForDiscovery(client, KPUB, FRESH_MS);
    expect(p).toMatchObject({ hasRow: true, rawOnline: true, owningNodeId: NODE_X, nodeFresh: false });
  });

  it("state 2: a clean offline transition ⇒ rawOnline:false", async () => {
    await upsertPresenceOnline(client, KPUB, NODE_X);
    await upsertPresenceOffline(client, KPUB, NODE_X);
    const p = await readPresenceForDiscovery(client, KPUB, FRESH_MS);
    expect(p).toMatchObject({ hasRow: true, rawOnline: false });
  });

  it("state 2: an agent that never came online ⇒ hasRow:false", async () => {
    const p = await readPresenceForDiscovery(client, KPUB, FRESH_MS);
    expect(p).toEqual({ hasRow: false, rawOnline: false, owningNodeId: null, nodeFresh: false });
  });
});

describeLive("cross-node discovery — profile read-through (FINDING-8, boot-cache miss)", () => {
  let pool: pg.Pool;
  // A unique key per run so parallel/prior runs never collide; explicit cleanup (no txn — the store
  // uses its own pool connection, so a txn on a separate client would not isolate its reads).
  const KPUB = "kpub-xnode-readthrough-" + "aabbccdd";
  const PRIMARY = "ppub-xnode-readthrough-aabbccdd";
  const ACCT = "00000000-0000-0000-0000-0000000000e2";

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DB_URL });
    await pool.query(`DELETE FROM agent_profiles WHERE k_local_pubkey = $1`, [KPUB]);
    await pool.query(`DELETE FROM user_accounts WHERE account_id = $1`, [ACCT]);
    await pool.query(
      `INSERT INTO user_accounts (account_id, phone_stub_hash, email_stub_hash, chain_hash)
       VALUES ($1, 'rt-phone-aabbccdd', 'rt-email-aabbccdd', 'rt-chain-aabbccdd')
       ON CONFLICT DO NOTHING`,
      [ACCT],
    );
  });
  afterAll(async () => {
    await pool.query(`DELETE FROM agent_profiles WHERE k_local_pubkey = $1`, [KPUB]);
    await pool.query(`DELETE FROM user_accounts WHERE account_id = $1`, [ACCT]);
    await pool.end();
  });

  it("getProfile misses a row registered AFTER boot; getProfileWithReadThrough finds it and warms the cache", async () => {
    const store = new PgDirectoryStore(pool, noopLogger, NODE_X, "test");
    // Boot-load the cache: it's empty of our row because the row does not exist yet.
    await store.loadProfiles();

    // Now the agent registers — on ANOTHER node, replicated here — AFTER this store booted.
    await pool.query(
      `INSERT INTO agent_profiles (k_local_pubkey, primary_pubkey, account_id) VALUES ($1, $2, $3)`,
      [KPUB, PRIMARY, ACCT],
    );

    // The boot-only cache cannot see it — this is the FINDING-8 gap.
    expect(store.getProfile(KPUB)).toBeUndefined();

    // Read-through finds it in replicated agent_profiles and returns the mapped profile.
    const p = await store.getProfileWithReadThrough(KPUB);
    expect(p).toBeDefined();
    expect(p?.k_local_pubkey).toBe(KPUB);
    expect(p?.primary_pubkey).toBe(PRIMARY);
    expect(p?.agent_id).toBeTruthy(); // agent_id backfilled/derived per loadProfiles mapping

    // Cache is now warm — the sync getProfile (and thus every downstream consumer) hits.
    expect(store.getProfile(KPUB)?.k_local_pubkey).toBe(KPUB);
    // And it is reachable by primary_pubkey too (both maps populated).
    expect(store.getProfile(PRIMARY)?.k_local_pubkey).toBe(KPUB);
  });

  it("read-through of a genuinely unknown pubkey ⇒ undefined (state 3)", async () => {
    const store = new PgDirectoryStore(pool, noopLogger, NODE_X, "test");
    await store.loadProfiles();
    expect(await store.getProfileWithReadThrough("deadbeef".repeat(8))).toBeUndefined();
  });
});
