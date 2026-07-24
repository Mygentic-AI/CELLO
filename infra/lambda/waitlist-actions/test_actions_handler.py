"""
Tests for the P1 priority action endpoints.

The idempotency tests are the ones each DoD line names explicitly: "call twice;
points increase by exactly N, not 2N". They run through the endpoint AND through
concurrent-style repeats, because the whole reason idempotency lives in the
database is that an application-level check is a read-then-write race.
"""

import hashlib
import json
import secrets
import uuid
from pathlib import Path

import psycopg2
import pytest

from waitlist_testdb import PGURL, query, load_lambda


@pytest.fixture()
def actions(database):
    return load_lambda(Path(__file__).parent, "actions_handler")


def make_user(email="actor@example.test"):
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO waitlist_users (email, anon_id) VALUES (%s, %s) RETURNING waitlist_id",
            (email, str(uuid.uuid4())),
        )
        uid = cur.fetchone()[0]
    conn.close()
    return uid


def sign_in(user_id):
    """Returns a cookie string for a live session."""
    raw = secrets.token_urlsafe(32)
    digest = hashlib.sha256(raw.encode()).hexdigest()
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO waitlist_sessions (waitlist_user_id, token_hash, expires_at) "
            "VALUES (%s, %s, now() + interval '30 days')",
            (user_id, digest),
        )
    conn.close()
    return f"cello_wl_session={raw}"


def connect_platform(user_id, platform="x", handle=None):
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO waitlist_social_profiles (waitlist_user_id, platform, handle) "
            "VALUES (%s, %s, %s)",
            (user_id, platform, handle or f"h{uuid.uuid4().hex[:8]}"),
        )
    conn.close()


def call(actions, path, body, cookie=None):
    headers = {"origin": "https://cello.mygentic.ai"}
    if cookie:
        headers["cookie"] = cookie
    event = {
        "headers": headers,
        "requestContext": {"http": {"method": "POST", "path": path}},
        "body": json.dumps(body),
    }
    result = actions.lambda_handler(event, None)
    return result["statusCode"], json.loads(result["body"])


def total(user_id):
    return query("SELECT points_total FROM waitlist_users WHERE waitlist_id = %s", (user_id,))[0][0]


# ── Auth ──────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "path,body",
    [
        ("/waitlist/survey", {"answers": {"q1": "a"}}),
        ("/waitlist/readiness", {}),
        ("/waitlist/interview-commit", {}),
        ("/waitlist/post-url", {"post_url": "https://x.com/a/1"}),
    ],
)
def test_every_action_requires_a_session(actions, path, body):
    status, payload = call(actions, path, body)
    assert status == 401
    assert payload["error"] == "no_active_session"


def test_points_go_to_the_session_user_not_one_named_in_the_body(actions):
    """Accepting a caller-supplied user id would let anyone award points to
    anyone — including themselves, repeatedly, under other identities."""
    me = make_user("me@example.test")
    someone_else = make_user("victim@example.test")
    cookie = sign_in(me)

    call(actions, "/waitlist/readiness", {"waitlist_user_id": str(someone_else)}, cookie)

    assert total(me) == 20
    assert total(someone_else) == 0


# ── Idempotency (the clause every P1 action line names) ───────────────────────


@pytest.mark.parametrize(
    "path,body,points",
    [
        ("/waitlist/readiness", {}, 20),
        ("/waitlist/interview-commit", {}, 30),
        ("/waitlist/survey", {"answers": {"q1": "a"}}, 20),
    ],
)
def test_calling_twice_awards_the_points_once(actions, path, body, points):
    uid = make_user()
    cookie = sign_in(uid)

    first_status, first = call(actions, path, body, cookie)
    second_status, second = call(actions, path, body, cookie)

    assert first_status == second_status == 200
    assert first["awarded"] == points
    assert second["awarded"] == 0, "a repeat must award nothing, and say so"
    assert total(uid) == points, f"expected exactly {points}, not {points * 2}"


def test_a_repeat_is_not_an_error(actions):
    """The user already has the points; failing the call would make the UI show
    an error for a state that is entirely correct."""
    uid = make_user()
    cookie = sign_in(uid)
    call(actions, "/waitlist/readiness", {}, cookie)

    status, payload = call(actions, "/waitlist/readiness", {}, cookie)

    assert status == 200
    assert payload["points_total"] == 20


def test_ten_repeats_still_award_once(actions):
    uid = make_user()
    cookie = sign_in(uid)
    for _ in range(10):
        call(actions, "/waitlist/interview-commit", {}, cookie)

    assert total(uid) == 30
    assert query(
        "SELECT count(*) FROM points_ledger WHERE waitlist_user_id = %s AND reason = 'interview_commit'",
        (uid,),
    )[0][0] == 1


# ── Survey ────────────────────────────────────────────────────────────────────


def test_survey_freeform_adds_ten_on_top_of_the_structured_twenty(actions):
    uid = make_user()
    cookie = sign_in(uid)

    _, payload = call(
        actions,
        "/waitlist/survey",
        {"answers": {"use": "agents"}, "freeform": "I would use it to connect my own agents."},
        cookie,
    )

    assert payload["awarded"] == 30
    assert total(uid) == 30


def test_survey_without_freeform_awards_only_twenty(actions):
    uid = make_user()
    cookie = sign_in(uid)

    _, payload = call(actions, "/waitlist/survey", {"answers": {"use": "agents"}}, cookie)

    assert payload["awarded"] == 20
    assert total(uid) == 20


def test_a_survey_with_no_answers_is_rejected(actions):
    uid = make_user()
    cookie = sign_in(uid)

    status, payload = call(actions, "/waitlist/survey", {"freeform": "just text"}, cookie)

    assert status == 400
    assert payload["error"] == "missing_answers"
    assert total(uid) == 0


def test_the_survey_answers_are_stored(actions):
    """+20 for a survey nobody can read is a number with no evidence behind it."""
    uid = make_user()
    cookie = sign_in(uid)
    call(actions, "/waitlist/survey", {"answers": {"agents": "3-9"}}, cookie)

    meta = query(
        "SELECT meta FROM points_ledger WHERE waitlist_user_id = %s AND reason = 'survey'", (uid,)
    )[0][0]
    assert meta["answers"] == {"agents": "3-9"}


# ── Post URL (DOD-POST-CREDIT-1, M11-D4) ──────────────────────────────────────


def test_submitting_a_post_awards_no_points_and_queues_it_unreviewed(actions):
    uid = make_user()
    connect_platform(uid, "x")
    cookie = sign_in(uid)

    status, payload = call(actions, "/waitlist/post-url", {"post_url": "https://x.com/me/1"}, cookie)

    assert status == 200
    assert payload["awarded"] == 0, "M11-D4: credit is applied on ops approval only"
    assert total(uid) == 0
    row = query("SELECT platform, reviewed_at, outcome FROM post_review_queue")[0]
    assert row == ("x", None, None)


@pytest.mark.parametrize(
    "url,platform",
    [
        ("https://x.com/user/status/1", "x"),
        ("https://twitter.com/user/status/1", "x"),
        ("https://www.reddit.com/r/x/comments/1", "reddit"),
        ("https://old.reddit.com/r/x/comments/1", "reddit"),
        ("https://www.linkedin.com/posts/1", "linkedin"),
    ],
)
def test_the_platform_is_derived_from_the_host(actions, url, platform):
    uid = make_user(f"{platform}{uuid.uuid4().hex[:6]}@example.test")
    connect_platform(uid, platform)
    cookie = sign_in(uid)

    status, payload = call(actions, "/waitlist/post-url", {"post_url": url}, cookie)

    assert status == 200, payload
    assert payload["platform"] == platform


def test_an_unrecognised_host_is_refused_rather_than_guessed(actions):
    """A row with an unattributable platform reaches a human reviewer looking
    exactly as checked as a real one."""
    uid = make_user()
    connect_platform(uid, "x")
    cookie = sign_in(uid)

    status, payload = call(
        actions, "/waitlist/post-url", {"post_url": "https://example.com/post"}, cookie
    )

    assert status == 400
    assert payload["error"] == "unsupported_platform"
    assert query("SELECT count(*) FROM post_review_queue")[0][0] == 0


def test_a_post_for_an_unconnected_platform_is_queued_but_flagged(actions):
    """Accepted, and marked unverified for the human reviewer.

    Refusing would have made the entire post-credit path unreachable: OAuth is
    parked on external app registration, so nothing can create a profile row and
    every real submission would 403 forever. Handle ownership still matters —
    it is recorded rather than required, and M11-D4 already has a human in the
    loop to act on it.
    """
    uid = make_user()
    connect_platform(uid, "x")
    cookie = sign_in(uid)

    status, payload = call(
        actions, "/waitlist/post-url", {"post_url": "https://www.reddit.com/r/a/comments/1"}, cookie
    )

    assert status == 200
    assert payload["handle_verified"] is False, (
        "the submitter must be told their post needs manual authorship confirmation"
    )
    assert query(
        "SELECT handle_verified FROM post_review_queue WHERE platform = 'reddit'"
    )[0][0] is False


def test_a_post_on_a_connected_platform_is_marked_verified(actions):
    uid = make_user()
    connect_platform(uid, "x")
    cookie = sign_in(uid)

    _, payload = call(actions, "/waitlist/post-url", {"post_url": "https://x.com/me/9"}, cookie)

    assert payload["handle_verified"] is True


def test_the_post_path_works_with_no_oauth_at_all(actions):
    """The regression that mattered: with OAuth parked, a user who has connected
    NOTHING must still be able to submit."""
    uid = make_user()
    cookie = sign_in(uid)

    status, payload = call(actions, "/waitlist/post-url", {"post_url": "https://x.com/me/10"}, cookie)

    assert status == 200, payload
    assert query("SELECT count(*) FROM post_review_queue")[0][0] == 1


def test_the_same_post_cannot_be_submitted_twice(actions):
    uid = make_user()
    connect_platform(uid, "x")
    cookie = sign_in(uid)
    call(actions, "/waitlist/post-url", {"post_url": "https://x.com/me/2"}, cookie)

    status, payload = call(actions, "/waitlist/post-url", {"post_url": "https://x.com/me/2"}, cookie)

    assert status == 409
    assert payload["error"] == "already_submitted"
    assert query("SELECT count(*) FROM post_review_queue")[0][0] == 1


@pytest.mark.parametrize("bad", ["", "   ", "javascript:alert(1)", "ftp://x.com/a"])
def test_a_non_http_url_is_refused(actions, bad):
    uid = make_user()
    connect_platform(uid, "x")
    cookie = sign_in(uid)

    status, _ = call(actions, "/waitlist/post-url", {"post_url": bad}, cookie)

    assert status == 400
    assert query("SELECT count(*) FROM post_review_queue")[0][0] == 0


# ── Cross-cutting ─────────────────────────────────────────────────────────────


def test_all_four_actions_stack_to_the_expected_total(actions):
    uid = make_user()
    connect_platform(uid, "x")
    cookie = sign_in(uid)

    call(actions, "/waitlist/survey", {"answers": {"a": 1}, "freeform": "words"}, cookie)
    call(actions, "/waitlist/readiness", {}, cookie)
    call(actions, "/waitlist/interview-commit", {}, cookie)
    call(actions, "/waitlist/post-url", {"post_url": "https://x.com/me/3"}, cookie)

    # 20 + 10 + 20 + 30, and nothing for the unreviewed post.
    assert total(uid) == 80


def test_an_expired_session_cannot_award_points(actions):
    uid = make_user()
    raw = secrets.token_urlsafe(32)
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO waitlist_sessions (waitlist_user_id, token_hash, created_at, expires_at) "
            "VALUES (%s, %s, now() - interval '31 days', now() - interval '1 day')",
            (uid, hashlib.sha256(raw.encode()).hexdigest()),
        )
    conn.close()

    status, _ = call(actions, "/waitlist/readiness", {}, f"cello_wl_session={raw}")

    assert status == 401
    assert total(uid) == 0


@pytest.mark.parametrize("status", ["banned", "left"])
def test_a_banned_user_cannot_award_themselves_points(actions, status):
    """A live cookie is not a live entitlement. The previous session query never
    joined waitlist_users, so a banned user kept earning indefinitely."""
    uid = make_user(f"{status}@example.test")
    cookie = sign_in(uid)
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute("UPDATE waitlist_users SET status = %s WHERE waitlist_id = %s", (status, uid))
    conn.close()

    result, payload = call(actions, "/waitlist/readiness", {}, cookie)

    assert result == 403
    assert payload["error"] == f"account_{status}"
    assert total(uid) == 0
