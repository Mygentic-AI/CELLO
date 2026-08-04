export { CelloRelayNode, createRelayNode, RELAY_PROTOCOL_ID, DIRECTORY_RELAY_PROTOCOL_ID } from "./relay-node.js";
export type { RelayNodeOptions, CreateRelayNodeOptions, DirectoryAdapter } from "./relay-node.js";

// M7-MSG-001: durable recipient-keyed store-and-forward content store
export { FileContentStore } from "./adapters/file-content-store.js";
export type { FileContentStoreOptions } from "./adapters/file-content-store.js";
export { CONTENT_PARK_PROTOCOL_ID } from "./content-park.js";

import {
  generateKeyPair,
  generateKeyPairFromSeed,
  privateKeyToProtobuf,
  privateKeyFromProtobuf,
} from "@libp2p/crypto/keys";
import type { PrivateKey } from "@libp2p/interface";
import { readFile, rename, mkdir, open as fsOpen } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Derive the relay's libp2p PeerID (`12D3Koo…`) from a 32-byte Ed25519 transport SEED —
 * the SAME derivation the relay binary uses (`generateKeyPairFromSeed("Ed25519", seed)`,
 * relay.ts via CELLO_RELAY_TRANSPORT_KEY_HEX). This lets a test harness pre-compute the
 * relay's multiaddr (`/ip4/…/tcp/<port>/p2p/<peerId>`) BEFORE the relay process starts,
 * which breaks the relay↔directory startup cycle (local mode requires the directory to
 * have CELLO_RELAY_MULTIADDR at startup AND the relay to have CELLO_DIRECTORY_MULTIADDR).
 * Pure key derivation — no node construction.
 */
export async function peerIdFromTransportSeed(seed: Uint8Array): Promise<string> {
  const key = await generateKeyPairFromSeed("Ed25519", seed);
  return key.publicKey.toString();
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
 * DOD-RELAY-KEEPALIVE-1: `startRelay` was DELETED here (2026-08-04).
 *
 * It built a relay straight from `createLibp2p` with libp2p's DEFAULTS — maxReservations 15 and
 * applyDefaultLimit true, i.e. relayed connections capped at 2 minutes and 128 KiB. Those are the
 * two settings `createRelayNode` disables on purpose (relay-node.ts), because for a relay whose
 * whole job is carrying CELLO sessions both defaults are wrong. The production binary
 * (`bin/relay.ts`) has always used `createRelayNode`, so this factory ran nowhere — it was a
 * loaded gun for whoever reached for the obvious-sounding name next.
 *
 * Deadness proven before deletion: no importer in this repo or in cello-client, and the package
 * is private (never published), so there is no external consumer to break.
 * `relay-defaults.test.ts` keeps it gone.
 */
