/**
 * J-RELAYLOSS — what actually happens when a relay goes away (`016-RELAYLOSS`).
 *
 * ─── This file is an EXPERIMENT, and that is deliberate ────────────────────────────────────────
 *
 * Two open lines say the same thing from opposite ends: can an agent still be REACHED when its
 * relay dies, and does a live CONVERSATION survive it. Both were written "measure first" and
 * neither had been measured, so this journey does not encode an expectation about what breaks. It
 * kills a relay in the middle of a real conversation between two real daemons and RECORDS what the
 * operator gets, in `RECORD` lines the run prints.
 *
 * The assertions here are therefore of two kinds and they are not interchangeable:
 *   - **Controls.** The baseline worked; the outage was real; the recovery happened. Without these
 *     every recorded number is unattributable — an empty result is evidence only once the search is
 *     shown capable of finding something.
 *   - **Findings.** Asserted only where the run established the same answer on the shape that
 *     matters. Anything the run could not settle is printed and stated, never asserted into a shape.
 *
 * ─── The outage is a BLACK HOLE, not a kill, and that is the whole point ───────────────────────
 *
 * `RelayIngress` in the harness carries the reasoning: a killed process closes its sockets and the
 * client takes the fast path, which is the recoverable blip and not the incident. Phase 5 kills the
 * process as well, so both shapes are on the record.
 *
 * ⚠️ **The black hole is CLIENT-FACING ONLY.** `relay_register` hands the directory the relay's own
 * listen address, so the directory→relay control path does not run through the proxy and stays up
 * through the outage. Every outcome measured here is therefore the OPTIMISTIC one.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  startSpineCluster,
  startDaemon,
  provisionAgent,
  registerAgent,
  connectMcp,
  cello,
  type SpineCluster,
  type Proc,
  type McpConn,
} from "./live-harness.js";

let cluster: SpineCluster;
const daemons: Proc[] = [];
const agentDirs: string[] = [];
const mcpConns: McpConn[] = [];

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Everything the run establishes, printed as one block at the end so the answers are quotable. */
const RECORD: string[] = [];
const record = (q: string, answer: unknown): void => {
  const text = typeof answer === "string" ? answer : JSON.stringify(answer);
  RECORD.push(`${q}: ${text}`);
  // eslint-disable-next-line no-console -- this file's OUTPUT is its deliverable; it is not shipped code.
  console.log(`RECORD ${q}: ${text}`);
};

/** Every structured log line a proc emitted whose event matches, with its own timestamp parsed. */
function events(proc: Proc, re: RegExp): Array<{ ts: number; event: string; raw: string }> {
  const out: Array<{ ts: number; event: string; raw: string }> = [];
  for (const line of proc.output.split("\n")) {
    if (!re.test(line)) continue;
    let o: { ts?: string; event?: string };
    try { o = JSON.parse(line) as typeof o; } catch { continue; }
    if (!o.ts || !o.event) continue;
    out.push({ ts: Date.parse(o.ts), event: o.event, raw: line });
  }
  return out;
}

/**
 * Wait for a log event STAMPED AFTER `sinceMs`, and return how long that took.
 *
 * The window matters more than it looks: every event here fires many times over a run, so matching
 * the backlog would return one from a previous phase and report a delay of zero for something that
 * had not happened yet. Filtering on the line's OWN timestamp is what makes the number a
 * measurement rather than a coincidence.
 */
async function waitForEventAfter(
  proc: Proc,
  re: RegExp,
  sinceMs: number,
  timeoutMs: number,
): Promise<{ waitedMs: number; raw: string } | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const hit = events(proc, re).find((e) => e.ts >= sinceMs);
    if (hit) return { waitedMs: hit.ts - sinceMs, raw: hit.raw };
    if (Date.now() >= deadline) return null;
    await sleep(250);
  }
}

beforeAll(async () => {
  cluster = await startSpineCluster({ relayIngressProxy: true });
}, 300_000);

afterAll(async () => {
  for (const c of mcpConns) await c.close();
  for (const d of daemons) await d.stop();
  await cluster?.stop();
  for (const dir of agentDirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
  // eslint-disable-next-line no-console -- the deliverable, gathered in one place for the write-up.
  console.log(`\n===== 016-RELAYLOSS ANSWERS =====\n${RECORD.join("\n")}\n=================================`);
});

describe("J-RELAYLOSS — kill a relay mid-conversation and watch (016-RELAYLOSS)", () => {
  it("records what an operator gets when their relay stops answering", async () => {
    // ─── Two real daemons, two OS processes, one session ────────────────────────────────────────
    const dirA = mkdtempSync(join(tmpdir(), "cello-relayloss-A-"));
    const dirB = mkdtempSync(join(tmpdir(), "cello-relayloss-B-"));
    agentDirs.push(dirA, dirB);
    await provisionAgent(dirA, "agentA");
    const pubB = await provisionAgent(dirB, "agentB");
    const daemonA = await startDaemon(dirA, cluster.directoryUrl, "relayloss-A");
    const daemonB = await startDaemon(dirB, cluster.directoryUrl, "relayloss-B");
    daemons.push(daemonA, daemonB);
    expect(registerAgent("agentA", `DEV-relayloss-A-${randomBytes(6).toString("hex")}`, { CELLO_DIR: dirA }).status).toBe(0);
    expect(registerAgent("agentB", `DEV-relayloss-B-${randomBytes(6).toString("hex")}`, { CELLO_DIR: dirB }).status).toBe(0);

    const connA = await connectMcp(dirA, "relayloss-A");
    const connB = await connectMcp(dirB, "relayloss-B");
    mcpConns.push(connA, connB);
    for (const [conn, name] of [[connA, "agentA"], [connB, "agentB"]] as const) {
      expect(((await conn.call("cello_start_agent", { name })) as { ok?: boolean }).ok).toBe(true);
      expect(((await conn.call("cello_use_agent", { name })) as { ok?: boolean }).ok).toBe(true);
    }

    const awaitP = connB.call("cello_await_session", { timeout_ms: 30_000 });
    let init = (await connA.call("cello_initiate_session", { target_pubkey: pubB })) as
      { ok?: boolean; sessionId?: string; reason?: string };
    for (let i = 0; i < 20 && !init.ok && init.reason === "standing_receiver_unavailable"; i++) {
      await sleep(300);
      init = (await connA.call("cello_initiate_session", { target_pubkey: pubB })) as typeof init;
    }
    expect(init.ok, `initiate failed: ${JSON.stringify(init)}`).toBe(true);
    const sidA = init.sessionId!;
    const inbound = (await awaitP) as { type?: string; session_id?: string };
    expect(inbound.type, `B must accept: ${JSON.stringify(inbound)}`).toBe("new_session");
    const sidB = inbound.session_id!;

    // ─── PHASE 1 — baseline. Whatever the outage costs is measured against THIS. ────────────────
    const healthySend = (await connA.call("cello_send",
      { cello_session_id: sidA, content: "before the outage", signal: "over" })) as Record<string, unknown>;
    expect(healthySend["ok"], `healthy send failed: ${JSON.stringify(healthySend)}`).toBe(true);
    expect(((await connB.call("cello_receive", { cello_session_id: sidB, timeout_ms: 20_000 })) as
      { content?: string | null }).content).toBe("before the outage [[OVER]]");
    await sleep(1_500);
    const healthyUnwitnessed = daemonA.countLines(/session\.tree\.own_leaf_unwitnessed/);
    record("Q0 healthy send response", healthySend);
    record("Q0 healthy send: own_leaf_unwitnessed count", healthyUnwitnessed);
    // CONTROL. Every later count of this event is read as evidence the leaf was NOT witnessed; that
    // reading is worthless unless the healthy path is silent here first.
    expect(healthyUnwitnessed, "baseline: a witnessed send must not log own_leaf_unwitnessed").toBe(0);

    // ─── PHASE 2 — the relay stops answering ───────────────────────────────────────────────────
    const t0 = Date.now();
    cluster.relayIngress!.blackhole();
    record("T0 relay black-holed at", new Date(t0).toISOString());

    // Q1 — does the send succeed, park, stall, or fail? And how long does the operator wait for it?
    const sendStart = Date.now();
    const outageSend = (await connA.call("cello_send",
      { cello_session_id: sidA, content: "during the outage", signal: "over" })) as Record<string, unknown>;
    const sendMs = Date.now() - sendStart;
    record("Q1 send during outage: elapsed ms", sendMs);
    record("Q1 send during outage: FULL response", outageSend);

    // Q1b — did the content reach the counterparty anyway? The direct path does not use the relay.
    const outageRecv = (await connB.call("cello_receive",
      { cello_session_id: sidB, timeout_ms: 30_000 })) as { content?: string | null };
    record("Q1b counterparty received it during the outage", outageRecv.content ?? null);

    // Q2 — was it witnessed, and does anything SAY so? The daemon's own answer, not an inference.
    await sleep(2_000);
    const outageUnwitnessed = daemonA.countLines(/session\.tree\.own_leaf_unwitnessed/);
    record("Q2 own_leaf_unwitnessed count after the outage send", outageUnwitnessed);
    const unwitnessedLine = events(daemonA, /session\.tree\.own_leaf_unwitnessed/).at(-1);
    record("Q2 the daemon's own words", unwitnessedLine?.raw ?? "(never logged)");
    // Q2b — the operator surface. Does anything they can READ name the missing witness?
    record("Q2b does the send response name the missing witness",
      JSON.stringify(outageSend).includes("witness") ? "yes" : "NO — the word 'witness' is absent from the response");

    // Q6/Q4 — what is the operator told, and when? `cello status` is the surface they have.
    const statusDuring = cello(["status"], { CELLO_DIR: dirA }).stdout.trim();
    record("Q6 cello status ~immediately after the relay died", statusDuring.slice(0, 900));

    // Q4a — the SILENT window: relay death → the daemon noticing. The watchdog ticks every 30s.
    const lost = await waitForEventAfter(daemonA, /session\.standing_receiver\.reservation\.lost/, t0, 120_000);
    record("Q4a ms from relay death to reservation.lost (the silent window)", lost?.waitedMs ?? "NEVER within 120s");
    record("Q4a the lost event", lost?.raw ?? "(none)");
    // CONTROL. If this never fires the black hole did not reach the client and every number above
    // describes a healthy relay. The whole experiment rests on this one.
    expect(lost, "the client must eventually notice a relay that stopped answering").not.toBeNull();

    // Q5 — the rebuild fires. With the fleet's only relay in the hole, does it get a reservation?
    const rebuilt = await waitForEventAfter(daemonA, /session\.standing_receiver\.reachability/, lost!.waitedMs + t0, 90_000);
    record("Q5 rebuild attempt after the loss", rebuilt?.raw ?? "(no rebuild observed within 90s)");
    const noneAfterLoss = await waitForEventAfter(daemonA, /session\.standing_receiver\.reservation\.none/, t0, 5_000);
    record("Q5 did the rebuild end with NO reservation", noneAfterLoss ? "yes — reservation.none" : "no reservation.none seen");
    const statusUnreachable = cello(["status"], { CELLO_DIR: dirA }).stdout.trim();
    record("Q6 cello status once the loss was noticed", statusUnreachable.slice(0, 900));

    // ─── PHASE 3 — THE SEVERITY QUESTION. Can the conversation still be closed and sealed? ──────
    // Both parties close while the relay is a black hole. This is the one that decides whether a
    // dead relay is a papercut or the loss of the product's whole output.
    const closeStart = Date.now();
    const [closeA, closeB] = (await Promise.all([
      connA.call("cello_close_session", { cello_session_id: sidA }),
      connB.call("cello_close_session", { cello_session_id: sidB }),
    ])) as Array<Record<string, unknown>>;
    record("Q3 close during outage: elapsed ms", Date.now() - closeStart);
    record("Q3 close during outage: A's FULL response", closeA);
    record("Q3 close during outage: B's FULL response", closeB);

    // The receipt IS the product. Poll for it while the relay is still gone.
    let sealedDuring: unknown = "(never)";
    const sealDeadline = Date.now() + 45_000;
    while (Date.now() < sealDeadline) {
      const r = (await connA.call("cello_sealed_receipt", { cello_session_id: sidA })) as
        { ok?: boolean; sealed_root?: string };
      sealedDuring = r;
      if (r.ok === true && typeof r.sealed_root === "string") break;
      await sleep(1_000);
    }
    const sealedWhileDown = typeof (sealedDuring as { sealed_root?: string }).sealed_root === "string";
    record("Q3 DID IT SEAL WHILE THE RELAY WAS GONE", sealedWhileDown ? "YES" : "NO — no sealed_root within 45s");
    record("Q3 last sealed-receipt answer during the outage", sealedDuring);

    // ─── PHASE 4 — the relay comes back ────────────────────────────────────────────────────────
    const t1 = Date.now();
    cluster.relayIngress!.restore();
    record("T1 relay restored at", new Date(t1).toISOString());

    // Q4b — the RECOVERY half of the reachability gap: relay answering again → a working circuit.
    const reserved = await waitForEventAfter(
      daemonA, /"event":"session\.standing_receiver\.reachability".*"circuitAddrs":[1-9]/, t1, 180_000);
    record("Q4b ms from relay restored to a working circuit again", reserved?.waitedMs ?? "NEVER within 180s");
    record("Q4b the recovered reachability event", reserved?.raw ?? "(none)");
    // CONTROL. Without recovery the run cannot separate "the outage broke it" from "it was already
    // broken", and the total gap in Q4 would have no upper end.
    expect(reserved, "the standing receiver must recover once the relay answers again").not.toBeNull();
    record("Q4 TOTAL reachability gap ms (death → working circuit)", (reserved!.waitedMs + (t1 - t0)));

    // Q3b — does the seal that could not complete during the outage complete AFTER recovery?
    let sealedAfter: unknown = "(never)";
    const afterDeadline = Date.now() + 120_000;
    while (Date.now() < afterDeadline) {
      const r = (await connA.call("cello_sealed_receipt", { cello_session_id: sidA })) as
        { ok?: boolean; sealed_root?: string };
      sealedAfter = r;
      if (r.ok === true && typeof r.sealed_root === "string") break;
      await sleep(1_500);
    }
    const rootAfter = (sealedAfter as { sealed_root?: string }).sealed_root;
    record("Q3b DID THE SEAL COMPLETE ONCE THE RELAY CAME BACK", typeof rootAfter === "string" ? `YES ${rootAfter}` : "NO");
    record("Q3b last sealed-receipt answer after recovery", sealedAfter);

    // ─── PHASE 5 — the other kill shape, for contrast: the process is genuinely gone ────────────
    // A close, not a black hole. Recorded separately because the two are different incidents and
    // the order asks which was tested.
    const t2 = Date.now();
    await cluster.relay.kill();
    record("T2 relay process SIGKILLed at", new Date(t2).toISOString());
    const lostAfterKill = await waitForEventAfter(daemonA, /session\.standing_receiver\.reservation\.lost/, t2, 120_000);
    record("Q4c ms from a KILLED relay process to reservation.lost", lostAfterKill?.waitedMs ?? "NEVER within 120s");
    record("Q4c reader-ended cause on the kill path",
      events(daemonA, /session\.relay\.reader\.ended/).at(-1)?.raw ?? "(never logged)");
  }, 900_000);
});
