/**
 * telegram-adapter.ts — TelegramAdapter implementing MessagingChannel.
 *
 * Phase P — Pseudocode:
 *
 *   constructor(opts):
 *     store token, logger, optional fetch override
 *     baseUrl = `https://api.telegram.org/bot${token}/`
 *     offset = 0
 *     lastContactByFrom = Map<string, TelegramContact>
 *     messageHandler = undefined
 *     botUsername = undefined (populated by start())
 *
 *   async start({ skipPolling? }):
 *     // Call getMe to get botUsername for logging
 *     response = await fetch(baseUrl + 'getMe')
 *     botUsername = response.result.username
 *     // Log telegram.polling.started (no correlationId per spec)
 *     logger.info("telegram.polling.started", { botUsername })
 *     // Optionally start background polling
 *     if !skipPolling: #startPollingLoop()
 *
 *   async pollOnce():
 *     // One iteration of the getUpdates loop
 *     // Called by #startPollingLoop() and exposed for testing
 *     updates = await #getUpdates()
 *     for update of updates:
 *       await processUpdate(update)
 *       offset = update.update_id + 1
 *
 *   async processUpdate(update):
 *     // Normalize to handler call
 *     correlationId = randomUUID()
 *     from = update.message.from.id.toString()
 *     if update.message.contact:
 *       store contact in lastContactByFrom[from]
 *       if contact.user_id === update.message.from.id:
 *         logger.info("telegram.contact.verified", { fromId, correlationId })
 *         call handler(from, `CONTACT:${from}:${contact.phone_number}`)
 *       else:
 *         logger.warn("telegram.contact.mismatch", { fromId, contactUserId, correlationId })
 *         // Do not send CONTACT message — state machine won't advance
 *         call handler(from, "__contact_mismatch__")
 *     else if update.message.text:
 *       logger.debug("telegram.message.received", { fromId, messageLength, correlationId })
 *       call handler(from, update.message.text)
 *
 *   async send(to, message):
 *     // Build body; attach ReplyKeyboardMarkup for contact-prompt messages
 *     correlationId = randomUUID()
 *     body = { chat_id: to, text: message }
 *     if message.startsWith(CONTACT_PROMPT_PREFIX): strip prefix; attach ReplyKeyboardMarkup
 *     response = await fetch(baseUrl + 'sendMessage', { method: POST, body: JSON.stringify(body) })
 *     if !response.ok:
 *       const { error_code, description } = await response.json()
 *       logger.warn("telegram.api.error", { method: 'sendMessage', errorCode: String(error_code), description, correlationId })
 *       throw new Error(description)
 *     // Spec: send() Promise<void>, but we resolve normally on success
 *
 *   async resolveIdentity(from):
 *     contact = lastContactByFrom.get(from)
 *     if contact exists:
 *       if contact.user_id === parseInt(from):
 *         return { channel: 'telegram', channelUserId: from, phoneNumber: contact.phone_number }
 *       else:
 *         return { channel: 'telegram', channelUserId: from }  // phoneNumber: undefined
 *     return { channel: 'telegram', channelUserId: from }
 *
 *   async #getUpdates():
 *     // getUpdates with timeout=25 (long polling)
 *     response = await fetch(baseUrl + 'getUpdates', { method: POST, body: { offset, timeout: 25 } })
 *     if response.status === 409:
 *       logger.error("telegram.poller.conflict", { botUsername })
 *       process.exit(1)
 *     if !response.ok:
 *       const body = await response.json()
 *       logger.warn("telegram.api.error", { method: 'getUpdates', errorCode, description, correlationId })
 *       throw (so polling loop can continue)
 *     return response.result
 *
 * Contact prompt detection:
 *   The state machine prefixes contact-prompt messages with CONTACT_PROMPT_PREFIX ("__REQUEST_CONTACT__:").
 *   send() strips the prefix before sending and attaches a ReplyKeyboardMarkup with request_contact.
 *   RFC references: N/A (no cryptographic operations in this adapter).
 *
 * SI-002: Token never logged. The baseUrl contains the token (as is standard for Telegram
 *   Bot API), but the baseUrl is never logged. Only botUsername appears in log events.
 */

import { randomUUID } from "node:crypto";
import type { MessagingChannel, ChannelIdentity, Logger } from "@cello-protocol/interfaces";

// ─── Telegram API types ───────────────────────────────────────────────────────

interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

interface TelegramContact {
  phone_number: string;
  first_name: string;
  user_id?: number;
}

interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: { id: number; type: string };
  date: number;
  text?: string;
  contact?: TelegramContact;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

interface TelegramGetUpdatesResult {
  ok: boolean;
  result: TelegramUpdate[];
}

interface TelegramSendMessageResult {
  ok: boolean;
  result?: {
    message_id: number;
    [key: string]: unknown;
  };
  error_code?: number;
  description?: string;
}

interface TelegramGetMeResult {
  ok: boolean;
  result: {
    id: number;
    username: string;
    first_name: string;
  };
  error_code?: number;
  description?: string;
}

// ─── Constructor options ──────────────────────────────────────────────────────

export type TelegramAdapterOptions = {
  /** Bot token — never logged, never included in any observable event. */
  token: string;
  /** Injected logger. */
  logger: Logger;
  /**
   * Optional fetch override — defaults to globalThis.fetch.
   * Pass a mock in unit tests to avoid network calls.
   */
  fetch?: typeof globalThis.fetch;
};

export type StartOptions = {
  /**
   * If true, skip starting the background polling loop.
   * Used in unit tests where pollOnce() is called manually.
   */
  skipPolling?: boolean;
};

// ─── Contact prompt detection ─────────────────────────────────────────────────

/**
 * Sentinel prefix emitted by RegistrationStateMachine for messages that require a
 * contact-sharing keyboard in Telegram. The adapter strips the prefix before sending
 * and attaches a ReplyKeyboardMarkup with request_contact button.
 * Must stay in sync with CONTACT_PROMPT_PREFIX in state-machine.ts.
 */
const CONTACT_PROMPT_PREFIX = "__REQUEST_CONTACT__:";

// ─── TelegramAdapter ──────────────────────────────────────────────────────────

/**
 * TelegramAdapter — MessagingChannel implementation over the Telegram Bot API.
 *
 * Long-polls via getUpdates (timeout=25s). Normalizes Telegram updates to the
 * MessagingChannel interface. Handles contact events with user_id verification (SI-001).
 * Never logs the bot token (SI-002).
 */
export class TelegramAdapter implements MessagingChannel {
  readonly #token: string;
  readonly #logger: Logger;
  readonly #fetch: typeof globalThis.fetch;
  readonly #baseUrl: string;

  /** Current getUpdates offset. Advances to update_id + 1 after processing. */
  #offset: number = 0;

  /** Bot username — populated by start() via getMe. */
  #botUsername: string = "";

  /** Registered inbound message handler. */
  #messageHandler: ((from: string, message: string) => void | Promise<void>) | undefined;

  /**
   * Last contact update received per from-ID.
   * Used by resolveIdentity() to verify contact.user_id === message.from.id.
   */
  readonly #lastContactByFrom: Map<string, TelegramContact & { fromId: number }> = new Map();

  /** Whether the background polling loop is running. */
  #pollingActive: boolean = false;

  constructor(opts: TelegramAdapterOptions) {
    this.#token = opts.token;
    this.#logger = opts.logger;
    this.#fetch = opts.fetch ?? globalThis.fetch;
    // SI-002: baseUrl contains the token but is never logged — only used for API calls.
    this.#baseUrl = `https://api.telegram.org/bot${opts.token}/`;
  }

  // ─── MessagingChannel implementation ───────────────────────────────────────

  /**
   * Send a text message to the user identified by `to` (Telegram chat_id as string).
   * Attaches a ReplyKeyboardMarkup with request_contact button when the message
   * is a contact-prompt (state machine AWAITING_CONTACT messages).
   *
   * Logs telegram.api.error at WARN and throws on API error or network failure.
   */
  async send(to: string, message: string): Promise<void> {
    const correlationId = randomUUID();
    const url = `${this.#baseUrl}sendMessage`;

    const isContactPrompt = message.startsWith(CONTACT_PROMPT_PREFIX);
    const text = isContactPrompt ? message.slice(CONTACT_PROMPT_PREFIX.length) : message;

    const body: Record<string, unknown> = {
      chat_id: to,
      text,
    };

    if (isContactPrompt) {
      body.reply_markup = {
        keyboard: [[{ text: "Share Phone Number", request_contact: true }]],
        one_time_keyboard: true,
        resize_keyboard: true,
      };
    }

    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (err) {
      // Network error (ECONNREFUSED, etc.)
      const error = err instanceof Error ? err : new Error(String(err));
      // Extract error code from cause or code property
      const code =
        (error as NodeJS.ErrnoException).code ??
        ((error.cause as NodeJS.ErrnoException)?.code ?? "NETWORK_ERROR");
      this.#logger.warn("telegram.api.error", {
        method: "sendMessage",
        errorCode: code,
        description: error.message,
        correlationId,
      });
      throw error;
    }

    if (!response.ok) {
      const resBody = await response.json() as TelegramSendMessageResult;
      const errorCode = resBody.error_code !== undefined ? String(resBody.error_code) : String(response.status);
      const description = resBody.description ?? "Unknown error";
      this.#logger.warn("telegram.api.error", {
        method: "sendMessage",
        errorCode,
        description,
        correlationId,
      });
      throw new Error(`Telegram sendMessage failed: ${description}`);
    }
  }

  /**
   * Register the inbound message handler.
   * Called once at startup. The handler receives (from, message) where:
   *   - from: Telegram user ID as a string
   *   - message: text content, or "CONTACT:<user_id>:<phone>" for verified contact events
   */
  onMessage(handler: (from: string, message: string) => void | Promise<void>): void {
    this.#messageHandler = handler;
  }

  /**
   * Resolve the full channel identity for a given channel-native sender address.
   *
   * For contact events with matching user_id: returns phoneNumber.
   * For contact events with mismatched user_id (SI-001): returns phoneNumber = undefined.
   * For text-only messages: returns phoneNumber = undefined.
   */
  async resolveIdentity(from: string): Promise<ChannelIdentity> {
    const stored = this.#lastContactByFrom.get(from);
    if (stored) {
      if (stored.user_id === stored.fromId) {
        return {
          channel: "telegram",
          channelUserId: from,
          phoneNumber: stored.phone_number,
        };
      }
      // user_id mismatch — SI-001: do not return the phone number
      return { channel: "telegram", channelUserId: from };
    }
    return { channel: "telegram", channelUserId: from };
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Initialize the adapter: call getMe to obtain botUsername, log
   * telegram.polling.started, and optionally start the background polling loop.
   */
  async start(opts?: StartOptions): Promise<void> {
    const meUrl = `${this.#baseUrl}getMe`;
    const meResponse = await this.#fetch(meUrl, { method: "GET" });
    const meBody = await meResponse.json() as TelegramGetMeResult;

    if (!meResponse.ok || !meBody.ok) {
      throw new Error(
        `TelegramAdapter: getMe failed: ${meBody.description ?? "unknown error"}`,
      );
    }

    this.#botUsername = meBody.result.username;

    // SI-002: log only botUsername, never the token
    this.#logger.info("telegram.polling.started", { botUsername: this.#botUsername });

    if (!opts?.skipPolling) {
      this.#pollingActive = true;
      void this.#runPollingLoop();
    }
  }

  /**
   * Stop the background polling loop. Used in tests and graceful shutdown.
   */
  stop(): void {
    this.#pollingActive = false;
  }

  // ─── Polling ────────────────────────────────────────────────────────────────

  /**
   * Execute a single getUpdates poll cycle.
   * Processes each update and advances offset.
   * Exposed as public for testing (unit and integration tests call this directly).
   *
   * On HTTP 409: logs telegram.poller.conflict at ERROR and calls process.exit(1).
   * On other API errors: logs telegram.api.error at WARN and continues.
   */
  async pollOnce(): Promise<void> {
    let updates: TelegramUpdate[];
    try {
      updates = await this.#getUpdates();
    } catch {
      // #getUpdates already logged the error; on 409, process.exit was called.
      // For other errors, back off 1 second before returning so the polling loop
      // does not hammer the Telegram API under failure conditions (L-002).
      await new Promise<void>((r) => setTimeout(r, 1000));
      return;
    }

    for (const update of updates) {
      await this.processUpdate(update);
      this.#offset = update.update_id + 1;
    }
  }

  /**
   * Process a single Telegram update object.
   * Exposed as public for unit tests that inject synthetic updates.
   *
   * For text messages: calls handler(from, text) with telegram.message.received DEBUG.
   * For contact events with matching user_id: calls handler(from, "CONTACT:<from>:<phone>")
   *   with telegram.contact.verified INFO.
   * For contact events with mismatched user_id (SI-001): stores the contact (so resolveIdentity
   *   can return phoneNumber=undefined), logs telegram.contact.mismatch WARN, and calls
   *   handler(from, "__contact_mismatch__") so the state machine re-prompts.
   */
  async processUpdate(update: TelegramUpdate): Promise<void> {
    if (!update.message) return;

    const msg = update.message;
    if (!msg.from) return;

    const fromId = msg.from.id;
    const from = String(fromId);
    const correlationId = randomUUID();

    if (msg.contact) {
      const contact = msg.contact;
      const contactUserId = contact.user_id;

      // Store the contact for resolveIdentity — including the actual sender's ID
      this.#lastContactByFrom.set(from, {
        phone_number: contact.phone_number,
        first_name: contact.first_name,
        user_id: contactUserId,
        fromId,
      });

      if (contactUserId !== undefined && contactUserId === fromId) {
        // Valid contact event: user_id matches message.from.id
        this.#logger.info("telegram.contact.verified", { fromId, correlationId });
        // Deliver as CONTACT:<from>:<phone> so state machine's regex matches
        if (this.#messageHandler) {
          await this.#messageHandler(from, `CONTACT:${from}:${contact.phone_number}`);
        }
      } else {
        // SI-001: user_id does not match from.id — shared someone else's contact
        this.#logger.warn("telegram.contact.mismatch", {
          fromId,
          contactUserId,
          correlationId,
        });
        // Do NOT deliver as CONTACT: message — state machine won't advance
        // Deliver a non-matching message so the state machine re-prompts
        if (this.#messageHandler) {
          await this.#messageHandler(from, "__contact_mismatch__");
        }
      }
    } else if (msg.text) {
      this.#logger.debug("telegram.message.received", {
        fromId,
        messageLength: msg.text.length,
        correlationId,
      });
      if (this.#messageHandler) {
        await this.#messageHandler(from, msg.text);
      }
    }
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  /**
   * Background polling loop. Calls pollOnce() in a loop while #pollingActive.
   * On HTTP 409, process.exit(1) is called inside #getUpdates — loop terminates.
   * On other errors, continues after logging.
   */
  async #runPollingLoop(): Promise<void> {
    while (this.#pollingActive) {
      await this.pollOnce();
    }
  }

  /**
   * Call getUpdates with the current offset and long-poll timeout.
   *
   * On HTTP 409 Conflict: logs telegram.poller.conflict at ERROR, calls process.exit(1).
   * On other non-OK responses: logs telegram.api.error at WARN, throws.
   * On network error: logs telegram.api.error at WARN, throws.
   *
   * Returns the array of TelegramUpdate objects on success.
   */
  async #getUpdates(): Promise<TelegramUpdate[]> {
    const url = `${this.#baseUrl}getUpdates`;
    const correlationId = randomUUID();

    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offset: this.#offset, timeout: 25 }),
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const code =
        (error as NodeJS.ErrnoException).code ??
        ((error.cause as NodeJS.ErrnoException)?.code ?? "NETWORK_ERROR");
      this.#logger.warn("telegram.api.error", {
        method: "getUpdates",
        errorCode: code,
        description: error.message,
        correlationId,
      });
      throw error;
    }

    if (response.status === 409) {
      // SI-002: log only botUsername, never the token
      this.#logger.error("telegram.poller.conflict", { botUsername: this.#botUsername });
      process.exit(1);
    }

    if (!response.ok) {
      const body = await response.json() as TelegramGetUpdatesResult & { error_code?: number; description?: string };
      const errorCode = (body as { error_code?: number }).error_code !== undefined
        ? String((body as { error_code?: number }).error_code)
        : String(response.status);
      const description = (body as { description?: string }).description ?? "Unknown error";
      this.#logger.warn("telegram.api.error", {
        method: "getUpdates",
        errorCode,
        description,
        correlationId,
      });
      throw new Error(`Telegram getUpdates failed: ${description}`);
    }

    const body = await response.json() as TelegramGetUpdatesResult;
    return body.result ?? [];
  }
}
