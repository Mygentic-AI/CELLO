/**
 * J-OPTIONB-SETUP — M8B any-relay/any-directory session setup (DOD-OPTIONB-SETUP-1), live binaries.
 *
 * Option B removes the DIRECTORY→RELAY dial. Before M8B the directory dialed the relay
 * (`recordAssignment`) over a `relays[0]`-pinned, same-region, SG-locked path that broke on every
 * directory restart — the recurring `relay_unavailable` root cause. Now the directory signs a per-node
 * relay-assignment signature (`relay_directory_signature`) and ships it INSIDE the client-facing
 * session_assignment; the CLIENT carries it to ITS chosen relay (a `client_record_assignment` frame),
 * and the relay verifies it against the consortium directory pubkey SET (`CELLO_DIRECTORY_PUBKEYS`).
 *
 * The teeth here are ANY-DIRECTORY: this test drives the whole session through a NON-node-0 directory
 * (the daemon's signaling connects to `directoryUrls[1]`), so the relay assignment is signed by node 1.
 * If the relay only trusted node 0 (the old single `CELLO_DIRECTORY_PUBKEY`), node 1's assignment would
 * be rejected (`assignment_invalid`) and the witnessed send would never settle. A successful A→B send
 * THROUGH node 1, plus the relay logging `relay.assignment.recorded` with `source:"client"`, proves:
 *   1. the directory made ZERO record-assignment dial (the relay learned the session from the CLIENT), and
 *   2. a sovereign directory that is NOT node 0 can grant relay service (any-directory).
 *
 * Anchored to the binaries — real cello-directory ×3 + relay (with the 3-node pubkey set) +
 * cello-daemon/cello/cello-mcp.
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
  const holder = mkdtempSync(join(tmpdir(), "cello-optionb-consortium-"));
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

describe("J-OPTIONB-SETUP — any-relay/any-directory session setup (DOD-OPTIONB-SETUP-1)", () => {
  it("a session established through a NON-node-0 directory is recorded on the relay by the CLIENT (no directory→relay dial)", async () => {
    const celloDir = mkdtempSync(join(tmpdir(), "cello-optionb-"));
    agentDirs.push(celloDir);
    await provisionAgent(celloDir, "agentA");
    const pubB = await provisionAgent(celloDir, "agentB");
    const nodes = [0, 1, 2].map((i) => spineDirectoryNode(i, cluster.directoryUrls[i]));
    const manifestEnv = writeConsortiumManifest(celloDir, "optionb", nodes);

    // ── ANY-DIRECTORY: connect the daemon's signaling to node 1, NOT node 0. Node 1 then processes the
    // session request and signs the relay assignment with ITS OWN per-node key. The relay accepts it only
    // because it was given the full consortium pubkey set (CELLO_DIRECTORY_PUBKEYS), not just node 0's. ──
    const nonZeroDirectoryUrl = cluster.directoryUrls[1];
    const daemon = await startDaemon(celloDir, nonZeroDirectoryUrl, "optionb", { manifestEnv });
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
    expect(connected, "signaling never connected to the non-node-0 directory").toBe(true);

    for (const name of ["agentA", "agentB"]) {
      const r = registerAgent(name, `DEV-optionb-${name}-${randomBytes(6).toString("hex")}`, env);
      expect(r.status, `register ${name} failed: ${r.stdout}`).toBe(0);
    }

    const connA = await connectMcp(celloDir, "optionb-A");
    mcpConns.push(connA);
    const connB = await connectMcp(celloDir, "optionb-B");
    mcpConns.push(connB);
    for (const [conn, name] of [[connA, "agentA"], [connB, "agentB"]] as const) {
      expect(((await conn.call("cello_start_agent", { name })) as { ok?: boolean }).ok).toBe(true);
      expect(((await conn.call("cello_use_agent", { name })) as { ok?: boolean }).ok).toBe(true);
    }

    // A→B session + a message — the message-leaf must be witnessed by the relay, which requires the relay
    // to have RECORDED the session. Under Option B that record came from A's client_record_assignment.
    const awaitP = connB.call("cello_await_session", { timeout_ms: 25_000 });
    let init = (await connA.call("cello_initiate_session", { target_pubkey: pubB })) as { ok?: boolean; sessionId?: string; reason?: string };
    for (let i = 0; i < 20 && !init.ok && init.reason === "standing_receiver_unavailable"; i++) {
      await sleep(300);
      init = (await connA.call("cello_initiate_session", { target_pubkey: pubB })) as { ok?: boolean; sessionId?: string; reason?: string };
    }
    expect(init.ok, `initiate failed (via non-node-0 directory): ${JSON.stringify(init)}`).toBe(true);
    const sessionIdA = init.sessionId!;
    const inbound = (await awaitP) as { type?: string; session_id?: string };
    expect(inbound.type, `B must accept the session: ${JSON.stringify(inbound)}`).toBe("new_session");
    const sessionIdB = inbound.session_id!;

    expect(((await connA.call("cello_send", { session_id: sessionIdA, content: "option-b any-directory proof" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connB.call("cello_receive", { session_id: sessionIdB, timeout_ms: 15_000 })) as { content?: string | null }).content).toBe("option-b any-directory proof");

    // Give the client_record_assignment + ack round-trip a moment to settle into the relay log.
    await sleep(1500);

    // ─── TEETH 1: the relay recorded the session from the CLIENT, not a directory dial ───
    // `relay.assignment.recorded` with `source:"client"` is emitted ONLY by #processClientRecordAssignment
    // (the directory→relay recordAssignment dial is deleted). Its presence proves DOD-INV-NO-DIR-RELAY for
    // setup: the relay learned the session over the client's authenticated stream.
    const relayRecordedByClient = cluster.relay.output
      .split("\n")
      .some((l) => /"event":"relay\.assignment\.recorded"/.test(l) && /"source":"client"/.test(l));
    expect(relayRecordedByClient, "relay must record the session from the CLIENT (relay.assignment.recorded source=client)").toBe(true);

    // ─── TEETH 2: any-directory — the daemon presented the node-1-signed assignment and the relay ACCEPTED
    // it. The daemon logs session.relay.assignment.recorded on a successful assignment_ok; a node-1 signature
    // the relay rejected would instead surface session.relay.assignment.invalid + a failed/unwitnessed send. ───
    const daemonPresentedOk = daemon.output
      .split("\n")
      .some((l) => /"event":"session\.relay\.assignment\.recorded"/.test(l));
    expect(daemonPresentedOk, "daemon must get assignment_ok from the relay for the node-1-signed assignment").toBe(true);
    const relayRejected = cluster.relay.output.split("\n").some((l) => /"event":"relay\.assignment\.rejected"/.test(l));
    expect(relayRejected, "the relay must NOT have rejected the node-1-signed assignment (any-directory)").toBe(false);
  }, 240_000);
});
