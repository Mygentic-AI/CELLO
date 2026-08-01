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
  registerAgent,
  ipcCall,
  writeConsortiumManifest,
  writeSignedManifestTo,
  type SpineCluster,
  type Proc,
  type McpConn,
} from "./live-harness.js";
import { spineDirectoryNode, spineNodeKeypair } from "./auth-manifest.js";
import { sealToRecipient, contentHashHex } from "./content-seal-fixture.js";

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
    const daemonA = await startLocalDaemon(dirA, "msgA");
    const daemonB = await startLocalDaemon(dirB, "msgB");
    daemons.push(daemonA, daemonB);
    // DOD-LOOP-1: the standing receiver is now PER-AGENT (created by cello_start_agent) — there is
    // no per-daemon standing receiver at initialize() anymore. The outbound deposit (A) and pull (B)
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
    const recv = (await connB.call("cello_receive", { cello_session_id: sessionId })) as { ok?: boolean; content?: string | null };
    expect(recv.ok).toBe(true);
    expect(recv.content, "B reads the exact parked plaintext it had missed").toBe(PARKED);
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
    const msgBytes = Buffer.from(msg);
    const hashHex = contentHashHex(msgBytes);
    expect(((await connA.call("cello_send", { cello_session_id: sessionId, content: msg, signal: "over" })) as { ok?: boolean }).ok).toBe(true);
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
    const hashHex = contentHashHex(Buffer.from(msg));
    expect(((await connA.call("cello_send", { cello_session_id: sessionId, content: msg, signal: "over" })) as { ok?: boolean }).ok).toBe(true);

    // The ladder reaches `persisted` and the sender acts on it (content.delivery.acked, level persisted).
    const acked = await daemonA.waitForLine(new RegExp(`"event":"content\\.delivery\\.acked"[^\\n]*"contentHash":"${hashHex}"`), 12_000);
    expect(acked, "the protocol acts on the persisted ACK").toMatch(/"level":"persisted"/);

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
    const read = async () => ((await connB.call("cello_receive", { cello_session_id: sessionId })) as { ok?: boolean; content?: string | null }).content;
    expect(await read()).toBe("first");
    expect(await read()).toBe("second");
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

    // The agent-online hook auto-recovers — no explicit recover IPC. Prove it fired and delivered.
    const auto = await daemonB.waitForLine(/"event":"content\.recover\.auto\.completed"/, 25_000);
    expect(auto).toMatch(/"recovered":1/);
    expect(daemonB.output, "auto-recovered content traverses the inbound funnel").toMatch(/"event":"session\.content\.received"/);

    const recv = (await connB.call("cello_receive", { cello_session_id: sessionId })) as { ok?: boolean; content?: string | null };
    expect(recv.ok).toBe(true);
    expect(recv.content, "B reads the parked message WITHOUT any explicit content_park_recover").toBe(PARKED);
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
    expect(((await connB.call("cello_receive", { cello_session_id: sessionId, timeout_ms: 15_000 })) as { content?: string | null }).content).toBe("msg1");

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
    expect(closeB.sealed_root, `both sealed_root identical:${diag}`).toBe(closeA.sealed_root);

    // HONEST seal: B reads its certificate and the actual per-party content frontier. B received
    // exactly one in-session message (msg1), so B's signed frontier reflects that — never more.
    type LegPart = { pubkey: string; content_frontier_seq: number };
    type Receipt = { ok?: boolean; sealed_root?: string; legibility?: { participants: LegPart[] } };
    const receipt = (await connB.call("cello_get_sealed_receipt", { session_id: sessionId })) as Receipt;
    expect(receipt.ok, `B reads the sealed receipt:${diag}`).toBe(true);
    expect(receipt.sealed_root, `receipt root matches the seal:${diag}`).toBe(closeB.sealed_root);
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
    await ipcCall(dirA, "content_park_deposit", {
      relayMultiaddr: cluster.relayMultiaddr,
      recipientPubkey: pubB,
      contentHash: contentHashHex(straggler),
      sessionId,
      ciphertext: Buffer.from(sealToRecipient(Buffer.from(pubB, "hex"), straggler)).toString("hex"),
    });

    const rec = (await ipcCall(dirB, "content_park_recover", {
      relayMultiaddr: cluster.relayMultiaddr, recipientPubkey: pubB,
    })) as { ok?: boolean; recovered?: number; pulled?: number };
    expect(rec.ok, `recover ran:${JSON.stringify(rec)}`).toBe(true);
    expect(rec.recovered, "the straggler is NOT recovered into the sealed session").toBe(0);

    // It unsealed fine but was refused at the sealed-session guard — the distinct, honest reason
    // (`session_committed`), NOT unseal_failed and NOT a content desync. A late leaf would diverge
    // from the FROST-notarized root, so the committed transcript refuses it.
    expect(daemonB.output, `straggler refused by the sealed-session guard:${diag}`).toMatch(
      /"event":"content\.recover\.ingest_failed"[^\n]*"reason":"session_committed"/,
    );

    // The session is STILL sealed and byte-identical — the straggler never re-entered the transcript,
    // and B's certificate frontier is UNCHANGED: the rejected straggler could not inflate it.
    const receipt2 = (await connB.call("cello_get_sealed_receipt", { session_id: sessionId })) as Receipt;
    expect(receipt2.ok, "session still sealed + readable after the straggler").toBe(true);
    expect(receipt2.sealed_root, "sealed root unchanged — the straggler did not mutate the transcript").toBe(closeB.sealed_root);
    expect(frontierOf(receipt2, pubB), "B's content frontier is unchanged — the straggler did not inflate it").toBe(bFrontierAtSeal);
  }, 120_000);

});
