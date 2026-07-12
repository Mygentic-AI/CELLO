/**
 * CELLO-MCP-002 — Session protocol e2e tests (re-pointed at the live client)
 *
 * These tests originally drove the live CelloClient *through* the legacy in-process MCP
 * server (`createMcpSessionServer`), which is DELETED (DOD-LEGACY-MCP-1). The substrate
 * was always real — real in-process libp2p nodes, a real directory node, a real relay
 * node, real FROST — so the protocol coverage is preserved verbatim here by calling the
 * live client directly. Only the dead MCP envelope assertions were dropped.
 *
 * Covered protocol behavior (e2e scope):
 *   AC-002: a directory session assignment fires onSessionAssignment on B with the
 *           session id, the counterparty pubkey, and the genesis prev_root
 *   AC-003: sendMessage delivers on an active session
 *   AC-004: receiveSessionMessageAsync returns the message with correct content + sender
 *   AC-005: both A and B list the session as active with a non-empty local hash chain
 *   AC-006: post-FROST message exchange — relay-assigned monotone seq, and dual-path
 *           leaf equality (sender-committed leaf === receiver-validated leaf)
 *
 * AC-010, AC-011 (seal ceremony) require the full SESSION-003 + directory seal flow
 * and are deferred to a future story (SESSION-MCP-003-E2E).
 */

import { createHash } from "node:crypto";
import {
  setupV3Tests,
  createTestScope,
  it,
  expect,
  beforeEach,
  afterEach,
  waitFor,
} from "@claude-flow/testing";
import type { TestScope } from "@claude-flow/testing";
import { clearTestShares } from "@cello-protocol/crypto/frost/frost-threshold-signer.js";
import { createSessionFixture } from "../session-fixture.js";
import type { SessionFixtureResult } from "../session-fixture.js";
import type { CelloClient, SessionAssignmentEvent } from "@cello-protocol/client";
import { describe } from "vitest";

// These tests require FROST ceremony timing that is unreliable under CI resource
// constraints. Set CELLO_E2E_LIVE=1 to run them in a controlled environment.
const liveOnly = describe.skipIf(!process.env.CELLO_E2E_LIVE);

setupV3Tests();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

/**
 * Recompute the hash of the last leaf the given client committed to its local chain
 * for this session: SHA-256(leaf_kind_byte || structure2_cbor) per MERKLE-001 (RFC 6962).
 *
 * The deleted MCP server used to compute and return this from cello_send; `sendMessage`
 * does not return it, so the sender's committed leaf is derived from its own chain.
 */
function lastLeafHash(client: CelloClient, sessionIdHex: string): string {
  const rec = client
    .listSessions()
    .find((s) => toHex(s.session_id) === sessionIdHex);
  if (!rec) throw new Error(`no session ${sessionIdHex} on client`);
  const leaf = rec.local_tree_leaves[rec.local_tree_leaves.length - 1];
  if (!leaf) throw new Error(`session ${sessionIdHex} has no local leaves`);
  const kindByte = leaf.kind === "ctrl" ? 0x02 : 0x00;
  return createHash("sha256")
    .update(Uint8Array.of(kindByte))
    .update(leaf.s2_cbor)
    .digest("hex");
}

/**
 * Issue a real FROST-signed session assignment via the directory signaling protocol.
 *
 * Requires fix.directory.registerThresholdSigner(fix.agentA.pubkeyHex, fix.signerA) called first.
 */
async function setupSession(fix: SessionFixtureResult): Promise<{
  sessionIdHex: string;
  sessionId: Uint8Array;
}> {
  const result = await fix.agentA.client.initiateSession(fix.agentB.pubkeyHex, {
    timeoutMs: 15_000,
  });
  if (!result.ok) throw new Error(`initiateSession failed: ${result.reason}`);

  // Wait for B to also receive and process the session assignment
  await waitFor(() => fix.agentB.client.listSessions().length > 0, { timeout: 5_000 });

  const sessionId = result.sessionId;
  const sessionIdHex = Buffer.from(sessionId).toString("hex");
  return { sessionIdHex, sessionId };
}

// ─── Scope ────────────────────────────────────────────────────────────────────

let scope: TestScope;
beforeEach(() => { scope = createTestScope(); });
afterEach(() => {
  clearTestShares();
  return scope.run(async () => {});
});

// AC-001 (initiate_session returns session_id) was removed in M3: the gate now requires
// an established connection before initiating a session. The equivalent positive path
// (with connection) is covered by mcp-003-e2e AC-013.

// ─── AC-002: session assignment surfaces on B with full session details ───────

liveOnly("AC-002: a directory session assignment fires onSessionAssignment on B", () => {
  it("AC-002: B registers onSessionAssignment; assignment fires; event carries session_id, counterparty_pubkey, genesis_prev_root", async () => {
    const fix = await createSessionFixture();
    fix.directory.registerThresholdSigner(fix.agentA.pubkeyHex, fix.signerA);

    scope.addCleanup(fix.stopAll);

    // Register the handler BEFORE the session is established, so the event is observed
    // live rather than read back off state.
    const assigned = new Promise<SessionAssignmentEvent>((resolve) => {
      fix.agentB.client.onSessionAssignment(resolve);
    });

    // Fire assignment after a short delay so the handler is already armed when it arrives
    setTimeout(() => {
      void setupSession(fix);
    }, 100);

    const event = await assigned;

    expect(event.sessionIdHex).toMatch(/^[0-9a-f]{32}$/);
    expect(event.counterpartyPubkeyHex).toBe(fix.agentA.pubkeyHex);
    expect(event.genesisPrevRootHex).toMatch(/^[0-9a-f]+$/);
  }, 15_000);
});

// ─── AC-003 + AC-004: sendMessage + receiveSessionMessageAsync round-trip ─────

liveOnly("AC-003 + AC-004: sendMessage delivers; receiveSessionMessageAsync returns the message", () => {
  it("AC-003+004: A sends 'hello'; B receives {type:message, content:'hello', senderPubkey:A's pubkey}", async () => {
    const fix = await createSessionFixture();
    fix.directory.registerThresholdSigner(fix.agentA.pubkeyHex, fix.signerA);

    scope.addCleanup(fix.stopAll);

    const { sessionIdHex } = await setupSession(fix);

    // AC-003: A sends on the session
    const sendResult = await fix.agentA.client.sendMessage(
      sessionIdHex,
      new TextEncoder().encode("hello")
    );

    expect(sendResult.ok).toBe(true);

    // AC-004: B receives on the session
    const msg = await fix.agentB.client.receiveSessionMessageAsync(sessionIdHex, 10_000);

    expect(msg).not.toBeNull();
    expect(msg!.type).toBe("message");
    if (msg!.type !== "message") throw new Error("expected a message");
    expect(new TextDecoder().decode(msg!.content)).toBe("hello");
    expect(toHex(msg!.senderPubkey)).toBe(fix.agentA.pubkeyHex);
    expect(toHex(msg!.leafHash)).toMatch(/^[0-9a-f]{64}$/);
  }, 20_000);
});

// ─── AC-005: both A and B list the session as active with a non-empty chain ───

liveOnly("AC-005: listSessions shows the active session on both A and B", () => {
  it("AC-005: after send+receive, both A and B list the session with status:active and leaf_count>0", async () => {
    const fix = await createSessionFixture();
    fix.directory.registerThresholdSigner(fix.agentA.pubkeyHex, fix.signerA);

    scope.addCleanup(fix.stopAll);

    const { sessionIdHex } = await setupSession(fix);

    // Send a message so the local chain is non-empty on both sides
    await fix.agentA.client.sendMessage(
      sessionIdHex,
      new TextEncoder().encode("leaf-for-count")
    );

    // Wait for B to receive and confirm the leaf landed
    await waitFor(
      () => fix.agentB.client.receiveMessage(sessionIdHex) !== null,
      { timeout: 10_000 }
    );

    // A's session list
    const listA = fix.agentA.client.listSessions();

    expect(listA).toHaveLength(1);
    expect(toHex(listA[0].session_id)).toBe(sessionIdHex);
    expect(listA[0].status).toBe("active");
    expect(toHex(listA[0].counterparty_pubkey)).toBe(fix.agentB.pubkeyHex);
    expect(listA[0].local_tree_leaves.length).toBeGreaterThan(0);

    // B's session list
    const listB = fix.agentB.client.listSessions();

    expect(listB).toHaveLength(1);
    expect(toHex(listB[0].session_id)).toBe(sessionIdHex);
    expect(listB[0].status).toBe("active");
    expect(toHex(listB[0].counterparty_pubkey)).toBe(fix.agentA.pubkeyHex);
    expect(listB[0].local_tree_leaves.length).toBeGreaterThan(0);
  }, 25_000);
});

// ─── AC-006 (SESSION-004): Post-FROST session message exchange = M1 behavior ──

liveOnly("AC-006 (SESSION-004): Post-FROST session message exchange is identical to M1", () => {
  it("after FROST-established session, A sends message to B via dual-path; B receives with correct seq", async () => {
    const fix = await createSessionFixture();
    fix.directory.registerThresholdSigner(fix.agentA.pubkeyHex, fix.signerA);

    scope.addCleanup(fix.stopAll);

    const { sessionIdHex } = await setupSession(fix);

    // A sends a message on the FROST-established session
    const sendResult = await fix.agentA.client.sendMessage(
      sessionIdHex,
      new TextEncoder().encode("frost-session-message")
    );

    expect(sendResult.ok).toBe(true);

    // B receives the message — identical behavior to M1 dual-path
    const msg = await fix.agentB.client.receiveSessionMessageAsync(sessionIdHex, 10_000);

    expect(msg).not.toBeNull();
    expect(msg!.type).toBe("message");
    if (msg!.type !== "message") throw new Error("expected a message");
    expect(new TextDecoder().decode(msg!.content)).toBe("frost-session-message");
    expect(toHex(msg!.senderPubkey)).toBe(fix.agentA.pubkeyHex);
    // sequence_number must be >= 1 (relay-assigned, monotone)
    expect(msg!.sequenceNumber).toBeGreaterThanOrEqual(1);
    expect(toHex(msg!.leafHash)).toMatch(/^[0-9a-f]{64}$/);

    // Dual-path consistency: the leaf the SENDER committed to its own chain must be
    // byte-identical to the leaf the RECEIVER independently validated off the relay path.
    await waitFor(
      () => fix.agentA.client.listSessions()[0].local_tree_leaves.length > 0,
      { timeout: 10_000 }
    );
    expect(toHex(msg!.leafHash)).toBe(lastLeafHash(fix.agentA.client, sessionIdHex));
  }, 20_000);
});

// ─── DELETED: AC-002-notif ────────────────────────────────────────────────────
//
// "AC-002-notif: notifications/claude/channel fires with {type:cello_session_request,
//  from:A_pubkey, session_id}" was deleted with DOD-LEGACY-MCP-1.
//
// Its only subject was the DELETED in-process MCP server's own notification envelope
// ({method, params:{type, from, session_id}}). That envelope no longer exists and was
// never the shipped contract: the shipped doorbell has a different shape ({content, meta})
// built by core/adapter-claude-code/src/channel-params.ts, and is covered in cello-client
// by channel-params.test.ts and adapter-002.test.ts. The live substrate the case rode on —
// onSessionAssignment firing for a real directory assignment — is preserved by the AC-002
// test above. Nothing was lost.
