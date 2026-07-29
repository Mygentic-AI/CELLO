"""
Tests for the gallery API (DOD-GALLERY-1, -RECEIPT-1, -PRIVACY-1, -INDEX-1).

The privacy property is structural rather than enforced, and the tests say so:
an unpublished receipt has no row anywhere, so there is nothing to leak and no
flag that could default wrong.
"""

import json
import uuid
from pathlib import Path

import psycopg2
import pytest

# The cookie name lives in _session, never restated here: these tests hardcoded
# it, so renaming it to the __Host- prefixed form broke 44 of them at once while
# the production code was correct.
from _session import COOKIE_NAME

from waitlist_testdb import PGURL, query, load_lambda


@pytest.fixture(autouse=True)
def _reset_owner():
    _owner_cookie["value"] = None


@pytest.fixture()
def gallery(database):
    return load_lambda(Path(__file__).parent, "gallery_handler")


def call(gallery, method, path, *, body=None, params=None):
    event = {
        "requestContext": {"http": {"method": method, "path": path}},
        "body": json.dumps(body) if body is not None else None,
        "queryStringParameters": params,
    }
    result = gallery.lambda_handler(event, None)
    return result, json.loads(result["body"]) if result["body"] else {}


def receipt(**overrides):
    return {
        "receipt_hash": f"hash-{uuid.uuid4().hex[:16]}",
        "initiator_moniker": "Ada",
        "counterparty_moniker": "Grace",
        "sealed_at": "2026-07-25T10:00:00Z",
        "message_count": 12,
        "verified_by": 2,
        "node_count": 3,
        **overrides,
    }


_owner_cookie = {"value": None}


def publish(gallery, **overrides):
    """Publishes as a signed-in owner of `pk-owner`, since publishing now
    requires proving both who you are and that the receipt is yours."""
    if _owner_cookie["value"] is None:
        _owner_cookie["value"] = _sign_in("galleryowner@example.test", "pk-owner")[0]
    return call_with_cookie(
        gallery, "/gallery/publish", receipt(agent_pubkey="pk-owner", **overrides),
        _owner_cookie["value"],
    )


# ── DOD-GALLERY-PRIVACY-1 ─────────────────────────────────────────────────────


def test_an_unpublished_receipt_has_no_row_at_all(gallery):
    """The privacy guarantee is structural: there is no receipts table with a
    published flag that could default wrong or be flipped by a bad UPDATE. The
    data was never sent."""
    assert query("SELECT count(*) FROM published_receipts")[0][0] == 0

    result, body = call(gallery, "GET", "/gallery/receipts/hash-never-published")

    assert result["statusCode"] == 404
    assert body["error"] == "receipt_not_published"


def test_there_is_no_way_to_unpublish(gallery):
    """DOD-GALLERY-PRIVACY-1: published receipts are irrevocable because the
    hash is permanent. A delete route would promise a recall that a shared,
    screenshotted, indexed URL makes impossible."""
    _, published = publish(gallery)

    for method, path in [
        ("DELETE", f"/gallery/receipts/{published['receipt_hash']}"),
        ("POST", "/gallery/unpublish"),
        ("POST", f"/gallery/receipts/{published['receipt_hash']}/delete"),
    ]:
        result, _ = call(gallery, method, path)
        assert result["statusCode"] == 404, f"{method} {path} must not exist"

    assert query("SELECT count(*) FROM published_receipts")[0][0] == 1


def test_republishing_does_not_overwrite(gallery):
    """A double-clicked button has the same intent as one click. But a later
    publish rewriting the monikers or the verification count would make the
    permanence meaningless."""
    _, first = publish(gallery, initiator_moniker="Ada")
    result, second = call_with_cookie(
        gallery,
        "/gallery/publish",
        receipt(
            receipt_hash=first["receipt_hash"],
            initiator_moniker="Rewritten",
            verified_by=3,
            agent_pubkey="pk-owner",
        ),
        _owner_cookie["value"],
    )

    assert result["statusCode"] == 200
    assert second["newly_published"] is False
    row = query("SELECT initiator_moniker, verified_by FROM published_receipts")[0]
    assert row == ("Ada", 2), "the original stands"


# ── DOD-GALLERY-RECEIPT-1 ─────────────────────────────────────────────────────


def test_a_receipt_page_carries_what_the_dod_names(gallery):
    _, published = publish(gallery)

    _, body = call(gallery, "GET", f"/gallery/receipts/{published['receipt_hash']}")

    assert body["initiator_moniker"] == "Ada"
    assert body["counterparty_moniker"] == "Grace"
    assert body["message_count"] == 12
    assert body["sealed_at"]
    assert body["receipt_hash"] == published["receipt_hash"]


def test_verification_is_two_numbers_not_a_sentence(gallery):
    """"Verified" would lose whether it was 2-of-3 or 3-of-3, and those are
    different claims about how much of the consortium attested."""
    _, published = publish(gallery, verified_by=2, node_count=3)

    _, body = call(gallery, "GET", f"/gallery/receipts/{published['receipt_hash']}")

    assert (body["verified_by"], body["node_count"]) == (2, 3)


def test_an_impossible_verification_count_is_refused(gallery):
    """Publishing "verified by 5 of 3" puts a claim on a public page that the
    directory could not have made."""
    result, body = publish(gallery, verified_by=5, node_count=3)

    assert result["statusCode"] == 400
    assert body["error"] == "impossible_verification"
    assert query("SELECT count(*) FROM published_receipts")[0][0] == 0


@pytest.mark.parametrize(
    "moniker", ['<script>alert(1)</script>', '<a href="https://evil.test">x</a>', "", "x" * 100]
)
def test_markup_cannot_reach_a_public_page_through_a_moniker(gallery, moniker):
    """These pages are public, SSR and indexed. A moniker is the only
    caller-controlled string on them."""
    result, _ = publish(gallery, initiator_moniker=moniker)

    assert result["statusCode"] == 400
    assert query("SELECT count(*) FROM published_receipts")[0][0] == 0


def test_a_malformed_hash_is_refused_before_the_database(gallery):
    result, body = call(gallery, "GET", "/gallery/receipts/../../etc/passwd")

    assert result["statusCode"] == 400
    assert body["error"] == "invalid_receipt_hash"


# ── DOD-GALLERY-INDEX-1 ───────────────────────────────────────────────────────


def test_the_index_is_chronological_and_paginated(gallery):
    for i in range(25):
        publish(gallery, initiator_moniker=f"Agent{i}")

    _, page1 = call(gallery, "GET", "/gallery/receipts")
    _, page2 = call(gallery, "GET", "/gallery/receipts", params={"page": "2"})

    assert len(page1["receipts"]) == 20, "DOD-GALLERY-INDEX-1 says 20 per page"
    assert len(page2["receipts"]) == 5
    assert page1["total"] == 25


def test_the_total_is_the_real_count(gallery):
    """A gallery that padded this would be inventing social proof, and it is the
    one number a visitor might actually check against the page."""
    for _ in range(3):
        publish(gallery)

    _, body = call(gallery, "GET", "/gallery/receipts")

    assert body["total"] == 3
    assert len(body["receipts"]) == 3


def test_an_empty_gallery_says_zero_rather_than_hiding(gallery):
    _, body = call(gallery, "GET", "/gallery/receipts")

    assert body == {"receipts": [], "page": 1, "per_page": 20, "total": 0}


def test_pagination_is_bounded(gallery):
    """An unbounded per_page on a public endpoint is a way to ask for the whole
    table in one request."""
    _, body = call(gallery, "GET", "/gallery/receipts", params={"per_page": "100000"})

    assert body["per_page"] == 100


def test_reads_need_no_authentication(gallery):
    """DOD-GALLERY-1: the whole point is that a third party can verify a receipt
    without an account."""
    _, published = publish(gallery)

    result, _ = call(gallery, "GET", f"/gallery/receipts/{published['receipt_hash']}")

    assert result["statusCode"] == 200
    assert result["headers"]["Access-Control-Allow-Origin"] == "*"


def test_a_published_receipt_is_cached_immutably(gallery):
    """It can never change — there is no update path — so a long cache is
    correct rather than risky."""
    _, published = publish(gallery)

    result, _ = call(gallery, "GET", f"/gallery/receipts/{published['receipt_hash']}")

    assert "immutable" in result["headers"]["Cache-Control"]


# ── Publishing requires proof, not a body field (DOD-GALLERY-PRIVACY-1) ───────


def _sign_in(user_email="owner@example.test", pubkey="pk-owner"):
    """Returns (cookie, waitlist_user_id) for a user who owns `pubkey`."""
    import hashlib
    import secrets

    raw = secrets.token_urlsafe(32)
    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO waitlist_users (email, anon_id) VALUES (%s, %s) RETURNING waitlist_id",
            (user_email, str(uuid.uuid4())),
        )
        uid = cur.fetchone()[0]
        cur.execute(
            "INSERT INTO waitlist_sessions (waitlist_user_id, token_hash, expires_at) "
            "VALUES (%s, %s, now() + interval '30 days')",
            (uid, hashlib.sha256(raw.encode()).hexdigest()),
        )
        cur.execute(
            "INSERT INTO waitlist_agent_links (agent_pubkey, waitlist_user_id) VALUES (%s, %s)",
            (pubkey, uid),
        )
    conn.close()
    return f"{COOKIE_NAME}={raw}", uid


def call_with_cookie(gallery, path, body, cookie=None):
    # Payload format 2.0: cookies arrive in a top-level list, never in `headers`.
    event = {
        "version": "2.0",
        "headers": {},
        "cookies": [cookie] if cookie else [],
        "requestContext": {"http": {"method": "POST", "path": path}},
        "body": json.dumps(body),
    }
    result = gallery.lambda_handler(event, None)
    return result, json.loads(result["body"])


def test_publishing_without_a_session_is_refused(gallery):
    """A published page is permanent, irrevocable and indexed, asserting that a
    session happened and that N of M directory nodes attested to it. Anyone able
    to POST could mint a forged cryptographic claim that can never be deleted."""
    result, body = call_with_cookie(
        gallery, "/gallery/publish", receipt(agent_pubkey="pk-anything")
    )

    assert result["statusCode"] == 401
    assert body["error"] == "no_active_session"
    assert query("SELECT count(*) FROM published_receipts")[0][0] == 0


def test_publishing_a_receipt_that_is_not_yours_is_refused(gallery):
    """A session alone would let any signed-in user publish a page about
    somebody else's conversation."""
    cookie, _ = _sign_in("owner@example.test", "pk-mine")

    result, body = call_with_cookie(
        gallery, "/gallery/publish", receipt(agent_pubkey="pk-somebody-elses"), cookie
    )

    assert result["statusCode"] == 403
    assert body["error"] == "receipt_not_yours"
    assert query("SELECT count(*) FROM published_receipts")[0][0] == 0


def test_the_publisher_is_taken_from_the_session_not_the_body(gallery):
    """An attacker-controlled attribution on a page that cannot be deleted."""
    cookie, real_uid = _sign_in("owner@example.test", "pk-mine")
    other = uuid.uuid4()

    result, _ = call_with_cookie(
        gallery,
        "/gallery/publish",
        receipt(agent_pubkey="pk-mine", published_by_waitlist_user_id=str(other)),
        cookie,
    )

    assert result["statusCode"] == 200
    stored = query("SELECT published_by_waitlist_user_id FROM published_receipts")[0][0]
    assert stored == real_uid, "attribution must come from the session"


def test_the_owner_can_publish_their_own_receipt(gallery):
    cookie, _ = _sign_in("owner@example.test", "pk-mine")

    result, body = call_with_cookie(
        gallery, "/gallery/publish", receipt(agent_pubkey="pk-mine"), cookie
    )

    assert result["statusCode"] == 200
    assert body["newly_published"] is True


# ── DOD-GALLERY-CONTENT-1 / DOD-GALLERY-SEED-1 (M11-D33, M11-D34) ─────────────

TURNS = [
    {"speaker": "Ada", "body": "First message over a signed, hash-chained channel."},
    {"speaker": "Grace", "body": "Verified without trusting whoever introduced us."},
]


def test_a_published_transcript_comes_back_in_order(gallery):
    """The reason the gallery exists is that a stranger can READ a real session.
    Seal metadata alone proves one happened and shows none of it."""
    _, published = publish(gallery, transcript=TURNS, message_count=len(TURNS))

    _, body = call(gallery, "GET", f"/gallery/receipts/{published['receipt_hash']}")

    assert [t["speaker"] for t in body["transcript"]] == ["Ada", "Grace"]
    assert body["transcript"][0]["body"].startswith("First message")
    # Order IS the conversation. A set-like comparison would pass on a reversal.
    assert body["transcript"] == TURNS


def test_message_count_must_match_the_transcript(gallery):
    """A page printing "12 messages" above two turns contradicts itself in front
    of the reader — the worst shape a fabricated number can take. Caught by this
    rule while writing the test above, which claimed 12 for a 2-turn exchange."""
    result, body = publish(gallery, transcript=TURNS, message_count=12)

    assert result["statusCode"] == 400
    assert body["error"] == "message_count_mismatch"
    assert query("SELECT count(*) FROM published_receipts")[0][0] == 0


def test_a_receipt_without_a_transcript_still_publishes(gallery):
    """Receipts published before transcripts existed are still valid receipts,
    and the page renders them as it always did rather than showing an empty
    panel."""
    _, published = publish(gallery)

    _, body = call(gallery, "GET", f"/gallery/receipts/{published['receipt_hash']}")

    assert body["transcript"] is None
    assert body["seal_status"] == "sealed"


def test_markup_in_a_turn_is_refused_at_the_write(gallery):
    """Same rule as monikers: refused when stored, not escaped at every read.
    Escaping correctly forever is a promise about code not yet written."""
    result, body = publish(
        gallery,
        transcript=[{"speaker": "Ada", "body": "<script>alert(1)</script>"}],
    )

    assert result["statusCode"] == 400
    assert body["error"] == "markup_in_turn"
    assert query("SELECT count(*) FROM published_receipts")[0][0] == 0


def test_a_transcript_must_be_an_array(gallery):
    result, body = publish(gallery, transcript={"speaker": "Ada", "body": "hi"})

    assert result["statusCode"] == 400
    assert body["error"] == "invalid_transcript"


def test_half_a_verification_is_refused(gallery):
    """"Verified by 2 of ?" cannot be rendered. Absent is a position; half is a
    broken claim, and defaulting the other half would invent the number."""
    result, body = publish(gallery, verified_by=2, node_count=None)

    assert result["statusCode"] == 400
    assert body["error"] == "partial_verification"
    assert query("SELECT count(*) FROM published_receipts")[0][0] == 0


def test_a_receipt_may_carry_no_verification_at_all(gallery):
    """The archive sessions predate the 3-region attestation shape and no
    document records a count. Null means the page reports the seal and claims
    nothing about attestation — the alternative was inferring a number."""
    _, published = publish(
        gallery,
        verified_by=None,
        node_count=None,
        seal_status="seal_deferred",
        seal_detail="directory unreachable at close; 16 leaves committed",
    )

    _, body = call(gallery, "GET", f"/gallery/receipts/{published['receipt_hash']}")

    assert body["verified_by"] is None
    assert body["node_count"] is None
    assert body["seal_status"] == "seal_deferred"
    assert "16 leaves" in body["seal_detail"]


def test_an_unknown_seal_status_is_refused(gallery):
    """A public page asserting a ceremony state nobody can name is worse than
    no page. Closed set, refused at the write."""
    result, body = publish(gallery, seal_status="probably_fine")

    assert result["statusCode"] == 400
    assert body["error"] == "unknown_seal_status"


def test_an_unbounded_transcript_is_refused(gallery):
    """Irrevocable public rows must be finite — there is no delete route to
    undo an accepted one."""
    result, body = publish(
        gallery,
        transcript=[{"speaker": "Ada", "body": "x" * 9000}],
    )

    assert result["statusCode"] == 400
    assert body["error"] == "turn_too_long"


def test_an_unknown_date_precision_is_refused(gallery):
    """sealed_at_precision decides whether a clock time is printed beside a
    Merkle root. Its guard had no test: deleting the whole block left 29 tests
    green, because the `or "timestamp"` default kept the field populated."""
    result, body = publish(gallery, sealed_at_precision="approximately")

    assert result["statusCode"] == 400
    assert body["error"] == "unknown_date_precision"
    assert query("SELECT count(*) FROM published_receipts")[0][0] == 0


def test_an_empty_transcript_is_stored_as_absent(gallery):
    """`[]` renders as "no transcript" but escapes WHERE transcript IS NULL,
    so it is a third state pretending to be the second."""
    _, published = publish(gallery, transcript=[], message_count=0)

    _, body = call(gallery, "GET", f"/gallery/receipts/{published['receipt_hash']}")
    assert body["transcript"] is None
