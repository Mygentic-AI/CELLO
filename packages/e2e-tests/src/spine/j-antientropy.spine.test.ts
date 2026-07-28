/**
 * J-ANTIENTROPY — DOD-AE-LOCAL-E2E-1: three REAL directory binaries on loopback converge.
 *
 * The enforcer for M12's anti-entropy line. Everything below the wire is already unit-proven
 * (merges, encoders, engine, channel handshake, pg store); what only this test can prove is that
 * three sovereign nodes — separate OS processes, separate databases, no shared memory — actually
 * reconcile over `/cello/anti-entropy/1.0.0` on real TCP with real Noise.
 *
 * Per the DoD line, three properties:
 *  1. **Divergent seeded state converges.** Each node is seeded with a revocation the others lack
 *     (written straight into that node's OWN database — the only way to create genuine divergence,
 *     since no API writes to a node the client didn't talk to). All three end up holding all three.
 *  2. **Kill one mid-sync → restart → catch-up.** A node that was down misses writes and picks
 *     them up on rejoin, without operator action.
 *  3. **The kill switch converges monotonically.** A burn written on ONE node lands on the others,
 *     and cannot be un-burned by a concurrent stale un-pause — the §4 property that makes the
 *     kill switch trustworthy across a federation.
 *
 * The manifest pins each node's peerId (M12 §1a) — that pinning is what enables AE at all, and it
 * is what the handshake channel-binds against.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startSpineCluster, psqlSpineN, type SpineCluster } from "./live-harness.js";
import { makeSignedManifest, spineDirectoryNode, spineNodeKeypair, spineNodeId } from "./auth-manifest.js";

let cluster: SpineCluster;
let tmpDir: string;

/** Poll a predicate until true or timeout — AE is periodic, so convergence is eventual. */
async function waitFor(
  what: string,
  fn: () => Promise<boolean>,
  timeoutMs = 60_000,
  diagnose?: () => string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      if (await fn()) return;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    `timed out after ${timeoutMs}ms waiting for: ${what}` +
      (lastErr ? ` (last error: ${String(lastErr)})` : "") +
      (diagnose ? `\n--- diagnostics ---\n${diagnose()}` : ""),
  );
}

/** What every node currently holds for an agent + each node's last AE round lines. */
function aeDiagnostics(agentId: string): string {
  const rows = [0, 1, 2].map((i) => {
    let row = "(query failed)";
    try {
      row = psqlSpineN(i, `SELECT agent_id || ' burned=' || burned || ' paused=' || paused || ' seq=' || suspension_seq FROM agent_suspensions WHERE agent_id = '${agentId}'`) || "(no row)";
    } catch { /* node may be down */ }
    const events = (cluster.directories[i]?.output ?? "")
      .split("\n")
      .filter((l) => /antientropy\./.test(l))
      .slice(-6)
      .join("\n      ");
    return `node ${i}: ${row}\n      ${events || "(no antientropy events)"}`;
  });
  return rows.join("\n");
}

/** agent_ids present in node i's agent_revocations. */
function revocationsOn(i: number): Set<string> {
  const out = psqlSpineN(i, "SELECT agent_id FROM agent_revocations");
  return new Set(out.split("\n").map((l) => l.trim()).filter(Boolean));
}

/** Seed a revocation directly into node i's own database (genuine per-node divergence). */
function seedRevocation(i: number, agentId: string): void {
  psqlSpineN(
    i,
    `INSERT INTO agent_revocations (agent_id, epoch_id, reason, signature, revoked_at)
     VALUES ('${agentId}', 'e1', 'compromise', decode('${"ab".repeat(64)}','hex'), ${1785200000000 + i})
     ON CONFLICT (agent_id) DO NOTHING`,
  );
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "cello-ae-spine-"));
  const manifestPath = join(tmpDir, "consortium-manifest.json");

  cluster = await startSpineCluster({
    directoryCount: 3,
    directoryNodeKeysHex: [0, 1, 2].map((i) => spineNodeKeypair(i).privateKeyHex),
    // M12: fixed transport seeds + ws ports, so the manifest can PIN each node's dial identity.
    directoryFixedTransport: true,
    directoryConsortiumManifestPath: manifestPath,
    // Written BEFORE any directory boots — a directory reads (and now verifies) its manifest at
    // startup, and AE turns itself on from the peerIds it finds there.
    onDirectoryUrlsReady: (_urls, aeIdentities) => {
      if (!aeIdentities) throw new Error("directoryFixedTransport must yield AE identities");
      const nodes = aeIdentities.map((ae, i) => spineDirectoryNode(i, ae.endpoint, { peerId: ae.peerId }));
      writeFileSync(manifestPath, JSON.stringify(makeSignedManifest(nodes, { version: 2 }), null, 2));
    },
  });

}, 300_000);

afterAll(async () => {
  await cluster?.stop();
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
});

describe("J-ANTIENTROPY — 3 directory processes converge over /cello/anti-entropy/1.0.0", () => {
  it("authenticates peers against the manifest-pinned identity (handshake over real Noise)", async () => {
    // The handshake is the gate: if it never succeeds, every convergence assertion below would be
    // vacuous (nothing syncs). Prove it fired, and that NO peer failed authentication.
    await waitFor("antientropy.peer.authenticated on node 0", async () =>
      /"event":"antientropy\.peer\.authenticated"/.test(cluster.directories[0]!.output ?? ""),
    );
    for (const [i, dir] of cluster.directories.entries()) {
      expect(dir.output ?? "", `node ${i} must not log an auth failure`).not.toMatch(
        /"event":"antientropy\.peer\.auth_failed"/,
      );
    }
  }, 120_000);

  it("divergent seeded state converges on ALL THREE nodes (Tier-A union)", async () => {
    // Each node starts holding exactly one revocation the other two lack.
    seedRevocation(0, "ae-agent-zero");
    seedRevocation(1, "ae-agent-one");
    seedRevocation(2, "ae-agent-two");
    const expected = new Set(["ae-agent-zero", "ae-agent-one", "ae-agent-two"]);

    for (const i of [0, 1, 2]) {
      await waitFor(`node ${i} to hold all three revocations`, async () => {
        const have = revocationsOn(i);
        return [...expected].every((id) => have.has(id));
      });
    }
  }, 180_000);

  it("a node killed mid-sync catches up on restart (no operator action)", async () => {
    // Node 0 goes down, the federation keeps writing, node 0 rejoins and must pick up what it
    // missed. This is the outage-tolerance property the sovereign-node model promises.
    await cluster.directories[0]!.stop();
    seedRevocation(1, "ae-agent-while-down");

    const restarted = await cluster.restartDirectory();
    expect(restarted, "restartDirectory must return the fresh node-0 proc").toBeTruthy();

    await waitFor("node 0 to catch up on the write it missed", async () => {
      return revocationsOn(0).has("ae-agent-while-down");
    });
  }, 240_000);

  it("a burn written on ONE node converges to the others and stays burned (kill switch)", async () => {
    const agentId = "ae-agent-burned";
    const account = "00000000-0000-0000-0000-0000000000b1";
    // Node 1 accepts the burn (seq 5).
    psqlSpineN(1,
      `INSERT INTO agent_suspensions (agent_id, paused, burned, authorized_by_account, suspension_seq, origin_node, updated_at)
       VALUES ('${agentId}', true, true, '${account}', 5, '${spineNodeId(1)}', now())
       ON CONFLICT (agent_id) DO UPDATE SET paused = true, burned = true, suspension_seq = 5`,
    );
    // Node 2 concurrently holds a STALE un-pause at a HIGHER seq — the adversarial case: newer
    // authenticated state must win on `paused`, but burn is monotonic and must survive it.
    psqlSpineN(2,
      `INSERT INTO agent_suspensions (agent_id, paused, burned, authorized_by_account, suspension_seq, origin_node, updated_at)
       VALUES ('${agentId}', false, false, '${account}', 9, '${spineNodeId(2)}', now())
       ON CONFLICT (agent_id) DO UPDATE SET paused = false, burned = false, suspension_seq = 9`,
    );

    for (const i of [0, 1, 2]) {
      await waitFor(`node ${i} to converge the suspension with burned=true`, async () => {
        // NB: `boolean || text` casts to 'true'/'false' (not psql's 't'/'f' column rendering).
        const row = psqlSpineN(i, `SELECT burned || ':' || paused || ':' || suspension_seq FROM agent_suspensions WHERE agent_id = '${agentId}'`).trim();
        // burned survived the higher-seq un-pause (monotonic), paused took the newer state, and
        // the sequence advanced to the winner's — the full §4 convergence, on every node.
        return row === "true:false:9";
      }, 60_000, () => aeDiagnostics(agentId));
    }
    // Burn survived the higher-seq un-pause on every node — monotonic across the federation.
  }, 240_000);
});
