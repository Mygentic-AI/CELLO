/**
 * `DOD-M15-UNILATERAL-1` (013-ABSENCE) — sealing alone needs EVIDENCE the other side is gone.
 *
 * ─── The defect ────────────────────────────────────────────────────────────────────────────────
 * `#processSealUnilateral` gated on `elapsedMs < graceMs` and performed no presence check of any
 * kind. Worse, the value it measured from is written once when the session is created and is never
 * refreshed, so the gate did not mean "silent for ten minutes" — it meant "this session is ten
 * minutes old". A person who took eleven minutes over a reply could have the conversation sealed
 * from under them, with the receipt recording them ABSENT. Nothing had checked whether they were.
 *
 * ─── What is asserted here ─────────────────────────────────────────────────────────────────────
 * One test per DoD clause, and every one of them has been reverted on purpose and confirmed to
 * redden for its own reason (see the journal entry). The clauses:
 *
 *   1. A reachable counterparty cannot be sealed out by elapsed time alone.
 *   2. An absent counterparty CAN still be sealed around — the feature's whole reason for existing.
 *   3. Standard tier behaviour is unchanged for the ordinary case.
 *   4. High-stakes is opt-in only, uses the longer floor, and REFUSES without evidence rather than
 *      degrading to time-only.
 *   5. The artifact splits the mutually-signed prefix from the uncountersigned tail.
 *   6. The elapsed-time source measures what its name claims.
 *
 * Crypto refs: Ed25519 RFC 8032, Merkle RFC 6962, CBOR RFC 8949.
 */
import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { generateKeypair } from "@cello-protocol/crypto";
import { createDirectoryNode } from "../directory-node.js";
import { countersignedThroughSeq } from "../seal-legibility.js";
import {
  runUnilateral,
  makeLivenessRelay,
  makeSpyLogger,
  buildUnilateralCarry,
  capturingStream,
  hex,
  type LogEntry,
} from "./helpers/seal-fixture.js";

/** The ordinary solo-seal shape: A speaks, B answers, A closes alone. */
const CONVERSATION = (a: ReturnType<typeof generateKeypair>, b: ReturnType<typeof generateKeypair>) =>
  [{ key: a, kind: "msg" as const }, { key: b, kind: "msg" as const }, { key: a, kind: "ctrl" as const }];

const notarized = (logs: LogEntry[]): boolean => logs.some((l) => l.event === "session.unilateral.notarized");
const refusal = (logs: LogEntry[]): LogEntry | undefined =>
  logs.find((l) => l.event === "relay.seal.unilateral.rejected");

describe("DOD-M15-UNILATERAL-1 clause 1 — a REACHABLE counterparty is never sealed out by the clock", () => {
  it("★★★ B IS PRESENT ON THE RELAY AND THE SESSION IS LONG PAST THE FLOOR — NO SEAL", async () => {
    /**
     * The headline case, and the one the old code got wrong. Everything the previous gate looked at
     * says "seal it": the session is an hour old against a zero floor. The one thing it never looked
     * at — is the other party actually gone? — says no.
     */
    const logs: LogEntry[] = [];
    const [a, b] = [generateKeypair(), generateKeypair()];
    await runUnilateral(CONVERSATION(a, b), a, b, logs, {
      liveness: "alive",
      sessionAgeMs: 3_600_000,
    });

    expect(
      notarized(logs),
      "a counterparty the relay is holding a live connection to must not be recorded ABSENT on a permanent receipt",
    ).toBe(false);
    expect(refusal(logs)?.ctx["cause"]).toBe("counterparty_present");
  }, 20_000);

  it("the refusal reaches the operator as a frame, not only a log line", async () => {
    /**
     * §2b's standing question — *"this guard fires. Who hears it?"* A refusal that sends nothing
     * leaves the client waiting out its 30-second timer and then reporting
     * `seal_unilateral_timeout`, which names our own wait rather than the cause. The client already
     * understands `seal_unilateral_too_early` as "not now, the session is intact, retry", which is
     * the correct instruction here.
     */
    const logs: LogEntry[] = [];
    const [a, b] = [generateKeypair(), generateKeypair()];
    const { frames } = await runUnilateral(CONVERSATION(a, b), a, b, logs, {
      liveness: "alive",
      sessionAgeMs: 3_600_000,
    });

    const sent = frames.find((f) => f["type"] === "seal_unilateral_too_early");
    expect(sent, "the present party must be told, not left to time out").toBeDefined();
    expect(
      "remaining_seconds" in sent!,
      "there is no countdown to a counterparty leaving — a 0 here would render as 'available in ~0s', a promise nothing keeps",
    ).toBe(false);
  }, 20_000);

  it("★★ the countdown-less refusal SURVIVES A ROUND TRIP — absent is not malformed", async () => {
    /**
     * The decoder used to `return null` for a `seal_unilateral_too_early` with no
     * `remaining_seconds`, which classifies the frame as UNPARSEABLE. Two of the three refusals this
     * frame now carries have no countdown by nature, so dropping them would turn a refusal the
     * operator should hear into silence — and silence reaches them as the 30-second timeout that
     * names our own wait rather than the cause. The live path decodes generically and never saw it,
     * which is exactly how this would have survived.
     *
     * The exemplar values are the ones that separate the two readings: absent (valid), and present
     * but not a number (still malformed).
     */
    const { decodeOutboundSignalingFrame } = await import("../directory-frames.js");
    const { encodeSealUnilateralTooEarly } = await import("../directory-frames.js");
    const sid = new Uint8Array(randomBytes(16));

    const noCountdown = decodeOutboundSignalingFrame(
      encodeSealUnilateralTooEarly({ type: "seal_unilateral_too_early", session_id: sid }),
    );
    expect(noCountdown, "a refusal with no countdown is a valid frame").not.toBeNull();
    expect((noCountdown as { remaining_seconds?: number }).remaining_seconds).toBeUndefined();

    const withCountdown = decodeOutboundSignalingFrame(
      encodeSealUnilateralTooEarly({ type: "seal_unilateral_too_early", session_id: sid, remaining_seconds: 540 }),
    );
    expect((withCountdown as { remaining_seconds?: number }).remaining_seconds).toBe(540);

    const { Encoder } = await import("cbor-x");
    const junk = new Encoder({ tagUint8Array: false }).encode({
      type: "seal_unilateral_too_early", session_id: sid, remaining_seconds: "soon",
    }) as Uint8Array;
    expect(
      decodeOutboundSignalingFrame(junk),
      "a countdown that is PRESENT and not a number is still malformed — absent and malformed stay apart",
    ).toBeNull();
  }, 20_000);

  it("the refusal carries an impact and a next step, not a bare cause code", async () => {
    const logs: LogEntry[] = [];
    const [a, b] = [generateKeypair(), generateKeypair()];
    await runUnilateral(CONVERSATION(a, b), a, b, logs, { liveness: "alive", sessionAgeMs: 3_600_000 });

    const r = refusal(logs)!;
    expect(typeof r.ctx["impact"]).toBe("string");
    expect(typeof r.ctx["guidance"]).toBe("string");
    // The remedy has to be one the reader can actually perform (Invariant 2's third check).
    expect(String(r.ctx["guidance"])).toMatch(/bilateral|close normally|retry/i);
  }, 20_000);
});

describe("DOD-M15-UNILATERAL-1 clause 2 — an ABSENT counterparty can still be sealed around", () => {
  it("★★★ B IS GONE — THE HONEST PARTY STILL GETS A RECEIPT", async () => {
    /**
     * The clause that protects the feature's reason for existing. Refusing too eagerly is the
     * failure mode this unit is most able to cause: if a counterparty can hold your record hostage
     * by walking away, the whole solo path was pointless.
     */
    const logs: LogEntry[] = [];
    const [a, b] = [generateKeypair(), generateKeypair()];
    await runUnilateral(CONVERSATION(a, b), a, b, logs, { liveness: "gone" });

    expect(notarized(logs), "a party who walked away must not be able to deny the other a receipt").toBe(true);
  }, 20_000);

  it("the counterparty is recorded ABSENT, and only on a positive observation", async () => {
    const logs: LogEntry[] = [];
    const [a, b] = [generateKeypair(), generateKeypair()];
    await runUnilateral(CONVERSATION(a, b), a, b, logs, { liveness: "gone" });

    const att = logs.find((l) => l.event === "session.unilateral.attestation");
    expect(att?.ctx["liveness"]).toBe("gone");
    expect(att?.ctx["attestation"]).toBe("ABSENT");
  }, 20_000);
});

describe("DOD-M15-UNILATERAL-1 clause 3 — the STANDARD tier is unchanged for the ordinary case", () => {
  it("unknown liveness past the floor still seals — an honest party is never stranded by a missing signal", async () => {
    /**
     * `unknown` is the relay saying nothing either way: it never tracked this counterparty, or the
     * query failed. The order's first recorded trap is that refusing too eagerly here would strand a
     * legitimate party, so the STANDARD tier proceeds. This is the deliberate exception to
     * "absent is not a pass", and it is bought back by the high-stakes tier below.
     */
    const logs: LogEntry[] = [];
    const [a, b] = [generateKeypair(), generateKeypair()];
    await runUnilateral(CONVERSATION(a, b), a, b, logs, { liveness: "unknown" });

    expect(notarized(logs)).toBe(true);
  }, 20_000);

  it("a relay adapter with NO liveness method at all is treated as unknown, not as a crash or a refusal", async () => {
    const logs: LogEntry[] = [];
    const [a, b] = [generateKeypair(), generateKeypair()];
    await runUnilateral(CONVERSATION(a, b), a, b, logs, { liveness: "omitted" });

    expect(notarized(logs)).toBe(true);
  }, 20_000);

  it("the standard floor still holds: inside it, the seal is refused with a countdown", async () => {
    const logs: LogEntry[] = [];
    const [a, b] = [generateKeypair(), generateKeypair()];
    const { frames } = await runUnilateral(CONVERSATION(a, b), a, b, logs, {
      liveness: "gone",
      graceSeconds: 600,
      sessionAgeMs: 60_000,
    });

    expect(notarized(logs)).toBe(false);
    expect(refusal(logs)?.ctx["cause"]).toBe("too_early");
    expect(refusal(logs)?.ctx["tier"]).toBe("standard");
    const sent = frames.find((f) => f["type"] === "seal_unilateral_too_early");
    // 600s floor, 60s old ⇒ 540 remaining. A real countdown, because this refusal has one.
    expect(sent?.["remaining_seconds"]).toBe(540);
  }, 20_000);
});

describe("DOD-M15-UNILATERAL-1 clause 4 — HIGH-STAKES is opt-in, longer, and refuses without evidence", () => {
  it("★★★ HIGH-STAKES WITH NO EVIDENCE REFUSES — it does NOT fall back to the clock", async () => {
    /**
     * The clause that makes the tier mean something. The session is well past even the 3600s floor
     * and the standard tier would have sealed it on `unknown`. High-stakes will not: a receipt
     * asserting the counterparty was absent is only issued when somebody actually saw them leave.
     *
     * Note the exemplar: `sessionAgeMs` is 2 hours, chosen so the run reaches the EVIDENCE branch.
     * At the default backdate it would stop at the floor and this test would pass for the wrong
     * reason — a refusal, yes, but not the refusal it is named for.
     */
    const logs: LogEntry[] = [];
    const [a, b] = [generateKeypair(), generateKeypair()];
    await runUnilateral(CONVERSATION(a, b), a, b, logs, {
      liveness: "unknown",
      highStakes: true,
      sessionAgeMs: 7_200_000,
    });

    expect(notarized(logs), "high-stakes must not seal on a clock alone").toBe(false);
    const r = refusal(logs)!;
    expect(r.ctx["cause"]).toBe("high_stakes_evidence_required");
    expect(r.ctx["tier"]).toBe("high_stakes");
    expect(r.ctx["liveness"]).toBe("unknown");
  }, 20_000);

  it("high-stakes WITH a positive gone observation, past the longer floor, does seal", async () => {
    const logs: LogEntry[] = [];
    const [a, b] = [generateKeypair(), generateKeypair()];
    await runUnilateral(CONVERSATION(a, b), a, b, logs, {
      liveness: "gone",
      highStakes: true,
      sessionAgeMs: 7_200_000,
    });

    expect(notarized(logs), "the tier is stricter, not unusable").toBe(true);
  }, 20_000);

  it("★★ the LONGER floor is real: gone evidence at 30 minutes is still too early at this tier", async () => {
    /**
     * 30 minutes is past the standard 600s floor and short of the high-stakes 3600s one, so the
     * SAME inputs seal at one tier and wait at the other. That is what makes the floor a property
     * of the tier rather than a number in a comment.
     */
    const logs: LogEntry[] = [];
    const [a, b] = [generateKeypair(), generateKeypair()];
    await runUnilateral(CONVERSATION(a, b), a, b, logs, {
      liveness: "gone",
      highStakes: true,
      graceSeconds: 600,
      sessionAgeMs: 1_800_000,
    });

    expect(notarized(logs)).toBe(false);
    const r = refusal(logs)!;
    expect(r.ctx["cause"]).toBe("too_early");
    expect(r.ctx["tier"]).toBe("high_stakes");
    expect(r.ctx["floorSeconds"]).toBe(3600);
  }, 20_000);

  it("★★ the SAME inputs seal at the standard tier — proving the tier, not the timing, is what differs", async () => {
    const logs: LogEntry[] = [];
    const [a, b] = [generateKeypair(), generateKeypair()];
    await runUnilateral(CONVERSATION(a, b), a, b, logs, {
      liveness: "gone",
      highStakes: false,
      graceSeconds: 600,
      sessionAgeMs: 1_800_000,
    });

    expect(notarized(logs)).toBe(true);
  }, 20_000);

  it("★★★ OPT-IN IS THE ONLY WAY IN — a session nobody opted in is standard, and nothing infers otherwise", async () => {
    /**
     * There is no signal the infrastructure could read to decide a conversation is consequential —
     * the relay is blind to content and the directory never sees it. So the absence of the flag has
     * to mean standard, and it has to mean that for a session with every other high-stakes-looking
     * property. Here the evidence is missing, which is the condition high-stakes refuses on; the
     * session seals because nobody asked for that tier.
     */
    const logs: LogEntry[] = [];
    const [a, b] = [generateKeypair(), generateKeypair()];
    await runUnilateral(CONVERSATION(a, b), a, b, logs, { liveness: "unknown" });

    expect(notarized(logs)).toBe(true);
    expect(logs.some((l) => l.ctx["tier"] === "high_stakes")).toBe(false);
  }, 20_000);

  it("★★ the opt-in is read STRICTLY — only a literal true reaches the tier", async () => {
    /**
     * The exemplar check applied to the decoder: the values that matter here are the ones a
     * malformed or hostile frame actually carries. `1`, `"true"` and `"yes"` are all truthy, and any
     * one of them slipping through would opt a conversation into a tier that can WITHHOLD its
     * receipt. Every non-`true` value must land on standard.
     */
    const { decodeInboundSignalingFrame } = await import("../directory-frames.js");
    const { Encoder } = await import("cbor-x");
    const enc = new Encoder({ tagUint8Array: false });
    const base = {
      type: "session_request",
      target_pubkey: new Uint8Array(randomBytes(32)),
      initiator_session_peer_id: "12D3KooTest",
      initiator_session_addrs: ["/ip4/127.0.0.1/tcp/1"],
    };
    for (const v of [1, "true", "yes", {}, [], null, undefined]) {
      const decoded = decodeInboundSignalingFrame(enc.encode({ ...base, high_stakes: v }) as Uint8Array) as
        | { high_stakes?: boolean }
        | null;
      expect(decoded, `high_stakes: ${JSON.stringify(v)} must still decode as a session_request`).not.toBeNull();
      expect(decoded!.high_stakes, `high_stakes: ${JSON.stringify(v)} must NOT reach the strict tier`).toBeUndefined();
    }
    const yes = decodeInboundSignalingFrame(enc.encode({ ...base, high_stakes: true }) as Uint8Array) as { high_stakes?: boolean };
    expect(yes.high_stakes).toBe(true);
  }, 20_000);
});

describe("DOD-M15-UNILATERAL-1 clause 5 — the artifact says which part is weaker", () => {
  it("★★★ THE RECEIPT NAMES WHERE THE MUTUALLY-SIGNED PREFIX ENDS", async () => {
    /**
     * A solo seal is not uniformly weaker than a bilateral one. Here B authored leaf 2 and A's
     * closing SEAL leaf is 3, so leaves 1–2 carry both parties' signatures and leaf 3 carries only
     * A's. A consumer must be able to read that boundary rather than infer it — inferring is how
     * "they never answered this" becomes "they agreed to this".
     */
    const logs: LogEntry[] = [];
    const [a, b] = [generateKeypair(), generateKeypair()];
    const store = await import("@cello-protocol/interfaces/stubs");
    const { directory, stop } = await createDirectoryNode({
      keyProvider: generateKeypair(),
      relay: makeLivenessRelay("gone"),
      relayEndpoint: { peer_id: "relay-peer", multiaddrs: [] },
      store: new store.InMemoryDirectoryStore(),
      logger: makeSpyLogger(logs),
      deliveryGraceSeconds: 0,
    });
    const cap = capturingStream();
    try {
      const sessionId = new Uint8Array(randomBytes(16));
      const carry = await buildUnilateralCarry(CONVERSATION(a, b), a, generateKeypair(), sessionId);
      await directory.triggerSealUnilateralWithLeavesForTest(
        hex(new Uint8Array(await a.getPublicKey())),
        sessionId,
        carry.reportedRoot,
        hex(new Uint8Array(await b.getPublicKey())),
        carry.leaves,
        cap.stream,
      );
    } finally {
      await stop();
    }

    const confirmed = cap.frames().find((f) => f["type"] === "seal_unilateral_confirmed");
    expect(confirmed, "the present party must receive its certificate").toBeDefined();
    const leg = confirmed!["legibility"] as { countersigned_through_seq?: number; participants?: unknown[] };
    expect(leg, "the certificate must carry the legibility").toBeDefined();
    expect(
      leg.countersigned_through_seq,
      "B authored leaf 2 and signed nothing after it, so the mutually-signed prefix ends there and leaf 3 is the tail",
    ).toBe(2);
  }, 20_000);

  it("★★★ A COUNTERPARTY WHO SIGNED NOTHING YIELDS A ZERO PREFIX — the whole record is the tail", async () => {
    /**
     * The conflation this clause exists to prevent, in its sharpest form. B only ever RECEIVED, so B
     * authored no leaf and `buildSealLegibility` — which derives participants from leaf authors —
     * would see one party and, left alone, report the transcript fully countersigned. It is not
     * countersigned at all.
     */
    const logs: LogEntry[] = [];
    const [a, b] = [generateKeypair(), generateKeypair()];
    const store = await import("@cello-protocol/interfaces/stubs");
    const { directory, stop } = await createDirectoryNode({
      keyProvider: generateKeypair(),
      relay: makeLivenessRelay("gone"),
      relayEndpoint: { peer_id: "relay-peer", multiaddrs: [] },
      store: new store.InMemoryDirectoryStore(),
      logger: makeSpyLogger(logs),
      deliveryGraceSeconds: 0,
    });
    const cap = capturingStream();
    try {
      const sessionId = new Uint8Array(randomBytes(16));
      // A speaks twice and closes. B never authors anything.
      const soleAuthor = [
        { key: a, kind: "msg" as const },
        { key: a, kind: "msg" as const },
        { key: a, kind: "ctrl" as const },
      ];
      const carry = await buildUnilateralCarry(soleAuthor, a, generateKeypair(), sessionId);
      await directory.triggerSealUnilateralWithLeavesForTest(
        hex(new Uint8Array(await a.getPublicKey())),
        sessionId,
        carry.reportedRoot,
        hex(new Uint8Array(await b.getPublicKey())),
        carry.leaves,
        cap.stream,
      );
    } finally {
      await stop();
    }

    const confirmed = cap.frames().find((f) => f["type"] === "seal_unilateral_confirmed");
    const leg = confirmed!["legibility"] as { countersigned_through_seq?: number };
    expect(
      leg.countersigned_through_seq,
      "nothing here carries the counterparty's signature, so claiming any mutually-signed prefix would be a false statement on a permanent record",
    ).toBe(0);
  }, 20_000);

  it("the boundary is the LEAST-committed party's reach, so one party's own signatures cannot move it", async () => {
    /**
     * Asserted on the derivation directly, because the property is arithmetic and the consumer
     * recomputes it. A party can only ever raise their OWN reach; the boundary is the minimum, so
     * raising it moves nothing until the other side catches up.
     */
    expect(countersignedThroughSeq([
      { content_frontier_seq: 2, last_authored_seq: 3 },
      { content_frontier_seq: 1, last_authored_seq: 2 },
    ])).toBe(2);
    // A inflates its own authored reach to 99; the boundary does not move.
    expect(countersignedThroughSeq([
      { content_frontier_seq: 2, last_authored_seq: 99 },
      { content_frontier_seq: 1, last_authored_seq: 2 },
    ])).toBe(2);
    // A party that signed nothing pins it to zero.
    expect(countersignedThroughSeq([
      { content_frontier_seq: 9, last_authored_seq: 9 },
      { content_frontier_seq: 0, last_authored_seq: 0 },
    ])).toBe(0);
  });
});

describe("DOD-M15-UNILATERAL-1 clause 6 — the elapsed-time source measures what its name claims", () => {
  it("★★★ SESSION AGE IS A FLOOR, NOT A PRESENCE TEST", async () => {
    /**
     * The order's own words for the defect: *"a counterparty who has been actively replying for an
     * hour is exactly as sealable as one who never answered at all."* The clock cannot tell those
     * apart and never could — it measures how old the session is. Both runs below are an hour past
     * the floor; the only difference is whether the other side is there.
     */
    const [a, b] = [generateKeypair(), generateKeypair()];

    const busyLogs: LogEntry[] = [];
    await runUnilateral(CONVERSATION(a, b), a, b, busyLogs, { liveness: "alive", sessionAgeMs: 3_600_000 });

    const quietLogs: LogEntry[] = [];
    await runUnilateral(CONVERSATION(a, b), a, b, quietLogs, { liveness: "gone", sessionAgeMs: 3_600_000 });

    expect(notarized(busyLogs), "the busy conversation must NOT seal").toBe(false);
    expect(notarized(quietLogs), "the abandoned one must").toBe(true);
  }, 30_000);

  it("★★ the field is named for what it holds — session genesis, restored as genesis", async () => {
    /**
     * `#sessionLastActivity` held `sessions.created_at` and nothing ever refreshed it, so the name
     * asserted a property the value did not have. Under Option B the directory sees no message
     * traffic, so there is no last activity for it to hold and there never was. Renamed rather than
     * faked: the accessor returns genesis, and the gate treats it as a floor.
     */
    const logs: LogEntry[] = [];
    const store = await import("@cello-protocol/interfaces/stubs");
    const { directory, stop } = await createDirectoryNode({
      keyProvider: generateKeypair(),
      relay: makeLivenessRelay("gone"),
      relayEndpoint: { peer_id: "relay-peer", multiaddrs: [] },
      store: new store.InMemoryDirectoryStore(),
      logger: makeSpyLogger(logs),
      deliveryGraceSeconds: 600,
    });
    try {
      const sessionIdHex = randomBytes(16).toString("hex");
      const genesisTimestampMs = Date.now() - 60_000;
      directory.restoreSessionGenesis([
        { sessionId: sessionIdHex, initiatorHex: "aa".repeat(32), targetHex: "bb".repeat(32), genesisTimestampMs },
      ]);
      expect(directory.getRestoredGenesisForTest(sessionIdHex)).toBe(genesisTimestampMs);
      expect(
        logs.some((l) => l.event === "adapter.state.loaded" && l.ctx["stateType"] === "session_genesis"),
        "the restore says what it restored",
      ).toBe(true);
    } finally {
      await stop();
    }
  }, 20_000);

  it("★★ the tier is EVICTED with the rest of the session's state, not left to accumulate", async () => {
    /**
     * `#sessionHighStakes` is per-session state and its siblings — the roster and the genesis
     * timestamp — are both deleted when a seal completes. Left behind, it grows without bound on a
     * long-running node, and a later session id colliding with a retired one would inherit a tier
     * nobody asked for. Asserted through the same accessor the gate reads.
     */
    const logs: LogEntry[] = [];
    const [a, b] = [generateKeypair(), generateKeypair()];
    const store = await import("@cello-protocol/interfaces/stubs");
    const { directory, stop } = await createDirectoryNode({
      keyProvider: generateKeypair(),
      relay: makeLivenessRelay("gone"),
      relayEndpoint: { peer_id: "relay-peer", multiaddrs: [] },
      store: new store.InMemoryDirectoryStore(),
      logger: makeSpyLogger(logs),
      deliveryGraceSeconds: 0,
      highStakesGraceSeconds: 0,
    });
    const cap = capturingStream();
    let sessionIdHex = "";
    try {
      const sessionId = new Uint8Array(randomBytes(16));
      sessionIdHex = hex(sessionId);
      const carry = await buildUnilateralCarry(CONVERSATION(a, b), a, generateKeypair(), sessionId);
      await directory.triggerSealUnilateralWithLeavesForTest(
        hex(new Uint8Array(await a.getPublicKey())),
        sessionId,
        carry.reportedRoot,
        hex(new Uint8Array(await b.getPublicKey())),
        carry.leaves,
        cap.stream,
        { highStakes: true },
      );
      expect(notarized(logs), "precondition: the seal must actually complete for eviction to run").toBe(true);
      expect(
        directory.getSessionHighStakesForTest(sessionIdHex),
        "the tier must not outlive the session it belongs to",
      ).toBe(false);
    } finally {
      await stop();
    }
  }, 20_000);

  it("★★ the HIGH-STAKES opt-in survives a restart — it is restored with the roster, never re-inferred", async () => {
    /**
     * A directory restart that forgot the tier would judge the conversation at the standard bar: a
     * shorter floor and no evidence requirement, for a session whose initiator asked for the
     * opposite, with nobody told. That is the silent downgrade the persisted column exists to stop.
     */
    const logs: LogEntry[] = [];
    const store = await import("@cello-protocol/interfaces/stubs");
    const { directory, stop } = await createDirectoryNode({
      keyProvider: generateKeypair(),
      relay: makeLivenessRelay("gone"),
      relayEndpoint: { peer_id: "relay-peer", multiaddrs: [] },
      store: new store.InMemoryDirectoryStore(),
      logger: makeSpyLogger(logs),
    });
    try {
      const strict = randomBytes(16).toString("hex");
      const ordinary = randomBytes(16).toString("hex");
      directory.restoreSessionParticipants([
        { sessionId: strict, initiatorHex: "aa".repeat(32), targetHex: "bb".repeat(32), genesisTimestampMs: Date.now(), highStakes: true },
        { sessionId: ordinary, initiatorHex: "cc".repeat(32), targetHex: "dd".repeat(32), genesisTimestampMs: Date.now() },
      ]);
      expect(directory.getSessionHighStakesForTest(strict)).toBe(true);
      expect(
        directory.getSessionHighStakesForTest(ordinary),
        "a row that says nothing is STANDARD — the tier that never withholds a receipt",
      ).toBe(false);
    } finally {
      await stop();
    }
  }, 20_000);
});
