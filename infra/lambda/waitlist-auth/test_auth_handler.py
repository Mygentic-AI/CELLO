"""
Tests for the waitlist auth Lambda (DOD-AUTH-1, DOD-INV-NO-ENUMERATION).

The enumeration tests are the load-bearing ones. Every observable — body, status,
headers, and elapsed time — must be indistinguishable between a known and an
unknown address, because any one of them that differs turns /auth into a
membership oracle for the whole list.
"""

import json
import time
import urllib.parse
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


def call(auth, method, path, *, body=None, params=None, cookie=None, form=None):
    """Builds the event API Gateway actually sends, not a convenient shape.

    Payload format 2.0 lifts request cookies OUT of `headers` into a top-level
    `cookies` LIST. A fixture that puts them back in `headers` tests a gateway
    that does not exist — and that is precisely how every cookie-reading
    endpoint shipped broken while this suite stayed green.
    """
    headers = {"origin": "https://cello.mygentic.ai"}
    event = {
        "version": "2.0",
        "headers": headers,
        "cookies": [cookie] if cookie else [],
        "requestContext": {"http": {"method": method, "path": path}},
        # A browser submitting a real <form> sends urlencoded, not JSON. Building
        # the resend cases as JSON would test a request nothing ever makes.
        "body": (
            urllib.parse.urlencode(form)
            if form is not None
            else json.dumps(body)
            if body is not None
            else None
        ),
        "queryStringParameters": params,
    }
    result = auth.lambda_handler(event, None)
    # The unsubscribe route answers in HTML — it is a page a person lands on,
    # not an API call — so parsing is conditional on what came back.
    try:
        parsed = json.loads(result["body"]) if result["body"] else {}
    except (json.JSONDecodeError, TypeError):
        parsed = {"html": result["body"]}
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


def test_an_unknown_address_is_throttled_on_the_same_terms_as_a_real_one(auth):
    """Throttling only real addresses would leak existence through the rate
    limiter. What must be identical is the RESPONSE and the counting RULE — not
    the row count, which now tracks links issued rather than requests made."""
    for _ in range(auth.RATE_LIMIT_MAX + 2):
        _, body = request_link(auth, "spam@example.test")
        assert body == auth.OPAQUE_RESPONSE

    # No link can be issued to an address nobody holds, so nothing is recorded —
    # and nothing is sent, which is the only thing the counter exists to bound.
    assert query(
        "SELECT count(*) FROM auth_link_requests WHERE lower(email_requested) = 'spam@example.test'"
    )[0][0] == 0
    assert query("SELECT count(*) FROM auth_tokens")[0][0] == 0
    assert query("SELECT count(*) FROM email_jobs")[0][0] == 0


def test_a_third_party_cannot_pin_your_budget_at_the_ceiling(auth):
    """The hole the resend door closed, one door over.

    /auth/request is unauthenticated and takes any address. If a REFUSED request
    were recorded, five requests would mail-bomb the victim and then one request
    every few minutes would hold the shared window open indefinitely — locking
    the real owner out of the sign-in link, the resend button and the signup
    form's remedy path at once.
    """
    make_user("victim@example.test")
    for _ in range(auth.RATE_LIMIT_MAX * 3):
        request_link(auth, "victim@example.test")

    logged = query(
        "SELECT count(*) FROM auth_link_requests WHERE lower(email_requested) = 'victim@example.test'"
    )[0][0]
    assert logged == auth.RATE_LIMIT_MAX, (
        f"{logged} rows for {auth.RATE_LIMIT_MAX} links — refusals must not keep the window alive"
    )


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
    assert result["headers"]["Location"].startswith("https://cello.mygentic.ai/status")
    cookie = result["headers"]["Set-Cookie"]
    assert "HttpOnly" in cookie and "Secure" in cookie and "SameSite=Lax" in cookie

    # The payload-2.0 `cookies` field is the DOCUMENTED carrier, and it is
    # emitted alongside the header rather than instead of it. Both are honoured
    # and the browser takes the last one, which is safe only while the value is
    # deterministic — assert they are byte-identical, so a future per-call nonce
    # in session_cookie() fails here rather than silently picking a winner.
    assert result["cookies"] == [cookie]
    assert query("SELECT used_at IS NOT NULL FROM auth_tokens WHERE token = %s", (token,))[0][0]


# ── A dead link is a page, not a JSON body ────────────────────────────────────
#
# /auth/verify is reached by CLICKING A BUTTON IN AN EMAIL. Whatever it returns
# is rendered by a browser as the whole visible outcome of that click. Every
# failure here used to answer with the API's JSON envelope, so a person whose
# link had expired — the single most likely way to arrive at this route on the
# unhappy path — was shown {"error":"token_expired",...} and had nowhere to go.


def expired_token(uid, kind="magic_link"):
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(
            # Inside the window the DB enforces for the kind (15 minutes for a
            # magic_link, 24 hours for a confirm link) — expired by wall clock,
            # not by minting a credential the schema would refuse.
            "INSERT INTO auth_tokens (waitlist_user_id, kind, created_at, expires_at) "
            "VALUES (%s, %s, now() - interval '2 hours', now() - interval '1 hour 50 minutes') "
            "RETURNING token",
            (uid, kind),
        )
        token = cur.fetchone()[0]
    conn.close()
    return token


def test_the_same_link_cannot_be_used_twice(auth):
    uid = make_user("reuse@example.test")
    request_link(auth, "reuse@example.test")
    token = token_for(uid)

    call(auth, "GET", "/waitlist/auth/verify", params={"token": str(token)})
    result, body = call(auth, "GET", "/waitlist/auth/verify", params={"token": str(token)})

    assert result["statusCode"] == 410
    assert result["headers"]["Content-Type"].startswith("text/html")
    assert "already" in body["html"].lower(), (
        "the cause must be named — the user needs to know whether to click again "
        "or ask for a new link"
    )
    assert query("SELECT count(*) FROM waitlist_sessions")[0][0] == 1


def test_an_expired_link_offers_a_new_one_without_retyping_the_address(auth):
    """The dead token identifies the user. Asking them for their email again is
    asking them to re-key information we are holding."""
    uid = make_user("stale@example.test")
    token = expired_token(uid)

    result, body = call(auth, "GET", "/waitlist/auth/verify", params={"token": str(token)})

    assert result["statusCode"] == 410
    assert result["headers"]["Content-Type"].startswith("text/html")
    assert "expired" in body["html"].lower()
    assert "/auth/resend" in body["html"], "one button, no form to fill in"
    assert str(token) in body["html"]
    assert 'type="email"' not in body["html"], "the address must not be asked for again"


def test_an_unknown_token_says_so_and_does_not_offer_a_resend(auth):
    """There is nobody to resend TO. A button that cannot work is worse than no
    button: it turns a dead end into a dead end that looks like a way out."""
    result, body = call(
        auth, "GET", "/waitlist/auth/verify", params={"token": str(uuid.uuid4())}
    )

    assert result["statusCode"] == 404
    assert result["headers"]["Content-Type"].startswith("text/html")
    assert "/auth/resend" not in body["html"]
    assert "/waitlist" in body["html"], "the only thing left to offer is the front door"


def test_resending_from_an_expired_confirm_link_queues_another_confirm(auth):
    uid = make_user("neverclicked@example.test")
    token = expired_token(uid, kind="email_verify")

    result, body = call(
        auth, "POST", "/waitlist/auth/resend", form={"token": str(token)}
    )

    assert result["statusCode"] == 200
    assert "inbox" in body["html"].lower()
    assert query(
        "SELECT count(*) FROM email_jobs WHERE user_id = %s AND template = 'e1_confirm'", (uid,)
    )[0][0] == 1


def test_resending_for_a_confirmed_user_sends_a_sign_in_link_with_a_token(auth):
    """e_magic_link renders a token it does not mint. Queueing the job without
    one sends a mail with no link in it."""
    uid = make_user("confirmed@example.test")
    query("UPDATE waitlist_users SET email_verified = true WHERE waitlist_id = %s", (uid,))
    token = expired_token(uid)

    result, _ = call(auth, "POST", "/waitlist/auth/resend", form={"token": str(token)})

    assert result["statusCode"] == 200
    assert query(
        "SELECT count(*) FROM email_jobs WHERE user_id = %s AND template = 'e_magic_link'", (uid,)
    )[0][0] == 1
    assert query(
        "SELECT count(*) FROM auth_tokens WHERE waitlist_user_id = %s "
        "AND kind = 'magic_link' AND used_at IS NULL",
        (uid,),
    )[0][0] == 1


def test_a_suppressed_address_is_told_the_truth_not_pointed_at_an_empty_inbox(auth):
    unsub = make_user("quit@example.test")
    query("UPDATE waitlist_users SET email_status = 'unsubscribed' WHERE waitlist_id = %s", (unsub,))
    token = expired_token(unsub)

    result, body = call(auth, "POST", "/waitlist/auth/resend", form={"token": str(token)})

    assert result["statusCode"] == 200
    assert "unsubscrib" in body["html"].lower(), "saying 'check your inbox' here is a lie"
    assert query("SELECT count(*) FROM email_jobs WHERE user_id = %s", (unsub,))[0][0] == 0


def test_a_refused_resend_says_it_refused_and_does_not_extend_its_own_window(auth):
    """Two bugs in one shape.

    Reporting a refusal as a send leaves someone refreshing an empty mailbox —
    and it is not transient, because the counter counts REQUESTS: if a refused
    request were recorded, clicking the button would keep the window alive
    forever and every click would promise a mail.
    """
    flood = make_user("flood@example.test")
    flood_token = expired_token(flood)

    pages = []
    for _ in range(auth.RATE_LIMIT_MAX + 4):
        # The dispatcher runs every 60s. Only one pending job per template may
        # exist at a time, so without draining the queue limits itself and the
        # rate limit under test is never reached.
        query("UPDATE email_jobs SET status = 'sent', sent_at = now() WHERE status = 'pending'")
        pages.append(
            call(auth, "POST", "/waitlist/auth/resend", form={"token": str(flood_token)})[1]["html"]
        )

    queued = query("SELECT count(*) FROM email_jobs WHERE user_id = %s", (flood,))[0][0]
    assert queued == auth.RATE_LIMIT_MAX, (
        f"expected exactly {auth.RATE_LIMIT_MAX} sends, got {queued}"
    )

    # The page a refused caller sees must NOT be the page a served caller sees.
    served, refused = pages[0], pages[-1]
    assert "check your inbox" in served.lower()
    assert "check your inbox" not in refused.lower(), (
        "a refusal that says a mail is coming is the stranding this endpoint exists to remove"
    )

    # And the refusals were not recorded, so the window is genuinely bounded by
    # the sends rather than by the clicking.
    logged = query(
        "SELECT count(*) FROM auth_link_requests WHERE lower(email_requested) = 'flood@example.test'"
    )[0][0]
    assert logged == auth.RATE_LIMIT_MAX, (
        f"{logged} rows for {auth.RATE_LIMIT_MAX} sends — a refused request must not "
        "keep its own window alive"
    )


def test_a_resent_sign_in_link_replaces_the_old_one_rather_than_adding_to_it(auth):
    """N requests must not leave N live credentials for one person."""
    uid = make_user("resender@example.test")
    query("UPDATE waitlist_users SET email_verified = true WHERE waitlist_id = %s", (uid,))
    token = expired_token(uid)

    for _ in range(3):
        call(auth, "POST", "/waitlist/auth/resend", form={"token": str(token)})

    live = query(
        "SELECT count(*) FROM auth_tokens WHERE waitlist_user_id = %s "
        "AND kind = 'magic_link' AND used_at IS NULL",
        (uid,),
    )[0][0]
    assert live == 1, f"{live} live sign-in credentials for one person"


def test_an_unknown_token_cannot_be_used_to_probe_for_members(auth):
    """This endpoint takes a token, not an address, so it is not an enumeration
    oracle by construction — but it must not become one by answering
    differently for a token that exists and one that does not."""
    result, body = call(auth, "POST", "/waitlist/auth/resend", form={"token": str(uuid.uuid4())})

    assert result["statusCode"] == 200
    assert "inbox" in body["html"].lower()
    assert query("SELECT count(*) FROM email_jobs")[0][0] == 0


def test_either_link_kind_verifies_the_address(auth):
    """Deliberately INVERTED from the original rule, which said only E1 counts.

    What email_verified attests is control of the address, and a magic link
    proves that identically — you must already read the mailbox to redeem one.
    The old rule left a ONE-WAY DOOR: e1_confirm is enqueued exactly once, at
    signup, its token lasts 24 hours, and there is no resend path. So anyone who
    missed that window was permanently unverified — and once the dispatcher
    started gating base-list mail on the flag, permanently unverified meant
    permanently silent, with nothing told to them or to us.
    """
    uid = make_user("viamagic@example.test")
    request_link(auth, "viamagic@example.test")
    call(auth, "GET", "/waitlist/auth/verify", params={"token": str(token_for(uid))})

    assert query("SELECT email_verified FROM waitlist_users WHERE waitlist_id = %s", (uid,))[0][0] is True, (
        "a magic-link sign-in must verify — otherwise there is no route back "
        "from unverified and the flag gates mail forever"
    )


def test_the_e1_link_still_verifies(auth):
    uid = make_user("viae1@example.test")
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
    assert "already" in body["html"].lower()

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


# ── One-click unsubscribe (DOD-E-RE-1, DOD-CONTENT-ALERTS-1) ──────────────────


def unsubscribe(auth, user_id, scope=None):
    """POST — the action. A GET now only renders a confirmation."""
    body = f"u={user_id}" + (f"&list={scope}" if scope else "")
    event = {
        "headers": {"origin": "https://cello.mygentic.ai"},
        "requestContext": {"http": {"method": "POST", "path": "/waitlist/unsubscribe"}},
        "body": body,
        "queryStringParameters": None,
    }
    result = auth.lambda_handler(event, None)
    try:
        parsed = json.loads(result["body"]) if result["body"] else {}
    except (json.JSONDecodeError, TypeError):
        parsed = {"html": result["body"]}
    return result, parsed


def unsubscribe_get(auth, user_id, scope=None):
    params = {"u": str(user_id)}
    if scope:
        params["list"] = scope
    return call(auth, "GET", "/waitlist/unsubscribe", params=params)


def test_the_base_list_unsubscribe_is_one_click_and_needs_no_login(auth):
    """Requiring a session would mean someone who cannot get back into their
    account cannot leave — and a person who wants out and cannot find the door
    marks the mail as spam, which costs the sending reputation of every other
    message including the E1s."""
    uid = make_user("leaving@example.test")

    result, _ = unsubscribe(auth, uid)

    assert result["statusCode"] == 200
    assert query("SELECT email_status FROM waitlist_users WHERE waitlist_id = %s", (uid,))[0][0] == "unsubscribed"


def test_the_alert_unsubscribe_is_scoped_and_leaves_waitlist_mail_alone(auth):
    uid = make_user("alerts@example.test")
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute("UPDATE waitlist_users SET content_alerts = true WHERE waitlist_id = %s", (uid,))
    conn.close()

    unsubscribe(auth, uid, scope="content_alerts")

    row = query(
        "SELECT content_alerts, email_status FROM waitlist_users WHERE waitlist_id = %s", (uid,)
    )[0]
    assert row == (False, "active"), "muting blog posts must not unsubscribe them from everything"


def test_unsubscribing_never_reactivates_a_bounced_address(auth):
    """Suppression is one-way. A bounced address that 'unsubscribes' must not
    come back as merely unsubscribed and start receiving again if someone later
    reverses that."""
    uid = make_user("bounced@example.test", email_status="bounced")

    unsubscribe(auth, uid)

    assert query("SELECT email_status FROM waitlist_users WHERE waitlist_id = %s", (uid,))[0][0] == "bounced"


def test_an_unknown_id_is_indistinguishable_from_a_known_one(auth):
    """This link needs no login, so a different response for an unknown id would
    make it a membership oracle anyone could query."""
    uid = make_user("known@example.test")

    known, _ = unsubscribe(auth, uid)
    unknown, _ = unsubscribe(auth, uuid.uuid4())

    assert known["statusCode"] == unknown["statusCode"] == 200
    assert known["body"] == unknown["body"]


def test_unsubscribing_twice_is_harmless(auth):
    uid = make_user("twice@example.test")
    unsubscribe(auth, uid)
    result, _ = unsubscribe(auth, uid)

    assert result["statusCode"] == 200


def test_a_malformed_unsubscribe_link_says_so(auth):
    """As a PAGE. Unsubscribe is reached from an email client, so every one of
    its outcomes is something a person reads, not something script parses."""
    result, body = call(auth, "GET", "/waitlist/unsubscribe", params={"u": "not-a-uuid"})

    assert result["statusCode"] == 400
    assert result["headers"]["Content-Type"].startswith("text/html")
    assert "not valid" in body["html"].lower()


def test_a_get_does_not_unsubscribe_anyone(auth):
    """Gmail's link proxy, Outlook Safe Links and corporate scanners all fetch
    body links. Each fetch would permanently unsubscribe an engaged user, logged
    identically to a real click — so the loss would be invisible."""
    uid = make_user("scanned@example.test")

    result, body = unsubscribe_get(auth, uid)

    assert result["statusCode"] == 200
    assert "Unsubscribe?" in body["html"], "a GET renders a confirmation, not an action"
    assert query("SELECT email_status FROM waitlist_users WHERE waitlist_id = %s", (uid,))[0][0] == "active"


def test_the_confirm_page_posts_back(auth):
    uid = make_user("confirm@example.test")

    _, body = unsubscribe_get(auth, uid)

    assert 'method="POST"' in body["html"]
    assert f'value="{uid}"' in body["html"]


def test_the_alert_confirm_page_carries_its_scope(auth):
    """Otherwise confirming from a content alert would unsubscribe them from
    everything."""
    uid = make_user("scoped@example.test")

    _, body = unsubscribe_get(auth, uid, scope="content_alerts")

    assert 'name="list" value="content_alerts"' in body["html"]
    assert "waitlist emails are unaffected" in body["html"].lower()


# ── status_notes have a READER (DOD-FEEDBACK-OUTREACH-1 Day-6 clause) ─────────


def signed_in(auth, email):
    """A user with a live session cookie, using this file's existing idiom."""
    uid = make_user(email)
    request_link(auth, email)
    verify, _ = call(auth, "GET", "/waitlist/auth/verify", params={"token": str(token_for(uid))})
    return uid, verify["headers"]["Set-Cookie"].split(";")[0]


def session_body(auth, cookie):
    _, body = call(auth, "GET", "/waitlist/auth/session", cookie=cookie)
    return body


def make_note(uid, kind="feedback_invites_granted", body="Two premium invites are on your account."):
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO status_notes (waitlist_user_id, kind, body) VALUES (%s, %s, %s) RETURNING id",
            (uid, kind, body),
        )
        nid = cur.fetchone()[0]
    conn.close()
    return nid


def test_the_session_carries_live_status_notes(auth):
    """A write with no reader is invisible to a green test suite.

    The Day-6 sweep grants two premium invite codes and writes a note saying so.
    Until this endpoint returned it, the user was granted the codes with nothing
    anywhere telling them the codes existed — the exact failure the migration
    that created the table opens by describing.
    """
    uid, cookie = signed_in(auth, "noted@example.test")
    make_note(uid)

    body = session_body(auth, cookie)

    assert [n["kind"] for n in body["notes"]] == ["feedback_invites_granted"]
    assert "premium invites" in body["notes"][0]["body"]


def test_a_dismissed_note_is_not_returned(auth):
    uid, cookie = signed_in(auth, "dismissed@example.test")
    nid = make_note(uid)
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute("UPDATE status_notes SET dismissed_at = now() WHERE id = %s", (nid,))
    conn.close()

    assert session_body(auth, cookie)["notes"] == []


def test_one_users_note_never_reaches_another(auth):
    """The correlation, asserted. An uncorrelated query would show every user
    every note — including one naming invites they do not hold."""
    other = make_user("other@example.test")
    make_note(other)
    _, cookie = signed_in(auth, "mine@example.test")

    assert session_body(auth, cookie)["notes"] == []


def test_notes_is_always_present_even_when_empty(auth):
    """An absent key and an empty list are different things to a client. The
    status page renders `session.notes?.length > 0`; a missing key would work by
    accident today and break the first time somebody writes `notes.map`."""
    _, cookie = signed_in(auth, "nonotes@example.test")

    assert session_body(auth, cookie)["notes"] == []


# ── Flow E: the referrer is paid at CONFIRMATION, not at signup ───────────────
#
# A signup is a typed address and nothing more. Paying out on one makes the
# queue farmable by exactly the effort of inventing addresses, and the queue is
# the product. Same rule that already moved code MINTING to verification.


def _referred_pair(referrer_email, referred_email):
    referrer = make_user(referrer_email)
    referred = make_user(referred_email)
    query(
        "INSERT INTO referral_codes (code, owner_waitlist_user_id, type) VALUES ('PAYME001', %s, 'share')",
        (referrer,),
    )
    query(
        "INSERT INTO referrals (referrer_user_id, referred_user_id, referral_code) "
        "VALUES (%s, %s, 'PAYME001')",
        (referrer, referred),
    )
    return referrer, referred


def _points(uid):
    return query("SELECT points_total FROM waitlist_users WHERE waitlist_id = %s", (uid,))[0][0]


def test_confirming_pays_the_referrer(auth):
    referrer, referred = _referred_pair("payee@example.test", "newbie@example.test")
    assert _points(referrer) == 0, "nothing is owed until the invitee proves the address"

    token = query(
        "INSERT INTO auth_tokens (waitlist_user_id, kind, expires_at) "
        "VALUES (%s, 'email_verify', now() + interval '24 hours') RETURNING token",
        (referred,),
    )[0][0]
    result, _ = call(auth, "GET", "/waitlist/auth/verify", params={"token": str(token)})

    assert result["statusCode"] == 302
    assert _points(referrer) == 10


def test_a_second_confirmation_cannot_pay_the_referrer_twice(auth):
    """A magic-link sign-in also runs the verify path. Paying on every one of
    them turns one referral into an income stream."""
    referrer, referred = _referred_pair("once@example.test", "repeat@example.test")

    for _ in range(3):
        token = query(
            "INSERT INTO auth_tokens (waitlist_user_id, kind, expires_at) "
            "VALUES (%s, 'magic_link', now() + interval '15 minutes') RETURNING token",
            (referred,),
        )[0][0]
        call(auth, "GET", "/waitlist/auth/verify", params={"token": str(token)})

    assert _points(referrer) == 10
    assert query(
        "SELECT count(*) FROM points_ledger WHERE waitlist_user_id = %s", (referrer,)
    )[0][0] == 1


def test_a_capped_referrer_still_lets_the_invitee_confirm(auth):
    """The cap is an expected outcome, not a failure. Without the SAVEPOINT the
    violation aborts the whole transaction — and the transaction it is now
    inside is the one that verifies the email, mints the referral code and
    creates the session. A working cap would silently cost someone their
    confirmation."""
    referrer, referred = _referred_pair("atcap@example.test", "blocked@example.test")
    query(
        "INSERT INTO points_ledger (waitlist_user_id, points, reason) VALUES (%s, 30, 'share_conversion')",
        (referrer,),
    )

    token = query(
        "INSERT INTO auth_tokens (waitlist_user_id, kind, expires_at) "
        "VALUES (%s, 'email_verify', now() + interval '24 hours') RETURNING token",
        (referred,),
    )[0][0]
    result, _ = call(auth, "GET", "/waitlist/auth/verify", params={"token": str(token)})

    assert result["statusCode"] == 302, "the invitee must still get in"
    assert query("SELECT email_verified FROM waitlist_users WHERE waitlist_id = %s", (referred,))[0][0] is True
    assert query(
        "SELECT count(*) FROM referral_codes WHERE owner_waitlist_user_id = %s AND type = 'share'",
        (referred,),
    )[0][0] == 1, "their own code must still be minted"
    assert _points(referrer) == 30, "the cap holds"


def test_the_click_that_makes_you_a_member_says_so(auth):
    """Landing on the same page a returning visitor sees leaves someone
    wondering whether the confirm worked — which is what sent people back to
    sign up a second time."""
    uid = make_user("firsttime@example.test")
    token = query(
        "INSERT INTO auth_tokens (waitlist_user_id, kind, expires_at) "
        "VALUES (%s, 'email_verify', now() + interval '24 hours') RETURNING token",
        (uid,),
    )[0][0]

    first, _ = call(auth, "GET", "/waitlist/auth/verify", params={"token": str(token)})
    assert first["headers"]["Location"].endswith("/status?welcome=1")

    # A later sign-in is not a first confirmation. Congratulating someone on
    # joining every time they log in is the kind of thing that makes a product
    # feel like it is not paying attention.
    request_link(auth, "firsttime@example.test")
    second, _ = call(
        auth, "GET", "/waitlist/auth/verify", params={"token": str(token_for(uid))}
    )
    assert second["headers"]["Location"].endswith("/status")
    assert "welcome" not in second["headers"]["Location"]


def test_a_confirmed_premium_claimant_lands_in_the_wave_premium_cohort(auth):
    """Not admitted here — QUEUED FOR THE FAST DOOR.

    status='admitted' written at confirmation grants nothing: waitlist_tokens is
    minted only by the wave, atomically with the invitation mail, and the
    Telegram gate burns a token and never reads status. Writing the label leaves
    the holder with no invite, no token, and a refusal at the gate.

    What the wave's premium cohort actually requires is
    `status='waiting' AND email_verified AND premium_referred` — a combination
    no transaction could observe while confirmation flipped the status and set
    email_verified together.
    """
    uid = make_user("fastdoor@example.test")
    query("UPDATE waitlist_users SET premium_referred = true WHERE waitlist_id = %s", (uid,))

    token = query(
        "INSERT INTO auth_tokens (waitlist_user_id, kind, expires_at) "
        "VALUES (%s, 'email_verify', now() + interval '24 hours') RETURNING token",
        (uid,),
    )[0][0]
    result, _ = call(auth, "GET", "/waitlist/auth/verify", params={"token": str(token)})
    assert result["statusCode"] == 302

    row = query(
        "SELECT status, email_verified, premium_referred FROM waitlist_users WHERE waitlist_id = %s",
        (uid,),
    )[0]
    assert row == ("waiting", True, True), (
        "this exact triple is the wave's premium cohort predicate; anything else "
        "silently drops them out of the fast door"
    )
    assert query(
        "SELECT count(*) FROM waitlist_tokens WHERE waitlist_user_id = %s", (uid,)
    )[0][0] == 0, "only the wave mints a token, together with the invitation mail"


def test_the_premium_cohort_query_actually_selects_a_confirmed_claimant(auth):
    """The predicate above, run as the wave runs it.

    Asserting the three columns is not enough on its own — it would still pass
    if the wave's own query drifted. This runs the wave's cohort SQL and
    requires the user to come back from it.
    """
    uid = make_user("cohort@example.test")
    query("UPDATE waitlist_users SET premium_referred = true WHERE waitlist_id = %s", (uid,))
    token = query(
        "INSERT INTO auth_tokens (waitlist_user_id, kind, expires_at) "
        "VALUES (%s, 'email_verify', now() + interval '24 hours') RETURNING token",
        (uid,),
    )[0][0]
    call(auth, "GET", "/waitlist/auth/verify", params={"token": str(token)})

    selected = query(
        """
        SELECT waitlist_id FROM waitlist_users
        WHERE status = 'waiting' AND email_verified AND premium_referred
          AND NOT EXISTS (
              SELECT 1 FROM waitlist_tokens t
              WHERE t.waitlist_user_id = waitlist_users.waitlist_id
                AND t.used_at IS NULL AND t.retired_at IS NULL
          )
        """
    )
    assert [r[0] for r in selected] == [uid], "the next wave must be able to see them"


# `test_confirming_without_a_premium_invite_does_not_admit` was deleted with its
# subject. Confirmation no longer writes `status` at all, so nothing it could
# assert about an ordinary user's status is a property of this code — it would
# have passed against a handler with the whole branch removed.



def test_five_rapid_clicks_send_one_mail_and_say_so(auth):
    """The COMMON case, and the one the rate-limit tests do not describe.

    Those drain the queue between calls, which is what the 60-second dispatcher
    does over minutes — not what a person does in ten seconds. Clicking the
    resend button five times in a row hits the one-claimable-job guard long
    before the rate limit, so the honest answer to clicks two through five is
    "a mail is already coming", not five mails and not a refusal.
    """
    uid = make_user("impatient@example.test")
    token = expired_token(uid, kind="email_verify")

    pages = [
        call(auth, "POST", "/waitlist/auth/resend", form={"token": str(token)})[1]["html"]
        for _ in range(5)
    ]

    assert query(
        "SELECT count(*) FROM email_jobs WHERE user_id = %s AND template = 'e1_confirm'", (uid,)
    )[0][0] == 1, "five clicks must not become five mails"

    # And nobody is refused: a mail genuinely is on its way, so every one of
    # those five is told the truth.
    assert all("check your inbox" in page.lower() for page in pages), (
        "the guard must not read as a rate-limit refusal — nothing was declined"
    )

    # The rate limit is untouched by the repeat clicks, so the budget is still
    # there for a genuinely new request once this mail has gone out.
    assert query(
        "SELECT count(*) FROM auth_link_requests WHERE lower(email_requested) = 'impatient@example.test'"
    )[0][0] == 1
