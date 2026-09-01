/**
 * DOD-M15-RELAYSLOTS-1 — the tuple cap: two identities may not hold unlimited sessions together.
 *
 * This is the SECOND door into the reservation table, and it only becomes visible once the first is
 * shut. With a directory-issued token required, an attacker can no longer mint keypairs to take
 * slots. What they can still do is register two agents they own, open thousands of sessions between
 * those two, put one message down each — and hold the whole table with slots that are genuinely,
 * correctly, in use by every measure the relay has.
 *
 * The per-agent slot cap does not close it on its own: the attacker just brings more agents. What
 * the two do together is make the attack cost real registered identities per handful of slots, and
 * registration is email-gated and involves a threshold ceremony, so identities are not free the way
 * keypairs are.
 *
 * ⚠️ The count must be of LIVE sessions. If a sealed or swept session kept counting, an ordinary
 * pair of agents that talk often would hit this cap after a day and be unable to start another
 * conversation — a refusal aimed at an attacker landing squarely on the most active real users.
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
import { randomBytes } from "node:crypto";
import { Encoder } from "cbor-x";
import { generateKeypair } from "@cello-protocol/crypto";
import { createRelayNode, SESSION_CAP_PER_PAIR } from "../relay-node.js";

setupV3Tests();

const CBOR_ENC = new Encoder({ tagUint8Array: false });

type Keypair = ReturnType<typeof generateKeypair>;

async function assignment(dirKp: Keypair, a: Uint8Array, b: Uint8Array): Promise<{
  session_id: Uint8Array;
  participant_a: Uint8Array;
  participant_b: Uint8Array;
  session_timestamp: number;
  directory_signature: Uint8Array;
}> {
  const session_id = new Uint8Array(randomBytes(16));
  const session_timestamp = Date.now();
  const tbs = CBOR_ENC.encode([
    session_id, a, b,
    session_timestamp > 0xffffffff ? BigInt(session_timestamp) : session_timestamp,
  ]) as Uint8Array;
  return { session_id, participant_a: a, participant_b: b, session_timestamp, directory_signature: await dirKp.sign(tbs) };
}

describe("DOD-M15-RELAYSLOTS-1: concurrent sessions between one pair are capped", () => {
  let scope = createTestScope();
  beforeEach(() => { scope = createTestScope(); });
  afterEach(() => scope.run(async () => {}));

  async function harness() {
    const dirKp = generateKeypair();
    const { relay, stop } = await createRelayNode({ directoryPubkey: await dirKp.getPublicKey() });
    scope.addCleanup(stop);
    const a = generateKeypair();
    const b = generateKeypair();
    const c = generateKeypair();
    return {
      relay, dirKp,
      pubA: await a.getPublicKey(),
      pubB: await b.getPublicKey(),
      pubC: await c.getPublicKey(),
    };
  }

  it("★★★ the (cap+1)th concurrent session between the same two identities is refused", async () => {
    const { relay, dirKp, pubA, pubB } = await harness();

    for (let i = 0; i < SESSION_CAP_PER_PAIR; i++) {
      expect(
        relay.recordAssignment(await assignment(dirKp, pubA, pubB)),
        `session ${String(i)} is within the cap of ${String(SESSION_CAP_PER_PAIR)} and must be recorded`,
      ).toEqual({ ok: true });
    }

    expect(
      relay.recordAssignment(await assignment(dirKp, pubA, pubB)),
      "unbounded sessions between two identities you own is how the table gets taken with slots " +
        "that are correctly in use by every measure the relay has.",
    ).toEqual({ ok: false, reason: "session_tuple_cap_exceeded", concurrent: SESSION_CAP_PER_PAIR, cap: SESSION_CAP_PER_PAIR });
  }, 30_000);

  it("the cap is per PAIR — a different counterparty is unaffected", async () => {
    const { relay, dirKp, pubA, pubB, pubC } = await harness();

    for (let i = 0; i < SESSION_CAP_PER_PAIR; i++) {
      expect(relay.recordAssignment(await assignment(dirKp, pubA, pubB))).toEqual({ ok: true });
    }

    expect(
      relay.recordAssignment(await assignment(dirKp, pubA, pubC)),
      "A is at its limit with B. That says nothing about A and C, and refusing here would let one " +
        "counterparty lock an agent out of talking to anyone else.",
    ).toEqual({ ok: true });
  }, 30_000);

  it("the cap is direction-blind: A→B and B→A are the same pair", async () => {
    const { relay, dirKp, pubA, pubB } = await harness();

    // Alternate who is participant_a, which is decided by whoever initiated.
    for (let i = 0; i < SESSION_CAP_PER_PAIR; i++) {
      const [x, y] = i % 2 === 0 ? [pubA, pubB] : [pubB, pubA];
      expect(relay.recordAssignment(await assignment(dirKp, x, y))).toEqual({ ok: true });
    }

    expect(
      relay.recordAssignment(await assignment(dirKp, pubB, pubA)),
      "counting by ordered pair would let an attacker double the cap by simply taking turns " +
        "initiating — the count is over the two participants' live sessions, so order is irrelevant.",
    ).toEqual({ ok: false, reason: "session_tuple_cap_exceeded", concurrent: SESSION_CAP_PER_PAIR, cap: SESSION_CAP_PER_PAIR });
  }, 30_000);

  it("★★★ a CLOSED session stops counting — the cap bounds what is live, not what ever happened", async () => {
    const { relay, dirKp, pubA, pubB } = await harness();

    const sessions: Uint8Array[] = [];
    for (let i = 0; i < SESSION_CAP_PER_PAIR; i++) {
      const a = await assignment(dirKp, pubA, pubB);
      expect(relay.recordAssignment(a)).toEqual({ ok: true });
      sessions.push(a.session_id);
    }
    expect(relay.recordAssignment(await assignment(dirKp, pubA, pubB))).toEqual({
      ok: false, reason: "session_tuple_cap_exceeded", concurrent: SESSION_CAP_PER_PAIR, cap: SESSION_CAP_PER_PAIR,
    });

    // One conversation ends the ordinary way.
    relay.discardSession(sessions[0]!);

    expect(
      relay.recordAssignment(await assignment(dirKp, pubA, pubB)),
      "if finished sessions kept counting, two agents who simply talk often would hit this cap " +
        "after a day and be unable to start another conversation — a refusal aimed at an attacker " +
        "landing on the most active real users instead.",
    ).toEqual({ ok: true });
  }, 30_000);

  it("a refused session leaves nothing behind — the cap does not consume itself", async () => {
    const { relay, dirKp, pubA, pubB } = await harness();

    const sessions: Uint8Array[] = [];
    for (let i = 0; i < SESSION_CAP_PER_PAIR; i++) {
      const a = await assignment(dirKp, pubA, pubB);
      expect(relay.recordAssignment(a)).toEqual({ ok: true });
      sessions.push(a.session_id);
    }
    // Three refusals in a row. If a refused attempt recorded participant tracking on its way out,
    // the pair would now be counted at cap+3 and no amount of closing would ever let them talk again.
    for (let i = 0; i < 3; i++) {
      expect(relay.recordAssignment(await assignment(dirKp, pubA, pubB))).toEqual({
        ok: false, reason: "session_tuple_cap_exceeded", concurrent: SESSION_CAP_PER_PAIR, cap: SESSION_CAP_PER_PAIR,
      });
    }

    relay.discardSession(sessions[0]!);
    expect(
      relay.recordAssignment(await assignment(dirKp, pubA, pubB)),
      "closing ONE session must make room for exactly one. If it does not, the refusals above " +
        "consumed capacity of their own and the pair is permanently over the cap.",
    ).toEqual({ ok: true });
    expect(
      relay.recordAssignment(await assignment(dirKp, pubA, pubB)),
      "and only one — the pair is back at the cap, not below it",
    ).toEqual({ ok: false, reason: "session_tuple_cap_exceeded", concurrent: SESSION_CAP_PER_PAIR, cap: SESSION_CAP_PER_PAIR });
  }, 30_000);
});
