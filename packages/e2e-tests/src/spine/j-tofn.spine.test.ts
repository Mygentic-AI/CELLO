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
  listenMultiaddr,
  psqlSpineN,
  type SpineCluster,
  type Proc,
} from "./live-harness.js";

let cluster: SpineCluster;
const daemons: Proc[] = [];
const agentDirs: string[] = [];

beforeAll(async () => {
  // Three sovereign directory nodes — the minimum to prove "any T of N, no single
  // node mandatory" (T=2, N=3). Bringing up 3 binaries + migrating 3 DBs is slow.
  cluster = await startSpineCluster({ directoryCount: 3 });
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
      const res = cello(["register", name, token], env);
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
});
