/**
 * Tier-B version-map reconciliation — the mutable-table counterpart to set-reconciliation's
 * `missingLocally` (M12 DOD-AE-MUTABLE-1; M12-ANTI-ENTROPY-DESIGN §3 step 4).
 *
 * Append-only reconciliation only ever pulls a record the local node is MISSING. Mutable tables
 * also change in place: both nodes may hold the same natural key with a different version hash
 * (produced by `encodeTierBVersion`). So the local node pulls a key when the peer has one it lacks
 * OR the peer's version hash for a shared key differs. The pulled rows are then resolved by the
 * table's merge (suspension-merge / presence-merge) — this function only decides WHAT to pull.
 *
 * One-directional per call (returns what THIS node must pull from the peer); the peer runs the
 * same function with args swapped to pull what it lacks. Pure set logic, no clocks.
 */

/**
 * The keys the local node must pull from the peer: every key the peer holds whose version hash the
 * local node either lacks or disagrees with.
 *
 * @param mine  local key → version hash
 * @param peer  peer's key → version hash
 */
export function versionKeysToPull(
  mine: ReadonlyMap<string, string>,
  peer: ReadonlyMap<string, string>,
): string[] {
  const pull: string[] = [];
  for (const [key, peerVersion] of peer) {
    const myVersion = mine.get(key);
    if (myVersion === undefined || myVersion !== peerVersion) {
      pull.push(key);
    }
  }
  return pull;
}
