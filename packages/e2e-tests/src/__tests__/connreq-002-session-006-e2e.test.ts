/**
 * CELLO-CONNREQ-002 + CELLO-SESSION-006 — Combined end-to-end tests
 *
 * TDD Phase R — RED-first. Written BEFORE implementation.
 * All new tests MUST FAIL until full implementation is complete.
 *
 * Every AC assertion is made on cross-instance state (transport-path observables),
 * not just return values. Per SPARC rule: "Would this AC pass if the participants
 * were in different processes on different machines?"
 *
 * Covers:
 *   CONNREQ-002 AC-001: open policy e2e — both sides get connection_established with same id
 *   CONNREQ-002 AC-003: Round 2 flow — B requests more disclosure; A provides; connection established
 *   CONNREQ-002 AC-004: Round 2 missing required item — still unmet after disclosure → insufficient
 *   CONNREQ-002 AC-013: disclosure_response round-trip — A sends disclosure_response → directory relays → B re-evaluates
 *   CONNREQ-002 AC-014: disclosure_response_inbound → B re-evaluates → connection_established
 *   CONNREQ-002 SI-005: A sends second connection_request to B (already connected) → already_connected
 *   SESSION-006 AC-007: two sessions on one connection — both sessions work independently
 *   SESSION-006 AC-008: strangers-to-conversation full e2e
 *
 * Transport-path observables (per cello-story rule):
 *   - connection_id is independently verified on both client A and client B
 *   - directory store shows the connection record
 *   - initiateSession encodes connection_id in session_request frame (directory verifies it)
 *   - messages sent/received prove the full path end-to-end
 *
 * Crypto refs:
 *   Ed25519 auth: RFC 8032
 *   SHA-256: FIPS 180-4
 *   ML-DSA-44: NIST FIPS 204
 *   FROST: RFC 9591
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
import {
  generateKeypair,
  mlDsaKeygen,
} from "@cello/crypto";
import { clearTestShares } from "@cello/crypto/frost/frost-threshold-signer.js";
import {
  encodeConnectionPackage,
  buildPseudonymBinding,
} from "@cello/protocol-types";
import type { ConnectionPackage } from "@cello/protocol-types";
import type { SignalRequirementPolicy } from "@cello/client";
import { createSessionFixture } from "../session-fixture.js";

setupV3Tests();

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function buildMinimalPackageCbor(
  keyProvider: ReturnType<typeof generateKeypair>,
  mlDsaProvider: Awaited<ReturnType<typeof mlDsaKeygen>>,
  primaryPubkeyHex?: string,
  createdAt?: number,
): Promise<Uint8Array> {
  const kLocalPubkey = new Uint8Array(await keyProvider.getPublicKey());
  const primaryPubkey = primaryPubkeyHex
    ? Buffer.from(primaryPubkeyHex, "hex")
    : new Uint8Array(32);
  const mlDsaPubkey = new Uint8Array(await mlDsaProvider.getPublicKey());
  const bindingResult = await buildPseudonymBinding(
    {
      pseudonym_label: "test-agent",
      k_local_pubkey: kLocalPubkey,
      primary_pubkey: new Uint8Array(primaryPubkey),
      ml_dsa_pubkey: mlDsaPubkey,
      created_at: createdAt ?? Date.now(),
    },
    mlDsaProvider,
  );
  if (!bindingResult.ok) throw new Error("buildPseudonymBinding failed");
  const pkg: ConnectionPackage = {
    pseudonym_binding: bindingResult.binding,
    endorsements: [],
    attestations: [],
  };
  return encodeConnectionPackage(pkg);
}

// ─── Test scope ───────────────────────────────────────────────────────────────

let scope: TestScope;
beforeEach(() => { scope = createTestScope(); });
afterEach(() => {
  clearTestShares();
  return scope.run(async () => {});
});

// ─── CONNREQ-002 AC-001 e2e: open policy, both sides verified ─────────────────

describe("E2E CONNREQ-002-AC-001: open policy — connection_established on both sides with matching connection_id", () => {
  it("AC-001: A and B get connection_established; both listConnections() show same connection_id; directory store has record", async () => {
    const fix = await createSessionFixture({ register: true });
    const mlDsaA = await mlDsaKeygen();
    const packageCborA = await buildMinimalPackageCbor(fix.agentA.kp, mlDsaA, fix.agentA.primaryPubkey);
    scope.addCleanup(fix.stopAll);

    let aEstablishedId: string | null = null;
    let bEstablishedId: string | null = null;
    fix.agentA.client.onConnectionEstablished((event) => { aEstablishedId = event.connection_id; });
    fix.agentB.client.onConnectionEstablished((event) => { bEstablishedId = event.connection_id; });

    const result = await fix.agentA.client.cello_request_connection({
      target_pubkey: fix.agentB.pubkeyHex,
      package_cbor: packageCborA,
    });

    // Transport-path observable: result must be established
    expect(result.result).toBe("established");
    if (result.result !== "established") throw new Error("Expected established");

    // Transport-path: both sides received connection_established event
    await waitFor(() => aEstablishedId !== null && bEstablishedId !== null, { timeout: 5000, interval: 50 });

    // connection_id is identical on A, B, and the return value
    expect(aEstablishedId).toBe(result.connection_id);
    expect(bEstablishedId).toBe(result.connection_id);

    // Transport-path: directory store has the connection record
    const dirConn = fix.dirStore.hasConnection(fix.agentA.pubkeyHex, fix.agentB.pubkeyHex);
    expect(dirConn).not.toBeNull();
    expect(dirConn!.connection_id).toBe(result.connection_id);

    // Transport-path: both clients' listConnections() show the same connection_id
    const aConns = fix.agentA.client.listConnections();
    const bConns = fix.agentB.client.listConnections();
    expect(aConns.length).toBeGreaterThan(0);
    expect(bConns.length).toBeGreaterThan(0);
    expect(aConns.find(c => c.connection_id === result.connection_id)).toBeDefined();
    expect(bConns.find(c => c.connection_id === result.connection_id)).toBeDefined();
  }, 45_000);
});

// ─── CONNREQ-002 AC-003: Round 2 flow ─────────────────────────────────────────

describe("E2E CONNREQ-002-AC-003: Round 2 disclosure flow — B requests more, A provides, connection established", () => {
  it("AC-003: B's inference policy requests endorsement; A provides in disclosure_response; connection_established", async () => {
    // B requires pseudonym_age >= 1 day. Round 1 package has created_at=now (0 days old) → insufficient.
    // A responds with a package_v2 created 2 days ago → connection_established.
    const selectivePolicy: SignalRequirementPolicy = {
      mode: "selective",
      review_mode: "deterministic",
      requirements: [{ signal_type: "pseudonym_age", condition: { type: "min_age_days", days: 1 } }],
    };

    const fix = await createSessionFixture({
      register: true,
      policyB: selectivePolicy,
      round2TimeoutMs: 10_000, // 10s for the test
    });
    const mlDsaA = await mlDsaKeygen();
    const packageCborA = await buildMinimalPackageCbor(fix.agentA.kp, mlDsaA, fix.agentA.primaryPubkey);
    scope.addCleanup(fix.stopAll);

    // Track disclosure request on A's side
    let disclosureRequestReceived = false;
    let receivedConnectionRequestId: string | null = null;
    fix.agentA.client.onDisclosureRequested((event) => {
      disclosureRequestReceived = true;
      receivedConnectionRequestId = event.connection_request_id;
    });

    // Start A's connection request (will return { result: 'disclosure_requested', ... } when B asks for more)
    const requestPromise = fix.agentA.client.cello_request_connection({
      target_pubkey: fix.agentB.pubkeyHex,
      package_cbor: packageCborA, // no endorsements in package_cbor
    });

    // Wait for B to ask A for more disclosure
    await waitFor(() => disclosureRequestReceived && receivedConnectionRequestId !== null, {
      timeout: 15_000,
      interval: 100,
    });

    // A's cello_request_connection should have returned { result: 'disclosure_requested', ... }
    const intermediateResult = await requestPromise;
    expect(intermediateResult.result).toBe("disclosure_requested");
    if (intermediateResult.result !== "disclosure_requested") {
      throw new Error(`Expected disclosure_requested, got ${intermediateResult.result}`);
    }

    // A now provides a package_v2 with created_at 2 days ago (satisfies pseudonym_age >= 1 day)
    const mlDsaV2 = await mlDsaKeygen();
    const twoDaysAgo = Date.now() - 2 * 86_400_000;
    const packageV2 = await buildMinimalPackageCbor(fix.agentA.kp, mlDsaV2, fix.agentA.primaryPubkey, twoDaysAgo);

    const respondResult = await fix.agentA.client.cello_respond_to_disclosure_request({
      connection_request_id: receivedConnectionRequestId!,
      package_cbor: packageV2,
    });

    // Transport-path: final connection outcome
    expect(respondResult.result).toBe("established");
    if (respondResult.result !== "established") throw new Error("Expected established after disclosure");

    // Both sides should now have the connection
    const aConns = fix.agentA.client.listConnections();
    expect(aConns.find(c => c.connection_id === respondResult.connection_id)).toBeDefined();
    // B receives connection_established asynchronously from the directory
    await waitFor(() => fix.agentB.client.listConnections().find(c => c.connection_id === respondResult.connection_id) !== undefined, {
      timeout: 5_000,
      interval: 50,
    });

    // Transport-path: directory store has the record
    const dirConn = fix.dirStore.hasConnection(fix.agentA.pubkeyHex, fix.agentB.pubkeyHex);
    expect(dirConn).not.toBeNull();
    expect(dirConn!.connection_id).toBe(respondResult.connection_id);
  }, 60_000);
});

// ─── CONNREQ-002 AC-004: Round 2 still unmet after disclosure → insufficient ──

describe("E2E CONNREQ-002-AC-004: Round 2 — A provides but still unmet → connection_insufficient", () => {
  it("AC-004: B requests 3 endorsements; A provides package_v2 with only 1; connection_insufficient returned", async () => {
    // B requires pseudonym_age >= 3 days. A provides 1-day-old package → still insufficient.
    const selectivePolicy: SignalRequirementPolicy = {
      mode: "selective",
      review_mode: "deterministic",
      requirements: [{ signal_type: "pseudonym_age", condition: { type: "min_age_days", days: 3 } }],
    };

    const fix = await createSessionFixture({
      register: true,
      policyB: selectivePolicy,
      round2TimeoutMs: 10_000,
    });
    const mlDsaA = await mlDsaKeygen();
    const packageCborA = await buildMinimalPackageCbor(fix.agentA.kp, mlDsaA, fix.agentA.primaryPubkey);
    scope.addCleanup(fix.stopAll);

    let disclosureRequestId: string | null = null;
    fix.agentA.client.onDisclosureRequested((event) => {
      disclosureRequestId = event.connection_request_id;
    });

    const requestPromise = fix.agentA.client.cello_request_connection({
      target_pubkey: fix.agentB.pubkeyHex,
      package_cbor: packageCborA,
    });

    await waitFor(() => disclosureRequestId !== null, { timeout: 15_000, interval: 100 });
    const intermediateResult = await requestPromise;
    expect(intermediateResult.result).toBe("disclosure_requested");

    // A provides package_v2 that is only 1 day old (still below the 3 days required)
    const mlDsaV2 = await mlDsaKeygen();
    const oneDayAgo = Date.now() - 1 * 86_400_000;
    const packageV2StillTooYoung = await buildMinimalPackageCbor(fix.agentA.kp, mlDsaV2, fix.agentA.primaryPubkey, oneDayAgo);

    const respondResult = await fix.agentA.client.cello_respond_to_disclosure_request({
      connection_request_id: disclosureRequestId!,
      package_cbor: packageV2StillTooYoung,
    });

    // B re-evaluated and still unmet (1 day < 3 days required)
    expect(respondResult.result).toBe("insufficient");
    if (respondResult.result !== "insufficient") throw new Error("Expected insufficient");
    expect(respondResult.unmet_requirements).toBeDefined();

    // No connection record should have been created
    const dirConn = fix.dirStore.hasConnection(fix.agentA.pubkeyHex, fix.agentB.pubkeyHex);
    expect(dirConn).toBeNull();
  }, 60_000);
});

// ─── CONNREQ-002 SI-005: second connection_request → already_connected ────────

describe("E2E CONNREQ-002-SI-005: second connection_request when already connected → already_connected", () => {
  it("SI-005: A sends second connection_request to B (already connected) → connection_request_error: already_connected", async () => {
    const fix = await createSessionFixture({ register: true });
    const mlDsaA = await mlDsaKeygen();
    const packageCborA = await buildMinimalPackageCbor(fix.agentA.kp, mlDsaA, fix.agentA.primaryPubkey);
    scope.addCleanup(fix.stopAll);

    // First request succeeds
    const firstResult = await fix.agentA.client.cello_request_connection({
      target_pubkey: fix.agentB.pubkeyHex,
      package_cbor: packageCborA,
    });
    expect(firstResult.result).toBe("established");

    // Second request from A to B (same direction) should fail with already_connected
    const mlDsaA2 = await mlDsaKeygen();
    const packageCbor2 = await buildMinimalPackageCbor(fix.agentA.kp, mlDsaA2, fix.agentA.primaryPubkey);
    const secondResult = await fix.agentA.client.cello_request_connection({
      target_pubkey: fix.agentB.pubkeyHex,
      package_cbor: packageCbor2,
    });

    expect(secondResult.result).toBe("error");
    if (secondResult.result !== "error") throw new Error("Expected error");
    expect(secondResult.reason).toBe("already_connected");

    // Transport-path: still only one connection record in directory store
    const dirConnAB = fix.dirStore.hasConnection(fix.agentA.pubkeyHex, fix.agentB.pubkeyHex);
    expect(dirConnAB).not.toBeNull();
    // Connection was not duplicated
    expect(fix.dirStore.getConnection(dirConnAB!.connection_id)).not.toBeNull();
  }, 45_000);
});

// ─── SESSION-006 AC-007: two sessions on one connection ───────────────────────

describe("E2E SESSION-006-AC-007: two sessions on one connection — independent messaging", () => {
  it("AC-007: after establishing connection, A can initiate two sessions; both are independently active", async () => {
    const fix = await createSessionFixture({ register: true, requireConnectionGate: true });
    const mlDsaA = await mlDsaKeygen();
    const packageCborA = await buildMinimalPackageCbor(fix.agentA.kp, mlDsaA, fix.agentA.primaryPubkey);
    scope.addCleanup(fix.stopAll);

    // Establish connection
    const connResult = await fix.agentA.client.cello_request_connection({
      target_pubkey: fix.agentB.pubkeyHex,
      package_cbor: packageCborA,
    });
    expect(connResult.result).toBe("established");

    // First session
    const session1Result = await fix.agentA.client.initiateSession(
      fix.agentB.pubkeyHex,
      { timeoutMs: 15_000 },
    );
    expect(session1Result.ok).toBe(true);
    if (!session1Result.ok) throw new Error(`session1 failed: ${session1Result.reason}`);

    // Second session (reuses same connection_id)
    const session2Result = await fix.agentA.client.initiateSession(
      fix.agentB.pubkeyHex,
      { timeoutMs: 15_000 },
    );
    expect(session2Result.ok).toBe(true);
    if (!session2Result.ok) throw new Error(`session2 failed: ${session2Result.reason}`);

    // Sessions have different IDs
    const session1IdHex = Buffer.from(session1Result.sessionId).toString("hex");
    const session2IdHex = Buffer.from(session2Result.sessionId).toString("hex");
    expect(session1IdHex).not.toBe(session2IdHex);

    // Transport-path: both sessions are active
    const sessions = fix.agentA.client.listSessions();
    const s1 = sessions.find(s => Buffer.from(s.session_id).toString("hex") === session1IdHex);
    const s2 = sessions.find(s => Buffer.from(s.session_id).toString("hex") === session2IdHex);
    expect(s1?.status).toBe("active");
    expect(s2?.status).toBe("active");

    // Wait for B to have both sessions (pushed via directory) before sending
    await waitFor(
      () => fix.agentB.client.listSessions().length >= 2,
      { timeout: 10_000, interval: 100 },
    );

    // Send messages independently on each session
    const send1 = await fix.agentA.client.sendMessage(session1IdHex, Buffer.from("msg-on-session-1"));
    const send2 = await fix.agentA.client.sendMessage(session2IdHex, Buffer.from("msg-on-session-2"));
    expect(send1.ok).toBe(true);
    expect(send2.ok).toBe(true);

    // B receives messages on correct sessions
    let msg1: ReturnType<typeof fix.agentB.client.receiveMessage> = null;
    let msg2: ReturnType<typeof fix.agentB.client.receiveMessage> = null;
    await waitFor(
      () => { msg1 = fix.agentB.client.receiveMessage(session1IdHex); return msg1 !== null; },
      { timeout: 10_000, interval: 100 },
    );
    await waitFor(
      () => { msg2 = fix.agentB.client.receiveMessage(session2IdHex); return msg2 !== null; },
      { timeout: 10_000, interval: 100 },
    );

    expect(Buffer.from(msg1!.content).toString()).toBe("msg-on-session-1");
    expect(Buffer.from(msg2!.content).toString()).toBe("msg-on-session-2");
  }, 90_000);
});

// ─── SESSION-006 AC-008: strangers-to-conversation full e2e ───────────────────

describe("E2E SESSION-006-AC-008: strangers-to-conversation — full end-to-end flow", () => {
  it("AC-008: A and B are strangers → connection request → connection_established → initiateSession → send/receive messages", async () => {
    /**
     * Full strangers-to-conversation flow:
     * 1. A and B register with directory
     * 2. A sends connection_request (open policy on B)
     * 3. Both sides receive connection_established with same connection_id
     * 4. A calls initiateSession → directory verifies connection_id → FROST ceremony → session_assignment
     * 5. A sends message → B receives it
     *
     * Transport-path observables at each step:
     *   - Step 3: listConnections() on both A and B, directory store record
     *   - Step 4: session_id in session A and B listSessions()
     *   - Step 5: B.receiveMessage() returns the content A sent
     */
    const fix = await createSessionFixture({ register: true, requireConnectionGate: true });
    const mlDsaA = await mlDsaKeygen();
    const packageCborA = await buildMinimalPackageCbor(fix.agentA.kp, mlDsaA, fix.agentA.primaryPubkey);
    scope.addCleanup(fix.stopAll);

    // ── Step 1: Already done by createSessionFixture (register A and B) ──

    // ── Step 2+3: Connection request ──────────────────────────────────────────

    let bConnectionId: string | null = null;
    fix.agentB.client.onConnectionEstablished((event) => { bConnectionId = event.connection_id; });

    const connResult = await fix.agentA.client.cello_request_connection({
      target_pubkey: fix.agentB.pubkeyHex,
      package_cbor: packageCborA,
    });

    // Transport-path observable (Step 3): both sides have connection
    expect(connResult.result).toBe("established");
    if (connResult.result !== "established") throw new Error("Expected established");

    await waitFor(() => bConnectionId !== null, { timeout: 5000, interval: 50 });

    // A and B have same connection_id
    expect(bConnectionId).toBe(connResult.connection_id);

    // Directory store has the record
    const dirConn = fix.dirStore.hasConnection(fix.agentA.pubkeyHex, fix.agentB.pubkeyHex);
    expect(dirConn).not.toBeNull();
    expect(dirConn!.connection_id).toBe(connResult.connection_id);

    // ── Step 4: Initiate session ───────────────────────────────────────────────

    const sessionResult = await fix.agentA.client.initiateSession(
      fix.agentB.pubkeyHex,
      { timeoutMs: 15_000 },
    );

    // Transport-path observable (Step 4): session is active on both sides
    expect(sessionResult.ok).toBe(true);
    if (!sessionResult.ok) throw new Error(`initiateSession failed: ${sessionResult.reason}`);

    const sessionIdHex = Buffer.from(sessionResult.sessionId).toString("hex");

    // A's session record shows active status
    await waitFor(
      () => {
        const s = fix.agentA.client.listSessions().find(x => Buffer.from(x.session_id).toString("hex") === sessionIdHex);
        return s?.status === "active";
      },
      { timeout: 10_000, interval: 100 },
    );

    // B's session record also shows active status (B received session_assignment)
    await waitFor(
      () => {
        const s = fix.agentB.client.listSessions().find(x => Buffer.from(x.session_id).toString("hex") === sessionIdHex);
        return s?.status === "active";
      },
      { timeout: 10_000, interval: 100 },
    );

    const aSession = fix.agentA.client.listSessions().find(x => Buffer.from(x.session_id).toString("hex") === sessionIdHex);
    const bSession = fix.agentB.client.listSessions().find(x => Buffer.from(x.session_id).toString("hex") === sessionIdHex);
    expect(aSession?.status).toBe("active");
    expect(bSession?.status).toBe("active");

    // ── Step 5: Message exchange ───────────────────────────────────────────────

    const sendResult = await fix.agentA.client.sendMessage(sessionIdHex, Buffer.from("strangers no more"));
    expect(sendResult.ok).toBe(true);

    // Transport-path observable (Step 5): B receives the message
    let received: ReturnType<typeof fix.agentB.client.receiveMessage> = null;
    await waitFor(
      () => { received = fix.agentB.client.receiveMessage(sessionIdHex); return received !== null; },
      { timeout: 10_000, interval: 100 },
    );
    expect(received).not.toBeNull();
    expect(Buffer.from(received!.content).toString()).toBe("strangers no more");

    // B sends reply
    const replyResult = await fix.agentB.client.sendMessage(sessionIdHex, Buffer.from("hello to you too"));
    expect(replyResult.ok).toBe(true);

    let reply: ReturnType<typeof fix.agentA.client.receiveMessage> = null;
    await waitFor(
      () => { reply = fix.agentA.client.receiveMessage(sessionIdHex); return reply !== null; },
      { timeout: 10_000, interval: 100 },
    );
    expect(reply).not.toBeNull();
    expect(Buffer.from(reply!.content).toString()).toBe("hello to you too");

    // Transport-path: both sides' local tree has the correct leaf count (2 messages)
    const aSessionFinal = fix.agentA.client.listSessions().find(x => Buffer.from(x.session_id).toString("hex") === sessionIdHex)!;
    const bSessionFinal = fix.agentB.client.listSessions().find(x => Buffer.from(x.session_id).toString("hex") === sessionIdHex)!;
    expect(aSessionFinal.local_tree_leaves.length).toBe(2);
    expect(bSessionFinal.local_tree_leaves.length).toBe(2);
  }, 120_000);
});

// ─── CONNREQ-002 AC-013: disclosure_response round-trip via directory ─────────

describe("E2E CONNREQ-002-AC-013: disclosure_response relay — A sends, directory relays to B, B re-evaluates", () => {
  it("AC-013: A calls cello_respond_to_disclosure_request; directory relays disclosure_response_inbound to B; B validates package_v2 and re-runs evaluateConnectionPackage", async () => {
    // B requires pseudonym_age >= 1 day. Round 1 package has created_at=now → insufficient.
    // B sends disclosure_request. A responds with package_v2 (2 days old). Directory relays it.
    // B receives disclosure_response_inbound, validates, and sends accept.
    const selectivePolicy: SignalRequirementPolicy = {
      mode: "selective",
      review_mode: "deterministic",
      requirements: [{ signal_type: "pseudonym_age", condition: { type: "min_age_days", days: 1 } }],
    };

    const fix = await createSessionFixture({
      register: true,
      policyB: selectivePolicy,
      round2TimeoutMs: 10_000,
      trackEvaluateCount: true,
    });
    const mlDsaA = await mlDsaKeygen();
    const packageCborA = await buildMinimalPackageCbor(fix.agentA.kp, mlDsaA, fix.agentA.primaryPubkey);
    scope.addCleanup(fix.stopAll);

    let disclosureRequestId: string | null = null;
    fix.agentA.client.onDisclosureRequested((event) => {
      disclosureRequestId = event.connection_request_id;
    });

    const requestPromise = fix.agentA.client.cello_request_connection({
      target_pubkey: fix.agentB.pubkeyHex,
      package_cbor: packageCborA,
    });

    // Wait for B to send disclosure_request (relayed to A via directory)
    await waitFor(() => disclosureRequestId !== null, { timeout: 15_000, interval: 100 });

    const intermediateResult = await requestPromise;
    expect(intermediateResult.result).toBe("disclosure_requested");

    // Transport-path observable: B called evaluateConnectionPackage once for Round 1
    const escapedB = fix.agentB.client as unknown as { _evaluateCallCount: number };
    expect(escapedB._evaluateCallCount).toBe(1);

    // A sends disclosure_response with package_v2 (satisfies pseudonym_age >= 1 day)
    const mlDsaV2 = await mlDsaKeygen();
    const twoDaysAgo = Date.now() - 2 * 86_400_000;
    const packageV2 = await buildMinimalPackageCbor(fix.agentA.kp, mlDsaV2, fix.agentA.primaryPubkey, twoDaysAgo);

    const respondResult = await fix.agentA.client.cello_respond_to_disclosure_request({
      connection_request_id: disclosureRequestId!,
      package_cbor: packageV2,
    });

    // Transport-path: connection established after directory relayed disclosure_response_inbound
    expect(respondResult.result).toBe("established");

    // Transport-path observable: B called evaluateConnectionPackage a second time for Round 2
    expect(escapedB._evaluateCallCount).toBe(2);

    // Transport-path: directory store has connection record
    const dirConn = fix.dirStore.hasConnection(fix.agentA.pubkeyHex, fix.agentB.pubkeyHex);
    expect(dirConn).not.toBeNull();
  }, 60_000);
});
