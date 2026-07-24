"""
Tests for the waitlist email dispatcher (DOD-EMAIL-INFRA-1, DOD-E1-1).

Real Postgres; SES is faked at the boundary only — the suppression and segment
rules are database behaviour, and the thing under test is which rows get picked
up and what happens to them, not AWS's wire format.
"""

import json
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


def enqueue_with_payload(user_id, template, payload):
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO email_jobs (user_id, template, scheduled_at, payload) "
            "VALUES (%s, %s, now(), %s) RETURNING id",
            (user_id, template, json.dumps(payload)),
        )
        jid = cur.fetchone()[0]
    conn.close()
    return jid


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
    enqueue(uid)

    counts = mailer.lambda_handler({}, None)

    assert mailer.fake.sent == [], f"{bad_status} address must receive zero emails"
    assert counts["sent"] == 0 and counts["skipped"] == 1


@pytest.mark.parametrize(
    "status,expected_state",
    [("bounced", "skipped"), ("complained", "skipped"), ("unsubscribed", "pending")],
)
def test_only_a_permanent_suppression_retires_the_job(mailer, status, expected_state):
    """An unsubscribed user can resubscribe. Retiring their job means the
    confirmation they are waiting for never arrives after they opt back in —
    a silent, permanent consequence of a reversible action."""
    uid = make_user(f"rev-{status}@example.test", email_status=status)
    jid = enqueue(uid)

    mailer.lambda_handler({}, None)

    assert job_status(jid) == expected_state
    assert query("SELECT skip_reason FROM email_jobs WHERE id = %s", (jid,))[0][0] == f"email_status_{status}"


def test_suppression_beats_lifecycle_status(mailer):
    """An admitted user with a bounced address gets nothing. Suppression is a
    property of the ADDRESS and is independent of where the user is in the
    funnel."""
    uid = make_user("admitted-bounced@example.test", email_status="bounced", status="admitted")
    enqueue(uid)

    mailer.lambda_handler({}, None)

    assert mailer.fake.sent == []


# ── DOD-INV-EMAIL-SEGMENTS ────────────────────────────────────────────────────


def test_content_alerts_go_only_to_opted_in_users(mailer, monkeypatch):
    """Asserts BOTH directions.

    An earlier version of this test only asserted the negative, and passed for
    the wrong reason: e_alert has no renderer, so the opted-IN job died with a
    KeyError before the segment filter ever ran and `recipients` was empty. An
    empty list satisfies "not in" trivially — deleting the filter entirely left
    it green. Registering a stub renderer makes the positive assertion possible,
    and the positive assertion is what gives the negative one meaning.
    """
    import templates

    monkeypatch.setitem(
        templates.TEMPLATES, "e_alert", lambda job: ("Alert", "<p>x</p>", "x")
    )

    opted = make_user("opted@example.test", content_alerts=True)
    not_opted = make_user("notopted@example.test", content_alerts=False)
    enqueue(opted, "e_alert")
    enqueue(not_opted, "e_alert")

    mailer.lambda_handler({}, None)

    recipients = [m["Destination"]["ToAddresses"][0] for m in mailer.fake.sent]
    assert recipients == ["opted@example.test"], (
        "the opted-in user must RECEIVE it and the other must not — "
        f"DOD-INV-EMAIL-SEGMENTS, both directions. Got {recipients}"
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


def test_an_unknown_template_fails_loudly_and_stays_pending(mailer, monkeypatch):
    """A silent skip would mark the job done with nothing sent and no signal
    that a template was never wired up.

    Every enum value has a renderer today, so this removes one — which is
    exactly the real scenario: a migration widens the enum and the renderer
    lands in a later commit, or does not.
    """
    import templates

    monkeypatch.delitem(templates.TEMPLATES, "e3_update")
    uid = make_user("unwired@example.test")
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
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


def test_a_permanently_failing_job_retires_instead_of_starving_the_queue(mailer, monkeypatch):
    """Claiming is oldest-first. Without a terminal state, a permanently
    failing job returns to the front forever and every job behind it stops
    being delivered — silently, while the batch summary reports a number."""
    import templates

    monkeypatch.delitem(templates.TEMPLATES, "e3_update")
    uid = make_user("poison@example.test")
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO email_jobs (user_id, template, scheduled_at) "
            "VALUES (%s, 'e3_update', now()) RETURNING id",
            (uid,),
        )
        jid = cur.fetchone()[0]
    conn.close()

    for _ in range(mailer.MAX_ATTEMPTS):
        mailer.lambda_handler({}, None)

    assert job_status(jid) == "failed", "a job that cannot succeed must become terminal"
    err = query("SELECT last_error FROM email_jobs WHERE id = %s", (jid,))[0][0]
    assert "No renderer" in err, f"the terminal state must record WHY: {err}"


def test_a_retired_job_stops_blocking_the_ones_behind_it(mailer, monkeypatch):
    """The starvation property itself, not just the retirement."""
    import templates

    monkeypatch.delitem(templates.TEMPLATES, "e3_update")
    poison = make_user("blocker@example.test")
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO email_jobs (user_id, template, scheduled_at) "
            "VALUES (%s, 'e3_update', now() - interval '1 hour')",
            (poison,),
        )
    conn.close()

    good = make_user("behind@example.test")
    enqueue(good)

    for _ in range(mailer.MAX_ATTEMPTS + 1):
        mailer.lambda_handler({}, None)

    recipients = [m["Destination"]["ToAddresses"][0] for m in mailer.fake.sent]
    assert "behind@example.test" in recipients, "the healthy job must still be delivered"


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


# ── The payload must not be able to override the row (F2) ────────────────────


def test_a_payload_cannot_redirect_the_recipient(mailer):
    """Merging payload into the job let `email` point a DKIM-signed CELLO
    message at any address the operator typed."""
    uid = make_user("real@example.test")
    enqueue_with_payload(uid, "e1_confirm", {"email": "attacker@evil.test"})

    mailer.lambda_handler({}, None)

    recipients = [m["Destination"]["ToAddresses"][0] for m in mailer.fake.sent]
    assert recipients == ["real@example.test"], f"payload redirected the mail: {recipients}"


def test_a_payload_cannot_defeat_suppression(mailer):
    """DOD-INV-EMAIL-SUPPRESS read from the row, and the payload was overwriting
    the row."""
    uid = make_user("bounced@example.test", email_status="bounced")
    enqueue_with_payload(uid, "e1_confirm", {"email_status": "active"})

    mailer.lambda_handler({}, None)

    assert mailer.fake.sent == [], "a bounced address must receive nothing, payload or not"


def test_a_payload_cannot_defeat_the_segment_split(mailer, monkeypatch):
    """Both halves: content_alerts, and the template itself. should_send read the
    SHADOWED template, so an e_alert escaped CONTENT_ALERT_TEMPLATES entirely."""
    import templates

    monkeypatch.setitem(templates.TEMPLATES, "e_alert", lambda job: ("A", "<p>a</p>", "a"))
    uid = make_user("notopted@example.test", content_alerts=False)
    enqueue_with_payload(
        uid, "e_alert", {"content_alerts": True, "template": "e1_confirm"}
    )

    mailer.lambda_handler({}, None)

    assert mailer.fake.sent == [], "an unopted user must not receive an alert via payload"


def test_a_payload_cannot_leak_another_users_grant(mailer):
    """user_id shadowing put a victim's live admission token in the attacker's
    email, which they could then burn at the gate."""
    victim = make_user("victim@example.test")
    mallory = make_user("mallory@example.test")
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO waitlist_tokens (waitlist_user_id, expires_at) "
            "VALUES (%s, now() + interval '14 days') RETURNING token",
            (victim,),
        )
        victim_token = str(cur.fetchone()[0])
        cur.execute(
            "INSERT INTO waitlist_tokens (waitlist_user_id, expires_at) "
            "VALUES (%s, now() + interval '14 days')",
            (mallory,),
        )
    conn.close()
    enqueue_with_payload(mallory, "e_inv_admission", {"user_id": str(victim)})

    mailer.lambda_handler({}, None)

    body = mailer.fake.sent[0]["Message"]["Body"]["Text"]["Data"]
    assert victim_token not in body, "another user's admission grant reached the wrong inbox"


def test_operator_supplied_alert_content_still_reaches_the_template(mailer, monkeypatch):
    """The namespace must not break the thing payload exists for."""
    captured = {}

    def fake_alert(job):
        captured.update(job.get("ctx") or {})
        return ("t", "<p>t</p>", "t")

    import templates

    monkeypatch.setitem(templates.TEMPLATES, "e_alert", fake_alert)
    uid = make_user("opted@example.test", content_alerts=True)
    enqueue_with_payload(
        uid, "e_alert", {"alert_title": "New post", "alert_url": "https://cello.mygentic.ai/blog/x"}
    )

    mailer.lambda_handler({}, None)

    assert captured["alert_title"] == "New post"
    assert captured["alert_url"] == "https://cello.mygentic.ai/blog/x"


# ── DOD-EMAIL-DRIP-1 ─────────────────────────────────────────────────────────


def test_signup_enqueues_the_whole_drip_at_once(mailer):
    """E1 now, E2 tomorrow, the first E3 in two weeks. Enqueued at signup rather
    than discovered by a sweep, because the schedule is a property of THIS
    signup and a sweep would have to reconstruct it on every tick."""
    from pathlib import Path

    signup = load_lambda(
        Path(__file__).resolve().parents[1] / "waitlist-signup", "signup_for_drip"
    )
    event = {
        "headers": {"origin": "https://cello.mygentic.ai"},
        "requestContext": {"http": {"method": "POST", "path": "/waitlist/signup"}},
        "body": json.dumps(
            {"email": "drip@example.test", "anon_id": str(uuid.uuid4()), "touchpoints": []}
        ),
    }
    assert signup.lambda_handler(event, None)["statusCode"] == 200

    scheduled = query(
        "SELECT template, (scheduled_at::date - now()::date) AS days_out "
        "FROM email_jobs ORDER BY scheduled_at"
    )
    assert scheduled == [("e1_confirm", 0), ("e2_survey", 1), ("e3_update", 14)]


def test_sending_an_e3_queues_the_next_one(mailer):
    """Self-perpetuating rather than swept: a chain only has to answer "did this
    one send?", which it already knows."""
    uid = make_user("nurture@example.test")
    enqueue(uid, "e3_update")

    mailer.lambda_handler({}, None)

    pending = query(
        "SELECT count(*) FROM email_jobs WHERE template = 'e3_update' AND status = 'pending'"
    )[0][0]
    assert pending == 1, "the next nurture must be queued"
    days = query(
        "SELECT (scheduled_at::date - now()::date) FROM email_jobs "
        "WHERE template = 'e3_update' AND status = 'pending'"
    )[0][0]
    assert days == 14


def test_the_nurture_chain_ends_when_someone_is_admitted(mailer):
    """A drip that keeps arriving after admission says plainly that nobody is
    watching."""
    uid = make_user("admitted@example.test", status="admitted")
    enqueue(uid, "e3_update")

    mailer.lambda_handler({}, None)

    assert query(
        "SELECT count(*) FROM email_jobs WHERE template = 'e3_update' AND status = 'pending'"
    )[0][0] == 0


def test_the_nurture_chain_does_not_extend_for_a_suppressed_address(mailer):
    """The existing job stays pending — an unsubscribe is reversible and their
    E3 should reach them if they come back. What must NOT happen is the chain
    growing a new link for somebody who is not receiving anything."""
    uid = make_user("gone@example.test", email_status="unsubscribed")
    enqueue(uid, "e3_update")

    mailer.lambda_handler({}, None)

    assert query("SELECT count(*) FROM email_jobs WHERE template = 'e3_update'")[0][0] == 1, (
        "nothing was sent, so nothing should have been chained"
    )
    assert mailer.fake.sent == []


def test_a_future_e2_is_not_sent_today(mailer):
    """The drip is enqueued at signup with future dates; the dispatcher must
    respect them or everyone gets three emails in one minute."""
    uid = make_user("tomorrow@example.test")
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO email_jobs (user_id, template, scheduled_at) "
            "VALUES (%s, 'e2_survey', now() + interval '1 day')",
            (uid,),
        )
    conn.close()

    counts = mailer.lambda_handler({}, None)

    assert counts["sent"] == 0
    assert mailer.fake.sent == []
