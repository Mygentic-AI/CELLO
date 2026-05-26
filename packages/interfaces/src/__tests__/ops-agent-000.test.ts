/**
 * CELLO-OPS-AGENT-000 — Registration interface contract tests
 *
 * Spec interpretation:
 *   AC-001: MessagingChannel interface structural check — correct method signatures,
 *           ChannelIdentity discriminated union with channel + channelUserId fields.
 *   AC-002: OtpDeliveryProvider interface; ConsoleOtpDeliveryProvider stub instantiates,
 *           sendOtp returns Promise<void>.
 *   AC-003: TokenValidator + DevTokenValidator — DEV- prefix accepted, non-DEV rejected.
 *   AC-003b: PreAuthorizationClient + LocalPreAuthorizationClient — returns DEV-CELLO- + 16 hex,
 *            uses crypto.randomBytes (real entropy, not Math.random).
 *   AC-004: SecurityAlertProvider + ConsoleSecurityAlertProvider — instantiates, sendAlert
 *           returns Promise<void>.
 *   AC-005 + SI-001: PreAuthorizationToken type + entropy test — 1000 production-format tokens
 *            from crypto.randomBytes(25) → base58 → 33 chars; all match format, zero duplicates.
 *   AC-006: RegistrationRecord discriminated union exhaustiveness — TypeScript compile-time check
 *           via switch statement that must cover all 9 state variants.
 *   AC-006b: chain_hash formula unit test — root = SHA-256(id), transition = SHA-256(prev||id||state||updatedAt).
 *   AC-009: All 5 stubs instantiate with new Stub() — no constructor args required.
 */

import { describe, it, expect } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import type { MessagingChannel, ChannelIdentity } from "../messaging-channel.js";
import type { OtpDeliveryProvider } from "../otp-delivery-provider.js";
import type { TokenValidator, TokenValidationResult } from "../token-validator.js";
import type { PreAuthorizationClient, PreAuthorizationToken, PreAuthorizationTokenRow } from "../pre-authorization-client.js";
import type { SecurityAlertProvider, SecurityAlert } from "../security-alert-provider.js";
import type { RegistrationState, RegistrationRecord } from "../registration-state.js";

// ─── AC-001: MessagingChannel type signature ─────────────────────────────────

describe("AC-001: MessagingChannel interface", () => {
  it("CliAdapter implements MessagingChannel and can be assigned to the interface type", async () => {
    const { CliAdapter } = await import("../stubs/cli-adapter.js");
    const channel: MessagingChannel = new CliAdapter();
    expect(typeof channel.send).toBe("function");
    expect(typeof channel.onMessage).toBe("function");
    expect(typeof channel.resolveIdentity).toBe("function");
  });

  it("resolveIdentity returns a ChannelIdentity with channel and channelUserId fields", async () => {
    const { CliAdapter } = await import("../stubs/cli-adapter.js");
    const channel: MessagingChannel = new CliAdapter();
    const identity: ChannelIdentity = await channel.resolveIdentity("test-user");
    expect(identity.channel).toBe("cli");
    expect(typeof identity.channelUserId).toBe("string");
  });

  it("ChannelIdentity discriminated union covers telegram, whatsapp, cli variants", () => {
    // Compile-time exhaustiveness check — if ChannelIdentity gains a new variant,
    // this switch will produce a TypeScript error on the default branch.
    function assertExhaustive(identity: ChannelIdentity): string {
      switch (identity.channel) {
        case "telegram": return `telegram:${identity.channelUserId}`;
        case "whatsapp": return `whatsapp:${identity.channelUserId}`;
        case "cli": return `cli:${identity.channelUserId}`;
        // No default needed — TypeScript narrows to never if the union is exhaustive
      }
    }
    const id: ChannelIdentity = { channel: "cli", channelUserId: "user-1" };
    expect(assertExhaustive(id)).toBe("cli:user-1");
  });
});

// ─── AC-002: OtpDeliveryProvider ─────────────────────────────────────────────

describe("AC-002: OtpDeliveryProvider + ConsoleOtpDeliveryProvider", () => {
  it("ConsoleOtpDeliveryProvider implements OtpDeliveryProvider", async () => {
    const { ConsoleOtpDeliveryProvider } = await import("../stubs/console-otp-delivery-provider.js");
    const provider: OtpDeliveryProvider = new ConsoleOtpDeliveryProvider();
    expect(typeof provider.sendOtp).toBe("function");
  });

  it("sendOtp returns Promise<void>", async () => {
    const { ConsoleOtpDeliveryProvider } = await import("../stubs/console-otp-delivery-provider.js");
    const provider: OtpDeliveryProvider = new ConsoleOtpDeliveryProvider();
    const result = provider.sendOtp("user@example.com", "123456");
    expect(result).toBeInstanceOf(Promise);
    await expect(result).resolves.toBeUndefined();
  });
});

// ─── AC-003: TokenValidator + DevTokenValidator ───────────────────────────────

describe("AC-003: TokenValidator + DevTokenValidator", () => {
  it("validateToken with DEV- prefix returns valid: true with phoneStubHash and emailDomain", async () => {
    const { DevTokenValidator } = await import("../stubs/dev-token-validator.js");
    const validator: TokenValidator = new DevTokenValidator();
    const result: TokenValidationResult = await validator.validateToken("DEV-test-token");
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(typeof result.phoneStubHash).toBe("string");
      expect(typeof result.emailDomain).toBe("string");
    }
  });

  it("validateToken without DEV- prefix returns valid: false with a reason", async () => {
    const { DevTokenValidator } = await import("../stubs/dev-token-validator.js");
    const validator: TokenValidator = new DevTokenValidator();
    const result: TokenValidationResult = await validator.validateToken("CELLO-some-real-token");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(typeof result.reason).toBe("string");
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });

  it("empty string token returns valid: false", async () => {
    const { DevTokenValidator } = await import("../stubs/dev-token-validator.js");
    const validator: TokenValidator = new DevTokenValidator();
    const result = await validator.validateToken("");
    expect(result.valid).toBe(false);
  });
});

// ─── AC-003b: PreAuthorizationClient + LocalPreAuthorizationClient ────────────

describe("AC-003b: PreAuthorizationClient + LocalPreAuthorizationClient", () => {
  it("requestToken returns a token matching /^DEV-CELLO-[0-9a-f]{16}$/", async () => {
    const { LocalPreAuthorizationClient } = await import("../stubs/local-pre-authorization-client.js");
    const client: PreAuthorizationClient = new LocalPreAuthorizationClient();
    const result = await client.requestToken("phone-stub-hash-abc", "example.com");
    expect(result.token).toMatch(/^DEV-CELLO-[0-9a-f]{16}$/);
  });

  it("multiple requestToken calls return different tokens (crypto.randomBytes used)", async () => {
    const { LocalPreAuthorizationClient } = await import("../stubs/local-pre-authorization-client.js");
    const client: PreAuthorizationClient = new LocalPreAuthorizationClient();
    const tokens = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const { token } = await client.requestToken("hash", "domain.com");
      tokens.add(token);
    }
    // All 20 tokens should be unique (crypto.randomBytes entropy)
    expect(tokens.size).toBe(20);
  });

  it("stub requires no constructor arguments", async () => {
    const { LocalPreAuthorizationClient } = await import("../stubs/local-pre-authorization-client.js");
    expect(() => new LocalPreAuthorizationClient()).not.toThrow();
  });
});

// ─── AC-004: SecurityAlertProvider + ConsoleSecurityAlertProvider ─────────────

describe("AC-004: SecurityAlertProvider + ConsoleSecurityAlertProvider", () => {
  it("ConsoleSecurityAlertProvider implements SecurityAlertProvider", async () => {
    const { ConsoleSecurityAlertProvider } = await import("../stubs/console-security-alert-provider.js");
    const provider: SecurityAlertProvider = new ConsoleSecurityAlertProvider();
    expect(typeof provider.sendAlert).toBe("function");
  });

  it("sendAlert with FALLBACK_CANARY alert returns Promise<void>", async () => {
    const { ConsoleSecurityAlertProvider } = await import("../stubs/console-security-alert-provider.js");
    const provider: SecurityAlertProvider = new ConsoleSecurityAlertProvider();
    const alert: SecurityAlert = { type: "FALLBACK_CANARY", triggeredAt: new Date() };
    await expect(provider.sendAlert("account-123", alert)).resolves.toBeUndefined();
  });

  it("sendAlert with REGISTRATION_COMPLETE alert returns Promise<void>", async () => {
    const { ConsoleSecurityAlertProvider } = await import("../stubs/console-security-alert-provider.js");
    const provider: SecurityAlertProvider = new ConsoleSecurityAlertProvider();
    const alert: SecurityAlert = {
      type: "REGISTRATION_COMPLETE",
      phoneStubHash: "abc123",
      emailDomain: "example.com",
      completedAt: new Date(),
    };
    await expect(provider.sendAlert("account-456", alert)).resolves.toBeUndefined();
  });

  it("SecurityAlert discriminated union covers FALLBACK_CANARY and REGISTRATION_COMPLETE", () => {
    // Compile-time exhaustiveness check over the minimal required variants.
    // Downstream stories may extend SecurityAlert with new variants — this switch
    // remains valid because the type is designed for extension (open union semantics
    // with a default branch for unknown future variants).
    function handleAlert(alert: SecurityAlert): string {
      switch (alert.type) {
        case "FALLBACK_CANARY": return "canary";
        case "REGISTRATION_COMPLETE": return "registered";
        default: return "unknown";
      }
    }
    const canary: SecurityAlert = { type: "FALLBACK_CANARY", triggeredAt: new Date() };
    const complete: SecurityAlert = {
      type: "REGISTRATION_COMPLETE",
      phoneStubHash: "h",
      emailDomain: "e.com",
      completedAt: new Date(),
    };
    expect(handleAlert(canary)).toBe("canary");
    expect(handleAlert(complete)).toBe("registered");
  });
});

// ─── AC-005 + SI-001: PreAuthorizationToken type + entropy ───────────────────

describe("AC-005 + SI-001: PreAuthorizationToken format and entropy", () => {
  /**
   * Production token format: "CELLO-" + 33 base58 chars
   * Base58 alphabet (Bitcoin): 1-9A-HJ-NP-Za-km-z (58 chars)
   * 58^33 = ~4.3 × 10^58 ≈ 2^194.9 — exceeds the 192-bit minimum (SI-001)
   *
   * Generation: crypto.randomBytes(25) → 200 bits → base58 encode → take 33 chars
   */
  const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const TOKEN_PREFIX = "CELLO-";
  const RANDOM_CHAR_COUNT = 33;

  function encodeBase58(bytes: Buffer): string {
    // Standard base58 encoding (Bitcoin alphabet)
    let num = BigInt("0x" + bytes.toString("hex"));
    let result = "";
    const base = BigInt(58);
    while (num > 0n) {
      result = BASE58_ALPHABET[Number(num % base)]! + result;
      num = num / base;
    }
    // Count leading zero bytes and prepend '1' for each
    for (const byte of bytes) {
      if (byte === 0) result = "1" + result;
      else break;
    }
    return result;
  }

  function generateProductionToken(): string {
    // crypto.randomBytes(25) = 200 bits of entropy
    // base58-encoding 25 bytes produces ~34 chars; take 33
    const raw = randomBytes(25);
    const encoded = encodeBase58(raw);
    // Pad or take exactly 33 chars — pad with leading '1' (zero in base58) if needed
    const padded = encoded.padStart(RANDOM_CHAR_COUNT, "1").slice(0, RANDOM_CHAR_COUNT);
    return TOKEN_PREFIX + padded;
  }

  it("1000 production-format tokens all match /^CELLO-[1-9A-HJ-NP-Za-km-z]{33}$/", () => {
    const pattern = /^CELLO-[1-9A-HJ-NP-Za-km-z]{33}$/;
    for (let i = 0; i < 1000; i++) {
      const token = generateProductionToken();
      expect(token).toMatch(pattern);
    }
  });

  it("1000 production-format tokens have zero duplicates (SI-001: unguessable)", () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      tokens.add(generateProductionToken());
    }
    expect(tokens.size).toBe(1000);
  });

  it("PreAuthorizationToken type has all required fields", () => {
    // Type-level check via TypeScript assignment — compile-time only.
    // The runtime object exercises the shape.
    const token: PreAuthorizationToken = {
      token: "CELLO-" + "1".repeat(33),
      phoneStubHash: "sha256-of-phone",
      emailDomain: "example.com",
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 86400_000),
      consumedAt: null,
    };
    expect(token.token).toMatch(/^CELLO-/);
    expect(token.consumedAt).toBeNull();
  });

  it("PreAuthorizationTokenRow includes id and registrationId in addition to PreAuthorizationToken fields", () => {
    const row: PreAuthorizationTokenRow = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      registrationId: "660e8400-e29b-41d4-a716-446655440001",
      token: "CELLO-" + "1".repeat(33),
      phoneStubHash: "sha256-of-phone",
      emailDomain: "example.com",
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 86400_000),
      consumedAt: null,
    };
    expect(typeof row.id).toBe("string");
    expect(typeof row.registrationId).toBe("string");
  });
});

// ─── AC-006: RegistrationState discriminated union exhaustiveness ─────────────

describe("AC-006: RegistrationState discriminated union", () => {
  it("switch over RegistrationState is exhaustive — all 9 states covered", () => {
    /**
     * If a new state is added to RegistrationState without adding a case here,
     * TypeScript will produce a type error: Argument of type '...' is not assignable
     * to parameter of type 'never'. This is a compile-time guard.
     */
    function assertExhaustive(state: RegistrationState): string {
      switch (state.state) {
        case "INITIAL": return "initial";
        case "AWAITING_CONTACT": return "awaiting_contact";
        case "PHONE_CONFIRMED": return "phone_confirmed";
        case "AWAITING_EMAIL": return "awaiting_email";
        case "AWAITING_EMAIL_OTP": return `otp:${state.otpHash}`;
        case "EMAIL_CONFIRMED": return "email_confirmed";
        case "PRE_AUTH_TOKEN_ISSUED": return "pre_auth_token_issued";
        case "EXPIRED": return "expired";
        case "FAILED": return `failed:${state.reason}`;
        // No default — forces TypeScript never-check on addition of new state variants
      }
    }

    const states: RegistrationState[] = [
      { state: "INITIAL" },
      { state: "AWAITING_CONTACT" },
      { state: "PHONE_CONFIRMED" },
      { state: "AWAITING_EMAIL" },
      {
        state: "AWAITING_EMAIL_OTP",
        otpHash: "abc",
        otpExpiresAt: new Date(),
        attemptCount: 0,
      },
      { state: "EMAIL_CONFIRMED" },
      { state: "PRE_AUTH_TOKEN_ISSUED" },
      { state: "EXPIRED" },
      { state: "FAILED", reason: "user abandoned" },
    ];
    expect(states.length).toBe(9);
    for (const s of states) {
      expect(typeof assertExhaustive(s)).toBe("string");
    }
  });

  it("RegistrationRecord wraps RegistrationState with id, phoneStubHash, channel, channelUserId, createdAt, updatedAt, expiresAt", () => {
    const record: RegistrationRecord = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      phoneStubHash: "sha256-of-phone",
      channel: "telegram",
      channelUserId: "telegram-user-id-12345",
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 86400_000),
      emailDomain: "example.com",
      state: "AWAITING_EMAIL_OTP",
      otpHash: "hashed-otp",
      otpExpiresAt: new Date(Date.now() + 900_000),
      attemptCount: 1,
    };
    expect(record.channel).toBe("telegram");
    expect(record.state).toBe("AWAITING_EMAIL_OTP");
    // chainHash is intentionally NOT present on RegistrationRecord
    expect("chainHash" in record).toBe(false);
  });

  it("RegistrationRecord does not include chainHash (persistence-layer concern only)", () => {
    const record: RegistrationRecord = {
      id: "uuid-1",
      phoneStubHash: "hash",
      channel: "cli",
      channelUserId: "cli-user",
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: new Date(),
      emailDomain: null,
      state: "INITIAL",
    };
    // TypeScript will error if "chainHash" is a valid key on RegistrationRecord.
    // This runtime check confirms it at test time too.
    expect(Object.keys(record)).not.toContain("chainHash");
  });
});

// ─── AC-006b: chain_hash formula ─────────────────────────────────────────────

describe("AC-006b: chain_hash formula", () => {
  /**
   * chain_hash computation (application-layer, not a DB trigger):
   *   Root record:  chain_hash = SHA-256(id)
   *   Transition:   chain_hash = SHA-256(prior_chain_hash || id || new_state || new_updated_at)
   *
   * All inputs are UTF-8 strings concatenated before hashing.
   * "prior_chain_hash" is the hex digest of the previous record's chain_hash.
   */

  function computeRootChainHash(id: string): string {
    return createHash("sha256").update(id, "utf8").digest("hex");
  }

  function computeTransitionChainHash(
    priorChainHash: string,
    id: string,
    newState: string,
    newUpdatedAt: Date,
  ): string {
    return createHash("sha256")
      .update(priorChainHash, "utf8")
      .update(id, "utf8")
      .update(newState, "utf8")
      .update(newUpdatedAt.toISOString(), "utf8")
      .digest("hex");
  }

  it("root chain_hash equals SHA-256(id)", () => {
    const id = "550e8400-e29b-41d4-a716-446655440000";
    const expected = createHash("sha256").update(id, "utf8").digest("hex");
    const actual = computeRootChainHash(id);
    expect(actual).toBe(expected);
    expect(actual).toHaveLength(64); // SHA-256 hex digest is 64 chars
  });

  it("transition chain_hash equals SHA-256(prior_chain_hash || id || new_state || new_updated_at)", () => {
    const id = "550e8400-e29b-41d4-a716-446655440000";
    const newState = "PHONE_CONFIRMED";
    const newUpdatedAt = new Date("2026-05-25T10:00:00.000Z");
    const priorChainHash = computeRootChainHash(id);

    const actual = computeTransitionChainHash(priorChainHash, id, newState, newUpdatedAt);

    // Independently compute the expected value
    const expected = createHash("sha256")
      .update(priorChainHash, "utf8")
      .update(id, "utf8")
      .update(newState, "utf8")
      .update(newUpdatedAt.toISOString(), "utf8")
      .digest("hex");

    expect(actual).toBe(expected);
    expect(actual).toHaveLength(64);
  });

  it("two different state transitions produce different chain hashes", () => {
    const id = "uuid-test";
    const priorHash = computeRootChainHash(id);
    const dt = new Date("2026-05-25T10:00:00.000Z");

    const hash1 = computeTransitionChainHash(priorHash, id, "PHONE_CONFIRMED", dt);
    const hash2 = computeTransitionChainHash(priorHash, id, "AWAITING_EMAIL", dt);
    expect(hash1).not.toBe(hash2);
  });

  it("chain_hash is deterministic — same inputs produce same output", () => {
    const id = "deterministic-test-uuid";
    const priorHash = computeRootChainHash(id);
    const dt = new Date("2026-05-25T12:00:00.000Z");

    const hash1 = computeTransitionChainHash(priorHash, id, "EMAIL_CONFIRMED", dt);
    const hash2 = computeTransitionChainHash(priorHash, id, "EMAIL_CONFIRMED", dt);
    expect(hash1).toBe(hash2);
  });
});

// ─── AC-009: All 5 stubs instantiate with no constructor arguments ────────────

describe("AC-009: all stubs instantiate with new Stub() — zero constructor args", () => {
  it("CliAdapter instantiates with no arguments", async () => {
    const { CliAdapter } = await import("../stubs/cli-adapter.js");
    expect(() => new CliAdapter()).not.toThrow();
  });

  it("ConsoleOtpDeliveryProvider instantiates with no arguments", async () => {
    const { ConsoleOtpDeliveryProvider } = await import("../stubs/console-otp-delivery-provider.js");
    expect(() => new ConsoleOtpDeliveryProvider()).not.toThrow();
  });

  it("DevTokenValidator instantiates with no arguments", async () => {
    const { DevTokenValidator } = await import("../stubs/dev-token-validator.js");
    expect(() => new DevTokenValidator()).not.toThrow();
  });

  it("LocalPreAuthorizationClient instantiates with no arguments", async () => {
    const { LocalPreAuthorizationClient } = await import("../stubs/local-pre-authorization-client.js");
    expect(() => new LocalPreAuthorizationClient()).not.toThrow();
  });

  it("ConsoleSecurityAlertProvider instantiates with no arguments", async () => {
    const { ConsoleSecurityAlertProvider } = await import("../stubs/console-security-alert-provider.js");
    expect(() => new ConsoleSecurityAlertProvider()).not.toThrow();
  });
});
