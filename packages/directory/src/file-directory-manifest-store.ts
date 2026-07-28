/**
 * M7-MANIFEST-002 / DOD-AUTH-2 / M12 §1b — FileDirectoryManifestStore.
 *
 * The directory's source for the consortium manifest it serves to clients that poll
 * (`manifest_poll_request` → `manifest_poll_response`). It re-reads the manifest JSON
 * from disk on every `getCurrentManifest()` call, so an officer can deploy a newer
 * signed manifest version beside the directory and clients adopt it on their next poll
 * — the production-faithful TUF refresh seam (and the live test's rotation point).
 *
 * **Verification (M12 §1b).** The M7 premise — "the store is only a transport; every
 * polling client re-verifies" — ends when the manifest becomes the anti-entropy channel's
 * trust anchor (pinned node pubkeys + peerIds, DOD-AE-APPEND-1). With `verify` options
 * (officer root keys + threshold, pinned via env/IaC — the same anchor shape as the
 * client's bundled constants), the store enforces at construction AND on every reload:
 *  - `verifyManifest` (RFC 8032 Ed25519 threshold officer signatures + role domain);
 *  - §1c distinctness — no duplicate `nodeId`, `pubkey`, or `peerId` across entries
 *    (the handshake's anti-reflection guarantee that manifest keys are distinct);
 *  - anti-rollback on reload — a validly-signed but LOWER `version` than the active
 *    manifest is refused (TUF rule; a rollback would resurrect retired node keys).
 * A bad manifest at construction throws (startup misconfiguration, fail loudly). A bad
 * replacement on reload is refused with a cause-naming `directory.manifest.verify.failed`
 * warn and the previous VERIFIED manifest stays active.
 *
 * Without `verify` options the store keeps the M7 transport-only behavior (clients still
 * re-verify) — that mode exists for compat until every deployment carries root keys, and
 * the composition root decides which mode runs (fail-loud wiring in bin/directory.ts).
 *
 * Never throws from getCurrentManifest() (the interface contract): on a read/parse/verify
 * error it serves the last good manifest it cached. It DOES throw at construction if the
 * initial read (or verification, in verify mode) fails.
 */

import { readFileSync } from "node:fs";
import { verifyManifest, type ConsortiumManifestInput } from "@cello-protocol/crypto";
import type { DirectoryManifestStore } from "@cello-protocol/interfaces";
import type { ConsortiumManifest } from "@cello-protocol/protocol-types";

export interface FileDirectoryManifestStoreLogger {
  info(event: string, context: Record<string, unknown>): void;
  warn(event: string, context: Record<string, unknown>): void;
}

/** Officer trust anchor for verify mode — root keys (hex) + signature threshold. */
export interface ManifestVerifyOptions {
  readonly rootKeys: readonly string[];
  readonly threshold: number;
}

/** A manifest that FAILED VERIFICATION (signatures/window/distinctness) — distinct from a
 *  read/parse error so the reload path can emit the precise event (a file-permission blip must
 *  not page as a verification failure). */
class ManifestVerificationError extends Error {}

export class FileDirectoryManifestStore implements DirectoryManifestStore {
  readonly #path: string;
  readonly #logger: FileDirectoryManifestStoreLogger | undefined;
  readonly #verify: ManifestVerifyOptions | undefined;
  #lastGood: ConsortiumManifest;

  constructor(path: string, logger?: FileDirectoryManifestStoreLogger, verify?: ManifestVerifyOptions) {
    this.#path = path;
    this.#logger = logger;
    this.#verify = verify;
    // Initial read is mandatory — a bad path (or, in verify mode, a bad manifest) is a
    // startup misconfiguration, fail loudly.
    this.#lastGood = this.#readVerified();
    this.#logger?.info("directory.manifest.store.loaded", {
      path,
      manifestVersion: this.#lastGood.version,
      verified: this.#verify !== undefined,
    });
  }

  getCurrentManifest(): ConsortiumManifest {
    try {
      const fresh = this.#readVerified();
      // Anti-rollback (verify mode): a validly-signed but older version never replaces the
      // active manifest — refuse and keep serving last-good.
      if (this.#verify && fresh.version < this.#lastGood.version) {
        this.#logger?.warn("directory.manifest.verify.failed", {
          path: this.#path,
          servedVersion: this.#lastGood.version,
          reason: `rollback refused: reloaded version ${fresh.version} < active version ${this.#lastGood.version}`,
        });
        return this.#lastGood;
      }
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
      // In verify mode the failure names its cause under the §6 event taxonomy.
      const reason = err instanceof Error ? err.message : String(err);
      this.#logger?.warn(
        err instanceof ManifestVerificationError ? "directory.manifest.verify.failed" : "directory.manifest.store.reload.failed",
        { path: this.#path, servedVersion: this.#lastGood.version, reason },
      );
      return this.#lastGood;
    }
  }

  #readVerified(): ConsortiumManifest {
    const raw = readFileSync(this.#path, "utf8");
    const parsed = JSON.parse(raw) as ConsortiumManifest;
    // Minimal structural check: valid JSON of the wrong shape (e.g. {}, [], 42) must fail
    // loudly at construction (the doc contract), not be cached + served as a junk manifest
    // with version === undefined.
    if (
      typeof (parsed as { version?: unknown })?.version !== "number" ||
      !Array.isArray((parsed as { nodes?: unknown })?.nodes) ||
      !Array.isArray((parsed as { signatures?: unknown })?.signatures)
    ) {
      throw new Error(`consortium manifest at ${this.#path} is malformed (missing version/nodes/signatures)`);
    }
    if (this.#verify) {
      // Signed validity window: verifyManifest checks signatures, not freshness — but the body
      // SIGNS not_before/expires, and an expired-yet-validly-signed manifest is exactly how
      // retired node keys would be resurrected (the freshness door to the same attack the
      // anti-rollback check closes on the version door). Reject outside the window.
      const nowMs = Date.now();
      const notBefore = Date.parse(String((parsed as { not_before?: unknown }).not_before ?? ""));
      const expires = Date.parse(String((parsed as { expires?: unknown }).expires ?? ""));
      if (!Number.isFinite(notBefore) || !Number.isFinite(expires)) {
        throw new ManifestVerificationError(`consortium manifest at ${this.#path} failed verification: missing/unparseable not_before or expires`);
      }
      if (nowMs < notBefore || nowMs > expires) {
        throw new ManifestVerificationError(
          `consortium manifest at ${this.#path} failed verification: outside validity window (not_before ${String((parsed as { not_before?: unknown }).not_before)}, expires ${String((parsed as { expires?: unknown }).expires)})`,
        );
      }
      // §1c distinctness: duplicate identities across entries break the handshake's
      // anti-reflection guarantee (verification must use provably-distinct keys). nodeId and
      // pubkey are REQUIRED on every entry (absent/empty is a malformed manifest, not a skip);
      // peerId alone may be absent on a pre-M12 entry — dupes are checked among present values.
      for (const field of ["nodeId", "pubkey", "peerId"] as const) {
        const seen = new Set<string>();
        for (const node of parsed.nodes) {
          const value = (node as unknown as Record<string, unknown>)[field];
          if (typeof value !== "string" || value.length === 0) {
            if (field === "peerId") continue; // pre-M12 entry
            throw new ManifestVerificationError(`consortium manifest at ${this.#path} has a node with missing/empty ${field}`);
          }
          if (seen.has(value)) {
            throw new ManifestVerificationError(`consortium manifest at ${this.#path} has a duplicate ${field}: ${value}`);
          }
          seen.add(value);
        }
      }
      const result = verifyManifest(
        parsed as unknown as ConsortiumManifestInput,
        this.#verify.rootKeys,
        this.#verify.threshold,
      );
      if (!result.ok) {
        throw new ManifestVerificationError(
          `consortium manifest at ${this.#path} failed verification: ${result.reason}${result.detail ? ` (${result.detail})` : ""}`,
        );
      }
    }
    return parsed;
  }
}
