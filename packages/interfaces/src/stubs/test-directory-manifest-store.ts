/**
 * M7-MANIFEST-002 — TestDirectoryManifestStore stub.
 *
 * Fixed-manifest implementation for directory node tests.
 * Holds a ConsortiumManifest supplied at construction time.
 */

import type { ConsortiumManifest } from "@cello-protocol/protocol-types";
import type { DirectoryManifestStore } from "../manifest.js";

export class TestDirectoryManifestStore implements DirectoryManifestStore {
  readonly #manifest: ConsortiumManifest;

  constructor(manifest: ConsortiumManifest) {
    this.#manifest = manifest;
  }

  getCurrentManifest(): ConsortiumManifest {
    return this.#manifest;
  }
}
