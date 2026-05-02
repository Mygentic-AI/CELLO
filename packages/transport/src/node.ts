/**
 * CELLO Transport — node.ts
 *
 * createNode() and CelloNodeImpl: libp2p node bootstrap for the CELLO protocol.
 *
 * PSEUDOCODE (Phase P) — preserved as reference:
 *
 * createNode({ keyProvider, listenAddresses }):
 *   1. Generate a fresh Ed25519 keypair via @libp2p/crypto/keys generateKeyPair('Ed25519').
 *      This keypair is the libp2p transport identity (Peer ID + Noise handshake key).
 *      It is completely independent of keyProvider — ADR-0001 invariant.
 *      Noise spec reference: https://noiseprotocol.org/noise.html (XX pattern)
 *      libp2p Noise spec: https://github.com/libp2p/specs/tree/master/noise
 *   2. Call createLibp2p({
 *        privateKey: freshKeypair,
 *        addresses: { listen: listenAddresses },
 *        transports: [tcp(), webSockets()],
 *        connectionEncrypters: [noise()],   // ONLY Noise — no plaintext. SI-001.
 *        streamMuxers: [yamux()],
 *        services: {
 *          identify: identify(),
 *          relay: circuitRelayServer(),      // advertises HOP protocol
 *          dcutr: dcutr(),
 *        },
 *      })
 *   3. Do NOT start the libp2p node — return it in stopped state. AC-001 says
 *      start() is called separately.
 *   4. Wrap in CelloNodeImpl which stores keyProvider (for MSG-001 use) but
 *      never calls keyProvider.getPublicKey() or keyProvider.sign(). SI-002.
 *
 * node.start():
 *   - Call libp2p.start()
 *   - node is now listening on configured addresses
 *
 * node.stop():
 *   - Call libp2p.stop()
 *   - All connections/streams are closed
 *   - listenAddresses() will return []
 *
 * node.dial(multiaddr):
 *   - If stopped: throw { reason: 'node_stopped', message }
 *   - multiaddr string → multiaddr object via @multiformats/multiaddr
 *   - libp2p.dial(multiaddr) → Connection
 *   - Return { peerId: connection.remotePeer.toString() }
 *
 * node.handle(protocolId, handler):
 *   - libp2p.handle(protocolId, ({stream}) => handler(stream))
 *
 * node.newStream(peerId, protocolId):
 *   - If stopped: throw { reason: 'node_stopped', message }
 *   - Get existing connections to peerId
 *   - If no open connections: throw { reason: 'connection_lost', peerId, message }
 *   - connection.newStream(protocolId):
 *     - On protocol negotiation failure (UnsupportedProtocolError): throw { reason: 'protocol_not_supported', protocolId, message }
 *     - On connection error: throw { reason: 'connection_lost', peerId, message }
 *   - Return stream
 *
 * node.listenAddresses():
 *   - Return libp2p.getMultiaddrs().map(ma => ma.toString())
 *   - Returns [] when stopped (libp2p returns empty array)
 *
 * Stream framing: it-length-prefixed (unsigned varint prefix per multiformats spec)
 * Use lp.encode(source) / lp.decode(source) with it-pipe for composing pipelines.
 */

import { createLibp2p } from "libp2p";
import { tcp } from "@libp2p/tcp";
import { webSockets } from "@libp2p/websockets";
import { noise } from "@chainsafe/libp2p-noise";
import { yamux } from "@chainsafe/libp2p-yamux";
import { circuitRelayServer, circuitRelayTransport } from "@libp2p/circuit-relay-v2";
import { dcutr } from "@libp2p/dcutr";
import { identify } from "@libp2p/identify";
import { generateKeyPair } from "@libp2p/crypto/keys";
import { multiaddr } from "@multiformats/multiaddr";
import { peerIdFromString } from "@libp2p/peer-id";
import type { Libp2p, Stream, Connection, StreamHandler } from "@libp2p/interface";
import type { KeyProvider } from "@cello/crypto";
import type {
  CelloNode,
  CelloStreamHandler,
  CreateNodeOptions,
} from "./types.js";

// ─── CelloNodeImpl ───────────────────────────────────────────────────────────

class CelloNodeImpl implements CelloNode {
  readonly #libp2p: Libp2p;
  readonly keyProvider: KeyProvider;

  constructor(libp2p: Libp2p, keyProvider: KeyProvider) {
    this.#libp2p = libp2p;
    this.keyProvider = keyProvider;
  }

  async start(): Promise<void> {
    await this.#libp2p.start();
  }

  async stop(): Promise<void> {
    await this.#libp2p.stop();
  }

  listenAddresses(): string[] {
    return this.#libp2p.getMultiaddrs().map((ma) => ma.toString());
  }

  async dial(multiaddrStr: string): Promise<{ peerId: string }> {
    if (this.#libp2p.status === "stopped") {
      throw { reason: "node_stopped", message: "Node is stopped" };
    }
    try {
      const ma = multiaddr(multiaddrStr);
      const conn: Connection = await this.#libp2p.dial(ma);
      return { peerId: conn.remotePeer.toString() };
    } catch (err) {
      // Re-throw structured errors as-is
      if (isStructuredError(err)) throw err;
      throw mapDialError(err);
    }
  }

  async handle(protocolId: string, handler: CelloStreamHandler): Promise<void> {
    // libp2p v3 StreamHandler receives (stream, connection); we only need stream
    const streamHandler: StreamHandler = (stream: Stream) => handler(stream);
    await this.#libp2p.handle(protocolId, streamHandler);
  }

  async newStream(peerIdStr: string, protocolId: string): Promise<Stream> {
    if (this.#libp2p.status === "stopped") {
      throw { reason: "node_stopped", message: "Node is stopped" };
    }

    // Look up existing connections to this peer
    let peerId;
    try {
      peerId = peerIdFromString(peerIdStr);
    } catch {
      throw {
        reason: "connection_lost",
        peerId: peerIdStr,
        message: `Invalid peer ID: ${peerIdStr}`,
      };
    }

    const connections = this.#libp2p.getConnections(peerId);
    const openConn = connections.find(
      (c) => c.status === "open"
    );

    if (!openConn) {
      throw {
        reason: "connection_lost",
        peerId: peerIdStr,
        message: `No open connection to peer ${peerIdStr}`,
      };
    }

    try {
      const stream = await openConn.newStream(protocolId);
      return stream;
    } catch (err) {
      if (isStructuredError(err)) throw err;
      throw mapStreamError(err, peerIdStr, protocolId);
    }
  }

  getPeerId(): string {
    return this.#libp2p.peerId.toString();
  }

  getProtocols(): string[] {
    return this.#libp2p.getProtocols();
  }

  getConnections(): Array<{ peerId: string; encryption: string }> {
    return this.#libp2p.getConnections().map((c) => ({
      peerId: c.remotePeer.toString(),
      encryption: c.encryption ?? "/noise",
    }));
  }
}

// ─── Error helpers ───────────────────────────────────────────────────────────

function isStructuredError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "reason" in err &&
    typeof (err as Record<string, unknown>).reason === "string"
  );
}

function mapDialError(err: unknown): unknown {
  const msg = err instanceof Error ? err.message : String(err);
  // Node stopped
  if (msg.includes("stopped") || msg.includes("not started")) {
    return { reason: "node_stopped", message: msg };
  }
  return { reason: "connection_lost", peerId: "unknown", message: msg };
}

function mapStreamError(
  err: unknown,
  peerId: string,
  protocolId: string
): unknown {
  // Check error name first — most reliable signal from libp2p
  if (err instanceof Error && err.name === "UnsupportedProtocolError") {
    return { reason: "protocol_not_supported", protocolId, message: err.message };
  }

  const msg = err instanceof Error ? err.message : String(err);

  // Protocol negotiation failure — match specific phrases, not generic "stream"
  if (
    msg.includes("unsupported protocol") ||
    msg.includes("not supported") ||
    msg.includes("protocol negotiation failed") ||
    msg.includes("multistream")
  ) {
    return { reason: "protocol_not_supported", protocolId, message: msg };
  }

  // Connection-level failure — explicit connection/reset/abort signals
  if (
    msg.includes("reset") ||
    msg.includes("connection closed") ||
    msg.includes("connection reset") ||
    msg.includes("aborted") ||
    msg.includes("connection lost")
  ) {
    return { reason: "connection_lost", peerId, message: msg };
  }

  // Default to connection_lost
  return { reason: "connection_lost", peerId, message: msg };
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create a new CelloNode in stopped state.
 *
 * CRITICAL (ADR-0001 / SI-002):
 * - A fresh libp2p-managed Ed25519 keypair is generated here.
 * - This keypair drives the transport Peer ID and Noise handshake.
 * - keyProvider is stored but NEVER called during createNode() or start().
 * - The node's Peer ID will differ from any PeerId derived from keyProvider.
 *
 * Transport stack:
 *   - Transports: TCP + WebSockets
 *   - Security: Noise ONLY (XX pattern, RFC: https://noiseprotocol.org/noise.html)
 *   - Muxer: Yamux
 *   - Services: identify, circuitRelayServer (advertises HOP), DCuTR
 */
export async function createNode(opts: CreateNodeOptions): Promise<CelloNode> {
  // ADR-0001: generate a fresh keypair for libp2p transport identity.
  // keyProvider is intentionally NOT touched here — see SI-002.
  const transportKey = await generateKeyPair("Ed25519");

  const libp2p = await createLibp2p({
    privateKey: transportKey,
    addresses: {
      listen: opts.listenAddresses,
    },
    transports: [
      tcp(),
      webSockets(),
      // Circuit relay transport enables dialing via relay addresses
      circuitRelayTransport(),
    ],
    connectionEncrypters: [
      // Noise ONLY — no plaintext. SI-001.
      // Noise XX pattern per https://noiseprotocol.org/noise.html
      noise(),
    ],
    streamMuxers: [yamux()],
    services: {
      identify: identify(),
      // circuitRelayServer advertises CIRCUIT_RELAY_V2_HOP_PROTOCOL_ID
      relay: circuitRelayServer(),
      dcutr: dcutr(),
    },
  });

  // Return node in STOPPED state — caller must call start()
  return new CelloNodeImpl(libp2p, opts.keyProvider);
}
