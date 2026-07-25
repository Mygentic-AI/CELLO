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
    insert: vi.fn().mockResolvedValue(record),
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
    expect(repository.transition).toHaveBeenCalledWith("reg-1", "AWAITING_CONTACT");
    expect(channel.send.mock.calls[0][1]).toContain("share your phone");
  });

  it("an unadmitted account is asked for a token and NOT for a phone number", async () => {
    // Ordering is the property. Asking a stranger for their phone number and
    // only then refusing collects PII from somebody never going to be admitted.
    const { deps, channel } = makeDeps({ waitlistGate: REFUSED });
    const out = await new RegistrationStateMachine(deps).handleNewUser("tg-1", "telegram", "hash");

    expect(out.state).toBe("AWAITING_WAITLIST_TOKEN");
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
    const { LambdaWaitlistGateClient } = await import("../waitlist-gate-client.js");
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

    expect(adapters.waitlistGate).toBeInstanceOf(LambdaWaitlistGateClient);
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
