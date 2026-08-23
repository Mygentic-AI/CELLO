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
 *   - Neither response frame had a consumer on the client side either — the exchange was dead at
 *     both ends, not merely unused at one.
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

const SRC = new URL("..", import.meta.url).pathname;

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
  const files = sourceFiles(SRC);

  it("★ the ANCHOR — this guard is actually reading the directory's source", () => {
    /**
     * Pinned before anything is asserted absent. A path typo, a moved `src`, or a bad URL resolution
     * would make every "is not present" assertion below pass over an empty list — the shape that let
     * a guard in this same milestone report success while checking nothing.
     */
    expect(files.length, "the directory source must actually be readable from here").toBeGreaterThan(20);
    const joined = files.map((f) => readFileSync(f, "utf8")).join("\n");
    expect(
      joined,
      "and it must be the RIGHT source — a live frame type proves these are the dispatch files, not some empty directory",
    ).toContain('"seal_unilateral"');
  });

  it("★ no executable reference to the frame or its two replies survives", () => {
    /**
     * Comments are excluded deliberately: the deletion is explained in two places, and a guard that
     * forbade the WORD would force those explanations out — leaving a future reader to rediscover
     * why the path is missing. What must not come back is code.
     */
    const offenders: string[] = [];
    for (const file of files) {
      if (file.endsWith("dod-m15-sealwire-1-seal-attempt-deleted.test.ts")) continue;
      const executable = readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("//") && !line.trimStart().startsWith("*"))
        .join("\n");
      for (const token of ['"seal_attempt"', '"seal_attempt_ack"', '"seal_rejected_tree_mismatch"', "SealAttempt", "pendingSealAttempts"]) {
        if (executable.includes(token)) offenders.push(`${file.slice(SRC.length)} → ${token}`);
      }
    }
    expect(
      offenders,
      "half a resurrected protocol is worse than all of it: a decoder with no handler accepts a frame and drops it silently",
    ).toEqual([]);
  });
});
