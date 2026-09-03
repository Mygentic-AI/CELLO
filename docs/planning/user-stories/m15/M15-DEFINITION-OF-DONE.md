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
> _(trail moved to [[M15-BUILD-JOURNAL]] — see “DoD trails, moved 2026-08-24”.)_
 `participant_a/b.multiaddrs` is always empty and read by nobody
Found by the `DOD-M15-SURFACE-1` review. Not a break — it is the reverse of one.
- Since the directory-facing node stopped listening, this wire field is **permanently `[]`** on
  every session assignment. The directory stores it, **signs nothing over it** (neither the session
  nor the relay TBS includes it — verified), and the client parses it and drops it: the only read of
  a parsed assignment's participants takes `.pubkey`.
- **It is also a checked-then-ignored:** the client's parser will reject an entire session assignment
  if this array is malformed — for a value nothing ever reads.
- **Why it is its own line:** removing a wire field is a bilateral change across both repos, and
  under Decision 2's reasoning a schema change is cheapest now. Leaving it costs nothing at runtime
  and costs a reader the assumption that something acts on it.
- Sequence with any other wire change so the two repos move once, not twice.

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
> _(trail moved to [[M15-BUILD-JOURNAL]] — see “DoD trails, moved 2026-08-24”.)_

> _(trail moved to [[M15-BUILD-JOURNAL]] — see “DoD trails, moved 2026-08-24”.)_

#### ✅ 2 OF 5 FIXED, AND THE OTHER THREE HAVE A DIFFERENT CAUSE — measured, not assumed
> _(trail moved to [[M15-BUILD-JOURNAL]] — see “DoD trails, moved 2026-08-24”.)_

#### 🔎 RUN IN ISOLATION 2026-08-24: 5 failed / 5 passed — and it is NOT a short timeout
> _(trail moved to [[M15-BUILD-JOURNAL]] — see “DoD trails, moved 2026-08-24”.)_
## ✅ TRIAGE UNIT DONE — reviewed, findings fixed, verdict quoted

> **Review pass 1, on the code changes.** Verdict on the thing this unit was most at risk of, quoted:
> > *"Directly on the thing you were most worried about: **no assertion in `j-spine` was weakened**.
> > Four were corrected to values the product actually emits, one (`current` → `online` + `selected`)
> > is measurably stronger, and the deleted one was provably content-free with its replacement guard
> > living in cello-client."*
>
> And it did not take the numbers on trust: *"**j-spine is 7/7 — VERIFIED INDEPENDENTLY.** I ran it:
> 7 passed / 0 failed, 91s, exit 0."*
>
> Lens lines: **SPEC: DEVIATIONS FOUND** (the causes table) · **NO SILENT FALLBACKS** in the diff ·
> **ERRORS NAME THEIR CAUSE** · **HOLLOW TESTS FOUND** — `j-suspend-tofn` [blocking] ·
> **REMOVALS PROVEN**.
>
> **All findings fixed and re-run** (`HIGH-1` fourth case + participation control, `HIGH-2` assertion
> ordering, `MEDIUM-3` scoping/windowing, `LOW-5` symbol name, `SPEC` table arithmetic). The reviewer's
> own summary of where the weakness actually was: *"The weakening, such as it is, is in
> `j-suspend-tofn` — not in the assertions, but in the diagnostic that now stands in front of them."*
> That diagnostic no longer stands in front of them.
>
> **🅿️ ONE PRODUCT FINDING FILED FROM THIS REVIEW — `DOD-M15-START-AGENT-UNAWAITED-1`.**
> `daemon.ts:2703` does `void sessionNodeManager.ensureStandingReceiverForAgent(name)` and returns
> `ok: true` **before the receiver exists**; a permanent failure only produces a `warn`. **The operator
> is told the agent started, and the agent is deaf.** That is the product-side cause of the race the
> `DOD-SPINE-5` readiness poll works around on the test side, and the surface already carries
> `standing_receiver_ready` to hang a truthful answer on.
>
> **🔵 THE LINE IS NOT DONE — the triage UNIT is.** Remaining, updated 2026-08-24:
> - 🔴 the salt-announce defect (`j-documents` 7 + `j-stale-session` 1) — **blocked on Andre's design
>   decision**: salt agreement is a DIRECT-path protocol and documents are relay-only, so a document
>   session never agrees a salt. Three options are filed for him; this is not a coding choice.
> - 🟡 the four `j-multiplayer` timeouts — cause named (`DOD-M15-DOCACCEPT-UNBOUNDED-1`), bound awaiting
>   Andre.
> - ~~the four `j-content` deposit-side hash sites~~ **✅ CLOSED — `j-content` is 10/10.** And the
>   framing was wrong: they were not four instances of one hash defect, they were four separate ones.
> - ~~`j-end`'s trust-signal misclassification~~ **✅ CLOSED — `j-end` is 10/10.**

## ✅ TRIAGE COMPLETE 2026-08-24 — every journey file measured, 49 failures resolve to SIX causes

**This is the unit the line asked for** (*"First unit is a triage: cluster the 49 by cause… do NOT open
21 lines from this"*). Every one of the 36 spine files has now been run. **The lane is not half-red.**

| cause | failures | status |
|---|---|---|
| **CLI banner glued into JSON** (`j-refresh`, `j-sign`, `j-tofn-dkg`×2, `j-tofn`, `j-relaysig`) | 6 | ✅ **all green** |
| **Stale assertions in `j-spine`** — state vocabulary the product removed, plus one local race | 5 | ✅ **all green, fixed here** |
| ~~**Salt-split / no agreement** (`j-documents` 7, `j-stale-session` 1)~~ | 8 | ⬇️ **OUT OF GATE** (documents ruling, Decision #16). Real and unfixed; the salt design decision filed for Andre is retired with it. **Not passing — out of scope.** |
| ~~**Tests compute the UNSALTED hash** (`j-content` 5)~~ **✅ `j-content` 10/10 — and this cause label was wrong** | 5 | ✅ **all green.** Not one cause with five instances: **four separate defects** — an unsigned deposit shape SEC-1 refuses, a deposit of the wrong STRING (`[[OVER]]` is in-band), a retired event name (`ingest_failed` → `annexed`), and a wait latching onto the first of several recover sweeps |
| **Portal database** (`ECONNREFUSED`) | 2 | ✅ container up |
| **Named lines already owned** (`j-unilateral`×2, `j-upgrade-bilateral` → `UNILATERAL-NOTARIZE-1`) | 3 | 🅿️ owned elsewhere |
| **Individually-caused** (~~`j-end` 1~~ **✅ 10/10**, `j-remove` 1 → post-launch, ~~`j-multiplayer` 4~~ ⬇️ **out of gate**) | 6 | `j-multiplayer`'s four are all document operations (`DOCACCEPT-UNBOUNDED-1`), so they leave with Decision #16 |

> **⚠️ AFTER DECISION #16, THIS LANE'S REMAINING IN-GATE FAILURE IS `j-suspend-tofn` — THE KILL SWITCH — ALONE.**
> Every other red row above is now green, out of gate, or already post-launch. **Do not read that as the
> document journeys passing:** they are unfixed and out of scope, which is a different statement.

> ### ⬇️ OUT OF GATE (Andre 2026-08-24, documents ruling) · was 🟡 `DOD-M15-DOCACCEPT-UNBOUNDED-1` — ACCEPTING A DOCUMENT HANGS IF ONE HOLDER IS UNREACHABLE
>
> **🟡 = the hang is now VISIBLE and covered by a test; the hang itself is still there.** Bounding the
> per-holder send changes behaviour and needs Andre's call (below). Naming the stall does not, and is
> shipped, reviewed, and tested.
>
> **↩️ AND THE MEASUREMENT TAKEN FOR THE LOG LINE ALSO UNBLOCKS THE DECISION IT WAS FILED BEHIND.**
> This entry said picking a bound was *"a genuine product judgement"* because the cost ran both ways —
> too short falsely marks holders un-notified, too long leaves the hang — **and nobody had a number for
> what a healthy open costs.** There is one now, from 74 real cold opens in a 150 MB daemon log:
> **p50 12.9 s, p90 25.1 s, min 3.6 s.** That converts the open question from a guess into an
> arithmetic one, and it kills the obvious candidate outright: any bound at or below ~25 s would mark a
> **normal** holder un-notified one time in ten. The 60 s `RECONCILE_INFLIGHT_BOUND_MS` is still wrong
> for the opposite reason already recorded — 60 s per holder, sequentially, outlives the client's own
> 60 s timeout, so the hang survives the fix. **Still Andre's call, but now a call between numbers.**
>
> **Found by instrumenting the harness to name the hanging call — it answered on the first run.** The
> MCP SDK's timeout says only `MCP error -32001: Request timed out`: no tool, no arguments, no elapsed
> time. With the name attached, every timeout in `j-multiplayer` is the **same call**, while the
> failing TEST SET keeps reshuffling (5/2, then 4/3, then 3/4):
>
> ```
> MCP tool "cello_doc_accept" failed after 60000ms
> MCP tool "cello_doc_accept" failed after 60001ms
> MCP tool "cello_doc_accept" failed after 60002ms
> ```
>
> **The chain, every link read:**
> `cello_doc_accept` (`document-handlers.ts:589`) → `authorConsent` (`:814`) → `fanOutAmendment`
> (`:759`) → **`for (const holder of args.holders)` with `await deps.transportFor(...).sendBytes(...)`
> inside the loop** (`:769-771`) → `acquireSession` (`document-delivery-transport.ts:255`) →
> `deps.openSession(...)` — *"the same path `cello_initiate_session` takes"*.
>
> **There is no timeout anywhere in that chain.** The fan-out is **sequential** and each hop opens a
> session to that holder. **One holder who cannot be reached blocks the entire accept**, and the
> operator's client gives up at 60 s having been told nothing.
>
> **⚠️ AND THE PRODUCT'S OWN TEST NAMES THE INVARIANT THIS BREAKS.** One of the failing tests is
> literally *"NUDGE + SURFACE: **an absent holder blocks nobody**"*. An absent holder blocks everybody.
>
> **THE FIX IS SMALL, BECAUSE THE "NOT NOTIFIED" PATH ALREADY EXISTS.** `fanOutAmendment` already
> handles a holder it could not reach — `told[holder] = false` plus a named
> `document.amendment.holder_unnotified` warn, added precisely so *"a lost membership change"* is not
> just a boolean inside an `ok: true`. **A timeout on the per-holder send would feed that existing
> path** rather than needing a new one. Bounding it is the minimum change that makes the code do what
> its own log line already claims.
>
> **🅿️ THE BOUND IS FILED, NOT BUILT — and I checked that this is not decision theatre.**
> The document layer's only existing bound is `RECONCILE_INFLIGHT_BOUND_MS = 60_000`, and its own doc
> says what it is for: *"how long one attempt may hold the in-flight mark before the sweep stops
> honoring it"* — a **background sweep**. Reusing it here does not work: 60 s per holder, with two
> holders, is longer than the client's own 60 s timeout, so the hang survives the "fix". **An
> interactive accept needs a bound the background path has no opinion about**, and picking one has a
> real cost in both directions — too short falsely marks holders un-notified, which is a
> membership-change correctness problem, and too long leaves the hang. **That is a genuine product
> judgement, so filing it is correct rather than deferral.**
>
> **✅ WHAT IS *NOT* A JUDGEMENT, AND IS BUILT: THE SILENCE.** Right now the daemon logs **nothing**
> while it blocks — invariant 2 says a failure is loud in the log *and* the agent response, and this
> is loud in neither. A warn emitted **while the send is still outstanding** names the holder being
> waited on, changes no behaviour, and turns an invisible hang into a diagnosable one. Shipped under
> the freeze on that basis: observability, not behaviour.
>
> **✅ AC — COVERED. And the reason I twice said it could not be is a correction, not a footnote.**
>
> I recorded here that the warn was untestable without `JOIN-1`'s three-party setup, on the strength of
> a measurement: my instrumented run printed **`sends attempted: []`**, so I concluded a plain
> proposal-accept *"fans out to nobody"* and only the admin-invites-a-third-party path reaches
> `fanOutAmendment`. **That measurement was wrong, and review disproved it by running the path**: a
> bilateral accept DOES fan out, with `verb: "consent"`. My instrument was reading the wrong thing;
> I then reasoned from it as if it were ground truth and wrote a blocking dependency into this DoD on
> that basis. The lesson worth keeping is not "I mis-measured" — it is that **a null result from my own
> instrument got promoted to a fact about the product without anyone running the path.**
>
> The test exists now, on the two-party fixture, with no `JOIN-1` dependency: bilateral proposal →
> `holderStopsAnswering()` → `cello_doc_accept` → wait for `holder_opening` → assert `holder_unanswered`
> has **not** fired yet → release → assert `holder_settled` carries a real elapsed time. **75/75 in
> `document-handlers.test.ts`.** Mutation-checked rather than assumed green: pushing
> `HOLDER_OPENING_INFO_MS` out to `999_000` reddens it with
> `expected [ Array(4) ] to include 'document.amendment.holder_opening'`.
>
> The harness knob shipped as designed — a `sendHangs` beside the existing `sendFails`, defaulting to
> `undefined` so nothing existing changes.
>
> **User-visible today:** you accept an invitation to a shared document and it hangs for a minute,
> because someone else in the document happens to be offline.
>
> #### 🔎 AND THE FAILING SET **CHANGES BETWEEN RUNS** — so no product cause can be attributed yet
> Run in isolation 2026-08-24: **5 failed / 2 passed**, against **4 failed / 3 passed** in the batch.
> **`GOVERN + JOIN` failed in the batch and PASSES alone; `END: closes are ENTRIES` passed in the batch
> and FAILS alone.** Same file, same build, different victims.
>
> Every failure in both runs is the same signature — `MCP error -32001: Request timed out` at
> **70003–70287 ms**, the MCP SDK's own request timeout (`protocol.ts` `Timeout.timeoutHandler`). **A
> tool call is never answered at all**: not refused, not errored — no reply.
>
> **⚠️ WHAT THIS RULES OUT, AND IT IS THE USEFUL HALF.** A defect that hangs a specific operation would
> hang the SAME test every time. **A failing set that reshuffles is shared state or resource
> contention**, not a deterministic product fault in any one of those operations. So the tempting
> write-up — *"the removed-holder path never replies"* — is not supportable, and would have sent the
> next reader into the document gate for a fault that is not there.
>
> **What is established:** an MCP tool call goes unanswered for 70 s, in a three-daemon journey, on a
> rotating subset of tests. **Not diagnosed further** (§0z.2): the next step is which call, captured
> per-run rather than inferred — and the instrument must survive a run where the victim moves.
>
> #### 🔎 `j-multiplayer`'s FOUR TIMEOUTS ARE **NOT** THE SALT CAUSE — checked before assuming
> All four are `MCP error -32001: Request timed out` at ~70s, on document operations: *GOVERN + JOIN*,
> *REMOVE while OFFLINE*, *NUDGE + SURFACE*, *REMOVE surfaces to the removed holder*. The obvious move
> is to fold them into the document salt outage, since `j-multiplayer` is also a document journey.
> **The same run refutes it:** `session.salt.agreed` × **10** and `content_hash_salt_unavailable` × **0**.
> Salts agreed and nothing was refused. **Whatever stalls those four, it is not the salt.**
>
> Recorded because folding them in would have been free, plausible, and wrong — the third time on this
> line that a confirmed cause invited an unchecked extension. Uninvestigated beyond this.
| **Green all along** (`j-upgrade`, `j-loopback`, `j-persist`, `j-canary`, `j-legibility`, `j-trust`, `j-tofn`…) | — | ✅ |
| **`j-suspend-tofn` — the kill switch** | 1 | 🔴 **highest-stakes in the lane** (below) |

> ### ⚠️ THE ARITHMETIC ABOVE DOES NOT RECONSTRUCT 49, AND SAYING SO IS THE POINT — review SPEC finding
> The rows sum to **36 of the receipt's 49**. The remainder are failures inside files whose headline
> cause is listed but whose per-test count I did not itemise (`j-multiplayer`'s 7-of-7, `j-content`'s
> full set at the time of the receipt, `j-documents` before it was measured).
>
> **My first version of this table omitted `j-suspend-tofn` entirely** — the kill-switch failure, the
> highest-stakes item in the lane — and summed to 35 while claiming to account for 49. A summary that
> silently drops the most important row is the same defect this milestone keeps finding, in the
> bookkeeping instead of the code. **The count is now stated as partial rather than implied complete.**

**Files now measured green that the receipt lists red:** `j-spine` 7/7, `j-tofn` 4/4, `j-relaysig` 1/1,
`j-upgrade`, `j-loopback`, `j-trust` 1/1, **`j-end` 10/10**, **`j-content` 10/10**, and `j-remove` 2/3.
*(`j-end` was 9/10 when this line was written; the tenth is fixed — see the corrected entry below.)*

### 🔎 TWO INDIVIDUALLY-CAUSED FINDINGS, filed not fixed (freeze: nothing new enters the gate)

**`DOD-M15-REVOKED-READS-OFFLINE-1` — a REVOKED agent is reported as merely offline.**
> **⚠️ SECOND COPY — classified POST-LAUNCH; the owning entry is in the POST-LAUNCH BACKLOG below.**
> Only that copy carries a classification, so this one reads as in-gate. It is not.
`j-remove`: *"the directory must refuse a revoked target with `agent_revoked`: expected
`counterparty_offline` to be `agent_revoked`"*. The directory's revoked gate is correct and correctly
ordered — but **the client never reaches it.** It runs a discovery lookup first, and
`classifyOnlineResult` accepts only `"online" | "offline" | "unknown_agent"` — **there is no revoked
state on that path**, so a revoked agent classifies as offline and the session request is never sent.
**The operator is told:** *"The counterparty exists but is not currently online. Have its operator
bring it online, then retry."* — and goes to chase a counterparty who can never come back. That is
error substitution of the exact shape `DOD-M15-ERRSTRING-1` fixed twelve lines below it in the same
file. **Fix is a wire question** (discovery must be able to say revoked), which is why it is filed.

**~~`j-end`~~ ✅ FIXED — and "a trust signal misclassified" was the wrong reading.**
The test was *"Bob's genuine third-party endorsement must NOT be flagged as same-operator"*, and it
was filed here as an uninvestigated product misclassification. **The product was right; the fixture
was incomplete.** The same-operator check (D-29) is a **disjunction** — it fires on an account match
**OR** a phone-stub match — and the fixture seeded neither linkage table for Bob, so the endorsement
could not be evaluated against the thing that distinguishes a third party from the same operator.
The fixture now upserts `agent_account_links` (V59, keyed on the stable `agent_id`), and both
assertions check the linkage across **account and phone stub** rather than one of the two.
**`j-end` is 10/10.**

**Worth keeping:** "not investigated" was accurate when written, but the note framed it as a
suspected product defect. A single failing assertion about a security classification is exactly the
kind of thing that should not sit in a DoD wearing a product-defect label until someone has looked —
a reader deciding what to work on would have picked it up as a trust bug.

### 🔎 `j-stale-session` — FRAMES ARRIVE AND NONE ARE INGESTED, after the peer's daemon restarts

Its single failure reads *"B never converged at all within five minutes"*, and **the test's own
diagnostic already contains the answer** — it prints it and nobody read it:

```
STALE-SESSION A: sent=4 parked=2 reconcileInitiated=3 sweepFailed=1
           || B(after restart): framesReceived=3 inbound=0
```

**B received three document frames and ingested none.** That is a clean producer/consumer split, and
it is not the salt cause: a refused frame never reaches `session.document.received` at all, and these
did. Across the run the session layer classifies frames by kind perfectly well —
`reconcile` × 10, `proposal` × 6, `proposal_ack` × 4, `amendment` × 2 — so **routing works; the
handoff into the document layer's inbound path is what produces nothing.**

**Established:** frames arrive at B, are classified, and yield zero `document.inbound.*`. **Not
established:** why.

> **⛔ THE "NEXT THREAD TO PULL" NAMED HERE WAS A DEAD END — fixed at the source 2026-08-24.**
> `routeSync` structurally cannot set `ok`/`reason` (it dispatches via `void this.#enqueue`), so their
> absence was never evidence of a routing fault. Both declarations are narrowed — reading either is now
> a compile error — and the line names `document.frame.refused` as the event carrying the verdict.
> **The real question is unchanged:** three frames queued, none ingested. Check for
> `document.frame.refused` on the same `correlationId`; absent means the dispatch never ran, which is a
> different fault. Trail → [[M15-BUILD-JOURNAL]].

**Not diagnosed further** (§0z.2). The user-visible shape, if it holds: your counterparty restarts,
and from then on your document changes reach their machine and are silently discarded.

### ✅ `DOD-M15-SALTANNOUNCE-LATE-1` — DONE. Reviewed, one HIGH regression of mine found and fixed.
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-SALTANNOUNCE-LATE-1`.

### ✅ `j-end` IS GREEN — 10/10. A closed line already held the answer, and review found its twin.
> **Closed.** Full entry is in [[M15-DEFINITION-OF-DONE-ARCHIVE]].

### ✅ `j-spine` IS GREEN — 7/7, from 4/7. Five failures fixed; four were stale vocabulary.
> **Closed.** Full entry is in [[M15-DEFINITION-OF-DONE-ARCHIVE]].

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
Split from `DOD-M15-DIVERGE-1` on review — that clause covered three producers and only the proven
one could ship safely. **Neither of these is visible to `sealReadiness` today.**
- **(a) An unwitnessed RECEIVED append.** `ingestReceivedContent`: a relay is attached, no witness
  bound the hash, the content is logged at WARN (`session.content.unwitnessed`) and **ingested
  anyway.** This is the direction an injected leaf appears in, so it is where `DOD-M15-FRAME-1`'s
  attack lands. **Gating on it today would be a false positive** — both peers hold the leaf, so leaf
  counts still agree. The useful work is separating "the relay has not witnessed it *yet*" from "it
  never will", which needs a fixture that can attach a relay client.
- **(b) An unwitnessed OWN send** — `assignedSeq === undefined`, the relay-degraded append. **Found
  by the review; not in the original record.** It sets no flag, emits no ERROR, and reads ready —
  while `placeOwnLeaf`'s own comment says *"the seal was already lost at the unwitnessed append, not
  here."* **So the gate fires one send later than the code says the damage happens.**
- **Do not gate either on suspicion alone.** The bar is a signal separating a relay catching up from
  a leaf it will never carry.
- **⚠️ `8c58cc0` — (b)'s commit — does not typecheck on its own.** Found by `CELLO_Coder_1`'s
  reviewer, not by me. `submitLeaf` takes four parameters at that commit and
  `session-node-manager.ts:6349` passes five; the two halves landed in different commits because we
  were both editing that file. **Nothing to revert and the end state is right** — but `git bisect`
  across that range will not build, so anyone bisecting a later seal defect hits a compile error and
  will read it as the bug. Recorded rather than rewritten: rewriting published history to fix a
  bisect point costs more than the note.
- **The collision is why `session-node-manager.ts` now has ONE owner.** Both lanes commit by explicit
  path, which is correct and did nothing here — explicit paths do not separate two agents editing the
  same file. Settled with `CELLO_Coder_1` over CELLO: that file is theirs outright,
  `close-session-handler.ts` is mine, and neither of us announces.

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
> **Closed 2026-09-01** (`002-RELAY`, with its third work item completed by `008-RELAY`). Two review
> passes; pass 2 refused the merge on a gate that denied the LEGITIMATE first dial.
>
> ✅ **PROVEN ADVERSARIALLY AGAINST PRODUCTION, 2026-09-02.** A stranger with a fresh keypair, holding
> a REAL circuit address of a real reservation holder, tried to dial through it. It **reached the
> relay** (so the refusal is not a network failure) and the dial returned
> `failed to connect via relay with status PERMISSION_DENIED`. The relay's own record:
> `relay.circuit.dial_denied`, `reason: no_session_assignment_names_both_peers`,
> `destinationBindingCount: 0`. Both ends agree, and the reason is the specific one the gater emits —
> this line's claim that "a circuit address is not dialable by whoever learns it" is now measured.
> → Entry C10. Full entry —
> verdicts, findings and what the fixes cost — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under
> `DOD-M15-RELAYAUTH-1`. → Entry S15.

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
> **Closed 2026-09-02** (`011-ALERT`). Both policies are in Terraform and applied — sustained CPU
> and memory — routed to the Telegram channel that already carries infra alerts. **Every metric was
> confirmed ARRIVING before its policy was written**, which was the order's loudest instruction: CPU
> returned 58 live directory series; `cello.node.memory` turned out to be **a log line, not a
> metric**, so it is a log-based metric over the stream that already exists, and its filter was run
> verbatim against Cloud Logging first.
>
> **The review's best finding is why this line is worth its tag:** a dead directory process silenced
> BOTH alerts — the failure the line exists to catch was the one case it could not report. Fixed
> with `evaluation_missing_data = ACTIVE` on the memory condition, applied and verified live.
> → journal.

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
`DOD-END-SUBMIT-1`'s handed-forward AC. Previously triaged ship-without; **in scope under the basic-
value criterion** — "mint a trust signal and have it received" is advertised value.
- Submission fails over to another node rather than failing and requiring the operator to re-run the
  command. The consortium has three.
- **Verify at the same time** whether the refuse-op drain gap closed when `cello-portal-ingress-drain`
  shipped; nobody has checked since.
- **Enforcer:** journey.

> **Closed 2026-09-02** by micro work order `010-SIGNAL`. A send that reached no node is held and
> re-sent on the SignalingManager's reconnect — the ruled failover — with the operator told it is
> held rather than shown a bare failure; a refusal on the merits is never retried. Drain gap:
> **closed**, verified at `submission-ingress.ts`'s `op === "refuse"` dispatch ahead of the mint
> path. Reviewer found 9, all fixed; 7 mutations caught, 2 survived first and were fixed.
> Full record → `micro/010-SIGNAL-trust-signal-retry.md`.
> **Journey enforcer with a node down is NOT run** — this unit is unit- and live-daemon-tested only.

> _(trail moved to [[M15-BUILD-JOURNAL]] — see “DoD trails, moved 2026-08-24”.)_

### `DOD-M15-PARKCOLLECT-1` — ✅ A parked message can actually be collected

> **Live check 2026-09-02: parked and collected.** Harness artifact — the test fabricated a session
> the directory never brokered, which the vouching gate correctly refuses. Test rewritten to a real
> send; `packages/relay/` untouched. → `micro/018-PARKCOLLECT-a-parked-message-can-be-collected.md`
> (Review section carries the run, the three-layer mutation chain, and the reviewer's verdict).
**Found by the full-lane run 2026-09-02 (`j-content` DOD-MSG-3). NEW — this test PASSED in the
2026-08-23 baseline**, so something between then and now broke it. **BLOCKS LAUNCH**: this is the
offline path, and the offline path is most of what "two agents connect and communicate" means when
you control only one of them.

**What the operator lives through, in order:**
1. They message someone whose agent is offline.
2. The relay accepts it. Their side reports it **parked — a success.**
3. The recipient comes online and goes to collect it.
4. **The relay refuses to hand it over** — `relay_refused_pull:not_a_participant`.
5. The message sits on the relay. Nobody can get it. **The sender was told it worked.**

- **A silent one-way drop, and the sender is the one who cannot tell.** That is the shape this
  milestone exists to remove — worse than a failure, because nothing prompts anyone to look.
- **The relay's own guidance is a dead end here.** It tells the recipient to establish a session and
  retry — but the message they are missing is the thing that would have told them to.
- **Established, not guessed:** the refusal is the vouching gate — the relay only serves agents named
  by a session assignment it has recorded. **What is NOT established is why the recipient is not
  vouched at collection time**, and that is the unit's first job. Do not assume it is the restart
  case: the durable store added under `RELAYAUTH-1` review H2 is real and wired in production.
- **⚠️ Spine red is not proof of a live break.** Live behaviour has diverged from this lane before.
  **First step is one real send to an offline agent and one collection** — minutes, and it decides
  whether this is a product defect or a harness artifact. Record which.
- **Enforcer:** journey — `j-content` DOD-MSG-3 green, plus the live check above.

### `DOD-M15-PARKERROR-1` — ✅ A failed park deposit says what went wrong
> **CLOSED 2026-09-03 (`019-PARKERROR`). The enforcer is met: "a failing deposit names its cause in
> the response and in the log."** It does — the response carries the extracted cause, and a new
> `daemon.ipc.request.failed` log line carries it with the structured `reason` beside it.
> Reviewer: `cello-unit-reviewer` on `9a1408a`, one blocking finding (MEDIUM-3, the log dropped
> `reason`) fixed in `f69a47d` and pinned by a mutation-proven assertion.
>
> **This line was briefly left ❌ after the work shipped, which was a bookkeeping error, not a
> judgement.** What the fixed reporting REVEALED is a different defect with its own line below
> (`DOD-M15-PARKCONN-1`) — a new finding does not keep its discoverer's line open.
>
> **The text below describes the state BEFORE the unit** and is kept for the trail. The daemon's
> IPC error path
> no longer flattens a thrown object: `extractErrorMessage` moved to its own module and all three
> `String(err)` sites in `ipc-server.ts` now use it, so a failing call names its cause in the
> response **and** in the log. That was daemon-wide, not park-specific — every IPC method inherited
> the bug.
>
> **What the error turned out to be, read for the first time:** `content_park_deposit` throws
> `No open connection to peer <relay>` — a plain object, not an `Error`, thrown by the transport's
> `openStream`, which is why it flattened. **Two things remain, and they are not the same thing:**
> (a) the deposit path *throws* where its siblings *return* `{ ok: false, reason }`, so an ordinary
> "the relay is not connected right now" reaches the operator as *"An unexpected error occurred"*;
> (b) **why there is no open connection at deposit time is UNREAD** — an investigation was opened by
> Andre on 2026-09-03, including why it reproduces about 1 run in 3.
>
> **The classification question below is still open and still Andre's**, now with a measured rate to
> weigh: intermittent, ~1 in 3, in a harness — not measured against the live fleet.
> **`DOD-MSG-7` is NOT this line.** `019` predicted MSG-5 and MSG-7 shared this cause; they do not.
> MSG-7 fails on `content_park_recover` returning `ok: false`, undiagnosed and unowned.

**Found by the same run (`j-content` DOD-MSG-5 / MSG-7). Red in the 2026-08-23 baseline too**, so
this is long-standing rather than new — it was simply never inside `JCONTENT-DELIVERY-1`'s four.

`content_park_deposit` returns `internal_error` with the message **`"[object Object]"`**. An object
was stringified where a reason belonged, so the cause is destroyed at the point of reporting.

- **What the operator gets:** *"An unexpected error occurred. Check daemon logs for details."* The
  detail is not in the logs either — it went into the same `[object Object]`. **There is no path
  from the error to the cause**, which is this milestone's own named defect class arriving through
  a formatting bug rather than a missing check.
- **The consequence is not just diagnostics:** a send to an offline counterparty fails, and neither
  the operator nor the person debugging it can find out why.
- **Fix the reporting first, then find out what it was hiding.** The underlying failure has never
  been read by anyone; it may be small or may be another finding.
- **⚠️ CLASSIFICATION IS ANDRE'S and this is the one to look at.** It sits in the gate under
  §0z.1's "unclear ⇒ blocks", not because a case has been made that it is unforgivable. The argument
  for moving it: the send FAILS, so nobody is misled about delivery — unlike `PARKCOLLECT-1`. The
  argument for keeping it: it is on the same offline path, and while it stands, any other defect
  there is undiagnosable.
- **Enforcer:** unit — a failing deposit names its cause in the response and in the log.

### `DOD-M15-PARKCONN-1` — ❌ A message to an offline counterparty does not intermittently fail
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
- **Rate: intermittent, ~1 run in 3, in the spine harness.** Not measured against the live fleet.
  **Investigation opened by Andre 2026-09-03**, including why it reproduces sometimes and not
  others.
- **⚠️ CLASSIFICATION IS ANDRE'S** (§0z.4). It is on the advertised journey — a message to an
  offline counterparty is precisely what park exists for — but the real-world rate is unmeasured,
  which is what the investigation is for. It sits in the gate meanwhile under "unclear ⇒ blocks".
- **NOT the same as `DOD-MSG-7`.** `019` predicted MSG-5 and MSG-7 shared this cause; they do not.
  MSG-7 fails on `content_park_recover` returning `ok: false` — undiagnosed, unowned, and not this
  line.
- **Enforcer:** journey — `j-content` DOD-MSG-5 green across three consecutive runs, plus a named
  reason on the response when the relay genuinely is unreachable.

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

### `DOD-M15-HEARTBEAT-1` — ❌ Directory nodes can see each other's heartbeats
> **BUILD IT — ruled by Andre 2026-09-03, on the migration argument.** *"Anything that's going to
> change the tables in the directories I'd rather build now, because we don't want to invalidate or
> do a whole lot of backward-compatibility work once we have users."* Same reasoning Tier 4 was
> ruled in on: a schema change is cheapest against an empty database and never gets cheaper.
>
> **⚙️ SIZED 2026-09-03, and it is SMALLER than the cost note below implies — ONE micro order.**
> The note is right that this needs a Tier-B mutable merge with a version column, and wrong to leave
> the impression that the mechanism must be built. **Tier-B already exists and already carries a
> table of exactly this shape.** `pg-ae-store.ts` has `const TIER_B = [SUSPENSIONS, PRESENCE]`, and
> `PRESENCE` (`agent_presence`) is a mutable, per-key, merged-across-nodes record with
> `last_seen_at` / `updated_at` — structurally what a heartbeat is. The wire protocol, the digest
> and version-map exchange, and the merge plumbing are all live. **The work is a third entry in a
> two-entry list**, following the `PRESENCE` template (`spec`, `keyColumn`, `select`, `merge`,
> `rowToBody`, `toVersionRow`, `validateBody`), plus its migration and its merge function.
>
> **What it buys the operator:** a sealed receipt today is confirmed by ONE node's own say-so — the
> local checkpoint path writes it unilaterally, which is why receipts do finish. The federated
> 2-of-3 countersignature has never once succeeded. This is what makes "you do not have to trust a
> single directory" true rather than aspirational.

`DOD-HEARTBEAT-REPLICATION-1`. Every node reads the other two as never-heartbeated and counts
`availableNodes: 1` against `requiredThreshold: 2`; federation checkpoints have **never once
succeeded**.
- **Established by measurement, do not re-derive:** this did NOT cause the sealing outage — the
  degraded count was already true *during* seals that worked.
- **Cost, stated before anyone starts:** `last_heartbeat_at` is mutable, so it cannot join the Tier-A
  immutable set. This means a Tier-B mutable merge with a version column — a new merge table, not a
  one-line spec edit.
- **A code comment blaming a "BIGSERIAL `id` collision" is wrong** and would send the repairer at the
  wrong fix; rewrite it (Invariant / `DOD-M15-CLAIM-COMMENTS-1`).

### `DOD-M15-SCREENBLOCK-SILENT-1` — ❌ When we catch an attack aimed at you, you are told
**Found 2026-09-03, [[2026-09-03_1158_relay-overload-and-the-four-things-underneath-it]]. Ruled BLOCKS by Andre 2026-09-03.**

**What happens to you today:** the screener catches a prompt injection aimed at your agent. It is
blocked correctly and never reaches the model. A leaf is recorded so both hash chains stay aligned,
and the sender is acked so they stop retrying. **You are told nothing.** It is a line in a log file
you have no reason to open.

- **Only THREE refusal reasons reach the operator** — unknown hash algorithm, unavailable salt, hash
  mismatch. `DOD-M15-REFUSED-INBOUND-SILENT-1` wired those on 2026-08-24 and that was the right first
  cut (a version skew silences a conversation permanently). **The screener block was never wired, and
  it is the one the product is about.**
- **Also unsurfaced, from that unit's own pass-2 list:** `counterparty_gone`, `delivery_impaired`,
  `content_undeliverable`. **`counterparty_gone` is the dangerous one** — it tells the operator their
  peer *"may have crashed or gone offline — call `cello_close_session` to seal"* while the daemon
  holds the real reason in memory. It hands them a network story for a verification fault **and
  steers them toward sealing**, which read against `WITHHOLD-SEAL-1` is a nudge into exactly the
  truncated close.
- **⚠️ CHECK BEFORE SCOPING:** whether those pass-2 ACs actually landed on a later unit or exist only
  in a closing note. Decides whether this is tracked work or forgotten work.
- **`DOD-M15-SEALREJECT-MUTE-1` is the SAME SHAPE at a different door** (post-launch backlog: the seal
  rejection tells nobody either). Nobody had connected the two. **Whether it follows this line into
  the gate is Andre's call and is NOT assumed here.**
- **Good model to copy:** the park path already fails closed, refuses by name, and remembers refusals
  (`recoverParkedEntry`). The direct path does none of that.
- **One crack to record:** a direct-path refusal sends no delivery ack, so the sender's backstop parks
  the message and it can be **accepted** seconds later on the park path. A frame refused by name on
  one path is accepted on the other, and the two events are not tied together.
- **Enforcer:** journey — a screened message produces an operator-visible refusal naming the cause.

# Tier 4 — Own the encryption, then bind the receipt

**The largest coupled pair in the milestone, and both are inside the gate** — ruled on the migration
argument: a wire and schema change is cheapest against an empty database and never gets cheaper.
`DOD-M15-KEYAGREE-1` **must precede** `DOD-M15-SEALWIRE-1`; it produces both outputs the seal change
consumes.

### `DOD-M15-KEYAGREE-1` — ✅ CELLO owns its own confidentiality guarantee
> **BOTH halves are now written and reviewed.** `006-CRYPTO` (local: mint per session, memory only,
> destroyed at teardown and shutdown — one Opus pass, six findings, three blocking, all fixed, 17
> mutants) and `007-CRYPTO` (wire: exchange, sign, verify, encrypt the body — one Opus pass, fourteen
> findings, five blocking a publish, all addressed, 13 mutants). **Merged and published 2026-09-01,
> so operators are running it.**
>
> ✅ **CLOSED 2026-09-02.** The one thing it was waiting on — the multi-process proof — is measured
> against the production relay: see `DOD-M15-EPHEMERAL-AUTH-1`. → Entry S15, Entry C11.
>
> **2026-09-02 — the LOCAL half (this line's own scope) is now proven against the running system, by
> conservation rather than by a single event firing.** On the deployed build: `ephemeral.minted` 5,
> `ephemeral.destroyed` 4, outstanding 1 — and the daemon reported **exactly 1 open session**. The
> books balance, so no throwaway key outlives the session that minted it. Destruction was also
> observed in sequence at close: `certificate.frontier.verified → session.seed.destroyed →
> seal.completed → session.ephemeral.destroyed → session.node.destroyed`. → Entry C10.
>
> _(trail moved to [[M15-BUILD-JOURNAL]] — see “DoD trails, moved 2026-08-24”.)_

### `DOD-M15-EPHEMERAL-AUTH-1` — ✅ The session ephemeral is bound to the agent's identity
> **Written and reviewed** (`007-CRYPTO`, 2026-09-01 — one Opus pass, fourteen findings, five
> blocking a publish, all addressed). The throwaway key is signed with the agent's Ed25519 identity,
> the peer's is verified **before** anything derives, missing/malformed/mismatched all take one
> hard-fail path, and the message body is encrypted with the agreed secret. **The active-relay MITM
> this line exists for is closed in code.**
>
> ✅ **MERGED AND PUBLISHED 2026-09-01.** Clause 14 is done — Andre ran the promotion, verified
> against the registry rather than the log (`crypto` 0.0.60, `transport` 0.0.66, `protocol-types`
> 0.0.64, `client` 0.0.50, `connect` 0.0.158, each one ahead of the working tree). **Daemons on
> `latest` are now running the encryption.**
>
> **THE HISTORY, kept because it is why this clause existed at all:** `007` called the
> process-boundary version *"the clause that makes the feature real"*, and it had been proven with
> two session managers in ONE process — real libp2p, real identities, real signatures, nothing
> seeded, but one process, and this file's rule is that Vitest green is necessary and never
> sufficient. That is what the measurement below replaced. → Entry S15.
>
> **2026-09-02 — THE WIRE BYTES ARE NOW MEASURED IN PRODUCTION, and this line is still 🟡. Read
> which half moved.** Against the deployed fleet on `7befcc95`, a message was forced to park at the
> us-east1 relay and the relay's OWN file was read off its disk: 777 ciphertext bytes in
> `/mnt/disks/cello-wal/content/f8d518ca…/713ab930…__1788295441346__777.entry`. The plaintext
> canary is absent from the raw file AND from the base64-decoded `ct` field (five needles, all
> `False`); 36.4% of the decoded bytes are printable, against ~99% for English. The sender's
> transcript holds the sentence in full at `createdAt 1788295441326` — **20 ms before** the relay
> file's own timestamp, which is what ties the two observations to one message. **Readable at the
> endpoint, opaque at the relay, measured rather than inferred.**
>
> ✅ **CLOSED 2026-09-02 on Andre's ruling, and the ruling is right.** This clause exists to make one
> claim demonstrable: **we run the relays, so "we cannot read your traffic" cannot be asserted.** That
> is now measured against the relay, in its own process, on another machine — encryption happened on
> a laptop, and a host in us-east1 holds 777 bytes that contain none of it.
>
> The wording said "two daemons in separate processes" as a way of ruling out a shared heap faking
> the result. **The production measurement rules that out more strongly than the wording asked**: the
> observer is a different process on a different continent-scale network path, with no memory shared
> with the sender at all. What differed from the letter is that the two AGENTS sat in one daemon —
> and the agents are not the adversary this clause is about. The relay is.
>
> **What was attempted and abandoned, so nobody re-runs it:** a spine journey with two daemons whose
> parked ciphertext is read off the relay. Its ciphertext assertion PASSED on every run. What did not
> work was scaffolding — a positive control nobody asked for (bring the recipient back and decrypt)
> that drags in the whole offline-recovery subsystem, and a relay change that made the mailbox
> durable for EVERY spine cluster and broke eight J-CONTENT journeys in one run. All reverted; the
> tree is clean. If it is ever wanted, the observation point is the relay's content store and the
> control to use is the content-hash linkage, not recovery. → Entry C10.
>
> _(trail moved to [[M15-BUILD-JOURNAL]] — see “DoD trails, moved 2026-08-24”.)_
Split from `DOD-M15-KEYAGREE-1` (review F6). The key agreement defeats a PASSIVE recorder — the
harvest-now threat the line names — and NOT an active on-path relay.
- Nothing in the key-agreement API takes an identity key, so there is nowhere to bind the ephemeral
  to a peer. An active relay substitutes both ephemerals and reads everything.
- `SEALWIRE-1` must sign the ephemeral public with the agent's Ed25519 identity and verify the peer's
  BEFORE deriving. It also removes `KEYAGREE`'s bit-255 refusal as the sole tamper detector — a
  signature catches the flip instead.
- ✅ **THE DOCSTRING BULLET IS DONE — verified 2026-08-24, and it is exact.**
  `session-key-agreement.ts` carries a headed section *"WHAT THIS DOES NOT DEFEND AGAINST, stated
  plainly"*: defeats a **PASSIVE** recorder (*"which is what a relay storing traffic is"*), and *"NOT
  sufficient against an ACTIVE on-path relay, which can substitute both ephemerals"*, closing with
  *"a reader could otherwise conclude MITM is covered. It is not, yet."* **No claim to withdraw.**
  So what remains on this line is the BINDING itself, not the disclosure.
- The module docstring states the limit in the meantime, so a reader cannot conclude MITM is covered.

### `DOD-M15-EPHEMERAL-REVIVAL-1` — ⬇️ OUT OF GATE (Andre 2026-08-24) · was ❌ A revived session RE-KEYS
Split from `DOD-M15-KEYAGREE-1` (review F5, ruled in Decisions Carried #5).
- CELLO sessions survive daemon restarts; the ephemeral secret is deliberately NOT persisted, so a
  revived session has no key material and its content is unreadable until it RE-KEYS.
- Needs a fresh ephemeral exchange on revival, on the same path that rebuilds the session node.
- **Terminology (Andre, 2026-08-23): say "re-key the session", never "re-handshake".** The latter
  reads as reconnecting to the directory or revalidating a session, and it is neither.
- **Do not "fix" this by persisting the ephemeral.** That is the option Decisions Carried #5 rules
  out, and the reason is that key material in a backup is unrecoverable once written.

Relay-audit Decision 5(b), with the PQ hook built in from the start.
- Live content today is plaintext inside libp2p's Noise session. Confidentiality is real, but it is
  **libp2p's** key agreement over **libp2p's** ephemeral transport keys, so **CELLO cannot upgrade
  its own confidentiality guarantee** — PQ migration would happen on libp2p's timeline with libp2p's
  algorithm choices.
- **Urgent rather than later:** the threat is harvest-now-decrypt-later. Every cross-NAT
  conversation is relayed today, therefore recordable at fixed endpoints today, and adding the layer
  later does not protect traffic already sent.
- **Per-session ephemeral handshake**, not static-static. Each side mints a fresh keypair per
  session, agrees a session key, destroys the ephemerals at close. **Static-static would void forward
  secrecy** — a key derived only from long-term identity keys is the same key forever, so anyone who
  ever obtains an identity key decrypts every conversation that agent ever had. That is strictly
  worse than today, and [[design-problems]] already claims forward secrecy as structural.
- **The derivation accepts an additional shared secret from day one**, before there is a PQ
  contribution to put in it. Hybrid PQ then becomes mixing a second agreed secret into the same
  derivation — an addition, not a rewrite. Omitting the hook defeats the entire reason for the work.
- **⚠️ "One agreement, two outputs" WAS WRONG — corrected by Andre 2026-08-23, before SEALWIRE
  encoded anything.** The envelope key and the content-hash salt are TWO INDEPENDENT VALUES agreed in
  the SAME exchange — not two outputs of one derivation.
  **Why the original was wrong, recorded so nobody rebuilds the coupling:** they are unrelated goals
  that merely both need a shared secret. The envelope key stops the relay reading messages in flight
  and MUST be destroyed at close. The salt stops anyone holding stored hashes from confirming a
  guessed message and MUST survive for the life of the session. **Deriving both from one secret ties
  "must be forgotten" to "must be kept forever"** — and every consequence previously flagged (salt
  epochs, per-leaf epoch attribution, lockstep switching) was a symptom of that single coupling, not
  a real requirement.
  Keep the MOMENT, drop the DERIVATION: one round trip, two independent values.
- The parked-content seal (X25519 + HKDF + AES-256-GCM) is the working in-tree pattern to extend.

### `DOD-M15-HASHCORRELATE-1` — ✅ A message hash does not identify the message across sessions
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-HASHCORRELATE-1`.

### `DOD-M15-SEALWIRE-1` — ✅ The receipt is bound to the transcript
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-SEALWIRE-1`.

### `DOD-M15-SEALPARTIES-1` — ✅ Both real participants approve before any signature exists
> **Closed 2026-09-02.** The counterparty's approval already existed on the wire — each party's SEAL
> ctrl leaf carries a signed `final_root` — and was OPTIONAL: `not_carried` and `coverage:"one"` both
> certified, and the field is supplied by the party assembling the leaves. A bilateral seal now
> requires both, co-signing directories re-derive the root AND both approvals from the raw leaves
> instead of signing what they are handed, and `session_seal_rejected` — which had no consumer
> anywhere in the client — now answers both operators and still falls through to the solo seal.
> Closes `DOD-M15-NOTCARRIED-REFUSE-1` with it. Enforcer: `j-spine` **7/7** as separate OS processes
> (was 5/7 — see the Part 0 fix below). → Entry C12.
>
> ⚠️ **Ships client-first.** A directory with the co-sign gate plus a client that does not forward
> the leaves refuses every seal for that agent, and clients cannot be rolled. See the order's
> DEPLOYMENT ORDER section: publish, confirm every running agent, re-pin, then roll.
The T-of-N log's Part 3 fix direction. Moves the trust anchor from *"the verifying directory node is
honest"* to *"at least one of the two real participants is honest"* — a far more natural assumption
for a communication protocol, and one that does not depend on directory behaviour at all.
- **Affirmative pre-signature approval from every real participant**, not just the initiator. Today
  the initiator re-derives the root and refuses to co-sign if inflated — a hard gate before any
  signature exists — while the counterparty runs the same comparison only **after** receiving
  `session_sealed`, by which point the result is a durable artifact with no mechanism to invalidate
  it.
- **Raw signed leaf data is forwarded to co-signing directories**, not a claimed root. Today the
  other `T−1` directories verify only that they hold a share and there is no conflicting ceremony,
  then sign whatever bytes they are handed — cryptographic weight without judgment.
- **This is the counterbalance line of the milestone** (Invariant 1): name it explicitly in the
  journal before building.

### `DOD-M15-UNILATERAL-1` — ✅ Absence is evidenced and tiered, and the artifact says what is weak
> **Closed 2026-09-02 (`013-ABSENCE`).** The solo seal asks the relay — the party the sealer holds no
> switch over — whether the counterparty is actually there; a reachable one is refused in BOTH tiers
> however old the session is. Standard keeps 600s and proceeds on gone-or-unknown so an honest party
> is never stranded; high-stakes is opt-in only, starts at 3600s, and refuses without a positive
> observation rather than falling back to the clock. `j-unilateral` 3/3 live as separate OS
> processes: it was red on the counterparty-absent gate, and the cause was the SEALING party
> refusing to co-sign its own solo seal. Review found the receipt's new boundary was itself
> directory-attested — fixed by deriving it from the daemon's own signed carry. → Entries 013b, 013c

T-of-N log Decisions 1 and 2, plus its Part 4.
- **Hybrid trigger:** a time floor as a backstop, paired with an actual delivery-attempt/timeout
  record — **elapsed time alone is never sufficient on its own.** Today `#processSealUnilateral`
  compares elapsed time against `deliveryGraceSeconds` (600s) with **no presence check whatsoever**;
  a fully-reachable counterparty who takes longer than ten minutes can be sealed out from under them.
- **Two tiers.** Standard (default, unchanged): today's flat 600s, no evidence required, no
  dependency on the relay fan-out. High-stakes (**explicit opt-in** — nothing in the infrastructure
  can safely infer consequence, the relay is deliberately blind and the directory never sees it):
  **3600s starting point**, and the hybrid check is **mandatory**, not optional.
- **The artifact is split** into a full-strength mutually-signed prefix and an explicitly
  lower-weight unconfirmed tail. Everything up to the absent party's last signed message is exactly
  as strong as a bilateral seal; only the uncountersigned tail is weaker, and a downstream consumer
  must never mistake one for the other.
- **Escape-hatch risk, and why this ships near `DOD-M15-SEALPARTIES-1`:** strengthening bilateral
  sealing while unilateral keeps a self-declared clock-only trigger hands a malicious initiator an
  obvious way around the whole fix — wait out the timer, or engineer the appearance of
  unreachability. **Do not ship these far apart.**

### `DOD-M15-LEAFPARTIES-1` — ✅ Every content leaf is constrained to the session's two participants
> **Closed 2026-09-02** (`014-LEAVES`). **The answer to the open question was NO — it was not
> constrained**, and what stood in for the constraint was *incidental*: an injected leaf changed the
> root, so the roots stopped matching. Nobody wrote that as a protection. **And the injector held its
> off-switch** — omit `content_bytes` and the verdict is `NOT_CARRIED`, which is deliberately
> tolerated. The adversary was not only a rogue relay: `seal_submission` is accepted from any dialer
> who knows a session id.
>
> **Cross-session grafting was unconstrained at BOTH layers** — Structure 1 already signs the
> `session_id`, and neither the relay nor the directory compared it. The check was free and never made.
>
> Fixed by widening the existing check rather than adding a second: `verifyLeafProvenance` verifies,
> for every leaf, that the sender is one of the two participants and that the leaf's own signed bytes
> name the session being sealed — on the bilateral path *before* the carried-payload walk, so the
> assembler cannot disable it by sending less.
>
> **The review found a live hole this unit had walked past: a stranger could unilaterally seal a
> session they were not in.** Proven by reverting — the directory signs a receipt over two people's
> conversation naming a third. A test seam had been making that case unconstructible. → journal.

### `DOD-M15-INCLUSION-1` — ✅ An operator can prove a message sits under a sealed root
> **Closed.** `cello_get_inclusion_proof` takes the MESSAGE and returns a proof against the root the
> directory FROST-signed; `cello_verify_inclusion_proof` checks one from proof + message +
> certificate with no database. **The certified root is NOT the local tree's root** — it covers the
> seal's ctrl leaves and `SessionTree` does not — so the leaf set the seal frame carries is now kept,
> and only if its Merkle root reproduces the signed one. 24 mutants, 24 caught. Reviewed by
> `cello-unit-reviewer` (10 findings) + `cello-fallback-finder` (6), all fixed → work order
> [[009-PROOF-inclusion-proof]].

---

### `DOD-M15-AUTHORSHIP-ABSENT-1` — ❌ A message with no proof of who wrote it is refused, not delivered
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

### `DOD-M15-WITHHOLD-SEAL-1` — ❌ A counterparty cannot hide their last message and seal without it
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
- **The fix: the RECEIVER submits the hash of what it received.** It holds the sender's signature so
  it cannot fabricate a leaf, and the relay can verify that before accepting. Closes withholding for
  every direct session and gives the unilateral seal a witnessed leaf to stand on.
- **Pairing available now:** relay-only routing is an operator setting and `high_stakes` landed in the
  signed assignment in `017-TBS`. Forcing relay routing for high-stakes sessions is the obvious
  pairing — accept the IP disclosure in exchange for a guaranteed witness.
- **⚠️ CHECK BEFORE SCOPING (not blocking a decision):** does the daemon **assemble** a carried leaf
  for a message that arrived with no relay ordering record? The verifier would accept one. If the
  client already builds it, this requirement holds TODAY and the work is smaller than it looks.
- **This line is why `DOD-M15-RELAYFANOUT-1` can safely leave the gate** — see the note there.
- **Enforcer:** journey — a counterparty that withholds its last message cannot produce a seal the
  other side's evidence does not contradict.

# Tier 5 — Abuse controls, relay redundancy, infrastructure

Parallel with Tier 4 — different disciplines, no shared files.

### `DOD-M15-RELAYPARK-1` — ✅ The parked-message store refuses instead of writing past its cap
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-RELAYPARK-1`.

### `DOD-M15-RELAYPUBKEYS-1` — ✅ An incomplete directory key set stops the relay instead of degrading it
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-RELAYPUBKEYS-1`.

### `DOD-M15-RELAYADMIN-1` — ✅ The directory-admin push handler is KEPT, and the keeping is justified
> **Closed 2026-08-24 (CELLO_Support). Deleting the handler would break `discard_session`, which has a
> live production caller — so it is KEPT, and the bar's "or justify keeping it" is met in writing.**
> ⚠️ **CORRECTED an hour later, by me:** my first correction said the handler carries all four frames
> of the session lifecycle. **It does not — three of the four have no sender.** I verified the ADAPTER
> was constructed and connected and generalised that to its methods without checking them one by one,
> which is the same defect class the original bullet had. Measured per frame:
> `discard_session` ✅ live (`directory-node.ts:2766`); `record_assignment` ❌ the directory dial was
> REMOVED under Option B (the client presents its own); `confirm_seal` / `reject_seal` ❌ no caller
> (*"no directory→relay confirmSeal dial — the relay idle-sweep reclaims the post-seal session"*).
> **So there IS dead surface here after all, just not the whole handler** → `DOD-M15-RELAYADMIN-DEAD-FRAMES-1`.
> Replay window → `DOD-M15-RELAYADMIN-REPLAY-1`. Full entry → [[M15-DEFINITION-OF-DONE-ARCHIVE]].

### `DOD-M15-RELAYADMIN-DEAD-FRAMES-1` — ✅ Three of the admin stream's four frame types have no sender
> **Closed 2026-09-01** (`004-RELAY`). Deletion sound and independently re-derived on Opus, but it
> **left three problems behind** — including a rewritten header that would have led the next deletion
> unit to break the ABSENT attestation. Full entry in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under
> `DOD-M15-RELAYADMIN-DEAD-FRAMES-1`. → Entry S15.
>
> ✅ **VERIFIED IN THE RUNNING CONTAINER, 2026-09-02** — counting live dispatch sites
> (`=== "x"` / `case "x"`) in `/app/packages/relay/dist` on the deployed relay, not textual mentions:
> `confirm_seal` **0**, `reject_seal` **0**, `record_assignment` **0**; positive controls
> `discard_session` **3**, `get_seal_leaves` **1**, `client_record_assignment` **2**. Counting raw
> string hits instead would have reported `record_assignment: 34` and looked like a failure —
> `client_record_assignment` contains it, and the rest are comments recording the removal. → Entry C10.

### `DOD-M15-RELAYADMIN-REPLAY-1` — ⬇️ OUT OF GATE (Andre 2026-08-24) · was ❌ A directory admin frame cannot be replayed
Split from `DOD-M15-RELAYADMIN-1` once its deletion premise was disproved and the handler was kept.
- `discard_session`, `confirm_seal` and `reject_seal` sign only `{ type, session_id }`, and the relay
  verifies the signature without checking the dialer. A captured frame replays forever, from any peer.
- **Bilateral and receiver-first:** the relay must tolerate the new field before any directory emits
  it, or an admin frame from an un-upgraded directory is refused and sessions stop being recorded.
- **Do not solve it by pinning the dialer's peer id instead.** That authenticates the connection and
  not the instruction, and it breaks the moment the directory's transport identity rotates.
- **Sequence with `DOD-M15-RELAYADMIN-KEYSET-1`** — both change what this stream accepts, and shipping
  them apart means two fleet rolls.

### ✅ park rate limiting — CLIENT HALF DONE 2026-08-24 (CELLO_Support), REVIEWED, blocking findings fixed
> **Closed.** Full entry is in [[M15-DEFINITION-OF-DONE-ARCHIVE]].

### ✅ park deposit rate limiting — RELAY HALF DONE 2026-08-24 (CELLO_Support), REVIEWED, blocking findings fixed
> **Closed.** Full entry is in [[M15-DEFINITION-OF-DONE-ARCHIVE]].

### 🔒 CLAIM — park deposit rate limiting, **CELLO_Support**, 2026-08-24, before code
> _(trail moved to [[M15-BUILD-JOURNAL]] — see “DoD trails, moved 2026-08-24”.)_

### `DOD-M15-RELAYABUSE-1` — ✅ The relay has rate limiting, and its idle timer is on in production
> **Closed 2026-09-01** (`003-RELAY`), all seven clauses. The Sonnet pass returned "SPEC: FAITHFUL"
> and **the Opus re-review did not** — the two new refusals were never heard, and `cello_send` told
> the operator a message was *"sealed, witnessed and on its way"* when the relay had just refused to
> witness it. Idle timer ruled to **24 hours** by Andre: a reclaimer, not a conversation timeout.
>
> ✅ **THE TIMER IS ON IN PRODUCTION, read off the running fleet's own boot log, 2026-09-02.** This
> line exists because the timer was implemented and *the production binary never passed it*. Both
> relays on `7befcc95` log: `relay.config.session_idle_timeout sessionIdleTimeoutMs = 86400000`,
> `relay.config.idle_sweep maxIdleMs = 86400000 sweepIntervalMs = 3600000`,
> `relay.config.circuit_limits` present, `relay.config.content_ttl contentTtlDays = 30`. The value
> the binary used to drop is now in the config the relay reports for itself. → Entry C10.
> Reservation-slot limiting is **not** unfinished business here — it outgrew a relay-only order and
> is `DOD-M15-RELAYSLOTS-1` ✅. Full entry in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under
> `DOD-M15-RELAYABUSE-1`. → Entry S15.

### `DOD-M15-RELAYSLOTS-1` — ✅ An agent cannot flood a relay's reservation slots
> **Opened and closed 2026-09-01** (`008-RELAY`). **This line did not exist while the work was done**
> — it was extracted from `DOD-M15-RELAYABUSE-1` (the slot accounting) and `DOD-M15-RELAYAUTH-1` (work
> item 2, the registered-agent check), and given its own line on Andre's ruling rather than folded
> back, because 002 had already recorded what folding costs: *"a work item with no DoD clause is
> invisible to the gate that is supposed to catch exactly this."*
>
> ⚠️ **CLOSED TWICE. The first close was wrong and the ✅ rests on the second.** The order was
> reopened the same day — *"met to the letter and its title stayed false"* — because **the token was
> checked one step too late, so the flood still worked.** A second round added the gate that refuses
> a stranger, deleted what had been standing in for one, and made the client prove itself before it
> asks. Re-merged and closed by its owner.
>
> 🚨 **THE DEPLOY ORDER IS NOW LOAD-BEARING, not a compatibility nicety.** With the gate live, **a
> relay deployed in front of clients that do not prove before they ask refuses EVERY reservation**,
> and every agent behind it is unreachable until it upgrades. **Client first, then relays.** The
> client shipped 2026-09-01; the relay roll follows it.
>
> ✅ **DEPLOYED AND PROVEN ADVERSARIALLY AGAINST PRODUCTION, 2026-09-01/02.** The whole fleet is on
> `7befcc95` (three directories, both relays), rolled in that order. The headline claim was then
> attacked rather than asserted: **a freshly minted keypair connected to each production relay and
> was refused a slot by both** — `relay-use1` with a live connection confirmed (`dialed_ok`, 1
> connection), `relay-euw1` likewise. **Positive control taken in the same minutes:** five registered
> agents (`CELLO_Coder_1`, `CELLO_Support`, `Miss_Chelly`, `CELLO_Coder_H`, `Miss_Chelly_H`) all read
> `reachability: reserved` on those same relays — so the refusal is not "reservations are broken
> tonight".
>
> Both ends of the handshake observed independently: client `prove.result proven: true`; relay
> `relay.auth.reservation_proof` for `ce0fa3d0`/`f8d518ca`, and `relay.reservation.denied /
> not_authenticated` at **debug** carrying the corrected impact text (review finding 3 — the happy
> path must not be logged as an attack — running in production).
>
> **The failover was tested by a real outage, not a fixture.** At 20:31:16 `Miss_Chelly_H`'s proof to
> the europe-west1 relay died mid-handshake (`Unexpected EOF`) **because that relay was being rolled
> at that minute**. Its client classified it `no_relay_verdict / tryAnotherRelay: true`, moved to the
> other relay instead of retrying the dead one, and held a reservation again at 20:35:03 — unattended.
> That is the clause-9 path the review had found untested. → Entry C10.
>
> Full entry in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-RELAYSLOTS-1`. → Entry S15.

### `DOD-M15-SESSION-RELAY-PINNED-1` — ❌ A live conversation survives its relay going away
> **⚙️ MEASURED, AND UNIT 1 OF 4 IS DONE — do not re-open either.** The first clause below demanded a
> measurement; `016-RELAYLOSS` ran it (relay killed mid-conversation, two real daemons) and its
> recommendation is that this line **stays in the gate**: the conversation neither parks cleanly nor
> seals, and the two parties are told contradictory things about their own close. The fix is
> [[M15-STORY-RELAYHANDOVER]], whose unit 1 closed 2026-09-03 (`017-TBS` — the assignment TBS now
> carries `prior_relay_id`). Units 2–4 are open; unit 4 is blocked on Andre's call in the story's §0.
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

### `DOD-M15-MULTIRELAY-1` — ❌ An agent's reachability does not rest on one relay
> **⚙️ UNIT 1 OF 4 IS DONE — do not re-scope this line from scratch.** The fix for this line and for
> `SESSION-RELAY-PINNED-1` is one story, [[M15-STORY-RELAYHANDOVER]], and its first unit closed on
> 2026-09-03 (`017-TBS`): the assignment TBS now carries `prior_relay_id`, so a directory can name
> the previous witness inside signed bytes. **The churn numbers this line demands an explanation for
> were measured by `016-RELAYLOSS`** — read its Review before re-measuring anything. Units 2–4
> (directory resume path, relay-side replay + verifier, client rebind) are still open, and unit 4
> is blocked on Andre's call in the story's §0.
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
> **Ruled post-launch by Andre, 2026-09-03.** It only bites if a relay is DISHONEST, and we run the
> relays. It is not findable by reading the repo (the §Priority Override filter demotes exactly
> this), and building it is one of the largest remaining pieces in the milestone. **Not dropped** —
> the reasoning below still stands and it is still the right thing to build; launch does not wait
> for it. Note it serves `DOD-M15-UNILATERAL-1`'s evidenced-absence too, which is already ✅ without
> it.
>
> **⚠️ THE RULING RESTED ON AN INCOMPLETE THREAT MODEL, CORRECTED 2026-09-03 — the conclusion still
> holds, but ONLY because of what replaced it.** It was ruled out on "this only bites if a RELAY is
> dishonest, and we run the relays." **That is wrong.** `DOD-M15-WITHHOLD-SEAL-1` establishes that a
> **COUNTERPARTY can truncate with no relay dishonesty at all** — only the sender submits a hash, so
> on a direct connection a malicious peer delivers a message, never witnesses it, and the relay's
> account honestly ends one short. **Truncation cover is therefore load-bearing, and is now carried
> by `WITHHOLD-SEAL-1` (in the gate), whose receiver-side hash submission is cheaper and more
> targeted than fanning out to more relays.** If `WITHHOLD-SEAL-1` is ever descoped, THIS LINE COMES
> BACK INTO THE GATE WITH IT — the gate must never be left with no truncation cover at all.
Serves **three** separate problems, which is a good sign it is the right thing to build: truncation
resistance at seal, evidenced absence for `DOD-M15-UNILATERAL-1`, and the corroboration layer below.
- **Truncation** is not caught by more verifiers: a primary directory that has honestly relayed the
  real conversation can submit a genuine but *truncated* prefix — every leaf validly signed, nothing
  false, only something missing. Forwarding raw leaves to more directories does not help, because
  all of them are handed the same feed by the same source.
- Fan the live hash sequence to **two or three relays** instead of one, fire-and-forget, so a single
  relay's account at seal time is cross-checkable against an independent live witness.
- **Fits the cost model:** relays are meant to be cheap, stateless and numerous specifically so this
  redundancy is affordable; directories are the few, database-backed, anti-entropy-meshed tier.

### `DOD-M15-CORROBORATE-1` — ✅ The relay verifies every hash proactively, not on request
> **Closed 2026-09-02** (`015-WITNESS`). The relay now verifies each submitted hash against the two
> expected participant keys **as it arrives**, not at seal time — the same check the directory
> already ran, triggered early, with no new cryptography and no content read. That closes the gap
> `FRAME-1` opened: the party best placed to notice a forged message is the receiving client, which
> is also the party best placed to fabricate the accusation. **The clause the unit existed for is
> asserted: the relay flags it even when the receiving client reports nothing at all.**
>
> **Ruled and written down, because the order asked for the choice rather than the code implying it:
> a flagged session KEEPS BEING RELAYED.** The submission is refused before a sequence is allocated,
> so nothing entered the tree and there is nothing left to protect — while a teardown would let
> anyone who can name a session id end any conversation with one frame. A false teardown is worse
> than a false accusation, and needs no accusation at all.
>
> **One relay is one witness, and the wording says only that.** It becomes a detection layer with
> `DOD-M15-RELAYFANOUT-1`, not before. → journal.

### `DOD-M15-DIRAUTH-1` — ✅ Directory authentication cannot be silently skipped
> ### ✅ CLOSED 2026-08-24 — its own stated condition is met.
> This line held 🟡 deliberately, with *"it closes when `BOOTSTRAP-AUTH-1` does."* That line is now ✅,
> so this closes with it. **Nothing was ever outstanding here** — everything inside it was done and
> reviewed (the surfacing half plus two quick wins); the tag was held on another line's state.
> _(trail moved to [[M15-BUILD-JOURNAL]] — see “DoD trails, moved 2026-08-24”.)_

### `DOD-M15-RELAYADMIN-KEYSET-1` — ⬇️ OUT OF GATE (Andre 2026-08-24) · was 🟡 ANSWERED: the gap is real but small, and bounded by the idle sweep
> ### ✅ THE QUESTION IS ANSWERED IN FULL, 2026-08-24 (CELLO_Support), read-only. **The alarming
> ### reading — "one directory is load-bearing for every session the other two broker" — is FALSE.**
> Traced per frame rather than per stream, which is what both earlier readings skipped:
> - **Recording is FEDERATED.** A session brokered by directory 1 or 2 records fine, because the
>   CLIENT presents the assignment (`client_record_assignment`) and its inner signature is verified
>   against the **any-directory set**. The directory's own push was removed under Option B.
> - **Sealing does not use this stream at all.** `confirm_seal` and `reject_seal` have **no sender** —
>   *"no directory→relay confirmSeal dial; the relay idle-sweep reclaims the post-seal session."* No
>   node can be blocked from a call nobody makes.
> - **`discard_session` IS the real gap, and it is the only one.** It has a live caller — the
>   directory holding the pending session, on a stream close before establishment — and it is signed
>   with THAT node's key while the relay verifies against the **primary's**. So a non-primary broker's
>   discard is refused.
>
> **What that costs, precisely:** an abandoned-before-establishment session brokered by directory 1
> or 2 is not discarded at the relay, and lingers until the **24-hour idle sweep** reclaims it — the
> same sweep that is the designed reclamation path for sealed sessions. So the consequence is a
> stale relay-side record for up to a day, not a broken session and not a lost seal.
> **🟡 rather than ✅** because the fix is real and unshipped, and it is the same wire surface as
> `DOD-M15-RELAYADMIN-REPLAY-1` and `DOD-M15-RELAYADMIN-DEAD-FRAMES-1`. **Take all three together**
> — each changes what this stream accepts, and shipping them apart is three fleet rolls.

### (original finding, kept for the trail) The relay's admin stream trusts ONE directory, not the consortium
**Found 2026-08-24 (CELLO_Support) while verifying `DISCLOSE-1` bullet 3. Recorded, NOT chased —
outside that unit, and I am not opening it on a guess.**
- The relay verifies a **session assignment** against the any-directory set:
  `this.#directoryPubkeys.find((pk) => verify(pk, tbs, assignment.directory_signature))`. Any
  sovereign directory can broker a session. That is `FED-OPTIONB-SETUP-001` working as designed.
- But the **directory→relay admin stream** (`/cello/directory-relay/1.0.0`, which carries
  `record_assignment`, `discard_session`, `confirm_seal`, `reject_seal`) verifies against
  `this.#directoryPubkey` — **the single primary key only.**
- **The question, which needs someone who owns the relay's federation story:** if a session is
  brokered by directory node 1 or 2, can that node drive the relay's session lifecycle at all, or is
  node 0 a precondition for it? If the latter, one directory is load-bearing for every session the
  other two broker — the redundancy invariant inverted, in the same shape `RELAYPUBKEYS-1` just made
  fatal at startup for the assignment path.
- **What I did NOT establish:** whether the admin stream is only ever dialled by the primary by
  design (in which case this is correct and should say so), or whether a non-primary broker silently
  cannot complete. Answering that is the unit; guessing is how a working design gets "fixed".

> ### 🔎 HALF-ANSWERED 2026-08-24 (CELLO_Support), read-only, while `BOOTSTRAP-AUTH-1` was under review.
> **The alarming half is DISPROVED: node 0 is NOT a precondition for a session being recorded.**
> There are **two** routes to `recordAssignment`, and only one goes through the admin stream:
> - **`client_record_assignment`** — the CLIENT presents its own assignment. The inner assignment
>   signature is verified against the **any-directory set** (`#directoryPubkeys.find(...)`,
>   `relay-node.ts:694`), so a session brokered by directory 1 or 2 records normally.
> - **the directory admin push** — carries an OUTER `directory_signature` over the frame body,
>   verified against the single `#directoryPubkey`. A non-primary directory's push is refused here.
>
> So the assignment path is federated and the admin path is not. **That is why nothing is visibly
> broken today**, and it is also why this was easy to miss.
>
> **WHAT IS STILL OPEN, and it is now a sharp question rather than a vague one:** `confirm_seal`,
> `reject_seal` and `discard_session` have **no client-presented equivalent** — they exist only on
> the admin stream. So if the directory that BROKERED a session is also the one that confirms or
> refuses its seal, a non-primary broker's confirmation is refused by the relay and the session's
> relay-side lifecycle never terminates. **The next step is one trace: which node sends
> `confirmSeal`, the broker or the primary?** I did not follow it, and this line should not be
> closed on the half above — the recording being fine says nothing about the sealing.
- **NOT a guess about the fix, deliberately:** if the answer is "the broker sends it", widening the
  admin path to the consortium set is the obvious move and it is the SAME wire surface as
  `DOD-M15-RELAYADMIN-REPLAY-1`. **Sequence them** — both change what this stream accepts, and
  shipping them apart is two fleet rolls.

### `DOD-M15-BOOTSTRAP-AUTH-1` — ✅ A poisoned bootstrap coordinate cannot impersonate a directory
> ### ✅ CLOSED 2026-08-24 ON ANDRE'S RULING ("close it"). **RETITLED to what it protects.**
> It previously demanded TLS on port 9090. Measurement says that buys almost nothing: the node roster
> and every node's key are **signed and shipped in the client**, `/bootstrap` supplies only a dial
> coordinate, and a coordinate whose peer id is not a declared member is **discarded before any dial**.
> TLS would encrypt a channel whose contents are already authenticated by something the attacker
> cannot forge. Descoping is Andre's call; he made it, and the retitle records what actually shipped.
> **⚠️ This supersedes the `⬇️ OUT OF GATE` tag the other lane's Decision-16 sweep applied here.**
> That ruling was about DOCUMENTS; this line was swept in with it. Andre ruled on this line
> specifically, and "closed, retitled" is the narrower and correct disposition.
> **CARRIED, so the tick covers nothing it did not earn:** `DOD-M15-BOOTSTRAP-ADDR-1` (a rogue
> ADDRESS under a real peer id stalls this daemon's directory connection), plus the four review ACs.
> ### ✅ THE UNPROVEN LINK IS NOW MEASURED, AND THE ANSWER IS STRONGER THAN THE SCOPING ASSUMED.
> **2026-08-24 (CELLO_Support).** The scoping below called this line not-blocking on four points and
> named the one it could not prove: *"that a client meeting a poisoned coordinate actually FAILS OVER
> rather than stalling."*
>
> **The client never dials the rogue at all.** `createRosterAwareEndpointResolver` compares the
> primary's peer id against **DECLARED manifest membership** before returning it, so an
> attacker-chosen coordinate is discarded at RESOLUTION — one step earlier than step-6 identity auth,
> which is where the scoping assumed the defence lived. Membership is local and signed: it costs no
> probe, and the attacker cannot answer it.
> **The guard is not hypothetical** — its own comment records the incident that produced it: a
> compiled-in default URL after a consortium move that *"resolved forever while every connection died
> at step-6 identity auth with `key_not_in_manifest`. Reachability was never the right test."*
>
> **⚠️ I WROTE "AND IT HAD NO TEST." THAT WAS FALSE — review F1, and it is the finding of the pass.**
> `directory-bootstrap.test.ts:313` has carried **four** tests on this guard since M12, including one
> that is my test 1 minus the log assertion and one that is my test 3. **I grepped the EVENT NAME,
> found nothing, and concluded the guard was uncovered** — the deadness-by-grep shape, applied to
> tests instead of to code. My revert proof did not catch it because it was scoped to the new file;
> reverting the guard would also have reddened the M12 file. **Corrected here, in the test header and
> in the commit, because the false version said the guard "was held up by nothing" and a later reader
> would go re-derive its history.**
> **What this unit genuinely adds:** the all-poisoned → `null` case (no analogue anywhere), the
> address residual asserted as a bound, and one assertion each on the operator-visible event and its
> absence on the healthy path. **4 tests, revert proof RUN** — disabling the membership check reddens
> exactly the two that assert it.
>
> **⚠️ AND THE PRE-REGISTERED "FAILOVER DOES NOT HOLD" BRANCH WAS TAKEN — for the ADDRESS variant.**
> Review F2. Branch 2 of the resolver returns the primary on every call, never sets `stuckToFallback`
> and never probes the roster; `maxReconnectAttempts` is `MAX_SAFE_INTEGER`, so the daemon
> reconnect-loops **forever** rather than reporting `lost`. That is a STALL, and the cost is not
> "denial of one node" as I first wrote it — it is **denial of this daemon's directory connection with
> no failover path**, and a restart re-picks a bundled endpoint the same attacker answers again. The
> title now carries the qualifier rather than reading as blanket survivability.
>
> ### ✅ THE UNIT IS COMPLETE. What holds the tag is a SCOPE call, not unfinished work.
> **Built, reviewed (pass 1), every finding applied, committed.** Gate: this file **4/4**; the whole
> `core/daemon` package **2952 passed / 285 files**; typecheck clean.
> **⚠️ ONE FILE FAILED IN THAT PACKAGE RUN AND IT IS NOT THIS UNIT'S** —
> `mcp-001-agent-lifecycle.test.ts:119` asserts `toEqual({ ok: true })` on `cello_start_agent`, and
> commit `9a41a39` (`DOD-M15-START-AGENT-UNAWAITED-1`, the OTHER lane) added `standing_receiver`,
> `standing_receiver_cause` and `guidance` to that response. A strict-equality assertion against a
> deliberately-widened response. **Not fixed here on purpose:** deciding whether that response shape
> is now correct belongs to the unit that changed it, and loosening another lane's assertion to green
> my own gate is the move this milestone exists to prevent. **Handed over, not swept.**
>
> **The line stays 🟡 for one reason and it is Andre's:** its literal title asks for an authenticated
> channel (TLS on 9090), which this work does not build and — on the measurement — buys little.
> Retitling a gate line is scope. **`DOD-M15-DIRAUTH-1` is waiting behind it.**
>
> **CARRIED as ACs (two-pass cap not yet spent, but Andre called the wrap):**
> - **The suite-level hollow gap review proved:** delete `getManifestPeerIds,` from
>   `consortium-bootstrap.ts:446` and **all four of my tests stay green**, as do the four M12 ones.
>   Nothing asserts the WIRING from the composition root. The fifth test review specified — drive
>   `createConsortiumRouting` with the real `EmbeddedManifestProvider(BUNDLED_CONSORTIUM_MANIFEST)` and
>   a rogue primary — is the one that would make this launch call self-defending.
> - **F5 (silent fallback):** `peerId` is OPTIONAL on `ConsortiumNode`, so a verified in-window
>   manifest with no peer ids disarms this guard **with no log at all**. The bundled manifest is
>   covered by an existing assertion; the `CELLO_CONSORTIUM_MANIFEST` file path is not.
> - **F6:** `directory.bootstrap.primary.not_in_consortium` is the one signal that says *"you are
>   being MITM'd"* and it carries no `impact`, no `guidance`, and reaches no `cello_status` surface —
>   while the line the operator watches loops at INFO forever.
> - **F7:** a dial rejected for peer-id mismatch — the exact fingerprint of the ADDR-1 attack — is
>   logged at `debug`.
>
> **THE RESIDUAL, TESTED AS A LIMIT rather than left to be discovered → `DOD-M15-BOOTSTRAP-ADDR-1`.**
> Membership is checked on the PEER ID, never on the ADDRESS, so a rogue address under a real node's
> peer id is returned and dialled. Noise refuses the connection (the attacker holds no such key), so
> the cost is **denial of that node, not impersonation** — but the resolver keeps choosing it, and its
> own doc says it is *"not told whether a dial/auth against the returned endpoint actually
> succeeded."*
>
> **⚠️ WHY THIS IS 🟡 AND NOT ✅, and it is a scope question rather than a work question.** The
> security property this line exists for is met and now tested. **Its literal title — a bootstrap
> coordinate arriving over an AUTHENTICATED CHANNEL — is not built, and will not be by this work.**
> **ANDRE:** the measurement says TLS on 9090 buys little (the roster is signed, the coordinate is
> membership-checked, and the residual is an address the peer id already fails to authenticate).
> Retitling this line to what it actually protects, and closing it, is a scope call and therefore
> yours. Say the word and it closes; until then it holds its tag rather than flipping on my reading.
> **`DOD-M15-DIRAUTH-1` is waiting on this** — its 🟡 is held deliberately with *"it closes when
> `BOOTSTRAP-AUTH-1` does."*

### `DOD-M15-BOOTSTRAP-ADDR-1` — ⬇️ OUT OF GATE (Andre 2026-08-24) · was ❌ A rogue ADDRESS under a real peer id does not pin the client
Split from `DOD-M15-BOOTSTRAP-AUTH-1` once the membership guard was measured and tested.
- The resolver checks the primary's **peer id** against manifest membership. It does **not** check
  the multiaddr, so an on-path attacker answering the plaintext `/bootstrap` with a REAL node's peer
  id and their OWN address gets past the guard and is returned as the node to dial.
- **Bounded, and the bound is why this is not the same finding as the poisoned peer id:** libp2p's
  Noise handshake authenticates the remote peer id and the attacker holds no such key, so the
  connection is never established. The cost is **denial of that node**, not impersonation.
- **What makes it stick is the missing feedback loop:** the resolver is *"not told whether a dial/auth
  against the returned endpoint actually succeeded"* (its own doc), so it keeps returning the same
  unreachable coordinate on every reconnect instead of failing over.
- **Fix shape:** feed connect outcomes back into selection — a dial that fails against a resolved
  primary should demote it the way an unreachable one already is. **Do not fix it by validating the
  address against the manifest**: the manifest carries `/bootstrap` HTTP bases, not libp2p
  multiaddrs, and a node legitimately changes address.
- **Enforcer:** the existing poisoned-coordinate test file, extended — the limit is already asserted
  there, so the day it is fixed that assertion inverts rather than being written from scratch.
> # 🔒 CLAIMED BY **CELLO_Support**, 2026-08-24, BEFORE code. `RELAYADMIN-1` closed, so this is my one WIP.
> **The unit is the TEST, not TLS.** My own scoping below says the authenticity half is already
> structural and the residual is denial of one node, bounded by the signed roster — and then names
> exactly one thing I could not prove: **that a client meeting a poisoned coordinate FAILS OVER to
> another roster node rather than stalling on the refusal.** Everything in the "not blocking" call
> rests on that, and it is currently an argument.
> **I hold:** `core/daemon/src/__tests__/` for the new test, and read-only tracing of
> `consortium-bootstrap.ts` / `directory-bootstrap.ts` / `signaling-connect.ts`. **No production file
> is claimed** — if the test shows failover does NOT hold, the fix is a separate unit and I will
> claim the file then rather than widening this one.
> **The two outcomes, both useful, written before the run so neither can be fitted afterwards:**
> failover holds ⇒ point 4 is bounded to a single node, this line is hardening, and it closes along
> with `DIRAUTH-1`'s deliberately-held 🟡. Failover does NOT hold ⇒ the availability bullet is real,
> and it belongs to the failover path, not to port 9090.
Extracted from `DOD-M15-DIRAUTH-1`'s second bullet so it is a line rather than a footnote.
- The directory's `/bootstrap` coordinate comes from a **plaintext HTTP endpoint on port 9090**.
- Step 6 converts a poisoned redirect into a refused connection — it does not prevent the redirect,
  so the attacker retains denial-of-service, and step 6 is itself skippable (that is `DIRAUTH-1`).
- This is the fix the byte/normalised string match was standing in for.

> _(trail moved to [[M15-BUILD-JOURNAL]] — see “DoD trails, moved 2026-08-24”.)_

### `DOD-M15-STEP6-REPLAY-1` — ⬇️ OUT OF GATE (Andre 2026-08-24) · was 🟡 A directory identity proof cannot be replayed (replay bullet ✅; byte-match fail-open OPEN)
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-STEP6-REPLAY-1`.

### `DOD-M15-RELAYONLY-1` — ✅ Relay-only routing is an operator setting
> **Closed.** Full entry — verdicts, findings, mutations and lessons — is in [[M15-DEFINITION-OF-DONE-ARCHIVE]], under `DOD-M15-RELAYONLY-1`.

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

### `DOD-M15-JCONTENT-DELIVERY-1` — ⚠️ WAS ✅. THE CLAIM NO LONGER HOLDS — `j-content` is 6/10 (2026-09-02)
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

<details><summary>Superseded: the original ❌ BLOCKS LAUNCH write-up, kept because the exoneration evidence in it still stands</summary>

### ~~`DOD-M15-SEALROOT-EMPTY-1` — ❌ BLOCKS LAUNCH. A close reports success and hands back no receipt~~
**Found by the other lane's first-ever spine-lane run (2026-08-23), five journeys deep. Diagnosis is
open; what is established is below, and the exoneration evidence is the durable part.**

`cello_close_session` returns **`ok: true` with `sealed_root` undefined**. The operator is told their
conversation closed successfully and receives nothing to keep — and a notarized receipt is the entire
product. Five journeys fail on it: both `J-UNILATERAL` cases, `J-UPGRADE`, `J-SPINE` DOD-SPINE-7
(bilateral, byte-identical root) and `J-LOOPBACK`. A sixth, `J-MULTIPLAYER`'s *"agentA has no sealed
root"*, is the same shape.

**Classified BLOCKS LAUNCH** on the DoD's own test: a prospective customer cannot get the core value.
Not because the session breaks — it closes — but because the artifact the close exists to produce
does not arrive, while the response says it did. A silent success is worse here than a failure: an
operator with `ok: true` has no reason to look.

**WHAT WAS ESTABLISHED, by running rather than reasoning:**

- **Not version skew.** The daemon `dist` the spine spawned was built at 18:57 and *contains* the B2b
  symbols — verified by grepping the built artifact for them, not by comparing timestamps.
- **Reproduces at HEAD.** `j-loopback` fails identically now, at ~4.6 s.
- **`SEALWIRE-1` B2b is EXONERATED, by two probes each rebuilt and re-run:**
  - `SALT_AGREEMENT_WAIT_MS` 5 000 → 50. Still fails, ~4.4 s. So the bounded first-send hold is not
    delaying the seal past a deadline.
  - The salted branch bypassed entirely, every hash plain `sha256` — pre-B2b behaviour. **Still
    fails, ~4.5 s.**
- **Therefore: pre-existing.** Consistent with the lane having never been run — there is no baseline
  saying these ever passed.

**WHAT IS NOT ESTABLISHED, and is not guessed at:** which branch returns `ok: true` without a root.
The only `ok: true` lacking `sealed_root` in `close-session-handler.ts` is the `force: true` abandon
path, which the spine does not take. The ~4.5 s is consistent across all three runs, which reads more
like a fixed timeout being hit than a race — but that is an observation, not a diagnosis.

- **Enforcer:** journey — the five spine journeys above are the receipt, and they must go green.

</details>

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
> **The tolerance is deleted, not trimmed.** A bilateral seal that arrives with `not_carried` — or
> with only one participant's payload, which this line did not cover and which was the same hole one
> leaf narrower — is refused as `seal_approval_missing`. There is no roll to protect: nothing is
> registered against a client that predates the carry, so the older shape was deleted rather than
> supported alongside the new one. The comment that argued for the tolerance is rewritten in place
> rather than removed; it was right at the time and it names the price that ended it. → Entry C12.
>
> *Original entry, kept because its reasoning is what made the tolerance correct while it lasted:*
**Raised by review pass 1 on `DOD-M15-SEALWIRE-1` bullets 3+4 (finding F4), filed rather than fixed
because the gate is frozen and this is not a hole a customer reaches today.**

The final-root check is the one thing in `processSeal` that is not circular: it compares the leaves a
relay presents against a root the participants themselves signed. It runs only when the SEAL payload
is present — and **`content_bytes` is supplied by the relay.**

So a relay that deletes a message leaf also strips both payloads, the check returns `not_carried`,
and the seal is certified exactly as it was before the check existed. **The guard is optional for
precisely the party it guards against.**

**Tolerating absence is correct right now and only right now.** Every client and relay is
un-upgraded until it upgrades; refusing an absent payload the moment this shipped would have broken
every seal in the federation. That is the ABSENT-versus-NAMED distinction Decision #15 spends a wire
discriminator on, applied one layer up, and it is why the code proceeds and logs rather than refuses.

**What changes it:** once the sender leg (shipped 2026-08-24, `cello-client`) and the relay carry are
deployed everywhere, a BILATERAL seal arriving with no payload is no longer explainable as skew. At
that point the tolerance is the whole defect.

- **The work:** flip `NOT_CARRIED` from an info-and-proceed to a refusal on the bilateral path, once
  deployment is confirmed. Keep the unilateral path's own handling separate — its leaves are
  client-carried and receipt-witnessed, a different threat model.
- **The prerequisite is a deployment fact, not a code change** — which is exactly why this is a
  tracked line and not a "tighten this later" sentence in a comment. The two-milestone deferral that
  `DOD-M15-SEALWIRE-1` bullet 3 just deleted is what a comment-only intention becomes.
- **Enforcer:** unit — a bilateral `processSeal` with no carried payload must be refused, with the
  un-upgraded case covered by the rollout flag rather than by the absence itself.

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

### `DOD-M15-SEALREJECT-MUTE-1` — 🅿️ POST-LAUNCH BACKLOG. The one moment the system catches the attack it was built for is the moment it tells nobody
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
