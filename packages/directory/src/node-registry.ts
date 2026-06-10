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
}

/**
 * A parsed relay entry with constructed multiaddr and region identifier.
 */
export interface NodeRegistryResolvedRelay {
  hostname: string;
  peerId: string;
  multiaddr: string;
  region: string;
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

/**
 * Parse SSM node registry parameters into structured relay and directory entries.
 *
 * Expects parameters under paths:
 *   /cello/{env}/nodes/relay/{cloud}-{region}
 *   /cello/{env}/nodes/directory/{cloud}-{region}
 *
 * Observability:
 *   - node.registry.relay.resolved (info): logged for each valid relay entry
 *   - node.registry.parse.failed (warn): logged for malformed/invalid entries
 *   - node.registry.empty (error): logged when no relay entries found
 *   - node.registry.loaded (info): logged on success with relay and directory counts
 */
export function parseNodeRegistryEntries(
  ssmParams: SsmParameter[],
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
    if (!entry.hostname || !entry.peerId || !entry.port || !entry.transport || !entry.status) {
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

    // Extract region identifier from path (last segment, e.g. "aws-us-east-1")
    const pathParts = param.Name.split("/");
    const entryRegion = pathParts[pathParts.length - 1] ?? "unknown";

    // Construct DNS multiaddr (SI-001: never /ip4/)
    const multiaddr = constructRelayMultiaddr(entry);

    if (isRelay) {
      logger.info("node.registry.relay.resolved", {
        hostname: entry.hostname,
        peerId: entry.peerId,
        multiaddr,
        region: entryRegion,
      });
      relays.push({ hostname: entry.hostname, peerId: entry.peerId, multiaddr, region: entryRegion });
    } else if (isDirectory) {
      directories.push({ hostname: entry.hostname, peerId: entry.peerId, multiaddr, region: entryRegion });
    }
  }

  // Observability: log final state
  if (relays.length === 0) {
    logger.error("node.registry.empty", {
      ssmPath: "/cello/{env}/nodes/relay/",
      region,
      guidance: "No relay entries found in SSM. Run deploy.sh to populate the node registry.",
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
