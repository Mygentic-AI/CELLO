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
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  startSpineCluster,
  startDaemon,
  provisionAgent,
  cello,
  writeConsortiumManifest,
  trustedDirectoryNode,
  AUTH_DIRECTORY_NODE_KEY_HEX,
  AUTH_DIRECTORY_NODE_PUBKEY,
  type SpineCluster,
  type Proc,
} from "./live-harness.js";

let cluster: SpineCluster;
const daemons: Proc[] = [];
const dirs: string[] = [];

beforeAll(async () => {
  // Step-5 signing ON: the directory signs its challenge as nodeId "local".
  cluster = await startSpineCluster({ directoryNodeKeyHex: AUTH_DIRECTORY_NODE_KEY_HEX });
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
  opts: { manifestOpts?: Parameters<typeof writeConsortiumManifest>[3]; waitForStarted?: boolean } = {},
): Promise<{ celloDir: string; daemon: Proc; pubkeyHex: string }> {
  const celloDir = mkdtempSync(join(tmpdir(), `cello-${label}-`));
  dirs.push(celloDir);
  const pubkeyHex = await provisionAgent(celloDir, label);
  const manifestEnv = writeConsortiumManifest(celloDir, label, manifestNodes, opts.manifestOpts);
  const daemon = await startDaemon(celloDir, cluster.directoryUrl, label, {
    manifestEnv,
    waitForStarted: opts.waitForStarted,
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
});
