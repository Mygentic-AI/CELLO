"""
CELLO first-win detection (M11, DOD-FIRST-WIN-1).

Fires when a session seals for the first time for a HUMAN — globally, not per
agent and not per device. The seal event carries an `agent_pubkey`;
`waitlist_agent_links` (written by the gate at token-burn time, M11-D6) turns
that into a `waitlist_user_id`, and `first_win_at IS NULL` decides whether this
is the first one.

On first win: issue 3 premium invite codes, stamp `first_win_at`, move the user
`admitted → active`, and enqueue E-win.

IDEMPOTENCY IS THE WHOLE DESIGN, not a property bolted on. This runs off an
event stream, so a redelivery is normal rather than exceptional, and the
consequence of getting it wrong is minting three more golden tickets every time
a message is replayed. The claim is therefore a conditional UPDATE —
`SET first_win_at = now() WHERE first_win_at IS NULL RETURNING` — and everything
downstream happens only for the caller that won it. A check-then-act would hand
out unlimited invites under redelivery.

A second sealed session for the same user changes nothing at all: no codes, no
email, no timestamp change.
"""

import json
import os
import secrets
import uuid

import psycopg2
import psycopg2.extras

from _logging import emit as log
from _sqlstate import classify

DATABASE_URL = os.environ.get("DATABASE_URL")
PREMIUM_INVITES = 3

# Same alphabet as the signup generator: 32 symbols, no I/O/0/1, because these
# get read aloud and typed by hand. 12 characters is 60 bits.
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
CODE_LENGTH = 12
MAX_CODE_ATTEMPTS = 10


class FirstWinError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


def connect():
    if not DATABASE_URL:
        raise FirstWinError("database_url_not_configured", "DATABASE_URL is not set.")
    conn = psycopg2.connect(DATABASE_URL, sslmode=os.environ.get("PGSSLMODE", "require"))
    conn.autocommit = False
    return conn


def generate_code(cur):
    for _ in range(MAX_CODE_ATTEMPTS):
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))
        cur.execute("SELECT 1 FROM referral_codes WHERE code = %s", (code,))
        if cur.fetchone() is None:
            return code
    raise FirstWinError(
        "code_generation_exhausted",
        f"Could not mint an unused invite code in {MAX_CODE_ATTEMPTS} attempts.",
    )


def resolve_user(cur, agent_pubkey):
    """agent_pubkey → waitlist_user_id, via the bridge the gate wrote.

    An unlinked agent is NOT an error. Plenty of agents will never have come
    through the waitlist — staff overrides, test agents, anyone who joined
    before the waitlist existed — and their sealed sessions are perfectly valid.
    They simply have no waitlist record to credit.
    """
    cur.execute(
        """
        SELECT l.waitlist_user_id, u.first_win_at, u.status, u.email_status
        FROM waitlist_agent_links l
        JOIN waitlist_users u ON u.waitlist_id = l.waitlist_user_id
        WHERE l.agent_pubkey = %s
        """,
        (agent_pubkey,),
    )
    return cur.fetchone()


def record(body, correlation_id):
    agent_pubkey = (body.get("agent_pubkey") or "").strip()
    if not agent_pubkey:
        raise FirstWinError("missing_agent_pubkey", "The seal event carried no agent pubkey.")

    conn = connect()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            linked = resolve_user(cur, agent_pubkey)

            if linked is None:
                conn.rollback()
                log("waitlist.firstwin.unlinked_agent", correlation_id, agentPubkey=agent_pubkey)
                return {"first_win": False, "reason": "agent_not_linked_to_a_waitlist_user"}

            user_id = linked["waitlist_user_id"]

            # The claim. Conditional UPDATE rather than check-then-act: this runs
            # off an event stream where redelivery is normal, and a check-then-act
            # would mint three more golden tickets on every replay.
            cur.execute(
                """
                UPDATE waitlist_users
                SET first_win_at = now(),
                    status = CASE WHEN status = 'admitted' THEN 'active' ELSE status END
                WHERE waitlist_id = %s AND first_win_at IS NULL
                RETURNING waitlist_id, status
                """,
                (user_id,),
            )
            claimed = cur.fetchone()

            if claimed is None:
                # Already won. Not an error, and deliberately does nothing at
                # all — no codes, no email, no timestamp refresh.
                conn.rollback()
                log(
                    "waitlist.firstwin.already_recorded",
                    correlation_id,
                    waitlistId=str(user_id),
                    firstWinAt=linked["first_win_at"].isoformat() if linked["first_win_at"] else None,
                )
                return {"first_win": False, "reason": "already_recorded"}

            codes = [generate_code(cur) for _ in range(PREMIUM_INVITES)]
            psycopg2.extras.execute_values(
                cur,
                "INSERT INTO referral_codes (code, owner_waitlist_user_id, creator_handle, type) VALUES %s",
                [(code, user_id) for code in codes],
                template="(%s, %s, NULL, 'premium')",
            )

            cur.execute(
                "INSERT INTO email_jobs (user_id, template, scheduled_at) "
                "VALUES (%s, 'e_win_invites', now())",
                (user_id,),
            )

        conn.commit()
        log(
            "waitlist.firstwin.recorded",
            correlation_id,
            waitlistId=str(user_id),
            invitesIssued=len(codes),
            newStatus=claimed["status"],
        )
        return {"first_win": True, "waitlist_user_id": str(user_id), "invites_issued": len(codes)}

    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def lambda_handler(event, context):
    correlation_id = getattr(context, "aws_request_id", None) or str(uuid.uuid4())

    try:
        body = event if isinstance(event, dict) and "agent_pubkey" in event else json.loads(
            event.get("body") or "{}"
        )
        return {"statusCode": 200, "body": json.dumps(record(body, correlation_id))}

    except FirstWinError as err:
        log("waitlist.firstwin.rejected", correlation_id, level="WARN", code=err.code)
        return {"statusCode": 400, "body": json.dumps({"error": err.code, "message": err.message})}

    except psycopg2.Error as err:
        log(
            "waitlist.firstwin.failed",
            correlation_id,
            level="ERROR",
            pgcode=err.pgcode,
            detail=str(err).strip(),
        )
        status, code, message = classify(err)
        # A fault must NOT read as "no first win". The caller would move on and
        # the moment is gone — there is no second first win to retry against.
        return {"statusCode": status, "body": json.dumps({"error": code, "message": message})}
