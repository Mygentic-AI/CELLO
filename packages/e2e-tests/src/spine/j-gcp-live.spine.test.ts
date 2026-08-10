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
      // RECEIVE, THEN SEND — and re-receive on every retry. This is NOT a timing flake, which is what
      // it looked like before the reason was surfaced: two of three runs died here and the message
      // said only "expected false to be true".
      //
      // The real reason is `session_not_current`: the protocol REFUSES a send while the sender has
      // unread messages ("you are blocked from replying to something you haven't read"). The
      // counterparty's greeting lands moments after the receive above, so A is blocked — and a
      // retry of the SEND ALONE can never clear it. It would fail four identical times, thirty
      // seconds slower, and read as a stubborn flake rather than a rule being enforced correctly.
      //
      // So the loop drains first and sends second. Bounded: if reading and then sending still fails
      // four times over ~30s, that IS the finding and must fail the run.
      let sent: { ok?: boolean; delivered?: boolean; reason?: string; guidance?: string } = {};
      for (let attempt = 1; attempt <= 4; attempt++) {
        cli(a.dir, ["receive", sid]);
        sent = cli(a.dir, ["send", sid, "j-gcp-live", "--wrap"]) as typeof sent;
        if (sent.ok) break;
        if (attempt < 4) await new Promise((r) => setTimeout(r, 10_000));
      }
      // Carry the REASON into the failure. "send failed: expected false to be true" names the
      // assertion and not the fault, and a live test whose failure message omits the one field the
      // daemon filled in costs a whole re-run to learn what it already knew.
      expect(
        sent.ok,
        `send failed after 4 attempts over ~30s: reason=${sent.reason ?? "(none)"} guidance=${sent.guidance ?? "(none)"}`,
      ).toBe(true);
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

      // ASSERTED AT THE END, not here. The active-seal phase is a KNOWN-RED regression guard for a
      // different defect (`seal_unilateral_timeout` — the notarization is durable but the closing
      // side is never told, fixed by having the client fetch the certificate). Asserting inline
      // aborted the run before the interrupted-seal phase below ever executed, so one red guard
      // masked an entirely unrelated one and the second could never report at all.
      //
      // Both are still asserted, and neither is weakened — only the ORDER moves.

      // ── PHASE 2: the INTERRUPTED cross-node seal ─────────────────────────────────────────────
      //
      // Phase 1 proves an ACTIVE cross-node seal. The interrupted variant takes a DIFFERENT branch
      // of the close handler, and that branch did not dial the brokering node — so between two
      // agents homed on different directories it timed out in BOTH directions while each
      // counterparty was online and waiting. Measured 2026-08-07 (CELLO_Coder_1 on gcp-euw1,
      // Miss_Chelly_H on gcp-usc1); the code had been that way, untouched, since 2026-06-15.
      //
      // It survived because every other test puts both agents on ONE machine, hence one directory —
      // the single arrangement in which the bug cannot occur. This phase exists to make that
      // configuration impossible to ship green again.
      //
      // A daemon SIGKILL + restart is how a real session becomes 'interrupted' (daemon.ts: "a daemon
      // restart flips dead half-opens to 'interrupted'"), so this drives the real path rather than
      // forcing a status.
      const sess2 = cli(a.dir, ["initiate-session", bPub]) as { sessionId?: string; reason?: string };
      expect(sess2.sessionId, `second session failed: ${sess2.reason}`).toBeTruthy();
      const sid2 = sess2.sessionId!;

      await new Promise((r) => setTimeout(r, 8_000));
      cli(b.dir, ["receive", sid2]);
      cli(a.dir, ["receive", sid2]);
      expect((cli(a.dir, ["send", sid2, "j-gcp-live-interrupted", "--wrap"]) as { ok?: boolean }).ok).toBe(true);
      await new Promise((r) => setTimeout(r, 12_000));
      cli(b.dir, ["receive", sid2]);

      // Kill A's daemon outright — no graceful close, which is what makes the session interrupted
      // rather than sealed — and bring it back on the SAME directory and store.
      const aIndex = sides.findIndex((s) => s.dir === a.dir);
      daemons[aIndex]?.kill("SIGKILL");
      await new Promise((r) => setTimeout(r, 5_000));
      const revived = spawn("node", [DAEMON], {
        env: {
          ...process.env,
          CELLO_DIR: a.dir,
          CELLO_DIRECTORY_URL: a.url,
          CELLO_CONSORTIUM_MANIFEST: manifestPath,
          CELLO_CONSORTIUM_ROOT_KEYS: rootKeys,
          CELLO_CONSORTIUM_THRESHOLD: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
        detached: false,
      });
      let revivedOut = "";
      revived.stderr?.on("data", (d: Buffer) => { revivedOut += d.toString(); });
      revived.stdout?.on("data", (d: Buffer) => { revivedOut += d.toString(); });
      daemons[aIndex] = revived;
      await new Promise((r) => setTimeout(r, 30_000));
      expect(/"event":"daemon\.started"/.test(revivedOut), `revived daemon never started:\n${revivedOut.slice(-1200)}`).toBe(true);

      // The session must now be INTERRUPTED on A's side — if it is not, this phase is asserting
      // nothing and would pass while the interrupted branch stayed broken.
      const listed = cli(a.dir, ["sessions"]) as { sessions?: { session_id?: string; status?: string }[] };
      const row = (listed.sessions ?? []).find((r2) => r2.session_id === sid2);
      expect(row?.status, `expected sid2 to be interrupted after restart, got ${row?.status}`).toBe("interrupted");

      // THE ASSERTION. Closing from the interrupted side must reach the counterparty THROUGH the
      // brokering node and seal. Before the fix this returned counterparty_unavailable after a full
      // timeout, for a counterparty that was online the whole time.
      const rInt = (await cliAsync(a.dir, ["close-session", sid2])) as {
        ok?: boolean; sealed_root?: string; reason?: string;
      };
      expect(
        rInt.ok,
        `interrupted cross-node close failed: ${rInt.reason} — this is the two-node seal defect, ` +
          `not a flake. A same-node run cannot reproduce it.`,
      ).toBe(true);
      expect(rInt.sealed_root).toMatch(/^[0-9a-f]{64}$/);

      // ── the ACTIVE-seal assertions, deferred from above ──────────────────────────────────────
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
