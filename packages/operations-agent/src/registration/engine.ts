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

/** How often to check for records stuck in AWAITING_CONTACT (10 minutes) */
const CONTACT_PROMPT_INTERVAL_MS = 10 * 60 * 1_000;

/** How often to sweep for expired registrations (1 hour) */
const EXPIRY_SWEEP_INTERVAL_MS = 60 * 60 * 1_000;

export type RegistrationEngineOptions = {
  pool: pg.Pool;
  channel: MessagingChannel;
  otpDelivery: OtpDeliveryProvider;
  preAuth: PreAuthorizationClient;
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

  /** Timer: AWAITING_CONTACT re-prompt */
  #contactPromptTimer: NodeJS.Timeout | undefined;
  /** Timer: expiry sweep */
  #expirySweepTimer: NodeJS.Timeout | undefined;

  constructor(opts: RegistrationEngineOptions) {
    this.#opts = opts;
    this.#logger = opts.logger;
    this.#repository = new RegistrationRepository(opts.pool);
    this.#stateMachine = new RegistrationStateMachine({
      repository: this.#repository,
      channel: opts.channel,
      otpDelivery: opts.otpDelivery,
      preAuth: opts.preAuth,
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

    this.#contactPromptTimer = setInterval(
      () => { void this.#runContactPromptSweep(); },
      contactInterval,
    );
    this.#expirySweepTimer = setInterval(
      () => { void this.#runExpirySweep(); },
      expiryInterval,
    );
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
  }

  // ─── Inbound message handler ───────────────────────────────────────────────

  #handleInboundMessage = async (from: string, message: string): Promise<void> => {
    try {
      const existing = await this.#repository.findActiveByChannelUser(
        this.#opts.channelType,
        from,
      );

      // Derive phone_stub_hash for new registrations
      const identity = await this.#opts.channel.resolveIdentity(from);
      const phoneNumber = "phoneNumber" in identity ? (identity.phoneNumber ?? from) : from;
      const phoneStubHash = hashPhone(normalizePhone(phoneNumber));

      let record: RegistrationRecord;
      if (!existing) {
        // New user — no active registration found
        record = await this.#stateMachine.handleNewUser(from, this.#opts.channelType, phoneStubHash);
      } else {
        // Check expiry first — if expired, start fresh with same message
        const now = new Date();
        if (existing.expiresAt < now) {
          // Expire the old record
          await this.#repository.transition(existing.id, "EXPIRED");
          this.#logger.info("registration.expired", { registrationId: existing.id });
          this.#activeRecords.delete(from);
          // Start a fresh registration for this message
          record = await this.#stateMachine.handleNewUser(from, this.#opts.channelType, phoneStubHash);
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
      this.#logger.error("registration.engine.error", error);
      if (this.#opts.onError) {
        this.#opts.onError(error);
      }
    }
  };

  // ─── Periodic sweeps ───────────────────────────────────────────────────────

  async #runContactPromptSweep(): Promise<void> {
    // Re-prompt all records stuck in AWAITING_CONTACT for > contactInterval
    for (const [, record] of this.#activeRecords) {
      if (record.state === "AWAITING_CONTACT") {
        await this.#stateMachine.resendContactPrompt(record);
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
