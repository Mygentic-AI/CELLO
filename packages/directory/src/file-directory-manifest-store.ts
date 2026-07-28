/**
 * M7-MANIFEST-002 / DOD-AUTH-2 / M12 §1b + M12-D8 — FileDirectoryManifestStore.
 *
 * The directory's source for the consortium manifest, in BOTH of its roles (see the
 * `DirectoryManifestStore` interface docs for why they must stay separate). The file is re-read
 * on every call, so an officer can deploy a newer signed manifest beside the directory and it is
 * picked up without a restart — the production-faithful TUF refresh seam (and the live test's
 * rotation point).
 *
 * **`getCurrentManifest()` — SERVE (transport, NOT verified).** Returns the manifest as deployed,
 * for relay to polling clients. Deliberately unfiltered: clients re-verify independently
 * (DOD-AUTH-2 proves a rogue directory's forged manifest is caught CLIENT-side), and a manifest
 * signed by a ROTATED officer set must still reach clients even when this node's pinned anchor
 * can no longer verify it. Falls back to the last readable manifest on a read/parse error.
 *
 * **`getVerifiedManifest()` — USE (verified).** Returns only a manifest this node may ACT on. With
 * `verify` options (officer root keys + threshold, pinned via env/IaC — the same anchor shape as
 * the client's bundled constants) it enforces, at construction AND on every call:
 *  - `verifyManifest` (RFC 8032 Ed25519 threshold officer signatures + role domain);
 *  - the signed validity window (`not_before`/`expires`) — an expired-but-validly-signed manifest
 *    is the freshness door to resurrecting retired node keys;
 *  - §1c distinctness — no duplicate `nodeId`, `pubkey`, or `peerId` across entries (the
 *    handshake's anti-reflection guarantee that manifest keys are provably distinct);
 *  - anti-rollback — a validly-signed but LOWER `version` than the active one is refused (TUF).
 * A bad manifest at construction throws (startup misconfiguration — fail loudly, exit 1). A bad
 * replacement later is refused with a cause-naming `directory.manifest.verify.failed` warn while
 * the last VERIFIED manifest stays active.
 *
 * **Boot is fatal even though SERVE is unverified (M12-D9 — deliberate, not an oversight).** The
 * rotation argument above is about a node ALREADY RUNNING when officers rotate: it keeps relaying
 * the new manifest to clients while declining to act on it. It does NOT extend to boot. Booting
 * into "serve-only, can never act" would leave `getVerifiedManifest()` with nothing to return, and
 * the DKG quorum path treats an empty node set as single-node back-compat — i.e. a SILENT
 * THRESHOLD DOWNGRADE, which is far worse than a loud crash loop. An officer rotation must update
 * `CELLO_CONSORTIUM_ROOT_KEYS` on every node anyway (it is IaC/SSM, stage-1 resolved), so a node
 * that cannot verify at boot is a half-finished rotation — exactly the thing that should be loud.
 *
 * Without `verify` options both getters behave identically (transport semantics). That mode exists
 * only for tests/back-compat: the composition root REQUIRES the anchor whenever a manifest path is
 * set, so production always runs verified (fail-loud wiring in bin/directory.ts).
 *
 * Neither getter throws after construction (the interface contract).
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
  /** Injectable clock for the validity-window check (tests pin it; production omits). */
  readonly nowMs?: () => number;
}

/** A manifest that FAILED VERIFICATION (signatures/window/distinctness) — distinct from a
 *  read/parse error so the reload path can emit the precise event (a file-permission blip must
 *  not page as a verification failure). */
class ManifestVerificationError extends Error {}

/** The manifest is intact and validly signed but PAST `expires` — an operational staleness signal,
 *  not a tampering signal. Separated so an alarm on forgery/rollback is not drowned by expiry. */
class ManifestExpiredError extends ManifestVerificationError {}

export class FileDirectoryManifestStore implements DirectoryManifestStore {
  readonly #path: string;
  readonly #logger: FileDirectoryManifestStoreLogger | undefined;
  readonly #verify: ManifestVerifyOptions | undefined;
  /** Last manifest that PARSED — the SERVE fallback (never verification-gated). */
  #lastReadable: ConsortiumManifest;
  /** Last manifest that VERIFIED — the USE fallback + the anti-rollback floor. */
  #lastVerified: ConsortiumManifest;
  /** Node-set fingerprint of #lastVerified — detects a same-version content swap (F5). */
  #lastVerifiedFingerprint: string;
  /** When #lastVerified last verified — drives the staleness age on the refusal warn (F3). */
  #lastVerifiedAtMs: number;

  constructor(path: string, logger?: FileDirectoryManifestStoreLogger, verify?: ManifestVerifyOptions) {
    this.#path = path;
    this.#logger = logger;
    this.#verify = verify;
    // Initial read is mandatory — a bad path (or, in verify mode, a bad manifest) is a
    // startup misconfiguration, fail loudly.
    this.#lastVerified = this.#readVerified();
    this.#lastVerifiedFingerprint = JSON.stringify(this.#lastVerified.nodes);
    this.#lastVerifiedAtMs = Date.now();
    this.#lastReadable = this.#lastVerified;
    this.#logger?.info("directory.manifest.store.loaded", {
      path,
      manifestVersion: this.#lastVerified.version,
      verified: this.#verify !== undefined,
    });
  }

  /** SERVE role — transport semantics, NOT verified. See the class docs. */
  getCurrentManifest(): ConsortiumManifest {
    try {
      const fresh = this.#readParsed();
      this.#lastReadable = fresh;
      return fresh;
    } catch (err: unknown) {
      // Never throw from this path (interface contract): relay the last readable manifest.
      this.#logger?.warn("directory.manifest.store.reload.failed", {
        path: this.#path,
        servedVersion: this.#lastReadable.version,
        reason: err instanceof Error ? err.message : String(err),
      });
      return this.#lastReadable;
    }
  }

  /** USE role — verified, windowed, distinct, never rolled back. See the class docs. */
  getVerifiedManifest(): ConsortiumManifest {
    try {
      const fresh = this.#readVerified();
      // Anti-rollback: a validly-signed but older version never replaces the active manifest.
      if (this.#verify && fresh.version < this.#lastVerified.version) {
        this.#logger?.warn("directory.manifest.verify.failed", {
          path: this.#path,
          servedVersion: this.#lastVerified.version,
          reason: `rollback refused: reloaded version ${fresh.version} < active version ${this.#lastVerified.version}`,
        });
        return this.#lastVerified;
      }
      // Key the reload event on CONTENT, not version: a validly-signed republish at the SAME
      // version with different peerId/pubkey entries silently swaps the AE trust anchor and the
      // DKG quorum. Officer signatures make that not-a-forgery, but it must never be invisible.
      const freshFingerprint = JSON.stringify(fresh.nodes);
      if (freshFingerprint !== this.#lastVerifiedFingerprint) {
        this.#logger?.info("directory.manifest.store.reloaded", {
          path: this.#path,
          oldVersion: this.#lastVerified.version,
          newVersion: fresh.version,
          sameVersionContentChange: fresh.version === this.#lastVerified.version,
        });
      }
      this.#lastVerified = fresh;
      this.#lastVerifiedFingerprint = freshFingerprint;
      this.#lastVerifiedAtMs = Date.now();
      return fresh;
    } catch (err: unknown) {
      // Never throw (interface contract): keep the last VERIFIED manifest active and name the
      // cause — a read/parse blip must not page as a verification failure.
      const reason = err instanceof Error ? err.message : String(err);
      const event = err instanceof ManifestExpiredError
        ? "directory.manifest.expired.serving_stale" // stale, not forged — its own alarm
        : err instanceof ManifestVerificationError
          ? "directory.manifest.verify.failed"
          : "directory.manifest.store.reload.failed"; // a read/parse blip is neither
      this.#logger?.warn(event, {
        path: this.#path,
        servedVersion: this.#lastVerified.version,
        // The node keeps ACTING on this manifest — surface how long it has been unverifiable so
        // an operator sees drift accumulating rather than a repeating undifferentiated warn.
        staleSinceMs: Date.now() - this.#lastVerifiedAtMs,
        reason,
      });
      return this.#lastVerified;
    }
  }

  /** Read + structural check only — no officer/window/distinctness verification. */
  #readParsed(): ConsortiumManifest {
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
    return parsed;
  }

  /** Read + full verification (officer threshold, validity window, §1c distinctness). */
  #readVerified(): ConsortiumManifest {
    const parsed = this.#readParsed();
    if (this.#verify) {
      // Signed validity window: verifyManifest checks signatures, not freshness — but the body
      // SIGNS not_before/expires, and an expired-yet-validly-signed manifest is exactly how
      // retired node keys would be resurrected (the freshness door to the same attack the
      // anti-rollback check closes on the version door). Reject outside the window.
      const nowMs = (this.#verify.nowMs ?? Date.now)();
      const notBefore = Date.parse(String((parsed as { not_before?: unknown }).not_before ?? ""));
      const expires = Date.parse(String((parsed as { expires?: unknown }).expires ?? ""));
      if (!Number.isFinite(notBefore) || !Number.isFinite(expires)) {
        throw new ManifestVerificationError(`consortium manifest at ${this.#path} failed verification: missing/unparseable not_before or expires`);
      }
      if (nowMs > expires) {
        // Distinct from a signature/rollback failure: nothing was tampered with, the operators
        // simply have not rotated. Same refusal, different alarm — `verify.failed` must not be
        // ambiguous between "someone forged this" and "we are running stale".
        throw new ManifestExpiredError(
          `consortium manifest at ${this.#path} EXPIRED at ${String((parsed as { expires?: unknown }).expires)} (now ${new Date(nowMs).toISOString()}) — officers must publish a fresh manifest`,
        );
      }
      if (nowMs < notBefore) {
        throw new ManifestVerificationError(
          `consortium manifest at ${this.#path} failed verification: not yet valid (not_before ${String((parsed as { not_before?: unknown }).not_before)})`,
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
