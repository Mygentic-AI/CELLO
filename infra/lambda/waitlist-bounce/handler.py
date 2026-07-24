"""
CELLO waitlist bounce/complaint handler (M11, DOD-SES-PROD-1).

SNS topic → this Lambda → `waitlist_users.email_status`. This is the PRODUCER
for the suppression check the email dispatcher performs: without it, that check
is correct but nothing ever sets a non-'active' status, so a permanently dead
address keeps receiving mail forever and the sending reputation degrades until
SES revokes production access.

The distinction that matters most here:

  PERMANENT bounce → suppress. The mailbox does not exist. Retrying damages the
      sender reputation and can never succeed.

  TRANSIENT bounce → do NOT suppress. A full mailbox or a temporarily
      unreachable server is not a dead address. Treating it as permanent
      silently and irreversibly removes a real user who did nothing wrong — the
      failure mode is invisible, because a suppressed user simply stops hearing
      from us and has no way to notice or complain.

  COMPLAINT → suppress. Someone pressed "this is spam". Continuing to send is
      both a reputation problem and a straightforward wrong.

An address SES cannot classify is left alone. Guessing in either direction is
worse than doing nothing: suppressing wrongly loses a user, not suppressing
wrongly is caught by the next genuine bounce.
"""

import json
import os
import uuid
from datetime import datetime, timezone

import psycopg2
import psycopg2.extras

DATABASE_URL = os.environ.get("DATABASE_URL")

PERMANENT = "Permanent"


def log(event, correlation_id, level="INFO", **fields):
    print(
        json.dumps(
            {
                "event": event,
                "level": level,
                "correlationId": correlation_id,
                "ts": datetime.now(timezone.utc).isoformat(),
                **fields,
            }
        )
    )


def connect():
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL is not set on this function.")
    return psycopg2.connect(DATABASE_URL, sslmode=os.environ.get("PGSSLMODE", "require"))


def classify(notification):
    """Returns a list of (email, new_status, reason) to apply.

    An unrecognised notificationType returns nothing and is logged by the
    caller. Silently treating an unknown type as a bounce would suppress live
    users on a shape change in SES's payload.
    """
    kind = notification.get("notificationType") or notification.get("eventType")

    if kind == "Bounce":
        bounce = notification.get("bounce") or {}
        bounce_type = bounce.get("bounceType")
        recipients = bounce.get("bouncedRecipients") or []
        if bounce_type != PERMANENT:
            # Transient / Undetermined: the address may be perfectly good.
            return [
                (r.get("emailAddress"), None, f"bounce_{(bounce_type or 'unknown').lower()}")
                for r in recipients
            ]
        return [
            (r.get("emailAddress"), "bounced", "bounce_permanent") for r in recipients
        ]

    if kind == "Complaint":
        complaint = notification.get("complaint") or {}
        recipients = complaint.get("complainedRecipients") or []
        return [(r.get("emailAddress"), "complained", "complaint") for r in recipients]

    if kind == "Delivery":
        return []

    return None  # unrecognised — distinct from "nothing to do"


def apply_status(cur, email, status, correlation_id, reason):
    """Set email_status, and only ever in the suppressing direction.

    `email_status <> status` alone would let a later Delivery-style event walk a
    complained address back to active. Nothing in this function may un-suppress;
    that is a deliberate operator action, not an automatic consequence of a
    successful send.
    """
    cur.execute(
        """
        UPDATE waitlist_users
        SET email_status = %s
        WHERE lower(email) = lower(%s)
          AND email_status = 'active'
        RETURNING waitlist_id
        """,
        (status, email),
    )
    row = cur.fetchone()

    if row is None:
        # Either the address is unknown to us, or it is already suppressed.
        # Both are fine and neither is an error, but they are distinguishable
        # and the log says which.
        cur.execute(
            "SELECT email_status FROM waitlist_users WHERE lower(email) = lower(%s)", (email,)
        )
        existing = cur.fetchone()
        log(
            "waitlist.email.suppression.noop",
            correlation_id,
            reason=reason,
            outcome="already_suppressed" if existing else "unknown_address",
            currentStatus=existing["email_status"] if existing else None,
        )
        return False

    log(
        "waitlist.email.suppressed",
        correlation_id,
        level="WARN",
        waitlistId=str(row["waitlist_id"]),
        newStatus=status,
        reason=reason,
    )
    return True


def lambda_handler(event, context):
    correlation_id = getattr(context, "aws_request_id", None) or str(uuid.uuid4())
    records = (event or {}).get("Records") or []
    counts = {"suppressed": 0, "ignored": 0, "unrecognised": 0}

    conn = connect()
    try:
        conn.autocommit = False
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            for record in records:
                # Per-record SAVEPOINT. Without it one malformed record aborts
                # the transaction and every suppression already applied in this
                # batch is rolled back — the addresses stay active and nothing
                # says so.
                cur.execute("SAVEPOINT record")
                raw = ((record.get("Sns") or {}).get("Message")) or "{}"
                try:
                    notification = json.loads(raw)
                except (json.JSONDecodeError, TypeError) as err:
                    cur.execute("ROLLBACK TO SAVEPOINT record")
                    counts["unrecognised"] += 1
                    log(
                        "waitlist.email.notification.unparseable",
                        correlation_id,
                        level="ERROR",
                        detail=str(err),
                    )
                    continue

                actions = classify(notification)

                if actions is None:
                    # Unknown type: do nothing, but say so loudly. A payload
                    # shape change must not silently start suppressing users.
                    counts["unrecognised"] += 1
                    log(
                        "waitlist.email.notification.unrecognised",
                        correlation_id,
                        level="ERROR",
                        notificationType=notification.get("notificationType"),
                    )
                    cur.execute("ROLLBACK TO SAVEPOINT record")
                    continue

                for email, status, reason in actions:
                    if not email:
                        continue
                    if status is None:
                        counts["ignored"] += 1
                        log(
                            "waitlist.email.transient",
                            correlation_id,
                            reason=reason,
                            detail="not suppressed — a transient failure is not a dead address",
                        )
                        continue
                    if apply_status(cur, email, status, correlation_id, reason):
                        counts["suppressed"] += 1
                    else:
                        counts["ignored"] += 1
                cur.execute("RELEASE SAVEPOINT record")

        conn.commit()
    finally:
        conn.close()

    log("waitlist.email.notifications.processed", correlation_id, **counts)
    return counts
