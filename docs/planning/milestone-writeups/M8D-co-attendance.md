---
name: M8D — Co-attendance
type: milestone-writeup
date: 2026-08-02
updated: 2026-08-02
milestone: M8D
status: closed — all six lines green, three proven live on the shipped binary
description: >
  M8D lets several Claude sessions drive ONE agent identity without stealing each other's
  messages. Delivery moved from a destructive shared queue to a durable record read against a
  per-connection bookmark; the doorbell stayed multicast; the send path stopped letting two
  sessions answer one question; and a session can now tell it is not alone.
---

# M8D — Co-attendance

**2026-08-01 → 2026-08-02 · CLOSED.** Six DoD lines, all green — three proven **live** on the shipped
binary with three real `claude --channels` windows. Published: daemon `0.0.119`, cli `0.0.122`,
connect `0.0.116`.

Co-attendance is the property that several sessions can attend one agent at once — a second
terminal, a listener, an operator watching a running conversation. **Exclusivity was rejected
permanently (§3):** locking an agent to one session would foreclose listener mode, and co-attendance
gets that capability for free. The milestone was therefore about making shared attendance *correct*,
never about preventing it.

| line | status |
|---|---|
| `DOD-COATTEND-1` — per-session delivery | ✅ **proven live** |
| `DOD-COATTEND-CATCHUP-1` — the catch-up door | ✅ **proven live** |
| `DOD-COATTEND-VISIBLE-1` — a session can tell it is not alone | ✅ **proven live** |
| `DOD-COATTEND-SENDWINDOW-1` — two sessions cannot both answer | ✅ proven (unit + two reviews) |
| `DOD-RECEPTIONIST-AGENT-1` · `DOD-INBOX-AGENT-1` | ✅ |

## What was delivered

- **Per-session delivery** — delivery reads the **durable transcript** against a **per-connection
  bookmark** instead of popping a shared queue. One message reaches every attending session; no read
  removes anything. The doorbell stays multicast — it was never the defect.
- **A catch-up door that exists** — `cello_get_transcript` (M8D-D3), the only reader covering both
  directions, so a session can see what its sibling *sent*.
- **A send path that cannot double-answer** — a frontier comparison plus an in-flight claim,
  together spanning both awaits between the gate and the wire.
- **Legible co-attendance** — attendance on the doorbell *and* on every read surface, so a session
  that never saw a push can still learn it is not alone.

## The live proof

Three real windows: two attending one agent, one driving the counterparty.

- **One message, two sessions, both received it** — identical content at identical
  `sequence_number`, and the second session had sent nothing, so only genuine delivery explains it.
  On the old build one of those reads returns `content: null` with the quiet-counterparty guidance.
- **The catch-up door works** — the second session's transcript showed the *other* session's reply,
  which `cello_receive` can never hand it.
- **A session says it is not alone, unprompted** — asked an open question with no mention of
  co-attendance: *"another session is attending this same agent alongside me… whatever I send, a
  second window on this identity could also be reading and replying independently."* The number
  **and** its consequence.

**One thing the live run got wrong and the record does not.** The counterparty session reported *"two
replies to one question — that's the defect"*. It is not: two windows of one agent deliberately do
not gate each other, because the principal is the agent, not the socket. The mis-framing came from
the prompt, and left alone it would have entered the record as a live-confirmed defect that does not
exist.

## Bugs found and fixed

### 1. The delivery bookmark was the send gate's cursor

**Symptom.** A co-attending session received the same message on every `cello_receive`, forever, and
never saw the next one.

**Root cause.** Delivery used `safeCursorAdvance` — the **gate's** cursor, which by design refuses to
walk past a gap. Two questions had been answered with one mechanism:

| | question | wants |
|---|---|---|
| the gate | has this connection seen **every** leaf? | to STOP at a gap |
| delivery | what have I already **handed** this connection? | to never stop |

Blast radius was wider than co-attendance: a fresh `connectionId` starts at −1, so an MCP reconnect
or any `cello` CLI command hit it on any session that had ever sent.

**Rule.** *Before reusing a mechanism, state the question it answers. Two questions that share a data
shape are still two questions — and a property essential to one can be fatal to the other.*

### 2. A swallowed transcript write became total silent content loss

**Root cause.** `recordTranscriptMessage` swallowed write failures, survivable only because
`cello_receive` served from an in-memory buffer. Tier 1 deleted that buffer read **and left the
comment saying it existed**. A local SQLCipher failure then surfaced as *"no content arrived"* — the
counterparty's label on a local fault.

**Rule.** *When you delete a mitigation, hunt the comments that justified it. A stale comment
asserting a property the code no longer has is a false all-clear at exactly the site a reader
consults.*

### 3. Two sessions could both reply to one message

**Root cause.** Two awaits sit between the gate and the commit. Both callers were **legitimately**
caught up when checked, and nothing changed between them *because* no leaf had been appended yet.

**Rule.** *A gate not re-checked before the irreversible act is a suggestion. And the re-check must
ask something the original authorities cannot answer, or it is the same check spelled twice.*

### 4. The fix guarded the narrower of the two awaits

**Root cause.** It is true a send cannot be *refused* after the wire — the counterparty already holds
it, and refusing would strand the session. It does **not** follow that checking only before it
suffices. `sendContent` is the last await *and* the wider one. Closed with a **claim** rather than a
later check: a sibling that finds it held is refused before its own wire call, so nothing is
stranded.

**Rule.** *When a constraint rules out the obvious fix, the next idea is not automatically safe. "I
cannot check after X" and "so checking before X is enough" are different claims; the second needs its
own proof.*

### 5. The received-only view, three times

**Symptom.** Three defects, one shape: delivery pinned forever; the `since_seq` watermark refusing to
advance so reading everything never cleared unread; and the need for a catch-up door at all.

**Root cause.** Leaf indices are contiguous across **both** directions, so **any set built from
received messages alone has holes wherever the agent sent something** — and a sibling's reply is the
most ordinary event in the protocol.

The third occurrence is the instructive one: `daemon.ts` already said *"every sibling send is a
hole"* **in as many words**, and the regression landed one file over, in the same milestone, by the
author of that sentence.

**Rule.** *In a two-directional log with one index space, "the messages I received" is not a range —
it is a set with holes. Writing the warning down does not inoculate you.*

### 6. Three units shipped with the fix fully deletable and the suite green

A reviewer removed the entire wiring of a "finished" fix and got 1296/1296 green, with a clean
typecheck. Three separate times.

**Rule.** *The revert test is the acceptance criterion, not the assertion count. "Green" without it
means "the fix is not connected to anything."*

### 7. A test that passed against the broken build

It stubbed `recordTranscriptMessage` — which replaces the `try/catch` that **is** the defect, so the
throw under test was the stub's own.

**Rule.** *When testing a swallow, do not replace the swallower.*

### 8. `attendance: 0` — worse than the missing field it replaced

A connection reaching the handler through the sole-online fallback (every CLI call without a
persisted selection) was not counted **including itself**, and was told zero sessions attend the
agent it was reading.

**Rule.** *A response the caller is holding can never honestly report zero of the thing that produced
it.*

### 9. A guard that could not fail

`dist-freshness` asserted each MCP tool by substring — and `cello_get_sealed_receipt` *is* in the
bundle, inside `proxy.call(...)`. Three renames shipped straight past it. Now anchored to
`server.tool("…"`, with a clause asserting the IPC names are **not** registered.

**Rule.** *A guard that cannot fail is worse than no guard: it is a claim of coverage.*

### 10. Dead code that could not be given a red build

A clause was asked for to keep a deferred deletion honest. It was written, it passed, the subject was
then deleted — and it **still** passed. Not a hollow test but the answer: the branch had become
unreachable.

**Rule.** *Unreachable code has no red build to manufacture. Record the deletion probe as the proof;
never ship a green clause that cannot fail.*

## Decisions

- **M8D-D1** — the two-connection fixture is **extracted** from `m8c-cursor-1.test.ts`; the fixture
  CLAUDE.md points at no longer exists in either repo.
- **M8D-D3** — the catch-up door is **`cello_get_transcript`**. Rejected: widening `cello_receive`,
  which post-Tier-1 would make *receive* return the agent's own **sent** messages — a different verb
  wearing the same name.
- **AC1 of SENDWINDOW deviated deliberately** — outbound, the commit point is the wire, not the
  append. Refusing at the append would leave the counterparty holding content this side never leafed:
  `DOD-FRONTIER-STRAND-1` manufactured to satisfy the letter of an AC.
- **The counterparty still sees ONE agent, with no session ordinal.** Deliberate: putting a session
  ordinal on the wire would leak the operator's window structure to a third party for no protocol
  benefit.

## Spine recovery (alongside, 2026-08-02)

**Thirteen files went from fully red to fully green, none needing a product change** —
`j-unilateral`, `j-int`, `j-sig`, `j-persist`, `j-leg-frontier`, `j-upgrade`, `j-upgrade-bilateral`,
`j-suspend`, `j-canary`, `j-combined-journey`, `j-end`, `j-trust-journey`, `j-track-record`; plus
`j-spine` 0→4/7, `j-content` 3→5/10, `j-remove` 0→2/3.

Every cause was drift the tests never followed: a two-part consortium setup · three MCP/IPC tool
renames · in-band turn signals · `agent_name` → `agent_id` · a mandatory `same_operator` slot
appended to a closed 12-field preimage · the `subject` column **dropped** so a federated directory
never retains what a subject *is* · and one unstarted database.

`j-end` is the one worth naming: the full endorsement journey, ten hops — Bob issues, the portal
drains and mints, Alice receives it *pending and inert*, presents to Charlie who hears **Bob's voice,
not CELLO's**, self-endorsement refused at the source, a co-owned endorsement flagged and not
counted. **No code change at all**; the portal's Postgres had simply never been running.

Two traps recorded from that work: converting a single-directory test to a consortium can make a
clause **assert nothing while looking green** (`j-sig` kills "the" directory — with three nodes that
leaves two serving), and a batch rewrite that misses a call shape produces failures indistinguishable
from product defects.

## What this unblocks

Several Claude sessions on one agent — a second terminal, a listener, an operator watching a live
conversation — without message theft, without duplicate replies, and without a session silently
falling behind with no way back. That is the multi-session half of the launch intent: *your own two
agents connect, across devices or two sessions on one device.*

## What remains

- **`DOD-FRONTIER-MISMATCH-DURABLE-1`** 🅿️ — the mismatch store is in-memory, so a daemon restart
  forgets. Costs one re-detection on the next close attempt; can never produce a *wrong* answer.
- **`DOD-SPINE-JCONTENT-1`** 🅿️ — five `j-content` clauses (M8C `DOD-MSG-*` debt, all failing
  pre-Tier-1 too) and three `j-spine` behavioural questions (a `cello_status` shape change, the
  three-state model returning `online` where `current` is expected, a readiness race).
- **`j-legibility`** — left **red on purpose**: its `…` tail arrives as `...` because the gateway
  returns a **redact** verdict for a money-demand tail. That is a product decision, and patching the
  assertion would bake in whichever reading is wrong.

## The lesson the milestone actually taught

**Every blocking finding came from an adversarial reader, never from a green suite** — and each was
the same failure wearing different clothes: *a fix verified against the layer it was written at, then
described as broader than it was.* The tests were real each time; the **claim** was not. Twice the
overclaim reached three places at once (code comment, commit body, journal), which is worse than the
omission: a reader trusting any of them would never go looking.

The live testing taught the matching lesson about process. The first journey was run by front-loading
three prompts of instructions and scripting the sessions; it re-confirmed only what the unit tests
already knew. Andre's correction — **brief the sessions, never give them the sequence, and hand the
orchestrator one paste at the moment it is needed** — produced *every* piece of new information: the
AC6 failure, its precise shape, and its eventual pass.
