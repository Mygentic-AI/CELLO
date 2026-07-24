"""
CELLO waitlist email dispatcher (M11, DOD-EMAIL-INFRA-1).

Drains `email_jobs` on an EventBridge schedule. Until this exists, every enqueued
E1 sits in the table forever while the signup screen tells the user to check
their inbox — a signup that promises an email and never sends one reads as a
broken product, so this is the consumer that makes DOD-SIGNUP-1's enqueue mean
something.

Two rules this function exists to enforce, both from the M11 invariants:

  DOD-INV-EMAIL-SUPPRESS — every send checks `email_status = 'active'` first.
      A bounced, complained or unsubscribed address receives ZERO emails,
      independent of waitlist lifecycle status. An admitted user with a bounced
      address gets nothing.

  DOD-INV-EMAIL-SEGMENTS — the base list and the content-alert list are never
      conflated. e_alert goes only to `content_alerts = true`; everything else
      goes to the base list unconditionally. Both directions are wrong to mix.

Claiming uses FOR UPDATE SKIP LOCKED. Two concurrent invocations must never send
the same job twice — an operator can tolerate a late email; they cannot untake a
duplicate one.
"""

import json
import os
import uuid
from datetime import datetime, timezone

import boto3
import psycopg2
import psycopg2.extras

DATABASE_URL = os.environ.get("DATABASE_URL")
FROM_EMAIL = os.environ.get("WAITLIST_FROM_EMAIL", "CELLO <noreply@mygentic.ai>")
AWS_REGION_NAME = os.environ.get("SES_REGION", "us-east-1")
BATCH_SIZE = int(os.environ.get("EMAIL_BATCH_SIZE", "25"))

# Suppression is a property of the ADDRESS, not of the user's place in the
# funnel. Anything not 'active' receives nothing.
SENDABLE_EMAIL_STATUS = "active"

# Templates that are content alerts rather than lifecycle mail. Only these
# consult content_alerts; everything else is base-list and ignores that flag.
CONTENT_ALERT_TEMPLATES = frozenset({"e_alert"})

_ses = None


def ses():
    global _ses
    if _ses is None:
        _ses = boto3.client("ses", region_name=AWS_REGION_NAME)
    return _ses


def log(event, correlation_id, level="INFO", **fields):
    print(
        json.dumps(
            {
                "event": event,
                "level": level,
                "correlationId": correlation_id,
                "ts": datetime.now(timezone.utc).isoformat(),
                **fields,
            }
        )
    )


def connect():
    if not DATABASE_URL:
        # ABSENT IS NOT FINE. Falling through to libpq defaults would connect to
        # some other database and report a connection error naming the wrong
        # subsystem.
        raise RuntimeError("DATABASE_URL is not set on this function.")
    return psycopg2.connect(DATABASE_URL, sslmode=os.environ.get("PGSSLMODE", "require"))


def claim_jobs(cur, limit):
    """Claim due jobs, skipping any another invocation already holds.

    SKIP LOCKED rather than a plain SELECT: without it two concurrent runs read
    the same pending rows and both send. A duplicate email cannot be recalled.
    """
    cur.execute(
        """
        SELECT j.id, j.user_id, j.template,
               u.email, u.display_name, u.email_status, u.content_alerts,
               u.status AS user_status,
               q.queue_position, q.queue_size,
               rc.code AS referral_code
        FROM email_jobs j
        JOIN waitlist_users u ON u.waitlist_id = j.user_id
        -- LEFT JOINs: an admitted user has no queue row, and the templates that
        -- need a position omit the sentence rather than inventing one.
        LEFT JOIN waitlist_queue q ON q.waitlist_id = u.waitlist_id
        LEFT JOIN referral_codes rc
               ON rc.owner_waitlist_user_id = u.waitlist_id
              AND rc.type = 'share'
        WHERE j.status = 'pending' AND j.scheduled_at <= now()
        ORDER BY j.scheduled_at ASC
        FOR UPDATE OF j SKIP LOCKED
        LIMIT %s
        """,
        (limit,),
    )
    return cur.fetchall()


def mint_verify_token(cur, user_id):
    """A single-use 24-hour credential for the E1 confirm link.

    Minted at SEND time, not at signup: a token created when the job was queued
    would already be burning down its window while the job waited, and a job
    retried after a transient SES failure would carry a stale one.
    """
    cur.execute(
        """
        INSERT INTO auth_tokens (waitlist_user_id, kind, expires_at)
        VALUES (%s, 'email_verify', now() + interval '24 hours')
        RETURNING token
        """,
        (user_id,),
    )
    return cur.fetchone()["token"]


def should_send(job):
    """Returns (send: bool, skip_reason: str|None).

    Every refusal names WHY. 'skipped' with no reason recorded is an outcome
    nobody can audit later — and the whole point of the suppression invariant is
    being able to prove a suppressed address received nothing.
    """
    if job["email_status"] != SENDABLE_EMAIL_STATUS:
        return False, f"email_status_{job['email_status']}"

    if job["template"] in CONTENT_ALERT_TEMPLATES and not job["content_alerts"]:
        return False, "not_opted_into_content_alerts"

    return True, None


def render(job):
    """Returns (subject, html, text) for a template, or raises on an unknown one.

    An unrecognised template must FAIL LOUDLY, not be silently skipped. A skip
    would leave the job marked done with nothing sent and no signal that a
    template was never wired up.
    """
    from templates import TEMPLATES  # local import keeps the cold start small

    template = TEMPLATES.get(job["template"])
    if template is None:
        raise KeyError(
            f"No renderer for template {job['template']!r}. "
            f"Known templates: {sorted(TEMPLATES)}."
        )
    return template(job)


def process(cur, job, correlation_id):
    send, skip_reason = should_send(job)

    if not send:
        cur.execute(
            "UPDATE email_jobs SET status = 'skipped', sent_at = now() WHERE id = %s",
            (job["id"],),
        )
        log(
            "waitlist.email.skipped",
            correlation_id,
            jobId=str(job["id"]),
            template=job["template"],
            reason=skip_reason,
        )
        return "skipped"

    job = dict(job)
    if job["template"] == "e1_confirm":
        job["auth_token"] = mint_verify_token(cur, job["user_id"])

    subject, html, text = render(job)

    ses().send_email(
        Source=FROM_EMAIL,
        Destination={"ToAddresses": [job["email"]]},
        Message={
            "Subject": {"Data": subject, "Charset": "UTF-8"},
            "Body": {
                "Html": {"Data": html, "Charset": "UTF-8"},
                "Text": {"Data": text, "Charset": "UTF-8"},
            },
        },
    )

    cur.execute(
        "UPDATE email_jobs SET status = 'sent', sent_at = now() WHERE id = %s",
        (job["id"],),
    )
    log(
        "waitlist.email.sent",
        correlation_id,
        jobId=str(job["id"]),
        template=job["template"],
    )
    return "sent"


def lambda_handler(event, context):
    correlation_id = getattr(context, "aws_request_id", None) or str(uuid.uuid4())
    limit = int((event or {}).get("batch_size") or BATCH_SIZE)

    counts = {"sent": 0, "skipped": 0, "failed": 0}
    conn = connect()
    try:
        conn.autocommit = False
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            jobs = claim_jobs(cur, limit)
            log("waitlist.email.batch.claimed", correlation_id, claimed=len(jobs))

            for job in jobs:
                # Per-job SAVEPOINT: one undeliverable address or one unwired
                # template must not abort the transaction and roll back every
                # other job's result with it.
                cur.execute("SAVEPOINT job")
                try:
                    outcome = process(cur, job, correlation_id)
                    cur.execute("RELEASE SAVEPOINT job")
                    counts[outcome] += 1
                except Exception as err:  # noqa: BLE001 — one bad job must not sink the batch
                    cur.execute("ROLLBACK TO SAVEPOINT job")
                    counts["failed"] += 1
                    # The job stays 'pending' and is retried next tick. The cause
                    # is logged in full — an operator seeing "failed" with no
                    # reason cannot tell a bad address from a broken template.
                    log(
                        "waitlist.email.failed",
                        correlation_id,
                        level="ERROR",
                        jobId=str(job["id"]),
                        template=job["template"],
                        errorType=type(err).__name__,
                        detail=str(err).strip(),
                    )

        conn.commit()
    finally:
        conn.close()

    log("waitlist.email.batch.complete", correlation_id, **counts)
    return counts
