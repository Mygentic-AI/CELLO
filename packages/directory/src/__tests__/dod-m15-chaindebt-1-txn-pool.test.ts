/**
 * DOD-M15-CHAINDEBT-1 review F1 — `inRolledBackTxn` must actually roll back.
 *
 * ─── Why this file exists ──────────────────────────────────────────────────────────────────────
 *
 * `txnPool`/`inRolledBackTxn` is one of the three patterns this milestone standardised on for
 * writing fixtures that touch hash-chained tables. It did not work. The proxy neutered `release`
 * and nothing else, so `insertWithChain` — which sets `ownsTransaction = true` when it is given no
 * external client — issued its own `BEGIN` … `COMMIT` on the SAME client the caller's transaction
 * was running on. The store's first write ended the caller's transaction and committed everything
 * before it; the closing `ROLLBACK` was a no-op.
 *
 * It survived because the helper's NAME is the guarantee. Every caller read `inRolledBackTxn` and
 * stopped there — including the guard entry in `dod-m15-directory-rot-1-chain-writes.test.ts`,
 * which asserted in prose that `persist-004`'s deliberate chain break "is undone" while that test
 * committed a whole-table TRUNCATE on every run.
 *
 * So the property gets a test rather than a name. **The assertion is on the DATABASE, not on the
 * helper's behaviour** — "did the row survive" is the only question that matters, and it is the one
 * no amount of reading the proxy would have answered.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { inRolledBackTxn } from "./helpers/txn-pool.js";
import { PgDirectoryStore } from "../adapters/pg-directory-store.js";
import type { Logger } from "@cello-protocol/interfaces";

const isLocal = process.env["CELLO_ENV"] === "local";
const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgresql://postgres:dev@localhost:5433/cello_dev";
const describeIntegration = isLocal ? describe : describe.skip;

function silentLogger(): Logger {
  return { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
}

describeIntegration("DOD-M15-CHAINDEBT-1 F1: inRolledBackTxn leaves nothing behind", () => {
  let pool: pg.Pool;
  beforeAll(() => { pool = new pg.Pool({ connectionString: DATABASE_URL }); });
  afterAll(async () => { await pool.end(); });

  const countRelays = async (): Promise<number> => {
    const r = await pool.query<{ n: string }>("SELECT COUNT(*)::text AS n FROM relay_registrations");
    return Number(r.rows[0]!.n);
  };

  it("a CHAINED STORE WRITE inside the transaction does not survive the rollback", async () => {
    /**
     * THE EXACT SHAPE THAT WAS BROKEN. `registerRelay` goes through `insertWithChain` with no
     * external client, so the store opens what it believes is its own transaction. Before the fix
     * that BEGIN/COMMIT ran on the caller's connection and committed the row; measured, the count
     * went 11 → 12 across a rollback.
     *
     * Asserting the COUNT rather than the absence of one id: a store write that committed leaves a
     * row whatever its id, and the count is what a later `verifyChain` over the whole table sees.
     */
    const before = await countRelays();

    await inRolledBackTxn(pool, async (txn) => {
      const store = new PgDirectoryStore(txn, silentLogger());
      await store.registerRelay({
        relayId: randomUUID().replace(/-/g, ""),
        publicKeyHex: "c".repeat(64),
        region: "us-east-1",
      });
      // Visible INSIDE the transaction — otherwise the test would pass against a helper that
      // silently discarded the write, which is a different bug with the same green.
      const inside = await txn.query<{ n: string }>(
        "SELECT COUNT(*)::text AS n FROM relay_registrations",
      );
      expect(Number(inside.rows[0]!.n)).toBe(before + 1);
    });

    expect(
      await countRelays(),
      "a chained store write inside inRolledBackTxn survived the rollback — the helper is " +
        "committing, and every fixture that trusts it has been writing to the real database",
    ).toBe(before);
  });

  it("a TRUNCATE inside the transaction does not survive the rollback", async () => {
    // The most destructive case, and the one `persist-004` has been doing on every run:
    // `TRUNCATE` is transactional in Postgres, so it is safe inside a transaction that really rolls
    // back — and catastrophic inside one that does not.
    //
    // SEEDS ITS OWN ROW. The first version asserted `before > 0` and relied on an earlier test
    // having left one — which failed on a freshly reset database, correctly: a truncate test
    // against an empty table proves nothing, and the assertion caught exactly that. Depending on
    // sibling tests for state is the same class of fragility this whole unit removed from the
    // fixtures.
    // Through the CHAINED WRITER, not a raw INSERT with a literal chain_hash — seeding this test
    // with a hole would be this unit's own subject matter committed inside the unit.
    await new PgDirectoryStore(pool, silentLogger()).registerRelay({
      relayId: randomUUID().replace(/-/g, ""),
      publicKeyHex: "f".repeat(64),
      region: "us-west-2",
    });
    const before = await countRelays();
    expect(before, "the seed row is the thing the truncate must fail to destroy").toBeGreaterThan(0);

    await inRolledBackTxn(pool, async (_txn, client) => {
      await client.query("TRUNCATE relay_registrations CASCADE");
      const inside = await client.query<{ n: string }>(
        "SELECT COUNT(*)::text AS n FROM relay_registrations",
      );
      expect(Number(inside.rows[0]!.n)).toBe(0);
    });

    expect(
      await countRelays(),
      "a TRUNCATE inside inRolledBackTxn survived — this is how a fixture empties a hash-chained " +
        "table for every other suite in the run",
    ).toBe(before);
  });

  it("a raw INSERT on the client still does not survive", async () => {
    // The path that always worked, kept so the fix cannot regress it while fixing the store path.
    const before = await countRelays();
    await inRolledBackTxn(pool, async (_txn, client) => {
      await client.query(
        `INSERT INTO relay_registrations (relay_id, public_key_hex, region, chain_hash)
         VALUES ($1, $2, $3, $4)`,
        [randomUUID().replace(/-/g, ""), "d".repeat(64), "eu-central-1", ""],
      );
    });
    expect(await countRelays()).toBe(before);
  });

  it("the body's own error still rolls back, and still propagates", async () => {
    // `inRolledBackTxn` rolls back in a `finally`, so a failing assertion must leave no more behind
    // than a passing one — and must still fail the test rather than being swallowed by the shim.
    const before = await countRelays();
    await expect(
      inRolledBackTxn(pool, async (txn) => {
        const store = new PgDirectoryStore(txn, silentLogger());
        await store.registerRelay({
          relayId: randomUUID().replace(/-/g, ""),
          publicKeyHex: "e".repeat(64),
          region: "ap-northeast-1",
        });
        throw new Error("body failed after a chained write");
      }),
    ).rejects.toThrow("body failed after a chained write");
    expect(await countRelays()).toBe(before);
  });
});
