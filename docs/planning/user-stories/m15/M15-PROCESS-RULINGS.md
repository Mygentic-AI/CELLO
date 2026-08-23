---
name: M15 Process Rulings — the two-lane split, and the three rules that came out of it
type: rulings
date: 2026-08-23
milestone: M15
status: open
topics: [m15, process, definition-of-done, launch-triage, claims, checker, trip-wire, two-lane, agent-coordination, dogfooding, contacts, tiers]
description: >
  M15-specific process record. On 2026-08-23 the milestone was split across two parallel lanes
  (CELLO_Coder_1 on the seal work, CELLO_Support on everything else) and the coordination between
  them was run over CELLO rather than through Andre pasting between windows. Three process rules
  were ruled and written into M15-PROCEDURE: findings are classified BLOCKS LAUNCH or POST-LAUNCH at
  creation rather than every discovery becoming a launch blocker; a unit that spawns more than two
  new items trips a stop-and-report; and a new checker must be made to fail on purpose AND confirmed
  to have failed for the reason you think. The last was derived independently by both lanes from
  different evidence on the same day. Also records the findings from that session: the contact model
  split three ways, two shipped tool descriptions promising an away-gate that does not exist, and a
  claims-scanner blind spot — tool descriptions have never been scanned, because the scanner's
  markdown half enumerates from packaging config while its prose-in-TypeScript half is a hand-kept
  list of length one. The product critique of CELLO as a coordination medium, and the broadcast /
  listen-only design that came out of it, have been extracted to their own discussion log — they are
  protocol design rather than milestone process.
---

# M15 Process Rulings — the two-lane split, and the three rules that came out of it

> **Scope note.** This is an **M15 milestone artifact**, not a design discussion log. The product
> critique of CELLO as a coordination medium and the broadcast / listen-only agent design were
> drafted here and have been **extracted** to
> [[2026-08-23_1933_broadcast-channels-conclaves-and-encrypted-discovery|Broadcast channels,
> conclaves, and encrypted discovery]], because they are protocol design that outlives this
> milestone. Parts are numbered 1 and 4 as originally drafted; the gap is deliberate and marks the
> extraction.

## Why this record exists

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

---

## Related Documents

- [[2026-08-21_1906_relay-p2p-exposure-and-ephemeral-peer-id-audit|Live P2P exposure audit]] — the
  audit that produced M15 and its Design Decision 5. This log records that decision's correction:
  "one agreement, two outputs" tied a key that must be destroyed to a salt that must be kept.
- [[M15-PROCEDURE]] — where all three rulings were written (§0z.1 classification, §0z.2 spawn
  trip-wire, §0z.3 the checker rule).
- [[M15-DEFINITION-OF-DONE]] — where `TIERTEXT-1` (blocks) and `TOOLDESC-SCAN-1` (post-launch)
  landed, and the document whose no-descope rule is withdrawn here.
- [[M15-BUILD-JOURNAL]] — the per-unit engineering these rulings govern; the five checker instances
  and both human-judgement cases are recorded there in full.
- [[launch-triage|Launch Triage]] — the ruin-versus-forgive test the classification rule applies.
- [[M8C-MONIKER-SPEC]] — the moniker and `whoKnown` model Part 4a depends on. Confirms naming is
  operator-only by design; the defects found here are that the tier is frozen at first contact and
  nothing ever asks.
- [[2026-07-07_1700_four-level-screening-policy|Four-Level Screening Policy]] — the tier model whose
  away-acceptance semantics Part 4b finds misdescribed in two shipped tool descriptions.
- [[2026-08-23_1933_broadcast-channels-conclaves-and-encrypted-discovery|Broadcast channels,
  conclaves, and encrypted discovery]] — **the extracted design.** The missing-broadcast affordance
  was found by running this milestone's coordination over CELLO; that log carries the critique and
  the design that followed.
