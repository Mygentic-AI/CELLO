/**
 * NetworkDirectoryAdapter — DirectoryAdapter backed by /cello/directory-relay/1.0.0.
 *
 * Used by the relay binary when directory and relay run as separate processes.
 * When bilateral SEAL leaves are detected, the relay calls processSeal() here,
 * which dials the directory and sends a seal_submission frame.
 */

import { Encoder } from "cbor-x";
import * as lp from "it-length-prefixed";
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
