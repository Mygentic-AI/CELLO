"""
Tests for the waitlist email dispatcher (DOD-EMAIL-INFRA-1, DOD-E1-1).

Real Postgres; SES is faked at the boundary only — the suppression and segment
rules are database behaviour, and the thing under test is which rows get picked
up and what happens to them, not AWS's wire format.
"""

import os
import sys
import uuid
from pathlib import Path

import psycopg2
import pytest

from waitlist_testdb import PGURL, query, load_lambda


class FakeSES:
    """Records sends instead of performing them."""

    def __init__(self, fail_on=None):
        self.sent = []
        self.fail_on = fail_on or set()

    def send_email(self, **kwargs):
        to = kwargs["Destination"]["ToAddresses"][0]
        if to in self.fail_on:
            raise RuntimeError(f"SES rejected {to}")
        self.sent.append(kwargs)
        return {"MessageId": str(uuid.uuid4())}


@pytest.fixture()
def mailer(database, monkeypatch):
    os.environ["DATABASE_URL"] = PGURL
    os.environ["PGSSLMODE"] = "disable"
    mod = load_lambda(Path(__file__).parent, "email_handler")
    fake = FakeSES()
    monkeypatch.setattr(mod, "ses", lambda: fake)
    mod.fake = fake
    return mod


def make_user(email, *, email_status="active", content_alerts=False, status="waiting", points=0):
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO waitlist_users (email, anon_id, email_status, content_alerts, status, points_total)
            VALUES (%s, %s, %s, %s, %s, %s) RETURNING waitlist_id
            """,
            (email, str(uuid.uuid4()), email_status, content_alerts, status, points),
        )
        uid = cur.fetchone()[0]
        cur.execute(
            "INSERT INTO referral_codes (code, owner_waitlist_user_id, type) VALUES (%s, %s, 'share')",
            (f"C{str(uid)[:8].upper()}", uid),
        )
    conn.close()
    return uid


def enqueue(user_id, template="e1_confirm"):
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO email_jobs (user_id, template, scheduled_at) VALUES (%s, %s, now()) RETURNING id",
            (user_id, template),
        )
        jid = cur.fetchone()[0]
    conn.close()
    return jid


def job_status(job_id):
    return query("SELECT status FROM email_jobs WHERE id = %s", (job_id,))[0][0]


# ── DOD-INV-EMAIL-SUPPRESS ────────────────────────────────────────────────────


@pytest.mark.parametrize("bad_status", ["bounced", "complained", "unsubscribed"])
def test_a_suppressed_address_receives_nothing(mailer, bad_status):
    uid = make_user(f"{bad_status}@example.test", email_status=bad_status)
    jid = enqueue(uid)

    counts = mailer.lambda_handler({}, None)

    assert mailer.fake.sent == [], f"{bad_status} address must receive zero emails"
    assert counts == {"sent": 0, "skipped": 1, "failed": 0}
    assert job_status(jid) == "skipped"


def test_suppression_beats_lifecycle_status(mailer):
    """An admitted user with a bounced address gets nothing. Suppression is a
    property of the ADDRESS and is independent of where the user is in the
    funnel."""
    uid = make_user("admitted-bounced@example.test", email_status="bounced", status="admitted")
    enqueue(uid)

    mailer.lambda_handler({}, None)

    assert mailer.fake.sent == []


# ── DOD-INV-EMAIL-SEGMENTS ────────────────────────────────────────────────────


def test_content_alerts_go_only_to_opted_in_users(mailer):
    opted = make_user("opted@example.test", content_alerts=True)
    not_opted = make_user("notopted@example.test", content_alerts=False)
    enqueue(opted, "e_alert")
    enqueue(not_opted, "e_alert")

    mailer.lambda_handler({}, None)

    recipients = [m["Destination"]["ToAddresses"][0] for m in mailer.fake.sent]
    assert "notopted@example.test" not in recipients, (
        "an e_alert to a user who never opted in is the segment conflation "
        "DOD-INV-EMAIL-SEGMENTS forbids"
    )


def test_base_list_mail_ignores_the_content_alert_flag(mailer):
    """E1/E2/E3 go to the base list unconditionally. Filtering them on
    content_alerts is the same defect in the opposite direction."""
    uid = make_user("nocontent@example.test", content_alerts=False)
    enqueue(uid, "e1_confirm")

    mailer.lambda_handler({}, None)

    assert [m["Destination"]["ToAddresses"][0] for m in mailer.fake.sent] == [
        "nocontent@example.test"
    ]


# ── Delivery semantics ────────────────────────────────────────────────────────


def test_a_sent_job_is_not_sent_again_on_the_next_tick(mailer):
    uid = make_user("once@example.test")
    enqueue(uid)

    mailer.lambda_handler({}, None)
    mailer.lambda_handler({}, None)

    assert len(mailer.fake.sent) == 1, "a duplicate email cannot be recalled"


def test_a_future_scheduled_job_is_not_sent_early(mailer):
    uid = make_user("later@example.test")
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO email_jobs (user_id, template, scheduled_at) "
            "VALUES (%s, 'e1_confirm', now() + interval '1 day')",
            (uid,),
        )
    conn.close()

    counts = mailer.lambda_handler({}, None)

    assert counts["sent"] == 0
    assert mailer.fake.sent == []


def test_an_unknown_template_fails_loudly_and_stays_pending(mailer):
    """A silent skip would mark the job done with nothing sent and no signal
    that a template was never wired up."""
    uid = make_user("unwired@example.test")
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        # Bypass the app to simulate a template the enum allows but no renderer
        # implements yet.
        cur.execute(
            "INSERT INTO email_jobs (user_id, template, scheduled_at) "
            "VALUES (%s, 'e3_update', now()) RETURNING id",
            (uid,),
        )
        jid = cur.fetchone()[0]
    conn.close()

    counts = mailer.lambda_handler({}, None)

    assert counts["failed"] == 1
    assert job_status(jid) == "pending", "a failed job retries; it is not silently consumed"
    assert mailer.fake.sent == []


def test_one_failing_job_does_not_sink_the_rest_of_the_batch(mailer):
    good = make_user("good@example.test")
    bad = make_user("bad@example.test")
    good_job, bad_job = enqueue(good), enqueue(bad)
    mailer.fake.fail_on = {"bad@example.test"}

    counts = mailer.lambda_handler({}, None)

    assert counts["sent"] == 1 and counts["failed"] == 1
    assert job_status(good_job) == "sent"
    assert job_status(bad_job) == "pending"


# ── DOD-E1-1 content ──────────────────────────────────────────────────────────


def test_e1_carries_a_real_queue_position_a_referral_link_and_a_verify_token(mailer):
    make_user("ahead@example.test", points=100)
    uid = make_user("e1@example.test", points=5)
    enqueue(uid)

    mailer.lambda_handler({}, None)

    body = mailer.fake.sent[0]["Message"]["Body"]["Text"]["Data"]
    assert "#2 of 2 on the list" in body, f"real computed position expected, got:\n{body}"
    assert "/?ref=C" in body, "personal referral link missing"
    assert "waves" in body.lower(), "the how-waves-work sentence is a DOD-E1-1 clause"

    token = query(
        "SELECT token, kind FROM auth_tokens WHERE waitlist_user_id = %s", (uid,)
    )[0]
    assert str(token[0]) in body, "the confirm link must carry the minted token"
    assert token[1] == "email_verify"


def test_the_e1_verify_token_gets_24_hours_not_15_minutes(mailer):
    uid = make_user("window@example.test")
    enqueue(uid)
    mailer.lambda_handler({}, None)

    window = query(
        "SELECT expires_at - created_at FROM auth_tokens WHERE waitlist_user_id = %s", (uid,)
    )[0][0]
    assert window.total_seconds() == 24 * 3600


def test_a_magic_link_token_is_still_bounded_at_fifteen_minutes(mailer):
    """The kind-aware CHECK must not have loosened the /auth window to 24h."""
    uid = make_user("magic@example.test")
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        with pytest.raises(psycopg2.errors.CheckViolation):
            cur.execute(
                "INSERT INTO auth_tokens (waitlist_user_id, kind, expires_at) "
                "VALUES (%s, 'magic_link', now() + interval '24 hours')",
                (uid,),
            )
    conn.close()


def test_no_position_is_shown_rather_than_a_fabricated_one(mailer):
    """DOD-INV-NO-INFLATION. An admitted user has no queue row; the sentence is
    omitted, not filled with a placeholder."""
    uid = make_user("admitted@example.test", status="admitted")
    enqueue(uid)

    mailer.lambda_handler({}, None)

    body = mailer.fake.sent[0]["Message"]["Body"]["Text"]["Data"]
    assert "#" not in body, f"no position should appear for a non-queued user:\n{body}"
