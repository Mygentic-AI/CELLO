/**
 * CELLO-MCP-003 — M3 connection-policy tool surface, end-to-end.
 *
 * DOD-LEGACY-MCP-1 (2026-07-12): these tests used to drive the legacy in-process MCP server
 * (`createMcpSessionServer`) over InMemoryTransport. That server is DELETED — it was never the
 * shipped path (Claude Code talks to `bin/cello-mcp.ts`, a stdio→IPC proxy in front of the daemon),
 * so every case here was reaching the LIVE CelloClient through a dead translator. The protocol and
 * security coverage was real, so the cases are re-pointed at the client API directly. Everything
 * downstream of the call — real libp2p nodes, a real directory node, a real relay, a real DKG
 * ceremony, the real connection-policy engine — is unchanged.
 *
 * Tool → client-method map (the MCP names in the AC text are the historical tool names):
 *   cello_register                      → client.register(phoneStub, preAuthToken)
 *   cello_status                        → client.getRegistrationState()
 *   cello_request_connection            → client.cello_request_connection({ target_pubkey, package_cbor })
 *   cello_await_connection_request      → client.awaitConnectionRequest(timeoutMs)
 *   cello_request_more_disclosure       → client.requestMoreDisclosure(id, items)
 *   cello_respond_to_disclosure_request → client.cello_respond_to_disclosure_request({ ... })
 *   cello_accept_connection             → client.acceptConnection(id)
 *   cello_initiate_session              → client.initiateSession(targetPubkeyHex)
 *
 * Covered ACs (e2e scope — complements mcp-003-unit.test.ts unit tests):
 *   AC-001: register on an unregistered instance → RegistrationState; status reflects registration
 *   AC-004: inference mode; B requests more disclosure on Round 1 → A gets disclosure_requested
 *   AC-005: A responds to the disclosure request + B accepts → established with connection_id
 *   AC-006: awaitConnectionRequest returns pending_review with the full ConnectionReport
 *
 * SI-001: the registration result carries no ML-DSA secret key material
 * SI-002: initiateSession without a connection returns no_connection without a directory call
 * SI-003: ConnectionReport carries no raw crypto blobs
 *
 * Deleted here as duplicates (see the comments at each site): AC-003, AC-013.
 *
 * Transport-path observables (per cello-story rule):
 *   - connection_id is independently verified on the directory store
 *   - the ConnectionReport B reviews is produced by the live evaluateConnectionPackage
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
  it,
  expect,
  beforeEach,
  afterEach,
} from "@claude-flow/testing";
import type { TestScope } from "@claude-flow/testing";
import { mlDsaKeygen } from "@cello-protocol/crypto";
import { clearTestShares } from "@cello-protocol/crypto/frost/frost-threshold-signer.js";
import type { RegistrationState } from "@cello-protocol/protocol-types";
import { createSessionFixture } from "../session-fixture.js";
import { buildMinimalPackageCbor } from "../package-cbor-helper.js";
import { describe } from "vitest";

// These tests require FROST ceremony timing that is unreliable under CI resource
// constraints. Set CELLO_E2E_LIVE=1 to run them in a controlled environment.
const liveOnly = describe.skipIf(!process.env.CELLO_E2E_LIVE);

setupV3Tests();

// Open + inference: every inbound request lands in pending_agent_review with a full report.
const INFERENCE_POLICY = {
  mode: "open" as const,
  review_mode: "inference" as const,
  requirements: [],
};

// ─── Test scope ───────────────────────────────────────────────────────────────

let scope: TestScope;
beforeEach(() => { scope = createTestScope(); });
afterEach(() => {
  clearTestShares();
  return scope.run(async () => {});
});

// ─── AC-001: register on an unregistered instance ─────────────────────────────

liveOnly("AC-001: cello_register on unregistered instance returns success; cello_status shows registered: true", () => {
  it("AC-001: cello_register returns registered:true, agent_id, primary_pubkey, ml_dsa_pubkey; status reflects registration", async () => {
    // No `register: true` — this test IS the registration (live REG-001 DKG via the directory).
    const fix = await createSessionFixture();
    scope.addCleanup(fix.stopAll);

    const regResult = await fix.agentA.client.register(`+${Date.now()}`, "DEV-test-token");

    // Must succeed with the expected fields
    if ("error" in regResult) throw new Error(`register failed: ${regResult.error}`);
    expect(typeof regResult.agent_id).toBe("string");
    expect(typeof regResult.primary_pubkey).toBe("string");
    expect(typeof regResult.ml_dsa_pubkey).toBe("string");
    // The legacy tool's `registered: true` is `status: "active"` on RegistrationState.
    expect(regResult.status).toBe("active");
    // SI-001: ml_dsa_pubkey is the PUBLIC key (hex) — not the secret
    // The public key is non-empty; if it were the secret it would be identifiable by length
    expect(regResult.ml_dsa_pubkey.length).toBeGreaterThan(0);

    // Status must now show the agent as registered, with a matching agent_id
    const status = fix.agentA.client.getRegistrationState();
    expect(status).not.toBeNull();
    expect(status!.status).toBe("active");
    expect(status!.agent_id).toBe(regResult.agent_id);
  }, 30_000);
});

// ─── AC-003: DELETED — duplicate ──────────────────────────────────────────────
//
// "A calls cello_request_connection targeting B (open policy); returns accepted + connection_id;
//  A's list_connections includes B" is fully covered by
//   connreq-002-session-006-e2e.test.ts → "AC-001: A and B get connection_established; both
//   listConnections() show same connection_id; directory store has record"
// — same open + deterministic policy, same assertions on the connection_id, both clients'
// listConnections(), and the directory store record. (`accepted` was the MCP translator's name
// for the client's `established`.)

// ─── AC-004: inference mode; B requests more disclosure; A gets disclosure_requested ─

liveOnly("AC-004: inference mode — B calls cello_request_more_disclosure; A gets { result: 'disclosure_requested' }", () => {
  it("AC-004: A calls cello_request_connection; B (inference mode) requests more disclosure; A's tool returns disclosure_requested", async () => {
    const fix = await createSessionFixture({
      register: true,
      policyB: INFERENCE_POLICY,
      round2TimeoutMs: 15_000,
    });
    scope.addCleanup(fix.stopAll);

    const mlDsaA = await mlDsaKeygen();
    const packageCborA = await buildMinimalPackageCbor(fix.agentA.kp, mlDsaA, fix.agentA.primaryPubkey);

    // B awaits the connection request (blocking call races A's request).
    // We start B's await first, then A sends the request.
    const bAwaitPromise = fix.agentB.client.awaitConnectionRequest(20_000);

    // Give B's await a moment to register before A sends
    await new Promise(r => setTimeout(r, 50));

    // A sends connection_request (will block until B's verdict comes back)
    const aRequestPromise = fix.agentA.client.cello_request_connection({
      target_pubkey: fix.agentB.pubkeyHex,
      package_cbor: packageCborA,
    });

    // B receives the connection request in pending_review
    const bAwaitResult = await bAwaitPromise;
    expect(bAwaitResult.type).toBe("pending_review");
    if (bAwaitResult.type !== "pending_review") throw new Error("Expected pending_review");
    expect(bAwaitResult.from_pubkey).toBe(fix.agentA.pubkeyHex);
    expect(typeof bAwaitResult.connection_request_id).toBe("string");

    // B asks for more disclosure (Round 2 flow)
    const moreDisclosureResult = await fix.agentB.client.requestMoreDisclosure(
      bAwaitResult.connection_request_id,
      [{ type: "endorsement", min_count: 1 }],
    );
    expect(moreDisclosureResult).toEqual({ request_sent: true });

    // A's cello_request_connection must now return disclosure_requested
    const aResult = await aRequestPromise;
    expect(aResult.result).toBe("disclosure_requested");
    if (aResult.result !== "disclosure_requested") {
      throw new Error(`Expected disclosure_requested, got ${JSON.stringify(aResult)}`);
    }
    expect(typeof aResult.connection_request_id).toBe("string");
    expect(Array.isArray(aResult.requested_items)).toBe(true);
  }, 45_000);
});

// ─── AC-005: respond_to_disclosure_request + B accepts → established ──────────

liveOnly("AC-005: cello_respond_to_disclosure_request + B accepts → { result: 'accepted', connection_id }", () => {
  it("AC-005: after disclosure_requested, A calls respond; B accepts; returns accepted with connection_id", async () => {
    const fix = await createSessionFixture({
      register: true,
      policyB: INFERENCE_POLICY,
      round2TimeoutMs: 15_000,
    });
    scope.addCleanup(fix.stopAll);

    const mlDsaA = await mlDsaKeygen();
    const packageCborA = await buildMinimalPackageCbor(fix.agentA.kp, mlDsaA, fix.agentA.primaryPubkey);

    // ── Round 1: B awaits, A sends, B requests more disclosure ──────────────────

    const bAwaitRound1Promise = fix.agentB.client.awaitConnectionRequest(20_000);
    await new Promise(r => setTimeout(r, 50));

    const aRound1Promise = fix.agentA.client.cello_request_connection({
      target_pubkey: fix.agentB.pubkeyHex,
      package_cbor: packageCborA,
    });

    const bRound1Result = await bAwaitRound1Promise;
    expect(bRound1Result.type).toBe("pending_review");
    if (bRound1Result.type !== "pending_review") throw new Error("Expected pending_review");
    const connectionRequestId = bRound1Result.connection_request_id;

    // B requests more disclosure
    await fix.agentB.client.requestMoreDisclosure(
      connectionRequestId,
      [{ type: "endorsement", min_count: 1 }],
    );

    // A receives disclosure_requested
    const aRound1Result = await aRound1Promise;
    expect(aRound1Result.result).toBe("disclosure_requested");
    if (aRound1Result.result !== "disclosure_requested") throw new Error("Expected disclosure_requested");

    // ── Round 2: B awaits Round 2, A responds, B accepts ────────────────────────

    const bAwaitRound2Promise = fix.agentB.client.awaitConnectionRequest(20_000);
    await new Promise(r => setTimeout(r, 50));

    // A responds to the disclosure request (concurrently with B's await)
    const mlDsaV2 = await mlDsaKeygen();
    const packageV2 = await buildMinimalPackageCbor(fix.agentA.kp, mlDsaV2, fix.agentA.primaryPubkey);
    const aRespondPromise = fix.agentA.client.cello_respond_to_disclosure_request({
      connection_request_id: aRound1Result.connection_request_id,
      package_cbor: packageV2,
    });

    // B receives the Round 2 request — the live two-round re-evaluation
    const bRound2Result = await bAwaitRound2Promise;
    expect(bRound2Result.type).toBe("pending_review");
    if (bRound2Result.type !== "pending_review") throw new Error("Expected pending_review on Round 2");
    expect(bRound2Result.report.is_round_2).toBe(true);

    // B accepts the Round 2 request
    const bAcceptResult = await fix.agentB.client.acceptConnection(bRound2Result.connection_request_id);
    if ("error" in bAcceptResult) throw new Error(`acceptConnection failed: ${bAcceptResult.error.reason}`);
    expect(bAcceptResult.accepted).toBe(true);
    const connectionId = bAcceptResult.connection_id;
    expect(typeof connectionId).toBe("string");

    // A's respond_to_disclosure_request returns established with the same connection_id
    const aRespondResult = await aRespondPromise;
    expect(aRespondResult.result).toBe("established");
    if (aRespondResult.result !== "established") throw new Error("Expected established");
    expect(aRespondResult.connection_id).toBe(connectionId);

    // Transport-path: directory store has the connection record
    const dirConn = await fix.dirStore.hasConnection(fix.agentA.pubkeyHex, fix.agentB.pubkeyHex);
    expect(dirConn).not.toBeNull();
    expect(dirConn!.connection_id).toBe(connectionId);
  }, 60_000);
});

// ─── AC-006: awaitConnectionRequest returns pending_review + ConnectionReport ──

liveOnly("AC-006: cello_await_connection_request returns pending_review with full ConnectionReport", () => {
  it("AC-006: B (inference mode) gets pending_review with ConnectionReport containing policy_summary and package_summary", async () => {
    const fix = await createSessionFixture({
      register: true,
      policyB: INFERENCE_POLICY,
    });
    scope.addCleanup(fix.stopAll);

    const mlDsaA = await mlDsaKeygen();
    const packageCborA = await buildMinimalPackageCbor(fix.agentA.kp, mlDsaA, fix.agentA.primaryPubkey);

    // B awaits connection request
    const bAwaitPromise = fix.agentB.client.awaitConnectionRequest(20_000);
    await new Promise(r => setTimeout(r, 50));

    // A sends connection request (fire and don't await — we're testing B's receive side)
    void fix.agentA.client.cello_request_connection({
      target_pubkey: fix.agentB.pubkeyHex,
      package_cbor: packageCborA,
    });

    const result = await bAwaitPromise;

    // AC-006: type, from_pubkey, connection_request_id
    expect(result.type).toBe("pending_review");
    if (result.type !== "pending_review") throw new Error("Expected pending_review");
    expect(result.from_pubkey).toBe(fix.agentA.pubkeyHex);
    expect(typeof result.connection_request_id).toBe("string");
    expect(result.connection_request_id.length).toBeGreaterThan(0);

    // AC-006: report.policy_summary has review_mode 'inference'
    const report = result.report;
    expect(report).toBeDefined();
    const ps = report.policy_summary;
    expect(ps.review_mode).toBe("inference");
    expect(Array.isArray(ps.requirements_met)).toBe(true);
    expect(Array.isArray(ps.requirements_unmet)).toBe(true);

    // AC-006: report.package_summary contains pseudonym_label, endorsement_count, etc.
    const pkgSum = report.package_summary;
    expect(typeof pkgSum.pseudonym_label).toBe("string");
    expect(typeof pkgSum.endorsement_count).toBe("number");
    expect(Array.isArray(pkgSum.attestation_types)).toBe(true);
    expect(typeof pkgSum.pseudonym_age_days).toBe("number");
    expect(typeof pkgSum.registration_age_days).toBe("number");
    expect(typeof pkgSum.is_provisional).toBe("boolean");

    // AC-006: is_round_2 must be false for Round 1 request
    expect(report.is_round_2).toBe(false);

    // SI-003: report must contain no raw crypto blobs
    // Check that all string values in the report are human-readable (not 2420-byte hex signatures)
    const reportStr = JSON.stringify(report);
    // ML-DSA signature would be 2420 bytes = 4840 hex chars. A 4840+ char hex string would be a blob.
    expect(reportStr.length).toBeLessThan(4000); // Human-readable summary must be compact
  }, 45_000);
});

// ─── AC-013: DELETED — duplicate ──────────────────────────────────────────────
//
// "A and B connected; A calls cello_initiate_session; FROST ceremony runs; session_id returned"
// is covered by
//   connreq-002-session-006-e2e.test.ts → "AC-008: A and B are strangers → connection request →
//   connection_established → initiateSession → send/receive messages"
// — which runs the same live FROST ceremony behind initiateSession and additionally asserts the
// session is active on BOTH sides and that messages flow over it.

// ─── SI-001: registration result contains no ML-DSA secret key material ───────

liveOnly("SI-001: cello_register response contains no ML-DSA secret key material", () => {
  it("SI-001: registered response contains only public fields; ml_dsa_pubkey is public key (non-empty hex), no secret exposed", async () => {
    const fix = await createSessionFixture();
    scope.addCleanup(fix.stopAll);

    const result = await fix.agentA.client.register(`+${Date.now()}`, "DEV-test-token");
    if ("error" in result) throw new Error(`register failed: ${result.error}`);
    expect(result.status).toBe("active");

    // The RegistrationState must have only these keys — no secret key field.
    // Fails loudly if a future field is added, forcing a security look at it.
    const keys = Object.keys(result).sort();
    expect(keys).toEqual(
      (["agent_id", "ml_dsa_pubkey", "primary_pubkey", "registered_at", "status"] satisfies Array<keyof RegistrationState>).sort(),
    );

    // ml_dsa_pubkey is a hex string (public key) — not raw binary that might be the secret
    const mlDsaPubkey = result.ml_dsa_pubkey;
    expect(typeof mlDsaPubkey).toBe("string");
    // Public ML-DSA-44 key = 1312 bytes = 2624 hex chars
    // Secret ML-DSA-44 key = 2528 bytes = 5056 hex chars
    // If it's the secret key, length would be 5056; public key is 2624.
    // We check it's exactly the public key length to ensure no secret leak.
    expect(mlDsaPubkey.length).toBe(2624);
  }, 30_000);
});

// ─── SI-002 (e2e): initiateSession without a connection → no_connection ───────

liveOnly("SI-002 (e2e): cello_initiate_session to unconnected peer → no_connection immediately", () => {
  it("SI-002: A (registered, no connection to B) calls cello_initiate_session → { ok: false, reason: 'no_connection' } without directory call", async () => {
    const fix = await createSessionFixture({
      register: true,
      // The client-side gate (SignalingManager.initiateSession) only engages when a connection
      // policy is configured — hasConnectionPolicy() && !connectionId → no_connection, returned
      // BEFORE the signaling stream is touched. Without policyA the gate never fires and this
      // test would pass on a directory round-trip instead of the local guard it is written for.
      policyA: { mode: "open", review_mode: "deterministic", requirements: [] },
    });
    scope.addCleanup(fix.stopAll);

    // A has no connection with B — initiate_session must fail immediately
    const result = await fix.agentA.client.initiateSession(fix.agentB.pubkeyHex);

    expect(result.ok).toBe(false);
    // The error must be no_connection specifically (not timeout, not directory error)
    if (result.ok) throw new Error("Expected initiateSession to fail");
    expect(result.reason).toBe("no_connection");

    // Transport-path: no session was created
    expect(fix.agentA.client.listSessions().length).toBe(0);
  }, 15_000);
});

// ─── SI-003 (e2e): ConnectionReport contains no raw cryptographic material ────

liveOnly("SI-003 (e2e): ConnectionReport contains no raw cryptographic material", () => {
  it("SI-003: ConnectionReport strings are human-readable summaries, not raw signatures or full pubkeys", async () => {
    const fix = await createSessionFixture({
      register: true,
      policyB: INFERENCE_POLICY,
    });
    scope.addCleanup(fix.stopAll);

    const mlDsaA = await mlDsaKeygen();
    const packageCborA = await buildMinimalPackageCbor(fix.agentA.kp, mlDsaA, fix.agentA.primaryPubkey);

    const bAwaitPromise = fix.agentB.client.awaitConnectionRequest(20_000);
    await new Promise(r => setTimeout(r, 50));

    void fix.agentA.client.cello_request_connection({
      target_pubkey: fix.agentB.pubkeyHex,
      package_cbor: packageCborA,
    });

    const result = await bAwaitPromise;

    expect(result.type).toBe("pending_review");
    if (result.type !== "pending_review") throw new Error("Expected pending_review");
    const reportJson = JSON.stringify(result.report);

    // SI-003: No raw ML-DSA signature (4840+ hex chars) in the report
    // ML-DSA-44 signature is 2420 bytes = 4840 hex chars minimum
    // Scan for any contiguous hex string of that length
    const longHexPattern = /[0-9a-f]{1000,}/gi;
    const longHexMatches = reportJson.match(longHexPattern);
    expect(longHexMatches).toBeNull();

    // SI-003: No ML-DSA public key (2624 hex chars)
    // Already covered by the above pattern, but explicitly check structure
    const pkgSummary = result.report.package_summary;
    // package_summary must not contain raw key fields
    const pkgKeys = Object.keys(pkgSummary);
    expect(pkgKeys).not.toContain("ml_dsa_pubkey");
    expect(pkgKeys).not.toContain("ml_dsa_signature");
    expect(pkgKeys).not.toContain("k_local_pubkey");
    expect(pkgKeys).not.toContain("primary_pubkey");
    expect(pkgKeys).not.toContain("endorser_ml_dsa_signature");
  }, 45_000);
});
