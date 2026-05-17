/**
 * LocalCloudStorageProvider — filesystem-backed CloudStorageProvider for CELLO_ENV=local.
 *
 * PERSIST-011: Writes uploaded data to a configured local directory.
 * The production S3 implementation is added in M5.
 *
 * Design:
 *   - Key paths are stored as files under the base directory.
 *   - Slashes in keys create subdirectories (e.g. 'backup/agent-id/db.enc' →
 *     '<baseDir>/backup/agent-id/db.enc').
 *   - upload() overwrites if file already exists.
 *   - download() returns undefined if the file does not exist.
 */

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { existsSync } from "node:fs";
import type { CloudStorageProvider } from "../cloud-storage-provider.js";

export class LocalCloudStorageProvider implements CloudStorageProvider {
  readonly #baseDir: string;

  constructor(baseDir: string) {
    this.#baseDir = baseDir;
  }

  async upload(key: string, data: Uint8Array): Promise<void> {
    const filePath = join(this.#baseDir, key);
    const dir = dirname(filePath);
    await mkdir(dir, { recursive: true });
    await writeFile(filePath, data);
  }

  async download(key: string): Promise<Uint8Array | undefined> {
    const filePath = join(this.#baseDir, key);
    if (!existsSync(filePath)) {
      return undefined;
    }
    const buf = await readFile(filePath);
    return new Uint8Array(buf);
  }
}
