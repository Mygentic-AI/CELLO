/**
 * DOD-M15-CI-SKIPS-SILENT-1 — a suite that does not run must not report green.
 *
 * This milestone's subject, applied to its own evidence. A test file can pass without asserting
 * anything in THREE distinct ways, and this repo had all three:
 *
 *   1. PACKAGE NOT WIRED IN. `vitest.config.ts` lists projects explicitly. A workspace package
 *      missing from that list has every test file silently ignored — the gate prints a healthy
 *      total and never mentions them. Three packages held 24 such files, and the cost was real:
 *      the signup limiter units reported a green gate containing none of their own tests.
 *
 *   2. FILE EXCLUDED BY A PROJECT CONFIG. A package can be wired in and still hide files:
 *      `packages/e2e-tests/vitest.config.ts` excludes `**\/*.spine.test.ts` and
 *      `**\/*.cross-machine.test.ts`, so 38 files never collect under any environment. The first
 *      version of this guard checked only (1), so `packages/e2e-tests` passed it while those files
 *      stayed invisible — the guard was blind to the layer the DoD line names explicitly.
 *
 *   3. GATED OFF BY ENVIRONMENT. Integration suites wrap in `CELLO_ENV === "local" ? describe :
 *      describe.skip`. Run without it, they report as skipped, and a skip whose reason is invisible
 *      is indistinguishable from a pass.
 *
 * The tests here are unconditional by design: they must run in exactly the environment where the
 * others do not.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, relative, basename } from "node:path";
import { fileURLToPath } from "node:url";

/** Walk up to the repo root — the directory holding the root `vitest.config.ts`. */
function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, "vitest.config.ts")) && existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error("could not locate the repo root from this test file");
}

const ROOT = repoRoot();
const PACKAGES = join(ROOT, "packages");
/** This file. Excluded from the source scans below — see the sentinel note in the env-gate suite. */
const SELF = fileURLToPath(import.meta.url);

/** Test files under a package, ignoring build output and dependencies. */
function testFilesIn(dir: string, acc: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === "dist" || entry === "node_modules.nosync") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) testFilesIn(full, acc);
    else if (entry.endsWith(".test.ts")) acc.push(full);
  }
  return acc;
}

function packageDirs(): string[] {
  return readdirSync(PACKAGES).filter((name) => statSync(join(PACKAGES, name)).isDirectory());
}

/**
 * The projects the ROOT config actually declares.
 *
 * IMPORTED, not grepped. The first version matched the config's TEXT for `"packages/<name>"`, which
 * two things walk straight past: a commented-out entry keeps the substring (and commenting out is
 * the single most likely way someone disables a project), and any prose mentioning a package name
 * in quotes would satisfy it. Importing asks the config what it declares.
 */
async function declaredProjects(): Promise<string[]> {
  const mod = (await import(join(ROOT, "vitest.config.ts"))) as {
    default: { test?: { projects?: string[] } };
  };
  const projects = mod.default.test?.projects;
  if (!Array.isArray(projects) || projects.length === 0) {
    throw new Error("root vitest.config.ts declares no projects array — this guard cannot check what it cannot read");
  }
  return projects;
}

describe("DOD-M15-CI-SKIPS-SILENT-1: the root gate runs every package that has tests", () => {
  it("no workspace package with test files is missing from the root projects list", async () => {
    const projects = await declaredProjects();
    const packagesWithTests = packageDirs().filter((name) => testFilesIn(join(PACKAGES, name)).length > 0);
    const missing = packagesWithTests.filter((name) => !projects.includes(`packages/${name}`));

    expect(
      missing,
      `These packages contain .test.ts files but are NOT in vitest.config.ts projects, so ` +
        `\`pnpm run test\` never runs them and the gate reports green without them: ${missing.join(", ")}. ` +
        `Add each to the projects array. If a package's tests are deliberately excluded, that ` +
        `exclusion belongs in writing next to the list, not in its absence from it.`,
    ).toEqual([]);
  });

  it("this guard is itself inside a wired-in package, or it cannot report its own absence", async () => {
    // The failure mode the first version reproduced INSIDE the fix: this file lives in
    // `packages/test-fixtures`. Unwire that package and the guard is not collected, so the gate goes
    // green with the enforcement mechanism silently deleted — exactly the defect being closed.
    //
    // A test cannot detect its own non-collection. What it CAN do is state the dependency out loud,
    // so anyone reading a green run knows which single line the whole guarantee rests on.
    const projects = await declaredProjects();
    const owning = `packages/${relative(PACKAGES, SELF).split("/")[0]}`;
    expect(
      projects,
      `${owning} holds the gate-wiring guard. If it is ever removed from the projects list, this ` +
        `guard stops running and every check in this file silently disappears from the gate.`,
    ).toContain(owning);
  });
});

describe("DOD-M15-CI-SKIPS-SILENT-1: files a project config hides never collect at all", () => {
  /**
   * Test files excluded by their own package's vitest config — invisible under EVERY environment,
   * which makes them worse than the env-gated ones. Vitest never prints a line for them.
   *
   * Each pattern must be listed here with a written reason. That is the whole mechanism: the
   * exclusions are legitimate, and the defect was that they were invisible, not that they existed.
   */
  /**
   * ─── DOD-M15-SPINE-LANE-1: A REASON IS NOT ENOUGH. THE DECISION IS RECORDED AND CHECKED ───────
   *
   * `CI-SKIPS-SILENT-1` made these exclusions visible, which closed the silence and not the gap: a
   * prose reason saying a lane "runs via its own command" is a claim about the world, and nothing
   * checked it. A command that does not exist, or that nobody is named to run, reads exactly the
   * same in a comment as one that does.
   *
   * So each exclusion now declares WHICH command runs it, WHO runs it, and WHEN — and the command
   * is verified to exist in that package's `package.json`. Prose that names a missing script fails.
   *
   * **The decision, recorded (§3a — manual-only, not scheduled), for THREE reasons:**
   *
   * 1. `cross-machine` cannot be scheduled at all — it needs a second physical machine.
   * 2. `vitest.spine.config.ts` resolves `PORTAL_ROOT = ../../../cello-portal` — a SECOND private
   *    repo that must be checked out beside this one. Schedulable, but it needs a cross-repo
   *    checkout credential, and that is real work rather than a config line.
   * 3. The lane is **56 minutes and currently half red** (`DOD-M15-SPINERED-1`). Scheduling it today
   *    creates a permanently red required check — and `.github/workflows/ci.yml`'s own header already
   *    ruled on that: *"a permanently red required check teaches everyone to ignore the pipeline,
   *    which is worse than an honest absence."* This is that ruling applied a second time.
   *
   * **REVISIT once `SPINERED-1` is green.** The host exists; only the portal checkout and the
   * runtime are in the way. Without that trigger written down, "manual" silently becomes "never".
   *
   * ⚠️ **This previously said the only CI was "the stale AWS pipeline set". That was FALSE** —
   * `.github/workflows/ci.yml` is live, runs on every push and PR, and already stands up a compose
   * Postgres and runs Flyway. This same file says so 190 lines below. Two comments in one file, one
   * saying CI is live and one saying it is dead; the false one was mine and it was the load-bearing
   * half of a decision. Corrected rather than deleted, because "we have no CI" on the record is how
   * nobody comes back to it.
   *
   * **Measured, not assumed** (2026-08-23): `test:spine` was run for the FIRST time and the lane is
   * **half red — 21 of 36 files, 49 of 98 tests**. See `DOD-M15-SPINERED-1`. What that establishes
   * for THIS line, and only this: the lane *executes* — real binaries, real Postgres, `j-conn` green
   * — so it is unattended, not absent. Whether it *works* is `SPINERED-1`'s question, not this one's.
   *
   * ⚠️ **An earlier version of this comment said "the lane is not rotted."** It was written after one
   * green file and before the full run, and the full run falsified it. It is called out rather than
   * quietly replaced because a confident sentence in the milestone's own enforcement file is exactly
   * what stops the next reader going to look.
   */
  interface Exclusion {
    readonly why: string;
    /** npm script in the OWNING package that runs this lane. Asserted to exist. */
    readonly command: string;
    /** Who runs it, and when. "Nobody, eventually" is what this field exists to prevent. */
    readonly owner: string;
  }

  const KNOWN_EXCLUSIONS: Record<string, Exclusion> = {
    "src/**/*.spine.test.ts": {
      why:
        "the M8D spine lane — multi-process suites spawning real binaries against a real Postgres. " +
        "Too slow and too stateful for the unit gate (serial, 120s timeouts), and it needs the " +
        "cello-portal sibling repo checked out beside this one.",
      command: "test:spine",
      owner:
        "the lane closing M15 runs it BEFORE the milestone-close gate and pastes the result into " +
        "the build journal — .claude/CLAUDE.md: 'No milestone closes until a live multi-process " +
        "smoke test passes.' This IS that test, so a close without it is a close without evidence.",
    },
    "src/**/*.cross-machine.test.ts": {
      why: "needs a SECOND physical machine and a relay multiaddr, so it cannot be scheduled at all",
      command: "test:cross-machine",
      owner:
        "Andre, by hand, on the two-machine setup — the only person with the second machine. Not " +
        "required for the milestone-close gate; required before claiming cross-machine support.",
    },
  };

  function projectExcludes(pkg: string): string[] {
    const cfg = join(PACKAGES, pkg, "vitest.config.ts");
    if (!existsSync(cfg)) return [];
    const text = readFileSync(cfg, "utf8");
    const block = /exclude:\s*\[([^\]]*)\]/s.exec(text);
    if (!block) return [];
    return Array.from(block[1].matchAll(/["']([^"']+)["']/g)).map((m) => m[1]);
  }

  it("every file-level exclusion is declared with a reason, so a hidden lane is never a silent one", () => {
    const undeclared: string[] = [];
    for (const pkg of packageDirs()) {
      for (const pattern of projectExcludes(pkg)) {
        if (!(pattern in KNOWN_EXCLUSIONS)) undeclared.push(`${pkg}: ${pattern}`);
      }
    }
    expect(
      undeclared,
      `These vitest configs exclude test files from collection, and the exclusion is not declared ` +
        `in KNOWN_EXCLUSIONS: ${undeclared.join(", ")}. Files matching them never appear in ANY run ` +
        `— not as passed, not as skipped, not at all. Add the pattern with the reason it exists.`,
    ).toEqual([]);
  });

  it("every hidden lane names a command that EXISTS, and a person who runs it", () => {
    /**
     * DOD-M15-SPINE-LANE-1's enforcer. The failure this prevents is not a missing reason — those
     * are all present — it is a reason that is no longer true. A lane declared as "run via its own
     * command" whose command was renamed or deleted is indistinguishable, in prose, from one that
     * works. The script name is the one part of the claim a machine can check, so it is checked.
     *
     * `owner` cannot be verified the same way, and is asserted non-trivial rather than pretended
     * otherwise: what it buys is that "manual-only" has to be written as a person and a trigger,
     * which is much harder to leave as "nobody, eventually".
     */
    const broken: string[] = [];
    for (const [pattern, decl] of Object.entries(KNOWN_EXCLUSIONS)) {
      // Every declared exclusion belongs to e2e-tests today; find the package that excludes it.
      const owners = packageDirs().filter((p) => projectExcludes(p).includes(pattern));
      if (owners.length === 0) {
        broken.push(`${pattern}: declared here but NO package excludes it — the declaration is stale`);
        continue;
      }
      for (const pkg of owners) {
        const pj = join(PACKAGES, pkg, "package.json");
        const scripts = (JSON.parse(readFileSync(pj, "utf8")) as { scripts?: Record<string, string> }).scripts ?? {};
        const body = scripts[decl.command];
        if (body === undefined) {
          broken.push(
            `${pkg}: "${pattern}" says it runs via \`${decl.command}\`, and ${pkg}/package.json has no such script`,
          );
          continue;
        }
        /**
         * THE COMMAND MUST COLLECT THE PATTERN, not merely exist.
         *
         * "The script is present" is one hop short of what is checkable. Narrow
         * `vitest.spine.config.ts`'s `include` to a single file — or leave it stale after a
         * directory move — and 35 files stop being collected by the only command declared to run
         * them, with the script name untouched and this guard green. That is `CI-SKIPS-SILENT-1`
         * reproduced INSIDE the escape hatch built to close it.
         *
         * Both configs satisfy this today, so it costs nothing to require.
         */
        const cfgName = /--config\s+(\S+)/.exec(body)?.[1];
        if (cfgName === undefined) continue; // no --config: the package's default config, already checked
        const cfgPath = join(PACKAGES, pkg, cfgName);
        if (!existsSync(cfgPath)) {
          broken.push(`${pkg}: \`${decl.command}\` names ${cfgName}, which does not exist`);
          continue;
        }
        const includeBlock = /include:\s*\[([^\]]*)\]/s.exec(readFileSync(cfgPath, "utf8"));
        const includes = includeBlock
          ? Array.from(includeBlock[1].matchAll(/["']([^"']+)["']/g)).map((m) => m[1])
          : [];
        if (!includes.includes(pattern)) {
          broken.push(
            `${pkg}: \`${decl.command}\` runs ${cfgName}, whose include is [${includes.join(", ")}] — ` +
              `it does NOT collect "${pattern}", so the lane this declaration points at is not the ` +
              `lane being excluded`,
          );
        }
      }
      /**
       * A FORMATTING FLOOR, and it says so. It counts words; it cannot tell a person from a
       * placeholder, and `"Somebody will get to it"` is five words and passes. The earlier message
       * claimed it checked "a person and a trigger" — a message describing a stronger check than
       * the code performs, which is the same defect this file exists to catch, in miniature.
       *
       * `why` gets the same floor. It is the field the original guarantee is NAMED after — "declared
       * with a written reason" — and until now nothing read it at all: `why: ""` passed a test whose
       * name promises a reason.
       */
      for (const [field, value] of [["owner", decl.owner], ["why", decl.why]] as const) {
        if (value.trim().split(/\s+/).length < 5) {
          broken.push(
            `${pattern}: \`${field}\` reads as a placeholder. A word count is ALL a machine can ` +
              `check here — the field must carry a person or role AND the trigger that fires it ` +
              `(owner), or the actual reason the lane is hidden (why), and only a human can confirm ` +
              `that it does.`,
          );
        }
      }
    }
    expect(
      broken,
      `A hidden lane's declaration has stopped being true:\n  ${broken.join("\n  ")}\n\n` +
        `These files never appear in ANY run, so the declaration is the ONLY thing standing between ` +
        `them and being forgotten. If a lane is genuinely gone, delete its files and its entry — do ` +
        `not leave a reason pointing at a command nobody can run.`,
    ).toEqual([]);
  });

  it("counts the hidden files, so the number is on the record rather than discoverable", () => {
    // The DoD line names "the M8D spine suites" specifically. This asserts they are still hidden
    // and still counted — if the lane is ever wired into the gate, this number drops and someone
    // has to come and say so.
    const spine = testFilesIn(join(PACKAGES, "e2e-tests")).filter(
      (f) => basename(f).endsWith(".spine.test.ts") || basename(f).endsWith(".cross-machine.test.ts"),
    );
    /**
     * PINNED, not `> 0`. The test's own name says the number is "on the record" and its comment says
     * *"if the lane is ever wired into the gate, this number drops and someone has to come and say
     * so"* — but `toBeGreaterThan(0)` stays green after deleting 36 of the 37 files, so nobody had to
     * come and say anything. A test that names a number and asserts a floor is not counting.
     *
     * 38 = 37 `*.spine.test.ts` + 1 `*.cross-machine.test.ts`. The DoD line said 38; it was wrong.
     *
     * +1 on 2026-09-02: `j-witness.spine.test.ts` (`DOD-M15-CORROBORATE-1`), hidden from the root
     * gate like every other spine file. It IS run, deliberately, by
     * `pnpm --filter @cello-protocol/e2e-tests test:spine` — the lane is hidden, not unrun.
     */
    expect(
      spine.length,
      `The hidden lane is ${String(spine.length)} files, not 38. If files were ADDED, they are ` +
        `hidden too and nobody has run them — say so here. If files were REMOVED or wired into the ` +
        `gate, that is the outcome DOD-M15-SPINE-LANE-1 wanted; update the number and the DoD line ` +
        `together so the record moves with the code.`,
    ).toBe(38);
  });
});

describe("DOD-M15-CI-SKIPS-SILENT-1: environment-gated suites announce themselves", () => {
  /**
   * Files carrying a skip idiom, counted by reading the source so a new one is covered the day it
   * is written rather than the day someone remembers to annotate it.
   *
   * BROADENED after review. The first version matched one idiom —
   * `CELLO_ENV === "local" ? describe : describe.skip` — and missed nine files using
   * `describe.skipIf(...)`, a differently-named gate const, and bare `describe.skip` /
   * `it.skip`. `describe.skipIf` is already used inside `operations-agent`, the package this unit
   * wired in, so "suite 65 is covered on day one" was true for one shape only.
   *
   * EXCLUDES THIS FILE. The sentinel below asserts the patterns still match something real, and the
   * first version was permanently satisfied by its own doc comment quoting the idiom — a drift
   * detector that could never detect drift.
   */
  const SKIP_IDIOMS = [
    /\?\s*describe\s*:\s*describe\.skip/, // `X ? describe : describe.skip`, any gate name
    /describe\.skipIf\s*\(/,
    /describe\.runIf\s*\(/,
    /\bdescribe\.skip\s*\(/,
    /\bit\.skip\s*\(/,
    /\bit\.skipIf\s*\(/,
    /\btest\.skip\s*\(/,
  ];

  function filesWithSkipIdiom(): string[] {
    return packageDirs()
      .flatMap((name) => testFilesIn(join(PACKAGES, name)))
      .filter((file) => file !== SELF)
      .filter((file) => {
        const text = readFileSync(file, "utf8");
        return SKIP_IDIOMS.some((re) => re.test(text));
      });
  }

  /** The subset gated specifically on CELLO_ENV — the ones a compose Postgres would turn on. */
  function envGatedFiles(): string[] {
    return filesWithSkipIdiom().filter((file) => /CELLO_ENV/.test(readFileSync(file, "utf8")));
  }

  const isLocal = process.env["CELLO_ENV"] === "local";
  const inCi = process.env["CI"] !== undefined && process.env["CI"] !== "" && process.env["CI"] !== "false";

  it("detects skip idioms across every form actually used in this repo", () => {
    // The sentinel, anchored so it CANNOT be satisfied by this file's own prose. If it ever reports
    // none, the idioms have drifted away from what the repo uses and every count below is a
    // comfortable zero that means nothing.
    const found = filesWithSkipIdiom();
    expect(
      found.length,
      "found no skipped suites anywhere — the detection patterns have drifted from the idioms this " +
        "repo actually uses, so the announcement below would report a reassuring zero",
    ).toBeGreaterThan(0);
  });

  it("has something real to announce — the reporter's numbers are not a comfortable zero", () => {
    if (isLocal) return;

    /**
     * THE ANNOUNCEMENT ITSELF LIVES IN `vitest-skip-reporter.ts`, not here, and that is the fix
     * rather than a detail. Printed from inside a test it landed 4,851 lines before the end of a
     * 22,418-line run — in the output and invisible. A `process.on("exit")` handler fared worse:
     * tests run in workers, so it never reached the terminal at all. A reporter runs in the main
     * process and prints after the summary, which is the ten lines anyone actually reads.
     *
     * What is asserted here is that there IS something to announce. The reporter counts the run;
     * this counts the sources. If the two ever disagree in kind, the sources are the thing that
     * changed.
     */
    const gated = envGatedFiles();
    const allSkipped = filesWithSkipIdiom();
    expect(gated.length, "CELLO_ENV-gated suites exist and are not running").toBeGreaterThan(0);
    expect(allSkipped.length).toBeGreaterThanOrEqual(gated.length);
  });

  it("FAILS in CI rather than letting an untested run look like a tested one", () => {
    /**
     * LIVE NOW. This was dormant when written — the repo had no workflow at all — and
     * `.github/workflows/ci.yml` (DOD-M15-COMPOSE-CI-1, first half) made it real.
     *
     * ─── The escape hatch, and why it is a variable and not a deletion ────────────────────────
     *
     * That workflow deliberately runs the UNIT gate only: the database suites are blocked on
     * `DOD-M15-DIRECTORY-ROT-1`, and a permanently red required check teaches everyone to ignore
     * the pipeline, which is worse than an honest absence. So CI genuinely does run without
     * `CELLO_ENV=local`, on purpose.
     *
     * Deleting this guard to accommodate that would throw away the case it exists for: a run that
     * skips the integration suites WITHOUT anyone having decided to. So the opt-out is explicit —
     * the workflow sets `CELLO_GATE_UNIT_ONLY`, next to a comment saying what it costs — and an
     * unacknowledged CI run still fails. The difference between "we chose not to test this" and
     * "we did not notice we weren't testing this" is the whole subject of this milestone.
     */
    const acknowledgedUnitOnly =
      process.env["CELLO_GATE_UNIT_ONLY"] !== undefined && process.env["CELLO_GATE_UNIT_ONLY"] !== "";

    if (!inCi || isLocal || acknowledgedUnitOnly) {
      expect(true).toBe(true);
      return;
    }

    expect(
      isLocal,
      `CI ran the test suite without CELLO_ENV=local and without acknowledging it, so ` +
        `${envGatedFiles().length} CELLO_ENV-gated test files were skipped and the run would ` +
        `otherwise have reported green having asserted nothing about the database. Either start the ` +
        `compose Postgres and set CELLO_ENV=local, or set CELLO_GATE_UNIT_ONLY=1 in the workflow ` +
        `with a comment saying why — the point is that skipping them is a DECISION someone made, ` +
        `not something nobody noticed.`,
    ).toBe(true);
  });
});
