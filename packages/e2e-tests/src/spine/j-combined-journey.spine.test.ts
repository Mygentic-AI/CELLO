/**
 * J-COMBINED-JOURNEY — DOD-T4-JOURNEY-1: all four signal classes presented at once.
 *
 * Agent A holds phone + email + track_record + github envelopes (all seeded via pickup queue).
 * A presents to KNOWN-tier B. B sees all four signals with correct framing. A floor policy
 * demanding "≥1 identity proof" (phone OR email OR github) passes for A. A stranger C with
 * zero signals fails the same floor.
 *
 * This is the v1 close test: it exercises the full pipeline for every signal class in scope
 * (Class 1 identity: phone/email/github; Class 3 directory-computed: track_record).
 *
 * Run: pnpm --filter @cello-protocol/e2e-tests test:spine -- j-combined-journey
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
  AUTH_DIRECTORY_NODE_KEY_HEX,
  AUTH_DIRECTORY_NODE_ID,
  AUTH_DIRECTORY_NODE_PUBKEY,
  writeConsortiumManifest,
  type SpineCluster,
  type Proc,
  type McpConn,
  type ManifestEnv,
} from "./live-harness.js";

async function loadSealer(): Promise<{
  sealToRecipient: (pub: Uint8Array, plaintext: Uint8Array) => Uint8Array;
}> {
  const crypto = (await import(pathToFileURL(join(CELLO_CLIENT_ROOT, "core/crypto/dist/index.js")).href)) as {
    sealToRecipient: (pub: Uint8Array, plaintext: Uint8Array) => Uint8Array;
  };
  return { sealToRecipient: crypto.sealToRecipient };
}

// A hand-mirror of protocol-types' `TrustSignalEnvelope`, because the codec is dynamic-imported
// from CELLO_CLIENT_ROOT's dist rather than type-linked. The preimage is a CLOSED set of 12 slots:
// a slot missing HERE does not mint a shorter envelope — the encoder still refuses — it just moves
// the failure from a red typecheck to a runtime throw. Every slot the encoder knows about belongs.
interface Envelope {
  subject_kind: "account" | "agent"; subject: string; issuer_kind: "portal" | "agent"; issuer_pubkey: string;
  type: string; schema_version: number; payload: Uint8Array; issued_at: number;
  same_operator: boolean;
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
}> {
  const mod = (await import(pathToFileURL(join(CELLO_CLIENT_ROOT, "core/daemon/dist/signal-requirement-policy.js")).href)) as {
    evaluateSignalPolicy: (p: unknown, s: unknown) => { pass: boolean };
  };
  return mod as { evaluateSignalPolicy: (policy: { require_types?: string[]; require_issuer_kind?: string; min_count?: number }, signals: ReadonlyArray<{ type: string; issuerKind: string; verdict: string }>) => { pass: boolean } };
}

const hexToBytes = (h: string): Uint8Array => new Uint8Array(Buffer.from(h, "hex"));
const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");

let cluster: SpineCluster;
let manifestEnv: ManifestEnv;
const daemons: Proc[] = [];
const dirs: string[] = [];
const mcpConns: McpConn[] = [];

beforeAll(async () => {
  cluster = await startSpineCluster({ directoryNodeKeyHex: AUTH_DIRECTORY_NODE_KEY_HEX });
  manifestEnv = writeConsortiumManifest(cluster.tmpDir, "combined", [{
    nodeId: AUTH_DIRECTORY_NODE_ID,
    pubkey: AUTH_DIRECTORY_NODE_PUBKEY,
    region: "local",
    provider: "aws",
    endpoint: cluster.directoryUrl,
  }]);
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

describe("J-COMBINED-JOURNEY — DOD-T4-JOURNEY-1: all signal classes, v1 close", () => {
  it("A presents phone+email+track_record+github to KNOWN B; framing correct for every class; floor demands identity proof; C (stranger) fails", async () => {
    const accountId = `acct-combined-${randomBytes(8).toString("hex")}`;

    // ── Set up agents ──
    const dirA = mkdtempSync(join(tmpdir(), "cello-comb-A-"));
    const dirB = mkdtempSync(join(tmpdir(), "cello-comb-B-"));
    const dirC = mkdtempSync(join(tmpdir(), "cello-comb-C-"));
    dirs.push(dirA, dirB, dirC);

    const daemonA = await startDaemon(dirA, cluster.directoryUrl, "combA", { manifestEnv });
    const daemonB = await startDaemon(dirB, cluster.directoryUrl, "combB", { manifestEnv });
    const daemonC = await startDaemon(dirC, cluster.directoryUrl, "combC", { manifestEnv });
    daemons.push(daemonA, daemonB, daemonC);

    const createA = JSON.parse(cello(["create-agent", "alice"], { CELLO_DIR: dirA }).stdout) as { pubkey: string };
    const createB = JSON.parse(cello(["create-agent", "bob"], { CELLO_DIR: dirB }).stdout) as { pubkey: string };
    cello(["create-agent", "carol"], { CELLO_DIR: dirC });
    const pubA = createA.pubkey;
    const pubB = createB.pubkey;
    // An agent-subject signal's `subject` IS the subject agent's K_local pubkey — that is how the
    // directory joins it (`JOIN agent_profiles ap ON ap.k_local_pubkey = sr.subject`) and what the
    // portal writes at mint. This used to be a random `agent-combined-…` string, which no production
    // path ever produces; once the daemon began scoping presentation on the presenting agent's own
    // pubkey (DOD-END-SCOPE-FIX-1) that fixture matched nothing and this journey lost its
    // track_record. The fixture was the wrong one, not the scoping.
    const agentSubject = pubA;

    await waitConnected(dirA, "A");
    await waitConnected(dirB, "B");
    await waitConnected(dirC, "C");

    const devTag = (t: string) => `DEV-comb-${t}-${randomBytes(6).toString("hex")}`;
    expect(cello(["register-agent", "alice", devTag("A")], { CELLO_DIR: dirA }).status).toBe(0);
    expect(cello(["register-agent", "bob", devTag("B")], { CELLO_DIR: dirB }).status).toBe(0);
    expect(cello(["register-agent", "carol", devTag("C")], { CELLO_DIR: dirC }).status).toBe(0);

    const agentIdA = psqlSpine(`SELECT agent_id FROM agent_profiles WHERE k_local_pubkey = '${pubA}'`);
    expect(agentIdA).toMatch(/\S/);

    // ── Compose all four envelope types ──
    const { sealToRecipient } = await loadSealer();
    const { encodeTrustSignalEnvelope, hashTrustSignalEnvelope, encodeCbor } = await loadCodec();
    const issuerPubkey = "ab".repeat(32);

    const envelopes: Array<{ envelope: Envelope; kind: string; subjectKind: "account" | "agent"; subject: string }> = [
      // `same_operator: false` on all four, and it is a claim rather than boilerplate: every one of
      // these is issued by a PORTAL about a subject that is not the portal, which is exactly the
      // not-the-same-operator case the flag distinguishes. The field is MANDATORY — the envelope
      // preimage is a closed set of 12 slots (M10-D17) — and it was appended after this test was
      // written, so the encoder refused outright rather than producing a differently-hashed
      // envelope that would have failed verification somewhere further downstream.
      {
        kind: "phone", subjectKind: "account", subject: accountId,
        envelope: {
          subject_kind: "account", subject: accountId,
          issuer_kind: "portal", issuer_pubkey: issuerPubkey, type: "phone", schema_version: 1,
          payload: encodeCbor({ claim: "Phone verified via SMS OTP.", country_code: "US" }),
          issued_at: 1_700_000_000, same_operator: false, expires_at: null, supersedes_hash: null,
        },
      },
      {
        kind: "email", subjectKind: "account", subject: accountId,
        envelope: {
          subject_kind: "account", subject: accountId,
          issuer_kind: "portal", issuer_pubkey: issuerPubkey, type: "email", schema_version: 1,
          payload: encodeCbor({ claim: "Email verified via magic link.", domain: "example.com" }),
          issued_at: 1_700_000_000, same_operator: false, expires_at: null, supersedes_hash: null,
        },
      },
      {
        kind: "github", subjectKind: "account", subject: accountId,
        envelope: {
          subject_kind: "account", subject: accountId,
          issuer_kind: "portal", issuer_pubkey: issuerPubkey, type: "github", schema_version: 1,
          payload: encodeCbor({ claim: "GitHub account ownership verified via OAuth.", username: "testuser", account_age_days: 3650, public_repos: 42, followers: 100 }),
          issued_at: 1_700_000_000, same_operator: false, expires_at: null, supersedes_hash: null,
        },
      },
      {
        kind: "track_record", subjectKind: "agent", subject: agentSubject,
        envelope: {
          subject_kind: "agent", subject: agentSubject,
          issuer_kind: "portal", issuer_pubkey: issuerPubkey, type: "track_record", schema_version: 1,
          payload: encodeCbor({ claim: "Agent track record: 20 sessions, 95% clean-close.", session_count: 20, clean_close_rate: 0.95 }),
          issued_at: 1_700_000_000, same_operator: false, expires_at: null, supersedes_hash: null,
        },
      },
    ];

    // Encode, hash, seal, and register all four
    const prepared = envelopes.map(({ envelope, kind, subjectKind, subject }) => {
      const envBytes = encodeTrustSignalEnvelope(envelope);
      const hash = hex(hashTrustSignalEnvelope(envelope));
      const sealedHex = hex(sealToRecipient(hexToBytes(pubA), envBytes));
      return { kind, subjectKind, subject, hash, sealedHex };
    });

    // Insert all into signal_records
    const signalRecordsValues = prepared.map((p) =>
      // NO `subject` — the directory dropped that column deliberately. It is federated and possibly
      // public, so it notarizes the signal HASH and the subject KIND and never retains what the
      // subject IS. The subject still travels inside the envelope's hashed preimage.
      `('${p.hash}', 'local', '${p.subjectKind}', 'portal', '${issuerPubkey}', '${p.kind}', 'active', 'test-v0')`
    ).join(", ");
    psqlSpine(
      `INSERT INTO signal_records (signal_hash, accepting_node, subject_kind, issuer_kind, issuer_pubkey, type, status, scanner_version) VALUES ${signalRecordsValues}`,
    );

    // Insert all into pickup_queue (using different signal_kind to avoid unique constraint)
    for (const p of prepared) {
      psqlSpine(
        `INSERT INTO pickup_queue (agent_id, signal_kind, ciphertext, signal_hash) ` +
        `VALUES ('${agentIdA}', '${p.kind}', decode('${p.sealedHex}', 'hex'), '${p.hash}')`,
      );
    }

    // Restart A to pick up all signals
    await daemonA.stop();
    const daemonA2 = await startDaemon(dirA, cluster.directoryUrl, "combA2", { manifestEnv });
    daemons.push(daemonA2);

    const connA = await connectMcp(dirA, "comb-A");
    mcpConns.push(connA);
    expect(((await connA.call("cello_start_agent", { name: "alice" })) as { ok?: boolean }).ok).toBe(true);
    await waitConnected(dirA, "A2");
    await daemonA2.waitForLine(/daemon\.trust_signal\.received/, 25_000);
    await new Promise((r) => setTimeout(r, 3000));

    // A adds B as KNOWN
    expect(((await connA.call("cello_contact_add", { pubkey: pubB })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connA.call("cello_use_agent", { name: "alice" })) as { ok?: boolean }).ok).toBe(true);

    // ── POSITIVE: A → B with all four signals ──
    const connB = await connectMcp(dirB, "comb-B");
    mcpConns.push(connB);
    expect(((await connB.call("cello_start_agent", { name: "bob" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connB.call("cello_use_agent", { name: "bob" })) as { ok?: boolean }).ok).toBe(true);

    const awaitB = connB.call("cello_await_session", { timeout_ms: 30_000 });
    const initA = (await connA.call("cello_initiate_session", { target_pubkey: pubB })) as { ok?: boolean };
    expect(initA.ok, `initiate failed: ${JSON.stringify(initA)}`).toBe(true);

    const inbound = (await awaitB) as {
      type?: string;
      trust_signals?: Array<{ type: string; issuer: string; claim: unknown }>;
    };
    expect(inbound.type).toBe("new_session");
    expect(inbound.trust_signals, "B must see all four signals from A").toBeDefined();
    expect(inbound.trust_signals!.length).toBe(4);

    // Verify framing for every class
    const types = inbound.trust_signals!.map((s) => s.type).sort();
    expect(types).toEqual(["email", "github", "phone", "track_record"]);

    for (const sig of inbound.trust_signals!) {
      expect(sig.issuer).toBe("platform-verified");
      expect(sig.claim).toBeTruthy();
    }

    // Verify class-specific claim content
    const phoneSig = inbound.trust_signals!.find((s) => s.type === "phone")!;
    expect((phoneSig.claim as Record<string, unknown>).country_code).toBe("US");

    const emailSig = inbound.trust_signals!.find((s) => s.type === "email")!;
    expect((emailSig.claim as Record<string, unknown>).domain).toBe("example.com");

    const githubSig = inbound.trust_signals!.find((s) => s.type === "github")!;
    expect((githubSig.claim as Record<string, unknown>).username).toBe("testuser");
    expect((githubSig.claim as Record<string, unknown>).account_age_days).toBe(3650);
    expect((githubSig.claim as Record<string, unknown>).public_repos).toBe(42);

    const trackSig = inbound.trust_signals!.find((s) => s.type === "track_record")!;
    expect((trackSig.claim as Record<string, unknown>).session_count).toBe(20);
    expect((trackSig.claim as Record<string, unknown>).clean_close_rate).toBe(0.95);

    // ── FLOOR: policy demands ≥1 identity proof (phone/email/github) ──
    const { evaluateSignalPolicy } = await loadFloorPolicy();
    const identityProofPolicy = { require_types: ["phone", "email", "github"], min_count: 1 };

    const aSignalsForFloor = inbound.trust_signals!.map((s) => ({
      type: s.type, issuerKind: "portal" as const, verdict: "active" as const,
    }));
    const floorA = evaluateSignalPolicy(identityProofPolicy, aSignalsForFloor);
    expect(floorA.pass, "A with phone+email+github must pass identity-proof floor").toBe(true);

    // ── NEGATIVE: C (stranger, no signals) → B ──
    const connC = await connectMcp(dirC, "comb-C");
    mcpConns.push(connC);
    expect(((await connC.call("cello_start_agent", { name: "carol" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connC.call("cello_use_agent", { name: "carol" })) as { ok?: boolean }).ok).toBe(true);

    const awaitB2 = connB.call("cello_await_session", { timeout_ms: 30_000 });
    const initC = (await connC.call("cello_initiate_session", { target_pubkey: pubB })) as { ok?: boolean };
    expect(initC.ok, `C initiate failed: ${JSON.stringify(initC)}`).toBe(true);

    const inboundC = (await awaitB2) as {
      type?: string;
      trust_signals?: Array<{ type: string; issuer: string; claim: unknown }>;
    };
    expect(inboundC.type).toBe("new_session");
    expect(inboundC.trust_signals, "B must see NO signals from stranger C").toBeUndefined();

    // Floor: C with zero signals fails
    const floorC = evaluateSignalPolicy(identityProofPolicy, []);
    expect(floorC.pass, "C with zero signals must FAIL identity-proof floor").toBe(false);
  }, 300_000);
});
