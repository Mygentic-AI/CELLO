"""
CELLO UTM link generator (M11, DOD-UTM-TOOL-1).

Turns a channel + campaign (+ optional creator handle) into a fully tagged URL,
and mints the creator's referral code as a side effect so the link works the
moment it is generated.

Why this is a service rather than a spreadsheet formula: a creator link is only
worth anything if `ref=CODE` resolves, and that means a row in `referral_codes`.
Generating the URL and creating the code in two places guarantees they drift —
somebody pastes a link with a code nobody minted, and the attribution is lost
silently while the campaign looks fine.

M11-D19: an external creator has no waitlist account, so their code sets
`creator_handle` with `owner_waitlist_user_id = NULL`. The CHECK constraint on
`referral_codes` enforces exactly-one-of, and the signup endpoint routes on
whichever is set.
"""

import json
import os
import re
import uuid
from urllib.parse import urlencode, urlparse, urlunparse

import psycopg2
import psycopg2.extras

from _logging import emit as log
from _sqlstate import classify

DATABASE_URL = os.environ.get("DATABASE_URL")

# DOD-INV-DOMAIN. Every generated link points at our own site — a UTM generator
# that will tag any URL is a generator that will eventually tag somebody else's.
ALLOWED_HOSTS = frozenset({"cello.mygentic.ai", "gallery.cello.mygentic.ai"})

# Free text becomes a query parameter and then a database GROUP BY. Anything
# outside this set makes two spellings of one campaign look like two campaigns.
SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")
HANDLE_RE = re.compile(r"^[a-zA-Z0-9_.-]{1,64}$")

CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
CODE_LENGTH = 10


class UtmError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


def connect():
    if not DATABASE_URL:
        raise UtmError("database_url_not_configured", "DATABASE_URL is not set.")
    conn = psycopg2.connect(DATABASE_URL, sslmode=os.environ.get("PGSSLMODE", "require"))
    conn.autocommit = False
    return conn


def slug(value, field):
    cleaned = (value or "").strip().lower()
    if not SLUG_RE.match(cleaned):
        raise UtmError(
            f"invalid_{field}",
            f"{field} must be lowercase letters, digits, dots, dashes or underscores "
            f"(got {value!r}). Two spellings of one campaign become two campaigns in the data.",
        )
    return cleaned


def creator_code(handle):
    """Deterministic from the handle, so re-generating a link for the same
    creator yields the same code rather than a second one.

    Two codes for one creator splits their attribution across two rows and
    neither number is their real total.
    """
    digest = uuid.uuid5(uuid.NAMESPACE_URL, f"cello:creator:{handle.lower()}").hex.upper()
    return "".join(CODE_ALPHABET[int(digest[i : i + 2], 16) % len(CODE_ALPHABET)]
                   for i in range(0, CODE_LENGTH * 2, 2))


def generate(body, correlation_id):
    base = (body.get("base_url") or "https://cello.mygentic.ai/").strip()
    parsed = urlparse(base)
    if parsed.scheme not in ("http", "https") or parsed.hostname not in ALLOWED_HOSTS:
        raise UtmError(
            "unsupported_base_url",
            f"Links may only point at {', '.join(sorted(ALLOWED_HOSTS))}.",
        )

    channel = slug(body.get("channel"), "channel")
    campaign = slug(body.get("campaign"), "campaign")
    content = slug(body.get("content"), "content") if body.get("content") else None
    handle = (body.get("creator_handle") or "").strip() or None

    if handle and not HANDLE_RE.match(handle):
        raise UtmError("invalid_creator_handle", "That does not look like a handle.")

    params = {
        "utm_source": channel,
        "utm_medium": body.get("medium") and slug(body.get("medium"), "medium") or "referral",
        "utm_campaign": campaign,
    }
    if content:
        params["utm_content"] = content

    code = None
    if handle:
        code = creator_code(handle)
        conn = connect()
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                # Upsert, because generating a second link for the same creator
                # must not fail and must not mint a second code. Reactivates a
                # previously deactivated code, which is what an operator
                # generating a fresh link plainly intends.
                cur.execute(
                    """
                    INSERT INTO referral_codes (code, owner_waitlist_user_id, creator_handle, type, active)
                    VALUES (%s, NULL, %s, 'share', true)
                    ON CONFLICT (code) DO UPDATE SET active = true
                    RETURNING code, creator_handle
                    """,
                    (code, handle),
                )
                row = cur.fetchone()
                if row["creator_handle"] != handle:
                    # A collision between two different handles on one code.
                    # Silently attributing one creator's traffic to another is
                    # worse than refusing to generate the link.
                    raise UtmError(
                        "code_collision",
                        f"That handle collides with an existing code owned by "
                        f"{row['creator_handle']}. Use a different handle.",
                    )
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()
        params["ref"] = code

    url = urlunparse(parsed._replace(query=urlencode(params)))
    log(
        "waitlist.utm.generated",
        correlation_id,
        channel=channel,
        campaign=campaign,
        creatorHandle=handle,
        code=code,
    )
    return {"url": url, "ref": code, "creator_handle": handle}


def lambda_handler(event, context):
    correlation_id = getattr(context, "aws_request_id", None) or str(uuid.uuid4())

    try:
        try:
            body = event if isinstance(event, dict) and "channel" in event else json.loads(
                (event or {}).get("body") or "{}"
            )
        except (json.JSONDecodeError, TypeError, AttributeError) as err:
            raise UtmError("invalid_json", f"Request body is not valid JSON: {err}")

        return {"statusCode": 200, "body": json.dumps(generate(body, correlation_id))}

    except UtmError as err:
        log("waitlist.utm.rejected", correlation_id, level="WARN", code=err.code)
        return {"statusCode": 400, "body": json.dumps({"error": err.code, "message": err.message})}

    except psycopg2.Error as err:
        log("waitlist.utm.failed", correlation_id, level="ERROR", pgcode=err.pgcode, detail=str(err).strip())
        status, code, message = classify(err)
        return {"statusCode": status, "body": json.dumps({"error": code, "message": message})}
