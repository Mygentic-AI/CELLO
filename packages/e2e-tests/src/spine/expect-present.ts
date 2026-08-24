/**
 * ASSERTIONS THAT SURVIVE THE VALUE BEING ABSENT — `DOD-M15-CLOSEROOT-1`, second clause.
 *
 * ─── The defect, and it cost an evening ────────────────────────────────────────────────────────
 *
 * `expect(x, "my message").toMatch(/…/)` **throws a `TypeError` before vitest attaches the custom
 * message** when `x` is `undefined`. The message is not weakened; it is discarded. So a spine
 * assertion that carefully assembles a `diag` string — the whole close response, the daemon's seal
 * log, the last thing the directory said — prints none of it at the exact moment it is needed, and
 * the run reports a type error against a line number.
 *
 * That is how `DOD-M15-CLOSEROOT-1` was opened as a blocking PRODUCT defect and told to Andre as the
 * most valuable fix available. It was neither: close had been made deliberately non-blocking and was
 * returning a commitment plus guidance naming the tool to fetch the receipt. **The answer was inside
 * the test's own diagnostic the whole time, and the assertion form threw it away.** The line's own
 * words: *"I could not see the response, and I treated `undefined` as the finding instead of as a
 * missing observation."*
 *
 * ─── Why a helper and not `.toBeDefined()` at each site ────────────────────────────────────────
 *
 * The DoD asks for a `.toBeDefined()` in front of every at-risk assertion. That works and it decays:
 * it is two statements that must both carry the message, one of them easy to omit, and nothing stops
 * the next assertion being written the short way. A named helper makes the correct form the shorter
 * one.
 *
 * It is deliberately NOT applied to every `.toMatch` in the lane. Most subjects — `daemon.output`,
 * a `String(...)`-coerced field, or a helper returning a non-optional `string` — cannot be
 * `undefined`, and rewriting them would bury the eight that can in a hundred that cannot.
 *
 * ─── ⚠️ `toMatch` IS THE ONLY AFFECTED MATCHER. I CLAIMED `toContain` TOO, AND IT IS FALSE ──────
 *
 * The first version of this file shipped an `expectContains` alongside, asserting that *"`toContain`
 * throws on `undefined` exactly as `toMatch` does — verified in `expect-present.test.ts` rather than
 * assumed."* **It was neither verified nor true**, and the test carrying that claim went RED on main.
 * Measured against the installed vitest:
 *
 *   - `toMatch(undefined)`   → a raw `TypeError` from `@vitest/expect`, thrown BEFORE `this.assert`
 *                              runs. The custom message is destroyed. This is the real hazard.
 *   - `toContain(undefined)` → falls through to chai's `include`, which throws an `AssertionError`
 *                              **with the custom message prepended**, and whose own text already
 *                              names the bad argument.
 *
 * So `expectContains` solved a problem that did not exist, and it is deleted. Recorded rather than
 * quietly removed because the failure is the one this file is about: I asserted a mechanism in the
 * file whose entire purpose is that mechanisms get measured instead of believed.
 */

import { expect } from "vitest";

/**
 * Assert `value` is a present string matching `pattern`, keeping `message` on BOTH failures.
 *
 * The type check runs first and separately, so "the field never arrived", "the field arrived as the
 * wrong type" and "the field arrived wrong" are three failures with three texts — which is the
 * distinction the bare `expect(x, msg).toMatch(...)` form destroyed.
 */
export function expectMatches(
  value: unknown,
  message: string,
  pattern: RegExp,
): void {
  /**
   * ⚠️ THE TYPE CHECK LEADS, AND `toBeTruthy` IS GONE — review pass 1, F3.
   *
   * I wrote the presence check as `.toBeTruthy()`, which reports `""`, `0` and `false` as
   * **"ABSENT (undefined/null)"**. That is a cause that did not occur, and it fails in the most
   * expensive direction: it sends the reader to the PRODUCER for a value the producer did produce.
   * Which is the same diagnosis-destroying class this file exists to close, inverted — and it
   * contradicted this file's own doc comment, which names `0` and `false` as the case it handles.
   *
   * `""` is not hypothetical here: `j-gcp-live.spine.test.ts` manufactures it as a sentinel.
   *
   * One assertion on `typeof` handles all of it and always names the real type. Absence is called
   * out inside that message rather than by a separate truthiness gate, so `undefined` reads as
   * ABSENT and `0` reads as "got number".
   */
  expect(
    typeof value,
    `${message} — expected a string, got ${typeof value}` +
      (value === undefined || value === null
        ? ` (ABSENT — nothing produced it. Read what the call actually returned before assuming the pattern is wrong.)`
        : ``),
  ).toBe("string");
  expect(value as string, message).toMatch(pattern);
}
