/**
 * dod-m15-contactnag-1.test.ts — the AWAITING_CONTACT re-prompt must be BOUNDED.
 *
 * THE DEFECT THIS PINS, observed in production 2026-08-31/09-01.
 *
 * A registration that reached AWAITING_CONTACT and stayed there was re-prompted every ten minutes
 * FOREVER. Andre typed CONFIRM at 20:16 UTC, went to bed, and woke to **57 identical** "Please share
 * your phone number using the button below to continue registration." messages — 573 minutes elapsed
 * divided by the ten-minute sweep, exactly. Six an hour, 144 a day, with no terminating condition.
 *
 * It could not stop, and that was structural rather than accidental: `resendContactPrompt` reset
 * `expires_at` to `now + 7 days` on EVERY prompt ("Refreshes updatedAt to prevent 7-day expiry"), so
 * the expiry sweep — the only mechanism that could ever have retired the record — could never see
 * it. The nagging reset the one clock capable of ending the nagging. The record grew ten minutes
 * younger every ten minutes.
 *
 * Nothing was logged for any of the 57 sends, so none of this was visible from the logs; it was
 * found by dividing 573 by 10.
 *
 * THE AGREED POLICY (Andre, 2026-09-01):
 *   1. At most TWO automated reminders per cycle — the first 10 minutes after the cycle starts, the
 *      second 60 minutes after that. Then silence.
 *   2. An automated reminder NEVER extends the expiry clock. A stalled registration dies on
 *      schedule, whatever else breaks.
 *   3. Sharing the phone number REMAINS MANDATORY. The registration stays open and completable —
 *      only the nudging is bounded. Nothing is cancelled and no dead end is introduced.
 *   4. If the user sends another message without sharing contact, the cycle RESTARTS: they get an
 *      immediate prompt and a fresh pair of reminders.
 *
 * Restart safety is load-bearing. The engine reloads every active record from the database on
 * startup, so an in-memory counter would reset the cycle on every deploy or Cloud Run instance
 * recycle and resume the loop forever. The counter is therefore durable, in `state_data`.
 *
 * Tests use real Postgres (describeIntegration) — no mock DB.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import pg from "pg";
import { RegistrationEngine } from "../registration/engine.js";
import { RegistrationRepository } from "../registration/repository.js";
import type {
  Logger,
  MessagingChannel,
  OtpDeliveryProvider,
  ChannelIdentity,
} from "@cello-protocol/interfaces";
import { LocalPreAuthorizationClient } from "@cello-protocol/interfaces/stubs";

const isLocal = process.env["CELLO_ENV"] === "local";
const describeIntegration = isLocal ? describe : describe.skip;

const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgresql://postgres:dev@localhost:5433/cello_dev";

const OPS_AGENT_URL = DATABASE_URL.replace(
  /^(postgres(?:ql)?):\/\/[^:]+:[^@]+@/,
  "$1://cello_ops_agent:cello_ops_agent_dev@",
);

// ─── Test doubles ─────────────────────────────────────────────────────────────

function makeTestLogger(): {
  logger: Logger;
  events: Array<{ event: string; context?: Record<string, unknown> }>;
} {
  const events: Array<{ event: string; context?: Record<string, unknown> }> = [];
  const logger: Logger = {
    debug: (event, context) => events.push({ event, context: context as Record<string, unknown> }),
    info: (event, context) => events.push({ event, context: context as Record<string, unknown> }),
    warn: (event, context) => events.push({ event, context: context as Record<string, unknown> }),
    error: (event, _e, context) => events.push({ event, context: context as Record<string, unknown> }),
  };
  return { logger, events };
}

type SentMessage = { to: string; message: string };

function makeTestChannel(): {
  channel: MessagingChannel;
  sent: SentMessage[];
  injectMessage: (from: string, message: string) => Promise<void>;
} {
  const sent: SentMessage[] = [];
  let handler: ((from: string, message: string) => void | Promise<void>) | undefined;

  const channel: MessagingChannel = {
    async send(to: string, message: string): Promise<void> {
      sent.push({ to, message });
    },
    onMessage(h): void {
      handler = h;
    },
    async resolveIdentity(from: string): Promise<ChannelIdentity> {
      return { channel: "cli", channelUserId: from };
    },
  };

  async function injectMessage(from: string, message: string): Promise<void> {
    if (handler) await handler(from, message);
  }

  return { channel, sent, injectMessage };
}

function makeTestOtpDelivery(): OtpDeliveryProvider {
  return { async sendOtp(): Promise<void> {} };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * The sweep walks EVERY active record in the database, so a shared dev database means other tests'
 * leftovers land in the same `sent` array. Both helpers scope to the user under test — without
 * that, twelve sweeps produced 301 messages here and the counts meant nothing.
 */
function sentTo(sent: SentMessage[], to: string): SentMessage[] {
  return sent.filter((m) => m.to === to);
}

/** Every message sent to this user that is an AUTOMATED reminder (not the initial ask). */
function reminders(sent: SentMessage[], to: string): SentMessage[] {
  return sentTo(sent, to).filter(
    (m) => m.message.includes("Still waiting on your phone number") || m.message.includes("Last reminder"),
  );
}

/**
 * Age the reminder cycle by rewriting its durable timestamp, so a sweep sees the delay as elapsed
 * without the test sleeping for an hour. Writes the same shape the production code writes.
 */
async function ageContactPromptCycle(pool: pg.Pool, id: string, minutesAgo: number): Promise<void> {
  const lastAt = new Date(Date.now() - minutesAgo * 60_000).toISOString();
  await pool.query(
    `UPDATE registrations
       SET state_data = state_data || jsonb_build_object(
         'contactPrompt',
         COALESCE(state_data->'contactPrompt', '{"count":0}'::jsonb) || jsonb_build_object('lastAt', $2::text)
       )
     WHERE id = $1`,
    [id, lastAt],
  );
}

async function contactPromptCount(pool: pg.Pool, id: string): Promise<number> {
  const r = await pool.query<{ count: number | null }>(
    `SELECT (state_data->'contactPrompt'->>'count')::int AS count FROM registrations WHERE id = $1`,
    [id],
  );
  return r.rows[0]?.count ?? 0;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describeIntegration("DOD-M15-CONTACTNAG-1: the AWAITING_CONTACT re-prompt is bounded", () => {
  let pool: pg.Pool;
  let engine: RegistrationEngine;
  let loggerState: ReturnType<typeof makeTestLogger>;
  let channelState: ReturnType<typeof makeTestChannel>;
  let userId: string;

  function buildEngine(): RegistrationEngine {
    return new RegistrationEngine({
      pool,
      channel: channelState.channel,
      otpDelivery: makeTestOtpDelivery(),
      preAuth: new LocalPreAuthorizationClient(),
      logger: loggerState.logger,
      channelType: "cli",
      onError: (err) => {
        throw err;
      },
    });
  }

  beforeEach(async () => {
    pool = new pg.Pool({ connectionString: OPS_AGENT_URL });
    loggerState = makeTestLogger();
    channelState = makeTestChannel();
    userId = `nag-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    engine = buildEngine();
    await engine.start();
  });

  afterEach(async () => {
    engine.stop();
    try {
      const repo = new RegistrationRepository(pool);
      const active = await repo.findActiveByChannelUser("cli", userId);
      if (active) await repo.transition(active.id, "EXPIRED");
    } catch {
      /* ignore cleanup errors */
    }
    await pool.end();
  });

  it("sends at most TWO reminders and then goes silent, however many sweeps run", async () => {
    await channelState.injectMessage(userId, "hello");
    const repo = new RegistrationRepository(pool);
    const record = (await repo.findActiveByChannelUser("cli", userId))!;

    // Twelve sweeps, each with the full delay elapsed. The old code sent twelve prompts.
    for (let i = 0; i < 12; i++) {
      await ageContactPromptCycle(pool, record.id, 120);
      await engine.triggerContactPromptSweep();
    }

    // Counted on TOTAL outbound volume, not just on the new wording — this is the assertion that
    // fails loudly if the bound is ever reverted (the old code reaches 13 here).
    expect(sentTo(channelState.sent, userId)).toHaveLength(3); // the initial ask + exactly two reminders
    expect(reminders(channelState.sent, userId)).toHaveLength(2);
    expect(reminders(channelState.sent, userId)[0].message).toContain("Still waiting on your phone number");
    expect(reminders(channelState.sent, userId)[1].message).toContain("Last reminder");

    // And the registration is still open — the phone number remains required and providable.
    const after = await repo.findActiveByChannelUser("cli", userId);
    expect(after?.state).toBe("AWAITING_CONTACT");
  });

  it("a reminder NEVER extends the expiry clock — the record still dies on schedule", async () => {
    await channelState.injectMessage(userId, "hello");
    const repo = new RegistrationRepository(pool);
    const before = (await repo.findActiveByChannelUser("cli", userId))!;

    for (let i = 0; i < 3; i++) {
      await ageContactPromptCycle(pool, before.id, 120);
      await engine.triggerContactPromptSweep();
    }

    const after = (await repo.findActiveByChannelUser("cli", userId))!;
    expect(after.expiresAt.getTime()).toBe(before.expiresAt.getTime());
  });

  it("holds the bound across a restart — the counter is durable, not in memory", async () => {
    await channelState.injectMessage(userId, "hello");
    const repo = new RegistrationRepository(pool);
    const record = (await repo.findActiveByChannelUser("cli", userId))!;

    for (let i = 0; i < 2; i++) {
      await ageContactPromptCycle(pool, record.id, 120);
      await engine.triggerContactPromptSweep();
    }
    expect(reminders(channelState.sent, userId)).toHaveLength(2);

    // Restart: a fresh engine reloads every active record from the database.
    engine.stop();
    engine = buildEngine();
    await engine.start();

    for (let i = 0; i < 3; i++) {
      await ageContactPromptCycle(pool, record.id, 120);
      await engine.triggerContactPromptSweep();
    }

    expect(reminders(channelState.sent, userId)).toHaveLength(2);
  });

  it("does not remind before the delay has elapsed", async () => {
    await channelState.injectMessage(userId, "hello");
    const repo = new RegistrationRepository(pool);
    const record = (await repo.findActiveByChannelUser("cli", userId))!;

    // 5 minutes in — too early for the first reminder (10 min). Asserted on total volume so that
    // "sent nothing" cannot be satisfied by sending the OLD prompt wording.
    await ageContactPromptCycle(pool, record.id, 5);
    await engine.triggerContactPromptSweep();
    expect(sentTo(channelState.sent, userId)).toHaveLength(1); // the initial ask, and nothing since
    expect(reminders(channelState.sent, userId)).toHaveLength(0);

    // 10 minutes in — the first is due.
    await ageContactPromptCycle(pool, record.id, 10);
    await engine.triggerContactPromptSweep();
    expect(reminders(channelState.sent, userId)).toHaveLength(1);

    // 30 minutes since the first — too early for the second (60 min).
    await ageContactPromptCycle(pool, record.id, 30);
    await engine.triggerContactPromptSweep();
    expect(reminders(channelState.sent, userId)).toHaveLength(1);

    // 60 minutes since the first — the second is due.
    await ageContactPromptCycle(pool, record.id, 60);
    await engine.triggerContactPromptSweep();
    expect(reminders(channelState.sent, userId)).toHaveLength(2);
  });

  it("restarts the cycle when the user messages again without sharing contact", async () => {
    await channelState.injectMessage(userId, "hello");
    const repo = new RegistrationRepository(pool);
    const record = (await repo.findActiveByChannelUser("cli", userId))!;

    for (let i = 0; i < 4; i++) {
      await ageContactPromptCycle(pool, record.id, 120);
      await engine.triggerContactPromptSweep();
    }
    expect(reminders(channelState.sent, userId)).toHaveLength(2);

    // The user speaks again without sharing contact — they get an immediate prompt, and the
    // reminder budget is restored.
    await channelState.injectMessage(userId, "sorry, what do you need?");
    expect(await contactPromptCount(pool, record.id)).toBe(0);

    await ageContactPromptCycle(pool, record.id, 120);
    await engine.triggerContactPromptSweep();
    expect(reminders(channelState.sent, userId)).toHaveLength(3);

    await ageContactPromptCycle(pool, record.id, 120);
    await engine.triggerContactPromptSweep();
    expect(reminders(channelState.sent, userId)).toHaveLength(4);

    // ...and then silent again.
    await ageContactPromptCycle(pool, record.id, 120);
    await engine.triggerContactPromptSweep();
    expect(reminders(channelState.sent, userId)).toHaveLength(4);
  });

  it("logs every reminder it sends — the 57 sends produced no log line at all", async () => {
    await channelState.injectMessage(userId, "hello");
    const repo = new RegistrationRepository(pool);
    const record = (await repo.findActiveByChannelUser("cli", userId))!;

    await ageContactPromptCycle(pool, record.id, 120);
    await engine.triggerContactPromptSweep();
    await ageContactPromptCycle(pool, record.id, 120);
    await engine.triggerContactPromptSweep();

    const logged = loggerState.events.filter((e) => e.event === "registration.contact_prompt.resent");
    expect(logged).toHaveLength(2);
    expect(logged[0].context?.["reminderNumber"]).toBe(1);
    expect(logged[1].context?.["reminderNumber"]).toBe(2);
    expect(logged[0].context?.["registrationId"]).toBe(record.id);
  });

  it("still accepts the phone number after the reminders stop — no dead end", async () => {
    await channelState.injectMessage(userId, "hello");
    const repo = new RegistrationRepository(pool);
    const record = (await repo.findActiveByChannelUser("cli", userId))!;

    for (let i = 0; i < 5; i++) {
      await ageContactPromptCycle(pool, record.id, 120);
      await engine.triggerContactPromptSweep();
    }
    expect(reminders(channelState.sent, userId)).toHaveLength(2);

    await channelState.injectMessage(userId, `CONTACT:${userId}:+447911123456`);

    const after = await repo.findActiveByChannelUser("cli", userId);
    expect(after?.state).toBe("AWAITING_EMAIL");
  });
});
