/**
 * M12 `DOD-INV-SHARES-LOCAL` — a FROST share never transits between nodes by ANY mechanism.
 *
 * ─── Why this file exists ────────────────────────────────────────────────────────────────────────
 * Anti-entropy is the one subsystem in M12 whose whole job is to move rows between nodes over an
 * authenticated peer connection. It is therefore the only plausible mechanism by which a share
 * could leave the node that dealt it. The invariant currently holds — but until this file it held
 * because nobody had added `agent_key_shares` to a spec list, which is a fact about the present,
 * not a property of the design.
 *
 * The exfiltration path is worth naming precisely, because it is not the obvious one. `planRound`
 * iterates the **peer's** advertisement and pulls any table whose digest differs, treating a table
 * it does not track as "local digest over the empty set" (`ae-round.ts:63-70`). So the pull side is
 * deliberately open by design. That is safe ONLY because the wire-reachable store methods resolve
 * the table name through a closed registry first. The dangerous frame is not a poisoned record —
 * it is a peer simply ASKING:
 *
 *     ae_pull_a { table: "agent_key_shares", hashes: [...] }   →  serveTierA("agent_key_shares", …)
 *
 * If that resolved, an authenticated peer would read every share this node holds with one frame,
 * and authentication is not honesty (`pg-ae-store.ts` WIRE-INPUT DISCIPLINE). The registry lookup
 * throwing is the entire defense, so it is what gets asserted here — on every wire-reachable
 * entry point, not just the one that looks scariest.
 *
 * ─── Why the pool throws ─────────────────────────────────────────────────────────────────────────
 * Every test injects a pool whose `query` throws. A test that only asserted "the call rejects"
 * would pass even if the refusal happened AFTER a `SELECT … FROM agent_key_shares` had already
 * run — which, on the serve path, is the leak. Asserting the rejection names the unknown table
 * rather than the pool proves the refusal precedes any database access.
 */

import { describe, it, expect } from "vitest";
import type pg from "pg";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PgAeStore } from "../pg-ae-store.js";
import { TIER_A_SPECS } from "../ae-table-encoders.js";
import { TIER_B_SPECS } from "../ae-mutable-version.js";

/** The table and column that must never cross the wire. Schema names, so they are literals here. */
const SHARE_TABLE = "agent_key_shares";
const SHARE_COLUMN = "encrypted_share";

/**
 * A pool that fails loudly if it is ever reached. Any test whose rejection mentions THIS message
 * has proven the opposite of what it set out to prove.
 */
const forbiddenPool = {
  query: () => {
    throw new Error("POOL REACHED — the table name was not validated before the query");
  },
  connect: () => {
    throw new Error("POOL REACHED — the table name was not validated before the query");
  },
} as unknown as pg.Pool;

describe("DOD-INV-SHARES-LOCAL: the share table is unreachable through anti-entropy", () => {
  const store = new PgAeStore(forbiddenPool);

  it("the sync set is a CLOSED allowlist, and the share table is not in it", () => {
    // Allowlist, not a denylist: a new table added to either tier fails this assertion and forces
    // a deliberate decision + an audit of whether it may leave the node. A denylist would let the
    // next table in silently and only catch the one name someone thought to forbid.
    expect(store.tierATables()).toEqual(["agent_profiles", "agent_revocations"]);
    expect(store.tierBTables()).toEqual(["agent_suspensions", "agent_presence"]);

    // The specs are the source the registry is built from, and they currently declare TWO MORE
    // Tier-A tables than the store implements: user_accounts and seal_notarizations need the
    // canonical chain writer (`insertWithChain`) and were left out deliberately rather than
    // advertised-but-unappliable (see pg-ae-store.ts "Scope"). Nothing consumes TIER_A_SPECS at
    // runtime — the registry is the only wire path — so the gap is a missing feature, not a
    // half-wired one.
    //
    // It is asserted rather than ignored because the divergence has a consequence that is easy to
    // state wrongly: **seal receipts do not replicate between directories.** Any design that
    // assumes a receipt can be read from a directory other than the one that recorded it is
    // building on a table that does not sync yet. When the chain-writer unit lands, this assertion
    // fails and forces both the registry list above and that assumption to be revisited together.
    const specTables = [...TIER_A_SPECS.map((s) => s.table), ...TIER_B_SPECS.map((s) => s.table)];
    expect(specTables).not.toContain(SHARE_TABLE);

    const served = [...store.tierATables(), ...store.tierBTables()];
    // Nothing is served that was never specced — that direction WOULD be a half-wiring.
    expect(served.filter((t) => !specTables.includes(t))).toEqual([]);
    // And the pending direction is exactly the two chain-backed tables, nothing else.
    expect(specTables.filter((t) => !served.includes(t)).sort()).toEqual([
      "seal_notarizations",
      "user_accounts",
    ]);
  });

  /**
   * Every method an inbound AE frame can reach with a peer-supplied table name. `ae_pull_a` and
   * `ae_pull_b` (→ serveTierA/serveTierB) are the read paths and therefore the exfiltration risk;
   * `ae_state_req` (→ the digest/hash/version methods) leaks shape; applyTierA/B are the write
   * paths and would let a peer INJECT a forged share row. All five reach a peer-controlled string.
   */
  const wireReachable: ReadonlyArray<[string, (t: string) => Promise<unknown>]> = [
    ["serveTierA (ae_pull_a — the read path)", (t) => store.serveTierA(t, ["deadbeef"])],
    ["serveTierB (ae_pull_b — the read path)", (t) => store.serveTierB(t, ["some-key"])],
    ["tierARecordHashes (ae_state_req)", (t) => store.tierARecordHashes(t)],
    ["tierBVersions (ae_state_req)", (t) => store.tierBVersions(t)],
    ["tierATableDigest (ae_state_req)", (t) => store.tierATableDigest(t)],
    ["tierBTableDigest (ae_state_req)", (t) => store.tierBTableDigest(t)],
    ["applyTierA (the write path)", (t) => store.applyTierA(t, [{ hash: "x", body: {} }])],
    ["applyTierB (the write path)", (t) => store.applyTierB(t, [{ key: "k", body: {} }])],
  ];

  for (const [name, call] of wireReachable) {
    it(`${name} refuses '${SHARE_TABLE}' before touching the database`, async () => {
      await expect(call(SHARE_TABLE)).rejects.toThrow(
        // Names the unknown table — NOT the pool. If the pool were reached, the message would be
        // "POOL REACHED" and this assertion fails, which is the leak surfacing as a red test.
        new RegExp(`unknown Tier-[AB] table '${SHARE_TABLE}'`),
      );
    });
  }

  it("refusal is generic, not a special case carved out for the share table", async () => {
    // If the guard were `if (table === "agent_key_shares") throw`, this invariant would rot the
    // moment shares moved to a differently-named table. The registry refuses everything it does
    // not know, so a renamed share table is still refused.
    for (const [, call] of wireReachable) {
      await expect(call("agent_key_shares_v2")).rejects.toThrow(/unknown Tier-[AB] table/);
    }
  });

  it("no anti-entropy module mentions the share table or its ciphertext column", () => {
    // The registry is the runtime defense; this is the design defense. An AE module that names the
    // share table at all is either syncing it or about to, and that intent should fail here first.
    // Bounded to the AE modules deliberately: encrypted-share-store.ts and share-store.ts MUST
    // name them, and the backup script may (DOD-INV-SHARES-LOCAL's own carve-out for the node's
    // own encrypted backup).
    const srcDir = join(import.meta.dirname, "..");
    const aeModules = readdirSync(srcDir).filter(
      (f) => (f.startsWith("ae-") || f.startsWith("anti-entropy") || f === "pg-ae-store.ts") && f.endsWith(".ts"),
    );
    expect(aeModules.length).toBeGreaterThan(5); // the glob still matches something

    const offenders = aeModules.filter((f) => {
      // Strip this file's own reasoning out of the equation by reading only the module sources.
      const body = readFileSync(join(srcDir, f), "utf8");
      return body.includes(SHARE_TABLE) || body.includes(SHARE_COLUMN);
    });
    expect(offenders, `AE modules naming the share table/column: ${offenders.join(", ")}`).toEqual([]);
  });
});
