/**
 * J-SPINE live binary harness (M7 — M7-PROCEDURE.md §4).
 *
 * This is the ENFORCER for the M7 Definition of Done. It spawns the REAL shipped
 * binaries as child processes on localhost and talks to them over real TCP / Noise
 * / IPC. It is the deliberate opposite of `session-fixture.ts`:
 *
 *   - It NEVER imports `createClient`, `createMcpSessionServer`,
 *     `createDirectoryNode`, or `createRelayNode`. It does not construct any node
 *     in-process. A test wired to a library symbol silently validates dead code; a
 *     test that runs the program cannot. (M7-PROCEDURE.md §4; the dead-stack
 *     blindness postmortem.)
 *   - It anchors to the BINARY. Each node is `node <pkg>/dist/bin/<bin>.js`.
 *
 * The ONE library import below — `FileKeyProvider` — is credential provisioning,
 * not node construction: it generates the directory's signing key file in the same
 * on-disk format the directory binary reads (MAGIC + version + 32-byte seed), and
 * exposes its public key, exactly as a real operator's `~/.cello/directory-key`
 * would. We need the directory pubkey BEFORE the relay starts (the relay
 * authenticates directory admin frames against `CELLO_DIRECTORY_PUBKEY`), and the
 * relay starts before the directory. Note: `loadOrGenerateRelayKey` is NOT usable
 * here — it writes libp2p protobuf, which `FileKeyProvider.load` rejects as
 * `key_file_corrupt: invalid magic bytes`.
 */
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import { FileKeyProvider } from "@cello-protocol/crypto";
import { peerIdFromTransportSeed } from "@cello-protocol/relay";
import {
  makeSignedManifest,
  CONSORTIUM_ROOT_KEYS,
  CONSORTIUM_THRESHOLD,
  DIRECTORY_NODE_PRIVATE_KEY_HEX,
  DIRECTORY_NODE_PUBLIC_KEY_HEX,
  type ConsortiumNodeEntry,
  type MakeManifestOpts,
} from "./auth-manifest.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// ─── Repo + binary locations ────────────────────────────────────────────────
// This file: packages/e2e-tests/src/spine/live-harness.ts → repo root is 4 up.
const HERE = fileURLToPath(new URL(".", import.meta.url));
export const TRUSTLESS_ROOT = resolve(HERE, "../../../..");
// cello-client is a sibling repo (REPOSPLIT): the daemon / mcp / cli binaries.
export const CELLO_CLIENT_ROOT = resolve(TRUSTLESS_ROOT, "../cello-client");

export const BINS = {
  // trustless-cello (this repo)
  relay: join(TRUSTLESS_ROOT, "packages/relay/dist/bin/relay.js"),
  directory: join(TRUSTLESS_ROOT, "packages/directory/dist/bin/directory.js"),
  // cello-client (sibling repo)
  daemon: join(CELLO_CLIENT_ROOT, "core/daemon/dist/bin/cello-daemon.js"),
  mcp: join(CELLO_CLIENT_ROOT, "core/adapter-claude-code/dist/bin/cello-mcp.js"),
  cli: join(CELLO_CLIENT_ROOT, "core/cli/dist/bin/cello.js"),
} as const;

// ─── Free-port allocation (the daemon needs the directory health URL up front) ──
export async function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.once("error", rej);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => res(port));
    });
  });
}

// ─── A spawned binary: capture stdout/stderr lines, wait for a log line ─────────
export class Proc {
  readonly name: string;
  private child: ChildProcess;
  private lines: string[] = [];
  private waiters: Array<{ re: RegExp; resolve: (l: string) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }> = [];
  private exited: { code: number | null; signal: NodeJS.Signals | null } | null = null;

  constructor(name: string, binPath: string, env: Record<string, string>, args: string[] = []) {
    this.name = name;
    this.child = spawn(process.execPath, [binPath, ...args], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    // Per-stream partial-line carry (M2): a JSON log line split across two chunks must
    // not be torn into two "lines" — keep the trailing partial until its newline arrives.
    this.attachStream(this.child.stdout);
    this.attachStream(this.child.stderr);
    this.child.on("error", (err: Error) => {
      this.failWaiters(new Error(`[${this.name}] spawn error: ${err.message}`));
    });
    // M3: a binary that exits before emitting the awaited line must surface as an exit,
    // not a slow timeout. Reject any pending waiters with the code/signal + log tail.
    this.child.on("exit", (code: number | null, signal: NodeJS.Signals | null) => {
      this.exited = { code, signal };
      this.failWaiters(
        new Error(
          `[${this.name}] exited (code=${code}, signal=${signal}) before the awaited line.\n` +
            `--- last 20 lines ---\n${this.lines.slice(-20).join("\n")}`,
        ),
      );
    });
  }

  private attachStream(stream: NodeJS.ReadableStream | null): void {
    if (!stream) return;
    // StringDecoder (not buf.toString()) so a multibyte UTF-8 sequence split across two
    // chunks is reassembled rather than mangled; carry holds the partial trailing LINE.
    const decoder = new StringDecoder("utf8");
    let carry = "";
    stream.on("data", (buf: Buffer) => {
      carry += decoder.write(buf);
      const parts = carry.split("\n");
      carry = parts.pop() ?? ""; // retain trailing partial for the next chunk
      for (const raw of parts) {
        if (!raw.trim()) continue;
        this.lines.push(raw);
        for (const w of [...this.waiters]) {
          if (w.re.test(raw)) {
            clearTimeout(w.timer);
            this.waiters = this.waiters.filter((x) => x !== w);
            w.resolve(raw);
          }
        }
      }
    });
  }

  private failWaiters(err: Error): void {
    const pending = this.waiters;
    this.waiters = [];
    for (const w of pending) {
      clearTimeout(w.timer);
      w.reject(err);
    }
  }

  /** Resolve with the first stdout/stderr line matching `re` (scans backlog first). */
  waitForLine(re: RegExp, timeoutMs: number): Promise<string> {
    const existing = this.lines.find((l) => re.test(l));
    if (existing) return Promise.resolve(existing);
    if (this.exited) {
      return Promise.reject(
        new Error(
          `[${this.name}] already exited (code=${this.exited.code}, signal=${this.exited.signal}); cannot match ${re}.\n` +
            `--- last 20 lines ---\n${this.lines.slice(-20).join("\n")}`,
        ),
      );
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.timer !== timer);
        reject(
          new Error(
            `[${this.name}] timed out after ${timeoutMs}ms waiting for ${re}.\n` +
              `--- last 20 lines ---\n${this.lines.slice(-20).join("\n")}`,
          ),
        );
      }, timeoutMs);
      this.waiters.push({ re, resolve, reject, timer });
    });
  }

  get output(): string {
    return this.lines.join("\n");
  }

  async stop(): Promise<void> {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    this.child.kill("SIGTERM");
    await new Promise<void>((r) => {
      const t = setTimeout(() => {
        this.child.kill("SIGKILL");
        r();
      }, 5_000);
      this.child.once("exit", () => {
        clearTimeout(t);
        r();
      });
    });
  }
}

/** Extract the first `adapter.initialised / ListenAddr` multiaddr (with /p2p/) from a proc. */
export function listenMultiaddr(proc: Proc, opts: { ws?: boolean } = {}): string {
  for (const line of proc.output.split("\n")) {
    if (!line.includes('"adapterName":"ListenAddr"')) continue;
    let parsed: { implementation?: string };
    try {
      parsed = JSON.parse(line) as { implementation?: string };
    } catch {
      continue;
    }
    const addr = parsed.implementation ?? "";
    if (!addr.includes("/p2p/")) continue;
    const isWs = addr.includes("/ws");
    if (opts.ws === true && !isWs) continue;
    if (opts.ws === false && isWs) continue;
    return addr.replace("0.0.0.0", "127.0.0.1");
  }
  throw new Error(`[${proc.name}] no ListenAddr multiaddr found (ws=${opts.ws}).\n${proc.output.slice(-1500)}`);
}

// ─── Postgres bring-up (the directory exits 1 without applied migrations) ───────
// J-SPINE provisions its OWN database (cello_spine), dropped + recreated fresh each
// run, so the test never depends on the mutable, drift-prone local `cello_dev` and
// every run applies V1→V{N} from scratch (matching CI / a brand-new region — the
// canonical fresh-migrate). Roles are cluster-level and guarded in the migrations
// (DO/pg_roles), so a fresh DB in the existing cluster migrates cleanly. This never
// pushes anything anywhere; images are cached locally.
const SPINE_DB = "cello_spine";
export const DATABASE_URL = `postgresql://postgres:dev@localhost:5433/${SPINE_DB}`;

export function ensurePostgres(): void {
  try {
    execFileSync("docker", ["info"], { stdio: "ignore" });
  } catch {
    throw new Error(
      "Docker is not running. The directory binary requires local Postgres " +
        "(docker-compose `postgres` + `flyway`). Start Docker Desktop and retry.",
    );
  }
  execFileSync("docker", ["compose", "up", "-d", "--wait", "postgres"], { cwd: TRUSTLESS_ROOT, stdio: "inherit" });
  // Fresh, isolated test DB: drop + recreate so the migration history is always clean.
  execFileSync(
    "docker",
    [
      "compose", "exec", "-T", "postgres",
      "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1",
      "-c", `DROP DATABASE IF EXISTS ${SPINE_DB} WITH (FORCE);`,
      "-c", `CREATE DATABASE ${SPINE_DB};`,
    ],
    { cwd: TRUSTLESS_ROOT, stdio: "inherit" },
  );
  // Migrate the fresh DB from V1 — no repair needed (clean history).
  execFileSync(
    "docker",
    ["compose", "run", "--rm", "-e", `FLYWAY_URL=jdbc:postgresql://postgres:5432/${SPINE_DB}`, "flyway"],
    { cwd: TRUSTLESS_ROOT, stdio: "inherit" },
  );
}

// ─── Spine DB query (directory-side corroboration the daemon cannot fabricate) ──
// Runs a read-only SQL statement against the harness-owned `cello_spine` Postgres
// via the same `docker compose exec` path used to provision it. `-tAc` = tuples-only,
// unaligned, single command → the raw scalar/row text with no decoration. This is how
// SPINE-4 asserts the directory's OWN writes (agent_profiles / user_accounts) rather
// than trusting the daemon's self-report (reviewer H1 discipline).
export function psqlSpine(sql: string): string {
  const out = execFileSync(
    "docker",
    [
      "compose", "exec", "-T", "postgres",
      "psql", "-U", "postgres", "-d", SPINE_DB, "-tAc", sql,
    ],
    { cwd: TRUSTLESS_ROOT, encoding: "utf8" },
  );
  return out.trim();
}

// ─── The spine cluster: relay + directory, real binaries ────────────────────────
export interface SpineCluster {
  tmpDir: string;
  relay: Proc;
  directory: Proc;
  relayMultiaddr: string;
  directoryUrl: string; // http://127.0.0.1:<healthPort> — the daemon's CELLO_DIRECTORY_URL
  stop: () => Promise<void>;
}

// ─── J-AUTH (DOD-AUTH-1/2): consortium manifest + directory step-6 identity ──────
// The directory's per-node signing key and the officer root keys are the DETERMINISTIC
// test fixtures exported from @cello-protocol/crypto. The directory signs step-5 with
// AUTH_DIRECTORY_NODE_KEY_HEX (private seed); a daemon configured with a manifest that
// lists nodeId "local" → AUTH_DIRECTORY_NODE_PUBKEY verifies that proof at step-6.
export const AUTH_DIRECTORY_NODE_ID = "local";
export const AUTH_DIRECTORY_NODE_KEY_HEX = DIRECTORY_NODE_PRIVATE_KEY_HEX;
export const AUTH_DIRECTORY_NODE_PUBKEY = DIRECTORY_NODE_PUBLIC_KEY_HEX;

/** The daemon env vars that select + trust a consortium manifest (step-6 ON). */
export interface ManifestEnv {
  CELLO_CONSORTIUM_MANIFEST: string;
  CELLO_CONSORTIUM_ROOT_KEYS: string;
  CELLO_CONSORTIUM_THRESHOLD: string;
}

/**
 * Build + write a threshold-signed consortium manifest, returning the daemon env
 * that selects it. `nodes` is the manifest's node set — use trustedDirectoryNode()
 * for the happy path, or a different/empty node set for the rogue case. `opts`
 * overrides version / not_before / expires (use a past `expires` for the expiry case).
 */
export function writeConsortiumManifest(
  tmpDir: string,
  name: string,
  nodes: ConsortiumNodeEntry[],
  opts?: MakeManifestOpts,
): ManifestEnv {
  const manifest = makeSignedManifest(nodes, opts);
  const manifestPath = join(tmpDir, `consortium-manifest-${name}.json`);
  writeFileSync(manifestPath, JSON.stringify(manifest));
  return {
    CELLO_CONSORTIUM_MANIFEST: manifestPath,
    CELLO_CONSORTIUM_ROOT_KEYS: CONSORTIUM_ROOT_KEYS.join(","),
    CELLO_CONSORTIUM_THRESHOLD: String(CONSORTIUM_THRESHOLD),
  };
}

/** The "this directory IS in the consortium" node entry (happy-path step-6). */
export function trustedDirectoryNode(): ConsortiumNodeEntry {
  return {
    nodeId: AUTH_DIRECTORY_NODE_ID,
    pubkey: AUTH_DIRECTORY_NODE_PUBKEY,
    region: "local",
    provider: "aws",
    endpoint: "/ip4/127.0.0.1/tcp/0",
  };
}

export interface StartSpineClusterOpts {
  /**
   * J-AUTH: when set, the directory signs its step-5 challenge with this Ed25519 seed
   * (64-hex), enabling step-6 verification by a manifest-configured daemon. Use
   * AUTH_DIRECTORY_NODE_KEY_HEX so a manifest built from trustedDirectoryNode() verifies.
   */
  directoryNodeKeyHex?: string;
}

/**
 * Bring up the real relay + directory binaries on localhost and return the
 * coordinates a daemon needs. Order: provision dir signing key (for its pubkey) →
 * relay (needs CELLO_DIRECTORY_PUBKEY) → directory (needs CELLO_RELAY_MULTIADDR).
 *
 * NOTE (J-SPINE open question #1, journal 2026-06-18): the relay is started WITHOUT
 * CELLO_DIRECTORY_MULTIADDR, so it does not register with the directory and cannot
 * yet call back for the bilateral seal. That is sufficient for SPINE-1..6; the
 * seal-callback wiring (SPINE-7) is resolved empirically when its assertion runs.
 */
export async function startSpineCluster(opts: StartSpineClusterOpts = {}): Promise<SpineCluster> {
  ensurePostgres();
  const tmpDir = mkdtempSync(join(tmpdir(), "cello-jspine-"));

  // Provision the directory signing key in the binary's own format, read its pubkey.
  const dirKeyFile = join(tmpDir, "directory-key");
  const dirKp = await FileKeyProvider.load(dirKeyFile);
  const dirPubkeyHex = Buffer.from(await dirKp.getPublicKey()).toString("hex");

  const auditLog = join(tmpDir, "audit.jsonl");
  writeFileSync(auditLog, "");
  const devEnvelopeKey = randomBytes(32).toString("hex");

  // L7: if any step throws after a child is spawned, stop the already-running
  // children (and remove tmpDir) so we never orphan a relay/directory/Postgres — an
  // orphaned node holds ports/locks and corrupts the next run.
  let relay: Proc | undefined;
  let directory: Proc | undefined;
  const abort = async (err: unknown): Promise<never> => {
    if (directory) await directory.stop();
    if (relay) await relay.stop();
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
    throw err;
  };

  try {
    // ── Break the relay↔directory startup cycle (DOD-SPINE-7) ───────────────────
    // In CELLO_ENV=local the directory REQUIRES CELLO_RELAY_MULTIADDR at startup AND the
    // relay REQUIRES CELLO_DIRECTORY_MULTIADDR (with /p2p/<peer-id>) so it can wire its
    // NetworkDirectoryAdapter and call processSeal (the bilateral-seal trigger). Each needs
    // the other's address — a cycle. We break it by PRE-DERIVING the relay's PeerID from a
    // fixed transport SEED (pure key crypto, not node construction) and binding the relay to
    // a FIXED port, so the relay's multiaddr is known BEFORE either process starts. Then we
    // start the directory FIRST (it dials the relay lazily, at recordAssignment/seal time, by
    // which point the relay is up), read its real multiaddr, and start the relay second with
    // CELLO_DIRECTORY_MULTIADDR set — so #maybeProcessSeal → directory processSeal works.
    const relaySeed = new Uint8Array(randomBytes(32));
    const relaySeedHex = Buffer.from(relaySeed).toString("hex");
    const relayPeerId = await peerIdFromTransportSeed(relaySeed);
    const relayPort = await freePort();
    const relayMultiaddr = `/ip4/127.0.0.1/tcp/${relayPort}/p2p/${relayPeerId}`;

    // ── Directory (starts FIRST now; loads the signing key we provisioned) ──
    const healthPort = await freePort();
    directory = new Proc("directory", BINS.directory, {
      CELLO_ENV: "local",
      DATABASE_URL,
      DEV_ENVELOPE_KEY: devEnvelopeKey,
      AUDIT_LOG_PATH: auditLog,
      CELLO_RELAY_MULTIADDR: relayMultiaddr,
      CELLO_DIRECTORY_KEY_FILE: dirKeyFile,
      CELLO_DIRECTORY_TRANSPORT_KEY_FILE: join(tmpDir, "directory-transport-key"),
      CELLO_DIRECTORY_LISTEN_ADDR: "/ip4/127.0.0.1/tcp/0",
      CELLO_DIRECTORY_WS_LISTEN_ADDR: "/ip4/127.0.0.1/tcp/0/ws",
      HEALTH_PORT: String(healthPort),
      // J-AUTH: when a node signing key is supplied, the directory signs step-5 as
      // nodeId "local" so a manifest-configured daemon can verify it at step-6.
      ...(opts.directoryNodeKeyHex
        ? { CELLO_DIRECTORY_NODE_KEY_HEX: opts.directoryNodeKeyHex, NODE_ID: AUTH_DIRECTORY_NODE_ID }
        : {}),
    });
    // BootstrapEndpoint line means /bootstrap is live — the daemon can discover us.
    await directory.waitForLine(/"adapterName":"BootstrapEndpoint"/, 30_000);
    const directoryMultiaddr = listenMultiaddr(directory, { ws: false });

    // ── Relay (starts SECOND; bound to the fixed port + pre-derived seed so its real
    // multiaddr equals relayMultiaddr. Given CELLO_DIRECTORY_MULTIADDR it wires the
    // NetworkDirectoryAdapter + registers with the now-running directory). ──
    relay = new Proc("relay", BINS.relay, {
      NODE_ENV: "test",
      CELLO_ENV: "local",
      CELLO_DIRECTORY_PUBKEY: dirPubkeyHex,
      CELLO_DIRECTORY_MULTIADDR: directoryMultiaddr,
      CELLO_RELAY_KEY_FILE: join(tmpDir, "relay-key"),
      CELLO_RELAY_TRANSPORT_KEY_HEX: relaySeedHex,
      CELLO_RELAY_LISTEN_ADDR: `/ip4/127.0.0.1/tcp/${relayPort}`,
      CELLO_RELAY_HEALTH_PORT: String(await freePort()),
    });
    await relay.waitForLine(/"adapterName":"ListenAddr"/, 20_000);

    const relayRef = relay;
    const directoryRef = directory;
    const stop = async (): Promise<void> => {
      await directoryRef.stop();
      await relayRef.stop();
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    };

    return {
      tmpDir,
      relay: relayRef,
      directory: directoryRef,
      relayMultiaddr,
      directoryUrl: `http://127.0.0.1:${healthPort}`,
      stop,
    };
  } catch (err) {
    return abort(err);
  }
}

// ─── Daemon: spawn the real binary directly so the harness owns + observes it ───
// `cello login` spawns the daemon detached + unref'd (stdio stdout piped to the
// short-lived login process), which orphans it from the test — we can't capture its
// logs or tear it down deterministically. The DoD allows "starts OR connects to",
// so the harness starts the real cello-daemon binary itself (logs captured), and the
// CLI then CONNECTS to it. Each agent gets its own CELLO_DIR (socket + DB + lock).
// Provision an agent's K_local identity at ${celloDir}/agents/<name>/key — the local
// identity that onboarding (the Telegram Operations Agent) creates on a real machine.
// The daemon's agent-loader reads it at startup; the protocol-significant DKG still
// runs for real via `cello register`. FileKeyProvider.load generates+persists the key
// in the daemon's expected format (and creates the parent dirs).
export async function provisionAgent(celloDir: string, name: string): Promise<string> {
  const kp = await FileKeyProvider.load(join(celloDir, "agents", name, "key"));
  return Buffer.from(await kp.getPublicKey()).toString("hex");
}

export async function startDaemon(
  celloDir: string,
  directoryUrl: string,
  label: string,
  opts: { manifestEnv?: ManifestEnv; waitForStarted?: boolean } = {},
): Promise<Proc> {
  const daemon = new Proc(`daemon-${label}`, BINS.daemon, {
    CELLO_DIR: celloDir,
    CELLO_DIRECTORY_URL: directoryUrl,
    // J-AUTH: when a manifest env is supplied, the daemon loads + verifies it and
    // turns on step-6 directory-identity verification (challengeVerifier).
    ...(opts.manifestEnv ?? {}),
  });
  // The expiry case wants to observe the daemon REFUSING to start (loadAndVerify
  // throws manifest_expired); callers pass waitForStarted:false and assert the exit.
  if (opts.waitForStarted !== false) {
    await daemon.waitForLine(/"event":"daemon\.started"/, 15_000);
  }
  return daemon;
}

// ─── CLI driver: run `cello <args>` against a daemon home, capture output ───────
export interface CliResult {
  stdout: string;
  status: number;
}

export function cello(args: string[], env: Record<string, string>): CliResult {
  try {
    const stdout = execFileSync(process.execPath, [BINS.cli, ...args], {
      env: { ...process.env, ...env },
      encoding: "utf8",
      timeout: 30_000,
    });
    return { stdout, status: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { stdout: (e.stdout ?? "") + (e.stderr ?? ""), status: e.status ?? 1 };
  }
}

// ─── MCP connection: a real cello-mcp process driven via the MCP SDK client ─────
// Each connection spawns the shipped `cello-mcp` binary (StdioClientTransport), which
// connects to the running daemon over IPC and sends `ipc.connect {clientType:"mcp"}`.
// Two McpConns to one daemon = two distinct IPC connections (DOD-SPINE-2). This is the
// real agent tool surface — anchored to the binary, no in-process MCP server.
export interface McpConn {
  client: Client;
  /** Call a cello_* tool and return its unwrapped JSON result. */
  call: (name: string, args?: Record<string, unknown>) => Promise<unknown>;
  close: () => Promise<void>;
}

export async function connectMcp(celloDir: string, label: string): Promise<McpConn> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [BINS.mcp],
    env: { ...process.env, CELLO_DIR: celloDir },
  });
  const client = new Client({ name: `jspine-${label}`, version: "0.0.1" });
  try {
    await client.connect(transport);
  } catch (err) {
    // StdioClientTransport spawned cello-mcp during connect — close it so a failed
    // handshake doesn't orphan the child (harness orphan-avoidance discipline).
    try {
      await transport.close();
    } catch {
      /* best-effort */
    }
    throw err;
  }
  return {
    client,
    call: async (name, args = {}) => {
      const res = (await client.callTool({ name, arguments: args })) as {
        content?: Array<{ type: string; text?: string }>;
      };
      // cello-mcp wraps results as content:[{type:"text", text: JSON.stringify(value)}].
      const text = res.content?.find((c) => c.type === "text")?.text;
      return text !== undefined ? JSON.parse(text) : res;
    },
    close: async () => {
      try {
        await client.close();
      } catch {
        /* best-effort — also kills the spawned cello-mcp */
      }
    },
  };
}
