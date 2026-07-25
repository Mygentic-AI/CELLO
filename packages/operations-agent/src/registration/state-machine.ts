/**
 * state-machine.ts — Registration state machine pure logic.
 *
 * Phase P — Pseudocode for key operations:
 *
 *   handleMessage(record, message, from, channel, deps):
 *     correlationId = crypto.randomUUID()
 *
 *     // SI-003: enforce state-based transitions, never skip verification steps
 *     switch record.state:
 *       AWAITING_CONTACT:
 *         if message looks like a contact event with user_id match:
 *           → handleContactShared(record, message, correlationId, deps)
 *         else:
 *           → tell user to share contact (no state change)
 *
 *       AWAITING_EMAIL:
 *         if message looks like a valid email:
 *           → handleEmailProvided(record, email, correlationId, deps)
 *         else:
 *           → tell user to provide valid email
 *
 *       AWAITING_EMAIL_OTP:
 *         if message is a 6-digit string:
 *           → handleOtpAttempt(record, otp, correlationId, deps)
 *         else:
 *           → tell user to enter their OTP
 *
 *       PRE_AUTH_TOKEN_ISSUED, EXPIRED, FAILED:
 *         terminal — ignore
 *
 *       INITIAL, PHONE_CONFIRMED, EMAIL_CONFIRMED:
 *         should not receive messages in these transient states;
 *         re-prompt AWAITING_CONTACT if stuck
 *
 * The state machine is pure: it takes deps (repository, channel, logger) and
 * performs work, returning the updated record. All Postgres mutations go through
 * the repository.
 */

import { randomUUID, createHash } from "node:crypto";
import type {
  WaitlistGateClient,
  RegistrationRecord,
  MessagingChannel,
  OtpDeliveryProvider,
  PreAuthorizationClient,
  Logger,
} from "@cello-protocol/interfaces";
import { CONTACT_PROMPT_PREFIX } from "@cello-protocol/interfaces";
import type { RegistrationRepository } from "./repository.js";
import { generateOtp, generateOtpSalt, hashOtp, verifyOtp } from "./otp.js";
import { hashPhone, normalizePhone } from "./phone.js";
import { PreAuthRequestError } from "../directory-pre-auth-client.js";

// ─── Configuration constants ──────────────────────────────────────────────────

/** OTP expiry window — 15 minutes */
const OTP_TTL_MS = 15 * 60 * 1_000;

/** Max OTP attempts before invalidation */
const MAX_OTP_ATTEMPTS = 3;

/** Registration expiry — 7 days */
const REGISTRATION_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

// CONTACT_PROMPT_PREFIX is imported from @cello-protocol/interfaces — canonical home.
// Re-exported here for backward compatibility with any code that imports it from state-machine.
export { CONTACT_PROMPT_PREFIX };

/** Rate limit: max OTP sends per email domain per hour */
const OTP_RATE_LIMIT_PER_HOUR = 5;

/** OTP rate limit window — 1 hour */
const OTP_RATE_WINDOW_MS = 60 * 60 * 1_000;

// OA-2 (2026-07-07): shared registration copy, defined once so duplicated sites can never drift
// (the OA-1 root-cause class). PHONE_PRIVACY_NOTE claims ONLY what the DIRECTORIES store (hashes),
// never "CELLO as a whole" — the portal holds a recoverable email; see the no-PII-in-directory model.
const PHONE_PRIVACY_NOTE =
  "A note on privacy: the directories where your agent can be found never hold your actual phone " +
  "number or email — only irreversible hashes of them. Those hashes keep each unique to you while " +
  "leaving nothing in the shared, federated records worth stealing. No one, CELLO staff included, " +
  "will ever call you — the registration system holds a hash of your number, never the number itself.";

// O1: the pre-auth server error is RETRYABLE — the record stays in EMAIL_CONFIRMED and the next
// message triggers #retryPreAuth. The old copy ("not something you can fix by retrying") contradicted
// the actual behavior. Defined once; used by both the primary and the retry path.
const PREAUTH_SERVER_ERROR_MSG =
  "CELLO hit a temporary server error finishing your registration. Reply anything to try again. " +
  "If it keeps happening, please contact support.";

// ─── Rate limit state ─────────────────────────────────────────────────────────

/** In-memory rate limiter: emailDomain → { count, windowStart } */
type RateLimitEntry = { count: number; windowStart: Date };

// ─── Email validation ─────────────────────────────────────────────────────────

/** Basic email validation — must contain exactly one @, domain must contain a dot */
export function isValidEmail(s: string): boolean {
  const at = s.indexOf("@");
  if (at <= 0 || at !== s.lastIndexOf("@")) return false;
  const domain = s.slice(at + 1);
  const dotPos = domain.indexOf(".");
  return dotPos > 0 && dotPos < domain.length - 1;
}

/** Extract domain from a valid email address */
export function extractEmailDomain(email: string): string {
  return email.slice(email.indexOf("@") + 1).toLowerCase();
}

/**
 * Compute the email stub hash: SHA-256(normalize(email)) where normalize
 * lowercases and trims whitespace. Returns hex string (same format as phone_stub_hash).
 * The pre-hash email MUST NOT be stored or logged after this function returns.
 */
export function hashEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

// ─── RegistrationStateMachine ─────────────────────────────────────────────────

export type StateMachineDeps = {
  repository: RegistrationRepository;
  channel: MessagingChannel;
  otpDelivery: OtpDeliveryProvider;
  preAuth: PreAuthorizationClient;
  /**
   * DOD-TELEGRAM-GATE-1. Optional so an environment without a waitlist (a bare
   * dev box, the CLI adapter) still constructs — but when it is ABSENT the gate
   * is not enforced, so `server.ts` supplies it in every environment that is not
   * CELLO_ENV=local, and absence is logged loudly on the path that would have
   * used it. Absent must never look like "admitted".
   */
  waitlistGate?: WaitlistGateClient;
  logger: Logger;
};

export class RegistrationStateMachine {
  readonly #deps: StateMachineDeps;
  readonly #rateLimitMap: Map<string, RateLimitEntry> = new Map();

  constructor(deps: StateMachineDeps) {
    this.#deps = deps;
  }

  /**
   * Process an inbound message for a given registration record.
   * Mints a fresh correlationId for this invocation.
   * Returns the updated RegistrationRecord after any state transition.
   */
  async handleMessage(
    record: RegistrationRecord,
    message: string,
    from: string,
  ): Promise<RegistrationRecord> {
    const correlationId = randomUUID();

    switch (record.state) {
      case "AWAITING_WAITLIST_TOKEN":
        return this.#handleAwaitingWaitlistToken(record, message, from, correlationId);

      case "AWAITING_CONTACT":
        return this.#handleAwaitingContact(record, message, from, correlationId);

      case "AWAITING_EMAIL":
        return this.#handleAwaitingEmail(record, message, from, correlationId);

      case "AWAITING_EMAIL_OTP":
        return this.#handleAwaitingEmailOtp(record, message, from, correlationId);

      case "PRE_AUTH_TOKEN_ISSUED":
      case "EXPIRED":
      case "FAILED":
        // Terminal state — ignore further messages
        return record;

      case "INITIAL":
      case "PHONE_CONFIRMED":
        // Transient states that should not linger — re-prompt for contact
        await this.#deps.channel.send(
          from,
          `${CONTACT_PROMPT_PREFIX}Please share your phone number using the button below to continue registration.`,
        );
        return record;
      case "EMAIL_CONFIRMED":
        // Email was verified but pre-auth token request failed. Retry it.
        return this.#retryPreAuth(record, from);
    }
  }

  /**
   * Process a new user's first message — create a registration record and transition to
   * AWAITING_CONTACT. Emits registration.started.
   */
  async handleNewUser(
    channelUserId: string,
    channel: "telegram" | "whatsapp" | "cli",
    phoneStubHash: string,
  ): Promise<RegistrationRecord> {
    const { repository, logger, waitlistGate } = this.#deps;
    const correlationId = randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + REGISTRATION_TTL_MS);

    // THE GATE COMES FIRST — before the record, and before the phone prompt.
    //
    // Ordering is the point. Asking an unadmitted stranger for their phone
    // number and only then refusing them collects PII from somebody who was
    // never going to be admitted. DOD-INV-NO-PII-DIRECTORY is about what we
    // store; this is about what we ask for.
    //
    // A gate that cannot be reached REFUSES. The client throws on every failure
    // path, and that throw is deliberately not caught here: an exception
    // propagating is the fail-closed outcome, whereas a catch that logged and
    // continued would admit on "could not check".
    let gateAllowed = true;
    let gateMessage = "Access is currently invitation-only.";
    if (waitlistGate) {
      const decision = await waitlistGate.check(channelUserId);
      gateAllowed = decision.allowed;
      if (!decision.allowed) {
        gateMessage = decision.message;
        logger.info("registration.gate.token_required", {
          channel,
          correlationId,
          reason: decision.error,
        });
      }
    } else {
      // ABSENT IS NOT FINE, and this is the one place it cannot be made fatal:
      // the CLI adapter and local dev legitimately run without a gate. So it is
      // recorded at WARN on the exact path that would have enforced it, rather
      // than being a silent `true`.
      logger.warn("registration.gate.NOT_ENFORCED", {
        channel,
        correlationId,
        detail:
          "No waitlist gate is configured; this registration was not checked against the waitlist. " +
          "Expected only under CELLO_ENV=local.",
      });
    }

    // INSERTED DIRECTLY INTO THE DESTINATION STATE, not INITIAL-then-transition.
    // The two-step left a window: if the process died between the insert and the
    // transition, a GATED user's record sat in INITIAL — and INITIAL's re-prompt
    // asks for a phone number. That is precisely the PII ordering this gate
    // exists to enforce, inverted, and it persisted for seven days because the
    // contact-prompt sweep only looks at AWAITING_CONTACT.
    const record = await repository.insert({
      phoneStubHash,
      channel,
      channelUserId,
      state: gateAllowed ? "AWAITING_CONTACT" : "AWAITING_WAITLIST_TOKEN",
      expiresAt,
    });

    // Log immediately after insert — record now exists with this id (LOW-002)
    logger.info("registration.started", {
      registrationId: record.id,
      channel,
      correlationId,
    });

    if (!gateAllowed) {
      const gated = record;
      // The GATE'S wording, not a canned string. The interface promises the
      // four refusals stay distinct, and the previous version kept that promise
      // on the redeem path and broke it here — every check refusal, whatever
      // its cause, read as "invitation-only".
      await this.#deps.channel.send(
        channelUserId,
        `Welcome to CELLO! ${gateMessage}\n\n` +
          "If you have a waitlist invitation token, send it now and I'll get you set up. " +
          "Otherwise you can join the waitlist at https://cello.mygentic.ai — " +
          "we open access in waves.",
      );
      return gated;
    }

    const awaitingRecord = record;

    // Send request_contact prompt (OA-2 item 2: welcome + directory-scoped privacy note)
    await this.#deps.channel.send(
      channelUserId,
      `${CONTACT_PROMPT_PREFIX}Welcome to CELLO! Let's set up your agent. To begin, share your phone ` +
        `number using the button below.\n\n${PHONE_PRIVACY_NOTE}`,
    );

    return awaitingRecord;
  }

  /**
   * Process a returning user's CONFIRM — create a new registration record and store the
   * expectedEmailStubHash from the prior completed row so email continuity can be enforced.
   *
   * handleExistingUser path:
   *   1. Create a new registration record (same as handleNewUser)
   *   2. Store expectedEmailStubHash in state_data so it can be checked when the user
   *      submits their email in the re-registration flow
   *   3. If expectedEmailStubHash is null (pre-V30 row): skip continuity enforcement
   */
  async handleExistingUser(
    channelUserId: string,
    channel: "telegram" | "whatsapp" | "cli",
    phoneStubHash: string,
    expectedEmailStubHash: string | null,
  ): Promise<RegistrationRecord> {
    const { repository, logger, waitlistGate } = this.#deps;
    const correlationId = randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + REGISTRATION_TTL_MS);

    // THE GATE APPLIES TO RE-REGISTRATION TOO, and this was a real bypass.
    //
    // Clause 1 of DOD-TELEGRAM-GATE-1 asks "is telegram_id in telegram_accounts?"
    // on every registration, not only a first one. A returning user is normally
    // still linked, so this changes nothing for them — but if an account has
    // been REVOKED (removed from telegram_accounts, which is what banning
    // somebody means), the re-registration path would have let them straight
    // back in without ever asking. A kill switch that a user can walk around by
    // messaging the bot again is not a kill switch.
    if (waitlistGate) {
      const decision = await waitlistGate.check(channelUserId);
      if (!decision.allowed) {
        logger.info("registration.gate.reregistration_refused", {
          channel,
          correlationId,
          reason: decision.error,
        });
        const gatedRecord = await repository.insert({
          phoneStubHash,
          channel,
          channelUserId,
          state: "INITIAL",
          expiresAt,
        });
        const gated = await repository.transition(gatedRecord.id, "AWAITING_WAITLIST_TOKEN");
        await this.#deps.channel.send(
          channelUserId,
          "This account is no longer able to register. If you have a waitlist invitation token, " +
            "send it now. Otherwise see https://cello.mygentic.ai",
        );
        return gated;
      }
    } else {
      logger.warn("registration.gate.NOT_ENFORCED", {
        channel,
        correlationId,
        detail: "Re-registration was not checked against the waitlist; no gate is configured.",
      });
    }

    // Create in INITIAL state, then immediately transition to AWAITING_CONTACT
    const record = await repository.insert({
      phoneStubHash,
      channel,
      channelUserId,
      state: "INITIAL",
      expiresAt,
    });

    // Store expectedEmailStubHash in state_data for later continuity check
    if (expectedEmailStubHash) {
      await repository.transition(record.id, "INITIAL", {
        stateData: { expectedEmailStubHash },
      });
    }

    logger.info("registration.started", {
      registrationId: record.id,
      channel,
      correlationId,
    });

    const awaitingRecord = record;

    // Send request_contact prompt (OA-2 item 2: returning-user welcome + same privacy note)
    await this.#deps.channel.send(
      channelUserId,
      `${CONTACT_PROMPT_PREFIX}Welcome back to CELLO! Let's set up another agent. To begin, share your ` +
        `phone number using the button below.\n\n${PHONE_PRIVACY_NOTE}`,
    );

    return awaitingRecord;
  }

  /**
   * Re-send the contact sharing prompt for AWAITING_CONTACT (10-min re-prompt, AC-002b).
   * Refreshes updatedAt to prevent 7-day expiry.
   */
  async resendContactPrompt(record: RegistrationRecord): Promise<void> {
    const { repository, channel } = this.#deps;
    const newExpiresAt = new Date(Date.now() + REGISTRATION_TTL_MS);
    await repository.touchTimestamps(record.id, newExpiresAt);
    await channel.send(
      record.channelUserId,
      `${CONTACT_PROMPT_PREFIX}Please share your phone number using the button below to continue registration.`,
    );
  }

  // ─── Private state handlers ────────────────────────────────────────────────

  /**
   * The user sent something while gated. Treat it as a waitlist token.
   *
   * The redemption is ATOMIC IN THE GATE — it burns the token, links the
   * account and writes the agent bridge in one transaction. This handler does
   * not validate-then-burn, because splitting those across a network boundary
   * is exactly what lets one token be redeemed twice.
   *
   * A refusal keeps the user in AWAITING_WAITLIST_TOKEN so they can try again
   * with the right token. It does NOT advance and it does not fail the
   * registration: mistyping a token is the common case, and a terminal failure
   * would force them to start over for a typo.
   */
  async #handleAwaitingWaitlistToken(
    record: RegistrationRecord,
    message: string,
    from: string,
    correlationId: string,
  ): Promise<RegistrationRecord> {
    const { repository, channel, logger, waitlistGate } = this.#deps;
    const token = message.trim();

    if (!waitlistGate) {
      // Unreachable in practice — a record only enters this state when a gate
      // said no — but a missing gate here must not become an admission.
      logger.error("registration.gate.MISSING_AT_REDEEM", {
        registrationId: record.id,
        correlationId,
        detail: "A gated registration reached token redemption with no gate configured.",
      });
      await channel.send(from, "Something is misconfigured on our side; your token was not used. Please try again later.");
      return record;
    }

    if (!token) {
      await channel.send(from, "Please send your waitlist invitation token.");
      return record;
    }

    // Not caught: a gate that cannot be reached must refuse, and an exception
    // propagating is that refusal. Catching here to send a friendly message
    // would be the fail-open path wearing a helpful face.
    const result = await waitlistGate.redeem(from, token);

    if (!result.redeemed) {
      logger.info("registration.gate.token_refused", {
        registrationId: record.id,
        correlationId,
        reason: result.error,
      });
      // The gate's own wording — it distinguishes already-used from expired
      // from unknown, and the user needs to know which.
      await channel.send(from, `${result.message}\n\nSend a different token, or join the waitlist at https://cello.mygentic.ai`);
      return record;
    }

    logger.info("registration.gate.token_redeemed", {
      registrationId: record.id,
      correlationId,
    });

    const admitted = await repository.transition(record.id, "AWAITING_CONTACT");
    await channel.send(
      from,
      `${CONTACT_PROMPT_PREFIX}You're in — welcome to CELLO! To set up your agent, share your phone ` +
        `number using the button below.\n\n${PHONE_PRIVACY_NOTE}`,
    );
    return admitted;
  }

  async #handleAwaitingContact(
    record: RegistrationRecord,
    message: string,
    from: string,
    correlationId: string,
  ): Promise<RegistrationRecord> {
    const { repository, channel, logger } = this.#deps;

    // Parse contact event — format: "CONTACT:<user_id>:<phone>"
    // The CliAdapter sends structured text; Telegram sends contact objects (handled in engine)
    const contactMatch = message.match(/^CONTACT:(\S+):(\S+)$/);
    if (contactMatch) {
      const contactUserId = contactMatch[1];
      const phoneNumber = contactMatch[2];

      // Verify contact.user_id matches from (SI-003 enforcement: phone must be for this user)
      if (contactUserId !== from) {
        await channel.send(from, "Please share your own phone number, not someone else's.");
        return record;
      }

      // SI-002: hash the phone number, never store raw
      const normalized = normalizePhone(phoneNumber);
      const phoneStubHash = hashPhone(normalized);

      // Transition to PHONE_CONFIRMED — write the verified phone_stub_hash to DB (C-001 fix)
      const phoneConfirmed = await repository.transition(record.id, "PHONE_CONFIRMED", {
        phoneStubHash,
      });

      logger.info("registration.phone.verified", {
        registrationId: record.id,
        channel: record.channel,
        correlationId,
      });

      // Immediately transition to AWAITING_EMAIL
      const awaitingEmail = await repository.transition(phoneConfirmed.id, "AWAITING_EMAIL");

      // OA-2 item 3: a returning user (re-registration) must reuse their original email (continuity is
      // enforced when they submit it) — tell them up front; a new user gets the plain ask. NO email
      // prefix hint (D-PII: the registration side stores only the irreversible email hash).
      const expectedEmailHash = (await repository.getStateDataField(record.id, "expectedEmailStubHash")) as string | null;
      await channel.send(
        from,
        expectedEmailHash
          ? "Phone verified! Please enter the same email address you registered with the first time."
          : "Phone verified! Next, please provide your email address.",
      );

      return awaitingEmail;
    }

    // Not a contact event — re-prompt
    await channel.send(from, `${CONTACT_PROMPT_PREFIX}Please share your phone number using the button below.`);
    return record;
  }

  async #handleAwaitingEmail(
    record: RegistrationRecord,
    message: string,
    from: string,
    correlationId: string,
  ): Promise<RegistrationRecord> {
    const { repository, channel, logger } = this.#deps;

    if (!isValidEmail(message.trim())) {
      await channel.send(from, "Please provide a valid email address (e.g. user@example.com).");
      return record;
    }

    const email = message.trim();
    const emailDomain = extractEmailDomain(email); // retained for rate limiter only
    const emailStubHash = hashEmail(email); // stored in DB

    // Check OTP rate limit (AC-009)
    const rateLimited = this.#isRateLimited(emailDomain, record.id, correlationId);
    if (rateLimited) {
      await channel.send(from, "Too many verification code requests. Please wait up to an hour before trying again.");
      return record;
    }

    // Generate OTP and hash it (SI-001)
    const otp = generateOtp();
    const salt = generateOtpSalt();
    const otpHash = hashOtp(otp, salt);
    const otpExpiresAt = new Date(Date.now() + OTP_TTL_MS);

    // Write OTP hash to DB first — deliver only after DB write succeeds (MED-001)
    const updated = await repository.transition(record.id, "AWAITING_EMAIL_OTP", {
      emailStubHash,
      otpHash,
      otpSalt: salt,
      otpExpiresAt,
      otpAttemptCount: 0,
    });

    logger.info("registration.email.hash_stored", {
      registrationId: record.id,
      correlationId,
    });

    // Deliver OTP only after DB write succeeds
    await this.#deps.otpDelivery.sendOtp(email, otp);

    await channel.send(from, `A 6-digit verification code has been sent to ${email} — it's valid for 15 minutes. Please enter it here.`);

    return updated;
  }

  async #handleAwaitingEmailOtp(
    record: RegistrationRecord,
    message: string,
    from: string,
    correlationId: string,
  ): Promise<RegistrationRecord> {
    if (record.state !== "AWAITING_EMAIL_OTP") {
      throw new Error(`invariant: #handleAwaitingEmailOtp called with state=${record.state}`);
    }
    const { repository, channel, logger, preAuth } = this.#deps;

    const candidate = message.trim();

    // Each of the three branches below tells the operator to re-enter their email — so each MUST
    // transition to AWAITING_EMAIL, the only state whose handler accepts an email and issues a
    // fresh code. Returning the record unchanged strands them: the state stays AWAITING_EMAIL_OTP,
    // the re-entered email is re-dispatched HERE as an OTP candidate, and the same notice replays
    // forever. There is no other edge out. (Andre hit this live on 2026-06-25.)

    // 1. OTP hash is null/empty (cleared sentinel).
    if (!record.otpHash) {
      logger.info("registration.otp.invalidated", { registrationId: record.id, reason: "otp_hash_cleared", correlationId });
      const awaitingEmail = await repository.transition(record.id, "AWAITING_EMAIL", {
        clearOtp: true,
        otpAttemptCount: 0,
      });
      await channel.send(from, "Your verification code was invalidated. Please re-enter your email address to get a new code.");
      return awaitingEmail;
    }

    // 2. Check OTP expiry (AC-006)
    if (record.otpExpiresAt < new Date()) {
      logger.info("registration.otp.expired", { registrationId: record.id, correlationId });
      const awaitingEmail = await repository.transition(record.id, "AWAITING_EMAIL", {
        clearOtp: true,
        otpAttemptCount: 0,
      });
      await channel.send(from, "Your verification code has expired. Please re-enter your email address to get a new code.");
      return awaitingEmail;
    }

    // Fetch salt from DB (not in RegistrationRecord — design decision).
    // A missing salt while otp_hash is present is abnormal (the two are always written and cleared
    // together in normal flow), but it is reachable via admin/DB surgery — and it strands the same way.
    const salt = await repository.getOtpSalt(record.id);
    if (!salt) {
      logger.info("registration.otp.invalidated", { registrationId: record.id, reason: "salt_missing", correlationId });
      const awaitingEmail = await repository.transition(record.id, "AWAITING_EMAIL", {
        clearOtp: true,
        otpAttemptCount: 0,
      });
      await channel.send(from, "Verification failed. Please re-enter your email address to get a new code.");
      return awaitingEmail;
    }

    // Verify OTP
    const correct = verifyOtp(candidate, salt, record.otpHash);

    if (!correct) {
      const newAttemptCount = record.attemptCount + 1;
      const lockout = newAttemptCount >= MAX_OTP_ATTEMPTS;

      if (lockout) {
        // Atomically: clear OTP fields, reset attempt count, transition to AWAITING_EMAIL.
        // Using a single transactional operation avoids the stuck-state bug where a crash
        // between incrementOtpAttempt and transition would leave the record in
        // AWAITING_EMAIL_OTP with a cleared otpHash — a dead-end state.
        const awaitingEmail = await repository.transitionOnOtpLockout(record.id);
        await channel.send(
          from,
          "Too many incorrect attempts. Your code has been invalidated. Please provide your email address again to get a new code.",
        );
        return awaitingEmail;
      } else {
        await repository.incrementOtpAttempt(record.id);
        const remaining = MAX_OTP_ATTEMPTS - newAttemptCount;
        await channel.send(
          from,
          `Incorrect code. You have ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`,
        );
        const updated = await repository.findById(record.id);
        return updated ?? record;
      }
    }

    // Email continuity enforcement for re-registration (handleExistingUser flow):
    // If expectedEmailStubHash is set on this record (via state_data), compare against
    // the email just verified. Reject if they differ.
    const expectedHash = await repository.getStateDataField(record.id, "expectedEmailStubHash") as string | null;
    if (expectedHash) {
      const actualHash = record.emailStubHash ?? (await repository.getEmailStubHash(record.id));
      if (actualHash && actualHash !== expectedHash) {
        logger.warn("registration.email.continuity_rejected", {
          registrationId: record.id,
          channelUserId: from,
          correlationId,
        });
        await channel.send(
          from,
          "For security, additional agents on this account must use the same email as your original registration. Please re-enter that email.",
        );
        // Transition back to AWAITING_EMAIL so user can retry with correct email
        const awaitingEmail = await repository.transition(record.id, "AWAITING_EMAIL", {
          clearOtp: true,
        });
        return awaitingEmail;
      }
    }

    // OTP correct — transition to EMAIL_CONFIRMED, explicitly clearing OTP fields.
    // clearOtp: true bypasses COALESCE to write NULL directly.
    const emailConfirmed = await repository.transition(record.id, "EMAIL_CONFIRMED", {
      clearOtp: true,
    });

    logger.info("registration.email.verified", {
      registrationId: record.id,
      correlationId,
    });

    // Request pre-auth token — AC-005: on failure, stay in EMAIL_CONFIRMED and notify user.
    let token: string;
    try {
      const result = await preAuth.requestToken(
        emailConfirmed.phoneStubHash,
        emailConfirmed.emailStubHash ?? "",
        record.id,
      );
      // #2b: deliver the short claim-code the operator types; falls back to the full capability blob if
      // the directory didn't return a claim_code (older directory). `token` is only relayed + logged here.
      token = result.claimCode ?? result.token;
    } catch (err) {
      const httpStatus = err instanceof PreAuthRequestError ? err.httpStatus : 0;
      logger.error("registration.preauth.request.failed", err instanceof Error ? err : new Error(String(err)), {
        registrationId: record.id,
        httpStatus,
        correlationId,
      });
      await channel.send(
        from,
        PREAUTH_SERVER_ERROR_MSG,
      );
      // Return the EMAIL_CONFIRMED record unchanged — user can retry by re-entering their OTP
      return emailConfirmed;
    }

    // Transition to PRE_AUTH_TOKEN_ISSUED
    const completed = await repository.transition(emailConfirmed.id, "PRE_AUTH_TOKEN_ISSUED");

    // Upsert channel identity for permanent notification routing
    try {
      await repository.upsertChannelIdentity(
        completed.phoneStubHash,
        completed.channel,
        completed.channelUserId,
      );
      logger.info("registration.channel_identity.upserted", {
        registrationId: record.id,
        channel: completed.channel,
        correlationId,
      });
    } catch (err) {
      logger.error("registration.channel_identity.upsert_failed", err instanceof Error ? err : new Error(String(err)), {
        registrationId: record.id,
        channel: completed.channel,
        correlationId,
      });
      // Non-fatal: registration already completed, token already issued
    }

    // tokenId: first 8 chars of the token (unique enough for log tracing)
    const tokenId = token.slice(0, 8);
    logger.info("registration.completed", {
      registrationId: record.id,
      tokenId,
      correlationId,
    });

    // OA-1: deliver the token with real, runnable next steps (see #sendTokenDelivery).
    await this.#sendTokenDelivery(from, token);

    return completed;
  }

  /**
   * OA-1 (2026-07-07): deliver the pre-authorization token as TWO messages —
   *   ① copy-pasteable instructions with the token inlined into the real `cello register` command;
   *   ② the bare token alone, for clean one-tap copy (the token is the error-prone part).
   * The prior copy told the user to "Set this as CELLO_REGISTRATION_TOKEN" — an env var the CLI reads
   * NOWHERE (it takes the token as a positional arg or CELLO_PREAUTH_TOKEN), so a literal follower was
   * dead in the water (cross-repo drift). `[YOUR_NAME]` uses square brackets deliberately: they fail
   * the CLI name charset ^[a-zA-Z0-9_-]{1,64}$, so a blind paste is cleanly REJECTED with the name-rule
   * error instead of creating a junk-named agent literally called `[YOUR_NAME]`. Telegram sends plain
   * text (no parse_mode), so the commands are written bare — no backticks or code fences.
   * Both #completeRegistration and #retryPreAuth call this ONE method, so the two paths can never drift.
   */
  async #sendTokenDelivery(from: string, token: string): Promise<void> {
    const { channel } = this.#deps;
    await channel.send(
      from,
      "Registration complete 🎉 Your CELLO agent pre-authorization token is ready — valid for 24 hours, single use.\n\n" +
        'On a device with the CELLO CLI installed and logged in (run "cello login" first), run these two commands:\n\n' +
        "# Replace [YOUR_NAME] with a name for your agent — letters, numbers, _ and - only, no spaces.\n" +
        "cello create-agent [YOUR_NAME]\n\n" +
        "# Use the SAME name; the token is already filled in.\n" +
        `cello register [YOUR_NAME] ${token}\n\n` +
        'Then run "cello status" to confirm your agent is online.\n\n' +
        "Thank you for choosing CELLO — happy agent-to-agent communicating!",
    );
    // ② the bare token, for clean one-tap copy.
    await channel.send(from, token);
  }

  async #retryPreAuth(record: RegistrationRecord, from: string): Promise<RegistrationRecord> {
    const { preAuth, channel, repository, logger } = this.#deps;
    const correlationId = randomUUID();

    let token: string;
    try {
      const result = await preAuth.requestToken(
        record.phoneStubHash,
        record.emailStubHash ?? "",
        record.id,
      );
      // #2b: deliver the short claim-code the operator types; falls back to the full capability blob if
      // the directory didn't return a claim_code (older directory). `token` is only relayed + logged here.
      token = result.claimCode ?? result.token;
    } catch (err) {
      const httpStatus = err instanceof PreAuthRequestError ? err.httpStatus : 0;
      logger.error("registration.preauth.request.failed", err instanceof Error ? err : new Error(String(err)), {
        registrationId: record.id,
        httpStatus,
        correlationId,
      });
      await channel.send(
        from,
        PREAUTH_SERVER_ERROR_MSG,
      );
      return record;
    }

    const completed = await repository.transition(record.id, "PRE_AUTH_TOKEN_ISSUED");

    // Upsert channel identity for permanent notification routing
    try {
      await repository.upsertChannelIdentity(
        completed.phoneStubHash,
        completed.channel,
        completed.channelUserId,
      );
      logger.info("registration.channel_identity.upserted", {
        registrationId: record.id,
        channel: completed.channel,
        correlationId,
      });
    } catch (err) {
      logger.error("registration.channel_identity.upsert_failed", err instanceof Error ? err : new Error(String(err)), {
        registrationId: record.id,
        channel: completed.channel,
        correlationId,
      });
    }

    const tokenId = token.slice(0, 8);
    logger.info("registration.completed", {
      registrationId: record.id,
      tokenId,
      correlationId,
    });

    // OA-1: same real-next-steps delivery as the primary path (shared helper — no drift).
    await this.#sendTokenDelivery(from, token);

    return completed;
  }

  /**
   * Check and increment the rate limiter for a given email domain.
   * Returns true if rate-limited (caller should abort and send notification), false if within limit.
   * Emits registration.otp.rate_limited at WARN if limit exceeded.
   * Does NOT send any channel message — the caller is responsible for awaiting the notification.
   */
  #isRateLimited(emailDomain: string, registrationId: string, correlationId: string): boolean {
    const now = new Date();
    const entry = this.#rateLimitMap.get(emailDomain);

    if (entry) {
      const windowAge = now.getTime() - entry.windowStart.getTime();
      if (windowAge > OTP_RATE_WINDOW_MS) {
        // Window expired — reset
        this.#rateLimitMap.set(emailDomain, { count: 1, windowStart: now });
        return false;
      }

      if (entry.count >= OTP_RATE_LIMIT_PER_HOUR) {
        this.#deps.logger.warn("registration.otp.rate_limited", {
          registrationId,
          emailDomain,
          sendCount: entry.count,
          correlationId,
        });
        return true;
      }

      entry.count++;
    } else {
      this.#rateLimitMap.set(emailDomain, { count: 1, windowStart: now });
    }

    return false;
  }
}

