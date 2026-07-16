/**
 * J-CANARY — DOD-ZEROBUMP-CANARY-1: the architectural proof.
 *
 * A throwaway type (`canary_test`) that the system has NEVER SEEN is taken from nothing to live
 * end-to-end — with `git status --porcelain` clean in cello-client AND trustless-cello for the
 * entire exercise (no rebuild, no republish, no redeploy; the running binaries predate the type).
 *
 * Flow:
 *  1. Assert git is clean in both repos (proof anchor)
 *  2. Compose a `canary_test` envelope (self-describing payload)
 *  3. Submit hash to directory via signal_records (the generic notary ledger)
 *  4. Seed sealed envelope to A's pickup queue
 *  5. A's daemon decodes + stores (generic wallet)
 *  6. A presents to B (generic presentation, no type knowledge)
 *  7. B verifies + consumes (generic framing, INV-TYPE-CARRY)
 *  8. Floor evaluates (generic policy)
 *  9. Retire: directory revokes → effective view shows 'revoked'
 * 10. Assert git is STILL clean (zero-bump proven)
 *
 * Run: pnpm --filter @cello-protocol/e2e-tests test:spine -- j-canary
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  startSpineCluster,
  startDaemon,
  connectMcp,
  cello,
  psqlSpine,
  CELLO_CLIENT_ROOT,
  TRUSTLESS_ROOT,
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

function gitClean(repoPath: string): boolean {
  const r = spawnSync("git", ["status", "--porcelain"], { cwd: repoPath, encoding: "utf-8" });
  // Untracked files in infra/ are allowed (not code)
  const lines = (r.stdout ?? "").split("\n").filter((l) => l.trim() && !l.includes("infra/hibernation"));
  return lines.length === 0;
}

let cluster: SpineCluster;
let manifestEnv: ManifestEnv;
const daemons: Proc[] = [];
const dirs: string[] = [];
const mcpConns: McpConn[] = [];

beforeAll(async () => {
  cluster = await startSpineCluster({ directoryNodeKeyHex: AUTH_DIRECTORY_NODE_KEY_HEX });
  manifestEnv = writeConsortiumManifest(cluster.tmpDir, "canary", [{
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

describe("J-CANARY — DOD-ZEROBUMP-CANARY-1: a type the system has never seen, live, zero diffs", () => {
  it("canary_test type: compose→submit→deliver→present→verify→consume→floor→retire — git stays clean", async () => {
    // ── PROOF ANCHOR: both repos are clean before we begin ──
    expect(gitClean(TRUSTLESS_ROOT), "trustless-cello must be clean before the canary").toBe(true);
    expect(gitClean(CELLO_CLIENT_ROOT), "cello-client must be clean before the canary").toBe(true);

    const accountId = `acct-canary-${randomBytes(8).toString("hex")}`;

    // ── Set up two agents: A (will hold the canary signal), B (will receive it) ──
    const dirA = mkdtempSync(join(tmpdir(), "cello-canary-A-"));
    const dirB = mkdtempSync(join(tmpdir(), "cello-canary-B-"));
    dirs.push(dirA, dirB);

    // Daemon must be running BEFORE create-agent (the CLI calls the daemon over IPC).
    // manifestEnv enables step-6 so the daemon knows its home nodeId (needed for same-node routing).
    const daemonA = await startDaemon(dirA, cluster.directoryUrl, "canaryA", { manifestEnv });
    const daemonB = await startDaemon(dirB, cluster.directoryUrl, "canaryB", { manifestEnv });
    daemons.push(daemonA, daemonB);

    const createA = JSON.parse(cello(["create-agent", "canaryA"], { CELLO_DIR: dirA }).stdout) as { pubkey: string };
    const createB = JSON.parse(cello(["create-agent", "canaryB"], { CELLO_DIR: dirB }).stdout) as { pubkey: string };
    const pubA = createA.pubkey;
    const pubB = createB.pubkey;

    await waitConnected(dirA, "A");
    await waitConnected(dirB, "B");

    const devTag = (t: string) => `DEV-canary-${t}-${randomBytes(6).toString("hex")}`;
    const regA = cello(["register-agent", "canaryA", devTag("A")], { CELLO_DIR: dirA });
    expect(regA.status, `register-agent A failed: ${regA.stdout}`).toBe(0);
    const regB = cello(["register-agent", "canaryB", devTag("B")], { CELLO_DIR: dirB });
    expect(regB.status, `register-agent B failed: ${regB.stdout}`).toBe(0);

    const agentIdA = psqlSpine(`SELECT agent_id FROM agent_profiles WHERE k_local_pubkey = '${pubA}'`);
    expect(agentIdA).toMatch(/\S/);

    // ── COMPOSE a `canary_test` envelope with a SELF-DESCRIBING payload ──
    // The type has never been seen by ANY component. The payload explains itself (INV-TYPE-CARRY).
    const { sealToRecipient } = await loadSealer();
    const { encodeTrustSignalEnvelope, hashTrustSignalEnvelope, encodeCbor } = await loadCodec();

    const canaryEnvelope: Envelope = {
      subject_kind: "account",
      subject: accountId,
      issuer_kind: "portal",
      issuer_pubkey: "ab".repeat(32),
      type: "canary_test",
      schema_version: 1,
      payload: encodeCbor({
        claim: "This is a canary signal type that proves the zero-bump architecture works. If you are reading this, a new signal type was taken from nothing to live with zero code changes.",
        canary_id: randomBytes(8).toString("hex"),
        proven_at_unix: Math.floor(Date.now() / 1000),
      }),
      issued_at: Math.floor(Date.now() / 1000),
      expires_at: null,
      supersedes_hash: null,
    };

    const canaryEnvBytes = encodeTrustSignalEnvelope(canaryEnvelope);
    const canaryHash = hex(hashTrustSignalEnvelope(canaryEnvelope));

    // ── SUBMIT: insert into signal_records (the directory's generic notary ledger) ──
    // In production the portal does this via the signed submission API. In this test we seed
    // directly — the directory code that processes submissions is the same code that inserted the
    // phone/email rows; what matters is that the schema ACCEPTS the type.
    psqlSpine(
      `INSERT INTO signal_records (signal_hash, accepting_node, subject_kind, subject, issuer_kind, issuer_pubkey, type, status, scanner_version) ` +
      `VALUES ('${canaryHash}', 'local', 'account', '${accountId}', 'portal', '${"ab".repeat(32)}', 'canary_test', 'active', 'canary-v0')`,
    );

    // Verify the record exists and is active
    const recStatus = psqlSpine(`SELECT effective_status FROM signal_records_effective WHERE signal_hash = '${canaryHash}'`);
    expect(recStatus).toBe("active");

    // ── DELIVER: seal to A's k_local and seed the pickup queue ──
    const sealedHex = hex(sealToRecipient(hexToBytes(pubA), canaryEnvBytes));
    psqlSpine(
      `INSERT INTO pickup_queue (agent_id, signal_kind, ciphertext, signal_hash) ` +
      `VALUES ('${agentIdA}', 'canary_test', decode('${sealedHex}', 'hex'), '${canaryHash}')`,
    );

    // Restart A's daemon to trigger pickup delivery on reconnect
    await daemonA.stop();
    const daemonA2 = await startDaemon(dirA, cluster.directoryUrl, "canaryA2", { manifestEnv });
    daemons.push(daemonA2);

    const connA = await connectMcp(dirA, "canary-A");
    mcpConns.push(connA);
    expect(((await connA.call("cello_start_agent", { name: "canaryA" })) as { ok?: boolean }).ok).toBe(true);
    await waitConnected(dirA, "A2");

    // Wait for A's daemon to receive the canary signal
    await daemonA2.waitForLine(/daemon\.trust_signal\.received/, 25_000);

    // ── PRESENT: A adds B as KNOWN, initiates session → signals presented ──
    expect(((await connA.call("cello_contact_add", { pubkey: pubB })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connA.call("cello_use_agent", { name: "canaryA" })) as { ok?: boolean }).ok).toBe(true);

    const connB = await connectMcp(dirB, "canary-B");
    mcpConns.push(connB);
    expect(((await connB.call("cello_start_agent", { name: "canaryB" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connB.call("cello_use_agent", { name: "canaryB" })) as { ok?: boolean }).ok).toBe(true);

    const awaitB = connB.call("cello_await_session", { timeout_ms: 30_000 });
    const initA = (await connA.call("cello_initiate_session", { target_pubkey: pubB })) as { ok?: boolean; sessionId?: string };
    expect(initA.ok, `initiate failed: ${JSON.stringify(initA)}`).toBe(true);

    // ── VERIFY + CONSUME: B sees the canary signal with correct generic framing ──
    const inbound = (await awaitB) as {
      type?: string;
      trust_signals?: Array<{ type: string; issuer: string; claim: unknown }>;
    };
    expect(inbound.type).toBe("new_session");
    expect(inbound.trust_signals, "B must see the canary signal").toBeDefined();
    expect(inbound.trust_signals!.length).toBe(1);

    const canarySignal = inbound.trust_signals![0];
    expect(canarySignal.type).toBe("canary_test");
    expect(canarySignal.issuer).toBe("platform-verified");
    expect(canarySignal.claim).toBeTruthy();
    expect((canarySignal.claim as Record<string, unknown>).claim).toMatch(/zero-bump architecture/);
    expect((canarySignal.claim as Record<string, unknown>).canary_id).toBeTruthy();

    // ── FLOOR: the canary signal satisfies the default unknown policy ──
    const { evaluateSignalPolicy, DEFAULT_UNKNOWN_POLICY } = await loadFloorPolicy();
    const floorResult = evaluateSignalPolicy(DEFAULT_UNKNOWN_POLICY, [{
      type: "canary_test",
      issuerKind: "portal",
      verdict: "active",
    }]);
    expect(floorResult.pass, "canary_test must pass the DEFAULT_UNKNOWN floor (portal-attested, min_count=1)").toBe(true);

    // ── RETIRE: revoke the canary type in the registry (data operation) ──
    psqlSpine(
      `INSERT INTO signal_records (signal_hash, accepting_node, subject_kind, subject, issuer_kind, issuer_pubkey, type, status, scanner_version, is_tombstone) ` +
      `VALUES ('${canaryHash}', 'revoke:local', 'account', '${accountId}', 'portal', '${"ab".repeat(32)}', 'canary_test', 'revoked', 'canary-v0', true)`,
    );

    // Verify revocation is effective
    const revokedStatus = psqlSpine(`SELECT effective_status FROM signal_records_effective WHERE signal_hash = '${canaryHash}'`);
    expect(revokedStatus, "revoked canary must show 'revoked' in effective view").toBe("revoked");

    // ── ZERO-BUMP PROOF: both repos are STILL clean ──
    expect(gitClean(TRUSTLESS_ROOT), "trustless-cello must be CLEAN after the canary (zero-bump proven)").toBe(true);
    expect(gitClean(CELLO_CLIENT_ROOT), "cello-client must be CLEAN after the canary (zero-bump proven)").toBe(true);
  }, 300_000);
});
