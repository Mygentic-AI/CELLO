/**
 * DOD-M15-SIGNUP-DURABLE-1 — the signup OTP limiter survives a deploy.
 *
 * `DOD-M15-SIGNUP-1` rekeyed the limiter from the email domain to the requester, which fixed the
 * half that hurt real people (five strangers sharing a mail provider no longer refused the sixth a
 * verification code). It left the counts in process memory, so the half that bites an abuser still
 * did not: every restart emptied the map, and the ops-agent deploy on 2026-08-09 wiped it exactly
 * that way. Waiting for a release was a shorter wait than the one-hour window being enforced.
 *
 * ─── Why this file exists ALONGSIDE engine.test.ts ────────────────────────────────────────────
 *
 * `engine.test.ts` already covers the limiter's KEY thoroughly — one requester capped across six
 * addresses, normalization buying nothing, requesters not affecting each other. Those tests are
 * better than what is here for that dimension, and none of them are duplicated.
 *
 * But that whole suite is `CELLO_ENV === "local" ? describe : describe.skip`, so it has never run
 * in any automated context (`DOD-M15-CI-SKIPS-SILENT-1` — the same milestone). Shipping a change to
 * the limiter whose only coverage is a suite that does not execute would be the exact shape this
 * milestone exists to close.
 *
 * So this file is UNCONDITIONAL and covers the one dimension Postgres is not needed for: does the
 * count come from durable storage, and does it survive the process. The fake repository below
 * stands in for the database, and a NEW state machine over the SAME repository is the restart.
 */

import { describe, it, expect } from "vitest";
import { RegistrationStateMachine, type StateMachineDeps } from "../registration/state-machine.js";
import type { RegistrationRecord, RegistrationRepository } from "../registration/repository.js";
import type { Logger } from "../registration/engine.js";

interface LogEvent {
  method: string;
  event: string;
  context: Record<string, unknown>;
}

function makeLogger(): { logger: Logger; events: LogEvent[] } {
  const events: LogEvent[] = [];
  const push = (method: string) => (event: string, context?: Record<string, unknown>) => {
    events.push({ method, event, context: context ?? {} });
  };
  return {
    logger: { debug: push("debug"), info: push("info"), warn: push("warn"), error: push("error") } as unknown as Logger,
    events,
  };
}

/**
 * The durable send log, standing in for V63 `otp_send_log`.
 *
 * Deliberately a real rolling store rather than a counter: the point under test is that the count
 * outlives the state machine, and a stub that returned a fixed number would prove nothing about
 * where the number came from.
 */
class FakeSendLog {
  readonly rows: Array<{ channel: string; user: string; at: number }> = [];
  /** Set to throw from the count, to exercise the fail-closed path. */
  failCount: Error | null = null;
  /** Set to throw from the record, to exercise the loud-but-non-fatal path. */
  failRecord: Error | null = null;

  countSince(channel: string, user: string, since: Date): number {
    if (this.failCount) throw this.failCount;
    return this.rows.filter((r) => r.channel === channel && r.user === user && r.at > since.getTime()).length;
  }

  record(channel: string, user: string, at: number): void {
    if (this.failRecord) throw this.failRecord;
    this.rows.push({ channel, user, at });
  }
}

const RECORD: RegistrationRecord = {
  id: "11111111-1111-1111-1111-111111111111",
  channel: "cli",
  channelUserId: "requester-1",
  state: "AWAITING_EMAIL",
} as unknown as RegistrationRecord;

/**
 * A state machine wired to `log`. Everything the email path touches is faked; nothing here reaches
 * a database or sends mail.
 */
function makeMachine(log: FakeSendLog, logger: Logger, sent: string[]) {
  const repository = {
    async countOtpSendsSince(channel: string, user: string, since: Date) {
      return log.countSince(channel, user, since);
    },
    async recordOtpSend(channel: string, user: string) {
      log.record(channel, user, Date.now());
    },
    async transition(_id: string, state: string) {
      return { ...RECORD, state } as unknown as RegistrationRecord;
    },
    async getStateDataField() {
      return null;
    },
  } as unknown as RegistrationRepository;

  const deps: StateMachineDeps = {
    repository,
    channel: { async send(_to: string, body: string) { sent.push(body); } } as unknown as StateMachineDeps["channel"],
    otpDelivery: { async sendOtp() { /* delivered */ } } as unknown as StateMachineDeps["otpDelivery"],
    preAuth: {} as unknown as StateMachineDeps["preAuth"],
    logger,
  };
  return new RegistrationStateMachine(deps);
}

/** Drive one "here is my email address" message through the OTP path. */
async function requestCode(machine: RegistrationStateMachine, email: string): Promise<void> {
  await machine.handleMessage(RECORD, email, RECORD.channelUserId);
}

const LIMIT = 5;

describe("DOD-M15-SIGNUP-DURABLE-1: the OTP limiter reads from durable storage", () => {
  it("counts sends that a PREVIOUS process recorded — a deploy no longer clears the limit", async () => {
    const log = new FakeSendLog();
    const { logger, events } = makeLogger();
    const sent: string[] = [];

    // Process 1 spends the whole allowance.
    const before = makeMachine(log, logger, sent);
    for (let i = 0; i < LIMIT; i++) await requestCode(before, `victim${i}@example.test`);
    expect(log.rows.length, "five successful sends must be on record").toBe(LIMIT);
    expect(
      events.find((e) => e.event === "registration.otp.rate_limited"),
      "the fifth send is inside the allowance and must not be refused",
    ).toBeUndefined();

    // ── the deploy ──
    // A brand-new state machine. Under the in-memory limiter this was a fresh allowance, which is
    // precisely how an abuser cleared their count: wait for a release.
    const after = makeMachine(log, logger, sent);
    await requestCode(after, "victim5@example.test");

    const limited = events.find((e) => e.event === "registration.otp.rate_limited");
    expect(limited, "the sixth request must be refused even though the process restarted").toBeDefined();
    expect(limited?.method).toBe("warn");
    // MEASURED, not the constant — a hardcoded field can never disagree with the limit it reports.
    expect(limited?.context["sendCount"]).toBe(LIMIT);
    // No new row: a refused request is not a send.
    expect(log.rows.length, "a refused request must not be recorded as a send").toBe(LIMIT);
  });

  it("keys the durable rows on the REQUESTER, so a second person is unaffected", async () => {
    // The design DOD-M15-SIGNUP-1's review settled, re-asserted at the storage layer: a table keyed
    // on the address (or its domain) would rebuild the defect one level down, where it is harder to
    // see. Distinct users, distinct budgets.
    const log = new FakeSendLog();
    const { logger, events } = makeLogger();
    const machine = makeMachine(log, logger, []);

    for (let i = 0; i < LIMIT; i++) await requestCode(machine, `victim${i}@example.test`);

    const other = { ...RECORD, id: "22222222-2222-2222-2222-222222222222", channelUserId: "requester-2" };
    await machine.handleMessage(other as RegistrationRecord, "someone@example.test", "requester-2");

    expect(
      events.find((e) => e.event === "registration.otp.rate_limited"),
      "a different requester must get their own allowance",
    ).toBeUndefined();
    expect(log.countSince("cli", "requester-2", new Date(0))).toBe(1);
  });

  it("only rows a send that SUCCEEDED — a delivery failure does not spend the allowance", async () => {
    // Keyed on the requester, charging them for our delivery failure locks one person out for an
    // hour having never received a code.
    const log = new FakeSendLog();
    const { logger } = makeLogger();
    const sent: string[] = [];
    const repository = {
      async countOtpSendsSince(c: string, u: string, s: Date) { return log.countSince(c, u, s); },
      async recordOtpSend(c: string, u: string) { log.record(c, u, Date.now()); },
      async transition(_id: string, state: string) { return { ...RECORD, state } as unknown as RegistrationRecord; },
      async getStateDataField() { return null; },
    } as unknown as RegistrationRepository;

    const machine = new RegistrationStateMachine({
      repository,
      channel: { async send(_t: string, b: string) { sent.push(b); } } as unknown as StateMachineDeps["channel"],
      otpDelivery: { async sendOtp() { throw new Error("SES throttled"); } } as unknown as StateMachineDeps["otpDelivery"],
      preAuth: {} as unknown as StateMachineDeps["preAuth"],
      logger,
    });

    await requestCode(machine, "victim@example.test");
    expect(log.rows.length, "a failed delivery must not be recorded as a send").toBe(0);
  });

  it("FAILS CLOSED when the send log cannot be read, rather than granting a fresh allowance", async () => {
    // A limiter that answers "0" when it cannot see is not a limiter. This costs nothing it did not
    // already cost: the log shares a database with `registrations` itself, so a database that
    // cannot answer this cannot store the registration either.
    const log = new FakeSendLog();
    log.failCount = new Error("connection terminated unexpectedly");
    const { logger } = makeLogger();
    const machine = makeMachine(log, logger, []);

    await expect(requestCode(machine, "victim@example.test")).rejects.toThrow(/connection terminated/);
    expect(log.rows.length, "nothing may be sent when the allowance cannot be established").toBe(0);
  });

  it("is LOUD, and does not fail the request, when a delivered code cannot be recorded", async () => {
    // The person already has their code; turning our bookkeeping failure into a visible error for
    // someone who was served correctly helps nobody. But it must not be silent — an unrecorded send
    // means the limiter is under-counting, which is a security control quietly not working.
    const log = new FakeSendLog();
    log.failRecord = new Error("relation \"otp_send_log\" does not exist");
    const { logger, events } = makeLogger();
    const machine = makeMachine(log, logger, []);

    await requestCode(machine, "victim@example.test");

    const notRecorded = events.find((e) => e.event === "registration.otp.send_not_recorded");
    expect(notRecorded, "an unrecorded send must be reported").toBeDefined();
    expect(notRecorded?.method).toBe("error");
    expect(String(notRecorded?.context["impact"])).toContain("under-counted");
    expect(String(notRecorded?.context["guidance"])).toContain("V63");
  });
});
