"""
Tests for the UTM link generator (DOD-UTM-TOOL-1, M11-D19).

The load-bearing property is that generating a link and minting the code are the
SAME operation. Split them and somebody eventually pastes a link whose ref
resolves to nothing — the campaign looks fine and the attribution is lost
silently, which is the worst shape a measurement bug can take.
"""

import json
from pathlib import Path

import pytest

from waitlist_testdb import PGURL, query, load_lambda


@pytest.fixture()
def utm(database):
    return load_lambda(Path(__file__).parent, "utm_handler")


def gen(utm, **body):
    payload = {"channel": "reddit", "campaign": "launch", **body}
    result = utm.lambda_handler(payload, None)
    return result["statusCode"], json.loads(result["body"])


def test_a_plain_link_carries_the_utm_triple(utm):
    _, body = gen(utm)

    assert "utm_source=reddit" in body["url"]
    assert "utm_campaign=launch" in body["url"]
    assert "utm_medium=" in body["url"]
    assert body["ref"] is None, "no creator handle means no code to mint"


def test_a_creator_link_mints_the_code_that_makes_it_work(utm):
    """The whole point. A ref that resolves to nothing loses the attribution
    silently while the campaign looks healthy."""
    _, body = gen(utm, creator_handle="techjournalist")

    assert f"ref={body['ref']}" in body["url"]
    row = query(
        "SELECT creator_handle, owner_waitlist_user_id, active FROM referral_codes WHERE code = %s",
        (body["ref"],),
    )[0]
    assert row == ("techjournalist", None, True), (
        "M11-D19: an external creator has no waitlist account, so owner is NULL"
    )


def test_regenerating_a_link_reuses_the_same_code(utm):
    """Two codes for one creator splits their attribution across two rows and
    neither number is their real total."""
    _, first = gen(utm, creator_handle="samecreator", campaign="one")
    _, second = gen(utm, creator_handle="samecreator", campaign="two")

    assert first["ref"] == second["ref"]
    assert query("SELECT count(*) FROM referral_codes")[0][0] == 1


def test_regenerating_reactivates_a_deactivated_code(utm):
    _, first = gen(utm, creator_handle="returning")
    conn_query = "UPDATE referral_codes SET active = false WHERE code = %s"
    import psycopg2

    conn = psycopg2.connect(PGURL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(conn_query, (first["ref"],))
    conn.close()

    gen(utm, creator_handle="returning")

    assert query("SELECT active FROM referral_codes WHERE code = %s", (first["ref"],))[0][0] is True


@pytest.mark.parametrize(
    "field,value",
    [
        ("channel", "Reddit Ads"),
        ("channel", ""),
        ("campaign", "Launch Week!"),
        ("campaign", "a" * 80),
    ],
)
def test_free_text_that_would_split_a_campaign_is_refused(utm, field, value):
    """These become a query parameter and then a GROUP BY. Two spellings of one
    campaign become two campaigns, and the numbers are wrong in a way nobody
    notices."""
    status, body = gen(utm, **{field: value})

    assert status == 400
    assert body["error"] == f"invalid_{field}"


def test_the_channel_is_normalised_rather_than_rejected_for_case(utm):
    _, body = gen(utm, channel="REDDIT")
    assert "utm_source=reddit" in body["url"]


@pytest.mark.parametrize(
    "base",
    [
        "https://evil.example/",
        "http://cello.mygentic.ai.evil.example/",
        "javascript:alert(1)",
    ],
)
def test_it_will_not_tag_somebody_elses_url(utm, base):
    """DOD-INV-DOMAIN. A generator that will tag any URL is one that eventually
    tags a URL we do not own."""
    status, body = gen(utm, base_url=base)

    assert status == 400
    assert body["error"] == "unsupported_base_url"


def test_the_gallery_subdomain_is_allowed(utm):
    status, body = gen(utm, base_url="https://gallery.cello.mygentic.ai/")
    assert status == 200
    assert body["url"].startswith("https://gallery.cello.mygentic.ai/")


def test_a_generated_creator_link_actually_attributes_a_signup(utm):
    """End to end through the real signup handler — the two halves of M11-D19
    proven together rather than each assumed correct."""
    _, link = gen(utm, creator_handle="endtoend")

    signup = load_lambda(
        Path(__file__).resolve().parents[1] / "waitlist-signup", "signup_via_utm"
    )
    import uuid as _uuid

    event = {
        "headers": {"origin": "https://cello.mygentic.ai"},
        "requestContext": {"http": {"method": "POST", "path": "/waitlist/signup"}},
        "body": json.dumps(
            {
                "email": "reader@example.test",
                "anon_id": str(_uuid.uuid4()),
                "touchpoints": [
                    {"ts": "2026-07-25T10:00:00Z", "url": link["url"], "ref": link["ref"]}
                ],
            }
        ),
    }
    result = signup.lambda_handler(event, None)

    assert result["statusCode"] == 200, result["body"]
    tracked = query("SELECT creator_handle, event_type FROM creator_tracking")
    assert tracked == [("endtoend", "signup")]
