/**
 * CELLO-REG-001: Agent Registration and FROST DKG — client-side tests
 *
 * TDD Phase R — RED-first. Written BEFORE implementation.
 * All new tests MUST FAIL until client.ts REG-001 implementation is complete.
 *
 * Covers (client side):
 *   AC-001: Full registration flow via in-process stubs — register() returns RegistrationState
 *   AC-002: register() on already-registered client → { error: 'already_registered' }
 *   AC-008: After registration, counterparty retrieves primary_pubkey from profile and verifies
 *           a FROST signature produced by the agent's group
 *   AC-010: completed registration → local RegistrationState has agent_id, primary_pubkey, status active
 *           FileMlDsaKeyProvider persists keypair at CELLO_ML_DSA_KEY_FILE with 0o600 permissions
 *
 * In NODE_ENV=test, createInProcessStubs is used for DKG.
 * Crypto refs: RFC 9591 (FROST), NIST FIPS 204 (ML-DSA-44), FIPS 180-4 (SHA-256)
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
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stat } from "node:fs/promises";
import {
  generateKeypair,
} from "@cello/crypto";
import {
  clearTestShares,
} from "@cello/crypto/frost/frost-threshold-signer.js";
import { createNode } from "@cello/transport";
import {
  createDirectoryNode,
} from "@cello/directory";
import type { RelayAdapter } from "@cello/directory";
import type { RelaySessionAssignment } from "@cello/directory";
import { createClient } from "../client.js";

setupV3Tests();

// ─── Relay stub ───────────────────────────────────────────────────────────────

function makeRelay(): RelayAdapter {
  return {
    async recordAssignment(_: RelaySessionAssignment) { return { ok: true as const }; },
    async discardSession() {},
    async submitForSeal() { return { ok: false as const, reason: "not_supported" }; },
    async confirmSeal() {},
    async rejectSeal() {},
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("REG-001: Client registration", () => {
  let scope: ReturnType<typeof createTestScope>;

  beforeEach(() => {
    scope = createTestScope();
    clearTestShares();
  });

  afterEach(async () => {
    await scope.run(async () => {});
    clearTestShares();
  });

  it("AC-001: full registration flow — register() returns RegistrationState with active status", async () => {
    // Setup directory node
    const dirKey = generateKeypair();
    const { node: dirNode, stop: stopDir } = await createDirectoryNode({
      keyProvider: dirKey,
      relay: makeRelay(),
      relayEndpoint: { peer_id: "12D3KooWFakeRelay", multiaddrs: ["/ip4/127.0.0.1/tcp/19999"] },
    });
    scope.addCleanup(stopDir);

    // Setup client node
    const clientKey = generateKeypair();
    const clientNode = await createNode({ keyProvider: clientKey, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await clientNode.start();
    scope.addCleanup(() => clientNode.stop());

    const client = createClient(clientNode, clientKey, {
      directoryEndpoint: {
        peer_id: dirNode.getPeerId(),
        multiaddrs: dirNode.listenAddresses(),
      },
    });

    // register() should return RegistrationState on success
    const result = await client.register("+1234567890");
    if ("error" in result) throw new Error(`Expected success, got error: ${result.error}`);

    expect(result.status).toBe("active");
    expect(typeof result.agent_id).toBe("string");
    expect(Buffer.from(result.agent_id, "hex").length).toBe(16);
    expect(typeof result.primary_pubkey).toBe("string");
    expect(Buffer.from(result.primary_pubkey, "hex").length).toBe(32);
    expect(typeof result.ml_dsa_pubkey).toBe("string");
    expect(Buffer.from(result.ml_dsa_pubkey, "hex").length).toBe(1312);
    expect(typeof result.registered_at).toBe("number");
  });

  it("AC-002: register() on already-registered client → error already_registered", async () => {
    const dirKey = generateKeypair();
    const { node: dirNode, stop: stopDir } = await createDirectoryNode({
      keyProvider: dirKey,
      relay: makeRelay(),
      relayEndpoint: { peer_id: "12D3KooWFakeRelay", multiaddrs: ["/ip4/127.0.0.1/tcp/19999"] },
    });
    scope.addCleanup(stopDir);

    const clientKey = generateKeypair();
    const clientNode = await createNode({ keyProvider: clientKey, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await clientNode.start();
    scope.addCleanup(() => clientNode.stop());

    const client = createClient(clientNode, clientKey, {
      directoryEndpoint: {
        peer_id: dirNode.getPeerId(),
        multiaddrs: dirNode.listenAddresses(),
      },
    });

    // First registration succeeds
    const first = await client.register("+9876543210");
    if ("error" in first) throw new Error(`Expected success, got error: ${first.error}`);
    expect(first.status).toBe("active");

    // Second call should return already_registered error
    const second = await client.register("+9876543210");
    expect((second as { error: string }).error).toBe("already_registered");
  });

  it("AC-008: registered agent — counterparty retrieves primary_pubkey from profile and verifies FROST sig", async () => {
    // This test verifies that after registration, another party can:
    // 1. Retrieve the primary_pubkey from the directory
    // 2. Use it to verify a FROST signature produced by the agent's group
    const dirKey = generateKeypair();
    const { directory, node: dirNode, stop: stopDir } = await createDirectoryNode({
      keyProvider: dirKey,
      relay: makeRelay(),
      relayEndpoint: { peer_id: "12D3KooWFakeRelay", multiaddrs: ["/ip4/127.0.0.1/tcp/19999"] },
    });
    scope.addCleanup(stopDir);

    const clientKey = generateKeypair();
    const clientNode = await createNode({ keyProvider: clientKey, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await clientNode.start();
    scope.addCleanup(() => clientNode.stop());

    const client = createClient(clientNode, clientKey, {
      directoryEndpoint: {
        peer_id: dirNode.getPeerId(),
        multiaddrs: dirNode.listenAddresses(),
      },
    });

    const registration = await client.register("+5551234567");
    if ("error" in registration) throw new Error(`Expected success, got error: ${registration.error}`);
    expect(registration.status).toBe("active");

    // Counterparty retrieves primary_pubkey from directory profile
    const clientPubkey = await clientKey.getPublicKey();
    const profileKey = Buffer.from(clientPubkey).toString("hex");
    const profile = directory.getProfile(profileKey);
    expect(profile).toBeDefined();
    expect(registration.primary_pubkey).toBe(profile!.primary_pubkey);

    // Counterparty verifies a FROST signature produced by the agent's group.
    // Use the threshold signer the directory registered post-DKG.
    const signer = directory.getThresholdSignerForTest(profileKey);
    expect(signer).toBeDefined();

    const tbs = new Uint8Array([1, 2, 3, 4, 5]); // arbitrary test payload
    const sigResult = await signer!.participateInCeremony("ac008-test-ceremony", tbs, "cello-frost-seal-v1");
    expect(sigResult.ok).toBe(true);
    if (!sigResult.ok) throw new Error("participateInCeremony failed unexpectedly");

    const primaryPubkeyBytes = Buffer.from(registration.primary_pubkey, "hex");
    const verified = signer!.verifySignature(sigResult.signature, tbs, "cello-frost-seal-v1", primaryPubkeyBytes);
    expect(verified).toBe(true);
  });

  it("AC-010: completed registration — RegistrationState has correct fields; FileMlDsaKeyProvider persists with 0o600", async () => {
    const dirKey = generateKeypair();
    const { node: dirNode, stop: stopDir } = await createDirectoryNode({
      keyProvider: dirKey,
      relay: makeRelay(),
      relayEndpoint: { peer_id: "12D3KooWFakeRelay", multiaddrs: ["/ip4/127.0.0.1/tcp/19999"] },
    });
    scope.addCleanup(stopDir);

    // Set up temp key file path
    const keyFilePath = join(tmpdir(), `cello-test-mldsa-${randomBytes(8).toString("hex")}`);
    // Clean up after test
    scope.addCleanup(async () => {
      const { unlink } = await import("node:fs/promises");
      await unlink(keyFilePath).catch(() => {});
    });

    const clientKey = generateKeypair();
    const clientNode = await createNode({ keyProvider: clientKey, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await clientNode.start();
    scope.addCleanup(() => clientNode.stop());

    const client = createClient(clientNode, clientKey, {
      directoryEndpoint: {
        peer_id: dirNode.getPeerId(),
        multiaddrs: dirNode.listenAddresses(),
      },
      mlDsaKeyFile: keyFilePath,
    });

    const result = await client.register("+4445556666");
    if ("error" in result) throw new Error(`Expected success, got error: ${result.error}`);

    // Check RegistrationState fields
    expect(result.status).toBe("active");
    expect(typeof result.agent_id).toBe("string");
    expect(Buffer.from(result.agent_id, "hex").length).toBe(16);
    expect(typeof result.primary_pubkey).toBe("string");
    expect(Buffer.from(result.primary_pubkey, "hex").length).toBe(32);
    expect(typeof result.ml_dsa_pubkey).toBe("string");
    expect(Buffer.from(result.ml_dsa_pubkey, "hex").length).toBe(1312);
    expect(typeof result.registered_at).toBe("number");

    // Check key file exists with 0o600 permissions
    const fileStat = await stat(keyFilePath);
    const mode = fileStat.mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
