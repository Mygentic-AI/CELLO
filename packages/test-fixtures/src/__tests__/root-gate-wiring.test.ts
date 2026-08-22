/**
 * DOD-M15-CI-SKIPS-SILENT-1 — a suite that does not run must not report green.
 *
 * This milestone's subject, applied to its own evidence. Two distinct ways a test file can pass
 * without asserting anything, both of which had already happened here:
 *
 *   1. NOT WIRED IN. `vitest.config.ts` lists projects explicitly. A workspace package missing from
 *      that list has every one of its test files silently ignored by `pnpm run test` — the gate
 *      prints a healthy total and never mentions them. Three packages (operations-agent,
 *      interfaces, test-fixtures) held 24 such files. The cost was real: the signup limiter units
 *      reported a green gate whose ~4000 passing tests contained none of their own.
 *
 *      A comment warning about exactly this was already sitting in `vitest.config.ts` and was not
 *      heeded, which is the argument for a test rather than a third comment.
 *
 *   2. GATED OFF BY ENVIRONMENT. Integration suites are wrapped in
 *      `CELLO_ENV === "local" ? describe : describe.skip`. Run without that variable — which is
 *      what every automated run does — they report as skipped, and a skip whose reason is invisible
 *      is indistinguishable from a pass.
 *
 * The tests here are unconditional by design: they must run in exactly the environment where the
 * others do not.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
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

describe("DOD-M15-CI-SKIPS-SILENT-1: the root gate runs every package that has tests", () => {
  it("no workspace package with test files is missing from vitest.config.ts projects", () => {
    const config = readFileSync(join(ROOT, "vitest.config.ts"), "utf8");

    const packagesWithTests = readdirSync(PACKAGES)
      .filter((name) => statSync(join(PACKAGES, name)).isDirectory())
      .filter((name) => testFilesIn(join(PACKAGES, name)).length > 0);

    // Read the wired list from the config's own text rather than importing it: the failure this
    // guards against is a package missing from THIS FILE, so the file is the thing to assert on.
    const missing = packagesWithTests.filter((name) => !config.includes(`"packages/${name}"`));

    expect(
      missing,
      missing.length === 0
        ? ""
        : `These packages contain .test.ts files but are NOT listed in vitest.config.ts projects, so ` +
          `\`pnpm run test\` never runs them and the gate reports green without them: ${missing.join(", ")}. ` +
          `Add each to the projects array. If a package's tests are deliberately excluded, that ` +
          `exclusion belongs in writing next to the list, not in its absence from it.`,
    ).toEqual([]);
  });
});

describe("DOD-M15-CI-SKIPS-SILENT-1: environment-gated suites announce themselves", () => {
  /**
   * Integration suites gate on `CELLO_ENV === "local"`. This counts them by reading the source, so
   * new ones are covered the day they are written — the alternative, annotating each of the ~70
   * call sites, drifts the moment someone adds the 71st.
   */
  function envGatedSuiteFiles(): string[] {
    const gate = /(CELLO_ENV["\]]*\s*===?\s*"local"|isLocal)\s*\?\s*describe\s*:\s*describe\.skip/;
    return readdirSync(PACKAGES)
      .filter((name) => statSync(join(PACKAGES, name)).isDirectory())
      .flatMap((name) => testFilesIn(join(PACKAGES, name)))
      .filter((file) => gate.test(readFileSync(file, "utf8")));
  }

  const isLocal = process.env["CELLO_ENV"] === "local";
  const inCi = process.env["CI"] !== undefined && process.env["CI"] !== "" && process.env["CI"] !== "false";

  it("says out loud how many integration suites did not run, and why", () => {
    const gated = envGatedSuiteFiles();

    // The suites exist; if this ever finds none, the detection regex has drifted away from the
    // pattern rather than the pattern having disappeared, and the count below would be a
    // comfortable zero that means nothing.
    expect(
      gated.length,
      "found no environment-gated suites at all — the detection pattern has probably drifted from " +
        "the `CELLO_ENV === \"local\" ? describe : describe.skip` idiom it is meant to recognise",
    ).toBeGreaterThan(0);

    if (isLocal) return;

    // LOUD, AND NOT INSTEAD OF THE LOG. This is the whole point of the unit: a run without
    // CELLO_ENV=local has just skipped a quarter of the suite, and the operator reading "passed"
    // needs to see that in the same output.
    const banner =
      `\n${"─".repeat(78)}\n` +
      `INTEGRATION SUITES DID NOT RUN — ${gated.length} files were skipped, not passed.\n` +
      `CELLO_ENV is ${process.env["CELLO_ENV"] ?? "(unset)"}; these suites require CELLO_ENV=local\n` +
      `and a Postgres from \`docker compose up -d\`. Nothing below asserted anything about the\n` +
      `database, RLS policies, hash-chain constraints, or migrations.\n` +
      `To run them:  docker compose up -d && CELLO_ENV=local pnpm run test\n` +
      `${"─".repeat(78)}\n`;
    console.warn(banner);
  });

  it("FAILS in CI rather than letting an untested run look like a tested one", () => {
    if (!inCi || isLocal) {
      // Locally this is a no-op by design: a developer running the quick gate is making an informed
      // choice, and the warning above already tells them what it cost. CI has no reader to inform.
      expect(true).toBe(true);
      return;
    }

    expect(
      isLocal,
      `CI ran the test suite without CELLO_ENV=local, so ${envGatedSuiteFiles().length} integration ` +
        `suites were skipped and the run would otherwise have reported green having asserted ` +
        `nothing about the database. Either start the compose Postgres and set CELLO_ENV=local in ` +
        `the workflow, or remove this guard deliberately — do not let "we did not test this" keep ` +
        `looking like "this passed".`,
    ).toBe(true);
  });
});
