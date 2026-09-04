---
name: 001-XPROFILE — An operator connects X and the portal holds their profile
type: micro-work-order
date: 2026-09-04
status: open
description: >
  OAuth 2.0 authorization-code with PKCE against X, one authenticated profile read carrying every
  field we mint from, normalized and persisted as an XProfileSnapshot. The token is discarded.
  Refresh is explicit, weekly, and billed; signing in never touches the X API.
  Source: DOD-M10C-XPROFILE-1.
---

# **<ins>MICRO</ins>** WORK ORDER 001-XPROFILE — connect X, hold the profile

> ## THE RULES OF A MICRO WORK ORDER
>
> 1. **Read [[M10C-PROCEDURE]] IN FULL before you start.** It is the complete working discipline for
>    this milestone and it binds you — the gate, the stop rules, the core loop, reviewer dispatch,
>    the blocking invariants, cost discipline, and the made-to-fail requirement.
>    **Do not read `M10C-DEFINITION-OF-DONE.md` or `M10C-BUILD-JOURNAL.md`** — this order carries
>    everything you need from them, including the contract you must not change.
> 2. **MICRO means small.** One mission. Follow it to its end. **Never grow the mission.**
> 3. **Found something else?** Write it under *Newly discovered* at the foot of this file and
>    **keep going**. Do not fix it. Do not open a line for it. Do not investigate it.
> 4. **500 lines, hard cap.** Minimal without omitting anything. No scratchpad.
> 5. **Standard procedure still applies:** implement → review (`cello-unit-reviewer`) → fix every
>    finding → commit. Commit per fix, push after every commit. **Closing a unit means flipping
>    this file's `status:` frontmatter to `complete` in the SAME commit as the verdict.**
> 6. **Done is done.** When the Definition of Done below is met, stop.

---

## The problem, plainly

An operator wants to show counterparties that they have a long-standing X account. Today the portal
has no way to learn anything about their X presence at all.

GitHub solved the same problem in two steps: prove ownership over OAuth, then read the public
profile with no credentials. **X cannot be done that way, and the difference is the whole of this
order.** X has no anonymous profile read. The only way to learn who authorized is
`GET /2/users/me`, authenticated, and it is billed.

---

## ⚠️ THREE THINGS THAT WILL COST REAL MONEY IF YOU GET THEM WRONG

X has no free tier. Reads are billed against a prepaid balance Andre tops up.

1. **No test may contact `api.x.com` or `x.com`.** Ever, at any level, not even once to check. The
   code takes an injected `fetchImpl` and tests pass a double.
2. **Signing in must never trigger an X read.** `runLoginMint` in
   `cello-portal/src/server/trust/login-mint.ts` re-mints phone, email and track record on every
   sign-in. It is the natural place someone would hook this up, and doing so would bill a penny per
   login per operator forever with nothing reporting it. **Do not touch that file.**
3. **One read per connect, carrying every field.** X bills per *resource returned*, not per field —
   one user object is one resource however much you ask for. So a flow that fetches the handle and
   comes back later for `created_at` pays twice for one operator and gains nothing. One call, all
   fields, always.

---

## ⛔ CONTRACT — DO NOT CHANGE THIS SHAPE

Two other work orders are being written against it **right now, in parallel.** If it looks wrong to
you, stop and say so in *Newly discovered*. Do not adapt it and do not extend it.

```ts
export interface XProfileSnapshot {
  xUserId: string;            // X's stable numeric id, as a string. Survives handle changes.
  username: string;           // handle, no leading @
  createdAt: string;          // ISO 8601, exactly as X returned it
  followers: number;
  following: number;
  posts: number;
  listed: number;
  verifiedFollowers: number;
  identityVerified: boolean;  // X checked a government ID. NEVER the paid blue check.
  protectedAccount: boolean;
  readAt: number;             // epoch SECONDS when we pulled this from X. Not the mint time.
}
```

`readAt` is what lets a later free re-mint state honestly when the figures were measured. It is not
bookkeeping — omit it and the composed claim asserts that six-month-old numbers are current.

---

## The work

1. **`src/server/trust/x.ts`** — mirror `github.ts` in structure, so the next provider has two
   examples of the same shape rather than one of each:
   - `createPkcePair()` → `{ verifier, challenge }`. Verifier 43–128 chars from the unreserved
     alphabet; challenge is `base64url(sha256(verifier))`, unpadded. **PKCE is mandatory at X** and
     a mismatch fails at the token exchange — i.e. *after* the operator has already approved, which
     is the worst place to discover it.
   - `getXAuthUrl(state, challenge, config)` → `https://x.com/i/oauth2/authorize` with
     `response_type=code`, `client_id`, `redirect_uri`, `state`, `code_challenge`,
     `code_challenge_method=S256`, `scope`.
   - **Scopes are `users.read` and `tweet.read`. NOT `offline.access`.** That scope mints a refresh
     token — a stored long-lived credential for reading someone's account — and GitHub's path
     deliberately discards its token immediately (M10-D27). Refresh here means the operator
     re-authorizing, not us holding a key to their profile indefinitely.
   - `exchangeXCodeForProfile(code, verifier, config, deps)` → `XProfileSnapshot`. Token exchange at
     `https://api.x.com/2/oauth2/token`, confidential-client HTTP Basic (`client_id:client_secret`),
     then ONE `GET /2/users/me` with the full `user.fields` list, then normalize. Discard the token.
   - Config from `X_CLIENT_ID` / `X_CLIENT_SECRET`, with the same `env === "local"` placeholder
     fallback `github.ts` uses so local dev runs without credentials.

2. **`cello-portal/test/x-oauth.test.ts`** — tests first, red before implementation, mirroring
   `test/github.test.ts`'s structure. The fetch double records what it was called with, so the
   assertions can be about the *request* (was the verifier sent, was it one call, which fields) and
   not only the parsed result. That is where this order's real risk lives.

3. **Persist the snapshot.** New migration (next free number, currently `0012`) and a store module
   mirroring `src/server/github/store.ts`. One row per account, upserted on every successful pull.
   It holds the whole snapshot, not just the handle — the compose screen renders from it and a free
   re-mint composes from it, so losing it means paying again.

4. **The weekly limit.** One pull per account per 7 days. A named constant with the reason beside
   it — Andre expects to raise it when cost stops mattering, and that must be a one-line edit.
   Enforced server-side, and the *reason* a refused refresh gives must include when it unlocks, not
   just that it was refused.

5. **Routes.** `GET /api/auth/x` (signed-in only; mints state + PKCE verifier, stores both in
   short-lived httpOnly cookies scoped to the callback path, redirects) and
   `GET /api/auth/x/callback` (verifies state, exchanges, persists the snapshot, redirects to the
   compose screen). **The callback does NOT mint.** Minting is order 003's route, triggered by the
   operator pressing a button after they have chosen what to disclose.

6. **Distinguish the failures.** A failed token exchange, a failed profile read, a malformed
   profile and a state mismatch are four different things and the operator-facing outcome must not
   collapse them into "something went wrong". Follow `github/callback/route.ts`'s tag mapping.

---

## Definition of Done

1. Driven end to end **against the fetch double**, the flow produces an `XProfileSnapshot` persisted
   for the account, matching the contract field for field. **This clause is NOT a live run against
   X** — that is `DOD-M10C-XLIVE-1`, it needs credits Andre has to buy, and clause 10 below forbids
   you from making one. Nothing in this order is blocked by that; build and prove it on the double.
2. **The challenge sent is provably the S256 of the verifier sent** — asserted, not assumed. This is
   the clause the whole dance rests on and it fails post-approval, so it gets its own test.
3. **Exactly one call is made to `/2/users/me` per connect, and it requests every contract field.**
   Asserted by counting calls and inspecting `user.fields`. A second read is a doubled bill.
4. `offline.access` is absent from the scopes, and the access token is not persisted anywhere —
   not in the DB, not in a cookie, not in a log.
5. A missing or absent `is_identity_verified` normalizes to `false`. A claim that X verified
   someone's government ID must never be minted from an absent field.
6. A refresh inside the 7-day window is refused server-side with a reason that names when it
   unlocks. Outside the window it succeeds and `readAt` advances.
7. **`login-mint.ts` is unmodified**, and nothing on any sign-in path reaches X. Prove it: sign in
   with the fetch double installed and assert zero calls.
8. Token exchange failure, profile-read failure, malformed profile and state mismatch each produce a
   distinct named outcome.
9. Each of 1–8 has a test, and **each has been made to fail on purpose** — revert the behaviour,
   confirm it reddens, confirm it reddens for the reason you expect.
10. **No test contacts a real X endpoint.** Grep the diff for `api.x.com` and `x.com` outside the
    two URL constants and their assertions.
11. `pnpm run lint` and `pnpm run typecheck` pass. Tests at the smallest scope that covers what you
    touched.
12. `git status --porcelain` clean in `cello-client` and `trustless-cello`.
13. Reviewed by `cello-unit-reviewer`, every finding fixed, verdict quoted below.

**Not in scope, explicitly:** composing any claim text (order 002); the compose screen, the tick
table or the mint route (order 003); GitHub's flow; the account-age calculation, which belongs to
composition and not to the read.

---

## Traps recorded before you start

- **Do not hook X into `runLoginMint`.** Named twice for a reason. It bills on every login.
- **Do not add `offline.access` "so refresh is easier".** It is a stored credential and the design
  says no.
- **Do not fetch the profile twice** — once for identity, once for fields. One call, all fields.
- **Do not store the access token to "save a round trip later".** There is no later; refresh is a
  fresh dance.
- **The verifier cookie must be httpOnly and scoped**, same as the state cookie. It is a
  single-use secret and a readable one hands the exchange to anything running on the page.
- **Do not compute the account age here.** It is derived at mint time from `createdAt`, so that a
  free re-mint months later is still accurate. Freezing it in the snapshot would make every
  re-mint state a stale age.

---

## Review

*(Reviewer verdict, mutation record and gate output go here before `status:` flips to `complete`.)*

---

## Newly discovered

*(One or two lines each. Do not act on them.)*
