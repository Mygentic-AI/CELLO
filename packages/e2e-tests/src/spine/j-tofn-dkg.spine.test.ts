/**
 * J-TOFN-DKG — M8B multi-node FROST DKG (DOD-DKG-1), live binaries.
 *
 * The T-of-N key-generation half: a 3-node consortium where registration runs a REAL
 * interactive FROST DKG across the client + ALL 3 directory nodes (each holds its own
 * K_server share for ONE group key). This is the consortium world — distinct from the
 * SPINE-1 substrate (j-tofn.spine.test.ts), where the 3 nodes are independent and
 * registration is single-node. Here the directories are configured with the SAME signed
 * consortium manifest, so each derives participants:3, threshold:3 (the DoD's "2-of-3":
 * client + any 2 of 3 directory nodes sign — DKG itself needs all 3 present).
 *
 * Anchored to the binaries — real cello-directory ×3 + relay + cello-daemon/cello.
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
  cello,
  writeConsortiumManifest,
  writeSignedManifestTo,
  type SpineCluster,
  type Proc,
} from "./live-harness.js";
import { spineDirectoryNode, spineNodeKeypair } from "./auth-manifest.js";

let cluster: SpineCluster;
let consortiumManifestPath: string;
const daemons: Proc[] = [];
const agentDirs: string[] = [];

beforeAll(async () => {
  // Shared consortium-manifest path handed to ALL 3 directories at spawn. The directory's
  // FileDirectoryManifestStore re-reads it on every getCurrentManifest() call, so we can
  // write it AFTER the cluster is up (when the directories' real bootstrap URLs are known).
  const holder = mkdtempSync(join(tmpdir(), "cello-dkg-consortium-"));
  agentDirs.push(holder);
  consortiumManifestPath = join(holder, "consortium-manifest.json");
  cluster = await startSpineCluster({
    directoryCount: 3,
    directoryNodeKeysHex: [0, 1, 2].map((i) => spineNodeKeypair(i).privateKeyHex),
    directoryConsortiumManifestPath: consortiumManifestPath,
    // The directories read this manifest at STARTUP — write it (with their real bootstrap
    // URLs) BEFORE they spawn, via the pre-spawn hook.
    onDirectoryUrlsReady: (urls) => {
      writeSignedManifestTo(
        consortiumManifestPath,
        urls.map((url, i) => spineDirectoryNode(i, url)),
      );
    },
  });
}, 300_000);

afterAll(async () => {
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

describe("J-TOFN-DKG — multi-node 2-of-3 FROST DKG (DOD-DKG-1)", () => {
  it("registration fans the DKG ceremony to ALL 3 directory nodes (one group key)", async () => {
    const celloDir = mkdtempSync(join(tmpdir(), "cello-dkg-"));
    agentDirs.push(celloDir);
    const name = "dkgagent";
    await provisionAgent(celloDir, name);
    // The client verifies the SAME 3-node consortium manifest → resolves the full roster →
    // fans the DKG across all 3 directory nodes.
    const manifestEnv = writeConsortiumManifest(
      celloDir,
      name,
      [0, 1, 2].map((i) => spineDirectoryNode(i, cluster.directoryUrls[i])),
    );
    const daemon = await startDaemon(celloDir, cluster.directoryUrls[0], name, { manifestEnv });
    daemons.push(daemon);
    const env = { CELLO_DIR: celloDir };

    // Registration needs the primary directory's signaling stream up.
    let connected = false;
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const r = cello(["status"], env);
      try {
        if ((JSON.parse(r.stdout.trim()) as { directory_signaling?: string }).directory_signaling === "connected") {
          connected = true;
          break;
        }
      } catch {
        /* not JSON yet */
      }
      await sleep(250);
    }
    expect(connected, `signaling never connected\n${daemon.output.split("\n").slice(-30).join("\n")}`).toBe(true);

    // Real multi-node FROST DKG.
    const token = `DEV-dkg-${randomBytes(6).toString("hex")}`;
    const res = cello(["register", name, token], env);
    expect(res.status, `register failed: ${res.stdout}`).toBe(0);
    const parsed = JSON.parse(res.stdout.trim()) as { ok?: boolean; primary_pubkey?: string };
    expect(parsed.ok, `register not ok: ${res.stdout}`).toBe(true);
    expect(parsed.primary_pubkey, "DKG must produce a group key").toMatch(/^[0-9a-f]{64}$/);

    // The directories capture stdout via async pipe 'data' events that lag the IPC response —
    // let their DKG logs flush before inspecting them.
    await sleep(2000);
    const dirDkgLogs = cluster.directories
      .map((d, i) => `--- directory-${i} ---\n${d.output.split("\n").filter((l) => /DKG begin|Round [0-9]/i.test(l)).join("\n")}`)
      .join("\n");

    // The primary directory derived the topology from its OWN verified manifest: 3 nodes,
    // threshold 3 (the DoD's "2-of-3": client + any 2 of 3 directory nodes).
    const dkgBeginLine =
      cluster.directories[0].output.split("\n").find((l) => l.includes("DKG begin")) ?? "(no DKG begin line)";
    // M8B quorum: with all 3 up the quorum is all 3; T = majority(3) = 2 (was all-N t=3).
    expect(dkgBeginLine, `primary DKG topology:\n${dirDkgLogs}`).toMatch(/3 of 3 directory nodes \(quorum\), threshold 2/);

    // ALL 3 directory nodes ran the DKG ceremony — each received a FROST stream and ran round 1.
    // A single-node DKG (the thing replaced) would touch only the primary.
    for (let i = 0; i < 3; i++) {
      expect(cluster.directories[i].output, `directory ${i} must participate in the DKG:\n${dirDkgLogs}`).toMatch(
        /Round 1 commit from peer/,
      );
    }

    // M8B Problem 1 (availability, FINDING-8): every DKG participant — not only the coordinator that
    // fields register_request (node 0, the signaling node) — must register the agent's in-memory signer
    // at round 3, so a NON-coordinator can serve a session-initiate for this agent without a reboot.
    // Assert the two non-coordinator nodes (1 and 2) logged the participant signer registration.
    const signerLogs = cluster.directories
      .map((d, i) => `--- directory-${i} ---\n${d.output.split("\n").filter((l) => l.includes("participant.signer.registered")).join("\n")}`)
      .join("\n");
    for (let i = 1; i < 3; i++) {
      expect(
        cluster.directories[i].output,
        `non-coordinator directory ${i} must register the agent's signer at round 3 (FINDING-8):\n${signerLogs}`,
      ).toMatch(/directory\.dkg\.participant\.signer\.registered/);
    }
  }, 120_000);

  it("quorum: kill one directory → registration still succeeds among the 2-node quorum (T=majority(3)=2)", async () => {
    // M8B Problem 2: kill directory index 2 (a NON-signaling node — the daemon connects to directory 0).
    // A fresh agent's client resolves only the 2 live nodes (R = 2), reports them, and the coordinator
    // registers among Q=2 with T=majority(3)=2. Under the old all-N code this REFUSED (dkg_below_threshold).
    await cluster.directories[2].kill();
    await sleep(1500);

    const celloDir = mkdtempSync(join(tmpdir(), "cello-quorum-"));
    agentDirs.push(celloDir);
    const name = "quorumagent";
    await provisionAgent(celloDir, name);
    const manifestEnv = writeConsortiumManifest(
      celloDir,
      name,
      [0, 1, 2].map((i) => spineDirectoryNode(i, cluster.directoryUrls[i])),
    );
    const daemon = await startDaemon(celloDir, cluster.directoryUrls[0], name, { manifestEnv });
    daemons.push(daemon);
    const env = { CELLO_DIR: celloDir };

    let connected = false;
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const r = cello(["status"], env);
      try {
        if ((JSON.parse(r.stdout.trim()) as { directory_signaling?: string }).directory_signaling === "connected") {
          connected = true;
          break;
        }
      } catch {
        /* not JSON yet */
      }
      await sleep(250);
    }
    expect(connected, `signaling never connected\n${daemon.output.split("\n").slice(-30).join("\n")}`).toBe(true);

    const token = `DEV-quorum-${randomBytes(6).toString("hex")}`;
    const res = cello(["register", name, token], env);
    expect(
      res.status,
      `quorum register failed (a node is down — should still register among the quorum): ${res.stdout}\n${daemon.output.split("\n").slice(-40).join("\n")}`,
    ).toBe(0);
    const parsed = JSON.parse(res.stdout.trim()) as { ok?: boolean; primary_pubkey?: string };
    expect(parsed.ok, `quorum register not ok: ${res.stdout}`).toBe(true);
    expect(parsed.primary_pubkey, "quorum DKG must produce a group key").toMatch(/^[0-9a-f]{64}$/);

    await sleep(2000);
    // The DKG ran among the 2-node quorum (dir 2 dead), threshold majority(3)=2. Take the latest DKG begin.
    const dkgBeginLines = cluster.directories[0].output.split("\n").filter((l) => l.includes("DKG begin"));
    const dkgBeginLine = dkgBeginLines[dkgBeginLines.length - 1] ?? "(no DKG begin line)";
    expect(dkgBeginLine, `quorum DKG topology:\n${dkgBeginLines.join("\n")}`).toMatch(
      /2 of 3 directory nodes \(quorum\), threshold 2/,
    );
  }, 120_000);

  // The below-threshold REFUSAL gate (resolved roster < the directory's declared N ⇒
  // dkg_below_threshold) is proven by a deterministic in-process unit test in cello-client's
  // registration-manager.test.ts — a spine version is flaky under multi-daemon contention
  // (registration can fail on signaling BEFORE reaching the gate), so the gate logic is asserted
  // directly where it lives.
});
