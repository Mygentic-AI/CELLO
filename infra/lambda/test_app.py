"""The WSGI shell (DOD-GCP-ROUTER-1).

`_router` is tested on its own. What is left here is the part that only exists
because Cloud Run speaks WSGI: turning an environ into the values the router
wants, and turning the router's answer back into a response. Every one of these
covers something that is silently wrong rather than loudly broken.

No database. `dispatch` is substituted, because what is under test is the shell,
and a handler that needs Postgres would make these tests about Postgres.
"""

import io
import json

import pytest

import _app


@pytest.fixture(autouse=True)
def no_real_handlers(monkeypatch):
    """Record what the shell would have dispatched, and answer for it."""
    calls = []

    def fake(name, event):
        calls.append((name, event))
        return {"statusCode": 200, "headers": {"x-handled-by": name}, "body": json.dumps({"ok": True})}

    monkeypatch.setattr(_app, "dispatch", fake)
    _app._calls = calls
    return calls


def environ(method="GET", path="/", body="", query="", headers=None):
    env = {
        "REQUEST_METHOD": method,
        "PATH_INFO": path,
        "QUERY_STRING": query,
        "wsgi.input": io.BytesIO(body.encode()),
        "CONTENT_LENGTH": str(len(body.encode())) if body else "",
    }
    for key, value in (headers or {}).items():
        if key.lower() == "content-type":
            env["CONTENT_TYPE"] = value
        else:
            env[f"HTTP_{key.upper().replace('-', '_')}"] = value
    return env


def run(env):
    captured = {}

    def start_response(status, headers):
        captured["status"] = status
        captured["headers"] = headers

    body = b"".join(_app.application(env, start_response))
    return captured["status"], captured["headers"], body.decode()


# ─── health ──────────────────────────────────────────────────────────────────


def test_health_is_liveness_only_and_never_touches_a_handler():
    """A readiness-gated health check means the platform kills the container
    while it waits for the dependency, forever. infra/CLAUDE.md's ECS rule
    applies unchanged to Cloud Run."""
    status, _, body = run(environ(path="/health"))

    assert status.startswith("200")
    assert json.loads(body)["status"] == "ok"
    assert _app._calls == [], "/health must not reach a handler, or it is a readiness check"


# ─── the environ translation ─────────────────────────────────────────────────


def test_content_type_survives_the_environ():
    """WSGI strips the HTTP_ prefix from CONTENT_TYPE, so a loop over HTTP_*
    misses it — and it is what a handler reads to decide how to parse."""
    run(environ("POST", "/waitlist/signup", body='{"email":"a@b.c"}',
                headers={"content-type": "application/json"}))

    _, event = _app._calls[0]
    assert event["headers"]["content-type"] == "application/json"


def test_the_body_reaches_the_handler_intact():
    run(environ("POST", "/waitlist/signup", body='{"email":"a@b.c"}'))
    _, event = _app._calls[0]
    assert event["body"] == '{"email":"a@b.c"}'


def test_query_parameters_are_url_decoded():
    """`/auth/verify?token=…` is a real route; a token left percent-encoded
    fails to match and reads as an invalid link."""
    run(environ("GET", "/waitlist/auth/verify", query="token=a%2Bb%3Dc&next=%2Fstatus"))
    _, event = _app._calls[0]
    assert event["queryStringParameters"]["token"] == "a+b=c"
    assert event["queryStringParameters"]["next"] == "/status"


def test_request_cookies_reach_the_handler_as_the_2_0_list():
    run(environ("GET", "/waitlist/auth/session",
                headers={"cookie": "__Host-cello_wl_session=abc"}))
    _, event = _app._calls[0]
    assert "__Host-cello_wl_session=abc" in event["cookies"]


# ─── the response translation ────────────────────────────────────────────────


def test_set_cookie_survives_the_wsgi_layer(monkeypatch):
    """The end-to-end version of the router's unit test. If this is dropped
    anywhere along the chain, sessions are issued and never received."""
    monkeypatch.setattr(
        _app, "dispatch",
        lambda name, event: {
            "statusCode": 200,
            "cookies": ["__Host-cello_wl_session=tok; HttpOnly; Secure; Path=/"],
            "body": "{}",
        },
    )
    _, headers, _ = run(environ("POST", "/waitlist/auth/request", body="{}"))

    set_cookies = [v for k, v in headers if k.lower() == "set-cookie"]
    assert set_cookies == ["__Host-cello_wl_session=tok; HttpOnly; Secure; Path=/"]


def test_content_length_matches_the_encoded_body():
    """A byte count taken from the string rather than the encoding truncates
    every response containing a non-ASCII character."""
    _app.dispatch = lambda name, event: {"statusCode": 200, "body": '{"moniker":"café"}'}
    _, headers, body = run(environ("GET", "/gallery/receipts"))

    length = next(int(v) for k, v in headers if k.lower() == "content-length")
    assert length == len(body.encode("utf-8"))


# ─── routing and refusals ────────────────────────────────────────────────────


def test_an_unknown_path_names_the_path():
    status, _, body = run(environ("GET", "/waitlist/nope"))
    assert status.startswith("404")
    payload = json.loads(body)
    assert payload["error"] == "no_route"
    assert "/waitlist/nope" in payload["message"], "a 404 that does not name the path is not a clue"


def test_a_public_path_dispatches_to_the_handler_that_owned_it():
    run(environ("POST", "/waitlist/survey", body="{}"))
    assert _app._calls[0][0] == "waitlist-actions"


@pytest.mark.parametrize(
    "name", ["waitlist-waves", "waitlist-gate", "waitlist-firstwin", "waitlist-utm", "waitlist-migrate"]
)
def test_the_internal_five_are_unreachable_as_public_paths(name):
    status, _, _ = run(environ("POST", f"/waitlist/{name}", body="{}"))
    assert status.startswith("404")
    assert _app._calls == []


def test_internal_refuses_when_no_token_is_configured(monkeypatch):
    """An unset credential must not mean 'no credential required'. This is the
    deployment mistake that publishes wave assembly to the internet."""
    monkeypatch.delenv("INTERNAL_INVOKE_TOKEN", raising=False)
    status, _, body = run(environ("POST", "/internal/waitlist-waves", body="{}"))

    assert status.startswith("503")
    assert json.loads(body)["error"] == "internal_token_not_configured"
    assert _app._calls == [], "nothing may be dispatched when the guard is unconfigured"


def test_internal_refuses_a_wrong_token(monkeypatch):
    monkeypatch.setenv("INTERNAL_INVOKE_TOKEN", "right")
    status, _, body = run(environ("POST", "/internal/waitlist-waves", body="{}",
                                  headers={"x-cello-internal-token": "wrong"}))

    assert status.startswith("401")
    assert json.loads(body)["error"] == "internal_token_invalid"
    assert _app._calls == []


def test_internal_admits_a_correct_token(monkeypatch):
    monkeypatch.setenv("INTERNAL_INVOKE_TOKEN", "right")
    status, _, _ = run(environ("POST", "/internal/waitlist-waves", body='{"capacity":3}',
                               headers={"x-cello-internal-token": "right"}))

    assert status.startswith("200")
    assert _app._calls[0][0] == "waitlist-waves"


def test_internal_passes_the_payload_in_the_shape_the_handler_sniffs_for(monkeypatch):
    """gate/waves/firstwin/utm accept either a bare dict or {"body": "<json>"}.
    The router uses the second, which is the branch they already had."""
    monkeypatch.setenv("INTERNAL_INVOKE_TOKEN", "right")
    run(environ("POST", "/internal/waitlist-waves", body='{"capacity":3}',
                headers={"x-cello-internal-token": "right"}))

    _, event = _app._calls[0]
    assert json.loads(event["body"])["capacity"] == 3


def test_internal_rejects_a_malformed_body_as_a_client_error(monkeypatch):
    monkeypatch.setenv("INTERNAL_INVOKE_TOKEN", "right")
    status, _, body = run(environ("POST", "/internal/waitlist-waves", body="not json",
                                  headers={"x-cello-internal-token": "right"}))

    assert status.startswith("400")
    assert json.loads(body)["error"] == "invalid_json"


def test_the_sns_bounce_url_rebuilds_the_records_shape(monkeypatch):
    """On AWS this was an SNS subscription invoking the Lambda. Here SNS posts
    to a URL, and the handler still reads event["Records"][0]["Sns"]["Message"]."""
    notification = json.dumps({"notificationType": "Bounce"})
    run(environ("POST", "/sns/bounce", body=notification))

    name, event = _app._calls[0]
    assert name == "waitlist-bounce"
    assert event["Records"][0]["Sns"]["Message"] == notification
