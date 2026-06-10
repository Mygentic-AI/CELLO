/**
 * CELLO-M6B-019: SSM node registry for DNS-based relay addressing
 *
 * Specification (S phase):
 *
 * AC-003: Directory constructs DNS multiaddrs from SSM entries (no /ip4/ addresses).
 *   Logs 'node.registry.loaded' at INFO with { relayCount, directoryCount, source: 'ssm' }.
 *   Logs 'node.registry.relay.resolved' at INFO for each relay entry parsed.
 *
 * AC-004: pickRelay() returns valid endpoint before any relay_register arrives.
 *   After seeding relay entries from SSM data, pickRelay() returns an entry with
 *   DNS multiaddrs and peerId — no relay_register frame is needed.
 *
 * AC-006: relay_register only updates healthCheckUrl, NOT multiaddrs/peerId.
 *   The manifest's multiaddrs and peerId fields retain SSM values after relay_register.
 *
 * AC-010: CELLO_ENV=local falls back to CELLO_RELAY_MULTIADDR env var. Logs source: 'env'.
 *
 * DB-001: If no relay entries in SSM, logs 'node.registry.empty' at ERROR with guidance.
 *
 * SI-001: Never construct dial target from raw IP. DNS multiaddrs from SSM only.
 *
 * Observability events:
 *   node.registry.loaded (info): { relayCount, directoryCount, source }
 *   node.registry.relay.resolved (info): { hostname, peerId, multiaddr, region }
 *   node.registry.empty (error): { ssmPath, region, guidance }
 *   node.registry.parse.failed (warn): { parameterName, error }
 */

import { describe, it, expect, beforeEach } from "vitest";
import { RelayPoolManager } from "../relay-pool-manager.js";
import type { CloudStorageProvider, Logger } from "@cello-protocol/interfaces";
import {
  parseNodeRegistryEntries,
  constructRelayMultiaddr,
  type NodeRegistryEntry,
} from "../node-registry.js";

// ─── Test helpers ─────────────────────────────────────────────────────────────

/** Capture logger calls for assertion. */
function createCapturingLogger(): Logger & { events: Array<{ level: string; event: string; ctx: Record<string, unknown> }> } {
  const events: Array<{ level: string; event: string; ctx: Record<string, unknown> }> = [];
  return {
    events,
    info(event: string, ctx?: Record<string, unknown>) { events.push({ level: "info", event, ctx: ctx ?? {} }); },
    warn(event: string, ctx?: Record<string, unknown>) { events.push({ level: "warn", event, ctx: ctx ?? {} }); },
    error(event: string, ctx?: Record<string, unknown>) { events.push({ level: "error", event, ctx: ctx ?? {} }); },
    debug(event: string, ctx?: Record<string, unknown>) { events.push({ level: "debug", event, ctx: ctx ?? {} }); },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("CELLO-M6B-019: Node Registry — multiaddr construction", () => {
  // AC-003: DNS multiaddr construction from SSM entry
  it("AC-003: constructRelayMultiaddr builds /dns4/ multiaddr from SSM entry", () => {
    const entry: NodeRegistryEntry = {
      hostname: "relay-us1.cello.mygentic.ai",
      peerId: "12D3KooWAbCdEfGhIjKlMnOpQrStUvWxYz1234567890",
      port: 443,
      transport: "ws",
      status: "active",
    };
    const result = constructRelayMultiaddr(entry);
    expect(result).toBe("/dns4/relay-us1.cello.mygentic.ai/tcp/443/ws/p2p/12D3KooWAbCdEfGhIjKlMnOpQrStUvWxYz1234567890");
  });

  // SI-001: Must not contain /ip4/ anywhere
  it("SI-001: constructed multiaddr never contains /ip4/", () => {
    const entry: NodeRegistryEntry = {
      hostname: "relay-eu1.cello.mygentic.ai",
      peerId: "12D3KooWTestPeerId",
      port: 80,
      transport: "ws",
      status: "active",
    };
    const result = constructRelayMultiaddr(entry);
    expect(result).not.toContain("/ip4/");
    expect(result).toContain("/dns4/");
  });
});

describe("CELLO-M6B-019: Node Registry — SSM parameter parsing", () => {
  let logger: ReturnType<typeof createCapturingLogger>;

  beforeEach(() => {
    logger = createCapturingLogger();
  });

  // AC-003: Successfully parses valid SSM parameters into NodeRegistryRelayResult
  it("AC-003: parseNodeRegistryEntries parses valid relay SSM params and logs node.registry.loaded", () => {
    const ssmParams = [
      {
        Name: "/cello/dev/nodes/relay/aws-us-east-1",
        Value: JSON.stringify({
          hostname: "relay-us1.cello.mygentic.ai",
          peerId: "12D3KooWRelay1",
          port: 443,
          transport: "ws",
          status: "active",
        }),
      },
      {
        Name: "/cello/dev/nodes/relay/aws-eu-central-1",
        Value: JSON.stringify({
          hostname: "relay-eu1.cello.mygentic.ai",
          peerId: "12D3KooWRelay2",
          port: 443,
          transport: "ws",
          status: "active",
        }),
      },
      {
        Name: "/cello/dev/nodes/directory/aws-us-east-1",
        Value: JSON.stringify({
          hostname: "directory-us1.cello.mygentic.ai",
          peerId: "12D3KooWDir1",
          port: 80,
          transport: "ws",
          status: "active",
        }),
      },
    ];

    const result = parseNodeRegistryEntries(ssmParams, "/cello/dev/nodes/", "us-east-1", logger);

    expect(result.relays).toHaveLength(2);
    expect(result.directories).toHaveLength(1);

    // Verify multiaddr construction for first relay
    expect(result.relays[0]!.multiaddr).toBe("/dns4/relay-us1.cello.mygentic.ai/tcp/443/ws/p2p/12D3KooWRelay1");
    expect(result.relays[0]!.peerId).toBe("12D3KooWRelay1");
    expect(result.relays[0]!.hostname).toBe("relay-us1.cello.mygentic.ai");
    expect(result.relays[0]!.region).toBe("aws-us-east-1");

    // Verify node.registry.loaded logged
    const loadedEvent = logger.events.find(e => e.event === "node.registry.loaded");
    expect(loadedEvent).toBeDefined();
    expect(loadedEvent!.ctx.relayCount).toBe(2);
    expect(loadedEvent!.ctx.directoryCount).toBe(1);
    expect(loadedEvent!.ctx.source).toBe("ssm");

    // Verify node.registry.relay.resolved logged for each relay
    const resolvedEvents = logger.events.filter(e => e.event === "node.registry.relay.resolved");
    expect(resolvedEvents).toHaveLength(2);
    expect(resolvedEvents[0]!.ctx.hostname).toBe("relay-us1.cello.mygentic.ai");
    expect(resolvedEvents[0]!.ctx.peerId).toBe("12D3KooWRelay1");
    expect(resolvedEvents[0]!.ctx.multiaddr).toContain("/dns4/");
  });

  // DB-001: Empty SSM params log node.registry.empty at ERROR
  it("DB-001: parseNodeRegistryEntries logs node.registry.empty when no relay entries found", () => {
    const ssmParams = [
      {
        Name: "/cello/dev/nodes/directory/aws-us-east-1",
        Value: JSON.stringify({
          hostname: "directory-us1.cello.mygentic.ai",
          peerId: "12D3KooWDir1",
          port: 80,
          transport: "ws",
          status: "active",
        }),
      },
    ];

    const result = parseNodeRegistryEntries(ssmParams, "/cello/dev/nodes/", "us-east-1", logger);

    expect(result.relays).toHaveLength(0);

    // Verify node.registry.empty logged
    const emptyEvent = logger.events.find(e => e.event === "node.registry.empty");
    expect(emptyEvent).toBeDefined();
    expect(emptyEvent!.level).toBe("error");
    // ssmPath must be the real path passed to the function (not a placeholder template)
    expect(emptyEvent!.ctx.ssmPath).toBe("/cello/dev/nodes/");
    expect(emptyEvent!.ctx.region).toBe("us-east-1");
    expect(emptyEvent!.ctx.guidance).toBeDefined();
  });

  // Observability: node.registry.parse.failed for malformed JSON
  it("logs node.registry.parse.failed for malformed JSON SSM parameter", () => {
    const ssmParams = [
      {
        Name: "/cello/dev/nodes/relay/aws-us-east-1",
        Value: "not valid json {{{",
      },
    ];

    const result = parseNodeRegistryEntries(ssmParams, "/cello/dev/nodes/", "us-east-1", logger);

    expect(result.relays).toHaveLength(0);

    // Verify node.registry.parse.failed logged
    const failedEvent = logger.events.find(e => e.event === "node.registry.parse.failed");
    expect(failedEvent).toBeDefined();
    expect(failedEvent!.level).toBe("warn");
    expect(failedEvent!.ctx.parameterName).toBe("/cello/dev/nodes/relay/aws-us-east-1");
    expect(failedEvent!.ctx.error).toBeDefined();
  });

  // Parse failure: missing required fields
  it("logs node.registry.parse.failed for entry missing required fields", () => {
    const ssmParams = [
      {
        Name: "/cello/dev/nodes/relay/aws-us-east-1",
        Value: JSON.stringify({ hostname: "relay.example.com" }), // missing peerId, port, transport, status
      },
    ];

    const result = parseNodeRegistryEntries(ssmParams, "/cello/dev/nodes/", "us-east-1", logger);

    expect(result.relays).toHaveLength(0);

    const failedEvent = logger.events.find(e => e.event === "node.registry.parse.failed");
    expect(failedEvent).toBeDefined();
  });

  // LOW #2: empty SSM response (zero params) emits node.registry.empty with the real ssmPath.
  // This covers CRITICAL #2: when deploy.sh step 6.7 has not yet run in a new region,
  // SSM responds successfully with zero parameters. parseNodeRegistryEntries must still
  // emit node.registry.empty with the actual path so operators know where to look.
  it("LOW #2: empty SSM params array emits node.registry.empty with real ssmPath", () => {
    const result = parseNodeRegistryEntries([], "/cello/dev/nodes/", "us-east-1", logger);

    expect(result.relays).toHaveLength(0);

    const emptyEvent = logger.events.find(e => e.event === "node.registry.empty");
    expect(emptyEvent).toBeDefined();
    expect(emptyEvent!.level).toBe("error");
    // ssmPath must be the real path, not a literal placeholder like "/cello/{env}/nodes/relay/"
    expect(emptyEvent!.ctx.ssmPath).toBe("/cello/dev/nodes/");
    expect(emptyEvent!.ctx.region).toBe("us-east-1");
    expect(emptyEvent!.ctx.guidance).toContain("/cello/dev/nodes/");
  });

  // Entries with inactive status are excluded
  it("excludes entries with status !== 'active'", () => {
    const ssmParams = [
      {
        Name: "/cello/dev/nodes/relay/aws-us-east-1",
        Value: JSON.stringify({
          hostname: "relay-us1.cello.mygentic.ai",
          peerId: "12D3KooWRelay1",
          port: 443,
          transport: "ws",
          status: "draining",
        }),
      },
    ];

    const result = parseNodeRegistryEntries(ssmParams, "/cello/dev/nodes/", "us-east-1", logger);

    expect(result.relays).toHaveLength(0);
  });
});

describe("CELLO-M6B-019: RelayPoolManager — seed relay entries", () => {
  let logger: ReturnType<typeof createCapturingLogger>;

  beforeEach(() => {
    logger = createCapturingLogger();
  });

  // AC-004: pickRelay() returns valid endpoint after seeding (no relay_register needed)
  it("AC-004: pickRelay returns seeded entry before any relay_register arrives", () => {
    // Create a minimal RelayPoolManager with no manifest (local/test mode)
    const storage: CloudStorageProvider = {
      upload: async () => {},
      download: async () => undefined,
    };
    const mgr = new RelayPoolManager({
      storage,
      signerPublicKeyHex: "a".repeat(64),
      logger,
    });

    // Seed relay entries from SSM data
    mgr.seedRelayEntries([
      {
        relayId: "relay-us1",
        endpoint: "wss://relay-us1.cello.mygentic.ai",
        region: "us-east-1",
        status: "active",
        healthCheckUrl: "", // Empty — not yet received from relay_register
        peerId: "12D3KooWRelay1",
        multiaddrs: ["/dns4/relay-us1.cello.mygentic.ai/tcp/443/ws/p2p/12D3KooWRelay1"],
      },
    ]);

    // pickRelay() should return the seeded entry
    const picked = mgr.pickRelay();
    expect(picked).not.toBeNull();
    expect(picked!.peerId).toBe("12D3KooWRelay1");
    expect(picked!.multiaddrs).toEqual(["/dns4/relay-us1.cello.mygentic.ai/tcp/443/ws/p2p/12D3KooWRelay1"]);

    mgr.stop();
  });

  // AC-006: relay_register → reSignManifestForRelay → S3 write → applyManifest poll cycle
  // This tests the actual risk: that calling reSignManifestForRelay WITHOUT a multiaddr
  // (as fixed by CRITICAL #1) followed by applyManifest (simulating a 2-minute poll) still
  // preserves the DNS multiaddrs from SSM seeding.
  //
  // Before CRITICAL #1 fix: reSignManifestForRelay would write the raw /ip4/ multiaddr from
  // relay_register into the S3 manifest. applyManifest would see non-empty multiaddrs in the
  // manifest and skip the SSM DNS merge — permanently replacing DNS addresses with the raw IP.
  // After fix: reSignManifestForRelay only updates healthCheckUrl. applyManifest merges the
  // SSM DNS multiaddrs unconditionally (IMPORTANT #2 fix), preserving them across poll cycles.
  it("AC-006: DNS multiaddrs survive relay_register → reSignManifestForRelay (no multiaddr) → applyManifest poll cycle", () => {
    const storage: CloudStorageProvider = {
      upload: async () => {},
      download: async () => undefined,
    };
    const mgr = new RelayPoolManager({
      storage,
      signerPublicKeyHex: "a".repeat(64),
      logger,
    });

    const dnsMultiaddr = "/dns4/relay-us1.cello.mygentic.ai/tcp/443/ws/p2p/12D3KooWRelay1";

    // Step 1: Seed relay entries from SSM (DNS multiaddrs, no healthCheckUrl yet)
    mgr.seedRelayEntries([
      {
        relayId: "relay-us1",
        endpoint: "wss://relay-us1.cello.mygentic.ai",
        region: "us-east-1",
        status: "active",
        healthCheckUrl: "",
        peerId: "12D3KooWRelay1",
        multiaddrs: [dnsMultiaddr],
      },
    ]);

    // Verify initial state: pickRelay() returns DNS multiaddr
    const initialPick = mgr.pickRelay();
    expect(initialPick).not.toBeNull();
    expect(initialPick!.multiaddrs).toEqual([dnsMultiaddr]);

    // Step 2: Simulate relay_register → reSignManifestForRelay WITHOUT multiaddr.
    // The fixed code in directory-node.ts omits multiaddr from this call (CRITICAL #1 fix).
    // We simulate this by calling reSignManifestForRelay without a multiaddr, but since
    // reSignManifestForRelay requires S3 round-trip (download→upload), we simulate the
    // post-call state directly: the healthCheckUrl map is updated but in-memory multiaddrs
    // are NOT changed (because no multiaddr was passed).
    // updateRelayHealthCheckUrl is what reSignManifestForRelay calls internally after upload.
    mgr.updateRelayHealthCheckUrl("relay-us1", "http://10.0.1.50:4000/health");

    // Step 3: Simulate a 2-minute manifest poll — applyManifest is called with a manifest
    // that came from S3 BEFORE reSignManifestForRelay was called (i.e. missing multiaddrs/peerId,
    // as if deploy.sh wrote the manifest without those fields). This represents the state of
    // the manifest on a fresh region where sign-manifest.sh ran before relay first started.
    const simulatedS3Manifest = {
      version: 2, // Higher version so applyManifest accepts it
      signedBy: "a".repeat(64),
      signature: "b".repeat(128),
      updatedAt: new Date().toISOString(),
      relays: [
        {
          relayId: "relay-us1",
          endpoint: "wss://relay-us1.cello.mygentic.ai",
          region: "us-east-1",
          status: "active" as const,
          healthCheckUrl: "http://10.0.1.50:4000/health",
          // multiaddrs and peerId intentionally absent — as would be the case if
          // reSignManifestForRelay was called WITHOUT multiaddr (CRITICAL #1 fix)
        },
      ],
    };

    // Note: applyManifest does NOT verify the signature — loadManifest does that.
    // Calling applyManifest directly is correct for testing the merge logic.
    const applyResult = mgr.applyManifest(simulatedS3Manifest);
    expect(applyResult.ok).toBe(true);

    // Step 4: Assert that pickRelay() still returns DNS multiaddr after the poll cycle.
    // This is the core AC-006 / SI-001 invariant: relay_register must not cause loss of
    // DNS-based addressing. The SSM seeded /dns4/ multiaddr must survive applyManifest.
    const picked = mgr.pickRelay();
    expect(picked).not.toBeNull();
    expect(picked!.multiaddrs).toContain(dnsMultiaddr);
    expect(picked!.multiaddrs?.every(a => !a.includes("/ip4/"))).toBe(true);
    expect(picked!.peerId).toBe("12D3KooWRelay1");

    // Step 5: Assert that healthCheckUrl from relay_register is also visible
    expect(mgr.getRelayHealthCheckUrl("relay-us1")).toBe("http://10.0.1.50:4000/health");

    mgr.stop();
  });

  // HIGH #1: seedRelayEntries does not overwrite healthCheckUrl from prior relay_register
  it("seedRelayEntries preserves existing healthCheckUrl and failureState for known relays", () => {
    const storage: CloudStorageProvider = {
      upload: async () => {},
      download: async () => undefined,
    };
    const mgr = new RelayPoolManager({
      storage,
      signerPublicKeyHex: "a".repeat(64),
      logger,
    });

    // First seed: relay-us1 with empty healthCheckUrl (SSM data at startup)
    mgr.seedRelayEntries([
      {
        relayId: "relay-us1",
        endpoint: "wss://relay-us1.cello.mygentic.ai",
        region: "us-east-1",
        status: "active",
        healthCheckUrl: "",
        peerId: "12D3KooWRelay1",
        multiaddrs: ["/dns4/relay-us1.cello.mygentic.ai/tcp/443/ws/p2p/12D3KooWRelay1"],
      },
    ]);

    // Simulate relay_register providing the healthCheckUrl
    mgr.updateRelayHealthCheckUrl("relay-us1", "http://10.0.1.50:4000/health");

    // Second seed: same relay with empty healthCheckUrl (e.g. re-reading SSM)
    mgr.seedRelayEntries([
      {
        relayId: "relay-us1",
        endpoint: "wss://relay-us1.cello.mygentic.ai",
        region: "us-east-1",
        status: "active",
        healthCheckUrl: "", // SSM doesn't know the VPC health URL
        peerId: "12D3KooWRelay1Updated",
        multiaddrs: ["/dns4/relay-us1.cello.mygentic.ai/tcp/443/ws/p2p/12D3KooWRelay1Updated"],
      },
    ]);

    // healthCheckUrl from relay_register must be preserved in the internal map
    expect(mgr.getRelayHealthCheckUrl("relay-us1")).toBe("http://10.0.1.50:4000/health");

    // LOW #1: re-seeding must NOT overwrite the healthCheckUrl on the entry object itself.
    // The entry object is what pickRelay() returns — it carries the manifest healthCheckUrl
    // (written by reSignManifestForRelay), not the SSM value (which is always empty).
    // seedRelayEntries only updates multiaddrs and peerId on existing entries; healthCheckUrl
    // on the entry object is preserved from the previous state.
    expect(mgr.relays[0]?.healthCheckUrl).toBe("");

    // Addressing fields should be updated from the new seed
    const picked = mgr.pickRelay();
    expect(picked).not.toBeNull();
    expect(picked!.peerId).toBe("12D3KooWRelay1Updated");
    expect(picked!.multiaddrs).toEqual(["/dns4/relay-us1.cello.mygentic.ai/tcp/443/ws/p2p/12D3KooWRelay1Updated"]);

    mgr.stop();
  });

  // Multiple relays seeded
  it("seeds multiple relay entries and pickRelay returns the best available", () => {
    const storage: CloudStorageProvider = {
      upload: async () => {},
      download: async () => undefined,
    };
    const mgr = new RelayPoolManager({
      storage,
      signerPublicKeyHex: "a".repeat(64),
      logger,
    });

    mgr.seedRelayEntries([
      {
        relayId: "relay-us1",
        endpoint: "wss://relay-us1.cello.mygentic.ai",
        region: "us-east-1",
        status: "active",
        healthCheckUrl: "",
        peerId: "12D3KooWRelayUS",
        multiaddrs: ["/dns4/relay-us1.cello.mygentic.ai/tcp/443/ws/p2p/12D3KooWRelayUS"],
      },
      {
        relayId: "relay-eu1",
        endpoint: "wss://relay-eu1.cello.mygentic.ai",
        region: "eu-central-1",
        status: "active",
        healthCheckUrl: "",
        peerId: "12D3KooWRelayEU",
        multiaddrs: ["/dns4/relay-eu1.cello.mygentic.ai/tcp/443/ws/p2p/12D3KooWRelayEU"],
      },
    ]);

    const picked = mgr.pickRelay();
    expect(picked).not.toBeNull();
    // Both are available and have 0 failures — first one should be returned
    expect(picked!.relayId).toMatch(/relay-(us1|eu1)/);

    mgr.stop();
  });
});

describe("CELLO-M6B-019: Node Registry — AC-010 and nodeId field", () => {
  let logger: ReturnType<typeof createCapturingLogger>;

  beforeEach(() => {
    logger = createCapturingLogger();
  });

  // AC-010: CELLO_ENV=local logging of source:'env' is in the composition root (directory.ts)
  // and is not testable here. Coverage is provided by the integration test that runs the full
  // startup with CELLO_ENV=local and asserts the node.registry.loaded event with source:'env'.
  //
  // What IS testable here: that parseNodeRegistryEntries with params that produce zero relay
  // entries (all inactive) still emits node.registry.empty — covering the case where SSM has
  // entries but none are active (a distinct failure mode from no entries at all).
  it("AC-010/DB-001: emits node.registry.empty when all SSM relay entries are inactive", () => {
    const ssmParams = [
      {
        Name: "/cello/dev/nodes/relay/aws-us-east-1",
        Value: JSON.stringify({
          hostname: "relay-us1.cello.mygentic.ai",
          peerId: "12D3KooWRelay1",
          port: 443,
          transport: "ws",
          status: "draining", // inactive — should be excluded
        }),
      },
      {
        Name: "/cello/dev/nodes/relay/aws-eu-central-1",
        Value: JSON.stringify({
          hostname: "relay-eu1.cello.mygentic.ai",
          peerId: "12D3KooWRelay2",
          port: 443,
          transport: "ws",
          status: "inactive", // also excluded
        }),
      },
    ];

    const result = parseNodeRegistryEntries(ssmParams, "/cello/dev/nodes/", "us-east-1", logger);

    expect(result.relays).toHaveLength(0);
    // Must emit node.registry.empty at ERROR — on-call engineers must be alerted
    const emptyEvent = logger.events.find(e => e.event === "node.registry.empty");
    expect(emptyEvent).toBeDefined();
    expect(emptyEvent!.level).toBe("error");
    expect(emptyEvent!.ctx.guidance).toBeDefined();
    // Must NOT also emit node.registry.loaded — that would be misleading
    const loadedEvent = logger.events.find(e => e.event === "node.registry.loaded");
    expect(loadedEvent).toBeUndefined();
  });

  // Finding 2: nodeId field is propagated from SSM entries to NodeRegistryResolvedRelay
  // so relay_register lookup can match by Ed25519 pubkey hex.
  it("nodeId field is propagated from SSM entry to resolved relay result", () => {
    const relayNodeId = "a".repeat(64); // 32-byte Ed25519 pubkey hex
    const ssmParams = [
      {
        Name: "/cello/dev/nodes/relay/aws-us-east-1",
        Value: JSON.stringify({
          hostname: "relay-us1.cello.mygentic.ai",
          peerId: "12D3KooWRelay1",
          nodeId: relayNodeId, // Ed25519 pubkey hex — matches relay_register relayId
          port: 443,
          transport: "ws",
          status: "active",
        }),
      },
    ];

    const result = parseNodeRegistryEntries(ssmParams, "/cello/dev/nodes/", "us-east-1", logger);

    expect(result.relays).toHaveLength(1);
    expect(result.relays[0]!.nodeId).toBe(relayNodeId);
  });

  // Backward-compat: SSM entries without nodeId produce empty string nodeId
  it("nodeId defaults to empty string for backward-compat SSM entries without nodeId field", () => {
    const ssmParams = [
      {
        Name: "/cello/dev/nodes/relay/aws-us-east-1",
        Value: JSON.stringify({
          hostname: "relay-us1.cello.mygentic.ai",
          peerId: "12D3KooWRelay1",
          // nodeId omitted — older SSM entry format
          port: 443,
          transport: "ws",
          status: "active",
        }),
      },
    ];

    const result = parseNodeRegistryEntries(ssmParams, "/cello/dev/nodes/", "us-east-1", logger);

    expect(result.relays).toHaveLength(1);
    expect(result.relays[0]!.nodeId).toBe("");
  });

  // Finding 6: port:0 is rejected as invalid (not just falsy check)
  it("rejects relay entry with port:0 (zero port is invalid)", () => {
    const ssmParams = [
      {
        Name: "/cello/dev/nodes/relay/aws-us-east-1",
        Value: JSON.stringify({
          hostname: "relay-us1.cello.mygentic.ai",
          peerId: "12D3KooWRelay1",
          port: 0, // invalid — zero port should fail validation
          transport: "ws",
          status: "active",
        }),
      },
    ];

    const result = parseNodeRegistryEntries(ssmParams, "/cello/dev/nodes/", "us-east-1", logger);

    expect(result.relays).toHaveLength(0);
    const failedEvent = logger.events.find(e => e.event === "node.registry.parse.failed");
    expect(failedEvent).toBeDefined();
  });
});
