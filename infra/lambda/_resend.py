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

# Read from the SAME environment the dispatcher reads, so the "is a mail already
# coming?" question below is answered with the dispatcher's own definition of a
# claimable job. Duplicating the numbers instead of the source is how the two
# would drift into disagreeing about whether a job is alive.
MAX_ATTEMPTS = int(os.environ.get("EMAIL_MAX_ATTEMPTS", "5"))
RECLAIM_AFTER_MINUTES = int(os.environ.get("EMAIL_RECLAIM_AFTER_MINUTES", "15"))


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

    # SERIALISE ON THE USER ROW. Everything below is read-then-write — the rate
    # limit, the token burn, and the "is a mail already coming?" check — and two
    # concurrent callers (a double-submitted form, a resend and a signup racing)
    # would both read the pre-state and both act on it. Verified reachable: two
    # barrier-synchronised calls queued two confirm jobs, which is precisely the
    # dead-link-in-a-sent-mail case the check below exists to prevent.
    #
    # The user row is the natural lock: it is the thing all of this is about,
    # every caller has already selected it, and taking it here rather than in
    # each caller keeps the ordering in one place where a deadlock cannot be
    # introduced by a new call site.
    # RE-READ UNDER THE LOCK. Taking the lock and then deciding from the
    # caller's earlier read is not a serialisation: a confirmation committing in
    # between leaves kind='confirm' for a user who is already verified, and
    # `should_send` does not gate e1_confirm on email_verified, so the mail
    # ships — and burns their live confirm token at send time. That is this
    # module's own "dead link dressed as a welcome". The columns cost nothing;
    # the lock is already being paid for.
    cur.execute(
        "SELECT email_verified, email_status FROM waitlist_users "
        "WHERE waitlist_id = %s FOR UPDATE",
        (user_id,),
    )
    locked = cur.fetchone()
    if locked is None:
        # The row vanished between the caller's read and this lock. Nothing to
        # send to, and nothing to say about it.
        log("waitlist.resend.user_absent", correlation_id, level="WARN", waitlistId=str(user_id))
        return "suppressed"

    kind = "signin" if locked["email_verified"] else "confirm"
    template = "e_magic_link" if kind == "signin" else "e1_confirm"

    if locked["email_status"] != "active":
        log(
            "waitlist.resend.withheld",
            correlation_id,
            waitlistId=str(user_id),
            reason=f"email_status_{locked['email_status']}",
        )
        return "suppressed"

    # ONE CLAIMABLE JOB PER TEMPLATE, per person. Two e1_confirm jobs draining
    # in the same batch is not hypothetical — the budget allows several requests
    # per window, and BATCH_SIZE is 25 — and the dispatcher mints the confirm
    # token at SEND time, burning its predecessors as it goes. So job one mints
    # a token, job two burns it and mints another, and BOTH mails go out: the
    # first carries a link that was dead before it left, and clicking it tells
    # the person "you've already used that link", which they have not. The
    # system lying about what they did is worse than the duplicate mail.
    #
    # Skipping is also the honest answer: a mail for this person IS coming, so
    # "check your inbox" stays true.
    #
    # CLAIMABLE, not `status = 'pending'`. A row in 'sending' is either in
    # flight or waiting to be reclaimed, and BOTH mean a mail is coming — so
    # neither may license queueing another.
    #
    # NO `sent_at` COMPARISON. A first attempt here mirrored the dispatcher's
    # reclaim clause, `sent_at < now() - reclaim`, but with the inequality the
    # other way round — and `<` and `>` partition the 'sending' rows into two
    # disjoint halves. This counted the in-flight half and declared the
    # reclaimable half "no mail coming", which is the precise case the rule
    # exists for: `claim_jobs` commits the 'sending' transition BEFORE the SES
    # call, so a Lambda timeout strands a row, and the outage that strands it is
    # the same one that makes somebody click resend. Both then drained together
    # and the first mail shipped a token the second had already burned.
    #
    # `attempts < MAX_ATTEMPTS` is the one real exclusion: past that a job is
    # unclaimable forever, so treating it as coming would gag the remedy
    # permanently while this function kept answering "check your inbox".
    cur.execute(
        """
        SELECT 1 FROM email_jobs
        WHERE user_id = %s AND template = %s
          AND attempts < %s
          AND status IN ('pending', 'sending')
        """,
        (user_id, template, MAX_ATTEMPTS),
    )
    if cur.fetchone() is not None:
        log(
            "waitlist.resend.already_pending",
            correlation_id,
            waitlistId=str(user_id),
            template=template,
        )
        return kind

    # Count PRIOR requests, then record this one. Inserting first makes the
    # current request count against itself, so a limit of N sends only N-1.
    #
    # Reached only when a mail is actually going to be queued — the
    # already-coming check above returns first — so the budget is spent on
    # SENDS. Counting the repeat clicks instead let five taps of one button
    # burn a whole window while queueing a single mail, and then refuse the
    # person a genuinely new link for fifteen minutes.
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


    cur.execute(
        "INSERT INTO email_jobs (user_id, template, scheduled_at) VALUES (%s, %s, now())",
        (user_id, template),
    )
    log("waitlist.resend.queued", correlation_id, waitlistId=str(user_id), template=template)
    return kind
