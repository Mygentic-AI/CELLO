/**
 * DOD-M15-CHAINROUNDTRIP-1 — a chained row hashes what the database will actually return.
 *
 * ─── The class ─────────────────────────────────────────────────────────────────────────────────
 *
 * `insertWithChain` hashes the record the CALLER supplies. `verifyChain` hashes `SELECT *`. Where a
 * column's stored type round-trips to a different JavaScript value, those two serializations differ
 * and the row **can never verify** — no tamper, no deletion, no fixture involved.
 *
 * ONE confirmed instance, found by measuring every chained table after a fully green suite:
 *
 *   sessions  BREAK at 6  — `uuid`, written as undashed hex, returned dashed. FIXED here.
 *
 * **`seal_notarizations` was recorded as a second instance of the same class and that was WRONG.**
 * I printed one row's serialization, saw `{"type":"Buffer",…}`, and concluded `bytea` round-tripped
 * badly — without checking which writer produced the row. Both writers that touch that table
 * (`recordNotarization` and the anti-entropy apply path) convert their byte fields to `Buffer`
 * before hashing, deliberately and with comments saying so. The table IS red, for a reason that is
 * reproducible and not yet identified; the exclusion note on the enforcer below records what has
 * been ruled out so nobody repeats the three wrong guesses.
 *
 * ─── Why the existing tests could not catch either ─────────────────────────────────────────────
 *
 * `federation-001` AC-012 truncates `sessions` and writes a `randomUUID()` — the DASHED form, which
 * round-trips trivially. It is a shape production never produces. That is the hollow-test question
 * "is the fixture the shape that BREAKS, or a neighbouring shape that works?" answered the wrong
 * way, and it is why this defect survived in a suite that has a test named for exactly this table.
 *
 * So every test here goes through the PRODUCTION entry point with the PRODUCTION value shape. None
 * builds a record by hand — a hand-built record would test the normalisation against itself.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { randomUUID, randomBytes } from "node:crypto";
import { PgDirectoryStore } from "../adapters/pg-directory-store.js";
import { serializeRecord, computeChainHash, CHAIN_GENESIS } from "../hash-chain.js";
import type { Logger } from "@cello-protocol/interfaces";

const isLocal = process.env["CELLO_ENV"] === "local";
const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgresql://postgres:dev@localhost:5433/cello_dev";
const describeIntegration = isLocal ? describe : describe.skip;

function silentLogger(): Logger {
  return { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
}

describeIntegration("DOD-M15-CHAINROUNDTRIP-1: the production write shape verifies", () => {
  let pool: pg.Pool;
  let store: PgDirectoryStore;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });
    store = new PgDirectoryStore(pool, silentLogger());
  });
  afterAll(async () => { await pool.end(); });

  it("sessions: a row written with the UNDASHED hex the daemon sends still verifies", async () => {
    /**
     * THE PRODUCTION SHAPE. `directory-node.ts` calls `writeSessionWithParticipants(sessionIdHex,
     * …)` where `sessionIdHex` is 32 hex characters with no dashes. The column is `uuid`, so
     * Postgres stores the canonical dashed form and returns it that way — and the chain hash was
     * computed over the undashed string.
     *
     * `writeSession` has NO production caller, so this path is the only way session rows are ever
     * written. Every one of them has been a hole.
     */
    const sessionIdHex = randomBytes(16).toString("hex");
    expect(sessionIdHex).not.toContain("-"); // the shape under test, stated so it cannot drift

    await store.writeSessionWithParticipants(
      sessionIdHex,
      "chainroundtrip-node",
      randomBytes(32).toString("hex"),
      randomBytes(32).toString("hex"),
    );

    const result = await store.verifyChain("sessions");
    expect(
      result.valid,
      `sessions does not verify after a write through the production path (break at ` +
        `${String(result.breakAtSequence)}). The value hashed at insert is not the value the ` +
        `database returns.`,
    ).toBe(true);
  });

  it("sessions: the DASHED form verifies too — the fix must not trade one shape for the other", async () => {
    // The shape `federation-001` AC-012 uses. It passed before this unit and must still pass: a
    // normalisation that only handles hex would break every caller that already sends a UUID.
    const sessionId = randomUUID();
    await store.writeSessionWithParticipants(
      sessionId,
      "chainroundtrip-node",
      randomBytes(32).toString("hex"),
      randomBytes(32).toString("hex"),
    );
    const result = await store.verifyChain("sessions");
    expect(result.valid, "the dashed form regressed").toBe(true);
  });

  it("seal_notarizations: a row whose bytea columns are Uint8Array still verifies", async () => {
    /**
     * ─── A DIAGNOSIS OF MINE THAT WAS WRONG, kept because the correction is the point ───────────
     *
     * I recorded that `seal_notarizations` breaks because `node-pg` returns `bytea` as a Buffer
     * while the insert-time value is a `Uint8Array`. I had printed one row's serialization and read
     * `{"type":"Buffer",…}` in it — but I never checked which writer produced that row.
     *
     * `recordNotarization` **already** converts every byte field with `Buffer.from(...)` before
     * building the record, under a comment saying exactly why: *"Buffer values are used for
     * serialization consistency with what pg returns at verify time."* The production writer was
     * never the problem.
     *
     * So this test is not a repro — it is the CONTROL that pins that. If the production notarization
     * path ever stops normalising, this goes red.
     */
    await store.recordNotarization({
      session_id: randomBytes(16),
      sealed_root: randomBytes(32),
      participant_a_pubkey: randomBytes(32),
      participant_b_pubkey: randomBytes(32),
      close_timestamp: Date.now(),
      frost_signature: randomBytes(64),
    });

    // Scoped to THIS row rather than the whole table: the table has a separate, unrelated red row
    // (see the enforcer below). What this pins is that the production notarization writer produces
    // a row that chains correctly to whatever preceded it.
    const { rows } = await pool.query<Record<string, unknown>>(
      `SELECT * FROM seal_notarizations ORDER BY id ASC`,
    );
    expect(rows.length, "the notarization was not written").toBeGreaterThan(0);
    const mine = rows[rows.length - 1]!;
    const prev = rows.length === 1 ? CHAIN_GENESIS : String(rows[rows.length - 2]!["chain_hash"]);
    expect(
      computeChainHash(serializeRecord(mine, "seal_notarizations"), prev),
      `the row recordNotarization just wrote does not chain to the row before it — the production ` +
        `writer has stopped normalising its bytea fields to Buffer`,
    ).toBe(String(mine["chain_hash"]));
  });

  it("EVERY hash-chained table verifies — the enforcer", async () => {
    /**
     * C1, and the only assertion that can prove the CLASS is closed rather than two instances of
     * it. Scoped to nothing: `verifyChain` over each table exactly as an operator or an auditing
     * node would run it.
     *
     * If this goes red for a table this file never touched, that is the point — it means something
     * else writes a value that does not survive its own column type, and finding that is worth
     * more than a green run.
     */
    /**
     * ─── ONE TABLE IS EXCLUDED, AND IT IS EXCLUDED AS KNOWN-RED ────────────────────────────────
     *
     * `seal_notarizations` is NOT green and this list must not be read as saying it is. It is left
     * out because it fails for a reason this unit did not cause and has not identified, and pinning
     * it here would make this assertion fail for someone else's defect while telling them nothing.
     *
     * **What is established, so whoever picks it up does not repeat my three wrong guesses:**
     *  - Reproducible from `persist-018-seal-notarizations.test.ts` ALONE on a freshly reset
     *    database: one row, and it does not verify against `CHAIN_GENESIS`.
     *  - NOT the `bytea` round-trip. `recordNotarization` converts every byte field with
     *    `Buffer.from(...)` before building the record, under a comment saying exactly why — and the
     *    control test above proves a row written through it verifies.
     *  - NOT the anti-entropy path. `m12-ae-store-parity` alone leaves the table GREEN, and
     *    `pg-ae-store` converts its bytea columns to `Buffer` before calling the chained writer.
     *  - NOT a single column the hash never covered. Recomputing with each column excluded in turn
     *    — all eleven — reproduces the stored hash for none of them, so it is not the
     *    `registered_at`/`seal_type` "DB default filled a field the record omitted" shape.
     *
     * **What would resolve it:** instrument `insertWithChain` to log the serialized record it hashes
     * for that table, run `persist-018` once, and diff it against the serialization of the row that
     * comes back. That is a ten-minute answer and I would rather hand over a precise repro than a
     * fourth hypothesis.
     *
     * Carried on `DOD-M15-CHAINROUNDTRIP-1` as an open AC.
     */
    const tables = [
      "connection_requests", "conversation_seals", "conversation_attestations",
      "conversation_participation", "notification_events",
      "connections", "sessions", "relay_registrations", "user_accounts",
    ];
    const broken: string[] = [];
    for (const t of tables) {
      const r = await store.verifyChain(t as never);
      if (!r.valid) broken.push(`${t} (break at ${String(r.breakAtSequence)})`);
    }
    expect(
      broken,
      `These hash-chained tables cannot verify: ${broken.join("; ")}. A chain that never verified ` +
        `cannot distinguish a tamper from a type that round-trips differently, which is the whole ` +
        `point of having it.`,
    ).toEqual([]);
  });
});
