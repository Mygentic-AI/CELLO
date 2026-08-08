import type pg from "pg";

type Queryable = Pick<pg.Pool, "query">;

/** Presence + stub hash per fact. Never an address or a number — the directory holds no PII. */
export interface AccountFacts {
  found: boolean;
  phone?: { verified: boolean; stub: string | null };
  email?: { verified: boolean; stub: string | null };
}

/**
 * The verified facts an account can have signals minted from (arm c of the chokepoint read).
 *
 * TWO SOURCES ON PURPOSE, and the split is not arbitrary:
 *
 *   phone_stub_hash — stays on `user_accounts`. It is set at INSERT and is IN that table's
 *                     replicated set, so it already crosses between nodes correctly.
 *   email stub      — comes from `account_email_stubs` (V60). The column of the same name on
 *                     `user_accounts` is nullable and populated later, so it is excluded from the
 *                     hash-chained table's set and has never replicated.
 *
 * Reading both from the account row is what made the portal mint `phone` and silently skip `email`
 * for an operator whose address had been verified through Telegram weeks earlier (2026-08-07). The
 * skip is invisible: `composeEmail` returns null for an unverified fact and the mint reports
 * success having minted one signal instead of two.
 *
 * A future edit "tidying" the phone read onto the stub table would break it the other way — that
 * table holds no phone — which is why the tests assert both reads, not just the email one.
 */
export async function readAccountFacts(
  pool: Queryable,
  accountId: string,
): Promise<AccountFacts> {
  const account = await pool.query<{ phone_stub_hash: string | null }>(
    "SELECT phone_stub_hash FROM user_accounts WHERE account_id = $1",
    [accountId],
  );
  if (account.rows.length === 0) return { found: false };

  const emailRow = await pool.query<{ email_stub_hash: string }>(
    "SELECT email_stub_hash FROM account_email_stubs WHERE account_id = $1 LIMIT 1",
    [accountId],
  );

  const phoneStub = account.rows[0]?.phone_stub_hash ?? null;
  const emailStub = emailRow.rows[0]?.email_stub_hash ?? null;

  return {
    found: true,
    // "Verified" means the stub is PRESENT. A fact without its hash cannot be minted — the payload
    // IS the hash — so reporting it verified would produce a signal with nothing in it.
    phone: { verified: phoneStub !== null, stub: phoneStub },
    email: { verified: emailStub !== null, stub: emailStub },
  };
}
