/**
 * DOD-M15-RELAYPUBKEYS-1 — an incomplete directory pubkey set must stop the relay booting.
 *
 * ─── Why this test exists, and why its absence was the weakest thing on the line ───────────────
 *
 * The change under test is a **refusal to start**. Its failure mode is therefore *every relay in the
 * fleet refuses to boot*, which is the one class of change that must not ship on reasoning alone —
 * and it did: review found the guard had no test at all.
 *
 * ─── What it is guarding ──────────────────────────────────────────────────────────────────────
 *
 * With a single configured directory pubkey the relay accepts session assignments from ONE directory
 * and rejects every session brokered by the other sovereign nodes. It fails CLOSED, so nothing is
 * forged — which is exactly why it was invisible. The operator does not see a configuration gap;
 * **they see CELLO being flaky.** One session works, the next fails depending on which directory
 * happened to broker it, and retrying appears to fix it. That teaches everyone to retry rather than
 * to look, and it quietly makes one directory a precondition for the relay — the redundancy
 * invariant inverted.
 *
 * ─── Driven through the real binary ───────────────────────────────────────────────────────────
 *
 * `dist/bin/relay.js` is spawned as a process, the same shape `gcp-entrypoint.test.ts` uses, because
 * the thing being asserted is an EXIT CODE. Importing the module could not observe `process.exit(1)`
 * without stubbing the very thing under test.
 *
 * ⚠️ **Both halves are asserted, and the second is the one that keeps this honest.** A test that only
 * checks "it exits 1" is satisfied by a relay that never starts for any reason. The positive case
 * proves the guard is what refused: with two pubkeys the process gets PAST it and fails later, on a
 * different, named cause.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The built binary — this asserts on process exit, so it must be the real one. */
const RELAY_BIN = join(import.meta.dirname, "..", "..", "dist", "bin", "relay.js");

const PUBKEY_A = "a".repeat(64);
const PUBKEY_B = "b".repeat(64);
const PUBKEY_C = "c".repeat(64);

interface Run { output: string; code: number }

function runRelay(env: Record<string, string>): Run {
  try {
    const stdout = execFileSync(process.execPath, [RELAY_BIN], {
      env: { PATH: process.env["PATH"] ?? "", ...env },
      encoding: "utf8",
      stdio: "pipe",
      timeout: 20_000,
    });
    return { output: stdout, code: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { output: (e.stdout ?? "") + (e.stderr ?? ""), code: e.status ?? 1 };
  }
}

describe("DOD-M15-RELAYPUBKEYS-1 — the relay refuses to start with an incomplete directory set", () => {
  let walDir: string;
  beforeEach(async () => { walDir = await mkdtemp(join(tmpdir(), "cello-relaypubkeys-")); });
  afterEach(async () => { await rm(walDir, { recursive: true, force: true }); });

  it("★★★ ONE directory pubkey in a non-local env → EXIT 1, naming the variable to set", () => {
    /**
     * The defect: this relay would have started happily and then rejected every session brokered by
     * the other two sovereign directories, which reaches operators as intermittent failure rather
     * than as a config gap.
     *
     * **Revert test:** delete the `dirPubkeys.length < 2` block in `relay.ts` and this goes red —
     * the process gets past the guard and fails later on a different cause, so the assertions on
     * BOTH the exit and the message are what pin it.
     */
    const run = runRelay({
      CELLO_ENV: "dev",
      WAL_DIR: walDir,
      CELLO_DIRECTORY_PUBKEY: PUBKEY_A,
      // CELLO_DIRECTORY_PUBKEYS deliberately absent — this is the forgotten-config case.
    });

    expect(run.code, "a relay that can only serve one directory must not start").toBe(1);
    expect(run.output, "the failure must be the named lifecycle event, not a bare crash").toContain(
      "relay.service.start.failed",
    );
    expect(
      run.output,
      "and it must name the variable an operator has to set — a refusal that does not say what to " +
        "do sends them to read source",
    ).toContain("CELLO_DIRECTORY_PUBKEYS");
  }, 40_000);

  it("★★★ TWO pubkeys get PAST the guard — proving the guard is what refused above", () => {
    /**
     * ⚠️ THE HALF THAT MAKES THE FIRST TEST MEAN ANYTHING. Without it, "exit 1" is satisfied by a
     * relay that cannot start for any reason at all — a broken binary would pass.
     *
     * This run still fails (no signing key is configured, which is the NEXT check), and that is the
     * point: it must fail for a DIFFERENT, later reason. So the assertion is not "it started" but
     * "the directory-set complaint is gone."
     */
    const run = runRelay({
      CELLO_ENV: "dev",
      WAL_DIR: walDir,
      CELLO_DIRECTORY_PUBKEY: PUBKEY_A,
      CELLO_DIRECTORY_PUBKEYS: PUBKEY_B,
    });

    expect(
      run.output,
      "with a second directory pubkey the consortium guard must NOT be the thing that stopped it — " +
        "if this message is still here, the guard is refusing a configuration it should accept",
    ).not.toContain("CELLO_DIRECTORY_PUBKEYS lists");
  }, 40_000);

  it("★★★ a 2-of-3 SET is caught too — the length floor alone would have passed it", () => {
    /**
     * ⚠️ THE GAP THE LENGTH TEST LEAVES, and review named it: a relay told about exactly ONE of its
     * two peers passes `length >= 2` and is still broken for every session the THIRD node brokers.
     * "Still broken, just less so" is not a bar worth shipping.
     *
     * No new configuration closes it. `CELLO_DIRECTORY_ENDPOINTS` comes from the same terraform loop
     * over the directory nodes and already states the consortium's real membership, so a pubkey named
     * there and missing from the accepted set is a directory this relay would silently reject.
     */
    const run = runRelay({
      CELLO_ENV: "dev",
      WAL_DIR: walDir,
      CELLO_DIRECTORY_PUBKEY: PUBKEY_A,
      CELLO_DIRECTORY_PUBKEYS: PUBKEY_B,
      CELLO_DIRECTORY_ENDPOINTS: PUBKEY_C + "=/dns4/dir3.example/tcp/443/p2p/12D3KooWThird",
    });

    expect(run.code, "a relay that would reject a known consortium member must not start").toBe(1);
    expect(run.output, "and it must say which side of the config disagrees").toContain(
      "CELLO_DIRECTORY_ENDPOINTS names",
    );
  }, 40_000);

  it("★★ CELLO_ENV=local is EXEMPT — single-node development must not be broken by this", () => {
    /**
     * The regression half, and it is not hypothetical: the spine harness runs the relay with
     * `CELLO_ENV: "local"` and a single directory. Refusing there would break every local run and
     * the whole e2e lane to fix a fault that only exists in a federated deployment.
     */
    const run = runRelay({
      CELLO_ENV: "local",
      WAL_DIR: walDir,
      CELLO_DIRECTORY_PUBKEY: PUBKEY_A,
    });

    expect(
      run.output,
      "local development is a supported single-directory setup and must never meet this refusal",
    ).not.toContain("CELLO_DIRECTORY_PUBKEYS lists");
  }, 40_000);
});
