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
  cello,
  type SpineCluster,
  type Proc,
  type McpConn,
} from "./live-harness.js";

let cluster: SpineCluster;
const daemons: Proc[] = [];
const dirs: string[] = [];
const mcpConns: McpConn[] = [];

beforeAll(async () => {
  // The directory inflates every published content_frontier_seq by 10 (still FROST-signed).
  cluster = await startSpineCluster({ directoryInflateFrontierForTest: 10 });
}, 180_000);

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
    const daemonA = await startDaemon(celloDirA, cluster.directoryUrl, "frA");
    const daemonB = await startDaemon(celloDirB, cluster.directoryUrl, "frB");
    daemons.push(daemonA, daemonB);
    expect(cello(["register", "agentA", `DEV-fr-A-${randomBytes(6).toString("hex")}`], { CELLO_DIR: celloDirA }).status).toBe(0);
    expect(cello(["register", "agentB", `DEV-fr-B-${randomBytes(6).toString("hex")}`], { CELLO_DIR: celloDirB }).status).toBe(0);

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
    expect(((await connA.call("cello_send", { session_id: sessionId, content: "hi" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connB.call("cello_receive", { session_id: sessionId, timeout_ms: 15_000 })) as { content?: string | null }).content).toBe("hi");
    expect(((await connB.call("cello_send", { session_id: sessionId, content: "ok" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connA.call("cello_receive", { session_id: sessionId, timeout_ms: 15_000 })) as { content?: string | null }).content).toBe("ok");

    // Both close → bilateral FROST seal. The directory inflates the published frontier (+10) and
    // signs it. The closes may not resolve as success (B refuses the unverifiable cert) — that is
    // the point; fire them and assert on B's daemon log rather than the close return.
    void connA.call("cello_close_session", { session_id: sessionId }).catch(() => undefined);
    void connB.call("cello_close_session", { session_id: sessionId }).catch(() => undefined);

    // The directory built + signed an inflated legibility (test seam fired).
    await cluster.directory.waitForLine(/"event":"seal\.certificate\.frontier\.inflated_for_test"/, 30_000);

    // B re-derives the honest frontier from the signed leaves, detects the inflation, and REJECTS.
    const rejected = await daemonB.waitForLine(/"event":"seal\.certificate\.frontier\.unverifiable"/, 30_000);
    // The rejection names the inflated published value and the lower re-derived value.
    expect(rejected).toMatch(/"publishedFrontier":\d+/);
    expect(rejected).toMatch(/"derivedFrontier":\d+/);

    // The unverifiable certificate is NEVER accepted: B does not log the verified path, and the
    // sealed receipt is not readable (the cert was not persisted).
    expect(daemonB.output, "B must not accept the inflated frontier").not.toMatch(/"event":"seal\.certificate\.frontier\.verified"/);
    const receipt = (await connB.call("cello_get_sealed_receipt", { session_id: sessionId })) as { ok?: boolean };
    expect(receipt.ok, "no sealed receipt is persisted for a rejected (unverifiable) certificate").not.toBe(true);
  }, 90_000);
});
