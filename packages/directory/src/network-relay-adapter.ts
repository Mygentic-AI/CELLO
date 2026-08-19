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
import type { Logger } from "@cello-protocol/interfaces";
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
  /** Optional structured logger — injected from the directory startup context */
  logger?: Logger;
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
  #relayPeerId: string;
  #relayMultiaddrs: string[];
  readonly #logger: Logger | undefined;
  #node: CelloNode | null = null;

  constructor(opts: NetworkRelayAdapterOptions) {
    this.#keyProvider = opts.keyProvider;
    this.#relayPeerId = opts.relayPeerId;
    this.#relayMultiaddrs = opts.relayMultiaddrs;
    this.#logger = opts.logger;
  }

  /**
   * Update the relay's multiaddr (and peer ID) when the relay re-registers.
   * Called from the relay_register handler so the adapter always dials the current IP.
   * The multiaddr must include /p2p/<peerId> — the peer ID is extracted from it.
   */
  updateMultiaddr(multiaddr: string): void {
    this.#relayMultiaddrs = [multiaddr];
    // Extract peer ID from the multiaddr (/p2p/<peerId> suffix)
    const parts = multiaddr.split("/");
    const p2pIndex = parts.findIndex((p) => p === "p2p");
    if (p2pIndex !== -1 && parts[p2pIndex + 1]) {
      this.#relayPeerId = parts[p2pIndex + 1]!;
    }
    this.#logger?.info("relay.adapter.multiaddr.updated", { multiaddr });
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
      const reason = (response["type"] as string) ?? "relay_error";
      this.#logger?.error("relay.record_assignment.rejected", { reason });
      return { ok: false, reason };
    } catch (err) {
      let msg: string;
      try {
        msg = err instanceof Error ? err.message : JSON.stringify(err);
      } catch {
        msg = String(err);
      }
      this.#logger?.error("relay.record_assignment.transport_error", { error: msg });
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
   * SESSION-002: fetch a session's signed-leaf chain from the relay so the directory
   * can rebuild + verify the root for a unilateral seal. Read-only on the relay side.
   * Returns the leaf chain + relay-recomputed root, or null when unavailable (the
   * directory then rejects unilateral_leaves_unavailable).
   */
  async getSealLeaves(sessionId: Uint8Array): Promise<RelaySealData | null> {
    if (!this.#node) return null;

    const body: Record<string, unknown> = { type: "get_seal_leaves", session_id: sessionId };
    const directory_signature = await this.#keyProvider.sign(CBOR_ENC.encode(body) as Uint8Array);
    const frame = CBOR_ENC.encode({ ...body, directory_signature }) as Uint8Array;

    try {
      const response = await this.#sendAndReceive(frame);
      if (response["type"] !== "seal_leaves") {
        this.#logger?.warn("relay.get_seal_leaves.unavailable", {
          reason: (response["reason"] as string) ?? (response["type"] as string) ?? "unknown",
        });
        return null;
      }
      return {
        leaves: response["leaves"] as RelaySealData["leaves"],
        merkle_root: response["merkle_root"] as Uint8Array,
        seq_count: response["seq_count"] as number,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.#logger?.error("relay.get_seal_leaves.transport_error", { error: msg });
      return null;
    }
  }

  /**
   * SESSION-003 / DOD-LIVE-2: ask the relay whether a recipient is alive/gone/unknown. The
   * relay is the session-path liveness authority (it holds the recipient's standing stream).
   * On any transport error, return 'unknown' — the fail-safe that yields DELIVERED, never a
   * fabricated ABSENT.
   */
  async getSessionLiveness(counterpartyPubkey: Uint8Array): Promise<"alive" | "gone" | "unknown"> {
    if (!this.#node) return "unknown";

    const body: Record<string, unknown> = { type: "get_session_liveness", counterparty_pubkey: counterpartyPubkey };
    const directory_signature = await this.#keyProvider.sign(CBOR_ENC.encode(body) as Uint8Array);
    const frame = CBOR_ENC.encode({ ...body, directory_signature }) as Uint8Array;

    try {
      const response = await this.#sendAndReceive(frame);
      const liveness = response["liveness"];
      if (liveness === "alive" || liveness === "gone" || liveness === "unknown") return liveness;
      return "unknown";
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.#logger?.warn("relay.get_session_liveness.transport_error", { error: msg });
      return "unknown";
    }
  }

  /**
   * DOD-M12-CONN-DIR-RELAY-1: the SOCKET status of what we hold for the relay, which is NOT the
   * muxer's. libp2p checks the two separately when opening a stream, muxer first, so the error a
   * caller receives returns before the socket is examined — and "dead muxer on a live socket"
   * (a redial is a no-op; evict first) and "dead through" (the dial will genuinely reconnect) are
   * otherwise indistinguishable. Optional-chained on the field so an older transport reports
   * `unreported` rather than having "open" invented for it.
   */
  #relaySocketStatuses(node: CelloNode): string[] {
    try {
      return node.getConnections()
        .filter((c) => c.peerId === this.#relayPeerId)
        .map((c) => (c as { status?: string }).status ?? "unreported");
    } catch {
      return []; // never let instrumentation break a seal-leaf fetch
    }
  }

  /**
   * Open a stream to the relay, send one frame, read one response frame, close.
   * One request/response per stream open — same pattern as /cello/frost/1.0.0.
   * If the connection dropped since startup (idle timeout), evict and re-dial once before giving up.
   */
  async #sendAndReceive(frameBytes: Uint8Array): Promise<Record<string, unknown>> {
    const node = this.#node;
    if (!node) throw new Error("NetworkRelayAdapter: not connected");

    // DOD-M12-CONN-DIR-RELAY-1. Re-dial if the connection to the relay has dropped, and EVICT
    // first — the dial alone cannot repair it.
    //
    // `libp2p.dial()` does not always reach the network: `openConnection` returns an existing
    // connection whenever one is registered for the peer and its SOCKET status reads `open`
    // (`findExistingConnection` filters on `con.status` and never inspects the muxer). So when the
    // muxer dies under a live socket, the redial below resolved from the registry, handed the same
    // dead object back, and the retry failed on the identical check. Measured on the relay's end of
    // this very link: 38 refused seals, a redial on every one, not one repaired.
    //
    // This path carries `get_seal_leaves` and `get_session_liveness` — the unilateral seal. An
    // operator waiting out the 11-minute window is told that escalation "produces a real receipt".
    const stream = await node.newStream(this.#relayPeerId, DIRECTORY_RELAY_PROTOCOL_ID).catch(
      async (firstErr: unknown) => {
        let firstMsg: string;
        try {
          firstMsg = firstErr instanceof Error ? firstErr.message : JSON.stringify(firstErr);
        } catch {
          firstMsg = String(firstErr);
        }
        this.#logger?.warn("relay.adapter.newstream.first_attempt_failed", {
          relayPeerId: this.#relayPeerId,
          error: firstMsg,
          socketStatus: this.#relaySocketStatuses(node),
        });

        // Narrow local type: `hangUp` ships in @cello-protocol/transport and this repo floats on
        // `latest`, so a directory built before that version must still run. Absence is REPORTED,
        // never defaulted — otherwise this node keeps exactly the behaviour the unit removes and
        // its logs are indistinguishable from a repaired one.
        const withHangUp = node as Partial<{ hangUp(p: string): Promise<void> }>;
        if (typeof withHangUp.hangUp !== "function") {
          this.#logger?.error("relay.adapter.evict.unavailable", {
            relayPeerId: this.#relayPeerId,
            impact: "this directory's @cello-protocol/transport predates hangUp, so the redial "
              + "below can only return the dead connection it already holds — seal-leaf and "
              + "liveness requests to this relay keep failing until the node is rebuilt",
          });
        } else {
          try {
            await withHangUp.hangUp(this.#relayPeerId);
          } catch (evictErr: unknown) {
            // Does not rethrow: we are repairing something already unusable, and the dial that
            // follows may still succeed.
            this.#logger?.warn("relay.adapter.evict.failed", {
              relayPeerId: this.#relayPeerId,
              error: evictErr instanceof Error ? evictErr.message : String(evictErr),
              impact: "the dead connection may still be registered, so the redial can return it",
            });
          }
        }

        let dialSucceeded = false;
        for (const addr of this.#relayMultiaddrs) {
          try {
            await node.dial(addr);
            dialSucceeded = true;
            break;
          } catch (dialErr: unknown) {
            let dialMsg: string;
            try {
              dialMsg = dialErr instanceof Error ? dialErr.message : JSON.stringify(dialErr);
            } catch {
              dialMsg = String(dialErr);
            }
            this.#logger?.warn("relay.adapter.redial.failed", { addr, error: dialMsg });
          }
        }
        if (!dialSucceeded) {
          const addrList = this.#relayMultiaddrs.length > 0 ? this.#relayMultiaddrs.join(", ") : "(no addresses configured)";
          throw new Error(`relay.adapter.redial: all addresses failed — ${addrList}`);
        }
        return node.newStream(this.#relayPeerId, DIRECTORY_RELAY_PROTOCOL_ID);
      },
    );
    let closeSent = false;
    try {
      stream.send(lp.encode.single(frameBytes));
      await stream.close();
      closeSent = true;

      for await (const chunk of lp.decode(stream)) {
        const bytes = chunk instanceof Uint8Array ? chunk : (chunk as unknown as { slice(): Uint8Array }).slice();
        return cborDecode(bytes) as Record<string, unknown>;
      }

      throw new Error("NetworkRelayAdapter: no response frame received");
    } finally {
      if (!closeSent) stream.close().catch(() => {});
    }
  }
}
