/**
 * Node Registry — SSM-based relay and directory node discovery (CELLO-M6B-019).
 *
 * ─── Phase P: Pseudocode ──────────────────────────────────────────────────────
 *
 * parseNodeRegistryEntries(ssmParams, region, logger):
 *   relays = []
 *   directories = []
 *   for each param in ssmParams:
 *     try: entry = JSON.parse(param.Value)
 *     catch: log node.registry.parse.failed { parameterName, error }; continue
 *     validate: hostname, peerId, port, transport, status all present and non-empty
 *     if validation fails: log node.registry.parse.failed { parameterName, error }; continue
 *     if entry.status !== 'active': continue (skip draining/inactive nodes)
 *     determine role from param.Name (/nodes/relay/ vs /nodes/directory/)
 *     extract region identifier from param.Name (last path segment, e.g. aws-us-east-1)
 *     construct multiaddr: /dns4/{hostname}/tcp/{port}/{transport}/p2p/{peerId}
 *     log node.registry.relay.resolved { hostname, peerId, multiaddr, region } for relays
 *     push to relays or directories array
 *   if relays.length === 0:
 *     log node.registry.empty { ssmPath, region, guidance }
 *   else:
 *     log node.registry.loaded { relayCount, directoryCount, source: 'ssm' }
 *   return { relays, directories }
 *
 * constructRelayMultiaddr(entry):
 *   return `/dns4/${entry.hostname}/tcp/${entry.port}/${entry.transport}/p2p/${entry.peerId}`
 *
 * ─── End Phase P ─────────────────────────────────────────────────────────────
 */

import type { Logger } from "@cello-protocol/interfaces";

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * JSON schema for an SSM node registry entry.
 * Path: /cello/{env}/nodes/{role}/{cloud}-{region}
 */
export interface NodeRegistryEntry {
  hostname: string;
  peerId: string;
  port: number;
  transport: string;
  status: string;
  /** Ed25519 public key hex — used as relayId to match relay_register frames.
   * Derived from cello/{env}/relay/node-private-key in Secrets Manager.
   * Populated by deploy.sh Step 6.7. Optional for backward-compat with older entries.
   */
  nodeId?: string;
}

/**
 * A parsed relay entry with constructed multiaddr and region identifier.
 */
export interface NodeRegistryResolvedRelay {
  hostname: string;
  peerId: string;
  multiaddr: string;
  region: string;
  /** Ed25519 public key hex — used as relayId for RelayManifestEntry and relay_register matching.
   * Empty string if the SSM entry predates the nodeId field (backward-compat).
   */
  nodeId: string;
}

/**
 * A parsed directory entry with constructed multiaddr and region identifier.
 */
export interface NodeRegistryResolvedDirectory {
  hostname: string;
  peerId: string;
  multiaddr: string;
  region: string;
}

/**
 * Result of parsing all SSM node registry entries.
 */
export interface NodeRegistryRelayResult {
  relays: NodeRegistryResolvedRelay[];
  directories: NodeRegistryResolvedDirectory[];
}

/**
 * Raw SSM parameter shape (matches AWS SDK GetParametersByPath response).
 */
export interface SsmParameter {
  Name: string;
  Value: string;
}

// ─── Functions ───────────────────────────────────────────────────────────────

/**
 * Construct a DNS-based multiaddr from a node registry entry.
 *
 * SI-001: Never constructs /ip4/ addresses. Always /dns4/.
 * The multiaddr uses DNS resolution at dial time (Route53 -> ALB -> current container).
 */
export function constructRelayMultiaddr(entry: NodeRegistryEntry): string {
  return `/dns4/${entry.hostname}/tcp/${entry.port}/${entry.transport}/p2p/${entry.peerId}`;
}

/** libp2p WebSocket transports a bootstrap multiaddr may advertise. */
const BOOTSTRAP_TRANSPORTS = new Set(["ws", "wss"]);

export interface BuildBootstrapMultiaddrOpts {
  /** The directory's libp2p PeerId (always required — every form appends /p2p/<peerId>). */
  peerId: string;
  /**
   * Verbatim override (CELLO_DIRECTORY_BOOTSTRAP_MULTIADDR). Used as-is except that /p2p/<peerId>
   * is appended when absent. This is how a wss-shaped endpoint reaches /bootstrap unchanged.
   */
  explicit?: string;
  /** Publicly-routable hostname (CELLO_DIRECTORY_HOSTNAME). Only meaningful with no `explicit`. */
  hostname?: string;
  /**
   * Public port (CELLO_DIRECTORY_PUBLIC_PORT). Default 80 — reproduces the pre-M12 AWS string.
   * Only applies to the `hostname` branch. A set-but-empty value is treated as unset.
   */
  port?: string | number;
  /**
   * Public transport (CELLO_DIRECTORY_PUBLIC_TRANSPORT). Default "ws". Must be ws|wss.
   * Only applies to the `hostname` branch. A set-but-empty value is treated as unset.
   */
  transport?: string;
  /** Local-dev fallback: the node's actual WS listen address (0.0.0.0 is made routeable). */
  fallbackWsAddr?: string;
}

/**
 * DOD-MULTIADDR-1 — build the directory's advertised bootstrap multiaddr from CONFIGURATION.
 *
 * Replaces the hardcoded `/dns4/{host}/tcp/80/ws/p2p/{peerId}` template so a GCP node behind TLS
 * can advertise `/tcp/443/wss`. Precedence: explicit override → hostname+port+transport →
 * local-dev fallback → undefined. Defaults (port 80, transport ws) reproduce the AWS string
 * byte-for-byte, so unset env vars change nothing.
 */
export function buildBootstrapMultiaddr(opts: BuildBootstrapMultiaddrOpts): string | undefined {
  const withP2p = (addr: string): string =>
    addr.includes("/p2p/") ? addr : `${addr}/p2p/${opts.peerId}`;

  if (opts.explicit) {
    return withP2p(opts.explicit);
  }

  if (opts.hostname) {
    // Coerce set-but-empty env values to unset. `??` alone would let CELLO_DIRECTORY_PUBLIC_PORT=""
    // through as `""`, yielding an undialable `/tcp//ws` advertised silently — the exact trap the
    // GCP-behind-TLS rollout (which sets these vars) would otherwise spring.
    const port = opts.port === "" ? 80 : (opts.port ?? 80);
    const transport = opts.transport === "" || opts.transport == null ? "ws" : opts.transport;
    if (!BOOTSTRAP_TRANSPORTS.has(transport)) {
      // Fail loud rather than advertise an undialable /tcp/{port}/{typo} address — a silent bad
      // transport would surface only as clients failing to connect, far from the cause.
      throw new Error(
        `buildBootstrapMultiaddr: unknown transport "${transport}" (expected one of ${[...BOOTSTRAP_TRANSPORTS].join(", ")})`,
      );
    }
    return `/dns4/${opts.hostname}/tcp/${port}/${transport}/p2p/${opts.peerId}`;
  }

  if (opts.fallbackWsAddr) {
    return withP2p(opts.fallbackWsAddr.replace("0.0.0.0", "127.0.0.1"));
  }

  return undefined;
}

/**
 * Parse SSM node registry parameters into structured relay and directory entries.
 *
 * Expects parameters under paths:
 *   /cello/{env}/nodes/relay/{cloud}-{region}
 *   /cello/{env}/nodes/directory/{cloud}-{region}
 *
 * @param ssmParams - raw SSM parameter list from GetParametersByPath
 * @param ssmPath - the actual SSM path queried (e.g. "/cello/dev/nodes/"), included in
 *   node.registry.empty so operators can check the exact path rather than a placeholder template.
 * @param region - AWS region of the current directory node
 * @param logger - injected structured logger
 *
 * Observability:
 *   - node.registry.relay.resolved (info): logged for each valid relay entry
 *   - node.registry.parse.failed (warn): logged for malformed/invalid entries
 *   - node.registry.empty (error): logged when no relay entries found
 *   - node.registry.loaded (info): logged on success with relay and directory counts
 */
export function parseNodeRegistryEntries(
  ssmParams: SsmParameter[],
  ssmPath: string,
  region: string,
  logger: Logger,
): NodeRegistryRelayResult {
  const relays: NodeRegistryResolvedRelay[] = [];
  const directories: NodeRegistryResolvedDirectory[] = [];

  for (const param of ssmParams) {
    // Parse JSON value
    let entry: NodeRegistryEntry;
    try {
      entry = JSON.parse(param.Value) as NodeRegistryEntry;
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err);
      logger.warn("node.registry.parse.failed", { parameterName: param.Name, error });
      continue;
    }

    // Validate required fields
    // Note: entry.port == null || entry.port <= 0 instead of !entry.port to reject port:0 correctly
    if (!entry.hostname || !entry.peerId || entry.port == null || entry.port <= 0 || !entry.transport || !entry.status) {
      logger.warn("node.registry.parse.failed", {
        parameterName: param.Name,
        error: "missing required fields (hostname, peerId, port, transport, status)",
      });
      continue;
    }

    // Skip inactive entries
    if (entry.status !== "active") {
      continue;
    }

    // Determine role from parameter path
    const isRelay = param.Name.includes("/nodes/relay/");
    const isDirectory = param.Name.includes("/nodes/directory/");

    // Extract region identifier from path (last segment).
    // Assumed path format: /cello/{env}/nodes/{role}/{cloud}-{region}
    const pathParts = param.Name.split("/");
    const entryRegion = pathParts[pathParts.length - 1] ?? "unknown";

    // Construct DNS multiaddr (SI-001: never /ip4/)
    const multiaddr = constructRelayMultiaddr(entry);

    if (isRelay) {
      const nodeId = entry.nodeId ?? "";
      logger.info("node.registry.relay.resolved", {
        hostname: entry.hostname,
        peerId: entry.peerId,
        multiaddr,
        region: entryRegion,
        nodeId,
      });
      relays.push({ hostname: entry.hostname, peerId: entry.peerId, multiaddr, region: entryRegion, nodeId });
    } else if (isDirectory) {
      directories.push({ hostname: entry.hostname, peerId: entry.peerId, multiaddr, region: entryRegion });
    }
  }

  // Observability: log final state
  if (relays.length === 0) {
    logger.error("node.registry.empty", {
      ssmPath,
      region,
      guidance: `No relay entries found under ${ssmPath}. Run deploy.sh to populate the node registry.`,
    });
  } else {
    logger.info("node.registry.loaded", {
      relayCount: relays.length,
      directoryCount: directories.length,
      source: "ssm",
    });
  }

  return { relays, directories };
}
