/**
 * J-TOFN — M8B federation, the T-of-N spine (live binaries).
 *
 * The ENFORCER for M8B (DOD-SPINE-1). It brings up **3 real directory binaries** on
 * localhost — each a sovereign node with its OWN signing key, OWN transport key (→ a
 * distinct libp2p PeerID), OWN health/bootstrap port, and OWN fresh-migrated Postgres
 * database (`cello_spine_0/1/2`). This is the substrate every later M8B journey runs on:
 * 2-of-3 DKG, T-of-N seal with a node down, suspend-quorum-refusal, share refresh.
 *
 * This file grows ONE journey at a time (M8B-PROCEDURE §4). DOD-SPINE-1's own green
 * bar is narrow and asserted here: 3 distinct directory nodes come up, each reachable,
 * and each writes ONLY to its own database (sovereign isolation, proven through a real
 * DKG registration against each node — not just by querying DB names). The deeper
 * assertions (2-of-3 DKG / T-of-N sign / suspend) are added red-first INSIDE their own
 * units (DOD-DKG-1, DOD-SIGN-1, …) so the floor stays green per unit.
 *
 * Anchored to the binary — real `cello-directory` × 3 + real `cello-relay` + real
 * `cello-daemon`/`cello`. No library node construction (the dead-stack discipline).
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
  registerAgent,
  listenMultiaddr,
  psqlSpineN,
  writeConsortiumManifest,
  writeForgedManifestTo,
  type SpineCluster,
  type Proc,
} from "./live-harness.js";
import {
  spineDirectoryNode,
  spineNodeId,
  spineNodeKeypair,
  CONSORTIUM_ROOT_KEYS,
  CONSORTIUM_THRESHOLD,
} from "./auth-manifest.js";

let cluster: SpineCluster;
const daemons: Proc[] = [];
const agentDirs: string[] = [];

beforeAll(async () => {
  // Three sovereign directory nodes — the minimum to prove "any T of N, no single
  // node mandatory" (T=2, N=3). Bringing up 3 binaries + migrating 3 DBs is slow.
  // Each node gets its OWN step-5 signing key (DOD-MANIFEST-1) so a 3-node consortium
  // manifest can verify each node's identity; harmless for the no-manifest isolation
  // tests (they run the M6 backward-compat path, step-6 off).
  cluster = await startSpineCluster({
    directoryCount: 3,
    directoryNodeKeysHex: [0, 1, 2].map((i) => spineNodeKeypair(i).privateKeyHex),
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

/** The `/p2p/<peerId>` tail of a multiaddr — a node's stable network identity. */
function peerId(multiaddr: string): string {
  const m = multiaddr.match(/\/p2p\/([^/]+)$/);
  if (!m) throw new Error(`no /p2p/ in multiaddr: ${multiaddr}`);
  return m[1];
}

describe("J-TOFN — 3-directory spine substrate (DOD-SPINE-1)", () => {
  it("spawns 3 directory nodes with distinct network identities + bootstrap URLs", () => {
    // (1) Exactly three real directory procs.
    expect(cluster.directories.length, "expected 3 directory nodes").toBe(3);

    // (2) Three DISTINCT network identities (own transport key → own PeerID).
    const peerIds = cluster.directories.map((d) => peerId(listenMultiaddr(d, { ws: false })));
    expect(new Set(peerIds).size, `directory PeerIDs must be distinct: ${peerIds.join(", ")}`).toBe(3);

    // (3) Three DISTINCT bootstrap/health URLs (own HEALTH_PORT each) + 3 distinct DB URLs.
    expect(new Set(cluster.directoryUrls).size, `directoryUrls must be distinct: ${cluster.directoryUrls.join(", ")}`).toBe(3);
    expect(cluster.directoryUrls.length).toBe(3);
    expect(new Set(cluster.databaseUrls).size, `databaseUrls must be distinct: ${cluster.databaseUrls.join(", ")}`).toBe(3);
  });

  it("each node writes ONLY to its own database — sovereign isolation, real DKG per node", async () => {
    // The teeth (cello-test-attacker DOD-SPINE-1 F1/F2): querying `cello_spine_${i}` by NAME
    // proves the DBs exist, NOT that directory proc i actually uses DB i. A harness bug that
    // points all 3 procs at one DB would pass a name-only check. So drive a REAL registration
    // (full DKG) THROUGH each node's bootstrap URL and prove cross-DB isolation: agent i's
    // K_local row lands in cello_spine_${i} and is ABSENT from every other node's DB.
    //   - It catches the `DATABASE_URL: databaseUrls[0]`-for-all bug: a non-zero node's agent
    //     would then write to DB 0, so cello_spine_1/2 stay empty and the own-DB assert fails.
    //   - Registering against each directoryUrl also proves each URL reaches a LIVE, healthy,
    //     DISTINCT node (a dead/misrouted URL fails registration) — covering F2 (reachability).
    const pubByNode: string[] = [];
    for (let i = 0; i < 3; i++) {
      const celloDir = mkdtempSync(join(tmpdir(), `cello-tofn-${i}-`));
      agentDirs.push(celloDir);
      const name = `agent${i}`;
      // Provision K_local BEFORE the daemon boots so its agent-loader picks it up.
      const pub = await provisionAgent(celloDir, name);
      pubByNode.push(pub);
      const daemon = await startDaemon(celloDir, cluster.directoryUrls[i], `tofn-${i}`);
      daemons.push(daemon);
      const env = { CELLO_DIR: celloDir };

      // Registration needs node i's signaling stream up (else directory_unreachable).
      let connected = false;
      const sigDeadline = Date.now() + 15_000;
      while (Date.now() < sigDeadline) {
        const res = cello(["status"], env);
        try {
          if ((JSON.parse(res.stdout.trim()) as { directory_signaling?: string }).directory_signaling === "connected") {
            connected = true;
            break;
          }
        } catch {
          /* not JSON yet */
        }
        await sleep(250);
      }
      expect(connected, `node ${i} signaling never connected\n${daemon.output.split("\n").slice(-30).join("\n")}`).toBe(true);

      // Real FROST DKG against node i (DEV- token accepted under CELLO_ENV=local).
      const token = `DEV-tofn-${name}-${randomBytes(6).toString("hex")}`;
      const res = registerAgent(name, token, env);
      const diag = `\n--- register node ${i} ---\n${res.stdout}\n--- directory-${i} log ---\n${cluster.directories[i].output.split("\n").slice(-30).join("\n")}`;
      expect(res.status, `register against node ${i} failed:${diag}`).toBe(0);
      expect((JSON.parse(res.stdout.trim()) as { ok?: boolean }).ok, `register against node ${i} not ok:${diag}`).toBe(true);
    }

    // Isolation: each agent's profile row is in its OWN node's DB and NOWHERE else.
    for (let i = 0; i < 3; i++) {
      // setProfile is a fire-and-forget INSERT; poll the owning DB until it commits.
      let inOwn = "0";
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        inOwn = psqlSpineN(i, `SELECT count(*) FROM agent_profiles WHERE k_local_pubkey = '${pubByNode[i]}'`);
        if (inOwn === "1") break;
        await sleep(250);
      }
      expect(inOwn, `agent${i} must be registered in its OWN db cello_spine_${i} (proves proc ${i} uses DB ${i})`).toBe("1");
      for (let j = 0; j < 3; j++) {
        if (j === i) continue;
        const inOther = psqlSpineN(j, `SELECT count(*) FROM agent_profiles WHERE k_local_pubkey = '${pubByNode[i]}'`);
        expect(
          inOther,
          `agent${i} (registered on node ${i}) must NOT appear in node ${j}'s db cello_spine_${j} — sovereign isolation`,
        ).toBe("0");
      }
    }
  }, 180_000);

  it("daemon resolves the FULL 3-node consortium roster from a verified manifest (DOD-MANIFEST-1)", async () => {
    // The client must learn ALL N directory nodes from the signed manifest, not just one.
    // Build a 3-node consortium manifest: each entry's `endpoint` = that node's live bootstrap
    // URL (directoryUrls[i]); each `pubkey` = that node's real step-5 key. The daemon verifies
    // the officer threshold, then resolves each endpoint's /bootstrap to a live multiaddr.
    const celloDir = mkdtempSync(join(tmpdir(), "cello-tofn-manifest-"));
    agentDirs.push(celloDir);
    await provisionAgent(celloDir, "resolver"); // a loadable identity so the daemon's keystone connects
    const nodes = [0, 1, 2].map((i) => spineDirectoryNode(i, cluster.directoryUrls[i]));
    const manifestEnv = writeConsortiumManifest(celloDir, "tofn-roster", nodes);
    // Primary signaling → node 0 (its manifest pubkey matches node 0's step-5 key → step-6 verifies).
    const daemon = await startDaemon(celloDir, cluster.directoryUrls[0], "tofn-roster", { manifestEnv });
    daemons.push(daemon);

    // On manifest-verify the daemon resolves the FULL node set and logs the roster (fires at
    // startup, before the primary connect). This is the N-endpoint resolution that replaces the
    // single-endpoint assumption — the roster a T-of-N ceremony (DOD-DKG-1) fans out to.
    const resolved = await daemon.waitForLine(/"event":"directory\.consortium\.resolved"/, 20_000);
    const parsed = JSON.parse(resolved) as {
      declaredNodes?: number;
      resolvedNodes?: number;
      nodes?: { nodeId: string; peerId: string }[];
    };
    expect(parsed.declaredNodes, `manifest must declare 3 nodes: ${resolved}`).toBe(3);
    expect(parsed.resolvedNodes, `all 3 consortium endpoints must resolve to live directories: ${resolved}`).toBe(3);

    // PAIRWISE binding (not just the set): each manifest nodeId must resolve to ITS OWN
    // directory's real PeerID. A single-endpoint resolver could never produce all three, and a
    // resolver that scrambled the identity↔endpoint pairing would fail here even if the set matched.
    const byNodeId = new Map((parsed.nodes ?? []).map((n) => [n.nodeId, n.peerId]));
    for (let i = 0; i < 3; i++) {
      const dirPeerId = peerId(listenMultiaddr(cluster.directories[i], { ws: false }));
      expect(
        byNodeId.get(spineNodeId(i)),
        `manifest ${spineNodeId(i)} must bind to directory ${i}'s real PeerID: ${resolved}`,
      ).toBe(dirPeerId);
    }
  }, 120_000);

  it("daemon REFUSES a forged 3-node consortium manifest — no silent downgrade (DOD-MANIFEST-1)", async () => {
    // Rejection half of the DoD line: a forged manifest (valid version/window, GARBAGE officer
    // signatures — as a rogue/compromised source would serve) must be refused at load. The daemon
    // logs the failure and will NOT operate on an unverified manifest (no downgrade to the
    // single-endpoint path). This proves forged-manifest rejection on the 3-node spine; expired +
    // rollback rejection share this verifyManifest+refuse path (proven green in J-AUTH).
    const celloDir = mkdtempSync(join(tmpdir(), "cello-tofn-forged-"));
    agentDirs.push(celloDir);
    await provisionAgent(celloDir, "forged");
    const forgedPath = join(celloDir, "forged-consortium-manifest.json");
    const nodes = [0, 1, 2].map((i) => spineDirectoryNode(i, cluster.directoryUrls[i]));
    writeForgedManifestTo(forgedPath, nodes); // correct structure, garbage signatures
    const manifestEnv = {
      CELLO_CONSORTIUM_MANIFEST: forgedPath,
      CELLO_CONSORTIUM_ROOT_KEYS: CONSORTIUM_ROOT_KEYS.join(","),
      CELLO_CONSORTIUM_THRESHOLD: String(CONSORTIUM_THRESHOLD),
    };
    // waitForStarted:false — we expect the daemon to refuse (log load.failed, then throw/exit),
    // never reach daemon.started.
    const daemon = await startDaemon(celloDir, cluster.directoryUrls[0], "tofn-forged", {
      manifestEnv,
      waitForStarted: false,
    });
    daemons.push(daemon);
    const failed = await daemon.waitForLine(/"event":"directory\.auth\.manifest\.load\.failed"/, 15_000);
    expect(failed, `forged manifest must fail verification on signature: ${failed}`).toMatch(/manifest_signature_invalid/);
    // And it must NOT have resolved a consortium roster from the rejected manifest.
    expect(daemon.output).not.toMatch(/"event":"directory\.consortium\.resolved"/);
  }, 120_000);
});
