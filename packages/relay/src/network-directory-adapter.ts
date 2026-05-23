/**
 * NetworkDirectoryAdapter — DirectoryAdapter backed by /cello/directory-relay/1.0.0.
 *
 * Used by the relay binary when directory and relay run as separate processes.
 * When bilateral SEAL leaves are detected, the relay calls processSeal() here,
 * which dials the directory and sends a seal_submission frame.
 *
 * FEDERATION-003: also implements registerWithDirectory() for relay startup registration.
 * The relay sends a relay_register frame containing its relayId, publicKeyHex, region,
 * timestamp, and a self-signature (SI-003). The directory verifies the signature and
 * writes to relay_registrations.
 */

import { Encoder, decode as cborDecode } from "cbor-x";
import * as lp from "it-length-prefixed";
import type { KeyProvider } from "@cello/crypto";
import { buildRelayRegistrationTbs } from "@cello/crypto";
import type { CelloNode } from "@cello/transport";
import type { DirectoryAdapter } from "./relay-node.js";
import type { SealData } from "./relay-types.js";

const CBOR_ENC = new Encoder({ useRecords: false, mapsAsObjects: false });
const DIRECTORY_RELAY_PROTOCOL_ID = "/cello/directory-relay/1.0.0";

export interface NetworkDirectoryAdapterOptions {
  directoryPeerId: string;
  directoryMultiaddrs: string[];
}

export class NetworkDirectoryAdapter implements DirectoryAdapter {
  readonly #directoryPeerId: string;
  readonly #directoryMultiaddrs: string[];
  #node: CelloNode | null = null;

  constructor(opts: NetworkDirectoryAdapterOptions) {
    this.#directoryPeerId = opts.directoryPeerId;
    this.#directoryMultiaddrs = opts.directoryMultiaddrs;
  }

  connect(node: CelloNode): void {
    this.#node = node;
  }

  /**
   * FEDERATION-003 AC-002: Register the relay's Ed25519 public key with the directory.
   *
   * Pseudocode:
   *   1. Derive the self-signature TBS: buildRelayRegistrationTbs(relayId, publicKeyHex, timestamp)
   *      (FIPS 180-4 SHA-256 over UTF-8(relayId) || UTF-8(publicKeyHex) || timestamp_BE8)
   *   2. Sign TBS with the relay's Ed25519 key (RFC 8032).
   *   3. Send relay_register frame to directory: { type, relay_id, public_key_hex, region, timestamp, signature }
   *   4. Read response:
   *      - relay_register_ok   → return { ok: true }
   *      - relay_register_error with already_registered → return { ok: true, alreadyRegistered: true }
   *      - relay_register_error with RELAY_IDENTITY_CONFLICT → return { ok: false, reason: "RELAY_IDENTITY_CONFLICT" }
   *      - other / no response → return { ok: false, reason }
   *
   * @param params.relayId - hex encoding of the relay's Ed25519 public key
   * @param params.publicKeyHex - same as relayId (relay_id = hex(pubkey) by convention)
   * @param params.region - AWS region where this relay runs
   * @param params.keyProvider - signing key for the self-signature (RFC 8032 Ed25519)
   */
  async registerWithDirectory(params: {
    relayId: string;
    publicKeyHex: string;
    region: string;
    keyProvider: KeyProvider;
  }): Promise<{ ok: true; alreadyRegistered?: boolean } | { ok: false; reason: string }> {
    if (!this.#node) return { ok: false, reason: "directory_unavailable" };

    const { relayId, publicKeyHex, region, keyProvider } = params;
    const timestamp = Date.now();

    // SI-003: sign the TBS with the relay's own private key.
    // Only the holder of the private key corresponding to publicKeyHex can produce this signature.
    const tbs = buildRelayRegistrationTbs(relayId, publicKeyHex, timestamp);
    let signature: Uint8Array;
    try {
      signature = await keyProvider.sign(tbs);
    } catch (err: unknown) {
      return { ok: false, reason: err instanceof Error ? err.message : "sign_failed" };
    }

    const frame = CBOR_ENC.encode({
      type: "relay_register",
      relay_id: relayId,
      public_key_hex: publicKeyHex,
      region,
      timestamp,
      signature,
    }) as Uint8Array;

    try {
      // Ensure we are connected to the directory before opening a stream
      for (const addr of this.#directoryMultiaddrs) {
        try { await this.#node.dial(addr); break; } catch { /* try next */ }
      }

      const stream = await this.#node.newStream(this.#directoryPeerId, DIRECTORY_RELAY_PROTOCOL_ID);
      stream.send(lp.encode.single(frame));
      await stream.close();

      for await (const chunk of lp.decode(stream)) {
        const raw = chunk instanceof Uint8Array ? chunk : (chunk as unknown as { slice(): Uint8Array }).slice();
        const resp = cborDecode(raw) as Record<string, unknown>;
        if (resp["type"] === "relay_register_ok") return { ok: true };
        if (resp["type"] === "relay_register_error") {
          const reason = (resp["reason"] as string) ?? "directory_error";
          // already_registered treated as success (idempotent restart)
          if (reason === "already_registered") return { ok: true, alreadyRegistered: true };
          return { ok: false, reason };
        }
        return { ok: false, reason: "unexpected_response" };
      }
      return { ok: false, reason: "no_response" };
    } catch (err: unknown) {
      return { ok: false, reason: err instanceof Error ? err.message : "directory_unavailable" };
    }
  }

  /**
   * FEDERATION-003 AC-004: Look up a relay's registered public key from the directory.
   *
   * Sends a relay_pubkey_request frame over /cello/directory-relay/1.0.0.
   * Returns the public_key_hex string, or undefined if the relayId is not registered.
   * Used by the new relay when verifying a predecessor relay's ACK signature.
   */
  async getRelayPublicKey(relayId: string): Promise<string | undefined> {
    if (!this.#node) return undefined;

    const frame = CBOR_ENC.encode({
      type: "relay_pubkey_request",
      relay_id: relayId,
    }) as Uint8Array;

    try {
      for (const addr of this.#directoryMultiaddrs) {
        try { await this.#node.dial(addr); break; } catch { /* try next */ }
      }

      const stream = await this.#node.newStream(this.#directoryPeerId, DIRECTORY_RELAY_PROTOCOL_ID);
      stream.send(lp.encode.single(frame));
      await stream.close();

      for await (const chunk of lp.decode(stream)) {
        const raw = chunk instanceof Uint8Array ? chunk : (chunk as unknown as { slice(): Uint8Array }).slice();
        const resp = cborDecode(raw) as Record<string, unknown>;
        if (resp["type"] === "relay_pubkey_response") {
          return resp["public_key_hex"] as string | undefined;
        }
        return undefined;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  async processSeal(sessionId: Uint8Array, sealData: SealData): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (!this.#node) return { ok: false, reason: "directory_unavailable" };

    const frame = CBOR_ENC.encode({
      type: "seal_submission",
      session_id: sessionId,
      leaves: sealData.leaves,
      merkle_root: sealData.merkle_root,
      seq_count: sealData.seq_count,
    }) as Uint8Array;

    try {
      // Ensure connected
      for (const addr of this.#directoryMultiaddrs) {
        try { await this.#node.dial(addr); break; } catch { /* try next */ }
      }

      const stream = await this.#node.newStream(this.#directoryPeerId, DIRECTORY_RELAY_PROTOCOL_ID);
      stream.send(lp.encode.single(frame));
      await stream.close();

      for await (const chunk of lp.decode(stream)) {
        const raw = chunk instanceof Uint8Array ? chunk : (chunk as unknown as { slice(): Uint8Array }).slice();
        const resp = CBOR_ENC.decode(raw) as Record<string, unknown>;
        if (resp["type"] === "seal_received") return { ok: true };
        return { ok: false, reason: (resp["reason"] as string) ?? "directory_error" };
      }
      return { ok: false, reason: "no_response" };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : "directory_unavailable" };
    }
  }
}
