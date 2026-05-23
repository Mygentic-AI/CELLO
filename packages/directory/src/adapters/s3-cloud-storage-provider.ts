/**
 * S3CloudStorageProvider — AWS S3-backed CloudStorageProvider for directory package
 * (CELLO-RELAY-001).
 *
 * Used to read the relay pool manifest from S3.
 * The directory package already depends on @aws-sdk/client-s3 for audit log shipping.
 *
 * The client package has its own S3CloudStorageProvider for backup storage.
 * This is a separate implementation in the directory package — same interface, same SDK,
 * but instantiated in the directory composition root for the relay manifest bucket.
 *
 * Pseudocode:
 *   upload(key, data):
 *     1. Send PutObjectCommand({ Bucket: bucket, Key: key, Body: data }).
 *     2. On success: return void.
 *     3. On error: throw.
 *
 *   download(key):
 *     1. Send GetObjectCommand({ Bucket: bucket, Key: key }).
 *     2. On success: stream Body to a Uint8Array and return it.
 *     3. On NoSuchKey: return undefined.
 *     4. On other errors: throw.
 */

import { S3Client, PutObjectCommand, GetObjectCommand, NoSuchKey } from "@aws-sdk/client-s3";
import type { CloudStorageProvider } from "@cello/interfaces";

export class S3CloudStorageProvider implements CloudStorageProvider {
  readonly #client: S3Client;
  readonly #bucket: string;

  constructor(bucket: string, region: string) {
    this.#bucket = bucket;
    this.#client = new S3Client({ region });
  }

  async upload(key: string, data: Uint8Array): Promise<void> {
    await this.#client.send(
      new PutObjectCommand({ Bucket: this.#bucket, Key: key, Body: data }),
    );
  }

  async download(key: string): Promise<Uint8Array | undefined> {
    try {
      const response = await this.#client.send(
        new GetObjectCommand({ Bucket: this.#bucket, Key: key }),
      );
      if (!response.Body) return undefined;
      // Stream to Uint8Array
      const chunks: Uint8Array[] = [];
      for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
        chunks.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk as Buffer));
      }
      const total = chunks.reduce((sum, c) => sum + c.length, 0);
      const result = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }
      return result;
    } catch (err: unknown) {
      if (err instanceof NoSuchKey) return undefined;
      throw err;
    }
  }
}
