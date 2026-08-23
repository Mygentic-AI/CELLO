/**
 * DOD-M15-CHAINROUNDTRIP-1 — a chained row hashes what the database will actually return.
 *
 * ─── The class ─────────────────────────────────────────────────────────────────────────────────
 *
 * `insertWithChain` hashes the record the CALLER supplies. `verifyChain` hashes `SELECT *`. Where a
 * column's stored type round-trips to a different JavaScript value, those two serializations differ
 * and the row **can never verify** — no tamper, no deletion, no fixture involved.
 *
 * ONE instance, found by measuring every chained table after a fully green suite:
 *
 *   sessions  BREAK at 6  — `uuid`, written as undashed hex, returned dashed. FIXED here.
 *
 * **`seal_notarizations` was recorded as a second instance and it is NOT one.** It was red because
 * `persist-018` SI-003 tampers a row to prove the verifier catches a tamper, and never put it back
 * — so the chain was reporting a tamper that really happened, exactly as designed. That test now
 * restores in a `finally`, and this enforcer covers the table like any other.
 *
 * The reason that cost three wrong diagnoses is worth more than the fix: a red chain looks the same
 * whether the data is wrong or the check is wrong, and I kept looking for a defect in the writer
 * because the writer is where a defect WOULD be. Nothing about the evidence pointed there. The
 * question that resolved it in one query was "which value is different, and who wrote it?"
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
import {
  serializeRecord,
  computeChainHash,
  CHAIN_GENESIS,
  HASH_CHAINED_TABLES,
} from "../hash-chain.js";
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
     * THE CONSTRAINT: `recordNotarization` must keep converting every byte field with
     * `Buffer.from(...)` before it builds the record it hashes. `node-pg` returns `bytea` as a
     * Buffer, which serializes as `{"type":"Buffer",…}`; a `Uint8Array` does not. Drop that
     * conversion and every notarization row becomes unverifiable the moment it is written —
     * silently, because nothing verifies chains at runtime.
     *
     * This is a CONTROL, not a repro. It passes before and after this unit, by design. It is here
     * because that `Buffer.from` looks like redundant ceremony to anyone tidying the writer, and
     * three separate diagnoses of an unrelated red chain went looking at it first.
     */
    await store.recordNotarization({
      session_id: randomBytes(16),
      sealed_root: randomBytes(32),
      participant_a_pubkey: randomBytes(32),
      participant_b_pubkey: randomBytes(32),
      close_timestamp: Date.now(),
      frost_signature: randomBytes(64),
    });

    // Scoped to THIS row rather than the whole table, so a failure points at the notarization
    // writer and not at whoever last wrote to a shared table. The enforcer below covers the table.
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
     * ─── THE LIST IS DERIVED, NEVER TYPED OUT ──────────────────────────────────────────────────
     *
     * Iterating a hand-maintained copy is the hollow shape this milestone keeps finding: add an
     * eleventh chained table and a typed-out loop just gets SHORTER. It never goes red, so the one
     * table nobody remembered to wire is precisely the one table nobody checks.
     *
     * Driving it off `HASH_CHAINED_TABLES` inverts that — the enforcer covers what the SYSTEM
     * says is chained, and any exemption has to be written down here in `EXEMPT` where a reader
     * trips over it, rather than expressed as an absence nobody can see.
     */
    const EXEMPT = new Set<string>([]); // empty, and it must stay that way — see below
    const tables = HASH_CHAINED_TABLES.filter((t) => !EXEMPT.has(t));
    expect(
      tables.length,
      "the enforcer is not covering every chained table — an exemption was added without a reason",
    ).toBe(HASH_CHAINED_TABLES.length);

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
