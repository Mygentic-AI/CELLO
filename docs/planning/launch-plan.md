---
name: Launch Plan
type: plan
date: 2026-09-05
topics: [launch, go-to-market, waitlist, onboarding, public-agents, analytics, attribution, security-layer, governance-layer, environments, fundraising, pricing, investor-readiness, status-page, hole-punching]
status: active
description: >
  The whole launch, not just the software — twelve workstreams sequenced against three gates
  (ready to test, ready for a stranger, ready for an angel), with the ordering principle stated,
  the decisions that are Andre's separated from the work, and the things a green result will not
  prove written down next to the things it will.
---

# Launch Plan

**Scope.** Everything between here and launch, across engineering, launch operations, and the raise.
This sits above [[launch-triage]] and the milestone definition-of-done documents: those are
item-level and engineering-only, this is the altitude where the three streams are visible at once.

**Why one document.** The work splits into three streams that run on different clocks and compete
for one person's attention. Sequencing each stream on its own produces three plans that cannot all
be executed. This one interleaves them.

---

## The three streams and their clocks

**BUILD** — finishes when it finishes. Its close condition is the clean-room test: a fresh machine,
following the published instructions, doing everything a real operator would do. Nothing here has an
external deadline; it has a dependency chain.

**LAUNCH OPS** — must exist before a stranger arrives, and mostly is not code. Small items, cheap
individually, and their absence is what makes an otherwise-working product look unfinished or
untrustworthy. A few of them are irreversible if skipped: traffic that arrives before attribution is
live can never be attributed afterwards.

**RAISE** — runs on the September calendar regardless of the other two. It is the only stream with a
clock nobody controls. It also depends on the other two having produced evidence, which is why it
cannot simply be done last.

---

## The ordering principle

Three rules decide what goes first, in this order:

1. **Do the things whose cost grows every day they wait.** Attribution, the company entity, and the
   metrics captured from the first cohort all get permanently more expensive — or become impossible
   — the longer they are deferred. A user who arrives untracked is untracked forever.
2. **Do the cheap things that stop a visible bleed.** A security disclosure address, a deletion
   path, and an out-of-band status channel are each an afternoon, and each one's absence is the kind
   of thing an evaluator notices before they notice anything good.
3. **Then build, in dependency order.** Everything else waits its turn, and the ranking inside it is
   the discoverability filter already established in M15: what would a motivated person with a
   coding agent find in an afternoon.

---

# Gate 1 — Ready to run the clean-room test

The clean-room test is the close condition for BUILD, and it is expensive to run: a fresh instance,
the published instructions followed literally, several agents created, connected, endorsed,
conversing with a public agent, seals verified, then the unhappy paths run deliberately. Running it
before these are true wastes the run.

**What must be true first:**

- **Onboarding has no known holes.** The Telegram signup bot is properly gated and therefore
  documentable; cohort token issuance is tested rather than merely coded; the Telegram side points
  at production instead of staging, and that production path has actually been exercised at least
  once by hand.
- **One public agent exists and is reachable.** The test runs *as* one of the public agents, which
  is what forces the whole surface to be exercised rather than a convenient subset. Support is the
  natural choice. That means its instance, its sandbox, its system prompt bounds, and its CELLO
  permissions all exist before the test, not after.
- **A new operator sees the staff identities.** At minimum the shipped-known-list half, so the test
  exercises what a real user actually encounters rather than a hand-configured contact.

**What the clean-room test will not prove, and this matters:**

- **It cannot catch the old-client failure.** A fresh install is always current, so a run that goes
  perfectly says nothing about an operator on a build from three weeks ago. That failure is already
  known to be quiet rather than loud — an older daemon reads a newer acknowledgement as the older
  layout and drops it without complaining. It needs its own deliberate test with a pinned old
  client, and it needs a decision about whether a minimum version is enforced anywhere.
- **It cannot prove hole punching.** Your laptop talking to a cloud instance is a NAT-to-public
  case, which is the easy one. The case that decides relay load at scale is two peers behind two
  different home routers. Before building a NAT lab, check whether production already records
  whether a connection went direct or via relay — reading that from real peers is cheaper than
  simulating it, and answers the question with real users.
- **It cannot prove the inbound defences.** Already established: a legitimate client refuses to send
  the attacks, so the screener block, the orphan triage and the evidence-on-block paths have never
  run outside in-process tests. The hostile-client rig exists now and is the thing that exercises
  them.

---

# Gate 2 — Ready to point a stranger at the site

Everything here is between a person seeing a link and that person being a functioning operator. The
failure mode of skipping any of it is not a bug report — it is silent abandonment, or a loss of
trust that never gets reported back.

## The site itself

- Sweep for coherence: does the whole thing gel, does the how-to reflect what actually happens now.
- Every stage of the waitlist works, end to end, including the stages that only fire days later.
- Anything a visitor can click does what it says. Most of this is waitlist surface.
- The security section is checked against what actually runs. This is the same class of problem M15
  has been grinding for weeks — what the page claims versus what the code does — and it is the page
  most likely to be read adversarially.

## Attribution — do this before the first post, not after

- Google Analytics enabled, plus whatever else is free and useful.
- Generated tracked links, one per channel and per post, so a LinkedIn or Reddit post can be
  followed through to visit, return visit, and waitlist signup. Two steps of tracking minimum:
  *this post drove traffic*, and *that traffic signed up*.
- **This is the item that is irreversible if deferred.** Every day of untracked traffic is a day of
  go-to-market learning that cannot be recovered later.

## The legal and disclosure minimum

- **Deletion path.** The privacy policy and terms were redone; the deletion path was not. A product
  collecting a phone number and an email address needs it, and needs it to actually work rather than
  to be described.
- **Security disclosure address.** A published address, a `security.txt`, and a stated policy. The
  whole M15 priority filter assumes a motivated person points a coding agent at the public repo —
  when one does, having nowhere to send a finding reads worse than the finding.

## Outage communication

- A static status page hosted **outside GCP** — Cloudflare Pages or GitHub Pages — plus a Telegram
  broadcast channel, both updatable from a phone without touching the fleet.
- The point is the failure domain, not the page. The monitoring agent covers detection and telling
  you; it cannot tell users anything when the thing that is down is the thing it runs on.

## The agents that meet the public

Three public, one internal, plus two internal coders. They are Gate 2 rather than Gate 1 because a
stranger arriving with a problem and no one to ask is the shape of a lost user.

- **Support** — what an operator with their own agent reaches out to. The hardest of the four: it
  has to understand a great deal in order to diagnose, while being able to change nothing.
- **Feedback** — bidirectional. Passively receives unsolicited feedback most of the time; sometimes
  reaches out to new users to introduce itself and ask. Works with Support in both directions: a
  problem Support finds may become a ticket and a note to Feedback, and the reverse.
- **Reporting** — for malicious or suspected-malicious behaviour. Takes the details, and where it
  has the transcript it can make a judgement without needing a seal. At launch it escalates to Andre
  personally with the evidence attached.
- **Monitoring** — internal only, never talks to a stranger. Watches directory, relay and portal
  health plus the business signals: signups, agents created, sessions held. Reports on a schedule via
  Telegram, and can also report over CELLO to Miss_Chelly.
- **Cloud Coder 1 and 2** — internal, one shared GCP instance, backed by Claude Code rather than
  Hermes, with much broader access because they write code.

**Two things about this fleet that are easy to miss:**

1. **Monitoring is a fundraising dependency, not just an ops one.** With launch free, depth of use
   is the evidence that replaces revenue: sessions held, agents connected per operator, repeat use
   across weeks, waitlist-to-active conversion. A metric not captured during the first cohort does
   not exist later. Decide in this gate what you will want to show in December.
2. **Monitoring is also what makes wave sizing a judgement instead of a guess.** The waitlist is
   deliberately built without a fixed cadence or fixed wave size, because ten smooth onboardings and
   ten uniquely broken ones are different results. That decision is only as good as the readout of
   what went wrong for the current cohort — which is exactly what Support, Feedback and Monitoring
   produce. It raises how early the three of them need to be running.

## Containment

- The public three are dangerous because strangers talk to them. Hardened at four layers: the Hermes
  protection level, the system prompts bounding what each is allowed to do, the CELLO-side
  permissions, and the instance and OS lockdown, which has nothing to do with CELLO and needs its
  own pass.
- **The coder box is the reverse problem** and needs its own thinking rather than the same checklist.
  Nobody hostile talks to it; the risk is what it can reach. Same conclusion, opposite argument.

## Proving which agents are really ours

Monikers are self-chosen, so anyone can call themselves Cello Support. Two mechanisms, and the
second is not optional:

- **Shipped** — the install seeds every newly created agent's known list with the staff identities.
- **Live** — an endpoint an agent can query that returns the authoritative roster: pubkeys, each
  one's purpose, a warning when the identity being asked about is not on the list, and the standing
  "staff will never ask you for X". The shipped list alone cannot revoke a compromised identity or
  add a new one.

## The lever behind an escalation

Today's kill switch is account-scoped: the portal suspends *your own* agents, and the directory
enforces it properly — a suspended agent is refused at session request and refused a share rotation,
and suspensions replicate between nodes.

**The missing case is a third party.** Reporting escalates about someone else's abusive agent, and
there is no lever, because you cannot suspend an agent you do not own. Launch week wants one, even
if it is entirely manual and only you can pull it.

Two related items, both small:

- The semantics were never decided: does suspend stop new sessions being brokered, or stop the agent
  doing anything at all? Settle it before it is needed in anger.
- A comment in the directory says a node can only honour a suspension for an agent whose profile row
  it holds, so a paused agent could route around the one honouring node. It reads stale — both
  tables replicate now — but it is exactly the shape of thing that survives review by looking
  answered. A five-minute confirm, not a project.

---

# Gate 3 — Ready for the first angel conversation

September is the season, and this stream cannot be sequenced after the other two because it needs
evidence the other two produce. It runs alongside them.

## Settle the narrative first — it decides what the model counts

**Single-player first, multiplayer as a consequence.** An operator connects their *own* agents on
day one, across devices or sessions, and gets value before anyone else exists. No cold start. The
operators who get the most out of that are the ones who start inviting counterparties, and the
network effect follows from adoption rather than being a precondition for it.

This resolves an inconsistency worth catching before the deck: network-effects-first and
solo-wedge-first imply different metrics and different objections. The deck can only lead with one.
Leading with the solo wedge dodges the bootstrap objection entirely, and it tells the model to count
depth per operator first and invitations second.

## Pricing — decided

**Launch is free.** There is no entity that can accept payment yet, and the reasoning stands on its
own: costs do not scale with users the way an inference business does, so a hundred, a thousand or
two thousand users cost materially the same. Charging early buys cash flow or investor optics at the
cost of the growth that is the actual asset. Written plainly, that is a strong slide rather than a
weak one.

Free changes the investor question from *what is the price* to *why free, and what converts later*.
Two consequences:

- The model still needs a hypothesised price for CAC:LTV, clearly labelled as a hypothesis. The
  assumption document does the work, not the number.
- **The enterprise angle may be the revenue signal that does not require pricing the consumer
  product.** A separately-installable security and governance layer is a thing an enterprise pays
  for, and a paid pilot or even a letter of intent is stronger evidence at this stage than consumer
  subscriptions. That raises the priority of the M9C work below from "soon after launch" to
  "possibly part of the raise story."

The detailed thinking on what to charge and what to leave free is in a recent discussion log in the
drafts repo; pull it when the modelling starts.

## The work, in dependency order

1. **Entity, SAFE template, cap table, data room.** Long lead time, and it blocks both taking money
   and signing a pilot. Nothing downstream is blocked by it, which is precisely why it slips —
   start it first anyway.
2. **The modelling, because the deck cannot be finished without it.** CAC:LTV and how it is reached;
   a financial forecast that survives being asked for the numbers; a bottom-up TAM/SAM/SOM.
3. **The assumption write-ups.** The assumptions are the deliverable, not the totals — long-form
   PDFs that walk a reader through the reasoning in a shape they can hand to their own LLM and
   interrogate. This is what separates a model from a spreadsheet.
4. **Investor two-pager** — the existing one-pager, enhanced, plus why-now and why-me.
5. **Pitch deck**, on top of the modelling.
6. **Investor list** — a substantial exercise in its own right, and it can run in parallel with
   everything above since it depends on none of it.

---

# Post-launch, but soon — the security and governance layer

Not a gate item, recorded here because it is the largest single piece of deferred work and it has a
revenue argument attached.

**The milestone is M9** — inbound screening, outbound governance, the two gate stories, the attack
corpus. M9B is taken, so this is **M9C**. Two halves:

- **Harden it and actually test it.** We make a great deal of this layer relative to the attention it
  has had. Inbound is the weaker side; outbound governance is in better shape. M15 has already found
  this shape twice: the semantic screener has never run against real model weights, and the inbound
  language block was silently disarmed by a normalisation step running before it.
- **Extract the sidecar into its own package, probably its own repository, consumed as a
  dependency.** It already runs as a separate process, so this is a packaging and boundary change
  rather than a rewrite. The driver is the enterprise argument: the customer installs the security
  and governance layer on their own instance and controls what crosses it, so an employee with a
  coding agent cannot edit the daemon to walk around corporate policy. That argument only holds if
  the layer is separately installable and separately verifiable — which makes the extraction a
  positioning feature, not refactoring.

---

# Decisions that are yours

Each of these changes what gets built. Recommendations given, but they are yours to rule.

**1. Environments — staging versus production, and the fleet shape.**
Today there is one environment, called staging by habit. Recommendation: promote it to production,
take production to five directories before launch, and build staging as **three** directories and
two relays.

Three, not two, and the reason is arithmetic rather than caution. The threshold is majority of N, so
a two-node staging has a threshold of two: losing one node breaks it entirely, and a fleet that
cannot survive a node loss cannot test the failover behaviour that is the whole point of the
sovereign-node design. Three directories with a threshold of two survives one loss, which is the
minimum that demonstrates the claim. Two relays is the minimum that tests relay failover at all.

Cost is not the binding constraint here — roughly $23,000 of GCP credits run to late 2027. Your
attention and AWS runway are the real constraints.

**2. Suspend semantics.**
Recommendation: suspend stops new sessions being brokered, and nothing more. It is reversible,
proportionate, and it is already what the directory enforces at session request. A full stop is a
burn, which exists separately and should stay separate.

**3. The third-party lever at launch.**
Recommendation: manual only. You pull it, no self-serve, no appeals process. Sufficient for launch
volumes and it avoids designing a moderation system before there is anything to moderate.

**4. The fourth public agent.**
Currently three public plus Monitoring. If a fourth public agent is wanted, it needs naming before
the staff roster endpoint ships, since the roster is the thing that makes it real.

**5. Does M9C move into the raise story?**
Recommendation: yes, if an enterprise pilot conversation gets traction — the extraction is the thing
that makes the pitch demonstrable. Otherwise it stays post-launch.

---

# Explicitly not in this plan

- **M16** — channel epoch and broadcast work. Drafted, not launch scope.
- **Shared documents** — ruled out of the gate.
- **The M15 post-launch backlog** — carried, not dropped, and not launch scope.

---

# References

Kept at the end deliberately; they mean nothing from outside the project.

- [[launch-triage]] — engineering open items, item-level, ranked
- [[M15-DEFINITION-OF-DONE]] — the current gate, including the discoverability filter this plan's
  ordering rule inherits
- [[M9-DEFINITION-OF-DONE]] — the security and governance milestone M9C extends
- [[GCP-STATE]] — authoritative record of what is deployed
- [[protocol-map]], [[end-to-end-flow]] — orientation
