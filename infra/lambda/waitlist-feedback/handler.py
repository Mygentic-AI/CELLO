"""
CELLO high-activity detection (M11, DOD-FEEDBACK-DETECTION-1, §5c).

Daily EventBridge sweep. Marks users whose usage says they have actually got
value out of CELLO, so the feedback flywheel targets people with something to
say rather than everyone who signed up.

Thresholds (M11 §11), both measured within 14 days of admission:
  * >= 5 sealed sessions, OR
  * >= 1 CROSS-OPERATOR session.

The cross-operator threshold is 1 against the other's 5 deliberately: sealing
five sessions with your own agents proves the software runs. Sealing one with
somebody else's proves the thing CELLO actually claims — that two parties who
do not share an operator can establish trust. One of those is a much stronger
signal per event, which is why the bar is five times lower.

Both are observable from session TELEMETRY. Nothing here reads message content,
and nothing here needs to: counting seals and counting distinct counterparty
operators are both metadata questions. That is not an accident of implementation
— a feedback-targeting job that read conversations would be a worse violation of
the product's premise than any feature it could enable.
"""

import json
import os
import uuid

import psycopg2

from _dburl import portal_database_url
import psycopg2.extras

from _logging import emit as log
from _sqlstate import classify

# Kept only so an explicit override still works. The live value is resolved
# lazily by portal_database_url(), because binding the environment variable here
# is exactly what let the 2026-07-27 rotation take the whole waitlist down: the
# password was baked in at deploy time and aged out. See _dburl.py.
DATABASE_URL = os.environ.get("DATABASE_URL")

SEALED_SESSION_THRESHOLD = int(os.environ.get("FEEDBACK_SEALED_THRESHOLD", "5"))
CROSS_OPERATOR_THRESHOLD = int(os.environ.get("FEEDBACK_CROSS_OPERATOR_THRESHOLD", "1"))
WINDOW_DAYS = int(os.environ.get("FEEDBACK_WINDOW_DAYS", "14"))


def connect():
    if not DATABASE_URL and not os.environ.get("PORTAL_DB_SECRET_ID"):
        raise RuntimeError("DATABASE_URL is not set on this function.")
    conn = psycopg2.connect(DATABASE_URL or portal_database_url(), sslmode=os.environ.get("PGSSLMODE", "require"))
    conn.autocommit = False
    return conn


def sweep(correlation_id):
    conn = connect()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            # One statement. The alternative — select candidates, then update
            # them — is a read-then-write across a daily job that may overlap
            # itself if a run is slow, and would re-enqueue outreach for someone
            # already contacted.
            #
            # `feedback_eligible = false` in the WHERE is what makes the whole
            # job idempotent: a user already marked is invisible to it, so a
            # second run the same day changes nothing.
            cur.execute(
                """
                WITH activity AS (
                    SELECT
                        l.waitlist_user_id,
                        -- DISTINCT on the session, not a row count. A session
                        -- between somebody's own laptop and phone writes ONE
                        -- ROW PER AGENT (0017's UNIQUE is (agent_pubkey,
                        -- session_ref)), so counting rows counted it twice and
                        -- the "5 sessions" bar fired at 3. Straight at
                        -- DOD-INV-NO-INFLATION, in the direction that flatters.
                        count(DISTINCT s.session_ref)
                            FILTER (WHERE s.sealed_at IS NOT NULL) AS sealed,
                        -- IS DISTINCT FROM, not <>. `operator` is nullable and
                        -- has no producer yet; if the daemon writes only the
                        -- counterparty fingerprint — the natural shape, since
                        -- an agent knows who it talked to and knows it is
                        -- itself — then NULL <> 'op-b' is NULL, the filter
                        -- drops it, and the cross-operator threshold never
                        -- fires for anyone. That threshold is set five times
                        -- lower on purpose because it is the signal that
                        -- matters most, so silently never firing is the worst
                        -- available failure.
                        count(DISTINCT s.session_ref)
                            FILTER (
                                WHERE s.sealed_at IS NOT NULL
                                  AND s.counterparty_operator IS NOT NULL
                                  AND s.counterparty_operator IS DISTINCT FROM s.operator
                            ) AS cross_operator
                    FROM waitlist_agent_links l
                    JOIN waitlist_users u ON u.waitlist_id = l.waitlist_user_id
                    JOIN session_telemetry s ON s.agent_pubkey = l.agent_pubkey
                    WHERE u.admitted_at IS NOT NULL
                      AND s.sealed_at BETWEEN u.admitted_at
                                          AND u.admitted_at + make_interval(days => %s)
                    GROUP BY l.waitlist_user_id
                )
                UPDATE waitlist_users u
                SET feedback_eligible = true, feedback_eligible_date = now()
                FROM activity a
                WHERE u.waitlist_id = a.waitlist_user_id
                  AND NOT u.feedback_eligible
                  AND u.status IN ('admitted', 'active')
                  AND (a.sealed >= %s OR a.cross_operator >= %s)
                RETURNING u.waitlist_id, a.sealed, a.cross_operator
                """,
                (WINDOW_DAYS, SEALED_SESSION_THRESHOLD, CROSS_OPERATOR_THRESHOLD),
            )
            newly = cur.fetchall()

            for row in newly:
                # Day 0 of the outreach sequence (§5c): the email goes out the
                # same day eligibility is detected, because a user who has just
                # got value out of something is the one moment they will
                # actually talk about it.
                cur.execute(
                    "INSERT INTO email_jobs (user_id, template, scheduled_at) "
                    "VALUES (%s, 'e_feedback_invite', now())",
                    (row["waitlist_id"],),
                )
                log(
                    "waitlist.feedback.eligible",
                    correlation_id,
                    waitlistId=str(row["waitlist_id"]),
                    sealedSessions=row["sealed"],
                    crossOperatorSessions=row["cross_operator"],
                    reason="cross_operator" if row["cross_operator"] >= CROSS_OPERATOR_THRESHOLD else "volume",
                )

        conn.commit()
        log("waitlist.feedback.sweep.complete", correlation_id, newlyEligible=len(newly))
        return {"newly_eligible": len(newly)}

    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def lambda_handler(event, context):
    correlation_id = getattr(context, "aws_request_id", None) or str(uuid.uuid4())

    try:
        return {"statusCode": 200, "body": json.dumps(sweep(correlation_id))}

    except psycopg2.Error as err:
        log(
            "waitlist.feedback.sweep.failed",
            correlation_id,
            level="ERROR",
            pgcode=err.pgcode,
            detail=str(err).strip(),
        )
        status, code, message = classify(err)
        # A failed sweep must be visibly failed. Returning 200 with zero would
        # be indistinguishable from a quiet week, and this job runs unattended —
        # nobody would notice it had stopped working until the flywheel had been
        # dry for a month.
        return {"statusCode": status, "body": json.dumps({"error": code, "message": message})}
