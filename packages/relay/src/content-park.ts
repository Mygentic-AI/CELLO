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
}

export class ContentParkHandler {
  readonly #node: CelloNode;
  readonly #store: ContentStore;
  readonly #logger: Logger;

  constructor(opts: ContentParkHandlerOptions) {
    this.#node = opts.node;
    this.#store = opts.store;
    this.#logger = opts.logger;
  }

  /** Register the content-park protocol handler. Call once after node.start(). */
  async start(): Promise<void> {
    await this.#node.handle(CONTENT_PARK_PROTOCOL_ID, (stream) => {
      void this.#handleStream(stream);
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

  async #handleStream(stream: Stream): Promise<void> {
    const iter = (lp.decode(stream) as AsyncIterable<unknown>)[Symbol.asyncIterator]() as AsyncIterator<unknown>;
    try {
      const first = await this.#readFrame(iter);
      if (!first) { await stream.close().catch(() => {}); return; }

      switch (first["type"]) {
        case "content_park_deposit":
          await this.#handleDeposit(stream, first);
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

  async #handleDeposit(stream: Stream, frame: Record<string, unknown>): Promise<void> {
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
