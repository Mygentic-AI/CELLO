/**
 * Anti-entropy engine — one round of directory↔directory state sync, transport-agnostic
 * (M12 DOD-AE-APPEND-1 / DOD-AE-MUTABLE-1; M12-ANTI-ENTROPY-DESIGN §3).
 *
 * `runAntiEntropyRound(local, peer)` makes the LOCAL node pull from the PEER: it reads the peer's
 * advertised per-table state, plans what to pull (`planRound`), fetches those record bodies from
 * the peer, and applies them locally (Tier-A insert-if-absent, Tier-B merge). Both sides run it
 * (with args swapped) to fully converge. The store I/O is injected via `AeStoreView`, so the same
 * engine drives the real pg-backed directory and an in-memory two-node convergence test.
 *
 * Convergence rests on the merges being an idempotent join-semilattice (proven in suspension-merge
 * / presence-merge): after both directions run once, a further round pulls nothing and applies
 * nothing — no ping-pong.
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

/**
 * The store operations the engine needs, both to ADVERTISE local state and to SERVE a peer's pull
 * and APPLY what it pulls. A directory implements this over pg; the test implements it in memory.
 */
export interface AeStoreView {
  tierATables(): readonly string[];
  tierBTables(): readonly string[];
  /** Record hashes for a Tier-A table (for digest + set reconciliation). */
  tierARecordHashes(table: string): readonly string[];
  /** key → versionHash for a Tier-B table. */
  tierBVersions(table: string): ReadonlyMap<string, string>;
  /** Fetch Tier-A record bodies for the given hashes (serving a peer's pull). */
  getTierARecords(table: string, hashes: readonly string[]): readonly TierARecord[];
  /** Fetch Tier-B record bodies for the given keys. */
  getTierBRecords(table: string, keys: readonly string[]): readonly TierBRecord[];
  /** Apply pulled Tier-A records: insert-if-absent by natural key. */
  applyTierA(table: string, records: readonly TierARecord[]): void;
  /** Apply pulled Tier-B records: merge each with the local row per the table's merge rule. */
  applyTierB(table: string, records: readonly TierBRecord[]): void;
}

/** The outcome of a round — what was pulled+applied, for observability + termination checks. */
export interface RoundResult {
  tierAApplied: number;
  tierBApplied: number;
}

function localState(store: AeStoreView): LocalRoundState {
  const tierA = new Map<string, readonly string[]>();
  for (const t of store.tierATables()) tierA.set(t, store.tierARecordHashes(t));
  const tierB = new Map<string, ReadonlyMap<string, string>>();
  for (const t of store.tierBTables()) tierB.set(t, store.tierBVersions(t));
  return { tierA, tierB };
}

/** The peer's advertised state (digests + full detail). In production this crosses the wire; here
 *  it is read directly from the peer's store view. */
function peerAdvertisement(peer: AeStoreView): PeerRoundState {
  const tierA = new Map<string, { digest: string; recordHashes: readonly string[] }>();
  for (const t of peer.tierATables()) {
    const hashes = peer.tierARecordHashes(t);
    tierA.set(t, { digest: computeTableDigest(hashes), recordHashes: hashes });
  }
  const tierB = new Map<string, { digest: string; versions: ReadonlyMap<string, string> }>();
  for (const t of peer.tierBTables()) {
    const versions = peer.tierBVersions(t);
    tierB.set(t, { digest: tierBTableDigest(versions), versions });
  }
  return { tierA, tierB };
}

/** Run one anti-entropy round: LOCAL pulls from PEER and applies. Returns what was applied. */
export function runAntiEntropyRound(local: AeStoreView, peer: AeStoreView): RoundResult {
  const plan = planRound(localState(local), peerAdvertisement(peer));

  let tierAApplied = 0;
  for (const [table, hashes] of plan.tierA) {
    const records = peer.getTierARecords(table, hashes);
    local.applyTierA(table, records);
    tierAApplied += records.length;
  }

  let tierBApplied = 0;
  for (const [table, keys] of plan.tierB) {
    const records = peer.getTierBRecords(table, keys);
    local.applyTierB(table, records);
    tierBApplied += records.length;
  }

  return { tierAApplied, tierBApplied };
}
