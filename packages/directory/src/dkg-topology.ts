/**
 * DKG topology — the validator-only threshold arithmetic for registration (M12 ROLE-MANIFEST-1).
 *
 * `T = majority(validators)` (DOD-INV-THRESHOLD): only validator-role nodes hold shares and take
 * part in a DKG, so only they count toward N, the quorum, and the threshold. Replicas replicate
 * state for redundancy/reads and are excluded from all of it. Extracted from the registration
 * handler so this security-critical arithmetic is unit-tested in isolation.
 *
 * Backward compat: a node with no `role` is a validator (see `validatorNodes`), so a role-less
 * manifest — every manifest written before M12 — counts every node exactly as before.
 */

import { validatorNodes, type ConsortiumNode } from "@cello-protocol/protocol-types";

export interface DkgTopology {
  /** Any nodes at all in the manifest (validators or replicas). */
  hasManifest: boolean;
  /** Nodes present but ZERO validators — a non-functional consortium; the caller rejects loudly. */
  replicaOnly: boolean;
  /** Validator count N (clamped to 1 for the no-manifest single-node back-compat path). */
  consortiumNodeCount: number;
  /** Validator nodeIds intersected with the client's reachable set (Q). */
  quorumNodeIds: string[];
  /** T = majority(N); N=1 keeps 2-of-2 (single-node / single-validator back-compat). */
  dkgThreshold: number;
  /** |Q| when validators exist; 1 on the no-manifest path. */
  dkgParticipants: number;
  /** |Q| < T with more than one validator — refuse rather than DKG a below-quorum group. */
  belowQuorum: boolean;
  /**
   * Validator nodeIds appearing MORE THAN ONCE (DOD-INV-NODEID). A node's FROST identifier is
   * `Identifier.derive(nodeId)` and nothing else, so a repeated nodeId is one participant wearing two
   * hats — and the arithmetic inflates around it, yielding a threshold a single identifier can meet
   * alone. Non-empty means the manifest is malformed; the caller refuses. Not attacker-reachable
   * (manifests are officer-signed) — reachable by a hand-edit that otherwise verifies clean.
   */
  duplicateNodeIds: string[];
}

/**
 * Compute the DKG topology from the manifest's nodes and the client's reachable node set.
 *
 * @param allManifestNodes every node in the current manifest (validators AND replicas)
 * @param reachableNodeIds the client's reported reachable nodeIds, or undefined (older client /
 *   no manifest → quorum defaults to all validators)
 */
export function computeDkgTopology(
  allManifestNodes: readonly ConsortiumNode[],
  reachableNodeIds: string[] | undefined,
): DkgTopology {
  const validators = validatorNodes(allManifestNodes);
  const hasManifest = allManifestNodes.length > 0;
  const replicaOnly = hasManifest && validators.length === 0;

  // DISTINCT identifiers, not entries: N must count what can actually hold distinct shares.
  const validatorNodeIds = [...new Set(validators.map((n) => n.nodeId))];
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const { nodeId } of validators) {
    if (seen.has(nodeId)) dupes.add(nodeId);
    seen.add(nodeId);
  }
  const duplicateNodeIds = [...dupes];

  const consortiumNodeCount = validatorNodeIds.length || 1;
  const quorumNodeIds =
    reachableNodeIds !== undefined
      ? validatorNodeIds.filter((id) => reachableNodeIds.includes(id))
      : validatorNodeIds;

  const dkgThreshold = consortiumNodeCount === 1 ? 2 : Math.floor(consortiumNodeCount / 2) + 1;
  // Validators present → the quorum size |Q|; no manifest (0 validators) → the single primary
  // directory (2-of-2). replicaOnly is handled by the caller before these are used.
  const dkgParticipants = validatorNodeIds.length > 0 ? quorumNodeIds.length : 1;
  const belowQuorum = consortiumNodeCount > 1 && dkgParticipants < dkgThreshold;

  return {
    hasManifest,
    replicaOnly,
    consortiumNodeCount,
    quorumNodeIds,
    dkgThreshold,
    dkgParticipants,
    belowQuorum,
    duplicateNodeIds,
  };
}
