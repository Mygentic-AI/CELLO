/**
 * Anti-entropy engine — one round of directory↔directory state sync, transport-agnostic
 * (M12 DOD-AE-APPEND-1 / DOD-AE-MUTABLE-1; M12-ANTI-ENTROPY-DESIGN §3).
 *
 * `runAntiEntropyRound(local, peer)` makes the LOCAL node pull from the PEER: it reads the peer's
 * advertised per-table state, plans what to pull (`planRound`), fetches those record bodies from
 * the peer, and applies them locally (Tier-A insert-if-absent, Tier-B merge). Both sides run it
 * (with args swapped) to fully converge. The store I/O is injected via `AeStoreView`; every method
 * may return its value directly (the in-memory test store) or a Promise of it (the pg-backed
 * `PgAeStore`) — the engine awaits both.
 *
 * Convergence rests on the merges being an idempotent join-semilattice (proven in suspension-merge
 * / presence-merge): after both directions run once, a further round pulls nothing and CHANGES
 * nothing — no ping-pong. The apply methods return the number of rows that actually changed local
 * state (Tier-A: inserted; Tier-B: merged-to-a-new-version), so `RoundResult` is the termination
 * signal: a same-key/different-content fork that never converges surfaces as a round that pulls
 * records but reports 0 changes round after round — loudly wrong, never silently absorbed.
 *
 * Store obligations (owned + proven by `PgAeStore` / pg-ae-store.live.test.ts):
 *  - `applyTierA` inserts by the NATURAL key (ON CONFLICT DO NOTHING), returns rows inserted.
 *  - `applyTierB` is atomic per key (FOR UPDATE read → merge → write, insert-race retried),
 *    returns rows whose version hash actually moved.
 */

import { computeTableDigest } from "./set-reconciliation.js";
import { planRound, tierBTableDigest, type LocalRoundState, type PeerRoundState } from "./ae-round.js";

/** An append-only record body addressed by its record hash. */
export interface TierARecord {
  hash: string;
  body: unknown;
}
/** A mutable record body addressed by its natural key. */
export interface TierBRecord {
  key: string;
  body: unknown;
}

/** A value the engine awaits — sync (in-memory store) or async (pg store) both satisfy it. */
export type MaybePromise<T> = T | Promise<T>;

/**
 * The store operations the engine needs, both to ADVERTISE local state and to SERVE a peer's pull
 * and APPLY what it pulls. `PgAeStore` implements this over pg; the test implements it in memory.
 */
export interface AeStoreView {
  tierATables(): MaybePromise<readonly string[]>;
  tierBTables(): MaybePromise<readonly string[]>;
  /** Record hashes for a Tier-A table (for digest + set reconciliation). */
  tierARecordHashes(table: string): MaybePromise<readonly string[]>;
  /** key → versionHash for a Tier-B table. */
  tierBVersions(table: string): MaybePromise<ReadonlyMap<string, string>>;
  /** Fetch Tier-A record bodies for the given hashes (serving a peer's pull). */
  serveTierA(table: string, hashes: readonly string[]): MaybePromise<readonly TierARecord[]>;
  /** Fetch Tier-B record bodies for the given keys. */
  serveTierB(table: string, keys: readonly string[]): MaybePromise<readonly TierBRecord[]>;
  /** Apply pulled Tier-A records (insert-if-absent by natural key). Returns rows INSERTED. */
  applyTierA(table: string, records: readonly TierARecord[]): MaybePromise<number>;
  /** Apply pulled Tier-B records (atomic per-key merge). Returns rows whose version CHANGED. */
  applyTierB(table: string, records: readonly TierBRecord[]): MaybePromise<number>;
}

/** The outcome of a round — what actually changed locally, for observability + termination checks. */
export interface RoundResult {
  tierAApplied: number;
  tierBApplied: number;
}

async function localState(store: AeStoreView): Promise<LocalRoundState> {
  const tierA = new Map<string, readonly string[]>();
  for (const t of await store.tierATables()) tierA.set(t, await store.tierARecordHashes(t));
  const tierB = new Map<string, ReadonlyMap<string, string>>();
  for (const t of await store.tierBTables()) tierB.set(t, await store.tierBVersions(t));
  return { tierA, tierB };
}

/** The peer's advertised state (digests + full detail). In production this crosses the wire; here
 *  it is read directly from the peer's store view. */
async function peerAdvertisement(peer: AeStoreView): Promise<PeerRoundState> {
  const tierA = new Map<string, { digest: string; recordHashes: readonly string[] }>();
  for (const t of await peer.tierATables()) {
    const hashes = await peer.tierARecordHashes(t);
    tierA.set(t, { digest: computeTableDigest(hashes), recordHashes: hashes });
  }
  const tierB = new Map<string, { digest: string; versions: ReadonlyMap<string, string> }>();
  for (const t of await peer.tierBTables()) {
    const versions = await peer.tierBVersions(t);
    tierB.set(t, { digest: tierBTableDigest(versions), versions });
  }
  return { tierA, tierB };
}

/** Run one anti-entropy round: LOCAL pulls from PEER and applies. Returns what actually changed. */
export async function runAntiEntropyRound(local: AeStoreView, peer: AeStoreView): Promise<RoundResult> {
  const plan = planRound(await localState(local), await peerAdvertisement(peer));

  let tierAApplied = 0;
  for (const [table, hashes] of plan.tierA) {
    const records = await peer.serveTierA(table, hashes);
    tierAApplied += await local.applyTierA(table, records);
  }

  let tierBApplied = 0;
  for (const [table, keys] of plan.tierB) {
    const records = await peer.serveTierB(table, keys);
    tierBApplied += await local.applyTierB(table, records);
  }

  return { tierAApplied, tierBApplied };
}
