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
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startSpineCluster, startDaemon, provisionAgent, cello, type Proc, type SpineCluster } from "./live-harness.js";

let cluster: SpineCluster;
const daemons: Proc[] = [];

beforeAll(async () => {
  cluster = await startSpineCluster();
}, 180_000);

afterAll(async () => {
  // The harness owns each daemon — stop them, then the cluster. No orphans.
  for (const d of daemons) await d.stop();
  await cluster?.stop();
});

/** A fresh CELLO_DIR with a provisioned agent identity and its own harness-owned daemon. */
async function startAgent(label: string, agentName: string): Promise<{ celloDir: string; daemon: Proc }> {
  const celloDir = mkdtempSync(join(tmpdir(), `cello-${label}-`));
  // Provision the agent identity BEFORE the daemon starts — the daemon loads it at boot.
  await provisionAgent(celloDir, agentName);
  const daemon = await startDaemon(celloDir, cluster.directoryUrl, label);
  daemons.push(daemon);
  return { celloDir, daemon };
}

describe("J-SPINE — live binary spine (DOD-SPINE-1..7 against the real binaries)", () => {
  it("DOD-SPINE-1 — daemon up: daemon started, `cello login` connects, `cello status` reports directory_signaling connected", async () => {
    const { celloDir, daemon } = await startAgent("agentA", "agentA");
    const env = { CELLO_DIR: celloDir };

    // `cello login` connects to the running daemon (the DoD "connects to" branch).
    const login = cello(["login"], env);
    expect(login.status, `cello login failed:\n${login.stdout}`).toBe(0);

    // directory_signaling is gated on a registered agent identity (daemon.ts:411-412),
    // so SPINE-1's "directory_signaling: connected, ≥1 agent" requires a registration
    // (real DKG — also the SPINE-4 step). DevTokenValidator accepts any DEV- token.
    const reg = cello(["register", "agentA"], { ...env, CELLO_PREAUTH_TOKEN: "DEV-spine-agentA" });
    expect(
      reg.status,
      `cello register failed:\n${reg.stdout}\n--- daemon log ---\n${daemon.output}\n` +
        `--- directory log (last 40) ---\n${cluster.directory.output.split("\n").slice(-40).join("\n")}`,
    ).toBe(0);

    // Now directory_signaling should reach "connected" and ≥1 agent appear.
    let signaling = "unknown";
    let agentCount = 0;
    let lastRaw = "";
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const res = cello(["status"], env);
      lastRaw = res.stdout;
      try {
        const parsed = JSON.parse(res.stdout.trim()) as { directory_signaling?: string; agents?: unknown[] };
        signaling = parsed.directory_signaling ?? "unknown";
        agentCount = parsed.agents?.length ?? 0;
        if (signaling === "connected" && agentCount >= 1) break;
      } catch {
        /* status not JSON yet — keep polling */
      }
    }
    expect(
      signaling,
      `directory_signaling should be 'connected' after registration.\n` +
        `--- raw cello status ---\n${lastRaw}\n` +
        `--- FULL daemon log ---\n${daemon.output}\n` +
        `--- directory log (last 50) ---\n${cluster.directory.output.split("\n").slice(-50).join("\n")}`,
    ).toBe("connected");
    expect(agentCount, "status should list ≥1 agent after registration").toBeGreaterThanOrEqual(1);
  }, 30_000);
});
