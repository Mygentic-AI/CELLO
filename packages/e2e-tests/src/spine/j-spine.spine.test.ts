/**
 * J-SPINE — the live binary spine test (M7-DEFINITION-OF-DONE.md §"verification
 * harness", journey 1; M7-PROCEDURE.md §4).
 *
 * Drives the REAL shipped binaries (cello-directory, cello-relay, cello-daemon,
 * cello-mcp, cello) on localhost through the public agent surface only, and asserts
 * DOD-SPINE-1..7. It grows ONE assertion at a time as each SPINE line is driven from
 * red to green. It anchors to the binary — see live-harness.ts for why this is the
 * deliberate opposite of session-fixture.ts.
 *
 * Run deliberately (NOT part of the default in-process suite):
 *   pnpm --filter @cello-protocol/e2e-tests test:spine
 * Requires: Docker running (local Postgres) and both repos built
 * (trustless-cello directory+relay, cello-client daemon+mcp+cli).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  startSpineCluster,
  startDaemon,
  provisionAgent,
  connectMcp,
  cello,
  type McpConn,
  type Proc,
  type SpineCluster,
} from "./live-harness.js";

let cluster: SpineCluster;
const daemons: Proc[] = [];
const agentDirs: string[] = [];
const mcpConns: McpConn[] = [];

beforeAll(async () => {
  cluster = await startSpineCluster();
}, 180_000);

afterAll(async () => {
  // Close MCP connections (kills their cello-mcp procs) before stopping daemons.
  for (const c of mcpConns) await c.close();
  // The harness owns each daemon — stop them, then the cluster. No orphans.
  for (const d of daemons) await d.stop();
  await cluster?.stop();
  // L5: remove each agent's CELLO_DIR (holds the Ed25519 seed + SQLite DB).
  for (const dir of agentDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

/** State of a named agent from a `cello_list_agents` result ({ agents: [...] }). */
function agentState(listResult: unknown, name: string): string | undefined {
  const agents = (listResult as { agents?: Array<{ name: string; state: string }> }).agents ?? [];
  return agents.find((a) => a.name === name)?.state;
}

/** A fresh CELLO_DIR with a provisioned agent identity and its own harness-owned daemon. */
async function startAgent(
  label: string,
  agentName: string,
): Promise<{ celloDir: string; daemon: Proc; pubkeyHex: string }> {
  const celloDir = mkdtempSync(join(tmpdir(), `cello-${label}-`));
  agentDirs.push(celloDir);
  // Provision the agent identity BEFORE the daemon starts — the daemon loads it at boot.
  const pubkeyHex = await provisionAgent(celloDir, agentName);
  const daemon = await startDaemon(celloDir, cluster.directoryUrl, label);
  daemons.push(daemon);
  return { celloDir, daemon, pubkeyHex };
}

describe("J-SPINE — live binary spine (DOD-SPINE-1..7 against the real binaries)", () => {
  it("DOD-SPINE-1 — daemon up: started, `cello login` connects within 5s, signaling connected (directory-corroborated)", async () => {
    const { celloDir, daemon, pubkeyHex } = await startAgent("agentA", "agentA");
    const env = { CELLO_DIR: celloDir };

    // `cello login` connects to the running daemon (the DoD "connects to" branch),
    // within the 5s budget.
    const t0 = Date.now();
    const login = cello(["login"], env);
    const loginMs = Date.now() - t0;
    expect(login.status, `cello login failed:\n${login.stdout}`).toBe(0);
    expect(loginMs, "cello login must connect within 5s").toBeLessThan(5_000);

    // Poll `cello status` (with a delay between polls — no tight CLI spawn loop) until
    // the daemon reports connected with >=1 agent AND the directory has corroborated by
    // authenticating this agent's signaling stream. Both sides must agree — the directory
    // log lags the daemon's status flip by a few ms, so corroboration is part of the wait.
    const pubkeyShort = pubkeyHex.slice(0, 16);
    let status: { daemon?: string; directory_signaling?: string; agents?: unknown[]; connections?: unknown[] } = {};
    let lastRaw = "";
    let dirCorroborated = false;
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const res = cello(["status"], env);
      lastRaw = res.stdout;
      try {
        status = JSON.parse(res.stdout.trim());
      } catch {
        /* status not JSON yet — keep polling */
      }
      dirCorroborated = cluster.directory.output.includes(pubkeyShort);
      if (status.directory_signaling === "connected" && (status.agents?.length ?? 0) >= 1 && dirCorroborated) break;
      await sleep(250);
    }

    const diag =
      `\n--- raw cello status ---\n${lastRaw}\n` +
      `--- daemon log ---\n${daemon.output}\n` +
      `--- directory log (last 60) ---\n${cluster.directory.output.split("\n").slice(-60).join("\n")}`;

    // Daemon-side: running, signaling connected, agent loaded, connections list present.
    expect(status.daemon, `daemon should be running${diag}`).toBe("running");
    expect(status.directory_signaling, `directory_signaling should be 'connected'${diag}`).toBe("connected");
    expect(status.agents?.length ?? 0, `status should list >=1 agent${diag}`).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(status.connections), `status must carry a connections list${diag}`).toBe(true);

    // Required startup log events (DOD-SPINE-1).
    expect(daemon.output, `daemon.started must be logged${diag}`).toMatch(/"event":"daemon\.started"/);
    expect(daemon.output, `daemon.login.validation.complete must be logged${diag}`).toMatch(
      /"event":"daemon\.login\.validation\.complete"/,
    );
    // NOTE: daemon.ipc.connected is emitted ONLY on an `ipc.connect` frame, which only
    // cello-mcp sends (clientType "mcp"); the bare CLI never sends it. So that event
    // is asserted in DOD-SPINE-2 (the IPC/MCP connection surface), not here. The DoD's
    // "daemon.ipc.connected (clientType: cli)" wording is corrected accordingly.

    // Directory-side CORROBORATION (anti-tautology, reviewer H1): directory_signaling
    // "connected" is only trustworthy if the directory ITSELF authenticated THIS agent's
    // signaling stream. The directory emits the authed pubkey (first 16 hex) ONLY after
    // verifying the Ed25519 proof-of-possession (directory-node.ts: verify() before any
    // authedPubkeyHex emission). A daemon optimistically self-reporting "connected"
    // cannot fake the directory's log — it cannot make the directory log a pubkey whose
    // private key it does not hold.
    //
    // The load-bearing match is the DURABLE observability event `directory.auth.challenge
    // .signed` (MANIFEST-002), which logs `slice(0,16)` of the authed pubkey whenever the
    // directory key is configured (the harness always sets CELLO_DIRECTORY_KEY_FILE). Do
    // NOT rely on the `[AUTH]` protocol-log line — it truncates to 8 hex and can never
    // satisfy this 16-char match — nor on the `frost.debug.auth.setStreams` diagnostic
    // line, which a maintainer may remove.
    expect(
      dirCorroborated,
      `directory must have authenticated agentA's signaling stream (pubkey ${pubkeyShort}…)${diag}`,
    ).toBe(true);
  }, 30_000);

  it("DOD-SPINE-2/3 — two IPC sessions: three-state model + independent current-agent", async () => {
    const { celloDir, daemon } = await startAgent("agent23", "agentA");

    // Two distinct MCP/IPC connections to ONE daemon (each spawns a real cello-mcp).
    const conn1 = await connectMcp(celloDir, "conn1");
    mcpConns.push(conn1);
    const conn2 = await connectMcp(celloDir, "conn2");
    mcpConns.push(conn2);

    // DOD-SPINE-2: two MCP connections → daemon.ipc.connected{clientType:"mcp"} (the
    // sub-clause re-homed from SPINE-1; the bare CLI never emits this). Use waitForLine
    // (polls the backlog then waits) — the daemon's stdout pipe and the IPC socket are
    // independent fds with no happens-before, so a one-shot read of daemon.output would
    // race the flush (the same race SPINE-1's corroboration fixed).
    await daemon.waitForLine(/"event":"daemon\.ipc\.connected"[^}]*"clientType":"mcp"/, 5_000);

    // DOD-SPINE-3: three-state model, observed in sequence. login does NOT auto-start
    // agents, so a freshly-loaded agent is "registered".
    expect(agentState(await conn1.call("cello_list_agents"), "agentA"), "agentA starts registered").toBe(
      "registered",
    );

    // registered → online (cello_start_agent; daemon-wide set).
    const started = (await conn1.call("cello_start_agent", { name: "agentA" })) as { ok?: boolean };
    expect(started.ok, `cello_start_agent failed: ${JSON.stringify(started)}`).toBe(true);
    expect(agentState(await conn1.call("cello_list_agents"), "agentA"), "agentA online after start").toBe(
      "online",
    );

    // online → current, but ONLY on conn1 (DOD-SPINE-2 independence).
    const used = (await conn1.call("cello_use_agent", { name: "agentA" })) as { ok?: boolean };
    expect(used.ok, `cello_use_agent failed: ${JSON.stringify(used)}`).toBe(true);

    const list1 = await conn1.call("cello_list_agents");
    const list2 = await conn2.call("cello_list_agents");
    // conn1 sees agentA as current; conn2 — same daemon, same agent — sees it only online.
    expect(agentState(list1, "agentA"), "conn1: agentA is current").toBe("current");
    expect(agentState(list2, "agentA"), "conn2 must be unaffected by conn1's switch").toBe("online");

    // agent.current.switched fired for the switching connection (toAgent: agentA).
    // waitForLine, not a one-shot read — same stdout/IPC flush-race avoidance as above.
    await daemon.waitForLine(/"event":"agent\.current\.switched"[^}]*"toAgent":"agentA"/, 5_000);
  }, 30_000);
});
