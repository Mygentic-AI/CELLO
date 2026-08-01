"""
CELLO waitlist priority actions (M11, P1).

  POST /waitlist/survey            DOD-SURVEY-1           +20 structured, +10 free-form
  POST /waitlist/readiness         DOD-READINESS-1        +20
  POST /waitlist/interview-commit  DOD-INTERVIEW-COMMIT-1 +30
  POST /waitlist/post-url          DOD-POST-CREDIT-1      queued for review, no points

Every route requires a valid session cookie. Points are attributed to the
session's user and never to a user id supplied by the caller — accepting one
would let anyone award points to anyone.

Idempotency is enforced by the database (0009's partial unique index), not by
checking first. An application-level "have they already?" is a read-then-write
race: two concurrent submits both read zero and both insert, which is precisely
the double-award each DoD line names.
"""

import json
import os
import uuid
from datetime import datetime, timezone
from urllib.parse import urlparse

import psycopg2

from _dburl import portal_database_url
import psycopg2.extras

from _session import COOKIE_NAME, session_tokens_from, hash_token, may_act, read_session
from _sqlstate import classify

# Kept only so an explicit override still works. The live value is resolved
# lazily by portal_database_url(), because binding the environment variable here
# is exactly what let the 2026-07-27 rotation take the whole waitlist down: the
# password was baked in at deploy time and aged out. See _dburl.py.
DATABASE_URL = os.environ.get("DATABASE_URL")

ALLOWED_ORIGINS = frozenset(
    {"https://cello.mygentic.ai", "https://www.cello.mygentic.ai", "http://localhost:3000"}
)

SURVEY_STRUCTURED_POINTS = 20
SURVEY_FREEFORM_POINTS = 10
READINESS_POINTS = 20
INTERVIEW_COMMIT_POINTS = 30
# Paid once, on opt-in. Uncapped by amount because the once-per-user index in
# 0023 means there is only ever one row.
CONTENT_ALERTS_POINTS = 10

# How long the "your points went up" email waits for the user to stop earning.
# Long enough that a survey → readiness → interview → alerts run in one sitting
# collapses into a single email; short enough that the mail still reads as a
# response to what they just did rather than as unrelated marketing.
POINTS_SUMMARY_QUIET_SECONDS = int(os.environ.get("POINTS_SUMMARY_QUIET_SECONDS", "180"))

MAX_FREEFORM_LEN = 4000
MAX_URL_LEN = 2048

# Host → platform. A URL whose host is not here cannot be attributed, and
# guessing the platform from a URL we do not recognise would put an
# unverifiable row in front of a human reviewer as though it were checked.
PLATFORM_HOSTS = {
    "x.com": "x",
    "www.x.com": "x",
    "twitter.com": "x",
    "www.twitter.com": "x",
    "reddit.com": "reddit",
    "www.reddit.com": "reddit",
    "old.reddit.com": "reddit",
    "linkedin.com": "linkedin",
    "www.linkedin.com": "linkedin",
}


class ActionError(Exception):
    def __init__(self, status, code, message):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


from _logging import emit as log  # noqa: E402 — see _logging.py


def connect():
    if not DATABASE_URL and not os.environ.get("PORTAL_DB_SECRET_ID"):
        raise ActionError(500, "database_url_not_configured", "DATABASE_URL is not set.")
    return psycopg2.connect(DATABASE_URL or portal_database_url(), sslmode=os.environ.get("PGSSLMODE", "require"))


def cors_headers(origin):
    allowed = origin if origin in ALLOWED_ORIGINS else "https://cello.mygentic.ai"
    return {
        "Access-Control-Allow-Origin": allowed,
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Credentials": "true",
        "Vary": "Origin",
        "Content-Type": "application/json",
    }


def resp(status, body, origin):
    return {"statusCode": status, "headers": cors_headers(origin), "body": json.dumps(body)}


def require_session(cur, event):
    session = read_session(cur, session_tokens_from(event))
    if session is None:
        raise ActionError(401, "no_active_session", "Sign in to take this action.")

    if not may_act(session):
        # A live cookie is not a live entitlement. Without this a banned user
        # kept awarding themselves points, because the previous query never
        # joined waitlist_users at all.
        raise ActionError(
            403,
            f"account_{session['status']}",
            "This account cannot take waitlist actions.",
        )

    return session["waitlist_user_id"]


def schedule_points_summary(cur, user_id, correlation_id):
    """Push the 'your points went up' email out to now() + the quiet period.

    A DEBOUNCE, HELD IN THE DATABASE. Working through the status page pays out
    four separate times in about as many minutes; confirming each one by email is
    four emails for what the user experienced as one sitting. So the mail is not
    sent per award — each award resets a countdown, and only silence sends it.

    THE COUNTDOWN CANNOT LIVE IN THE BROWSER. A JavaScript timer dies with the
    tab, and somebody who fills in three sections and then closes the browser is
    exactly who this email is for. `scheduled_at` is already a durable
    server-side timer — claim_jobs only takes rows at or past it — so the
    countdown is just a date, and no new machinery is needed to hold it.

    ONE ROW PER USER, which is what 0027's partial unique index buys. Without it
    four awards enqueue four rows and the debounce has rebuilt the problem it
    exists to solve. The upsert names that index's predicate so Postgres infers
    it rather than the primary key.

    NOT REACHED BY THE REFERRAL BONUS, and that is what keeps the debounce
    bounded. Every reason that flows through award() is once-per-user (0009), so
    the worst case is five resets and then it sends. The referral bonus is the
    one award somebody else can trigger repeatedly; it lives in _referral.py, has
    its own email, and so never touches this countdown.

    Best-effort by design: the points are already committed to the ledger, and a
    failure here must not roll back an award the user has earned over a
    notification about it.
    """
    cur.execute("SAVEPOINT points_summary")
    try:
        cur.execute(
            """
            INSERT INTO email_jobs (user_id, template, scheduled_at)
            VALUES (%s, 'points_summary', now() + make_interval(secs => %s))
            ON CONFLICT (user_id) WHERE template = 'points_summary' AND status = 'pending'
            DO UPDATE SET scheduled_at = now() + make_interval(secs => %s)
            """,
            (user_id, POINTS_SUMMARY_QUIET_SECONDS, POINTS_SUMMARY_QUIET_SECONDS),
        )
        cur.execute("RELEASE SAVEPOINT points_summary")
        log(
            "waitlist.points.summary.scheduled",
            correlation_id,
            waitlistId=str(user_id),
            quietSeconds=POINTS_SUMMARY_QUIET_SECONDS,
        )
    except Exception as err:  # noqa: BLE001 — never lose an award over its notification
        cur.execute("ROLLBACK TO SAVEPOINT points_summary")
        log(
            "waitlist.points.summary.schedule_failed",
            correlation_id,
            level="ERROR",
            waitlistId=str(user_id),
            error=str(err),
        )


def award(cur, user_id, points, reason, meta, correlation_id):
    """Insert a ledger row, tolerating the once-per-user index.

    Returns the points actually awarded. A duplicate is a SUCCESS from the
    caller's point of view — they already have the points — but it awards zero,
    and the response says which so the UI does not animate a second increase.
    """
    cur.execute("SAVEPOINT award")
    try:
        cur.execute(
            "INSERT INTO points_ledger (waitlist_user_id, points, reason, meta) "
            "VALUES (%s, %s, %s, %s)",
            (user_id, points, reason, psycopg2.extras.Json(meta)),
        )
        cur.execute("RELEASE SAVEPOINT award")
        log("waitlist.points.awarded", correlation_id, waitlistId=str(user_id), reason=reason, points=points)
        # Only on a REAL award. A duplicate or a capped award returns before this,
        # so re-clicking something already paid for cannot keep pushing the
        # countdown out and delaying a summary the user has earned.
        schedule_points_summary(cur, user_id, correlation_id)
        return points
    except psycopg2.errors.UniqueViolation:
        cur.execute("ROLLBACK TO SAVEPOINT award")
        log("waitlist.points.already_awarded", correlation_id, waitlistId=str(user_id), reason=reason)
        return 0
    except psycopg2.errors.CheckViolation:
        # The cap trigger. Also a success for the caller — they are simply at
        # their ceiling — but distinguished in the log from a repeat.
        cur.execute("ROLLBACK TO SAVEPOINT award")
        log("waitlist.points.capped", correlation_id, waitlistId=str(user_id), reason=reason)
        return 0


def points_total(cur, user_id):
    cur.execute("SELECT points_total FROM waitlist_users WHERE waitlist_id = %s", (user_id,))
    return cur.fetchone()["points_total"]


# ── Routes ────────────────────────────────────────────────────────────────────


def handle_survey(cur, user_id, body, correlation_id):
    answers = body.get("answers")
    if not isinstance(answers, dict) or not answers:
        raise ActionError(400, "missing_answers", "The survey answers are missing.")

    freeform = (body.get("freeform") or "").strip()[:MAX_FREEFORM_LEN]

    awarded = award(
        cur, user_id, SURVEY_STRUCTURED_POINTS, "survey", {"answers": answers}, correlation_id
    )

    # A REPEAT SUBMISSION IS AN EDIT, NOT A NO-OP. `award` rolls back to its
    # savepoint on the once-per-user index, which used to mean the second set of
    # answers was silently thrown away: the caller got 200, the page said
    # "thank you", and the row still held the FIRST answers. Someone correcting
    # what they told us had no way to know it did not take, and neither did we.
    #
    # `meta || {...}` replaces the answers key and leaves `freeform` alone, so an
    # edit cannot wipe a free-form answer that was paid for separately below.
    # Points are deliberately untouched — the ledger row already exists, and its
    # value is not what changed.
    updated = False
    if awarded == 0:
        cur.execute(
            "UPDATE points_ledger SET meta = meta || %s "
            "WHERE waitlist_user_id = %s AND reason = 'survey'",
            (psycopg2.extras.Json({"answers": answers}), user_id),
        )
        updated = cur.rowcount > 0
        if updated:
            log(
                "waitlist.survey.updated",
                correlation_id,
                waitlistId=str(user_id),
            )

    # The free-form bonus rides on the same ledger row rather than a second
    # reason, because 'survey' is the only reason the enum has for it. Awarding
    # it separately would need a reason the schema does not define, and adding
    # one silently would make the enum mean something different per caller.
    #
    # Gated on the bonus not already being present, NOT on the structured award
    # having just happened. The earlier version used `if freeform and awarded:`,
    # so someone who submitted the structured answers first and came back to
    # finish the free-form got `awarded: 0`, forfeited the 10 points, and — worse
    # — their written answer was never stored at all. That answer is the entire
    # reason the +10 exists. "Completes in one submit" makes the half-filled case
    # reachable by anyone who gets distracted.
    #
    # UPDATE ... WHERE NOT (meta ? 'freeform') is idempotent on its own terms: a
    # repeat matches nothing. points_total is re-derived by the trigger (0016),
    # which also applies the cap to UPDATEs.
    if freeform:
        cur.execute(
            "UPDATE points_ledger SET points = points + %s, meta = meta || %s "
            "WHERE waitlist_user_id = %s AND reason = 'survey' AND NOT (meta ? 'freeform')",
            (SURVEY_FREEFORM_POINTS, psycopg2.extras.Json({"freeform": freeform}), user_id),
        )
        if cur.rowcount:
            awarded += SURVEY_FREEFORM_POINTS
            log(
                "waitlist.points.awarded",
                correlation_id,
                waitlistId=str(user_id),
                reason="survey_freeform",
                points=SURVEY_FREEFORM_POINTS,
            )
        else:
            # The bonus is already paid, so this is an edit of the text itself.
            # Matched on `meta ? 'freeform'` — the exact complement of the clause
            # above — so the two are mutually exclusive and no path can pay twice.
            cur.execute(
                "UPDATE points_ledger SET meta = meta || %s "
                "WHERE waitlist_user_id = %s AND reason = 'survey' AND meta ? 'freeform'",
                (psycopg2.extras.Json({"freeform": freeform}), user_id),
            )
            updated = updated or cur.rowcount > 0

    # An EMPTY freeform on an edit deliberately does nothing rather than clearing
    # what is stored. The +10 has already been paid for that answer and cannot be
    # unpaid, so blanking the text would leave points backed by nothing — and the
    # far likelier cause is a form that submitted without the field than someone
    # deciding to retract what they wrote.

    return {"awarded": awarded, "updated": updated, "points_total": points_total(cur, user_id)}


def handle_readiness(cur, user_id, body, correlation_id):
    awarded = award(cur, user_id, READINESS_POINTS, "technical_readiness", {}, correlation_id)
    return {"awarded": awarded, "points_total": points_total(cur, user_id)}


def handle_interview_commit(cur, user_id, body, correlation_id):
    awarded = award(
        cur,
        user_id,
        INTERVIEW_COMMIT_POINTS,
        "interview_commit",
        {"committed_at": datetime.now(timezone.utc).isoformat()},
        correlation_id,
    )
    return {"awarded": awarded, "points_total": points_total(cur, user_id)}


def handle_post_url(cur, user_id, body, correlation_id):
    url = (body.get("post_url") or "").strip()[:MAX_URL_LEN]
    if not url:
        raise ActionError(400, "missing_post_url", "A post URL is required.")

    try:
        parsed = urlparse(url)
    except ValueError as err:
        raise ActionError(400, "invalid_post_url", f"That URL could not be parsed: {err}")

    if parsed.scheme not in ("http", "https"):
        raise ActionError(400, "invalid_post_url", "The URL must start with http or https.")

    platform = PLATFORM_HOSTS.get((parsed.hostname or "").lower())
    if platform is None:
        # REFUSE rather than guess. A row with an unattributable platform lands
        # in front of a human reviewer looking exactly as checked as a real one.
        raise ActionError(
            400,
            "unsupported_platform",
            f"Posts are accepted from X, Reddit and LinkedIn. {parsed.hostname or 'that host'} is not one of them.",
        )

    # Handle ownership is the only thing tying a post to a person, so whether the
    # submitter proved it MATTERS — but it is recorded, not required.
    #
    # Requiring it would refuse every submission, because DOD-OAUTH-SOCIAL-1 is
    # parked on external app registration and nothing can create a profile row
    # yet. Refusing is right for an input that is missing or hostile; it is wrong
    # for one that is not there YET, because it makes a parked integration a hard
    # precondition for an unrelated path.
    #
    # M11-D4 already puts a human in the loop for every submission. This hands
    # them the fact rather than deciding on their behalf.
    cur.execute(
        "SELECT 1 FROM waitlist_social_profiles WHERE waitlist_user_id = %s AND platform = %s",
        (user_id, platform),
    )
    handle_verified = cur.fetchone() is not None

    cur.execute("SAVEPOINT submit")
    try:
        cur.execute(
            "INSERT INTO post_review_queue (waitlist_user_id, platform, post_url, handle_verified) "
            "VALUES (%s, %s, %s, %s)",
            (user_id, platform, url, handle_verified),
        )
        cur.execute("RELEASE SAVEPOINT submit")
    except psycopg2.errors.UniqueViolation:
        cur.execute("ROLLBACK TO SAVEPOINT submit")
        raise ActionError(409, "already_submitted", "You have already submitted that post.")

    log(
        "waitlist.post.submitted",
        correlation_id,
        waitlistId=str(user_id),
        platform=platform,
        handleVerified=handle_verified,
    )
    # No points here. M11-D4: credit is applied on ops approval only.
    return {
        "submitted": True,
        "platform": platform,
        "awarded": 0,
        # Returned so the UI can tell the submitter their post needs manual
        # authorship confirmation, rather than letting them assume it is queued
        # on equal footing with a verified one.
        "handle_verified": handle_verified,
    }


def handle_content_alerts(cur, user_id, body, correlation_id):
    """DOD-CONTENT-ALERTS-1. Opt in or out of the content-alert segment.

    Explicitly boolean, not a toggle: a toggle read of a stale page flips the
    user to the opposite of what they clicked. And this touches ONLY
    content_alerts — unsubscribing from blog posts must never drop someone from
    their waitlist mail, which is DOD-INV-EMAIL-SEGMENTS from the user's side.
    """
    enabled = body.get("enabled")
    if not isinstance(enabled, bool):
        raise ActionError(
            400, "missing_enabled", "enabled must be true or false — a toggle would guess."
        )

    cur.execute(
        "UPDATE waitlist_users SET content_alerts = %s WHERE waitlist_id = %s RETURNING content_alerts",
        (enabled, user_id),
    )
    stored = cur.fetchone()["content_alerts"]
    log(
        "waitlist.content_alerts.set",
        correlation_id,
        waitlistId=str(user_id),
        enabled=enabled,
    )

    # THE CREDIT FOLLOWS THE SUBSCRIPTION, IN BOTH DIRECTIONS. Opting in pays;
    # opting out takes it back. This REVERSES 0023, which kept the points on
    # opt-out, and the reason for the reversal is that keeping them is simply
    # wrong: the ten points are payment for accepting up to two emails a day, so
    # somebody who has stopped accepting them is holding a rank they are no
    # longer paying for. Re-opting pays again, which makes the toggle honest in
    # both directions rather than a one-way door dressed up as a checkbox.
    #
    # A DELETE, NOT A COMPENSATING NEGATIVE ROW, and 0023's objections to it do
    # not survive contact with the schema:
    #
    #   - "the cap triggers assume rows are never removed" — the cap function
    #     caps only share_conversion and public_post; for content_alerts it
    #     returns before doing anything. It also recomputes SUM(points) from the
    #     table on every insert, so it reads removals correctly regardless.
    #   - "the ledger is append-only" — nothing enforces that. There is no rule
    #     and no policy forbidding DELETE, and points_ledger_sync_trigger is
    #     declared AFTER INSERT OR DELETE OR UPDATE, so a removal already
    #     maintains points_total. Deletion was anticipated by the design.
    #
    # FARMING IS STILL IMPOSSIBLE, and now by construction rather than by the
    # index alone: a user has either one content_alerts row or none, so the net
    # is 0 or 10 no matter how many times the box is clicked. Deleting the row
    # also frees the once-per-user index, which is what lets a re-opt pay again.
    awarded = 0
    removed = 0
    if enabled:
        awarded = award(
            cur, user_id, CONTENT_ALERTS_POINTS, "content_alerts", {}, correlation_id
        )
    else:
        cur.execute(
            "DELETE FROM points_ledger WHERE waitlist_user_id = %s AND reason = 'content_alerts' "
            "RETURNING points",
            (user_id,),
        )
        reversed_rows = cur.fetchall()
        removed = sum(row["points"] for row in reversed_rows)
        if removed:
            log(
                "waitlist.points.reversed",
                correlation_id,
                waitlistId=str(user_id),
                reason="content_alerts",
                points=removed,
            )
            # Tell them, once, in the same beat as the unsubscribe. Silently
            # removing rank would be the version of this that feels punitive.
            _enqueue_opt_out_notice(cur, user_id, correlation_id)

    return {
        "content_alerts": stored,
        "awarded": awarded,
        # Positive number of points taken back, so the UI can say so outright
        # rather than inferring it from a total that moved.
        "removed": removed,
        "points_total": points_total(cur, user_id),
    }


def _enqueue_opt_out_notice(cur, user_id, correlation_id):
    """Confirm the unsubscribe, and say the waitlist place is untouched.

    The anxious reading of "your points were removed" is that unsubscribing cost
    you your spot. It did not — content_alerts is one segment, and the waitlist
    mail is a different one (DOD-INV-EMAIL-SEGMENTS) — but that is only obvious
    to somebody who knows the schema. So the mail exists to say the quiet part.

    Sent NOW rather than through the points-summary debounce: this one is a
    direct consequence of a click the user just made, and folding a subscription
    change into a delayed points digest would bury it.

    Best-effort behind a SAVEPOINT — the unsubscribe itself is already committed
    and must not be undone because its confirmation could not be queued.
    """
    cur.execute("SAVEPOINT alerts_opt_out_notice")
    try:
        cur.execute(
            "INSERT INTO email_jobs (user_id, template, scheduled_at) "
            "VALUES (%s, 'alerts_opt_out', now())",
            (user_id,),
        )
        cur.execute("RELEASE SAVEPOINT alerts_opt_out_notice")
    except Exception as err:  # noqa: BLE001 — never undo an unsubscribe over its receipt
        cur.execute("ROLLBACK TO SAVEPOINT alerts_opt_out_notice")
        log(
            "waitlist.content_alerts.notice_failed",
            correlation_id,
            level="ERROR",
            waitlistId=str(user_id),
            error=str(err),
        )


ROUTES = {
    "/waitlist/content-alerts": handle_content_alerts,
    "/waitlist/survey": handle_survey,
    "/waitlist/readiness": handle_readiness,
    "/waitlist/interview-commit": handle_interview_commit,
    "/waitlist/post-url": handle_post_url,
}


def lambda_handler(event, context):
    correlation_id = getattr(context, "aws_request_id", None) or str(uuid.uuid4())
    headers = event.get("headers") or {}
    origin = headers.get("origin") or headers.get("Origin") or ""
    http = (event.get("requestContext") or {}).get("http") or {}
    method = http.get("method", "")
    path = http.get("path", "")

    if method == "OPTIONS":
        return {"statusCode": 204, "headers": cors_headers(origin), "body": ""}

    route = next((fn for suffix, fn in ROUTES.items() if path.endswith(suffix)), None)
    if method != "POST" or route is None:
        return resp(404, {"error": "not_found", "message": f"No route for {method} {path}."}, origin)

    try:
        try:
            body = json.loads(event.get("body") or "{}")
        except (json.JSONDecodeError, TypeError) as err:
            raise ActionError(400, "invalid_json", f"Request body is not valid JSON: {err}")

        conn = connect()
        try:
            conn.autocommit = False
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                user_id = require_session(cur, event)
                result = route(cur, user_id, body, correlation_id)
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

        return resp(200, result, origin)

    except ActionError as err:
        log(
            "waitlist.action.rejected",
            correlation_id,
            level="WARN" if err.status < 500 else "ERROR",
            code=err.code,
            status=err.status,
            path=path,
        )
        return resp(err.status, {"error": err.code, "message": err.message}, origin)

    except psycopg2.Error as err:
        log(
            "waitlist.action.failed",
            correlation_id,
            level="ERROR",
            pgcode=err.pgcode,
            detail=str(err).strip(),
        )
        status, code, message = classify(err)
        return resp(status, {"error": code, "message": message}, origin)
