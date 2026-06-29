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
    // F1 (test-attacker): retry-wrap the block on the SAME transient (standing_receiver_unavailable) as
    // control/signs. Without this symmetry the block has no retry, so a flaky transient could satisfy a
    // loose `ok===false` and masquerade as the threshold block.
    let blocked = (await connA.call("cello_initiate_session", { target_pubkey: pubX })) as { ok?: boolean; reason?: string };
    for (let i = 0; i < 20 && !blocked.ok && blocked.reason === "standing_receiver_unavailable"; i++) {
      await sleep(300);
      blocked = (await connA.call("cello_initiate_session", { target_pubkey: pubX })) as { ok?: boolean; reason?: string };
    }
    expect(blocked.ok, `2 suspended directories must block signing: ${JSON.stringify(blocked)}`).toBe(false);
    // EXACT reason — not merely "not agent_suspended" (which accepts ~18 unrelated/transient failures).
    // The client-side FROST signer returns DIRECTORY_BELOW_THRESHOLD; the delegated session-request path
    // collapses a sub-threshold ceremony to a null signature, which the directory's ClientDelegatedSigner
    // re-derives as CEREMONY_EXHAUSTED → wire reason `ceremony_exhausted`. This is the GENUINE
    // threshold-refusal signature: the ceremony RAN and could not reach T because nodes 1,2 refused.
    expect(blocked.reason, `block must be the threshold-refusal reason ceremony_exhausted: ${JSON.stringify(blocked)}`).toBe("ceremony_exhausted");

    // F3 (test-attacker, agent-scoped redundancy): a SECOND agent B, seeded to nodes 1,2 and NOT
    // suspended, must STILL sign through those same nodes while A is suspended there. Proves the refusal
    // is scoped to agent A — not the whole node going dark (which would pass A's assertions identically
    // yet violate the sovereign-node redundancy invariant: suspending A must not disable 1/2 for others).
    const connB = await connectMcp(celloDir, "suspn-B");
    mcpConns.push(connB);
    // Create B THROUGH the running daemon: provisionAgent only writes a pre-daemon key file the live
    // daemon never rescans (→ agent_not_found). cello_create_agent runtime-adds B and returns its
    // K_local pubkey (same identity provisionAgent returns for A/X, created before the daemon started).
    const createB = (await connB.call("cello_create_agent", { name: "binit" })) as { ok?: boolean; pubkey?: string };
    expect(createB.ok, `create binit failed: ${JSON.stringify(createB)}`).toBe(true);
    const pubB = createB.pubkey!;
    expect(pubB, "binit must have a K_local pubkey").toMatch(/^[0-9a-f]{64}$/);
    {
      const r = cello(["register", "binit", `DEV-suspn-binit-${randomBytes(6).toString("hex")}`], env);
      expect(r.status, `register binit failed: ${r.stdout}`).toBe(0);
    }
    expect(((await connB.call("cello_start_agent", { name: "binit" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connB.call("cello_use_agent", { name: "binit" })) as { ok?: boolean }).ok).toBe(true);
    copyAgentProfileBetweenNodes(0, 1, pubB);
    copyAgentProfileBetweenNodes(0, 2, pubB);
    let bSigns = (await connB.call("cello_initiate_session", { target_pubkey: pubX })) as { ok?: boolean; reason?: string };
    for (let i = 0; i < 20 && !bSigns.ok && bSigns.reason === "standing_receiver_unavailable"; i++) {
      await sleep(300);
      bSigns = (await connB.call("cello_initiate_session", { target_pubkey: pubX })) as { ok?: boolean; reason?: string };
    }
    expect(bSigns.ok, `agent B (not suspended) must sign through nodes 1,2 while A is suspended there — refusal must be agent-scoped, not node-wide: ${JSON.stringify(bSigns)}`).toBe(true);

    // UN-SUSPEND node 2 (only node 1 suspended now) ⇒ the FROST signer EXCLUDES the refusing node 1 (the
    // route-around fix: the COMMIT round now excludes a refusing/failing stub, mirroring the sign round)
    // and nodes 0,2 sign ⇒ client+2 = T=3 ⇒ signature forms. Proves a SINGLE node's refusal does NOT
    // block — the whole point of DOD-SUSPEND-1: threshold-refusal ≠ single-node-refusal.
    setPaused(2, agentIdA, false);
    // F2 (test-attacker): POSITIVE CONTROL that node 1 genuinely refused A's share DURING this ceremony
    // (not that survivors trivially reached T without ever asking node 1). (a) node 1's OWN db must show
    // A suspended right now; (b) node 1 must emit a FRESH frost.ceremony.refused.revoked for A.
    const node1ShowsASuspended = psqlSpineN(
      1,
      `SELECT 1 FROM agent_suspensions s JOIN agent_profiles p ON p.agent_id = s.agent_id ` +
        `WHERE p.k_local_pubkey = '${pubA}' AND s.paused = true LIMIT 1`,
    );
    expect(node1ShowsASuspended, "node 1 must independently show A suspended before the route-around").toMatch(/\S/);
    const refusedReA = new RegExp(`frost\\.ceremony\\.refused\\.revoked.*${pubA.slice(0, 16)}`);
    const refusedBefore = cluster.directories[1].countLines(refusedReA);
    let signs = (await connA.call("cello_initiate_session", { target_pubkey: pubX })) as { ok?: boolean; reason?: string };
    for (let i = 0; i < 20 && !signs.ok && signs.reason === "standing_receiver_unavailable"; i++) {
      await sleep(300);
      signs = (await connA.call("cello_initiate_session", { target_pubkey: pubX })) as { ok?: boolean; reason?: string };
    }
    expect(signs.ok, `1 suspended directory must NOT block (survivors reach T): ${JSON.stringify(signs)}`).toBe(true);
    // stdout-capture lag (DKG-1 lesson): let node 1's refusal line surface before counting the delta.
    await sleep(2000);
    const refusedAfter = cluster.directories[1].countLines(refusedReA);
    expect(
      refusedAfter,
      `node 1 must emit a FRESH suspension-refusal for A during the route-around ceremony (before=${refusedBefore} after=${refusedAfter}) — proving survivors routed AROUND a genuinely-refusing node, not that node 1 was never asked`,
    ).toBeGreaterThan(refusedBefore);
  }, 300_000);
});
