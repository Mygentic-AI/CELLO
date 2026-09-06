---
name: M15 Story — Split the god file
type: story
date: 2026-09-06
milestone: M15
status: open
topics: [m15, refactor, code-health, session-node-manager, ratchet, comments, story]
description: >
  session-node-manager.ts is 19,878 lines and 25% of the daemon in one class of 555 members. Split it
  to under 4,000, behind an eslint ratchet that stops it growing back — because the last refactor of
  this shape worked and then fully regrew in under two months. Closes DOD-M15-GODFILE-1. Pure
  movement only; the comments are the asset and move verbatim.
---

# Story — Split the god file

**This is a STORY, not a micro work order.** Six seams, each its own unit. Pull them one at a time
(§7). A micro order is capped at 500 lines; this is a campaign.

**It runs in its own worktree and its own branch.** Nothing else lands in that tree while it runs.

---

## 1. What this fixes, and it is not tidiness

`cello-client/core/daemon/src/session-node-manager.ts` is **19,878 lines, 1.2 MB, one class, 555
members**. It is **25% of the entire daemon**. The next largest file in the repo is 6,077.

The reason this is a correctness item and not an aesthetic one: **it is past the size at which a
coding agent works reliably, and it holds the most load-bearing code in the product** — session
state, the whole inbound ingest chain, authorship and acknowledgement verification, quarantine,
transcripts, relay ordering, park recovery. Every mistake an agent makes in here is a mistake in the
part of the system that decides whether a message is accepted, attributed and recorded.

It is also the first file an evaluator points a coding agent at.

---

## 2. 🎁 READ THIS BEFORE ESTIMATING — two measurements that set the shape

**Measurement 1 — it was never refactored. Do not go looking for a previous attempt.**

```
2026-06-12    525      2026-08-22  10,073
2026-07-13  4,446      2026-09-01  14,206
2026-08-04  5,501      2026-09-04  18,225
2026-08-07  6,174      today       19,878
```

Monotonic. No drop anywhere. Nearly half the growth is the last three weeks.

**Measurement 2 — the refactor that DID happen proves a split alone is not the fix.**

Nine commits in mid-July took `daemon.ts` apart (`refactor(daemon): Seam A…I — X out of
startDaemon's body`) and cut it from **6,279 lines to 2,081 on 14 July**. It is **6,077 today** —
fully regrown in under two months, because nothing stood in the way.

**That is why §3 comes before §7. A split with no ratchet buys two months.**

**Measurement 3 — what makes this affordable.** `core/daemon` has **310 test files and 95,339 lines
of test code** — more test code than production code. That is the safety net, and §5 is how you use
it correctly.

---

## 3. Prerequisites — BOTH BLOCKING, in this order

### 3a. Sweep this file's comments FIRST — ruled by Andre 2026-09-06

`DOD-M15-COMMENT-DISCLOSURE-1` ([[M15-PUBLIC-COMMENT-SWEEP]]) has items **inside this file**,
including its highest-priority one: `session-node-manager.ts:9760` still says the relay hash-submit
cross-check *"does not exist yet"* and names the exact bypass. It exists.

**Moving a stale comment verbatim gives you a stale comment in a new file**, and then two units have
touched the same lines for different reasons. Sweep the file, land it, then start here — so this work
stays pure movement and its diff stays reviewable as movement.

### 3b. The ratchet lands before any code moves

A `max-lines` ESLint rule in `cello-client/eslint.config.mjs`, following **the pattern already in
that file** for blocking `node:sqlite`: one rule, one visible allowlist entry, no second mechanism.

- `session-node-manager.ts` is grandfathered at its **current** size.
- Every other file gets the ordinary ceiling.
- **Lower the grandfathered number after each seam lands.** The rule is what holds the ground each
  seam takes.

**Ratchet second means the split lands, attention moves on, and `daemon.ts` happens again.**

---

## 4. The target — SETTLED with Andre 2026-09-06. Do not re-open.

**Under 4,000 lines is the pass bar. ~2,500 is the aim** — that is roughly where `daemon.ts` landed,
so it is a proven shape rather than a wish.

**NOT under 1,000.** That was considered and rejected: it would force seams that do not exist in the
code and produce a scatter of files with shared state, which is worse than one large cohesive class.

**No phased ceiling, and this was ruled explicitly.** An earlier draft proposed 10k → 5k → 2k as
stages. That buys nothing when one agent runs the campaign to completion in a worktree — there is no
intermediate release and nobody consumes a 10k milestone. The reviewable unit is **the seam**, and
per-seam commits already give that. Do not reintroduce stages.

---

## 5. The rules of the work — every one of these is a stop condition

1. **PURE MOVEMENT.** No renames. No logic changes. No de-duplication. No "while I'm here". A diff
   that is not a move belongs to a different unit — write it under *Newly discovered* and keep going.

2. **THE TESTS PASS UNCHANGED.** With 310 test files, a test that *has to* change is not a test that
   was wrong — **it is proof you changed behaviour**. Stop, revert the seam, and work out what moved.
   The one legitimate exception is an import path, and even that should be rare if the module keeps
   its exported surface.

3. **THE COMMENTS MOVE VERBATIM.** 53% of this file is prose — ~10,500 lines explaining why each
   check exists, much of it recording a defect that was reintroduced once already and the false
   reasoning that allowed it. **They are the asset, not the padding.** A summarised comment loses
   more than the split gains. They travel with the code they describe, unedited.

4. **NOTHING PRIVATE BECOMES PUBLIC.** See §6 — this is the one that will actually bite.

5. **ONE SEAM PER SESSION.** Commit per seam, push after every commit.

---

## 6. The trap — verified, and it will bite

**It is ONE CLASS with `#private` fields.** `#activeNodes`, `#db`, `#logger`, `#standingReceivers`,
`#contentDesynced`, `#witnessedSeq` and the rest. The methods being moved read and write them freely
today, because they are all inside the same class body.

Move a method to a module and it can no longer see them. There are three ways out and **two of them
are worse than the god file**:

- ❌ **Widen the fields to public** so the new module can reach them. This turns encapsulated state
  into a public surface, and any file in the daemon can now write to session state. **A split that
  does this has made the codebase worse and must be rejected at review.**
- ❌ **Pass the whole `this`** into the extracted function. That is the god object with extra
  indirection and one more place to look.
- ✅ **Each seam declares the narrow state it needs, BEFORE it moves** — a small explicit parameter
  object, or a small interface the class implements. If a seam cannot state its dependencies in a
  short list, **that seam is not a seam** and the unit stops there rather than forcing it.

**This declaration is Part 0 of every seam unit and it is blocking.** Write the list first. If it
runs long, say so and stop — a seam that cannot be cut cleanly is a finding, not a failure.

---

## 7. The units — pull as micro orders, in this order

Named in plain English, because the method names are not self-explanatory to a reader arriving cold.

### Unit 1 — *Who sent this, and did they see what they claim*
`#verifyAuthorshipClaim`, `#verifyAcknowledgedContent`, the `AUTHORSHIP_*` and `ACK_HASH_*` constants.

Answers two questions about one signed blob: *did this really come from this conversation's
counterparty*, and *is what they say they saw actually what we sent*. **First because it is the most
self-contained, has the heaviest test coverage, and is the security-critical part — so it gains most
from being readable.** Also the best place to prove the §6 pattern on a small surface.

⚠️ **The ORDER of the checks inside it is a security property** — decode → signature → signer → what
the proof is about. A check that can answer `unusable` before the signature is verified hands a peer
a switch for choosing the softer outcome. That ordering, and the comment explaining it, must survive
the move exactly.

### Unit 2 — *Taking a message in*
`ingestReceivedContent` and its refusal chain.

Ten named refusals from session-orphaned through to transcript-write-failed. Big, and the highest
value: this is where an agent most needs to read the file and currently cannot.

### Unit 3 — *Holding what was refused*
`#quarantineRefusedContent`, `#orphanEvidence`, and the triage of an unattributable message.

### Unit 4 — *Where a message sits in the order*
`#recordFrameOrdering` and the relay position records.

### Unit 5 — *The conversation record*
Transcript reads and writes, seal leaf storage, the unread accounting.

### Unit 6 — *Mail that waited*
Park recovery — `authenticateParkedEntry`'s caller and the recovery ingest path.

**Stop when the target in §4 is met.** If four seams get it under 4,000, the remaining two are not
owed — record them and close.

---

## 8. Verification — per seam, and the first item is specific to this work

- **`pnpm run build:clean`, not `pnpm run build`.** `tsc --build` is incremental and **never deletes
  an output whose source is gone**, so a deleted or renamed module leaves its `.js` behind in
  `dist/`. Refactoring is the one operation that deletes source files, which is why this bites here
  and nowhere else. **Verify a deletion against the BUILT artifact, never against `src/`.** The
  script was added 2026-09-06 and clears the `.tsbuildinfo` files too — without that, tsc believes
  it is up to date and emits nothing at all.
- **Gate:** `pnpm run test` → `pnpm run lint` → `pnpm run typecheck`.
- **`cello-unit-reviewer` per seam.** It carries a removal/refactor integrity lens that fires
  specifically on a diff that **moves or deletes** code — proven deadness, deleted-test triage,
  built-artifact absence, behaviour preservation. That lens is the one that matters here; say so
  when dispatching it.
- **A live two-daemon smoke test at the end of the campaign.** Two real daemons, a session, messages
  both ways, a seal. **Vitest green is not the close condition** — the milestone rule is that no
  milestone closes on unit tests alone, and this work touched the ingest path.

---

## 9. Definition of done

- [ ] The comment sweep of this file has landed (§3a).
- [ ] The `max-lines` ratchet is in `eslint.config.mjs` with one allowlist entry, and CI enforces it.
- [ ] `session-node-manager.ts` is **under 4,000 lines**, and the ratchet's grandfathered number has
      been lowered to match.
- [ ] Every extracted module declares the state it needs; **no field changed from private to public**.
- [ ] The full test suite passes with **no test file modified** except for import paths.
- [ ] No comment was summarised, shortened or dropped.
- [ ] `pnpm run build:clean` produces a `dist/` with no artifact whose source no longer exists.
- [ ] `cello-unit-reviewer` ran per seam and every finding is fixed.
- [ ] A live two-daemon smoke test passed: session, messages both directions, seal.
- [ ] Published via `/cello-publish`, and the post-publish verification greps the **tarball**.

---

## 10. Explicitly out of scope

- **`daemon.ts` (6,077) and `directory-node.ts` (7,403).** Both need the same treatment; neither is
  this story. The ratchet from §3b covers them going forward, at their current sizes.
- **Any behaviour change**, including ones that look obviously correct. Write them under *Newly
  discovered*.
- **The A-bucket comments and the stated trust bounds** from [[M15-PUBLIC-COMMENT-SWEEP]] — they move
  verbatim like everything else and are not reconsidered here.

---

## Related

- [[M15-DEFINITION-OF-DONE]] — `DOD-M15-GODFILE-1`
- [[M15-PUBLIC-COMMENT-SWEEP]] — §3a's prerequisite, and the rule that comments move verbatim
- [[M15-PROCEDURE]] — the gate, review dispatch and invariants every unit is bound by
- [[session-correctness-checks]] — what the code in units 1–4 actually guarantees, if a seam needs
  to know what it must not break
