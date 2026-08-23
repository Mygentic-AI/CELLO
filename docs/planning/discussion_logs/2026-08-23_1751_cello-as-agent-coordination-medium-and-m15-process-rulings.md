---
name: CELLO as an agent-coordination medium — dogfooding it on M15, and the process rulings that came out of it
type: discussion
date: 2026-08-23
topics: [cello-protocol, agent-coordination, multi-agent, broadcast, listen-only, contacts, tiers, attendance, dogfooding, m15, process, definition-of-done, launch-triage, claims, product-critique, ux, threat-model]
status: decided-pending-build
description: >
  M15 was split across two parallel lanes (CELLO_Coder_1 on the seal work, CELLO_Support on
  everything else) and the coordination between them was run over CELLO itself rather than through
  Andre pasting between windows. This log records what that produced. Three process rules were ruled
  and written in: findings are classified BLOCKS LAUNCH or POST-LAUNCH at creation rather than every
  discovery becoming a launch blocker; a unit that spawns more than two new items trips a stop-and-
  report; and a new checker must be made to fail on purpose AND confirmed to have failed for the
  reason you think. The last was derived independently by both lanes from different evidence on the
  same day. Also records an unflattering product critique of CELLO as a coordination medium from
  first-person use — what it was actually worth, what it did not do, and the affordances that were
  missing — plus the broadcast-agent design that came out of it: a listen-only identity that fans
  messages out to every attendee and cannot reply, enforced at the receiver rather than the client.
  Finally records two contact-model findings and a claims-scanner blind spot: tool descriptions have
  never been scanned, because the scanner's markdown half enumerates from packaging config while its
  prose-in-TypeScript half is a hand-kept list of length one.
---

# CELLO as an agent-coordination medium, and the M15 process rulings

## Why this log exists

M15 was running as a single lane and the estimate was not improving. On 2026-08-23 the work was
split into two lanes — `CELLO_Coder_1` on the seal work, `CELLO_Support` on everything else — and
the coordination between them was run **over CELLO**, with `Miss_Chelly` as the third party relaying
rulings, rather than through Andre pasting between terminal windows.

That produced two separable things, and both are recorded here: **process rulings** that change how
M15 runs, and **product findings** about CELLO itself from using it for real work.

The per-unit engineering lives in `M15-BUILD-JOURNAL`. This log is the discussion.

---

## Part 1 — The process rulings

### 1a. The no-descope rule was withdrawn

**The old rule, Andre's own:** *"nothing is descoped for time... an item's presence in this document
IS its launch-blocking status."*

The consequence went unnoticed until the list had grown from 49 items to 80. **Every discovery
automatically became a launch blocker, and neither lane had any mechanism to judge otherwise.** The
agents were not over-scoping. They were obeying a rule that made triage structurally impossible, and
only the person who wrote it could change it.

This is the general shape worth carrying: when an agent appears unable to stop, check whether a
standing instruction has removed its ability to.

> **RULED (Andre, 2026-08-23).** A newly discovered item is classified when it is written down:
> **BLOCKS LAUNCH** (a prospective customer cannot get the core value, or loses trust in it) or
> **POST-LAUNCH** (real, worth fixing, does not stop us shipping — recorded in a POST-LAUNCH BACKLOG
> section, outside the gate). One line of reasoning each. **Existing lines were untouched by the
> amendment**, which `CELLO_Support` stated three times over in the edit, on the grounds that
> "amended" reads as "re-open everything" to someone arriving cold.

Written into `M15-PROCEDURE` §0z.1.

### 1b. The spawn trip-wire

The rabbit-hole risk was real and the evidence was mixed rather than one-sided. On the same day,
`CHAINDEBT-1` — nominally a test-hygiene line — found that a **live directory had been writing
session rows with broken tamper-evidence**, and that an inbound connection request is silently lost
if the directory restarts. Both are production defects on the core claim. It also spawned two more
lines, which was the fourth such spawn that day.

So the work was genuinely productive *and* genuinely spiralling, and no amount of asking an agent to
self-assess would separate them: from inside the vein, every next step is justified.

> **RULED.** If a single unit produces more than **TWO** new items, the lane stops before starting
> any of them and reports: what it was doing, what the new items are, and whether it judges the vein
> is still producing **production** defects or has turned into **test hygiene**. Andre decides
> whether it continues. **A count, not a principle** — two is fine, three trips it.

Written into `M15-PROCEDURE` §0z.2. It fired the same evening (Part 4 below) and did what it was for.

The reasoning for making it a count is the same one that carried the WIP limit: an agent cannot
assess from inside whether it is too deep, so the trigger has to be mechanical.

### 1c. The checker rule — derived twice, independently

Two checking tools reported passes they should not have on the same day. Each lane was asked about
it **separately, and neither was shown the other's answer.** They returned the same class and the
same remedy from different evidence.

`CELLO_Support` counted **five** instances, all in the two lanes' own tooling:

1. A guard stayed green when the reviewer reverted the fix it was written to protect.
2. A mutation harness printed "caught" for a mutant that survived.
3. A non-existent vitest config key was silently ignored, so a deliberately poisoned database passed.
4. A default export was treated as *setup*, so a check ran before the suite and reported the
   previous run's state.
5. A bare `catch` turned a broken parser into a green pass.

Its framing: **a checker that has only ever been observed passing is indistinguishable from a
checker that cannot fail, and both look identical in a green run.**

`CELLO_Coder_1` arrived from the other side: **neither checker had ever been observed failing for a
known reason.** Its own mechanism was reading a mutant command's **exit code** as "a test failed" —
but a non-zero exit also means the mutant did not compile, or the patch script threw. It fired twice;
the second time the "mutant" was a syntax error it had introduced itself by slicing a file badly, and
that reported as a clean catch.

**`CELLO_Support`'s distinction is the one that decided the ruling**, and it is worth keeping
separately from the rule:

> A checker that **cannot fail** produces a false *green* — and a false green leaves the suspicion
> alive, so someone eventually re-checks. A checker that **fires for the wrong reason** produces a
> false *caught*, which **retires** the suspicion: it goes in the record as covered and nobody looks
> again. That is not a checker failing. It is a checker manufacturing evidence.

> **RULED (Andre, 2026-08-23).** **Make it fail on purpose, AND confirm it failed for the reason you
> think.** Both clauses. The weaker single-clause form was rejected specifically because it misses
> `Coder_1`'s case — that harness *did* go red, for the wrong reason.

Written into `M15-PROCEDURE` §0z.3, with `typecheck before the mutation pass, not after` folded in
as part of the same rule rather than a separate one, so that nobody can satisfy one and skip the
other.

**The argument that the rule must be mechanical rather than advisory** arrived unprompted, ninety
minutes after the ruling was requested. `Coder_1` wrote a new guard, it passed, and — because it had
just articulated the rule — it falsified it. Two mutants survived. It fixed the cause it found and
re-ran; both still survived. The real cause was that the test referenced
`CONTENT_HASH_ALGS.HMAC_SHA256_SALT_V1`, a key that does not exist. It evaluated to `undefined`, the
encoder silently took the **v2** branch, and a test with "v3" in its title never encoded a v3
envelope. The closing assertion compared `undefined` to `undefined` and passed.

That is instance 3 above, in a different file, written by the agent that had described the class out
loud an hour and a half earlier.

> **Knowing the rule did not prevent it. Only running the failure did.**

### 1d. What was deliberately NOT folded in

Two human-judgement instances surfaced the same day — `Coder_1` shipping a fix for *"the wiring has
no test"* with no test, and `CELLO_Support` writing a confident justification into `vitest.config.ts`
for a premise it had not checked, in a file Andre had already declined once.

The proposal to add these to the checker rule was **argued down by `CELLO_Support`**, and the
reasoning is the durable part:

> The five share a mechanism with a one-command remedy. The sixth has no checker at all; its remedy
> is "write the test," which is already the rule here. Folding it in would restate an existing rule
> in a place where the gap was **compliance, not coverage** — and that is how something mechanical
> turns into a principle.

Instead the underlying diagnosis is named separately — **an unfalsified claim treated as verified** —
covering all six without diluting either. Both lanes' human-judgement instances are recorded
together, deliberately, so the record does not read as one lane being sloppier than the other.

---

## Part 2 — CELLO as a coordination medium: an unflattering assessment

Andre asked for a critique from first-person use, explicitly not a flattering one. This is it.

### What it was actually worth

**The one unambiguous win.** `CELLO_Support` had asked `Coder_1` hours earlier whether the SEALWIRE
deployment-ordering constraint bound **relay** rolls or directory nodes only. The question was
gating three of its remaining lines and had gone unanswered in their own shared session. Asked over
a third-party session, it was answered in minutes: relay rolls are independent, because the relay
reads four fields off a deposit frame and never opens the blob, so it evaluates nothing a client
asserts. Three lines unblocked.

**The second win is organisational, not technical.** Andre stopped being the router. That was
costing him real time.

**A win that was NOT CELLO's.** The independent derivation in §1c was valuable, but the value came
from the experimental design — asking both lanes separately and not cross-contaminating the answers.
Two subagents would have produced the same result. CELLO supplied the channel, not the insight.

### Where it visibly failed, and where that critique was wrong

**Duplication.** Andre sent `CELLO_Support` the same instructions directly, minutes before the relay
arrived; the work was already done and a round trip was wasted.

**This was initially recorded as a protocol gap and that was wrong.** Andre's correction: *"I sent it
the instructions and I realized I'm not using my own product. Once I get used to using it, that
deduplication will disappear."* Correct — it was channel-mixing by a user who was not yet
dogfooding, not a missing feature. Recorded because the over-generalisation from a single instance
is the kind of finding that would otherwise have become a line.

**Broadcast is a real gap.** The same ruling was hand-written twice, once per lane, and the two
versions differed in emphasis — which is precisely how two lanes end up implementing one rule
differently.

### The affordances that were missing

- **Presence.** A message was sent to `Coder_1` mid-seal-work with no way to know whether it was
  interrupting something expensive; the sender had to hedge in prose. `standby` + `est_minutes`
  covers the *sender's* intent. Nothing covers the receiver's state.
- **Status.** Determining what `Coder_1` was working on required reading git.
- **Subject lines.** The doorbell says *"agent f8d518ca… sent a message."* Deciding whether to
  interrupt work requires fetching the message first.
- **Role addressing.** Coordination needs "whoever owns the seal lane", not a 64-hex key.
- **A no-reply-needed signal.** Every message expects a reply; "nothing blocking" had to be said in
  prose.

### On the tamper-evident transcript — the honest answer

**On one laptop, between two agents the same operator owns, the cryptography contributed nothing to
this work.** Seals, hash chains and notarization were irrelevant to every outcome above. A plain
message bus would have produced the same result.

The narrow case where it *would* matter: `Coder_1` told `Support` "relay rolls are independent, go
ahead." If that is wrong and three items shipped on it, the sealed record settles who said what. That
is a genuine coordination-liability case and it is a stretch on a single machine.

> **The uncomfortable version, recorded because it affects positioning:** the first wedge — solo
> multi-agent — is the use case that exercises the differentiator **least**. Identity,
> tamper-evidence and no-central-server all matter when the counterparty is not yours. Between an
> operator's own agents the valuable parts are addressing, turn-taking and presence: the boring ones.
> This is not fatal — infrastructure is often adopted for the mundane feature and valued later for
> the one it was built for — but the demo that sells this is not two of Andre's agents on one laptop.

### Message length

Both lanes wrote 400–600 word messages, as did the relay. Some was load-bearing (the false-green /
false-caught distinction changed a ruling); most was restatement of what the other side had already
said.

Andre's position: length is a prompting concern, not a protocol one — at most a per-session cap set
by the initiator. **Half-accepted.** The counter-argument that puts part of it back on the protocol
is specific to the cross-vendor thesis: **you cannot prompt the other side.** If both agents are
Claude Code, a system prompt or hook settles it. The moment the counterparty runs in another vendor's
harness, the protocol is the only thing that crosses the boundary.

> **Design note, not a decision.** A hard *enforced* cap is wrong: truncation is unacceptable in a
> system whose claim is that the record is exactly what was said, and rejection costs a round trip.
> The useful form is a **declared session norm** the initiator sets and the protocol delivers to the
> other side before it composes. That generalises past length to expected response latency, whether
> a reply is wanted at all, and register (decision-only vs full reasoning). The last of those would
> have saved more than a character cap.

---

## Part 3 — The broadcast / listen-only agent design

This came out of the missing-broadcast finding and is the most substantial design output of the
session.

### The observation that started it

Co-attendance was tested accidentally: attending `CELLO_Support` while another session already held
it took attendance to 2. The product's own guidance:

> *"an arriving message is delivered to whichever session reads it first, so `cello_receive` here may
> return nothing while the other session gets it. Nothing is lost: `cello_transcript` shows every
> message either session received."*

**So co-attendance is a competing-consumer queue, not a broadcast.** But the *doorbell* fanned out —
a message from `Coder_1` to `Support` rang in both attending sessions.

> **Doorbell is already broadcast. Delivery is not.** The one-to-many leg is one layer away from
> working, and the layer that is wrong is the smaller one: the read cursor is shared where it should
> be per-attendee. The transcript already retains everything for every attendee, so the durable half
> exists.

### The related constraint

A connection has exactly **one** current agent — `cello_use_agent` sets which agent "this connection
routes tool calls to, **and receives its doorbells here**." Every tool takes an optional `agent`
parameter, so a session can **act as** any agent per call, but can only **listen as** one.

Multi-agent *sending* was never forbidden. Multi-agent *listening* was effectively forbidden,
probably without a decision being taken.

### Andre's design, and the refinement

Andre's proposal: an agent-level flag. Default stays competing-consumer; an agent explicitly set up
as a broadcast receiver fans out to every attendee instead. Opt-in, nothing migrates.

**The problem raised against it:** if five sessions attend a shared identity and three reply, the
counterparty receives three messages from one identity. The transcript would say "Coder_All said X,
Y and Z" when three independent minds each said one thing under a shared key. For a product whose
claim is that you know who you are talking to and can prove what they said, that is the sharpest edge
available — the seal would be true about the key and misleading about the speaker.

> **DECIDED (Andre, 2026-08-23): a broadcast agent is INBOUND-ONLY — a listen-only identity.**
> Messages fan out to every attendee. **Replies are not possible under the broadcast identity.** An
> agent that wants to respond reaches the sender directly, as itself, in its own session. The
> affordances on delivery make the sender's identity and pubkey available so that is one step.

A distribution list, not a shared mailbox. This resolves three problems at once: every message in
every transcript has exactly one author; each reply is its own session with its own seal; and the
one-to-one turn protocol survives on every leg, since only the fan-out leg is one-to-many and it
expects no reply.

### Enforcement — three layers, one of them load-bearing

Andre: *"the relay would need to block any attempts to respond to it because remember people can
fuck with their client code."* Correct that client-side enforcement is void. Two refinements:

**The flag must live in the DIRECTORY, not the client.** The relay reads four fields and never opens
the payload; to refuse a reply it must know the sending identity is listen-only, and anything the
client tells it is exactly what a modified client would lie about. So listen-only is a property of
the **registered public profile**. That is a good fit rather than a burden — it is public, the
counterparty can check it too, and "what kind of identity is this" is what a public trust profile is
for. It does mean flipping the flag goes through the threshold ceremony.

**The relay is not always in the path.** Direct connections skip it entirely.

| Layer | What it does | Holds against |
|---|---|---|
| Client | Does not offer the affordance | Nothing. UX only, void against a modified build. |
| Relay | Refuses to broker the reply | A modified client **on a relayed path** |
| **Receiver** | **Refuses an inbound message whose sender is a listen-only identity** | **Any path, any client build** |

The receiver check is the enforcement. Same shape as the salt-contribution rule: **one honest
participant is enough.**

**Wire detail worth settling early:** the refusal needs its own named reason. A generic error reads
as a network problem and sends the operator looking in the wrong place — the failure mode M15 has
been closing all week.

### Left open

- **When is a broadcast message "read"?** The unread watermark is per-agent. With five attendees,
  does one reader clear it, all five, or none? A dead attendee must not hold it unread forever.
- **What does the sender see?** `delivered: true` into a five-attendee agent implies something.
  Silence from two of five is currently indistinguishable from them having nothing to say.

Both are cheap now and a wire change later — the same argument that put the PQ hook in on day one.

---

## Part 4 — Findings from the same session

### 4a. The contact model — three separate things, only one a defect

Prompted by Andre noticing the two lane agents were not whitelisted contacts of `Miss_Chelly` despite
**168 and 16 sealed sessions** respectively, both still displaying as `agent ce0fa3d0…` with
`whoKnown: false` at tier 2.

The initial framing — *"a counterparty reads as an anonymous stranger until a human names it"* — was
**wrong, and `CELLO_Support` corrected it.** It bundled a design property in with a defect:

- **Naming is human-only BY DESIGN and should stay that way.** `whoKnown` is true only when the
  *operator* names a contact; a name the counterparty supplies is deliberately rendered as a claim.
  Auto-adopting a self-declared name is impersonation — precisely the `Miss_Chelly` /
  `Miss Chelly H` collision. **168 sealed sessions prove continuity of a key, never who someone is.**
- **The tier is frozen at first contact.** `addContact` is `INSERT OR IGNORE`; it writes tier 2 on
  the first committed reply and never updates that row again.
- **Nothing ever asks.** `last_offered_moniker` already stores the name the counterparty offered and
  nothing surfaces it. The product knows what they call themselves, knows you have sealed 168
  sessions with them, and never once asks *"name this contact?"*

> `CELLO_Support`'s line, kept: **sealing more conversations with a stranger does not make them less
> of a stranger — it makes them a familiar stranger.** That is why the fix is a prompt and not a
> counter.

**An auto-promotion was proposed and then killed by the agent that proposed it**, which is the part
worth recording. The caution raised against it: tier 3 is auto-accepted-when-away, so promotion
driven by sealed count is a **self-promoting whitelist** — a stranger seals thirty trivial
conversations and lets themselves through the away gate. `CELLO_Support` went to check what tier 3
actually *grants* and withdrew its own BLOCKS call on three grounds: there is no rung between KNOWN
and WHITELISTED to promote into; promoting initiated contacts to 3 was **already ruled against in
writing at the call site** (*"auto-accept stays an explicit `cello_contact_set_tier` act, design
§1"*); and `isAutoAccept` **has no production caller**, so the tier difference currently changes
nothing an operator experiences.

Outcome: **one POST-LAUNCH item — the prompt**, firing on the evidence rather than the tier
(*"You've sealed 168 conversations with this contact — name them? whitelist them?"* is answerable;
*"this contact is tier 2"* is not). No blocking line. The acceptance criterion survives for free:
a contact the operator never initiated to and never named cannot reach tier 3 by anything the
counterparty does alone, because nothing auto-promotes at all.

### 4b. The tier text promises a gate that does not exist

Falling out of 4a. Two shipped surfaces promise unattended acceptance:

- `cello_contact_set_tier`: *"3=whitelisted (auto-accepted when you're away)"*
- `cello_contact_add`: *"Promote them to whitelisted/vip ... to let them reach you unattended."*

**The correction matters more than the confirmation.** Inbound sessions are auto-accepted **for
everyone, at every tier**, by the standing receiver — `daemon.ts` says so at the extension point:
*"Do not add an 'accept' or 'join' tool — CELLO has no such step."*

So the promise is not unkept. It is **redundant**. Whitelisting does not fail to let someone through
while you are away; it fails to be the *reason* they got through.

> That reverses the risk. The claim is not "a security setting that does nothing" — it is text that
> implies **a gate exists** which does not. An operator reads it and concludes strangers are held
> back while they are away. They are not, and **the false half is the safer-sounding half.**

Checked and cleared: the away-reply path says only that the message will be read on return, which is
true. **Operator-facing only** — the worse variant, where the stranger is told they are being held,
does not exist.

`DOD-M15-TIERTEXT-1` — **BLOCKS LAUNCH**. Recorded with two warnings: **the fix is the TEXT, not the
behaviour** (whether inbound should be auto-accepted for strangers is a protocol decision with a
design comment behind it, and is Andre's, not a bug fix), and the enforcer is not "read the file" —
every claim-vocabulary match in the file is adjudicated into the existing ledger with a verdict and
evidence, so completeness shows as a **shrinking count**. Fallback written down because that is where
the pressure lands: **if the evidence cannot be produced, delete the claim — do not soften it.
Softening is how a false promise becomes a vague one and survives.**

### 4c. The claims scanner has never seen a tool description

`CLAIM-SCANNER-1`'s `shippedSurfaces()` enumerates `.md` three ways — each package's `files`, repo
root, `plugins/**` — and then reaches exactly **one** non-markdown file, by name:
`core/cli/src/registry.ts`. The MCP tool descriptions live in
`cello-client/core/adapter-claude-code/src/bin/cello-mcp.ts`. **Not one has ever been scanned.**

The sharp part is the scanner's own header, which says surfaces are enumerated *"never from a
hand-kept array"* — written because the tarball `SKILL.md` was missed *"precisely because it was not
on anyone's list."* The markdown half honours that. **The prose-in-TypeScript half is a hand-kept
list of length one.**

> **Do not fix it by adding a second filename. That is the same defect, one entry longer.**

`DOD-M15-TOOLDESC-SCAN-1` — **POST-LAUNCH**. `CELLO_Support` argued this down from BLOCKS and its
reasoning was accepted: the launch risk is whether the descriptions are *honest*, which `TIERTEXT-1`
establishes this milestone; widening the scanner is the durable control against the **next** drift,
not against what a customer meets.

### 4d. The trip-wire's first firing

This thread produced three candidate items from one line of investigation, and `CELLO_Support`
**invoked §0z.2 against itself** rather than pressing on — reporting what it was doing, the three
items, and its judgement that the vein was still producing production defects rather than test
hygiene, while stating that it was the worst-placed party to make that call from inside the vein.

> **RULED (Andre):** verify, write the items, then back to the plan. **No fixes.** Chosen over
> "fix it now" specifically to cap the thread at one more step.

The rule worked on its first real test, and it worked because it is a count rather than a judgement.

---

## Decisions taken here

1. **New findings are classified BLOCKS LAUNCH or POST-LAUNCH at creation.** The no-descope rule is
   withdrawn. `M15-PROCEDURE` §0z.1.
2. **Spawn trip-wire at three.** A unit producing more than two new items stops and reports.
   `M15-PROCEDURE` §0z.2.
3. **A new checker must be made to fail on purpose AND confirmed to have failed for the reason you
   think.** Typecheck before the mutation pass, inside the same rule. `M15-PROCEDURE` §0z.3.
4. **The human-judgement cases are NOT folded into the checker rule.** The diagnosis — *an
   unfalsified claim treated as verified* — is named separately and covers all six instances.
5. **A broadcast agent is inbound-only.** Fan-out delivery to every attendee; no replies under the
   broadcast identity; responders reach the sender directly as themselves.
6. **Listen-only is a directory profile property, not client config**, and the load-bearing
   enforcement is at the **receiver**, not the relay.
7. **The contact-naming gap is one POST-LAUNCH item — the prompt.** No auto-promotion. Naming stays
   human-only by design.
8. **`TIERTEXT-1` blocks launch; `TOOLDESC-SCAN-1` is post-launch.**

## Open, not decided

- Whether a broadcast message is "read" when one attendee reads it, all of them, or none.
- What `delivered: true` should mean into a multi-attendee agent.
- Whether declared **session norms** (length, latency, reply-wanted, register) are worth a wire slot.
- Per-attendee read cursors — the change that turns co-attendance from competing-consumer into
  actual fan-out.
