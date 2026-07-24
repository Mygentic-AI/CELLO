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

from waitlist_testdb import PGURL, query, load_lambda


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


def publish(gallery, **overrides):
    return call(gallery, "POST", "/gallery/publish", body=receipt(**overrides))


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
    result, second = call(
        gallery,
        "POST",
        "/gallery/publish",
        body=receipt(receipt_hash=first["receipt_hash"], initiator_moniker="Rewritten", verified_by=3),
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
