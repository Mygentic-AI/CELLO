/**
 * M12 `DOD-INV-KILL-SWITCH` — a security gate's JOIN KEY must itself replicate.
 *
 * ─── The defect this file was written for ────────────────────────────────────────────────────────
 * Found on the live GCP fleet on 2026-07-30, by reading `agent_profiles` on `gcp-usc1`: four of eight
 * rows had **`agent_id = NULL`**, and they were consistently the later row of each pair — the one that
 * arrived by anti-entropy rather than by local registration.
 *
 * Producer: `applyTierA` inserts exactly `AGENT_PROFILES_SPEC.immutableColumns`, and `agent_id` was
 * not in that list. So every profile learned by replication landed with a NULL identity.
 *
 * Consumer: the kill switch is
 *
 *     SELECT 1 FROM agent_suspensions s JOIN agent_profiles p ON p.agent_id = s.agent_id
 *      WHERE p.k_local_pubkey = $1 AND s.paused = true
 *
 * `NULL = s.agent_id` is never true, so the join returned zero rows and `isAgentSuspended` returned
 * **false**. A paused — or BURNED — agent kept being co-signed by every node that had learned it by
 * replication. The suspension row itself replicated fine (Tier-B); it simply could not be joined to
 * the agent.
 *
 * What made it silent is the guard built for exactly this situation. `hasAgentProfile` exists to fire
 * `frost.suspension.uncheckable` when a node holds no profile — but it matches on `k_local_pubkey`
 * only, so it returned TRUE. The node believed it had checked, and signed.
 *
 * ─── Why the test is written this way ───────────────────────────────────────────────────────────
 * Asserting `immutableColumns.includes("agent_id")` alone would fix today's bug and catch nothing
 * else. The general rule is what matters: **a column a security gate JOINs on must be in the sync set
 * of the table it is joined from**, or the gate silently fails open on every replica. So the second
 * test reads the store's own SQL and derives the requirement from it, which means a future gate
 * joining on a different column is covered without anyone remembering to come back here.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TIER_A_SPECS, AGENT_PROFILES_SPEC } from "../ae-table-encoders.js";

describe("DOD-INV-KILL-SWITCH: the join key of a security gate replicates", () => {
  it("agent_id is in the agent_profiles sync set", () => {
    // Immutable in the strict sense the spec requires: set in the two INSERT statements at
    // registration (`pg-directory-store.ts:865`, `:904`) and never UPDATEd anywhere.
    expect(AGENT_PROFILES_SPEC.immutableColumns).toContain("agent_id");
  });

  it("every column the suspension/burn gates JOIN on is in the joined table's sync set", () => {
    // Derived from the store's actual SQL rather than restated here, so the requirement tracks the
    // code. If someone adds a gate joining agent_profiles on a column that does not replicate, this
    // fails with that column named.
    const sql = readFileSync(join(import.meta.dirname, "../adapters/pg-directory-store.ts"), "utf8");

    // `JOIN agent_profiles p ON p.<col> = s.<col>` — the shape every gate uses today.
    const joins = [...sql.matchAll(/JOIN\s+(\w+)\s+\w+\s+ON\s+\w+\.(\w+)\s*=\s*\w+\.(\w+)/gi)];
    const profileJoins = joins.filter(([, table]) => table === "agent_profiles");

    // The gates exist and are found — otherwise this test passes by matching nothing, which is the
    // classic way a source-scanning assertion goes hollow.
    expect(profileJoins.length, "no agent_profiles JOINs found — did the gate SQL move?").toBeGreaterThanOrEqual(3);

    const spec = TIER_A_SPECS.find((s) => s.table === "agent_profiles");
    expect(spec).toBeDefined();

    const missing = [...new Set(profileJoins.map(([, , leftCol]) => leftCol))].filter(
      (col) => !spec!.immutableColumns.includes(col) && !spec!.naturalKey.includes(col),
    );
    expect(
      missing,
      `agent_profiles columns JOINed by a security gate but NOT replicated: ${missing.join(", ")} — ` +
        `on any node that learned the profile by anti-entropy these are NULL, so the gate returns ` +
        `zero rows and fails OPEN`,
    ).toEqual([]);
  });
});
