"""
Tests for the P1 schema constraints (DOD-SCHEMA-P1-1, DOD-INV-HANDLE-UNIQUE).

These constraints exist to hold against a caller who forgot to check. Testing
them through the database directly is the point — an application-layer test
would prove only that today's application remembers.
"""

import uuid

import psycopg2
import pytest

from waitlist_testdb import PGURL, query


def make_user(email):
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


def execute(sql, params=()):
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params)
    finally:
        conn.close()


# ── DOD-INV-HANDLE-UNIQUE ─────────────────────────────────────────────────────


def test_one_handle_cannot_belong_to_two_waitlist_entries(database):
    """Otherwise one person farms the public-post points from a single X account
    across as many signups as they care to make."""
    first = make_user("first@example.test")
    second = make_user("second@example.test")

    execute(
        "INSERT INTO waitlist_social_profiles (waitlist_user_id, platform, handle) "
        "VALUES (%s, 'x', 'samehandle')",
        (first,),
    )

    with pytest.raises(psycopg2.errors.UniqueViolation):
        execute(
            "INSERT INTO waitlist_social_profiles (waitlist_user_id, platform, handle) "
            "VALUES (%s, 'x', 'samehandle')",
            (second,),
        )


def test_one_user_cannot_connect_two_accounts_on_the_same_platform(database):
    """The other direction: two X accounts on one entry would double the
    public-post ceiling for that user."""
    uid = make_user("multi@example.test")
    execute(
        "INSERT INTO waitlist_social_profiles (waitlist_user_id, platform, handle) "
        "VALUES (%s, 'x', 'handle_one')",
        (uid,),
    )

    with pytest.raises(psycopg2.errors.UniqueViolation):
        execute(
            "INSERT INTO waitlist_social_profiles (waitlist_user_id, platform, handle) "
            "VALUES (%s, 'x', 'handle_two')",
            (uid,),
        )


def test_the_same_handle_on_different_platforms_is_fine(database):
    """Someone is usually the same name on X and Reddit; that is not a
    collision."""
    uid = make_user("crossplatform@example.test")
    execute(
        "INSERT INTO waitlist_social_profiles (waitlist_user_id, platform, handle) "
        "VALUES (%s, 'x', 'samename')",
        (uid,),
    )
    execute(
        "INSERT INTO waitlist_social_profiles (waitlist_user_id, platform, handle) "
        "VALUES (%s, 'reddit', 'samename')",
        (uid,),
    )

    assert query("SELECT count(*) FROM waitlist_social_profiles")[0][0] == 2


def test_an_unknown_platform_is_rejected(database):
    uid = make_user("platform@example.test")
    with pytest.raises(psycopg2.errors.CheckViolation):
        execute(
            "INSERT INTO waitlist_social_profiles (waitlist_user_id, platform, handle) "
            "VALUES (%s, 'mastodon', 'someone')",
            (uid,),
        )


# ── post_review_queue ─────────────────────────────────────────────────────────


def test_a_review_outcome_cannot_exist_without_a_review_timestamp(database):
    """Either state alone looks 'handled' in a list view while meaning nothing."""
    uid = make_user("review@example.test")

    with pytest.raises(psycopg2.errors.CheckViolation):
        execute(
            "INSERT INTO post_review_queue (waitlist_user_id, platform, post_url, outcome) "
            "VALUES (%s, 'x', 'https://x.com/a/1', 'approved')",
            (uid,),
        )

    with pytest.raises(psycopg2.errors.CheckViolation):
        execute(
            "INSERT INTO post_review_queue (waitlist_user_id, platform, post_url, reviewed_at) "
            "VALUES (%s, 'x', 'https://x.com/a/2', now())",
            (uid,),
        )


def test_a_submission_starts_unreviewed_and_awards_nothing(database):
    """M11-D4: credit is applied on approval only. Submitting must not move
    points on its own."""
    uid = make_user("submitter@example.test")
    execute(
        "INSERT INTO post_review_queue (waitlist_user_id, platform, post_url) "
        "VALUES (%s, 'x', 'https://x.com/a/3')",
        (uid,),
    )

    row = query(
        "SELECT reviewed_at, outcome FROM post_review_queue WHERE waitlist_user_id = %s", (uid,)
    )[0]
    assert row == (None, None)
    assert query("SELECT points_total FROM waitlist_users WHERE waitlist_id = %s", (uid,))[0][0] == 0


def test_the_same_url_cannot_be_submitted_twice_by_one_user(database):
    """Re-submitting an already-approved post is the simplest way to claim its
    points again."""
    uid = make_user("resubmit@example.test")
    execute(
        "INSERT INTO post_review_queue (waitlist_user_id, platform, post_url) "
        "VALUES (%s, 'x', 'https://x.com/a/4')",
        (uid,),
    )

    with pytest.raises(psycopg2.errors.UniqueViolation):
        execute(
            "INSERT INTO post_review_queue (waitlist_user_id, platform, post_url) "
            "VALUES (%s, 'x', 'https://x.com/a/4')",
            (uid,),
        )


# ── points_ledger caps (shipped in 0003, asserted here as a P1 clause) ────────


def test_the_public_post_cap_is_forty_five(database):
    uid = make_user("poster@example.test")
    for _ in range(3):
        execute(
            "INSERT INTO points_ledger (waitlist_user_id, points, reason) "
            "VALUES (%s, 15, 'public_post')",
            (uid,),
        )

    assert query("SELECT points_total FROM waitlist_users WHERE waitlist_id = %s", (uid,))[0][0] == 45

    with pytest.raises(psycopg2.errors.CheckViolation):
        execute(
            "INSERT INTO points_ledger (waitlist_user_id, points, reason) "
            "VALUES (%s, 15, 'public_post')",
            (uid,),
        )


@pytest.mark.parametrize("reason,points", [("survey", 20), ("interview_commit", 30), ("technical_readiness", 20)])
def test_a_once_only_reason_can_be_earned_exactly_once(database, reason, points):
    """These three have "cap: none" in the requirements table, which reads as
    "no ceiling" — but each action's DoD line also says a second submit is a
    no-op. Both are true: there is no ceiling on the AMOUNT because the action
    happens once by nature. 0009 enforces that at the database, so idempotency
    does not depend on the endpoint remembering to check.
    """
    uid = make_user(f"{reason}@example.test")
    execute(
        "INSERT INTO points_ledger (waitlist_user_id, points, reason) VALUES (%s, %s, %s)",
        (uid, points, reason),
    )

    with pytest.raises(psycopg2.errors.UniqueViolation):
        execute(
            "INSERT INTO points_ledger (waitlist_user_id, points, reason) VALUES (%s, %s, %s)",
            (uid, points, reason),
        )

    assert query("SELECT points_total FROM waitlist_users WHERE waitlist_id = %s", (uid,))[0][0] == points


@pytest.mark.parametrize("reason,points,cap", [("share_conversion", 10, 30), ("public_post", 15, 45)])
def test_a_repeatable_reason_accrues_up_to_its_cap(database, reason, points, cap):
    """The mirror image: these two are earned many times, so they must NOT be
    once-per-user — only bounded. A bug that put them in the once-only index
    would silently stop the referral engine after a single conversion."""
    uid = make_user(f"{reason}@example.test")
    for _ in range(cap // points):
        execute(
            "INSERT INTO points_ledger (waitlist_user_id, points, reason) VALUES (%s, %s, %s)",
            (uid, points, reason),
        )

    assert query("SELECT points_total FROM waitlist_users WHERE waitlist_id = %s", (uid,))[0][0] == cap

    with pytest.raises(psycopg2.errors.CheckViolation):
        execute(
            "INSERT INTO points_ledger (waitlist_user_id, points, reason) VALUES (%s, %s, %s)",
            (uid, points, reason),
        )
