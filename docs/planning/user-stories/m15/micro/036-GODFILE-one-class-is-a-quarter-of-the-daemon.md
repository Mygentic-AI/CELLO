---
name: 036-GODFILE — One class is a quarter of the daemon
type: micro-work-order
date: 2026-09-06
status: open
dod_line: DOD-M15-GODFILE-1
dod_effect: closes
description: >
  session-node-manager.ts is 19,878 lines, 1.2 MB, one class of 555 members — 25% of the entire
  daemon, holding session state, the whole inbound ingest chain, authorship and acknowledgement
  verification, quarantine, transcripts, relay ordering and park recovery. It is past the size at
  which a coding agent works reliably, on the most load-bearing code in the product. Split it to
  under 4,000 lines behind an ESLint ratchet, as PURE MOVEMENT with the comments carried verbatim.
---

# **<ins>MICRO</ins>** WORK ORDER 036-GODFILE — Split the 19,878-line class

> ## THE RULES OF THIS WORK ORDER
>
> 1. **Read [[M15-PROCEDURE]] IN FULL before you start.** It binds you — the gate, the review
>    dispatch, the invariants, how tests are run. **Do not read `M15-DEFINITION-OF-DONE.md` or
>    `M15-BUILD-JOURNAL.md`** — this order carries everything you need from them.
> 2. **ONE MISSION: move code out of one file without changing what it does.** Never grow it.
> 3. **Found something else?** Write it under *Newly discovered* at the foot of this file and
>    **keep going.** Do not fix it. Do not investigate it. This applies to defects too — a bug you
>    spot in code you are moving gets recorded and moved unchanged.
> 4. **⚠️ THE 500-LINE CAP IS SUSPENDED FOR THIS ORDER, and here is the reason so nobody
>    reinstates it by reflex.** The cap exists because a large diff hides new logic that nobody can
>    review. This order adds **no logic at all** — every line is a move, and a diff that is not a
>    move is a violation of Rule 2. The unit of review here is **the PART**, not the line count.
>    A part that adds behaviour is a failure whether it is 50 lines or 5,000.
> 5. **Standard procedure still applies:** implement → review (`cello-unit-reviewer`) → fix every
>    finding → commit. Commit per fix, push after every commit.
> 6. **REPORT AS YOU GO.** After each part closes, update the **Progress** table below and flip that
>    part's line to ✅ **in the same commit as the part itself**. That table is how anyone reading
>    this file knows where you are without asking. Do not batch the updates.
> 7. **Done is done.** When the Definition of Done is met, stop — even if parts remain unstarted.
>    See the stop rule in Part 6.

---

## Progress — UPDATE THIS AS YOU GO (Rule 6)

| Part | What | Status | Lines after |
|---|---|---|---|
| 0a | The comment sweep of this file | ✅ done | 20,389 |
| 0b | The ratchet | ✅ done | 20,389 (grandfathered) |
| 1 | Who sent this, and did they see what they claim | ⚙️ in progress | — |
| 2 | Taking a message in | ⬜ not started | — |
| 3 | Holding what was refused | ⬜ not started | — |
| 4 | Where a message sits in the order | ⬜ not started | — |
| 5 | The conversation record | ⬜ not started | — |
| 6 | Mail that waited | ⬜ not started | — |
| — | Live two-daemon smoke test | ⬜ not started | — |

Statuses: ⬜ not started · ⚙️ in progress · ✅ done · ⏭️ not needed (target already met).
**"Lines after"** is `wc -l core/daemon/src/session-node-manager.ts` once that part's commit lands.

---

## Where this work lives

**Repo:** `cello-client` — `core/daemon/src/session-node-manager.ts` and new siblings beside it.
**Its own worktree, its own branch.** Nothing else lands in that tree while this runs.
The only other file touched is `cello-client/eslint.config.mjs` (Part 0b).

---

## What this fixes, and it is not tidiness

`session-node-manager.ts` is **19,878 lines, 1.2 MB, one class, 555 members**. It is **25% of the
entire daemon**. The next largest file in the repo is 6,077.

It is a correctness item because **it is past the size at which a coding agent works reliably, and it
holds the most load-bearing code in the product** — whether a message is accepted, who it is
attributed to, and whether it is recorded. Every mistake made in here is a mistake there.

It is also the first file an evaluator points a coding agent at.

---

## 🎁 READ THIS BEFORE ESTIMATING — three measurements that set the shape

**1. It was never refactored. Do not go looking for a previous attempt.**

```
2026-06-12    525      2026-08-22  10,073
2026-07-13  4,446      2026-09-01  14,206
2026-08-04  5,501      2026-09-04  18,225
2026-08-07  6,174      today       19,878
```

Monotonic. No drop anywhere. Nearly half the growth is in the last three weeks.

**2. The refactor that DID happen proves a split alone is not the fix.** Nine commits in mid-July
took `daemon.ts` apart (`refactor(daemon): Seam A…I — X out of startDaemon's body`) and cut it from
**6,279 lines to 2,081 on 14 July**. It is **6,077 today** — fully regrown in under two months,
because nothing stood in the way. **That is why Part 0b comes before any code moves.**

**3. What makes this affordable.** `core/daemon` has **310 test files and 95,339 lines of test
code** — more test code than production code. That is the safety net, and Rule B below is how to use
it correctly.

---

## The five rules of the work — each one is a STOP CONDITION

**A. PURE MOVEMENT.** No renames. No logic changes. No de-duplication. No "while I'm here". A diff
that is not a move belongs to a different unit — record it under *Newly discovered* and keep going.

**B. THE TESTS PASS UNCHANGED.** With 310 test files, a test that *has to* change is not a test that
was wrong — **it is proof you changed behaviour.** Stop, revert the part, work out what moved. The
only legitimate exception is an import path, and even that should be rare if each new module keeps
the same exported surface.

**C. THE COMMENTS MOVE VERBATIM.** 53% of this file is prose — roughly 10,500 lines explaining why
each check exists, much of it recording a defect that was reintroduced once already and the false
reasoning that allowed it. **They are the asset, not the padding.** A summarised comment loses more
than the split gains. They travel with the code they describe, unedited — ⚠️ blocks included.

**D. NOTHING PRIVATE BECOMES PUBLIC.** See the next section. This is the one that will bite.

**E. ONE PART PER SESSION.** Commit per part, push after every commit, update Progress in the same
commit.

---

## ⚠️ THE TRAP — verified, and it will bite

**This is ONE CLASS with `#private` fields** — `#activeNodes`, `#db`, `#logger`,
`#standingReceivers`, `#contentDesynced`, `#witnessedSeq` and others. The methods you are moving read
and write them freely today because they all sit inside the same class body.

Move a method into a module and it can no longer see them. There are three ways out and **two are
worse than the god file**:

- ❌ **Widen the fields to public** so the new module can reach them. This turns encapsulated session
  state into a public surface any file in the daemon can write to. **A part that does this has made
  the codebase worse and must be rejected at review.**
- ❌ **Pass the whole `this`** into the extracted function. That is the god object with extra
  indirection and one more hop to follow.
- ✅ **Declare the narrow state the part needs, BEFORE moving anything** — a small explicit parameter
  object, or a small interface the class implements. If a part cannot state its dependencies in a
  short list, **that is not a seam**: stop, record why under *Newly discovered*, and move to the next
  part.

**This declaration is step 1 of every part below and it is blocking.** Write the list first.

---

## Part 0a — Sweep this file's comments FIRST. Blocking.

**Ruled by Andre 2026-09-06.** [[M15-PUBLIC-COMMENT-SWEEP]] has items **inside this file**, including
its highest-priority one: **`session-node-manager.ts:9760`** still says the relay hash-submit
cross-check *"does not exist yet"* and names the exact bypass a malicious sender would use. It
exists — the relay witnesses submissions and `#verifyAuthorshipClaim` verifies the sender's signature
on every content frame.

**Moving a stale comment verbatim gives you a stale comment in a new file**, and puts two units on
the same lines for different reasons.

Do only the items in [[M15-PUBLIC-COMMENT-SWEEP]] that fall in this file. **Rewrite, never delete** —
the record of the old defect is the point. Verify the classification before acting: a wrong
stale-verdict rewrites a comment into a lie, which is worse than the comment.

Commit, push, flip Progress row 0a.

## Part 0b — The ratchet. Blocking, and it lands BEFORE any code moves.

A `max-lines` ESLint rule in `cello-client/eslint.config.mjs`, following **the pattern already in
that file** for blocking `node:sqlite` — one rule, one visible allowlist entry, no second mechanism.

- `session-node-manager.ts` grandfathered at its **current** size.
- Every other file gets the ordinary ceiling. **Two files already exceed any sane ceiling and are NOT
  this order's work** — `daemon.ts` (6,077) and, in the other repo, `directory-node.ts` (7,403).
  Grandfather `daemon.ts` at its current size too, and say in the comment that it is owed.
- **Lower the grandfathered number for `session-node-manager.ts` after each part lands.** The rule is
  what holds the ground each part takes.

Commit, push, flip Progress row 0b.

---

## Parts 1–6 — the seams

Each part is the same five steps:

1. **Declare the state it needs** (see THE TRAP). If the list runs long, stop and record it.
2. Move the code and its comments verbatim into a new sibling module.
3. `pnpm run test` → `pnpm run lint` → `pnpm run typecheck`.
4. `cello-unit-reviewer` — **name the removal/refactor integrity lens when you dispatch it**; that is
   the one that fires on a diff which moves or deletes code (proven deadness, deleted-test triage,
   built-artifact absence, behaviour preservation). Fix every finding, commit per fix.
5. Commit, push, update Progress with the new `wc -l`.

### Part 1 — *Who sent this, and did they see what they claim*

`#verifyAuthorshipClaim`, `#verifyAcknowledgedContent`, and the `AUTHORSHIP_*` / `ACK_HASH_*`
constants.

Two questions about one signed blob: *did this really come from this conversation's counterparty*,
and *is what they say they saw actually what we sent*. **First because it is the most self-contained,
has the heaviest test coverage, and is security-critical** — so it gains most from being readable,
and it proves the trap pattern on a small surface before Part 2 needs it.

> ⚠️ **THE ORDER OF THE CHECKS INSIDE IT IS ITSELF A SECURITY PROPERTY** — decode → signature →
> signer → what the proof is about. Everything after the signer answers `unusable`, which refuses the
> message and leaves the session alive; signature and signer answer `refuted`, which FREEZES it. A
> check that can answer before the signature is verified hands a peer a switch for choosing the
> softer outcome. **That ordering, and the comment explaining it, must survive the move exactly.**

### Part 2 — *Taking a message in*

`ingestReceivedContent` and its refusal chain — ten named refusals from `session_orphaned` through to
`transcript_write_failed`. The biggest single win: this is where a reader most needs to follow the
file and currently cannot.

### Part 3 — *Holding what was refused*

`#quarantineRefusedContent`, `#orphanEvidence`, and the triage of a message that cannot be attributed
to any session.

### Part 4 — *Where a message sits in the order*

`#recordFrameOrdering` and the relay position records.

### Part 5 — *The conversation record*

Transcript reads and writes, seal leaf storage, the unread accounting.

### Part 6 — *Mail that waited*

Park recovery — the caller of `authenticateParkedEntry` and the recovery ingest path.

> ### 🛑 THE STOP RULE
> **The target is the finish line, not the part list.** If Part 4 gets the file under 4,000 lines,
> Parts 5 and 6 are **not owed**. Mark them ⏭️ in Progress, note it in the close-out, and stop.

---

## The target — SETTLED with Andre 2026-09-06. Do not re-open.

**Under 4,000 lines is the pass bar. ~2,500 is the aim** — roughly where `daemon.ts` landed after its
own split, so it is a proven shape rather than a number someone liked.

**NOT under 1,000.** Considered and rejected: it would force seams the code does not have and scatter
shared state across many files, which is worse than one large cohesive class.

**No phased ceiling.** An earlier draft proposed 10k → 5k → 2k as stages. That buys nothing when one
agent runs this to completion in a worktree — there is no intermediate release and nobody consumes a
10k milestone. The reviewable unit is the PART, and per-part commits already give that.

---

## Verification — one item here is specific to this work

**⚠️ `pnpm run build:clean`, NOT `pnpm run build`.** `tsc --build` is incremental and **never deletes
an output whose source is gone**, so a deleted or renamed module leaves its `.js` behind in `dist/`.
Normal feature work adds files, so this never shows — **refactoring is the one operation that removes
them, which is why it bites here and nowhere else.** Verify a deletion against the **BUILT artifact**,
never against `src/`: "the file is gone from src" proves nothing about what exists in `dist/`.
The script was added 2026-09-06 and clears the `.tsbuildinfo` files too — without that, tsc believes
it is up to date and emits nothing at all.

**Gate, every part:** `pnpm run test` → `pnpm run lint` → `pnpm run typecheck`.

**At the end of the campaign, a live two-daemon smoke test** — two real daemons, a session, messages
both directions, a seal. **Vitest green is not the close condition.** The milestone rule is that
nothing closes on unit tests alone, and this work touched the ingest path.

---

## ⏰ The watchdog cron — ARM IT BEFORE PART 0a. Blocking.

**This is a long-running session — expect it to span compactions.** [[M15-PROCEDURE]] §3b defines the
30-minute watchdog; arm it as written there, and **re-arm after every compaction or restart**. It is
a defibrillator, not a metronome: if you are working, keep working.

**Four checks are added to §3b's fired prompt for THIS order, and they exist because a long refactor
drifts in four specific ways.** Ask them in this order — the first two are stop conditions:

1. **Did a test file change?** `git diff --name-only origin/main -- '*__tests__*' '*.test.ts'` — if
   anything but an import path moved, **STOP**. Rule B: that is proof behaviour moved, not that a
   test was wrong.
2. **Did a `#private` field become public?** `git diff origin/main -- core/daemon/src/session-node-manager.ts | grep -E '^-\s+#\w+'` against the additions — if a field lost its `#`, **STOP**. Rule D, and it is invisible to
   every test.
3. **Are you still MOVING, or did you start improving?** The characteristic drift on a long refactor
   is an agent that begins renaming, tidying or fixing what it reads. Re-read Rule A. Anything that
   is not a move goes under *Newly discovered*, unfixed.
4. **Is the Progress table current?** Rule 6. If a part closed and the table still says ⬜, the commit
   that closed it was wrong — fix it now.

**The one status line for this order is a number:**

```
wc -l core/daemon/src/session-node-manager.ts
```

Report it every time. 19,878 at the start, under 4,000 at the end — anyone reading the heartbeat can
see the whole job's progress in one figure, which is the point.

**Self-terminate when the Definition of Done is met** — not when the part list is exhausted. See the
stop rule in Part 6.

---

## Definition of Done

- [ ] Part 0a landed: the sweep items in this file are fixed, rewritten and not deleted.
- [ ] Part 0b landed: `max-lines` in `eslint.config.mjs`, one allowlist entry, CI enforces it.
- [ ] `session-node-manager.ts` is **under 4,000 lines**.
- [ ] The ratchet's grandfathered number has been lowered to the final size.
- [ ] Every extracted module declares the state it needs; **no field changed from private to public**.
- [ ] The full suite passes with **no test file modified** except import paths.
- [ ] **No comment was summarised, shortened or dropped.**
- [ ] `pnpm run build:clean` produces a `dist/` with no artifact whose source no longer exists.
- [ ] `cello-unit-reviewer` ran on every part and every finding is fixed.
- [ ] A live two-daemon smoke test passed: session, messages both ways, seal.
- [ ] The Progress table reflects reality, including any ⏭️ parts.
- [ ] `status:` in this file's frontmatter flipped to `complete` in the same commit as the verdict.

**Publishing is NOT part of this order.** It ships with the next release via `/cello-publish`, which
verifies against the tarball.

---

## Explicitly out of scope

- **`daemon.ts` (6,077)** and **`directory-node.ts` (7,403, other repo).** Both need the same
  treatment; neither is this order. Part 0b grandfathers `daemon.ts` so the ratchet does not block on
  it.
- **Any behaviour change**, including ones that look obviously correct, and including bugs you find
  in code you are moving. Record under *Newly discovered*.
- **Comments that are correct as they stand** — the deliberate bounded fail-opens and the stated
  trust bounds in [[M15-PUBLIC-COMMENT-SWEEP]]. They move verbatim like everything else and are not
  reconsidered here.

---

## Traps recorded before you start

1. **`dist/` lies after a deletion.** See Verification. The single most likely way this order reports
   success on something that is not true.
2. **Widening private state is the failure mode**, not a shortcut. It is invisible in tests — every
   test still passes — and it is what makes the codebase worse than before.
3. **The comments look like padding and are not.** Several record a defect that came back once
   already. A part that "tidies" them has destroyed the thing that stops the next one.
4. **A test that needs changing is a red flag, not a chore.** Do not adjust a test to fit a move.
5. **iCloud writes into `dist/`.** `~/Documents` is synced and has produced empty conflict
   directories inside the build output before (`bin 2` … `bin 8`). Harmless, but it means a local
   `dist/` is not always exactly what the compiler put there — another reason for `build:clean`.

---

## Newly discovered

_(Anything found while working that is not this mission. Record and keep going.)_

> **SPAWN TRIP-WIRE COUNT (M15-PROCEDURE §0z.2): 2 of 3, as classified below — written down so the
> next reader can disagree with the classification instead of re-deriving it.** Items 1 and 3 are
> findings that need their own unit and they COUNT. Item 2 does not: it needs no unit, because it is
> discharged inside this order — Part 2 moves `ingestReceivedContent` and Rule C already requires
> carrying its documentation along. **If a third countable item appears, this order STOPS and
> reports before starting any of them.**
>
> **Is the vein still producing production defects, or has it turned into hygiene?** Mixed, and
> trending toward hygiene. Item 1 is a genuine production-facing disclosure defect — the same class
> as the sweep's highest-priority item, readable in a public repo. Item 3 is test infrastructure.
> Nothing so far is a defect in what the daemon *does*, which is the expected shape for a pure-movement
> order and is the reason it has not tripped.

**Measurement correction, not a finding.** The file was **20,368** lines at the branch point
(`e9f7f8c`), not the 19,878 in this order's frontmatter — it grew ~490 lines in the days between the
order being written and being picked up. It does not change the target (under 4,000) or the shape of
the work; it is recorded so the ratchet's grandfathered number is set from a measurement rather than
from this file. Part 0a's rewrite added 21 more, so the ratchet starts at 20,389.

**1 · `sendContent`'s doc block carries the SAME stale claim B1 was raised for.** Found while
verifying B1; it is not on [[M15-PUBLIC-COMMENT-SWEEP]], so under Rule 3 it is recorded and left
alone. `session-node-manager.ts` `sendContent` (~line 8698, *"SCOPE / findings #3 + #4"*) still tells
a public reader that the send path *"does NOT also submit a K_local-SIGNED content_hash leaf to the
RELAY … that relay hash-submit is MSG-001's scope"*, and that *"because there is no relay yet"* the
sequence number is a local leaf index rather than a relay-assigned one. **The relay hash-submit path
exists** — the same fact that made B1 stale — so at minimum the first half is out of date, and the
second half's premise (*"there is no relay yet"*) is false on its face. **Category B, same as B1, and
by the same argument it is worth more than tidiness: it is the sentence an evaluator's coding agent
collects.** Needs the same verify-then-rewrite treatment, including checking whether the ordering
half is genuinely still open before rewriting it — B1's lesson is that the two halves of one stale
paragraph went stale at different times.

**3 · The full suite is NOT deterministic, and Rule B has to know it.** `commands.test.ts` AC2
(*"logout;login against a REAL spawned daemon yields 'Daemon started.'"*) failed once and passed
twice across three full-suite runs on this branch, with nothing between the runs but an ESLint config
change vitest never reads. **The condition, not a guess:** `connect-or-start.ts` `spawnDaemon` gives
a real spawned daemon **10 seconds** to become connectable (`Date.now() + 10_000`), and the failing
run took 10,662 ms. Under a loaded machine — 434 test files, a real Node process booting SQLCipher
and libp2p — 10 s is not always enough, so `login` returns exit 1 and the assertion on
`first.exitCode` fires. In isolation the file passes 28/28.

**Why this is recorded here rather than fixed:** raising a production timeout is a behaviour change,
which Rule A forbids in this order. **But it changes how Rule B must be read for the rest of the
campaign:** Rule B says a test that has to change is proof behaviour moved, and it is right — but a
test that *fails without being changed* is not automatically that proof. **If THIS test fails,
re-run it alone before concluding a part moved behaviour.** Any other test failing is still a stop
condition. Worth fixing properly on its own unit: the deadline should scale, or the test should own
its own bound.

**2 · Two doc blocks are orphaned from the functions they describe.** `ingestReceivedContent` (the
DAEMON-004 cross-check) and `#markContentUnverifiable` each have **no leading doc comment**; their
doc blocks sit stacked above `#noteUnreadableAlgFrame`, several hundred lines away, where a reader
finds three consecutive `/** … */` blocks and one function. Pure comment drift, no behaviour
attached. Recorded rather than fixed because Rule A forbids the tidy-up — but it is worth naming
because **Part 2 moves `ingestReceivedContent`, and a mechanical move would leave its documentation
behind in the old file.** Whoever works Part 2 must carry the DAEMON-004 block with the function it
describes; that is Rule C (comments travel with their code), not a repair.
