/**
 * LEVER-001 — FROST SHARE-REFUSAL honor-check (DOD-INV-6 / SI-001), the load-bearing path.
 *
 * test-attacker finding 4: J-SUSPEND only exercises the session-ROUTING gate (cello_initiate_session →
 * agent_suspended), which fires before any ceremony. The SI-001 invariant — "even if the operator's
 * own device (and its valid client share) is the compromise, the federation refuses its share" — lives
 * at the FROST SHARE gate in #handleFrostStream, where an attacker who drives frost frames DIRECTLY
 * (bypassing the polite routing) is stopped. That path had no test: deleting it would still pass
 * J-SUSPEND. This test drives a raw frost_commit_request against a paused agent that HAS a valid share
 * and asserts the node refuses (AGENT_SUSPENDED) anyway — and a non-paused positive control that
 * pins the refusal to the suspension, not an always-refuse.
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
import { Encoder, decode as cborDecode } from "cbor-x";
import * as lp from "it-length-prefixed";
import { randomBytes } from "node:crypto";
import { generateKeypair } from "@cello-protocol/crypto";
import { bootstrapKeyShares } from "@cello-protocol/crypto/frost/frost-threshold-signer.js";
import { createInProcessStubs } from "@cello-protocol/crypto/frost/stubs.js";
import { createNode } from "@cello-protocol/transport";
import type { Stream } from "@libp2p/interface";
import { InMemoryDirectoryStore } from "@cello-protocol/interfaces/stubs";
import { createDirectoryNode } from "../directory-node.js";
import { FROST_PROTOCOL_ID } from "../frost-handler.js";
import { InMemoryShareStore } from "../share-store.js";
import type { RelayAdapter } from "../directory-node.js";

setupV3Tests();

const CBOR = new Encoder({ tagUint8Array: false });

// Minimal relay stub — a frost_commit refusal never touches the relay; only construction needs it.
function makeRelay(): RelayAdapter {
  return {
    recordAssignment: () => ({ ok: true as const }),
    discardSession: () => {},
    submitForSeal: () => ({ ok: false as const, reason: "session_not_found" }),
    confirmSeal: () => {},
    rejectSeal: () => {},
  } as unknown as RelayAdapter;
}

async function readFrame(stream: Stream): Promise<Record<string, unknown>> {
  for await (const chunk of lp.decode(stream)) {
    const bytes = chunk instanceof Uint8Array ? chunk : (chunk as { subarray(): Uint8Array }).subarray();
    return cborDecode(bytes) as Record<string, unknown>;
  }
  throw new Error("frost stream closed with no response");
}

let scope: TestScope;
beforeEach(() => { scope = createTestScope(); });
afterEach(() => scope.run(async () => {}));

type Mode = "none" | "suspended" | "burned";

async function waitForShareGone(
  shareStore: InMemoryShareStore,
  pubkey: string,
  epochId: string,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (shareStore.getShare(pubkey, epochId) === undefined) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("share was not destroyed within timeout");
}

describe("LEVER-001/002 — FROST share gate refusal + burn share-destruction (SI-001)", () => {
  // Build a directory node holding a REAL, valid K_server share for an agent, with the agent in the given
  // revocation state. Returns the pieces so a test can drive a frost frame AND assert at-rest share state.
  async function buildNode(mode: Mode) {
    const store = new InMemoryDirectoryStore();
    const shareStore = new InMemoryShareStore();

    // A real, valid K_server share (so a refusal/destroy is NOT "no share" but the honor-check / burn).
    const agentPubkeyHex = Buffer.from(randomBytes(32)).toString("hex");
    const epochId = `${agentPubkeyHex}:epoch:1`;
    const stubs = createInProcessStubs(1);
    await bootstrapKeyShares(Buffer.from(agentPubkeyHex, "hex"), { threshold: 2, participants: 1, directoryNodeStubs: stubs });
    const share = stubs[0].getShareForTest();
    if (!share) throw new Error("no share");
    shareStore.storeShare(agentPubkeyHex, epochId, share);

    if (mode === "suspended") store.setAgentSuspended(agentPubkeyHex, true);
    if (mode === "burned") store.setAgentBurned(agentPubkeyHex); // sets paused + burned (mirrors applyRevocationFlag)

    // Spy logger so a test can assert the reconcile aggregate signal (fallback-finder #2).
    const events: string[] = [];
    const logger = {
      info(e: string) { events.push(e); },
      warn(e: string) { events.push(e); },
      error(e: string) { events.push(e); },
      debug() {},
    } as unknown as Parameters<typeof createDirectoryNode>[0]["logger"];

    const dirNode = await createDirectoryNode({
      keyProvider: generateKeypair(),
      relay: makeRelay(),
      relayEndpoint: { peer_id: "12D3KooWRelayTest", multiaddrs: ["/ip4/127.0.0.1/tcp/9999"] },
      store,
      shareStore,
      logger,
    });
    scope.addCleanup(dirNode.stop);
    return { store, shareStore, dirNode, agentPubkeyHex, epochId, events };
  }

  // Dial the node and send a raw frost_commit_request, returning the response frame.
  async function sendFrostCommit(
    dirNode: Awaited<ReturnType<typeof buildNode>>["dirNode"],
    agentPubkeyHex: string,
    epochId: string,
  ): Promise<Record<string, unknown>> {
    const clientNode = await createNode({ keyProvider: generateKeypair(), listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await clientNode.start();
    scope.addCleanup(() => clientNode.stop());
    await clientNode.dial(dirNode.node.listenAddresses()[0]);
    const stream = await clientNode.newStream(dirNode.node.getPeerId(), FROST_PROTOCOL_ID);
    stream.send(lp.encode.single(CBOR.encode({ type: "frost_commit_request", agentPubkey: agentPubkeyHex, epochId })));
    return readFrame(stream);
  }

  it("SI-001: a PAUSED agent's frost_commit_request is refused AGENT_SUSPENDED — despite a valid share", async () => {
    const { dirNode, agentPubkeyHex, epochId } = await buildNode("suspended");
    const resp = await sendFrostCommit(dirNode, agentPubkeyHex, epochId);
    expect(resp.type).toBe("frost_commit_response");
    expect(resp.ok).toBe(false);
    expect(resp.reason).toBe("AGENT_SUSPENDED");
  });

  it("positive control: a NON-paused agent's frost_commit_request succeeds (refusal is pinned to suspension)", async () => {
    const { dirNode, agentPubkeyHex, epochId } = await buildNode("none");
    const resp = await sendFrostCommit(dirNode, agentPubkeyHex, epochId);
    expect(resp.type).toBe("frost_commit_response");
    expect(resp.ok, `non-paused must not be refused: ${JSON.stringify(resp)}`).toBe(true);
  });

  // LEVER-002 gap (test-attacker): the EAGER-on-observe destruction at the frost gate had no coverage —
  // deleting it left every test green. Drive a frost_commit against a BURNED agent: it must be refused
  // AND the gate must ZERO this node's share as a result (fire-and-forget, so poll for it).
  it("LEVER-002 eager-on-observe: a BURNED agent's frost_commit is refused AND its share is destroyed", async () => {
    const { shareStore, dirNode, agentPubkeyHex, epochId } = await buildNode("burned");
    expect(shareStore.getShare(agentPubkeyHex, epochId), "precondition: the share exists").toBeDefined();

    const resp = await sendFrostCommit(dirNode, agentPubkeyHex, epochId);
    expect(resp.ok).toBe(false);
    expect(resp.reason).toBe("AGENT_SUSPENDED");

    // The eager destroy is fire-and-forget after the refusal — the burned agent's K_server share must go.
    await waitForShareGone(shareStore, agentPubkeyHex, epochId);
    expect(shareStore.getShare(agentPubkeyHex, epochId)).toBeUndefined();
  });

  // LEVER-002 gap (test-attacker): the reconcile sweep's idle-node ZEROING had no coverage — only
  // listBurnedAgentPubkeys/isAgentBurned were asserted, so a list-but-don't-zero impl passed. Drive the
  // actual sweep on a node that was NEVER asked to sign: it must zero the burned agent's at-rest share.
  it("LEVER-002 reconcile sweep: an idle node zeroes a burned agent's share (never asked to sign)", async () => {
    const { shareStore, dirNode, agentPubkeyHex, epochId, events } = await buildNode("burned");
    expect(shareStore.getShare(agentPubkeyHex, epochId), "precondition: the share exists").toBeDefined();

    events.length = 0; // ignore boot-time events; assert on THIS explicit sweep
    await dirNode.directory.reconcileBurnedShares();

    expect(
      shareStore.getShare(agentPubkeyHex, epochId),
      "the reconcile sweep must zero an idle burned agent's share, not just list it",
    ).toBeUndefined();
    // fallback-finder #2: the sweep emits an aggregate result so a PERSISTENT failure is alarmable.
    expect(events, "a clean sweep over a burned agent must emit the aggregate complete signal").toContain(
      "frost.burn.reconcile.complete",
    );
    expect(events).not.toContain("frost.burn.reconcile.incomplete");
  });
});

// LEVER-002 gap (test-attacker): the in-memory cache drop had no coverage — the live test exercises the
// encrypted PG store directly, bypassing the in-memory cache the hot signing path reads. A no-op memory
// destroy would let a burned agent's cached share survive in-process. Prove getShare returns undefined.
describe("LEVER-002 — InMemoryShareStore.destroyShares clears the in-process cache", () => {
  it("after destroyShares, getShare returns undefined for every epoch of the agent", async () => {
    const shareStore = new InMemoryShareStore();
    const pubkey = Buffer.from(randomBytes(32)).toString("hex");
    const other = Buffer.from(randomBytes(32)).toString("hex");
    const stubs = createInProcessStubs(1);
    await bootstrapKeyShares(Buffer.from(pubkey, "hex"), { threshold: 2, participants: 1, directoryNodeStubs: stubs });
    const share = stubs[0].getShareForTest();
    if (!share) throw new Error("no share");
    // Two epochs for the agent, plus a co-tenant share that must survive.
    shareStore.storeShare(pubkey, `${pubkey}:epoch:1`, share);
    shareStore.storeShare(pubkey, `${pubkey}:epoch:2`, share);
    shareStore.storeShare(other, `${other}:epoch:1`, share);

    await shareStore.destroyShares(pubkey);

    expect(shareStore.getShare(pubkey, `${pubkey}:epoch:1`)).toBeUndefined();
    expect(shareStore.getShare(pubkey, `${pubkey}:epoch:2`)).toBeUndefined();
    // Scoped to the agent — a different agent's cached share is untouched.
    expect(shareStore.getShare(other, `${other}:epoch:1`)).toBeDefined();
  });
});

// TRUST-001 backstop (fallback-finder #2): a PERSISTENT orphan-sweep failure must escalate to a distinct
// alarmable event, not just ERROR every tick forever. Drive runPickupSweep() against a store whose sweep
// throws and assert the threshold behavior + reset-on-success.
describe("TRUST-001 — orphan-sweep persistent-failure escalation", () => {
  it("escalates to trust_signal.pickup.sweep.persistent_failure after N consecutive failures; success resets", async () => {
    const events: string[] = [];
    const logger = {
      info() {}, warn() {}, debug() {},
      error(e: string) { events.push(e); },
    } as unknown as Parameters<typeof createDirectoryNode>[0]["logger"];

    const store = new InMemoryDirectoryStore();
    let failSweep = true;
    // Override the no-op stub sweep to fail on demand (simulates a permanent grant/schema regression).
    store.sweepUndeliverablePickups = async () => {
      if (failSweep) throw new Error("sweep boom");
      return 0;
    };

    const dirNode = await createDirectoryNode({
      keyProvider: generateKeypair(),
      relay: makeRelay(),
      relayEndpoint: { peer_id: "12D3KooWRelayTest", multiaddrs: ["/ip4/127.0.0.1/tcp/9999"] },
      store,
      shareStore: new InMemoryShareStore(),
      logger,
    });
    scope.addCleanup(dirNode.stop);

    // 4 failures: per-tick ERROR each time, but NOT yet the escalation event (threshold is 5).
    for (let i = 0; i < 4; i++) await dirNode.directory.runPickupSweep();
    expect(events.filter((e) => e === "trust_signal.pickup.sweep.failed")).toHaveLength(4);
    expect(events).not.toContain("trust_signal.pickup.sweep.persistent_failure");

    // The 5th consecutive failure crosses the threshold → the distinct, alarmable event fires once.
    await dirNode.directory.runPickupSweep();
    expect(events).toContain("trust_signal.pickup.sweep.persistent_failure");

    // A success resets the counter — a later failure does not immediately re-escalate.
    failSweep = false;
    await dirNode.directory.runPickupSweep();
    events.length = 0;
    failSweep = true;
    await dirNode.directory.runPickupSweep();
    expect(events, "one failure after a reset must not re-trigger the escalation").not.toContain(
      "trust_signal.pickup.sweep.persistent_failure",
    );
  });
});
