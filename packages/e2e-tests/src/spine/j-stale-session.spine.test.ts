/**
 * THE ONE OPEN PROBLEM, reproduced or disproved on real processes.
 *
 * Symptom seen on the live fleet 2026-08-16: after a daemon restart, a document frame sent over a
 * session that PREDATES the restart was reported sent (`noticeSent: true`, `parked: true`) and the
 * peer never got it. It surfaced as an invitation that took about four minutes — the recovery was
 * a fresh session being built later, not the frame arriving.
 *
 * This journey does nothing clever: two real daemons, a real session, a restart, then a document
 * act across the old session. Either the peer sees it promptly or it does not.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
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
  writeSignedManifestTo,
  writeConsortiumManifest,
  type SpineCluster,
  type Proc,
  type McpConn,
} from "./live-harness.js";
import { spineDirectoryNode, spineNodeKeypair } from "./auth-manifest.js";

let cluster: SpineCluster;
const daemons: Proc[] = [];
const dirs: string[] = [];
const mcpConns: McpConn[] = [];

beforeAll(async () => {
  const holder = mkdtempSync(join(tmpdir(), "cello-stale-consortium-"));
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

afterEach(async () => {
  for (const c of mcpConns.splice(0)) await c.close();
  for (const d of daemons.splice(0)) await d.stop();
});

afterAll(async () => {
  for (const c of mcpConns) await c.close();
  for (const d of daemons) await d.stop();
  await cluster?.stop();
  for (const dir of dirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function startLocalDaemon(celloDir: string, label: string): Promise<Proc> {
  const nodes = cluster.directoryUrls.map((url, i) => spineDirectoryNode(i, url));
  return startDaemon(celloDir, cluster.directoryUrls[0]!, label, {
    manifestEnv: writeConsortiumManifest(celloDir, label, nodes),
  });
}

interface Party { name: string; conn: McpConn; daemon: Proc; celloDir: string; pubkey: string }

async function parties(label: string, count: number): Promise<Party[]> {
  const out: Party[] = [];
  for (let i = 0; i < count; i++) {
    const name = `agent${String.fromCharCode(65 + i)}`;
    const celloDir = mkdtempSync(join(tmpdir(), `cello-${label}${name}-`));
    dirs.push(celloDir);
    const pubkey = await provisionAgent(celloDir, name);
    const daemon = await startLocalDaemon(celloDir, `${label}${name}`);
    daemons.push(daemon);
    expect(
      registerAgent(name, `DEV-${label}-${name}-${randomBytes(6).toString("hex")}`, { CELLO_DIR: celloDir }).status,
    ).toBe(0);
    const conn = await connectMcp(celloDir, `${label}-${name}`);
    mcpConns.push(conn);
    expect(((await conn.call("cello_start_agent", { name })) as { ok?: boolean }).ok).toBe(true);
    expect(((await conn.call("cello_use_agent", { name })) as { ok?: boolean }).ok).toBe(true);
    out.push({ name, conn, daemon, celloDir, pubkey });
  }
  return out;
}

/** Open a session and carry one message each way, so the session is unambiguously working. */
async function connect(from: Party, to: Party): Promise<{ fromSession: string; toSession: string }> {
  const awaitP = to.conn.call("cello_await_session", { timeout_ms: 25_000 });
  const init = (await from.conn.call("cello_initiate_session", { target_pubkey: to.pubkey })) as {
    ok?: boolean; sessionId?: string;
  };
  expect(init.ok, `initiate failed: ${JSON.stringify(init)}`).toBe(true);
  const inbound = (await awaitP) as { type?: string; session_id?: string };
  expect(inbound.type).toBe("new_session");
  const fromSession = init.sessionId!;
  const toSession = inbound.session_id!;
  expect(
    ((await to.conn.call("cello_send", {
      cello_session_id: toSession, content: "session is live", signal: "over",
    })) as { ok?: boolean }).ok,
  ).toBe(true);
  expect(
    ((await from.conn.call("cello_receive", {
      cello_session_id: fromSession, timeout_ms: 20_000,
    })) as { content?: string | null }).content,
  ).toBe("session is live [[OVER]]");
  return { fromSession, toSession };
}

describe("J-STALE-SESSION — a document act across a session that outlived a restart", () => {
  it(
    "the peer sees an invitation sent after ITS OWN daemon restarted, or it does not",
    async () => {
      const [a, b] = (await parties("stale", 2)) as [Party, Party];
      await connect(a, b);

      // A owns a document before anything restarts.
      const proposed = (await a.conn.call("cello_doc_propose", {
        peer_pubkey: b.pubkey,
        starting_content: "before the restart. ",
        admins: [a.pubkey],
      })) as { ok?: boolean; documentId?: string };
      expect(proposed.ok, `propose failed: ${JSON.stringify(proposed)}`).toBe(true);
      const documentId = proposed.documentId!;
      const sawProposal = await (async () => {
        const deadline = Date.now() + 30_000;
        while (Date.now() < deadline) {
          const inbox = (await b.conn.call("cello_doc_inbox", {})) as {
            proposals?: Array<{ documentId?: string }>;
          };
          if ((inbox.proposals ?? []).some((p) => p.documentId === documentId)) return true;
          await sleep(1000);
        }
        return false;
      })();
      expect(sawProposal, "B never saw the proposal even BEFORE any restart").toBe(true);
      expect(((await b.conn.call("cello_doc_accept", { document_id: documentId })) as { ok?: boolean }).ok).toBe(true);
      await sleep(2000);

      // ── THE RESTART. B's daemon goes down and comes back; the session A holds predates it. ──
      for (const c of mcpConns.splice(0)) await c.close();
      await b.daemon.stop();
      const bBack = await startLocalDaemon(b.celloDir, "staleB2");
      daemons.push(bBack);
      b.daemon = bBack;
      const connB2 = await connectMcp(b.celloDir, "stale-B2");
      mcpConns.push(connB2);
      expect(((await connB2.call("cello_start_agent", { name: b.name })) as { ok?: boolean }).ok).toBe(true);
      expect(((await connB2.call("cello_use_agent", { name: b.name })) as { ok?: boolean }).ok).toBe(true);
      b.conn = connB2;
      // B IS PROPERLY BACK before anything is blamed on the session. Without these two, a daemon
      // that failed to come online at all would read exactly like a lost frame.
      await bBack.waitForLine(/agent\.online/, 60_000);
      await bBack.waitForLine(/session\.node\.created/, 60_000);
      const connA2 = await connectMcp(a.celloDir, "stale-A2");
      mcpConns.push(connA2);
      expect(((await connA2.call("cello_use_agent", { name: a.name })) as { ok?: boolean }).ok).toBe(true);
      a.conn = connA2;
      await sleep(3000);

      // ── A ACTS ACROSS THE OLD SESSION: an edit A expects B to converge on. A believes the
      // session is alive; whether the frame lands is the whole question. ──
      const startedAt = Date.now();
      const wrote = (await a.conn.call("cello_doc_write", {
        document_id: documentId,
        content: "before the restart. and one line after B restarted. ",
      })) as { ok?: boolean; published?: boolean; reason?: string };
      expect(wrote.ok, `write failed: ${JSON.stringify(wrote)}`).toBe(true);
      // WHAT A BELIEVES. `published: false` means A knows it did not go — a different defect from
      // A believing it went and it vanishing.
      // eslint-disable-next-line no-console
      console.log(`STALE-SESSION A's write returned: ${JSON.stringify(wrote)}`);

      // How long until B holds it? The production sweep's first tick is 2 minutes, so anything
      // under that arrived by the direct path; anything over it waited for a sweep.
      let elapsedMs = -1;
      const deadline = Date.now() + 300_000;
      while (Date.now() < deadline) {
        const read = (await b.conn.call("cello_doc_read", { document_id: documentId })) as {
          content?: string;
        };
        if ((read.content ?? "").includes("after B restarted")) {
          elapsedMs = Date.now() - startedAt;
          break;
        }
        await sleep(2000);
      }
      // eslint-disable-next-line no-console
      console.log(
        `STALE-SESSION RESULT: B converged after ${elapsedMs}ms ` +
          `(${elapsedMs < 0 ? "NEVER — within 5 minutes" : elapsedMs < 120_000 ? "direct path" : "waited for a sweep"})`,
      );
      // WHICH SIDE DROPPED IT. A's sends (did anything leave, was it parked, did the sweep try?)
      // against B's arrivals (did any frame reach the layer at all?).
      const aSends = a.daemon.countLines(/document\.frame\.sent/);
      const aParked = a.daemon.countLines(/"parked":true/);
      const aSweepFail = a.daemon.countLines(/document\.reconcile\.sweep_attempt_failed/);
      const aReconcile = a.daemon.countLines(/document\.reconcile\.initiated/);
      const bGotFrames = b.daemon.countLines(/session\.document\.received/);
      const bInbound = b.daemon.countLines(/document\.inbound\./);
      // eslint-disable-next-line no-console
      console.log(
        `STALE-SESSION A: sent=${aSends} parked=${aParked} reconcileInitiated=${aReconcile} ` +
          `sweepFailed=${aSweepFail} || B(after restart): framesReceived=${bGotFrames} inbound=${bInbound}`,
      );
      if (elapsedMs < 0) {
        // eslint-disable-next-line no-console
        console.log(`STALE-SESSION A tail:\n${a.daemon.lastLines(25).join("\n")}`);
        // eslint-disable-next-line no-console
        console.log(`STALE-SESSION B tail:\n${b.daemon.lastLines(25).join("\n")}`);
      }
      expect(elapsedMs, "B never converged at all within five minutes").toBeGreaterThan(-1);
    },
    900_000,
  );
});
