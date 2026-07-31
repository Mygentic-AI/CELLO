"""
Tests for the Telegram admission gate (DOD-TELEGRAM-GATE-1, DOD-INV-TOKEN-SINGLE-USE).

The burn is the security boundary of the whole waitlist: it is where an
admission becomes network access, and access that has been granted to a DKG
cannot be withdrawn. So the concurrency test is not optional here — a
read-then-write would pass every sequential test in this file.
"""

import json
import threading
import uuid
from pathlib import Path

import psycopg2
import pytest

from waitlist_testdb import PGURL, query, load_lambda


@pytest.fixture()
def gate(database):
    return load_lambda(Path(__file__).parent, "gate_handler")


def make_admitted_user(email="admitted@example.test", *, expires="14 days", used=False):
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO waitlist_users (email, anon_id, status) VALUES (%s, %s, 'admitted') "
            "RETURNING waitlist_id",
            (email, str(uuid.uuid4())),
        )
        uid = cur.fetchone()[0]
        cur.execute(
            f"INSERT INTO waitlist_tokens (waitlist_user_id, expires_at, used_at) "
            f"VALUES (%s, now() + interval '{expires}', %s) RETURNING token",
            (uid, "now()" if used else None),
        )
        token = cur.fetchone()[0]
        if used:
            cur.execute("UPDATE waitlist_tokens SET used_at = now() WHERE token = %s", (token,))
    conn.close()
    return uid, str(token)


def call(gate, **body):
    result = gate.lambda_handler({"telegram_id": "tg-1", **body}, None)
    return result["statusCode"], json.loads(result["body"])


# ── The gate order (M11 §4) ───────────────────────────────────────────────────


def test_an_unknown_account_with_no_token_is_refused_and_told_what_is_missing(gate):
    status, body = call(gate)

    assert status == 200
    assert body["allowed"] is False
    assert body["error"] == "token_required"
    assert "access token" in body["message"].lower()


def test_a_valid_token_burns_and_links_everything(gate):
    uid, token = make_admitted_user()

    status, body = call(gate, token=token, agent_pubkey="pk-abc")

    assert body["allowed"] is True
    assert body["reason"] == "token_burned"
    assert query("SELECT used_at IS NOT NULL FROM waitlist_tokens")[0][0] is True
    assert query("SELECT source FROM telegram_accounts WHERE telegram_id = 'tg-1'")[0][0] == "waitlist_token"
    assert query("SELECT waitlist_user_id FROM waitlist_agent_links WHERE agent_pubkey = 'pk-abc'")[0][0] == uid


def test_a_known_account_proceeds_without_a_token(gate):
    uid, token = make_admitted_user()
    call(gate, token=token)

    status, body = call(gate)

    assert body["allowed"] is True
    assert body["reason"] == "already_linked"


def test_a_staff_override_proceeds_with_no_waitlist_user(gate):
    """M11-D5: one lookup for both token holders and staff. This is how Andre
    gets in without a token."""
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO telegram_accounts (telegram_id, source) VALUES ('tg-1', 'ops_override')"
        )
    conn.close()

    _, body = call(gate)

    assert body["allowed"] is True
    assert body["source"] == "ops_override"


# ── DOD-INV-TOKEN-SINGLE-USE ──────────────────────────────────────────────────


def test_a_second_burn_of_the_same_token_is_refused(gate):
    _, token = make_admitted_user()
    call(gate, token=token)

    result = gate.lambda_handler({"telegram_id": "tg-2", "token": token}, None)
    body = json.loads(result["body"])

    assert body["allowed"] is False
    assert body["error"] == "token_already_used"
    assert query("SELECT count(*) FROM telegram_accounts")[0][0] == 1, (
        "the second account must not be linked"
    )


def test_two_simultaneous_burns_of_one_token_admit_exactly_one(gate):
    """The read-then-write version of this passes every sequential test above.

    A waitlist token grants network access, and access a DKG has already used
    cannot be withdrawn — so 'usually single use' is not a category that exists
    here.
    """
    _, token = make_admitted_user()
    barrier = threading.Barrier(2)
    results = {}

    def attempt(name, telegram_id):
        def inner():
            mod = load_lambda(Path(__file__).parent, f"gate_{name}")
            barrier.wait()
            results[name] = json.loads(
                mod.lambda_handler({"telegram_id": telegram_id, "token": token}, None)["body"]
            )

        return inner

    threads = [
        threading.Thread(target=attempt("a", "tg-a")),
        threading.Thread(target=attempt("b", "tg-b")),
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=30)

    allowed = [r for r in results.values() if r.get("allowed")]
    assert len(allowed) == 1, f"exactly one may win, got {results}"
    assert query("SELECT count(*) FROM telegram_accounts")[0][0] == 1
    assert query("SELECT count(*) FROM waitlist_tokens WHERE used_at IS NOT NULL")[0][0] == 1


def test_nothing_can_un_burn_a_token(gate):
    """DOD-INV-TOKEN-SINGLE-USE: no mechanism exists to un-burn."""
    _, token = make_admitted_user()
    call(gate, token=token)

    for _ in range(3):
        gate.lambda_handler({"telegram_id": "tg-x", "token": token}, None)

    assert query("SELECT used_at IS NOT NULL FROM waitlist_tokens")[0][0] is True


# ── Named refusals ────────────────────────────────────────────────────────────


def test_an_expired_token_says_expired_not_invalid(gate):
    """Each cause implies a different next step for the person holding it —
    wait, re-check the email, or ask for help."""
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO waitlist_users (email, anon_id, status) VALUES ('exp@example.test', %s, 'admitted') "
            "RETURNING waitlist_id",
            (str(uuid.uuid4()),),
        )
        uid = cur.fetchone()[0]
        cur.execute(
            "INSERT INTO waitlist_tokens (waitlist_user_id, created_at, expires_at) "
            "VALUES (%s, now() - interval '20 days', now() - interval '6 days') RETURNING token",
            (uid,),
        )
        token = str(cur.fetchone()[0])
    conn.close()

    _, body = call(gate, token=token)

    assert body["error"] == "token_expired"
    assert "14 days" in body["message"]


def test_an_unknown_token_says_unrecognised(gate):
    _, body = call(gate, token=str(uuid.uuid4()))
    assert body["error"] == "token_not_found"


def test_a_malformed_token_is_refused_before_the_database(gate):
    """Postgres would reject 'CELLO-abc' as a bad uuid, and that reaches the
    operator as a database error rather than 'check the code'."""
    _, body = call(gate, token="CELLO-not-a-uuid")

    assert body["error"] == "token_malformed"
    assert "token" in body["message"].lower()


def test_a_refusal_is_a_200_not_an_http_error(gate):
    """The caller is the ops agent. A 4xx lands in its error path and surfaces
    as 'the gate is broken' rather than 'your token has expired'."""
    status, body = call(gate)

    assert status == 200
    assert body["allowed"] is False


def test_a_database_fault_is_not_reported_as_a_refusal(gate, monkeypatch):
    """An outage must not read as 'your token is invalid' — the operator would
    go looking at their invitation instead of at the service."""

    def boom(*_a, **_k):
        raise psycopg2.OperationalError("server closed the connection unexpectedly")

    monkeypatch.setattr(gate, "connect", boom)

    status, body = call(gate, token=str(uuid.uuid4()))

    assert status == 503
    assert "allowed" not in body
    assert body["error"] == "database_unreachable"


# ── DOD-INV-NO-PII-DIRECTORY ──────────────────────────────────────────────────


def test_the_agent_bridge_stores_no_pii(gate):
    _, token = make_admitted_user("private@example.test")
    call(gate, token=token, agent_pubkey="pk-private")

    columns = {
        c[0]
        for c in query(
            "SELECT column_name FROM information_schema.columns WHERE table_name = 'waitlist_agent_links'"
        )
    }
    assert columns == {"agent_pubkey", "waitlist_user_id", "linked_at"}, (
        f"the bridge replicates to sovereign nodes in three jurisdictions; it holds ids only. Got {columns}"
    )


def test_a_second_agent_on_a_known_account_is_still_bridged(gate):
    """A second device is normal. Without the link its first win would never be
    attributed to the person."""
    uid, token = make_admitted_user()
    call(gate, token=token, agent_pubkey="pk-first")

    call(gate, agent_pubkey="pk-second")

    linked = {r[0] for r in query("SELECT agent_pubkey FROM waitlist_agent_links")}
    assert linked == {"pk-first", "pk-second"}


# ── A fault is not a decision (F1) ────────────────────────────────────────────


def test_a_missing_database_url_is_not_reported_as_a_refusal(gate, monkeypatch):
    """The ops agent branches on `allowed`. A permanent misconfiguration
    returning 200 allowed:false turns every user away forever while the response
    reads as a routine expired-token refusal and no 5xx alarm ever fires."""
    monkeypatch.setattr(gate, "DATABASE_URL", None)

    result = gate.lambda_handler({"telegram_id": "tg-1", "token": str(uuid.uuid4())}, None)
    body = json.loads(result["body"])

    assert result["statusCode"] == 503, "a broken gate must not answer about this person"
    assert "allowed" not in body
    assert body["error"] == "database_url_not_configured"


def test_a_malformed_event_gets_a_named_code_not_a_traceback(gate):
    result = gate.lambda_handler({"body": "{not json"}, None)
    body = json.loads(result["body"])

    assert body["allowed"] is False
    assert body["error"] == "invalid_request"


# ── One telegram account, two tokens (F3) ─────────────────────────────────────


def test_two_tokens_racing_for_one_telegram_account_burn_only_one(gate):
    """The burn was atomic; the LINK was not. Two requests presenting DIFFERENT
    valid tokens for the same telegram_id both burned, one lost its grant with
    nothing linked, and both were told allowed:true — permanent, irreversible
    loss of an admission reported as success."""
    _, token_a = make_admitted_user("alice@example.test")
    _, token_b = make_admitted_user("bob@example.test")
    barrier = threading.Barrier(2)
    results = {}

    def attempt(name, token):
        def inner():
            mod = load_lambda(Path(__file__).parent, f"gate_race_{name}")
            barrier.wait()
            results[name] = json.loads(
                mod.lambda_handler({"telegram_id": "tg-shared", "token": token}, None)["body"]
            )

        return inner

    threads = [
        threading.Thread(target=attempt("a", token_a)),
        threading.Thread(target=attempt("b", token_b)),
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=30)

    allowed = [r for r in results.values() if r.get("allowed")]
    burned = query("SELECT count(*) FROM waitlist_tokens WHERE used_at IS NOT NULL")[0][0]
    live = query("SELECT count(*) FROM waitlist_tokens WHERE used_at IS NULL")[0][0]

    # EXACTLY ONE GRANT IS CONSUMED. This is the harm in the docstring and the
    # only thing that is irreversible — a burned token cannot be un-burned.
    assert burned == 1, (
        f"{burned} grants were consumed for {len(allowed)} admission(s) — "
        "a burned grant with no link is gone forever"
    )
    # AND THE OTHER ONE IS STILL SPENDABLE. This is the half that was never
    # asserted, and it is the actual "no grant was lost" property: counting
    # burns alone cannot tell a token that survived from one that vanished.
    assert live == 1, "the losing request's token must remain usable — it paid for nothing"
    assert query("SELECT count(*) FROM telegram_accounts")[0][0] == 1

    # BOTH REQUESTS MAY BE ALLOWED, and that is not the bug this test guards.
    #
    # `len(allowed) == 1` was asserted here and failed on ~9 runs in 100 (measured,
    # 2026-07-31). The losing interleaving is benign: the winner burns and links,
    # the loser's link check then finds that row and returns
    # `already_linked` WITHOUT burning — so one grant is consumed, one telegram
    # account exists, and the loser's token stays live. Nothing is lost, and the
    # answer is true: that telegram_id IS linked.
    #
    # The docstring names the real defect as "both burned, one lost its grant
    # with nothing linked". Two allowed:true responses were a SYMPTOM of that
    # state, not the damage, and asserting the symptom made the test fail on a
    # correct outcome one run in eleven. What has teeth is the burn count, the
    # surviving token, and the single account — all asserted above.
    assert allowed, f"at least one request must be admitted: {results}"
    for name, r in results.items():
        if r.get("allowed"):
            assert r.get("reason") in ("token_burned", "already_linked"), (
                f"{name} was allowed for an unrecognised reason {r.get('reason')!r} — "
                "an admission whose cause is not one of the two known paths is not understood"
            )
    assert sum(1 for r in results.values() if r.get("reason") == "token_burned") == 1, (
        f"exactly one request may burn: {results}"
    )


def test_an_agent_bound_to_someone_else_refuses_rather_than_no_opping(gate):
    """The round-4 fix gave the TELEGRAM insert a RETURNING and left the agent
    link swallowing its conflict — under a comment claiming both were fixed.

    The consequence lands later and on the wrong person: every future first win
    from that agent mints THREE premium invites for whoever owns the link and
    stamps THEIR first_win_at. The person who actually sealed the session gets
    nothing, and nothing anywhere says so."""
    alice, _ = make_admitted_user("alice@example.test")
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO waitlist_agent_links (agent_pubkey, waitlist_user_id) VALUES ('pk-shared', %s)",
            (alice,),
        )
    conn.close()
    _, bob_token = make_admitted_user("bob@example.test")

    result = gate.lambda_handler(
        {"telegram_id": "tg-bob", "token": bob_token, "agent_pubkey": "pk-shared"}, None
    )
    body = json.loads(result["body"])

    assert body["allowed"] is False
    assert body["error"] == "agent_pubkey_bound_to_another_account"
    assert query("SELECT used_at IS NULL FROM waitlist_tokens WHERE token = %s", (bob_token,))[0][0], (
        "Bob's grant must NOT be burned for a link that could not be made"
    )
    assert query("SELECT waitlist_user_id FROM waitlist_agent_links WHERE agent_pubkey = 'pk-shared'")[0][0] == alice


def test_re_presenting_your_own_agent_is_fine(gate):
    """A second device check-in, or a retry. Ordinary."""
    uid, token = make_admitted_user()
    call(gate, token=token, agent_pubkey="pk-mine")

    _, body = call(gate, agent_pubkey="pk-mine")

    assert body["allowed"] is True
