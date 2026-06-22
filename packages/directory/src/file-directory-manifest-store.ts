/**
 * M7-MANIFEST-002 / DOD-AUTH-2 — FileDirectoryManifestStore.
 *
 * The directory's source for the consortium manifest it serves to clients that poll
 * (`manifest_poll_request` → `manifest_poll_response`). It re-reads the manifest JSON
 * from disk on every `getCurrentManifest()` call, so an officer can deploy a newer
 * signed manifest version beside the directory and clients adopt it on their next poll
 * — the production-faithful TUF refresh seam (and the live test's rotation point).
 *
 * The store does NOT verify signatures: the directory is only a transport for the
 * manifest. Every polling client independently re-verifies the threshold officer
 * signatures, validity window, and anti-rollback version (SignalingManager
 * .handleManifestPollResponse) before adopting — the directory is not trusted for the
 * manifest's content.
 *
 * Never throws from getCurrentManifest() (the interface contract): on a read/parse
 * error it serves the last good manifest it cached. It DOES throw at construction if
 * the initial read fails, so a misconfigured path fails loudly at directory startup.
 */

import { readFileSync } from "node:fs";
import type { DirectoryManifestStore } from "@cello-protocol/interfaces";
import type { ConsortiumManifest } from "@cello-protocol/protocol-types";

export interface FileDirectoryManifestStoreLogger {
  info(event: string, context: Record<string, unknown>): void;
  warn(event: string, context: Record<string, unknown>): void;
}

export class FileDirectoryManifestStore implements DirectoryManifestStore {
  readonly #path: string;
  readonly #logger: FileDirectoryManifestStoreLogger | undefined;
  #lastGood: ConsortiumManifest;

  constructor(path: string, logger?: FileDirectoryManifestStoreLogger) {
    this.#path = path;
    this.#logger = logger;
    // Initial read is mandatory — a bad path is a startup misconfiguration, fail loudly.
    this.#lastGood = this.#read();
    this.#logger?.info("directory.manifest.store.loaded", {
      path,
      manifestVersion: this.#lastGood.version,
    });
  }

  getCurrentManifest(): ConsortiumManifest {
    try {
      const fresh = this.#read();
      if (fresh.version !== this.#lastGood.version) {
        this.#logger?.info("directory.manifest.store.reloaded", {
          path: this.#path,
          oldVersion: this.#lastGood.version,
          newVersion: fresh.version,
        });
      }
      this.#lastGood = fresh;
      return fresh;
    } catch (err: unknown) {
      // Serve the last good manifest — never throw from this path (interface contract).
      this.#logger?.warn("directory.manifest.store.reload.failed", {
        path: this.#path,
        servedVersion: this.#lastGood.version,
        error: err instanceof Error ? err.message : String(err),
      });
      return this.#lastGood;
    }
  }

  #read(): ConsortiumManifest {
    const raw = readFileSync(this.#path, "utf8");
    const parsed = JSON.parse(raw) as ConsortiumManifest;
    // Minimal structural check: valid JSON of the wrong shape (e.g. {}, [], 42) must fail
    // loudly at construction (the doc contract), not be cached + served as a junk manifest
    // with version === undefined. Signature/validity are the polling client's job, not ours.
    if (
      typeof (parsed as { version?: unknown })?.version !== "number" ||
      !Array.isArray((parsed as { nodes?: unknown })?.nodes) ||
      !Array.isArray((parsed as { signatures?: unknown })?.signatures)
    ) {
      throw new Error(`consortium manifest at ${this.#path} is malformed (missing version/nodes/signatures)`);
    }
    return parsed;
  }
}
