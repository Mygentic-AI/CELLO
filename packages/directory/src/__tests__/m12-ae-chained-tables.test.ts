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
import { encodeTierARecord, SEAL_NOTARIZATIONS_SPEC } from "../ae-table-encoders.js";

/** Records what the store did, so the test can tell the chain path from the generic INSERT path. */
function harness() {
  const queries: string[] = [];
  const chainCalls: Array<{ table: string; columns: string[]; values: unknown[] }> = [];
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
    insertWithChain: async (table: string, _record: unknown, columns: string[], values: unknown[]) => {
      chainCalls.push({ table, columns, values });
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
  it("both chain-backed tables are in the sync registry", () => {
    const { pool, chainWriter } = harness();
    const store = new PgAeStore(pool, chainWriter);
    expect(store.tierATables()).toEqual([
      "agent_profiles",
      "agent_revocations",
      "user_accounts",
      "seal_notarizations",
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

  it("refuses the chain tables when no chain writer was injected, rather than writing them unchained", async () => {
    // ABSENT IS NOT FINE. A store built without the writer must not silently fall back to the generic
    // INSERT — that is precisely the advertised-but-unappliable state this unit exists to avoid.
    const { pool } = harness();
    const store = new PgAeStore(pool);
    const body = sealBody("ac".repeat(16));
    const { hash } = encodeTierARecord(SEAL_NOTARIZATIONS_SPEC, body);
    await expect(store.applyTierA("seal_notarizations", [{ hash, body }])).rejects.toThrow(
      /chain writer/i,
    );
  });

  it("still refuses the share table", async () => {
    const { pool, chainWriter } = harness();
    const store = new PgAeStore(pool, chainWriter);
    await expect(store.serveTierA("agent_key_shares", ["x"])).rejects.toThrow(/unknown Tier-A table/);
  });
});
