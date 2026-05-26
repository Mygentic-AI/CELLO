/**
 * CELLO-CONNREQ-003 + CELLO-SESSION-007 — Milestone close gate smoke test
 *
 * S — Specification:
 *
 * This file is the multi-process smoke test required to close M4. It exercises
 * behaviors that Vitest in-process unit tests cannot: real separate libp2p nodes,
 * real directory signaling streams, no shared in-memory state.
 *
 * CONNREQ-003 AC-001 equivalent (Scenario 1 — fan-out):
 *   Agent A calls cello_request_connection(B) AND cello_request_connection(C) concurrently
 *   (without awaiting the first). Both resolve with { result: 'established' }. Neither
 *   blocks the other. Two distinct connection IDs with distinct counterparty pubkeys.
 *
 * SESSION-007 AC-003 equivalent (Scenario 2 — cross-client seal detection):
 *   Agent A is blocked in receiveSessionMessageAsync on session S1.
 *   Agent B (separate CelloClient, separate libp2p node, no shared references) calls
 *   initiateSessionSeal on the same session S1.
 *   The seal travels via the real directory signaling stream (not in-process shared state).
 *   Agent A's blocked receiveSessionMessageAsync returns { type: 'session_sealed', session_id,
 *   sealed_root, close_timestamp, checkpoint_status: 'pending' } without A having called
 *   initiateSessionSeal.
 *   sealed_root in the returned event matches the sealed_root from listSessions().
 *
 * SESSION-007 AC-001 equivalent (Scenario 3 — other_sessions_pending hint):
 *   Agent A has two active sessions S1 and S2.
 *   A message arrives on S2 while Agent A is receiving on S1.
 *   The S1 receive result includes otherSessionsPending: [S2_id].
 *
 * P — Pseudocode (Phase P):
 *
 * Scenario 1:
 *   1. createSessionFixture({ register: true, withAgentC: true })
 *   2. Build connection package CBOR for A
 *   3. Launch both requests concurrently: Promise.all([A→B, A→C])
 *   4. Assert both results are 'established'
 *   5. Assert connection_id(B) !== connection_id(C)
 *   6. Assert listConnections() shows both connections
 *   7. Assert two distinct counterparty pubkeys
 *
 * Scenario 2:
 *   1. createSessionFixture({ register: true, requireConnectionGate: true, bootstrapB: true })
 *      — bootstrapB: true so B's client has a thresholdSigner for seal ceremony
 *   2. Establish connection A→B
 *   3. A initiates session; B accepts (awaitSession via onSessionAssignment)
 *   4. A sends at least one message (so session has a leaf for the Merkle seal)
 *   5. B starts initiateSessionSeal (don't await yet)
 *   6. A calls receiveSessionMessageAsync with a large timeout
 *   7. Assert A's result is { type: 'session_sealed', ... }
 *   8. Assert sealed_root matches A's listSessions() record
 *
 * Scenario 3:
 *   1. createSessionFixture({ register: true, requireConnectionGate: true })
 *   2. A establishes connections to B (two sessions)
 *   3. B sends messages on both S1 and S2
 *   4. A calls receiveSessionMessageAsync on S1
 *   5. Assert result includes otherSessionsPending: [S2_id]
 *   6. A calls receiveMessage on S2 — returns the queued message
 *
 * A — Architecture (Phase A):
 *   Uses createSessionFixture — no from-scratch fixture code.
 *   bootstrapB: true for Scenario 2 (B needs thresholdSigner to initiate seal ceremony).
 *   withAgentC: true for Scenario 1.
 *   All clients are separate CelloClient instances (distinct libp2p nodes).
 *   Seal crosses the real directory stream — no injectDirectoryFrame shortcut.
 *
 * Crypto refs:
 *   Ed25519: RFC 8032 — directory signature on session_sealed TBS
 *   FROST: RFC 9591 — threshold signature on SealNotarization
 *   SHA-256: FIPS 180-4 — Merkle leaf hashing
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
import { createSessionFixture } from "../session-fixture.js";

setupV3Tests();

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function buildMinimalPackageCbor(
  keyProvider: ReturnType<typeof generateKeypair>,
  mlDsaProvider: Awaited<ReturnType<typeof mlDsaKeygen>>,
  primaryPubkeyHex?: string,
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
      created_at: Date.now(),
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

// ─── Scenario 1: CONNREQ-003 fan-out — AC-001 equivalent ─────────────────────
//
// AC-001 (CONNREQ-003): Agent A calls cello_request_connection(B) and
// cello_request_connection(C) concurrently (both in flight simultaneously).
// Both resolve with { result: 'established', connection_id }.
// Neither blocks the other. Two distinct connection IDs with distinct counterparties.
//
// Transport-path observable: listConnections() on A shows both connections.
// Directory store has both connection records.

describe("CONNREQ-003-AC-001: fan-out — two concurrent connection requests to different targets both establish", () => {
  it(
    "A calls cello_request_connection(B) and cello_request_connection(C) concurrently; " +
    "both resolve established; two distinct connection IDs; neither blocks the other",
    async () => {
      const fix = await createSessionFixture({
        register: true,
        withAgentC: true,
      });
      scope.addCleanup(fix.stopAll);

      // Both B and C must have an agentC fixture
      if (!fix.agentC) throw new Error("agentC not provisioned by fixture");

      const mlDsaA = await mlDsaKeygen();
      const packageCborA = await buildMinimalPackageCbor(
        fix.agentA.kp,
        mlDsaA,
        fix.agentA.primaryPubkey,
      );

      // Launch BOTH requests concurrently — do NOT await the first before starting the second.
      // This is the critical CONNREQ-003 behavior: the Map-keyed resolver must handle
      // concurrent in-flight requests to different targets without one blocking the other.
      const [resultAtoB, resultAtoC] = await Promise.all([
        fix.agentA.client.cello_request_connection({
          target_pubkey: fix.agentB.pubkeyHex,
          package_cbor: packageCborA,
        }),
        fix.agentA.client.cello_request_connection({
          target_pubkey: fix.agentC.pubkeyHex,
          package_cbor: packageCborA,
        }),
      ]);

      // Transport-path observable: both calls returned 'established'
      expect(resultAtoB.result).toBe("established");
      expect(resultAtoC.result).toBe("established");

      if (resultAtoB.result !== "established") throw new Error("A→B expected established");
      if (resultAtoC.result !== "established") throw new Error("A→C expected established");

      // Two distinct connection IDs
      expect(resultAtoB.connection_id).not.toBe(resultAtoC.connection_id);

      // Transport-path observable: listConnections() on A shows both connections
      const aConns = fix.agentA.client.listConnections();
      expect(aConns.length).toBeGreaterThanOrEqual(2);
      const connAB = aConns.find(c => c.connection_id === resultAtoB.connection_id);
      const connAC = aConns.find(c => c.connection_id === resultAtoC.connection_id);
      expect(connAB).toBeDefined();
      expect(connAC).toBeDefined();

      // Two distinct counterparty pubkeys
      expect(connAB!.counterparty_pubkey).not.toBe(connAC!.counterparty_pubkey);

      // Transport-path observable: directory store has both connection records
      const dirConnAB = await fix.dirStore.hasConnection(
        fix.agentA.pubkeyHex,
        fix.agentB.pubkeyHex,
      );
      const dirConnAC = await fix.dirStore.hasConnection(
        fix.agentA.pubkeyHex,
        fix.agentC.pubkeyHex,
      );
      expect(dirConnAB).not.toBeNull();
      expect(dirConnAC).not.toBeNull();
      expect(dirConnAB!.connection_id).toBe(resultAtoB.connection_id);
      expect(dirConnAC!.connection_id).toBe(resultAtoC.connection_id);
    },
    60_000,
  );
});

// ─── Scenario 2: SESSION-007 AC-003 equivalent — cross-client seal detection ──
//
// AC-003 (SESSION-007): Agent A is blocked in receiveSessionMessageAsync on session S1.
// Agent B (separate CelloClient instance, separate libp2p node, no shared references)
// calls initiateSessionSeal — triggering the FROST ceremony via the real directory
// signaling stream.
// Agent A's blocked call returns { type: 'session_sealed', ... } without A having
// called initiateSessionSeal.
// sealed_root from the event matches sealed_root in A's listSessions() record.
//
// SI-002 (SESSION-007): sealed_root in the surfaced event equals the sealed_root
// committed by the directory (readable via listSessions) — not from local Merkle state.
//
// Critical: the seal travels via the real libp2p directory signaling stream, not via
// shared object references. Separate CelloClient instances with separate libp2p nodes
// enforce the no-shared-memory property.

describe(
  "SESSION-007-AC-003: cross-client seal detection — B seals from separate instance; " +
  "A's blocked receiveSessionMessageAsync returns { type: 'session_sealed' }",
  () => {
    it(
      "A blocked in receiveSessionMessageAsync; B (separate client) initiates seal via real directory stream; " +
      "A's call returns session_sealed; sealed_root matches listSessions(); A never called closeSession",
      async () => {
        // bootstrapB: true — B needs a thresholdSigner to participate in the FROST seal ceremony.
        // requireConnectionGate: true — ensures connection is established before session can start.
        const fix = await createSessionFixture({
          register: true,
          requireConnectionGate: true,
          bootstrapB: true,
          connectionTimeoutMs: 15_000,
        });
        scope.addCleanup(fix.stopAll);

        const mlDsaA = await mlDsaKeygen();
        const packageCbor = await buildMinimalPackageCbor(
          fix.agentA.kp,
          mlDsaA,
          fix.agentA.primaryPubkey,
        );

        // ── Step 1: Establish connection A → B ────────────────────────────────

        const connResult = await fix.agentA.client.cello_request_connection({
          target_pubkey: fix.agentB.pubkeyHex,
          package_cbor: packageCbor,
        });
        expect(connResult.result).toBe("established");
        if (connResult.result !== "established") {
          throw new Error(`Connection failed: ${JSON.stringify(connResult)}`);
        }

        // ── Step 2: A initiates session; B accepts ────────────────────────────

        // B will receive the session_assignment via its onSessionAssignment callback.
        // We don't need to explicitly call acceptSession — for a registered agent with
        // an open policy and a valid connection, the directory pushes the assignment
        // and B's client processes it automatically.
        const sessionResult = await fix.agentA.client.initiateSession(
          fix.agentB.pubkeyHex,
          { timeoutMs: 20_000 },
        );
        expect(sessionResult.ok).toBe(true);
        if (!sessionResult.ok) {
          throw new Error(`initiateSession failed: ${sessionResult.reason}`);
        }
        const sessionIdHex = Buffer.from(sessionResult.sessionId).toString("hex");

        // Wait for B to have the session active (pushed via directory)
        await waitFor(
          () => {
            const s = fix.agentB.client.listSessions().find(
              x => Buffer.from(x.session_id).toString("hex") === sessionIdHex,
            );
            return s?.status === "active";
          },
          { timeout: 15_000, interval: 100 },
        );

        // ── Step 3: A sends a message (session needs at least one leaf for Merkle seal) ──

        const sendResult = await fix.agentA.client.sendMessage(
          sessionIdHex,
          Buffer.from("ping before seal"),
        );
        expect(sendResult.ok).toBe(true);

        // Wait for B to receive the message (confirms relay has the leaf)
        await waitFor(
          () => fix.agentB.client.receiveMessage(sessionIdHex) !== null,
          { timeout: 10_000, interval: 50 },
        );

        // ── Step 4: A starts blocking in receiveSessionMessageAsync ──────────
        //
        // A has NOT called initiateSessionSeal. A is just waiting for the next message.
        // The receiveSessionMessageAsync must wake when the directory pushes session_sealed.

        let aReceivedSealEvent: Awaited<ReturnType<typeof fix.agentA.client.receiveSessionMessageAsync>> | null = null;
        let aReceiveError: unknown = null;

        // Start A's receive in background — don't await yet.
        const aReceivePromise = fix.agentA.client.receiveSessionMessageAsync(sessionIdHex, 30_000)
          .then(result => { aReceivedSealEvent = result; })
          .catch(err => { aReceiveError = err; });

        // Give A a moment to enter the blocked state before B seals
        await new Promise(resolve => setTimeout(resolve, 100));

        // ── Step 5: B initiates seal from its separate CelloClient instance ───
        //
        // B has a separate libp2p node and CelloClient. The seal ceremony travels
        // via the real directory signaling stream — not via shared in-memory state.
        // This is the "separate process" equivalent within a single Vitest worker.

        const sealPromise = fix.agentB.client.initiateSessionSeal(sessionIdHex);

        // ── Step 6: Wait for A's blocked receive to return ────────────────────

        await waitFor(
          () => aReceivedSealEvent !== null || aReceiveError !== null,
          { timeout: 30_000, interval: 100 },
        );

        // Await seal completion on B's side too
        const bSealResult = await sealPromise;
        expect(bSealResult.ok).toBe(true);
        if (!bSealResult.ok) {
          throw new Error(`B seal failed: ${bSealResult.reason}`);
        }

        await aReceivePromise;

        // ── Step 7: Verify A's sealed event ───────────────────────────────────

        if (aReceiveError !== null) throw aReceiveError;
        expect(aReceivedSealEvent).not.toBeNull();

        const sealEvent = aReceivedSealEvent!;

        // The event must be a session_sealed type (not null from timeout, not a regular message)
        expect(sealEvent).not.toBeNull();
        if (sealEvent === null) throw new Error("receiveSessionMessageAsync returned null (timeout)");
        expect(sealEvent.type).toBe("session_sealed");
        if (sealEvent.type !== "session_sealed") {
          throw new Error(`Expected session_sealed, got ${sealEvent.type}`);
        }

        // Fields required by AC-003
        expect(sealEvent.sessionIdHex).toBe(sessionIdHex);
        expect(sealEvent.sealedRoot).toBeInstanceOf(Uint8Array);
        expect(sealEvent.sealedRoot.length).toBe(32);
        expect(typeof sealEvent.closeTimestamp).toBe("number");
        expect(sealEvent.closeTimestamp).toBeGreaterThan(0);
        expect(sealEvent.checkpointStatus).toBe("pending");

        // ── Step 8: SI-002 — sealed_root matches listSessions() ───────────────
        //
        // The sealed_root surfaced through receiveSessionMessageAsync must equal the
        // sealed_root committed by the directory — not from local Merkle state.

        await waitFor(
          () => {
            const s = fix.agentA.client.listSessions().find(
              x => Buffer.from(x.session_id).toString("hex") === sessionIdHex,
            );
            return s?.status === "sealed" && s?.sealed_root !== undefined;
          },
          { timeout: 10_000, interval: 100 },
        );

        const aSessionRecord = fix.agentA.client.listSessions().find(
          x => Buffer.from(x.session_id).toString("hex") === sessionIdHex,
        );
        expect(aSessionRecord).toBeDefined();
        expect(aSessionRecord!.status).toBe("sealed");
        expect(aSessionRecord!.sealed_root).toBeDefined();

        // sealed_root from the event must match the directory-committed sealed_root
        expect(Buffer.from(sealEvent.sealedRoot).toString("hex")).toBe(
          Buffer.from(aSessionRecord!.sealed_root!).toString("hex"),
        );
      },
      90_000,
    );
  },
);

// ─── Scenario 3: SESSION-007 AC-001 — other_sessions_pending hint ─────────────
//
// AC-001 (SESSION-007): Agent A has two active sessions S1 and S2.
// S2 has a queued inbound message when A calls cello_receive_session on S1.
// The S1 response includes otherSessionsPending: [S2_id].
// A subsequent cello_receive_session on S2 returns the queued message.
//
// Design: send S2's message first, confirm it has arrived in A's queue using
// a per-session leaf count check (non-destructive), then send S1's message
// and call receiveSessionMessageAsync(S1). Since S2 is already queued, the S1 result
// includes otherSessionsPending: [s2IdHex].
//
// Leaf count is used as the non-destructive arrival detector: when B sends a
// message on S2, A's session record `local_tree_leaves` grows from 0 to 1.
// This confirms the message has been fully processed by the relay path and
// enqueued in A's receive queue — without consuming from the receive queue.

describe(
  "SESSION-007-AC-001: other_sessions_pending hint — S2 has pending message when A receives on S1",
  () => {
    it(
      "A has S1 and S2 active; B sends to S2; leaf count confirms arrival; A's receiveSessionMessageAsync(S1) " +
      "returns with otherSessionsPending: [S2]; subsequent receiveMessage(S2) returns the S2 message",
      async () => {
        const fix = await createSessionFixture({
          register: true,
          requireConnectionGate: true,
          connectionTimeoutMs: 15_000,
        });
        scope.addCleanup(fix.stopAll);

        const mlDsaA = await mlDsaKeygen();
        const packageCbor = await buildMinimalPackageCbor(
          fix.agentA.kp,
          mlDsaA,
          fix.agentA.primaryPubkey,
        );

        // ── Establish connection A → B ─────────────────────────────────────────

        const connResult = await fix.agentA.client.cello_request_connection({
          target_pubkey: fix.agentB.pubkeyHex,
          package_cbor: packageCbor,
        });
        expect(connResult.result).toBe("established");
        if (connResult.result !== "established") {
          throw new Error(`Connection failed: ${JSON.stringify(connResult)}`);
        }

        // ── Initiate two sessions S1 and S2 on the same connection ────────────

        const session1Result = await fix.agentA.client.initiateSession(
          fix.agentB.pubkeyHex,
          { timeoutMs: 20_000 },
        );
        expect(session1Result.ok).toBe(true);
        if (!session1Result.ok) throw new Error(`S1 initiation failed: ${session1Result.reason}`);
        const s1IdHex = Buffer.from(session1Result.sessionId).toString("hex");

        const session2Result = await fix.agentA.client.initiateSession(
          fix.agentB.pubkeyHex,
          { timeoutMs: 20_000 },
        );
        expect(session2Result.ok).toBe(true);
        if (!session2Result.ok) throw new Error(`S2 initiation failed: ${session2Result.reason}`);
        const s2IdHex = Buffer.from(session2Result.sessionId).toString("hex");

        // Two distinct session IDs
        expect(s1IdHex).not.toBe(s2IdHex);

        // Wait for B to have both sessions active
        await waitFor(
          () => {
            const sessions = fix.agentB.client.listSessions();
            const s1 = sessions.find(x => Buffer.from(x.session_id).toString("hex") === s1IdHex);
            const s2 = sessions.find(x => Buffer.from(x.session_id).toString("hex") === s2IdHex);
            return s1?.status === "active" && s2?.status === "active";
          },
          { timeout: 15_000, interval: 100 },
        );

        // ── B sends a message on S2 only ──────────────────────────────────────
        //
        // This message will sit in A's S2 receive queue while A is waiting for S1.

        const sendS2 = await fix.agentB.client.sendMessage(
          s2IdHex,
          Buffer.from("message on session 2"),
        );
        expect(sendS2.ok).toBe(true);

        // Wait for S2's message to arrive in A's session — detected non-destructively
        // by watching the local_tree_leaves count on A's S2 session record.
        // When the relay echoes B's leaf back to A's session handler, the leaf is
        // added to local_tree_leaves AND the content is enqueued in the receive queue.
        // A leaf count > 0 means the message is in A's receive queue.
        await waitFor(
          () => {
            const s2 = fix.agentA.client.listSessions().find(
              x => Buffer.from(x.session_id).toString("hex") === s2IdHex,
            );
            return (s2?.local_tree_leaves.length ?? 0) > 0;
          },
          { timeout: 10_000, interval: 50 },
        );

        // ── B sends a message on S1 (unblocks A's receiveSessionMessageAsync) ──
        //
        // S2's message is already queued. Now send S1's message.
        // A's receiveSessionMessageAsync(S1) will either return immediately (if S1 already
        // arrived) or block until S1 arrives. In both cases, S2 is in queue.

        const sendS1 = await fix.agentB.client.sendMessage(
          s1IdHex,
          Buffer.from("message on session 1"),
        );
        expect(sendS1.ok).toBe(true);

        // ── A calls receiveSessionMessageAsync on S1; S2 has queued message ───
        //
        // otherSessionsPending must include s2IdHex because S2's message is in queue.

        const s1Receive = await fix.agentA.client.receiveSessionMessageAsync(s1IdHex, 15_000);

        // Must receive the S1 message
        expect(s1Receive).not.toBeNull();
        if (s1Receive === null) throw new Error("S1 receive timed out");
        expect(s1Receive.type).toBe("message");
        if (s1Receive.type !== "message") throw new Error(`Expected message, got ${s1Receive.type}`);

        // Transport-path observable: otherSessionsPending includes S2
        expect(s1Receive.otherSessionsPending).toBeDefined();
        expect(Array.isArray(s1Receive.otherSessionsPending)).toBe(true);
        expect(s1Receive.otherSessionsPending).toContain(s2IdHex);

        // ── A's subsequent receive on S2 returns the queued S2 message ─────────

        const s2Msg = fix.agentA.client.receiveMessage(s2IdHex);
        expect(s2Msg).not.toBeNull();
        if (s2Msg === null) throw new Error("S2 message missing after hint");
        expect(s2Msg.type).toBe("message");
        if (s2Msg.type !== "message") throw new Error(`Expected message, got ${s2Msg.type}`);
        expect(Buffer.from(s2Msg.content).toString()).toBe("message on session 2");
      },
      120_000,
    );
  },
);
