/**
 * CELLO-SESSION-003: bilateral session seal — client unit tests
 *
 * This file covers tests that exercise only the client's internal logic without
 * requiring full infrastructure (relay + directory). Infrastructure-dependent
 * tests (AC-001–AC-004) live in packages/e2e-tests/src/__tests__/session003-e2e.test.ts.
 *
 * Covered ACs:
 *   AC-011: tampered directory_signature on session_sealed → client rejects, stays sealing
 *   SI-005: client never transitions to sealed without valid directory signature
 *
 * SealPayload: canonical CBOR([session_id, final_root, close_timestamp, "PENDING"])
 * per SESSION-003 and RFC 8949 §4.2.1.
 * Ed25519 per RFC 8032. SHA-256 per FIPS 180-4.
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
import { randomBytes } from "node:crypto";
import { generateKeypair, FrostThresholdSigner } from "@cello/crypto";
import { bootstrapKeyShares, clearTestShares } from "@cello/crypto/frost/frost-threshold-signer.js";
import { createInProcessStubs } from "@cello/crypto/frost/stubs.js";
import { buildSealTbs } from "@cello/protocol-types";
import { createNode } from "@cello/transport";
import { createClient } from "../client.js";

setupV3Tests();

// ─── Test scope ───────────────────────────────────────────────────────────────

let scope: TestScope;
beforeEach(() => { scope = createTestScope(); });
afterEach(() => {
  clearTestShares();
  return scope.run(async () => {});
});

// ─── AC-011 / SI-005: tampered FROST signature on session_frost_sealed ──────────
//
// SESSION-005 note: M2 clients receive 'session_frost_sealed' (not 'session_sealed' with
// single-key sig). The M2 seal rejection test verifies the FROST sig path. The M1 single-key
// tampered-sig test would require an M1 client (no thresholdSigner) which can no longer
// receive FROST-signed assignments. Full FROST seal rejection is covered by session005.test.ts.
// Here we test the residual: injecting 'session_frost_sealed' with a tampered FROST sig.

describe("AC-011 / SI-005: tampered FROST signature on session_frost_sealed → client rejects", () => {
  it("one bit flipped in frost_signature → client stays in sealing, never transitions to sealed", async () => {
    // Setup: minimal stack — one M2 client with thresholdSigner.
    // We inject a session_frost_sealed frame with a tampered FROST sig.
    const kpA = generateKeypair();
    const nodeA = await createNode({ keyProvider: kpA, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await nodeA.start();
    scope.addCleanup(() => nodeA.stop());

    const pubkeyA = await kpA.getPublicKey();
    // SESSION-004/SESSION-005: bootstrap FROST for A
    const stubsSI005 = createInProcessStubs(3);
    const bootstrapSI005 = await bootstrapKeyShares(pubkeyA, { threshold: 2, participants: 3, directoryNodeStubs: stubsSI005 });
    const signerSI005 = new FrostThresholdSigner({ threshold: 2, participants: 3, directoryNodeStubs: stubsSI005 }, pubkeyA);
    const clientA = createClient(nodeA, kpA, { thresholdSigner: signerSI005 });
    // SESSION-005: register A's primary_pubkey so the client can verify seal FROST sigs.
    clientA.setPrimaryPubkey(bootstrapSI005.primaryPubkey);
    await clientA.registerHandler();

    const sessionId = new Uint8Array(randomBytes(16));
    const sessionIdHex2 = Buffer.from(sessionId).toString("hex");

    // Inject a session in sealing state directly (no relay needed for this unit test).
    const clientAWithEscapes = clientA as unknown as {
      injectDirectoryFrame(sessionIdHex: string, frame: Record<string, unknown>): void;
      injectTestSession(
        sessionIdHex: string, sessionId: Uint8Array, myPubkeyHex: string,
        directoryPubkey: Uint8Array, status?: string
      ): void;
    };
    const pubkeyAHex = Buffer.from(pubkeyA).toString("hex");
    clientAWithEscapes.injectTestSession(sessionIdHex2, sessionId, pubkeyAHex, new Uint8Array(32), "sealing");

    // Build a session_frost_sealed frame with a real and a tampered FROST signature.
    const sealedRoot = new Uint8Array(32); sealedRoot.fill(0xAB);
    const leafCount = 3;
    const closeTimestamp = Date.now();
    const tbsSeal = buildSealTbs(sessionId, sealedRoot, leafCount, closeTimestamp);

    // Set the session's close_timestamp and local_tree_leaves so the handler can reconstruct TBS.
    const session = clientA.listSessions().find(s => Buffer.from(s.session_id).toString("hex") === sessionIdHex2);
    expect(session).toBeDefined();
    if (session) {
      session.close_timestamp = closeTimestamp;
      session.local_tree_leaves = new Array(leafCount).fill(null) as [];
    }

    // Sign with A's signer to get a valid FROST sig.
    const signResult = await signerSI005.participateInCeremony("si005-ceremony", tbsSeal, "cello-frost-seal-v1");
    expect(signResult.ok).toBe(true);
    if (!signResult.ok) return;

    // Flip one bit in the FROST signature to create a tampered version.
    const tamperedFrostSig = new Uint8Array(signResult.signature);
    tamperedFrostSig[0] ^= 0x01;

    // Inject the tampered session_frost_sealed frame.
    clientAWithEscapes.injectDirectoryFrame(sessionIdHex2, {
      type: "session_frost_sealed",
      session_id: sessionId,
      sealed_root: sealedRoot,
      frost_signature: tamperedFrostSig,
      signer_pubkey: bootstrapSI005.primaryPubkey,
      close_timestamp: closeTimestamp,
    });

    // SI-005: client MUST NOT transition to sealed — tampered signature must be rejected.
    const sessionAfter = clientA.listSessions().find(s => Buffer.from(s.session_id).toString("hex") === sessionIdHex2);
    expect(sessionAfter?.status).toBe("sealing");
    expect(sessionAfter?.sealed_root).toBeUndefined();

    // Verify that a VALID FROST signature does cause the transition.
    clientAWithEscapes.injectDirectoryFrame(sessionIdHex2, {
      type: "session_frost_sealed",
      session_id: sessionId,
      sealed_root: sealedRoot,
      frost_signature: signResult.signature,
      signer_pubkey: bootstrapSI005.primaryPubkey,
      close_timestamp: closeTimestamp,
    });

    const sessionSealed = clientA.listSessions().find(s => Buffer.from(s.session_id).toString("hex") === sessionIdHex2);
    expect(sessionSealed?.status).toBe("sealed");
    expect(Buffer.from(sessionSealed?.sealed_root ?? []).toString("hex"))
      .toBe(Buffer.from(sealedRoot).toString("hex"));
  }, 30_000);
});
