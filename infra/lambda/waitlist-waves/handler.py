"""
CELLO wave assembly (M11, DOD-WAVE-ASSEMBLY-1).

Admits a wave: selects the users, flips their status, mints one grant token
each, records the wave, and enqueues E-inv.

DOD-INV-WAVE-GATE is the load-bearing constraint here — admission is an
OPERATOR action, never a calendar one. That is enforced two ways:

  * There is no schedule. This function has no EventBridge rule and must not be
    given one; it runs only when invoked.
  * Every invocation must carry an `opened_by` identifying the authenticated
    operator, and it is recorded on the wave row. A wave nobody can be named for
    is a wave that might have opened itself.

The selection rules (M11 §2, DOD-WAVE-ASSEMBLY-1):
  1. Premium invitees fill the front of capacity first — the fast door is a
     promise, not a tiebreak.
  2. ~priority_pct of the REMAINING capacity → highest points_total, ties broken
     by created_at ASC so that among equals the longer wait wins.
  3. ~zero_pct of the remaining → points_total = 0 users by created_at ASC.
     This slot is deliberate: a queue that only ever admits the highest scorers
     never admits anyone who simply signed up and waited, and the waitlist stops
     being a queue and becomes a leaderboard.

Everything happens in ONE transaction. A partially-assembled wave — users
flipped to admitted with no token, or tokens minted with no email — is worse
than no wave, because the operator cannot tell which half ran.
"""

import json
import os
import uuid
import psycopg2
import psycopg2.extras

from _logging import emit as log
from _sqlstate import classify

DATABASE_URL = os.environ.get("DATABASE_URL")
TOKEN_DAYS = 14


class WaveError(Exception):
    def __init__(self, status, code, message):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def connect():
    if not DATABASE_URL:
        raise WaveError(500, "database_url_not_configured", "DATABASE_URL is not set.")
    conn = psycopg2.connect(DATABASE_URL, sslmode=os.environ.get("PGSSLMODE", "require"))
    conn.autocommit = False
    return conn


def validate(body):
    capacity = body.get("capacity")
    if not isinstance(capacity, int) or capacity <= 0:
        raise WaveError(400, "invalid_capacity", "capacity must be a positive integer.")

    priority_pct = body.get("priority_pct", 75)
    zero_pct = body.get("zero_pct", 25)
    for name, value in (("priority_pct", priority_pct), ("zero_pct", zero_pct)):
        if not isinstance(value, int) or not 0 <= value <= 100:
            raise WaveError(400, f"invalid_{name}", f"{name} must be an integer between 0 and 100.")
    if priority_pct + zero_pct > 100:
        raise WaveError(
            400,
            "split_exceeds_capacity",
            f"priority_pct + zero_pct is {priority_pct + zero_pct}; the two shares are of the "
            "same remaining capacity and cannot exceed 100.",
        )

    opened_by = (body.get("opened_by") or "").strip()
    if not opened_by:
        # ABSENT IS NOT FINE, and here it is the whole invariant: a wave with no
        # named operator is indistinguishable from one that opened itself.
        raise WaveError(
            400,
            "missing_opened_by",
            "opened_by is required — DOD-INV-WAVE-GATE means every wave names the operator who opened it.",
        )

    return capacity, priority_pct, zero_pct, opened_by


def select_cohort(cur, capacity, priority_pct, zero_pct, correlation_id):
    """Returns the ordered list of waitlist_ids to admit.

    Selected with FOR UPDATE so a concurrent second invocation cannot pick the
    same people — two operators opening a wave at once would otherwise admit
    each user twice and mint two grants.
    """
    # Users still holding an UNBURNED grant are excluded from every cohort.
    #
    # Without this, one such user aborted the entire wave: the
    # one-live-grant-per-user index fired during the token INSERT and the whole
    # transaction rolled back with `constraint_violation` — "That conflicts with
    # data already stored" — naming neither the user nor the reason. Four
    # innocent people lost their wave and the operator had no thread to pull.
    #
    # The precondition is ordinary, not exotic: E-inv tells recipients
    # "unclaimed access returns to the pool", there is no reaper, so an operator
    # returns an admitted user to 'waiting' by hand and the next wave dies.
    cur.execute(
        """
        SELECT waitlist_id FROM waitlist_users
        WHERE status = 'waiting' AND premium_referred
          AND NOT EXISTS (
              SELECT 1 FROM waitlist_tokens t
              WHERE t.waitlist_user_id = waitlist_users.waitlist_id AND t.used_at IS NULL
          )
        ORDER BY created_at ASC
        LIMIT %s
        FOR UPDATE
        """,
        (capacity,),
    )
    premium = [r["waitlist_id"] for r in cur.fetchall()]

    remaining = capacity - len(premium)
    if remaining <= 0:
        log("waitlist.wave.premium_filled_capacity", correlation_id, premium=len(premium))
        return premium, len(premium), 0, 0

    # The DoD says "~75%" and "~25%" — the SHARES are approximate, the capacity
    # is not. Integer division alone loses the remainder, and for small waves it
    # loses everything: capacity 1 at 75/25 gives 0 and 0, so a wave of one
    # admits nobody and reports success. Wave 1 is 10–20 people (M11-D10), so
    # small capacities are the normal case, not the edge.
    #
    # Slots are therefore floors, and any leftover goes to the priority cohort —
    # the queue's stated default is that points move you up, so an unassigned
    # seat belongs to the highest scorer rather than to arrival order.
    priority_slots = remaining * priority_pct // 100
    zero_slots = remaining * zero_pct // 100

    cur.execute(
        """
        SELECT waitlist_id FROM waitlist_users
        WHERE status = 'waiting' AND NOT premium_referred AND points_total > 0
          AND waitlist_id <> ALL(%s::uuid[])
          AND NOT EXISTS (
              SELECT 1 FROM waitlist_tokens t
              WHERE t.waitlist_user_id = waitlist_users.waitlist_id AND t.used_at IS NULL
          )
        ORDER BY points_total DESC, created_at ASC
        LIMIT %s
        FOR UPDATE
        """,
        ([str(p) for p in premium], priority_slots),
    )
    priority = [r["waitlist_id"] for r in cur.fetchall()]

    cur.execute(
        """
        SELECT waitlist_id FROM waitlist_users
        WHERE status = 'waiting' AND NOT premium_referred AND points_total = 0
          AND waitlist_id <> ALL(%s::uuid[])
          AND NOT EXISTS (
              SELECT 1 FROM waitlist_tokens t
              WHERE t.waitlist_user_id = waitlist_users.waitlist_id AND t.used_at IS NULL
          )
        ORDER BY created_at ASC
        LIMIT %s
        FOR UPDATE
        """,
        ([str(p) for p in premium + priority], zero_slots),
    )
    zero = [r["waitlist_id"] for r in cur.fetchall()]

    # Backfill. Two ways the cohorts underfill the capacity the operator asked
    # for, and both are ordinary rather than exotic:
    #
    #   * Integer division drops the remainder. Capacity 1 at 75/25 gives 0 and
    #     0, so a wave of one would admit NOBODY and report success. Wave 1 is
    #     10-20 people (M11-D10), so small capacities are the normal case.
    #   * One cohort can be empty. A queue where nobody has points yet — which is
    #     every queue on day one — has no priority cohort at all, so its 75%
    #     share goes unfilled while people wait.
    #
    # The shares are "~75%" and "~25%" in the DoD: approximate. The capacity is
    # not. An unfilled seat goes to whoever is next by the queue's own ordering,
    # points first, rather than being silently dropped.
    selected = premium + priority + zero
    shortfall = capacity - len(selected)
    backfill = []
    # An explicitly typed 0 is not a rounding artefact. "~75%" is approximate;
    # `zero_pct=0` is an instruction, and backfilling a zero-point user over it
    # gave the operator the opposite of what they asked for.
    allow_zero_backfill = zero_pct > 0
    if shortfall > 0:
        cur.execute(
            """
            SELECT waitlist_id FROM waitlist_users
            WHERE status = 'waiting' AND waitlist_id <> ALL(%s::uuid[])
              AND (%s OR points_total > 0)
              AND NOT EXISTS (
                  SELECT 1 FROM waitlist_tokens t
                  WHERE t.waitlist_user_id = waitlist_users.waitlist_id AND t.used_at IS NULL
              )
            ORDER BY points_total DESC, created_at ASC
            LIMIT %s
            FOR UPDATE
            """,
            ([str(u) for u in selected], allow_zero_backfill, shortfall),
        )
        backfill = [r["waitlist_id"] for r in cur.fetchall()]
        if backfill:
            log(
                "waitlist.wave.backfilled",
                correlation_id,
                shortfall=shortfall,
                filled=len(backfill),
                detail="the percentage split underfilled the capacity",
            )

    # Attribute each backfilled user to the cohort they actually belong to. The
    # earlier version added them all to `priority` under a comment claiming it
    # did exactly this — so a zero-point user admitted by backfill was reported
    # as a points admission, and the one number an operator would use to check
    # the split was the number that lied.
    backfill_zero = 0
    if backfill:
        cur.execute(
            "SELECT count(*) AS n FROM waitlist_users "
            "WHERE waitlist_id = ANY(%s::uuid[]) AND points_total = 0",
            ([str(u) for u in backfill],),
        )
        backfill_zero = cur.fetchone()["n"]

    return (
        selected + backfill,
        len(premium),
        len(priority) + (len(backfill) - backfill_zero),
        len(zero) + backfill_zero,
    )


def assemble(body, correlation_id):
    capacity, priority_pct, zero_pct, opened_by = validate(body)

    conn = connect()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cohort, n_premium, n_priority, n_zero = select_cohort(
                cur, capacity, priority_pct, zero_pct, correlation_id
            )

            if not cohort:
                # Not an error. An empty queue is a legitimate answer and the
                # operator needs to see it rather than a failure they will go
                # looking for a cause behind.
                conn.rollback()
                log("waitlist.wave.empty", correlation_id, level="WARN", capacity=capacity)
                return {
                    "admitted": 0,
                    "wave_number": None,
                    "detail": "No waiting users matched the selection rules; no wave was opened.",
                }

            cur.execute("SELECT COALESCE(max(wave_number), 0) + 1 AS n FROM waves")
            wave_number = cur.fetchone()["n"]

            cur.execute(
                """
                INSERT INTO waves (wave_number, capacity, priority_pct, zero_pct, opened_by)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (wave_number, capacity, priority_pct, zero_pct, opened_by),
            )

            cur.execute(
                """
                UPDATE waitlist_users
                SET status = 'admitted', admitted_at = now(), wave_number = %s
                WHERE waitlist_id = ANY(%s::uuid[]) AND status = 'waiting'
                RETURNING waitlist_id
                """,
                (wave_number, [str(u) for u in cohort]),
            )
            admitted = [r["waitlist_id"] for r in cur.fetchall()]

            if len(admitted) != len(cohort):
                # The FOR UPDATE above should make this impossible. If it fires,
                # something changed status underneath a held lock and guessing
                # which half is correct is worse than refusing the whole wave.
                raise WaveError(
                    409,
                    "cohort_changed_during_assembly",
                    f"Selected {len(cohort)} users but only {len(admitted)} were still waiting. "
                    "No wave was opened.",
                )

            psycopg2.extras.execute_values(
                cur,
                "INSERT INTO waitlist_tokens (waitlist_user_id, wave_number, expires_at) VALUES %s",
                [(u, wave_number) for u in admitted],
                template=f"(%s, %s, now() + interval '{TOKEN_DAYS} days')",
            )

            psycopg2.extras.execute_values(
                cur,
                "INSERT INTO email_jobs (user_id, template, scheduled_at) VALUES %s",
                [(u,) for u in admitted],
                template="(%s, 'e_inv_admission', now())",
            )

        conn.commit()
        log(
            "waitlist.wave.opened",
            correlation_id,
            waveNumber=wave_number,
            openedBy=opened_by,
            admitted=len(admitted),
            premium=n_premium,
            priority=n_priority,
            zero=n_zero,
        )
        return {
            "admitted": len(admitted),
            "wave_number": wave_number,
            "breakdown": {"premium": n_premium, "priority": n_priority, "zero": n_zero},
        }
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def lambda_handler(event, context):
    correlation_id = getattr(context, "aws_request_id", None) or str(uuid.uuid4())

    try:
        body = event if isinstance(event, dict) and "capacity" in event else json.loads(
            event.get("body") or "{}"
        )
        return {"statusCode": 200, "body": json.dumps(assemble(body, correlation_id))}

    except WaveError as err:
        log(
            "waitlist.wave.rejected",
            correlation_id,
            level="WARN" if err.status < 500 else "ERROR",
            code=err.code,
            detail=err.message,
        )
        return {
            "statusCode": err.status,
            "body": json.dumps({"error": err.code, "message": err.message}),
        }

    except psycopg2.Error as err:
        log("waitlist.wave.failed", correlation_id, level="ERROR", pgcode=err.pgcode, detail=str(err).strip())
        status, code, message = classify(err)
        return {"statusCode": status, "body": json.dumps({"error": code, "message": message})}
