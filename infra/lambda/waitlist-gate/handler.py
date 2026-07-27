"""
CELLO Telegram admission gate (M11, DOD-TELEGRAM-GATE-1).

The one place a waitlist admission becomes network access. Called by the
operations agent before it starts a DKG.

Gate logic, in order (M11 §4):
  1. Is this telegram_id already in telegram_accounts? → proceed.
  2. No → a waitlist token is required.
  3. Validate: exists AND used_at IS NULL AND expires_at > now(). Any one of
     those failing is a named refusal, not a generic one.
  4. On success: burn the token, link the Telegram account, and write the
     agent_pubkey → waitlist_user_id bridge. Then proceed to DKG.

M11-D5 makes step 1 a single lookup for both token holders and staff overrides,
which is why there is no second table and no flag on users.

THE BURN IS THE WHOLE SECURITY BOUNDARY. Everything else here is bookkeeping.
`UPDATE ... WHERE used_at IS NULL RETURNING` is one atomic operation: a
read-then-write would let two simultaneous redemptions of the same token both
succeed, and a waitlist token is a grant of network access that cannot be
withdrawn once a DKG has run.

DOD-INV-NO-PII-DIRECTORY: waitlist_agent_links stores a pubkey and an id. No
email, no handle, nothing that identifies a person, because the directory side
of this bridge is replicated across sovereign nodes in three jurisdictions.
"""

import json
import os
import uuid

import psycopg2

from _dburl import portal_database_url
import psycopg2.extras

from _logging import emit as log
from _sqlstate import classify

# Kept only so an explicit override still works. The live value is resolved
# lazily by portal_database_url(), because binding the environment variable here
# is exactly what let the 2026-07-27 rotation take the whole waitlist down: the
# password was baked in at deploy time and aged out. See _dburl.py.
DATABASE_URL = os.environ.get("DATABASE_URL")


class GateError(Exception):
    """A REFUSAL that names its own cause — this person may not enter.

    The operator on the other end of Telegram gets this text. "Access denied"
    would leave someone holding a valid-looking token with no idea whether to
    wait, re-check the email, or ask for help — three different actions.

    Refusals are answers, so they leave as 200 with allowed:false. Nothing that
    is not an answer may be raised as one.
    """

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


class GateUnavailable(Exception):
    """The gate could not decide. NOT a refusal.

    Separate class because sharing one with GateError is how a permanent
    misconfiguration came to be reported as a routine expired-token refusal: the
    ops agent branches on `allowed`, so every user was turned away forever while
    the response said 200 and the log said WARN, next to every ordinary refusal,
    with no 5xx for an alarm to fire on.
    """

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


def connect():
    if not DATABASE_URL and not os.environ.get("PORTAL_DB_SECRET_ID"):
        raise GateUnavailable(
            "database_url_not_configured", "DATABASE_URL is not set on this function."
        )
    conn = psycopg2.connect(DATABASE_URL or portal_database_url(), sslmode=os.environ.get("PGSSLMODE", "require"))
    conn.autocommit = False
    return conn


def validate(body):
    telegram_id = str(body.get("telegram_id") or "").strip()
    if not telegram_id:
        raise GateError("missing_telegram_id", "No Telegram account was supplied.")

    agent_pubkey = (body.get("agent_pubkey") or "").strip()
    token = (body.get("token") or "").strip()
    return telegram_id, agent_pubkey, token


def already_admitted(cur, telegram_id):
    cur.execute(
        "SELECT waitlist_user_id, source FROM telegram_accounts WHERE telegram_id = %s",
        (telegram_id,),
    )
    return cur.fetchone()


def burn(cur, token, telegram_id, agent_pubkey, correlation_id):
    """Redeem a grant. Atomic, single-use, and it names every way it can fail."""
    try:
        uuid.UUID(token)
    except (ValueError, AttributeError, TypeError):
        # Refuse before touching the database. A malformed token is not a
        # near-miss worth a lookup, and `invalid uuid` from Postgres would reach
        # the operator as a database error rather than as "check the code".
        raise GateError("token_malformed", "That does not look like a CELLO access token.")

    # The security boundary. One statement: the check and the burn cannot be
    # separated, so two simultaneous redemptions cannot both win.
    cur.execute(
        """
        UPDATE waitlist_tokens
        SET used_at = now()
        WHERE token = %s AND used_at IS NULL AND expires_at > now()
        RETURNING waitlist_user_id, wave_number
        """,
        (token,),
    )
    row = cur.fetchone()

    if row is None:
        # Distinguish the causes. Possession of the token is already assumed by
        # the time we are here, so there is nothing left to protect by being
        # vague — and each cause implies a different next step for the person
        # holding it.
        cur.execute(
            "SELECT used_at, expires_at < now() AS expired FROM waitlist_tokens WHERE token = %s",
            (token,),
        )
        existing = cur.fetchone()
        if existing is None:
            raise GateError("token_not_found", "That access token is not recognised.")
        if existing["used_at"] is not None:
            raise GateError(
                "token_already_used",
                "That access token has already been used. Each one works once.",
            )
        raise GateError(
            "token_expired",
            "That access token has expired. Access is released back to the pool after 14 days.",
        )

    user_id = row["waitlist_user_id"]

    # F3: the burn is atomic but the LINK was not. Two requests presenting
    # different valid tokens for the same telegram_id both burned, one lost its
    # grant with nothing linked, and both were told allowed:true — a permanent,
    # irreversible loss of an admission, reported as success.
    #
    # RETURNING turns the swallowed conflict into a decision. The burn is in this
    # same transaction, so refusing here rolls it back and the grant stays live.
    cur.execute(
        """
        INSERT INTO telegram_accounts (telegram_id, waitlist_user_id, source)
        VALUES (%s, %s, 'waitlist_token')
        ON CONFLICT (telegram_id) DO NOTHING
        RETURNING telegram_id
        """,
        (telegram_id, user_id),
    )
    if cur.fetchone() is None:
        raise GateError(
            "telegram_account_already_linked",
            "That Telegram account was linked to CELLO a moment ago. "
            "Your access token has not been spent — start the link again and it "
            "will go through.",
        )

    if agent_pubkey:
        link_agent(cur, agent_pubkey, user_id)

    log(
        "waitlist.gate.token.burned",
        correlation_id,
        waitlistId=str(user_id),
        waveNumber=row["wave_number"],
        telegramLinked=True,
        # Both are outcomes rather than intentions now: each insert either
        # returned a row or raised, so reaching this line means both happened.
        agentLinked=bool(agent_pubkey),
    )
    return user_id


def link_agent(cur, agent_pubkey, user_id):
    """Bind a protocol identity to a waitlist record (M11-D6).

    The conflict is NOT swallowed. A pubkey already bound to somebody else —
    a shared machine, a restored key, a re-used test key — silently no-opped,
    and the consequence lands much later and on the wrong person: every future
    first win from that agent mints THREE premium invites for whoever owns the
    link and stamps THEIR first_win_at. The person who actually sealed the
    session gets nothing and nothing anywhere says so.
    """
    cur.execute(
        """
        INSERT INTO waitlist_agent_links (agent_pubkey, waitlist_user_id)
        VALUES (%s, %s)
        ON CONFLICT (agent_pubkey) DO NOTHING
        RETURNING agent_pubkey
        """,
        (agent_pubkey, user_id),
    )
    if cur.fetchone() is not None:
        return True

    cur.execute(
        "SELECT waitlist_user_id FROM waitlist_agent_links WHERE agent_pubkey = %s",
        (agent_pubkey,),
    )
    existing = cur.fetchone()
    if existing and existing["waitlist_user_id"] == user_id:
        # Already ours. Ordinary — a second device check-in, or a retry.
        return True

    raise GateError(
        "agent_pubkey_bound_to_another_account",
        "That agent identity is already registered to a different CELLO account. "
        "Your access token has not been used — use a fresh agent, or contact support.",
    )


def check(body, correlation_id):
    telegram_id, agent_pubkey, token = validate(body)

    conn = connect()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            existing = already_admitted(cur, telegram_id)

            if existing:
                # Already through the gate. Still record the agent link if this
                # is a new agent for a known account — a second device is a
                # normal thing to do, and without the link its first win would
                # never be attributed.
                if agent_pubkey and existing["waitlist_user_id"]:
                    link_agent(cur, agent_pubkey, existing["waitlist_user_id"])
                conn.commit()
                log(
                    "waitlist.gate.already_linked",
                    correlation_id,
                    source=existing["source"],
                    agentLinked=bool(agent_pubkey),
                )
                return {"allowed": True, "reason": "already_linked", "source": existing["source"]}

            if not token:
                # ABSENT IS NOT FINE. An unknown Telegram account with no token
                # is refused, and told exactly what is missing.
                raise GateError(
                    "token_required",
                    "This Telegram account is not linked to CELLO yet. "
                    "Send the access token from your invitation email to continue.",
                )

            user_id = burn(cur, token, telegram_id, agent_pubkey, correlation_id)
        conn.commit()
        return {"allowed": True, "reason": "token_burned", "waitlist_user_id": str(user_id)}

    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def lambda_handler(event, context):
    correlation_id = getattr(context, "aws_request_id", None) or str(uuid.uuid4())

    try:
        try:
            body = (
                event
                if isinstance(event, dict) and "telegram_id" in event
                else json.loads((event or {}).get("body") or "{}")
            )
            if not isinstance(body, dict):
                raise ValueError("body is not a JSON object")
        except (json.JSONDecodeError, TypeError, ValueError, AttributeError) as err:
            # Every other input path here produces a named code. An unhandled
            # traceback would be the one exception.
            raise GateError("invalid_request", f"Could not read the request: {err}")

        return {"statusCode": 200, "body": json.dumps(check(body, correlation_id))}

    except GateError as err:
        log("waitlist.gate.refused", correlation_id, level="WARN", code=err.code)
        # 200 with allowed:false, not an HTTP error: the caller is the ops agent
        # and this is an ANSWER, not a fault. A 4xx here would land in its error
        # path and surface to the operator as "the gate is broken" rather than
        # "your token has expired".
        return {
            "statusCode": 200,
            "body": json.dumps({"allowed": False, "error": err.code, "message": err.message}),
        }

    except GateUnavailable as err:
        # 503 and no `allowed` key at all. The ops agent must not be able to
        # read a broken gate as a decision about this person.
        log("waitlist.gate.unavailable", correlation_id, level="ERROR", code=err.code)
        return {"statusCode": 503, "body": json.dumps({"error": err.code, "message": err.message})}

    except psycopg2.Error as err:
        log("waitlist.gate.failed", correlation_id, level="ERROR", pgcode=err.pgcode, detail=str(err).strip())
        status, code, message = classify(err)
        # A database fault is NOT a refusal. Returning allowed:false here would
        # let an outage read as "your token is invalid", and the operator would
        # go looking at their invitation instead of at the service.
        return {"statusCode": status, "body": json.dumps({"error": code, "message": message})}
