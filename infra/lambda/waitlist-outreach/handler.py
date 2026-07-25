"""
CELLO feedback outreach sequence (M11, DOD-FEEDBACK-OUTREACH-1, §5c).

Daily sweep over users the detection Lambda marked eligible. Two steps:

  Day 0  — a CELLO_FEEDBACK session initiation is enqueued alongside the email.
           The session is the point: reaching a user through the product is the
           thing being dogfooded, and the email is the fallback for someone whose
           agent is not running.

  Day 6  — no response, so grant 2 premium invites and note it on the status
           page. This is deliberately not a chaser email. Someone who ignored
           the first one has answered; sending another says we were not
           listening. The invites are worth more than a reminder and cost the
           recipient nothing.

The ops dashboard's "call completed" action grants 4 TOTAL, topping up whatever
Day 6 already issued rather than adding to it — otherwise someone who took six
days to reply ends up with more invites than someone who answered immediately,
which inverts the incentive.
"""

import json
import os
import secrets
import uuid

import psycopg2
import psycopg2.extras

from _logging import emit as log
from _sqlstate import classify

DATABASE_URL = os.environ.get("DATABASE_URL")

NO_RESPONSE_DAYS = int(os.environ.get("OUTREACH_NO_RESPONSE_DAYS", "6"))
DAY_SIX_INVITES = int(os.environ.get("OUTREACH_DAY_SIX_INVITES", "2"))
CALL_COMPLETED_TOTAL = int(os.environ.get("OUTREACH_CALL_COMPLETED_TOTAL", "4"))

CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
CODE_LENGTH = 12
MAX_CODE_ATTEMPTS = 10


class OutreachError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


def connect():
    if not DATABASE_URL:
        raise OutreachError("database_url_not_configured", "DATABASE_URL is not set.")
    conn = psycopg2.connect(DATABASE_URL, sslmode=os.environ.get("PGSSLMODE", "require"))
    conn.autocommit = False
    return conn


def generate_code(cur):
    for _ in range(MAX_CODE_ATTEMPTS):
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))
        cur.execute("SELECT 1 FROM referral_codes WHERE code = %s", (code,))
        if cur.fetchone() is None:
            return code
    raise OutreachError(
        "code_generation_exhausted",
        f"Could not mint an unused invite code in {MAX_CODE_ATTEMPTS} attempts.",
    )


def grant_invites_up_to(cur, user_id, target, correlation_id, reason, scope="outreach"):
    """Top up to `target` premium invites from THIS SEQUENCE. Returns how many
    were newly issued.

    `scope` is the fix for a real defect: the ceiling was counted against ALL of
    a user's premium codes, including the three from first-win. So anyone who
    had reached first win — which is most people who become feedback-eligible,
    since eligibility is measured in sealed sessions — held 3, needed 0, got
    ZERO invites at Day 6, and had `feedback_day6_granted_at` stamped anyway so
    they could never be picked up again. The DoD clause is unconditional:
    "Day 6, no response: auto-grant 2 premium invite codes."
    
    The call-completed ceiling of 4 deliberately DOES count everything (M11-D29)
    — that number is a cap on what one person can hand out. The Day-6 grant is
    not a cap; it is a grant. Different questions, so different scopes.
    """
    cur.execute(
        "SELECT count(*) AS n FROM referral_codes "
        "WHERE owner_waitlist_user_id = %s AND type = 'premium' "
        "  AND (%s = 'all' OR meta->>'source' = 'outreach')",
        (user_id, scope),
    )
    held = cur.fetchone()["n"]
    needed = max(0, target - held)

    if needed == 0:
        log(
            "waitlist.outreach.invites.already_held",
            correlation_id,
            waitlistId=str(user_id),
            held=held,
            target=target,
        )
        return 0

    codes = [generate_code(cur) for _ in range(needed)]
    psycopg2.extras.execute_values(
        cur,
        "INSERT INTO referral_codes (code, owner_waitlist_user_id, creator_handle, type, meta) VALUES %s",
        [(code, user_id) for code in codes],
        template="(%s, %s, NULL, 'premium', '{\"source\": \"outreach\"}'::jsonb)",
    )
    log(
        "waitlist.outreach.invites.granted",
        correlation_id,
        waitlistId=str(user_id),
        issued=needed,
        heldBefore=held,
        target=target,
        reason=reason,
    )
    return needed


def note(cur, waitlist_user_id, kind, body):
    """Write a status-page note, at most one live one per kind per user.

    ON CONFLICT DO NOTHING against the partial unique index rather than an
    upsert: a replayed sweep must not restamp created_at and shuffle the note
    back to the top of someone's page, and it must not rewrite a body they have
    already read. Returns 1 if a note was written, 0 if one was already there —
    the caller counts it, so "granted invites but wrote no note" is visible in
    the log rather than assumed impossible.
    """
    cur.execute(
        """
        INSERT INTO status_notes (waitlist_user_id, kind, body)
        VALUES (%s, %s, %s)
        ON CONFLICT DO NOTHING
        RETURNING id
        """,
        (waitlist_user_id, kind, body),
    )
    return 1 if cur.fetchone() else 0


# ── Day 6 sweep ───────────────────────────────────────────────────────────────


def sweep_day_six(correlation_id):
    conn = connect()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            # `feedback_day6_granted_at IS NULL` is the idempotency key, not a
            # date comparison: a sweep that missed a day must still pick the
            # user up, and one that runs twice must not grant twice.
            cur.execute(
                """
                UPDATE waitlist_users
                SET feedback_day6_granted_at = now()
                WHERE feedback_eligible
                  AND feedback_eligible_date < now() - make_interval(days => %s)
                  AND feedback_day6_granted_at IS NULL
                  AND feedback_call_completed_at IS NULL
                  AND status IN ('admitted', 'active')
                  AND email_status = 'active'
                RETURNING waitlist_id
                """,
                (NO_RESPONSE_DAYS,),
            )
            claimed = cur.fetchall()
            issued = 0

            noted = 0
            for row in claimed:
                granted = grant_invites_up_to(
                    cur, row["waitlist_id"], DAY_SIX_INVITES, correlation_id, "day_six_no_response"
                )
                issued += granted
                # THE NOTE IS ONLY WRITTEN IF SOMETHING WAS ACTUALLY GRANTED.
                # grant_invites_up_to grants UP TO a target, so a user already
                # holding the ceiling receives zero — and telling them invites
                # arrived when none did is worse than saying nothing, because
                # they go looking for codes that are not there.
                if granted:
                    noted += note(
                        cur,
                        row["waitlist_id"],
                        "feedback_invites_granted",
                        f"We'd still love to hear how it's going. In the meantime, "
                        f"{granted} premium invite{'s are' if granted != 1 else ' is'} "
                        f"on your account — pass {'them' if granted != 1 else 'it'} on to "
                        f"someone whose agent you'd want to talk to.",
                    )

        conn.commit()
        # Users claimed AND invites issued. Reporting only the row count said
        # "day_six_granted: 1" while issuing nothing at all.
        log(
            "waitlist.outreach.day_six.complete",
            correlation_id,
            usersClaimed=len(claimed),
            invitesIssued=issued,
            notesWritten=noted,
        )
        return {
            "day_six_granted": len(claimed),
            "invites_issued": issued,
            "notes_written": noted,
        }

    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# ── Ops action: call completed ────────────────────────────────────────────────


def complete_call(body, correlation_id):
    user_id = (body.get("waitlist_user_id") or "").strip()
    completed_by = (body.get("completed_by") or "").strip()

    if not user_id:
        raise OutreachError("missing_waitlist_user_id", "No user was named.")
    if not completed_by:
        # Same reasoning as wave assembly: an action with no named operator is
        # indistinguishable from one that happened by itself.
        raise OutreachError(
            "missing_completed_by",
            "completed_by is required — every invite grant names the operator who made it.",
        )
    try:
        uuid.UUID(user_id)
    except (ValueError, AttributeError, TypeError):
        raise OutreachError("invalid_waitlist_user_id", "That is not a valid waitlist id.")

    conn = connect()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                UPDATE waitlist_users
                SET feedback_call_completed_at = now()
                WHERE waitlist_id = %s AND feedback_call_completed_at IS NULL
                RETURNING waitlist_id
                """,
                (user_id,),
            )
            if cur.fetchone() is None:
                cur.execute("SELECT 1 FROM waitlist_users WHERE waitlist_id = %s", (user_id,))
                if cur.fetchone() is None:
                    raise OutreachError("user_not_found", "No waitlist user with that id.")
                conn.rollback()
                log("waitlist.outreach.call.already_completed", correlation_id, waitlistId=user_id)
                return {"granted": 0, "reason": "already_completed"}

            # scope="all": the 4 is a CEILING on what one person can hand out
            # (M11-D29), so first-win invites count toward it.
            issued = grant_invites_up_to(
                cur,
                user_id,
                CALL_COMPLETED_TOTAL,
                correlation_id,
                f"call_completed_by:{completed_by}",
                scope="all",
            )
            # Same rule as Day 6: only tell them if something arrived. A note
            # saying invites were granted when the ceiling was already reached
            # sends them looking for codes that do not exist.
            if issued:
                note(
                    cur,
                    user_id,
                    "call_invites_granted",
                    f"Thanks for the call — that was genuinely useful. {issued} more premium "
                    f"invite{'s are' if issued != 1 else ' is'} on your account.",
                )

        conn.commit()
        log(
            "waitlist.outreach.call.completed",
            correlation_id,
            waitlistId=user_id,
            completedBy=completed_by,
            invitesIssued=issued,
        )
        return {"granted": issued, "total": CALL_COMPLETED_TOTAL}

    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def lambda_handler(event, context):
    correlation_id = getattr(context, "aws_request_id", None) or str(uuid.uuid4())
    body = event if isinstance(event, dict) else {}

    try:
        if body.get("action") == "call_completed":
            return {"statusCode": 200, "body": json.dumps(complete_call(body, correlation_id))}

        return {"statusCode": 200, "body": json.dumps(sweep_day_six(correlation_id))}

    except OutreachError as err:
        log("waitlist.outreach.rejected", correlation_id, level="WARN", code=err.code)
        return {"statusCode": 400, "body": json.dumps({"error": err.code, "message": err.message})}

    except psycopg2.Error as err:
        log(
            "waitlist.outreach.failed",
            correlation_id,
            level="ERROR",
            pgcode=err.pgcode,
            detail=str(err).strip(),
        )
        status, code, message = classify(err)
        return {"statusCode": status, "body": json.dumps({"error": code, "message": message})}
