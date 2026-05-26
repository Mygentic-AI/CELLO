/**
 * Client-side reconnect state tests (2026-05-19 audit)
 *
 * Covers the client-side state reconstruction paths implemented during the
 * 2026-05-19 live session fixes. Wire protocol verification is in:
 *   packages/directory/src/__tests__/persist-reconnect-protocol.test.ts
 *   packages/directory/src/__tests__/persist-reconnect-session-survival.test.ts
 *
 * Two sessions on one connection (RECONNECT-CLIENT-003) is already covered by
 * E2E SESSION-006-AC-007 in packages/e2e-tests — not duplicated here.
 *
 * RECONNECT-CLIENT-001: already_registered → RegistrationState reconstructed, DKG skipped
 *   When register() receives an already_registered error frame with agent_id,
 *   primary_pubkey, and ml_dsa_pubkey, the client must reconstruct RegistrationState
 *   from the frame fields — no new DKG ceremony.
 *
 * RECONNECT-CLIENT-002: already_connected → connection store hydrated → proceed
 *   When cello_request_connection() receives an already_connected error frame with
 *   connection_id, the client must hydrate its in-memory connection store and return
 *   established with the existing connection_id.
 */

import {
  setupV3Tests,
  createTestScope,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@claude-flow/testing";
import type { TestScope } from "@claude-flow/testing";
import {
  generateKeypair,
  mlDsaKeygen,
} from "@cello-protocol/crypto";
import { clearTestShares } from "@cello-protocol/crypto/frost/frost-threshold-signer.js";
import {
  encodeConnectionPackage,
  buildPseudonymBinding,
} from "@cello-protocol/protocol-types";
import type { ConnectionPackage } from "@cello-protocol/protocol-types";
import { createNode } from "@cello-protocol/transport";
import { createDirectoryNode } from "@cello-protocol/directory";
import type { RelayAdapter, RelaySessionAssignment } from "@cello-protocol/directory";
import { createClient } from "../client.js";
import type { SignalRequirementPolicy } from "../connection-policy.js";

setupV3Tests();

function makeRelay(): RelayAdapter {
  return {
    async recordAssignment(_: RelaySessionAssignment) { return { ok: true as const }; },
    async discardSession() {},
    async submitForSeal() { return { ok: false as const, reason: "not_supported" }; },
    async confirmSeal() {},
    async rejectSeal() {},
  };
}

async function buildMinimalPackageCbor(
  keyProvider: ReturnType<typeof generateKeypair>,
  mlDsaProvider: Awaited<ReturnType<typeof mlDsaKeygen>>,
  primaryPubkeyHex?: string,
): Promise<Uint8Array> {
  const kLocalPubkey = new Uint8Array(await keyProvider.getPublicKey());
  const primaryPubkey = primaryPubkeyHex
    ? Buffer.from(primaryPubkeyHex, "hex")
    : new Uint8Array(32);
  const mlDsaPubkey = new Uint8Array(await mlDsaProvider.getPublicKey());
  const bindingResult = await buildPseudonymBinding(
    {
      pseudonym_label: "test-agent",
      k_local_pubkey: kLocalPubkey,
      primary_pubkey: new Uint8Array(primaryPubkey),
      ml_dsa_pubkey: mlDsaPubkey,
      created_at: Date.now(),
    },
    mlDsaProvider,
  );
  if (!bindingResult.ok) throw new Error("buildPseudonymBinding failed");
  const pkg: ConnectionPackage = {
    pseudonym_binding: bindingResult.binding,
    endorsements: [],
    attestations: [],
  };
  return encodeConnectionPackage(pkg);
}

const openPolicy: SignalRequirementPolicy = {
  mode: "open",
  review_mode: "deterministic",
  requirements: [],
};

let scope: TestScope;
beforeEach(() => { scope = createTestScope(); clearTestShares(); });
afterEach(() => {
  clearTestShares();
  return scope.run(async () => {});
});

// ─── RECONNECT-CLIENT-001 ─────────────────────────────────────────────────────

describe("RECONNECT-CLIENT-001: already_registered → RegistrationState reconstructed", () => {
  it("register() returns reconstructed RegistrationState (not an error) when agent is already registered", async () => {
    const dirKey = generateKeypair();
    const { node: dirNode, stop: stopDir } = await createDirectoryNode({
      keyProvider: dirKey,
      relay: makeRelay(),
      relayEndpoint: { peer_id: "12D3KooWFakeRelay", multiaddrs: [] },
      requireRegistration: true,
    });
    scope.addCleanup(stopDir);

    const clientKey = generateKeypair();
    const directoryEndpoint = {
      peer_id: dirNode.getPeerId(),
      multiaddrs: dirNode.listenAddresses(),
    };

    // Session 1: register successfully — performs DKG
    const node1 = await createNode({ keyProvider: clientKey, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await node1.start();
    const client1 = createClient(node1, clientKey, { directoryEndpoint, connectionPolicy: openPolicy });
    await client1.registerHandler();
    const first = await client1.register("+15550001001");
    // Stop node1 before starting node2 — same pubkey from two nodes concurrently confuses the directory
    await node1.stop();

    if ("error" in first) throw new Error(`Expected success, got: ${first.error}`);
    const originalAgentId = first.agent_id;
    const originalPrimaryPubkey = first.primary_pubkey;
    const originalMlDsaPubkey = first.ml_dsa_pubkey;

    // Session 2: fresh client, same key — simulates new Claude/MCP session after restart
    const node2 = await createNode({ keyProvider: clientKey, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await node2.start();
    scope.addCleanup(() => node2.stop());
    const client2 = createClient(node2, clientKey, { directoryEndpoint, connectionPolicy: openPolicy });
    await client2.registerHandler();

    // Must return reconstructed RegistrationState — NOT { error: 'already_registered' }
    const second = await client2.register("+15550001001");

    expect("error" in second).toBe(false);
    if ("error" in second) throw new Error(`Expected reconstructed state, got error: ${second.error}`);

    // Fields reconstructed from the error frame must match the original registration
    expect(second.agent_id).toBe(originalAgentId);
    expect(second.primary_pubkey).toBe(originalPrimaryPubkey);
    expect(second.status).toBe("active");
    // ml_dsa_pubkey must match the directory-stored value from session 1, not the freshly-generated session-2 key
    expect(second.ml_dsa_pubkey).toBe(originalMlDsaPubkey);

    // RegistrationState must be cached — getRegistrationState() returns it
    const cached = client2.getRegistrationState();
    expect(cached).not.toBeNull();
    expect(cached!.agent_id).toBe(originalAgentId);
    expect(cached!.primary_pubkey).toBe(originalPrimaryPubkey);
  });
});

// ─── RECONNECT-CLIENT-002 ─────────────────────────────────────────────────────

describe("RECONNECT-CLIENT-002: already_connected → connection store hydrated", () => {
  it("cello_request_connection() returns established with existing connection_id and hydrates the connection store", async () => {
    const dirKey = generateKeypair();
    const kpA = generateKeypair();
    const kpB = generateKeypair();

    const { node: dirNode, stop: stopDir } = await createDirectoryNode({
      keyProvider: dirKey,
      relay: makeRelay(),
      relayEndpoint: { peer_id: "12D3KooWFakeRelay", multiaddrs: [] },
      requireRegistration: true,
    });
    scope.addCleanup(stopDir);

    const directoryEndpoint = {
      peer_id: dirNode.getPeerId(),
      multiaddrs: dirNode.listenAddresses(),
    };

    // Agent B — stays running throughout
    const nodeB = await createNode({ keyProvider: kpB, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await nodeB.start();
    scope.addCleanup(() => nodeB.stop());
    const clientB = createClient(nodeB, kpB, { directoryEndpoint, connectionPolicy: openPolicy });
    await clientB.registerHandler();
    const regB = await clientB.register("+15550002002");
    if ("error" in regB) throw new Error(`B reg failed: ${regB.error}`);
    const pubkeyBHex = Buffer.from(await kpB.getPublicKey()).toString("hex");

    // Agent A session 1: register and connect to B
    const nodeA1 = await createNode({ keyProvider: kpA, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await nodeA1.start();
    const mlDsaA = await mlDsaKeygen();
    const clientA1 = createClient(nodeA1, kpA, { directoryEndpoint, connectionPolicy: openPolicy, connectionTimeoutMs: 10_000 });
    await clientA1.registerHandler();
    const regA = await clientA1.register("+15550002001");
    if ("error" in regA) throw new Error(`A reg failed: ${regA.error}`);

    const packageCbor = await buildMinimalPackageCbor(kpA, mlDsaA, regA.primary_pubkey);
    const conn1 = await clientA1.cello_request_connection({ target_pubkey: pubkeyBHex, package_cbor: packageCbor });
    expect(conn1.result).toBe("established");
    const originalConnectionId = (conn1 as { result: "established"; connection_id: string }).connection_id;

    // Session 1 ends — stop nodeA1 before starting nodeA2 (same key, one node at a time)
    await nodeA1.stop();

    // Agent A session 2: fresh client, same key, empty in-memory state
    const nodeA2 = await createNode({ keyProvider: kpA, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await nodeA2.start();
    scope.addCleanup(() => nodeA2.stop());
    const mlDsaA2 = await mlDsaKeygen();
    const clientA2 = createClient(nodeA2, kpA, { directoryEndpoint, connectionPolicy: openPolicy, connectionTimeoutMs: 10_000 });
    await clientA2.registerHandler();

    // Reconstruct registration state first
    const regA2 = await clientA2.register("+15550002001");
    if ("error" in regA2) throw new Error(`A2 reg failed: ${regA2.error}`);

    const packageCbor2 = await buildMinimalPackageCbor(kpA, mlDsaA2, regA2.primary_pubkey);

    // Already connected — must return established with the existing connection_id
    const conn2 = await clientA2.cello_request_connection({ target_pubkey: pubkeyBHex, package_cbor: packageCbor2 });
    expect(conn2.result).toBe("established");
    const hydratedConnectionId = (conn2 as { result: "established"; connection_id: string }).connection_id;

    // Must return the same connection_id as session 1 — not a new one
    expect(hydratedConnectionId).toBe(originalConnectionId);

    // Connection store must be hydrated — hasConnection() finds it
    const storedId = clientA2.hasConnection(pubkeyBHex);
    expect(storedId).toBe(originalConnectionId);
  });
});
