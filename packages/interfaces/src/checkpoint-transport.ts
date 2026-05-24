/**
 * ICheckpointTransport — inter-node libp2p protocol stream interface.
 *
 * Allows the coordinator to send proposals to peer nodes and receive signatures.
 * Production implementation uses libp2p streams on port 4001 over VPC Peering.
 * Local/test stub returns configurable responses without network I/O.
 *
 * Defined here (not in checkpoint-coordinator.ts) so the production implementation
 * in packages/directory can import the type without a circular dependency, and so
 * the interface is available to any future directory node implementation.
 */

/** A signature returned by a peer node for a checkpoint proposal. */
export interface CheckpointSignatureResponse {
  /** The node ID of the signing peer. */
  nodeId: string;
  /** Ed25519 signature over the checkpoint hash bytes (hex-encoded). */
  signature: string;
  /** Hex-encoded Ed25519 public key of the signing peer — for coordinator-side verification. */
  publicKeyHex: string;
}

/** A checkpoint proposal sent from coordinator to peer nodes. */
export interface CheckpointProposal {
  checkpointId: string;
  checkpointHash: string;
  mmrPeaks: string[];
  identityMerkleRoot: string;
  mmrLeafCount: number;
}

export interface ICheckpointTransport {
  /**
   * Send a checkpoint proposal to a peer node and await its signature.
   *
   * Opens a libp2p stream on protocol /cello/checkpoint/1.0.0 to the peer,
   * sends the proposal as length-prefixed JSON, and reads back the response.
   * The peer independently recomputes the hash and returns its signature only
   * if the hash matches its local chain state.
   *
   * @returns The peer's signature response, or null if the round timed out.
   */
  sendCheckpointProposal(
    peerNodeId: string,
    proposal: CheckpointProposal,
    timeoutMs: number,
  ): Promise<CheckpointSignatureResponse | null>;

  /**
   * Return the list of currently reachable peer node IDs.
   * Used to determine coordinator role and available signing nodes.
   */
  getPeerNodeIds(): Promise<string[]>;
}
