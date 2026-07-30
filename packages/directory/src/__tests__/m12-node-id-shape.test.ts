/**
 * `DOD-INV-NODEID` clause 1 — "every node is born `<cloud>-<region>`".
 *
 * The startup path required NODE_ID to be PRESENT and described the intended shape in a comment, but
 * never checked it. That gap matters more than a naming lint would, because NODE_ID feeds
 * `Identifier.derive()` — it IS the FROST participant identifier. A node born with the wrong one holds
 * shares nobody can address, and fixing it later is a decommission rather than a rename.
 *
 * The case that motivated this is the boring one: `NODE_ID=us-east-1` on a GCP node. It is the CORRECT
 * value for the AWS node next door, so it is the likeliest copy-paste, and before this it started
 * cleanly and derived an identifier matching nothing in the manifest.
 */

import { describe, it, expect } from "vitest";
import { validateNodeId } from "../node-id.js";

const gcp = { env: "dev", cloudProvider: "gcp", nodeRegion: "us-central1", regionSource: "CELLO_REGION" as const };
const aws = { env: "dev", cloudProvider: "aws", nodeRegion: "us-east-1", regionSource: "AWS_REGION" as const };

describe("DOD-INV-NODEID clause 1: a node is born <cloud>-<region>", () => {
  it("accepts the real fleet's ids", () => {
    for (const id of ["gcp-usc1", "gcp-euw1", "gcp-use1"]) {
      expect(validateNodeId(id, gcp), id).toEqual({ ok: true });
    }
  });

  it("REFUSES a bare region on a non-AWS node — the copy-paste from the AWS node next door", () => {
    const v = validateNodeId("us-east-1", gcp);
    expect(v.ok).toBe(false);
    // The SPECIFIC branch, not an alternation: "|names no cloud" would also pass if the message
    // degraded to the generic one, which is a different code path and worse guidance.
    expect((v as { reason: string }).reason).toMatch(/bare AWS region .* not valid on gcp/);
  });

  it("refuses a value that names no cloud at all", () => {
    for (const id of ["potato", "local", ""]) {
      expect(validateNodeId(id, gcp).ok, id).toBe(false);
    }
  });

  it("refuses a cloud the node is not actually running on", () => {
    // Permanent AND wrong: the identifier is derived from this string, and the manifest entry it has
    // to match is written by hand somewhere else.
    const v = validateNodeId("aws-use1", gcp);
    expect(v.ok).toBe(false);
    expect((v as { reason: string }).reason).toMatch(/running on 'gcp'/);
  });

  it("keeps the ONE documented legacy form: an AWS node whose id is exactly its region", () => {
    // Pre-convention AWS nodes are already registered under this, and renaming them destroys their
    // FROST identifier. Flagged as legacy rather than silently accepted.
    expect(validateNodeId("us-east-1", aws)).toEqual({ ok: true, legacy: "aws-bare-region" });
  });

  it("does not let the legacy exception smuggle an arbitrary bare string through on AWS", () => {
    // The exception is pinned to the node's OWN region, so it cannot become a general escape hatch.
    expect(validateNodeId("potato", aws).ok).toBe(false);
    expect(validateNodeId("eu-west-1", aws).ok).toBe(false); // not THIS node's region
  });


  it("refuses the legacy form when the region was FABRICATED, not resolved", () => {
    // nodeId defaults to nodeRegion, and nodeRegion falls back to a hardcoded "us-east-1" — so with
    // neither region variable set, both sides of the legacy comparison are the same guess and the
    // check passes by comparing a value to itself. The node would be permanently born "us-east-1"
    // wherever it actually runs, which is the exact copy-paste this unit exists to stop, arriving
    // through a different door.
    const v = validateNodeId("us-east-1", { env: "dev", cloudProvider: "aws", nodeRegion: "us-east-1", regionSource: "default" });
    expect(v.ok).toBe(false);
    expect((v as { reason: string }).reason).toMatch(/was not resolved/);
  });

  it("accepts the spine cluster's multi-node ids — the milestone-close gate runs on these", () => {
    // The first version of this validator refused `spine-node-0` and would have killed all seven
    // multi-process spine journeys, which `pnpm run test` does not run. A unit test suite going green
    // is exactly why that was invisible.
    for (const i of [0, 1, 2]) {
      expect(
        validateNodeId(`aws-spine-${i}`, { env: "local", cloudProvider: "aws", nodeRegion: "local", regionSource: "local" }),
        `aws-spine-${i}`,
      ).toEqual({ ok: true });
    }
  });

  it("refuses a region segment that is only punctuation", () => {
    expect(validateNodeId("gcp--", gcp).ok).toBe(false);
  });

  it("allows the local shorthand only in local env", () => {
    expect(validateNodeId("local", { env: "local", cloudProvider: "aws", nodeRegion: "local", regionSource: "local" })).toEqual({ ok: true });
    expect(validateNodeId("local", gcp).ok).toBe(false);
  });
});
