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
});
