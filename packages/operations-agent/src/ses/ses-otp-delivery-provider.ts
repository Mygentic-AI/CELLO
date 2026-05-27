/**
 * ses-otp-delivery-provider.ts — Production OTP delivery via AWS SES.
 *
 * Phase P — Pseudocode:
 *
 *   sendOtp(emailAddress, otp):
 *     correlationId = randomUUID()
 *     emailDomain = extractDomain(emailAddress)
 *
 *     // Defense-in-depth: check bounced set before rate limit
 *     if bouncedAddresses.has(emailAddress):
 *       throw DeliveryError("Bounce")
 *
 *     // Rate limit: rolling 1-hour window per address
 *     if isRateLimited(emailAddress):
 *       throw RateLimitError(emailDomain)
 *
 *     // Attempt SES send (with one throttle retry)
 *     try:
 *       messageId = await sendViaSes(emailAddress, otp)
 *     catch ThrottlingException:
 *       wait 1000ms
 *       log otp.delivery.retried { emailDomain, retryDelayMs: 1000, correlationId }
 *       try:
 *         messageId = await sendViaSes(emailAddress, otp)   // retry
 *       catch:
 *         log otp.delivery.failed { emailDomain, sesErrorType, correlationId }
 *         throw DeliveryError(sesErrorType)
 *     catch hard-bounce (MessageRejected):
 *       bouncedAddresses.add(emailAddress)
 *       log otp.delivery.failed { emailDomain, sesErrorType: 'Bounce', correlationId }
 *       throw DeliveryError('Bounce')
 *
 *     // Record send for rate limiting
 *     recordSend(emailAddress)
 *
 *     log otp.delivery.sent { emailDomain, messageId, correlationId }
 *
 *   isRateLimited(emailAddress):
 *     now = Date.now()
 *     timestamps = sendLog.get(emailAddress) ?? []
 *     // Filter to the rolling 1-hour window
 *     recent = timestamps.filter(t => now - t < 3_600_000)
 *     sendLog.set(emailAddress, recent)
 *     return recent.length >= 5
 *
 *   recordSend(emailAddress):
 *     now = Date.now()
 *     existing = sendLog.get(emailAddress) ?? []
 *     sendLog.set(emailAddress, [...existing, now])
 *
 * Phase A — Architecture notes:
 *   - SESClient is injected; no credentials from process.env (SI-003)
 *   - emailDomain only in logs; full address never logged (SI-002)
 *   - In-memory rate limiter: rolling 1-hour window, 5 sends max (AC-002, AC-003)
 *   - In-memory bounced set: per provider instance (AC-004)
 *   - ThrottlingException retry: 1s delay, retry once (AC-005)
 */

import { randomUUID } from "node:crypto";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import type { OtpDeliveryProvider, Logger } from "@cello-protocol/interfaces";

// ─── Error types (exported) ───────────────────────────────────────────────────

/**
 * RateLimitError — thrown when the in-memory rate limit (5/hr) is exceeded.
 * The message includes the email domain (never the full address) for diagnostics.
 */
export class RateLimitError extends Error {
  constructor(emailDomain: string) {
    super(`Rate limit exceeded for domain: ${emailDomain}`);
    this.name = "RateLimitError";
  }
}

/**
 * DeliveryError — thrown when SES returns a permanent failure or a retry also fails.
 * sesErrorType distinguishes the failure mode ('Bounce', 'ThrottlingException', etc.).
 */
export class DeliveryError extends Error {
  readonly sesErrorType: string;
  constructor(message: string, sesErrorType: string) {
    super(message);
    this.name = "DeliveryError";
    this.sesErrorType = sesErrorType;
  }
}

// ─── Config type ──────────────────────────────────────────────────────────────

export type SesOtpDeliveryProviderConfig = {
  /** Pre-constructed AWS SDK v3 SESClient with credentials. Never read from process.env. */
  sesClient: SESClient;
  /** Verified SES sender identity (e.g. "noreply@cello.example.com"). */
  fromAddress: string;
  /** Injected structured logger. Events use otp.delivery.* taxonomy. */
  logger: Logger;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const THROTTLE_RETRY_DELAY_MS = 1000;

/**
 * SES error names that indicate a hard bounce.
 * MessageRejected is the canonical SES SDK error for permanently rejected addresses.
 */
const HARD_BOUNCE_ERROR_NAMES = new Set(["MessageRejected"]);

// ─── Implementation ───────────────────────────────────────────────────────────

/**
 * SesOtpDeliveryProvider — production implementation of OtpDeliveryProvider.
 *
 * Delivers 6-digit OTPs via AWS SES. Enforces:
 *   - Per-address in-memory rate limit (5 sends per rolling hour)
 *   - Per-instance hard bounce tracking (prevents repeated SES calls for bad addresses)
 *   - One throttle retry after 1-second delay
 *
 * SI-002: only emailDomain appears in logs — full email address is never logged.
 * SI-003: SESClient is injected at construction — no process.env credential reads.
 */
export class SesOtpDeliveryProvider implements OtpDeliveryProvider {
  readonly #config: SesOtpDeliveryProviderConfig;

  /**
   * Rolling send timestamps per email address.
   * Key: full email address (used only internally, never logged).
   * Value: array of epoch ms timestamps for sends within the last hour.
   */
  readonly #sendLog = new Map<string, number[]>();

  /**
   * Addresses that received a hard bounce in this provider instance.
   * Per-instance state: a new provider starts with an empty set.
   */
  readonly #bouncedAddresses = new Set<string>();

  constructor(config: SesOtpDeliveryProviderConfig) {
    this.#config = config;
  }

  /**
   * Deliver a 6-digit OTP to the given email address via AWS SES.
   *
   * Throws:
   *   - DeliveryError (sesErrorType='Bounce') if the address previously bounced
   *     or SES returns a hard bounce on this call.
   *   - RateLimitError if the rolling 1-hour limit (5 sends) is exceeded.
   *   - DeliveryError if SES throttles and the retry also fails.
   */
  async sendOtp(emailAddress: string, otp: string): Promise<void> {
    const correlationId = randomUUID();
    const emailDomain = this.#extractDomain(emailAddress);

    // Defense-in-depth: hard bounce check before any further work
    if (this.#bouncedAddresses.has(emailAddress)) {
      throw new DeliveryError(`Address previously bounced: ${emailDomain}`, "Bounce");
    }

    // Rate limit check
    if (this.#isRateLimited(emailAddress)) {
      throw new RateLimitError(emailDomain);
    }

    // Attempt SES delivery (with throttle retry)
    const messageId = await this.#sendWithRetry(emailAddress, otp, emailDomain, correlationId);

    // Record send for rate limiting only after successful delivery
    this.#recordSend(emailAddress);

    this.#config.logger.info("otp.delivery.sent", { emailDomain, messageId, correlationId });
  }

  /**
   * Attempt SES send. On ThrottlingException: wait 1s, retry once.
   * On hard bounce: record address and throw DeliveryError.
   */
  async #sendWithRetry(
    emailAddress: string,
    otp: string,
    emailDomain: string,
    correlationId: string,
  ): Promise<string> {
    let firstError: unknown;

    try {
      return await this.#callSes(emailAddress, otp);
    } catch (err: unknown) {
      firstError = err;
    }

    const errorName = this.#errorName(firstError);

    // Hard bounce — do not retry
    if (HARD_BOUNCE_ERROR_NAMES.has(errorName)) {
      this.#bouncedAddresses.add(emailAddress);
      this.#config.logger.error("otp.delivery.failed", firstError as Error, {
        emailDomain,
        sesErrorType: "Bounce",
        correlationId,
      });
      throw new DeliveryError(`SES rejected message for domain: ${emailDomain}`, "Bounce");
    }

    // Throttling — wait and retry once
    if (errorName === "ThrottlingException") {
      await this.#sleep(THROTTLE_RETRY_DELAY_MS);

      try {
        const messageId = await this.#callSes(emailAddress, otp);
        // Retry succeeded
        this.#config.logger.info("otp.delivery.retried", {
          emailDomain,
          retryDelayMs: THROTTLE_RETRY_DELAY_MS,
          correlationId,
        });
        return messageId;
      } catch (retryErr: unknown) {
        // Retry also failed
        const retryErrorName = this.#errorName(retryErr);
        this.#config.logger.error("otp.delivery.failed", retryErr as Error, {
          emailDomain,
          sesErrorType: retryErrorName,
          correlationId,
        });
        throw new DeliveryError(`SES delivery failed after retry for domain: ${emailDomain}`, retryErrorName);
      }
    }

    // Unrecognized error — log and rethrow as DeliveryError
    this.#config.logger.error("otp.delivery.failed", firstError as Error, {
      emailDomain,
      sesErrorType: errorName,
      correlationId,
    });
    throw new DeliveryError(`SES delivery failed for domain: ${emailDomain}`, errorName);
  }

  /**
   * Construct and send the SendEmailCommand to SES.
   * Returns the MessageId on success.
   */
  async #callSes(emailAddress: string, otp: string): Promise<string> {
    const command = new SendEmailCommand({
      Source: this.#config.fromAddress,
      Destination: { ToAddresses: [emailAddress] },
      Message: {
        Subject: { Data: "Your CELLO verification code", Charset: "UTF-8" },
        Body: {
          Text: {
            Data: `Your verification code is: ${otp}`,
            Charset: "UTF-8",
          },
        },
      },
    });

    const response = await this.#config.sesClient.send(command);
    return response.MessageId ?? "";
  }

  /**
   * Rolling rate limit check for the given email address.
   * Prunes expired timestamps (older than 1 hour) in place.
   */
  #isRateLimited(emailAddress: string): boolean {
    const now = Date.now();
    const existing = this.#sendLog.get(emailAddress) ?? [];
    const recent = existing.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
    this.#sendLog.set(emailAddress, recent);
    return recent.length >= RATE_LIMIT_MAX;
  }

  /**
   * Record a successful send for rate limiting.
   * Called after delivery succeeds — not before, to avoid counting failed attempts.
   */
  #recordSend(emailAddress: string): void {
    const now = Date.now();
    const existing = this.#sendLog.get(emailAddress) ?? [];
    this.#sendLog.set(emailAddress, [...existing, now]);
  }

  /**
   * Extract the domain portion of an email address (lowercased).
   * e.g. "User@Example.COM" → "example.com"
   */
  #extractDomain(email: string): string {
    return email.slice(email.indexOf("@") + 1).toLowerCase();
  }

  /** Extract the error name from an unknown thrown value. */
  #errorName(err: unknown): string {
    if (err instanceof Error) return err.name ?? "UnknownError";
    return "UnknownError";
  }

  /** Promisified setTimeout for the throttle retry delay. */
  #sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
