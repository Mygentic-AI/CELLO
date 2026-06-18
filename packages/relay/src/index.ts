export { CelloRelayNode, createRelayNode, RELAY_PROTOCOL_ID, DIRECTORY_RELAY_PROTOCOL_ID } from "./relay-node.js";
export type { RelayNodeOptions, CreateRelayNodeOptions, DirectoryAdapter } from "./relay-node.js";

// M7-MSG-001: durable recipient-keyed store-and-forward content store
export { FileContentStore } from "./adapters/file-content-store.js";
export type { FileContentStoreOptions } from "./adapters/file-content-store.js";
export { CONTENT_PARK_PROTOCOL_ID } from "./content-park.js";

import { createLibp2p } from "libp2p";
import { tcp } from "@libp2p/tcp";
import { noise } from "@chainsafe/libp2p-noise";
import { yamux } from "@chainsafe/libp2p-yamux";
import { circuitRelayServer } from "@libp2p/circuit-relay-v2";
import { identify } from "@libp2p/identify";
import {
  generateKeyPair,
  privateKeyToProtobuf,
  privateKeyFromProtobuf,
} from "@libp2p/crypto/keys";
import type { PrivateKey } from "@libp2p/interface";
import { readFile, rename, mkdir, open as fsOpen } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Libp2p } from "@libp2p/interface";

export interface RelayNode {
  listenAddresses(): string[];
  stop(): Promise<void>;
}

export interface StartRelayOptions {
  /** Path to persist the relay transport keypair. Default: ~/.cello/relay-key */
  keyPath: string;
  /** libp2p listen address. Default: /ip4/0.0.0.0/tcp/4001 */
  listenAddress: string;
}

/**
 * Load or generate a persisted libp2p transport keypair.
 * Format: raw protobuf bytes from privateKeyToProtobuf, stored at 0o600.
 * A stable keypair means the relay's PeerID (embedded in the multiaddr) survives restarts.
 */
export async function loadOrGenerateRelayKey(keyPath: string): Promise<PrivateKey> {
  try {
    const raw = await readFile(keyPath);
    return privateKeyFromProtobuf(raw);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error(`relay key file error: ${(err as Error).message}`);
    }
  }

  const key = await generateKeyPair("Ed25519");
  const encoded = privateKeyToProtobuf(key);

  const dir = dirname(keyPath);
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `.relay-key-tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const fd = await fsOpen(tmp, "wx", 0o600);
  try {
    await fd.write(encoded);
  } finally {
    await fd.close();
  }
  await rename(tmp, keyPath);

  return key;
}

/**
 * Start a circuit-relay-v2-only libp2p node.
 * No CELLO client, no signing key, no message handling.
 * Purely a HOP relay for connecting agents across NATs.
 */
export async function startRelay(opts: StartRelayOptions): Promise<RelayNode> {
  const key = await loadOrGenerateRelayKey(opts.keyPath);

  const libp2p: Libp2p = await createLibp2p({
    privateKey: key,
    addresses: { listen: [opts.listenAddress] },
    transports: [tcp()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    services: {
      identify: identify(),
      relay: circuitRelayServer({ hopTimeout: 30_000 }),
    },
  });

  await libp2p.start();

  return {
    listenAddresses(): string[] {
      return libp2p.getMultiaddrs().map((ma) => ma.toString());
    },
    async stop(): Promise<void> {
      await libp2p.stop();
    },
  };
}
