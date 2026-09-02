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
  writeConsortiumManifest,
  AUTH_DIRECTORY_NODE_ID,
  AUTH_DIRECTORY_NODE_KEY_HEX,
  AUTH_DIRECTORY_NODE_PUBKEY,
  type SpineCluster,
  type Proc,
  type McpConn,
  type ManifestEnv,
} from "./live-harness.js";

let cluster: SpineCluster;
/**
 * Both daemons need a manifest that NAMES the directory, or `cello_initiate_session` refuses with
 * `home_node_not_in_reachable_roster` before the experiment starts — the counterparty's home node
 * is not in a roster the daemon was never given.
 */
let manifestEnv: ManifestEnv;
const daemons: Proc[] = [];
const agentDirs: string[] = [];
const mcpConns: McpConn[] = [];

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Everything the run establishes, printed as one block at the end so the answers are quotable. */
const RECORD: string[] = [];
const record = (q: string, answer: unknown): void => {
  const text = typeof answer === "string" ? answer : JSON.stringify(answer);
  RECORD.push(`${q}: ${text}`);
  // This file's OUTPUT is its deliverable — the answers are read off the run, not off an assertion.
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
  cluster = await startSpineCluster({
    relayIngressProxy: true,
    directoryNodeKeyHex: AUTH_DIRECTORY_NODE_KEY_HEX,
  });
  manifestEnv = writeConsortiumManifest(cluster.tmpDir, "j-relayloss", [{
    nodeId: AUTH_DIRECTORY_NODE_ID,
    pubkey: AUTH_DIRECTORY_NODE_PUBKEY,
    region: "local",
    provider: "aws",
    endpoint: cluster.directoryUrl,
  }]);
}, 300_000);

afterAll(async () => {
  for (const c of mcpConns) await c.close();
  for (const d of daemons) await d.stop();
  await cluster?.stop();
  for (const dir of agentDirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
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
    const daemonA = await startDaemon(dirA, cluster.directoryUrl, "relayloss-A", { manifestEnv });
    const daemonB = await startDaemon(dirB, cluster.directoryUrl, "relayloss-B", { manifestEnv });
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

    /**
     * ─── WAIT FOR A RESERVATION, do not merely observe its absence — review HIGH-3 ──────────────
     *
     * The first version read the reservation state once, found `retrying`, and concluded that a
     * loopback receiver never takes a circuit reservation at all, so questions 4 and 5 were
     * unanswerable here. **The same run refuted that**: by its last phase the very same receiver
     * reported `reserved`, and a killed relay produced a real `reservation.lost` — an event whose
     * only emitter is unreachable unless the receiver genuinely held one.
     *
     * The receiver does reserve on loopback. At the moment of the first read it had simply not been
     * granted one yet. That is a TIMING state, and reading it once turned a fifty-second head start
     * into a permanent conclusion about the topology — the shape this milestone keeps writing down,
     * where an absence is treated as an answer without proving the observation could see anything.
     *
     * So the run now WAITS for the reservation and then measures the black-hole gap, which is
     * exactly Part 1 question 4 and was answerable all along. Question 5 stays genuinely out of
     * reach: it asks about a DIFFERENT relay, and this harness runs one.
     */
    const reachOf = (): string => {
      const s = JSON.parse(cello(["status"], { CELLO_DIR: dirA }).stdout) as
        { agents?: Array<{ name?: string; standing_receiver_reachability?: string }> };
      return s.agents?.find((a) => a.name === "agentA")?.standing_receiver_reachability ?? "(absent)";
    };
    const firstReach = reachOf();
    const reserveDeadline = Date.now() + 180_000;
    while (reachOf() !== "reserved" && Date.now() < reserveDeadline) await sleep(2_000);
    const holdsReservation = reachOf() === "reserved";
    record("Q0 standing_receiver_reachability at first read", firstReach);
    record("Q0 standing_receiver_reachability after waiting", holdsReservation ? "reserved" : reachOf());
    record("Q4 measurable on this harness", holdsReservation
      ? "yes — the receiver holds a reservation to lose"
      : "no — the receiver never became reserved within 180s");
    record("Q5 measurable on this harness",
      "NO — question 5 asks about a DIFFERENT relay and this harness runs one. Answered from the production log.");

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
    /**
     * THE FIX'S TEETH, and the pair is what makes them teeth. `witnessed` must be TRUE on the send
     * the relay really witnessed and FALSE on the one it did not — asserted against the same relay,
     * minutes apart, with nothing between them but the outage. A test that only ever saw the false
     * case would be satisfied by a hardcoded false; this one would not.
     */
    expect(healthySend["witnessed"], `the witnessed send must say so: ${JSON.stringify(healthySend)}`).toBe(true);
    expect(outageSend["witnessed"], `the unwitnessed send must say so: ${JSON.stringify(outageSend)}`).toBe(false);
    expect(String(outageSend["guidance"] ?? ""), "and must tell the operator what it means")
      .toMatch(/did not witness/i);

    /**
     * CONTROL, and the one the whole run rests on. The black hole reached the client if and only if
     * a send that was witnessed before the outage is unwitnessed after it. This replaces
     * `reservation.lost` as the control precisely because that event cannot fire on loopback — an
     * absence there would have proved nothing about the proxy, which is the trap this avoids.
     */
    expect(outageUnwitnessed, "the outage must actually reach the client: the send must go unwitnessed")
      .toBeGreaterThan(healthyUnwitnessed);

    // Q6 — what is the operator told, and when? `cello status` is the surface they have.
    const statusDuring = cello(["status"], { CELLO_DIR: dirA }).stdout.trim();
    record("Q6 cello status ~immediately after the relay died", statusDuring.slice(0, 900));

    /**
     * Q4a — THE SILENT WINDOW for the black-hole shape: how long the agent is unreachable while
     * still looking healthy. This is the number Part 1 question 4 asks for, and the first version
     * of this journey declined to measure it on a premise its own last phase refuted.
     */
    if (holdsReservation) {
      const lost = await waitForEventAfter(daemonA, /session\.standing_receiver\.reservation\.lost/, t0, 150_000);
      record("Q4a ms from a MUTE relay to reservation.lost (the silent window)", lost?.waitedMs ?? "NEVER within 150s");
      record("Q4a the lost event", lost?.raw ?? "(none)");
      // CONTROL for this number specifically: an absence here would mean the receiver was never
      // watched, not that the daemon was silent — and those read identically in a log.
      expect(lost, "a receiver that HELD a reservation must notice the relay going mute").not.toBeNull();
      const rebuilt = await waitForEventAfter(daemonA, /session\.standing_receiver\.reachability/, t0, 90_000);
      record("Q4a rebuild attempt after the loss", rebuilt?.raw ?? "(no rebuild observed within 90s)");
    } else {
      record("Q4a ms from a MUTE relay to reservation.lost", "not measured — the receiver never became reserved");
    }
    record("Q5 rebuild against a different relay", "not measurable here — this harness runs ONE relay");

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

    /**
     * Q4b — the RECOVERY half, measured on the WITNESS path rather than the circuit.
     *
     * The circuit is not available to measure here (see the Q4/Q5 note), and the witness path is
     * the one this journey's other answers depend on: if a send is witnessed again, the client
     * re-established its relay stream. It is also the question the operator actually has, which is
     * "is it working again", not "which libp2p address do I hold".
     */
    const awaitP2 = connB.call("cello_await_session", { timeout_ms: 90_000 });
    let init2 = (await connA.call("cello_initiate_session", { target_pubkey: pubB })) as typeof init;
    for (let i = 0; i < 40 && !init2.ok; i++) {
      await sleep(1_000);
      init2 = (await connA.call("cello_initiate_session", { target_pubkey: pubB })) as typeof init;
    }
    record("Q4b a NEW session could be opened after the relay came back", init2.ok === true ? "yes" : JSON.stringify(init2));
    expect(init2.ok, `no session after recovery: ${JSON.stringify(init2)}`).toBe(true);
    const inbound2 = (await awaitP2) as { session_id?: string };
    const beforeRecoverySend = daemonA.countLines(/session\.tree\.own_leaf_unwitnessed/);
    const recoverySend = (await connA.call("cello_send",
      { cello_session_id: init2.sessionId!, content: "after the outage", signal: "over" })) as Record<string, unknown>;
    expect(((await connB.call("cello_receive", { cello_session_id: inbound2.session_id!, timeout_ms: 30_000 })) as
      { content?: string | null }).content).toBe("after the outage [[OVER]]");
    await sleep(2_000);
    const recoveryUnwitnessed = daemonA.countLines(/session\.tree\.own_leaf_unwitnessed/) - beforeRecoverySend;
    record("Q4b ms from relay restored to a WITNESSED send", Date.now() - t1);
    record("Q4b the recovery send was witnessed", recoveryUnwitnessed === 0 ? "yes" : `NO — ${recoveryUnwitnessed} unwitnessed`);
    record("Q4b recovery send response", recoverySend);
    // CONTROL. Without recovery the run cannot separate "the outage broke it" from "it was already
    // broken", and every duration measured above would have no upper end.
    expect(recoveryUnwitnessed, "the witness path must work again once the relay answers").toBe(0);

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

    /**
     * Q3c — THE QUESTION THAT SETS THE SEVERITY, and it is not the same as Q3b.
     *
     * "It did not seal on its own" and "the receipt is gone" are very different products, and only
     * one of them is a launch blocker. B's close was REFUSED during the outage with
     * `relay_submit_timeout` and guidance saying to retry once the relay is reachable — so the
     * receipt may be one manual step away rather than lost. Nothing retries it automatically; this
     * measures whether the step the guidance names actually works.
     */
    const reclose = (await connB.call("cello_close_session", { cello_session_id: sidB })) as Record<string, unknown>;
    record("Q3c B re-closes after recovery (the remedy its own guidance named)", reclose);
    let sealedRetry: unknown = "(never)";
    const retryDeadline = Date.now() + 150_000;
    while (Date.now() < retryDeadline) {
      const r = (await connA.call("cello_sealed_receipt", { cello_session_id: sidA })) as
        { ok?: boolean; sealed_root?: string };
      sealedRetry = r;
      if (r.ok === true && typeof r.sealed_root === "string") break;
      await sleep(2_000);
    }
    const rootRetry = (sealedRetry as { sealed_root?: string }).sealed_root;
    record("Q3c DOES A MANUAL RE-CLOSE RECOVER THE RECEIPT",
      typeof rootRetry === "string" ? `YES ${rootRetry}` : "NO — the receipt is not recoverable by re-closing");
    record("Q3c last sealed-receipt answer after the re-close", sealedRetry);

    // ─── PHASE 5 — the other kill shape, for contrast: the process is genuinely gone ────────────
    // A close, not a black hole. Recorded separately because the two are different incidents and
    // the order asks which was tested.
    // Read the reservation state FIRST. The baseline had none; if the receiver acquired one by now
    // the kill can measure a real loss, and the number below means what it says rather than being
    // attributed to a state nobody checked.
    /**
     * ─── Q4 IS ASKED HERE, WHERE THE RESERVATION EXISTS ────────────────────────────────────────
     *
     * The receiver does not hold a circuit reservation for the first minutes of its life — measured,
     * not assumed: the wait at the top of this run timed out at `retrying`, and by this phase the
     * same receiver reports `reserved`. So the black hole at t0 could not measure a reservation
     * loss, and asking there produced "not measured" rather than a number.
     *
     * The question does not change with the clock, so it is asked at the point where it can be
     * answered. Both shapes are measured back to back against the SAME reserved receiver, which is
     * the comparison the order asks for when it says to say which kill you tested: a mute relay has
     * to be discovered by a timeout, a killed one closes its sockets and announces itself.
     */
    const preDeadline = Date.now() + 240_000;
    while (reachOf() !== "reserved" && Date.now() < preDeadline) await sleep(3_000);
    const reservedNow = reachOf() === "reserved";
    record("Q4 standing_receiver_reachability before the timed kills", reservedNow ? "reserved" : reachOf());

    if (reservedNow) {
      // (a) MUTE: sockets open, nothing answers. The incident shape.
      const tMute = Date.now();
      cluster.relayIngress!.blackhole();
      const lostMute = await waitForEventAfter(daemonA, /session\.standing_receiver\.reservation\.lost/, tMute, 180_000);
      record("Q4 ms from a MUTE relay to the daemon noticing (the silent window)",
        lostMute?.waitedMs ?? "NEVER within 180s");
      record("Q4 the lost event on the mute path", lostMute?.raw ?? "(none)");
      expect(lostMute, "a reserved receiver must eventually notice a relay that went mute").not.toBeNull();
      cluster.relayIngress!.restore();
      // Let it re-reserve, so the kill below is measured from the same starting state.
      const reDeadline = Date.now() + 240_000;
      while (reachOf() !== "reserved" && Date.now() < reDeadline) await sleep(3_000);
      record("Q4 reachability after restoring the relay", reachOf());
    } else {
      record("Q4 ms from a MUTE relay to the daemon noticing", "not measured — receiver never reserved");
    }

    // (b) KILLED: the process is gone for everyone and the sockets close.
    record("Q4c standing_receiver_reachability just before the kill", reachOf());
    const t2 = Date.now();
    await cluster.relay.kill();
    record("T2 relay process SIGKILLed at", new Date(t2).toISOString());
    const lostAfterKill = await waitForEventAfter(daemonA, /session\.standing_receiver\.reservation\.lost/, t2, 120_000);
    record("Q4c ms from a KILLED relay process to reservation.lost", lostAfterKill?.waitedMs ?? "NEVER within 120s");
    record("Q4c reader-ended cause on the kill path",
      events(daemonA, /session\.relay\.reader\.ended/).at(-1)?.raw ?? "(never logged)");
  }, 1_500_000);
});
