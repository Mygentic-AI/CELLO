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

# The cookie name lives in _session, never restated here: these tests hardcoded
# it, so renaming it to the __Host- prefixed form broke 44 of them at once while
# the production code was correct.
from _session import COOKIE_NAME

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
    return f"{COOKIE_NAME}={raw}"


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
    # Payload format 2.0: cookies arrive in a top-level list, never in `headers`.
    event = {
        "version": "2.0",
        "headers": {"origin": "https://cello.mygentic.ai"},
        "cookies": [cookie] if cookie else [],
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


def survey_meta(user_id):
    return query(
        "SELECT meta FROM points_ledger WHERE waitlist_user_id = %s AND reason = 'survey'",
        (user_id,),
    )[0][0]


def test_resubmitting_the_survey_edits_the_answers_instead_of_discarding_them(actions):
    """A SECOND SUBMIT IS AN EDIT. It used to be a silent data loss.

    `award` rolls back to its savepoint on the once-per-user index, so the new
    answers went nowhere: the caller got 200, the page said thank you, and the
    row still held the first set. Someone correcting what they told us had no
    signal that it had not taken, and neither did we. Caught by hand — Andre
    filled the survey in twice and asked whether the second one had stored.
    """
    uid = make_user()
    cookie = sign_in(uid)

    call(actions, "/waitlist/survey", {"answers": {"agents": "0"}}, cookie)
    _, second = call(actions, "/waitlist/survey", {"answers": {"agents": "10+"}}, cookie)

    assert survey_meta(uid)["answers"] == {"agents": "10+"}, "the edit was discarded"
    assert second["awarded"] == 0, "an edit must not pay a second time"
    assert second["updated"] is True, "the caller has to be able to tell it saved"
    assert total(uid) == 20


def test_an_edit_cannot_wipe_a_freeform_answer_that_was_already_paid_for(actions):
    """`meta || {...}` merges, so editing the structured answers must leave the
    free-form text alone. Replacing meta wholesale would delete the answer the
    +10 was paid for, leaving points backed by nothing."""
    uid = make_user()
    cookie = sign_in(uid)

    call(actions, "/waitlist/survey", {"answers": {"agents": "0"}, "freeform": "kept"}, cookie)
    call(actions, "/waitlist/survey", {"answers": {"agents": "10+"}}, cookie)

    meta = survey_meta(uid)
    assert meta["freeform"] == "kept"
    assert meta["answers"] == {"agents": "10+"}
    assert total(uid) == 30


def test_the_freeform_text_is_editable_but_still_paid_only_once(actions):
    uid = make_user()
    cookie = sign_in(uid)

    call(actions, "/waitlist/survey", {"answers": {"a": 1}, "freeform": "first"}, cookie)
    _, second = call(actions, "/waitlist/survey", {"answers": {"a": 1}, "freeform": "second"}, cookie)

    assert survey_meta(uid)["freeform"] == "second"
    assert second["awarded"] == 0
    assert total(uid) == 30


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

    status, _ = call(actions, "/waitlist/readiness", {}, f"{COOKIE_NAME}={raw}")

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


def test_a_late_freeform_answer_is_still_paid_and_still_stored(actions):
    """The half-filled case: structured answers first, free-form on a later
    visit. Previously the second call returned awarded=0, the 10 points were
    forfeited, and the written answer — the entire reason the bonus exists — was
    never stored at all."""
    uid = make_user()
    cookie = sign_in(uid)

    call(actions, "/waitlist/survey", {"answers": {"use": "agents"}}, cookie)
    _, payload = call(
        actions,
        "/waitlist/survey",
        {"answers": {"use": "agents"}, "freeform": "Connecting my own agents across machines."},
        cookie,
    )

    assert payload["awarded"] == 10, "the late free-form must still pay"
    assert total(uid) == 30

    meta = query(
        "SELECT meta FROM points_ledger WHERE waitlist_user_id = %s AND reason = 'survey'", (uid,)
    )[0][0]
    assert meta["freeform"] == "Connecting my own agents across machines.", (
        "the answer must be stored — points for text nobody kept is a number with no evidence"
    )


def test_the_freeform_bonus_is_paid_only_once(actions):
    uid = make_user()
    cookie = sign_in(uid)
    body = {"answers": {"a": 1}, "freeform": "words"}

    call(actions, "/waitlist/survey", body, cookie)
    _, second = call(actions, "/waitlist/survey", body, cookie)

    assert second["awarded"] == 0
    assert total(uid) == 30


def test_an_update_past_a_cap_fails_like_an_insert(database):
    """0003 calls the ledger append-only and caps it with INSERT-only triggers.
    Production code now UPDATEs it, so an UPDATE past a cap has to fail too —
    otherwise the invariant is literally true and practically incomplete."""
    uid = make_user("capupdate@example.test")
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO points_ledger (waitlist_user_id, points, reason) "
            "VALUES (%s, 10, 'share_conversion')",
            (uid,),
        )
        with pytest.raises(psycopg2.errors.CheckViolation):
            cur.execute(
                "UPDATE points_ledger SET points = 999 WHERE waitlist_user_id = %s", (uid,)
            )
    conn.close()

    assert total(uid) == 10


def test_deleting_a_ledger_row_re_syncs_the_total(database):
    """Otherwise points_total overstates the ledger — the same drift as a cap
    breach, from the other direction."""
    uid = make_user("deleter@example.test")
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO points_ledger (waitlist_user_id, points, reason) VALUES (%s, 20, 'survey')",
            (uid,),
        )
        assert total(uid) == 20
        cur.execute("DELETE FROM points_ledger WHERE waitlist_user_id = %s", (uid,))
    conn.close()

    assert total(uid) == 0


# ── DOD-CONTENT-ALERTS-1 ──────────────────────────────────────────────────────


def test_content_alerts_opt_in_and_out(actions):
    uid = make_user()
    cookie = sign_in(uid)

    _, on = call(actions, "/waitlist/content-alerts", {"enabled": True}, cookie)
    assert on["content_alerts"] is True

    _, off = call(actions, "/waitlist/content-alerts", {"enabled": False}, cookie)
    assert off["content_alerts"] is False


def test_opting_in_to_content_alerts_is_paid(actions):
    """ASSERTS THE POINTS LANDED, not just that the call returned.

    `award` catches CheckViolation and returns 0, so if 0023 had not added
    'content_alerts' to the reason CHECK this would pay nothing and every
    existing content-alert test would still pass. The award has to be checked
    against the balance, or the failure is invisible.
    """
    uid = make_user()
    cookie = sign_in(uid)

    _, on = call(actions, "/waitlist/content-alerts", {"enabled": True}, cookie)

    assert on["awarded"] == 10
    assert total(uid) == 10


def test_toggling_content_alerts_cannot_be_farmed(actions):
    """The opt-in is a TOGGLE attached to an award, which is the dangerous shape:
    off/on/off/on would pay every time and make the balance a function of how
    many times somebody clicked a checkbox. 0023's once-per-user index stops it
    in the database, so it holds however the endpoint is called."""
    uid = make_user()
    cookie = sign_in(uid)

    call(actions, "/waitlist/content-alerts", {"enabled": True}, cookie)
    call(actions, "/waitlist/content-alerts", {"enabled": False}, cookie)
    _, again = call(actions, "/waitlist/content-alerts", {"enabled": True}, cookie)

    assert again["awarded"] == 0
    assert total(uid) == 10


def test_opting_out_keeps_the_points_and_pays_nothing(actions):
    """No claw-back (0023): the ledger is append-only and making the balance
    non-monotonic over ten points is the worse trade. Opting out must also not
    award — only opting IN is the action being paid for."""
    uid = make_user()
    cookie = sign_in(uid)
    call(actions, "/waitlist/content-alerts", {"enabled": True}, cookie)

    _, off = call(actions, "/waitlist/content-alerts", {"enabled": False}, cookie)

    assert off["awarded"] == 0
    assert off["content_alerts"] is False
    assert total(uid) == 10


def test_the_default_is_off(actions):
    """Unchecked by default — DOD-CONTENT-ALERTS-1 is explicit, and a list that
    accepts up to twice a day must be asked for."""
    uid = make_user()

    assert query("SELECT content_alerts FROM waitlist_users WHERE waitlist_id = %s", (uid,))[0][0] is False


def test_it_is_explicit_not_a_toggle(actions):
    """A toggle read from a stale page flips the user to the opposite of what
    they clicked."""
    uid = make_user()
    cookie = sign_in(uid)

    status, payload = call(actions, "/waitlist/content-alerts", {}, cookie)

    assert status == 400
    assert payload["error"] == "missing_enabled"


def test_opting_out_of_alerts_does_not_touch_the_waitlist_subscription(actions):
    """DOD-INV-EMAIL-SEGMENTS from the user's side: muting blog posts must not
    silently unsubscribe someone from the mail they actually signed up for."""
    uid = make_user()
    cookie = sign_in(uid)
    call(actions, "/waitlist/content-alerts", {"enabled": True}, cookie)

    call(actions, "/waitlist/content-alerts", {"enabled": False}, cookie)

    assert query("SELECT email_status FROM waitlist_users WHERE waitlist_id = %s", (uid,))[0][0] == "active"
