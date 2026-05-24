import type { ICheckpointTransport, CheckpointProposal, CheckpointSignatureResponse } from "../checkpoint-transport.js";

/**
 * InMemoryCheckpointTransport — test/local stub for ICheckpointTransport.
 *
 * Used in CELLO_ENV=local and in unit tests. Callers configure peer responses
 * directly rather than making libp2p network calls.
 */
export class InMemoryCheckpointTransport implements ICheckpointTransport {
  readonly #peerNodeIds: string[];
  /** Map from peerNodeId to the response to return (or null for timeout). */
  readonly #responses: Map<string, CheckpointSignatureResponse | null>;

  constructor(
    peerNodeIds: string[] = [],
    responses: Map<string, CheckpointSignatureResponse | null> = new Map(),
  ) {
    this.#peerNodeIds = peerNodeIds;
    this.#responses = responses;
  }

  async getPeerNodeIds(): Promise<string[]> {
    return [...this.#peerNodeIds];
  }

  async sendCheckpointProposal(
    peerNodeId: string,
    _proposal: CheckpointProposal,
    _timeoutMs: number,
  ): Promise<CheckpointSignatureResponse | null> {
    if (this.#responses.has(peerNodeId)) {
      return this.#responses.get(peerNodeId) ?? null;
    }
    return null;
  }

  /** Test helper: set the response for a peer. */
  setResponse(peerNodeId: string, response: CheckpointSignatureResponse | null): void {
    this.#responses.set(peerNodeId, response);
  }

  /** Test helper: add a peer node ID. */
  addPeer(nodeId: string): void {
    if (!this.#peerNodeIds.includes(nodeId)) {
      this.#peerNodeIds.push(nodeId);
    }
  }
}
