---
name: M8B Procedure — How to Work the Federation Milestone
type: procedure
date: 2026-06-29
milestone: M8B
status: open
description: >
  The operating runbook for M8B (federation), adapted from M7-PROCEDURE.md. Read FIRST, then
  M8B-DEFINITION-OF-DONE.md. Defines the artifacts, the red-driven per-unit loop, the cadence,
  the 30-min cron drift check, the OVERNIGHT never-block rules, and the hard rules. The one
  material difference from M7: deploys + npm publish ARE authorized for this milestone (Andre,
  2026-06-29) — used as the CLOSE GATE after local-spine-green, never as a discovery loop.
---

# M8B Procedure — How to Work the Federation Milestone

## REALITY CHECK — read before anything
There is **one user: Andre**, also the only developer. CELLO is **alpha. No production, no real
users to protect.** Consequences (non-negotiable):
- **Never gate/hedge/defer/ask permission on a CODE change** because it's "risky" or "load-bearing."
  Correctness + security fixes ship immediately. (Memory: alpha — no production-safety caution on code.)
- **Do not invent decisions for Andre.** "Should I do this code work?" is always yes.
- **DO pause for a GENUINE design fork** (materially different architectures, unclear which Andre wants) —
  but overnight you do NOT pause: you PARK it (see §3a). Never dress up "should I proceed?" as a fork.
- **Deploys + npm publish ARE authorized this milestone** (Andre's explicit grant). Worst case =
  recoverable setback. Use them as the CLOSE GATE (local 3-dir spine green → publish beta → deploy dev →
  prove live), NOT as a discovery loop.

## 0a. Severity triage (spend effort top-down, never invert)
1. **CORE JOB.** No single node mandatory; any T of N co-sign; Option B seals with no directory→relay;
   cross-node reads work. If broken/missing → top priority.
2. **SILENTLY-BROKEN CORE / SECURITY HOLE.** Looks done but an informed person says "you missed the
   kernel" — e.g. trusting the relay's UNSIGNED sequence; a single node still secretly mandatory; a
   replicated sweep deleting a deliverable row. **Most dangerous category. Treat as critical.**
3. **Real non-core gaps.** 4. **Hardening / polish / edge cases.**
The **informed-skeptic test** before calling anything done: would someone who deeply understands this
say it actually works, or that the kernel is missing? Police both failure modes: never inflate #4 into a
block; never demote #2 to "minor."

## 0. Read order (every session)
1. This procedure. 2. M8B-DEFINITION-OF-DONE.md — lowest non-✅ line = next unit. 3. M8B-BUILD-JOURNAL.md
— last few entries + the status board. 4. M8B-DECISIONS.md — what's already resolved/parked. 5. M8B-SPEC.md
for the architecture (don't re-derive; it's verified). Then start the loop (§2).

## 1. The three artifacts
| Artifact | Role |
|---|---|
| **M8B-DEFINITION-OF-DONE.md** | The **yardstick** — every requirement, ordered, status-tagged. Flip tags in place. |
| **The 3-directory spine test** | The **enforcer** — spawns 3 real directory nodes + relay + daemon(s) on localhost, real DKG/FROST/Noise, asserts each DoD line. Built FIRST (DOD-SPINE-1). React to it, never bypass. |
| **M8B-BUILD-JOURNAL.md** | The **audit trail** — append-only entries + the live status board. Never edit a prior entry. |

## 2. The core loop (one unit = one DoD line)
1. **Find the red** — lowest non-✅ DoD line. Don't skip ahead.
2. **State the target** — one sentence of observable behavior.
3. **Falsify first (CLAUDE.md Debugging Discipline)** — does the call site have the method (check the
   interface)? Does responsibility live here? Redundancy? What else breaks? Only then write code.
4. **Red-first** — add the assertion to the spine test (+ a focused in-process test). Confirm red for the right reason.
5. **Implement** — minimum change to green; nothing speculative.
6. **Floor holds** — all tests green; typecheck + lint clean; reachability gate unchanged (daemon never
   imports `@cello-protocol/client`; dead-stack count only shrinks). Vitest: ONE worker, foreground, timeout, filtered.
7. **Commit** (constantly — §3).
8. **Review — three READ-ONLY subagents, three distinct jobs (never an implementer).** On the unit's
   diff, in parallel:
   - **`feature-dev:code-reviewer`** (`model:'opus'` — it pins Sonnet otherwise) — attacks the CODE
     (bugs, logic, security, intent-vs-impl).
   - **`cello-test-attacker`** — attacks the TESTS (tries to pass them with a different/wrong
     implementation; a test it can satisfy while violating the AC is HOLLOW).
   - **`cello-fallback-finder`** — attacks the FAILURE PATHS for silent fallbacks. Add it whenever the
     unit touches **crypto / FROST / DKG, the seal path, the relay-signed-ordering, persistence,
     registration, config, or a replication/migration** (i.e. nearly every M8B unit — these are exactly
     where a missing share / unsigned ordering / unconverged replica hides as "looks healthy").
   Fix EVERY finding at EVERY severity; HOLLOW-TESTS and HIGH silent-fallback findings are **blocking**
   (fix → re-run red→green / make it fail loud). Commit the fixes. (At journey boundaries,
   `cello-done-auditor` audits every ✅ flip — §3. All four are read-only; the main loop is the only coder.)
9. **Update docs** — flip the DoD tag, append a journal entry, update the status board.
10. Back to step 1.

## 3. Cadence
- **Commit constantly** — before tests, after each green unit, after each fix. Never >~15 min without one.
- **Review every unit** — on its diff, right after green. Never batch one review for many units.
- **Spine test start + end of every unit.**
- **Checkpoint at every journey boundary** (J-TOFN green, J-OPTIONB green, …): dispatch `cello-done-auditor`
  on every line flipped ✅ since the last checkpoint; only EARNED stays ✅. Append a journal summary, commit.

## 3a. The 30-minute drift check (the cron) + OVERNIGHT NEVER-BLOCK
A session cron fires ~every 30 min. When it fires: STOP, produce the checklist, each item ✅ FOLLOWED /
❌ DRIFTED with COMMAND OUTPUT as evidence:
1. **Anchored to real binaries** — the spine test spawns real directory/relay/daemon, never imports library internals. Paste a grep.
2. **On the assembly branch, nothing merged to main** — `git status -sb` both repos. Branch pushes OK; main merges are Andre's. Paste.
3. **Read-only subagents only** — reviewer / test-attacker / fallback-finder / done-auditor / explorer. No parallel implementers. yes/no.
4. **Working the lowest non-✅ DoD line** — name it; not skipping ahead.
5. **Committing constantly** — `git log --oneline -3`. Paste.
6. **No deploy used as discovery** — deploys only at the close gate. yes/no.
7. **Every ✅ since last check is earned** — paste the spine-run assertion that proves each flip; can't → drop to 🟡.

### 🚨 OVERNIGHT AUTONOMY — NEVER HARD-BLOCK (read every drift check)
A question in autonomous mode is a **HARD BLOCK**: `AskUserQuestion` (or ending a turn waiting on the
user) freezes EVERYTHING — the cron stops, no unit runs — until Andre wakes. One needless block once cost
~7 hours. So:
1. **NEVER call `AskUserQuestion` and NEVER end a turn waiting on the user overnight.**
2. **Before any stop, ask: "Can I predict the right way with high probability?"** If yes → don't block,
   decide and proceed. Any **reversible (code/deploy-to-dev)** choice is always a proceed — a redo costs
   minutes, a block costs the night. Redo > block, always.
3. **If it is GENUINELY a critical, direction-changing decision you truly can't make alone: PARK IT** —
   write the decision + options + your recommendation into M8B-BUILD-JOURNAL.md AND M8B-DEFINITION-OF-DONE.md
   (the "Parked decisions" section, a peg never dropped) + M8B-DECISIONS.md, then pull the NEXT item off the
   queue. Never silently drop that you parked something — say "I parked X; I'm now working on Y."
4. **Log every reversible fork** in M8B-DECISIONS.md (timestamp / fork / choice / why / reverse).

### Kickoff self-audit — answer these THREE at every cron fire, then act
1. **Have I been unnecessarily stalled asking for a design decision?** Unless choosing wrong is
   ABSOLUTELY DESTRUCTIVE, pick the option I'd most likely recommend, log it in M8B-DECISIONS.md, and
   proceed. Never stall on a reversible call.
2. **Have I stopped awaiting confirmation to continue — or decided to create a checkpoint?** Those are
   unwanted and unnecessary; Andre is asleep. Continue the work.
3. **Am I committing frequently?** Commits are vital — lots of commits are good. Commit often (before
   tests, after each unit, after each fix). Never go >~15 min without one.

### 3b. The cron (verbatim, recreatable — re-arm after any restart/compaction)
The overnight loop is a **session-only** cron (it dies if the Claude process exits). It is NOT durable —
this block is the durable record. After any restart or `/compact`, re-arm it with CronCreate:
`cron: "17,47 * * * *"`, `durable: true`, `prompt:` the text below.

> `<<autonomous-loop>>` M8B federation build — kickoff self-audit + 30-min drift check + advance. Follow
> M8B-PROCEDURE.md §3a. FIRST answer the three kickoff self-audit questions (above): (a) unnecessarily
> stalled on a decision? pick-reversible-and-log, don't stall; (b) awaiting confirmation / made a
> checkpoint? unwanted — continue; (c) committing often? commit now if it's been a while. THEN (1) run
> the drift checklist (anchored-to-real-binaries; on m8b-assembly + nothing merged to main; read-only
> subagents only; lowest non-✅ DoD line; committing constantly; deploys only at close gate; every ✅
> earned by a spine run), correcting any drift. THEN (2) ADVANCE: read M8B-DEFINITION-OF-DONE.md, take
> the lowest non-✅ DoD line (order MANIFEST→DKG→SIGN→SUSPEND→REFRESH→RELAYSIG→OPTIONB-SETUP→
> OPTIONB-SEAL→PRESENCE→PICKUP→DEPLOY; build DOD-SPINE-1 enforcer first), do the §2 per-unit loop
> (falsify-first, red-first on the spine, implement on m8b-assembly, gate green, dispatch READ-ONLY
> reviewers code-reviewer model:'opus' + test-attacker + fallback-finder, fix every finding, commit,
> flip the DoD tag + journal entry + status board). ONE coder thread; no parallel implementers; no
> per-unit branches. NEVER ask Andre — pick reversible + log in M8B-DECISIONS.md, or PARK a genuine
> undecidable fork (journal + DoD + decisions) and ship the next unit. Deploys + npm publish authorized
> as the CLOSE GATE (after local 3-dir spine green). Keep going until all DoD lines ✅ on spine then 🚀 live dev.

## 4. Building the enforcer first (it doesn't exist yet)
The first unit is **DOD-SPINE-1**: extend the spine harness to spawn **3 real directory nodes** locally
(today it spawns one). Until that exists, T-of-N can't be proven. Anchor to the binaries; drive only the
agent surface (`cello register` / `cello_initiate_session` / `cello_send` / `cello_receive` /
`cello_close_session`). It will be mostly red — that's the map. Grow it one journey at a time
(J-TOFN → J-OPTIONB → J-XNODE → J-REFRESH → J-LIVE).

## 5. Hard rules (non-negotiable)
- **One thread. One coder (the main loop). NO parallel implementation agents.** Parallel branches are what
  buried M7. Only READ-ONLY subagents (reviewer, test-attacker, fallback-finder, done-auditor, explorer).
- **One assembly branch per repo** (`m8b-assembly` in cello-client and trustless-cello). No per-unit
  worktree/branch sprawl. Push the assembly branch for visibility; **never merge to main** (Andre merges).
- **Reachability gate stays green** — daemon never imports `@cello-protocol/client`; no new dead code.
- **Deploys/publish at the CLOSE GATE only** — local 3-dir spine green first, then publish beta + deploy
  dev (authorized), then prove live. Not a debugging loop.
- **Vitest: one worker, foreground, timeout, filtered.** Never background a test process.
- **Deferrals get a home** — DoD "Parked decisions" + journal + decisions log. No silent deferral (RC-1).

## 6. Design-significant units
T-of-N DKG fan-out, share refresh, Option B receipt model, relay-signed ordering are NOT mechanical. For
each: write a short **design note in the journal FIRST** (approach, producer/consumer chain, the seam it
lands on — the live daemon, never dead `core/client`, the SIs it must satisfy), then run the loop.

## 7. What a checkpoint/handoff entry contains
Which journeys are green (DoD-IDs) with the spine-run OUTPUT (not a claim); the exact next red + one-sentence
target; branch + HEAD commit + whether the reviewer ran on everything to HEAD; anything parked (explicitly);
anything that changes the DoD. Verified-green (unit + spine journey, then live) is the only "done." A claim
without a run is not done.
