"""
Tests for the waitlist_queue view (DOD-QUEUE-VIEW-1).

Lives here because this is where a real Postgres harness already exists, and
because the status endpoint that will read the view is a sibling Lambda. The
view itself is defined in corp-cello-site/migrations/0004_queue_position_view.sql.

Run: PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 \
     PGURL=postgres://m11:m11@localhost:55432/m11_test python3 -m pytest -q
"""

import uuid
from datetime import datetime, timedelta, timezone

import psycopg2
import pytest

from conftest import PGURL, query  # fixtures are auto-discovered from conftest


def insert_user(email, points, created_at, status="waiting"):
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO waitlist_users (email, anon_id, points_total, created_at, status)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING waitlist_id
            """,
            (email, str(uuid.uuid4()), points, created_at, status),
        )
        wid = cur.fetchone()[0]
    conn.close()
    return wid


def positions():
    return {
        row[0]: row[1]
        for row in query("SELECT email, queue_position FROM waitlist_queue ORDER BY queue_position")
    }


BASE = datetime(2026, 7, 1, tzinfo=timezone.utc)


def test_higher_points_ranks_ahead(database):
    insert_user("low@example.test", 10, BASE)
    insert_user("high@example.test", 50, BASE + timedelta(days=1))

    assert positions() == {"high@example.test": 1, "low@example.test": 2}, (
        "points must outrank signup order — a later signup with more points is ahead"
    )


def test_inserting_between_two_users_shifts_the_one_below(database):
    insert_user("first@example.test", 50, BASE)
    insert_user("third@example.test", 10, BASE)
    assert positions()["third@example.test"] == 2

    insert_user("second@example.test", 30, BASE)

    assert positions() == {
        "first@example.test": 1,
        "second@example.test": 2,
        "third@example.test": 3,
    }, "the view is computed, so an insert between two users must move the lower one down"


def test_equal_points_are_broken_by_who_waited_longer(database):
    insert_user("newer@example.test", 20, BASE + timedelta(days=5))
    insert_user("older@example.test", 20, BASE)

    assert positions() == {"older@example.test": 1, "newer@example.test": 2}


def test_non_waiting_users_do_not_occupy_queue_positions(database):
    """An admitted user still sitting in the queue would push everyone behind
    them down a slot — a position that overstates how many people are ahead is
    the inflation DOD-INV-NO-INFLATION forbids, just in the pessimistic
    direction."""
    insert_user("admitted@example.test", 99, BASE, status="admitted")
    insert_user("banned@example.test", 98, BASE, status="banned")
    insert_user("waiting@example.test", 5, BASE)

    assert positions() == {"waiting@example.test": 1}


def test_queue_position_is_not_a_stored_column(database):
    """The DoD is explicit: computed, never stored. A column would go stale the
    moment anyone else earned points."""
    cols = query(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_name = 'waitlist_users' AND column_name IN ('queue_position','queue_size')"
    )
    assert cols == [], f"queue_position must not exist on the table, found {cols}"


def test_queue_size_counts_only_the_waiting(database):
    insert_user("a@example.test", 10, BASE)
    insert_user("b@example.test", 20, BASE)
    insert_user("gone@example.test", 30, BASE, status="admitted")

    sizes = {row[0] for row in query("SELECT queue_size FROM waitlist_queue")}
    assert sizes == {2}, f"queue_size must exclude non-waiting users, got {sizes}"


def test_points_earned_move_a_user_up_without_any_write_to_the_view(database):
    """The whole point of a computed view: nothing recalculates or backfills."""
    insert_user("climber@example.test", 0, BASE)
    insert_user("leader@example.test", 40, BASE)
    assert positions()["climber@example.test"] == 2

    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO points_ledger (waitlist_user_id, points, reason) "
            "SELECT waitlist_id, 60, 'survey' FROM waitlist_users WHERE email='climber@example.test'"
        )
    conn.close()

    assert positions()["climber@example.test"] == 1, (
        "a ledger insert alone must change the position — the trigger updates "
        "points_total and the view re-derives from it"
    )
