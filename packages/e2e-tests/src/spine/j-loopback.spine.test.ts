/**
 * J-LOOPBACK — two of the operator's own agents converse on ONE daemon (DOD-LOOP-1).
 *
 * The requirement (Andre): run two local agents (two K_locals) that talk to each other WITHOUT
 * spawning a second daemon process. Today the daemon's session core is keyed by `session_id`
 * alone, so when agent A initiates session S (writing a sessions row owned by A), agent B on the
 * SAME daemon trying to be S's other end COLLIDES — B's accept hits A's row (double-accept guard)
 * and the single-owner ownership check denies B. CELLO-M7-SESSION-CORE-REKEY-001 re-keys the
 * session core to `(agent, session_id)` so both ends coexist on one daemon.
 *
 * This test drives the REAL binaries: ONE cello-daemon, TWO agents registered on it (two real
 * cello-mcp connections), A initiates to B, they exchange a message, and BOTH close → a bilateral
 * seal where each end signs with its OWN K_local (INV-2) → both ends surface a byte-identical
 * sealed_root. NO second daemon process.
 *
 * RED until the re-key lands: today B's cello_await_session / accept collides with A's session.
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

// SKIPPED until DOD-LOOP-1 (CELLO-M7-SESSION-CORE-REKEY-001) is implemented — this is the RED target.
// First run (2026-06-22) revealed TWO blockers, not one: (1) cello_initiate_session returns
// `standing_receiver_unavailable` PERSISTENTLY when two agents share one daemon (the single
// per-daemon standing receiver is not ready in the loopback scenario — a dimension beyond the
// session-core keying the story scoped); (2) the session-core collision (B's accept hits A's
// session_id-keyed row). Un-skip when implementing; both must be resolved for this to pass.
describe.skip("J-LOOPBACK — two agents converse on ONE daemon (DOD-LOOP-1)", () => {
  it("A initiates to B on the SAME daemon → exchange + bilateral seal, byte-identical root, no 2nd daemon", async () => {
    // ONE celloDir → ONE daemon hosting BOTH ends.
    const celloDir = mkdtempSync(join(tmpdir(), "cello-loop-"));
    dirs.push(celloDir);
    const pubA = await provisionAgent(celloDir, "agentA");
    const pubB = await provisionAgent(celloDir, "agentB");
    const daemon = await startDaemon(celloDir, cluster.directoryUrl, "loop");
    daemons.push(daemon);
    expect(cello(["register", "agentA", `DEV-loop-A-${randomBytes(6).toString("hex")}`], { CELLO_DIR: celloDir }).status).toBe(0);
    expect(cello(["register", "agentB", `DEV-loop-B-${randomBytes(6).toString("hex")}`], { CELLO_DIR: celloDir }).status).toBe(0);

    // TWO MCP connections to the ONE daemon — one drives agent A, the other agent B.
    const connA = await connectMcp(celloDir, "loop-A");
    mcpConns.push(connA);
    const connB = await connectMcp(celloDir, "loop-B");
    mcpConns.push(connB);
    expect(((await connA.call("cello_start_agent", { name: "agentA" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connA.call("cello_use_agent", { name: "agentA" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connB.call("cello_start_agent", { name: "agentB" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connB.call("cello_use_agent", { name: "agentB" })) as { ok?: boolean }).ok).toBe(true);

    // B awaits; A initiates to B — BOTH ends on the same daemon. Today this collides.
    const awaitP = connB.call("cello_await_session", { timeout_ms: 25_000 });
    // The standing receiver finishes initializing shortly after start — retry past that window
    // (the guidance itself says to retry); the loopback COLLISION is downstream at B's accept.
    let init = (await connA.call("cello_initiate_session", { target_pubkey: pubB })) as { ok?: boolean; sessionId?: string; reason?: string };
    for (let i = 0; i < 20 && !init.ok && init.reason === "standing_receiver_unavailable"; i++) {
      await new Promise((r) => setTimeout(r, 300));
      init = (await connA.call("cello_initiate_session", { target_pubkey: pubB })) as { ok?: boolean; sessionId?: string; reason?: string };
    }
    expect(init.ok, `A→B initiate on one daemon failed: ${JSON.stringify(init)}\n--- daemon node/standing/dir logs ---\n${daemon.output.split("\n").filter((l) => /node|standing|receiver|directory_signaling|login|initialize|started/i.test(l)).slice(-30).join("\n")}`).toBe(true);
    const sessionIdA = init.sessionId!;
    const inbound = (await awaitP) as { type?: string; session_id?: string };
    expect(inbound.type, `B must accept A's session as its OWN end (not a collision): ${JSON.stringify(inbound)}`).toBe("new_session");
    const sessionIdB = inbound.session_id!;
    expect(sessionIdB, "both ends share the same session_id (the re-key is local bookkeeping only)").toBe(sessionIdA);

    // A → B message, both ends on one daemon.
    expect(((await connA.call("cello_send", { session_id: sessionIdA, content: "loopback hello" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connB.call("cello_receive", { session_id: sessionIdB, timeout_ms: 15_000 })) as { content?: string | null }).content).toBe("loopback hello");

    // AC-003 isolation: A's connection cannot reach B's end and vice versa — distinct (agent,
    // session_id) records. (A receiving on B's session would mean cross-end leakage.)
    const aOnBsEnd = (await connA.call("cello_receive", { session_id: sessionIdB, timeout_ms: 2_000 })) as { content?: string | null; reason?: string; ok?: boolean };
    expect(aOnBsEnd.content ?? null, "A must NOT read B's end of the session (cross-end isolation)").toBeNull();

    // Both close → bilateral seal. Each end signs with its OWN K_local; both surface the SAME root.
    const [closeA, closeB] = (await Promise.all([
      connA.call("cello_close_session", { session_id: sessionIdA }),
      connB.call("cello_close_session", { session_id: sessionIdB }),
    ])) as Array<{ ok?: boolean; sealed_root?: string; seal_type?: string; reason?: string }>;
    const diag = `\ncloseA: ${JSON.stringify(closeA)}\ncloseB: ${JSON.stringify(closeB)}` +
      `\n--- daemon seal/session ---\n${daemon.output.split("\n").filter((l) => /seal|session|rekey|node\.created/i.test(l)).slice(-20).join("\n")}`;
    expect(closeA.ok, `A close failed:${diag}`).toBe(true);
    expect(closeB.ok, `B close failed:${diag}`).toBe(true);
    expect(closeA.sealed_root, `A sealed_root:${diag}`).toMatch(/^[0-9a-f]{64}$/);
    expect(closeB.sealed_root, `both ends' sealed_root must be BYTE-IDENTICAL (one bilateral seal):${diag}`).toBe(closeA.sealed_root);
    expect(closeA.seal_type, `seal must be bilateral (not a unilateral fallback):${diag}`).not.toBe("unilateral");

    // Exactly ONE daemon process hosted the whole conversation.
    expect(daemons.length, "exactly one daemon process was started for the whole conversation").toBe(1);
  }, 150_000);
});
