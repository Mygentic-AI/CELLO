"""
Shared Postgres fixtures for the waitlist Lambda tests.

Deliberately NOT named conftest.py: infra/conftest.py already exists, and an
explicit `from conftest import ...` resolves by sys.path to whichever module
claims the name first — which was the wrong one. conftest.py next to this file
re-exports the fixtures so pytest still discovers them.

A real Postgres, applied from corp-cello-site's migrations — not a mock. Every
defect these tests cover is a database behaviour: an aborted transaction, a cap
trigger, a row lock, a bind-parameter limit, a computed view. None of them are
observable against a fake.

Requires the local container:
    docker run -d --name m11pg -e POSTGRES_PASSWORD=m11 -e POSTGRES_USER=m11 \
        -p 55432:5432 postgres:16

Note: a globally-installed logfire pytest plugin is broken in this environment
and aborts collection, so runs need PYTEST_DISABLE_PLUGIN_AUTOLOAD=1.
"""

import os
import sys
from pathlib import Path

import psycopg2
import pytest


PGURL = os.environ.get("PGURL", "postgres://m11:m11@localhost:55432/m11_test")
ADMIN_URL = PGURL.rsplit("/", 1)[0] + "/postgres"
DB_NAME = PGURL.rsplit("/", 1)[1]
MIGRATIONS = Path(__file__).resolve().parents[2].parent / "corp-cello-site" / "migrations"

TABLES = (
    "waitlist_users, referral_codes, creator_tracking, points_ledger, "
    "email_jobs, waitlist_touchpoints, referrals"
)


def _apply_migrations():
    conn = psycopg2.connect(ADMIN_URL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(f"DROP DATABASE IF EXISTS {DB_NAME}")
        cur.execute(f"CREATE DATABASE {DB_NAME}")
    conn.close()

    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        for path in sorted(MIGRATIONS.glob("*.sql")):
            cur.execute(path.read_text())
    conn.close()


@pytest.fixture(scope="session", autouse=True)
def database():
    if not MIGRATIONS.is_dir():
        pytest.skip(f"migrations not found at {MIGRATIONS}")
    try:
        _apply_migrations()
    except psycopg2.OperationalError as err:
        pytest.skip(f"local Postgres unavailable: {err}")
    os.environ["DATABASE_URL"] = PGURL
    os.environ["PGSSLMODE"] = "disable"  # the local container speaks plaintext
    return PGURL


@pytest.fixture(autouse=True)
def clean_tables(database):
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(f"TRUNCATE {TABLES} CASCADE")
    conn.close()


def query(sql, params=()):
    conn = psycopg2.connect(PGURL)
    with conn.cursor() as cur:
        cur.execute(sql, params)
        rows = cur.fetchall() if cur.description else []
    conn.close()
    return rows


def load_lambda(directory, name):
    """Import a Lambda's handler.py by PATH, not by module name.

    Every Lambda dir here contains a file called handler.py. A plain
    `import handler` resolves to whichever one landed in sys.modules first, so
    the second suite silently tests the first suite's function. Loading by path
    under a unique module name keeps the production filenames conventional.
    """
    import importlib.util

    path = Path(directory) / "handler.py"
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    sys.path.insert(0, str(Path(directory)))  # so the module's own imports resolve
    spec.loader.exec_module(mod)
    mod.DATABASE_URL = PGURL
    return mod
