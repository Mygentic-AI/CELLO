---
name: 2026-07-27 Waitlist auth flow design and the sign-in death loop
type: discussion
date: 2026-07-27
topics: [m11, waitlist, auth, session, magic-link, flow-design, follow-through]
description: >
  The agreed end-to-end flow design for waitlist signup / confirm / return-visit, and the
  unresolved bug that makes the whole loop untestable: confirming an email lands the user on a
  sign-in page instead of a live session. Follow-through document for compaction.
---

# Waitlist auth flow — agreed design, and the death loop that blocks it

## Why this document exists

Andre spent a day unable to test any M11 feature because the **core capture loop is broken at step
two**. `M11-PROCEDURE` §0a names that loop as the milestone's top severity: *"Signup → E1 → email
verified → queue position visible → referral link working. If broken → top priority. Nothing ships
without this."* It is broken, and three partial fixes shipped without fixing it.

This document records the flow design we agreed, so it is not re-derived, and states precisely what
is known and unknown about the bug.

---

## THE BUG — unresolved, top priority

**Symptom, reproduced by Andre four times:** click **Confirm email** in the E1 mail → land on a page
that asks for your email to sign in. Request a magic link → click it → land on the same sign-in
page. There is no way into the status page at all.

**What was tried and did NOT fix it:** the session cookie set by
`GET api.cello.mygentic.ai/waitlist/auth/verify` carried no `Domain` attribute, making it host-only
to the API host, so the redirect to `cello.mygentic.ai/status` could not carry it. `Domain` is now
set from `WAITLIST_SITE` and the logout cookie matches. **Deployed. Andre retested. Same loop.**

So the cookie domain was *a* defect but is not *the* defect, or not the only one. **Do not assume it
is fixed.** What has NOT been checked:

- Whether the frontend's session probe actually sends the cookie. `src/lib/waitlistApi.ts` uses
  `credentials: "include"` on four fetches — verify the one `/status` uses is among them.
- Whether the API returns `Access-Control-Allow-Credentials: true` **and** a specific
  `Access-Control-Allow-Origin` (a wildcard origin is ignored when credentials are included).
- What `/status` does when the session probe fails — it may redirect to sign-in for any error, not
  only for "no session", which would mask a CORS or 5xx failure as "not logged in".
- Whether the verify redirect is even reaching `/status`, or landing somewhere that redirects on.

**Suggested first move for the next context:** trace one real token end to end with `curl -i` —
verify response headers, then the exact request `/status` makes — before changing anything. Three
fixes have now shipped on hypotheses that were never traced to ground.

---

## THE AGREED FLOW DESIGN (settled with Andre, 2026-07-27)

### The rule that decides everything

**Membership begins at the confirm click.** Queue position, referral code and points all begin
there too. Nothing before that click may claim or grant any of them.

### States

1. **Unknown** — never signed up
2. **Pending** — gave an email, has not clicked confirm. *Not on the list.*
3. **Member, session live**
4. **Member, no session** — returned later or on another device
5. **Admitted** — holds a wave token (later stage)

### Flow A — Sign up
`/waitlist` → email (+ optional name) → "Check your inbox. **You are not on the list until you click
the link.**" State: Pending. No code, no position, no points.

Branch on an email that already exists:
- **Pending** → resend the confirm email. Same message. **Not an error.**
- **Member** → send a **sign-in** link instead, and say so.

*Today this returns 409 "already registered" and dead-ends — the most likely re-entry path is a wall.*

### Flow B — Confirm
- **Valid & unused** → mark confirmed, mint referral code, **create the session**, land on the status
  page in a just-confirmed state (congratulations + position + referral link). **Logged in. Never
  asked to sign in.**
- **Already used** → "already confirmed", offer a sign-in link. **No session** — a replayed link must
  not grant one.
- **Expired (>24h)** → "expired", one button to resend. The token row identifies the user, so **do
  not ask for the email again**.
- **Unknown** → "not valid", plus sign-in.

### Flow C — Coming back (the missing flow)
A returning person goes to **`/waitlist`** — the only URL they will remember. That page must be the
front door for all three cases:
- Session live → "You're on the waitlist — view your status" (server confirms), no signup form
- No session, email is a member → send a **sign-in** link
- No session, email unknown → normal signup

**Therefore the signup form and the sign-in form are ONE form.** The user types an email; the system
decides what to send. Nobody has to know `/auth` exists — nothing links to it today, so "just sign
in" is not a real option for a user.

### Flow D — Sign in
Email → magic link → session → status.
- A **Pending** user requesting sign-in is **also confirmed** by that link — reading the mailbox is
  the same proof. Otherwise clicking the wrong email strands them permanently.
- Unknown email → identical response (no enumeration).

### Flow E — Referral arrival
`?ref=CODE` stored → signup → **credit the referrer at CONFIRMATION, not at signup.** Same rule as
the code itself: unverified signups must not move anyone up the queue, or the queue is farmable.

### Interruptions

| interruption | required behaviour |
|---|---|
| Closes tab after signup | Nothing lost; link valid 24h |
| Never clicks, returns to `/waitlist` | Same email → new confirm email, not an error |
| Confirms after expiry | "Expired" → one click to resend, never re-type the email |
| Confirms twice | "Already confirmed" + sign-in offer |
| Returns days later, no session | `/waitlist` → email → sign-in link |
| Different device | As above |
| Clicks an old sign-in link | Single-use: "already used" + fresh one |

### Sessions and the returning-visitor hint (agreed)

**Two cookies, two jobs:**
1. **Session cookie** — HttpOnly, the real credential, **30 days**. Set identically by confirm and by
   magic-link sign-in; both prove the same thing.
2. **A "this browser has been here" hint** — non-HttpOnly (or localStorage), **carrying no authority
   at all**: no email, no id, no `confirmed:true`. A boolean only. The session cookie is HttpOnly so
   the page cannot read it; the hint is what lets `/waitlist` choose its copy before any network
   call. If forged, the worst outcome is wrong copy — access is still decided server-side.

---

## What was actually shipped today (all live)

| change | state |
|---|---|
| Session cookie `Domain` set from `WAITLIST_SITE` | deployed — **did not fix the loop** |
| Referral code minted at verification, not signup | deployed, verified (signup returns no code) |
| E1 rewritten to a single call to action — no position, no referral link | deployed |
| Referral block removed from `/waitlist` confirmation panel | deployed, verified absent from live JS |
| `"You are not on the waitlist until you click that link"` | deployed |
| Ops dashboard sign-in copy — "authorised", not waitlist wording | committed, **ships on next image build** |

## Not built (Andre's list, still open)

- The congratulations / just-confirmed state (he explicitly forgives this one; the **logged-in** part
  is what matters)
- `/waitlist` as the single front door (session detection + one form deciding confirm-vs-signin)
- 30-day session + the hint cookie
- Sign-in link confirming a Pending user
- Referral credit moved to confirmation
- The `"could not be reached… please try again"` error wording — Andre: never tell a user to retry
  something that cannot help; that text is a log message, not user copy

---

## Infrastructure state (2026-07-27 evening)

- **Infra is being hibernated tonight.** Nothing can be deployed or pushed until wake.
- **RDS rotated `portal_admin` on 2026-07-26** and broke the portal, the ops dashboard and all 13
  waitlist Lambdas — every one held a hand-copied password. Repaired by hand.
  - **Permanent fix written and committed, NOT yet live:** `infra/lambda/_dburl.py` resolves the URL
    from the RDS-managed secret at cold start; the ops-dashboard task definition reads `PGPASSWORD`
    from that secret's `password` key. Needs `PORTAL_DB_SECRET_ID` in the Lambda environments and a
    dashboard deploy.
  - **The URL must keep `?sslmode=no-verify`.** Dropping it while rebuilding the secret is what broke
    TLS and left the old task running with the old password.
- **`operations.cello.mygentic.ai` needs one redeploy after every wake** — its host rule and SNI cert
  live on the portal ALB, which hibernate deletes. Capture/restore was added to hibernate/wake but
  **`infra/scripts/hibernate.sh` currently has uncommitted changes made outside this session** —
  another agent appears to have reorganised it. Do not blindly commit it; diff first.
- **Directory/relay CI is fixed and proven** — smoke test targets `directory-us1.cello.mygentic.ai`
  (survives hibernate). Pipeline `07d82775` went green end to end, all three regions deployed.

## Standing rules in force

- No cron is armed (deleted at Andre's request).
- corp-cello-site pushes to `main` auto-deploy the live public site.
- `latest` npm dist-tag promotion is Andre's, always.
- cello-client ships via `/cello-publish`, never the CodePipeline path.
