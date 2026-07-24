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
      independent of waitlist lifecycle status.

  DOD-INV-EMAIL-SEGMENTS — the base list and the content-alert list are never
      conflated. e_alert goes only to `content_alerts = true`; everything else
      goes to the base list unconditionally. Both directions are wrong to mix.

DELIVERY MODEL — one transaction per PHASE, never one per batch.

    claim + mint token  → COMMIT   (durable "I am sending this")
    SES send                        (network, outside any transaction)
    mark sent           → COMMIT

An earlier version wrapped the whole batch — claim, mint and every SES call — in
a single transaction committing at the end. A commit failure after the sends
rolled back the job states while the mail was already delivered, so the next
tick sent everything again, and the FIRST copy carried a token that no longer
existed. Both copies useless, one of them twice.

The ordering above is deliberately at-least-once with a VALID token rather than
at-most-once with a dead one: a duplicate email is an annoyance, a confirmation
link that cannot work is a lost signup.
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

# After this many attempts a job is terminal. Without a bound, a permanently
# failing job returns to the front of the queue forever and starves every job
# behind it — silently, because the batch summary reports a count and not a
# trend.
MAX_ATTEMPTS = int(os.environ.get("EMAIL_MAX_ATTEMPTS", "5"))

# A job left 'sending' longer than this was abandoned mid-flight (Lambda killed
# between the SES call and the mark-sent commit). It is reclaimed, which means
# at-least-once: the recipient may see a duplicate. That is the trade this
# design chooses over never sending at all.
RECLAIM_AFTER_MINUTES = int(os.environ.get("EMAIL_RECLAIM_AFTER_MINUTES", "15"))

SENDABLE_EMAIL_STATUS = "active"
CONTENT_ALERT_TEMPLATES = frozenset({"e_alert"})

_ses = None


def ses():
    global _ses
    if _ses is None:
        _ses = boto3.client("ses", region_name=AWS_REGION_NAME)
    return _ses


from _logging import emit as log  # noqa: E402 — see _logging.py


def connect():
    if not DATABASE_URL:
        # ABSENT IS NOT FINE. Falling through to libpq defaults would connect to
        # some other database and report a connection error naming the wrong
        # subsystem.
        raise RuntimeError("DATABASE_URL is not set on this function.")
    conn = psycopg2.connect(DATABASE_URL, sslmode=os.environ.get("PGSSLMODE", "require"))
    conn.autocommit = False
    return conn


def cursor(conn):
    return conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)


# ── Phase 1: claim ────────────────────────────────────────────────────────────


def claim_jobs(conn, limit, correlation_id):
    """Claim due jobs and COMMIT the claim before any network call.

    SKIP LOCKED so two concurrent invocations never claim the same row. The
    `sending` transition is what makes the claim survive this process dying —
    without it a crash between claim and send leaves the job looking untouched
    and it is sent twice.
    """
    with cursor(conn) as cur:
        cur.execute(
            """
            WITH claimable AS (
                SELECT j.id
                FROM email_jobs j
                WHERE (
                        j.status = 'pending'
                        OR (j.status = 'sending'
                            AND j.sent_at < now() - make_interval(mins => %s))
                      )
                  AND j.scheduled_at <= now()
                  AND j.attempts < %s
                ORDER BY j.attempts ASC, j.scheduled_at ASC
                FOR UPDATE SKIP LOCKED
                LIMIT %s
            )
            UPDATE email_jobs j
            SET status = 'sending', attempts = j.attempts + 1, sent_at = now()
            FROM claimable c
            WHERE j.id = c.id
            RETURNING j.id, j.user_id, j.template, j.attempts
            """,
            (RECLAIM_AFTER_MINUTES, MAX_ATTEMPTS, limit),
        )
        claimed = cur.fetchall()

        if not claimed:
            conn.commit()
            return []

        # Enrich in the same transaction. LATERAL … LIMIT 1 rather than a plain
        # LEFT JOIN: a user with two share codes would otherwise multiply the
        # job row and send the same mail once per code, each with its own live
        # 24-hour token. 0010 now forbids the second code, but a join that is
        # only correct because of a constraint elsewhere is one schema change
        # from being wrong again.
        cur.execute(
            """
            SELECT j.id, j.user_id, j.template, j.attempts,
                   u.email, u.display_name, u.email_status, u.content_alerts,
                   u.status AS user_status,
                   q.queue_position, q.queue_size,
                   rc.code AS referral_code
            FROM email_jobs j
            JOIN waitlist_users u ON u.waitlist_id = j.user_id
            LEFT JOIN waitlist_queue q ON q.waitlist_id = u.waitlist_id
            LEFT JOIN LATERAL (
                SELECT code FROM referral_codes
                WHERE owner_waitlist_user_id = u.waitlist_id AND type = 'share' AND active
                ORDER BY code
                LIMIT 1
            ) rc ON true
            WHERE j.id = ANY(%s::uuid[])
            """,
            ([str(row["id"]) for row in claimed],),
        )
        jobs = cur.fetchall()

        # Mint tokens inside the claim transaction so they are durable before
        # the mail that carries them leaves.
        for job in jobs:
            if job["template"] == "e1_confirm":
                job["auth_token"] = mint_verify_token(cur, job["user_id"])
            elif job["template"] == "e_magic_link":
                job["auth_token"] = latest_unused_magic_link(cur, job["user_id"])

    conn.commit()
    log("waitlist.email.batch.claimed", correlation_id, claimed=len(jobs))
    return jobs


def latest_unused_magic_link(cur, user_id):
    """The token /auth minted for this request.

    Minting a fresh one here would mean every retry issues another live
    credential for the same person.
    """
    cur.execute(
        """
        SELECT token FROM auth_tokens
        WHERE waitlist_user_id = %s AND kind = 'magic_link'
          AND used_at IS NULL AND expires_at > now()
        ORDER BY created_at DESC
        LIMIT 1
        """,
        (user_id,),
    )
    row = cur.fetchone()
    if row is None:
        raise RuntimeError(
            f"No unused magic-link token for {user_id}; it expired before dispatch."
        )
    return row["token"]


def mint_verify_token(cur, user_id):
    """A single-use 24-hour credential for the E1 confirm link."""
    cur.execute(
        """
        INSERT INTO auth_tokens (waitlist_user_id, kind, expires_at)
        VALUES (%s, 'email_verify', now() + interval '24 hours')
        RETURNING token
        """,
        (user_id,),
    )
    return cur.fetchone()["token"]


# ── Decisions ─────────────────────────────────────────────────────────────────


def should_send(job):
    """Returns (send: bool, skip_reason: str|None, terminal: bool).

    `terminal` distinguishes a permanent refusal from a reversible one. A
    bounced or complained address will never become sendable on its own, so the
    job is done. An `unsubscribed` user can resubscribe — marking that job
    terminal means the confirmation they are waiting for never arrives after
    they opt back in.
    """
    status = job["email_status"]
    if status != SENDABLE_EMAIL_STATUS:
        return False, f"email_status_{status}", status != "unsubscribed"

    if job["template"] in CONTENT_ALERT_TEMPLATES and not job["content_alerts"]:
        return False, "not_opted_into_content_alerts", False

    return True, None, False


def render(job):
    """Returns (subject, html, text), or raises on an unknown template.

    An unrecognised template must FAIL LOUDLY. A silent skip would mark the job
    done with nothing sent and no signal that a template was never wired up.
    """
    from templates import TEMPLATES

    template = TEMPLATES.get(job["template"])
    if template is None:
        raise KeyError(
            f"No renderer for template {job['template']!r}. "
            f"Known templates: {sorted(TEMPLATES)}."
        )
    return template(job)


# ── Phase 3: record the outcome ───────────────────────────────────────────────


def finish(conn, job_id, status, correlation_id, **fields):
    with cursor(conn) as cur:
        cur.execute(
            """
            UPDATE email_jobs
            SET status = %s,
                sent_at = CASE WHEN %s = 'sent' THEN now() ELSE sent_at END,
                skipped_at = CASE WHEN %s = 'skipped' THEN now() ELSE skipped_at END,
                skip_reason = COALESCE(%s, skip_reason),
                last_error = COALESCE(%s, last_error)
            WHERE id = %s
            """,
            (
                status,
                status,
                status,
                fields.get("skip_reason"),
                fields.get("last_error"),
                job_id,
            ),
        )
    conn.commit()


def release_for_retry(conn, job, err, correlation_id):
    """Return a job to the queue, or retire it if it has run out of attempts.

    A job that keeps failing must become TERMINAL. Left pending it is reclaimed
    oldest-first forever and starves everything behind it, while the batch
    summary reports a number that looks like weather rather than a wall.
    """
    terminal = job["attempts"] >= MAX_ATTEMPTS
    finish(
        conn,
        job["id"],
        "failed" if terminal else "pending",
        correlation_id,
        last_error=f"{type(err).__name__}: {str(err).strip()[:500]}",
    )
    log(
        "waitlist.email.retired" if terminal else "waitlist.email.failed",
        correlation_id,
        level="ERROR",
        jobId=str(job["id"]),
        template=job["template"],
        attempts=job["attempts"],
        maxAttempts=MAX_ATTEMPTS,
        errorType=type(err).__name__,
        detail=str(err).strip(),
    )
    return "retired" if terminal else "failed"


# ── Entry point ───────────────────────────────────────────────────────────────


def lambda_handler(event, context):
    correlation_id = getattr(context, "aws_request_id", None) or str(uuid.uuid4())
    limit = int((event or {}).get("batch_size") or BATCH_SIZE)

    counts = {"sent": 0, "skipped": 0, "failed": 0, "retired": 0}
    conn = connect()
    try:
        try:
            jobs = claim_jobs(conn, limit, correlation_id)
        except Exception:
            conn.rollback()
            raise

        for job in jobs:
            send, skip_reason, terminal = should_send(job)

            if not send:
                # A reversible skip goes back to pending so it is delivered if
                # the user resubscribes; a permanent one is done.
                finish(
                    conn,
                    job["id"],
                    "skipped" if terminal else "pending",
                    correlation_id,
                    skip_reason=skip_reason,
                )
                counts["skipped"] += 1
                log(
                    "waitlist.email.skipped",
                    correlation_id,
                    jobId=str(job["id"]),
                    template=job["template"],
                    reason=skip_reason,
                    terminal=terminal,
                )
                continue

            try:
                subject, body_html, body_text = render(job)
                # Outside any transaction. The claim is already committed, so a
                # crash here leaves a 'sending' row that is reclaimed later
                # rather than a job that looks untouched and is sent twice.
                ses().send_email(
                    Source=FROM_EMAIL,
                    Destination={"ToAddresses": [job["email"]]},
                    Message={
                        "Subject": {"Data": subject, "Charset": "UTF-8"},
                        "Body": {
                            "Html": {"Data": body_html, "Charset": "UTF-8"},
                            "Text": {"Data": body_text, "Charset": "UTF-8"},
                        },
                    },
                )
            except Exception as err:  # noqa: BLE001 — one bad job must not sink the batch
                conn.rollback()
                counts[release_for_retry(conn, job, err, correlation_id)] += 1
                continue

            finish(conn, job["id"], "sent", correlation_id)
            counts["sent"] += 1
            log(
                "waitlist.email.sent",
                correlation_id,
                jobId=str(job["id"]),
                template=job["template"],
            )
    finally:
        conn.close()

    log("waitlist.email.batch.complete", correlation_id, **counts)
    return counts
