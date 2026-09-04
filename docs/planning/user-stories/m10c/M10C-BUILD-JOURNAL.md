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
