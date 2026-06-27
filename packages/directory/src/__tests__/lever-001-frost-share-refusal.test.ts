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

describe("LEVER-001 — FROST share gate refuses a paused agent (SI-001, even with a valid share)", () => {
  async function setup(suspended: boolean) {
    const store = new InMemoryDirectoryStore();
    const shareStore = new InMemoryShareStore();

    // A real, valid K_server share for the agent (so a refusal is NOT "no share" but the honor-check).
    const agentPubkeyHex = Buffer.from(randomBytes(32)).toString("hex");
    const epochId = `${agentPubkeyHex}:epoch:1`;
    const stubs = createInProcessStubs(1);
    await bootstrapKeyShares(Buffer.from(agentPubkeyHex, "hex"), { threshold: 2, participants: 1, directoryNodeStubs: stubs });
    const share = stubs[0].getShareForTest();
    if (!share) throw new Error("no share");
    shareStore.storeShare(agentPubkeyHex, epochId, share);

    if (suspended) store.setAgentSuspended(agentPubkeyHex, true);

    const dirKey = generateKeypair();
    const dirNode = await createDirectoryNode({
      keyProvider: dirKey,
      relay: makeRelay(),
      relayEndpoint: { peer_id: "12D3KooWRelayTest", multiaddrs: ["/ip4/127.0.0.1/tcp/9999"] },
      store,
      shareStore,
    });
    scope.addCleanup(dirNode.stop);

    const clientNode = await createNode({ keyProvider: generateKeypair(), listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await clientNode.start();
    scope.addCleanup(() => clientNode.stop());
    await clientNode.dial(dirNode.node.listenAddresses()[0]);
    const stream = await clientNode.newStream(dirNode.node.getPeerId(), FROST_PROTOCOL_ID);
    stream.send(lp.encode.single(CBOR.encode({ type: "frost_commit_request", agentPubkey: agentPubkeyHex, epochId })));
    return readFrame(stream);
  }

  it("SI-001: a PAUSED agent's frost_commit_request is refused AGENT_SUSPENDED — despite a valid share", async () => {
    const resp = await setup(true);
    expect(resp.type).toBe("frost_commit_response");
    expect(resp.ok).toBe(false);
    expect(resp.reason).toBe("AGENT_SUSPENDED");
  });

  it("positive control: a NON-paused agent's frost_commit_request succeeds (refusal is pinned to suspension)", async () => {
    const resp = await setup(false);
    expect(resp.type).toBe("frost_commit_response");
    expect(resp.ok, `non-paused must not be refused: ${JSON.stringify(resp)}`).toBe(true);
  });
});
