/**
 * txnPool — run a store's whole read/write path inside ONE transaction that is rolled back.
 *
 * ─── The problem this solves ───────────────────────────────────────────────────────────────────
 *
 * Several directory suites make **whole-table** assertions: `verifyChain` chaining from
 * `CHAIN_GENESIS`, `expect(rowCount).toBe(3)`. Those are only true of an empty table, so each one
 * opened with `TRUNCATE <table> RESTART IDENTITY CASCADE`.
 *
 * That truncate did real damage (`DOD-M15-DIRECTORY-ROT-1`). It takes an `AccessExclusiveLock` over
 * a table other files are using, and Postgres logged it deadlocking against a directory node that
 * was mid-`INSERT` into `conversation_seal_staging`. It also destroys rows other files are asserting
 * on, which is why the suite's failing set moved between identical runs.
 *
 * ─── Why the obvious fix does not work on its own ──────────────────────────────────────────────
 *
 * `TRUNCATE` is transactional in Postgres, so the natural answer is to do it inside a transaction
 * that rolls back. But `PgDirectoryStore` holds a **pool**: `verifyChain` reads through
 * `pool.query`, and `insertWithChain` calls `pool.connect()` for its advisory lock. Both would take
 * DIFFERENT connections and therefore never see the transaction's truncate — the same reason
 * `cross-node-discovery`'s third block could not use a transaction either.
 *
 * ─── What this is ──────────────────────────────────────────────────────────────────────────────
 *
 * A `pg.Pool`-shaped object over a SINGLE client. `query` delegates to that client; `connect`
 * returns the same client with `release` neutered, so a caller that acquires and releases cannot
 * hand back the connection the transaction lives on. Everything the store does therefore happens on
 * one connection, inside one transaction, and `ROLLBACK` undoes all of it — the truncate included.
 *
 * TEST-ONLY, deliberately. The alternative was changing `PgDirectoryStore` to take a caller-supplied
 * connection, which is a production shape change to serve a fixture. This keeps the blast radius in
 * the test directory and is trivially reversible.
 */

import type pg from "pg";

/** A `pg.Pool`-shaped view of one client. Only what the store actually calls is implemented. */
export function txnPool(client: pg.PoolClient): pg.Pool {
  const proxied = new Proxy(client, {
    get(target, prop, receiver) {
      // A store that acquires and releases must not hand back the connection the caller's
      // transaction is running on — the next query would land on a different connection and see
      // none of it.
      if (prop === "release") return () => { /* the test owns this client */ };
      return Reflect.get(target, prop, receiver) as unknown;
    },
  });

  return {
    query: (...args: unknown[]) => (client.query as (...a: unknown[]) => unknown)(...args),
    connect: async () => proxied,
    // `end` is a no-op: the client belongs to the caller's pool and is released by the caller.
    end: async () => { /* caller owns the lifecycle */ },
  } as unknown as pg.Pool;
}

/**
 * Open a transaction on `pool`, hand the body a store-compatible pool bound to it, and ALWAYS roll
 * back — including on failure, so a failing assertion leaves no more behind than a passing one.
 */
export async function inRolledBackTxn<T>(
  pool: pg.Pool,
  body: (txn: pg.Pool, client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    return await body(txnPool(client), client);
  } finally {
    await client.query("ROLLBACK").catch(() => { /* the connection is going back regardless */ });
    client.release();
  }
}
