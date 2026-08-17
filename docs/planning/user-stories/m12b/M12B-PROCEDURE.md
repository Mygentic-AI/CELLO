---
name: M12B Procedure — How to Work the Milestone
type: procedure
date: 2026-08-17
milestone: M12B
status: open
topics: [m12b, relay, ordering, idempotency, procedure, runbook, cello-client, trustless-cello]
description: >
  The operating runbook for M12B (the relay↔client ordering defect — idempotent submission and
  position discipline). SELF-CONTAINED — no other milestone's procedure needs to be read. Read
  FIRST, then M12B-DEFINITION-OF-DONE. Adapted from M14B-PROCEDURE, which is the most recent; the
  changes are the milestone paragraph, the severity triage, the lenses in §2b, and §2f — which is
  new, and exists because this milestone changes a wire contract between two independently
  deployed programs.
---

# M12B Procedure — How to Work the Milestone

## REALITY CHECK — read before anything
One user: Andre, also the only developer. CELLO is **alpha — no production, no real users.** No
backward compatibility is owed to anyone. But **this milestone is not client-only**: it changes a
frame both the daemon and the relay must agree on, and the relay is a deployed fleet on GCP that
rolls node by node. That asymmetry — one side ships via npm on the operator's schedule, the other
via a fleet roll on yours — is the thing this procedure exists to keep you from getting wrong.

## 🛑 THERE ARE EXACTLY TWO REASONS TO STOP AND HAND BACK TO ANDRE

**Everything else is a NOPE — do not stop for it. Keep working.**

1. **A manual operation only Andre can do, that blocks you.** (The npm `latest` promotion, a
   browser OAuth flow, `/mcp` reconnect.)
2. **A critical design decision that could cause harm, where you need his guidance.** A genuine
   fork where guessing wrong does damage. Decisions Carried in the DoD settled the known forks —
   check there before deciding something is undecided.

**That is the whole list.** Check-ins, recaps, "should I keep going?", "natural stopping point" —
all NOPE. The durable record is the journal + commits, not messages to Andre.

- **Never gate/hedge/ask permission on a CODE change.** Correctness + security fixes ship
  immediately.
- **DO pause for a GENUINE design fork** — in autonomous mode you PARK it, never block.

## 🎭 DECISION THEATRE — the failure mode INSIDE the two-stop rule

Carrying items as "waiting on Andre" is a soft stop that reads as diligence. All three must be NO
for it to be yours:

1. **Does it reach OUTSIDE this system?** npm publish, a counterparty, a bill, a public claim.
   Local repos + local daemons + the dev consortium are not outside. **A relay fleet roll IS
   outside** — see §2f.
2. **Is it genuinely irreversible?** Not "destructive-sounding" — irreversible.
3. **Is it already authorized in writing?** The DoD's Decisions Carried are settled; re-asking one
   is the purest form of theatre.

Any YES → ask once, in one line, park it, never re-list it. All NO → it is yours. REDO > ASK.

## THE MILESTONE IN ONE PARAGRAPH
A retransmission is currently a **new submission**. The relay mints a fresh canonical position for
it (`const seq = state.seq_counter + 1`, unconditional), while the receiving daemon deduplicates by
content hash and appends nothing — so the canonical counter outruns the receiver's tree by one per
retry, permanently. Because the receiver's hold gate is `canonicalSeq > tree.size()`, every
genuinely new message after that is held behind a gap no message will ever fill; held content is
never acknowledged, so it is retried, which burns another position and widens the gap that caused
it. The repair mechanism is what makes it unrepairable. Ship: a **submission id** inside the signed
Structure 1 so a retransmission is declarable; an **idempotent `hash_submit`** that returns the
original position and Structure 2 without advancing the counter, the leaf log, or the running root;
a **client that stops re-asking**; and **position discipline** so a party's leaf index IS its
assigned position. Measured shape: one content hash holding 49 canonical positions in session
`f54e0d07`; `session.content.held.discarded` firing 20 times on one daemon in one day.
Spec-of-record:
[[2026-08-16_1930_one-way-content-loss-the-ordering-counter-both-sides-disagree-on]].

## 0a. Severity triage (spend effort top-down, never invert)
1. **CONTENT LOSS.** Verified content destroyed, or permanently undeliverable, is critical. Basic
   messaging between two healthy agents is the product's floor — below documents, below trust
   signals, below everything.
2. **ORDERING CORRECTNESS.** Two parties disagreeing about which position a leaf occupies. The
   position is what the seal signs over, so a wrong fix here does not lose a message — it
   invalidates proof. Prefer refusing to ship over shipping an unproven ordering change.
3. **THE DISCRIMINATION CASE.** Two byte-identical messages are two different messages. Any fix
   that collapses them is wrong even if every other test passes.
4. **Real non-core gaps.** Loss reporting, surfacing a stranded session, the retry ceiling.
5. **Hardening / polish.**

## 0. Read order (every session)
1. This procedure.
2. [[M12B-DEFINITION-OF-DONE]] — lowest non-✅ line = next unit; Decisions Carried + Explicitly
   Beyond.
3. [[M12B-BUILD-JOURNAL]] — RESUME STATE block + last entries.
4. **Spec-of-record:**
   [[2026-08-16_1930_one-way-content-loss-the-ordering-counter-both-sides-disagree-on]] — the
   measured evidence, the false invariant, and the three fix routes with their trade-offs.
Then start the loop (§2).

## 1. The artifacts
| Artifact | Role |
|---|---|
| **M12B-DEFINITION-OF-DONE** | The **yardstick + sole status authority**. Flip tags in place; one line of evidence + `→ Entry N`, never an essay. |
| **M12B-BUILD-JOURNAL** | The **audit trail + evidence home** — append-only, entries at END OF FILE, verified after writing (§1a). |
| **The pinned regression** | `msg-001-strict-in-order.test.ts`, committed `it.fails` on purpose (cello-client `7384489`). It is the milestone's trigger: when it starts failing, the defect is fixed. |

## 1a. Journal writing — APPEND AT EOF, THEN VERIFY
M12 lost 10 of its first 25 entries to prepend-anchored scripted edits that silently no-op'd.
1. A new entry is **appended at end of file** — never prepended, never inserted. The RESUME STATE
   block at the top is the only thing overwritten in place.
2. **Verify the write landed** (`grep -c "^## Entry N"` or read the tail) immediately after.
3. An out-of-order number at EOF is fine; a lost entry is not.

## 1b. Document discipline
- **A DoD line is a status tag, one line of evidence, and `→ Entry N`.**
- **Supersession history lives ONLY in the journal.** A DoD line names the CURRENT shape.
- **A decision on its THIRD rewrite gets MEASURED, not rewritten** — against the real relay, the
  real daemon, real separate processes.
- **MEASURE BEFORE QUOTING A NUMBER.** This milestone exists because a number was measured
  (49 receipts, one message) after two hypotheses had been asserted and withdrawn. Every claim in
  the journal names how it was measured or is marked as a hypothesis.

## 2. The core loop (one unit = one DoD line)
1. **Find the red** — lowest non-✅ DoD line in the active tier. Don't skip ahead.
2. **State the target** — one sentence of observable behavior, PLUS expand the full DoD line into
   a clause checklist in the journal. That checklist is what the reviewer receives.
3. **Falsify first** (CLAUDE.md Debugging Discipline) — interface exposes the method?
   Responsibility lives here? What breaks elsewhere? Only then code.
4. **Red-first** — write the test, confirm it fails for the right reason, then implement. SPARC
   applies to every code unit; tree work cites RFC 6962, signing cites RFC 8032.
5. **Implement** — minimum change to green; nothing speculative.
6. **Floor holds** — `pnpm run test` → `lint` → `typecheck` → `build` in every touched repo, run
   so it can FAIL (§7).
7. **Commit** (constantly — §3), push after every commit.
8. **Review — ONE read-only `cello-unit-reviewer` on the unit's diff, no model override.** Fix
   EVERY finding; commit fixes.
9. **Update docs** — flip the DoD tag (+ one-line evidence + journal pointer), journal entry.
10. **Merge the branch** (§2e).
11. Back to 1.

> ### 🚨 "REVIEW IN FLIGHT" IS NOT A CLOSING STATE
> **DONE = written AND reviewed. IMPLEMENTED = written, not yet reviewed.** A tag flips only when
> the reviewer's verdict is QUOTED in the journal entry — finding count and disposition, in the
> reviewer's own words.

## 2a. Repos — where work lands
- **cello-client** — the daemon: submit path, retry queue, park/TTF, `SessionTree`, the hold gate,
  `#heldContent`. Ships via `/cello-publish` — LOAD THE SKILL, every publish; never run the
  `latest` promotion (Andre runs it).
- **trustless-cello** (this repo) — the relay (`packages/relay`, `relay-node.ts` is where the
  counter lives), the spine enforcers (`packages/e2e-tests`), these docs. Re-pins published
  cello-client semvers — `workspace:*` for a cello-client package is a bug.

## 2b. Reviewer dispatch — what the unit reviewer is TOLD
Supply: the DoD line VERBATIM (all clauses), the coder's clause checklist, the diff, the repo(s).

> ### 🚨 THE INVARIANTS LIVE HERE AS LENSES — they carry no DoD status tags
> Every lens fires on EVERY unit's diff, whether or not that unit's DoD line mentions it.

Standing M12B-specific lenses:
- **One-position-per-event lens (BLOCKING):** any path where a retransmission can consume a second
  position — in the relay's counter, its leaf log, its running root, or either party's tree. A
  repeat submission that is "mostly" a lookup is a finding.
- **Counter-conflation lens (BLOCKING):** three counters exist — the relay's `seq_counter`, the
  local leaf index, and the retry queue's `position` column. Flag any comparison, assignment, or
  assumed equality between two of them that is not explicitly justified. The defect this milestone
  fixes is exactly one of these comparisons.
- **Discrimination lens (BLOCKING):** two byte-identical messages are two different messages. Any
  change that makes them indistinguishable — deduplicating on hash alone, collapsing on content,
  reusing a submission id across logical messages — is blocking, however green the suite is.
- **Failover-preservation lens (BLOCKING, fires on every Tier A and B diff):** a relay can stop at
  any moment, so handover can only ever be driven by the clients. Flag anything that makes a
  position meaningful ONLY relative to one relay's live in-memory counter, with no client-holdable,
  independently verifiable proof of what it was. `FEDERATION-003`'s predecessor-ACK carry
  (`predecessor_relay_id`/`_signature`/`_sequence`/`_timestamp`, verified against the directory's
  copy of the predecessor's public key) is the sanctioned seam — a submission id must sit ALONGSIDE
  it, never across it. Tier R is sequenced after Tier E; this lens is why it still constrains work
  that ships first.
- **Seal-impact lens (BLOCKING):** the tree root is what the seal signs over. Any diff that changes
  what a tree contains, what order it contains it in, or what the root of an incomplete tree is,
  must state the effect on existing receipts and on cross-party root agreement. "Tests pass" is
  not an answer to this lens.
- **Adversary-owns-their-daemon lens (BLOCKING):** a guard that runs only on the party it
  constrains is not a guard. Note the DoD's Decisions Carried: idempotency is correctness
  hardening, NOT adversary defence — flag any comment, doc, or error string that claims otherwise.
- **No-silent-stranding lens (BLOCKING):** verified content must never be destroyed to resolve an
  ordering problem, and a loss must never be reported only after it is unrecoverable.
- Plus the standing project lenses: **spec fidelity** (per-clause verdicts; silent simplification
  is BLOCKING), **error fidelity** (errors name causes, not exit points — `counterparty_offline`
  for a roster problem is this milestone's founding example), **revert test** on every new test,
  **removal integrity** on any deletion, **stable-key joins**, **no `node:sqlite`** (SQLCipher
  only), **no mocks for crypto**, **injected logger + correlationId threading**.

## 2c. Publish sequencing
- cello-client changes reach operators only via `/cello-publish` — load the skill for EVERY
  publish; verify against the built tarball, not source (`rm -rf core/*/dist` before asserting
  absence — stale-dist orphans re-ship deleted files).
- All parties upgrade together; there is no dual-speak mode.

## 2f. THE BILATERAL CONTRACT — new in M12B, and the reason this milestone can hurt
This milestone changes a frame that a deployed relay fleet and an installed client must both
understand. Get the order wrong and you take messaging down for every agent, not just your own.

- **The relay tolerates the new field BEFORE any client sends it.** Roll the relay first, with the
  submission id optional: absent → today's behaviour exactly, present → idempotent. A relay that
  refuses an unknown field, or a client that sends one to a relay that refuses it, is an outage.
- **The client tolerates a relay that ignores it.** An old relay will mint a new position anyway.
  DOD-M12B-CLIENT-REUSE-1 is what makes that survivable, which is why it is specified to work
  independently of the relay change — build it first, or at least not last.
- **Relay rolls are node-by-node, and threshold tolerates exactly one node down.** Batch every
  pending relay change into ONE push per fleet roll, and poll a real `GET /bootstrap` 200 before
  touching the next node. See `infra/CLAUDE.md` §2 — that rule exists because rolling all of them
  at once has already caused an outage, most recently on 2026-08-16.
- **Never assert a wire change works from a green unit test.** It works when two real processes on
  two real builds exchange a frame across it. That is Tier E, and Tier E is not optional.

## 2d. Auditors — NOT USED in M12B
The unit reviewer's single pass + the Tier E enforcers are the whole review surface.
`cello-done-auditor` is retired; do not dispatch it.

## 2e. Parallel work — branches, worktrees, and merge
- **One branch per unit, named `m12b/<unit>`**, pushed on creation.
- **🚨 COMMIT BY EXPLICIT PATH. NEVER `git add -A`.** Non-negotiable with a shared checkout.
- **A reviewed-green unit MERGES — it does not sit.**
- **Two branches must never touch the same file.** If they must, they are one unit.
- **Subagents stay READ-ONLY.**
- Client-side DB schema changes (the retry queue and any durable hold store are both candidates):
  test the upgrade path against a POPULATED pre-migration database, never just a fresh one.
  Migrations run on operator machines and failures there are unrecoverable.

## 3. Cadence
- **Commit constantly** — never >~15 min without one; push after every commit. Docs commit to main.
- **Review every unit** on its diff, right after green. Never batch reviews.
- **Checkpoint at every tier boundary:** journal summary, commit, verify every ✅ names its
  evidence.

## 3a. Autonomous-mode rules (if running unattended)
NEVER `AskUserQuestion`, never end a turn waiting. Decision rubric: pick the choice least likely to
need reversing — Decisions Carried has probably already picked it — log it, proceed (redo > block).
Genuine undecidable fork → PARK and pull the next unit. **Exceptions that DO block (park the unit,
work another):** the npm `latest` promotion, `/mcp` reconnect, **and a relay fleet roll** (§2f).

## 4. First actions (strictly in order)
1. **DOD-M12B-TRACE-1** — name the resubmitter with file/line evidence. Everything downstream is
   designed against what this finds, not against what the spec-of-record inferred.
2. **DOD-M12B-TRACE-2** — the counter map. Do not write a fix that compares two counters before
   this line has listed all of them.
3. **DOD-M12B-CLIENT-REUSE-1** — the half that works against an unchanged relay.
Then Tier A's wire change, then Tier B.

## 5. Hard rules (non-negotiable)
- **ABSENT IS NOT FINE.** A guard with missing input REFUSES — loudly, naming its cause.
- **ERRORS NAME THEIR CAUSE, NOT THEIR EXIT POINT.** This milestone was found under three days of
  `counterparty_offline`, an error that named the one thing that was working.
- **NO CONSUMER, NO SHIP.** New fields/flags/events need a named consumer in the same unit.
- **NO ARCHAEOLOGY COMMENTS.** Present tense, imperative; constraints the code can't show.
- **DEADNESS IS PROVEN BY DELETION** + both repos' gates; assert absence on BUILT artifacts.
- **`node:sqlite` VERBOTEN** (SQLCipher only). **No mocks for crypto.** **No `console.log`** in
  implementation.
- **Join on stable keys** — `agent_id`, session id, pubkeys. `agent_name` is display-only.
- **Vitest: one worker, foreground, timeout, filtered.** Never background a test process.
- **NEVER `pkill -f cello-daemon`** — it kills the production daemon. Test daemons die by captured
  PID.
- **Deferrals get a home** — DoD "Explicitly beyond" + journal. No silent deferral.

## 6. What a checkpoint/handoff entry contains
Which DoD lines are ✅ WITH run output (not a claim); the exact next red + one-sentence target;
HEAD commits (both repos); published package versions if any publish happened; the relay fleet's
rolled state if a roll happened; anything parked. Keep the RESUME STATE block current.

## 7. Gate discipline — run it so it can FAIL
M14 found a gate piped through `grep`, whose exit status is grep's — the chain proceeded on red
trees. Run gates so a failure stops the chain:

```
set -o pipefail        # or: capture to a file and check $?
pnpm run test > /tmp/gate.log 2>&1; echo "exit=$?"
```

Read the exit code, not the tail of the output. A check whose failure mode is "still reports
success" launders a red tree into a green claim.

---

## Related Documents
- [[M12B-DEFINITION-OF-DONE]] — yardstick + sole status authority
- [[M12B-BUILD-JOURNAL]] — audit trail
- [[2026-08-16_1930_one-way-content-loss-the-ordering-counter-both-sides-disagree-on]] — spec-of-record
- [[M12-DEFINITION-OF-DONE]] — the parent milestone
- [[M14B-PROCEDURE]] — the procedure this one is adapted from; §2f is the addition
