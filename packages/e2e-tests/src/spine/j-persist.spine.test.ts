/**
 * J-PERSIST — DOD-LOG-1 (PERSIST-LOG-001), live binaries. The durable, encrypted-at-rest,
 * readable conversation transcript survives a daemon RESTART.
 *
 * The daemon persists the hash chain (session_tree_leaves) but the readable plaintext lived only
 * in an in-memory buffer evicted on shutdown — so after a restart you had a chain of opaque hashes,
 * not a readable conversation. This test proves the new durable transcript store: A and B exchange
 * messages, B's daemon is KILLED and restarted on the same CELLO_DIR, and B reads the full
 * transcript back — sent + received, in canonical order — via cello_get_transcript. INV-3: the
 * relay and directory never saw the plaintext (only hashes/ciphertext), and it is encrypted at rest.
 *
 * Anchored to the binary — real cello-directory + cello-relay + cello-daemon + cello-mcp.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
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
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

type Transcript = { ok?: boolean; messages?: Array<{ sequence: number; direction: string; text: string }> };

describe("J-PERSIST — durable encrypted transcript survives restart (DOD-LOG-1)", () => {
  it("A↔B exchange → kill+restart B's daemon → B reads the full transcript back in order; relay/directory never saw plaintext", async () => {
    const dirA = mkdtempSync(join(tmpdir(), "cello-perA-"));
    const dirB = mkdtempSync(join(tmpdir(), "cello-perB-"));
    dirs.push(dirA, dirB);
    const pubB = await provisionAgent(dirB, "agentB");
    await provisionAgent(dirA, "agentA");
    const daemonA = await startDaemon(dirA, cluster.directoryUrl, "perA");
    let daemonB = await startDaemon(dirB, cluster.directoryUrl, "perB");
    daemons.push(daemonA, daemonB);
    expect(cello(["register", "agentA", `DEV-per-A-${randomBytes(6).toString("hex")}`], { CELLO_DIR: dirA }).status).toBe(0);
    expect(cello(["register", "agentB", `DEV-per-B-${randomBytes(6).toString("hex")}`], { CELLO_DIR: dirB }).status).toBe(0);

    const connA = await connectMcp(dirA, "per-A");
    let connB = await connectMcp(dirB, "per-B1");
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

    // Distinctive plaintext needles so the INV-3 check is unambiguous.
    const M1 = "PERSIST-NEEDLE-alpha hello from A";   // A → B (B: received)
    const M2 = "PERSIST-NEEDLE-bravo hi back from B"; // B → A (B: sent)
    const M3 = "PERSIST-NEEDLE-charlie second from A"; // A → B (B: received)
    expect(((await connA.call("cello_send", { session_id: sessionId, content: M1 })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connB.call("cello_receive", { session_id: sessionId, timeout_ms: 15_000 })) as { content?: string | null }).content).toBe(M1);
    expect(((await connB.call("cello_send", { session_id: sessionId, content: M2 })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connA.call("cello_receive", { session_id: sessionId, timeout_ms: 15_000 })) as { content?: string | null }).content).toBe(M2);
    expect(((await connA.call("cello_send", { session_id: sessionId, content: M3 })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connB.call("cello_receive", { session_id: sessionId, timeout_ms: 15_000 })) as { content?: string | null }).content).toBe(M3);

    // ── KILL B's daemon and restart it on the SAME CELLO_DIR (the in-memory buffer is gone). ──
    await connB.close();
    await daemonB.stop();
    daemonB = await startDaemon(dirB, cluster.directoryUrl, "perB-restart");
    daemons.push(daemonB);
    // startDaemon already waited for daemon.started; the transcript store is keyed by
    // (agent, session_id) independent of session status, so no interrupted-detection wait is needed.
    expect(cello(["login"], { CELLO_DIR: dirB }).status).toBe(0);
    connB = await connectMcp(dirB, "per-B2");
    mcpConns.push(connB);
    expect(((await connB.call("cello_start_agent", { name: "agentB" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connB.call("cello_use_agent", { name: "agentB" })) as { ok?: boolean }).ok).toBe(true);

    // ── The transcript is recovered from the durable, encrypted store — NOT just hashes. ──
    const tr = (await connB.call("cello_get_transcript", { session_id: sessionId })) as Transcript;
    expect(tr.ok, `transcript read failed: ${JSON.stringify(tr)}`).toBe(true);
    const msgs = tr.messages ?? [];
    // B's transcript: received M1, sent M2, received M3 — three readable messages after a restart.
    const texts = msgs.map((m) => m.text);
    expect(texts, `B must recover all three messages after restart:\n${JSON.stringify(msgs, null, 2)}`).toEqual([M1, M2, M3]);
    // Direction is honest, and ordered by the canonical leaf sequence (joins the hash chain).
    expect(msgs.map((m) => m.direction)).toEqual(["received", "sent", "received"]);
    expect(msgs.map((m) => m.sequence)).toEqual([...msgs.map((m) => m.sequence)].sort((a, b) => a - b));

    // ── INV-3: the relay + directory NEVER saw the plaintext (only hashes/ciphertext). ──
    for (const needle of [M1, M2, M3]) {
      expect(cluster.relay.output, "relay must never see plaintext").not.toContain(needle);
      expect(cluster.directory.output, "directory must never see plaintext").not.toContain(needle);
    }

    // ── Encrypted at rest: the plaintext needles are NOT present in the daemon's on-disk DB file. ──
    const dbFiles = readdirSync(dirB).filter((f) => f.endsWith(".db") || f.endsWith(".sqlite") || f === "cello.db");
    // Find the actual DB file(s) under dirB (the daemon names it cello-daemon.db or similar).
    const allFiles = readdirSync(dirB);
    const candidates = dbFiles.length > 0 ? dbFiles : allFiles.filter((f) => /\.db$|sqlite/i.test(f));
    expect(candidates.length, `expected a daemon DB file under ${dirB}; saw ${allFiles.join(", ")}`).toBeGreaterThan(0);
    for (const f of candidates) {
      const raw = readFileSync(join(dirB, f)).toString("latin1");
      for (const needle of [M1, M2, M3]) {
        expect(raw, `plaintext "${needle}" must NOT appear in the at-rest DB file ${f}`).not.toContain(needle);
      }
    }
  }, 150_000);
});
