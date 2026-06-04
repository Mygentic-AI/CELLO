/**
 * NetworkRelayAdapter — RelayAdapter backed by /cello/directory-relay/1.0.0 network protocol.
 *
 * Implements the RelayAdapter interface for when the relay runs as a separate process.
 * The directory calls relay methods (recordAssignment, discardSession, confirmSeal, rejectSeal)
 * which this adapter forwards over real libp2p streams on /cello/directory-relay/1.0.0.
 *
 * Wire protocol (one stream per operation, CBOR + it-length-prefixed):
 *   record_assignment  → assignment_ok | auth_invalid
 *   discard_session    → discard_ok
 *   confirm_seal       → confirm_ok
 *   reject_seal        → reject_ok
 *
 * Auth: Each outbound frame is signed by the directory's KeyProvider over
 *   canonical CBOR of the frame body (all fields except directory_signature).
 *   The relay verifies this signature against its configured directoryPubkey.
 *
 * For record_assignment: two signatures are sent:
 *   - assignment_signature: standard relay assignment TBS (CBOR [session_id, pubA, pubB, timestamp])
 *     used by relay's recordAssignment() for internal assignment verification
 *   - directory_signature: frame body auth sig (CBOR of all body fields except directory_signature)
 *     used by relay's #handleDirectoryRelayStream for directory authentication
 *
 * ─── Phase P: Pseudocode ──────────────────────────────────────────────────────
 *
 * connect(node):
 *   this.#node = node
 *   await node.dial(relayMultiaddrs[0])  // pre-connect at startup
 *
 * recordAssignment(assignment):
 *   tsEncoded = encode timestamp as bigint if > 0xffffffff
 *   // assignment_signature: CBOR([session_id, pubA, pubB, timestamp])
 *   assignmentTbs = cborEncode([session_id, pubA, pubB, tsEncoded])
 *   assignment_signature = await keyProvider.sign(assignmentTbs)
 *   // frame body for auth sig
 *   body = { type: "record_assignment", session_id, participant_a, participant_b, session_timestamp: tsEncoded, assignment_signature }
 *   directory_signature = await keyProvider.sign(cborEncode(body))
 *   frame = cborEncode({ ...body, directory_signature })
 *   response = await sendAndReceive(frame)
 *   if response.type === "assignment_ok": return { ok: true }
 *   return { ok: false, reason: response.type }
 *
 * discardSession(sessionId):
 *   body = { type: "discard_session", session_id: sessionId }
 *   directory_signature = await keyProvider.sign(cborEncode(body))
 *   frame = cborEncode({ ...body, directory_signature })
 *   await sendAndReceive(frame)  // fire-and-forget (discard cannot fail)
 *
 * confirmSeal(sessionId):
 *   body = { type: "confirm_seal", session_id: sessionId }
 *   directory_signature = await keyProvider.sign(cborEncode(body))
 *   frame = cborEncode({ ...body, directory_signature })
 *   await sendAndReceive(frame)
 *
 * rejectSeal(sessionId, reason):
 *   body = { type: "reject_seal", session_id: sessionId, reason }
 *   directory_signature = await keyProvider.sign(cborEncode(body))
 *   frame = cborEncode({ ...body, directory_signature })
 *   await sendAndReceive(frame)
 *
 * sendAndReceive(frameBytes):
 *   stream = await node.newStream(relayPeerId, DIRECTORY_RELAY_PROTOCOL_ID)
 *   stream.send(lpEncode(frameBytes))
 *   await stream.close()  // signal EOF to relay (it reads one frame and responds)
 *   for await chunk of lpDecode(stream): return cborDecode(chunk)
 *   return { type: "error" }
 *
 * ─── End Phase P Pseudocode ───────────────────────────────────────────────────
 */

import { Encoder, decode as cborDecode } from "cbor-x";
import * as lp from "it-length-prefixed";
import type { KeyProvider } from "@cello-protocol/crypto";
import type { CelloNode } from "@cello-protocol/transport";
import type { RelayAdapter } from "./directory-node.js";
import type { RelaySessionAssignment, RelaySealData } from "./directory-types.js";

const DIRECTORY_RELAY_PROTOCOL_ID = "/cello/directory-relay/1.0.0";
const CBOR_ENC = new Encoder({ tagUint8Array: false });

export interface NetworkRelayAdapterOptions {
  /** Directory signing key — used to sign outbound frames */
  keyProvider: KeyProvider;
  /** Relay's peer ID */
  relayPeerId: string;
  /** Relay's listen addresses */
  relayMultiaddrs: string[];
}

/**
 * NetworkRelayAdapter: implements RelayAdapter over /cello/directory-relay/1.0.0.
 *
 * Usage:
 *   const adapter = new NetworkRelayAdapter({ keyProvider, relayPeerId, relayMultiaddrs });
 *   const dirResult = await createDirectoryNode({ ..., relay: adapter });
 *   await adapter.connect(dirResult.node);  // must be called after directory node starts
 */
export class NetworkRelayAdapter implements RelayAdapter {
  readonly #keyProvider: KeyProvider;
  readonly #relayPeerId: string;
  readonly #relayMultiaddrs: string[];
  #node: CelloNode | null = null;

  constructor(opts: NetworkRelayAdapterOptions) {
    this.#keyProvider = opts.keyProvider;
    this.#relayPeerId = opts.relayPeerId;
    this.#relayMultiaddrs = opts.relayMultiaddrs;
  }

  /**
   * Connect the adapter to the relay at startup.
   * Must be called after the directory node is started so we have a libp2p node to dial with.
   */
  async connect(node: CelloNode): Promise<void> {
    this.#node = node;
    // Pre-connect to ensure we can reach the relay
    for (const addr of this.#relayMultiaddrs) {
      try {
        await node.dial(addr);
        return;
      } catch {
        // try next address
      }
    }
    // If all addresses fail, we'll still attempt on first use
  }

  async recordAssignment(assignment: RelaySessionAssignment): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (!this.#node) return { ok: false, reason: "relay_unavailable" };

    const tsEncoded = assignment.session_timestamp > 0xffffffff
      ? BigInt(assignment.session_timestamp)
      : assignment.session_timestamp;

    // assignment_signature: standard relay assignment TBS (CBOR [session_id, pubA, pubB, timestamp])
    // This is what relay.recordAssignment() verifies internally.
    const assignmentTbs = CBOR_ENC.encode([
      assignment.session_id,
      assignment.participant_a,
      assignment.participant_b,
      tsEncoded,
    ]) as Uint8Array;
    const assignment_signature = await this.#keyProvider.sign(assignmentTbs);

    // Frame body (without directory_signature) for frame-level auth
    const body: Record<string, unknown> = {
      type: "record_assignment",
      session_id: assignment.session_id,
      participant_a: assignment.participant_a,
      participant_b: assignment.participant_b,
      session_timestamp: tsEncoded,
      assignment_signature,
    };
    const directory_signature = await this.#keyProvider.sign(CBOR_ENC.encode(body) as Uint8Array);
    const frame = CBOR_ENC.encode({ ...body, directory_signature }) as Uint8Array;

    try {
      const response = await this.#sendAndReceive(frame);
      if (response["type"] === "assignment_ok") return { ok: true };
      return { ok: false, reason: (response["type"] as string) ?? "relay_error" };
    } catch {
      return { ok: false, reason: "relay_unavailable" };
    }
  }

  async discardSession(sessionId: Uint8Array): Promise<void> {
    if (!this.#node) return;

    const body: Record<string, unknown> = { type: "discard_session", session_id: sessionId };
    const directory_signature = await this.#keyProvider.sign(CBOR_ENC.encode(body) as Uint8Array);
    const frame = CBOR_ENC.encode({ ...body, directory_signature }) as Uint8Array;

    try {
      await this.#sendAndReceive(frame);
    } catch {
      // fire-and-forget: discardSession cannot fail (best effort)
    }
  }

  // RelayAdapter.submitForSeal is not used in the network path.
  // The relay sends seal_submission to the directory (via DirectoryAdapter.processSeal).
  submitForSeal(_sessionId: Uint8Array): { ok: true; data: RelaySealData } | { ok: false; reason: string } {
    // In the network protocol, the relay pushes seal data to the directory (relay-initiated).
    // The directory never calls submitForSeal on the relay in the network path.
    // This stub is here only to satisfy the RelayAdapter interface.
    return { ok: false, reason: "not_supported_in_network_path" };
  }

  async confirmSeal(sessionId: Uint8Array): Promise<void> {
    if (!this.#node) return;

    const body: Record<string, unknown> = { type: "confirm_seal", session_id: sessionId };
    const directory_signature = await this.#keyProvider.sign(CBOR_ENC.encode(body) as Uint8Array);
    const frame = CBOR_ENC.encode({ ...body, directory_signature }) as Uint8Array;

    try {
      await this.#sendAndReceive(frame);
    } catch {
      // best effort
    }
  }

  async rejectSeal(sessionId: Uint8Array, reason: string): Promise<void> {
    if (!this.#node) return;

    const body: Record<string, unknown> = {
      type: "reject_seal",
      session_id: sessionId,
      reason,
    };
    const directory_signature = await this.#keyProvider.sign(CBOR_ENC.encode(body) as Uint8Array);
    const frame = CBOR_ENC.encode({ ...body, directory_signature }) as Uint8Array;

    try {
      await this.#sendAndReceive(frame);
    } catch {
      // best effort
    }
  }

  /**
   * Open a stream to the relay, send one frame, read one response frame, close.
   * One request/response per stream open — same pattern as /cello/frost/1.0.0.
   * If the connection dropped since startup (idle timeout), re-dial once before giving up.
   */
  async #sendAndReceive(frameBytes: Uint8Array): Promise<Record<string, unknown>> {
    const node = this.#node;
    if (!node) throw new Error("NetworkRelayAdapter: not connected");

    // Re-dial if the connection to the relay has dropped since startup (idle timeout).
    // newStream throws on a dead connection; re-dial once and retry.
    const stream = await node.newStream(this.#relayPeerId, DIRECTORY_RELAY_PROTOCOL_ID).catch(
      async () => {
        for (const addr of this.#relayMultiaddrs) {
          try { await node.dial(addr); break; } catch { /* try next */ }
        }
        return node.newStream(this.#relayPeerId, DIRECTORY_RELAY_PROTOCOL_ID);
      },
    );
    try {
      stream.send(lp.encode.single(frameBytes));
      await stream.close();

      for await (const chunk of lp.decode(stream)) {
        const bytes = chunk instanceof Uint8Array ? chunk : (chunk as unknown as { slice(): Uint8Array }).slice();
        return cborDecode(bytes) as Record<string, unknown>;
      }

      throw new Error("NetworkRelayAdapter: no response frame received");
    } finally {
      stream.close().catch(() => {});
    }
  }
}
