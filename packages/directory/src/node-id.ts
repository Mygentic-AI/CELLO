/**
 * NODE_ID validation — `DOD-INV-NODEID` clause 1: "every node is born `<cloud>-<region>`".
 *
 * This is not a naming convention. `NODE_ID` feeds `ed25519_FROST.Identifier.derive()`, so it IS the
 * node's FROST participant identifier. A node born with the wrong one holds shares nobody can address,
 * and correcting it later is a decommission, not a rename — which is why the check belongs at startup,
 * before the node can take part in a single ceremony.
 *
 * The startup path already required NODE_ID to be PRESENT and documented the intended shape in a
 * comment. It never checked the shape, so `NODE_ID=us-east-1` on a GCP node — the single most likely
 * copy-paste error, because it is the correct value for the neighbouring AWS node — started cleanly
 * and derived an identifier that matches nothing in the manifest.
 */

/** Clouds a node may be born on. A node ID names one of them, or it is not a node ID. */
const KNOWN_CLOUDS = ["aws", "gcp", "azure"] as const;

export type NodeIdVerdict =
  | { ok: true; legacy?: "aws-bare-region" }
  | { ok: false; reason: string };

/**
 * @param nodeId the resolved NODE_ID (already defaulted by the caller)
 * @param opts `env` gates the `local` shorthand; `cloudProvider`/`nodeRegion` gate the ONE documented
 *   legacy form — an AWS node registered under a bare region before the convention existed.
 */
export function validateNodeId(
  nodeId: string,
  opts: { env: string; cloudProvider: string; nodeRegion: string },
): NodeIdVerdict {
  if (opts.env === "local" && nodeId === "local") return { ok: true };

  // The legacy exception, kept narrow on purpose: it applies only to an AWS node whose id is EXACTLY
  // its own region. That is the shape real pre-convention nodes have, and pinning it to nodeRegion
  // means the exception cannot be used to smuggle an arbitrary bare string through on the AWS path.
  if (opts.cloudProvider === "aws" && nodeId === opts.nodeRegion && nodeId.length > 0) {
    return { ok: true, legacy: "aws-bare-region" };
  }

  const dash = nodeId.indexOf("-");
  if (dash <= 0) {
    return {
      ok: false,
      reason: `NODE_ID must be <cloud>-<region> (e.g. gcp-usc1); got '${nodeId}', which names no cloud`,
    };
  }

  const cloud = nodeId.slice(0, dash);
  if (!(KNOWN_CLOUDS as readonly string[]).includes(cloud)) {
    return {
      ok: false,
      // Name the likely mistake: a bare region on a non-AWS node is the copy-paste from the AWS node
      // next door, and it is indistinguishable from a typo unless the message says so.
      reason:
        `NODE_ID must start with a known cloud (${KNOWN_CLOUDS.join(", ")}); got '${nodeId}'. ` +
        `A bare region like 'us-east-1' is the legacy AWS form and is not valid on ${opts.cloudProvider}`,
    };
  }

  const region = nodeId.slice(dash + 1);
  if (!/^[a-z0-9-]+$/.test(region)) {
    return { ok: false, reason: `NODE_ID region segment must be lowercase alphanumeric; got '${nodeId}'` };
  }

  // A node ID that names a cloud it is not running on is a misconfiguration worth refusing: the
  // identifier would be permanent and wrong, and the manifest entry it must match is written by hand.
  if (cloud !== opts.cloudProvider && opts.cloudProvider !== "" && opts.env !== "local") {
    return {
      ok: false,
      reason: `NODE_ID '${nodeId}' names cloud '${cloud}' but this node is running on '${opts.cloudProvider}'`,
    };
  }

  return { ok: true };
}
