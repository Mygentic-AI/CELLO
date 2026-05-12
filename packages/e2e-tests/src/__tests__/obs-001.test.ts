/**
 * CELLO-OBS-001: Operator Observability — unit + integration + E2E tests
 *
 * TDD Phase R — RED-first. Written BEFORE implementation.
 * All new tests MUST FAIL until full implementation is complete.
 *
 * Covered ACs:
 *   AC-012 (unit): Every log line matches exact format; no ANSI codes
 *   AC-001: Relay startup line appears on stdout
 *   AC-002: Directory startup line appears on stdout
 *   AC-003: Auth line on signaling auth
 *   AC-004: Full DKG sequence — DKG begin → 3× Round 1 → 3× Round 3 → Agent registered
 *   AC-005: Connection accept flow — Request → Relayed → Verdict accept → Connection established
 *   AC-006: Pre-check failed on target_not_found — no Relayed line
 *   AC-007: Round 2 disclosure lines
 *   AC-008: FROST session ceremony lines
 *   AC-009: Seal ceremony lines
 *   AC-010: Relay lifecycle lines
 *   AC-011: Full M3 flow — all expected lines present
 *
 * Security Invariants:
 *   SI-001: No private keys, shares, nonces, or message content in any log line
 *   SI-002: No full 32-byte values — only 8-char truncations
 *
 * Crypto refs:
 *   Ed25519: RFC 8032
 *   SHA-256: FIPS 180-4
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
import { clearTestShares } from "@cello/crypto/frost/frost-threshold-signer.js";
import { generateKeypair, mlDsaKeygen } from "@cello/crypto";
import {
  encodeConnectionPackage,
  buildPseudonymBinding,
} from "@cello/protocol-types";
import type { ConnectionPackage } from "@cello/protocol-types";
import { createSessionFixture } from "../session-fixture.js";

setupV3Tests();

// ─── stdout capture ───────────────────────────────────────────────────────────

function captureStdout(): { lines: () => string[]; restore: () => void } {
  const chunks: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array, ..._args: unknown[]) => {
    chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stdout.write;
  return {
    lines: () => chunks.join("").split("\n").filter((l) => l.length > 0),
    restore: () => { process.stdout.write = originalWrite; },
  };
}

// ─── Format assertion ─────────────────────────────────────────────────────────

const LOG_LINE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}  \[(?:DIR|AUTH|REG|FROST|CONN|SESS|SEAL|RELAY)\] .+$/;
const ANSI_RE = /\x1b\[[0-9;]*m/;

function assertLogLine(line: string): void {
  expect(line).toMatch(LOG_LINE_RE);
  expect(line).not.toMatch(ANSI_RE);
}

// ─── Connection package helper ────────────────────────────────────────────────

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
      pseudonym_label: "obs-test-agent",
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

// ─── AC-012: Unit test — log format ──────────────────────────────────────────

describe("AC-012: log format — every line matches pattern, no ANSI codes", () => {
  it("protocolLog produces correctly formatted lines for all prefixes", async () => {
    // Dynamic import so the module is resolved against the compiled output
    const { protocolLog } = await import("../../../relay/src/protocol-log.js") as {
      protocolLog: (prefix: string, message: string) => void;
    };

    const cap = captureStdout();
    try {
      protocolLog("RELAY", "Started — peer 12345678, relay /ip4/127.0.0.1/tcp/4001");
      protocolLog("DIR", "Started — peer 12345678, signaling /ip4/127.0.0.1/tcp/4000");
      protocolLog("AUTH", "Peer 12345678 authenticated (signaling)");
      protocolLog("REG", "DKG begin — agent abcd1234, 3 directory nodes, threshold 2");
      protocolLog("FROST", "Round 1 commit from peer 12345678 (1/3)");
      protocolLog("CONN", "Request: abcd1234 → efgh5678");
      protocolLog("SESS", "Session request: abcd1234 → efgh5678");
      protocolLog("SEAL", "Initiating seal — session abcd1234 (5 leaves)");
    } finally {
      cap.restore();
    }

    const lines = cap.lines();
    expect(lines.length).toBe(8);
    for (const line of lines) {
      assertLogLine(line);
    }
  });
});

// ─── AC-001: Relay startup ────────────────────────────────────────────────────

describe("AC-001: relay startup log line", () => {
  it("relay started line appears on stdout", async () => {
    const cap = captureStdout();
    let fix: Awaited<ReturnType<typeof createSessionFixture>>;
    try {
      fix = await createSessionFixture();
    } finally {
      cap.restore();
    }
    scope.addCleanup(fix.stopAll);

    const lines = cap.lines();
    const startLine = lines.find((l) => l.includes("[RELAY]") && l.includes("Started"));
    expect(startLine).toBeDefined();
    assertLogLine(startLine!);
    expect(startLine).toMatch(/\[RELAY\]\s+Started/);
  });
});

// ─── AC-002: Directory startup ────────────────────────────────────────────────

describe("AC-002: directory startup log line", () => {
  it("directory started line appears on stdout", async () => {
    const cap = captureStdout();
    let fix: Awaited<ReturnType<typeof createSessionFixture>>;
    try {
      fix = await createSessionFixture();
    } finally {
      cap.restore();
    }
    scope.addCleanup(fix.stopAll);

    const lines = cap.lines();
    const startLine = lines.find((l) => l.includes("[DIR]") && l.includes("Started"));
    expect(startLine).toBeDefined();
    assertLogLine(startLine!);
    expect(startLine).toMatch(/\[DIR\]\s+Started/);
  });
});

// ─── AC-003: Auth line on signaling auth ─────────────────────────────────────

describe("AC-003: auth line appears after signaling authentication", () => {
  it("[AUTH] Peer authenticated line appears when agent connects to directory", async () => {
    // Capture during fixture creation: registerHandler() opens the persistent
    // signaling stream which triggers the AUTH log line on the directory.
    const cap = captureStdout();
    let fix: Awaited<ReturnType<typeof createSessionFixture>>;
    try {
      fix = await createSessionFixture();
    } finally {
      cap.restore();
    }
    scope.addCleanup(fix.stopAll);

    const lines = cap.lines();
    const authLine = lines.find((l) => l.includes("[AUTH]") && l.includes("authenticated"));
    expect(authLine).toBeDefined();
    assertLogLine(authLine!);
  }, 30_000);
});

// ─── AC-004: Full DKG sequence ────────────────────────────────────────────────

describe("AC-004: DKG sequence — begin → Round 1 commits → Round 3 signs → registered", () => {
  it("full DKG log sequence appears on stdout during registration", async () => {
    // Capture stdout while the fixture runs registration
    const cap = captureStdout();
    let fix: Awaited<ReturnType<typeof createSessionFixture>>;
    try {
      fix = await createSessionFixture({ register: true });
    } finally {
      cap.restore();
    }
    scope.addCleanup(fix.stopAll);

    const lines = cap.lines();

    // AC-004: [REG] DKG begin appears
    const dkgBeginLine = lines.find((l) => l.includes("[REG]") && l.includes("DKG begin"));
    expect(dkgBeginLine).toBeDefined();
    assertLogLine(dkgBeginLine!);

    // AC-004: [FROST] Round 1 commit lines appear (at least 1, since we have 1 directory node)
    const round1Lines = lines.filter((l) => l.includes("[FROST]") && l.includes("Round 1 commit"));
    expect(round1Lines.length).toBeGreaterThanOrEqual(1);
    for (const l of round1Lines) assertLogLine(l);

    // AC-004: [FROST] Round 3 sign lines appear
    const round3Lines = lines.filter((l) => l.includes("[FROST]") && l.includes("Round 3 sign"));
    expect(round3Lines.length).toBeGreaterThanOrEqual(1);
    for (const l of round3Lines) assertLogLine(l);

    // AC-004: [REG] Agent registered
    const regLine = lines.find((l) => l.includes("[REG]") && l.includes("registered"));
    expect(regLine).toBeDefined();
    assertLogLine(regLine!);
  }, 60_000);
});

// ─── AC-005: Connection accept flow ──────────────────────────────────────────

describe("AC-005: connection accept flow — Request → Relayed → Verdict accept → Connection established", () => {
  it("full connection accept log sequence appears on stdout", async () => {
    const fix = await createSessionFixture({ register: true });
    scope.addCleanup(fix.stopAll);

    const mlDsaA = await mlDsaKeygen();
    const packageCborA = await buildMinimalPackageCbor(fix.agentA.kp, mlDsaA, fix.agentA.primaryPubkey);

    const cap = captureStdout();
    try {
      const result = await fix.agentA.client.cello_request_connection({
        target_pubkey: fix.agentB.pubkeyHex,
        package_cbor: packageCborA,
      });
      expect(result.result).toBe("established");
    } finally {
      cap.restore();
    }

    const lines = cap.lines();

    // [CONN] Request line
    const requestLine = lines.find((l) => l.includes("[CONN]") && l.includes("Request:"));
    expect(requestLine).toBeDefined();
    assertLogLine(requestLine!);

    // [CONN] Relayed to target
    const relayedLine = lines.find((l) => l.includes("[CONN]") && l.includes("Relayed"));
    expect(relayedLine).toBeDefined();
    assertLogLine(relayedLine!);

    // [CONN] Verdict accept
    const verdictLine = lines.find((l) => l.includes("[CONN]") && l.includes("Verdict") && l.includes("accept"));
    expect(verdictLine).toBeDefined();
    assertLogLine(verdictLine!);

    // [CONN] Connection established
    const establishedLine = lines.find((l) => l.includes("[CONN]") && l.includes("established"));
    expect(establishedLine).toBeDefined();
    assertLogLine(establishedLine!);
  }, 45_000);
});

// ─── AC-006: Pre-check failed — target_not_found, no Relayed line ─────────────

describe("AC-006: pre-check failed on target_not_found — Pre-check failed line, no Relayed line", () => {
  it("[CONN] Pre-check failed appears; no [CONN] Relayed line on target_not_found", async () => {
    const fix = await createSessionFixture({ register: true });
    scope.addCleanup(fix.stopAll);

    // Use a pubkey that is not registered
    const unknownKp = generateKeypair();
    const unknownPubkeyHex = Buffer.from(await unknownKp.getPublicKey()).toString("hex");

    const mlDsaA = await mlDsaKeygen();
    const packageCborA = await buildMinimalPackageCbor(fix.agentA.kp, mlDsaA, fix.agentA.primaryPubkey);

    const cap = captureStdout();
    try {
      const result = await fix.agentA.client.cello_request_connection({
        target_pubkey: unknownPubkeyHex,
        package_cbor: packageCborA,
      });
      // Should fail since target is not registered
      expect(result.result).not.toBe("established");
    } finally {
      cap.restore();
    }

    const lines = cap.lines();

    // [CONN] Pre-check failed appears
    const preCheckLine = lines.find((l) => l.includes("[CONN]") && l.includes("Pre-check failed"));
    expect(preCheckLine).toBeDefined();
    assertLogLine(preCheckLine!);
    expect(preCheckLine).toContain("target_not_found");

    // No [CONN] Relayed line when pre-check fails
    const relayedLine = lines.find((l) => l.includes("[CONN]") && l.includes("Relayed"));
    expect(relayedLine).toBeUndefined();
  }, 45_000);
});

// ─── AC-007: Round 2 disclosure lines ────────────────────────────────────────

describe("AC-007: Round 2 disclosure relay lines appear on stdout", () => {
  it("[CONN] Disclosure request forwarded (Round 2) line appears when B requests disclosure", async () => {
    // B requires pseudonym_age >= 1 day. A's package has created_at=now (0 days old) → insufficient.
    // This triggers B to send a disclosure_request, which the directory logs and forwards.
    const selectivePolicy = {
      mode: "selective" as const,
      review_mode: "deterministic" as const,
      requirements: [{ signal_type: "pseudonym_age" as const, condition: { type: "min_age_days" as const, days: 1 } }],
    };

    const fix = await createSessionFixture({
      register: true,
      policyB: selectivePolicy,
      round2TimeoutMs: 10_000,
    });
    scope.addCleanup(fix.stopAll);

    const mlDsaA = await mlDsaKeygen();
    // Package with created_at = now (0 days old, fails pseudonym_age >= 1 day check)
    const packageCborA = await buildMinimalPackageCbor(fix.agentA.kp, mlDsaA, fix.agentA.primaryPubkey);

    let disclosureRequestReceived = false;
    let receivedConnectionRequestId: string | null = null;
    fix.agentA.client.onDisclosureRequested((event) => {
      disclosureRequestReceived = true;
      receivedConnectionRequestId = event.connection_request_id;
    });

    const cap = captureStdout();
    let requestPromise: Promise<unknown>;
    try {
      // Start the connection request — B will respond with disclosure_request
      requestPromise = fix.agentA.client.cello_request_connection({
        target_pubkey: fix.agentB.pubkeyHex,
        package_cbor: packageCborA,
      });
    } finally {
      // Don't restore here — wait for the disclosure request to arrive
    }

    // Wait for B to ask A for more disclosure (and for the directory to log the forward)
    await waitFor(() => disclosureRequestReceived && receivedConnectionRequestId !== null, {
      timeout: 15_000,
      interval: 100,
    });

    cap.restore();

    const lines = cap.lines();

    // [CONN] Request appears
    const requestLine = lines.find((l) => l.includes("[CONN]") && l.includes("Request:"));
    expect(requestLine).toBeDefined();
    assertLogLine(requestLine!);

    // [CONN] Disclosure request forwarded (Round 2) appears
    const disclosureReqLine = lines.find((l) => l.includes("[CONN]") && l.includes("Disclosure request forwarded"));
    expect(disclosureReqLine).toBeDefined();
    assertLogLine(disclosureReqLine!);

    // Clean up — A sends a disclosure response to unblock requestPromise
    if (receivedConnectionRequestId) {
      try {
        const mlDsaV2 = await mlDsaKeygen();
        const twoDaysAgo = Date.now() - 2 * 86_400_000;
        const packageV2 = await buildMinimalPackageCbor(fix.agentA.kp, mlDsaV2, fix.agentA.primaryPubkey, twoDaysAgo);
        await fix.agentA.client.cello_respond_to_disclosure_request({
          connection_request_id: receivedConnectionRequestId,
          package_cbor: packageV2,
        });
      } catch { /* cleanup only — don't fail the test */ }
    }
    // Drain requestPromise
    try { await requestPromise!; } catch { /* ignore */ }
  }, 60_000);
});

// ─── AC-008: FROST session ceremony lines ────────────────────────────────────

describe("AC-008: FROST session ceremony lines appear during session establishment", () => {
  it("[SESS] Session request → [FROST] Ceremony begin → commits → partial sigs → [SESS] Assignment issued", async () => {
    const fix = await createSessionFixture();
    fix.directory.registerThresholdSigner(fix.agentA.pubkeyHex, fix.signerA);
    fix.directory.registerPeerInfo(fix.agentA.pubkeyHex, fix.agentA.pubkeyHex, fix.dirMultiaddrs);
    fix.directory.registerPeerInfo(fix.agentB.pubkeyHex, fix.agentB.pubkeyHex, fix.dirMultiaddrs);
    scope.addCleanup(fix.stopAll);

    const cap = captureStdout();
    try {
      const result = await fix.agentA.client.initiateSession(fix.agentB.pubkeyHex, { timeoutMs: 15_000 });
      if (!result.ok) throw new Error(`initiateSession failed: ${result.reason}`);
    } finally {
      cap.restore();
    }

    const lines = cap.lines();

    // [SESS] Session request
    const sessReqLine = lines.find((l) => l.includes("[SESS]") && l.includes("Session request"));
    expect(sessReqLine).toBeDefined();
    assertLogLine(sessReqLine!);

    // [FROST] Ceremony begin
    const ceremonyLine = lines.find((l) => l.includes("[FROST]") && l.includes("Ceremony begin"));
    expect(ceremonyLine).toBeDefined();
    assertLogLine(ceremonyLine!);

    // [FROST] Commit collected — at least threshold count (2-of-3 fixture: threshold=2, participants=3 → 3 total)
    const commitLines = lines.filter((l) => l.includes("[FROST]") && l.includes("Commit collected"));
    expect(commitLines.length).toBeGreaterThanOrEqual(1);
    for (const line of commitLines) assertLogLine(line);
    // Verify k/n format in at least one commit line
    expect(commitLines.some((l) => /Commit collected \(\d+\/\d+\)/.test(l))).toBe(true);

    // [FROST] Partial sig collected — at least threshold count
    const partialSigLines = lines.filter((l) => l.includes("[FROST]") && l.includes("Partial sig collected"));
    expect(partialSigLines.length).toBeGreaterThanOrEqual(1);
    for (const line of partialSigLines) assertLogLine(line);
    // Verify k/n format in at least one partial sig line
    expect(partialSigLines.some((l) => /Partial sig collected \(\d+\/\d+\)/.test(l))).toBe(true);

    // [SESS] Assignment issued
    const assignLine = lines.find((l) => l.includes("[SESS]") && l.includes("Assignment issued"));
    expect(assignLine).toBeDefined();
    assertLogLine(assignLine!);

    // Verify order: Session request < Ceremony begin < first Commit < first Partial sig < Assignment issued
    const sessReqIdx = lines.indexOf(sessReqLine!);
    const ceremonyIdx = lines.indexOf(ceremonyLine!);
    const firstCommitIdx = lines.indexOf(commitLines[0]!);
    const firstPartialIdx = lines.indexOf(partialSigLines[0]!);
    const assignIdx = lines.indexOf(assignLine!);
    expect(sessReqIdx).toBeLessThan(ceremonyIdx);
    expect(ceremonyIdx).toBeLessThan(firstCommitIdx);
    expect(firstCommitIdx).toBeLessThan(firstPartialIdx);
    expect(firstPartialIdx).toBeLessThan(assignIdx);
  }, 30_000);
});

// ─── AC-009: Seal ceremony lines ─────────────────────────────────────────────

describe("AC-009: seal ceremony lines — Initiating seal → FROST seal ceremony → Sealed", () => {
  it("[SEAL] Initiating seal → [SEAL] FROST seal ceremony → [SEAL] Sealed appear during seal", async () => {
    const fix = await createSessionFixture();
    fix.directory.registerThresholdSigner(fix.agentA.pubkeyHex, fix.signerA);
    scope.addCleanup(fix.stopAll);

    const sessionResult = await fix.agentA.client.initiateSession(fix.agentB.pubkeyHex, { timeoutMs: 15_000 });
    if (!sessionResult.ok) throw new Error(`initiateSession failed: ${sessionResult.reason}`);
    const sessionIdHex = Buffer.from(sessionResult.sessionId).toString("hex");

    // Send a few messages
    for (let i = 0; i < 3; i++) {
      await fix.agentA.client.sendMessage(sessionIdHex, Buffer.from(`msg${i + 1}`));
    }
    // Wait for messages to arrive at B
    await waitFor(() => {
      const msgs = fix.agentB.client.receiveMessage(sessionIdHex);
      return msgs !== null;
    }, { timeout: 10_000, interval: 50 });

    const cap = captureStdout();
    try {
      // A initiates seal
      await fix.agentA.client.initiateSessionSeal(sessionIdHex);
    } finally {
      cap.restore();
    }

    const lines = cap.lines();

    // [SEAL] Initiating seal
    const initLine = lines.find((l) => l.includes("[SEAL]") && l.includes("Initiating seal"));
    expect(initLine).toBeDefined();
    assertLogLine(initLine!);

    // [SEAL] FROST seal ceremony
    const frostLine = lines.find((l) => l.includes("[SEAL]") && l.includes("FROST seal ceremony"));
    expect(frostLine).toBeDefined();
    assertLogLine(frostLine!);

    // [SEAL] Sealed
    const sealedLine = lines.find((l) => l.includes("[SEAL]") && l.includes("Sealed"));
    expect(sealedLine).toBeDefined();
    assertLogLine(sealedLine!);
  }, 60_000);
});

// ─── AC-010: Relay lifecycle lines ────────────────────────────────────────────

describe("AC-010: relay lifecycle lines — Session assigned → Client joined → Seal submitted → Seal confirmed", () => {
  it("[RELAY] Session assigned and Client joined lines appear on stdout", async () => {
    const fix = await createSessionFixture();
    fix.directory.registerThresholdSigner(fix.agentA.pubkeyHex, fix.signerA);
    scope.addCleanup(fix.stopAll);

    const cap = captureStdout();
    try {
      const result = await fix.agentA.client.initiateSession(fix.agentB.pubkeyHex, { timeoutMs: 15_000 });
      if (!result.ok) throw new Error(`initiateSession failed: ${result.reason}`);

      const sessionIdHex = Buffer.from(result.sessionId).toString("hex");

      // Wait for B to have the session
      await waitFor(() => {
        const sessions = fix.agentB.client.listSessions();
        return sessions.some((s) => Buffer.from(s.session_id).toString("hex") === sessionIdHex);
      }, { timeout: 10_000, interval: 50 });

      // Send a message and seal
      await fix.agentA.client.sendMessage(sessionIdHex, Buffer.from("hello"));
      await waitFor(() => fix.agentB.client.receiveMessage(sessionIdHex) !== null, { timeout: 10_000, interval: 50 });
      await fix.agentA.client.initiateSessionSeal(sessionIdHex);
    } finally {
      cap.restore();
    }

    const lines = cap.lines();

    // [RELAY] Session assigned
    const assignedLine = lines.find((l) => l.includes("[RELAY]") && l.includes("Session assigned"));
    expect(assignedLine).toBeDefined();
    assertLogLine(assignedLine!);

    // [RELAY] Client joined (A or B joining)
    const joinedLine = lines.find((l) => l.includes("[RELAY]") && l.includes("joined session"));
    expect(joinedLine).toBeDefined();
    assertLogLine(joinedLine!);

    // [RELAY] Seal submitted
    const sealSubmittedLine = lines.find((l) => l.includes("[RELAY]") && l.includes("Seal submitted"));
    expect(sealSubmittedLine).toBeDefined();
    assertLogLine(sealSubmittedLine!);

    // [RELAY] Seal confirmed
    const sealConfirmedLine = lines.find((l) => l.includes("[RELAY]") && l.includes("Seal confirmed"));
    expect(sealConfirmedLine).toBeDefined();
    assertLogLine(sealConfirmedLine!);
  }, 60_000);
});

// ─── AC-011: Full M3 flow — all expected lines ────────────────────────────────

describe("AC-011: E2E — full M3 flow produces all expected directory + relay log lines", () => {
  it("complete flow produces all key log prefixes with correct format", async () => {
    // register: true runs real DKG, which installs the ClientDelegatedSigner on the directory.
    // Do NOT call registerThresholdSigner after this — it would overwrite the DKG signer.
    const fix = await createSessionFixture({ register: true });
    scope.addCleanup(fix.stopAll);

    const mlDsaA = await mlDsaKeygen();
    const packageCborA = await buildMinimalPackageCbor(fix.agentA.kp, mlDsaA, fix.agentA.primaryPubkey);

    const cap = captureStdout();
    try {
      // 1. Connection request flow
      const connResult = await fix.agentA.client.cello_request_connection({
        target_pubkey: fix.agentB.pubkeyHex,
        package_cbor: packageCborA,
      });
      expect(connResult.result).toBe("established");

      // 2. Session establishment (connection is already tracked in client's connections map)
      const sessionResult = await fix.agentA.client.initiateSession(
        fix.agentB.pubkeyHex,
        { timeoutMs: 15_000 },
      );
      if (!sessionResult.ok) throw new Error(`initiateSession failed: ${sessionResult.reason}`);
      const sessionIdHex = Buffer.from(sessionResult.sessionId).toString("hex");

      // 3. Message exchange
      await fix.agentA.client.sendMessage(sessionIdHex, Buffer.from("hello from A"));
      await waitFor(
        () => fix.agentB.client.receiveMessage(sessionIdHex) !== null,
        { timeout: 10_000, interval: 50 },
      );

      // 4. Seal
      await fix.agentA.client.initiateSessionSeal(sessionIdHex);
    } finally {
      cap.restore();
    }

    const lines = cap.lines();

    // Verify all log lines have correct format
    const celloLines = lines.filter((l) => LOG_LINE_RE.test(l));
    expect(celloLines.length).toBeGreaterThan(0);
    for (const line of celloLines) {
      assertLogLine(line);
    }

    // All expected prefixes appear
    expect(lines.some((l) => l.includes("[CONN]"))).toBe(true);
    expect(lines.some((l) => l.includes("[SESS]"))).toBe(true);
    expect(lines.some((l) => l.includes("[RELAY]"))).toBe(true);
    expect(lines.some((l) => l.includes("[SEAL]"))).toBe(true);
  }, 90_000);
});

// ─── SI-001 + SI-002: Security invariants ─────────────────────────────────────

describe("SI-001 + SI-002: security invariants — no private material, no full-length values", () => {
  it("no log line contains 32-byte hex strings or private key material", async () => {
    const fix = await createSessionFixture();
    fix.directory.registerThresholdSigner(fix.agentA.pubkeyHex, fix.signerA);
    scope.addCleanup(fix.stopAll);

    const cap = captureStdout();
    try {
      const result = await fix.agentA.client.initiateSession(fix.agentB.pubkeyHex, { timeoutMs: 15_000 });
      if (!result.ok) throw new Error(`initiateSession failed: ${result.reason}`);
    } finally {
      cap.restore();
    }

    const lines = cap.lines();
    const celloLines = lines.filter((l) => LOG_LINE_RE.test(l));

    for (const line of celloLines) {
      // SI-002: no full 32-byte (64 hex char) values
      expect(line).not.toMatch(/\b[0-9a-f]{64}\b/);
      // SI-001: no obvious private key markers
      expect(line.toLowerCase()).not.toContain("private");
      expect(line.toLowerCase()).not.toContain("secret");
      expect(line.toLowerCase()).not.toContain("share");
      expect(line.toLowerCase()).not.toContain("nonce");
    }
  }, 30_000);
});
