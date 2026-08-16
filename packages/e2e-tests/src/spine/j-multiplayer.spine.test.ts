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
  CELLO_CLIENT_ROOT,
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

async function startLocalDaemon(
  celloDir: string,
  label: string,
  extraEnv: Record<string, string> = {},
): Promise<Proc> {
  const nodes = cluster.directoryUrls.map((url, i) => spineDirectoryNode(i, url));
  return startDaemon(celloDir, cluster.directoryUrls[0]!, label, {
    manifestEnv: writeConsortiumManifest(celloDir, label, nodes),
    extraEnv,
  });
}

/**
 * SYNC-P5: a fast reconcile sweep for RESTARTED daemons — a returning holder converges on its
 * own timer, and 2 minutes is a test's whole budget. The ORIGINAL daemons keep the production
 * cadence deliberately: any convergence they show inside a journey's timeout is the NUDGE
 * (SYNC-AC5), not a sweep.
 */
const FAST_SWEEP = {
  CELLO_DOCUMENT_RECONCILE_SWEEP_MS: "3000",
  // The failure backoff too: a restarted daemon's first attempts can fail while its own
  // signaling settles, and the production 30s-doubling ladder walks a 3s-sweep test out of
  // its window while looking exactly like "the exchange is broken".
  CELLO_DOCUMENT_RECONCILE_BACKOFF_MS: "2000",
  // And the believed-current window: a removed holder learns ONLY from its own next
  // unsuppressed exchange (R32's designed recovery), and the production 10-minute belief
  // outlasts any test.
  CELLO_DOCUMENT_RECONCILE_CURRENT_MS: "5000",
};

/**
 * Journey 3's cadence: PRODUCTION sweep and backoff (its first half is the nudge-latency
 * proof, AC5 — convergence inside the wait proves the nudge because the sweep could not have
 * fired), but a short believed-current window: suppression pacing is orthogonal to the nudge,
 * and the removal phase depends on the removed holder's own next exchange.
 */
const PROD_SWEEP_FAST_BELIEF = { CELLO_DOCUMENT_RECONCILE_CURRENT_MS: "5000" };

interface Party {
  name: string;
  /** Mutable: the fan-out journey restarts daemons and re-attaches connections. */
  conn: McpConn;
  daemon: Proc;
  celloDir: string;
  pubkey: string;
}

/** N registered agents on N daemons — the two-party fixture, widened. */
async function parties(
  label: string,
  count: number,
  extraEnv: Record<string, string> = {},
): Promise<Party[]> {
  const out: Party[] = [];
  for (let i = 0; i < count; i++) {
    const name = `agent${String.fromCharCode(65 + i)}`;
    const celloDir = mkdtempSync(join(tmpdir(), `cello-${label}${name}-`));
    dirs.push(celloDir);
    const pubkey = await provisionAgent(celloDir, name);
    const daemon = await startLocalDaemon(celloDir, `${label}${name}`, extraEnv);
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

/**
 * Poll a party's inbox until the INVITATION for this document appears. SYNC-P4: there is no
 * offer frame — the invite's notice is a reconcile step-1, the invitee's daemon bootstraps the
 * world through the exchange, and the inbox row is DERIVED from the record it now holds.
 */
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

/** The arrangement THIS daemon derives from its OWN chain — the thing worth comparing. */
async function arrangementOf(
  party: Party,
  documentId: string,
): Promise<{ participants: string[]; admins: string[]; appendOnly: unknown }> {
  const list = (await party.conn.call("cello_doc_list", {})) as {
    documents?: Array<{
      documentId?: string;
      participants?: string[];
      admins?: string[];
      properties?: Record<string, unknown>;
      underivable?: string;
    }>;
  };
  const row = (list.documents ?? []).find((d) => d.documentId === documentId);
  if (!row) throw new Error(`${party.name} holds no row for ${documentId}`);
  if (row.underivable) {
    throw new Error(`${party.name} cannot derive: ${row.underivable}`);
  }
  return {
    participants: [...(row.participants ?? [])].sort(),
    admins: [...(row.admins ?? [])].sort(),
    // PROPERTIES is the arrangement's third part (G0) — agreeing on two of three was the
    // silent-simplification shape the review named.
    appendOnly: row.properties?.["append_only"],
  };
}

/** Every named party derives the SAME arrangement — polled, because amendments travel. */
async function agreeOnArrangement(
  who: Party[],
  documentId: string,
  want: { participants: string[]; admins: string[]; appendOnly: unknown },
  label: string,
): Promise<void> {
  const target = JSON.stringify({
    participants: [...want.participants].sort(),
    admins: [...want.admins].sort(),
    appendOnly: want.appendOnly,
  });
  for (const p of who) {
    const deadline = Date.now() + 60_000;
    for (;;) {
      const got = JSON.stringify(await arrangementOf(p, documentId));
      if (got === target) break;
      if (Date.now() > deadline) {
        throw new Error(`${label}: ${p.name} derives ${got}, expected ${target}`);
      }
      await sleep(1000);
    }
  }
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

describe("J-MULTIPLAYER — the built artifact keeps its layer boundary", () => {
  it("SYNC-AC17: the document layer's built artifact carries no relay vocabulary", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const distDir = join(CELLO_CLIENT_ROOT, "core/daemon/dist");
    const layerFiles = readdirSync(distDir).filter(
      (f) =>
        f.endsWith(".js") &&
        (f.startsWith("document-layer") ||
          f.startsWith("document-reconcile") ||
          f.startsWith("document-inbound")),
    );
    expect(layerFiles.length).toBeGreaterThan(0);
    for (const f of layerFiles) {
      const src = readFileSync(join(distDir, f), "utf8");
      for (const word of ["session_sealed", "relay_session_gone", "parked", "witnessed"]) {
        expect(src.includes(word), `${f} speaks relay vocabulary: ${word}`).toBe(false);
      }
    }
  });
});

describe("J-MULTIPLAYER — three real daemons, one document", () => {
  it(
    "GOVERN + JOIN: an admin invites a third party, they consent, and all three derive the same arrangement (DOD-MP-E2E-GOVERN-1, DOD-MP-E2E-JOIN-1)",
    async () => {
      // FAST sweeps: this journey proves derivation and the exchange, not nudge latency — a
      // first-contact send between seats with no session legitimately rides the sweep (R40).
      const [a, b, c] = (await parties("mpjoin", 3, FAST_SWEEP)) as [Party, Party, Party];
      const ab = await connect(a, b);

      // ── A proposes to B, B accepts: an ordinary bilateral document with real history. ──
      const proposed = (await a.conn.call("cello_doc_propose", {
        peer_pubkey: b.pubkey,
        starting_content: "line one from A. ",
        // A IS THE SOLE ADMIN, declared at creation — the governance line's first clause, and
        // what makes B a holder-who-is-not-an-admin for the refusal below.
        admins: [a.pubkey],
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

      // STEP 1 — the genesis arrangement, agreed by BOTH holders from their own chains.
      await agreeOnArrangement(
        [a, b],
        documentId,
        { participants: [a.pubkey, b.pubkey], admins: [a.pubkey], appendOnly: false },
        "post-genesis",
      );

      // Real history before the join — the joiner must receive THIS, not an empty document.
      expect(
        ((await a.conn.call("cello_doc_write", {
          document_id: documentId,
          content: "line one from A. line two from A. ",
        })) as { ok?: boolean }).ok,
      ).toBe(true);
      await awaitContent(b, documentId, "line one from A. line two from A. ");

      // ── GOVERNANCE: B HOLDS the document and is NOT an admin — the refusal must be governance,
      // not "I've never heard of this document" (which is what a non-holder gets, six checks
      // earlier, and which was green with all governance deleted).
      const bTriesToInvite = (await b.conn.call("cello_doc_invite", {
        document_id: documentId,
        invitee_pubkey: c.pubkey,
      })) as { ok?: boolean; reason?: string };
      expect(bTriesToInvite.ok).toBe(false);
      expect(
        bTriesToInvite.reason,
        `wrong refusal for a non-admin HOLDER: ${JSON.stringify(bTriesToInvite)}`,
      ).toBe("document_not_admin");

      const ac = await connect(a, c);

      // ── JOIN: A (an admin) invites C; C consents by DERIVING what they were sent. ──
      const invited = (await a.conn.call("cello_doc_invite", {
        document_id: documentId,
        invitee_pubkey: c.pubkey,
      })) as { ok?: boolean; noticeSent?: boolean };
      expect(invited.ok, `invite failed: ${JSON.stringify(invited)}`).toBe(true);

      // SYNC-AC10: the join rides the ORDINARY exchange — the notice was a step-1 position
      // frame, C's daemon answered empty-handed, and the world (genesis + every entry + the
      // content) arrived as a reply. What C's inbox shows is DERIVED by C's own daemon from
      // the record it now holds — R22: C is an INVITED seat until its own consent entry exists.
      const offer = await awaitJoinOffer(c, documentId);
      expect((offer.participants as string[]).sort()).toEqual([a.pubkey, b.pubkey].sort());
      expect(offer.invited as string[]).toContain(c.pubkey);
      // A declared itself sole admin at creation, and that is what C derives.
      expect(offer.admins).toEqual([a.pubkey]);

      const accepted = (await c.conn.call("cello_doc_accept", { document_id: documentId })) as {
        ok?: boolean;
        joined?: boolean;
      };
      expect(accepted.ok, `join accept failed: ${JSON.stringify(accepted)}`).toBe(true);
      expect(accepted.joined).toBe(true);

      // C HOLDS THE WHOLE DOCUMENT — the history that existed before they arrived.
      expect(await readDoc(c, documentId)).toBe("line one from A. line two from A. ");

      // ── GOVERNANCE, asserted where it can only be governance: C is now a HOLDER and NOT an
      // admin. The first cut asked a NON-holder to invite, which dies at the store lookup with
      // `document_unknown` six checks before the governance gate — green with every line of
      // governance deleted. The reason code is the assertion.
      const rogue = (await c.conn.call("cello_doc_invite", {
        document_id: documentId,
        invitee_pubkey: "f".repeat(64),
      })) as { ok?: boolean; reason?: string; guidance?: string };
      expect(rogue.ok).toBe(false);
      expect(rogue.reason, `wrong refusal: ${JSON.stringify(rogue)}`).toBe("document_not_admin");

      // ── C's first edit reaches BOTH existing holders. ──
      expect(
        ((await c.conn.call("cello_doc_write", {
          document_id: documentId,
          content: "line one from A. line two from A. and C joins in. ",
        })) as { ok?: boolean }).ok,
      ).toBe(true);
      await awaitContent(a, documentId, "line one from A. line two from A. and C joins in. ");
      await awaitContent(b, documentId, "line one from A. line two from A. and C joins in. ");

      // ── STEP 2 — ALL THREE derive the SAME arrangement: participants, admins, epoch. Not a
      // proxy: each daemon computed this from its own copy of the chain. ──
      await agreeOnArrangement(
        [a, b, c],
        documentId,
        {
          participants: [a.pubkey, b.pubkey, c.pubkey],
          admins: [a.pubkey],
          appendOnly: false,
        },
        "post-join",
      );

      // ── STEP 3 — THE SEAL, per the mesh definition (DoD "Explicitly beyond", Entry 24):
      // three holders means three PAIRWISE sessions with three roots, so each pair seals and
      // BOTH of its parties independently recompute the SAME root over a tree carrying that
      // pair's document leaves. Multiplayer does not change what a seal is — only how many.
      type Receipt = { ok?: boolean; sealed_root?: string; leaf_count?: number };
      for (const [x, xs, y, ys, label] of [
        [a, ab.fromSession, b, ab.toSession, "A↔B"],
        [a, ac.fromSession, c, ac.toSession, "A↔C"],
      ] as const) {
        const closeY = y.conn.call("cello_close_session", { cello_session_id: ys });
        const closeX = (await x.conn.call("cello_close_session", { cello_session_id: xs })) as {
          ok?: boolean;
        };
        await closeY;
        expect(closeX.ok, `${label}: close failed`).toBe(true);
        const rx = (await x.conn.call("cello_sealed_receipt", { cello_session_id: xs })) as Receipt;
        const ry = (await y.conn.call("cello_sealed_receipt", { cello_session_id: ys })) as Receipt;
        expect(rx.sealed_root, `${label}: ${x.name} has no sealed root`).toBeTruthy();
        // Side to side, never one side's value against itself — the tamper-evidence claim.
        expect(ry.sealed_root, `${label}: the two sides sealed different trees`).toBe(rx.sealed_root);
        // MIXED: this pair carried an ordinary message AND document frames.
        expect(rx.leaf_count, `${label}: too few leaves to be a mixed tree`).toBeGreaterThan(2);
      }
    },
    600_000,
  );

  it(
    "REMOVE while OFFLINE: a holder removed while down learns their own removal on return, from A's signed entry, with NOBODY acting on either side (SYNC-AC13)",
    async () => {
      // SYNC-P4 rewrote this journey's mechanism: there is no delivery ledger and nothing retries
      // on anyone's behalf. A holder removed while down comes back, its daemon takes delivery of
      // A's signed removal through the ordinary carrier, folds it, and the surface says removed —
      // no agent on either side does anything. What is NOT claimed here is which door the entry
      // came through; see the assertion below, which was written the other way round first and
      // went red.
      const [a, b, c] = (await parties("mprecv", 3, FAST_SWEEP)) as [Party, Party, Party];
      await connect(a, b);
      await connect(a, c);

      const proposed = (await a.conn.call("cello_doc_propose", {
        peer_pubkey: b.pubkey,
        starting_content: "shared base. ",
        admins: [a.pubkey],
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
      await agreeOnArrangement(
        [a, b, c],
        documentId,
        {
          participants: [a.pubkey, b.pubkey, c.pubkey],
          admins: [a.pubkey],
          appendOnly: false,
        },
        "pre-removal",
      );

      // ── C GOES DOWN, and is removed while they cannot hear it. ──
      await c.daemon.stop();
      const removed = (await a.conn.call("cello_doc_remove", {
        document_id: documentId,
        holder_pubkey: c.pubkey,
      })) as { ok?: boolean; holdersNotified?: Record<string, boolean> };
      expect(removed.ok, `remove failed: ${JSON.stringify(removed)}`).toBe(true);
      // The per-holder report is HONEST about the absent holder — no ledger promises delivery;
      // the entry itself, in the chain, is the durable debt (SYNC-D2).
      await agreeOnArrangement(
        [a, b],
        documentId,
        { participants: [a.pubkey, b.pubkey], admins: [a.pubkey], appendOnly: false },
        "post-removal",
      );

      // ── C COMES BACK KNOWING NOTHING and edits, as any honest holder would. ──
      const cBack = await startLocalDaemon(c.celloDir, "mprecvC2", FAST_SWEEP);
      daemons.push(cBack);
      c.daemon = cBack;
      const connC2 = await connectMcp(c.celloDir, "mprecv-C2");
      mcpConns.push(connC2);
      expect(((await connC2.call("cello_start_agent", { name: c.name })) as { ok?: boolean }).ok).toBe(true);
      expect(((await connC2.call("cello_use_agent", { name: c.name })) as { ok?: boolean }).ok).toBe(true);
      c.conn = connC2;
      // ── C LEARNS ON RETURN (SYNC-AC13): C's daemon takes delivery of A's removal entry, folds
      // it, and the surface says removed — nobody had to act on either side. ──
      const learned = await (async () => {
        const deadline = Date.now() + 120_000;
        while (Date.now() < deadline) {
          const list = (await c.conn.call("cello_doc_list", {})) as {
            documents?: Array<{ documentId?: string; yourStanding?: string }>;
          };
          const row = (list.documents ?? []).find((d) => d.documentId === documentId);
          if (row?.yourStanding === "removed") return true;
          await sleep(2000);
        }
        return false;
      })();
      expect(
        learned,
        "C never learned of the removal after returning — the exchange did not deliver it",
      ).toBe(true);
      // ── AND IT ARRIVED AS A's SIGNED ENTRY, which is the claim that matters: C's standing is
      // DERIVED from a removal it holds and can verify, not set by a local status write. Without
      // this assertion the surface check above passes on any mechanism that flips a column.
      //
      // WHICH DOOR IT CAME THROUGH, measured rather than assumed: the first cut of this assertion
      // demanded R32's terminal refusal (`document_reconcile_removed`) and went RED — the removal
      // entry reaches a returning holder as an ordinary parked session frame, recovered from the
      // relay on reconnect, long before C's first exchange. That is the ordinary carrier working,
      // and R32 is the backstop for when the park is gone (expired, or the entry was minted while
      // no session existed). Its proof is in-process — cello-client
      // `document-reconcile-engine.test.ts`, "a REMOVED holder gets a terminal ruling that
      // DELIVERS" — and its absence from live coverage is a NAMED GAP on the DoD line, not a
      // claim quietly made here.
      expect(
        cBack.countLines(/document\.entry\.recorded[\s\S]*?remove_holder/),
        `C's standing flipped without C recording A's signed removal entry — the surface moved on ` +
          `something other than the chain. Last 40 lines of C's log:\n${cBack.lastLines(40).join("\n")}`,
      ).toBeGreaterThan(0);

      // ── AND THEN C SELF-CENSORS. This is the finding: with HONEST binaries the receiver-side
      // refusal (`document_sender_removed`) is UNREACHABLE end to end, because a removed holder
      // always learns before they can publish — offline merely delays it. That gate is a defence
      // against a REWRITTEN client (Andre's adversary-owns-their-daemon lens, 2026-08-12), which
      // stock binaries cannot stage. Its unit coverage is document-inbound.test.ts; what this
      // journey proves live is the cooperative path all the way through. ──
      const cWrite = (await c.conn.call("cello_doc_write", {
        document_id: documentId,
        content: "shared base. C edits after learning. ",
      })) as { ok?: boolean; reason?: string };
      expect(cWrite.ok).toBe(false);
      expect(String(cWrite.reason)).toContain("removed");

      // ── AND NEITHER REMAINING HOLDER'S DOCUMENT MOVED. ──
      expect(await readDoc(a, documentId)).toBe("shared base. ");
      expect(await readDoc(b, documentId)).toBe("shared base. ");
      // C keeps their copy, exactly as it was — forward-only, from the removed chair.
      expect(await readDoc(c, documentId)).toBe("shared base. ");
    },
    600_000,
  );

  it(
    "NUDGE + SURFACE: an absent holder blocks nobody, and the surface says behind-with-last-seen from the display cache (SYNC-AC1, AC5, AC20)",
    async () => {
      // AC5's premise, made STRUCTURAL. The claim below is "B converged because A's commit nudged
      // it", and the only thing that makes that more than a story is that the background sweep
      // COULD NOT have fired yet: these daemons run the production 2-minute cadence, whose first
      // tick is one interval after boot. Every daemon in this journey starts after this stamp, so
      // if the whole journey stays inside one interval, no sweep has run. It was true in every
      // observed run (~19s against 120s) and nothing asserted it — a slower machine would have
      // silently converted this into a sweep test still claiming to prove the nudge.
      const PRODUCTION_FIRST_SWEEP_MS = 120_000;
      const bootedAt = Date.now();
      const [a, b, c] = (await parties("mpfan", 3, PROD_SWEEP_FAST_BELIEF)) as [Party, Party, Party];
      await connect(a, b);
      await connect(a, c);

      // A IS THE SOLE ADMIN: the default makes both genesis parties admins, and an admin cannot
      // be expelled through the holder door (the all-other-admins rule, D3) — so removing B
      // would be correctly refused. The removal this enforcer proves is the DoD's: an admin
      // removes a NON-admin holder.
      const proposed = (await a.conn.call("cello_doc_propose", {
        peer_pubkey: b.pubkey,
        starting_content: "base. ",
        admins: [a.pubkey],
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
      await c.daemon.stop();
      expect(
        ((await a.conn.call("cello_doc_write", {
          document_id: documentId,
          content: "base. written while C was away. ",
        })) as { ok?: boolean }).ok,
      ).toBe(true);
      // THE AVAILABILITY CLAIM: B converges with C down — one absent holder blocks nobody.
      await awaitContent(b, documentId, "base. written while C was away. ");
      // SYNC-AC5, the premise asserted: B has the edit, and no sweep tick has happened yet on any
      // daemon in this journey. What moved it was the commit nudge.
      expect(
        Date.now() - bootedAt,
        "this journey outlived a production sweep interval — convergence above can no longer be " +
          "attributed to the commit nudge, so AC5 is unproven whatever the surface says",
      ).toBeLessThan(PRODUCTION_FIRST_SWEEP_MS);

      // ── SYNC-AC20 — the HONEST surface: with C unreachable, A shows C BEHIND with a
      // last-seen time from the display cache. No pending count exists to show, and it must
      // never read in_sync. ──
      const partyCView = async (): Promise<{ sync?: string; lastSyncedAtMs?: number | null }> => {
        const list = (await a.conn.call("cello_doc_list", {})) as {
          documents?: Array<{
            documentId?: string;
            parties?: Array<{ agentId?: string; sync?: string; lastSyncedAtMs?: number | null }>;
          }>;
        };
        const row = (list.documents ?? []).find((d) => d.documentId === documentId);
        return (row?.parties ?? []).find((party) => party.agentId === c.pubkey) ?? {};
      };
      const behind = await (async () => {
        const deadline = Date.now() + 30_000;
        let last: { sync?: string; lastSyncedAtMs?: number | null } = {};
        while (Date.now() < deadline) {
          last = await partyCView();
          if (last.sync === "behind") return last;
          await sleep(1000);
        }
        return last;
      })();
      expect(behind.sync, "A does not show the absent holder behind").toBe("behind");
      // ── AC20 IN FULL: "behind, and here is when we last heard from them". The last-seen half was
      // unasserted, and it is the half that makes the surface HONEST rather than merely negative —
      // "behind" with no timestamp cannot be told from "we have never reached them". C converged
      // once (they joined and read the document), so A holds a real time from before this write. ──
      expect(
        typeof behind.lastSyncedAtMs,
        `AC20 wants behind WITH a last-seen time; got ${JSON.stringify(behind)}`,
      ).toBe("number");
      expect(behind.lastSyncedAtMs!).toBeGreaterThan(bootedAt);
      expect(behind.lastSyncedAtMs!).toBeLessThanOrEqual(Date.now());
      // R47: and the surface offers NO pending/undelivered count — there is no such number to be
      // had once delivery records are gone, and inventing one is the dishonesty this milestone
      // deleted. Absence asserted on the wire shape, not assumed from the type.
      const rawRow = await (async () => {
        const list = (await a.conn.call("cello_doc_list", {})) as {
          documents?: Array<Record<string, unknown>>;
        };
        return (list.documents ?? []).find((d) => d["documentId"] === documentId) ?? {};
      })();
      for (const gone of ["pending", "pendingCount", "undelivered", "unacked", "pendingHolders"]) {
        expect(Object.keys(rawRow), `the list surface still reports ${gone}`).not.toContain(gone);
      }

      // ── RESTART THE PUBLISHER: pending must be derived from the LOG, not held in memory. ──
      await a.daemon.stop();
      const aRestarted = await startLocalDaemon(a.celloDir, "mpfanA2", { ...FAST_SWEEP, ...PROD_SWEEP_FAST_BELIEF });
      daemons.push(aRestarted);
      a.daemon = aRestarted;
      const connA2 = await connectMcp(a.celloDir, "mpfan-A2");
      mcpConns.push(connA2);
      expect(((await connA2.call("cello_start_agent", { name: a.name })) as { ok?: boolean }).ok).toBe(true);
      expect(((await connA2.call("cello_use_agent", { name: a.name })) as { ok?: boolean }).ok).toBe(true);
      a.conn = connA2;
      // The display cache is persisted (spec §9): after the publisher's restart, C still reads
      // behind — the belief survived, and NOTHING correctness-bearing was lost with the process
      // (the entry set is the only authority).
      const survivedView = await partyCView();
      expect(
        survivedView.sync,
        "the party view did not survive the publisher's restart",
      ).toBe("behind");

      // ── C COMES BACK and converges with ZERO agent attention on any side. ──
      const cRestarted = await startLocalDaemon(c.celloDir, "mpfanC2", { ...FAST_SWEEP, ...PROD_SWEEP_FAST_BELIEF });
      daemons.push(cRestarted);
      c.daemon = cRestarted;
      const connC2 = await connectMcp(c.celloDir, "mpfan-C2");
      mcpConns.push(connC2);
      expect(((await connC2.call("cello_start_agent", { name: c.name })) as { ok?: boolean }).ok).toBe(true);
      expect(((await connC2.call("cello_use_agent", { name: c.name })) as { ok?: boolean }).ok).toBe(true);
      c.conn = connC2;
      // NOBODY ACTS: no send, no receive, no publish — the daemons sync by themselves.
      await awaitContent(c, documentId, "base. written while C was away. ", 120_000);

      // The removal phase lives in its own journey below, on FAST cadence end to end: the
      // known first-frame-after-open transport race can eat any single reply, and the model's
      // repair is the next exchange — 3 seconds there, 2 minutes here.
    },
    600_000,
  );

  it(
    "REMOVE surfaces to the REMOVED holder who never went away — standing flips, the copy stays, their own publish refuses by name, and the survivors carry on (SYNC-AC13)",
    async () => {
      // SCOPE, stated because the earlier title overclaimed it: B is up throughout, so the removal
      // may reach them by the commit nudge OR by their next exchange, and this journey cannot tell
      // those apart. R32's terminal-refusal delivery — the door a holder who was DOWN comes back
      // through — is proven in the offline journey above, by the refusal reason in that holder's
      // own log. What this journey owns is the SURFACE and the survivors.
      const [a, b, c] = (await parties("mprsurf", 3, FAST_SWEEP)) as [Party, Party, Party];
      await connect(a, b);
      await connect(a, c);
      const proposed = (await a.conn.call("cello_doc_propose", {
        peer_pubkey: b.pubkey,
        starting_content: "removal surface. ",
        admins: [a.pubkey],
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
      expect(((await b.conn.call("cello_doc_accept", { document_id: documentId })) as { ok?: boolean }).ok).toBe(true);
      expect(
        ((await a.conn.call("cello_doc_invite", {
          document_id: documentId, invitee_pubkey: c.pubkey,
        })) as { ok?: boolean }).ok,
      ).toBe(true);
      await awaitJoinOffer(c, documentId);
      expect(((await c.conn.call("cello_doc_accept", { document_id: documentId })) as { ok?: boolean }).ok).toBe(true);
      await agreeOnArrangement(
        [a, b, c],
        documentId,
        { participants: [a.pubkey, b.pubkey, c.pubkey], admins: [a.pubkey], appendOnly: false },
        "pre-removal",
      );

      // ── REMOVE: A removes B — forward-only. ──
      const removed = (await a.conn.call("cello_doc_remove", {
        document_id: documentId,
        holder_pubkey: b.pubkey,
      })) as { ok?: boolean };
      expect(removed.ok, `remove failed: ${JSON.stringify(removed)}`).toBe(true);

      // B's own daemon reports the removal — POLLED, because the amendment crosses a real
      // transport and a fixed sleep is a flake waiting to happen.
      const bRow = await (async () => {
        // MANY FAST SWEEP TICKS: this journey runs the 3-second cadence end to end, so the repair
        // path for a lost first frame is seconds — the deadline is slack for a loaded machine, not
        // a wait on one production interval.
        const deadline = Date.now() + 120_000;
        let last = "";
        while (Date.now() < deadline) {
          const bList = (await b.conn.call("cello_doc_list", {})) as {
            documents?: Array<{ documentId?: string; yourStanding?: string; participants?: string[] }>;
          };
          const row = (bList.documents ?? []).find((d) => d.documentId === documentId);
          if (row?.yourStanding === "removed") return row;
          last = JSON.stringify(bList);
          await sleep(1000);
        }
        throw new Error(
          `B never surfaced the removal: ${last}\n` +
            `--- last 40 lines of B's daemon ---\n${b.daemon.lastLines(40).join("\n")}`,
        );
      })();

      // B KEEPS THEIR COPY — the whole content, still readable, forever.
      expect(await readDoc(b, documentId)).toBe("removal surface. ");
      // AND KEEPS DERIVING: the row is not a husk. B still folds the arrangement it holds — which
      // now seats A and C and not B. (The old assertion here was `toBeDefined()` on a value the
      // loop above had already thrown without, so it could never fail.)
      expect(
        [...(bRow.participants ?? [])].sort(),
        "the removed holder's row no longer derives the arrangement",
      ).toEqual([a.pubkey, c.pubkey].sort());

      // B's own publish refuses NAMING the removal. NOTE the scope of this evidence: it is B's
      // LOCAL pre-check (the cooperative case), NOT the receiver-side refusal — that path needs
      // a holder who never got the amendment, and it is named as a gap on the DoD line rather
      // than claimed here.
      const refused = (await b.conn.call("cello_doc_write", {
        document_id: documentId,
        content: "removal surface. B tries to keep editing. ",
      })) as { ok?: boolean; reason?: string };
      expect(refused.ok).toBe(false);
      expect(String(refused.reason)).toContain("removed");

      // ── THE SURVIVORS CARRY ON: A and C keep editing and converging after the removal. ──
      expect(
        ((await a.conn.call("cello_doc_write", {
          document_id: documentId,
          content: "removal surface. and A and C carry on. ",
        })) as { ok?: boolean }).ok,
      ).toBe(true);
      await awaitContent(c, documentId, "removal surface. and A and C carry on. ", 120_000);
      // And the removed holder receives NONE of it — forward-only, from their chair.
      expect(await readDoc(b, documentId)).toBe("removal surface. ");
    },
    600_000,
  );

  it(
    "END: closes are ENTRIES that settle by DERIVATION only when every seat has spoken (SYNC-AC4's settlement rule, R26–R28)",
    async () => {
      // Both units were found by the LIVE FLEET, not by a test, and both are about a third party
      // the code could not see. Three OS processes is the only place they can be disproved:
      // the sender, a genesis peer, and a joiner who exists in no `peerAgentId` column anywhere.
      const [a, b, c] = (await parties("mpend", 3, FAST_SWEEP)) as [Party, Party, Party];
      await connect(a, b);
      await connect(a, c);

      const proposed = (await a.conn.call("cello_doc_propose", {
        peer_pubkey: b.pubkey,
        starting_content: "ending. ",
        admins: [a.pubkey],
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
      expect(((await b.conn.call("cello_doc_accept", { document_id: documentId })) as { ok?: boolean }).ok).toBe(true);
      expect(
        ((await a.conn.call("cello_doc_invite", {
          document_id: documentId, invitee_pubkey: c.pubkey,
        })) as { ok?: boolean }).ok,
      ).toBe(true);
      await awaitJoinOffer(c, documentId);
      expect(((await c.conn.call("cello_doc_accept", { document_id: documentId })) as { ok?: boolean }).ok).toBe(true);

      // ── A CLOSES. The frame must reach BOTH — this is the live-fleet defect exactly: it went to
      // the genesis peer alone, and the joiner, converging and publishing for the life of the
      // document, was never told it had ended. ──
      const closed = (await a.conn.call("cello_doc_close", { document_id: documentId })) as {
        ok?: boolean; closeDelivered?: Record<string, boolean>; ended?: string | null;
        waitingOn?: string[];
      };
      expect(closed.ok).toBe(true);
      // The close ENTRY traveled to both other seats — including the joiner, who exists in no
      // peerAgentId column anywhere (the live-fleet defect this journey was written for).
      expect(Object.keys(closed.closeDelivered ?? {}).sort()).toEqual([b.pubkey, c.pubkey].sort());
      expect(closed.closeDelivered?.[c.pubkey], "the joiner was not told the document ended").toBe(true);
      expect(closed.closeDelivered?.[b.pubkey]).toBe(true);
      // And the DERIVED verdict says exactly who the agreement still waits on.
      expect(closed.ended).toBeNull();
      expect((closed.waitingOn ?? []).sort()).toEqual([b.pubkey, c.pubkey].sort());

      const endedOf = async (p: Party): Promise<string> => {
        const list = (await p.conn.call("cello_doc_list", {})) as {
          documents?: Array<{ documentId?: string; ended?: string | null }>;
        };
        const row = (list.documents ?? []).find((d) => d.documentId === documentId);
        if (!row) return "missing";
        return row.ended === null || row.ended === undefined ? "live" : String(row.ended);
      };
      const awaitEnded = async (p: Party, want: string, timeoutMs = 60_000): Promise<void> => {
        const deadline = Date.now() + timeoutMs;
        let last = "";
        while (Date.now() < deadline) {
          last = await endedOf(p);
          if (last === want) return;
          await sleep(1000);
        }
        expect(last, `${p.name} never reached ${want}`).toBe(want);
      };

      // ── ONE OF THREE HAS CLOSED. Nothing is settled anywhere. ──
      expect(await endedOf(a), "A settled its own close alone").toBe("live");

      // ── THE GENESIS PEER CLOSES: two of three. Under the old rule THIS is where A flipped to
      // `closed`, while the joiner was still editing. It must not. ──
      expect(((await b.conn.call("cello_doc_close", { document_id: documentId })) as { ok?: boolean }).ok).toBe(true);
      // WAIT FOR THE RECEIPT, not for a duration. A sleep proves only "it had not settled YET" —
      // and would pass vacuously if B's entry never arrived at all. B's close is an ordinary
      // ENTRY now; A logs its ingest, and blocking on that turns "no news" into "both closes
      // are in, and it still did not settle".
      await a.daemon.waitForLine(/document\.entry\.recorded/, 30_000);
      expect(
        await endedOf(a),
        "A settled on the genesis pair while the joiner had not closed",
      ).toBe("live");
      // AND ON B'S OWN DAEMON. Under the old two-party rule B's daemon (owner B, peer A, both
      // closed) would already read `closed` here, so this is where the genesis peer's copy
      // earns the clause.
      expect(
        await endedOf(b),
        "B settled on the genesis pair while the joiner had not closed",
      ).toBe("live");

      // ── AND THE JOINER'S CLOSE COMPLETES IT. Twice load-bearing: a joiner is in nobody's
      // `peerAgentId` column, so before the inbound half was fixed every holder REFUSED their
      // close while telling them everyone had heard it. ──
      expect(((await c.conn.call("cello_doc_close", { document_id: documentId })) as { ok?: boolean }).ok).toBe(true);
      await awaitEnded(a, "closed");
      await awaitEnded(b, "closed");
      await awaitEnded(c, "closed");
    },
    600_000,
  );

  it(
    "END: a REMOVED holder cannot end the document — the gate REFUSES, and refusal is what no acceptance can prove (DOD-MP-CONTROL-N-1)",
    async () => {
      // THE CASE THE DoD LINE LEADS WITH, and the one a journey of acceptances cannot see: the
      // first END journey stays green with the membership gate returning `true` for every sender.
      // A test that only asserts things succeed reports that a gate is permissive enough, never
      // that it restricts anything.
      const [a, b, c] = (await parties("mprem", 3, FAST_SWEEP)) as [Party, Party, Party];
      await connect(a, b);
      await connect(a, c);

      const proposed = (await a.conn.call("cello_doc_propose", {
        peer_pubkey: b.pubkey,
        starting_content: "refusal. ",
        admins: [a.pubkey],
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
      expect(((await b.conn.call("cello_doc_accept", { document_id: documentId })) as { ok?: boolean }).ok).toBe(true);
      expect(
        ((await a.conn.call("cello_doc_invite", {
          document_id: documentId, invitee_pubkey: c.pubkey,
        })) as { ok?: boolean }).ok,
      ).toBe(true);
      await awaitJoinOffer(c, documentId);
      expect(((await c.conn.call("cello_doc_accept", { document_id: documentId })) as { ok?: boolean }).ok).toBe(true);

      // ── B IS REMOVED. A's `peerAgentId` still says B — that column is frozen at creation, and it
      // is exactly why the old gate admitted them. ──
      const removed = (await a.conn.call("cello_doc_remove", {
        document_id: documentId, holder_pubkey: b.pubkey,
      })) as { ok?: boolean };
      expect(removed.ok, `remove failed: ${JSON.stringify(removed)}`).toBe(true);

      // ── B TRIES TO END IT. Their own daemon self-censors first (forward-only removal), so what
      // reaches A is nothing — which on its own is indistinguishable from a frame that was simply
      // lost. So the assertion is TWO-SIDED: B is refused locally by name, AND A is still active. ──
      const bEnds = (await b.conn.call("cello_doc_kill", { document_id: documentId })) as {
        ok?: boolean; reason?: string;
      };
      // Whether B is stopped at their own door or at A's, what must NOT happen is A ending.
      const aEnded = async (): Promise<string> => {
        const list = (await a.conn.call("cello_doc_list", {})) as {
          documents?: Array<{ documentId?: string; ended?: string | null }>;
        };
        const row = (list.documents ?? []).find((d) => d.documentId === documentId);
        if (!row) return "missing";
        return row.ended === null || row.ended === undefined ? "live" : String(row.ended);
      };
      await sleep(5000);
      expect(
        await aEnded(),
        "a REMOVED holder ended the creator's document — the gate admitted a party the chain expelled",
      ).toBe("live");
      // The removed party's own refusal is recorded either way; if their daemon did send, A's log
      // carries the receiving-side refusal. One of the two must be true, and both are on the record.
      const refusedLocally = bEnds.ok === false;
      // If B's daemon did somehow mint and send the entry, A's causal gate names the removal.
      const refusedAtA = a.daemon.countLines(/document\.inbound\.sender_removed/) > 0;
      expect(
        refusedLocally || refusedAtA,
        "nobody refused the removed holder's ending — it was silently dropped",
      ).toBe(true);

      // ── AND THE SURVIVORS CAN STILL END IT PROPERLY: the refusal did not wedge the document. ──
      expect(((await a.conn.call("cello_doc_close", { document_id: documentId })) as { ok?: boolean }).ok).toBe(true);
      expect(((await c.conn.call("cello_doc_close", { document_id: documentId })) as { ok?: boolean }).ok).toBe(true);
      const deadline = Date.now() + 60_000;
      let last = "";
      while (Date.now() < deadline) {
        last = await aEnded();
        if (last === "closed") break;
        await sleep(1000);
      }
      // The removed holder is NOT in the agreement — A and C alone complete it (derivation:
      // the removal spent B's seat, so every CURRENT participant has spoken).
      expect(last, "the two remaining holders could not complete the close").toBe("closed");
    },
    600_000,
  );
});
