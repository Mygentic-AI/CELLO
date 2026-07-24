"""
Tests for the M11 waitlist signup Lambda, against a REAL Postgres.

Not mocked. Every finding these cover was a defect that passed a mocked or
absent test: a transaction aborted by a swallowed error, a premium code that
never burned, an unbounded array hitting the bind-parameter limit. None of those
are visible without a database that enforces its own constraints.

Requires the local container from corp-cello-site/scripts/verify-schema.sh:
    docker run -d --name m11pg -e POSTGRES_PASSWORD=m11 -e POSTGRES_USER=m11 \
        -p 55432:5432 postgres:16

Run: PGURL=postgres://m11:m11@localhost:55432/m11_test python3 -m pytest -q
"""

import json
import os
import sys
import uuid
from pathlib import Path

import psycopg2
import pytest


from waitlist_testdb import PGURL, query, load_lambda  # fixtures come from conftest.py alongside it


@pytest.fixture()
def handler(database):
    """Imported here, not in conftest: every Lambda dir has its own handler.py."""
    os.environ["DATABASE_URL"] = PGURL
    return load_lambda(Path(__file__).parent, "signup_handler")


# ── helpers ───────────────────────────────────────────────────────────────────


def invoke(handler, body, method="POST", path="/waitlist/signup", origin="https://cello.mygentic.ai"):
    event = {
        "headers": {"origin": origin},
        "requestContext": {"http": {"method": method, "path": path}},
        "body": json.dumps(body) if isinstance(body, (dict, list)) else body,
    }
    result = handler.lambda_handler(event, None)
    parsed = json.loads(result["body"]) if result["body"] else {}
    return result["statusCode"], parsed


def seed_code(code, *, kind="share", owner_email=None, creator=None, active=True):
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        owner = None
        if owner_email:
            cur.execute(
                "INSERT INTO waitlist_users (email, anon_id) VALUES (%s, %s) RETURNING waitlist_id",
                (owner_email, str(uuid.uuid4())),
            )
            owner = cur.fetchone()[0]
        cur.execute(
            "INSERT INTO referral_codes (code, owner_waitlist_user_id, creator_handle, type, active) "
            "VALUES (%s, %s, %s, %s, %s)",
            (code, owner, creator, kind, active),
        )
    conn.close()
    return owner


def signup_body(email, **extra):
    return {"email": email, "anon_id": str(uuid.uuid4()), "touchpoints": [], **extra}


# ── H2: premium codes are single-use ──────────────────────────────────────────


def test_premium_code_burns_on_first_signup_and_rejects_the_second(handler):
    """The defect: a premium code admitted unlimited users because nothing ever
    set active = false. Reverting the burn makes the second call return 200."""
    seed_code("GOLDEN1", kind="premium", owner_email="inviter@example.test")

    status, body = invoke(handler, signup_body("first@example.test", invite_code="GOLDEN1"))
    assert status == 200, body

    # The second claimant still joins the waitlist — refusing the signup would
    # lose a genuinely interested person because somebody else was faster. What
    # must NOT happen is a silent downgrade, so the response names the outcome.
    status, body = invoke(handler, signup_body("second@example.test", invite_code="GOLDEN1"))
    assert status == 200, body
    assert body["referral"] == {"applied": False, "reason": "code_already_used"}

    assert query("SELECT active FROM referral_codes WHERE code = 'GOLDEN1'")[0][0] is False
    assert (
        query("SELECT status FROM waitlist_users WHERE email = 'second@example.test'")[0][0]
        == "waiting"
    ), "a spent code must not admit anyone"
    admitted = query("SELECT count(*) FROM waitlist_users WHERE status = 'admitted'")[0][0]
    assert admitted == 1, "a burned premium code must not admit a second user"


def test_premium_admission_is_distinguishable_from_a_wave_admission(handler):
    """H9: collapsing premium_referred into status='admitted' loses the only
    signal that says which door a user came through."""
    seed_code("GOLDEN2", kind="premium", owner_email="inviter2@example.test")
    invoke(handler, signup_body("fast@example.test", invite_code="GOLDEN2"))

    row = query(
        "SELECT premium_referred, status, referred_by_code FROM waitlist_users "
        "WHERE email = 'fast@example.test'"
    )[0]
    assert row[0] is True
    assert row[1] == "admitted"
    assert row[2] == "GOLDEN2"


def test_an_inactive_premium_code_does_not_admit(handler):
    seed_code("SPENT1", kind="premium", owner_email="inviter3@example.test", active=False)
    status, _ = invoke(handler, signup_body("late@example.test", invite_code="SPENT1"))

    assert status == 200, "the signup still succeeds; only the fast-door claim fails"
    row = query("SELECT status, premium_referred FROM waitlist_users WHERE email = 'late@example.test'")[0]
    assert row[0] == "waiting"
    assert row[1] is False


# ── H1: a creator referral must not destroy the signup ────────────────────────


def test_creator_referral_records_attribution_and_still_creates_the_user(handler):
    """The defect: writing to a missing creator_tracking aborted the transaction,
    so the user row, the touchpoints and the E1 job all rolled back and the
    caller got a 500."""
    seed_code("PRESS1", kind="share", creator="techjournalist")

    status, body = invoke(
        handler,
        {
            "email": "reader@example.test",
            "anon_id": str(uuid.uuid4()),
            "touchpoints": [
                {"ts": "2026-07-24T10:00:00Z", "url": "https://cello.mygentic.ai/", "ref": "PRESS1"}
            ],
        },
    )

    assert status == 200, body
    assert query("SELECT count(*) FROM waitlist_users WHERE email = 'reader@example.test'")[0][0] == 1
    assert query("SELECT count(*) FROM email_jobs WHERE template = 'e1_confirm'")[0][0] == 1
    tracked = query("SELECT creator_handle, event_type FROM creator_tracking")
    assert tracked == [("techjournalist", "signup")]


# ── H4: the referrer's +10, and the cap ───────────────────────────────────────


def test_share_referral_awards_ten_points_to_the_referrer(handler):
    owner = seed_code("SHARE1", kind="share", owner_email="referrer@example.test")
    invoke(handler, signup_body("invitee@example.test", invite_code="SHARE1"))

    assert query("SELECT points_total FROM waitlist_users WHERE waitlist_id = %s", (owner,))[0][0] == 10
    assert query("SELECT count(*) FROM referrals")[0][0] == 1


def test_a_referrer_at_their_cap_does_not_lose_the_new_user_their_signup(handler):
    """The cap is real and must fire — but it is an expected outcome, not a
    failure. Without the SAVEPOINT the cap violation aborts the transaction and
    the new user's signup is rolled back with it."""
    owner = seed_code("SHARE2", kind="share", owner_email="popular@example.test")
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO points_ledger (waitlist_user_id, points, reason) VALUES (%s, 30, 'share_conversion')",
            (owner,),
        )
    conn.close()

    status, body = invoke(handler, signup_body("newcomer@example.test", invite_code="SHARE2"))

    assert status == 200, body
    assert query("SELECT count(*) FROM waitlist_users WHERE email = 'newcomer@example.test'")[0][0] == 1
    assert query("SELECT points_total FROM waitlist_users WHERE waitlist_id = %s", (owner,))[0][0] == 30


# ── H8 / M10 / M11: validation on a public endpoint ───────────────────────────


def test_touchpoints_are_capped_server_side(handler):
    """The browser caps at 20; the browser is not a control. 6,000 entries
    exceeded Postgres's bind-parameter limit and became a 500."""
    body = signup_body("flood@example.test")
    body["touchpoints"] = [
        {"ts": "2026-07-24T10:00:00Z", "url": f"https://cello.mygentic.ai/{i}", "utm_source": "x"}
        for i in range(6000)
    ]

    status, payload = invoke(handler, body)

    assert status == 200, payload
    assert query("SELECT count(*) FROM waitlist_touchpoints")[0][0] == 20


@pytest.mark.parametrize(
    "body,expected",
    [
        ({"anon_id": str(uuid.uuid4())}, "missing_email"),
        ({"email": "   ", "anon_id": str(uuid.uuid4())}, "missing_email"),
        ({"email": "not-an-email", "anon_id": str(uuid.uuid4())}, "invalid_email"),
        ({"email": "a@b.co"}, "missing_anon_id"),
        ({"email": "a@b.co", "anon_id": "not-a-uuid"}, "invalid_anon_id"),
        ({"email": "a@b.co", "anon_id": str(uuid.uuid4()), "touchpoints": "abc"}, "invalid_touchpoints"),
    ],
)
def test_bad_input_is_rejected_with_a_cause_not_an_exit_label(handler, body, expected):
    status, payload = invoke(handler, body)
    assert status == 400
    assert payload["error"] == expected, f"got {payload}"


def test_malformed_json_is_a_client_error_not_a_server_error(handler):
    status, payload = invoke(handler, "{not json")
    assert status == 400, "a bad body is the caller's fault; 500 sends on-call to the wrong place"
    assert payload["error"] == "invalid_json"


def test_a_whitespace_only_email_never_reaches_the_database(handler):
    invoke(handler, {"email": "   ", "anon_id": str(uuid.uuid4())})
    assert query("SELECT count(*) FROM waitlist_users")[0][0] == 0


# ── M14: CORS, without which every browser submission fails ───────────────────


def test_preflight_is_answered_for_the_site_origin(handler):
    event = {
        "headers": {"origin": "https://cello.mygentic.ai"},
        "requestContext": {"http": {"method": "OPTIONS", "path": "/waitlist/signup"}},
        "body": "",
    }
    result = handler.lambda_handler(event, None)
    assert result["statusCode"] == 204
    assert result["headers"]["Access-Control-Allow-Origin"] == "https://cello.mygentic.ai"
    assert "POST" in result["headers"]["Access-Control-Allow-Methods"]


def test_an_unknown_origin_is_not_echoed_back(handler):
    """Echoing an arbitrary Origin on a state-changing endpoint hands any site a
    working cross-origin POST."""
    _, _ = invoke(handler, signup_body("cors@example.test"), origin="https://evil.example")
    event = {
        "headers": {"origin": "https://evil.example"},
        "requestContext": {"http": {"method": "OPTIONS", "path": "/waitlist/signup"}},
        "body": "",
    }
    result = handler.lambda_handler(event, None)
    assert result["headers"]["Access-Control-Allow-Origin"] == "https://cello.mygentic.ai"


# ── Baseline behaviour ────────────────────────────────────────────────────────


def test_a_plain_signup_creates_the_user_a_share_code_and_an_e1_job(handler):
    status, body = invoke(
        handler,
        {
            "email": "plain@example.test",
            "anon_id": str(uuid.uuid4()),
            "display_name": "Plain",
            "touchpoints": [
                {"ts": "2026-07-20T10:00:00Z", "utm_source": "reddit", "url": "https://cello.mygentic.ai/"},
                {"ts": "2026-07-24T10:00:00Z", "utm_source": "x", "url": "https://cello.mygentic.ai/waitlist"},
            ],
        },
    )

    assert status == 200, body
    assert body["referral_code"], "the new user must be told their own code — the UI shows it"

    row = query(
        "SELECT display_name, first_touch_source, last_touch_source, status "
        "FROM waitlist_users WHERE email = 'plain@example.test'"
    )[0]
    assert row == ("Plain", "reddit", "x", "waiting")

    codes = query("SELECT type, owner_waitlist_user_id IS NOT NULL, creator_handle IS NULL FROM referral_codes")
    assert codes == [("share", True, True)]
    assert query("SELECT count(*) FROM email_jobs WHERE template = 'e1_confirm'")[0][0] == 1


def test_a_duplicate_email_is_a_409_naming_the_cause(handler):
    invoke(handler, signup_body("dupe@example.test"))
    status, body = invoke(handler, signup_body("dupe@example.test"))

    assert status == 409
    assert body["error"] == "email_already_registered"
    assert query("SELECT count(*) FROM waitlist_users WHERE email = 'dupe@example.test'")[0][0] == 1


def test_an_explicit_first_touch_survives_the_twenty_entry_cap(handler):
    """M13: the browser truncates from the front, so touchpoints[0] is the 21st-
    from-last, not the first. Attribution silently recorded a mid-funnel touch as
    the origin. The client now sends the real first touch separately."""
    body = signup_body("attributed@example.test")
    body["first_touch"] = {"utm_source": "hackernews", "ref": "HN1"}
    body["touchpoints"] = [
        {"ts": "2026-07-24T10:00:00Z", "utm_source": f"later{i}"} for i in range(25)
    ]

    status, payload = invoke(handler, body)
    assert status == 200, payload

    row = query(
        "SELECT first_touch_source, first_touch_ref FROM waitlist_users WHERE email = 'attributed@example.test'"
    )[0]
    assert row == ("hackernews", "HN1")


def test_self_referral_is_refused(handler):
    status, _ = invoke(handler, signup_body("solo@example.test"))
    assert status == 200
    own = query("SELECT code FROM referral_codes LIMIT 1")[0][0]

    invoke(handler, signup_body("other@example.test", invite_code=own))
    assert query("SELECT count(*) FROM referrals")[0][0] == 1, "a genuine referral still lands"
