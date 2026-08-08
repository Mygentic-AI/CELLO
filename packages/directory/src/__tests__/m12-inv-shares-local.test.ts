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
    expect(store.tierATables()).toEqual([
      "user_accounts",
      "agent_profiles",
      // V59. The agent↔account binding as an append-only fact, because the mutable column form
      // (`agent_profiles.account_id`) is excluded from Tier A by construction and so never
      // replicated — which is why the kill switch refused an operator's own agents on the two nodes
      // that did not register them. Both columns are already published facts about a binding the
      // operator created; neither is key material.
      "agent_account_links",
      // V60. The email↔account binding, for the same reason: the column form on `user_accounts` is
      // nullable and set after INSERT, so it is excluded from that hash-chained table's set and had
      // never replicated — which is why sign-in worked only against the node that registered the
      // operator. A SHA-256 stub, never an address; the directory holds no PII.
      "account_email_stubs",
      "agent_revocations",
      "capability_claim_codes",
      "authorized_issuers",
      "signal_records",
      // V62. The revocation FACT. The tombstone in signal_records already crossed — stripped of
      // is_tombstone and the revoker, so it landed looking ACTIVE and polluted the effective view's
      // aggregation. Carries a hash, a revoker pubkey and a signature over the revocation: all three
      // are public by construction and re-verifiable by the receiving node.
      "signal_revocations",
      "submission_results",
      "relay_registrations",
      "directory_nodes",
      "conversation_seals",
      // V61. The seal's CHILDREN, which were never considered rather than weighed and excluded:
      // a node receiving a seal learned neither who took part nor what was attested, and analytics
      // derives the track record from exactly these. Live: 22 rows on one node, 38 on another.
      "conversation_participation",
      "conversation_attestations",
      "seal_notarizations",
      // ── V58 `seal_certificate_fields` — ADDED 2026-08-07, DOD-TERMINAL-STATE-DIVERGENCE-1 ──
      //
      // MAY IT LEAVE THE NODE? Yes, and it must, or the feature does not exist. A client that
      // missed the `session_sealed` push reconnects to whichever node it picks and asks THAT one;
      // if these rows lived only on the node that adjudicated the seal, the pull would answer
      // "not found" from the other two — the same per-node-state failure as the notification queue
      // this line exists to route around.
      //
      // AUDIT OF THE COLUMNS, which is what this assertion is for:
      //   session_id, seal_type — already replicated verbatim in seal_notarizations.
      //   leaf_count            — the sealed tree's size; already on the session_sealed frame sent
      //                           to BOTH participants.
      //   signer_pubkey         — the initiator's PRIMARY (group) public key. Public by
      //                           construction: it is in agent_profiles (replicated) and on the
      //                           wire in every session assignment.
      //   legibility            — receipt-not-assent, per-party frontiers, attestation modes.
      //                           Already pushed to both parties and readable from the sealed
      //                           receipt.
      //
      // NO key material, NO share, NO message content, NO PII. Every value is already published to
      // both participants and is covered by a signature the recipient re-verifies, so replicating
      // it grants a node nothing it could not already obtain — and grants a client the ability to
      // verify a seal it was never told about.
      "seal_certificate_fields",
    ]);
    expect(store.tierBTables()).toEqual(["agent_suspensions", "agent_presence"]);

    // Registry and specs now agree EXACTLY. They did not until DOD-AE-CHAINED-TABLES-1: the specs
    // declared four Tier-A tables and the registry served two, so seal receipts existed only on the
    // directory that recorded them. This assertion is what made that divergence impossible to
    // misstate, and it is kept in its strict form so the next divergence in EITHER direction fails
    // here — a spec with no registry entry (a table that cannot be applied) and a registry entry with
    // no spec (a table leaving the node with no audited column list) are both defects.
    const specTables = [...TIER_A_SPECS.map((s) => s.table), ...TIER_B_SPECS.map((s) => s.table)];
    expect(specTables).not.toContain(SHARE_TABLE);
    expect([...store.tierATables(), ...store.tierBTables()].sort()).toEqual(specTables.sort());
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
