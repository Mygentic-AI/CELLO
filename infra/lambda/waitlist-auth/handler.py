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
import urllib.parse
import secrets
import time
import uuid
from datetime import datetime, timezone

import psycopg2

from _dburl import portal_database_url
import psycopg2.extras

from _session import COOKIE_NAME, cookie_from, hash_token, read_session, revoke_all_for_user
from _referral import award_referrer_for
from _resend import LINK_LIMIT, LINK_WINDOW_MINUTES, resend_link
from _sqlstate import classify

# Kept only so an explicit override still works. The live value is resolved
# lazily by portal_database_url(), because binding the environment variable here
# is exactly what let the 2026-07-27 rotation take the whole waitlist down: the
# password was baked in at deploy time and aged out. See _dburl.py.
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
#
# THE SAME NUMBERS the resend door uses, imported rather than restated: both
# count the same `auth_link_requests` rows, and two limits over one counter
# meant traffic through one door silently consumed the other's budget.
RATE_LIMIT_MAX = LINK_LIMIT
RATE_LIMIT_WINDOW_MINUTES = LINK_WINDOW_MINUTES

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
    if not DATABASE_URL and not os.environ.get("PORTAL_DB_SECRET_ID"):
        raise AuthError(500, "database_url_not_configured", "DATABASE_URL is not set.")
    return psycopg2.connect(DATABASE_URL or portal_database_url(), sslmode=os.environ.get("PGSSLMODE", "require"))


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
    # ensure_ascii=False so an em dash in a real sentence stays an em dash
    # rather than arriving as a literal \u2014.
    return {
        "statusCode": status,
        "headers": headers,
        "body": json.dumps(body, ensure_ascii=False),
    }


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



CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no I/O/0/1 — these get read aloud
CODE_LENGTH = 12
MAX_CODE_ATTEMPTS = 8


def mint_share_code(cur):
    """A share code, unique against the table it is inserted into.

    Same alphabet and length as the signup generator it replaces: 12 characters
    over 32 symbols, 5 bits each. Generated from the target alphabet rather than
    by upper-casing a token, because .upper() collapses 52 letters onto 26 after
    generation and the realised space is far smaller than the byte count suggests.
    """
    for _ in range(MAX_CODE_ATTEMPTS):
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))
        cur.execute("SELECT 1 FROM referral_codes WHERE code = %s", (code,))
        if cur.fetchone() is None:
            return code
    raise AuthError(503, "code_generation_exhausted",
                    f"Could not mint an unused referral code in {MAX_CODE_ATTEMPTS} attempts.")


def cookie_domain():
    """The registrable domain, so the cookie survives the hop to the site.

    WITHOUT THIS THE WHOLE SIGN-IN FLOW IS A LOOP. This endpoint lives on
    api.cello.mygentic.ai and redirects to cello.mygentic.ai/status. A Set-Cookie
    with no Domain attribute is HOST-ONLY: the browser stores it against the API
    host and never sends it to the site. So /status saw no session, bounced to
    /auth, and every link — the confirm link and the magic link alike — appeared
    to "do nothing but return you to sign in". Nothing was expired and no token
    was wrong; the cookie simply was not travelling.

    Derived from WAITLIST_SITE rather than hardcoded, so a staging host does not
    silently scope cookies to production.
    """
    host = urllib.parse.urlparse(SITE).hostname or "cello.mygentic.ai"
    return host


def session_cookie(raw_token):
    # HttpOnly so script cannot read it; Secure so it never crosses plaintext;
    # SameSite=Lax so a cross-site POST cannot ride it, while a link from an
    # email still arrives authenticated.
    #
    # Domain is set to the registrable domain so the cookie reaches the site
    # after the redirect. It is therefore also sent to other subdomains; that is
    # acceptable here because the name is distinct from the operations console's
    # (`cello_ops_session`), so neither can be mistaken for the other, and a
    # waitlist session grants nothing there.
    return (
        f"{COOKIE_NAME}={raw_token}; Max-Age={SESSION_DAYS * 24 * 3600}; "
        f"Path=/; Domain={cookie_domain()}; HttpOnly; Secure; SameSite=Lax"
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
            # A REFUSED request is NOT recorded, and that is the whole point.
            # Counting refusals lets the window extend itself, so somebody
            # asking again every few minutes is refused forever — and it lets a
            # third party pin your budget at the ceiling with one
            # unauthenticated request every few minutes, locking you out of the
            # sign-in link, the resend button and the signup form's remedy path
            # alike. This counter is SHARED with the resend door (LINK_LIMIT),
            # so a refusal recorded here would extend that window too.
            #
            # Nothing observable changes: the response is OPAQUE_RESPONSE behind
            # a timing floor whether or not a link was issued, and the count
            # query is identical for a known and an unknown address, so this
            # does not become a membership oracle.
            throttled = rate_limited(cur, email)

            cur.execute(
                "SELECT waitlist_id, email_status FROM waitlist_users WHERE lower(email) = %s",
                (email,),
            )
            user = cur.fetchone()

            if user and not throttled and user["email_status"] == "active":
                # Recorded HERE, on the path that actually issues a link, so the
                # count bounds sends rather than attempts.
                cur.execute(
                    "INSERT INTO auth_link_requests (email_requested) VALUES (%s)", (email,)
                )
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




# ── Pages ─────────────────────────────────────────────────────────────────────
#
# /auth/verify and /auth/resend are reached by a person clicking something, not
# by script calling an API. What they return is rendered as the entire visible
# result of that click, so it has to be a page.


# The routes a PERSON lands on, as opposed to the ones script calls. Anything
# here answers in HTML on every path, including its failures.
BROWSER_ROUTES = ("/auth/verify", "/auth/resend", "/unsubscribe")


def _is_browser_route(path):
    return any(path.endswith(suffix) for suffix in BROWSER_ROUTES)


def _page(status, heading, sentence, origin, *, resend_token=None, front_door=False):
    """One shell for every dead-link outcome, with at most one thing to do.

    `resend_token` turns the page into a one-button form. The dead token
    identifies the user by itself, so nobody is asked to re-key an address we
    are already holding — which is the whole difference between "expired, start
    over" and "expired, here you go".
    """
    action = ""
    if resend_token:
        action = (
            f'<form method="POST" action="{SITE_API}/auth/resend" style="margin:0;">'
            f'<input type="hidden" name="token" value="{esc_attr(resend_token)}">'
            '<button type="submit" style="padding:14px 32px;background:#E0147A;color:#fff;'
            'border:0;border-radius:100px;font-size:15px;font-weight:600;cursor:pointer;">'
            "Email me a new link</button></form>"
        )
    elif front_door:
        action = (
            f'<a href="{SITE}/waitlist" style="display:inline-block;padding:14px 32px;'
            'background:#E0147A;color:#fff;text-decoration:none;border-radius:100px;'
            'font-size:15px;font-weight:600;">Go to the waitlist</a>'
        )

    return {
        "statusCode": status,
        "headers": {**cors_headers(origin), "Content-Type": "text/html; charset=utf-8"},
        "body": (
            '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1">'
            f"<title>{esc_attr(heading)} | CELLO</title></head>"
            '<body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\','
            "Roboto,sans-serif;background:#f5f5f5;display:flex;align-items:center;"
            'justify-content:center;min-height:100vh;">'
            '<div style="background:#fff;border-radius:16px;padding:48px 40px;max-width:460px;'
            'text-align:center;">'
            f'<h1 style="margin:0 0 12px;font-size:24px;color:#111;">{heading}</h1>'
            f'<p style="margin:0 0 28px;font-size:16px;color:#666;line-height:1.6;">{esc_attr(sentence)}</p>'
            f"{action}</div></body></html>"
        ),
    }


# ── POST /waitlist/auth/resend ────────────────────────────────────────────────


def handle_resend(params, origin, correlation_id):
    """Send a new link to whoever owns a dead one.

    Takes a TOKEN, not an address, which is what makes it safe to answer without
    a session: the caller has already demonstrated possession of something we
    issued to that mailbox.

    Body, status and headers are identical for a token we hold and one we do
    not. The TIMING is not — a known token costs several queries and a commit —
    and there is deliberately no floor here, unlike /auth/request. The input is
    a server-minted UUID rather than an address anyone can choose, so a stopwatch
    tells an attacker only that a UUID they cannot guess exists. Adding a floor
    would buy nothing and slow the one path a real person is waiting on.
    """
    token = (params or {}).get("token")
    inbox = _page(
        200,
        "Check your inbox.",
        "If that link was ours, a new one is on its way. It works once.",
        origin,
    )
    if not token:
        return inbox

    conn = connect()
    try:
        conn.autocommit = False
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT u.waitlist_id, u.email, u.email_verified, u.email_status
                FROM auth_tokens t
                JOIN waitlist_users u ON u.waitlist_id = t.waitlist_user_id
                WHERE t.token = %s
                """,
                (token,),
            )
            user = cur.fetchone()
            if user is None:
                conn.rollback()
                log("waitlist.auth.resend.unknown_token", correlation_id, level="WARN")
                return inbox

            sent = resend_link(cur, user, correlation_id, log)
        conn.commit()
    except psycopg2.errors.InvalidTextRepresentation:
        # Not a UUID. Same answer as any other token we do not hold.
        conn.rollback()
        return inbox
    finally:
        conn.close()

    if sent == "suppressed":
        # "Check your inbox" here would be a lie that never resolves: this
        # address asked us to stop, and nothing will arrive however long they
        # wait. Suppression is one-way and this endpoint does not undo it.
        return _page(
            200,
            "That address has unsubscribed.",
            "You asked us to stop emailing, so we haven't sent anything. Reply to any "
            "earlier CELLO email and we'll put you back on.",
            origin,
        )
    if sent == "throttled":
        # Nothing was sent, so nothing may claim otherwise. Saying "check your
        # inbox" to somebody we just refused is how a person ends up refreshing
        # an empty mailbox — and the refusal is not recorded, so waiting really
        # does clear it.
        return _page(
            200,
            "We've sent you a few already.",
            f"There are recent links in your inbox — check your spam folder for them. "
            f"You can ask for another in about {LINK_WINDOW_MINUTES} minutes.",
            origin,
        )
    return inbox


# ── GET /waitlist/auth/verify ─────────────────────────────────────────────────


def handle_verify(params, origin, correlation_id):
    token = (params or {}).get("token")
    if not token:
        # Reached by a browser, so it gets a page. An email client that wraps
        # and truncates a long URL drops the query string first — which is the
        # single most likely way to arrive here — and answering that with the
        # API's JSON envelope leaves the person holding a blob.
        return _page(
            400,
            "That link came through incomplete.",
            "Email clients sometimes cut long links in half. Starting again from "
            "the waitlist page takes one field.",
            origin,
            front_door=True,
        )

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
                # to click again or ask for a new link. These are not secrets —
                # possession of the token is already assumed.
                #
                # ANSWERED AS A PAGE, NOT AS JSON. This route is reached by
                # clicking a button in an email, so whatever comes back IS the
                # visible outcome of that click. Returning the API envelope
                # showed the most likely unhappy-path visitor there is — someone
                # whose link aged out — a raw {"error":"token_expired"} and no
                # way forward.
                cur.execute(
                    "SELECT used_at, expires_at FROM auth_tokens WHERE token = %s", (token,)
                )
                existing = cur.fetchone()
                conn.rollback()
                if existing is None:
                    # No row means nobody to resend to. A button that cannot
                    # work is worse than none: it turns a dead end into a dead
                    # end that looks like a way out.
                    return _page(
                        404,
                        "That link isn't valid.",
                        "It may have been mistyped, or truncated by an email client. "
                        "Starting again from the waitlist page takes one field.",
                        origin,
                        front_door=True,
                    )
                if existing["used_at"] is not None:
                    return _page(
                        410,
                        "You've already used that link.",
                        "Each one works once. Send yourself a fresh one and it will take "
                        "you straight through.",
                        origin,
                        resend_token=token,
                    )
                return _page(
                    410,
                    "That link has expired.",
                    "Links are short-lived on purpose. Send yourself a new one — "
                    "we already know who you are, so there is nothing to fill in.",
                    origin,
                    resend_token=token,
                )

            user_id = row["waitlist_user_id"]

            # BOTH kinds verify, and this is a deliberate widening from the
            # earlier "only E1 counts" rule.
            #
            # What email_verified attests is control of the address, and a magic
            # link proves that identically — the earlier comment here said so
            # and then declined to act on it, on the grounds that widening the
            # flag would make it mean something other than documented.
            #
            # What that left was a ONE-WAY DOOR. e1_confirm is enqueued exactly
            # once, at signup, and its token lasts 24 hours; there is no resend
            # path. So anyone who missed that window was permanently unverified
            # — and once the dispatcher started gating base-list mail on the
            # flag, permanently unverified meant permanently silent, with
            # nothing told to them or to us. A flag that can only ever go one
            # way needs a route back before anything is allowed to depend on it.
            #
            # The counterfactual is weaker than it sounds: to redeem a magic
            # link you must already read the mailbox, which is the whole claim.
            just_verified = False
            if row["kind"] in ("email_verify", "magic_link"):
                cur.execute(
                    "UPDATE waitlist_users SET email_verified = true "
                    "WHERE waitlist_id = %s AND NOT email_verified",
                    (user_id,),
                )
                just_verified = bool(cur.rowcount)
                if just_verified:
                    log(
                        "waitlist.auth.email.verified",
                        correlation_id,
                        waitlistId=str(user_id),
                        via=row["kind"],
                    )

                # THE REFERRAL CODE IS MINTED HERE, NOT AT SIGNUP.
                #
                # Signup used to mint one immediately and show it on the
                # confirmation page and in the confirmation email — to an
                # address nobody had proved control of. That is a free supply of
                # working referral codes to anyone willing to type strangers'
                # addresses, and every code carries points. A code cannot exist
                # before the one fact it depends on: that this person reads this
                # mailbox.
                #
                # Guarded by NOT EXISTS rather than by the rowcount above, so a
                # user verified before this change still gets their code on
                # their next sign-in instead of never.
                cur.execute(
                    """
                    SELECT 1 FROM referral_codes
                    WHERE owner_waitlist_user_id = %s AND type = 'share'
                    """,
                    (user_id,),
                )
                if cur.fetchone() is None:
                    code = mint_share_code(cur)
                    cur.execute(
                        """
                        INSERT INTO referral_codes (code, owner_waitlist_user_id, creator_handle, type)
                        VALUES (%s, %s, NULL, 'share')
                        """,
                        (code, user_id),
                    )
                    log(
                        "waitlist.referral_code.minted",
                        correlation_id,
                        waitlistId=str(user_id),
                        reason="email_verified",
                    )

                # AND THE REFERRER IS PAID HERE, for the same reason the code is
                # minted here. A signup is a typed address; paying out on one
                # makes the queue farmable by the effort of inventing addresses,
                # and the queue is the product.
                #
                # Only on the click that MAKES the member, unlike the code above.
                # A magic-link sign-in runs this same path, and re-attempting
                # there meant a referrer sitting at their 30-point cap took a row
                # lock inside the session transaction and logged a WARN on every
                # single sign-in, forever — a signal that fires on the designed
                # benign case is not a signal. Nothing is owed retroactively:
                # anyone verified before this rule was already paid at signup
                # under the old one. The ledger check inside stays, because two
                # devices can confirm the same link at once.
                if just_verified:
                    award_referrer_for(cur, user_id, correlation_id, log)

                    # And a premium invite becomes an actual admission here, for
                    # the same reason. The claim was recorded at signup and the
                    # code burned there; skipping the queue waits on proof of
                    # the mailbox, exactly as the referrer's points do.
                    cur.execute(
                        """
                        UPDATE waitlist_users
                        SET status = 'admitted', admitted_at = now()
                        WHERE waitlist_id = %s AND premium_referred AND status = 'waiting'
                        """,
                        (user_id,),
                    )
                    if cur.rowcount:
                        log(
                            "waitlist.premium.admitted",
                            correlation_id,
                            waitlistId=str(user_id),
                            reason="email_verified",
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
            # The click that MAKES someone a member deserves to be acknowledged
            # as such. Without this they land on the same page a returning
            # visitor sees and are left wondering whether the confirm worked —
            # which is what sent people back to sign up a second time. A query
            # flag, not a cookie: it describes this navigation, not this
            # browser, and it must not survive a refresh.
            "Location": f"{SITE}/status?welcome=1" if just_verified else f"{SITE}/status",
            "Set-Cookie": session_cookie(raw),
        },
        # The documented carrier for payload format 2.0. Sent ALONGSIDE the
        # header, not instead of it: both are honoured, they carry the identical
        # value, and the header form is what is deployed today. Dropping it on
        # the strength of a reading of the docs — in the one flow that has
        # already cost a day — is a bet with no upside. Collapse to one after a
        # live trace shows which arrives.
        "cookies": [session_cookie(raw)],
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


def handle_session(event, origin, correlation_id):
    conn = connect()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            session = read_session(cur, cookie_from(event))
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


def handle_logout(event, origin, correlation_id):
    """Ends every live session for this user, not just the one presenting.

    `revoked_at` had readers and no writer: a leaked cookie was live for thirty
    days with nothing able to end it. Killing ALL of them rather than just the
    current one is the point — someone logging out because they think their
    session is compromised does not know which cookie is the problem.

    Idempotent, and it never reveals whether the cookie was valid: 204 either
    way, so this cannot be used to test whether a stolen token is still live.
    """
    token = cookie_from(event)
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
            "Set-Cookie": f"{COOKIE_NAME}=; Max-Age=0; Path=/; Domain={cookie_domain()}; HttpOnly; Secure; SameSite=Lax",
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
            return handle_session(event, origin, correlation_id)

        if method == "POST" and path.endswith("/auth/logout"):
            return handle_logout(event, origin, correlation_id)

        if method == "POST" and path.endswith("/auth/resend"):
            # A real <form> posts urlencoded, never JSON.
            from urllib.parse import parse_qs

            form = {k: v[0] for k, v in parse_qs(event.get("body") or "").items()}
            return handle_resend(form, origin, correlation_id)

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
        if _is_browser_route(path):
            return _page(err.status, "That didn't work.", err.message, origin)
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
        # /auth/verify, /auth/resend and /unsubscribe are reached by a person
        # clicking something, so a database fault on one of them must be a page
        # too. The sentence classify() writes is good; delivering it as a JSON
        # envelope to somebody who pressed a button is not.
        if _is_browser_route(path):
            return _page(status, "Something went wrong on our side.", message, origin)
        return resp(status, {"error": code, "message": message}, origin)
