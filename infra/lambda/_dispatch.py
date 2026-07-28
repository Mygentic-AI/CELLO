"""Ask the email dispatcher to drain NOW instead of waiting for its next tick.

THE PROBLEM THIS SOLVES, measured rather than assumed: the dispatcher runs on
`rate(1 minute)` and fires at a fixed offset, so a sign-in link enqueued at
05:30:33 was not sent until 05:31:30 — 57 seconds sitting in a table before SES
even saw it. Average 30s, worst 60s, on top of SES and the recipient's provider.
For a link somebody is sitting and waiting for, that is the difference between
"boom, it's there" and wondering whether the product is broken.

WHY NOT JUST SEND INLINE. The durable job row is worth keeping: it carries the
retry budget, the reclaim-after-15-minutes rule, suppression checks and the
delivery state that bounce handling writes back to. Sending straight from the
request path would either duplicate all of that or quietly do without it. So the
row is still written exactly as before — this only removes the WAIT.

BEST-EFFORT, AND THAT IS LEGITIMATE HERE. Two conditions make a soft failure
honest rather than a silent fallback: the work is already durable (the row is
committed before this is called), and there is a real safety net that runs
without us (the 1-minute schedule). A failed nudge therefore degrades to exactly
today's latency, never to a lost email. It is logged every time, because a
degradation nobody can see is how "the link takes ages" became unattributable in
the first place.
"""

import os

import boto3

EMAIL_FUNCTION = os.environ.get("WAITLIST_EMAIL_FUNCTION")

_lambda = None


def _client():
    global _lambda
    if _lambda is None:
        _lambda = boto3.client("lambda")
    return _lambda


def nudge_dispatcher(correlation_id, log):
    """Fire-and-forget invoke of the email dispatcher. Returns whether it went.

    `InvocationType="Event"` so the caller does not wait for the send — the
    person is waiting on an HTTP response, and blocking it on SES would move the
    delay rather than remove it.

    Concurrency with the scheduled run is safe: claim_jobs uses
    FOR UPDATE SKIP LOCKED, and test_two_simultaneous_dispatcher_runs_send_each_email_once
    covers exactly this.
    """
    if not EMAIL_FUNCTION:
        # Unset means the caller was deployed without the wiring. Say so —
        # silence here would look identical to a working nudge.
        log("waitlist.email.nudge.unconfigured", correlation_id)
        return False

    try:
        _client().invoke(FunctionName=EMAIL_FUNCTION, InvocationType="Event", Payload=b"{}")
        log("waitlist.email.nudge.sent", correlation_id, function=EMAIL_FUNCTION)
        return True
    except Exception as err:  # noqa: BLE001 — a failed nudge must never fail the request
        # The mail is NOT lost: the row is committed and the scheduled drain will
        # take it within a minute. Losing the sign-in response over a failed
        # optimisation would turn a slow link into no link at all.
        log("waitlist.email.nudge.failed", correlation_id, error=str(err))
        return False
