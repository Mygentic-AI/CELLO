---
name: M8D — Co-attendance
type: milestone-writeup
date: 2026-08-02
updated: 2026-08-02
milestone: M8D
status: open — five lines proven, VISIBLE-1 AC6 fixed and awaiting its live re-run
description: >
  M8D lets several Claude sessions drive ONE agent identity without stealing each other's
  messages. Delivery moves from a destructive shared queue to a durable record read against a
  per-connection bookmark; the doorbell stays multicast; the send path stops letting two
  sessions answer one question.
---

# M8D — Co-attendance

**Started:** 2026-08-01 · **Status:** five lines ✅ (three of them **proven live** on real binaries);
`DOD-COATTEND-VISIBLE-1` AC6 failed its live test, was fixed, and awaits one re-run.
Published: daemon `0.0.119` / cli `0.0.122` / connect `0.0.116`.

Co-attendance is the property that several sessions can attend one agent at once — a second terminal,
a listener, an operator watching over a running conversation. **Exclusivity was rejected permanently
(§3):** locking an agent to one session would foreclose listener mode, and co-attendance gets that
capability for free. The milestone is therefore about making shared attendance *correct*, not about
preventing it.

## What was delivered

- **Per-session delivery** (`DOD-COATTEND-1`) — delivery reads the **durable transcript** against a
  **per-connection bookmark** instead of popping a shared queue. Two sessions both receive the
  message; neither removes it. Three sessions prove listener mode.
- **The theft is visible** (`DOD-COATTEND-VISIBLE-1`) — Tier 0. Before it, a robbed session was told,
  word for word, what a quiet counterparty produces, and nothing was logged anywhere.
- **A working catch-up door** (`DOD-COATTEND-CATCHUP-1`) — `cello_get_transcript` is *the* door
  (M8D-D3), because it covers both directions and every refusal already points at it.
- **Two sessions cannot both answer one question** (`DOD-COATTEND-SENDWINDOW-1`) — the send path
  re-checks the conversation's frontier immediately before the wire.
- **Two receptionists stop fighting** (`DOD-RECEPTIONIST-AGENT-1`) and **the inbox agent**
  (`DOD-INBOX-AGENT-1`) — both ✅ PROVEN.

## Bugs found and fixed

### 1. The delivery bookmark was the send gate's cursor

**Symptom.** A co-attending session received the same message on every `cello_receive`, forever, and
never saw the next one. A Claude session on the far side of the shim kept replying to it.

**Root cause.** Delivery used `safeCursorAdvance` — the **send gate's** cursor, which by design
refuses to walk past a gap. Two different questions had been answered with one mechanism:

| | question | wants |
|---|---|---|
| the gate | has this connection seen **every** leaf? | to STOP at a gap |
| delivery | what have I already **handed** this connection? | to never stop |

Leaf indices are contiguous across **both** directions, so a message the agent sent from another
connection is a hole in a co-attending connection's received-only view. Blast radius was wider than
co-attendance: a fresh `connectionId` starts at −1, so an MCP reconnect or *any* `cello` CLI command
(fresh connection per command) hit it on any session that had ever sent. A security-gateway terminal
block, which commits a leaf and writes **no** transcript row, made it permanent.

**Fix.** A separate per-connection delivery bookmark, monotonic MAX, dying with its connection.
`safeCursorAdvance` and every gate call site untouched.

**Rule.** *Before reusing a mechanism, state the question it answers. Two questions that share a
data shape are still two questions — and a property that is essential to one (gap-safety) can be
fatal to the other.*

### 2. A swallowed transcript write became total silent content loss

**Symptom.** A message was verified, leafed, hash-chained, the doorbell rang — and every attached
session timed out with *"Call cello receive again to keep waiting."*

**Root cause.** `recordTranscriptMessage` swallows a write failure. Its comment explained why that
was survivable: *"cello_receive still delivers it live from the in-memory buffer (masking the
loss)."* Tier 1 deleted that buffer read **and left the sentence**, so the code reassured the next
reader about a safety net that no longer existed. A local SQLCipher failure surfaced as the
counterparty being quiet, 30 seconds later and one subsystem away.

**Fix.** The write now **reports**; the ingest returns `{ok:false, transcript_write_failed}` — the
failure arm its contract already had; `cello_receive` answers `content_undeliverable` naming the
local fault. The committed leaf stays: unwinding it would corrupt a frontier the counterparty already
co-signs against.

**Rule.** *When you delete a mitigation, hunt the comments that justified it. A stale comment
asserting a property the code no longer has is worse than no comment — it is a false all-clear at
exactly the site a reader consults.*

### 3. Two sessions could both reply to one message

**Symptom.** The counterparty asked once and got two answers — both correctly signed, both correctly
ordered, the record coherent, the conversation not.

**Root cause.** Between the gate passing and the message becoming irreversible sit two awaits (the
gateway round trip and the wire). The gate was never re-checked. Both callers were **legitimately**
caught up when checked, and nothing changed between them *precisely because* no leaf had been
appended yet.

**Fix.** A frontier snapshot at the gate, re-read immediately before `sendContent`, with an explicit
no-await comment. **Not** a re-run of the gate: its second authority is the agent-scoped watermark,
so once any connection reads, `unreadReceived === 0` for all of them and a re-run would wave the
racing sibling through exactly as it waved the first.

**Rule.** *A gate that is not re-checked before the irreversible act is a suggestion. And the
re-check must ask a question the original authorities cannot answer — otherwise it is the same
check, spelled twice.*

### 4. The send-window fix guarded the narrower of the two awaits

**Symptom.** After the fix, two sessions could still both reply — reproduced by review on a real
daemon with two real IPC connections: two `ok:true`, two frames on the wire, two leaves.

**Root cause.** The re-check was placed before `sendContent` on the argument that a send cannot be
*refused* after the wire (true — the counterparty already holds it, and refusing manufactures the
frontier strand). The conclusion did not follow. **`sendContent` IS the last await, and the wider
one** — relay submit, stream open, stream close, a network round trip in production, against the
gateway round trip the check covered. The DoD names two awaits; one was guarded and it was written
up as both.

**Fix.** A **claim**, not another check: a per-(agent, session) in-flight marker taken in the same
synchronous window as the frontier comparison and released when the wire call settles. A sibling that
finds it held is refused *before its own wire call*, so nothing is stranded and the argument that
ruled out a post-wire refusal never applies.

**Rule.** *When a constraint rules out the obvious fix, the next idea is not automatically safe.
"I cannot check after X" and "so checking before X is enough" are different claims, and the second
one needs its own proof.*

### 5. The received-only view, three times

**Symptom.** Three separate defects, one shape. (a) Delivery pinned to one message forever. (b) The
`since_seq` watermark stopped advancing, so reading everything no longer cleared unread and a
stateless CLI caller was refused forever. (c) The catch-up door had to exist at all.

**Root cause.** Leaf indices are contiguous across **both** directions, so **any set built from
received messages alone has holes wherever the agent sent something** — and a sibling connection's
reply is the most ordinary event in the protocol. Every walk over a received-only set stops there.

The third occurrence is the instructive one: `daemon.ts` already said *"every sibling send is a
hole"* **in as many words**, in the comment written for (a) — and (b) was introduced one file over,
inside the same milestone, by the same person who wrote that sentence.

**Fix.** Every contiguity walk covers both directions. What may still stop a walk is a genuinely
absent index — an undecryptable row or a screened-out leaf, which have no transcript row and *are*
unread.

**Rule.** *In a two-directional log with one index space, "the messages I received" is not a range —
it is a set with holes. Any walk, cursor, or watermark built on it must either cover both directions
or state in one line why the holes are acceptable. Writing the warning down does not inoculate you:
this was reintroduced by the author of the warning, one file away, within days.*

### 6. Three units shipped with the fix fully deletable and the suite green

**Symptom.** A reviewer removed the entire wiring of a "finished" fix and got 1296/1296 green with a
clean typecheck. Three separate times in one milestone.

**Root cause.** Each test was verified against the layer it was written at, not through the layer
that runs — asserting on a store, a renderer, or a helper the production path never reaches.

**Fix.** Drive the real entry point, then **revert the fix and watch it go red**. Every M8D clause now
carries a revert result.

**Rule.** *The revert test is the acceptance criterion, not the assertion count. "Green" without it
means "the fix is not connected to anything."*

### 7. A test that passed against the broken build

**Symptom.** The first version of the write-failure test passed before the fix existed.

**Root cause.** It stubbed `recordTranscriptMessage` — which **replaces the `try/catch` that IS the
defect**, so the throw under test was the stub's own. The failure has to originate *under* the catch,
so the fix was to break `db.prepare` instead.

**Rule.** *When testing a swallow, do not replace the swallower.*

### 8. Dead code that could not be given a red build

**Symptom.** The review asked for a deleted clause to be re-pointed at `ContentTakeLedger.forget()` so
a deferred deletion would keep its red build. The clause was written; it passed; `forget()` was then
deleted and it **still** passed.

**Root cause.** Not a hollow test — the answer. Delivery is non-destructive now, so a fresh connection
is *handed* the content instead of timing out, and the sibling-theft discriminator is unreachable.

**Rule.** *Unreachable code has no red build to manufacture — that is what unreachable means. Record
the deletion probe as the proof; do not ship a green clause that cannot fail.*

### 9. A review finding that was wrong, caught by the typecheck

**Symptom.** A finding said a `record ?` guard was dead code. Removing it failed `tsc`.

**Root cause.** A transcript-only session (transcript rows, no `sessions` row) does not return — it
falls through with `record === null`. Removing the guard is a null dereference on the one session
shape that reaches there without a record.

**Rule.** *A review finding is evidence, not an instruction. Run the gate before acting on one.*

## Decisions

- **M8D-D1** — the two-connection fixture is **extracted** from `m8c-cursor-1.test.ts` rather than
  written from scratch; `packages/e2e-tests/src/session-fixture.ts`, which CLAUDE.md points at, no
  longer exists in either repo.
- **M8D-D3** — the catch-up door is **`cello_get_transcript`**. Rejected: widening `cello_receive` to
  both directions, which post-Tier-1 would make *receive* return the agent's own **sent** messages —
  a different verb wearing the same name.
- **AC1 of SENDWINDOW-1 deviated deliberately** — it asks for the re-check beside
  `appendSessionLeaf`, but outbound the append runs *after* the wire. Refusing there would leave the
  counterparty holding content this side never leafed: `DOD-FRONTIER-STRAND-1` (the defect that left
  `dbb93dfc…` unsealable for a week) manufactured on purpose to satisfy the letter of an AC.

## What the live journey proved — and what it broke

Three real `claude --channels` windows on the promoted binary: two attending one agent, one driving
the counterparty.

- **One message, two sessions, both received it** — identical content at identical
  `sequence_number`, and the second session had sent nothing, so only genuine delivery explains it.
  That is the milestone's central claim, on the shipped binary rather than a fixture.
- **The catch-up door works** — the second session's transcript showed the *other* session's reply,
  which `cello_receive` can never hand it.
- **AC6 FAILED, and that was the run's most valuable output.** Asked an open question with no
  mention of co-attendance, the second session said the transcript and wire were *"silent on it"*.
  Attendance rode the **push** and `cello_status`; every **read** surface was silent — so any
  session that never saw a doorbell (a fresh MCP client, *every* `cello` CLI invocation, anything
  attached after the last arrival) could not learn it was not alone. Fixed; the re-run is owed.

A correction worth keeping: the counterparty session reported *"two replies to one question — that's
the defect"*. **It is not.** Two windows of one agent deliberately do not gate each other; the
principal is the agent, not the socket. The mis-framing came from the prompt I wrote, and left alone
it would have entered the record as a live-confirmed defect that does not exist.

## What this unblocks

Several Claude sessions on one agent — a second terminal, a listener, an operator watching a live
conversation — without message theft, without duplicate replies, and without a session silently
falling behind with no way back. That is the multi-session half of the launch intent: *your own two
agents connect, across devices or two sessions on one device.*

## What remains

**The live two-session `claude --channels` journey** (`DOD-COATTEND-1` AC7,
`DOD-COATTEND-VISIBLE-1` AC6, and the first live exercise of SENDWINDOW/CATCHUP). Four lines are 🟡
purely for want of it. Every one is green on a real daemon over real IPC with a revert probe behind
it — but **vitest green ≠ done** is this project's own milestone-close rule, and it holds here.

Blocked on two operator-only steps: the `latest` dist-tag promotion (commands in journal Entry 21)
and the `/mcp` reconnect.

**Parked:** `DOD-FRONTIER-MISMATCH-DURABLE-1` — the mismatch store is in-memory, so a daemon restart
forgets. Costs one re-detection on the next close attempt and can never produce a *wrong* answer;
persisting it means a client-side schema migration on every operator's machine, which the AC does not
ask for.
