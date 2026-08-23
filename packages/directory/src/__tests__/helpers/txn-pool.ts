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

/**
 * ─── DOD-M15-CHAINDEBT-1 review, F1: THIS HELPER USED TO COMMIT ────────────────────────────────
 *
 * The proxy neutered `release` and nothing else. `insertWithChain` called with no external client
 * sets `ownsTransaction = true` and issues its own `BEGIN` … `COMMIT` — **on the very client the
 * caller's transaction is running on**. So the store's first write ENDED the caller's transaction
 * and committed everything before it, a `TRUNCATE` included; every statement after it ran in
 * autocommit; and the closing `ROLLBACK` was a no-op against a transaction that no longer existed.
 *
 * Measured before fixing: one row written inside `inRolledBackTxn` survived the rollback.
 *
 * What it cost, concretely: `persist-004`'s AC-005 has been committing a whole-table `TRUNCATE` of
 * `connection_requests`, ten inserts and a deliberate `DELETE` of row 7 **on every run** — which is
 * why that table verifies red right now — underneath a guard entry whose prose says the opposite.
 * A helper whose NAME is the guarantee is one nobody re-checks; that is this milestone's own
 * subject applied to its own tooling.
 *
 * THE FIX: translate the inner transaction into a SAVEPOINT instead of letting it end the outer
 * one. `BEGIN` → `SAVEPOINT`, `COMMIT` → `RELEASE SAVEPOINT`, `ROLLBACK` → `ROLLBACK TO SAVEPOINT`.
 * The store still gets the atomicity it asked for, and the caller's transaction — and its rollback
 * — survive underneath it.
 */

/** Statements the store issues to manage a transaction it believes it owns. */
type TxnVerb = "BEGIN" | "COMMIT" | "ROLLBACK";

function txnVerbOf(args: unknown[]): TxnVerb | null {
  const first = args[0];
  const sql = typeof first === "string"
    ? first
    : typeof (first as { text?: unknown } | undefined)?.text === "string"
      ? (first as { text: string }).text
      : null;
  if (sql === null) return null;
  // Only a BARE verb. `BEGIN ISOLATION LEVEL …` or `ROLLBACK TO SAVEPOINT x` are left alone: the
  // first is a request this shim cannot honour and must not silently reinterpret, and the second is
  // already savepoint-scoped and belongs to whoever wrote it.
  const bare = sql.trim().replace(/;$/, "").toUpperCase();
  return bare === "BEGIN" || bare === "COMMIT" || bare === "ROLLBACK" ? bare : null;
}

/** A `pg.Pool`-shaped view of one client. Only what the store actually calls is implemented. */
export function txnPool(client: pg.PoolClient): pg.Pool {
  // Nesting depth, so a store that opens a transaction inside another still maps to distinct
  // savepoints rather than colliding on one name.
  let depth = 0;
  const rawQuery = (...args: unknown[]): unknown =>
    (client.query as (...a: unknown[]) => unknown)(...args);

  const query = (...args: unknown[]): unknown => {
    const verb = txnVerbOf(args);
    if (verb === null) return rawQuery(...args);
    if (verb === "BEGIN") {
      depth += 1;
      return rawQuery(`SAVEPOINT txnpool_${depth}`);
    }
    if (depth === 0) {
      // A COMMIT or ROLLBACK with no matching BEGIN on this shim. Swallowed rather than passed
      // through: passing it through is precisely the bug this fix exists to remove.
      return rawQuery("SELECT 1");
    }
    const name = `txnpool_${depth}`;
    depth -= 1;
    return rawQuery(verb === "COMMIT" ? `RELEASE SAVEPOINT ${name}` : `ROLLBACK TO SAVEPOINT ${name}`);
  };

  const proxied = new Proxy(client, {
    get(target, prop, receiver) {
      // A store that acquires and releases must not hand back the connection the caller's
      // transaction is running on — the next query would land on a different connection and see
      // none of it.
      if (prop === "release") return () => { /* the test owns this client */ };
      // The store reaches the client through `connect()`, so the translation has to live here too —
      // fixing only the pool-level `query` would leave the exact path insertWithChain takes.
      if (prop === "query") return query;
      return Reflect.get(target, prop, receiver) as unknown;
    },
  });

  return {
    query,
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
