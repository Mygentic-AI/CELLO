/**
 * NODE_ID validation — `DOD-INV-NODEID` clause 1: a node is born `<cloud>-<region>`.
 *
 * `NODE_ID` feeds `ed25519_FROST.Identifier.derive()`, so it IS this node's FROST participant
 * identifier, not a label. A node born under the wrong one holds shares nobody can address, and
 * correcting it is a decommission rather than a rename — which is why this runs at startup, before
 * the node can take part in a ceremony.
 *
 * The refusal is a startup fatal on a MIG, so the ACCEPT SET has to be exactly right: too narrow and
 * a healthy node crash-loops forever. Every accepted form is enumerated here.
 */

/**
 * Clouds a node may be born on — the same set `bin/directory.ts` enforces for `CELLO_CLOUD`. Adding a
 * provider here without adding it there would advertise a cloud the node then refuses to run as.
 */
const KNOWN_CLOUDS = ["aws", "gcp"] as const;

/** Where the node's region came from. A FABRICATED region may not be used to name the node. */
export type RegionSource = "CELLO_REGION" | "AWS_REGION" | "local" | "default";

export type NodeIdVerdict =
  | { ok: true; legacy?: "aws-bare-region" }
  | { ok: false; reason: string };

/** An AWS-style bare region (`us-east-1`), used only to decide which hint the message should carry. */
const AWS_REGION_SHAPE = /^[a-z]{2}-[a-z]+-\d$/;

/**
 * @param nodeId the resolved NODE_ID (already defaulted by the caller)
 * @param opts `env` gates the `local` shorthand and the cross-cloud check; `regionSource` gates the
 *   legacy form, which must never be satisfied by a fabricated region.
 */
export function validateNodeId(
  nodeId: string,
  opts: { env: string; cloudProvider: string; nodeRegion: string; regionSource: RegionSource },
): NodeIdVerdict {
  // ── accepted form 1: the local shorthand, local env only ──
  if (opts.env === "local" && nodeId === "local") return { ok: true };

  // ── accepted form 2: the legacy AWS bare region ──
  // Narrow on purpose: an AWS node whose id is EXACTLY its own region. Real pre-convention nodes have
  // this shape and cannot be renamed without destroying their identifier.
  //
  // `regionSource` is load-bearing, not defensive. `nodeRegion` falls back to a hardcoded
  // "us-east-1" when neither region variable resolves, and `nodeId` then defaults to `nodeRegion` —
  // so without this check both sides of the comparison are the SAME fabricated string and the guard
  // compares a value to itself. A node that cannot say where it is would be permanently born
  // "us-east-1" wherever it actually runs.
  if (opts.cloudProvider === "aws" && nodeId.length > 0 && nodeId === opts.nodeRegion) {
    if (opts.regionSource === "default") {
      return {
        ok: false,
        reason:
          `NODE_ID '${nodeId}' matches this node's region, but that region was not resolved — neither ` +
          `CELLO_REGION nor AWS_REGION is set, so it is a hardcoded default. Set CELLO_REGION, or set ` +
          `NODE_ID explicitly: a node that cannot say where it is must not name itself after a guess.`,
      };
    }
    return { ok: true, legacy: "aws-bare-region" };
  }

  // ── accepted form 3: <cloud>-<region> ──
  const dash = nodeId.indexOf("-");
  const cloud = dash > 0 ? nodeId.slice(0, dash) : "";
  if (!(KNOWN_CLOUDS as readonly string[]).includes(cloud)) {
    // The hint has to be true in the case that FIRES, not just in the case that motivated the check.
    // A bare region IS valid on aws (form 2 above), and a non-region id is not a bare region at all —
    // asserting either unconditionally sends the operator to the naming convention when the fault is
    // elsewhere.
    const looksLikeRegion = AWS_REGION_SHAPE.test(nodeId);
    const hint = !looksLikeRegion
      ? ""
      : opts.cloudProvider !== "aws"
        ? ` A bare AWS region is the legacy AWS form and is not valid on ${opts.cloudProvider}.`
        : ` The legacy AWS form is accepted only when it equals this node's own resolved region (resolved: '${opts.nodeRegion}' from ${opts.regionSource}).`;
    return {
      ok: false,
      reason: `NODE_ID must be <cloud>-<region> with a known cloud (${KNOWN_CLOUDS.join(", ")}); got '${nodeId}'.${hint}`,
    };
  }

  const region = nodeId.slice(dash + 1);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(region)) {
    return { ok: false, reason: `NODE_ID region segment must be lowercase alphanumeric segments; got '${nodeId}'` };
  }

  // A node ID naming a cloud it is not running on is permanent and wrong, and the manifest entry it
  // must match is written by hand somewhere else. Skipped in local, where multi-node test clusters
  // legitimately run every provider's id shape in one process tree.
  if (opts.env !== "local" && cloud !== opts.cloudProvider) {
    return {
      ok: false,
      reason: `NODE_ID '${nodeId}' names cloud '${cloud}' but this node is running on '${opts.cloudProvider}'`,
    };
  }

  return { ok: true };
}
