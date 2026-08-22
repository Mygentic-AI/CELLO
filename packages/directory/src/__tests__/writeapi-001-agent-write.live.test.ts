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
import { seedAccount, seedAgentLink } from "./helpers/seed-account.js";

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

/**
 * The write-seam tables the SI-001 dump must cover.
 *
 * ─── Why this is a named list with an existence check, and not a query ─────────────────────────
 *
 * This file dumped three tables and asserted a smuggled email appeared in none of them. One of the
 * three, `identity_tree_entries`, was DROPPED by `V48__drop_identity_tree_entries.sql` when the M8
 * delivery pipe retired. The dump kept naming it, so every run since threw *"relation
 * identity_tree_entries does not exist"* — out of `beforeAll`, which vitest reports by marking the
 * five tests **skipped** rather than failed. The seam's plaintext-leak assertion has therefore not
 * executed since V48. `DOD-M15-DIRECTORY-ROT-1`.
 *
 * The list cannot be derived — "tables the write seam touches" is not a property Postgres knows —
 * so it stays explicit. What changes is that it is now CHECKED: a table that no longer exists fails
 * a test that says so, in the results, instead of erroring inside a hook. The failure mode being
 * guarded against is not a missing table; it is the dump quietly covering less than it claims.
 */
const WRITE_SEAM_TABLES = ["agent_suspensions", "pickup_queue", "agent_profiles"] as const;

describeLive("WRITEAPI-001 live — /internal/agent-write (real Postgres + HTTP)", () => {
  let pool: pg.Pool;
  let server: Server;
  let base: string;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DB_URL });
    // Clean slate for our fixtures.
    for (const table of WRITE_SEAM_TABLES) {
      await pool.query(`DELETE FROM ${table} WHERE agent_id = ANY($1)`, [[AGENT_A, AGENT_B]]);
    }
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
      // The column above is the LEGACY binding. `isAgentOwnedByAccount` reads `agent_account_links`
      // since V59, so without this every write below is refused 403 not_owner — which is exactly
      // what this suite has been silently returning since that migration.
      await seedAgentLink(pool, { agentId, accountId: acct });
    }

    server = createInternalApiServer({ pool, internalApiKey: API_KEY, logger: noopLogger, owningNodeId: "test-node" });
    await new Promise<void>((r) => server.listen(0, () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    if (server) await new Promise<void>((r) => server.close(() => r()));
    for (const table of WRITE_SEAM_TABLES) {
      await pool.query(`DELETE FROM ${table} WHERE agent_id = ANY($1)`, [[AGENT_A, AGENT_B]]).catch(() => {});
    }
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
    // Nothing landed: no seam table gained a row for this agent.
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

    /**
     * Dump the seam tables for our agents and assert the plaintext is absent.
     *
     * EVERY COLUMN, not one hand-picked per table. The previous version selected `paused` from
     * suspensions and `ciphertext` from the queue, so a raw email landing in any OTHER column of
     * those tables would have gone unseen by a test whose whole subject is that it cannot.
     *
     * `bytea` columns are decoded with `encode(…, 'escape')`: a plaintext email inside a binary
     * column is exactly the thing being hunted, and `to_jsonb` would render it as `\\x` hex where a
     * substring search finds nothing and the test passes for the wrong reason.
     */
    const haystacks: string[] = [];
    for (const table of WRITE_SEAM_TABLES) {
      const cols = await pool.query<{ column_name: string; data_type: string }>(
        `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1`,
        [table],
      );
      expect(cols.rowCount, `${table} has no columns — is it still the seam table it was?`).toBeGreaterThan(0);
      const selects = cols.rows.map((c) =>
        c.data_type === "bytea"
          ? `encode("${c.column_name}",'escape') AS "${c.column_name}"`
          : `"${c.column_name}"::text AS "${c.column_name}"`,
      );
      const dump = await pool.query(
        `SELECT ${selects.join(", ")} FROM ${table} WHERE agent_id = ANY($1)`,
        [[AGENT_A, AGENT_B]],
      );
      haystacks.push(JSON.stringify(dump.rows));
    }
    const haystack = haystacks.join(" ");
    expect(haystack).not.toContain(RAW_EMAIL);
    expect(haystack).not.toContain(RAW_TOKEN);
    expect(haystack).not.toContain("@example.com");
  });

  it("the seam tables this dump claims to cover all still exist", async () => {
    // The guard on the guard. `identity_tree_entries` was on this list until V48 dropped it, and the
    // only way anyone found out was that the whole file stopped running — reported as five skipped
    // tests, not as a failure. If a seam table is retired, this says so in the results.
    const { rows } = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_name = ANY($1)`,
      [[...WRITE_SEAM_TABLES]],
    );
    const present = new Set(rows.map((r) => r.table_name));
    const missing = WRITE_SEAM_TABLES.filter((t) => !present.has(t));
    expect(
      missing,
      `The SI-001 plaintext dump names tables that no longer exist: ${missing.join(", ")}. Either a ` +
        `migration retired them — remove them from WRITE_SEAM_TABLES — or the schema is wrong. ` +
        `Leaving them listed makes every query in this file throw inside beforeAll, where vitest ` +
        `reports the result as "skipped".`,
    ).toEqual([]);
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
