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
  // THE WHOLE FILTERED LOG TO DISK, and only the tail inline. `slice(-60)` is right for a failure
  // message a human reads, and wrong for diagnosis: a run with a hundred delivery sweeps pushes the
  // event that explains the failure off the top, and reading the tail then "proves" a unit never
  // ran. That is exactly the trap this milestone keeps setting — reading a truncated view for
  // something emitted earlier.
  try {
    const path = `/tmp/cello-spine-${process.pid}-${Date.now()}.log`;
    writeFileSync(path, lines.join("\n"));
    // eslint-disable-next-line no-console
    console.log(`[documentLines] full filtered log (${lines.length} lines) → ${path}`);
  } catch {
    /* diagnostics must never fail a test */
  }
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
   *
   * SHARPENED 2026-08-06 after two more fixes and two more runs. Both fixes were real and are in:
   * the rejection is now transmitted, and the quarantine now bridges the chain so a supersession
   * can link across a refused envelope. Neither made this pass, and the reason is narrower than it
   * was:
   *
   *   **A's gate NEVER FIRES in this scenario — zero `document.update.quarantined` — while it fires
   *   reliably in the append-only DELETE case one describe block up, which is the same rule, the
   *   same deletion shape and the same two-party setup.** Every one of B's envelopes comes back
   *   `document_chain_refused` instead, from the first attempt onward.
   *
   * MEASURED 2026-08-06, and this is now exact — the counts are in the failure message:
   *
   *   **A quarantines exactly ONE envelope and refuses the next THREE as `document_chain_broken`.**
   *
   * So the gate DOES fire, once. The first supersession attempt is refused properly, advances the
   * round to 1, and produces a rejection. Every attempt after it never reaches the gate at all —
   * refused on the chain — so the round stays at 1 and the ceiling of 3 is unreachable. The stall
   * is not missing; it is starved.
   *
   * THREE FIXES WERE MADE FOR THIS AND NONE CLOSED IT. Each was independently right and is in:
   *   - the signed rejection was never transmitted (so the round could not advance at all);
   *   - the quarantine was not in the KNOWN-hash set;
   *   - the quarantine did not advance the chain HEAD.
   *
   * The last one should have been decisive: with no admitted envelopes from B, the head resolves to
   * the refused envelope's hash, which is exactly what B's next envelope links to. It did not change
   * the counts.
   *
   * SO THE NEXT STEP IS ONE CALL, NOT ANOTHER THEORY: instrument `verifyDocumentChainLink` for
   * envelope 2 and print what it actually compared — the envelope's `doc_prev_hash`, the `head` it
   * was given, and whether `known` contained it. Every wrong turn on this test came from reasoning
   * about the protocol instead of reading one comparison; do not add a fourth fix before that line
   * of output exists.
   */
  // RUN AGAIN 2026-08-07 with the instrumentation the header demands, and it STILL FAILS. Left
  // skipped rather than opened for a fourth fix, and the reason has changed since it was written:
  // the runaway it guards against is now stopped by the unacked ceiling, which was repaired the
  // same day (it logged "the document has stopped publishing" and kept sending — 90 times against a
  // cap of 5). This stall is a second net behind one that now holds.
  //
  // NEXT STEP IS UNCHANGED and still costs one run: capture `document.inbound.chain_refused` for
  // envelope 2 and read `claimedPrev` / `ourHead` / `prevIsKnown` / `knownCount`, which the refusal
  // now prints. Do not add a fourth fix before that output exists.
  it("repeated refusals STALL the document rather than retrying forever", async () => {
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
    // ONE ATTEMPT AT A TIME, each waiting for the peer to actually rule on it.
    //
    // The first version fired four writes 2.5s apart, which is not how supersession works and is
    // not what it was testing: write 2 left before write 1 had been refused, so it chained onto an
    // envelope the peer had not ruled on, and every one after came back `document_chain_refused` —
    // a transport-ordering artefact of the test, wearing the name of a protocol state.
    //
    // Waiting on the refusal count means each attempt is a real supersession attempt against a peer
    // that has already said no to the last one.
    const refusals = (): number =>
      (a.daemon.output.match(/"event":"document\.update\.quarantined"/g) ?? []).length;
    // THREE attempts, not four. `MAX_REJECTED_ROUNDS` is 3, so the third refusal is what stalls the
    // document — and a stalled document refuses the next publish, which is the whole point of the
    // ceiling. Asserting four successful publishes AND a stall asked for two things that cannot both
    // be true, and it was written before the path could reach the ceiling at all, so nobody found
    // out. The fourth attempt is asserted below, as a REFUSAL.
    for (let i = 0; i < 3; i++) {
      const before = refusals();
      // ASSERTED. The previous version ignored this result, and the run then showed zero
      // `document.published` — B never published anything at all, so of course nothing was ever
      // refused and nothing ever stalled. A test that does not check the call it makes cannot tell
      // "the protocol did not stall" from "the protocol was never exercised".
      const w = (await b.conn.call("cello_doc_write", {
        document_id: documentId,
        content: `one\nsupersede ${i}\n`,
      })) as { ok?: boolean; changed?: boolean; published?: boolean; reason?: string };
      expect(
        w,
        `B's supersession attempt ${i} did not publish: ${JSON.stringify(w)}\n` +
          `--- B (sender) ---\n${documentLines(b.daemon)}\n--- A (receiver) ---\n${documentLines(a.daemon)}`,
      ).toMatchObject({ ok: true, published: true });
      const ruled = Date.now() + 30_000;
      while (Date.now() < ruled && refusals() === before) await sleep(500);
    }

    // THE CEILING BINDS. A fourth supersession must be refused rather than published — that is what
    // "stops retrying forever" means from the operator's chair, and the reason names the state.
    const overCeiling = (await b.conn.call("cello_doc_write", {
      document_id: documentId,
      content: "one\nsupersede 3\n",
    })) as { ok?: boolean; published?: boolean; reason?: string };
    expect(
      overCeiling,
      `the 4th supersession published even though the ceiling is ${3} rounds: ${JSON.stringify(overCeiling)}`,
    ).toMatchObject({ ok: true, published: false, reason: "document_stalled" });

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
    // THE COUNTS, in the message. A 60-line tail of a 3-minute run cannot answer "did the gate ever
    // fire", and I read that tail three times as though it could. These two numbers decide it:
    // quarantines are gate refusals (the path that produces a rejection and advances the round);
    // chain-broken refusals are the OTHER path, which produces neither.
    const quarantined = (a.daemon.output.match(/"event":"document\.update\.quarantined"/g) ?? []).length;
    const chainBroken = (a.daemon.output.match(/"reason":"document_chain_broken"/g) ?? []).length;
    expect(
      sender,
      `B kept publishing into a document nothing would ever accept, and its own surface never said so.\n` +
        `A quarantined ${quarantined} envelope(s) (gate refusals — these advance the round) and refused ` +
        `${chainBroken} as chain-broken (these do not).\n` +
        `--- every chain refusal, with its INPUTS ---\n` +
        (a.daemon.output
          .split("\n")
          .filter((l) => /document[.]inbound[.]chain_refused|document[.]rejection|document[.]update[.]quarantined/.test(l))
          .join("\n") || "(none)") +
        `\n--- A document log (tail) ---\n${documentLines(a.daemon)}`,
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

  it("a CONTENT write keeps the author's own file in step", async () => {
    const { a, b } = await twoPartiesInSession("docwriteback");
    const proposed = (await a.conn.call("cello_doc_propose", {
      peer_pubkey: b.pubkey,
      starting_content: "line one\n",
    })) as { documentId?: string; filePath?: string };
    const documentId = proposed.documentId!;
    const fileA = proposed.filePath!;

    // `cello_doc_write` changes the DOCUMENT. Without a re-materialize the author's own projection
    // is stale the instant they use it, and the two surfaces disagree about the document they both
    // claim to show. Worse than cosmetic: `cello_doc_publish` diffs the FILE against the recorded
    // projection, so a stale file either refuses as `document_file_stale` or republishes text the
    // document has already moved past.
    //
    // Found on the first live two-agent smoke — the author's own file was missing the line she had
    // just written — and only there, because every test until now wrote via the FILE and read back
    // the file, so the two were never allowed to disagree.
    expect(await a.conn.call("cello_doc_write", {
      document_id: documentId,
      content: "line one\nline two written through the tool\n",
    })).toMatchObject({ ok: true, published: true });

    expect(readFileSync(fileA, "utf-8")).toBe("line one\nline two written through the tool\n");

    // AND the file is still a usable baseline afterwards: publishing from it must not refuse as
    // stale, which is the failure the re-materialize actually prevents.
    expect(await a.conn.call("cello_doc_publish", { document_id: documentId })).toMatchObject({
      ok: true,
      changed: false,
    });
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

/**
 * DOD-DOC-INBOUND-TERMINAL-1 — an envelope the peer can never accept must SETTLE, not retry forever.
 *
 * Found on the operator's live daemon, not by any test here. Document `662743b1…` sat at
 * `pendingSent: 1` indefinitely: the peer had refused the proposal, so they hold no such document,
 * answer `document_unknown`, and the router only ever acked `ok: true` results — so nothing settled
 * the delivery and the worker re-sent on every tick.
 *
 * The window is real and is NOT closed by the refused-document write guard, which is the trap here.
 * That guard refuses a write AFTER a refusal is known. This envelope is published BEFORE the answer
 * arrives — which is legitimate and load-bearing, because publishing to a peer who has not yet
 * decided is what makes proposing to an offline peer work at all. The refusal then lands on an
 * envelope already in the delivery queue.
 *
 * Two surfaces, and no single-surface test crosses them: the sender's delivery worker and the
 * receiver's inbound refusal path. Unit tests on either half pass with the bug present.
 */
describe("J-DOCUMENTS-TERMINAL — a REFUSED proposal settles its in-flight update (DOD-DOC-INBOUND-TERMINAL-1)", () => {
  it("an update published before the refusal stops retrying once the peer says they have no such document", async () => {
    const { a, b } = await twoPartiesInSession("terminal");

    const proposed = (await a.conn.call("cello_doc_propose", {
      peer_pubkey: b.pubkey,
      starting_content: "# Draft\n",
    })) as { ok?: boolean; documentId?: string; proposalSent?: boolean };
    expect(proposed.ok, `propose failed: ${JSON.stringify(proposed)}`).toBe(true);
    const documentId = proposed.documentId!;

    // PUBLISH WHILE UNANSWERED. This must succeed — it is the offline-peer case — and it is what
    // puts an envelope into the delivery queue that the refusal will orphan.
    const wrote = (await a.conn.call("cello_doc_write", {
      document_id: documentId,
      content: "# Draft\n\nfirst thoughts\n",
    })) as { ok?: boolean; published?: boolean; reason?: string };
    expect(wrote, `the pre-answer write should be allowed: ${JSON.stringify(wrote)}`).toMatchObject({
      ok: true,
      published: true,
    });

    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const inbox = (await b.conn.call("cello_doc_inbox", {})) as { proposals?: Array<{ documentId?: string }> };
      if (inbox.proposals?.some((p) => p.documentId === documentId)) break;
      await sleep(1000);
    }

    // B REFUSES. B never creates a document row, so every redelivery of A's envelope now meets
    // `document_unknown`.
    expect(
      await b.conn.call("cello_doc_refuse", { document_id: documentId, reason: "wrong document" }),
    ).toMatchObject({ ok: true });

    // THE ASSERTION: A's pending delivery drains. Before the fix this stayed at 1 forever, and the
    // surface reported the document as having work outstanding with no way to ever clear it.
    //
    // `pendingDeliveries` — the TOTAL — and not `pendingSent`. That distinction is the whole test:
    // `pendingSent` counts only the envelopes that have LEFT this machine, so it reads 0 for one
    // that has not been dialled yet and the assertion passes with the defect fully present. It did
    // — this enforcer was written against `pendingSent` first, passed against a build with the fix
    // reverted, and only the revert run exposed it as hollow.
    let pendingDeliveries: number | undefined;
    const settleBy = Date.now() + 90_000;
    while (Date.now() < settleBy) {
      const listed = (await a.conn.call("cello_doc_list", {})) as {
        documents?: Array<{ documentId?: string; pendingDeliveries?: number }>;
      };
      pendingDeliveries = listed.documents?.find((d) => d.documentId === documentId)?.pendingDeliveries;
      if (pendingDeliveries === 0) break;
      await sleep(2000);
    }
    expect(
      pendingDeliveries,
      // BOTH daemons' own account. The sender reports the symptom; the answer is on the receiver,
      // and printing only the sender is what cost a round of guessing on an earlier defect.
      `A's update never settled — it is still queued for a peer that will never accept it.\n` +
        `--- A (sender) document log ---\n${documentLines(a.daemon)}\n` +
        `--- B (receiver) document log ---\n${documentLines(b.daemon)}`,
    ).toBe(0);
  }, 240_000);
});

/**
 * Two registered agents on two daemons with NO SESSION BETWEEN THEM — the case every other
 * enforcer in this file skips, and the reason none of them can fail on the ack path.
 *
 * `twoPartiesInSession` opens a session and exchanges a message before touching a document. That
 * leaves an interactive session open for the rest of the test, so the delivery worker REUSES it
 * rather than opening its own — and a reused session is not sealed, so the peer's ack always has a
 * live channel to come home on. Every ack in this file arrives for that reason.
 *
 * Two agents who co-edit without chatting first have no such session. The worker opens one, and
 * the open-or-reuse-THEN-SEAL contract seals it — so the ack is written into a session that is
 * already sealing. That is the ordinary case for the feature, and nothing covered it.
 */
async function twoPartiesNoSession(label: string): Promise<{ a: Party; b: Party }> {
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

  // NO cello_initiate_session, and NO cello_send. That absence IS the test fixture.
  const a: Party = { conn: connA, daemon: daemonA, celloDir: celloDirA, pubkey: pubA, sessionId: "" };
  const b: Party = { conn: connB, daemon: daemonB, celloDir: celloDirB, pubkey: pubB, sessionId: "" };
  return { a, b };
}

describe("J-DOCUMENTS-NOCHAT — co-editing with NO conversation open (DOD-DOC-E2E-NOCHAT-1)", () => {
  it("a published update is ACKNOWLEDGED when the delivery worker had to open the session itself", async () => {
    const { a, b } = await twoPartiesNoSession("nochat");

    const proposed = (await a.conn.call("cello_doc_propose", {
      peer_pubkey: b.pubkey,
      starting_content: "# Shared\n\nline one\n",
    })) as { ok?: boolean; documentId?: string };
    expect(proposed.ok, `propose failed: ${JSON.stringify(proposed)}`).toBe(true);
    const documentId = proposed.documentId!;

    const inboxBy = Date.now() + 90_000;
    while (Date.now() < inboxBy) {
      const inbox = (await b.conn.call("cello_doc_inbox", {})) as { proposals?: Array<{ documentId?: string }> };
      if (inbox.proposals?.some((p) => p.documentId === documentId)) break;
      await sleep(1000);
    }
    expect(await b.conn.call("cello_doc_accept", { document_id: documentId })).toMatchObject({ ok: true });

    const updated = "# Shared\n\nline one\nline two from A\n";
    expect(
      await a.conn.call("cello_doc_write", { document_id: documentId, content: updated }),
    ).toMatchObject({ ok: true, published: true });

    // The content still arrives — the frame is sent before the seal, so convergence was never the
    // broken half. Asserted anyway, so a failure below cannot be confused for a delivery failure.
    // BOTH LOGS on a convergence failure. `waitForText` prints only the text, and the answer to
    // "why did it not arrive" is never in the text — it is in the sender's delivery attempts.
    try {
      await waitForText(b.conn, documentId, updated, "B's copy with no conversation open");
    } catch (err: unknown) {
      throw new Error(
        `${err instanceof Error ? err.message : String(err)}\n` +
          `--- A (sender) document log ---\n${documentLines(a.daemon)}\n` +
          `--- B (receiver) document log ---\n${documentLines(b.daemon)}`,
      );
    }

    // THE ASSERTION. The peer applied it and answered; the answer has to reach us. Unacknowledged,
    // the worker re-sends every tick until the unacked ceiling retires it — which reads to the
    // operator as a document that silently stopped publishing.
    let pendingDeliveries: number | undefined;
    const settleBy = Date.now() + 120_000;
    while (Date.now() < settleBy) {
      const listed = (await a.conn.call("cello_doc_list", {})) as {
        documents?: Array<{ documentId?: string; pendingDeliveries?: number }>;
      };
      pendingDeliveries = listed.documents?.find((d) => d.documentId === documentId)?.pendingDeliveries;
      if (pendingDeliveries === 0) break;
      await sleep(2000);
    }
    expect(
      pendingDeliveries,
      `A's update was applied by B but never acknowledged — the ack had no session to come home on.\n` +
        `--- A (sender) document log ---\n${documentLines(a.daemon)}\n` +
        `--- B (receiver) document log ---\n${documentLines(b.daemon)}`,
    ).toBe(0);
  }, 300_000);
});
