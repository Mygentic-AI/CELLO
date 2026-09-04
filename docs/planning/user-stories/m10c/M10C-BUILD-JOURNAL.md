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
