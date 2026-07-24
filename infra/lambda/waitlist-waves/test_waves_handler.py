"""
Tests for wave assembly (DOD-WAVE-ASSEMBLY-1, DOD-INV-WAVE-GATE).

The selection-order tests are the ones with teeth: the DoD names three cohorts
in a specific priority, and getting the order wrong is invisible in any single
wave — it only shows up as the wrong people being admitted, which nobody can see
from the outside.
"""

import json
import uuid
from datetime import datetime, timedelta, timezone

import psycopg2
import pytest

from waitlist_testdb import PGURL, query, load_lambda

BASE = datetime(2026, 7, 1, tzinfo=timezone.utc)


@pytest.fixture()
def waves(database):
    return load_lambda(__file__.rsplit("/", 1)[0], "waves_handler")


def make_user(email, *, points=0, premium=False, created=BASE, status="waiting"):
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO waitlist_users (email, anon_id, points_total, premium_referred, created_at, status) "
            "VALUES (%s, %s, %s, %s, %s, %s) RETURNING waitlist_id",
            (email, str(uuid.uuid4()), points, premium, created, status),
        )
        uid = cur.fetchone()[0]
    conn.close()
    return uid


def open_wave(waves, **kwargs):
    body = {"capacity": 4, "opened_by": "andre@example.test", **kwargs}
    result = waves.lambda_handler(body, None)
    return result["statusCode"], json.loads(result["body"])


def admitted_emails():
    return sorted(
        r[0] for r in query("SELECT email FROM waitlist_users WHERE status = 'admitted'")
    )


# ── DOD-INV-WAVE-GATE ─────────────────────────────────────────────────────────


def test_a_wave_cannot_open_without_a_named_operator(waves):
    """A wave with no named operator is indistinguishable from one that opened
    itself, which is the whole point of the invariant."""
    make_user("a@example.test")
    result = waves.lambda_handler({"capacity": 4}, None)
    body = json.loads(result["body"])

    assert result["statusCode"] == 400
    assert body["error"] == "missing_opened_by"
    assert query("SELECT count(*) FROM waves")[0][0] == 0
    assert admitted_emails() == []


def test_the_operator_is_recorded_on_the_wave(waves):
    make_user("a@example.test")
    open_wave(waves, opened_by="andre@example.test")

    assert query("SELECT opened_by FROM waves")[0][0] == "andre@example.test"


@pytest.mark.parametrize("capacity", [0, -1, "four", None, 2.5])
def test_an_invalid_capacity_opens_nothing(waves, capacity):
    make_user("a@example.test")
    result = waves.lambda_handler(
        {"capacity": capacity, "opened_by": "andre@example.test"}, None
    )

    assert result["statusCode"] == 400
    assert query("SELECT count(*) FROM waves")[0][0] == 0


def test_a_split_exceeding_the_capacity_is_refused(waves):
    """75/75 would quietly admit more people than the capacity the operator
    typed — the two shares are of the SAME remaining capacity."""
    make_user("a@example.test")
    status, body = open_wave(waves, priority_pct=75, zero_pct=75)

    assert status == 400
    assert body["error"] == "split_exceeds_capacity"
    assert query("SELECT count(*) FROM waves")[0][0] == 0


# ── Selection order ───────────────────────────────────────────────────────────


def test_premium_invitees_fill_the_front_of_capacity(waves):
    """The fast door is a promise, not a tiebreak. A premium invitee with zero
    points outranks the highest scorer on the slow door."""
    make_user("highscore@example.test", points=500)
    make_user("premium@example.test", points=0, premium=True)

    open_wave(waves, capacity=1)

    assert admitted_emails() == ["premium@example.test"]


def test_priority_slots_go_to_the_highest_points(waves):
    make_user("low@example.test", points=10)
    make_user("high@example.test", points=90)
    make_user("mid@example.test", points=50)

    open_wave(waves, capacity=2, priority_pct=100, zero_pct=0)

    assert admitted_emails() == ["high@example.test", "mid@example.test"]


def test_equal_points_are_broken_by_who_waited_longer(waves):
    make_user("newer@example.test", points=50, created=BASE + timedelta(days=5))
    make_user("older@example.test", points=50, created=BASE)

    open_wave(waves, capacity=1, priority_pct=100, zero_pct=0)

    assert admitted_emails() == ["older@example.test"]


def test_the_zero_point_slot_admits_people_who_only_waited(waves):
    """Without this the queue never admits anyone who simply signed up, and it
    stops being a queue and becomes a leaderboard."""
    make_user("scorer1@example.test", points=90)
    make_user("scorer2@example.test", points=80)
    make_user("scorer3@example.test", points=70)
    make_user("patient@example.test", points=0, created=BASE)

    open_wave(waves, capacity=4, priority_pct=75, zero_pct=25)

    assert "patient@example.test" in admitted_emails(), (
        "a 25% zero-point share must reach someone with no points"
    )


def test_the_three_cohorts_are_reported_separately(waves):
    make_user("premium@example.test", premium=True)
    make_user("scorer@example.test", points=50)
    make_user("patient@example.test", points=0)

    _, body = open_wave(waves, capacity=4, priority_pct=50, zero_pct=50)

    assert body["breakdown"] == {"premium": 1, "priority": 1, "zero": 1}


def test_nobody_is_selected_twice_across_cohorts(waves):
    """A premium invitee with points could match all three queries. Admitting
    them once but counting them three times would silently shrink the wave."""
    make_user("premium@example.test", points=99, premium=True)
    make_user("other@example.test", points=50)

    _, body = open_wave(waves, capacity=4, priority_pct=100, zero_pct=0)

    assert body["admitted"] == 2
    assert query("SELECT count(*) FROM waitlist_tokens")[0][0] == 2


# ── Effects ───────────────────────────────────────────────────────────────────


def test_every_admitted_user_gets_exactly_one_token_and_one_invite_email(waves):
    for i in range(3):
        make_user(f"u{i}@example.test", points=10 * i)

    _, body = open_wave(waves, capacity=3, priority_pct=100, zero_pct=0)

    tokens = query(
        "SELECT waitlist_user_id, count(*) FROM waitlist_tokens GROUP BY waitlist_user_id"
    )
    assert all(count == 1 for _, count in tokens)
    assert len(tokens) == body["admitted"]
    assert query("SELECT count(*) FROM email_jobs WHERE template = 'e_inv_admission'")[0][0] == body["admitted"]


def test_a_token_cannot_outlive_fourteen_days(waves):
    make_user("a@example.test")
    open_wave(waves, capacity=1)

    window = query("SELECT expires_at - created_at FROM waitlist_tokens")[0][0]
    assert window.total_seconds() == 14 * 24 * 3600

    uid = query("SELECT waitlist_user_id FROM waitlist_tokens")[0][0]
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        with pytest.raises(psycopg2.errors.CheckViolation):
            cur.execute(
                "INSERT INTO waitlist_tokens (waitlist_user_id, expires_at) "
                "VALUES (%s, now() + interval '90 days')",
                (uid,),
            )
    conn.close()


def test_a_user_cannot_hold_two_live_grants(waves):
    """Single-use is about the PERSON. A second live grant is a second
    admission for the same human."""
    uid = make_user("a@example.test")
    open_wave(waves, capacity=1)

    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        with pytest.raises(psycopg2.errors.UniqueViolation):
            cur.execute(
                "INSERT INTO waitlist_tokens (waitlist_user_id, expires_at) "
                "VALUES (%s, now() + interval '14 days')",
                (uid,),
            )
    conn.close()


def test_admitted_users_leave_the_queue_view(waves):
    make_user("admitted@example.test", points=90)
    make_user("stays@example.test", points=10)

    open_wave(waves, capacity=1, priority_pct=100, zero_pct=0)

    remaining = [r[0] for r in query("SELECT email FROM waitlist_queue")]
    assert remaining == ["stays@example.test"], (
        "an admitted user still in the queue pushes everyone behind them down a slot"
    )


def test_an_empty_queue_is_reported_not_failed(waves):
    """An operator needs to see 'nobody matched', not a failure they will go
    hunting for a cause behind."""
    status, body = open_wave(waves, capacity=5)

    assert status == 200
    assert body["admitted"] == 0
    assert body["wave_number"] is None
    assert query("SELECT count(*) FROM waves")[0][0] == 0, "an empty wave is not recorded"


def test_a_second_wave_increments_the_number(waves):
    make_user("first@example.test", points=90)
    make_user("second@example.test", points=80)

    _, one = open_wave(waves, capacity=1, priority_pct=100, zero_pct=0)
    _, two = open_wave(waves, capacity=1, priority_pct=100, zero_pct=0)

    assert (one["wave_number"], two["wave_number"]) == (1, 2)
    assert sorted(r[0] for r in query("SELECT wave_number FROM waitlist_users WHERE wave_number IS NOT NULL")) == [1, 2]


def test_an_already_admitted_user_is_not_re_admitted(waves):
    make_user("already@example.test", points=90, status="admitted")
    make_user("waiting@example.test", points=10)

    _, body = open_wave(waves, capacity=4, priority_pct=100, zero_pct=0)

    assert body["admitted"] == 1
    assert query("SELECT count(*) FROM waitlist_tokens")[0][0] == 1


def test_a_small_wave_still_admits_someone(waves):
    """Integer division on the percentage split gives 0 and 0 for capacity 1, so
    without redistributing the remainder a wave of one admits NOBODY and reports
    success. Wave 1 is 10-20 people (M11-D10), so small capacities are the
    normal case rather than an edge."""
    make_user("only@example.test", points=10)

    status, body = open_wave(waves, capacity=1)

    assert status == 200
    assert body["admitted"] == 1, "a wave of one must admit one person"
    assert admitted_emails() == ["only@example.test"]


@pytest.mark.parametrize("capacity", [1, 2, 3, 5, 7])
def test_a_wave_admits_up_to_its_capacity_at_every_size(waves, capacity):
    """The shares are approximate; the capacity is not. No size may quietly
    admit fewer people than the operator asked for when the queue can fill it."""
    for i in range(10):
        make_user(f"u{i}@example.test", points=i, created=BASE + timedelta(minutes=i))

    _, body = open_wave(waves, capacity=capacity)

    assert body["admitted"] == capacity, (
        f"capacity {capacity} admitted {body['admitted']} from a queue of 10"
    )


def test_a_user_holding_an_unburned_grant_does_not_abort_the_whole_wave(waves):
    """One stale grant used to roll the entire wave back with
    `constraint_violation` — "That conflicts with data already stored" — naming
    neither the user nor the reason. Four innocent people lost their wave.

    The precondition is ordinary: E-inv says "unclaimed access returns to the
    pool", there is no reaper, so an operator returns an admitted user to
    'waiting' by hand and the next wave dies."""
    stale = make_user("stale@example.test", points=99)
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO waitlist_tokens (waitlist_user_id, expires_at) "
            "VALUES (%s, now() + interval '14 days')",
            (stale,),
        )
    conn.close()
    for i in range(4):
        make_user(f"healthy{i}@example.test", points=10 + i)

    status, body = open_wave(waves, capacity=5)

    assert status == 200, body
    assert body["admitted"] == 4, "the four healthy users must still get their wave"
    assert "stale@example.test" not in admitted_emails()


def test_the_breakdown_reports_backfilled_users_in_their_real_cohort(waves):
    """The old comment claimed exactly this while the code did the opposite —
    every backfilled user was reported as a points admission, so the one number
    an operator would use to check the split was the number that lied."""
    make_user("scorer@example.test", points=90)
    make_user("zeropoints@example.test", points=0)

    _, body = open_wave(waves, capacity=2, priority_pct=50, zero_pct=50)

    assert body["admitted"] == 2
    assert body["breakdown"]["priority"] == 1
    assert body["breakdown"]["zero"] == 1, f"a zero-point admission reported as priority: {body}"


def test_an_explicit_zero_pct_of_zero_is_honoured(waves):
    """"~75%" is approximate. A typed 0 is an instruction, and backfilling over
    it gave the operator the opposite of what they asked for."""
    make_user("scorer@example.test", points=90)
    make_user("zeropoints@example.test", points=0)

    _, body = open_wave(waves, capacity=2, priority_pct=100, zero_pct=0)

    assert body["admitted"] == 1, f"only the scorer qualifies when zero_pct is 0: {body}"
    assert admitted_emails() == ["scorer@example.test"]
