"""The immediate-drain nudge.

Its whole reason to exist is latency: the dispatcher runs on rate(1 minute) at a
fixed offset, so a sign-in link enqueued at 05:30:33 was not sent until 05:31:30.
These cover the two things that make it safe to bolt onto a request path — it
must never raise, and it must never be silent about not working.
"""

import pytest

# No Postgres anywhere in this file. See waitlist_testdb.clean_tables.
pytestmark = pytest.mark.no_database

import _dispatch


class FakePost:
    """Stands in for the daemon thread's urlopen, run INLINE.

    Threading is what the production path buys and it is not what these assert.
    Running the post inline keeps the log assertions deterministic; that the
    caller does not wait is covered separately, by inspecting the target.
    """

    def __init__(self, err=None):
        self.calls = []
        self.err = err

    def __call__(self, request, timeout=None):
        self.calls.append({"url": request.full_url, "headers": dict(request.headers), "timeout": timeout})
        if self.err:
            raise self.err
        return _Response()


class _Response:
    status = 202

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def collector():
    events = []

    def log(event, correlation_id, **fields):
        events.append(event)

    return events, log


def test_it_posts_to_the_email_service_without_the_caller_waiting(monkeypatch):
    """The AWS version used InvocationType="Event", which returned as soon as
    the request was accepted. The HTTP equivalent must not wait for the RESPONSE
    — that response IS the drain, SES calls included, on the request path of
    somebody waiting for a sign-in link."""
    post = FakePost()
    monkeypatch.setattr(_dispatch, "EMAIL_SERVICE_URL", "https://waitlist.example")
    monkeypatch.setattr(_dispatch, "INTERNAL_TOKEN", "s3cret")
    monkeypatch.setattr(_dispatch.urllib.request, "urlopen", post)
    events, log = collector()

    assert _dispatch.nudge_dispatcher("cid", log) is True
    _join_nudge_threads()

    assert post.calls[0]["url"] == "https://waitlist.example/internal/waitlist-email"
    # The internal surface refuses an unauthenticated call, so the nudge must
    # carry the token or it earns a 401 and the mail waits for the schedule.
    assert post.calls[0]["headers"]["X-cello-internal-token"] == "s3cret"
    assert "waitlist.email.nudge.sent" in events


def test_the_caller_is_not_blocked_by_a_slow_drain(monkeypatch):
    """The whole point. A drain that takes ten seconds must not add ten seconds
    to the signup response."""
    import threading as _t

    started = _t.Event()
    release = _t.Event()

    def slow(request, timeout=None):
        started.set()
        release.wait(5)
        return _Response()

    monkeypatch.setattr(_dispatch, "EMAIL_SERVICE_URL", "https://waitlist.example")
    monkeypatch.setattr(_dispatch, "INTERNAL_TOKEN", "s3cret")
    monkeypatch.setattr(_dispatch.urllib.request, "urlopen", slow)
    _, log = collector()

    assert _dispatch.nudge_dispatcher("cid", log) is True  # returns while it hangs
    assert started.wait(2), "the post never started"
    release.set()
    _join_nudge_threads()


def test_a_failed_nudge_never_raises_into_the_request(monkeypatch):
    """The mail is not lost — the row is committed and the scheduled drain takes
    it within a minute. Losing the sign-in response over a failed optimisation
    would turn a slow link into no link at all."""
    monkeypatch.setattr(_dispatch, "EMAIL_SERVICE_URL", "https://waitlist.example")
    monkeypatch.setattr(_dispatch, "INTERNAL_TOKEN", "s3cret")
    monkeypatch.setattr(_dispatch.urllib.request, "urlopen", FakePost(err=RuntimeError("refused")))
    events, log = collector()

    _dispatch.nudge_dispatcher("cid", log)
    _join_nudge_threads()

    assert "waitlist.email.nudge.failed" in events


def test_missing_configuration_is_reported_rather_than_passed_over(monkeypatch):
    """Silence here would be indistinguishable from a working nudge, which is
    how a minute of latency stayed unattributable in the first place."""
    monkeypatch.setattr(_dispatch, "EMAIL_SERVICE_URL", None)
    events, log = collector()

    assert _dispatch.nudge_dispatcher("cid", log) is False
    assert "waitlist.email.nudge.unconfigured" in events


def test_a_missing_internal_token_is_named_here_not_left_to_earn_a_401(monkeypatch):
    """Posting without the token burns a thread to be refused, and the refusal
    would name the email service rather than the missing configuration."""
    monkeypatch.setattr(_dispatch, "EMAIL_SERVICE_URL", "https://waitlist.example")
    monkeypatch.setattr(_dispatch, "INTERNAL_TOKEN", None)
    events, log = collector()

    assert _dispatch.nudge_dispatcher("cid", log) is False
    assert "waitlist.email.nudge.unconfigured" in events


def _join_nudge_threads():
    import threading as _t

    for t in _t.enumerate():
        if t.name == "email-nudge":
            t.join(timeout=5)
