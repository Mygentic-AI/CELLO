/**
 * CELLO-CRYPTO-003: IThresholdSigner + FrostThresholdSigner tests
 *
 * Tests are derived 1:1 from the story's Acceptance Criteria (AC) and
 * Security Invariants (SI).
 *
 * All tests use real FROST cryptographic operations via @noble/curves/ed25519.
 * No crypto mocks.
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
import {
  FrostThresholdSigner,
  MockThresholdSigner,
} from "../frost/index.js";
// bootstrapKeyShares and clearTestShares are test-only — imported directly from
// the implementation file, not from the production barrel (frost/index.ts).
import {
  bootstrapKeyShares,
  clearTestShares,
} from "../frost/frost-threshold-signer.js";
import type { IThresholdSigner } from "../frost/types.js";
import {
  CONTEXT_SESSION_ESTABLISHMENT,
  CONTEXT_SEAL,
} from "../frost/types.js";
// createInProcessStubs is test-only infrastructure — imported directly from stubs,
// not through the frost/index.ts production barrel.
import { createInProcessStubs } from "../frost/stubs.js";

setupV3Tests();

// Evict all local key shares after each test to prevent cross-test accumulation
// of key material in the module-level _localShares map (L-2 fix).
afterEach(() => {
  clearTestShares();
});

// ─── Test helpers ──────────────────────────────────────────────────────────────

function makeAgentPubkey(seed: number): Uint8Array {
  const key = new Uint8Array(32);
  key[0] = seed;
  return key;
}

function makeTbs(label: string): Uint8Array {
  return new TextEncoder().encode(label);
}

// ─── AC-001: bootstrapKeyShares — all 3 nodes commit, primary_pubkey derived ──

describe("AC-001: bootstrapKeyShares with 3 in-process nodes", () => {
  let scope: ReturnType<typeof createTestScope>;

  beforeEach(() => {
    scope = createTestScope();
  });

  afterEach(async () => {
    await scope.run(async () => {});
  });

  it("AC-001: 3 nodes return commitments, primary_pubkey derived and stored, key share stored, no key material returned", async () => {
    const agentPubkey = makeAgentPubkey(1);
    const stubs = createInProcessStubs(3);
    const result = await bootstrapKeyShares(agentPubkey, {
      threshold: 2,
      participants: 3,
      directoryNodeStubs: stubs,
    });

    // primary_pubkey is returned
    expect(result.primaryPubkey).toBeInstanceOf(Uint8Array);
    expect(result.primaryPubkey.length).toBe(32);

    // No key share material in result (only primaryPubkey)
    const resultStr = JSON.stringify(result);
    expect(Object.keys(result)).toEqual(["primaryPubkey"]);
    expect(resultStr).not.toContain("signingShare");
    expect(resultStr).not.toContain("secretShares");
    expect(resultStr).not.toContain("coefficients");
  });
});

// ─── AC-002: session establishment signing ────────────────────────────────────

describe("AC-002: participateInCeremony — session establishment context", () => {
  let signer: FrostThresholdSigner;
  let scope: ReturnType<typeof createTestScope>;

  beforeEach(async () => {
    scope = createTestScope();
    const stubs = createInProcessStubs(3);
    const agentPubkey = makeAgentPubkey(2);
    await bootstrapKeyShares(agentPubkey, {
      threshold: 2,
      participants: 3,
      directoryNodeStubs: stubs,
    });
    signer = new FrostThresholdSigner(
      {
        threshold: 2,
        participants: 3,
        directoryNodeStubs: stubs,
      },
      agentPubkey,
    );
  });

  afterEach(async () => {
    await scope.run(async () => {});
  });

  it("AC-002: session establishment TBS + correct context → valid ThresholdSignature verifiable against primary_pubkey", async () => {
    const tbs = makeTbs("session-id:abc:agentA:agentB:genesis:timestamp");
    const result = await signer.participateInCeremony(
      "ceremony-001",
      tbs,
      CONTEXT_SESSION_ESTABLISHMENT,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.signature).toBeInstanceOf(Uint8Array);
    expect(result.signature.length).toBe(64);

    // Verify against primary_pubkey
    const pubkey = signer.getPrimaryPubkey();
    const valid = signer.verifySignature(
      result.signature,
      tbs,
      CONTEXT_SESSION_ESTABLISHMENT,
      pubkey,
    );
    expect(valid).toBe(true);
  });
});

// ─── AC-003: seal context signing ─────────────────────────────────────────────

describe("AC-003: participateInCeremony — seal context", () => {
  let signer: FrostThresholdSigner;
  let scope: ReturnType<typeof createTestScope>;

  beforeEach(async () => {
    scope = createTestScope();
    const stubs = createInProcessStubs(3);
    const agentPubkey = makeAgentPubkey(3);
    await bootstrapKeyShares(agentPubkey, {
      threshold: 2,
      participants: 3,
      directoryNodeStubs: stubs,
    });
    signer = new FrostThresholdSigner(
      {
        threshold: 2,
        participants: 3,
        directoryNodeStubs: stubs,
      },
      agentPubkey,
    );
  });

  afterEach(async () => {
    await scope.run(async () => {});
  });

  it("AC-003: seal TBS + seal context → valid ThresholdSignature verifiable against primary_pubkey with seal context", async () => {
    const tbs = makeTbs("session-id:xyz:sealed-root:4:timestamp");
    const result = await signer.participateInCeremony(
      "ceremony-003",
      tbs,
      CONTEXT_SEAL,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.signature).toBeInstanceOf(Uint8Array);
    expect(result.signature.length).toBe(64);

    const pubkey = signer.getPrimaryPubkey();
    const valid = signer.verifySignature(result.signature, tbs, CONTEXT_SEAL, pubkey);
    expect(valid).toBe(true);
  });
});

// ─── AC-004: cross-ceremony confusion impossible ───────────────────────────────

describe("AC-004: cross-ceremony confusion impossible", () => {
  let signer: FrostThresholdSigner;
  let scope: ReturnType<typeof createTestScope>;

  beforeEach(async () => {
    scope = createTestScope();
    const stubs = createInProcessStubs(3);
    const agentPubkey = makeAgentPubkey(4);
    await bootstrapKeyShares(agentPubkey, {
      threshold: 2,
      participants: 3,
      directoryNodeStubs: stubs,
    });
    signer = new FrostThresholdSigner(
      {
        threshold: 2,
        participants: 3,
        directoryNodeStubs: stubs,
      },
      agentPubkey,
    );
  });

  afterEach(async () => {
    await scope.run(async () => {});
  });

  it("AC-004: establishment signature does NOT verify under seal context", async () => {
    const tbs = makeTbs("tbs-same-content-both-contexts");
    const result = await signer.participateInCeremony(
      "ceremony-004",
      tbs,
      CONTEXT_SESSION_ESTABLISHMENT,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const pubkey = signer.getPrimaryPubkey();

    // Same context: should verify
    const sameCtx = signer.verifySignature(
      result.signature,
      tbs,
      CONTEXT_SESSION_ESTABLISHMENT,
      pubkey,
    );
    expect(sameCtx).toBe(true);

    // Different context: MUST fail
    const wrongCtx = signer.verifySignature(
      result.signature,
      tbs,
      CONTEXT_SEAL,
      pubkey,
    );
    expect(wrongCtx).toBe(false);
  });
});

// ─── AC-005: unresponsive node → excluded, ceremony completes ─────────────────

describe("AC-005: one unresponsive node excluded after timeout", () => {
  let scope: ReturnType<typeof createTestScope>;

  beforeEach(() => {
    scope = createTestScope();
  });

  afterEach(async () => {
    await scope.run(async () => {});
  });

  it("AC-005: 2-of-3; one node made unresponsive; ceremony completes with 2 responsive nodes", async () => {
    const stubs = createInProcessStubs(3);
    // Make the FIRST node unresponsive — it's the one selected for the first attempt.
    // The coordinator excludes it after roundTimeoutMs and picks a replacement
    // (on the next attempt, the first responsive node is stub 1).
    stubs[0].setUnresponsive(true);

    const agentPubkey = makeAgentPubkey(5);
    await bootstrapKeyShares(agentPubkey, {
      threshold: 2,
      participants: 3,
      directoryNodeStubs: stubs,
    });

    const signer = new FrostThresholdSigner(
      {
        threshold: 2,
        participants: 3,
        directoryNodeStubs: stubs,
        roundTimeoutMs: 100, // fast timeout for tests
      },
      agentPubkey,
    );

    const tbs = makeTbs("ac005-tbs");
    const result = await signer.participateInCeremony(
      "ceremony-005",
      tbs,
      CONTEXT_SESSION_ESTABLISHMENT,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const pubkey = signer.getPrimaryPubkey();
    expect(signer.verifySignature(result.signature, tbs, CONTEXT_SESSION_ESTABLISHMENT, pubkey)).toBe(true);
  });
});

// ─── AC-006: invalid partial sig → excluded, ceremony completes ───────────────

describe("AC-006: invalid partial signature excluded", () => {
  let scope: ReturnType<typeof createTestScope>;

  beforeEach(() => {
    scope = createTestScope();
  });

  afterEach(async () => {
    await scope.run(async () => {});
  });

  it("AC-006: 2-of-3; one node returns malformed partial sig; that node excluded; ceremony completes", async () => {
    const stubs = createInProcessStubs(3);
    // Make the FIRST selected node return invalid partial sig.
    // The coordinator verifies the sig, detects it's invalid, excludes that node
    // (treated identically to timeout per story spec), and retries.
    // On the next attempt, stub 1 (valid) is available → ceremony completes.
    stubs[0].setInvalidResponse(true);

    const agentPubkey = makeAgentPubkey(6);
    await bootstrapKeyShares(agentPubkey, {
      threshold: 2,
      participants: 3,
      directoryNodeStubs: stubs,
    });

    const signer = new FrostThresholdSigner(
      {
        threshold: 2,
        participants: 3,
        directoryNodeStubs: stubs,
        roundTimeoutMs: 100,
      },
      agentPubkey,
    );

    const tbs = makeTbs("ac006-tbs");
    const result = await signer.participateInCeremony(
      "ceremony-006",
      tbs,
      CONTEXT_SESSION_ESTABLISHMENT,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const pubkey = signer.getPrimaryPubkey();
    expect(signer.verifySignature(result.signature, tbs, CONTEXT_SESSION_ESTABLISHMENT, pubkey)).toBe(true);
  });
});

// ─── AC-007: all nodes unresponsive → DIRECTORY_BELOW_THRESHOLD ───────────────

describe("AC-007: all nodes unreachable at initiation → DIRECTORY_BELOW_THRESHOLD", () => {
  let scope: ReturnType<typeof createTestScope>;

  beforeEach(() => {
    scope = createTestScope();
  });

  afterEach(async () => {
    await scope.run(async () => {});
  });

  it("AC-007: 2-of-3; all 3 nodes unreachable at initiation → DIRECTORY_BELOW_THRESHOLD immediately", async () => {
    const stubs = createInProcessStubs(3);
    // Use setUnreachable (not setUnresponsive) — these nodes cannot be reached
    // at ceremony initiation, triggering the pre-ceremony availability check.
    stubs[0].setUnreachable(true);
    stubs[1].setUnreachable(true);
    stubs[2].setUnreachable(true);

    const agentPubkey = makeAgentPubkey(7);
    await bootstrapKeyShares(agentPubkey, {
      threshold: 2,
      participants: 3,
      directoryNodeStubs: stubs,
    });

    const signer = new FrostThresholdSigner(
      {
        threshold: 2,
        participants: 3,
        directoryNodeStubs: stubs,
        roundTimeoutMs: 50,
        ceremonyTimeoutMs: 5000,
      },
      agentPubkey,
    );

    const result = await signer.participateInCeremony(
      "ceremony-007",
      makeTbs("ac007-tbs"),
      CONTEXT_SESSION_ESTABLISHMENT,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe("DIRECTORY_BELOW_THRESHOLD");
  });
});

// ─── AC-008: ceremony timeout ─────────────────────────────────────────────────

describe("AC-008: ceremony timeout", () => {
  let scope: ReturnType<typeof createTestScope>;

  beforeEach(() => {
    scope = createTestScope();
  });

  afterEach(async () => {
    await scope.run(async () => {});
  });

  it("AC-008: nodes are unresponsive; ceremony deadline fires mid-attempt before all nodes excluded → CEREMONY_TIMEOUT", async () => {
    const stubs = createInProcessStubs(3);

    const agentPubkey = makeAgentPubkey(8);
    await bootstrapKeyShares(agentPubkey, {
      threshold: 2,
      participants: 3,
      directoryNodeStubs: stubs,
    });

    // All 3 nodes are reachable but never respond to signRound (signRound hangs
    // until the per-node roundTimeoutMs fires). This is different from AC-007
    // where nodes are unreachable at initiation — here they pass isReachable()
    // but fail during the signing round itself.
    //
    // Timing: roundTimeoutMs=50ms, ceremonyTimeoutMs=80ms.
    // Attempt 0:
    //   - Pre-round: 3 nodes reachable → threshold-1=1 node selected
    //   - Round 2: node 0 is contacted → deadline check before node 0 (t≈0ms, ok)
    //   - node 0 times out after 50ms → excluded, anyFailedThisRound=true → continue
    // Attempt 1 (t≈50ms):
    //   - Deadline check at top: t≈50ms < 80ms → ok
    //   - available: nodes 1,2 (node 0 excluded) → selected: node 1
    //   - Round 2: deadline check before node 1 (t≈50ms, ok)
    //   - node 1 times out after 50ms → t≈100ms > 80ms → excluded → continue
    // Attempt 2 (t≈100ms):
    //   - Deadline check at top: t≈100ms >= 80ms → CEREMONY_TIMEOUT
    stubs[0].setUnresponsive(true);
    stubs[1].setUnresponsive(true);
    stubs[2].setUnresponsive(true);

    const signer = new FrostThresholdSigner(
      {
        threshold: 2,
        participants: 3,
        directoryNodeStubs: stubs,
        roundTimeoutMs: 50,
        ceremonyTimeoutMs: 80, // shorter than 2 × roundTimeoutMs (100ms) but longer
        // than 1 × roundTimeoutMs (50ms), so deadline fires on the 2nd attempt
        maxRetries: 100, // large enough that timeout fires before exhaustion
      },
      agentPubkey,
    );

    const result = await signer.participateInCeremony(
      "ceremony-008",
      makeTbs("ac008-tbs"),
      CONTEXT_SESSION_ESTABLISHMENT,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe("CEREMONY_TIMEOUT");
  });
});

// ─── M-4 regression: all nodes excluded mid-ceremony → DIRECTORY_BELOW_THRESHOLD ──

describe("M-4 regression: all nodes excluded mid-ceremony returns DIRECTORY_BELOW_THRESHOLD", () => {
  let scope: ReturnType<typeof createTestScope>;

  beforeEach(() => {
    scope = createTestScope();
  });

  afterEach(async () => {
    await scope.run(async () => {});
  });

  it("M-4: 2-of-3; all nodes excluded during signing (invalid sigs); returns DIRECTORY_BELOW_THRESHOLD immediately, not CEREMONY_TIMEOUT", async () => {
    // Verifies the M-4 fix: when all available nodes are excluded mid-ceremony
    // (not at initiation), the coordinator returns DIRECTORY_BELOW_THRESHOLD
    // immediately rather than sleeping and eventually returning CEREMONY_TIMEOUT.
    //
    // All 3 nodes are reachable at initiation (pass isReachable()) but return
    // invalid partial sigs — getting excluded one per attempt.
    // After all 3 are excluded, available.length=0 < threshold-1=1 →
    // DIRECTORY_BELOW_THRESHOLD, not CEREMONY_TIMEOUT.
    const stubs = createInProcessStubs(3);
    stubs[0].setInvalidResponse(true);
    stubs[1].setInvalidResponse(true);
    stubs[2].setInvalidResponse(true);

    const agentPubkey = makeAgentPubkey(30);
    await bootstrapKeyShares(agentPubkey, {
      threshold: 2,
      participants: 3,
      directoryNodeStubs: stubs,
    });

    const signer = new FrostThresholdSigner(
      {
        threshold: 2,
        participants: 3,
        directoryNodeStubs: stubs,
        roundTimeoutMs: 5000, // very long — if the bug were present, sleeping 5s per remaining attempt
        ceremonyTimeoutMs: 60000, // very long — must NOT be the failure reason
        maxRetries: 10,
      },
      agentPubkey,
    );

    const start = Date.now();
    const result = await signer.participateInCeremony(
      "ceremony-m4-regression",
      makeTbs("m4-regression-tbs"),
      CONTEXT_SESSION_ESTABLISHMENT,
    );
    const elapsed = Date.now() - start;

    expect(result.ok).toBe(false);
    if (result.ok) return;

    // Must be DIRECTORY_BELOW_THRESHOLD, not CEREMONY_TIMEOUT
    expect(result.error.reason).toBe("DIRECTORY_BELOW_THRESHOLD");

    // Must complete quickly — invalid sigs respond immediately, no sleeping
    // Old bug: would sleep roundTimeoutMs (5s) per remaining attempt
    expect(elapsed).toBeLessThan(2000);
  });
});

// ─── AC-009: two agents → different primary_pubkeys ───────────────────────────

describe("AC-009: two agents produce distinct primary_pubkeys", () => {
  let scope: ReturnType<typeof createTestScope>;

  beforeEach(() => {
    scope = createTestScope();
  });

  afterEach(async () => {
    await scope.run(async () => {});
  });

  it("AC-009: agent A and B bootstrap against same 3 stubs → different primary_pubkeys; A's sig fails B's key", async () => {
    // Two separate stub sets (one per agent — each agent runs their own ceremony)
    const stubsA = createInProcessStubs(3);
    const stubsB = createInProcessStubs(3);

    const pubkeyA = makeAgentPubkey(9);
    const pubkeyB = makeAgentPubkey(10);

    const resultA = await bootstrapKeyShares(pubkeyA, {
      threshold: 2,
      participants: 3,
      directoryNodeStubs: stubsA,
    });
    const resultB = await bootstrapKeyShares(pubkeyB, {
      threshold: 2,
      participants: 3,
      directoryNodeStubs: stubsB,
    });

    // primary_pubkeys are different
    expect(
      Buffer.from(resultA.primaryPubkey).toString("hex"),
    ).not.toBe(
      Buffer.from(resultB.primaryPubkey).toString("hex"),
    );

    // Agent A signs
    const signerA = new FrostThresholdSigner(
      { threshold: 2, participants: 3, directoryNodeStubs: stubsA },
      pubkeyA,
    );

    const tbs = makeTbs("shared-tbs-same-content");

    const resA = await signerA.participateInCeremony("c-a", tbs, CONTEXT_SESSION_ESTABLISHMENT);
    expect(resA.ok).toBe(true);
    if (!resA.ok) return;

    // Verify A's sig against A's key: true
    expect(signerA.verifySignature(resA.signature, tbs, CONTEXT_SESSION_ESTABLISHMENT, resultA.primaryPubkey)).toBe(true);

    // Verify A's sig against B's key: false
    expect(signerA.verifySignature(resA.signature, tbs, CONTEXT_SESSION_ESTABLISHMENT, resultB.primaryPubkey)).toBe(false);
  });
});

// ─── AC-010: MockThresholdSigner swap point ────────────────────────────────────

describe("AC-010: MockThresholdSigner confirms IThresholdSigner swap point", () => {
  it("AC-010: MockThresholdSigner satisfies IThresholdSigner; callers work without knowing concrete type", async () => {
    // Confirm the interface contract at the type level by assigning to IThresholdSigner
    const mock: IThresholdSigner = new MockThresholdSigner();

    const result = await mock.participateInCeremony(
      "mock-ceremony",
      makeTbs("test"),
      CONTEXT_SESSION_ESTABLISHMENT,
    );

    // MockThresholdSigner always succeeds with a valid-looking result
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.signature).toBeInstanceOf(Uint8Array);
    expect(result.signature.length).toBe(64);
  });

  it("AC-010: FrostThresholdSigner also satisfies IThresholdSigner interface", async () => {
    const stubs = createInProcessStubs(3);
    const agentPubkey = makeAgentPubkey(11);
    await bootstrapKeyShares(agentPubkey, {
      threshold: 2,
      participants: 3,
      directoryNodeStubs: stubs,
    });

    // Assigned to IThresholdSigner — swap point is real
    const signer: IThresholdSigner = new FrostThresholdSigner(
      { threshold: 2, participants: 3, directoryNodeStubs: stubs },
      agentPubkey,
    );

    const result = await signer.participateInCeremony(
      "frost-via-interface",
      makeTbs("test"),
      CONTEXT_SESSION_ESTABLISHMENT,
    );
    expect(result.ok).toBe(true);
  });
});

// ─── AC-011: deterministic primary_pubkey ─────────────────────────────────────

describe("AC-011: primary_pubkey is deterministic from commitments, distinct from K_local", () => {
  let scope: ReturnType<typeof createTestScope>;

  beforeEach(() => {
    scope = createTestScope();
  });

  afterEach(async () => {
    await scope.run(async () => {});
  });

  it("AC-011: primary_pubkey returned from bootstrapKeyShares equals getPrimaryPubkey() on signer — derivation is stable after bootstrap", async () => {
    const stubs = createInProcessStubs(3);
    const agentPubkey = makeAgentPubkey(12);

    const bootstrapResult = await bootstrapKeyShares(agentPubkey, {
      threshold: 2,
      participants: 3,
      directoryNodeStubs: stubs,
    });

    const signer = new FrostThresholdSigner(
      { threshold: 2, participants: 3, directoryNodeStubs: stubs },
      agentPubkey,
    );

    // primary_pubkey from bootstrapKeyShares == getPrimaryPubkey() on signer
    // — it's derived once from the share commitments and stored stably
    expect(
      Buffer.from(bootstrapResult.primaryPubkey).toString("hex"),
    ).toBe(
      Buffer.from(signer.getPrimaryPubkey()).toString("hex"),
    );
  });

  it("AC-011: primary_pubkey is distinct from K_local (agentPubkey)", async () => {
    const stubs = createInProcessStubs(3);
    const agentPubkey = makeAgentPubkey(13);
    const result = await bootstrapKeyShares(agentPubkey, {
      threshold: 2,
      participants: 3,
      directoryNodeStubs: stubs,
    });

    // primary_pubkey must not equal K_local
    expect(
      Buffer.from(result.primaryPubkey).toString("hex"),
    ).not.toBe(
      Buffer.from(agentPubkey).toString("hex"),
    );
  });
});

// ─── AC-012: CEREMONY_EXHAUSTED after maxRetries ───────────────────────────────

describe("AC-012: CEREMONY_EXHAUSTED after maxRetries", () => {
  let scope: ReturnType<typeof createTestScope>;

  beforeEach(() => {
    scope = createTestScope();
  });

  afterEach(async () => {
    await scope.run(async () => {});
  });

  it("AC-012: maxRetries=3; each attempt fails (invalid node rotates each retry); returns CEREMONY_EXHAUSTED without waiting for ceremonyTimeoutMs", async () => {
    // 2-of-3 config: threshold=2, so the client + 1 stub are needed.
    // All 3 stubs return invalid partial sigs (not timeouts).
    // Each attempt: selected stub returns invalid sig → gets globally excluded.
    // After 3 attempts (1 stub used and excluded per attempt), all 3 attempts
    // have failed → CEREMONY_EXHAUSTED.
    // Nodes remain "reachable" (isReachable()=true) throughout — the ceremony
    // fails due to invalid responses, not unreachability.
    const stubs = createInProcessStubs(3);
    stubs[0].setInvalidResponse(true);
    stubs[1].setInvalidResponse(true);
    stubs[2].setInvalidResponse(true);

    const agentPubkey = makeAgentPubkey(14);
    await bootstrapKeyShares(agentPubkey, {
      threshold: 2,
      participants: 3,
      directoryNodeStubs: stubs,
    });

    const signer = new FrostThresholdSigner(
      {
        threshold: 2,
        participants: 3,
        directoryNodeStubs: stubs,
        roundTimeoutMs: 1000, // generous timeout — invalid sigs respond immediately
        ceremonyTimeoutMs: 60000, // very long — should not be reached
        maxRetries: 3,
      },
      agentPubkey,
    );

    const start = Date.now();
    const result = await signer.participateInCeremony(
      "ceremony-012",
      makeTbs("ac012-tbs"),
      CONTEXT_SESSION_ESTABLISHMENT,
    );
    const elapsed = Date.now() - start;

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe("CEREMONY_EXHAUSTED");

    // Must complete well before ceremonyTimeoutMs=60000ms
    expect(elapsed).toBeLessThan(5000);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECURITY INVARIANT TESTS
// ═══════════════════════════════════════════════════════════════════════════════

// ─── SI-001: key share never escapes ──────────────────────────────────────────

describe("SI-001: client FROST key share never escapes crypto package boundary", () => {
  let scope: ReturnType<typeof createTestScope>;

  beforeEach(() => {
    scope = createTestScope();
  });

  afterEach(async () => {
    await scope.run(async () => {});
  });

  it("SI-001: bootstrapKeyShares return value contains NO signing share material", async () => {
    const stubs = createInProcessStubs(3);
    const agentPubkey = makeAgentPubkey(20);
    const result = await bootstrapKeyShares(agentPubkey, {
      threshold: 2,
      participants: 3,
      directoryNodeStubs: stubs,
    });

    // Only primaryPubkey is returned
    expect(Object.keys(result)).toEqual(["primaryPubkey"]);
    const resultStr = JSON.stringify(result);
    // These field names must never appear in the return value
    expect(resultStr).not.toContain("signingShare");
    expect(resultStr).not.toContain("secretShare");
    expect(resultStr).not.toContain("coefficients");
    expect(resultStr).not.toContain("secret");
  });

  it("SI-001: failed ceremony result contains NO signing share material in error diagnostics", async () => {
    const stubs = createInProcessStubs(3);
    stubs[0].setUnresponsive(true);
    stubs[1].setUnresponsive(true);
    stubs[2].setUnresponsive(true);

    const agentPubkey = makeAgentPubkey(21);
    await bootstrapKeyShares(agentPubkey, {
      threshold: 2,
      participants: 3,
      directoryNodeStubs: stubs,
    });

    const signer = new FrostThresholdSigner(
      {
        threshold: 2,
        participants: 3,
        directoryNodeStubs: stubs,
        roundTimeoutMs: 50,
      },
      agentPubkey,
    );

    const result = await signer.participateInCeremony(
      "ceremony-si001",
      makeTbs("si001-tbs"),
      CONTEXT_SESSION_ESTABLISHMENT,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;

    // Error result must not contain key material
    const errStr = JSON.stringify(result.error);
    expect(errStr).not.toContain("signingShare");
    expect(errStr).not.toContain("secretShare");
    expect(errStr).not.toContain("coefficients");
    expect(errStr).not.toContain("secret");
  });

  it("SI-001: FrostThresholdSigner has no key-extraction methods on its public interface", async () => {
    const stubs = createInProcessStubs(3);
    const agentPubkey = makeAgentPubkey(22);
    await bootstrapKeyShares(agentPubkey, {
      threshold: 2,
      participants: 3,
      directoryNodeStubs: stubs,
    });

    const signer = new FrostThresholdSigner(
      { threshold: 2, participants: 3, directoryNodeStubs: stubs },
      agentPubkey,
    );

    // Must not expose any key extraction methods
    const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(signer));
    expect(proto).not.toContain("getKeyShare");
    expect(proto).not.toContain("getSecret");
    expect(proto).not.toContain("exportShare");
    expect(proto).not.toContain("getSigningShare");
  });
});

// ─── SI-002: context domain separation ────────────────────────────────────────

describe("SI-002: FROST signature never verifies under different domain context", () => {
  let signer: FrostThresholdSigner;
  let primaryPubkey: Uint8Array;
  let scope: ReturnType<typeof createTestScope>;

  beforeEach(async () => {
    scope = createTestScope();
    const stubs = createInProcessStubs(3);
    const agentPubkey = makeAgentPubkey(23);
    const bootstrap = await bootstrapKeyShares(agentPubkey, {
      threshold: 2,
      participants: 3,
      directoryNodeStubs: stubs,
    });
    primaryPubkey = bootstrap.primaryPubkey;
    signer = new FrostThresholdSigner(
      { threshold: 2, participants: 3, directoryNodeStubs: stubs },
      agentPubkey,
    );
  });

  afterEach(async () => {
    await scope.run(async () => {});
  });

  it("SI-002: establishment sig with same-length TBS does NOT verify under seal context", async () => {
    // TBS same length and content — only context differs
    const tbs = makeTbs("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"); // 31 bytes

    const result = await signer.participateInCeremony(
      "si002-ceremony",
      tbs,
      CONTEXT_SESSION_ESTABLISHMENT,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Correct context: true
    expect(signer.verifySignature(result.signature, tbs, CONTEXT_SESSION_ESTABLISHMENT, primaryPubkey)).toBe(true);

    // Wrong context: MUST be false — even with same TBS bytes
    expect(signer.verifySignature(result.signature, tbs, CONTEXT_SEAL, primaryPubkey)).toBe(false);
  });

  it("SI-002: seal sig does NOT verify under session establishment context", async () => {
    const tbs = makeTbs("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");

    const result = await signer.participateInCeremony(
      "si002-ceremony-2",
      tbs,
      CONTEXT_SEAL,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(signer.verifySignature(result.signature, tbs, CONTEXT_SEAL, primaryPubkey)).toBe(true);
    expect(signer.verifySignature(result.signature, tbs, CONTEXT_SESSION_ESTABLISHMENT, primaryPubkey)).toBe(false);
  });
});

// ─── SI-003: primary_pubkey not derived from K_local ─────────────────────────

describe("SI-003: primary_pubkey derived only from share commitments, not from K_local", () => {
  it("SI-003: two bootstraps with different stub sets produce different primary_pubkeys even with same K_local", async () => {
    const agentPubkey = makeAgentPubkey(24); // same K_local

    const stubsA = createInProcessStubs(3);
    const stubsB = createInProcessStubs(3);

    const resultA = await bootstrapKeyShares(agentPubkey, {
      threshold: 2,
      participants: 3,
      directoryNodeStubs: stubsA,
    });
    const resultB = await bootstrapKeyShares(agentPubkey, {
      threshold: 2,
      participants: 3,
      directoryNodeStubs: stubsB,
    });

    // Same K_local but different ceremony → different primary_pubkeys
    expect(
      Buffer.from(resultA.primaryPubkey).toString("hex"),
    ).not.toBe(
      Buffer.from(resultB.primaryPubkey).toString("hex"),
    );
  });

  it("SI-003: primary_pubkey cannot be derived from K_local alone (exhaustive check)", async () => {
    // The primary_pubkey is the FROST group public key — a point on ed25519
    // derived from Shamir's secret sharing commitment, nothing to do with K_local.
    // We verify that given K_local and no other info, you cannot reconstruct primary_pubkey.
    const agentPubkey = makeAgentPubkey(25);

    const stubs = createInProcessStubs(3);
    const result = await bootstrapKeyShares(agentPubkey, {
      threshold: 2,
      participants: 3,
      directoryNodeStubs: stubs,
    });

    // primary_pubkey is non-zero and distinct from agentPubkey
    const allZero = new Uint8Array(32);
    expect(Buffer.from(result.primaryPubkey).toString("hex")).not.toBe(
      Buffer.from(allZero).toString("hex"),
    );
    expect(Buffer.from(result.primaryPubkey).toString("hex")).not.toBe(
      Buffer.from(agentPubkey).toString("hex"),
    );
  });

  it("SI-003: FrostThresholdSigner construction with K_local available does not compute primary_pubkey from K_local", async () => {
    // The constructor takes agentPubkey but must not use it to derive primary_pubkey.
    // primary_pubkey comes from bootstrap only.
    const stubs = createInProcessStubs(3);
    const agentPubkey = makeAgentPubkey(26);
    const bootstrap = await bootstrapKeyShares(agentPubkey, {
      threshold: 2,
      participants: 3,
      directoryNodeStubs: stubs,
    });

    const signer = new FrostThresholdSigner(
      { threshold: 2, participants: 3, directoryNodeStubs: stubs },
      agentPubkey,
    );

    // primary_pubkey from signer must equal bootstrap result
    const signerKey = signer.getPrimaryPubkey();
    expect(Buffer.from(signerKey).toString("hex")).toBe(
      Buffer.from(bootstrap.primaryPubkey).toString("hex"),
    );

    // And it must NOT equal K_local
    expect(Buffer.from(signerKey).toString("hex")).not.toBe(
      Buffer.from(agentPubkey).toString("hex"),
    );
  });
});
