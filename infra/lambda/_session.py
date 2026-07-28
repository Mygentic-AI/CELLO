"""Shared session reading for the M11 waitlist Lambdas.

Two near-duplicate copies of this SQL existed — one in waitlist-auth, one in
waitlist-actions — and they had already drifted. Both checked `revoked_at` and
`expires_at`, but only one joined `waitlist_users`, so the actions endpoints
never looked at the user's state at all: a `banned` or `bounced` user kept
awarding themselves points indefinitely.

That drift is the argument for a single reader. The auth Lambda already treats
suppression as authority-relevant when issuing a link; ignoring it when spending
one was inconsistent rather than deliberate.
"""

import hashlib

# The __Host- prefix is enforced BY THE BROWSER: it refuses the cookie unless it
# is Secure, Path=/, and has no Domain attribute — i.e. host-only. That last
# clause is the one that matters here, because it makes the failure this module
# was rewritten for impossible to reintroduce.
#
# The old name was set two ways over its life: host-only on api.cello.mygentic.ai
# by the original build, then Domain=cello.mygentic.ai by the fix for the
# cross-host hop. A Set-Cookie carrying a Domain attribute CANNOT overwrite a
# host-only cookie of the same name — RFC 6265 keys a cookie on
# (name, domain, path), so those are two different cookies. Both matched every
# request to the API, the browser sent both, and this module read whichever came
# first. That was the dead one, so every signed-in user got a 401 and /status
# bounced them to /auth forever.
#
# Same-origin (/api/waitlist through nginx) removes the need for Domain at all,
# and __Host- makes it impossible for any subdomain to plant a shadowing cookie
# under this name again.
COOKIE_NAME = "__Host-cello_wl_session"

# Statuses that may still act. `admitted` and `active` are further along than
# `waiting`, not less entitled. `left` and `banned` may not.
ACTING_STATUSES = frozenset({"waiting", "admitted", "active"})


def hash_token(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def session_tokens_from(event):
    """EVERY session token in the request, in the order the browser sent them.

    RETURNS A LIST, NOT ONE VALUE, and that is the whole point. A browser can
    hold several cookies under one name — they are distinct whenever they differ
    in domain or path — and it sends all of the matching ones. This returned the
    first match and stopped, which meant one stale cookie permanently masked the
    live session sitting right behind it. See COOKIE_NAME for how that state
    arose and how long it took to find.

    Ordering is not something we can rely on to save us: RFC 6265 sorts by path
    length and then by creation time, so the OLDEST cookie leads. Preferring the
    first is precisely backwards, and preferring the last would merely invert the
    same guess. The only correct move is to hand all of them to the database and
    let it say which one is real.

    TAKES THE EVENT, NOT THE HEADERS. Payload format 2.0 — which every route in
    cello-waitlist.yaml uses — lifts request cookies OUT of `headers` and into a
    top-level `cookies` LIST. Reading `headers["cookie"]` finds nothing on a real
    request. The `headers` fallback is kept for payload format 1.0 and for direct
    invocation, where the header is the only carrier.
    """
    found = []

    def take(name, value):
        if name == COOKIE_NAME and value and value not in found:
            found.append(value)

    for raw in event.get("cookies") or []:
        name, _, value = raw.strip().partition("=")
        take(name, value)

    headers = event.get("headers") or {}
    raw = headers.get("cookie") or headers.get("Cookie") or ""
    for part in raw.split(";"):
        name, _, value = part.strip().partition("=")
        take(name, value)

    return found


def read_session(cur, raw_tokens):
    """Returns the session row for the first token that resolves, or None.

    ACCEPTS A LIST (a bare string is still accepted for direct callers). Trying
    every candidate rather than one is what stops a stale cookie from masking a
    live session — a lookup that misses is not evidence the user is signed out,
    it is evidence that *that* token is dead.

    Joins `waitlist_users` so the caller can see the user's state — a session
    that outlives the account's right to act is not a valid session.
    """
    if not raw_tokens:
        return None
    if isinstance(raw_tokens, str):
        raw_tokens = [raw_tokens]

    for raw_token in raw_tokens:
        if not raw_token:
            continue
        cur.execute(
            """
            SELECT s.id AS session_id, s.waitlist_user_id,
                   u.email, u.display_name, u.email_verified, u.status, u.email_status
            FROM waitlist_sessions s
            JOIN waitlist_users u ON u.waitlist_id = s.waitlist_user_id
            WHERE s.token_hash = %s
              AND s.revoked_at IS NULL
              AND s.expires_at > now()
            """,
            (hash_token(raw_token),),
        )
        row = cur.fetchone()
        if row is not None:
            return row
    return None


def may_act(session):
    """Whether this session may take a state-changing action.

    Separate from `read_session` because reading your own status page is not the
    same right as awarding yourself points — a banned user should still be able
    to see what happened to them.
    """
    return session is not None and session["status"] in ACTING_STATUSES


def revoke_all_for_user(cur, user_id, reason):
    """Kill every live session for a user.

    `revoked_at` had readers and no producer, so a leaked cookie was live for
    thirty days with nothing able to end it. Given CELLO's kill-switch posture
    that is the wrong default.
    """
    cur.execute(
        "UPDATE waitlist_sessions SET revoked_at = now() "
        "WHERE waitlist_user_id = %s AND revoked_at IS NULL",
        (user_id,),
    )
    return cur.rowcount
