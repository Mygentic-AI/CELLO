"""The capture loop end to end, through the real handlers, in order.

WHY THIS EXISTS. Every unit test passed on 2026-07-27 while the loop was
completely dead: confirming an email landed the user on a sign-in form and
there was no way into the status page at all. Nothing was wrong inside any
handler. What was wrong was the seam — `cookie_from` read `headers["cookie"]`,
and API Gateway payload format 2.0 delivers request cookies in a top-level
`cookies` list — and no test in the suite asked whether the pieces fit
together, because each one built its own event and asserted on its own handler.

So this asks the only question the unit suites structurally cannot: does the
JOURNEY compose? Each step consumes ONLY what the previous step produced. The
signup hands a user to the dispatcher, which mints a token, which verify burns,
which mints a session, which /auth/session reads back using the cookie a
BROWSER would return — name=value, attributes stripped, in the `cookies` array,
exactly as the gateway sends it.

WHAT IT CANNOT PROVE. That the real API Gateway sends this event shape. That
claim is verified against AWS's payload-2.0 reference and by a live `curl -i`
trace, not here. If the shape is ever wrong again, this file is wrong with it —
which is precisely why the live trace stays on the wake-up checklist.
"""

import json
import os
import urllib.parse
import uuid
from pathlib import Path

import pytest

from waitlist_testdb import PGURL, query, load_lambda

LAMBDA_DIR = Path(__file__).resolve().parent
ORIGIN = "https://cello.mygentic.ai"


@pytest.fixture()
def stack(database):
    """The three functions the loop actually runs through."""
    os.environ["DATABASE_URL"] = PGURL
    # The dispatcher refuses to send without a configuration set — set here
    # rather than inherited, so this file passes when run alone.
    os.environ.setdefault("WAITLIST_SES_CONFIG_SET", "cello-journey-test")
    return (
        load_lambda(LAMBDA_DIR / "waitlist-signup", "journey_signup"),
        load_lambda(LAMBDA_DIR / "waitlist-email", "journey_email"),
        load_lambda(LAMBDA_DIR / "waitlist-auth", "journey_auth"),
    )


def event(method, path, *, body=None, params=None, cookies=(), form=None):
    """The shape API Gateway payload format 2.0 actually sends.

    Cookies in the top-level list, NOT in headers. Writing this the convenient
    way is the whole reason the loop shipped broken.
    """
    return {
        "version": "2.0",
        "headers": {"origin": ORIGIN},
        "cookies": list(cookies),
        "requestContext": {"http": {"method": method, "path": path}},
        "body": (
            urllib.parse.urlencode(form)
            if form is not None
            else json.dumps(body)
            if body is not None
            else None
        ),
        "queryStringParameters": params,
    }


class Recorder:
    """Stands in for SES only. Everything else is real."""

    def __init__(self):
        self.sent = []

    def send_raw_email(self, **kwargs):
        self.sent.append(kwargs)
        return {"MessageId": "journey"}


def test_signup_to_a_signed_in_status_page(stack):
    signup, email, auth = stack
    address = f"journey-{uuid.uuid4().hex[:8]}@example.test"

    # 1. Signup.
    result = signup.lambda_handler(
        event("POST", "/waitlist/signup",
              body={"email": address, "anon_id": str(uuid.uuid4()), "touchpoints": []}),
        None,
    )
    assert result["statusCode"] == 200, result["body"]
    user_id = json.loads(result["body"])["waitlist_id"]

    assert query(
        "SELECT count(*) FROM referral_codes WHERE owner_waitlist_user_id = %s", (user_id,)
    )[0][0] == 0, "a code before the address is proven is a credential handed to whoever typed it"

    # 2. The dispatcher sends E1 and mints the confirm token.
    recorder = Recorder()
    email.ses = lambda: recorder
    email.lambda_handler({}, None)
    assert len(recorder.sent) == 1

    live = query(
        "SELECT token FROM auth_tokens WHERE waitlist_user_id = %s AND kind = 'email_verify' "
        "AND used_at IS NULL",
        (user_id,),
    )
    assert len(live) == 1, f"{len(live)} live confirm credentials"
    token = live[0][0]

    raw = recorder.sent[0]["RawMessage"]["Data"]
    raw = raw.decode() if isinstance(raw, bytes) else raw
    # Quoted-printable soft line breaks and =3D escaping, undone — the token is
    # split across lines in a real MIME body.
    assert str(token) in raw.replace("=\n", "").replace("=3D", "="), (
        "the mail must carry the token that was just minted, not a stale one"
    )

    # 3. The click.
    result = auth.lambda_handler(
        event("GET", "/waitlist/auth/verify", params={"token": str(token)}), None
    )
    assert result["statusCode"] == 302
    assert result["headers"]["Location"].endswith("/status?welcome=1")
    assert query(
        "SELECT email_verified FROM waitlist_users WHERE waitlist_id = %s", (user_id,)
    )[0][0] is True
    assert query(
        "SELECT count(*) FROM referral_codes WHERE owner_waitlist_user_id = %s", (user_id,)
    )[0][0] == 1

    set_cookie = result["headers"]["Set-Cookie"]
    assert "Domain=cello.mygentic.ai" in set_cookie, (
        "host-only would leave the cookie on the API host and never reach the site"
    )
    assert result["cookies"] == [set_cookie], "the documented payload-2.0 carrier, byte-identical"

    # 4. THE HOP THAT WAS BROKEN. What the browser sends back is name=value —
    # the attributes are instructions to the browser, not part of the cookie.
    returned = set_cookie.split(";")[0]
    result = auth.lambda_handler(
        event("GET", "/waitlist/auth/session", cookies=[returned]), None
    )
    assert result["statusCode"] == 200, (
        f"the session did not survive the redirect: {result['statusCode']} {result['body']}"
    )
    assert result["headers"]["Access-Control-Allow-Credentials"] == "true"
    assert result["headers"]["Access-Control-Allow-Origin"] == ORIGIN, (
        "a wildcard origin is ignored when credentials are included"
    )

    session = json.loads(result["body"])
    assert session["email"] == address
    assert session["queue_position"] is not None, "a confirmed member is in the queue"
    assert session["referral_code"], "and has a working referral link"


def test_the_same_address_typed_again_is_offered_a_way_back_in(stack):
    """The re-entry path, from the same starting point as a real visitor: the
    only URL they remember, with an address we already hold."""
    signup, email, auth = stack
    address = f"return-{uuid.uuid4().hex[:8]}@example.test"
    body = {"email": address, "anon_id": str(uuid.uuid4()), "touchpoints": []}

    signup.lambda_handler(event("POST", "/waitlist/signup", body=body), None)

    # Unconfirmed: the confirm mail again, which IS the remedy.
    result = signup.lambda_handler(event("POST", "/waitlist/signup", body=body), None)
    assert result["statusCode"] == 200
    assert json.loads(result["body"])["sent"] == "confirm"

    # Confirm, then ask again: now the answer is a way back in, not another
    # confirmation of something already true.
    recorder = Recorder()
    email.ses = lambda: recorder
    email.lambda_handler({}, None)
    token = query(
        "SELECT t.token FROM auth_tokens t JOIN waitlist_users u ON u.waitlist_id = t.waitlist_user_id "
        "WHERE u.email = %s AND t.kind = 'email_verify' AND t.used_at IS NULL",
        (address,),
    )[0][0]
    auth.lambda_handler(event("GET", "/waitlist/auth/verify", params={"token": str(token)}), None)

    result = signup.lambda_handler(event("POST", "/waitlist/signup", body=body), None)
    assert json.loads(result["body"])["sent"] == "signin"


def test_a_dead_link_leads_somewhere(stack):
    """Every failure on this route is rendered by a browser as the entire
    outcome of a click, so none of them may be a JSON envelope."""
    signup, email, auth = stack
    address = f"dead-{uuid.uuid4().hex[:8]}@example.test"
    signup.lambda_handler(
        event("POST", "/waitlist/signup",
              body={"email": address, "anon_id": str(uuid.uuid4()), "touchpoints": []}),
        None,
    )
    recorder = Recorder()
    email.ses = lambda: recorder
    email.lambda_handler({}, None)
    token = query(
        "SELECT t.token FROM auth_tokens t JOIN waitlist_users u ON u.waitlist_id = t.waitlist_user_id "
        "WHERE u.email = %s",
        (address,),
    )[0][0]

    auth.lambda_handler(event("GET", "/waitlist/auth/verify", params={"token": str(token)}), None)
    reused = auth.lambda_handler(
        event("GET", "/waitlist/auth/verify", params={"token": str(token)}), None
    )

    assert reused["statusCode"] == 410
    assert reused["headers"]["Content-Type"].startswith("text/html")
    assert "/auth/resend" in reused["body"], "a dead end must offer a way out"

    # And the button works: it queues a real mail for the right person.
    resend = auth.lambda_handler(
        event("POST", "/waitlist/auth/resend", form={"token": str(token)}), None
    )
    assert resend["statusCode"] == 200
    assert query(
        "SELECT count(*) FROM email_jobs j JOIN waitlist_users u ON u.waitlist_id = j.user_id "
        "WHERE u.email = %s AND j.template = 'e_magic_link'",
        (address,),
    )[0][0] == 1
