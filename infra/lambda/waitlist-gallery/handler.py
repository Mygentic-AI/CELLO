"""
CELLO gallery API (M11, DOD-GALLERY-*).

Two reads and one write:

  GET  /gallery/receipts          — the index feed, paginated
  GET  /gallery/receipts/{hash}   — one receipt
  POST /gallery/publish           — publish a sealed receipt (portal action)

PUBLISHING IS OPT-IN AND IRREVERSIBLE, and both are structural rather than
enforced by policy.

Opt-in: an unpublished receipt has no row in this database at all. It is not
hidden behind a flag that could default wrong or be flipped by a bad UPDATE —
the data was never sent. That is the strongest form the guarantee can take.

Irreversible: there is no delete route, and adding one would be a lie. A URL
that has been shared, screenshotted and indexed cannot be recalled, and a delete
button implies it can. DOD-GALLERY-PRIVACY-1 says the hash is permanent; the API
surface says the same thing by having no way to express otherwise.

The reads require no auth (DOD-GALLERY-1) because the whole point is that a
third party can verify a receipt without an account.
"""

import json
import os
import re
import uuid
from datetime import datetime

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
PAGE_SIZE = int(os.environ.get("GALLERY_PAGE_SIZE", "20"))
MAX_PAGE_SIZE = 100

HASH_RE = re.compile(r"^[a-zA-Z0-9._-]{8,128}$")
MONIKER_RE = re.compile(r"^[\w .'-]{1,64}$", re.UNICODE)


class GalleryError(Exception):
    def __init__(self, status, code, message):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def connect():
    if not DATABASE_URL and not os.environ.get("PORTAL_DB_SECRET_ID"):
        raise GalleryError(500, "database_url_not_configured", "DATABASE_URL is not set.")
    conn = psycopg2.connect(DATABASE_URL or portal_database_url(), sslmode=os.environ.get("PGSSLMODE", "require"))
    conn.autocommit = False
    return conn


def cors_headers(public_read=True):
    # READS are public by design — anyone may fetch a published receipt from
    # anywhere, which is the whole point.
    #
    # The write route is NOT advertised cross-origin. An earlier version claimed
    # here that publish "requires a portal session" while no session check
    # existed anywhere in the module, and advertised POST with a wildcard origin
    # at the same time. That comment was false in both halves.
    if not public_read:
        return {
            "Access-Control-Allow-Origin": "https://portal.cello.mygentic.ai",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Credentials": "true",
            "Access-Control-Allow-Headers": "Content-Type",
            "Content-Type": "application/json",
        }
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Content-Type": "application/json",
        # A published receipt never changes, so it can be cached hard. The index
        # can not — it gains rows.
        "Cache-Control": "public, max-age=60",
    }


def resp(status, body, cache=None):
    headers = cors_headers()
    if cache:
        headers["Cache-Control"] = cache
    return {"statusCode": status, "headers": headers, "body": json.dumps(body, default=str)}


def serialise(row):
    return {
        "receipt_hash": row["receipt_hash"],
        "initiator_moniker": row["initiator_moniker"],
        "counterparty_moniker": row["counterparty_moniker"],
        "sealed_at": row["sealed_at"],
        "message_count": row["message_count"],
        # The numbers, not a rendered sentence — "verified" would lose whether
        # it was 2-of-3 or 3-of-3, and those are different claims.
        "verified_by": row["verified_by"],
        "node_count": row["node_count"],
        "published_at": row["published_at"],
    }


def list_receipts(params, correlation_id):
    try:
        page = max(1, int((params or {}).get("page", 1)))
        size = min(MAX_PAGE_SIZE, max(1, int((params or {}).get("per_page", PAGE_SIZE))))
    except (TypeError, ValueError):
        raise GalleryError(400, "invalid_pagination", "page and per_page must be integers.")

    conn = connect()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT count(*) AS n FROM published_receipts")
            total = cur.fetchone()["n"]
            cur.execute(
                "SELECT * FROM published_receipts ORDER BY published_at DESC, receipt_hash "
                "LIMIT %s OFFSET %s",
                (size, (page - 1) * size),
            )
            rows = cur.fetchall()
    finally:
        conn.close()

    return resp(
        200,
        {
            "receipts": [serialise(r) for r in rows],
            "page": page,
            "per_page": size,
            # The real count. A gallery that padded this would be inventing
            # social proof, which is the thing DOD-INV-NO-INFLATION forbids and
            # the one number a visitor might actually check.
            "total": total,
        },
    )


def get_receipt(receipt_hash, correlation_id):
    if not receipt_hash or not HASH_RE.match(receipt_hash):
        raise GalleryError(400, "invalid_receipt_hash", "That is not a valid receipt reference.")

    conn = connect()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT * FROM published_receipts WHERE receipt_hash = %s", (receipt_hash,)
            )
            row = cur.fetchone()
    finally:
        conn.close()

    if row is None:
        # 404 with a cause. A receipt that was never published and one that
        # never existed are the same answer here on purpose — distinguishing
        # them would confirm the existence of unpublished private sessions.
        raise GalleryError(
            404, "receipt_not_published", "No published receipt with that reference."
        )

    return resp(200, serialise(row), cache="public, max-age=86400, immutable")


def publish(body, headers, correlation_id):
    """Publishing writes a permanent, irrevocable, indexed page asserting that a
    session happened and that N of M directory nodes attested to it.

    So the caller must prove two things, and an earlier version proved neither:

      1. WHO they are — a valid session, read from the cookie, never from a
         body field. `published_by_waitlist_user_id` taken from the request was
         an attacker-controlled attribution on a page that cannot be deleted.

      2. That the receipt is THEIRS — the agent that sealed it must be linked to
         them. Without this, anyone with a session could publish a page claiming
         "Ada ↔ Grace — verified by 3 of 3 nodes" for a session that never
         happened, and the schema deliberately has no delete path.
    """
    from _session import cookie_from, read_session

    receipt_hash = (body.get("receipt_hash") or "").strip()
    if not HASH_RE.match(receipt_hash or ""):
        raise GalleryError(400, "invalid_receipt_hash", "A valid receipt hash is required.")

    monikers = [
        (body.get("initiator_moniker") or "").strip(),
        (body.get("counterparty_moniker") or "").strip(),
    ]
    for moniker in monikers:
        if not MONIKER_RE.match(moniker or ""):
            raise GalleryError(
                400,
                "invalid_moniker",
                "Both agent monikers are required, and must not contain markup.",
            )

    try:
        message_count = int(body.get("message_count", 0))
        verified_by = int(body.get("verified_by", 0))
        node_count = int(body.get("node_count", 0))
        sealed_at = body.get("sealed_at")
        datetime.fromisoformat(str(sealed_at).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        raise GalleryError(400, "invalid_receipt_fields", "Receipt metadata is missing or malformed.")

    if node_count <= 0 or verified_by > node_count:
        # Publishing "verified by 5 of 3" would put a claim on a public page
        # that the directory could not have made.
        raise GalleryError(
            400,
            "impossible_verification",
            f"verified_by ({verified_by}) cannot exceed node_count ({node_count}).",
        )

    agent_pubkey = (body.get("agent_pubkey") or "").strip()
    if not agent_pubkey:
        raise GalleryError(
            400,
            "missing_agent_pubkey",
            "The publishing agent must be identified so ownership can be checked.",
        )

    conn = connect()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            session = read_session(cur, cookie_from(headers))
            if session is None:
                raise GalleryError(
                    401,
                    "no_active_session",
                    "Sign in to publish a receipt.",
                )

            # The agent must belong to the caller. A session alone would let any
            # signed-in user publish a page about somebody else's conversation.
            cur.execute(
                "SELECT 1 FROM waitlist_agent_links "
                "WHERE agent_pubkey = %s AND waitlist_user_id = %s",
                (agent_pubkey, session["waitlist_user_id"]),
            )
            if cur.fetchone() is None:
                raise GalleryError(
                    403,
                    "receipt_not_yours",
                    "That agent is not linked to your account, so this receipt is not yours to publish.",
                )

            # Publishing the same receipt twice is a no-op, not an error: the
            # portal button may be double-clicked, and the second press has the
            # same intent as the first. But it must NOT overwrite — a published
            # page is permanent, and letting a later publish rewrite the
            # monikers or the verification count would make the permanence
            # meaningless.
            cur.execute(
                """
                INSERT INTO published_receipts
                    (receipt_hash, initiator_moniker, counterparty_moniker, sealed_at,
                     message_count, verified_by, node_count, published_by_waitlist_user_id)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (receipt_hash) DO NOTHING
                RETURNING receipt_hash
                """,
                (
                    receipt_hash,
                    monikers[0],
                    monikers[1],
                    sealed_at,
                    message_count,
                    verified_by,
                    node_count,
                    # From the SESSION, never the body.
                    session["waitlist_user_id"],
                ),
            )
            created = cur.fetchone() is not None
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    log(
        "waitlist.gallery.published" if created else "waitlist.gallery.already_published",
        correlation_id,
        receiptHash=receipt_hash,
    )
    return resp(
        200,
        {
            "receipt_hash": receipt_hash,
            "url": f"https://gallery.cello.mygentic.ai/receipt/{receipt_hash}",
            "newly_published": created,
        },
    )


def lambda_handler(event, context):
    correlation_id = getattr(context, "aws_request_id", None) or str(uuid.uuid4())
    http = (event.get("requestContext") or {}).get("http") or {}
    method = http.get("method", "")
    path = http.get("path", "")

    if method == "OPTIONS":
        return {
            "statusCode": 204,
            "headers": cors_headers(public_read="/gallery/publish" not in path),
            "body": "",
        }

    try:
        if method == "GET" and "/gallery/receipts/" in path:
            return get_receipt(path.rsplit("/", 1)[-1], correlation_id)

        if method == "GET" and path.endswith("/gallery/receipts"):
            return list_receipts(event.get("queryStringParameters"), correlation_id)

        if method == "POST" and path.endswith("/gallery/publish"):
            try:
                body = json.loads(event.get("body") or "{}")
            except (json.JSONDecodeError, TypeError) as err:
                raise GalleryError(400, "invalid_json", f"Request body is not valid JSON: {err}")
            return publish(body, event.get("headers") or {}, correlation_id)

        raise GalleryError(404, "not_found", f"No route for {method} {path}.")

    except GalleryError as err:
        log(
            "waitlist.gallery.rejected",
            correlation_id,
            level="WARN" if err.status < 500 else "ERROR",
            code=err.code,
        )
        return resp(err.status, {"error": err.code, "message": err.message})

    except psycopg2.Error as err:
        log("waitlist.gallery.failed", correlation_id, level="ERROR", pgcode=err.pgcode, detail=str(err).strip())
        status, code, message = classify(err)
        return resp(status, {"error": code, "message": message})
