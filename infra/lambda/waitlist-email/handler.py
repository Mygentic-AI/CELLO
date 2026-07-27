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
from email.message import EmailMessage

import boto3
import psycopg2

from _dburl import portal_database_url
import psycopg2.extras

# Kept only so an explicit override still works. The live value is resolved
# lazily by portal_database_url(), because binding the environment variable here
# is exactly what let the 2026-07-27 rotation take the whole waitlist down: the
# password was baked in at deploy time and aged out. See _dburl.py.
DATABASE_URL = os.environ.get("DATABASE_URL")
FROM_EMAIL = os.environ.get("WAITLIST_FROM_EMAIL", "CELLO <noreply@mygentic.ai>")
AWS_REGION_NAME = os.environ.get("SES_REGION", "us-east-1")
# NO DEFAULT, and absence REFUSES rather than sending without it. SES only emits
# bounce and complaint events for messages sent WITH a configuration set. Send
# without one and every message still leaves — nothing errors, deliverability
# looks fine — but no bounce ever reaches the SNS topic, so email_status is never
# set to bounced or complained and DOD-INV-EMAIL-SUPPRESS quietly stops being
# enforced. That failure is invisible for exactly as long as it takes to burn the
# sending domain's reputation.
SES_CONFIG_SET = os.environ.get("WAITLIST_SES_CONFIG_SET")
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
API_BASE = os.environ.get("WAITLIST_API_BASE", "https://api.cello.mygentic.ai/waitlist")
CONTENT_ALERT_TEMPLATES = frozenset({"e_alert"})

_ses = None


def ses():
    global _ses
    if _ses is None:
        _ses = boto3.client("ses", region_name=AWS_REGION_NAME)
    return _ses


from _logging import emit as log  # noqa: E402 — see _logging.py


def connect():
    if not DATABASE_URL and not os.environ.get("PORTAL_DB_SECRET_ID"):
        # ABSENT IS NOT FINE. Falling through to libpq defaults would connect to
        # some other database and report a connection error naming the wrong
        # subsystem.
        raise RuntimeError("DATABASE_URL is not set on this function.")
    conn = psycopg2.connect(DATABASE_URL or portal_database_url(), sslmode=os.environ.get("PGSSLMODE", "require"))
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
            SELECT j.id, j.user_id, j.template, j.attempts, j.payload,
                   u.email, u.display_name, u.email_status, u.content_alerts,
                   u.email_verified,
                   u.status AS user_status, u.wave_number,
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

        # Resolve everything a template needs inside the claim transaction, so
        # it is durable before the mail that carries it leaves.
        for job in jobs:
            # Operator-supplied context is namespaced, NOT merged. Merging let a
            # payload key shadow a real column: `email` redirected a
            # DKIM-signed CELLO message anywhere, `email_status` defeated
            # suppression, `content_alerts` and `template` each defeated the
            # segment split (should_send read the SHADOWED template, so an
            # e_alert escaped the alert list entirely), and `user_id` put
            # another user's live admission grant in the body — which the
            # recipient could then burn at the gate.
            #
            # Nothing writes payload yet; 0014 exists so the ops dashboard can.
            # The consumer shipped ahead of its producer with no guard, which is
            # the moment to fix it rather than after.
            payload = job.get("payload") or {}
            job["ctx"] = {k: v for k, v in payload.items() if k.startswith("alert_")}

            if job["template"] == "e1_confirm":
                job["auth_token"] = mint_verify_token(cur, job["user_id"])
            elif job["template"] == "e_magic_link":
                job["auth_token"] = latest_unused_magic_link(cur, job["user_id"])
            elif job["template"] == "e_inv_admission":
                job["waitlist_token"] = live_grant(cur, job["user_id"])
            elif job["template"] == "e_win_invites":
                job["invite_codes"] = premium_codes(cur, job["user_id"])

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


def live_grant(cur, user_id):
    """The unburned wave grant for this user.

    Read rather than minted: wave assembly already created exactly one, and
    minting here would give a retried job a second live admission for the same
    person.
    """
    cur.execute(
        """
        SELECT token FROM waitlist_tokens
        WHERE waitlist_user_id = %s AND used_at IS NULL AND expires_at > now()
        ORDER BY created_at DESC LIMIT 1
        """,
        (user_id,),
    )
    row = cur.fetchone()
    if row is None:
        # Refuse rather than send an admission nobody can redeem — the recipient
        # would have no way to tell whether the fault was theirs.
        raise RuntimeError(
            f"No live waitlist grant for {user_id}; refusing to send an invitation "
            "that cannot be claimed."
        )
    return row["token"]


def premium_codes(cur, user_id):
    """The user's unspent premium invites."""
    cur.execute(
        """
        SELECT code FROM referral_codes
        WHERE owner_waitlist_user_id = %s AND type = 'premium' AND active
        ORDER BY code
        """,
        (user_id,),
    )
    codes = [r["code"] for r in cur.fetchall()]
    if not codes:
        raise RuntimeError(
            f"No unspent premium invites for {user_id}; the mail exists to deliver them."
        )
    return codes


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


def unsubscribe_headers(job):
    """RFC 8058 one-click unsubscribe, scoped to the right list.

    A content alert unsubscribes from content alerts; anything else unsubscribes
    from the base list. Sending the base-list URL on an e_alert would let
    somebody muting blog posts drop off their waitlist mail entirely —
    DOD-INV-EMAIL-SEGMENTS from the user's side, in the place a user is most
    likely to click.
    """
    scope = "&list=content_alerts" if job["template"] in CONTENT_ALERT_TEMPLATES else ""
    url = f"{API_BASE}/unsubscribe?u={job['user_id']}{scope}"
    return [
        {"Name": "List-Unsubscribe", "Value": f"<{url}>"},
        {"Name": "List-Unsubscribe-Post", "Value": "List-Unsubscribe=One-Click"},
    ]


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

    # DOD-INV-EMAIL-SEGMENTS defines the base list as "all VERIFIED signups".
    # Nothing enforced that: e2_survey and e3_update are enqueued at signup —
    # before verification, by construction — and the dispatcher re-checked
    # status and suppression but never email_verified. So every unconfirmed
    # address received the survey nudge a day later and an update two weeks
    # after that, from a list it was never actually on.
    #
    # NOT terminal: confirming is exactly the thing that makes these sendable,
    # and retiring the job would mean somebody who confirms on day three never
    # receives the survey they were meant to get on day two.
    #
    # PRE_VERIFICATION_TEMPLATES is the deliberate exception and has to stay
    # small: e1_confirm IS the confirmation, and e_magic_link is how somebody
    # who never confirmed signs in to fix it. Gate either and the account is
    # unrecoverable — a check that locks the door it is guarding.
    if job["template"] not in PRE_VERIFICATION_TEMPLATES and not job["email_verified"]:
        return False, "email_not_verified", False

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
                last_error = COALESCE(%s, last_error),
                -- A REVERSIBLE SKIP MUST NOT SPEND THE RETRY BUDGET. claim_jobs
                -- refuses anything at attempts >= MAX_ATTEMPTS, and the drain
                -- runs every minute, so without this an unverified user's job
                -- burned all five attempts in five minutes and became
                -- permanently unclaimable — while sitting in status 'pending',
                -- which reads as healthy. The comment above should_send's
                -- verified gate promised "somebody who confirms on day three
                -- still receives the survey"; measured, they received nothing,
                -- ever. The retry budget exists to bound FAILURES, and waiting
                -- for a user to confirm is not a failure.
                attempts = CASE WHEN %s THEN 0 ELSE attempts END
            WHERE id = %s
            """,
            (
                status,
                status,
                status,
                fields.get("skip_reason"),
                fields.get("last_error"),
                bool(fields.get("reset_attempts")),
                job_id,
            ),
        )
    conn.commit()


NURTURE_INTERVAL_DAYS = int(os.environ.get("EMAIL_NURTURE_INTERVAL_DAYS", "14"))

# The only two messages that may reach an unverified address, because each is
# part of becoming verified. Everything else is base-list mail and waits.
PRE_VERIFICATION_TEMPLATES = frozenset({"e1_confirm", "e_magic_link"})


def schedule_next_nurture(conn, job, correlation_id):
    """After an E3 goes out, queue the next one — but only while still waiting.

    Self-perpetuating rather than swept, because a sweep has to answer "who is
    due?" on every tick and gets that wrong at the boundaries; a chain only has
    to answer "did this one send?", which it already knows.

    The status check is the important half. A nurture drip that keeps arriving
    after somebody has been admitted — or has left — is worse than no drip: it
    says plainly that nobody is watching.
    """
    if job["template"] != "e3_update":
        return

    with cursor(conn) as cur:
        cur.execute(
            """
            INSERT INTO email_jobs (user_id, template, scheduled_at)
            SELECT waitlist_id, 'e3_update', now() + make_interval(days => %s)
            FROM waitlist_users
            WHERE waitlist_id = %s AND status = 'waiting' AND email_status = 'active'
            RETURNING id
            """,
            (NURTURE_INTERVAL_DAYS, job["user_id"]),
        )
        queued = cur.fetchone()
    conn.commit()

    if queued:
        log(
            "waitlist.email.nurture.rescheduled",
            correlation_id,
            waitlistId=str(job["user_id"]),
            days=NURTURE_INTERVAL_DAYS,
        )
    else:
        # Admitted, left, or suppressed — the chain ends here by design.
        log("waitlist.email.nurture.chain_ended", correlation_id, waitlistId=str(job["user_id"]))


# ── E-re: the 60-day re-engagement sweep (DOD-E-RE-1) ────────────────────────

RE_ENGAGE_AFTER_DAYS = int(os.environ.get("EMAIL_RE_ENGAGE_AFTER_DAYS", "60"))
RE_ENGAGE_QUIET_DAYS = int(os.environ.get("EMAIL_RE_ENGAGE_QUIET_DAYS", "30"))
RE_ENGAGE_BATCH = int(os.environ.get("EMAIL_RE_ENGAGE_BATCH", "500"))


def sweep_re_engagement(correlation_id):
    """Enqueue E-re once, for people who signed up two months ago and went quiet.

    A SWEEP, not a chain — unlike the E3 nurture drip next door, and for the
    opposite reason. The drip chains because its trigger is "did the last one
    send?", which the sender already knows. This one's trigger is "has this
    person done nothing for thirty days?", which is not knowable at the moment
    any prior email went out, and which can become true long afterwards.

    WHAT COUNTS AS ACTIVITY, since the DoD says "no activity" and the schema has
    no last_activity_at column. TWO things the user themselves did:
      - earned points (survey, share conversion, a post)  → points_ledger
      - signed in to their status page                    → waitlist_sessions

    NOT page views, and this is a correction rather than an omission. An earlier
    version also checked waitlist_touchpoints and its docstring claimed that
    covered "arrived on the site". It does not: the ONLY writer of that table is
    the signup handler, inserting the visitor's pre-signup localStorage trail in
    one shot. Nothing records a touchpoint afterwards, so for anyone older than
    sixty days every row predates the thirty-day window and the clause could
    never fire. A guard that reads as protective and cannot fire is worse than
    no guard, because it stops the next person looking for the real one.

    The consequence, stated plainly: somebody who visits the site every day but
    never signs in and never earns a point will receive this email. Closing that
    needs a post-signup pageview writer, which does not exist yet — see the DoD.

    Deliberately NOT "we sent them an email" either, which is our activity, not
    theirs — counting it would keep somebody looking permanently active while
    they ignore every message.

    ONCE, EVER. The guard is "no e_re_engage row exists for this user", so a
    sweep that runs twice a day, or is replayed after a partial failure, enqueues
    nothing the second time. That also means somebody who returns, goes quiet
    again and crosses the boundary a second time does not get a second one —
    correct for a message whose whole content is "we noticed you have not been
    back".
    """
    conn = connect()
    try:
        with cursor(conn) as cur:
            cur.execute(
                """
                INSERT INTO email_jobs (user_id, template, scheduled_at)
                SELECT u.waitlist_id, 'e_re_engage', now()
                FROM waitlist_users u
                WHERE u.status = 'waiting'
                  AND u.email_status = 'active'
                  AND u.email_verified
                  AND u.created_at < now() - make_interval(days => %(after)s)
                  AND NOT EXISTS (
                        SELECT 1 FROM email_jobs j
                        WHERE j.user_id = u.waitlist_id AND j.template = 'e_re_engage'
                  )
                  AND NOT EXISTS (
                        SELECT 1 FROM points_ledger l
                        WHERE l.waitlist_user_id = u.waitlist_id
                          AND l.created_at > now() - make_interval(days => %(quiet)s)
                  )
                  AND NOT EXISTS (
                        SELECT 1 FROM waitlist_sessions s
                        WHERE s.waitlist_user_id = u.waitlist_id
                          AND s.created_at > now() - make_interval(days => %(quiet)s)
                  )
                -- BOUNDED. Without a limit the first run enqueues the entire
                -- dormant backlog at scheduled_at = now(), and claim_jobs orders
                -- by scheduled_at — so every backfilled E-re sits AHEAD of every
                -- e1_confirm enqueued afterwards. At 25 jobs a minute a 100k
                -- backlog is ~67 hours during which a brand-new signup's
                -- confirmation waits behind it while the page says "check your
                -- inbox". The sweep is daily and idempotent, so it self-drains.
                LIMIT %(batch)s
                RETURNING user_id
                """,
                {
                    "after": RE_ENGAGE_AFTER_DAYS,
                    "quiet": RE_ENGAGE_QUIET_DAYS,
                    "batch": RE_ENGAGE_BATCH,
                },
            )
            enqueued = cur.fetchall()
        conn.commit()

        log(
            "waitlist.email.re_engage.swept",
            correlation_id,
            enqueued=len(enqueued),
            afterDays=RE_ENGAGE_AFTER_DAYS,
            quietDays=RE_ENGAGE_QUIET_DAYS,
        )
        return {"re_engage_enqueued": len(enqueued)}

    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


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

    # A SEPARATE ACTION, on its own daily schedule, rather than folded into the
    # per-minute drain. The sweep scans every waiting user against three
    # NOT EXISTS subqueries; running it 1440 times a day to enqueue the same
    # zero rows is work nobody asked for, and a boundary that can only be
    # crossed once a day does not need checking every minute.
    if (event or {}).get("action") == "sweep_re_engagement":
        return sweep_re_engagement(correlation_id)

    limit = int((event or {}).get("batch_size") or BATCH_SIZE)

    # Checked BEFORE any job is claimed. Refusing after a claim would leave rows
    # stranded in 'sending' until the reclaim window, for a fault that has
    # nothing to do with those rows.
    if not SES_CONFIG_SET:
        raise RuntimeError(
            "WAITLIST_SES_CONFIG_SET is not set on this function. Sending without a "
            "configuration set delivers mail but emits no bounce or complaint events, "
            "which silently disables email suppression."
        )

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
                    # Only the reversible branch. A terminal skip is done and
                    # its attempt count is history.
                    reset_attempts=not terminal,
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
                # send_raw_email, NOT send_email — and this is the whole reason
                # the RFC 8058 headers exist at all.
                #
                # boto3's SES send_email has NO `Headers` parameter. It accepts
                # Source, Destination, Message, ReplyToAddresses, ReturnPath,
                # SourceArn, ReturnPathArn, Tags, ConfigurationSetName and
                # nothing else. Passing `Headers=` raised ParamValidationError on
                # EVERY send, so not one email could ever leave.
                #
                # The unit tests could not catch it: FakeSES.send_email took
                # **kwargs and recorded whatever it was given, so a parameter
                # that does not exist looked identical to one that does. It took
                # a real SES call to find, which is exactly what the email
                # enforcer is for.
                #
                # Custom headers require a MIME message, so the message is built
                # here rather than handed to SES as separate subject/body fields.
                message = EmailMessage()
                message["Subject"] = subject
                message["From"] = FROM_EMAIL
                message["To"] = job["email"]
                for header in unsubscribe_headers(job):
                    message[header["Name"]] = header["Value"]
                message.set_content(body_text)
                message.add_alternative(body_html, subtype="html")

                ses().send_raw_email(
                    Source=FROM_EMAIL,
                    Destinations=[job["email"]],
                    # Without this, SES emits no bounce or complaint events and
                    # suppression silently stops working. See SES_CONFIG_SET.
                    ConfigurationSetName=SES_CONFIG_SET,
                    RawMessage={"Data": message.as_bytes()},
                )
            except Exception as err:  # noqa: BLE001 — one bad job must not sink the batch
                conn.rollback()
                counts[release_for_retry(conn, job, err, correlation_id)] += 1
                continue

            finish(conn, job["id"], "sent", correlation_id)
            schedule_next_nurture(conn, job, correlation_id)
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
