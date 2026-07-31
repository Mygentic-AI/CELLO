"""Tests for the SQLSTATE classifier.

The whole point of this module is that a fault reaches the operator naming the
subsystem actually at fault. Class 42 is the one worth pinning: it covers both a
missing migration and a missing GRANT, and telling someone to run a migration
when the real problem is permissions sends them to Flyway, where they will find
everything clean and no further clue.
"""

import urllib.parse

import pytest

from _sqlstate import classify


class FakeError(Exception):
    def __init__(self, pgcode):
        self.pgcode = pgcode


@pytest.mark.parametrize(
    "sqlstate,expected_code,retryable",
    [
        ("08006", "database_unreachable", True),
        ("08003", "database_unreachable", True),
        ("42P01", "schema_out_of_date", False),
        ("42703", "schema_out_of_date", False),
        ("42501", "database_permission_denied", False),
        ("42883", "database_query_rejected", False),
        ("23505", "constraint_violation", False),
        ("40001", "transaction_conflict", True),
        ("53300", "database_overloaded", True),
        ("57P03", "database_starting", True),
        ("XX000", "database_error", False),
    ],
)
def test_each_class_names_its_own_subsystem(sqlstate, expected_code, retryable):
    status, code, message = classify(FakeError(sqlstate))

    assert code == expected_code
    assert (status == 503) == retryable, (
        f"{sqlstate} is {'retryable' if retryable else 'permanent'}; "
        f"a {status} tells the caller the opposite"
    )


def test_a_permissions_fault_does_not_say_migration():
    """42501 is a missing GRANT. An operator told to run a migration will re-run
    Flyway, see it clean, and be stuck with no further clue."""
    _, code, message = classify(FakeError("42501"))

    assert code == "database_permission_denied"
    assert "migration" not in message.lower()


def test_a_missing_table_does_say_migration():
    _, code, message = classify(FakeError("42P01"))

    assert code == "schema_out_of_date"
    assert "migration" in message.lower()


def test_an_unknown_sqlstate_does_not_claim_to_know():
    _, code, message = classify(FakeError(None))

    assert code == "database_error"
    assert "migration" not in message.lower()
    assert "reach" not in message.lower(), "guessing 'unreachable' is how the original bug started"


def test_a_connection_failure_with_no_sqlstate_is_retryable():
    """The most common transient fault there is — the server never answered, so
    there is no SQLSTATE to read. Falling through to the generic branch called
    it permanent and told the caller not to retry precisely when retrying was
    the right move."""
    import psycopg2

    status, code, _ = classify(
        psycopg2.OperationalError("server closed the connection unexpectedly")
    )

    assert status == 503
    assert code == "database_unreachable"


def test_a_non_connection_error_with_no_sqlstate_still_refuses_to_guess():
    import psycopg2

    status, code, message = classify(psycopg2.ProgrammingError("something odd"))

    assert code == "database_error"
    assert status == 500, "only a connection failure may claim to be retryable"


@pytest.mark.parametrize("sqlstate", ["53300", "57P03"])
def test_the_two_classic_lambda_rds_transients_are_retryable(sqlstate):
    """A Lambda scaling out against an RDS connection cap, and a database still
    starting. Both resolve on their own, and both were being reported as
    permanent — telling the caller not to back off at exactly the moment
    backing off is the fix."""
    status, _, _ = classify(FakeError(sqlstate))
    assert status == 503


def test_an_interface_error_is_also_a_connection_failure():
    """psycopg2.InterfaceError is not an OperationalError, so a dead connection
    fell through to the generic permanent branch."""
    import psycopg2

    status, code, _ = classify(psycopg2.InterfaceError("connection already closed"))

    assert status == 503
    assert code == "database_unreachable"


def test_a_rejected_password_names_the_credential_not_the_network():
    """Constructed from a REAL failed connection, not a synthetic exception.

    The first attempt at this branch keyed on SQLSTATE class 28 and was
    unreachable: libpq fails the connection before a session exists, so
    `pgcode` is None and the no-SQLSTATE branch answers first. A hand-built
    `psycopg2.Error` with `pgcode = "28P01"` would have passed while the real
    thing — the 2026-07-26 rotation — still returned "could not reach".
    """
    import psycopg2

    from waitlist_testdb import PGURL

    wrong = PGURL.replace("m11:m11@", "m11:definitely-not-the-password@", 1)
    try:
        psycopg2.connect(wrong, sslmode="disable")
    except psycopg2.Error as err:
        assert err.pgcode is None, "if this ever carries a SQLSTATE, the branch above can be simpler"
        status, code, message = classify(err)
    else:
        raise AssertionError("the connection should have been refused")

    assert status == 503
    assert code == "database_credential_rejected", (
        "a rotated password reported as an unreachable server sends the operator to the VPC"
    )
    assert "credential" in message


def test_every_real_connection_failure_lands_in_its_own_bucket():
    """One table, six REAL libpq failures, no synthetic exceptions.

    Each of these wants a different reaction — create the database, rotate the
    secret, check the network, back off — and the first version of this
    classifier collapsed several into "could not reach", which is the one
    answer that sends an operator to the VPC for all of them.
    """
    import psycopg2

    from waitlist_testdb import PGURL

    base = PGURL.rsplit("/", 1)[0]

    # DERIVED FROM PGURL, never a hardcoded port. This read
    # `PGURL.replace(":55432/", ":55499/")`, which silently did NOTHING whenever
    # PGURL used any other port — leaving this case pointing at the LIVE test
    # database. The connection then succeeded and the failure surfaced as
    # "the connection should have been refused", which reads like a machine with
    # something odd listening rather than a test coupled to a default. Observed
    # 2026-07-31 running against port 55433, because 55432 was already held.
    parsed = urllib.parse.urlparse(PGURL)
    closed_port = 55499
    if parsed.port == closed_port:  # never build the "refused" case on a live port
        closed_port = 55498
    refused = parsed._replace(netloc=f"{parsed.netloc.rsplit(':', 1)[0]}:{closed_port}").geturl()

    cases = [
        ("wrong password", PGURL.replace("m11:m11@", "m11:nope@", 1), "database_credential_rejected"),
        ("unknown role", PGURL.replace("m11:m11@", "nobodyhere:x@", 1), "database_credential_rejected"),
        ("missing database", f"{base}/no_such_portal_db", "database_not_found"),
        ("refused port", refused, "database_unreachable"),
    ]

    for label, url, expected in cases:
        try:
            psycopg2.connect(url, sslmode="disable", connect_timeout=3)
        except psycopg2.Error as err:
            status, code, _ = classify(err)
        else:
            raise AssertionError(f"{label}: the connection should have been refused")

        assert status == 503, f"{label}: {status}"
        assert code == expected, f"{label}: classified as {code}, expected {expected}"


def test_a_connection_cap_is_capacity_not_an_unreachable_server():
    """`too many clients already` arrives at CONNECT time, so it carries no
    SQLSTATE and the class-53 branch can never see it. It is the likeliest
    transient this stack has — a Lambda fanning out against an RDS connection
    cap — and calling it unreachable sends the operator to the network instead
    of telling the caller to back off."""
    import psycopg2

    err = psycopg2.OperationalError(
        'connection to server at "db" failed: FATAL:  sorry, too many clients already\n'
    )
    status, code, message = classify(err)

    assert (status, code) == (503, "database_overloaded")
    assert "capacity" in message
