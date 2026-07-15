/**
 * J-TRUST-JOURNEY — DOD-T2-JOURNEY-1: live end-to-end trust signal presentation + consumption.
 *
 * Agent A holds phone+email envelopes (seeded via the pickup queue as in j-trust). A adds B as
 * KNOWN tier (signals present only to KNOWN+). A initiates a session with B. B's daemon verifies
 * the presented signals, stores them in contact_trust_signals, and returns them in the
 * cello_await_session response as the DOD-CONSUME-1 JSON projection (the LLM-facing framing).
 *
 * Negative case: agent C (no wallet signals) initiates with B. B's cello_await_session returns
 * NO trust_signals. The DOD-FLOOR-1 evaluateSignalPolicy with DEFAULT_UNKNOWN_POLICY rejects C
 * (a stranger with zero portal-attested signals fails the floor).
 *
 * Run: pnpm --filter @cello-protocol/e2e-tests test:spine -- j-trust-journey
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import {
  startSpineCluster,
  startDaemon,
  connectMcp,
  cello,
  psqlSpine,
  CELLO_CLIENT_ROOT,
  type SpineCluster,
  type Proc,
  type McpConn,
} from "./live-harness.js";

async function loadSealer(): Promise<{
  sealToRecipient: (pub: Uint8Array, plaintext: Uint8Array) => Uint8Array;
  hash: (d: Uint8Array) => Uint8Array;
}> {
  const crypto = (await import(pathToFileURL(join(CELLO_CLIENT_ROOT, "core/crypto/dist/index.js")).href)) as {
    sealToRecipient: (pub: Uint8Array, plaintext: Uint8Array) => Uint8Array;
    hash: (d: Uint8Array) => Uint8Array;
  };
  return { sealToRecipient: crypto.sealToRecipient, hash: crypto.hash };
}

interface Envelope {
  subject_kind: "account" | "agent"; subject: string; issuer_kind: "portal" | "agent"; issuer_pubkey: string;
  type: string; schema_version: number; payload: Uint8Array; issued_at: number;
  expires_at: number | null; supersedes_hash: Uint8Array | null;
}
async function loadCodec(): Promise<{
  encodeTrustSignalEnvelope: (e: Envelope) => Uint8Array;
  hashTrustSignalEnvelope: (e: Envelope) => Uint8Array;
  encodeCbor: (v: unknown) => Uint8Array;
}> {
  const pt = (await import(pathToFileURL(join(CELLO_CLIENT_ROOT, "core/protocol-types/dist/index.js")).href)) as {
    encodeTrustSignalEnvelope: (e: Envelope) => Uint8Array;
    hashTrustSignalEnvelope: (e: Envelope) => Uint8Array;
    encodeCbor: (v: unknown) => Uint8Array;
  };
  return { encodeTrustSignalEnvelope: pt.encodeTrustSignalEnvelope, hashTrustSignalEnvelope: pt.hashTrustSignalEnvelope, encodeCbor: pt.encodeCbor };
}

async function loadFloorPolicy(): Promise<{
  evaluateSignalPolicy: (policy: { require_types?: string[]; require_issuer_kind?: string; min_count?: number }, signals: ReadonlyArray<{ type: string; issuerKind: string; verdict: string }>) => { pass: boolean };
  DEFAULT_UNKNOWN_POLICY: { require_types?: string[]; require_issuer_kind?: string; min_count?: number };
}> {
  const mod = (await import(pathToFileURL(join(CELLO_CLIENT_ROOT, "core/daemon/dist/signal-requirement-policy.js")).href)) as {
    evaluateSignalPolicy: (p: unknown, s: unknown) => { pass: boolean };
    DEFAULT_UNKNOWN_POLICY: { require_types?: string[]; require_issuer_kind?: string; min_count?: number };
  };
  return mod as ReturnType<typeof loadFloorPolicy> extends Promise<infer T> ? T : never;
}

const hexToBytes = (h: string): Uint8Array => new Uint8Array(Buffer.from(h, "hex"));
const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");

let cluster: SpineCluster;
const daemons: Proc[] = [];
const dirs: string[] = [];
const mcpConns: McpConn[] = [];

beforeAll(async () => {
  cluster = await startSpineCluster({});
}, 180_000);

afterAll(async () => {
  for (const c of mcpConns) await c.close();
  for (const d of daemons) await d.stop();
  await cluster?.stop();
  for (const dir of dirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

type Status = { directory_signaling?: string };
const agentStatus = (dir: string): Status => JSON.parse(cello(["status"], { CELLO_DIR: dir }).stdout) as Status;
const waitConnected = async (dir: string, label: string): Promise<void> => {
  for (let i = 0; i < 50; i++) {
    if ((agentStatus(dir).directory_signaling ?? "") === "connected") return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`directory_signaling never connected (${label})`);
};

describe("J-TRUST-JOURNEY — DOD-T2-JOURNEY-1: live signal presentation→consumption→floor", () => {
  it("A (phone+email holder) presents to KNOWN contact B; B sees correct framing; C (stranger, no signals) fails the floor", async () => {
    const accountId = `acct-${randomBytes(8).toString("hex")}`;

    // ── Set up three agents: A (signal holder), B (recipient), C (stranger) ──
    const dirA = mkdtempSync(join(tmpdir(), "cello-jrny-A-"));
    const dirB = mkdtempSync(join(tmpdir(), "cello-jrny-B-"));
    const dirC = mkdtempSync(join(tmpdir(), "cello-jrny-C-"));
    dirs.push(dirA, dirB, dirC);

    // Daemons must run BEFORE create-agent (the CLI calls the daemon over IPC).
    const daemonA = await startDaemon(dirA, cluster.directoryUrl, "jrnyA");
    const daemonB = await startDaemon(dirB, cluster.directoryUrl, "jrnyB");
    const daemonC = await startDaemon(dirC, cluster.directoryUrl, "jrnyC");
    daemons.push(daemonA, daemonB, daemonC);

    const createA = JSON.parse(cello(["create-agent", "alice"], { CELLO_DIR: dirA }).stdout) as { pubkey: string };
    const createB = JSON.parse(cello(["create-agent", "bob"], { CELLO_DIR: dirB }).stdout) as { pubkey: string };
    const createC = JSON.parse(cello(["create-agent", "carol"], { CELLO_DIR: dirC }).stdout) as { pubkey: string };
    const pubA = createA.pubkey;
    const pubB = createB.pubkey;
    const pubC = createC.pubkey;

    await waitConnected(dirA, "A");
    await waitConnected(dirB, "B");
    await waitConnected(dirC, "C");

    const devTag = (t: string) => `DEV-jrny-${t}-${randomBytes(6).toString("hex")}`;
    expect(cello(["register-agent", "alice", devTag("A")], { CELLO_DIR: dirA }).status).toBe(0);
    expect(cello(["register-agent", "bob", devTag("B")], { CELLO_DIR: dirB }).status).toBe(0);
    expect(cello(["register-agent", "carol", devTag("C")], { CELLO_DIR: dirC }).status).toBe(0);

    // Get agent IDs from directory
    const agentIdA = psqlSpine(`SELECT agent_id FROM agent_profiles WHERE k_local_pubkey = '${pubA}'`);
    expect(agentIdA).toMatch(/\S/);

    // ── Seed A's wallet with phone + email envelopes (same pickup pattern as j-trust) ──
    const { sealToRecipient, hash } = await loadSealer();
    const { encodeTrustSignalEnvelope, hashTrustSignalEnvelope, encodeCbor } = await loadCodec();

    const phoneEnvelope: Envelope = {
      subject_kind: "account", subject: accountId,
      issuer_kind: "portal", issuer_pubkey: "ab".repeat(32), type: "phone", schema_version: 1,
      payload: encodeCbor({
        claim: "This operator verified ownership of a phone number via SMS OTP.",
        country_code: "US",
      }),
      issued_at: 1_700_000_000, expires_at: null, supersedes_hash: null,
    };
    const emailEnvelope: Envelope = {
      subject_kind: "account", subject: accountId,
      issuer_kind: "portal", issuer_pubkey: "ab".repeat(32), type: "email", schema_version: 1,
      payload: encodeCbor({
        claim: "This operator verified ownership of an email address via magic link.",
        domain: "example.com",
      }),
      issued_at: 1_700_000_000, expires_at: null, supersedes_hash: null,
    };

    const phoneEnvBytes = encodeTrustSignalEnvelope(phoneEnvelope);
    const phoneHash = hex(hashTrustSignalEnvelope(phoneEnvelope));
    const phoneSealedHex = hex(sealToRecipient(hexToBytes(pubA), phoneEnvBytes));

    const emailEnvBytes = encodeTrustSignalEnvelope(emailEnvelope);
    const emailHash = hex(hashTrustSignalEnvelope(emailEnvelope));
    const emailSealedHex = hex(sealToRecipient(hexToBytes(pubA), emailEnvBytes));

    psqlSpine(
      `INSERT INTO pickup_queue (agent_id, signal_kind, ciphertext, signal_hash) VALUES ` +
      `('${agentIdA}', 'phone', decode('${phoneSealedHex}', 'hex'), '${phoneHash}'), ` +
      `('${agentIdA}', 'email', decode('${emailSealedHex}', 'hex'), '${emailHash}')`,
    );

    // Restart A's daemon so it picks up the seeded signals on reconnect
    await daemonA.stop();
    const daemonA2 = await startDaemon(dirA, cluster.directoryUrl, "jrnyA2");
    daemons.push(daemonA2);

    const connA = await connectMcp(dirA, "jrny-A");
    mcpConns.push(connA);
    expect(((await connA.call("cello_start_agent", { name: "alice" })) as { ok?: boolean }).ok).toBe(true);
    await waitConnected(dirA, "A2");

    // Wait for A's daemon to receive+store the signals
    await daemonA2.waitForLine(/daemon\.trust_signal\.received/, 25_000);
    // A may log two received events — wait a bit for the second
    await new Promise((r) => setTimeout(r, 2000));

    // ── A adds B as KNOWN contact (so signals are presented to KNOWN+ tier) ──
    expect(((await connA.call("cello_contact_add", { pubkey: pubB })) as { ok?: boolean }).ok).toBe(true);

    // ── POSITIVE CASE: A initiates session with B; B sees the trust signals ──
    const connB = await connectMcp(dirB, "jrny-B");
    mcpConns.push(connB);
    expect(((await connB.call("cello_start_agent", { name: "bob" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connB.call("cello_use_agent", { name: "bob" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connA.call("cello_use_agent", { name: "alice" })) as { ok?: boolean }).ok).toBe(true);

    const awaitB = connB.call("cello_await_session", { timeout_ms: 30_000 });
    const initA = (await connA.call("cello_initiate_session", { target_pubkey: pubB })) as { ok?: boolean; sessionId?: string };
    expect(initA.ok, `initiate failed: ${JSON.stringify(initA)}`).toBe(true);

    const inbound = (await awaitB) as {
      type?: string;
      session_id?: string;
      trust_signals?: Array<{ type: string; issuer: string; claim: unknown }>;
    };
    expect(inbound.type).toBe("new_session");

    // DOD-CONSUME-1: trust_signals are present with correct framing
    expect(inbound.trust_signals, "B must see trust signals from A").toBeDefined();
    expect(inbound.trust_signals!.length).toBe(2);

    const types = inbound.trust_signals!.map((s) => s.type).sort();
    expect(types).toEqual(["email", "phone"]);

    // INV-FRAMING: portal-attested → "platform-verified"
    for (const sig of inbound.trust_signals!) {
      expect(sig.issuer).toBe("platform-verified");
      expect(sig.claim).toBeTruthy();
    }

    // Verify the claims contain the expected fields
    const phoneSig = inbound.trust_signals!.find((s) => s.type === "phone")!;
    expect((phoneSig.claim as Record<string, unknown>).country_code).toBe("US");
    const emailSig = inbound.trust_signals!.find((s) => s.type === "email")!;
    expect((emailSig.claim as Record<string, unknown>).domain).toBe("example.com");

    // DOD-FLOOR-1: evaluate the floor for A (has portal signals) → PASS
    const { evaluateSignalPolicy, DEFAULT_UNKNOWN_POLICY } = await loadFloorPolicy();
    const aSignalsForFloor = inbound.trust_signals!.map((s) => ({
      type: s.type,
      issuerKind: "portal" as const,
      verdict: "active" as const,
    }));
    const floorResultA = evaluateSignalPolicy(DEFAULT_UNKNOWN_POLICY, aSignalsForFloor);
    expect(floorResultA.pass, "A with phone+email must pass the DEFAULT_UNKNOWN floor").toBe(true);

    // ── NEGATIVE CASE: C (no signals, UNKNOWN tier) initiates with B ──
    const connC = await connectMcp(dirC, "jrny-C");
    mcpConns.push(connC);
    expect(((await connC.call("cello_start_agent", { name: "carol" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connC.call("cello_use_agent", { name: "carol" })) as { ok?: boolean }).ok).toBe(true);

    const awaitB2 = connB.call("cello_await_session", { timeout_ms: 30_000 });
    const initC = (await connC.call("cello_initiate_session", { target_pubkey: pubB })) as { ok?: boolean; sessionId?: string };
    expect(initC.ok, `C initiate failed: ${JSON.stringify(initC)}`).toBe(true);

    const inboundC = (await awaitB2) as {
      type?: string;
      session_id?: string;
      trust_signals?: Array<{ type: string; issuer: string; claim: unknown }>;
    };
    expect(inboundC.type).toBe("new_session");

    // C presented nothing (no wallet signals, UNKNOWN tier) → no trust_signals in B's response
    expect(
      inboundC.trust_signals,
      "B must see NO trust_signals from stranger C",
    ).toBeUndefined();

    // DOD-FLOOR-1 negative: evaluate the floor for C (zero signals) → FAIL
    const floorResultC = evaluateSignalPolicy(DEFAULT_UNKNOWN_POLICY, []);
    expect(floorResultC.pass, "C with zero signals must FAIL the DEFAULT_UNKNOWN floor").toBe(false);
  }, 300_000);
});
