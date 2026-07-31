"""The Cloud Run entry layer (DOD-GCP-ROUTER-1).

The handlers are not modified by the port. What changes is what sits in FRONT of
them: API Gateway v2 built the event and turned the returned dict back into an
HTTP response, and on Cloud Run nothing does. `_router.py` is that piece.

These tests exist because two of its jobs fail SILENTLY when done wrong, and
both have already cost this milestone real time in their API Gateway form:

  1. Request cookies. Payload format 2.0 lifts them out of `headers` into a
     top-level `cookies` LIST. When `cookie_from` read the header instead,
     `read_session` returned None on every real request — so /auth/session 401'd
     every signed-in user and /status bounced them to /auth. Both doors led back
     to the sign-in form, and every unit test passed.

  2. Response cookies. `waitlist-auth` returns `{"cookies": [...]}` — the 2.0
     response shape, which API Gateway turns into Set-Cookie headers. A router
     that copies statusCode/headers/body and drops `cookies` issues a session
     the browser never receives. Nothing errors. The user simply cannot stay
     signed in, which is indistinguishable from a bad password.

The third job is a refusal, not a translation: five handlers (migrate, waves,
gate, firstwin, utm) had NO trigger on AWS — they were reachable only by
`lambda:InvokeFunction` behind IAM. Putting them on an HTTP surface without a
guard would publish "open a wave", "burn a token" and "mint three premium invite
codes" to the internet. ABSENT IS NOT FINE (M11-PROCEDURE §5a): a missing or
unrecognised credential REFUSES.
"""

import json

import pytest

import _router


# ─── the request adapter ──────────────────────────────────────────────────────


def test_builds_the_payload_2_0_event_shape():
    """The handlers read requestContext.http.method/path — not a flat method."""
    event = _router.build_event(
        method="POST",
        path="/waitlist/signup",
        headers={"Origin": "https://cello.mygentic.ai"},
        query={},
        body='{"email":"a@b.c"}',
    )

    assert event["requestContext"]["http"]["method"] == "POST"
    assert event["requestContext"]["http"]["path"] == "/waitlist/signup"
    assert event["body"] == '{"email":"a@b.c"}'


def test_header_lookup_is_case_insensitive_both_ways():
    """Handlers read `origin` AND `Origin`; signup reads both spellings."""
    event = _router.build_event(
        method="POST", path="/x", headers={"OrIgIn": "https://cello.mygentic.ai"},
        query={}, body="",
    )
    headers = event["headers"]
    assert headers.get("origin") == "https://cello.mygentic.ai"
    assert headers.get("Origin") == "https://cello.mygentic.ai"


def test_request_cookies_land_in_the_top_level_list():
    """The 2.0 shape. `session_tokens_from` reads event["cookies"] FIRST."""
    event = _router.build_event(
        method="GET", path="/waitlist/auth/session",
        headers={"cookie": "__Host-cello_wl_session=abc; other=1"},
        query={}, body="",
    )
    assert "__Host-cello_wl_session=abc" in event["cookies"]


def test_every_cookie_of_the_same_name_survives():
    """A browser can hold several under one name; the DB decides which is live.

    Dropping the duplicates here would re-create the bug _session.py documents:
    one stale cookie permanently masking the live session behind it.
    """
    event = _router.build_event(
        method="GET", path="/waitlist/auth/session",
        headers={"cookie": "__Host-cello_wl_session=stale; __Host-cello_wl_session=live"},
        query={}, body="",
    )
    session_cookies = [c for c in event["cookies"] if c.startswith("__Host-cello_wl_session=")]
    assert len(session_cookies) == 2


# ─── the response adapter ─────────────────────────────────────────────────────


def test_response_cookies_become_set_cookie_headers():
    """THE silent one. Drop this and no user can ever stay signed in."""
    status, headers, body = _router.to_http(
        {
            "statusCode": 200,
            "headers": {"content-type": "application/json"},
            "cookies": ["__Host-cello_wl_session=tok; HttpOnly; Secure; Path=/"],
            "body": '{"ok":true}',
        }
    )

    assert status == 200
    set_cookies = [v for k, v in headers if k.lower() == "set-cookie"]
    assert set_cookies == ["__Host-cello_wl_session=tok; HttpOnly; Secure; Path=/"]
    assert body == '{"ok":true}'


def test_multiple_response_cookies_each_get_their_own_header():
    """Set-Cookie does not fold into one comma-joined value."""
    _, headers, _ = _router.to_http(
        {"statusCode": 200, "cookies": ["a=1; Path=/", "b=2; Path=/"], "body": ""}
    )
    set_cookies = [v for k, v in headers if k.lower() == "set-cookie"]
    assert set_cookies == ["a=1; Path=/", "b=2; Path=/"]


def test_a_handler_returning_no_cookies_emits_no_set_cookie():
    _, headers, _ = _router.to_http({"statusCode": 204, "body": ""})
    assert not [v for k, v in headers if k.lower() == "set-cookie"]


# ─── routing ──────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "path,expected",
    [
        ("/waitlist/signup", "waitlist-signup"),
        ("/waitlist/auth/request", "waitlist-auth"),
        ("/waitlist/auth/verify", "waitlist-auth"),
        ("/waitlist/unsubscribe", "waitlist-auth"),
        ("/waitlist/survey", "waitlist-actions"),
        ("/waitlist/readiness", "waitlist-actions"),
        ("/waitlist/interview-commit", "waitlist-actions"),
        ("/waitlist/post-url", "waitlist-actions"),
        ("/waitlist/content-alerts", "waitlist-actions"),
        ("/gallery/receipts", "waitlist-gallery"),
        ("/gallery/publish", "waitlist-gallery"),
    ],
)
def test_public_paths_route_to_the_handler_that_owned_them_on_api_gateway(path, expected):
    """The route table must match cello-waitlist.yaml exactly.

    Every one of these is a RouteKey in the CFN template. A path that moves to a
    different handler here is a behaviour change wearing a port's clothes.
    """
    assert _router.resolve_public(path) == expected


def test_an_unknown_path_is_refused_by_name():
    """404 must say what it could not route — not 'not found'."""
    resolved = _router.resolve_public("/waitlist/nope")
    assert resolved is None


# ─── the internal surface: five handlers that had no trigger ──────────────────


INTERNAL = ["waitlist-migrate", "waitlist-waves", "waitlist-gate", "waitlist-firstwin", "waitlist-utm"]


@pytest.mark.parametrize("name", INTERNAL)
def test_internal_handlers_are_not_reachable_from_the_public_router(name):
    """On AWS these had no API Gateway route at all. That must survive the port.

    `waitlist-waves` opens a wave. `waitlist-gate` burns a token. `waitlist-
    firstwin` mints three premium invite codes. None of them may be reachable by
    an unauthenticated POST.
    """
    for path in (f"/{name}", f"/waitlist/{name}", f"/internal/{name}"):
        assert _router.resolve_public(path) != name


@pytest.mark.parametrize("name", INTERNAL)
def test_internal_invoke_refuses_without_a_token(name):
    status, _, body = _router.internal_invoke(name, payload={}, presented_token=None, expected_token="s3cret")
    assert status == 401
    assert "missing" in json.loads(body)["error"]


@pytest.mark.parametrize("name", INTERNAL)
def test_internal_invoke_refuses_a_wrong_token(name):
    status, _, body = _router.internal_invoke(name, payload={}, presented_token="wrong", expected_token="s3cret")
    assert status == 401
    assert json.loads(body)["error"] == "internal_token_invalid"


def test_internal_invoke_refuses_when_the_service_has_no_token_configured():
    """ABSENT IS NOT FINE, applied to the guard's OWN input.

    An unset expected token must not mean "let everyone in". This is the
    configuration mistake that turns the internal surface public, and it is
    exactly the shape of the `Default: ""` anti-pattern in infra/CLAUDE.md.
    """
    status, _, body = _router.internal_invoke(
        "waitlist-waves", payload={"capacity": 5}, presented_token="anything", expected_token=None
    )
    assert status == 503
    assert json.loads(body)["error"] == "internal_token_not_configured"


def test_internal_token_comparison_is_constant_time():
    """A token checked with == leaks its prefix to a patient caller."""
    import inspect

    source = inspect.getsource(_router.internal_invoke)
    assert "compare_digest" in source, "use hmac.compare_digest, not =="


def test_an_unknown_internal_name_is_refused_not_dispatched():
    status, _, body = _router.internal_invoke(
        "waitlist-anything", payload={}, presented_token="s3cret", expected_token="s3cret"
    )
    assert status == 404
    assert json.loads(body)["error"] == "unknown_internal_target"
