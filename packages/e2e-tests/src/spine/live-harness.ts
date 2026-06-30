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
import { createServer, createConnection } from "node:net";
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
  spineNodeId,
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

  /**
   * Count captured stdout/stderr lines matching `re`. Used for windowed positive-control scrapes:
   * record a count before an action and assert it increased after, to prove a FRESH log event fired
   * (not an identical one from an earlier phase). Subject to the same stdout-capture lag as the
   * backlog — await a short settle before reading after an action that should have logged.
   */
  countLines(re: RegExp): number {
    return this.lines.filter((l) => re.test(l)).length;
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

  /**
   * Abrupt kill (SIGKILL) — no graceful shutdown. Models a crash / power loss, so the
   * process never runs its shutdown handlers (e.g. the daemon does NOT mark its active
   * sessions interrupted on the way out — that detection must happen on the NEXT start).
   * This is what J-INT needs to exercise the `source: daemon_restart` path.
   */
  async kill(): Promise<void> {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    this.child.kill("SIGKILL");
    await new Promise<void>((r) => this.child.once("exit", () => r()));
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

/** The libpq URL for a harness-owned spine database (one per sovereign directory node). */
export function spineDbUrl(dbName: string): string {
  return `postgresql://postgres:dev@localhost:5433/${dbName}`;
}

/**
 * Provision + fresh-migrate each named spine database. Each sovereign directory node
 * gets its OWN database — T-of-N means every node holds its own K_server share; there
 * is NO shared store (CONTEXT.md sovereignty). A 3-node cluster passes
 * ["cello_spine_0","cello_spine_1","cello_spine_2"]; the default is the single-node
 * `cello_spine` (back-compat with every M7 spine test). Every DB is dropped + recreated
 * + migrated V1→V{N} from scratch — matching CI / a brand-new region. Never pushes
 * anything anywhere; images are cached locally.
 */
export function ensurePostgres(dbNames: string[] = [SPINE_DB]): void {
  try {
    execFileSync("docker", ["info"], { stdio: "ignore" });
  } catch {
    throw new Error(
      "Docker is not running. The directory binary requires local Postgres " +
        "(docker-compose `postgres` + `flyway`). Start Docker Desktop and retry.",
    );
  }
  execFileSync("docker", ["compose", "up", "-d", "--wait", "postgres"], { cwd: TRUSTLESS_ROOT, stdio: "inherit" });
  for (const dbName of dbNames) {
    // Fresh, isolated test DB: drop + recreate so the migration history is always clean.
    execFileSync(
      "docker",
      [
        "compose", "exec", "-T", "postgres",
        "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1",
        "-c", `DROP DATABASE IF EXISTS ${dbName} WITH (FORCE);`,
        "-c", `CREATE DATABASE ${dbName};`,
      ],
      { cwd: TRUSTLESS_ROOT, stdio: "inherit" },
    );
    // Migrate the fresh DB from V1 — no repair needed (clean history).
    execFileSync(
      "docker",
      ["compose", "run", "--rm", "-e", `FLYWAY_URL=jdbc:postgresql://postgres:5432/${dbName}`, "flyway"],
      { cwd: TRUSTLESS_ROOT, stdio: "inherit" },
    );
  }
}

// ─── Spine DB query (directory-side corroboration the daemon cannot fabricate) ──
// Runs a read-only SQL statement against the harness-owned `cello_spine` Postgres
// via the same `docker compose exec` path used to provision it. `-tAc` = tuples-only,
// unaligned, single command → the raw scalar/row text with no decoration. This is how
// SPINE-4 asserts the directory's OWN writes (agent_profiles / user_accounts) rather
// than trusting the daemon's self-report (reviewer H1 discipline).
export function psqlDb(dbName: string, sql: string): string {
  const out = execFileSync(
    "docker",
    [
      "compose", "exec", "-T", "postgres",
      "psql", "-U", "postgres", "-d", dbName, "-tAc", sql,
    ],
    { cwd: TRUSTLESS_ROOT, encoding: "utf8" },
  );
  return out.trim();
}

/** Read node 0's DB — the single-node default `cello_spine` (every M7 spine test). */
export function psqlSpine(sql: string): string {
  return psqlDb(SPINE_DB, sql);
}

/** Read sovereign directory node i's OWN DB (`cello_spine_${i}`) in a multi-node cluster. */
export function psqlSpineN(i: number, sql: string): string {
  return psqlDb(`${SPINE_DB}_${i}`, sql);
}

/**
 * DOD-SUSPEND-1: copy an agent's `agent_profiles` row from directory node `from` to node `to`,
 * mimicking the `cello_pub` logical replication that production uses so every sovereign node can
 * honor a suspension (isAgentSuspended JOINs agent_suspensions→agent_profiles per node; only the
 * registering node has the row). `id` (auto) + `account_id` (FK to user_accounts, absent on the
 * target → NULL) are excluded; the suspension JOIN needs only agent_id + k_local_pubkey.
 */
export function copyAgentProfileBetweenNodes(fromNode: number, toNode: number, kLocalPubkeyHex: string): void {
  const cols = "k_local_pubkey,primary_pubkey,ml_dsa_pubkey,phone_stub_hash,registered_at,status,created_at,chain_hash,agent_id";
  execFileSync(
    "docker",
    [
      "compose", "exec", "-T", "postgres", "bash", "-c",
      `psql -U postgres -d ${SPINE_DB}_${fromNode} -c "COPY (SELECT ${cols} FROM agent_profiles WHERE k_local_pubkey='${kLocalPubkeyHex}') TO STDOUT" | ` +
        `psql -U postgres -d ${SPINE_DB}_${toNode} -v ON_ERROR_STOP=1 -c "COPY agent_profiles (${cols}) FROM STDIN"`,
    ],
    { cwd: TRUSTLESS_ROOT, stdio: "inherit" },
  );
}

// ─── The spine cluster: relay + directory, real binaries ────────────────────────
export interface SpineCluster {
  tmpDir: string;
  relay: Proc;
  /** The live directory proc (node 0). Follows restartDirectory() (getter-backed). */
  directory: Proc;
  /**
   * All live directory procs (length === directoryCount; node 0 follows
   * restartDirectory). Single-node clusters expose exactly `[directory]`.
   */
  directories: Proc[];
  /** J-SIG recovery: re-spawn an identical directory (node 0) on the same bootstrap URL. */
  restartDirectory: () => Promise<Proc>;
  relayMultiaddr: string;
  directoryUrl: string; // http://127.0.0.1:<healthPort> — node 0's CELLO_DIRECTORY_URL
  /** The bootstrap/health URL of every directory node (directoryUrls[0] === directoryUrl). */
  directoryUrls: string[];
  /** The Postgres URL of every sovereign node's OWN database (per-node K_server share). */
  databaseUrls: string[];
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

/**
 * DOD-AUTH-2: write a freshly-signed consortium manifest to an EXACT path. The directory
 * serves whatever this file currently contains, so calling this again with a higher
 * `version` rotates the served manifest mid-run — the poll-refresh test's rotation seam.
 */
export function writeSignedManifestTo(
  path: string,
  nodes: ConsortiumNodeEntry[],
  opts?: MakeManifestOpts,
): void {
  writeFileSync(path, JSON.stringify(makeSignedManifest(nodes, opts)));
}

/**
 * DOD-AUTH-2 (adversarial): write a FORGED manifest — correct structure, valid version
 * window, but officer signatures replaced with garbage (as a rogue/compromised directory
 * would serve). A polling client must independently re-verify and REFUSE to adopt it.
 */
export function writeForgedManifestTo(
  path: string,
  nodes: ConsortiumNodeEntry[],
  opts?: MakeManifestOpts,
): void {
  const manifest = makeSignedManifest(nodes, opts);
  manifest.signatures = manifest.signatures.map((s) => ({ ...s, signature: "00".repeat(64) }));
  writeFileSync(path, JSON.stringify(manifest));
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
   * M8B (DOD-SPINE-1): number of sovereign directory nodes to spawn (default 1). With
   * N>1 the harness spawns N real `directory.js` binaries, each with its OWN signing key,
   * transport key (→ distinct PeerID), health/bootstrap port, listen port, and OWN
   * fresh-migrated database (`cello_spine_${i}`). N=3 is the T-of-N substrate. The relay
   * is still wired to node 0 for its seal callback (SPINE-7); per-node node-identity keys
   * + the relay accepting any node arrive with DOD-MANIFEST-1 / Option B.
   */
  directoryCount?: number;
  /**
   * J-AUTH: when set, the directory signs its step-5 challenge with this Ed25519 seed
   * (64-hex), enabling step-6 verification by a manifest-configured daemon. Use
   * AUTH_DIRECTORY_NODE_KEY_HEX so a manifest built from trustedDirectoryNode() verifies.
   */
  directoryNodeKeyHex?: string;
  /**
   * DOD-MANIFEST-1: per-node step-5 signing seeds for a multi-node cluster — node i signs
   * as `spineNodeId(i)` with `directoryNodeKeysHex[i]`. Length must equal directoryCount.
   * This is the real per-node-identity path the SPINE-1 guard reserved; use
   * `spineNodeKeypair(i).privateKeyHex` so a manifest built from `spineDirectoryNode(i, …)`
   * verifies each node's step-6 identity. Distinct from the single `directoryNodeKeyHex`
   * (the count===1 J-AUTH path).
   */
  directoryNodeKeysHex?: string[];
  /**
   * J-UNILATERAL: shrink the directory's delivery_grace_seconds (default 600 = 10 min)
   * so a live unilateral-seal test does not have to wait out the real grace window. The
   * directory binary reads CELLO_DELIVERY_GRACE_SECONDS; e.g. 2 → A can seal unilaterally
   * ~2s after the counterparty goes silent.
   */
  deliveryGraceSeconds?: number;
  /**
   * DOD-AUTH-2: when set, the directory serves this consortium-manifest file to clients
   * that poll (manifest_poll_request → manifest_poll_response). The directory re-reads the
   * file on each request, so overwriting it mid-run (writeSignedManifestTo) rotates the
   * served version and a polling daemon adopts it. Unset → the directory ignores polls.
   */
  directoryConsortiumManifestPath?: string;
  /**
   * DOD-DKG-1: called once after every directory's bootstrap URL is known (health ports
   * pre-allocated) but BEFORE any directory spawns. A consortium directory reads its
   * manifest at STARTUP (and exits if the file is missing), and that manifest must carry
   * these URLs — so this hook lets the caller write the signed consortium manifest (to
   * directoryConsortiumManifestPath) before the directories boot. Receives the ordered
   * directoryUrls (== the eventual cluster.directoryUrls).
   */
  onDirectoryUrlsReady?: (directoryUrls: string[]) => void | Promise<void>;
  /**
   * DOD-LEG-2 negative test: when set (>0), the directory inflates every party's published
   * content_frontier_seq by this amount in the FROST-signed legibility — simulating a buggy/
   * malicious directory. The receiving client must re-derive and REJECT
   * (certificate_frontier_unverifiable). Off by default; production never sets it.
   */
  directoryInflateFrontierForTest?: number;
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
  // M8B (DOD-SPINE-1): N sovereign directory nodes (default 1 = exact M7 behavior).
  // Each node gets its OWN fresh-migrated database. count===1 keeps the single-node DB
  // named `cello_spine` (every M7 spine test asserts against it); count>1 → cello_spine_${i}.
  const count = opts.directoryCount ?? 1;
  // Guard the silent landmine (cello-fallback-finder DOD-SPINE-1 #1): the SINGLE scalar
  // directoryNodeKeyHex applied to EVERY node would give all N "sovereign" nodes ONE shared
  // node identity with no error — a falsely sovereign cluster. For count>1, use the per-node
  // array directoryNodeKeysHex (DOD-MANIFEST-1) instead. Refuse the ambiguous single-scalar case.
  if (count > 1 && opts.directoryNodeKeyHex && !opts.directoryNodeKeysHex) {
    throw new Error(
      "startSpineCluster: directoryCount>1 with the single directoryNodeKeyHex would give all N nodes " +
        "one shared node identity (silent sovereignty violation). Pass per-node directoryNodeKeysHex[] instead.",
    );
  }
  if (opts.directoryNodeKeyHex && opts.directoryNodeKeysHex) {
    throw new Error(
      "startSpineCluster: pass EITHER directoryNodeKeyHex (single-node J-AUTH) OR directoryNodeKeysHex[] " +
        "(per-node), not both — the array would silently win and the scalar be ignored.",
    );
  }
  if (opts.directoryNodeKeysHex) {
    if (opts.directoryNodeKeysHex.length !== count) {
      throw new Error(
        `startSpineCluster: directoryNodeKeysHex length (${opts.directoryNodeKeysHex.length}) must equal directoryCount (${count}).`,
      );
    }
    // Per-element validation (cello-fallback-finder DOD-MANIFEST-1 #3): an empty/garbage seed
    // at index i would boot node i with a missing/degraded step-5 identity and NO error — a
    // falsely-degraded "sovereign" node. Require a real 32-byte (64-hex) seed per node.
    const bad = opts.directoryNodeKeysHex.findIndex((k) => !/^[0-9a-fA-F]{64}$/.test(k));
    if (bad !== -1) {
      throw new Error(
        `startSpineCluster: directoryNodeKeysHex[${bad}] is not a 64-hex (32-byte) seed — node ${bad} would boot with no/degraded identity.`,
      );
    }
  }
  const dbNames = Array.from({ length: count }, (_, i) => (count === 1 ? SPINE_DB : `${SPINE_DB}_${i}`));
  const databaseUrls = dbNames.map(spineDbUrl);
  ensurePostgres(dbNames);
  const tmpDir = mkdtempSync(join(tmpdir(), "cello-jspine-"));

  // L7: if any step throws after a child is spawned, stop ALL already-running children
  // (every directory spawned so far + the relay) and remove tmpDir, so we never orphan a
  // node — an orphan holds ports/locks and corrupts the next run.
  let relay: Proc | undefined;
  const spawnedDirs: Proc[] = [];
  const abort = async (err: unknown): Promise<never> => {
    for (const d of spawnedDirs) await d.stop();
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
    // start the directories FIRST (they dial the relay lazily, at recordAssignment/seal time,
    // by which point the relay is up), read node 0's real multiaddr, and start the relay
    // second with CELLO_DIRECTORY_MULTIADDR set — so #maybeProcessSeal → directory processSeal works.
    const relaySeed = new Uint8Array(randomBytes(32));
    const relaySeedHex = Buffer.from(relaySeed).toString("hex");
    const relayPeerId = await peerIdFromTransportSeed(relaySeed);
    const relayPort = await freePort();
    const relayMultiaddr = `/ip4/127.0.0.1/tcp/${relayPort}/p2p/${relayPeerId}`;

    // ── Directories (start FIRST). Each is a sovereign node: own signing key + transport
    // key (→ distinct PeerID) + health port + listen port + DATABASE_URL. Each node's env
    // is captured so restartDirectory() can re-spawn an IDENTICAL node (same identity key,
    // same transport key → same peer id, same HEALTH_PORT → same bootstrap URL the daemon
    // polls). The libp2p listen port is tcp/0 (new on restart), but the daemon re-resolves
    // the multiaddr via /bootstrap on each reconnect, so a fresh port is fine. ──
    const dirEnvs: Array<Record<string, string>> = [];
    const directoryUrls: string[] = [];
    // node 0 drives the relay's directory-admin auth (CELLO_DIRECTORY_PUBKEY) + the relay's
    // seal callback (SPINE-7). Per-node node-identity keys + the relay accepting any node
    // arrive with DOD-MANIFEST-1 / Option B.
    let dir0Pubkey = "";
    // FED-OPTIONB-SETUP-001 (any-directory): every sovereign node's pubkey. The relay accepts a
    // CLIENT-presented assignment signed by ANY of these, so a non-node-0 directory's assignment
    // verifies (the any-directory teeth). Passed as CELLO_DIRECTORY_PUBKEYS.
    const allDirPubkeys: string[] = [];
    // Pre-allocate every directory's health port BEFORE spawning, so the bootstrap URLs are
    // known up front (DOD-DKG-1): a consortium directory reads its manifest at STARTUP and
    // that manifest must carry these URLs, so onDirectoryUrlsReady writes it before any spawn.
    const healthPorts: number[] = [];
    for (let i = 0; i < count; i++) healthPorts.push(await freePort());
    for (let i = 0; i < count; i++) directoryUrls.push(`http://127.0.0.1:${healthPorts[i]}`);
    if (opts.onDirectoryUrlsReady) await opts.onDirectoryUrlsReady([...directoryUrls]);
    for (let i = 0; i < count; i++) {
      // Provision THIS node's signing key in the binary's own format, read its pubkey.
      const dirKeyFile = join(tmpDir, `directory-key-${i}`);
      const dirKp = await FileKeyProvider.load(dirKeyFile);
      const dirPubkeyHex = Buffer.from(await dirKp.getPublicKey()).toString("hex");
      if (i === 0) dir0Pubkey = dirPubkeyHex;
      allDirPubkeys.push(dirPubkeyHex);
      const healthPort = healthPorts[i]!;
      // Per-node at-rest envelope key + audit sink (cello-fallback-finder DOD-SPINE-1 #2/#3):
      // sovereign nodes each encrypt their OWN K_server share with their OWN envelope key and
      // write their OWN audit log (so a later test can attribute "node i did X"). Captured in
      // directoryEnv ⇒ restartDirectory() re-spawns node 0 with the SAME key (it must decrypt
      // the share it already persisted) + same audit file. For count===1 this is one key + one
      // audit file, behaviourally identical to before (no test references either path).
      const nodeEnvelopeKey = randomBytes(32).toString("hex");
      const nodeAuditLog = join(tmpDir, `audit-${i}.jsonl`);
      writeFileSync(nodeAuditLog, "");
      const directoryEnv: Record<string, string> = {
        CELLO_ENV: "local",
        DATABASE_URL: databaseUrls[i],
        DEV_ENVELOPE_KEY: nodeEnvelopeKey,
        AUDIT_LOG_PATH: nodeAuditLog,
        CELLO_RELAY_MULTIADDR: relayMultiaddr,
        CELLO_DIRECTORY_KEY_FILE: dirKeyFile,
        CELLO_DIRECTORY_TRANSPORT_KEY_FILE: join(tmpDir, `directory-transport-key-${i}`),
        CELLO_DIRECTORY_LISTEN_ADDR: "/ip4/127.0.0.1/tcp/0",
        CELLO_DIRECTORY_WS_LISTEN_ADDR: "/ip4/127.0.0.1/tcp/0/ws",
        HEALTH_PORT: String(healthPort),
        // Step-5 signing identity. count===1 (J-AUTH): the single directoryNodeKeyHex signs
        // as nodeId "local". count>1 (DOD-MANIFEST-1): node i signs as spineNodeId(i) with its
        // OWN seed directoryNodeKeysHex[i], so a 3-node manifest verifies each node at step-6.
        ...(opts.directoryNodeKeysHex
          ? { CELLO_DIRECTORY_NODE_KEY_HEX: opts.directoryNodeKeysHex[i], NODE_ID: spineNodeId(i) }
          : opts.directoryNodeKeyHex
            ? { CELLO_DIRECTORY_NODE_KEY_HEX: opts.directoryNodeKeyHex, NODE_ID: AUTH_DIRECTORY_NODE_ID }
            : {}),
        // J-UNILATERAL: shrink the grace window so the unilateral-seal test can seal
        // shortly after the counterparty goes silent (default is 600s).
        ...(opts.deliveryGraceSeconds != null
          ? { CELLO_DELIVERY_GRACE_SECONDS: String(opts.deliveryGraceSeconds) }
          : {}),
        // DOD-AUTH-2: serve a consortium manifest to polling clients (rotatable on disk).
        ...(opts.directoryConsortiumManifestPath
          ? { CELLO_DIRECTORY_CONSORTIUM_MANIFEST: opts.directoryConsortiumManifestPath }
          : {}),
        // DOD-LEG-2 negative test: make the directory publish an inflated (still-signed) frontier.
        ...(opts.directoryInflateFrontierForTest
          ? { CELLO_DIRECTORY_INFLATE_FRONTIER_FOR_TEST: String(opts.directoryInflateFrontierForTest) }
          : {}),
      };
      const name = count === 1 ? "directory" : `directory-${i}`;
      const proc = new Proc(name, BINS.directory, directoryEnv);
      // Track BEFORE the await: `new Proc` already spawned the OS child (its ctor), so if
      // waitForLine REJECTS while the child is still alive (e.g. a 30s startup-hang
      // timeout), abort() must be able to stop it. Pushing only after the await would
      // leave that child orphaned holding its ports/DB lock. Proc.stop() no-ops on an
      // already-exited child, so this is also safe for the exit-before-line case.
      spawnedDirs.push(proc);
      // BootstrapEndpoint line means /bootstrap is live — the daemon can discover us.
      await proc.waitForLine(/"adapterName":"BootstrapEndpoint"/, 30_000);
      dirEnvs.push(directoryEnv);
      // directoryUrls were pre-built above (before spawn) so onDirectoryUrlsReady could write
      // the consortium manifest — don't re-push here.
    }

    const directoryMultiaddr = listenMultiaddr(spawnedDirs[0], { ws: false });

    // ── Relay (starts SECOND; bound to the fixed port + pre-derived seed so its real
    // multiaddr equals relayMultiaddr. Given CELLO_DIRECTORY_MULTIADDR (node 0) it wires the
    // NetworkDirectoryAdapter + registers with the now-running directory). ──
    relay = new Proc("relay", BINS.relay, {
      NODE_ENV: "test",
      CELLO_ENV: "local",
      CELLO_DIRECTORY_PUBKEY: dir0Pubkey,
      // FED-OPTIONB-SETUP-001: the full consortium pubkey set so the relay accepts a client-presented
      // assignment signed by any sovereign directory (any-directory). dir0Pubkey is included for the
      // directory-ADMIN frame path (back-compat); the set adds nodes 1..N for the Option-B client path.
      CELLO_DIRECTORY_PUBKEYS: allDirPubkeys.join(","),
      CELLO_DIRECTORY_MULTIADDR: directoryMultiaddr,
      CELLO_RELAY_KEY_FILE: join(tmpDir, "relay-key"),
      CELLO_RELAY_TRANSPORT_KEY_HEX: relaySeedHex,
      CELLO_RELAY_LISTEN_ADDR: `/ip4/127.0.0.1/tcp/${relayPort}`,
      CELLO_RELAY_HEALTH_PORT: String(await freePort()),
    });
    await relay.waitForLine(/"adapterName":"ListenAddr"/, 20_000);

    const relayRef = relay;
    // The directory set is replaceable (J-SIG recovery): liveDirs always points at the live
    // procs, so stop(), the `directory` getter, and `directories` follow a node-0 restart.
    const liveDirs = [...spawnedDirs];

    // J-SIG recovery: re-spawn an identical node 0 on the same bootstrap URL after a kill,
    // so the daemon's resolver re-discovers it and reconnects. Returns the new proc.
    const restartDirectory = async (): Promise<Proc> => {
      const next = new Proc(count === 1 ? "directory" : "directory-0", BINS.directory, dirEnvs[0]);
      await next.waitForLine(/"adapterName":"BootstrapEndpoint"/, 30_000);
      liveDirs[0] = next;
      return next;
    };

    const stop = async (): Promise<void> => {
      for (const d of liveDirs) await d.stop();
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
      get directory(): Proc {
        return liveDirs[0];
      },
      get directories(): Proc[] {
        return [...liveDirs];
      },
      restartDirectory,
      relayMultiaddr,
      directoryUrl: directoryUrls[0],
      directoryUrls,
      databaseUrls,
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
  opts: { manifestEnv?: ManifestEnv; waitForStarted?: boolean; extraEnv?: Record<string, string> } = {},
): Promise<Proc> {
  const daemon = new Proc(`daemon-${label}`, BINS.daemon, {
    CELLO_DIR: celloDir,
    CELLO_DIRECTORY_URL: directoryUrl,
    // J-AUTH: when a manifest env is supplied, the daemon loads + verifies it and
    // turns on step-6 directory-identity verification (challengeVerifier).
    ...(opts.manifestEnv ?? {}),
    // J-UNILATERAL: shrink the bilateral-seal wait before a close escalates to unilateral.
    ...(opts.extraEnv ?? {}),
  });
  // The expiry case wants to observe the daemon REFUSING to start (loadAndVerify
  // throws manifest_expired); callers pass waitForStarted:false and assert the exit.
  if (opts.waitForStarted !== false) {
    await daemon.waitForLine(/"event":"daemon\.started"/, 15_000);
  }
  return daemon;
}

// ─── Raw IPC client: call a daemon IPC handler directly over its Unix socket ────
// The daemon's IPC is newline-delimited JSON: request {id, method, params} → response
// {id, result} | {id, error} (ipc-server.ts). cello-mcp only forwards the cello_* tool
// subset; the DAEMON-003 handlers (queue_failed_send / check_nonce / drain_session) that
// drive the durable retry queue + nonce-dedup store are reachable ONLY over raw IPC.
// They take no current-agent precondition, so a one-shot socket call suffices. This is
// still binary-anchored — it talks to the real running daemon over its real socket.
export function ipcCall(
  celloDir: string,
  method: string,
  params: Record<string, unknown>,
  timeoutMs = 5_000,
): Promise<Record<string, unknown>> {
  const socketPath = join(celloDir, "daemon.sock");
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    const id = `harness-${method}-${randomBytes(4).toString("hex")}`;
    let buffer = "";
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`ipcCall ${method} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    socket.on("connect", () => {
      socket.write(JSON.stringify({ id, method, params }) + "\n");
    });
    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (!line.trim()) continue;
        let resp: { id?: string; result?: Record<string, unknown>; error?: unknown };
        try {
          resp = JSON.parse(line) as typeof resp;
        } catch {
          continue;
        }
        if (resp.id !== id) continue;
        clearTimeout(timer);
        socket.end();
        if (resp.error) reject(new Error(`ipcCall ${method} error: ${JSON.stringify(resp.error)}`));
        else resolve(resp.result ?? {});
        return;
      }
    });
    socket.on("error", (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });
  });
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
