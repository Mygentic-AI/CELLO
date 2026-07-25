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


def test_day_six_grants_two_even_to_someone_who_already_has_first_win_invites(outreach):
    """The defect: the ceiling counted ALL premium codes, so a first-win user
    holding 3 needed 0, got ZERO, and was stamped as granted so they could never
    be picked up again. Eligibility is measured in sealed sessions, so almost
    everyone who reaches Day 6 has already reached first win — this was the
    common case, not the edge."""
    uid = make_eligible(days_ago=7)
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

    body = sweep(outreach)

    assert body["invites_issued"] == 2, "the Day-6 grant is unconditional"
    assert invites(uid) == 5, "three from first win plus two from outreach"


def test_the_sweep_reports_invites_issued_not_just_rows_claimed(outreach):
    """It said day_six_granted: 1 while issuing nothing at all."""
    uid = make_eligible(days_ago=7)

    body = sweep(outreach)

    assert body["day_six_granted"] == 1
    assert body["invites_issued"] == 2


def test_the_call_ceiling_still_counts_everything(outreach):
    """M11-D28 stands: the 4 is a cap on what one person hands out, so first-win
    invites count toward it. Only the Day-6 GRANT is scoped."""
    uid = make_eligible(days_ago=1)
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        for i in range(3):
            cur.execute(
                "INSERT INTO referral_codes (code, owner_waitlist_user_id, type) "
                "VALUES (%s, %s, 'premium')",
                (f"FW{i}", uid),
            )
    conn.close()

    _, body = complete(outreach, uid)

    assert body["granted"] == 1
    assert invites(uid) == 4


# ── DOD-FEEDBACK-OUTREACH-1: the Day-6 status-page note ───────────────────────


def live_notes(uid, kind=None):
    sql = "SELECT kind, body FROM status_notes WHERE waitlist_user_id = %s AND dismissed_at IS NULL"
    params = [uid]
    if kind:
        sql += " AND kind = %s"
        params.append(kind)
    return query(sql, tuple(params))


def hold_outreach_invites(uid, n):
    """Premium codes carrying meta.source = 'outreach'.

    Plain premium codes would NOT do: the Day-6 grant is scoped to codes from
    this sequence, so a first-win code does not suppress it. Seeding the wrong
    kind is how a test about the ceiling ends up not testing the ceiling.
    """
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        for i in range(n):
            cur.execute(
                "INSERT INTO referral_codes (code, owner_waitlist_user_id, type, meta) "
                "VALUES (%s, %s, 'premium', '{\"source\": \"outreach\"}'::jsonb)",
                (f"OUT{i}{str(uid)[:8].upper()}", uid),
            )
    conn.close()


def test_day_six_writes_a_status_note_alongside_the_grant(outreach):
    """The DoD clause is "auto-grant 2 premium invite codes; set a status-page
    note." Only the grant happened before, so a user received two invite codes
    with nothing anywhere telling them the codes existed."""
    uid = make_eligible("noted@example.test", days_ago=7)

    result = sweep(outreach)

    assert result["invites_issued"] == 2
    assert result["notes_written"] == 1
    notes = live_notes(uid, "feedback_invites_granted")
    assert len(notes) == 1
    assert "2 premium invites are" in notes[0][1]


def test_no_grant_means_no_note(outreach):
    """grant_invites_up_to grants UP TO a target, so somebody already holding
    two outreach invites receives zero. Telling them invites arrived when none
    did sends them looking for codes that are not there."""
    uid = make_eligible("atcap@example.test", days_ago=7)
    hold_outreach_invites(uid, 2)

    result = sweep(outreach)

    assert result["invites_issued"] == 0
    assert result["notes_written"] == 0
    assert live_notes(uid, "feedback_invites_granted") == []


def test_a_replayed_sweep_writes_no_second_note(outreach):
    """The sweep is idempotent, so it must not produce a second note.

    NOTE ON WHAT THIS DOES *NOT* PROVE. The sweep never reaches note() twice —
    feedback_day6_granted_at stops it re-claiming the user — so this passes
    even with note() written as an upsert. It covers the sweep. The note's own
    idempotency is a separate property and is tested directly below, because a
    test that passes for a reason other than the one in its name is how a
    guarantee gets believed without ever being checked.
    """
    uid = make_eligible("replay@example.test", days_ago=7)

    sweep(outreach)
    second = sweep(outreach)

    assert second["notes_written"] == 0
    assert len(live_notes(uid, "feedback_invites_granted")) == 1


def test_writing_the_same_note_twice_neither_duplicates_nor_restamps_it(outreach):
    """note() itself, called twice — the case the sweep can never produce.

    Two things must hold. No duplicate row, obviously. And created_at must not
    move: an upsert would shuffle a note the user has already read back to the
    top of their page, and rewrite a body they have already seen, with nothing
    recording that it changed.
    """
    uid = make_eligible("noteidem@example.test", days_ago=7)

    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        assert outreach.note(cur, uid, "wave_admitted", "You're in.") == 1
        before = query(
            "SELECT created_at, body FROM status_notes WHERE waitlist_user_id = %s", (uid,)
        )[0]

        assert outreach.note(cur, uid, "wave_admitted", "DIFFERENT TEXT") == 0, (
            "a second write must report that it wrote nothing"
        )
    conn.close()

    rows = query("SELECT created_at, body FROM status_notes WHERE waitlist_user_id = %s", (uid,))
    assert len(rows) == 1, "one live note per kind"
    assert rows[0][0] == before[0], "created_at must not move"
    assert rows[0][1] == "You're in.", "the body the user read must not be rewritten"


def test_a_dismissed_note_can_be_raised_again(outreach):
    """The uniqueness is partial on dismissed_at IS NULL, deliberately: a second
    wave admission is a real new fact, and a permanent block would silence it."""
    uid = make_eligible("redo@example.test", days_ago=7)

    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        outreach.note(cur, uid, "wave_admitted", "Wave 1.")
        cur.execute("UPDATE status_notes SET dismissed_at = now() WHERE waitlist_user_id = %s", (uid,))
        assert outreach.note(cur, uid, "wave_admitted", "Wave 2.") == 1
    conn.close()

    assert [b for _, b in live_notes(uid, "wave_admitted")] == ["Wave 2."]


def test_the_note_states_what_was_granted_not_the_configured_target(outreach):
    """DOD-INV-NO-INFLATION applied to prose. One outreach invite already held
    means one more is issued, and the note must say one."""
    uid = make_eligible("partial@example.test", days_ago=7)
    hold_outreach_invites(uid, 1)

    result = sweep(outreach)

    assert result["invites_issued"] == 1
    body = live_notes(uid, "feedback_invites_granted")[0][1]
    assert "1 premium invite is" in body, f"the note must say 1, not 2. Got: {body}"


def test_day_six_and_call_completed_notes_coexist(outreach):
    """Uniqueness is per KIND, so both facts stay visible to the user."""
    uid = make_eligible("both@example.test", days_ago=7)
    sweep(outreach)

    status, _ = complete(outreach, uid)

    assert status == 200
    assert sorted(k for k, _ in live_notes(uid)) == [
        "call_invites_granted",
        "feedback_invites_granted",
    ]
