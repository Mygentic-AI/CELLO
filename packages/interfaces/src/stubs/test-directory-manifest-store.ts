/**
 * M7-MANIFEST-002 — TestDirectoryManifestStore stub.
 *
 * Fixed-manifest implementation for directory node tests.
 * Holds a ConsortiumManifest supplied at construction time.
 *
 * M12-D8: both roles return the SAME fixed manifest — the test supplies a manifest it considers
 * trusted, so there is nothing to verify against. A test that needs the two roles to DIVERGE (a
 * forged served manifest vs a verified one) must use the real FileDirectoryManifestStore.
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

  getVerifiedManifest(): ConsortiumManifest {
    return this.#manifest;
  }
}
