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
import { expectMatches, expectContains } from "../spine/expect-present.js";

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

  it("★★ a NON-STRING is named as such, not reported as a pattern mismatch", () => {
    /**
     * `toMatch` on a number throws the same way `toMatch` on undefined does. A field that arrived as
     * `0` or `false` is a producer bug, and reporting it as "did not match /^[0-9a-f]{64}$/" sends
     * the reader to the regex.
     */
    const err = threw(() => { expectMatches(42, "the submission id", /^[0-9a-f]{64}$/); });
    expect(err).not.toBeNull();
    expect(String(err?.message), "the type must be named").toMatch(/got number/);
  });

  it("★★ toContain has the SAME hazard, which is why expectContains exists", () => {
    /**
     * Asserted rather than assumed — `expect-present.ts` says so in a comment and this is what makes
     * that comment true. If `toContain` did NOT throw here, `expectContains` would be dead weight.
     */
    const bare = threw(() => { expect(undefined, "THE-DIAGNOSTIC").toContain("payments migration"); });
    expect(bare, "toContain must also throw on undefined").not.toBeNull();
    expect(
      String(bare?.message).includes("THE-DIAGNOSTIC"),
      "and must also discard the message — if not, expectContains is unnecessary",
    ).toBe(false);

    const guarded = threw(() => { expectContains(undefined, "Bob's words, verbatim", "payments migration"); });
    expect(String(guarded?.message)).toContain("Bob's words, verbatim");
    expect(String(guarded?.message)).toMatch(/ABSENT/);
  });
});
