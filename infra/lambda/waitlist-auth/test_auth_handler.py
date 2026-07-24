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


def test_both_paths_sit_on_the_response_floor(auth):
    """Asserts the FLOOR, not the gap.

    An earlier version of this test only bounded the known-vs-unknown gap at
    60ms — and passed with the floor deleted entirely, because the two paths
    differ by about four statements, roughly 1ms on loopback. It was coverage of
    "Postgres is fast", not of the guard. Deleting the thing under test must
    fail the test, so the assertion is on the floor itself.
    """
    make_user("timed@example.test")
    floor = auth.RESPONSE_FLOOR_MS / 1000

    def elapsed(email):
        return min(
            (lambda start: (request_link(auth, email), time.monotonic() - start)[1])(
                time.monotonic()
            )
            for _ in range(3)
        )

    known = elapsed("timed@example.test")
    unknown = elapsed("absent@example.test")

    assert known >= floor, f"known path returned in {known:.3f}s, under the {floor:.3f}s floor"
    assert unknown >= floor, f"unknown path returned in {unknown:.3f}s, under the {floor:.3f}s floor"

    # And the tighter gap check on top, now that the floor is proven present.
    assert abs(known - unknown) < 0.015, (
        f"timing gap {abs(known - unknown):.3f}s leaks membership even on the floor"
    )


def test_a_known_path_that_outruns_the_floor_says_so(auth, caplog):
    """A guard that silently stops guarding is worse than no guard.

    When the database is slow enough that the known path exceeds the floor, the
    sleep is skipped and the protection is simply gone. It has to be observable,
    or the first anyone knows is an enumerated list.
    """
    make_user("slow@example.test")
    auth.RESPONSE_FLOOR_MS = 0  # any real work now exceeds the floor

    with caplog.at_level("WARNING"):
        request_link(auth, "slow@example.test")

    logged = caplog.text
    assert "waitlist.auth.floor.exceeded" in logged, (
        "exceeding the floor must emit a WARN — a signal that cannot fire is not a signal"
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


def test_requesting_a_second_link_invalidates_the_first(auth):
    """N requests must not leave N-1 live credentials. Single-use has to hold
    for the ACCOUNT, not merely for each token considered alone."""
    uid = make_user("reissue@example.test")
    request_link(auth, "reissue@example.test")
    first = token_for(uid)
    request_link(auth, "reissue@example.test")
    second = token_for(uid)

    assert first != second

    result, body = call(auth, "GET", "/waitlist/auth/verify", params={"token": str(first)})
    assert result["statusCode"] == 410
    assert body["error"] == "token_already_used"

    result, _ = call(auth, "GET", "/waitlist/auth/verify", params={"token": str(second)})
    assert result["statusCode"] == 302, "the newest link must still work"


# ── Logout (M5: revoked_at finally has a producer) ────────────────────────────


def test_logout_revokes_the_session_and_clears_the_cookie(auth):
    uid = make_user("bye@example.test")
    request_link(auth, "bye@example.test")
    verify, _ = call(auth, "GET", "/waitlist/auth/verify", params={"token": str(token_for(uid))})
    cookie = verify["headers"]["Set-Cookie"].split(";")[0]

    result, _ = call(auth, "POST", "/waitlist/auth/logout", cookie=cookie)

    assert result["statusCode"] == 204
    assert "Max-Age=0" in result["headers"]["Set-Cookie"]
    assert query("SELECT revoked_at IS NOT NULL FROM waitlist_sessions")[0][0] is True

    after, body = call(auth, "GET", "/waitlist/auth/session", cookie=cookie)
    assert after["statusCode"] == 401


def test_logout_kills_every_session_not_just_the_one_presenting(auth):
    """Someone logging out because they think they are compromised does not know
    which cookie is the problem."""
    uid = make_user("many@example.test")
    cookies = []
    for _ in range(3):
        request_link(auth, "many@example.test")
        verify, _ = call(auth, "GET", "/waitlist/auth/verify", params={"token": str(token_for(uid))})
        cookies.append(verify["headers"]["Set-Cookie"].split(";")[0])

    call(auth, "POST", "/waitlist/auth/logout", cookie=cookies[0])

    for cookie in cookies:
        result, _ = call(auth, "GET", "/waitlist/auth/session", cookie=cookie)
        assert result["statusCode"] == 401, "every session must be dead, not just the presenting one"


def test_logout_never_reveals_whether_the_cookie_was_valid(auth):
    """Otherwise it becomes an oracle for testing whether a stolen token is
    still live."""
    valid, _ = call(auth, "POST", "/waitlist/auth/logout", cookie="cello_wl_session=nonsense")
    empty, _ = call(auth, "POST", "/waitlist/auth/logout")

    assert valid["statusCode"] == empty["statusCode"] == 204


# ── M6: a live cookie is not a live entitlement ───────────────────────────────


@pytest.mark.parametrize("status", ["banned", "left"])
def test_a_banned_user_keeps_their_status_page_but_cannot_act(auth, status):
    """Reading what happened to you is not the same right as awarding yourself
    points. Previously the actions endpoints never joined waitlist_users at all,
    so a banned user kept earning indefinitely."""
    uid = make_user(f"{status}@example.test")
    request_link(auth, f"{status}@example.test")
    verify, _ = call(auth, "GET", "/waitlist/auth/verify", params={"token": str(token_for(uid))})
    cookie = verify["headers"]["Set-Cookie"].split(";")[0]

    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute("UPDATE waitlist_users SET status = %s WHERE waitlist_id = %s", (status, uid))
    conn.close()

    result, _ = call(auth, "GET", "/waitlist/auth/session", cookie=cookie)
    assert result["statusCode"] == 200, "they can still see their own page"


def test_a_database_fault_on_a_known_address_still_looks_identical(auth, monkeypatch):
    """The categorical oracle, which is worse than the timing one.

    If a psycopg2 error escapes, a known address returns 503 while an unknown
    address returns the opaque 200 — an attacker distinguishes them on status
    alone, no stopwatch needed."""
    make_user("faulty@example.test")

    def boom(*_args, **_kwargs):
        raise psycopg2.OperationalError("server closed the connection unexpectedly")

    monkeypatch.setattr(auth, "_issue_link_if_eligible", boom)

    known_result, known_body = request_link(auth, "faulty@example.test")
    unknown_result, unknown_body = request_link(auth, "absent@example.test")

    assert known_result["statusCode"] == unknown_result["statusCode"] == 200
    assert known_body == unknown_body == auth.OPAQUE_RESPONSE


# ── DOD-STATUS-PAGE-1 / DOD-DYNAMIC-ESTIMATOR-1 ───────────────────────────────


@pytest.mark.parametrize(
    "position,size,expected",
    [
        (1, 100, "top 10%"),
        (10, 100, "top 10%"),
        (11, 100, "top 25%"),
        (25, 100, "top 25%"),
        (26, 100, "top half"),
        (50, 100, "top half"),
        (51, 100, None),
        (99, 100, None),
    ],
)
def test_the_qualitative_band_is_derived_from_real_numbers(auth, position, size, expected):
    """M11-D16 killed the predicted wave number — wave sizes are decided at
    trigger time and cannot be forecast, so any date estimate would be invented.
    A band is two real numbers and a division."""
    assert auth.qualitative_band(position, size) == expected


def test_no_position_means_no_band_rather_than_a_default(auth):
    """A user with no queue row is not in the bottom half — they are not in the
    queue at all, and telling an admitted user "top half" is simply false."""
    assert auth.qualitative_band(None, None) is None
    assert auth.qualitative_band(None, 100) is None


def test_the_session_carries_a_points_breakdown_with_real_caps(auth):
    uid = make_user("points@example.test")
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO points_ledger (waitlist_user_id, points, reason) VALUES (%s, 20, 'survey')",
            (uid,),
        )
        cur.execute(
            "INSERT INTO points_ledger (waitlist_user_id, points, reason) "
            "VALUES (%s, 10, 'share_conversion')",
            (uid,),
        )
    conn.close()
    request_link(auth, "points@example.test")
    verify, _ = call(auth, "GET", "/waitlist/auth/verify", params={"token": str(token_for(uid))})
    cookie = verify["headers"]["Set-Cookie"].split(";")[0]

    _, body = call(auth, "GET", "/waitlist/auth/session", cookie=cookie)

    reasons = {b["reason"]: b for b in body["points_breakdown"]}
    assert reasons["survey"]["points"] == 20
    assert reasons["survey"]["cap"] is None, "survey is uncapped; showing a ceiling would invent one"
    assert reasons["share_conversion"]["cap"] == 30, "the cap shown must be the cap the DB enforces"
    assert body["points_total"] == 30
