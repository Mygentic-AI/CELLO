/**
 * J-ONBOARD — CELLO-M7-ONBOARD-001 (keystone runtime election), live binaries.
 *
 * A brand-new operator's flow: `cello login` on an EMPTY CELLO_DIR (no agents), then
 * `cello create-agent` — the very FIRST agent — must make the daemon's keystone (directory-facing
 * signaling) authenticate and CONNECT, with NO `logout && login` restart. Before the fix the daemon
 * captured its directory-auth identity once at startup (empty → undefined), so `directory_signaling`
 * stayed `reconnecting` forever after a runtime create-agent. This proves the election happens live.
 *
 * Anchored to the binary — real cello-directory + cello-relay + cello-daemon (driven via the `cello` CLI).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  startSpineCluster,
  startDaemon,
  cello,
  type SpineCluster,
  type Proc,
} from "./live-harness.js";

let cluster: SpineCluster;
const daemons: Proc[] = [];
const dirs: string[] = [];

beforeAll(async () => {
  cluster = await startSpineCluster({});
}, 180_000);

afterAll(async () => {
  for (const d of daemons) await d.stop();
  await cluster?.stop();
  for (const dir of dirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

type Status = { daemon?: string; directory_signaling?: string; agents?: Array<{ name: string }> };

function status(dir: string): Status {
  const r = cello(["status"], { CELLO_DIR: dir });
  return JSON.parse(r.stdout) as Status;
}

describe("J-ONBOARD — keystone elects the first runtime-created agent (CELLO-M7-ONBOARD-001)", () => {
  it("fresh daemon (no agents) → cello create-agent → directory_signaling connects, NO restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cello-onboard-"));
    dirs.push(dir);
    // NO provisionAgent — a genuinely fresh install (empty agents table).
    const daemon = await startDaemon(dir, cluster.directoryUrl, "onboard");
    daemons.push(daemon);

    // Before: no agents → the keystone has no identity → reconnecting (correct).
    const before = status(dir);
    expect(before.agents, `expected zero agents on a fresh install: ${JSON.stringify(before)}`).toEqual([]);
    expect(before.directory_signaling).toBe("reconnecting");

    // Create the FIRST agent at runtime (the real operator command).
    const created = cello(["create-agent", "alice"], { CELLO_DIR: dir });
    expect(created.status, `create-agent failed: ${created.stdout}`).toBe(0);

    // The keystone must elect alice and the running reconnect loop must CONNECT — with no restart.
    // Poll up to ~25s (the reconnect backoff is small this early in the daemon's life).
    let finalStatus = "reconnecting";
    for (let i = 0; i < 50; i++) {
      finalStatus = status(dir).directory_signaling ?? "unknown";
      if (finalStatus === "connected") break;
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(
      finalStatus,
      "directory_signaling must reach 'connected' after the first cello create-agent — NO logout/login restart",
    ).toBe("connected");

    // And the agent is present (the election didn't disturb the loaded set).
    expect((status(dir).agents ?? []).map((a) => a.name)).toContain("alice");
  }, 90_000);
});
