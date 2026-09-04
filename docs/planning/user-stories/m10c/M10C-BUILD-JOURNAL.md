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

**2026-09-04.** M10C opened to carry new trust signal types, starting with X. Container chosen
lightweight (Andre): a DoD, this journal, three parallel micro work orders, and a one-page procedure
that defers to [[M15-PROCEDURE]] rather than copying it.

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
