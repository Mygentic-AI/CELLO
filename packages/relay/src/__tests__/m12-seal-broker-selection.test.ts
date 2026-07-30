/**
 * M12 `DOD-SEAL-BROKER-1` — the relay asks the BROKERING directory, per session.
 *
 * ─── Why this file exists ────────────────────────────────────────────────────────────────────────
 * The feature shipped with no test at all, and the live GCP enforcer that "proved" it cannot detect
 * its loss: revert the broker selection entirely and the configured directory still returns a
 * redirect, the redirect is followed once, the seal completes, and every assertion in the live test
 * still passes. It proves cross-directory sealing works — not that the relay asked the broker.
 *
 * The assertion that distinguishes them is the target `processSeal` is CALLED with, which is what
 * the first test here checks. Its absence had a measurable cost: `createRelayNode` silently dropped
 * `directoryEndpointsByPubkey` when forwarding options, so broker resolution could never succeed,
 * and that cost a full deploy cycle to find. Five lines of spy would have caught it before the
 * image was ever built — a field-by-field factory drop is invisible to `tsc` and to any test that
 * only asserts the seal completed.
 *
 * The spy adapter is the whole point: `processSeal` is the seam where the choice becomes observable.
 * Asserting on the outcome (sealed / not sealed) cannot see the choice, because every path
 * eventually seals.
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
import type { DirectoryAdapter } from "../relay-node.js";
import type { SessionAssignment } from "../relay-types.js";

setupV3Tests();

const CBOR_ENC = new Encoder({ tagUint8Array: false });
const CTRL_LEAF = 0x02;

/** The address configured for the BROKER — deliberately not the relay's configured directory. */
const BROKER_ADDR = "/ip4/10.9.9.9/tcp/4101/ws/p2p/12D3KooWBrokerTestOnlyAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

// ─── wire helpers (local, matching the other relay protocol tests) ──────────────────────────────

class StreamReader {
  readonly #iter: AsyncIterator<Uint8Array>;
  constructor(stream: Stream) {
    const gen = lp.decode(stream);
    this.#iter = (gen as AsyncIterable<unknown>)[Symbol.asyncIterator]() as AsyncIterator<Uint8Array>;
  }
  async readFrame(): Promise<Uint8Array> {
    const { value, done } = await this.#iter.next();
    if (done || value === undefined) throw new Error("stream ended without yielding a frame");
    const v = value as unknown;
    if (v instanceof Uint8Array) return v;
    if (typeof (v as { slice?: () => Uint8Array }).slice === "function") return (v as { slice(): Uint8Array }).slice();
    return new Uint8Array(v as ArrayBuffer);
  }
  async readDecoded(): Promise<Record<string, unknown>> {
    return decode(await this.readFrame()) as Record<string, unknown>;
  }
}

function toU8(v: unknown): Uint8Array {
  if (v instanceof Uint8Array) return v;
  if (Buffer.isBuffer(v)) return new Uint8Array(v as Buffer);
  throw new Error(`expected bytes, got ${typeof v}`);
}

function sendFrame(stream: Stream, data: Uint8Array): void {
  stream.send(lp.encode.single(data));
}

async function performRelayAuth(reader: StreamReader, stream: Stream, kp: ReturnType<typeof generateKeypair>): Promise<void> {
  const challenge = await reader.readDecoded();
  expect(challenge["type"]).toBe("relay_auth_challenge");
  const nonce = toU8(challenge["nonce"]);
  const pubkey = await kp.getPublicKey();
  const authMsg = new Uint8Array(Buffer.concat([Buffer.from("CELLO-RELAY-AUTH-v1", "utf8"), nonce, pubkey]));
  const signature = await kp.sign(new Uint8Array(createHash("sha256").update(authMsg).digest()));
  sendFrame(stream, CBOR_ENC.encode({ type: "relay_auth_response", pubkey, signature }));
  const ack = await reader.readDecoded();
  if (ack["type"] === "relay_auth_failed") throw new Error(`relay_auth_failed: ${String(ack["reason"])}`);
  expect(ack["type"]).toBe("relay_auth_ok");
}

async function makeStructure1(
  sessionId: Uint8Array,
  kp: ReturnType<typeof generateKeypair>,
  lastSeenSeq: number,
): Promise<{ structure1_cbor: Uint8Array; sender_signature: Uint8Array }> {
  const pubkey = await kp.getPublicKey();
  const tbs = CBOR_ENC.encode([1, new Uint8Array(randomBytes(32)), pubkey, sessionId, lastSeenSeq, Date.now()]) as Uint8Array;
  return { structure1_cbor: tbs, sender_signature: await kp.sign(tbs) };
}

/** An assignment signed by a CHOSEN directory keypair — which directory signed is the thing under test. */
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
  return {
    session_id: sessionId,
    participant_a: pubA,
    participant_b: pubB,
    session_timestamp,
    directory_signature: await signingDir.sign(tbs),
  };
}

/** Records every processSeal target so the CHOICE — not just the outcome — is assertable. */
function spyDirectory(results: Array<{ ok: boolean; reason?: string }>): {
  adapter: DirectoryAdapter;
  targets: Array<string | undefined>;
} {
  const targets: Array<string | undefined> = [];
  let call = 0;
  const adapter = {
    async processSeal(_sessionId: Uint8Array, _data: unknown, target?: { peerId: string; multiaddr: string }) {
      targets.push(target?.multiaddr);
      const r = results[Math.min(call++, results.length - 1)]!;
      return r.ok ? { ok: true as const } : { ok: false as const, reason: r.reason ?? "spy_refused" };
    },
    async getRelayPublicKey() { return undefined; },
  } as unknown as DirectoryAdapter;
  return { adapter, targets };
}

/**
 * Stand up a relay that knows TWO directories: `configured` (its deploy-time directory) and
 * `broker` (whose address is the only one in the endpoint map). Then run a session to a seal.
 */
async function sealWithBroker(opts: {
  scope: ReturnType<typeof createTestScope>;
  /** Which directory signs the assignment — the broker, or someone unknown. */
  signWith: "broker" | "configured" | "stranger";
  /** Whether the broker's address is configured at all (absent → documented fallback). */
  configureBrokerAddr?: boolean;
  results: Array<{ ok: boolean; reason?: string }>;
}): Promise<{ targets: Array<string | undefined>; sessionIdHex: string; relay: Awaited<ReturnType<typeof createRelayNode>>["relay"] }> {
  const configuredDir = generateKeypair();
  const brokerDir = generateKeypair();
  const stranger = generateKeypair();
  const configuredPub = await configuredDir.getPublicKey();
  const brokerPub = await brokerDir.getPublicKey();

  const { adapter, targets } = spyDirectory(opts.results);
  const { relay, node, stop } = await createRelayNode({
    directoryPubkey: configuredPub,
    directoryPubkeys: [configuredPub, brokerPub],
    ...(opts.configureBrokerAddr !== false && {
      directoryEndpointsByPubkey: { [Buffer.from(brokerPub).toString("hex")]: BROKER_ADDR },
    }),
    directory: adapter,
  });
  opts.scope.addCleanup(async () => { await stop(); });

  const clientA = generateKeypair();
  const clientB = generateKeypair();
  const pubA = await clientA.getPublicKey();
  const pubB = await clientB.getPublicKey();
  const sessionId = new Uint8Array(randomBytes(16));

  const signer = opts.signWith === "broker" ? brokerDir : opts.signWith === "configured" ? configuredDir : stranger;
  const assignment = await makeAssignment(sessionId, pubA, pubB, signer);
  const recorded = relay.recordAssignment(assignment);
  if (opts.signWith === "stranger") {
    expect(recorded).toEqual({ ok: false, reason: "directory_signature_invalid" });
    return { targets, sessionIdHex: Buffer.from(sessionId).toString("hex"), relay };
  }
  expect(recorded).toEqual({ ok: true });

  // Two ctrl leaves from DISTINCT senders is what triggers adjudication.
  const relayAddr = node.listenAddresses()[0]!;
  const relayPeerId = node.getPeerId();
  for (const [kp, seq] of [[clientA, 0], [clientB, 1]] as const) {
    const cn = await createNode({ keyProvider: kp, listenAddresses: ["/ip4/127.0.0.1/tcp/0"] });
    await cn.start();
    opts.scope.addCleanup(async () => { await cn.stop(); });
    await cn.dial(relayAddr);
    const stream = await cn.newStream(relayPeerId, RELAY_PROTOCOL_ID);
    const reader = new StreamReader(stream);
    await performRelayAuth(reader, stream, kp);
    const { structure1_cbor, sender_signature } = await makeStructure1(sessionId, kp, seq);
    sendFrame(stream, CBOR_ENC.encode({
      type: "hash_submit", session_id: sessionId, leaf_kind: CTRL_LEAF, structure1_cbor, sender_signature,
    }));
    // Read until the ACK: the second client is also a DELIVERY target for the first client's leaf, so
    // a `leaf_deliver` frame can arrive on this stream before its own ack. Asserting on the first
    // frame makes the test order-dependent on unrelated traffic.
    let ack = await reader.readDecoded();
    for (let i = 0; i < 5 && ack["type"] !== "hash_submit_ack"; i++) ack = await reader.readDecoded();
    expect(ack["type"], `hash_submit rejected: ${String(ack["reason"])}`).toBe("hash_submit_ack");
  }

  // The second leaf's ack is written before adjudication is awaited, so give the async path a turn.
  for (let i = 0; i < 40 && targets.length === 0; i++) await new Promise((r) => setTimeout(r, 25));
  return { targets, sessionIdHex: Buffer.from(sessionId).toString("hex"), relay };
}

describe("DOD-SEAL-BROKER-1: the relay asks the directory that brokered the session", () => {
  let scope = createTestScope();
  beforeEach(() => { scope = createTestScope(); });
  afterEach(() => scope.run(async () => {}));

  it("asks the BROKER's address, not the configured directory", async () => {
    // ★ THE REVERT TEST. Revert the broker selection (or drop directoryEndpointsByPubkey in the
    // factory again) and `targets[0]` becomes undefined — the relay falls back to its configured
    // directory. Every outcome-based assertion still passes in that world, which is why this one
    // asserts the TARGET.
    const { targets } = await sealWithBroker({ scope, signWith: "broker", results: [{ ok: true }] });
    expect(targets).toEqual([BROKER_ADDR]);
  }, 30_000);

  it("routes around a broker that is unreachable instead of failing the seal", async () => {
    // F1: processSeal dials only the target it is given and returns the transport error with NO
    // redirect. Before the fix that rejected the seal outright — one unreachable node making the
    // system unusable, which the sovereign-node redundancy invariant forbids. The retry must go to
    // the configured directory (target undefined), and it must actually happen.
    const { targets } = await sealWithBroker({
      scope,
      signWith: "broker",
      results: [{ ok: false, reason: "No transport available for address" }, { ok: true }],
    });
    expect(targets).toEqual([BROKER_ADDR, undefined]);
  }, 30_000);

  it("falls back to the configured directory when the broker has no configured address", async () => {
    // The documented single-directory / enterprise-private-relay path: absence is handled, and it
    // must remain handled — this is the clause the DoD calls "ONLY when absent".
    const { targets } = await sealWithBroker({
      scope, signWith: "broker", configureBrokerAddr: false, results: [{ ok: true }],
    });
    expect(targets).toEqual([undefined]);
  }, 30_000);

  it("refuses an assignment signed by a key that is not a known directory", async () => {
    // The broker is identified BY the signature, so an unverifiable assignment must be refused
    // rather than defaulted — otherwise a participant could steer which directory the relay
    // believes brokered the session.
    const { targets } = await sealWithBroker({ scope, signWith: "stranger", results: [{ ok: true }] });
    expect(targets).toEqual([]); // never reached adjudication at all
  }, 30_000);

  it("releases the recorded broker on teardown", async () => {
    // F5: the map was never cleaned, and sessionTrackingEntryCount did not report it — so the eight
    // existing teardown-parity assertions passed while the relay leaked one entry per session for
    // its entire lifetime. Reporting it is what makes the leak visible to those tests.
    const { relay, sessionIdHex, targets } = await sealWithBroker({ scope, signWith: "broker", results: [{ ok: true }] });
    expect(targets).toEqual([BROKER_ADDR]); // the seal really did run, so cleanup really did fire
    expect(relay.sessionTrackingEntryCount(sessionIdHex).hasBroker).toBe(false);
  }, 30_000);
});
