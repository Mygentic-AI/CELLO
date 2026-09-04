---
name: 003-XSCREEN — The operator sees what they are about to say, and changes it
type: micro-work-order
date: 2026-09-04
status: open
description: >
  The compose screen: a four-column table of everything we hold, nothing ticked by default, the two
  claim texts rendering live below as ticks change, and two buttons — Mint (free) and Refresh from
  X (billed, weekly). The mint route takes field keys, never values.
  Source: DOD-M10C-XSCREEN-1.
---

# **<ins>MICRO</ins>** WORK ORDER 003-XSCREEN — the compose screen and the mint

> ## THE RULES OF A MICRO WORK ORDER
>
> 1. **Read [[M10C-PROCEDURE]] and [[M15-PROCEDURE]] IN FULL before you start.** M15-PROCEDURE is
>    the working discipline and it binds you; M10C-PROCEDURE is the short list of deltas.
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

*(Reviewer verdict, mutation record and gate output go here before `status:` flips to `complete`.)*

---

## Newly discovered

*(One or two lines each. Do not act on them.)*
