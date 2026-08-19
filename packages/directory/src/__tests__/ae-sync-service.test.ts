/**
 * M12 DOD-AE-APPEND-1/MUTABLE-1 — AeSyncService wiring (libp2p face of the AE channel).
 *
 * Proves the WIRING over real lp varint framing + real CBOR + real Ed25519, with an in-memory
 * Stream pair standing in for libp2p (the protocol itself is proven in ae-channel.test.ts; the
 * 3-process libp2p run is DOD-AE-LOCAL-E2E-1):
 *  - a dialing service converges its store onto a responding service's store END TO END through
 *    streamWire framing, and emits §6 events (started → authenticated → completed);
 *  - the responder fails CLOSED when the transport delivers no remote PeerId (pre-0.0.27);
 *  - a peer failure is isolated (round.failed for that peer; the OTHER peer still syncs);
 *  - the fork signature (pulled>0, applied=0) raises antientropy.round.fork_suspected only on a
 *    streak (≥2 consecutive), never on the first occurrence;
 *  - manifestEntryMultiaddr maps endpoints exactly like the client bootstrap mapping.
 */

import { describe, it, expect } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import type { Stream } from "@libp2p/interface";
import type { ConsortiumManifest } from "@cello-protocol/protocol-types";
import type { Logger } from "@cello-protocol/interfaces";
import { AeSyncService, manifestEntryMultiaddr, type AeTransport } from "../ae-sync-service.js";
import { AE_PROTOCOL_ID, type AeNodeIdentity } from "../ae-channel.js";
import type { AeStoreView, TierARecord, TierBRecord } from "../anti-entropy-engine.js";
import { computeTableDigest } from "../set-reconciliation.js";
import { tierBTableDigest } from "../ae-round.js";
import { encodeTierARecord, AGENT_REVOCATIONS_SPEC } from "../ae-table-encoders.js";

// ── In-memory lp-capable Stream pair (send() feeds the peer's async iterator) ────────────────
interface Inbox { chunks: Array<Uint8Array | null>; waiters: Array<() => void> }
function feedInbox(inbox: Inbox, c: Uint8Array | null): void {
  inbox.chunks.push(c);
  inbox.waiters.shift()?.();
}
function makeStream(own: Inbox, peer: Inbox): Stream {
  return {
    async *[Symbol.asyncIterator]() {
      for (;;) {
        if (own.chunks.length === 0) await new Promise<void>((r) => own.waiters.push(r));
        const c = own.chunks.shift();
        if (c === null || c === undefined) return;
        yield c;
      }
    },
    send(bytes: Uint8Array | { subarray(): Uint8Array }) {
      feedInbox(peer, bytes instanceof Uint8Array ? bytes : bytes.subarray());
    },
    async close() { feedInbox(peer, null); }, // closing tells the PEER its read side ended
    abort() { feedInbox(peer, null); },
  } as unknown as Stream;
}
function streamPair(): [Stream, Stream] {
  const inA: Inbox = { chunks: [], waiters: [] };
  const inB: Inbox = { chunks: [], waiters: [] };
  return [makeStream(inA, inB), makeStream(inB, inA)];
}

// ── Identities + manifest ────────────────────────────────────────────────────────────────────
const seedA = new Uint8Array(32).fill(0xa7);
const seedB = new Uint8Array(32).fill(0xb8);
const pub = (s: Uint8Array): string => Buffer.from(ed25519.getPublicKey(s)).toString("hex");
const A: AeNodeIdentity = { nodeId: "aws-use1", peerId: "12D3KooWAAA", sign: (t) => ed25519.sign(t, seedA) };
const B: AeNodeIdentity = { nodeId: "gcp-usc1", peerId: "12D3KooWBBB", sign: (t) => ed25519.sign(t, seedB) };

const manifest: ConsortiumManifest = {
  version: 2,
  not_before: "2026-01-01T00:00:00Z",
  expires: "2027-01-01T00:00:00Z",
  nodes: [
    { nodeId: A.nodeId, pubkey: pub(seedA), region: "us-east-1", provider: "aws", endpoint: "https://a.example", role: "validator", peerId: A.peerId },
    { nodeId: B.nodeId, pubkey: pub(seedB), region: "us-central1", provider: "gcp", endpoint: "https://b.example", role: "validator", peerId: B.peerId },
  ],
  signatures: [],
};

// ── Tiny store (Tier-A only — the protocol is proven elsewhere) ──────────────────────────────
type RevRow = { agent_id: string; epoch_id: string | null; reason: string | null; signature: string; revoked_at: string };
class MemStore implements AeStoreView {
  revocations = new Map<string, RevRow>();
  tierATables(): string[] { return ["agent_revocations"]; }
  tierBTables(): string[] { return []; }
  tierARecordHashes(): string[] {
    return [...this.revocations.values()].map((r) => encodeTierARecord(AGENT_REVOCATIONS_SPEC, r).hash);
  }
  // Digest-first advertisement: the O(1)-per-table divergence check (design §3 step 1).
  tierATableDigest(): string { return computeTableDigest(this.tierARecordHashes()); }
  tierBTableDigest(): string { return tierBTableDigest(this.tierBVersions()); }
  tierBVersions(): Map<string, string> { return new Map(); }
  serveTierA(_t: string, hashes: readonly string[]): TierARecord[] {
    const want = new Set(hashes);
    return [...this.revocations.values()]
      .map((r) => ({ hash: encodeTierARecord(AGENT_REVOCATIONS_SPEC, r).hash, body: r }))
      .filter((rec) => want.has(rec.hash));
  }
  serveTierB(): TierBRecord[] { return []; }
  applyTierA(_t: string, records: readonly TierARecord[]): number {
    let n = 0;
    for (const rec of records) {
      const r = rec.body as RevRow;
      if (!this.revocations.has(r.agent_id)) { this.revocations.set(r.agent_id, r); n++; }
    }
    return n;
  }
  applyTierB(): number { return 0; }
}
const rev = (id: string): RevRow => ({ agent_id: id, epoch_id: "e1", reason: "c", signature: "ab".repeat(64), revoked_at: "1785200000000" });

function testLogger(): Logger & { events: Array<[string, Record<string, unknown>]> } {
  const events: Array<[string, Record<string, unknown>]> = [];
  const push = (e: string, c: Record<string, unknown>) => { events.push([e, c]); };
  return { events, info: push, warn: push, error: push, debug: push } as unknown as Logger & { events: Array<[string, Record<string, unknown>]> };
}

/** Wire two services together: S_dial's newStream() feeds S_resp's registered inbound handler. */
function pairServices(opts?: { respStore?: MemStore; dialStore?: MemStore; deliverRemotePeerId?: string | null; dialManifest?: typeof manifest }) {
  const respStore = opts?.respStore ?? new MemStore();
  const dialStore = opts?.dialStore ?? new MemStore();
  const respLogger = testLogger();
  const dialLogger = testLogger();

  let inboundHandler: ((stream: Stream, remotePeerId?: string) => void | Promise<void>) | undefined;
  const respTransport: AeTransport = {
    async handle(_p, handler) { inboundHandler = handler; },
    async dial() { throw new Error("responder does not dial in this test"); },
    async newStream() { throw new Error("responder does not open streams in this test"); },
  };
  const dialTransport: AeTransport = {
    async handle() { /* not used on the dial side here */ },
    async dial(multiaddr: string) {
      return { peerId: multiaddr.split("/p2p/")[1] ?? "" };
    },
    async newStream(_peerId: string, protocolId: string) {
      expect(protocolId).toBe(AE_PROTOCOL_ID);
      if (!inboundHandler) throw new Error("responder handler not registered");
      const [dialSide, respSide] = streamPair();
      // deliverRemotePeerId: null → simulate a pre-0.0.27 transport delivering nothing.
      const remote = opts?.deliverRemotePeerId === null ? undefined : (opts?.deliverRemotePeerId ?? A.peerId);
      void inboundHandler(respSide, remote);
      return dialSide;
    },
  };

  const respService = new AeSyncService({
    transport: respTransport, manifest: () => manifest, identity: B, store: respStore, logger: respLogger,
  });
  const dialService = new AeSyncService({
    transport: dialTransport, manifest: () => opts?.dialManifest ?? manifest, identity: A, store: dialStore, logger: dialLogger,
  });
  return { respService, dialService, respStore, dialStore, respLogger, dialLogger };
}

describe("AeSyncService — libp2p-face wiring", () => {
  it("maps manifest endpoints to dial multiaddrs exactly like the client bootstrap mapping", () => {
    expect(manifestEntryMultiaddr("https://directory-us1.cello.mygentic.ai", "12D3KooWX"))
      .toBe("/dns4/directory-us1.cello.mygentic.ai/tcp/443/wss/p2p/12D3KooWX");
    expect(manifestEntryMultiaddr("http://directory-us1.cello.mygentic.ai", "12D3KooWX"))
      .toBe("/dns4/directory-us1.cello.mygentic.ai/tcp/80/ws/p2p/12D3KooWX");
    expect(manifestEntryMultiaddr("http://host:8080", "12D3KooWX"))
      .toBe("/dns4/host/tcp/8080/ws/p2p/12D3KooWX");
    // Loopback e2e: an IPv4-literal host must be /ip4/ (a /dns4/ IP literal does not resolve).
    expect(manifestEntryMultiaddr("http://127.0.0.1:9123", "12D3KooWX"))
      .toBe("/ip4/127.0.0.1/tcp/9123/ws/p2p/12D3KooWX");
  });

  it("dial service converges onto the responder's store through real lp+CBOR framing, emitting §6 events", async () => {
    const { respService, dialService, respStore, dialStore, dialLogger } = pairServices();
    respStore.revocations.set("agX", rev("agX"));
    await respService.start(); // registers the inbound handler
    respService.stop(); // timer not needed — we drive the dial explicitly

    await dialService.syncPeer(B.nodeId, "https://b.example", B.peerId);

    expect(dialStore.revocations.has("agX")).toBe(true); // converged over the wire
    const names = dialLogger.events.map(([e]) => e);
    expect(names).toContain("antientropy.round.started");
    expect(names).toContain("antientropy.peer.authenticated");
    expect(names).toContain("antientropy.round.completed");
    const completed = dialLogger.events.find(([e]) => e === "antientropy.round.completed")![1];
    expect(completed.pulled).toBe(1);
    expect(completed.applied).toBe(1);
    expect(completed.correlationId).toBeDefined();
  });

  it("fails CLOSED when the transport delivers no remote PeerId (pre-0.0.27 transport)", async () => {
    const { respService, dialService, respLogger, dialStore, respStore } = pairServices({ deliverRemotePeerId: null });
    respStore.revocations.set("agX", rev("agX"));
    await respService.start();
    respService.stop();

    await dialService.syncPeer(B.nodeId, "https://b.example", B.peerId);

    // The responder refused before serving anything: no convergence, and the cause is named.
    expect(dialStore.revocations.has("agX")).toBe(false);
    expect(respLogger.events.some(([e, c]) => e === "antientropy.peer.auth_failed" && c.reason === "transport_no_remote_peerid")).toBe(true);
  });

  it("a failing peer is isolated — the other peer still converges (sovereign fallback)", async () => {
    // Drives syncAllPeers, which is where per-peer isolation actually lives. The previous version
    // called syncPeer twice by hand, so gutting that loop — making it throw on the first failure, or
    // Promise.all with no catch — left it green: it was named for the SOVEREIGN claim and could not
    // detect the claim's loss. It also carried dead code and a comment describing a plan it abandoned.
    // A manifest with a BROKEN peer listed BEFORE the healthy one, so a loop that stops on the first
    // failure never reaches B. The broken entry's pubkey is not the key it will sign with, so its
    // handshake fails — a real per-peer failure, whichever layer it lands in.
    const withBroken = {
      ...manifest,
      nodes: [
        manifest.nodes[0]!,
        { nodeId: "azure-weu", pubkey: "00".repeat(32), region: "westeurope", provider: "azure",
          endpoint: "https://down.example", role: "validator", peerId: "12D3KooWDown" } as (typeof manifest)["nodes"][number],
        manifest.nodes[1]!,
      ],
    };
    const { respService, dialService, respStore, dialStore, dialLogger } =
      pairServices({ dialManifest: withBroken });
    respStore.revocations.set("agX", rev("agX"));
    await respService.start();
    respService.stop();

    await dialService.syncAllPeers();

    // The healthy peer converged DESPITE the broken one being attempted first — that is the claim.
    expect(dialStore.revocations.has("agX"), "the loop must continue past a failing peer").toBe(true);
    const names = dialLogger.events.map(([e]) => e);
    // The broken peer failed at the HANDSHAKE, not mid-round, so the event is peer.auth_failed —
    // asserted by what it actually emits rather than by what I first assumed.
    expect(names, `events: ${names.join(",")}`).toContain("antientropy.peer.auth_failed");
    expect(names.filter((n) => n === "antientropy.round.completed").length).toBe(1);
  });

  it("fork signature: fork_suspected fires only on a STREAK (≥2 consecutive pulled>0/applied=0 rounds)", async () => {
    // A responder whose served Tier-A record has a colliding natural key with different content on
    // the dial side: pulled every round, applied 0 every round (the permanent-fork shape).
    const respStore = new MemStore();
    respStore.revocations.set("agF", rev("agF"));
    const dialStore = new MemStore();
    dialStore.revocations.set("agF", { ...rev("agF"), reason: "different" }); // same key, different content
    const { respService, dialService, dialLogger } = pairServices({ respStore, dialStore });
    await respService.start();
    respService.stop();

    await dialService.syncPeer(B.nodeId, "https://b.example", B.peerId);
    let forks = dialLogger.events.filter(([e]) => e === "antientropy.round.fork_suspected");
    expect(forks.length).toBe(0); // first occurrence: could be a benign mid-round write — no alarm

    await dialService.syncPeer(B.nodeId, "https://b.example", B.peerId);
    forks = dialLogger.events.filter(([e]) => e === "antientropy.round.fork_suspected");
    expect(forks.length).toBe(1); // the streak IS the alarm
    expect(forks[0][1].consecutive).toBe(2);

    // AND IT NAMES THE TABLE. Without this the alarm reports a count and nothing else: in production
    // it fired continuously from 2026-08-09 past a streak of 412, and finding out which table was
    // responsible meant dumping all 17 Tier-A tables off two live nodes and diffing them. An alarm
    // that cannot say what is wrong cannot be acted on.
    expect(forks[0][1].unconverged).toEqual([
      { tier: "A", table: "agent_revocations", planned: 1, pulled: 1, applied: 0 },
    ]);
    // Tier-A is unambiguous — say so, because a Tier-B entry here is often benign and the operator
    // must not have to know that to read the alarm.
    expect(String(forks[0][1].reason)).toContain("same natural key, different content");

    // The same breakdown rides the routine round log, so the gap is visible before a streak builds.
    const completed = dialLogger.events.filter(([e]) => e === "antientropy.round.completed");
    expect(completed.at(-1)![1].unconverged).toEqual([
      { tier: "A", table: "agent_revocations", planned: 1, pulled: 1, applied: 0 },
    ]);
  });

  it("a healthy round carries NO unconverged field — the alarm's input must not be noise", async () => {
    // The counterpart that keeps the field meaningful. If it appeared on converged rounds it would
    // be ignored within a day, which is exactly what happened to the bare counter it replaces.
    const respStore = new MemStore();
    respStore.revocations.set("agOK", rev("agOK"));
    const dialStore = new MemStore(); // lacks it entirely → pulls AND applies
    const { respService, dialService, dialLogger } = pairServices({ respStore, dialStore });
    await respService.start();
    respService.stop();

    await dialService.syncPeer(B.nodeId, "https://b.example", B.peerId);
    const completed = dialLogger.events.filter(([e]) => e === "antientropy.round.completed");
    expect(completed.length).toBeGreaterThan(0);
    expect(completed.at(-1)![1].unconverged).toBeUndefined();
    expect(dialLogger.events.filter(([e]) => e === "antientropy.round.fork_suspected").length).toBe(0);
  });
});

// ─── DOD-M12-CONN-AE-1: a dead connection must not end anti-entropy permanently ───────────────
//
// The same held-connection defect as the relay↔directory link, on the directory↔directory one, and
// worse in one respect: `#attempt` dials and opens a stream with NO retry at all. `libp2p.dial()`
// returns an existing registered connection whenever its SOCKET status reads `open` and never
// inspects the muxer, so once a peer's muxer dies every round fails at `newStream` from then on —
// silently, for as long as the process lives, while both nodes report healthy. Replication stops
// and nothing says so; a restart is the only cure, because a restart is the only thing that empties
// the connection manager.
describe("DOD-M12-CONN-AE-1: a stale peer connection is evicted and retried, not fatal for the process", () => {
  function transportThatFailsFirstStream(opts: { omitHangUp?: boolean; neverFails?: boolean } = {}) {
    const trace: string[] = [];
    let streamAttempts = 0;
    let inboundHandler: ((stream: Stream, remotePeerId?: string) => void | Promise<void>) | undefined;
    const respTransport: AeTransport = {
      async handle(_p, handler) { inboundHandler = handler; },
      async dial() { throw new Error("responder does not dial"); },
      async newStream() { throw new Error("responder does not open streams"); },
    };
    const dialTransport: AeTransport = {
      async handle() {},
      async dial(multiaddr: string) {
        trace.push("dial");
        return { peerId: multiaddr.split("/p2p/")[1] ?? "" };
      },
      ...(opts.omitHangUp === true ? {} : {
        async hangUp(_peerId: string) { trace.push("hangUp"); },
      }),
      async newStream(_peerId: string, _protocolId: string) {
        streamAttempts += 1;
        trace.push("newStream");
        if (streamAttempts === 1 && opts.neverFails !== true) {
          throw Object.assign(
            new Error('The connection muxer is "closed" and not "open"'),
            { reason: "connection_lost" },
          );
        }
        if (!inboundHandler) throw new Error("responder handler not registered");
        const [dialSide, respSide] = streamPair();
        void inboundHandler(respSide, A.peerId);
        return dialSide;
      },
    } as AeTransport;
    return { respTransport, dialTransport, trace };
  }

  it("evicts and retries once, so a dead handle costs one round rather than every future round", async () => {
    const { respTransport, dialTransport, trace } = transportThatFailsFirstStream();
    const respStore = new MemStore();
    const dialStore = new MemStore();
    const respLogger = testLogger();
    const dialLogger = testLogger();
    const respService = new AeSyncService({
      transport: respTransport, manifest: () => manifest, identity: B, store: respStore, logger: respLogger,
    });
    await respService.start();
    const dialService = new AeSyncService({
      transport: dialTransport, manifest: () => manifest, identity: A, store: dialStore, logger: dialLogger,
    });

    await dialService.syncPeer(B.nodeId, "http://host:8080", B.peerId);

    // Eviction must sit between the failed stream and the second dial. Without it the dial resolves
    // from libp2p's registry and returns the same dead connection.
    const evictIdx = trace.indexOf("hangUp");
    expect(evictIdx).toBeGreaterThan(-1);
    expect(trace.slice(evictIdx, evictIdx + 3)).toEqual(["hangUp", "dial", "newStream"]);
  });

  it("does not evict when the first stream opens cleanly", async () => {
    // Uses the SAME scripted transport as the eviction case, with the first-failure branch turned
    // off, so `hangUp` is both present and traced. The previous version of this test inspected a
    // locally declared `const trace = []` that no transport ever wrote to, against a fixture whose
    // dial transport had no `hangUp` at all — so eviction was impossible by construction and the
    // assertion was `expect([]).not.toContain("hangUp")`. It passed on an implementation that
    // evicted on every single round.
    const { respTransport, dialTransport, trace } = transportThatFailsFirstStream({ neverFails: true });
    const respService = new AeSyncService({
      transport: respTransport, manifest: () => manifest, identity: B,
      store: new MemStore(), logger: testLogger(),
    });
    await respService.start();
    const dialService = new AeSyncService({
      transport: dialTransport, manifest: () => manifest, identity: A,
      store: new MemStore(), logger: testLogger(),
    });

    await dialService.syncPeer(B.nodeId, "http://host:8080", B.peerId);

    // A healthy round must not tear the connection down — that would turn one cached connection
    // into a reconnect per sync interval, per peer, and (because hangUp is peer-scoped) would abort
    // the peer's own inbound round every time.
    expect(trace).toContain("newStream");
    expect(trace).not.toContain("hangUp");
  });

  it("SAYS SO when the transport cannot evict, rather than looking like it retried properly", async () => {
    const { respTransport, dialTransport, trace } = transportThatFailsFirstStream({ omitHangUp: true });
    const respStore = new MemStore();
    const dialStore = new MemStore();
    const dialLogger = testLogger();
    const respService = new AeSyncService({
      transport: respTransport, manifest: () => manifest, identity: B, store: respStore, logger: testLogger(),
    });
    await respService.start();
    const dialService = new AeSyncService({
      transport: dialTransport, manifest: () => manifest, identity: A, store: dialStore, logger: dialLogger,
    });

    await dialService.syncPeer(B.nodeId, "http://host:8080", B.peerId);

    expect(trace).not.toContain("hangUp");
    expect(dialLogger.events.some(([e]) => e === "antientropy.peer.evict.unavailable")).toBe(true);
  });
});
