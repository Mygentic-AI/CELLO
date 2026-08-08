import type pg from "pg";

type Queryable = Pick<pg.Pool, "query">;

/**
 * Resolve an operator's account from the SHA-256 of their email — the sign-in gate (READ-001).
 *
 * READS `account_email_stubs` (V60), NOT `user_accounts.email_stub_hash`.
 *
 * That column is nullable and set after the account row exists, so it is excluded from the
 * hash-chained table's replicated set and has never crossed between nodes. The portal asks a
 * directory "do you know this email?" and a 404 is a SUCCESSFUL answer meaning "no such account" —
 * there is nothing to fail over from. So sign-in resolved only against the node that registered the
 * operator, and against any other node an address verified weeks earlier was simply unknown.
 *
 * Live 2026-08-07: the stub existed on gcp-usc1 alone; the portal asks gcp-euw1 first; sign-in was
 * impossible and the response is identical for known and unknown emails by design, so nothing
 * surfaced anywhere.
 *
 * NO FALLBACK to the old column, deliberately. Falling back would put the node-local answer straight
 * back into the sign-in path, and would do it invisibly — on the node that holds the row both
 * sources agree. Absent means absent: fail closed, and become correct when anti-entropy lands.
 *
 * Extracted from the HTTP handler rather than left inline because inline-in-a-handler is exactly why
 * this reader was missed when V60 shipped — there was nothing to test it through.
 */
export async function getAccountByEmailStub(
  pool: Queryable,
  emailStubHash: string,
): Promise<string | null> {
  const result = await pool.query<{ account_id: string }>(
    "SELECT account_id FROM account_email_stubs WHERE email_stub_hash = $1",
    [emailStubHash],
  );
  return result.rows[0]?.account_id ?? null;
}
