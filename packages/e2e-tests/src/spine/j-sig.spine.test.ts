/**
 * J-SIG — live binary signaling resilience (M7-DEFINITION-OF-DONE.md §"verification
 * harness", journey 3; DOD-SIG-1).
 *
 * Drives the REAL binaries and proves the daemon survives a directory outage WITHOUT
 * going silent or hanging: when the directory dies, the daemon's directory signaling
 * transitions to `reconnecting`, and signaling-dependent tool calls return a distinct
 * `signaling_reconnecting` reason + actionable guidance (never a silent failure, never
 * a hang). This is the degradation/detection half of DOD-SIG-1.
 *
 * SCOPE: "reconnect to a DIFFERENT directory node from the manifest" is multi-node
 * failover, which the single-directory harness does not model — the invariant proven
 * here is graceful DEGRADATION (reconnecting + guidance). The reconnect+drain half
 * (directory returns → daemon re-auths → queued ops drain) is the next J-SIG increment.
 *
 * Anchored to the binary — see live-harness.ts.
 *
 * Run: pnpm --filter @cello-protocol/e2e-tests test:spine
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  startSpineCluster,
  startDaemon,
  provisionAgent,
  connectMcp,
  cello,
  type SpineCluster,
  type Proc,
  type McpConn,
  writeSignedManifestTo,
  writeConsortiumManifest,
} from "./live-harness.js";
import { spineDirectoryNode, spineNodeKeypair } from "./auth-manifest.js";

let cluster: SpineCluster;
const daemons: Proc[] = [];
const dirs: string[] = [];
const mcpConns: McpConn[] = [];

beforeAll(async () => {
  // A THREE-node consortium with a signed manifest — the pattern j-content / j-unilateral /
  // j-persist use. Without the DIRECTORY-side manifest the daemon never learns its own directory
  // node id, so two LOCAL agents route down the CROSS-NODE path and cello_initiate_session dies on
  // `discovery_node_unresolvable` before any clause runs. Without the CLIENT-side manifest
  // (startLocalDaemon below) registration's FROST DKG has no consortium and register-agent exits 1.
  // One node cannot satisfy the DKG threshold, hence directoryCount: 3.
  const consortiumHolder = mkdtempSync(join(tmpdir(), "cello-sig-consortium-"));
  dirs.push(consortiumHolder);
  const consortiumManifestPath = join(consortiumHolder, "consortium-manifest.json");
  cluster = await startSpineCluster({
    directoryCount: 3,
    directoryNodeKeysHex: [0, 1, 2].map((i) => spineNodeKeypair(i).privateKeyHex),
    directoryConsortiumManifestPath: consortiumManifestPath,
    onDirectoryUrlsReady: (urls) => {
      writeSignedManifestTo(consortiumManifestPath, urls.map((url, i) => spineDirectoryNode(i, url)));
    },
  });
}, 180_000);
/**
 * A daemon that KNOWS ITS OWN NODE — which is what lets two local agents talk to each other.
 * The client manifest is written OUTSIDE CELLO_DIR so it cannot violate DOD-STORE-1.
 */
async function startLocalDaemon(celloDir: string, label: string): Promise<Proc> {
  const nodes = [0, 1, 2].map((i) => spineDirectoryNode(i, cluster.directoryUrls[i]));
  const manifestDir = mkdtempSync(join(tmpdir(), `cello-manifest-${label}-`));
  dirs.push(manifestDir);
  return startDaemon(celloDir, cluster.directoryUrls[0], label, {
    manifestEnv: writeConsortiumManifest(manifestDir, label, nodes),
  });
}


afterAll(async () => {
  for (const c of mcpConns) await c.close();
  for (const d of daemons) await d.stop();
  await cluster?.stop();
  for (const dir of dirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

interface CelloStatus {
  daemon?: string;
  directory_signaling?: string;
  agents?: unknown[];
}

/** Poll `cello status` until `directory_signaling` reaches `want` (or time out). */
async function waitForSignaling(env: Record<string, string>, want: string, timeoutMs: number): Promise<CelloStatus> {
  const deadline = Date.now() + timeoutMs;
  let last: CelloStatus = {};
  while (Date.now() < deadline) {
    const res = cello(["status"], env);
    try {
      last = JSON.parse(res.stdout.trim()) as CelloStatus;
    } catch {
      /* not JSON yet */
    }
    if (last.directory_signaling === want) return last;
    await sleep(250);
  }
  return last;
}

describe("J-SIG — directory signaling resilience, live (DOD-SIG-1)", () => {
  it("DOD-SIG-1 (degradation) — kill the directory → directory_signaling: reconnecting + tool calls degrade with a bounded reason + guidance", async () => {
    const celloDir = mkdtempSync(join(tmpdir(), "cello-sig-"));
    dirs.push(celloDir);
    await provisionAgent(celloDir, "sigA");
    const daemon = await startLocalDaemon(celloDir, "sigA");
    daemons.push(daemon);
    const env = { CELLO_DIR: celloDir };

    // Establish the connected baseline.
    cello(["login"], env);
    const connected = await waitForSignaling(env, "connected", 12_000);
    expect(connected.directory_signaling, `should reach connected first:\n${daemon.output}`).toBe("connected");

    // Bring sigA online + current on an MCP connection WHILE the directory is up, so a
    // later tool call clears the current-agent precondition and actually reaches the
    // signaling layer (registered → online → current; no DKG needed for this).
    const mcp = await connectMcp(celloDir, "sigA");
    mcpConns.push(mcp);
    const started = (await mcp.call("cello_start_agent", { name: "sigA" })) as { ok?: boolean };
    expect(started.ok, `cello_start_agent failed: ${JSON.stringify(started)}`).toBe(true);
    const used = (await mcp.call("cello_use_agent", { name: "sigA" })) as { ok?: boolean };
    expect(used.ok, `cello_use_agent failed: ${JSON.stringify(used)}`).toBe(true);

    // Kill the directory — the signaling stream breaks under the daemon.
    // ALL of them (not just node 0). This file's subject is what the daemon does when the
    // directory is GONE, and the consortium this test now needs for session setup has three nodes —
    // so stopping `cluster.directory` alone leaves two serving and the daemon never degrades. That
    // would not fail the test, it would make it assert nothing, which is worse.
    for (const d of cluster.directories) await d.stop();

    // The daemon must NOTICE and degrade to reconnecting (heartbeat timeout / stream close),
    // not sit silently on a dead stream.
    const reconnecting = await waitForSignaling(env, "reconnecting", 25_000);
    expect(
      reconnecting.directory_signaling,
      `directory_signaling must flip to reconnecting after the directory dies:\n${daemon.output.split("\n").slice(-40).join("\n")}`,
    ).toBe("reconnecting");

    // A signaling-dependent tool call during the window must return a DISTINCT reason +
    // guidance — never silent, never a hang. cello_initiate_session routes through the
    // current agent's directory signaling stream (current agent is set on this connection).
    //
    // BINARY-ANCHORED: the DoD's example reason is `signaling_reconnecting`, but the real
    // binary surfaces `directory_signaling_timeout` on this path — the per-agent signaling
    // stream is mid-reconnect, so initiate WAITS up to 10s then returns a bounded timeout
    // (rather than the keystone's synchronous reconnecting status). Both are faithful to
    // the DOD-SIG-1 invariant: a distinct signaling-degradation reason + actionable
    // guidance, returned within a bounded window — never silent, never an unbounded hang.
    const t0 = Date.now();
    const result = (await mcp.call("cello_initiate_session", {
      target_pubkey: "a".repeat(64),
    })) as { ok?: boolean; reason?: string; guidance?: string };
    const elapsed = Date.now() - t0;

    expect(result.ok, `tool call must not succeed while reconnecting:\n${JSON.stringify(result)}`).not.toBe(true);
    expect(
      result.reason,
      `tool call must surface a distinct signaling-degradation reason:\n${JSON.stringify(result)}`,
    ).toMatch(/^(signaling_reconnecting|directory_signaling_timeout)$/);
    expect(
      typeof result.guidance === "string" && result.guidance.length > 0,
      `the degradation must carry actionable guidance:\n${JSON.stringify(result)}`,
    ).toBe(true);
    // Bounded — never an unbounded hang (the per-agent signaling timeout is 10s).
    expect(elapsed, `tool call must return within a bounded window, not hang (took ${elapsed}ms)`).toBeLessThan(20_000);
  }, 90_000);

  it("DOD-SIG-1 (recovery) — directory returns → daemon re-auths (no resume token) → directory_signaling back to connected", async () => {
    // Test-order independence: the degradation test above kills the shared directory.
    // Bring a fresh, identical directory up (same key + bootstrap URL) before we begin.
    await cluster.restartDirectory();

    const celloDir = mkdtempSync(join(tmpdir(), "cello-sig-rec-"));
    dirs.push(celloDir);
    await provisionAgent(celloDir, "sigB");
    const daemon = await startLocalDaemon(celloDir, "sigB");
    daemons.push(daemon);
    const env = { CELLO_DIR: celloDir };

    const countConnected = (): number =>
      (daemon.output.match(/"event":"directory\.signaling\.connected"/g) ?? []).length;

    // Connected baseline — the daemon has authenticated once. Wait for the connection
    // log to FLUSH before counting: `cello status` reads live signaling state over IPC,
    // which races ahead of the stdout log pipe (the SPINE-1 flush race).
    cello(["login"], env);
    const connected = await waitForSignaling(env, "connected", 12_000);
    expect(connected.directory_signaling, `should reach connected first:\n${daemon.output}`).toBe("connected");
    await daemon.waitForLine(/"event":"directory\.signaling\.connected"/, 12_000);
    const connectsBeforeKill = countConnected();
    expect(connectsBeforeKill, "should have authenticated at least once").toBeGreaterThanOrEqual(1);

    // Outage: kill the directory → daemon degrades to reconnecting.
    // ALL of them (not just node 0). This file's subject is what the daemon does when the
    // directory is GONE, and the consortium this test now needs for session setup has three nodes —
    // so stopping `cluster.directory` alone leaves two serving and the daemon never degrades. That
    // would not fail the test, it would make it assert nothing, which is worse.
    for (const d of cluster.directories) await d.stop();
    const down = await waitForSignaling(env, "reconnecting", 25_000);
    expect(down.directory_signaling, `must degrade to reconnecting:\n${daemon.output.split("\n").slice(-30).join("\n")}`).toBe(
      "reconnecting",
    );

    // Recovery: the directory returns on the same bootstrap URL. The daemon's resolver
    // re-discovers it and the SignalingManager reconnects on its next backoff attempt.
    await cluster.restartDirectory();
    const recovered = await waitForSignaling(env, "connected", 40_000);
    expect(
      recovered.directory_signaling,
      `directory_signaling must return to connected after the directory comes back:\n${daemon.output.split("\n").slice(-40).join("\n")}`,
    ).toBe("connected");

    // Full re-auth (no resume token): reconnect runs the whole handshake again, so a
    // SECOND directory.signaling.connected is logged — not a silent resume. Poll for the
    // flush (the status flip precedes the log line on the stdout pipe).
    const reauthDeadline = Date.now() + 15_000;
    while (Date.now() < reauthDeadline && countConnected() <= connectsBeforeKill) {
      await sleep(250);
    }
    expect(
      countConnected(),
      `reconnect must perform a full re-auth (a new directory.signaling.connected):\n${daemon.output.split("\n").slice(-40).join("\n")}`,
    ).toBeGreaterThan(connectsBeforeKill);
  }, 120_000);
});
