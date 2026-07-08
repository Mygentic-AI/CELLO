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
import { randomBytes, createHash } from "node:crypto";
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

// SEC-2: the K_local auth binding the frost signing stream now requires. Mirrors the directory's
// verification: Ed25519(SHA-256("CELLO-FROST-AUTH-v1" || agentPubkeyBytes || utf8(epochId) || tail)),
// tail = utf8("commit") for a commit request, framedMsg for a sign request. Signed with K_local priv.
const FROST_AUTH_DOMAIN = "CELLO-FROST-AUTH-v1";
function frostAuthHash(agentPubkeyHex: string, epochId: string, tail: Uint8Array): Uint8Array {
  return new Uint8Array(
    createHash("sha256")
      .update(Buffer.concat([
        Buffer.from(FROST_AUTH_DOMAIN, "utf8"),
        Buffer.from(agentPubkeyHex, "hex"),
        Buffer.from(epochId, "utf8"),
        Buffer.from(tail),
      ]))
      .digest(),
  );
}
async function frostAuthSig(
  signer: { sign(h: Uint8Array): Promise<Uint8Array> },
  agentPubkeyHex: string,
  epochId: string,
  tail: Uint8Array,
): Promise<Uint8Array> {
  return signer.sign(frostAuthHash(agentPubkeyHex, epochId, tail));
}
// SEC-2 domain separation: 0x00 = commit; 0x01 || framedMsg = sign.
const COMMIT_TAIL = new Uint8Array([0x00]);
function signTail(framedMsg: Uint8Array): Uint8Array {
  return Buffer.concat([Buffer.from([0x01]), Buffer.from(framedMsg)]);
}

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
    // SEC-2: agentPubkey is now a REAL K_local keypair (not bare random bytes) so the frost request can
    // carry a K_local Ed25519 auth signature the directory verifies against agentPubkey.
    const agentKp = generateKeypair();
    const agentPubkeyHex = Buffer.from(await agentKp.getPublicKey()).toString("hex");
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
    return { store, shareStore, dirNode, agentKp, agentPubkeyHex, epochId, events };
  }

  // Dial the node and send a raw frost_commit_request, returning the response frame. SEC-2: by default
  // it attaches a VALID K_local auth signature (over the "commit" tail). `auth` overrides that:
  //   "omit"  → send NO authSig (the pre-fix unauthenticated request)
  //   Uint8Array → send that exact (e.g. wrong-key / tampered) authSig
  async function sendFrostCommit(
    dirNode: Awaited<ReturnType<typeof buildNode>>["dirNode"],
    agentKp: { sign(h: Uint8Array): Promise<Uint8Array> },
    agentPubkeyHex: string,
    epochId: string,
    auth: "omit" | Uint8Array | "valid" = "valid",
  ): Promise<Record<string, unknown>> {
    const clientNode = await createNode({ keyProvider: generateKeypair(), listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await clientNode.start();
    scope.addCleanup(() => clientNode.stop());
    await clientNode.dial(dirNode.node.listenAddresses()[0]);
    const stream = await clientNode.newStream(dirNode.node.getPeerId(), FROST_PROTOCOL_ID);
    const frame: Record<string, unknown> = { type: "frost_commit_request", agentPubkey: agentPubkeyHex, epochId };
    if (auth !== "omit") {
      frame["authSig"] = auth === "valid" ? await frostAuthSig(agentKp, agentPubkeyHex, epochId, COMMIT_TAIL) : auth;
    }
    stream.send(lp.encode.single(CBOR.encode(frame)));
    return readFrame(stream);
  }

  // SEC-2: send a raw frost_sign_request over the given framedMsg. `auth` follows the same convention;
  // a "valid" auth signs over THIS framedMsg. `authMsg` lets a test sign over a DIFFERENT message than
  // the one sent (the tampered-framedMsg attack).
  async function sendFrostSign(
    dirNode: Awaited<ReturnType<typeof buildNode>>["dirNode"],
    agentKp: { sign(h: Uint8Array): Promise<Uint8Array> },
    agentPubkeyHex: string,
    epochId: string,
    framedMsg: Uint8Array,
    opts: { auth?: "omit" | Uint8Array | "valid"; authMsg?: Uint8Array } = {},
  ): Promise<Record<string, unknown>> {
    const auth = opts.auth ?? "valid";
    const clientNode = await createNode({ keyProvider: generateKeypair(), listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await clientNode.start();
    scope.addCleanup(() => clientNode.stop());
    await clientNode.dial(dirNode.node.listenAddresses()[0]);
    const stream = await clientNode.newStream(dirNode.node.getPeerId(), FROST_PROTOCOL_ID);
    const frame: Record<string, unknown> = {
      type: "frost_sign_request", agentPubkey: agentPubkeyHex, epochId,
      framedMsg, commitmentList: [], ceremonyId: "test-ceremony", peerIdString: "test-ceremony",
    };
    if (auth !== "omit") {
      frame["authSig"] = auth === "valid"
        ? await frostAuthSig(agentKp, agentPubkeyHex, epochId, signTail(opts.authMsg ?? framedMsg))
        : auth;
    }
    stream.send(lp.encode.single(CBOR.encode(frame)));
    return readFrame(stream);
  }

  it("SI-001: a PAUSED agent's frost_commit_request is refused AGENT_SUSPENDED — despite a valid share", async () => {
    const { dirNode, agentKp, agentPubkeyHex, epochId } = await buildNode("suspended");
    // Valid auth so the refusal is pinned to suspension, not the SEC-2 auth gate (which sits before it).
    const resp = await sendFrostCommit(dirNode, agentKp, agentPubkeyHex, epochId);
    expect(resp.type).toBe("frost_commit_response");
    expect(resp.ok).toBe(false);
    expect(resp.reason).toBe("AGENT_SUSPENDED");
  });

  it("positive control: a NON-paused agent's frost_commit_request (WITH valid K_local auth) succeeds", async () => {
    const { dirNode, agentKp, agentPubkeyHex, epochId } = await buildNode("none");
    const resp = await sendFrostCommit(dirNode, agentKp, agentPubkeyHex, epochId);
    expect(resp.type).toBe("frost_commit_response");
    expect(resp.ok, `non-paused with valid auth must not be refused: ${JSON.stringify(resp)}`).toBe(true);
  });

  // ─── SEC-2: FROST signing-path K_local authentication ───
  describe("SEC-2: frost signing stream requires proof of K_local possession", () => {
    it("commit WITHOUT authSig is refused AUTH_REQUIRED (the pre-fix unauthenticated request)", async () => {
      const { dirNode, agentKp, agentPubkeyHex, epochId } = await buildNode("none");
      const resp = await sendFrostCommit(dirNode, agentKp, agentPubkeyHex, epochId, "omit");
      expect(resp.type).toBe("frost_commit_response");
      expect(resp.ok).toBe(false);
      expect(resp.reason).toBe("AUTH_REQUIRED");
    });

    it("commit with a WRONG-KEY authSig is refused AUTH_INVALID — the exact SEC-2 forgery (public key is not enough)", async () => {
      const { dirNode, agentKp, agentPubkeyHex, epochId } = await buildNode("none");
      const attacker = generateKeypair(); // knows the PUBLIC agentPubkeyHex, but not K_local priv
      const forged = await frostAuthSig(attacker, agentPubkeyHex, epochId, COMMIT_TAIL);
      const resp = await sendFrostCommit(dirNode, agentKp, agentPubkeyHex, epochId, forged);
      expect(resp.ok).toBe(false);
      expect(resp.reason).toBe("AUTH_INVALID");
    });

    it("sign WITHOUT authSig is refused AUTH_REQUIRED", async () => {
      const { dirNode, agentKp, agentPubkeyHex, epochId } = await buildNode("none");
      const resp = await sendFrostSign(dirNode, agentKp, agentPubkeyHex, epochId, new Uint8Array([1, 2, 3, 4]), { auth: "omit" });
      expect(resp.type).toBe("frost_sign_response");
      expect(resp.ok).toBe(false);
      expect(resp.reason).toBe("AUTH_REQUIRED");
    });

    it("sign with a WRONG-KEY authSig is refused AUTH_INVALID (forging an arbitrary framedMsg)", async () => {
      const { dirNode, agentKp, agentPubkeyHex, epochId } = await buildNode("none");
      const attacker = generateKeypair();
      const framedMsg = new Uint8Array([9, 9, 9, 9]);
      const forged = await frostAuthSig(attacker, agentPubkeyHex, epochId, framedMsg);
      const resp = await sendFrostSign(dirNode, agentKp, agentPubkeyHex, epochId, framedMsg, { auth: forged });
      expect(resp.ok).toBe(false);
      expect(resp.reason).toBe("AUTH_INVALID");
    });

    it("sign whose authSig was made over a DIFFERENT framedMsg is refused AUTH_INVALID (tamper binding)", async () => {
      const { dirNode, agentKp, agentPubkeyHex, epochId } = await buildNode("none");
      // Auth signed over msg A (with the REAL key), but the frame carries msg B → the binding fails.
      const resp = await sendFrostSign(dirNode, agentKp, agentPubkeyHex, epochId, new Uint8Array([2, 2, 2, 2]), {
        authMsg: new Uint8Array([1, 1, 1, 1]),
      });
      expect(resp.ok).toBe(false);
      expect(resp.reason).toBe("AUTH_INVALID");
    });

    it("sign WITH a valid authSig passes the auth gate (does not fail AUTH_*)", async () => {
      const { dirNode, agentKp, agentPubkeyHex, epochId } = await buildNode("none");
      const resp = await sendFrostSign(dirNode, agentKp, agentPubkeyHex, epochId, new Uint8Array([7, 7, 7, 7]));
      // It may still fail downstream (no in-flight ceremony for this hand-built request) — but NOT on auth.
      expect(resp.reason).not.toBe("AUTH_REQUIRED");
      expect(resp.reason).not.toBe("AUTH_INVALID");
    });
  });

  // LEVER-002 gap (test-attacker): the EAGER-on-observe destruction at the frost gate had no coverage —
  // deleting it left every test green. Drive a frost_commit against a BURNED agent: it must be refused
  // AND the gate must ZERO this node's share as a result (fire-and-forget, so poll for it).
  it("LEVER-002 eager-on-observe: a BURNED agent's frost_commit is refused AND its share is destroyed", async () => {
    const { shareStore, dirNode, agentKp, agentPubkeyHex, epochId } = await buildNode("burned");
    expect(shareStore.getShare(agentPubkeyHex, epochId), "precondition: the share exists").toBeDefined();

    const resp = await sendFrostCommit(dirNode, agentKp, agentPubkeyHex, epochId);
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
