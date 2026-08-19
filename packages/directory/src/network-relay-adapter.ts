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
import { isConnectionLost, evictForRepair, describeThrown, socketStatuses } from "./connection-repair.js";
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
    let lastError: unknown;
    for (const addr of this.#relayMultiaddrs) {
      try {
        await node.dial(addr);
        return;
      } catch (err: unknown) {
        lastError = err;
      }
    }
    // NOT SWALLOWED. An empty catch here meant a directory that could not reach the relay at
    // startup logged nothing at all, and the first evidence was a seal failing minutes later with
    // a cause that had been discarded. Non-fatal on purpose — first use retries — but said out loud.
    this.#logger?.warn("relay.adapter.connect.failed", {
      relayPeerId: this.#relayPeerId,
      addressesTried: this.#relayMultiaddrs.length,
      reason: lastError === undefined ? "no addresses configured" : describeThrown(lastError),
      impact: "no pre-connection to the relay; the first request will dial, so this is not fatal",
    });
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
      this.#logger?.error("relay.record_assignment.transport_error", { error: describeThrown(err) });
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
      // describeThrown: CelloNode throws plain objects, so String(err) reads "[object Object]" —
      // and this is the unilateral-seal path's only diagnostic when leaves cannot be fetched.
      this.#logger?.error("relay.get_seal_leaves.transport_error", { error: describeThrown(err) });
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
      // describeThrown: CelloNode throws plain objects, so String(err) reads "[object Object]" —
      // and this is the unilateral-seal path's only diagnostic.
      this.#logger?.warn("relay.get_session_liveness.transport_error", { error: describeThrown(err) });
      return "unknown";
    }
  }

  /**
   * DOD-M12-CONN-DIR-RELAY-1: what libp2p holds for the relay, as a DISCRIMINATED answer.
   *
   * Delegates to the shared helper so "nothing registered" (informative — the dial WILL genuinely
   * reconnect), "the call threw", and "this transport has no getConnections at all" stay three
   * different answers. They used to be one empty array, on the very measurement this tier exists
   * to obtain.
   */
  #relaySocketStatuses(node: CelloNode): ReturnType<typeof socketStatuses> {
    return socketStatuses(node, this.#relayPeerId);
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
        // `describeThrown`, not `String(err)`/`JSON.stringify`. CelloNode throws STRUCTURED PLAIN
        // OBJECTS on every newStream path, so `String(err)` renders "[object Object]" — which is
        // what this file's other transport-error lines still said before this unit.
        const before = this.#relaySocketStatuses(node);
        this.#logger?.warn("relay.adapter.newstream.first_attempt_failed", {
          relayPeerId: this.#relayPeerId,
          error: describeThrown(firstErr),
          socketStatus: before,
        });

        // THE NARROWING GATES THE EVICTION, NOT THE REDIAL. Both must happen for a dead muxer;
        // only the redial must happen for everything else. `no_connection` is the case that proves
        // it: when the relay moves to a new address, `newStream` throws `no_connection`, nothing is
        // registered to evict, and the redial against the updated multiaddr IS the recovery — a
        // narrowing that skipped the redial there would break relay re-registration outright, which
        // is what the updateMultiaddr test caught. Eviction stays gated because it is peer-scoped
        // and closes the relay's own inbound connection to this directory along with ours.
        const eviction = isConnectionLost(firstErr)
          ? await evictForRepair(node, this.#relayPeerId, this.#logger, {
              unavailable: "relay.adapter.evict.unavailable",
              failed: "relay.adapter.evict.failed",
              multiple: "relay.adapter.evict.multiple",
            })
          : "not_needed";

        // THE REDIAL — restored to run for EVERY failure, which is what makes relay
        // re-registration work: `updateMultiaddr` replaces the address and the next dial is the
        // only thing that reaches the relay's new location.
        let dialSucceeded = false;
        for (const addr of this.#relayMultiaddrs) {
          try {
            await node.dial(addr);
            dialSucceeded = true;
            break;
          } catch (dialErr: unknown) {
            this.#logger?.warn("relay.adapter.redial.failed", { addr, error: describeThrown(dialErr) });
          }
        }
        if (!dialSucceeded) {
          const addrList = this.#relayMultiaddrs.length > 0 ? this.#relayMultiaddrs.join(", ") : "(no addresses configured)";
          this.#logger?.warn("relay.adapter.redial.outcome", {
            relayPeerId: this.#relayPeerId, eviction,
            socketStatusBefore: before, recovered: false,
            reason: `all addresses failed — ${addrList}`,
            reading: "no address could be dialled, so the retry below was never attempted",
          });
          throw new Error(`relay.adapter.redial: all addresses failed — ${addrList}`);
        }

        // THE OUTCOME, on both branches. Without it an operator reading a directory that stopped
        // fetching seal leaves sees the first failure and then silence — they cannot tell whether
        // the eviction ran, whether it helped, or whether our own peer-scoped hangUp is what killed
        // a concurrent verdict. That distinction is the entire subject of this tier.
        try {
          const stream = await node.newStream(this.#relayPeerId, DIRECTORY_RELAY_PROTOCOL_ID);
          this.#logger?.warn("relay.adapter.redial.outcome", {
            relayPeerId: this.#relayPeerId, eviction,
            socketStatusBefore: before, socketStatusAfter: this.#relaySocketStatuses(node),
            recovered: true,
          });
          return stream;
        } catch (retryErr: unknown) {
          this.#logger?.warn("relay.adapter.redial.outcome", {
            relayPeerId: this.#relayPeerId, eviction,
            socketStatusBefore: before, socketStatusAfter: this.#relaySocketStatuses(node),
            recovered: false,
            reason: describeThrown(retryErr),
            reading: eviction !== "evicted"
              ? "the dead connection was NOT evicted, so the dial could still return it — this is "
                + "the pre-fix behaviour and the eviction field says why"
              : "evicted and redialled and the stream STILL failed — not a stale handle on this side",
          });
          throw retryErr;
        }
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
