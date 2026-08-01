/**
 * J-UPGRADE-001 — live unilateral → BILATERAL seal upgrade (DOD-UP-1 / CELLO-M7-UPGRADE-001).
 *
 * Drives the REAL binaries. The hard case the auto-ack (DOD-UP-2) cannot cover: B is GENUINELY
 * OFFLINE when A closes, so A seals UNILATERALLY. Later B comes back, recovers + verifies the
 * content, and RATIFIES the seal — upgrading it to bilateral over the SAME root (Model 2).
 *
 *   1. A ↔ B hold a live session; A sends one message B receives + verifies.
 *   2. B's daemon is SIGKILLed (crash / power loss) — B is GONE.
 *   3. The delivery-grace window elapses; A calls cello_close_session → UNILATERAL seal
 *      (seal_type:'unilateral', B ABSENT). Asserted.
 *   4. B's daemon is RESTARTED on the same CELLO_DIR and the agent restarted → its signaling
 *      reconnects → the directory delivers the queued seal_unilateral_notification.
 *   5. B's daemon (DOD-UP-1 KERNEL): recovers the parked content, passes the verifiability gate,
 *      signs the ack over R1 with its OWN K_local, and sends seal_upgrade_request.
 *   6. The directory writes a SUPERSEDING bilateral notarization (same root R1, the unilateral row
 *      preserved) and confirms to both parties, who verify the dual attestation (AC-008).
 *
 * AUTHORITATIVE assertion = psqlSpine against the directory's OWN seal_notarizations table (the
 * daemon cannot fabricate it): after the upgrade, the session's root R1 carries BOTH a 'unilateral'
 * row (still there — append-only) AND a 'bilateral' row whose supersedes_notarization_id points at
 * the unilateral row's id.
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
  registerAgent,
  psqlSpine,
  type SpineCluster,
  type Proc,
  type McpConn,
} from "./live-harness.js";

let cluster: SpineCluster;
const daemons: Proc[] = [];
const dirs: string[] = [];
const mcpConns: McpConn[] = [];
const GRACE_SECONDS = 2;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  // Short delivery-grace so A's close escalates to a unilateral seal quickly once B is gone.
  cluster = await startSpineCluster({ deliveryGraceSeconds: GRACE_SECONDS });
}, 180_000);

afterAll(async () => {
  for (const c of mcpConns) await c.close();
  for (const d of daemons) await d.stop();
  await cluster?.stop();
  for (const dir of dirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

describe("J-UPGRADE-001 — unilateral → bilateral upgrade on the absent party's return (DOD-UP-1)", () => {
  it("B killed → A seals UNILATERAL → B returns, recovers+verifies, RATIFIES → directory records a superseding BILATERAL notarization over the same root", async () => {
    const celloDirA = mkdtempSync(join(tmpdir(), "cello-upbA-"));
    const celloDirB = mkdtempSync(join(tmpdir(), "cello-upbB-"));
    dirs.push(celloDirA, celloDirB);
    await provisionAgent(celloDirA, "agentA");
    const pubB = await provisionAgent(celloDirB, "agentB");
    const daemonA = await startDaemon(celloDirA, cluster.directoryUrl, "upbA", {
      extraEnv: { CELLO_SEAL_BILATERAL_TIMEOUT_MS: "3000" },
    });
    let daemonB = await startDaemon(celloDirB, cluster.directoryUrl, "upbB");
    daemons.push(daemonA, daemonB);
    expect(registerAgent("agentA", `DEV-upb-A-${randomBytes(6).toString("hex")}`, { CELLO_DIR: celloDirA }).status).toBe(0);
    expect(registerAgent("agentB", `DEV-upb-B-${randomBytes(6).toString("hex")}`, { CELLO_DIR: celloDirB }).status).toBe(0);

    const connA = await connectMcp(celloDirA, "upb-A");
    mcpConns.push(connA);
    let connB = await connectMcp(celloDirB, "upb-B1");
    mcpConns.push(connB);
    expect(((await connA.call("cello_start_agent", { name: "agentA" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connA.call("cello_use_agent", { name: "agentA" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connB.call("cello_start_agent", { name: "agentB" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connB.call("cello_use_agent", { name: "agentB" })) as { ok?: boolean }).ok).toBe(true);

    // Establish the session + one message B receives & verifies (the content B will later ratify).
    const awaitP = connB.call("cello_await_session", { timeout_ms: 25_000 });
    const init = (await connA.call("cello_initiate_session", { target_pubkey: pubB })) as { ok?: boolean; sessionId?: string };
    expect(init.ok, `cello_initiate_session failed: ${JSON.stringify(init)}`).toBe(true);
    const sessionIdA = init.sessionId!;
    const inbound = (await awaitP) as { type?: string; session_id?: string };
    expect(inbound.type).toBe("new_session");
    const sessionIdB = inbound.session_id!;
    expect(((await connA.call("cello_send", { cello_session_id: sessionIdA, content: "upgrade-to-bilateral message", signal: "over" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connB.call("cello_receive", { cello_session_id: sessionIdB, timeout_ms: 15_000 })) as { content?: string | null }).content).toBe("upgrade-to-bilateral message");

    // ── B GOES GONE (SIGKILL). A closes after grace → UNILATERAL seal. ──
    await daemonB.kill();
    await sleep((GRACE_SECONDS + 2) * 1000);
    const close = (await connA.call("cello_close_session", { cello_session_id: sessionIdA })) as {
      ok?: boolean; sealed_root?: string; seal_type?: string; reason?: string;
    };
    const unilateralDiag =
      `\nclose: ${JSON.stringify(close)}` +
      `\n--- directory ---\n${cluster.directory.output.split("\n").filter((l) => /unilateral|seal|notariz|absent/i.test(l)).slice(-15).join("\n")}`;
    expect(close.ok, `A unilateral close must succeed:${unilateralDiag}`).toBe(true);
    expect(close.seal_type, `seal must be unilateral (B was gone):${unilateralDiag}`).toBe("unilateral");
    const rootHex = close.sealed_root!;
    expect(rootHex, `A must surface a sealed_root:${unilateralDiag}`).toMatch(/^[0-9a-f]{64}$/);

    // Corroborate the unilateral row exists in the directory's table (pre-upgrade baseline).
    const uniCount = psqlSpine(`SELECT count(*) FROM seal_notarizations WHERE sealed_root = decode('${rootHex}','hex') AND seal_type='unilateral';`);
    expect(uniCount, `directory must hold exactly one unilateral notarization for R1:${unilateralDiag}`).toBe("1");

    // ── B RETURNS: restart its daemon on the SAME CELLO_DIR, restart the agent → signaling
    //    reconnects → the directory delivers the queued seal_unilateral_notification → B ratifies. ──
    daemonB = await startDaemon(celloDirB, cluster.directoryUrl, "upbB-restart");
    daemons.push(daemonB);
    connB = await connectMcp(celloDirB, "upb-B2");
    mcpConns.push(connB);
    expect(((await connB.call("cello_start_agent", { name: "agentB" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connB.call("cello_use_agent", { name: "agentB" })) as { ok?: boolean }).ok).toBe(true);

    // B's daemon attempts + completes the upgrade autonomously (no agent action needed).
    await daemonB.waitForLine(/"event":"session\.seal\.upgrade\.requested"/, 30_000);
    await daemonB.waitForLine(/"event":"session\.seal\.upgraded"/, 30_000);

    const upgradeDiag =
      `\nrootHex: ${rootHex}` +
      `\n--- daemonB upgrade ---\n${daemonB.output.split("\n").filter((l) => /upgrade|upgraded|ratif|seal/i.test(l)).slice(-15).join("\n")}` +
      `\n--- daemonA upgrade ---\n${daemonA.output.split("\n").filter((l) => /upgrade|upgraded|seal/i.test(l)).slice(-10).join("\n")}` +
      `\n--- directory upgrade ---\n${cluster.directory.output.split("\n").filter((l) => /upgrad|superseding|bilateral|notariz/i.test(l)).slice(-15).join("\n")}`;

    // ── AUTHORITATIVE: the directory's OWN seal_notarizations table (daemon cannot fabricate). ──
    // The unilateral row is PRESERVED (append-only) AND a superseding bilateral row exists over R1.
    expect(
      psqlSpine(`SELECT count(*) FROM seal_notarizations WHERE sealed_root = decode('${rootHex}','hex') AND seal_type='unilateral';`),
      `the unilateral row must be preserved (append-only):${upgradeDiag}`,
    ).toBe("1");
    expect(
      psqlSpine(`SELECT count(*) FROM seal_notarizations WHERE sealed_root = decode('${rootHex}','hex') AND seal_type='bilateral';`),
      `a superseding bilateral notarization must exist over the SAME root R1:${upgradeDiag}`,
    ).toBe("1");
    // The bilateral row SUPERSEDES the unilateral one (its FK points at the unilateral row's id).
    expect(
      psqlSpine(
        `SELECT (b.supersedes_notarization_id = u.id) FROM seal_notarizations b ` +
        `JOIN seal_notarizations u ON u.sealed_root = b.sealed_root AND u.seal_type='unilateral' ` +
        `WHERE b.sealed_root = decode('${rootHex}','hex') AND b.seal_type='bilateral';`,
      ),
      `the bilateral row must point supersedes_notarization_id at the unilateral row:${upgradeDiag}`,
    ).toBe("t");

    // DOD-UP-1 KERNEL surfaced live: B ratified only after recovering + verifying the content.
    expect(daemonB.output, `B must log the upgrade request (signed its ratification):${upgradeDiag}`).toMatch(/session\.seal\.upgrade\.requested/);
    // The directory ran the upgrade ceremony.
    expect(cluster.directory.output, `directory must record the upgrade:${upgradeDiag}`).toMatch(/session\.seal\.upgraded|Upgraded unilateral/i);
    // AC-008: the present party (A) verified the dual-attestation cert before accepting bilateral.
    expect(daemonA.output, `A must accept the bilateral upgrade (dual-attestation verified):${upgradeDiag}`).toMatch(/session\.seal\.upgraded/);

    // SEAL-2 (Sybil-defense relationship graph, live): the UNILATERAL seal populated the graph rows
    // (best-effort; landed by now since the unilateral close was long before the upgrade). The UPGRADE
    // does NOT add a second conversation_seals row — conversation_id is UNIQUE; the A↔B edge already
    // exists. Stored: relationship metadata + the root HASH only, never content.
    expect(
      psqlSpine(`SELECT count(*) FROM conversation_seals WHERE merkle_root = '${rootHex}';`),
      `exactly one conversation_seals row for R1 (unilateral wrote it; upgrade skipped it):${upgradeDiag}`,
    ).toBe("1");
    expect(
      psqlSpine(`SELECT close_type FROM conversation_seals WHERE merkle_root = '${rootHex}';`),
      `the conversation_seals close_type must be SEAL_UNILATERAL:${upgradeDiag}`,
    ).toBe("SEAL_UNILATERAL");
    expect(
      psqlSpine(`SELECT count(*) FROM conversation_participation cp JOIN conversation_seals cs ON cs.conversation_id = cp.conversation_id WHERE cs.merkle_root = '${rootHex}';`),
      `both parties must be graph nodes (2 conversation_participation rows — the edge):${upgradeDiag}`,
    ).toBe("2");
  }, 180_000);
});
