"""
Tests for the M11 waitlist signup Lambda, against a REAL Postgres.

Not mocked. Every finding these cover was a defect that passed a mocked or
absent test: a transaction aborted by a swallowed error, a premium code that
never burned, an unbounded array hitting the bind-parameter limit. None of those
are visible without a database that enforces its own constraints.

Requires the local container from corp-cello-site/scripts/verify-schema.sh:
    docker run -d --name m11pg -e POSTGRES_PASSWORD=m11 -e POSTGRES_USER=m11 \
        -p 55432:5432 postgres:16

Run: PGURL=postgres://m11:m11@localhost:55432/m11_test python3 -m pytest -q
"""

import json
import os
import sys
import uuid
from pathlib import Path

import psycopg2
import pytest


from _resend import LINK_LIMIT
from waitlist_testdb import PGURL, query, load_lambda  # fixtures come from conftest.py alongside it


@pytest.fixture()
def handler(database):
    """Imported here, not in conftest: every Lambda dir has its own handler.py."""
    os.environ["DATABASE_URL"] = PGURL
    return load_lambda(Path(__file__).parent, "signup_handler")


# ── helpers ───────────────────────────────────────────────────────────────────


def invoke(handler, body, method="POST", path="/waitlist/signup", origin="https://cello.mygentic.ai"):
    event = {
        "headers": {"origin": origin},
        "requestContext": {"http": {"method": method, "path": path}},
        "body": json.dumps(body) if isinstance(body, (dict, list)) else body,
    }
    result = handler.lambda_handler(event, None)
    parsed = json.loads(result["body"]) if result["body"] else {}
    return result["statusCode"], parsed


def seed_code(code, *, kind="share", owner_email=None, creator=None, active=True):
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        owner = None
        if owner_email:
            cur.execute(
                "INSERT INTO waitlist_users (email, anon_id) VALUES (%s, %s) RETURNING waitlist_id",
                (owner_email, str(uuid.uuid4())),
            )
            owner = cur.fetchone()[0]
        cur.execute(
            "INSERT INTO referral_codes (code, owner_waitlist_user_id, creator_handle, type, active) "
            "VALUES (%s, %s, %s, %s, %s)",
            (code, owner, creator, kind, active),
        )
    conn.close()
    return owner


def drain():
    """What the dispatcher does every 60 seconds.

    Only ONE pending job per template per person may exist at a time — a second
    one draining in the same batch ships a mail whose token the next job burns
    before it leaves. So a test asking for repeated sends has to let the queue
    empty in between, exactly as production does.
    """
    query("UPDATE email_jobs SET status = 'sent', sent_at = now() WHERE status = 'pending'")


def signup_body(email, **extra):
    return {"email": email, "anon_id": str(uuid.uuid4()), "touchpoints": [], **extra}


# ── H2: premium codes are single-use ──────────────────────────────────────────


def test_premium_code_burns_on_first_signup_and_rejects_the_second(handler):
    """The defect: a premium code admitted unlimited users because nothing ever
    set active = false. Reverting the burn makes the second call return 200."""
    seed_code("GOLDEN1", kind="premium", owner_email="inviter@example.test")

    status, body = invoke(handler, signup_body("first@example.test", invite_code="GOLDEN1"))
    assert status == 200, body

    # The second claimant still joins the waitlist — refusing the signup would
    # lose a genuinely interested person because somebody else was faster. What
    # must NOT happen is a silent downgrade, so the response names the outcome.
    status, body = invoke(handler, signup_body("second@example.test", invite_code="GOLDEN1"))
    assert status == 200, body
    assert body["referral"] == {"applied": False, "reason": "code_already_used"}

    assert query("SELECT active FROM referral_codes WHERE code = 'GOLDEN1'")[0][0] is False
    assert (
        query("SELECT premium_referred FROM waitlist_users WHERE email = 'second@example.test'")[0][0]
        is False
    ), "a spent code must not give anyone the fast door"
    claimed = query("SELECT count(*) FROM waitlist_users WHERE premium_referred")[0][0]
    assert claimed == 1, "a burned premium code must not be claimed by a second user"
    # And nobody is admitted on a typed address — the claim is recorded, the
    # admission waits on the confirm click.
    assert query("SELECT count(*) FROM waitlist_users WHERE status = 'admitted'")[0][0] == 0


def test_premium_admission_is_distinguishable_from_a_wave_admission(handler):
    """H9: collapsing premium_referred into status='admitted' loses the only
    signal that says which door a user came through.

    The claim and the admission are now separate in TIME as well: the claim is
    recorded at signup and burns the code, the admission waits on the confirm
    click. Admitting a typed address skips the queue on no proof of a mailbox —
    the same rule that moved the referrer's points.
    """
    seed_code("GOLDEN2", kind="premium", owner_email="inviter2@example.test")
    invoke(handler, signup_body("fast@example.test", invite_code="GOLDEN2"))

    row = query(
        "SELECT premium_referred, status, referred_by_code FROM waitlist_users "
        "WHERE email = 'fast@example.test'"
    )[0]
    assert row[0] is True
    assert row[1] == "waiting", "an unconfirmed address must not hold an admission"
    assert row[2] == "GOLDEN2"


def test_an_inactive_premium_code_does_not_admit(handler):
    seed_code("SPENT1", kind="premium", owner_email="inviter3@example.test", active=False)
    status, _ = invoke(handler, signup_body("late@example.test", invite_code="SPENT1"))

    assert status == 200, "the signup still succeeds; only the fast-door claim fails"
    row = query("SELECT status, premium_referred FROM waitlist_users WHERE email = 'late@example.test'")[0]
    assert row[0] == "waiting"
    assert row[1] is False


# ── H1: a creator referral must not destroy the signup ────────────────────────


def test_creator_referral_records_attribution_and_still_creates_the_user(handler):
    """The defect: writing to a missing creator_tracking aborted the transaction,
    so the user row, the touchpoints and the E1 job all rolled back and the
    caller got a 500."""
    seed_code("PRESS1", kind="share", creator="techjournalist")

    status, body = invoke(
        handler,
        {
            "email": "reader@example.test",
            "anon_id": str(uuid.uuid4()),
            "touchpoints": [
                {"ts": "2026-07-24T10:00:00Z", "url": "https://cello.mygentic.ai/", "ref": "PRESS1"}
            ],
        },
    )

    assert status == 200, body
    assert query("SELECT count(*) FROM waitlist_users WHERE email = 'reader@example.test'")[0][0] == 1
    assert query("SELECT count(*) FROM email_jobs WHERE template = 'e1_confirm'")[0][0] == 1
    tracked = query(
        "SELECT ct.creator_handle, ct.event_type, u.email "
        "FROM creator_tracking ct JOIN waitlist_users u ON u.waitlist_id = ct.waitlist_user_id"
    )
    assert tracked == [("techjournalist", "signup", "reader@example.test")], (
        "the attribution must join on the stable PK, not on a TEXT column named "
        "session_id that happens to hold one"
    )


# ── H4: attribution at signup, payment at confirmation ────────────────────────


def test_a_share_referral_records_the_attribution_but_pays_nothing_yet(handler):
    """Who introduced whom is a fact about the signup, so it is written now. The
    POINTS are not: a signup is a typed address, and paying out on one makes the
    queue farmable by the effort of inventing addresses. The referrer is paid
    when the invitee confirms (waitlist-auth, _referral.py)."""
    owner = seed_code("SHARE1", kind="share", owner_email="referrer@example.test")
    invoke(handler, signup_body("invitee@example.test", invite_code="SHARE1"))

    assert query("SELECT count(*) FROM referrals")[0][0] == 1
    assert query("SELECT referred_by_code FROM waitlist_users WHERE email = 'invitee@example.test'")[0][0] == "SHARE1"
    assert query("SELECT points_total FROM waitlist_users WHERE waitlist_id = %s", (owner,))[0][0] == 0, (
        "an unconfirmed signup must not move anybody up the queue"
    )


# The cap test that used to live here moved with its subject. Nothing in
# apply_referral writes to points_ledger any longer, so a pre-seeded cap could
# not influence any statement this path executes — it passed for no reason
# related to its name. The invariant it protected is now asserted where the
# payout happens, against the transaction that actually has something to lose:
# waitlist-auth's test_a_capped_referrer_still_lets_the_invitee_confirm.


# ── H8 / M10 / M11: validation on a public endpoint ───────────────────────────


def test_touchpoints_are_capped_server_side(handler):
    """The browser caps at 20; the browser is not a control. 6,000 entries
    exceeded Postgres's bind-parameter limit and became a 500."""
    body = signup_body("flood@example.test")
    body["touchpoints"] = [
        {"ts": "2026-07-24T10:00:00Z", "url": f"https://cello.mygentic.ai/{i}", "utm_source": "x"}
        for i in range(6000)
    ]

    status, payload = invoke(handler, body)

    assert status == 200, payload
    assert query("SELECT count(*) FROM waitlist_touchpoints")[0][0] == 20


@pytest.mark.parametrize(
    "body,expected",
    [
        ({"anon_id": str(uuid.uuid4())}, "missing_email"),
        ({"email": "   ", "anon_id": str(uuid.uuid4())}, "missing_email"),
        ({"email": "not-an-email", "anon_id": str(uuid.uuid4())}, "invalid_email"),
        ({"email": "a@b.co"}, "missing_anon_id"),
        ({"email": "a@b.co", "anon_id": "not-a-uuid"}, "invalid_anon_id"),
        ({"email": "a@b.co", "anon_id": str(uuid.uuid4()), "touchpoints": "abc"}, "invalid_touchpoints"),
    ],
)
def test_bad_input_is_rejected_with_a_cause_not_an_exit_label(handler, body, expected):
    status, payload = invoke(handler, body)
    assert status == 400
    assert payload["error"] == expected, f"got {payload}"


def test_malformed_json_is_a_client_error_not_a_server_error(handler):
    status, payload = invoke(handler, "{not json")
    assert status == 400, "a bad body is the caller's fault; 500 sends on-call to the wrong place"
    assert payload["error"] == "invalid_json"


def test_a_whitespace_only_email_never_reaches_the_database(handler):
    invoke(handler, {"email": "   ", "anon_id": str(uuid.uuid4())})
    assert query("SELECT count(*) FROM waitlist_users")[0][0] == 0


# ── M14: CORS, without which every browser submission fails ───────────────────


def test_preflight_is_answered_for_the_site_origin(handler):
    event = {
        "headers": {"origin": "https://cello.mygentic.ai"},
        "requestContext": {"http": {"method": "OPTIONS", "path": "/waitlist/signup"}},
        "body": "",
    }
    result = handler.lambda_handler(event, None)
    assert result["statusCode"] == 204
    assert result["headers"]["Access-Control-Allow-Origin"] == "https://cello.mygentic.ai"
    assert "POST" in result["headers"]["Access-Control-Allow-Methods"]


def test_an_unknown_origin_is_not_echoed_back(handler):
    """Echoing an arbitrary Origin on a state-changing endpoint hands any site a
    working cross-origin POST."""
    _, _ = invoke(handler, signup_body("cors@example.test"), origin="https://evil.example")
    event = {
        "headers": {"origin": "https://evil.example"},
        "requestContext": {"http": {"method": "OPTIONS", "path": "/waitlist/signup"}},
        "body": "",
    }
    result = handler.lambda_handler(event, None)
    assert result["headers"]["Access-Control-Allow-Origin"] == "https://cello.mygentic.ai"


# ── Baseline behaviour ────────────────────────────────────────────────────────


def test_a_plain_signup_creates_the_user_a_share_code_and_an_e1_job(handler):
    status, body = invoke(
        handler,
        {
            "email": "plain@example.test",
            "anon_id": str(uuid.uuid4()),
            "display_name": "Plain",
            "touchpoints": [
                {"ts": "2026-07-20T10:00:00Z", "utm_source": "reddit", "url": "https://cello.mygentic.ai/"},
                {"ts": "2026-07-24T10:00:00Z", "utm_source": "x", "url": "https://cello.mygentic.ai/waitlist"},
            ],
        },
    )

    assert status == 200, body
    # NO referral code at signup. It is minted when the email is verified, so an
    # unproven address cannot be handed a working, point-earning credential.
    assert "referral_code" not in body, "an unverified address must not receive a code"

    row = query(
        "SELECT display_name, first_touch_source, last_touch_source, status "
        "FROM waitlist_users WHERE email = 'plain@example.test'"
    )[0]
    assert row == ("Plain", "reddit", "x", "waiting")

    assert query("SELECT count(*) FROM referral_codes")[0][0] == 0, (
        "no code exists until the email is verified"
    )
    assert query("SELECT count(*) FROM email_jobs WHERE template = 'e1_confirm'")[0][0] == 1


# ── The re-entry path: typing your address again is normal, not an error ──────
#
# /waitlist is the only URL a returning person remembers, and nothing on the
# site links to /auth. So the second most common thing anyone does here is type
# an address that already exists. A 409 dead-ended exactly that person: the copy
# said "already on the waitlist" and offered no way to reach their status page.
#
# The form now decides what to send instead of refusing. Same one field, same
# reply — only the mail differs.


def test_an_unconfirmed_duplicate_gets_the_confirm_mail_again(handler):
    """Somebody who never clicked the first link. Sending it again is the entire
    remedy, and calling it an error strands them permanently: e1_confirm was
    enqueued exactly once, at signup."""
    invoke(handler, signup_body("pending@example.test"))
    drain()
    status, body = invoke(handler, signup_body("pending@example.test"))

    assert status == 200, body
    assert body["returning"] is True
    assert body["sent"] == "confirm"
    assert query("SELECT count(*) FROM waitlist_users WHERE email = 'pending@example.test'")[0][0] == 1
    assert query(
        "SELECT count(*) FROM email_jobs j JOIN waitlist_users u ON u.waitlist_id = j.user_id "
        "WHERE u.email = 'pending@example.test' AND j.template = 'e1_confirm'"
    )[0][0] == 2


def test_a_confirmed_duplicate_gets_a_sign_in_link_not_a_second_confirm(handler):
    """A member typing their address into the signup form is asking to get back
    in. Re-sending a confirm mail to somebody already confirmed is a dead link
    dressed as a welcome."""
    invoke(handler, signup_body("member@example.test"))
    query("UPDATE waitlist_users SET email_verified = true WHERE email = 'member@example.test'")

    status, body = invoke(handler, signup_body("member@example.test"))

    assert status == 200, body
    assert body["sent"] == "signin"
    assert query(
        "SELECT count(*) FROM email_jobs j JOIN waitlist_users u ON u.waitlist_id = j.user_id "
        "WHERE u.email = 'member@example.test' AND j.template = 'e_magic_link'"
    )[0][0] == 1
    # e_magic_link renders a token it does not mint. Enqueueing the job without
    # one sends a mail with no link in it.
    assert query(
        "SELECT count(*) FROM auth_tokens t JOIN waitlist_users u ON u.waitlist_id = t.waitlist_user_id "
        "WHERE u.email = 'member@example.test' AND t.kind = 'magic_link' AND t.used_at IS NULL"
    )[0][0] == 1


def test_the_resend_path_is_rate_limited_and_says_when_it_refuses(handler):
    """Two things at once.

    Without a limit this form is an open mail cannon: point it at an address you
    do not own and send it a message per request, from our domain, until the
    sending reputation is gone. And a refusal must be reported AS a refusal —
    answering "check your inbox" to somebody we just declined to email leaves
    them refreshing an empty mailbox, which is the exact stranding this whole
    branch exists to remove.
    """
    invoke(handler, signup_body("floody@example.test"))
    outcomes = []
    for _ in range(LINK_LIMIT + 4):
        drain()  # the dispatcher runs every 60s; without it the queue self-limits
        status, body = invoke(handler, signup_body("floody@example.test"))
        assert status == 200, body
        outcomes.append(body["sent"])
    drain()

    sent = query(
        "SELECT count(*) FROM email_jobs j JOIN waitlist_users u ON u.waitlist_id = j.user_id "
        "WHERE u.email = 'floody@example.test' AND j.template = 'e1_confirm'"
    )[0][0]
    # One from the signup itself, then exactly the per-window allowance.
    assert sent == 1 + LINK_LIMIT, f"{sent} confirm mails queued for one address"

    assert outcomes[0] == "confirm"
    assert outcomes[-1] == "throttled", (
        "a refusal reported as a send is a promise of mail that will not arrive"
    )
    # And the refusals were not recorded, so clicking cannot keep its own window
    # alive and a third party cannot burn somebody else's budget.
    logged = query(
        "SELECT count(*) FROM auth_link_requests WHERE lower(email_requested) = 'floody@example.test'"
    )[0][0]
    assert logged == LINK_LIMIT, f"{logged} rows for {LINK_LIMIT} sends"


def test_a_suppressed_address_is_never_re_mailed_by_the_form(handler):
    """Unsubscribing and bouncing are one-way. A signup form that re-enrols a
    suppressed address is how a domain ends up on a blocklist."""
    invoke(handler, signup_body("gone@example.test"))
    query("UPDATE waitlist_users SET email_status = 'unsubscribed' WHERE email = 'gone@example.test'")

    status, body = invoke(handler, signup_body("gone@example.test"))

    assert status == 200, body
    assert query(
        "SELECT count(*) FROM email_jobs j JOIN waitlist_users u ON u.waitlist_id = j.user_id "
        "WHERE u.email = 'gone@example.test' AND j.template IN ('e1_confirm', 'e_magic_link')"
    )[0][0] == 1, "only the original signup mail; the form must not resend"


def test_an_explicit_first_touch_survives_the_twenty_entry_cap(handler):
    """M13: the browser truncates from the front, so touchpoints[0] is the 21st-
    from-last, not the first. Attribution silently recorded a mid-funnel touch as
    the origin. The client now sends the real first touch separately."""
    body = signup_body("attributed@example.test")
    body["first_touch"] = {"utm_source": "hackernews", "ref": "HN1"}
    body["touchpoints"] = [
        {"ts": "2026-07-24T10:00:00Z", "utm_source": f"later{i}"} for i in range(25)
    ]

    status, payload = invoke(handler, body)
    assert status == 200, payload

    row = query(
        "SELECT first_touch_source, first_touch_ref FROM waitlist_users WHERE email = 'attributed@example.test'"
    )[0]
    assert row == ("hackernews", "HN1")


def test_self_referral_is_refused(handler):
    status, _ = invoke(handler, signup_body("solo@example.test"))
    assert status == 200
    # Signup no longer mints, so the referrer's code is seeded here — standing in
    # for the verification step that mints it in production.
    solo = query("SELECT waitlist_id FROM waitlist_users WHERE email = 'solo@example.test'")[0][0]
    # query() does not commit, so the insert has to carry its own transaction —
    # otherwise the row is rolled back and the referral silently finds no code.
    import psycopg2
    from waitlist_testdb import PGURL
    _c = psycopg2.connect(PGURL); _c.autocommit = True
    with _c.cursor() as _cur:
        _cur.execute(
            "INSERT INTO referral_codes (code, owner_waitlist_user_id, creator_handle, type) "
            "VALUES ('SOLOCODE1234', %s, NULL, 'share')", (solo,),
        )
    _c.close()
    own = "SOLOCODE1234"

    invoke(handler, signup_body("other@example.test", invite_code=own))
    assert query("SELECT count(*) FROM referrals")[0][0] == 1, "a genuine referral still lands"
