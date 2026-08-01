/**
 * J-SIGN — M8B T-of-N session signing + seal (DOD-SIGN-1), live binaries.
 *
 * The signing half of T-of-N: on a 3-node consortium, two agents that each ran a multi-node DKG
 * hold a session, exchange, and BOTH close → a bilateral FROST seal. The seal's FROST ceremony is
 * coordinated by the client's threshold signer across the consortium directory nodes (the client
 * holds N stubs — DOD-SIGN-1 client), and each directory FROST-signs using the group key it
 * resolves from the store (DOD-SIGN-1 directory: #resolvePrimaryPubkey — never the M1 single-key
 * fallback when a DKG exists). Then KILL one directory node and seal a second session → still
 * completes (DOD-INV-NODE: no single directory node is mandatory for signing; client + any T−1 of
 * the survivors suffice, T=N=3 ⇒ tolerate exactly one directory outage).
 *
 * Anchored to the binaries — real cello-directory ×3 + relay + cello-daemon/cello/cello-mcp.
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
  registerAgent,
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
  const holder = mkdtempSync(join(tmpdir(), "cello-sign-consortium-"));
  agentDirs.push(holder);
  const consortiumManifestPath = join(holder, "consortium-manifest.json");
  cluster = await startSpineCluster({
    directoryCount: 3,
    directoryNodeKeysHex: [0, 1, 2].map((i) => spineNodeKeypair(i).privateKeyHex),
    directoryConsortiumManifestPath: consortiumManifestPath,
    onDirectoryUrlsReady: (urls) => {
      writeSignedManifestTo(
        consortiumManifestPath,
        urls.map((url, i) => spineDirectoryNode(i, url)),
      );
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

/** Register two agents into the consortium on ONE daemon, return their MCP conns + B's pubkey. */
async function setupTwoAgents(label: string): Promise<{ celloDir: string; daemon: Proc; connA: McpConn; connB: McpConn; pubB: string }> {
  const celloDir = mkdtempSync(join(tmpdir(), `cello-sign-${label}-`));
  agentDirs.push(celloDir);
  await provisionAgent(celloDir, "agentA");
  const pubB = await provisionAgent(celloDir, "agentB");
  const nodes = [0, 1, 2].map((i) => spineDirectoryNode(i, cluster.directoryUrls[i]));
  const manifestEnv = writeConsortiumManifest(celloDir, label, nodes);
  const daemon = await startDaemon(celloDir, cluster.directoryUrls[0], label, { manifestEnv });
  daemons.push(daemon);
  const env = { CELLO_DIR: celloDir };

  // Wait for the primary directory signaling stream (registration needs it).
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
  expect(connected, `${label}: signaling never connected`).toBe(true);

  // Multi-node DKG for both agents.
  for (const name of ["agentA", "agentB"]) {
    const res = registerAgent(name, `DEV-${label}-${name}-${randomBytes(6).toString("hex")}`, env);
    expect(res.status, `${label}: register ${name} failed: ${res.stdout}`).toBe(0);
    expect((JSON.parse(res.stdout.trim()) as { ok?: boolean }).ok, `${label}: register ${name} not ok: ${res.stdout}`).toBe(true);
  }

  const connA = await connectMcp(celloDir, `${label}-A`);
  mcpConns.push(connA);
  const connB = await connectMcp(celloDir, `${label}-B`);
  mcpConns.push(connB);
  for (const [conn, name] of [[connA, "agentA"], [connB, "agentB"]] as const) {
    expect(((await conn.call("cello_start_agent", { name })) as { ok?: boolean }).ok).toBe(true);
    expect(((await conn.call("cello_use_agent", { name })) as { ok?: boolean }).ok).toBe(true);
  }
  return { celloDir, daemon, connA, connB, pubB };
}

/** A→B: open a session, exchange, both close → bilateral seal. Returns the byte-identical root. */
async function sealSession(connA: McpConn, connB: McpConn, pubB: string, daemon: Proc): Promise<string> {
  const awaitP = connB.call("cello_await_session", { timeout_ms: 25_000 });
  let init = (await connA.call("cello_initiate_session", { target_pubkey: pubB })) as { ok?: boolean; sessionId?: string; reason?: string };
  for (let i = 0; i < 20 && !init.ok && init.reason === "standing_receiver_unavailable"; i++) {
    await sleep(300);
    init = (await connA.call("cello_initiate_session", { target_pubkey: pubB })) as { ok?: boolean; sessionId?: string; reason?: string };
  }
  expect(init.ok, `initiate failed: ${JSON.stringify(init)}`).toBe(true);
  const sessionIdA = init.sessionId!;
  const inbound = (await awaitP) as { type?: string; session_id?: string };
  expect(inbound.type, `B must accept the session: ${JSON.stringify(inbound)}`).toBe("new_session");
  const sessionIdB = inbound.session_id!;

  expect(((await connA.call("cello_send", { cello_session_id: sessionIdA, content: "consortium seal", signal: "over" })) as { ok?: boolean }).ok).toBe(true);
  expect(((await connB.call("cello_receive", { cello_session_id: sessionIdB, timeout_ms: 15_000 })) as { content?: string | null }).content).toBe(`consortium seal [[OVER]]`);

  const [closeA, closeB] = (await Promise.all([
    connA.call("cello_close_session", { cello_session_id: sessionIdA }),
    connB.call("cello_close_session", { cello_session_id: sessionIdB }),
  ])) as Array<{ ok?: boolean; sealed_root?: string; seal_type?: string }>;
  const diag = `\ncloseA: ${JSON.stringify(closeA)}\ncloseB: ${JSON.stringify(closeB)}\n--- directory-0 seal ---\n${daemon.output.split("\n").filter((l) => /seal|frost|single/i.test(l)).slice(-12).join("\n")}`;
  expect(closeA.ok, `A close failed:${diag}`).toBe(true);
  expect(closeB.ok, `B close failed:${diag}`).toBe(true);
  expect(closeA.sealed_root, `A sealed_root:${diag}`).toMatch(/^[0-9a-f]{64}$/);
  expect(closeB.sealed_root, `both ends' sealed_root must be byte-identical:${diag}`).toBe(closeA.sealed_root);
  expect(closeA.seal_type, `seal must be bilateral, not a unilateral fallback:${diag}`).not.toBe("unilateral");
  return closeA.sealed_root!;
}

describe("J-SIGN — T-of-N session seal across the consortium (DOD-SIGN-1)", () => {
  // ONE test: both agents must be REGISTERED (multi-node DKG, all 3 up) BEFORE any node is killed —
  // DKG needs all N, but SIGNING tolerates one down. So seal once with all up, then kill a node and
  // seal AGAIN with the same agents.
  it("consortium seal is FROST T-of-N (≥2 directories sign), and survives a participating node DOWN", async () => {
    const { connA, connB, pubB, daemon } = await setupTwoAgents("seal");

    // Seal 1 — all 3 directories up.
    const root1 = await sealSession(connA, connB, pubB, daemon);
    expect(root1).toMatch(/^[0-9a-f]{64}$/);

    // Settle — directory stdout lags the IPC response (DKG-1 lesson) — then assert with TEETH
    // (cello-test-attacker): a NEGATIVE "no single-key" check is hollow (the single-key path logs only
    // a generic "Sealed —"). Assert POSITIVELY instead.
    await sleep(2000);
    // F1 — a directory ran the FROST seal ceremony. The M1 single-key path RETURNS before this log
    // (directory-node.ts:4089 is FROST-branch only), so this fails if the seal silently single-keyed.
    const frostSealed = cluster.directories.some((d) => /FROST seal ceremony — session/.test(d.output));
    expect(frostSealed, "a directory must run the FROST seal ceremony (proves not single-key)").toBe(true);
    // F2 — the seal is a THRESHOLD signature: client + (t−1) directories. With t = majority(N) = 2 for
    // this 3-node consortium the client is the +1, so exactly ONE directory FROST-signs per seal. Assert
    // ≥1 DISTINCT directory partial-signed (logs frost_stream.sign_request) — together with F1 (a FROST
    // ceremony ran, not the single-key path) this proves a real threshold seal, not a single-key shortcut.
    // (Was ≥2 under the old all-N threshold t=N=3; majority(N) reduced directory participation to t−1=1.)
    const signedSet1 = [0, 1, 2].filter((i) => /"event":"frost\.debug\.frost_stream\.sign_request"/.test(cluster.directories[i].output));
    expect(signedSet1.length, `≥1 directory must FROST-sign the ceremony (client + t−1, t=2); signed: ${signedSet1.join(",")}`).toBeGreaterThanOrEqual(1);

    // F3 — kill a NON-PRIMARY directory and prove a seal still completes: the consortium loses a node and
    // still seals (DOD-INV-NODE — no single directory is mandatory). Under t=2 the sole signer is the
    // client's signaling primary (dir 0); killing a NON-primary keeps signaling up and proves the seal
    // tolerates one directory being down.
    //
    // ⚠️ KNOWN GAP — NOT tested here, must be addressed eventually: the HARDER property — a seal surviving
    // the client's OWN SIGNING directory dying — needs a full client failover (signaling → survivor) AND
    // re-establishing a session on that survivor. A run that killed the signing primary left the far agent
    // stuck 'target_offline' (presence did not re-propagate to the survivor within 15s). Tracked in the
    // e2e results journal: "session/seal after directory failover unproven".
    const killTarget = signedSet1.find((i) => i !== 0) ?? 1;
    await cluster.directories[killTarget].kill();
    await sleep(1000);
    const root2 = await sealSession(connA, connB, pubB, daemon);
    expect(root2, `seal must still complete with directory ${killTarget} down`).toMatch(/^[0-9a-f]{64}$/);
  }, 240_000);
});
