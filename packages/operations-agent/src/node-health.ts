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
  /** Why it is not reachable, in the node's own terms. Null when it answered. */
  reason?: string | null;
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
      const fail = (reason: string): NodeHealth => ({ url, nodeId: null, reachable: false, schemaVersion: null, reason });
      const controller = new AbortController();
      // The timer must outlive the HEADERS. Clearing it once fetch resolves leaves the body
      // unbounded — undici's default bodyTimeout is 300s — so a node that answers headers and then
      // stalls would hold this sweep far past its budget. That matters more than it sounds: the
      // sweep is awaited during startup, so one half-responsive directory could keep the health port
      // from ever opening and get the whole ops agent killed and restarted. A sick directory must
      // never take down the registration path.
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetchFn(`${url.replace(/\/$/, "")}/health`, { signal: controller.signal });
        // A non-2xx body is not to be trusted: a degraded node may still serialise a schemaVersion,
        // and reading it would report a version the node itself is not standing behind. But it IS
        // alive and answering — a distinct condition from unreachable, and it sends an operator to a
        // different place.
        if (!res.ok) return fail(`HTTP ${res.status}`);

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
          reason: null,
        };
      } catch (err) {
        // Name the cause. "unreachable" alone covers connection refused, DNS failure, the abort, and
        // a malformed body from a LIVE node — and an operator reading it goes to check the VM and the
        // firewall, which is the wrong subsystem for the last two.
        const e = err as { name?: string; code?: string; message?: string };
        const reason = e?.name === "AbortError"
          ? `timeout after ${timeoutMs}ms`
          : (e?.code ?? e?.message ?? "unknown error");
        return fail(String(reason));
      } finally {
        clearTimeout(timer);
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
    parts.push(
      `unreachable: ${unreachable.map((n) => `${n.nodeId ?? n.url}${n.reason ? ` (${n.reason})` : ""}`).join(", ")}`,
    );
  }
  return { healthy: false, detail: parts.join("; ") };
}

/**
 * Run one sweep and report it. Extracted and exported so the WIRING is testable — the previous
 * version lived inline in `main()`, which meant deleting it entirely broke no test.
 *
 * Returns the summary, or null when no nodes are configured. An empty configuration is LOGGED rather
 * than passed through: `summariseNodeHealth([])` deliberately reports unhealthy for exactly that
 * case, but the caller used to skip the call altogether when the variable was unset, so a typo'd
 * terraform variable produced total silence and the guard written for it was unreachable.
 */
export async function runNodeSweep(
  urlsRaw: string | undefined,
  expectedVersion: number,
  logger: { info: (e: string, c?: Record<string, unknown>) => void; warn: (e: string, c?: Record<string, unknown>) => void },
  opts: NodeHealthOptions = {},
): Promise<{ healthy: boolean; detail: string } | null> {
  const urls = (urlsRaw ?? "").split(",").map((u) => u.trim()).filter(Boolean);
  if (urls.length === 0) {
    logger.warn("ops_agent.nodes.sweep_disabled", {
      component: "health-check",
      detail: "DIRECTORY_HEALTH_URLS is empty — per-node schema drift is NOT being monitored",
    });
    return null;
  }

  const summary = summariseNodeHealth(await checkNodeHealth(urls, opts), expectedVersion);
  // warn, not error: a degraded consortium never stops this agent (see buildHealthReport), so an
  // error level here would be an alarm nobody can act on by restarting.
  if (summary.healthy) logger.info("ops_agent.nodes.ok", { detail: summary.detail, component: "health-check" });
  else logger.warn("ops_agent.nodes.degraded", { detail: summary.detail, component: "health-check" });
  return summary;
}
