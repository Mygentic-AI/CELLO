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

# Per address, per window, counted in the same `auth_link_requests` table /auth
# uses, so every door shares one budget and they cannot be played off against
# each other. Without a limit these endpoints are an open mail cannon: point one
# at an address you do not own and send it a message from our domain per
# request until the sending reputation is gone.
RESEND_LIMIT = 3
RESEND_WINDOW_MINUTES = 15


def resend_link(cur, user, correlation_id, log):
    """Queue the right mail for `user`. Returns what was sent.

      "confirm"    — signed up, never clicked. Re-sending IS the remedy:
                     e1_confirm is enqueued exactly once at signup and its token
                     lasts 24 hours, so without this anyone who missed that
                     window is stranded permanently.
      "signin"     — already confirmed. What they are asking for is a way back
                     in, not another confirmation of something already true.
      "suppressed" — unsubscribed or bounced. NOTHING is sent and nothing is
                     re-enrolled; suppression is one-way. The caller must say so
                     rather than point them at an inbox that will stay empty.

    A throttled request returns the kind ALREADY in their inbox rather than a
    fourth outcome — a link was genuinely sent moments ago, so "check your
    inbox" is still true and nobody is told to do something useless.
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
        % ("%s", RESEND_WINDOW_MINUTES),
        (user["email"],),
    )
    throttled = cur.fetchone()["n"] >= RESEND_LIMIT
    cur.execute(
        "INSERT INTO auth_link_requests (email_requested) VALUES (%s)", (user["email"],)
    )

    if throttled:
        log(
            "waitlist.resend.withheld",
            correlation_id,
            waitlistId=str(user_id),
            reason="rate_limited",
        )
        return kind

    if kind == "signin":
        # Burn any earlier unused link first, so N requests do not leave N-1
        # live credentials for one person. e_magic_link RENDERS a token it does
        # not mint — enqueueing the job without one sends a mail with no link.
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
        # e1_confirm mints its own 24-hour token at send time.
        template = "e1_confirm"

    cur.execute(
        "INSERT INTO email_jobs (user_id, template, scheduled_at) VALUES (%s, %s, now())",
        (user_id, template),
    )
    log("waitlist.resend.queued", correlation_id, waitlistId=str(user_id), template=template)
    return kind
