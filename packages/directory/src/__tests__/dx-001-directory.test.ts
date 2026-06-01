/**
 * CELLO-M6-DX-001 — Directory-side tests
 *
 * AC-006 (directory side): phone_stub empty string accepted when pre_auth_token consumed;
 *   phone_stub_hash comes from token, not SHA-256('').
 * AC-007a: GET /agent-lookup?agent_id=<32hex> returns k_local_pubkey or 404.
 * AC-010 (integration): loadProfiles() populates in-memory maps on restart;
 *   hasProfile() returns true for loaded agents.
 * AC-011 (integration): agent_id persisted in agent_profiles INSERT; reload reads it back.
 *
 * Test types:
 *   AC-006: unit (in-memory store + directory node)
 *   AC-007a: unit (health server)
 *   AC-010, AC-011: integration (requires CELLO_ENV=local + Postgres)
 *
 * MANDATORY: --pool-options.threads.maxThreads=1
 *
 * Integration run:
 *   CELLO_ENV=local DATABASE_URL=postgresql://postgres:dev@localhost:5433/cello_dev \
 *     DEV_ENVELOPE_KEY=86e903357804be102cf6f55e1b86ed342e01a6f50835272200ac970d0d094ac7 \
 *     AUDIT_LOG_PATH=/tmp/cello-audit.jsonl \
 *     pnpm --filter @cello-protocol/directory run test -- \
 *       --pool-options.threads.maxThreads=1 --pool-options.threads.minThreads=1
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { Encoder } from "cbor-x";
import * as lp from "it-length-prefixed";
import {
  generateKeypair,
  mlDsaKeygen,
} from "@cello-protocol/crypto";
import { createNode } from "@cello-protocol/transport";
import type { Stream } from "@libp2p/interface";
import {
  createDirectoryNode,
  SIGNALING_PROTOCOL_ID,
} from "../directory-node.js";
import type { RelayAdapter } from "../directory-node.js";
import type { RelaySessionAssignment } from "../directory-types.js";
import { NetworkDirectoryNode, runNetworkDkg } from "@cello-protocol/client";
import { createHealthServer } from "../health-server.js";
import { DevTokenValidator } from "@cello-protocol/interfaces/stubs";

// ─── Integration guard ────────────────────────────────────────────────────────

const isLocal = process.env["CELLO_ENV"] === "local";
const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgresql://postgres:dev@localhost:5433/cello_dev";
const describeIntegration = isLocal ? describe : describe.skip;

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const CBOR_ENC = new Encoder({ tagUint8Array: false });
const AUTH_DOMAIN = "CELLO-DIR-AUTH-v1";

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function makeRelay(): RelayAdapter {
  return {
    async recordAssignment(_: RelaySessionAssignment) { return { ok: true as const }; },
    async discardSession() {},
    async submitForSeal() { return { ok: false as const, reason: "not_supported" }; },
    async confirmSeal() {},
    async rejectSeal() {},
  };
}

class StreamReader {
  readonly #iter: AsyncIterator<Uint8Array>;

  constructor(stream: Stream) {
    const gen = lp.decode(stream);
    this.#iter = (gen as AsyncIterable<unknown>)[Symbol.asyncIterator]() as AsyncIterator<Uint8Array>;
  }

  async readFrame(): Promise<Record<string, unknown>> {
    const result = await this.#iter.next();
    if (result.done) throw new Error("stream closed");
    const value = result.value;
    const bytes = value instanceof Uint8Array ? value : (value as unknown as { slice(): Uint8Array }).slice();
    const { decode } = await import("cbor-x");
    return decode(bytes) as Record<string, unknown>;
  }

  async readFrameWithTimeout(ms = 10_000): Promise<Record<string, unknown>> {
    return Promise.race([
      this.readFrame(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms),
      ),
    ]);
  }
}

function sendFrame(stream: Stream, bytes: Uint8Array): void {
  stream.send(lp.encode.single(bytes));
}

async function signAuth(nonce: Uint8Array, keyProvider: ReturnType<typeof generateKeypair>): Promise<{ pubkey: Uint8Array; signature: Uint8Array }> {
  const pubkey = await keyProvider.getPublicKey();
  const domainBytes = Buffer.from(AUTH_DOMAIN, "utf8");
  const authMsg = new Uint8Array(Buffer.concat([domainBytes, nonce, pubkey]));
  const msgHash = new Uint8Array(createHash("sha256").update(authMsg).digest());
  const signature = await keyProvider.sign(msgHash);
  return { pubkey: new Uint8Array(pubkey), signature: new Uint8Array(signature) };
}

async function doAuth(
  clientNode: Awaited<ReturnType<typeof createNode>>,
  dirPeerId: string,
  keyProvider: ReturnType<typeof generateKeypair>,
): Promise<{ stream: Stream; reader: StreamReader }> {
  const stream = await clientNode.newStream(dirPeerId, SIGNALING_PROTOCOL_ID);
  const reader = new StreamReader(stream);

  const challengeFrame = await reader.readFrame();
  expect(challengeFrame["type"]).toBe("signaling_auth_challenge");
  const nonce = challengeFrame["nonce"] as Uint8Array;

  const { pubkey, signature } = await signAuth(nonce, keyProvider);
  sendFrame(stream, CBOR_ENC.encode({ type: "signaling_auth_response", pubkey, signature }));

  const authOk = await reader.readFrame();
  expect(authOk["type"]).toBe("signaling_auth_ok");

  return { stream, reader };
}

/**
 * Complete the full registration flow, similar to doRegister in registration.test.ts.
 * AC-006: phoneStub may be empty string when preAuthToken is provided.
 */
async function doRegister(
  stream: Stream,
  reader: StreamReader,
  clientNode: Awaited<ReturnType<typeof createNode>>,
  dirPeerId: string,
  dirMultiaddrs: string[],
  clientPubkeyHex: string,
  mlDsaPubkeyHex: string,
  phoneStub: string,
  preAuthToken?: string,
): Promise<Record<string, unknown>> {
  sendFrame(stream, CBOR_ENC.encode({
    type: "register_request",
    phone_stub: phoneStub,
    k_local_pubkey: clientPubkeyHex,
    ml_dsa_pubkey: mlDsaPubkeyHex,
  }));

  const dkgReadyFrame = await reader.readFrameWithTimeout(10_000);
  if (dkgReadyFrame["type"] !== "dkg_ready") {
    return dkgReadyFrame; // register_error or unexpected frame
  }

  const dirNode = new NetworkDirectoryNode({
    id: dirPeerId,
    node: clientNode,
    directoryPeerId: dirPeerId,
    directoryMultiaddrs: dirMultiaddrs,
  });
  const clientPubkeyBytes = Buffer.from(clientPubkeyHex, "hex");
  const dkgResult = await runNetworkDkg(clientPubkeyBytes, {
    threshold: dkgReadyFrame["threshold"] as number,
    participants: dkgReadyFrame["participants"] as number,
    directoryNodes: [dirNode],
    preAuthToken: preAuthToken ?? "DEV-test-token",
  });
  const primaryPubkeyHex = Buffer.from(dkgResult.primaryPubkey).toString("hex");

  sendFrame(stream, CBOR_ENC.encode({
    type: "dkg_complete",
    primary_pubkey: primaryPubkeyHex,
  }));

  return reader.readFrameWithTimeout(10_000);
}

// ─── Helper: start server on random port ─────────────────────────────────────

async function startServer(server: Server): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        port,
        close: () => new Promise<void>((res) => server.close(() => res())),
      });
    });
  });
}

// ─── AC-007a: GET /agent-lookup endpoint (unit) ───────────────────────────────

describe("AC-007a: GET /agent-lookup endpoint", () => {
  // Specification:
  // - GET /agent-lookup?agent_id=<32hex> returns { k_local_pubkey } when found
  // - GET /agent-lookup?agent_id=<32hex> returns 404 { error: 'not_found' } when not found
  // - GET /agent-lookup without agent_id returns 400
  // - GET /agent-lookup when resolver not wired returns 503

  const knownAgentId = "a2c55e2721f45cfa86cb3417a76e3f7b";
  const knownPubkey = "0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b";

  describe("with getKLocalPubkeyByAgentId wired", () => {
    let port: number;
    let close: () => Promise<void>;

    beforeAll(async () => {
      const server = createHealthServer({
        nodeId: "test-node",
        schemaVersion: 27,
        logger: noopLogger,
        port: 0,
        getKLocalPubkeyByAgentId: (agentId: string) => {
          return agentId === knownAgentId ? knownPubkey : undefined;
        },
      });
      ({ port, close } = await startServer(server));
    });

    afterAll(async () => { await close(); });

    it("returns 200 with k_local_pubkey for known agent_id", async () => {
      const res = await fetch(`http://127.0.0.1:${port}/agent-lookup?agent_id=${knownAgentId}`);
      expect(res.status).toBe(200);
      const body = await res.json() as { k_local_pubkey: string };
      expect(body.k_local_pubkey).toBe(knownPubkey);
    });

    it("returns 404 { error: 'not_found' } for unknown agent_id", async () => {
      const unknownId = "00000000000000000000000000000000";
      const res = await fetch(`http://127.0.0.1:${port}/agent-lookup?agent_id=${unknownId}`);
      expect(res.status).toBe(404);
      const body = await res.json() as { error: string };
      expect(body.error).toBe("not_found");
    });

    it("returns 400 when agent_id is missing", async () => {
      const res = await fetch(`http://127.0.0.1:${port}/agent-lookup`);
      expect(res.status).toBe(400);
    });

    it("returns 400 when agent_id is wrong length (64 chars instead of 32)", async () => {
      const res = await fetch(`http://127.0.0.1:${port}/agent-lookup?agent_id=${knownPubkey}`);
      expect(res.status).toBe(400);
    });

    it("does not interfere with /health endpoint", async () => {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      expect(res.status).toBe(200);
      const body = await res.json() as { status: string };
      expect(body.status).toBe("ok");
    });
  });

  describe("without getKLocalPubkeyByAgentId wired", () => {
    let port: number;
    let close: () => Promise<void>;

    beforeAll(async () => {
      const server = createHealthServer({
        nodeId: "test-node",
        schemaVersion: 27,
        logger: noopLogger,
        port: 0,
        // getKLocalPubkeyByAgentId intentionally omitted
      });
      ({ port, close } = await startServer(server));
    });

    afterAll(async () => { await close(); });

    it("returns 503 when resolver not wired", async () => {
      const res = await fetch(`http://127.0.0.1:${port}/agent-lookup?agent_id=${knownAgentId}`);
      expect(res.status).toBe(503);
    });
  });

  describe("MED-2: output validation — malformed pubkey from store returns 500", () => {
    // Specification:
    // If getKLocalPubkeyByAgentId returns a value that is not a 64-char lowercase hex string,
    // the server must return 500 { error: 'internal_error' } rather than forwarding the malformed value.
    // This prevents corrupted or mis-formatted data from propagating to callers.

    let port: number;
    let close: () => Promise<void>;

    beforeAll(async () => {
      const server = createHealthServer({
        nodeId: "test-node",
        schemaVersion: 27,
        logger: noopLogger,
        port: 0,
        // Resolver returns a malformed pubkey (not 64 hex chars)
        getKLocalPubkeyByAgentId: (_agentId: string) => "not-a-valid-hex-pubkey",
      });
      ({ port, close } = await startServer(server));
    });

    afterAll(async () => { await close(); });

    it("returns 500 internal_error when resolver returns malformed pubkey", async () => {
      const res = await fetch(`http://127.0.0.1:${port}/agent-lookup?agent_id=${knownAgentId}`);
      expect(res.status).toBe(500);
      const body = await res.json() as { error: string };
      expect(body.error).toBe("internal_error");
    });

    it("returns 500 when resolver returns uppercase hex (not lowercase)", async () => {
      const server2 = createHealthServer({
        nodeId: "test-node-uc",
        schemaVersion: 27,
        logger: noopLogger,
        port: 0,
        // Uppercase hex — fails /^[0-9a-f]{64}$/ because of uppercase letters
        getKLocalPubkeyByAgentId: (_agentId: string) => "A".repeat(64),
      });
      const { port: port2, close: close2 } = await startServer(server2);
      try {
        const res = await fetch(`http://127.0.0.1:${port2}/agent-lookup?agent_id=${knownAgentId}`);
        expect(res.status).toBe(500);
        const body = await res.json() as { error: string };
        expect(body.error).toBe("internal_error");
      } finally {
        await close2();
      }
    });

    it("returns 500 when resolver returns a 32-char hex (too short)", async () => {
      const server3 = createHealthServer({
        nodeId: "test-node-short",
        schemaVersion: 27,
        logger: noopLogger,
        port: 0,
        getKLocalPubkeyByAgentId: (_agentId: string) => "a".repeat(32), // 32 chars — too short
      });
      const { port: port3, close: close3 } = await startServer(server3);
      try {
        const res = await fetch(`http://127.0.0.1:${port3}/agent-lookup?agent_id=${knownAgentId}`);
        expect(res.status).toBe(500);
        const body = await res.json() as { error: string };
        expect(body.error).toBe("internal_error");
      } finally {
        await close3();
      }
    });
  });
});

// ─── AC-006 (directory side): empty phone_stub accepted with pre_auth_token ───

describe("AC-006 (directory): empty phone_stub succeeds when pre_auth_token consumed", () => {
  // Specification:
  // PART 1: When a valid pre_auth_token is consumed during DKG Round 1,
  //         empty phone_stub must be accepted (not rejected with invalid_verification).
  // PART 2: phoneStubHash is set from preAuthData (not SHA-256('')), so the
  //         uniqueness check uses the token's real hash.
  //
  // The fix: phone_stub validation is DEFERRED to Step 3b (after DKG completes),
  // at which point #pendingPreAuthData is available (set during DKG Round 1).

  it("non-empty phone_stub continues to work (baseline — legacy path unchanged)", async () => {
    const dirKey = generateKeypair();
    const { directory, node: dirNode, stop: stopDir } = await createDirectoryNode({
      keyProvider: dirKey,
      relay: makeRelay(),
      relayEndpoint: { peer_id: "12D3KooWFakeRelay", multiaddrs: ["/ip4/127.0.0.1/tcp/19999"] },
      tokenValidator: new DevTokenValidator(),
    });

    const clientKey = generateKeypair();
    const clientNode = await createNode({ keyProvider: clientKey, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await clientNode.start();

    try {
      await clientNode.dial(dirNode.listenAddresses()[0]!);
      const { stream, reader } = await doAuth(clientNode, dirNode.getPeerId(), clientKey);

      const mlDsaProvider = await mlDsaKeygen();
      const mlDsaPubkey = await mlDsaProvider.getPublicKey();
      const clientPubkey = await clientKey.getPublicKey();
      const clientPubkeyHex = Buffer.from(clientPubkey).toString("hex");
      const mlDsaPubkeyHex = Buffer.from(mlDsaPubkey).toString("hex");

      // Non-empty phone_stub with DEV token: should succeed (legacy path)
      const result = await doRegister(
        stream, reader, clientNode, dirNode.getPeerId(), dirNode.listenAddresses(),
        clientPubkeyHex, mlDsaPubkeyHex,
        "+1234567890",  // non-empty phone_stub (legacy path)
        "DEV-test-token",
      );
      expect(result["type"]).toBe("register_success");
    } finally {
      await stopDir();
      await clientNode.stop();
    }
  });

  it("AC-006 PART 1: empty phone_stub succeeds when pre_auth_token is valid DEV token", async () => {
    const dirKey = generateKeypair();
    const { directory, node: dirNode, stop: stopDir } = await createDirectoryNode({
      keyProvider: dirKey,
      relay: makeRelay(),
      relayEndpoint: { peer_id: "12D3KooWFakeRelay", multiaddrs: ["/ip4/127.0.0.1/tcp/19999"] },
      tokenValidator: new DevTokenValidator(),
    });

    const clientKey = generateKeypair();
    const clientNode = await createNode({ keyProvider: clientKey, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await clientNode.start();

    try {
      await clientNode.dial(dirNode.listenAddresses()[0]!);
      const { stream, reader } = await doAuth(clientNode, dirNode.getPeerId(), clientKey);

      const mlDsaProvider = await mlDsaKeygen();
      const mlDsaPubkey = await mlDsaProvider.getPublicKey();
      const clientPubkey = await clientKey.getPublicKey();
      const clientPubkeyHex = Buffer.from(clientPubkey).toString("hex");
      const mlDsaPubkeyHex = Buffer.from(mlDsaPubkey).toString("hex");

      // Register with empty phone_stub and a valid DEV pre_auth_token
      // The token is sent during DKG round 1 (runNetworkDkg), which sets pendingPreAuthData.
      // After DKG completes, Step 3b checks pendingPreAuthData and uses its phoneStubHash.
      const result = await doRegister(
        stream, reader, clientNode, dirNode.getPeerId(), dirNode.listenAddresses(),
        clientPubkeyHex, mlDsaPubkeyHex,
        "",  // empty phone_stub — AC-006 PART 1: allowed when pre_auth_token consumed
        "DEV-test-token",
      );
      // Should succeed — empty phone_stub is allowed when pre_auth_token was consumed
      expect(result["type"]).toBe("register_success");
      expect(typeof result["agent_id"]).toBe("string");
      expect((result["agent_id"] as string).length).toBe(32);
    } finally {
      await stopDir();
      await clientNode.stop();
    }
  });

  it("AC-006 PART 2: unique phoneStubHash per token prevents phone_already_claimed collision", async () => {
    // Verifies AC-006 PART 2: when #pendingPreAuthData is set during DKG Round 1,
    // the token's phoneStubHash is used (not SHA-256('')).
    // This test uses a custom TokenValidator that returns UNIQUE hashes per token,
    // so two agents with different tokens can both register successfully.
    // (DevTokenValidator returns the same hash for ALL tokens, which is correct for dev
    // but defeats the purpose of per-token uniqueness — using a custom validator here.)
    const uniquePhoneHashes = new Map<string, string>();
    const tokenCount = { n: 0 };
    const uniqueTokenValidator = {
      async validateToken(token: string) {
        if (!token.startsWith("UNIQUE-")) {
          return { valid: false as const, reason: "only UNIQUE- tokens accepted", tokenId: null };
        }
        // Return a unique phoneStubHash per token string
        let hash = uniquePhoneHashes.get(token);
        if (!hash) {
          hash = createHash("sha256").update(`phone-${++tokenCount.n}`).digest("hex");
          uniquePhoneHashes.set(token, hash);
        }
        return { valid: true as const, phoneStubHash: hash, emailDomain: "test.example.com", tokenId: `id-${token}` };
      },
    };

    const dirKey = generateKeypair();
    const { directory, node: dirNode, stop: stopDir } = await createDirectoryNode({
      keyProvider: dirKey,
      relay: makeRelay(),
      relayEndpoint: { peer_id: "12D3KooWFakeRelay", multiaddrs: ["/ip4/127.0.0.1/tcp/19999"] },
      tokenValidator: uniqueTokenValidator,
    });

    const clientKeyA = generateKeypair();
    const clientKeyB = generateKeypair();
    const nodeA = await createNode({ keyProvider: clientKeyA, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    const nodeB = await createNode({ keyProvider: clientKeyB, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await nodeA.start();
    await nodeB.start();

    try {
      // Register agent A with empty phone_stub and unique token
      await nodeA.dial(dirNode.listenAddresses()[0]!);
      const { stream: streamA, reader: readerA } = await doAuth(nodeA, dirNode.getPeerId(), clientKeyA);
      const mlDsaA = await mlDsaKeygen();
      const pubkeyA = await clientKeyA.getPublicKey();
      const resultA = await doRegister(
        streamA, readerA, nodeA, dirNode.getPeerId(), dirNode.listenAddresses(),
        Buffer.from(pubkeyA).toString("hex"), Buffer.from(await mlDsaA.getPublicKey()).toString("hex"),
        "", "UNIQUE-token-agent-a",
      );
      expect(resultA["type"]).toBe("register_success");

      // Register agent B with empty phone_stub and a DIFFERENT token → different phoneStubHash
      // Without AC-006 PART 2, this would fail with phone_already_claimed because SHA-256('')
      // would be the same for both agents. With AC-006 PART 2, each token's unique hash is used.
      await nodeB.dial(dirNode.listenAddresses()[0]!);
      const { stream: streamB, reader: readerB } = await doAuth(nodeB, dirNode.getPeerId(), clientKeyB);
      const mlDsaB = await mlDsaKeygen();
      const pubkeyB = await clientKeyB.getPublicKey();
      const resultB = await doRegister(
        streamB, readerB, nodeB, dirNode.getPeerId(), dirNode.listenAddresses(),
        Buffer.from(pubkeyB).toString("hex"), Buffer.from(await mlDsaB.getPublicKey()).toString("hex"),
        "", "UNIQUE-token-agent-b",  // different token → different hash
      );
      // Both registrations must succeed (unique hashes, no phone_already_claimed)
      expect(resultB["type"]).toBe("register_success");
    } finally {
      await stopDir();
      await nodeA.stop();
      await nodeB.stop();
    }
  });
});

// ─── AC-010 / AC-011 (integration): profiles loaded on restart ────────────────

describeIntegration("AC-010 / AC-011 (integration): agent_id persisted and loadProfiles on restart", () => {
  // Specification:
  // AC-011: agent_profiles INSERT includes non-null agent_id; reload reads it back.
  // AC-010: loadProfiles() populates in-memory maps; hasProfile() returns true for loaded agents.
  //
  // Requires CELLO_ENV=local + running Postgres with V27 migration applied.

  let pool: import("pg").Pool;

  beforeAll(async () => {
    const pg = await import("pg");
    pool = new pg.default.Pool({ connectionString: DATABASE_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("AC-011: registration inserts agent_id; loadProfiles reads it back", async () => {
    const { PgDirectoryStore } = await import("../adapters/pg-directory-store.js");

    // Generate a unique agent profile with a random k_local_pubkey
    const k_local_pubkey = randomBytes(32).toString("hex");
    const primary_pubkey = randomBytes(32).toString("hex");
    const ml_dsa_pubkey = randomBytes(100).toString("hex");
    const phone_stub_hash = randomBytes(32).toString("hex");
    const agentId = randomBytes(16).toString("hex");

    // Insert directly into agent_profiles (simulates what setProfile does)
    await pool.query(
      `INSERT INTO agent_profiles
         (k_local_pubkey, primary_pubkey, ml_dsa_pubkey, phone_stub_hash, registered_at, status, agent_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (k_local_pubkey) DO NOTHING`,
      [k_local_pubkey, primary_pubkey, ml_dsa_pubkey, phone_stub_hash, Date.now(), "active", agentId],
    );

    // Create a fresh PgDirectoryStore (simulating restart) and load profiles
    const store = new PgDirectoryStore(pool, noopLogger, "test-node", "us-east-1");
    await store.loadProfiles();

    // AC-011: the loaded profile should have the exact agent_id we inserted
    const profile = store.getProfileByAgentId(agentId);
    expect(profile).toBeDefined();
    expect(profile!.agent_id).toBe(agentId);
    expect(profile!.k_local_pubkey).toBe(k_local_pubkey);

    // AC-010: hasProfile returns true for the loaded agent
    expect(store.hasProfile(k_local_pubkey)).toBe(true);
  });

  it("AC-010: loadProfiles populates hasProfile for agents registered before this process", async () => {
    const { PgDirectoryStore } = await import("../adapters/pg-directory-store.js");

    // Insert two profiles (simulating prior registrations)
    const insertProfile = async (): Promise<{ k_local_pubkey: string; agent_id: string }> => {
      const k = randomBytes(32).toString("hex");
      const pk = randomBytes(32).toString("hex");
      const mldsa = randomBytes(100).toString("hex");
      const psh = randomBytes(32).toString("hex");
      const aid = randomBytes(16).toString("hex");
      await pool.query(
        `INSERT INTO agent_profiles
           (k_local_pubkey, primary_pubkey, ml_dsa_pubkey, phone_stub_hash, registered_at, status, agent_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (k_local_pubkey) DO NOTHING`,
        [k, pk, mldsa, psh, Date.now(), "active", aid],
      );
      return { k_local_pubkey: k, agent_id: aid };
    };

    const profileA = await insertProfile();
    const profileB = await insertProfile();

    // Fresh store (simulates "directory instance B after restart")
    const store = new PgDirectoryStore(pool, noopLogger, "test-node-2", "us-east-1");
    await store.loadProfiles();

    // AC-010: both agents are findable without re-registration
    expect(store.hasProfile(profileA.k_local_pubkey)).toBe(true);
    expect(store.hasProfile(profileB.k_local_pubkey)).toBe(true);

    // AC-011: agent_id lookup also works
    expect(store.getProfileByAgentId(profileA.agent_id)).toBeDefined();
    expect(store.getProfileByAgentId(profileB.agent_id)).toBeDefined();
  });
});
