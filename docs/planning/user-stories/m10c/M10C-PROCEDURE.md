---
name: M10C Procedure — deltas from M15
type: procedure
date: 2026-09-04
milestone: M10C
status: open
topics: [m10c, procedure, trust-signals, x, portal, zero-bump, cost-discipline]
description: >
  How to work M10C. Deliberately NOT a second copy of M15-PROCEDURE — that document applies in
  full and is the authority. This carries only what is different: portal-only repo scope, the
  zero-bump stop condition, cost discipline for a paid third-party API, and the parallel-order
  rule. Read M15-PROCEDURE first, then this.
---

# M10C Procedure — the deltas

> ## 📌 [[M15-PROCEDURE]] APPLIES IN FULL AND IS THE AUTHORITY.
>
> **Read it before you start.** The gate, severity triage, the two-stop rule, decision theatre, the
> core loop, reviewer dispatch, the four blocking invariants, the made-to-fail requirement, journal
> discipline, the machine budget — all of it binds you here exactly as written there.
>
> **This document is a short list of things that are DIFFERENT in M10C.** It is deliberately not a
> second copy: two near-identical procedure documents drift, and then nobody knows which one ruled.
> If this document and M15-PROCEDURE disagree on something this document does not explicitly claim
> as a delta, **M15-PROCEDURE wins.**

---

## Δ1 — The repo is the portal. Only the portal.

Work lands in `cello-portal`. Nothing else.

**This is the zero-bump contract and it is a STOP condition, not a preference.** M10 built the
trust-signal machinery so that adding a type costs a portal change and nothing else
([[M10-TYPE-PLAYBOOK]]). If you find yourself needing to edit `cello-client` or `trustless-cello` to
land a type, **stop and hand back**. That is not a task to complete — it is evidence the generic
machinery is not generic, which is a finding worth more than the type is.

`git status --porcelain` must stay clean in both other repos for the whole run. `DOD-M10C-XLIVE-1`
asserts it.

## Δ2 — M10C is outside the launch gate

M15's gate rules about what may and may not be descoped do not apply. Nothing here blocks launch.
That does **not** relax the quality bar — it changes only what happens when something is bigger than
expected: in M15 it takes longer, here it can be parked with a trigger and a line in the journal.

## Δ3 — 💸 THE X API COSTS MONEY. THIS IS A NEW CLASS OF RULE.

X has no free tier. Every profile read is billed to a prepaid balance Andre tops up.

1. **No test, at any level, may contact `api.x.com` or `x.com`.** The OAuth and profile code takes
   an injected `fetchImpl`; tests pass a double. A test that reaches the real API spends real money
   and fails in CI where no credentials exist. There is no "just once to check".
2. **Signing in must never trigger an X read.** The portal already re-mints phone, email and track
   record on every login (`runLoginMint`). Hooking X into it would bill on every login of every
   operator, forever, and nothing would report it. **Do not add X to that path.** The only thing
   that may pull from X is an explicit operator button press.
3. **One pull per account per 7 days**, as a named constant with its reason beside it. Andre expects
   to raise it later; make that a one-line edit, not an archaeology expedition.
4. **A re-mint is free and must stay free.** Recomposing from the stored snapshot touches no
   network. If you find yourself re-reading the profile to mint, you have built the expensive path
   by accident.

## Δ4 — The three orders are PARALLEL, and the contracts are pinned

`001-XPROFILE`, `002-XCOMPOSE` and `003-XSCREEN` may be worked simultaneously by three sessions in
any order. That works only because the seams are decided in [[M10C-DEFINITION-OF-DONE]] as literal
data and signatures.

**If a contract looks wrong to you, STOP AND SAY SO. Do not adapt to it, and do not change it.**
Changing a pinned contract silently breaks the two orders you cannot see. This is the one place
M10C is stricter than M15, because M15's units were sequential and could absorb a drifting seam.

WIP limit is still one *per session*: finish and review your order before taking another.

## Δ5 — The live journey needs credentials Andre controls

`DOD-M10C-XLIVE-1` cannot run without a real X developer app and a funded balance. Build and review
everything against doubles; the live run is a separate, scheduled act. **A unit is not blocked by
the missing credentials** — say so in the journal and finish the unit.

## Δ6 — Reviewer

`cello-unit-reviewer`, one pass per order, on Opus, findings fixed one commit each, verdict quoted
in [[M10C-BUILD-JOURNAL]]. `cello-done-auditor` is retired and is not used here.

## Δ7 — The playbook is an output of this milestone

[[M10-TYPE-PLAYBOOK]] gets corrected from what actually happened, per its own standing rule, under
`DOD-M10C-PLAYBOOK-1`. If your order reveals a step the playbook gets wrong, note it under *Newly
discovered* — the playbook line collects them; do not edit the playbook from inside a type order.

---

## Related Documents

- [[M15-PROCEDURE]] — the authority; this document only lists deltas
- [[M10C-DEFINITION-OF-DONE]] — the scoreboard and the pinned contracts
- [[M10C-BUILD-JOURNAL]] — where evidence goes
- [[M10-TYPE-PLAYBOOK]] — the runbook this milestone repays
