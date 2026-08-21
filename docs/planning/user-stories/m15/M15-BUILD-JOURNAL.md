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

> ### 🟢 SCAFFOLDING COMPLETE — the milestone is ready to work.
> [[M15-PROCEDURE]], [[M15-DEFINITION-OF-DONE]] and this journal all exist. **49 DoD lines across
> six tiers**, all ❌ except `DOD-M15-SWEEP-1` (🅿️, sequencing only). **Every line is inside the
> launch gate** and the gate is a state, not a date.

- **NEXT ACTION: `DOD-M15-SPIKE-1`** — the live-deployment verification spike (Tier 0). Three
  questions that cannot be answered by reading source, whose answers re-scope
  `DOD-M15-DIRAUTH-1` and `DOD-M15-MULTIRELAY-1` and may expose a silent single-directory
  dependency in the relay. Hours, no code, no branch. **Do it before anything else is scoped.**
- **Cheapest line, pull it early once the spike is done:** `DOD-M15-DIVERGE-1` — it acts on signals
  that already exist, has no wire dependency, and starts catching transcript divergence before
  Tier 4 lands.
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

- [[M15-PROCEDURE]] — self-contained runbook. §0z states the gate; §1c defines the three enforcers
  (stranger · receipt · journey); §1d defines the claims ledger; §2b carries the four invariants
  this milestone installs.
- [[M15-DEFINITION-OF-DONE]] — 49 status-tagged lines across six tiers, all ❌ except
  `DOD-M15-SWEEP-1` (🅿️ on sequencing alone). Tier 0 is the verification spike; Tier 1 claims;
  Tier 2 the doors and the detections that must act; Tier 3 basic value delivery; Tier 4 encryption
  then the seal wire change; Tier 5 abuse controls, relay redundancy and infrastructure. Carries
  twelve Decisions Carried, an Explicitly Beyond section where every deferral has a trigger, and
  the claims ledger with eight seed rows.
- This journal.

**The four invariants, recorded here because they outlive M15** (full text in M15-PROCEDURE §2b):

1. **Counterbalance.** The client is open source and runs on the adversary's machine, so a guard
   that executes only on the party it constrains is a request, not a guard. Moving the check to the
   other side is necessary and not sufficient — their daemon is rewritable too. The goal is a
   structure where the adversary's own necessary actions commit them. Worked example: each agent
   verifies the counterparty's signature on every inbound message, and because the transcript is a
   chain, their act of sending locks in what *you* said. Neither side can repudiate without
   abandoning the exchange. **Every unit names its counterbalance before the code.**
2. **Fail loudly — and loud is not blocking.** Most failures fail loudly and may continue; what is
   never right is failing quietly. Three requirements: a warning reaches the **log AND the agent** —
   both, never one instead of the other, because the log is the durable forensic record and the
   agent-facing response is the control, and a detection whose only consumer is a log line or a
   status string changes no behaviour (**never delete a log line to satisfy this**); a **security**
   failure is loud **and blocks** (a signature that fails against the expected counterparty means
   possible impersonation — announce and stop, session-ending, worded as an observation and never as
   a verdict); and **missing, malformed and mismatched collapse into one path**, because an attacker
   evading a mismatch check simply supplies no proof at all.
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

**Decisions carried into the DoD (Andre, 2026-08-21):**

- **EVERY item in M15 is inside the launch gate, and the gate is a STATE, not a date.** Launch
  happens when M15 closes, however long that takes. No fast-follow tier, no subset, no cut list —
  the two items argued as trackable (relay abuse controls + Cloud Armor, and the
  checked-then-ignored sweep) are in. DoD tiers therefore encode **dependency order only**: there is
  no within-tier prioritisation and nothing is ever descoped for time. This closes the commonest
  decision theatre available on a hardening milestone — an item's presence in the DoD *is* its
  launch-blocking status, so there is nothing to relitigate.
- **The seal wire change is INSIDE the launch gate.** Ruled on the migration argument, not the
  security one: no working attack against the seal was demonstrated, and a wire + schema change is
  cheapest against an empty database and never gets cheaper. Consistent with Decisions 1 and 6 in
  the spec-of-record. **This pulls the application-layer content encryption in with it** — the seal
  change consumes the per-session hash salt that the key agreement produces, and the seal items
  cannot be split, so the per-session ephemeral handshake with its PQ hook is gated too. Largest
  coupled pair in the milestone; both in.

**First action:** the live-deployment verification spike (M15-PROCEDURE §4.1) — three questions that
cannot be answered by reading source and that re-price other units. Hours, no code, before anything
else is scoped.

---
