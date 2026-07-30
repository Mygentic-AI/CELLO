/**
 * M10B / `M10B-D25r2` — the return path's storage.
 *
 * A submitter hands over a sealed submission and learns nothing further: minted, refused by the
 * subject, rejected by the scan, or unattributable all look identical from the issuing agent's side.
 * This table is how an outcome gets back, and it matters most for `op: refuse`, where the subject
 * deliberately wrote a message explaining why they will not stand behind the claim (`M10B-D4`).
 *
 * THE DIRECTORY STILL CANNOT READ THE MESSAGE. `ciphertext` is sealed to the ISSUER's k_local key,
 * the mirror of `submission_queue` being sealed to the portal's intake key. Everything stored outside
 * the seal is routing and outcome — no message, no payload, no PII.
 *
 * WRITE-ONCE. There is no UPDATE grant (V56) and the insert is `ON CONFLICT DO NOTHING`, so the first
 * writer of a `(submission_id, accepting_node)` wins. An outcome that can be rewritten is an outcome
 * the issuer cannot rely on.
 */
import type pg from "pg";

export interface SubmissionResultInput {
  submissionId: string;
  acceptingNode: string;
  /** The issuer's k_local pubkey, from the AUTHENTICATED submission — never a request field. */
  issuerPubkey: string;
  outcome: string;
  reason?: string | null;
  signalHash?: string | null;
  /** Sealed to the issuer. NULL when the outcome carries no message. */
  ciphertext?: Uint8Array | null;
}

export interface SubmissionResult {
  submissionId: string;
  acceptingNode: string;
  outcome: string;
  reason: string | null;
  signalHash: string | null;
  ciphertext: Uint8Array | null;
  createdAt: string;
}

/** Record an outcome. Returns false when a result for this (submission, node) already existed. */
export async function recordSubmissionResult(
  pool: pg.Pool,
  r: SubmissionResultInput,
): Promise<{ inserted: boolean }> {
  const { rowCount } = await pool.query(
    `INSERT INTO submission_results
       (submission_id, accepting_node, issuer_pubkey, outcome, reason, signal_hash, ciphertext)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (submission_id, accepting_node) DO NOTHING`,
    [
      r.submissionId,
      r.acceptingNode,
      r.issuerPubkey.toLowerCase(),
      r.outcome,
      r.reason ?? null,
      r.signalHash ?? null,
      r.ciphertext ? Buffer.from(r.ciphertext) : null,
    ],
  );
  return { inserted: (rowCount ?? 0) > 0 };
}

/**
 * Results for ONE issuer, oldest first.
 *
 * SCOPED BY `issuer_pubkey`, and that scoping is the whole security of this read: the caller proves
 * possession of the key by signing the request, and only rows recorded against that key come back.
 * A query without this predicate would let any authenticated agent collect every other agent's
 * outcomes — including refusal messages sealed to somebody else, which they could not open but
 * should never have been handed in the first place.
 */
export async function listSubmissionResults(
  pool: pg.Pool,
  issuerPubkey: string,
  limit = 50,
): Promise<SubmissionResult[]> {
  const { rows } = await pool.query<{
    submission_id: string;
    accepting_node: string;
    outcome: string;
    reason: string | null;
    signal_hash: string | null;
    ciphertext: Buffer | null;
    created_at: string;
  }>(
    `SELECT submission_id, accepting_node, outcome, reason, signal_hash, ciphertext, created_at
       FROM submission_results
      WHERE issuer_pubkey = $1
      ORDER BY created_at, submission_id
      LIMIT $2`,
    [issuerPubkey.toLowerCase(), Math.max(1, Math.min(limit, 200))],
  );
  return rows.map((r) => ({
    submissionId: r.submission_id,
    acceptingNode: r.accepting_node,
    outcome: r.outcome,
    reason: r.reason,
    signalHash: r.signal_hash,
    ciphertext: r.ciphertext ? new Uint8Array(r.ciphertext) : null,
    createdAt: r.created_at,
  }));
}

/**
 * Retire results the issuer has collected.
 *
 * Deleting on the issuer's say-so is safe in a way that deleting a QUEUED submission would not be: a
 * result has already been delivered to the only party entitled to it, so the row's remaining purpose
 * is redelivery. Scoped by `issuer_pubkey` for the same reason the read is — otherwise one agent
 * could delete another's outcomes.
 */
export async function ackSubmissionResults(
  pool: pg.Pool,
  issuerPubkey: string,
  submissionIds: string[],
): Promise<{ removed: number }> {
  if (submissionIds.length === 0) return { removed: 0 };
  const { rowCount } = await pool.query(
    `DELETE FROM submission_results WHERE issuer_pubkey = $1 AND submission_id = ANY($2)`,
    [issuerPubkey.toLowerCase(), submissionIds],
  );
  return { removed: rowCount ?? 0 };
}
