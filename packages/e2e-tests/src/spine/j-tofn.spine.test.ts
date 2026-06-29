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
 * bar is narrow and asserted here: 3 distinct directory nodes come up, each with an
 * independently-migrated DB, all reachable. The deeper assertions (DKG / sign / suspend)
 * are added red-first INSIDE their own units (DOD-DKG-1, DOD-SIGN-1, …) so the floor
 * stays green per unit.
 *
 * Anchored to the binary — real `cello-directory` × 3 + real `cello-relay`. No library
 * node construction (the dead-stack discipline; see live-harness.ts header).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  startSpineCluster,
  listenMultiaddr,
  psqlSpineN,
  type SpineCluster,
} from "./live-harness.js";

let cluster: SpineCluster;

beforeAll(async () => {
  // Three sovereign directory nodes — the minimum to prove "any T of N, no single
  // node mandatory" (T=2, N=3). Bringing up 3 binaries + migrating 3 DBs is slow.
  cluster = await startSpineCluster({ directoryCount: 3 });
}, 300_000);

afterAll(async () => {
  await cluster?.stop();
});

/** The `/p2p/<peerId>` tail of a multiaddr — a node's stable network identity. */
function peerId(multiaddr: string): string {
  const m = multiaddr.match(/\/p2p\/([^/]+)$/);
  if (!m) throw new Error(`no /p2p/ in multiaddr: ${multiaddr}`);
  return m[1];
}

describe("J-TOFN — 3-directory spine substrate (DOD-SPINE-1)", () => {
  it("spawns 3 sovereign directory nodes with distinct identities + independent DBs", () => {
    // (1) Exactly three real directory procs.
    expect(cluster.directories.length, "expected 3 directory nodes").toBe(3);

    // (2) Three DISTINCT network identities (own transport key → own PeerID).
    const peerIds = cluster.directories.map((d) => peerId(listenMultiaddr(d, { ws: false })));
    expect(new Set(peerIds).size, `directory PeerIDs must be distinct: ${peerIds.join(", ")}`).toBe(3);

    // (3) Three DISTINCT bootstrap/health URLs (own HEALTH_PORT each).
    expect(new Set(cluster.directoryUrls).size, `directoryUrls must be distinct: ${cluster.directoryUrls.join(", ")}`).toBe(3);
    expect(cluster.directoryUrls.length).toBe(3);

    // (4) Each node has its OWN independently-migrated database — sovereignty, not a
    // shared store. Flyway history present + a sane (equal, non-zero) migration count
    // across all three proves each migrated V1→V{N} from scratch on its own DB.
    const counts = [0, 1, 2].map((i) =>
      Number(psqlSpineN(i, "SELECT count(*) FROM flyway_schema_history WHERE success = true")),
    );
    for (const [i, c] of counts.entries()) {
      expect(c, `cello_spine_${i} must be migrated (flyway history > 0)`).toBeGreaterThan(0);
    }
    expect(new Set(counts).size, `all 3 DBs must apply the same migration set: ${counts.join(", ")}`).toBe(1);
  });
});
