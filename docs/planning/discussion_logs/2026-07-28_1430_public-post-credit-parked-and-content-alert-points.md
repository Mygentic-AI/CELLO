---
name: public-post-credit-parked-and-content-alert-points
type: discussion
date: 2026-07-28
topics: [m11, waitlist, points, public-post, content-alerts, verification, ops-dashboard]
description: Why the comment-for-points mechanic is parked rather than dead, what is already built for it, the evidence its verification premise holds, and the content-alert opt-in becoming a paid action.
---

# Public-post credit: parked, not dead

## The idea

When CELLO publishes something, a waitlist member who **comments on it** earns
points. Andre's framing: "if you comment on that article, then we credit you 10
points. The difficulty with this mechanism is how to know if that person has
commented or not."

Two things were settled immediately:

- **Comments on CELLO's own blog or home page are worthless.** "Meaningless,
  utterly meaningless, couldn't give a shit." There is no comment system to build
  and none should be built. The value is in the comment appearing where other
  people are, not on our own property.
- **It has to be somewhere substantial.** A comment on the author's own obscure
  blog does not count either.

So the mechanic is: comment on our post **on social**, then claim it.

## Almost all of it was already built

This was the surprise, and it is worth recording because two separate agents in
one day assumed otherwise and one of them (me) said out loud that there was
nowhere to review submissions.

Already live:

| Piece | Where |
|---|---|
| `POST /waitlist/post-url` | `infra/lambda/waitlist-actions/handler.py` |
| Platform derived from host; unsupported hosts REFUSED, never guessed | same |
| Duplicate URL rejected per user | `post_review_queue` UNIQUE (user, url) |
| Review queue with outcome/timestamp consistency CHECK | `0008_p1_social_profiles_and_post_review.sql` |
| Anti-farming: one handle → one waitlist entry, one entry → one handle per platform | `waitlist_social_profiles` UNIQUE constraints |
| **Operator review UI** | `ops-dashboard` → `src/app/posts/page.tsx` |
| **Approval awards 15, atomically, refusing double-credit** | `ops-dashboard` → `src/server/actions.ts` → `reviewPost` |
| Cap of 45 enforced by the ledger trigger | `0003` + `POINT_CAPS` |

**The 15 points per post is shipped, not inferred.** 15 × 3 = the 45 cap, so
three posts is the ceiling by construction.

**The only missing piece is a way to submit.** There is no `submitPost` in
`corp-cello-site/src/lib/waitlistApi.ts` and no UI anywhere that reaches the
endpoint. Everything downstream of submission exists and works.

### Why I got this wrong

I grepped `trustless-cello/infra/lambda` for anything awarding `public_post`,
found nothing, and concluded the queue was a dead end. The ops dashboard is a
**separate repository** that talks to the portal database directly, and I never
opened it. The README's first paragraph says it exists to "review submitted
posts". Searching one repo and concluding across three is the error.

## The verification premise — tested, and it holds

Andre's real objection, and the right one: before building anything, is this even
achievable? "You have to give me the URL that doesn't point to my post but points
to the comment. Some social media allows you to share a URL that points at the
comment, others do not."

If a member cannot produce a URL that lands on **their comment**, the reviewer
cannot verify anything and the whole mechanic collapses.

Checked, 2026-07-28:

- **X** — a reply is itself a post with its own URL. Works by construction.
- **Reddit** — comments have permalinks.
- **LinkedIn** — supports "Copy link to comment" from the three-dot menu on a
  comment; the link lands on the comment and highlights it.
  ([source](https://www.lindseygamble.com/blog/linkedin-now-lets-users-copy-share-links-to-specific-comments))

All three of the platforms already in `PLATFORM_HOSTS` can produce a
comment-level URL. **The premise holds.**

`PLATFORM_HOSTS` already covers `x.com`, `twitter.com`, `reddit.com`,
`old.reddit.com`, `linkedin.com` and their `www` variants. Known gaps:
`m.reddit.com`, `mobile.twitter.com`, `lnkd.in`. These are refused with a clear
message rather than mis-attributed, so the failure is honest — but they should be
added whenever this is picked up.

## Extensibility is more expensive than it looks

Andre: "we also have to be flexible enough that if we choose to post in other
areas, they should be able to comment on that."

Adding a platform is **not** a host-map entry. `platform` is a hard-coded CHECK on
**two** tables — `waitlist_social_profiles` and `post_review_queue` both pin
`('x', 'reddit', 'linkedin')`. So every new platform costs a migration plus a code
change plus a deploy.

If posting beyond those three is expected, that CHECK should become a lookup
table, so adding a platform is a row rather than a schema change. Not done — it
is only worth doing at the same time as the submit UI.

## Decision: parked

The remaining work is genuinely small — a submit card, one column for the claimed
username, that column shown in the ops table, four extra hosts. Perhaps an hour
across three repos and two deploys.

It is parked anyway, and the reason is triage rather than difficulty. Nobody is
ruined at launch by being unable to earn points for a comment; it is squarely
forgivable. Andre: "the waitlist has dominated far too much programming time."
The expensive parts are already built and the premise is now validated in
writing, so nothing decays by waiting.

**Explicitly dropped for now:** alerting on a new submission. Telegram via the
ops-agent was considered and rejected as premature — it would need a flag on the
onboarding bot, or a separate staff bot. "It's not like I'm overwhelmed yet with
people." Review happens by looking at the operations portal.

### When it is picked up

1. Submit card on `/status`: post URL + **username, required**. Copy must say a
   human reviews it and points land on approval, not instantly.
2. One column on `post_review_queue` for the CLAIMED handle. `handle_verified`
   stays as it is — OAuth-derived, and parked on external app registration.
3. Show that claimed handle in the ops review table so it can be checked against
   the linked comment.
4. Add the missing hosts.

## A latent hazard worth remembering

`ops-dashboard/src/server/db.ts` documents the dashboard as using a RESTRICTED
role with write access to `post_review_queue`, `email_jobs`, `telegram_accounts`,
`waitlist_tokens` and some `waitlist_users` columns. **`points_ledger` is not on
that list.**

Verified 2026-07-28: no such restricted role exists in the database. Only
`portal_admin` holds grants on `points_ledger`, so the dashboard runs as
`portal_admin` and approvals award correctly **today**.

If that restricted role is ever created as documented, every approval will burn
the queue row and then fail to insert the ledger entry — and because the page
lists only unreviewed rows, the submission disappears with no points and no way
back. `reviewPost` already distinguishes a cap violation from other errors, so it
will surface rather than lie, but the row is still gone. Whoever implements that
role must grant INSERT on `points_ledger` in the same change.

# Content alerts became a paid action

Separately, and shipped the same day.

The content-alert opt-in was the only thing on the status page with nothing
attached to it, sitting under a run of cards that all awarded something — while
asking for **more** than any of them: up to two emails a day during launch.

It now pays **10 points, once, on opt-in** (`0023_content_alerts_points.sql`).

Two design points:

- **Once per user, enforced by the database.** The opt-in is a toggle attached to
  an award, which is the dangerous shape — off/on/off/on would pay every time and
  make the balance a function of how many times someone clicked a checkbox.
  `content_alerts` joins the partial unique index from `0009`, so the second
  insert fails in the database however the endpoint is called.
- **No claw-back on opting out.** The ledger is append-only by design (`0003`) and
  the cap triggers assume rows are never removed. Making the balance
  non-monotonic over ten points is the worse trade. Someone can opt in, take the
  credit and opt out — and cannot be paid again for opting back in, which is the
  part that matters.

A test asserts the points actually **land**, not merely that the call returned:
`award` catches `CheckViolation` and returns 0, so a missing reason in the CHECK
would have paid nothing while every existing content-alert test stayed green.

## Still stranded

`confirmReadiness()` (+20) exists in `corp-cello-site/src/lib/waitlistApi.ts` and
**nothing calls it**. Twenty points no one can claim, behind a card that does not
exist. Cheaper than the post mechanic and not done either — noted here so it is
not rediscovered a third time.
