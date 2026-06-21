/**
 * J-INT — live binary interrupted-session detection (M7-DEFINITION-OF-DONE.md
 * §"verification harness", journey 4; DOD-INT-1).
 *
 * Drives the REAL binaries: two parties establish a live session (A initiates to B,
 * A sends a message), then A's daemon is KILLED abruptly (SIGKILL — a crash, no
 * graceful shutdown). On the next start, A's daemon must detect the session that was
 * left `active` in its SQLCipher DB, mark it `interrupted`, and surface it at login —
 * BEFORE other ops — with sessionId / counterparty / messageCount and
 * `session.interrupted.detected` carrying `source: daemon_restart`.
 *
 * DOD-INT-1 was merged pre-collapse but never re-verified live in the daemon era; this
 * is that live proof. Anchored to the binary — see live-harness.ts.
 *
 * Run: pnpm --filter @cello-protocol/e2e-tests test:spine
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  startSpineCluster,
  startDaemon,
  provisionAgent,
  connectMcp,
  cello,
  ipcCall,
  type SpineCluster,
  type Proc,
  type McpConn,
} from "./live-harness.js";

let cluster: SpineCluster;
const daemons: Proc[] = [];
const dirs: string[] = [];
const mcpConns: McpConn[] = [];

beforeAll(async () => {
  cluster = await startSpineCluster();
}, 180_000);

afterAll(async () => {
  for (const c of mcpConns) await c.close();
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

interface CelloStatus {
  daemon?: string;
  interrupted_sessions?: Array<{ sessionId: string; counterpartyPubkey: string; messageCount: number }>;
}

describe("J-INT — interrupted + retry survival, live (DOD-INT-1 / DOD-RETRY-1)", () => {
  it("DOD-INT-1 — kill daemon mid-session → next start marks it interrupted, surfaced at login with source: daemon_restart", async () => {
    const celloDirA = mkdtempSync(join(tmpdir(), "cello-intA-"));
    const celloDirB = mkdtempSync(join(tmpdir(), "cello-intB-"));
    dirs.push(celloDirA, celloDirB);
    await provisionAgent(celloDirA, "agentA");
    const pubB = await provisionAgent(celloDirB, "agentB");

    let daemonA = await startDaemon(celloDirA, cluster.directoryUrl, "intA");
    const daemonB = await startDaemon(celloDirB, cluster.directoryUrl, "intB");
    daemons.push(daemonA, daemonB);

    // Register both (real DKG) so the session can be brokered + FROST-assigned.
    expect(cello(["register", "agentA", `DEV-int-A-${randomBytes(6).toString("hex")}`], { CELLO_DIR: celloDirA }).status).toBe(0);
    expect(cello(["register", "agentB", `DEV-int-B-${randomBytes(6).toString("hex")}`], { CELLO_DIR: celloDirB }).status).toBe(0);

    const connA = await connectMcp(celloDirA, "int-A");
    const connB = await connectMcp(celloDirB, "int-B");
    mcpConns.push(connA, connB);
    expect(((await connA.call("cello_start_agent", { name: "agentA" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connA.call("cello_use_agent", { name: "agentA" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connB.call("cello_start_agent", { name: "agentB" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connB.call("cello_use_agent", { name: "agentB" })) as { ok?: boolean }).ok).toBe(true);

    // Establish a live A→B session and put a message through it.
    const awaitP = connB.call("cello_await_session", { timeout_ms: 25_000 });
    const init = (await connA.call("cello_initiate_session", { target_pubkey: pubB })) as {
      ok?: boolean;
      sessionId?: string;
    };
    expect(init.ok, `initiate failed:\n${daemonA.output.split("\n").slice(-40).join("\n")}`).toBe(true);
    const sessionId = init.sessionId!;
    expect(sessionId).toBeTruthy();
    const inbound = (await awaitP) as { type?: string };
    expect(inbound.type, "B must receive the inbound session").toBe("new_session");

    const sent = (await connA.call("cello_send", { session_id: sessionId, content: "int-1 message before the crash" })) as {
      ok?: boolean;
    };
    expect(sent.ok, `cello_send failed:\n${JSON.stringify(sent)}`).toBe(true);

    // ── Crash A's daemon abruptly (no graceful shutdown → session stays `active`). ──
    await daemonA.kill();
    await connA.close(); // its IPC is dead now; close so it isn't double-closed in afterAll
    mcpConns.splice(mcpConns.indexOf(connA), 1);
    // Stale socket/lock from the crash — a real `cello login` clears these via
    // connect-or-start; the harness models that before re-spawning the binary directly.
    for (const f of ["daemon.sock", "daemon.lock"]) {
      try {
        rmSync(join(celloDirA, f), { force: true });
      } catch {
        /* best-effort */
      }
    }

    // ── Restart A's daemon on the SAME CELLO_DIR (same SQLCipher DB). ──
    daemonA = await startDaemon(celloDirA, cluster.directoryUrl, "intA-restart");
    daemons.push(daemonA);

    // The interrupted detection runs in SessionNodeManager.initialize() BEFORE the IPC
    // socket opens, so by daemon.started the event has been logged.
    const detected = await daemonA.waitForLine(/"event":"session\.interrupted\.detected"/, 15_000);
    expect(detected, "interrupted detection must carry source: daemon_restart").toMatch(/"source":"daemon_restart"/);
    expect(detected, "interrupted detection must name the session").toContain(sessionId);

    // Surfaced at next login, before other ops: `cello login` then `cello status` shows
    // the interrupted session with sessionId / counterparty / messageCount.
    expect(cello(["login"], { CELLO_DIR: celloDirA }).status, "cello login after restart").toBe(0);
    const statusRaw = cello(["status"], { CELLO_DIR: celloDirA });
    const status = JSON.parse(statusRaw.stdout.trim()) as CelloStatus;
    const interrupted = (status.interrupted_sessions ?? []).find((s) => s.sessionId === sessionId);
    expect(interrupted, `interrupted session must surface in cello status:\n${statusRaw.stdout}`).toBeTruthy();
    // The initiator's interrupted session must record WHO it was with — B's K_local
    // (the target_pubkey A initiated to). Empty here was the DOD-INT-1 gap this test found.
    expect(interrupted!.counterpartyPubkey, `counterparty must be B (${pubB})`).toBe(pubB);
    expect(typeof interrupted!.messageCount, "interrupted session carries a messageCount").toBe("number");
    expect(interrupted!.messageCount, "the message sent before the crash is counted").toBeGreaterThanOrEqual(1);
  }, 120_000);

  it("DOD-RETRY-1 — retry queue (FIFO) + nonce dedup survive a real daemon restart (SQLCipher)", async () => {
    const celloDir = mkdtempSync(join(tmpdir(), "cello-retry-"));
    dirs.push(celloDir);
    await provisionAgent(celloDir, "retryA");
    let daemon = await startDaemon(celloDir, cluster.directoryUrl, "retryA");
    daemons.push(daemon);

    const sessionId = randomBytes(16).toString("hex");
    const nonce1 = randomBytes(12).toString("hex");
    const nonce2 = randomBytes(12).toString("hex");
    const senderPubkey = randomBytes(32).toString("hex");
    const content1 = Buffer.from("retry message one").toString("hex");
    const content2 = Buffer.from("retry message two").toString("hex");

    // Enqueue two messages (FIFO order) and mark nonce1 as seen — all BEFORE the crash.
    expect((await ipcCall(celloDir, "queue_failed_send", { sessionId, nonce: nonce1, content: content1 })).queued).toBe(true);
    const q2 = await ipcCall(celloDir, "queue_failed_send", { sessionId, nonce: nonce2, content: content2 });
    expect(q2.queueDepth, "two messages queued").toBe(2);
    const firstSeen = await ipcCall(celloDir, "check_nonce", { sessionId, nonce: nonce1, senderPubkey });
    expect(firstSeen.duplicate, "nonce1 is fresh the first time").toBe(false);

    // ── Crash + restart on the SAME CELLO_DIR. SQLCipher must restore both. ──
    await daemon.kill();
    for (const f of ["daemon.sock", "daemon.lock"]) {
      try {
        rmSync(join(celloDir, f), { force: true });
      } catch {
        /* best-effort */
      }
    }
    daemon = await startDaemon(celloDir, cluster.directoryUrl, "retryA-restart");
    daemons.push(daemon);

    // Retry queue survived: both entries present, in FIFO order (M2 must not jump M1).
    const drained = await ipcCall(celloDir, "drain_session", { sessionId });
    expect(drained.pendingCount, "both queued messages survived the restart").toBe(2);
    expect(drained.nonces, "FIFO order preserved across the restart").toEqual([nonce1, nonce2]);

    // Nonce dedup survived: nonce1 (seen before the crash) is STILL a duplicate; a fresh
    // nonce is not. So a replay after a restart is still rejected.
    const stillSeen = await ipcCall(celloDir, "check_nonce", { sessionId, nonce: nonce1, senderPubkey });
    expect(stillSeen.duplicate, "the pre-crash nonce is still rejected after restart").toBe(true);
    const fresh = await ipcCall(celloDir, "check_nonce", { sessionId, nonce: randomBytes(12).toString("hex"), senderPubkey });
    expect(fresh.duplicate, "a never-seen nonce is not a duplicate").toBe(false);
  }, 90_000);
});
