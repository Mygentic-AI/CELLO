/**
 * J-DOCUMENTS — DOD-DOC-E2E-CONV-1, the CONVERGENCE enforcer.
 *
 * Two REAL daemons, a real three-node consortium, a real registration DKG, a real session. A
 * proposes a shared document, B consents, both edit — including an overlapping region — both
 * publish, and both copies converge. Then the session that carried the document traffic seals, and
 * both sides independently recompute the same Merkle root over a tree containing document leaves
 * alongside message and control leaves.
 *
 * ── WHY THIS EXISTS WHEN THE UNIT TESTS ARE GREEN ─────────────────────────────────────────────
 *
 * M14's unit suite passed the entire time the feature did nothing. Three separate defects, each
 * invisible to it, and all three the same shape:
 *
 *   - the seven `cello_doc_*` verbs were registered into a snapshot copy of the handler map and
 *     none of them dispatched — the handler test builds its own map, so it proved the functions
 *     work when you hold a reference, which was never the claim;
 *   - `cello_doc_write` replaced the whole text, so two agents each sending back "the complete
 *     document" converged on both documents CONCATENATED, signed and published by both parties;
 *   - `notifyPeer` was stubbed to `async () => ({ ok: true })` in the two-party test, so kill
 *     passed its assertions and told nobody.
 *
 * A stub on the far side cannot disagree with you. This file has no stubs: the only things it
 * controls are what the two operators type.
 *
 * Anchored to the BINARY — see live-harness.ts. No in-process node construction, and no fixture of
 * its own (M14-PROCEDURE: extend the shared harness, never write a second one).
 *
 * Run: pnpm --filter @cello-protocol/e2e-tests test:spine
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
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
  // THREE nodes with a signed manifest, for the two reasons every spine file that skipped it hit:
  // without a manifest the daemon never learns its own directory node id, so two LOCAL agents get
  // routed down the cross-node path and die at `discovery_node_unresolvable`; and registration runs
  // a real FROST DKG, which a one-node cluster cannot satisfy. The N has to be real.
  const holder = mkdtempSync(join(tmpdir(), "cello-documents-consortium-"));
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

async function startLocalDaemon(celloDir: string, label: string): Promise<Proc> {
  const nodes = [0, 1, 2].map((i) => spineDirectoryNode(i, cluster.directoryUrls[i]));
  return startDaemon(celloDir, cluster.directoryUrls[0], label, {
    manifestEnv: writeConsortiumManifest(celloDir, label, nodes),
    // The delivery sweep is 60s in production — deliberately slow, because the event it waits for
    // (a peer coming back) is not one the daemon observes. A live test that sits out two of those
    // spends four minutes waiting, and the window has to be so wide that adding a second test to
    // the file made the first one time out. Same knob shape as CELLO_SEAL_BILATERAL_TIMEOUT_MS.
    extraEnv: { CELLO_DOCUMENT_DELIVERY_TICK_MS: "2000" },
  });
}

/**
 * ONE JOURNEY'S DAEMONS DIE WITH THAT JOURNEY.
 *
 * They used to live until `afterAll`, so the second test ran against a cluster attended by four
 * daemons and the third by six — all registered, all holding signaling streams and sessions against
 * the same three directory nodes. Every test passed alone and the later ones failed together, which
 * reads exactly like a product defect and is not one: real deployments do not accumulate abandoned
 * daemons on one directory, so the interference is an artefact of the harness.
 *
 * Torn down per test, the file is also faster — nothing idles, and the delivery sweeps of dead
 * journeys stop competing for the relay.
 */
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

/** Every document-layer line a daemon emitted, for failure messages that name the cause. */
function documentLines(proc: Proc): string {
  const lines = proc.output
    .split("\n")
    .filter((l) =>
      // The events the ordering question is actually decided by — the tree, the relay's assigned
      // sequence, and the HOLD path. A frame held for a gap only this daemon could fill logs at
      // INFO, not warn, so a filter that only looked for failures saw nothing and I concluded the
      // frame had never arrived.
      /document\.|"cello_doc|frame\.|security\.|session\.content|session\.document|session\.tree|relay\.hash|session\.relay/.test(l),
    );
  return lines.length > 0 ? lines.slice(-60).join("\n") : "(no document-layer lines at all)";
}

/**
 * Poll until `read` returns the expected text, or fail with what it actually said.
 *
 * Convergence is ASYNCHRONOUS by design — publish is fire-and-forget and a background worker
 * delivers on a 60s tick, so a bare assertion after a publish is a race that passes on a fast
 * machine. Polling is the honest shape; the timeout is what makes the failure a failure.
 */
async function waitForText(
  conn: McpConn,
  documentId: string,
  expected: string,
  label: string,
  timeoutMs = 90_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    const res = (await conn.call("cello_doc_read", { document_id: documentId })) as {
      ok?: boolean;
      content?: string;
    };
    last = res.content ?? `<no content: ${JSON.stringify(res)}>`;
    if (last === expected) return;
    await sleep(1000);
  }
  expect(last, `${label} never converged`).toBe(expected);
}

interface Party {
  conn: McpConn;
  daemon: Proc;
  celloDir: string;
  pubkey: string;
  sessionId: string;
}

/** Two registered agents on two daemons, with a live session between them. */
async function twoPartiesInSession(label: string): Promise<{ a: Party; b: Party }> {
  const celloDirA = mkdtempSync(join(tmpdir(), `cello-${label}A-`));
  const celloDirB = mkdtempSync(join(tmpdir(), `cello-${label}B-`));
  dirs.push(celloDirA, celloDirB);
  const pubA = await provisionAgent(celloDirA, "agentA");
  const pubB = await provisionAgent(celloDirB, "agentB");
  const daemonA = await startLocalDaemon(celloDirA, `${label}A`);
  const daemonB = await startLocalDaemon(celloDirB, `${label}B`);
  daemons.push(daemonA, daemonB);
  expect(registerAgent("agentA", `DEV-${label}-A-${randomBytes(6).toString("hex")}`, { CELLO_DIR: celloDirA }).status).toBe(0);
  expect(registerAgent("agentB", `DEV-${label}-B-${randomBytes(6).toString("hex")}`, { CELLO_DIR: celloDirB }).status).toBe(0);

  const connA = await connectMcp(celloDirA, `${label}-A`);
  const connB = await connectMcp(celloDirB, `${label}-B`);
  mcpConns.push(connA, connB);
  for (const [conn, name] of [[connA, "agentA"], [connB, "agentB"]] as const) {
    expect(((await conn.call("cello_start_agent", { name })) as { ok?: boolean }).ok).toBe(true);
    expect(((await conn.call("cello_use_agent", { name })) as { ok?: boolean }).ok).toBe(true);
  }

  const awaitP = connB.call("cello_await_session", { timeout_ms: 25_000 });
  const init = (await connA.call("cello_initiate_session", { target_pubkey: pubB })) as {
    ok?: boolean;
    sessionId?: string;
  };
  expect(init.ok, `cello_initiate_session failed: ${JSON.stringify(init)}`).toBe(true);
  const inbound = (await awaitP) as { type?: string; session_id?: string };
  expect(inbound.type).toBe("new_session");

  const a: Party = { conn: connA, daemon: daemonA, celloDir: celloDirA, pubkey: pubA, sessionId: init.sessionId! };
  const b: Party = { conn: connB, daemon: daemonB, celloDir: celloDirB, pubkey: pubB, sessionId: inbound.session_id! };

  // ONE ROUND TRIP BEFORE ANY DOCUMENT, in BOTH directions.
  //
  // Under investigation, not decoration. A document frame sent immediately after
  // `cello_initiate_session` returns is sometimes lost — no error on either side, the sender logs a
  // successful send, the receiver logs nothing — and the case that has always carried a message
  // exchange first is the case that has always been reliable. Establishing that correlation is the
  // point: if the journeys become reliable with this and unreliable without it, the race is in the
  // window between a session being reported open and it actually carrying content, which is a
  // product defect and not a harness one.
  expect(((await b.conn.call("cello_send", {
    cello_session_id: b.sessionId,
    content: "B can reach A",
    signal: "over",
  })) as { ok?: boolean }).ok).toBe(true);
  expect(((await a.conn.call("cello_receive", {
    cello_session_id: a.sessionId,
    timeout_ms: 20_000,
  })) as { content?: string | null }).content).toBe("B can reach A [[OVER]]");

  return { a, b };
}

describe("J-DOCUMENTS — two real daemons converge on one document (DOD-DOC-E2E-CONV-1)", () => {
  it("propose → consent → concurrent edits including an OVERLAP → both converge → seal verifies over document leaves", async () => {
    const { a, b } = await twoPartiesInSession("docs");

    // ── 1. THE VERBS DISPATCH AT ALL ──────────────────────────────────────────────────────────
    // Asserted first and separately, because the whole surface once answered `method_not_found`
    // over the socket while every unit test stayed green. If this fails, nothing below means
    // anything.
    expect(await a.conn.call("cello_doc_list", {})).toMatchObject({ ok: true });

    // ── 2. PROPOSE AND CONSENT ────────────────────────────────────────────────────────────────
    const starting = "# Release plan\n\nowner: unassigned\ndate: unassigned\n";
    const proposed = (await a.conn.call("cello_doc_propose", {
      peer_pubkey: b.pubkey,
      starting_content: starting,
    })) as { ok?: boolean; documentId?: string; proposalSent?: boolean };
    expect(proposed.ok, `propose failed: ${JSON.stringify(proposed)}`).toBe(true);
    expect(proposed.proposalSent, "the proposal did not reach the peer").toBe(true);
    const documentId = proposed.documentId!;

    // It is B's DECISION, and it arrives over the real session as a real signed frame.
    const deadline = Date.now() + 60_000;
    let inbox: { proposals?: Array<{ documentId?: string }> } = {};
    while (Date.now() < deadline) {
      inbox = (await b.conn.call("cello_doc_inbox", {})) as typeof inbox;
      if (inbox.proposals?.some((p) => p.documentId === documentId)) break;
      await sleep(1000);
    }
    expect(
      inbox.proposals?.map((p) => p.documentId),
      // The daemons' OWN account of what happened, in the failure message. A bare "expected [] to
      // include …" here sends whoever reads it to guess between "A never sent", "B never
      // classified" and "B refused" — three different bugs with one symptom.
      "the proposal never reached B's inbox.\n" +
        `--- A document log ---\n${documentLines(a.daemon)}\n` +
        `--- B document log ---\n${documentLines(b.daemon)}`,
    ).toContain(documentId);

    expect(await b.conn.call("cello_doc_accept", { document_id: documentId })).toMatchObject({ ok: true });
    // Epoch zero from the SAME bytes on both sides — the reason starting_content travels as a Yjs
    // update rather than a string. Two documents built independently from one template never
    // converge.
    await waitForText(b.conn, documentId, starting, "B's copy after accept");

    // The proposer is TOLD, rather than left to infer it from traffic. POLLED — the ack is its own
    // frame travelling the same asynchronous road as everything else, so asserting it the
    // instant accept returns is a race that passes only when the loopback happens to be quick.
    const ackDeadline = Date.now() + 60_000;
    let peerAccepted: boolean | null | undefined;
    while (Date.now() < ackDeadline) {
      const listed = (await a.conn.call("cello_doc_list", {})) as {
        documents?: Array<{ documentId?: string; peerAccepted?: boolean | null }>;
      };
      peerAccepted = listed.documents?.find((d) => d.documentId === documentId)?.peerAccepted;
      if (peerAccepted !== null && peerAccepted !== undefined) break;
      await sleep(1000);
    }
    expect(
      peerAccepted,
      // BOTH sides. The first version printed only B's — the SENDER — which is the half that
      // already reported success. The receiving side is where the answer is, and not printing it
      // cost a whole round of guessing.
      `A was never told B's decision.\n` +
        `--- A (receiver) document log ---\n${documentLines(a.daemon)}\n` +
        `--- B (sender) document log ---\n${documentLines(b.daemon)}`,
    ).toBe(true);

    // ── 3. CONCURRENT EDITS, INCLUDING AN OVERLAPPING REGION ──────────────────────────────────
    // Both sides send back the COMPLETE document, which is the contract, and both edit the SAME
    // line — `owner:` — as well as one line only they touch. Under the whole-text replace this
    // shipped with, this converged on both documents concatenated.
    // ASSERTED, both of them. These were fire-and-forget calls, so a write that applied locally and
    // published NOTHING — which is a documented, legitimate return shape — looked identical to a
    // successful one, and the failure surfaced 120 seconds later as "never converged". A test that
    // does not check the call it makes cannot tell you which half broke.
    const wroteA = (await a.conn.call("cello_doc_write", {
      document_id: documentId,
      content: "# Release plan\n\nowner: alice\ndate: unassigned\n",
    })) as { ok?: boolean; published?: boolean; reason?: string };
    expect(wroteA, `A's write did not publish: ${JSON.stringify(wroteA)}`).toMatchObject({
      ok: true,
      changed: true,
      published: true,
    });
    const wroteB = (await b.conn.call("cello_doc_write", {
      document_id: documentId,
      content: "# Release plan\n\nowner: unassigned\ndate: friday\n",
    })) as { ok?: boolean; published?: boolean; reason?: string };
    expect(wroteB, `B's write did not publish: ${JSON.stringify(wroteB)}`).toMatchObject({
      ok: true,
      changed: true,
      published: true,
    });

    // ── 4. BOTH CONVERGE ──────────────────────────────────────────────────────────────────────
    // The independent edits both survive; the document is not duplicated, and the untouched heading
    // appears exactly once.
    // POLLED FOR AGREEMENT, not for substrings. The first version returned as soon as each side
    // contained both edits and then compared the two — which is a race: one side can hold both
    // while the other is still applying, and the comparison fires on a snapshot that was never
    // meant to be final. It reported "the two copies diverged", which is the most alarming thing
    // this test can say, for a document that converged a second later.
    const readBoth = async (): Promise<[string, string]> => {
      const ra = (await a.conn.call("cello_doc_read", { document_id: documentId })) as { content?: string };
      const rb = (await b.conn.call("cello_doc_read", { document_id: documentId })) as { content?: string };
      return [ra.content ?? "", rb.content ?? ""];
    };
    const settled = Date.now() + 120_000;
    let textA = "";
    let textB = "";
    while (Date.now() < settled) {
      [textA, textB] = await readBoth();
      if (textA === textB && textA.includes("alice") && textA.includes("friday")) break;
      await sleep(1000);
    }
    expect(textA, "A never received both edits").toContain("friday");
    expect(textB, "B never received both edits").toContain("alice");

    // CONVERGENCE IS THE PRODUCT CLAIM. Byte-identical, asserted through the operator surface
    // rather than the live cache.
    expect(textB, "the two copies diverged").toBe(textA);
    // Not concatenated: the parts neither side edited appear once.
    expect(textA.match(/# Release plan/g), "the document was duplicated").toHaveLength(1);
    expect(textA.match(/date:/g), "a line neither side removed was duplicated").toHaveLength(1);

    // ── 5. THE DIFF IS WHAT AN AGENT REVIEWS ──────────────────────────────────────────────────
    // B reads (moving the bookmark), A writes again, B sees exactly that change.
    await b.conn.call("cello_doc_read", { document_id: documentId });
    await a.conn.call("cello_doc_write", { document_id: documentId, content: `${textA}notes: ship it\n` });
    const seenByB = async (): Promise<{ diff?: string | null; unchanged?: boolean }> => {
      const t = Date.now() + 120_000;
      let last: { diff?: string | null; unchanged?: boolean } = {};
      while (Date.now() < t) {
        last = (await b.conn.call("cello_doc_diff", { document_id: documentId })) as typeof last;
        if (last.unchanged === false) return last;
        await sleep(1500);
      }
      return last;
    };
    const diff = await seenByB();
    expect(diff.unchanged, "B never saw A's change as a diff").toBe(false);
    expect(String(diff.diff)).toContain("ship it");

    // ── 6. THE SESSION SEALS OVER A TREE CONTAINING DOCUMENT LEAVES ───────────────────────────
    // The document traffic rode the same session as any message would, so its leaves are in the
    // same Merkle tree. A message is sent too, so the tree is genuinely MIXED — 0x00 message,
    // 0x04 document, 0x02 control at close — which is the case the leaf-kind work exists for.
    expect(((await a.conn.call("cello_send", {
      cello_session_id: a.sessionId,
      content: "plan looks right to me",
      signal: "over",
    })) as { ok?: boolean }).ok).toBe(true);
    expect(((await b.conn.call("cello_receive", {
      cello_session_id: b.sessionId,
      timeout_ms: 20_000,
    })) as { content?: string | null }).content).toBe("plan looks right to me [[OVER]]");

    const closeB = b.conn.call("cello_close_session", { cello_session_id: b.sessionId });
    const closeA = (await a.conn.call("cello_close_session", { cello_session_id: a.sessionId })) as {
      ok?: boolean;
      reason?: string;
    };
    await closeB;
    expect(closeA.ok, `A's close failed: ${JSON.stringify(closeA)}`).toBe(true);

    // BOTH SIDES INDEPENDENTLY RECOMPUTE THE SAME ROOT. Fetched from each daemon's own sealed
    // receipt — never compared against one side's reported value, which is the check the whole
    // tamper-evidence claim rests on.
    type Receipt = { ok?: boolean; sealed_root?: string; leaf_count?: number; content_leaf_count?: number };
    const receiptA = (await a.conn.call("cello_sealed_receipt", { cello_session_id: a.sessionId })) as Receipt;
    const receiptB = (await b.conn.call("cello_sealed_receipt", { cello_session_id: b.sessionId })) as Receipt;
    expect(receiptA.sealed_root, `A has no sealed root: ${JSON.stringify(receiptA)}`).toBeTruthy();
    // THE PROPERTY THE WHOLE MILESTONE RESTS ON. Two independent daemons, each rebuilding from its
    // own leaves, arriving at the same root over a tree that contains document traffic as well as
    // messages. Compared side to side — never one side's reported value against itself.
    expect(receiptB.sealed_root, "the two sides sealed different trees").toBe(receiptA.sealed_root);
    // MIXED, which is the case the doc leaf kind exists for: this session carried an ordinary
    // message AND document frames, and the seal covers both.
    expect(receiptA.leaf_count, `too few leaves to be a mixed tree: ${JSON.stringify(receiptA)}`).toBeGreaterThan(2);
  }, 600_000);

  it("a KILL reaches the peer over the real session and stops their document too", async () => {
    const { a, b } = await twoPartiesInSession("dockill");

    const proposed = (await a.conn.call("cello_doc_propose", {
      peer_pubkey: b.pubkey,
      starting_content: "shared\n",
    })) as { ok?: boolean; documentId?: string };
    const documentId = proposed.documentId!;
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const inbox = (await b.conn.call("cello_doc_inbox", {})) as { proposals?: Array<{ documentId?: string }> };
      if (inbox.proposals?.some((p) => p.documentId === documentId)) break;
      await sleep(1000);
    }
    expect(await b.conn.call("cello_doc_accept", { document_id: documentId })).toMatchObject({ ok: true });

    // The control frame travels the same road as an update. Before it existed, `notifyPeer` refused
    // and B kept publishing into a document that would never answer — with nothing on B's screen
    // explaining why.
    const killed = (await a.conn.call("cello_doc_kill", { document_id: documentId })) as {
      ok?: boolean;
      peerNotified?: boolean;
    };
    expect(killed.ok).toBe(true);
    expect(killed.peerNotified, "the peer was never told about the kill").toBe(true);

    const t = Date.now() + 60_000;
    let status: string | undefined;
    while (Date.now() < t) {
      const list = (await b.conn.call("cello_doc_list", {})) as {
        documents?: Array<{ documentId?: string; status?: string }>;
      };
      status = list.documents?.find((d) => d.documentId === documentId)?.status;
      if (status === "killed") break;
      await sleep(1000);
    }
    expect(
      status,
      "B's copy never went terminal.\n" +
        `--- A document log ---\n${documentLines(a.daemon)}\n` +
        `--- B document log ---\n${documentLines(b.daemon)}`,
    ).toBe("killed");
  }, 600_000);
});

describe("J-DOCUMENTS-OFFLINE — a change survives BOTH daemons restarting (DOD-DOC-E2E-OFFLINE-1)", () => {
  /**
   * THE IN-MEMORY-QUEUE KILLER.
   *
   * Publish while the peer is down, then kill and restart the SENDER too. Anything the sender held
   * in memory — a pending list, a retry timer, a live `Y.Doc` — is gone. What must survive is the
   * envelope log on disk, because pending delivery is DERIVED from it rather than tracked beside
   * it. If the design is right, nothing needs to be told to resume: the peer comes back and the
   * next sweep finds the work by reading the log.
   *
   * A queue that lived in memory would pass every unit test in this milestone and lose the operator's
   * edit here, silently, with both sides reporting a healthy document.
   */
  it("publish while the peer is down, restart the SENDER, then the peer — the update lands with no agent action", async () => {
    const { a, b } = await twoPartiesInSession("docoff");

    const proposed = (await a.conn.call("cello_doc_propose", {
      peer_pubkey: b.pubkey,
      starting_content: "before the outage\n",
    })) as { ok?: boolean; documentId?: string };
    expect(proposed.ok, JSON.stringify(proposed)).toBe(true);
    const documentId = proposed.documentId!;
    const inboxDeadline = Date.now() + 60_000;
    while (Date.now() < inboxDeadline) {
      const inbox = (await b.conn.call("cello_doc_inbox", {})) as { proposals?: Array<{ documentId?: string }> };
      if (inbox.proposals?.some((p) => p.documentId === documentId)) break;
      await sleep(500);
    }
    expect(await b.conn.call("cello_doc_accept", { document_id: documentId })).toMatchObject({ ok: true });
    await waitForText(b.conn, documentId, "before the outage\n", "B's copy after accept", 30_000);

    // ── B GOES DOWN ───────────────────────────────────────────────────────────────────────────
    await b.daemon.stop();

    // A writes to a peer that is not there. The publish must SUCCEED — a write that depended on the
    // other party being awake would make a shared document useless for the case it exists for.
    const wrote = (await a.conn.call("cello_doc_write", {
      document_id: documentId,
      content: "before the outage\nwritten while B was down\n",
    })) as { ok?: boolean; published?: boolean; reason?: string };
    expect(wrote, `A's offline write did not publish: ${JSON.stringify(wrote)}`).toMatchObject({
      ok: true,
      changed: true,
      published: true,
    });

    // ── AND NOW THE SENDER GOES DOWN TOO ──────────────────────────────────────────────────────
    // Everything held in memory is gone on both sides. Only what is on disk can carry this.
    await a.daemon.stop();
    await a.conn.close();

    const daemonA2 = await startLocalDaemon(a.celloDir, "docoffA2");
    daemons.push(daemonA2);
    const connA2 = await connectMcp(a.celloDir, "docoff-A2");
    mcpConns.push(connA2);
    expect(((await connA2.call("cello_start_agent", { name: "agentA" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connA2.call("cello_use_agent", { name: "agentA" })) as { ok?: boolean }).ok).toBe(true);

    // The restarted sender still knows there is work outstanding — read from the log, not restored
    // from a queue it no longer has.
    const stillPending = (await connA2.call("cello_doc_list", {})) as {
      documents?: Array<{ documentId?: string; pendingDeliveries?: number }>;
    };
    expect(
      stillPending.documents?.find((d) => d.documentId === documentId)?.pendingDeliveries,
      `the restarted sender forgot the undelivered change: ${JSON.stringify(stillPending)}`,
    ).toBeGreaterThan(0);
    // And its own copy is intact — rebuilt from the log, not lost with the process.
    expect(await connA2.call("cello_doc_read", { document_id: documentId })).toMatchObject({
      content: "before the outage\nwritten while B was down\n",
    });

    // ── B COMES BACK ──────────────────────────────────────────────────────────────────────────
    const daemonB2 = await startLocalDaemon(b.celloDir, "docoffB2");
    daemons.push(daemonB2);
    const connB2 = await connectMcp(b.celloDir, "docoff-B2");
    mcpConns.push(connB2);
    expect(((await connB2.call("cello_start_agent", { name: "agentB" })) as { ok?: boolean }).ok).toBe(true);
    expect(((await connB2.call("cello_use_agent", { name: "agentB" })) as { ok?: boolean }).ok).toBe(true);

    // ZERO AGENT ACTION from here. Nobody re-publishes, nobody re-sends, nobody is asked to. The
    // sweep reads the log, finds the peer reachable, and delivers.
    await waitForText(
      connB2,
      documentId,
      "before the outage\nwritten while B was down\n",
      "B's copy after both daemons restarted",
      120_000,
    );

    // And the sender's pending count clears, so "delivered" is a fact it can act on rather than an
    // assumption — otherwise it redelivers forever.
    const cleared = Date.now() + 60_000;
    let pending: number | undefined;
    while (Date.now() < cleared) {
      const listed = (await connA2.call("cello_doc_list", {})) as {
        documents?: Array<{ documentId?: string; pendingDeliveries?: number }>;
      };
      pending = listed.documents?.find((d) => d.documentId === documentId)?.pendingDeliveries;
      if (pending === 0) break;
      await sleep(1000);
    }
    expect(pending, "the sender never learned the change had landed").toBe(0);
  }, 600_000);
});

describe("J-DOCUMENTS-APPEND — append_only is enforced on the RECEIVER (DOD-DOC-E2E-APPEND-1)", () => {
  /**
   * Use Case B's V1 claim: a document neither party can quietly shorten.
   *
   * The claim is only worth anything if it is enforced where it cannot be bypassed. `append_only`
   * is agreed in the proposal and bound into `document_id`, and it is checked by the RECEIVER's
   * gate — so a peer running a patched client that simply does not enforce it locally still cannot
   * make the deletion land, because the other side refuses the envelope. Enforcing it only on the
   * sender would be a promise kept by whoever is not attacking you.
   */
  async function appendOnlyDocument(label: string) {
    const { a, b } = await twoPartiesInSession(label);
    const proposed = (await a.conn.call("cello_doc_propose", {
      peer_pubkey: b.pubkey,
      starting_content: "line one\nline two\n",
      append_only: true,
    })) as { ok?: boolean; documentId?: string };
    expect(proposed.ok, JSON.stringify(proposed)).toBe(true);
    const documentId = proposed.documentId!;

    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const inbox = (await b.conn.call("cello_doc_inbox", {})) as {
        proposals?: Array<{ documentId?: string; appendOnly?: boolean }>;
      };
      const entry = inbox.proposals?.find((p) => p.documentId === documentId);
      if (entry) {
        // The operator is TOLD what they are consenting to. An append-only document that does not
        // announce itself is a rule someone discovers by having a deletion refused.
        expect(entry.appendOnly, "the inbox did not disclose append_only").toBe(true);
        break;
      }
      await sleep(500);
    }
    expect(await b.conn.call("cello_doc_accept", { document_id: documentId })).toMatchObject({ ok: true });
    await waitForText(b.conn, documentId, "line one\nline two\n", `${label} B after accept`, 30_000);
    return { a, b, documentId };
  }

  it("an APPENDING update converges", async () => {
    const { a, b, documentId } = await appendOnlyDocument("docappend");

    const wrote = (await b.conn.call("cello_doc_write", {
      document_id: documentId,
      content: "line one\nline two\nline three from B\n",
    })) as { ok?: boolean; published?: boolean; reason?: string };
    expect(wrote, `B's append did not publish: ${JSON.stringify(wrote)}`).toMatchObject({
      ok: true,
      published: true,
    });

    // The permitted case has to work, or "append-only" is indistinguishable from "read-only" and
    // the rule looks like a bug.
    await waitForText(
      a.conn,
      documentId,
      "line one\nline two\nline three from B\n",
      "A after B's append",
      120_000,
    );
  }, 600_000);

  it("a DELETING update is refused by the peer's gate and never lands", async () => {
    const { a, b, documentId } = await appendOnlyDocument("docdelete");

    // B removes a line. B's own copy may show it — the gate that matters is A's.
    const wrote = (await b.conn.call("cello_doc_write", {
      document_id: documentId,
      content: "line one\n",
    })) as { ok?: boolean; published?: boolean };
    expect(wrote.ok).toBe(true);

    // THE GATE MUST HAVE FIRED. Asserted before the absence-of-deletion check below, because those
    // two are not the same claim and they look identical from the outside: "the rule refused it"
    // and "it never arrived" both leave A holding both lines. Only one of them is Use Case B.
    //
    // Waiting on A's own quarantine event is what distinguishes them — it can only be emitted by
    // the gate having examined the envelope and said no.
    const gateFired = Date.now() + 60_000;
    let quarantined = false;
    while (Date.now() < gateFired && !quarantined) {
      quarantined = /"event":"document\.update\.quarantined"/.test(a.daemon.output);
      if (!quarantined) await sleep(1000);
    }
    expect(
      quarantined,
      "A never quarantined anything — so this test would pass just as well if the update had " +
        "simply not been delivered, which is not the claim.\n" +
        `--- A document log ---\n${documentLines(a.daemon)}`,
    ).toBe(true);

    // AND the deletion never lands. Held over a window rather than read once: a refusal that is
    // later undone by a redelivery would pass a single read.
    const until = Date.now() + 30_000;
    while (Date.now() < until) {
      const read = (await a.conn.call("cello_doc_read", { document_id: documentId })) as { content?: string };
      expect(
        read.content,
        "A's gate admitted a deletion into an append-only document — Use Case B's whole claim",
      ).toContain("line two");
      await sleep(3000);
    }
  }, 600_000);
});

describe("J-DOCUMENTS-REJECT — a refused envelope seals, and both sides verify it (DOD-DOC-E2E-REJECT-1)", () => {
  /**
   * The `0x05` leaf is the part of the tamper-evident record that says "this arrived and was
   * refused". It is the case the directory-side leaf work in DOD-DOC-LEAF-1 exists for, and it is
   * the one that has never been exercised end to end: a session whose tree contains a rejection has
   * to seal, and the seal has to VERIFY on both sides — which it only can if both parties agree on
   * what a refusal contributes to the root.
   *
   * A rejection that quietly broke the seal would be worse than no rejection at all: the refusal is
   * a security decision, and the record of it is the thing an operator would later need to prove.
   */
  it("a quarantined update leaves a 0x05 leaf, and the session still seals to the same root on both sides", async () => {
    const { a, b } = await twoPartiesInSession("docreject");

    const proposed = (await a.conn.call("cello_doc_propose", {
      peer_pubkey: b.pubkey,
      starting_content: "keep this line\nand this one\n",
      append_only: true,
    })) as { ok?: boolean; documentId?: string };
    const documentId = proposed.documentId!;
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const inbox = (await b.conn.call("cello_doc_inbox", {})) as { proposals?: Array<{ documentId?: string }> };
      if (inbox.proposals?.some((p) => p.documentId === documentId)) break;
      await sleep(500);
    }
    expect(await b.conn.call("cello_doc_accept", { document_id: documentId })).toMatchObject({ ok: true });
    await waitForText(b.conn, documentId, "keep this line\nand this one\n", "B after accept", 30_000);

    // B publishes a deletion into an append-only document. A's gate refuses it — that refusal is
    // what puts a 0x05 leaf in A's tree.
    expect(((await b.conn.call("cello_doc_write", {
      document_id: documentId,
      content: "keep this line\n",
    })) as { ok?: boolean }).ok).toBe(true);

    const quarantinedBy = Date.now() + 60_000;
    let quarantined = false;
    while (Date.now() < quarantinedBy && !quarantined) {
      quarantined = /"event":"document\.update\.quarantined"/.test(a.daemon.output);
      if (!quarantined) await sleep(1000);
    }
    expect(
      quarantined,
      `A never quarantined the deletion.\n--- A document log ---\n${documentLines(a.daemon)}`,
    ).toBe(true);

    // An ordinary message too, so the sealed tree is genuinely MIXED — 0x00 alongside the 0x05 and
    // the 0x04s. A tree containing only one kind cannot show that the kinds coexist in one root.
    expect(((await a.conn.call("cello_send", {
      cello_session_id: a.sessionId,
      content: "I could not take that change",
      signal: "over",
    })) as { ok?: boolean }).ok).toBe(true);
    expect(((await b.conn.call("cello_receive", {
      cello_session_id: b.sessionId,
      timeout_ms: 20_000,
    })) as { content?: string | null }).content).toBe("I could not take that change [[OVER]]");

    // ── THE SEAL ──────────────────────────────────────────────────────────────────────────────
    const closeB = b.conn.call("cello_close_session", { cello_session_id: b.sessionId });
    const closeA = (await a.conn.call("cello_close_session", { cello_session_id: a.sessionId })) as {
      ok?: boolean;
      reason?: string;
    };
    await closeB;
    expect(closeA.ok, `A's close failed with a rejection in the tree: ${JSON.stringify(closeA)}`).toBe(true);

    type Receipt = { ok?: boolean; sealed_root?: string; leaf_count?: number };
    const receiptA = (await a.conn.call("cello_sealed_receipt", { cello_session_id: a.sessionId })) as Receipt;
    const receiptB = (await b.conn.call("cello_sealed_receipt", { cello_session_id: b.sessionId })) as Receipt;
    expect(receiptA.sealed_root, `A has no sealed root: ${JSON.stringify(receiptA)}`).toBeTruthy();
    // THE ASSERTION THIS FILE EXISTS FOR. A tree containing a refusal must still produce one root
    // both parties compute independently. If a rejection leaf were counted by one side and not the
    // other, this is where it shows — and nowhere else, because every other test's tree has no
    // rejection in it.
    expect(
      receiptB.sealed_root,
      "the two sides sealed different trees once a rejection was in one of them",
    ).toBe(receiptA.sealed_root);
  }, 600_000);

  /**
   * OPEN, and skipped deliberately rather than deleted or left red.
   *
   * The DoD's stall path is "supersession rejected → one retry → stalled", and it needs the SUPERSEDE
   * protocol, which this build does not run end to end yet. What a sender actually does today is
   * keep publishing new work, and once the peer has refused one envelope, everything chained after
   * it is refused as `document_chain_refused` — a different refusal from the rule that started it,
   * and one the gate's rejection machinery never sees.
   *
   * Two real findings came out of writing it, both recorded on the DoD line:
   *   - the signed rejection was BUILT, SIGNED, LEAFED and never transmitted (nothing in production
   *     called `encodeDocumentRejection`), so the sender's round counter — which is what the whole
   *     supersede-then-stall protocol is driven by — could never leave zero. Fixed; the frame is now
   *     returned from `reject()` and put on the wire.
   *   - the only `stalled` transition that exists fires on UNACKED sends: a peer that never answers.
   *     A peer that answers "refused" every time is not covered, and that is the case an operator is
   *     most likely to hit, because it is the one a rule mismatch produces.
   *
   * Left as `skip` so it is visible and so the next person starts from the evidence rather than
   * rediscovering it. It is not a passing claim and must not be counted as one.
   */
  it.skip("repeated refusals STALL the document rather than retrying forever", async () => {
    const { a, b } = await twoPartiesInSession("docstall");
    const proposed = (await a.conn.call("cello_doc_propose", {
      peer_pubkey: b.pubkey,
      starting_content: "one\ntwo\nthree\nfour\n",
      append_only: true,
    })) as { documentId?: string };
    const documentId = proposed.documentId!;
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const inbox = (await b.conn.call("cello_doc_inbox", {})) as { proposals?: Array<{ documentId?: string }> };
      if (inbox.proposals?.some((p) => p.documentId === documentId)) break;
      await sleep(500);
    }
    await b.conn.call("cello_doc_accept", { document_id: documentId });
    await waitForText(b.conn, documentId, "one\ntwo\nthree\nfour\n", "B after accept", 30_000);

    // B keeps trying to delete. Each attempt is refused by A's gate, and the point of the retry
    // ceiling is that this TERMINATES: a sender that redelivers a refused envelope forever
    // re-triggers the peer's gate forever, and neither operator is ever told the collaboration has
    // stopped working.
    for (let i = 0; i < 4; i++) {
      await b.conn.call("cello_doc_write", { document_id: documentId, content: `one\nsupersede ${i}\n` });
      await sleep(2500);
    }

    const statusOf = async (conn: McpConn): Promise<string | undefined> => {
      const listed = (await conn.call("cello_doc_list", {})) as {
        documents?: Array<{ documentId?: string; status?: string }>;
      };
      return listed.documents?.find((d) => d.documentId === documentId)?.status;
    };

    // VISIBLE ON THE SENDER at minimum — they are the one whose work is not landing, and a document
    // that silently stops converging is the failure this milestone most needs to not have.
    const until = Date.now() + 90_000;
    let sender: string | undefined;
    let receiver: string | undefined;
    while (Date.now() < until) {
      sender = await statusOf(b.conn);
      receiver = await statusOf(a.conn);
      if (sender === "stalled") break;
      await sleep(2000);
    }
    expect(
      sender,
      "B kept publishing into a document nothing would ever accept, and its own surface never said " +
        `so.\n--- A document log ---\n${documentLines(a.daemon)}`,
    ).toBe("stalled");
    // The receiver's view is recorded rather than asserted equal: A refused every envelope, so
    // whether A also considers the document stalled is a separate design question from whether B
    // knows to stop. Captured so a change in it is visible.
    expect(["active", "stalled"], `unexpected receiver status ${String(receiver)}`).toContain(receiver);
  }, 600_000);
});

describe("J-DOCUMENTS-WRITE — the FILE round trip (DOD-DOC-E2E-WRITE-1)", () => {
  /**
   * §4.1's premise: a human collaborates on a document by editing a file in their editor, and an
   * agent with file tools reaches for those before any MCP verb. The whole write path — materialize,
   * diff-the-file, admit-and-rewrite — existed, was tested, and was instantiated NOWHERE, which is
   * the same defect the tool surface had: a complete unit with no production caller reads exactly
   * like a working feature.
   *
   * This drives it the way an operator would: touch the file, publish, and check the peer's file on
   * disk — not the peer's in-memory document.
   */
  it("edit the file → publish → the PEER'S FILE is rewritten, and both files match", async () => {
    const { a, b } = await twoPartiesInSession("docfile");

    const proposed = (await a.conn.call("cello_doc_propose", {
      peer_pubkey: b.pubkey,
      starting_content: "# Shared notes\n\n- first point\n",
    })) as { ok?: boolean; documentId?: string; filePath?: string };
    expect(proposed.ok, JSON.stringify(proposed)).toBe(true);
    const documentId = proposed.documentId!;
    // THE PATH IS RETURNED. An operator cannot edit a file whose location they are never told, and
    // an agent cannot either.
    expect(proposed.filePath, `propose did not return a file path: ${JSON.stringify(proposed)}`).toBeTruthy();
    const fileA = proposed.filePath!;
    expect(readFileSync(fileA, "utf-8")).toBe("# Shared notes\n\n- first point\n");

    const inboxBy = Date.now() + 60_000;
    while (Date.now() < inboxBy) {
      const inbox = (await b.conn.call("cello_doc_inbox", {})) as { proposals?: Array<{ documentId?: string }> };
      if (inbox.proposals?.some((p) => p.documentId === documentId)) break;
      await sleep(500);
    }
    const accepted = (await b.conn.call("cello_doc_accept", { document_id: documentId })) as {
      ok?: boolean;
      filePath?: string;
    };
    expect(accepted.ok).toBe(true);
    const fileB = accepted.filePath!;
    expect(fileB, "accept did not return a file path").toBeTruthy();
    // B's file exists from the moment of consent, not lazily on first use — otherwise B's first
    // publish has no recorded projection to diff against and refuses, for something B never asked
    // for.
    expect(readFileSync(fileB, "utf-8")).toBe("# Shared notes\n\n- first point\n");

    // ── A EDITS THE FILE, the way a person or a file-tool agent does ───────────────────────────
    writeFileSync(fileA, "# Shared notes\n\n- first point\n- second point from A\n");
    const published = (await a.conn.call("cello_doc_publish", { document_id: documentId })) as {
      ok?: boolean;
      changed?: boolean;
      published?: boolean;
      reason?: string;
    };
    expect(published, `publishing A's file edit failed: ${JSON.stringify(published)}`).toMatchObject({
      ok: true,
      changed: true,
      published: true,
    });

    // ── B'S FILE IS REWRITTEN, with no action by B ─────────────────────────────────────────────
    const rewrittenBy = Date.now() + 120_000;
    let onDiskB = "";
    while (Date.now() < rewrittenBy) {
      onDiskB = readFileSync(fileB, "utf-8");
      if (onDiskB.includes("second point from A")) break;
      await sleep(1000);
    }
    expect(
      onDiskB,
      "A published a file edit and B's file on disk never changed — the file surface is write-only, " +
        "which is worse than not having one: the stale file reads as the document and gets " +
        "published back over the peer's work.",
    ).toContain("second point from A");

    // ── AND BACK, so it is a round trip rather than one-way replication ────────────────────────
    writeFileSync(fileB, `${onDiskB}- third point from B\n`);
    expect((await b.conn.call("cello_doc_publish", { document_id: documentId })) as { published?: boolean })
      .toMatchObject({ ok: true, published: true });

    const backBy = Date.now() + 120_000;
    while (Date.now() < backBy) {
      if (readFileSync(fileA, "utf-8").includes("third point from B")) break;
      await sleep(1000);
    }
    // BOTH FILES IDENTICAL — asserted on disk, which is the only place this claim can be checked.
    // The in-memory documents agreeing while the files differ is precisely the failure that would
    // make the feature useless to the person editing one.
    expect(readFileSync(fileA, "utf-8")).toBe(readFileSync(fileB, "utf-8"));
    expect(readFileSync(fileA, "utf-8")).toContain("second point from A");
    expect(readFileSync(fileA, "utf-8")).toContain("third point from B");
  }, 600_000);

  it("an UNCHANGED file publishes nothing", async () => {
    const { a, b } = await twoPartiesInSession("docnochange");
    const proposed = (await a.conn.call("cello_doc_propose", {
      peer_pubkey: b.pubkey,
      starting_content: "steady\n",
    })) as { documentId?: string };
    const documentId = proposed.documentId!;

    // A publish is an INTENT, and nothing changed on disk. Publishing anyway costs a leaf, a
    // delivery and a wake for the counterparty, and converges nothing.
    expect(await a.conn.call("cello_doc_publish", { document_id: documentId })).toMatchObject({
      ok: true,
      changed: false,
      published: false,
    });
  }, 600_000);
});
