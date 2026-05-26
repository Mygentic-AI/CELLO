/**
 * CELLO-PERSIST-015 E2E — Unilateral seal: B goes offline, A seals, B receives notification.
 *
 * These tests replace the test.todo items in:
 *   packages/directory/src/__tests__/persist-015-unilateral-seal.test.ts
 *   packages/client/src/__tests__/persist-015-unilateral-seal.test.ts
 *
 * Uses deliveryGraceSeconds: 1 so the grace period elapses without a real 600s wait.
 * B's node is stopped (not just disconnected) to ensure the directory has no active
 * stream for B — this puts the session into the "B offline" state that triggers the
 * unilateral path.
 *
 * AC-001: after deliveryGraceSeconds elapses, A's initiateUnilateralSeal() succeeds;
 *         session is sealed with seal_type UNILATERAL on A's side.
 * AC-002: directory rejects SEAL_UNILATERAL before deliveryGraceSeconds with too_early.
 * AC-003: when B reconnects (new node, same key), the directory delivers the
 *         seal_unilateral_notification; B's session shows status=sealed.
 * AC-004: B's client logs the root match/mismatch (verified via session state).
 */

import {
  setupV3Tests,
  createTestScope,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  waitFor,
} from "@claude-flow/testing";
import type { TestScope } from "@claude-flow/testing";
import { generateKeypair, mlDsaKeygen } from "@cello-protocol/crypto";
import { clearTestShares } from "@cello-protocol/crypto/frost/frost-threshold-signer.js";
import { encodeConnectionPackage, buildPseudonymBinding } from "@cello-protocol/protocol-types";
import type { ConnectionPackage } from "@cello-protocol/protocol-types";
import { createNode } from "@cello-protocol/transport";
import { createClient } from "@cello-protocol/client";
import type { SignalRequirementPolicy } from "@cello-protocol/client";
import { createSessionFixture } from "../session-fixture.js";

setupV3Tests();

const openPolicy: SignalRequirementPolicy = { mode: "open", review_mode: "deterministic", requirements: [] };

async function buildMinimalPackageCbor(
  keyProvider: ReturnType<typeof generateKeypair>,
  mlDsaProvider: Awaited<ReturnType<typeof mlDsaKeygen>>,
  primaryPubkeyHex?: string,
): Promise<Uint8Array> {
  const kLocalPubkey = new Uint8Array(await keyProvider.getPublicKey());
  const primaryPubkey = primaryPubkeyHex ? Buffer.from(primaryPubkeyHex, "hex") : new Uint8Array(32);
  const mlDsaPubkey = new Uint8Array(await mlDsaProvider.getPublicKey());
  const bindingResult = await buildPseudonymBinding(
    { pseudonym_label: "test-agent", k_local_pubkey: kLocalPubkey, primary_pubkey: new Uint8Array(primaryPubkey), ml_dsa_pubkey: mlDsaPubkey, created_at: Date.now() },
    mlDsaProvider,
  );
  if (!bindingResult.ok) throw new Error("buildPseudonymBinding failed");
  const pkg: ConnectionPackage = { pseudonym_binding: bindingResult.binding, endorsements: [], attestations: [] };
  return encodeConnectionPackage(pkg);
}

let scope: TestScope;
beforeEach(() => { scope = createTestScope(); clearTestShares(); });
afterEach(() => { clearTestShares(); return scope.run(async () => {}); });

describe("PERSIST-015-E2E AC-002: directory rejects SEAL_UNILATERAL before grace period", () => {
  it("initiateUnilateralSeal returns too_early with remaining_seconds when grace period has not elapsed", async () => {
    // deliveryGraceSeconds: 600 (default) — seal submitted immediately
    const fix = await createSessionFixture({
      register: true,
      requireConnectionGate: true,
      connectionTimeoutMs: 10_000,
    });
    scope.addCleanup(fix.stopAll);

    const mlDsaA = await mlDsaKeygen();
    const packageCbor = await buildMinimalPackageCbor(fix.agentA.kp, mlDsaA, fix.agentA.primaryPubkey);
    const conn = await fix.agentA.client.cello_request_connection({
      target_pubkey: fix.agentB.pubkeyHex,
      package_cbor: packageCbor,
    });
    expect(conn.result).toBe("established");

    const sessionResult = await fix.agentA.client.initiateSession(fix.agentB.pubkeyHex, { timeoutMs: 15_000 });
    expect(sessionResult.ok).toBe(true);
    if (!sessionResult.ok) throw new Error(`initiateSession failed: ${sessionResult.reason}`);
    const sessionIdHex = Buffer.from(sessionResult.sessionId).toString("hex");

    // Immediately try to seal unilaterally — grace period has not elapsed
    const result = await fix.agentA.client.initiateUnilateralSeal(sessionIdHex);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected too_early");
    expect(result.reason).toBe("too_early");
    expect((result as { ok: false; reason: "too_early"; remaining_seconds: number }).remaining_seconds).toBeGreaterThan(0);
  });
});

describe("PERSIST-015-E2E AC-001: A seals unilaterally after grace period", () => {
  it("A seals after deliveryGraceSeconds elapses; session status is sealed with sealType UNILATERAL", async () => {
    // deliveryGraceSeconds: 1 — grace period elapses after 1s
    const fix = await createSessionFixture({
      register: true,
      requireConnectionGate: true,
      connectionTimeoutMs: 10_000,
      deliveryGraceSeconds: 1,
    });
    scope.addCleanup(fix.stopAll);

    const mlDsaA = await mlDsaKeygen();
    const packageCbor = await buildMinimalPackageCbor(fix.agentA.kp, mlDsaA, fix.agentA.primaryPubkey);
    const conn = await fix.agentA.client.cello_request_connection({
      target_pubkey: fix.agentB.pubkeyHex,
      package_cbor: packageCbor,
    });
    expect(conn.result).toBe("established");

    const sessionResult = await fix.agentA.client.initiateSession(fix.agentB.pubkeyHex, { timeoutMs: 15_000 });
    expect(sessionResult.ok).toBe(true);
    if (!sessionResult.ok) throw new Error(`initiateSession failed: ${sessionResult.reason}`);
    const sessionIdHex = Buffer.from(sessionResult.sessionId).toString("hex");

    // Send a message so the session has at least one leaf
    await fix.agentA.client.sendMessage(sessionIdHex, Buffer.from("before B goes offline"));
    await waitFor(
      () => fix.agentB.client.receiveMessage(sessionIdHex) !== null,
      { timeout: 5_000, interval: 50 },
    );

    // B goes offline — stop B's node so the directory loses its stream
    try { await fix.agentB.node.stop(); } catch {}

    // Wait for grace period to elapse (deliveryGraceSeconds: 1)
    await new Promise(resolve => setTimeout(resolve, 1500));

    // A seals unilaterally
    const sealResult = await fix.agentA.client.initiateUnilateralSeal(sessionIdHex);
    expect(sealResult.ok).toBe(true);
    if (!sealResult.ok) throw new Error(`Unilateral seal failed: ${sealResult.reason}`);
    expect(sealResult.sealed_root).toBeInstanceOf(Uint8Array);
    expect(sealResult.sealed_root.length).toBe(32);
    expect(typeof sealResult.sealed_at).toBe("number");

    // A's session must show sealed with UNILATERAL seal type
    const sessions = fix.agentA.client.listSessions();
    const s = sessions.find(x => Buffer.from(x.session_id).toString("hex") === sessionIdHex);
    expect(s?.status).toBe("sealed");
    expect(s?.seal_type).toBe("unilateral");
  });
});

describe("PERSIST-015-E2E AC-003: B reconnects and receives unilateral notification", () => {
  it("B reconnects with a fresh node; directory delivers seal_unilateral_notification; B session status is sealed", async () => {
    const fix = await createSessionFixture({
      register: true,
      requireConnectionGate: true,
      connectionTimeoutMs: 10_000,
      deliveryGraceSeconds: 1,
    });
    scope.addCleanup(fix.stopAll);

    const mlDsaA = await mlDsaKeygen();
    const packageCbor = await buildMinimalPackageCbor(fix.agentA.kp, mlDsaA, fix.agentA.primaryPubkey);
    const conn = await fix.agentA.client.cello_request_connection({
      target_pubkey: fix.agentB.pubkeyHex,
      package_cbor: packageCbor,
    });
    expect(conn.result).toBe("established");

    const sessionResult = await fix.agentA.client.initiateSession(fix.agentB.pubkeyHex, { timeoutMs: 15_000 });
    expect(sessionResult.ok).toBe(true);
    if (!sessionResult.ok) throw new Error(`initiateSession failed: ${sessionResult.reason}`);
    const sessionIdHex = Buffer.from(sessionResult.sessionId).toString("hex");

    // Send a message so B has a leaf to verify against
    await fix.agentA.client.sendMessage(sessionIdHex, Buffer.from("last message before B drops"));
    await waitFor(
      () => fix.agentB.client.receiveMessage(sessionIdHex) !== null,
      { timeout: 5_000, interval: 50 },
    );

    // Capture B's leaf state before it goes offline
    const bSessionBeforeOffline = fix.agentB.client.listSessions()
      .find(x => Buffer.from(x.session_id).toString("hex") === sessionIdHex);
    expect(bSessionBeforeOffline).toBeDefined();

    // B goes offline
    try { await fix.agentB.node.stop(); } catch {}

    // Wait for grace period
    await new Promise(resolve => setTimeout(resolve, 1500));

    // A seals unilaterally
    const sealResult = await fix.agentA.client.initiateUnilateralSeal(sessionIdHex);
    expect(sealResult.ok).toBe(true);
    const sealedRoot = sealResult.ok ? sealResult.sealed_root : null;

    // B reconnects: fresh node, same key
    const nodeB2 = await createNode({ keyProvider: fix.agentB.kp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await nodeB2.start();
    scope.addCleanup(() => nodeB2.stop());

    const directoryEndpoint = { peer_id: fix.dirPeerId, multiaddrs: fix.dirMultiaddrs };
    const clientB2 = createClient(nodeB2, fix.agentB.kp, {
      directoryEndpoint,
      connectionPolicy: openPolicy,
      connectionTimeoutMs: 10_000,
    });
    await clientB2.registerHandler();

    // B2 re-registers — gets already_registered → RegistrationState reconstructed
    const regB2 = await clientB2.register(`+${Buffer.from(new Uint8Array(5)).toString("hex")}`, "DEV-test-token");
    // already_registered returns reconstructed state; error indicates a different failure
    if ("error" in regB2 && regB2.error !== "already_registered") {
      throw new Error(`B2 reg failed: ${regB2.error}`);
    }

    // The directory should deliver the pending notification on reconnect.
    // Wait for B2's session to appear as sealed.
    await waitFor(
      () => {
        const s = clientB2.listSessions().find(x => Buffer.from(x.session_id).toString("hex") === sessionIdHex);
        return s?.status === "sealed";
      },
      { timeout: 10_000, interval: 100 },
    );

    const b2Session = clientB2.listSessions()
      .find(x => Buffer.from(x.session_id).toString("hex") === sessionIdHex);
    expect(b2Session?.status).toBe("sealed");
    expect(b2Session?.seal_type).toBe("unilateral");

    // Sealed root on B2 matches what A reported — AC-004 root verification
    if (sealedRoot && b2Session?.sealed_root) {
      expect(Buffer.from(b2Session.sealed_root).toString("hex"))
        .toBe(Buffer.from(sealedRoot).toString("hex"));
    }
  });
});
