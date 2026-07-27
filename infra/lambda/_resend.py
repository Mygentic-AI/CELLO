"""Send a returning visitor whatever they actually need to get back in.

Shared because two doors reach the same decision. The signup form gets an
address it already holds; the verify endpoint gets a token that is expired or
already spent. Both are the same person in the same situation — outside, with
no session — and both must send exactly one of two mails.

Kept in one place so the two cannot drift. The interesting part is the choice,
and it is easy to get subtly wrong in one copy and not the other: re-sending a
confirm mail to somebody already confirmed is a dead link dressed as a welcome,
and sending anything at all to a suppressed address is how a domain ends up on
a blocklist.
"""

import os

# ONE limit for every door, because they all count the same `auth_link_requests`
# rows. Two different numbers over one counter meant ordinary /auth traffic
# silently ate the smaller resend budget, and the resend door stopped working at
# three while telling the caller otherwise.
#
# Without a limit at all these endpoints are an open mail cannon: point one at
# an address you do not own and send it a message from our domain per request
# until the sending reputation is gone. Env-overridable like every comparable
# tunable, so raising it does not need a code deploy.
LINK_LIMIT = int(os.environ.get("AUTH_RATE_LIMIT_MAX", "5"))
LINK_WINDOW_MINUTES = int(os.environ.get("AUTH_RATE_LIMIT_WINDOW_MINUTES", "15"))


def resend_link(cur, user, correlation_id, log):
    """Queue the right mail for `user`. Returns what was sent.

      "confirm"     — signed up, never clicked. Re-sending IS the remedy:
                      e1_confirm is enqueued exactly once at signup and its
                      token lasts 24 hours, so without this anyone who missed
                      that window is stranded permanently.
      "signin"      — already confirmed. What they are asking for is a way back
                      in, not another confirmation of something already true.
      "suppressed"  — unsubscribed or bounced. NOTHING is sent and nothing is
                      re-enrolled; suppression is one-way. The caller must say
                      so rather than point them at an inbox that will stay empty.
      "throttled"   — refused. NOTHING is sent, and this is its OWN outcome.

    THE THROTTLED CASE IS ITS OWN ANSWER, and that is not a detail. It used to
    return "confirm"/"signin" on the reasoning that a link had gone out moments
    ago, so "check your inbox" was still true. It was not: the counter counts
    REQUESTS, not sends, so a refused request could follow a refused request
    indefinitely while every one of them told the person a mail was coming —
    the exact stranding this function exists to remove, re-created one layer
    down. A refused request is also NOT recorded, so the window cannot extend
    itself and a third party cannot exhaust your budget by asking for links to
    your address.
    """
    user_id = user["waitlist_id"]
    kind = "signin" if user["email_verified"] else "confirm"

    if user["email_status"] != "active":
        log(
            "waitlist.resend.withheld",
            correlation_id,
            waitlistId=str(user_id),
            reason=f"email_status_{user['email_status']}",
        )
        return "suppressed"

    # Count PRIOR requests, then record this one. Inserting first makes the
    # current request count against itself, so a limit of N sends only N-1.
    cur.execute(
        """
        SELECT count(*) AS n FROM auth_link_requests
        WHERE lower(email_requested) = lower(%s)
          AND requested_at > now() - interval '%s minutes'
        """
        % ("%s", LINK_WINDOW_MINUTES),
        (user["email"],),
    )
    if cur.fetchone()["n"] >= LINK_LIMIT:
        log(
            "waitlist.resend.withheld",
            correlation_id,
            waitlistId=str(user_id),
            reason="rate_limited",
        )
        return "throttled"

    cur.execute(
        "INSERT INTO auth_link_requests (email_requested) VALUES (%s)", (user["email"],)
    )

    if kind == "signin":
        # Burn the predecessors, so N requests do not leave N-1 live credentials
        # for one person. e_magic_link RENDERS a token it does not mint, so this
        # branch has to create one; e1_confirm mints its own at send time and
        # burns its own predecessors there, where the credential actually comes
        # into existence.
        cur.execute(
            "UPDATE auth_tokens SET used_at = now() "
            "WHERE waitlist_user_id = %s AND kind = 'magic_link' AND used_at IS NULL",
            (user_id,),
        )
        cur.execute(
            "INSERT INTO auth_tokens (waitlist_user_id, kind, expires_at) "
            "VALUES (%s, 'magic_link', now() + interval '15 minutes')",
            (user_id,),
        )
        template = "e_magic_link"
    else:
        template = "e1_confirm"

    # ONE PENDING JOB PER TEMPLATE, per person. Two e1_confirm jobs draining in
    # the same batch is not hypothetical — the budget allows several requests
    # per window — and the dispatcher mints the confirm token at SEND time and
    # burns its predecessors as it does. So job one mints a token, job two burns
    # it and mints another, and BOTH mails go out: the first carries a link that
    # was dead before it left, and clicking it tells the person "you've already
    # used that link", which they have not. The system lying about what they did
    # is worse than the duplicate mail.
    #
    # Skipping is also the honest answer: a mail for this person IS pending, so
    # "check your inbox" stays true.
    cur.execute(
        """
        SELECT 1 FROM email_jobs
        WHERE user_id = %s AND template = %s AND status = 'pending'
        """,
        (user_id, template),
    )
    if cur.fetchone() is not None:
        log(
            "waitlist.resend.already_pending",
            correlation_id,
            waitlistId=str(user_id),
            template=template,
        )
        return kind

    cur.execute(
        "INSERT INTO email_jobs (user_id, template, scheduled_at) VALUES (%s, %s, now())",
        (user_id, template),
    )
    log("waitlist.resend.queued", correlation_id, waitlistId=str(user_id), template=template)
    return kind
