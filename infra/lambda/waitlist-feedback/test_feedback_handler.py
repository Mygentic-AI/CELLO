"""
Tests for high-activity detection (DOD-FEEDBACK-DETECTION-1, §5c).

The threshold asymmetry is the interesting part and the easiest thing to get
subtly wrong: five sealed sessions OR one cross-operator session. Sealing five
with your own agents proves the software runs; sealing one with somebody else's
proves the claim CELLO actually makes. A bug that treated them as the same
signal would flood the feedback pipeline with solo testers.
"""

import json
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import psycopg2
import pytest

from waitlist_testdb import PGURL, query, load_lambda

ADMITTED = datetime(2026, 7, 1, tzinfo=timezone.utc)


@pytest.fixture()
def feedback(database):
    return load_lambda(Path(__file__).parent, "feedback_handler")


def make_user(email, *, pubkey, admitted=ADMITTED, status="active", eligible=False):
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO waitlist_users (email, anon_id, status, admitted_at, feedback_eligible) "
            "VALUES (%s, %s, %s, %s, %s) RETURNING waitlist_id",
            (email, str(uuid.uuid4()), status, admitted, eligible),
        )
        uid = cur.fetchone()[0]
        cur.execute(
            "INSERT INTO waitlist_agent_links (agent_pubkey, waitlist_user_id) VALUES (%s, %s)",
            (pubkey, uid),
        )
    conn.close()
    return uid


def seal_sessions(pubkey, count, *, when=None, operator="op-self", counterparty="op-self"):
    when = when or ADMITTED + timedelta(days=1)
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        for i in range(count):
            cur.execute(
                "INSERT INTO session_telemetry "
                "(agent_pubkey, session_ref, operator, counterparty_operator, sealed_at) "
                "VALUES (%s, %s, %s, %s, %s)",
                (pubkey, f"{pubkey}-s{i}-{uuid.uuid4().hex[:6]}", operator, counterparty, when),
            )
    conn.close()


def eligible(uid):
    return query("SELECT feedback_eligible FROM waitlist_users WHERE waitlist_id = %s", (uid,))[0][0]


def run(feedback):
    return json.loads(feedback.lambda_handler({}, None)["body"])


# ── The two thresholds ────────────────────────────────────────────────────────


def test_five_sealed_sessions_qualifies(feedback):
    uid = make_user("volume@example.test", pubkey="pk-vol")
    seal_sessions("pk-vol", 5)

    assert run(feedback)["newly_eligible"] == 1
    assert eligible(uid) is True


def test_four_sealed_sessions_does_not(feedback):
    uid = make_user("almost@example.test", pubkey="pk-four")
    seal_sessions("pk-four", 4)

    assert run(feedback)["newly_eligible"] == 0
    assert eligible(uid) is False


def test_a_single_cross_operator_session_qualifies(feedback):
    """One is enough here where five is needed otherwise. Sealing with somebody
    else's agent proves the thing CELLO claims; sealing with your own proves the
    software runs."""
    uid = make_user("collab@example.test", pubkey="pk-cross")
    seal_sessions("pk-cross", 1, operator="op-me", counterparty="op-someone-else")

    assert run(feedback)["newly_eligible"] == 1
    assert eligible(uid) is True


def test_sessions_with_your_own_agents_are_not_cross_operator(feedback):
    """Otherwise anyone testing against their own second agent trips the lower
    bar and the pipeline fills with solo testers."""
    uid = make_user("solo@example.test", pubkey="pk-solo")
    seal_sessions("pk-solo", 3, operator="op-me", counterparty="op-me")

    assert run(feedback)["newly_eligible"] == 0
    assert eligible(uid) is False


def test_the_reason_distinguishes_which_threshold_fired(feedback, caplog):
    make_user("why@example.test", pubkey="pk-why")
    seal_sessions("pk-why", 1, operator="op-me", counterparty="op-other")

    with caplog.at_level("INFO"):
        run(feedback)

    assert '"reason": "cross_operator"' in caplog.text, (
        "an operator reading this needs to know which signal fired — they are "
        "different kinds of conversation"
    )


# ── The window ────────────────────────────────────────────────────────────────


def test_sessions_outside_the_fourteen_day_window_do_not_count(feedback):
    """The threshold is about the first two weeks after admission — someone who
    reaches five sessions over six months is a different user."""
    uid = make_user("slow@example.test", pubkey="pk-slow")
    seal_sessions("pk-slow", 5, when=ADMITTED + timedelta(days=30))

    assert run(feedback)["newly_eligible"] == 0
    assert eligible(uid) is False


def test_sessions_before_admission_do_not_count(feedback):
    uid = make_user("early@example.test", pubkey="pk-early")
    seal_sessions("pk-early", 5, when=ADMITTED - timedelta(days=5))

    assert run(feedback)["newly_eligible"] == 0
    assert eligible(uid) is False


def test_unsealed_sessions_do_not_count(feedback):
    """An initiated session that never sealed is not a win — it may well be a
    failure, which is the opposite signal."""
    uid = make_user("unsealed@example.test", pubkey="pk-un")
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        for i in range(6):
            cur.execute(
                "INSERT INTO session_telemetry (agent_pubkey, session_ref, operator) "
                "VALUES ('pk-un', %s, 'op-me')",
                (f"unsealed-{i}",),
            )
    conn.close()

    assert run(feedback)["newly_eligible"] == 0
    assert eligible(uid) is False


# ── Idempotency ───────────────────────────────────────────────────────────────


def test_a_second_run_the_same_day_changes_nothing(feedback):
    uid = make_user("twice@example.test", pubkey="pk-twice")
    seal_sessions("pk-twice", 5)

    first = run(feedback)
    stamped = query(
        "SELECT feedback_eligible_date FROM waitlist_users WHERE waitlist_id = %s", (uid,)
    )[0][0]
    second = run(feedback)

    assert (first["newly_eligible"], second["newly_eligible"]) == (1, 0)
    assert query("SELECT count(*) FROM email_jobs WHERE template = 'e_feedback_invite'")[0][0] == 1
    assert query(
        "SELECT feedback_eligible_date FROM waitlist_users WHERE waitlist_id = %s", (uid,)
    )[0][0] == stamped, "the date records when they BECAME eligible, not the last sweep"


def test_an_already_eligible_user_is_never_re_contacted(feedback):
    uid = make_user("already@example.test", pubkey="pk-already", eligible=True)
    seal_sessions("pk-already", 10)

    assert run(feedback)["newly_eligible"] == 0
    assert query("SELECT count(*) FROM email_jobs")[0][0] == 0


def test_a_redelivered_seal_event_cannot_inflate_the_count(feedback):
    """Four real sessions plus a redelivery of one of them is still four. Without
    the uniqueness constraint it reads as five and trips the threshold."""
    uid = make_user("replay@example.test", pubkey="pk-replay")
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        for i in range(4):
            cur.execute(
                "INSERT INTO session_telemetry (agent_pubkey, session_ref, operator, sealed_at) "
                "VALUES ('pk-replay', %s, 'op-me', %s)",
                (f"sess-{i}", ADMITTED + timedelta(days=1)),
            )
        with pytest.raises(psycopg2.errors.UniqueViolation):
            cur.execute(
                "INSERT INTO session_telemetry (agent_pubkey, session_ref, operator, sealed_at) "
                "VALUES ('pk-replay', 'sess-0', 'op-me', %s)",
                (ADMITTED + timedelta(days=1),),
            )
    conn.close()

    assert run(feedback)["newly_eligible"] == 0
    assert eligible(uid) is False


# ── Who is in scope ───────────────────────────────────────────────────────────


@pytest.mark.parametrize("status", ["waiting", "banned", "left"])
def test_only_admitted_or_active_users_are_swept(feedback, status):
    uid = make_user(f"{status}@example.test", pubkey=f"pk-{status}", status=status)
    seal_sessions(f"pk-{status}", 10)

    assert run(feedback)["newly_eligible"] == 0
    assert eligible(uid) is False


def test_an_unlinked_agents_sessions_credit_nobody(feedback):
    seal_sessions("pk-nobody", 10)

    assert run(feedback)["newly_eligible"] == 0


def test_sessions_across_two_agents_of_one_person_add_up(feedback):
    """Three on the laptop and two on the phone is five sessions by one human,
    which is exactly what the threshold is asking about."""
    uid = make_user("multi@example.test", pubkey="pk-laptop")
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO waitlist_agent_links (agent_pubkey, waitlist_user_id) VALUES ('pk-phone', %s)",
            (uid,),
        )
    conn.close()
    seal_sessions("pk-laptop", 3)
    seal_sessions("pk-phone", 2)

    assert run(feedback)["newly_eligible"] == 1
    assert eligible(uid) is True


def test_a_failed_sweep_is_visibly_failed(feedback, monkeypatch):
    """This runs unattended. A 200 with zero is indistinguishable from a quiet
    week, and nobody would notice it had stopped until the flywheel was dry."""

    def boom(*_a, **_k):
        raise psycopg2.OperationalError("server closed the connection unexpectedly")

    monkeypatch.setattr(feedback, "connect", boom)

    result = feedback.lambda_handler({}, None)

    assert result["statusCode"] == 503
    assert "newly_eligible" not in json.loads(result["body"])
