/**
 * DOD-M15-TERMINAL-REASON-1 — "sealed" and "gave up" stop being the same word.
 *
 * ─── The defect, and it is sharper than the DoD line records ───────────────────────────────────
 *
 * `relay-node.ts` answers every non-active session with one reason:
 *
 *     if (state.status !== "active") { await reply("session_sealed"); return; }
 *
 * There are three statuses — `active`, `sealing`, `seal_rejected` — so that line fires for exactly
 * two of them, and **`session_sealed` is not true of either**:
 *
 *   `sealing`        the seal is IN FLIGHT. Nothing has been notarized yet, and after
 *                    `DOD-M15-TRANSPORT-TERMINAL-1` a session can sit here and then go back to
 *                    active, so telling the operator it is sealed is wrong in both directions.
 *   `seal_rejected`  a directory READ the seal and REFUSED it. The conversation is over and there
 *                    is no receipt. This is the opposite of sealed.
 *
 * And a session that genuinely sealed is not in this branch at all: `confirmSeal` calls
 * `destroySession`, so a notarized session answers `session_not_found` one line above.
 *
 * **So the two answers are inverted.** A conversation that sealed successfully reports
 * "not found"; one that was refused reports "sealed". An operator who reads either at face value
 * believes the opposite of what happened, and the refused case is the dangerous direction — they
 * believe they hold a notarized receipt of a conversation nobody notarized.
 *
 * ─── Wire compatibility, checked rather than assumed ───────────────────────────────────────────
 *
 * `session-relay-client.ts` handles a `hash_submit_error` by carrying `reason` through opaquely
 * (`typeof frame["reason"] === "string" ? frame["reason"] : "relay_rejected"`) — it does not branch
 * on the value. So an older client meeting a new reason surfaces the new string instead of the old
 * one, which is strictly better than surfacing a word that was already wrong. Nothing depends on
 * `session_sealed` as a refusal value; the identically-named `session_sealed` FRAME in
 * protocol-types is a different thing on a different path.
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
 * Drive a session to adjudication, then report the reason a participant's NEXT submission gets.
 *
 * `hold` lets a test keep the seal IN FLIGHT so the `sealing` status is observable — otherwise the
 * adapter answers instantly and that state is never seen from outside.
 */
async function reasonAfterSeal(opts: {
  scope: ReturnType<typeof createTestScope>;
  answer: () => Promise<{ ok: true } | { ok: false; kind?: "refused" | "unreachable"; reason: string }>;
  hold?: boolean;
  /** Called the moment adjudication is entered — lets a caller time its probe against the lock. */
  onEnter?: () => void;
  /** When given, adjudication blocks on this instead of the local release. */
  gate?: Promise<void>;
}): Promise<string | undefined> {
  const dirKp = generateKeypair();
  const dirPub = await dirKp.getPublicKey();

  let asked = 0;
  /**
   * An EXPLICIT release rather than a sleep.
   *
   * The first version slept 5 seconds inside the adapter and probed afterwards — by which time the
   * seal had completed and the session was destroyed, so the probe measured `session_not_found` and
   * the test proved nothing about the in-flight state. The adapter now blocks until the test says
   * go, so the probe is guaranteed to land while the status is `sealing`.
   */
  let release: () => void = () => {};
  const held = new Promise<void>((r) => { release = r; });
  const adapter = {
    async processSeal() {
      asked++;
      opts.onEnter?.();
      if (opts.hold) await (opts.gate ?? held);
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

  // Wait until the adapter has been ENTERED — with `hold` that is the moment the status is
  // `sealing` and stays there until this test releases it.
  for (let i = 0; i < 80 && asked === 0; i++) await new Promise((r) => setTimeout(r, 25));
  expect(asked, "the directory was never asked — the session never reached adjudication").toBeGreaterThan(0);
  if (!opts.hold) await new Promise((r) => setTimeout(r, 100));

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
  // Let the held adapter finish so nothing is left pending after the test returns.
  release();
  return typeof resp["reason"] === "string" ? resp["reason"] : undefined;
}

describe("DOD-M15-TERMINAL-REASON-1: a refused seal does not report itself as sealed", () => {
  let scope = createTestScope();
  beforeEach(() => { scope = createTestScope(); });
  afterEach(() => scope.run(async () => {}));

  it("a REFUSED seal says so — not 'session_sealed'", async () => {
    /**
     * ★ THE DEFECT, and the direction that costs. A directory read this seal and rejected it: there
     * is no receipt and there will not be one. Answering `session_sealed` tells the operator the
     * exact opposite, and it is the answer they get for every subsequent thing they try.
     */
    const reason = await reasonAfterSeal({
      scope,
      answer: async () => ({ ok: false as const, kind: "refused" as const, reason: "merkle_root_mismatch" }),
    });
    expect(
      reason,
      `A refused seal reported "${String(reason)}". The conversation ended with NO receipt, and the ` +
        `operator is being told it sealed — they will go looking for a notarized receipt that does ` +
        `not exist, and stop investigating a failure that needs them.`,
    ).toBe("seal_refused");
  }, 30_000);

  it("a client CANNOT observe the in-flight state — the lock serializes it, and that is why", async () => {
    /**
     * WHAT I EXPECTED TO TEST, AND WHY IT IS NOT TESTABLE HERE — recorded rather than deleted,
     * because the next person will reach for the same test.
     *
     * `sealing` is the other status that reaches the reason branch, so it looks like it needs the
     * same treatment. It cannot be observed by a participant: `#processHashSubmit` serializes per
     * session (`const prev = this.#sessionLocks.get(sessionKey); … await prev`) and adjudication
     * runs INSIDE that lock, so a concurrent submission blocks until the seal resolves and then
     * sees the outcome — never the intermediate state.
     *
     * Measured: holding the adapter open and probing made the submission hang until the 30s test
     * timeout. That is the lock, not a slow relay.
     *
     * `seal_in_progress` is still implemented, because the branch must not fall back to the wrong
     * word if the lock is ever released earlier — and `DOD-M15-TRANSPORT-TERMINAL-1` made `sealing`
     * a state a session can LEAVE as well as enter. What is asserted here is the serialization
     * itself, which is the real observable property.
     */
    let entered = 0;
    let release: () => void = () => {};
    const held = new Promise<void>((r) => { release = r; });

    const probe = reasonAfterSeal({
      scope,
      hold: true,
      onEnter: () => { entered++; },
      gate: held,
      answer: async () => ({ ok: false as const, kind: "refused" as const, reason: "merkle_root_mismatch" }),
    });

    // Give the probe time to block on the lock, then let adjudication finish.
    await new Promise((r) => setTimeout(r, 1_500));
    expect(entered, "adjudication must have started for this to be measuring the lock").toBeGreaterThan(0);
    release();

    expect(
      await probe,
      "once the seal resolves, the blocked submission sees the OUTCOME — a refusal, named",
    ).toBe("seal_refused");
  }, 30_000);

  it("the refusal reason is no longer the word that meant the opposite", async () => {
    // Guards against the fix collapsing back to one shared string under a new name, and pins the
    // specific regression: `session_sealed` must never again be the answer for a refused seal.
    const refused = await reasonAfterSeal({
      scope,
      answer: async () => ({ ok: false as const, kind: "refused" as const, reason: "leaf_count_mismatch" }),
    });
    expect(refused).toBe("seal_refused");
    expect(refused).not.toBe("session_sealed");
  }, 30_000);
});
