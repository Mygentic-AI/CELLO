/**
 * J-SUSPEND — CELLO-M8-LEVER-001 (DOD-SPINE-4 / DOD-INV-6 / DOD-LEVER-1), live binaries.
 *
 * The reversible suspend lever, at the honor-check scope: a PAUSED agent cannot complete a FROST
 * signing ceremony — the block is SERVER-SIDE (the federation refuses), so a valid client share does
 * not help, and it would hold even if the operator's own device were the compromise (SI-001). Pause
 * is reversible: clearing the flag restores signing.
 *
 * Anchored to the binary — real cello-directory + cello-relay + cello-daemon, driven via the `cello`
 * CLI + MCP. Agent A registers (real DKG → a persisted, VALID FROST client share) and is online. We
 * set the replicated pause flag in agent_suspensions exactly as the write seam (WRITEAPI-001, proven
 * separately) would, keyed by A's directory agent_id, then assert A's OWN cello_initiate_session is
 * refused with `agent_suspended` — even though its client share is valid — and that un-pausing
 * restores it. A hollow "suspend = a local flag the client honors" fails here: the flag lives only in
 * the directory's Postgres, and the refusal is the directory's, read back from the MCP response.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  startSpineCluster,
  startDaemon,
  connectMcp,
  cello,
  registerAgent,
  psqlSpineN,
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
  const consortiumHolder = mkdtempSync(join(tmpdir(), "cello-suspend-consortium-"));
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
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

type Status = { directory_signaling?: string };
function status(dir: string): Status {
  return JSON.parse(cello(["status"], { CELLO_DIR: dir }).stdout) as Status;
}
const waitConnected = async (dir: string): Promise<void> => {
  for (let i = 0; i < 50; i++) {
    if ((status(dir).directory_signaling ?? "") === "connected") return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`directory_signaling never connected for ${dir}`);
};

describe("J-SUSPEND — pause blocks signing, reversible (CELLO-M8-LEVER-001 DOD-SPINE-4/INV-6)", () => {
  it("AC-001: pause A → A's cello_initiate_session fails (agent_suspended) with a valid share; un-pause restores", async () => {
    // Target X: registered (offline is fine — the suspend gate fires before any reachability check).
    const dirX = mkdtempSync(join(tmpdir(), "cello-suspX-"));
    dirs.push(dirX);
    daemons.push(await startLocalDaemon(dirX, "suspX"));
    const cX = JSON.parse(cello(["create-agent", "xtarget"], { CELLO_DIR: dirX }).stdout) as { pubkey: string };
    const pubX = cX.pubkey;
    await waitConnected(dirX);
    expect(registerAgent("xtarget", `DEV-suspx-${randomBytes(6).toString("hex")}`, { CELLO_DIR: dirX }).status).toBe(0);

    // Initiator A: registered + online, holding a VALID FROST client share (real DKG).
    const dirA = mkdtempSync(join(tmpdir(), "cello-suspA-"));
    dirs.push(dirA);
    daemons.push(await startLocalDaemon(dirA, "suspA"));
    const cA = JSON.parse(cello(["create-agent", "ainit"], { CELLO_DIR: dirA }).stdout) as { pubkey: string };
    const pubA = cA.pubkey;
    await waitConnected(dirA);
    expect(registerAgent("ainit", `DEV-suspa-${randomBytes(6).toString("hex")}`, { CELLO_DIR: dirA }).status).toBe(0);
    const connA = await connectMcp(dirA, "susp-A");
    mcpConns.push(connA);
    expect(((await connA.call("cello_start_agent", { name: "ainit" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connA.call("cello_use_agent", { name: "ainit" })) as { ok?: boolean }).ok).toBe(true);

    // POSITIVE CONTROL (test-attacker): BEFORE pause, A initiating must NOT be refused with
    // agent_suspended — this pins the refusal to the flag, not an always-refuse gate. (X is
    // registered-but-offline, so the expected non-suspended outcome is some OTHER reason.)
    const before = (await connA.call("cello_initiate_session", { target_pubkey: pubX })) as { ok?: boolean; reason?: string };
    expect(before.reason, `a non-suspended initiator must NOT be agent_suspended: ${JSON.stringify(before)}`).not.toBe("agent_suspended");

    // PAUSE A — write the replicated flag exactly as the write seam (WRITEAPI-001) would: a paused
    // row keyed by A's DIRECTORY agent_id. The portal→seam path is proven by WRITEAPI-001; here we
    // prove the directory HONOR-CHECK refuses A's ceremony.
    const agentIdA = psqlSpineN(0, `SELECT agent_id FROM agent_profiles WHERE k_local_pubkey = '${pubA}'`);
    expect(agentIdA, "A must have a directory agent_id after registration").toMatch(/\S/);
    psqlSpineN(0, 
      `INSERT INTO agent_suspensions (agent_id, paused, authorized_by_account, updated_at) ` +
      `VALUES ('${agentIdA}', true, '00000000-0000-0000-0000-0000000000a1', now()) ` +
      `ON CONFLICT (agent_id) DO UPDATE SET paused = true, updated_at = now()`,
    );

    // AFTER pause: A's OWN cello_initiate_session FAILS with agent_suspended — the directory refuses
    // even though A's client share is valid (server-side block, SI-001). The ONLY thing that changed
    // between `before` and here is the directory-side pause flag.
    const afterPause = (await connA.call("cello_initiate_session", { target_pubkey: pubX })) as { ok?: boolean; reason?: string };
    expect(afterPause.ok, `a paused initiator must fail to sign: ${JSON.stringify(afterPause)}`).toBe(false);
    expect(afterPause.reason, "the directory must refuse a paused initiator with agent_suspended").toBe("agent_suspended");

    // UN-PAUSE A → signing restored: the reason is no longer agent_suspended (reversible — DOD-LEVER-1).
    psqlSpineN(0, `UPDATE agent_suspensions SET paused = false, updated_at = now() WHERE agent_id = '${agentIdA}'`);
    const afterClear = (await connA.call("cello_initiate_session", { target_pubkey: pubX })) as { ok?: boolean; reason?: string };
    expect(afterClear.reason, `un-pause must restore signing (no longer agent_suspended): ${JSON.stringify(afterClear)}`).not.toBe("agent_suspended");
  }, 150_000);
});
