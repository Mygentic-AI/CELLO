/**
 * CELLO Transport — types.ts
 *
 * Defines the CelloNode interface, CreateNodeOptions, StreamHandler, and structured
 * error types for the @cello/transport package.
 *
 * ARCHITECTURE NOTE (ADR-0001):
 * The KeyProvider is stored on CelloNode for use by higher layers (MSG-001 signing)
 * but is NEVER passed into libp2p's Noise handshake or peer identity. libp2p generates
 * its own internal Ed25519 keypair. This means:
 *   - node.getPeerId() returns the TRANSPORT peer ID (libp2p-managed)
 *   - KeyProvider.getPublicKey() returns K_local (CELLO signing identity)
 *   - These are always different keys serving different trust claims.
 */

import type { KeyProvider } from "@cello/crypto";
import type { Stream } from "@libp2p/interface";

// ─── Options ────────────────────────────────────────────────────────────────

export interface CreateNodeOptions {
  /**
   * The CELLO KeyProvider holding K_local (Ed25519 signing key).
   * Stored on the node for higher-layer use (MSG-001). NOT wired into libp2p
   * transport identity — see ADR-0001.
   */
  keyProvider: KeyProvider;
  /**
   * libp2p listen multiaddrs. Use '/ip4/127.0.0.1/tcp/0' for ephemeral port.
   */
  listenAddresses: string[];
}

// ─── StreamHandler ──────────────────────────────────────────────────────────

/**
 * Handler called when a remote peer opens a stream on a registered protocol.
 * The Stream object has `source` (AsyncIterable) and `sink` (async iterable consumer).
 * Use `it-length-prefixed` and `it-pipe` for framed I/O per the it-length-prefixed
 * varint-prefix convention (unsigned varint per https://github.com/multiformats/unsigned-varint).
 */
export type CelloStreamHandler = (stream: Stream) => void | Promise<void>;

// ─── CelloNode interface ─────────────────────────────────────────────────────

export interface CelloNode {
  /**
   * Start the node: begin listening on configured addresses.
   * After start(), the node is dialable by remote peers.
   */
  start(): Promise<void>;

  /**
   * Stop the node: close all streams and connections, release all resources.
   * After stop(), listenAddresses() returns [] and all operations fail with node_stopped.
   */
  stop(): Promise<void>;

  /**
   * Returns current listen multiaddrs as strings.
   * Returns [] before start() or after stop().
   */
  listenAddresses(): string[];

  /**
   * Connect to a remote peer by multiaddr string.
   * Returns the remote peer's transport PeerId as a string.
   * Fails with node_stopped if called after stop().
   */
  dial(multiaddr: string): Promise<{ peerId: string }>;

  /**
   * Register a stream handler for a protocol ID.
   * The handler is called when a remote peer opens a stream on this protocol.
   */
  handle(protocolId: string, handler: CelloStreamHandler): Promise<void>;

  /**
   * Open a new multiplexed stream to a connected remote peer.
   * Returns the libp2p Stream object for use with it-length-prefixed framing.
   *
   * Structured errors (thrown as plain objects):
   *   { reason: 'protocol_not_supported', protocolId, message }
   *   { reason: 'connection_lost', peerId, message }
   *   { reason: 'node_stopped', message }
   */
  newStream(peerId: string, protocolId: string): Promise<Stream>;

  /**
   * Returns the node's own transport PeerId as a string.
   * This is the libp2p-managed keypair identity, NOT derived from KeyProvider.
   * See ADR-0001.
   */
  getPeerId(): string;

  /**
   * Returns the libp2p protocol strings advertised by this node.
   * Used by tests to verify Noise is present and plaintext is absent (SI-001, SI-003).
   */
  getProtocols(): string[];

  /**
   * Returns basic info about all current connections.
   * Used by SI-001 test to verify connection-level encryption is Noise.
   * encryption is undefined when libp2p has not yet completed the security handshake.
   */
  getConnections(): Array<{ peerId: string; encryption: string | undefined }>;

  /**
   * Access the stored KeyProvider for higher-layer use (MSG-001 signing).
   * The transport layer itself never calls any methods on this object.
   */
  readonly keyProvider: KeyProvider;
}

// ─── Structured error types ──────────────────────────────────────────────────

/**
 * Thrown (as a thrown plain object, not an Error instance) when a remote peer
 * does not support the requested protocol.
 */
export interface ProtocolNotSupportedError {
  reason: "protocol_not_supported";
  protocolId: string;
  message: string;
}

/**
 * Thrown when the connection to the remote peer has been lost.
 */
export interface ConnectionLostError {
  reason: "connection_lost";
  peerId: string;
  message: string;
}

/**
 * Thrown when the node has been stopped and operations are attempted.
 */
export interface NodeStoppedError {
  reason: "node_stopped";
  message: string;
}

/**
 * Thrown when the node fails to bind to a listen address.
 */
export interface ListenFailedError {
  reason: "listen_failed";
  multiaddr: string;
  message: string;
}

export type CelloTransportError =
  | ProtocolNotSupportedError
  | ConnectionLostError
  | NodeStoppedError
  | ListenFailedError;
