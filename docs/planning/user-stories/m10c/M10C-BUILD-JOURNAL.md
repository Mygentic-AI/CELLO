---
name: M10C Build Journal
type: build-journal
date: 2026-09-04
milestone: M10C
status: open
topics: [m10c, build-journal, trust-signals, x, portal]
description: >
  The evidence record for M10C. Reviewer verdicts, mutation records, gate output, live-journey
  proof and anything the Type Playbook got wrong. Append at EOF, never rewrite. The DoD carries
  status tags; this carries the reason they are earned.
---

# M10C Build Journal

**Append at EOF, then verify the append landed.** Never rewrite an earlier entry — correct it with a
later one that names what it corrects. Status tags live in [[M10C-DEFINITION-OF-DONE]]; the evidence
that earns them lives here.

Each entry carries: the DoD line, what was built, the reviewer's verdict quoted verbatim, the
mutation record (what was made to fail and whether it reddened), the gate output, and anything
discovered that was deliberately not acted on.

---

## Entry 0 — milestone opened

**2026-09-04.** M10C opened to carry new trust signal types, starting with X: a DoD, this journal,
three parallel micro work orders, and [[M10C-PROCEDURE]] — the review discipline refined on earlier
milestones, ported in and rewritten for this one, so that everything an M10C session needs points at
M10C and nothing else.

**Design settled with Andre the same day, before any code**, and recorded in the DoD's pinned
contracts rather than a discussion log, because these are the seams three parallel orders build
against:

- Two signals, `x_anon` and `x_id`, mirroring the GitHub pair.
- **The operator composes their own signal** from a fixed catalogue of ticks. This is new — GitHub
  mints a fixed pair with no operator choice — and it is the reason this type is worth a milestone
  rather than a playbook run.
- The floor is structural, not validated: age in both signals, handle and numeric id in `x_id`, and
  none of them is a checkbox, so no input can express their absence.
- Identity-carrying fields get **no anonymous checkbox at all**. Absent, not disabled.
- The creation date anchors the claim and never goes stale; the age is recomputed live at each
  mint; the figures carry their own "read from X on" date, which is the pull time and not the mint
  time.
- Free re-mint, billed weekly refresh, and **the login path never touches the X API**.

**Cost position:** X has no free tier as of Feb 2026 — pay-per-use credits, `User: Read` at $0.010
per resource returned. Billing is per resource, not per field, so one `GET /2/users/me` asking for
everything costs the same penny as asking for a handle. About 1¢ per operator connect. The 0.1¢
"owned read" rate does not apply to us: it requires the authenticated user to own the developer app.

**Open dependency:** the live journey (`DOD-M10C-XLIVE-1`) needs a real X developer app and a funded
balance, both of which are Andre's to create. No unit is blocked by it.

---

## Entry — DOD-M10C-XCOMPOSE-1 · clause checklist (written BEFORE implementation)

Order: `micro/002-XCOMPOSE-compose-the-two-signals.md`. Session worked in `m10c-002/`, portal only.
(The DoD and the rest of this journal were not read, per the order's rule 1 — this entry is appended
blind at EOF and nothing above it was consulted.)

| # | Clause | How it is proven |
|---|---|---|
| 1 | Both signals returned for any valid selection; types `x_anon` / `x_id`, `subject_kind: account` | direct assertion on both outputs |
| 2 | Floor cannot be removed by ANY input | empty selection; selection that names every non-floor key; selection that names the floor keys themselves — age in both, handle + numeric id in `x_id` in all three |
| 3 | A `never` field in the wrong list throws a NAMED error | `display_name` in `anon`; `handle` in `anon`; `x_user_id` in `anon` — error carries code + field + signal, never a silent drop |
| 4 | `x_anon` carries no handle, display name, numeric id or profile URL | exhaustive: all 2^N subsets of the anon-eligible optional keys, forbidden substrings searched in the RAW payload bytes, not only in decoded keys |
| 5 | Age computed live from `createdAt` vs `issuedAt` | same snapshot composed at two issue times a year apart → ages a year apart, in prose and in structured fields |
| 6 | "read from X on" is `readAt`, absent when nothing optional is ticked | both directions; `read_at` also absent from the structured fields, so no date is attached to nothing |
| 7 | Creation date at month granularity; exact timestamp nowhere | day/time substrings of `createdAt` searched in raw payload bytes of both signals |
| 8 | One bullet per ticked field, catalogue order, formatted numbers; unticked contributes nothing | per-field bullet assertions + ordering assertion + absence assertions |
| 9 | Both outputs pass `buildSubmission` and re-hash | mirrors `test/github.test.ts`'s envelope reconstruction and `hashTrustSignalEnvelope` re-derivation |
| 10 | Each of 1–9 made to fail on purpose | mutation record appended in the closing entry |
| 11 | lint + typecheck + smallest-scope tests | gate output in the closing entry |
| 12 | `git status --porcelain` clean in `cello-client` and `trustless-cello` | asserted at close |
| 13 | `cello-unit-reviewer`, every finding fixed, verdict quoted | verdict in the order's Review section and here |

---

## 003-XSCREEN — clause checklist, written before implementation (2026-09-04)

Source: `micro/003-XSCREEN-compose-screen-and-mint.md` (DOD-M10C-XSCREEN-1). Expanded from its
Definition of Done. This is what the unit reviewer receives.

| # | Clause | How it is proven |
|---|---|---|
| 1 | Operator with a stored snapshot sees the table, **every catalogue row present, nothing ticked** | Render the screen with an empty selection; assert one row per catalogue entry and zero `checked` attributes in the markup |
| 2 | `never` fields have **no checkbox in that column** | Structural: assert the anon cell for a `never` field contains no `<input>` at all — not that it carries `disabled` |
| 3 | `locked` fields are shown as always-included and **cannot be unticked** | Assert no `<input>` for a `locked` cell either, and that the selection parser drops `locked`/`never` keys arriving from the URL |
| 4 | **Preview changes when a tick changes and matches what a mint of that selection produces** | Build the view model at two selections; assert the two rendered previews differ AND each equals the `claim` decoded from `composeXSignals`' payload for that same selection |
| 5 | **Mint route ignores values in the request body; reads the snapshot from storage** | POST a body carrying `followers: 99000` alongside the keys; assert the composed payload carries the STORED follower count |
| 6 | A selection naming a `never` field is refused with a **named reason** | POST `display_name` in `anon`; assert 400 with a reason naming the field and the column, and that nothing was submitted |
| 7 | Both signals submitted, **recorded**, delivered — in that order — and recorded even with **no addressable agent** | Record call order into an array across both signals; assert `submit → record → deliver` per signal, and with `agents: []` assert `record` still ran twice |
| 8 | A refresh inside the 7-day window is refused and **the button says when it unlocks** | Pure-window test either side of the boundary; route returns the unlock instant; screen renders the unlock date instead of an armed button |
| 9 | **Zero X calls** from loading the page, ticking, or minting | A `fetch` double installed globally records every call; assert none has an `api.x.com` / `x.com` host across all three acts |
| 10 | Trust Signals page shows an **X row in Social**, connected and unconnected | Render the row component both ways; connected links to the compose screen, unconnected offers Add pointing at the OAuth start |
| 11 | Each of 1–10 made to fail on purpose | Mutation record recorded below at close, naming the mutation and the reason it reddened |
| 12 | `pnpm run lint` and `pnpm run typecheck` pass; tests at smallest scope | Gate output quoted at close |
| 13 | `git status --porcelain` clean in `cello-client` and `trustless-cello` | Checked at close; the only `trustless-cello` edits are this journal and the order file |
| 14 | Reviewed by `cello-unit-reviewer`, every finding fixed, verdict quoted | Verdict quoted in the order's Review section, `status:` flipped in the same commit |

**Known red on arrival, by design:** this unit imports the catalogue and `composeXSignals` from
`002-XCOMPOSE` and the snapshot store from `001-XPROFILE`, neither merged at the time of writing.
Creating those modules locally is forbidden — it produces the duplicate catalogue 002 exists to
prevent. Pure model, selection parsing and the refresh window are therefore written against an
injected catalogue so they can be proven today; the clauses that need the real composer are proven
after the merge.

---

## 003-XSCREEN — mutation record, part 1: the screen, the table and the window

Nine mutations, each applied alone, `test/x-screen.test.tsx` run, the failing test names recorded,
the mutation reverted. `compile_error` was checked on every run: a non-zero exit also means the
mutant did not compile, and a syntax error recorded as a clean catch is the failure this check
exists to prevent. **All nine compiled and reddened on assertions.**

| Mutation | Reddened |
|---|---|
| `never` renders a **disabled** checkbox instead of nothing | clause 2's structural test, the checkbox count, and the real-catalogue test |
| every checkbox pre-ticked | clause 1 (nothing ticked) and the real-catalogue test |
| `locked` renders a checkbox | clause 3 and the checkbox count |
| a `never` tick is silently dropped instead of refused | both counterbalance refusal tests, anon and id columns |
| the unlock boundary uses `>` instead of `>=` | clause 8's one-second-either-side test |
| the table drops a catalogue row | clause 1, clause 3, the row-count test and the real-catalogue test |
| the Refresh button is always armed | clause 8's "unlock date instead of an armed button" |
| the X row prints the handle in full | clause 10 |
| a field the snapshot cannot state is still offered as a tick | three tests, including the URL-selection drop |

The last one is the mutation that mattered most, and it was not in the original plan. `002` shipped a
catalogue where a field renders *either* a bullet *or* a refusal — display name has no source in the
pinned profile shape at all. A screen that read only `optional` would have shown a checkbox, taken
the tick, and failed at the mint. That is the screen-versus-composer drift this order exists to
prevent, so an unstateable field is now treated exactly like a `never` one: no checkbox, and the
catalogue's own reason printed in the row.

Clauses 4, 5, 6, 7 and 9 are proven in `test/x-mint-route.test.ts`, which cannot run until
`001-XPROFILE`'s snapshot store lands — it is the only unresolved import left. Their mutation record
follows in part 2.

---

## Entry — DOD-M10C-XCOMPOSE-1 · closed

**What was built.** Two files in `cello-portal`, nothing anywhere else (the zero-bump contract held —
no edit was needed in `cello-client` or `trustless-cello` to land a new signal type).

- `src/server/trust/x-catalogue.ts` — the pinned field table as exported DATA: key, label, per-signal
  eligibility, and one renderer per field producing the bullet AND its structured payload fields
  together, so the prose and the machine-readable payload cannot disagree about the same fact. Order
  003 renders its tick table from this same structure, which is the point.
- `src/server/trust/x-compose.ts` — `composeXSignals`, pure, on the pinned signature.

**The three properties held structurally rather than by validation.** The floor is added because the
catalogue says `locked`, so no input expresses its absence and there is no rule to bypass. The age is
derived at every mint from `issuedAt` while the figures carry `readAt`, so a free re-mint ages
honestly without asserting that old numbers were counted today. And the anonymous payload is checked
before encoding by a differential: the arm is recomposed from an identity-redacted snapshot and any
difference means a fragment read the operator's handle or user id.

**Reviewer verdict** (`cello-unit-reviewer`, one pass, Opus), verbatim:

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

**Every finding fixed, one commit each, pushed after each:** `09c3100` (HIGH-1 + both hollow tests),
`94884e8` (HIGH-2), `6c35d2d` (HIGH-3), `e9fa769` (MEDIUM-1), `e56abf1` (MEDIUM-2), `255a373`
(LOW-1). LOW-2 is an integration line item, recorded in the order rather than fixed here.

**The one that mattered.** The guard meant to keep identity out of `x_anon` examined only STRING
values at the top level. The X user id is numeric, so a fragment emitting it as a number walked
straight past — and as a CBOR integer the digits never appear in the payload bytes, so the exhaustive
anonymity test's byte search did not see it either. A complete deanonymizer passed the whole suite
green. Worse, deleting the guard's call site broke nothing, so nothing proved it was even installed.
Fixed with the differential above plus a recursive name-and-value scan, and the tests now attack the
guard at the mint by patching a catalogue renderer — delete the guard's line and six tests go red.

**Mutation record.** 14 mutations, each applied to the real tree, vitest run, then reverted; each
reddened its intended clause. The `handle.anon` flip was checked for its failure REASON
(`x_anon_identity_leak: … it carried the field "handle"`), not merely for going red. The floor, age
and anonymity mutations were re-run against the refactored tree after every fix and still redden.
Full table in the order's Review section.

**Gate.** `pnpm run lint` 0 errors (6 warnings, none in these files). `pnpm run typecheck` clean on a
tree containing this unit alone (`d90404b`); on current `main` it reports 5 errors, all
`Cannot find module '@/server/x/store'`, all in 003's files, all waiting on 001 — the expected
parallel compile dependency, none in this unit. Tests: 69 passed across
`x-compose` + `github` + `mint`, 46 of them this unit's. `git status --porcelain` clean in
`trustless-cello`.

**Discovered and deliberately not acted on** — four items, recorded in the order's *Newly discovered*
and reported to Andre: the pinned catalogue offers `display_name` but the pinned snapshot has no
field to render it from; the duplicate `XProfileSnapshot` will not retire itself when 001 lands; two
free improvements for 003 (pre-check a row before the operator ticks it, and pre-check both arms so
one mint surfaces both errors); and the observation that the anonymous signal's exact figures are
themselves identifying while nothing on the screen says so — a disclosure-wording decision, Andre's.

---

## Entry — correction to the DOD-M10C-XCOMPOSE-1 closing entry

**What this corrects.** The closing entry above reported the 5 `Cannot find module '@/server/x/store'`
typecheck errors as "the expected parallel compile dependency, none in this unit." The first half was
wrong and the second half was true but beside the point.

**Why it was wrong.** A missing-module error and a mismatched-export error look identical from the
outside, so "waiting on 001" is exactly the story a real integration break tells about itself. I went
and looked instead. `001-XPROFILE` is finished and merged in its own checkout and **not pushed** — 12
commits ahead of origin/main — and its tree does not typecheck either. The store module exists. Two
of its five exports are named differently from what `003` imports:

| 001 exports | 003 imports |
|---|---|
| `getXConnection` | `getXProfileSnapshot` (4 call sites) |
| `X_REFRESH_INTERVAL_SECONDS` | `X_REFRESH_WINDOW_SECONDS` (1 call site) |

The other three exports match exactly. Verified on a throwaway branch and discarded: three renames
across three files makes `pnpm run typecheck` **CLEAN** on the fully integrated tree, with no logic
change anywhere.

**Why this unit did not make the fix.** Two of the three edits are in 001's files and one is in 003's,
and both sessions are live in those files right now. Editing another lane's tree mid-flight conflicts,
and 001's work is unpushed, so a fix layered on top of it could not be pushed without publishing their
12 commits under my gate. Both sessions were sent the exact diff instead, including the direction each
rename should go and why.

**Resolved, and verified rather than taken on trust.** `001` hit the same collision on merging, fixed
it inside its own files and pushed (`5fede8e`). It kept the constant as `X_REFRESH_WINDOW_SECONDS`
rather than adopting `INTERVAL` — deliberately the opposite of what I suggested, and for the better
reason: it keeps every edit inside one lane instead of touching a session that is mid-flight. Pulled
and re-run here on integrated `main`: `pnpm run typecheck` **CLEAN**, `pnpm run lint` 0 errors,
`x-compose` + `x-oauth` + `github` + `mint` **124 passed**. So the window where `main` was red is
closed, and no part of this unit needed to change.

**The real lesson, for the milestone rather than for this unit.** The seam that drifted was never
pinned. The M10C contracts pinned `XProfileSnapshot` and `composeXSignals` — the two seams that were
anticipated — and the orders met on both without a hitch. The store's function names were pinned
nowhere, and that is exactly where the two orders disagreed. Parallel orders meet where the contract
names things and drift everywhere else; the fix is not more care, it is pinning the whole seam.

---

## 003-XSCREEN — mutation record, part 2: the mint, the preview and the zero-X-calls clause

`001-XPROFILE` merged, so the five clauses that needed the real snapshot store could finally run.
`test/x-mint-route.test.ts`: 17 passed. Eight mutations, each applied alone and reverted, every one
compiling and reddening on an assertion rather than a syntax error.

| Mutation | Reddened |
|---|---|
| the mint composes from figures in the REQUEST BODY as well as the store | clause 5 — the inflated `followers: 99000` reached the payload |
| a `never` tick is dropped instead of refused | clause 6 |
| `recordMintedSignal` moved to AFTER delivery | clause 7's ordering assertion |
| `recordMintedSignal` made conditional on having an agent | clause 7's no-agent case, and the unaddressable-agent case |
| the preview composes with an empty selection, ignoring the ticks | clause 4 — the two previews stopped differing |
| the component renders its own sentence instead of the preview prop | clause 4's on-screen assertion |
| loading the compose screen fetches `api.x.com/2/users/me` | clause 9, plus both clause-4 tests |
| the refresh route never refuses | clause 8's route test |

**The `fetch` double was hardened during this pass and it matters.** It recorded calls and then
delegated to the real `fetch`. Under the clause-9 mutation that would have genuinely contacted
`api.x.com` — a test spending real money to prove that tests do not spend real money. It now records
the call, so the assertion still names what happened, and then throws.

**Two defects found reviewing my own diff before dispatching the reviewer,** each fixed in its own
commit:

- `formatUnlockDate` used `toLocaleDateString`, so the day the Refresh button names would change
  silently on a Node built with small-icu. `002` already refuses that dependency for notarized text;
  there was no reason to accept it for the line telling an operator when they may next spend money.
- A successful mint redirected to `/trust-signals?x=minted`, a parameter nothing reads. The operator
  was returned to a list with no confirmation — and in particular no sight of the one outcome that
  looks like failure and is not: notarized and recorded with no agent connected yet. The screen now
  shows the route's own wording in place. `Refresh from X` also awaited `fetch` with no `catch`, so a
  network failure left the button looking inert, and the natural response is to click again — on the
  one button that costs money.

Gate: `pnpm run lint` 0 errors (8 pre-existing warnings, none from this unit), `pnpm run typecheck`
clean, `npx vitest run test/x-screen.test.tsx test/x-mint-route.test.ts` → 39 passed.
`git status --porcelain` clean in `cello-client` and `trustless-cello`.

---

## 003-XSCREEN — review verdict, findings fixed, unit CLOSED

`cello-unit-reviewer`, one pass on Opus. Verdict quoted in full in the order's Review section.
Headline: **SPEC: DEVIATIONS FOUND** (clause 8 against the wrong clock; clause 10's test proving the
component rather than the page), **ERROR SUBSTITUTION FOUND [blocking]**, **HOLLOW TESTS FOUND
[blocking]**, one LOW silent fallback, **REMOVALS PROVEN**, **NO COMPATIBILITY DEBT**.

Twelve findings, all fixed, one commit each, pushed after each.

**HIGH-1 is the one that justified the review, and it was invisible from inside this unit.** Order
001 built two clocks on purpose: `x_read_log` records when X CHARGED us, `x_connections` records
when a snapshot was STORED, and `checkXRefreshAllowed` gates on the later of the two — because X
bills the moment `GET /2/users/me` returns, before the body is parsed. This screen and its refresh
route each did their own arithmetic on the stored snapshot alone, which is strictly more permissive.

The operator-visible shape: a read billed on day 8 that came back malformed leaves the snapshot at
day 0. On day 9 the screen renders an armed **Refresh from X** button. The operator presses the one
button whose entire purpose is that they never spend money without knowing — and is navigated out of
the portal onto a raw JSON 429 for a week they already paid for. The route also told an operator
with no stored snapshot that *"that read is not rate-limited"*, which can be false and is a claim
about money. Fixed by deleting my arithmetic entirely: `x-refresh-window.ts` and `x-refresh.ts` are
gone, both callers use `checkXRefreshAllowed`, and the window is now checked BEFORE the snapshot so
that branch cannot make a claim the read log contradicts. Deleting my boundary tests with them is
safe — 001's `x-oauth.test.ts` proves the same boundary against the real gate, across both clocks.

**HIGH-2 and MED-5 were the same lesson twice: a test that renders a component is not a test of the
page that uses it.** Clause 10 passed with the X row deleted from the Trust Signals page. `x/page.tsx`
had no test at all, so the branch that re-expands a repeated query key — the only thing carrying a
second tick through the round trip — could be removed with the suite green, and the operator's second
choice would vanish from the preview and the mint together, consistently enough that nothing else
would notice. Both now render the real page; both mutations redden.

**MED-3 and MED-4 were error substitution in opposite directions.** The mint route asserted
*"Nothing was notarized"* on a path where `x_anon` was already notarized AND recorded — a false claim
about the notary, and "try again" mints a second copy rather than replacing it. The compose screen
did the reverse: it destroyed all five of the composer's named causes into Next.js's generic crash
page, on the one page carrying the Refresh button those messages tell the operator to press.

The remaining LOWs: a catalogue bug rendering as a lead field; Mint clickable while a tick was still
navigating; no correlation id on any response; an unasserted `signal_hashes`; a test escaper missing
the apostrophe. LOW-11 (the mint submits to the first directory only) is pre-existing, copied from
GitHub's callback as this order instructed, and is recorded under *Newly discovered* rather than
fixed — the fix belongs to the shared submit path.

**Gate at close:** `pnpm run lint` → 0 errors (8 pre-existing warnings, none from this unit);
`pnpm run typecheck` → clean; `npx vitest run test/x-screen.test.tsx test/x-mint-route.test.ts` →
**50 passed**; `git status --porcelain` clean in `cello-client` and `trustless-cello`.

`003-XSCREEN` `status: complete`.

---

## 003-XSCREEN — correction: the GitHub placeholder panel is by design, not a defect

Corrects the *Newly discovered* entry in `003-XSCREEN` and the finding quoted in this journal.

Andre, 2026-09-04: the portal shows GitHub's **real** claim text at the moment the mint finishes,
then throws the profile away — it does not keep personal information like that. The panel shown
afterwards is a shape, so the operator can see what it would look like; the true signal is read from
their CELLO daemon, where it rests. Nothing is hidden and nothing has drifted.

Worth keeping only for the asymmetry it explains: **X persists its snapshot** (a free re-mint
composes from it, which is the point of paying once), so the X screen can render the real claim at
any time. GitHub cannot. The two panels differ because their retention differs, not because one of
them is wrong.
