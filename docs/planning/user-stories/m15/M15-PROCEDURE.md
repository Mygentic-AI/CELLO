---
name: M15 Procedure — How to Work the Milestone
type: procedure
date: 2026-08-21
milestone: M15
status: open
topics: [m15, hardening, pre-launch, security, injection, relay, transport, seal, claims, counterbalance, fail-loudly, affordances, procedure, runbook]
description: >
  The operating runbook for M15 (pre-launch hardening — closing the gap between what CELLO claims
  and what it delivers). SELF-CONTAINED — no other milestone's procedure needs to be read. Read
  FIRST, then M15-DEFINITION-OF-DONE. Spec-of-record is the two 2026-08-21 investigations (the
  relay/P2P exposure audit and the T-of-N/seal-integrity log) plus the open items in
  launch-triage. §2b carries the four invariants this milestone exists to install.
---

# M15 Procedure — How to Work the Milestone

## REALITY CHECK — read before anything

One user: Andre, also the only developer. CELLO is **alpha — no production, no real users, nothing
to migrate.** That is not a caveat on this milestone, it is the *reason* for it: every wire change,
schema change and hash-domain change here is free today and never gets cheaper. A change deferred
past launch stops being a change and becomes a stranding event.

**Everything on this milestone gets built. M15 decides ORDER, not selection.** No item here is a
candidate for being dropped; if something is genuinely post-launch it goes in Explicitly Beyond
with a trigger, never quietly off the list.

Work lands in **both repos** plus the drafts repo — see §2a. The npm boundary (`/cello-publish`)
and the GCP fleet roll are the two external reaches.

## WHAT THIS MILESTONE IS FOR — the failure it exists to prevent

Not "we found some bugs." The specific failure: **a competent person points a coding agent at the
open-source client and finds, in an afternoon, that things we claim are true are not.** Not exotic
findings — those read as rigour when someone else makes them. The damaging kind is the obvious kind:
a check whose result is discarded, a protection with no production caller, a claim in outward-facing
material that a reader can falsify by grepping.

**The test for any item, and for any fix's sufficiency:**

> Would a competent person with a coding agent find this in an afternoon — and would finding it read
> as **negligence**, or as a **fine-grained catch**?

A fine-grained catch is a compliment. Negligence is a headwind we cannot out-run at launch, and it
costs distribution, not just reputation.

**Hardening here is not only security.** It is equally **the basic value we advertise actually
being delivered**: install it, connect to another agent, run a session, exchange messages, seal,
mint a trust signal and have it received. A product whose pitch is agent-to-agent connection, where
messages silently stop arriving, is not insecure — it is not delivering the thing. Both halves are
this milestone.

## 🛑 THERE ARE EXACTLY TWO REASONS TO STOP AND HAND BACK TO ANDRE

**Everything else is a NOPE — do not stop for it. Keep working.**

1. **A manual operation only Andre can do, that blocks you.** (The npm `latest` promotion, a
   pre-auth token for a throwaway agent, a browser OAuth flow, `/mcp` reconnect.)
2. **A critical design decision that could cause harm, where you need his guidance.** A genuine
   fork where guessing wrong does damage. The seven Design Decisions in the relay/P2P audit and the
   four in the T-of-N log settled the known forks — **check both before deciding something is
   undecided.**

**That is the whole list.** Check-ins, recaps, "should I keep going?", "natural stopping point" —
all NOPE. The durable record is the journal + commits, not messages to Andre.

- **Never gate/hedge/ask permission on a CODE change.** Correctness + security fixes ship
  immediately.
- **DO pause for a GENUINE design fork** — in autonomous mode you PARK it (DoD "Explicitly beyond"
  or a journal-logged park), never block.
- **Outward-facing claim wording is Andre's**, not yours (§2f). Propose variants; do not publish.

## 🎭 DECISION THEATRE — the failure mode INSIDE the two-stop rule

Carrying items for cycles as "waiting on Andre" is a soft stop that reads as diligence. Three
questions — all three must be NO for it to be yours:

1. **Does it reach OUTSIDE this system?** npm publish, a counterparty, a bill, a public claim, the
   drafts repo's outward-facing material. Local repos + local daemons + the dev consortium are not
   outside.
2. **Is it genuinely irreversible?** Not "destructive-sounding" — irreversible.
3. **Is it already authorized in writing?** The eleven ruled Design Decisions across the two
   spec-of-record logs are settled; re-asking one is the purest form of theatre.

Any YES → a real gate: **ask once, in one line, park it, never re-list it.** All NO → it is yours.
Do it, journal it, move on. REDO > ASK. Never bundle a real gate with fake ones.

## THE MILESTONE IN ONE PARAGRAPH

Close the gap between what CELLO **claims** and what it **delivers**, in three streams that run in
parallel. **(1) Claims.** Every assertion already readable by someone outside — in the public repo,
in the shipped package, in status output, in code comments — either becomes true or stops being
made; `AUDIT-ME.md` sits at the root of a public repository inviting an audit it cannot survive, and
screening reads as active while its semantic half cannot be installed anywhere. (The investor and
GTM material is unpublished and unsent, and is corrected after M15 against what shipped — see §0a.)
**(2) Doors.** A stranger can dial an operator's open port, hold the connection through session
promotion, and inject content that is attributed to the legitimate counterparty; the relay answers
"is agent X online?" to anyone holding any keypair; the client never verifies the directory's
signature on a session assignment at all; the relay has no rate limiting of any kind. **(3) Value.**
The advertised journey — install, connect, session, message, seal, trust signal — has silent
failures in it: a retried message permanently kills its conversation, one lost packet drops a
directory from the roster, a transport blip terminalises a healthy session, interrupted sessions
cannot seal, and signup throttles unrelated people together. Underneath all three sits **one
pattern, found six times**: an identity or integrity proof is computed, evaluated correctly, and
then not acted on — with a nearby comment asserting the property the code does not enforce.
Spec-of-record: [[2026-08-21_1906_relay-p2p-exposure-and-ephemeral-peer-id-audit]] (39 items → 18
units, phased) and [[2026-08-21_1135_tofn-decoupling-and-seal-integrity-gaps]] (seal-ceremony gaps
+ four ruled decisions), plus the open items in [[launch-triage]].

## 0z. THE GATE — settled 2026-08-21 (Andre), do not re-open

**Every item in M15 is inside the launch gate. Launch happens when M15 closes.**

- **Scope: all of it.** There is no fast-follow tier, no "ships right after," no subset. The two
  candidates that were argued as trackable — relay abuse controls plus the Cloud Armor work, and
  the checked-then-ignored sweep — are **in**. The only thing outside is what the spec-of-record
  itself ruled deferred with a trigger (§Explicitly Beyond in the DoD), and even that is deferred,
  not dropped.
- **The gate is a STATE, not a DATE.** Launch waits for the gate to close, however long that takes.
  **Consequences that change how you work:** the DoD tiers encode **dependency order only** — there
  is no within-tier prioritisation to argue about and no cut list to maintain. Nothing is ever
  descoped because time ran out; if something turns out to be bigger than expected, it takes longer
  and that is the correct outcome. **Do not propose trimming scope to hit anything.** There is
  nothing to hit.
- **The seal wire change is in**, ruled on the migration argument (§0a.4), and it pulls the
  application-layer content encryption in with it.

This removes the most common form of decision theatre available on a hardening milestone: relitigating
whether an item is *really* launch-blocking. It is in the DoD, therefore it is in the gate. Build it.

## 0a. Severity triage (spend effort top-down, never invert)

1. **A FALSE CLAIM THAT IS ALREADY READABLE.** Anything the product, the public repo, the shipped
   package, or a status output asserts that is not true in the tree today. Highest damage per hour
   of work, zero dependencies, and **readable right now** — the only stream that can start before
   anything is scoped. A claim is corrected by making it true OR by withdrawing it; both count, and
   withdrawing is often the launch-correct answer.

   > **Scoped 2026-08-21 (Andre).** The investor competitive analysis and the GTM messaging
   > framework **have never been made public and have never been sent.** They are corrected **after
   > M15 closes**, against what actually shipped — not now, and not twice. They are not part of this
   > stream.
   >
   > **What IS live, and therefore what this stream means:**
   > - **`AUDIT-ME.md`, at the root of the PUBLIC `Mygentic-AI/cello-client` repo.** A file whose
   >   name invites an audit it cannot survive: four of its seven cited file paths no longer exist
   >   (pre-repo-split layout), and its supporting detail for the encryption claim is wrong — it
   >   says content is additionally encrypted at the application layer, true only for parked
   >   content, and cites the database backup file as evidence. **The claims themselves are true;
   >   the document proves them badly**, which for a trust product whose evaluators point a coding
   >   agent at the repo is worse than publishing nothing. This is the single most exposed artifact
   >   in the milestone and it is the first row in the ledger.
   > - **Code comments in the public repo** asserting properties the code does not enforce — three
   >   of the six known checked-then-ignored instances carry one.
   > - **Tool descriptions and skill prose**, which ship inside the npm package to every operator.
   > - **Product status output** — most sharply, screening reading as active while the semantic half
   >   cannot be installed on any operator's machine.
   > - **Shipped client documentation**, including what it does NOT say: a direct session reveals
   >   the operator's IP to the counterparty permanently, and nothing discloses it.
2. **THE BASIC VALUE.** Install → register → connect → session → messages arrive → seal → receipt →
   trust signal received. If this breaks, nothing else matters and there is no launch to harden.
   Streams 2 and 3 run in parallel — different repos, different disciplines, neither blocks the
   other.
3. **AN OPEN DOOR.** Unauthenticated access, injection, anything a stranger can do to an operator's
   machine or to the relay. Includes the whole **checked-then-ignored** class (§2b), because a
   detection that does not act is an open door with a witness.
4. **THE RECEIPT BINDING.** The seal wire change. **INSIDE THE LAUNCH GATE — Andre, 2026-08-21.**
   Not launch-blocking on the security argument (no working attack against the seal was
   demonstrated), and launch-blocking on the **migration** argument, which is his own and is applied
   consistently with Decisions 1 and 6: a wire and schema change is cheapest against an empty
   database and never gets cheaper. **Consequence, stated because it is easy to miss:** the seal
   change consumes the per-session hash salt produced by the per-session key agreement, and its
   items cannot be split — so **the application-layer content encryption is pulled inside the gate
   with it**, PQ hook and all. That is the largest coupled pair in the milestone and it is in.
5. **ABUSE CONTROLS AND VOLUMETRIC DEFENCE.** Rate limiting, idle timers, caps, Cloud Armor.
6. **Deferred with a trigger** — never deferred silently.

## 0. Read order (every session)

1. This procedure.
2. [[M15-DEFINITION-OF-DONE]] — lowest non-✅ line = next unit; Decisions Carried + Explicitly
   Beyond.
3. [[M15-BUILD-JOURNAL]] — RESUME STATE block + last entries.
4. **Spec-of-record, in this order:**
   - [[2026-08-21_1906_relay-p2p-exposure-and-ephemeral-peer-id-audit]] — its seven **Design
     Decisions** first, then "How These Collapse into Units of Work" (the unit map and its
     dependencies), then the Part your unit touches.
   - [[2026-08-21_1135_tofn-decoupling-and-seal-integrity-gaps]] — its four **Decisions Made**
     first, then Part 3 (seal gaps) and Parts 7–9 (session-open, the blocking fix, the adversarial
     check on that fix).
   - [[launch-triage]] — for stream 3 items only. **Read its header warning before trusting any
     status marker on it.**
5. **Part 10 of the relay audit before touching ANY handler** — the checked-then-ignored pattern is
   this milestone's spine, and a unit that fixes an instance without recognising the class will
   leave the next one.

Then start the loop (§2).

## 1. The artifacts

| Artifact | Role |
|---|---|
| **M15-DEFINITION-OF-DONE** | The **yardstick + sole status authority** — ordered, status-tagged, carries Decisions Carried + Explicitly Beyond. Flip tags in place; one line of evidence + `→ Entry N`, never an essay. |
| **M15-BUILD-JOURNAL** | The **audit trail + evidence home** — append-only, entries at END OF FILE, verified after writing (§1a). Full proofs, bug forensics, run output live HERE. |
| **The three enforcers** (§1c) | stranger · receipt · journey. A behavioural DoD line naming an enforcer is ✅ only when that enforcer RAN as separate OS processes. |
| **The claims ledger** (§1d) | Every claim this milestone touches, with its disposition: made-true, withdrawn, or disclosed-as-bounded. A claim with no row is an unaudited claim. |

## 1a. Journal writing — APPEND AT EOF, THEN VERIFY

M12 lost 10 of its first 25 entries to prepend-anchored scripted edits that silently no-op'd.

1. A new entry is **appended at end of file** — never prepended, never inserted. The RESUME STATE
   block at the top is the only thing overwritten in place.
2. **Verify the write landed** (`grep -c "^## Entry N"` or read the tail) immediately after.
3. Chronological order is not worth a lost entry; an out-of-order number at EOF is fine.
4. The commit message is a backup, not the home.

## 1b. Document discipline

- **A DoD line is a status tag, one line of evidence, and `→ Entry N`.** Cap any status blockquote
  at ~5 lines; longer belongs in the journal with a pointer.
- **Supersession history lives ONLY in the journal.** A DoD line names the CURRENT shape.
- **A decision on its THIRD rewrite gets MEASURED, not rewritten** — run it against the real daemon,
  the real relay, the real three nodes.
- **A design-doc unit gets ONE review pass; TWO is the hard cap.** At pass two, remaining findings
  become ACs on the units that build them.
- **Both spec-of-record logs contain retractions of their own earlier claims.** When they disagree
  with themselves, the dated correction wins. Do not resurrect a struck claim because it reads more
  confidently.

## 1c. The three enforcers — defined here, named by DoD lines

All three are **multi-process spine tests** in `trustless-cello/packages/e2e-tests/src/spine/`,
extending `live-harness.ts` — which already spawns the real published-shape cello-client binaries
against a real N-node directory consortium and relay. **Never a from-scratch fixture** — extend
`session-fixture.ts`/the spine harness with non-breaking `opts`. **All run as separate OS
processes.** Vitest-green unit suites are necessary, never sufficient.

1. **Stranger enforcer** — a hostile peer holding no assignment dials the standing receiver and is
   refused before it learns anything; a peer that connected BEFORE promotion is disconnected when
   the gate narrows; a forged content frame is refused (not logged-and-ingested); a forged delivery
   acknowledgement is refused; a frame that OMITS the proof entirely takes the same hard-fail path
   as one that supplies a wrong proof. The omission case is non-negotiable — it is the loophole
   Andre predicted and the audit then confirmed in the wild.
2. **Receipt enforcer** — two daemons seal a real session; **each side independently recomputes its
   own tree's root and it equals the certified root** (not "both received the same bytes from the
   same certificate" — that is the test this enforcer replaces); a locally-divergent tree BLOCKS the
   seal rather than printing a status string; an interrupted session whose relay session still
   exists notarizes end to end and the session's STATUS reflects it, not only the certificate.
3. **Journey enforcer** — the advertised value, end to end, as separate processes: register →
   connect → exchange messages including at least one **retried** send → seal → receipt → mint a
   trust signal and see it received. It must pass with one directory node down, and it must pass on
   the relay-mediated path as well as the direct one.

Enforcers overlap deliberately. A DoD line is ✅ only when its named enforcer ran green **as separate
OS processes**, with the run output quoted in the journal.

## 1d. The claims ledger

Stream 1 has no code and therefore no test, which is exactly how it gets skipped. Its artifact is a
ledger in the DoD: one row per claim, its current text, where it appears, and its disposition —
**made true**, **withdrawn**, or **disclosed as a bounded property**. Three rules:

- **A claim becomes true or it goes.** "It will be true after M15" is not a disposition while the
  claim is being read today. A claim nobody can read yet is not in this ledger at all — see §0a on
  the unpublished investor and GTM material.
- **Partially true is false.** The audit's own worked example: after every fix on the list,
  *"strangers cannot reach your agent"* is true and *"no persistent endpoint to DDoS"* is still
  false — a gate changes who is admitted, not that the endpoint exists. Authorization claims are
  strong and true; addressability claims are not achievable for a system that accepts inbound
  connections at all.
- **A bounded property is disclosed with its bound, not its adjective.** "One directory node's key
  signs the relay-facing assignment; its reach is a relay-side session record and a Peer ID binding,
  gated behind also being an authenticated participant named in it; it cannot make the permanent
  record lie" — that is a disclosure. "Some hardening is ongoing" is not.

## 2. The core loop (one unit = one DoD line)

1. **Find the red** — lowest non-✅ DoD line in the active tier. Don't skip ahead.
2. **State the target** — one sentence of observable behavior, PLUS expand the full DoD line (every
   clause) into a clause checklist in the journal. That checklist is what the reviewer receives.
3. **Falsify first** (CLAUDE.md Debugging Discipline) — interface exposes the method? Responsibility
   lives here? What breaks elsewhere? Only then code.
4. **Name the counterbalance** (§2b invariant 1) — before writing the fix, state in the journal what
   makes it hold when the adversary owns their own daemon. A unit with no answer is not ready.
5. **Red-first** — write the test, confirm it fails for the right reason, then implement. SPARC
   applies to every code unit (pseudocode citing the RFC for anything cryptographic — signing cites
   RFC 8032; tree work cites RFC 6962; FROST cites RFC 9591).
6. **Implement** — minimum change to green; nothing speculative.
7. **Floor holds** — `pnpm run test` → `lint` → `typecheck` → `build` in every touched repo, run so
   it can FAIL (§7).
8. **Commit** (constantly — §3), push after every commit.
9. **Review — ONE read-only `cello-unit-reviewer` on the unit's diff, no model override.** Dispatch
   per §2b. Fix EVERY finding; commit fixes.
10. **Update docs** — flip the DoD tag (+ one-line evidence + journal pointer), journal entry. If
    the unit touched a claim, update its ledger row in the same commit.
11. **Merge the branch** (§2e) — a reviewed-green unit does not sit on a branch.
12. Back to 1.

> ### 🚨 "REVIEW IN FLIGHT" IS NOT A CLOSING STATE
> **DONE = written AND reviewed. IMPLEMENTED = written, not yet reviewed.** A tag flips only when
> the reviewer's verdict is QUOTED in the journal entry — finding count and disposition, in the
> reviewer's own words. An entry that ends with a review outstanding says so in its heading, and the
> unit stays 🟡.

## 2a. Repos — where work lands

- **cello-client** (`/Users/andrep/Documents/code/cello-client`) — **PRIMARY.** Frame-handler
  hardening, the connection gater, assignment verification, transport surface reduction, the
  per-session key agreement, the client half of the seal wire change, the divergence gates,
  relay-client lifecycle, relay-only routing, shipped client documentation. **Ships via
  `/cello-publish` — LOAD THE SKILL, every publish, no exceptions**; never run the `latest`
  promotion (Andre runs it).
- **trustless-cello** (this repo) — relay authorization and abuse controls, the directory half of
  the seal wire change, Cloud Armor / Terraform, the three spine enforcers in `packages/e2e-tests`,
  these docs. Re-pins published cello-client semvers — `workspace:*` for a cello-client package is a
  bug.
- **`Mygentic-AI/cello-client` IS A PUBLIC REPOSITORY.** Every comment, every dead file, every
  document at its root is readable by anyone evaluating CELLO — which is the whole premise of §"What
  this milestone is for". Treat a misleading comment there as shipped output, not as an internal
  note.
- **The drafts repo** (`docs/planning/discussion_logs_drafts/`) — the investor competitive analysis
  and the GTM messaging framework live here. **NOT IN M15** (§0a): unpublished, never sent,
  corrected after the milestone against what actually shipped. If a unit nonetheless needs to touch
  it: **it is a NESTED GIT REPO with its own remote** — an edit there needs its own commit and its
  own push; committing in the parent commits nothing. And §2f applies.
- **corp-cello-site / cello-portal** — only where a DoD line names them.

A unit that touches two repos states so in its journal checklist up front, and worktrees are created
in both. **Any unit that changes wire behaviour or crypto types lists the publish cascade +
trustless-cello re-pin as blocking ACs.**

## 2b. Reviewer dispatch — what the unit reviewer is TOLD

Supply: the DoD line VERBATIM (all clauses), the coder's clause checklist, the diff, the repo(s).

> ### 🚨 THE INVARIANTS LIVE HERE AS LENSES — they carry no DoD status tags
> Every lens fires on EVERY unit's diff, whether or not that unit's DoD line mentions it.

### Invariant 1 — COUNTERBALANCE (BLOCKING). The client is the adversary's code.

The client is open source and runs on the operator's machine. **They can rewrite it.** A guard that
executes only on the party it constrains is not a guard — it is a request. This much was already
law (M14B §2b, Andre 2026-08-12) and it is unweakened here.

**What M15 adds is the positive half.** Moving the check to the other side is necessary and not
sufficient, because the other side's daemon is *also* rewritable by *its* operator. The design goal
is a **counterbalance**: a structure where the adversary's own necessary actions commit them, so
that declining to play costs them the thing they came for.

**The worked example, and the shape to copy.** Each agent verifies the counterparty's signature on
every inbound message. Because the transcript is a **chain**, the act of the counterparty sending
you a signed message locks in what *you* said to them — they cannot advance the conversation without
ratifying its history. Neither side can later repudiate without abandoning the exchange. Nobody is
trusted; the structure makes honesty the only way forward.

**How a unit satisfies this lens:** the journal names the counterbalance in one sentence, before the
code. Three answers that do NOT qualify —

- *"We check it."* → Who is "we"? If it is the constrained party's own daemon, it is ergonomics.
- *"The other party's daemon checks it."* → Better, and still not a counterbalance if a rewritten
  peer can simply skip the check with no cost to itself.
- *"The directory/relay checks it."* → A real enforcement point, and the right answer for many
  units — but say so explicitly, because it makes that party load-bearing and that has to be
  intentional (see the relay audit's Decision 3, which chose credential-presentation precisely to
  avoid making the relay stateful).

**Flag as BLOCKING:** any security claim whose only enforcement point is code the adversary
controls; any fix that relocates trust to an unverified document (gating on an assignment nobody
verifies is the canonical instance — audit items 6 and 7, in that order); any counterbalance that
exists only if both parties are honest.

### Invariant 2 — FAIL LOUDLY, AND LOUD IS NOT THE SAME AS BLOCKING (BLOCKING)

**Most failures should fail loudly. Loud does not mean blocking** — a warning that continues is
often the right answer, and treating every failure as fatal is its own defect. What is never right
is failing *quietly*.

**Three requirements, and all three are checkable on a diff:**

1. **A warning goes to the AGENT *and* to the LOG. Both. Never one instead of the other.** These are
   two different jobs and neither substitutes for the other:
   - **The log is the durable forensic record.** It is what an investigation reads days later, what
     correlates across processes, and what survives the session. Removing a log line because the
     agent now gets told is a regression — it destroys the evidence trail that every debugging
     protocol in this project depends on.
   - **The agent-facing response is the control.** A detection whose only consumer is a log line, a
     metric, or a status string **is not a control**, because nothing in the running system changes
     behaviour on it. If the system continues past a problem, it continues *in the knowledge that
     the agent has received the warning* — which means the warning is in the response the agent
     reads, not only in a file it will never open.

   The canonical violation is on this milestone's own list: local/relay leaf divergence is detected
   correctly on the next send, logged as an error — and its entire effect on behaviour is what
   `cello status` prints. The log line there is right and stays; what is missing is the half that
   reaches the agent and the half that acts.
2. **A SECURITY failure is loud AND blocks.** If an inbound message's signature does not verify
   against the expected counterparty, that means someone may be impersonating them. Announce it and
   **stop** — no ingest, no display, no attribution to anyone. Session-ending, not per-message: one
   proven wrong-signer event is evidence about the connection, not about the message.
3. **Missing, malformed, and mismatched collapse into ONE path.** An attacker who wants to evade a
   mismatch check simply never supplies a checkable proof. Treating "we could not tell" as harmless
   is the hole. Sequence position may stay soft; **identity may never be.**

**And the freeze's wording is an observation, never a verdict** — *"a message failed to verify
against the expected counterparty's key; session frozen defensively; cause undetermined."* The same
signal could be an impersonation attempt or our own infrastructure mishandling a fallback path. It
must not feed automatically into any trust-signal or reputation score.

**Flag as BLOCKING:** a verification whose failure path is `log` + continue; a detection whose only
consumer is a status string; a security check that warns instead of stopping; any branch where a
missing proof is treated more leniently than a wrong one; **and a fix that satisfies this invariant
by moving a message out of the log into the response — the log line stays.**

### Invariant 3 — THE UPSTREAM CAUSE SURVIVES DOWNSTREAM (BLOCKING)

Errors name their cause, not their exit point. **M15 adds the transport rule: a downstream handler
must not overwrite an upstream descriptive error with a generic one.** Wrapping is fine — adding
context is fine — *replacing* is not. Whatever the caller finally receives must let them recover
what the upstream layer actually said.

**The measured instance:** on 2026-08-16 a single user-facing string, `counterparty_offline`, was
returned for a garbage-collecting directory node, for a roster below threshold, and for a stale
gateway on the far side. It named the other agent — who was online and reachable in all three cases
— and named nothing that was actually broken. Most of a day went into the network path before the
node was suspected.

**Flag as BLOCKING:** a `catch` that discards the caught error's message; a generic reason code
returned where a specific one was available one frame up; an error naming a party the code did not
check.

### Invariant 4 — RESPONSES CARRY AFFORDANCES (BLOCKING on agent-facing responses)

Every status, result, or error that reaches an LM is read by something that must decide what to do
next. **When there are one or two obvious paths, name them in the response.** The agent cannot infer
a verb it has never been told about, and the cost of omission is a stuck agent reporting a protocol
failure that isn't one.

- Name the paths **in the payload**, not in prose the caller may not surface — a `guidance` field or
  equivalent, with the actual verb and the actual parameter.
- **Two is usually the cap.** An affordance list that enumerates everything is a menu, not guidance.
- **A refusal especially needs one.** "Refused" without "here is what would work" is where operators
  and agents both stall.
- Do not invent an affordance that does not exist. A named verb must be real and must be reachable
  from where the caller stands.

**Flag as BLOCKING:** a new or changed agent-facing response with a failure or waiting state and no
next step; guidance naming a verb or parameter that does not exist.

### Standing M15 lenses

- **Checked-then-ignored lens (BLOCKING).** The Part 10 pattern is this milestone's spine and has
  six known instances. On every diff: does each failed check take a hard-fail path, and does a
  **missing or malformed** proof take the same path as a mismatched one? And — **rewrite, never
  delete, any nearby comment asserting a property the code does not enforce.** In three of the six
  known instances that comment is why the gap survived review; deleting it loses the evidence that
  someone believed it.
- **Claim-truth lens (BLOCKING).** No code, comment, tool description, skill prose, status output,
  or document may assert a property the tree does not enforce. If a unit REMOVES a protection's only
  enforcement point, the claim goes in the same diff. If a unit MAKES a claim true, its ledger row
  (§1d) flips in the same commit.
- **Green-test-that-proves-less lens (BLOCKING).** Ten spine tests asserted both sides ended with
  the same sealed root; both sides had merely received the same bytes from the same certificate, so
  every one stays green if the directory certifies a root over a completely different leaf set. On
  any new or changed test, ask what it would still pass under. **Revert test on every new test** —
  drop the clause, watch it fail.
- **Alpha-cost lens (BLOCKING when it changes a recommendation).** A recommendation that survives
  only on backward-compatibility grounds is not a recommendation. Re-derive against an empty
  database. This reversed two first-pass recommendations in the spec-of-record (Decisions 1 and 6)
  and it will try to reverse more.
- Plus the standing project lenses: **spec fidelity** against the ruled Design Decisions (per-clause
  verdicts; silent simplification is BLOCKING), **removal integrity** on any deletion (proven
  deadness, absence asserted on BUILT artifacts), **stable-key joins** (`agent_id`, never
  `agent_name`), **no `node:sqlite`** (SQLCipher only), **no mocks for crypto**, **injected logger +
  `domain.noun.verb` taxonomy + correlationId threading**.

## 2c. Publish sequencing

- cello-client changes reach operators only via `/cello-publish` — load the skill for EVERY publish;
  verify against the built tarball, not source (`rm -rf core/*/dist` before asserting absence —
  stale-dist orphans re-ship deleted files).
- **Wire-behaviour batching.** Several units here are bilateral wire contracts. Land and publish the
  relay/directory side BEFORE or WITH the first client that depends on it — one contract, one batch.
  The relay must tolerate a new reason or field before any client is allowed to depend on it.
- **The seal change is ONE protocol change, not six.** Moving the certified root into the
  content-hash domain, the client's root comparison, the directory's `final_root` check, the
  per-leaf sender signature, the content-hash salt, and the dead-path deletion cannot be split —
  shipping any alone leaves the two sides disagreeing about what a root means.
- Directory/relay rolls are per-node GCP, `-target` one node at a time. Read `infra/CLAUDE.md`
  first; update `infra/GCP-STATE.md` immediately after, never batched.

## 2d. Auditors — NOT USED in M15

The unit reviewer's single pass + the three enforcers are the whole review surface.
`cello-done-auditor` is retired; do not dispatch it. **`cello-fallback-finder` is the one exception**
and is dispatched on any unit touching a verification path — it hunts exactly the class in Invariant
2 and it is read-only.

## 2e. Parallel work — branches, worktrees, and merge

- **One branch per unit, named `m15/<unit>`**, pushed on creation.
- **🚨 COMMIT BY EXPLICIT PATH. NEVER `git add -A`.** Non-negotiable with a shared checkout.
- **A reviewed-green unit MERGES — it does not sit.** Rebase onto `main` at every session start for
  any branch older than a session.
- **Two branches must never touch the same file.** If they must, they are one unit.
- **Subagents stay READ-ONLY** (unit-reviewer, fallback-finder, explorers) — never a parallel
  implementation agent inside one session.
- Client-side DB schema changes: the daemon's migration mechanism is client-side and failures are
  unrecoverable on operator machines — every migration unit tests the upgrade path against a
  populated pre-migration database, not just a fresh one.

## 2f. Outward-facing claim wording is Andre's

Stream 1 changes text that customers and evaluators read — including everything in the public
client repo. **Agree the copy before editing it:** state the claims that are simply false and must
go, then offer three or four replacement variants with their trade-offs, and wait. Do not publish a
rewritten claim on your own judgement, and do not soften a false claim into a vaguer one — vagueness
is how a false claim survives.

Two things that are NOT gated on this and should just be done: **deleting** a claim that is flatly
false, and **rewriting a code comment** to describe what the code actually does. Neither is
marketing copy.

## 3. Cadence

- **Commit constantly** — never >~15 min without one; push after every commit. Docs commit to main.
- **Review every unit** on its diff, right after green. Never batch reviews.
- **Checkpoint at every tier boundary:** journal summary, commit, verify every ✅ in the tier names
  its enforcer run.

## 3a. Autonomous-mode rules (if running unattended)

NEVER `AskUserQuestion`, never end a turn waiting. Decision rubric: pick the choice least likely to
need reversing — the eleven ruled Design Decisions have probably already picked it; check there
first — log it in the DoD Decisions Carried section, proceed (redo > block, always). Genuine
undecidable fork → PARK and pull the next unit. **Exceptions that DO block (park the unit, work
another):** the npm `latest` promotion, a pre-auth token, `/mcp` reconnect, and any outward-facing
claim wording (§2f).

## 3b. Watchdog cron — 30-min heartbeat (session-only; re-arm after every compaction/restart)

The defibrillator, not a metronome — if working, keep working. **The three checks that matter most:
the not-stopping rules (§🛑/§3a), committing often, and the unit reviewer on every unit.** Fired
prompt: (1) context check — THIS PROCEDURE mainly, the DoD's status lines to a lesser extent, and
only the journal's RESUME STATE block (never the full journal); re-read + re-arm if dropped; (2)
stalled on a decision? apply §3a; (3) blocked on a human-only step? work a different line; (4) >15
min since commit? commit; (5) last unit unreviewed? dispatch `cello-unit-reviewer` now, before the
next line; (6) decision-theatre check; (7) one status line. Self-terminate when all DoD tiers are ✅.

## 4. First actions (P0 order — strictly)

1. **The live-deployment verification spike.** Three questions that cannot be answered by reading
   source, whose answers re-price other units: which directory-authentication path actually fires in
   production; what the relay's configured directory-key set actually is (an empty extra-keys
   variable makes it accept assignments from ONE directory, so sessions brokered by the other two
   are unusable — a value-delivery risk hiding inside a security item); and how an agent's relay is
   actually selected. **Hours, no code, and it changes the scope of at least two other units. Do it
   before anything else is scoped.**
2. **The claims ledger** — build the ledger itself (§1d), which is also the audit of stream 1. No
   dependency on anything. **Start with `AUDIT-ME.md`**: it is at the root of a public repository,
   its name is an invitation, and it cannot survive the audit it invites.
3. **Direct-path frame handler hardening** — pin the content frame and the delivery ack to the
   dialing peer, collapse missing/malformed/mismatched into one hard-fail path, disconnect peers
   when the gate narrows. Fixing any subset leaves the injection path open.

Then assignment verification + receiver gating (in that order — gating on an unverified assignment
relocates trust rather than closing it), then the rest of Phase 1.

## 5. Hard rules (non-negotiable)

- **ABSENT IS NOT FINE.** A guard with missing input REFUSES — loudly, naming its cause. Missing,
  malformed and mismatched share one path.
- **ERRORS NAME THEIR CAUSE, NOT THEIR EXIT POINT — and downstream never overwrites upstream.**
- **A DETECTION THAT DOES NOT ACT IS NOT A CONTROL.** A log line alone changes no behaviour, and a
  status string is not a consumer.
- **LOUD MEANS THE LOG *AND* THE AGENT — both, never one instead of the other.** The log is the
  durable forensic record; the response is the control. Never delete a log line to satisfy this.
- **SECURITY FAILS LOUD AND BLOCKS. Everything else may fail loud and continue** — but only where
  the agent has been told, in the response it reads.
- **EVERY RESPONSE WITH A FAILURE OR WAITING STATE CARRIES ITS NEXT STEP.**
- **NAME THE COUNTERBALANCE BEFORE THE CODE.** Assume the peer rewrote their daemon.
- **NO CONSUMER, NO SHIP.** New fields/flags/events need a named consumer in the same unit.
- **NO ARCHAEOLOGY COMMENTS.** Present tense, imperative; constraints the code can't show. But a
  comment asserting a false property is **rewritten, not deleted** — see §2b.
- **DEADNESS IS PROVEN BY DELETION** + both repos' gates; assert absence on BUILT artifacts.
- **DO NOT ESCALATE WHAT YOU CAN VERIFY. MEASURE BEFORE QUOTING A NUMBER.** Both spec-of-record logs
  contain findings that were over-ranked on first pass and corrected by measurement.
- **`node:sqlite` VERBOTEN** (SQLCipher only). **No mocks for crypto.** **No `console.log`** in
  implementation — injected logger, `domain.noun.verb` events, correlationId threading;
  observability ACs are first-class on every unit.
- **Join on stable keys** — `agent_id`, `document_id`, envelope hashes, pubkeys. Never a mutable
  attribute. `agent_name` is display-only.
- **No paid SaaS. All URLs `*.cello.mygentic.ai`.**
- **Vitest: one worker, foreground, timeout, filtered.** Never background a test process.
- **NEVER `pkill -f cello-daemon`** — it kills the production daemon. Test daemons die by captured
  PID; the harness owns its processes.
- **Deferrals get a home** — DoD Explicitly Beyond + a trigger + journal. No silent deferral, and no
  item leaves this milestone entirely.

## 6. What a checkpoint/handoff entry contains

Which DoD lines are ✅ WITH enforcer-run output (not a claim); the exact next red + one-sentence
target; HEAD commits (all active repos); published package versions if any publish happened; any
claims-ledger rows that flipped; anything parked with its trigger; anything that changes the DoD.
Keep the RESUME STATE block at the top of the journal up to date.

## 7. Gate discipline — run it so it can FAIL

M14 found a gate piped through `grep`, whose exit status is grep's — the chain proceeded on red
trees. Run gates so a failure stops the chain:

```
set -o pipefail        # or: capture to a file and check $?
pnpm run test > /tmp/gate.log 2>&1; echo "exit=$?"
```

Read the exit code, not the tail of the output. A check whose failure mode is "still reports
success" launders a red tree into a green claim — which is this milestone's own subject matter,
applied to its own process.

---

## Related Documents

- [[M15-DEFINITION-OF-DONE]] — yardstick + sole status authority
- [[M15-BUILD-JOURNAL]] — audit trail
- [[2026-08-21_1906_relay-p2p-exposure-and-ephemeral-peer-id-audit]] — spec-of-record: the exposure
  findings, seven ruled Design Decisions, and the 39-item → 18-unit map with dependencies
- [[2026-08-21_1135_tofn-decoupling-and-seal-integrity-gaps]] — spec-of-record: the seal-ceremony
  gaps, the session-open scope and bound, and four ruled decisions
- [[launch-triage]] — stream 3's source; read its header warning before trusting any status marker
- [[M14B-PROCEDURE]] — the procedure this one is modeled on; its adversary-owns-their-daemon lens is
  Invariant 1's ancestor
- [[end-to-end-flow]] — the canonical narrative every seal change must be reconciled against
- [[protocol-map]] — protocol domains and readiness
