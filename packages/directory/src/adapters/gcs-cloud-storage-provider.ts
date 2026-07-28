/**
 * GcsCloudStorageProvider — Google Cloud Storage CloudStorageProvider (M12 DOD-ADAPTER-GCP-1,
 * set by M12-D6). The GCP counterpart of `s3-cloud-storage-provider.ts`: the directory reads the
 * relay pool manifest through it, and the composition root picks S3 or GCS by `CELLO_ENV`/config
 * — nothing downstream knows which it got, so behavioral parity is the whole contract.
 *
 * The one real difference the adapter exists to absorb: **how "not found" is signalled.** S3 throws
 * a typed `NoSuchKey`; GCS throws a generic error carrying `code: 404`. The interface says
 * `download()` returns `undefined` when absent, so a 404 maps to `undefined` — and every OTHER
 * error propagates. That distinction is load-bearing: masking a 403 as "not found" would make a
 * permissions mistake read as an empty relay pool, and every session assignment would fail with no
 * cause named anywhere.
 *
 * Auth is Application Default Credentials — on a GCP VM that is the attached service account, so
 * no key material is handled here (org policy forbids SA keys; workload identity only).
 */

import type { CloudStorageProvider } from "@cello-protocol/interfaces";

/** The slice of `@google-cloud/storage` this adapter uses (injectable for tests). */
export interface GcsLike {
  bucket(name: string): {
    exists(): Promise<[boolean]>;
    file(name: string): {
      save(data: Buffer, opts?: unknown): Promise<unknown>;
      download(): Promise<[Buffer]>;
    };
  };
}

/** True for the GCS "object does not exist" signal — a 404 code on an otherwise generic error. */
function isNotFound(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === 404;
}

export class GcsCloudStorageProvider implements CloudStorageProvider {
  readonly #bucket: string;
  readonly #storage: GcsLike;

  /** `storage` is injected in tests; production passes a real `new Storage()`. */
  constructor(bucket: string, storage: GcsLike) {
    this.#bucket = bucket;
    this.#storage = storage;
  }

  async upload(key: string, data: Uint8Array): Promise<void> {
    await this.#storage.bucket(this.#bucket).file(key).save(Buffer.from(data));
  }

  async download(key: string): Promise<Uint8Array | undefined> {
    try {
      const [buf] = await this.#storage.bucket(this.#bucket).file(key).download();
      return new Uint8Array(buf);
    } catch (err: unknown) {
      if (!isNotFound(err)) throw err; // 403/500/network — never masquerade as an empty bucket
      // GCS 404s a MISSING BUCKET the same way it 404s a missing object — unlike S3, where
      // NoSuchBucket and NoSuchKey are distinct. Returning `undefined` for a mistyped bucket would
      // report a config error as "nothing published yet", which the relay-pool loader treats as a
      // benign designed state and never retries. Distinguish them.
      const [bucketExists] = await this.#storage.bucket(this.#bucket).exists();
      if (!bucketExists) {
        throw new Error(`gcs: bucket '${this.#bucket}' does not exist — check the bucket name/IaC, this is NOT an empty bucket`);
      }
      return undefined; // the object really is absent — the interface's documented signal
    }
  }
}
