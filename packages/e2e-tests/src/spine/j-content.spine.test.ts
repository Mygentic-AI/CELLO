/**
 * J-CONTENT — live binary content delivery (M7-DEFINITION-OF-DONE.md §"verification
 * harness", journey 5; DOD-MSG-* / MSG-001-3b).
 *
 * INCREMENT 1 — the daemon↔relay content-park TRANSPORT in isolation. A message must
 * survive the recipient being OFFLINE: the sender DEPOSITS ciphertext keyed to the
 * recipient's pubkey into the relay's store-and-forward mailbox; when the recipient comes
 * online it PULLS its parked entries (proving identity via the relay's auth challenge).
 * The relay holds CIPHERTEXT only (INV-3 — it is a hash custodian, not a data custodian).
 *
 * This increment proves the transport round-trip directly (via the daemon's content-park
 * IPC handlers, the same approach DOD-RETRY-1 used) BEFORE the send/receive-path
 * integration (increment 2: cello_send parks when B is offline; increment 3: B pulls +
 * verifies + accepts on online) and recovery/dedup (DOD-MSG-4/5).
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
  cello,
  ipcCall,
  type SpineCluster,
  type Proc,
  type McpConn,
} from "./live-harness.js";
import { sealToRecipient, contentHashHex } from "./content-seal-fixture.js";

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

interface PullResult {
  ok?: boolean;
  entries?: Array<{ contentHash: string; sessionId: string; ciphertext: string }>;
}

describe("J-CONTENT — relay store-and-forward, live (DOD-MSG-3 / MSG-001-3b)", () => {
  it("DOD-MSG-3 (transport) — deposit ciphertext for an offline recipient → recipient pulls the SAME bytes", async () => {
    const dirA = mkdtempSync(join(tmpdir(), "cello-msgA-"));
    const dirB = mkdtempSync(join(tmpdir(), "cello-msgB-"));
    dirs.push(dirA, dirB);
    await provisionAgent(dirA, "agentA");
    const pubB = await provisionAgent(dirB, "agentB"); // recipient K_local (the mailbox key)
    const daemonA = await startDaemon(dirA, cluster.directoryUrl, "msgA");
    const daemonB = await startDaemon(dirB, cluster.directoryUrl, "msgB");
    daemons.push(daemonA, daemonB);

    const sessionId = randomBytes(16).toString("hex");
    const contentHash = randomBytes(32).toString("hex");
    const ciphertext = randomBytes(160).toString("hex"); // opaque to the relay (sealed in increment 2)

    // A deposits FOR B while B has never connected for content — pure store-and-forward.
    const dep = (await ipcCall(dirA, "content_park_deposit", {
      relayMultiaddr: cluster.relayMultiaddr,
      recipientPubkey: pubB,
      contentHash,
      sessionId,
      ciphertext,
    })) as { ok?: boolean; reason?: string };
    expect(dep.ok, `deposit failed: ${JSON.stringify(dep)}`).toBe(true);

    // B pulls — proving ownership of pubB via the relay's Ed25519 auth challenge.
    const pull = (await ipcCall(dirB, "content_park_pull", {
      relayMultiaddr: cluster.relayMultiaddr,
      recipientPubkey: pubB,
    })) as PullResult;
    expect(pull.ok, `pull failed: ${JSON.stringify(pull)}`).toBe(true);

    const got = (pull.entries ?? []).find((e) => e.contentHash === contentHash);
    expect(got, `B must receive the parked entry:\n${JSON.stringify(pull)}`).toBeTruthy();
    // Round-trip integrity through the real relay: B gets the EXACT bytes A deposited.
    expect(got!.ciphertext, "the recipient pulls the same ciphertext the sender deposited").toBe(ciphertext);
    expect(got!.sessionId, "the parked entry carries the session id").toBe(sessionId);

    // INV-3: the relay witnessed a deposit it could store + serve, but it only ever held
    // CIPHERTEXT — the random blob is opaque, and the relay logs byte counts, not content.
    // (The round-trip itself proves the relay received+stored+served; this is corroboration.)
    expect(cluster.relay.output).toMatch(/"event":"content\.park\.received"|content\.park\.received/);
  }, 60_000);

  it("DOD-MSG-3 (send park) — A sends to an offline recipient → hash witnessed + content auto-parked (R1)", async () => {
    const dirA = mkdtempSync(join(tmpdir(), "cello-sendparkA-"));
    const dirB = mkdtempSync(join(tmpdir(), "cello-sendparkB-"));
    dirs.push(dirA, dirB);
    await provisionAgent(dirA, "agentA");
    const pubB = await provisionAgent(dirB, "agentB");
    const daemonA = await startDaemon(dirA, cluster.directoryUrl, "sendparkA");
    const daemonB = await startDaemon(dirB, cluster.directoryUrl, "sendparkB");
    daemons.push(daemonA, daemonB);
    expect(cello(["register", "agentA", `DEV-sp-A-${randomBytes(6).toString("hex")}`], { CELLO_DIR: dirA }).status).toBe(0);
    expect(cello(["register", "agentB", `DEV-sp-B-${randomBytes(6).toString("hex")}`], { CELLO_DIR: dirB }).status).toBe(0);

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
    expect(((await connA.call("cello_send", { session_id: sessionId, content: "while-online" })) as { ok?: boolean }).ok).toBe(true);

    // ── B goes OFFLINE. ──
    await connB.close();
    mcpConns.splice(mcpConns.indexOf(connB), 1);
    await daemonB.stop();

    // A sends again — direct delivery now fails (B is down). R1: the hash is still witnessed
    // (sequence assigned), and 2b deposits the SEALED content to the relay store-and-forward.
    await connA.call("cello_send", { session_id: sessionId, content: "while-offline — must park" });

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
    const daemonA = await startDaemon(dirA, cluster.directoryUrl, "recA");
    let daemonB = await startDaemon(dirB, cluster.directoryUrl, "recB");
    daemons.push(daemonA, daemonB);
    expect(cello(["register", "agentA", `DEV-rec-A-${randomBytes(6).toString("hex")}`], { CELLO_DIR: dirA }).status).toBe(0);
    expect(cello(["register", "agentB", `DEV-rec-B-${randomBytes(6).toString("hex")}`], { CELLO_DIR: dirB }).status).toBe(0);

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
    expect(((await connA.call("cello_send", { session_id: sessionId, content: "msg1-online" })) as { ok?: boolean }).ok).toBe(true);

    // ── B goes OFFLINE (abrupt crash — lid-shut/SIGKILL, so on restart the session is
    // detected 'interrupted' with source daemon_restart); A sends the message that gets parked. ──
    await connB.close();
    mcpConns.splice(mcpConns.indexOf(connB), 1);
    await daemonB.kill();
    const PARKED = "msg2-while-offline — the message B must recover";
    await connA.call("cello_send", { session_id: sessionId, content: PARKED });
    await daemonA.waitForLine(/"event":"content\.park\.deposited"/, 25_000);

    // ── B comes back: its session is now 'interrupted'; B recovers the parked content. ──
    for (const f of ["daemon.sock", "daemon.lock"]) {
      try { rmSync(join(dirB, f), { force: true }); } catch { /* best-effort */ }
    }
    daemonB = await startDaemon(dirB, cluster.directoryUrl, "recB-restart");
    daemons.push(daemonB);
    await daemonB.waitForLine(/"event":"session\.interrupted\.detected"/, 15_000);
    expect(cello(["login"], { CELLO_DIR: dirB }).status).toBe(0);
    connB = await connectMcp(dirB, "rec-B2");
    mcpConns.push(connB);
    expect(((await connB.call("cello_start_agent", { name: "agentB" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connB.call("cello_use_agent", { name: "agentB" })) as { ok?: boolean }).ok).toBe(true);

    const rec = (await ipcCall(dirB, "content_park_recover", { relayMultiaddr: cluster.relayMultiaddr, recipientPubkey: pubB })) as { ok?: boolean; recovered?: number };
    expect(rec.ok, `recover failed: ${JSON.stringify(rec)}`).toBe(true);
    expect(rec.recovered, "exactly the one parked message is recovered").toBe(1);

    // M9 single-inbound-funnel AC: the recovered content traversed ingestReceivedContent (the SAME
    // chokepoint as a direct receive), evidenced by session.content.received with its sequence.
    expect(daemonB.output, "recovered content must traverse the inbound chokepoint").toMatch(
      /"event":"session\.content\.received"/,
    );
    expect(daemonB.output).toMatch(/"event":"content\.recovered"/);

    // And it surfaces as readable PLAINTEXT via cello_receive — not raw ciphertext around the funnel.
    const recv = (await connB.call("cello_receive", { session_id: sessionId })) as { ok?: boolean; content?: string | null };
    expect(recv.ok).toBe(true);
    expect(recv.content, "B reads the exact parked plaintext it had missed").toBe(PARKED);
  }, 120_000);

  it("DOD-MSG-7 (desync only on tamper) — tampered parked content is the ONLY desync; recovery-failure keeps the session alive", async () => {
    const dirA = mkdtempSync(join(tmpdir(), "cello-tamperA-"));
    const dirB = mkdtempSync(join(tmpdir(), "cello-tamperB-"));
    dirs.push(dirA, dirB);
    await provisionAgent(dirA, "agentA");
    const pubB = await provisionAgent(dirB, "agentB");
    const daemonA = await startDaemon(dirA, cluster.directoryUrl, "tamperA");
    const daemonB = await startDaemon(dirB, cluster.directoryUrl, "tamperB");
    daemons.push(daemonA, daemonB);
    expect(cello(["register", "agentA", `DEV-tp-A-${randomBytes(6).toString("hex")}`], { CELLO_DIR: dirA }).status).toBe(0);
    expect(cello(["register", "agentB", `DEV-tp-B-${randomBytes(6).toString("hex")}`], { CELLO_DIR: dirB }).status).toBe(0);
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

    const pubBBytes = Buffer.from(pubB, "hex");
    const dep = (cipher: Uint8Array, hashHex: string) =>
      ipcCall(dirA, "content_park_deposit", {
        relayMultiaddr: cluster.relayMultiaddr,
        recipientPubkey: pubB,
        contentHash: hashHex,
        sessionId,
        ciphertext: Buffer.from(cipher).toString("hex"),
      });

    // (1) HONEST — sealed content whose hash MATCHES. Must be accepted (round-trip proof too).
    const honest = Buffer.from("honest recovered message");
    await dep(sealToRecipient(pubBBytes, honest), contentHashHex(honest));
    // (2) TAMPER — a VALID seal of real content, deposited with the hash of DIFFERENT content.
    //     Decrypts fine, but the cross-check fails → content_hash_mismatch (the ONE desync).
    const realContent = Buffer.from("the actual sealed bytes");
    await dep(sealToRecipient(pubBBytes, realContent), contentHashHex(Buffer.from("a different message entirely")));
    // (3) RECOVERY-FAILURE — not a valid seal at all. openContentSeal fails → skipped, NOT a desync.
    await dep(new Uint8Array(randomBytes(160)), contentHashHex(Buffer.from("whatever")));

    const rec = (await ipcCall(dirB, "content_park_recover", { relayMultiaddr: cluster.relayMultiaddr, recipientPubkey: pubB })) as { ok?: boolean; recovered?: number; pulled?: number };
    expect(rec.ok).toBe(true);
    expect(rec.pulled, "all three parked entries pulled").toBe(3);
    // ONLY the honest one is recovered — tamper + corrupt are rejected, neither lands.
    expect(rec.recovered, "only the honest entry is accepted").toBe(1);

    const tail = daemonB.output;
    // Tamper → the ONE content-path desync signal.
    expect(tail, "tampered content → content_hash_mismatch").toMatch(/content_hash_mismatch/);
    // Recovery-failure → distinct, NON-desync outcome (skipped).
    expect(tail, "unsealable content → recovery-failure, not desync").toMatch(/"event":"content\.recover\.unseal_failed"/);
    // Honest → accepted (proves the harness seal round-trips through the daemon's openContentSeal).
    expect(tail, "honest content recovered").toMatch(/"event":"content\.recovered"/);

    // The session stays ALIVE despite tamper+corrupt: B still reads the honest message.
    const recv = (await connB.call("cello_receive", { session_id: sessionId })) as { ok?: boolean; content?: string | null };
    expect(recv.ok).toBe(true);
    expect(recv.content, "session alive — the honest message is readable").toBe(honest.toString("utf8"));
  }, 120_000);

  it("DOD-MSG-5 (dedup) — a message arriving BOTH directly and via park yields exactly ONE leaf", async () => {
    const dirA = mkdtempSync(join(tmpdir(), "cello-dedupA-"));
    const dirB = mkdtempSync(join(tmpdir(), "cello-dedupB-"));
    dirs.push(dirA, dirB);
    await provisionAgent(dirA, "agentA");
    const pubB = await provisionAgent(dirB, "agentB");
    const daemonA = await startDaemon(dirA, cluster.directoryUrl, "dedupA");
    const daemonB = await startDaemon(dirB, cluster.directoryUrl, "dedupB");
    daemons.push(daemonA, daemonB);
    expect(cello(["register", "agentA", `DEV-dd-A-${randomBytes(6).toString("hex")}`], { CELLO_DIR: dirA }).status).toBe(0);
    expect(cello(["register", "agentB", `DEV-dd-B-${randomBytes(6).toString("hex")}`], { CELLO_DIR: dirB }).status).toBe(0);
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
    const msgBytes = Buffer.from(msg);
    const hashHex = contentHashHex(msgBytes);
    expect(((await connA.call("cello_send", { session_id: sessionId, content: msg })) as { ok?: boolean }).ok).toBe(true);
    const firstReceive = await daemonB.waitForLine(new RegExp(`"event":"session\\.content\\.received"[^\\n]*"contentHashHex":"${hashHex}"`), 15_000);
    expect(firstReceive).toMatch(/"sequenceNumber":0/);

    // Now the SAME message also shows up via the relay park (the direct+park overlap). B recovers it.
    await ipcCall(dirA, "content_park_deposit", {
      relayMultiaddr: cluster.relayMultiaddr,
      recipientPubkey: pubB,
      contentHash: hashHex,
      sessionId,
      ciphertext: Buffer.from(sealToRecipient(Buffer.from(pubB, "hex"), msgBytes)).toString("hex"),
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
});
