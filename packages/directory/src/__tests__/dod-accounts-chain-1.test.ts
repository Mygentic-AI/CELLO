/**
 * DOD-ACCOUNTS-CHAIN-1 — the PRODUCTION registration path wrote `user_accounts` outside the hash
 * chain, so tamper-evidence on the human↔agent binding was silently nonfunctional.
 *
 * THE DEFECT. `user_accounts` had two writers and production used the wrong one.
 *
 *   - `PgDirectoryStore.createAccount` → `insertWithChain`: advisory lock, previous hash, genesis
 *     link. Correct — and it had ZERO production callers. Only tests reached it.
 *   - `resolveAccountId` (pre-auth-token-repository), called from directory-node's step 6 after
 *     DKG on EVERY real registration: a bare INSERT with
 *     `chain_hash = SHA-256(account_id || phone_stub_hash)`. A standalone digest, not a chain link.
 *
 * Proven on live data (2026-08-06, cello_spine_0): the one real row's stored chain_hash is
 * byte-for-byte SHA-256(account_id ‖ phone_stub_hash) and NOT
 * SHA-256(serialize(record) ‖ CHAIN_GENESIS).
 *
 * WHY THIS IS WORSE THAN A RED TEST. `verifyChain("user_accounts")` fails on any database where a
 * real registration ever happened. Verification being ALWAYS red means an actual tamper is
 * indistinguishable from the baseline — the alarm cannot be told from the noise, so the table that
 * binds a human to an agent has no working tamper-evidence at all. It also reddened the directory
 * suite whenever the ops-agent suite (which drives real registrations) had run against the same DB,
 * which is how it was originally found — and that symptom invited "scope the test down", which
 * would have buried the defect instead of fixing it.
 *
 * THE FIX: one writer. `resolveOrCreateAccount` on the store, which owns `insertWithChain`. The
 * lookup-or-create dedup is preserved and becomes RACE-FREE rather than merely race-tolerant: the
 * advisory lock is taken before the SELECT, so check-then-insert is atomic instead of relying on
 * ON CONFLICT DO NOTHING plus a readback.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { createHash, randomUUID } from "node:crypto";
import { PgDirectoryStore } from "../adapters/pg-directory-store.js";
import { CHAIN_GENESIS, serializeRecord, computeChainHash } from "../hash-chain.js";
import type { Logger } from "@cello-protocol/interfaces";

const isLocal = process.env["CELLO_ENV"] === "local";
const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgresql://postgres:dev@localhost:5433/cello_dev";
const SERVICE_URL = DATABASE_URL.replace(
  /^(postgres(?:ql)?):\/\/[^:]+:[^@]+@/,
  "$1://cello_service:cello_service_dev@",
);

const describeIntegration = isLocal ? describe : describe.skip;

function nullLogger(): Logger {
  return { debug() {}, info() {}, warn() {}, error() {} } as unknown as Logger;
}

describeIntegration("DOD-ACCOUNTS-CHAIN-1: registration must write user_accounts INTO the chain", () => {
  let superPool: pg.Pool;
  let servicePool: pg.Pool;
  let store: PgDirectoryStore;

  beforeAll(async () => {
    superPool = new pg.Pool({ connectionString: DATABASE_URL });
    servicePool = new pg.Pool({ connectionString: SERVICE_URL });
    store = new PgDirectoryStore(servicePool, nullLogger());
  });

  afterAll(async () => {
    await superPool.end();
    await servicePool.end();
  });

  /** A phone stub unique to this run, so parallel/repeat runs never collide on the UNIQUE index. */
  function freshPhone(): string {
    return `dod-accounts-chain-1-${randomUUID()}`;
  }

  it("the row written by the registration path verifies as a CHAIN LINK, not a standalone digest", async () => {
    const phone = freshPhone();
    const email = `${phone}-email`;

    const accountId = await store.resolveOrCreateAccount({ phoneStubHash: phone, emailStubHash: email });
    expect(accountId).toMatch(/^[0-9a-f-]{36}$/);

    const row = await superPool.query<{ account_id: string; phone_stub_hash: string; chain_hash: string }>(
      "SELECT account_id, phone_stub_hash, chain_hash FROM user_accounts WHERE phone_stub_hash = $1",
      [phone],
    );
    expect(row.rows).toHaveLength(1);
    const stored = row.rows[0]!.chain_hash;

    // The exact hash the OLD production path produced. Asserting the new row is NOT this is what
    // makes the test fail against the defect rather than merely describing it.
    const standalone = createHash("sha256").update(accountId).update(phone).digest("hex");
    expect(stored, "a standalone digest is not a chain link").not.toBe(standalone);

    // And it IS a link: SHA-256(serialize(record) || previous_hash). `previous` is whatever row
    // preceded ours, so read it rather than assuming genesis — this table is shared with the rest
    // of the suite and is not empty.
    const prior = await superPool.query<{ chain_hash: string }>(
      "SELECT chain_hash FROM user_accounts WHERE id < (SELECT id FROM user_accounts WHERE phone_stub_hash = $1) ORDER BY id DESC LIMIT 1",
      [phone],
    );
    const previousHash = prior.rows[0]?.chain_hash ?? CHAIN_GENESIS;
    const expected = computeChainHash(
      serializeRecord({ account_id: accountId, phone_stub_hash: phone, email_stub_hash: email }, "user_accounts"),
      previousHash,
    );
    expect(stored, "must be SHA-256(serialize(record) || previous_chain_hash)").toBe(expected);
  });

  it("verifyChain('user_accounts') stays VALID after a registration — the property that was permanently red", async () => {
    await store.resolveOrCreateAccount({ phoneStubHash: freshPhone() });
    const result = await store.verifyChain("user_accounts");
    expect(result.valid, `chain broke at: ${JSON.stringify(result)}`).toBe(true);
  });

  it("same phone → same account, and the second call writes NO new row (dedup preserved)", async () => {
    const phone = freshPhone();
    const first = await store.resolveOrCreateAccount({ phoneStubHash: phone });
    const second = await store.resolveOrCreateAccount({ phoneStubHash: phone });

    expect(second).toBe(first);
    const count = await superPool.query<{ n: string }>(
      "SELECT count(*) AS n FROM user_accounts WHERE phone_stub_hash = $1",
      [phone],
    );
    expect(Number(count.rows[0]!.n)).toBe(1);
    // A second row would also FORK the chain, so dedup is an integrity property here, not just
    // tidiness.
    expect((await store.verifyChain("user_accounts")).valid).toBe(true);
  });

  it("CONCURRENT first-registrations for one phone produce ONE account and an intact chain", async () => {
    // The old path tolerated this race with ON CONFLICT DO NOTHING + readback. The new one must be
    // race-FREE: the advisory lock is taken before the SELECT, so the loser blocks and then sees
    // the winner's committed row. If check-then-insert were unlocked, this either violates the
    // UNIQUE index or forks the chain — and a forked chain is exactly what verifyChain exists to
    // catch.
    const phone = freshPhone();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => store.resolveOrCreateAccount({ phoneStubHash: phone })),
    );

    expect(new Set(results).size, "all five callers must agree on one account_id").toBe(1);
    const count = await superPool.query<{ n: string }>(
      "SELECT count(*) AS n FROM user_accounts WHERE phone_stub_hash = $1",
      [phone],
    );
    expect(Number(count.rows[0]!.n)).toBe(1);
    expect((await store.verifyChain("user_accounts")).valid, "concurrency must not fork the chain").toBe(true);
  });

  it("interleaved registrations for DIFFERENT phones all land in one intact chain", async () => {
    const phones = Array.from({ length: 5 }, () => freshPhone());
    const ids = await Promise.all(phones.map((p) => store.resolveOrCreateAccount({ phoneStubHash: p })));

    expect(new Set(ids).size).toBe(5);
    const verified = await store.verifyChain("user_accounts");
    expect(verified.valid, `chain broke at: ${JSON.stringify(verified)}`).toBe(true);
  });

  it("a tampered row is DETECTED — the whole point, and it cannot be while every row is unchained", async () => {
    // This is the assertion that says the mechanism WORKS rather than merely that it runs. While
    // production wrote standalone digests, verifyChain was already false, so a tamper changed
    // nothing observable: the alarm could not be distinguished from the baseline.
    const phone = freshPhone();
    await store.resolveOrCreateAccount({ phoneStubHash: phone });
    expect((await store.verifyChain("user_accounts")).valid).toBe(true);

    // Mutate a CHAINED field as superuser (cello_service has no UPDATE — that is the point).
    await superPool.query("UPDATE user_accounts SET phone_stub_hash = $1 WHERE phone_stub_hash = $2", [
      `${phone}-TAMPERED`,
      phone,
    ]);
    try {
      const after = await store.verifyChain("user_accounts");
      expect(after.valid, "a modified row must break the chain").toBe(false);
    } finally {
      await superPool.query("UPDATE user_accounts SET phone_stub_hash = $1 WHERE phone_stub_hash = $2", [
        phone,
        `${phone}-TAMPERED`,
      ]);
    }
    // ...and restoring it makes the chain whole again, proving the break was the tamper and not
    // collateral damage from the test itself.
    expect((await store.verifyChain("user_accounts")).valid).toBe(true);
  });
});
