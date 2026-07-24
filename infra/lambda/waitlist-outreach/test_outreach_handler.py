"""
Tests for the feedback outreach sequence (DOD-FEEDBACK-OUTREACH-1, §5c).

The grant arithmetic is the part worth guarding. Day 6 issues 2 and a completed
call brings the total to 4 — TO, not PLUS. Adding would give someone who took six
days to reply more invites than someone who answered immediately, which inverts
the incentive the whole sequence exists to create.
"""

import json
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import psycopg2
import pytest

from waitlist_testdb import PGURL, query, load_lambda


@pytest.fixture()
def outreach(database):
    return load_lambda(Path(__file__).parent, "outreach_handler")


def make_eligible(email="eligible@example.test", *, days_ago=7, status="active",
                  email_status="active", granted=False, called=False):
    when = datetime.now(timezone.utc) - timedelta(days=days_ago)
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO waitlist_users (email, anon_id, status, email_status, "
            "feedback_eligible, feedback_eligible_date) VALUES (%s, %s, %s, %s, true, %s) "
            "RETURNING waitlist_id",
            (email, str(uuid.uuid4()), status, email_status, when),
        )
        uid = cur.fetchone()[0]
        if granted:
            cur.execute(
                "UPDATE waitlist_users SET feedback_day6_granted_at = now() WHERE waitlist_id = %s",
                (uid,),
            )
        if called:
            cur.execute(
                "UPDATE waitlist_users SET feedback_call_completed_at = now() WHERE waitlist_id = %s",
                (uid,),
            )
    conn.close()
    return uid


def invites(uid):
    return query(
        "SELECT count(*) FROM referral_codes WHERE owner_waitlist_user_id = %s AND type = 'premium'",
        (uid,),
    )[0][0]


def sweep(outreach):
    return json.loads(outreach.lambda_handler({}, None)["body"])


def complete(outreach, uid, by="andre@example.test"):
    result = outreach.lambda_handler(
        {"action": "call_completed", "waitlist_user_id": str(uid), "completed_by": by}, None
    )
    return result["statusCode"], json.loads(result["body"])


# ── Day 6 ─────────────────────────────────────────────────────────────────────


def test_six_days_of_silence_grants_two_invites(outreach):
    uid = make_eligible(days_ago=7)

    assert sweep(outreach)["day_six_granted"] == 1
    assert invites(uid) == 2


def test_five_days_is_too_soon(outreach):
    uid = make_eligible(days_ago=5)

    assert sweep(outreach)["day_six_granted"] == 0
    assert invites(uid) == 0


def test_the_day_six_grant_happens_once(outreach):
    uid = make_eligible(days_ago=10)
    sweep(outreach)
    sweep(outreach)
    sweep(outreach)

    assert invites(uid) == 2


def test_a_sweep_that_missed_days_still_picks_the_user_up(outreach):
    """The idempotency key is 'has it been granted', not a date window. A date
    comparison alone would skip anyone the job missed while it was down."""
    uid = make_eligible(days_ago=60)

    assert sweep(outreach)["day_six_granted"] == 1
    assert invites(uid) == 2


def test_someone_who_already_talked_to_us_gets_no_consolation_grant(outreach):
    """Sending the no-response reward to someone who responded says we were not
    paying attention."""
    uid = make_eligible(days_ago=10, called=True)

    assert sweep(outreach)["day_six_granted"] == 0


@pytest.mark.parametrize("status", ["waiting", "banned", "left"])
def test_only_admitted_or_active_users_are_swept(outreach, status):
    uid = make_eligible(days_ago=10, status=status)

    assert sweep(outreach)["day_six_granted"] == 0
    assert invites(uid) == 0


def test_a_suppressed_address_is_not_swept(outreach):
    """DOD-INV-EMAIL-SUPPRESS: a bounced user receives nothing, and the grant
    exists to accompany a message we cannot send."""
    uid = make_eligible(days_ago=10, email_status="bounced")

    assert sweep(outreach)["day_six_granted"] == 0


# ── Call completed: TO four, not PLUS four ────────────────────────────────────


def test_a_completed_call_brings_the_total_to_four(outreach):
    uid = make_eligible(days_ago=1)

    status, body = complete(outreach, uid)

    assert status == 200
    assert body["granted"] == 4
    assert invites(uid) == 4


def test_a_call_after_the_day_six_grant_tops_up_rather_than_adding(outreach):
    """Two already issued means two more, not four more. Adding would leave
    someone who took six days to reply holding six invites while someone who
    answered immediately holds four."""
    uid = make_eligible(days_ago=10)
    sweep(outreach)
    assert invites(uid) == 2

    _, body = complete(outreach, uid)

    assert body["granted"] == 2
    assert invites(uid) == 4


def test_marking_a_call_complete_twice_grants_nothing_the_second_time(outreach):
    uid = make_eligible(days_ago=1)
    complete(outreach, uid)

    _, body = complete(outreach, uid)

    assert body["granted"] == 0
    assert body["reason"] == "already_completed"
    assert invites(uid) == 4


def test_a_completed_call_suppresses_a_later_day_six_grant(outreach):
    uid = make_eligible(days_ago=10)
    complete(outreach, uid)

    assert sweep(outreach)["day_six_granted"] == 0
    assert invites(uid) == 4, "the call grant stands; no consolation on top"


def test_first_win_invites_count_toward_the_total(outreach):
    """Someone who reached first win already holds 3. A call should bring them
    to 4, not to 7 — the totals are a ceiling on what one person can hand out,
    not a running tally of rewards."""
    uid = make_eligible(days_ago=1)
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        for i in range(3):
            cur.execute(
                "INSERT INTO referral_codes (code, owner_waitlist_user_id, type) "
                "VALUES (%s, %s, 'premium')",
                (f"FIRSTWIN{i}", uid),
            )
    conn.close()

    _, body = complete(outreach, uid)

    assert body["granted"] == 1
    assert invites(uid) == 4


# ── Accountability and refusals ───────────────────────────────────────────────


def test_a_grant_must_name_the_operator_who_made_it(outreach):
    """Same reasoning as wave assembly: an action with no named operator is
    indistinguishable from one that happened by itself."""
    uid = make_eligible(days_ago=1)
    result = outreach.lambda_handler(
        {"action": "call_completed", "waitlist_user_id": str(uid)}, None
    )
    body = json.loads(result["body"])

    assert result["statusCode"] == 400
    assert body["error"] == "missing_completed_by"
    assert invites(uid) == 0


def test_an_unknown_user_is_named_as_such(outreach):
    status, body = complete(outreach, uuid.uuid4())

    assert status == 400
    assert body["error"] == "user_not_found"


def test_a_malformed_id_is_refused_before_the_database(outreach):
    status, body = complete(outreach, "not-a-uuid")

    assert status == 400
    assert body["error"] == "invalid_waitlist_user_id"


def test_a_database_fault_is_not_reported_as_a_quiet_sweep(outreach, monkeypatch):
    def boom(*_a, **_k):
        raise psycopg2.OperationalError("server closed the connection unexpectedly")

    monkeypatch.setattr(outreach, "connect", boom)

    result = outreach.lambda_handler({}, None)

    assert result["statusCode"] == 503
    assert "day_six_granted" not in json.loads(result["body"])
