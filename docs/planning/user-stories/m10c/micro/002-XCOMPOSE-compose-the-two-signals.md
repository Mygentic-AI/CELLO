---
name: 002-XCOMPOSE — The portal composes both claim texts from the operator's ticks
type: micro-work-order
date: 2026-09-04
status: open
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

*(Reviewer verdict, mutation record and gate output go here before `status:` flips to `complete`.)*

---

## Newly discovered

*(One or two lines each. Do not act on them.)*
