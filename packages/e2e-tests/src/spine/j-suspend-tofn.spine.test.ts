/**
 * J-SUSPEND-TOFN — M8B quorum-aware suspension (DOD-SUSPEND-1), live binaries.
 *
 * Proves threshold-refusal ≠ single-node-refusal on a 3-node consortium: each directory
 * INDEPENDENTLY honors the replicated suspension flag and refuses its FROST share for a paused
 * agent (#isAgentPaused, fails closed). The arithmetic (N=3 directories, T=3 = client + any 2):
 * SUSPEND on 2 of 3 directories ⇒ only 1 can sign ⇒ < T ⇒ NO signature forms; SUSPEND on 1 ⇒ the
 * other 2 still sign ⇒ T reached ⇒ signature forms. We suspend on nodes 1 & 2 (NOT node 0, the
 * initiator's node) so node 0's single-node initiator gate passes and the ceremony proceeds to the
 * per-node share check — isolating the THRESHOLD arithmetic from the single-node gate.
 *
 * The suspension honor-check JOINs agent_suspensions→agent_profiles per node, but registration writes
 * agent_profiles only on node 0 — so we SEED A's profile to nodes 1,2 (copyAgentProfileBetweenNodes),
 * mimicking the cello_pub replication production needs (M8B-DECISIONS / DoD parked). Anchored to the
 * binaries.
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
  provisionAgent,
  psqlSpineN,
  copyAgentProfileBetweenNodes,
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
  const holder = mkdtempSync(join(tmpdir(), "cello-suspn-consortium-"));
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
const SUSPEND_ACCOUNT = "00000000-0000-0000-0000-0000000000a1";

function setPaused(node: number, agentId: string, paused: boolean): void {
  psqlSpineN(
    node,
    `INSERT INTO agent_suspensions (agent_id, paused, authorized_by_account, updated_at) ` +
      `VALUES ('${agentId}', ${paused}, '${SUSPEND_ACCOUNT}', now()) ` +
      `ON CONFLICT (agent_id) DO UPDATE SET paused = ${paused}, updated_at = now()`,
  );
}

describe("J-SUSPEND-TOFN — quorum-aware suspension (DOD-SUSPEND-1)", () => {
  it("threshold-refusal ≠ single-node: 2 of 3 directories suspended ⇒ no signature; 1 ⇒ still signs", async () => {
    const celloDir = mkdtempSync(join(tmpdir(), "cello-suspn-"));
    agentDirs.push(celloDir);
    const pubA = await provisionAgent(celloDir, "ainit");
    const pubX = await provisionAgent(celloDir, "xtarget");
    const nodes = [0, 1, 2].map((i) => spineDirectoryNode(i, cluster.directoryUrls[i]));
    const manifestEnv = writeConsortiumManifest(celloDir, "suspn", nodes);
    const daemon = await startDaemon(celloDir, cluster.directoryUrls[0], "suspn", { manifestEnv });
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
    expect(connected, "signaling never connected").toBe(true);

    for (const name of ["ainit", "xtarget"]) {
      const r = cello(["register", name, `DEV-suspn-${name}-${randomBytes(6).toString("hex")}`], env);
      expect(r.status, `register ${name} failed: ${r.stdout}`).toBe(0);
    }

    const connA = await connectMcp(celloDir, "suspn-A");
    mcpConns.push(connA);
    expect(((await connA.call("cello_start_agent", { name: "ainit" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connA.call("cello_use_agent", { name: "ainit" })) as { ok?: boolean }).ok).toBe(true);

    // A's directory agent_id (from node 0, the registering node), then SEED A's profile to nodes 1,2
    // so they can honor a suspension (mimics cello_pub replication).
    const agentIdA = psqlSpineN(0, `SELECT agent_id FROM agent_profiles WHERE k_local_pubkey = '${pubA}'`);
    expect(agentIdA, "A must have a directory agent_id").toMatch(/\S/);
    copyAgentProfileBetweenNodes(0, 1, pubA);
    copyAgentProfileBetweenNodes(0, 2, pubA);

    // POSITIVE CONTROL: with NO suspension, A's initiate must succeed (pins the later block to the flag).
    const control = (await connA.call("cello_initiate_session", { target_pubkey: pubX })) as { ok?: boolean; reason?: string; sessionId?: string };
    for (let i = 0; i < 20 && !control.ok && control.reason === "standing_receiver_unavailable"; i++) {
      await sleep(300);
      Object.assign(control, (await connA.call("cello_initiate_session", { target_pubkey: pubX })) as object);
    }
    expect(control.ok, `control (no suspension) must sign: ${JSON.stringify(control)}`).toBe(true);

    // SUSPEND on nodes 1 AND 2 (not node 0). Node 0's initiator gate passes; the ceremony proceeds and
    // nodes 1,2 refuse their shares ⇒ only node 0 can sign ⇒ client+1 = 2 < T=3 ⇒ NO signature.
    setPaused(1, agentIdA, true);
    setPaused(2, agentIdA, true);
    const blocked = (await connA.call("cello_initiate_session", { target_pubkey: pubX })) as { ok?: boolean; reason?: string };
    expect(blocked.ok, `2 suspended directories must block signing: ${JSON.stringify(blocked)}`).toBe(false);
    // NOT agent_suspended — node 0 (the initiator's node) is NOT paused; this is a THRESHOLD failure,
    // proving the per-node share refusal (not the single-node initiator gate).
    expect(blocked.reason, `block must be a threshold failure, not the single-node gate: ${JSON.stringify(blocked)}`).not.toBe("agent_suspended");

    // UN-SUSPEND node 2 (only node 1 suspended now) ⇒ the FROST signer EXCLUDES the refusing node 1 (the
    // route-around fix: the COMMIT round now excludes a refusing/failing stub, mirroring the sign round)
    // and nodes 0,2 sign ⇒ client+2 = T=3 ⇒ signature forms. Proves a SINGLE node's refusal does NOT
    // block — the whole point of DOD-SUSPEND-1: threshold-refusal ≠ single-node-refusal.
    setPaused(2, agentIdA, false);
    let signs = (await connA.call("cello_initiate_session", { target_pubkey: pubX })) as { ok?: boolean; reason?: string };
    for (let i = 0; i < 20 && !signs.ok && signs.reason === "standing_receiver_unavailable"; i++) {
      await sleep(300);
      signs = (await connA.call("cello_initiate_session", { target_pubkey: pubX })) as { ok?: boolean; reason?: string };
    }
    expect(signs.ok, `1 suspended directory must NOT block (survivors reach T): ${JSON.stringify(signs)}`).toBe(true);
  }, 240_000);
});
