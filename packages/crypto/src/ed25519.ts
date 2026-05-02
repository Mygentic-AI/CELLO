import { ed25519 } from "@noble/curves/ed25519.js";
import { randomBytes } from "@noble/hashes/utils.js";
import { readFile, rename, mkdir, open as fsOpen } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { KeyProvider, PublicKey, Signature } from "./types.js";

const INSPECT = Symbol.for("nodejs.util.inspect.custom");
const KEY_FILE_MAGIC = new Uint8Array([0xce, 0x11, 0x0e, 0x01]); // "CELLO\x01"
const KEY_FILE_VERSION = 1;
const SEED_BYTES = 32;
// Magic(4) + version(1) + seed(32) = 37 bytes
const KEY_FILE_SIZE = KEY_FILE_MAGIC.length + 1 + SEED_BYTES;

export class InMemoryKeyProvider implements KeyProvider {
  readonly #seed: Uint8Array;
  readonly #publicKey: PublicKey;

  constructor(seed: Uint8Array) {
    if (seed.length !== SEED_BYTES) throw new Error("seed must be 32 bytes");
    this.#seed = seed;
    this.#publicKey = ed25519.getPublicKey(seed);
  }

  async getPublicKey(): Promise<PublicKey> {
    return this.#publicKey;
  }

  async sign(data: Uint8Array): Promise<Signature> {
    return ed25519.sign(data, this.#seed);
  }

  toJSON(): Record<string, string> {
    return { type: "InMemoryKeyProvider", publicKey: Buffer.from(this.#publicKey).toString("hex") };
  }

  toString(): string {
    return `InMemoryKeyProvider(pubkey=${Buffer.from(this.#publicKey).toString("hex")})`;
  }

  [INSPECT](): string {
    return this.toString();
  }
}

export class FileKeyProvider implements KeyProvider {
  readonly #inner: InMemoryKeyProvider;

  private constructor(inner: InMemoryKeyProvider) {
    this.#inner = inner;
  }

  static async load(path: string): Promise<FileKeyProvider> {
    // Attempt to read without existsSync to avoid TOCTOU: if the file disappears
    // between a check and a read, readFile throws ENOENT — treated as "not found".
    let raw: Buffer | null = null;
    try {
      raw = await readFile(path);
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        throw { reason: "key_file_corrupt", message: `cannot read key file: ${(err as Error).message}` };
      }
      // ENOENT → fall through to generation
    }

    if (raw !== null) {
      if (raw.length !== KEY_FILE_SIZE) {
        throw { reason: "key_file_corrupt", message: `key file has wrong length: expected ${KEY_FILE_SIZE}, got ${raw.length}` };
      }
      for (let i = 0; i < KEY_FILE_MAGIC.length; i++) {
        if (raw[i] !== KEY_FILE_MAGIC[i]) {
          throw { reason: "key_file_corrupt", message: "key file has invalid magic bytes" };
        }
      }
      if (raw[KEY_FILE_MAGIC.length] !== KEY_FILE_VERSION) {
        throw { reason: "key_file_corrupt", message: `key file has unsupported version: ${raw[KEY_FILE_MAGIC.length]}` };
      }
      const seed = raw.slice(KEY_FILE_MAGIC.length + 1, KEY_FILE_MAGIC.length + 1 + SEED_BYTES);
      return new FileKeyProvider(new InMemoryKeyProvider(seed));
    }

    // Generate and atomically write a new key file.
    // Tmp file lives in the same directory as the target so rename() is same-filesystem.
    const seed = randomBytes(SEED_BYTES);
    const buf = Buffer.alloc(KEY_FILE_SIZE);
    KEY_FILE_MAGIC.forEach((b: number, i: number) => { buf[i] = b; });
    buf[KEY_FILE_MAGIC.length] = KEY_FILE_VERSION;
    seed.forEach((b: number, i: number) => { buf[KEY_FILE_MAGIC.length + 1 + i] = b; });

    const dir = dirname(path);
    await mkdir(dir, { recursive: true });
    const tmp = join(dir, `.cello-key-tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    // Write to tmp fd with O_CREAT|O_EXCL, fchmod before close, then rename — so the file
    // arrives at its final path with 0o600 already set (no post-rename chmod race window).
    const fd = await fsOpen(tmp, "wx", 0o600);
    try {
      await fd.write(buf);
      await fd.chmod(0o600);
    } finally {
      await fd.close();
    }
    await rename(tmp, path);

    return new FileKeyProvider(new InMemoryKeyProvider(seed));
  }

  async getPublicKey(): Promise<PublicKey> {
    return this.#inner.getPublicKey();
  }

  async sign(data: Uint8Array): Promise<Signature> {
    return this.#inner.sign(data);
  }

  toJSON(): Record<string, unknown> {
    return { type: "FileKeyProvider", publicKey: this.#inner.toJSON().publicKey };
  }

  toString(): string {
    return `FileKeyProvider(pubkey=${this.#inner.toJSON().publicKey})`;
  }

  [INSPECT](): string {
    return this.toString();
  }
}

export function generateKeypair(): InMemoryKeyProvider {
  return new InMemoryKeyProvider(randomBytes(SEED_BYTES));
}

export function verify(publicKey: PublicKey, data: Uint8Array, signature: Signature): boolean {
  try {
    return ed25519.verify(signature, data, publicKey);
  } catch {
    return false;
  }
}
