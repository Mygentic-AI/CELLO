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
import { startSpineCluster, cello, type SpineCluster } from "./live-harness.js";

let cluster: SpineCluster;
const agentHomes: Array<Record<string, string>> = [];

beforeAll(async () => {
  cluster = await startSpineCluster();
}, 180_000);

afterAll(async () => {
  // Stop every daemon we logged in, then tear down the cluster — no orphan daemons
  // (an orphan holds the SQLite lock + socket and drains battery).
  for (const env of agentHomes) {
    try {
      cello(["logout"], env);
    } catch {
      /* best-effort */
    }
  }
  await cluster?.stop();
});

/** A fresh CELLO_DIR (own daemon socket + DB) pointed at the live directory. */
function agentEnv(label: string): Record<string, string> {
  const env = {
    CELLO_DIR: mkdtempSync(join(tmpdir(), `cello-${label}-`)),
    CELLO_DIRECTORY_URL: cluster.directoryUrl,
  };
  agentHomes.push(env);
  return env;
}

describe("J-SPINE — live binary spine (DOD-SPINE-1..7 against the real binaries)", () => {
  it("DOD-SPINE-1 — daemon up: `cello login` starts the daemon; `cello status` reports directory_signaling connected", async () => {
    const env = agentEnv("agentA");

    const login = cello(["login"], env);
    expect(login.status, `cello login failed:\n${login.stdout}`).toBe(0);

    // SPINE-1 budget: directory_signaling must reach "connected" within 5s.
    let signaling = "unknown";
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const res = cello(["status"], env);
      try {
        const parsed = JSON.parse(res.stdout.trim()) as { directory_signaling?: string };
        signaling = parsed.directory_signaling ?? "unknown";
        if (signaling === "connected") break;
      } catch {
        /* status not JSON yet — keep polling */
      }
    }
    expect(signaling, "directory_signaling should be 'connected' within 5s of login").toBe("connected");
  }, 30_000);
});
