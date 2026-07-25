"""
Applies the M11 waitlist migrations to the portal RDS (DOD-SCHEMA-1).

WHY THIS EXISTS AT ALL. The migrations live in corp-cello-site, which is a
static export — it has no server, so it can never run its own migrations the way
the portal does at container boot. And the portal RDS is
`PubliclyAccessible: false`, in a VPC with no peering to anything an operator's
laptop can reach. So there was no path from the SQL files to the database, and
none had been designed: DOD-SCHEMA-1's owed item said "application to the portal
RDS" without saying how. A VPC-attached Lambda is the only thing that is both
inside the network and runnable on demand.

INVOKED BY HAND, never on a schedule. Applying DDL is an operator action; a
migration that runs on a timer applies itself at 3am to a database nobody is
watching.

The ledger logic is a port of corp-cello-site/scripts/migrate.js and must keep
its two guarantees, which are the reason that file exists:

  1. A migration runs EXACTLY ONCE. Without a ledger every file re-executes on
     every invocation, so the first ALTER or seed INSERT anyone writes fails
     permanently on the second run.

  2. Editing an ALREADY-APPLIED migration is a hard, named failure. That is the
     defect that motivated the ledger: a CHECK constraint was added to an applied
     migration and, because CREATE TABLE IF NOT EXISTS skips the table wholesale
     rather than reconciling it, the constraint silently never landed. The
     database and the file disagreed and nothing said so.

Two behaviours are deliberately NOT ported. `migrate.js` calls process.exit(1);
this raises, because a Lambda that returns normally after failing to migrate
reports success to whoever invoked it. And there is a dry-run mode, because the
first thing anyone sane wants against a database holding real rows is to see
what WOULD be applied.
"""

import hashlib
import os
import pathlib

import psycopg2

from _logging import emit as log

DATABASE_URL = os.environ.get("DATABASE_URL")
MIGRATIONS_DIR = pathlib.Path(os.environ.get("MIGRATIONS_DIR", "/var/task/migrations"))

# Arbitrary but FIXED: every migrator must pick the same number or the lock
# protects nothing. Derived from nothing, written down once, never changed.
MIGRATION_LOCK_KEY = 0x4D31314D49475241  # "M11MIGRA"

LEDGER = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    version    TEXT PRIMARY KEY,
    checksum   TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""


class MigrationError(Exception):
    pass


def checksum(sql: str) -> str:
    return hashlib.sha256(sql.encode("utf-8")).hexdigest()


def connect():
    if not DATABASE_URL:
        # ABSENT IS NOT FINE. libpq would otherwise fall through to its defaults
        # and connect to some other database, then report a connection error
        # naming the wrong subsystem.
        raise MigrationError("DATABASE_URL is not set on this function.")
    conn = psycopg2.connect(DATABASE_URL, sslmode=os.environ.get("PGSSLMODE", "require"))
    conn.autocommit = False
    return conn


def migration_files():
    if not MIGRATIONS_DIR.is_dir():
        raise MigrationError(
            f"{MIGRATIONS_DIR} does not exist. The .sql files are packaged from "
            f"corp-cello-site/migrations by deploy-lambdas.sh; an empty directory means "
            f"the package was built without them, and applying zero migrations would "
            f"otherwise look exactly like being up to date."
        )
    files = sorted(p for p in MIGRATIONS_DIR.glob("*.sql"))
    if not files:
        raise MigrationError(f"No .sql files in {MIGRATIONS_DIR} — see above; zero is not 'done'.")
    return files


def lambda_handler(event, context):
    correlation_id = getattr(context, "aws_request_id", None) or "local"
    dry_run = bool((event or {}).get("dry_run"))

    files = migration_files()
    conn = connect()
    applied_now = []

    try:
        with conn.cursor() as cur:
            cur.execute(LEDGER)
            conn.commit()

            # ONE MIGRATOR AT A TIME. The ledger's primary key stops the same
            # migration being RECORDED twice, but not the DDL being EXECUTED
            # twice: two invocations can both read an empty ledger and both run
            # `ALTER TABLE … ADD COLUMN` before either commits, and the loser
            # fails on something that has nothing to do with the migration it
            # was applying. `CREATE TABLE IF NOT EXISTS` hides this only for as
            # long as every migration is pure table creation, which stopped
            # being true at 0002.
            #
            # A session-level advisory lock, taken without waiting: a second
            # concurrent run should say so and stop, not queue up behind a
            # fifteen-minute migration and then apply nothing.
            cur.execute("SELECT pg_try_advisory_lock(%s)", (MIGRATION_LOCK_KEY,))
            if not cur.fetchone()[0]:
                raise MigrationError(
                    "Another migration run holds the lock. Nothing was applied. "
                    "Wait for it to finish and check the result before retrying — "
                    "two migrators against one database is how a half-applied schema happens."
                )
            conn.commit()

            cur.execute("SELECT version, checksum FROM schema_migrations")
            applied = {row[0]: row[1] for row in cur.fetchall()}

        # EVERY checksum is verified BEFORE anything is applied. Checking as we
        # go would apply the migrations before the tampered one and then stop,
        # leaving the database in a state that matches neither the files nor the
        # ledger — the worst of the three outcomes.
        for path in files:
            version = path.stem
            if version in applied and applied[version] != checksum(path.read_text()):
                raise MigrationError(
                    f"{path.name} has been EDITED since it was applied. Its checksum no longer "
                    f"matches the ledger. Nothing has been applied. Restore the file to its "
                    f"applied form and put the change in a NEW migration — an edited migration "
                    f"does not re-run, so the change would silently never land."
                )

        pending = [p for p in files if p.stem not in applied]

        if dry_run:
            log(
                "waitlist.migrate.dry_run",
                correlation_id,
                pending=[p.name for p in pending],
                alreadyApplied=len(applied),
            )
            return {
                "dry_run": True,
                "pending": [p.name for p in pending],
                "already_applied": len(applied),
            }

        for path in files:
            version = path.stem
            if version in applied:
                continue
            sql = path.read_text()

            # One transaction PER migration, so a failure halfway through the set
            # leaves every earlier migration applied and recorded rather than
            # rolling back work that succeeded. The ledger row is written in the
            # same transaction as the DDL — otherwise a crash between them leaves
            # a migration applied and unrecorded, which the next run re-applies.
            try:
                with conn.cursor() as cur:
                    cur.execute(sql)
                    cur.execute(
                        "INSERT INTO schema_migrations (version, checksum) VALUES (%s, %s)",
                        (version, checksum(sql)),
                    )
                conn.commit()
            except Exception as err:
                conn.rollback()
                log(
                    "waitlist.migrate.failed",
                    correlation_id,
                    level="ERROR",
                    version=version,
                    applied=applied_now,
                    detail=str(err).strip(),
                )
                raise MigrationError(f"{path.name} failed: {err}") from err

            applied_now.append(path.name)
            log("waitlist.migrate.applied", correlation_id, version=version)

    finally:
        conn.close()

    log(
        "waitlist.migrate.complete",
        correlation_id,
        appliedNow=len(applied_now),
        alreadyApplied=len(applied),
    )
    return {"applied": applied_now, "already_applied": len(applied)}
