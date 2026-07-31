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

ON GCP THIS IS AN HTTP POST, not a Lambda invoke (DOD-GCP-ROUTER-1). The shape
of the guarantee is unchanged and so is every log event; only the transport
moved. What needed care is the "fire and forget" half. `InvocationType="Event"`
returned as soon as AWS accepted the request — it never waited for the drain.
The naive HTTP translation waits for the RESPONSE, which is the drain: SES calls
and all, on the request path of somebody waiting for a sign-in link. That would
not move the delay, it would add it.

So the POST runs on a daemon thread and the caller returns immediately. The
return value therefore means "handed off", and the outcome is logged from the
thread under the same two event names as before — a nudge that fails still says
so, which is the property that stopped the latency being unattributable.
"""

import json
import os
import threading
import urllib.error
import urllib.request

# The service's own base URL. On Cloud Run the email drain is a path on the same
# service, so this normally points at itself — which is fine and is exactly what
# the Lambda did (one function invoking another in the same account).
EMAIL_SERVICE_URL = os.environ.get("WAITLIST_EMAIL_SERVICE_URL")
INTERNAL_TOKEN = os.environ.get("INTERNAL_INVOKE_TOKEN")

# Generous, because it only bounds the DAEMON thread — no caller waits on it.
# Its job is to stop a wedged connection leaking a thread per signup.
NUDGE_TIMEOUT_SECONDS = 30


def _post(url, correlation_id, log):
    request = urllib.request.Request(
        url,
        data=json.dumps({"action": "drain"}).encode(),
        headers={"content-type": "application/json", "x-cello-internal-token": INTERNAL_TOKEN or ""},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=NUDGE_TIMEOUT_SECONDS) as response:
            log("waitlist.email.nudge.sent", correlation_id, url=url, status=response.status)
    except Exception as err:  # noqa: BLE001 — a failed nudge must never escape this thread
        # The mail is NOT lost: the row is committed and the scheduled drain will
        # take it within a minute. Losing the sign-in response over a failed
        # optimisation would turn a slow link into no link at all.
        log("waitlist.email.nudge.failed", correlation_id, url=url, error=str(err))


def nudge_dispatcher(correlation_id, log):
    """Hand the drain off without waiting for it. Returns whether it was sent.

    Concurrency with the scheduled run is safe: claim_jobs uses
    FOR UPDATE SKIP LOCKED, and test_two_simultaneous_dispatcher_runs_send_each_email_once
    covers exactly this.
    """
    if not EMAIL_SERVICE_URL:
        # Unset means the caller was deployed without the wiring. Say so —
        # silence here would look identical to a working nudge.
        log("waitlist.email.nudge.unconfigured", correlation_id)
        return False

    if not INTERNAL_TOKEN:
        # The internal surface refuses an unauthenticated call, so posting
        # without a token would burn a thread to earn a 401. Naming it here
        # points at the missing configuration instead of at the email service.
        log("waitlist.email.nudge.unconfigured", correlation_id, reason="no_internal_token")
        return False

    url = EMAIL_SERVICE_URL.rstrip("/") + "/internal/waitlist-email"
    threading.Thread(
        target=_post, args=(url, correlation_id, log), daemon=True, name="email-nudge"
    ).start()
    return True
