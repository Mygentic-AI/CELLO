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
 * Versions deliberately NOT present on this branch, and why.
 *
 * A gap is legal to Flyway on a fresh apply — it only becomes fatal when a migration numbered BELOW
 * the current version shows up later, because Flyway then refuses the out-of-order apply and the
 * entrypoint aborts. So the gap itself is not the bug; an unrecorded gap is, because nobody knows it
 * is reserved and the next branch numbers into it.
 */
const RESERVED_ELSEWHERE = new Set([
  49, // M12 anti-entropy branch
  50, // M12 anti-entropy branch
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
      if (!all.includes(v) && !RESERVED_ELSEWHERE.has(v)) missing.push(v);
    }
    expect(
      missing,
      `migration version gap(s) with no recorded owner: ${missing.join(", ")}. ` +
        `Either the file is missing, or add the version to RESERVED_ELSEWHERE naming the branch that owns it.`,
    ).toEqual([]);
  });

  it("does not number INTO a range reserved by another branch", () => {
    // The inverse, and the one that actually bites on merge: this branch must not use a number
    // another branch already holds, or both files exist after the merge with the same version.
    const clashes = versions().filter((v) => RESERVED_ELSEWHERE.has(v));
    expect(
      clashes,
      `these versions are reserved by another branch: ${clashes.join(", ")} — renumber ABOVE the highest version on either branch`,
    ).toEqual([]);
  });
});
