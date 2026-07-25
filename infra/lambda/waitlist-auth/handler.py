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

import json
import os
import secrets
import time
import uuid
from datetime import datetime, timezone

import psycopg2
import psycopg2.extras

from _session import COOKIE_NAME, cookie_from, hash_token, read_session, revoke_all_for_user
from _sqlstate import classify

DATABASE_URL = os.environ.get("DATABASE_URL")
SITE = os.environ.get("WAITLIST_SITE", "https://cello.mygentic.ai")
SITE_API = os.environ.get("WAITLIST_API_BASE", "https://api.cello.mygentic.ai/waitlist")
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


from _logging import emit as log  # noqa: E402 — see _logging.py


def connect():
    if not DATABASE_URL:
        raise AuthError(500, "database_url_not_configured", "DATABASE_URL is not set.")
    return psycopg2.connect(DATABASE_URL, sslmode=os.environ.get("PGSSLMODE", "require"))


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
        try:
            _issue_link_if_eligible(email, correlation_id)
        except psycopg2.Error as err:
            # Swallowed DELIBERATELY, and this is the one place in M11 where that
            # is right. Letting it escape means a database fault on a KNOWN
            # address returns 503 while an unknown address returns the opaque
            # 200 — a categorical oracle, strictly worse than the timing channel
            # this endpoint exists to close. The operator still gets the full
            # cause in the log; the caller learns nothing either way.
            log(
                "waitlist.auth.link.failed",
                correlation_id,
                level="ERROR",
                pgcode=err.pgcode,
                detail=str(err).strip(),
            )

    # The timing floor. Without it the known path is measurably slower than the
    # unknown one and the identical body means nothing.
    elapsed_ms = (time.monotonic() - started) * 1000
    if elapsed_ms < RESPONSE_FLOOR_MS:
        time.sleep((RESPONSE_FLOOR_MS - elapsed_ms) / 1000)
    else:
        # The work outran the floor, so there is nothing left to flatten and the
        # guard is simply not guarding. Silence here means the first anyone
        # learns of it is an enumerated list; alarm on this event.
        log(
            "waitlist.auth.floor.exceeded",
            correlation_id,
            level="WARN",
            elapsedMs=round(elapsed_ms, 1),
            floorMs=RESPONSE_FLOOR_MS,
            detail="request outran the response floor; the timing guard did not apply",
        )

    return resp(200, OPAQUE_RESPONSE, origin)


def _issue_link_if_eligible(email, correlation_id):
    """The whole known-address path, isolated so its failures cannot change the
    response shape."""
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
                # Burn any earlier unused link first. Otherwise N requests
                # leave N-1 live credentials for the same person, and the
                # single-use guarantee only covers each token in isolation
                # rather than the account.
                cur.execute(
                    "UPDATE auth_tokens SET used_at = now() "
                    "WHERE waitlist_user_id = %s AND kind = 'magic_link' "
                    "AND used_at IS NULL",
                    (user["waitlist_id"],),
                )
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


# Caps as the DB enforces them, so the page shows a ceiling that is real rather
# than a number copied into the frontend and left to drift.
POINT_CAPS = {"share_conversion": 30, "public_post": 45}


def qualitative_band(position, size):
    """"top 10%" / "top 25%" / "top half", or None.

    M11-D16 killed the predicted wave number: wave sizes are decided by the
    operator at trigger time and cannot be forecast, so any date or wave estimate
    would be invented. A band is derived entirely from two real numbers.

    Returns None rather than a default when there is no position — a user with
    no queue row is not in the bottom half, they are not in the queue at all,
    and saying "top half" to an admitted user is simply false.
    """
    if not position or not size:
        return None
    ratio = position / size
    if ratio <= 0.10:
        return "top 10%"
    if ratio <= 0.25:
        return "top 25%"
    if ratio <= 0.50:
        return "top half"
    return None


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

            # Points broken down by reason, so the page can show what was earned
            # for what rather than a single number nobody can audit.
            cur.execute(
                "SELECT reason, sum(points) AS points, count(*) AS entries "
                "FROM points_ledger WHERE waitlist_user_id = %s GROUP BY reason ORDER BY reason",
                (session["waitlist_user_id"],),
            )
            breakdown = cur.fetchall()

            cur.execute(
                "SELECT content_alerts, points_total FROM waitlist_users WHERE waitlist_id = %s",
                (session["waitlist_user_id"],),
            )
            prefs = cur.fetchone()

            # THE READER for status_notes. Without one the Day-6 sweep grants two
            # premium invite codes and writes a note nobody ever sees, which is
            # the exact failure 0021_status_notes.sql opens by describing — a
            # reward nobody is told about is not a reward. A write with no reader
            # is invisible to a green test suite, so it has to be looked for.
            cur.execute(
                "SELECT kind, body, created_at FROM status_notes "
                "WHERE waitlist_user_id = %s AND dismissed_at IS NULL "
                "ORDER BY created_at DESC LIMIT 10",
                (session["waitlist_user_id"],),
            )
            notes = cur.fetchall()
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
            "band": qualitative_band(
                queue["queue_position"] if queue else None,
                queue["queue_size"] if queue else None,
            ),
            "referral_code": code["code"] if code else None,
            "points_total": prefs["points_total"],
            "points_breakdown": [
                {"reason": r["reason"], "points": r["points"], "entries": r["entries"], "cap": POINT_CAPS.get(r["reason"])}
                for r in breakdown
            ],
            "content_alerts": prefs["content_alerts"],
            "notes": [
                {"kind": n["kind"], "body": n["body"], "created_at": n["created_at"].isoformat()}
                for n in notes
            ],
        },
        origin,
    )


# ── POST /waitlist/auth/logout ────────────────────────────────────────────────


def handle_logout(headers, origin, correlation_id):
    """Ends every live session for this user, not just the one presenting.

    `revoked_at` had readers and no writer: a leaked cookie was live for thirty
    days with nothing able to end it. Killing ALL of them rather than just the
    current one is the point — someone logging out because they think their
    session is compromised does not know which cookie is the problem.

    Idempotent, and it never reveals whether the cookie was valid: 204 either
    way, so this cannot be used to test whether a stolen token is still live.
    """
    token = cookie_from(headers)
    cleared = 0

    if token:
        conn = connect()
        try:
            conn.autocommit = False
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                session = read_session(cur, token)
                if session:
                    cleared = revoke_all_for_user(cur, session["waitlist_user_id"], "logout")
                    log(
                        "waitlist.auth.logged_out",
                        correlation_id,
                        waitlistId=str(session["waitlist_user_id"]),
                        sessionsRevoked=cleared,
                    )
            conn.commit()
        finally:
            conn.close()

    return {
        "statusCode": 204,
        "headers": {
            **cors_headers(origin),
            # Max-Age=0 so the browser drops it even if the server-side revoke
            # somehow did not land.
            "Set-Cookie": f"{COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax",
        },
        "body": "",
    }


# ── GET /waitlist/unsubscribe ─────────────────────────────────────────────────


def handle_unsubscribe(params, origin, correlation_id, method="GET"):
    """One click, permanent, no login (DOD-E-RE-1, DOD-CONTENT-ALERTS-1).

    A GET that changes state, deliberately. Requiring a session would mean
    someone who cannot get back into their account cannot leave, and a person
    who wants out and cannot find the door marks the message as spam instead —
    which costs the sending reputation of every other email, including the E1s
    that are the core capture loop. The worst case here is that somebody
    unsubscribes a person who wanted to stay; the worst case of the alternative
    is losing the domain.

    `list=content_alerts` scopes it to the alert segment. Without that parameter
    it is the base list, which is permanent and sets email_status.
    """
    user_id = (params or {}).get("u")
    scope = (params or {}).get("list")

    if not user_id:
        raise AuthError(400, "missing_user", "This unsubscribe link is incomplete.")
    try:
        uuid.UUID(user_id)
    except (ValueError, AttributeError, TypeError):
        raise AuthError(400, "invalid_user", "This unsubscribe link is not valid.")

    if method == "GET":
        # A GET must not change state. Gmail's link proxy, Outlook Safe Links
        # and corporate scanners all fetch body links, and each fetch would
        # permanently unsubscribe an engaged user — logged identically to a real
        # click, so the loss is invisible. The confirm page is one button, which
        # is still "one click" for the person and unreachable for a scanner.
        #
        # RFC 8058 clients POST here directly and never see this page, so the
        # genuinely one-click path is preserved for the clients that support it.
        return {
            "statusCode": 200,
            "headers": {**cors_headers(origin), "Content-Type": "text/html; charset=utf-8"},
            "body": _confirm_page(user_id, scope),
        }

    conn = connect()
    try:
        conn.autocommit = False
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            if scope == "content_alerts":
                cur.execute(
                    "UPDATE waitlist_users SET content_alerts = false "
                    "WHERE waitlist_id = %s RETURNING email",
                    (user_id,),
                )
            else:
                # Base list. Suppression is one-way: this never reactivates an
                # address that already bounced or complained.
                cur.execute(
                    "UPDATE waitlist_users SET email_status = 'unsubscribed' "
                    "WHERE waitlist_id = %s AND email_status = 'active' RETURNING email",
                    (user_id,),
                )
            row = cur.fetchone()
        conn.commit()
    finally:
        conn.close()

    # 200 whether or not anything changed, and no indication either way. An
    # unknown id must not be distinguishable from a known one — otherwise this
    # link is a membership oracle that needs no login at all.
    log(
        "waitlist.unsubscribe.processed",
        correlation_id,
        scope=scope or "base_list",
        matched=row is not None,
    )
    return {
        "statusCode": 200,
        "headers": {**cors_headers(origin), "Content-Type": "text/html; charset=utf-8"},
        "body": _unsubscribed_page(scope),
    }


def _confirm_page(user_id, scope):
    what = (
        "stop sending you content alerts. Your waitlist emails are unaffected."
        if scope == "content_alerts"
        else "stop emailing you altogether."
    )
    action = f"{SITE_API}/unsubscribe"
    hidden_scope = (
        f'<input type="hidden" name="list" value="content_alerts">' if scope == "content_alerts" else ""
    )
    return (
        "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\">"
        "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
        "<title>Unsubscribe | CELLO</title></head>"
        "<body style=\"margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;"
        "background:#f5f5f5;display:flex;align-items:center;justify-content:center;min-height:100vh;\">"
        "<div style=\"background:#fff;border-radius:16px;padding:48px 40px;max-width:460px;text-align:center;\">"
        "<h1 style=\"margin:0 0 12px;font-size:24px;color:#111;\">Unsubscribe?</h1>"
        f"<p style=\"margin:0 0 28px;font-size:16px;color:#666;line-height:1.6;\">We'll {what}</p>"
        f"<form method=\"POST\" action=\"{action}\">"
        f'<input type="hidden" name="u" value="{esc_attr(user_id)}">{hidden_scope}'
        "<button type=\"submit\" style=\"padding:14px 32px;background:#E0147A;color:#fff;border:0;"
        "border-radius:100px;font-size:15px;font-weight:600;cursor:pointer;\">Yes, unsubscribe</button>"
        "</form></div></body></html>"
    )


def esc_attr(value):
    return str(value).replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;")


def _unsubscribed_page(scope):
    what = (
        "You won't get content alerts any more. Your waitlist emails are unaffected."
        if scope == "content_alerts"
        else "You've been unsubscribed. We won't email you again."
    )
    return (
        "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\">"
        "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
        "<title>Unsubscribed | CELLO</title></head>"
        "<body style=\"margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;"
        "background:#f5f5f5;display:flex;align-items:center;justify-content:center;min-height:100vh;\">"
        "<div style=\"background:#fff;border-radius:16px;padding:48px 40px;max-width:460px;text-align:center;\">"
        "<h1 style=\"margin:0 0 12px;font-size:24px;color:#111;\">Done.</h1>"
        f"<p style=\"margin:0 0 24px;font-size:16px;color:#666;line-height:1.6;\">{what}</p>"
        f"<a href=\"{SITE}\" style=\"color:#E0147A;text-decoration:none;font-size:14px;\">"
        "cello.mygentic.ai</a></div></body></html>"
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

        if method == "POST" and path.endswith("/auth/logout"):
            return handle_logout(headers, origin, correlation_id)

        if path.endswith("/unsubscribe") and method in ("GET", "POST"):
            params = event.get("queryStringParameters") or {}
            if method == "POST":
                # RFC 8058 clients post form-encoded; our confirm page does too.
                from urllib.parse import parse_qs

                raw = event.get("body") or ""
                form = {k: v[0] for k, v in parse_qs(raw).items()}
                params = {**params, **form}
            return handle_unsubscribe(params, origin, correlation_id, method)

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
        status, code, message = classify(err)
        return resp(status, {"error": code, "message": message}, origin)
