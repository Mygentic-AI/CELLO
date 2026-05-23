/**
 * S3CloudStorageProvider — AWS S3-backed CloudStorageProvider for CELLO_ENV != local.
 *
 * PERSIST-022: Implements the CloudStorageProvider interface using AWS S3.
 * Used for encrypted backup upload/download when BACKUP_S3_BUCKET is configured.
 *
 * Pseudocode:
 *   constructor({ bucket, region }):
 *     1. Store bucket and region.
 *     2. Create S3Client with the provided region.
 *        The S3Client uses the AWS SDK's default credential chain
 *        (IAM role in ECS, ~/.aws credentials locally, etc.).
 *
 *   upload(key, data):
 *     1. Send PutObjectCommand({ Bucket: bucket, Key: key, Body: data }).
 *     2. On success: return void.
 *     3. On error: throw (caller — ClientBackup — handles it via client.backup.upload.failed).
 *
 *   download(key):
 *     1. Send GetObjectCommand({ Bucket: bucket, Key: key }).
 *     2. On success: stream Body to a Uint8Array and return it.
 *     3. On NoSuchKey (S3 error code): return undefined (key not found is not an error).
 *     4. On other errors: throw (caller handles it).
 *
 * Security notes:
 *   - This class never touches encryption keys. ClientBackup handles all crypto.
 *   - No logging in this class — ClientBackup is the observable layer.
 *   - Constructor takes a plain config object (not an S3Client) so the interface stays clean.
 */

import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import type { CloudStorageProvider } from "@cello/interfaces";

/** Configuration for S3CloudStorageProvider. Provided by the composition root. */
export interface S3CloudStorageConfig {
  /** S3 bucket name. Comes from BACKUP_S3_BUCKET env var, read at composition root. */
  bucket: string;
  /** AWS region. Comes from AWS_REGION env var, read at composition root. */
  region: string;
}

export class S3CloudStorageProvider implements CloudStorageProvider {
  readonly #client: S3Client;
  readonly #bucket: string;

  constructor(config: S3CloudStorageConfig) {
    this.#bucket = config.bucket;
    this.#client = new S3Client({ region: config.region });
  }

  /**
   * Upload data to the given key in S3.
   * Overwrites if the object already exists.
   * Throws on any S3 error — ClientBackup handles the error and logs it.
   */
  async upload(key: string, data: Uint8Array): Promise<void> {
    await this.#client.send(
      new PutObjectCommand({
        Bucket: this.#bucket,
        Key: key,
        Body: data,
      }),
    );
  }

  /**
   * Download data from the given key in S3.
   * Returns undefined if the object does not exist (NoSuchKey).
   * Throws on any other S3 error.
   */
  async download(key: string): Promise<Uint8Array | undefined> {
    try {
      const response = await this.#client.send(
        new GetObjectCommand({
          Bucket: this.#bucket,
          Key: key,
        }),
      );

      // Body is a Readable stream from the SDK; collect into a Uint8Array
      if (!response.Body) {
        return new Uint8Array(0);
      }

      // @aws-sdk/client-s3 v3: Body has transformToByteArray() in Node.js environments
      const bytes = await (response.Body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray();
      return bytes;
    } catch (err: unknown) {
      // Return undefined for the key-not-found case
      if (
        err !== null &&
        typeof err === "object" &&
        "name" in err &&
        (err as { name: string }).name === "NoSuchKey"
      ) {
        return undefined;
      }
      throw err;
    }
  }
}
