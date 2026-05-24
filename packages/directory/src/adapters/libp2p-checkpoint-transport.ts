/**
 * FEDERATION-E2E-001 — Libp2pCheckpointTransport
 *
 * Production implementation of ICheckpointTransport using libp2p streams.
 * Protocol: /cello/checkpoint/1.0.0
 * Wire format: length-prefixed JSON (same as /cello/directory-relay/1.0.0)
 * Transport: TCP over VPC Peering on port 4001 (CONTEXT.md port assignments)
 *
 * Coordinator side: dials the peer by its libp2p Peer ID, sends the proposal,
 * reads back the response. The peer independently verifies and signs or rejects.
 *
 * The handler side (registerHandler) is registered on the directory node when
 * this transport is wired into the composition root. It reads the proposal,
 * independently recomputes the checkpoint hash using its local chain state,
 * and signs only if the hash matches.
 *
 * Observability events (domain.noun.verb taxonomy):
 *   federation.checkpoint.transport.proposal.sent   INFO  { peerNodeId, checkpointId }
 *   federation.checkpoint.transport.proposal.timeout WARN  { peerNodeId, checkpointId, timeoutMs }
 *   federation.checkpoint.transport.peer.unreachable WARN  { peerNodeId, checkpointId, reason }
 */

import * as lp from "it-length-prefixed";
import type { ICheckpointTransport, CheckpointProposal, CheckpointSignatureResponse } from "@cello/interfaces";
import type { Logger } from "@cello/interfaces";
import type { CelloNode } from "@cello/transport";

export interface Libp2pCheckpointTransportOptions {
  /** The local libp2p node — used to open streams to peer nodes. */
  node: CelloNode;
  /**
   * Map from logical nodeId (e.g. "eu-central-1") to the peer's libp2p Peer ID string.
   * Populated at startup from CHECKPOINT_PEER_ADDRS env var.
   */
  peers: Map<string, string>;
  logger: Logger;
}

const CHECKPOINT_PROTOCOL = "/cello/checkpoint/1.0.0";

export class Libp2pCheckpointTransport implements ICheckpointTransport {
  readonly #node: CelloNode;
  readonly #peers: Map<string, string>;
  readonly #logger: Logger;

  constructor(opts: Libp2pCheckpointTransportOptions) {
    this.#node = opts.node;
    this.#peers = opts.peers;
    this.#logger = opts.logger;
  }

  async getPeerNodeIds(): Promise<string[]> {
    return [...this.#peers.keys()];
  }

  async sendCheckpointProposal(
    peerNodeId: string,
    proposal: CheckpointProposal,
    timeoutMs: number,
  ): Promise<CheckpointSignatureResponse | null> {
    const libp2pPeerId = this.#peers.get(peerNodeId);
    if (!libp2pPeerId) {
      return null;
    }

    this.#logger.info("federation.checkpoint.transport.proposal.sent", {
      peerNodeId,
      checkpointId: proposal.checkpointId,
    });

    const proposalBytes = Buffer.from(JSON.stringify(proposal), "utf8");

    const raceResult = await Promise.race([
      this.#dial(libp2pPeerId, proposalBytes, peerNodeId, proposal.checkpointId),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);

    if (raceResult === null) {
      this.#logger.warn("federation.checkpoint.transport.proposal.timeout", {
        peerNodeId,
        checkpointId: proposal.checkpointId,
        timeoutMs,
      });
    }

    return raceResult;
  }

  async #dial(
    libp2pPeerId: string,
    proposalBytes: Buffer,
    peerNodeId: string,
    checkpointId: string,
  ): Promise<CheckpointSignatureResponse | null> {
    let stream;
    try {
      stream = await this.#node.newStream(libp2pPeerId, CHECKPOINT_PROTOCOL);
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      this.#logger.warn("federation.checkpoint.transport.peer.unreachable", {
        peerNodeId,
        checkpointId,
        reason,
      });
      return null;
    }

    try {
      stream.send(lp.encode.single(proposalBytes));
      await stream.close();

      const chunks: Uint8Array[] = [];
      for await (const chunk of lp.decode(stream)) {
        chunks.push(chunk as unknown as Uint8Array);
      }

      if (chunks.length === 0) {
        return null;
      }

      const response = JSON.parse(
        Buffer.concat(chunks).toString("utf8"),
      ) as CheckpointSignatureResponse;
      return response;
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      this.#logger.warn("federation.checkpoint.transport.peer.unreachable", {
        peerNodeId,
        checkpointId,
        reason,
      });
      stream.close().catch(() => {});
      return null;
    }
  }
}
