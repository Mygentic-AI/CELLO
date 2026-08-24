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
 * a `String(...)`-coerced field — cannot be `undefined`, and rewriting them would bury the five that
 * can in a hundred that cannot.
 */

import { expect } from "vitest";

/**
 * Assert `value` is a present string matching `pattern`, keeping `message` on BOTH failures.
 *
 * The absence check runs first and separately, so "the field never arrived" and "the field arrived
 * wrong" are different failures with different text — which is the distinction the original form
 * destroyed.
 */
export function expectMatches(
  value: unknown,
  message: string,
  pattern: RegExp,
): void {
  expect(
    value,
    `${message} — the value is ABSENT (undefined/null), which is a different failure from the wrong ` +
      `shape: nothing produced it. Read what the call actually returned before assuming the pattern is wrong.`,
  ).toBeTruthy();
  expect(typeof value, `${message} — expected a string, got ${typeof value}`).toBe("string");
  expect(value as string, message).toMatch(pattern);
}

/**
 * The same, for `toContain`. `toContain` throws on `undefined` exactly as `toMatch` does — verified
 * in `expect-present.test.ts` rather than assumed, because the whole point of this file is that the
 * failure mode was believed and not measured.
 */
export function expectContains(
  value: unknown,
  message: string,
  needle: string,
): void {
  expect(
    value,
    `${message} — the value is ABSENT (undefined/null), which is a different failure from not ` +
      `containing "${needle}": nothing produced it.`,
  ).toBeTruthy();
  expect(value as string, message).toContain(needle);
}
