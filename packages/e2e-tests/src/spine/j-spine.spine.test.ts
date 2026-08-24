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
import { pathToFileURL } from "node:url";
import {
  startSpineCluster,
  startDaemon,
  provisionAgent,
  connectMcp,
  awaitSealedRoot,
  cello,
  registerAgent,
  psqlSpineN,
  CELLO_CLIENT_ROOT,
  type McpConn,
  type Proc,
  type SpineCluster,
  writeSignedManifestTo,
  writeConsortiumManifest,
  expectOwnTreeVerified,
} from "./live-harness.js";
import { expectMatches } from "./expect-present.js";
import { spineDirectoryNode, spineNodeKeypair } from "./auth-manifest.js";

// PERSIST-002 (DOD-STORE-1): per-agent identity material lives in the daemon's SQLCipher store
// (the `agents` table), NOT flat files. Open it through the daemon's OWN keyed adapter to assert
// registration persisted each agent's row (k_local_seed + frost_signing_share — its split-key half).
type KeyedStmt = { get(...p: unknown[]): unknown };
type KeyedDb = { prepare(sql: string): KeyedStmt; close(): void };
async function openEncryptedDb(dbPath: string): Promise<KeyedDb> {
  const mod = (await import(
    pathToFileURL(join(CELLO_CLIENT_ROOT, "core/daemon/dist/sqlcipher-db.js")).href
  )) as { openEncryptedDatabaseAtPath(p: string): KeyedDb };
  return mod.openEncryptedDatabaseAtPath(dbPath);
}

let cluster: SpineCluster;
const daemons: Proc[] = [];
const agentDirs: string[] = [];
const mcpConns: McpConn[] = [];

beforeAll(async () => {
  // A THREE-node consortium with a signed manifest — the pattern j-content / j-unilateral /
  // j-persist use, and for the same two reasons. Without the DIRECTORY-side manifest the daemon
  // never learns its own directory node id, so two LOCAL agents are routed down the CROSS-NODE
  // path and cello_initiate_session dies on `discovery_node_unresolvable` before any clause runs.
  // Without the CLIENT-side manifest (startLocalDaemon below) registration's FROST DKG has no
  // consortium and `cello register-agent` exits 1. One node cannot satisfy the DKG threshold,
  // hence directoryCount: 3.
  const consortiumHolder = mkdtempSync(join(tmpdir(), "cello-spine-consortium-"));
  agentDirs.push(consortiumHolder);
  const consortiumManifestPath = join(consortiumHolder, "consortium-manifest.json");
  cluster = await startSpineCluster({
    directoryCount: 3,
    directoryNodeKeysHex: [0, 1, 2].map((i) => spineNodeKeypair(i).privateKeyHex),
    directoryConsortiumManifestPath: consortiumManifestPath,
    onDirectoryUrlsReady: (urls) => {
      writeSignedManifestTo(consortiumManifestPath, urls.map((url, i) => spineDirectoryNode(i, url)));
    },
  });
}, 180_000);
/**
 * A daemon that KNOWS ITS OWN NODE — which is what lets two local agents talk to each other.
 * The client manifest is written OUTSIDE CELLO_DIR so it cannot violate DOD-STORE-1 (no flat-file
 * state under CELLO_DIR — everything belongs in the encrypted store).
 */
async function startLocalDaemon(celloDir: string, label: string): Promise<Proc> {
  const nodes = [0, 1, 2].map((i) => spineDirectoryNode(i, cluster.directoryUrls[i]));
  const manifestDir = mkdtempSync(join(tmpdir(), `cello-manifest-${label}-`));
  agentDirs.push(manifestDir);
  return startDaemon(celloDir, cluster.directoryUrls[0], label, {
    manifestEnv: writeConsortiumManifest(manifestDir, label, nodes),
  });
}


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


/**
 * Parse the JSON object at the START of a CLI stdout, tolerating trailing human guidance.
 *
 * The newer commands emit JSON only; the older ones (login, register-agent, …) print the result and
 * then a next-step hint. Asserting the whole stream is JSON pins a contract the CLI does not have.
 * On failure this throws with the RAW stdout, because "invalid JSON" without the text is exactly the
 * kind of message that sends the next reader to the wrong subsystem.
 */
function parseLeadingJson<T>(stdout: string, what: string): T {
  const text = stdout.trim();
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "{") depth += 1;
    else if (text[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(0, i + 1)) as T;
        } catch (err) {
          throw new Error(`${what}: leading JSON did not parse (${String(err)})\n--- raw stdout ---\n${stdout}`);
        }
      }
    }
  }
  throw new Error(`${what}: no JSON object found in stdout\n--- raw stdout ---\n${stdout}`);
}

/** State of a named agent from a `cello_agents` result ({ agents: [...] }). */
function agentState(listResult: unknown, name: string): string | undefined {
  const agents = (listResult as { agents?: Array<{ name: string; state: string }> }).agents ?? [];
  return agents.find((a) => a.name === name)?.state;
}

/**
 * Whether a named agent is SELECTED on the connection that produced this list.
 *
 * Separate from `state` on purpose — the daemon dropped `current` from the state enum precisely so
 * selection and readiness could not be confused, and reading it needs its own accessor rather than a
 * second meaning layered onto `agentState`.
 */
function agentSelected(listResult: unknown, name: string): boolean | undefined {
  const agents = (listResult as { agents?: Array<{ name: string; selected?: boolean }> }).agents ?? [];
  return agents.find((a) => a.name === name)?.selected;
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
  const daemon = await startLocalDaemon(celloDir, label);
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
    /**
     * ⚠️ THE `connections` ASSERTION IS DELETED, AND IT PROVED NOTHING WHEN IT PASSED.
     *
     * `status.connections` was removed from the daemon-wide surface by commit `5deef4b` —
     * *"drop the always-empty `connections` stub from the status surface"*. It was a **stub that was
     * always `[]`**, so `Array.isArray(...)` was true whether or not a single connection existed. The
     * assertion could only ever prove the STUB was present.
     *
     * That is the same shape as the three agent-state assertions above it: the journey encoding a
     * vocabulary the product deliberately removed, and the removal being the correct call. The
     * daemon-wide status excludes per-connection concepts on purpose — the neighbouring comment in
     * `daemon.ts` makes the same point about `selected`: *"this is the daemon-wide surface; selection
     * is a per-connection concept."*
     *
     * Nothing replaces it here because nothing is lost: the property SPINE-1 is for — the daemon is
     * up, signaling is connected, an agent is loaded, and the DIRECTORY corroborates it — is asserted
     * on the three lines above, and the IPC connection is proven by `status` parsing at all. The
     * per-connection view has its own coverage in `DOD-SPINE-2/3`, which asserts two connections
     * disagreeing about selection.
     */

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

    /**
     * DOD-SPINE-3: three-state model, observed in sequence. `login` does NOT auto-start agents, so a
     * freshly-loaded agent is **`stopped`**.
     *
     * ⚠️ THIS ASSERTED `"registered"`, WHICH THE STATE MACHINE CANNOT RETURN — and the failure was
     * being read as "the multi-process floor is red".
     *
     * `resolveAgentState` emits exactly `load_failed | unregistered | paused | stopped | connecting |
     * online | unattended`. `"registered"` was a STORED FLAG that was deliberately removed, and
     * `agent-state.ts` says why: *"Deliberately NOT a stored 'registered' flag … every agent on disk
     * was labelled 'registered' at load whether or not it ever was."* It was removed **because it
     * lied**; the derived model calls a loaded-but-not-started agent `stopped`, which is the same
     * fact stated truthfully.
     *
     * So this journey was asserting the vocabulary of the defect that was fixed. The product change
     * was deliberate and correct; the journey was never updated with it.
     *
     * **Why it mattered out of proportion:** `DOD-SPINE-1..7` in this same file — register two agents
     * with a real DKG, receive a FROST-signed assignment, send and receive through the relay, and
     * complete a bilateral seal with a byte-identical root — all PASS. None of that is reachable with
     * a daemon that failed to start. The milestone nevertheless recorded this lane's floor as broken
     * on the strength of this line.
     */
    expect(agentState(await conn1.call("cello_agents"), "agentA"), "agentA starts stopped — loaded, not yet started").toBe(
      "stopped",
    );

    // stopped → online (cello_start_agent; daemon-wide set).
    const started = (await conn1.call("cello_start_agent", { name: "agentA" })) as { ok?: boolean };
    expect(started.ok, `cello_start_agent failed: ${JSON.stringify(started)}`).toBe(true);
    /**
     * ⚠️ ALSO STALE, AND IT IS THE SAME RENAME ONE STEP LATER. This asserted `"online"`.
     *
     * `resolveAgentState`'s last line is `return i.attendance > 0 ? "online" : "unattended"`. Starting
     * an agent does not make anyone ATTEND it — `cello_start_agent` brings the agent up and connects
     * its signaling; attendance arrives when a connection actually takes the agent, which is the
     * `cello_use_agent` two steps below.
     *
     * So `unattended` is the truthful state here, and it is a distinction worth keeping: *"running,
     * reachable, and nobody is listening"* is a different thing to tell an operator than *"online"*.
     * The assertions after this one are already consistent with that model — once conn1 takes the
     * agent, conn1 sees `current` and conn2 sees `online`, because by then attendance is 1.
     */
    expect(agentState(await conn1.call("cello_agents"), "agentA"), "agentA unattended after start — up, but nobody has taken it yet").toBe(
      "unattended",
    );

    // online → current, but ONLY on conn1 (DOD-SPINE-2 independence).
    const used = (await conn1.call("cello_use_agent", { name: "agentA" })) as { ok?: boolean };
    expect(used.ok, `cello_use_agent failed: ${JSON.stringify(used)}`).toBe(true);

    const list1 = await conn1.call("cello_agents");
    const list2 = await conn2.call("cello_agents");

    /**
     * ⚠️ THIS ASSERTED `state === "current"`, AND `current` WAS DELIBERATELY REMOVED FROM THE ENUM.
     *
     * `getAgentsForConnection` says why, in the code: *"`state` reports READINESS only; selection is
     * a SEPARATE `selected` flag. **Never fold selection into `state`** — a selected agent is not at a
     * different level of readiness than a second healthy online agent. (This is why `current` was
     * dropped from the enum.)"*
     *
     * The old assertion could not distinguish "conn1 selected it" from "conn1 sees it as healthier",
     * because the enum conflated the two. **The new one is strictly stronger:** both connections must
     * agree on READINESS (`online` — attendance is now 1 because conn1 attends it), and they must
     * DISAGREE on selection. That is `DOD-SPINE-2`'s independence property stated directly instead of
     * inferred from a state name.
     */
    expect(agentState(list1, "agentA"), "conn1: readiness is online — selection is not a readiness level").toBe("online");
    expect(agentState(list2, "agentA"), "conn2 must agree on readiness — same daemon, same agent").toBe("online");
    expect(agentSelected(list1, "agentA"), "conn1 selected agentA, so conn1 must see selected=true").toBe(true);
    expect(
      agentSelected(list2, "agentA"),
      "conn2 must be UNAFFECTED by conn1's switch — this is the independence DOD-SPINE-2 is for, and " +
        "it is the half the old `current` assertion could not actually check",
    ).toBe(false);

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
    const daemon = await startLocalDaemon(celloDir, "spine4");
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
    // Named distinctly from the harness's `registerAgent` it calls: this one PARSES the
    // register_success payload and asserts on it. Sharing the name would shadow the import and
    // recurse.
    function registerAndParse(name: string): { agentId: string; primaryPubkey: string } {
      const token = `DEV-spine4-${name}-${randomBytes(6).toString("hex")}`;
      const res = registerAgent(name, token, env);
      const diag =
        `\n--- cello register-agent ${name} stdout ---\n${res.stdout}\n` +
        `--- daemon log (last 60) ---\n${daemon.output.split("\n").slice(-60).join("\n")}\n` +
        `--- directory log (last 60) ---\n${cluster.directory.output.split("\n").slice(-60).join("\n")}`;
      expect(res.status, `cello register-agent ${name} failed:${diag}`).toBe(0);
      // The older CLI commands print the JSON result and THEN human guidance on the same stream
      // (`cli-args.ts` says so), so `JSON.parse(stdout)` fails with "Unexpected non-whitespace
      // character after JSON". Parse the leading JSON object and keep the rest for diagnosis —
      // never silently discard it, or a CLI that changed shape looks like a parse quirk.
      const parsed = parseLeadingJson<{ ok?: boolean; agent_id?: string; primary_pubkey?: string }>(
        res.stdout,
        `cello register-agent ${name}`,
      );
      expect(parsed.ok, `register ${name} not ok: ${res.stdout}`).toBe(true);
      expect(typeof parsed.agent_id, `register ${name} missing agent_id`).toBe("string");
      // The line ABOVE already guards `agent_id` with an explicit `typeof … toBe("string")`. This one
      // did not, so the correct pattern was sitting one line up from the wrong one.
      expectMatches(parsed.primary_pubkey, `register ${name} missing primary_pubkey`, /^[0-9a-f]{64}$/);
      return { agentId: parsed.agent_id!, primaryPubkey: parsed.primary_pubkey! };
    }
    const regA = registerAndParse("agentA");
    const regB = registerAndParse("agentB");

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
      const rows = psqlSpineN(0, 
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
    const accountCount = psqlSpineN(0, `SELECT count(*) FROM user_accounts WHERE account_id = '${sharedAccount}'`);
    expect(accountCount, "exactly one user_accounts row backs the shared account_id").toBe("1");

    /**
     * ⚠️ AND THE SAME FACT IN THE TABLE AUTHORIZATION ACTUALLY READS — the assertion above is about
     * REGISTRATION'S OWN WRITE, which is legitimate but is not the row anything decides from.
     *
     * `CELLO-REPL-001` moved the reader off `agent_profiles.account_id` to the replicated
     * **`agent_account_links`**, joined on the stable `agent_id` — pubkeys rotate, and that is the row
     * the same-operator check and **the kill switch** are resolved from. Asserting only the profile
     * column proves the registration path wrote something; it says nothing about whether the fact the
     * product uses exists.
     *
     * **That gap is exactly the failure V59 was written for: 0/2/1 agents linked across three nodes
     * (2026-08-07)** — registration looked fine on every node and authorization disagreed with all of
     * them. And it is the same shape `j-end` was just fixed for: a journey checking the column the
     * fixture writes rather than the one the resolver reads.
     */
    const linkCount = psqlSpineN(
      0,
      `SELECT count(*) FROM agent_account_links l JOIN agent_profiles p ON p.agent_id = l.agent_id ` +
      `WHERE l.account_id = '${sharedAccount}' AND lower(p.k_local_pubkey) IN (lower('${pubA}'), lower('${pubB}'))`,
    );
    expect(
      linkCount,
      "BOTH agents must be LINKED to that account in agent_account_links — the table authorization " +
        "and the kill switch resolve from. Registration writing agent_profiles.account_id is not the " +
        `same fact, and V59 exists because those two once disagreed. Got ${JSON.stringify(linkCount)}`,
    ).toBe("2");

    // ── Per-agent persistence: PERSIST-002 (DOD-STORE-1) moved all per-agent material from flat files
    // into the daemon's SQLCipher store (the `agents` table). Assert each registered agent has its row
    // with a K_local seed AND a persisted FROST signing share — DOD-INV-2: that share is the agent's
    // HALF of the split key, neither it nor the directory's K_server_X share can sign alone. Read
    // through the daemon's OWN keyed adapter (a stub that skipped persistence fails here). And assert
    // NO legacy flat-file key exists (the PERSIST-002 no-flat-file invariant). ──
    const adb = await openEncryptedDb(join(celloDir, "sessions.db"));
    try {
      for (const name of ["agentA", "agentB"]) {
        const row = adb
          .prepare("SELECT length(k_local_seed) AS seedLen, length(frost_signing_share) AS shareLen FROM agents WHERE agent_name = ? AND state != 'retired'")
          .get(name) as { seedLen?: number; shareLen?: number } | undefined;
        expect(row, `${name} must have a row in the encrypted agents store`).toBeTruthy();
        expect((row?.seedLen ?? 0) > 0, `${name} must persist its K_local seed`).toBe(true);
        expect((row?.shareLen ?? 0) > 0, `${name} must persist its FROST signing share (DOD-INV-2)`).toBe(true);
      }
    } finally {
      adb.close();
    }
    // PERSIST-002 no-flat-file invariant: the legacy per-agent key file must NOT exist.
    expect(existsSync(join(celloDir, "agents", "agentA", "key")), "PERSIST-002: no legacy flat-file key").toBe(false);
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

    /**
     * ⚠️ WAIT FOR THE STANDING RECEIVER BEFORE ASKING THE DIRECTORY ANYTHING.
     *
     * This test failed with `standing_receiver_unavailable`, and that is **not a directory answer at
     * all** — it is a precondition on THIS side. `cello_start_agent` returning does not mean the
     * standing receiver exists yet; the receiver is created as the agent comes up, and an initiate
     * that lands in that window is refused locally and never reaches the negotiator.
     *
     * So the assertion below was measuring a local race and reporting it as *"the negotiator did not
     * reach the directory"* — an exit-point label standing in for a cause, which is the substitution
     * this milestone keeps finding.
     *
     * Other journeys paper over this by retrying the initiate on that transient. **A readiness poll is
     * better than a retry loop:** it waits for the thing that is actually being waited on, and if the
     * receiver never becomes ready it fails saying THAT, rather than burning the retries and blaming
     * the directory. `standing_receiver_ready` is on the MCP surface for exactly this reason —
     * *"so a deaf agent is visible to the operator"*.
     */
    let receiverReady = false;
    for (let i = 0; i < 40 && !receiverReady; i++) {
      const st = (await conn.call("cello_status")) as {
        agents?: Array<{ name: string; standing_receiver_ready?: boolean }>;
      };
      receiverReady = st.agents?.find((a) => a.name === "agentA")?.standing_receiver_ready === true;
      if (!receiverReady) await sleep(250);
    }
    expect(
      receiverReady,
      "agentA's standing receiver never became ready, so an initiate could not reach the directory. " +
        "This is a LOCAL precondition — if it fails, look for session.node.created in the daemon log, " +
        "not at the directory.",
    ).toBe(true);

    // cello-mcp's required param is `target_pubkey` (z.string()). An unregistered target.
    const res = (await conn.call("cello_initiate_session", {
      target_pubkey: "00".repeat(32),
    })) as { ok?: boolean; reason?: string };
    expect(res.ok, `expected initiate to be not-ok for an unregistered target: ${JSON.stringify(res)}`).toBe(false);
    /**
     * The assertion's INTENT is that the answer came FROM THE DIRECTORY — not the wired-out
     * `directory_signaling_not_configured`, and not a local refusal.
     *
     * ⚠️ IT EXPECTED `target_offline`, AND THE DIRECTORY NOW GIVES A BETTER ANSWER. The target here is
     * `00…00`, a pubkey **nobody ever registered**. `target_offline` says *"the agent exists and is
     * not connected"*, which is false about it; `unknown_agent` says *"No agent is registered under
     * that public key"*, which is true and sends the operator somewhere useful. Asserting the vaguer
     * of the two would pin the directory to a less accurate reason than it is capable of.
     *
     * Both are directory-sourced, so both satisfy the intent — this takes the precise one.
     */
    expect(
      res.reason,
      `negotiator should reach the directory and name the real cause: ${JSON.stringify(res)}`,
    ).toBe("unknown_agent");
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
    const daemon = await startLocalDaemon(celloDir, "spine5b");
    daemons.push(daemon);
    const env = { CELLO_DIR: celloDir };

    // Register both (DEV tokens). Registration brings each agent's per-agent signaling
    // stream up — that is what makes agentB a reachable target at the directory.
    for (const name of ["agentA", "agentB"]) {
      const r = registerAgent(name, `DEV-spine5-${name}-${randomBytes(6).toString("hex")}`, env);
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
    const daemonA = await startLocalDaemon(celloDirA, "spine6A");
    const daemonB = await startLocalDaemon(celloDirB, "spine6B");
    daemons.push(daemonA, daemonB);
    const rA = registerAgent("agentA", `DEV-spine6-A-${randomBytes(6).toString("hex")}`, { CELLO_DIR: celloDirA });
    expect(rA.status, `register agentA failed:\n${rA.stdout}`).toBe(0);
    const rB = registerAgent("agentB", `DEV-spine6-B-${randomBytes(6).toString("hex")}`, { CELLO_DIR: celloDirB });
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
    const sent = (await connA.call("cello_send", { cello_session_id: sessionId, content: plaintext, signal: "over" })) as {
      ok?: boolean;
      reason?: string;
    };
    const sendDiag =
      `\nsent: ${JSON.stringify(sent)}\n--- daemonA session/transport ---\n` +
      daemonA.output.split("\n").filter((l) => /session\.|transport\.|connect|counterparty|dial/.test(l)).slice(-25).join("\n") +
      `\n--- daemonB session/transport ---\n` +
      daemonB.output.split("\n").filter((l) => /session\.|transport\.|connect|counterparty|dial/.test(l)).slice(-25).join("\n");
    expect(sent.ok, `cello_send failed:${sendDiag}`).toBe(true);
    const recv = (await connB.call("cello_receive", { cello_session_id: inbound.session_id, timeout_ms: 15_000 })) as {
      ok?: boolean;
      content?: string | null;
    };
    expect(recv.content, `B should receive A's plaintext: ${JSON.stringify(recv)}`).toBe(`${plaintext} [[OVER]]`);

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
  it("DOD-SPINE-7 — bilateral seal: both close → directory FROST-notarizes → byte-identical sealed_root", async () => {
    // Two parties = two daemons (the SPINE-6 topology). Establish a session + one message,
    // then BOTH cello_close_session → both submit SEAL ctrl leaves → relay-mediated directory
    // notarization → both observe session_sealed with the SAME sealed_root (INV-2: B's
    // co-signature is B's own node's, never forged by A or the directory).
    const celloDirA = mkdtempSync(join(tmpdir(), "cello-spine7A-"));
    const celloDirB = mkdtempSync(join(tmpdir(), "cello-spine7B-"));
    agentDirs.push(celloDirA, celloDirB);
    await provisionAgent(celloDirA, "agentA");
    const pubB = await provisionAgent(celloDirB, "agentB");
    const daemonA = await startLocalDaemon(celloDirA, "spine7A");
    const daemonB = await startLocalDaemon(celloDirB, "spine7B");
    daemons.push(daemonA, daemonB);
    expect(registerAgent("agentA", `DEV-spine7-A-${randomBytes(6).toString("hex")}`, { CELLO_DIR: celloDirA }).status).toBe(0);
    expect(registerAgent("agentB", `DEV-spine7-B-${randomBytes(6).toString("hex")}`, { CELLO_DIR: celloDirB }).status).toBe(0);

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
    expect(((await connA.call("cello_send", { cello_session_id: sessionIdA, content: "spine7 sealed message", signal: "over" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connB.call("cello_receive", { cello_session_id: sessionIdB, timeout_ms: 15_000 })) as { content?: string | null }).content).toBe(`spine7 sealed message [[OVER]]`);

    // BOTH parties close → both submit SEAL ctrl leaves → relay-mediated directory FROST seal.
    // The seal only notarizes once BOTH have closed, so each close blocks awaiting
    // session_sealed — they MUST run concurrently (a sequential await would deadlock the
    // first on the second).
    const [closeA, closeB] = (await Promise.all([
      connA.call("cello_close_session", { cello_session_id: sessionIdA }),
      connB.call("cello_close_session", { cello_session_id: sessionIdB }),
    ])) as Array<{ ok?: boolean; sealed_root?: string; reason?: string }>;
    const closeDiag = `\ncloseA: ${JSON.stringify(closeA)}\ncloseB: ${JSON.stringify(closeB)}` +
      `\n--- daemonA seal/relay ---\n${daemonA.output.split("\n").filter((l) => /seal|relay|hash_submit/.test(l)).slice(-15).join("\n")}` +
      `\n--- daemonB seal/relay ---\n${daemonB.output.split("\n").filter((l) => /seal|relay|hash_submit/.test(l)).slice(-15).join("\n")}` +
      `\n--- directory seal/notif ---\n${cluster.directory.output.split("\n").filter((l) => /seal|notif|deliver|enqueue|stream|frost|notariz/i.test(l)).slice(-25).join("\n")}` +
      `\n--- relay ---\n${cluster.relay.output.split("\n").slice(-20).join("\n")}`;
    expect(closeA.ok, `A close failed:${closeDiag}`).toBe(true);
    expect(closeB.ok, `B close failed:${closeDiag}`).toBe(true);

    // The directory rebuilt + FROST-notarized the signed chain; both sides observe the SAME root.
    /**
     * DOD-M15-CLOSEROOT-1: close returns a COMMITMENT, not a root — made non-blocking deliberately
     * ("exactly how seventeen sessions were lost when this call used to block"). Poll the receipt.
     */
    const [rootA, rootB] = await Promise.all([
      awaitSealedRoot(connA, sessionIdA, { label: "A sealed receipt" }),
      awaitSealedRoot(connB, sessionIdB, { label: "B sealed receipt" }),
    ]);
    expect(rootA, `A must surface a sealed_root:${closeDiag}`).toMatch(/^[0-9a-f]{64}$/);
    expect(rootB, `B must surface a sealed_root:${closeDiag}`).toMatch(/^[0-9a-f]{64}$/);
    expect(rootA, "both parties received the same certificate").toBe(rootB);

    /**
     * AND EACH PARTY RECOGNISES THE TREE IT WAS CERTIFIED OVER — `SEALWIRE-1` bullet 8.
     *
     * This is DOD-SPINE-7, the file the whole spine is named for, and its title says
     * "byte-identical sealed_root". Byte-identical is what two reads of ONE certificate always are.
     * The claim underneath — INV-2, that B's receipt describes B's conversation — needs each side to
     * have checked the certified root against the leaves it holds, which is what this asserts.
     */
    await expectOwnTreeVerified(daemonA, sessionIdA, { label: "A (DOD-SPINE-7 bilateral seal)" });
    await expectOwnTreeVerified(daemonB, sessionIdB, { label: "B (DOD-SPINE-7 bilateral seal)" });

    // Directory-corroborated: the relay witnessed two ctrl-leaf submissions (the SEAL leaves).
    expect(cluster.relay.output, "relay must witness both SEAL ctrl leaves").toMatch(/hash_submit/);
  }, 120_000);
});
