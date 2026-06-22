/**
 * J-AUTH — live binary directory bidirectional auth (M7-DEFINITION-OF-DONE.md
 * §"verification harness", journey 2; DOD-AUTH-1 / DOD-AUTH-2).
 *
 * Drives the REAL binaries with the consortium-manifest hardening turned ON: the
 * directory signs its step-5 challenge with a per-node Ed25519 key (MANIFEST-002),
 * and a manifest-configured daemon verifies that identity proof at step-6 against the
 * threshold-signed consortium manifest (MANIFEST-001). This is the OPT-IN path the
 * cello-daemon / directory binaries layer on top of the M6 backward-compat handshake.
 *
 *   DOD-AUTH-1 (happy) — directory in the manifest → step-6 verifies → agent connects.
 *   DOD-AUTH-1 (rogue) — directory NOT in the manifest → step-6 fails
 *                        (key_not_in_manifest) → the agent never reaches the directory.
 *   DOD-AUTH-2 (expired) — an expired manifest is refused at load → daemon refuses to
 *                          operate (no silent downgrade to the unverified path).
 *
 * Anchored to the binary — see live-harness.ts. The directory signs with the harness's
 * deterministic node key; the daemon trusts the harness's officer root keys. The
 * harness is the single source of truth for both, so it is internally consistent
 * regardless of the published @cello-protocol/crypto version.
 *
 * Run: pnpm --filter @cello-protocol/e2e-tests test:spine
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  startSpineCluster,
  startDaemon,
  provisionAgent,
  cello,
  writeConsortiumManifest,
  writeSignedManifestTo,
  trustedDirectoryNode,
  AUTH_DIRECTORY_NODE_KEY_HEX,
  AUTH_DIRECTORY_NODE_PUBKEY,
  type SpineCluster,
  type Proc,
} from "./live-harness.js";

let cluster: SpineCluster;
const daemons: Proc[] = [];
const dirs: string[] = [];

// DOD-AUTH-2 (poll): the consortium manifest the DIRECTORY serves to polling clients.
// Lives in its own holder dir (outside the cluster tmp) so the poll-refresh test can
// overwrite it mid-run to a higher version. Seeded at v1 before the cluster starts.
let dirManifestPath: string;

beforeAll(async () => {
  const manifestHolder = mkdtempSync(join(tmpdir(), "cello-dirmanifest-"));
  dirs.push(manifestHolder);
  dirManifestPath = join(manifestHolder, "directory-consortium-manifest.json");
  writeSignedManifestTo(dirManifestPath, [trustedDirectoryNode()], { version: 1 });

  // Step-5 signing ON: the directory signs its challenge as nodeId "local". It also
  // serves the consortium manifest above to clients that poll (DOD-AUTH-2).
  cluster = await startSpineCluster({
    directoryNodeKeyHex: AUTH_DIRECTORY_NODE_KEY_HEX,
    directoryConsortiumManifestPath: dirManifestPath,
  });
}, 180_000);

afterAll(async () => {
  for (const d of daemons) await d.stop();
  await cluster?.stop();
  for (const dir of dirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

/** A fresh CELLO_DIR with a provisioned agent; the daemon gets `manifestEnv` so step-6 is ON. */
async function startAuthAgent(
  label: string,
  manifestNodes: ReturnType<typeof trustedDirectoryNode>[],
  opts: {
    manifestOpts?: Parameters<typeof writeConsortiumManifest>[3];
    waitForStarted?: boolean;
    extraEnv?: Record<string, string>;
  } = {},
): Promise<{ celloDir: string; daemon: Proc; pubkeyHex: string }> {
  const celloDir = mkdtempSync(join(tmpdir(), `cello-${label}-`));
  dirs.push(celloDir);
  const pubkeyHex = await provisionAgent(celloDir, label);
  const manifestEnv = writeConsortiumManifest(celloDir, label, manifestNodes, opts.manifestOpts);
  const daemon = await startDaemon(celloDir, cluster.directoryUrl, label, {
    manifestEnv,
    waitForStarted: opts.waitForStarted,
    extraEnv: opts.extraEnv,
  });
  daemons.push(daemon);
  return { celloDir, daemon, pubkeyHex };
}

describe("J-AUTH — directory bidirectional auth, live (DOD-AUTH-1 / DOD-AUTH-2)", () => {
  it("DOD-AUTH-1 (happy) — directory in the manifest → daemon verifies step-6 → agent connects", async () => {
    const { celloDir, daemon } = await startAuthAgent("auth-happy", [trustedDirectoryNode()]);
    const env = { CELLO_DIR: celloDir };

    // The daemon must have loaded + verified the manifest at startup.
    expect(daemon.output, "daemon.manifest.configured must log").toMatch(/"event":"daemon\.manifest\.configured"/);

    // `cello login` connects to the daemon, which dials the directory and runs the
    // 7-step handshake. With step-6 ON, the daemon verifies the directory's signed
    // challenge against the manifest before announcing itself.
    const login = cello(["login"], env);
    expect(login.status, `cello login failed:\n${login.stdout}`).toBe(0);

    // The load-bearing assertion: step-6 actually ran and PASSED against the manifest.
    const verified = await daemon.waitForLine(/"event":"directory\.auth\.challenge\.verified"/, 15_000);
    expect(verified).toMatch(/"directoryNodeId":"local"/);

    // And the connection was announced as verified (not the M6 unverified path).
    expect(daemon.output).toMatch(/"event":"directory\.signaling\.connected"[^\n]*"verified":true/);

    // No failure on the happy path.
    expect(daemon.output).not.toMatch(/"event":"directory\.auth\.challenge\.failed"/);
  }, 60_000);

  it("DOD-AUTH-1 (rogue) — directory NOT in the manifest → step-6 fails (key_not_in_manifest), never connects", async () => {
    // A validly-signed manifest that simply does NOT list this directory's nodeId
    // ("local"). loadAndVerify succeeds (officer sigs valid) so the daemon starts, but
    // when the directory presents its step-5 proof as "local", the verifier finds no
    // matching node → key_not_in_manifest → the handshake is refused. This is a rogue/
    // unlisted node being rejected — the security property. (Multi-node FAILOVER needs
    // >1 directory, which this single-directory harness does not model; the invariant
    // under test is REJECTION.)
    const rogueNode = {
      nodeId: "rogue-unlisted-region",
      pubkey: AUTH_DIRECTORY_NODE_PUBKEY,
      region: "eu-west-9",
      provider: "gcp" as const,
      endpoint: "/ip4/127.0.0.1/tcp/0",
    };
    const { celloDir, daemon } = await startAuthAgent("auth-rogue", [rogueNode]);
    const env = { CELLO_DIR: celloDir };

    // The manifest itself is valid (signed) so the daemon loads it and starts.
    expect(daemon.output).toMatch(/"event":"directory\.auth\.manifest\.verified"/);

    // login triggers the directory dial; step-6 must reject the unlisted node.
    cello(["login"], env);
    const failed = await daemon.waitForLine(
      /"event":"directory\.auth\.challenge\.failed"[^\n]*"reason":"key_not_in_manifest"/,
      15_000,
    );
    expect(failed).toMatch(/key_not_in_manifest/);

    // The rejected node is never announced as a verified, connected directory.
    expect(daemon.output).not.toMatch(/"event":"directory\.auth\.challenge\.verified"/);
  }, 60_000);

  it("DOD-AUTH-2 (expired) — expired manifest is refused → daemon will not operate (no silent downgrade)", async () => {
    // An otherwise-valid manifest whose `expires` is in the past. loadAndVerify passes
    // (officer sigs valid — expiry is the daemon's policy layer, not the provider's), the
    // daemon detects the expired window and refuses to start with a manifest configured
    // (ADV-002): it does NOT silently fall back to the unverified M6 path.
    const { daemon } = await startAuthAgent(
      "auth-expired",
      [trustedDirectoryNode()],
      { manifestOpts: { notBefore: "2020-01-01T00:00:00Z", expires: "2020-06-01T00:00:00Z" }, waitForStarted: false },
    );

    // The specific named event (DOD-INV-6: distinct cause → distinct event).
    const expired = await daemon.waitForLine(/"event":"directory\.auth\.manifest\.expired"/, 15_000);
    expect(expired).toMatch(/"expiresAt":"2020-06-01T00:00:00Z"/);

    // Refusal to operate: the daemon never announces a verified manifest and never
    // reaches a connected, step-6-verified directory.
    expect(daemon.output).not.toMatch(/"event":"directory\.auth\.manifest\.verified"/);
    expect(daemon.output).not.toMatch(/"event":"directory\.auth\.challenge\.verified"/);
  }, 60_000);

  it("DOD-AUTH-2 (rollback) — a lower manifest version is rejected across restarts (anti-rollback)", async () => {
    // Anti-rollback (TUF): the daemon persists the last-verified manifest version under
    // its CELLO_DIR (FileManifestVersionStore). A later manifest whose version REGRESSED
    // must be refused even though its officer signatures are valid — otherwise a revoked
    // consortium snapshot could be replayed. One CELLO_DIR, two daemon starts.
    const celloDir = mkdtempSync(join(tmpdir(), "cello-auth-rollback-"));
    dirs.push(celloDir);
    await provisionAgent(celloDir, "auth-rollback");

    // Start 1 — manifest version 2. loadAndVerify succeeds → persist trusted=2 at startup.
    const envV2 = writeConsortiumManifest(celloDir, "v2", [trustedDirectoryNode()], { version: 2 });
    const d2 = await startDaemon(celloDir, cluster.directoryUrl, "rollback-v2", { manifestEnv: envV2 });
    daemons.push(d2);
    expect(d2.output).toMatch(/"event":"directory\.auth\.manifest\.verified"[^\n]*"manifestVersion":2/);
    await d2.stop(); // release the lock + version file persisted to disk

    // Start 2 — same CELLO_DIR, manifest version 1 (a rollback). The officer signatures
    // are valid, but version 1 < trusted 2 → refused, daemon will not operate.
    const envV1 = writeConsortiumManifest(celloDir, "v1", [trustedDirectoryNode()], { version: 1 });
    const d1 = await startDaemon(celloDir, cluster.directoryUrl, "rollback-v1", {
      manifestEnv: envV1,
      waitForStarted: false,
    });
    daemons.push(d1);

    const rollback = await d1.waitForLine(/"event":"directory\.auth\.manifest\.version\.rollback"/, 15_000);
    expect(rollback).toMatch(/"manifestVersion":1/);
    expect(rollback).toMatch(/"lastSeenVersion":2/);
    // The rolled-back manifest is never accepted as verified.
    expect(d1.output).not.toMatch(/"event":"directory\.auth\.manifest\.verified"/);
  }, 90_000);

  it("DOD-AUTH-2 (poll refresh) — daemon polls the directory on an interval and adopts a newer manifest version", async () => {
    // The background manifest poll (6–12h in production) is exercised with a sub-second
    // interval. The daemon trusts manifest v1 at startup (persists trusted=1). The DIRECTORY
    // serves the consortium manifest from dirManifestPath (seeded v1 in beforeAll). Once the
    // daemon is connected and polling, we ROTATE the directory's served file to v2 (valid
    // officer sigs, same node set so step-6 still verifies). On its next poll the daemon
    // fetches v2 from the directory, re-verifies it independently, adopts it, and persists
    // trusted=2 — recovery-not-trust: the directory is only the transport for the manifest.
    const { celloDir, daemon } = await startAuthAgent("auth-poll", [trustedDirectoryNode()], {
      manifestOpts: { version: 1 },
      extraEnv: { CELLO_MANIFEST_POLL_MIN_MS: "400", CELLO_MANIFEST_POLL_MAX_MS: "800" },
    });
    const env = { CELLO_DIR: celloDir };

    // The daemon loaded + verified its own startup manifest (v1) and persisted trusted=1.
    expect(daemon.output).toMatch(/"event":"directory\.auth\.manifest\.verified"[^\n]*"manifestVersion":1/);

    // login → the keystone connects → step-6 verifies → background polling starts.
    const login = cello(["login"], env);
    expect(login.status, `cello login failed:\n${login.stdout}`).toBe(0);
    await daemon.waitForLine(/"event":"directory\.auth\.challenge\.verified"/, 15_000);

    // Polling is live: the daemon dispatches manifest_poll_request frames on its stream.
    await daemon.waitForLine(/"event":"directory\.auth\.manifest\.poll\.dispatched"/, 15_000);

    // Rotate the directory's served manifest to v2 (a real consortium roll-forward).
    writeSignedManifestTo(dirManifestPath, [trustedDirectoryNode()], { version: 2 });

    // The next poll fetches v2 from the directory and ADOPTS it (v2 > trusted v1).
    const success = await daemon.waitForLine(
      /"event":"directory\.auth\.manifest\.poll\.success"[^\n]*"newVersion":2/,
      20_000,
    );
    expect(success).toMatch(/"oldVersion":1/);

    // Anti-rollback persistence advanced: the daemon's version store now trusts v2.
    const persisted = JSON.parse(readFileSync(join(celloDir, "manifest-version.json"), "utf8"));
    expect(persisted.lastSeenVersion).toBe(2);

    // The directory observed serving the poll (producer side, its own log).
    expect(cluster.directory.output).toMatch(/"event":"directory\.manifest\.poll\.response"/);
  }, 60_000);
});
