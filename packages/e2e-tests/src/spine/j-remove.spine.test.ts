/**
 * J-REMOVE — CELLO-M7-REMOVE-001 (DOD-REMOVE-1), live binaries. Agent removal = RETIRE-AND-KEEP +
 * name reuse, at the launch record-shape scope (local; the signed directory revocation is DOD-REMOVE-2).
 *
 * A registered, active agent X is removed with `cello remove-agent X`. The real daemon flips X's local
 * row to state='retired' WITHOUT deleting the row, its K_local seed, or its FROST share (SI-002 —
 * accountability survives), and FREES the human name. `cello create-agent X` then succeeds as a DISTINCT
 * identity (a different stable agent_id and a different K_local pubkey). Removal is one-way.
 *
 * Anchored to the binary — real cello-directory + cello-relay + cello-daemon, driven via the `cello` CLI.
 * The retired-row assertions read the daemon's OWN encrypted DB through its keyed adapter (j-persist
 * pattern), so a hollow "remove = delete" or "remove = a flag with no kept material" fails here.
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

type KeyedStmt = { get(...p: unknown[]): unknown };
type KeyedDb = { prepare(sql: string): KeyedStmt; close(): void };
async function openEncryptedDb(dbPath: string): Promise<KeyedDb> {
  const mod = (await import(
    pathToFileURL(join(CELLO_CLIENT_ROOT, "core/daemon/dist/sqlcipher-db.js")).href
  )) as { openEncryptedDatabaseAtPath(p: string): KeyedDb };
  return mod.openEncryptedDatabaseAtPath(dbPath);
}

// AC-002 cross-node re-verification: rebuild the canonical TBS (protocol-types) and verify the stored
// signature (crypto) — both loaded from the SAME local cello-client build the daemon signed with.
async function loadRevocationVerifier(): Promise<{
  buildAgentRevocationTbs: (a: string, k: string, e: string, r: string, t: number) => Uint8Array;
  verify: (pub: Uint8Array, data: Uint8Array, sig: Uint8Array) => boolean;
}> {
  const pt = (await import(pathToFileURL(join(CELLO_CLIENT_ROOT, "core/protocol-types/dist/index.js")).href)) as {
    buildAgentRevocationTbs: (a: string, k: string, e: string, r: string, t: number) => Uint8Array;
  };
  const crypto = (await import(pathToFileURL(join(CELLO_CLIENT_ROOT, "core/crypto/dist/index.js")).href)) as {
    verify: (pub: Uint8Array, data: Uint8Array, sig: Uint8Array) => boolean;
  };
  return { buildAgentRevocationTbs: pt.buildAgentRevocationTbs, verify: crypto.verify };
}

const hexToBytes = (h: string): Uint8Array => new Uint8Array(Buffer.from(h, "hex"));

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

type Status = { directory_signaling?: string; agents?: Array<{ name: string }> };
function status(dir: string): Status {
  return JSON.parse(cello(["status"], { CELLO_DIR: dir }).stdout) as Status;
}

describe("J-REMOVE — retire-and-keep + name reuse (CELLO-M7-REMOVE-001 DOD-REMOVE-1)", () => {
  it("register X → remove-agent X (retired row + keys + FROST share KEPT) → create-agent X = a NEW identity", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cello-remove-"));
    dirs.push(dir);
    const daemon = await startDaemon(dir, cluster.directoryUrl, "remove");
    daemons.push(daemon);

    // Create X — capture its stable agent_id + K_local pubkey.
    const created1 = cello(["create-agent", "xavier"], { CELLO_DIR: dir });
    expect(created1.status, `create-agent failed: ${created1.stdout}`).toBe(0);
    const c1 = JSON.parse(created1.stdout) as { ok: boolean; pubkey: string; agentId: string };
    expect(c1.ok).toBe(true);
    const id1 = c1.agentId;
    const pub1 = c1.pubkey;
    expect(id1, "create-agent must return a stable agent_id").toBeTruthy();

    // The keystone elects X and connects; then register X (real DKG with the directory) so it has
    // persisted FROST material whose survival across removal proves SI-002.
    let signaling = "reconnecting";
    for (let i = 0; i < 50; i++) {
      signaling = status(dir).directory_signaling ?? "unknown";
      if (signaling === "connected") break;
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(signaling, "directory_signaling must connect after create-agent (ONBOARD election)").toBe("connected");
    const reg = cello(["register", "xavier", `DEV-remove-${randomBytes(6).toString("hex")}`], { CELLO_DIR: dir });
    expect(reg.status, `register failed: ${reg.stdout}`).toBe(0);

    // ── Remove X: one-way, echoes the retired agent_id, states it is one-way. ──
    const removed = cello(["remove-agent", "xavier"], { CELLO_DIR: dir });
    expect(removed.status, `remove-agent failed: ${removed.stdout}`).toBe(0);
    const r = JSON.parse(removed.stdout) as { ok: boolean; agentId: string; oneWay: boolean; message: string; directoryRevocation: string };
    expect(r.ok).toBe(true);
    expect(r.oneWay).toBe(true);
    expect(r.agentId).toBe(id1);
    expect(r.message.toLowerCase()).toContain("one-way");
    // DOD-REMOVE-2: the directory accepted + recorded the signed revocation (the daemon got the ack).
    expect(r.directoryRevocation, "the directory must record the signed revocation").toBe("recorded");

    // ── AC-002: an agent_revocations row for X's DIRECTORY agent_id is present, its signature VERIFIES
    // against X's registered K_local, and X's agent_profiles row is UNCHANGED (purely additive — SI-002).
    // Read straight from the directory's Postgres (its OWN write), not the daemon's self-report. ──
    const regId = psqlSpine(`SELECT agent_id FROM agent_profiles WHERE k_local_pubkey = '${pub1}'`);
    expect(regId, "X must have a directory-assigned agent_id after registration").toMatch(/\S/);
    let revRow = "";
    for (let i = 0; i < 20; i++) {
      // The directory INSERT is fire-and-forget after the ack — poll for the committed row.
      revRow = psqlSpine(
        `SELECT encode(signature,'hex') || '|' || COALESCE(epoch_id,'') || '|' || COALESCE(reason,'') || '|' || revoked_at FROM agent_revocations WHERE agent_id = '${regId}'`,
      );
      if (revRow) break;
      await new Promise((res) => setTimeout(res, 250));
    }
    expect(revRow, `an agent_revocations row must exist for ${regId}`).toMatch(/\S/);
    const [sigHex, epochId, reason, revokedAtStr] = revRow.split("|");
    const { buildAgentRevocationTbs, verify } = await loadRevocationVerifier();
    const tbs = buildAgentRevocationTbs(regId, pub1, epochId, reason, Number(revokedAtStr));
    expect(
      verify(hexToBytes(pub1), tbs, hexToBytes(sigHex)),
      "the stored revocation signature must verify against X's registered K_local (self-signed fact)",
    ).toBe(true);
    // agent_profiles untouched — the revocation is additive, the identity binding stays resolvable.
    expect(psqlSpine(`SELECT status FROM agent_profiles WHERE agent_id = '${regId}'`), "agent_profiles must be unchanged").toBe("active");
    expect(psqlSpine(`SELECT k_local_pubkey FROM agent_profiles WHERE agent_id = '${regId}'`)).toBe(pub1);

    // ── SI-002: the retired row is KEPT — same agent_id, state=retired, K_local seed AND the FROST
    // signing share intact (a registered identity survives removal; it is a tombstone, not an erasure). ──
    const db = await openEncryptedDb(join(dir, "sessions.db"));
    try {
      const retired = db
        .prepare(
          "SELECT agent_id, state, k_local_seed, frost_signing_share FROM agents WHERE agent_name = ? AND state = 'retired'",
        )
        .get("xavier") as { agent_id: string; state: string; k_local_seed: Uint8Array; frost_signing_share: Uint8Array | null } | undefined;
      expect(retired, "the retired agent row must still exist (accountability survives)").toBeDefined();
      expect(retired!.agent_id).toBe(id1);
      expect(retired!.k_local_seed?.length, "K_local seed kept (32-byte Ed25519 seed)").toBe(32);
      expect(retired!.frost_signing_share, "the FROST signing share must survive removal (SI-002)").not.toBeNull();
    } finally {
      db.close();
    }

    // The retired agent is gone from the live runtime.
    expect((status(dir).agents ?? []).map((a) => a.name)).not.toContain("xavier");

    // ── Name reuse: create-agent xavier SUCCEEDS as a DISTINCT identity. ──
    const created2 = cello(["create-agent", "xavier"], { CELLO_DIR: dir });
    expect(created2.status, `recreate failed: ${created2.stdout}`).toBe(0);
    const c2 = JSON.parse(created2.stdout) as { ok: boolean; pubkey: string; agentId: string };
    expect(c2.ok).toBe(true);
    expect(c2.agentId, "the recreated agent must have a DIFFERENT agent_id").not.toBe(id1);
    expect(c2.pubkey, "the recreated agent must have a DIFFERENT K_local pubkey").not.toBe(pub1);

    // The new xavier is the only active 'xavier'; the retired row still sits beside it in the DB.
    expect((status(dir).agents ?? []).map((a) => a.name)).toContain("xavier");
    const db2 = await openEncryptedDb(join(dir, "sessions.db"));
    try {
      const active = db2
        .prepare("SELECT agent_id FROM agents WHERE agent_name = ? AND state != 'retired'")
        .get("xavier") as { agent_id: string } | undefined;
      expect(active!.agent_id).toBe(c2.agentId);
      const tomb = db2
        .prepare("SELECT agent_id FROM agents WHERE agent_name = ? AND state = 'retired'")
        .get("xavier") as { agent_id: string } | undefined;
      expect(tomb!.agent_id, "the retired identity is kept beside the reused name").toBe(id1);
    } finally {
      db2.close();
    }

    // Keystone clear + re-election teeth: xavier was the elected PRIMARY (keystone). Removing it must
    // CLEAR the keystone (directory.keystone.cleared) and recreating it must RE-ELECT (a 2nd
    // directory.keystone.elected). A stub that left primaryAgent pointing at the retired identity would
    // do neither — the directory door would keep authenticating as the retired primary, and the new
    // primary would never be wired for ceremonies.
    let cleared = false;
    let electedCount = 0;
    for (let i = 0; i < 30; i++) {
      const out = daemon.output;
      cleared = /directory\.keystone\.cleared/.test(out);
      electedCount = (out.match(/directory\.keystone\.elected/g) ?? []).length;
      if (cleared && electedCount >= 2) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(cleared, "removing the PRIMARY agent must clear the keystone (directory.keystone.cleared)").toBe(true);
    expect(electedCount, "recreating the primary must RE-ELECT the keystone (a 2nd directory.keystone.elected)").toBeGreaterThanOrEqual(2);
  }, 150_000);

  it("removing a registered SECONDARY agent drops its per-agent signaling (no leaked directory door)", async () => {
    // HIGH-1 teeth: a non-primary agent that has registered owns a dedicated SignalingManager (an
    // unbounded reconnect loop) cached in perAgentSignaling. Removal must stop+forget it, or the
    // retired identity keeps re-authenticating the directory door. The daemon emits
    // `agent.signaling.dropped` only when dropAgentSignaling actually runs — the unfixed handler never
    // did. We drive it on the binary and assert the log line.
    const dir = mkdtempSync(join(tmpdir(), "cello-remove2-"));
    dirs.push(dir);
    const daemon = await startDaemon(dir, cluster.directoryUrl, "remove2");
    daemons.push(daemon);

    // alpha = the keystone primary; register it so signaling connects.
    expect(cello(["create-agent", "alpha"], { CELLO_DIR: dir }).status).toBe(0);
    let signaling = "reconnecting";
    for (let i = 0; i < 50; i++) {
      signaling = status(dir).directory_signaling ?? "unknown";
      if (signaling === "connected") break;
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(signaling).toBe("connected");
    expect(cello(["register", "alpha", `DEV-rm2-a-${randomBytes(6).toString("hex")}`], { CELLO_DIR: dir }).status).toBe(0);

    // beta = a SECONDARY agent; registering it creates its dedicated per-agent signaling manager.
    expect(cello(["create-agent", "beta"], { CELLO_DIR: dir }).status).toBe(0);
    expect(cello(["register", "beta", `DEV-rm2-b-${randomBytes(6).toString("hex")}`], { CELLO_DIR: dir }).status).toBe(0);

    // Remove beta — its per-agent signaling MUST be dropped (the leak fix).
    expect(cello(["remove-agent", "beta"], { CELLO_DIR: dir }).status).toBe(0);
    const line = await daemon.waitForLine(/agent\.signaling\.dropped[\s\S]*?beta|beta[\s\S]*?agent\.signaling\.dropped/, 10_000);
    expect(line, "remove must stop+forget beta's per-agent signaling manager").toMatch(/agent\.signaling\.dropped/);

    // alpha (the primary) is untouched and still active; beta is retired-and-kept.
    expect((status(dir).agents ?? []).map((a) => a.name)).toContain("alpha");
    expect((status(dir).agents ?? []).map((a) => a.name)).not.toContain("beta");
    const db = await openEncryptedDb(join(dir, "sessions.db"));
    try {
      const tomb = db
        .prepare("SELECT state FROM agents WHERE agent_name = ? AND state = 'retired'")
        .get("beta") as { state: string } | undefined;
      expect(tomb!.state, "beta's identity is kept as a retired tombstone").toBe("retired");
    } finally {
      db.close();
    }
  }, 150_000);

  it("DOD-REMOVE-3: a revoked agent is refused as a session target (agent_revoked)", async () => {
    const waitConnected = async (dir: string): Promise<void> => {
      for (let i = 0; i < 50; i++) {
        if ((status(dir).directory_signaling ?? "") === "connected") return;
        await new Promise((r) => setTimeout(r, 500));
      }
      throw new Error(`directory_signaling never connected for ${dir}`);
    };

    // Target X: register, then remove (revoked at the directory).
    const dirX = mkdtempSync(join(tmpdir(), "cello-revX-"));
    dirs.push(dirX);
    daemons.push(await startDaemon(dirX, cluster.directoryUrl, "revX"));
    const cX = JSON.parse(cello(["create-agent", "xtarget"], { CELLO_DIR: dirX }).stdout) as { pubkey: string };
    const pubX = cX.pubkey;
    await waitConnected(dirX);
    expect(cello(["register", "xtarget", `DEV-revx-${randomBytes(6).toString("hex")}`], { CELLO_DIR: dirX }).status).toBe(0);
    const rmX = JSON.parse(cello(["remove-agent", "xtarget"], { CELLO_DIR: dirX }).stdout) as { directoryRevocation: string };
    expect(rmX.directoryRevocation, "X's revocation must be recorded at the directory").toBe("recorded");

    // Initiator A: register + online.
    const dirA = mkdtempSync(join(tmpdir(), "cello-revA-"));
    dirs.push(dirA);
    daemons.push(await startDaemon(dirA, cluster.directoryUrl, "revA"));
    expect(cello(["create-agent", "ainit"], { CELLO_DIR: dirA }).status).toBe(0);
    await waitConnected(dirA);
    expect(cello(["register", "ainit", `DEV-reva-${randomBytes(6).toString("hex")}`], { CELLO_DIR: dirA }).status).toBe(0);
    const connA = await connectMcp(dirA, "rev-A");
    mcpConns.push(connA);
    expect(((await connA.call("cello_start_agent", { name: "ainit" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connA.call("cello_use_agent", { name: "ainit" })) as { ok?: boolean }).ok).toBe(true);

    // A initiates a session targeting the REVOKED X. The directory's revocation gate fires BEFORE the
    // target-online check, so the refusal reason is unambiguously agent_revoked — the directory does not
    // broker the connection (DOD-REMOVE-3 soft enforcement).
    const init = (await connA.call("cello_initiate_session", { target_pubkey: pubX })) as { ok?: boolean; reason?: string };
    expect(init.ok, `initiate to a revoked agent must fail: ${JSON.stringify(init)}`).toBe(false);
    expect(init.reason, "the directory must refuse a revoked target with agent_revoked").toBe("agent_revoked");
  }, 150_000);
});
