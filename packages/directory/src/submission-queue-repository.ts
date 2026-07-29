/**
 * M10B / DOD-END-QUEUE-1 — the sealed submission queue (M10B-D2).
 *
 * The directory's half of the client-supplied ingress: it accepts a blob it cannot read, holds it
 * until the portal drains it, and then forgets it. Nothing here opens, parses, or interprets the
 * ciphertext — the schema has nowhere to put anything it learned (INV-DIR-DUMB).
 *
 * WHY THERE IS NO agent_id ANYWHERE IN THIS FILE. A pickup is ADDRESSED (delivery must reach a
 * specific agent, so `pickup_queue` carries `agent_id`); a submission is COLLECTED by one consumer
 * that polls every node, so it needs no addressee. Persisting the submitter would hand a directory
 * operator "Bob submitted five endorsements" — not to whom, but still the metadata shape
 * DOD-END-DISCOVER-1 is written against. Flood protection belongs at the authenticated signaling
 * handler, off the live connection identity, never off a column here.
 *
 * EXACTLY-ONCE IS NOT PROMISED HERE, AND PRETENDING OTHERWISE IS HOW THIS GETS BUILT WRONG. The portal
 * can crash between minting and acking and re-drain the same row, which no queue-side property can
 * prevent. So this is at-least-once; the portal holds a processed-submissions record keyed on the id
 * it DERIVES from the opened body (M10B-D20). `submissionId` here is caller-supplied and the directory
 * cannot verify it — it cannot open the seal — so it is a routing hint, never an authority.
 */

import type pg from "pg";

type Queryable = Pick<pg.Pool, "query">;

export interface QueuedSubmission {
  /** sha256 of the signed submission body, as supplied by the submitter. A HINT — the portal
   *  re-derives it from the opened body and discards any row whose id disagrees. */
  submissionId: string;
  /** Which portal intake key this blob is sealed to (M10B-D11). Drives rotation retention: a
   *  rotated-out private key is retained until no undrained row references its id. */
  intakeKeyId: string;
  /** The sealed blob. Opaque — only the portal's intake key can open it. */
  ciphertext: Buffer;
}

/**
 * Accept a sealed submission. Idempotent on `submissionId`: a daemon that retries the same body (to
 * this node or another) produces the same content-derived id, so a duplicate is a strict no-op rather
 * than a second row.
 *
 * DO NOTHING, never DO UPDATE. An update would let a later writer replace the ciphertext under an id
 * someone else chose — and since the directory cannot open either blob, it could not tell. The first
 * writer of an id wins; a mismatch is the portal's to detect when it re-derives the id.
 *
 * RETURNS WHETHER THE ROW WAS ACTUALLY STORED, and the caller MUST NOT discard it.
 *
 * `false` means an id was already present — which is USUALLY the submitter's own retry, and is exactly
 * what makes retry-across-nodes safe. But it is also the shape of a censorship attack, and swallowing
 * the distinction is what would make that attack silent: `submission_id` is visible in the clear to the
 * receiving node, so a malicious operator can copy it and pre-insert garbage under the same id at the
 * other nodes. The submitter's failover retries then all resolve to "already present", and if this
 * returned `void` the daemon would log `signal.submission.queued` three times for a submission that
 * reached nobody. Byte-comparing the ciphertext cannot detect it either — a legitimate re-seal produces
 * different bytes under the same id.
 *
 * So the handler distinguishes `signal.submission.queued` from `signal.submission.duplicate`. That does
 * not by itself defeat the attack; the closure is that a submission is not complete until its notarized
 * record appears, and the daemon owns that timeout. But without this boolean the handler CANNOT tell,
 * however well it is written — the information is destroyed here.
 */
export async function enqueueSubmission(db: Queryable, s: QueuedSubmission): Promise<boolean> {
  const res = await db.query(
    `INSERT INTO submission_queue (submission_id, intake_key_id, ciphertext)
     VALUES ($1, $2, $3)
     ON CONFLICT (submission_id) DO NOTHING`,
    [s.submissionId, s.intakeKeyId, s.ciphertext],
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * Drain up to `limit` submissions, oldest first.
 *
 * NOT scoped to an agent — there is no agent column, by design. The portal is the only consumer, and
 * because the queue is NOT replicated (M10B-D21) it must call this against EVERY node rather than
 * failing over between them: draining means "collect from all", not "try until one succeeds".
 */
export async function drainSubmissions(db: Queryable, limit = 100): Promise<QueuedSubmission[]> {
  const res = await db.query<{ submission_id: string; intake_key_id: string; ciphertext: Buffer }>(
    `SELECT submission_id, intake_key_id, ciphertext
       FROM submission_queue
      ORDER BY created_at ASC, submission_id ASC
      LIMIT $1`,
    [limit],
  );
  return res.rows.map((r) => ({
    submissionId: r.submission_id,
    intakeKeyId: r.intake_key_id,
    ciphertext: r.ciphertext,
  }));
}

/**
 * Remove a submission after the portal has reached a TERMINAL outcome for it — minted, rejected, or
 * poison. All three delete; they differ only in what the portal sends back to the submitter
 * (poison sends nothing, because an unverifiable submission is unattributable by construction —
 * M10B-D22b).
 *
 * DELETE, not a soft flag: after the outcome is decided, no sealed ciphertext should linger. Same
 * reasoning as `ackPickupDelete`. Idempotent — deleting an already-deleted id is a no-op.
 */
export async function deleteSubmission(db: Queryable, submissionId: string): Promise<boolean> {
  const res = await db.query(`DELETE FROM submission_queue WHERE submission_id = $1`, [submissionId]);
  return (res.rowCount ?? 0) > 0;
}

/**
 * Sweep submissions the portal never drained.
 *
 * TTL ORDERING IS LOAD-BEARING AND EASY TO INVERT (M10B-D27): this TTL must be **shorter than or
 * equal to** the portal's intake-key retention window. If a row can outlive the key it is sealed to,
 * it becomes undecryptable → poison → no reply → silent loss, which is the exact failure the return
 * path exists to prevent. Longer-than is the direction that GUARANTEES the stranding.
 *
 * A swept row generates no reply (there is nobody to reply to — the blob was never opened, so the
 * submitter is unknown), so the DAEMON owns the corresponding timeout and reports it locally.
 */
export async function sweepStaleSubmissions(db: Queryable, ttlHours: number): Promise<number> {
  // REFUSE A DESTRUCTIVE TTL. This is the only unbounded multi-row DELETE in the unit, and it operates
  // on sealed blobs the directory cannot reconstruct. `ttlHours = 0` makes the predicate
  // `created_at < now()`, which destroys the ENTIRE queue including a row enqueued a millisecond ago;
  // a negative value is worse (`now() - (-24h)` = `now() + 24h`). Neither raises an error on its own —
  // it is a silent total loss. And the TTL's correct value is itself safety-critical (M10B-D27: it must
  // be <= the portal's intake-key retention window), so it will one day come from a config that does
  // not exist yet. Fail loud, and name the constraint rather than the exit point.
  //
  // Sub-hour TTLs are deliberately NOT expressible: `make_interval(hours => …)` takes an integer, so
  // 0.5 would be a raw type error and the tempting "fix" is Math.round → 0 → total destruction. If a
  // shorter window is ever wanted, change the parameter to `ttlMinutes` and `make_interval(mins => …)`.
  if (!Number.isInteger(ttlHours) || ttlHours < 1) {
    throw new Error(
      `submission_queue.sweep refused: ttlHours must be a positive integer ` +
        `(M10B-D27 — the sweep window must be <= the portal's intake-key retention); got ${String(ttlHours)}`,
    );
  }
  const res = await db.query(
    `DELETE FROM submission_queue WHERE created_at < now() - make_interval(hours => $1)`,
    [ttlHours],
  );
  return res.rowCount ?? 0;
}

/**
 * Intake key ids still referenced by undrained rows — the input to M10B-D11's rotation retention rule
 * ("retain a rotated-out private key until no undrained row references it"). Queue-driven, not a
 * timer.
 */
export async function intakeKeyIdsInUse(db: Queryable): Promise<string[]> {
  const res = await db.query<{ intake_key_id: string }>(
    `SELECT DISTINCT intake_key_id FROM submission_queue`,
  );
  return res.rows.map((r) => r.intake_key_id);
}
