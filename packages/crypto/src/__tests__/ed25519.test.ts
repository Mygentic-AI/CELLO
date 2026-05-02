import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rm, readFile, writeFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { inspect } from "node:util";
import {
  generateKeypair,
  verify,
  InMemoryKeyProvider,
  FileKeyProvider,
} from "../ed25519.js";

// ─── CRYPTO-001 AC-001: key generation returns correct sizes ─────────────────
describe("generateKeypair", () => {
  it("AC-001: returns InMemoryKeyProvider with 32-byte public key", async () => {
    const kp = generateKeypair();
    const pubkey = await kp.getPublicKey();
    expect(pubkey).toBeInstanceOf(Uint8Array);
    expect(pubkey.length).toBe(32);
  });

  // AC-006: two keypairs produce different public keys
  it("AC-006: two calls produce different public keys", async () => {
    const a = await generateKeypair().getPublicKey();
    const b = await generateKeypair().getPublicKey();
    expect(Buffer.from(a).toString("hex")).not.toBe(Buffer.from(b).toString("hex"));
  });
});

// ─── CRYPTO-001 AC-002: sign + verify happy path ─────────────────────────────
describe("sign and verify", () => {
  it("AC-002: sign produces 64-byte signature; verify returns true", async () => {
    const kp = generateKeypair();
    const pubkey = await kp.getPublicKey();
    const data = new TextEncoder().encode("hello cello");
    const sig = await kp.sign(data);
    expect(sig).toBeInstanceOf(Uint8Array);
    expect(sig.length).toBe(64);
    expect(verify(pubkey, data, sig)).toBe(true);
  });

  // AC-003: wrong public key → false
  it("AC-003: verify with wrong public key returns false", async () => {
    const kp1 = generateKeypair();
    const kp2 = generateKeypair();
    const pubkey2 = await kp2.getPublicKey();
    const data = new TextEncoder().encode("some data");
    const sig = await kp1.sign(data);
    expect(verify(pubkey2, data, sig)).toBe(false);
  });

  // AC-004: tampered data → false
  it("AC-004: verify with tampered data returns false", async () => {
    const kp = generateKeypair();
    const pubkey = await kp.getPublicKey();
    const data = new Uint8Array(1024).fill(0xab);
    const sig = await kp.sign(data);
    const tampered = data.slice();
    tampered[512] ^= 0x01;
    expect(verify(pubkey, tampered, sig)).toBe(false);
  });

  // AC-005: malformed/truncated signature → false without throwing
  it("AC-005: verify with zero-filled 64-byte signature returns false", async () => {
    const kp = generateKeypair();
    const pubkey = await kp.getPublicKey();
    const data = new TextEncoder().encode("test");
    const badSig = new Uint8Array(64);
    expect(verify(pubkey, data, badSig)).toBe(false);
  });

  it("AC-005: verify with truncated signature returns false", async () => {
    const kp = generateKeypair();
    const pubkey = await kp.getPublicKey();
    const data = new TextEncoder().encode("test");
    const truncated = new Uint8Array(32);
    expect(verify(pubkey, data, truncated)).toBe(false);
  });

  // AC-007: empty data
  it("AC-007: sign of empty bytes produces valid 64-byte signature", async () => {
    const kp = generateKeypair();
    const pubkey = await kp.getPublicKey();
    const empty = new Uint8Array(0);
    const sig = await kp.sign(empty);
    expect(sig.length).toBe(64);
    expect(verify(pubkey, empty, sig)).toBe(true);
    expect(verify(pubkey, new Uint8Array([0x01]), sig)).toBe(false);
  });
});

// ─── CRYPTO-001 SI-001: private key never surfaces ───────────────────────────
describe("KeyProvider private key confinement (SI-001)", () => {
  let kp: InMemoryKeyProvider;
  let pubkeyHex: string;

  beforeEach(async () => {
    kp = generateKeypair();
    pubkeyHex = Buffer.from(await kp.getPublicKey()).toString("hex");
  });

  it("SI-001: toString does not leak key material beyond pubkey", () => {
    const s = kp.toString();
    // Must contain pubkey (that's fine), must not expose anything else that looks like a 32-byte key
    expect(s).toContain(pubkeyHex);
    // The only 64-char hex sequence in the output should be the pubkey
    const hexMatches = s.match(/[0-9a-f]{64}/gi) ?? [];
    for (const m of hexMatches) {
      expect(m.toLowerCase()).toBe(pubkeyHex);
    }
  });

  it("SI-001: toJSON does not expose private key material", () => {
    const j = JSON.stringify(kp);
    const hexMatches = j.match(/[0-9a-f]{64}/gi) ?? [];
    for (const m of hexMatches) {
      expect(m.toLowerCase()).toBe(pubkeyHex);
    }
  });

  it("SI-001: util.inspect does not expose private key material", () => {
    const s = inspect(kp);
    const hexMatches = s.match(/[0-9a-f]{64}/gi) ?? [];
    for (const m of hexMatches) {
      expect(m.toLowerCase()).toBe(pubkeyHex);
    }
  });
});

// ─── CRYPTO-001 SI-003: interface shape ──────────────────────────────────────
describe("KeyProvider interface shape (SI-003)", () => {
  it("SI-003: InMemoryKeyProvider has exactly getPublicKey and sign as async methods", async () => {
    const kp = generateKeypair();
    expect(typeof kp.getPublicKey).toBe("function");
    expect(typeof kp.sign).toBe("function");
    // No exportKey, getPrivateKey, or similar escape hatches
    const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(kp));
    const publicApiMethods = proto.filter((n) => !n.startsWith("#") && n !== "constructor");
    expect(publicApiMethods).not.toContain("exportKey");
    expect(publicApiMethods).not.toContain("getPrivateKey");
    expect(publicApiMethods).not.toContain("getSeed");
  });
});

// ─── CRYPTO-001 AC-008–012: FileKeyProvider ──────────────────────────────────
describe("FileKeyProvider", () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = join(tmpdir(), `cello-test-key-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  });

  afterEach(async () => {
    if (existsSync(tmpPath)) await rm(tmpPath);
  });

  it("AC-008: creates key file when none exists; subsequent load returns same pubkey", async () => {
    expect(existsSync(tmpPath)).toBe(false);
    const kp1 = await FileKeyProvider.load(tmpPath);
    expect(existsSync(tmpPath)).toBe(true);
    const pub1 = await kp1.getPublicKey();

    const kp2 = await FileKeyProvider.load(tmpPath);
    const pub2 = await kp2.getPublicKey();
    expect(Buffer.from(pub1).toString("hex")).toBe(Buffer.from(pub2).toString("hex"));
  });

  it("AC-009: K_local is stable across loads (AC-008 recheck)", async () => {
    const kp1 = await FileKeyProvider.load(tmpPath);
    const pub1 = Buffer.from(await kp1.getPublicKey()).toString("hex");
    const kp2 = await FileKeyProvider.load(tmpPath);
    const pub2 = Buffer.from(await kp2.getPublicKey()).toString("hex");
    expect(pub1).toBe(pub2);
  });

  it("AC-010: corrupt key file throws key_file_corrupt; does not overwrite", async () => {
    await writeFile(tmpPath, Buffer.from("this is not a valid key file"), { mode: 0o600 });
    const beforeStat = await readFile(tmpPath);
    await expect(FileKeyProvider.load(tmpPath)).rejects.toMatchObject({ reason: "key_file_corrupt" });
    const afterStat = await readFile(tmpPath);
    expect(beforeStat.toString("hex")).toBe(afterStat.toString("hex"));
  });

  it("AC-011: key file is created with permissions 0o600", async () => {
    await FileKeyProvider.load(tmpPath);
    const s = await stat(tmpPath);
    // On macOS/Linux: 0o100600 = regular file + 0o600
    expect(s.mode & 0o777).toBe(0o600);
  });

  it("AC-012: loaded FileKeyProvider produces valid signatures", async () => {
    const kp = await FileKeyProvider.load(tmpPath);
    const pubkey = await kp.getPublicKey();
    const data = new TextEncoder().encode("persistence test");
    const sig = await kp.sign(data);
    expect(verify(pubkey, data, sig)).toBe(true);
  });

  it("AC-010: truncated key file throws key_file_corrupt", async () => {
    await writeFile(tmpPath, Buffer.alloc(10), { mode: 0o600 });
    await expect(FileKeyProvider.load(tmpPath)).rejects.toMatchObject({ reason: "key_file_corrupt" });
  });
});
