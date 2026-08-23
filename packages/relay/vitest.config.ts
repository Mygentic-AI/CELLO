import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    /**
     * ⚠️ THE RELAY PACKAGE HAD NO `testTimeout`, SO IT RAN ON VITEST'S 5000 ms DEFAULT — while
     * `packages/directory` and `packages/e2e-tests` both set 30 s. That mismatch made a per-read
     * deadline in `m7-session-001` INERT: it was widened to 8000 ms and the runner still killed the
     * test at 5000 ms, so the effective bound was 5 s and the widening did nothing it claimed to.
     *
     * The worse half was the diagnostic. A read deadline fails with
     * `readDecodedWithTimeout: no frame in Nms` — which names what did not happen. The runner fails
     * with `Test timed out in 5000ms`, which names where it surfaced. So a "fix" for an exit-point
     * label quietly replaced a cause with an exit-point label.
     *
     * 30 s matches the other two packages, and `hookTimeout` is untouched at its 10 s default in all
     * three.
     *
     * ⚠️ IT DOES NOT FOLLOW THAT EVERY READ HAS ITS OWN DEADLINE — this said so and it is false.
     * `readDecoded()` carries none and is used ~105 times across nine relay test files, including
     * three times in the wire-hop test. For those the runner IS the deadline, and it just moved from
     * 5 s to 30 s. The cost is diagnostic latency on a future hang, which is the right trade for
     * making a real read deadline reachable — but it is a cost, and the previous sentence hid it.
     */
    testTimeout: 30_000,
  },
});
