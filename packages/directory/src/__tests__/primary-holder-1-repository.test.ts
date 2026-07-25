// M8C-PRIMARY-1 — primary_holder + primary_transfer_nonce_bindings repositories, against the REAL
// directory schema. Each test runs in a transaction that applies V44/V45, seeds, exercises the
// real repo functions, and ROLLS BACK — mirrors presence-001-repository.test.ts's exact harness.
// Gated CELLO_ENV=local (needs the directory Postgres).

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import pg from "pg";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getPrimaryHolder,
  upsertPrimaryHolder,
  refreshPrimaryHolderHeartbeat,
} from "../primary-holder-repository.js";
import { bindPrimaryTransferNonce } from "../primary-transfer-nonce-repository.js";
import { configurePgTypes } from "../pg-type-config.js";

// Matches the PRODUCTION directory node's global TIMESTAMPTZ→string parser — without this the
// test pool returns Dates and hides the exact normalization bug class presence-001's own comment
// warns about (repo functions must handle pg returning a string, not a Date).
configurePgTypes();

const DB_URL =
  process.env.DATABASE_URL ?? "postgresql://postgres:dev@localhost:5433/cello_dev";
// Anchored to THIS FILE, not to process.cwd().
//
// `path.join(process.cwd(), "db/migrations/...")` resolved only when vitest was
// launched from packages/directory. The root `pnpm run test` — the gate every
// commit is supposed to pass — runs from the repo root, where that path does
// not exist, so readFileSync threw at collection and this suite counted as a
// FAILED SUITE with zero failed tests. Three suites did this, which is how a
// green-looking gate reported "4 failed" for long enough that people read past it.
const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../db/migrations",
);

const V44_SQL = readFileSync(
  path.join(MIGRATIONS_DIR, "V44__primary_holder.sql"),
  "utf8",
);
const V45_SQL = readFileSync(
  path.join(MIGRATIONS_DIR, "V45__primary_transfer_nonce_bindings.sql"),
  "utf8",
);

const KPUB_A = "kpub-primary-holder-a";
const DAEMON_OLD = "daemon-old-11111111";
const DAEMON_NEW = "daemon-new-22222222";
const DAEMON_OTHER = "daemon-other-33333333";

const describeLive = process.env.CELLO_ENV === "local" ? describe : describe.skip;

describeLive("M8C-PRIMARY-1 — primary_holder + primary_transfer_nonce_bindings repositories (real schema, rolled back)", () => {
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
    const { rows: preHolder } = await client.query<{ exists: boolean }>(
      `SELECT to_regclass('primary_holder') IS NOT NULL AS exists`,
    );
    if (!preHolder[0].exists) await client.query(V44_SQL);
    const { rows: preNonce } = await client.query<{ exists: boolean }>(
      `SELECT to_regclass('primary_transfer_nonce_bindings') IS NOT NULL AS exists`,
    );
    if (!preNonce[0].exists) await client.query(V45_SQL);
  });
  afterEach(async () => {
    await client.query("ROLLBACK");
    client.release();
  });

  // ─── primary-holder-repository.ts ───────────────────────────────────────────

  describe("getPrimaryHolder / upsertPrimaryHolder", () => {
    it("no row for an agent that has never had a Primary attested here returns null", async () => {
      expect(await getPrimaryHolder(client, KPUB_A)).toBeNull();
    });

    it("upsertPrimaryHolder then getPrimaryHolder round-trips the holder", async () => {
      await upsertPrimaryHolder(client, KPUB_A, DAEMON_OLD);
      const row = await getPrimaryHolder(client, KPUB_A);
      expect(row).not.toBeNull();
      expect(row!.kLocalPubkey).toBe(KPUB_A);
      expect(row!.holdingDaemonId).toBe(DAEMON_OLD);
      // Regression (mirrors presence-001's own guard): must be a real Date even under the prod
      // string-returning TIMESTAMPTZ parser, or a caller's .toISOString() would crash.
      expect(row!.lastAttestedAt).toBeInstanceOf(Date);
    });

    it("a second upsertPrimaryHolder call OVERWRITES the holder (this is how a transfer is recorded)", async () => {
      await upsertPrimaryHolder(client, KPUB_A, DAEMON_OLD);
      await upsertPrimaryHolder(client, KPUB_A, DAEMON_NEW);
      const row = await getPrimaryHolder(client, KPUB_A);
      expect(row!.holdingDaemonId).toBe(DAEMON_NEW);
    });
  });

  describe("refreshPrimaryHolderHeartbeat", () => {
    it("refreshes when called by the CURRENT holder — returns true", async () => {
      await upsertPrimaryHolder(client, KPUB_A, DAEMON_OLD);
      const before = (await getPrimaryHolder(client, KPUB_A))!.lastAttestedAt;
      const refreshed = await refreshPrimaryHolderHeartbeat(client, KPUB_A, DAEMON_OLD);
      expect(refreshed).toBe(true);
      // Postgres's now() is frozen to transaction start (not clock_timestamp()), so within this
      // single BEGIN/ROLLBACK-wrapped test the timestamp cannot be asserted as strictly advancing —
      // >= (not throwing, not going backwards) is the real, environment-correct guarantee here.
      const after = (await getPrimaryHolder(client, KPUB_A))!.lastAttestedAt;
      expect(after.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });

    it("a NON-current daemon_id's heartbeat no-ops — returns false, does NOT refresh or overwrite the row", async () => {
      await upsertPrimaryHolder(client, KPUB_A, DAEMON_OLD);
      const refreshed = await refreshPrimaryHolderHeartbeat(client, KPUB_A, DAEMON_OTHER);
      expect(refreshed).toBe(false);
      // The row still names the ORIGINAL holder — a wrong daemon_id cannot silently claim it via heartbeat.
      const row = await getPrimaryHolder(client, KPUB_A);
      expect(row!.holdingDaemonId).toBe(DAEMON_OLD);
    });
  });

  // ─── primary-transfer-nonce-repository.ts ───────────────────────────────────

  describe("bindPrimaryTransferNonce", () => {
    it("first bind on a fresh nonce succeeds", async () => {
      const result = await bindPrimaryTransferNonce(client, "nonce-1", DAEMON_NEW);
      expect(result).toEqual({ bound: true });
    });

    it("re-presenting the SAME nonce by the SAME daemon_id is idempotent — succeeds again", async () => {
      await bindPrimaryTransferNonce(client, "nonce-2", DAEMON_NEW);
      const retried = await bindPrimaryTransferNonce(client, "nonce-2", DAEMON_NEW);
      expect(retried).toEqual({ bound: true });
    });

    it("replaying the SAME nonce for a DIFFERENT daemon_id is rejected — the real anti-replay property", async () => {
      await bindPrimaryTransferNonce(client, "nonce-3", DAEMON_NEW);
      const replay = await bindPrimaryTransferNonce(client, "nonce-3", DAEMON_OTHER);
      expect(replay).toEqual({ bound: false, reason: "NONCE_ALREADY_BOUND" });
    });

    it("distinct nonces for distinct daemons never collide", async () => {
      const r1 = await bindPrimaryTransferNonce(client, "nonce-4a", DAEMON_NEW);
      const r2 = await bindPrimaryTransferNonce(client, "nonce-4b", DAEMON_OTHER);
      expect(r1).toEqual({ bound: true });
      expect(r2).toEqual({ bound: true });
    });
  });
});
