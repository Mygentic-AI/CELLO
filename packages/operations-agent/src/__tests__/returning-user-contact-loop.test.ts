import { describe, expect, it, vi } from "vitest";
import { RegistrationStateMachine } from "../registration/state-machine.js";
import type { RegistrationRecord } from "@cello-protocol/interfaces";

/**
 * DOD-M12-REREG-1 — a returning user adding a second agent must get past the contact prompt.
 *
 * THE BUG THIS PINS
 *
 * `handleExistingUser` inserted the registration in INITIAL under a comment promising it would
 * "immediately transition to AWAITING_CONTACT", then did `const awaitingRecord = record` and
 * returned it. The transition was never written — only the variable name implied it.
 *
 * INITIAL is a transient state, and its handler in `handleMessage` re-prompts for contact. So the
 * returning user shared their phone number, the machine answered "Please share your phone number
 * using the button below", and it did that every time, forever. Adding a second agent to an
 * existing account was impossible.
 *
 * WHY THE EXISTING TESTS MISSED IT
 *
 * They asserted on records they constructed themselves in AWAITING_CONTACT, rather than on the
 * record `handleExistingUser` actually returns — so the one field that was wrong was the one field
 * never read. In production it was masked further: on AWS the gate refused re-registration before
 * this code ran, so the loop only became reachable once the gate was disabled.
 *
 * So these tests do the thing the old ones did not: take the REAL returned record and feed it
 * straight into `handleMessage`, the way the engine does.
 */

function makeDeps() {
  const base = { id: "reg-1", channel: "telegram", channelUserId: "tg-1" } as unknown as RegistrationRecord;
  const repository = {
    // Honours the state it is given, like the real repository — a fake that hardcoded INITIAL is
    // what let insert-then-transition drift into insert-only unnoticed.
    insert: vi.fn().mockImplementation(async (row: { state?: string }) => ({ ...base, state: row.state ?? "INITIAL" })),
    transition: vi.fn().mockImplementation(async (_id: string, state: string) => ({ ...base, state })),
    getStateDataField: vi.fn().mockResolvedValue(null),
  };
  const channel = { send: vi.fn().mockResolvedValue(undefined) };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return {
    repository,
    channel,
    logger,
    deps: {
      repository,
      channel,
      logger,
      otpDelivery: { send: vi.fn().mockResolvedValue(undefined) },
      preAuth: { requestToken: vi.fn() },
      // No gate: this is the configuration the loop is reachable under, and the one running now.
    } as never,
  };
}

const RE_PROMPT = "Please share your phone number using the button below";

describe("DOD-M12-REREG-1 — returning user, second agent", () => {
  it("handleExistingUser returns AWAITING_CONTACT, not a transient state", async () => {
    const { deps } = makeDeps();
    const out = await new RegistrationStateMachine(deps).handleExistingUser("tg-1", "telegram", "hash", null);

    // INITIAL was the bug. Assert the destination, and assert it is not transient, because any
    // transient state re-prompts and reproduces the loop.
    expect(out.state).toBe("AWAITING_CONTACT");
    expect(["INITIAL", "PHONE_CONFIRMED"]).not.toContain(out.state);
  });

  it("the returned record accepts a shared contact instead of re-prompting for it", async () => {
    const { deps, channel } = makeDeps();
    const machine = new RegistrationStateMachine(deps);

    const started = await machine.handleExistingUser("tg-1", "telegram", "hash", null);
    expect(channel.send.mock.calls[0][1]).toContain("Welcome back to CELLO");

    // THE USER-VISIBLE BUG, reproduced exactly: hand the returned record straight back with a
    // shared contact, as the engine does.
    const after = await machine.handleMessage(started, "CONTACT:tg-1:+971585089156", "tg-1");

    const replies = channel.send.mock.calls.map((c) => String(c[1]));
    expect(replies.some((m) => m.includes(RE_PROMPT))).toBe(false);
    expect(after.state).not.toBe("AWAITING_CONTACT");
  });

  it("sharing the contact twice does not restart the ask", async () => {
    // Andre shared it twice and got the same re-prompt both times; the second share is the natural
    // human reaction to the first being ignored, so it must not itself become a way to loop.
    const { deps, channel } = makeDeps();
    const machine = new RegistrationStateMachine(deps);

    const started = await machine.handleExistingUser("tg-1", "telegram", "hash", null);
    await machine.handleMessage(started, "CONTACT:tg-1:+971585089156", "tg-1");
    await machine.handleMessage(started, "CONTACT:tg-1:+971585089156", "tg-1");

    const reprompts = channel.send.mock.calls.map((c) => String(c[1])).filter((m) => m.includes(RE_PROMPT));
    expect(reprompts).toHaveLength(0);
  });

  it("still records the expected email hash for continuity", async () => {
    // The state data write rode on the INITIAL→INITIAL transition. Moving the insert to
    // AWAITING_CONTACT must not drop it, or returning users lose email-continuity enforcement.
    const { deps, repository } = makeDeps();
    await new RegistrationStateMachine(deps).handleExistingUser("tg-1", "telegram", "hash", "email-hash-abc");

    expect(repository.transition).toHaveBeenCalledWith("reg-1", "AWAITING_CONTACT", {
      stateData: { expectedEmailStubHash: "email-hash-abc" },
    });
  });
});
