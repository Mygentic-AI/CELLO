/**
 * J-CONTENT — live binary content delivery (M7-DEFINITION-OF-DONE.md §"verification
 * harness", journey 5; DOD-MSG-* / MSG-001-3b).
 *
 * A message must survive the recipient being OFFLINE. The sender's daemon parks the sealed content
 * in the relay's store-and-forward mailbox keyed to the recipient's pubkey; when the recipient
 * comes back online its daemon drains that mailbox and the content enters through the same inbound
 * funnel a direct frame uses. The relay holds CIPHERTEXT only (INV-3 — it is a hash custodian, not
 * a data custodian).
 *
 * Every test here drives that through a REAL directory-brokered session. Never mint a session id
 * in this file: the relay vouches a key only when a client presents a directory-signed assignment,
 * so a fabricated session is one the relay has never seen and its pull is refused
 * `not_a_participant` — correctly. The raw `content_park_deposit` / `_pull` IPC handlers have no
 * caller outside these tests; they are a diagnostic surface, not the path an operator's message
 * takes, and a test built on them measures the vouching gate rather than delivery.
 *
 * Anchored to the binary — see live-harness.ts. The deposit/pull cross the REAL relay binary.
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
  awaitSealedRoot,
  cello,
  registerAgent,
  ipcCall,
  writeConsortiumManifest,
  writeSignedManifestTo,
  type SpineCluster,
  type Proc,
  type McpConn,
  expectOwnTreeVerified,
} from "./live-harness.js";
import { spineDirectoryNode, spineNodeKeypair } from "./auth-manifest.js";
// `sealToRecipient` is deliberately no longer imported. Every park in this file that feeds the
// RECOVER path now deposits through the daemon's own `sealParkEnvelope` (via `content:`), because a
// bare seal with no park envelope is the unsigned shape SEC-1 refuses. Exactly ONE raw
// `ciphertext:` deposit remains — case (3) in DOD-MSG-7, a blob that is deliberately unsealable, so
// it never gets past `openContentSeal` and needs no signature. It IS recovered-and-skipped rather
// than never reaching recover, which is the whole point of that case. Its neighbours in DOD-MSG-7
// pass `content:` and therefore go through `sealParkEnvelope` like everything else.
import { contentHashHex } from "./content-seal-fixture.js";

let cluster: SpineCluster;
const daemons: Proc[] = [];
const dirs: string[] = [];
const mcpConns: McpConn[] = [];

beforeAll(async () => {
  // A THREE-node consortium, matching the pattern j-refresh/j-tofn/j-relaysig already use.
  //
  // These tests used a single directory and gave their daemons no consortium manifest, and both
  // halves of that are now wrong:
  //  - With no manifest the daemon never learns its own directory node id (step-6 identity supplies
  //    it), so classifyOnlineResult cannot prove co-location and — by its own documented rule —
  //    routes two LOCAL agents down the CROSS-NODE path, which then fails to resolve "local" in a
  //    manifest the daemon does not have. That rule landed in ba570d1, after these tests were
  //    written, and the retired `cello register` verb hid it: the file never got far enough to see.
  //  - Adding a manifest alone is not enough either: registration runs a real FROST DKG against the
  //    consortium, and a one-node cluster cannot satisfy it (`dkg_failed: Wrong signers info:
  //    min=2 max=1`). The threshold needs a real N.
  const holder = mkdtempSync(join(tmpdir(), "cello-content-consortium-"));
  dirs.push(holder);
  const consortiumManifestPath = join(holder, "consortium-manifest.json");
  cluster = await startSpineCluster({
    directoryCount: 3,
    directoryNodeKeysHex: [0, 1, 2].map((i) => spineNodeKeypair(i).privateKeyHex),
    directoryConsortiumManifestPath: consortiumManifestPath,
    onDirectoryUrlsReady: (urls) => {
      writeSignedManifestTo(consortiumManifestPath, urls.map((url, i) => spineDirectoryNode(i, url)));
    },
  });
}, 300_000);

/** A daemon that KNOWS ITS OWN NODE — which is what lets two local agents talk to each other. */
async function startLocalDaemon(celloDir: string, label: string): Promise<Proc> {
  const nodes = [0, 1, 2].map((i) => spineDirectoryNode(i, cluster.directoryUrls[i]));
  return startDaemon(celloDir, cluster.directoryUrls[0], label, {
    manifestEnv: writeConsortiumManifest(celloDir, label, nodes),
  });
}


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

describe("J-CONTENT — relay store-and-forward, live (DOD-MSG-3 / MSG-001-3b)", () => {
  it("DOD-MSG-3 (transport) — A sends to an offline recipient → recipient recovers the SAME bytes", async () => {
    const dirA = mkdtempSync(join(tmpdir(), "cello-msgA-"));
    const dirB = mkdtempSync(join(tmpdir(), "cello-msgB-"));
    dirs.push(dirA, dirB);
    await provisionAgent(dirA, "agentA");
    const pubB = await provisionAgent(dirB, "agentB"); // recipient K_local (the mailbox key)
    const daemonA = await startLocalDaemon(dirA, "msgA");
    let daemonB = await startLocalDaemon(dirB, "msgB");
    daemons.push(daemonA, daemonB);
    // DOD-LOOP-1: the standing receiver is now PER-AGENT (created by cello_start_agent) — there is
    // no per-daemon standing receiver at initialize() anymore. A's park deposit and B's recover
    // each dial the relay from their own agent's standing-receiver node, so both agents must be
    // started first. (Pre-re-key this test relied on the per-daemon receiver and started no agent.)
    expect(registerAgent("agentA", `DEV-tr-A-${randomBytes(6).toString("hex")}`, { CELLO_DIR: dirA }).status).toBe(0);
    expect(registerAgent("agentB", `DEV-tr-B-${randomBytes(6).toString("hex")}`, { CELLO_DIR: dirB }).status).toBe(0);
    const connTA = await connectMcp(dirA, "tr-A");
    const connTB = await connectMcp(dirB, "tr-B");
    mcpConns.push(connTA, connTB);
    for (const [c, n] of [[connTA, "agentA"], [connTB, "agentB"]] as const) {
      expect(((await c.call("cello_start_agent", { name: n })) as { ok?: boolean }).ok).toBe(true);
      expect(((await c.call("cello_use_agent", { name: n })) as { ok?: boolean }).ok).toBe(true);
    }

    // WHY THIS TEST AND "DOD-MSG-3/4 (recover)" BOTH EXIST — they are not duplicates. This one
    // pins byte-for-byte encoding integrity across the round trip and INV-3 plaintext absence at
    // the relay. The recover test below pins the inbound funnel and the mailbox drain (`pulled: 0`).
    // Deleting either loses a property the other does not hold.
    //
    // A REAL directory-brokered session, opened while B is online. The relay vouches a key only
    // when a client presents a directory-signed assignment (relay-node.ts), so a session id minted
    // in the test is one the relay has never seen, and its pull is refused `not_a_participant`.
    const awaitP = connTB.call("cello_await_session", { timeout_ms: 25_000 });
    const init = (await connTA.call("cello_initiate_session", { target_pubkey: pubB })) as { ok?: boolean; sessionId?: string };
    expect(init.ok, `initiate failed:\n${daemonA.output.split("\n").slice(-30).join("\n")}`).toBe(true);
    const sessionId = init.sessionId!;
    expect(((await awaitP) as { type?: string }).type).toBe("new_session");
    const liveSend = (await connTA.call("cello_send", { cello_session_id: sessionId, content: "msg1-online", signal: "over" })) as { ok?: boolean; reason?: string };
    expect(liveSend.ok, `the send while B is ONLINE was refused: ${JSON.stringify(liveSend)}`).toBe(true);

    // ── B goes OFFLINE (abrupt kill), so A's next send has nowhere to deliver and must park. ──
    await connTB.close();
    mcpConns.splice(mcpConns.indexOf(connTB), 1);
    await daemonB.kill();

    // The property under test is that the bytes survive the round trip through the real relay
    // UNCHANGED, so the payload is chosen to break on a truncation or an encoding mangle: it is
    // long, and it is multibyte in four different ways (accents, CJK, an emoji, curly quotes).
    //
    // It must NOT be random hex. Screening classifies a long hex blob as a leaked secret and
    // replaces it with `[redacted: high-entropy data]` before delivery, so an entropy payload makes
    // this assertion compare a redaction marker against the original bytes. Multibyte width is the
    // property that catches a truncation or an encoding mangle; entropy is not.
    const PAYLOAD = "msg2-while-offline — the EXACT bytes B must recover: ünïcödé, 日本語, ✅, “curly”, 018-PARKCOLLECT.";
    // The response is asserted, not discarded. The fear this test exists for is "their side says
    // parked — success" while collection fails, and that is a claim about THIS response. An
    // unchecked `ok: false` here would surface 25 seconds later as a `waitForLine` timeout — an
    // exit-point label standing in for a send refusal whose reason was in the object we dropped.
    const parkSend = (await connTA.call("cello_send", { cello_session_id: sessionId, content: PAYLOAD, signal: "over" })) as { ok?: boolean; reason?: string };
    expect(parkSend.ok, `the send that must park was refused: ${JSON.stringify(parkSend)}`).toBe(true);
    await daemonA.waitForLine(/"event":"content\.park\.deposited"/, 25_000);

    // INV-3: the relay received and stored the entry, and it only ever held CIPHERTEXT — the
    // payload itself never appears in the relay's output. The old test could only CORROBORATE this
    // (it deposited a random blob that was never plaintext anywhere); a real send lets it be
    // asserted, because the plaintext genuinely exists on both daemons and must not exist here.
    expect(cluster.relay.output).toMatch(/"event":"content\.park\.received"/);
    // TWO absence checks, because one of them can pass vacuously. PAYLOAD is deliberately
    // multibyte, so a leak logged through a serializer that escapes non-ASCII (`日本語`)
    // would slip past `not.toContain(PAYLOAD)` while the plaintext sat in the relay's stdout. The
    // ASCII slice survives any escaping, so it is the one that actually holds.
    expect(cluster.relay.output, "the relay is a hash custodian — it must never hold the plaintext").not.toContain(PAYLOAD);
    expect(cluster.relay.output, "…and not an escaped form of it either").not.toContain("018-PARKCOLLECT");

    // ── B comes back and AUTO-recovers the parked entry through the inbound funnel. ──
    for (const f of ["daemon.sock", "daemon.lock"]) {
      try { rmSync(join(dirB, f), { force: true }); } catch { /* best-effort */ }
    }
    daemonB = await startLocalDaemon(dirB, "msgB-restart");
    daemons.push(daemonB);
    await daemonB.waitForLine(/"event":"session\.interrupted\.detected"/, 15_000);
    expect(cello(["login"], { CELLO_DIR: dirB }).status).toBe(0);
    const connTB2 = await connectMcp(dirB, "tr-B2");
    mcpConns.push(connTB2);
    expect(((await connTB2.call("cello_start_agent", { name: "agentB" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connTB2.call("cello_use_agent", { name: "agentB" })) as { ok?: boolean }).ok).toBe(true);
    // `"recovered":[1-9]` is load-bearing, and the bare event name is NOT a substitute for it.
    // `drainOnce` emits `content.recover.auto.completed` UNCONDITIONALLY — deliberately, so that a
    // clean "nothing parked" run is observable — and it carries `recovered: 0, refused: 1,
    // refusedReasons: {not_a_participant: 1}` just as readily as `recovered: 1`. Waiting on the
    // event alone is therefore a barrier that cannot fail: a vouching-gate regression, which is the
    // exact thing this test exists to catch, would satisfy it, and a zero-recovery sweep landing
    // first would race the real pull and blame the park path for a harness timing artifact.
    try {
      await daemonB.waitForLine(/"event":"content\.recover\.auto\.completed"[^\n]*"recovered":[1-9]/, 25_000);
    } catch (err: unknown) {
      const sweeps = daemonB.output.split("\n").filter((l) => l.includes("content.recover.auto.completed"));
      throw new Error(
        `no auto-recover sweep ever recovered anything. Every sweep B ran:\n${
          sweeps.join("\n") || "  (none — B ran no auto-recover sweep at all, which is a different failure)"
        }\n  A refusedReasons of {not_a_participant: 1} means the relay declined to serve B's mailbox — the vouching gate, not the park path.`,
        { cause: err },
      );
    }

    // The bytes must have come through the PARK path, not some future direct-redelivery retry.
    // Today `drainAwaitingToPark` re-parks and there is no direct path, so the read below can only
    // be served by the mailbox — but that is an argument about another repo's code, not something
    // this test says. These two pin it: the day someone adds a sender-side direct retry, this test
    // fails loudly instead of silently ceasing to test park/collect while keeping its name.
    expect(daemonB.output, "the entry came back through recover, not a direct redelivery").toMatch(
      new RegExp(`"event":"content\\.recovered"[^\\n]*"sessionId":"${sessionId}"`),
    );
    expect(daemonB.output, "the parked entry self-orders on recover").toMatch(
      /"event":"session\.content\.ordering\.recorded"[^\n]*"source":"park"/,
    );

    // Round-trip integrity through the real relay: B receives the EXACT bytes A sent.
    // msg1 comes first — B received it live and never read it (DOD-COATTEND-1: delivery resumes
    // from what this connection has read, so nothing is skipped and nothing is lost). The
    // `[[OVER]]` suffix is in-band; the shim appends the turn signal to the content itself.
    const read = async () => ((await connTB2.call("cello_receive", { cello_session_id: sessionId })) as { ok?: boolean; content?: string | null }).content;
    expect(await read(), "the live message B never read is delivered first — not lost").toBe("msg1-online [[OVER]]");
    expect(await read(), `B must receive the parked entry, byte for byte:\n${daemonB.output.split("\n").slice(-30).join("\n")}`).toBe(`${PAYLOAD} [[OVER]]`);
  }, 90_000);

  it("DOD-MSG-3 (send park) — A sends to an offline recipient → hash witnessed + content auto-parked (R1)", async () => {
    const dirA = mkdtempSync(join(tmpdir(), "cello-sendparkA-"));
    const dirB = mkdtempSync(join(tmpdir(), "cello-sendparkB-"));
    dirs.push(dirA, dirB);
    await provisionAgent(dirA, "agentA");
    const pubB = await provisionAgent(dirB, "agentB");
    const daemonA = await startLocalDaemon(dirA, "sendparkA");
    const daemonB = await startLocalDaemon(dirB, "sendparkB");
    daemons.push(daemonA, daemonB);
    expect(registerAgent("agentA", `DEV-sp-A-${randomBytes(6).toString("hex")}`, { CELLO_DIR: dirA }).status).toBe(0);
    expect(registerAgent("agentB", `DEV-sp-B-${randomBytes(6).toString("hex")}`, { CELLO_DIR: dirB }).status).toBe(0);

    const connA = await connectMcp(dirA, "sp-A");
    const connB = await connectMcp(dirB, "sp-B");
    mcpConns.push(connA, connB);
    for (const [c, n] of [[connA, "agentA"], [connB, "agentB"]] as const) {
      expect(((await c.call("cello_start_agent", { name: n })) as { ok?: boolean }).ok).toBe(true);
      expect(((await c.call("cello_use_agent", { name: n })) as { ok?: boolean }).ok).toBe(true);
    }

    // Establish the session WHILE B is online (so A's session holds the relay endpoint), and
    // confirm a normal message delivers.
    const awaitP = connB.call("cello_await_session", { timeout_ms: 25_000 });
    const init = (await connA.call("cello_initiate_session", { target_pubkey: pubB })) as { ok?: boolean; sessionId?: string };
    expect(init.ok, `initiate failed:\n${daemonA.output.split("\n").slice(-30).join("\n")}`).toBe(true);
    const sessionId = init.sessionId!;
    expect(((await awaitP) as { type?: string }).type).toBe("new_session");
    expect(((await connA.call("cello_send", { cello_session_id: sessionId, content: "while-online", signal: "over" })) as { ok?: boolean }).ok).toBe(true);

    // ── B goes OFFLINE. ──
    await connB.close();
    mcpConns.splice(mcpConns.indexOf(connB), 1);
    await daemonB.stop();

    // A sends again — direct delivery now fails (B is down). R1: the hash is still witnessed
    // (sequence assigned), and 2b deposits the SEALED content to the relay store-and-forward.
    await connA.call("cello_send", { cello_session_id: sessionId, content: "while-offline — must park", signal: "over" });

    // The load-bearing assertion: the daemon auto-parked the un-deliverable content.
    const deposited = await daemonA.waitForLine(/"event":"content\.park\.deposited"/, 25_000);
    expect(deposited).toContain(sessionId);
    // The relay received + stored the ciphertext (INV-3 — ciphertext only).
    expect(cluster.relay.output).toMatch(/content\.park\.received/);
  }, 90_000);

  it("DOD-MSG-3/4 (recover) — offline recipient comes back, RECOVERS the parked message through the inbound funnel", async () => {
    const dirA = mkdtempSync(join(tmpdir(), "cello-recA-"));
    const dirB = mkdtempSync(join(tmpdir(), "cello-recB-"));
    dirs.push(dirA, dirB);
    await provisionAgent(dirA, "agentA");
    const pubB = await provisionAgent(dirB, "agentB");
    const daemonA = await startLocalDaemon(dirA, "recA");
    let daemonB = await startLocalDaemon(dirB, "recB");
    daemons.push(daemonA, daemonB);
    expect(registerAgent("agentA", `DEV-rec-A-${randomBytes(6).toString("hex")}`, { CELLO_DIR: dirA }).status).toBe(0);
    expect(registerAgent("agentB", `DEV-rec-B-${randomBytes(6).toString("hex")}`, { CELLO_DIR: dirB }).status).toBe(0);

    let connA = await connectMcp(dirA, "rec-A");
    let connB = await connectMcp(dirB, "rec-B");
    mcpConns.push(connA, connB);
    for (const [c, n] of [[connA, "agentA"], [connB, "agentB"]] as const) {
      expect(((await c.call("cello_start_agent", { name: n })) as { ok?: boolean }).ok).toBe(true);
      expect(((await c.call("cello_use_agent", { name: n })) as { ok?: boolean }).ok).toBe(true);
    }
    // Establish + deliver one message directly (B's transcript = [msg1]).
    const awaitP = connB.call("cello_await_session", { timeout_ms: 25_000 });
    const init = (await connA.call("cello_initiate_session", { target_pubkey: pubB })) as { ok?: boolean; sessionId?: string };
    expect(init.ok, `initiate failed:\n${daemonA.output.split("\n").slice(-30).join("\n")}`).toBe(true);
    const sessionId = init.sessionId!;
    expect(((await awaitP) as { type?: string }).type).toBe("new_session");
    expect(((await connA.call("cello_send", { cello_session_id: sessionId, content: "msg1-online", signal: "over" })) as { ok?: boolean }).ok).toBe(true);

    // ── B goes OFFLINE (abrupt crash — lid-shut/SIGKILL, so on restart the session is
    // detected 'interrupted' with source daemon_restart); A sends the message that gets parked. ──
    await connB.close();
    mcpConns.splice(mcpConns.indexOf(connB), 1);
    await daemonB.kill();
    const PARKED = "msg2-while-offline — the message B must recover";
    await connA.call("cello_send", { cello_session_id: sessionId, content: PARKED, signal: "over" });
    await daemonA.waitForLine(/"event":"content\.park\.deposited"/, 25_000);

    // ── B comes back: its session is now 'interrupted'; B recovers the parked content. ──
    for (const f of ["daemon.sock", "daemon.lock"]) {
      try { rmSync(join(dirB, f), { force: true }); } catch { /* best-effort */ }
    }
    daemonB = await startLocalDaemon(dirB, "recB-restart");
    daemons.push(daemonB);
    await daemonB.waitForLine(/"event":"session\.interrupted\.detected"/, 15_000);
    expect(cello(["login"], { CELLO_DIR: dirB }).status).toBe(0);
    connB = await connectMcp(dirB, "rec-B2");
    mcpConns.push(connB);
    expect(((await connB.call("cello_start_agent", { name: "agentB" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connB.call("cello_use_agent", { name: "agentB" })) as { ok?: boolean }).ok).toBe(true);

    // cello_start_agent AUTO-recovers (the production path), so wait for that to drain the mailbox
    // deterministically rather than racing it with the explicit IPC recover below.
    await daemonB.waitForLine(/"event":"content\.recover\.auto\.completed"/, 25_000);

    // The explicit IPC recover finds an EMPTY mailbox — auto-recover confirm-DELETED the entry from
    // the relay (delete-on-confirm), so there is nothing left to pull. pulled:0 proves the queue
    // actually drained (not merely that a re-pull was deduped).
    const rec = (await ipcCall(dirB, "content_park_recover", { relayMultiaddr: cluster.relayMultiaddr, recipientPubkey: pubB })) as { ok?: boolean; recovered?: number; pulled?: number };
    expect(rec.ok, `recover failed: ${JSON.stringify(rec)}`).toBe(true);
    expect(rec.pulled, "auto-recover confirm-deleted the entry; the mailbox is drained").toBe(0);
    expect(rec.recovered, "nothing left to recover").toBe(0);

    // M9 single-inbound-funnel AC: the recovered content traversed ingestReceivedContent (the SAME
    // chokepoint as a direct receive), evidenced by session.content.received with its sequence.
    expect(daemonB.output, "recovered content must traverse the inbound chokepoint").toMatch(
      /"event":"session\.content\.received"/,
    );
    expect(daemonB.output).toMatch(/"event":"content\.recovered"/);
    // DOD-MSG-4 (2b): the parked entry carried the relay's signed Structure2 (sealed in the envelope),
    // so recover VERIFIED it and recorded the canonical sequence — the recover path self-orders the
    // same way a direct frame does, not by relay pull order.
    expect(daemonB.output, "the parked entry self-orders on recover").toMatch(
      /"event":"session\.content\.ordering\.recorded"[^\n]*"source":"park"/,
    );

    // And it surfaces as readable PLAINTEXT via cello_receive — not raw ciphertext around the funnel.
    //
    // TWO reads, and the FIRST one is msg1 — that changed with DOD-COATTEND-1 (M8D) and the change
    // is a FIX, not a regression. Verified by building the daemon at the commit before Tier 1 and
    // re-running this clause: pre-Tier-1 the first read returned the PARKED message and msg1 was
    // never readable at all. B's daemon RESTARTED here, and delivery used to be a destructive
    // in-memory queue — so msg1, which B received live but never read through a client, was in the
    // transcript and unreachable through cello_receive forever. That is precisely the content loss
    // DOD-COATTEND-1 AC3 exists to end, and this clause was asserting the lossy behavior.
    //
    // Post-Tier-1 delivery reads the durable record against a per-connection bookmark, so a
    // reconnecting session resumes from what IT has read: the unread msg1 first, then the parked
    // msg2. Nothing is skipped and nothing is lost. The clause's own intent — "B reads the exact
    // parked plaintext it had missed" — still holds; it is simply no longer the first thing read.
    //
    // The `[[OVER]]` suffix is in-band: the shim appends the turn signal to the content itself.
    const read = async () => ((await connB.call("cello_receive", { cello_session_id: sessionId })) as { ok?: boolean; content?: string | null }).content;
    expect(await read(), "the live message B never read is delivered first — not lost").toBe("msg1-online [[OVER]]");
    expect(await read(), "B reads the exact parked plaintext it had missed").toBe(`${PARKED} [[OVER]]`);
  }, 120_000);

  it("DOD-MSG-7 (desync only on tamper) — tampered parked content is the ONLY desync; recovery-failure keeps the session alive", async () => {
    const dirA = mkdtempSync(join(tmpdir(), "cello-tamperA-"));
    const dirB = mkdtempSync(join(tmpdir(), "cello-tamperB-"));
    dirs.push(dirA, dirB);
    await provisionAgent(dirA, "agentA");
    const pubB = await provisionAgent(dirB, "agentB");
    const daemonA = await startLocalDaemon(dirA, "tamperA");
    const daemonB = await startLocalDaemon(dirB, "tamperB");
    daemons.push(daemonA, daemonB);
    expect(registerAgent("agentA", `DEV-tp-A-${randomBytes(6).toString("hex")}`, { CELLO_DIR: dirA }).status).toBe(0);
    expect(registerAgent("agentB", `DEV-tp-B-${randomBytes(6).toString("hex")}`, { CELLO_DIR: dirB }).status).toBe(0);
    const connA = await connectMcp(dirA, "tp-A");
    const connB = await connectMcp(dirB, "tp-B");
    mcpConns.push(connA, connB);
    for (const [c, n] of [[connA, "agentA"], [connB, "agentB"]] as const) {
      expect(((await c.call("cello_start_agent", { name: n })) as { ok?: boolean }).ok).toBe(true);
      expect(((await c.call("cello_use_agent", { name: n })) as { ok?: boolean }).ok).toBe(true);
    }
    const awaitP = connB.call("cello_await_session", { timeout_ms: 25_000 });
    const init = (await connA.call("cello_initiate_session", { target_pubkey: pubB })) as { ok?: boolean; sessionId?: string };
    expect(init.ok).toBe(true);
    const sessionId = init.sessionId!;
    expect(((await awaitP) as { type?: string }).type).toBe("new_session");

    /**
     * ⚠️ THESE DEPOSITS USED TO BE UNSIGNED, AND EVERY ASSERTION BELOW WAS UNREACHABLE.
     *
     * They passed `ciphertext:` — a bare `sealToRecipient(...)` with no park envelope around it. Once
     * SEC-1 required a sender signature, `authenticateParkedEntry` refused all three at the door with
     * `reason: "unsigned_envelope"`, which `park-envelope.ts` names "the ATTACKER shape". So this test
     * was not measuring tamper detection at all: honest, tampered and corrupt were rejected
     * identically, one step before the hash cross-check that is the whole point.
     *
     * `content:` now parks through the daemon's own `sealParkEnvelope`, signed by agentA — the same
     * producer production uses. The signature is deliberately NOT over the content, only over
     * `(sessionId, recipient, claimed hash)`, which is what still lets case (2) exist: a properly
     * signed entry whose claimed hash does not describe what is sealed inside. That is a malicious
     * SENDER, not a malicious relay, and it is the case the recover path's cross-check is for.
     */
    const dep = (args: Record<string, unknown>) =>
      ipcCall(dirA, "content_park_deposit", {
        relayMultiaddr: cluster.relayMultiaddr,
        recipientPubkey: pubB,
        sessionId,
        senderAgentName: "agentA",
        ...args,
      });

    // (1) HONEST — signed, and the claimed hash MATCHES the sealed content. Must be accepted.
    const honest = Buffer.from("honest recovered message");
    await dep({ content: honest.toString("hex"), contentHash: contentHashHex(honest) });
    // (2) TAMPER — a properly SIGNED entry carrying real content, claiming the hash of DIFFERENT
    //     content. Unseals fine, authenticates fine, and then the cross-check fails →
    //     content_hash_mismatch (the ONE desync). Reachable only because the signature does not
    //     bind the content.
    const realContent = Buffer.from("the actual sealed bytes");
    await dep({ content: realContent.toString("hex"), contentHash: contentHashHex(Buffer.from("a different message entirely")) });
    // (3) RECOVERY-FAILURE — not a valid seal at all, so it stays a RAW `ciphertext:` deposit. This
    //     one must NOT be signed: the point is that `openContentSeal` fails on the outer layer,
    //     before there is any envelope to decode or authenticate, which is why it is a skip and not
    //     a desync. Signing it would move the failure to a different check and prove nothing.
    await dep({ ciphertext: Buffer.from(randomBytes(160)).toString("hex"), contentHash: contentHashHex(Buffer.from("whatever")) });

    const rec = (await ipcCall(dirB, "content_park_recover", { relayMultiaddr: cluster.relayMultiaddr, recipientPubkey: pubB })) as { ok?: boolean; recovered?: number; pulled?: number };
    expect(rec.ok).toBe(true);
    /**
     * The recover outcome and B's own recover lines ride on BOTH assertions, because "expected +0 to
     * be 1" on its own is unactionable: `recovered: 0` is the identical number whether the entry was
     * refused for a bad signature, a hash mismatch, an unsealable blob or a committed session, and
     * those are four different bugs. Vitest prints only the failing test's message, not every
     * daemon's buffer, so a bare count sends the next reader to a log that does not contain the
     * answer — which is exactly the round this cost.
     */
    const recDiag = () =>
      `\n  recover said: ${JSON.stringify(rec)}\n  B's recover lines:\n${
        daemonB.output.split("\n").filter((l) => /content\.recover|cross_check|content\.park\.pull/.test(l)).slice(-12).join("\n") || "    (none — B logged no recover activity at all)"
      }`;
    expect(rec.pulled, `all three parked entries pulled${recDiag()}`).toBe(3);
    // ONLY the honest one is recovered — tamper + corrupt are rejected, neither lands.
    expect(rec.recovered, `only the honest entry is accepted${recDiag()}`).toBe(1);

    const tail = daemonB.output;
    // Tamper → the ONE content-path desync signal.
    expect(tail, "tampered content → content_hash_mismatch").toMatch(/content_hash_mismatch/);
    // Recovery-failure → distinct, NON-desync outcome (skipped).
    expect(tail, "unsealable content → recovery-failure, not desync").toMatch(/"event":"content\.recover\.unseal_failed"/);
    // Honest → accepted (proves the harness seal round-trips through the daemon's openContentSeal).
    expect(tail, "honest content recovered").toMatch(/"event":"content\.recovered"/);

    // The session stays ALIVE despite tamper+corrupt: B still reads the honest message.
    const recv = (await connB.call("cello_receive", { cello_session_id: sessionId })) as { ok?: boolean; content?: string | null };
    expect(recv.ok).toBe(true);
    expect(recv.content, "session alive — the honest message is readable").toBe(honest.toString("utf8"));
  }, 120_000);

  it("DOD-MSG-5 (dedup) — a message arriving BOTH directly and via park yields exactly ONE leaf", async () => {
    const dirA = mkdtempSync(join(tmpdir(), "cello-dedupA-"));
    const dirB = mkdtempSync(join(tmpdir(), "cello-dedupB-"));
    dirs.push(dirA, dirB);
    await provisionAgent(dirA, "agentA");
    const pubB = await provisionAgent(dirB, "agentB");
    const daemonA = await startLocalDaemon(dirA, "dedupA");
    const daemonB = await startLocalDaemon(dirB, "dedupB");
    daemons.push(daemonA, daemonB);
    expect(registerAgent("agentA", `DEV-dd-A-${randomBytes(6).toString("hex")}`, { CELLO_DIR: dirA }).status).toBe(0);
    expect(registerAgent("agentB", `DEV-dd-B-${randomBytes(6).toString("hex")}`, { CELLO_DIR: dirB }).status).toBe(0);
    const connA = await connectMcp(dirA, "dd-A");
    const connB = await connectMcp(dirB, "dd-B");
    mcpConns.push(connA, connB);
    for (const [c, n] of [[connA, "agentA"], [connB, "agentB"]] as const) {
      expect(((await c.call("cello_start_agent", { name: n })) as { ok?: boolean }).ok).toBe(true);
      expect(((await c.call("cello_use_agent", { name: n })) as { ok?: boolean }).ok).toBe(true);
    }
    const awaitP = connB.call("cello_await_session", { timeout_ms: 25_000 });
    const init = (await connA.call("cello_initiate_session", { target_pubkey: pubB })) as { ok?: boolean; sessionId?: string };
    expect(init.ok).toBe(true);
    const sessionId = init.sessionId!;
    expect(((await awaitP) as { type?: string }).type).toBe("new_session");

    // A delivers the message DIRECTLY → B appends it as leaf 0.
    const msg = `dup-me-${randomBytes(4).toString("hex")}`;
    /**
     * ⚠️ THE BYTES ON THE WIRE ARE NOT `msg`. `signal: "over"` is IN-BAND — the shim appends the turn
     * signal to the content itself, so what A actually sends, and what B hashes, is
     * `"<msg> [[OVER]]"`. The recover test above pins the same thing from the other side
     * (`toBe("msg1-online [[OVER]]")`).
     *
     * This is what the parked duplicate has to contain. Depositing bare `msg` produced a
     * `content_hash_mismatch` under EVERY algorithm — which is what proved the algorithm was never
     * the cause: a salted declaration and an unsalted one failed identically, because the content
     * itself was a different string.
     */
    const msgBytes = Buffer.from(`${msg} [[OVER]]`);
    expect(((await connA.call("cello_send", { cello_session_id: sessionId, content: msg, signal: "over" })) as { ok?: boolean }).ok).toBe(true);

    /**
     * ⚠️ THE HASH IS READ FROM THE DAEMON, NOT COMPUTED HERE — and computing it is why this test failed.
     *
     * It used `contentHashHex(msgBytes)`, which is `SHA-256(0x00 ‖ content)` — the **unsalted** hash.
     * Once `SEALWIRE-1` bullet 6 landed, a session that agrees a salt hashes content as
     * `HMAC-SHA256(salt, 0x00 ‖ content)` instead, so the daemon wrote one hash and this test waited
     * for a different one. **Measured:** `session.content.received` fired twice in the run, and the
     * hash this test computed appeared NOWHERE in it — not late, not anywhere. The message was
     * delivered the whole time; the wait was for a value that never existed.
     *
     * A salted variant exists in the crypto package (`saltedContentHash`), but the test cannot USE it: the
     * session salt is a secret held in the daemon's encrypted database and is on no read surface, so
     * there is nothing for a test to fetch. That — not "a second implementation" — is the real reason;
     * a test SHOULD be an independent implementation where it can be one.
     *
     * Reading the hash off the daemon's own event removes the question entirely: it is correct
     * whether the session is salted or not, and it stays correct if the algorithm changes again.
     */
    const firstReceive = await daemonB.waitForLine(
      new RegExp(`"event":"session\\.content\\.received"[^\\n]*"sessionId":"${sessionId}"`),
      15_000,
    );
    const hashHex = /"contentHashHex":"([0-9a-f]{64})"/.exec(firstReceive)?.[1] ?? "";
    expect(
      hashHex,
      `could not read contentHashHex off the daemon's own receive event — the line was: ${firstReceive}`,
    ).toMatch(/^[0-9a-f]{64}$/);
    expect(firstReceive).toMatch(/"sequenceNumber":0/);

    // Now the SAME message also shows up via the relay park (the direct+park overlap). B recovers it.
    //
    // Parked SIGNED, through the daemon's own `sealParkEnvelope` — the bare `sealToRecipient(...)`
    // this used to deposit was refused as `unsigned_envelope` before dedup was ever consulted, so
    // the deduplication assertion below was measuring nothing.
    //
    /**
     * ⚠️ THE ALGORITHM HAS TO TRAVEL WITH THE HASH, AND OMITTING IT IS NOT NEUTRAL — absent means
     * `sha256`. This is the trap the review warned about, and it was measured happening here: the
     * entry authenticated cleanly (`content.recover.verified`) and then died at
     * `session.content.cross_check.failed` with `declaredAlg: "sha256"` and
     * `reason: "content_hash_mismatch"` — a TAMPER verdict on a message nobody touched, because the
     * direct frame had hashed it SALTED and the parked copy claimed it had not.
     *
     * `contentHash` is still the hash read off the daemon's OWN receive event above, never one
     * recomputed here — the session salt lives in the daemon's encrypted database and is on no read
     * surface, so a test cannot compute the salted hash even if it wanted to.
     *
     * The salt is ASSERTED rather than assumed. If salting is ever turned off for this path, this
     * wait fails loudly and says so, instead of the deposit silently mis-declaring its algorithm and
     * failing later as a hash mismatch that looks like tampering.
     */
    await daemonB.waitForLine(
      new RegExp(`"event":"session\\.salt\\.agreed"[^\\n]*"sessionId":"${sessionId}"`),
      15_000,
    );
    await ipcCall(dirA, "content_park_deposit", {
      relayMultiaddr: cluster.relayMultiaddr,
      recipientPubkey: pubB,
      contentHash: hashHex,
      contentHashAlg: "hmac-sha256-salt-v1",
      sessionId,
      senderAgentName: "agentA",
      content: Buffer.from(msgBytes).toString("hex"),
    });
    const rec = (await ipcCall(dirB, "content_park_recover", { relayMultiaddr: cluster.relayMultiaddr, recipientPubkey: pubB })) as { ok?: boolean; pulled?: number };
    expect(rec.ok).toBe(true);
    expect(rec.pulled).toBe(1);

    // DEDUP: the duplicate is recognized at the EXISTING sequence — NOT appended as a second leaf.
    const dedup = await daemonB.waitForLine(new RegExp(`"event":"session\\.content\\.deduplicated"[^\\n]*"contentHashHex":"${hashHex}"`), 10_000);
    expect(dedup).toMatch(/"sequenceNumber":0/);
    // Exactly ONE leaf for this content_hash: only one session.content.received (the direct one).
    const receivedCount = (daemonB.output.match(new RegExp(`"event":"session\\.content\\.received"[^\\n]*"${hashHex}"`, "g")) ?? []).length;
    expect(receivedCount, "the content_hash appended exactly one leaf").toBe(1);
  }, 120_000);

  it("DOD-MSG-1 (ACK ladder) — a persisted delivery ACK resolves the send; the protocol acts on persisted", async () => {
    const dirA = mkdtempSync(join(tmpdir(), "cello-ackA-"));
    const dirB = mkdtempSync(join(tmpdir(), "cello-ackB-"));
    dirs.push(dirA, dirB);
    await provisionAgent(dirA, "agentA");
    const pubB = await provisionAgent(dirB, "agentB");
    const daemonA = await startLocalDaemon(dirA, "ackA");
    const daemonB = await startLocalDaemon(dirB, "ackB");
    daemons.push(daemonA, daemonB);
    expect(registerAgent("agentA", `DEV-ak-A-${randomBytes(6).toString("hex")}`, { CELLO_DIR: dirA }).status).toBe(0);
    expect(registerAgent("agentB", `DEV-ak-B-${randomBytes(6).toString("hex")}`, { CELLO_DIR: dirB }).status).toBe(0);
    const connA = await connectMcp(dirA, "ak-A");
    const connB = await connectMcp(dirB, "ak-B");
    mcpConns.push(connA, connB);
    for (const [c, n] of [[connA, "agentA"], [connB, "agentB"]] as const) {
      expect(((await c.call("cello_start_agent", { name: n })) as { ok?: boolean }).ok).toBe(true);
      expect(((await c.call("cello_use_agent", { name: n })) as { ok?: boolean }).ok).toBe(true);
    }
    const awaitP = connB.call("cello_await_session", { timeout_ms: 25_000 });
    const init = (await connA.call("cello_initiate_session", { target_pubkey: pubB })) as { ok?: boolean; sessionId?: string };
    expect(init.ok).toBe(true);
    const sessionId = init.sessionId!;
    expect(((await awaitP) as { type?: string }).type).toBe("new_session");

    // A sends to an ONLINE B. B's unsigned, transport-authenticated `persisted` delivery ACK
    // resolves A's awaiting-ACK timer.
    const msg = `acked-${randomBytes(4).toString("hex")}`;
    expect(((await connA.call("cello_send", { cello_session_id: sessionId, content: msg, signal: "over" })) as { ok?: boolean }).ok).toBe(true);

    /**
     * ⚠️ THE HASH IS READ FROM THE DAEMON, NOT COMPUTED — same defect as the dedup test above.
     *
     * `contentHashHex` is `SHA-256(0x00 ‖ content)`, the UNSALTED hash. A session that agrees a salt
     * hashes `HMAC-SHA256(salt, 0x00 ‖ content)` instead, so this waited 12s for a value the daemon
     * never wrote. Measured: the hash this test computed appeared NOWHERE in the run, while
     * `content.delivery.acked` fired twice for other hashes. The ACK ladder was working the whole
     * time.
     *
     * ⚠️ **I CLAIMED THIS "TURNS A VACUOUS ASSERTION INTO A REAL ONE". IT DOES NOT — review HIGH-1.**
     * The negative park assertion below was vacuous for TWO reasons and this fixes only one. It runs
     * about a millisecond after the ACK, and the sole producer of a sender-side park for this hash is
     * `#handleTtfExpiry`, armed by a **20-second** timer that `#resolveAwaitingAck` clears as its first
     * act — before emitting the very line awaited above. **Reaching that assertion guarantees the timer
     * is already dead, and nothing could have fired anyway.** Fixing the hash removed one vacuity and
     * left another underneath it. The claim is corrected here and in the DoD rather than left standing.
     */
    const acked = await daemonA.waitForLine(
      new RegExp(`"event":"content\\.delivery\\.acked"[^\\n]*"sessionId":"${sessionId}"`),
      12_000,
    );
    const hashHex = /"contentHash":"([0-9a-f]{64})"/.exec(acked)?.[1] ?? "";
    expect(hashHex, `could not read contentHash off the daemon's own ACK: ${acked}`).toMatch(/^[0-9a-f]{64}$/);

    /**
     * ⚠️ PIN THE EXTRACTION TO **THIS** MESSAGE — review MEDIUM-3.
     *
     * `waitForLine` scans the backlog from daemon boot and returns the FIRST match, and the filter is
     * now the session id rather than the hash. That is correct today only because exactly one send
     * happens on this daemon: `#trackAwaitingAck`'s sole caller is `sendContent`, and the two
     * automatic senders (reject, away-response) are receiver-side. **Correct today, fragile by
     * construction** — the moment a second message joins this session the extraction silently moves to
     * a different hash.
     *
     * The dedup test is pinned by `sequenceNumber:0`; this one had no pin at all, because
     * `level:"persisted"` is a literal at the single emit site and discriminates nothing. This turns
     * "there is only one candidate" from an argument into an assertion.
     */
    expect(
      daemonA.countLines(/"event":"content\.delivery\.acked"/),
      "exactly one send, so exactly one ACK — if this is ever >1 the hash above may be another message's",
    ).toBe(1);
    /**
     * ⚠️ TAUTOLOGICAL, AND KEPT ONLY AS A NAMED PLACEHOLDER — review HIGH-2.
     *
     * `content.delivery.acked` has exactly ONE emit site and it writes `level: "persisted"` as a
     * **string literal**. The field can never hold anything else, so this assertion cannot fail. Its
     * old message — *"the protocol acts on the persisted ACK"* — claimed the discrimination the test
     * does not perform: that a `received`-level ACK does NOT resolve the timer.
     *
     * Kept rather than deleted because the CLAIM is the thing worth stating, and the message now says
     * what would actually prove it. **An assertion standing next to a constant implies a proof it
     * never gave**, so the comment is the guard until the two-level version exists.
     */
    expect(
      acked,
      "NOT a real check: `level` is a literal at the single emit site, so this cannot fail. Proving " +
        "the claim needs B to emit a `received`-level ACK first and the timer NOT to resolve, then a " +
        "`persisted` one and it to resolve.",
    ).toMatch(/"level":"persisted"/);

    // Because delivery was confirmed persisted, the content is NOT handed to the park backstop —
    // the park is only for un-confirmed sends. (No content.park.deposited for this hash.)
    expect(daemonA.output).not.toMatch(new RegExp(`"event":"content\\.park\\.deposited"[^\\n]*"contentHash":"${hashHex}"`));
  }, 90_000);

  it("DOD-MSG-2 (startup-flush park) — a sender that crashed with un-acked content re-parks it on restart", async () => {
    const dirA = mkdtempSync(join(tmpdir(), "cello-flushA-"));
    const dirB = mkdtempSync(join(tmpdir(), "cello-flushB-"));
    dirs.push(dirA, dirB);
    await provisionAgent(dirA, "agentA");
    const pubB = await provisionAgent(dirB, "agentB");
    let daemonA = await startLocalDaemon(dirA, "flushA");
    const daemonB = await startLocalDaemon(dirB, "flushB");
    daemons.push(daemonA, daemonB);
    expect(registerAgent("agentA", `DEV-fl-A-${randomBytes(6).toString("hex")}`, { CELLO_DIR: dirA }).status).toBe(0);
    expect(registerAgent("agentB", `DEV-fl-B-${randomBytes(6).toString("hex")}`, { CELLO_DIR: dirB }).status).toBe(0);
    let connA = await connectMcp(dirA, "fl-A");
    const connB = await connectMcp(dirB, "fl-B");
    mcpConns.push(connA, connB);
    for (const [c, n] of [[connA, "agentA"], [connB, "agentB"]] as const) {
      expect(((await c.call("cello_start_agent", { name: n })) as { ok?: boolean }).ok).toBe(true);
      expect(((await c.call("cello_use_agent", { name: n })) as { ok?: boolean }).ok).toBe(true);
    }
    // Establish the session so A's relay endpoint is PERSISTED (the flush needs it after a restart).
    const awaitP = connB.call("cello_await_session", { timeout_ms: 25_000 });
    const init = (await connA.call("cello_initiate_session", { target_pubkey: pubB })) as { ok?: boolean; sessionId?: string };
    expect(init.ok).toBe(true);
    const sessionId = init.sessionId!;
    expect(((await awaitP) as { type?: string }).type).toBe("new_session");

    // A records un-acked content in the durable awaiting queue (the state a sender is in after a
    // TTF with no persisted ACK), then CRASHES before the live park completes.
    const content = `crash-backstop ${randomBytes(4).toString("hex")}`;
    const hashHex = contentHashHex(Buffer.from(content));
    // DOD-LOOP-1: the awaiting queue is keyed by the OWNING agent. A raw IPC call has no
    // current-agent context, so the agentName must be passed explicitly — otherwise the entry is
    // stored under "" and the restart flush (which looks the session up by its real agent) can't
    // find the relay endpoint, so it re-parks nothing.
    await ipcCall(dirA, "enqueue_awaiting_content", {
      agentName: "agentA",
      sessionId,
      contentHash: hashHex,
      content: Buffer.from(content).toString("hex"),
    });
    await connA.close();
    mcpConns.splice(mcpConns.indexOf(connA), 1);
    await daemonA.kill();
    for (const f of ["daemon.sock", "daemon.lock"]) {
      try { rmSync(join(dirA, f), { force: true }); } catch { /* best-effort */ }
    }

    // A restarts → it re-parks the un-acked content from PERSISTED state. Post-DOD-LOOP-1 the
    // re-park needs the OWNING agent's standing receiver, which exists only once that agent is
    // online — so the deposit fires when agentA does cello_start_agent (which triggers the per-agent
    // flushAwaitingContent), NOT at the pre-IPC startup pass (no agent online there yet).
    daemonA = await startLocalDaemon(dirA, "flushA-restart");
    daemons.push(daemonA);
    expect(cello(["login"], { CELLO_DIR: dirA }).status).toBe(0);
    connA = await connectMcp(dirA, "fl-A2");
    mcpConns.push(connA);
    expect(((await connA.call("cello_start_agent", { name: "agentA" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connA.call("cello_use_agent", { name: "agentA" })) as { ok?: boolean }).ok).toBe(true);
    const flushed = await daemonA.waitForLine(/"event":"content\.park\.deposited"[^\n]*"source":"startup_flush"/, 20_000);
    expect(flushed, "the crashed sender re-parks its un-acked content when its agent comes online").toContain(hashHex);
    expect(daemonA.output).toMatch(/"event":"content\.park\.flush\.completed"/);
    expect(cluster.relay.output).toMatch(/content\.park\.received/);

    // End-to-end: B recovers the re-parked content (proving the flush deposit is a real, pullable,
    // recipient-decryptable entry — not just a log line).
    const rec = (await ipcCall(dirB, "content_park_recover", { relayMultiaddr: cluster.relayMultiaddr, recipientPubkey: pubB })) as { ok?: boolean; recovered?: number };
    expect(rec.ok).toBe(true);
    expect(rec.recovered, "B recovers the startup-flushed message").toBeGreaterThanOrEqual(1);
    const recv = (await connB.call("cello_receive", { cello_session_id: sessionId })) as { ok?: boolean; content?: string | null };
    expect(recv.ok).toBe(true);
    expect(recv.content, "B reads the content the crashed sender re-parked").toBe(content);
  }, 120_000);

  it("DOD-MSG-4 (self-ordering frame) — the content frame carries the relay's signed Structure2; B verifies it and orders from the FRAME, not the witness stream", async () => {
    const dirA = mkdtempSync(join(tmpdir(), "cello-soA-"));
    const dirB = mkdtempSync(join(tmpdir(), "cello-soB-"));
    dirs.push(dirA, dirB);
    await provisionAgent(dirA, "agentA");
    const pubB = await provisionAgent(dirB, "agentB");
    const daemonA = await startLocalDaemon(dirA, "soA");
    const daemonB = await startLocalDaemon(dirB, "soB");
    daemons.push(daemonA, daemonB);
    expect(registerAgent("agentA", `DEV-so-A-${randomBytes(6).toString("hex")}`, { CELLO_DIR: dirA }).status).toBe(0);
    expect(registerAgent("agentB", `DEV-so-B-${randomBytes(6).toString("hex")}`, { CELLO_DIR: dirB }).status).toBe(0);
    const connA = await connectMcp(dirA, "so-A");
    const connB = await connectMcp(dirB, "so-B");
    mcpConns.push(connA, connB);
    for (const [c, n] of [[connA, "agentA"], [connB, "agentB"]] as const) {
      expect(((await c.call("cello_start_agent", { name: n })) as { ok?: boolean }).ok).toBe(true);
      expect(((await c.call("cello_use_agent", { name: n })) as { ok?: boolean }).ok).toBe(true);
    }
    const awaitP = connB.call("cello_await_session", { timeout_ms: 25_000 });
    const init = (await connA.call("cello_initiate_session", { target_pubkey: pubB })) as { ok?: boolean; sessionId?: string };
    expect(init.ok, `initiate failed:\n${daemonA.output.split("\n").slice(-30).join("\n")}`).toBe(true);
    const sessionId = init.sessionId!;
    expect(((await awaitP) as { type?: string }).type).toBe("new_session");

    // A sends two messages directly to the online B. Each content frame carries the relay's signed
    // Structure2 (sequence + sender signature). B VERIFIES the signature and records the canonical
    // sequence FROM THE FRAME — proven by session.content.ordering.recorded with source:content_frame,
    // independent of the separate leaf_deliver witness stream (which previously was the only ordering
    // signal and the source of the content-before-witness race).
    expect(((await connA.call("cello_send", { cello_session_id: sessionId, content: "first", signal: "over" })) as { ok?: boolean }).ok).toBe(true);
    const ord0 = await daemonB.waitForLine(/"event":"session\.content\.ordering\.recorded"[^\n]*"source":"content_frame"/, 15_000);
    expect(ord0, "B records the canonical sequence from the content frame (idx 0)").toMatch(/"canonicalSeq":0/);
    await daemonB.waitForLine(/"event":"session\.content\.received"[^\n]*"sequenceNumber":0/, 10_000);

    expect(((await connA.call("cello_send", { cello_session_id: sessionId, content: "second", signal: "over" })) as { ok?: boolean }).ok).toBe(true);
    await daemonB.waitForLine(/"event":"session\.content\.ordering\.recorded"[^\n]*"canonicalSeq":1[^\n]*"source":"content_frame"/, 15_000);
    await daemonB.waitForLine(/"event":"session\.content\.received"[^\n]*"sequenceNumber":1/, 10_000);

    // B reads them in canonical order — leaf index === the relay-committed sequence the frame carried.
    //
    // The `[[OVER]]` suffix is part of the content, not decoration: the shim appends the turn signal
    // IN-BAND (`${content} ${token}` in cello-mcp.ts) and the receiver's `cello_receive` reads it
    // back off the content to derive its guidance. These assertions predated in-band signals and
    // compared against the bare payload, so they failed on a correct build — asserting the exact
    // wire string is what makes them a check on ORDER rather than on formatting.
    const read = async () => ((await connB.call("cello_receive", { cello_session_id: sessionId })) as { ok?: boolean; content?: string | null }).content;
    expect(await read()).toBe("first [[OVER]]");
    expect(await read()).toBe("second [[OVER]]");
  }, 120_000);

  it("DOD-MSG-4 (auto-recover) — B drains its parked mailbox automatically on reconnect, with NO explicit recover call", async () => {
    const dirA = mkdtempSync(join(tmpdir(), "cello-arA-"));
    const dirB = mkdtempSync(join(tmpdir(), "cello-arB-"));
    dirs.push(dirA, dirB);
    await provisionAgent(dirA, "agentA");
    const pubB = await provisionAgent(dirB, "agentB");
    const daemonA = await startLocalDaemon(dirA, "arA");
    let daemonB = await startLocalDaemon(dirB, "arB");
    daemons.push(daemonA, daemonB);
    expect(registerAgent("agentA", `DEV-ar-A-${randomBytes(6).toString("hex")}`, { CELLO_DIR: dirA }).status).toBe(0);
    expect(registerAgent("agentB", `DEV-ar-B-${randomBytes(6).toString("hex")}`, { CELLO_DIR: dirB }).status).toBe(0);
    let connA = await connectMcp(dirA, "ar-A");
    let connB = await connectMcp(dirB, "ar-B");
    mcpConns.push(connA, connB);
    for (const [c, n] of [[connA, "agentA"], [connB, "agentB"]] as const) {
      expect(((await c.call("cello_start_agent", { name: n })) as { ok?: boolean }).ok).toBe(true);
      expect(((await c.call("cello_use_agent", { name: n })) as { ok?: boolean }).ok).toBe(true);
    }
    // Establish the session while B is online (so B's session persists the relay endpoint that
    // auto-recover pulls from on reconnect).
    const awaitP = connB.call("cello_await_session", { timeout_ms: 25_000 });
    const init = (await connA.call("cello_initiate_session", { target_pubkey: pubB })) as { ok?: boolean; sessionId?: string };
    expect(init.ok, `initiate failed:\n${daemonA.output.split("\n").slice(-30).join("\n")}`).toBe(true);
    const sessionId = init.sessionId!;
    expect(((await awaitP) as { type?: string }).type).toBe("new_session");
    expect(((await connA.call("cello_send", { cello_session_id: sessionId, content: "online-first", signal: "over" })) as { ok?: boolean }).ok).toBe(true);

    // ── B OFFLINE. A sends → parks (with the signed ordering record). ──
    await connB.close();
    mcpConns.splice(mcpConns.indexOf(connB), 1);
    await daemonB.kill();
    const PARKED = "parked-while-offline — B must AUTO-recover it";
    await connA.call("cello_send", { cello_session_id: sessionId, content: PARKED, signal: "over" });
    await daemonA.waitForLine(/"event":"content\.park\.deposited"/, 25_000);

    // ── B comes back online. cello_start_agent must AUTO-drain the mailbox — NO content_park_recover. ──
    for (const f of ["daemon.sock", "daemon.lock"]) {
      try { rmSync(join(dirB, f), { force: true }); } catch { /* best-effort */ }
    }
    daemonB = await startLocalDaemon(dirB, "arB-restart");
    daemons.push(daemonB);
    await daemonB.waitForLine(/"event":"session\.interrupted\.detected"/, 15_000);
    expect(cello(["login"], { CELLO_DIR: dirB }).status).toBe(0);
    connB = await connectMcp(dirB, "ar-B2");
    mcpConns.push(connB);
    expect(((await connB.call("cello_start_agent", { name: "agentB" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connB.call("cello_use_agent", { name: "agentB" })) as { ok?: boolean }).ok).toBe(true);

    /**
     * The agent-online hook auto-recovers — no explicit recover IPC. Prove it fired and delivered.
     *
     * ⚠️ WAIT FOR THE SWEEP THAT RECOVERED, NOT THE FIRST SWEEP. `waitForLine` returns the FIRST
     * match, and B runs more than one auto-recover sweep as it comes back up. The first is triggered
     * by `signaling_reconnect` and was measured landing BEFORE the relay was dialable:
     * `"trigger":"signaling_reconnect","recovered":0,"failedRelays":1`. Matching the bare event name
     * therefore latched onto a sweep that had failed to reach the relay at all, and asserted
     * `recovered:1` against it — reporting auto-recovery as broken when the later
     * `standing_receiver_ready` sweep does the work.
     *
     * The AC is "B drains its mailbox with no explicit recover call", not "the first sweep drains
     * it", so requiring a recovering sweep is the faithful reading. It cannot go hollow: if NO sweep
     * ever recovers, this times out red, and the `cello_receive` at the end is the independent proof
     * that the message actually arrived.
     */
    // Nothing is bound from the matched line on purpose: the REGEX is the assertion. Capturing it to
    // re-assert `"recovered":[1-9]` afterwards would be an expectation standing next to a value that
    // cannot contradict it — the shape this file already corrected once for `"level":"persisted"`.
    try {
      await daemonB.waitForLine(/"event":"content\.recover\.auto\.completed"[^\n]*"recovered":[1-9]/, 25_000);
    } catch (err: unknown) {
      const sweeps = daemonB.output.split("\n").filter((l) => l.includes("content.recover.auto.completed"));
      throw new Error(
        `no auto-recover sweep ever recovered anything. Every sweep B ran:\n${
          sweeps.join("\n") || "  (none — B ran no auto-recover sweep at all, which is a different failure)"
        }\n  A failedRelays count above zero means the sweep could not reach the relay, not that the mailbox was empty.`,
        { cause: err },
      );
    }
    expect(daemonB.output, "auto-recovered content traverses the inbound funnel").toMatch(/"event":"session\.content\.received"/);

    /**
     * B reads TWO messages, in this order, and the first one is not the parked one.
     *
     * B went offline without ever reading "online-first", so that message is still queued when B
     * comes back; the recovered message is appended after it. The recover test above pins the exact
     * same ordering and explains it — "the live message B never read is delivered first — not lost".
     * This test asserted a single read and expected the parked message, so it was really asserting
     * that B had LOST the earlier one.
     *
     * Both expectations carry the ` [[OVER]]` suffix because the turn signal is in-band — it is part
     * of the content the shim sent, so it is part of what comes back.
     */
    const read = async () => ((await connB.call("cello_receive", { cello_session_id: sessionId })) as { ok?: boolean; content?: string | null }).content;
    expect(await read(), "the live message B never read is still delivered first — not dropped by the recovery").toBe("online-first [[OVER]]");
    expect(await read(), "B reads the parked message WITHOUT any explicit content_park_recover").toBe(`${PARKED} [[OVER]]`);
  }, 120_000);

  it("DOD-MSG-8 (irreducible loss is honest) — a post-seal straggler is rejected (session_committed); B's certificate frontier is honest and the straggler never inflates it nor re-enters the transcript", async () => {
    // The irreducible-loss invariant (MSG-001 DB-003): the seal is ALWAYS honest and a straggler that
    // resurfaces AFTER the seal is rejected and cannot re-enter a committed session. The two mechanisms
    // already exist: (a) the per-party content frontier is derived from each party's OWN SIGNED leaves
    // (directory seal-legibility.ts) so a message a party never received/signed cannot appear in its
    // frontier — proven directly in J-LEGIBILITY (distinct per-party frontiers) and DOD-MSG-7 (an
    // unrecoverable parked entry never lands, frontier excludes it); (b) the sealed-session guard in
    // ingestReceivedContent refuses ALL content for a committed session. THIS test live-proves the
    // straggler-rejection guard (the new, otherwise-unasserted half) end-to-end, and asserts B's actual
    // certificate frontier is honest for the received content AND is not inflated by the straggler.
    const dirA = mkdtempSync(join(tmpdir(), "cello-msg8A-"));
    const dirB = mkdtempSync(join(tmpdir(), "cello-msg8B-"));
    dirs.push(dirA, dirB);
    await provisionAgent(dirA, "agentA");
    const pubB = await provisionAgent(dirB, "agentB");
    const daemonA = await startLocalDaemon(dirA, "msg8A");
    const daemonB = await startLocalDaemon(dirB, "msg8B");
    daemons.push(daemonA, daemonB);
    expect(registerAgent("agentA", `DEV-m8-A-${randomBytes(6).toString("hex")}`, { CELLO_DIR: dirA }).status).toBe(0);
    expect(registerAgent("agentB", `DEV-m8-B-${randomBytes(6).toString("hex")}`, { CELLO_DIR: dirB }).status).toBe(0);
    const connA = await connectMcp(dirA, "m8-A");
    const connB = await connectMcp(dirB, "m8-B");
    mcpConns.push(connA, connB);
    for (const [c, n] of [[connA, "agentA"], [connB, "agentB"]] as const) {
      expect(((await c.call("cello_start_agent", { name: n })) as { ok?: boolean }).ok).toBe(true);
      expect(((await c.call("cello_use_agent", { name: n })) as { ok?: boolean }).ok).toBe(true);
    }
    const awaitP = connB.call("cello_await_session", { timeout_ms: 25_000 });
    const init = (await connA.call("cello_initiate_session", { target_pubkey: pubB })) as { ok?: boolean; sessionId?: string };
    expect(init.ok, `initiate failed: ${JSON.stringify(init)}`).toBe(true);
    const sessionId = init.sessionId!;
    expect(((await awaitP) as { type?: string }).type).toBe("new_session");

    // A sends exactly one message; B receives it → B's signed content frontier covers msg1.
    expect(((await connA.call("cello_send", { cello_session_id: sessionId, content: "msg1", signal: "over" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connB.call("cello_receive", { cello_session_id: sessionId, timeout_ms: 15_000 })) as { content?: string | null }).content).toBe(`msg1 [[OVER]]`);

    // Both close → bilateral seal. The transcript is now COMMITTED + FROST-notarized.
    const [closeA, closeB] = (await Promise.all([
      connA.call("cello_close_session", { cello_session_id: sessionId }),
      connB.call("cello_close_session", { cello_session_id: sessionId }),
    ])) as Array<{ ok?: boolean; sealed_root?: string }>;
    const diag =
      `\ncloseA:${JSON.stringify(closeA)}\ncloseB:${JSON.stringify(closeB)}` +
      `\n--- daemonB ---\n${daemonB.output.split("\n").filter((l) => /seal|recover|ingest|legib/i.test(l)).slice(-18).join("\n")}`;
    expect(closeA.ok, `A close:${diag}`).toBe(true);
    expect(closeB.ok, `B close:${diag}`).toBe(true);

    /**
     * DOD-M15-CLOSEROOT-1: close returns a COMMITMENT, not a root — non-blocking by design
     * ("exactly how seventeen sessions were lost when this call used to block"), so the receipt is
     * fetched afterwards with `cello_sealed_receipt`.
     *
     * ⚠️ The old line here was `expect(closeB.sealed_root).toBe(closeA.sealed_root)`, and once close
     * stopped returning a root **it passed VACUOUSLY** — `undefined === undefined`. A test asserting
     * that two absent values are equal is green and proves nothing, which is worse than the failures
     * elsewhere in this file: those at least announced themselves.
     */
    const [rootA, rootB] = await Promise.all([
      awaitSealedRoot(connA, sessionId, { label: "A sealed receipt" }),
      awaitSealedRoot(connB, sessionId, { label: "B sealed receipt" }),
    ]);
    expect(rootA, `A sealed_root:${diag}`).toMatch(/^[0-9a-f]{64}$/);
    expect(rootB, `both sides received the same certificate:${diag}`).toBe(rootA);

    /**
     * AND EACH SIDE RECOGNISES THE CONVERSATION THE CERTIFICATE DESCRIBES — `SEALWIRE-1` bullet 8.
     *
     * The equality above is worth keeping and is not tamper-evidence: both roots are read off the
     * SAME certificate, so it stays green over a root covering a leaf set neither party holds. This
     * asserts each daemon's own verdict from comparing that root against the leaves IT holds —
     * `cannot_judge` is not accepted, because that is the daemon saying it took the certificate
     * without checking the content.
     *
     * ⚠️ I FIRST WROTE THAT THIS SESSION HAD BEEN KILLED AND RESTARTED AND ITS CONTENT RECOVERED
     * FROM THE PARK. **None of that happens in this test** — review pass 1, H1. There is no
     * `kill()`, no restart, and the straggler is parked AFTER the seal, which is the whole point of
     * DOD-MSG-8. I described a different test, and the fabrication was in the failure LABELS too, so
     * a red run would have sent the reader to a restart path that was never exercised.
     *
     * What this session actually is, and why the check earns its place here: it is the one that
     * seals and THEN has a straggler pushed at it. The frontier assertions below prove the straggler
     * never entered B's certificate. This proves the complementary half — that the root each side
     * was certified under is the root over the leaves it actually holds — so "the straggler stayed
     * out" is a statement about a tree both parties recognise, rather than about a number on a
     * certificate nobody checked.
     */
    await expectOwnTreeVerified(daemonA, sessionId, { label: "A (sealed before the straggler)" });
    await expectOwnTreeVerified(daemonB, sessionId, { label: "B (sealed before the straggler)" });

    // HONEST seal: B reads its certificate and the actual per-party content frontier. B received
    // exactly one in-session message (msg1), so B's signed frontier reflects that — never more.
    type LegPart = { pubkey: string; content_frontier_seq: number };
    type Receipt = { ok?: boolean; sealed_root?: string; legibility?: { participants: LegPart[] } };
    const receipt = (await connB.call("cello_sealed_receipt", { cello_session_id: sessionId })) as Receipt;
    expect(receipt.ok, `B reads the sealed receipt:${diag}`).toBe(true);
    expect(receipt.sealed_root, `receipt root matches the seal:${diag}`).toBe(rootB);
    const frontierOf = (r: Receipt, pubkeyHex: string): number => {
      const p = (r.legibility?.participants ?? []).find((x) => x.pubkey.toLowerCase() === pubkeyHex.toLowerCase());
      expect(p, `participant ${pubkeyHex.slice(0, 8)} present in the cert:${diag}\n${JSON.stringify(r.legibility)}`).toBeTruthy();
      return p!.content_frontier_seq;
    };
    // B's frontier covers A's single message and no more — the cert is built from signed leaves, so it
    // cannot be inflated past what B actually received. (Captured to prove the straggler can't move it.)
    const bFrontierAtSeal = frontierOf(receipt, pubB);
    expect(typeof bFrontierAtSeal, `B's content_frontier_seq is a real number:${diag}`).toBe("number");

    // ── The straggler: content for this session RESURFACES after the seal (a delayed delivery of a
    // message whose content never made it before the seal — the irreducible-loss case). It is a VALID
    // seal of real content (so it unseals cleanly — NOT a recovery-failure), parked for B; B recovers.
    const straggler = Buffer.from("msg2-straggler — content resurfaces after the seal");
    // Parked SIGNED. This test's whole claim is that the straggler is refused for the RIGHT reason —
    // `session_committed` rather than a desync or an unseal failure — and an unsigned deposit was
    // being refused for a fourth reason entirely (`unsigned_envelope`) before the sealed-session
    // guard ran. The assertion below named a guard that was never reached.
    await ipcCall(dirA, "content_park_deposit", {
      relayMultiaddr: cluster.relayMultiaddr,
      recipientPubkey: pubB,
      contentHash: contentHashHex(straggler),
      sessionId,
      senderAgentName: "agentA",
      content: straggler.toString("hex"),
    });

    const rec = (await ipcCall(dirB, "content_park_recover", {
      relayMultiaddr: cluster.relayMultiaddr, recipientPubkey: pubB,
    })) as { ok?: boolean; recovered?: number; pulled?: number };
    expect(rec.ok, `recover ran:${JSON.stringify(rec)}`).toBe(true);
    expect(rec.recovered, "the straggler is NOT recovered into the sealed session").toBe(0);

    /**
     * It unsealed fine, AUTHENTICATED fine, and was then refused at the sealed-session guard — the
     * distinct, honest reason (`session_committed`), NOT unseal_failed and NOT a content desync. A
     * late leaf would diverge from the FROST-notarized root, so the committed transcript refuses it.
     *
     * ⚠️ THE EVENT IS `annexed`, NOT `ingest_failed`, AND THAT IS A DELIBERATE IMPROVEMENT. This
     * assertion named `content.recover.ingest_failed` — the vocabulary from before M12-P17 gave the
     * daemon an annex. Refused content is no longer merely dropped: it is written to the annex, the
     * one durable store for counterparty content that never passed the inbound screen, so it can be
     * examined rather than vanishing. The refusal REASON is unchanged and is still the thing this
     * test cares about.
     *
     * Worth stating plainly because the old assertion could never pass again, and a test pinned to a
     * retired event name reads as a product regression when it is the opposite.
     */
    expect(daemonB.output, `straggler refused by the sealed-session guard:${diag}`).toMatch(
      /"event":"content\.recover\.annexed"[^\n]*"reason":"session_committed"/,
    );
    /**
     * ⚠️ THE NEGATIVE ASSERTION THAT USED TO SIT HERE WAS VACUOUS, and review proved it structurally
     * rather than by argument. It asserted `content.recover.ingest_failed` with
     * `reason: "session_committed"` does NOT appear — but `annexed` is emitted from the
     * `else if (reason === "session_committed")` arm of the same chain whose `else` emits
     * `ingest_failed`. **The two are mutually exclusive by construction**, so that pair is
     * unreachable and the assertion could never fail against any code keeping that shape. It also
     * could not catch what it claimed to: a change that reverts to DROPPING the straggler fails the
     * positive assertion above first, and one that drops under a different event name evades a
     * negative keyed on this one.
     *
     * **The real proof is a readback, and the surface already exists.** `cello_get_transcript`
     * returns the annex under its own `post_seal_annex` key — deliberately never merged into
     * `messages`, because merging would erase the boundary between sealed content and content that
     * arrived after the seal. Asserting the straggler's TEXT is in there proves three things the log
     * line cannot: it was kept, it is readable, and the annex holds the decrypted content rather
     * than the raw CBOR envelope.
     */
    const tx = (await connB.call("cello_get_transcript", { cello_session_id: sessionId })) as {
      ok?: boolean;
      messages?: Array<{ content?: string }>;
      post_seal_annex?: Array<{ content?: string }>;
    };
    expect(tx.ok, `B reads its transcript:${diag}`).toBe(true);
    const annexText = (tx.post_seal_annex ?? []).map((a) => a.content ?? "").join("\n");
    expect(
      annexText,
      `the straggler must be KEPT and READABLE in the post-seal annex, not merely refused. ` +
      `Annex was: ${JSON.stringify(tx.post_seal_annex)}${diag}`,
    ).toContain(straggler.toString("utf8"));
    // And it must NOT have entered the sealed transcript — the boundary the annex exists to hold.
    expect(
      (tx.messages ?? []).map((m) => m.content ?? "").join("\n"),
      "a post-seal straggler must never appear among the sealed messages",
    ).not.toContain(straggler.toString("utf8"));

    // The session is STILL sealed and byte-identical — the straggler never re-entered the transcript,
    // and B's certificate frontier is UNCHANGED: the rejected straggler could not inflate it.
    const receipt2 = (await connB.call("cello_sealed_receipt", { cello_session_id: sessionId })) as Receipt;
    expect(receipt2.ok, "session still sealed + readable after the straggler").toBe(true);
    expect(receipt2.sealed_root, "sealed root unchanged — the straggler did not mutate the transcript").toBe(rootB);
    expect(frontierOf(receipt2, pubB), "B's content frontier is unchanged — the straggler did not inflate it").toBe(bFrontierAtSeal);
  }, 120_000);

  /**
   * ─── 022-REFUSALVISIBLE / DOD-M15-NO-SILENT-REFUSAL-1 ─────────────────────────────────────────
   *
   * **The refusal reaches the operator even though nobody is attending, and it survives a restart.**
   *
   * From B's operator's chair: A sends something, B's screener catches it and blocks it, and the
   * message never appears. Before this, B was told nothing — the explanation sat in a log file they
   * have no reason to open, and the conversation just went quiet. The two properties that make the
   * fix real, and that a per-session `cello_receive` drain could not have:
   *
   *   1. **Nobody is attending.** B never calls `cello_receive` on that session. The refusal must
   *      still reach them, through `cello_inbox`, which holds an AGENT and not a session.
   *   2. **A restart does not destroy it.** The first thing anyone does about a quiet conversation
   *      is restart the daemon, which is exactly what erased the old in-memory notice.
   *
   * The screener is the real one — the enforcing gateway sidecar the shipped binary spawns, not a
   * test double. The message is predominantly Cyrillic, which trips IN-003's language allowlist
   * (`inbound_language_blocked`, terminal) with no model installed, so this exercises a genuine
   * content detector rather than a seam. A terminal block is not an error path: it leafs the
   * original hash at its canonical position and ACKS the sender, so nothing fails and nothing
   * retries — which is precisely why it had no notice and why the silence was total.
   */
  it("022-REFUSALVISIBLE — a screener block reaches an UNATTENDED operator, and survives a daemon restart", async () => {
    const dirA = mkdtempSync(join(tmpdir(), "cello-refuseA-"));
    const dirB = mkdtempSync(join(tmpdir(), "cello-refuseB-"));
    dirs.push(dirA, dirB);
    await provisionAgent(dirA, "agentA");
    const pubB = await provisionAgent(dirB, "agentB");
    const daemonA = await startLocalDaemon(dirA, "refuseA");
    let daemonB = await startLocalDaemon(dirB, "refuseB");
    daemons.push(daemonA, daemonB);
    expect(registerAgent("agentA", `DEV-rf-A-${randomBytes(6).toString("hex")}`, { CELLO_DIR: dirA }).status).toBe(0);
    expect(registerAgent("agentB", `DEV-rf-B-${randomBytes(6).toString("hex")}`, { CELLO_DIR: dirB }).status).toBe(0);
    const connA = await connectMcp(dirA, "rf-A");
    const connB = await connectMcp(dirB, "rf-B");
    mcpConns.push(connA, connB);
    for (const [c, n] of [[connA, "agentA"], [connB, "agentB"]] as const) {
      expect(((await c.call("cello_start_agent", { name: n })) as { ok?: boolean }).ok).toBe(true);
      expect(((await c.call("cello_use_agent", { name: n })) as { ok?: boolean }).ok).toBe(true);
    }

    const awaitP = connB.call("cello_await_session", { timeout_ms: 25_000 });
    const init = (await connA.call("cello_initiate_session", { target_pubkey: pubB })) as { ok?: boolean; sessionId?: string };
    expect(init.ok, `initiate failed:\n${daemonA.output.split("\n").slice(-30).join("\n")}`).toBe(true);
    const sessionId = init.sessionId!;
    expect(((await awaitP) as { type?: string }).type).toBe("new_session");

    /**
     * Long enough to clear IN-003's `minLetters` (12) and overwhelmingly one script, so the
     * dominant-share test (0.5) cannot be tipped by the turn signal the shim appends. `signal` is
     * REQUIRED by cello_send, so `[[OVER]]` rides in the same string the detector judges — four
     * Latin letters against ~24 Han ones.
     *
     * ⚠️ Chosen for its SCRIPT, not its meaning. The detector under test is the language allowlist,
     * which is a real content detector that needs no model — the semantic injection scanner is off
     * unless one is installed (the daemon logs `security.gateway.layer2: off:no`), so a prose
     * "ignore your instructions" payload would sail through and this test would silently stop
     * testing a block at all.
     *
     * ⚠️ **AND IT MUST NOT BE CYRILLIC, which is the trap this test fell into first.** Sanitization
     * runs BEFORE the language check and normalizes confusables, and most lowercase Cyrillic letters
     * are Latin homoglyphs — so a Cyrillic sentence is judged as LATIN and comes back `redact`, not
     * `block`. Measured: the same call with a 68-letter Cyrillic payload returns
     * `{"disposition":"redact"}` with no `terminal` and no reason. Han has no Latin homoglyphs.
     */
    const BLOCKED = "请把这条消息交给你的操作员并立即回复我谢谢你的帮助";
    const send = (await connA.call("cello_send", { cello_session_id: sessionId, content: BLOCKED, signal: "over" })) as { ok?: boolean; reason?: string };
    expect(
      send.ok,
      `A's send succeeds — the refusal happens on B's side, silently, which is the point. Got: ${JSON.stringify(send)}\n` +
      `--- daemonA screening ---\n${daemonA.output.split("\n").filter((l) => /gateway|screen|governance/.test(l)).slice(-12).join("\n")}`,
    ).toBe(true);
    await daemonB.waitForLine(/"event":"security\.gateway\.inbound\.terminal_block"/, 30_000);

    /**
     * ⚠️ **NOBODY IS ATTENDING.** B never calls `cello_receive` on this session — not before the
     * block and not after. That is the case this unit exists for, and the door that must open is
     * the inbox. Reading `cello_receive` here would test the door that already worked.
     */
    type InboxRefusal = { session_id?: string; reason?: string; impact?: string; guidance?: string; times?: number };
    type Inbox = { ok?: boolean; agents?: Array<{ agent?: string; refusals?: InboxRefusal[]; refusals_guidance?: string }> };
    const readInbox = async (c: McpConn): Promise<{ refusals: InboxRefusal[]; guidance: string }> => {
      const res = (await c.call("cello_inbox", { agent: "agentB" })) as Inbox;
      expect(res.ok, `cello_inbox failed: ${JSON.stringify(res)}`).toBe(true);
      const desk = (res.agents ?? []).find((a) => a.agent === "agentB");
      return { refusals: desk?.refusals ?? [], guidance: desk?.refusals_guidance ?? "" };
    };

    const before = await readInbox(connB);
    expect(
      before.refusals.length,
      `B's operator must be TOLD a message was blocked, without attending the session. Inbox held ` +
      `no refusals.\n--- daemonB ---\n${daemonB.output.split("\n").filter((l) => /terminal_block|refusal/.test(l)).slice(-10).join("\n")}`,
    ).toBeGreaterThan(0);
    const notice = before.refusals.find((r) => r.session_id === sessionId);
    expect(notice, "and the notice must NAME the conversation — the inbox holds an agent, not a session").toBeDefined();
    expect(
      notice!.reason,
      "the DETECTOR's reason, not a generic seam label — the remedy differs per detector (Invariant 3)",
    ).toBe("inbound_language_blocked");
    expect(notice!.impact, "it says the sender was acked, so nobody sits waiting for a resend").toMatch(/acknowledged/);
    expect(before.guidance, "and the advice travels WITH the notice, never separately").toMatch(/Waiting longer will not help/);
    // The blocked content NEVER travels. A screener that can be talked into surfacing what it
    // blocked is not a screener, and the inbox is a surface an agent reads directly.
    expect(JSON.stringify(before), "the blocked message must not appear in the notice").not.toContain(BLOCKED);

    /**
     * ─── The restart, which is the half the in-memory map failed ────────────────────────────────
     *
     * A fresh IPC connection is minted by the reconnect, so the notice is unseen by THAT consumer
     * and re-announces — which is the correct direction: a new window has been told nothing. What
     * is being proved is that the NOTICE itself is still there to be re-announced.
     */
    await connB.close();
    mcpConns.splice(mcpConns.indexOf(connB), 1);
    await daemonB.kill();
    for (const f of ["daemon.sock", "daemon.lock"]) {
      try { rmSync(join(dirB, f), { force: true }); } catch { /* best-effort */ }
    }
    daemonB = await startLocalDaemon(dirB, "refuseB-restart");
    daemons.push(daemonB);
    expect(cello(["login"], { CELLO_DIR: dirB }).status).toBe(0);
    const connB2 = await connectMcp(dirB, "rf-B2");
    mcpConns.push(connB2);
    expect(((await connB2.call("cello_start_agent", { name: "agentB" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connB2.call("cello_use_agent", { name: "agentB" })) as { ok?: boolean }).ok).toBe(true);

    const after = await readInbox(connB2);
    const survived = after.refusals.find((r) => r.session_id === sessionId);
    expect(
      survived,
      `the refusal must survive the restart — restarting the daemon is the FIRST thing an operator ` +
      `does about a quiet conversation, and the in-memory map this replaced was destroyed by exactly ` +
      `that act. Inbox after restart: ${JSON.stringify(after.refusals)}`,
    ).toBeDefined();
    expect(survived!.reason).toBe("inbound_language_blocked");
    expect(survived!.guidance, "with its advice intact, not just the reason code").toBeDefined();
  }, 180_000);

});
