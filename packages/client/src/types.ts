/**
 * @cello/client — types.ts
 *
 * Public types for the CelloClient (MSG-002).
 */

// ─── Peer registry ───────────────────────────────────────────────────────────

export interface PeerEntry {
  /** libp2p transport Peer ID string */
  peerId: string;
  /** multiaddrs for this peer */
  multiaddrs: string[];
  /** whether a live connection exists */
  connected: boolean;
}

// ─── Send result ─────────────────────────────────────────────────────────────

export type SendFailureReason =
  | "peer_not_connected"
  | "content_too_large"
  | "peer_unreachable"
  | "remote_rejected"
  | "connection_lost"
  | "transport_not_started";

export type SendResult =
  | { delivered: true; contentHash: string }
  | { delivered: false; reason: SendFailureReason };

// ─── Received envelope ───────────────────────────────────────────────────────

export interface ReceivedEnvelope {
  content: Uint8Array;
  senderPubkey: Uint8Array;
  contentHash: Uint8Array;
  timestamp: number;
}

// ─── CelloClient interface ────────────────────────────────────────────────────

export interface CelloClient {
  /**
   * Register a peer in the local registry.
   * Called by MCP-001 cello_connect_peer after dialing succeeds.
   */
  addPeer(peerPubkeyHex: string, peerId: string, multiaddrs: string[]): void;

  /**
   * Send content to the peer identified by their K_local pubkey hex.
   * Resolves with the delivery outcome — never throws.
   */
  send(peerPubkeyHex: string, content: Uint8Array): Promise<SendResult>;

  /**
   * Register the inbound stream handler on the node.
   * Must be called once after node.start().
   */
  registerHandler(): Promise<void>;

  /**
   * Dequeue the oldest received envelope from a given sender.
   * Returns null if the queue is empty.
   */
  receive(senderPubkeyHex: string): ReceivedEnvelope | null;

  /**
   * Return all queued envelopes (in arrival order) regardless of sender.
   * Non-destructive — items remain in the queue until receive() drains them.
   */
  peekAll(): Array<{ senderPubkeyHex: string; envelope: ReceivedEnvelope }>;
}
