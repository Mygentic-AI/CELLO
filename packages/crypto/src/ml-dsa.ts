/**
 * @cello-protocol/crypto — ML-DSA-44 signing primitives (CELLO-CRYPTO-004)
 *
 * Phase P — Pseudocode (FIPS 204 / CRYSTALS-Dilithium)
 * ────────────────────────────────────────────────────
 * Implements ML-DSA-44 as defined in NIST FIPS 204
 * (https://csrc.nist.gov/pubs/fips/204/final).
 * Parameter set ML-DSA-44 (security level 2, 128-bit post-quantum security):
 *   public key  = 1312 bytes
 *   secret key  = 2560 bytes
 *   signature   = 2420 bytes
 *
 * Library: @oqs/liboqs-js (WASM bindings to the Open Quantum Safe liboqs C library)
 * API (note argument order in liboqs-js):
 *   createMLDSA44()                            → Promise<MLDSA44 instance>
 *   instance.generateKeyPair()                 → { publicKey: Uint8Array, secretKey: Uint8Array }
 *   instance.sign(message, secretKey)          → Uint8Array (2420 bytes)
 *   instance.verify(message, signature, publicKey) → boolean
 *
 * Design:
 *   - A module-level singleton holds the WASM instance (loaded once, reused).
 *   - mlDsaKeygen() returns an InMemoryMlDsaKeyProvider wrapping the keypair.
 *   - mlDsaSign(secretKey, message) — free stateless signing function.
 *   - mlDsaVerify(publicKey, message, signature) — free stateless verification;
 *     catches LibOQSValidationError for wrong-size inputs and returns false.
 *   - Secret key never leaves the provider boundary; private fields enforce containment.
 *   - FileMlDsaKeyProvider persists keypair atomically (write-to-tmp + rename, 0o600).
 *
 * SI-003: parameter set is pinned to ML-DSA-44. No runtime selection is possible.
 */

import { readFile, rename, mkdir, open as fsOpen } from "node:fs/promises";
import { dirname, join } from "node:path";

// ─── Phase A: Type interfaces ─────────────────────────────────────────────────

/** 1312-byte ML-DSA-44 public key */
export type MlDsaPublicKey = Uint8Array;

/** 2420-byte ML-DSA-44 signature */
export type MlDsaSignature = Uint8Array;

/** ML-DSA-44 keypair produced by key generation */
export interface MlDsaKeyPair {
  publicKey: MlDsaPublicKey; // 1312 bytes
  secretKey: Uint8Array;     // 2560 bytes — never returned from provider API
}

/** Provider abstraction: holds secret key in private storage; exposes only public ops */
export interface MlDsaKeyProvider {
  getPublicKey(): Promise<MlDsaPublicKey>;
  sign(message: Uint8Array): Promise<MlDsaSignature>;
}

// ─── WASM singleton ──────────────────────────────────────────────────────────

// The WASM module is loaded asynchronously on first use and cached here.
// Using a promise-based singleton (M-002 fix) prevents double-init when multiple
// callers await _getWasm() concurrently before the first load resolves: all
// concurrent callers share the same in-flight Promise, so _loadWasm() is called
// exactly once regardless of concurrency.
type WasmInstance = Awaited<ReturnType<typeof _loadWasm>>;
let _wasmPromise: Promise<WasmInstance> | null = null;

async function _loadWasm() {
  // Dynamic import keeps liboqs-js out of the synchronous module graph.
  // createMLDSA44 initialises and returns an ML-DSA-44 WASM context.
  const { createMLDSA44 } = await import("@oqs/liboqs-js");
  return createMLDSA44();
}

async function _getWasm(): Promise<WasmInstance> {
  if (_wasmPromise === null) {
    _wasmPromise = _loadWasm();
  }
  const instance = await _wasmPromise;
  // Cache the resolved value so the synchronous mlDsaSign/mlDsaVerify free
  // functions can read it without re-awaiting.
  _wasmInstance = instance;
  return instance;
}

// Populated after the first _getWasm() resolves. Synchronous free functions
// (mlDsaSign, mlDsaVerify) read this directly. Callers must ensure _getWasm()
// has been awaited (via mlDsaKeygen() or mlDsaEnsureLoaded()) before calling
// the synchronous free functions.
let _wasmInstance: WasmInstance | null = null;

// ─── File format constants ───────────────────────────────────────────────────

// File layout: magic(5) + version(1) + publicKey(1312) + secretKey(2560) = 3878 bytes
const ML_DSA_FILE_MAGIC = new Uint8Array([0xce, 0x11, 0x0d, 0x53, 0x41]); // "CELLO_MLDSA"
const ML_DSA_FILE_VERSION = 1;
const ML_DSA_PK_BYTES = 1312;
const ML_DSA_SK_BYTES = 2560;
const ML_DSA_FILE_SIZE =
  ML_DSA_FILE_MAGIC.length + 1 + ML_DSA_PK_BYTES + ML_DSA_SK_BYTES;

// ─── Custom inspect symbol ───────────────────────────────────────────────────

const INSPECT = Symbol.for("nodejs.util.inspect.custom");

// ─── InMemoryMlDsaKeyProvider ────────────────────────────────────────────────

export class InMemoryMlDsaKeyProvider implements MlDsaKeyProvider {
  readonly #publicKey: MlDsaPublicKey;
  readonly #secretKey: Uint8Array;

  constructor(publicKey: Uint8Array, secretKey: Uint8Array) {
    if (publicKey.length !== ML_DSA_PK_BYTES) {
      throw new Error(`ML-DSA-44 public key must be ${ML_DSA_PK_BYTES} bytes, got ${publicKey.length}`);
    }
    if (secretKey.length !== ML_DSA_SK_BYTES) {
      throw new Error(`ML-DSA-44 secret key must be ${ML_DSA_SK_BYTES} bytes, got ${secretKey.length}`);
    }
    // Defensive copies: ensure the internal state is not shared with caller buffers.
    this.#publicKey = publicKey.slice();
    this.#secretKey = secretKey.slice();
  }

  async getPublicKey(): Promise<MlDsaPublicKey> {
    // Return a copy to prevent external mutation of the internal public key buffer.
    return this.#publicKey.slice();
  }

  async sign(message: Uint8Array): Promise<MlDsaSignature> {
    const wasm = await _getWasm();
    // liboqs-js validates `message.constructor.name === 'Uint8Array'`, which fails for
    // cross-realm Uint8Arrays (bytes from a compiled dep resolved in a different V8 context).
    // new Uint8Array(message) copies the bytes into a fresh instance in the current realm.
    const msg = new Uint8Array(message);
    return wasm.sign(msg, this.#secretKey);
  }

  // SI-001: redacted representations — secret key must never appear in any of these
  toJSON(): Record<string, string> {
    return {
      type: "InMemoryMlDsaKeyProvider",
      publicKey: Buffer.from(this.#publicKey).toString("hex"),
    };
  }

  toString(): string {
    return `InMemoryMlDsaKeyProvider(pubkey=${Buffer.from(this.#publicKey).toString("hex")})`;
  }

  [INSPECT](): string {
    return this.toString();
  }
}

// ─── FileMlDsaKeyProvider ────────────────────────────────────────────────────

export class FileMlDsaKeyProvider implements MlDsaKeyProvider {
  readonly #inner: InMemoryMlDsaKeyProvider;

  private constructor(inner: InMemoryMlDsaKeyProvider) {
    this.#inner = inner;
  }

  /**
   * Load (or generate) a key file at the given path.
   *
   * - No file → generate fresh keypair, write atomically (write-to-tmp + rename), 0o600
   * - File exists and valid → load and return
   * - File exists but corrupt → throw { reason: 'ml_dsa_key_file_corrupt' }, never overwrite
   */
  static async load(path: string): Promise<FileMlDsaKeyProvider> {
    let raw: Buffer | null = null;
    try {
      raw = await readFile(path);
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        throw {
          reason: "ml_dsa_key_file_corrupt",
          message: `cannot read ML-DSA key file: ${(err as Error).message}`,
        };
      }
      // ENOENT → fall through to generation
    }

    if (raw !== null) {
      return FileMlDsaKeyProvider._parseFile(raw);
    }

    // Generate and atomically write a new key file.
    const wasm = await _getWasm();
    const { publicKey, secretKey } = wasm.generateKeyPair();

    const buf = Buffer.alloc(ML_DSA_FILE_SIZE);
    let offset = 0;
    ML_DSA_FILE_MAGIC.forEach((b, i) => { buf[i] = b; });
    offset = ML_DSA_FILE_MAGIC.length;
    buf[offset++] = ML_DSA_FILE_VERSION;
    publicKey.forEach((b: number, i: number) => { buf[offset + i] = b; });
    offset += ML_DSA_PK_BYTES;
    secretKey.forEach((b: number, i: number) => { buf[offset + i] = b; });

    const dir = dirname(path);
    await mkdir(dir, { recursive: true });
    const tmp = join(
      dir,
      `.cello-mldsa-key-tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    const fd = await fsOpen(tmp, "wx", 0o600);
    try {
      await fd.write(buf);
      await fd.chmod(0o600);
    } finally {
      await fd.close();
    }
    await rename(tmp, path);

    return new FileMlDsaKeyProvider(
      new InMemoryMlDsaKeyProvider(publicKey, secretKey),
    );
  }

  /** Parse and validate a raw key file buffer. Throws on corrupt data. */
  private static _parseFile(raw: Buffer): FileMlDsaKeyProvider {
    if (raw.length !== ML_DSA_FILE_SIZE) {
      throw {
        reason: "ml_dsa_key_file_corrupt",
        message: `ML-DSA key file has wrong length: expected ${ML_DSA_FILE_SIZE}, got ${raw.length}`,
      };
    }
    for (let i = 0; i < ML_DSA_FILE_MAGIC.length; i++) {
      if (raw[i] !== ML_DSA_FILE_MAGIC[i]) {
        throw {
          reason: "ml_dsa_key_file_corrupt",
          message: "ML-DSA key file has invalid magic bytes",
        };
      }
    }
    if (raw[ML_DSA_FILE_MAGIC.length] !== ML_DSA_FILE_VERSION) {
      throw {
        reason: "ml_dsa_key_file_corrupt",
        message: `ML-DSA key file has unsupported version: ${raw[ML_DSA_FILE_MAGIC.length]}`,
      };
    }
    let offset = ML_DSA_FILE_MAGIC.length + 1;
    const publicKey = new Uint8Array(raw.buffer, raw.byteOffset + offset, ML_DSA_PK_BYTES).slice();
    offset += ML_DSA_PK_BYTES;
    const secretKey = new Uint8Array(raw.buffer, raw.byteOffset + offset, ML_DSA_SK_BYTES).slice();

    return new FileMlDsaKeyProvider(
      new InMemoryMlDsaKeyProvider(publicKey, secretKey),
    );
  }

  async getPublicKey(): Promise<MlDsaPublicKey> {
    return this.#inner.getPublicKey();
  }

  async sign(message: Uint8Array): Promise<MlDsaSignature> {
    return this.#inner.sign(message);
  }

  // SI-001: redacted representations
  toJSON(): Record<string, string> {
    return {
      type: "FileMlDsaKeyProvider",
      publicKey: this.#inner.toJSON()["publicKey"]!,
    };
  }

  toString(): string {
    return `FileMlDsaKeyProvider(pubkey=${this.#inner.toJSON()["publicKey"]})`;
  }

  [INSPECT](): string {
    return this.toString();
  }
}

// ─── Free functions ──────────────────────────────────────────────────────────

/**
 * Generate a new ML-DSA-44 keypair and return an InMemoryMlDsaKeyProvider.
 * SI-003: parameter set is pinned to ML-DSA-44 — no selection argument.
 */
export async function mlDsaKeygen(): Promise<InMemoryMlDsaKeyProvider> {
  const wasm = await _getWasm();
  const { publicKey, secretKey } = wasm.generateKeyPair();
  return new InMemoryMlDsaKeyProvider(publicKey, secretKey);
}

/**
 * Sign a message with an ML-DSA-44 secret key.
 * Returns a 2420-byte signature.
 *
 * Note: mlDsaSign is synchronous-looking but uses the cached WASM instance.
 * In practice the WASM instance must already be loaded (call mlDsaKeygen first).
 * If not loaded, throws synchronously — callers should prefer provider.sign().
 */
export function mlDsaSign(secretKey: Uint8Array, message: Uint8Array): Uint8Array {
  if (_wasmInstance === null) {
    throw new Error("ML-DSA WASM not loaded — call mlDsaKeygen() or await mlDsaEnsureLoaded() first");
  }
  return _wasmInstance.sign(message, secretKey);
}

/**
 * Verify an ML-DSA-44 signature.
 * Returns false (never throws) for any invalid input including wrong-size keys.
 * SI-003: only ML-DSA-44 is supported.
 */
export function mlDsaVerify(
  publicKey: Uint8Array,
  message: Uint8Array,
  signature: Uint8Array,
): boolean {
  if (_wasmInstance === null) {
    return false;
  }
  try {
    return _wasmInstance.verify(message, signature, publicKey);
  } catch {
    // LibOQSValidationError for wrong-size keys/signatures → return false (AC-005, AC-006)
    return false;
  }
}

/**
 * Ensure the WASM instance is loaded. Call this before using mlDsaSign/mlDsaVerify
 * as free functions if you have not called mlDsaKeygen() yet.
 */
export async function mlDsaEnsureLoaded(): Promise<void> {
  await _getWasm();
}
