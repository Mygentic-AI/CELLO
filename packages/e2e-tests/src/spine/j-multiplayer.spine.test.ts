/**
 * J-MULTIPLAYER — M14B's enforcers: THREE real daemons, three OS processes, one document.
 *
 * DOD-MP-E2E-GOVERN-1 · DOD-MP-E2E-JOIN-1 · DOD-MP-E2E-FANOUT-1 · DOD-MP-E2E-REMOVE-1.
 *
 * Why three and not two: every serious defect M14 shipped was two processes disagreeing about
 * what a THIRD would do, and no single-process test can hold that disagreement — a stub on the
 * far side cannot disagree with you. Everything below was proven in-process during the build;
 * this file is where those claims meet real process separation, real signing keys, a real
 * three-node consortium, and a real relay.
 *
 * The party fixture is `j-documents.spine.test.ts`'s, widened to N — never a from-scratch
 * fixture (M14B-PROCEDURE §1c).
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
  // THREE directory nodes with a signed manifest — the same reasons j-documents states: without
  // a manifest a daemon never learns its own node id and local pairs die at
  // `discovery_node_unresolvable`, and registration runs a real FROST DKG a one-node cluster
  // cannot satisfy.
  const holder = mkdtempSync(join(tmpdir(), "cello-multiplayer-consortium-"));
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

/** One journey's daemons die with that journey — j-documents' rule, for the same reason. */
afterEach(async () => {
  for (const c of mcpConns.splice(0)) await c.close();
  for (const d of daemons.splice(0)) await d.stop();
});

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

async function startLocalDaemon(celloDir: string, label: string): Promise<Proc> {
  const nodes = cluster.directoryUrls.map((url, i) => spineDirectoryNode(i, url));
  return startDaemon(celloDir, cluster.directoryUrls[0]!, label, {
    manifestEnv: writeConsortiumManifest(celloDir, label, nodes),
  });
}

interface Party {
  name: string;
  conn: McpConn;
  daemon: Proc;
  celloDir: string;
  pubkey: string;
}

/** N registered agents on N daemons — the two-party fixture, widened. */
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
      registerAgent(name, `DEV-${label}-${name}-${randomBytes(6).toString("hex")}`, {
        CELLO_DIR: celloDir,
      }).status,
    ).toBe(0);
    const conn = await connectMcp(celloDir, `${label}-${name}`);
    mcpConns.push(conn);
    expect(((await conn.call("cello_start_agent", { name })) as { ok?: boolean }).ok).toBe(true);
    expect(((await conn.call("cello_use_agent", { name })) as { ok?: boolean }).ok).toBe(true);
    out.push({ name, conn, daemon, celloDir, pubkey });
  }
  return out;
}

/**
 * Open a session between two parties and exchange one message each way BEFORE any document
 * frame — j-documents' rule, kept verbatim: a document frame sent immediately after
 * `cello_initiate_session` returns is sometimes lost with no error on either side, and every
 * journey that carries a message first has been reliable.
 */
async function connect(from: Party, to: Party): Promise<{ fromSession: string; toSession: string }> {
  const awaitP = to.conn.call("cello_await_session", { timeout_ms: 25_000 });
  const init = (await from.conn.call("cello_initiate_session", { target_pubkey: to.pubkey })) as {
    ok?: boolean;
    sessionId?: string;
  };
  expect(init.ok, `initiate ${from.name}→${to.name} failed: ${JSON.stringify(init)}`).toBe(true);
  const inbound = (await awaitP) as { type?: string; session_id?: string };
  expect(inbound.type).toBe("new_session");
  const fromSession = init.sessionId!;
  const toSession = inbound.session_id!;
  expect(
    ((await to.conn.call("cello_send", {
      cello_session_id: toSession,
      content: `${to.name} can reach ${from.name}`,
      signal: "over",
    })) as { ok?: boolean }).ok,
  ).toBe(true);
  expect(
    ((await from.conn.call("cello_receive", {
      cello_session_id: fromSession,
      timeout_ms: 20_000,
    })) as { content?: string | null }).content,
  ).toBe(`${to.name} can reach ${from.name} [[OVER]]`);
  return { fromSession, toSession };
}

/** Poll a party's inbox until a join offer for this document appears, and return it. */
async function awaitJoinOffer(
  party: Party,
  documentId: string,
  timeoutMs = 30_000,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    const inbox = (await party.conn.call("cello_doc_inbox", {})) as {
      joins?: Array<Record<string, unknown>>;
    };
    const hit = (inbox.joins ?? []).find((j) => j.documentId === documentId);
    if (hit) return hit;
    last = JSON.stringify(inbox);
    await sleep(1000);
  }
  throw new Error(`${party.name} never saw a join offer for ${documentId}: ${last}`);
}

async function readDoc(party: Party, documentId: string): Promise<string> {
  const res = (await party.conn.call("cello_doc_read", { document_id: documentId })) as {
    content?: string;
  };
  return res.content ?? "";
}

async function awaitContent(
  party: Party,
  documentId: string,
  expected: string,
  timeoutMs = 60_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    last = await readDoc(party, documentId);
    if (last === expected) return;
    await sleep(1000);
  }
  expect(last, `${party.name} never converged on ${documentId}`).toBe(expected);
}

describe("J-MULTIPLAYER — three real daemons, one document", () => {
  it(
    "GOVERN + JOIN: an admin invites a third party, they consent, and all three derive the same arrangement (DOD-MP-E2E-GOVERN-1, DOD-MP-E2E-JOIN-1)",
    async () => {
      const [a, b, c] = (await parties("mpjoin", 3)) as [Party, Party, Party];
      await connect(a, b);

      // ── A proposes to B, B accepts: an ordinary bilateral document with real history. ──
      const proposed = (await a.conn.call("cello_doc_propose", {
        peer_pubkey: b.pubkey,
        starting_content: "line one from A. ",
      })) as { ok?: boolean; documentId?: string };
      expect(proposed.ok, `propose failed: ${JSON.stringify(proposed)}`).toBe(true);
      const documentId = proposed.documentId!;

      const offered = await (async () => {
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
      expect(offered, "B never saw the proposal").toBe(true);
      expect(
        ((await b.conn.call("cello_doc_accept", { document_id: documentId })) as { ok?: boolean }).ok,
      ).toBe(true);

      // Real history before the join — the joiner must receive THIS, not an empty document.
      expect(
        ((await a.conn.call("cello_doc_write", {
          document_id: documentId,
          content: "line one from A. line two from A. ",
        })) as { ok?: boolean }).ok,
      ).toBe(true);
      await awaitContent(b, documentId, "line one from A. line two from A. ");

      // ── GOVERNANCE: C is not an admin and cannot invite. ──
      await connect(a, c);
      const rogue = (await c.conn.call("cello_doc_invite", {
        document_id: documentId,
        invitee_pubkey: b.pubkey,
      })) as { ok?: boolean; reason?: string };
      expect(rogue.ok, "a non-holder must not be able to invite").toBe(false);

      // ── JOIN: A (an admin) invites C; C consents by DERIVING what they were sent. ──
      const invited = (await a.conn.call("cello_doc_invite", {
        document_id: documentId,
        invitee_pubkey: c.pubkey,
      })) as { ok?: boolean; offerSent?: boolean; epochId?: number };
      expect(invited.ok, `invite failed: ${JSON.stringify(invited)}`).toBe(true);
      expect(invited.epochId).toBe(1);

      const offer = await awaitJoinOffer(c, documentId);
      // THE RULES ARE VISIBLE BEFORE CONSENT — derived by C's own daemon, not asserted by A.
      expect((offer.participants as string[]).sort()).toEqual([a.pubkey, b.pubkey].sort());
      expect(offer.admins).toBeDefined();

      const accepted = (await c.conn.call("cello_doc_accept", { document_id: documentId })) as {
        ok?: boolean;
        joined?: boolean;
      };
      expect(accepted.ok, `join accept failed: ${JSON.stringify(accepted)}`).toBe(true);
      expect(accepted.joined).toBe(true);

      // C HOLDS THE WHOLE DOCUMENT — the history that existed before they arrived.
      expect(await readDoc(c, documentId)).toBe("line one from A. line two from A. ");

      // ── C's first edit reaches BOTH existing holders. ──
      expect(
        ((await c.conn.call("cello_doc_write", {
          document_id: documentId,
          content: "line one from A. line two from A. and C joins in. ",
        })) as { ok?: boolean }).ok,
      ).toBe(true);
      await awaitContent(a, documentId, "line one from A. line two from A. and C joins in. ");
      await awaitContent(b, documentId, "line one from A. line two from A. and C joins in. ");

      // ── All three daemons derive the SAME arrangement. ──
      for (const p of [a, b, c]) {
        const list = (await p.conn.call("cello_doc_list", {})) as {
          documents?: Array<{ documentId?: string; epochId?: number; removed?: boolean }>;
        };
        const row = (list.documents ?? []).find((d) => d.documentId === documentId);
        expect(row, `${p.name} does not hold the document`).toBeDefined();
        expect(row!.epochId, `${p.name} derives a different epoch`).toBe(1);
        expect(row!.removed ?? false).toBe(false);
      }
    },
    600_000,
  );

  it(
    "FANOUT + REMOVE: one holder offline never blocks the others; a removed holder keeps their copy and stops receiving (DOD-MP-E2E-FANOUT-1, DOD-MP-E2E-REMOVE-1)",
    async () => {
      const [a, b, c] = (await parties("mpfan", 3)) as [Party, Party, Party];
      await connect(a, b);
      await connect(a, c);

      const proposed = (await a.conn.call("cello_doc_propose", {
        peer_pubkey: b.pubkey,
        starting_content: "base. ",
      })) as { ok?: boolean; documentId?: string };
      expect(proposed.ok).toBe(true);
      const documentId = proposed.documentId!;
      await (async () => {
        const deadline = Date.now() + 30_000;
        while (Date.now() < deadline) {
          const inbox = (await b.conn.call("cello_doc_inbox", {})) as {
            proposals?: Array<{ documentId?: string }>;
          };
          if ((inbox.proposals ?? []).some((p) => p.documentId === documentId)) return;
          await sleep(1000);
        }
        throw new Error("B never saw the proposal");
      })();
      expect(
        ((await b.conn.call("cello_doc_accept", { document_id: documentId })) as { ok?: boolean }).ok,
      ).toBe(true);

      expect(
        ((await a.conn.call("cello_doc_invite", {
          document_id: documentId,
          invitee_pubkey: c.pubkey,
        })) as { ok?: boolean }).ok,
      ).toBe(true);
      await awaitJoinOffer(c, documentId);
      expect(
        ((await c.conn.call("cello_doc_accept", { document_id: documentId })) as { ok?: boolean }).ok,
      ).toBe(true);

      // ── FANOUT: C's daemon goes DOWN; A publishes; B receives while C is dead. ──
      const cDaemon = c.daemon;
      await cDaemon.stop();
      expect(
        ((await a.conn.call("cello_doc_write", {
          document_id: documentId,
          content: "base. written while C was away. ",
        })) as { ok?: boolean }).ok,
      ).toBe(true);
      // THE AVAILABILITY CLAIM: B converges with C down — one absent holder blocks nobody.
      await awaitContent(b, documentId, "base. written while C was away. ");

      // ── REMOVE: A removes B — forward-only. ──
      const removed = (await a.conn.call("cello_doc_remove", {
        document_id: documentId,
        holder_pubkey: b.pubkey,
      })) as { ok?: boolean; epochId?: number };
      expect(removed.ok, `remove failed: ${JSON.stringify(removed)}`).toBe(true);

      // B KEEPS THEIR COPY — the whole content, still readable, forever.
      await sleep(3000);
      expect(await readDoc(b, documentId)).toBe("base. written while C was away. ");

      // And B's own daemon reports the removal rather than pretending nothing changed.
      const bList = (await b.conn.call("cello_doc_list", {})) as {
        documents?: Array<{ documentId?: string; removed?: boolean }>;
      };
      const bRow = (bList.documents ?? []).find((d) => d.documentId === documentId);
      expect(bRow, "B lost the document row entirely — removal is forward-only, not deletion").toBeDefined();
      expect(bRow!.removed, "B's surface does not report the removal").toBe(true);

      // B's next publish refuses NAMING the removal — never a silent drop, never a transport error.
      const refused = (await b.conn.call("cello_doc_write", {
        document_id: documentId,
        content: "base. written while C was away. B tries to keep editing. ",
      })) as { ok?: boolean; reason?: string };
      expect(refused.ok).toBe(false);
      expect(String(refused.reason)).toContain("removed");

      // A's own copy is untouched by B's attempt.
      expect(await readDoc(a, documentId)).toBe("base. written while C was away. ");
    },
    600_000,
  );
});
