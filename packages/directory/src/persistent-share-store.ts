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

// Serialization helpers that preserve Uint8Array through JSON round-trips.
// JSON.stringify converts Uint8Array to {"0":1,"1":2,...} — a plain object that
// @noble/curves crypto functions cannot use. These replacer/reviver functions
// convert Uint8Array to/from {__type:"Uint8Array",hex:"..."} instead.
function replacer(_key: string, value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return { __type: "Uint8Array", hex: Buffer.from(value).toString("hex") };
  }
  return value;
}

// Detects objects that were Uint8Array before JSON serialization.
// Handles two formats:
//   New: { __type: "Uint8Array", hex: "..." }
//   Old: { "0": 1, "1": 2, ... } — numeric-string keys only (legacy format)
function isLegacyUint8ArrayObject(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((k) => /^\d+$/.test(k));
}

function legacyToUint8Array(value: Record<string, unknown>): Uint8Array {
  const len = Object.keys(value).length;
  const arr = new Uint8Array(len);
  for (let i = 0; i < len; i++) arr[i] = value[String(i)] as number;
  return arr;
}

function reviver(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const rec = value as Record<string, unknown>;
    if (rec.__type === "Uint8Array" && typeof rec.hex === "string") {
      return new Uint8Array(Buffer.from(rec.hex as string, "hex"));
    }
    if (isLegacyUint8ArrayObject(rec)) {
      return legacyToUint8Array(rec);
    }
  }
  return value;
}

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

  async loadShares(): Promise<{ loaded: number; failed: number; failedIds: Array<{ agentId: string; epochId: string }> }> {
    const rows = await this.#encrypted.getAllShareBytes();
    let loaded = 0;
    let failed = 0;
    const failedIds: Array<{ agentId: string; epochId: string }> = [];
    for (const { agentId, epochId, plaintext } of rows) {
      try {
        const json = new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
        const parsed = JSON.parse(json, reviver) as unknown;
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          throw new Error(`invalid share format: expected object, got ${Array.isArray(parsed) ? "array" : typeof parsed}`);
        }
        const record = parsed as Record<string, unknown>;
        if (!record.secret || typeof record.secret !== "object") {
          throw new Error("invalid share format: missing or non-object secret");
        }
        if (!record.pub || typeof record.pub !== "object") {
          throw new Error("invalid share format: missing or non-object pub");
        }
        const secretRec = record.secret as Record<string, unknown>;
        const pubRec = record.pub as Record<string, unknown>;
        this.#logger.info("frost.debug.loadShares.share_types", {
          agentShort: agentId.slice(0, 16), epochId,
          secretKeys: Object.keys(secretRec),
          secretSigningShareType: typeof secretRec.signingShare,
          secretSigningShareIsUint8Array: secretRec.signingShare instanceof Uint8Array,
          secretSigningShareIsBuffer: Buffer.isBuffer(secretRec.signingShare),
          secretIdentifierType: typeof secretRec.identifier,
          pubKeys: Object.keys(pubRec),
          pubCommitmentsIsArray: Array.isArray(pubRec.commitments),
          pubCommitmentsLength: Array.isArray(pubRec.commitments) ? pubRec.commitments.length : null,
          pubCommitments0IsUint8Array: Array.isArray(pubRec.commitments) ? pubRec.commitments[0] instanceof Uint8Array : null,
          pubVerifyingSharesKeys: Object.keys(pubRec.verifyingShares as Record<string, unknown> ?? {}).slice(0, 3),
        });
        this.#memory.storeShare(agentId, epochId, {
          secret: record.secret as LocalShare["secret"],
          pub: record.pub as LocalShare["pub"],
        });
        loaded++;
      } catch (err: unknown) {
        failed++;
        failedIds.push({ agentId, epochId });
        const error = err instanceof Error ? err : new Error(String(err));
        this.#logger.error("adapter.share.deserialize.failed", error, { agentId, epochId });
      }
    }
    return { loaded, failed, failedIds };
  }

  getShare(agentPubkey: string, epochId: string): LocalShare | undefined {
    const cached = this.#memory.getShare(agentPubkey, epochId);
    this.#logger.info("frost.debug.getShare", {
      agentShort: agentPubkey.slice(0, 16), epochId, found: !!cached,
      memoryStoreSize: (this.#memory as unknown as { _shares?: Map<string, unknown> })?._shares?.size ?? "unknown",
    });
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
    const json = JSON.stringify({ secret: share.secret, pub: share.pub }, replacer);
    return new TextEncoder().encode(json);
  }

  /**
   * CELLO-M8-LEVER-002 (burn): destroy this node's K_server_X material for the agent — drop the
   * in-memory cache AND zero the persisted (KMS-encrypted) share. AWAITED (unlike the fire-and-forget
   * storeShare) — a burn must reliably destroy before the node reports the share gone.
   */
  async destroyShares(agentPubkey: string): Promise<void> {
    await this.#memory.destroyShares(agentPubkey);
    await this.#encrypted.destroyShares(agentPubkey);
    this.#logger.warn("share.destroyed", { agentPubkey });
  }
}
