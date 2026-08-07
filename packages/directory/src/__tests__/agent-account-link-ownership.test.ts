/**
 * The kill switch must authorize from the REPLICATED link, not the un-replicated column.
 *
 * ─── What was broken ────────────────────────────────────────────────────────────────────────────
 * Pausing or burning an agent first asks "does this agent belong to this account?". That question
 * was answered from `agent_profiles.account_id` — a MUTABLE column, and Tier A replicates only
 * immutable columns by construction, so the link has never crossed between nodes. The M12 design
 * assigned it "Tier B rules"; Tier B was built for two tables out of eight.
 *
 * Measured on the live fleet 2026-08-07, one operator with three agents:
 *   gcp-use1  0 linked      gcp-usc1  2 linked      gcp-euw1  1 linked
 *
 * So a node without the link answers `403 not_owner` — a DELIBERATE refusal, which the client
 * correctly does NOT fail over (a refusal is not a transport fault). Two of that operator's three
 * agents could not be paused, and the error said they were not theirs.
 *
 * V59 moves the binding into `agent_account_links`, an append-only fact whose columns are all
 * immutable, so Tier A carries it with no merge rule — the same shape that has always worked for
 * `agent_revocations`.
 */

import { describe, it, expect } from "vitest";
import { isAgentOwnedByAccount } from "../agent-write-repository.js";

const AGENT = "06c94560f8ff0d0d8d2afea54da9489a";
const ACCOUNT = "bd9fb2a2-8b94-4a59-8624-ab2658eb37a7";

/** A pool stub that records the SQL it was asked to run and answers from a fixed row set. */
function poolFor(opts: { linkRows?: number; legacyRows?: number }) {
  const sql: string[] = [];
  return {
    sql,
    query: async (text: string) => {
      sql.push(text.replace(/\s+/g, " ").trim());
      if (/agent_account_links/.test(text)) return { rowCount: opts.linkRows ?? 0, rows: [] };
      return { rowCount: opts.legacyRows ?? 0, rows: [] };
    },
  };
}

describe("isAgentOwnedByAccount — the kill switch's authorization", () => {
  it("authorizes from agent_account_links", async () => {
    const pool = poolFor({ linkRows: 1 });

    expect(await isAgentOwnedByAccount(pool as never, AGENT, ACCOUNT)).toBe(true);
    expect(
      pool.sql.some((q) => /agent_account_links/.test(q)),
      `must consult the replicated link table; ran: ${pool.sql.join(" | ")}`,
    ).toBe(true);
  });

  it("does NOT read agent_profiles.account_id — the column that never replicates", async () => {
    // THE POINT OF THE CHANGE. Reading the column would reproduce the live failure exactly: correct
    // on the registering node, `not_owner` on the other two, and no failover because the refusal is
    // deliberate. Asserting the query rather than the answer is what pins it — both sources return
    // "true" on the node that happens to hold the row, so a result-only assertion passes either way.
    const pool = poolFor({ linkRows: 1, legacyRows: 1 });

    await isAgentOwnedByAccount(pool as never, AGENT, ACCOUNT);

    expect(
      pool.sql.some((q) => /FROM agent_profiles/i.test(q)),
      `must not authorize from agent_profiles; ran: ${pool.sql.join(" | ")}`,
    ).toBe(false);
  });

  it("REFUSES when the link is absent, even if the legacy column still has it", async () => {
    // A node mid-rollout, or one whose backfill has not run. Refusing is correct — and it is what
    // the client already handles by not failing over. Silently falling back to the column would put
    // the un-replicated answer back in the authorization path, which is the whole defect.
    const pool = poolFor({ linkRows: 0, legacyRows: 1 });

    expect(await isAgentOwnedByAccount(pool as never, AGENT, ACCOUNT)).toBe(false);
  });

  it("refuses an agent that belongs to nobody", async () => {
    expect(await isAgentOwnedByAccount(poolFor({}) as never, AGENT, ACCOUNT)).toBe(false);
  });

  it("scopes by BOTH agent and account, never by agent alone", async () => {
    // Scoping is derived from this check, not from a request field: a caller asserting account A
    // must not be able to write to account B's agent. If the query dropped the account predicate
    // the row would exist for any agent id and every caller would be an owner.
    const pool = poolFor({ linkRows: 1 });

    await isAgentOwnedByAccount(pool as never, AGENT, ACCOUNT);

    const q = pool.sql.find((x) => /agent_account_links/.test(x)) ?? "";
    expect(q).toMatch(/agent_id\s*=\s*\$1/);
    expect(q).toMatch(/account_id\s*=\s*\$2/);
  });
});
