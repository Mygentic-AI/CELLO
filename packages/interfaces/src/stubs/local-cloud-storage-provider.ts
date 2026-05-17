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
import { join, dirname, resolve } from "node:path";
import type { CloudStorageProvider } from "../cloud-storage-provider.js";

export class LocalCloudStorageProvider implements CloudStorageProvider {
  readonly #baseDir: string;

  constructor(baseDir: string) {
    this.#baseDir = resolve(baseDir);
  }

  /**
   * Validate that the resolved path does not escape the base directory.
   * Prevents path traversal attacks via keys like '../../../etc/passwd'.
   */
  #validatePath(key: string): string {
    const filePath = resolve(join(this.#baseDir, key));
    if (!filePath.startsWith(this.#baseDir + "/") && filePath !== this.#baseDir) {
      throw new Error(`Path traversal detected: key '${key}' escapes base directory`);
    }
    return filePath;
  }

  async upload(key: string, data: Uint8Array): Promise<void> {
    const filePath = this.#validatePath(key);
    const dir = dirname(filePath);
    await mkdir(dir, { recursive: true });
    await writeFile(filePath, data);
  }

  async download(key: string): Promise<Uint8Array | undefined> {
    const filePath = this.#validatePath(key);
    try {
      const buf = await readFile(filePath);
      return new Uint8Array(buf);
    } catch (err: unknown) {
      // Return undefined if file does not exist
      if (err instanceof Error && "code" in err && err.code === "ENOENT") {
        return undefined;
      }
      throw err;
    }
  }
}
