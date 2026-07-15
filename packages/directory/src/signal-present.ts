/**
 * DOD-PRESENT-1 — the directory's dumb check for trust-signal presentation.
 *
 * During session brokering, the initiator may attach a list of signal hashes it wishes to
 * present. This function checks each hash against signal_records_effective: membership (was
 * notarized) + status (active). Non-active or unknown hashes are stripped. Nothing is written.
 *
 * INV-DIR-DUMB: no content evaluation, no payload inspection, no type branching.
 * INV-STATELESS-RECIPIENT: read-only — no INSERT, no UPDATE.
 * INV-ZERO-BUMP: type-blind — the check is on hash + status, never on type.
 */
import type { Pool } from "pg";

/**
 * Check presented signal hashes against the directory's notarization records.
 * Returns the subset of hashes that are both notarized AND currently active,
 * preserving the input order.
 */
export async function checkPresentedSignals(pool: Pool, hashes: string[]): Promise<string[]> {
  if (hashes.length === 0) return [];

  // Single query: check all hashes at once against the effective view.
  // Only active signals survive. The query is type-blind (INV-ZERO-BUMP).
  const result = await pool.query<{ signal_hash: string }>(
    `SELECT signal_hash FROM signal_records_effective
     WHERE signal_hash = ANY($1) AND effective_status = 'active'`,
    [hashes],
  );

  const activeSet = new Set(result.rows.map((r) => r.signal_hash));
  return hashes.filter((h) => activeSet.has(h));
}
