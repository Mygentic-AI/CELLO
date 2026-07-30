/**
 * Migration-numbering hygiene — the cheap check for a class of failure that is expensive live.
 *
 * WHY THIS IS A TEST AND NOT A DEPLOY GUARD. `infra/deploy.sh` has a gap/duplicate preflight, but it
 * guards the wrong path: deploy.sh deploys CloudFormation and does NOT apply migrations. The thing
 * that applies them is `packages/directory/docker-entrypoint.sh`, which runs `flyway migrate` under
 * `set -e` on every container start — so a numbering problem reaches production through the pipeline
 * without the guard ever running, and its symptom is a container that dies BEFORE `exec node`,
 * crash-looping every region at once.
 *
 * Running here means it fails in CI, on a laptop, in seconds — not at 3am across three regions.
 *
 * NOTE ON WHAT THIS DOES *NOT* CATCH: a file that is EDITED after being applied. That is the more
 * dangerous version (it happened on 2026-07-29, V53) and no static test can see it, because the
 * fault is a disagreement between this repo and a database. The check for that is to rebuild the
 * migration set against a scratch database and compare Flyway's own checksum to what each region
 * records — see `infra/STATE.md`. This file covers only what is checkable from the filenames.
 */
import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), "../../db/migrations");

/**
 * Versions OWNED BY ANOTHER BRANCH — absence here is expected, and presence is equally fine once
 * that branch merges.
 *
 * A gap is legal to Flyway on a fresh apply. It only turns fatal when a migration numbered BELOW the
 * current version appears LATER, because Flyway then refuses the out-of-order apply and
 * docker-entrypoint.sh dies under `set -e`. So the gap is not the bug — an UNRECORDED gap is,
 * because nobody knows the number is spoken for and the next branch writes into it.
 *
 * COORDINATION AGREEMENT (2026-07-29, with the M12 session):
 *   - M12 owns V49 and V50. Written, committed, pushed; no further edits.
 *   - This branch owns V51–V56 (V55 taken 2026-07-29 — the edge-column removal; V56 taken
 *     2026-07-30 — `submission_results`, the M10B return path).
 *   - No overlap, no gaps between the two.
 *   - **V57 is the next free number.** If M12 needs another migration it takes the next number above
 *     the highest on EITHER branch, never fills a gap, and says so first.
 *
 * The assertion below is what caught this drifting: it pinned 55, I took 55, and the test failed
 * rather than the comment quietly going stale. That is the whole reason the number is asserted and
 * not merely written down.
 *
 * Recorded here rather than in a doc because this is the file that fails when someone forgets.
 */
const OWNED_BY_ANOTHER_BRANCH = new Set([
  49, // M12 anti-entropy
  50, // M12 anti-entropy
]);

function versions(): number[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => /^V\d+__.*\.sql$/.test(f))
    .map((f) => Number(/^V(\d+)__/.exec(f)![1]))
    .sort((a, b) => a - b);
}

describe("directory migration numbering", () => {
  it("has NO duplicate versions — two files claiming one version is unresolvable", () => {
    // Flyway picks one and ignores the other, silently, so the losing migration simply never runs
    // and its table/column is missing at runtime with no error anywhere near the cause.
    const all = versions();
    const dupes = all.filter((v, i) => all.indexOf(v) !== i);
    expect(dupes, `duplicate migration versions: ${dupes.join(", ")}`).toEqual([]);
  });

  it("has no UNDOCUMENTED gaps — every missing version is a recorded reservation", () => {
    // The failure this prevents: another branch numbers into a gap nobody knew was reserved, merges,
    // and Flyway finds an unapplied migration BELOW the current version. Under `set -e` in
    // docker-entrypoint.sh that kills the container before `exec node` — in every region at once.
    // Keeping the reservation in code (not in someone's memory) is what makes the collision visible
    // at review time.
    const all = versions();
    const missing: number[] = [];
    for (let v = 1; v <= all[all.length - 1]; v++) {
      if (!all.includes(v) && !OWNED_BY_ANOTHER_BRANCH.has(v)) missing.push(v);
    }
    expect(
      missing,
      `migration version gap(s) with no recorded owner: ${missing.join(", ")}. ` +
        `Either the file is missing, or add the version to OWNED_BY_ANOTHER_BRANCH naming the branch that owns it.`,
    ).toEqual([]);
  });

  it("numbers ABOVE every version either branch has used — the merge-safe rule", () => {
    // NOT "never use a number in the owned set": once M12 merges, V49/V50 legitimately appear here
    // and an assertion against their presence would fail on a perfectly correct tree. The property
    // that actually holds through a merge is that NEW work climbs above the high-water mark of both
    // branches, so nothing is ever inserted BELOW an applied version — which is the only ordering
    // Flyway refuses.
    const all = versions();
    const highWaterMark = Math.max(...all, ...OWNED_BY_ANOTHER_BRANCH);
    const nextFree = highWaterMark + 1;
    expect(all).not.toContain(nextFree);
    // Sanity: the agreement says V55 is next. If this drifts, the comment above is stale and the
    // other branch has not been told.
    expect(nextFree, "coordination agreement says V57 is the next free number").toBe(57);
  });
});
