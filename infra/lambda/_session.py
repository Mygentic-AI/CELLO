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

COOKIE_NAME = "cello_wl_session"

# Statuses that may still act. `admitted` and `active` are further along than
# `waiting`, not less entitled. `left` and `banned` may not.
ACTING_STATUSES = frozenset({"waiting", "admitted", "active"})


def hash_token(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def cookie_from(headers):
    raw = headers.get("cookie") or headers.get("Cookie") or ""
    for part in raw.split(";"):
        name, _, value = part.strip().partition("=")
        if name == COOKIE_NAME:
            return value
    return None


def read_session(cur, raw_token):
    """Returns the session row, or None.

    Joins `waitlist_users` so the caller can see the user's state — a session
    that outlives the account's right to act is not a valid session.
    """
    if not raw_token:
        return None
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
    return cur.fetchone()


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
