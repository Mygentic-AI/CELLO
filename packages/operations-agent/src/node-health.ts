/**
 * M12 `DOD-MOVE-OPSAGENT-1` — per-node health for a consortium of sovereign directories.
 *
 * The ops agent asserts a schema version against ONE database. In a three-node consortium that makes
 * migration drift on the other two invisible: each node runs its own Cloud SQL and its own Flyway, so
 * "the schema is right" is a per-node fact, not a global one. A node a migration behind keeps
 * accepting writes and diverges quietly.
 *
 * This reads each node's `/health`, which already reports `nodeId` and `schemaVersion`, instead of
 * opening a database connection per node. That is deliberate and is what the DoD asked for: a monitor
 * needing admin credentials for every sovereign node's database would be a standing cross-node
 * privilege, and the whole point of sovereignty is that no single component holds that.
 */

/** What one node said about itself. `null` fields mean "not known", never "zero". */
export interface NodeHealth {
  url: string;
  nodeId: string | null;
  reachable: boolean;
  schemaVersion: number | null;
}

export interface NodeHealthOptions {
  fetchFn?: typeof fetch;
  /** Per-node budget. A hung node must not stall the sweep across the others. */
  timeoutMs?: number;
}

/**
 * Ask every node how it is. Never throws: an unreachable node is a RESULT, not an error — the caller
 * needs the other nodes' answers, and a sweep that aborts on the first failure reports nothing at
 * exactly the moment something is wrong.
 */
export async function checkNodeHealth(urls: readonly string[], opts: NodeHealthOptions = {}): Promise<NodeHealth[]> {
  const fetchFn = opts.fetchFn ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 5_000;

  return Promise.all(
    urls.map(async (url): Promise<NodeHealth> => {
      const unknown: NodeHealth = { url, nodeId: null, reachable: false, schemaVersion: null };
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let res: Response;
        try {
          res = await fetchFn(`${url.replace(/\/$/, "")}/health`, { signal: controller.signal });
        } finally {
          clearTimeout(timer);
        }
        // A non-2xx body is not to be trusted: a degraded node may still serialise a schemaVersion,
        // and reading it would report a version the node itself is not standing behind.
        if (!res.ok) return unknown;

        const body = (await res.json()) as { nodeId?: unknown; schemaVersion?: unknown };
        // Integer or nothing. A string "56" or a NaN must not become a version that compares equal
        // to a real one — an invented version is worse than an absent one, because it reads as agreement.
        const v = typeof body.schemaVersion === "number" && Number.isInteger(body.schemaVersion)
          ? body.schemaVersion
          : null;
        return {
          url,
          nodeId: typeof body.nodeId === "string" ? body.nodeId : null,
          reachable: true,
          schemaVersion: v,
        };
      } catch {
        return unknown;
      }
    }),
  );
}

/**
 * Reduce the sweep to one verdict and one line an operator can act on.
 *
 * Unreachable counts as UNHEALTHY. The tempting reading is "the nodes I can see agree, so we are
 * fine" — but a node that cannot be reached is a node whose schema is unknown, and unknown is not
 * agreement. Reporting green while a third of the consortium is silent is how a monitor stops
 * monitoring without anyone noticing.
 */
export function summariseNodeHealth(
  nodes: readonly NodeHealth[],
  expectedVersion: number,
): { healthy: boolean; detail: string } {
  if (nodes.length === 0) {
    // "Nothing configured" must not report green, or a misconfiguration silently disables the check.
    return { healthy: false, detail: "no directory nodes configured to health-check" };
  }

  const unreachable = nodes.filter((n) => !n.reachable);
  // Named, not counted: "1 node drifted" sends an operator to look at three machines.
  const drifted = nodes.filter((n) => n.reachable && n.schemaVersion !== expectedVersion);

  if (unreachable.length === 0 && drifted.length === 0) {
    return { healthy: true, detail: `${nodes.length}/${nodes.length} nodes at schema ${expectedVersion}` };
  }

  const parts: string[] = [];
  if (drifted.length > 0) {
    parts.push(
      `schema drift: ${drifted.map((n) => `${n.nodeId ?? n.url} at ${n.schemaVersion ?? "unknown"}`).join(", ")} (expected ${expectedVersion})`,
    );
  }
  if (unreachable.length > 0) {
    parts.push(`unreachable: ${unreachable.map((n) => n.nodeId ?? n.url).join(", ")}`);
  }
  return { healthy: false, detail: parts.join("; ") };
}
