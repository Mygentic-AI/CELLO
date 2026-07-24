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
