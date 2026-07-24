"""
Tests for the waitlist auth Lambda (DOD-AUTH-1, DOD-INV-NO-ENUMERATION).

The enumeration tests are the load-bearing ones. Every observable — body, status,
headers, and elapsed time — must be indistinguishable between a known and an
unknown address, because any one of them that differs turns /auth into a
membership oracle for the whole list.
"""

import json
import time
import uuid
from pathlib import Path

import psycopg2
import pytest

from waitlist_testdb import PGURL, query, load_lambda


@pytest.fixture()
def auth(database):
    mod = load_lambda(Path(__file__).parent, "auth_handler")
    # Keep the floor low enough that the suite stays fast, high enough that the
    # timing assertion still means something.
    mod.RESPONSE_FLOOR_MS = 120
    return mod


def make_user(email, email_status="active"):
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO waitlist_users (email, anon_id, email_status) VALUES (%s, %s, %s) "
            "RETURNING waitlist_id",
            (email, str(uuid.uuid4()), email_status),
        )
        uid = cur.fetchone()[0]
    conn.close()
    return uid


def call(auth, method, path, *, body=None, params=None, cookie=None):
    headers = {"origin": "https://cello.mygentic.ai"}
    if cookie:
        headers["cookie"] = cookie
    event = {
        "headers": headers,
        "requestContext": {"http": {"method": method, "path": path}},
        "body": json.dumps(body) if body is not None else None,
        "queryStringParameters": params,
    }
    result = auth.lambda_handler(event, None)
    parsed = json.loads(result["body"]) if result["body"] else {}
    return result, parsed


def request_link(auth, email):
    return call(auth, "POST", "/waitlist/auth/request", body={"email": email})


def token_for(user_id, kind="magic_link"):
    return query(
        "SELECT token FROM auth_tokens WHERE waitlist_user_id = %s AND kind = %s "
        "ORDER BY created_at DESC LIMIT 1",
        (user_id, kind),
    )[0][0]


# ── DOD-INV-NO-ENUMERATION ────────────────────────────────────────────────────


def test_known_and_unknown_addresses_get_byte_identical_responses(auth):
    make_user("known@example.test")

    known_result, known_body = request_link(auth, "known@example.test")
    unknown_result, unknown_body = request_link(auth, "nobody@example.test")

    assert known_body == unknown_body
    assert known_result["statusCode"] == unknown_result["statusCode"] == 200
    assert known_result["headers"] == unknown_result["headers"], (
        "a differing header set is as good an oracle as a differing body"
    )


def test_a_known_address_is_not_measurably_slower(auth):
    """The timing channel is the one that usually survives. Sending an email and
    writing rows takes longer than doing nothing, so an attacker with a stopwatch
    enumerates the list while every visible response says the same thing."""
    make_user("timed@example.test")

    def elapsed(email):
        samples = []
        for _ in range(3):
            start = time.monotonic()
            request_link(auth, email)
            samples.append(time.monotonic() - start)
        return min(samples)

    known = elapsed("timed@example.test")
    unknown = elapsed("absent@example.test")

    # Both must sit on the floor. A known path that escapes it would show up as
    # a materially larger minimum.
    assert abs(known - unknown) < 0.06, (
        f"timing gap {abs(known - unknown):.3f}s leaks membership "
        f"(known {known:.3f}s vs unknown {unknown:.3f}s)"
    )


def test_a_suppressed_address_also_looks_identical(auth):
    """A bounced user must get no link — and must not be distinguishable from an
    address that was never on the list."""
    make_user("bounced@example.test", email_status="bounced")

    _, body = request_link(auth, "bounced@example.test")

    assert body == auth.OPAQUE_RESPONSE
    assert query("SELECT count(*) FROM auth_tokens")[0][0] == 0
    assert query("SELECT count(*) FROM email_jobs")[0][0] == 0


def test_no_token_or_job_is_created_for_an_unknown_address(auth):
    request_link(auth, "ghost@example.test")

    assert query("SELECT count(*) FROM auth_tokens")[0][0] == 0
    assert query("SELECT count(*) FROM email_jobs")[0][0] == 0


def test_rate_limiting_counts_unknown_addresses_too(auth):
    """Throttling only real addresses would leak existence through the rate
    limiter — the identical body would be undone by a differing 429 threshold."""
    for _ in range(auth.RATE_LIMIT_MAX + 2):
        _, body = request_link(auth, "spam@example.test")
        assert body == auth.OPAQUE_RESPONSE

    logged = query(
        "SELECT count(*) FROM auth_link_requests WHERE lower(email_requested) = 'spam@example.test'"
    )[0][0]
    assert logged == auth.RATE_LIMIT_MAX + 2


def test_a_real_user_past_the_rate_limit_stops_getting_links(auth):
    uid = make_user("popular@example.test")

    for _ in range(auth.RATE_LIMIT_MAX + 3):
        request_link(auth, "popular@example.test")

    issued = query(
        "SELECT count(*) FROM auth_tokens WHERE waitlist_user_id = %s", (uid,)
    )[0][0]
    assert issued == auth.RATE_LIMIT_MAX, f"expected the throttle to cap at {auth.RATE_LIMIT_MAX}"


# ── Verify + session ──────────────────────────────────────────────────────────


def test_a_valid_link_burns_the_token_and_sets_a_session_cookie(auth):
    uid = make_user("signin@example.test")
    request_link(auth, "signin@example.test")
    token = token_for(uid)

    result, _ = call(auth, "GET", "/waitlist/auth/verify", params={"token": str(token)})

    assert result["statusCode"] == 302
    assert result["headers"]["Location"].endswith("/status")
    cookie = result["headers"]["Set-Cookie"]
    assert "HttpOnly" in cookie and "Secure" in cookie and "SameSite=Lax" in cookie
    assert query("SELECT used_at IS NOT NULL FROM auth_tokens WHERE token = %s", (token,))[0][0]


def test_the_same_link_cannot_be_used_twice(auth):
    uid = make_user("reuse@example.test")
    request_link(auth, "reuse@example.test")
    token = token_for(uid)

    call(auth, "GET", "/waitlist/auth/verify", params={"token": str(token)})
    result, body = call(auth, "GET", "/waitlist/auth/verify", params={"token": str(token)})

    assert result["statusCode"] == 410
    assert body["error"] == "token_already_used", (
        "the cause must be named — the user needs to know whether to request a new link"
    )
    assert query("SELECT count(*) FROM waitlist_sessions")[0][0] == 1


def test_an_expired_link_names_expiry_rather_than_a_generic_failure(auth):
    uid = make_user("stale@example.test")
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO auth_tokens (waitlist_user_id, kind, created_at, expires_at) "
            "VALUES (%s, 'magic_link', now() - interval '1 hour', now() - interval '45 minutes') "
            "RETURNING token",
            (uid,),
        )
        token = cur.fetchone()[0]
    conn.close()

    result, body = call(auth, "GET", "/waitlist/auth/verify", params={"token": str(token)})

    assert result["statusCode"] == 410
    assert body["error"] == "token_expired"


def test_an_unknown_token_is_distinguishable_from_an_expired_one(auth):
    result, body = call(
        auth, "GET", "/waitlist/auth/verify", params={"token": str(uuid.uuid4())}
    )

    assert result["statusCode"] == 404
    assert body["error"] == "token_not_found"


def test_only_the_e1_link_sets_email_verified(auth):
    """A magic link proves control of the address just as well, but email_verified
    is documented as what E1 sets. Widening it silently would make the flag mean
    something different from what it says."""
    uid = make_user("verify@example.test")
    request_link(auth, "verify@example.test")
    call(auth, "GET", "/waitlist/auth/verify", params={"token": str(token_for(uid))})

    assert query("SELECT email_verified FROM waitlist_users WHERE waitlist_id = %s", (uid,))[0][0] is False

    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO auth_tokens (waitlist_user_id, kind, expires_at) "
            "VALUES (%s, 'email_verify', now() + interval '24 hours') RETURNING token",
            (uid,),
        )
        e1_token = cur.fetchone()[0]
    conn.close()

    call(auth, "GET", "/waitlist/auth/verify", params={"token": str(e1_token)})

    assert query("SELECT email_verified FROM waitlist_users WHERE waitlist_id = %s", (uid,))[0][0] is True


def test_the_session_token_is_never_stored_in_the_clear(auth):
    uid = make_user("hashed@example.test")
    request_link(auth, "hashed@example.test")
    result, _ = call(auth, "GET", "/waitlist/auth/verify", params={"token": str(token_for(uid))})
    raw = result["headers"]["Set-Cookie"].split("=", 1)[1].split(";")[0]

    stored = query("SELECT token_hash FROM waitlist_sessions")[0][0]
    assert stored != raw, "a database dump must not hand out live sessions"
    assert len(stored) == 64


# ── Session guard ─────────────────────────────────────────────────────────────


def test_no_cookie_means_no_session_with_a_named_cause(auth):
    result, body = call(auth, "GET", "/waitlist/auth/session")

    assert result["statusCode"] == 401
    assert body["error"] == "no_active_session"


def test_a_valid_session_returns_the_users_real_queue_position(auth):
    make_user("ahead@example.test")
    uid = make_user("me@example.test")
    request_link(auth, "me@example.test")
    verify, _ = call(auth, "GET", "/waitlist/auth/verify", params={"token": str(token_for(uid))})
    cookie = verify["headers"]["Set-Cookie"].split(";")[0]

    result, body = call(auth, "GET", "/waitlist/auth/session", cookie=cookie)

    assert result["statusCode"] == 200
    assert body["email"] == "me@example.test"
    assert body["queue_position"] in (1, 2)
    assert body["queue_size"] == 2


def test_an_expired_session_is_rejected(auth):
    uid = make_user("old@example.test")
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO waitlist_sessions (waitlist_user_id, token_hash, created_at, expires_at) "
            "VALUES (%s, %s, now() - interval '31 days', now() - interval '1 day')",
            (uid, auth.hash_token("expired-token")),
        )
    conn.close()

    result, body = call(auth, "GET", "/waitlist/auth/session", cookie="cello_wl_session=expired-token")

    assert result["statusCode"] == 401
    assert body["error"] == "no_active_session"


def test_a_revoked_session_is_rejected(auth):
    uid = make_user("revoked@example.test")
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO waitlist_sessions (waitlist_user_id, token_hash, expires_at, revoked_at) "
            "VALUES (%s, %s, now() + interval '30 days', now())",
            (uid, auth.hash_token("revoked-token")),
        )
    conn.close()

    result, _ = call(auth, "GET", "/waitlist/auth/session", cookie="cello_wl_session=revoked-token")

    assert result["statusCode"] == 401


def test_a_session_cannot_outlive_thirty_days(auth):
    """M11-D9: 30 days from ISSUE. Enforced in the schema so no code path can
    mint a longer one."""
    uid = make_user("longlived@example.test")
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        with pytest.raises(psycopg2.errors.CheckViolation):
            cur.execute(
                "INSERT INTO waitlist_sessions (waitlist_user_id, token_hash, expires_at) "
                "VALUES (%s, %s, now() + interval '90 days')",
                (uid, "x" * 64),
            )
    conn.close()
