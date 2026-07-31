"""The WSGI application Cloud Run runs. Binds `_router` to the real handlers.

NO FRAMEWORK, DELIBERATELY (M11-D36). `_router.build_event`/`to_http` already
speak exactly the WSGI shape — an environ in, a status/headers/body out — so a
framework would contribute only a second routing layer competing with
`PUBLIC_ROUTES`, which is transcribed from the RouteKey entries in
cello-waitlist.yaml and must stay a faithful copy of them. It would also add
install size and cold-start time to a service whose whole job is to be the same
thirteen handlers somewhere else.

HANDLERS ARE LOADED BY PATH, NOT BY MODULE NAME. Every directory here holds a
file called `handler.py`, so a plain `import handler` resolves to whichever one
reached sys.modules first — and the second one silently serves the first one's
code. This is the same trap `load_lambda` documents on the test side; the
production loader must not be more naive than the test one.

LOADED ONCE, AT FIRST USE, AND CACHED. A handler's module body opens nothing —
`_dburl` resolves lazily — so importing is cheap, but doing it per request would
re-run every module body on every call and discard the psycopg2 connection reuse
the handlers were written to expect.
"""

import importlib.util
import json
import os
import sys
import threading
from pathlib import Path

import _router

HANDLER_ROOT = Path(__file__).parent
_LOADED = {}
_LOAD_LOCK = threading.Lock()


def load_handler(name):
    """The handler module for `waitlist-<x>`, by path, cached.

    The lock matters under a threaded worker: two requests arriving together for
    a cold handler would otherwise both execute the module body, and the loser's
    half-initialised module can be the one left in the cache.
    """
    cached = _LOADED.get(name)
    if cached is not None:
        return cached

    with _LOAD_LOCK:
        if name in _LOADED:  # another thread won while we waited
            return _LOADED[name]

        path = HANDLER_ROOT / name / "handler.py"
        if not path.is_file():
            raise FileNotFoundError(f"no handler.py for {name} at {path}")

        spec = importlib.util.spec_from_file_location(f"cello_{name.replace('-', '_')}", path)
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        # The handlers import their siblings (`from _dburl import …`) relative to
        # their own directory being importable.
        if str(HANDLER_ROOT) not in sys.path:
            sys.path.insert(0, str(HANDLER_ROOT))
        spec.loader.exec_module(module)
        _LOADED[name] = module
        return module


def dispatch(name, event):
    return load_handler(name).lambda_handler(event, None)


def _json(status, payload):
    body = json.dumps(payload)
    return status, [("content-type", "application/json")], body


def handle(*, method, path, headers, query, body):
    """One request, as plain values. The WSGI shell below is a thin wrapper.

    Kept separate from `application` so the routing and the refusals are
    testable without constructing a WSGI environ — the environ adds nothing to
    what is being asserted and a lot to what has to be built.
    """
    # LIVENESS ONLY, NEVER READINESS. infra/CLAUDE.md's rule for ECS applies
    # unchanged to Cloud Run: a health check gated on a dependency means the
    # platform kills the container while it waits for that dependency, forever.
    # This says the process is up. It does not say the database is reachable,
    # and it must not learn to.
    if path == "/health":
        return _json(200, {"status": "ok"})

    # The SES bounce/complaint topic. On AWS this was an SNS subscription
    # invoking the Lambda; here SNS posts to a URL and the body IS the
    # notification, so the handler's `Records` shape is rebuilt around it.
    if path == "/sns/bounce" and method == "POST":
        return _router.to_http(
            dispatch("waitlist-bounce", {"Records": [{"Sns": {"Message": body}}]})
        )

    if path.startswith("/internal/"):
        target = path[len("/internal/") :].strip("/")
        try:
            payload = json.loads(body or "{}")
        except json.JSONDecodeError as err:
            return _json(400, {"error": "invalid_json", "message": f"Body is not valid JSON: {err}"})
        return _router.internal_invoke(
            target,
            payload={"body": json.dumps(payload)},
            presented_token=(headers or {}).get("x-cello-internal-token"),
            expected_token=os.environ.get("INTERNAL_INVOKE_TOKEN"),
            dispatch=dispatch,
        )

    name = _router.resolve_public(path)
    if name is None:
        # Names the path. "Not found" alone sends the operator to look for a
        # broken handler when the real answer is that no route claims this URL.
        return _json(
            404,
            {
                "error": "no_route",
                "message": f"No route for {method} {path}. This service serves the waitlist and "
                f"gallery APIs; check the path.",
            },
        )

    event = _router.build_event(method=method, path=path, headers=headers, query=query, body=body)
    return _router.to_http(dispatch(name, event))


def application(environ, start_response):
    """WSGI entry point. `gunicorn _app:application`."""
    method = environ.get("REQUEST_METHOD", "GET")
    path = environ.get("PATH_INFO", "/")

    headers = {}
    for key, value in environ.items():
        if key.startswith("HTTP_"):
            headers[key[5:].replace("_", "-").lower()] = value
    # WSGI strips the HTTP_ prefix from these two, so a loop over HTTP_* misses
    # them — and Content-Type is what a handler reads to decide how to parse.
    for key, name in (("CONTENT_TYPE", "content-type"), ("CONTENT_LENGTH", "content-length")):
        if environ.get(key):
            headers[name] = environ[key]

    try:
        length = int(environ.get("CONTENT_LENGTH") or 0)
    except ValueError:
        length = 0
    body = environ["wsgi.input"].read(length).decode("utf-8") if length else ""

    query = {}
    for pair in (environ.get("QUERY_STRING") or "").split("&"):
        if not pair:
            continue
        key, _, value = pair.partition("=")
        from urllib.parse import unquote_plus

        query[unquote_plus(key)] = unquote_plus(value)

    status, header_pairs, out = handle(
        method=method, path=path, headers=headers, query=query, body=body
    )

    payload = (out or "").encode("utf-8")
    start_response(
        f"{status} ",
        [*header_pairs, ("content-length", str(len(payload)))],
    )
    return [payload]
