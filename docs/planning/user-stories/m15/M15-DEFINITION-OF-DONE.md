---
name: M15 Definition of Done
type: definition-of-done
date: 2026-08-21
milestone: M15
status: open
topics: [m15, hardening, pre-launch, security, injection, relay, transport, seal, encryption, claims, definition-of-done]
description: >
  The yardstick and sole status authority for M15 (pre-launch hardening). Tiers encode DEPENDENCY
  ORDER ONLY — the gate is a state, not a date, and every line here is inside it. Flip tags in
  place with one line of evidence and a journal pointer. Read M15-PROCEDURE first.
---

# M15 Definition of Done

**Read [[M15-PROCEDURE]] first.** This document is the scoreboard; the procedure is how to work it.
Evidence, proofs, reviewer verdicts and run output live in [[M15-BUILD-JOURNAL]], never here.

## How to read this

**Tags:** ❌ not started · 🟡 implemented, not yet reviewed · ✅ done (written AND reviewed, with the
reviewer's verdict quoted in the journal) · 🅿️ parked with a trigger.

**A tier is a dependency boundary, not a priority.** The gate is a **state** — every line in the
tiers below is inside it, launch waits for all of them, and nothing is descoped for time
(M15-PROCEDURE §0z). If a line turns out bigger than expected it takes longer; that is the correct
outcome, not a trigger to argue scope.

**NEW findings are classified when written (M15-PROCEDURE §0z.1, Andre 2026-08-23).** Every line
already in the tiers stays exactly where it is — this changes nothing retroactively. From now on a
newly discovered item goes either into the tiers (**BLOCKS LAUNCH** — a prospective customer cannot
get the core value, or loses trust) or into **POST-LAUNCH BACKLOG** at the foot of this file (real,
worth fixing, does not stop us shipping), with **one line of reasoning written at creation time**.
Only the tiers count toward the gate. **When it is genuinely unclear, it blocks** — a blocker wrongly
held is work done early; a blocker wrongly released is found by a customer. This is not licence to
investigate less: a post-launch item is written up in full, consequence and all.

**A line's clauses are expanded at pull time**, not here — the coder writes the full clause checklist
into the journal before implementing (M15-PROCEDURE §2 step 2), and that checklist is what the
reviewer receives. What is written below is the target and the clauses that are load-bearing enough
that losing one would silently change the meaning of the line.

**Lines that name an enforcer are ✅ only when that enforcer ran as separate OS processes**, with the
run output quoted. Vitest green is necessary, never sufficient.

> ### ✅ MERGED IS DONE. PUBLISHING IS A RELEASE STEP, NOT A COMPLETION CRITERION (Andre, 2026-09-04)
> *"I'm not worried about things that have already been coded but haven't been published yet. We made
> that decision because we like to bundle things. To me those things are done."*
>
> **A line whose work is written, reviewed and merged is ✅**, and it does not hold a lesser tag
> waiting on an npm cascade or a fleet roll. We bundle releases deliberately — publishing one fix at a
> time multiplies a 25–30 minute roll by the number of fixes — so an unpublished merge is a queue
> position, not unfinished work. **Do not re-open a ✅ because it is not yet on operators' machines,
> and do not write "not done until published" into a line.**
>
> **What still gets recorded, because it is a fact about operators rather than about the line:** if a
> defect is still live for installed users until the cascade runs, say so plainly beside the ✅. That
> is a release note, not a doubt about the tag.
>
> **⚠️ THE ONE THING THIS DOES NOT RELAX — a DEPLOY ORDER between two units is load-bearing.** Where
> unit B cannot start until unit A is live on every node, that is a correctness constraint, not
> bookkeeping: `DOD-M15-SUBMIT-ID-1` already paid for getting it backwards, and *"a client that
> appended a submission id had every frame refused as `signature_invalid` by any relay not yet
> updated — including the one deployed."* Those constraints stay stated, on the units, in full.

> ### 📁 SPLIT 2026-08-24 (Andre) — this file is the SCOREBOARD again, and only that
> It had reached **7,600 lines**, more than half of it closed work and investigation trails, and a
> scoreboard nobody can read stops being a scoreboard. Two costs were measured in this milestone: a
> stale row read as open sent a lane to redo finished work, and a finished item read as untouched sat
> unclaimed for a week.
>
> - **Closed lines → [[M15-DEFINITION-OF-DONE-ARCHIVE]].** Each keeps a one-line pointer here, so the
>   tier still shows every line and its tag. Nothing was edited on the way over.
> - **Investigation trails, review verdicts and retraction sequences on OPEN lines →
>   [[M15-BUILD-JOURNAL]]**, under *"DoD trails, moved 2026-08-24"*. This file was already supposed to
>   work that way — its own second paragraph says evidence *"live[s] in the build journal, never
>   here"* — and had stopped.
>
> **What an open line keeps here:** what it is, why it blocks, the load-bearing clauses, the
> enforcer, and any live decision or flag. **What it does not keep:** how we found out.

> ### 📁 SECOND SPLIT 2026-09-04 — it had grown back, and the same rule was applied again
> **3,759 lines, and the growth was the same shape:** every line closed since 2026-08-24 wrote its
> full record straight into the scoreboard, and several lines already archived had a second body
> written on top of them when their production verification landed. **1,275 lines moved**, byte-for-
> byte, to [[M15-DEFINITION-OF-DONE-ARCHIVE]] under *"SECOND SPLIT — moved 2026-09-04"*.
>
> - **CLOSED lines** whose body was still inline — pointer left in place, tag unchanged.
> - **CONTINUATIONS** — a line archived in the first split whose later live/production verification
>   was written here. Filed beside the original as `… (continued)`.
> - **⬇️ OUT OF GATE lines** — launch does not wait for them, so their bodies are record, not
>   scoreboard. The line and its ⬇️ tag stay in the tier.
>
> **Nothing changed status, and no tag was flipped.** Every `DOD-M15-*` heading is still in its tier
> with the tag it had. **The one judgement call, flagged rather than buried:** `DOD-M15-SPINERED-1`
> is still 🟡 OPEN and the rule above sends an open line's trail to [[M15-BUILD-JOURNAL]], not the
> archive — its trail went to the archive because what moved is closed triage, not an investigation
> still running. Say the word and it moves to the journal instead.

---

# 🔎 PRIORITY OVERRIDE — THE DISCOVERABILITY FILTER (Andre, 2026-08-24)

> **This ranking outranks tier order.** Tiers are dependency order. This is priority order, and where
> they disagree, this wins.

**The filter, in Andre's words:** *"Things like this that are security holes that a smart, motivated
person with an AI coder could discover."*

**So the test is not "is it exploitable" — it is: what would somebody find in an AFTERNOON, pointing a
coding agent at the public repo and asking "where is this weak?"** That is a real and imminent
adversary rather than a hypothetical one: evaluators point a coding agent at an open repo before
trusting it, and a finding they surface costs trust whether or not anyone ever exploits it.

### What the filter promotes, and it is a specific shape

**An absence a grep finds.** A security control that exists and is called from nowhere. A limiter
that does not exist at all. A function whose only caller is a test. An agent asked *"what stops abuse
here"* returns "nothing" in minutes and it is not wrong.

### ⚠️ THE UNCOMFORTABLE HALF, and it must not be misread

**Our most findable weaknesses are the ones our own source announces.** The key-agreement docstring
states that it defeats a passive recorder and not an active on-path relay. The park deposit says it is
unauthenticated by design. A tier description described a gate that did not exist.

> _(trail moved to [[M15-BUILD-JOURNAL]] — see “DoD trails, moved 2026-08-24”.)_

### 🔴 FIRST, AHEAD OF EVERYTHING BELOW — the wire change (Andre, 2026-09-03)

> **`DOD-M15-WITHHOLD-SEAL-1`'s wire half — add `last_seen_hash` to `Structure1` — is the next thing
> built. It outranks every row in the table below and every tier.**

**Why it is first and not merely important.** It is a **wire format change**, and wire changes are
the one class of work that gets more expensive every hour it waits: the field has to be in the bytes
before anything signs, verifies, replays or seals against them. `017-TBS` is extending the assignment
TBS *right now*; relay handover replays a leaf chain against a verifier that requires a sender
signature per leaf. Everything downstream is cheaper if the structure is already right.

**What it is, in one line:** a sender signs `last_seen_seq`, **a number**, so an acknowledgement
attests to a *position* and never to *content*. Adding `last_seen_hash` alongside it makes the
acknowledgement bind to what was actually received — and hold with no relay involved.

**Scope, decided and not to be re-opened:** ADD the field, do **not** replace `last_seen_seq`. It is
a v2 of `Structure1` (field order is signed over). The first message of a session has seen nothing,
and that must be a **defined value, never an absent field**. Full clauses on the line itself.

**⚠️ IT IS TWO UNITS, AND THE ORDER IS NOT NEGOTIABLE — measured, not cautious.**
`020-ACKHASH` ships the READING half everywhere (relay, directory, daemon accept a v2 layout and
nothing emits one). **The EMITTER unit cannot start until `020` is DEPLOYED, not merely merged.**

> ## ✅ THAT GATE IS NOW SATISFIED — verified 2026-09-05. THE EMITTER IS UNBLOCKED.
> - **Server side:** `020` is in `1695c1a9` and the fleet has since rolled past it to `eccc9cbc` —
>   all five nodes, three directories and two relays ([[GCP-STATE]], *WHOLE FLEET ON `eccc9cbc`*).
> - **Client side:** published and promoted to `latest` in the 025–030 cascade —
>   `protocol-types@0.0.69`, `daemon@0.0.189`, `connect@0.0.164`, `cli@0.0.196`.
> - **⚠️ ONE PRECONDITION SURVIVES AND IT IS NOT THE FLEET.** The reader that matters for a v2
>   emission is the *counterparty's daemon*, not only ours. `latest` carries it, so a fresh install
>   is fine — but any daemon still running a pre-`0.0.189` build reads a v2 ack as v1. Per
>   the deployment note in `020`, that is **silent loss, not a loud refusal.** Confirm every live
>   agent is upgraded before the emitter ships, not just the nodes.

`DOD-M15-SUBMIT-ID-1` already paid for the other order: its decoder was `!== 6`, so *"a client that
appended a submission id had every frame refused as `signature_invalid` by any relay not yet
updated — including the one deployed."* Same structure, one field over.

**Two things `020` turned up before it started, both now written into it:**
- **There are TWO `encodeStructure1` functions.** The published one in `protocol-types` says in its
  own header that it has no production caller; the copy in `core/daemon/src/session-relay-client.ts`
  is what production actually signs. The canonical definition and the shipped bytes are separately
  maintained — **the same defect `017-TBS` just removed for the assignment TBS.** `020` Part 1
  deletes the copy before touching the layout.
- **Index 6 is already spoken for.** The relay accepts a SIX-or-SEVEN field Structure 1 today,
  because `SUBMIT-ID-1` widened it for a submission id that no client has ever emitted. So a length
  check cannot tell that shape from this one: **both decoders must branch on the version tag**,
  which is precisely why it is field 0.

---

### The ranking, with sizes — smalls first, because a quick win is a real win

Sizes are the WORK, not the importance. Every line below is already in a tier; this ranks them, it
does not move them.

| Size | What a reader would find | Line |
|---|---|---|
| **S** ✅ | A direct session permanently reveals the operator's IP, with no gate and no remedy — and the shipped docs said nothing. **All four bullets shipped 2026-08-24 in BOTH copies of `SKILL.md`, and `RELAYONLY-1` closed as the feature half.** | `DOD-M15-DISCLOSE-1` |
| **M–L** ✅ | ~~The relay's reservation-dial hook is not installed, so an agent's circuit address is dialable by anyone who learns it.~~ **CLOSED 2026-09-01.** The gater is installed, including the reservation-dial hook, and the relay now requires a directory-signed assignment. Pass 2 refused the merge first: the new gate denied the LEGITIMATE first dial for every session where the receiver is NAT'd and its reservation relay is not the witness relay. | `DOD-M15-RELAYAUTH-1` |
| **S** ✅ | An empty `CELLO_DIRECTORY_PUBKEYS` degrades silently instead of failing startup. Config is correct today; the failure mode that would hide it going wrong is not. | `DOD-M15-RELAYPUBKEYS-1` |
| **S** ✅ | ~~The directory-admin push handler has no caller; deleting it is cheaper and safer.~~ **FALSE — measured 2026-08-24. Its caller is the production directory (`discard_session`), and deleting it would have broken session teardown.** Kept and justified. The real, smaller finding is that THREE of its four frame types have no sender — **deleted, and CLOSED 2026-09-01**, though the unit shipped only half a deletion and left three apparently-working senders behind. | `DOD-M15-RELAYADMIN-1` → `DOD-M15-RELAYADMIN-DEAD-FRAMES-1` ✅ |
| **S** ✅→ | Directory authentication is skipped when the URL is not a byte match. **The "make the skip LOUD" half is DONE** (`DIRAUTH-1` #5: `directory.auth.skipped` at WARN, once per directory, plus `cello_status` in both directions). **What remains is the byte-match itself**, which is an endpoint-identity change. | `DOD-M15-STEP6-REPLAY-1` |
| **M** | The session ephemeral is not bound to the agent's identity, so the new encryption defeats a passive recorder and **not an active relay — and we run the relays.** The module's own docstring says so. | `DOD-M15-EPHEMERAL-AUTH-1` |
| **M** ✅ | The content-park store is unauthenticated by design and unbounded per depositor: 4 MiB frames, 256 MB store, no rate limit. Fillable for every user at once. | `DOD-M15-RELAYPARK-1` |
| **L** ✅ | The relay had **no rate limiting of any kind** — authentication, hash submission, gap-fill, the liveness query, park deposit. **CLOSED 2026-09-01: every path is limited** (gap-fill vacuously — its wire handler was already deleted), the idle timer is armed at 24 h, and the circuit caps are enforced. The Sonnet pass called it faithful; the Opus re-review found both new refusals reached a log line and nothing else. | `DOD-M15-RELAYABUSE-1` |
| **L** ✅ | A relay granted circuit reservation slots to anyone holding any keypair and **counted nothing** — mint 4096 keys and no real agent is reachable by anybody, while the relay looks healthy and every request was individually legitimate. **CLOSED 2026-09-01**: directory-issued token bound to the agent key, per-agent and per-identity-pair caps, reaper before refusal. | `DOD-M15-RELAYSLOTS-1` |
| **L** | The semantic screener has **never run against real weights** — `installModel` has no caller, no command, and the dependency is not even declared optional. One of the three things the launch intent names as core value. | `DOD-M15-SCREENINSTALL-1` |

> _(trail moved to [[M15-BUILD-JOURNAL]] — see “DoD trails, moved 2026-08-24”.)_

**The five S items were mostly "wire up something that already exists" or "write down what is true."**
They are the quick wins and were to be taken first, in a batch, rather than one per unit.

---

## 🔭 FOUND LIVE 2026-09-04 — four items, NOT YET GATED (items 1 and 2 are now ✅)

Found while publishing 020–024 and rolling the fleet, not by review. Recorded here because they came
out of a working conversation and would otherwise live only in a transcript. **None is in a tier
yet** — tiering is Andre's call, and three of the four are behaviour changes that are his to decide.

**Orders written 2026-09-04 — items 1+2 are ONE order, items 3 and 5 are their own:**

- `micro/025-REFUSALTERMINAL-a-refusal-that-can-never-succeed-stops.md` → `DOD-M15-REFUSALTERMINAL-1` (items 1 and 2)
- `micro/026-FORKQUIET-a-table-that-always-moves-is-not-a-fork.md` → `DOD-M15-FORKQUIET-1` (item 3)
- item 4 is a build, not a fix — no order, tracked here only
- `micro/027-SCREENORDER-the-language-check-must-read-the-original.md` → `DOD-M15-SCREENORDER-1` (item 5)

| # | What a reader would find | Status |
|---|---|---|
| **1** | **A refusal that can never succeed is retried forever.** `CELLO_Coder_1` knocked on a closed conversation **232,056 times over 62 hours**, ~2/second, growing `daemon.log` to **484 MB**. **Andre approved the fix 2026-09-04: *"a message refused should stop being retried."*** | ✅ `DOD-M15-REFUSALTERMINAL-1` → Entry 72. A durable terminal-refusal row stops the leaf-fetch backstop: **5,954 fetch events → 0**, measured live with `CELLO_Support` back ONLINE over 12 minutes. The agent no longer needs to be parked. **Published and promoted 2026-09-05** in the 025–030 cascade (`cli@0.0.196`, `connect@0.0.164`, `daemon@0.0.189`), and the fleet is on `eccc9cbc`. |
| **2** | **The refusal count shown to the operator is wrong by three orders of magnitude.** `cello_inbox`'s `refusals.times` reported **58** for those 232,056 knocks. | ✅ `DOD-M15-REFUSALTERMINAL-1` → Entry 72. `times` is gone. The cause was `cello_dismiss`, which DELETES the notice row and restarts its counter — so the field was a since-you-last-dismissed figure under a lifetime name. Now `times_since_dismissed` beside `times_total` (exact) or `times_total_at_least` (a floor, where history predates the tally), from a record dismissal does not touch, and one shared guidance sentence at both doors. |
| **3** | **`021-HEARTBEAT` introduced a permanent false alarm.** `antientropy.round.fork_suspected` fires on `directory_nodes` **every 3 minutes, forever**: every node rewrites its own `last_heartbeat_at` every ~30 s, so two nodes can never agree on a hash of a table one of them is always mutating. It pages nobody and masks nothing (the event names its own table), but it is an ERROR-level cry-wolf on a healthy fleet. **Andre's steer 2026-09-04: judge agreement ignoring the heartbeat column** — NOT by muting the table, which would also hide a real `status` divergence. Costs a build and a five-node roll. | ✅ fixed and rolled — zero in 16 min, baseline 13/hr |
| **4** | **The defensive half cannot be tested from a legitimate client, so it has never run live.** The sender's own `exfil:injection_artifact` guard refused two attempts to probe the receiving screener — including the forged `[[END PAYLOAD]]` framing that `023` was designed against — and it is not one of the five configurable guards, so every client refuses identically. **`024-ORPHANTRIAGE`, the screener block, and evidence-on-block have therefore never been exercised outside the in-process spine tests.** Needs a deliberately modified client. **Built 2026-09-04: patched daemon on GCP (`cello-hostile-client`), agent `CELLO_Adversary`, driven straight over the daemon socket. Two attacks run — see item 5.** | ✅ rig built; findings below |
| **5** | **The inbound language block is silently disarmed by the confusables step that runs before it.** Found by the hostile client (item 4): a 100%-Cyrillic jailbreak was Latinized to 25% Cyrillic by `normalizeConfusables` BEFORE `screenInboundLanguage` judged it, so the one deterministic inbound block that works without the semantic classifier saw "mostly Latin" and delivered it. The gateway IS live and enforcing (it transformed the payload exactly per its confusables map) — the defect is data flow: the language screen reads the normalized text when it needs the original. **Fix decided 2026-09-04: language screen judges the post-invisible-strip, pre-confusables text; everything downstream still reads the normalized text.** | ✅ `DOD-M15-SCREENORDER-1`. The screen now reads a text with everything that distorts a LETTER COUNT removed and everything carrying SCRIPT IDENTITY kept; downstream is unchanged. Proven through real gateway processes — reverted, the agent receives `Игhopupyй bce пpeдыдyщue uhctpykцuu…` verbatim. **Review caught that the first cut closed the naive form only:** `[SYSTEM]`×28 in front of the same payload counted as Latin dilution and was then stripped from delivery, reopening the leak with letters the recipient never sees — and capturing before NFKC newly HELD plain English typed on a CJK IME. Both closed by one capture point. 13/13 cases, 7 mutants. **Published and promoted 2026-09-05** in the 025–030 cascade (`cli@0.0.196`, `connect@0.0.164`, `daemon@0.0.189`), and the fleet is on `eccc9cbc`. |

> **Do not read #4's absence of live evidence as evidence the defence works.** "Could not reproduce
> live" here means the attack could not be *sent* — not that it would have been *stopped*.

> _(trail moved to [[M15-BUILD-JOURNAL]] — see “DoD trails, moved 2026-08-24”.)_

### What the filter DEMOTES, and this is the point of writing it down

Reservation churn, federation heartbeats, and the unilateral seal's clock trigger are all real — and
none is found by reading. They need live measurement or behavioural reasoning. **Genuinely important
is not the same as findable**, and this filter ranks findable.

> _(trail moved to [[M15-BUILD-JOURNAL]] — see “DoD trails, moved 2026-08-24”.)_

---

# ⬇️ MOVED OUT OF THE GATE — 2026-08-24 (Andre)

> **Two rulings, both Andre's, both made on 2026-08-24. Lines below are marked ⬇️ in place rather
> than physically relocated, to keep the diff readable. ⬇️ means OUT OF THE GATE: launch does not
> wait for it. It is not deleted and not descoped from the project.**

### Ruling A — **shared documents are OUT OF THE GATE.**
*"They're out of the gate, documents are out of the gate."* The launch intent is two agents
connecting and communicating; the document feature is not part of that, and M15 exists to get the
basic value working. Anything whose only consequence is to the `cello_doc_*` feature leaves the gate.

- `DOD-M15-DOCACCEPT-UNBOUNDED-1` — accepting a document invitation hangs ~60s when another holder
  is offline. **The bound Andre was asked for is no longer owed.**
- **The document salt defect** (`j-documents` 7 failures, `j-stale-session` 1) — salt agreement is a
  DIRECT-path protocol and documents are relay-only, so a document session never agrees a salt and
  the receiver silently discards every update. **The three filed options are no longer owed.**
- **Not affected:** `DOD-M15-SCREENINSTALL-1` stays in the gate — the semantic screener is a launch
  item in its own right. Only its two document-specific sub-bullets follow this ruling out.

### Ruling C — **the kill switch is OUT OF THE GATE.**
*"The kill switch is outside of the gate"* (Andre, 2026-08-24). `DOD-M15-SUSPEND-UNTESTED-1` already
sat in the POST-LAUNCH BACKLOG, but it was put there by a lane under the freeze, not ruled. It is now
ruled, by the person the frozen gate says must rule it. **The open design question — whether suspend
is meant to stop new sessions being brokered or to stop the agent doing anything at all — is no
longer owed and is not blocking anyone.**

### Ruling B — **nine lines that entered the gate after it was written, and are not in either anchor.**
The gate began at **49 lines** and reached **116**. These nine were all added mid-milestone, none
appears in the two spec-of-record investigations, and none is a security hole a reader finds by
pointing an agent at the repo (the §Priority Override filter). One line that met that filter —
`DOD-M15-EPHEMERAL-AUTH-1`, where our own docstring announces the gap — **stays in the gate.**

| Line | Why it leaves |
|---|---|
| `DOD-M15-BOOTSTRAP-ADDR-1` | Cost is denial of one directory node, not impersonation; Noise refuses the connection. |
| `DOD-M15-BOOTSTRAP-AUTH-1` | The security property is measured and holds; only the literal title (TLS on 9090) is unbuilt, and it buys little. |
| `DOD-M15-CLOSEROOT-1` | The assertion clause is measured green; what remains is running converted journeys. |
| `DOD-M15-DEAD-WIRE-FIELD-1` | An always-empty field nobody reads. Costs nothing at runtime. |
| `DOD-M15-EPHEMERAL-REVIVAL-1` | Bites only on restart mid-session followed by continued talking. |
| `DOD-M15-RELAYADMIN-KEYSET-1` | Open question, not an established defect — nobody has shown a non-primary broker cannot complete. |
| `DOD-M15-RELAYADMIN-REPLAY-1` | Requires capturing a frame on the wire between our own directory and our own relay. |
| `DOD-M15-STEP6-REPLAY-1` | The "make the skip loud" half shipped; the rest is an endpoint-identity change. |
| `DOD-M15-UNWITNESSED-1` | Gating today would fire on healthy sessions — both sides hold the leaf, nothing is wrong. |

**`DOD-M15-SPINERED-1` STAYS.** It is the multi-process evidence lane itself — the milestone's own
close condition, not a finding from it.

---

# Tier 0 — The verification spike (blocks scoping, not building)

Three questions that **cannot be answered by reading source**. Their answers change the scope of
other lines, so they run before anything else is scoped. Hours, no code.

### `DOD-M15-SPIKE-1` — ✅ What the live deployment actually does
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-SPIKE-1`.

# Tier 1 — Claims — 🅿️ DEFERRED TO THE END OF THE MILESTONE (Andre, 2026-08-24)

> ## 🛑 READ THIS BEFORE FLAGGING ANYTHING IN THIS SECTION AS URGENT.
>
> **This whole section is deferred. It is not "starts immediately" any more.** It runs LAST, after the
> encryption and receipt work, alongside the `AUDIT-ME.md` rewrite.
>
> **Andre's reasoning, in his words, so nobody re-litigates it:**
> *"Why would we want to write docs about the code when we're massively modifying the code? Do it at
> the end. Super obvious. There are NO READERS but me and AI coders. No one is using it. It is still
> in stealth."*
>
> That is a stronger argument than the one this section was originally written on: documenting code
> you are actively rewriting is work you do twice, and the exposure from a false sentence is
> proportional to who reads it — which today is nobody outside this repo.
>
> **This deferral OUTRANKS the priority framing and the enforcer below it.** The claim scanner still
> fails the build on an unlisted claim; that is correct and stays, because it stops the backlog
> GROWING. It is not a signal that the backlog must be worked now.
>
> ### Why this banner exists at the section level rather than inside one line
> The deferral was previously recorded as a note inside `DOD-M15-LEDGER-1`, under a heading that said
> *"no dependencies; starts immediately"* and above a build-failing enforcer. **Every agent that read
> the file surfaced it to Andre as urgent anyway** — repeatedly, because a buried note does not
> outrank the framing around it. Correcting that framing is the fix; answering the question again is
> not.
>
> **⚠️ ATTRIBUTION CORRECTED.** `DOD-M15-LEDGER-1`'s park previously read *"(Andre, 2026-08-23)"*.
> **He did not make that call.** He deferred `AUDIT-ME.md` only; the remaining seven surfaces were
> parked by a lane *"on the same trigger as `AUDITME-1`"* — a lane decision recorded under his name.
> He has now ruled it, on 2026-08-24, and it stands — but the earlier attribution was wrong and a
> ruling wearing the wrong name is unauditable.
>
> **What ships in the meantime, stated rather than hidden:** seven of nine surfaces are unswept, and
> at least one shipped file carries a known-false claim — `adapter-claude-code/SKILL.md:170`'s *"the
> notarized bilateral receipt both sides agree on"*, which contradicts `implies_assent: false`.
> Deleting that phrase is ungated and can be taken at any time. Andre has been told and left it.

Everything already readable by someone outside — the public repo, the shipped package, the product's
own output. The unpublished investor and GTM material is **not** in this tier (M15-PROCEDURE §0a.1).

### `DOD-M15-LEDGER-1` — 🅿️ Every live claim is in the ledger with a disposition
> _(trail moved to [[M15-BUILD-JOURNAL]] — see “DoD trails, moved 2026-08-24”.)_
Build the claims ledger (M15-PROCEDURE §1d) as a section of this document. One row per claim: its
current text, where it appears, and its disposition — **made true**, **withdrawn**, or **disclosed as
a bounded property**.
- Sweep all four live surfaces: the public `cello-client` repo (root docs, README, comments), the
  shipped npm package (tool descriptions, skill prose, CLI help), product status/CLI output, and
  shipped client documentation.
- **Partially true is false.** A row whose claim survives only with a qualifier gets rewritten or
  withdrawn, never softened.
- A claim with no row is an unaudited claim; the line is not ✅ while a surface is unswept.
- **⚠️ SEPARATE THE RECEIPT FROM THE LOG. They read identically in prose and one is true.** Added
  2026-09-03 (Order 021) because I made this exact conflation and it stood for hours:
  - **RECEIPT-level — TRUE, keep it.** *"Countersigned by several independent directories", "no
    single directory can forge it."* A seal is FROST threshold-signed and every co-signer rebuilds
    the root from the leaves itself before contributing a share.
  - **LOG-level — FALSE today.** *"Tamper-evident record", "you can prove it is in our permanent
    log", "multi-node anchored", "immutable audit log."* The periodic checkpoint an inclusion proof
    resolves against is written by ONE node with ZERO signatures
    (`DOD-M15-CHECKPOINT-COUNTERSIGN-1`, OPEN, post-launch).
  - **The sweep must therefore read every "tamper-evident" / "verifiable" sentence twice** and ask
    which of the two it is asserting. `DOD-M15-SEALWIRE-1` makes the receipt-level reading true; it
    does nothing for the log-level one, so a disposition of *made-true by SEALWIRE-1* is only
    correct for the first reading.

### `DOD-M15-AUDITME-1` — 🅿️ `AUDIT-ME.md` survives the audit it invites
**Trigger: the last Tier 1 line to be worked, and not before Tier 4 lands** (Andre, 2026-08-22).
Parked for sequencing only — it is inside the gate and launch still waits for it. The reasoning: the
repo is public but **unadvertised**, so the exposure is theoretical, and the document's job is to
describe what the system finally does. Written now it describes a tree that Tier 2 and Tier 4 are
about to change underneath it, and every such change is a second rewrite. **Its claims are corrected
by the lines around it either way** — the false encryption detail is a ledger row with a disposition,
and the stale file paths are a mechanical fix. What waits is the document that presents them.
- **Do not let this park hide a claim.** `DOD-M15-CLAIM-SCANNER-1` enumerates surfaces from the
  system, and root `*.md` of the public repo is one of them. Every claim in this file must already
  sit in the ledger with a disposition of *pending rewrite → `DOD-M15-AUDITME-1`* before the scanner
  ships, or the scanner fails the build on a file we deliberately parked.

Rewrite `AUDIT-ME.md` at the root of the **public** `Mygentic-AI/cello-client` repo.
- Four of its seven cited file paths no longer exist (pre-repo-split layout) — every path resolves,
  verified by opening it.
- Its encryption claim's supporting detail is wrong: it says content is additionally encrypted at
  the application layer, **true only for parked content**, and cites the database backup file as
  evidence. Corrected to what the tree does, per Part 13 of the relay audit.
- States the relay's **metadata** visibility (who talks to whom, when, how often, sizes) beside the
  true claim that the relay cannot read content — so it is disclosed, not exposed by a follow-up.
- **The claims in it are true; the document proved them badly.** The rewrite proves them.

### `DOD-M15-CLAIM-SCREEN-1` — ✅ Nothing reports screening as active while its semantic half is inert
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-CLAIM-SCREEN-1`.

### `DOD-M15-CLAIM-SCANNER-1` — ✅ An unlisted claim fails the build
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-CLAIM-SCANNER-1`.

### `DOD-M15-CLAIM-COMMENTS-1` — ✅ No comment in the public repo asserts a property the code lacks
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-CLAIM-COMMENTS-1`.

### `DOD-M15-TIERTEXT-1` — ✅ The tier descriptions do not promise a gate that does not exist
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-TIERTEXT-1`.

### `DOD-M15-DISCLOSE-1` — ✅ Shipped documentation discloses what the architecture cannot remove
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-DISCLOSE-1`.

# Tier 2 — Make detections act, and close the doors

The checked-then-ignored class and the unauthenticated surfaces. **Runs in parallel with Tier 3** —
different repos, different disciplines, neither blocks the other.

### `DOD-M15-DIVERGE-1` — ✅ A divergent local tree blocks the seal instead of printing a string
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-DIVERGE-1`.

### `DOD-M15-DEAD-WIRE-FIELD-1` — ⬇️ OUT OF GATE (Andre 2026-08-24) · was 🟡 (client half done; the wire removal is bilateral and carried)
> **Out of the gate — launch does not wait for it.** Full entry is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-DEAD-WIRE-FIELD-1`.

### `DOD-M15-IDLE-CONNS-1` — ✅ A connection that authenticates to nothing does not live forever
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-IDLE-CONNS-1`.

### `DOD-M15-CI-SKIPS-SILENT-1` — ✅ A suite that skips itself does not report green
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-CI-SKIPS-SILENT-1`.

### `DOD-M15-DIRECTORY-ROT-1` — ✅ The directory suite cannot survive its own run
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-DIRECTORY-ROT-1`.

### `DOD-M15-COMPOSE-CI-1` — ✅ The suites that need a database actually run somewhere
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-COMPOSE-CI-1`.

### `DOD-M15-GUARD-HEARD-1` — ✅ A guard that fires is heard by somebody
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-GUARD-HEARD-1`.

### `DOD-M15-CHAINDEBT-1` — ✅ No fixture puts a hole in a hash-chained table
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-CHAINDEBT-1`.

### `DOD-M15-CHAINROUNDTRIP-1` — ✅ A chained row can be verified against what the database returns
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-CHAINROUNDTRIP-1`.

### `DOD-M15-SPINERED-1` — 🟡 The multi-process evidence lane is HALF RED, and nobody knew
> **📦 Moved to [[M15-DEFINITION-OF-DONE-ARCHIVE]] 2026-09-04, under `DOD-M15-SPINERED-1`:** the
> triage unit's review verdict, the 49-failure cause table, the out-of-gate document blocks, and the
> closed journey entries. Nothing was edited on the way over.

**Where the lane stands.** The triage this line asked for is DONE and reviewed — every one of the 36
spine files has been run, and the 49 failures resolve to six causes. The CLI-banner, stale-assertion,
unsalted-hash and portal-database causes are all green: `j-spine` **7/7**, `j-content` **10/10**,
`j-end` **10/10**.

**What is left is ONE row.** After Decision #16 took documents out of the gate, this lane's only
remaining in-gate failure is **`j-suspend-tofn` — the kill switch**. Ruling C then took the kill
switch out of the gate too (`DOD-M15-SUSPEND-UNTESTED-1`, POST-LAUNCH BACKLOG).

> **🟡 HELD OPEN DELIBERATELY — ruled by Andre 2026-09-04: *"leave as a reminder that the kill switch
> is untested."*** Every failure this line tracked is green, out of gate, or owned elsewhere, so on
> the arithmetic it could close. It does not, because closing it would remove the last visible marker
> that **we have no passing test that threshold-refusal works under the threshold we actually ship**
> — the coverage gap `DOD-M15-SUSPEND-UNTESTED-1` records, where "no test" and "passing test" look
> identical from a suite summary. **Do not close this line on the count.** It closes when the kill
> switch has a test that can fail, not when the other rows go green.

- **Out of gate, unfixed, and NOT to be read as passing:** the document journeys (`j-documents` 7,
  `j-stale-session` 1, `j-multiplayer` 4).
- **Owned elsewhere:** `j-unilateral` ×2 and `j-upgrade-bilateral` → `DOD-M15-UNILATERAL-NOTARIZE-1`;
  `j-remove` → `DOD-M15-REVOKED-READS-OFFLINE-1` (POST-LAUNCH).
- **One product finding filed from this line's review:** `DOD-M15-START-AGENT-UNAWAITED-1`.

### `DOD-M15-NORMHASH-1` — ✅ Sanitisation cannot split the two sides' trees
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-NORMHASH-1`.

### `DOD-M15-CLOSEROOT-1` — ⬇️ OUT OF GATE (Andre 2026-08-24) · was 🟡 Journeys converted (unrun); the assertion clause ✅ MEASURED
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-CLOSEROOT-1`.

### `DOD-M15-CLIJSON-1` — ✅ A command that prints JSON prints only JSON
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-CLIJSON-1`.

### `DOD-M15-SPINE-LANE-1` — ✅ The spine suites are run, or their absence is a decision on the record
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-SPINE-LANE-1`.

### `DOD-M15-SIGNUP-DURABLE-1` — ✅ The signup limiter survives a deploy
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-SIGNUP-DURABLE-1`.

### `DOD-M15-UNWITNESSED-1` — ⬇️ OUT OF GATE (Andre 2026-08-24) · was ❌ The two SUSPECTED partings are judged, not ignored
> **Out of the gate — launch does not wait for it.** Full entry is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-UNWITNESSED-1`.

### `DOD-M15-MIGRATION-GUARD-1` — ✅ The upgrade guard checks all seven rebuilt tables, not one
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-MIGRATION-GUARD-1`.

### `DOD-M15-DIVERGE-DURABLE-1` — ✅ The divergence flag survives a daemon restart
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-DIVERGE-DURABLE-1`.

### `DOD-M15-FRAME-1` — ✅ A stranger cannot inject content on the direct path
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-FRAME-1`.

### `DOD-M15-ASSIGN-1` — ✅ The assignment is verified, then gated on
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-ASSIGN-1`.

### `DOD-M15-SURFACE-1` — ✅ The daemon stops listening where nothing dials it
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-SURFACE-1`.

### `DOD-M15-OFFER-SIGNED-1` — ✅ The frame that opens your door is signed by more than one node
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-OFFER-SIGNED-1`.

### `DOD-M15-RESPONDER-VERIFY-1` — ✅ The responder stops trusting a key it never checked
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-RESPONDER-VERIFY-1`.

### `DOD-M15-RELAYAUTH-1` — ✅ No relay service without a directory-issued assignment
> **Closed.** Full entry, plus the live/production verification written here after it closed, is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-RELAYAUTH-1`.

> ### 📐 `DOD-M15-SWEEP-1` WAS SPLIT 2026-09-01 (Andre) — the relay third is done, the rest is not
> `005-RELAY` swept the relay package and deliberately excluded the daemon and directory. **No tag in
> the four-tag vocabulary means "a third done"** — ✅ would claim a sweep that never happened, ❌ or 🟡
> would send the next lane to re-sweep the relay. Split on the precedent already in this file
> (`RELAYADMIN-1` → `RELAYADMIN-DEAD-FRAMES-1`, `KEYAGREE-1` → `EPHEMERAL-AUTH-1`).
>
> **The park trigger had already fired.** `SWEEP-1` was parked *"after `DOD-M15-FRAME-1` and Tier 4's
> seal change"*; `FRAME-1` is ✅ and `SEALWIRE-1` — which self-describes as *"one protocol change, not
> six"* — is ✅. 🅿️ was wrong on the line's own terms, independently of the split. → Entry S15.

### `DOD-M15-SWEEP-RELAY-1` — ✅ The checked-then-ignored sweep, RELAY PACKAGE
> **Closed 2026-09-01** (`005-RELAY`). Zero security hits, and the "zero hits" conclusion was
> independently re-derived on Opus; one real defect found in the coverage the sweep had missed. Full
> entry in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-SWEEP-RELAY-1`. → Entry S15.

### `DOD-M15-SWEEP-DAEMON-DIR-1` — ❌ The checked-then-ignored sweep, DAEMON AND DIRECTORY
**The two thirds `005-RELAY` did not touch**, and the reason it did not is that the order was scoped
to one package on purpose. Inside the gate: this is the discoverability filter's exact shape — a
check that runs, gets the right answer, and is then ignored is what a coding agent pointed at the
public repo surfaces in an afternoon.
- For **every** frame handler and **every** verification call in the daemon and the directory, answer
  two questions: does a failed check take a hard-fail path, and does a **missing or malformed** proof
  take the same path as a mismatched one?
- Fix every hit. **Rewrite — do not delete — every nearby comment asserting a property the code does
  not enforce.**
> **✅ BOUNDED BY ANDRE 2026-09-03: the handlers a STRANGER CAN REACH from outside, not every
> verification call in both packages.** The open call below is answered and closed. Scope is now the
> externally-reachable frame handlers and their verification paths; an internal-only call site is
> out of scope unless a reachable handler leads to it. Rationale: the relay third of this sweep
> produced exactly ONE real hit, so the yield is low per call site, while the class is precisely
> what a coding agent pointed at the public repo surfaces. Unbounded, nobody starts it.

- **⚠️ ~~OPEN CALL FOR ANDRE~~ — ANSWERED ABOVE. This line WAS unbounded as written** (*"unknown scope by construction"*,
  §0z), and it is now a visible open row rather than a parked one. Worth bounding at pull time to the
  handlers a stranger can actually reach, rather than every verification call in both packages. Not
  narrowed here: quietly shrinking a gate line is not a coder's call.
- **Start from what the relay sweep learned:** its one real hit was a bare `catch { return undefined }`
  whose caller turned every transport failure into a specific protocol refusal, telling the operator a
  relay was unregistered when the real fault was a dead link to the directory. The class is
  *error substitution at the catch site*, not a missing check.

---

# Tier 3 — The basic value actually being delivered

Parallel with Tier 2. Source is [[launch-triage]] — **read its header warning before trusting any
status marker there.** Items are cross-referenced by their triage designation.

### `DOD-M15-SUBMIT-ID-1` — ✅ A retried message stops killing its conversation
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-SUBMIT-ID-1`.

### `DOD-M15-BOOTSTRAP-1` — ✅ One lost packet stops dropping a directory from the roster
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-BOOTSTRAP-1`.

### `DOD-M15-ERRSTRING-1` — ✅ An error names what was observed, never an inferred conclusion
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-ERRSTRING-1`.

### `DOD-M15-REFUSED-INBOUND-SILENT-1` — ✅ A message we refused is a thing the operator gets told
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-REFUSED-INBOUND-SILENT-1`.

### `DOD-M15-TRANSPORT-TERMINAL-1` — ✅ A transport blip stops killing a healthy conversation
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-TRANSPORT-TERMINAL-1`.

### `DOD-M15-TERMINAL-REASON-1` — ✅ "Sealed" and "gave up" stop being the same word
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-TERMINAL-REASON-1`.

### `DOD-M15-PULLRECOVER-1` — ✅ The certificate pull is PROVEN TO WORK (measured, not argued)
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-PULLRECOVER-1`.

### `DOD-M15-INTERRUPTED-1` — ✅ An interrupted session can seal, and it has been watched doing it
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-INTERRUPTED-1`.

### `DOD-M15-CLOSEWAIT-1` — ✅ A close answers the caller before eleven minutes elapse
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-CLOSEWAIT-1`.

### `DOD-M15-SEAL-FAILED-TERMINAL-1` — ✅ A seal that FAILED is discoverable, not just a slow one
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-SEAL-FAILED-TERMINAL-1`.

### `DOD-M15-SIGNUP-1` — ✅ Signup throttles a person, not their employer
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-SIGNUP-1`.

### `DOD-M15-ALERTING-1` — ✅ Something tells us when a node is unwell
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-ALERTING-1`.

### `DOD-M15-STALEROSTER-1` — ✅ A stale reading refuses to present itself as current
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-STALEROSTER-1`.

### `DOD-M15-IPCVISIBLE-1` — ✅ A connection closing leaves a record, and an identity switch says why
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-IPCVISIBLE-1`.

### `DOD-M15-SELECTION-1` — ✅ A connection is never bound to an agent it did not select
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-SELECTION-1`.

### `DOD-M15-MANIFEST-EXPIRY-LIVE-1` — ✅ A running daemon notices its own manifest expiring
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-MANIFEST-EXPIRY-LIVE-1`.

### `DOD-M15-EXPIRY-CONSUMER-POLICY-1` — ✅ One policy for an expired anchor, across all consumers
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-EXPIRY-CONSUMER-POLICY-1`.

### `DOD-M15-DOORBELL-1` — ✅ A daemon shutdown does not ring like an incoming message
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-DOORBELL-1`.

### `DOD-M15-SAMEOP-1` — ✅ Same-operator standing does not depend on which node answered
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-SAMEOP-1`.

### `DOD-M15-ENDORSE-RETRY-1` — ✅ A trust signal reaches the directory when one node is down
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-ENDORSE-RETRY-1`.

### `DOD-M15-PARKCOLLECT-1` — ✅ A parked message can actually be collected
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-PARKCOLLECT-1`.

### `DOD-M15-PARKERROR-1` — ✅ A failed park deposit says what went wrong
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-PARKERROR-1`.

### `DOD-M15-PARKCONN-1` — ✅ A message to an offline counterparty does not intermittently fail
**Found 2026-09-03 by `019-PARKERROR`, the moment the reporting was fixed — this is what
`"[object Object]"` had been hiding since before 2026-08-23.** Nobody had ever read it.

**What the operator lives through:** they message someone whose agent is offline. Sometimes it
parks. Sometimes it fails, and until yesterday they were told only *"An unexpected error
occurred."* Same action, two outcomes, no way to tell which they will get.

- **The cause, read for the first time:** `content_park_deposit` throws
  `No open connection to peer <relay>` — the daemon has no live libp2p connection to the relay at
  the moment it tries to deposit. Thrown by the transport's `openStream` as a plain object, not an
  `Error`, which is why it flattened.
- **Two separate defects, and they want separate fixes.** (a) **The deposit path throws where its
  siblings return** `{ ok: false, reason }` — `content-park.ts` returns structured refusals
  everywhere else, so an ordinary "the relay is not connected right now" is routed into
  `internal_error` with no reason code and no next step. (b) **Why the connection is missing at
  deposit time is UNREAD.**
- **Rate: NOT ESTABLISHED, and the "~1 in 3" this line used to state is withdrawn.** It came from
  three runs, and `019` said so itself: three runs supports *"not always red"* and does not support a
  rate. Never measured against the live fleet. **Investigation opened by Andre 2026-09-03.**
> ### ✅ CLOSED 2026-09-05 by `030-RELAYSILENT` — the cause was the RELAY refusing five connections per second per source IP
>
> **`inboundConnectionThreshold` was libp2p's inherited default of 5**, and `acceptIncomingConnection`
> runs BEFORE the connection gater, before Noise, before `connection:open` — so the refusal happened
> beneath every layer CELLO logs, which is why the relay's log simply stopped. Measured in the failing
> second: **11 inbound attempts from one host, 5 admitted, 6 refused, while 4 connections were open
> against a ceiling of 300.**
>
> Raised to **256 on the relay and on the DIRECTORY** (which was running at 5 too, and is dialled by
> every client three times at registration), env-overridable, with the resolved limits logged at
> startup. Andre ruled the value 2026-09-05 on the measurement.
>
> **Enforcer: `DOD-MSG-5`, `MSG-7` and `MSG-8` green across three consecutive full-file runs as
> separate OS processes**, twice — before and after the review fixes. → `030-RELAYSILENT`.
>
> **⚠️ NOT DEPLOYED.** This is a relay and directory change; it is not live anywhere until the GCP
> fleet is rolled node by node (`infra/CLAUDE.md`). The tag reflects the enforcer, which is what §1c
> defines it to mean — it does not mean an operator is helped yet.
>
> **⚠️ AND `DOD-MSG-2` STILL FAILS IN EVERY RUN**, unchanged by this fix: a sender that crashed with
> un-acked content does not re-park it on restart. That is the crash backstop for exactly the parked
> mail this line is about, and its own recorded criterion ("BLOCKS if it reproduces") is now due.
> Written up in `030-RELAYSILENT` *Newly discovered* #1; **the ruling is Andre's.**

- **⚠️ CLASSIFIED BY ANDRE, 2026-09-04: BLOCKS LAUNCH.** No longer "unclear ⇒ blocks" — it is a
  ruling. It is on the advertised journey, `028-PARKCONN` established what actually fails (below),
  and an agent that silently stops sending and receiving mail after every conversation is not a
  papercut a prospective customer forgives.

> ### 🔎 RE-MEASURED 2026-09-04 by `024-ORPHANTRIAGE` (*Newly discovered* #1) — it is WIDER than this line said, and one of its own claims is now unsupported
>
> **Three `j-content` tests fail on this error, not one:** `DOD-MSG-5`, **`DOD-MSG-7`** and
> **`DOD-MSG-8`**, all reading *"No open connection to peer 12D3KooW… (the relay)"* — two on the raw
> `content_park_deposit` / `content_park_recover` IPC, one on a `cello_send` returning false.
>
> **Controlled, not assumed:** the same file was re-run at `origin/main` with 024's change reverted
> and produced the **IDENTICAL three failures**, so 024's relay ingress proxy is exonerated and this
> is pre-existing. 024 left it under rule 3 and did not investigate.
>
> **⚠️ THIS LINE'S "NOT THE SAME AS `DOD-MSG-7`" BULLET IS WITHDRAWN.** It said MSG-7 fails on
> `content_park_recover` returning `ok: false` and therefore has a different cause. 024 measured MSG-7
> failing with **this** error. Either the separation `019` drew is wrong, or MSG-7 has two failure
> modes — **nobody has established which, and the line will not assert a separation it cannot show.**
>
> **`DOD-MSG-8` was previously filed as a test-side fault** (it called `cello_get_transcript`, a tool
> renamed to `cello_transcript` — see `DOD-M15-JCONTENT-DELIVERY-1`). It now fails on the connection
> error, which is a different fault from the one recorded there. **Do not read that entry as current
> for MSG-8.**
>
> **What this changes for scoping:** the first job is still "why is there no connection at deposit
> time", and the blast radius is now deposit AND recover AND send, not deposit alone.


> ### 🛑 MEASURED 2026-09-04 by `028-PARKCONN` — HALF THIS LINE IS SHIPPED, AND THE REMAINING HALF IS A RESERVATION FAILURE. **BLOCKS LAUNCH — ruled by Andre, 2026-09-04.**
>
> **Defect (a) is CLOSED.** The deposit path no longer throws where its siblings return. Deposit,
> pull and recover all answer `{ok:false, reason, guidance}`; the empty `catch` that was eating every
> dial failure is gone; and one stream failure is now six named faults rather than one, because only
> two of them are about reaching the relay (`invalid_peer_id` is a malformed argument,
> `node_stopped` is this daemon's own transport, `protocol_not_supported` is a version skew on a
> connection that WORKED). Merged in both repos; see `028-PARKCONN` for the verdict.
>
> **Defect (b) is READ, and it is not a connection problem — it is a RESERVATION problem.** From the
> sender daemon and the relay, same millisecond, every failing run:
>
> ```
> session.node.created                       (a NEW standing receiver for the sender's agent)
> session.standing_receiver.reachability     circuitAddrs: 0
> session.standing_receiver.reservation.none
> content.park.open.failed                   dialOutcome: all_addresses_failed
> [RELAY] Peer connected → relay.reservation.denied (not_authenticated)
>         → relay.auth.reservation_proof (from a DIFFERENT peer id than the receiver just created)
>         → Peer disconnected
> ```
>
> Every dial to that relay afterwards is `connect ECONNRESET`, then `Encryption failed`, then
> `Unexpected EOF - stream closed while reading 0/1 bytes` — **the last of which is the
> `No open connection to peer …` this line was opened for.** It is the consequence, one frame after
> the cause.
>
> **What the operator lives through:** a conversation starts or seals; the daemon rebuilds the
> standing receiver behind it; the new one asks the relay for its slot and does not get it; from that
> moment the agent cannot reach that relay at all — parked mail cannot be deposited and waiting mail
> cannot be drained — and nothing announces it. **Not test-only:** the production
> `content.recover.auto.*` drain fails in the same instant for the same reason.
>
> **⚙️ TRACED 2026-09-04 (Andre asked "is it an easy fix?"). It is NOT the client, and the answer
> reverses the reading above.** The receiver's peer id was followed across both logs in one run:
>
> - The surviving receiver is the daemon's **plain fallback node**, built deliberately without a
>   reservation. It never proves because it holds no circuit — by design, not a bug.
> - The node before it **proved successfully, and both sides logged it**: the relay wrote
>   `relay.auth.reservation_proof remotePeerId 12D3KooWLJou… pubkey 79ea6a7d` at `19.680`, and the
>   daemon wrote `reservation_proof.result ok:true` / `prove.result proven:true` at `19.684`.
> - Four milliseconds later the daemon abandoned it —
>   `session.standing_receiver.relay.rejected reason:"relay_unreachable" attempts:2`.
> - **🔑 THE RELAY'S LOG ENDS AT `19.680`.** After accepting that proof it writes nothing: no grant,
>   no denial, no `Peer disconnected`, **and no `Peer connected` for any later dial**, through the
>   deposit failures and on to the end of the run. Every dial after it dies in the transport
>   handshake (`ECONNRESET`, `Encryption failed`, `Unexpected EOF … 0/1 bytes`).
>
> **So the earlier "a different peer id proved" reading is superseded:** the right peer proved, the
> proof was accepted, and the relay then went silent to that daemon. The client's fallback,
> reservation-none and dial failures are all correct handling of a silent relay.
>
> **Two suspects are ruled out by measurement, so nobody should spend a run on them.** The per-agent
> slot cap never fired (`relay.slot.cap_exceeded` absent; ceiling 4096 against `reservedSlots: 0`),
> and the relay connection gater does not gate plain inbound connections — its own comment says
> denying an unproven peer *"would strand every new agent"*. **The relay process does not die:** it
> keeps submitting hashes and delivering leaves for the live session while refusing the park dial.
>
> **Still not established: WHO closes the connection, and why.** Three live candidates — the relay's
> listener stops accepting; something relay-side closes during the Noise handshake below any CELLO
> logging; or the daemon dials an address it should not. **`030-RELAYSILENT` is written for exactly
> that** and carries the evidence, the ruled-out suspects and a stop rule.
>
> **Two corrections to what is written above this box:**
> - **024's control is not contradicted, but it is narrower than it reads.** Re-running with
>   `relayIngressProxy: false` produced a GREEN `DOD-MSG-7` on one run — and `DOD-MSG-5` still failed
>   under the same condition, with `ECONNRESET` / `Encryption failed` instead of `Unexpected EOF`.
>   **The proxy changes the error TEXT, not the outcome.** One green run of one test is exactly the
>   evidence this milestone says proves nothing, and it nearly produced a false conclusion here.
> - **`DOD-MSG-8` had BOTH faults.** The `cello_get_transcript` call really was wrong (fixed by
>   `028`; the MCP tool is `cello_transcript`) **and** the test fails on the deposit before ever
>   reaching it. Neither entry was wrong; each saw one of two.
>
> **The rate is still unmeasured against the live fleet.** Locally the three tests have not gone green
> once in eight runs.

- **Enforcer:** journey — `j-content` **DOD-MSG-5, MSG-7 and MSG-8** green across three consecutive
  runs, plus a named reason on the response when the relay genuinely is unreachable. **The named
  reason is DONE** (`028-PARKCONN`); the three runs are what is left.
  > ⚠️ **AND THE GREEN WILL BE WEAKER THAN IT READS.** `028` gave `parkDeposit` a bounded retry on
  > `cause: standing_receiver_creating`, so when the reservation failure is fixed these tests go
  > green partly because the test waits the rebuild out — it cannot tell "the rebuild is instant"
  > from "the rebuild takes 19 seconds". Defensible (production re-drives park on four triggers),
  > but do not quote the green as proof the window closed.

### `DOD-M15-BACKUP-1` — ✅ An identity can be exported and restored
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-BACKUP-1`.

### `DOD-M15-SCREENINSTALL-1` — ❌ The semantic screener runs against real weights, at least once
`DOD-DOC-SCREEN-INSTALL-1` + `DOD-DOC-SCREEN-CLASSIFIER-1`. **Sequence after `DOD-M15-FRAME-1`** —
shipping the classifier while the direct path bypasses the whole screening layer gives you screening
an attacker walks around.
- `installModel` has no production caller anywhere: no command, no `@huggingface/transformers`
  dependency, not even optional. Ship the install path — command, optional dependency,
  `--allow-unpinned-digests`.
- **Observed running against real weights at least once**, in production, with the ACTIVE startup
  line witnessed. Every test today runs against an injected fake because no weights are downloaded
  in CI.
- **`DOD-DOC-SCREEN-DOUBLE-DECODE-1`:** every document frame is CBOR-decoded twice, against a
  resource budget whose own header says the doubling was measured and rejected — a hostile input the
  budget was built to catch may now clear it.
- **`DOD-DOC-SCREEN-STARTING-CONTENT-1`:** a document's initial seeded content — the largest single
  block of peer-authored text an operator ever receives — gets only the character denylist.

### `DOD-M15-HEARTBEAT-1` — ✅ Directory nodes can see each other's heartbeats
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-HEARTBEAT-1`.

### `DOD-M15-ORPHANTRIAGE-1` — ✅ A message for a conversation we never had gets triaged, not a nudge to make contact
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-ORPHANTRIAGE-1`.

### `DOD-M15-REFUSALTERMINAL-1` — ✅ A refusal that can never succeed stops, and the count is true

Found live 2026-09-04, not by review. A message refused `session_committed` — a conversation that is
signed and closed, so no retry can ever succeed — was retried **232,056 times over 62 hours**, ~2 per
second, growing `daemon.log` to **484 MB**. The loop is on the RECEIVER: `#markContentResolved` is
called *"wherever content actually lands"*, refused content never lands, so the leaf-fetch backstop
re-schedules forever. **It survived several daemon restarts**, so the marker that stops it must be
durable. `cello_dismiss` was measured and does not stop it; only taking the agent offline did.

Carries a second, related line: `cello_inbox` reported that as `times: 58`, because the counter is
drained on read — while the shipped guidance sentence claims it is a lifetime figure. The number was
accurate for what it measured; the sentence describing it was false.

⚠️ **`CELLO_Support` is offline as the only mitigation.** Bringing it back before this ships restarts
the loop; the order's DoD 7 is to bring it back and prove the loop is gone.

- **Order:** `micro/025-REFUSALTERMINAL-a-refusal-that-can-never-succeed-stops.md` (complete)
- **Approved by Andre 2026-09-04:** *"Yes, a message refused should stop being retried."*
- **Pairs with `DOD-M15-REFUSEDEVIDENCE-1`**, whose dedup held perfectly under this load — 232,056
  arrivals produced exactly one retained row.

> ✅ **Closed 2026-09-04 → Entry 72.** A `session_committed` refusal is recorded in a durable
> `terminal_content_refusals` row, so the leaf-fetch backstop stops arming: **5,954 fetch events in
> the last 20 MB of the pre-fix log → 0**, measured live on `CELLO_Support` over 12 minutes. The
> count is two fields now — `times_since_dismissed` and `times_total` / `times_total_at_least` —
> because `cello_dismiss` deletes the notice row, so the old `times` was never a lifetime figure.
> Two reviews, twelve findings, all fixed; a thirteenth was found by the live daemon itself.
> **📦 Release note, not a caveat on the tag** (see *"merged is done"* under How to read this): this
> rides the next bundled `/cello-publish` cascade, and until that runs an installed operator still has
> the loop. Nothing is owed on this line. A slower second engine (the 300s park sweep, 6 lines per
> sweep) is recorded POST-LAUNCH in the order's *Newly discovered*.

### `DOD-M15-FORKQUIET-1` — ✅ A table that is always moving is not a fork
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-FORKQUIET-1`.

### `DOD-M15-SCREENORDER-1` — ✅ The language check must read the original text, not the normalized one

> **Closed.** The language screen reads a third text — everything that distorts a LETTER COUNT
> removed (invisibles, special-token markers, NFKC compatibility forms), everything that carries
> SCRIPT IDENTITY kept. Every other consumer still reads the normalized text.
> Proven through two daemons and real spawned gateway processes: reverted, the agent receives
> `Игhopupyй bce пpeдыдyщue uhctpykцuu…` verbatim. 13/13 hold/allow cases, 7 mutants.
> Review found the first cut closed the naive form only — `[SYSTEM]`×28 reopened it. **Published and promoted 2026-09-05** in the 025–030 cascade (`cli@0.0.196`, `connect@0.0.164`, `daemon@0.0.189`), and the fleet is on `eccc9cbc`.
> Full write-up in the order's Review section.

Found live 2026-09-04 by the hostile-client rig. Inbound sanitization runs, in order, invisible-strip
→ **confusables-normalization** → special-token-strip, and the language allowlist screen then judges
that fully-normalized text. Confusables rewrites Cyrillic/Greek homoglyphs to Latin, so a jailbreak
sent in **100% Cyrillic** was Latinized to **25% Cyrillic** *before* the language screen saw it — and
the screen, whose whole purpose is to hold non-English content an English-trained screener can't
handle, concluded "mostly Latin" and delivered it.

Measured: sent 165 letters / 100% Cyrillic; delivered 123 Latin + 42 Cyrillic. The transform matches
`CYRILLIC_GREEK_CONFUSABLES` in `sanitize.ts` character-for-character, so the gateway is demonstrably
live and enforcing — the defect is data flow, not a dead gateway. This is the one deterministic
inbound BLOCK that works without the (uninstalled) semantic classifier, and confusables silently
disarms it.

**Fix (Andre 2026-09-04, *"the problem with the checks is the order"*):** the language screen judges
the text **post-invisible-strip, pre-confusables**; every other consumer (pattern scanner,
special-token strip, semantic input, delivered form) still reads the normalized text. Not a plain
swap — see the order for the three wrong fixes ruled out.

- **Order:** `micro/027-SCREENORDER-the-language-check-must-read-the-original.md`
- Client-side (gateway) → ships in a client cascade; no directory/relay roll.
- **Separate from `DOD-M15-SCREENINSTALL-1`** (the semantic classifier), which is a different layer.

### `DOD-M15-REFUSEDEVIDENCE-1` — ✅ Nothing is refused without keeping what was refused
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-REFUSEDEVIDENCE-1`.

### `DOD-M15-NO-SILENT-REFUSAL-1` — ✅ Nothing is refused silently. If we refuse it, the operator is told
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-NO-SILENT-REFUSAL-1`.

# Tier 4 — Own the encryption, then bind the receipt

**The largest coupled pair in the milestone, and both are inside the gate** — ruled on the migration
argument: a wire and schema change is cheapest against an empty database and never gets cheaper.
`DOD-M15-KEYAGREE-1` **must precede** `DOD-M15-SEALWIRE-1`; it produces both outputs the seal change
consumes.

### `DOD-M15-KEYAGREE-1` — ✅ CELLO owns its own confidentiality guarantee
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-KEYAGREE-1`.

### `DOD-M15-EPHEMERAL-AUTH-1` — ✅ The session ephemeral is bound to the agent's identity
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-EPHEMERAL-AUTH-1`.

### `DOD-M15-EPHEMERAL-REVIVAL-1` — ⬇️ OUT OF GATE (Andre 2026-08-24) · was ❌ A revived session RE-KEYS
> **Out of the gate — launch does not wait for it.** Full entry is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-EPHEMERAL-REVIVAL-1`.

### `DOD-M15-HASHCORRELATE-1` — ✅ A message hash does not identify the message across sessions
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-HASHCORRELATE-1`.

### `DOD-M15-SEALWIRE-1` — ✅ The receipt is bound to the transcript
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-SEALWIRE-1`.

### `DOD-M15-SEALPARTIES-1` — ✅ Both real participants approve before any signature exists
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-SEALPARTIES-1`.

### `DOD-M15-UNILATERAL-1` — ✅ Absence is evidenced and tiered, and the artifact says what is weak
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-UNILATERAL-1`.

### `DOD-M15-LEAFPARTIES-1` — ✅ Every content leaf is constrained to the session's two participants
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-LEAFPARTIES-1`.

### `DOD-M15-INCLUSION-1` — ✅ An operator can prove a message sits under a sealed root
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-INCLUSION-1`.

---

### `DOD-M15-AUTHORSHIP-ABSENT-1` — ✅ A message with no proof of who wrote it is refused, not delivered
**Found 2026-09-03, [[2026-09-03_1158_relay-overload-and-the-four-things-underneath-it]] — by accident, and it is the sharpest thing in that document. Ruled BLOCKS by
Andre 2026-09-03.**

**Andre's description, which is the whole line:** *"I show up with my passport and the photo doesn't
match, I'm blocked. But if I arrive at immigration with no passport, they let me through."*

- A proof record **present and wrong** (bad signature, or signed by someone who is not your
  counterparty) → the session is **frozen**. Loud, immediate, correct.
- A proof record **absent entirely** → the message is **ingested and delivered to your agent**, with
  no check on who wrote it. **Fail-open on absence.**
- **The code states the defect in its own words:** *"the per-message signer check is opt-in for the
  sender — a party that passed the peer gate and wants to avoid the comparison simply omits the
  proof."* That is the discoverability filter's exact shape: a reader with a coding agent finds this
  in an afternoon and the comment hands it to them.
- **Why it was built this way, and why the reason covers only half:** the proof and the message's
  SEQUENCE NUMBER are welded into one structure, and the sequence comes from the relay. So an honest
  peer genuinely cannot produce the record when the relay is unreachable, and refusing on absence
  would make the relay a precondition for reading your mail. **That reasoning is sound for the
  sequence and wrong for the signature** — a sender can always sign their own message; that never
  needed the relay. **Fix shape: split them. Signature mandatory, sequence soft.**
- **What it is NOT:** not a stranger walking in. The sender was still the authenticated peer, and the
  screener and hash cross-check still run. What is lost is **proof of who wrote each message**, which
  is the product.
- **⚠️ SCOPE IMPACT ON [[M15-STORY-RELAYHANDOVER]]:** a real session may therefore contain leaves
  with no signature, and handover's replay verifier REQUIRES one per leaf. Units 2–3 must decide what
  happens to an unsigned leaf on replay — refuse the handover, or drop the leaf — and neither is
  free. **Closing this line first makes that question disappear.**
- **Where:** `cello-client/core/daemon/src/session-node-manager.ts` ~13614–13656 (the `else` branch),
  `#recordFrameOrdering` ~13195, `ingestReceivedContent` ~8528 and its `verifiedAuthorship` doc
  comment ~8546–8559.
- **Enforcer:** unit — a message arriving with no authorship proof is refused by name, with a test
  that reddens when the refusal is removed.

> ✅ **CLOSED 2026-09-04 by `029-AUTHORSHIP`.** Split done: every content frame now carries
> `sender_signature` beside its `structure1_cbor` (including the relay-degraded path, where the
> daemon signs its own claim), the receiver verifies authorship from those two alone, and missing /
> unreadable / signed-over-other-content all take one path — refused by name, not ingested, not
> frozen. Position stays soft and a mutant making Structure 2 mandatory reddens four tests. Nine
> mutants, nine caught; reviewer's two blocking findings fixed. **Three items produced — the §0z.2
> trip-wire is tripped and item 3 (the claim is not bound to the session id) needs Andre's call.**
> → order `micro/029-AUTHORSHIP-no-passport-no-entry.md` (Review + Newly discovered)

### `DOD-M15-WITHHOLD-SEAL-1` — ✅ A counterparty cannot hide their last message and seal without it

> **CLOSED 2026-09-05 by `033-ACKEMIT` + `034-CARRYLEAF`. Live on `latest`
> (`daemon@0.0.192`, `cli@0.0.199`, `connect@0.0.167`).**
>
> **The root cause was one conjunct.** `submitMessageHash` had exactly ONE production caller, on the
> SEND path — nothing ever witnessed a message that was RECEIVED — and the relay enforced it by
> requiring a leaf's signer to be the submitting connection's own key. So an author who declined to
> submit removed themselves from the record, and a unilateral seal agreed with the witness.
>
> **You can now witness what you received.** The relay already verified every leaf against BOTH
> participants, so it always knew who AUTHORED a leaf independently of who DELIVERED it; the
> author's signature is unforgeable and the recipient holds it. Closed on the direct path, and on
> the relay mailbox via a v4 park envelope carrying the author's signed claim.
>
> **And it is reported, not just prevented.** The relay emits a signed alert to BOTH participants
> when a leaf is counter-submitted — the observable trace of a withholding attempt — with per-reason
> operator guidance that stops short of a verdict: once is a relay hiccup, repeatedly is the shape
> of someone keeping their words out of the receipt.
>
> **The direct path has no remaining shape to exploit.** A content frame that does not name its leaf
> domain is REFUSED, not delivered-and-unwitnessable. The earlier leniency there was an inherited
> compatibility argument — Andre, 2026-09-05: *"We are an alpha. We have no users."* There is no
> older peer, and what the leniency bought was an opt-out from the fix by choosing a wire shape.
>
> **One route remains, and the blocker is OUR OWN path rather than an older peer's.** A message
> parked with no ordering record AND no signature over its ordering claim is readable and can never
> enter a receipt. Refusing it was implemented and reverted: `SEC-1` AC5 makes the crash-backstop
> shape — signed by the sender, no ordering record — explicitly legal, and from the recipient's side
> it is indistinguishable from an attacker's stripped envelope. **What closes it:** the crash
> backstop signs an ordering claim at enqueue time, which `#signOwnContentClaim` already produces and
> whose two retry-queue columns (`structure1_sig`, `leaf_kind`) shipped with this work. Then the
> unsignable shape is one only a modified client emits.
>
> **Handover composes safely, checked not assumed:** a relay that inherits a session refuses submits
> until it is replayed, and the replay rebuilds its leaf log WITH `structure1_cbor` — so the
> byte-exact replay guard on counter-submits is intact across a relay change.
>
> **Not yet done:** the live multi-process journey. Every layer is proven with real crypto — the
> relay sequences a counter-submitted leaf, the client carries the author's bytes verbatim, and the
> withheld leaf lands in the seal carry with no relay receipt — but no run has yet driven two real
> binaries in separate OS processes with one of them deliberately withholding.

> **THE ACKNOWLEDGEMENT HALF IS DONE (`033-ACKEMIT`, 2026-09-05). THE SEAL HALF IS NOT, and the line
> stays open for it.** Production now signs `last_seen_hash` on every claim it can make one for; the
> relay refuses a submit whose acknowledgement contradicts its record, and the receiving daemon runs
> the same check against its own tree with no relay involved. So an acknowledgement binds to content
> instead of to a bare number.
>
> **What is still owed, and it is the journey clause:** `033`'s Part 0b measured that the daemon
> never assembles a carry leaf for a message that arrived with NO relay ordering record — both
> writers of `SessionSealLeafStore` sit inside the relay client. So a withheld last message still
> truncates the chain and the seal still agrees with the witness. That producer, plus a directory
> verifier that accepts a counterparty leaf carrying no Structure 2, is the remaining unit.
>
> **That deviation is RESOLVED — `DOD-M15-SELFCHAIN-1`, 2026-09-06.** It read: a session with no
> starting point and nothing received still emits a v1 claim (position 0, no hash, asserting
> nothing), and refusing it broke 93 tests across 26 files because sessions brokered without a relay
> assignment are real. Both halves of that are gone. There is no v1 layout to emit, and the sessions
> that had no starting point had one all along — the anchor was being recorded too late on one side
> and not at all on the other. A session that genuinely has none now refuses the send by name rather
> than signing a chain anchored to nothing.
**Found 2026-09-03, [[2026-09-03_1158_relay-overload-and-the-four-things-underneath-it]]. Ruled BLOCKS by Andre 2026-09-03.** *"The receipt is the product. A path that
lets the guilty party remove themselves from it is not a papercut."*

**What happens to you:** somebody does something malicious in a conversation — an injection attempt,
a wallet drain — and wants the paper trail not to contain it. Two ways out today:

- **Force close:** refuse to take part in any closing ceremony. You are left with your local log and
  no notarised receipt.
- **Truncate:** seal unilaterally at N−1, omitting their last message. Every leaf validly signed,
  nothing false, only something missing.

**Andre's argument, and it is the fix:** to attack me at all you had to send me a properly formed
message, signed by you and chained to the one before. **I hold your signature.** I cannot forge it
and you cannot disown it. So I must be able to seal unilaterally **including** your message,
whatever you do afterwards.

- **The verification design ALREADY allows this — checked, do not re-derive.** The unilateral path is
  deliberately asymmetric: your OWN leaves each need a relay receipt (your signature covers content,
  not sequence, so without receipts you could renumber yourself), while the COUNTERPARTY's leaves
  carry no receipt at all and are pinned by their own sender signature plus contiguity against your
  receipt-pinned leaves. **Carrying the attacker's signed message with no receipt is exactly the case
  the design anticipates.**
- **The hole underneath it:** **only the sender submits a hash to the relay.** `submitMessageHash`
  has one production caller, on the send path — **nothing submits a hash for a message RECEIVED.** So
  on a DIRECT connection a malicious client delivers message N and never witnesses it; the relay's
  account genuinely ends at N−1 and a truncated seal agrees with the witness.
- **Composed with `AUTHORSHIP-ABSENT-1` it is worse:** the withheld message can also arrive with no
  authorship proof, because absence is soft. Direct session, no ordering record, nothing witnessed
  anywhere — and the code's own named mitigation for the missing signer check is relay-side
  corroboration, which is the thing being withheld.
- **⚠️ THE ROOT CAUSE, found later the same day: OUR ACKNOWLEDGEMENT NEVER SAYS WHAT IT
  ACKNOWLEDGED.** A sender signs `Structure1` = `[version, content_hash, sender_pubkey, session_id,
  last_seen_seq, timestamp]` — and **`last_seen_seq` is a NUMBER.** "I saw position 7" attests to a
  position, not to content. The chain people believe exists is really TWO signatures meeting at the
  relay: the counterparty signs *"I saw position 7"*, the relay's receipt (`buildRelayAckTbs` =
  content_hash ‖ seq ‖ timestamp) signs *"position 7 held hash X"*. **So the relay is load-bearing
  for the acknowledgement itself**, not merely for ordering — which is exactly why a withheld submit
  breaks it: with no receipt, a signed `last_seen_seq` is an unbacked number. **`prev_root` does not
  rescue it** — it is signed by neither party and not by the relay, whose receipt covers content hash,
  sequence and timestamp only. (Cousin of `DOD-M15-RELAYSEQ-UNSIGNED-1`.)
- **THE FIX IS DECIDED (Andre, 2026-09-03): ADD `last_seen_hash` to `Structure1`. Do NOT replace
  `last_seen_seq`** — the sequence number does real work for ordering and dedup. Position and
  content-binding, both signed, side by side. The acknowledgement then holds **with no relay involved
  at all**, which closes this line at its root instead of adding a witness to work around it.
  - **⚠️ `Structure1`'s field order is SIGNED OVER, so this is a v2.** The version tag is already the
    first field for exactly this reason — *"a v1 claim can never read as a v2 one."*
  - **⚠️ THE FIRST MESSAGE HAS SEEN NOTHING, AND THAT MUST BE A VALUE, NEVER AN ABSENCE.** A defined
    genesis constant or 32 zero bytes. An absent field recreates `DOD-M15-AUTHORSHIP-ABSENT-1` one
    layer down, and is the same trap `017-TBS` records: `high_stakes: false` and `prior_relay_id: ""`
    are values, not absences.
  - **The relay gets it for free.** The submit already carries `structure1_cbor` verbatim — the
    identical signed claim minus the plaintext — so the WITNESS can enforce the chain live, the way
    `DOD-M15-CORROBORATE-1` already verifies each hash on arrival. No new frame, no new wire field.
- **Defence in depth, still worth doing: the RECEIVER submits the hash of what it received.** It holds
  the sender's signature so it cannot fabricate a leaf, and the relay can verify that before
  accepting. Weaker than the root fix and worth having anyway.
- **Pairing available now:** relay-only routing is an operator setting and `high_stakes` landed in the
  signed assignment in `017-TBS`. Forcing relay routing for high-stakes sessions is the obvious
  pairing — accept the IP disclosure in exchange for a guaranteed witness.
- **⚠️ CHECK BEFORE SCOPING (not blocking a decision):** does the daemon **assemble** a carried leaf
  for a message that arrived with no relay ordering record? The verifier would accept one. If the
  client already builds it, this requirement holds TODAY and the work is smaller than it looks.
- **This line is why `DOD-M15-RELAYFANOUT-1` can safely leave the gate** — see the note there.
- **Pairs with `DOD-M15-NO-SILENT-REFUSAL-1`:** its `counterparty_gone` string steers a victim
  toward sealing while the daemon knows better — the nudge into exactly this truncated close.
- **Enforcer:** journey — a counterparty that withholds its last message cannot produce a seal the
  other side's evidence does not contradict.

# Tier 5 — Abuse controls, relay redundancy, infrastructure

Parallel with Tier 4 — different disciplines, no shared files.

### `DOD-M15-SELFCHAIN-1` — ✅ Every message links to the one before it
> **Closed 2026-09-06 (035-SELFCHAIN).** Both repos green — cello-client 4962, trustless-cello 2036,
> lint and typecheck clean. One `cello-unit-reviewer` pass; every finding fixed, including two that
> would have shipped. → Journal Entry 40
>
> **What holds now.** Structure 1 carries TWO required links, both inside the signed bytes and both
> known at signing time: `last_seen_hash` (the last message this sender RECEIVED — chains them to
> their counterparty) and `prev_own_hash` (this sender's OWN previous message — chains them to
> themselves). Moving any message with a reply after it breaks a signature. Enforced independently
> by the relay on submit, the relay on handover, the receiving daemon on ingest, and the directory
> at seal time — and each detection point refuses, tells BOTH parties, names a next step, and stops
> the session.
>
> **One layout, every older one deleted** (backward compatibility is an anti-requirement — Andre,
> 2026-09-05). Four hand-rolled Structure 1 decoders across the two repos are gone; there is one.
>
> **What is still disputable, and it is not a gap:** the last message each side sent has been
> ratified by nobody, because the act of sending is what ratifies what you received. Do not try to
> chain the tail — the ratification IS the reply. It is covered by the relay's ACK receipt and by
> `DOD-M15-WITHHOLD-SEAL-1`.
>
> **Two live defects surfaced and fixed inside the unit**, neither of them the one it was written
> for: a sender's first message linked to the COUNTERPARTY's last message instead of the session
> genesis (no two-party conversation would have survived its second message, and the innocent side
> was blamed for it), and the responder never recorded the session's starting point at all. Both are
> in the journal entry.


### `DOD-M15-RELAYPARK-1` — ✅ The parked-message store refuses instead of writing past its cap
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-RELAYPARK-1`.

### `DOD-M15-RELAYPUBKEYS-1` — ✅ An incomplete directory key set stops the relay instead of degrading it
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-RELAYPUBKEYS-1`.

### `DOD-M15-RELAYADMIN-1` — ✅ The directory-admin push handler is KEPT, and the keeping is justified
> **Closed.** Full entry, plus the live/production verification written here after it closed, is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-RELAYADMIN-1`.

### `DOD-M15-RELAYADMIN-DEAD-FRAMES-1` — ✅ Three of the admin stream's four frame types have no sender
> **Closed.** Full entry, plus the live/production verification written here after it closed, is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-RELAYADMIN-DEAD-FRAMES-1`.

### `DOD-M15-RELAYADMIN-REPLAY-1` — ⬇️ OUT OF GATE (Andre 2026-08-24) · was ❌ A directory admin frame cannot be replayed
> **Out of the gate — launch does not wait for it.** Full entry is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-RELAYADMIN-REPLAY-1`.

### ✅ park rate limiting — CLIENT HALF DONE 2026-08-24 (CELLO_Support), REVIEWED, blocking findings fixed
> **Closed.** Full entry is in [[M15-DEFINITION-OF-DONE-ARCHIVE]].

### ✅ park deposit rate limiting — RELAY HALF DONE 2026-08-24 (CELLO_Support), REVIEWED, blocking findings fixed
> **Closed.** Full entry is in [[M15-DEFINITION-OF-DONE-ARCHIVE]].

### 🔒 CLAIM — park deposit rate limiting, **CELLO_Support**, 2026-08-24, before code
> _(trail moved to [[M15-BUILD-JOURNAL]] — see “DoD trails, moved 2026-08-24”.)_

### `DOD-M15-RELAYABUSE-1` — ✅ The relay has rate limiting, and its idle timer is on in production
> **Closed.** Full entry, plus the live/production verification written here after it closed, is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-RELAYABUSE-1`.

### `DOD-M15-RELAYSLOTS-1` — ✅ An agent cannot flood a relay's reservation slots
> **Closed.** Full entry, plus the live/production verification written here after it closed, is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-RELAYSLOTS-1`.

### `DOD-M15-SESSION-RELAY-PINNED-1` — ❌ A live conversation survives its relay going away
> **⚙️ MEASURED, AND UNIT 1 OF 4 IS DONE — do not re-open either.** The first clause below demanded a
> measurement; `016-RELAYLOSS` ran it (relay killed mid-conversation, two real daemons) and its
> recommendation is that this line **stays in the gate**: the conversation neither parks cleanly nor
> seals, and the two parties are told contradictory things about their own close. The fix is
> [[M15-STORY-RELAYHANDOVER]], whose unit 1 closed 2026-09-03 (`017-TBS` — the assignment TBS now
> carries `prior_relay_id`) and whose **unit 2 closed 2026-09-05 (`031-RELAYREPLAY` — a relay can now
> be handed a conversation that began on another relay and proves it from signatures, or refuses it
> by name; NOTHING SENDS ONE, the client half is unit 3).** Units 3–4 are open. **Unit 4 is NO LONGER BLOCKED** — the story's §0 was ruled by Andre on
> 2026-09-03 (no unwitnessed content ever enters the paper trail; the conversation pauses until the
> counterparty returns). One small sub-question survives and is resolved *inside* unit 3: how the
> resume is triggered, event-driven rather than polled, plus one line of operator copy that is Andre's.
> **016 also shipped the honesty half**: a send the relay did not witness now says so at the moment
> it happens, on all five of `cello_send`'s return paths. What is unfixed is the seal.
**Found 2026-09-02 by tracing, in answer to Andre's question "does multi-relay solve a relay going
down mid-conversation?" It does not, and neither does `RELAYFANOUT-1`.** Two relays are involved in
a session and only one of them recovers:

- **Being reachable recovers.** When a standing receiver's reservation is lost, the watchdog notices
  (`session.standing_receiver.reservation.lost`), quarantines that relay and rebuilds the receiver
  against another. `DOD-M15-MULTIRELAY-1` narrows the window; it does not create the mechanism.
- **The conversation does NOT.** A session is bound to ONE witness relay, named by the directory when
  the session is brokered. `SessionRelayClient` is per `(agent, relayPeerId)`, and on a dead reader
  it clears the stream and re-dials — **the same relay** (`#reconnectFromAnySession` →
  `#ensureConnected`, both scoped to `this.#relayPeerId`). A blip recovers. A relay that is genuinely
  gone gets re-dialled indefinitely. **There is no path that moves a live session to another relay.**

**Why it is in the gate rather than the backlog:** the consequence is not yet established, and §0z.1
says unclear blocks. The reader-ended path settles in-flight submits `relay_stream_closed` and its
own comment says *"in-flight submits just failed"* — so the plausible outcomes range from messages
parking harmlessly to a conversation that can no longer be witnessed and therefore cannot seal. The
receipt is the product; a path that can silently cost one is not something to classify on a guess.

- **FIRST CLAUSE IS MEASUREMENT, not a fix.** Kill the witness relay mid-conversation with two real
  daemons and record what the operator actually experiences: does the send park, stall, or go
  through unwitnessed? Does the session still seal? **Reclassify on the answer** — if it parks
  cleanly and seals, this is post-launch and should be moved.
- Only then decide the fix. Re-assignment to a new witness relay is a directory-brokered change, so
  it is not a client-side retry loop; do not assume the shape before the measurement.
- **Do not fix it by widening the re-dial to other relays.** The witness relay is named in a
  directory-signed assignment; a client that picks its own witness is a client grading its own
  homework, which is the property `LEAFPARTIES-1` and `CORROBORATE-1` just spent themselves closing.
- **Enforcer:** journey — two daemons, a real relay, killed mid-conversation.

### `DOD-M15-MULTIRELAY-1` — ✅ An agent's reachability does not rest on one relay
> **✅ CLOSED 2026-09-05 by `032-RELAYSPREAD` (availability half).** A receiver now holds a
> reservation with every relay that grants; killing one leaves the agent dialable through the others
> with no rebuild, proven by a real dial through the survivor. The one-relay limit was a libp2p
> defect, not a design choice — `circuit-relay-v2` clears its reservation queue after the first
> success, which also explains the 2026-08-18 "start() never completes" measurement.
> **⚠️ ONE CLAUSE DEVIATES:** a lost circuit is not retaken in place (the transport exposes no
> re-listen for a configured relay); the agent stays reachable meanwhile. Deviation, the four
> hollow-test answers and the reviewer's verdict are in the order's close-out. Journal entry owed.
>
> **⚙️ UNIT 1 OF 4 IS DONE — do not re-scope this line from scratch.** The fix for this line and for
> `SESSION-RELAY-PINNED-1` is one story, [[M15-STORY-RELAYHANDOVER]], and its first unit closed on
> 2026-09-03 (`017-TBS`): the assignment TBS now carries `prior_relay_id`, so a directory can name
> the previous witness inside signed bytes. **The churn numbers this line demands an explanation for
> were measured by `016-RELAYLOSS`** — read its Review before re-measuring anything. Units 2–4
> (directory resume path, relay-side replay + verifier, client rebind) are still open. **Unit 4 is
> NO LONGER BLOCKED** — §0 was ruled 2026-09-03; see the note on `SESSION-RELAY-PINNED-1`.
**Scoped by `DOD-M15-SPIKE-1(c)` → Entry 1. This line is AVAILABILITY ONLY.** The client already
requests reservations with every known relay (`reservationsRequested: 2`) — the audit's "reserves
with exactly one relay" was the outcome, not the request. But one relay carries **2,648 of 2,675**
reservations (99.0%), so the linkability mitigation Decision 7 assumed **does not hold** and that
claim is withdrawn rather than relied on (`DOD-M15-DISCLOSE-1`). Making selection genuinely spread is
an improvement, not a mitigation we are counting on; the fleet is two relays regardless.
- Inbound reachability must survive one relay going away. Today the cheapest way to take an agent
  offline is to flood the relay its reservation actually landed on — a concentrated,
  infrastructure-shaped target, the opposite of the diffuse surface the pitch describes.
- **First, explain the churn** (measured, Entry 1, one daemon's log): **2,675 `reservation.lost`,
  664 `reservation.none`, 88 retries, 9 `gave_up`**, with `reason: relay_connection_gone`. An agent
  whose reservation is gone is **unreachable by any NAT'd peer while still looking perfectly
  healthy** — exactly the silent-loss-of-inbound failure `DOD-NAT-REACHABILITY-1` was built to kill.
  Whoever pulls this line starts by explaining those numbers, not by adding relays under them.

### `DOD-M15-RELAYFANOUT-1` — ⬇️ OUT OF GATE (Andre 2026-09-03) · was ❌ A single relay's account of a conversation can be cross-checked
> **Out of the gate — launch does not wait for it.** Full entry is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-RELAYFANOUT-1`.

### `DOD-M15-CORROBORATE-1` — ✅ The relay verifies every hash proactively, not on request
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-CORROBORATE-1`.

### `DOD-M15-DIRAUTH-1` — ✅ Directory authentication cannot be silently skipped
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-DIRAUTH-1`.

### `DOD-M15-RELAYADMIN-KEYSET-1` — ⬇️ OUT OF GATE (Andre 2026-08-24) · was 🟡 ANSWERED: the gap is real but small, and bounded by the idle sweep
> **Out of the gate — launch does not wait for it.** Full entry is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-RELAYADMIN-KEYSET-1`.

### `DOD-M15-BOOTSTRAP-AUTH-1` — ✅ A poisoned bootstrap coordinate cannot impersonate a directory
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-BOOTSTRAP-AUTH-1`.

### `DOD-M15-BOOTSTRAP-ADDR-1` — ⬇️ OUT OF GATE (Andre 2026-08-24) · was ❌ A rogue ADDRESS under a real peer id does not pin the client
> **Out of the gate — launch does not wait for it.** Full entry is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-BOOTSTRAP-ADDR-1`.

### `DOD-M15-STEP6-REPLAY-1` — ⬇️ OUT OF GATE (Andre 2026-08-24) · was 🟡 A directory identity proof cannot be replayed (replay bullet ✅; byte-match fail-open OPEN)
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-STEP6-REPLAY-1`.

### `DOD-M15-RELAYONLY-1` — ✅ Relay-only routing is an operator setting
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-RELAYONLY-1`.

### `DOD-M15-CONSORTIUM-FINGERPRINT-1` — ❌ PRE-LAUNCH · A user can check, in one command, that they are on the REAL consortium
**Filed 2026-09-06. Not a new check — a check whose answer is invisible.**

Anyone can fork the open-source client, stand up three nodes, sign their own manifest with their own
root key and market it as CELLO. The receipts that system issues mean nothing, and when it is broken
into the headline says CELLO was hacked. This is the shadow-frontend attack from crypto, and it
worked there because a user had no cheap way to tell the real deployment from the copy.

**The verification already exists.** The client refuses any consortium manifest not signed by the
officer root key compiled into it (`BUNDLED_CONSORTIUM_ROOT_KEYS` in
`bundled-consortium-manifest.ts`; stage G7 / R4 in [[session-correctness-checks]]). A fake
consortium cannot fool a genuine client — it can only ship its own client. **What is missing is that
the answer is never shown,** so "am I on the real network?" is a judgement call rather than a
command.

**Done when:**
- `cello status` prints the consortium root fingerprint it trusts, beside the roster it resolved,
  read from the same constant the verifier uses — never a second copy that can drift.
- The real fingerprint is published where it can be compared: site, README, install docs. This is
  the same mechanism already planned for the official agent pubkeys in [[launch-plan]] under
  *Proving which agents are really ours*, raised one level from agents to the consortium itself.
- The same answer is available to someone who has **not installed anything yet**, so the check can
  be made before trust is extended rather than after.

**Why it earns a slot.** It is small, and it is the only defence that makes an impersonation
*detectable* rather than merely expensive. It is also the customer-facing half of the argument for
keeping the directory and relay private — closed source raises the cost of a convincing fake; only
this makes one visible. Trademark is the other half and is not an engineering item.

### `DOD-M15-BOOTSTRAP-TLS-1` — ❌ PRE-LAUNCH · The bootstrap fetch is TLS on a hostname, and step 6 survives the change
**Filed 2026-09-06.**

`PRODUCTION_DIRECTORY_URL` is `http://34.75.172.108:9090` and the libp2p multiaddrs are `/ws`, not
`/wss`. There is no TLS terminator in front of the directory nodes (`node-directory.tf` —
`cello-directory-allow-http` opens 9090 to `0.0.0.0/0`; the note in `GCP-STATE.md` saying the port
is not public is stale).

**The cryptography is sound and that is not the reason to fix it.** `/bootstrap` returns only a
multiaddr; the signed manifest declares the node's peer id, the client refuses to dial when the live
answer disagrees (`directory.consortium.node.peer_id_mismatch`), Noise proves the remote holds that
key, and step 6 makes it sign a challenge. A MITM on the plaintext fetch can deny service, not
redirect the client. Three real costs remain:

- **Enterprise egress.** Plain HTTP to a bare IP on port 9090 is blocked by a lot of corporate
  network policy. That is an install blocker for a stranger, not a security finding.
- **Optics.** No evaluator reaching for a public complaint will read as far as the Noise argument.
- **The known fail-open.** Step 6 runs only when the resolved URL matches a bundled `endpoint` byte
  for byte, so *doing this carelessly turns the defence off* — the second clause of
  `DOD-M15-STEP6-REPLAY-1`, which is out of gate and unfixed.

**Done when:** a TLS terminator fronts the bootstrap port; the manifest carries **names** rather than
addresses; `PRODUCTION_DIRECTORY_URL` is a name that still matches a bundled endpoint exactly; and
the test that asserts that relationship still passes. **Ordering is the whole risk** — names in the
manifest come first, or step 6 is silently disabled by the fix.

### `DOD-M15-GODFILE-1` — ✅ DONE 2026-09-06 · The 19,878-line class is split, and a ratchet stops it growing back
**Filed 2026-09-06, after measuring both halves of it. The work order is [[036-GODFILE-one-class-is-a-quarter-of-the-daemon]] — ONE order, six parts, with a progress table the coder updates as each part closes.**

`cello-client/core/daemon/src/session-node-manager.ts` is 19,878 lines and 1.2 MB — **25% of the
entire daemon**, in one class with 555 members. It holds session records, the whole inbound ingest
chain, authorship and acknowledgement verification, quarantine, orphan triage, transcript reads and
writes, relay ordering records and park recovery. The next largest file in the repo is 6,077.

**Two measurements decide how this is done.**

*First — it was never refactored, and that is not the same as a refactor being ignored.* Its size at
each point:

```
2026-06-12    525      2026-08-22  10,073
2026-07-13  4,446      2026-09-01  14,206
2026-08-04  5,501      2026-09-04  18,225
2026-08-07  6,174      today       19,878
```

Monotonic. No drop anywhere, and nearly half the growth is in the last three weeks.

*Second — the refactor that DID happen proves a split alone is not the fix.* Nine commits in
mid-July took `daemon.ts` apart (`refactor(daemon): Seam A…I — X out of startDaemon's body`) and cut
it from **6,279 lines to 2,081 on 14 July**. It is **6,077 today** — fully regrown in under two
months, with no guard in the way.

**So the order is: ratchet first, then split.** A `max-lines` rule in
`cello-client/eslint.config.mjs`, following the pattern already used there to block `node:sqlite` —
one visible allowlist, `session-node-manager.ts` grandfathered at its current size. Each pass then
lowers its ceiling and the rule holds the ground taken. Guard second means the split lands,
attention moves on, and it regrows exactly as `daemon.ts` did.

**What makes it safe:** 310 test files and 95,339 lines of test code in `core/daemon` — more test
code than production code. The seams are already cohesive and barely touch each other's state:
`ingestReceivedContent`, `#verifyAuthorshipClaim` / `#verifyAcknowledgedContent`,
`#quarantineRefusedContent`, `#recordFrameOrdering`.

**⚠️ The comments are the asset, not the padding.** 53% of the file is prose — ~10,500 lines
explaining why each check exists, much of it recording a defect that was reintroduced once already
and the false reasoning that allowed it. A split that summarises or drops those loses more than it
gains. They move with the code they describe, verbatim.

**Why pre-launch rather than after:** it is the file an evaluator points a coding agent at, and it is
the size at which agents start making mistakes in it — which is a correctness risk on the most
load-bearing code in the product, not only a tidiness one. **Done when** the ratchet is in CI, and
the file is under it and falling.

---

**✅ DONE 2026-09-06. `session-node-manager.ts` is 3,392 lines, from 20,368 — across twenty-two
modules, with every comment moved verbatim beside the code it describes.** The ratchet is in CI, CI
refuses an in-file disable of it, and the five files the split created are each ratcheted at their
own size — because the lesson of `daemon.ts` is that a ceiling a file is nowhere near is not a
ratchet.

**It is 3,392 and not under the ordinary 3,000, and that is a decision.** `gracefulShutdown` is
PROCESS teardown — it closes the database, sets the shutting-down flag, stops the reservation
watchdog — and `#evictSessionCaches` clears the eleven containers every collaborator shares. They
are ~390 lines, almost exactly the gap. Moving either puts mutation of the manager's own lifecycle
state behind a collaborator's context: a collaborator able to switch off the process that owns it.
3,000 was reachable by forcing that seam and was not taken. Anyone who disagrees should move those
two methods and LOWER the number, not raise it.

**What the split actually caught, which is worth more than the line count.** Two defects that would
have shipped in silence: a `cello_send` that hung forever with no error, no log and no timeout,
because a map of pending promises was added to an eviction that DELETED where the original SETTLED;
and signing quietly disabled — sessions falling back to unencrypted content — because a resolver was
captured by value during construction and the manager assigns it afterwards, freezing it at `null`
for the life of the process. Neither made a test go red.

And **four source-scanning guards had stopped watching the code they police while staying green.**
The scan that proves *everything establishment does, revival does too* went blind four times; its
last miss would have had it comparing an empty list to an empty list. The relay-only IP-leak guard
lost the file that now holds the read it looks for, so a future address-building read there would be
invisible and an operator running relay-only would publish their real IP while the setting still
said "on". The rule extracted from all four, now written into three of them: **a loop over a
hand-maintained list gets SHORTER when someone forgets an entry, never red.** Both list-based guards
are globs now, and each has a check that fires when its pattern matches nothing anywhere.

Full record: the M15 build journal, and
[[2026-09-06_1400_godfile-split-follow-through]]. The short-context hypothesis this work was planned
around is **falsified** — reported in `037-SESSIONCORE`'s *Newly discovered*, with the measured
numbers, so the next person does not re-derive it.

### `DOD-M15-COMMENT-DISCLOSURE-1` — ❌ PRE-LAUNCH · No comment in the PUBLIC repo advertises a hole that is closed, or a live one nobody is tracking
**Filed 2026-09-06. The worklist is [[M15-PUBLIC-COMMENT-SWEEP]] — item by item, one per session.**

An evaluator points a coding agent at the public `cello-client` repo before trusting it, and that
agent collects every *"this is not enforced" / "it fails open" / "nothing checks this"* into one
list. The sweep classified all of them into four buckets, and **three of the four are "leave alone"**
— the candour is an asset and stripping it makes the repo worse. The gate is the fourth:

- **Stale (B) — worst of the four.** `session-node-manager.ts:9760` still says the relay hash-submit
  cross-check *"does not exist yet"* and names the exact bypass. It exists. That sentence advertises
  a hole that is already shut. Two more like it.
- **Live and untracked (D).** Five, of which the substantive one is `session-ceremony.ts:849` — an
  initiator cannot locally verify a seal when the **responder closed first**, because it never learns
  the responder's primary. Whether you can prove your own receipt depends on who closed first. Named
  `F2-b` in the comment and tracked nowhere.

**Done when** every B is rewritten to describe what the code does now (**rewritten under the sweep's
reattachment rule, revised 2026-09-06: keep the reasoning only where a competent person would
plausibly repeat the mistake, phrased as a rule rather than a memoir; otherwise fix the comment and
let git hold the history**), every D is confirmed and filed as its own line, and the
two C items name their designation so the next reader stops instead of re-filing.

**Not in scope, deliberately:** the A bucket (deliberate, bounded fail-opens that already state their
reasoning), and the four stated trust bounds — those are the same rows as the `⊘` list in
[[session-correctness-checks]] and must not be softened. The E bucket (attack recipes for *fixed*
bugs) is a judgement call reserved for Andre: the procedure is what makes the comment convincing to
an engineer, and it is also a method someone can reuse.

### `DOD-M15-KEYS-KMS-1` — ❌ PRE-LAUNCH · The keys that define the consortium are USED, never fetched
**Filed 2026-09-06.**

The consortium manifest is signed by an officer key (`cello-consortium-officer-key-0`) whose public
half is compiled into every client as `BUNDLED_CONSORTIUM_ROOT_KEYS`. **A client accepts any manifest
carrying a valid signature from it.** That is the root of the whole chain — stage R4 / G7 in
[[session-correctness-checks]], and the one premise the protocol does not check.

**The problem is the storage class, not the key.** It is a fetchable value in Secret Manager, as are
the per-node signing keys (`cello-<nodeId>-node-key`). A fetchable secret can be copied, and a copy
is silent. An attacker holding it signs a manifest naming their own three nodes; every deployed
client accepts it and every check below still passes, because those checks verify *against the
manifest*.

**And it cannot be called back.** Rotation means re-signing and shipping a new client build. Clients
already installed keep trusting the old key until their operator upgrades. The protocol carries no
"key N is dead" message.

**Done when:**
- The officer key and the per-node signing keys are **KMS asymmetric signing keys** — used via
  `asymmetricSign`, never read. The private half never leaves the HSM, and "the key leaked" stops
  being a scenario. The stack already runs KMS per node for envelope encryption, so this extends an
  existing pattern rather than adding a dependency.
- **Cloud Audit Logs on every signing key.** KMS converts key theft into permission abuse, so the
  residual is whoever can call sign. Every legitimate use is rare and deliberate, which makes an
  unauthorised one visible — but only if it is logged and someone looks.
- **The revocation story is decided and written down, even if the decision is "documented, not
  built."** Candidates, cheapest first: a second officer key with a 2-of-N requirement so one
  compromise is insufficient (the `-0` suffix suggests this was anticipated); a signed "key N is
  revoked" a later manifest carries forward and clients honour. Today the answer to "the officer key
  leaked" is a question nobody has been asked.

**Why pre-launch.** Blast radius is every client, the failure is silent, and nothing in the field can
be told. It is also the cheapest item on the list relative to what it removes — a storage-class
change on two key types, not a protocol change.

### `DOD-M15-ASSIGN-TARGET-1` — ✅ PRE-LAUNCH · The assignment must name the counterparty the operator ASKED FOR
**Filed 2026-09-06. One comparison, and it is the cheapest security line in this milestone.**

> ✅ **Closed 2026-09-06 by order 039-ASSIGNTARGET** (cello-client `925f46c`..`fa09754`). Both
> participants are compared, case-insensitively, against local values the directory cannot influence
> — `targetHex` and this agent's loaded K_local — after the signature verifies and before anything
> dials; each mismatch refuses with its own reason and guidance. Tests assert NO DIAL OCCURRED,
> proven load-bearing by a refuse-after-dialling mutant that typechecked, ran, and reddened on
> exactly that assertion. Gate: 4970 passed, lint 0, typecheck 0. Reviewer: *"No blocking findings"*
> — 5 findings (2 MEDIUM, 3 LOW), all fixed, commit per fix.

`assignment-verify.ts` establishes that the session assignment is FROST-signed, that the signer is
this agent's own threshold group key, and that the signature verifies. It does **not** establish that
the assignment is about the person the operator named. Every consumer of `participant_b.pubkey` on
the client was checked: it is used to build the TBS and to configure the relay, and it is **never
compared against `targetHex`** — the pubkey the operator actually typed.

**What that costs.** A quorum of this agent's own directories names an impostor as the counterparty.
The assignment verifies *perfectly*, because it genuinely is signed by this agent's own group key.
The daemon opens its receiver to the impostor's peer id and dials them. This is exactly the bound
`outbound-sessions.ts:480-486` states in its own comment and points downstream to close.

**It IS caught — one step too late.** `#verifyAuthorshipClaim` compares the message signer against
`counterparty_pubkey`, which comes from the operator's own request and is untouched by anything the
directory returns, and freezes the session. That is the session-open MITM detection from the
2026-08-21 investigation and it works. But it fires on the **first message**. Between establishment
and the counterparty's first word, this agent has dialled a stranger, handed over its session node
and confirmed it is online. **A peer that never speaks is never detected at all.**

**⚠️ "It is caught at their first message" IS NOT THE MITIGATION IT SOUNDS LIKE — Andre, 2026-09-06.**
The dialer speaks first. Nothing in the send path gates a send on having verified an inbound message
(`session-content-handlers.ts` ~310-360: params, ownership, revive, cursor, size, screener — no
counterparty precondition). So the real order is: assignment names an impostor → we dial → **we send
our opening message** → they reply → *then* it freezes. The freeze protects us from being deceived by
their answer; it does nothing about what we already disclosed. The exposure is exactly one message,
and one message is usually the reason the call was made.

**And BROADCAST removes even that bound.** The detection fires on *their reply*. A broadcast is
send-first by design and expects no reply per recipient, so a substituted recipient who stays quiet
is never detected at all and keeps receiving everything. Today: one message, then a freeze. Under
broadcast: an open subscription. **This must land before broadcast is built, and it is the same
one-line fix either way.**

**Done when:** after `verifyAssignmentSignature` returns ok and before anything dials,
`assignment.participant_b.pubkey` is compared to the target the operator requested, and a mismatch
REFUSES with its own named reason and guidance. Both sides of that comparison are local values;
neither is influenced by the directory.

**Measured at the site, 2026-09-06 — it is four lines.** The verification at
`outbound-sessions.ts:487` sits inside `runSessionRequestOverSignaling`, which already takes
`targetHex` as a parameter. The directory sets `participant_a` = initiator and `participant_b` =
target (`directory-node.ts:4415-4416`), so the mapping is unambiguous. Nothing new is fetched, and
there is no wire change. **Add the companion check in the same place:** `participant_a.pubkey` must
be this agent's own — same cost, and it closes the mirror case where the assignment puts someone else
in our seat.

Work order: [[039-ASSIGNTARGET-the-slip-must-name-who-you-asked-for]].

### `DOD-M15-CEREMONY-BLIND-1` — 🟡 PRE-LAUNCH (lower value than it first appears) · The client contributes its FROST share to bytes it never inspects
**Filed 2026-09-06. Filed WITH the measurement that shrinks it, so nobody re-derives the wrong size.**

The daemon is not merely a participant in the ceremony — it is the **coordinator**. The directory's
`ClientDelegatedSigner` (`directory-node.ts:7114`) sends the TBS to the client over the signaling
stream; the client runs `participateInCeremony`, collects partial signatures from the directory
nodes, aggregates, and returns the finished signature. It signs and assembles its own session
assignment. `session-ceremony.ts:955-990` shows what it checks first: that a `ceremony_id`, a `tbs`
and a `context` are present. Nothing about their content. `context` is cast to `FrostContext`, used
for domain separation, and never compared against an allowlist.

`DOD-M15-SEALPARTIES-1` gave the **directory** nodes a second opinion that can see the evidence, on
the argument that signing opaque bytes is *"cryptographic weight without judgement"*. The same
argument applies here and was never applied.

**⚠️ WHAT THIS DOES NOT BUY, measured before filing.** Shareholders are the directory quorum **plus**
the client (`bootstrapKeyShares`: `{ min: threshold, max: participants + 1 }` — "+1 for the client"),
and the pre-ceremony check reads `reachableAtInitiation.length < threshold - 1`, *"because the client
itself is one of the threshold signers"*. With T = majority(N), **a colluding threshold of
directories can sign without the client at all.** Refusing to sign therefore does not close the
collusion bound — `DOD-M15-ASSIGN-TARGET-1` does, on the verify side, and that is the line to do
first.

**Done when:** the ceremony handler validates `context` against the known set and refuses an
unrecognised one by name; and, for a session-establishment TBS, refuses to contribute when the TBS
does not describe a session this daemon initiated. **Value is defence-in-depth**, not the headline —
it removes "the client helps sign whatever it is handed" as a step an attacker gets for free.

### `DOD-M15-KEYBIND-1` — ❌ PRE-LAUNCH · An agent's group key must be provably its own
**Filed 2026-09-06. The only open line in this milestone that gets more expensive after launch.**

> ### 🚨 HALF-SHIPPED, AND `main` CANNOT OPEN A SESSION AT ALL — found 2026-09-06 by the GODFILE lane
>
> **Nobody can start a conversation with anybody.** Every `cello_initiate_session` on `main` is
> refused before anything is dialled, with *"The directory returned a session assignment without the
> counterparty's key binding."* The responder refuses the mirror image. Nothing is sent and nothing
> is opened.
>
> **The flow:** A asks the directory to open a session with B → the directory returns the assignment
> → A's client now DEMANDS a signature proving B's threshold key belongs to B → the assignment
> carries no such field → A refuses and stops. B does the same in reverse.
>
> **Why:** the CONSUMER of the proof shipped and the PRODUCER did not. The client half is on
> `cello-client` main (`assignment-verify.ts`, `session-assignment-parser.ts`). Nothing in
> `trustless-cello/packages/directory/src` mentions `participant_a_key_binding` or
> `participant_b_key_binding` — the only commit in this repo (`e6838a28`) is this DoD entry and the
> work order. There is no code anywhere that emits the field the client requires.
>
> **⚠️ THE REFUSAL MESSAGE SENDS THE OPERATOR SOMEWHERE USELESS.** It tells them the counterparty
> *"needs to re-register"*. Re-registering cannot help: the field has no producer, so it will fail
> identically for every agent, on every node, forever. That guidance will cost somebody an
> afternoon before they think to check whether the directory emits it at all.
>
> **Evidence, not inference.** A clean checkout of `main` — with none of the god-file work in it —
> fails `J-SPINE` on exactly three tests (`DOD-SPINE-5`, `-6`, `-7`) with this reason. The unit
> suites stay green throughout: 4,999 tests pass while no two agents can talk. This is only visible
> from the live binary gate.
>
> **The decision is which half to move**, and it is not the refactor lane's to make: build the
> directory-side producer, or hold the client's requirement until it exists. Nothing was touched.

An agent holds **two** keypairs, and only one of them is published. `K_local` is an ordinary Ed25519
pair minted before registration — its public half is the 64-hex identity operators paste around. The
DKG then produces a **second** keypair: public half whole and identical for everyone, private half
that never exists anywhere and lives only as shares (`frost_signing_share`), stored as
`frost_primary_pubkey`. A session assignment is signed by the **caller's** group key and carries it
in `signer_pubkey`. **Nothing published binds a K_local to a group key.**

**What that costs.** On first contact `verifyInboundAssignment` is passed `expectedSignerHex = null`,
so `verifyAgainst = signer` — the signature is verified under the key the same document supplied. It
is circular by construction: it catches a tampered frame and establishes nothing about who signed.
That signer is then written to `sessions.counterparty_primary_pubkey` and becomes the permanent pin.
A wrong first contact is a wrong pin, and **every session after it verifies beautifully**. A bad pin
never surfaces again.

**The initiator is not exposed** — it verifies against its own group key, held locally
(`assignment_signer_not_this_agent`). The gap is one-directional: whoever receives a cold call.

**Same missing binding, opposite direction.** An initiator never learns the responder's group key, so
a responder-first seal is accepted `verified:false` / `signer_key_not_held`
(`session-ceremony.ts:851`, filed there as F2-b). One binding closes both — and doing them separately
is two wire changes instead of one.

**Done when:** at the tail of registration, once both keys exist on the machine at the same time,
`K_local` signs a binding over the group key; the binding is stored in the directory profile and
carried on the assignment; the responder verifies it against `participant_a.pubkey` **before**
verifying the assignment signature, and REFUSES by name when it is absent or does not verify. The
chain then terminates at the 64-hex the operator was given out of band, and the pin stops being
trust-on-first-use.

**Why pre-launch — on cost, not only severity.** This is a wire field plus a directory column. The
other two open findings from the same audit are client-side only (a local comparison; a set
membership) and cost the same to fix at any time. A mandatory assignment field added after agents
exist means a compatibility branch or a forced re-registration. The directories are being wiped
before launch and there are no users, so today it is free.
> *"Part of my intent of auditing everything was to try and find things that would cause lots of
> friction downstream if we had to change them after we have users. This is precisely an example of
> that."* — Andre, 2026-09-06

**No re-DKG is needed**, then or later: an agent already holds `K_local` and its own group key, so it
can produce the binding on demand. Key refresh deliberately preserves the group key
(`session-ceremony.ts:452` aborts if the primary changes), so the binding is signed once for the life
of the agent.

Work order: [[038-KEYBIND-a-group-key-nobody-can-place]].

### `DOD-M15-NOTIFY-AUDIT-1` — ❌ PRE-LAUNCH · Every check a USER can experience reaches them, and tells them what to do
**Filed 2026-09-06. Input is [[session-correctness-checks]], which has no consumer until this line exists.**

A session passes ~150 correctness checks. Several reason families are closed unions with a **total**
guidance map, so a new reason cannot ship without operator guidance — session refusals, salt freezes,
seal co-sign refusals, inclusion-proof failures. **That property covers the families where someone
did the work, not the system.** Plenty of checks emit a log event and nothing else.

**A guard nobody hears is the failure this milestone has already fixed four times.** The list is
built; nothing has been run against it.

**⚠️ THE BAR IS NOT "EVERY CHECK HAS GUIDANCE", AND ADOPTING THAT BAR WOULD MAKE THINGS WORSE.** Most
checks are internal — a caller checks, handles it, and no human ever needs a sentence. Forcing
guidance there produces filler nobody reads, which is exactly how the good pattern decays into noise
and buries the notices that matter. **The bar is: every check a user can EXPERIENCE.**

**Two scoping rules that make this finishable rather than open-ended.**

1. **Work the failure CLASSES, not the checks.** REFUSE / BLOCK / DEFER / FREEZE / LOST / OUTBOUND —
   a user meets each differently and needs a different thing said. A check with no user-visible
   class needs nothing and is out of scope by construction.
2. **Application layer only** — stages D through V. Stages X and L (substrate and link) fail as
   symptoms somewhere else; auditing them here reopens the whole map for no gain. The one exception
   already has a line of its own (`X1.1` — a resolver fault reads as every node being unreachable).

**Done when** every check carrying a user-visible failure class has a verdict recorded against three
questions — *is it logged? does it reach a surface the operator actually reads? does the text name
what they can DO?* — and the failures are a gap list. **Output is the gap list. Fixing the gaps is
separate work and separately ranked** — this line is the measurement, and running it is what turns
the map into an audit.

### `DOD-M15-TESTS-VERSION-1` — ❌ PRE-LAUNCH · No test asserts that an old wire shape is tolerated
**Filed 2026-09-06. Consumes the list `036-GODFILE` produces. Do not start it before 036 closes.**

`DOD-M15-BACKCOMPAT` is settled policy as of 2026-09-06: **this project is in alpha, there is no
installed base, and wire tolerance is the main target rather than an exception.** A v1 layout accepted
beside v2, an absent field read as *"a peer that predates it"*, a fallback for a build no longer
published — all of it goes, and every agent runs the current build.

**The tests are the other half of that, and they are the half that keeps the dead shape alive.** A
test asserting *"a v1 claim is accepted"* is a specification that v1 must keep working. Delete the
production tolerance and that test goes red; keep the test and someone puts the tolerance back to fix
it. **The test is what would reinstate the defect.**

**Why tolerance is worth removing at all, stated so this is not read as tidying:** tolerance is
exactly what makes a version skew SILENT. An older daemon reads a newer acknowledgement as the older
layout and drops the message without complaining. Remove it and the same skew is a loud refusal with
a name. This converts silent data loss into a visible error.

**⚠️ SEQUENCED AFTER 036, and the reason is 036's safety property.** That order's Rule B — *a test
that has to change is proof behaviour moved* — is the main thing standing between a 16,000-line
refactor and a silent break. A general test sweep running alongside it destroys that signal: once
tests are changing for intended reasons, a test that changed because something broke is no longer
distinguishable. 036 **records** what it finds and touches nothing; this line acts on the list.

**Done when** every test that asserts an old shape is tolerated is either updated to assert the
current shape, or deleted with the behaviour it described; the suite is green; and the close-out names
each one, because that list plus 036's deletion list is what says which agents must be redeployed.

**Out of scope:** general test-quality work. This is version pinning only.

# Explicitly Beyond — deferred WITH a trigger, never dropped

Nothing here is out of the project. Each carries the condition that brings it back.

- **`DOD-M15-HOLEPUNCH-1` — repair hole punching.** Root cause identified: `@libp2p/tcp` has no port
  reuse, so DCUtR dials from a fresh ephemeral port and the NAT mapping is at the wrong address —
  what libp2p calls a punch is a **timed direct dial**, which succeeds only when the target was
  already dialable. Never once observed succeeding in production. Three unevaluated routes: patch TCP
  port reuse, adopt QUIC, adopt WebRTC. **Not launch-blocking** (relay-audit §H) because the relay
  cannot read relayed content, so the confidentiality claim survives while every cross-NAT
  conversation is relayed. **Trigger:** a dedicated research spike, scheduled after M15. **The
  frequency claim must be corrected regardless** — material citing an 80–90% direct-connection rate
  describes a mechanism that has never worked (`DOD-M15-LEDGER-1`).
- **Threshold on the relay-facing assignment.** Decision 4(a) chose to leave it and required it be
  recorded as a bounded property, which `DOD-M15-DISCLOSE-1` does. The (b)-vs-(c) choice — T
  signatures versus a directory-consortium threshold key that does not exist — is deliberately not
  made now. **Trigger:** the cryptographic-sortition work, when directory-side threshold mechanics
  are already open.
- **Cryptographic sortition.** Decided yes (T-of-N log Decision 3); sequencing open. It is
  availability and scaling, not hardening — its original motivating case was session-open, which the
  blocking signer check now covers regardless of T or N. **Trigger:** directory count needing to grow
  past what `majority(N)` comfortably supports; expected within a month or two of user growth. **New
  T-of-N-dependent work should assume sortition will eventually replace `majority(N)`**, and a
  cutover mechanism is expected rather than a flag-day switch.
- **Backup MERGE** — restoring onto a device that has its own live state. `DOD-M15-BACKUP-1` ships
  export + overwrite-restore. **Trigger:** the first operator who needs to restore without losing
  local state.
- **Multi-device (one identity, two devices)** — `DOD-PRIMARY-1`, `DOD-POLICY-1`, `DOD-PORTAB-1`.
  The launch intent's "your own two agents across devices" is two *identities* on two devices, which
  works. **Trigger:** demand for one identity on two devices.
- **`CELLO-REPL-001`'s remaining readers.** Its security-critical reader is pulled into
  `DOD-M15-SAMEOP-1`; the other three, and the column drop, stay. **Ordering is in the story and
  binds:** move the readers, confirm on a converged fleet, then drop the columns in a **separate**
  release.
- **`DOD-FLOOR-1`** — the trust-signal floor is built, unit-tested, and deliberately called by
  nothing. Correct for launch: any default would start refusing counterparties with no signals, which
  is everybody on day one. **Trigger:** the first operator who wants to be selective.
- **`DOD-END-WITHDRAW-1`, `DOD-END-INGRESS-1`, `DOD-END-QUOTA-1`.** **Trigger:** endorsement volume
  appearing. Of the three, quota has the safety edge (unbounded issuance) and is first to revisit.
- **`DOD-ACCOUNTS-EMAIL-CHAIN-1`** and the append-only-table test-isolation defect — recorded in
  `DOD-M15-CHAINHEALTH-1`, repaired separately.

---

# Decisions Carried

Rulings that bind every line above. **Re-asking one is decision theatre** (M15-PROCEDURE §🎭).

1. **The gate is a state, and everything is inside it** (Andre, 2026-08-21). Launch waits for M15 to
   close. Tiers are dependency order only; nothing is descoped for time; an item's presence in this
   document *is* its launch-blocking status.
   **AMENDED 2026-08-23 (Andre) — for NEW findings only, and it does not touch a single existing
   line.** Presence in *the tiers* is launch-blocking status. A newly discovered item is classified
   when it is written down: **BLOCKS LAUNCH** (a prospective customer cannot get the core value, or
   loses trust) → the tiers; **POST-LAUNCH** (real, worth fixing, does not stop us shipping) → the
   POST-LAUNCH BACKLOG at the foot of this file, outside the gate. One line of reasoning at creation
   time. Unclear ⇒ blocks. **The reason for the amendment:** under the original rule, every defect
   either lane discovered became a launch blocker automatically, so the gate grew every time someone
   looked closely — which taxes looking closely, and looking closely is the whole milestone. This is
   explicitly NOT permission to investigate less.
2. **The seal wire change is in the gate**, on the migration argument rather than the security one —
   **and it pulls the content encryption in with it**, because the seal consumes the salt the key
   agreement produces and the seal items cannot be split.
3. **The unpublished investor and GTM material is not in M15.** Never made public, never sent;
   corrected after the milestone against what actually shipped.
8. **THE SESSION SALT: independently agreed, both sides contribute, persisted, one per session**
   (Andre, 2026-08-23 — supersedes #7 and corrects the "two outputs" half of #6).

   One exchange at session open agrees **two independent values**:
   - **the envelope key** — ephemeral, destroyed at close, exactly as `KEYAGREE-1` built it;
   - **the session salt** — agreed once, unchanged for the life of the session.

   Neither derived from the other, neither from the same secret.

   **BOTH SIDES CONTRIBUTE TO THE SALT AND TO THE ENVELOPE KEY. A requirement on both, decided, not
   open.** Each side sends a random contribution
   and the salt is derived from both in a fixed canonical order, so the two compute identical bytes.
   **Not initiator-minted:** the client is open source and a user can modify their own build, so a
   single minter can unilaterally destroy the property for BOTH parties — always send the same salt,
   or a low-entropy one — and every conversation that client has becomes guessable by any relay
   holding the hashes. The honest peer cannot detect it and never consented to it. Both-contribute
   means **one honest participant is enough**, and each side can verify its own contribution was used.
   Same principle as the sovereign-node rule: no single party can unilaterally break a guarantee.
   Refuse a peer contribution that is all-zero or the wrong length, exactly as the key agreement
   already refuses a degenerate peer key.
   **For the ENVELOPE KEY the requirement is already met, and this records HOW so nobody assumes it
   is met by accident.** X25519 ephemeral-ephemeral combines both sides' secrets: neither party can
   compute the result alone, and an honest party's fresh ephemeral keeps it unpredictable to any
   observer even if the peer reuses a fixed keypair. The one way a peer COULD have forced a
   degenerate shared value — a small-order point driving the secret to all zeros — is refused by
   `KEYAGREE-1`, loudly, per RFC 7748 §6.1. So the property holds and is enforced; it does not need a
   second mechanism bolted alongside. **If that refusal is ever removed, this requirement fails with
   it** — they are the same guarantee.

   **The rest of the salt rules:**
   - **PER SESSION, not per message.** A secret 32-byte salt already makes guessing infeasible;
     per-message would only hide which messages *within* a session are identical, which is marginal
     next to the count, timing, size and direction already visible. **Decided — do not re-raise.**
   - **Agreed at session open, BEFORE the first leaf is hashed.** Every leaf uses the same salt.
   - **PERSISTED in the session record.** On re-key after a restart: does this session already have a
     salt? Yes → use it. No → agree one. If it is not stored the lookup fails, a fresh salt is minted,
     and a restart silently splits the transcript — the exact defect being removed, triggered by a
     crash instead.
   - **NOT a key.** It decrypts nothing. Storing it forever costs and weakens nothing.
   - **Exchanged agent-to-agent**, where neither the relay nor any directory sees it. The relay cannot
     read agent content today, so this is an existing channel. It must NOT ride in anything a
     directory brokers.
   - **No epochs. No per-leaf salt attribution. One salt, one session.**

9. **HMAC-SHA-256, not SHA-256(salt ‖ message)** (Andre, 2026-08-23). The naive concatenation has a
   length-extension weakness; HMAC is the standard construction and the same shape to use.

10. **A SALT MISMATCH MUST BE LOUD** (Andre, 2026-08-23). This failure is the least debuggable shape
    there is — the send succeeds and the receiver discards silently (`wire-content-hash.ts`'s own
    header says so, and it cost two real daemons to find once already). So both sides compare a
    **fingerprint of the salt — never the salt** — at session start and refuse the session with a
    named reason if they differ. No silent discard loop because one side's salt did not survive a
    restart.

7. **~~The content salt is stored PER KEY EPOCH, not per session~~ — RETRACTED 2026-08-23.**

   **Superseded by Decision #8.** This was mine, and it was a correct answer to a question that
   should never have existed: epochs were needed only because the salt was derived from the ephemeral
   key, so re-keying moved the salt with it. Andre removed the coupling — the salt is now agreed
   independently and persists for the life of the session — so there are **no epochs, no per-leaf
   epoch attribution, and no lockstep switching**. Left visible rather than deleted, because a future
   reader who re-derives the coupling will re-derive this too, and the retraction is the warning.

   ~~Original text:~~ The content salt is stored per key epoch (mine, 2026-08-23, §3a — this is
   the open question raised under #6, ruled rather than left blocking. **Andre asked to be told:**
   this does not contradict anything he said; it answers the consequence he flagged.)

   #5 requires a revived session to RE-KEY, so its salt changes mid-session. One salt per session
   would verify only the leaves from the latest epoch and silently fail the rest of the transcript.

   **Why per-epoch is the least-reversing choice, and it is not close:** per-session is a strict
   SUBSET of per-epoch. A session that never re-keys has exactly one epoch and therefore one row, so
   per-epoch storage costs nothing in the common case. The reverse is not true: per-session cannot
   represent two salts at all, so the first re-key needs a schema migration on an operator's machine
   — the one kind of change this milestone treats as unrecoverable when it goes wrong.

   **What it obliges `SEALWIRE-1` to carry:** an epoch identifier on each leaf (or a range per
   epoch), so a verifier can tell which salt applies to which leaf. And per #6's third consumer —
   the receive-path authenticity check — the two sides must agree on the CURRENT epoch in lockstep,
   or every inbound frame fails `content_hash_mismatch`, which `wire-content-hash.ts` calls the
   least debuggable failure shape there is.

   **REDO > BLOCK:** if this is wrong the cost is dropping an unused column. If per-session were
   wrong the cost is a client-side migration.

6. **THE TWO KEY-AGREEMENT OUTPUTS HAVE DIFFERENT LIFETIMES** (Andre, 2026-08-23 — stated before
   `SEALWIRE-1` encodes anything, because after that it is a wire change).

   **Intent, restated so it cannot drift again: this layer is WIRE ENCRYPTION ONLY.** Anything
   travelling between two agents is unreadable to the relay or an interceptor, and CELLO can upgrade
   that to quantum-resistant on its own timeline rather than libp2p's. That is the entire goal.
   Once a message lands on the device it is decrypted for the model to read, and from then on it is
   **SQLCipher's** job.

   - **The message key NEVER touches disk**, and is destroyed at session close. That is the forward
     secrecy.
   - **The content salt IS a durable record field** — stored like any other column. It is not a key:
     it decrypts nothing, and HKDF is one-way, so possession of it does not lead back to the shared
     secret or to the message key. Storing it does not weaken forward secrecy.
   - **NO CELLO-level encryption of anything at rest in the local database.** SQLCipher is the
     at-rest layer, full stop. A second application layer buys nothing: anyone with full device
     access has the database key too, because it must be on the device for anything to work. The
     real answer is keys in the secure enclave, which needs a native app that does not exist yet.

   **Verified against the code before recording, per Andre's instruction.** The salt is genuinely
   needed downstream, and by MORE consumers than the two named:
   1. **Transcript verification.** `recordTranscriptMessage` stores plaintext; the leaf stores the
      content hash. Verifying "my transcript is what was sealed" means recomputing the hash from the
      plaintext. Today `wireContentHash` is `SHA-256(0x00 ‖ content)` — derivable from plaintext
      alone. Salted, it is underivable without the salt, and the transcript stops being
      self-verifiable.
   2. **Inclusion proofs — with a refinement.** The salt is NOT needed to build or check the proof
      itself: the leaf hash IS the stored content hash, and the proof is hashes and indices. It is
      needed for the proof to be *about a message* rather than about an opaque hash — binding
      plaintext to the leaf requires recomputing the hash.
   3. **The RECEIVE-PATH AUTHENTICITY CHECK** — the consumer nobody listed. The receiver recomputes
      the content hash on every inbound frame and rejects a mismatch (`content_hash_mismatch`).
      Salted, the receiver needs the salt for ordinary message delivery, not just for later
      verification.

   **⚠️ CONSEQUENCE THAT NEEDS ANDRE'S CALL, and it follows from Decision #5 rather than from this
   one:** if a revived session RE-KEYS, the salt changes mid-session. Leaves before the re-key are
   hashed under salt A and after under salt B, so **one salt column per session is not enough** —
   the transcript would verify for half its length. The salt has to be stored per KEY EPOCH with each
   leaf attributable to an epoch. Consumer 3 makes it sharper: both sides must switch salts in
   lockstep or every message fails the authenticity check, which `wire-content-hash.ts`'s own header
   calls "the least debuggable shape there is". **Not decided here.**

5. **Session ephemerals are NOT persisted; a revived session RE-KEYS** (mine, 2026-08-23, §3a
   — surfaced by `KEYAGREE-1` review F5. **Flagged for Andre**: it changes session revival, not just a
   crypto choice.)

   CELLO sessions survive daemon restarts, so the key agreement forces a fork the DoD line never
   named: persist the ephemeral secret so a restarted daemon can still read its own session, or do
   not, and make a restart leave that session's content unreadable.

   **Persisting is the irreversible harm.** It voids forward secrecy — the entire point of the unit —
   and puts key material in `sessions.db`, and therefore in every backup, for the life of the
   session. That does not remove harvest-now-decrypt-later; it moves it from the wire to the disk,
   where collecting it is easier. Once written to a backup it cannot be unwritten.

   **Re-keying is additive** and can be built when revival needs it
   (`DOD-M15-EPHEMERAL-REVIVAL-1`). REDO > BLOCK: if this ruling is wrong the cost is building the
   persistence path later; if persistence were wrong the cost is every key ever written.

4. **`DOD-M15-CLOSEWAIT-1`'s close contract: ANSWER ON COMMITMENT, NOT ON NOTARIZATION** (mine,
   2026-08-23, §3a — the line says *"decide the contract, then build"*, so here it is decided).

   `cello_close_session` returns as soon as the SEAL leaf is durably submitted, naming what happens
   next. The bilateral wait and the unilateral escalation continue in the background; the receipt is
   collected with `cello_get_sealed_receipt`.

   **Why this and not "keep blocking":** the blocking version cost real receipts. An operator watched
   a frozen command for 11m 06s, concluded it was broken, and force-abandoned **seventeen sessions**
   — forfeiting the exact notarized receipt the wait was earning. A UX failure destroying the core
   artifact is the definition of unforgivable at launch.

   **Why this is the least-reversing option — both safety nets already exist**, which is what makes
   it cheap rather than a rebuild:
   - `cello_get_sealed_receipt` is already a registered handler returning the same certificate.
   - a daemon that dies during the background wait finishes on its next start rather than orphaning
     the session. **CORRECTED 2026-08-23 after review:** this first credited `RestartSealResolver`'s
     `seal_interrupted_pending` branch. During the background wait the row is still `active`, so that
     branch never sees it. What covers it is the boot sweep flipping `active → interrupted,
     interrupted_by='local'`, which IS a branch the resolver walks — subject to `message_count > 0`
     and `restart_seal_gave_up_at IS NULL`. **The safety net is real; the mechanism named here was
     not, and this is the document a later session would have trusted without re-checking.**

   **What does NOT change:** the same inline escalation still produces the receipt, in the same
   order, from the same leaf. Only the IPC response stops waiting for it. Nothing about what is
   signed, by whom, or when is altered — that is deliberately outside a UX fix.

   **The counterbalance, named before the code:** answering early must not let an operator believe
   the session is sealed when it is only committed. The response says *committed, not yet notarized*,
   names the verb that fetches the receipt, and the session's own status must continue to read as
   sealing until it is not.
4. **Certified root moves to the content-hash domain** (relay-audit Decision 1(a)) — not
   `seal_attempt`, not a parallel reported root.
5. **The listening socket stays, gated on the assignment** (Decision 2). Removing it buys nothing on
   NAT traversal since punching cannot fire either way, and it is load-bearing for same-machine and
   same-LAN sessions.
6. **The relay verifies a presented credential; it does not query the directory** (Decision 3(b)).
   Preserves extractability and adds no per-request latency.
7. **Per-session ephemeral key agreement with a PQ hook, never static-static** (Decision 5(b)).
   Static-static would void forward secrecy the transport already provides.
8. **The sender's signature is stored per leaf** (Decision 6(b)) — a schema change is cheapest now
   and never gets cheaper.
9. **Relay corroboration is proactive** (T-of-N Decision 4) — it must not depend on a possibly-
   compromised client choosing to ask.
10. **Unilateral absence is hybrid and tiered** (T-of-N Decisions 1 and 2): 600s standard unchanged;
    high-stakes opt-in at 3600s with evidenced absence mandatory.
11. **`T = majority(N)` stands until sortition replaces it.** Do not propose all-N. Do not re-raise
    the threshold as an open question.
12. **A recommendation that survives only on backward-compatibility grounds is not a
    recommendation** — re-derive against an empty database. This reversed two first-pass
    recommendations in the spec-of-record and it will try to reverse more.
13. **The relay-linkability mitigation is WITHDRAWN, not relied on** (§3a ruling, Entry 1). Decision
    7 accepted the long-lived per-agent handle because spreading reservations across relays would
    erode it; measurement shows one relay carries 99% of an agent's reservations, so that basis does
    not hold. `DOD-M15-MULTIRELAY-1` is availability only, and the property is disclosed in
    `DOD-M15-DISCLOSE-1`. Making selection genuinely spread remains worth doing — as an improvement,
    never as the thing a claim rests on.
14. **The interrupted-seal proof runs against EXISTING agents** (Andre, 2026-08-21) — no pre-auth
    tokens, no throwaway registrations. Manage the side effect by choosing agents with no open
    sessions, verified before the run.

15. **A SALTED SENDER FALLS BACK TO UNSALTED AGAINST AN OLDER PEER — loudly, per message, never
    refusing the session** (§3a ruling, mine, 2026-08-23).

    I had been carrying this as Andre's call. It fails the decision-theatre test: **the record has
    already ruled it twice**, so presenting it as an open question was theatre, not deference.

    - `SEALWIRE-1`'s own version-discriminator AC says *"`content_salt IS NULL → unsalted` is a
      **legacy branch** and must announce itself."* A legacy branch that announces itself is a
      fallback with a voice. It is not a refusal.
    - The launch-triage lens settles the rest. The fundamental value is *two agents connect and
      communicate — including when you control only one of them.* Refusing on version skew breaks
      exactly that, for the exact population least able to fix it: the counterparty is someone else's
      agent, on someone else's upgrade schedule.

    **This is NOT the silent fallback the milestone exists to remove, and the distinction is the
    whole ruling.** A silent fallback is one where a missing thing is quietly substituted and the
    system looks healthy. This one is: an explicit `content_hash_alg` on the wire that the receiver
    reads and verifies under; a WARN naming the peer and saying the relay can confirm guesses at
    short messages in this session; and the session record marking itself unsalted so a transcript
    can never claim a protection it did not have. The operator is told; nothing is hidden.

    **What is refused, and this stays refused:** an *unknown* algorithm value. A peer naming
    something we cannot verify under is not a legacy peer, it is an unreadable one, and there is no
    correct way to hash for it. Absent → legacy; named-and-known → verify; named-and-unknown → refuse.

    **Least likely to need reversing**, which is the §3a test: the fallback is deletable the day the
    old builds are gone, and deleting it strands nobody. Refusing would strand real conversations
    from the day it ships, and the migration trap says a launch-time refusal is the expensive
    direction to reverse.

---

16. **DOCUMENTS ARE OUTSIDE THE LAUNCH GATE** (Andre, 2026-08-24). *"Documents have been moving out
    of the gate. Documents were never intended to be a launch feature. Somehow they made it in there
    by accident. They're outside of the gate of launch. Done."*

    **Every document-specific defect leaves the gate**, whatever its severity, and no document
    finding is a launch blocker. This retires three things that were being carried as blocking or as
    open decisions for Andre:
    - the document salt outage (a document session never agrees a salt, so one side's updates are
      silently refused) — **no longer needs the design decision that was filed for him**;
    - `DOD-M15-DOCACCEPT-UNBOUNDED-1` (accepting an invitation hangs when a holder is offline) — the
      bound no longer needs picking for launch;
    - the document journey failures in the evidence lane.

    **What this does NOT move:** the semantic screener (`DOD-M15-SCREENINSTALL-1`). Injection defense
    is named in the launch intent in its own right; only its two document-specific sub-bullets follow
    documents out.

    **Consequence worth stating, because it changes a status rather than just a scope:** strip
    documents out of `DOD-M15-SPINERED-1` and its remaining in-gate failure is `j-suspend-tofn`
    **alone** — the kill switch.

# Claims Ledger

*Built by `DOD-M15-LEDGER-1`. Rows are added as surfaces are swept; a claim with no row is an
unaudited claim.*

## Swept 2026-08-21 — `AUDIT-ME.md`, root of the PUBLIC `Mygentic-AI/cello-client` repo

**Five rows, ranked by what a hostile reader finds first.** Every one was measured by running the
document's own instructions against the tree — which is exactly what its name invites. → Entry 3.

| # | Claim, as written | Verdict | Disposition |
|---|---|---|---|
| 1 | Claim 3: *"outbound network connections **only** to the directory node … and to relay nodes … no telemetry endpoints … **or any other outbound HTTP calls**"* | **FALSE** | **withdrawn + rewritten with disclosure** |
| 2 | Claim 1: *"Message content is **additionally encrypted at the application layer** (AES-GCM envelope)"* | **FALSE as scoped** | **withdrawn + corrected** |
| 3 | Header: *"**All paths listed are valid** — packages were extracted … by REPOSPLIT-002"* | **FALSE** | **made true** |
| 4 | Verification cmd 1: `grep -r "plaintext" core/transport/src/  # should find nothing` | **wrong command, right code** | **made true** |
| 5 | Scope: the document audits network behaviour and never mentions `core/daemon/` | **structural gap** | **made true** |

**Row 1 is the one that matters and it is the worst artifact in the milestone.** The daemon makes
outbound HTTPS calls to **`https://api.telegram.org`** — `getUpdates` and `sendMessage` in
`core/daemon/src/telegram-bot-client.ts:27,42`. That is the doorbell feature: deliberate,
operator-configured, and the thing that reaches a phone. **Nothing about it is wrong except that a
public document says it does not happen.** And the document's *own* command 4 finds it —
`grep -rln "fetch(\|http\.request\|https\.request" core/*/src/` returns that file and only that
file. An evaluator following the instructions in a file called AUDIT-ME reaches a false claim in
about ten seconds.

**Write the replacement forward-safe.** `core/gateway/src/detect/deberta-model-manifest.ts:16`
carries `https://huggingface.co/…` as the classifier's download base. It has no production caller
today (`DOD-M15-SCREENINSTALL-1`), so it is not currently a destination — but it becomes one the
moment that line ships, and a claim that has to be rewritten again then is a claim written wrong now.

**Row 2** is the miscited-evidence case. Live content is plaintext inside libp2p's Noise session;
only *parked* content carries an application-layer AES-GCM envelope. The document cites
`core/client/src/client-backup.ts` — the **database backup** file — as evidence for *message*
encryption, which is a different thing entirely, and that path does not exist either.

**Row 3, measured:** four of the eight cited paths are gone —
`core/adapter-claude-code/src/server.ts`, `core/client/src/client-backup.ts`,
`core/client/src/client.ts`, `core/protocol-types/src/envelope.ts`. **`core/client/` does not exist
at all**; the surviving four are `core/crypto/src/ed25519.ts`, `core/transport/src/node.ts`,
`core/transport/src/types.ts`, `package.json`. The document asserts its own correctness in its
opening paragraph and is wrong.

**Row 4:** the command returns 5 hits — all of them comments and tests *asserting that plaintext is
absent* (`// Noise ONLY — no plaintext. SI-001.`). **The code is right and the instruction is
wrong**, which is the whole shape of this document: true claims, proved badly. Rewrite the command
so a correct tree produces the result the document predicts.

**Checked and NOT a finding**, recorded so it is not re-raised: `code.claude.com` and
`hermes-agent.nousresearch.com` appear only in a doc comment and an install-hint error string, not
as outbound calls; `docs.cello.dev` — which would breach the one-domain rule — appears only inside
an illustrative comment in a test file, and nothing ships it.

---

## Swept 2026-08-21 — `README.md`, same public repo

| # | Claim, as written | Verdict | Disposition |
|---|---|---|---|
| 6 | Headline ¶1: *"each conversation produces a tamper-evident, bilaterally-sealed audit trail that **both parties can independently verify**"* | **FALSE today** | **made true** by `DOD-M15-SEALWIRE-1` |
| 7 | Headline ¶1: *"relayed as encrypted blobs the relay cannot read"* | **TRUE** | verified, no action |
| 8 | *"A session name is **private to you** — never sent to the counterparty, the relay, or the directory"* | **TRUE** | verified, no action |
| 9 | *"`standing_receiver_ready` on its own is true even for a receiver no relay would grant a circuit reservation to — behind NAT, that agent is dialable by nobody"* | **TRUE** | verified, no action |

**Row 6 is the first paragraph of a public repository**, and it names the one property the relay
audit found nobody holds: **the receipt is not bound to the transcript.** A party can verify the
directory signed *a* root; it cannot verify that root is *its conversation*, because the client
takes the sealed root off the wire, checks the signature, stores it, and discards the root it
computed one step earlier. "Independently verify" is exactly the word that does not survive.

**Scope discipline, carried from the audit and not to be inflated:** no working attack against the
seal was demonstrated. The statable property is that the receipt is not bound to the transcript and
nothing would say so if the two diverged. The row is a claim defect, not an exploit.

**Disposition is made-true rather than withdrawn** because `DOD-M15-SEALWIRE-1` is inside the gate
and makes the sentence true. It must not ship before that line lands — a claim that becomes true is
still false until it does.

> **⚠️ RE-READ ROW 6 BEFORE CLOSING IT — "tamper-evident" has a SECOND reading this disposition does
> not cover** (added 2026-09-03, Order 021). Applied to the CONVERSATION's own signed, chained
> transcript, "tamper-evident" is true and `SEALWIRE-1` finishes the job. Applied to the DIRECTORY's
> permanent log — *"we can prove your conversation is in the record and the record was not
> rewritten"* — it is **false and `SEALWIRE-1` does not touch it**: the periodic checkpoint an
> inclusion proof resolves against is written by one node with zero signatures
> (`DOD-M15-CHECKPOINT-COUNTERSIGN-1`, OPEN, post-launch).
>
> The sentence as written is about the conversation, so this is not a new finding against Row 6. It
> is a warning that the neighbouring sentence — anywhere in the swept surfaces — may be the log
> claim, and it would inherit this row's disposition by resemblance. Decide which reading each
> sentence asserts before dispositioning it.

**Rows 7–9 were checked, not assumed**, and all three hold. Row 8 verified structurally:
`session_name` appears in **no** wire type in `core/protocol-types/src`. Recorded so a later sweep
does not re-open them.

---

## Swept 2026-08-21 — shipped skill prose and MCP tool descriptions

**These ship inside the npm package to every operator, and they carry the product's strongest
safety claim in its most unqualified form.** All four say screening is ACTIVE, without distinguishing
the character-denylist layer (live) from the semantic layer (not installable anywhere).

| # | Claim, as written | Where | Disposition |
|---|---|---|---|
| 10 | *"Content screening **is active**, in both directions. Inbound messages are screened before they reach any reader"* | `plugins/cello/skills/setup/SKILL.md:150` | **withdrawn**, then made true |
| 11 | *"content screening is the boundary, and it is **ACTIVE** in both directions at every tier"* | `plugins/cello/skills/cello/SKILL.md:205` | **withdrawn**, then made true |
| 12 | *"It does NOT change content screening, which is **ACTIVE at every tier** … a higher tier never buys less screening"* | `cello-mcp.ts:230` — a shipped **tool description** | **withdrawn**, then made true |
| 13 | *"CONTENT screening (prompt-injection defense) **IS live** as of DOD-M9B-WIRE-1"* | `cello-mcp.ts:190` — source comment, public repo | **rewritten** (`DOD-M15-CLAIM-COMMENTS-1`) |

**Why these are false rather than merely imprecise.** Two independent findings undercut them:

1. **The semantic half cannot be installed on any operator's machine.** `installModel` has no
   production caller — no command, no dependency, not even optional — so the layer that judges what
   a message *means* reports OFF forever (`DOD-M15-SCREENINSTALL-1`). What is live is the character
   denylist, which exists for the crude cases. **Partially true is false**, and none of these four
   surfaces makes the distinction.
2. **Even the live half is bypassable on the direct path.** The relay audit's Finding 1 lands
   injected content *below the layer where all screening lives* — blocked contacts, per-sender caps
   and trust tiers all sit on the signalling channel and that path never touches them. So row 12's
   *"ACTIVE at every tier"* is doubly wrong: a stranger who never appears as a contact at any tier
   reaches the reader anyway, until `DOD-M15-FRAME-1` lands.

**Recorded because it is the mechanism, not the blame:** `setup/SKILL.md:156` documents its own
upgrade — *"This paragraph previously said screening was 'planned, not yet active'. That was true
when the paragraph was written."* The claim was deliberately strengthened when the denylist landed,
and the semantic half never arrived behind it. **That is how a claim outruns its code**, and it is
the argument for the ledger existing at all: the moment a protection partially lands is the moment
its claim needs a scope, not a promotion.

**Sequencing:** withdraw now (add the scope), make true when `DOD-M15-SCREENINSTALL-1` and
`DOD-M15-FRAME-1` both land. Withdrawal is not optional pending the fix — these are read today.

---

### Checked and NOT claims-ledger rows

- **The document content profile is advertised nowhere.** `content_profile` / `assurance_tier`
  appear in no shipped skill prose and no tool description. So `DOD-M15-DOCPROFILE-1` is a **feature
  gap only** — a setting that enforces nothing — and needs no claim withdrawn alongside it. Recorded
  because the reverse was assumed when the line was written.
- **The `documents` and `receptionist` skills and the receptionist agent** carry operational
  descriptions, not security guarantees. The two injection-adjacent lines (*"cannot wake you by
  claiming a field is urgent"*, *"the right response, never obeying them"*) are instructions to the
  reading agent about handling peer content, which is correct advice and not a system claim.

## Swept 2026-08-22 — CLI help and product status output

**Clean. No security claims on either**, recorded as a negative so the next sweep does not re-walk
them.

- **CLI help / command text** (`core/cli/src`) is operational description only. The claim-shaped
  words grep finds — *never*, *cannot*, *impossible* — are all in **source comments about
  implementation discipline** (`json-out.ts`'s *"never synthesize an `ok:true`"*, `cli-args.ts`'s
  argument-parsing rules). Instructions to maintainers, not assertions to a user, and accurate.
- **Product status output** (`cello status` / `cello_status`) reports state and names next actions.
  None of its guidance asserts a security guarantee.

> ### 🔴 THIS SENTENCE WAS WRONG AND IS THE REVIEW'S BLOCKING FINDING (2026-08-22 → Entry 14)
> **The sweep was NOT complete.** Three of four surfaces had unaudited claims, including two the
> section below declares clean. Missed: the CLI's *"tamper-proof"* and *"it would no longer match"*
> (`registry.ts:538,868`); **`core/adapter-claude-code/SKILL.md`, the file that ships in the npm
> tarball**, never walked; the README asserting screening is NOT active, false the other way; and the
> **public GitHub repo description** advertising four native adapters that do not exist.
>
> **Why**: completeness rested on a three-word grep — *never / cannot / impossible* — and none of
> *tamper-proof, ACTIVE, screened, encrypted, verifiable, notarized, proof* was in it. **A prose
> ledger is a chore that looks like a control.** The fix is `DOD-M15-CLAIM-SCANNER-1` below.

**Four live surfaces walked (INCOMPLETELY — see above):** the public repo (root docs, README,
comments), the shipped package (tool descriptions, skill prose, CLI help), product status output,
and shipped client documentation.

**The dispositions are assigned here; ACTING on them is other lines' work** —
`DOD-M15-AUDITME-1`, `DOD-M15-CLAIM-SCREEN-1`, `DOD-M15-CLAIM-COMMENTS-1`, `DOD-M15-DISCLOSE-1`,
and, for the made-true rows, the units that make them true.

**Seed rows, from the two investigations — not yet individually verified against the tree:**

| Claim | Where | Disposition |
|---|---|---|
| "content is additionally encrypted at the application layer" | `AUDIT-ME.md` (public repo root) | **withdrawn** — true only for parked content |
| four of seven cited file paths | `AUDIT-ME.md` | **made true** — paths resolve post-repo-split |
| inbound screening is active | status output, tool descriptions | **withdrawn**, then **made true** by `DOD-M15-SCREENINSTALL-1` |
| the document content profile protects you | tool description, skill prose | **made true** by `DOD-M15-DOCPROFILE-1` |
| "80–90% of connections are direct" | outward-facing material (not in M15) | **withdrawn** — describes a mechanism that has never worked |
| "no persistent endpoint to DDoS" | outward-facing material (not in M15) | **withdrawn** — structurally false; a gate is not a flood defense |
| relay assignment requires a threshold | trust-model prose | **disclosed as bounded** — one node signs it; reach stated in `DOD-M15-DISCLOSE-1` |
| a direct session is private to the two parties | shipped docs (absent) | **disclosed** — it reveals the operator's IP permanently |
| an agent's sessions are unlinkable across time | design record / Decision 7 | **disclosed as bounded** — one relay carries 99% of an agent's reservations and can correlate them (Entry 1) |

---

## Related Documents

- [[M15-PROCEDURE]] — the runbook; §0z the gate, §2b the four invariants, §1c the three enforcers
- [[M15-BUILD-JOURNAL]] — audit trail and evidence home
- [[2026-08-21_1906_relay-p2p-exposure-and-ephemeral-peer-id-audit]] — spec-of-record for Tiers 0, 2,
  4 and 5; seven ruled Design Decisions and the 39-item → 18-unit map
- [[2026-08-21_1135_tofn-decoupling-and-seal-integrity-gaps]] — spec-of-record for the seal-ceremony
  and unilateral lines; four ruled decisions
- [[launch-triage]] — source for Tier 3; read its header warning before trusting any status marker
- [[M12B-DEFINITION-OF-DONE]] — the work order inside `DOD-M15-SUBMIT-ID-1`
- [[end-to-end-flow]] — the canonical narrative every seal change reconciles against

---

# POST-LAUNCH BACKLOG

### `DOD-M15-STARTUPFLUSH-1` — ❌ OPEN · 🅿️ POST-LAUNCH. A sender that crashed with an un-acked message does not re-park it on restart
> **RULED BY ANDRE 2026-09-05: POST-LAUNCH.** Surfaced by `030-RELAYSILENT` *Newly discovered* #1,
> where it was recorded as "BLOCKS if it reproduces" pending his call. It reproduces; the ruling is
> POST-LAUNCH.

**Found 2026-09-05 by `030-RELAYSILENT`, and it is NOT the defect that unit fixed.** It fails
identically with the relay's inbound connection threshold raised, so the connection budget is not the
cause. It has been failing every run.

**What happens to you:** you send a message to someone whose agent is offline. Your own daemon dies
before the relay confirms it — you quit it, the machine sleeps, it crashes. On restart your daemon is
supposed to notice the un-confirmed message and put it back in the recipient's relay mailbox. It does
not. The message is still in your local database, so nothing is lost from your transcript, and you
have no way to know the other side will never receive it. From their chair the conversation simply
has a gap in it.

**The evidence, verbatim** — `j-content.spine.test.ts`, `DOD-MSG-2 (startup-flush park)`:

```
[daemon-flushA-restart] timed out after 20000ms waiting for
  /"event":"content\.park\.deposited"[^\n]*"source":"startup_flush"/
```

The restarted daemon never emits the startup-flush deposit at all, so the question is whether
`flushAwaitingContent` runs, whether it finds the row, or whether it runs before the owning agent's
standing receiver exists. **Not investigated** — `030` was already over §0z.2's trip-wire when this
was found, and the reviewer's note stands: what was proven is *"raising the relay's threshold does not
fix it"*, which is narrower than *"it is not that defect."*

**Why POST-LAUNCH and not the gate (the launch-triage test):**
- **It needs a crash in a specific window** — after a send, before the relay's confirmation, to an
  offline recipient. The ordinary offline path does not touch it; that one is `DOD-M15-PARKCONN-1`
  and it is closed.
- **Nothing is lost or corrupted.** The content stays in the sender's own database and the transcript
  is intact. This is a delivery backstop that does not fire, not data loss — and there are four other
  triggers that re-drive a park (boot, agent start, the drain hook, signaling reconnect).
- **A prospective customer forgives it.** They can send the message again. What they cannot forgive
  is the core journey being a coin flip, and that is what shipped.

**⚠️ The honest counterweight, recorded because it is the argument for pulling this forward:** this is
the crash backstop for exactly the parked mail `DOD-M15-PARKCONN-1` is about, and that line was
flipped ✅ over it. If a real operator ever reports a message that never arrived after a restart, this
is the first thing to look at, and its classification should be revisited rather than re-derived.


### `DOD-M15-RELAYLEAF-SESSION-BIND-1` — ❌ OPEN · 🅿️ POST-LAUNCH. A relay-delivered leaf sets a position without checking which conversation it belongs to
> **RULED BY ANDRE 2026-09-05: POST-LAUNCH.** He had the list of four items 029-AUTHORSHIP produced
> and said *"fix all but the one that needs a hostile relay."* Items 1, 2 and 3 shipped (`029b`,
> `029c`); this is the one excluded, and it is deferred rather than dropped.

**Found 2026-09-05 by the `029b` review, while binding the authorship claim to its session.**

**What happens to you:** a relay you are routed through — or one that has been taken over — sends
your daemon a leaf belonging to a *different* conversation, and your daemon files the position it
carries against *this* one. Your transcript can then order a message wrongly. It cannot forge who
wrote anything: authorship is proven separately, by the sender's own signature over their own bytes,
and `029b` binds that claim to the conversation. What is corruptible here is only WHERE a message
sits.

**Why it survived `029b`.** That unit established "read the signed `session_id` and compare it"
everywhere the receive path checks a claim. `session-node-manager.ts`'s relay leaf handler decodes a
counterparty Structure 1 and calls `recordWitnessedSequence` on it **without** that comparison — the
one place the new read did not reach. Pre-existing, not introduced.

**Why POST-LAUNCH and not the gate:**
- **It needs a hostile or confused relay.** Every other item in the 029 family is reachable by an
  ordinary counterparty or by a version skew; this one is not reachable by either.
- **What it corrupts is soft by design.** Position falls back to the witness stream, and the relay
  is already the ordering authority — a relay that lies about ordering is inside its own remit. The
  seal's integrity does not rest on it: the certified root covers content hashes, and every leaf
  carries the sender's signature.
- **The fix is the same three lines `029b` already wrote**, applied at one more call site, so
  nothing about deferring it makes it more expensive later.

**Trigger:** do it with the next unit that touches the relay leaf handler, or the moment relay
abuse controls make a misbehaving relay a modelled adversary rather than a trusted intermediary —
whichever comes first. **Not closed by anything in M15.**

**Where:** `cello-client/core/daemon/src/session-node-manager.ts`, the relay leaf handler's
`decodeStructure1` → `recordWitnessedSequence` path. Compare `s1.fields.sessionId` against the
session's own bytes exactly as `#verifyAuthorshipClaim` does.


### `DOD-M15-CHECKPOINT-COUNTERSIGN-1` — ❌ OPEN · 🅿️ POST-LAUNCH. The LOG ANCHOR is unsigned (the receipt itself is fine)
> **RULED BY ANDRE 2026-09-03: SHIP IT, FIX AFTER LAUNCH. This requirement stays OPEN — it is
> deferred, not dropped, and it is not closed by anything in M15.**
>
> **The question he stopped on, and the answer that decided it:** *"If we do this later, do I hit a
> breaking change — people redo their agents, or lose the ability to prove previous conversations?"*
> **No.** Verified before the ruling, not assumed:
> - **What a client holds is the seal certificate**, and its fields are `session_id`, `seal_type`,
>   `leaf_count`, `signer_pubkey`, `legibility` — **no checkpoint reference at all.** It is FROST
>   signed over the transcript root and leaf count, so nothing done to checkpoints can invalidate it.
> - **Inclusion proofs are computed LIVE on demand**, joining the leaf to its checkpoint at request
>   time. No client holds a proof that must keep verifying.
> - **Everything the fix touches is directory-side:** an env var, MMR tables joining replication, and
>   `checkpoint_node_signatures`, which **already exists** (V18). The directory↔directory AE channel
>   is not a client-facing wire. **No client DB change, no wire-contract change, no forced upgrade.**
>
> **Two caveats recorded so the next person does not rediscover them:** the rebuild needs a shared
> leaf order and will likely renumber MMR positions, so an inclusion proof someone SAVED TO A FILE
> stops verifying (re-fetch fixes it; the certificate is the durable artifact). And making clients
> CHECK the checkpoint signatures is a later client-side addition — additive and opt-in, since an old
> client ignores a field it does not read.

**Found 2026-09-03 (Order 021), while closing `DOD-M15-HEARTBEAT-1`. POST-LAUNCH under §0z.4.**

> **⚠️ FIRST WORDING OF THIS ENTRY WAS WRONG, and the error is worth keeping.** It said *"a sealed
> receipt is countersigned by one node, not several."* **False.** The SEAL CERTIFICATE is FROST
> threshold-signed with the initiator's group key, whose shares live on the directory nodes, and
> `seal-cosign-evidence.ts` makes each co-signer rebuild the certified root and leaf count from the
> raw signed leaves and refuse its share if they do not match. No single directory can produce a
> valid seal certificate alone. The closing ceremony is real and it does what it claims.
>
> **The confusion was between two different artifacts**, and anyone reading this later will make it
> too, so: the SEAL CERTIFICATE (per conversation, at close, FROST T-of-N, each node re-derives the
> root) is sound. The CHECKPOINT (periodic, over the whole log, "my log holds N conversations and its
> top hash is X") is what this entry is about, and it is written by one node with no signatures.

**What it costs the operator, stated correctly:** your receipt is genuine and independently
verifiable — that part holds. What is weak is the later question *"prove my conversation is in your
permanent record and that record was not rewritten."* That is answered by an INCLUSION PROOF, which
resolves against a checkpoint, and the checkpoint is published on one node's say-so. A directory
could in principle re-issue a checkpoint over a different set of conversations; the seal certificates
would all still verify, because they are signed independently of the log they sit in.

**Why post-launch:** the customer gets a working, threshold-signed, verifiable receipt on day one.
The gap is in the tamper-evidence of the LOG, not the receipt.

**The copy check is NOT a separate task and must not become one** — it belongs to
`DOD-M15-LEDGER-1`, which already sweeps all four live surfaces, and to `DOD-M15-AUDITME-1` for
`AUDIT-ME.md`. The receipt/log distinction this entry turns on is written into LEDGER-1's bullets and
beside Claims Ledger Row 6. Do not add a third line for it.

**Measured while closing Order 021:** `directory_checkpoints` has TWO writers. The federated one in
`checkpoint-coordinator.ts` collects signatures and returns at the threshold check before writing.
The one that actually runs is in `mmr-store.ts` and writes the row with no signature collection at
all, so `checkpoint_node_signatures` is empty — a published checkpoint carries ZERO directory
signatures, not one.

**Three independent blockers, all measured — do not re-derive:**
1. `CHECKPOINT_PEER_ADDRS` is set **nowhere in IaC**, so `getPeerNodeIds()` returns `[]` and
   `availableNodes` is always 1 against a threshold of 2.
2. The MMR tables do not replicate, so every node's peaks differ and `verifyAndSign` **refuses by
   construction** — wiring (1) alone would still collect zero signatures.
3. `/cello/checkpoint/1.0.0` was **retired** by `M12-ANTI-ENTROPY-DESIGN §5` as *"unauthenticated in
   both directions and trusting responder-supplied pubkeys."* Re-enabling it to satisfy a checklist
   line would be a security regression.

**The shape of the fix is already written down:** `M12-P5` — rebuild cross-signing on the
authenticated AE channel with a deterministic shared leaf order. Not a wiring change.

**⚠️ Do NOT lower `requiredThreshold`.** `T = majority(N)` is settled. A threshold of 1 lets one node
complete a ceremony alone, which is the security violation the whole design exists to prevent.

**Related, and separable:** the retired proposal loop is still wired
(`bin/directory.ts` calls `checkpointCoordinator.start()`), so every node logs
`federation.checkpoint.skipped` at WARN every 10 minutes, forever, in every environment — a
permanent unactionable warning. M12 §5 said the mesh-retirement unit would remove the wiring; it did
not. Cheap to fix independently of the rebuild.

### `DOD-M15-CLOCK-CLAMP-1` — 🅿️ POST-LAUNCH. A peer can pin a wall-clock LWW field to the far future
**Found 2026-09-03 (Order 021), by review. POST-LAUNCH under §0z.4.**

**The shape:** both wall-clock last-writer-wins merges — `presence-merge` (pre-existing) and the new
`directory-node-heartbeat-merge` — take `max()` over a peer-supplied timestamp with no upper bound.
An authenticated peer advertising `last_heartbeat_at: "99999999999999"` wins permanently, because
**every honest writer writes `now()`, which is smaller**. There is no correction path: a dead node
reads as fresh forever on every node that pulled it, and if the poisoned key is our own `node_id`
the row churns every round without ever converging.

**Why not urgent today:** both freshness consumers deliberately ignore the heartbeat
(`resolveDiscoveryState` records `staleHeartbeat` for observability only; `listAccountAgentsWithPresence`
dropped the conjunct), so nothing currently acts on the poisoned value. **The trigger is anyone
re-gating on freshness** — the comments now say the signal is available, which is exactly the
invitation. Re-gate and this becomes a liveness lie an attacker pins.

**The fix:** clamp on ingest — reject or floor an incoming timestamp more than a small skew allowance
beyond `now()`, and log the rejection. State it as a shared rule for both merges, not a one-off.
### `DOD-M15-GATEWAY-HARDEN-1` — 🅿️ POST-LAUNCH. The screening sidecar can go down, and half of it is not running at all
**Found 2026-09-03 while reviewing `022-REFUSALVISIBLE`'s operator wording. Ruled POST-LAUNCH by
Andre 2026-09-03:** nothing to do now beyond recording it — the message that explains the outage to
the operator is written and approved. **The trigger is launch: look at the gateway properly before
opening signup.**

**What it would do to you:** your screener is a separate child process the daemon spawns and talks
to over a unix socket. When it is not answering, the daemon **fails closed** — every inbound message
from every counterparty is held undelivered rather than passed through unscreened, which is the right
default. So a screener that is down does not leak anything; it stops your agent receiving anything.
Nothing is lost (senders redeliver on their own once it recovers), but until then you are off the
air, and the only thing that tells you is the refusal notice.

**Four ways it stops answering, all logged:** it crashed (`security.gateway.exited`), it never
started (`security.gateway.spawn_failed`), it took too long on one message (`governance_timeout`), or
it errored internally while screening one (`screen_error`, logged as
`security.gateway.inbound.blocked`).

**⚠️ AND THE HALF THAT JUDGES MEANING IS OFF BY DEFAULT.** The deterministic layer — sanitizer,
pattern matching, the language allowlist — is always on. The **semantic injection classifier requires
a model to be installed**, and without one the daemon announces `security.gateway.layer2: "off:no"`
at startup and every inbound frame short-circuits past it. So an injection phrased in ordinary prose
is caught by pattern matching or not at all. This is already known and stated honestly at startup;
what belongs here is the question of whether that is the right default at launch, and what a fresh
install should do about it.

**What "harden" would mean, for whoever picks this up:** supervision and restart behaviour on the
sidecar (there is a restart path — is it used, and does it back off?); what a repeated crash should
tell the operator, versus one transient timeout; whether the model ships, is fetched, or is opt-in;
and whether an operator can tell at a glance which layers are live without reading a log line.

- **Related, and NOT the same:** `DOD-M15-NO-SILENT-REFUSAL-1` (✅) made the outage VISIBLE — the
  operator is now told, in plain terms, that the screener could not check a message and that the
  sender will redeliver. That line owns telling them. This one owns the gateway not going down in
  the first place, and running with all of itself switched on.


### `DOD-M15-RESERVE-PURPOSE-1` — 🅿️ POST-LAUNCH. A relay grants forwarding rows without asking what they are for
**Found 2026-09-03, [[2026-09-03_1158_relay-overload-and-the-four-things-underneath-it]]. Ruled POST-LAUNCH by Andre 2026-09-03:** it needs 128 registered agents,
and invite-only makes that expensive today. **Revisit before open signup — that is the trigger.**

**What it would do to you:** your agent is behind a router, like almost everyone, so it needs the
relay to hold a forwarding row for it. If the table is full your agent is **unreachable by anyone
NAT'd while its own status reads perfectly healthy**, and the refusal in the relay's log names the
attacker, not you being turned away.

**The arithmetic:** 4,096 rows per relay - 32 per agent - **128 agents fill a relay** - two relays -
**256 covers the fleet.** Registration is one Telegram round trip and an emailed code, 5/hour per
requester, and **nothing caps how many agents one account may register** — roughly a day of one
invited account per relay.

- **32 cannot simply be lowered.** It mirrors the daemon's own `MAX_SESSION_NODES = 32`, so an
  attacker holding 32 looks exactly like a busy legitimate agent. Tightening it caps real concurrency.
- **A row is granted on request, not on need** — the relay never checks whether you are actually
  NAT'd — and the reaper only runs above 80 per cent full and spares any row that carried traffic in
  six hours, which is one message per row, a trickle.
- **The fix (Andre's shape):** the reserve request states its purpose. Standing receiver → capped
  small, no manifest (none can exist yet). Session → present the manifest, which is a
  **reclassification** moving the row from the small budget to the session budget. Ceiling becomes
  "a couple of receivers plus one per brokered session."
- **⚠️ SHIPS WITH A DIRECTORY SESSION COUNTER, NEVER ALONE.** The fix moves the ceiling from 32 to
  "however many sessions the directory brokers", and **nothing counts that today** — no quota, no
  rate limit, no concurrent-session count anywhere in the directory. Without a meter the fix is worse
  arithmetic than the status quo.
- **Overlaps `DOD-M15-MULTIRELAY-1` (in the gate),** which names the same attack from the defender's
  side — flooding the relay an agent's reservation landed on. **MULTIRELAY owns spreading an honest
  agent's reservations; this line owns stopping an attacker occupying them.** Do not let either
  absorb the other silently.
- **Shares the restart hazard with `DOD-M15-MULTIDEVICE-1`** — see that line.
- **Where:** `packages/relay/src/relay-connection-gater.ts` (`SLOT_CAP_PER_AGENT` 48,
  `DEFAULT_SLOT_CEILING` 79, `admitSlot` 371, `reapIdleSlots` 479);
  `packages/interfaces/src/relay-online-token.ts` (104 bytes — agent key, expiry, signature; **no
  operator, no quota**); `packages/directory/db/migrations/V18__federation_schema.sql:20` (the live
  `sessions` row records **no participants**, which is why sessions-per-operator is uncountable).

### `DOD-M15-MULTIDEVICE-1` — 🅿️ POST-LAUNCH. One identity on two devices, and the second silently takes the first's traffic
**Found 2026-09-03, [[2026-09-03_1158_relay-overload-and-the-four-things-underneath-it]]. Ruled POST-LAUNCH by Andre 2026-09-03:** it affects one operator's own
two machines. Annoying, not a trust failure.

**What happens to you:** you run the same agent on a laptop and a desktop. Both are legitimate.
**The relay's delivery stream is keyed by public key**, so the second device's authentication
overwrites the first and the first device's incoming leaves arrive at a node with no handler. **The
directory routes inbound session offers through a map keyed by public key too** — last device to
authenticate wins, and the first stops receiving invitations **with no indication on either machine.**
Circuit dials are fine; it is the two pubkey-keyed maps that collapse, found independently in two
repositories.

- **THE POLICY IS DECIDED (Andre, 2026-09-03) even though the work is deferred:** multiple devices on
  one identity **are allowed**, but they **may not share a relay** — *"Sorry, this public key is
  already in use on this relay."* A relay cannot see what another holds, so it refuses locally and
  the client falls back, which it already does (it requests reservations with every known relay).
  Fixes the delivery-stream overwrite as a side effect.
- **⚠️ 3a — THE RESTART TIEBREAK IS NEEDED IN THE GATE EVEN THOUGH THIS LINE IS NOT.** A daemon that
  dies ungracefully returns with a **new peer ID under the same key**; a relay that has not noticed
  the old one leave refuses the agent **its own front door**. That is the outage that forced the
  reservation ceiling up from 15, so it is not hypothetical. **The same tiebreak is required by
  `DOD-M15-RESERVE-PURPOSE-1` and by [[M15-STORY-RELAYHANDOVER]], which IS in the gate — so build it
  once, there, not three times.** Andre's preferred shape: the newcomer wins, but only once the
  incumbent's connection is **provably dead**.
- **3b — which device gets an incoming offer is NOT solved by the relay rule and is still open.**
  Both devices authenticate to directory signalling under the same key whatever relays they use.
  Options recorded: offer to every device (first to accept wins — the only one where an invitation is
  never silently lost), or today's last-active behaviour made deliberate and visible.
- **Where:** `packages/relay/src/relay-node.ts` ~1420–1432; `packages/directory/src/directory-node.ts`
  2060–2078 (`#streams` single pubkey-keyed vs `#agentStreams` a set used only for liveness counting).

### `DOD-M15-SCREENER-IDENTIFIER-FALSEPOS-1` — the secrets screener redacts CamelCase TYPE NAMES as credentials
**FOUND 2026-08-24 by `CELLO_Coder_1`, in our own traffic, twice — filed here because BLOCKS is
Andre's to grant, but I would argue for it and the reasoning is below.**

**The evidence is two real messages, not a contrived case.** My send reached the other lane as
`authorship: [REDACTED:generic-api-key] | undefined`. **The redacted "credential" was the TypeScript
type name `SentAuthorship`.** Their previous message got the same treatment.

- **It is LABELLED, not silent** — the sender is told via `transformations`, and that is the
  difference between a defect and a disaster. Nothing is hidden.
- **But the RECIPIENT receives mangled text**, and cannot tell a redacted secret from a redacted
  identifier. In a technical conversation the redaction lands on exactly the words carrying the
  meaning.

**Why I would argue BLOCKS rather than post-launch.** The launch intent is *"two agents connect and
communicate."* A screener that eats CamelCase identifiers does not stop them connecting — it
degrades what they can say to each other, and **it degrades it hardest for the users most likely to
notice**. Both of tonight's instances were ordinary type names in ordinary engineering discussion,
which is the traffic two agents actually generate.

**Why it might legitimately be post-launch:** the ICP is explicitly not only developers, and for
non-technical traffic a CamelCase token is rare. **That is the real question and it is Andre's:
how much of launch traffic looks like ours?**

**NOT taken by either lane** — outside both gates, and neither of us should quietly widen scope into
the security layer's own rules. **Recorded rather than fixed, deliberately.**


**🧊 THE GATE IS FROZEN (Andre, 2026-08-23 — M15-PROCEDURE §0z.4).** Everything found from here
lands HERE, however bad it looks, unless it is a security hole a customer actually reaches — and
**BLOCKS is now Andre's to grant, not a lane's to choose.** Unclear no longer blocks; unclear comes
here with the question written down.

**Outside the gate. Real, worth fixing, does not stop us shipping** (M15-PROCEDURE §0z.1, Andre
2026-08-23). Nothing here is dropped, and nothing here was written up less carefully than a blocking
line — the classification changes what happens to a finding, never how hard it was looked for.

**A line arrives here only by being classified at creation.** Moving an existing tier line down here
is Andre's call, never a lane's.

### `DOD-M15-NODEHEAP-1` — ❌ The directory's memory growth has a cause
`DOD-NODE-HEAP-GROWTH-1`. Mitigated, not fixed: the ceiling was raised to 4,096 MB, buying roughly
two weeks instead of six days. The process grows ~250 MB/day and at ~80% of ceiling the node answers
**nothing for 40 seconds** while V8 collects on the same thread that serves HTTP.
- Establish whether the growth is a leak. Evidence points **away** from client traffic — `use1` (the
  hardcoded primary) and `euw1` (failover only) sat 9% apart after near-identical uptime.
- Anti-entropy, which every node runs continuously regardless of clients, is the untested candidate.
- The 60-second sampler is running; the growth rate across the three nodes is the measurement that
  decides whether this closes or becomes a real hunt.

### `DOD-M15-SEAL-RETRY-1` — ❌ A failed background ceremony retries itself
Split from `DOD-M15-SEAL-FAILED-TERMINAL-1`. The failure is now DISCOVERABLE and re-close is a working
manual remedy; nothing is automatic.
- An unattended daemon sits on a durable commitment doing nothing until it is restarted — the restart
  seal resolver is the only retry, and it only runs at boot.
- Most of the nine resolved failure reasons are transient by nature (`seal_counterparty_pending`,
  `seal_unilateral_timeout`, a directory briefly unreachable), so a bounded backoff would clear them
  without an operator ever seeing `seal_failed`.
- Reuse the resolver's discipline rather than inventing a second one: serial, staggered, with a
  give-up stamp — and note that `DOD-M15-SEAL-FAILED-TERMINAL-1` made that stamp clearable on revive.

Split from `DOD-M15-CLOSEWAIT-1` (review HIGH-1, the half that remains).
- `seal_in_progress` now distinguishes a RUNNING ceremony from "no ceremony". What is still missing is
  the terminal case: a background ceremony that **threw** leaves the session `active` with a durable
  commitment, no receipt, and nothing retrying until a daemon restart.
- The agent was handed `ok: true` at commitment, so it has no reason to suspect anything is wrong; the
  only account of the failure is a `session.seal.background.failed` line in the daemon log.
- Persist the last background failure on the session row and answer `seal_failed` with its reason, so
  the state survives the read and an agent can tell "slow" from "dead".

`DOD-M12B-CLOSE-SILENT-WAIT-1`. Half fixed — the wait now announces itself, which stopped operators
reaching for `force: true` and forfeiting the receipt the wait was about to earn (17 sessions were
lost that way).
- The caller still waits out `CELLO_SEAL_BILATERAL_TIMEOUT_MS` (660,000 ms) before the escalation
  that then succeeds. Measured 11m 06s.
- **Answering early orphans the unilateral escalation that runs inline after the wait** — that
  changes the close contract and what produces the receipt. Decide the contract, then build.

### `DOD-M15-MISMATCH-1` — ❌ An unsealable mismatch leaves a durable trace
`DOD-FRONTIER-MISMATCH-DURABLE-1`. The strand itself is closed (dedup is keyed on relay-assigned
position), but the mismatch flag is held **in memory and dies on every daemon restart** — which
undercuts the "a live session sat unsealable for a week" concern that made this severe.
- **Prefer derive-on-read from the persisted seal-rejection record**; it cannot drift from the
  evidence, where a written flag can.
- Inherited caveat: three paths still end unwitnessed (relay down, terminal assignment rejection,
  retry exhaustion), so **relay position is not total** and anything keyed on it must not assume it
  is.

---

### `DOD-M15-FREEZE-STATUS-1` — ❌ A defensive freeze is distinguishable in the session RECORD
Split from `DOD-M15-FRAME-1`, whose own clause asks that the freeze carry a status *"distinct from
an ordinary counterparty-absent close"*. It does not yet.
- `#freezeOnIdentityFailure` tears down via `destroySessionNode(..., "error")`, and `"error"` maps to
  DB status `interrupted` — **the same row an ordinary teardown writes.** So the freeze is
  distinguishable in the log and in behaviour, and invisible in the record an operator reads later.
- The sessions table has no reason/detail column. Adding one is a **client-side migration**, which
  on an operator's machine is unrecoverable if it fails — so it belongs in its own reviewed unit
  with an upgrade test against a populated pre-migration database, not riding inside a security fix.
- Until it lands, the ERROR log event is the only durable account of *why* a session ended this way.

### `DOD-M15-SILENTACK-1` — ❌ A dropped notification acknowledgement is reported, not swallowed
Found by `DOD-M15-CHAINROUNDTRIP-1` review pass 2, **by execution, not by reading** (→ Entry S10).
The same class as that line's F2, in the same file, missed only because the guard's marker is
`void this.#store.` and these are a different object.
- **Ten silent writes:** `void this.#notificationQueue!.acknowledge(...).catch(() => {})` —
  `directory-node.ts` ~2109–2152 and ~6114–6124. **What the user lives through:** a notification
  they have already seen is handed to them again, and again, because the record that they saw it
  never landed and nothing said so.
- **A silent drop three lines inside the block `CHAINROUNDTRIP-1` just fixed:** in the trust-signal
  ACK, `if (!ackAgentId) return;`. An authenticated agent whose pubkey has no `agent_id` row ACKs a
  signal, nothing happens, nothing is logged, and it returns on every pickup for 24 hours. Note
  this is `agent_id` vs `agent_name` territory — see the join-key rule in `.claude/CLAUDE.md`.
- **Enforcer:** widen `CHAINROUNDTRIP-1`'s fire-and-forget guard past `void this.#store.` to every
  `void this.#<field>.` fire-and-forget in the file. The guard's scanners are already correct — it
  is the marker that is narrow. **Re-run the three proven bypasses after widening**; a wider guard
  that stops catching is the worst outcome of the three.

### `DOD-M15-OFFER-EXPIRY-1` — ❌ An invitation to dial does not stand open forever
Split from `DOD-M15-ASSIGN-1` (b) review F5. `admitOfferedDialer` names a peer and **nothing ever
clears it**, so the DoD's word "live" is not enforced.
- An offer never followed by an assignment — initiator aborts, directory faults, the accept send
  fails — leaves the receiver holding a standing invitation to that peer **indefinitely**.
- **Two inbound offers close together are now mutually exclusive at the transport:** both are told
  to dial the same receiver, the second narrows the gate away from the first, and the first
  initiator is refused with a `connection.rejected` naming a peer id it never heard of. Before the
  gate existed, whichever dialed first simply won.
- **Fix shape:** bind the narrowing to the session id it came from, revert it when the accept send
  fails, and expire it on the same clock the directory uses before it gives up waiting for an accept.
- **Enforcer:** journey.

### `DOD-M15-RELAYLEAK-1` — ✅ Relay clients are closed
> **Closed 2026-08-24 (CELLO_Support).** Two review passes, both blocking, every finding fixed; 3 tests, 3 revert proofs RUN against the shipped tree. Full entry — including the mutation that reached `main` and how — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-RELAYLEAK-1`.

### `DOD-M15-SWEEP-ABORT-1` — ❌ A shutdown stops the network work it started
Split from `DOD-M15-STALEROSTER-1` (review F10). The background roster sweep spends up to ~16 s on
`/bootstrap` probes when a node is down, on a 90–180 s cycle — so roughly one `cello logout` in eight
lands mid-sweep.
- The daemon now IGNORES a sweep that completes after `stop()` (no callbacks, no log, no re-arm), so
  nothing acts on a dead daemon's behalf. **The probes themselves still run.**
- Cancelling them means an `AbortSignal` threaded through `manifestNodesToEndpoints` and
  `fetchBootstrapResult`, which owns a per-request controller for its own deadline and accepts no
  external one. That is a wide signature change and did not belong inside a hardening unit.
- The same seam would let `DOD-M12B-SHUTDOWN-1`'s reconcile sweeper stop dialing on demand.

### `DOD-M15-VOCAB-ORDERING-1` — ❌ A response cannot be assembled after it has been translated
Split from `DOD-M15-SELECTION-1`, where it cost an operator-facing defect. `renderForSurface` is a
PASS at ONE point in the pipeline: anything spread into a response after that point ships
untranslated, and MCP tool names are not commands a terminal can run.
- The instance: a fallback notice added at the IPC write told a CLI caller to *"Run
  `cello_use_agent`"*. The real command is `cello use-agent`. `isInstructionKey` would have rewritten
  it — the string simply arrived after the rewrite had run.
- **The prose audit is structurally blind to this class.** It checks that tokens naming tools are
  REAL tool names, and `cello_use_agent` is one. The defect is the ORDERING, and nothing watches it.
- The guard belongs on the pipeline, not the vocabulary: make it unrepresentable to add response
  fields downstream of the renderer, or assert at the boundary that no `*guidance` value leaving for
  a CLI surface contains an MCP verb.

### `DOD-M15-CHAINHEALTH-1` — ❌ Tamper-evidence can be checked without SSH
`DOD-ACCOUNTS-CHAIN-1`, the remainder. The writer is fixed, deployed and the data re-measured clean
(11 rows per node, `verifyChain` VALID on all three). What is missing is that answering *"is it still
intact?"* requires IAP SSH to each node and credentials out of Secret Manager — which is why a stale
"it is broken" note survived four days and nearly caused a destructive repair.
- `verifyChain("user_accounts")` on the ops-agent health output.
- Spin-off recorded, not repaired here: `DOD-ACCOUNTS-EMAIL-CHAIN-1` (the email half is stored but
  not chained), and the test-isolation defect where several suites `DELETE` from this append-only
  chained table.

### `DOD-M15-DOCPROFILE-1` — ❌ The agreed content profile is enforced by something
`DOD-DOC-PROFILE-1`. Two parties agree a profile at the handshake; it is bound into the document id
and immutable for its life, and **no verb consults it.** An operator who deliberately chose the
restrictive profile gets exactly the protection of one who did not think about it.
- Not a break — inbound updates are still screened by the general rules — but the setting is a
  promise the system does not keep.

### `DOD-M15-MMRCHAIN-1` — ❌ The whole-suite chain check covers every chain, not a hand-typed list
Found by `DOD-M15-CHAINROUNDTRIP-1` review pass 2 (→ Entry S10). **Not a live break** — measured
read-only against the running database, both tables verify today (16 and 15 rows). It is a live
**blind spot**, and it is the exact shape that cost `CHAINROUNDTRIP-1` three wrong diagnoses.
- `mmr-store.ts` builds `conversation_proof_leaves` and `conversation_proof_mmr_nodes` with the same
  `computeChainHash(serializeRecord(...))` scheme and the same genesis constant — and neither is in
  `HASH_CHAINED_TABLES`, so the new whole-suite teardown cannot see them.
- **A test that tampers an MMR leaf and forgets to restore it is therefore invisible**, exactly as
  `persist-018`'s unrestored tamper was invisible before it. These two are also the ONLY chains
  production actually calls `verifyChain` on, which makes the gap the wrong way round.
- **`HASH_CHAINED_TABLES` is itself a hand-typed literal** and `schema-completeness` AC-005 only
  checks one direction — every listed table has a migration, never the inverse. That is why the list
  could silently omit two real chains.
- Not a one-line change: `verifyChain` is typed to `HashChainedTable` and the MMR tables are written
  by a different store. **Enforcer:** the teardown covers every chained table the schema has, and a
  new chained table cannot be added without appearing in it.

### `DOD-M15-BUNDLED-2030-1` — ❌ The compiled-in manifest has a cliff and no in-band remedy
Split from `DOD-M15-MANIFEST-EXPIRY-LIVE-1`. `BUNDLED_CONSORTIUM_MANIFEST` expires `2030-01-01`.
- On that date **every daemon on the production default refuses to start** (ADV-002), simultaneously.
- The only fix is upgrading `@cello-protocol/connect`, which an operator whose daemon will not start
  has no in-product prompt to do.
- The bundled path wires no manifest poll, so a newer manifest cannot be adopted at runtime either.
- Needs a rotation story before it needs a fix, but the cliff should be on the record now.

<!-- superseded detail from the original line, retained for the trail -->
Found by `DOD-M15-STALEROSTER-1`'s review, and **the inverse of where that unit put the hazard.**
- Manifest expiry is checked **only at startup** (`verifyStartupManifest`), and the bundled-manifest
  path wires **no poll scheduler** at all.
- So a long-running daemon whose manifest expires under it keeps probing its node set and — after
  `STALEROSTER-1` — reports `stale: false`. A confidently fresh reading taken against an expired
  trust anchor, which is worse than the stale reading that line was written to fix.
- Minimum: surface `expires <= now` in the status block. Better: re-check on the manifest poll.

### `DOD-M15-DDOS-1` — ❌ Volumetric protection sits in front of the relay
**The only line in this milestone that addresses actual denial of service**; every other control is
application-layer and changes who is *admitted*, not how much traffic *arrives*. A gate runs after
the TCP connection is made and the handshake has begun.
- Cloud Armor or equivalent in front of the public relay endpoint, which is open to `0.0.0.0/0`.
  [[server-infrastructure]] already states the requirement and it is not built.
- **Against a user's machine nothing at the application layer helps** — once packets arrive at a
  home connection the link is saturated before any code runs. Relay-mediated inbound **is** the
  client-side volumetric defense, because it moves the addressable endpoint onto infrastructure that
  can have scrubbing in front of it.
- Terraform; parallelises cleanly with everything.

### `DOD-M15-START-AGENT-UNAWAITED-1` — ❌ `cello_start_agent` reports started before the agent can hear
> **🔒 CLAIMED 2026-08-24 by `CELLO_Coder_1`. Files: `core/daemon/src/daemon.ts`, the
> `cello_start_agent` handler only.** It had been referenced from two other lines and had **no line of
> its own** — the "a bullet cannot be tagged, claimed or counted" shape this file names.

`daemon.ts` fires `void sessionNodeManager.ensureStandingReceiverForAgent(name)` and returns
`{ ok: true }` on the next line, so the response says started while the receiver may not exist. A
session landing in that window is refused `standing_receiver_unavailable` — a precondition on our own
side, reported as though the counterparty or the directory were at fault.
- **The fire-and-forget is deliberate and stays:** initiate/accept ensure on demand, and awaiting it
  would make a network failure fail the start. **The defect is the CLAIM, not the timing.**
- Product-side cause of the race `DOD-SPINE-5` works around with a readiness poll on the test side.
- **Enforcer:** the response distinguishes started-and-ready from started-and-still-building, and
  `cello_status` agrees with it.

### `DOD-M15-JSPINE-REST-1` — ✅ CLOSED 2026-08-24. `j-spine` is 7/7; all three are fixed.
Two were stale expectations (a deleted always-empty stub; a `registered` flag removed because it
lied); the third was a real race, fixed with a readiness poll. Product-side cause filed as
`DOD-M15-START-AGENT-UNAWAITED-1`. Trail → [[M15-BUILD-JOURNAL]].

### `DOD-M15-JCONTENT-DELIVERY-1` — ⚠️ WAS ✅ · was 6/10 (2026-09-02) · **now 12 passed / 2 failed (2026-09-05)**
> **RE-MEASURED 2026-09-05 by `030-RELAYSILENT`, three consecutive runs as separate OS processes against
> the real consortium: 12 passed / 2 failed.** Every cause named below is closed —
> `DOD-MSG-3` by `PARKCOLLECT-1`, `DOD-MSG-5`/`MSG-7` by `PARKERROR-1` + `030`, `DOD-MSG-8` by `030`
> (and its stale "renamed tool" reading was wrong twice over). **The two that remain are both ruled
> POST-LAUNCH:** `DOD-MSG-2` → `DOD-M15-STARTUPFLUSH-1` (Andre, 2026-09-05), and a `024-ORPHANTRIAGE`
> assertion matching the SIGNED-message notice rather than the refusal — a test selecting the wrong
> branch, no operator-visible behaviour implicated.
> **⚠️ ONE FURTHER TEST FLAKES, A DIFFERENT ONE EACH RUN** (`DOD-MSG-3/4 (recover)`, then
> `022-REFUSALVISIBLE (byte cap)`, then neither). `030` recorded it UNCLASSIFIED under its trip-wire
> and it is **not yet filed as a line anywhere.** Classifying it is an open call.
> **The four defects this line fixed on 2026-08-24 stayed fixed. What is false is the headline** —
> *"`j-content` is 10/10, full-file"* — and it has been false for some time without anyone knowing,
> because the lane was not re-run between 2026-08-24 and 2026-09-02. **A file-level pass count is a
> claim with a shelf life, and this one was written as though it were permanent.**
>
> The full-lane run of 2026-09-02 puts `j-content` at **4 of 10 failed**, in three separate causes,
> none of them the four this line closed:
> - **DOD-MSG-3 — parked mail cannot be collected. NEW; it passed in the 2026-08-23 baseline.**
>   → `DOD-M15-PARKCOLLECT-1`.
> - **DOD-MSG-5 / MSG-7 — the park deposit fails with an unreadable error.** Red in the baseline
>   too, so not a regression — it was simply never in this line's four. → `DOD-M15-PARKERROR-1`.
> - **DOD-MSG-8 — the test calls `cello_get_transcript`, which no longer exists** (the MCP tool is
>   `cello_transcript`). Test-side, not a product break — but it means **DOD-MSG-8 is currently
>   measuring nothing**, which is worse than a red for a check whose whole job is to read the
>   transcript back. Fix the call, then find out what it says.
>   **⚠️ STALE as of 2026-09-04 — `024-ORPHANTRIAGE` measured MSG-8 failing on
>   `No open connection to peer <relay>`, a product fault, not the renamed tool.** It is now part of
>   `DOD-M15-PARKCONN-1`'s cluster. Do not read this bullet as the current cause.
>
> Original entry, which stands on its own terms: four separate defects, not the one cause this line
> named — an unsigned deposit shape SEC-1 refuses, a deposit of the wrong string (`[[OVER]]` is
> in-band), a retired event name, and a wait latching onto the first of several recover sweeps.
> Every hypothesis recorded here was wrong. Trail → [[M15-BUILD-JOURNAL]].

### `DOD-M15-SAMEOP-FALSEPOS-1` — ✅ RESOLVED: NOT a defect. The journey updates a superseded column.
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-SAMEOP-FALSEPOS-1`.

### `DOD-M15-RELAYSEQ-UNSIGNED-1` — dedup trusts a position nobody signed
**POST-LAUNCH under the frozen gate (§0z.4).** Raised by `CELLO_Coder_1` from the other side —
*"anything that treats a relay-assigned `sequence_number` as authenticated is resting on nothing"* —
and traced into this lane rather than assumed.

**The fact:** Structure 1, the only bytes a client signs, is
`[version, content_hash, sender_pubkey, session_id, last_seen_seq, timestamp]`. **`sequence_number`
is not in it.** It lives only in Structure 2, which the relay produces. So the canonical position is
unauthenticated by construction.

**Where this lane consumes it:** `ingestReceivedContent` takes `canonicalSeqIn` from that record and
uses it to decide whether an arriving message is a REDELIVERY or genuinely NEW.

- **The suppression direction is SAFE, and it is worth saying why rather than just concluding it.**
  The redelivery branch requires `tree.hashAt(canonicalSeqIn) === contentHashHex` — the content must
  already be at that position. A relay cannot mark a new message as "already seen" unless that exact
  content genuinely is already there, in which case nothing is lost.
- **The duplication direction is NOT.** A position at or beyond the frontier is treated as new. An
  inflated position therefore forces a second append of content this side already holds — the
  "too permissive" case the code's own comment measures at tree size 3 where 2 is correct. That
  **inflates this side's tree against the counterparty's**, which is the strand: the two trees
  disagree and the session can no longer seal bilaterally.
- **Bounded honestly:** a relay that wants to break a session can already drop messages, so this
  buys an attacker a different failure rather than a new capability. What makes it worth a line is
  that the failure it produces is SILENT and looks like the counterparty's fault — a session that
  simply stops being sealable.
- **Do not fix by signing the position.** That is a wire change and it belongs with
  `SEALWIRE-1`'s bullets 3+4, where the root and chain verification already live. The narrow fix
  here is to stop treating an unsigned position as authority for an append decision.

> **⚙️ THE RELAY HALF IS RESOLVED — `031-RELAYREPLAY`, 2026-09-05. The client half below is NOT, and
> stays POST-LAUNCH.** Handover renumbers by design, on the happy path, with honest software — so
> the case parked here as *"only reachable if a relay lies"* became reachable in ordinary operation
> the moment a conversation could move between relays, and was resolved inside that unit rather than
> deferred. A relay adopting an inherited chain derives its frontier from the PRIOR relay's signed
> ACK receipts (which bind `content_hash → seq`) and the signed `last_seen_seq`, and never from its
> own `seq_counter`; a test seeds that counter to 99, adopts a four-leaf chain, and asserts the
> frontier is 4 and the next leaf lands at 5. The position is still not signed, per the bullet above.
>
> **The same unit also closed a gap this entry did not know about**, found by review: `last_seen_seq`
> is an UPPER bound, so for two ADJACENT leaves from one sender it is satisfied either way round —
> and `prev_root` does not pin them either, because the party assembling a batch writes Structure 2
> in full and simply recomputes it. Two of a counterparty's consecutive messages could therefore be
> swapped, which made their honest tip attestation disagree and marked THEIR conversation
> permanently unsealable. Closed with the sender's own signed timestamp, non-decreasing per sender.
>
> **Still open here:** `ingestReceivedContent` on the CLIENT still takes `canonicalSeqIn` from a
> relay-supplied record to decide redelivery-versus-new, which is the duplication direction described
> above. Untouched, and post-launch. → `031-RELAYREPLAY`
- **Related and NOT the same:** `DOD-M15-CORROBORATE-1` (the relay's independent copy) and
  `SEALWIRE-1` bullet 3 (the directory verifying the SEAL leaf's `final_root`).

### `DOD-M15-REVOKED-READS-OFFLINE-1` — a retired agent is reported as merely "not currently online"
**POST-LAUNCH under the frozen gate (§0z.4)** — nothing is admitted that should be refused, so it is
not a security hole. **It is error substitution with actively wrong guidance**, which is this
milestone's own named defect class, and Andre's to reclassify.

**What the operator is told when they try to reach an agent that has been permanently retired:**

> *"The counterparty exists but is not currently online. Have its operator bring it online
> (`cello_status`), then retry."*

**They then wait, retry, and ask the other person to bring an agent online that no longer exists.**
The guidance does not merely under-inform — it instructs an action that cannot succeed.

**The chain, traced rather than guessed (`j-remove` DOD-REMOVE-3, measured):**
1. `outbound-sessions.ts` runs DISCOVERY before it sends a `session_request`.
2. `classifyOnlineResult` collapses the lookup into three states, and a REVOKED agent comes back as
   **`offline`** — evidenced by the observed result, not inferred.
3. The client returns `counterparty_offline` and **never sends the session_request.**
4. So the directory's revoked check — `directory-node.ts`, `isAgentRevoked(target) ||
   isAgentRevoked(initiator)` → `agent_revoked`, correct and well-placed — **is on a path that is
   never reached.**

- **The check is not missing. It is SHADOWED.** A correct refusal exists, is right, and sits behind
  a coarser earlier answer. That is worth stating precisely because "add a revoked check" is the
  obvious fix and it is already there; the fix is at the discovery classifier, which flattens
  *retired forever* into *not right now*.
- **Both directions of the guidance are wrong**, which is what makes it worse than silence: the
  initiator waits for something that will never happen, and the counterparty's operator is asked to
  fix an agent they deliberately retired.
- **Enforcer:** `j-remove` DOD-REMOVE-3 green — the test already exists and already asserts the
  right thing; it has been failing since the lane stopped being run.

### `DOD-M15-SUSPEND-UNTESTED-1` — threshold-refusal has NO test under the threshold we actually ship
**POST-LAUNCH under the frozen gate (§0z.4).** A COVERAGE gap in a security control, filed because
"no test" and "passing test" look identical from a suite summary.

> **📌 `DOD-M15-SPINERED-1` IS HELD OPEN FOR THIS LINE** (Andre, 2026-09-04). Every other failure in
> the evidence lane is green, out of gate, or owned elsewhere; SPINERED stays 🟡 so this gap keeps a
> visible marker in a tier rather than only in the backlog. Closing this closes that.

- **The group is 2-of-4, not 2-of-3** — the client holds a FROST share
  (`frost-threshold-signer.ts`: `{ min: threshold, max: participants + 1 }`, *"+1 for the client"*).
  So client + any ONE directory reaches T, and `j-suspend-tofn`'s `ok: true` on a 2-of-3 suspension
  is arithmetically correct.
- **Which collapses the journey's premise:** under T=2, suspending 2 of 3 signs and suspending 1 of 3
  signs, so both halves give the same outcome and the test **cannot distinguish threshold-refusal
  from single-node-refusal** — the property it is named for. **We therefore have no passing test that
  threshold-refusal works under the shipped threshold.**
- **DO NOT "fix" it by flipping the expectation to `ok: true`.** That is a green test asserting
  nothing about refusal, which is worse than the red one — the red at least says something is
  unexamined.
- **The rework that works is N=5** (T=3, node 0 never suspended, so the single-node initiator gate is
  out of the picture in both halves): 3 of 5 suspended → signs; 4 of 5 → BLOCKS. Cost is a
  5-directory spine cluster. *(Two earlier reworks were derived and both were wrong — trail in the
  journal.)*

> ### ✅ CONTRADICTION RESOLVED from code 2026-08-24 — **and the flagged query would have misled.**
> It asked: read `agent_suspensions` on the other two nodes. That returns ROW PRESENT — both tables
> the honour-check JOINs do replicate (`agent_suspensions` Tier-B, `agent_profiles` Tier-A), so the
> premise holds and `directory-node.ts`'s "until… replicated" comment is stale.
> **But the conclusion does not follow.** The measured failure was never a honouring failure:
> `node1=never-asked node2=never-asked`. A node nobody consults can neither honour nor refuse.
> **The open question is the client-delegated ceremony — why an assignment forms without asking a
> majority — which is already filed for Andre.** Not reclassified; that follows from his answer (§0z.4).
> Trail → [[M15-BUILD-JOURNAL]].

### `DOD-M15-TOOLDESC-SCAN-1` — The claim scanner can see MCP tool descriptions
**POST-LAUNCH** (§0z.1): the launch risk is whether the shipped descriptions are HONEST, and
`DOD-M15-TIERTEXT-1` audits them by hand in this milestone. This line is the durable control that
stops the next one drifting — real, and not what a customer meets at launch.

**Answer to the question that produced it: NO, they are not covered.** Read out of the scanner, not
inferred. `shippedSurfaces()` enumerates `.md` files three ways — via each core package's
`package.json#files`, the repo root, and `plugins/**` — and then reaches exactly ONE non-markdown
file, by name: `core/cli/src/registry.ts`. `core/adapter-claude-code/src/bin/cello-mcp.ts` is
neither markdown nor that file, so **not one of its tool descriptions has ever been scanned.**

- **The hole is the shape the scanner's own header condemns.** That header says surfaces are
  enumerated *"never from a hand-kept array"*, because the connect tarball's `SKILL.md` was missed by
  every previous audit *"precisely because it was not on anyone's list"*. The `.md` half honours
  that. The prose-in-TypeScript half does not: it names one file, which is a hand-kept list of
  length one.
- **It is producing, not theoretical.** The first look at the unscanned surface found a false claim
  (`DOD-M15-TIERTEXT-1`). Tool descriptions are read by every operator AND by every agent that calls
  the tool, which makes them the surface most likely to describe behaviour and the one most likely
  to be acted on without a human reading it.
- **Do not fix it by adding a second filename.** That reproduces the defect one entry longer. The
  right shape is the one the `.md` walk already uses: enumerate what SHIPS — every `bin`/`main`
  entry point a package's `package.json` declares — and take prose-shaped literals from it, exactly
  as `registryClaimStrings()` already does for the CLI.
- Expect a large baseline on first run; `cello-mcp.ts` has never been adjudicated. Same
  shrink-only backlog treatment the scanner already uses, for the same reason.

---

### `DOD-M15-GRACE-WINDOW-1` — 🅿️ POST-LAUNCH. The unilateral-seal grace window measures the wrong thing
**Found 2026-08-23, invariant-checking `SEALWIRE-1` bullet 7 (review pass 2).** Verified in code, not
inferred.

A unilateral seal lets one party close a session when the other has gone away, so an absent
counterparty cannot hold a conversation hostage. It is gated on a delivery grace period —
`elapsedMs < graceMs` — and `graceMs` defaults to **600 seconds**.

**The value it measures from is `#sessionLastActivity`, which is named *last activity* and holds
*session start*.** Two writers outside `NODE_ENV=test` hooks: session creation, and the restart
restore seeding `genesisTimestampMs`. **Nothing refreshes it while a session runs.** So:

> **Any session older than ten minutes can be unilaterally sealed by either party at any moment,
> including in the middle of an active exchange.** A counterparty who has been replying to you for an
> hour is exactly as sealable as one who never answered.

The counterparty's liveness does not gate it — the directory's own comment says *"the seal completes
either way … the liveness only colours how the counterparty is recorded (never whether the seal
happens)."*

**Classified POST-LAUNCH, and the reasoning:** it needs the *other* party to deliberately invoke a
unilateral seal — it never fires on its own — so the core value (two agents connect and communicate)
is intact, and no session is closed by a timer. What is broken is that the protection the grace
window is *for* does not actually protect: it is meant to mean *"they have been silent for ten
minutes"* and it means *"the session is ten minutes old."* Real, worth fixing, does not stop a ship.

**⚠️ `SEALWIRE-1` bullet 7 did NOT cause this.** The deleted `seal_attempt` handler held the only
mid-session refresh and had no sender, so the refresh could never fire. The deletion removed a
writer that was already unreachable and made the misnaming visible.

**Why it is written here rather than left in a comment.** This milestone spent a commit correcting a
comment that pointed at a DoD line which did not exist, on the grounds that *a pointer to nothing
reads as tracked*. A security-relevant gap with no pointer at all reads the same way — and until
now this one lived in a single code comment.

- **The fix, when taken:** refresh the timestamp on real session traffic (leaf submit is the natural
  site), or rename the field to what it holds and re-derive whether "session age" is the gate anyone
  wanted. Renaming alone is not enough — the gate would still be wrong, just honestly wrong.
- **Enforcer:** receipt.

### `DOD-M15-RELAY-WAL-UNWIRED-1` — 🅿️ POST-LAUNCH. Relay leaf durability has never run
**Found in the same pass.** `bin/relay.ts` constructs a `SessionWal` and never passes it to the node —
the `const sessionWal` has carried an `eslint-disable` for unused-vars since PERSIST-013 landed on
**2026-05-16**. So `RelayNode`'s injected copy has always been `null`, no `open`/`append`/`reconstruct`
ever runs, and a relay crash loses in-memory leaf state exactly as it would with no WAL at all —
while `bin/relay.ts` still **hard-exits** if `WAL_DIR` is unset in dev/staging/production.

The interface header stated the crash recovery as fact until this pass; it now separates intent from
behaviour. The implementations are kept deliberately: they are complete and tested, and deleting
them is a decision about whether relay leaf durability is wanted, **which is Andre's call, not a
cleanup.**

**Classified POST-LAUNCH:** nothing regresses — this has been the behaviour for three months and no
shipped feature depends on it. It is on the backlog because the gap was invisible, not because it is
newly broken.
- **Enforcer:** receipt.

---

### `DOD-M15-SEALROOT-EMPTY-1` — 🅿️ **NOT A PRODUCT DEFECT. A STALE TEST CONTRACT.** Five spine journeys assert a `close_session` shape the product deliberately retired
> _(trail moved to [[M15-BUILD-JOURNAL]] — see “DoD trails, moved 2026-08-24”.)_

> _(the superseded ❌ BLOCKS LAUNCH write-up, and the exoneration evidence in it that still stands, moved 2026-09-04 to [[M15-DEFINITION-OF-DONE-ARCHIVE]].)_

---

### `DOD-M15-UNILATERAL-NOTARIZE-1` — 🅿️ POST-LAUNCH BACKLOG. A seal with an absent counterparty attests, then stops
**Found 2026-08-23 running the converted `j-unilateral` (bullet 8). Recorded, not fixed — the gate is
frozen and this is not a security hole. ⚠️ I think it may warrant blocking and that is Andre's call
to make, not mine; flagging rather than adding.**

**What an operator lives through.** Their counterparty goes away. They close. The close succeeds and
tells them a receipt is coming. **It never arrives.** The unilateral seal exists precisely so an
absent counterparty cannot hold a receipt hostage, and on this path it produces nothing.

**What is established, by running it twice:**

- `session.unilateral.attestation` **fires**, with `liveness: "gone"` — the directory got as far as
  attesting the counterparty absent, from a positive relay observation.
- `session.unilateral.notarized` **never fires.** Zero occurrences in either run.
- No root arrives at `cello_sealed_receipt` within 90 s, against a harness whose own guidance says
  escalation happens *"after about 1 minutes"*.
- **The BILATERAL path in the same file passes green**, twice: B alive with its daemon auto-acking
  seals in 2.4 s, and `j-upgrade` does the same in 4.6 s. So this is not the harness, not the
  conversion, and not the receipt-polling change.

**What is NOT established, and is not guessed at:** what sits between the attestation and the
notarization. It is somewhere in FROST notarization or the persist that follows it. I stopped
looking — the gate is frozen and chasing it further is the rabbit hole the launch-triage rules name.

**Why the tests hid this until now.** They asserted `close.sealed_root`, a field the non-blocking
close stopped returning, so they failed on the retired contract and the *real* failure underneath was
invisible. Converting them to poll the receipt is what surfaced it. That is bullet 8 doing exactly
what bullet 8 is for: *"every one stays green if the directory certifies a root over a completely
different leaf set"* — the same shape, one layer along.

- **Enforcer:** journey — `j-unilateral`'s first two tests are the receipt and must go green.

---

### `DOD-M15-NORMHASH-ORDER-1` — 🅿️ POST-LAUNCH BACKLOG. The seal survives Unicode folding by ORDERING, and nothing pins it
**Answers the other lane's `DOD-M15-NORMHASH-1` question, checked in code 2026-08-23 rather than
recalled.**

The gateway sanitiser folds confusables via NFKC — correct, a real defence, and **it must not be
weakened.** The question was which bytes the seal hashes, because if the two sides hash different
ones then any message containing a foldable character makes the trees disagree and the session cannot
seal bilaterally: **the core promise failing on an ellipsis.**

**It does not, and the reason is the order of two steps:**

- **Sender** — outbound screening runs FIRST; the hash is then taken over the screened bytes; those
  exact bytes go on the wire. (`session-content-handlers.ts`: `sendBytes` is
  `modified ? outboundVerdict.content : contentBytes`, and that is what is hashed and what is sent.)
- **Receiver** — the content-hash cross-check runs BEFORE `screenInbound`
  (`session-node-manager.ts`, cross-check ~6595–6680, `screenInbound` ~6867). It hashes the bytes as
  they arrived, compares, and only then sanitises.

So both sides hash **the bytes on the wire**. The sender folds before hashing; the receiver hashes
before folding; no fold happens between the two hashes.

**⚠️ THE RISK IS A FUTURE REORDER, AND IT WOULD LOOK LIKE A TIDY-UP.** Moving the cross-check below
`screenInbound` reads as *"screen it before you trust it"* — a reasonable-sounding change that would
break the seal for every message containing a foldable character, presenting as the product failing
on punctuation rather than as an ordering regression.

- **The fix is a test, not a code change:** one message containing `…` through a real session,
  asserting both roots stay byte-identical. `j-loopback` is the natural home — and its content is
  plain ASCII today, which is precisely why the journey currently passing is **not evidence** for
  this property.
- **Enforcer:** journey.

---

### `DOD-M15-NOTCARRIED-REFUSE-1` — ✅ CLOSED by `DOD-M15-SEALPARTIES-1`, 2026-09-02
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-NOTCARRIED-REFUSE-1`.

---

### `DOD-M15-SEALROOT-UNILATERAL-1` — 🅿️ POST-LAUNCH BACKLOG. The unilateral seal path never calls the final-root verifier
**Raised by review pass 1 on `DOD-M15-SEALWIRE-1` bullets 3+4 (finding F5).**

`seal-final-root.ts`'s own header names its callers as *"the unilateral and bilateral verification
loops."* Only the bilateral one is wired. `reconstructCarriedSealLeaves` threads `content_bytes`
through, shape-checks it and bounds its size — and then `#processSealUnilateral` never reads it.

**Why this is NOT the same severity as the bilateral gap, stated so nobody reclassifies it on the
name alone:** the unilateral path's leaves are **client-carried**, and each own-party leaf is
verified against the relay's signed receipt with a contiguity check. Bullet 4's circularity — the
relay grading its own homework — does not apply in the same form there.

**Why it is still real:** `DOD-M15-UNILATERAL-1` records the trigger as clock-only with no presence
check, so the PRESENT party is the one who benefits from a trimmed leaf set, and their own signed
`final_root` is the one value that would constrain them. The verifier that would do it is built,
tested, and already receiving the bytes.

- **The work:** call `verifySealFinalRoots` in `#processSealUnilateral` with the roster from
  `#sessionParticipants` (that path already resolves it), and decide the `not_carried` policy
  separately from the bilateral one.
- **Enforcer:** unit — a unilateral seal whose carried payload names a root over a larger leaf set
  than the one presented must be refused.

---

### `DOD-M15-SEALREJECT-MUTE-1` — ⬆️ MOVED INTO THE GATE (Andre 2026-09-03) · was 🅿️ POST-LAUNCH. The one moment the system catches the attack it was built for is the moment it tells nobody
> **Andre's standing rule, 2026-09-03:** *"Things shouldn't be silently refused. If you're refusing
> someone for something, your human operator should know about it."* A seal rejection is a refusal,
> so this follows the rule into the gate. It is the **same defect at a different door** as
> `DOD-M15-NO-SILENT-REFUSAL-1` (the inbound door) — and until 2026-09-03 nobody had connected the
> two, which is why one sat in the backlog while the other was being written as urgent.
>
> **It keeps its own line rather than being folded in**, because the two doors have different code,
> different call sites and different tests; folding would hide one of them inside the other's
> checklist. Pull them together if that suits the lane, but neither closes on the other's evidence.
**Raised by review pass 1 on `DOD-M15-SEALWIRE-1` bullets 3+4 (findings F2 and F7), filed as ONE
line because they are one operator-visible problem. Verified in code, not taken from the review.**

**What an operator lives through.** Alice closes. Bob closes. The directory catches a relay
presenting a leaf set the participants never signed, refuses to certify it, and writes an accurate
error to its own log. Alice and Bob see: **a close that never completes.** No receipt, no error, no
reason. The two people it happened to are the only parties told nothing.

**The two halves, and why neither is worth fixing alone:**

- **F7 — the frame has no consumer.** `#notifySealRejected` broadcasts `session_seal_rejected` to
  every authenticated stream. A grep of the whole `cello-client` repo returns **one hit: the type
  definition**. No decoder, no handler, no listener. The frame has never been read by anything.
- **F2 — and its reason is wrong anyway.** `SealRejectionReason` is a closed seven-value union with
  nothing for a final-root failure, so all six `SEAL_FINAL_ROOT_REASONS` are broadcast as
  `merkle_root_mismatch` — the label of the *circular arithmetic check* that bullet 4 exists to
  distinguish itself from. The direction is backwards too: the accused (the relay) receives the
  accurate reason on its own error path, while the victims receive the misleading one.

Fixing F2 alone re-labels a frame nobody decodes. Fixing F7 alone gives operators a consumer that
reports the wrong subsystem. **The work is: extend the union, bump `protocol-types`, and give the
client a handler that surfaces it through the close path.**

**⚠️ I CLASSIFIED THIS BELOW THE REVIEWER, WHO MARKED F2 BLOCKING — recorded so the disagreement is
visible rather than resolved by silence.** My reasoning: the gate is frozen and the launch test is
whether a prospective customer is *ruined* or can *forgive*. This fires only when a relay presents a
tampered or corrupt leaf set. In the ordinary case the seal succeeds; when it does not, the operator
already has `cello_sealed_receipt` and the close path's `pullSealCertificate` recovery, so they learn
there is no receipt — just not why. That is a bad experience, not a lost core promise, and it has
been the behaviour for the life of the frame. **If Andre disagrees, this belongs in the gate and the
reviewer was right.**

- **Enforcer:** unit on both sides — the directory sends a reason that names the final-root check,
  and the client's close path surfaces a refusal instead of a silent non-completion.
- **Cross-repo:** needs a `@cello-protocol/protocol-types` version bump and publish (human-gated),
  then the `trustless-cello` package.json update.

---

### `DOD-M15-SEALROSTER-FEDERATED-1` — 🅿️ POST-LAUNCH BACKLOG. The participant roster is node-local, and the node that adjudicates a seal usually is not the node that assigned the session
**Raised by review pass 2 on `DOD-M15-SEALWIRE-1` bullets 3+4 (HIGH-2). Verified against the code and
against this repo's own comments, not taken from the review.**

`DOD-M15-SEALWIRE-1` bullet 4's fix has two halves. The payload half is solid: the directory compares
the relay's leaves against a root the participants themselves signed, which the relay cannot produce.
**The roster half is solid only on a node that assigned the session**, and in the deployed topology
that is often not the node doing the checking.

**The chain, each link confirmed in code:**

1. `#sessionParticipants` is in-memory, written at `session_request` on the node holding the SESSION
   initiator's signaling stream.
2. At boot it is reloaded only from this node's own `sessions` rows.
3. `sessions` is deliberately excluded from anti-entropy — `ae-table-encoders.ts` lists it under
   *"node-local by design… per-node delivery state"*, and the determination recorded there resolves an
   earlier design doc **in favour of keeping it node-local**. So there is no store to fall back to.
4. `directory-node.ts` says of the seal path: *"the relay drives every seal to a SINGLE configured
   directory (`relay_primary_directory`), so any agent not homed on that node lands here."*

So a seal is routinely adjudicated by a node with no record of the session, the roster silently
reverts to the one derived from the relay's own leaf array, and a ctrl leaf minted with a key the
relay holds is undetectable — the exact behaviour review pass 1's F3 was raised against, reachable
again through the topology instead of through the code.

**What still holds on that path**, so this is not read as "the check does nothing": the payload
binding against the client-SIGNED `content_hash`, and whether the two participants signed the same
root. Only the "are these two the people who opened the session" half is lost.

**The fix, and why it is better than replicating `sessions`:** the relay holds the
**directory-signed session assignment** — it recorded it, and under Option B the client presents it.
That assignment names both participants and is signed by a directory, so it is **not
relay-forgeable**. Carrying it with the seal submission makes the roster travel with the thing being
adjudicated instead of being looked up from memory the adjudicating node does not have. Replicating
`sessions` would reverse a determination this repo already made deliberately, for reasons unrelated
to this check.

**Why POST-LAUNCH under the frozen gate:** it needs a relay operator to be malicious *and* the seal to
land on a node that did not assign the session. Launch is a single-region dev topology where the two
coincide, so the check has its teeth today. This is a line to close before the federation widens, not
before launch.

- **Enforcer:** cross-node — a seal adjudicated by a node that did not assign the session must still
  refuse a ctrl leaf signed by a non-participant. The current single-node test harness cannot fail
  this case, which is why it was invisible.

---

### `DOD-M15-AC009-INTERMITTENT-1` — 🅿️ POST-LAUNCH BACKLOG. A publish-gating test fails about a third of the time in CI and never locally
**Found 2026-08-24 by it blocking the `v0.0.257` cascade. Measured across six consecutive CI runs of
the same suite, not inferred from one.**

`AC-009 (binary): SIGTERM marks active sessions interrupted` is one test of 4,485 and it gates every
publish, because the Build job gates `publish-tag`. Observed on the same day, same suite:

| run | commit | AC-009 |
|---|---|---|
| main | `1ff0aea` | pass |
| main | `2e76321` | pass |
| main | `a0add31` (version strings ONLY) | **FAIL** |
| tag `v0.0.257` | `3ff650a` | **FAIL** |
| main | `8e85740` | pass |
| main | `32677198160` … `32677449951` | pass, pass |

**`a0add31`'s entire diff is seven version strings in seven `package.json` files**, so the failure is
not caused by the change under test. Both lanes ran the full `core/daemon` suite locally at a
superset of that tree and AC-009 **passed** both times.

**Why this is worse than an ordinary flaky test.** It is unreliable in *both* directions: it can
block a good publish (it did), and on a different roll it can pass a build with a genuinely broken
shutdown. A gate that is right two thirds of the time is not a gate; it is a toll.

**⚠️ IT IS NOW INSTRUMENTED, AND THAT WAS THE ACTUAL BLOCKER.** Neither lane could diagnose it because
both sides of the evidence were silent:
- The daemon's shutdown UPDATE logged **only on a thrown error**, so `changes` — which separates "the
  UPDATE ran and matched nothing" from "the shutdown never ran" — was on the result object and
  unread. Now logged as `rowsMarkedInterrupted`.
- The test accepted `code === null` (killed by the default action of a signal) as a **clean exit**,
  and discarded `signal` entirely. So "the handler never ran" and "the handler ran and reported
  success" arrived as the same silent resolve. `null` now rejects and names the signal.

**Do not chase it further until it fails again with those two facts in hand.** The next failure says
which world it is; guessing before then is what produced the previous diagnosis — a WAL snapshot
race, complete with a `wal_checkpoint(TRUNCATE)` fix, after which the test failed anyway.

- **POST-LAUNCH** because it is our evidence lane, not a customer's experience — but it is the FIRST
  thing to look at if a publish blocks again, and a green run is not evidence the underlying
  behaviour is sound.
- **Enforcer:** the next CI failure's own log. No new test until then.

---

### `DOD-M15-SCREENED-GAP-SEALED-1` — 🅿️ POST-LAUNCH BACKLOG. A screened message is lost permanently, and the receipt over the hole says nothing
**Reported by `Miss_Chelly_H` from live use 2026-08-24, corroborated by two independent hits the same
day (an 11-digit CI run id stopped a send from each lane). Verified in code before filing.**

**⚠️ THE MATCHER IS NOT THE DEFECT, AND I TOLD THE REPORTER OTHERWISE.** My first response was that
`pii:phone` false-positives on long digit strings and *"the fix is a matching rule"*. It is not:
`detect/pii.ts` records the overlap as a DELIBERATE decision, with its reasoning —

> *"Deliberately NOT excluded: bare 11-13 digit runs like a commit number or an epoch timestamp.
> Those overlap the legitimate phone range (a country-code number is 11 digits), and silently
> passing them would weaken the guard to fix an annoyance. They still warn, and that is the correct
> trade — **but it is why the operator escape hatch has to work.**"*

An 11-digit run id is genuinely indistinguishable from a country-code phone number. The detector is
right. **The file even names the real defect in its own last clause**, and that clause is the finding.

**What an operator actually lives through, in order:**

1. The agent sends a message containing a long digit run. The gateway flags `pii:phone` and holds it
   — WARN disposition, so it is not sent until the flag is resolved.
2. **The bridge swallows the refusal.** The operator is told nothing; from the outside the message
   simply never arrives.
3. **The agent cannot clear its own flag.** `allow_once` is gated on `autonomous_override`, which is
   off by default and settable *"only by a human at a terminal"* (`gateway-config-handlers.ts`:
   *"whether the agent may send a flagged value with no human present"*). An unattended agent is
   stuck by design.
4. The session reaches its idle timeout while waiting for that human.
5. **`sealed` is TERMINAL.** The bypass, when it arrives, meets a session that can no longer accept
   anything.
6. **The message is not delayed — it is permanently absent from a transcript that is then notarized
   as complete, and nothing in the receipt records that there is a hole in it.**

**Why this is worse than an ordinary usability bug, and why it is a TRUST-LAYER defect.** Every other
failure here degrades a convenience. This one issues a cryptographic attestation over a conversation
that is missing a message the sender believes they sent — and the certificate's whole value is that
it describes what was actually said. A gap the receipt cannot express is a receipt that is
confidently wrong.

**The three faults are separable and only the last is hard:**
- **The bridge hides the refusal.** It should surface `security.verdict.returned` to the operator.
  Smallest fix, largest share of the harm.
- **The escape hatch does not reach an unattended agent.** The file's own sentence — *"it is why the
  operator escape hatch has to work"* — is currently false for exactly the case that hits it.
- **A pending screen and an idle timer race, and the timer wins irreversibly.** A session with a held
  message should not be idle, or the seal should record that it closed over a held one.

**Classification.** POST-LAUNCH under the frozen gate, and **flagged for reclassification** — it is
the only line in this backlog where the failure produces a *wrong attestation* rather than a missing
one, which is the property the product exists to sell. It reached a live agent today, on Andre's
daily-use box, without anyone touching it.

- **Enforcer:** unit — a session holding a screened message must not seal silently; and journey — a
  flagged send surfaces to the operator rather than disappearing.

---

### `DOD-M15-HELD-AUTHORSHIP-1` — 🅿️ POST-LAUNCH BACKLOG. A held message loses its authorship proof across a restart
**Raised by review pass 2 on `DOD-M15-SEALWIRE-1` bullet 5 (finding H1). The in-memory half is
closed; this is the restart half.**

Bullet 5 stores our own signature on a sent transcript row so a third party can prove we wrote it.
A message held behind a canonical-sequence gap carries that proof in memory and keeps it on release —
that works. **`held_content` has no authorship columns**, so a held message that survives a daemon
restart comes back without one: its row records `self_authored` with no signature, indistinguishable
from a send the relay never witnessed.

**It cannot be reconstructed at release.** The signature covers Structure-1 bytes the new process does
not hold. **And it must not be fabricated** — a proof that cannot be checked, presented as one that
can, is worse than the absence, and is the exact failure the write-time verify was just added to
prevent on the live path.

**Announced rather than silent, now.** `session.content.released.authorship.lost` fires with the
sequence, the impact, and the reason it is unrecoverable. Only for entries that actually crossed a
restart: an in-memory held entry carries its proof, and an unwitnessed send legitimately has none, so
warning on every absent proof would fire on a designed benign state and bury the occurrence that
matters.

**The work:** two BLOB columns on `held_content` (`sender_pubkey`, `sender_sig`), carried through
`#persistHeldContent` / `#restoreHeldContent`. The table already has two `ALTER TABLE … ADD COLUMN`
migrations, so the pattern is in place.

**Why POST-LAUNCH, and why a log first.** It needs a message held behind a gap AND a restart before
release — narrow. And under a frozen gate the asymmetry decides it: **a log is additive and
tightenable on evidence; a schema change is neither.** The loss is visible immediately either way.

- **Enforcer:** unit — a held sent entry persisted and restored must either carry its proof or emit
  the loss event; never release silently with `self_authored` and no signature.

---

### `DOD-M15-SCREENER-FALSEPOS-1` — 🅿️ POST-LAUNCH BACKLOG. The screener edits technical messages between agents, and it is our own use case

**Observed 2026-08-24 live, in both directions of a working session between `CELLO_Coder_1` and
`CELLO_Support`** — not from a test, from the actual product being used for the thing it is for.

**What happened, in the order a user would see it.** One agent sends the other a message about a
TypeScript signature. The message arrives with a word replaced:

> `authorship: [REDACTED:generic-api-key] | undefined`

The redacted token was the **type name `SentAuthorship`**. Nothing about it is a credential; it is
CamelCase and long enough to trip a generic-entropy rule. In the return direction a second stage
fired and reported *"stripped 1 invisible/smuggled codepoint(s) on egress"* on a message whose only
unusual characters were emoji. **Unconfirmed, and stated as unconfirmed:** the likeliest candidate is
the variation selector `U+FE0F` inside `⚠️`, which would mean any message carrying a warning emoji is
altered. It has not been isolated and should not be written up as fact until it is.

**Why this is not "working as intended", and why it is also not urgent.**

- **Not silent.** The replacement is labelled in the delivered text and the sender is told through
  `transformations` on the send result. Nobody is deceived, which is the difference between this and
  a real integrity defect, and it is the reason this sits post-launch rather than in the gate.
- **But the target audience is exactly the false-positive population.** The first wedge is a
  developer connecting their own agents, and the traffic is source identifiers, type names, hashes
  and hex. A rule tuned for `sk-…` keys firing on `SentAuthorship` will fire constantly on the
  content our earliest users actually send. The failure is not one mangled word; it is an operator
  learning that the product edits their messages and routing around it.
- **The stripping case is the worse half if confirmed**, because a removed codepoint leaves no
  marker in the text at all — only a line in the send result that most callers never read back.

**What would settle it, cheaply:** send a message containing a lone `U+FE0F` and one containing a
bare CamelCase identifier, and read `transformations`. Two sends, no code. Deliberately not done
here — it costs a live session with the other lane mid-work, and nothing downstream is blocked on the
answer.

**⚠️ ONE FREE DATA POINT ARRIVED WITHOUT RUNNING THAT EXPERIMENT, and it narrows the hypothesis.** A
later message in the same session carried **eight CamelCase identifiers** (`ownAdoption`, `ownSalt`,
`onPeerSaltFrame`, `#hashedWithoutSalt`, `#hashedWithSalt`, `#saltAdoptionClosed`, `frontier_unreadable`,
`hmac-salt-v1`) and **no emoji at all** — and came back `"modified": false`, with no transformation of
any kind. So **CamelCase alone does not trip it**, which removes the simplest explanation and leaves
two live candidates: an entropy threshold that only long tokens like `SentAuthorship` cross, or a rule
keyed on something else in that message entirely. **The `U+FE0F` hypothesis for the stripping case is
untouched by this** — it remains unconfirmed, and this observation neither supports nor refutes it,
because the message that produced it contained no emoji to strip.

Recorded because it was free. It does **not** replace the two-send experiment, and reporting a
narrowed hypothesis as a diagnosis is the failure this file keeps naming.

**⚠️ THIRD INSTANCE, 2026-08-24, AND IT IS THE ONE THAT MATTERS — A SEND WAS BLOCKED OUTRIGHT.** A
message to the other lane about a database port was **held, not redacted**: `pii:ip`, `disposition:
warn`, because the body contained the **loopback address**. That is not personal data under any
reading — it is the address every local service in this project binds to.

**The three instances are now a pattern with one shape:** a **type name** classified as a generic API
key, an **invisible codepoint** stripped on egress, and **localhost** classified as someone's personal
IP. All three are text that two engineering agents exchange constantly, and the third **stopped the
conversation** rather than quietly editing it.

**THE GUARD'S REFUSAL TO LET ME CLEAR IT IS CORRECT AND MUST NOT BE "FIXED".** `autonomous_override`
is OFF, so the agent cannot resolve its own flag; the tool's guidance names the `cello config`
commands and says to relay them to the operator rather than run them. **I did not run them.** An
agent clearing its own security flags is exactly what the flag exists to prevent, and an escape hatch
an agent can reach is not a guard — the same sentence as `RELAYONLY-1`'s *"a control that depends on
the other side honouring it is not a control."* The block was resolved by removing the literal from
the message, which is the honest path.

**So the finding is calibration, not architecture, and the two must not be conflated.** The design is
right. The rules are tuned for a general chat product and our first wedge is a developer connecting
their own agents, where identifiers, hex and local addresses ARE the payload. **Andre's call**, and
the options are narrow: exempt code-shaped content, lower confidence on entropy-only and
private/loopback-range matches, or keep firing and accept the friction. **Raised in severity from the
original filing** — a papercut that edits a message is forgivable; one that blocks it is the product
failing at the thing it is for.

**Andre's call, and it is a product decision rather than a bug fix:** whether the screener should
exempt code-shaped content, lower its confidence on entropy-only matches, or keep firing and simply
be quieter about it. **Recorded rather than actioned** — an outward-facing behaviour change to what
counterparties receive is not a lane decision.
