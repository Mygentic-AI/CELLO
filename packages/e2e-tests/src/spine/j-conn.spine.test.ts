/**
 * J-CONN — CELLO-M7-CONN-001 (DOD-CONN-1 / SI-001), live binaries. Full per-agent directory
 * connections; the keystone is deleted.
 *
 * THE DEMO1 REPRO. Before CONN-001 the daemon held ONE shared "keystone" directory connection that
 * borrowed the lexicographically-first ("primary") agent's identity. Removing that agent cleared the
 * primary but never tore down + re-established the connection, so it lingered authenticated as the
 * removed agent — and the NEXT registration's real DKG timed out (the bug that blocked registering
 * Demo1 after removing Ms_Chelly). This journey proves the fix against the real binaries: removing the
 * former-primary agent disturbs only its own connection; the daemon's directory presence survives, and
 * a fresh agent registers without stranding.
 *
 * Anchored to the binary — real cello-directory + cello-relay + cello-daemon, driven via the `cello`
 * CLI. The "register succeeds" assertion is non-fakeable: register runs a real FROST DKG over the
 * agent's OWN authenticated signaling stream; if the daemon were stranded it would time out.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  startSpineCluster,
  startDaemon,
  cello,
  registerAgent,
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

type Status = { directory_signaling?: string; agents?: Array<{ name: string }> };
function status(dir: string): Status {
  return JSON.parse(cello(["status"], { CELLO_DIR: dir }).stdout) as Status;
}

const devToken = (tag: string): string => `DEV-conn-${tag}-${randomBytes(6).toString("hex")}`;

describe("J-CONN — per-agent directory connections, no keystone (CELLO-M7-CONN-001)", () => {
  it("DOD-CONN-1 / SI-001: removing the former-primary agent does NOT strand the daemon — a fresh registration still succeeds (the Demo1 repro)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cello-conn-"));
    dirs.push(dir);
    const daemon = await startDaemon(dir, cluster.directoryUrl, "conn");
    daemons.push(daemon);

    const waitConnected = async (label: string): Promise<boolean> => {
      for (let i = 0; i < 60; i++) {
        if ((status(dir).directory_signaling ?? "") === "connected") return true;
        await new Promise((r) => setTimeout(r, 500));
      }
      throw new Error(`directory_signaling never reached "connected" (${label})`);
    };

    // ── alpha: the lexicographically-FIRST agent — the one the OLD keystone borrowed its identity
    //    from, whose removal stranded the daemon. Create brings up ITS OWN connection (no keystone
    //    election), then register runs a real DKG over alpha's own stream. ──
    expect(cello(["create-agent", "alpha"], { CELLO_DIR: dir }).status, "create alpha").toBe(0);
    await waitConnected("after create alpha");
    expect(registerAgent("alpha", devToken("a"), { CELLO_DIR: dir }).status, "register alpha").toBe(0);

    // ── beta: a SECOND agent with its OWN dedicated connection + DKG (proves multi-agent per-agent). ──
    expect(cello(["create-agent", "beta"], { CELLO_DIR: dir }).status, "create beta").toBe(0);
    expect(registerAgent("beta", devToken("b"), { CELLO_DIR: dir }).status, "register beta").toBe(0);

    // ── Remove alpha (the former keystone primary). Pre-CONN-001 this lingered authenticated as the
    //    removed agent and stranded the daemon. ──
    expect(cello(["remove-agent", "alpha"], { CELLO_DIR: dir }).status, "remove alpha").toBe(0);

    // SI-001 / DOD-CONN-1: the daemon's directory presence is NOT stranded — only alpha's own
    // connection was torn down; beta's stays up, so status stays connected. (The keystone, borrowing
    // alpha's identity, would be dead here — the masking that produced the Demo1 timeout.)
    expect(status(dir).directory_signaling, "directory_signaling must stay connected after removing the former primary").toBe("connected");
    const namesAfterRemove = (status(dir).agents ?? []).map((a) => a.name);
    expect(namesAfterRemove, "alpha is gone from the active agent list").not.toContain("alpha");
    expect(namesAfterRemove, "beta remains").toContain("beta");

    // ── THE DEMO1 REPRO: a FRESH agent registers AFTER the former-primary removal. If the daemon's
    //    directory connection were stranded (the bug), this real DKG would TIME OUT. It must succeed. ──
    expect(cello(["create-agent", "demo1"], { CELLO_DIR: dir }).status, "create demo1").toBe(0);
    await waitConnected("after create demo1");
    const regDemo = registerAgent("demo1", devToken("d"), { CELLO_DIR: dir });
    expect(regDemo.status, `Demo1 registration must NOT strand after removing the former primary: ${regDemo.stdout}`).toBe(0);

    // demo1 and beta are both live; alpha stays retired (gone from the active list).
    const finalNames = (status(dir).agents ?? []).map((a) => a.name);
    expect(finalNames).toEqual(expect.arrayContaining(["beta", "demo1"]));
    expect(finalNames).not.toContain("alpha");
  }, 150_000);

  it("DOD-CONN-1: name reuse after removal — removing then recreating the SAME name registers a fresh identity without stranding", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cello-conn-reuse-"));
    dirs.push(dir);
    const daemon = await startDaemon(dir, cluster.directoryUrl, "conn-reuse");
    daemons.push(daemon);

    const waitConnected = async (): Promise<void> => {
      for (let i = 0; i < 60; i++) {
        if ((status(dir).directory_signaling ?? "") === "connected") return;
        await new Promise((r) => setTimeout(r, 500));
      }
      throw new Error('directory_signaling never reached "connected"');
    };

    // Sole agent "solo" (also the would-be keystone primary). Create + register.
    expect(cello(["create-agent", "solo"], { CELLO_DIR: dir }).status, "create solo").toBe(0);
    await waitConnected();
    expect(registerAgent("solo", devToken("solo1"), { CELLO_DIR: dir }).status, "register solo").toBe(0);

    // Remove solo. With a SOLE agent, pre-CONN-001 the keystone had no identity left at all after
    // removal — the worst stranding case. Recreate the freed name + register a NEW identity.
    expect(cello(["remove-agent", "solo"], { CELLO_DIR: dir }).status, "remove solo").toBe(0);

    const created2 = cello(["create-agent", "solo"], { CELLO_DIR: dir });
    expect(created2.status, "recreate solo").toBe(0);
    await waitConnected();
    const reg2 = registerAgent("solo", devToken("solo2"), { CELLO_DIR: dir });
    expect(reg2.status, `re-registering the reused name must NOT strand: ${reg2.stdout}`).toBe(0);
  }, 150_000);
});
