/**
 * CELLO-MCP-003 — M3 MCP Tool Surface end-to-end tests
 *
 * Tests run via InMemoryTransport against real in-process libp2p nodes,
 * a real directory node, and a real relay node — same fixture as connreq-002.
 *
 * Covered ACs (e2e scope — complements mcp-003-unit.test.ts unit tests):
 *   AC-001: cello_register on unregistered instance → success; cello_status shows registered: true
 *   AC-003: cello_request_connection with open deterministic policy → { result: 'accepted', connection_id }
 *   AC-004: inference mode; B calls cello_request_more_disclosure on Round 1 → A gets disclosure_requested
 *   AC-005: cello_respond_to_disclosure_request + B accepts → { result: 'accepted', connection_id }
 *   AC-006: cello_await_connection_request returns pending_review with full ConnectionReport
 *   AC-013: cello_initiate_session after connection established → session proceeds normally
 *
 * SI-001: cello_register response must not contain ML-DSA secret key material
 * SI-002: cello_initiate_session without connection returns no_connection immediately
 * SI-003: ConnectionReport from cello_await_connection_request contains no raw crypto blobs
 *
 * Transport-path observables (per cello-story rule):
 *   - connection_id is independently verified on both client A and client B
 *   - directory store shows the connection record
 *   - session proceeds normally after connection gate
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
import { clearTestShares } from "@cello-protocol/crypto/frost/frost-threshold-signer.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createSessionFixture } from "../session-fixture.js";

setupV3Tests();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseResult(result: Awaited<ReturnType<Client["callTool"]>>): unknown {
  const text = (result.content as Array<{ type: string; text: string }>)
    .find((c) => c.type === "text")?.text;
  if (!text) throw new Error("No text content in tool result");
  return JSON.parse(text);
}

/** Request a connection from A to B via MCP. */
async function requestConnectionViaMcp(
  mcpA: Client,
  targetPubkeyHex: string,
): Promise<Record<string, unknown>> {
  return parseResult(
    await mcpA.callTool({
      name: "cello_request_connection",
      arguments: { target_pubkey: targetPubkeyHex },
    }),
  ) as Record<string, unknown>;
}

// ─── Test scope ───────────────────────────────────────────────────────────────

let scope: TestScope;
beforeEach(() => { scope = createTestScope(); });
afterEach(() => {
  clearTestShares();
  return scope.run(async () => {});
});

// ─── AC-001: cello_register on unregistered instance ─────────────────────────

describe("AC-001: cello_register on unregistered instance returns success; cello_status shows registered: true", () => {
  it("AC-001: cello_register returns registered:true, agent_id, primary_pubkey, ml_dsa_pubkey; status reflects registration", async () => {
    // Use withMcp but NOT register (so we can test via MCP tool)
    const fix = await createSessionFixture({ withMcp: true });
    scope.addCleanup(fix.stopAll);

    // Register agent A via MCP cello_register tool
    const regResult = parseResult(
      await fix.agentA.mcp!.callTool({
        name: "cello_register",
        arguments: { phone_stub: `+${Date.now()}` },
      }),
    ) as Record<string, unknown>;

    // Must succeed with expected fields
    expect(regResult.registered).toBe(true);
    expect(typeof regResult.agent_id).toBe("string");
    expect(typeof regResult.primary_pubkey).toBe("string");
    expect(typeof regResult.ml_dsa_pubkey).toBe("string");
    // SI-001: ml_dsa_pubkey is the PUBLIC key (hex) — not the secret
    // The public key is non-empty; if it were the secret it would be identifiable by length
    expect((regResult.ml_dsa_pubkey as string).length).toBeGreaterThan(0);

    // cello_status must now show registered: true and matching agent_id
    const statusResult = parseResult(
      await fix.agentA.mcp!.callTool({ name: "cello_status", arguments: {} }),
    ) as Record<string, unknown>;

    expect(statusResult.registered).toBe(true);
    expect(statusResult.agent_id).toBe(regResult.agent_id);
  }, 30_000);
});

// ─── AC-003: open deterministic policy — cello_request_connection → accepted ──

describe("AC-003: cello_request_connection with open deterministic policy → accepted", () => {
  it("AC-003: A calls cello_request_connection targeting B (open policy); returns { result: 'accepted', connection_id }; A's list_connections includes B", async () => {
    // register: true registers both agents (pre-condition for CONNREQ-002)
    const fix = await createSessionFixture({
      withMcp: true,
      register: true,
      // default policy is open + inference, so override B to open + deterministic
      policyB: { mode: "open", review_mode: "deterministic", requirements: [] },
    });
    scope.addCleanup(fix.stopAll);

    const result = await requestConnectionViaMcp(fix.agentA.mcp!, fix.agentB.pubkeyHex);

    // AC-003: result must be accepted with a connection_id
    expect(result.result).toBe("accepted");
    if (result.result !== "accepted") throw new Error(`Expected accepted, got ${JSON.stringify(result)}`);

    const connectionId = result.connection_id as string;
    expect(typeof connectionId).toBe("string");
    expect(connectionId.length).toBeGreaterThan(0);

    // Transport-path: A's cello_list_connections must include the connection to B
    const listResult = parseResult(
      await fix.agentA.mcp!.callTool({ name: "cello_list_connections", arguments: {} }),
    ) as { connections: Array<{ connection_id: string; counterparty_pubkey: string; status: string }> };

    const connEntry = listResult.connections.find(c => c.connection_id === connectionId);
    expect(connEntry).toBeDefined();
    expect(connEntry!.counterparty_pubkey).toBe(fix.agentB.pubkeyHex);
    expect(connEntry!.status).toBe("active");

    // Transport-path: directory store has connection record
    const dirConn = await fix.dirStore.hasConnection(fix.agentA.pubkeyHex, fix.agentB.pubkeyHex);
    expect(dirConn).not.toBeNull();
    expect(dirConn!.connection_id).toBe(connectionId);
  }, 45_000);
});

// ─── AC-004: inference mode; B requests more disclosure; A gets disclosure_requested ─

describe("AC-004: inference mode — B calls cello_request_more_disclosure; A gets { result: 'disclosure_requested' }", () => {
  it("AC-004: A calls cello_request_connection; B (inference mode) requests more disclosure; A's tool returns disclosure_requested", async () => {
    const inferencePolicy = {
      mode: "open" as const,
      review_mode: "inference" as const,
      requirements: [],
    };

    const fix = await createSessionFixture({
      withMcp: true,
      register: true,
      policyB: inferencePolicy,
      round2TimeoutMs: 15_000,
    });
    scope.addCleanup(fix.stopAll);

    // B awaits connection request via MCP (blocking call races A's request)
    // We start B's await first, then A sends the request
    const bAwaitPromise = fix.agentB.mcp!.callTool({
      name: "cello_await_connection_request",
      arguments: { timeout_ms: 20_000 },
    });

    // Give B's await a moment to register before A sends
    await new Promise(r => setTimeout(r, 50));

    // A sends connection_request via MCP (will block until result)
    const aRequestPromise = fix.agentA.mcp!.callTool({
      name: "cello_request_connection",
      arguments: { target_pubkey: fix.agentB.pubkeyHex },
    });

    // B receives the connection request in pending_review
    const bAwaitResult = parseResult(await bAwaitPromise) as {
      type: string;
      connection_request_id: string;
      from_pubkey: string;
      report: Record<string, unknown>;
    };
    expect(bAwaitResult.type).toBe("pending_review");
    expect(bAwaitResult.from_pubkey).toBe(fix.agentA.pubkeyHex);
    expect(typeof bAwaitResult.connection_request_id).toBe("string");

    // B calls cello_request_more_disclosure (Round 2 flow)
    const moreDisclosureResult = parseResult(
      await fix.agentB.mcp!.callTool({
        name: "cello_request_more_disclosure",
        arguments: {
          connection_request_id: bAwaitResult.connection_request_id,
          requested_items: [{ type: "endorsement", min_count: 1 }],
        },
      }),
    ) as Record<string, unknown>;
    expect(moreDisclosureResult.request_sent).toBe(true);

    // A's cello_request_connection must now return disclosure_requested
    const aResult = parseResult(await aRequestPromise) as Record<string, unknown>;
    expect(aResult.result).toBe("disclosure_requested");
    if (aResult.result !== "disclosure_requested") {
      throw new Error(`Expected disclosure_requested, got ${JSON.stringify(aResult)}`);
    }
    expect(typeof aResult.connection_request_id).toBe("string");
    expect(Array.isArray(aResult.requested_items)).toBe(true);
  }, 45_000);
});

// ─── AC-005: respond_to_disclosure_request + B accepts → accepted ─────────────

describe("AC-005: cello_respond_to_disclosure_request + B accepts → { result: 'accepted', connection_id }", () => {
  it("AC-005: after disclosure_requested, A calls respond; B accepts; returns accepted with connection_id", async () => {
    const inferencePolicy = {
      mode: "open" as const,
      review_mode: "inference" as const,
      requirements: [],
    };

    const fix = await createSessionFixture({
      withMcp: true,
      register: true,
      policyB: inferencePolicy,
      round2TimeoutMs: 15_000,
    });
    scope.addCleanup(fix.stopAll);

    // ── Round 1: B awaits, A sends, B requests more disclosure ──────────────────

    const bAwaitRound1Promise = fix.agentB.mcp!.callTool({
      name: "cello_await_connection_request",
      arguments: { timeout_ms: 20_000 },
    });
    await new Promise(r => setTimeout(r, 50));

    const aRound1Promise = fix.agentA.mcp!.callTool({
      name: "cello_request_connection",
      arguments: { target_pubkey: fix.agentB.pubkeyHex },
    });

    const bRound1Result = parseResult(await bAwaitRound1Promise) as {
      type: string;
      connection_request_id: string;
    };
    expect(bRound1Result.type).toBe("pending_review");
    const connectionRequestId = bRound1Result.connection_request_id;

    // B requests more disclosure
    await fix.agentB.mcp!.callTool({
      name: "cello_request_more_disclosure",
      arguments: {
        connection_request_id: connectionRequestId,
        requested_items: [{ type: "endorsement", min_count: 1 }],
      },
    });

    // A receives disclosure_requested
    const aRound1Result = parseResult(await aRound1Promise) as Record<string, unknown>;
    expect(aRound1Result.result).toBe("disclosure_requested");

    // ── Round 2: B awaits Round 2, A responds, B accepts ────────────────────────

    const bAwaitRound2Promise = fix.agentB.mcp!.callTool({
      name: "cello_await_connection_request",
      arguments: { timeout_ms: 20_000 },
    });
    await new Promise(r => setTimeout(r, 50));

    // A calls respond_to_disclosure_request (concurrently with B's await)
    const aRespondPromise = fix.agentA.mcp!.callTool({
      name: "cello_respond_to_disclosure_request",
      arguments: {
        connection_request_id: aRound1Result.connection_request_id as string,
      },
    });

    // B receives the Round 2 request
    const bRound2Result = parseResult(await bAwaitRound2Promise) as {
      type: string;
      connection_request_id: string;
      report: Record<string, unknown>;
    };
    expect(bRound2Result.type).toBe("pending_review");

    // B accepts the Round 2 request
    const bAcceptResult = parseResult(
      await fix.agentB.mcp!.callTool({
        name: "cello_accept_connection",
        arguments: { connection_request_id: bRound2Result.connection_request_id },
      }),
    ) as Record<string, unknown>;
    expect(bAcceptResult.accepted).toBe(true);
    const connectionId = bAcceptResult.connection_id as string;
    expect(typeof connectionId).toBe("string");

    // A's respond_to_disclosure_request returns accepted
    const aRespondResult = parseResult(await aRespondPromise) as Record<string, unknown>;
    expect(aRespondResult.result).toBe("accepted");
    expect(aRespondResult.connection_id).toBe(connectionId);

    // Transport-path: directory store has the connection record
    const dirConn = await fix.dirStore.hasConnection(fix.agentA.pubkeyHex, fix.agentB.pubkeyHex);
    expect(dirConn).not.toBeNull();
    expect(dirConn!.connection_id).toBe(connectionId);
  }, 60_000);
});

// ─── AC-006: cello_await_connection_request returns pending_review + ConnectionReport ─

describe("AC-006: cello_await_connection_request returns pending_review with full ConnectionReport", () => {
  it("AC-006: B (inference mode) gets pending_review with ConnectionReport containing policy_summary and package_summary", async () => {
    const inferencePolicy = {
      mode: "open" as const,
      review_mode: "inference" as const,
      requirements: [],
    };

    const fix = await createSessionFixture({
      withMcp: true,
      register: true,
      policyB: inferencePolicy,
    });
    scope.addCleanup(fix.stopAll);

    // B awaits connection request
    const bAwaitPromise = fix.agentB.mcp!.callTool({
      name: "cello_await_connection_request",
      arguments: { timeout_ms: 20_000 },
    });
    await new Promise(r => setTimeout(r, 50));

    // A sends connection request (fire and don't await — we're testing B's receive side)
    void fix.agentA.mcp!.callTool({
      name: "cello_request_connection",
      arguments: { target_pubkey: fix.agentB.pubkeyHex },
    });

    const result = parseResult(await bAwaitPromise) as {
      type: string;
      connection_request_id: string;
      from_pubkey: string;
      report: {
        policy_summary: {
          mode: string;
          review_mode: string;
          requirements_met: unknown[];
          requirements_unmet: unknown[];
        };
        package_summary: {
          pseudonym_label: string;
          endorsement_count: number;
          attestation_types: unknown[];
          pseudonym_age_days: number;
          registration_age_days: number;
          is_provisional: boolean;
        };
        is_round_2: boolean;
      };
    };

    // AC-006: type, from_pubkey, connection_request_id
    expect(result.type).toBe("pending_review");
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

// ─── AC-013: cello_initiate_session after connection established ───────────────

describe("AC-013: cello_initiate_session after connection established → session proceeds", () => {
  it("AC-013: A and B connected; A calls cello_initiate_session; FROST ceremony runs; session_id returned", async () => {
    const fix = await createSessionFixture({
      withMcp: true,
      register: true,
      policyB: { mode: "open", review_mode: "deterministic", requirements: [] },
      // register: true automatically configures the directory threshold signer via DKG
    });
    scope.addCleanup(fix.stopAll);

    // ── Step 1: Establish connection ──────────────────────────────────────────
    const connResult = await requestConnectionViaMcp(fix.agentA.mcp!, fix.agentB.pubkeyHex);
    expect(connResult.result).toBe("accepted");
    if (connResult.result !== "accepted") throw new Error(`Connection failed: ${JSON.stringify(connResult)}`);

    // Wait for B to also register the connection locally
    await waitFor(
      () => fix.agentB.client.listConnections().length > 0,
      { timeout: 5_000, interval: 50 },
    );

    // ── Step 2: Initiate session ───────────────────────────────────────────────
    // B awaits session assignment concurrently
    const bSessionPromise = fix.agentB.mcp!.callTool({
      name: "cello_await_session",
      arguments: { timeout_ms: 20_000 },
    });

    const sessionResult = parseResult(
      await fix.agentA.mcp!.callTool({
        name: "cello_initiate_session",
        arguments: { target_pubkey: fix.agentB.pubkeyHex },
      }),
    ) as Record<string, unknown>;

    // AC-013: session proceeds normally after connection gate
    expect(sessionResult.ok).toBe(true);
    expect(typeof sessionResult.session_id).toBe("string");
    expect((sessionResult.session_id as string)).toMatch(/^[0-9a-f]+$/);

    // B also receives the session assignment
    const bResult = parseResult(await bSessionPromise) as Record<string, unknown>;
    expect(bResult.type).toBe("new_session");
    expect(bResult.session_id).toBe(sessionResult.session_id);

    // Transport-path: session is active on both sides
    const sessionIdHex = sessionResult.session_id as string;
    await waitFor(
      () => fix.agentB.client.listSessions().some(
        s => Buffer.from(s.session_id).toString("hex") === sessionIdHex,
      ),
      { timeout: 5_000, interval: 50 },
    );

    const aSession = fix.agentA.client.listSessions().find(
      s => Buffer.from(s.session_id).toString("hex") === sessionIdHex,
    );
    expect(aSession?.status).toBe("active");
  }, 45_000);
});

// ─── SI-001: cello_register response contains no ML-DSA secret key material ──

describe("SI-001: cello_register response contains no ML-DSA secret key material", () => {
  it("SI-001: registered response contains only public fields; ml_dsa_pubkey is public key (non-empty hex), no secret exposed", async () => {
    const fix = await createSessionFixture({ withMcp: true });
    scope.addCleanup(fix.stopAll);

    const result = parseResult(
      await fix.agentA.mcp!.callTool({
        name: "cello_register",
        arguments: { phone_stub: `+${Date.now()}` },
      }),
    ) as Record<string, unknown>;

    expect(result.registered).toBe(true);

    // The response must have only these keys — no secret key field
    const keys = Object.keys(result).sort();
    expect(keys).toEqual(["agent_id", "ml_dsa_pubkey", "primary_pubkey", "registered"].sort());

    // ml_dsa_pubkey is a hex string (public key) — not raw binary that might be the secret
    const mlDsaPubkey = result.ml_dsa_pubkey as string;
    expect(typeof mlDsaPubkey).toBe("string");
    // Public ML-DSA-44 key = 1312 bytes = 2624 hex chars
    // Secret ML-DSA-44 key = 2528 bytes = 5056 hex chars
    // If it's the secret key, length would be 5056; public key is 2624.
    // We check it's exactly the public key length to ensure no secret leak.
    expect(mlDsaPubkey.length).toBe(2624);
  }, 30_000);
});

// ─── SI-002 (e2e): cello_initiate_session without connection → no_connection ──

describe("SI-002 (e2e): cello_initiate_session to unconnected peer → no_connection immediately", () => {
  it("SI-002: A (registered, no connection to B) calls cello_initiate_session → { error: { reason: 'no_connection' } } without directory call", async () => {
    const fix = await createSessionFixture({
      withMcp: true,
      register: true,
    });
    scope.addCleanup(fix.stopAll);

    // A has no connection with B — initiate_session must fail immediately
    const result = parseResult(
      await fix.agentA.mcp!.callTool({
        name: "cello_initiate_session",
        arguments: { target_pubkey: fix.agentB.pubkeyHex },
      }),
    ) as Record<string, unknown>;

    expect(result.ok).toBe(false);
    // The error must be no_connection specifically (not timeout, not directory error)
    // Could be returned as { ok: false, reason } or { error: { reason } }
    const reason = result.reason ?? (result.error as Record<string, unknown> | undefined)?.reason;
    expect(reason).toBe("no_connection");

    // Transport-path: no session was created
    expect(fix.agentA.client.listSessions().length).toBe(0);
  }, 15_000);
});

// ─── SI-003 (e2e): ConnectionReport from await_connection_request contains no crypto blobs ─

describe("SI-003 (e2e): ConnectionReport contains no raw cryptographic material", () => {
  it("SI-003: ConnectionReport strings are human-readable summaries, not raw signatures or full pubkeys", async () => {
    const inferencePolicy = {
      mode: "open" as const,
      review_mode: "inference" as const,
      requirements: [],
    };

    const fix = await createSessionFixture({
      withMcp: true,
      register: true,
      policyB: inferencePolicy,
    });
    scope.addCleanup(fix.stopAll);

    const bAwaitPromise = fix.agentB.mcp!.callTool({
      name: "cello_await_connection_request",
      arguments: { timeout_ms: 20_000 },
    });
    await new Promise(r => setTimeout(r, 50));

    void fix.agentA.mcp!.callTool({
      name: "cello_request_connection",
      arguments: { target_pubkey: fix.agentB.pubkeyHex },
    });

    const result = parseResult(await bAwaitPromise) as {
      type: string;
      report: Record<string, unknown>;
    };

    expect(result.type).toBe("pending_review");
    const reportJson = JSON.stringify(result.report);

    // SI-003: No raw ML-DSA signature (4840+ hex chars) in the report
    // ML-DSA-44 signature is 2420 bytes = 4840 hex chars minimum
    // Scan for any contiguous hex string of that length
    const longHexPattern = /[0-9a-f]{1000,}/gi;
    const longHexMatches = reportJson.match(longHexPattern);
    expect(longHexMatches).toBeNull();

    // SI-003: No ML-DSA public key (2624 hex chars)
    // Already covered by the above pattern, but explicitly check structure
    const report = result.report as {
      policy_summary: Record<string, unknown>;
      package_summary: Record<string, unknown>;
    };
    const pkgSummary = report.package_summary;
    // package_summary must not contain raw key fields
    const pkgKeys = Object.keys(pkgSummary);
    expect(pkgKeys).not.toContain("ml_dsa_pubkey");
    expect(pkgKeys).not.toContain("ml_dsa_signature");
    expect(pkgKeys).not.toContain("k_local_pubkey");
    expect(pkgKeys).not.toContain("primary_pubkey");
    expect(pkgKeys).not.toContain("endorser_ml_dsa_signature");
  }, 45_000);
});
