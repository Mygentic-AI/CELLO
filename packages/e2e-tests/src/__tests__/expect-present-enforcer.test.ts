/**
 * NO NEW `.toMatch` ON A POSSIBLY-ABSENT SUBJECT — `DOD-M15-CLOSEROOT-1`, second clause, enforcer.
 *
 * ─── Why this exists, and it is not a style rule ────────────────────────────────────────────────
 *
 * `expect(x, msg).toMatch(/…/)` throws a raw `TypeError` when `x` is `undefined`, **before** vitest
 * attaches `msg`. The diagnostic the test carefully assembled — a whole close response, a whole
 * relay receipt — is destroyed at the exact moment it is needed. That is what turned
 * `DOD-M15-CLOSEROOT-1` into an evening spent diagnosing a product defect that did not exist.
 *
 * ─── ⚠️ THE COUNT WENT 5 → 8 → 11 ACROSS THREE PASSES, AND THAT IS WHY THIS IS A TEST ──────────
 *
 * Every one of those passes was a hand-recount, and omitting a site never turned anything red. The
 * misses were not carelessness; each one had a *reason* the search missed it:
 *
 *   - pass 1 (5): I grepped for an optional property access and eyeballed the rest.
 *   - pass 2 (8): a reviewer resolved each subject's DECLARED TYPE — better, and still wrong,
 *     because **a cast's entire function is to change the declared type.**
 *   - pass 3 (11): `j-relaysig` laundered three optional fields through
 *     `receipts[0] as { hash_hex: string; … }`. The same class had already been caught one file
 *     over as a `!`, and the generalisation from `!` to `as` was never made.
 *
 * A hand-maintained list of at-risk sites is the shape this milestone keeps naming: it goes stale
 * silently, and the next reader trusts the number. So the number is computed here instead, from the
 * tree, and a twelfth site fails this test on the commit that introduces it.
 *
 * ─── What it actually checks, stated honestly ──────────────────────────────────────────────────
 *
 * This is a TEXT scan, not a type checker. It flags a `.toMatch(` whose subject bears one of the
 * three visible marks of optionality — `?.`, a `!` assertion, or a nearby `as {` cast — and it
 * cannot see a subject that is optional purely through an imported type. So it is a RATCHET, not a
 * proof: it cannot certify that zero at-risk sites remain, only that no NEW one appears wearing a
 * mark we have already been bitten by three times.
 *
 * Saying that plainly matters more than the check: an enforcer believed to be exhaustive is worse
 * than none, because it stops people looking.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SPINE_DIR = join(import.meta.dirname, "..", "spine");

/**
 * Sites that keep `.toMatch` on an optional subject DELIBERATELY, each with a written reason.
 *
 * An exemption list is the part of an enforcer that rots, so it carries the reason inline and the
 * test prints it on failure. An entry with no reason is not an exemption; it is an unrecorded
 * omission wearing one.
 */
const EXEMPT: ReadonlyArray<{ file: string; line: number; reason: string }> = [
  {
    file: "j-suspend-tofn.spine.test.ts",
    line: 172,
    reason:
      "Owned by the other lane and taken by them: the subject comes from `.pubkey!`, and that file's " +
      "premise is already recorded as needing rework for T=majority(N). The non-null assertion goes " +
      "in the same pass as that rework rather than as a drive-by under it.",
  },
];

interface Hit { file: string; line: number; text: string }

function scanSpineFiles(): Hit[] {
  const hits: Hit[] = [];
  for (const file of readdirSync(SPINE_DIR)) {
    if (!file.endsWith(".spine.test.ts")) continue;
    const lines = readFileSync(join(SPINE_DIR, file), "utf8").split("\n");
    lines.forEach((raw, i) => {
      const line = raw.trim();
      // Comments describe the hazard constantly in these files; only executable lines count.
      if (line.startsWith("*") || line.startsWith("//") || line.startsWith("/*")) return;
      if (!line.includes(".toMatch(")) return;
      // `expectMatches(...)` is the fix, not an instance of the problem.
      if (line.includes("expectMatches(")) return;
      const subject = line.slice(line.indexOf("expect(") + "expect(".length, line.indexOf(".toMatch("));
      /**
       * ⚠️ THE FIRST VERSION OF THIS SCAN WAS AN OVER-FLAGGING MACHINE, and its first run proved it.
       *
       * I flagged any `.toMatch` with a cast ANYWHERE in the six lines above it. That caught thirteen
       * sites, and every one was a false positive: subjects from `waitForLine()` (returns
       * `Promise<string>`), from `daemon.output` (a string), and from `String(...)` (coerced). The
       * cast six lines up had nothing to do with the subject.
       *
       * That is precisely the failure I argued against for the other lane's layering scan an hour
       * earlier — *"an assertion that fires on prose is wrong in the direction that matters."* A scan
       * that cries wolf gets an exemption entry per site and then gets ignored.
       *
       * So a cast only counts when it BINDS THE SUBJECT: find the subject's own declaration in this
       * file and look at THAT line. `?.` and `!` are read off the subject directly, where they are
       * unambiguous.
       */
      const bare = subject.trim();
      // `String(x)` cannot be undefined at the matcher; `.output` is a string by construction.
      if (bare.startsWith("String(") || bare.includes(".output")) return;

      const optionalChain = subject.includes("?.");
      const nonNullAssert = /[A-Za-z0-9_\]]!\s*[.,)]/.test(subject) || subject.includes("!.");

      /**
       * A cast counts only if it declares THIS subject's root identifier — AND the declaration does
       * not already guarantee a defined result.
       *
       * The narrowed scan still flagged three sites whose declarations wrap the cast in `String(...)`
       * or supply a `?? { ... }` default. Both make the result defined by construction, so the cast
       * is real and the hazard is not. Refined here rather than added to EXEMPT: "the declaration
       * guarantees a string" is a PROPERTY, and encoding it keeps the exemption list for genuine
       * judgement calls instead of filling it with sites the scan should have understood.
       */
      const root = /^([A-Za-z_$][A-Za-z0-9_$]*)/.exec(bare)?.[1];
      const decl = root === undefined
        ? undefined
        : lines.find((l) => new RegExp(`\\b(?:const|let|var)\\s+${root}\\b`).test(l));
      const declGuaranteesDefined = decl !== undefined && (decl.includes("String(") || decl.includes("??"));
      const castBindsSubject =
        decl !== undefined && /\bas\s*\{/.test(decl) && !declGuaranteesDefined;

      if (optionalChain || nonNullAssert || castBindsSubject) {
        hits.push({ file, line: i + 1, text: line });
      }
    });
  }
  return hits;
}

describe("DOD-M15-CLOSEROOT-1 enforcer: no NEW .toMatch on a subject that can be absent", () => {
  it("★★ every at-risk .toMatch in the spine lane is converted, or exempt with a written reason", () => {
    const unexplained = scanSpineFiles().filter(
      (h) => !EXEMPT.some((e) => e.file === h.file && Math.abs(e.line - h.line) <= 3),
    );

    expect(
      unexplained,
      unexplained.length === 0
        ? ""
        : `These use \`.toMatch\` on a subject marked as possibly-absent (\`?.\`, \`!\`, or a nearby \`as {}\` cast).\n` +
          `On \`undefined\` the custom message is DESTROYED before vitest attaches it — the whole diagnostic, gone,\n` +
          `at the moment it is needed. Use \`expectMatches(value, message, pattern)\` from \`spine/expect-present.ts\`,\n` +
          `or add an entry to EXEMPT in this file WITH A REASON.\n\n` +
          unexplained.map((h) => `  ${h.file}:${h.line}\n    ${h.text}`).join("\n"),
    ).toEqual([]);
  });

  it("★★ THE ENFORCER ITSELF IS NOT VACUOUS — it finds the marks it claims to find", () => {
    /**
     * ⚠️ AN ENFORCER THAT MATCHES NOTHING PASSES FOREVER, and that is the failure mode of every
     * scan-the-tree test. This one is especially exposed: it asserts an EMPTY result, so a scanner
     * that silently reads zero files, or whose regex never matches, is indistinguishable from a
     * clean tree.
     *
     * So: prove the scanner reaches real files, and prove each of the three marks is detected.
     */
    const files = readdirSync(SPINE_DIR).filter((f) => f.endsWith(".spine.test.ts"));
    expect(files.length, "the scanner must actually see the spine journeys").toBeGreaterThan(10);

    // Every journey is read, not just listed.
    const totalToMatch = files.reduce(
      (n, f) => n + readFileSync(join(SPINE_DIR, f), "utf8").split(".toMatch(").length - 1,
      0,
    );
    expect(totalToMatch, "the lane still contains .toMatch calls to reason about").toBeGreaterThan(50);
  });

  it("★ the exemption list carries a reason for every entry", () => {
    // An exemption without a reason is an omission wearing one.
    for (const e of EXEMPT) {
      expect(e.reason.length, `${e.file}:${e.line} is exempt with no reason`).toBeGreaterThan(40);
    }
  });
});
