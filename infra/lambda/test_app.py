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

# No Postgres anywhere in this file. See waitlist_testdb.clean_tables.
pytestmark = pytest.mark.no_database

import _app
import _router


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


@pytest.mark.parametrize("name", sorted(_router.INTERNAL_TARGETS))
def test_no_internal_target_is_reachable_as_a_public_path(name):
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


@pytest.mark.parametrize(
    "target,key,value",
    [
        # The four that SNIFF a discriminating key at the top level.
        ("waitlist-waves", "capacity", 3),
        ("waitlist-gate", "telegram_id", "tg-1"),
        ("waitlist-firstwin", "agent_pubkey", "ed25519:x"),
        ("waitlist-utm", "channel", "x"),
        # The four that do NOT sniff and read their parameters off the top
        # level. Wrapping the payload in {"body": …} alone silently dropped
        # every one of these: migrate's dry_run became False and APPLIED the
        # pending migrations, email's and outreach's action became None so a
        # scheduled sweep ran a drain instead and reported success.
        ("waitlist-migrate", "dry_run", True),
        ("waitlist-email", "action", "sweep_re_engagement"),
        ("waitlist-outreach", "action", "call_completed"),
        ("waitlist-feedback", "action", "sweep"),
    ],
)
def test_every_internal_target_receives_its_own_parameters(monkeypatch, target, key, value):
    """Per target, not one representative.

    The previous version asserted only that `waitlist-waves` found `capacity`
    inside a JSON `body` — which was true, and pinned the defect as correct,
    because waves is one of the four that sniff. The four that do not were
    never exercised.
    """
    monkeypatch.setenv("INTERNAL_INVOKE_TOKEN", "right")
    run(environ("POST", f"/internal/{target}", body=json.dumps({key: value}),
                headers={"x-cello-internal-token": "right"}))

    _, event = _app._calls[0]
    assert event[key] == value, (
        f"{target} reads event[{key!r}] off the top level; wrapping the payload loses it"
    )
    # And the body shape stays, for the sniffers that fall back to it.
    assert json.loads(event["body"])[key] == value


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


# ─── the loader ──────────────────────────────────────────────────────────────
#
# THESE DO NOT USE THE AUTOUSE FIXTURE'S FAKE. Every test above monkeypatches
# `_app.dispatch`, which meant `load_handler` — the only genuinely novel code in
# this module — was never called by anything. An implementation where it raised
# unconditionally passed the entire file. That is how a router shipped in which
# waitlist-gallery could not be imported at all.


def test_every_reachable_handler_actually_imports():
    """Import all thirteen. No database: every module body is import-cheap by
    design (`_dburl` resolves lazily), which is what makes this test possible.

    waitlist-gallery imports `_receipt_validation` and waitlist-email imports
    `templates`, both PRIVATE siblings living in the handler's own directory.
    A loader that only puts the shared root on sys.path raises
    ModuleNotFoundError for the first and defers it to render() for the second.
    """
    reachable = sorted(set(_router.PUBLIC_ROUTES.values()) | _router.INTERNAL_TARGETS | {"waitlist-bounce"})
    assert len(reachable) == 13, f"expected all 13 handlers to be reachable, got {reachable}"

    for name in reachable:
        module = _app.load_handler(name)
        assert callable(getattr(module, "lambda_handler", None)), f"{name} has no lambda_handler"


def test_the_loader_leaves_sys_path_as_it_found_it():
    """`_receipt_validation` belongs to waitlist-gallery alone. If load_handler
    left its directory on sys.path, another handler could import it and load
    ORDER would start deciding behaviour.

    Measured as a DELTA around one uncached load, not as a global property:
    `waitlist_testdb.load_lambda` inserts handler directories and never removes
    them, so any suite that used it has already polluted sys.path. That is a
    real smell on the test helper, but it is not this function's contract and
    asserting the global condition here would only measure test ordering.
    """
    import sys

    _app._LOADED.pop("waitlist-gallery", None)  # force a genuine load
    before = list(sys.path)
    _app.load_handler("waitlist-gallery")
    added = [p for p in sys.path if p not in before]

    assert not [p for p in added if p.endswith("waitlist-gallery")], (
        f"load_handler left the handler's private directory importable: {added}"
    )


def test_an_unknown_handler_name_is_refused_by_name():
    with pytest.raises(FileNotFoundError, match="waitlist-nonesuch"):
        _app.load_handler("waitlist-nonesuch")


def test_every_reachable_handler_is_a_directory_that_exists_and_vice_versa():
    """The property the router's docstring claims: a handler that is neither a
    public route, nor an internal target, nor the SNS bounce URL is not
    reachable at all. Hand-maintained sets drift — this makes the claim checked.
    """
    on_disk = {p.name for p in _app.HANDLER_ROOT.iterdir() if p.is_dir() and p.name.startswith("waitlist-")}
    reachable = set(_router.PUBLIC_ROUTES.values()) | _router.INTERNAL_TARGETS | {"waitlist-bounce"}

    assert reachable == on_disk, (
        f"unreachable on disk: {sorted(on_disk - reachable)} · "
        f"routed but absent: {sorted(reachable - on_disk)}"
    )
