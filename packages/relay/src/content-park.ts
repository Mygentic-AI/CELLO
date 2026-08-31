/**
 * CELLO-M7-MSG-001 — relay content-park protocol handler.
 *
 * A dedicated libp2p protocol for the store-and-forward content queue. The relay
 * holds only ciphertext (SI-001) keyed by recipient pubkey.
 *
 * Protocol: /cello/content-park/1.0.0
 *
 * Request/response frames (CBOR), one logical request per stream:
 *   - content_park_deposit       (sender → relay)    → content_park_deposit_ack
 *       Deposit is OPEN by design: anyone may park ciphertext FOR a recipient
 *       (store-and-forward). The blob is E2E-encrypted to the recipient (SI-001),
 *       so an unauthenticated deposit cannot leak plaintext; the caps bound abuse.
 *   - content_park_pull_request  (recipient → relay) → challenge → auth → 0..N responses
 *   - content_park_confirm       (recipient → relay) → challenge → auth → confirm_ack
 *                                  (delete-on-pickup after a successful cross-check)
 *
 * I1 (review round 1): pull and confirm are AUTHENTICATED with a challenge-response
 * binding the caller to the recipient identity key. Without this, the recipient
 * identity key is public, so any peer could (a) pull and harvest a parked entry's
 * session_id + content_hash metadata, or (b) confirm-delete another recipient's
 * parked content before they retrieve it (targeted denial-of-delivery). The relay's
 * main protocol already authenticates identity via a nonce-signature challenge
 * (relay-node.ts AUTH_DOMAIN); this protocol mirrors that gate so pull/confirm are
 * not a bypass.
 *
 * Auth construction (mirrors the relay AUTH_DOMAIN pattern):
 *   authMsg = SHA-256( utf8(CONTENT_PARK_AUTH_DOMAIN) || nonce(32) || recipient_pubkey(32) )
 *   the caller signs authMsg with its Ed25519 identity key (RFC 8032); the relay
 *   verifies verify(recipient_pubkey, authMsg, signature).
 *
 * Notify (relay → recipient) is delivered out-of-band by the relay node when a
 * recipient with parked content (re)connects — see CelloRelayNode wiring.
 *
 * Observability (injected Logger):
 *   content.park.received   DEBUG { recipientPubkey, contentHash, bytes }
 *   content.park.served     DEBUG { recipientPubkey, count }
 *   content.park.pulled     INFO  { recipientPubkey, contentHash }
 *   content.park.failed     WARN  { recipientPubkey, reason }
 */

import { Encoder, decode } from "cbor-x";
import { DepositRateLimiter, DEFAULT_DEPOSIT_RATE_LIMIT, type DepositRateLimitConfig } from "./deposit-rate-limiter.js";
import { RELAY_PARK_REFUSALS } from "./relay-park-refusals.js";
import * as lp from "it-length-prefixed";
import { randomBytes, createHash } from "node:crypto";
import { verify } from "@cello-protocol/crypto";
import type { Stream } from "@libp2p/interface";
import type { CelloNode } from "@cello-protocol/transport";
import type { Logger, ContentStore } from "@cello-protocol/interfaces";

// M1 — single-source constraint. CONTENT_PARK_PROTOCOL_ID, CONTENT_PARK_AUTH_DOMAIN, and
// buildContentParkAuthMsg are the canonical definitions in @cello-protocol/protocol-types
// (core/protocol-types/src/content-delivery.ts in cello-client). They are mirrored here
// ONLY because the relay pins @cello-protocol/protocol-types@^0.0.3, which predates this
// story's content-delivery module — the symbols are not yet in the published package.
// When protocol-types is bumped and published (AC-023/AC-024), replace these three local
// declarations with `import { CONTENT_PARK_PROTOCOL_ID, CONTENT_PARK_AUTH_DOMAIN,
// buildContentParkAuthMsg } from "@cello-protocol/protocol-types"`. Until then they MUST
// stay byte-identical to the protocol-types definitions; the guard test in
// content-park-auth-parity.test.ts pins the construction so any drift fails CI.
export const CONTENT_PARK_PROTOCOL_ID = "/cello/content-park/1.0.0";

/** Domain separator for the content-park pull/confirm auth signature (I1). */
export const CONTENT_PARK_AUTH_DOMAIN = "CELLO-CONTENT-PARK-AUTH-v1";

const AUTH_RESPONSE_TIMEOUT_MS = 5_000;

const CBOR_ENC = new Encoder({ tagUint8Array: false });

function toU8(chunk: unknown): Uint8Array {
  if (chunk instanceof Uint8Array) return chunk;
  const c = chunk as { subarray?: () => Uint8Array; slice?: () => Uint8Array };
  if (typeof c?.subarray === "function") return c.subarray();
  if (typeof c?.slice === "function") return c.slice();
  return new Uint8Array(chunk as ArrayBufferLike);
}

function asBytes(v: unknown): Uint8Array | null {
  if (v instanceof Uint8Array) return v;
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(v)) return new Uint8Array(v as Buffer);
  return null;
}

/** Build the auth message the caller must sign to prove ownership of recipientPubkey. */
export function buildContentParkAuthMsg(nonce: Uint8Array, recipientPubkey: Uint8Array): Uint8Array {
  const domain = Buffer.from(CONTENT_PARK_AUTH_DOMAIN, "utf8");
  const authMsg = Buffer.concat([domain, Buffer.from(nonce), Buffer.from(recipientPubkey)]);
  return new Uint8Array(createHash("sha256").update(authMsg).digest());
}

export interface ContentParkHandlerOptions {
  node: CelloNode;
  store: ContentStore;
  logger: Logger;
  /**
   * DOD-M15-RELAYABUSE-1: per-depositor deposit rate limit. Defaults to
   * `DEFAULT_DEPOSIT_RATE_LIMIT` (30/minute).
   *
   * ⚠️ Injectable because the one control on the abuse path the audit named FIRST should not be the
   * one thing an operator cannot touch without a code change and a 25-30 minute node roll — every
   * other relay knob is an env var. It also lets a test drive the real handler over four deposits
   * instead of thirty-one.
   */
  rateLimit?: DepositRateLimitConfig;
  /**
   * DOD-M15-RELAYAUTH-1: is this pubkey named by at least one directory-signed assignment the
   * relay has recorded? Deposit stays open by design (see the header comment — E2E encryption is
   * the mitigation, not identity). Pull and confirm are different: I1's challenge-response already
   * proves the caller OWNS the recipient key, but "owns a keypair" and "is a real relay
   * participant" are different claims, and only the second is the credential this milestone
   * requires before the relay does anything for a caller beyond taking a deposit. Required (not
   * optional) — a `ContentParkHandler` wired without this check would silently reopen the gap.
   */
  isVouched: (pubkeyHex: string) => boolean;
}

export class ContentParkHandler {
  readonly #node: CelloNode;
  readonly #store: ContentStore;
  readonly #logger: Logger;
  /** DOD-M15-RELAYABUSE-1: per-depositor deposit rate limiting. See `deposit-rate-limiter.ts`. */
  readonly #rateLimiter: DepositRateLimiter;
  /** DOD-M15-RELAYAUTH-1: see `ContentParkHandlerOptions.isVouched`. */
  readonly #isVouched: (pubkeyHex: string) => boolean;

  constructor(opts: ContentParkHandlerOptions) {
    this.#node = opts.node;
    this.#store = opts.store;
    this.#logger = opts.logger;
    this.#rateLimiter = new DepositRateLimiter(opts.rateLimit ?? DEFAULT_DEPOSIT_RATE_LIMIT);
    this.#isVouched = opts.isVouched;
  }

  /** Register the content-park protocol handler. Call once after node.start(). */
  async start(): Promise<void> {
    /**
     * DOD-M15-RELAYABUSE-1 — **TAKE THE SECOND PARAMETER.** `CelloStreamHandler` has always passed
     * the Noise-authenticated `remotePeerId` of the peer that opened this stream, and this handler
     * registered a one-parameter callback and discarded it.
     *
     * That discard is what made me write — into code and into the DoD — that a park deposit "carries
     * no depositor identity to key a quota on". It was false, and the datum was one parameter away.
     */
    await this.#node.handle(CONTENT_PARK_PROTOCOL_ID, (stream, remotePeerId) => {
      void this.#handleStream(stream, remotePeerId);
    }, { maxInboundStreams: 1024 });
  }

  /** True if the recipient has parked content awaiting pickup (notify gate). */
  async hasContentFor(recipientPubkeyHex: string): Promise<boolean> {
    try {
      return await this.#store.hasContent(recipientPubkeyHex);
    } catch (err: unknown) {
      this.#logger.warn("content.park.failed", {
        recipientPubkey: recipientPubkeyHex,
        reason: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  /**
   * Content-hash hexes of the recipient's parked entries — one per notify frame so the
   * notify carries the required content_hash field (F6, review round 1). Returns [] on
   * store error so the notify fan-out is best-effort and never breaks the auth path.
   */
  async listContentFor(recipientPubkeyHex: string): Promise<string[]> {
    try {
      return await this.#store.listContentHashesFor(recipientPubkeyHex);
    } catch (err: unknown) {
      this.#logger.warn("content.park.failed", {
        recipientPubkey: recipientPubkeyHex,
        reason: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  async #handleStream(stream: Stream, remotePeerId?: string): Promise<void> {
    const iter = (lp.decode(stream) as AsyncIterable<unknown>)[Symbol.asyncIterator]() as AsyncIterator<unknown>;
    try {
      const first = await this.#readFrame(iter);
      if (!first) { await stream.close().catch(() => {}); return; }

      switch (first["type"]) {
        case "content_park_deposit":
          await this.#handleDeposit(stream, first, remotePeerId);
          return;
        case "content_park_pull_request":
          await this.#handlePull(stream, iter, first);
          return;
        case "content_park_confirm":
          await this.#handleConfirm(stream, iter, first);
          return;
        default:
          await stream.close().catch(() => {});
          return;
      }
    } catch (err: unknown) {
      this.#logger.warn("content.park.failed", {
        recipientPubkey: "unknown",
        reason: err instanceof Error ? err.message : String(err),
      });
      stream.abort(err instanceof Error ? err : new Error(String(err)));
    }
  }

  /** Read and CBOR-decode the next frame from the stream iterator (null on EOF/decode error). */
  async #readFrame(iter: AsyncIterator<unknown>, timeoutMs?: number): Promise<Record<string, unknown> | null> {
    let res: IteratorResult<unknown>;
    if (timeoutMs !== undefined) {
      res = await Promise.race([
        iter.next(),
        new Promise<IteratorResult<unknown>>((_, reject) =>
          setTimeout(() => reject(new Error("content_park_auth_timeout")), timeoutMs),
        ),
      ]);
    } else {
      res = await iter.next();
    }
    if (res.done || res.value === undefined) return null;
    try {
      return decode(toU8(res.value)) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  /**
   * Run the pull/confirm auth challenge. Returns true iff the caller proved ownership
   * of recipientPubkey by signing the relay-issued nonce (I1). On failure the stream
   * is closed and the caller is told nothing about the parked content.
   */
  async #authenticateCaller(
    stream: Stream,
    iter: AsyncIterator<unknown>,
    recipientPubkey: Uint8Array,
    rHex: string,
  ): Promise<boolean> {
    const nonce = new Uint8Array(randomBytes(32));
    await this.#sendFrame(stream, { type: "content_park_auth_challenge", nonce });

    const resp = await this.#readFrame(iter, AUTH_RESPONSE_TIMEOUT_MS).catch(() => null);
    if (!resp || resp["type"] !== "content_park_auth_response") {
      this.#logger.warn("content.park.failed", { recipientPubkey: rHex, reason: "auth_no_response" });
      return false;
    }
    const signature = asBytes(resp["signature"]);
    if (!signature) {
      this.#logger.warn("content.park.failed", { recipientPubkey: rHex, reason: "auth_missing_signature" });
      return false;
    }
    const authMsg = buildContentParkAuthMsg(nonce, recipientPubkey);
    if (!verify(recipientPubkey, authMsg, signature)) {
      this.#logger.warn("content.park.failed", { recipientPubkey: rHex, reason: "auth_signature_invalid" });
      return false;
    }
    return true;
  }

  async #handleDeposit(stream: Stream, frame: Record<string, unknown>, remotePeerId?: string): Promise<void> {
    /**
     * DOD-M15-RELAYABUSE-1 — rate limit before the extraction and the store write.
     *
     * ⚠️ **NOT "before any parsing", which is what an earlier version of this comment claimed and
     * review corrected.** By the time this runs, `#handleStream` has already pulled the whole
     * length-prefixed frame off the wire and CBOR-decoded it — up to 4 MiB. So a flooder still gets
     * a full read and decode per refused deposit, and the stream slot to do it in. What this saves
     * is the field extraction, the hex encode, the auth work and the disk write; it is not a
     * mitigation for frame-read CPU, and claiming otherwise would tell a reader a protection is in
     * place that is not.
     *
     * ⚠️ Keyed on the Noise-authenticated peer id, which is a real cryptographic identity for the
     * connection and is **cheap to rotate** — so this defeats the ordinary abusive case and raises
     * the cost of the determined one. A speed bump, not a gate. The hard bound is the store's.
     */
    if (remotePeerId === undefined || remotePeerId.length === 0) {
      /**
       * DOD-M15-RELAYABUSE-1 review F3 — **SAY WHEN THE LIMITER IS RUNNING BLIND.** An absent peer id
       * is allowed through deliberately (a transport detail must not become an availability
       * failure), but silence here is a control whose failure looks exactly like success: no
       * `rate_limited` events and no abuse are the same picture. This makes "running blind"
       * greppable.
       */
      this.#logger.warn("content.park.deposit.unattributed", {
        impact:
          "this deposit arrived with no authenticated peer id, so the per-depositor rate limit could " +
          "NOT be applied to it — allowed through deliberately, but the limiter is blind for this " +
          "stream and the store's bounds are the only protection acting on it",
      });
    }
    const limit = this.#rateLimiter.check(remotePeerId);
    if (!limit.allowed) {
      this.#logger.warn("content.park.rate_limited", {
        remotePeerId: remotePeerId ?? "(none)",
        attempts: limit.count,
        retryAfterMs: limit.retryAfterMs,
        impact:
          "this peer exceeded the per-peer deposit rate, so the deposit was refused before the " +
          "field extraction and the disk write — the depositor keeps its copy and may retry after " +
          "the window",
      });
      await this.#respond(stream, {
        type: "content_park_deposit_ack",
        content_hash: asBytes(frame["content_hash"]) ?? new Uint8Array(0),
        ok: false,
        reason: RELAY_PARK_REFUSALS.RATE_LIMITED,
        // DOD-M15-RELAYABUSE-1 review F2: the relay KNOWS when the window clears, and until now kept
        // it to itself — logged, asserted in a test, and never put on the wire. The client retries a
        // deferred park only on EVENTS (boot, agent start, drain hook, signaling reconnect), so the
        // one condition that self-clears in 60 seconds was waiting on an unrelated reconnect.
        retry_after_ms: limit.retryAfterMs,
      });
      return;
    }

    const recipientPubkey = asBytes(frame["recipient_pubkey"]);
    const contentHash = asBytes(frame["content_hash"]);
    const sessionId = asBytes(frame["session_id"]);
    const ciphertext = asBytes(frame["ciphertext"]);
    const rHex = recipientPubkey ? Buffer.from(recipientPubkey).toString("hex") : "unknown";

    if (!recipientPubkey || !contentHash || !ciphertext || !sessionId) {
      await this.#respond(stream, {
        type: "content_park_deposit_ack",
        content_hash: contentHash ?? new Uint8Array(0),
        ok: false,
        reason: "malformed_deposit",
      });
      return;
    }

    try {
      await this.#store.deposit({
        recipientPubkey,
        contentHash,
        sessionId,
        ciphertext,
        depositedAt: Date.now(),
      });
      this.#logger.debug("content.park.received", {
        recipientPubkey: rHex,
        contentHash: Buffer.from(contentHash).toString("hex"),
        bytes: ciphertext.length,
      });
      await this.#respond(stream, { type: "content_park_deposit_ack", content_hash: contentHash, ok: true });
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      this.#logger.warn("content.park.failed", { recipientPubkey: rHex, reason });
      await this.#respond(stream, { type: "content_park_deposit_ack", content_hash: contentHash, ok: false, reason });
    }
  }

  async #handlePull(stream: Stream, iter: AsyncIterator<unknown>, frame: Record<string, unknown>): Promise<void> {
    const recipientPubkey = asBytes(frame["recipient_pubkey"]);
    if (!recipientPubkey) { await stream.close().catch(() => {}); return; }
    const rHex = Buffer.from(recipientPubkey).toString("hex");
    const oneHash = asBytes(frame["content_hash"]);

    // I1: authenticate the caller as the recipient before exposing any metadata.
    if (!(await this.#authenticateCaller(stream, iter, recipientPubkey, rHex))) {
      await stream.close().catch(() => {});
      return;
    }

    // DOD-M15-RELAYAUTH-1: proven key OWNERSHIP is not the same claim as "is a real relay
    // participant" — see ContentParkHandlerOptions.isVouched. Named refusal, not a silent close:
    // the caller has just proven who they are, so telling them why is not an information leak to
    // an unauthorized party.
    if (!this.#isVouched(rHex)) {
      this.#logger.warn("content.park.pull.refused", {
        recipientPubkey: rHex,
        reason: "not_a_participant",
        impact: "this key has never been named by a directory-signed assignment this relay has seen",
      });
      await this.#respond(stream, { type: "content_park_pull_refused", reason: "not_a_participant" });
      return;
    }

    try {
      const entries = oneHash
        ? await (async () => {
            const e = await this.#store.pullOne(rHex, Buffer.from(oneHash).toString("hex"));
            return e ? [e] : [];
          })()
        : await this.#store.pull(rHex);

      const responses = entries.map((e) => ({
        type: "content_park_pull_response" as const,
        found: true,
        content_hash: e.contentHash,
        session_id: e.sessionId,
        ciphertext: e.ciphertext,
      }));
      if (responses.length === 0) {
        responses.push({
          type: "content_park_pull_response",
          found: false,
          content_hash: oneHash ?? new Uint8Array(0),
        } as never);
      }

      // Send a count header so the recipient knows how many entries to read.
      await this.#sendFrame(stream, { type: "content_park_pull_count", count: responses.length });
      for (const r of responses) {
        await this.#sendFrame(stream, r);
      }
      await stream.close().catch(() => {});
      this.#logger.debug("content.park.served", { recipientPubkey: rHex, count: entries.length });
    } catch (err: unknown) {
      this.#logger.warn("content.park.failed", {
        recipientPubkey: rHex,
        reason: err instanceof Error ? err.message : String(err),
      });
      await stream.close().catch(() => {});
    }
  }

  async #handleConfirm(stream: Stream, iter: AsyncIterator<unknown>, frame: Record<string, unknown>): Promise<void> {
    const recipientPubkey = asBytes(frame["recipient_pubkey"]);
    const contentHash = asBytes(frame["content_hash"]);
    if (!recipientPubkey || !contentHash) { await stream.close().catch(() => {}); return; }
    const rHex = Buffer.from(recipientPubkey).toString("hex");
    const cHex = Buffer.from(contentHash).toString("hex");

    // I1: authenticate the caller before deleting on pickup (denial-of-delivery guard).
    if (!(await this.#authenticateCaller(stream, iter, recipientPubkey, rHex))) {
      await stream.close().catch(() => {});
      return;
    }

    // DOD-M15-RELAYAUTH-1: same gate as #handlePull — see the comment there.
    if (!this.#isVouched(rHex)) {
      this.#logger.warn("content.park.confirm.refused", {
        recipientPubkey: rHex,
        contentHash: cHex,
        reason: "not_a_participant",
        impact: "this key has never been named by a directory-signed assignment this relay has seen",
      });
      await this.#respond(stream, { type: "content_park_confirm_ack", content_hash: contentHash, ok: false, reason: "not_a_participant" });
      return;
    }

    try {
      await this.#store.confirmPickup(rHex, cHex);
      this.#logger.info("content.park.pulled", { recipientPubkey: rHex, contentHash: cHex });
      await this.#respond(stream, { type: "content_park_confirm_ack", content_hash: contentHash, ok: true });
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      this.#logger.warn("content.park.failed", { recipientPubkey: rHex, reason });
      await this.#respond(stream, { type: "content_park_confirm_ack", content_hash: contentHash, ok: false, reason });
    }
  }

  async #respond(stream: Stream, frame: Record<string, unknown>): Promise<void> {
    await this.#sendFrame(stream, frame);
    await stream.close().catch(() => {});
  }

  async #sendFrame(stream: Stream, frame: Record<string, unknown>): Promise<void> {
    stream.send(lp.encode.single(CBOR_ENC.encode(frame) as Uint8Array));
  }
}
