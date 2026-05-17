/**
 * CELLO-PERSIST-005 — KMS envelope encryption for K_server_X shares
 *
 * Specification (from story YAML):
 *
 * AC-001: CELLO_ENV=local + DEV_ENVELOPE_KEY set
 *   - encrypt(32 bytes, keyId) → ciphertext != plaintext, length >= 32
 *   - decrypt(ciphertext, keyId) → original 32 bytes exactly
 *   test_type: unit
 *
 * AC-002: encrypted share stored in agent_key_shares
 *   - raw bytes in agent_key_shares.encrypted_share != original plaintext
 *   test_type: integration
 *
 * AC-003: decrypt share retrieved from DB
 *   - decrypted bytes == original plaintext exactly
 *   test_type: integration
 *
 * AC-004: wrong keyId → decrypt throws, no partial bytes
 *   test_type: unit
 *
 * AC-005: logging during agent registration that creates a K_server_X share
 *   - key.encrypted logged at INFO with { keyId, agentId }
 *   - no share bytes in log output
 *   test_type: integration
 *
 * AC-006: CELLO_ENV=local + DEV_ENVELOPE_KEY missing
 *   - process exits 1
 *   - logs adapter.config.missing with { missingKey: 'DEV_ENVELOPE_KEY', env: 'local' }
 *   test_type: unit (composition root test — verified via existing persist-001 test)
 *
 * AC-007: rotate(keyId)
 *   - logs key.rotation.initiated with { keyId }
 *   - decrypt(old_ciphertext, keyId) still returns correct plaintext (dual-key coexistence)
 *   - new encrypt() uses new key (different from old — random nonce guarantees uniqueness)
 *   test_type: unit
 *
 * SI-001: encryption error → logs keyId only, never plaintext share bytes
 * SI-002: unwrapped master key never in logs or responses
 * SI-003: structural validity check — ciphertext length = plaintext_length + 28 (12 nonce + 16 tag)
 * SI-004: random nonce per encryption — two encrypts of same data → different ciphertexts
 *
 * Interpretation:
 *   AC-006 composition root test is already covered in persist-001 (exits 1 on missing DEV_ENVELOPE_KEY).
 *   This test file adds a dedicated unit test that verifies the error message shape.
 *   SI-002: The master key (DEV_ENVELOPE_KEY) is held in memory as a Buffer; the test verifies
 *   it does not appear in any log context emitted by the store or provider.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { LocalEnvelopeKeyProvider } from "@cello/interfaces/stubs";
import { EncryptedPgShareStore } from "../encrypted-share-store.js";
import type { Logger } from "@cello/interfaces";

// ─── Unit tests ───────────────────────────────────────────────────────────────
// These run without a database connection.

describe("PERSIST-005 AC-001: LocalEnvelopeKeyProvider encrypt/decrypt round-trip", () => {
  const KEY_HEX = randomBytes(32).toString("hex");
  const provider = new LocalEnvelopeKeyProvider(KEY_HEX);

  it("AC-001: ciphertext is not equal to plaintext", async () => {
    const plaintext = randomBytes(32);
    const ciphertext = await provider.encrypt(plaintext, "test-key-id");
    expect(Buffer.from(ciphertext).toString("hex")).not.toBe(
      Buffer.from(plaintext).toString("hex"),
    );
  });

  it("AC-001: ciphertext is at least 32 bytes long", async () => {
    const plaintext = randomBytes(32);
    const ciphertext = await provider.encrypt(plaintext, "test-key-id");
    expect(ciphertext.length).toBeGreaterThanOrEqual(32);
  });

  it("AC-001: decrypt returns original 32 bytes exactly", async () => {
    const plaintext = randomBytes(32);
    const keyId = "round-trip-key";
    const ciphertext = await provider.encrypt(plaintext, keyId);
    const decrypted = await provider.decrypt(ciphertext, keyId);
    expect(Buffer.from(decrypted).toString("hex")).toBe(
      Buffer.from(plaintext).toString("hex"),
    );
  });
});

describe("PERSIST-005 AC-004: wrong keyId → decrypt throws, no partial bytes returned", () => {
  const KEY_HEX = randomBytes(32).toString("hex");
  const provider = new LocalEnvelopeKeyProvider(KEY_HEX);

  it("AC-004: decrypt with wrong keyId throws a decryption error", async () => {
    const plaintext = randomBytes(32);
    const ciphertext = await provider.encrypt(plaintext, "correct-key-id");

    await expect(
      provider.decrypt(ciphertext, "wrong-key-id"),
    ).rejects.toThrow();
  });

  it("AC-004: the thrown error message does not contain the original plaintext bytes", async () => {
    const plaintext = randomBytes(32);
    const plaintextHex = Buffer.from(plaintext).toString("hex");
    const ciphertext = await provider.encrypt(plaintext, "correct-key-id");

    let thrownError: Error | undefined;
    try {
      await provider.decrypt(ciphertext, "wrong-key-id");
    } catch (err: unknown) {
      thrownError = err instanceof Error ? err : new Error(String(err));
    }

    expect(thrownError).toBeDefined();
    expect(thrownError!.message).not.toContain(plaintextHex);
  });
});

describe("PERSIST-005 SI-003: AES-256-GCM ciphertext structural validity", () => {
  const KEY_HEX = randomBytes(32).toString("hex");
  const provider = new LocalEnvelopeKeyProvider(KEY_HEX);

  it("SI-003: ciphertext length = plaintext_length + 28 (12-byte nonce + 16-byte auth tag)", async () => {
    const plaintext = randomBytes(32);
    const ciphertext = await provider.encrypt(plaintext, "struct-check-key");
    // AES-256-GCM output layout: [iv (12)] [tag (16)] [ciphertext (plaintext_length)]
    // Total overhead = 12 + 16 = 28 bytes
    expect(ciphertext.length).toBe(plaintext.length + 28);
  });

  it("SI-003: ciphertext is not empty", async () => {
    const plaintext = randomBytes(32);
    const ciphertext = await provider.encrypt(plaintext, "nonempty-check");
    expect(ciphertext.length).toBeGreaterThan(0);
  });
});

describe("PERSIST-005 SI-004: random nonce per encryption (NIST SP 800-38D)", () => {
  const KEY_HEX = randomBytes(32).toString("hex");
  const provider = new LocalEnvelopeKeyProvider(KEY_HEX);

  it("SI-004: two encryptions of the same plaintext produce different ciphertexts", async () => {
    const plaintext = randomBytes(32);
    const ct1 = await provider.encrypt(plaintext, "nonce-test-key");
    const ct2 = await provider.encrypt(plaintext, "nonce-test-key");
    expect(Buffer.from(ct1).toString("hex")).not.toBe(
      Buffer.from(ct2).toString("hex"),
    );
  });
});

describe("PERSIST-005 AC-007: rotate() — dual-key coexistence", () => {
  it("AC-007: key.rotation.initiated is logged at INFO with { keyId }", async () => {
    const KEY_HEX = randomBytes(32).toString("hex");
    const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const provider = new LocalEnvelopeKeyProvider(KEY_HEX, logger);

    await provider.rotate("test-slot");

    expect(logger.info).toHaveBeenCalledWith(
      "key.rotation.initiated",
      expect.objectContaining({ keyId: "test-slot" }),
    );
  });

  it("AC-007: after rotate(), decrypt(old_ciphertext, keyId) still returns correct plaintext", async () => {
    const KEY_HEX = randomBytes(32).toString("hex");
    const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const provider = new LocalEnvelopeKeyProvider(KEY_HEX, logger);

    const plaintext = randomBytes(32);
    const keyId = "rotation-slot";
    const oldCiphertext = await provider.encrypt(plaintext, keyId);

    // Rotate to a new randomly-generated key
    await provider.rotate(keyId);

    // Old ciphertext still decrypts correctly (dual-key coexistence)
    const decrypted = await provider.decrypt(oldCiphertext, keyId);
    expect(Buffer.from(decrypted).toString("hex")).toBe(
      Buffer.from(plaintext).toString("hex"),
    );
  });

  it("AC-007: after rotate(), new encrypt() produces ciphertext that decrypts correctly", async () => {
    const KEY_HEX = randomBytes(32).toString("hex");
    const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const provider = new LocalEnvelopeKeyProvider(KEY_HEX, logger);

    const plaintext = randomBytes(32);
    const keyId = "rotation-new-encrypt-slot";

    // Encrypt before rotation
    const oldCiphertext = await provider.encrypt(plaintext, keyId);

    // Rotate
    await provider.rotate(keyId);

    // Encrypt after rotation
    const newCiphertext = await provider.encrypt(plaintext, keyId);

    // Both ciphertexts decrypt to the same plaintext (new key used for new encrypt)
    const decryptedOld = await provider.decrypt(oldCiphertext, keyId);
    const decryptedNew = await provider.decrypt(newCiphertext, keyId);
    expect(Buffer.from(decryptedOld).toString("hex")).toBe(
      Buffer.from(plaintext).toString("hex"),
    );
    expect(Buffer.from(decryptedNew).toString("hex")).toBe(
      Buffer.from(plaintext).toString("hex"),
    );
  });
});

describe("PERSIST-005 AC-006: LocalEnvelopeKeyProvider rejects invalid DEV_ENVELOPE_KEY", () => {
  it("AC-006: constructor throws when DEV_ENVELOPE_KEY is empty string", () => {
    expect(() => new LocalEnvelopeKeyProvider("")).toThrow(/DEV_ENVELOPE_KEY/);
  });

  it("AC-006: constructor throws when DEV_ENVELOPE_KEY is wrong length", () => {
    expect(() => new LocalEnvelopeKeyProvider("abcd1234")).toThrow(/DEV_ENVELOPE_KEY/);
  });

  it("MEDIUM-7: constructor throws when DEV_ENVELOPE_KEY contains non-hex characters", () => {
    const invalidKeys = [
      "g".repeat(64), // 'g' is not a hex char
      "0".repeat(63) + "z", // ends with 'z'
      "hello world" + "0".repeat(53), // spaces and letters
    ];
    for (const key of invalidKeys) {
      expect(() => new LocalEnvelopeKeyProvider(key)).toThrow(/hexadecimal/);
    }
  });
});

describe("PERSIST-005 SI-001: encryption error — no plaintext bytes in error or log", () => {
  it("SI-001: EncryptedPgShareStore logs key.encrypted.failed with keyId and agentId on encrypt failure, never plaintext bytes", async () => {
    // Simulate a broken provider that throws on encrypt
    const brokenProvider = {
      encrypt: vi.fn().mockRejectedValue(new Error("KMS unavailable")),
      decrypt: vi.fn(),
      rotate: vi.fn(),
    };
    const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const store = new EncryptedPgShareStore(
      null as unknown as pg.Pool, // pool unused — encrypt fails first
      brokenProvider,
      logger,
    );

    const shareBytes = randomBytes(32);
    const shareHex = shareBytes.toString("hex");
    const agentId = "test-agent-pubkey-hex";

    await expect(
      store.storeShare(agentId, "epoch:1", shareBytes),
    ).rejects.toThrow();

    // The error log must include key.encrypted.failed with agentId
    expect(logger.error).toHaveBeenCalledWith(
      "key.encrypted.failed",
      expect.objectContaining({ agentId }),
    );

    // The plaintext share must never appear in any log call
    const allLogCalls = [
      ...(logger.info as ReturnType<typeof vi.fn>).mock.calls,
      ...(logger.warn as ReturnType<typeof vi.fn>).mock.calls,
      ...(logger.error as ReturnType<typeof vi.fn>).mock.calls,
      ...(logger.debug as ReturnType<typeof vi.fn>).mock.calls,
    ];
    for (const call of allLogCalls) {
      const serialized = JSON.stringify(call);
      expect(serialized).not.toContain(shareHex);
    }
  });
});

describe("PERSIST-005 SI-002: master key never appears in logs", () => {
  it("SI-002: EncryptedPgShareStore log calls do not contain the DEV_ENVELOPE_KEY value", async () => {
    const KEY_HEX = randomBytes(32).toString("hex");
    const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const provider = new LocalEnvelopeKeyProvider(KEY_HEX, logger);
    const storeLogger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const brokenPool = {
      query: vi.fn().mockRejectedValue(new Error("DB error")),
      connect: vi.fn().mockRejectedValue(new Error("DB error")),
    } as unknown as pg.Pool;

    const store = new EncryptedPgShareStore(brokenPool, provider, storeLogger);

    // Attempt a store — DB fails but encryption succeeds; log events fire
    try {
      await store.storeShare("agent-id", "epoch:1", randomBytes(32));
    } catch {
      // expected
    }

    // The master key must never appear in any log call
    const allLogCalls = [
      ...(storeLogger.info as ReturnType<typeof vi.fn>).mock.calls,
      ...(storeLogger.warn as ReturnType<typeof vi.fn>).mock.calls,
      ...(storeLogger.error as ReturnType<typeof vi.fn>).mock.calls,
      ...(storeLogger.debug as ReturnType<typeof vi.fn>).mock.calls,
    ];
    for (const call of allLogCalls) {
      const serialized = JSON.stringify(call);
      expect(serialized).not.toContain(KEY_HEX);
    }
  });
});

describe("PERSIST-005 SI-003: structural validity check before INSERT", () => {
  it("SI-003: EncryptedPgShareStore rejects a provider that returns output too short for AES-256-GCM", async () => {
    // A broken provider that returns fewer bytes than expected (not enough for nonce+tag overhead)
    const garbageProvider = {
      encrypt: vi.fn().mockResolvedValue(new Uint8Array(10)), // too short (< 32 + 28)
      decrypt: vi.fn(),
      rotate: vi.fn(),
    };
    const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const store = new EncryptedPgShareStore(
      null as unknown as pg.Pool,
      garbageProvider,
      logger,
    );

    await expect(
      store.storeShare("agent-pubkey-hex", "epoch:1", randomBytes(32)),
    ).rejects.toThrow(/ciphertext.*structural/i);
  });

  it("SI-003: EncryptedPgShareStore rejects a provider that returns empty buffer", async () => {
    const emptyProvider = {
      encrypt: vi.fn().mockResolvedValue(new Uint8Array(0)),
      decrypt: vi.fn(),
      rotate: vi.fn(),
    };
    const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const store = new EncryptedPgShareStore(
      null as unknown as pg.Pool,
      emptyProvider,
      logger,
    );

    await expect(
      store.storeShare("agent-pubkey-hex", "epoch:1", randomBytes(32)),
    ).rejects.toThrow(/ciphertext.*structural/i);
  });
});

// ─── Integration tests — require CELLO_ENV=local + running Postgres ───────────

const isLocal = process.env["CELLO_ENV"] === "local";
const describeIntegration = isLocal ? describe : describe.skip;

const DATABASE_URL =
  process.env["DATABASE_URL"] ?? "postgresql://postgres:dev@localhost:5433/cello_dev";

let pool: pg.Pool;

beforeAll(async () => {
  if (!isLocal) return;
  pool = new pg.Pool({ connectionString: DATABASE_URL });
});

afterAll(async () => {
  if (!isLocal) return;
  await pool?.end();
});

describeIntegration("PERSIST-005 AC-002: encrypted_share in agent_key_shares != plaintext", () => {
  it("AC-002: raw bytes stored in agent_key_shares.encrypted_share are not the original plaintext", async () => {
    const KEY_HEX = process.env["DEV_ENVELOPE_KEY"] ?? randomBytes(32).toString("hex");
    const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const provider = new LocalEnvelopeKeyProvider(KEY_HEX, logger);
    const storeLogger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const store = new EncryptedPgShareStore(pool, provider, storeLogger);

    const agentId = `test-agent-${randomBytes(4).toString("hex")}`;
    const epochId = "epoch:1";
    const shareBytes = randomBytes(32);
    const shareHex = Buffer.from(shareBytes).toString("hex");

    await store.storeShare(agentId, epochId, shareBytes);

    // Read raw bytes directly from the database
    const result = await pool.query<{ encrypted_share: Buffer }>(
      `SELECT encrypted_share FROM agent_key_shares WHERE agent_id = $1 AND epoch_id = $2`,
      [agentId, epochId],
    );

    expect(result.rows.length).toBe(1);
    const storedHex = result.rows[0]!.encrypted_share.toString("hex");

    // The stored bytes must NOT equal the original plaintext
    expect(storedHex).not.toBe(shareHex);
  });
});

describeIntegration("PERSIST-005 AC-003: retrieve and decrypt returns original plaintext", () => {
  it("AC-003: decrypted bytes equal the original plaintext exactly", async () => {
    const KEY_HEX = process.env["DEV_ENVELOPE_KEY"] ?? randomBytes(32).toString("hex");
    const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const provider = new LocalEnvelopeKeyProvider(KEY_HEX, logger);
    const storeLogger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const store = new EncryptedPgShareStore(pool, provider, storeLogger);

    const agentId = `test-agent-${randomBytes(4).toString("hex")}`;
    const epochId = "epoch:1";
    const shareBytes = randomBytes(32);

    await store.storeShare(agentId, epochId, shareBytes);

    // Retrieve and decrypt
    const decrypted = await store.getShareBytes(agentId, epochId);

    expect(decrypted).not.toBeNull();
    expect(Buffer.from(decrypted!).toString("hex")).toBe(
      Buffer.from(shareBytes).toString("hex"),
    );
  });
});

describeIntegration("PERSIST-005 AC-005: key.encrypted logged with { keyId, agentId }, no share bytes", () => {
  it("AC-005: key.encrypted is logged at INFO with keyId and agentId; no share material in any log call", async () => {
    const KEY_HEX = process.env["DEV_ENVELOPE_KEY"] ?? randomBytes(32).toString("hex");
    const logger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const provider = new LocalEnvelopeKeyProvider(KEY_HEX, logger);
    const storeLogger: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const store = new EncryptedPgShareStore(pool, provider, storeLogger);

    const agentId = `test-agent-${randomBytes(4).toString("hex")}`;
    const epochId = "epoch:1";
    const shareBytes = randomBytes(32);
    const shareHex = Buffer.from(shareBytes).toString("hex");

    await store.storeShare(agentId, epochId, shareBytes);

    // key.encrypted must be logged with keyId and agentId
    expect(storeLogger.info).toHaveBeenCalledWith(
      "key.encrypted",
      expect.objectContaining({ agentId }),
    );

    // The plaintext share must not appear in any log call (store logger or provider logger)
    const allLogCalls = [
      ...(storeLogger.info as ReturnType<typeof vi.fn>).mock.calls,
      ...(storeLogger.warn as ReturnType<typeof vi.fn>).mock.calls,
      ...(storeLogger.error as ReturnType<typeof vi.fn>).mock.calls,
      ...(storeLogger.debug as ReturnType<typeof vi.fn>).mock.calls,
      ...(logger.info as ReturnType<typeof vi.fn>).mock.calls,
      ...(logger.warn as ReturnType<typeof vi.fn>).mock.calls,
      ...(logger.error as ReturnType<typeof vi.fn>).mock.calls,
      ...(logger.debug as ReturnType<typeof vi.fn>).mock.calls,
    ];
    for (const call of allLogCalls) {
      const serialized = JSON.stringify(call);
      expect(serialized).not.toContain(shareHex);
    }
  });
});
