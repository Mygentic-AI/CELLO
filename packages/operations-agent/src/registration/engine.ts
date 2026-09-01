/**
 * engine.ts — RegistrationEngine wires the state machine with channel events.
 *
 * Phase P — Pseudocode:
 *   start():
 *     1. Load all active (non-terminal) registrations from Postgres (restart recovery, AC-007)
 *        For each: log registration.state.recovered
 *     2. Register onMessage handler on MessagingChannel
 *     3. Start AWAITING_CONTACT re-prompt timer (10 minutes)
 *     4. Start expiry sweep timer (periodically check for 7-day expired records)
 *
 *   onMessage(from, message):
 *     Look up active registration for (channel, from)
 *     If none: create new registration via handleNewUser
 *     Else: dispatch to state machine handleMessage
 *
 *   stop():
 *     Clear timers
 *
 * The engine owns:
 *   - In-memory map of active records (channel+userId → RegistrationRecord)
 *   - Timer management for re-prompts and expiry
 *   - Correlation between channel identity and DB record
 */

import type {
  WaitlistGateClient,
  MessagingChannel,
  OtpDeliveryProvider,
  PreAuthorizationClient,
  Logger,
} from "@cello-protocol/interfaces";
import { RegistrationRepository } from "./repository.js";
import { RegistrationStateMachine } from "./state-machine.js";
import { hashPhone, normalizePhone } from "./phone.js";
import type { RegistrationRecord } from "@cello-protocol/interfaces";
import pg from "pg";

/** How often to CHECK whether a reminder is due (10 minutes). Not how often one is sent. */
const CONTACT_PROMPT_INTERVAL_MS = 10 * 60 * 1_000;

/**
 * The bounded reminder schedule for a registration stuck at "share your phone number"
 * (DOD-M15-CONTACTNAG-1).
 *
 * TWO reminders per cycle, then silence. A cycle starts when the record enters AWAITING_CONTACT and
 * restarts whenever the user sends another message without sharing contact — so the bot stops
 * chasing, but never stops listening. The phone number itself stays mandatory; only the nudging is
 * capped.
 *
 * Before this, the sweep re-prompted on every tick with no terminating condition: 6 messages an
 * hour, 144 a day, and 57 of them landed on one person overnight.
 */
const MAX_CONTACT_REMINDERS = 2;

/** Wait after the cycle starts before the FIRST reminder. */
const FIRST_REMINDER_DELAY_MS = 10 * 60 * 1_000;

/** Wait after the first reminder before the SECOND — deliberately much longer. */
const SECOND_REMINDER_DELAY_MS = 60 * 60 * 1_000;

/**
 * Which reminder, if any, is due now — the single decision the sweep makes.
 *
 * Returns 1 or 2 for the reminder to send, or null for "say nothing". Pure and total: it reads only
 * durable state and the clock, so a restart mid-cycle reaches the same answer as the process that
 * started it. That is the property that matters — the counter lives in the database precisely
 * because an in-memory one would reset on every deploy and restart the loop forever.
 */
export function dueReminderNumber(
  progress: { count: number; lastAt: Date },
  now: number,
): number | null {
  if (progress.count >= MAX_CONTACT_REMINDERS) return null;
  const required = progress.count === 0 ? FIRST_REMINDER_DELAY_MS : SECOND_REMINDER_DELAY_MS;
  const waited = now - progress.lastAt.getTime();
  return waited >= required ? progress.count + 1 : null;
}

/** How often to sweep for expired registrations (1 hour) */
const EXPIRY_SWEEP_INTERVAL_MS = 60 * 60 * 1_000;

/** Re-registration check window — 30 days */
const REREGISTRATION_WINDOW_MS = 30 * 24 * 60 * 60 * 1_000;

/**
 * How long a #pendingReregistration entry is valid (30 minutes).
 * After this window, the warning is considered stale and the entry is
 * removed by the sweep timer. The user must send another message to
 * receive a fresh warning before they can CONFIRM.
 */
const PENDING_REREGISTRATION_TTL_MS = 30 * 60 * 1_000;

/** How often to sweep stale #pendingReregistration entries (30 minutes) */
const PENDING_REREGISTRATION_SWEEP_INTERVAL_MS = 30 * 60 * 1_000;

export type RegistrationEngineOptions = {
  pool: pg.Pool;
  channel: MessagingChannel;
  otpDelivery: OtpDeliveryProvider;
  preAuth: PreAuthorizationClient;
  /** DOD-TELEGRAM-GATE-1 — passed straight through to the state machine. */
  waitlistGate?: WaitlistGateClient;
  logger: Logger;
  /** Channel type for this engine instance */
  channelType: "telegram" | "whatsapp" | "cli";
  /**
   * Override the contact-prompt re-send interval (ms). Default: 10 minutes.
   * Used in tests to inject a short interval.
   */
  contactPromptIntervalMs?: number;
  /**
   * Override the expiry sweep interval (ms). Default: 1 hour.
   * Used in tests to inject a short interval.
   */
  expirySweepIntervalMs?: number;
  /**
   * Override the pending-reregistration sweep interval (ms). Default: 30 minutes.
   * Used in tests to inject a short interval.
   */
  pendingReregistrationSweepIntervalMs?: number;
  /**
   * Optional error callback — receives unhandled errors from message processing.
   * In tests, set this to rethrow so test failures surface the real error.
   */
  onError?: (err: Error) => void;
};

export class RegistrationEngine {
  readonly #opts: RegistrationEngineOptions;
  readonly #repository: RegistrationRepository;
  readonly #stateMachine: RegistrationStateMachine;
  readonly #logger: Logger;

  /** In-memory map: channelUserId → last known RegistrationRecord */
  readonly #activeRecords: Map<string, RegistrationRecord> = new Map();

  /**
   * In-memory map of channelUserId → timestamp (ms) when the re-registration warning was sent.
   * A user is added here when the re-registration warning is sent (AC-002).
   * A CONFIRM message from a user in this map triggers handleNewUser (AC-003).
   * A CONFIRM message from a user NOT in this map re-sends the warning (SI-001).
   * Entries are removed after PENDING_REREGISTRATION_TTL_MS (30 minutes) by the sweep timer
   * to prevent unbounded growth for users who were warned but never replied.
   * Scoped to the current process instance — a restart clears this map, causing
   * the warning to be re-sent on the next message (safe and expected per AC-003).
   */
  readonly #pendingReregistration: Map<string, number> = new Map();

  /** Timer: AWAITING_CONTACT re-prompt */
  #contactPromptTimer: NodeJS.Timeout | undefined;
  /** Timer: expiry sweep */
  #expirySweepTimer: NodeJS.Timeout | undefined;
  /** Timer: stale #pendingReregistration entry sweep */
  #pendingReregistrationSweepTimer: NodeJS.Timeout | undefined;

  constructor(opts: RegistrationEngineOptions) {
    this.#opts = opts;
    this.#logger = opts.logger;
    this.#repository = new RegistrationRepository(opts.pool);
    this.#stateMachine = new RegistrationStateMachine({
      repository: this.#repository,
      channel: opts.channel,
      otpDelivery: opts.otpDelivery,
      preAuth: opts.preAuth,
      waitlistGate: opts.waitlistGate,
      logger: opts.logger,
    });
  }

  /**
   * Start the engine:
   *   1. Load all active registrations from Postgres (restart recovery)
   *   2. Register inbound message handler
   *   3. Start periodic timers
   */
  async start(): Promise<void> {
    // Restart recovery (AC-007): load all active records
    const active = await this.#repository.loadAllActive();
    for (const record of active) {
      this.#activeRecords.set(record.channelUserId, record);
      this.#logger.info("registration.state.recovered", {
        registrationId: record.id,
        state: record.state,
      });
    }

    // Register message handler
    this.#opts.channel.onMessage(this.#handleInboundMessage.bind(this));

    // Start timers
    const contactInterval = this.#opts.contactPromptIntervalMs ?? CONTACT_PROMPT_INTERVAL_MS;
    const expiryInterval = this.#opts.expirySweepIntervalMs ?? EXPIRY_SWEEP_INTERVAL_MS;
    const pendingReregInterval =
      this.#opts.pendingReregistrationSweepIntervalMs ?? PENDING_REREGISTRATION_SWEEP_INTERVAL_MS;

    this.#contactPromptTimer = setInterval(() => {
      this.#runContactPromptSweep().catch((err) => {
        const error = err instanceof Error ? err : new Error(String(err));
        this.#logger.error("registration.engine.error", error, {
          "error.message": error.message,
          "error.stack": error.stack ?? "",
        });
      });
    }, contactInterval);
    this.#expirySweepTimer = setInterval(() => {
      this.#runExpirySweep().catch((err) => {
        const error = err instanceof Error ? err : new Error(String(err));
        this.#logger.error("registration.engine.error", error, {
          "error.message": error.message,
          "error.stack": error.stack ?? "",
        });
      });
    }, expiryInterval);
    this.#pendingReregistrationSweepTimer = setInterval(() => {
      this.#sweepStalePendingReregistrations();
    }, pendingReregInterval);
  }

  /**
   * Stop the engine — clear timers. Call during graceful shutdown or in tests.
   */
  stop(): void {
    if (this.#contactPromptTimer) {
      clearInterval(this.#contactPromptTimer);
      this.#contactPromptTimer = undefined;
    }
    if (this.#expirySweepTimer) {
      clearInterval(this.#expirySweepTimer);
      this.#expirySweepTimer = undefined;
    }
    if (this.#pendingReregistrationSweepTimer) {
      clearInterval(this.#pendingReregistrationSweepTimer);
      this.#pendingReregistrationSweepTimer = undefined;
    }
  }

  // ─── Inbound message handler ───────────────────────────────────────────────

  #handleInboundMessage = async (from: string, message: string): Promise<void> => {
    try {
      // Always query the DB for the current state — the in-memory map (#activeRecords)
      // is used only by the contact-prompt sweep timer, not as a lookup cache.
      // This ensures the state machine always operates on the authoritative persisted state,
      // which is essential for correct restart recovery behavior.
      const existing = await this.#repository.findActiveByChannelUser(
        this.#opts.channelType,
        from,
      );

      // Derive initial phone_stub_hash for the insert placeholder.
      // For Telegram, identity.phoneNumber is the real number from contact.user_id verification.
      // For CLI (dev/test), resolveIdentity returns no phoneNumber — we hash `from` (the channelUserId)
      // as a placeholder. The real phone hash is written to DB on the PHONE_CONFIRMED transition.
      const identity = await this.#opts.channel.resolveIdentity(from);
      const phoneNumber = "phoneNumber" in identity ? (identity.phoneNumber ?? from) : from;
      const phoneStubHash = hashPhone(normalizePhone(phoneNumber));

      let record: RegistrationRecord;
      if (!existing) {
        // No active registration — check for a prior completed one before starting fresh.
        const result = await this.#handleCompletedOrNew(from, message, phoneStubHash);
        if (result === null) return; // warning sent, waiting for CONFIRM
        record = result;
      } else {
        // Active registration exists — check expiry first.
        const now = new Date();
        if (existing.expiresAt < now) {
          await this.#repository.transition(existing.id, "EXPIRED");
          this.#logger.info("registration.expired", { registrationId: existing.id });
          this.#activeRecords.delete(from);
          // After expiring, apply the same completed-or-new check.
          const result = await this.#handleCompletedOrNew(from, message, phoneStubHash);
          if (result === null) return; // warning sent, waiting for CONFIRM
          record = result;
        } else {
          record = await this.#stateMachine.handleMessage(existing, message, from);
        }
      }

      // Update in-memory map
      if (record.state === "PRE_AUTH_TOKEN_ISSUED" || record.state === "EXPIRED" || record.state === "FAILED") {
        this.#activeRecords.delete(from);
      } else {
        this.#activeRecords.set(from, record);
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.#logger.error("registration.engine.error", error, {
        "error.message": error.message,
        "error.stack": error.stack ?? "",
      });
      if (this.#opts.onError) {
        this.#opts.onError(error);
      }
    }
  };

  // ─── Completed-or-new helper ──────────────────────────────────────────────

  /**
   * Check for a prior completed registration and either:
   *   - warn + gate on CONFIRM (returns null — caller must return early), or
   *   - start handleExistingUser if CONFIRM already received, or
   *   - start handleNewUser if no prior completed registration exists.
   *
   * Used in two places: no-active-record path and post-expiry path. Extracting
   * here eliminates the duplication that would otherwise exist between those branches.
   */
  async #handleCompletedOrNew(
    from: string,
    message: string,
    phoneStubHash: string,
  ): Promise<RegistrationRecord | null> {
    const completed = await this.#repository.findCompletedByChannelUser(
      this.#opts.channelType,
      from,
      REREGISTRATION_WINDOW_MS,
    );

    if (completed) {
      if (this.#pendingReregistration.has(from) && message === "CONFIRM") {
        // User was previously warned and now confirms — proceed with re-registration.
        this.#pendingReregistration.delete(from);
        return this.#stateMachine.handleExistingUser(
          from,
          this.#opts.channelType,
          phoneStubHash,
          completed.emailStubHash,
        );
      } else {
        // Send (or re-send) the re-registration warning and wait for CONFIRM.
        // Also covers SI-001: a CONFIRM without a prior warning re-sends the warning.
        if (!this.#pendingReregistration.has(from)) {
          this.#pendingReregistration.set(from, Date.now());
        }
        const existingRegistrationAge = Date.now() - completed.created_at.getTime();
        this.#logger.info("registration.already_registered.warned", {
          registrationId: completed.id,
          channelUserId: from,
          existingRegistrationAge,
        });
        // OA-2 item 1: split the explanation from the instruction into two sequential messages.
        await this.#opts.channel.send(
          from,
          "There are already one or more agents registered to this account. You can register additional " +
            "agents, but each must use the same account — the same phone number and the same email you " +
            "registered with before.",
        );
        await this.#opts.channel.send(
          from,
          "Reply CONFIRM to proceed using that same phone number and email. Otherwise, ignore this message.",
        );
        return null;
      }
    } else {
      return this.#stateMachine.handleNewUser(from, this.#opts.channelType, phoneStubHash);
    }
  }

  // ─── Periodic sweeps ───────────────────────────────────────────────────────

  /**
   * Send whichever reminder is DUE to each record stuck in AWAITING_CONTACT — at most two per
   * cycle, and nothing at all once the budget is spent.
   *
   * This used to re-prompt every AWAITING_CONTACT record on every tick, unconditionally and
   * forever. One user received 57 identical messages overnight (DOD-M15-CONTACTNAG-1). The tick is
   * now only a clock: what to send, and whether to send anything, is decided per record from
   * durable state.
   */
  async #runContactPromptSweep(): Promise<void> {
    for (const [userId, record] of this.#activeRecords) {
      if (record.state !== "AWAITING_CONTACT") continue;

      const progress = await this.#repository.getContactPromptProgress(record.id);
      const due = dueReminderNumber(progress, Date.now());
      if (due === null) continue;

      await this.#stateMachine.resendContactPrompt(record, due);

      // Refresh the in-memory entry so the expiry check in #handleInboundMessage sees current
      // timestamps rather than the pre-write ones.
      const refreshed = await this.#repository.findActiveByChannelUser(
        this.#opts.channelType,
        userId,
      );
      if (refreshed) {
        this.#activeRecords.set(userId, refreshed);
      }
    }
  }

  async #runExpirySweep(): Promise<void> {
    const now = new Date();
    const expired = await this.#repository.findExpiredActive(now);
    for (const record of expired) {
      await this.#repository.transition(record.id, "EXPIRED");
      this.#logger.info("registration.expired", { registrationId: record.id });
      this.#activeRecords.delete(record.channelUserId);
    }
  }

  /**
   * Remove stale entries from #pendingReregistration.
   * An entry is stale if it was added more than PENDING_REREGISTRATION_TTL_MS ago.
   * This prevents unbounded growth for users who received a warning but never replied.
   */
  #sweepStalePendingReregistrations(): void {
    const now = Date.now();
    for (const [userId, warnedAt] of this.#pendingReregistration) {
      if (now - warnedAt > PENDING_REREGISTRATION_TTL_MS) {
        this.#pendingReregistration.delete(userId);
      }
    }
  }

  // ─── Test helper ──────────────────────────────────────────────────────────

  /** Expose repository for direct test access */
  get repository(): RegistrationRepository {
    return this.#repository;
  }

  /** Trigger contact prompt sweep manually (for tests) */
  async triggerContactPromptSweep(): Promise<void> {
    await this.#runContactPromptSweep();
  }

  /** Trigger expiry sweep manually (for tests) */
  async triggerExpirySweep(): Promise<void> {
    await this.#runExpirySweep();
  }
}
