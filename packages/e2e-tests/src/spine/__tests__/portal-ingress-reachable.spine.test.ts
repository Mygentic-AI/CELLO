import { describe, it, expect } from "vitest";
import { drainAndMint, prepareIntakeScanner, authenticateSubmission } from "../portal-ingress.js";

/**
 * The spine lane can reach the portal's REAL ingress.
 *
 * A standing guard, not a probe. If this breaks — a moved module, a changed alias, a portal
 * refactor — `J-END` would otherwise fail with a resolution error buried inside a 200-line journey,
 * or worse, tempt whoever is debugging it into seeding `signal_records` "just to get it running",
 * which is precisely the false green the indirection exists to prevent.
 */
describe("the spine lane reaches the portal's ingress", () => {
  it("resolves the real modules, not a local re-implementation", () => {
    expect(typeof drainAndMint).toBe("function");
    expect(typeof prepareIntakeScanner).toBe("function");
    expect(typeof authenticateSubmission).toBe("function");
  });
});
