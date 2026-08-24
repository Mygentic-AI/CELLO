/**
 * THE MESSAGE-DISCARD IS MEASURED HERE, NOT ASSUMED — `DOD-M15-CLOSEROOT-1`, second clause.
 *
 * `expect-present.ts` exists because `expect(undefined, "msg").toMatch(/…/)` throws before vitest
 * attaches `msg`, so a diagnostic the test assembled is destroyed at the moment it is needed. That
 * claim is the whole justification for the helper, and it is written down in three places in this
 * repo. **Nowhere was it executed.**
 *
 * The first test below runs the broken form and asserts the message is gone. If a future vitest fixes
 * that behaviour, this test goes red and tells us the helper is no longer earning its keep — which is
 * the correct outcome, and is not something a comment can do.
 */

import { describe, it, expect } from "vitest";
import { expectMatches } from "../spine/expect-present.js";

/** Run `fn`, return the error it threw, or null. */
function threw(fn: () => void): Error | null {
  try { fn(); return null; } catch (e) { return e as Error; }
}

describe("DOD-M15-CLOSEROOT-1: an assertion on an absent value must keep its diagnostic", () => {
  it("★★ THE MECHANISM — the bare form DISCARDS the custom message on undefined", () => {
    /**
     * ⚠️ THE CLAIM THE HELPER RESTS ON, EXECUTED.
     *
     * This is the shape that cost an evening: the test carried the whole close response in its
     * message and printed none of it.
     */
    const err = threw(() => { expect(undefined, "THE-DIAGNOSTIC-THAT-MATTERS").toMatch(/^[0-9a-f]+$/); });
    expect(err, "the bare form must still throw on undefined, or this helper has no purpose").not.toBeNull();
    expect(
      String(err?.message).includes("THE-DIAGNOSTIC-THAT-MATTERS"),
      "if this is TRUE, vitest now preserves the message on a TypeError and expect-present.ts can be deleted — that is a good outcome, and this test is how we would learn it",
    ).toBe(false);
  });

  it("★★ expectMatches KEEPS the message when the value is absent", () => {
    const err = threw(() => { expectMatches(undefined, "A has no sealed root: {close response here}", /^[0-9a-f]{64}$/); });
    expect(err).not.toBeNull();
    expect(
      String(err?.message),
      "the caller's diagnostic must survive — this is the entire point",
    ).toContain("A has no sealed root: {close response here}");
    expect(
      String(err?.message),
      "and it must say ABSENT, because 'nothing produced it' is a different investigation from 'it is the wrong shape'",
    ).toMatch(/ABSENT/);
  });

  it("★ and it still fails on a PRESENT value of the wrong shape — with the plain message", () => {
    /**
     * The anchor. Everything above is satisfied by a helper that fails on absence and never checks
     * the pattern at all; this is what stops it degrading into a presence check wearing a matcher's
     * name.
     */
    const err = threw(() => { expectMatches("not-a-hash", "the root must be 64 hex", /^[0-9a-f]{64}$/); });
    expect(err, "a present-but-wrong value must still fail").not.toBeNull();
    expect(String(err?.message)).toContain("the root must be 64 hex");
    expect(
      String(err?.message),
      "and it must NOT claim absence for a value that was right there",
    ).not.toMatch(/ABSENT/);
  });

  it("★ a present, matching value passes", () => {
    expect(threw(() => { expectMatches("a".repeat(64), "should pass", /^[a-f0-9]{64}$/); }), "the honest case must not throw").toBeNull();
  });

  it("★★ FALSY NON-STRINGS are named by TYPE, never reported as absent", () => {
    /**
     * ⚠️ THIS TEST USED `42` AND THEREBY MISSED THE ENTIRE POINT — review pass 1.
     *
     * The clause is that a field arriving as `0` or `false` is a PRODUCER bug and must not be
     * reported as a pattern mismatch. `42` is truthy, so it sailed past the `.toBeTruthy()` presence
     * gate and reached the type check — the one path that was already correct. The two values the
     * clause names took the OTHER branch and were reported as **"ABSENT (undefined/null)"**, which
     * is a cause that did not occur.
     *
     * So the test picked the one non-string that could not expose the defect its own comment
     * described. Now it uses exactly the values the clause is about.
     */
    for (const [value, typeName] of [[0, "number"], [false, "boolean"], ["", "string"]] as const) {
      const err = threw(() => { expectMatches(value, "the submission id", /^[0-9a-f]{64}$/); });
      expect(err, `${typeName}: a non-matching value must fail`).not.toBeNull();
      expect(
        String(err?.message),
        `${typeName}: reporting a value the producer DID produce as absent sends the reader to the wrong subsystem`,
      ).not.toMatch(/ABSENT/);
    }
    // And the type is named, so the reader is sent to the producer rather than to the regex.
    expect(String(threw(() => { expectMatches(0, "x", /a/); })?.message)).toMatch(/got number/);
    expect(String(threw(() => { expectMatches(false, "x", /a/); })?.message)).toMatch(/got boolean/);
    /**
     * ⚠️ THIS ASSERTION WAS VACUOUS AND COULD NOT FAIL — review pass 2, F4.
     *
     * It was `expect(String(threw(…)?.message)).not.toMatch(/got /)`. If `expectMatches("")` ever
     * STOPPED throwing — the exact regression it exists to catch — `threw` returns `null`,
     * `null?.message` is `undefined`, `String(undefined)` is `"undefined"`, and `"undefined"` does
     * not contain `"got "`. **Green.** A `.not.` assertion over a possibly-absent subject is the
     * hollow shape, and I wrote one in the file about hollow assertions.
     *
     * Asserted positively now: it must throw, and it must fail on the PATTERN.
     */
    const emptyErr = threw(() => { expectMatches("", "the empty case", /a/); });
    expect(emptyErr, "an empty string must still fail a pattern it does not match").not.toBeNull();
    expect(
      String(emptyErr?.message),
      "an empty string IS a string, so it must fail on the PATTERN and never be reported as the wrong type",
    ).not.toMatch(/got /);
    expect(String(emptyErr?.message), "and the caller's message must survive").toContain("the empty case");
  });

  it("★ null takes the same path as undefined — both are ABSENT", () => {
    // Same code path, one line, and it was uncovered: the helper tests `=== undefined || === null`
    // and only the first was ever exercised.
    const err = threw(() => { expectMatches(null, "the root", /^[0-9a-f]{64}$/); });
    expect(String(err?.message)).toMatch(/ABSENT/);
    expect(String(err?.message)).toContain("the root");
  });

  it("★★ toContain does NOT have this hazard — the claim I shipped was false, and measured here", () => {
    /**
     * ⚠️ THE RETRACTION, KEPT AS A TEST RATHER THAN DELETED.
     *
     * The first version of this file asserted that `toContain` discards its message exactly as
     * `toMatch` does, described that as *"asserted rather than assumed"*, and shipped an
     * `expectContains` to work around it. **It was never executed, and it is false** — this test
     * went red on main.
     *
     * `toMatch` throws a raw `TypeError` from `@vitest/expect` before the message is attached.
     * `toContain` falls through to chai's `include`, which throws an `AssertionError` WITH the
     * message. So the workaround was for a hazard that does not exist, and it is gone.
     *
     * Kept as a live assertion because the retraction is only durable if something checks it: if a
     * future vitest changes `toContain` to match `toMatch`'s behaviour, this goes red and tells us
     * the helper needs a second function after all.
     */
    const err = threw(() => { expect(undefined, "THE-DIAGNOSTIC").toContain("payments migration"); });
    expect(err, "toContain must still reject undefined").not.toBeNull();
    expect(
      String(err?.message).includes("THE-DIAGNOSTIC"),
      "toContain PRESERVES the custom message — if this ever becomes false, expectContains must come back",
    ).toBe(true);
  });
});
