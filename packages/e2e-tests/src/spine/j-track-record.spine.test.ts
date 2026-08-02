/**
 * J-TRACK-RECORD — DOD-T3-JOURNEY-1: live track-record supersession journey.
 *
 * Agent A holds a track_record v1 envelope. A presents to KNOWN-tier B — B sees it. Then A
 * receives track_record v2 (supersedes v1). A presents again — B sees ONLY v2 (the directory's
 * checkPresentedSignals strips v1 because signal_records_effective shows 'superseded'). This
 * proves: supersession is directory-enforced, not daemon-enforced; the daemon presents everything
 * active in its wallet, but the directory gates on notarization status.
 *
 * Run: pnpm --filter @cello-protocol/e2e-tests test:spine -- j-track-record
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
  hash: (d: Uint8Array) => Uint8Array;
}> {
  const crypto = (await import(pathToFileURL(join(CELLO_CLIENT_ROOT, "core/crypto/dist/index.js")).href)) as {
    sealToRecipient: (pub: Uint8Array, plaintext: Uint8Array) => Uint8Array;
    hash: (d: Uint8Array) => Uint8Array;
  };
  return { sealToRecipient: crypto.sealToRecipient, hash: crypto.hash };
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

const hexToBytes = (h: string): Uint8Array => new Uint8Array(Buffer.from(h, "hex"));
const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");

let cluster: SpineCluster;
let manifestEnv: ManifestEnv;
const daemons: Proc[] = [];
const dirs: string[] = [];
const mcpConns: McpConn[] = [];

beforeAll(async () => {
  cluster = await startSpineCluster({ directoryNodeKeyHex: AUTH_DIRECTORY_NODE_KEY_HEX });
  manifestEnv = writeConsortiumManifest(cluster.tmpDir, "track", [{
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

describe("J-TRACK-RECORD — DOD-T3-JOURNEY-1: track-record supersession live journey", () => {
  it("A presents track_record v1; after supersession, A presents again → B sees only v2 (stale v1 stripped by directory)", async () => {

    // ── Set up two agents: A (holder), B (recipient) ──
    const dirA = mkdtempSync(join(tmpdir(), "cello-track-A-"));
    const dirB = mkdtempSync(join(tmpdir(), "cello-track-B-"));
    dirs.push(dirA, dirB);

    const daemonA = await startDaemon(dirA, cluster.directoryUrl, "trackA", { manifestEnv });
    const daemonB = await startDaemon(dirB, cluster.directoryUrl, "trackB", { manifestEnv });
    daemons.push(daemonA, daemonB);

    const createA = JSON.parse(cello(["create-agent", "alpha"], { CELLO_DIR: dirA }).stdout) as { pubkey: string };
    const createB = JSON.parse(cello(["create-agent", "beta"], { CELLO_DIR: dirB }).stdout) as { pubkey: string };
    const pubA = createA.pubkey;
    const pubB = createB.pubkey;
    // An agent-subject signal's `subject` IS the subject agent's K_local pubkey — that is how the
    // directory joins it (`JOIN agent_profiles ap ON ap.k_local_pubkey = sr.subject`) and what the
    // portal writes at mint. This used to be a random `agent-…` string, which no production path
    // ever produces; once the daemon began scoping presentation on the presenting agent's own pubkey
    // (DOD-END-SCOPE-FIX-1) that fixture matched nothing and this journey presented no track_record
    // at all. The fixture was the wrong one, not the scoping.
    const agentSubject = pubA;

    await waitConnected(dirA, "A");
    await waitConnected(dirB, "B");

    const devTag = (t: string) => `DEV-track-${t}-${randomBytes(6).toString("hex")}`;
    expect(cello(["register-agent", "alpha", devTag("A")], { CELLO_DIR: dirA }).status).toBe(0);
    expect(cello(["register-agent", "beta", devTag("B")], { CELLO_DIR: dirB }).status).toBe(0);

    const agentIdA = psqlSpine(`SELECT agent_id FROM agent_profiles WHERE k_local_pubkey = '${pubA}'`);
    expect(agentIdA).toMatch(/\S/);

    // ── Compose track_record v1 ──
    const { sealToRecipient } = await loadSealer();
    const { encodeTrustSignalEnvelope, hashTrustSignalEnvelope, encodeCbor } = await loadCodec();

    const v1Envelope: Envelope = {
      subject_kind: "agent", subject: agentSubject,
      issuer_kind: "portal", issuer_pubkey: "ab".repeat(32), type: "track_record", schema_version: 1,
      payload: encodeCbor({
        claim: "This agent has completed 5 sessions with a 100% clean-close rate.",
        session_count: 5,
        clean_close_rate: 1.0,
      }),
      // MANDATORY (M10-D17): the envelope preimage is a CLOSED set of 12 slots, and
      // `same_operator` was appended to it after this test was written — so the encoder refuses
      // outright rather than minting a differently-hashed envelope that would fail verification
      // later, somewhere else. FALSE is a claim, not filler: the issuer is a PORTAL attesting about
      // a subject that is not the portal, which is exactly the case the flag distinguishes.
      issued_at: 1_700_000_000, same_operator: false, expires_at: null, supersedes_hash: null,
    };

    const v1EnvBytes = encodeTrustSignalEnvelope(v1Envelope);
    const v1Hash = hex(hashTrustSignalEnvelope(v1Envelope));
    const v1SealedHex = hex(sealToRecipient(hexToBytes(pubA), v1EnvBytes));

    // Register v1 in signal_records and deliver to A
    psqlSpine(
      // NO `subject` column — dropped from the directory's ledger deliberately. A federated,
      // possibly-public directory notarizes the signal HASH and the subject KIND, never what the
      // subject IS; the subject rides inside the envelope's hashed preimage.
      `INSERT INTO signal_records (signal_hash, accepting_node, subject_kind, issuer_kind, issuer_pubkey, type, status, scanner_version) ` +
      `VALUES ('${v1Hash}', 'local', 'agent', 'portal', '${"ab".repeat(32)}', 'track_record', 'active', 'test-v0')`,
    );
    psqlSpine(
      `INSERT INTO pickup_queue (agent_id, signal_kind, ciphertext, signal_hash) ` +
      `VALUES ('${agentIdA}', 'track_record', decode('${v1SealedHex}', 'hex'), '${v1Hash}')`,
    );

    // Restart A to pick up v1
    await daemonA.stop();
    const daemonA2 = await startDaemon(dirA, cluster.directoryUrl, "trackA2", { manifestEnv });
    daemons.push(daemonA2);

    const connA = await connectMcp(dirA, "track-A");
    mcpConns.push(connA);
    expect(((await connA.call("cello_start_agent", { name: "alpha" })) as { ok?: boolean }).ok).toBe(true);
    await waitConnected(dirA, "A2");
    await daemonA2.waitForLine(/daemon\.trust_signal\.received/, 25_000);

    // A adds B as KNOWN
    expect(((await connA.call("cello_contact_add", { pubkey: pubB })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connA.call("cello_use_agent", { name: "alpha" })) as { ok?: boolean }).ok).toBe(true);

    // ── FIRST PRESENTATION: A→B with v1 ──
    const connB = await connectMcp(dirB, "track-B");
    mcpConns.push(connB);
    expect(((await connB.call("cello_start_agent", { name: "beta" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connB.call("cello_use_agent", { name: "beta" })) as { ok?: boolean }).ok).toBe(true);

    const awaitB1 = connB.call("cello_await_session", { timeout_ms: 30_000 });
    const init1 = (await connA.call("cello_initiate_session", { target_pubkey: pubB })) as { ok?: boolean };
    expect(init1.ok, `first initiate failed: ${JSON.stringify(init1)}`).toBe(true);

    const inbound1 = (await awaitB1) as {
      type?: string;
      trust_signals?: Array<{ type: string; issuer: string; claim: unknown }>;
    };
    expect(inbound1.type).toBe("new_session");
    expect(inbound1.trust_signals, "B must see v1 track_record").toBeDefined();
    expect(inbound1.trust_signals!.length).toBe(1);
    expect(inbound1.trust_signals![0].type).toBe("track_record");
    expect((inbound1.trust_signals![0].claim as Record<string, unknown>).session_count).toBe(5);

    // ── SUPERSESSION: compose v2 pointing to v1, submit (auto-supersedes v1 in directory) ──
    const v2Envelope: Envelope = {
      subject_kind: "agent", subject: agentSubject,
      issuer_kind: "portal", issuer_pubkey: "ab".repeat(32), type: "track_record", schema_version: 1,
      payload: encodeCbor({
        claim: "This agent has completed 12 sessions with a 92% clean-close rate.",
        session_count: 12,
        clean_close_rate: 0.92,
      }),
      issued_at: 1_700_100_000, same_operator: false, expires_at: null,
      supersedes_hash: new Uint8Array(Buffer.from(v1Hash, "hex")),
    };

    const v2EnvBytes = encodeTrustSignalEnvelope(v2Envelope);
    const v2Hash = hex(hashTrustSignalEnvelope(v2Envelope));
    const v2SealedHex = hex(sealToRecipient(hexToBytes(pubA), v2EnvBytes));

    // Insert v2 into signal_records WITH supersedes_hash — DOD-SUPERSEDE-1 materializes
    // the old row to 'superseded'.
    psqlSpine(
      `INSERT INTO signal_records (signal_hash, accepting_node, subject_kind, issuer_kind, issuer_pubkey, type, status, scanner_version, supersedes_hash) ` +
      `VALUES ('${v2Hash}', 'local', 'agent', 'portal', '${"ab".repeat(32)}', 'track_record', 'active', 'test-v0', '${v1Hash}')`,
    );

    // Verify the supersession materialized: v1 is now 'superseded'
    const v1Status = psqlSpine(`SELECT effective_status FROM signal_records_effective WHERE signal_hash = '${v1Hash}'`);
    expect(v1Status, "v1 must be superseded after v2 submission").toBe("superseded");
    const v2Status = psqlSpine(`SELECT effective_status FROM signal_records_effective WHERE signal_hash = '${v2Hash}'`);
    expect(v2Status, "v2 must be active").toBe("active");

    // Deliver v2 to A's wallet
    psqlSpine(
      `INSERT INTO pickup_queue (agent_id, signal_kind, ciphertext, signal_hash) ` +
      `VALUES ('${agentIdA}', 'track_record', decode('${v2SealedHex}', 'hex'), '${v2Hash}')`,
    );

    // Restart A to pick up v2 (wallet now holds both v1 and v2 as 'active' locally)
    await daemonA2.stop();
    const daemonA3 = await startDaemon(dirA, cluster.directoryUrl, "trackA3", { manifestEnv });
    daemons.push(daemonA3);

    const connA2 = await connectMcp(dirA, "track-A2");
    mcpConns.push(connA2);
    expect(((await connA2.call("cello_start_agent", { name: "alpha" })) as { ok?: boolean }).ok).toBe(true);
    await waitConnected(dirA, "A3");
    await daemonA3.waitForLine(/daemon\.trust_signal\.received/, 25_000);

    expect(((await connA2.call("cello_use_agent", { name: "alpha" })) as { ok?: boolean }).ok).toBe(true);

    // ── SECOND PRESENTATION: A→B again — A's wallet presents BOTH hashes (v1 + v2),
    //    but the directory strips v1 (superseded) and forwards only v2 ──
    const awaitB2 = connB.call("cello_await_session", { timeout_ms: 30_000 });
    const init2 = (await connA2.call("cello_initiate_session", { target_pubkey: pubB })) as { ok?: boolean };
    expect(init2.ok, `second initiate failed: ${JSON.stringify(init2)}`).toBe(true);

    const inbound2 = (await awaitB2) as {
      type?: string;
      trust_signals?: Array<{ type: string; issuer: string; claim: unknown }>;
    };
    expect(inbound2.type).toBe("new_session");
    expect(inbound2.trust_signals, "B must see v2 track_record after supersession").toBeDefined();
    expect(inbound2.trust_signals!.length, "only v2 should survive (v1 stripped)").toBe(1);
    expect(inbound2.trust_signals![0].type).toBe("track_record");
    expect((inbound2.trust_signals![0].claim as Record<string, unknown>).session_count).toBe(12);
    expect((inbound2.trust_signals![0].claim as Record<string, unknown>).clean_close_rate).toBe(0.92);
  }, 300_000);
});
