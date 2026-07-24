"""Fixture registration for the waitlist Lambda suites.

The fixtures themselves live in waitlist_testdb.py so test modules can import
PGURL and query() by an unambiguous name — see the note there.
"""

from waitlist_testdb import database, clean_tables  # noqa: F401 — pytest discovers these
