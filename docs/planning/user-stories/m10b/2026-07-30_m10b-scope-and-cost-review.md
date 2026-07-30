---
name: M10B Scope and Cost Review
type: review
date: 2026-07-30
milestone: M10B
topics: [m10b, scope, process, retrospective, re-cut]
status: active
description: >
  Why one feature (agent-to-agent endorsements) cost more than the whole M10 trust-signal system:
  invariants counted as deliverables, a five-pass design-review loop, recipient-side policy scoped
  into the pipeline milestone, and a DoD that grew into a 1,629-line narrative. Includes the re-cut
  (what ships, what moves, what was never a deliverable) and the process changes. Quota and the
  stored-copy withdrawal re-check moved to first-after-launch per Andre, 2026-07-30.
---

# M10B — Scope & Cost Review (2026-07-30)

## 1. Is it over-scoped? Yes — it is three milestones and a rulebook filed as one.

Testing the four hypotheses:

**(a) Invariants counted as deliverables — holds.** Five of the 29 lines are properties every other
line must respect (no type-specific branches; attribution from the signature; nothing presentable
without consent; endorser's words always quoted as untrusted; no self-manufactured standing). You
don't *build* a property — the per-unit reviewer already enforces them. Giving them ❌ status tags
made them read as unfinished work and made every review pass re-litigate them.

**(b) Recipient-side policy scoped into the pipeline — holds for two of three.** "Endorsements never
auto-promote a trust tier" and "endorsement-aware minimum-requirement checks" are the *recipient's*
trust-decision engine — and the milestone itself discovered that engine has **zero production
callers**: no floor is ever evaluated live, including M10's. Building endorsement-aware rules for an
engine nobody runs is future work. The rendering line is half-and-half: quoting the endorser's words
as untrusted is genuine pipeline safety and shipped; the tier-sign presentation polish is not launch
scope.

**(c) Abuse controls — holds.** The issuance cap and issuer-suspension defend against an attacker who
cannot exist at alpha with one issuer. The cap additionally sits behind the longest unbuilt dependency
chain in the milestone (agent→account lookup, plus a safe account-linking flow — the existing function
is an authorization bypass). **Andre, 2026-07-30: cap moves to first-after-launch.**

**(d) Suspension = M8 kill switch extended — partially holds.** Marking the issuer is the existing
kill switch reaching signals, and new-session filtering already works today. What's genuinely new is
the between-session re-check for stored copies — the same missing machinery as withdrawal. **Andre,
2026-07-30: new-session effect is enough for launch; the stored-copy re-check is a fast-follow.**

One structural cause the hypotheses don't name: the design determination (`DOD-END-ARCH-1`) — one
"line" that was really a whole phase, and absorbed five review passes.

## 2. Where the time went (rough)

- **~30% — the design determination and its review loop.** An entire overnight session, four
  completed review passes plus a fifth that died unread, zero code shipped. Three decisions were
  rewritten three to five times each (the revoke-authority rule alone has five versions).
- **~25% — feature code.** Submit path, queue, portal drain + scanner, consent state, operator
  surface, the live journey.
- **~20% — fixing defects reviews found in this milestone's own code.** All real: the consent gate
  that auto-accepted everything; the refusal message that would have minted as a public endorsement;
  the revoke fix that contained its own bypass.
- **~15% — fixing things broken before M10B started:** M10's agent-scoping hole live in production;
  delivery silently destroying the second endorsement of any subject; a supersession rule inert since
  revocation became tombstones; a live test red for four days; migration renumbering after a collision
  with M12; deploy breakage after hibernate.
- **~10% — documentation:** DoD 1,629 lines + journal 3,258 lines ≈ 5k lines of process prose for one
  feature, with the same correction often written three times (journal, DoD blockquote, commit essay).

Caveat: wall-clock vs M10 is partly confounded — the same window carried interleaved M9B and M8C work.

**Single biggest sink: design-by-review.** Five passes over a document, where the two entries that
actually *ran the SQL on live Postgres* settled more than all the prose passes combined.

## 3. Which procedures earned their cost

**Earned:**
- **The per-unit reviewer, on code.** Caught: the operation field read for a log line but never
  branched on (a private refusal would have minted as a public endorsement); the revoke fix whose
  legacy branch defeated the entire fix — with the author's own test pinning the wrong behavior as
  correct; the account-linking function that would let anyone hijack and burn anyone's agent.
- **The live journey.** Caught the consent gate being completely inert — every endorsement
  auto-accepted — while both repos' unit suites were green; and caught the fixture that made the
  headline "stranger endorses Alice" case secretly exercise the same-account path.
- **Revert-testing.** Caught the scoping test that passed with or without the fix.
- **Per-unit design notes with a falsification pass** (e.g. the scanner note) — cheap, and caught the
  barrel-import that would have pulled a forbidden dependency into the portal.

**Did not earn:**
- **The unbounded determination review.** Passes 2–4 largely reviewed the previous pass's fixes; the
  fifth died having read nothing. The repo's own two-pass cap existed and wasn't applied to the
  determination — the journal itself calls the last pass "confirmation, not discovery."
- **The DoD-as-narrative.** The doc says "this stays a scoreboard" and is 1,629 lines, with 100-line
  status blockquotes and a supersession table telling the coder which of five versions of a decision
  to build. This format *caused* cost: every later review had to re-read the archaeology.
- **Triple-written corrections** (journal + DoD annotation + essay commit). One authoritative home
  would have done.

## 4. The re-cut

| Disposition | Lines (plain English) |
| :-- | :-- |
| **Ship — M10B closes on these** (most already done) | Daemon submit path · directory queue ✅ · portal drain + mint · intake scanner · self-endorsement refusal · delivery ✅ · pending-consent queue ✅ · accept/refuse ✅ · agent-scoping fix ✅ · revoke authority fix ✅ · quoted-untrusted rendering · operator surface (landed clauses + refusal readback) · live journey cases: happy path, offline subject, self-endorsement refused · submitter result return path (in flight) |
| **Move to first-after-launch milestone** | Issuance cap + agent→account lookup + safe account-linking (one coherent unit) · stored-copy withdrawal re-check · issuer suspension cascade · floor/count/tier policy engine wiring (needs a policy source regardless) · tier-sign rendering polish · submitter-abuse flagging · journey case: withdrawal reaching a prior recipient · the second-type zero-diff proof |
| **Delete as not-deliverables** | The five invariant lines (become named review lenses in the procedure doc, no status tags) · the design determination as a status-tagged line (it's a phase, not a unit) · non-discoverability line (already parked; resolve by rescoping in writing — dropping the stored edge did the substantive part) · the "don't build an anonymous variant" clause (an instruction not to build something) |

**Process changes so the next milestone doesn't do this:**

1. **Invariants get no status tags.** They live in the procedure doc as review lenses.
2. **Scoreboard discipline, enforced literally:** one status line + journal pointer per DoD line.
   Supersession history lives only in the journal. A decision on its third rewrite triggers a measured
   spike (run it on real Postgres), never a fourth prose pass.
3. **The two-pass review cap applies to design determinations.** The escape it prescribes — remaining
   findings become ACs on the units that build them — is applied at pass two, not pass five.
4. **Scope fence = the user journey.** Any line whose failure the journey's cases cannot observe is,
   by definition, after-launch.
5. **Pre-existing defects found mid-milestone still get fixed** (standing rule), but as separately
   labelled debt lines — so the feature's true cost stays legible, and an overstated ✅ in a prior
   milestone (a floor "proven" by a test that supplies the caller production lacks) is charged to that
   milestone, not silently to this one.
