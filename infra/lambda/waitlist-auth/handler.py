"""
CELLO waitlist auth Lambda (M11, DOD-AUTH-1).

Three routes behind the API Gateway:

  POST /waitlist/auth/request  — ask for a magic link
  GET  /waitlist/auth/verify   — burn a token, mint a session, redirect to /status
  GET  /waitlist/auth/session  — who am I (the status page's only auth call)

DOD-INV-NO-ENUMERATION is the hard requirement here: /auth must never reveal
whether an address is on the waitlist. That means identical response body,
identical status, identical headers AND indistinguishable timing between the
known and unknown cases. The timing half is the one that is usually missed —
sending an email and writing a row takes measurably longer than doing nothing,
so an attacker with a stopwatch enumerates the list at their leisure while every
visible response says the same thing.

Handled by doing the work behind a fixed floor: both paths return no earlier
than RESPONSE_FLOOR_MS after the request began.
"""

import hashlib
import json
import os
import secrets
import time
import uuid
from datetime import datetime, timezone

import psycopg2
import psycopg2.extras

DATABASE_URL = os.environ.get("DATABASE_URL")
SITE = os.environ.get("WAITLIST_SITE", "https://cello.mygentic.ai")
COOKIE_NAME = "cello_wl_session"
SESSION_DAYS = 30

# Every /auth response waits until this many milliseconds have elapsed. It must
# exceed the slowest known-address path (a row insert plus an email enqueue) or
# the floor does not actually flatten anything.
RESPONSE_FLOOR_MS = int(os.environ.get("AUTH_RESPONSE_FLOOR_MS", "400"))

# Per address, per window. Counted on the address REQUESTED regardless of whether
# it exists, so the throttle itself cannot be used to probe.
RATE_LIMIT_MAX = int(os.environ.get("AUTH_RATE_LIMIT_MAX", "5"))
RATE_LIMIT_WINDOW_MINUTES = int(os.environ.get("AUTH_RATE_LIMIT_WINDOW_MINUTES", "15"))

ALLOWED_ORIGINS = frozenset(
    {"https://cello.mygentic.ai", "https://www.cello.mygentic.ai", "http://localhost:3000"}
)

# The one response /auth ever gives. Identical for every address.
OPAQUE_RESPONSE = {
    "status": "check_your_inbox",
    "message": "Check your inbox — if that address is on the waitlist, a sign-in link is on its way.",
}


class AuthError(Exception):
    def __init__(self, status, code, message):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


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
        raise AuthError(500, "database_url_not_configured", "DATABASE_URL is not set.")
    return psycopg2.connect(DATABASE_URL, sslmode=os.environ.get("PGSSLMODE", "require"))


def hash_token(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def cors_headers(origin):
    allowed = origin if origin in ALLOWED_ORIGINS else "https://cello.mygentic.ai"
    return {
        "Access-Control-Allow-Origin": allowed,
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Credentials": "true",
        "Vary": "Origin",
        "Content-Type": "application/json",
    }


def resp(status, body, origin, extra_headers=None):
    headers = cors_headers(origin)
    if extra_headers:
        headers.update(extra_headers)
    return {"statusCode": status, "headers": headers, "body": json.dumps(body)}


# ── Sessions ──────────────────────────────────────────────────────────────────


def mint_session(cur, user_id):
    """Returns (raw_token, expires_at). Only the hash is stored.

    A database dump must not hand out live sessions.
    """
    raw = secrets.token_urlsafe(32)
    cur.execute(
        """
        INSERT INTO waitlist_sessions (waitlist_user_id, token_hash, expires_at)
        VALUES (%s, %s, now() + interval '%s days')
        RETURNING expires_at
        """
        % ("%s", "%s", SESSION_DAYS),
        (user_id, hash_token(raw)),
    )
    return raw, cur.fetchone()["expires_at"]


def session_cookie(raw_token):
    # HttpOnly so script cannot read it; Secure so it never crosses plaintext;
    # SameSite=Lax so a cross-site POST cannot ride it, while a link from an
    # email still arrives authenticated.
    return (
        f"{COOKIE_NAME}={raw_token}; Max-Age={SESSION_DAYS * 24 * 3600}; "
        f"Path=/; HttpOnly; Secure; SameSite=Lax"
    )


def read_session(cur, raw_token):
    if not raw_token:
        return None
    cur.execute(
        """
        SELECT s.waitlist_user_id, u.email, u.display_name, u.email_verified, u.status
        FROM waitlist_sessions s
        JOIN waitlist_users u ON u.waitlist_id = s.waitlist_user_id
        WHERE s.token_hash = %s
          AND s.revoked_at IS NULL
          AND s.expires_at > now()
        """,
        (hash_token(raw_token),),
    )
    return cur.fetchone()


def cookie_from(headers):
    raw = headers.get("cookie") or headers.get("Cookie") or ""
    for part in raw.split(";"):
        name, _, value = part.strip().partition("=")
        if name == COOKIE_NAME:
            return value
    return None


# ── POST /waitlist/auth/request ───────────────────────────────────────────────


def rate_limited(cur, email):
    cur.execute(
        """
        SELECT count(*) AS n FROM auth_link_requests
        WHERE lower(email_requested) = lower(%s)
          AND requested_at > now() - interval '%s minutes'
        """
        % ("%s", RATE_LIMIT_WINDOW_MINUTES),
        (email,),
    )
    return cur.fetchone()["n"] >= RATE_LIMIT_MAX


def handle_request_link(body, origin, correlation_id):
    started = time.monotonic()
    email = (body.get("email") or "").strip().lower()

    # Even a malformed address gets the opaque response. Returning a validation
    # error for "not-an-email" but the opaque one for "real@example.com" is a
    # weaker oracle, but it is still an oracle.
    if email:
        conn = connect()
        try:
            conn.autocommit = False
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                # Count PRIOR requests, then record this one. Inserting first
                # makes the current request count against itself, so a limit of
                # N issues only N-1 links.
                throttled = rate_limited(cur, email)
                cur.execute(
                    "INSERT INTO auth_link_requests (email_requested) VALUES (%s)", (email,)
                )

                cur.execute(
                    "SELECT waitlist_id, email_status FROM waitlist_users WHERE lower(email) = %s",
                    (email,),
                )
                user = cur.fetchone()

                if user and not throttled and user["email_status"] == "active":
                    cur.execute(
                        """
                        INSERT INTO auth_tokens (waitlist_user_id, kind, expires_at)
                        VALUES (%s, 'magic_link', now() + interval '15 minutes')
                        RETURNING token
                        """,
                        (user["waitlist_id"],),
                    )
                    token = cur.fetchone()["token"]
                    cur.execute(
                        """
                        INSERT INTO email_jobs (user_id, template, scheduled_at)
                        VALUES (%s, 'e_magic_link', now())
                        """,
                        (user["waitlist_id"],),
                    )
                    log(
                        "waitlist.auth.link.issued",
                        correlation_id,
                        waitlistId=str(user["waitlist_id"]),
                        tokenId=str(token),
                    )
                else:
                    # Logged, never surfaced. The operator can see what happened;
                    # the caller cannot.
                    log(
                        "waitlist.auth.link.withheld",
                        correlation_id,
                        reason=(
                            "rate_limited" if throttled
                            else "unknown_address" if not user
                            else f"email_status_{user['email_status']}"
                        ),
                    )
            conn.commit()
        finally:
            conn.close()

    # The timing floor. Without it the known path is measurably slower than the
    # unknown one and the identical body means nothing.
    elapsed_ms = (time.monotonic() - started) * 1000
    if elapsed_ms < RESPONSE_FLOOR_MS:
        time.sleep((RESPONSE_FLOOR_MS - elapsed_ms) / 1000)

    return resp(200, OPAQUE_RESPONSE, origin)


# ── GET /waitlist/auth/verify ─────────────────────────────────────────────────


def handle_verify(params, origin, correlation_id):
    token = (params or {}).get("token")
    if not token:
        raise AuthError(400, "missing_token", "This link is missing its token.")

    conn = connect()
    try:
        conn.autocommit = False
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            # Single-use, atomically. A read-then-write would let two clicks of
            # the same link both succeed; the UPDATE ... WHERE used_at IS NULL
            # RETURNING makes the burn and the check one operation.
            cur.execute(
                """
                UPDATE auth_tokens
                SET used_at = now()
                WHERE token = %s AND used_at IS NULL AND expires_at > now()
                RETURNING waitlist_user_id, kind
                """,
                (token,),
            )
            row = cur.fetchone()

            if row is None:
                # Distinguish the causes for the USER, who needs to know whether
                # to click again or request a new link. These are not secrets —
                # possession of the token is already assumed.
                cur.execute(
                    "SELECT used_at, expires_at FROM auth_tokens WHERE token = %s", (token,)
                )
                existing = cur.fetchone()
                conn.rollback()
                if existing is None:
                    raise AuthError(404, "token_not_found", "This sign-in link is not valid.")
                if existing["used_at"] is not None:
                    raise AuthError(
                        410, "token_already_used", "This sign-in link has already been used."
                    )
                raise AuthError(410, "token_expired", "This sign-in link has expired.")

            user_id = row["waitlist_user_id"]

            # The E1 link is also the verification. A magic link is not — it
            # proves control of the address just as well, but E1 is the one the
            # DoD ties email_verified to, and widening that silently would make
            # the flag mean something different from what it is documented to.
            if row["kind"] == "email_verify":
                cur.execute(
                    "UPDATE waitlist_users SET email_verified = true WHERE waitlist_id = %s",
                    (user_id,),
                )

            raw, expires_at = mint_session(cur, user_id)
            log(
                "waitlist.auth.session.created",
                correlation_id,
                waitlistId=str(user_id),
                kind=row["kind"],
                expiresAt=expires_at.isoformat(),
            )
        conn.commit()
    finally:
        conn.close()

    return {
        "statusCode": 302,
        "headers": {
            **cors_headers(origin),
            "Location": f"{SITE}/status",
            "Set-Cookie": session_cookie(raw),
        },
        "body": "",
    }


# ── GET /waitlist/auth/session ────────────────────────────────────────────────


def handle_session(headers, origin, correlation_id):
    conn = connect()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            session = read_session(cur, cookie_from(headers))
            if session is None:
                # 401 with a named cause. The status page redirects to /auth on
                # this; a 200 with an empty body would make "logged out" and
                # "logged in with no data" indistinguishable to the client.
                raise AuthError(401, "no_active_session", "Not signed in.")

            cur.execute(
                "SELECT queue_position, queue_size FROM waitlist_queue WHERE waitlist_id = %s",
                (session["waitlist_user_id"],),
            )
            queue = cur.fetchone()

            cur.execute(
                "SELECT code FROM referral_codes "
                "WHERE owner_waitlist_user_id = %s AND type = 'share' AND active",
                (session["waitlist_user_id"],),
            )
            code = cur.fetchone()
    finally:
        conn.close()

    return resp(
        200,
        {
            "email": session["email"],
            "display_name": session["display_name"],
            "email_verified": session["email_verified"],
            "status": session["status"],
            # Absent rather than fabricated when there is no queue row.
            "queue_position": queue["queue_position"] if queue else None,
            "queue_size": queue["queue_size"] if queue else None,
            "referral_code": code["code"] if code else None,
        },
        origin,
    )


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

    try:
        if method == "POST" and path.endswith("/auth/request"):
            try:
                body = json.loads(event.get("body") or "{}")
            except (json.JSONDecodeError, TypeError) as err:
                raise AuthError(400, "invalid_json", f"Request body is not valid JSON: {err}")
            return handle_request_link(body, origin, correlation_id)

        if method == "GET" and path.endswith("/auth/verify"):
            return handle_verify(event.get("queryStringParameters"), origin, correlation_id)

        if method == "GET" and path.endswith("/auth/session"):
            return handle_session(headers, origin, correlation_id)

        return resp(404, {"error": "not_found", "message": f"No route for {method} {path}."}, origin)

    except AuthError as err:
        log(
            "waitlist.auth.rejected",
            correlation_id,
            level="WARN" if err.status < 500 else "ERROR",
            code=err.code,
            status=err.status,
        )
        return resp(err.status, {"error": err.code, "message": err.message}, origin)

    except psycopg2.Error as err:
        log(
            "waitlist.auth.failed",
            correlation_id,
            level="ERROR",
            pgcode=err.pgcode,
            detail=str(err).strip(),
        )
        return resp(
            503,
            {
                "error": "database_unavailable",
                "message": "Could not reach the waitlist database. Please try again.",
                "pgcode": err.pgcode,
            },
            origin,
        )
