---
name: 003-XSCREEN — The operator sees what they are about to say, and changes it
type: micro-work-order
date: 2026-09-04
status: complete
description: >
  The compose screen: a four-column table of everything we hold, nothing ticked by default, the two
  claim texts rendering live below as ticks change, and two buttons — Mint (free) and Refresh from
  X (billed, weekly). The mint route takes field keys, never values.
  Source: DOD-M10C-XSCREEN-1.
---

# **<ins>MICRO</ins>** WORK ORDER 003-XSCREEN — the compose screen and the mint

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

Every other trust signal appears in the operator's wallet fully formed — the portal decided what it
said and minted it. GitHub does it the instant OAuth returns, and the operator's first sight of the
claim is a read-only "what counterparties see" panel after the fact.

**X is the first type where the operator decides what their own signal discloses before it exists.**
They see everything we pulled, tick what they are willing to share, watch the two sentences change
as they tick, and press Mint when it says what they want it to say.

This order is that screen and the two routes behind it.

---

## ⛔ YOU ARE BUILDING AGAINST TWO ORDERS BEING WRITTEN IN PARALLEL

Neither exists yet. Both are pinned, so build against the signatures and they will meet.
**If a contract looks wrong, stop and say so in *Newly discovered*. Do not adapt, do not extend.**

```ts
// From 001-XPROFILE — read it from the store, never from the request.
export interface XProfileSnapshot {
  xUserId: string; username: string; createdAt: string;
  followers: number; following: number; posts: number; listed: number;
  verifiedFollowers: number; identityVerified: boolean; protectedAccount: boolean;
  readAt: number;  // epoch SECONDS of the last paid pull. Not the mint time.
}

// From 002-XCOMPOSE — call it for BOTH the live preview and the real mint.
export type XFieldKey = "account_age" | "handle" | "x_user_id" | "display_name"
  | "followers" | "verified_followers" | "following" | "posts" | "listed"
  | "identity_verified" | "protected";
export interface XTickSelection { anon: readonly XFieldKey[]; id: readonly XFieldKey[]; }
export function composeXSignals(
  accountId: string, snapshot: XProfileSnapshot, ticks: XTickSelection,
  opts?: { issuedAt?: number },
): { anon: ComposedSignal; id: ComposedSignal };
```

The catalogue (`src/server/trust/x-catalogue.ts`, from 002) carries each field's label, its
per-signal eligibility — `locked` / `optional` / `never` — and its fragment renderer. **Render your
table from that catalogue.** A second hardcoded list in the UI drifts, and then the screen offers a
tick the composer refuses.

---

## The work

1. **The table.** Four columns: **field · what it says · anon · id.** One row per catalogue entry.
   - `optional` → a checkbox, **unticked by default**. Minimal disclosure is the default and the
     operator opts in to each thing.
   - `locked` → shown as always-included, no checkbox. The operator can see the floor; they cannot
     move it.
   - `never` → **no checkbox at all in that column.** Absent, not disabled-and-greyed. `display_name`
     has no anonymous tick because a display name in an anonymous signal is not anonymous, and a
     hash cannot be un-said.

2. **The live preview.** Both claim texts below the table, updating as ticks change. **Render it by
   calling `composeXSignals`** — never by reimplementing the sentence in the component. Two
   renderers is how the preview and the mint end up saying different things, and the preview is a
   promise about what will be notarized.

3. **`POST /api/trust/x/mint`** — takes an `XTickSelection` of **field KEYS only**.
   - **Values come from the stored snapshot. Never from the request.** A request that could carry
     `followers: 99000` is a request to notarize a lie.
   - Refuse a selection naming a `never` field for that signal, with a named reason.
   - Then the generic machinery, exactly as `submitAndDeliverGitHubSignals` does it, in this order:
     `buildSubmission` → `postSignedSubmission` → **`recordMintedSignal`** → `deliverSignalToAgents`.
     Record before deliver and unconditionally: an account with no agent yet must still end up with
     a recorded signal, and GitHub shipped without that call and under-reported for months.
   - Both signals, `x_anon` then `x_id`.

4. **`POST /api/trust/x/refresh`** — the billed path. Re-runs the OAuth dance (order 001's routes;
   the token is gone, so a refresh is a fresh authorization). Server enforces one pull per account
   per 7 days.

5. **The two buttons are visibly different acts.** **Mint** is free and always available. **Refresh
   from X** costs money, and inside the window it says *when it unlocks* rather than failing on
   click. An operator must never be able to spend money without knowing they did.

6. **The Trust Signals page gets an X row** in the Social section beside GitHub, replacing nothing.
   Connected → links to the compose screen. Not connected → **Add**, which starts the OAuth dance.

7. **`truncateHandle` already exists** (`src/lib/truncate-handle.ts`) and GitHub uses it. Use it.

---

## Definition of Done

1. An operator with a stored snapshot sees the table, every catalogue row present, **nothing ticked**.
2. `never` fields have **no checkbox in that column** — asserted structurally, not by a disabled
   attribute a user can flip in devtools.
3. `locked` fields are shown as always-included and cannot be unticked.
4. **The preview text changes when a tick changes**, and matches what a mint with that same
   selection actually produces — asserted by comparing the rendered preview against
   `composeXSignals` output for the same selection, not by eyeballing a string.
5. **The mint route ignores any value in the request body and reads the snapshot from storage.**
   Asserted with a request carrying inflated numbers: the minted payload contains the stored
   figures, not the submitted ones.
6. A selection naming a `never` field is refused with a named reason.
7. Both signals are submitted, **recorded** and delivered, in that order, and the recording happens
   even when the account has no addressable agent.
8. A refresh inside the 7-day window is refused, and the button says when it unlocks.
9. **Nothing on this screen or its routes reaches X except the explicit refresh.** Loading the page,
   ticking boxes and minting make zero X API calls. Asserted with a fetch double.
10. The Trust Signals page shows an X row in Social, in both connected and unconnected states.
11. Each of 1–10 has a test, and **each has been made to fail on purpose**.
12. `pnpm run lint` and `pnpm run typecheck` pass. Tests at the smallest scope.
13. `git status --porcelain` clean in `cello-client` and `trustless-cello`.
14. Reviewed by `cello-unit-reviewer`, every finding fixed, verdict quoted below.

**Not in scope, explicitly:** OAuth, the profile read, the snapshot store, the rate-limit constant
(order 001); the composition, the catalogue, the wording (order 002); giving GitHub a compose screen;
LinkedIn; changing the Social section's existing GitHub row.

---

## Traps recorded before you start

- **Do not reimplement the sentence in the component.** Call the composer. The preview is a promise
  about what will be notarized; two renderers break that promise silently.
- **Do not accept values from the request.** Keys only. This is the one route where trusting the
  client means notarizing a lie.
- **Do not hardcode the field list in the UI.** Render from the catalogue.
- **Do not mint in the OAuth callback.** That is GitHub's shape and it is what this whole design
  moves away from — the operator must choose before anything is notarized.
- **Do not skip `recordMintedSignal`, and do not make it conditional on having agents.** GitHub
  shipped that bug: 17 signals notarized against 15 recorded, invisible to their owner, and every
  re-connect minting a fresh pair instead of superseding.
- **Do not make Refresh the primary button.** It costs money. Mint is the common act and the free
  one.
- **Do not let a disabled checkbox stand in for an absent one.** A `never` field must not be in the
  DOM as a tick at all.

---

## Review

Reviewed by `cello-unit-reviewer` on Opus, one pass, 2026-09-04. **Every finding is fixed, one
commit each, pushed.** Verdict quoted verbatim:

> - **SPEC: DEVIATIONS FOUND** — clause 8 is implemented against the wrong clock (HIGH-1,
>   un-journaled, [blocking]); clause 10 is implemented but its test proves the component rather than
>   the page (HIGH-2); clause 11 consequently over-reports for clause 10.
> - **SILENT FALLBACKS FOUND** — one, LOW and unreachable today: `x-table-model.ts:69` substitutes
>   "Named in the opening sentence" and an offered checkbox for a bullet entry with no renderer, where
>   the composer throws loudly on the same shape. No HIGH, so nothing blocking on this line.
> - **ERROR SUBSTITUTION FOUND** — [blocking]. Two named instances: the compose screen destroys all
>   five of the composer's distinguished causes into Next.js's generic crash page, on the one page
>   carrying the remedy those causes name (MED-4); and the mint route's 502/500 assert *"Nothing was
>   notarized"* on a path where the anonymous signal is already notarized and recorded (MED-3). The
>   routes' own error handling is otherwise exemplary — the directory's words survive, the parse error
>   survives, and the five compose codes are each mapped to a distinct status.
> - **HOLLOW TESTS FOUND** — [blocking]. Clause 10's test does **not** survive the revert test;
>   `x/page.tsx` has no test at all, leaving the URL-flattening that carries a second tick unasserted
>   and un-mutated. Every other new test **does** survive the revert test, and clauses 2, 5, 6, 7 and 9
>   are unusually well armoured — I could not construct a passing wrong implementation for any of them.
> - **REMOVALS PROVEN** — the two renames and the one deleted redirect parameter each verified by an
>   exhaustive reference search across `src/` and `test/`, not by a single grep of the symbol name.
> - **NO COMPATIBILITY DEBT** — none introduced. The one pre-existing item is named above.

**HIGH-1 was the finding worth the review.** The screen and the refresh route each did their own
arithmetic on `snapshot.readAt`, while the gate that actually decides — `checkXRefreshAllowed` —
takes the LATER of two clocks, because X charges the moment `GET /2/users/me` returns and a read can
be billed and then fail to become a snapshot. So a billed-then-failed read left an armed
"Refresh from X" button on a week the operator had already paid for: click it and they are navigated
out of the portal onto a raw JSON 429. The route also told an operator with no snapshot that
"that read is not rate-limited", which can be false, and is about money. Three implementations of one
rule collapsed to one; `x-refresh-window.ts` and `x-refresh.ts` are deleted.

**Findings and disposition** — every one fixed:

| Finding | Fix |
|---|---|
| HIGH-1 · Refresh armed against money already spent | both callers now use `checkXRefreshAllowed`; window checked before the snapshot so the no-snapshot branch cannot make a false billing claim |
| HIGH-2 · clause 10 passed with the row deleted | the Trust Signals page is rendered, connected and not, with its position in Social asserted |
| MED-3 · half-completed mint said "nothing was notarized" | mint runs one arm at a time; a partial failure names the arm that landed, its hash and the directory's words |
| MED-4 · corrupt profile crashed the page carrying the remedy | `XComposeError` caught in the view; the composer's reason renders, Refresh stays reachable, Mint disarmed |
| MED-5 · the repeated-key branch had no test | three tests on the compose page; dropping the branch reddens the first |
| LOW-6 · a catalogue bug rendered as a lead field | the two cases separated; a bullet entry with no renderer is named as a bug and offers no tick |
| LOW-7 · Mint clickable mid-tick | disabled during the navigation, when the props still hold the previous selection |
| LOW-8 · preview/mint age drift | no code change; documented — the notarized claim is always true, only the preview is briefly stale |
| LOW-9 · `signal_hashes` unasserted | kept as the liveness affordance, now asserted against what was submitted |
| LOW-10 · no correlation id in responses | threaded into every mint and refresh response, success and refusal |
| LOW-11 · mint submits to the first directory only | pre-existing, copied from GitHub as instructed — recorded under *Newly discovered*, not fixed here |
| LOW-12 · test escaper omitted `'` | added, before a catalogue fragment carrying one makes the assertion vacuous |

**Mutation record: 18 mutations, all reddening on assertions, none on a compile error.** Nine on the
screen and table, eight on the mint, preview and routes, plus a revert test per HIGH/MED fix. Full
detail in [[M10C-BUILD-JOURNAL]].

The mutation pass found a defect in the test harness itself: the `fetch` double recorded calls and
then delegated to the real `fetch`, so the mutation proving *"nothing here reaches X"* would itself
have contacted `api.x.com` — a test spending real money to prove that tests do not spend real money.
It now records the call, then throws.

**Gate:**

```
pnpm run lint       → ✖ 8 problems (0 errors, 8 warnings)   [all pre-existing, none in this unit]
pnpm run typecheck  → clean
npx vitest run test/x-screen.test.tsx test/x-mint-route.test.ts
                    → Test Files 2 passed (2) · Tests 50 passed (50)
git status --porcelain → clean in cello-client and trustless-cello
```

---

## Newly discovered

*(One or two lines each. Do not act on them.)*

- **~~GitHub's connected-state panel shows placeholder text~~ — WITHDRAWN, this is by design.**
  Andre corrected it on 2026-09-04: the portal shows GitHub's real claim at the moment the mint
  finishes and then discards the profile, because it does not keep personal information like that.
  The panel afterwards is a shape, not a claim, and the operator reads the true signal from their
  CELLO daemon where it rests. Noted only because **X is different**: the snapshot is persisted so a
  free re-mint costs nothing, so the X screen can show the real claim at any time. The two panels
  differ because their retention does.

- **`submitAndDeliverGitHubSignals` is generic but named for GitHub.** X now calls it under an import
  alias. It belongs in `directory-submit.ts` under a type-neutral name; reimplementing the loop per
  type is how the missing `recordMintedSignal` shipped in the first place, so the fix is a move, not
  a copy.

- **The catalogue can refuse a field the operator's snapshot cannot state, and `display_name` always
  does** — the pinned `XProfileSnapshot` carries no display name. The screen therefore shows a row
  the operator can never tick, with the reason. Either the profile read should capture a display name
  or the catalogue entry should go; both are outside this order.

- **~~A re-mint supersedes nothing~~ — WITHDRAWN, this is the design.** Andre corrected it on
  2026-09-04: a re-mint adds the new signal to the operator's wallet, the older one stays there, and
  presentation sends only the most recent. Superseding at the notary was never the mechanism, for X
  or for GitHub. Nothing to fix and nothing owed.

- **The mint submits to the FIRST directory only.** `cfg.directoryApiUrls[0] ?? cfg.directoryApiUrl`
  — copied verbatim from GitHub's callback as the order instructed, so it is propagated debt, not
  new. But one node down fails the mint, while `signal-lifecycle.ts` and `submission-ingress.ts`
  iterate every node. That is the sovereign-node redundancy invariant, and the fix belongs to the
  shared submit path rather than to any one type.

- **Every tick is a server round-trip**, because the ticks live in the URL and `composeXSignals` is
  the only renderer. If that ever needs to be instant, the fix is to make `x-compose.ts` browser-safe
  (today it pulls `node:crypto` in through protocol-types' CBOR barrel) — never a second renderer in
  the component.
