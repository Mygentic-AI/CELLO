/**
 * ContentStore — relay-side store-and-forward queue for parked content (M7-MSG-001).
 *
 * Holds ENCRYPTED content blobs the relay cannot read (SI-001), keyed by the
 * recipient's stable identity pubkey. Survives session teardown and the relay
 * process restart (durable, fsync). Entries are deleted on pickup and swept on TTL.
 *
 * This is a SEPARATE store from SessionWal (per-session Structure 2 leaves):
 *   - recipient-keyed (not session-keyed) + survives session teardown + TTL
 *   - ENCRYPTED content blobs at rest (not hash leaves)
 *
 * Production implementation: FileContentStore (CELLO_ENV=dev/production), reusing
 * the FileSessionWal pattern (WAL_DIR-rooted, fsync-durable, validateConfig gate).
 * Local stub: InMemoryContentStore (CELLO_ENV=local/test).
 *
 * The relay never holds a decryption key — only the recipient can open a blob.
 */

/** TTL for parked content (proposed 7 days). Equal to the bilateral-upgrade window. */
export const CONTENT_STORE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Store-wide byte cap. On overflow the oldest entry for the affected recipient is evicted. */
export const CONTENT_STORE_MAX_BYTES = 256 * 1024 * 1024;

/** Store-wide entry-count cap. On overflow the oldest entry for the affected recipient is evicted. */
export const CONTENT_STORE_MAX_ENTRIES = 10_000;

/** A single parked content entry. Every datum has its own named slot (API parsimony). */
export interface ContentStoreEntry {
  /** Recipient's stable identity pubkey — the store key. */
  recipientPubkey: Uint8Array;
  /** SHA-256 hash of the PLAINTEXT content (the relay already sees the hash layer). */
  contentHash: Uint8Array;
  /** Session this content belongs to. */
  sessionId: Uint8Array;
  /** E2E-encrypted (sealed) content blob — the relay cannot decrypt this. */
  ciphertext: Uint8Array;
  /** Unix ms timestamp when the entry was deposited. */
  depositedAt: number;
}

/**
 * ContentStore interface.
 *
 * Operations (enumerated during Architecture):
 *  - deposit: durably store ciphertext, evicting oldest-for-recipient at a cap.
 *  - hasContent: does this recipient have any non-expired parked content? (notify gate)
 *  - pull: all non-expired entries for a recipient (does NOT delete — delete-on-pickup
 *    is an explicit confirm step so a failed cross-check can retry).
 *  - pullOne: a specific entry by content hash (recovery for one missing leaf).
 *  - confirmPickup: delete-on-pickup after the recipient's successful cross-check.
 *  - sweepExpired: TTL sweep; returns the number of entries deleted.
 */
export interface ContentStore {
  /**
   * Deposit an encrypted content entry. Durable (fsync) before resolving.
   * If a store byte/count cap is exceeded, the oldest entry for the SAME recipient
   * is evicted first (logging content.store.full) so live delivery is never blocked.
   * First-writer-wins on (recipientPubkey, contentHash): if a NON-EXPIRED entry already
   * exists for the key, the deposit is a benign no-op (it never overwrites). Deposit is
   * open by design and both key fields are visible at the relay hash layer, so a
   * last-writer-wins replace would let any observer evict a legitimate parked blob by
   * re-depositing junk under the same key (denial-of-delivery). A legitimate re-park
   * parks the SAME content, so dropping it is harmless. An expired entry IS replaced.
   *
   * RESIDUAL RISK (code review round 2, finding #4 — accepted, follow-up tracked).
   * Deposit is unauthenticated by design ("the caps bound abuse"), and cap eviction is
   * FIFO-oldest-for-recipient. First-writer-wins blocks SAME-key eviction but NOT
   * DISTINCT-key flooding: an attacker who observes a recipient pubkey at the relay hash
   * layer can deposit many junk-ciphertext entries under distinct content_hash keys for
   * that victim, evicting the victim's legitimate OLDER parked blobs before pickup
   * (denial-of-delivery against the Redundancy invariant). The seal stays honest (the
   * hash already reached the relay over the reliable channel; an evicted blob is a
   * best-effort content-layer loss, recoverable by sender_resend while the sender is
   * reachable), so this is a liveness/availability gap, not an integrity one. Mitigation
   * (deposit auth tying a deposit to a session participant, or per-depositor quotas) is
   * deferred to a follow-up — see m7/COORDINATION.md (CELLO-M7-MSG-001 review round 2).
   */
  deposit(entry: ContentStoreEntry): Promise<void>;

  /** True if the recipient has at least one non-expired parked entry. */
  hasContent(recipientPubkeyHex: string): Promise<boolean>;

  /**
   * Content-hash hexes of all non-expired parked entries for a recipient (notify
   * fan-out). Used by the relay to emit one content.park.notified per parked
   * content_hash so the notify frame carries the required content_hash field
   * (M7-MSG-001 observability: content.park.notified = [recipientPubkey, contentHash]).
   * Expired entries are never returned (and are deleted on access).
   */
  listContentHashesFor(recipientPubkeyHex: string): Promise<string[]>;

  /**
   * Return all non-expired parked entries for a recipient (does NOT delete).
   * Expired entries are never returned (and are deleted on access).
   */
  pull(recipientPubkeyHex: string): Promise<ContentStoreEntry[]>;

  /**
   * Return a single non-expired parked entry for (recipient, contentHash), or null.
   * Expired entries are never returned.
   */
  pullOne(recipientPubkeyHex: string, contentHashHex: string): Promise<ContentStoreEntry | null>;

  /**
   * Delete-on-pickup: remove the entry after the recipient confirms a successful
   * cross-check. Idempotent — no error if the entry is already gone or expired.
   */
  confirmPickup(recipientPubkeyHex: string, contentHashHex: string): Promise<void>;

  /** Sweep TTL-expired entries. Returns the number deleted. */
  sweepExpired(now?: number): Promise<number>;
}
