/**
 * DOD-M15-TRANSPORT-TERMINAL-1 — a transport blip does not kill a healthy conversation.
 *
 * ─── The defect, from the operator's chair ─────────────────────────────────────────────────────
 *
 * Two agents finish a conversation and close it. The relay asks a directory to adjudicate the seal.
 * The directory is momentarily unreachable — a restart, a dropped circuit, a NAT rebind, a deploy.
 *
 * The relay marks the session **`seal_rejected`**, which is PERMANENT. Both agents are then told
 * `session_sealed` on anything they try next, so each believes the conversation ended in a
 * notarized receipt. Neither holds one. Nothing anywhere says otherwise, and nothing retries.
 *
 * A conversation that was healthy in every respect is destroyed by a network hiccup, and the
 * destruction is reported as success.
 *
 * ─── Why it happened, and it is a familiar shape ───────────────────────────────────────────────
 *
 * `NetworkDirectoryAdapter.processSeal` returns `{ ok: false, reason }` for two DIFFERENT kinds of
 * thing, and the reason is a free-form string that does not say which:
 *
 *   MERITS      the directory read the seal and refused it — `merkle_root_mismatch`,
 *               `leaf_count_mismatch`. A verdict. Retrying cannot change it.
 *   TRANSPORT   `directory_unavailable` (the relay has no libp2p node), `no_response` (the stream
 *               closed with nothing on it), or anything thrown while dialing — `connection_lost`,
 *               a timeout, a refused dial. **No directory formed an opinion at all.**
 *
 * `relay-node.ts` called `rejectSeal` for both. This is the same defect class as
 * `DOD-M15-GUARD-HEARD-1`'s H3, seen from the other side: a distinction that mattered was carried
 * in a string nobody was obliged to classify. The fix is the same — put it in the type, so the
 * caller cannot fail to branch on it.
 *
 * ─── What these tests assert, and why behaviourally ────────────────────────────────────────────
 *
 * Not the session's stored status — a client cannot see that, and the property is about what the
 * client EXPERIENCES. So they probe the way the existing AC-005 test does: submit another leaf and
 * see whether the relay says the session is over. After a merits refusal it must; after a transport
 * failure it must not, because the conversation is still alive and the seal is still retryable.
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
import { seedChain, chainLinks, chainAdvance } from "./helpers/relay-submit-harness.js";
import type { DirectoryAdapter } from "../relay-node.js";
import type { SessionAssignment } from "../relay-types.js";
import { testOnlineToken } from "./helpers/online-token.js";

setupV3Tests();

const CBOR_ENC = new Encoder({ tagUint8Array: false });
const CTRL_LEAF = 0x02;
/**
 * The probe leaf uses the CTRL domain. 0x01 is deliberately NOT an accepted kind — it is the
 * RFC 6962 internal-node prefix, so a leaf hashed under it aliases an internal node and forges tree
 * shape. Using it here made the probe fail with `leaf_kind_invalid`, which reads like a live
 * session but proves nothing about the property under test.
 */

// ─── wire helpers (local, matching the other relay protocol tests) ──────────────────────────────

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
}

/** Byte-identical to the other relay protocol tests — the auth message is a DOMAIN-SEPARATED hash. */
// DOD-M15-RELAYSLOTS-1: the relay refuses an auth carrying no directory-issued online token.
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
  sendFrame(stream, CBOR_ENC.encode({
    type: "relay_auth_response",
    pubkey,
    signature,
    online_token: await testOnlineToken(dirKp, kp),
  }) as Uint8Array);
  const ack = await reader.readDecoded();
  if (ack["type"] === "relay_auth_failed") throw new Error(`relay_auth_failed: ${String(ack["reason"])}`);
  expect(ack["type"]).toBe("relay_auth_ok");
}

async function makeStructure1(
  sessionId: Uint8Array,
  kp: ReturnType<typeof generateKeypair>,
  seq: number,
): Promise<{ structure1_cbor: Uint8Array; sender_signature: Uint8Array }> {
  const pubkey = await kp.getPublicKey();
  const contentHash = new Uint8Array(randomBytes(32));
  const { lastSeenHash, prevOwnHash } = chainLinks(sessionId, pubkey, seq);
  const tbs = CBOR_ENC.encode([
    3, contentHash, pubkey, sessionId, seq, Date.now(), lastSeenHash, prevOwnHash,
  ]) as Uint8Array;
  chainAdvance(sessionId, pubkey, contentHash);
  return { structure1_cbor: tbs, sender_signature: await kp.sign(tbs) };
}

async function makeAssignment(
  sessionId: Uint8Array,
  pubA: Uint8Array,
  pubB: Uint8Array,
  signingDir: ReturnType<typeof generateKeypair>,
): Promise<SessionAssignment> {
  const session_timestamp = Date.now();
  const tbs = CBOR_ENC.encode([
    sessionId, pubA, pubB,
    session_timestamp > 0xffffffff ? BigInt(session_timestamp) : session_timestamp,
  ]) as Uint8Array;
  seedChain(sessionId, pubA, pubB, session_timestamp);
  return {
    session_id: sessionId,
    participant_a: pubA,
    participant_b: pubB,
    session_timestamp,
    directory_signature: await signingDir.sign(tbs),
  };
}

/**
 * Drive a session to adjudication with a directory that answers however the test says, then report
 * what a participant experiences on their NEXT submission.
 *
 * `stillAcceptsLeaves` is the whole assertion surface: it is what a client can actually observe.
 */
async function sealThen(opts: {
  scope: ReturnType<typeof createTestScope>;
  /** What the directory adapter does when asked to adjudicate. */
  answer: () => Promise<{ ok: true } | { ok: false; kind?: "refused" | "unreachable" | "unknown"; reason: string }>;
}): Promise<{ stillAcceptsLeaves: boolean; nextReason: string | undefined; asked: number }> {
  const dirKp = generateKeypair();
  const dirPub = await dirKp.getPublicKey();

  let asked = 0;
  const adapter = {
    async processSeal() {
      asked++;
      return opts.answer();
    },
    async getRelayPublicKey() { return { ok: false as const, reason: "not_registered" as const }; },
  } as unknown as DirectoryAdapter;

  const { relay, node, stop } = await createRelayNode({
    directoryPubkey: dirPub,
    directoryPubkeys: [dirPub],
    directory: adapter,
  });
  opts.scope.addCleanup(async () => { await stop(); });

  const clientA = generateKeypair();
  const clientB = generateKeypair();
  const pubA = await clientA.getPublicKey();
  const pubB = await clientB.getPublicKey();
  const sessionId = new Uint8Array(randomBytes(16));

  expect(relay.recordAssignment(await makeAssignment(sessionId, pubA, pubB, dirKp))).toEqual({ ok: true });

  const relayAddr = node.listenAddresses()[0]!;
  const relayPeerId = node.getPeerId();

  // Two ctrl leaves from DISTINCT senders is what triggers adjudication.
  for (const [kp, seq] of [[clientA, 0], [clientB, 1]] as const) {
    const cn = await createNode({ keyProvider: kp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await cn.start();
    opts.scope.addCleanup(async () => { await cn.stop(); });
    await cn.dial(relayAddr);
    const stream = await cn.newStream(relayPeerId, RELAY_PROTOCOL_ID);
    const reader = new StreamReader(stream);
    await performRelayAuth(reader, stream, kp, dirKp);
    const { structure1_cbor, sender_signature } = await makeStructure1(sessionId, kp, seq);
    sendFrame(stream, CBOR_ENC.encode({
      type: "hash_submit", session_id: sessionId, leaf_kind: CTRL_LEAF, structure1_cbor, sender_signature,
    }) as Uint8Array);
    let ack = await reader.readDecoded();
    for (let i = 0; i < 5 && ack["type"] !== "hash_submit_ack"; i++) ack = await reader.readDecoded();
    expect(ack["type"], `hash_submit rejected: ${String(ack["reason"])}`).toBe("hash_submit_ack");
  }

  // Adjudication is awaited after the second ack is written, so give the async path a turn.
  for (let i = 0; i < 40 && asked === 0; i++) await new Promise((r) => setTimeout(r, 25));
  await new Promise((r) => setTimeout(r, 100));

  // THE PROBE: can a participant still use this session?
  const probeNode = await createNode({ keyProvider: clientA, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
  await probeNode.start();
  opts.scope.addCleanup(async () => { await probeNode.stop(); });
  await probeNode.dial(relayAddr);
  const probeStream = await probeNode.newStream(relayPeerId, RELAY_PROTOCOL_ID);
  const probeReader = new StreamReader(probeStream);
  await performRelayAuth(probeReader, probeStream, clientA, dirKp);
  const { structure1_cbor, sender_signature } = await makeStructure1(sessionId, clientA, 2);
  sendFrame(probeStream, CBOR_ENC.encode({
    type: "hash_submit", session_id: sessionId, leaf_kind: CTRL_LEAF, structure1_cbor, sender_signature,
  }) as Uint8Array);
  let resp = await probeReader.readDecoded();
  for (let i = 0; i < 5 && resp["type"] !== "hash_submit_ack" && resp["type"] !== "hash_submit_error"; i++) {
    resp = await probeReader.readDecoded();
  }

  return {
    stillAcceptsLeaves: resp["type"] === "hash_submit_ack",
    nextReason: typeof resp["reason"] === "string" ? resp["reason"] : undefined,
    asked,
  };
}

describe("DOD-M15-TRANSPORT-TERMINAL-1: only a verdict is terminal", () => {
  let scope = createTestScope();
  beforeEach(() => { scope = createTestScope(); });
  afterEach(() => scope.run(async () => {}));

  it("a MERITS refusal terminalises the session — a verdict is final", async () => {
    /**
     * The control, and it must stay green: this is the behaviour that is CORRECT today. Without it,
     * the fix below could be "never terminalise", which would leave a refused seal retrying forever
     * and is a worse defect than the one being fixed.
     */
    const out = await sealThen({
      scope,
      answer: async () => ({ ok: false as const, kind: "refused" as const, reason: "merkle_root_mismatch" }),
    });
    expect(out.asked, "the directory must actually have been asked").toBeGreaterThan(0);
    expect(
      out.stillAcceptsLeaves,
      "a directory that READ the seal and refused it has ruled; retrying cannot change the answer",
    ).toBe(false);
  }, 30_000);

  it("a TRANSPORT failure leaves the session alive — nobody adjudicated anything", async () => {
    /**
     * ★ THE DEFECT. `connection_lost` means the relay could not reach a directory: no directory
     * formed an opinion, so there is no verdict to be final about.
     *
     * Before the fix this marked the session `seal_rejected` — permanent — and both agents were
     * then answered `session_sealed`, so each believed they held a notarized receipt of a
     * conversation that was never notarized. A restart or a dropped circuit was enough.
     */
    const out = await sealThen({
      scope,
      answer: async () => ({ ok: false as const, kind: "unreachable" as const, reason: "dial_failed: could not open a stream" }),
    });
    expect(out.asked).toBeGreaterThan(0);
    expect(
      out.stillAcceptsLeaves,
      `A transport failure killed the session. Nobody adjudicated anything — the relay simply could ` +
        `not reach a directory — so there is no verdict to be final about. The participants are now ` +
        `told the session is over and each believes they hold a receipt that does not exist. ` +
        `Refused: ${String(out.nextReason)}`,
    ).toBe(true);
  }, 30_000);

  it("an adapter with NO node is transport, not merits", async () => {
    // `directory_unavailable` is returned before any dial is attempted — the relay has no libp2p
    // node at all. It is the most obviously non-verdict failure there is, and it terminalised too.
    const out = await sealThen({
      scope,
      answer: async () => ({ ok: false as const, kind: "unreachable" as const, reason: "directory_unavailable" }),
    });
    expect(out.stillAcceptsLeaves, "no directory was even contacted; nothing was decided").toBe(true);
  }, 30_000);

  it("an UNKNOWN outcome is neither reopened nor terminalised — review F2", async () => {
    /**
     * SENT, NO ANSWER. The directory acknowledges only after its FULL ceremony, so silence may mean
     * it notarized this session and the acknowledgement died on the way home.
     *
     * Reopening would be the dangerous half: the tree could grow past a root the directory has
     * already certified, a retry would seal a LARGER leaf set as R′, and both parties would hold a
     * receipt the directory has no row for. My first version classified this as `unreachable` and
     * did exactly that.
     *
     * Terminalising is equally wrong — the seal may have succeeded. So the session stays
     * non-accepting: honest about what is not known.
     */
    const out = await sealThen({
      scope,
      answer: async () => ({ ok: false as const, kind: "unknown" as const, reason: "no_response" }),
    });
    expect(out.asked).toBeGreaterThan(0);
    expect(
      out.stillAcceptsLeaves,
      "An unknown outcome reopened the session. The directory may hold a certificate over the " +
        "current root; accepting another leaf lets a later seal certify a DIFFERENT root, and the " +
        "two parties end up holding a receipt the directory never stored.",
    ).toBe(false);
  }, 30_000);

  it("an UNCLASSIFIED failure is treated as a verdict — fail closed, not open", async () => {
    /**
     * The safety default, and the direction matters.
     *
     * An adapter that returns no `kind` has not been updated. Treating that as TRANSPORT would keep
     * sessions alive on genuine refusals — a seal that a directory rejected on its merits would
     * retry forever, and the operator would never be told their seal was refused. Treating it as a
     * VERDICT is the conservative reading: it preserves today's behaviour exactly for any caller
     * that has not opted in, so this change cannot silently loosen anything.
     */
    const out = await sealThen({
      scope,
      answer: async () => ({ ok: false as const, reason: "some_unclassified_failure" }),
    });
    expect(
      out.stillAcceptsLeaves,
      "an unclassified failure must keep the old behaviour, not inherit the new leniency",
    ).toBe(false);
  }, 30_000);
});
