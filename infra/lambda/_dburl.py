"""Resolve the portal database URL in a way that survives a password rotation.

WHY THIS EXISTS. `DATABASE_URL` was baked into every waitlist function's
environment at deploy time by deploy.sh. RDS rotates `portal_admin` on a
schedule, and on 2026-07-27 it did: every function had the 19 July password and
the whole waitlist went down with

    FATAL: password authentication failed for user "portal_admin"

A user clicking Join saw "the waitlist database could not be reached". Nothing
was wrong with the code, the deploy, or the database — only with a copy of a
credential that had aged out. The repair was to rewrite thirteen environments by
hand, and it would have been needed again at the next rotation.

WHAT THIS DOES INSTEAD. The password is read from the RDS-MANAGED secret at cold
start, so a function launched after a rotation picks up the new value on its own
and a running one recovers on its next cold start. Nothing is copied and nothing
expires.

`DATABASE_URL` still wins when it is set, so local tests and anything already
configured behave exactly as before. Callers pass
`DATABASE_URL or portal_database_url()` specifically because the test harness
injects by assigning the module attribute rather than the environment variable —
reading os.environ here alone would silently bypass it.
"""

import json
import os
import urllib.parse

import boto3

_CACHED: str | None = None


def portal_database_url() -> str:
    """The connection URL, assembled from the managed secret unless overridden.

    Cached for the life of the execution environment: Secrets Manager is called
    once per cold start, not once per request. A rotation is therefore picked up
    at the next cold start rather than the next query, which is the right
    trade — the alternative is an API call in the hot path of every signup.
    """
    global _CACHED

    explicit = os.environ.get("DATABASE_URL")
    if explicit:
        return explicit

    if _CACHED is not None:
        return _CACHED

    secret_id = os.environ.get("PORTAL_DB_SECRET_ID")
    if not secret_id:
        raise RuntimeError(
            "Neither DATABASE_URL nor PORTAL_DB_SECRET_ID is set. One is required; "
            "PORTAL_DB_SECRET_ID is preferred because it survives a password rotation."
        )

    raw = boto3.client("secretsmanager").get_secret_value(SecretId=secret_id)["SecretString"]
    creds = json.loads(raw)

    host = os.environ.get("PORTAL_DB_HOST") or creds.get("host")
    port = os.environ.get("PORTAL_DB_PORT") or creds.get("port") or 5432
    name = os.environ.get("PORTAL_DB_NAME", "cello_portal")
    if not host:
        raise RuntimeError(
            f"No database host: {secret_id} carries no `host` key and PORTAL_DB_HOST is unset."
        )

    # Percent-encoded: a rotated password is random and routinely contains
    # characters that would otherwise terminate the URL early — and the
    # resulting failure reads as a wrong host or a malformed URL, not as a
    # quoting bug.
    user = urllib.parse.quote(creds["username"], safe="")
    pw = urllib.parse.quote(creds["password"], safe="")

    _CACHED = f"postgresql://{user}:{pw}@{host}:{port}/{name}"
    return _CACHED
