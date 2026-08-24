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

/**
 * TTL for parked content — the DEFAULT retention for store-and-forward mail, overridable per relay
 * via RELAY_CONTENT_TTL_DAYS (see bin/relay.ts).
 *
 * 30 days, chosen deliberately. This is real mail waiting for an offline recipient, so the floor is
 * "longer than any legitimate recipient is plausibly offline" — a laptop shut over a holiday, someone
 * away for two weeks. The asymmetry is stark: deleting too early loses a genuine message (the product's
 * core promise), while holding E2E-encrypted ciphertext the relay cannot even read (SI-001) a while
 * longer costs only disk. So err long. Beyond ~30 days store-and-forward is the wrong model — the
 * sender should re-send — which makes it a defensible "we hold your mail for a month" ceiling.
 * (Was 7 days, the bilateral-upgrade window; that coupling was incidental, not a reason for the number.)
 */
export const CONTENT_STORE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Store-wide byte cap. On overflow the oldest entry for the affected recipient is evicted. */
export const CONTENT_STORE_MAX_BYTES = 256 * 1024 * 1024;

/** Store-wide entry-count cap. On overflow the oldest entry for the affected recipient is evicted. */
export const CONTENT_STORE_MAX_ENTRIES = 10_000;

/**
 * DOD-M15-RELAYABUSE-1 — the most bytes ONE recipient's parked bucket may hold.
 *
 * 16 MiB: four maximum-size frames, which is generous for the case this store exists to serve — a
 * counterparty who was briefly offline — and small enough that filling the 256 MiB store requires
 * sixteen distinct recipients rather than one.
 *
 * ⚠️ It does not, on its own, bound the store. A deposit is unauthenticated by design, so an
 * attacker chooses the recipient key and can invent as many as they like. What bounds the store is
 * the GLOBAL cap being enforced by REFUSAL — this cap stops one bucket becoming the whole store, and
 * stops a single victim's bucket being used to evict itself repeatedly.
 */
export const CONTENT_STORE_MAX_RECIPIENT_BYTES = 16 * 1024 * 1024;

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
   *
   * ⚠️ PARTIALLY ADDRESSED by `DOD-M15-RELAYABUSE-1`, named here so this comment is not read as
   * wholly open. The store now enforces a per-RECIPIENT byte cap, and it REFUSES — throwing
   * `content_store_full`, which the park handler turns into a negative ACK — rather than writing
   * past its global cap, which it previously did. **A per-DEPOSITOR quota is still impossible:** a
   * deposit carries no depositor identity to key one on, so that half waits on deposit auth. The
   * eviction described above is also narrowed but not gone — a flood aimed at one victim still
   * evicts that victim's older blobs, up to the per-recipient cap.
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
