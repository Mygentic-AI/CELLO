import { describe, expect, it, vi } from "vitest";
import { LambdaWaitlistGateClient } from "../waitlist-gate-client.js";
import type { Logger } from "@cello-protocol/interfaces";

/**
 * DOD-TELEGRAM-GATE-1, the half that decides who reaches DKG.
 *
 * Every test here is about the same property: **the gate must never admit
 * because it could not check.** An unreachable gate is indistinguishable from
 * one that would have refused, so a Lambda outage admitting everybody who
 * messages the bot is the exact failure the two-door design exists to prevent.
 */

const logger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as unknown as Logger;

function clientReturning(payload: unknown, extra: Record<string, unknown> = {}) {
  const send = vi.fn().mockResolvedValue({
    Payload: Buffer.from(typeof payload === "string" ? payload : JSON.stringify(payload)),
    ...extra,
  });
  return {
    send,
    gate: new LambdaWaitlistGateClient({
      region: "us-east-1",
      functionName: "cello-waitlist-gate-test",
      logger,
      client: { send } as never,
    }),
  };
}

describe("check", () => {
  it("admits an account the gate says is linked", async () => {
    const { gate } = clientReturning({
      statusCode: 200,
      body: JSON.stringify({ allowed: true, reason: "already_linked" }),
    });

    await expect(gate.check("123")).resolves.toEqual({ allowed: true, alreadyLinked: true });
  });

  it("does not claim alreadyLinked when the gate did not say so", async () => {
    // It used to return alreadyLinked:true unconditionally — asserting something
    // it had not checked, on a field nothing read.
    const { gate } = clientReturning({
      statusCode: 200,
      body: JSON.stringify({ allowed: true, reason: "token_burned" }),
    });

    await expect(gate.check("123")).resolves.toEqual({ allowed: true, alreadyLinked: false });
  });

  it("passes the gate's own refusal wording through unchanged", async () => {
    // The gate names four distinct refusals. Re-wording them here would flatten
    // four causes into one, on the screen of somebody trying to join.
    const { gate } = clientReturning({
      statusCode: 200,
      body: JSON.stringify({
        allowed: false,
        error: "token_required",
        message: "This Telegram account is not linked to CELLO yet.",
      }),
    });

    await expect(gate.check("123")).resolves.toEqual({
      allowed: false,
      error: "token_required",
      message: "This Telegram account is not linked to CELLO yet.",
    });
  });

  it("REFUSES rather than admits when the gate cannot be reached", async () => {
    const send = vi.fn().mockRejectedValue(new Error("ETIMEDOUT"));
    const gate = new LambdaWaitlistGateClient({
      region: "us-east-1",
      functionName: "f",
      logger,
      client: { send } as never,
    });

    await expect(gate.check("123")).rejects.toThrow(/could not be reached/);
  });

  it("REFUSES when the function itself threw", async () => {
    const { gate } = clientReturning("{}", { FunctionError: "Unhandled" });

    await expect(gate.check("123")).rejects.toThrow(/failed/);
  });

  it("REFUSES when the gate returns a 5xx", async () => {
    // A 5xx is the gate FAILING, not the gate refusing. Only a 200 carrying a
    // boolean `allowed` is a decision, and only that reaches the user as one.
    const { gate } = clientReturning({ statusCode: 502, body: JSON.stringify({}) });

    await expect(gate.check("123")).rejects.toThrow(/did not return a decision/);
  });

  it("REFUSES when the response is unparseable", async () => {
    const { gate } = clientReturning("not json at all");

    await expect(gate.check("123")).rejects.toThrow(/unreadable/);
  });
});

describe("redeem", () => {
  it("reports a burned token as redeemed", async () => {
    const { gate, send } = clientReturning({ statusCode: 200, body: JSON.stringify({ allowed: true }) });

    await expect(gate.redeem("123", "TOKEN")).resolves.toEqual({ redeemed: true });
    // A SUBSET assertion, deliberately. The previous exact-equality version
    // codified the ABSENCE of agent_pubkey as correct — clause 4 of the DoD
    // asks the gate to write waitlist_agent_links, and it cannot without one.
    // That is parked as a design fork (the pubkey does not exist at burn time),
    // and a test asserting the payload is exactly two keys would have to be
    // edited to un-park it, which is the wrong direction of friction.
    const sent = JSON.parse(Buffer.from(send.mock.calls[0][0].input.Payload).toString());
    expect(sent).toMatchObject({ telegram_id: "123", token: "TOKEN" });
  });

  it("passes a spent-token refusal through with its cause", async () => {
    const { gate } = clientReturning({
      statusCode: 200,
      body: JSON.stringify({
        allowed: false,
        error: "token_already_used",
        message: "That token has already been used.",
      }),
    });

    await expect(gate.redeem("123", "T")).resolves.toEqual({
      redeemed: false,
      error: "token_already_used",
      message: "That token has already been used.",
    });
  });

  it("REFUSES rather than redeems when the gate cannot be reached", async () => {
    const send = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    const gate = new LambdaWaitlistGateClient({
      region: "us-east-1",
      functionName: "f",
      logger,
      client: { send } as never,
    });

    await expect(gate.redeem("123", "T")).rejects.toThrow(/could not be reached/);
  });
});

describe("a fault is not a refusal", () => {
  it("a 409 with no `allowed` key THROWS rather than refusing", async () => {
    // The Lambda returns 409 constraint_violation with no `allowed` key ON
    // PURPOSE, so it cannot be read as an answer. Read as one, a database
    // integrity fault reaches the user as "you are not invited" and is logged at
    // INFO as token_required — pointing the operator at the waitlist instead of
    // the database. The Lambda engineered against exactly this; the client
    // defeated it one hop later.
    const { gate } = clientReturning({
      statusCode: 409,
      body: JSON.stringify({ error: "constraint_violation", message: "That conflicts with data already stored." }),
    });

    await expect(gate.check("123")).rejects.toThrow(/did not return a decision/);
  });

  it("a 200 whose body has no `allowed` key THROWS", async () => {
    const { gate } = clientReturning({ statusCode: 200, body: JSON.stringify({ ok: true }) });

    await expect(gate.check("123")).rejects.toThrow(/did not return a decision/);
  });
});
