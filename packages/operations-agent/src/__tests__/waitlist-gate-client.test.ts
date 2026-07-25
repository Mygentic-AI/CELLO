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
    const { gate } = clientReturning({ statusCode: 200, body: JSON.stringify({ allowed: true }) });

    await expect(gate.check("123")).resolves.toEqual({ allowed: true, alreadyLinked: true });
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
    // A 5xx is the gate FAILING, not the gate refusing. Only a 200 with
    // allowed:false is a refusal, and only that should reach the user as one.
    const { gate } = clientReturning({ statusCode: 502, body: JSON.stringify({}) });

    await expect(gate.check("123")).rejects.toThrow(/errored/);
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
    const sent = JSON.parse(Buffer.from(send.mock.calls[0][0].input.Payload).toString());
    expect(sent).toEqual({ telegram_id: "123", token: "TOKEN" });
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
