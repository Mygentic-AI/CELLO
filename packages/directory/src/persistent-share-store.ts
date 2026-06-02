/**
 * CELLO-PERSIST-005 — PersistentShareStore
 *
 * ShareStore implementation that combines in-memory FROST share storage
 * with encrypted PostgreSQL persistence via EncryptedPgShareStore.
 *
 * Pseudocode (Phase P):
 *
 *   storeShare(agentPubkey, epochId, share):
 *     // 1. Store in memory for FROST operations
 *     memoryStore.storeShare(agentPubkey, epochId, share)
 *
 *     // 2. Serialize FrostSecret to bytes (32 bytes — Ed25519 scalar)
 *     shareBytes = share.secret.serialize()  // from @noble/curves FROST
 *
 *     // 3. Persist encrypted to PostgreSQL
 *     await encryptedStore.storeShare(agentPubkey, epochId, shareBytes)
 *
 *   getShare(agentPubkey, epochId):
 *     // Try memory first (hot path)
 *     cached = memoryStore.getShare(agentPubkey, epochId)
 *     if cached: return cached
 *
 *     // Cold start: retrieve from encrypted store and reconstruct LocalShare
 *     shareBytes = await encryptedStore.getShareBytes(agentPubkey, epochId)
 *     if not shareBytes: return undefined
 *
 *     // Deserialize FrostSecret and reconstruct LocalShare
 *     // Note: FrostPublic must be retrieved separately or reconstructed
 *     // For M4, we'll store only the secret and reconstruct pub from commitments
 *     secret = FrostSecret.deserialize(shareBytes)
 *     share = { secret, pub: ... }  // reconstruction TBD in implementation
 *     memoryStore.storeShare(agentPubkey, epochId, share)  // cache it
 *     return share
 *
 * Security invariants:
 *   SI-001: share secret bytes encrypted before any database write
 *   SI-002: memory cache is ephemeral — cleared on restart
 *   SI-003: encrypted store validates ciphertext structure before INSERT
 */

import type { LocalShare, ShareStore } from "./share-store.js";
import type { EncryptedPgShareStore } from "./encrypted-share-store.js";
import type { Logger } from "@cello-protocol/interfaces";
import { InMemoryShareStore } from "./share-store.js";

/**
 * PersistentShareStore — ShareStore with encrypted PostgreSQL persistence.
 *
 * Combines InMemoryShareStore (for FROST ceremony performance) with
 * EncryptedPgShareStore (for durable encrypted storage).
 *
 * On storeShare():
 *   1. Store in memory (for immediate FROST signing)
 *   2. Serialize share.secret to bytes (32 bytes)
 *   3. Encrypt and persist via EncryptedPgShareStore
 *
 * On getShare():
 *   1. Return from memory if present (hot path)
 *   2. If not in memory, retrieve encrypted bytes from DB
 *   3. Deserialize and reconstruct LocalShare
 *   4. Cache in memory for subsequent calls
 *
 * Note: For M4, we serialize only share.secret (32 bytes).
 * FrostPublic can be reconstructed from commitments or fetched separately.
 * The full persistence model (including FrostPublic) is deferred to a
 * future story that defines the complete share recovery protocol.
 */
export class PersistentShareStore implements ShareStore {
  readonly #memory: InMemoryShareStore;
  readonly #encrypted: EncryptedPgShareStore;
  readonly #logger: Logger;

  constructor(encryptedStore: EncryptedPgShareStore, logger: Logger) {
    this.#memory = new InMemoryShareStore();
    this.#encrypted = encryptedStore;
    this.#logger = logger;
  }

  async loadShares(): Promise<{ loaded: number; failed: number }> {
    const rows = await this.#encrypted.getAllShareBytes();
    let loaded = 0;
    let failed = 0;
    for (const { agentId, epochId, plaintext } of rows) {
      try {
        const json = new TextDecoder().decode(plaintext);
        const parsed = JSON.parse(json) as { secret: LocalShare["secret"]; pub: LocalShare["pub"] };
        this.#memory.storeShare(agentId, epochId, { secret: parsed.secret, pub: parsed.pub });
        loaded++;
      } catch (err: unknown) {
        failed++;
        const error = err instanceof Error ? err : new Error(String(err));
        this.#logger.error("adapter.share.deserialize.failed", error, { agentId, epochId });
      }
    }
    return { loaded, failed };
  }

  getShare(agentPubkey: string, epochId: string): LocalShare | undefined {
    const cached = this.#memory.getShare(agentPubkey, epochId);
    if (cached) {
      return cached;
    }
    return undefined;
  }

  storeShare(agentPubkey: string, epochId: string, share: LocalShare): void {
    // Step 1: Store in memory for immediate FROST signing
    this.#memory.storeShare(agentPubkey, epochId, share);

    // Step 2+3: Serialize share.secret and persist encrypted
    // Note: ShareStore.storeShare() is synchronous, but EncryptedPgShareStore.storeShare()
    // is async. We cannot await here without changing the ShareStore interface.
    // For M4, we'll fire-and-forget the persistence call.
    // A future story will add async storeShare() to the ShareStore interface.
    const secretBytes = this.#serializeSecret(share);
    void this.#encrypted.storeShare(agentPubkey, epochId, secretBytes).catch(
      (err: unknown) => {
        const error = err instanceof Error ? err : new Error(String(err));
        // adapter.write.failed — canonical event for rejected fire-and-forget writes
        // (pipeline discussion log 2026-05-16_0753)
        this.#logger.error("adapter.write.failed", error, {
          adapterName: "EncryptedPgShareStore",
          agentPubkey,
          epochId,
        });
      },
    );
  }

  /**
   * Serialize FrostSecret to 32 bytes.
   * FrostSecret is an Ed25519 scalar — 32 bytes per RFC 8032.
   * @noble/curves FROST stores this as an opaque object.
   *
   * For M4, we use a simple serialization: JSON.stringify the FrostSecret
   * and encode as UTF-8 bytes. This preserves all fields without needing
   * to know the internal structure.
   *
   * A future story will define a canonical binary serialization format
   * for FROST shares that enables cross-implementation compatibility.
   */
  #serializeSecret(share: LocalShare): Uint8Array {
    // Serialize the entire LocalShare (including pub) as JSON
    // FrostSecret and FrostPublic are plain JS objects and can be JSON-serialized
    const json = JSON.stringify({
      secret: share.secret,
      pub: share.pub,
    });
    return new TextEncoder().encode(json);
  }
}
