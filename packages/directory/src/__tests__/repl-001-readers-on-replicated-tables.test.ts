/**
 * CELLO-REPL-001 — every identity lookup resolves through the REPLICATED table.
 *
 * ─── What these pin ────────────────────────────────────────────────────────────────────────────
 * V59/V60 moved two bindings out of mutable columns and into append-only tables that anti-entropy
 * actually carries. The tables are deployed, backfilled and converged — but only ONE caller was
 * migrated onto them (`isAgentOwnedByAccount`, the kill switch). Four readers were left on the
 * columns, so the fix was delivering for exactly one feature.
 *
 * A reader still on the column is CORRECT on the node that registered the operator and wrong on the
 * other two, which is why this hid: whoever tests it tests the node they registered against. Every
 * assertion here is therefore written against the SQL, not the answer — the answer is identical on
 * the happy node either way, so asserting the result cannot tell the two implementations apart.
 *
 * Live evidence for the split (2026-08-08, before the roll): the same operator's three agents were
 * linked 0 / 2 / 1 across gcp-use1 / gcp-usc1 / gcp-euw1.
 */

import { describe, it, expect } from "vitest";
import { getAccountByEmailStub } from "../account-lookup.js";
import { readAccountFacts } from "../account-facts.js";

const ACCOUNT = "bd9fb2a2-8b94-4a59-8624-ab2658eb37a7";
const STUB = "9ba59213305db59f3c26d8ad098a18081a948877d6ed46e06ddfe13c7154bb44";

/** Records the SQL it is asked to run, and answers from the REPLICATED tables only. */
function poolSpy(rowsFor: (sql: string) => Record<string, unknown>[]) {
  const sql: string[] = [];
  return {
    sql,
    query: async (text: string) => {
      sql.push(text.replace(/\s+/g, " ").trim());
      return { rows: rowsFor(text), rowCount: rowsFor(text).length };
    },
  };
}

describe("CELLO-REPL-001: the sign-in lookup resolves through account_email_stubs", () => {
  it("reads account_email_stubs, NOT user_accounts.email_stub_hash", async () => {
    // AC-002. On the node that registered the operator both queries answer identically, so only the
    // SQL distinguishes a migrated reader from an unmigrated one.
    const pool = poolSpy((s) => (/account_email_stubs/.test(s) ? [{ account_id: ACCOUNT }] : []));

    expect(await getAccountByEmailStub(pool as never, STUB)).toBe(ACCOUNT);
    expect(pool.sql.some((q) => /FROM account_email_stubs/i.test(q)), `ran: ${pool.sql.join(" | ")}`).toBe(true);
    expect(pool.sql.some((q) => /FROM user_accounts/i.test(q)), `must not read the column: ${pool.sql.join(" | ")}`).toBe(false);
  });

  it("answers null when the stub has not replicated, rather than falling back to the column", async () => {
    // Fail-closed and self-healing: the answer becomes correct when anti-entropy lands. Falling back
    // would put the node-local answer back into sign-in, which is the entire defect.
    const pool = poolSpy(() => []);
    expect(await getAccountByEmailStub(pool as never, STUB)).toBeNull();
  });
});

describe("CELLO-REPL-001: account facts read the replicated email stub", () => {
  it("takes the email stub from account_email_stubs, and the phone from user_accounts", async () => {
    // AC-003. phone_stub_hash IS replicated (it is in USER_ACCOUNTS_SPEC's immutable set), so it
    // legitimately stays on the account row — only the email stub moved. Asserting both keeps a
    // future edit from "tidying" the phone read onto a table that does not hold it.
    const pool = poolSpy((s) =>
      /account_email_stubs/.test(s)
        ? [{ email_stub_hash: STUB }]
        : [{ phone_stub_hash: "aa".repeat(32) }],
    );

    const facts = await readAccountFacts(pool as never, ACCOUNT);

    expect(facts.found).toBe(true);
    expect(facts.email?.verified).toBe(true);
    expect(facts.email?.stub).toBe(STUB);
    expect(facts.phone?.verified).toBe(true);
    expect(pool.sql.some((q) => /FROM account_email_stubs/i.test(q))).toBe(true);
  });

  it("reports the email UNVERIFIED when only the account row exists", async () => {
    // The signal that gets minted from this. Before the migration an unreplicated stub produced
    // exactly this answer on two nodes out of three, so `phone` minted and `email` was skipped with
    // nothing reporting it.
    const pool = poolSpy((s) => (/account_email_stubs/.test(s) ? [] : [{ phone_stub_hash: "aa".repeat(32) }]));

    const facts = await readAccountFacts(pool as never, ACCOUNT);

    expect(facts.found).toBe(true);
    expect(facts.email?.verified).toBe(false);
    expect(facts.phone?.verified).toBe(true);
  });

  it("reports not-found when the account itself is unknown", async () => {
    const pool = poolSpy(() => []);
    expect((await readAccountFacts(pool as never, ACCOUNT)).found).toBe(false);
  });
});
