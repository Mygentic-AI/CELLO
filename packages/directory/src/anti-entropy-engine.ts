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
 * nothing — no ping-pong. `RoundResult` reports BOTH counts: what was pulled (planned + fetched)
 * and what actually changed local state (Tier-A: inserted; Tier-B: version-moved). True
 * termination is `pulled === 0`. A same-key/different-content fork that never converges has the
 * distinct signature `pulled > 0 && applied === 0` round after round — the transport handler must
 * treat that repeating signature as a fork alarm (`ae.round.fork_suspected`), never as health.
 *
 * Store obligations (owned + proven by `PgAeStore` / pg-ae-store.live.test.ts):
 *  - `applyTierA` inserts by the NATURAL key (ON CONFLICT DO NOTHING), returns rows inserted.
 *  - `applyTierB` is atomic per key (FOR UPDATE read → merge → write, insert-race retried),
 *    returns rows whose version hash actually moved.
 *  - No advertise/serve snapshot txn is required: Tier-A is append-only (an advertised row still
 *    exists at serve time) and Tier-B apply re-reads FOR UPDATE and merges, so a mid-round local
 *    write costs at most one extra round — never divergence. Revisit if a Tier-B table's merge
 *    ever stops being a semilattice.
 */

// Digests are computed BY THE STORE now (tierATableDigest/tierBTableDigest) — a remote store
// view returns the peer's advertised digest without fetching anything, which is what makes
// divergence detection O(compare) on the wire.
import { planRound, type LocalRoundState, type PeerRoundState } from "./ae-round.js";

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
  /**
   * The table DIGEST — the O(1)-per-table divergence check. A local store computes it from its own
   * rows; a REMOTE store view returns what the peer advertised, WITHOUT fetching the hash list.
   */
  tierATableDigest(table: string): MaybePromise<string>;
  /** Record hashes for a Tier-A table. Only called when digests differ (see PeerRoundState). */
  tierARecordHashes(table: string): MaybePromise<readonly string[]>;
  /** The Tier-B table digest — same O(1) role as tierATableDigest. */
  tierBTableDigest(table: string): MaybePromise<string>;
  /** key → versionHash for a Tier-B table. Only called when digests differ. */
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

/** The outcome of a round. Termination = pulled 0; a repeating `pulled > 0 && applied === 0` is
 *  the fork signature (see header) — the two counts must never be collapsed into one. */
export interface RoundResult {
  /** Records the plan pulled from the peer (fetched, whether or not they changed anything). */
  tierAPulled: number;
  tierBPulled: number;
  /** Records that actually changed local state (Tier-A inserted; Tier-B version-moved). */
  tierAApplied: number;
  tierBApplied: number;
  /**
   * What the plan ASKED for. Without this, `pulled` counts what arrived and a peer that serves
   * nothing returns `{0,0,0,0}` — byte-identical to convergence — while its digests demonstrably
   * differed. A caller reading only `pulled === 0` would log a healthy round forever and reset the
   * fork streak while `agent_suspensions` never replicates. `planned > served` is a SHORTFALL and
   * never happens on the normal path.
   */
  tierAPlanned: number;
  tierBPlanned: number;
  /**
   * Per-table failures. A round no longer dies whole: Tier-A is applied table by table and Tier-B
   * runs regardless, because aborting Tier-A takes `agent_suspensions` — the kill switch — down with
   * it, every round, for as long as one poisoned record is offered.
   */
  failures: Array<{ tier: "A" | "B"; table: string; reason: string }>;
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
async function peerAdvertisement(
  peer: AeStoreView,
  localTierA: readonly string[],
  localTierB: readonly string[],
  onUnknown?: (tier: "A" | "B", table: string) => void,
): Promise<PeerRoundState> {
  // Detail is LAZY (see PeerRoundState): planRound invokes the fetcher only for tables whose
  // digests differ, so a converged table costs a digest and nothing else. Over the wire that is
  // the difference between O(compare) and O(table) per round.
  // FILTER TO WHAT WE TRACK, before the planner sees it. `planRound` treats an untracked table as
  // "local digest over the empty set", which differs from any non-empty peer, so it invokes the
  // fetcher — and the fetcher asks the LOCAL store for that peer-chosen table name, which throws.
  // The engine then dies on a table it was never going to apply anyway (the apply loop iterates the
  // LOCAL registry). That is not merely a hostile-peer concern: the moment a newer directory version
  // adds a synced table, every OLD node's rounds against new nodes die — in the old←new direction,
  // the one carrying suspensions — during an ordinary rolling deploy.
  const localA = new Set(localTierA);
  const localB = new Set(localTierB);
  const tierA = new Map<string, { digest: string; recordHashes: () => Promise<readonly string[]> }>();
  for (const t of await peer.tierATables()) {
    if (!localA.has(t)) { onUnknown?.("A", t); continue; }
    tierA.set(t, {
      digest: await peer.tierATableDigest(t),
      recordHashes: async () => peer.tierARecordHashes(t),
    });
  }
  const tierB = new Map<string, { digest: string; versions: () => Promise<ReadonlyMap<string, string>> }>();
  for (const t of await peer.tierBTables()) {
    if (!localB.has(t)) { onUnknown?.("B", t); continue; }
    tierB.set(t, {
      digest: await peer.tierBTableDigest(t),
      versions: async () => peer.tierBVersions(t),
    });
  }
  return { tierA, tierB };
}

/** Run one anti-entropy round: LOCAL pulls from PEER and applies. Returns what actually changed. */
export async function runAntiEntropyRound(
  local: AeStoreView,
  peer: AeStoreView,
  onUnknownTable?: (tier: "A" | "B", table: string) => void,
): Promise<RoundResult> {
  const localTierA = await local.tierATables();
  const localTierB = await local.tierBTables();
  const plan = await planRound(
    await localState(local),
    await peerAdvertisement(peer, localTierA, localTierB, onUnknownTable),
  );
  const failures: RoundResult["failures"] = [];

  // Iterate in the LOCAL registry's table order — never the peer's advertisement order. Two
  // reasons: (1) a table the local store doesn't know is simply never pulled (a hostile peer
  // cannot steer an apply at an arbitrary table name); (2) apply order stays under OUR control,
  // which is what design §3.3's FK-dependency ordering requires once FK-bearing tables join the
  // sync set (profiles → suspensions; accounts → profiles).
  let tierAPulled = 0;
  let tierAApplied = 0;
  let tierAPlanned = 0;
  for (const table of localTierA) {
    const hashes = plan.tierA.get(table);
    if (!hashes || hashes.length === 0) continue;
    tierAPlanned += hashes.length;
    // PER-TABLE, so one table's failure costs that table and nothing else. Previously any throw here
    // — a content-hash mismatch, an invalid-hex record, a transient DB error — aborted the round
    // before Tier-B ran, so a single poisoned record stopped the kill switch replicating from that
    // peer indefinitely. Loud and contained beats loud and total.
    try {
      const records = await peer.serveTierA(table, hashes);
      tierAPulled += records.length;
      tierAApplied += await local.applyTierA(table, records);
    } catch (err) {
      failures.push({ tier: "A", table, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  let tierBPulled = 0;
  let tierBApplied = 0;
  let tierBPlanned = 0;
  for (const table of localTierB) {
    const keys = plan.tierB.get(table);
    if (!keys || keys.length === 0) continue;
    tierBPlanned += keys.length;
    try {
      const records = await peer.serveTierB(table, keys);
      tierBPulled += records.length;
      tierBApplied += await local.applyTierB(table, records);
    } catch (err) {
      failures.push({ tier: "B", table, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  return { tierAPulled, tierBPulled, tierAApplied, tierBApplied, tierAPlanned, tierBPlanned, failures };
}
