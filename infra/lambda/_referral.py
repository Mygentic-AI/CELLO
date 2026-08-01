"""Paying a referrer, at the moment the referral becomes real.

WHY THIS IS NOT DONE AT SIGNUP. A signup is a typed address and nothing more.
Anyone can type one, so paying out on it makes the queue farmable by exactly
the effort of inventing addresses — and the queue is the whole product here.
Membership begins at the confirm click, and so does the credit for producing a
member.

This is the same rule that already moved referral-code MINTING to verification
(see waitlist-auth). The code and the points it earns are two halves of one
credential; issuing one before proof of mailbox control and the other after
would have been an odd place to draw the line.

Attribution is still recorded at signup — the `referrals` row and
`referred_by_code` — because who introduced whom is a fact about the signup.
Only the payout waits.
"""

import psycopg2
import psycopg2.extras

REFERRAL_POINTS = 10


def award_referrer_for(cur, referred_user_id, correlation_id, log):
    """Pay the referrer of `referred_user_id`, if there is one. Returns points paid.

    Idempotent against the ledger itself, so a second verification of the same
    user cannot pay twice.
    """
    cur.execute(
        "SELECT referrer_user_id, referral_code FROM referrals WHERE referred_user_id = %s",
        (referred_user_id,),
    )
    row = cur.fetchone()
    if row is None:
        return 0

    referrer = row["referrer_user_id"]
    code = row["referral_code"]

    # Already paid for this exact referral. The check is on the ledger rather
    # than on a flag because the ledger is what the points total and the queue
    # position are derived from — a flag could disagree with it.
    cur.execute(
        """
        SELECT 1 FROM points_ledger
        WHERE waitlist_user_id = %s AND reason = 'share_conversion'
          AND meta->>'referred_user_id' = %s
        """,
        (referrer, str(referred_user_id)),
    )
    if cur.fetchone() is not None:
        return 0

    # A referrer already at their 30-point cap is an ordinary, expected outcome.
    # The cap trigger raises, and that must not take down the verification it is
    # attached to. SAVEPOINT scopes the failure to this statement; without it
    # Postgres aborts the whole transaction and every later statement dies with
    # 25P02 — which is how a working cap once rolled a signup back to zero rows.
    cur.execute("SAVEPOINT referral_points")
    try:
        cur.execute(
            """
            INSERT INTO points_ledger (waitlist_user_id, points, reason, meta)
            VALUES (%s, %s, 'share_conversion', %s)
            """,
            (
                referrer,
                REFERRAL_POINTS,
                psycopg2.extras.Json({"referred_user_id": str(referred_user_id), "code": code}),
            ),
        )
        cur.execute("RELEASE SAVEPOINT referral_points")
    except psycopg2.errors.CheckViolation as err:  # the cap, working exactly as designed
        cur.execute("ROLLBACK TO SAVEPOINT referral_points")
        # The cause survives into the log. "check violation" alone would send an
        # operator hunting a schema bug rather than reading a working cap.
        # NOT LOST, and this is worth knowing before anyone raises the cap.
        # The payout is attempted once, on the click that makes the member, so a
        # referrer who is at their ceiling that day forfeits it — there is no
        # retry on later sign-ins, because retrying meant a row lock inside the
        # session transaction and a WARN on every sign-in forever.
        #
        # The `referrals` row survives regardless, and it is the record that
        # this is owed — but the recovery query needs one more clause than it
        # looks like it needs:
        #
        #     referrals r
        #       JOIN waitlist_users u ON u.waitlist_id = r.referred_user_id
        #      WHERE u.email_verified                      -- ← THIS
        #        AND NOT EXISTS (SELECT 1 FROM points_ledger …)
        #
        # WITHOUT `u.email_verified` the result is not the capped set, it is
        # mostly referrals whose referee NEVER CONFIRMED — because the referrals
        # row is written at signup and the payout only ever runs on the confirm
        # click. Paying that set out is precisely the farming this module exists
        # to prevent, arriving as a recovery procedure.
        log(
            "waitlist.referral.points_capped",
            correlation_id,
            level="WARN",
            code=code,
            referrerId=str(referrer),
            detail=str(err).strip(),
        )
        return 0

    log(
        "waitlist.referral.points_awarded",
        correlation_id,
        code=code,
        referrerId=str(referrer),
        referredId=str(referred_user_id),
        points=REFERRAL_POINTS,
        reason="email_verified",
    )
    _notify_referrer(cur, referrer, referred_user_id, code, correlation_id, log)
    return REFERRAL_POINTS


def _notify_referrer(cur, referrer, referred_user_id, code, correlation_id, log):
    """Tell the referrer their code was used. One email per referral.

    ITS OWN EMAIL, NOT PART OF THE POINTS SUMMARY, for two reasons. A referral is
    news about another person rather than about your own clicking, so folding it
    into "your points went up" loses the only interesting part. And it is the one
    award somebody else can trigger repeatedly — routing it through the summary's
    debounce would give that debounce an unbounded input and let a steady trickle
    of sign-ups postpone the summary indefinitely. Keeping them separate is what
    makes the countdown in 0027 provably bounded.

    NOT DEDUPLICATED, deliberately: two people using your code are two events and
    deserve two emails. 0027 gives points_summary a unique index and gives this
    none, which is the difference in intent expressed in the schema.

    ONLY THE FIRST FOUR CHARACTERS of the local part travel, and no domain. The
    referrer can usually recognise someone they actually invited without being
    handed an address they were never given. A local part shorter than four
    characters is therefore disclosed in full — unavoidable if the feature is to
    say anything at all, and worth knowing rather than discovering.

    Best-effort: the referral and its points are already committed, and failing
    to enqueue a notification must not roll them back.
    """
    cur.execute("SAVEPOINT referral_notify")
    try:
        cur.execute(
            """
            INSERT INTO email_jobs (user_id, template, scheduled_at, payload)
            SELECT %s, 'referral_used', now(),
                   jsonb_build_object(
                       'referred_prefix', left(split_part(email, '@', 1), 4),
                       'code', %s::text
                   )
              FROM waitlist_users WHERE waitlist_id = %s
            """,
            (referrer, code, referred_user_id),
        )
        cur.execute("RELEASE SAVEPOINT referral_notify")
        log("waitlist.referral.notified", correlation_id, referrerId=str(referrer))
    except Exception as err:  # noqa: BLE001 — never lose a referral over its notification
        cur.execute("ROLLBACK TO SAVEPOINT referral_notify")
        log(
            "waitlist.referral.notify_failed",
            correlation_id,
            level="ERROR",
            referrerId=str(referrer),
            error=str(err),
        )
