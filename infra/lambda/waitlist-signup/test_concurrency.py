"""
Concurrency tests for the guarantees that survived being deleted.

A review showed that removing `FOR UPDATE` from the premium-code lookup, and
`FOR UPDATE ... SKIP LOCKED` from the email claim, left the entire suite green.
Both docstrings state a concurrency guarantee; neither guarantee had any
coverage. A lock nobody tests is a lock somebody deletes.

Each test here runs two real threads against the real database and asserts on
the JOINT outcome — the thing a sequential test structurally cannot see.
"""

import hashlib
import json
import os
import secrets
import threading
import uuid
from pathlib import Path

import psycopg2
import pytest

from waitlist_testdb import PGURL, query, load_lambda


@pytest.fixture()
def signup(database):
    return load_lambda(Path(__file__).parent, "signup_concurrency")


def run_both(fn_a, fn_b):
    """Run two callables as simultaneously as threads allow.

    The barrier is what makes this a race rather than two sequential calls that
    happen to be on different threads.
    """
    barrier = threading.Barrier(2)
    results = {}

    def wrap(name, fn):
        def inner():
            barrier.wait()
            try:
                results[name] = fn()
            except Exception as err:  # noqa: BLE001 — the failure IS the result
                results[name] = err

        return inner

    threads = [threading.Thread(target=wrap("a", fn_a)), threading.Thread(target=wrap("b", fn_b))]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=30)

    # A thread that DIED is not a race outcome. Captured above so a genuine
    # lock-contention error can be asserted on, but a caller that never looks at
    # `results` would otherwise read a crashed thread as "did nothing" — which
    # is exactly how a broken dispatcher reported itself as "sent no duplicate
    # emails" and passed.
    for name, outcome in results.items():
        if isinstance(outcome, Exception):
            raise AssertionError(f"thread {name} failed: {outcome!r}") from outcome
    return results


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


def invoke(handler, body):
    event = {
        "headers": {"origin": "https://cello.mygentic.ai"},
        "requestContext": {"http": {"method": "POST", "path": "/waitlist/signup"}},
        "body": json.dumps(body),
    }
    result = handler.lambda_handler(event, None)
    return result["statusCode"], json.loads(result["body"])


# ── The premium-code row lock (proves apply_referral's FOR UPDATE) ────────────


def test_two_simultaneous_redemptions_of_one_premium_code(signup):
    """Without FOR UPDATE both readers see active=true and both proceed.

    The observable damage is not only a double admission: the loser is refused
    OUTRIGHT with no waitlist row at all, which is exactly the outcome M11-D24
    decided against — "refusing would lose a genuinely interested person because
    somebody else was faster".
    """
    owner = make_user("inviter@example.test")
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO referral_codes (code, owner_waitlist_user_id, type) "
            "VALUES ('RACE0001', %s, 'premium')",
            (owner,),
        )
    conn.close()

    def claim(email):
        return lambda: invoke(
            signup,
            {"email": email, "anon_id": str(uuid.uuid4()), "touchpoints": [],
             "invite_code": "RACE0001"},
        )

    results = run_both(claim("racer-a@example.test"), claim("racer-b@example.test"))

    statuses = sorted(r[0] for r in results.values() if isinstance(r, tuple))
    assert statuses == [200, 200], f"both claimants must join the waitlist, got {results}"

    admitted = query("SELECT count(*) FROM waitlist_users WHERE status = 'admitted'")[0][0]
    assert admitted == 1, "exactly one may be admitted — the code is single-use"

    assert query("SELECT active FROM referral_codes WHERE code = 'RACE0001'")[0][0] is False
    assert query("SELECT count(*) FROM waitlist_users")[0][0] == 3, (
        "owner plus both racers — nobody is refused a waitlist place"
    )


# ── The points cap under concurrency (proves 0010's per-user lock) ────────────


def test_two_simultaneous_awards_cannot_breach_the_cap(database):
    """DOD-INV-POINTS-CAPS says a direct SQL insert past the cap must fail.

    Without a lock the trigger reads the pre-state in both sessions and both
    inserts commit — cap 30, ledger 40 — and points_total settles at a value
    that disagrees with the ledger it summarises. waitlist_queue ranks on
    points_total, so the queue position then silently disagrees too.
    """
    uid = make_user("capped@example.test")
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO points_ledger (waitlist_user_id, points, reason) "
            "VALUES (%s, 20, 'share_conversion')",
            (uid,),
        )
    conn.close()

    def award():
        def inner():
            c = psycopg2.connect(PGURL)
            c.autocommit = True
            try:
                with c.cursor() as cur:
                    cur.execute(
                        "INSERT INTO points_ledger (waitlist_user_id, points, reason) "
                        "VALUES (%s, 10, 'share_conversion')",
                        (uid,),
                    )
                return "accepted"
            except psycopg2.errors.CheckViolation:
                return "rejected"
            finally:
                c.close()

        return inner

    results = run_both(award(), award())

    outcomes = sorted(str(v) for v in results.values())
    assert outcomes == ["accepted", "rejected"], f"exactly one may win, got {results}"

    ledger = query(
        "SELECT COALESCE(sum(points),0) FROM points_ledger "
        "WHERE waitlist_user_id = %s AND reason = 'share_conversion'",
        (uid,),
    )[0][0]
    assert ledger == 30, f"cap is 30, ledger holds {ledger}"

    total = query("SELECT points_total FROM waitlist_users WHERE waitlist_id = %s", (uid,))[0][0]
    assert total == ledger, (
        f"points_total ({total}) must agree with the ledger ({ledger}) — "
        "waitlist_queue ranks on it"
    )


# ── The email claim lock (proves SKIP LOCKED) ─────────────────────────────────


def test_two_simultaneous_dispatcher_runs_send_each_email_once(database):
    """The dispatcher's docstring says two concurrent invocations must never
    send the same job twice. Nothing tested it, and deleting the clause left the
    suite green. A duplicate email cannot be recalled."""
    email_dir = Path(__file__).resolve().parents[1] / "waitlist-email"
    # Set HERE, not inherited. The dispatcher refuses to send without a
    # configuration set, and this file used to borrow the variable from
    # waitlist-email's own suite — so running it alone crashed both threads and
    # the test read that as "no duplicates sent" and passed on the crash.
    os.environ.setdefault("WAITLIST_SES_CONFIG_SET", "cello-waitlist-test")

    users = [make_user(f"race{i}@example.test") for i in range(6)]
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        for uid in users:
            cur.execute(
                "INSERT INTO referral_codes (code, owner_waitlist_user_id, type) "
                "VALUES (%s, %s, 'share')",
                (f"C{str(uid)[:8].upper()}", uid),
            )
            cur.execute(
                "INSERT INTO email_jobs (user_id, template, scheduled_at) "
                "VALUES (%s, 'e1_confirm', now())",
                (uid,),
            )
    conn.close()

    sent_lock = threading.Lock()
    all_sent = []

    def run(module_name):
        def inner():
            mod = load_lambda(email_dir, module_name)

            class Recorder:
                # send_raw_email, matching the handler. The dispatcher had to
                # move off send_email because that API has no `Headers`
                # parameter and cannot carry the RFC 8058 unsubscribe pair — it
                # raised ParamValidationError on every real send while every
                # fake happily accepted it.
                def send_raw_email(self, **kwargs):
                    with sent_lock:
                        all_sent.append(kwargs["Destinations"][0])
                    return {"MessageId": "x"}

                def send_email(self, **kwargs):
                    raise AssertionError(
                        "send_email cannot carry List-Unsubscribe headers — use send_raw_email"
                    )

            recorder = Recorder()
            mod.ses = lambda: recorder
            return mod.lambda_handler({}, None)

        return inner

    run_both(run("email_race_a"), run("email_race_b"))

    assert sorted(all_sent) == sorted(f"race{i}@example.test" for i in range(6)), (
        f"each address exactly once; got {sorted(all_sent)}"
    )
    assert len(all_sent) == len(set(all_sent)), "no address may receive a duplicate"
