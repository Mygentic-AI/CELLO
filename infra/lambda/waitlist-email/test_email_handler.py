"""
Tests for the waitlist email dispatcher (DOD-EMAIL-INFRA-1, DOD-E1-1).

Real Postgres; SES is faked at the boundary only — the suppression and segment
rules are database behaviour, and the thing under test is which rows get picked
up and what happens to them, not AWS's wire format.
"""

import json
import os
from email import message_from_bytes, policy
import sys
import uuid
from pathlib import Path

import psycopg2
import pytest

from waitlist_testdb import PGURL, query, load_lambda


# The REAL parameter names boto3's SES accepts. Enumerated here because the fake
# accepting **kwargs is what let a nonexistent parameter ship: the handler passed
# `Headers=` to send_email, which has no such parameter, so every send raised
# ParamValidationError in production while every test passed.
#
# A fake at a boundary must be at least as strict as the thing it stands in for,
# or it is not a boundary — it is a hole shaped like one.
SEND_RAW_PARAMS = {
    "Source",
    "Destinations",
    "RawMessage",
    "FromArn",
    "SourceArn",
    "ReturnPathArn",
    "Tags",
    "ConfigurationSetName",
}


class FakeSES:
    """Records sends instead of performing them, and REFUSES anything the real
    API would refuse."""

    def __init__(self, fail_on=None):
        self.sent = []
        self.fail_on = fail_on or set()

    def send_raw_email(self, **kwargs):
        unknown = set(kwargs) - SEND_RAW_PARAMS
        if unknown:
            raise TypeError(
                f"Unknown parameter in input: {sorted(unknown)}, must be one of: "
                f"{sorted(SEND_RAW_PARAMS)}"
            )
        raw = kwargs["RawMessage"]["Data"]
        # policy=default, or message_from_bytes returns the LEGACY Message class
        # which has no get_content() and decodes nothing.
        parsed = message_from_bytes(
            raw if isinstance(raw, bytes) else raw.encode(), policy=policy.default
        )
        to = kwargs["Destinations"][0]
        if to in self.fail_on:
            raise RuntimeError(f"SES rejected {to}")
        # Kept in the shape the assertions already use, plus the parsed message
        # so tests can check headers and both body parts.
        self.sent.append(
            {
                "Destination": {"ToAddresses": kwargs["Destinations"]},
                "Source": kwargs["Source"],
                "ConfigurationSetName": kwargs.get("ConfigurationSetName"),
                "Message": parsed,
                "Subject": parsed["Subject"],
            }
        )
        return {"MessageId": str(uuid.uuid4())}

    def send_email(self, **kwargs):  # pragma: no cover - must never be called
        raise AssertionError(
            "send_email cannot carry List-Unsubscribe headers — use send_raw_email"
        )


@pytest.fixture()
def mailer(database, monkeypatch):
    os.environ["DATABASE_URL"] = PGURL
    os.environ["PGSSLMODE"] = "disable"
    # Required in production and therefore required here. Set on the fixture
    # rather than defaulted in the handler: a default would mean a real
    # deployment that forgot it still sends, emitting no bounce events and
    # silently disabling suppression.
    os.environ["WAITLIST_SES_CONFIG_SET"] = "cello-waitlist-test"
    mod = load_lambda(Path(__file__).parent, "email_handler")
    fake = FakeSES()
    monkeypatch.setattr(mod, "ses", lambda: fake)
    mod.fake = fake
    return mod


def text_part(sent):
    """The plain-text alternative out of the MIME message.

    Was `sent["Message"]["Body"]["Text"]["Data"]` when the handler passed
    subject and bodies to SES as separate fields. It now builds a MIME message,
    because custom headers — the RFC 8058 unsubscribe pair — cannot be set any
    other way through SES.
    """
    for part in sent["Message"].walk():
        if part.get_content_type() == "text/plain":
            return part.get_content()
    raise AssertionError("no text/plain part — every message must carry one")


def html_part(sent):
    for part in sent["Message"].walk():
        if part.get_content_type() == "text/html":
            return part.get_content()
    raise AssertionError("no text/html part")


def make_user(
    email,
    *,
    email_status="active",
    content_alerts=False,
    status="waiting",
    points=0,
    email_verified=True,
):
    """Verified by DEFAULT, because most of this file is about suppression and
    segments rather than about verification — and base-list mail now requires a
    confirmed address (DOD-INV-EMAIL-SEGMENTS). The unverified case has its own
    tests below rather than being the accidental state of every other one."""
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO waitlist_users
                (email, anon_id, email_status, content_alerts, status, points_total, email_verified)
            VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING waitlist_id
            """,
            (email, str(uuid.uuid4()), email_status, content_alerts, status, points, email_verified),
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


def test_e1_carries_the_verify_token_AND_NOTHING_THAT_PRESUMES_MEMBERSHIP(mailer):
    make_user("ahead@example.test", points=100)
    uid = make_user("e1@example.test", points=5)
    enqueue(uid)

    mailer.lambda_handler({}, None)

    body = text_part(mailer.fake.sent[0])

    token = query(
        "SELECT token, kind FROM auth_tokens WHERE waitlist_user_id = %s", (uid,)
    )[0]
    assert str(token[0]) in body, "the confirm link must carry the minted token"
    assert token[1] == "email_verify"

    # This email has ONE job. It used to announce a queue position and a
    # referral link to somebody who had not yet clicked — telling them they were
    # already on the list, and handing an unverified address a point-earning
    # credential. Both now live on the page the click lands on.
    # Targeted at the CLAIM, not the phrase: the copy legitimately says "you are
    # not on the list yet", which a substring check on "on the list" would flag.
    import re
    assert not re.search(r"#\d+", body), f"a queue position is claimed before the click:\n{body}"
    assert "/?ref=" not in body, "an unverified address must not be given a referral link"


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

    body = text_part(mailer.fake.sent[0])
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

    body = text_part(mailer.fake.sent[0])
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


def test_sending_without_a_configuration_set_refuses_instead_of_sending(mailer, monkeypatch):
    """SES only emits bounce and complaint events for mail sent WITH a
    configuration set. Send without one and every message still leaves, nothing
    errors, and deliverability looks fine — while no bounce ever reaches the SNS
    topic, so email_status is never set to bounced or complained and
    DOD-INV-EMAIL-SUPPRESS quietly stops being enforced. That failure is
    invisible for exactly as long as it takes to burn the sending domain."""
    uid = make_user("nocfg@example.test")
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO email_jobs (user_id, template, scheduled_at) "
            "VALUES (%s, 'e1_confirm', now())",
            (uid,),
        )
    conn.close()

    monkeypatch.setattr(mailer, "SES_CONFIG_SET", None)

    with pytest.raises(RuntimeError, match="WAITLIST_SES_CONFIG_SET"):
        mailer.lambda_handler({}, None)

    assert mailer.fake.sent == [], "nothing may go out without a configuration set"

    # And the refusal happens BEFORE the claim, so no row is stranded in
    # 'sending' waiting on the reclaim window for a fault unrelated to it.
    conn = psycopg2.connect(PGURL)
    with conn.cursor() as cur:
        cur.execute("SELECT status FROM email_jobs WHERE user_id = %s", (uid,))
        assert [r[0] for r in cur.fetchall()] == ["pending"]
    conn.close()


def test_every_send_carries_the_configuration_set(mailer):
    """The positive half: without this the guard above could be satisfied by a
    handler that checks the variable and then never passes it to SES."""
    uid = make_user("withcfg@example.test")
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO email_jobs (user_id, template, scheduled_at) "
            "VALUES (%s, 'e1_confirm', now())",
            (uid,),
        )
    conn.close()

    mailer.lambda_handler({}, None)

    assert len(mailer.fake.sent) == 1
    assert mailer.fake.sent[0]["ConfigurationSetName"] == "cello-waitlist-test"


# ── DOD-E-RE-1: the 60-day re-engagement sweep ────────────────────────────────


def age_user(uid, days):
    """Backdate created_at. now() - interval is used by the sweep, so the row has
    to be genuinely old rather than the clock moved."""
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE waitlist_users SET created_at = now() - make_interval(days => %s) "
            "WHERE waitlist_id = %s",
            (days, uid),
        )
    conn.close()


def verified(uid, value=True):
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE waitlist_users SET email_verified = %s WHERE waitlist_id = %s", (value, uid)
        )
    conn.close()


def dormant_user(email, *, age_days=61, **kw):
    uid = make_user(email, **kw)
    age_user(uid, age_days)
    verified(uid)
    return uid


def re_engage_jobs(uid=None):
    if uid:
        return query(
            "SELECT id FROM email_jobs WHERE template = 'e_re_engage' AND user_id = %s", (uid,)
        )
    return query("SELECT user_id FROM email_jobs WHERE template = 'e_re_engage'")


def sweep_re(mailer):
    return mailer.lambda_handler({"action": "sweep_re_engagement"}, None)


def test_a_dormant_waiting_user_is_enqueued_once(mailer):
    uid = dormant_user("dormant@example.test")

    assert sweep_re(mailer)["re_engage_enqueued"] == 1
    assert len(re_engage_jobs(uid)) == 1


def test_the_sweep_is_idempotent(mailer):
    """It runs daily. A second run must not queue a second copy — and unlike the
    nurture chain there is no 'did the last one send' to lean on, so the guard
    is the absence of any e_re_engage row for this user."""
    uid = dormant_user("twice@example.test")

    sweep_re(mailer)
    assert sweep_re(mailer)["re_engage_enqueued"] == 0
    assert len(re_engage_jobs(uid)) == 1


def test_a_recent_signup_is_not_swept(mailer):
    dormant_user("fresh@example.test", age_days=30)

    assert sweep_re(mailer)["re_engage_enqueued"] == 0


@pytest.mark.parametrize("status", ["admitted", "active", "left", "banned"])
def test_only_users_still_waiting_are_swept(mailer, status):
    """'We noticed you have not been back' sent to somebody who was admitted six
    weeks ago says plainly that nobody is watching."""
    dormant_user(f"{status}@example.test", status=status)

    assert sweep_re(mailer)["re_engage_enqueued"] == 0


@pytest.mark.parametrize("bad", ["unsubscribed", "bounced", "complained"])
def test_a_suppressed_address_is_never_swept(mailer, bad):
    dormant_user(f"supp-{bad}@example.test", email_status=bad)

    assert sweep_re(mailer)["re_engage_enqueued"] == 0


def test_an_unconfirmed_address_is_not_swept(mailer):
    """Never confirmed in 60 days is not dormancy — it is an address that may
    not be theirs, and DOD-E-RE-1's message assumes a real relationship."""
    uid = make_user("neverconfirmed@example.test")
    age_user(uid, 61)
    verified(uid, False)

    assert sweep_re(mailer)["re_engage_enqueued"] == 0


def test_recent_points_count_as_activity(mailer):
    """Earning points is the user acting. Mailing 'you have not been back' to
    somebody who filled in the survey last week is the failure this guard
    exists to prevent."""
    uid = dormant_user("earner@example.test")
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO points_ledger (waitlist_user_id, points, reason) VALUES (%s, 20, 'survey')",
            (uid,),
        )
    conn.close()

    assert sweep_re(mailer)["re_engage_enqueued"] == 0


def test_a_page_view_does_not_protect_and_that_is_a_known_gap(mailer):
    """Documents the gap rather than pretending it is covered.

    An earlier version of the sweep also checked waitlist_touchpoints and its
    docstring claimed that covered "arrived on the site". It did not: the only
    writer of that table is the signup handler, inserting the pre-signup
    localStorage trail once. For anyone older than sixty days every row predates
    the thirty-day window, so the clause could never fire — a guard that read as
    protective and stopped anyone looking for the real one.

    So this asserts the CURRENT truth: a touchpoint does not protect. When a
    post-signup pageview writer exists, this test is the one that should flip.
    """
    uid = dormant_user("viewer@example.test")
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO waitlist_touchpoints (waitlist_user_id, anon_id, url) "
            "SELECT waitlist_id, anon_id, 'https://cello.mygentic.ai/' FROM waitlist_users "
            "WHERE waitlist_id = %s",
            (uid,),
        )
    conn.close()

    assert sweep_re(mailer)["re_engage_enqueued"] == 1, (
        "a page view does not currently protect anyone — if this starts failing, "
        "a pageview writer was added and the sweep should consider it"
    )


def test_a_recent_sign_in_counts_as_activity(mailer):
    uid = dormant_user("signedin@example.test")
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO waitlist_sessions (waitlist_user_id, token_hash, expires_at) "
            "VALUES (%s, %s, now() + interval '30 days')",
            (uid, "s" * 64),
        )
    conn.close()

    assert sweep_re(mailer)["re_engage_enqueued"] == 0


def test_activity_older_than_the_quiet_window_does_not_protect(mailer):
    """The window is 30 days, not 'ever'. Activity from four months ago is
    exactly the case this email is for."""
    uid = dormant_user("longago@example.test")
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO points_ledger (waitlist_user_id, points, reason, created_at) "
            "VALUES (%s, 20, 'survey', now() - interval '120 days')",
            (uid,),
        )
    conn.close()

    assert sweep_re(mailer)["re_engage_enqueued"] == 1


def test_another_users_activity_does_not_protect_this_one(mailer):
    """The NOT EXISTS subqueries must correlate on waitlist_user_id. Without the
    correlation every one of them is satisfied by any row in the table, and the
    sweep silently enqueues nobody, forever."""
    quiet = dormant_user("quiet@example.test")
    busy = dormant_user("busy@example.test")
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO points_ledger (waitlist_user_id, points, reason) VALUES (%s, 20, 'survey')",
            (busy,),
        )
    conn.close()

    assert sweep_re(mailer)["re_engage_enqueued"] == 1
    assert len(re_engage_jobs(quiet)) == 1
    assert len(re_engage_jobs(busy)) == 0


def test_the_sweep_does_not_drain_the_queue(mailer):
    """Two different jobs on two different schedules. A sweep that also sent
    would make a daily rule send mail, and a per-minute rule sweep."""
    dormant_user("sweeponly@example.test")

    result = sweep_re(mailer)

    assert "sent" not in result
    assert mailer.fake.sent == []


def test_activity_just_inside_the_quiet_window_still_protects(mailer):
    """Pins the NEAR side of the 30-day boundary.

    The far side was already covered (activity 120 days ago does not protect),
    which left the window free to collapse: setting it to 1 day kept every test
    green while the sweep mailed people who were on the site yesterday.
    """
    uid = dormant_user("recent@example.test")
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO points_ledger (waitlist_user_id, points, reason, created_at) "
            "VALUES (%s, 20, 'survey', now() - interval '29 days')",
            (uid,),
        )
    conn.close()

    assert sweep_re(mailer)["re_engage_enqueued"] == 0, (
        "activity 29 days ago is inside the 30-day quiet window and must protect"
    )


def test_a_user_just_under_sixty_days_old_is_not_swept(mailer):
    """Pins the NEAR side of the 60-day boundary.

    The only age test used 30 days, so any threshold in (30, 61] stayed green —
    the DoD's "60 days" was unpinned and could have silently become 31.
    """
    dormant_user("young@example.test", age_days=59)

    assert sweep_re(mailer)["re_engage_enqueued"] == 0


def test_the_sweep_is_bounded_so_a_backfill_cannot_starve_confirmations(mailer, monkeypatch):
    """Every enqueued row gets scheduled_at = now(), and claim_jobs orders by
    scheduled_at — so an unbounded first run puts the entire dormant backlog
    AHEAD of every confirmation email enqueued afterwards."""
    for i in range(5):
        dormant_user(f"backlog{i}@example.test")
    monkeypatch.setattr(mailer, "RE_ENGAGE_BATCH", 2)

    assert sweep_re(mailer)["re_engage_enqueued"] == 2, "the batch bound must apply"

    # And it self-drains, because the sweep is daily and idempotent.
    assert sweep_re(mailer)["re_engage_enqueued"] == 2
    assert sweep_re(mailer)["re_engage_enqueued"] == 1
    assert sweep_re(mailer)["re_engage_enqueued"] == 0


# ── DOD-INV-EMAIL-SEGMENTS: the base list is VERIFIED signups ─────────────────


@pytest.mark.parametrize("template", ["e2_survey", "e3_update", "e_re_engage"])
def test_base_list_mail_waits_for_a_confirmed_address(mailer, template):
    """The invariant says the base list is "all VERIFIED signups", and nothing
    enforced it. e2_survey and e3_update are enqueued AT SIGNUP — before
    verification, by construction — so every unconfirmed address received the
    survey nudge a day later and an update two weeks after that, from a list it
    was never on."""
    uid = make_user(f"unconfirmed-{template}@example.test", email_verified=False)
    enqueue(uid, template)

    counts = mailer.lambda_handler({}, None)

    assert mailer.fake.sent == []
    assert counts["skipped"] == 1


def test_the_skip_is_reversible_so_confirming_late_still_delivers(mailer):
    """NOT terminal. Confirming is exactly what makes these sendable, and
    retiring the job would mean somebody who confirms on day three never
    receives the survey they were meant to get on day two."""
    uid = make_user("late@example.test", email_verified=False)
    jid = enqueue(uid, "e2_survey")

    mailer.lambda_handler({}, None)
    assert job_status(jid) == "pending", "a reversible skip returns to pending"

    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute("UPDATE waitlist_users SET email_verified = true WHERE waitlist_id = %s", (uid,))
    conn.close()

    mailer.lambda_handler({}, None)
    assert [m["Destination"]["ToAddresses"][0] for m in mailer.fake.sent] == ["late@example.test"]


def test_e1_is_not_gated_because_it_IS_the_confirmation(mailer):
    """Gate this and the account is unrecoverable — a check that locks the door
    it is guarding."""
    uid = make_user("needs-confirm@example.test", email_verified=False)
    enqueue(uid, "e1_confirm")

    mailer.lambda_handler({}, None)

    assert len(mailer.fake.sent) == 1


@pytest.mark.parametrize("template", ["e1_confirm", "e_magic_link"])
def test_the_exception_list_is_exactly_the_two_that_enable_verification(mailer, template):
    """Asserted on the predicate rather than through a send, because
    e_magic_link also needs a live token row and that machinery is not what is
    under test here. What matters is that the gate lets these two past an
    unverified address — and only these two."""
    job = {
        "template": template,
        "email_status": "active",
        "content_alerts": False,
        "email_verified": False,
    }

    send, reason, terminal = mailer.should_send(job)

    assert send is True, f"{template} must reach an unverified address"
    assert reason is None

    # And the inverse, so the list cannot quietly grow.
    gated = dict(job, template="e2_survey")
    assert mailer.should_send(gated) == (False, "email_not_verified", False)


def test_a_reversible_skip_does_not_spend_the_retry_budget(mailer):
    """THE test the previous one stopped one tick short of.

    `claim_jobs` refuses anything at attempts >= MAX_ATTEMPTS and the drain runs
    every minute, so a skip that returns the job to 'pending' WITHOUT resetting
    attempts burns all five in five minutes and the job becomes permanently
    unclaimable — while sitting in status 'pending', which reads as healthy.

    The earlier version of this test flipped the flag after ONE tick, so it
    proved reversibility at attempt 1 and asserted it for "day three", which is
    4,320 ticks. This one runs past the cap first.
    """
    uid = make_user("dayThree@example.test", email_verified=False)
    jid = enqueue(uid, "e2_survey")

    for _ in range(mailer.MAX_ATTEMPTS + 3):
        mailer.lambda_handler({}, None)

    assert mailer.fake.sent == []
    attempts = query("SELECT attempts FROM email_jobs WHERE id = %s", (jid,))[0][0]
    assert attempts < mailer.MAX_ATTEMPTS, (
        f"a reversible skip must not consume the retry budget; attempts={attempts} "
        f"means the job can never be claimed again"
    )

    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute("UPDATE waitlist_users SET email_verified = true WHERE waitlist_id = %s", (uid,))
    conn.close()

    mailer.lambda_handler({}, None)

    assert [m["Destination"]["ToAddresses"][0] for m in mailer.fake.sent] == ["dayThree@example.test"]


def test_a_permanent_failure_still_exhausts_its_retries(mailer):
    """The inverse, so the reset cannot be widened into 'never give up'. A job
    that genuinely fails must still retire rather than retrying forever."""
    uid = make_user("broken@example.test")
    jid = enqueue(uid)
    mailer.fake.fail_on = {"broken@example.test"}

    for _ in range(mailer.MAX_ATTEMPTS + 2):
        mailer.lambda_handler({}, None)

    assert job_status(jid) in ("failed", "retired"), (
        "a real failure must still exhaust its budget and retire"
    )


def test_every_message_carries_both_parts_and_the_unsubscribe_headers(mailer):
    """The regression for a defect no unit test could see.

    The handler passed `Headers=` to SES send_email, which has no such
    parameter, so ParamValidationError was raised on EVERY send and not one
    email could leave. The fake took **kwargs and recorded whatever it was
    given, so a parameter that does not exist looked exactly like one that does.
    It took a real SES call to find.

    The fake now refuses unknown parameters, and this asserts the message is
    actually well-formed: both alternatives present, and the RFC 8058 pair on
    the message rather than passed beside it.
    """
    uid = make_user("mime@example.test")
    enqueue(uid, "e1_confirm")

    mailer.lambda_handler({}, None)

    sent = mailer.fake.sent[0]
    assert text_part(sent), "a text alternative is required — HTML-only is a deliverability penalty"
    assert "<" in html_part(sent)
    assert sent["Message"]["Subject"]
    assert sent["Message"]["List-Unsubscribe"], "RFC 8058 header must be ON the message"
    assert sent["Message"]["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"


def test_the_fake_refuses_a_parameter_the_real_api_would_refuse(mailer):
    """Guards the guard. If the fake goes back to accepting anything, the defect
    above becomes invisible again."""
    with pytest.raises(TypeError, match="Unknown parameter"):
        mailer.fake.send_raw_email(
            Source="a@b.test",
            Destinations=["c@d.test"],
            RawMessage={"Data": b"x"},
            Headers=[{"Name": "X", "Value": "y"}],
        )
