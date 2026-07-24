"""
CELLO waitlist signup Lambda (M11, DOD-SIGNUP-1).

Behind the existing API Gateway that already fronts cello-web-form-handler.
This is a SEPARATE function: the form handler is live and serving the current
site, and waitlist work must not be able to break it.

Why a Lambda and not a Next.js route (M11-D20): corp-cello-site is built with
`output: 'export'` and deployed by rsyncing `out/` to Lightsail. A static export
drops route handlers silently — the build exits 0 and the endpoint simply is not
in the artifact.

Routes:
  OPTIONS *                  → CORS preflight
  POST    /waitlist/signup   → create a waitlist user

Observability: every event is one JSON line on stdout with a correlationId
threaded through the request, per the M4+ logging rules. Event names follow
domain.noun.verb.
"""

import json
import os
import re
import secrets
import uuid
from datetime import datetime, timezone

import psycopg2
import psycopg2.extras

# ── Configuration ─────────────────────────────────────────────────────────────
# ABSENT IS NOT FINE. A missing DATABASE_URL must stop the function, not fall
# through to libpq's defaults — which would silently connect to *something else*
# (PGHOST, or localhost as the OS user) and surface as a generic connection
# error pointing at the wrong subsystem.
DATABASE_URL = os.environ.get("DATABASE_URL")

ALLOWED_ORIGINS = frozenset(
    {
        "https://cello.mygentic.ai",
        "https://www.cello.mygentic.ai",
        "http://localhost:3000",
    }
)

MAX_TOUCHPOINTS = 20
MAX_URL_LEN = 2048
MAX_SHORT_LEN = 128
MAX_EMAIL_LEN = 254  # RFC 5321 maximum forward-path length.
MAX_DISPLAY_NAME_LEN = 100
REFERRAL_POINTS = 10
MAX_CODE_ATTEMPTS = 10

# Deliberately permissive: this is a shape check to reject obvious junk before it
# reaches the database and before an E1 job is queued against an unreachable
# address. Deliverability is proven by the confirmation click, not by a regex.
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s.]+\.[^@\s]+$")

TOUCHPOINT_FIELDS = (
    ("url", MAX_URL_LEN),
    ("referrer", MAX_URL_LEN),
    ("utm_source", MAX_SHORT_LEN),
    ("utm_medium", MAX_SHORT_LEN),
    ("utm_campaign", MAX_SHORT_LEN),
    ("utm_content", MAX_SHORT_LEN),
    ("utm_term", MAX_SHORT_LEN),
    ("ref", MAX_SHORT_LEN),
)


class SignupError(Exception):
    """A client-visible failure that names its cause, not its exit point."""

    def __init__(self, status, code, message):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


# ── Logging ───────────────────────────────────────────────────────────────────


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


# ── HTTP plumbing ─────────────────────────────────────────────────────────────


def cors_headers(origin):
    # Not "*": this endpoint is state-changing, so the allowed origin is echoed
    # only when it is one we know. An unknown origin gets the canonical site,
    # which the browser will then refuse — the correct outcome.
    allowed = origin if origin in ALLOWED_ORIGINS else "https://cello.mygentic.ai"
    return {
        "Access-Control-Allow-Origin": allowed,
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Vary": "Origin",
        "Content-Type": "application/json",
    }


def resp(status, body, origin, correlation_id=None):
    if correlation_id:
        body = {**body, "correlationId": correlation_id}
    return {"statusCode": status, "headers": cors_headers(origin), "body": json.dumps(body)}


# ── Validation ────────────────────────────────────────────────────────────────


def clean(value, limit):
    """Trim to a string of at most `limit` chars, or None. Never raises."""
    if value is None or not isinstance(value, str):
        return None
    trimmed = value.strip()
    return trimmed[:limit] if trimmed else None


def validate_signup(body):
    """Returns (email, anon_id, display_name, touchpoints, first_touch_override).

    Every rejection here names the specific field that failed. A caller who gets
    `invalid_email` knows what to fix; one who gets `bad_request` does not.
    """
    if not isinstance(body, dict):
        raise SignupError(400, "invalid_body", "Request body must be a JSON object.")

    email = clean(body.get("email"), MAX_EMAIL_LEN)
    if not email:
        raise SignupError(400, "missing_email", "An email address is required.")
    email = email.lower()
    if not EMAIL_RE.match(email):
        raise SignupError(400, "invalid_email", "That does not look like an email address.")

    anon_raw = clean(body.get("anon_id"), MAX_SHORT_LEN)
    if not anon_raw:
        raise SignupError(400, "missing_anon_id", "anon_id is required.")
    try:
        anon_id = str(uuid.UUID(anon_raw))
    except (ValueError, AttributeError, TypeError):
        raise SignupError(400, "invalid_anon_id", "anon_id must be a UUID.")

    display_name = clean(body.get("display_name") or body.get("name"), MAX_DISPLAY_NAME_LEN)

    raw_touchpoints = body.get("touchpoints", [])
    if raw_touchpoints is None:
        raw_touchpoints = []
    if not isinstance(raw_touchpoints, list):
        raise SignupError(400, "invalid_touchpoints", "touchpoints must be an array.")

    # Cap server-side. The browser also caps at 20, but the browser is not a
    # control — this endpoint is public and the array lands in a single INSERT,
    # where an unbounded list runs into Postgres's 65,535 bind-parameter limit
    # and becomes a trivially reachable 500.
    touchpoints = []
    for entry in raw_touchpoints[-MAX_TOUCHPOINTS:]:
        if not isinstance(entry, dict):
            continue
        tp = {name: clean(entry.get(name), limit) for name, limit in TOUCHPOINT_FIELDS}
        tp["ts"] = parse_ts(entry.get("ts"))
        touchpoints.append(tp)

    first_touch_override = None
    raw_first = body.get("first_touch")
    if isinstance(raw_first, dict):
        first_touch_override = {
            name: clean(raw_first.get(name), limit) for name, limit in TOUCHPOINT_FIELDS
        }

    return email, anon_id, display_name, touchpoints, first_touch_override


def parse_ts(raw):
    if not isinstance(raw, str):
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None


# ── Referral code generation ──────────────────────────────────────────────────


def generate_code(cur, correlation_id):
    """8 bytes of entropy, not 4.

    A share code is a public identifier, but a premium code minted by the same
    generator is a bearer capability that skips the queue. 2**32 is guessable at
    the rate an unthrottled public endpoint allows; 2**64 is not.
    """
    for _ in range(MAX_CODE_ATTEMPTS):
        code = secrets.token_urlsafe(8)[:11].upper()
        cur.execute("SELECT 1 FROM referral_codes WHERE code = %s", (code,))
        if cur.fetchone() is None:
            return code
    raise SignupError(
        503,
        "code_generation_exhausted",
        f"Could not mint an unused referral code in {MAX_CODE_ATTEMPTS} attempts.",
    )


# ── Referral attribution ──────────────────────────────────────────────────────


def latest_ref(touchpoints):
    """Last-touch wins: the most recent ref a visitor arrived under is the one
    that gets the credit."""
    for tp in reversed(touchpoints):
        if tp.get("ref"):
            return tp["ref"]
    return None


def apply_referral(cur, code, new_user_id, correlation_id):
    """Attribute a signup to a share code, a premium code, or a creator code.

    Returns a dict describing what was applied. Raises only on genuinely
    unexpected failures — a referrer at their points cap, or an already-burned
    premium code, are ordinary outcomes that must not cost the NEW user their
    signup.
    """
    # FOR UPDATE, not a bare SELECT. Two people redeeming the same premium code
    # concurrently must serialise here; otherwise both read active=true, both
    # proceed, and the code admits twice. The row lock is what makes the burn
    # below single-use rather than merely usually-single-use.
    cur.execute(
        """
        SELECT code, owner_waitlist_user_id, creator_handle, type, active
        FROM referral_codes
        WHERE code = %s
        FOR UPDATE
        """,
        (code,),
    )
    row = cur.fetchone()

    if row is None:
        log("waitlist.referral.unknown_code", correlation_id, code=code)
        return {"applied": False, "reason": "unknown_code"}

    if not row["active"]:
        log("waitlist.referral.code_already_used", correlation_id, code=code)
        return {"applied": False, "reason": "code_already_used"}

    # ── Creator code: attribution only, no points, no admission ──
    if row["creator_handle"]:
        cur.execute(
            """
            INSERT INTO creator_tracking (creator_handle, event_type, session_id)
            VALUES (%s, 'signup', %s)
            """,
            (row["creator_handle"], str(new_user_id)),
        )
        cur.execute(
            "UPDATE waitlist_users SET referred_by_code = %s WHERE waitlist_id = %s",
            (code, new_user_id),
        )
        log(
            "waitlist.referral.creator_attributed",
            correlation_id,
            code=code,
            creatorHandle=row["creator_handle"],
        )
        return {"applied": True, "kind": "creator", "creator_handle": row["creator_handle"]}

    owner_id = row["owner_waitlist_user_id"]
    if owner_id is None:
        # The one_owner_or_creator CHECK makes this unreachable. If it ever
        # fires, the schema invariant has been violated and guessing is worse
        # than refusing.
        raise SignupError(
            500,
            "referral_code_malformed",
            f"Referral code {code} has neither an owner nor a creator handle.",
        )

    if owner_id == new_user_id:
        log("waitlist.referral.self_referral_rejected", correlation_id, code=code)
        return {"applied": False, "reason": "self_referral"}

    cur.execute(
        """
        INSERT INTO referrals (referrer_user_id, referred_user_id, referral_code)
        VALUES (%s, %s, %s)
        ON CONFLICT (referred_user_id) DO NOTHING
        """,
        (owner_id, new_user_id, code),
    )
    cur.execute(
        "UPDATE waitlist_users SET referred_by_code = %s WHERE waitlist_id = %s",
        (code, new_user_id),
    )

    # The referrer's +10. A referrer who has already earned their 30-point cap is
    # an ordinary, expected outcome — the cap trigger raises, and that must not
    # take down the new user's signup with it. SAVEPOINT scopes the failure to
    # this statement; without it Postgres aborts the whole transaction and every
    # later statement dies with 25P02.
    points_awarded = 0
    cur.execute("SAVEPOINT referral_points")
    try:
        cur.execute(
            """
            INSERT INTO points_ledger (waitlist_user_id, points, reason, meta)
            VALUES (%s, %s, 'share_conversion', %s)
            """,
            (
                owner_id,
                REFERRAL_POINTS,
                psycopg2.extras.Json({"referred_user_id": str(new_user_id), "code": code}),
            ),
        )
        cur.execute("RELEASE SAVEPOINT referral_points")
        points_awarded = REFERRAL_POINTS
    except psycopg2.errors.CheckViolation as err:
        cur.execute("ROLLBACK TO SAVEPOINT referral_points")
        # The cause survives into the log. "check violation" alone would send an
        # operator hunting a schema bug rather than reading a working cap.
        log(
            "waitlist.referral.points_capped",
            correlation_id,
            level="WARN",
            code=code,
            referrerId=str(owner_id),
            detail=str(err).strip(),
        )

    is_premium = row["type"] == "premium"
    if is_premium:
        # Burn it. Bearer semantics (M11-D12): the code is consumed by the first
        # COMPLETED signup and never again. This UPDATE is the single-use
        # mechanism — the FOR UPDATE above is what makes it race-free, and it
        # commits with the rest of the transaction, so a signup that fails later
        # leaves the code live for the inviter to reuse.
        cur.execute(
            "UPDATE referral_codes SET active = false WHERE code = %s AND active",
            (code,),
        )
        if cur.rowcount != 1:
            raise SignupError(
                409,
                "premium_code_already_used",
                "That invite code has already been used.",
            )
        cur.execute(
            """
            UPDATE waitlist_users
            SET premium_referred = true, status = 'admitted', admitted_at = now()
            WHERE waitlist_id = %s
            """,
            (new_user_id,),
        )
        log("waitlist.referral.premium_burned", correlation_id, code=code)

    log(
        "waitlist.referral.applied",
        correlation_id,
        code=code,
        kind="premium" if is_premium else "share",
        pointsAwarded=points_awarded,
    )
    return {
        "applied": True,
        "kind": "premium" if is_premium else "share",
        "points_awarded": points_awarded,
    }


# ── Signup ────────────────────────────────────────────────────────────────────


def handle_signup(body, origin, correlation_id):
    email, anon_id, display_name, touchpoints, first_touch_override = validate_signup(body)

    first = first_touch_override or (touchpoints[0] if touchpoints else {})
    last = touchpoints[-1] if touchpoints else {}

    conn = connect()
    try:
        conn.autocommit = False
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                INSERT INTO waitlist_users
                    (email, anon_id, display_name,
                     first_touch_source, first_touch_ref,
                     last_touch_source, last_touch_ref, touchpoints_json)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (email) DO NOTHING
                RETURNING waitlist_id
                """,
                (
                    email,
                    anon_id,
                    display_name,
                    first.get("utm_source"),
                    first.get("ref"),
                    last.get("utm_source"),
                    last.get("ref"),
                    psycopg2.extras.Json(touchpoints, dumps=json_dumps),
                ),
            )
            row = cur.fetchone()
            if row is None:
                conn.rollback()
                log("waitlist.signup.duplicate", correlation_id)
                raise SignupError(
                    409, "email_already_registered", "That email is already on the waitlist."
                )

            user_id = row["waitlist_id"]

            if touchpoints:
                psycopg2.extras.execute_values(
                    cur,
                    """
                    INSERT INTO waitlist_touchpoints
                        (waitlist_user_id, anon_id, ts, url, referrer,
                         utm_source, utm_medium, utm_campaign, utm_content, utm_term, ref)
                    VALUES %s
                    """,
                    [
                        (
                            user_id,
                            anon_id,
                            tp["ts"] or datetime.now(timezone.utc),
                            tp["url"],
                            tp["referrer"],
                            tp["utm_source"],
                            tp["utm_medium"],
                            tp["utm_campaign"],
                            tp["utm_content"],
                            tp["utm_term"],
                            tp["ref"],
                        )
                        for tp in touchpoints
                    ],
                )

            own_code = generate_code(cur, correlation_id)
            cur.execute(
                """
                INSERT INTO referral_codes (code, owner_waitlist_user_id, creator_handle, type)
                VALUES (%s, %s, NULL, 'share')
                """,
                (own_code, user_id),
            )

            referral = {"applied": False}
            inbound = clean(body.get("invite_code"), MAX_SHORT_LEN) or latest_ref(touchpoints)
            if inbound:
                referral = apply_referral(cur, inbound.upper(), user_id, correlation_id)

            cur.execute(
                """
                INSERT INTO email_jobs (user_id, template, scheduled_at)
                VALUES (%s, 'e1_confirm', now())
                """,
                (user_id,),
            )

        conn.commit()
        log(
            "waitlist.signup.succeeded",
            correlation_id,
            waitlistId=str(user_id),
            touchpointCount=len(touchpoints),
            referralApplied=referral.get("applied", False),
        )
        # The code is returned because the success screen shows it. A generated
        # value with no reader is a value nobody can prove is correct.
        # The referral outcome is returned, not just logged. A spent invite code
        # must not silently downgrade someone to the slow door with the UI still
        # implying they skipped the queue — the caller is told, and the success
        # screen says so.
        return resp(
            200,
            {
                "success": True,
                "waitlist_id": str(user_id),
                "referral_code": own_code,
                "referral": referral,
            },
            origin,
            correlation_id,
        )
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def json_dumps(value):
    return json.dumps(value, default=str)


def connect():
    if not DATABASE_URL:
        raise SignupError(
            500,
            "database_url_not_configured",
            "DATABASE_URL is not set on this function.",
        )
    # RDS enforces rds.force_ssl. Without this the connection is refused and the
    # failure reads as a generic connection error.
    return psycopg2.connect(DATABASE_URL, sslmode=os.environ.get("PGSSLMODE", "require"))


# ── Entry point ───────────────────────────────────────────────────────────────


def lambda_handler(event, context):
    correlation_id = getattr(context, "aws_request_id", None) or str(uuid.uuid4())
    headers = event.get("headers") or {}
    origin = headers.get("origin") or headers.get("Origin") or ""
    http = (event.get("requestContext") or {}).get("http") or {}
    method = http.get("method", "")
    path = http.get("path", "")

    if method == "OPTIONS":
        return {"statusCode": 204, "headers": cors_headers(origin), "body": ""}

    if method != "POST" or not path.endswith("/waitlist/signup"):
        return resp(404, {"error": "not_found", "message": f"No route for {method} {path}."}, origin)

    try:
        raw = event.get("body") or "{}"
        try:
            body = json.loads(raw)
        except (json.JSONDecodeError, TypeError) as err:
            # A malformed body is a CLIENT error. Returning 500 here sends the
            # on-call engineer to look at the service.
            raise SignupError(400, "invalid_json", f"Request body is not valid JSON: {err}")

        return handle_signup(body, origin, correlation_id)

    except SignupError as err:
        log(
            "waitlist.signup.rejected",
            correlation_id,
            level="WARN" if err.status < 500 else "ERROR",
            code=err.code,
            status=err.status,
            detail=err.message,
        )
        return resp(err.status, {"error": err.code, "message": err.message}, origin, correlation_id)

    except psycopg2.Error as err:
        # Database faults keep their SQLSTATE. "Internal server error" alone
        # names the exit point and discards the only thing that identifies the
        # subsystem at fault.
        log(
            "waitlist.signup.failed",
            correlation_id,
            level="ERROR",
            pgcode=err.pgcode,
            detail=str(err).strip(),
        )
        return resp(
            503,
            {
                "error": "database_unavailable",
                "message": "The waitlist database could not be reached. Please try again.",
                "pgcode": err.pgcode,
            },
            origin,
            correlation_id,
        )

    except Exception as err:  # noqa: BLE001 — the boundary must not leak a stack trace
        log(
            "waitlist.signup.failed",
            correlation_id,
            level="ERROR",
            errorType=type(err).__name__,
            detail=str(err).strip(),
        )
        return resp(
            500,
            {
                "error": "internal_error",
                "message": f"Unexpected {type(err).__name__}. Quote the correlationId when reporting this.",
            },
            origin,
            correlation_id,
        )
