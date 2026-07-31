/**
 * M12 — the waitlist gate is an explicit OPT-OUT, never an accident.
 *
 * The gate refuses registration when it cannot be reached, which is correct and is why it blocks
 * everything on GCP: it is an AWS Lambda backed by the portal RDS, and with AWS hibernated it
 * cannot answer. Gating admission to an EMPTY, unlaunched waitlist while blocking the only person
 * who needs to register protects nothing and costs everything.
 *
 * So it can be turned off — but the shape matters more than the switch. Absent, empty, misspelled or
 * any other value must leave the gate ON, because the failure mode of an opt-IN flag is that a
 * missing variable silently admits the world. Only the exact string "disabled" disables it, and it
 * says so at warn on every boot.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resolveAdapters } from "../server.js";

const BASE = {
  env: "dev" as const,
  telegramBotToken: "123:fake",
  sesCredentials: { accessKeyId: "AKIA", secretAccessKey: "s" },
  sesFromAddress: "no-reply@example.com",
  sesRegion: "us-east-1",
  directoryInternalUrl: "http://10.0.0.1:8081",
  directoryApiKey: "k",
};

function loggerSpy() {
  const calls: Array<{ level: string; event: string }> = [];
  const at = (level: string) => (event: string) => calls.push({ level, event });
  return { calls, info: at("info"), warn: at("warn"), error: at("error"), debug: at("debug") };
}

let saved: string | undefined;
beforeEach(() => { saved = process.env["WAITLIST_GATE"]; delete process.env["WAITLIST_GATE"]; });
afterEach(() => { if (saved === undefined) delete process.env["WAITLIST_GATE"]; else process.env["WAITLIST_GATE"] = saved; });

describe("the waitlist gate opt-out", () => {
  it("is ON when the variable is absent — the default must never admit", () => {
    const logger = loggerSpy();
    const a = resolveAdapters({ ...BASE, logger } as never);
    expect(a.waitlistGate, "no variable must mean admission IS checked").toBeDefined();
  });

  it.each(["", "false", "0", "DISABLED", "disable", "off", "no"])(
    "is ON for %o — only the exact string disables it",
    (v) => {
      // The failure mode being prevented: a well-meaning `WAITLIST_GATE=off` that reads as disabled
      // to a human and enabled to the code, or the reverse. One spelling, and it is the strict one.
      process.env["WAITLIST_GATE"] = v;
      const a = resolveAdapters({ ...BASE, logger: loggerSpy() } as never);
      expect(a.waitlistGate).toBeDefined();
    },
  );

  it("is OFF for exactly 'disabled', and SAYS SO at warn", () => {
    const logger = loggerSpy();
    process.env["WAITLIST_GATE"] = "disabled";
    const a = resolveAdapters({ ...BASE, logger } as never);

    expect(a.waitlistGate, "the engine reads undefined as 'no admission check'").toBeUndefined();
    const warned = logger.calls.find((c) => c.event === "ops_agent.waitlist_gate.disabled");
    expect(warned, "a disabled admission check that logs nothing is indistinguishable from a bug").toBeDefined();
    expect(warned?.level).toBe("warn");
  });

  it("leaves the other adapters untouched either way", () => {
    // The switch must not become a general escape hatch — turning off admission should not quietly
    // change how anything else is built.
    const on = resolveAdapters({ ...BASE, logger: loggerSpy() } as never);
    process.env["WAITLIST_GATE"] = "disabled";
    const off = resolveAdapters({ ...BASE, logger: loggerSpy() } as never);

    for (const k of ["channel", "otpDelivery", "preAuth", "channelType"] as const) {
      expect(typeof (off as Record<string, unknown>)[k]).toBe(typeof (on as Record<string, unknown>)[k]);
    }
    expect(off.channelType).toBe(on.channelType);
  });
});
