import { describe, expect, it, vi, beforeEach } from "vitest";
import { RegistrationStateMachine } from "../registration/state-machine.js";
import type { RegistrationRecord } from "@cello-protocol/interfaces";

/**
 * DOD-TELEGRAM-GATE-1 clauses 1-4, at the state machine.
 *
 * The gate Lambda has been deployed and refusing correctly for hours; nothing
 * was asking it. These cover the asking — and specifically the two properties
 * that decide whether the gate is a gate at all: an unreachable gate must
 * refuse, and a refused user must not be asked for a phone number.
 */

function makeDeps(overrides: Record<string, unknown> = {}) {
  const record = { id: "reg-1", state: "INITIAL", channel: "telegram", channelUserId: "tg-1" } as unknown as RegistrationRecord;
  const repository = {
    // HONOURS THE STATE IT IS GIVEN, because the real repository does. The
    // previous fake returned a hardcoded INITIAL regardless, which is how a
    // change from insert-then-transition to insert-directly went unnoticed —
    // and, more seriously, why nothing here round-trips through
    // deserializeState (see repository-state-roundtrip.test.ts).
    insert: vi.fn().mockImplementation(async (row: { state?: string }) => ({
      ...record,
      state: row.state ?? "INITIAL",
    })),
    transition: vi.fn().mockImplementation(async (_id: string, state: string) => ({ ...record, state })),
  };
  const channel = { send: vi.fn().mockResolvedValue(undefined) };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return {
    repository, channel, logger,
    deps: { repository, channel, logger, otpDelivery: { send: vi.fn() }, preAuth: { requestToken: vi.fn() }, ...overrides } as never,
  };
}

const ADMITTED = { check: vi.fn(), redeem: vi.fn() };
const REFUSED = { check: vi.fn(), redeem: vi.fn() };

beforeEach(() => {
  ADMITTED.check.mockReset().mockResolvedValue({ allowed: true, alreadyLinked: true });
  REFUSED.check.mockReset().mockResolvedValue({
    allowed: false, error: "token_required",
    message: "This Telegram account is not linked to CELLO yet.",
  });
});

const gated = () => ({ id: "reg-1", state: "AWAITING_WAITLIST_TOKEN" }) as unknown as RegistrationRecord;

describe("first message — clauses 1 and 2", () => {
  it("an already-linked account proceeds straight to the contact prompt", async () => {
    const { deps, repository, channel } = makeDeps({ waitlistGate: ADMITTED });
    const out = await new RegistrationStateMachine(deps).handleNewUser("tg-1", "telegram", "hash");

    expect(out.state).toBe("AWAITING_CONTACT");
    // The gate was ASKED — without this the test passes with the gate removed
    // entirely, since the ungated path also reaches AWAITING_CONTACT. It pinned
    // the happy path and called it a gate test.
    expect(ADMITTED.check).toHaveBeenCalledWith("tg-1");
    expect(channel.send.mock.calls[0][1]).toContain("share your phone");
    // The symmetric half of the refused case below: an admitted account is
    // inserted DIRECTLY into AWAITING_CONTACT too. Neither branch passes
    // through INITIAL, so there is no window in which a crash leaves a record
    // in a state the gate has not yet ruled on.
    expect(repository.insert.mock.calls[0][0].state).toBe("AWAITING_CONTACT");
  });

  it("an unadmitted account is asked for a token and NOT for a phone number", async () => {
    // Ordering is the property. Asking a stranger for their phone number and
    // only then refusing collects PII from somebody never going to be admitted.
    const { deps, channel, repository } = makeDeps({ waitlistGate: REFUSED });
    const out = await new RegistrationStateMachine(deps).handleNewUser("tg-1", "telegram", "hash");

    expect(out.state).toBe("AWAITING_WAITLIST_TOKEN");
    // Inserted DIRECTLY into the gated state — never INITIAL, whose re-prompt
    // asks for a phone number. A crash between an insert and a transition would
    // otherwise strand a gated user in exactly that prompt for seven days.
    expect(repository.insert).toHaveBeenCalledWith(
      expect.objectContaining({ state: "AWAITING_WAITLIST_TOKEN" }),
    );
    expect(channel.send.mock.calls[0][1]).toContain("waitlist invitation token");
    expect(channel.send.mock.calls[0][1]).not.toContain("phone");
  });

  it("REFUSES rather than admits when the gate throws", async () => {
    const gate = { check: vi.fn().mockRejectedValue(new Error("gate unreachable")), redeem: vi.fn() };
    const { deps, repository } = makeDeps({ waitlistGate: gate });

    await expect(new RegistrationStateMachine(deps).handleNewUser("tg-1", "telegram", "hash")).rejects.toThrow(/unreachable/);
    expect(repository.transition).not.toHaveBeenCalledWith("reg-1", "AWAITING_CONTACT");
  });

  it("warns loudly when no gate is configured at all", async () => {
    const { deps, logger } = makeDeps();
    await new RegistrationStateMachine(deps).handleNewUser("tg-1", "telegram", "hash");

    expect(logger.warn).toHaveBeenCalledWith("registration.gate.NOT_ENFORCED", expect.any(Object));
  });
});

describe("token redemption — clauses 3 and 4", () => {
  it("a valid token admits the user and prompts for contact", async () => {
    const gate = { check: vi.fn(), redeem: vi.fn().mockResolvedValue({ redeemed: true }) };
    const { deps, channel } = makeDeps({ waitlistGate: gate });
    const out = await new RegistrationStateMachine(deps).handleMessage(gated(), "  TOKEN-123  ", "tg-1");

    expect(gate.redeem).toHaveBeenCalledWith("tg-1", "TOKEN-123");
    expect(out.state).toBe("AWAITING_CONTACT");
    expect(channel.send.mock.calls[0][1]).toContain("You're in");
  });

  it("a spent token keeps the user in the token state with the gate's own reason", async () => {
    // Not terminal: mistyping is the common case, and failing the registration
    // would force a restart over a typo. And the gate names four distinct
    // refusals — the user needs to know WHICH.
    const gate = {
      check: vi.fn(),
      redeem: vi.fn().mockResolvedValue({ redeemed: false, error: "token_already_used", message: "That token has already been used." }),
    };
    const { deps, repository, channel } = makeDeps({ waitlistGate: gate });
    const out = await new RegistrationStateMachine(deps).handleMessage(gated(), "SPENT", "tg-1");

    expect(out.state).toBe("AWAITING_WAITLIST_TOKEN");
    expect(repository.transition).not.toHaveBeenCalled();
    expect(channel.send.mock.calls[0][1]).toContain("already been used");
  });

  it("REFUSES rather than admits when the gate throws at redemption", async () => {
    const gate = { check: vi.fn(), redeem: vi.fn().mockRejectedValue(new Error("gate unreachable")) };
    const { deps, repository } = makeDeps({ waitlistGate: gate });

    await expect(new RegistrationStateMachine(deps).handleMessage(gated(), "T", "tg-1")).rejects.toThrow(/unreachable/);
    expect(repository.transition).not.toHaveBeenCalled();
  });

  it("an empty message re-prompts rather than burning anything", async () => {
    const gate = { check: vi.fn(), redeem: vi.fn() };
    const { deps, channel } = makeDeps({ waitlistGate: gate });
    await new RegistrationStateMachine(deps).handleMessage(gated(), "   ", "tg-1");

    expect(gate.redeem).not.toHaveBeenCalled();
    expect(channel.send.mock.calls[0][1]).toContain("send your waitlist invitation token");
  });
});


// ── The composition root ─────────────────────────────────────────────────────

describe("resolveAdapters selects a gate for every environment", () => {
  /**
   * This exists because the state machine tolerates a missing gate — it has to,
   * for the CLI adapter — which means "nobody wired it up" and "this
   * environment does not enforce the gate" look identical from inside. The
   * composition root is where that is decided, so it is where it is asserted.
   *
   * The bug this would have caught was real and lasted about ten minutes: the
   * state machine enforced the gate and server.ts did not supply one, so
   * production would have logged NOT_ENFORCED and admitted everybody.
   */
  it("gives a real, enforcing client to a non-local environment", async () => {
    const { resolveAdapters } = await import("../server.js");
    const { HttpWaitlistGateClient } = await import("../http-waitlist-gate-client.js");
    process.env["WAITLIST_SERVICE_URL"] = "https://api.cello.mygentic.ai";
    process.env["INTERNAL_INVOKE_TOKEN"] = "test-token";
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

    const adapters = resolveAdapters({
      env: "dev",
      logger: logger as never,
      telegramBotToken: "t",
      directoryApiKey: "k",
      directoryInternalUrl: "https://directory.test",
      sesCredentials: JSON.stringify({ accessKeyId: "a", secretAccessKey: "b", region: "us-east-1" }),
      sesFromAddress: "noreply@mygentic.ai",
    } as never);

    expect(adapters.waitlistGate).toBeInstanceOf(HttpWaitlistGateClient);
  });

  it("gives local the stub that admits everybody — and only local", async () => {
    const { resolveAdapters } = await import("../server.js");
    const { LocalWaitlistGateClient } = await import("@cello-protocol/interfaces/stubs");
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

    const adapters = resolveAdapters({ env: "local", logger: logger as never } as never);

    expect(adapters.waitlistGate).toBeInstanceOf(LocalWaitlistGateClient);
  });
});


describe("re-registration is gated too — clause 1 applies every time", () => {
  /**
   * The bypass this closes: `handleExistingUser` is the path for a user who
   * already completed a registration and comes back. It never consulted the
   * gate.
   *
   * For a legitimate returning user that changes nothing — they are still in
   * telegram_accounts, so the gate says yes. It matters when an account has been
   * REVOKED, which is what banning somebody means: removing them from
   * telegram_accounts. A kill switch a user can walk around by messaging the bot
   * again is not a kill switch.
   */
  it("a revoked account cannot re-register", async () => {
    const { deps, repository, channel } = makeDeps({ waitlistGate: REFUSED });
    const out = await new RegistrationStateMachine(deps).handleExistingUser("tg-1", "telegram", "hash", null);

    expect(out.state).toBe("AWAITING_WAITLIST_TOKEN");
    expect(repository.transition).not.toHaveBeenCalledWith("reg-1", "AWAITING_CONTACT");
    expect(channel.send.mock.calls[0][1]).toContain("no longer able to register");
  });

  it("a still-linked returning user is unaffected", async () => {
    const { deps } = makeDeps({ waitlistGate: ADMITTED });
    const out = await new RegistrationStateMachine(deps).handleExistingUser("tg-1", "telegram", "hash", null);

    expect(out.state).not.toBe("AWAITING_WAITLIST_TOKEN");
  });

  it("REFUSES rather than re-admits when the gate is unreachable", async () => {
    const gate = { check: vi.fn().mockRejectedValue(new Error("gate unreachable")), redeem: vi.fn() };
    const { deps } = makeDeps({ waitlistGate: gate });

    await expect(
      new RegistrationStateMachine(deps).handleExistingUser("tg-1", "telegram", "hash", null),
    ).rejects.toThrow(/unreachable/);
  });
});

describe("an unreachable gate (review finding F5) — the failure the user can see", () => {
  // Failing closed is correct. Failing closed SILENTLY is not: the client
  // throws on transport failure, the engine catches and logs, `onError` is
  // undefined in production (grep: it is wired in exactly one integration
  // test), and nothing is ever sent. The user messages the bot and receives
  // absolutely nothing — no error, no "try again", no record either, since the
  // throw happens before the insert. From their side the bot is simply dead,
  // and they have no way to tell that from being ignored.
  const UNREACHABLE = {
    check: vi.fn(async () => {
      throw new Error("The waitlist gate could not be reached (check).");
    }),
    redeem: vi.fn(async () => {
      throw new Error("The waitlist gate could not be reached (redeem).");
    }),
  };

  beforeEach(() => {
    UNREACHABLE.check.mockClear();
    UNREACHABLE.redeem.mockClear();
  });

  it("tells the user something went wrong, and still refuses", async () => {
    const { deps, channel, repository } = makeDeps({ waitlistGate: UNREACHABLE });

    await expect(
      new RegistrationStateMachine(deps).handleNewUser("tg-1", "telegram", "hash"),
    ).rejects.toThrow(/could not be reached/);

    // Still throws — the engine must still log it, and no record may be
    // created. Telling the user is ADDED to failing closed, not traded for it.
    expect(repository.insert).not.toHaveBeenCalled();

    const said = channel.send.mock.calls.map((c) => String(c[1])).join(" ");
    expect(said).not.toBe("");
    // And it must not be the refusal wording. "You are not invited" for what is
    // actually our outage is the same error substitution F2 fixed one layer
    // down — it sends the user to find a token that would not have helped.
    expect(said.toLowerCase()).not.toContain("token");
    expect(said.toLowerCase()).toContain("try again");
  });

  it("tells the user when redemption itself cannot reach the gate", async () => {
    const { deps, channel } = makeDeps({ waitlistGate: UNREACHABLE });

    await expect(
      new RegistrationStateMachine(deps).handleMessage(gated(), "SOME-TOKEN", "tg-1"),
    ).rejects.toThrow(/could not be reached/);

    const said = channel.send.mock.calls.map((c) => String(c[1])).join(" ");
    expect(said.toLowerCase()).toContain("try again");
    // Their token is untouched — worth saying, because a user told only "error"
    // reasonably assumes they have just burned their one token.
    expect(said.toLowerCase()).toContain("not been used");
  });
});

describe("redemption attempts are bounded (review finding F7)", () => {
  // Guessing is not the threat: a waitlist token is a `gen_random_uuid()`,
  // 122 bits. (Verified against the live gate: a 12-character code over the
  // referral alphabet comes back `token_malformed` — that alphabet belongs to
  // `referral_codes`, a different token on a different path.)
  //
  // The threat is that every inbound Telegram message in
  // this state cost one Lambda invocation and one query against the PORTAL
  // database, with no ceiling, driven by anyone who can message the bot.
  //
  // The bound is per channel-user and held in memory rather than on the
  // record. A per-record counter resets the moment the record does: five
  // refusals, FAILED, message again, five more — the rate is unchanged and you
  // have added a `check` call per cycle. In-memory is sound HERE specifically
  // because the ops-agent is a single global process (one instance long-polls
  // the one bot token — infra/CLAUDE.md, "Ops-Agent Is Single-Region"), so
  // there is no second replica holding a separate count.
  const REFUSING = {
    check: vi.fn(async () => ({ allowed: false, error: "token_required", message: "Token needed." })),
    redeem: vi.fn(async () => ({ redeemed: false, error: "unknown_token", message: "Unknown token." })),
  };

  beforeEach(() => {
    REFUSING.check.mockClear();
    REFUSING.redeem.mockClear();
  });

  it("stops asking the gate once a user has burned through their attempts", async () => {
    const { deps, channel } = makeDeps({ waitlistGate: REFUSING });
    const sm = new RegistrationStateMachine(deps);

    for (let i = 0; i < 12; i++) {
      await sm.handleMessage(gated(), `GUESS-${i}`, "tg-flood");
    }

    // The ceiling is enforced BEFORE the call, so the gate stops being invoked
    // entirely rather than being invoked and ignored.
    // toBe, not toBeLessThanOrEqual — the loose form admits a limit of one and
    // calls it a pass, which is not the constant the code declares.
    expect(REFUSING.redeem.mock.calls.length).toBe(5);

    const last = String(channel.send.mock.calls.at(-1)?.[1] ?? "");
    expect(last.toLowerCase()).toContain("too many");
  });

  it("counts per user — one flooder does not lock out anybody else", async () => {
    const { deps } = makeDeps({ waitlistGate: REFUSING });
    const sm = new RegistrationStateMachine(deps);

    for (let i = 0; i < 12; i++) {
      await sm.handleMessage(gated(), `GUESS-${i}`, "tg-flood");
    }
    const afterFlood = REFUSING.redeem.mock.calls.length;

    await sm.handleMessage(gated(), "SOMEBODY-ELSES-TOKEN", "tg-innocent");

    // A shared counter would be the obvious wrong implementation, and it would
    // hand any stranger a denial-of-service against every other user.
    expect(REFUSING.redeem.mock.calls.length).toBe(afterFlood + 1);

    // And the flooder is still blocked in the same breath. Without this the
    // test passes with NO limiter at all — it discriminated one wrong
    // implementation while counting as coverage of the feature.
    const before = REFUSING.redeem.mock.calls.length;
    await sm.handleMessage(gated(), "STILL-FLOODING", "tg-flood");
    expect(REFUSING.redeem.mock.calls.length).toBe(before);
  });

  it("the window actually expires — an hour later the allowance is back", async () => {
    // The replaced version of this test asserted `redeem` was called once after
    // one success, which passes with no limiter at all, and its name promised a
    // pruning property the code does not have (a success leaves the stamp in
    // place for the full hour). TOKEN_ATTEMPT_WINDOW_MS and the prune loop had
    // no test at all. This one advances the clock instead of describing it.
    vi.useFakeTimers();
    try {
      const { deps } = makeDeps({ waitlistGate: REFUSING });
      const sm = new RegistrationStateMachine(deps);

      for (let i = 0; i < 7; i++) await sm.handleMessage(gated(), `X-${i}`, "tg-clock");
      expect(REFUSING.redeem.mock.calls.length).toBe(5);

      vi.advanceTimersByTime(60 * 60 * 1_000 + 1_000);

      await sm.handleMessage(gated(), "AFTER-THE-HOUR", "tg-clock");
      expect(REFUSING.redeem.mock.calls.length).toBe(6);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("our outage must not spend the user's allowance", () => {
  // The limiter records the attempt BEFORE the call, which is right for
  // concurrency — a burst of messages cannot all pass the check while the
  // first gate call is still in flight. But it means a gate that THROWS also
  // consumes an attempt, and a throw is our fault, not theirs. Five outages
  // and a user with a perfectly good token is locked out for an hour, having
  // done nothing but retry exactly as our own message told them to.
  const BROKEN = {
    check: vi.fn(async () => ({ allowed: false, error: "token_required", message: "Token needed." })),
    redeem: vi.fn(async () => {
      throw new Error("The waitlist gate could not be reached (redeem).");
    }),
  };

  beforeEach(() => {
    BROKEN.check.mockClear();
    BROKEN.redeem.mockClear();
  });

  it("refunds the attempt when the gate throws", async () => {
    vi.useFakeTimers();
    const { deps } = makeDeps({ waitlistGate: BROKEN });
    const sm = new RegistrationStateMachine(deps);

    // Eight outages — more than the five-attempt ceiling. The clock advances
    // past the fault cooldown between them, which is what a real user does:
    // they were told to try again in a few minutes, and they do.
    for (let i = 0; i < 8; i++) {
      await expect(sm.handleMessage(gated(), `TOKEN-${i}`, "tg-unlucky")).rejects.toThrow();
      vi.advanceTimersByTime(61 * 1_000);
    }

    // Every one reached the gate. Without the refund the sixth onward would
    // have been refused locally and the count would stop at five.
    expect(BROKEN.redeem).toHaveBeenCalledTimes(8);
    vi.useRealTimers();
  });

  it("gives back exactly one attempt, not the whole record", async () => {
    // Wiping the user's history on a throw would pass the test above and
    // quietly destroy the ceiling: alternate one outage with one guess and the
    // count never reaches five. Verified as a mutation — replacing the refund
    // with `rest = []` left every other test in this file green.
    vi.useFakeTimers();
    let throwNext = false;
    const FLAKY = {
      check: vi.fn(async () => ({ allowed: true, alreadyLinked: false })),
      redeem: vi.fn(async () => {
        if (throwNext) throw new Error("The waitlist gate could not be reached (redeem).");
        return { redeemed: false, error: "unknown_token", message: "Unknown token." };
      }),
    };
    const { deps } = makeDeps({ waitlistGate: FLAKY });
    const sm = new RegistrationStateMachine(deps);

    // Three real refusals — three attempts spent.
    for (let i = 0; i < 3; i++) await sm.handleMessage(gated(), `A-${i}`, "tg-mix");

    // One outage in the middle, refunded.
    throwNext = true;
    await expect(sm.handleMessage(gated(), "OUTAGE", "tg-mix")).rejects.toThrow();
    throwNext = false;
    vi.advanceTimersByTime(61 * 1_000);

    // Two more refusals take them to exactly five.
    for (let i = 0; i < 2; i++) await sm.handleMessage(gated(), `B-${i}`, "tg-mix");
    const spent = FLAKY.redeem.mock.calls.length;

    // The sixth must be refused locally. Had the refund cleared the whole
    // record, the count would have restarted at the outage and this would
    // reach the gate again.
    await sm.handleMessage(gated(), "SIXTH", "tg-mix");
    expect(FLAKY.redeem.mock.calls.length).toBe(spent);
    vi.useRealTimers();
  });
});

describe("the seam between F5 and F7 — no test crossed it, which is why the bug shipped", () => {
  it("five outages then recovery: the sixth message still redeems", async () => {
    // Neither commit's tests looked here. An implementation that counts the
    // attempt only after a completed call passes every F7 test identically to
    // one that counts before and never releases — the difference is only
    // visible when a THROW is followed by a real attempt.
    vi.useFakeTimers();
    let broken = true;
    const RECOVERING = {
      check: vi.fn(async () => ({ allowed: true, alreadyLinked: false })),
      redeem: vi.fn(async () => {
        if (broken) throw new Error("The waitlist gate could not be reached (redeem).");
        return { redeemed: true };
      }),
    };
    const { deps } = makeDeps({ waitlistGate: RECOVERING });
    const sm = new RegistrationStateMachine(deps);

    for (let i = 0; i < 5; i++) {
      await expect(sm.handleMessage(gated(), `TRY-${i}`, "tg-patient")).rejects.toThrow();
      vi.advanceTimersByTime(61 * 1_000);
    }
    broken = false;

    await sm.handleMessage(gated(), "REAL-TOKEN", "tg-patient");
    expect(RECOVERING.redeem).toHaveBeenCalledTimes(6);
    vi.useRealTimers();
  });

  it("a broken CHECK does not become an unbounded invocation loop", async () => {
    // The cost bound covers `redeem` only, and `check` is the path that fails
    // OPEN on cost: when it throws, `repository.insert` never runs, so the user
    // has no record and every later message re-enters handleNewUser for another
    // check. Unbounded Lambda invocations and RDS connects, per user, exactly
    // while the gate is unhealthy — the moment the bound is supposed to matter.
    //
    // Charging their token allowance for it is the wrong answer (that is the
    // fairness bug above, in reverse). A short per-user cooldown after a fault
    // is the right one: we already told them "try again in a few minutes", so
    // repeating that without a second invocation costs the user nothing.
    const DOWN = {
      check: vi.fn(async () => {
        throw new Error("The waitlist gate could not be reached (check).");
      }),
      redeem: vi.fn(async () => ({ redeemed: false, error: "x", message: "x" })),
    };
    const { deps, channel } = makeDeps({ waitlistGate: DOWN });
    const sm = new RegistrationStateMachine(deps);

    for (let i = 0; i < 10; i++) {
      await expect(sm.handleNewUser("tg-storm", "telegram", "hash")).rejects.toThrow();
    }

    expect(DOWN.check.mock.calls.length).toBeLessThan(10);
    // Still fails closed on every one of the ten, and still tells them.
    expect(channel.send.mock.calls.length).toBe(10);
  });
});
