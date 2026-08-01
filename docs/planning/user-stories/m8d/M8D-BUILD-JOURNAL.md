---
name: M8D Build Journal
type: build-journal
date: 2026-08-01
milestone: M8D
status: active
topics: [m8d, co-attendance, multi-session, agent-identity, message-delivery, build-journal]
description: >
  Evidence, forensics, and decisions-in-flight for M8D (co-attendance — several sessions on one agent
  identity). The DoD is the scoreboard; this is where proofs, run output, and anything a run got wrong
  actually live. One entry per unit.
---

# M8D — Build Journal

> Convention (carried from M10B): a DoD tag flip carries ONE line of evidence plus `→ Entry N`.
> The full proof lives here.

---

## Entry 0 — Milestone opened (2026-08-01)

**Why M8D exists as its own milestone.** The design was decided on 2026-07-31 and written up in
[[2026-07-31_1043_two-sessions-one-agent-co-attendance]], but that document proposes **no milestone**
— it settles a decision, fixes a build order, and lists eight operator-facing changes. Its only
tracking hook is a sequencing note recorded against `DOD-FRONTIER-STRAND-1`. Two of the three strands
it uncovered already have M8C lines (`DOD-FIRSTMSG-WITNESS-1`, shipped in daemon `0.0.106` with ACs
7–8 owed; `DOD-FRONTIER-STRAND-1`, open). Co-attendance itself had **nothing** — it was named as a
destination in two places (M8C DoD's out-of-scope list, [[launch-triage]] §6) and nowhere else. This
milestone is that destination.

**Why not append it to M8C.** M8C is command surface, notifications and reactive messaging. Its
delivery model assumes one reader. M8D changes delivery semantics across several surfaces — the
queue, the cursor, the send gate, catch-up — and its enforcer is different in kind: **two attached
connections on one agent**, which no M8C line ever needed. A milestone whose every assertion is about
what the *second* session sees does not belong appended to one whose fixture only ever built the
first.

**The split that shapes the milestone** ([[launch-triage]] §6). Only the **detection** half belongs at
launch: making "nothing arrived" and "another session took it" different answers, carrying the
attendance count, and logging the receive on both outcomes. That converts a silent, trust-destroying
failure into a visible one with an obvious workaround — the difference between ruin and forgive. It
is `DOD-COATTEND-VISIBLE-1`, Tier 0, and it does not wait behind the receipt work. The redesign is
Tier 1 and opens behind `DOD-FIRSTMSG-WITNESS-1` and `DOD-FRONTIER-STRAND-1`, per the spec's build
order.

**What is already settled and must not be re-litigated in any unit:**

1. **Co-attendance, not exclusivity** (spec §3). Four reasons, in order of weight: exclusivity only
   sounds simple (connections die constantly, so the hard part is relocated to a takeover protocol,
   not skipped); it buys no cryptographic property (the seal attests the identity, not the seat); it
   fixes the wrong half (the CLI path has no live connection to key it on); and it forecloses listener
   mode, which co-attendance gets free. If exclusivity is ever wanted it is a **flag on top**.
2. **The relay is a true sequencer** (spec §5). It assigns `seq` from its own counter, ignores the
   sender's claimed position, and rejects a `last_seen_seq` ahead of it; all of an agent's sessions
   share one strictly-serialized stream. **Co-attendance cannot fork the chain.** The residual risk is
   semantic — a message perfectly signed and conversationally stale — which is the right kind of
   failure to have. Re-verified against post-M12 code on 2026-07-31.
3. **The certificate is outside this milestone** (spec §7c/§7d). It is rebuilt from the
   relay-witnessed leaf sequence and cross-checked against the relay's running root; neither party's
   local tree is an input. Adding a party-vs-party comparison would be a protocol change, not a fix.
4. **The receptionist gets a two-line fix and no vote on the architecture** (spec §6). It is a
   last-resort workaround for harnesses with no event injection; Andre wants as few users as possible
   depending on it.

**Verification state carried in.** All four of the spec's §9 open items were closed by third-party
validation on 2026-07-31, and the code anchors were re-verified against post-M12 code. Two of those
closures change what M8D must build rather than merely confirming it:

- **`cello_get_transcript` is already a both-directions catch-up door** — it advances the connection
  cursor *and* the persisted watermark, and its comment names the sibling-send case as its purpose.
  So `DOD-COATTEND-CATCHUP-1` is a *choose-and-point-at-one-door* problem, not a build-from-nothing
  one, and the original "second session is stuck forever" framing is overstated. Implement against the
  corrected framing in the DoD, not against §3b's first paragraph.
- **`--agent` with `--scope current` works as §6's receptionist fix assumes**, without writing the
  shared file. `DOD-RECEPTIONIST-AGENT-1` is therefore a doc/subagent edit, not a CLI change.

**The sizing rule this milestone opens with (Andre, 2026-08-01).** Handed a DoD line inside an existing
milestone, a session executes it. Handed a *milestone*, the same session burns large token budget on
investigation, re-derivation, refinement and repeated review of specs and plans before writing any
code — **and the output is no better.** The ceremony is triggered by the word "milestone," not by the
work. M8D is **four lines in one repo** with the design already decided and validated: no crypto, no
schema, no protocol change, no second repo, no cloud. It is tiny next to M10B or M12, and the only
reason it is a milestone at all is that its enforcer (two attached connections) is different in kind
from anything M8C built. [[M8D-PROCEDURE]] carries this as its 🪶 rule: no determination unit, no
review pass on a planning document, design notes capped at half a page with no reviewer dispatch,
targeted reads against the spec's §10 anchors rather than a subsystem survey, and the first red test
inside the first working turn or two. The check, whenever a run feels like it is preparing rather than
building: *would I be doing this if this line had been handed to me inside M8C?*

**Owed on open.** Two documents make claims this milestone contradicts and both need correcting as
work lands, not after: [[launch-triage]]'s *"reply guard — already solid, confirmed working"* line
(it rests on `DOD-CURSOR-1`, whose own DoD text says the two-window scenario was never run — carried
as AC 7 of `DOD-COATTEND-VISIBLE-1`), and M8C's out-of-scope reference to co-attendance, now pointed
at this milestone.

---
