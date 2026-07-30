/**
 * M12 `DOD-AE-STORE-1` — the pg-backed `AeStoreView` must reproduce the semantics the convergence
 * proof used.
 *
 * ─── Why this is the test that matters for this unit ────────────────────────────────────────────
 * The convergence proof runs against an in-memory store. If the Postgres store produces a DIFFERENT
 * record hash for the same logical row, the proof describes something nobody runs: two nodes holding
 * identical data would advertise different content addresses, see permanent divergence, and pull each
 * other's rows forever without ever converging. Nothing would error — the round would just never
 * settle.
 *
 * The DoD names the exact trap: **`agent_revocations.signature` is BYTEA and MUST be hex-encoded in
 * the SELECT**, because pg returns a Buffer and no type-parser override is installed. A Buffer and its
 * hex string are different values to `recordHash`, so getting this wrong is invisible in every
 * in-memory test and fatal on the wire. That is why this test asserts against a REAL database rather
 * than a fake pool: a fake returns whatever the test author already believed.
 *
 * Gated on `CELLO_ENV=local` like the other `.live.test.ts` files (docker-compose Postgres on 5433).
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import pg from "pg";
import { PgAeStore } from "../pg-ae-store.js";
import { encodeTierARecord, AGENT_REVOCATIONS_SPEC } from "../ae-table-encoders.js";
import { computeTableDigest } from "../set-reconciliation.js";
import { SEAL_NOTARIZATIONS_SPEC } from "../ae-table-encoders.js";
import { PgDirectoryStore } from "../adapters/pg-directory-store.js";
import { computeChainHash, serializeRecord, CHAIN_GENESIS } from "../hash-chain.js";
import type { Logger } from "@cello-protocol/interfaces";

const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as unknown as Logger;

const DB_URL = process.env.DATABASE_URL ?? "postgresql://postgres:dev@localhost:5433/cello_dev";
const describeLive = process.env.CELLO_ENV === "local" ? describe : describe.skip;

/** Distinct enough not to collide with other suites sharing this database. */
const AGENT = "aestoreparity" + "0".repeat(51);
const EPOCH = `${AGENT}:epoch:1`;
const SIG_HEX = "ab".repeat(64);

describeLive("DOD-AE-STORE-1: the pg store and the encoders agree on the record hash", () => {
  let pool: pg.Pool;
  let store: PgAeStore;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: DB_URL });
    store = new PgAeStore(pool);
  });
  afterAll(async () => { await pool.end(); });
  afterEach(async () => { await pool.query("DELETE FROM agent_revocations WHERE agent_id = $1", [AGENT]); });

  async function insertRevocation(): Promise<void> {
    await pool.query(
      `INSERT INTO agent_revocations (agent_id, epoch_id, reason, signature, revoked_at)
       VALUES ($1, $2, $3, decode($4,'hex'), $5)
       ON CONFLICT (agent_id) DO NOTHING`,
      [AGENT, EPOCH, "m12 ae-store parity probe", SIG_HEX, "1753900000000"],
    );
  }

  it("a BYTEA column read back through the store hashes as its HEX STRING, not as a Buffer", async () => {
    // The DoD's named trap. If tierASelectExpr stopped hex-encoding, pg would hand the encoder a
    // Buffer, recordHash would hash a different value, and this node's advertised hash for a row
    // every other node also holds would differ — permanent, silent non-convergence.
    await insertRevocation();

    const served = await store.serveTierA("agent_revocations", await store.tierARecordHashes("agent_revocations"));
    const row = served.find((r) => (r.body as Record<string, unknown>)["agent_id"] === AGENT);
    expect(row, "the inserted revocation must be served").toBeDefined();

    const body = row!.body as Record<string, unknown>;
    expect(typeof body["signature"], "signature must cross the wire as a string, never a Buffer").toBe("string");
    expect(body["signature"]).toBe(SIG_HEX);
    expect(Buffer.isBuffer(body["signature"])).toBe(false);
  });

  it("the hash the store ADVERTISES equals the hash the encoders compute for the same logical row", async () => {
    // ★ THE PARITY ASSERTION. This is what makes the in-memory convergence proof describe the
    // production store: same logical row, same content address, on both paths.
    await insertRevocation();

    const served = await store.serveTierA("agent_revocations", await store.tierARecordHashes("agent_revocations"));
    const row = served.find((r) => (r.body as Record<string, unknown>)["agent_id"] === AGENT)!;

    const expected = encodeTierARecord(AGENT_REVOCATIONS_SPEC, {
      agent_id: AGENT,
      epoch_id: EPOCH,
      reason: "m12 ae-store parity probe",
      signature: SIG_HEX,
      revoked_at: "1753900000000",
    });
    expect(row.hash).toBe(expected.hash);
    // And the store's own claimed hash agrees with a recomputation from the body it just served —
    // the same check applyTierA performs on the receiving side, so a mismatch here would mean a node
    // refuses its own peer's honest record.
    expect(encodeTierARecord(AGENT_REVOCATIONS_SPEC, row.body as never).hash).toBe(row.hash);
  });

  it("proves its own discriminating power: a Buffer signature hashes DIFFERENTLY from its hex string", () => {
    // Without this, the parity assertions above could be passing for a trivial reason and nobody would
    // know. Rather than temporarily breaking tierASelectExpr to revert-test it, this pins the fact the
    // whole unit rests on: the two encodings are NOT interchangeable to recordHash. If they ever
    // became equal, the parity assertions would be vacuous — and this test would go red first.
    const asHex = encodeTierARecord(AGENT_REVOCATIONS_SPEC, {
      agent_id: AGENT, epoch_id: EPOCH, reason: "m12 ae-store parity probe",
      signature: SIG_HEX, revoked_at: "1753900000000",
    });
    const asBuffer = encodeTierARecord(AGENT_REVOCATIONS_SPEC, {
      agent_id: AGENT, epoch_id: EPOCH, reason: "m12 ae-store parity probe",
      signature: Buffer.from(SIG_HEX, "hex") as never, revoked_at: "1753900000000",
    });
    expect(asBuffer.hash).not.toBe(asHex.hash);
    // And it is the hex form the store must produce — asserted above against a real SELECT.
  });

  it("the table digest is stable across reads — an unchanged table cannot look divergent", async () => {
    // Divergence detection is digest equality. A digest that varies between reads of unchanged data
    // (row order, a re-encoded column) makes every round see a difference and pull forever.
    await insertRevocation();
    const a = await store.tierATableDigest("agent_revocations");
    const b = await store.tierATableDigest("agent_revocations");
    expect(a).toBe(b);
    // And it matches a digest computed from the hashes the store itself lists.
    expect(a).toBe(computeTableDigest(await store.tierARecordHashes("agent_revocations")));
  });

  it("still refuses the share table against a real database", async () => {
    // SHARES-LOCAL holds on the live path too, not only against a fake pool.
    await expect(store.serveTierA("agent_key_shares", ["x"])).rejects.toThrow(/unknown Tier-A table/);
  });
});

describeLive("DOD-AE-STORE-1: Tier-B advertise and apply hash the SAME form", () => {
  let pool: pg.Pool;
  let store: PgAeStore;
  const AGENT_B = "aestoreparityb" + "0".repeat(50);

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: DB_URL });
    store = new PgAeStore(pool);
  });
  afterAll(async () => { await pool.end(); });
  afterEach(async () => { await pool.query("DELETE FROM agent_suspensions WHERE agent_id = $1", [AGENT_B]); });

  async function seedSuspension(): Promise<void> {
    await pool.query(
      `INSERT INTO agent_suspensions (agent_id, paused, burned, reason, authorized_by_account, suspension_seq, origin_node, updated_at)
       VALUES ($1, true, false, 'parity probe', $2, 5, 'gcp-usc1', now())
       ON CONFLICT (agent_id) DO NOTHING`,
      [AGENT_B, "00000000-0000-0000-0000-0000000000e2"],
    );
  }

  it("re-applying a row's OWN served body is a no-op", async () => {
    // Idempotence on the apply path: a body identical to what we hold must not report "changed",
    // or the node writes an UPDATE and re-reports every round — non-termination on the kill switch's
    // own table.
    //
    // HONEST LIMIT, because I checked: this does NOT detect the number/string split that
    // `toVersionRow` closes. Both sides of this comparison come from the merge form, so they agree
    // with each other whichever encoding they use — reverting `toVersionRow` leaves this green. The
    // split is self-consistent per path and has no symptom today; what it had was a trap, since the
    // correct cleanup of `rowToBody`'s lossy `Number()` is exactly the edit that detonates the merge.
    // The OBSERVABLE half of that finding is the type validator, covered by the next test.
    await seedSuspension();
    const advertised = await store.tierBVersions("agent_suspensions");
    const served = await store.serveTierB("agent_suspensions", [...advertised.keys()]);
    const mine = served.find((r) => r.key === AGENT_B);
    expect(mine, "the seeded suspension must be served").toBeDefined();

    expect(await store.applyTierB("agent_suspensions", [mine!]), "identical body must change nothing").toBe(0);
    // And the advertised version is unmoved, so the next round plans nothing for this key.
    expect((await store.tierBVersions("agent_suspensions")).get(AGENT_B)).toBe(advertised.get(AGENT_B));
  });

  it("REFUSES a Tier-B body whose suspension_seq is a string, instead of letting the peer win", async () => {
    // The kill-switch fail-open. With `suspension_seq: "5"` against a local `5`: the equality test
    // fails so the merge takes the higher-seq branch; `5 > "5"` is false so the PEER wins; and the
    // peer's `paused` is copied wholesale over ours — bypassing the equal-seq suspended-wins rule.
    // Authentication is not honesty, and a type is part of the value.
    await seedSuspension();
    const poisoned = {
      key: AGENT_B,
      body: {
        agent_id: AGENT_B, paused: false, burned: false, reason: "unpause",
        authorized_by_account: "00000000-0000-0000-0000-0000000000e2",
        suspension_seq: "5", origin_node: "gcp-euw1",
      },
    };
    await expect(store.applyTierB("agent_suspensions", [poisoned as never])).rejects.toThrow(
      /suspension_seq must be a finite integer/,
    );
    // The pause is still in force — the refusal must not have half-applied anything.
    const after = await pool.query<{ paused: boolean }>(
      "SELECT paused FROM agent_suspensions WHERE agent_id = $1", [AGENT_B],
    );
    expect(after.rows[0]?.paused, "a refused body must not clear the pause").toBe(true);
  });
});

describeLive("DOD-AE-STORE-1: the natural-key constraint names are REAL", () => {
  let pool: pg.Pool;
  beforeAll(() => { pool = new pg.Pool({ connectionString: DB_URL }); });
  afterAll(async () => { await pool.end(); });

  it("every naturalKeyConstraint exists in pg_constraint on its own table", async () => {
    // This is the test whose absence let the bug ship. The classifier previously substring-matched the
    // natural-key COLUMN against the constraint NAME — and Postgres names a primary key `<table>_pkey`,
    // so `"user_accounts_pkey".includes("account_id")` is false. Every ordinary duplicate was therefore
    // logged as an identity fork, and the real fork (user_accounts_phone_stub_hash_key) arrived in the
    // same words. Asserting the names against the live catalogue means a migration that renames one
    // goes red here instead of silently re-classifying every duplicate as an alarm.
    const expected: Array<[string, string]> = [
      ["agent_profiles", "agent_profiles_k_local_unique"],
      ["agent_revocations", "agent_revocations_pkey"],
      ["user_accounts", "user_accounts_pkey"],
      ["seal_notarizations", "seal_notarizations_session_seal_type_key"],
    ];
    for (const [table, constraint] of expected) {
      const r = await pool.query<{ n: string }>(
        `SELECT conname AS n FROM pg_constraint
          WHERE conrelid = $1::regclass AND conname = $2 AND contype IN ('p','u')`,
        [table, constraint],
      );
      expect(r.rows.length, `${table}: no unique/PK constraint named '${constraint}'`).toBe(1);
    }
  });

  it("the fork constraint is NOT the natural key on user_accounts", async () => {
    // The distinction the classifier exists to draw: phone_stub_hash is UNIQUE and is NOT the natural
    // key, so two nodes minting an account for one phone stub is a genuine identity fork. If this ever
    // became the natural key, the classifier would start calling forks convergence.
    const r = await pool.query<{ n: string }>(
      `SELECT conname AS n FROM pg_constraint
        WHERE conrelid = 'user_accounts'::regclass AND contype = 'u' AND conname = 'user_accounts_phone_stub_hash_key'`,
    );
    expect(r.rows.length, "the fork constraint must exist and be distinct from the PK").toBe(1);
  });
});

describeLive("DOD-AE-STORE-1: a chain containing an AE-APPLIED row still verifies", () => {
  let pool: pg.Pool;
  const SESSION = Buffer.from("ae".repeat(16), "hex");

  beforeAll(() => { pool = new pg.Pool({ connectionString: DB_URL }); });
  afterAll(async () => { await pool.end(); });
  afterEach(async () => { await pool.query("DELETE FROM seal_notarizations WHERE session_id = $1", [SESSION]); });

  it("applies a notarization through the REAL ChainWriter and its chain link recomputes", async () => {
    // The reviewer's highest-value gap, and he said so plainly: he traced this by hand from
    // TABLE_EXTRA_EXCLUDED and serializeRecord and concluded it holds, but "that is inference, not a
    // test, and a mismatch means an AE-replicated seal receipt makes the node's ENTIRE notarization
    // chain read as tampered." Every other chained-table test runs against a fake ChainWriter and a
    // pool returning no rows, so none of them proves the real writer accepts these columns, or that
    // what it writes still chains.
    //
    // The specific risk is representation drift between the two write paths: the AE path hands
    // Buffers decoded from wire hex and a BIGINT close_timestamp, while recordNotarization hands
    // Buffers and a number. If serializeRecord saw them differently, the chain would break at the
    // row AFTER this one and read as tamper-evidence firing.
    const store = new PgDirectoryStore(pool, silentLogger, "gcp-usc1", "us-central1");
    const aeStore = new PgAeStore(pool, store, silentLogger);

    const body = {
      session_id: SESSION.toString("hex"),
      seal_type: "bilateral",
      sealed_root: "bb".repeat(32),
      participant_a_pubkey: "cc".repeat(32),
      participant_b_pubkey: "dd".repeat(32),
      close_timestamp: "1753900000000",
      frost_signature: "ee".repeat(64),
    };
    const { hash } = encodeTierARecord(SEAL_NOTARIZATIONS_SPEC, body);
    expect(await aeStore.applyTierA("seal_notarizations", [{ hash, body }])).toBe(1);

    // Assert THIS ROW'S OWN LINK, not the whole table's validity.
    //
    // My first version verified the entire chain and asserted the break point had not moved. It was
    // hollow, and the revert test proved it: `verifyChain` reports only the FIRST break, and this
    // shared database already breaks at row 1 (other suites insert seal_notarizations directly,
    // bypassing insertWithChain). A pre-existing break therefore MASKS any break at the row this test
    // writes — reverting the hex→Buffer conversion left it green.
    //
    // The linkage check needs no clean prefix: recompute this row's chain hash from the row before it
    // and compare with what was stored. That is exactly what verifyChain does per row, scoped to the
    // one row whose provenance is anti-entropy.
    const all = (await pool.query<Record<string, unknown>>("SELECT * FROM seal_notarizations ORDER BY id")).rows;
    const idx = all.findIndex((r) => Buffer.from(r["session_id"] as Buffer).equals(SESSION));
    expect(idx, "the AE-applied row must be present").toBeGreaterThanOrEqual(0);
    const mine = all[idx]!;
    const prevHash = idx === 0 ? CHAIN_GENESIS : (all[idx - 1]!["chain_hash"] as string);

    // Recomputed from the row AS POSTGRES RETURNS IT — which is the whole point. If the writer hashed
    // a hex string while the column stores bytes, the read-back row re-serializes differently and this
    // is where it shows.
    const recomputed = computeChainHash(serializeRecord(mine, "seal_notarizations"), prevHash);
    expect(
      recomputed,
      "the AE-applied row's stored chain_hash does not match a recomputation from the persisted row — " +
        "an anti-entropy-replicated receipt would make this node's notarization chain read as tampered",
    ).toBe(mine["chain_hash"]);
  });
});
