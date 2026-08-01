/**
 * J-REFRESH — M8B proactive share refresh / epoch rollover (DOD-REFRESH-1), live binaries.
 *
 * Proves a zero-constant-term proactive secret sharing (PSS) refresh on a 3-node consortium: every
 * shareholder (the client + all 3 directory nodes) rotates its FROST share to a NEW epoch while the group
 * public key stays BYTE-IDENTICAL. Flow: register agent A (multi-node DKG → epoch 1, capture P1) → seal a
 * session (signing works at epoch 1) → `cello refresh agentA` → assert (a) the returned group pubkey == P1
 * (unchanged — the defining property of PSS vs a re-keying), (b) it advanced to epoch 2, (c) ALL 3
 * directories applied the refresh (frost.refresh.applied), (d) a seal STILL completes afterwards (the
 * rotated epoch-2 shares sign; the directory's #currentEpoch advance means an epoch-1 request returns
 * EPOCH_EXPIRED within the process). Then REFRESH AGAIN → epoch 3 and assert the public verifyingShares
 * DIGEST CHANGED — the one observable that distinguishes a genuine rotation from a relabel-only no-op
 * (group key, epoch counter, and the applied-log are all invariant to a no-op). The cryptographic
 * "a captured epoch-e share is unusable in e+1" property is proven directly in the crypto unit suite
 * (frost-resharing.test.ts: a mixed old+new share set does NOT reconstruct).
 *
 * Anchored to the binaries — real cello-directory ×3 + relay + cello-daemon/cello/cello-mcp.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  startSpineCluster,
  startDaemon,
  provisionAgent,
  connectMcp,
  cello,
  registerAgent,
  writeConsortiumManifest,
  writeSignedManifestTo,
  type SpineCluster,
  type Proc,
  type McpConn,
} from "./live-harness.js";
import { spineDirectoryNode, spineNodeKeypair } from "./auth-manifest.js";

let cluster: SpineCluster;
const daemons: Proc[] = [];
const agentDirs: string[] = [];
const mcpConns: McpConn[] = [];

beforeAll(async () => {
  const holder = mkdtempSync(join(tmpdir(), "cello-refresh-consortium-"));
  agentDirs.push(holder);
  const consortiumManifestPath = join(holder, "consortium-manifest.json");
  cluster = await startSpineCluster({
    directoryCount: 3,
    directoryNodeKeysHex: [0, 1, 2].map((i) => spineNodeKeypair(i).privateKeyHex),
    directoryConsortiumManifestPath: consortiumManifestPath,
    onDirectoryUrlsReady: (urls) => {
      writeSignedManifestTo(consortiumManifestPath, urls.map((url, i) => spineDirectoryNode(i, url)));
    },
  });
}, 300_000);

afterAll(async () => {
  for (const c of mcpConns) await c.close();
  for (const d of daemons) await d.stop();
  await cluster?.stop();
  for (const dir of agentDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Register A + B into the consortium on ONE daemon; return their conns, B's pubkey, and A's epoch-1 group key. */
async function setup(label: string): Promise<{ celloDir: string; daemon: Proc; connA: McpConn; connB: McpConn; pubB: string; p1: string }> {
  const celloDir = mkdtempSync(join(tmpdir(), `cello-refresh-${label}-`));
  agentDirs.push(celloDir);
  await provisionAgent(celloDir, "agentA");
  const pubB = await provisionAgent(celloDir, "agentB");
  const nodes = [0, 1, 2].map((i) => spineDirectoryNode(i, cluster.directoryUrls[i]));
  const manifestEnv = writeConsortiumManifest(celloDir, label, nodes);
  const daemon = await startDaemon(celloDir, cluster.directoryUrls[0], label, { manifestEnv });
  daemons.push(daemon);
  const env = { CELLO_DIR: celloDir };

  let connected = false;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      if ((JSON.parse(cello(["status"], env).stdout.trim()) as { directory_signaling?: string }).directory_signaling === "connected") {
        connected = true;
        break;
      }
    } catch {
      /* not JSON yet */
    }
    await sleep(250);
  }
  expect(connected, `${label}: signaling never connected`).toBe(true);

  let p1 = "";
  for (const name of ["agentA", "agentB"]) {
    const res = registerAgent(name, `DEV-${label}-${name}-${randomBytes(6).toString("hex")}`, env);
    expect(res.status, `${label}: register ${name} failed: ${res.stdout}`).toBe(0);
    const parsed = JSON.parse(res.stdout.trim()) as { ok?: boolean; primary_pubkey?: string };
    expect(parsed.ok, `${label}: register ${name} not ok: ${res.stdout}`).toBe(true);
    if (name === "agentA") p1 = parsed.primary_pubkey ?? "";
  }
  expect(p1, "agentA must have a registered group pubkey (P1)").toMatch(/^[0-9a-f]{64}$/);

  const connA = await connectMcp(celloDir, `${label}-A`);
  mcpConns.push(connA);
  const connB = await connectMcp(celloDir, `${label}-B`);
  mcpConns.push(connB);
  for (const [conn, name] of [[connA, "agentA"], [connB, "agentB"]] as const) {
    expect(((await conn.call("cello_start_agent", { name })) as { ok?: boolean }).ok).toBe(true);
    expect(((await conn.call("cello_use_agent", { name })) as { ok?: boolean }).ok).toBe(true);
  }
  return { celloDir, daemon, connA, connB, pubB, p1 };
}

/** A→B: open a session, exchange, both close → bilateral seal. Returns the byte-identical root. */
async function sealSession(connA: McpConn, connB: McpConn, pubB: string, _daemon: Proc): Promise<string> {
  const awaitP = connB.call("cello_await_session", { timeout_ms: 25_000 });
  let init = (await connA.call("cello_initiate_session", { target_pubkey: pubB })) as { ok?: boolean; sessionId?: string; reason?: string };
  for (let i = 0; i < 20 && !init.ok && init.reason === "standing_receiver_unavailable"; i++) {
    await sleep(300);
    init = (await connA.call("cello_initiate_session", { target_pubkey: pubB })) as { ok?: boolean; sessionId?: string; reason?: string };
  }
  expect(init.ok, `initiate failed: ${JSON.stringify(init)}`).toBe(true);
  const sessionIdA = init.sessionId!;
  const inbound = (await awaitP) as { type?: string; session_id?: string };
  expect(inbound.type, `B must accept the session: ${JSON.stringify(inbound)}`).toBe("new_session");
  const sessionIdB = inbound.session_id!;

  expect(((await connA.call("cello_send", { cello_session_id: sessionIdA, content: "refresh proof", signal: "over" })) as { ok?: boolean }).ok).toBe(true);
  expect(((await connB.call("cello_receive", { cello_session_id: sessionIdB, timeout_ms: 15_000 })) as { content?: string | null }).content).toBe(`refresh proof [[OVER]]`);

  const [closeA, closeB] = (await Promise.all([
    connA.call("cello_close_session", { cello_session_id: sessionIdA }),
    connB.call("cello_close_session", { cello_session_id: sessionIdB }),
  ])) as Array<{ ok?: boolean; sealed_root?: string; seal_type?: string }>;
  const diag = `\ncloseA: ${JSON.stringify(closeA)}\ncloseB: ${JSON.stringify(closeB)}`;
  expect(closeA.ok, `A close failed:${diag}`).toBe(true);
  expect(closeB.ok, `B close failed:${diag}`).toBe(true);
  expect(closeA.sealed_root, `A sealed_root:${diag}`).toMatch(/^[0-9a-f]{64}$/);
  expect(closeB.sealed_root, `both ends' sealed_root must be byte-identical:${diag}`).toBe(closeA.sealed_root);
  return closeA.sealed_root!;
}

describe("J-REFRESH — proactive share refresh / epoch rollover (DOD-REFRESH-1)", () => {
  it("refresh rotates all shares to a new epoch: group key UNCHANGED, all nodes apply, post-refresh seal still works", async () => {
    const { celloDir, connA, connB, pubB, daemon, p1 } = await setup("refresh");
    const env = { CELLO_DIR: celloDir };

    // Seal once at epoch 1 — signing works before the refresh.
    expect(await sealSession(connA, connB, pubB, daemon)).toMatch(/^[0-9a-f]{64}$/);

    // ─── REFRESH #1: rotate the client + all 3 directories' shares to epoch 2 ───
    type Refresh = { ok?: boolean; epoch?: number; primary_pubkey?: string; verifying_shares_digest?: string; reason?: string };
    const r1 = JSON.parse(cello(["refresh", "agentA"], env).stdout.trim()) as Refresh;
    expect(r1.ok, `refresh #1 failed: ${JSON.stringify(r1)}`).toBe(true);
    // (a) the group public key is UNCHANGED — the defining property of PSS (not a re-key).
    expect(r1.primary_pubkey, `group pubkey must be byte-identical after refresh (P1=${p1})`).toBe(p1);
    // (b) advanced to epoch 2.
    expect(r1.epoch, "epoch must advance to 2").toBe(2);
    expect(r1.verifying_shares_digest, "refresh must report a verifyingShares digest").toMatch(/^[0-9a-f]{64}$/);

    // (c) ALL 3 directories applied the refresh (rotated their share to epoch 2). stdout lags — settle first.
    await sleep(2000);
    const appliedSet = [0, 1, 2].filter((i) => /"event":"frost\.refresh\.applied"/.test(cluster.directories[i].output));
    expect(appliedSet.length, `all 3 directories must apply the refresh; applied: ${appliedSet.join(",")}`).toBe(3);

    // (d) a seal STILL completes after the refresh — the rotated epoch-2 shares sign, and signing now
    // targets epoch 2 (the directory advanced #currentEpoch, so an epoch-1 request returns EPOCH_EXPIRED).
    expect(await sealSession(connA, connB, pubB, daemon), "a seal must still complete AFTER refresh #1").toMatch(/^[0-9a-f]{64}$/);

    // ─── REFRESH #2 → epoch 3: the shares ACTUALLY ROTATED (kills the no-op) ───
    // The group key is invariant by design, the epoch is arithmetic, and the applied-log fires regardless —
    // so none of those distinguish a real refresh from a relabel-only NO-OP. The verifyingShares (public,
    // = s_j·G) MOVE only when the share material actually rotates. A genuine refresh changes the digest
    // every epoch; a no-op (same secret relabeled) yields the SAME digest. Assert it CHANGED.
    const r2 = JSON.parse(cello(["refresh", "agentA"], env).stdout.trim()) as Refresh;
    expect(r2.ok, `refresh #2 failed: ${JSON.stringify(r2)}`).toBe(true);
    expect(r2.epoch, "epoch must advance to 3").toBe(3);
    expect(r2.primary_pubkey, "group pubkey must STILL be unchanged at epoch 3").toBe(p1);
    expect(r2.verifying_shares_digest, `the verifyingShares digest MUST change across refreshes — equal digest ⇒ a no-op relabel that left the old shares intact (DoD: a node compromised in epoch e holds nothing usable in e+1). r1=${r1.verifying_shares_digest} r2=${r2.verifying_shares_digest}`).not.toBe(r1.verifying_shares_digest);

    // and a seal STILL completes at epoch 3 — the twice-rotated shares are coherent.
    await sleep(1000);
    expect(await sealSession(connA, connB, pubB, daemon), "a seal must still complete after refresh #2").toMatch(/^[0-9a-f]{64}$/);
  }, 300_000);
});
