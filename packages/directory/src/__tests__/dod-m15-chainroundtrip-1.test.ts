/**
 * DOD-M15-CHAINROUNDTRIP-1 — a chained row hashes what the database will actually return.
 *
 * ─── The class ─────────────────────────────────────────────────────────────────────────────────
 *
 * `insertWithChain` hashes the record the CALLER supplies. `verifyChain` hashes `SELECT *`. Where a
 * column's stored type round-trips to a different JavaScript value, those two serializations differ
 * and the row **can never verify** — no tamper, no deletion, no fixture involved.
 *
 * Two instances were found by measuring every chained table after a fully green suite:
 *
 *   sessions            BREAK at 6   — `uuid`, written as undashed hex, returned dashed
 *   seal_notarizations  BREAK at 1   — `bytea`, written as Uint8Array, returned as a Buffer
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

    const result = await store.verifyChain("seal_notarizations");
    expect(
      result.valid,
      `seal_notarizations does not verify after a write through the production path (break at ` +
        `${String(result.breakAtSequence)}). A bytea column round-trips as a Buffer; the value ` +
        `hashed at insert was a Uint8Array.`,
    ).toBe(true);
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
    const tables = [
      "connection_requests", "conversation_seals", "conversation_attestations",
      "conversation_participation", "notification_events", "seal_notarizations",
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
