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

from _session import COOKIE_NAME, cookie_from, hash_token, may_act, read_session
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


def require_session(cur, headers):
    session = read_session(cur, cookie_from(headers))
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

    return {"awarded": awarded, "points_total": points_total(cur, user_id)}


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
    log(
        "waitlist.content_alerts.set",
        correlation_id,
        waitlistId=str(user_id),
        enabled=enabled,
    )
    return {"content_alerts": cur.fetchone()["content_alerts"]}


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
                user_id = require_session(cur, headers)
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
