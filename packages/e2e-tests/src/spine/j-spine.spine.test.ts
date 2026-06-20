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
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  startSpineCluster,
  startDaemon,
  provisionAgent,
  connectMcp,
  cello,
  psqlSpine,
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

  it("DOD-SPINE-4 — register two agents (real DKG): register_success, directory agent_profiles + one deduped account, per-agent files", async () => {
    // ── One home, one daemon, TWO loaded agents (agent-loader enumerates agents/*/).
    // Two agents under one operator on one machine — the live "two agents, one account"
    // shape. Provision BOTH K_local keys before the daemon boots so it loads both.
    const celloDir = mkdtempSync(join(tmpdir(), "cello-spine4-"));
    agentDirs.push(celloDir);
    const pubA = await provisionAgent(celloDir, "agentA");
    const pubB = await provisionAgent(celloDir, "agentB");
    expect(pubA).not.toBe(pubB);
    const daemon = await startDaemon(celloDir, cluster.directoryUrl, "spine4");
    daemons.push(daemon);
    const env = { CELLO_DIR: celloDir };

    // Registration needs the directory signaling stream up (RegistrationManager step 3
    // returns directory_unreachable otherwise). Wait for it, exactly as SPINE-1 does.
    let connected = false;
    const sigDeadline = Date.now() + 10_000;
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
    expect(connected, `directory_signaling never connected\n${daemon.output.split("\n").slice(-40).join("\n")}`).toBe(
      true,
    );

    // ── Register both agents (real FROST DKG against the directory). DEV- tokens are
    // accepted by the directory's DevTokenValidator under CELLO_ENV=local — no Telegram.
    // Each agent registers over its OWN directory signaling stream (per-agent signaling),
    // so the directory routes each agent's dkg_complete/register_success back to it.
    // The CLI is synchronous and the daemon serializes registration, so these run one at
    // a time. Each returns register_success {agent_id, primary_pubkey}.
    function registerAgent(name: string): { agentId: string; primaryPubkey: string } {
      const token = `DEV-spine4-${name}-${randomBytes(6).toString("hex")}`;
      const res = cello(["register", name, token], env);
      const diag =
        `\n--- cello register ${name} stdout ---\n${res.stdout}\n` +
        `--- daemon log (last 60) ---\n${daemon.output.split("\n").slice(-60).join("\n")}\n` +
        `--- directory log (last 60) ---\n${cluster.directory.output.split("\n").slice(-60).join("\n")}`;
      expect(res.status, `cello register ${name} failed:${diag}`).toBe(0);
      const parsed = JSON.parse(res.stdout.trim()) as { ok?: boolean; agent_id?: string; primary_pubkey?: string };
      expect(parsed.ok, `register ${name} not ok: ${res.stdout}`).toBe(true);
      expect(typeof parsed.agent_id, `register ${name} missing agent_id`).toBe("string");
      expect(parsed.primary_pubkey, `register ${name} missing primary_pubkey`).toMatch(/^[0-9a-f]{64}$/);
      return { agentId: parsed.agent_id!, primaryPubkey: parsed.primary_pubkey! };
    }
    const regA = registerAgent("agentA");
    const regB = registerAgent("agentB");

    // Two distinct agents — distinct directory-issued agent_id AND distinct DKG primary_pubkey
    // (each primary_pubkey is the product of a SEPARATE real ceremony, not a fixed stub value).
    expect(regA.agentId).not.toBe(regB.agentId);
    expect(regA.primaryPubkey).not.toBe(regB.primaryPubkey);

    // ── Directory-side corroboration (non-tautological, reviewer H1): assert the
    // directory's OWN DB writes in cello_spine — the daemon cannot fabricate these. Both
    // the profile INSERT and the account_id are committed asynchronously (setProfile is a
    // fire-and-forget `void pool.query`, and register_success is sent BEFORE that INSERT
    // commits), so POLL the whole corroboration until it settles: 2 agent_profiles rows
    // for these agents' K_local keys, carrying the DKG primary_pubkeys the CLI reported,
    // both pointing at the SAME non-null account_id. (One unified poll — the profile rows
    // and the account link land asynchronously together; a one-shot read of either races
    // the commit. Reviewer Q6.)
    let sharedAccount = "";
    const corroborateDeadline = Date.now() + 10_000;
    let lastSeen = "";
    for (;;) {
      const rows = psqlSpine(
        `SELECT k_local_pubkey || '|' || primary_pubkey || '|' || coalesce(account_id::text,'NULL') ` +
          `FROM agent_profiles WHERE k_local_pubkey IN ('${pubA}','${pubB}') ORDER BY k_local_pubkey`,
      );
      lastSeen = rows;
      const lines = rows.split("\n").filter((l) => l.length > 0);
      if (lines.length === 2) {
        const byLocal = new Map(lines.map((l) => [l.split("|")[0]!, { primary: l.split("|")[1]!, account: l.split("|")[2]! }]));
        const a = byLocal.get(pubA);
        const b = byLocal.get(pubB);
        if (
          a?.primary === regA.primaryPubkey &&
          b?.primary === regB.primaryPubkey &&
          a.account !== "NULL" &&
          a.account === b!.account
        ) {
          sharedAccount = a.account;
          break;
        }
      }
      if (Date.now() > corroborateDeadline) {
        throw new Error(
          `directory agent_profiles never settled to 2 rows with matching DKG primary_pubkeys and a shared ` +
            `non-null account_id. Last: ${JSON.stringify(lastSeen)} (expected ${pubA}→${regA.primaryPubkey}, ${pubB}→${regB.primaryPubkey})`,
        );
      }
      await sleep(250);
    }
    // Exactly ONE account dedups the two agents (DevTokenValidator's fixed phone_stub_hash
    // → one user_accounts row keyed UNIQUE on phone_stub_hash). This IS "two agents, one account".
    const accountCount = psqlSpine(`SELECT count(*) FROM user_accounts WHERE account_id = '${sharedAccount}'`);
    expect(accountCount, "exactly one user_accounts row backs the shared account_id").toBe("1");

    // ── Per-agent local files under ${CELLO_DIR}/agents/<name>/ (daemon-side persistence,
    // including the agent→user link captured at registration). DOD-INV-2: the persisted
    // client-side frost-share is the agent's HALF of the split key — neither it nor the
    // directory's K_server_X share can sign alone.
    for (const name of ["agentA", "agentB"]) {
      const dir = join(celloDir, "agents", name);
      for (const file of ["key", "registration-state.json", "ml-dsa-keypair.json", "frost-share.json", "agent-user-link.json"]) {
        expect(existsSync(join(dir, file)), `missing per-agent file ${name}/${file}`).toBe(true);
      }
    }
  }, 60_000);

  it("DOD-SPINE-5 (partial) — initiate session negotiator is wired: session_request reaches the directory", async () => {
    // Increment 1 of SPINE-5: the daemon now builds a real internal SessionNegotiator
    // (porting core/client initiateSession onto per-agent signaling), so cello_initiate_session
    // no longer returns the wired-out directory_signaling_not_configured. This asserts the
    // negotiator is LIVE end-to-end: it sends session_request over the current agent's OWN
    // signaling stream, the directory brokers it, and responds. With an UNREGISTERED target
    // the directory's authoritative answer is `target_offline` — proving the round-trip
    // reached the directory (not a tautology; a daemon that never sent the frame could not
    // produce a directory-sourced target_offline).
    //
    // The FULL SPINE-5 green (a FROST-signed SessionAssignment between two registered+online
    // agents + ephemeral session node Peer ID ≠ directory-facing) is the next increment.
    const { celloDir } = await startAgent("spine5", "agentA");
    const conn = await connectMcp(celloDir, "spine5");
    mcpConns.push(conn);

    const started = (await conn.call("cello_start_agent", { name: "agentA" })) as { ok?: boolean };
    expect(started.ok, `cello_start_agent failed: ${JSON.stringify(started)}`).toBe(true);
    const used = (await conn.call("cello_use_agent", { name: "agentA" })) as { ok?: boolean };
    expect(used.ok, `cello_use_agent failed: ${JSON.stringify(used)}`).toBe(true);

    // cello-mcp's required param is `target_pubkey` (z.string()). An unregistered target.
    const res = (await conn.call("cello_initiate_session", {
      target_pubkey: "00".repeat(32),
    })) as { ok?: boolean; reason?: string };
    expect(res.ok, `expected initiate to be not-ok for an unregistered target: ${JSON.stringify(res)}`).toBe(false);
    // Directory-sourced answer (the negotiator reached the directory): NOT the wired-out
    // directory_signaling_not_configured anymore.
    expect(res.reason, `negotiator should reach the directory: ${JSON.stringify(res)}`).toBe("target_offline");
  }, 30_000);

  // SKIPPED — documents the next SPINE-5 bug (J-SPINE surfaced it live, 2026-06-19).
  // The negotiator (increment 1) works: with two agents registered on one daemon, agentA→
  // agentB session_request is ACCEPTED by the directory (target online ✓, ClientDelegatedSigner
  // found, streams SET ✓) and `[FROST] Ceremony begin` fires — but the session-signing FROST
  // ceremony (directory's ClientDelegatedSigner asking agentA's daemon to co-sign the
  // SessionAssignment over signaling) never completes → `ceremony_timeout` after 30s. The
  // delegated-signing round-trip frames aren't handled/answered on agentA's per-agent
  // signaling stream — the same per-agent routing gap SPINE-4 fixed for registration, now for
  // the session ceremony. NEXT BUILD: wire the daemon's delegated-signing ceremony handler
  // onto each per-agent signaling stream so the directory's participate-in-ceremony frames are
  // answered. Un-skip when fixed. (Setup below is correct and reused as the green when ready.)
  it("DOD-SPINE-5 — FROST-signed SessionAssignment received between two registered agents (one daemon)", async () => {
    // Two agents registered on ONE daemon (each its own DKG → agentB's signaling stream is up
    // = a valid target; agentA has a FROST signer = a valid initiator). agentA online+current
    // initiates to agentB → the directory brokers + FROST-signs a SessionAssignment and returns
    // it; the daemon receives + parses it.
    const celloDir = mkdtempSync(join(tmpdir(), "cello-spine5b-"));
    agentDirs.push(celloDir);
    await provisionAgent(celloDir, "agentA");
    const pubB = await provisionAgent(celloDir, "agentB");
    const daemon = await startDaemon(celloDir, cluster.directoryUrl, "spine5b");
    daemons.push(daemon);
    const env = { CELLO_DIR: celloDir };

    // Register both (DEV tokens). Registration brings each agent's per-agent signaling
    // stream up — that is what makes agentB a reachable target at the directory.
    for (const name of ["agentA", "agentB"]) {
      const r = cello(["register", name, `DEV-spine5-${name}-${randomBytes(6).toString("hex")}`], env);
      expect(r.status, `cello register ${name} failed:\n${r.stdout}`).toBe(0);
    }

    const conn = await connectMcp(celloDir, "spine5b");
    mcpConns.push(conn);
    expect(((await conn.call("cello_start_agent", { name: "agentA" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await conn.call("cello_use_agent", { name: "agentA" })) as { ok?: boolean }).ok).toBe(true);

    // Initiate to the registered agentB. The MCP result may be a dial error (no transportDialer
    // is wired — that is SPINE-6), so SPINE-5's assertion is the ASSIGNMENT RECEIVED, proven by
    // the daemon log AND corroborated by the directory having brokered the request.
    const res = (await conn.call("cello_initiate_session", { target_pubkey: pubB })) as {
      ok?: boolean;
      reason?: string;
    };

    let line = "";
    try {
      line = await daemon.waitForLine(/"event":"session\.negotiate\.assignment\.received"/, 15_000);
    } catch (err) {
      throw new Error(
        `SPINE-5: no FROST-signed assignment received.\ninitiate result: ${JSON.stringify(res)}\n` +
          `--- daemon (last 50) ---\n${daemon.output.split("\n").slice(-50).join("\n")}\n` +
          `--- directory [SESS]/[FROST] ---\n${cluster.directory.output.split("\n").filter((l) => /\[SESS\]|\[FROST\]|frost\.debug\.session/.test(l)).slice(-30).join("\n")}\n(${String(err)})`,
      );
    }
    // M2: require FROST (not single) — DOD-INV-2 is that no single node signs alone, so a
    // single-key assignment must NOT pass as green.
    expect(line, `assignment must be FROST-signed: ${line}`).toMatch(/"signatureType":"frost"/);
    // The initiator actually RAN the delegated FROST ceremony (durable event). A single-sig
    // assignment would never trigger participateInCeremony — so this proves the split-key path
    // genuinely executed, not a stub returning a fixed signature.
    expect(daemon.output, "initiator ran the FROST session ceremony").toMatch(
      /"event":"session\.ceremony\.participated"/,
    );
    // Directory-side corroboration (non-tautological, FROST-specific): the directory began the
    // delegated ceremony for this session — the daemon cannot fabricate the directory's log.
    expect(cluster.directory.output, "directory must run the delegated FROST ceremony").toMatch(
      /\[FROST\]\s+Ceremony begin/,
    );
  }, 60_000);

  // SKIPPED — J-SPINE proved (2026-06-20) how far the live session path gets and pinpointed
  // the next build. Between TWO parties on TWO daemons: register → online → B cello_await_session
  // → A cello_initiate_session → **B receives the inbound session live** (`type:"new_session"`,
  // directory-brokered, B accepted) → A cello_send → **`session_stream_unavailable`** (content
  // queued to the durable retry queue). So session ESTABLISHMENT between two parties works; the
  // gap is the CONTENT CONNECTION: in local the session is relay-mode (AutoNAT unavailable on
  // localhost), and the relay-circuit content connect (N_A↔N_B via the relay) + leaf forwarding
  // (hash_submit/leaf_deliver) is the unwired "later seam" = DOD-MSG-3/MSG-001-3b, the DoD's
  // explicitly-NOT-BUILT biggest gap. NEXT BUILD: the relay content path (circuit-relay session
  // connect + leaf submit/deliver), then un-skip. The setup below is correct + reused as the green.
  it("DOD-SPINE-6 — send/receive: A cello_send → B cello_receive (relay hash_submit/leaf_deliver, no content in relay logs)", async () => {
    // Full A→B exchange between TWO parties = TWO daemons (the production topology: a session
    // is between two parties on two machines; one daemon per party = its own session-core DB).
    // agentA on daemonA, agentB on daemonB, both against the same directory+relay. B awaits an
    // inbound session; A initiates to B; A sends; B receives. Asserts the relay witnessed the
    // message HASH (hash_submit) and that the plaintext NEVER appears in the relay logs (INV-3).
    const celloDirA = mkdtempSync(join(tmpdir(), "cello-spine6A-"));
    const celloDirB = mkdtempSync(join(tmpdir(), "cello-spine6B-"));
    agentDirs.push(celloDirA, celloDirB);
    await provisionAgent(celloDirA, "agentA");
    const pubB = await provisionAgent(celloDirB, "agentB");
    const daemonA = await startDaemon(celloDirA, cluster.directoryUrl, "spine6A");
    const daemonB = await startDaemon(celloDirB, cluster.directoryUrl, "spine6B");
    daemons.push(daemonA, daemonB);
    const rA = cello(["register", "agentA", `DEV-spine6-A-${randomBytes(6).toString("hex")}`], { CELLO_DIR: celloDirA });
    expect(rA.status, `register agentA failed:\n${rA.stdout}`).toBe(0);
    const rB = cello(["register", "agentB", `DEV-spine6-B-${randomBytes(6).toString("hex")}`], { CELLO_DIR: celloDirB });
    expect(rB.status, `register agentB failed:\n${rB.stdout}`).toBe(0);

    const connA = await connectMcp(celloDirA, "spine6-A");
    mcpConns.push(connA);
    const connB = await connectMcp(celloDirB, "spine6-B");
    mcpConns.push(connB);
    expect(((await connA.call("cello_start_agent", { name: "agentA" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connA.call("cello_use_agent", { name: "agentA" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connB.call("cello_start_agent", { name: "agentB" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connB.call("cello_use_agent", { name: "agentB" })) as { ok?: boolean }).ok).toBe(true);

    // B blocks on an inbound session; A initiates to B (pubB = agentB's K_local).
    const awaitP = connB.call("cello_await_session", { timeout_ms: 25_000 });
    const init = (await connA.call("cello_initiate_session", { target_pubkey: pubB })) as {
      ok?: boolean;
      reason?: string;
      sessionId?: string;
    };
    const diag = `\ninit: ${JSON.stringify(init)}\n--- daemonA (last 50) ---\n${daemonA.output.split("\n").slice(-50).join("\n")}\n--- daemonB (last 30) ---\n${daemonB.output.split("\n").slice(-30).join("\n")}`;
    expect(init.ok, `cello_initiate_session failed:${diag}`).toBe(true);
    const sessionId = init.sessionId!;

    // cello_await_session resolves with the inbound session frame: {type:"new_session",
    // session_id, counterparty_pubkey, genesis_prev_root} (NOT {ok}).
    const inbound = (await awaitP) as { type?: string; session_id?: string; reason?: string };
    expect(inbound.type, `B cello_await_session did not yield a new session: ${JSON.stringify(inbound)}`).toBe(
      "new_session",
    );
    expect(inbound.session_id, "inbound session_id present").toBeTruthy();

    // A sends; B receives the same plaintext.
    const plaintext = "spine6 hello over the wire";
    const sent = (await connA.call("cello_send", { session_id: sessionId, content: plaintext })) as {
      ok?: boolean;
      reason?: string;
    };
    const sendDiag =
      `\nsent: ${JSON.stringify(sent)}\n--- daemonA session/transport ---\n` +
      daemonA.output.split("\n").filter((l) => /session\.|transport\.|connect|counterparty|dial/.test(l)).slice(-25).join("\n") +
      `\n--- daemonB session/transport ---\n` +
      daemonB.output.split("\n").filter((l) => /session\.|transport\.|connect|counterparty|dial/.test(l)).slice(-25).join("\n");
    expect(sent.ok, `cello_send failed:${sendDiag}`).toBe(true);
    const recv = (await connB.call("cello_receive", { session_id: inbound.session_id, timeout_ms: 15_000 })) as {
      ok?: boolean;
      content?: string | null;
    };
    expect(recv.content, `B should receive A's plaintext: ${JSON.stringify(recv)}`).toBe(plaintext);

    // Relay witnessed the HASH (Structure 2): hash_submit from A's session node, then
    // leaf_deliver forwarded to B's connected session node. The plaintext never touched
    // the relay — content is peer↔peer (INV-3).
    expect(cluster.relay.output, "relay must witness the leaf (hash_submit)").toMatch(/hash_submit/);
    expect(cluster.relay.output, "relay must forward the witnessed leaf (leaf_deliver)").toMatch(/leaf_deliver/);
    expect(cluster.relay.output, "plaintext must NEVER appear in relay logs (INV-3)").not.toContain(plaintext);
  }, 90_000);

  // DOD-SPINE-7 — bilateral seal (relay-mediated notarization). Design note: journal
  // 2026-06-20. RED until built: today cello_close_session uses the directory-mediated
  // SEAL-INTERRUPTED bilateral-ack path and the daemon has NO session_sealed listener / no
  // ctrl-leaf relay submit. The build (per the design note): the daemon submits a SEAL ctrl
  // leaf (0x02) via the SPINE-6 AgentRelayClient → relay #maybeProcessSeal sees two
  // distinct-sender ctrl leaves → directory processSeal rebuilds + verifies the signed chain
  // → FROST notarization → session_sealed back to both daemons with a byte-identical
  // sealed_root. Skipped during the build (keeps SPINE-1..6 green); un-skip at green.
  // RE-SKIPPED (harness blocker, not a daemon bug): the daemon side is GREEN — both parties
  // submit their SEAL ctrl leaf and the relay witnesses both from distinct senders (relay log:
  // `hash_submit witnessed ... (ctrl)` from A and from B). But the relay's #maybeProcessSeal is
  // gated `leafKind==="ctrl" && this.#directory`, and the relay binary only wires a
  // NetworkDirectoryAdapter when CELLO_DIRECTORY_MULTIADDR is set — which startSpineCluster does
  // NOT provide (live-harness.ts:273). So the relay can't call directory processSeal → no FROST
  // notarization → no session_sealed → both closes time out (seal_counterparty_pending). FIX is
  // in the harness (wire the relay to the directory). Un-skip once that lands. See journal.
  it.skip("DOD-SPINE-7 — bilateral seal: both close → directory FROST-notarizes → byte-identical sealed_root", async () => {
    // Two parties = two daemons (the SPINE-6 topology). Establish a session + one message,
    // then BOTH cello_close_session → both submit SEAL ctrl leaves → relay-mediated directory
    // notarization → both observe session_sealed with the SAME sealed_root (INV-2: B's
    // co-signature is B's own node's, never forged by A or the directory).
    const celloDirA = mkdtempSync(join(tmpdir(), "cello-spine7A-"));
    const celloDirB = mkdtempSync(join(tmpdir(), "cello-spine7B-"));
    agentDirs.push(celloDirA, celloDirB);
    await provisionAgent(celloDirA, "agentA");
    const pubB = await provisionAgent(celloDirB, "agentB");
    const daemonA = await startDaemon(celloDirA, cluster.directoryUrl, "spine7A");
    const daemonB = await startDaemon(celloDirB, cluster.directoryUrl, "spine7B");
    daemons.push(daemonA, daemonB);
    expect(cello(["register", "agentA", `DEV-spine7-A-${randomBytes(6).toString("hex")}`], { CELLO_DIR: celloDirA }).status).toBe(0);
    expect(cello(["register", "agentB", `DEV-spine7-B-${randomBytes(6).toString("hex")}`], { CELLO_DIR: celloDirB }).status).toBe(0);

    const connA = await connectMcp(celloDirA, "spine7-A");
    mcpConns.push(connA);
    const connB = await connectMcp(celloDirB, "spine7-B");
    mcpConns.push(connB);
    expect(((await connA.call("cello_start_agent", { name: "agentA" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connA.call("cello_use_agent", { name: "agentA" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connB.call("cello_start_agent", { name: "agentB" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connB.call("cello_use_agent", { name: "agentB" })) as { ok?: boolean }).ok).toBe(true);

    const awaitP = connB.call("cello_await_session", { timeout_ms: 25_000 });
    const init = (await connA.call("cello_initiate_session", { target_pubkey: pubB })) as { ok?: boolean; sessionId?: string };
    expect(init.ok, `cello_initiate_session failed: ${JSON.stringify(init)}`).toBe(true);
    const sessionIdA = init.sessionId!;
    const inbound = (await awaitP) as { type?: string; session_id?: string };
    expect(inbound.type).toBe("new_session");
    const sessionIdB = inbound.session_id!;

    // One message so the sealed tree is non-trivial.
    expect(((await connA.call("cello_send", { session_id: sessionIdA, content: "spine7 sealed message" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connB.call("cello_receive", { session_id: sessionIdB, timeout_ms: 15_000 })) as { content?: string | null }).content).toBe("spine7 sealed message");

    // BOTH parties close → both submit SEAL ctrl leaves → relay-mediated directory FROST seal.
    // The seal only notarizes once BOTH have closed, so each close blocks awaiting
    // session_sealed — they MUST run concurrently (a sequential await would deadlock the
    // first on the second).
    const [closeA, closeB] = (await Promise.all([
      connA.call("cello_close_session", { session_id: sessionIdA }),
      connB.call("cello_close_session", { session_id: sessionIdB }),
    ])) as Array<{ ok?: boolean; sealed_root?: string; reason?: string }>;
    const closeDiag = `\ncloseA: ${JSON.stringify(closeA)}\ncloseB: ${JSON.stringify(closeB)}` +
      `\n--- daemonA seal/relay ---\n${daemonA.output.split("\n").filter((l) => /seal|relay|hash_submit/.test(l)).slice(-15).join("\n")}` +
      `\n--- daemonB seal/relay ---\n${daemonB.output.split("\n").filter((l) => /seal|relay|hash_submit/.test(l)).slice(-15).join("\n")}` +
      `\n--- directory seal/notif ---\n${cluster.directory.output.split("\n").filter((l) => /seal|notif|deliver|enqueue|stream|frost|notariz/i.test(l)).slice(-25).join("\n")}` +
      `\n--- relay ---\n${cluster.relay.output.split("\n").slice(-20).join("\n")}`;
    expect(closeA.ok, `A close failed:${closeDiag}`).toBe(true);
    expect(closeB.ok, `B close failed:${closeDiag}`).toBe(true);

    // The directory rebuilt + FROST-notarized the signed chain; both sides observe the SAME root.
    expect(closeA.sealed_root, `A must surface a sealed_root:${closeDiag}`).toMatch(/^[0-9a-f]{64}$/);
    expect(closeB.sealed_root, `B must surface a sealed_root:${closeDiag}`).toMatch(/^[0-9a-f]{64}$/);
    expect(closeA.sealed_root, "both parties' sealed_root must be BYTE-IDENTICAL").toBe(closeB.sealed_root);

    // Directory-corroborated: the relay witnessed two ctrl-leaf submissions (the SEAL leaves).
    expect(cluster.relay.output, "relay must witness both SEAL ctrl leaves").toMatch(/hash_submit/);
  }, 120_000);
});
