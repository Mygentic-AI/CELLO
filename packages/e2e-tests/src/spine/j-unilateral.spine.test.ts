/**
 * J-UNILATERAL — live binary unilateral seal → real FROST notarization
 * (M7-DEFINITION-OF-DONE.md §"verification harness", journey 6; DOD-SEAL-1/2/3).
 *
 * Drives the REAL binaries. Two parties establish a live session (A initiates to B,
 * A sends one message B receives). Then B's daemon is KILLED (SIGKILL — B is GONE),
 * the directory's delivery-grace window elapses, and A calls cello_close_session.
 *
 * The honest outcome when the counterparty is gone is a UNILATERAL seal:
 *   - DOD-SEAL-1: the directory fetches the session's signed-leaf chain from the relay,
 *     REBUILDS + VERIFIES the Merkle root (it no longer trusts the client's reported_root).
 *   - DOD-SEAL-2: it FROST-notarizes with the counterparty ABSENT (B never signs, never
 *     receives seal_verified); a signed, append-only SealNotarization is persisted with
 *     close_type SEAL_UNILATERAL and the counterparty recorded ABSENT.
 *   - DOD-SEAL-3: confirm carries the full certificate; A rebuilds the canonical seal TBS
 *     and verifies the FROST signature against an independently-trusted key BEFORE marking
 *     the session sealed — channel-independent proof.
 *
 * This is GREENFIELD: today #processSealUnilateral stores reported_root on faith (no leaf
 * fetch, no rebuild, no FROST, no signed notarization), and the daemon's cello_close_session
 * has NO unilateral escalation path — when the counterparty never co-closes it returns
 * seal_counterparty_pending forever. So this test is RED until the journey is built.
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

// The directory's delivery-grace window (seconds). Small so the live test does not wait
// out the real 600s window. A can seal unilaterally ~GRACE seconds after B goes silent.
const GRACE_SECONDS = 2;

let cluster: SpineCluster;
const daemons: Proc[] = [];
const dirs: string[] = [];
const mcpConns: McpConn[] = [];

beforeAll(async () => {
  cluster = await startSpineCluster({ deliveryGraceSeconds: GRACE_SECONDS });
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

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("J-UNILATERAL — unilateral seal → real notarization, live (DOD-SEAL-1/2/3)", () => {
  it("A seals while B is GONE → directory rebuilds+verifies the root, FROST-notarizes with B ABSENT, A gets a verifiable unilateral certificate", async () => {
    const celloDirA = mkdtempSync(join(tmpdir(), "cello-uniA-"));
    const celloDirB = mkdtempSync(join(tmpdir(), "cello-uniB-"));
    dirs.push(celloDirA, celloDirB);
    await provisionAgent(celloDirA, "agentA");
    const pubB = await provisionAgent(celloDirB, "agentB");
    // A's close should escalate to a unilateral seal quickly once B is gone — shrink the
    // bilateral-wait window so the live test doesn't sit out the 30s default.
    const daemonA = await startDaemon(celloDirA, cluster.directoryUrl, "uniA", {
      extraEnv: { CELLO_SEAL_BILATERAL_TIMEOUT_MS: "3000" },
    });
    const daemonB = await startDaemon(celloDirB, cluster.directoryUrl, "uniB");
    daemons.push(daemonA, daemonB);
    expect(cello(["register", "agentA", `DEV-uni-A-${randomBytes(6).toString("hex")}`], { CELLO_DIR: celloDirA }).status).toBe(0);
    expect(cello(["register", "agentB", `DEV-uni-B-${randomBytes(6).toString("hex")}`], { CELLO_DIR: celloDirB }).status).toBe(0);

    const connA = await connectMcp(celloDirA, "uni-A");
    mcpConns.push(connA);
    const connB = await connectMcp(celloDirB, "uni-B");
    mcpConns.push(connB);
    expect(((await connA.call("cello_start_agent", { name: "agentA" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connA.call("cello_use_agent", { name: "agentA" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connB.call("cello_start_agent", { name: "agentB" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connB.call("cello_use_agent", { name: "agentB" })) as { ok?: boolean }).ok).toBe(true);

    // Establish the session.
    const awaitP = connB.call("cello_await_session", { timeout_ms: 25_000 });
    const init = (await connA.call("cello_initiate_session", { target_pubkey: pubB })) as { ok?: boolean; sessionId?: string };
    expect(init.ok, `cello_initiate_session failed: ${JSON.stringify(init)}`).toBe(true);
    const sessionIdA = init.sessionId!;
    const inbound = (await awaitP) as { type?: string; session_id?: string };
    expect(inbound.type).toBe("new_session");
    const sessionIdB = inbound.session_id!;

    // One message so the sealed tree carries a real (non-trivial) transcript: a msg leaf
    // from A, a msg leaf from B's ack, then A's single SEAL ctrl leaf at close. The
    // directory's recomputed root MUST match A's reported root over exactly this chain.
    expect(((await connA.call("cello_send", { session_id: sessionIdA, content: "unilateral sealed message" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connB.call("cello_receive", { session_id: sessionIdB, timeout_ms: 15_000 })) as { content?: string | null }).content).toBe("unilateral sealed message");

    // B GOES GONE — abrupt SIGKILL (crash / power loss), no graceful close, no SEAL leaf
    // from B. The directory will record B ABSENT and never push it seal_verified.
    await daemonB.kill();

    // Let the delivery-grace window elapse so the directory will accept the unilateral seal
    // (it rejects seal_unilateral_too_early before grace). Margin over GRACE_SECONDS.
    await sleep((GRACE_SECONDS + 2) * 1000);

    // A closes. With the counterparty gone past grace, cello_close_session escalates to a
    // unilateral seal: it submits A's SEAL ctrl leaf + a seal_unilateral request, the
    // directory verifies + FROST-notarizes (B ABSENT), and A verifies the returned cert.
    const close = (await connA.call("cello_close_session", { session_id: sessionIdA })) as {
      ok?: boolean;
      sealed_root?: string;
      seal_type?: string;
      reason?: string;
    };

    const diag =
      `\nclose: ${JSON.stringify(close)}` +
      `\n--- daemonA seal/cert ---\n${daemonA.output.split("\n").filter((l) => /seal|unilateral|cert|notariz|relay/i.test(l)).slice(-20).join("\n")}` +
      `\n--- directory unilateral/seal ---\n${cluster.directory.output.split("\n").filter((l) => /unilateral|seal|notariz|frost|absent|leaf/i.test(l)).slice(-30).join("\n")}` +
      `\n--- relay ---\n${cluster.relay.output.split("\n").filter((l) => /seal|leaf|hash_submit|get_seal/i.test(l)).slice(-15).join("\n")}`;

    // DOD-SEAL-3: A walks away with a verifiable sealed_root from the unilateral certificate.
    expect(close.ok, `A unilateral close must succeed:${diag}`).toBe(true);
    expect(close.sealed_root, `A must surface a sealed_root from the unilateral cert:${diag}`).toMatch(/^[0-9a-f]{64}$/);
    expect(close.seal_type, `seal_type must be 'unilateral':${diag}`).toBe("unilateral");

    // DOD-SEAL-1/2: the directory ran the REAL notarization (verify→FROST→persist), not the
    // old unsigned bookkeeping. session.unilateral.notarized fires only after a signed
    // SealNotarization is persisted with the counterparty ABSENT.
    expect(cluster.directory.output, `directory must emit session.unilateral.notarized (verified+FROST+persisted):${diag}`).toMatch(/session\.unilateral\.notarized/);
    // The recomputed root was verified against the leaf chain fetched from the relay.
    expect(cluster.directory.output, `directory must fetch the signed-leaf chain from the relay:${diag}`).toMatch(/get_seal_leaves|leaf.*fetch|unilateral.*leaves/i);

    // DOD-SEAL-3: A verified the certificate signature over the rebuilt TBS against an
    // independently-trusted key BEFORE marking the session sealed (channel-independent).
    expect(daemonA.output, `A must verify the unilateral certificate signature:${diag}`).toMatch(/session\.unilateral\.certificate\.verified/);

    // SI-002 (D-2): B (the absent party, pubkey ${pubB}) is NEVER a signer — the notarized
    // event records it ABSENT, and the directory never delivered it seal_verified.
    expect(cluster.directory.output, `the notarized event must record B (${pubB.slice(0, 16)}…) ABSENT:${diag}`).toMatch(/absent/i);
  }, 120_000);
});
