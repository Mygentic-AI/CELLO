/**
 * M12 `DOD-AE-CHAINED-TABLES-1` — the two chain-backed Tier-A tables replicate.
 *
 * ─── Why they were absent ────────────────────────────────────────────────────────────────────────
 * `TIER_A_SPECS` declares four tables; the pg store's registry implemented two. `seal_notarizations`
 * and `user_accounts` are hash-chained, and `applyTierA`'s generic path is a plain
 * INSERT … ON CONFLICT DO NOTHING, which would write a row with no chain columns. They were left out
 * rather than advertised-but-unappliable — the honest choice, but it left a real gap: **a seal receipt
 * existed only on the directory that recorded it.** For a notary product that is the durability
 * property that matters.
 *
 * ─── The rule that makes this safe ──────────────────────────────────────────────────────────────
 * Chain columns are NODE-LOCAL. A node applying a replicated row recomputes `prev_hash`/`chain_hash`
 * against ITS OWN tip and never copies the origin's — otherwise two nodes' chains would have to agree
 * on ordering, which anti-entropy explicitly does not provide. `encodeTierARecord` already hashes only
 * `immutableColumns`, and no chain column is in either spec, so the content address is chain-free and
 * converges regardless of the order rows arrive in.
 */

import { describe, it, expect } from "vitest";
import type pg from "pg";
import { PgAeStore } from "../pg-ae-store.js";
import { encodeTierARecord, SEAL_NOTARIZATIONS_SPEC, USER_ACCOUNTS_SPEC, TIER_A_SPECS } from "../ae-table-encoders.js";
import { serializeRecord, HASH_CHAINED_TABLES } from "../hash-chain.js";

/** Records what the store did, so the test can tell the chain path from the generic INSERT path. */
function harness() {
  const queries: string[] = [];
  const chainCalls: Array<{
    table: string; record: Record<string, unknown>; columns: string[]; values: unknown[]; chainHashIndex: number;
  }> = [];
  const pool = {
    query: async (sql: string) => {
      queries.push(sql);
      return { rows: [], rowCount: 0 };
    },
    connect: async () => ({
      query: async (sql: string) => {
        queries.push(sql);
        return { rows: [], rowCount: 0 };
      },
      release: () => {},
    }),
  } as unknown as pg.Pool;

  const chainWriter = {
    insertWithChain: async (
      table: string, record: Record<string, unknown>, columns: string[], values: unknown[], chainHashIndex: number,
    ) => {
      chainCalls.push({ table, record, columns, values, chainHashIndex });
      return "deadbeef";
    },
  };
  return { pool, queries, chainCalls, chainWriter };
}

/** A notarization body carrying exactly the spec's immutable columns, hex for the BYTEA ones. */
function sealBody(sessionIdHex: string) {
  return {
    session_id: sessionIdHex,
    seal_type: "bilateral",
    sealed_root: "bb".repeat(32),
    participant_a_pubkey: "cc".repeat(32),
    participant_b_pubkey: "dd".repeat(32),
    close_timestamp: "1753900000000",
    frost_signature: "ee".repeat(64),
  };
}

describe("DOD-AE-CHAINED-TABLES-1: seal_notarizations and user_accounts replicate", () => {
  it("both chain-backed tables are in the registry, in FK-safe apply order", () => {
    // Order is asserted, not incidental: the engine applies Tier-A in registry order and design §3.3
    // requires accounts → profiles → (Tier-B) suspensions, each referencing the one before it. Inert
    // only while `account_id` stays out of AGENT_PROFILES_SPEC — and that spec gained a column one
    // commit before this one, so the ordering is pinned here rather than left to luck.
    const { pool, chainWriter } = harness();
    const store = new PgAeStore(pool, chainWriter);
    expect(store.tierATables()).toEqual([
      "user_accounts",
      "agent_profiles",
      "agent_revocations",
      "capability_claim_codes",
      "authorized_issuers",
      "signal_records",
      "submission_results",
      "relay_registrations",
      "directory_nodes",
      "conversation_seals",
      "seal_notarizations",
      // V58 — LAST, and the position is load-bearing like the rest of this list. The pull reads
      // seal_certificate_fields together with its seal_notarizations row and serves nothing unless
      // BOTH are present, so converging the notarization first means the intermediate state is
      // "not yet pullable" rather than "half a certificate".
      "seal_certificate_fields",
    ]);
  });

  it("applying a notarization goes through the CHAIN writer, not a bare INSERT", () => {
    // The distinction is the whole unit. A generic INSERT would produce a row with no chain columns —
    // present, readable, and outside the tamper-evident chain that is the reason the table exists.
    const { pool, chainCalls, queries, chainWriter } = harness();
    const store = new PgAeStore(pool, chainWriter);
    const body = sealBody("aa".repeat(16));
    const { hash } = encodeTierARecord(SEAL_NOTARIZATIONS_SPEC, body);

    return store.applyTierA("seal_notarizations", [{ hash, body }]).then((inserted) => {
      expect(inserted).toBe(1);
      expect(chainCalls).toHaveLength(1);
      expect(chainCalls[0]!.table).toBe("seal_notarizations");
      expect(chainCalls[0]!.columns).toContain("chain_hash");
      // No hand-rolled INSERT into the table on the side.
      expect(queries.filter((q) => /INSERT INTO seal_notarizations/i.test(q))).toEqual([]);
    });
  });

  it("wire-input discipline survives on the new path: a mismatched hash is refused", async () => {
    // applyTierA recomputes every record's hash from its body because an authenticated peer is not an
    // honest one. Routing through the chain writer must not quietly skip that.
    const { pool, chainCalls, chainWriter } = harness();
    const store = new PgAeStore(pool, chainWriter);
    await expect(
      store.applyTierA("seal_notarizations", [{ hash: "00".repeat(32), body: sealBody("ab".repeat(16)) }]),
    ).rejects.toThrow(/does not match its claimed hash/);
    expect(chainCalls, "nothing may be written when the content address is wrong").toHaveLength(0);
  });

  it("without a chain writer, REFUSES the table — it never writes it unchained", async () => {
    // It must not fall through to the generic INSERT: that writes the row outside the tamper-evident
    // chain that is the table's reason for existing. So it throws.
    //
    // Blast radius is the ENGINE's job, not this file's. An earlier version caught this here while
    // reasoning about `runAntiEntropyRound`'s control flow — a layering inversion that guarded one of
    // five throw sites in this file and that the in-memory store the convergence proof runs on did not
    // share. The engine now applies Tier-A table by table and always reaches Tier-B; that containment
    // is proven in anti-entropy-engine.test.ts ("a Tier-A failure does NOT stop Tier-B").
    const { pool, queries } = harness();
    const store = new PgAeStore(pool);
    const body = sealBody("ac".repeat(16));
    const { hash } = encodeTierARecord(SEAL_NOTARIZATIONS_SPEC, body);

    await expect(store.applyTierA("seal_notarizations", [{ hash, body }])).rejects.toThrow(/no ChainWriter/);
    expect(queries.filter((q) => /INSERT INTO seal_notarizations/i.test(q))).toEqual([]);
  });

  it("the chained record serializes IDENTICALLY to the locally-written one", async () => {
    // ★ THE ASSERTION THAT CARRIES THE CLAUSE. "Readable from another node with a locally-computed
    // chain" means the SAME logical row must feed the SAME bytes into the chain on both paths —
    // otherwise each node chains a different serialization of one receipt and no chain reproduces.
    //
    // It is what catches the two ways this can be silently wrong: skipping the hex→Buffer conversion
    // (pg would store the ASCII of the hex string), and mis-indexing chain_hash. Both pass every
    // other assertion in this file.
    const { pool, chainCalls, chainWriter } = harness();
    const store = new PgAeStore(pool, chainWriter);
    const sessionIdHex = "aa".repeat(16);
    const body = sealBody(sessionIdHex);
    const { hash } = encodeTierARecord(SEAL_NOTARIZATIONS_SPEC, body);
    await store.applyTierA("seal_notarizations", [{ hash, body }]);

    // What recordNotarization builds for the same notarization: Buffers, and a numeric timestamp.
    const localRecord: Record<string, unknown> = {
      session_id: Buffer.from(sessionIdHex, "hex"),
      sealed_root: Buffer.from("bb".repeat(32), "hex"),
      participant_a_pubkey: Buffer.from("cc".repeat(32), "hex"),
      participant_b_pubkey: Buffer.from("dd".repeat(32), "hex"),
      close_timestamp: 1753900000000,
      frost_signature: Buffer.from("ee".repeat(64), "hex"),
      seal_type: "bilateral",
      supersedes_notarization_id: null,
    };
    expect(serializeRecord(chainCalls[0]!.record, "seal_notarizations"))
      .toBe(serializeRecord(localRecord, "seal_notarizations"));
  });

  it("hands the chain writer real Buffers and a correctly-placed chain_hash slot", async () => {
    const { pool, chainCalls, chainWriter } = harness();
    const store = new PgAeStore(pool, chainWriter);
    const body = sealBody("aa".repeat(16));
    const { hash } = encodeTierARecord(SEAL_NOTARIZATIONS_SPEC, body);
    await store.applyTierA("seal_notarizations", [{ hash, body }]);

    const call = chainCalls[0]!;
    // chain_hash is a placeholder the writer overwrites — at the index it is told, or it overwrites
    // a real column instead (passing 0 would clobber session_id, and every other assertion survives).
    expect(call.chainHashIndex).toBe(call.columns.length - 1);
    expect(call.columns[call.chainHashIndex]).toBe("chain_hash");
    expect(call.values[call.chainHashIndex]).toBe("");
    for (const c of ["session_id", "sealed_root", "frost_signature"]) {
      const v = call.values[call.columns.indexOf(c)];
      expect(Buffer.isBuffer(v), `${c} must reach the writer as bytes, not the hex string`).toBe(true);
      expect((v as Buffer).toString("hex")).toBe(body[c as keyof typeof body]);
    }
  });

  it("refuses a record whose BYTEA column is not valid hex, instead of truncating it", async () => {
    // Buffer.from(str,"hex") does NOT throw: it stops at the first non-hex char and drops a trailing
    // odd nibble. The generic path hands hex to Postgres decode(), which RAISES — so without this the
    // chained path would be the quieter of the two. The wire hash is over the hex STRING, so a
    // truncated value passes the content-address check and the chain would then certify the
    // truncation: verifyChain returns valid on a corrupt receipt.
    const { pool, chainCalls, chainWriter } = harness();
    const store = new PgAeStore(pool, chainWriter);
    const body = { ...sealBody("aa".repeat(16)), frost_signature: "zz" + "ee".repeat(63) };
    const { hash } = encodeTierARecord(SEAL_NOTARIZATIONS_SPEC, body);
    await expect(store.applyTierA("seal_notarizations", [{ hash, body }])).rejects.toThrow(/not valid hex/);
    expect(chainCalls).toHaveLength(0);
  });

  it("user_accounts applies through the chain writer too", async () => {
    const { pool, chainCalls, chainWriter } = harness();
    const store = new PgAeStore(pool, chainWriter);
    const body = { account_id: "acct-123", phone_stub_hash: "f".repeat(64) };
    const { hash } = encodeTierARecord(USER_ACCOUNTS_SPEC, body);
    expect(await store.applyTierA("user_accounts", [{ hash, body }])).toBe(1);
    expect(chainCalls[0]!.table).toBe("user_accounts");
  });

  it("a unique violation on a NON-natural-key constraint is a fork, not convergence", async () => {
    // user_accounts.phone_stub_hash is UNIQUE and is NOT the natural key. Two nodes minting an account
    // for one phone stub is an identity FORK — exactly the divergence anti-entropy exists to surface.
    // Swallowing it as "a duplicate" discards the evidence silently.
    const { pool } = harness();
    const logged: Array<{ event: string; ctx: Record<string, unknown> }> = [];
    const store = new PgAeStore(pool, {
      insertWithChain: async () => {
        throw Object.assign(new Error("dupe"), { code: "23505", constraint: "user_accounts_phone_stub_hash_key" });
      },
    } as never, {
      info: () => {}, warn: () => {}, debug: () => {},
      error: (event: string, ctx: Record<string, unknown>) => logged.push({ event, ctx }),
    } as never);
    const body = { account_id: "acct-9", phone_stub_hash: "a".repeat(64) };
    const { hash } = encodeTierARecord(USER_ACCOUNTS_SPEC, body);

    expect(await store.applyTierA("user_accounts", [{ hash, body }])).toBe(0);
    const ev = logged.find((l) => l.event === "antientropy.apply.constraint_conflict");
    expect(ev, `expected a fork to be reported; got ${logged.map((l) => l.event).join(",")}`).toBeDefined();
    expect(ev!.ctx["constraint"]).toBe("user_accounts_phone_stub_hash_key");
  });

  it("still refuses the share table", async () => {
    const { pool, chainWriter } = harness();
    const store = new PgAeStore(pool, chainWriter);
    await expect(store.serveTierA("agent_key_shares", ["x"])).rejects.toThrow(/unknown Tier-A table/);
  });
});

/**
 * The registry must agree with `HASH_CHAINED_TABLES` — for EVERY table, not the two someone
 * remembered.
 *
 * Found live on 2026-08-03. `conversation_seals` and `relay_registrations` are both in
 * `HASH_CHAINED_TABLES` and both were registered for anti-entropy on 2026-07-31 WITHOUT the
 * `chained` flag, so `applyTierA` took the generic INSERT — the exact path the test above calls
 * "present, readable, and outside the tamper-evident chain". The specs correctly exclude
 * `chain_hash` (it is node-local), so the generic INSERT supplies no value for it, and the two DDLs
 * then diverge:
 *
 *   - `conversation_seals.chain_hash` is NOT NULL with no default → every apply RAISED. The table
 *     never converged: proven on the live fleet, where gcp-usc1 and gcp-euw1 each held 2 seals and
 *     gcp-use1 held 0 and could never acquire them. For a notary, a seal receipt that exists on
 *     only some directories is the durability property failing.
 *   - `relay_registrations.chain_hash` is `NOT NULL DEFAULT ''` (V19) → the apply SUCCEEDS and
 *     writes a row with an EMPTY chain hash, inside the table but outside its chain, with nothing
 *     raised anywhere. Latent rather than realised — all three nodes hold 0 rows today — and
 *     strictly the worse failure of the two, because only the loud one led anyone to look.
 *
 * Two one-off assertions would have closed those two tables and left the NEXT registration to
 * rediscover this. The invariant is what is tested: a hash-chained table that anti-entropy can
 * apply must refuse to be written unchained. Driving it from `HASH_CHAINED_TABLES` means adding a
 * table to that list, or to the AE set, is what extends the guard.
 */
describe("every hash-chained Tier-A table refuses to be written unchained", () => {
  const { pool: probePool, chainWriter: probeWriter } = harness();
  const aeTables = new PgAeStore(probePool, probeWriter).tierATables();
  const chainedAndReplicated = HASH_CHAINED_TABLES.filter((t) => aeTables.includes(t));

  it("the guard covers a real, non-empty intersection", () => {
    // Without this, a rename on either side would empty the list below and every case would vacuously
    // pass — a green suite asserting nothing at all.
    expect(chainedAndReplicated).toEqual(
      expect.arrayContaining(["user_accounts", "seal_notarizations", "conversation_seals", "relay_registrations"]),
    );
  });

  for (const table of chainedAndReplicated) {
    it(`${table}: no ChainWriter → refuses, and issues no bare INSERT`, async () => {
      const spec = TIER_A_SPECS.find((s) => s.table === table);
      expect(spec, `${table} is advertised by the store but has no exported spec`).toBeDefined();

      // A body carrying exactly the spec's immutable columns. Values are placeholders: the refusal
      // is reached before any column is interpreted, and the content address is recomputed from this
      // same body so it matches by construction.
      const body = Object.fromEntries(spec!.immutableColumns.map((c) => [c, "00"]));
      const { hash } = encodeTierARecord(spec!, body);

      const { pool, queries } = harness();
      const store = new PgAeStore(pool); // deliberately no chain writer

      await expect(store.applyTierA(table, [{ hash, body }])).rejects.toThrow(/no ChainWriter/);
      expect(
        queries.filter((q) => new RegExp(`INSERT INTO ${table}`, "i").test(q)),
        `${table} fell through to the generic INSERT — that writes it outside its own chain`,
      ).toEqual([]);
    });

    it(`${table}: WITH a ChainWriter → routes through it, chain_hash slot placed correctly`, async () => {
      // The case above is satisfied by an implementation that refuses EVERY table, ignoring the
      // `chained` flag entirely — refusal alone cannot tell "routed to the chain writer" from
      // "broken for everyone". This is the positive half, and it is in the loop rather than written
      // out for one table, because the whole point of the defect being fixed here is that per-table
      // assertions leave the next table to rediscover the bug.
      const spec = TIER_A_SPECS.find((s) => s.table === table)!;
      const body = Object.fromEntries(spec.immutableColumns.map((c) => [c, "00"]));
      const { hash } = encodeTierARecord(spec, body);

      const { pool, queries, chainCalls, chainWriter } = harness();
      const store = new PgAeStore(pool, chainWriter);

      expect(await store.applyTierA(table, [{ hash, body }])).toBe(1);
      expect(chainCalls).toHaveLength(1);
      expect(chainCalls[0]!.table).toBe(table);
      // chain_hash is appended as a placeholder the writer overwrites — so it must be LAST, and the
      // index handed to the writer must point at it. An off-by-one here chain-hashes the wrong slot
      // and every assertion except this one still passes.
      expect(chainCalls[0]!.columns.at(-1)).toBe("chain_hash");
      expect(chainCalls[0]!.chainHashIndex).toBe(chainCalls[0]!.columns.length - 1);
      expect(queries.filter((q) => new RegExp(`INSERT INTO ${table}`, "i").test(q))).toEqual([]);
    });
  }
});
