/**
 * THE `seal_attempt` PATH STAYS DELETED — `DOD-M15-SEALWIRE-1` bullet 7.
 *
 * ─── Why a deletion gets a guard at all ────────────────────────────────────────────────────────
 *
 * A deletion has no failing test of its own. Nothing goes red if it is reverted, or if half of it
 * comes back, or if a later merge resurrects the decoder without the handler. This file is the
 * revert test for a removal: **make the deletion fail on purpose and watch it go red.**
 *
 * ─── What was deleted, and the proof it was dead ───────────────────────────────────────────────
 *
 * PERSIST-014 built a complete bilateral root-agreement check: both parties report their local
 * Merkle root to the directory, which compares them and answers `seal_attempt_ack` or
 * `seal_rejected_tree_mismatch`. Fully written, and **never once called.**
 *
 *   - No sender exists at HEAD in either repo.
 *   - The only sender ever written lived in `core/client/src/relay-stream-manager.ts`, deleted with
 *     the entire M6-era in-process stack on 2026-07-13. `core/client` no longer exists.
 *   - ⚠️ **The published `@cello-protocol/client@0.0.50` DOES still ship a sender** — verified by
 *     downloading the tarball, not by reading the repo. My first statement of this proof said no
 *     installed build could send one, which was right for the wrong reason. What actually holds is
 *     narrower: **nothing installs it.** Checked against npm metadata rather than the local
 *     workspace — `@cello-protocol/connect` depends on `crypto`, `transport` and `interfaces`, and
 *     none of those three pulls `client`. The documented install route is the plugin → connect, so
 *     no operator following it has that package at all.
 *   - And a direct installer of that orphan is still not broken by this deletion, because the
 *     shipped send is **fire-and-forget**: `dirStream.send(...)` inside a `try/catch`, with nothing
 *     awaiting `seal_attempt_ack`. A directory that silently ignores the frame is indistinguishable,
 *     from that client's side, from one that acks an ack it never reads.
 *   - ⚠️ **SECOND CORRECTION TO THIS PROOF.** It said *"neither response frame had a consumer on the
 *     client side"*, and that is false for one of the two: published `client@0.0.50` consumes
 *     `seal_rejected_tree_mismatch` in four of its files. What actually holds is narrower —
 *     `seal_attempt_ack` has no consumer in ANY published tarball, and `seal_rejected_tree_mismatch`
 *     has one only inside the same orphan that carries the sender. Two inaccurate sentences in one
 *     proof, the second surviving a correction round, in the file whose whole job is to be the
 *     durable record. Recorded rather than quietly narrowed.
 *   - And had a frame somehow arrived, the dispatch chain's terminal branch is
 *     *"Unknown frame type for authenticated state — ignore"*: no error, no stream close. So the
 *     deletion cannot break a peer that does not exist.
 *
 * The DoD's reason for removing it is not tidiness: *"A fully written handler with no sender reads
 * as abandoned work to anyone auditing a public repo."* Evaluators point a coding agent at this
 * repository before deciding whether to trust the protocol.
 *
 * ─── Why this asserts the SOURCE and not just the types ────────────────────────────────────────
 *
 * A type-level check would pass on a build where the branch was restored as a string comparison, and
 * the frame type is a wire value — it can be reintroduced by anything that writes the literal. So the
 * assertion is over the shipped source text, and it **pins its own anchor first**: a matcher that
 * silently reads nothing is not a matcher, which is how two guards in this milestone passed while
 * checking nothing at all.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * BOTH PACKAGES, not just this one — review bypass 3.
 *
 * `SRC` was `packages/directory/src` alone, so re-adding the frame anywhere in `packages/relay`
 * left the guard green — and the DoD bullet's third clause is *about* a relay test. A guard that
 * cannot see the clause it enforces is enforcing two thirds of a rule.
 */
const DIRECTORY_SRC = new URL("..", import.meta.url).pathname;
const RELAY_SRC = new URL("../../../relay/src", import.meta.url).pathname;

/**
 * ⚠️ EXEMPT, AND IT MUST STAY EXEMPT. `restart_seal_attempt_timeout` is a LIVE daemon reason code in
 * `cello-client/core/daemon/src/restart-seal-resolver.ts` and contains `seal_attempt` as a
 * substring. Widening the match to bare case-insensitive substrings (bypasses 1 and 2) puts it in
 * range, and a guard that fails on a healthy live code path is a guard someone deletes.
 */
const EXEMPT = /restart_seal_attempt_timeout/gi;

/**
 * Bare substrings, case-insensitive — review bypasses 1 and 2.
 *
 * The list was double-quoted literals, which left two ways back in. `SealRejectedTreeMismatch` was
 * not a token at all, and the deleted `encodeSealRejectedTreeMismatch` body used `type: frame.type`
 * — so it contains **no string literal** and could have been restored wholesale, green. That is
 * precisely the "decoder with no handler" half-resurrection this guard's own failure message claims
 * to prevent. And with no `quotes` lint rule and no prettier config in this repo, `'seal_attempt'`
 * or a template literal evaded the double-quoted form entirely.
 */
const FORBIDDEN = [
  "seal_attempt",
  "sealattempt",
  "seal_rejected_tree_mismatch",
  "sealrejectedtreemismatch",
  "pendingsealattempts",
  /**
   * ⚠️ THE SECOND HALF OF THE SAME DEAD EXCHANGE — found by review, not by me.
   *
   * PERSIST-014 had two halves. The directory answered `seal_rejected_tree_mismatch`; the client was
   * then supposed to ask the RELAY for the leaves it was missing, via `gap_fill_request`. Deleting
   * only the directory half left the relay's half fully written **and more orphaned than before** —
   * its one documented trigger was the reply I had just removed.
   *
   * Dead by exactly the same evidence: no sender in cello-client source, and across all nine
   * published tarballs `gap_fill` appears in one file — the same deprecated `client@0.0.50` orphan
   * that carries the `seal_attempt` sender. `SessionWal.getLeaves` existed for this and nothing
   * else, so it went too, along with both implementations.
   *
   * The bullet's stated purpose is that a fully written handler with no sender reads as abandoned
   * work to an auditor. Leaving the bigger example of the same protocol would have defeated it while
   * the literal clauses all read as satisfied.
   */
  "gap_fill",
  "gapfill",
];

/** Every `.ts` under `packages/directory/src`, tests included. */
function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) { sourceFiles(full, acc); continue; }
    if (full.endsWith(".ts")) acc.push(full);
  }
  return acc;
}

describe("DOD-M15-SEALWIRE-1 bullet 7: the dead seal_attempt path stays deleted", () => {
  const files = [...sourceFiles(DIRECTORY_SRC), ...sourceFiles(RELAY_SRC)];

  it("★ the ANCHOR — this guard is actually reading BOTH packages' source", () => {
    /**
     * Pinned before anything is asserted absent. A path typo, a moved `src`, or a bad URL resolution
     * would make every "is not present" assertion below pass over an empty list — the shape that let
     * a guard in this same milestone report success while checking nothing.
     */
    expect(files.length, "the source must actually be readable from here").toBeGreaterThan(150);
    expect(files.length, "and a collapse in the file count means the scan is reading the wrong tree").toBeLessThan(600);

    const dirText = sourceFiles(DIRECTORY_SRC).map((f) => readFileSync(f, "utf8")).join("\n");
    const relayText = sourceFiles(RELAY_SRC).map((f) => readFileSync(f, "utf8")).join("\n");
    expect(
      dirText,
      "the DIRECTORY half must be the right source — a live frame type proves these are the dispatch files",
    ).toContain('"seal_unilateral"');
    expect(
      relayText,
      "and the RELAY half too, or the bullet's third clause has no coverage while looking as though it does",
    ).toContain("session_interrupted");
  });

  it("★ no executable reference to the frame or its two replies survives, in EITHER package", () => {
    /**
     * Comments are excluded deliberately: the deletion is explained in several places, and a guard
     * that forbade the WORD would force those explanations out — leaving a future reader to
     * rediscover why the path is missing. What must not come back is code.
     */
    const offenders: string[] = [];
    for (const file of files) {
      if (file.endsWith("dod-m15-sealwire-1-seal-attempt-deleted.test.ts")) continue;
      const executable = readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => {
          const t = line.trimStart();
          return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
        })
        .join("\n")
        .replace(EXEMPT, "");
      const lower = executable.toLowerCase();
      for (const token of FORBIDDEN) {
        if (lower.includes(token)) offenders.push(`${file} → ${token}`);
      }
    }
    expect(
      offenders,
      "half a resurrected protocol is worse than all of it: a decoder with no handler accepts a frame and drops it silently",
    ).toEqual([]);
  });

  it("★ the EXEMPTION is real and is reached — a live reason code must not trip this guard", () => {
    /**
     * The exemption is asserted rather than assumed. `restart_seal_attempt_timeout` is a live daemon
     * reason code containing `seal_attempt` as a substring; if it ever appears in these packages the
     * guard must tolerate it, and if the exemption stops matching, this says so instead of the guard
     * quietly failing on a healthy code path — which is how a guard gets deleted rather than fixed.
     */
    const sample = "  reason: \"restart_seal_attempt_timeout\",";
    expect(
      sample.replace(EXEMPT, "").toLowerCase().includes("seal_attempt"),
      "the exemption must actually neutralise the live reason code, or widening the match breaks a working path",
    ).toBe(false);
    expect(
      "  parsed.type === \"seal_attempt\"".replace(EXEMPT, "").toLowerCase().includes("seal_attempt"),
      "and it must NOT neutralise a real resurrection — an exemption that swallows the thing it guards is worse than none",
    ).toBe(true);
  });
});
