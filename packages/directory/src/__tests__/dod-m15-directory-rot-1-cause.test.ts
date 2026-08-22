/**
 * DOD-M15-DIRECTORY-ROT-1 — the two things the triage turned up that are about the CODE.
 *
 * Running the directory's database suites for the first time produced 32 failures. Triage
 * (Entry 18) found 31 of them were cross-file contention rather than defects. What remained was one
 * test that could never run, and — noticed while chasing it — one error log that reported nothing.
 *
 * Both are unconditional here: they need no database, so they run in exactly the environment where
 * the suites they came from do not.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describeCause } from "../describe-cause.js";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("DOD-M15-DIRECTORY-ROT-1: an error that reaches the operator always names a cause", () => {
  it("EVERY error site in the directory entrypoint routes through describeCause", () => {
    /**
     * The describe line above claims a universal property, and the first version of this fix earned
     * only one site of it — `dieUnavailable`. Fourteen others in the same file still did
     * `err instanceof Error ? err.message : String(err)`, several on the same pg path that produced
     * the empty message in the first place. An `adapter.init.failed` with `reason: ""` is the
     * identical dead end, one function away.
     *
     * Asserted against the source because the property is "no site was missed", which no single
     * runtime test can show.
     */
    const src = readFileSync(join(HERE, "..", "bin", "directory.ts"), "utf8");
    const rawSites = src.match(/instanceof Error \? [^:]*\.message : String\(/g) ?? [];
    expect(
      rawSites,
      `${rawSites.length} error sites in bin/directory.ts still read err.message directly. pg throws ` +
        `errors with an EMPTY message, so each of these can emit reason:"" — the loudest line a ` +
        `process writes, carrying nothing. Route them through describeCause().`,
    ).toEqual([]);
  });

  /**
   * The observed line, verbatim, on the way to exit(1):
   *
   *   {"event":"directory.db.unavailable","level":"error","host":"localhost","port":"5433",
   *    "database":"cello_dev","nodeId":"local","env":"local","reason":""}
   *
   * The loudest thing the process emits, carrying nothing. `err.message` was reported directly,
   * which is correct until pg throws an error whose message is empty — and it does.
   */
  it("falls back to the error CODE when the message is empty, rather than reporting nothing", () => {
    const err = Object.assign(new Error(""), { code: "ECONNREFUSED" });
    const reason = describeCause(err);

    expect(reason, "an empty message must never produce an empty reason").not.toBe("");
    expect(reason).toContain("ECONNREFUSED");
  });

  it("still says something when there is neither a message nor a code", () => {
    // The reader learns the silence is the driver's, not ours — which is the difference between
    // "no cause was available" and "we dropped it".
    const reason = describeCause(new Error(""));
    expect(reason).not.toBe("");
    expect(reason).toContain("no message");
  });

  it("prefers the real message whenever there is one", () => {
    // The fallback must not shadow the thing it is a fallback for.
    const reason = describeCause(Object.assign(new Error("password authentication failed"), { code: "28P01" }));
    expect(reason).toBe("password authentication failed");
  });

  it("survives a thrown non-Error, including one that stringifies to nothing", () => {
    expect(describeCause("plain string")).toBe("plain string");
    expect(describeCause("")).not.toBe("");
  });
});

describe("DOD-M15-DIRECTORY-ROT-1: a test that cannot run is not a test", () => {
  it("the pool-concurrency test defaults its connection string like every sibling", () => {
    /**
     * AC-001 of `m6b-009-pg-pool-config` threw `DATABASE_URL is required for AC-001 integration
     * test` — while AC-002, forty lines above in the SAME FILE, defaulted to the compose Postgres,
     * as `persist-004-hash-chain` does too.
     *
     * So under the documented command (`docker compose up -d && CELLO_ENV=local pnpm run test`) it
     * never tested pool concurrency; it reported a red environment error, every time. Failing loudly
     * was the right instinct pointed at the wrong target: the loudness belongs on a database that is
     * genuinely absent, which pg reports on connect with a real cause attached.
     *
     * Asserted against the source because the behaviour is "this test runs at all", which a test
     * cannot demonstrate about a sibling without running the whole suite.
     */
    const src = readFileSync(join(HERE, "m6b-009-pg-pool-config.test.ts"), "utf8");
    expect(
      src,
      "AC-001 must not reintroduce a hard requirement its own file's siblings default away",
    ).not.toContain("DATABASE_URL is required for AC-001");
    expect(src).toContain('process.env["DATABASE_URL"] ?? "postgresql://postgres:dev@localhost:5433/cello_dev"');
  });
});
