---
name: M15 Build Journal
type: build-journal
date: 2026-08-21
milestone: M15
status: open
topics: [m15, hardening, pre-launch, security, build-journal]
description: >
  Append-only audit trail for M15 (pre-launch hardening). Entries at END OF FILE only; the RESUME
  STATE block at the top is the only thing overwritten in place. Full proofs, reviewer verdicts,
  measurement output and claims-ledger flips live here — the DoD stays a scoreboard.
---

# M15 Build Journal

## RESUME STATE (overwrite in place — the ONLY mutable block)

> ### 🟡 MILESTONE NOT STARTED — scaffolding only.
> [[M15-PROCEDURE]] exists. **[[M15-DEFINITION-OF-DONE]] does not yet exist** and is the next
> artifact to write; until it does there is no yardstick and no unit to pull.

- **NEXT ACTION:** write [[M15-DEFINITION-OF-DONE]], then run the P0 live-deployment verification
  spike (M15-PROCEDURE §4.1) before scoping anything else — it is hours of work and it re-prices at
  least two units.
- **HEAD commits:** trustless-cello `main` — see `git log`; cello-client `main` — see `git log`.
- **Published versions:** unchanged; no M15 publish has occurred.
- **Parked:** nothing yet.
- **Claims ledger:** not yet built (M15-PROCEDURE §1d). It is P0 item 2 and has no dependencies.

---

## How to write an entry (delete this block once Entry 1 exists)

**Append at END OF FILE. Never prepend, never insert.** Then verify the write landed
(`grep -c "^## Entry N"` or read the tail). The RESUME STATE block above is the only thing
overwritten in place. Chronological order is not worth a lost entry — an out-of-order number at EOF
is fine.

An entry heading is `## Entry N — <DoD line or subject> (YYYY-MM-DD)`. What belongs inside:

- **Target** — one sentence of observable behaviour, plus the DoD line expanded into a clause
  checklist (every clause, verbatim). That checklist is what the reviewer receives.
- **The counterbalance** — one sentence, written BEFORE the code, naming what makes the fix hold
  when the peer has rewritten their own daemon (M15-PROCEDURE §2b, Invariant 1). A unit with no
  answer here is not ready to build.
- **What was found / what was built** — with file paths and measured numbers, not adjectives.
- **Gate output** — the exit codes, run so they could have failed (§7).
- **Reviewer verdict, QUOTED** — finding count and disposition, in the reviewer's own words. Without
  this the unit stays 🟡 and the DoD tag does not flip.
- **Enforcer run output** where the DoD line names one — the actual run, as separate OS processes,
  not a claim that it passed.
- **Claims-ledger flips** — any row that moved to made-true, withdrawn, or disclosed-as-bounded.
- **Anything parked**, with its trigger.

---

## Entry 0 — Milestone setup (2026-08-21)

M15 stood up on Andre's ruling the same day, after two investigations landed within hours of each
other and the open items on [[launch-triage]] made the same argument a third way: the work is not
scattered feature debt, it is one milestone about the gap between what CELLO claims and what it
delivers. **Every item gets built. M15 decides order, not selection.**

**What exists as of this entry:**

- [[M15-PROCEDURE]] — self-contained runbook. §1c defines the three enforcers (stranger · receipt ·
  journey); §1d defines the claims ledger; §2b carries the four invariants this milestone installs.
- This journal.
- **No DoD yet** — it is the next artifact.

**The four invariants, recorded here because they outlive M15** (full text in M15-PROCEDURE §2b):

1. **Counterbalance.** The client is open source and runs on the adversary's machine, so a guard
   that executes only on the party it constrains is a request, not a guard. Moving the check to the
   other side is necessary and not sufficient — their daemon is rewritable too. The goal is a
   structure where the adversary's own necessary actions commit them. Worked example: each agent
   verifies the counterparty's signature on every inbound message, and because the transcript is a
   chain, their act of sending locks in what *you* said. Neither side can repudiate without
   abandoning the exchange. **Every unit names its counterbalance before the code.**
2. **Fail loudly — and loud is not blocking.** Most failures fail loudly and may continue; what is
   never right is failing quietly. Three requirements: the audience for a warning is the **agent**,
   not the log — a detection whose only consumer is a log line or a status string is not a control;
   a **security** failure is loud **and blocks** (a signature that fails against the expected
   counterparty means possible impersonation — announce and stop, session-ending, worded as an
   observation and never as a verdict); and **missing, malformed and mismatched collapse into one
   path**, because an attacker evading a mismatch check simply supplies no proof at all.
3. **The upstream cause survives downstream.** Errors name their cause, not their exit point, and a
   downstream handler never overwrites an upstream descriptive error with a generic one. Wrapping
   adds context; replacing destroys signal. Measured instance: one string, `counterparty_offline`,
   returned for three unrelated faults on 2026-08-16, naming a party that was online in all three
   and nothing that was broken.
4. **Responses carry affordances.** Every status, result or error reaching an LM is read by
   something that must decide what to do next. Where one or two obvious paths exist, name them in
   the payload — the real verb, the real parameter. A refusal especially needs one.

**Spec-of-record:** [[2026-08-21_1906_relay-p2p-exposure-and-ephemeral-peer-id-audit]] (seven ruled
Design Decisions; 39 items collapsing into 18 units with dependencies) and
[[2026-08-21_1135_tofn-decoupling-and-seal-integrity-gaps]] (seal-ceremony gaps; four ruled
decisions). Stream 3's source is [[launch-triage]] — read its header warning before trusting any
status marker on it.

**The spine, stated once so no unit has to rediscover it:** one pattern, six known instances — an
identity or integrity proof is computed, evaluated correctly, and then not acted on, with a nearby
comment asserting the property the code does not enforce. Fixing instances individually leaves the
next one to be found later, which is why the sweep is a named deliverable and not a cleanup task.

**First action:** the live-deployment verification spike (M15-PROCEDURE §4.1) — three questions that
cannot be answered by reading source and that re-price other units. Hours, no code, before anything
else is scoped.

---
