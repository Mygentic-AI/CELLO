/**
 * m6b-011.test.ts — Unit tests for CELLO-M6B-011.
 *
 * SPECIFICATION (from story YAML):
 *
 * AC-001: The error message sent when requestToken throws a PreAuthRequestError must NOT
 *   contain "try again" or "few minutes". It must indicate a server error and suggest
 *   contacting support. Verified by asserting channel.send argument does not match /try again/i.
 *
 * AC-002: When a user whose most recent registration has state PRE_AUTH_TOKEN_ISSUED (within
 *   30 days) messages the bot, channel.send is called with a message containing "already"
 *   (case-insensitive) and handleNewUser is NOT called (callCount = 0).
 *   BOUNDARY: if the PRE_AUTH_TOKEN_ISSUED record is older than 30 days, handleNewUser is
 *   called directly (same as a new user).
 *
 * AC-003: When the user replies CONFIRM after receiving the re-registration warning, handleNewUser
 *   is called and registration proceeds normally. callCount = 1.
 *
 * AC-004: EXPECTED_MIGRATION_VERSION in cello-ecs-operations-agent.yaml must use ValueFrom
 *   referencing an SSM parameter ARN (not a plain Value). The OpsAgentTaskExecutionRole in
 *   cello-iam.yaml must grant ssm:GetParameters on /cello/${Environment}/ops-agent/*.
 *   Verified by parsing both YAML files and asserting the required strings are present.
 *   component_under_test: infra
 *
 * SI-001: A CONFIRM message from a user who did NOT receive the warning (not in
 *   #pendingReregistration) must NOT trigger handleNewUser via the CONFIRM shortcut.
 *   The engine must re-send the warning ("already" message) to the user — a positive
 *   assertion required (asserting callCount=0 alone is not sufficient per the story).
 *
 * Tests are unit tests — they mock the repository and channel, not a real Postgres instance.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Logger, MessagingChannel, OtpDeliveryProvider, ChannelIdentity, PreAuthorizationClient } from "@cello-protocol/interfaces";
import { PreAuthRequestError } from "../directory-pre-auth-client.js";
import { RegistrationEngine } from "../registration/engine.js";
import pg from "pg";

// ─── Test doubles ─────────────────────────────────────────────────────────────

function makeTestLogger(): { logger: Logger; events: Array<{ method: string; event: string; context?: Record<string, unknown> }> } {
  const events: Array<{ method: string; event: string; context?: Record<string, unknown> }> = [];
  const logger: Logger = {
    debug: (event, context) => events.push({ method: "debug", event, context: context as Record<string, unknown> }),
    info: (event, context) => events.push({ method: "info", event, context: context as Record<string, unknown> }),
    warn: (event, context) => events.push({ method: "warn", event, context: context as Record<string, unknown> }),
    error: (event, _errorOrContext, context) => events.push({ method: "error", event, context: context as Record<string, unknown> }),
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
    if (handler) {
      await handler(from, message);
    }
  }

  return { channel, sent, injectMessage };
}

function makeTestOtpDelivery(): OtpDeliveryProvider {
  return {
    async sendOtp(_emailAddress: string, _otp: string): Promise<void> {},
  };
}

// ─── Mock repository builder ──────────────────────────────────────────────────
// We use a mock pool whose .query() is controlled per-test to simulate different
// repository states without requiring a real Postgres connection.

/**
 * Builds a pg.Pool mock with controlled query behavior.
 *
 * findActiveByChannelUser returns null (no active registration).
 * findCompletedByChannelUser returns the provided completedRecord (or null).
 * handleNewUser path (insert, transition × 2, find) return minimal records.
 */
function makeMockPool(opts: {
  completedRecord?: { id: string; created_at: Date; email_stub_hash?: string | null } | null;
}): pg.Pool {
  const { completedRecord = null } = opts;

  // Minimal chain-hash-valid row for new registration inserts
  const minimalRow = {
    id: "test-reg-id",
    phone_stub_hash: "abc123",
    channel: "cli",
    channel_user_id: "user1",
    state: "AWAITING_CONTACT",
    state_data: {},
    email_stub_hash: null,
    otp_hash: null,
    otp_salt: null,
    otp_expires_at: null,
    otp_attempt_count: 0,
    created_at: new Date(),
    updated_at: new Date(),
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    chain_hash: "deadbeef",
  };

  const pool = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      // findActiveByChannelUser: state NOT IN (...) LIMIT 1
      // Match by the NOT IN pattern used in findActiveByChannelUser
      if (typeof sql === "string" && sql.includes("state NOT IN") && sql.includes("LIMIT 1")) {
        return { rows: [] }; // No active registration
      }

      // findCompletedByChannelUser: state = 'PRE_AUTH_TOKEN_ISSUED' LIMIT 1
      // Simulate date filtering: $3 is the "since" date; return the record only if
      // it was created after that date (i.e. it is within the window).
      if (typeof sql === "string" && sql.includes("PRE_AUTH_TOKEN_ISSUED") && sql.includes("LIMIT 1")) {
        if (completedRecord && params && params.length >= 3) {
          const since = params[2] as Date;
          // Only return the record if it was created after the "since" date
          if (completedRecord.created_at > since) {
            return { rows: [completedRecord] };
          }
        }
        return { rows: [] };
      }

      // insert (returns INITIAL state row for handleNewUser)
      if (typeof sql === "string" && sql.includes("INSERT INTO registrations")) {
        return { rows: [{ ...minimalRow, state: "INITIAL" }] };
      }

      // transition: SELECT chain_hash
      if (typeof sql === "string" && sql.includes("SELECT chain_hash FROM registrations")) {
        return { rows: [{ chain_hash: "deadbeef" }] };
      }

      // transition: UPDATE ... RETURNING *  (→ AWAITING_CONTACT)
      if (typeof sql === "string" && sql.includes("UPDATE registrations SET") && sql.includes("RETURNING *")) {
        return { rows: [{ ...minimalRow, state: "AWAITING_CONTACT" }] };
      }

      // default: empty
      return { rows: [] };
    }),
    connect: vi.fn(),
    end: vi.fn(async () => {}),
    on: vi.fn(),
  } as unknown as pg.Pool;

  return pool;
}

// ─── AC-001: Fixed error message ──────────────────────────────────────────────
//
// Pseudocode:
//   1. Create a PreAuthorizationClient that always throws PreAuthRequestError
//   2. Drive engine to EMAIL_CONFIRMED state (mock the required DB transitions)
//   3. Submit correct OTP to trigger requestToken() which throws
//   4. Assert channel.send was NOT called with a message matching /try again/i
//   5. Assert channel.send WAS called with a message matching /server error/i and /support/i

describe("AC-001: pre-auth failure sends honest error message", () => {
  it("does not send 'try again' message when requestToken throws PreAuthRequestError in #handleAwaitingEmailOtp", async () => {
    // This test verifies the error message in the #completeRegistration path (state-machine.ts ~line 400-403)
    // by using a real RegistrationStateMachine with a stubbed failing preAuth and real DB transitions
    // via a full engine setup with a mock pool that simulates the EMAIL_CONFIRMED state path.
    //
    // However, because driving the full flow through a mock pool is complex, this test imports the
    // state machine directly and calls #handleAwaitingEmailOtp via a controlled record.

    // Import state machine directly to test the error message path
    const { RegistrationStateMachine } = await import("../registration/state-machine.js");

    const sent: SentMessage[] = [];
    const { logger } = makeTestLogger();

    const failingPreAuth: PreAuthorizationClient = {
      async requestToken() {
        throw new PreAuthRequestError("connection refused", 503);
      },
    };

    // Minimal mock repository — enough to let the state machine do its work in AWAITING_EMAIL_OTP
    const mockRepo = {
      findActiveByChannelUser: vi.fn(async () => null),
      findById: vi.fn(async () => null),
      findCompletedByChannelUser: vi.fn(async () => null),
      insert: vi.fn(async () => ({} as never)),
      transition: vi.fn(async (id: string, newState: string) => ({
        id,
        state: newState,
        phoneStubHash: "hash",
        channel: "cli" as const,
        channelUserId: "user1",
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: new Date(Date.now() + 9999999),
        emailStubHash: "example-hash",
      })),
      transitionOnOtpLockout: vi.fn(),
      incrementOtpAttempt: vi.fn(),
      touchTimestamps: vi.fn(),
      getOtpSalt: vi.fn(async () => "test-salt"),
      getStateDataField: vi.fn(async () => null),
      getEmailStubHash: vi.fn(async () => null),
      upsertChannelIdentity: vi.fn(async () => {}),
      loadAllActive: vi.fn(async () => []),
      findExpiredActive: vi.fn(async () => []),
    };

    const channel: MessagingChannel = {
      async send(to: string, message: string): Promise<void> {
        sent.push({ to, message });
      },
      onMessage: vi.fn(),
      async resolveIdentity(from: string): Promise<ChannelIdentity> {
        return { channel: "cli", channelUserId: from };
      },
    };

    const sm = new RegistrationStateMachine({
      repository: mockRepo as never,
      channel,
      otpDelivery: makeTestOtpDelivery(),
      preAuth: failingPreAuth,
      logger,
    });

    // Simulate an AWAITING_EMAIL_OTP record with a valid OTP hash
    const { hashOtp } = await import("../registration/otp.js");
    const otpHash = hashOtp("123456", "test-salt");

    const record = {
      id: "rec-001",
      state: "AWAITING_EMAIL_OTP" as const,
      phoneStubHash: "hash",
      channel: "cli" as const,
      channelUserId: "user1",
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: new Date(Date.now() + 9999999),
      emailStubHash: "example-hash",
      otpHash,
      otpExpiresAt: new Date(Date.now() + 999999),
      attemptCount: 0,
    };

    await sm.handleMessage(record, "123456", "user1");

    // AC-001: message must NOT contain "try again" or "few minutes"
    // Find the error message sent
    const serverErrorMsg = sent.find((m) => m.message.toLowerCase().includes("server error"));
    expect(serverErrorMsg, "Should send a message mentioning server error").toBeDefined();

    const contactSupportMsg = sent.find((m) => m.message.toLowerCase().includes("support"));
    expect(contactSupportMsg, "Should send a message mentioning support").toBeDefined();

    const tryAgainMsg = sent.find((m) => /try again/i.test(m.message));
    expect(tryAgainMsg, "Must NOT send 'try again' message").toBeUndefined();
  });

  it("does not send 'try again' message when requestToken throws PreAuthRequestError in #retryPreAuth (EMAIL_CONFIRMED state)", async () => {
    const { RegistrationStateMachine } = await import("../registration/state-machine.js");

    const sent: SentMessage[] = [];
    const { logger } = makeTestLogger();

    const failingPreAuth: PreAuthorizationClient = {
      async requestToken() {
        throw new PreAuthRequestError("connection refused", 503);
      },
    };

    const mockRepo = {
      findActiveByChannelUser: vi.fn(async () => null),
      findById: vi.fn(async () => null),
      findCompletedByChannelUser: vi.fn(async () => null),
      insert: vi.fn(),
      transition: vi.fn(async (id: string, newState: string) => ({
        id, state: newState, phoneStubHash: "hash", channel: "cli" as const,
        channelUserId: "user1", createdAt: new Date(), updatedAt: new Date(),
        expiresAt: new Date(Date.now() + 9999999), emailStubHash: "example-hash",
      })),
      transitionOnOtpLockout: vi.fn(),
      incrementOtpAttempt: vi.fn(),
      touchTimestamps: vi.fn(),
      getOtpSalt: vi.fn(async () => null),
      getStateDataField: vi.fn(async () => null),
      getEmailStubHash: vi.fn(async () => null),
      upsertChannelIdentity: vi.fn(async () => {}),
      loadAllActive: vi.fn(async () => []),
      findExpiredActive: vi.fn(async () => []),
    };

    const channel: MessagingChannel = {
      async send(to: string, message: string): Promise<void> {
        sent.push({ to, message });
      },
      onMessage: vi.fn(),
      async resolveIdentity(from: string): Promise<ChannelIdentity> {
        return { channel: "cli", channelUserId: from };
      },
    };

    const sm = new RegistrationStateMachine({
      repository: mockRepo as never,
      channel,
      otpDelivery: makeTestOtpDelivery(),
      preAuth: failingPreAuth,
      logger,
    });

    // EMAIL_CONFIRMED state triggers #retryPreAuth
    const record = {
      id: "rec-002",
      state: "EMAIL_CONFIRMED" as const,
      phoneStubHash: "hash",
      channel: "cli" as const,
      channelUserId: "user1",
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: new Date(Date.now() + 9999999),
      emailStubHash: "example-hash",
    };

    await sm.handleMessage(record, "anything", "user1");

    // AC-001: must NOT contain "try again"
    const tryAgainMsg = sent.find((m) => /try again/i.test(m.message));
    expect(tryAgainMsg, "Must NOT send 'try again' message in retryPreAuth path").toBeUndefined();

    // Must contain server error and support references
    const serverErrorMsg = sent.find((m) => m.message.toLowerCase().includes("server error"));
    expect(serverErrorMsg, "Should send a message mentioning server error").toBeDefined();

    const contactSupportMsg = sent.find((m) => m.message.toLowerCase().includes("support"));
    expect(contactSupportMsg, "Should send a message mentioning support").toBeDefined();
  });
});

// ─── AC-002 + AC-003 + SI-001: Re-registration check ──────────────────────────
//
// Pseudocode for engine re-registration flow:
//   handleInboundMessage(from, message):
//     existing = repository.findActiveByChannelUser(channel, from)  → null
//     completed = repository.findCompletedByChannelUser(channel, from, 30d)
//     if completed exists AND from NOT in #pendingReregistration:
//       channel.send(from, "...already...CONFIRM...")  ← warning
//       add from to #pendingReregistration
//       return  ← do NOT call handleNewUser
//     if from IN #pendingReregistration AND message === 'CONFIRM':
//       remove from #pendingReregistration
//       call handleNewUser(from, channelType, phoneStubHash)
//     else:
//       call handleNewUser(from, channelType, phoneStubHash) if not completed (new user)

describe("AC-002 + AC-003 + SI-001: re-registration check", () => {
  let channelState: ReturnType<typeof makeTestChannel>;
  let loggerState: ReturnType<typeof makeTestLogger>;

  beforeEach(() => {
    channelState = makeTestChannel();
    loggerState = makeTestLogger();
  });

  // ─── AC-002: existing completed registration → warning sent, handleNewUser not called ─────

  it("AC-002: user with recent PRE_AUTH_TOKEN_ISSUED registration receives 'already' warning; handleNewUser not called", async () => {
    const recentCreatedAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000); // 10 days ago (within 30)
    const pool = makeMockPool({
      completedRecord: { id: "existing-reg-id", created_at: recentCreatedAt },
    });

    const engine = new RegistrationEngine({
      pool,
      channel: channelState.channel,
      otpDelivery: makeTestOtpDelivery(),
      preAuth: { requestToken: vi.fn() } as unknown as PreAuthorizationClient,
      logger: loggerState.logger,
      channelType: "cli",
      onError: (err) => { throw err; },
    });
    await engine.start();

    try {
      await channelState.injectMessage("user1", "hello");

      // AC-002: channel.send called with message containing "already" (case-insensitive)
      const alreadyMsg = channelState.sent.find((m) => /already/i.test(m.message));
      expect(alreadyMsg, "Should send 'already registered' warning").toBeDefined();

      // AC-002: handleNewUser NOT called — verified by asserting no "registration.started" event
      // and no INSERT query was made (pool.query called but no INSERT path)
      const insertCalls = (pool.query as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([sql]: [string]) => typeof sql === "string" && sql.includes("INSERT INTO registrations"),
      );
      expect(insertCalls.length, "handleNewUser (INSERT) must NOT be called").toBe(0);

      // Observability: registration.already_registered.warned logged
      const warnedEvent = loggerState.events.find((e) => e.event === "registration.already_registered.warned");
      expect(warnedEvent, "registration.already_registered.warned must be logged").toBeDefined();
      expect(warnedEvent?.context?.registrationId).toBeDefined();
      expect(warnedEvent?.context?.channelUserId).toBeDefined();
      expect(warnedEvent?.context?.existingRegistrationAge).toBeDefined();
    } finally {
      engine.stop();
    }
  });

  // ─── AC-002 boundary: PRE_AUTH_TOKEN_ISSUED older than 30 days → handleNewUser called ────

  it("AC-002 boundary: PRE_AUTH_TOKEN_ISSUED older than 30 days → proceeds to handleNewUser", async () => {
    const oldCreatedAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000); // 31 days ago (outside 30d window)
    const pool = makeMockPool({
      completedRecord: { id: "old-reg-id", created_at: oldCreatedAt },
    });

    const engine = new RegistrationEngine({
      pool,
      channel: channelState.channel,
      otpDelivery: makeTestOtpDelivery(),
      preAuth: { requestToken: vi.fn() } as unknown as PreAuthorizationClient,
      logger: loggerState.logger,
      channelType: "cli",
      onError: (err) => { throw err; },
    });
    await engine.start();

    try {
      await channelState.injectMessage("user-old", "hello");

      // handleNewUser WAS called — INSERT was made
      const insertCalls = (pool.query as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([sql]: [string]) => typeof sql === "string" && sql.includes("INSERT INTO registrations"),
      );
      expect(insertCalls.length, "handleNewUser (INSERT) must be called for >30d old record").toBeGreaterThan(0);

      // No warning message sent
      const alreadyMsg = channelState.sent.find((m) => /already/i.test(m.message));
      expect(alreadyMsg, "Must NOT send 'already registered' warning for >30d old record").toBeUndefined();
    } finally {
      engine.stop();
    }
  });

  // ─── AC-003: CONFIRM after warning → handleNewUser called ───────────────────

  it("AC-003: CONFIRM reply after warning triggers handleNewUser; callCount = 1", async () => {
    const recentCreatedAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000); // 5 days ago
    const pool = makeMockPool({
      completedRecord: { id: "confirm-reg-id", created_at: recentCreatedAt },
    });

    const engine = new RegistrationEngine({
      pool,
      channel: channelState.channel,
      otpDelivery: makeTestOtpDelivery(),
      preAuth: { requestToken: vi.fn() } as unknown as PreAuthorizationClient,
      logger: loggerState.logger,
      channelType: "cli",
      onError: (err) => { throw err; },
    });
    await engine.start();

    try {
      // First message — triggers warning
      await channelState.injectMessage("user-confirm", "hello");

      // Verify warning was sent
      const alreadyMsg = channelState.sent.find((m) => /already/i.test(m.message));
      expect(alreadyMsg, "Warning must be sent before CONFIRM").toBeDefined();

      // INSERT must not have been called yet
      const insertCallsAfterWarning = (pool.query as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([sql]: [string]) => typeof sql === "string" && sql.includes("INSERT INTO registrations"),
      );
      expect(insertCallsAfterWarning.length, "handleNewUser must NOT be called before CONFIRM").toBe(0);

      // Second message — CONFIRM
      await channelState.injectMessage("user-confirm", "CONFIRM");

      // After CONFIRM, handleNewUser must be called — INSERT was made.
      // Story AC-003 specifies "handleNewUser.callCount = 1" as the verification method.
      // handleNewUser is a method on RegistrationStateMachine (a private field of engine),
      // so we cannot spy on it directly without exposing internals. INSERT count is used
      // as the canonical equivalent proxy: handleNewUser always performs exactly one INSERT
      // as its first action (see state-machine.ts #insertInitialRecord). If INSERT was
      // called exactly once, handleNewUser was called exactly once. This proxy is valid as
      // long as (a) handleNewUser always starts with an INSERT and (b) no other code path
      // in this test emits an INSERT. Both are true in this test setup.
      const insertCallsAfterConfirm = (pool.query as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([sql]: [string]) => typeof sql === "string" && sql.includes("INSERT INTO registrations"),
      );
      expect(insertCallsAfterConfirm.length, "handleNewUser (INSERT) must be called exactly once after CONFIRM").toBe(1);
    } finally {
      engine.stop();
    }
  });

  // ─── AC-004: IaC — EXPECTED_MIGRATION_VERSION uses SSM ValueFrom; IAM grants ssm:GetParameters ─

  it("AC-004: cello-ecs-operations-agent.yaml uses ValueFrom SSM ARN for EXPECTED_MIGRATION_VERSION; cello-iam.yaml grants ssm:GetParameters on ops-agent path", () => {
    // Pseudocode:
    //   1. Resolve the two CloudFormation YAML files relative to the repo root (two levels up
    //      from packages/operations-agent, into infra/cloudformation/).
    //   2. Read both files as UTF-8 strings — no YAML parser needed; we assert literal strings
    //      that must be present for the IaC to be correct. String presence is sufficient because
    //      the lines are unique and load-bearing: changing them would break ECS task launch.
    //   3. Assert that cello-ecs-operations-agent.yaml contains:
    //      a. "EXPECTED_MIGRATION_VERSION" (the env var name exists in the Secrets block)
    //      b. "ValueFrom" near the EXPECTED_MIGRATION_VERSION entry (ECS Secrets injection)
    //      c. The SSM parameter path "parameter/cello/" referencing the SSM ARN pattern
    //      d. "ops-agent/expected-migration-version" — the exact parameter name
    //   4. Assert that cello-iam.yaml contains:
    //      a. "ssm:GetParameters" — the required IAM action
    //      b. "parameter/cello/" with "ops-agent" — the path wildcard scoped to ops-agent

    // Resolve paths from the worktree root (two levels up from packages/operations-agent/src/__tests__)
    const infraDir = resolve(import.meta.dirname, "../../../../infra/cloudformation");
    const ecsTemplate = readFileSync(resolve(infraDir, "cello-ecs-operations-agent.yaml"), "utf8");
    const iamTemplate = readFileSync(resolve(infraDir, "cello-iam.yaml"), "utf8");

    // AC-004 assertion 1: EXPECTED_MIGRATION_VERSION is in the Secrets block (ValueFrom, not plain Value)
    expect(ecsTemplate).toContain("EXPECTED_MIGRATION_VERSION");

    // AC-004 assertion 2: ValueFrom is used (ECS Secrets injection resolves SSM at task launch)
    // Find the "Name: EXPECTED_MIGRATION_VERSION" line specifically (not comment lines) and check
    // that ValueFrom appears within the next 2 lines (YAML: "- Name: X\n  ValueFrom: ...")
    const ecsLines = ecsTemplate.split("\n");
    // Match lines where EXPECTED_MIGRATION_VERSION is the value of a Name: key (not a comment)
    const emvIndex = ecsLines.findIndex((l) => /^\s+-\s+Name:\s+EXPECTED_MIGRATION_VERSION/.test(l));
    expect(emvIndex, "Name: EXPECTED_MIGRATION_VERSION must exist in ECS Secrets block").toBeGreaterThan(-1);
    // ValueFrom must appear within 2 lines of the Name entry (standard ECS Secrets YAML shape)
    const nearbyLines = ecsLines.slice(emvIndex, emvIndex + 3).join("\n");
    expect(nearbyLines, "ValueFrom must immediately follow EXPECTED_MIGRATION_VERSION Name entry").toContain("ValueFrom");

    // AC-004 assertion 3: the ValueFrom references an SSM parameter ARN (not Secrets Manager)
    expect(ecsTemplate).toContain("parameter/cello/");
    expect(ecsTemplate).toContain("ops-agent/expected-migration-version");

    // AC-004 assertion 4 (IAM): ssm:GetParameters action exists in OpsAgentTaskExecutionRole
    expect(iamTemplate).toContain("ssm:GetParameters");

    // AC-004 assertion 5 (IAM): the ssm:GetParameters resource is scoped to ops-agent path
    // The Resource ARN must reference parameter/cello/ and ops-agent
    const iamLines = iamTemplate.split("\n");
    const ssmActionIndex = iamLines.findIndex((l) => l.includes("ssm:GetParameters"));
    expect(ssmActionIndex, "ssm:GetParameters must exist in IAM template").toBeGreaterThan(-1);
    // Find the Resource lines after ssm:GetParameters (within 5 lines: Action block → Resource block)
    const ssmContext = iamLines.slice(ssmActionIndex, ssmActionIndex + 10).join("\n");
    expect(ssmContext, "ssm:GetParameters resource must reference ops-agent SSM path").toContain("ops-agent");
    expect(ssmContext, "ssm:GetParameters resource must reference /cello/ path prefix").toContain("/cello/");
  });

  // ─── SI-001: CONFIRM without prior warning → warning re-sent; handleNewUser NOT called ────

  it("SI-001: CONFIRM without prior warning re-sends warning; handleNewUser not called (positive assertion)", async () => {
    const recentCreatedAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000); // 5 days ago
    const pool = makeMockPool({
      completedRecord: { id: "si001-reg-id", created_at: recentCreatedAt },
    });

    const engine = new RegistrationEngine({
      pool,
      channel: channelState.channel,
      otpDelivery: makeTestOtpDelivery(),
      preAuth: { requestToken: vi.fn() } as unknown as PreAuthorizationClient,
      logger: loggerState.logger,
      channelType: "cli",
      onError: (err) => { throw err; },
    });
    await engine.start();

    try {
      // Send CONFIRM directly — no prior warning (simulates attacker or restart scenario)
      // The engine has NOT sent a warning for this user, so #pendingReregistration.has("si001-user") = false
      await channelState.injectMessage("si001-user", "CONFIRM");

      // SI-001: handleNewUser must NOT be called via the CONFIRM shortcut
      const insertCalls = (pool.query as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([sql]: [string]) => typeof sql === "string" && sql.includes("INSERT INTO registrations"),
      );
      expect(insertCalls.length, "handleNewUser (INSERT) must NOT be called for CONFIRM without prior warning").toBe(0);

      // SI-001: positive assertion — the warning MUST be re-sent (not silently dropped)
      // A test that only asserts callCount=0 is not sufficient per SI-001 spec.
      const alreadyMsg = channelState.sent.find((m) => /already/i.test(m.message));
      expect(alreadyMsg, "Warning must be re-sent to user who sends CONFIRM without prior warning").toBeDefined();
    } finally {
      engine.stop();
    }
  });
});
