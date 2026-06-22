/**
 * J-UPGRADE — live binary auto-acknowledge close (DOD-UP-2 / CELLO-M7-UPGRADE-002).
 *
 * Drives the REAL binaries. A+B hold a live session with one message B has received +
 * verified. Then A calls cello_close_session — and B's AGENT issues NO close call at all.
 * Today that degrades to a UNILATERAL seal after A's bilateral wait (B's agent never
 * acted). With auto-acknowledge, B's DAEMON auto-co-signs the responder SEAL leaf the
 * moment it ingests A's SEAL control leaf (via the relay leaf_deliver) AND has verified the
 * content — no agent prompt — so the bilateral seal completes promptly:
 *
 *   - DOD-UP-2 (AC-001/AC-007): A's close completes BILATERAL (not unilateral) with a
 *     byte-identical sealed_root, with NO B agent close call.
 *   - SI-001 (AC-003): B's responder SEAL leaf is signed by B's OWN node (submitSealLeaf
 *     uses B's K_local) — we remove the agent PROMPT, never the SIGNER.
 *   - AC-008: B's daemon logs session.seal.autoacknowledged.
 *
 * This is RED until the auto-acknowledge is built on the daemon onLeafDeliver path: today
 * onLeafDeliver only logs (session.relay.leaf.delivered), so A's close escalates to a
 * unilateral seal (seal_type: 'unilateral') because B's agent never closes.
 *
 * Anchored to the binary — see live-harness.ts. No in-process node construction.
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
  type SpineCluster,
  type Proc,
  type McpConn,
} from "./live-harness.js";

let cluster: SpineCluster;
const daemons: Proc[] = [];
const dirs: string[] = [];
const mcpConns: McpConn[] = [];

beforeAll(async () => {
  cluster = await startSpineCluster({});
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

describe("J-UPGRADE — auto-acknowledge close, live (DOD-UP-2)", () => {
  it("A closes, B's agent never closes → B's daemon auto-co-signs → BILATERAL seal completes (not unilateral)", async () => {
    const celloDirA = mkdtempSync(join(tmpdir(), "cello-upA-"));
    const celloDirB = mkdtempSync(join(tmpdir(), "cello-upB-"));
    dirs.push(celloDirA, celloDirB);
    await provisionAgent(celloDirA, "agentA");
    const pubB = await provisionAgent(celloDirB, "agentB");
    // A keeps a real bilateral wait so a working auto-ack completes it bilaterally well within
    // the window. If auto-ack does NOT fire, A escalates to unilateral after this timeout — which
    // is exactly the RED signal this test catches.
    const daemonA = await startDaemon(celloDirA, cluster.directoryUrl, "upA", {
      extraEnv: { CELLO_SEAL_BILATERAL_TIMEOUT_MS: "15000" },
    });
    const daemonB = await startDaemon(celloDirB, cluster.directoryUrl, "upB");
    daemons.push(daemonA, daemonB);
    expect(cello(["register", "agentA", `DEV-up-A-${randomBytes(6).toString("hex")}`], { CELLO_DIR: celloDirA }).status).toBe(0);
    expect(cello(["register", "agentB", `DEV-up-B-${randomBytes(6).toString("hex")}`], { CELLO_DIR: celloDirB }).status).toBe(0);

    const connA = await connectMcp(celloDirA, "up-A");
    mcpConns.push(connA);
    const connB = await connectMcp(celloDirB, "up-B");
    mcpConns.push(connB);
    expect(((await connA.call("cello_start_agent", { name: "agentA" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connA.call("cello_use_agent", { name: "agentA" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connB.call("cello_start_agent", { name: "agentB" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connB.call("cello_use_agent", { name: "agentB" })) as { ok?: boolean }).ok).toBe(true);

    const awaitP = connB.call("cello_await_session", { timeout_ms: 25_000 });
    const init = (await connA.call("cello_initiate_session", { target_pubkey: pubB })) as { ok?: boolean; sessionId?: string };
    expect(init.ok, `cello_initiate_session failed: ${JSON.stringify(init)}`).toBe(true);
    const sessionIdA = init.sessionId!;
    const inbound = (await awaitP) as { type?: string; session_id?: string };
    expect(inbound.type).toBe("new_session");
    const sessionIdB = inbound.session_id!;

    // One message that B receives + verifies — the precondition for auto-ack (B is online and
    // has verified the content behind the tree).
    expect(((await connA.call("cello_send", { session_id: sessionIdA, content: "upgrade auto-ack message" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connB.call("cello_receive", { session_id: sessionIdB, timeout_ms: 15_000 })) as { content?: string | null }).content).toBe("upgrade auto-ack message");

    // A closes. B's AGENT issues NO close call — the whole point. A working auto-ack makes B's
    // DAEMON submit the responder SEAL leaf on ingesting A's SEAL ctrl leaf, so A's close
    // completes BILATERAL.
    const close = (await connA.call("cello_close_session", { session_id: sessionIdA })) as {
      ok?: boolean; sealed_root?: string; seal_type?: string; reason?: string;
    };
    const diag =
      `\nclose: ${JSON.stringify(close)}` +
      `\n--- daemonB autoack/seal ---\n${daemonB.output.split("\n").filter((l) => /autoack|autoacknowledg|seal|leaf.deliver/i.test(l)).slice(-15).join("\n")}` +
      `\n--- directory seal/notariz ---\n${cluster.directory.output.split("\n").filter((l) => /seal|notariz|frost/i.test(l)).slice(-12).join("\n")}`;

    // DOD-UP-2 / AC-001: A's close completed and BILATERAL — NOT a unilateral fallback.
    expect(close.ok, `A close must succeed:${diag}`).toBe(true);
    expect(close.sealed_root, `A must surface a sealed_root:${diag}`).toMatch(/^[0-9a-f]{64}$/);
    expect(close.seal_type, `seal must be BILATERAL — B's daemon auto-acked, so NO unilateral fallback:${diag}`).not.toBe("unilateral");

    // AC-008: B's daemon auto-acknowledged (its own node co-signed without an agent close call).
    expect(daemonB.output, `B's daemon must log session.seal.autoacknowledged:${diag}`).toMatch(/session\.seal\.autoacknowledged/);
  }, 120_000);
});
