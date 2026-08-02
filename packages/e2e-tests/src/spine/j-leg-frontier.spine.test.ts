/**
 * J-LEG-FRONTIER — DOD-LEG-2 (SESSION-004 SI-002), the NEGATIVE case, live binaries.
 *
 * The directory is started with an env seam that INFLATES every party's published
 * content_frontier_seq in the FROST-signed legibility (simulating a buggy/malicious directory).
 * Because the inflation happens BEFORE the TBS binding, the inflated value is signed — so the
 * client's signature check passes. Only the client's INDEPENDENT re-derivation from the signed
 * leaves can catch it: B re-derives the honest frontier, sees published > derived, and REJECTS
 * the certificate (`certificate_frontier_unverifiable`) without persisting it.
 *
 * Its own cluster (separate from J-LEGIBILITY) so the inflation env does not perturb the
 * happy-path tests; spine files run sequentially (maxThreads=1) so there is no DB contention.
 *
 * Anchored to the binary — real cello-directory + cello-relay + cello-daemon + cello-mcp.
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
  registerAgent,
  writeSignedManifestTo,
  writeConsortiumManifest,
  type SpineCluster,
  type Proc,
  type McpConn,
} from "./live-harness.js";
import { spineDirectoryNode, spineNodeKeypair } from "./auth-manifest.js";

let cluster: SpineCluster;
const daemons: Proc[] = [];
const dirs: string[] = [];
const mcpConns: McpConn[] = [];

beforeAll(async () => {
  // The directory inflates every published content_frontier_seq by 10 (still FROST-signed).
  // A THREE-node consortium with a signed manifest — the pattern j-content / j-unilateral use.
  // Without it the daemon never learns its own directory node id, so two LOCAL agents are routed
  // down the CROSS-NODE path and cello_initiate_session dies on `discovery_node_unresolvable`
  // before any clause runs; and without the CLIENT-side manifest below, registration's FROST DKG
  // has no consortium and `cello register-agent` exits 1. A one-node cluster cannot satisfy the
  // DKG threshold either, hence directoryCount: 3.
  const holder = mkdtempSync(join(tmpdir(), "cello-frontier-consortium-"));
  dirs.push(holder);
  const consortiumManifestPath = join(holder, "consortium-manifest.json");
  cluster = await startSpineCluster({
    directoryInflateFrontierForTest: 10,
    directoryCount: 3,
    directoryNodeKeysHex: [0, 1, 2].map((i) => spineNodeKeypair(i).privateKeyHex),
    directoryConsortiumManifestPath: consortiumManifestPath,
    onDirectoryUrlsReady: (urls) => {
      writeSignedManifestTo(consortiumManifestPath, urls.map((url, i) => spineDirectoryNode(i, url)));
    },
  });
}, 180_000);
/** A daemon that KNOWS ITS OWN NODE — which is what lets two local agents talk to each other. */
async function startLocalDaemon(celloDir: string, label: string): Promise<Proc> {
  const nodes = [0, 1, 2].map((i) => spineDirectoryNode(i, cluster.directoryUrls[i]));
  return startDaemon(celloDir, cluster.directoryUrls[0], label, {
    manifestEnv: writeConsortiumManifest(celloDir, label, nodes),
  });
}


afterAll(async () => {
  for (const c of mcpConns) await c.close();
  for (const d of daemons) await d.stop();
  await cluster?.stop();
  for (const dir of dirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

describe("J-LEG-FRONTIER — inflated published frontier is rejected (DOD-LEG-2 / SI-002)", () => {
  it("a directory-inflated content_frontier_seq → B re-derives, detects inflation, rejects certificate_frontier_unverifiable", async () => {
    const celloDirA = mkdtempSync(join(tmpdir(), "cello-frA-"));
    const celloDirB = mkdtempSync(join(tmpdir(), "cello-frB-"));
    dirs.push(celloDirA, celloDirB);
    const pubB = await provisionAgent(celloDirB, "agentB");
    await provisionAgent(celloDirA, "agentA");
    const daemonA = await startLocalDaemon(celloDirA, "frA");
    const daemonB = await startLocalDaemon(celloDirB, "frB");
    daemons.push(daemonA, daemonB);
    expect(registerAgent("agentA", `DEV-fr-A-${randomBytes(6).toString("hex")}`, { CELLO_DIR: celloDirA }).status).toBe(0);
    expect(registerAgent("agentB", `DEV-fr-B-${randomBytes(6).toString("hex")}`, { CELLO_DIR: celloDirB }).status).toBe(0);

    const connA = await connectMcp(celloDirA, "fr-A");
    const connB = await connectMcp(celloDirB, "fr-B");
    mcpConns.push(connA, connB);
    for (const [c, n] of [[connA, "agentA"], [connB, "agentB"]] as const) {
      expect(((await c.call("cello_start_agent", { name: n })) as { ok?: boolean }).ok).toBe(true);
      expect(((await c.call("cello_use_agent", { name: n })) as { ok?: boolean }).ok).toBe(true);
    }

    const awaitP = connB.call("cello_await_session", { timeout_ms: 25_000 });
    const init = (await connA.call("cello_initiate_session", { target_pubkey: pubB })) as { ok?: boolean; sessionId?: string };
    expect(init.ok, `initiate failed: ${JSON.stringify(init)}`).toBe(true);
    const sessionId = init.sessionId!;
    expect(((await awaitP) as { type?: string }).type).toBe("new_session");

    // One exchanged message so both parties have signed leaves (a real frontier to inflate).
    expect(((await connA.call("cello_send", { cello_session_id: sessionId, content: "hi", signal: "over" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connB.call("cello_receive", { cello_session_id: sessionId, timeout_ms: 15_000 })) as { content?: string | null }).content).toBe(`hi [[OVER]]`);
    expect(((await connB.call("cello_send", { cello_session_id: sessionId, content: "ok", signal: "over" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connA.call("cello_receive", { cello_session_id: sessionId, timeout_ms: 15_000 })) as { content?: string | null }).content).toBe(`ok [[OVER]]`);

    // Both close → bilateral FROST seal. The directory inflates the published frontier (+10) and
    // signs it. The closes may not resolve as success (B refuses the unverifiable cert) — that is
    // the point; fire them and assert on B's daemon log rather than the close return.
    void connA.call("cello_close_session", { cello_session_id: sessionId }).catch(() => undefined);
    void connB.call("cello_close_session", { cello_session_id: sessionId }).catch(() => undefined);

    // The directory inflated + FROST-bound the legibility (test seam fired).
    await cluster.directory.waitForLine(/"event":"seal\.certificate\.frontier\.inflated_for_test"/, 30_000);

    // The co-signing initiator (either party — whichever submits the first SEAL ctrl leaf)
    // independently re-derives the honest frontier from the signed leaves, detects the inflation,
    // and REFUSES to co-sign → the directory gets NO FROST signature → the seal never completes.
    const re = /"event":"session\.seal\.ceremony\.abort"[^\n]*"reason":"frontier_unverifiable"/;
    const abortLine = await Promise.any([
      daemonA.waitForLine(re, 25_000),
      daemonB.waitForLine(re, 25_000),
    ]);
    expect(abortLine, "the co-signer names the inflated published value").toMatch(/"publishedFrontier":\d+/);
    expect(abortLine).toMatch(/"derivedFrontier":\d+/);

    // No seal is produced: neither party ever accepts a frontier, and no sealed receipt exists.
    expect(daemonA.output + daemonB.output, "the inflated frontier must never be accepted").not.toMatch(/"event":"seal\.certificate\.frontier\.verified"/);
    const receipt = (await connB.call("cello_sealed_receipt", { cello_session_id: sessionId })) as { ok?: boolean };
    expect(receipt.ok, "no sealed receipt exists when the seal is refused").not.toBe(true);
  }, 90_000);
});
