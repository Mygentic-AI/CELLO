/**
 * 031-RELAYREPLAY — a new witness can prove the conversation it inherits.
 *
 * ─── What the operator lives through today ─────────────────────────────────────────────────────
 *
 * Two agents are talking and the relay witnessing them dies. From then on every message costs a
 * ten-second stall and is not witnessed. The conversation seals neither during the outage nor after
 * the relay comes back, and when they try to close, the two of them are told OPPOSITE things: one
 * gets "success, seal pending" with a root, the other gets "refused, the seal leaf could not reach
 * the witness". The refused side follows its own guidance once the relay returns and is then told
 * the counterparty has not closed — pointing at the person who did close, and was told it worked,
 * and therefore has no reason to look. Nothing recovers on its own, and the receipt is the product.
 *
 * ─── What this unit adds, and what it deliberately does not ────────────────────────────────────
 *
 * A relay can now be HANDED a conversation that started on a different relay, and can prove it from
 * signatures before agreeing to witness the rest of it. **Nothing sends one.** The client that
 * builds a replay batch is unit 3; this is the reader, and it lands first on purpose — a relay must
 * be able to refuse the new shape before any client depends on it being read.
 *
 * ─── The refusal tests, and why each one names its catcher ─────────────────────────────────────
 *
 * Four tampered batches, one test apiece, each asserting the SPECIFIC reason. Asserting only "it
 * was refused" would let one guard cover for another: a batch can be refused for the wrong reason
 * and still look caught, which retires a suspicion instead of raising it (M15 §0z.3 — a false
 * CAUGHT is worse than a false GREEN).
 *
 *   truncated tail  → the tip attestation. NOTHING ELSE CAN SEE IT.
 *   reordered       → the prior relay's ACK receipts, which bind content_hash → sequence.
 *   forged leaf     → the sender's own signature over Structure 1.
 *   internal gap    → contiguity, which requires the sequences to be exactly 1..N.
 *
 * ⚠️ CONTIGUITY DOES NOT MAKE THE TIP ATTESTATION REDUNDANT, and this file says so in a test name
 * because that is the conclusion a reader is most likely to reach. Contiguity proves nothing was
 * removed from the MIDDLE. A tail cut at a clean boundary is still 1..N — and the party who
 * benefits from the cut is the party assembling the batch.
 */

import {
  setupV3Tests,
  createTestScope,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@claude-flow/testing";
import { createHash, randomBytes } from "node:crypto";
import { Encoder, decode } from "cbor-x";
import * as lp from "it-length-prefixed";
import { generateKeypair } from "@cello-protocol/crypto";
import { createNode } from "@cello-protocol/transport";
import type { Stream } from "@libp2p/interface";
import { createRelayNode, RELAY_PROTOCOL_ID } from "../relay-node.js";
import { InMemoryRelayStore } from "../relay-store.js";
import type { SessionAssignment } from "../relay-types.js";
import { testOnlineToken } from "./helpers/online-token.js";
import { computeGenesisPrevRoot } from "@cello-protocol/protocol-types";
import {
  buildValidReplay,
  contentHashOf,
  contentRoot,
  forgeSenderSignature,
  restampSequence,
  signTip,
  structure2Root,
  swapAdjacent,
} from "./helpers/replay-fixture.js";

setupV3Tests();

const CBOR = new Encoder({ tagUint8Array: false });
const LEAF_COUNT = 4;

function sendFrame(stream: Stream, bytes: Uint8Array): void {
  stream.send(lp.encode.single(bytes));
}

function toU8(v: unknown): Uint8Array {
  if (v instanceof Uint8Array) return v;
  if (Buffer.isBuffer(v)) return new Uint8Array(v as Buffer);
  throw new Error(`expected bytes, got ${typeof v}`);
}

class StreamReader {
  #it: AsyncIterator<Uint8Array>;
  constructor(stream: Stream) {
    this.#it = (lp.decode(stream) as AsyncIterable<Uint8Array>)[Symbol.asyncIterator]();
  }
  async readDecoded(): Promise<Record<string, unknown>> {
    const { value, done } = await this.#it.next();
    if (done || !value) throw new Error("stream ended");
    const raw = value instanceof Uint8Array ? value : (value as { slice(): Uint8Array }).slice();
    return decode(raw) as Record<string, unknown>;
  }
  /** Read until a frame of `type` arrives — witness alerts and deliveries may interleave. */
  async readUntil(type: string): Promise<Record<string, unknown>> {
    for (let i = 0; i < 8; i++) {
      const f = await this.readDecoded();
      if (f["type"] === type) return f;
    }
    throw new Error(`no ${type} frame arrived`);
  }
}

async function performRelayAuth(
  reader: StreamReader,
  stream: Stream,
  kp: ReturnType<typeof generateKeypair>,
  dirKp: ReturnType<typeof generateKeypair>,
): Promise<void> {
  const challenge = await reader.readDecoded();
  expect(challenge["type"]).toBe("relay_auth_challenge");
  const nonce = toU8(challenge["nonce"]);
  const pubkey = await kp.getPublicKey();
  const authMsg = new Uint8Array(Buffer.concat([Buffer.from("CELLO-RELAY-AUTH-v1", "utf8"), nonce, pubkey]));
  const signature = await kp.sign(new Uint8Array(createHash("sha256").update(authMsg).digest()));
  sendFrame(stream, CBOR.encode({
    type: "relay_auth_response", pubkey, signature, online_token: await testOnlineToken(dirKp, kp),
  }) as Uint8Array);
  const ack = await reader.readDecoded();
  if (ack["type"] === "relay_auth_failed") throw new Error(`relay_auth_failed: ${String(ack["reason"])}`);
  expect(ack["type"]).toBe("relay_auth_ok");
}

/**
 * The relay's assignment TBS, rebuilt here rather than imported.
 *
 * `priorRelayId` is appended ONLY when non-empty — a test that gets this wrong is testing its own
 * encoder, so it is written out in full and the wire-shape test below pins that the relay agrees.
 */
async function makeAssignment(opts: {
  sessionId: Uint8Array;
  pubA: Uint8Array;
  pubB: Uint8Array;
  dir: ReturnType<typeof generateKeypair>;
  sessionTimestamp: number;
  priorRelayId?: string;
}): Promise<SessionAssignment> {
  const fields: unknown[] = [
    opts.sessionId, opts.pubA, opts.pubB,
    opts.sessionTimestamp > 0xffffffff ? BigInt(opts.sessionTimestamp) : opts.sessionTimestamp,
  ];
  if (opts.priorRelayId) fields.push(opts.priorRelayId);
  const tbs = CBOR.encode(fields) as Uint8Array;
  return {
    session_id: opts.sessionId,
    participant_a: opts.pubA,
    participant_b: opts.pubB,
    session_timestamp: opts.sessionTimestamp,
    directory_signature: await opts.dir.sign(tbs),
    ...(opts.priorRelayId !== undefined ? { prior_relay_id: opts.priorRelayId } : {}),
  };
}

/** A relay, a resume assignment recorded on it, and an authenticated submitter stream. */
async function harness(
  scope: ReturnType<typeof createTestScope>,
  opts?: { priorRelayId?: string | null; withDirectory?: boolean },
) {
  const dirKp = generateKeypair();
  const dirPub = await dirKp.getPublicKey();
  const store = new InMemoryRelayStore();
  const relayIdKp = generateKeypair();
  /**
   * A directory that records what it was asked to adjudicate. Review H4: the seal trigger lives on
   * the `hash_submit` path, and adoption is the OTHER write to `leaf_log` — so the only way to
   * prove an inherited closing ceremony is acted on is to watch for the call.
   */
  const sealSubmissions: Array<{ leafCount: number }> = [];
  const { relay, node, stop } = await createRelayNode({
    directoryPubkey: dirPub,
    directoryPubkeys: [dirPub],
    store,
    ackSigningKeyProvider: relayIdKp,
    relayId: Buffer.from(await relayIdKp.getPublicKey()).toString("hex"),
    ...(opts?.withDirectory
      ? {
          directory: {
            processSeal: async (_sessionId: Uint8Array, sealData: { leaves: unknown[] }) => {
              sealSubmissions.push({ leafCount: sealData.leaves.length });
              return { ok: true as const };
            },
          },
        }
      : {}),
  });
  scope.addCleanup(async () => { await stop(); });

  const submitter = generateKeypair();
  const counterparty = generateKeypair();
  const priorRelay = generateKeypair();
  const priorRelayId = opts?.priorRelayId === null
    ? undefined
    : opts?.priorRelayId ?? Buffer.from(await priorRelay.getPublicKey()).toString("hex");

  const sessionId = new Uint8Array(randomBytes(16));
  const sessionTimestamp = Date.now();
  const subPub = await submitter.getPublicKey();
  const cpPub = await counterparty.getPublicKey();

  const recorded = relay.recordAssignment(await makeAssignment({
    sessionId, pubA: subPub, pubB: cpPub, dir: dirKp, sessionTimestamp, priorRelayId,
  }));

  const connect = async (kp: ReturnType<typeof generateKeypair>) => {
    const cn = await createNode({ keyProvider: kp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await cn.start();
    scope.addCleanup(async () => { await cn.stop(); });
    await cn.dial(node.listenAddresses()[0]!);
    const stream = await cn.newStream(node.getPeerId(), RELAY_PROTOCOL_ID);
    const reader = new StreamReader(stream);
    await performRelayAuth(reader, stream, kp, dirKp);
    return { stream, reader };
  };

  return {
    relay, store, sessionId, sessionTimestamp, submitter, counterparty, priorRelay, priorRelayId, sealSubmissions,
    subPub, cpPub, dirKp, recorded, connect,
    sessionKey: Buffer.from(sessionId).toString("hex"),
    validBatch: () => buildValidReplay({ sessionId, sessionTimestamp, submitter, counterparty, priorRelay, leafCount: LEAF_COUNT }),
    replay: async (
      conn: { stream: Stream; reader: StreamReader },
      body: Record<string, unknown>,
    ): Promise<Record<string, unknown>> => {
      sendFrame(conn.stream, CBOR.encode({ type: "session_replay", session_id: sessionId, ...body }) as Uint8Array);
      return conn.reader.readUntil("session_replay_result");
    },
  };
}

describe("031-RELAYREPLAY: a relay recognises a resume assignment", () => {
  let scope = createTestScope();
  beforeEach(() => { scope = createTestScope(); });
  afterEach(() => scope.run(async () => {}));

  it("marks the session a resume from the DIRECTORY-SIGNED prior_relay_id, and refuses submits until the history arrives", async () => {
    const h = await harness(scope);
    expect(h.recorded).toEqual({ ok: true });
    const state = h.store.getSession(h.sessionKey);
    expect(state?.prior_relay_id, "the prior relay is on session state BEFORE any frame arrives").toBe(h.priorRelayId);
    expect(state?.awaiting_replay).toBe(true);

    // A submit now would be chained to this relay's genesis root and numbered 1 — a validly signed
    // leaf in the wrong place, in a history nobody can reconcile afterwards.
    const conn = await h.connect(h.submitter);
    // A first message on this session, so both chain links are the session genesis
    // (`DOD-M15-SELFCHAIN-1` — a value, derived per session, never an absence).
    const genesis = computeGenesisPrevRoot(h.subPub, h.cpPub, h.sessionId, h.sessionTimestamp);
    const s1 = CBOR.encode([
      3, new Uint8Array(randomBytes(32)), h.subPub, h.sessionId, 0, Date.now(), genesis, genesis,
    ]) as Uint8Array;
    sendFrame(conn.stream, CBOR.encode({
      type: "hash_submit", session_id: h.sessionId, leaf_kind: 0x00,
      structure1_cbor: s1, sender_signature: await h.submitter.sign(s1),
    }) as Uint8Array);
    const err = await conn.reader.readUntil("hash_submit_error");
    expect(err["reason"]).toBe("session_awaiting_replay");
    expect(String(err["detail"]), "a refusal with no next step is where an agent stalls").toContain("session_replay");
  });

  it("an ORDINARY session is byte-identical to before this order — no prior_relay_id, no resume, and a submit is accepted", async () => {
    const h = await harness(scope, { priorRelayId: null });
    expect(h.recorded).toEqual({ ok: true });
    const state = h.store.getSession(h.sessionKey);
    expect(state?.prior_relay_id).toBeUndefined();
    expect(state?.awaiting_replay).toBeFalsy();

    // The name promised a submit and the body did not make one — review, test-teeth gap 2. A
    // passing test that implies proof it never gave is the same defect as a hollow assertion, one
    // level up, and this is the half that matters: a fresh session must still WORK.
    const conn = await h.connect(h.submitter);
    // A first message on this session, so both chain links are the session genesis
    // (`DOD-M15-SELFCHAIN-1` — a value, derived per session, never an absence).
    const genesis = computeGenesisPrevRoot(h.subPub, h.cpPub, h.sessionId, h.sessionTimestamp);
    const s1 = CBOR.encode([
      3, new Uint8Array(randomBytes(32)), h.subPub, h.sessionId, 0, Date.now(), genesis, genesis,
    ]) as Uint8Array;
    sendFrame(conn.stream, CBOR.encode({
      type: "hash_submit", session_id: h.sessionId, leaf_kind: 0x00,
      structure1_cbor: s1, sender_signature: await h.submitter.sign(s1),
    }) as Uint8Array);
    const ack = await conn.reader.readUntil("hash_submit_ack");
    expect(ack["sequence_number"], "a fresh session is unaffected by this order").toBe(1);
  });

  it("`prior_relay_id: \"\"` is a FRESH session, not a resume — the value every current directory actually sends", async () => {
    /**
     * ⚠️ THE MOST LIKELY PRODUCTION INPUT, AND IT WAS THE ONE CASE UNTESTED — review, test-teeth
     * gap 1. `017-TBS` made `""` the value every non-handover session carries, and unit 3's client
     * will forward it; the harness only ever exercised the field being absent.
     *
     * The whole clause-3 design rests on absent and `""` producing the SAME short TBS layout. A
     * `!== undefined` gate here — which is the correct gate on the CLIENT-facing assignment, and
     * therefore the one a reader is likely to copy — would append `""` to the signed bytes on this
     * side and refuse every ordinary session on the network. Nothing else in the suite would have
     * noticed.
     */
    const h = await harness(scope, { priorRelayId: null });
    const fresh = await makeAssignment({
      sessionId: new Uint8Array(randomBytes(16)),
      pubA: h.subPub, pubB: h.cpPub, dir: h.dirKp, sessionTimestamp: h.sessionTimestamp,
      priorRelayId: "",
    });
    expect(fresh.prior_relay_id, "the field IS present on the assignment, and empty").toBe("");
    expect(h.relay.recordAssignment(fresh), "and it verifies against the four-field TBS").toEqual({ ok: true });
    const state = h.store.getSession(Buffer.from(fresh.session_id).toString("hex"));
    expect(state?.awaiting_replay, "empty is not a resume").toBeFalsy();
  });

  it("a prior_relay_id that is not 64-hex is refused at RECORD time, not discovered at replay time", async () => {
    /**
     * Review H10. `reconstructCarriedSealLeaves` requires every receipt's relay id to be 64-hex AND
     * to equal this value, so a malformed prior id matches nothing that can ever be sent: every
     * replay refused, every submit refused, forever, with both reasons pointing at the batch. A
     * directory misconfiguration would read as a client that cannot assemble its own history.
     */
    const h = await harness(scope, { priorRelayId: null });
    const bad = await makeAssignment({
      sessionId: new Uint8Array(randomBytes(16)),
      pubA: h.subPub, pubB: h.cpPub, dir: h.dirKp, sessionTimestamp: h.sessionTimestamp,
      priorRelayId: "not-a-key",
    });
    expect(h.relay.recordAssignment(bad)).toEqual({ ok: false, reason: "prior_relay_id_malformed" });
    expect(h.store.getSession(Buffer.from(bad.session_id).toString("hex")), "and no session is left behind").toBeUndefined();
  });

  it("a CLIENT-SUPPLIED prior relay id is refused — a party cannot name the witness it will be judged against", async () => {
    /**
     * The attack, and it is the reason the field lives inside the signed TBS at all: name a relay
     * you control as your own predecessor, and every receipt in the batch you assemble verifies.
     *
     * Here the directory signed a FRESH assignment (four fields) and the frame claims a prior relay,
     * so the relay rebuilds five fields and the signature does not cover them.
     */
    const h = await harness(scope, { priorRelayId: null });
    const attackerRelay = Buffer.from(await generateKeypair().getPublicKey()).toString("hex");
    const fresh = await makeAssignment({
      sessionId: new Uint8Array(randomBytes(16)),
      pubA: h.subPub, pubB: h.cpPub, dir: h.dirKp, sessionTimestamp: h.sessionTimestamp,
    });
    const promoted = { ...fresh, prior_relay_id: attackerRelay };
    expect(h.relay.recordAssignment(promoted)).toEqual({ ok: false, reason: "directory_signature_invalid" });
  });

  it("STRIPPING the prior relay id from a genuine resume is refused too — the downgrade does not survive either", async () => {
    const h = await harness(scope, { priorRelayId: null });
    const priorId = Buffer.from(await generateKeypair().getPublicKey()).toString("hex");
    const resume = await makeAssignment({
      sessionId: new Uint8Array(randomBytes(16)),
      pubA: h.subPub, pubB: h.cpPub, dir: h.dirKp, sessionTimestamp: h.sessionTimestamp,
      priorRelayId: priorId,
    });
    const downgraded: SessionAssignment = { ...resume };
    delete downgraded.prior_relay_id;
    expect(h.relay.recordAssignment(downgraded)).toEqual({ ok: false, reason: "directory_signature_invalid" });
  });
});

describe("031-RELAYREPLAY: the relay adopts a chain it can prove", () => {
  let scope = createTestScope();
  beforeEach(() => { scope = createTestScope(); });
  afterEach(() => scope.run(async () => {}));

  it("a fully verified batch is adopted, and the frontier is the CHAIN's, not this relay's", async () => {
    const h = await harness(scope);
    const batch = await h.validBatch();
    const conn = await h.connect(h.submitter);

    /**
     * ⚠️ TRAP 1 / `DOD-M15-RELAYSEQ-UNSIGNED-1` — THE RECEIPTS WIN OVER THIS RELAY'S OWN NUMBERING.
     *
     * The relay-assigned `sequence_number` is authenticated by nothing, which is why that finding
     * was parked as "only reachable if a relay lies". Handover renumbers on the HAPPY PATH with
     * honest software, so it is reachable in ordinary operation and is resolved here.
     *
     * `seq_counter` is seeded to 99 — a number this relay's own bookkeeping believes and no
     * signature supports. After adoption the frontier must be 4, from the four receipt-pinned,
     * contiguous leaves. The exemplar is 99 rather than something near 4 so a passing assertion
     * cannot be an off-by-one that happens to land right.
     */
    const seeded = h.store.getSession(h.sessionKey)!;
    h.store.setSession(h.sessionKey, { ...seeded, seq_counter: 99 });

    const res = await h.replay(conn, {
      reported_root: batch.reported_root,
      leaves: batch.leaves,
      counterparty_tip: batch.counterparty_tip,
    });
    expect(res["ok"], `refused: ${String(res["reason"])}`).toBe(true);
    expect(res["adopted_leaf_count"]).toBe(LEAF_COUNT);

    const after = h.store.getSession(h.sessionKey)!;
    expect(after.seq_counter, "derived from the signed chain, NOT from the relay's own counter").toBe(LEAF_COUNT);
    expect(after.leaf_log.length).toBe(LEAF_COUNT);
    expect(after.awaiting_replay).toBe(false);
    // The adopted running root is the Structure 2 root over the inherited leaves — the value the
    // NEXT leaf will chain to. Computed independently in the fixture, not read back out of the relay.
    expect(Buffer.from(after.running_root).toString("hex"))
      .toBe(Buffer.from(structure2Root(batch.leaves, LEAF_COUNT)).toString("hex"));
  });

  it("the next leaf lands at N+1, so the inherited history is genuinely the frontier", async () => {
    const h = await harness(scope);
    const batch = await h.validBatch();
    const conn = await h.connect(h.submitter);
    const res = await h.replay(conn, {
      reported_root: batch.reported_root, leaves: batch.leaves, counterparty_tip: batch.counterparty_tip,
    });
    expect(res["ok"], `refused: ${String(res["reason"])}`).toBe(true);

    /**
     * The next leaf after an ADOPTED chain, so its links come from the inherited history rather than
     * from the genesis: the acknowledgement names the content at `LEAF_COUNT`, and the self link
     * names this sender's own last leaf in that chain. Getting either wrong is refused, which is
     * the point — the inherited history is genuinely the frontier.
     */
    const ownLast = batch.leaves.filter((l) => l.leaf_kind === 0x00
      && Buffer.from((CBOR.decode(l.structure2_cbor) as unknown[])[1] as Uint8Array).toString("hex")
         === Buffer.from(h.subPub).toString("hex")).at(-1)!;
    const s1 = CBOR.encode([
      3, new Uint8Array(randomBytes(32)), h.subPub, h.sessionId, LEAF_COUNT, Date.now(),
      contentHashOf(batch.leaves[LEAF_COUNT - 1]!), contentHashOf(ownLast),
    ]) as Uint8Array;
    sendFrame(conn.stream, CBOR.encode({
      type: "hash_submit", session_id: h.sessionId, leaf_kind: 0x00,
      structure1_cbor: s1, sender_signature: await h.submitter.sign(s1),
    }) as Uint8Array);
    const ack = await conn.reader.readUntil("hash_submit_ack");
    expect(ack["sequence_number"]).toBe(LEAF_COUNT + 1);
  });

  it("a SECOND batch is refused — this relay will not replace a history it already witnesses", async () => {
    const h = await harness(scope);
    const batch = await h.validBatch();
    const conn = await h.connect(h.submitter);
    expect((await h.replay(conn, {
      reported_root: batch.reported_root, leaves: batch.leaves, counterparty_tip: batch.counterparty_tip,
    }))["ok"]).toBe(true);
    const again = await h.replay(conn, {
      reported_root: batch.reported_root, leaves: batch.leaves, counterparty_tip: batch.counterparty_tip,
    });
    expect(again["ok"]).toBe(false);
    expect(again["reason"]).toBe("replay_already_adopted");
  });

  it("a batch offered for an ORDINARY session is refused — there is no prior witness to check it against", async () => {
    const h = await harness(scope, { priorRelayId: null });
    const batch = await h.validBatch();
    const conn = await h.connect(h.submitter);
    const res = await h.replay(conn, {
      reported_root: batch.reported_root, leaves: batch.leaves, counterparty_tip: batch.counterparty_tip,
    });
    expect(res["ok"]).toBe(false);
    expect(res["reason"]).toBe("session_not_a_resume");
  });
});

describe("031-RELAYREPLAY: four tampered batches, four different catchers", () => {
  let scope = createTestScope();
  beforeEach(() => { scope = createTestScope(); });
  afterEach(() => scope.run(async () => {}));

  it("TRUNCATED TAIL is caught by the TIP ATTESTATION — contiguity cannot see it, which is why the attestation is not redundant", async () => {
    const h = await harness(scope);
    const batch = await h.validBatch();
    const conn = await h.connect(h.submitter);

    // Drop the counterparty's last leaf. What remains is sequences 1..3 — perfectly contiguous,
    // every receipt valid, every signature valid, and a root that matches what is reported. The
    // ONLY thing wrong with it is that it is not the whole conversation.
    const cut = batch.leaves.slice(0, LEAF_COUNT - 1);
    const res = await h.replay(conn, {
      reported_root: contentRoot(cut, cut.length),
      leaves: cut,
      counterparty_tip: batch.counterparty_tip, // still attests to 4
    });
    expect(res["ok"]).toBe(false);
    expect(res["reason"], "the counterparty attested to 4 leaves and only 3 were supplied").toBe("replay_tip_unsupplied");
  });

  it("REORDERED leaves are caught by the PRIOR RELAY'S ACK RECEIPTS — Structure 1 carries no sequence, so nothing else can", async () => {
    const h = await harness(scope);
    const batch = await h.validBatch();
    const conn = await h.connect(h.submitter);

    /**
     * Swap the submitter's two positions (1 and 3) and re-stamp them so the array still reads
     * 1,2,3,4. Every sender signature still verifies — Structure 1 does not commit to a sequence,
     * so a party can renumber its own history freely. The receipts are what cannot be renumbered:
     * each was signed over `(content_hash, ORIGINAL seq, timestamp)`.
     */
    const swapped = [...batch.leaves];
    swapped[0] = restampSequence(batch.leaves[2]!, 1);
    swapped[2] = restampSequence(batch.leaves[0]!, 3);
    const res = await h.replay(conn, {
      reported_root: contentRoot(swapped, swapped.length),
      leaves: swapped,
      counterparty_tip: await signTip(h.counterparty, h.cpPub, h.sessionId, LEAF_COUNT, contentRoot(swapped, swapped.length)),
    });
    expect(res["ok"]).toBe(false);
    expect(res["reason"], "the receipt binds content_hash to a position, and the position moved").toBe("unilateral_receipt_invalid");
  });

  it("a FORGED leaf is caught by the SENDER'S OWN SIGNATURE — the counterparty's leaves carry no receipt and need none", async () => {
    const h = await harness(scope);
    const batch = await h.validBatch();
    const conn = await h.connect(h.submitter);

    /**
     * ⚠️ THE LAST LEAF, AND THE POSITION IS THE WHOLE TEST. This forged the leaf at index 1 first,
     * and the mutation loop caught it: with the sender-signature check DELETED the test still
     * passed. Forging a signature rewrites that leaf's `structure2_cbor`, which changes the
     * Structure 2 root, which breaks the NEXT leaf's `prev_root` — and that failure returns the
     * same `unilateral_root_unverifiable` string. So the assertion was green either way, and the
     * clause it claimed to cover could be removed with nothing going red.
     *
     * The last leaf has no successor whose `prev_root` depends on it, so the sender's own signature
     * is the only thing left that can refuse it. Index 3 is the counterparty's, whose leaves carry
     * no relay receipt by design — pinned by signature and contiguity alone, which is exactly the
     * property under test. `sender_pubkey` still names them, so provenance passes too.
     *
     * ⚠️ AND THE REASON IS NOW SPECIFIC, WHICH IS THE REAL FIX — review H6. Position made this test
     * unambiguous; splitting the five-into-one label is what makes it correct. `tsc` and the
     * assertion below now disagree with the neighbouring clauses by NAME, so adding a leaf to the
     * fixture can no longer make it quietly pass for someone else's reason.
     */
    const forged = [...batch.leaves];
    forged[LEAF_COUNT - 1] = await forgeSenderSignature(batch.leaves[LEAF_COUNT - 1]!, generateKeypair());
    const res = await h.replay(conn, {
      reported_root: batch.reported_root, // content hashes are untouched, so the root still matches
      leaves: forged,
      counterparty_tip: batch.counterparty_tip,
    });
    expect(res["ok"]).toBe(false);
    expect(res["reason"], "the clause that fired, by name — not the five-into-one label it used to share").toBe("seal_chain_sender_signature_invalid");
    expect(String(res["guidance"]), "and the guidance sends them out of band, not back to their own arithmetic").toContain("confirm out of band");
  });

  it("an INTERNAL GAP is caught by CONTIGUITY — a leaf removed from the middle leaves sequences that are not 1..N", async () => {
    const h = await harness(scope);
    const batch = await h.validBatch();
    const conn = await h.connect(h.submitter);

    // Remove leaf 2, keeping the rest with their original sequence numbers: 1, 3, 4.
    const gapped = [batch.leaves[0]!, batch.leaves[2]!, batch.leaves[3]!];
    const res = await h.replay(conn, {
      reported_root: contentRoot(gapped, gapped.length),
      leaves: gapped,
      counterparty_tip: await signTip(h.counterparty, h.cpPub, h.sessionId, gapped.length, contentRoot(gapped, gapped.length)),
    });
    expect(res["ok"]).toBe(false);
    expect(res["reason"]).toBe("unilateral_chain_noncontiguous");
  });

  it("a receipt from a DIFFERENT relay is refused — the batch does not get to name its own auditor", async () => {
    const h = await harness(scope);
    const rogue = generateKeypair();
    // A complete, internally consistent conversation witnessed by a relay the DIRECTORY never named.
    const batch = await buildValidReplay({
      sessionId: h.sessionId, sessionTimestamp: h.sessionTimestamp,
      submitter: h.submitter, counterparty: h.counterparty, priorRelay: rogue, leafCount: LEAF_COUNT,
    });
    const conn = await h.connect(h.submitter);
    const res = await h.replay(conn, {
      reported_root: batch.reported_root, leaves: batch.leaves, counterparty_tip: batch.counterparty_tip,
    });
    expect(res["ok"]).toBe(false);
    expect(res["reason"]).toBe("unilateral_receipt_wrong_relay");
  });
});

describe("031-RELAYREPLAY: the tip attestation is required, and absence takes the same path as wrong", () => {
  let scope = createTestScope();
  beforeEach(() => { scope = createTestScope(); });
  afterEach(() => scope.run(async () => {}));

  it("NO tip attestation is REFUSED BY NAME — not deferred, not warned, not accepted", async () => {
    /**
     * ⚠️ NOTHING SENDS ONE YET, AND THIS STILL REFUSES. That is the discipline `020-ACKHASH`
     * shipped: the reader lands before the writer, and a MISSING proof takes the same path as a
     * wrong one. An "accept it, the attestation is optional for now" branch would be a third
     * instance of `DOD-M15-AUTHORSHIP-ABSENT-1`, one layer down.
     */
    const h = await harness(scope);
    const batch = await h.validBatch();
    const conn = await h.connect(h.submitter);
    const res = await h.replay(conn, { reported_root: batch.reported_root, leaves: batch.leaves });
    expect(res["ok"]).toBe(false);
    expect(res["reason"]).toBe("replay_tip_attestation_absent");
    expect(String(res["guidance"]), "a refusal without a next step is where an agent stalls").toContain("tip attestation");
    expect(h.store.getSession(h.sessionKey)!.leaf_log.length, "nothing was adopted").toBe(0);
  });

  it("a tip signed by the WRONG PARTY is refused — the submitter cannot attest to its own counterparty's tail", async () => {
    const h = await harness(scope);
    const batch = await h.validBatch();
    const conn = await h.connect(h.submitter);
    const res = await h.replay(conn, {
      reported_root: batch.reported_root,
      leaves: batch.leaves,
      counterparty_tip: await signTip(h.submitter, h.subPub, h.sessionId, LEAF_COUNT, batch.reported_root),
    });
    expect(res["ok"]).toBe(false);
    expect(res["reason"]).toBe("replay_tip_attestation_wrong_party");
  });

  it("a tip attesting to ZERO leaves is refused — an attestation that covers nothing is a hole in the shape of a proof", async () => {
    const h = await harness(scope);
    const batch = await h.validBatch();
    const conn = await h.connect(h.submitter);
    const res = await h.replay(conn, {
      reported_root: batch.reported_root,
      leaves: batch.leaves,
      counterparty_tip: await signTip(h.counterparty, h.cpPub, h.sessionId, 0, batch.reported_root),
    });
    expect(res["ok"]).toBe(false);
    expect(res["reason"]).toBe("replay_tip_attestation_malformed");
  });

  it("a tip whose SIGNATURE does not verify is refused, and takes the same path as an absent one", async () => {
    const h = await harness(scope);
    const batch = await h.validBatch();
    const conn = await h.connect(h.submitter);
    const tampered = { ...batch.counterparty_tip, signature: new Uint8Array(64) };
    const res = await h.replay(conn, {
      reported_root: batch.reported_root, leaves: batch.leaves, counterparty_tip: tampered,
    });
    expect(res["ok"]).toBe(false);
    expect(res["reason"]).toBe("replay_tip_attestation_invalid");
  });

  it("D4b — a batch that EXTENDS the attested tip is adopted at the LONGER length, never truncated to the shorter", async () => {
    /**
     * The counterparty attests through leaf 3; the submitter supplies 4. Those are the in-flight
     * messages — already signed, and the shorter side cannot refuse a validly signed leaf without
     * lying. Truncating to 3 (D4c) is rejected not primarily as an attack but because those
     * messages EXIST in both operators' transcripts: cutting the witness record means the receipt
     * permanently covers less than was said.
     */
    const h = await harness(scope);
    const batch = await h.validBatch();
    const conn = await h.connect(h.submitter);
    const res = await h.replay(conn, {
      reported_root: batch.reported_root,
      leaves: batch.leaves,
      counterparty_tip: await signTip(h.counterparty, h.cpPub, h.sessionId, 3, contentRoot(batch.leaves, 3)),
    });
    expect(res["ok"], `refused: ${String(res["reason"])}`).toBe(true);
    expect(res["adopted_leaf_count"], "adopted at 4, not cut back to the attested 3").toBe(LEAF_COUNT);
    expect(h.store.getSession(h.sessionKey)!.leaf_log.length).toBe(LEAF_COUNT);
  });

  it("D5 — a tip whose root disagrees at a position BOTH sides hold marks the session DIVERGED and unsealable", async () => {
    const h = await harness(scope);
    const batch = await h.validBatch();
    const conn = await h.connect(h.submitter);
    const res = await h.replay(conn, {
      reported_root: batch.reported_root,
      leaves: batch.leaves,
      // Correctly signed, covering the same three leaves — and naming a different root for them.
      counterparty_tip: await signTip(h.counterparty, h.cpPub, h.sessionId, 3, new Uint8Array(32).fill(0xab)),
    });
    expect(res["ok"]).toBe(false);
    expect(res["reason"]).toBe("replay_chain_diverged");

    const after = h.store.getSession(h.sessionKey)!;
    expect(after.status).toBe("diverged");
    expect(after.leaf_log.length, "a partially-verifying chain is a REFUSED chain, never a truncated one").toBe(0);

    // The party who did not submit is told by a witness whose copy did not pass through the
    // submitter's hands — the whole argument for a relay-side alert.
    const held = h.store.drainWitnessAlerts(Buffer.from(h.cpPub).toString("hex"));
    expect(held.length).toBe(1);
    expect(held[0]!.reason).toBe("replay_chain_diverged");

    // And the session is terminal: a later submit is refused by its own name, not as "sealing".
    // A first message on this session, so both chain links are the session genesis
    // (`DOD-M15-SELFCHAIN-1` — a value, derived per session, never an absence).
    const genesis = computeGenesisPrevRoot(h.subPub, h.cpPub, h.sessionId, h.sessionTimestamp);
    const s1 = CBOR.encode([
      3, new Uint8Array(randomBytes(32)), h.subPub, h.sessionId, 0, Date.now(), genesis, genesis,
    ]) as Uint8Array;
    sendFrame(conn.stream, CBOR.encode({
      type: "hash_submit", session_id: h.sessionId, leaf_kind: 0x00,
      structure1_cbor: s1, sender_signature: await h.submitter.sign(s1),
    }) as Uint8Array);
    const err = await conn.reader.readUntil("hash_submit_error");
    expect(err["reason"]).toBe("session_diverged");
  });
});

describe("031-RELAYREPLAY: a participant cannot manufacture a divergence against the other", () => {
  let scope = createTestScope();
  beforeEach(() => { scope = createTestScope(); });
  afterEach(() => scope.run(async () => {}));

  it("swapping the counterparty's two consecutive messages is caught by their OWN SIGNED CLOCK, not read as a divergence", async () => {
    /**
     * ⚠️ REVIEW H1 — THE DENIAL OF SERVICE, AND WHY IT WAS INVISIBLE.
     *
     * A counterparty leaf's position is asserted only by the UNSIGNED Structure 2. Contiguity fixes
     * the set of positions but not who sits where; the causal check `last_seen_seq > effectiveSeen`
     * is an UPPER BOUND, and for two ADJACENT leaves from one sender `effectiveSeen` is identical at
     * both — so it is satisfied either way round. Their leaves carry no relay receipt by design.
     * Every check above the tip attestation therefore passed on a swapped pair.
     *
     * What that bought: B sends two messages in a row (routine). The relay dies. A gets the resume
     * assignment, swaps B's two messages, replays. The chain verifies — and B's honest tip
     * attestation now disagrees, so the relay reads a DIVERGENCE and marks B's conversation
     * permanently unsealable. A fabricated contradiction, one frame, against a party who did
     * nothing, and B cannot repair it because a non-active session refuses their own replay.
     *
     * The sender's `timestamp` is inside their signed bytes — anchored to something the assembler
     * does not control — so a swap makes one sender's own clock run backwards. Per sender only:
     * two parties' clocks are unrelated and comparing them would refuse honest conversations.
     *
     * ⚠️ THE BATCH IS RE-CHAINED, and leaving that out is how this test first measured the wrong
     * guard. A naive swap breaks `prev_root` and is refused as `seal_chain_prev_root_break`, which
     * READS like the chain catching the reorder. It is not: `prev_root` lives in Structure 2, which
     * the submitter assembles in full, so a real attacker recomputes it and the break never happens.
     */
    const h = await harness(scope);
    const batch = await buildValidReplay({
      sessionId: h.sessionId, sessionTimestamp: h.sessionTimestamp,
      submitter: h.submitter, counterparty: h.counterparty, priorRelay: h.priorRelay,
      leafCount: LEAF_COUNT, counterpartyRunAt: 2,   // leaves 2 and 3 are both the counterparty's
    });
    const swapped = swapAdjacent(batch.leaves, 1, batch.genesis);
    const conn = await h.connect(h.submitter);
    const res = await h.replay(conn, {
      reported_root: contentRoot(swapped, swapped.length),
      leaves: swapped,
      counterparty_tip: batch.counterparty_tip,
    });

    expect(res["ok"]).toBe(false);
    expect(res["reason"], "caught as a reordering, NOT as a disagreement between the two parties")
      .toBe("seal_chain_sender_clock_reversed");

    // The whole point: the victim's conversation is untouched and still sealable.
    const after = h.store.getSession(h.sessionKey)!;
    expect(after.status, "a batch one party controls must not be able to end the other's conversation").toBe("active");
    expect(after.awaiting_replay, "and an honest replay is still possible").toBe(true);
    expect(h.store.drainWitnessAlerts(Buffer.from(h.cpPub).toString("hex")).length, "no accusation was made").toBe(0);
  });

  it("a run of two consecutive same-sender leaves is otherwise ORDINARY and verifies", async () => {
    // The control for the test above: the shape itself is legitimate and must still be adopted.
    // Without this, the guard could refuse every same-sender run and the test above would not care.
    const h = await harness(scope);
    const batch = await buildValidReplay({
      sessionId: h.sessionId, sessionTimestamp: h.sessionTimestamp,
      submitter: h.submitter, counterparty: h.counterparty, priorRelay: h.priorRelay,
      leafCount: LEAF_COUNT, counterpartyRunAt: 2,
    });
    const conn = await h.connect(h.submitter);
    const res = await h.replay(conn, {
      reported_root: batch.reported_root, leaves: batch.leaves, counterparty_tip: batch.counterparty_tip,
    });
    expect(res["ok"], `refused: ${String(res["reason"])}`).toBe(true);
    expect(res["adopted_leaf_count"]).toBe(LEAF_COUNT);
  });
});

describe("031-RELAYREPLAY: every refusal reaches the submitter, including the ones before the handler", () => {
  let scope = createTestScope();
  beforeEach(() => { scope = createTestScope(); });
  afterEach(() => scope.run(async () => {}));

  it("a MALFORMED batch gets a typed answer, not silence — review H8", async () => {
    /**
     * Silence here is not merely unhelpful. The shipping client races its answer against a
     * ten-second timeout and then RESETS THE STREAM, which every conversation that agent holds on
     * this relay shares — so one undecodable frame stalls a send for ten seconds, drops every other
     * session, and prints a transport word for a policy decision taken on a different machine.
     * That analysis is already written above the `hash_submit` branch; the replay frame was landing
     * in exactly the silence it describes.
     */
    const h = await harness(scope);
    const conn = await h.connect(h.submitter);
    sendFrame(conn.stream, CBOR.encode({
      type: "session_replay",
      session_id: h.sessionId,
      reported_root: new Uint8Array(7),   // not 32 — fails the strict decode
      leaves: [],
    }) as Uint8Array);
    const res = await conn.reader.readUntil("session_replay_result");
    expect(res["ok"]).toBe(false);
    expect(res["reason"]).toBe("replay_malformed");
    expect(String(res["guidance"])).toContain("reported_root");
  });

  it("a batch carrying leaf CONTENT is refused by its own name — the one thing INV-3 exists to prevent", async () => {
    const h = await harness(scope);
    const batch = await h.validBatch();
    const conn = await h.connect(h.submitter);
    const withContent = batch.leaves.map((l, i) => (i === 0 ? { ...l, content_bytes: new Uint8Array([1, 2, 3]) } : l));
    sendFrame(conn.stream, CBOR.encode({
      type: "session_replay",
      session_id: h.sessionId,
      reported_root: batch.reported_root,
      leaves: withContent,
      counterparty_tip: batch.counterparty_tip,
    }) as Uint8Array);
    const res = await conn.reader.readUntil("session_replay_result");
    expect(res["ok"]).toBe(false);
    expect(res["reason"], "named, so an operator learns WHY rather than that something was wrong").toBe("replay_content_not_permitted");
    expect(h.store.getSession(h.sessionKey)!.leaf_log.length).toBe(0);
  });

  it("a tip attestation that was SENT but is misshapen is refused as MALFORMED, never as absent — review H7", async () => {
    /**
     * The operator sent one. Telling them it is missing sends them to ask their counterparty for a
     * fresh attestation when the fault is in their own encoder — the wrong person, the wrong
     * machine, and the wrong subsystem.
     */
    const h = await harness(scope);
    const batch = await h.validBatch();
    const conn = await h.connect(h.submitter);
    const res = await h.replay(conn, {
      reported_root: batch.reported_root,
      leaves: batch.leaves,
      counterparty_tip: { ...batch.counterparty_tip, root: new Uint8Array(31) },  // one byte short
    });
    expect(res["ok"]).toBe(false);
    expect(res["reason"]).toBe("replay_tip_attestation_malformed");
  });
});

describe("031-RELAYREPLAY: an inherited session is not an empty one", () => {
  let scope = createTestScope();
  beforeEach(() => { scope = createTestScope(); });
  afterEach(() => scope.run(async () => {}));

  it("the seal path refuses a resume whose history never arrived, instead of reporting a conversation with no messages — review H9", async () => {
    /**
     * `awaiting_replay` sessions are `active`, so `submitForSeal` returned a chain of ZERO leaves
     * and a root over nothing — as if the two agents had never said anything. Downstream refuses
     * the empty array, so no false receipt was reachable; what the operator got was "your leaf
     * array is malformed" when the truth is that this relay was never given the conversation.
     */
    const h = await harness(scope);
    expect(h.relay.submitForSeal(h.sessionId)).toEqual({ ok: false, reason: "session_awaiting_replay" });
    expect(h.relay.getSealLeaves(h.sessionId)).toEqual({ ok: false, reason: "session_awaiting_replay" });
  });

  it("a DIVERGED session is named as such by the seal path too, not reported as merely not active", async () => {
    const h = await harness(scope);
    const batch = await h.validBatch();
    const conn = await h.connect(h.submitter);
    await h.replay(conn, {
      reported_root: batch.reported_root,
      leaves: batch.leaves,
      counterparty_tip: await signTip(h.counterparty, h.cpPub, h.sessionId, 3, new Uint8Array(32).fill(0xab)),
    });
    expect(h.store.getSession(h.sessionKey)!.status).toBe("diverged");
    expect(h.relay.submitForSeal(h.sessionId)).toEqual({ ok: false, reason: "session_diverged" });
    expect(h.relay.getSealLeaves(h.sessionId)).toEqual({ ok: false, reason: "session_diverged" });
  });
});

describe("031-RELAYREPLAY: an inherited conversation that was already closed still gets its receipt", () => {
  let scope = createTestScope();
  beforeEach(() => { scope = createTestScope(); });
  afterEach(() => scope.run(async () => {}));

  it("adopting a chain that already contains BOTH closing leaves adjudicates the seal — review H4", async () => {
    /**
     * ⚠️ THE SYMPTOM THIS WHOLE DoD LINE EXISTS TO REMOVE, ARRIVING THROUGH THE NEW PATH.
     *
     * The bilateral seal is triggered by two ctrl leaves from distinct senders, and that trigger
     * lived on the `hash_submit` path alone. Adoption is the OTHER write to `leaf_log`.
     *
     * So: both agents close. Both SEAL leaves reach the old relay. The old relay dies before
     * submitting the seal. One party replays here — and the new relay adopted a chain containing a
     * complete closing ceremony, left the session `active`, and never adjudicated it. The
     * conversation is over, the receipt never arrives, and nothing anywhere is waiting on anything.
     */
    const h = await harness(scope, { withDirectory: true });
    const batch = await buildValidReplay({
      sessionId: h.sessionId, sessionTimestamp: h.sessionTimestamp,
      submitter: h.submitter, counterparty: h.counterparty, priorRelay: h.priorRelay,
      leafCount: LEAF_COUNT, closeBothAtEnd: true,
    });
    const conn = await h.connect(h.submitter);
    const res = await h.replay(conn, {
      reported_root: batch.reported_root, leaves: batch.leaves, counterparty_tip: batch.counterparty_tip,
    });
    expect(res["ok"], `refused: ${String(res["reason"])}`).toBe(true);
    expect(res["adopted_leaf_count"]).toBe(LEAF_COUNT + 2);

    // Name the artifact, not its shadow: the directory was ASKED to notarize, with the whole chain.
    expect(h.sealSubmissions.length, "the closing ceremony was adjudicated, not stranded").toBe(1);
    expect(h.sealSubmissions[0]!.leafCount).toBe(LEAF_COUNT + 2);
    // The directory said yes, so `confirmSeal` released the session — the strongest available
    // statement that the ceremony finished rather than merely started. (Asserting `"sealing"` here
    // was wrong about the code, not about the fix: that status is the in-flight state, and this
    // seal is not in flight, it is done.)
    expect(h.store.getSession(h.sessionKey), "a confirmed seal destroys the relay's session state").toBeUndefined();
  });

  it("an ordinary mid-conversation handover does NOT trigger a seal — the trigger is the ceremony, not the adoption", async () => {
    // The control. Without it the fix could call processSeal on every adoption and the test above
    // would be just as green.
    const h = await harness(scope, { withDirectory: true });
    const batch = await h.validBatch();
    const conn = await h.connect(h.submitter);
    expect((await h.replay(conn, {
      reported_root: batch.reported_root, leaves: batch.leaves, counterparty_tip: batch.counterparty_tip,
    }))["ok"]).toBe(true);
    expect(h.sealSubmissions.length, "no closing leaves in this chain, so nothing to adjudicate").toBe(0);
    expect(h.store.getSession(h.sessionKey)!.status).toBe("active");
  });
});

describe("031-RELAYREPLAY: only a participant may replay", () => {
  let scope = createTestScope();
  beforeEach(() => { scope = createTestScope(); });
  afterEach(() => scope.run(async () => {}));

  it("a stranger holding a valid batch is refused — the roster comes from the directory, never the frame", async () => {
    const h = await harness(scope);
    const batch = await h.validBatch();
    const stranger = generateKeypair();
    const conn = await h.connect(stranger);
    const res = await h.replay(conn, {
      reported_root: batch.reported_root, leaves: batch.leaves, counterparty_tip: batch.counterparty_tip,
    });
    expect(res["ok"]).toBe(false);
    expect(res["reason"]).toBe("not_a_participant");
    expect(h.store.getSession(h.sessionKey)!.leaf_log.length).toBe(0);
  });
});
