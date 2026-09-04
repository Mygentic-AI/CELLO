---
name: 002-XCOMPOSE — The portal composes both claim texts from the operator's ticks
type: micro-work-order
date: 2026-09-04
status: complete
description: >
  A pure function turning a stored X profile snapshot plus a set of ticked fields into the two
  ComposedSignals, x_anon and x_id. The mandatory floor is structural — it is not a checkbox, so no
  input can express its absence. Identity fields can never enter the anonymous signal.
  Source: DOD-M10C-XCOMPOSE-1.
---

# **<ins>MICRO</ins>** WORK ORDER 002-XCOMPOSE — compose the two signals

> ## THE RULES OF A MICRO WORK ORDER
>
> 1. **Read [[M10C-PROCEDURE]] IN FULL before you start.** It is the complete working discipline for
>    this milestone and it binds you — the gate, the stop rules, the core loop, reviewer dispatch,
>    the blocking invariants, cost discipline, and the made-to-fail requirement.
>    **Do not read `M10C-DEFINITION-OF-DONE.md` or `M10C-BUILD-JOURNAL.md`** — this order carries
>    everything you need from them, including the contracts you must not change.
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

Every trust signal the portal has minted so far says what the portal decided it should say. Phone
says "this operator has a verified phone". GitHub says the account age, the repo count and the
follower count, and the operator gets no say in any of it.

**X is the first type where the operator chooses what their own signal discloses.** They tick fields
from a catalogue we control, and the portal composes the sentence. There is no text editor and there
never will be — the wording is ours, always. The ticks decide only which of our fragments appear.

This order is that composition, and nothing else: a pure function, no network, no database, no UI.

---

## ⛔ CONTRACTS — DO NOT CHANGE THESE

Two other orders are being written against them **right now, in parallel.** If one looks wrong,
stop and say so in *Newly discovered*. Do not adapt and do not extend.

### The input snapshot (order 001 produces this)

```ts
export interface XProfileSnapshot {
  xUserId: string; username: string; createdAt: string;
  followers: number; following: number; posts: number; listed: number;
  verifiedFollowers: number; identityVerified: boolean; protectedAccount: boolean;
  readAt: number;  // epoch SECONDS when we pulled from X. NOT the mint time.
}
```

### Your signature (order 003 calls this)

```ts
export type XFieldKey = "account_age" | "handle" | "x_user_id" | "display_name"
  | "followers" | "verified_followers" | "following" | "posts" | "listed"
  | "identity_verified" | "protected";

export interface XTickSelection { anon: readonly XFieldKey[]; id: readonly XFieldKey[]; }

export function composeXSignals(
  accountId: string,
  snapshot: XProfileSnapshot,
  ticks: XTickSelection,
  opts?: { issuedAt?: number },
): { anon: ComposedSignal; id: ComposedSignal };
```

### The catalogue — `locked` = always present and not a checkbox · `optional` = a checkbox, default OFF · `never` = no checkbox exists

| key | label | anon | id | bullet fragment |
|---|---|---|---|---|
| `account_age` | Account age | locked | locked | *(lead sentence, not a bullet)* |
| `handle` | Handle | never | locked | *(lead)* |
| `x_user_id` | X user ID | never | locked | *(lead)* |
| `display_name` | Display name | **never** | optional | `display name "Acme Agent"` |
| `followers` | Followers | optional | optional | `4,210 followers` |
| `verified_followers` | Verified followers | optional | optional | `312 of those followers are verified accounts` |
| `following` | Following | optional | optional | `follows 180 accounts` |
| `posts` | Posts | optional | optional | `9,877 posts` |
| `listed` | Public lists | optional | optional | `appears on 64 public lists` |
| `identity_verified` | ID-verified by X | optional | optional | `X has verified their government-issued ID` |
| `protected` | Protected account | optional | optional | `the account is protected — posts are visible only to approved followers` |

**The catalogue is exported data, not a switch statement.** Order 003 renders its table from this
same structure. Two copies would drift and the screen would offer a tick the composer refuses.

### The output text — fixed shape

```
This operator has had an X account since May 2013 — 13 years, 4 months old at the time of minting.
Profile figures below were read from X on 12 March 2026:
• 4,210 followers
• 312 of those followers are verified accounts
• X has verified their government-issued ID
```

`x_id` swaps the lead for:

```
This operator owns the X account @acmeagent (X user ID 1234567890), held since May 2013 — 13 years,
4 months old at the time of minting.
```

---

## Four things about that text are load-bearing

1. **The creation date anchors the claim and never goes stale**, which is why it is there rather
   than an age alone. Render it at **month granularity** (`May 2013`) — never X's exact timestamp.
   A to-the-second creation time is a far sharper fingerprint for anyone triangulating the
   anonymous signal, and it buys a reader nothing they cannot compute from the month.
2. **The age is computed live at every mint**, from `createdAt` against `issuedAt`. Never read from
   the snapshot, never frozen. This is what makes a free re-mint months later still truthful.
3. **The "read from X on" line covers the bullets only, and carries `readAt` — not the mint time.**
   A free re-mint advances the age and the mint time but not the figures. One date spanning both
   would assert that a six-month-old follower count was measured today, which is the exact
   dishonesty this line exists to prevent.
4. **With no optional fields ticked, the "read from X on" line is omitted entirely.** It would be a
   date attached to nothing.

---

## The work

1. **`src/server/trust/x-catalogue.ts`** — the table above as exported data: key, label, per-signal
   eligibility, and the fragment renderer for each key (a function of the snapshot, so numbers are
   formatted once and consistently — thousands separators included).

2. **`composeXSignals` in `src/server/trust/x-compose.ts`** — pure. Given the snapshot and the
   ticks, produce both `ComposedSignal`s via the existing `mint.ts` conventions: `type` `x_anon` /
   `x_id`, `subjectKind: "account"`, `subject: accountId`, CBOR payload.

3. **The floor is structural.** `account_age` is added to both unconditionally; `handle` and
   `x_user_id` are added to `x_id` unconditionally. **They are not in `XTickSelection`'s meaningful
   domain** — passing them, or omitting them, changes nothing. There is no input that produces a
   signal without them, so there is no validation to write and no bypass to find.

4. **A `never` field in the wrong list is REFUSED, loudly.** `display_name` in `ticks.anon` throws a
   named error. It must not be silently dropped: silently dropping means the screen and the composer
   disagree about what was disclosed, and the operator is told one thing while another is notarized.

5. **The payload carries structured fields beside the prose**, as every other type does — the same
   facts the bullets state, machine-readable, so a policy can reason over them without parsing
   English. Only the ticked ones. Plus `read_at` and the creation date.

6. **Numbers are formatted, and formatted once.** `4,210` not `4210`, in both the prose and the
   preview order 003 renders — which it gets for free by calling you.

---

## Definition of Done

1. `composeXSignals` returns both signals for any valid selection, with types `x_anon` and `x_id`
   and `subject_kind: "account"`.
2. **The floor cannot be removed by any input.** Asserted with an empty selection, and with a
   selection that explicitly tries to omit the mandatory keys: age appears in both, handle and
   numeric id appear in `x_id`.
3. **`display_name` (or any `never` field) in `ticks.anon` throws a named error** — it is never
   silently dropped.
4. **The anonymous signal contains no handle, no display name, no numeric id and no profile URL**,
   for every selection the type system permits. This is the clause the word "anonymous" rests on, so
   it is asserted exhaustively over the catalogue rather than on one example.
5. The age is computed from `createdAt` and `issuedAt`, not read from the snapshot: two composes of
   the *same* snapshot at issue times a year apart produce ages a year apart.
6. **The "read from X on" date is `readAt`, and is absent when no optional field is ticked.**
   Asserted both ways.
7. The creation date renders at month granularity and the exact timestamp appears nowhere in either
   payload.
8. Each ticked field contributes exactly one bullet, in catalogue order, with formatted numbers; an
   unticked field contributes nothing to prose or structured fields.
9. Both outputs pass `buildSubmission` and produce a body the directory would accept — same
   assertion `test/github.test.ts` makes for GitHub.
10. Each of 1–9 has a test, and **each has been made to fail on purpose**.
11. `pnpm run lint` and `pnpm run typecheck` pass. Tests at the smallest scope.
12. `git status --porcelain` clean in `cello-client` and `trustless-cello`.
13. Reviewed by `cello-unit-reviewer`, every finding fixed, verdict quoted below.

**Not in scope, explicitly:** OAuth, the profile read, persistence, the rate limit (order 001); the
screen, the routes, the mint call, the preview rendering (order 003); changing GitHub's compose
functions; the wording itself, which is fixed above and is Andre's to change, not yours.

---

## Traps recorded before you start

- **Do not make the floor a validation.** If you find yourself writing "reject a selection missing
  the age", you have built it as a checkbox. It is not one; it is added unconditionally.
- **Do not silently drop an ineligible field.** Loud, named, refused.
- **Do not freeze the age into the snapshot** or read an age from it. It is derived at mint.
- **Do not use one date for the lead and the bullets.** They measure different moments and
  collapsing them makes the claim assert something false.
- **Do not put the exact creation timestamp in the anonymous payload**, in prose or structured
  fields. Month granularity, both places.
- **Do not build a second copy of the catalogue** for the payload's structured fields. One source.
- **Do not add a free-text field, ever.** The composition is the portal's voice. The M10B
  endorsement path exists precisely because operator-authored text needs a completely different
  treatment — separate fields, untrusted framing, a scanner. None of that machinery is here, so
  text arriving here would be laundered into a portal-voiced claim.

---

## Review

**Reviewer:** `cello-unit-reviewer`, one pass, on Opus. Verdict verbatim:

> **SPEC: DEVIATIONS FOUND** — the `display_name` fragment is pinned as renderable and is not
> implemented; the deviation is real, forced by the pinned snapshot, correctly handled as a refusal,
> but declared only in a code comment. Write it into the order's *Newly discovered* and the journal
> before `status:` flips. [blocking on paperwork, not on code]
>
> **SILENT FALLBACKS FOUND** — HIGH-2 (non-finite counts notarized as `NaN followers`) is blocking.
> MEDIUM-1 and MEDIUM-2 are the same shape at lower danger.
>
> **ERRORS NAME THEIR CAUSE** — five distinct codes, `field` and `signal` carried, nothing collapsed.
> HIGH-3 is an affordance defect (a false remedy), not error substitution.
>
> **HOLLOW TESTS FOUND** — HOLLOW-1 (a numeric-id deanonymizer passes the exhaustive anonymity test)
> and HOLLOW-2 (the anon guard's call site fails the revert test) are both blocking. Every other new
> test survives the revert test.
>
> **REMOVALS PROVEN** — n/a, nothing deleted.
>
> **NO COMPATIBILITY DEBT.**
>
> Not a rubber stamp: the two blocking findings and the two hollow tests are all one theme — the
> anonymity guarantee is asserted more strongly in comments than the code enforces — which is the
> failure class this milestone's claim-truth lens names, sitting in the one payload that gets hashed
> and shown to strangers.

**Every finding fixed, one commit each, pushed after each.**

| Finding | What it would have done to an operator | Fixed in |
|---|---|---|
| HIGH-1 + HOLLOW-1 + HOLLOW-2 | The anonymous signal could carry the operator's X user id as a CBOR *number* — invisible to the byte search the exhaustive test used, so a complete deanonymizer passed green. Nested, array and bare-handle leaks likewise. And deleting the guard's call site broke nothing, so nothing proved it was installed. | `09c3100` |
| HIGH-2 | A profile missing a count would have minted the bullet "NaN followers" and the field `followers: null`, signed and hashed, with nothing reporting a problem. | `94884e8` |
| HIGH-3 | The display-name refusal told the operator to reconnect X — advice that can never work, and the first thing they would try. | `6c35d2d` |
| MEDIUM-1 | Milliseconds stored where seconds were meant would have claimed the figures were read from X in the year 58,000. | `e9fa769` |
| MEDIUM-2 | A creation date in the future was clamped and rendered "less than a month old"; a zone-less timestamp could shift the anchoring month. | `e56abf1` |
| LOW-1 | A future `lead` + `optional` catalogue entry would have shown a checkbox that discloses nothing when ticked. | `255a373` |
| LOW-2 | The duplicate `XProfileSnapshot` will not retire itself — recorded below rather than fixed here. | *Newly discovered* |

**The anonymity fix, specifically.** The guard now has two nets. The exact one is differential: the
anonymous arm is recomposed from a snapshot whose handle and user id are replaced by sentinels, and
any difference between the two field maps means a fragment read the operator's identity — whatever
its type, however deep, whether or not it survives as searchable text. The second is a recursive
name-and-value scan for shapes that do not vary with identity. The bare handle is still never matched
as a substring of prose, and now for a reason that holds: `posts` and `profile` are real X handles,
and a guard that refuses an honest mint while blaming a catalogue bug gets deleted. A test mints
successfully for four operators whose handles are ordinary English words.

### Mutation record — made to fail, and confirmed to fail for the right reason

Each applied to the real tree, vitest run, then reverted.

| Mutation | Result |
|---|---|
| both arms typed `x_anon` | 4 clause-1 tests red |
| floor made conditional on a tick | clause-2 probes 1 and 2 red (probe 3 ticks the floor keys, so it cannot detect a checkbox floor on its own — stated rather than glossed) |
| `never` throw removed | all 3 clause-3 refusal tests red |
| unknown-key throw removed | clause-3 unknown-field test red |
| boolean rendered as true when the snapshot says false | clause-3 lie test red |
| `handle.anon` flipped `never` → `locked` | 12 tests red; failure message read `x_anon_identity_leak: … it carried the field "handle"` — the *reason* checked, not just the redness |
| age derived from `snapshot.readAt` | clause-5 "ages a year" test red |
| `read_at` and the read line switched to the mint time | clause-6 tests red |
| read line emitted with no bullets | clause-6 absence tests red |
| creation date rendered as the full ISO timestamp | clause-7 test red |
| bullets iterated in reverse catalogue order | clause-8 order test red |
| thousands separators dropped | 5 clause-8 tests red |
| `issuedAt` made non-integer | clause-9 `buildSubmission` test red |
| **guard call site deleted** (post-fix) | 6 anonymity tests red — the revert test HOLLOW-2 named |

The floor, age and anonymity mutations were re-run against the refactored tree after every fix, and
still redden.

### Gate

- `pnpm run lint` — 0 errors, 6 warnings, none in these files.
- `pnpm run typecheck` — clean on a tree containing this unit alone (verified at `d90404b`), and
  clean on the fully integrated tree once three names are aligned (verified, see below). **Zero
  errors in this unit's files in every configuration.**

  **Correcting what this section first said.** I wrote the 5 `Cannot find module '@/server/x/store'`
  errors off as the expected parallel compile dependency and moved on. That was wrong, and it was
  wrong in the way that matters: a missing-module error is indistinguishable from a *mismatched*
  one, so writing it off is how a real integration break hides. I went and looked. `001` is finished
  and merged in its own checkout but **not pushed** — 12 commits, and its tree does not typecheck
  either. The module exists; two export names disagree:

  | 001 exports | 003 imports | files |
  |---|---|---|
  | `getXConnection` | `getXProfileSnapshot` | 4 in 003's lane |
  | `X_REFRESH_INTERVAL_SECONDS` | `X_REFRESH_WINDOW_SECONDS` | 1 in 003's lane |

  The other three exports (`upsertXConnection`, `recordXProfileRead`, `checkXRefreshAllowed`) match
  exactly. Verified on a throwaway branch, then discarded: three renames across three files and
  `pnpm run typecheck` is **CLEAN** across the whole integrated tree, with no logic change anywhere.
  The store getter should take 003's name (it returns an `XProfileSnapshot`, and three of 003's files
  independently reached for it); the constant should keep 001's (`INTERVAL` is what "one pull per 7
  days" means). Two of the three edits are 001's files and one is 003's, so none of them are mine to
  make while those sessions are live in them — both sessions have been told, with the exact diff.

  **Resolved and re-verified on integrated `main` (`5fede8e`).** 001 hit the same collision on
  merging and fixed it inside its own files, keeping `X_REFRESH_WINDOW_SECONDS` rather than adopting
  `INTERVAL` — the opposite of my suggestion and the better call, because it keeps every edit in one
  lane instead of touching a live one. Pulled and re-run here: typecheck **CLEAN**, lint 0 errors,
  `x-compose` + `x-oauth` + `github` + `mint` **124 passed**. Nothing in this unit changed.

  **The seam that drifted was never pinned.** The contracts covered `XProfileSnapshot` and
  `composeXSignals`; nothing pinned the store's function names, and that is precisely where the two
  orders disagreed.
- `pnpm exec vitest run test/x-compose.test.ts test/github.test.ts test/mint.test.ts` — 69 passed
  (46 of them this unit's).
- `git status --porcelain` clean in `trustless-cello`; there is no `cello-client` checkout in this
  working directory and nothing in this unit touches one.

---

## Newly discovered

*(Recorded, not acted on.)*

- **`display_name` is pinned in the catalogue but has no source in the pinned snapshot.** The table
  gives it a fragment (`display name "Acme Agent"`) and marks it `optional` for `x_id`, but
  `XProfileSnapshot` carries no display name and order 001 does not capture X's `name` field. The
  contract was not changed: ticking it is refused with a named error saying the portal stores no
  display name and that reconnecting will not supply one. Andre's call whether 001 should capture
  `name` or the row should leave the catalogue.
- **The duplicate `XProfileSnapshot` will not retire itself.** 002 declares it because 001 had not
  landed. Structural typing means that when 001 lands and adds a field, this copy still compiles and
  still cannot see it — so the `display_name` refusal above would become permanent by accident with
  nothing going red. Whichever order integrates 001 needs an explicit line item to make one file
  re-export the other.
- **Two notes for `003`, both free.** Its screen can call `entry.render(snapshot)` before the operator
  ticks anything, and grey out a row the snapshot cannot back — so the refusal arrives before a failed
  mint rather than after. And the two arms compose sequentially, so a selection with problems in both
  surfaces only the `x_anon` error; pre-checking both arms would show the operator everything at once.
- **The anonymous signal's figures are themselves identifying, and it is called anonymous.**
  `4,210 followers · 312 verified · follows 180 · 9,877 posts · 64 lists` pins down an X account far
  more precisely than a creation timestamp does — which is the very sharpness the month-granularity
  rule exists to blunt. Default-off and the operator's own tick are the right design; the gap is that
  nothing tells them. Either the compose screen says plainly that exact figures may identify the
  account, or the anon column bands them ("more than 1,000 followers"). Andre's call — it is a
  wording and disclosure decision, not a coding one.
