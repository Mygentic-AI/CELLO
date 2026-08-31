/**
 * CELLO-NODE-004: NetworkRelayAdapter tests
 *
 * TDD Phase R — RED FIRST.
 * These tests cover the directory-side NetworkRelayAdapter that communicates
 * with the relay over /cello/directory-relay/1.0.0.
 *
 * AC-002: NetworkRelayAdapter.discardSession sends discard_session → relay removes session
 *
 * DOD-M15-RELAYADMIN-DEAD-FRAMES-1 (2026-08-24): the relay's dispatch for record_assignment,
 * confirm_seal and reject_seal was removed from this wire protocol (no deployed directory has
 * sent them since Option B and the seal-broker cutover shipped). AC-001/AC-004/AC-005, which
 * proved those three round-trips, are removed with them. NetworkRelayAdapter.recordAssignment(),
 * .confirmSeal() and .rejectSeal() themselves are UNCHANGED — directory-node.ts already never
 * calls them (Option B moved recording to the client, and the directory takes no confirm/reject
 * action on seal outcomes) — see "Newly discovered" in 004-RELAY-admin-dead-frames.md. The
 * updateMultiaddr regression test below now proves its redial with discardSession instead of
 * recordAssignment, since recordAssignment is no longer a live wire call.
 *
 * AC-007 (full end-to-end session flow) is in e2e-tests/src/__tests__/node-004-e2e.test.ts
 * because it requires the full client stack.
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
import { Encoder } from "cbor-x";
import { generateKeypair } from "@cello-protocol/crypto";
import { createRelayNode } from "@cello-protocol/relay";
import { createDirectoryNode } from "@cello-protocol/directory";
import { NetworkRelayAdapter } from "../network-relay-adapter.js";

setupV3Tests();

const CBOR_ENC = new Encoder({ tagUint8Array: false });

// ─── AC-002: NetworkRelayAdapter unit test ─────────────────────────────────────
//
// This test creates a real relay node, a real directory node with NetworkRelayAdapter,
// and verifies the adapter sends correct frames over the network protocol.
//
// AC-001 (recordAssignment → assignment_ok) removed with the relay's wire dispatch for
// record_assignment — DOD-M15-RELAYADMIN-DEAD-FRAMES-1.

describe("AC-002: NetworkRelayAdapter.discardSession → relay removes session", () => {
  let scope = createTestScope();
  beforeEach(() => { scope = createTestScope(); });
  afterEach(() => scope.run(async () => {}));

  it("relay removes session after network discard_session", async () => {
    const dirKp = generateKeypair();
    const dirPubkey = await dirKp.getPublicKey();

    const { relay: relayNode, node: relayLibp2p, stop: stopRelay } = await createRelayNode({
      directoryPubkey: dirPubkey,
    });
    scope.addCleanup(stopRelay);

    const relayPeerId = relayLibp2p.getPeerId();
    const relayMultiaddrs = relayLibp2p.listenAddresses();

    const networkAdapter = new NetworkRelayAdapter({
      keyProvider: dirKp,
      relayPeerId,
      relayMultiaddrs,
    });

    const dirResult = await createDirectoryNode({
      keyProvider: dirKp,
      relay: networkAdapter,
      relayEndpoint: { peer_id: relayPeerId, multiaddrs: relayMultiaddrs },
    });
    scope.addCleanup(dirResult.stop);
    await networkAdapter.connect(dirResult.node);

    // Register a session in-process first
    const clientKpA = generateKeypair();
    const clientKpB = generateKeypair();
    const pubA = await clientKpA.getPublicKey();
    const pubB = await clientKpB.getPublicKey();
    const sessionId = new Uint8Array(randomBytes(16));
    const sessionTimestamp = Date.now();

    const tbs = CBOR_ENC.encode([
      sessionId, pubA, pubB,
      sessionTimestamp > 0xffffffff ? BigInt(sessionTimestamp) : sessionTimestamp,
    ]) as Uint8Array;
    const directory_signature = await dirKp.sign(tbs);
    relayNode.recordAssignment({ session_id: sessionId, participant_a: pubA, participant_b: pubB, session_timestamp: sessionTimestamp, directory_signature });

    // Verify session exists
    const beforeDiscard = relayNode.submitForSeal(sessionId);
    expect(beforeDiscard.ok).toBe(true);

    // Discard over network
    await networkAdapter.discardSession(sessionId);

    // Session should be gone
    const afterDiscard = relayNode.submitForSeal(sessionId);
    expect(afterDiscard.ok).toBe(false);
    if (!afterDiscard.ok) {
      expect(afterDiscard.reason).toBe("session_not_found");
    }
  }, 20_000);
});

// AC-004 (confirmSeal → confirm_seal wire round-trip) and AC-005 (rejectSeal → reject_seal wire
// round-trip) removed with the relay's dispatch for those frame types —
// DOD-M15-RELAYADMIN-DEAD-FRAMES-1. NetworkRelayAdapter.confirmSeal()/.rejectSeal() are unchanged
// (directory-node.ts already never calls them; see the note at the top of this file).

// ─── Regression: transport errors and relay rejections surface real reason ─────

describe("Regression: recordAssignment transport failure exposes exception message", () => {
  let scope = createTestScope();
  beforeEach(() => { scope = createTestScope(); });
  afterEach(() => scope.run(async () => {}));

  it("returns relay_unavailable and logs transport error when relay is unreachable after connect", async () => {
    const dirKp = generateKeypair();
    const dirPubkey = await dirKp.getPublicKey();

    // Start relay, connect, then stop relay so transport throws on the next call
    const { node: relayLibp2p, stop: stopRelay } = await createRelayNode({
      directoryPubkey: dirPubkey,
    });
    scope.addCleanup(stopRelay);

    const relayPeerId = relayLibp2p.getPeerId();
    const relayMultiaddrs = relayLibp2p.listenAddresses();

    const loggedEvents: Array<{ event: string; fields: Record<string, unknown> }> = [];
    const warnEvents: Array<{ event: string; fields: Record<string, unknown> }> = [];
    const mockLogger = {
      info: () => {},
      warn: (event: string, fields: Record<string, unknown>) => { warnEvents.push({ event, fields }); },
      error: (event: string, fields: Record<string, unknown>) => { loggedEvents.push({ event, fields }); },
      debug: () => {},
    };

    const networkAdapter = new NetworkRelayAdapter({
      keyProvider: dirKp,
      relayPeerId,
      relayMultiaddrs,
      logger: mockLogger,
    });

    const dirResult = await createDirectoryNode({
      keyProvider: dirKp,
      relay: networkAdapter,
      relayEndpoint: { peer_id: relayPeerId, multiaddrs: relayMultiaddrs },
    });
    scope.addCleanup(dirResult.stop);
    await networkAdapter.connect(dirResult.node);

    // Stop the relay so the next sendAndReceive throws
    await stopRelay();

    const clientKpA = generateKeypair();

    /**
     * DOD-M15-RELAYADMIN-DEAD-FRAMES-1 re-review: RE-POINTED from `recordAssignment` to
     * `getSessionLiveness`. The subject here has always been `describeThrown` — that CelloNode
     * throws plain objects, so a naive `String(err)` yields "[object Object]" and destroys the only
     * diagnostic on this path. That subject is alive and worth keeping; the frame it used to ride on
     * is not, since `record_assignment` no longer reaches the wire at all and the test would have
     * been asserting against a method that returns before sending anything.
     *
     * `getSessionLiveness` is a genuinely live directory→relay dial, so this now proves the same
     * property on a path that still exists.
     */
    const counterpartyPubkey = await clientKpA.getPublicKey();
    const liveness = await networkAdapter.getSessionLiveness(counterpartyPubkey);
    expect(liveness, "a relay we cannot reach yields unknown, never a fabricated verdict").toBe("unknown");

    const transportErr = warnEvents.find(e => e.event === "relay.get_session_liveness.transport_error");
    expect(transportErr, "the transport failure must be recorded — it is this path's only diagnostic").toBeDefined();
    expect(typeof transportErr?.fields.error).toBe("string");
    expect(
      (transportErr?.fields.error as string),
      "describeThrown must render CelloNode's plain-object throw into something readable — " +
        "'[object Object]' is the regression this test exists for.",
    ).not.toBe("[object Object]");
    expect((transportErr?.fields.error as string).length).toBeGreaterThan(0);
  }, 20_000);
});

describe("DOD-M15-RELAYADMIN-DEAD-FRAMES-1 re-review: the retired senders REFUSE, by name", () => {
  let scope = createTestScope();
  beforeEach(() => { scope = createTestScope(); });
  afterEach(() => scope.run(async () => {}));

  it("★★★ recordAssignment / confirmSeal / rejectSeal send NOTHING and say so — not 'relay unavailable'", async () => {
    /**
     * Re-review finding 2. Deleting the three frames from the relay's wire left the DIRECTORY's
     * senders fully wired, fully documented, and completely broken — and the breakage was engineered
     * to be invisible. `recordAssignment` built and signed a frame, sent it into an abort, and
     * reported `relay_unavailable` about a relay that was up, authenticating, and answering every
     * other frame. `confirmSeal` and `rejectSeal` were worse: a bare `catch {}` with no log and a
     * void return, so a caller wiring one back in would get a method that compiles, is declared
     * non-optional by the interface, is documented as returning `confirm_ok`, and does nothing
     * forever, silently, on both machines.
     *
     * The relay is deliberately HEALTHY and correctly keyed here. That is the whole point: if the
     * refusal came from the relay being unreachable, this test would prove nothing.
     */
    const dirKp = generateKeypair();
    const dirPubkey = await dirKp.getPublicKey();

    const { node: relayLibp2p, stop: stopRelay } = await createRelayNode({
      directoryPubkey: dirPubkey, // CORRECT key — the relay would authenticate us happily
    });
    scope.addCleanup(stopRelay);

    const errorEvents: Array<{ event: string; fields: Record<string, unknown> }> = [];
    const mockLogger = {
      info: () => {}, warn: () => {}, debug: () => {},
      error: (event: string, fields: Record<string, unknown>) => { errorEvents.push({ event, fields }); },
    };

    const relayPeerId = relayLibp2p.getPeerId();
    const relayMultiaddrs = relayLibp2p.listenAddresses();
    const networkAdapter = new NetworkRelayAdapter({
      keyProvider: dirKp,
      relayPeerId,
      relayMultiaddrs,
      logger: mockLogger,
    });
    const dirResult = await createDirectoryNode({
      keyProvider: dirKp,
      relay: networkAdapter,
      relayEndpoint: { peer_id: relayPeerId, multiaddrs: relayMultiaddrs },
    });
    scope.addCleanup(dirResult.stop);
    await networkAdapter.connect(dirResult.node);

    const sessionId = new Uint8Array(randomBytes(16));
    const clientKpA = generateKeypair();
    const clientKpB = generateKeypair();
    const result = await networkAdapter.recordAssignment({
      session_id: sessionId,
      participant_a: await clientKpA.getPublicKey(),
      participant_b: await clientKpB.getPublicKey(),
      session_timestamp: Date.now(),
      directory_signature: new Uint8Array(64),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(
        result.reason,
        "the reason must name the RETIREMENT. `relay_unavailable` would be a lie about a healthy " +
          "relay and would send whoever reads it to debug the network.",
      ).toBe("frame_type_retired_relayadmin_dead_frames_1");
    }
    expect(errorEvents.find(e => e.event === "relay.record_assignment.retired")).toBeDefined();

    // void returns, so the log is the only channel these two have.
    await networkAdapter.confirmSeal(sessionId);
    expect(
      errorEvents.find(e => e.event === "relay.confirm_seal.retired"),
      "confirmSeal used to swallow its failure entirely — no log, no return value, nothing.",
    ).toBeDefined();

    await networkAdapter.rejectSeal(sessionId, "merkle_root_mismatch");
    const rejected = errorEvents.find(e => e.event === "relay.reject_seal.retired");
    expect(rejected).toBeDefined();
    expect(rejected?.fields.reason, "the caller's reason is kept, not dropped on the floor").toBe("merkle_root_mismatch");
  }, 20_000);
});

// ─── updateMultiaddr: regression tests for stale-IP fix ──────────────────────
//
// Before this fix, NetworkRelayAdapter used a static CELLO_RELAY_MULTIADDR env var.
// When the relay task was replaced and got a new private IP, the idle libp2p connection
// expired and re-dial went to the stale IP → relay_unavailable on every session request.
// The fix: relay sends multiaddr in relay_register; directory calls updateMultiaddr().

describe("updateMultiaddr: adapter dials updated address after relay IP changes", () => {
  let scope = createTestScope();
  beforeEach(() => { scope = createTestScope(); });
  afterEach(() => scope.run(async () => {}));

  it("discardSession succeeds after updateMultiaddr replaces a stale address", async () => {
    const dirKp = generateKeypair();
    const dirPubkey = await dirKp.getPublicKey();

    // Start first relay (represents the "old" relay at a now-dead IP)
    const { node: relayLibp2pA, stop: stopRelayA } = await createRelayNode({ directoryPubkey: dirPubkey });
    scope.addCleanup(stopRelayA);
    const relayPeerIdA = relayLibp2pA.getPeerId();
    const relayMultiaddrsA = relayLibp2pA.listenAddresses();

    // Start adapter pointed at relay A
    const networkAdapter = new NetworkRelayAdapter({
      keyProvider: dirKp,
      relayPeerId: relayPeerIdA,
      relayMultiaddrs: relayMultiaddrsA,
    });
    const dirResult = await createDirectoryNode({
      keyProvider: dirKp,
      relay: networkAdapter,
      relayEndpoint: { peer_id: relayPeerIdA, multiaddrs: relayMultiaddrsA },
    });
    scope.addCleanup(dirResult.stop);
    await networkAdapter.connect(dirResult.node);

    // Stop relay A — simulates the ECS task being replaced
    await stopRelayA();

    // Start relay B (new ECS task, different IP = different listen address)
    const { relay: relayNodeB, node: relayLibp2pB, stop: stopRelayB } = await createRelayNode({ directoryPubkey: dirPubkey });
    scope.addCleanup(stopRelayB);
    const relayMultiaddrsB = relayLibp2pB.listenAddresses();

    // Simulate what relay_register handler does: update the adapter with the new multiaddr.
    // listenAddresses() already includes /p2p/<peerId> — use it directly.
    const newMultiaddr = String(relayMultiaddrsB[0]);
    networkAdapter.updateMultiaddr(newMultiaddr);

    // discardSession must now reach relay B — record_assignment is no longer a live wire call
    // (DOD-M15-RELAYADMIN-DEAD-FRAMES-1), so this proves the redial with the one admin frame that
    // still is: discard_session. Register the session directly on relay B in-process first (that
    // path is unaffected by the wire change) so there is something for the network call to discard.
    const clientKpA = generateKeypair();
    const clientKpB = generateKeypair();
    const pubA = await clientKpA.getPublicKey();
    const pubB = await clientKpB.getPublicKey();
    const sessionId = new Uint8Array(randomBytes(16));
    const sessionTimestamp = Date.now();
    const tbs = CBOR_ENC.encode([
      sessionId, pubA, pubB,
      sessionTimestamp > 0xffffffff ? BigInt(sessionTimestamp) : sessionTimestamp,
    ]) as Uint8Array;
    const directory_signature = await dirKp.sign(tbs);
    relayNodeB.recordAssignment({ session_id: sessionId, participant_a: pubA, participant_b: pubB, session_timestamp: sessionTimestamp, directory_signature });
    expect(relayNodeB.submitForSeal(sessionId).ok).toBe(true);

    await networkAdapter.discardSession(sessionId);

    // Confirm the discard reached relay B — proves the redial found the NEW address
    const afterDiscard = relayNodeB.submitForSeal(sessionId);
    expect(afterDiscard.ok).toBe(false);
    if (!afterDiscard.ok) {
      expect(afterDiscard.reason).toBe("session_not_found");
    }
  }, 20_000);
});

// AC-007 (full end-to-end session flow) lives in:
// packages/e2e-tests/src/__tests__/node-004-e2e.test.ts

// ─── DOD-M12-CONN-DIR-RELAY-1: the directory's end of the same dead link ──────
//
// The relay's redial was fixed in DOD-M12-CONN-EVICT-1. This is the SAME link from the other end,
// and it had the identical shape: newStream, and on failure dial once and retry, with nothing
// evicting the dead connection. `libp2p.dial()` returns an EXISTING connection whenever one is
// registered for the peer and its socket status reads `open` — `findExistingConnection` filters on
// `con.status` and never inspects the muxer — so the redial returns the same dead object and the
// retry fails on the check that just failed.
//
// This is not a hypothetical parallel. `#sendAndReceive` is how the directory asks the relay for
// seal leaves and session liveness, which is the UNILATERAL-SEAL path — the backstop an operator is
// told in capitals will "escalate to a unilateral seal and produce a real receipt", and which
// produced nothing 3 times out of 3 in the same window.

describe("DOD-M12-CONN-DIR-RELAY-1: the directory evicts a dead relay connection before redialling", () => {
  /** Scripted node: fails the first newStream with the real muxer error, then succeeds. */
  function scriptedNode(opts: { omitHangUp?: boolean } = {}) {
    const trace: string[] = [];
    let streamAttempts = 0;
    const node = {
      async dial(_addr: string) { trace.push("dial"); return { peerId: "12D3KooWFakeRelay" }; },
      onPeerConnect(_h: (p: string) => void) {},
      onPeerDisconnect(_h: (p: string) => void) {},
      getConnections: () => [],
      ...(opts.omitHangUp === true ? {} : {
        async hangUp(_p: string) { trace.push("hangUp"); },
      }),
      async newStream() {
        streamAttempts += 1;
        trace.push("newStream");
        if (streamAttempts === 1) {
          throw Object.assign(
            new Error('The connection muxer is "closed" and not "open"'),
            { reason: "connection_lost" },
          );
        }
        return {
          send: () => {},
          close: async () => {},
          [Symbol.asyncIterator]: async function* () { /* no frames — transport path is the subject */ },
        } as never;
      },
    };
    return { node, trace };
  }

  function adapterOn(node: unknown, logger?: unknown) {
    const a = new NetworkRelayAdapter({
      relayPeerId: "12D3KooWFakeRelay",
      relayMultiaddrs: ["/ip4/10.0.0.9/tcp/4001/p2p/12D3KooWFakeRelay"],
      keyProvider: generateKeypair(),
      ...(logger ? { logger } : {}),
    } as never);
    (a as unknown as { connect(n: unknown): void }).connect(node);
    return a;
  }

  it("evicts BEFORE the redial, so the dial cannot return the dead connection", async () => {
    const { node, trace } = scriptedNode();
    const adapter = adapterOn(node);

    // getSessionLiveness swallows transport errors by design (it returns "unknown"), so the call's
    // return value is not the assertion — the ORDER of the repair is.
    await adapter.getSessionLiveness(new Uint8Array(32).fill(3));

    const evictIdx = trace.indexOf("hangUp");
    expect(evictIdx).toBeGreaterThan(-1);
    // Evicting after the dial would tear down the connection just established; never evicting
    // leaves the dial resolving from the registry. Only this order repairs anything.
    expect(trace.slice(evictIdx)).toEqual(["hangUp", "dial", "newStream"]);
  });

  it("does not evict when the first stream succeeds", async () => {
    const trace: string[] = [];
    const node = {
      async dial(_addr: string) { trace.push("dial"); return { peerId: "12D3KooWFakeRelay" }; },
      onPeerConnect() {}, onPeerDisconnect() {}, getConnections: () => [],
      async hangUp(_p: string) { trace.push("hangUp"); },
      async newStream() {
        trace.push("newStream");
        return {
          send: () => {}, close: async () => {},
          [Symbol.asyncIterator]: async function* () { /* none */ },
        } as never;
      },
    };
    const adapter = adapterOn(node);

    await adapter.getSessionLiveness(new Uint8Array(32).fill(3));

    // A repair, not a policy: hanging up a healthy link on every call would turn one cached
    // connection into a reconnect per request.
    expect(trace).not.toContain("hangUp");
  });

  it("SAYS SO when the transport cannot evict, instead of looking repaired", async () => {
    const logged: Array<{ event: string; fields: Record<string, unknown> }> = [];
    const logger = {
      info: () => {}, warn: () => {}, debug: () => {},
      error: (event: string, fields: Record<string, unknown>) => { logged.push({ event, fields }); },
    };
    const { node, trace } = scriptedNode({ omitHangUp: true });
    const adapter = adapterOn(node, logger);

    await adapter.getSessionLiveness(new Uint8Array(32).fill(3));

    expect(trace).not.toContain("hangUp");
    // Absence is REPORTED. Without this the directory keeps exactly the behaviour this unit
    // removes while its logs look identical to a fixed one.
    expect(logged.some((l) => l.event === "relay.adapter.evict.unavailable")).toBe(true);
  });
});
