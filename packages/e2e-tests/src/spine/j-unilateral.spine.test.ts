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

/**
 * Bring two agents to a live session with one message exchanged (A msg + A SEAL ctrl leaf at
 * close). Returns the handles the seal cases need. daemonA gets a short bilateral-wait so its
 * close escalates to a unilateral seal quickly.
 */
async function setupAtoBSession(label: string): Promise<{
  connA: McpConn; connB: McpConn; daemonA: Proc; daemonB: Proc; sessionIdA: string; pubB: string;
}> {
  const celloDirA = mkdtempSync(join(tmpdir(), `cello-${label}A-`));
  const celloDirB = mkdtempSync(join(tmpdir(), `cello-${label}B-`));
  dirs.push(celloDirA, celloDirB);
  await provisionAgent(celloDirA, "agentA");
  const pubB = await provisionAgent(celloDirB, "agentB");
  const daemonA = await startDaemon(celloDirA, cluster.directoryUrl, `${label}A`, {
    extraEnv: { CELLO_SEAL_BILATERAL_TIMEOUT_MS: "3000" },
  });
  const daemonB = await startDaemon(celloDirB, cluster.directoryUrl, `${label}B`);
  daemons.push(daemonA, daemonB);
  expect(cello(["register", "agentA", `DEV-${label}-A-${randomBytes(6).toString("hex")}`], { CELLO_DIR: celloDirA }).status).toBe(0);
  expect(cello(["register", "agentB", `DEV-${label}-B-${randomBytes(6).toString("hex")}`], { CELLO_DIR: celloDirB }).status).toBe(0);

  const connA = await connectMcp(celloDirA, `${label}-A`);
  mcpConns.push(connA);
  const connB = await connectMcp(celloDirB, `${label}-B`);
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

  expect(((await connA.call("cello_send", { session_id: sessionIdA, content: `${label} sealed message` })) as { ok?: boolean }).ok).toBe(true);
  expect(((await connB.call("cello_receive", { session_id: sessionIdB, timeout_ms: 15_000 })) as { content?: string | null }).content).toBe(`${label} sealed message`);

  return { connA, connB, daemonA, daemonB, sessionIdA, pubB };
}

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
    // FED-OPTIONB-SEAL-001 (Option B): the recomputed root was verified against the CLIENT-CARRIED leaf
    // chain rebuilt OFFLINE — the directory did NOT dial the relay's getSealLeaves. Positive: the directory
    // logs leaves.rebuilt with source=client_carried. Negative: it did NOT log the old leaves.fetched dial,
    // and the relay never handled a get_seal_leaves frame.
    expect(cluster.directory.output, `directory must rebuild the chain OFFLINE from client-carried leaves:${diag}`)
      .toMatch(/"event":"session\.unilateral\.leaves\.rebuilt"[^}]*"source":"client_carried"/);
    expect(cluster.directory.output, `directory must NOT dial getSealLeaves under Option B:${diag}`)
      .not.toMatch(/session\.unilateral\.leaves\.fetched/);
    expect(cluster.relay.output, `relay must NOT handle a get_seal_leaves frame under Option B:${diag}`)
      .not.toMatch(/get_seal_leaves/);

    // DOD-SEAL-3: A verified the certificate signature over the rebuilt TBS against an
    // independently-trusted key BEFORE marking the session sealed (channel-independent).
    expect(daemonA.output, `A must verify the unilateral certificate signature:${diag}`).toMatch(/session\.unilateral\.certificate\.verified/);

    // SI-002 (D-2): B (the absent party, pubkey ${pubB}) is NEVER a signer — the notarized
    // event records it ABSENT, and the directory never delivered it seal_verified.
    expect(cluster.directory.output, `the notarized event must record B (${pubB.slice(0, 16)}…) ABSENT:${diag}`).toMatch(/absent/i);
  }, 120_000);
});

describe("J-UNILATERAL — DOD-LIVE-2: the ABSENT gate (gone→ABSENT vs alive-but-silent→DELIVERED)", () => {
  // gone → ABSENT. B is killed; the relay (the session-path liveness authority) POSITIVELY
  // observes B's standing-connection drop. At A's unilateral close the directory queries the
  // relay, gets 'gone', and records the counterparty ABSENT — never self-asserted by A.
  it("B GONE (relay observed the disconnect) → counterparty recorded ABSENT", async () => {
    const { connA, daemonB, sessionIdA } = await setupAtoBSession("liveabs");

    // B crashes (SIGKILL). Its standing relay stream drops.
    await daemonB.kill();
    // The seal's ABSENT verdict must come from a POSITIVE relay observation — wait for the
    // relay to log the gone transition BEFORE A closes (otherwise the relay still reads 'alive').
    await cluster.relay.waitForLine(/"liveness":"gone"/, 30_000);

    const close = (await connA.call("cello_close_session", { session_id: sessionIdA })) as {
      ok?: boolean; sealed_root?: string; seal_type?: string; reason?: string;
    };
    const diag =
      `\nclose: ${JSON.stringify(close)}` +
      `\n--- directory attestation/notarized ---\n${cluster.directory.output.split("\n").filter((l) => /attestation|notarized|liveness/i.test(l)).slice(-12).join("\n")}` +
      `\n--- relay liveness ---\n${cluster.relay.output.split("\n").filter((l) => /liveness/i.test(l)).slice(-8).join("\n")}`;

    expect(close.ok, `A unilateral close must succeed:${diag}`).toBe(true);
    expect(close.seal_type, `seal_type must be unilateral:${diag}`).toBe("unilateral");
    // The directory consulted the relay and got 'gone' → ABSENT (not self-asserted).
    expect(cluster.directory.output, `directory must record liveness gone:${diag}`).toMatch(/"event":"session\.unilateral\.attestation"[^}]*"liveness":"gone"/);
    expect(cluster.directory.output, `attestation must be ABSENT:${diag}`).toMatch(/"event":"session\.unilateral\.attestation"[^}]*"attestation":"ABSENT"/);
    expect(cluster.directory.output, `notarized must record ABSENT:${diag}`).toMatch(/"event":"session\.unilateral\.notarized"[^}]*"attestation":"ABSENT"/);
    // The relay positively observed B (${pubB}) gone — never fabricated.
    expect(cluster.relay.output, `relay must have observed B gone:${diag}`).toMatch(/"liveness":"gone"/);
  }, 120_000);

  // alive-but-silent AGENT → BILATERAL via auto-acknowledge (UPGRADE-002 supersedes the old
  // unilateral-DELIVERED outcome). B stays up; its AGENT never calls close. Pre-UPGRADE-002 this
  // degraded to a unilateral seal (B's liveness only colouring the attestation DELIVERED). NOW B's
  // NODE auto-co-signs the responder SEAL leaf the moment it ingests A's SEAL ctrl leaf, so the
  // seal completes BILATERAL — and the DOD-LIVE-2 invariant (an alive B is NEVER sealed ABSENT) is
  // preserved even more strongly: B SIGNED, so there is no unilateral notarization marking it absent.
  it("B ALIVE but its agent never closes → B's NODE auto-acks → BILATERAL seal, B never recorded ABSENT", async () => {
    const { connA, daemonB, sessionIdA, pubB } = await setupAtoBSession("livedel");

    // B is alive the whole time — do NOT kill it, and B's agent issues NO close call.
    expect(daemonB.output, "B daemon should be running (not killed)").toMatch(/daemon\.started/);

    const close = (await connA.call("cello_close_session", { session_id: sessionIdA })) as {
      ok?: boolean; sealed_root?: string; seal_type?: string; reason?: string;
    };
    const diag =
      `\nclose: ${JSON.stringify(close)}` +
      `\n--- daemonB autoack ---\n${daemonB.output.split("\n").filter((l) => /autoack|autoacknowledg|seal/i.test(l)).slice(-10).join("\n")}` +
      `\n--- directory attestation/notarized ---\n${cluster.directory.output.split("\n").filter((l) => /attestation|notarized|liveness/i.test(l)).slice(-12).join("\n")}`;

    // UPGRADE-002: an alive, verified B no longer degrades to a unilateral seal on a silent agent —
    // its node auto-co-signs, so the seal is BILATERAL (seal_type is NOT 'unilateral').
    expect(close.ok, `A close must succeed (B auto-acks):${diag}`).toBe(true);
    expect(close.sealed_root, `A must surface a sealed_root:${diag}`).toMatch(/^[0-9a-f]{64}$/);
    expect(close.seal_type, `alive B auto-acks → BILATERAL, never unilateral:${diag}`).not.toBe("unilateral");
    expect(daemonB.output, `B's daemon must auto-acknowledge:${diag}`).toMatch(/session\.seal\.autoacknowledged/);
    // DOD-LIVE-2 invariant PRESERVED: an alive B is NEVER sealed ABSENT — here it SIGNED (bilateral),
    // so there is no unilateral notarization marking B absent for this session.
    expect(cluster.directory.output, `alive B must never be marked ABSENT for this session:${diag}`).not.toMatch(new RegExp(`"absentPartyPubkey":"${pubB.slice(0, 8)}[^}]*"attestation":"ABSENT"`));
  }, 120_000);
});
