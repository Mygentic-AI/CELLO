/**
 * J-GCP-LIVE — DOD-E2E-GCP-1 enforcer: the multi-cloud path, against the REAL fleet.
 *
 * ─── Why this is not like the other spine tests ──────────────────────────────────────────────
 * Every other spine test starts local directory processes. This one starts NOTHING server-side: it
 * drives two real client daemons against the three live GCP directories and the live relay. That is
 * the point — the defects this milestone actually shipped were all invisible to local runs:
 *
 *   - AutoNAT tore down the shared connection ONLY between publicly-addressed peers; on loopback
 *     autonat skips same-host peers, so every local test stayed green.
 *   - The FROST share write failed ONLY against Cloud KMS, whose ciphertext length is not
 *     plaintext+28; a local AES-GCM provider satisfied the old check.
 *   - The seal was adjudicated by ONE relay-pinned directory and could not reach an initiator homed
 *     elsewhere; a single-node local run has no elsewhere.
 *
 * A green local suite is therefore not evidence for any of them. This test is the evidence.
 *
 * ─── OPT-IN. It costs real cloud calls and needs credentials ─────────────────────────────────
 *   CELLO_GCP_E2E=1                 enable (otherwise the whole file skips)
 *   gcloud auth                     Secret Manager read, to mint pre-auth capabilities
 *
 * It mints its own capabilities and registers throwaway agents, so it needs no fixture state. It
 * does NOT mutate infrastructure — the "kill a directory" clause of DOD-E2E-GCP-1 stays manual on
 * purpose: a test that terminates a live node is not something to run by accident.
 *
 * ─── Socket paths ────────────────────────────────────────────────────────────────────────────
 * CELLO_DIR must be SHORT. A unix socket path over ~104 chars dies with `listen EINVAL`, and both
 * `/tmp` (cleaned by macOS mid-run) and the session scratchpad (~134 chars) fail — for different
 * reasons. Hence a short path under $HOME.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const ENABLED = process.env["CELLO_GCP_E2E"] === "1";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..");
const CLIENT_ROOT = process.env["CELLO_CLIENT_ROOT"] ?? join(REPO_ROOT, "..", "cello-client-m12");
const CLI = join(CLIENT_ROOT, "core", "cli", "dist", "bin", "cello.js");
const DAEMON = join(CLIENT_ROOT, "core", "daemon", "dist", "bin", "cello-daemon.js");

/**
 * Two agents on DIFFERENT directories, and NEITHER is the relay's configured directory.
 *
 * The relay is pinned to `gcp-use1` (`relay_primary_directory`), so choosing `usc1` and `euw1` here
 * exercises the worst case: the directory the relay would ask by default can reach NEITHER
 * participant. That is the case that went untested while sealing was being fixed, and it is the one
 * DOD-SEAL-BROKER-1 exists for — the relay must instead ask whichever directory BROKERED the
 * session, which by construction has a relationship to the conversation.
 *
 * Picking use1 for one side would let a fix that only handles "misses one participant" pass.
 */
const DIRECTORIES = [
  { nodeId: "gcp-usc1", url: "http://34.136.176.190:9090" },
  { nodeId: "gcp-euw1", url: "http://34.34.166.245:9090" },
];

let root: string;
let manifestPath: string;
let rootKeys: string;
const daemons: ChildProcess[] = [];

/**
 * Run a command and return its output, WITHOUT throwing on a non-zero exit.
 *
 * The CLI exits non-zero when it returns `{"ok":false,...}` — correctly. But execFileSync turns that
 * into an exception, so the harness died before it could read the `reason`, and the test reported a
 * stack trace at the call site instead of "session failed: relay_unavailable". The refusal IS the
 * result here; it has to be parsed, not thrown.
 */
function sh(cmd: string, args: string[], env?: Record<string, string>): string {
  const r = spawnSync(cmd, args, { encoding: "utf8", env: { ...process.env, ...env }, timeout: 600_000 });
  return `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
}

/**
 * stdout ONLY. For commands whose stdout IS the value and whose stderr is operator commentary.
 *
 * `sh` merges both streams so a CLI refusal can be parsed rather than thrown — but merging corrupts a
 * value-returning command: the capability minter prints the blob on stdout and "# issuer …/# nonce …"
 * on stderr, and concatenating them produced a capability the client rejected as malformed. Two
 * different needs, two functions.
 */
function shOut(cmd: string, args: string[]): string {
  const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 600_000 });
  return (r.stdout ?? "").trim();
}

/**
 * Extract the FIRST complete JSON object from CLI output.
 *
 * The CLI prints JSON and then human follow-up prose ("Next: run cello status …"), so slicing from
 * the first brace to end-of-output never parses — and the failure is silent, surfacing as a missing
 * `ok` field that reads exactly like the command having failed. It cost a debug cycle: registration
 * had SUCCEEDED and the assertion said it failed.
 */
function firstJsonObject(out: string): unknown {
  const start = out.indexOf("{");
  if (start === -1) return { raw: out };
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < out.length; i++) {
    const c = out[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try { return JSON.parse(out.slice(start, i + 1)); } catch { return { raw: out }; }
    }
  }
  return { raw: out };
}

/**
 * ASYNC CLI runner. Required for the bilateral close and nothing else.
 *
 * `cli()` is synchronous and BLOCKS THE EVENT LOOP — so two closes scheduled with setTimeout
 * run strictly sequentially, and the first waits out its full bilateral window for a second close
 * that cannot start until it returns. That produced an 812-second "failure" for a seal the fleet had
 * actually completed in 3 seconds. A bilateral ceremony cannot be driven by synchronous calls.
 */
function cliAsync(dir: string, args: string[]): Promise<unknown> {
  return new Promise((resolve) => {
    const proc = spawn("node", [CLI, ...args], {
      env: {
        ...process.env,
        CELLO_DIR: dir,
        CELLO_CONSORTIUM_MANIFEST: manifestPath,
        CELLO_CONSORTIUM_ROOT_KEYS: rootKeys,
        CELLO_CONSORTIUM_THRESHOLD: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    proc.stdout.on("data", (d: Buffer) => { out += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { out += d.toString(); });
    // Longer than CELLO_SEAL_BILATERAL_TIMEOUT_MS (660s default) — a harness timeout SHORTER than the
    // protocol's own wait reports a failure the protocol never had.
    const timer = setTimeout(() => { try { proc.kill("SIGKILL"); } catch { /* gone */ } }, 780_000);
    proc.on("close", () => { clearTimeout(timer); resolve(firstJsonObject(out)); });
  });
}

function cli(dir: string, args: string[]): unknown {
  const out = sh("node", [CLI, ...args], {
    CELLO_DIR: dir,
    CELLO_CONSORTIUM_MANIFEST: manifestPath,
    CELLO_CONSORTIUM_ROOT_KEYS: rootKeys,
    CELLO_CONSORTIUM_THRESHOLD: "1",
  });
  return firstJsonObject(out);
}

/** Mint a real pre-auth capability. Deliberately NOT a bypass: the point is to exercise the
 *  production registration path, not a variant with the capability check disabled. */
function mintCapability(): string {
  return shOut("node", [join(REPO_ROOT, "infra", "scripts", "mint-preauth-capability.mjs"), "--ttl-minutes", "60"]);
}

describe.skipIf(!ENABLED)("J-GCP-LIVE — DOD-E2E-GCP-1 against the live GCP fleet", () => {
  beforeAll(() => {
    expect(existsSync(CLI), `client CLI not built at ${CLI} — run pnpm build in cello-client`).toBe(true);
    expect(existsSync(DAEMON), `client daemon not built at ${DAEMON}`).toBe(true);

    root = mkdtempSync(join(homedir(), ".cello-e2e-"));
    manifestPath = join(root, "manifest.json");

    // Sign a fresh consortium manifest from the LIVE topology, so this cannot pass against a stale
    // roster. The officer root key comes from the same run — a manifest and a root key that disagree
    // is a failure worth coupling together rather than letting drift.
    //
    // The signer prints the key on STDERR (it is operator output, not the manifest), so capture both
    // streams. Reading only stdout silently yields no key.
    const signed = spawnSync(
      "node",
      [join(REPO_ROOT, "infra", "scripts", "sign-gcp-consortium-manifest.mjs"), "--out", manifestPath],
      { encoding: "utf8", timeout: 600_000 },
    );
    if (signed.status !== 0) {
      throw new Error(`manifest signing failed (exit ${signed.status}) — is gcloud authenticated?\n${signed.stderr}`);
    }
    rootKeys = /CELLO_CONSORTIUM_ROOT_KEYS=([0-9a-f]{64})/.exec(`${signed.stdout}${signed.stderr}`)?.[1] ?? "";
    if (!rootKeys) {
      // Fail HERE with the signer's own output rather than letting every daemon refuse the manifest
      // later for a reason that would point at the wrong component.
      throw new Error(`could not read the officer root key from the signer output:\n${signed.stderr}`);
    }

    const nodes = (JSON.parse(readFileSync(manifestPath, "utf8")) as { nodes: { nodeId: string }[] }).nodes;
    expect(nodes.length, "the live manifest must list all three directories").toBe(3);
  }, 900_000);

  afterAll(() => {
    for (const d of daemons) { try { d.kill("SIGTERM"); } catch { /* already gone */ } }
    if (root) { try { rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ } }
  });

  it(
    "two agents on DIFFERENT directories register, session over the relay, exchange content, and SEAL bilaterally",
    async () => {
      const sides = DIRECTORIES.map((d, i) => ({ ...d, dir: join(root, String(i)), agent: `e2e${i}` }));

      // ── daemons ──
      // CELLO_DIR must EXIST before the daemon starts; it does not create its own directory, and the
      // failure mode is a daemon that dies before opening its socket, which then surfaces three
      // steps later as an unparseable CLI response rather than as "no such directory".
      const daemonErr = new Map<string, string>();
      for (const s of sides) {
        mkdirSync(s.dir, { recursive: true });
        const proc = spawn("node", [DAEMON], {
          env: {
            ...process.env,
            CELLO_DIR: s.dir,
            CELLO_DIRECTORY_URL: s.url,
            CELLO_CONSORTIUM_MANIFEST: manifestPath,
            CELLO_CONSORTIUM_ROOT_KEYS: rootKeys,
            CELLO_CONSORTIUM_THRESHOLD: "1",
          },
          stdio: ["ignore", "pipe", "pipe"],
          detached: false,
        });
        // Keep stderr: when a daemon refuses to start (bad manifest, socket too long, port clash) its
        // reason is here and NOWHERE else — every later assertion would blame the wrong component.
        proc.stderr?.on("data", (d: Buffer) => daemonErr.set(s.agent, (daemonErr.get(s.agent) ?? "") + d.toString()));
        proc.stdout?.on("data", (d: Buffer) => daemonErr.set(s.agent, (daemonErr.get(s.agent) ?? "") + d.toString()));
        daemons.push(proc);
      }
      await new Promise((r) => setTimeout(r, 30_000));

      for (const s of sides) {
        const started = /"event":"daemon\.started"/.test(daemonErr.get(s.agent) ?? "");
        expect(started, `daemon for ${s.agent} never started:\n${(daemonErr.get(s.agent) ?? "(no output)").slice(-1200)}`).toBe(true);
      }

      // ── register, each against its OWN directory ──
      for (const s of sides) {
        cli(s.dir, ["create-agent", s.agent]);
        const reg = cli(s.dir, ["register-agent", s.agent, mintCapability()]) as { ok?: boolean; reason?: string; raw?: string };
        expect(reg.ok, `${s.agent} registration failed: ${reg.reason ?? reg.raw ?? JSON.stringify(reg)}`).toBe(true);
        cli(s.dir, ["start-agent", s.agent]);
        cli(s.dir, ["use-agent", s.agent]);
      }
      await new Promise((r) => setTimeout(r, 40_000));

      const [a, b] = sides as [typeof sides[0], typeof sides[0]];
      const bPub = ((cli(b.dir, ["agents"]) as { agents: { pubkey: string }[] }).agents[0] ?? { pubkey: "" }).pubkey;
      expect(bPub).toMatch(/^[0-9a-f]{64}$/);

      // ── session ──
      // Retry, bounded. Cross-node discovery is EVENTUALLY consistent by design: b registered against
      // its own directory, and a's directory learns of it through anti-entropy (~60s round). A single
      // attempt asserts instant convergence, which the design never promised — it fails with
      // `unknown_agent` and would read as a discovery defect.
      //
      // Bounded on purpose: retrying indefinitely would mask a genuine discovery failure. Four
      // attempts over ~3 minutes is several AE rounds; if it has not converged by then, that IS the
      // finding.
      let sess: { sessionId?: string; reason?: string; transportMode?: string } = {};
      for (let attempt = 1; attempt <= 4; attempt++) {
        sess = cli(a.dir, ["initiate-session", bPub]) as typeof sess;
        if (sess.sessionId) break;
        if (attempt < 4) await new Promise((r) => setTimeout(r, 60_000));
      }
      expect(sess.sessionId, `session failed after 4 attempts over ~3min: ${sess.reason}`).toBeTruthy();
      const sid = sess.sessionId!;

      // ── content, both directions ──
      await new Promise((r) => setTimeout(r, 8_000));
      cli(b.dir, ["receive", sid]);
      cli(a.dir, ["receive", sid]);
      const sent = cli(a.dir, ["send", sid, "j-gcp-live", "--wrap"]) as { ok?: boolean; delivered?: boolean };
      expect(sent.ok, "send failed").toBe(true);
      await new Promise((r) => setTimeout(r, 12_000));
      cli(b.dir, ["receive", sid]);

      // ── the seal, with the RESPONDER closing first ──
      // This ordering is the regression guard. It makes the responder the SEAL initiator, which is
      // the case that failed every time until the relay learned to follow a redirect to the node
      // holding that agent's stream. Closing initiator-first would pass even with the bug.
      const closes = [b, a].map(async (s, i) => {
        if (i > 0) await new Promise((r) => setTimeout(r, 4_000));
        return (await cliAsync(s.dir, ["close-session", sid])) as { ok?: boolean; sealed_root?: string; reason?: string };
      });
      const [rb, ra] = await Promise.all(closes);

      expect(ra.ok, `initiator close failed: ${ra.reason}`).toBe(true);
      expect(rb.ok, `responder close failed: ${rb.reason}`).toBe(true);
      // Both parties must agree on the root. A seal where each side holds a different root is worse
      // than no seal — it is two receipts that cannot both be true.
      expect(ra.sealed_root).toMatch(/^[0-9a-f]{64}$/);
      expect(ra.sealed_root).toBe(rb.sealed_root);
    },
    1_800_000,
  );
});
