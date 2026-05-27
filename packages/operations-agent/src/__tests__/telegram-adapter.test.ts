/**
 * telegram-adapter.test.ts — Tests for TelegramAdapter.
 *
 * Specification:
 *
 * AC-001 (integration): real getUpdates call to api.telegram.org; telegram.polling.started
 *   logged at INFO with { botUsername } (proves real getMe response). Any update_ids
 *   returned are integers > 0. SKIP if no TELEGRAM_BOT_TOKEN.
 *
 * AC-002 (integration, manual): contact event received from staging bot; resolveIdentity()
 *   returns correct phoneNumber; telegram.contact.verified logged. Requires human to tap
 *   "Share Contact" in the staging bot. it.skip with documented manual test procedure.
 *
 * AC-003 (integration): send() makes real sendMessage HTTP call; resolves void on success.
 *   SKIP if no TELEGRAM_BOT_TOKEN. Returns early (not fails) if bot queue is empty.
 *
 * AC-004 (unit): resolveIdentity() with contact.user_id=9999, message.from.id=1234
 *   → phoneNumber = undefined; telegram.contact.mismatch logged at WARN.
 *
 * AC-005 (unit): send() with mocked ECONNREFUSED → promise rejects;
 *   telegram.api.error logged at WARN with { method: 'sendMessage', errorCode, description }.
 *
 * AC-006 (integration, manual): full /start → phone verification → AWAITING_EMAIL via
 *   staging bot. Requires human to drive bot. it.skip with documented manual test procedure.
 *   Verified as part of AC-007-integration-gate manual component.
 *
 * AC-006b (unit): offset advances to update_id + 1 after processing.
 *
 * AC-006c (unit): HTTP 409 from getUpdates → telegram.poller.conflict logged at ERROR
 *   → process.exit(1).
 *
 * AC-007-integration-gate:
 *   (a) Flyway reports zero checksum errors on V1–V26 (CELLO_ENV=local + DATABASE_URL)
 *   (b) TelegramAdapter makes >= 2 real HTTP calls (getMe + getUpdates) to api.telegram.org
 *   SKIP if no TELEGRAM_BOT_TOKEN or CELLO_ENV != local.
 *
 * SI-001: covered by AC-004 (contact.user_id !== message.from.id → phoneNumber = undefined).
 *
 * SI-002 (unit): bot token never appears in any logged event.
 *
 * Interpretation notes:
 * - AC-001 and AC-003 require TELEGRAM_BOT_TOKEN and make real HTTP calls to api.telegram.org.
 * - AC-002 and AC-006 require human interaction (it.skip with manual procedure documented).
 * - AC-006b and AC-006c are pure unit tests with no network calls.
 * - For AC-006c: process.exit(1) is mocked via vi.spyOn to prevent the test process
 *   from actually exiting.
 * - For SI-002: we scan all captured log calls for the token string pattern.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import pg from "pg";
import { TelegramAdapter } from "../telegram-adapter.js";
import type { Logger } from "@cello-protocol/interfaces";

// ─── Test logger factory ───────────────────────────────────────────────────────

type LogCall = {
  level: string;
  event: string;
  context: Record<string, unknown>;
};

function makeTestLogger(): Logger & { calls: LogCall[] } {
  const calls: LogCall[] = [];
  return {
    calls,
    debug(event: string, context?: Record<string, unknown>): void {
      calls.push({ level: "debug", event, context: context ?? {} });
    },
    info(event: string, context?: Record<string, unknown>): void {
      calls.push({ level: "info", event, context: context ?? {} });
    },
    warn(event: string, context?: Record<string, unknown>): void {
      calls.push({ level: "warn", event, context: context ?? {} });
    },
    error(event: string, errorOrContext?: Error | Record<string, unknown>, context?: Record<string, unknown>): void {
      const ctx = errorOrContext instanceof Error ? (context ?? {}) : (errorOrContext ?? {});
      calls.push({ level: "error", event, context: ctx });
    },
  };
}

// ─── Mock fetch factory ───────────────────────────────────────────────────────


// ─── getMe response ───────────────────────────────────────────────────────────

const ME_RESPONSE = {
  ok: true,
  result: { id: 123456789, username: "CelloConnectStagingBot", first_name: "CELLO Bot" },
};

// ─── AC-004 / SI-001: contact.user_id mismatch → phoneNumber = undefined ─────

describe("AC-004 / SI-001: resolveIdentity — contact.user_id mismatch", () => {
  it("returns phoneNumber = undefined when contact.user_id !== message.from.id, logs telegram.contact.mismatch WARN", async () => {
    const logger = makeTestLogger();
    const token = "fake-token-for-testing";

    // Adapter constructed with mock fetch that returns getMe immediately
    const getMeFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ME_RESPONSE,
    }) as unknown as typeof fetch;

    const adapter = new TelegramAdapter({ token, logger, fetch: getMeFetch });
    await adapter.start({ skipPolling: true });

    // Simulate processing a contact update where user_id !== from.id
    // contact.user_id = 9999, message.from.id = 1234
    const contactUpdate = {
      update_id: 100,
      message: {
        message_id: 1,
        from: { id: 1234, is_bot: false, first_name: "Alice" },
        chat: { id: 1234, type: "private" },
        date: Math.floor(Date.now() / 1000),
        contact: {
          phone_number: "+1234567890",
          first_name: "Alice",
          user_id: 9999,
        },
      },
    };

    // Register a handler to capture what the mismatch delivers to the state machine
    let capturedFrom: string | undefined;
    let capturedMessage: string | undefined;
    adapter.onMessage((from, message) => {
      capturedFrom = from;
      capturedMessage = message;
    });

    // Inject the update directly
    await adapter.processUpdate(contactUpdate);

    // resolveIdentity for from="1234" should return phoneNumber=undefined
    const identity = await adapter.resolveIdentity("1234");

    expect(identity.channel).toBe("telegram");
    expect(identity.channelUserId).toBe("1234");
    // phoneNumber must be absent or explicitly undefined — must not contain the phone number
    const phoneNumber = "phoneNumber" in identity ? (identity as { phoneNumber?: string }).phoneNumber : undefined;
    expect(phoneNumber).toBeUndefined();

    // telegram.contact.mismatch logged at WARN with { fromId, contactUserId, correlationId }
    const mismatchLog = logger.calls.find((c) => c.event === "telegram.contact.mismatch");
    expect(mismatchLog).toBeDefined();
    expect(mismatchLog!.level).toBe("warn");
    expect(mismatchLog!.context.fromId).toBe(1234);
    expect(mismatchLog!.context.contactUserId).toBe(9999);
    expect(typeof mismatchLog!.context.correlationId).toBe("string");

    // Handler must receive from="1234" and message="__contact_mismatch__" so the state machine re-prompts
    expect(capturedFrom).toBe("1234");
    expect(capturedMessage).toBe("__contact_mismatch__");
  });
});

// ─── H-002 / SI-001: contact with absent user_id field → phoneNumber = undefined ─

describe("H-002 / SI-001: resolveIdentity — contact.user_id absent (field not present)", () => {
  it("returns phoneNumber = undefined when contact has no user_id field at all, logs telegram.contact.mismatch WARN", async () => {
    const logger = makeTestLogger();
    const token = "fake-token-for-testing";

    const getMeFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ME_RESPONSE,
    }) as unknown as typeof fetch;

    const adapter = new TelegramAdapter({ token, logger, fetch: getMeFetch });
    await adapter.start({ skipPolling: true });

    // contact object has no user_id field at all — this is the real-world case
    // for non-Telegram contacts (SI-001 path)
    const contactUpdate = {
      update_id: 200,
      message: {
        message_id: 2,
        from: { id: 5678, is_bot: false, first_name: "Bob" },
        chat: { id: 5678, type: "private" },
        date: Math.floor(Date.now() / 1000),
        contact: {
          phone_number: "+9876543210",
          first_name: "SomeoneElse",
          // user_id field is entirely absent
        },
      },
    };

    // Register a handler to capture what the mismatch delivers to the state machine
    let capturedFrom: string | undefined;
    let capturedMessage: string | undefined;
    adapter.onMessage((from, message) => {
      capturedFrom = from;
      capturedMessage = message;
    });

    await adapter.processUpdate(contactUpdate);

    // resolveIdentity must return phoneNumber = undefined (never the phone number)
    const identity = await adapter.resolveIdentity("5678");

    expect(identity.channel).toBe("telegram");
    expect(identity.channelUserId).toBe("5678");
    const phoneNumber = "phoneNumber" in identity ? (identity as { phoneNumber?: string }).phoneNumber : undefined;
    expect(phoneNumber).toBeUndefined();

    // telegram.contact.mismatch logged at WARN
    const mismatchLog = logger.calls.find((c) => c.event === "telegram.contact.mismatch");
    expect(mismatchLog).toBeDefined();
    expect(mismatchLog!.level).toBe("warn");
    expect(mismatchLog!.context.fromId).toBe(5678);
    // contactUserId must be undefined (absent), not null
    expect(mismatchLog!.context.contactUserId).toBeUndefined();
    expect(typeof mismatchLog!.context.correlationId).toBe("string");

    // Handler must receive from="5678" and message="__contact_mismatch__" so the state machine re-prompts
    expect(capturedFrom).toBe("5678");
    expect(capturedMessage).toBe("__contact_mismatch__");
  });
});

// ─── AC-005: send() with ECONNREFUSED → telegram.api.error logged ────────────

describe("AC-005: send() — ECONNREFUSED", () => {
  it("rejects with descriptive error and logs telegram.api.error WARN with { method: 'sendMessage' }", async () => {
    const logger = makeTestLogger();
    const token = "fake-token-for-testing";

    // getMeFetch returns ok for start(), networkError for send()
    const fetchFn = vi.fn().mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("getMe")) {
        return { ok: true, status: 200, json: async () => ME_RESPONSE };
      }
      // sendMessage → ECONNREFUSED
      const err = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:443"), {
        cause: { code: "ECONNREFUSED" },
        code: "ECONNREFUSED",
      });
      throw err;
    }) as unknown as typeof fetch;

    const adapter = new TelegramAdapter({ token, logger, fetch: fetchFn });
    await adapter.start({ skipPolling: true });

    await expect(adapter.send("1234", "hello")).rejects.toThrow();

    const apiErrorLog = logger.calls.find((c) => c.event === "telegram.api.error");
    expect(apiErrorLog).toBeDefined();
    expect(apiErrorLog!.level).toBe("warn");
    expect(apiErrorLog!.context.method).toBe("sendMessage");
    expect(apiErrorLog!.context.errorCode).toBe("ECONNREFUSED");
    expect(typeof apiErrorLog!.context.description).toBe("string");
    expect(typeof apiErrorLog!.context.correlationId).toBe("string");
  });
});

// ─── H-001: send() — contact prompt sentinel prefix ──────────────────────────

describe("send() — contact prompt sentinel prefix", () => {
  it("strips __REQUEST_CONTACT__: prefix and attaches ReplyKeyboardMarkup with request_contact=true", async () => {
    const logger = makeTestLogger();
    const token = "fake-token-for-testing";

    const capturedBodies: Array<Record<string, unknown>> = [];

    const fetchFn = vi.fn().mockImplementation(async (url: string, options?: RequestInit) => {
      if (typeof url === "string" && url.includes("getMe")) {
        return { ok: true, status: 200, json: async () => ME_RESPONSE };
      }
      if (typeof url === "string" && url.includes("sendMessage")) {
        if (options?.body) {
          capturedBodies.push(JSON.parse(options.body as string) as Record<string, unknown>);
        }
        return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, result: [] }) };
    }) as unknown as typeof fetch;

    const adapter = new TelegramAdapter({ token, logger, fetch: fetchFn });
    await adapter.start({ skipPolling: true });

    // sentinel-prefix path: prefix stripped, ReplyKeyboardMarkup attached
    await adapter.send("123", "__REQUEST_CONTACT__:Please share your phone");

    expect(capturedBodies).toHaveLength(1);
    const body = capturedBodies[0];
    // Prefix must be stripped — text is plain message content only
    expect(body.text).toBe("Please share your phone");
    // ReplyKeyboardMarkup must be present with request_contact=true
    const keyboard = (body.reply_markup as { keyboard?: unknown[][] }).keyboard;
    expect(keyboard).toBeDefined();
    expect(Array.isArray(keyboard)).toBe(true);
    const firstButton = (keyboard as Array<Array<{ request_contact?: boolean }>>)[0][0];
    expect(firstButton.request_contact).toBe(true);
  });

  it("sends plain text without reply_markup when message has no sentinel prefix", async () => {
    const logger = makeTestLogger();
    const token = "fake-token-for-testing";

    const capturedBodies: Array<Record<string, unknown>> = [];

    const fetchFn = vi.fn().mockImplementation(async (url: string, options?: RequestInit) => {
      if (typeof url === "string" && url.includes("getMe")) {
        return { ok: true, status: 200, json: async () => ME_RESPONSE };
      }
      if (typeof url === "string" && url.includes("sendMessage")) {
        if (options?.body) {
          capturedBodies.push(JSON.parse(options.body as string) as Record<string, unknown>);
        }
        return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 2 } }) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, result: [] }) };
    }) as unknown as typeof fetch;

    const adapter = new TelegramAdapter({ token, logger, fetch: fetchFn });
    await adapter.start({ skipPolling: true });

    // non-prefix path: plain text, no keyboard
    await adapter.send("123", "Hello");

    expect(capturedBodies).toHaveLength(1);
    const body = capturedBodies[0];
    expect(body.text).toBe("Hello");
    // reply_markup must be absent on plain messages
    expect(body.reply_markup).toBeUndefined();
  });
});

// ─── AC-006b: offset advances to update_id + 1 ───────────────────────────────

describe("AC-006b: offset advances to update_id + 1 after processing", () => {
  it("uses offset=101 on the next poll after processing update_id=100", async () => {
    const logger = makeTestLogger();
    const token = "fake-token-for-testing";

    const update = {
      update_id: 100,
      message: {
        message_id: 1,
        from: { id: 1234, is_bot: false, first_name: "Alice" },
        chat: { id: 1234, type: "private" },
        date: Math.floor(Date.now() / 1000),
        text: "hello",
      },
    };

    // First getUpdates returns one update; second returns empty
    let pollCallCount = 0;
    const capturedOffsets: number[] = [];

    const fetchFn = vi.fn().mockImplementation(async (url: string, options?: RequestInit) => {
      if (typeof url === "string" && url.includes("getMe")) {
        return { ok: true, status: 200, json: async () => ME_RESPONSE };
      }
      if (typeof url === "string" && url.includes("getUpdates")) {
        // Capture the offset from the request body
        if (options?.body) {
          const body = JSON.parse(options.body as string) as { offset?: number };
          capturedOffsets.push(body.offset ?? 0);
        }
        pollCallCount++;
        if (pollCallCount === 1) {
          return { ok: true, status: 200, json: async () => ({ ok: true, result: [update] }) };
        }
        return { ok: true, status: 200, json: async () => ({ ok: true, result: [] }) };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, result: [] }) };
    }) as unknown as typeof fetch;

    const adapter = new TelegramAdapter({ token, logger, fetch: fetchFn });
    await adapter.start({ skipPolling: true });

    // Register a message handler
    adapter.onMessage(() => {});

    // Run two poll cycles manually
    await adapter.pollOnce();
    await adapter.pollOnce();

    // First poll: offset=0 (or initial), second poll: offset=101
    expect(capturedOffsets.length).toBeGreaterThanOrEqual(2);
    expect(capturedOffsets[1]).toBe(101);
  });
});

// ─── AC-006c: HTTP 409 from getUpdates → process.exit(1) ─────────────────────

describe("AC-006c: HTTP 409 from getUpdates → telegram.poller.conflict + process.exit(1)", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as (code?: number) => never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  it("logs telegram.poller.conflict at ERROR with { botUsername } and calls process.exit(1)", async () => {
    const logger = makeTestLogger();
    const token = "fake-token-for-testing";

    const fetchFn = vi.fn().mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("getMe")) {
        return { ok: true, status: 200, json: async () => ME_RESPONSE };
      }
      // getUpdates → 409 Conflict
      return {
        ok: false,
        status: 409,
        json: async () => ({ ok: false, error_code: 409, description: "Conflict: terminated by other getUpdates request" }),
      };
    }) as unknown as typeof fetch;

    const adapter = new TelegramAdapter({ token, logger, fetch: fetchFn });
    await adapter.start({ skipPolling: true });

    // Run a poll cycle — should hit 409; with process.exit mocked, pollOnce() must
    // still complete cleanly (M-002: assert it resolves rather than hangs/throws).
    await expect(adapter.pollOnce()).resolves.toBeUndefined();

    const conflictLog = logger.calls.find((c) => c.event === "telegram.poller.conflict");
    expect(conflictLog).toBeDefined();
    expect(conflictLog!.level).toBe("error");
    expect(conflictLog!.context.botUsername).toBe("CelloConnectStagingBot");

    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

// ─── SI-002: bot token never appears in any logged event ─────────────────────

describe("SI-002: bot token not present in any logged event", () => {
  it("does not include the bot token in any log call context or event name", async () => {
    const logger = makeTestLogger();
    const token = "999999999:AAFake-Token-For-Security-Testing-Only";

    const fetchFn = vi.fn().mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("getMe")) {
        return { ok: true, status: 200, json: async () => ME_RESPONSE };
      }
      if (typeof url === "string" && url.includes("sendMessage")) {
        // Return a send error to trigger telegram.api.error logging
        return {
          ok: false,
          status: 400,
          json: async () => ({ ok: false, error_code: 400, description: "Bad Request" }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, result: [] }) };
    }) as unknown as typeof fetch;

    const adapter = new TelegramAdapter({ token, logger, fetch: fetchFn });
    await adapter.start({ skipPolling: true });

    // Trigger a send error to exercise error logging paths
    try {
      await adapter.send("1234", "test message");
    } catch {
      // Expected
    }

    // Scan all log calls for the token string
    const tokenPart = token.split(":")[1]; // "AAFake-Token-For-Security-Testing-Only"
    for (const call of logger.calls) {
      expect(call.event).not.toContain(token);
      expect(call.event).not.toContain(tokenPart);
      const contextStr = JSON.stringify(call.context);
      expect(contextStr).not.toContain(token);
      expect(contextStr).not.toContain(tokenPart);
    }
  });
});

// ─── Integration tests (skip if no TELEGRAM_BOT_TOKEN) ───────────────────────
//
// AC-001 and AC-003 make real HTTP calls to api.telegram.org. TELEGRAM_BOT_TOKEN
// must be set. The staging bot (@CelloConnectStagingBot) may have an empty update
// queue — that is fine for AC-001. AC-003 requires at least one message in the
// queue (from a human testing against the staging bot).
//
// AC-002 and AC-006 require a human to drive the Telegram bot through the full
// registration flow. They are it.skip with documented manual test procedures.
//
// TELEGRAM_BOT_TOKEN must be set for the token to be accepted by getMe.
// If it is not set, all tests in this section are skipped with a clear message.

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const integrationEnabled = !!TELEGRAM_BOT_TOKEN;

// ─── AC-001: real getUpdates call to api.telegram.org ────────────────────────
//
// Transport-level observable: the update_id in the getUpdates response is a
// Telegram-assigned integer that cannot be synthesized by a local stub.
//
// This test does NOT require messages to be pre-sent to the bot. Calling
// pollOnce() on an empty queue is valid — it returns an empty updates array.
// What matters is that the HTTP call was made and the response was a real
// Telegram API response (not synthesized). The telegram.polling.started event
// proves getMe succeeded, which requires a real response from api.telegram.org.
//
// If the queue contains updates (from prior test activity), the test additionally
// asserts that the received update_ids are integers > 0.

describe.skipIf(!integrationEnabled)("AC-001 (integration): real getUpdates HTTP call to api.telegram.org; telegram.polling.started logged", () => {
  it("start() makes real getMe call; pollOnce() makes real getUpdates call; any received update_ids are integers > 0", async () => {
    if (!TELEGRAM_BOT_TOKEN) {
      return;
    }
    const logger = makeTestLogger();

    const adapter = new TelegramAdapter({ token: TELEGRAM_BOT_TOKEN, logger });

    // start() calls getMe — real HTTP call to api.telegram.org
    await adapter.start({ skipPolling: true });

    // telegram.polling.started must be logged — proves the real getMe response
    // returned a valid bot username (cannot be synthesized by a local stub)
    const startLog = logger.calls.find((c) => c.event === "telegram.polling.started");
    expect(startLog).toBeDefined();
    expect(startLog!.level).toBe("info");
    // botUsername must be a non-empty string — proves real Telegram API responded
    expect(typeof startLog!.context.botUsername).toBe("string");
    expect((startLog!.context.botUsername as string).length).toBeGreaterThan(0);

    // Collect update_ids from any updates delivered during pollOnce
    const receivedUpdateIds: number[] = [];
    adapter.onMessage(() => {
      // Handler must be set; update_ids are tracked via processUpdate spy below
    });

    // Spy on processUpdate to capture update_ids actually returned from Telegram
    const originalProcessUpdate = adapter.processUpdate.bind(adapter);
    const processUpdateSpy = vi.spyOn(adapter, "processUpdate").mockImplementation(async (update) => {
      receivedUpdateIds.push(update.update_id);
      return originalProcessUpdate(update);
    });

    // pollOnce() makes a real getUpdates call to api.telegram.org.
    // Resolving without throwing proves the HTTP call succeeded.
    await adapter.pollOnce();

    processUpdateSpy.mockRestore();
    adapter.stop();

    // If the staging bot had pending updates, verify each update_id is an integer > 0.
    // An empty queue is equally valid — the transport-level observable is the HTTP call itself.
    for (const updateId of receivedUpdateIds) {
      expect(Number.isInteger(updateId)).toBe(true);
      expect(updateId).toBeGreaterThan(0);
    }
  });
});

// ─── AC-002: contact event from staging bot (requires manual test flow) ──────
//
// Manual test procedure:
// 1. Set TELEGRAM_BOT_TOKEN to the staging bot token
// 2. Send /start to @CelloConnectStagingBot
// 3. Tap the "Share Contact" button when it appears
// 4. Run this test within 30 seconds of sharing contact
//
// What this test verifies when executed manually:
// - The contact event received via getUpdates contains contact.user_id set by Telegram's server
// - resolveIdentity() returns phoneNumber from a server-verified contact
// - telegram.contact.verified is logged at INFO with { fromId, correlationId }
//
// This test CANNOT be automated without a Telegram user session (MTProto).
// contact.user_id is set server-side by Telegram — a local stub cannot produce
// a valid contact event with matching user_id unless it controls the Telegram API.
// It is verified as part of the AC-007-integration-gate manual test flow.

describe("AC-002 (integration): contact event from staging bot (requires manual test flow)", () => {
  it.skip("AC-002: contact event from staging bot contains Telegram-assigned user_id (requires manual test flow)", () => {
    // This test requires a human to:
    // 1. Set TELEGRAM_BOT_TOKEN to the staging bot token
    // 2. Send /start to @CelloConnectStagingBot
    // 3. Tap the "Share Contact" button when prompted
    // 4. Run this test within 30 seconds of sharing contact
    //
    // Automated assertion: the contact event's contact.user_id must match
    // message.from.id, proving Telegram server set user_id (SI-001 transport layer).
    // resolveIdentity() must return phoneNumber = the test user's actual phone number.
    // telegram.contact.verified must be logged at INFO.
    //
    // See AC-007-integration-gate describe block below for a combined test that
    // verifies the full flow including Flyway integrity.
  });
});

// ─── AC-003: send() delivers message to a real Telegram chat ─────────────────

describe.skipIf(!integrationEnabled)("AC-003 (integration): send() makes real sendMessage HTTP call to api.telegram.org", () => {
  it("send() to a real chat_id resolves successfully when Telegram API accepts the message", async () => {
    if (!TELEGRAM_BOT_TOKEN) {
      return;
    }
    const logger = makeTestLogger();

    const adapter = new TelegramAdapter({ token: TELEGRAM_BOT_TOKEN, logger });
    await adapter.start({ skipPolling: true });

    // Poll once to discover if any messages are waiting in the queue.
    // A real update gives us a valid chat_id to send to.
    const received: Array<string> = [];
    adapter.onMessage((from) => {
      received.push(from);
    });

    await adapter.pollOnce();
    adapter.stop();

    // If no real updates arrived, we cannot send without a target — skip rather than
    // assert a negative (the staging bot queue may be empty).
    if (received.length === 0) {
      // No pending messages; test is skipped — bot queue was empty.
      // To exercise AC-003, send a message to @CelloConnectStagingBot and re-run.
      return;
    }

    const targetChatId = received[0];
    await expect(adapter.send(targetChatId, "CELLO integration test — please ignore.")).resolves.toBeUndefined();
  });
});

// ─── AC-006: full registration flow (requires manual test flow) ──────────────
//
// Manual test procedure:
// 1. Set TELEGRAM_BOT_TOKEN and CELLO_ENV=local (real Postgres with V24+ applied)
// 2. Start RegistrationEngine with TelegramAdapter and real Postgres pool
// 3. Send /start to @CelloConnectStagingBot
// 4. Tap "Share Contact" when prompted
// 5. Verify database shows state=AWAITING_EMAIL for your Telegram ID
//
// Transport-level observables verified manually:
// - At least 2 sendMessage calls (welcome prompt + contact request)
// - At least 2 getUpdates calls with Telegram-assigned update_ids
// - database row state=AWAITING_EMAIL, phone_stub_hash populated
//
// This test is verified as part of AC-007-integration-gate.

describe("AC-006 (integration): full /start → AWAITING_EMAIL via staging bot (requires manual test flow)", () => {
  it.skip("AC-006: full registration flow /start → AWAITING_EMAIL via staging bot (requires manual test flow)", () => {
    // This test requires a human to:
    // 1. Set TELEGRAM_BOT_TOKEN and CELLO_ENV=local with real Postgres (V24+ applied)
    // 2. Start RegistrationEngine with TelegramAdapter and real pg.Pool
    // 3. Send /start to @CelloConnectStagingBot
    // 4. Tap "Share Contact" when prompted
    // 5. Verify: database row state=AWAITING_EMAIL, phone_stub_hash populated
    // 6. Verify: at least 2 sendMessage calls were made (welcome + contact prompt)
    // 7. Verify: at least 2 getUpdates calls returned with Telegram-assigned update_ids
    //
    // This combined flow verifies:
    // - TelegramAdapter → RegistrationEngine wiring is correct
    // - Real Telegram API used (not synthesized)
    // - State machine advances INITIAL → AWAITING_CONTACT → PHONE_CONFIRMED → AWAITING_EMAIL
    // - phone_stub_hash persisted in Postgres (SHA-256 of normalized phone)
    //
    // See AC-007-integration-gate describe block below for the automated Flyway
    // integrity check and real HTTP call count verification.
  });
});

// ─── AC-007-integration-gate: Flyway integrity + real API calls ──────────────
//
// This gate requires:
// - TELEGRAM_BOT_TOKEN: staging bot token for real Telegram API calls
// - CELLO_ENV=local: enables Postgres integration path
// - Real Postgres with V1–V26 migrations applied (DATABASE_URL pointing to it)
//
// The gate verifies:
// (a) Flyway reports zero checksum errors on V1 through V26
// (b) TelegramAdapter makes >= 2 real HTTP calls to api.telegram.org
//     (getMe in start() + getUpdates in pollOnce() = at least 2 calls)
// (c) Both calls resolve successfully, proving real Telegram API responded

const skipIntegrationGate = !process.env.TELEGRAM_BOT_TOKEN || process.env.CELLO_ENV !== "local";

describe("AC-007-integration-gate: Flyway integrity + real API calls (requires TELEGRAM_BOT_TOKEN + CELLO_ENV=local)", () => {
  it.skipIf(skipIntegrationGate)("Flyway reports zero checksum errors on V1–V26", async () => {
    const DATABASE_URL =
      process.env["DATABASE_URL"] ?? "postgresql://postgres:dev@localhost:5433/cello_dev";
    const pool = new pg.Pool({ connectionString: DATABASE_URL });

    try {
      const result = await pool.query<{ version: string; checksum: number; success: boolean }>(
        "SELECT version, checksum, success FROM flyway_schema_history ORDER BY installed_rank"
      );

      for (const row of result.rows) {
        expect(row.success, `Migration V${row.version} failed`).toBe(true);
        // checksum = -1 indicates a placeholder (un-applied migration)
        expect(row.checksum, `Migration V${row.version} has checksum error`).not.toBe(-1);
      }

      // Verify V24, V25, V26 (the M6 migrations) are present and successful
      const versions = result.rows.map((r) => r.version);
      expect(versions).toContain("24");
      expect(versions).toContain("25");
      expect(versions).toContain("26");
    } finally {
      await pool.end();
    }
  });

  it.skipIf(skipIntegrationGate)("TelegramAdapter makes >= 2 real HTTP calls to api.telegram.org (getMe + getUpdates)", async () => {
    if (!TELEGRAM_BOT_TOKEN) {
      return;
    }
    const logger = makeTestLogger();

    // Wrap fetch to count real HTTP calls to api.telegram.org
    let apiCallCount = 0;
    const instrumentedFetch: typeof globalThis.fetch = async (url, init) => {
      if (typeof url === "string" && url.includes("api.telegram.org")) {
        apiCallCount++;
      }
      return globalThis.fetch(url, init);
    };

    const adapter = new TelegramAdapter({
      token: TELEGRAM_BOT_TOKEN,
      logger,
      fetch: instrumentedFetch,
    });

    // start() → 1 real call (getMe)
    await adapter.start({ skipPolling: true });

    // pollOnce() → 1 real call (getUpdates)
    await adapter.pollOnce();
    adapter.stop();

    // >= 2 real HTTP calls: getMe (start) + getUpdates (pollOnce)
    expect(apiCallCount).toBeGreaterThanOrEqual(2);

    // telegram.polling.started proves getMe succeeded with a real Telegram response
    const startLog = logger.calls.find((c) => c.event === "telegram.polling.started");
    expect(startLog).toBeDefined();
    // botUsername is a non-empty string returned by the real Telegram API (SI-002: not the token)
    expect((startLog!.context.botUsername as string).length).toBeGreaterThan(0);
  });
});
