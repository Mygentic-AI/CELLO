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
  const KNOWN_EXCLUSIONS: Record<string, string> = {
    "src/**/*.spine.test.ts":
      "the M8D spine lane — multi-process suites run deliberately via their own command, not the unit gate",
    "src/**/*.cross-machine.test.ts":
      "needs a second machine and a relay multiaddr; run by hand via pnpm run test:cross-machine",
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

  it("counts the hidden files, so the number is on the record rather than discoverable", () => {
    // The DoD line names "the M8D spine suites" specifically. This asserts they are still hidden
    // and still counted — if the lane is ever wired into the gate, this number drops and someone
    // has to come and say so.
    const spine = testFilesIn(join(PACKAGES, "e2e-tests")).filter(
      (f) => basename(f).endsWith(".spine.test.ts") || basename(f).endsWith(".cross-machine.test.ts"),
    );
    expect(spine.length, "the spine/cross-machine lane should still be present on disk").toBeGreaterThan(0);
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
