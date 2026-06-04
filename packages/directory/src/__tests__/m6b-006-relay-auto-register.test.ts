/**
 * CELLO-M6B-006: Relay auto-registration and manifest re-signing tests
 *
 * Specification (S phase):
 *
 * AC-003: Directory re-signs manifest when a relay registers with a new healthCheckUrl.
 *   The S3 manifest for this region is updated, version increments, and signature passes
 *   Ed25519 verification against the directory's public key.
 *
 * AC-004: Directory skips manifest re-sign when healthCheckUrl unchanged (same ECS task IP).
 *   relay.manifest.updated is NOT logged, version stays the same.
 *
 * AC-005: Directory updates manifest when healthCheckUrl changes to a new value (new ECS task).
 *   relay_register_ok sent, manifest updated with new URL, signature valid.
 *
 * AC-006: relay_register_ok sent even if S3 upload fails. The error is caught and logged
 *   as relay.manifest.update.failed. Registration is not rolled back.
 *   Verified by two tests: (1) unit-level: reSignManifestForRelay throws on upload failure;
 *   (2) wired: full DirectoryNode handler sends relay_register_ok before upload failure,
 *   relay.manifest.update.failed is logged by handler's .catch() callback.
 *
 * AC-007b: infra/sign-manifest.sh uses shallow key-sort matching buildCanonicalPayload().
 *   Verified by running the same canonical payload construction as the script and confirming
 *   the signature verifies in RelayPoolManager.
 *
 * SI-001: Manifest signature verifiable against directory public key. After re-sign,
 *   ed25519.verify(signature, canonicalPayload, dirPubkey) === true.
 *
 * Observability:
 *   relay.manifest.updated — INFO, context: { relayId, region, manifestVersion, healthCheckUrl }
 *   relay.manifest.update.failed — ERROR, context: { relayId, region, reason }
 */

import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryKeyProvider, generateKeypair, buildRelayRegistrationTbs } from "@cello-protocol/crypto";
import type { CloudStorageProvider, Logger } from "@cello-protocol/interfaces";
import { InMemoryDirectoryStore } from "@cello-protocol/interfaces/stubs";
import { RelayPoolManager } from "../relay-pool-manager.js";
import type { RelayPoolManifest, RelayManifestEntry } from "../relay-pool-manager.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import { Encoder, decode as cborDecode } from "cbor-x";
import * as lp from "it-length-prefixed";
import { createNode } from "@cello-protocol/transport";
import { createDirectoryNode } from "../directory-node.js";
import type { RelayAdapter } from "../directory-node.js";
import type { Stream } from "@libp2p/interface";

const CBOR_ENC = new Encoder({ tagUint8Array: false });
const DIRECTORY_RELAY_PROTOCOL = "/cello/directory-relay/1.0.0";

function makeNoOpRelayAdapter(): RelayAdapter {
  return {
    recordAssignment: () => ({ ok: false as const, reason: "stub" }),
    discardSession: () => {},
    submitForSeal: () => ({ ok: false as const, reason: "stub" }),
    confirmSeal: () => {},
    rejectSeal: () => {},
  };
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

/** Generate a test Ed25519 key pair deterministically from a seed integer. */
function makeTestKeypair(seed: number) {
  const privateKey = new Uint8Array(32).fill(seed);
  const publicKey = ed25519.getPublicKey(privateKey);
  return {
    privateKey,
    publicKey,
    publicKeyHex: Buffer.from(publicKey).toString("hex"),
    keyProvider: new InMemoryKeyProvider(privateKey),
  };
}

/** Canonical JSON signing: sorted top-level keys, no whitespace, UTF-8. */
function canonicalJson(obj: Record<string, unknown>): Uint8Array {
  const sorted = Object.fromEntries(
    Object.keys(obj).sort().map(k => [k, (obj as Record<string, unknown>)[k]])
  );
  return new TextEncoder().encode(JSON.stringify(sorted));
}

/** Build and sign a valid relay pool manifest. */
function buildSignedManifest(
  privateKey: Uint8Array,
  publicKeyHex: string,
  relays: RelayManifestEntry[],
  version = 1,
  updatedAt?: string,
): RelayPoolManifest {
  const ts = updatedAt ?? new Date().toISOString();
  const body = { version, updatedAt: ts, relays };
  const payload = canonicalJson(body as unknown as Record<string, unknown>);
  const signature = ed25519.sign(payload, privateKey);
  return {
    version,
    signedBy: publicKeyHex,
    signature: Buffer.from(signature).toString("hex"),
    updatedAt: ts,
    relays,
  };
}

// Test helper: in-memory CloudStorageProvider stub
class InMemoryCloudStorage implements CloudStorageProvider {
  #files = new Map<string, Uint8Array>();
  #uploadShouldFail = false;

  async upload(key: string, data: Uint8Array): Promise<void> {
    if (this.#uploadShouldFail) {
      throw new Error("simulated_upload_failure");
    }
    this.#files.set(key, data);
  }

  async download(key: string): Promise<Uint8Array | undefined> {
    return this.#files.get(key);
  }

  simulateUploadFailure(shouldFail: boolean): void {
    this.#uploadShouldFail = shouldFail;
  }

  getFile(key: string): Uint8Array | undefined {
    return this.#files.get(key);
  }

  setFile(key: string, data: Uint8Array): void {
    this.#files.set(key, data);
  }
}

/** Spy logger that captures events for assertion. */
function makeSpyLogger() {
  const events: Array<{ level: string; event: string; context: Record<string, unknown> }> = [];
  const logger: Logger = {
    debug() {},
    info(event: string, context?) { events.push({ level: "info", event, context: context ?? {} }); },
    warn(event: string, context?) { events.push({ level: "warn", event, context: context ?? {} }); },
    error(event: string, errorOrContext?, context?) {
      const ctx = errorOrContext instanceof Error
        ? (context ?? {})
        : (errorOrContext ?? {});
      events.push({ level: "error", event, context: ctx as Record<string, unknown> });
    },
  };
  return { logger, events };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("CELLO-M6B-006: Relay Auto-Registration", () => {
  const dirKp = makeTestKeypair(1);
  const RELAY_A: RelayManifestEntry = {
    relayId: "aaaa1111",
    endpoint: "wss://relay1.example.com",
    region: "us-east-1",
    status: "active",
    healthCheckUrl: "http://10.0.1.50:4000/health",
  };

  describe("AC-003: Directory re-signs manifest when healthCheckUrl changes", () => {
    let storage: InMemoryCloudStorage;
    let rpm: RelayPoolManager;

    beforeEach(async () => {
      storage = new InMemoryCloudStorage();
      const manifest = buildSignedManifest(dirKp.privateKey, dirKp.publicKeyHex, [RELAY_A], 1);
      storage.setFile("relay-manifest.json", new TextEncoder().encode(JSON.stringify(manifest)));

      const { logger } = makeSpyLogger();
      rpm = new RelayPoolManager({
        storage,
        signerPublicKeyHex: dirKp.publicKeyHex,
        logger,
      });
      await rpm.loadManifest();
    });

    it("re-signs manifest and increments version when healthCheckUrl changes", async () => {
      const newUrl = "http://10.0.1.99:4000/health";

      const result = await rpm.reSignManifestForRelay({
        relayId: "aaaa1111",
        healthCheckUrl: newUrl,
        keyProvider: dirKp.keyProvider,
      });

      // Returns success with incremented version
      expect(result.updated).toBe(true);
      if (result.updated) {
        expect(result.version).toBe(2);
      }

      // Verify manifest was updated in storage
      const updatedBytes = storage.getFile("relay-manifest.json");
      expect(updatedBytes).toBeDefined();
      const updatedManifest: RelayPoolManifest = JSON.parse(new TextDecoder().decode(updatedBytes!));

      // Version incremented
      expect(updatedManifest.version).toBe(2);

      // healthCheckUrl updated
      expect(updatedManifest.relays[0]!.healthCheckUrl).toBe(newUrl);

      // SI-001: signature is valid against directory's public key
      const payload = canonicalJson({
        version: updatedManifest.version,
        updatedAt: updatedManifest.updatedAt,
        relays: updatedManifest.relays,
      });
      const valid = ed25519.verify(
        Buffer.from(updatedManifest.signature, "hex"),
        payload,
        Buffer.from(dirKp.publicKeyHex, "hex")
      );
      expect(valid).toBe(true);
    });

    it("logs relay.manifest.updated with required context fields", async () => {
      const { logger, events } = makeSpyLogger();
      const rpmWithSpy = new RelayPoolManager({
        storage,
        signerPublicKeyHex: dirKp.publicKeyHex,
        logger,
      });
      await rpmWithSpy.loadManifest();

      await rpmWithSpy.reSignManifestForRelay({
        relayId: "aaaa1111",
        healthCheckUrl: "http://10.0.1.99:4000/health",
        keyProvider: dirKp.keyProvider,
      });

      // Observability: relay.manifest.updated logged at INFO
      const updatedEvent = events.find(e => e.event === "relay.manifest.updated");
      expect(updatedEvent).toBeDefined();
      expect(updatedEvent!.level).toBe("info");
      expect(updatedEvent!.context).toMatchObject({
        relayId: "aaaa1111",
        region: "us-east-1",
        manifestVersion: 2,
        healthCheckUrl: "http://10.0.1.99:4000/health",
      });
    });
  });

  describe("AC-004: No-op when healthCheckUrl unchanged", () => {
    let storage: InMemoryCloudStorage;
    let rpm: RelayPoolManager;

    beforeEach(async () => {
      storage = new InMemoryCloudStorage();
      const manifest = buildSignedManifest(dirKp.privateKey, dirKp.publicKeyHex, [RELAY_A], 1);
      storage.setFile("relay-manifest.json", new TextEncoder().encode(JSON.stringify(manifest)));

      const { logger } = makeSpyLogger();
      rpm = new RelayPoolManager({
        storage,
        signerPublicKeyHex: dirKp.publicKeyHex,
        logger,
      });
      await rpm.loadManifest();
    });

    it("does not increment version when healthCheckUrl is unchanged", async () => {
      const result = await rpm.reSignManifestForRelay({
        relayId: "aaaa1111",
        healthCheckUrl: "http://10.0.1.50:4000/health", // Same as initial
        keyProvider: dirKp.keyProvider,
      });

      // No-op result
      expect(result.updated).toBe(false);
      if (!result.updated) {
        expect(result.reason).toBe("no_change");
      }

      // Verify version unchanged in storage
      const manifestBytes = storage.getFile("relay-manifest.json");
      const manifest: RelayPoolManifest = JSON.parse(new TextDecoder().decode(manifestBytes!));
      expect(manifest.version).toBe(1);
    });

    it("does not log relay.manifest.updated for no-op", async () => {
      const { logger, events } = makeSpyLogger();
      const rpmWithSpy = new RelayPoolManager({
        storage,
        signerPublicKeyHex: dirKp.publicKeyHex,
        logger,
      });
      await rpmWithSpy.loadManifest();

      await rpmWithSpy.reSignManifestForRelay({
        relayId: "aaaa1111",
        healthCheckUrl: "http://10.0.1.50:4000/health", // Same
        keyProvider: dirKp.keyProvider,
      });

      const updatedEvent = events.find(e => e.event === "relay.manifest.updated");
      expect(updatedEvent).toBeUndefined();
    });
  });

  describe("AC-005: Directory updates manifest when healthCheckUrl changes (new ECS task)", () => {
    it("updates manifest with new healthCheckUrl and produces valid signature", async () => {
      const storage = new InMemoryCloudStorage();
      const manifest = buildSignedManifest(
        dirKp.privateKey, dirKp.publicKeyHex,
        [{ ...RELAY_A, region: "eu-central-1", healthCheckUrl: "http://10.0.4.50:4000/health" }],
        3,
      );
      storage.setFile("relay-manifest.json", new TextEncoder().encode(JSON.stringify(manifest)));

      const { logger } = makeSpyLogger();
      const rpm = new RelayPoolManager({
        storage,
        signerPublicKeyHex: dirKp.publicKeyHex,
        logger,
      });
      await rpm.loadManifest();

      const newUrl = "http://10.0.4.99:4000/health";
      const result = await rpm.reSignManifestForRelay({
        relayId: "aaaa1111",
        healthCheckUrl: newUrl,
        keyProvider: dirKp.keyProvider,
      });

      expect(result.updated).toBe(true);
      if (result.updated) {
        expect(result.version).toBe(4);
      }

      // Verify the uploaded manifest
      const updatedBytes = storage.getFile("relay-manifest.json");
      const updated: RelayPoolManifest = JSON.parse(new TextDecoder().decode(updatedBytes!));
      expect(updated.relays[0]!.healthCheckUrl).toBe(newUrl);

      // SI-001: signature verification
      const payload = canonicalJson({
        version: updated.version,
        updatedAt: updated.updatedAt,
        relays: updated.relays,
      });
      expect(ed25519.verify(
        Buffer.from(updated.signature, "hex"),
        payload,
        Buffer.from(dirKp.publicKeyHex, "hex")
      )).toBe(true);
    });
  });

  describe("AC-006: relay_register_ok sent even if S3 upload fails", () => {
    it("reSignManifestForRelay throws on upload failure (unit-level: documents fire-and-forget contract)", async () => {
      const storage = new InMemoryCloudStorage();
      const manifest = buildSignedManifest(dirKp.privateKey, dirKp.publicKeyHex, [RELAY_A], 1);
      storage.setFile("relay-manifest.json", new TextEncoder().encode(JSON.stringify(manifest)));

      const { logger } = makeSpyLogger();
      const rpm = new RelayPoolManager({
        storage,
        signerPublicKeyHex: dirKp.publicKeyHex,
        logger,
      });
      await rpm.loadManifest();

      // Simulate upload failure
      storage.simulateUploadFailure(true);

      // reSignManifestForRelay throws — the directory handler uses fire-and-forget .catch()
      await expect(
        rpm.reSignManifestForRelay({
          relayId: "aaaa1111",
          healthCheckUrl: "http://10.0.1.99:4000/health",
          keyProvider: dirKp.keyProvider,
        })
      ).rejects.toThrow("simulated_upload_failure");

      // The in-memory healthCheckUrl should NOT be updated (upload failed before step 8)
      // This ensures the next registration attempt will still try to re-sign
      expect(rpm.getRelayHealthCheckUrl("aaaa1111")).toBe("http://10.0.1.50:4000/health");
    });

    it("AC-006 (wired): relay_register_ok returned to relay even when S3 upload fails; relay.manifest.update.failed logged by handler", async () => {
      // This test wires the full directory handler path:
      // 1. Directory has a RelayPoolManager with a failing S3 storage.
      // 2. Relay sends relay_register with health_check_url over a real libp2p stream.
      // 3. Assert the response frame type is relay_register_ok (registration is not rolled back).
      // 4. Assert relay.manifest.update.failed is logged by the handler's .catch() callback.

      const relayKp = generateKeypair();
      const relayPubkey = await relayKp.getPublicKey();
      const relayId = Buffer.from(relayPubkey).toString("hex");

      const dirKpWired = generateKeypair();

      // Build an initial signed manifest that includes the relay
      const storage = new InMemoryCloudStorage();
      const relayEntry: RelayManifestEntry = {
        relayId,
        endpoint: "wss://relay1.example.com",
        region: "us-east-1",
        status: "active",
        healthCheckUrl: "http://10.0.1.50:4000/health",
      };
      const dirPrivKey = new Uint8Array(32).fill(42);
      const dirPubKey = ed25519.getPublicKey(dirPrivKey);
      const dirPubKeyHex = Buffer.from(dirPubKey).toString("hex");
      const initialManifest = buildSignedManifest(dirPrivKey, dirPubKeyHex, [relayEntry], 1);
      storage.setFile("relay-manifest.json", new TextEncoder().encode(JSON.stringify(initialManifest)));

      // Spy logger to capture events
      const { logger: spyLogger, events } = makeSpyLogger();

      // Configure storage to fail on upload — S3 upload will fail AFTER relay_register_ok is sent
      // RPM must be loaded before upload failure is set, so the no-op check can be bypassed
      const rpm = new RelayPoolManager({
        storage,
        signerPublicKeyHex: dirPubKeyHex,
        logger: spyLogger,
        pingIntervalMs: 999_999, // disable health check polling in test
      });
      await rpm.loadManifest();

      // Now enable upload failures — next reSignManifestForRelay will fail at the upload step
      storage.simulateUploadFailure(true);

      // Store backed by InMemoryDirectoryStore — no DB required
      const store = new InMemoryDirectoryStore();

      // Create real directory node wired with the failing RelayPoolManager
      const { node: dirNode, stop: stopDir } = await createDirectoryNode({
        keyProvider: dirKpWired,
        relay: makeNoOpRelayAdapter(),
        relayEndpoint: { peer_id: "12D3KooWdeadbeef", multiaddrs: [] },
        store,
        relayPoolManager: rpm,
        logger: spyLogger,
      });

      // Create a separate node to act as the relay
      const relayNode = await createNode({
        keyProvider: relayKp,
        listenAddresses: ["/ip4/127.0.0.1/tcp/0"],
      });
      await relayNode.start();

      try {
        // Connect relay node to directory node
        const dirAddrs = dirNode.listenAddresses();
        await relayNode.dial(String(dirAddrs[0]));

        // Open stream on the directory-relay protocol
        const stream = await relayNode.newStream(dirNode.getPeerId(), DIRECTORY_RELAY_PROTOCOL) as Stream;

        // Build relay_register frame with health_check_url (new URL — will trigger re-sign)
        const timestamp = Date.now();
        const tbs = buildRelayRegistrationTbs(relayId, relayId, timestamp);
        const sig = await relayKp.sign(tbs);

        stream.send(lp.encode.single(CBOR_ENC.encode({
          type: "relay_register",
          relay_id: relayId,
          public_key_hex: relayId,
          region: "us-east-1",
          health_check_url: "http://10.0.1.99:4000/health", // different URL → triggers re-sign
          timestamp,
          signature: sig,
        })));
        await stream.close();

        // Read the response — must be relay_register_ok (registration not rolled back by upload failure)
        const iter = (lp.decode(stream) as AsyncIterable<unknown>)[Symbol.asyncIterator]() as AsyncIterator<Uint8Array>;
        const { value: rawResp } = await iter.next();
        expect(rawResp).toBeDefined();
        const respBytes = rawResp instanceof Uint8Array ? rawResp : (rawResp as unknown as { slice(): Uint8Array }).slice();
        const resp = cborDecode(respBytes) as { type: string; reason?: string };
        // If this fails, resp.reason tells us why: missing_fields, RELAY_REGISTRATION_UNAUTHORIZED, etc.
        expect(resp.type, `relay_register response: type=${resp.type} reason=${resp.reason ?? "(none)"}`).toBe("relay_register_ok");

        // Wait for the fire-and-forget .catch() to execute
        await new Promise<void>((r) => setTimeout(r, 200));

        // Assert relay.manifest.update.failed was logged by the handler's .catch() callback
        const failedEvent = events.find(e => e.event === "relay.manifest.update.failed");
        expect(failedEvent).toBeDefined();
        expect(failedEvent!.level).toBe("error");
        expect(failedEvent!.context).toMatchObject({
          relayId,
          region: "us-east-1",
          reason: expect.stringContaining("simulated_upload_failure"),
        });

        // Assert relay.registered was logged by the handler (M4+ convention: store returns result,
        // handler owns observability). This is the authoritative handler-layer test for relay.registered.
        const registeredEvent = events.find(e => e.event === "relay.registered");
        expect(registeredEvent, "relay.registered must be logged by the handler layer").toBeDefined();
        expect(registeredEvent!.level).toBe("info");
        expect(registeredEvent!.context).toMatchObject({ relayId, region: "us-east-1" });
      } finally {
        await relayNode.stop();
        await stopDir();
      }
    });
  });

  describe("relay.already.registered handler-layer observability (M4+ convention)", () => {
    it("handler logs relay.already.registered when relay re-registers with same key", async () => {
      // This test verifies that relay.already.registered is emitted by the handler layer
      // (directory-node.ts), not the store layer, per M4+ convention.
      // The store returns { alreadyRegistered: true }; the handler owns the log event.
      const relayKp = generateKeypair();
      const relayPubkey = await relayKp.getPublicKey();
      const relayId = Buffer.from(relayPubkey).toString("hex");
      const dirKpWired = generateKeypair();

      const storage = new InMemoryCloudStorage();
      const relayEntry: RelayManifestEntry = {
        relayId,
        endpoint: "wss://relay-obs-test.example.com",
        region: "us-east-1",
        status: "active",
        healthCheckUrl: "http://10.0.1.50:4000/health",
      };
      const dirPrivKey = new Uint8Array(32).fill(43);
      const dirPubKey = ed25519.getPublicKey(dirPrivKey);
      const dirPubKeyHex = Buffer.from(dirPubKey).toString("hex");
      const initialManifest = buildSignedManifest(dirPrivKey, dirPubKeyHex, [relayEntry], 1);
      storage.setFile("relay-manifest.json", new TextEncoder().encode(JSON.stringify(initialManifest)));

      const { logger: spyLogger, events } = makeSpyLogger();
      const rpm = new RelayPoolManager({
        storage,
        signerPublicKeyHex: dirPubKeyHex,
        logger: spyLogger,
        pingIntervalMs: 999_999,
      });
      await rpm.loadManifest();

      const store = new InMemoryDirectoryStore();
      const { node: dirNode, stop: stopDir } = await createDirectoryNode({
        keyProvider: dirKpWired,
        relay: makeNoOpRelayAdapter(),
        relayEndpoint: { peer_id: "12D3KooWdeadbeef", multiaddrs: [] },
        store,
        relayPoolManager: rpm,
        logger: spyLogger,
      });

      const relayNode = await createNode({
        keyProvider: relayKp,
        listenAddresses: ["/ip4/127.0.0.1/tcp/0"],
      });
      await relayNode.start();

      try {
        const dirAddrs = dirNode.listenAddresses();
        await relayNode.dial(String(dirAddrs[0]));

        // First registration — fires relay.registered
        const sendFrame = async () => {
          const stream = await relayNode.newStream(dirNode.getPeerId(), DIRECTORY_RELAY_PROTOCOL) as Stream;
          const timestamp = Date.now();
          const tbs = buildRelayRegistrationTbs(relayId, relayId, timestamp);
          const sig = await relayKp.sign(tbs);
          stream.send(lp.encode.single(CBOR_ENC.encode({
            type: "relay_register",
            relay_id: relayId,
            public_key_hex: relayId,
            region: "us-east-1",
            health_check_url: "http://10.0.1.50:4000/health",
            timestamp,
            signature: sig,
          })));
          await stream.close();
          const iter = (lp.decode(stream) as AsyncIterable<unknown>)[Symbol.asyncIterator]() as AsyncIterator<Uint8Array>;
          const { value: rawResp } = await iter.next();
          expect(rawResp).toBeDefined();
          const respBytes = rawResp instanceof Uint8Array ? rawResp : (rawResp as unknown as { slice(): Uint8Array }).slice();
          return cborDecode(respBytes) as { type: string; already_registered?: boolean };
        };

        const resp1 = await sendFrame();
        expect(resp1.type).toBe("relay_register_ok");
        expect(resp1.already_registered).toBeUndefined(); // first registration

        // Second registration with same key and URL — fires relay.already.registered
        const resp2 = await sendFrame();
        expect(resp2.type).toBe("relay_register_ok");
        expect(resp2.already_registered).toBe(true);

        // Wait for any async handlers
        await new Promise<void>((r) => setTimeout(r, 100));

        // relay.registered must be logged once (first registration) by the handler
        const registeredEvents = events.filter(e => e.event === "relay.registered");
        expect(registeredEvents.length, "relay.registered must be logged once for first registration").toBe(1);
        expect(registeredEvents[0]!.context).toMatchObject({ relayId, region: "us-east-1" });

        // relay.already.registered must be logged once (second registration) by the handler
        const alreadyRegisteredEvents = events.filter(e => e.event === "relay.already.registered");
        expect(alreadyRegisteredEvents.length, "relay.already.registered must be logged by the handler layer").toBe(1);
        expect(alreadyRegisteredEvents[0]!.context).toMatchObject({ relayId, region: "us-east-1" });
      } finally {
        await relayNode.stop();
        await stopDir();
      }
    });
  });

  describe("AC-007b: sign-manifest.sh canonical JSON matches buildCanonicalPayload", () => {
    it("canonical payload uses shallow key sort (relays, updatedAt, version)", () => {
      // The canonical payload sorts ONLY top-level keys alphabetically.
      // Relay entry fields (healthCheckUrl, relayId, etc.) are NOT sorted.
      const manifest: RelayPoolManifest = {
        version: 2,
        signedBy: "abcdef",
        signature: "1234",
        updatedAt: "2026-06-04T00:00:00Z",
        relays: [
          {
            relayId: "zzzz9999",
            endpoint: "wss://relay.example.com",
            region: "us-east-1",
            status: "active",
            healthCheckUrl: "http://10.0.0.1:4000/health",
          },
        ],
      };

      const payload = canonicalJson({
        version: manifest.version,
        updatedAt: manifest.updatedAt,
        relays: manifest.relays,
      });
      const json = new TextDecoder().decode(payload);
      const parsed = JSON.parse(json);

      // Top-level keys must be in alphabetical order
      const keys = Object.keys(parsed);
      expect(keys).toEqual(["relays", "updatedAt", "version"]);

      // Relay entry field order is NOT sorted — preserves original order
      const relayKeys = Object.keys(parsed.relays[0]);
      expect(relayKeys).toEqual(["relayId", "endpoint", "region", "status", "healthCheckUrl"]);
    });

    it("signature produced by canonical payload matches RelayPoolManager verification", async () => {
      // Simulate what sign-manifest.sh does:
      // 1. Build body object with version, updatedAt, relays
      // 2. Sort top-level keys alphabetically
      // 3. JSON.stringify (no whitespace)
      // 4. UTF-8 encode
      // 5. Sign with Ed25519
      const relays: RelayManifestEntry[] = [
        {
          relayId: "aaaa1111",
          endpoint: "wss://relay.example.com",
          region: "us-east-1",
          status: "active",
          healthCheckUrl: "http://10.0.1.50:4000/health",
        },
      ];

      const manifest = buildSignedManifest(dirKp.privateKey, dirKp.publicKeyHex, relays, 5, "2026-06-04T12:00:00Z");

      // Now load it into RelayPoolManager — if it loads without throwing,
      // the signature produced by buildSignedManifest (same logic as sign-manifest.sh)
      // verifies correctly in RelayPoolManager.loadManifest()
      const storage = new InMemoryCloudStorage();
      storage.setFile("relay-manifest.json", new TextEncoder().encode(JSON.stringify(manifest)));

      const { logger, events } = makeSpyLogger();
      const rpm = new RelayPoolManager({
        storage,
        signerPublicKeyHex: dirKp.publicKeyHex,
        logger,
      });

      // This will throw if signature verification fails
      await rpm.loadManifest();

      // Verify relay.manifest.loaded fires (proves successful verification)
      const loadedEvent = events.find(e => e.event === "relay.manifest.loaded");
      expect(loadedEvent).toBeDefined();
      expect(loadedEvent!.context).toMatchObject({
        manifestVersion: 5,
        relayCount: 1,
      });
    });
  });
});
