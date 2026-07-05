// Cross-node topology — end-to-end over the REAL signaling wire (items 1 + 3).
//
//   Discovery handler (in-memory store, always runs): an authenticated client sends discovery_lookup
//   and gets the settled 3-state answer back — online+owning-node / offline / unknown_agent.
//
//   Visiting-auth presence integrity (pg-backed, describeLive): a NORMAL auth writes presence; a
//   VISITING auth writes NONE (connect or disconnect); and a visiting connect+disconnect over a row
//   already owned by ANOTHER node leaves that row untouched. This is Story C scenario 2 at unit level
//   — the direct catch for the visiting-auth blocker.

import {
  setupV3Tests,
  createTestScope,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@claude-flow/testing";
import { createHash } from "node:crypto";
import { Encoder, decode as cborDecode } from "cbor-x";
import * as lp from "it-length-prefixed";
import pg from "pg";
import { generateKeypair } from "@cello-protocol/crypto";
import { createNode } from "@cello-protocol/transport";
import type { Stream } from "@libp2p/interface";
import { createDirectoryNode, SIGNALING_PROTOCOL_ID } from "../directory-node.js";
import type { RelayAdapter } from "../directory-node.js";
import type { RelaySessionAssignment } from "../directory-types.js";
import { decodeOutboundSignalingFrame } from "../directory-frames.js";
import { InMemoryDirectoryStore } from "@cello-protocol/interfaces/stubs";
import type { AgentProfile } from "@cello-protocol/protocol-types";

setupV3Tests();

const CBOR_ENC = new Encoder({ tagUint8Array: false });
const AUTH_DOMAIN = "CELLO-DIR-AUTH-v1";
const DB_URL = process.env.DATABASE_URL ?? "postgresql://postgres:dev@localhost:5433/cello_dev";
const describeLive = process.env.CELLO_ENV === "local" ? describe : describe.skip;

class StreamReader {
  readonly #iter: AsyncIterator<Uint8Array>;
  constructor(stream: Stream) {
    const gen = lp.decode(stream);
    this.#iter = (gen as AsyncIterable<unknown>)[Symbol.asyncIterator]() as AsyncIterator<Uint8Array>;
  }
  async readDecoded(): Promise<Uint8Array> {
    const result = await this.#iter.next();
    if (result.done) throw new Error("stream closed");
    const value = result.value;
    return value instanceof Uint8Array ? value : (value as unknown as { slice(): Uint8Array }).slice();
  }
}

async function signAuth(nonce: Uint8Array, key: ReturnType<typeof generateKeypair>) {
  const pubkey = await key.getPublicKey();
  const authMsg = new Uint8Array(Buffer.concat([Buffer.from(AUTH_DOMAIN, "utf8"), nonce, pubkey]));
  const msgHash = new Uint8Array(createHash("sha256").update(authMsg).digest());
  const signature = await key.sign(msgHash);
  return { pubkey: new Uint8Array(pubkey), signature: new Uint8Array(signature) };
}

function sendFrame(stream: Stream, bytes: Uint8Array): void {
  stream.send(lp.encode.single(bytes));
}

function makeRelay(): RelayAdapter {
  const recorded: RelaySessionAssignment[] = [];
  return {
    recordAssignment(a: RelaySessionAssignment) { recorded.push(a); return { ok: true as const }; },
    discardSession() {},
    submitForSeal() { return { ok: false as const, reason: "session_not_found" }; },
    confirmSeal() {},
    rejectSeal() {},
  } as unknown as RelayAdapter;
}

/** Open a signaling stream and authenticate, optionally as a visiting connection. */
async function connectAndAuth(
  key: ReturnType<typeof generateKeypair>,
  dirNode: Awaited<ReturnType<typeof createDirectoryNode>>,
  scope: ReturnType<typeof createTestScope>,
  opts: { visiting?: boolean } = {},
): Promise<{ stream: Stream; reader: StreamReader; pubkey: Uint8Array; clientNode: Awaited<ReturnType<typeof createNode>> }> {
  const clientNode = await createNode({ keyProvider: key, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
  await clientNode.start();
  scope.addCleanup(() => clientNode.stop());
  await clientNode.dial(dirNode.node.listenAddresses()[0]);
  const stream = await clientNode.newStream(dirNode.node.getPeerId(), SIGNALING_PROTOCOL_ID);
  const reader = new StreamReader(stream);

  const challengeBytes = await reader.readDecoded();
  const challenge = decodeOutboundSignalingFrame(challengeBytes);
  if (!challenge || challenge.type !== "signaling_auth_challenge") throw new Error("expected challenge");
  const { pubkey, signature } = await signAuth(challenge.nonce, key);
  sendFrame(stream, CBOR_ENC.encode({
    type: "signaling_auth_response", pubkey, signature,
    ...(opts.visiting ? { visiting: true } : {}),
  }));
  const ackBytes = await reader.readDecoded();
  const ack = decodeOutboundSignalingFrame(ackBytes);
  if (!ack || ack.type !== "signaling_auth_ok") throw new Error(`expected auth_ok, got ${ack?.type}`);
  return { stream, reader, pubkey, clientNode };
}

function makeProfile(kLocalHex: string): AgentProfile {
  return {
    k_local_pubkey: kLocalHex,
    primary_pubkey: "primary-" + kLocalHex.slice(0, 16),
    ml_dsa_pubkey: "mldsa-" + kLocalHex.slice(0, 16),
    phone_stub_hash: "phone-" + kLocalHex.slice(0, 16),
    registered_at: 1000,
    status: "active",
    agent_id: "agent-" + kLocalHex.slice(0, 16),
    profile: {},
  } as AgentProfile;
}

describe("cross-node discovery handler — 3-state answer over the wire (item 1)", () => {
  let scope = createTestScope();
  let store: InMemoryDirectoryStore;
  let dirNode: Awaited<ReturnType<typeof createDirectoryNode>>;

  beforeEach(async () => {
    scope = createTestScope();
    store = new InMemoryDirectoryStore();
    dirNode = await createDirectoryNode({
      keyProvider: generateKeypair(),
      relay: makeRelay(),
      relayEndpoint: { peer_id: "12D3KooWRelayTest", multiaddrs: ["/ip4/127.0.0.1/tcp/9999"] },
      store,
      nodeId: "aws-eu-central-1",
    });
    scope.addCleanup(dirNode.stop);
  });
  afterEach(() => scope.run(async () => {}));

  async function lookup(reader: StreamReader, stream: Stream, target: Uint8Array) {
    sendFrame(stream, CBOR_ENC.encode({ type: "discovery_lookup", target_pubkey: target }));
    const o = cborDecode(await reader.readDecoded()) as Record<string, unknown>;
    return o;
  }

  it("online: target has a profile + fresh online presence ⇒ discovery_lookup_result online + owning node", async () => {
    const target = new Uint8Array(32).fill(0x11);
    const targetHex = Buffer.from(target).toString("hex");
    store.setProfile(makeProfile(targetHex));
    store.setPresenceForDiscovery(targetHex, { rawOnline: true, owningNodeId: "aws-eu-central-1", nodeFresh: true });

    const A = await connectAndAuth(generateKeypair(), dirNode, scope);
    const o = await lookup(A.reader, A.stream, target);
    expect(o["type"]).toBe("discovery_lookup_result");
    expect(o["state"]).toBe("online");
    expect(o["owning_node_ids"]).toEqual(["aws-eu-central-1"]);
  });

  it("offline: target has a profile but presence is offline ⇒ offline, empty owning_node_ids", async () => {
    const target = new Uint8Array(32).fill(0x22);
    const targetHex = Buffer.from(target).toString("hex");
    store.setProfile(makeProfile(targetHex));
    store.setPresenceForDiscovery(targetHex, { rawOnline: false, owningNodeId: "aws-eu-central-1", nodeFresh: true });

    const A = await connectAndAuth(generateKeypair(), dirNode, scope);
    const o = await lookup(A.reader, A.stream, target);
    expect(o["state"]).toBe("offline");
    expect(o["owning_node_ids"]).toEqual([]);
  });

  it("unknown_agent: no profile row for the target ⇒ unknown_agent (a bad address, not an outage)", async () => {
    const target = new Uint8Array(32).fill(0x33);
    const A = await connectAndAuth(generateKeypair(), dirNode, scope);
    const o = await lookup(A.reader, A.stream, target);
    expect(o["state"]).toBe("unknown_agent");
    expect(o["owning_node_ids"]).toEqual([]);
  });
});

describeLive("cross-node visiting-auth presence integrity (item 3, pg-backed) — Story C scenario 2 at unit level", () => {
  let scope = createTestScope();
  let pool: pg.Pool;
  let dirNode: Awaited<ReturnType<typeof createDirectoryNode>>;
  const THIS_NODE = "aws-eu-central-1-visit-test";
  const OTHER_NODE = "aws-us-east-1-visit-test";
  const touched: string[] = [];

  beforeEach(async () => {
    scope = createTestScope();
    pool = new pg.Pool({ connectionString: DB_URL });
    dirNode = await createDirectoryNode({
      keyProvider: generateKeypair(),
      relay: makeRelay(),
      relayEndpoint: { peer_id: "12D3KooWRelayTest", multiaddrs: ["/ip4/127.0.0.1/tcp/9999"] },
      pgPool: pool,
      nodeId: THIS_NODE,
    });
    scope.addCleanup(dirNode.stop);
  });
  afterEach(async () => {
    if (touched.length) await pool.query(`DELETE FROM agent_presence WHERE k_local_pubkey = ANY($1)`, [touched]);
    touched.length = 0;
    await scope.run(async () => {});
    await pool.end();
  });

  async function presenceRow(kHex: string) {
    const r = await pool.query<{ owning_node_id: string; online: boolean }>(
      `SELECT owning_node_id, online FROM agent_presence WHERE k_local_pubkey = $1`, [kHex]);
    return r.rows[0] ?? null;
  }
  async function waitFor<T>(fn: () => Promise<T>, pred: (v: T) => boolean, ms = 2000): Promise<T> {
    const start = Date.now();
    // Date.now in tests is fine (not a workflow script).
    for (;;) {
      const v = await fn();
      if (pred(v)) return v;
      if (Date.now() - start > ms) return v;
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  it("a NORMAL auth writes presence (this node claims ownership, online)", async () => {
    const key = generateKeypair();
    const kHex = Buffer.from(await key.getPublicKey()).toString("hex");
    touched.push(kHex);
    await connectAndAuth(key, dirNode, scope, { visiting: false });
    const row = await waitFor(() => presenceRow(kHex), (r) => r !== null);
    expect(row).not.toBeNull();
    expect(row!.owning_node_id).toBe(THIS_NODE);
    expect(row!.online).toBe(true);
  });

  it("a VISITING auth writes NO presence (connect suppressed)", async () => {
    const key = generateKeypair();
    const kHex = Buffer.from(await key.getPublicKey()).toString("hex");
    touched.push(kHex);
    await connectAndAuth(key, dirNode, scope, { visiting: true });
    // Give any (erroneous) async presence write time to land, then assert it did NOT.
    await new Promise((r) => setTimeout(r, 300));
    expect(await presenceRow(kHex)).toBeNull();
  });

  it("a visiting connect+disconnect over a row owned by ANOTHER node leaves it untouched (no re-home, no false-offline)", async () => {
    const key = generateKeypair();
    const kHex = Buffer.from(await key.getPublicKey()).toString("hex");
    touched.push(kHex);
    // Alice is really homed on OTHER_NODE, online.
    await pool.query(
      `INSERT INTO agent_presence (k_local_pubkey, owning_node_id, online, last_seen_at, updated_at)
       VALUES ($1, $2, true, now(), now())`, [kHex, OTHER_NODE]);

    // Alice VISITS this node, then drops the transient connection.
    const A = await connectAndAuth(key, dirNode, scope, { visiting: true });
    await new Promise((r) => setTimeout(r, 150)); // let any connect-write attempt settle
    await A.clientNode.stop();                     // close the stream → directory disconnect handler
    await new Promise((r) => setTimeout(r, 400)); // let any disconnect-write attempt settle

    const row = await presenceRow(kHex);
    expect(row).not.toBeNull();
    expect(row!.owning_node_id).toBe(OTHER_NODE); // NOT re-homed to this node
    expect(row!.online).toBe(true);               // NOT falsely marked offline while her real home is alive
  });
});
