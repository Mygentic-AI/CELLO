"""The Cloud Run entry layer: what API Gateway v2 used to do, in one module.

WHY THIS EXISTS. The thirteen waitlist handlers are not modified by the GCP
port — that is the whole premise of DOD-GCP-ROUTER-1. They keep reading
`requestContext.http.method`, `event["body"]` and the top-level `cookies` list,
and they keep returning `{statusCode, headers, body, cookies}`. On AWS, API
Gateway built that event and turned the returned dict back into an HTTP
response. On Cloud Run nothing does. This is that piece and nothing more.

THREE ENTRY SHAPES, not one. The handlers do not share a single contract:

  - HTTP (4): signup, auth, actions, gallery — payload format 2.0 events.
  - SNS (1): bounce — reads `event["Records"]`, delivered by an SES
    configuration set. Its transport becomes an HTTPS POST from SNS.
  - Plain payload (8): the rest. Four of them (gate, waves, firstwin, utm)
    already accept EITHER a bare dict or an API-Gateway-shaped `{"body": ...}`,
    sniffing on a discriminating key. They therefore need no adaptation at all —
    passing `{"body": <json string>}` hits the branch they already had.

THE PUBLIC/INTERNAL SPLIT IS A SECURITY BOUNDARY, not tidiness. Five handlers
had NO trigger on AWS: they were reachable only via `lambda:InvokeFunction`,
behind IAM. `waitlist-waves` opens a wave and mints admission tokens.
`waitlist-gate` burns one. `waitlist-firstwin` mints three premium invite codes.
Publishing those on the same router as `/waitlist/signup` would hand the
admission system to anyone who can POST. They live behind
`internal_invoke`, which refuses without a valid shared token — and refuses just
as hard when no token is CONFIGURED, because an unset credential meaning
"allow everyone" is the `Default: ""` anti-pattern in infra/CLAUDE.md wearing a
different hat.
"""

import hmac
import json


# ─── the route table ─────────────────────────────────────────────────────────
#
# Transcribed from the RouteKey entries in cello-waitlist.yaml. This is the one
# place the port could silently change behaviour: a path that resolves to a
# different handler than API Gateway sent it to is a behaviour change wearing a
# port's clothes. Longest prefix wins so /waitlist/auth/* cannot be captured by
# a shorter /waitlist entry.
PUBLIC_ROUTES = {
    "/waitlist/signup": "waitlist-signup",
    "/waitlist/auth/request": "waitlist-auth",
    "/waitlist/auth/verify": "waitlist-auth",
    "/waitlist/auth/session": "waitlist-auth",
    "/waitlist/auth/logout": "waitlist-auth",
    "/waitlist/auth/resend": "waitlist-auth",
    "/waitlist/unsubscribe": "waitlist-auth",
    "/waitlist/survey": "waitlist-actions",
    "/waitlist/readiness": "waitlist-actions",
    "/waitlist/interview-commit": "waitlist-actions",
    "/waitlist/post-url": "waitlist-actions",
    "/waitlist/content-alerts": "waitlist-actions",
    "/gallery/receipts": "waitlist-gallery",
    "/gallery/publish": "waitlist-gallery",
}

# Reachable ONLY through internal_invoke. Never added to PUBLIC_ROUTES.
#
# Two groups, one rule. The first five had NO trigger on AWS — IAM-gated invoke
# only. The last three were driven by EventBridge schedules, which on GCP become
# Cloud Scheduler jobs, and a scheduler reaches a service the same way anyone
# else does: over HTTP. Left public, `/waitlist-email` would let a stranger
# drive the mail queue and `/waitlist-outreach` would let them grant invite
# codes, so they sit behind the same token.
#
# Everything that is neither a public route nor the SNS bounce URL is here. A
# handler that is not in one of those three places is not reachable at all,
# which is the property that makes this list worth reading as a whole.
INTERNAL_TARGETS = frozenset(
    {
        # no trigger on AWS: IAM-gated lambda:InvokeFunction only
        "waitlist-migrate",
        "waitlist-waves",
        "waitlist-gate",
        "waitlist-firstwin",
        "waitlist-utm",
        # EventBridge schedules -> Cloud Scheduler, over HTTP
        "waitlist-email",
        "waitlist-feedback",
        "waitlist-outreach",
    }
)


def resolve_public(path):
    """The handler that owned this path on API Gateway, or None.

    None is a real answer — the caller renders a 404 naming the path. It is not
    a fallback to a default handler, because a mistyped route silently served by
    the wrong Lambda is worse than a 404.
    """
    if not path:
        return None
    exact = PUBLIC_ROUTES.get(path)
    if exact:
        return exact
    # `/gallery/receipts/{hash}` is a RouteKey too. Longest prefix, so a future
    # `/waitlist/auth/...` cannot be swallowed by a shorter registered prefix.
    for route in sorted(PUBLIC_ROUTES, key=len, reverse=True):
        if path.startswith(route + "/"):
            return PUBLIC_ROUTES[route]
    return None


# ─── request adapter ─────────────────────────────────────────────────────────


def build_event(*, method, path, headers, query, body):
    """An API Gateway v2 payload-format-2.0 event, from a real HTTP request.

    BOTH CASINGS OF EVERY HEADER. The handlers read `headers.get("origin") or
    headers.get("Origin")` — a habit from 1.0, where casing was not normalised.
    Supplying only the lowercase form would work for most of them and fail for
    whichever one happens to check the capitalised spelling first, which is the
    kind of difference that shows up as one broken CORS preflight in production.

    COOKIES GO IN THE TOP-LEVEL LIST, and duplicates are preserved. Format 2.0
    lifts them out of `headers`, `session_tokens_from` reads that list first, and
    a browser legitimately sends several cookies under one name. De-duplicating
    here would recreate the documented bug where one stale cookie masks the live
    session sitting behind it — the database decides which is real, not us.
    """
    normalised = {}
    for key, value in (headers or {}).items():
        normalised[key.lower()] = value
        normalised[key.title()] = value

    raw_cookie = normalised.get("cookie") or normalised.get("Cookie") or ""
    cookies = [part.strip() for part in raw_cookie.split(";") if part.strip()]

    return {
        "version": "2.0",
        "requestContext": {"http": {"method": method, "path": path}},
        "headers": normalised,
        "queryStringParameters": dict(query or {}),
        "cookies": cookies,
        "body": body,
        "isBase64Encoded": False,
    }


# ─── response adapter ────────────────────────────────────────────────────────


def to_http(result):
    """`(status, header_pairs, body)` from a handler's returned dict.

    HEADER PAIRS, NOT A DICT, because of `cookies`. API Gateway turns each entry
    of the 2.0 `cookies` list into its own `Set-Cookie` header, and Set-Cookie is
    the one header that must not be folded into a single comma-joined value —
    RFC 6265 gives it no list syntax, and a browser handed `a=1, b=2` stores one
    malformed cookie.

    `waitlist-auth` is the only handler that returns `cookies`, and it returns it
    on exactly the path that issues a session. A router that copied statusCode,
    headers and body — the obvious three — and dropped this would mint sessions
    the browser never receives. Nothing raises; the user simply cannot stay
    signed in, which reads as a credential problem and is a plumbing one. This
    already happened once on the request side (see _session.py) and cost days.
    """
    # TWO RETURN SHAPES, and `statusCode` is the discriminator.
    #
    # The four HTTP-facing handlers answer an API Gateway envelope
    # ({statusCode, headers, body, cookies}). The ones that had no HTTP trigger
    # return their result DIRECTLY, because `lambda.invoke` delivered whatever
    # they returned: `waitlist-email` returns
    # {"sent": n, "skipped": n, "failed": n, "retired": n} and its re-engagement
    # sweep returns {"re_engage_enqueued": n}.
    #
    # Reading a bare payload as an envelope finds no `body` key and answers an
    # EMPTY 200 — the counts are discarded and a successful send is
    # indistinguishable from a no-op. Observed on the deployed service: the
    # one-minute drain answered 200 with nothing in it.
    #
    # The discriminator is `statusCode` rather than the presence of `body`,
    # because a handler may legitimately answer 204 with an empty body and that
    # must not be mistaken for a payload and echoed back as JSON.
    if "statusCode" not in result:
        return 200, [("content-type", "application/json")], json.dumps(result)

    status = result.get("statusCode", 200)
    pairs = [(k, v) for k, v in (result.get("headers") or {}).items()]
    for cookie in result.get("cookies") or []:
        pairs.append(("Set-Cookie", cookie))
    return status, pairs, result.get("body", "")


# ─── the internal surface ────────────────────────────────────────────────────


def _refuse(status, code, message):
    return status, [("content-type", "application/json")], json.dumps({"error": code, "message": message})


def internal_invoke(name, *, payload, presented_token, expected_token, dispatch=None):
    """Reach a handler that had no HTTP trigger on AWS, behind a shared token.

    FAIL CLOSED ON EVERY PATH, including the one where the guard itself is
    unconfigured. `expected_token` being absent means the service was deployed
    without its credential — that is a broken deployment, and answering 503 says
    so. Treating it as "no token required" would silently publish wave assembly
    and token burning to the internet, and the deployment would look healthy.

    The comparison is `hmac.compare_digest`. `==` on a secret returns as soon as
    two bytes differ, so a patient caller recovers the token one character at a
    time from the timing.
    """
    if expected_token is None or expected_token == "":
        return _refuse(
            503,
            "internal_token_not_configured",
            "This service has no internal token configured, so it cannot authenticate "
            "internal calls. Refusing rather than admitting: an unset credential is a "
            "broken deployment, not an open door.",
        )

    if not presented_token:
        return _refuse(
            401,
            "internal_token_missing",
            "No internal token was presented. This endpoint is not public.",
        )

    if not hmac.compare_digest(str(presented_token), str(expected_token)):
        return _refuse(401, "internal_token_invalid", "The internal token presented is not valid.")

    if name not in INTERNAL_TARGETS:
        return _refuse(
            404,
            "unknown_internal_target",
            f"No internal handler named {name!r}. Known targets: "
            f"{', '.join(sorted(INTERNAL_TARGETS))}.",
        )

    if dispatch is None:
        return _refuse(
            500,
            "no_dispatcher",
            f"{name} authenticated but no dispatcher was supplied to route it.",
        )

    return to_http(dispatch(name, payload))
