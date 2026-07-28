"""The immediate-drain nudge.

Its whole reason to exist is latency: the dispatcher runs on rate(1 minute) at a
fixed offset, so a sign-in link enqueued at 05:30:33 was not sent until 05:31:30.
These cover the two things that make it safe to bolt onto a request path — it
must never raise, and it must never be silent about not working.
"""

import _dispatch


class FakeLambda:
    def __init__(self, err=None):
        self.calls = []
        self.err = err

    def invoke(self, **kwargs):
        self.calls.append(kwargs)
        if self.err:
            raise self.err
        return {"StatusCode": 202}


def collector():
    events = []

    def log(event, correlation_id, **fields):
        events.append(event)

    return events, log


def test_it_invokes_the_dispatcher_asynchronously(monkeypatch):
    fake = FakeLambda()
    monkeypatch.setattr(_dispatch, "EMAIL_FUNCTION", "cello-waitlist-email-dev")
    monkeypatch.setattr(_dispatch, "_client", lambda: fake)
    events, log = collector()

    assert _dispatch.nudge_dispatcher("cid", log) is True
    # Event, NOT RequestResponse. The caller is holding an HTTP response open
    # for someone waiting on a link — blocking it on SES moves the delay rather
    # than removing it.
    assert fake.calls[0]["InvocationType"] == "Event"
    assert fake.calls[0]["FunctionName"] == "cello-waitlist-email-dev"
    assert "waitlist.email.nudge.sent" in events


def test_a_failed_nudge_never_raises_into_the_request(monkeypatch):
    """The mail is not lost — the row is committed and the scheduled drain takes
    it within a minute. Losing the sign-in response over a failed optimisation
    would turn a slow link into no link at all."""
    monkeypatch.setattr(_dispatch, "EMAIL_FUNCTION", "cello-waitlist-email-dev")
    monkeypatch.setattr(_dispatch, "_client", lambda: FakeLambda(err=RuntimeError("throttled")))
    events, log = collector()

    assert _dispatch.nudge_dispatcher("cid", log) is False
    assert "waitlist.email.nudge.failed" in events


def test_missing_configuration_is_reported_rather_than_passed_over(monkeypatch):
    """Silence here would be indistinguishable from a working nudge, which is
    how a minute of latency stayed unattributable in the first place."""
    monkeypatch.setattr(_dispatch, "EMAIL_FUNCTION", None)
    events, log = collector()

    assert _dispatch.nudge_dispatcher("cid", log) is False
    assert "waitlist.email.nudge.unconfigured" in events
