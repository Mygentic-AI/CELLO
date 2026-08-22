/**
 * DOD-M15-CI-SKIPS-SILENT-1 — say what did not run, where the reader actually looks.
 *
 * A quarter of this repo's suite (595 of ~2270 tests, 38 whole files) is gated on
 * `CELLO_ENV === "local"` and does not execute on a default run. The gate then prints a healthy
 * green total, and a skip whose reason is invisible is indistinguishable from a pass.
 *
 * ─── Why a reporter and not a test ─────────────────────────────────────────────────────────────
 *
 * The first attempt announced this from inside a test with `console.warn`. Measured, it landed
 * 4,851 lines before the end of a 22,418-line run, wedged between transport logs — technically in
 * the output and functionally invisible, because the operator reads the last ten lines. Moving it to
 * a `process.on("exit")` handler did not help either: tests run in worker processes, so the handler
 * fired in a worker and never reached the terminal the summary is printed to.
 *
 * A reporter runs in the MAIN process and `onFinished` is called with the completed run, which is
 * the only place that is both after the results and in front of the person reading them.
 *
 * ─── What it counts ────────────────────────────────────────────────────────────────────────────
 *
 * Vitest's own numbers, not a source scan. The earlier version derived a count by grepping sources
 * for one skip idiom and reported "64 files skipped" beside vitest's own "38" in the same output —
 * two different measures, one of them claiming authority. These are the run's actual results.
 */

import type { Reporter } from "vitest/node";

interface TaskLike {
  type?: string;
  mode?: string;
  name?: string;
  tasks?: TaskLike[];
  result?: { state?: string };
}

/**
 * Skips and todos counted SEPARATELY, because vitest reports them separately one line above
 * ("595 skipped | 7 todo"). Summing them produced a headline number that matched nothing in the
 * summary it sits under, and a figure the reader cannot reconcile is one they discount.
 */
function countSkipped(
  tasks: TaskLike[] | undefined,
  acc = { skipped: 0, todo: 0 },
): { skipped: number; todo: number } {
  for (const task of tasks ?? []) {
    if (task.type === "test" || task.type === "custom") {
      if (task.mode === "todo") acc.todo++;
      else if (task.mode === "skip" || task.result?.state === "skip") acc.skipped++;
    }
    countSkipped(task.tasks, acc);
  }
  return acc;
}

export default class SkipVisibilityReporter implements Reporter {
  onFinished(files: TaskLike[] = []): void {
    if (process.env["CELLO_ENV"] === "local") return;

    const { skipped: skippedTests } = countSkipped(files);
    // A file is fully inert when every test in it was skipped — the ones that read as a green
    // filename in the output while asserting nothing.
    const inertFiles = files.filter((f) => {
      const total = { n: 0 };
      const walk = (ts: TaskLike[] | undefined): void => {
        for (const t of ts ?? []) {
          if (t.type === "test" || t.type === "custom") total.n++;
          walk(t.tasks);
        }
      };
      walk(f.tasks);
      const c = countSkipped(f.tasks);
      return total.n > 0 && c.skipped + c.todo === total.n;
    });

    if (skippedTests === 0) return;

    const line = "─".repeat(78);
    process.stderr.write(
      `\n${line}\n` +
        `NOT EVERYTHING ABOVE RAN. ${skippedTests} tests were skipped, across ${inertFiles.length} files\n` +
        `that asserted nothing at all.\n` +
        `\n` +
        `CELLO_ENV is ${process.env["CELLO_ENV"] ?? "unset"}. The integration suites need it set to "local" and a\n` +
        `Postgres from docker compose. Until then nothing has been asserted about the database,\n` +
        `RLS policies, hash-chain constraints, or migrations — a green run above is a green run\n` +
        `of the unit tests only.\n` +
        `\n` +
        `  docker compose up -d && CELLO_ENV=local pnpm run test\n` +
        `${line}\n`,
    );
  }
}
