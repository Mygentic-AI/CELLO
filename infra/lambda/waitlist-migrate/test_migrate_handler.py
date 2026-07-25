"""
Tests for the migration runner (DOD-SCHEMA-1).

This is the highest-consequence code in M11: it applies DDL to the one database
the portal, the waitlist and the ops dashboard all share, and it had no tests at
all until this file. Every property below is one whose absence corrupts a schema
rather than producing a wrong answer.

Runs against a scratch database of its own, created and dropped here, because
the whole point is to exercise a runner that mutates schema — pointing it at a
shared fixture database would make every other suite depend on the order this
one happened to run in.
"""

import os
import pathlib
import subprocess
import uuid

import psycopg2
import pytest

from waitlist_testdb import load_lambda

ADMIN = os.environ.get("PGURL", "postgres://m11:m11@localhost:55432/m11_test")
BASE = ADMIN.rsplit("/", 1)[0]
SCRATCH = f"m11_migrate_{uuid.uuid4().hex[:8]}"


def admin_exec(sql, db="postgres"):
    conn = psycopg2.connect(f"{BASE}/{db}")
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(sql)
    conn.close()


@pytest.fixture()
def scratch(tmp_path, monkeypatch):
    """A fresh database and a migrations directory the test controls."""
    admin_exec(f'CREATE DATABASE "{SCRATCH}"')
    url = f"{BASE}/{SCRATCH}"
    monkeypatch.setenv("DATABASE_URL", url)
    monkeypatch.setenv("PGSSLMODE", "disable")
    monkeypatch.setenv("MIGRATIONS_DIR", str(tmp_path))
    mod = load_lambda(pathlib.Path(__file__).parent, f"migrate_{uuid.uuid4().hex[:6]}")
    mod.DATABASE_URL = url
    mod.MIGRATIONS_DIR = tmp_path
    try:
        yield mod, tmp_path, url
    finally:
        # Terminate stragglers first: an advisory lock held by a leaked
        # connection would block the DROP.
        admin_exec(
            f"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '{SCRATCH}'"
        )
        admin_exec(f'DROP DATABASE IF EXISTS "{SCRATCH}"')


def write(d, name, sql):
    (d / name).write_text(sql)


def rows(url, sql):
    conn = psycopg2.connect(url)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(sql)
        out = cur.fetchall()
    conn.close()
    return out


# ── Applying ──────────────────────────────────────────────────────────────────


def test_applies_in_filename_order_and_records_each(scratch):
    mod, d, url = scratch
    write(d, "0001_a.sql", "CREATE TABLE a (id int);")
    write(d, "0002_b.sql", "CREATE TABLE b (id int);")

    result = mod.lambda_handler({}, None)

    assert result["applied"] == ["0001_a.sql", "0002_b.sql"]
    assert [r[0] for r in rows(url, "SELECT version FROM schema_migrations ORDER BY version")] == [
        "0001_a",
        "0002_b",
    ]


def test_a_second_run_applies_nothing(scratch):
    mod, d, url = scratch
    write(d, "0001_a.sql", "CREATE TABLE a (id int);")
    mod.lambda_handler({}, None)

    assert mod.lambda_handler({}, None)["applied"] == []


def test_a_migration_that_is_not_idempotent_still_runs_exactly_once(scratch):
    """The reason the ledger exists. `ALTER TABLE ADD COLUMN` has no IF NOT
    EXISTS in older Postgres idiom and seed INSERTs have none at all, so a
    runner without a ledger fails permanently on its second invocation."""
    mod, d, url = scratch
    write(d, "0001_a.sql", "CREATE TABLE a (id int);")
    write(d, "0002_seed.sql", "INSERT INTO a (id) VALUES (1);")
    mod.lambda_handler({}, None)

    mod.lambda_handler({}, None)

    assert rows(url, "SELECT count(*) FROM a")[0][0] == 1


# ── Tamper detection ──────────────────────────────────────────────────────────


def test_editing_an_applied_migration_fails_and_names_the_file(scratch):
    mod, d, url = scratch
    write(d, "0001_a.sql", "CREATE TABLE a (id int);")
    mod.lambda_handler({}, None)
    write(d, "0001_a.sql", "CREATE TABLE a (id int, extra text);")

    with pytest.raises(mod.MigrationError, match="0001_a.sql"):
        mod.lambda_handler({}, None)


def test_a_tampered_file_blocks_the_WHOLE_run_not_just_itself(scratch):
    """Every checksum is verified before anything is applied. Checking as it
    goes would apply the migrations preceding the tampered one and then stop,
    leaving the database matching neither the files nor the ledger — the worst
    of the three outcomes."""
    mod, d, url = scratch
    write(d, "0001_a.sql", "CREATE TABLE a (id int);")
    mod.lambda_handler({}, None)
    write(d, "0001_a.sql", "CREATE TABLE a (id int, extra text);")
    write(d, "0002_b.sql", "CREATE TABLE b (id int);")

    with pytest.raises(mod.MigrationError):
        mod.lambda_handler({}, None)

    assert rows(url, "SELECT to_regclass('b') IS NULL")[0][0] is True, (
        "the untampered migration must NOT have been applied"
    )


# ── Dry run ───────────────────────────────────────────────────────────────────


def test_dry_run_lists_pending_and_changes_nothing(scratch):
    mod, d, url = scratch
    write(d, "0001_a.sql", "CREATE TABLE a (id int);")

    result = mod.lambda_handler({"dry_run": True}, None)

    assert result["pending"] == ["0001_a.sql"]
    assert rows(url, "SELECT to_regclass('a') IS NULL")[0][0] is True
    assert rows(url, "SELECT count(*) FROM schema_migrations")[0][0] == 0


# ── Absent is not fine ────────────────────────────────────────────────────────


def test_an_absent_migrations_directory_refuses(scratch):
    """Applying zero migrations succeeds and looks exactly like being up to
    date, so 'the package shipped without its SQL' must be loud."""
    mod, d, url = scratch
    mod.MIGRATIONS_DIR = pathlib.Path("/nonexistent/migrations")

    with pytest.raises(mod.MigrationError, match="does not exist"):
        mod.lambda_handler({}, None)


def test_an_empty_migrations_directory_refuses(scratch):
    mod, d, url = scratch

    with pytest.raises(mod.MigrationError, match="No .sql files"):
        mod.lambda_handler({}, None)


def test_an_unset_database_url_refuses(scratch):
    mod, d, url = scratch
    write(d, "0001_a.sql", "CREATE TABLE a (id int);")
    mod.DATABASE_URL = None

    with pytest.raises(mod.MigrationError, match="DATABASE_URL"):
        mod.lambda_handler({}, None)


# ── Failure leaves earlier work applied, and recorded ─────────────────────────


def test_a_failing_migration_keeps_the_ones_before_it(scratch):
    """One transaction PER migration. A single transaction for the whole set
    would roll back work that succeeded, and the operator would re-run into the
    same wall with no progress."""
    mod, d, url = scratch
    write(d, "0001_a.sql", "CREATE TABLE a (id int);")
    write(d, "0002_bad.sql", "THIS IS NOT SQL;")

    with pytest.raises(mod.MigrationError, match="0002_bad.sql"):
        mod.lambda_handler({}, None)

    assert rows(url, "SELECT to_regclass('a') IS NOT NULL")[0][0] is True
    assert [r[0] for r in rows(url, "SELECT version FROM schema_migrations")] == ["0001_a"]


def test_a_failed_migration_is_not_recorded_as_applied(scratch):
    """The ledger row is written in the SAME transaction as the DDL. Otherwise a
    crash between them leaves a migration applied and unrecorded — which the
    next run applies a second time."""
    mod, d, url = scratch
    write(d, "0001_bad.sql", "THIS IS NOT SQL;")

    with pytest.raises(mod.MigrationError):
        mod.lambda_handler({}, None)

    assert rows(url, "SELECT count(*) FROM schema_migrations")[0][0] == 0


# ── One migrator at a time ────────────────────────────────────────────────────


def test_a_second_concurrent_run_refuses_rather_than_queueing(scratch):
    """Two migrators against one database is how a half-applied schema happens.

    The ledger's primary key stops a migration being RECORDED twice; it does not
    stop the DDL being EXECUTED twice, because both runs can read an empty
    ledger before either commits.

    The lock is non-blocking on purpose: a second run should say so and stop,
    not queue behind a fifteen-minute migration and then apply nothing while
    reporting success.
    """
    mod, d, url = scratch
    write(d, "0001_a.sql", "CREATE TABLE a (id int);")

    holder = psycopg2.connect(url)
    holder.autocommit = False
    try:
        with holder.cursor() as cur:
            cur.execute("SELECT pg_try_advisory_lock(%s)", (mod.MIGRATION_LOCK_KEY,))
            assert cur.fetchone()[0] is True
        # Committing must NOT drop it — the lock is session-scoped, and the
        # handler commits right after taking it. If this were an xact lock the
        # guard would be decorative.
        holder.commit()

        with pytest.raises(mod.MigrationError, match="holds the lock"):
            mod.lambda_handler({}, None)

        assert rows(url, "SELECT to_regclass('a') IS NULL")[0][0] is True, (
            "nothing may be applied while another migrator holds the lock"
        )
    finally:
        holder.close()

    # And the lock frees when that connection dies, so a Lambda that times out
    # mid-migration cannot deadlock every future run.
    assert mod.lambda_handler({}, None)["applied"] == ["0001_a.sql"]


def test_the_ledger_row_and_the_DDL_share_one_transaction(scratch):
    """A crash between applying and recording leaves a migration applied and
    UNRECORDED — which the next run applies a second time, and the second time
    a non-idempotent migration fails permanently.

    Written after a revert test caught nothing: splitting the ledger INSERT into
    its own transaction left all twelve tests green, because the failure needs a
    crash BETWEEN the two commits and nothing was producing one. So this
    produces one — the ledger write is made to fail, and the DDL must vanish
    with it.
    """
    mod, d, url = scratch
    write(d, "0001_a.sql", "CREATE TABLE a (id int);")

    real_checksum = mod.checksum
    calls = {"n": 0}

    def poisoned(sql):
        # In the apply loop the order is: cur.execute(DDL), then
        # cur.execute(INSERT …, checksum(sql)) — so checksum() runs AFTER the
        # DDL and before the ledger row, inside the same transaction. That is
        # exactly the crash window.
        #
        # The tamper pass also calls checksum(), but only for files ALREADY in
        # the ledger; with nothing applied yet it calls it zero times. So the
        # first call here is the ledger write. (An earlier version failed on the
        # second call and therefore never fired at all — the test passed while
        # proving nothing, which is how it was caught.)
        calls["n"] += 1
        raise RuntimeError("simulated crash between applying and recording")

    mod.checksum = poisoned
    try:
        with pytest.raises(mod.MigrationError):
            mod.lambda_handler({}, None)
    finally:
        mod.checksum = real_checksum

    assert rows(url, "SELECT to_regclass('a') IS NULL")[0][0] is True, (
        "the DDL must roll back with the ledger write — otherwise the migration "
        "is applied but unrecorded, and the next run applies it again"
    )
    assert rows(url, "SELECT count(*) FROM schema_migrations")[0][0] == 0
