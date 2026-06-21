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
});
