"""
Tests for first-win detection (DOD-FIRST-WIN-1).

Idempotency is the whole design here, not a nice property. This runs off an
event stream, so redelivery is normal rather than exceptional, and the failure
mode is minting three more golden tickets every time a message replays. The
concurrency test is therefore mandatory: a check-then-act passes every
sequential test in this file.
"""

import json
import threading
import uuid
from pathlib import Path

import psycopg2
import pytest

from waitlist_testdb import PGURL, query, load_lambda


@pytest.fixture()
def firstwin(database):
    return load_lambda(Path(__file__).parent, "firstwin_handler")


def make_linked_agent(email="winner@example.test", pubkey="pk-1", *, status="admitted", won=False):
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO waitlist_users (email, anon_id, status, first_win_at) "
            "VALUES (%s, %s, %s, %s) RETURNING waitlist_id",
            (email, str(uuid.uuid4()), status, "now()" if won else None),
        )
        uid = cur.fetchone()[0]
        if won:
            cur.execute("UPDATE waitlist_users SET first_win_at = now() WHERE waitlist_id = %s", (uid,))
        cur.execute(
            "INSERT INTO waitlist_agent_links (agent_pubkey, waitlist_user_id) VALUES (%s, %s)",
            (pubkey, uid),
        )
    conn.close()
    return uid


def seal(firstwin, pubkey="pk-1"):
    result = firstwin.lambda_handler({"agent_pubkey": pubkey}, None)
    return result["statusCode"], json.loads(result["body"])


def invites(uid):
    return [
        r[0]
        for r in query(
            "SELECT code FROM referral_codes WHERE owner_waitlist_user_id = %s AND type = 'premium'",
            (uid,),
        )
    ]


# ── The first win ─────────────────────────────────────────────────────────────


def test_a_first_seal_issues_three_invites_and_stamps_the_moment(firstwin):
    uid = make_linked_agent()

    status, body = seal(firstwin)

    assert status == 200
    assert body["first_win"] is True
    assert len(invites(uid)) == 3
    assert query("SELECT first_win_at IS NOT NULL FROM waitlist_users WHERE waitlist_id = %s", (uid,))[0][0]
    assert query("SELECT count(*) FROM email_jobs WHERE template = 'e_win_invites'")[0][0] == 1


def test_first_win_moves_the_user_from_admitted_to_active(firstwin):
    """M11-D11's lifecycle: admitted → active happens here, and nowhere else."""
    uid = make_linked_agent(status="admitted")

    seal(firstwin)

    assert query("SELECT status FROM waitlist_users WHERE waitlist_id = %s", (uid,))[0][0] == "active"


def test_a_user_in_another_state_keeps_it(firstwin):
    """A banned user who somehow seals a session does not get promoted to
    active by it."""
    uid = make_linked_agent(status="banned")

    seal(firstwin)

    assert query("SELECT status FROM waitlist_users WHERE waitlist_id = %s", (uid,))[0][0] == "banned"


# ── Idempotency: the property this Lambda exists to hold ──────────────────────


def test_a_second_seal_changes_absolutely_nothing(firstwin):
    uid = make_linked_agent()
    seal(firstwin)
    before = query(
        "SELECT first_win_at FROM waitlist_users WHERE waitlist_id = %s", (uid,)
    )[0][0]

    status, body = seal(firstwin)

    assert body["first_win"] is False
    assert body["reason"] == "already_recorded"
    assert len(invites(uid)) == 3, "a replay must not mint three more golden tickets"
    assert query("SELECT count(*) FROM email_jobs WHERE template = 'e_win_invites'")[0][0] == 1
    assert query("SELECT first_win_at FROM waitlist_users WHERE waitlist_id = %s", (uid,))[0][0] == before, (
        "the timestamp must record the FIRST win, not the latest replay"
    )


def test_ten_replays_still_issue_three_invites(firstwin):
    uid = make_linked_agent()
    for _ in range(10):
        seal(firstwin)

    assert len(invites(uid)) == 3


def test_a_second_agent_belonging_to_the_same_human_is_not_a_second_first_win(firstwin):
    """The DoD says globally, not per agent and not per device. A second laptop
    is the most ordinary thing a person does."""
    uid = make_linked_agent(pubkey="pk-laptop")
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO waitlist_agent_links (agent_pubkey, waitlist_user_id) VALUES ('pk-phone', %s)",
            (uid,),
        )
    conn.close()

    seal(firstwin, "pk-laptop")
    _, second = seal(firstwin, "pk-phone")

    assert second["first_win"] is False
    assert len(invites(uid)) == 3


def test_two_simultaneous_seal_events_issue_one_set_of_invites(firstwin):
    """A check-then-act passes every sequential test above. Under redelivery —
    which is the normal case for an event stream — it mints three more invites
    per replay, and a premium code skips the queue."""
    uid = make_linked_agent()
    barrier = threading.Barrier(2)
    results = {}

    def attempt(name):
        def inner():
            mod = load_lambda(Path(__file__).parent, f"firstwin_{name}")
            barrier.wait()
            results[name] = json.loads(
                mod.lambda_handler({"agent_pubkey": "pk-1"}, None)["body"]
            )

        return inner

    threads = [threading.Thread(target=attempt("a")), threading.Thread(target=attempt("b"))]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=30)

    winners = [r for r in results.values() if r.get("first_win")]
    assert len(winners) == 1, f"exactly one may win, got {results}"
    assert len(invites(uid)) == 3, "a race must not double the invites"
    assert query("SELECT count(*) FROM email_jobs WHERE template = 'e_win_invites'")[0][0] == 1


# ── Agents with no waitlist record ────────────────────────────────────────────


def test_an_unlinked_agent_is_not_an_error(firstwin):
    """Staff overrides, test agents and anyone who joined before the waitlist
    existed all seal perfectly valid sessions. They simply have nothing to
    credit."""
    status, body = seal(firstwin, "pk-stranger")

    assert status == 200
    assert body["first_win"] is False
    assert body["reason"] == "agent_not_linked_to_a_waitlist_user"
    assert query("SELECT count(*) FROM referral_codes")[0][0] == 0


def test_a_missing_pubkey_is_refused(firstwin):
    result = firstwin.lambda_handler({}, None)
    body = json.loads(result["body"])

    assert result["statusCode"] == 400
    assert body["error"] == "missing_agent_pubkey"


def test_a_database_fault_is_not_reported_as_no_win(firstwin, monkeypatch):
    """There is no second first win to retry against. If a fault reads as
    'no win', the caller moves on and the moment is gone."""

    def boom(*_a, **_k):
        raise psycopg2.OperationalError("server closed the connection unexpectedly")

    monkeypatch.setattr(firstwin, "connect", boom)

    result = firstwin.lambda_handler({"agent_pubkey": "pk-1"}, None)
    body = json.loads(result["body"])

    assert result["statusCode"] == 503
    assert "first_win" not in body
    assert body["error"] == "database_unreachable"


# ── The invites themselves ────────────────────────────────────────────────────


def test_the_invites_are_premium_bearer_codes_owned_by_the_winner(firstwin):
    uid = make_linked_agent()
    seal(firstwin)

    rows = query(
        "SELECT type, owner_waitlist_user_id, creator_handle, active FROM referral_codes"
    )
    assert len(rows) == 3
    for kind, owner, creator, active in rows:
        assert (kind, owner, creator, active) == ("premium", uid, None, True)


def test_the_invite_codes_are_distinct(firstwin):
    uid = make_linked_agent()
    seal(firstwin)

    codes = invites(uid)
    assert len(set(codes)) == 3, "three codes that collide are one invite"


def test_the_codes_avoid_characters_that_get_misread_aloud(firstwin):
    make_linked_agent()
    seal(firstwin)

    for code in query("SELECT code FROM referral_codes"):
        assert not (set(code[0]) & set("IO01")), (
            f"{code[0]} contains a character people confuse when reading it out"
        )
