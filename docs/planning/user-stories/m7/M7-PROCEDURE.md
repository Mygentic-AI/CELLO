---
name: M7 Procedure — How to Work the Definition of Done
type: procedure
date: 2026-06-18
milestone: M7
status: open
description: >
  The operating runbook for closing M7. Read this FIRST, then
  M7-DEFINITION-OF-DONE.md. It defines the three artifacts (DoD = yardstick, live
  binary test = enforcer, build journal = audit trail), the red-driven per-unit
  loop, the commit/review/test/checkpoint cadence, the hard rules (one thread, no
  sprawl, no merge/push), and what a handoff contains. Any agent picking up M7
  work follows this exactly.
---

# M7 Procedure — How to Work the Definition of Done

## REALITY CHECK — read this before anything else

There is **one user: Andre.** He is also the only developer. CELLO is **alpha.
Nothing is in production. There are no operators and no real users to protect.**
The production-grade voice in these docs ("operator," "deploy discipline," "real
users get it") describes a future federated product — it is NOT the current world.

Consequences, non-negotiable:

- **Never gate, hedge, defer, or ask permission on a code change** because it is
  "risky," "load-bearing," "safety-critical," or could "break it for the operator."
  There is no operator. Just make the change. Correctness and security fixes ship
  immediately. (Memory: alpha — no production-safety caution on code changes.)
- **Do not invent decisions for Andre.** The answer to "should I do this code work?"
  is always yes — stopping to ask permission to proceed wastes his time. This is
  different from a real design question (next bullet); the fake gate is "this is
  risky/load-bearing, may I go ahead?" — there is no such gate.
- **DO pause for a genuine design fork.** When something can truly be built in
  several materially different ways and which one Andre wants is unclear — an
  architecture/protocol/UX direction with real, divergent consequences — surface
  it and ask for guidance. That is not manufacturing a decision; that is the one
  kind of decision worth his time. State the options and your recommendation, then
  ask. (Do NOT dress up "should I proceed?" as a design question.)
- **Pause for an actual live AWS deploy** (the 25–30 min directory pipeline) — a
  deploy *operation*, never a code edit.
- **"Publish to real users" is not a concern.** Publishing only means Andre running
  the npm build instead of the local dev build. Ignore it unless he asks.

If you catch yourself writing "needs Andre's nod" or "blocked on a decision" about
code, you are wrong — delete it and do the work.

## 0. Read order (every session, in order)

1. **This document** — the procedure.
2. **M7-DEFINITION-OF-DONE.md** — the target. Find the lowest-numbered line not
   yet ✅; that is your next unit.
3. **M7-BUILD-JOURNAL.md** — the append-only log. Read the last few entries to see
   what was just done, found, and left.
4. The source story YAML for the DoD line you're working
   (MSG-001 / SESSION-002/003/004 / E2E-001 / etc.) for the precise AC.

Then start the loop (§2). Do NOT re-derive scope, re-read the whole corpus, or
re-investigate what the journal already records. If the journal says it's done,
it's done — verify by running the test, not by re-reading code.

## 1. The three artifacts

| Artifact | Role | How it's maintained |
|---|---|---|
| **M7-DEFINITION-OF-DONE.md** | The **yardstick** — every requirement, ordered, with a status tag. | Status tags flipped IN PLACE (❌→🟡→✅) as the live test proves a line. Never rewritten wholesale. One line per DoD-ID. |
| **The live binary test** | The **enforcer** — spawns the real `cello-daemon` / `cello-mcp` / directory / relay binaries on localhost, real TCP/Noise/crypto/IPC, and asserts each DoD line. Defines "done." | A tracked code artifact. Grows one journey at a time (§3). It is the thing you react to, never bypass. |
| **M7-BUILD-JOURNAL.md** | The **audit trail** — append-only. Prevents re-asking/re-doing. | Append one entry per unit. NEVER edit a prior entry. Each entry: DoD-ID, what was red, what was found (producer/consumer if a bug), commit hashes, reviewer outcome, blockers, decisions made. |

The DoD says WHAT done means. The test PROVES it. The journal records HOW it went.
Three different jobs — keep them separate.

## 2. The core loop (one unit = one DoD line, or a tight cluster within one journey)

1. **Find the red.** Run the live test. Take the lowest-numbered DoD line that is
   not green. That is the unit. Do not skip ahead — the test orders the work.
2. **State the target.** From the DoD line + the source story AC. One sentence:
   what observable behavior must become true.
3. **Falsify first (MANDATORY — CLAUDE.md Debugging Discipline).** Before writing a
   line: does the call site actually have the method (check the interface, not the
   class)? Does responsibility live here? Would the fix create redundancy? What
   else breaks? Only after failing to falsify do you write code.
4. **Red-first.** Add/confirm the assertion in the live test (and a focused
   in-process test for the inner loop). Confirm it's red for the right reason.
5. **Implement** until that line is green — minimum change to get past this red,
   nothing speculative.
6. **Confirm the floor still holds:** all existing tests green; reachability gate
   unchanged (client-dead count must not rise — no new dead `core/client` code);
   `typecheck` clean; `lint` clean. Vitest: ONE worker, foreground, with timeout.
7. **Commit.** (See §3 cadence — commit before tests too.)
8. **Review.** Dispatch `feature-dev:code-reviewer` with `model:'opus'` (it pins
   Sonnet otherwise) on the unit's diff. Fix EVERY finding at EVERY severity
   (blocking/high/medium/low). Dispute only a finding that is provably wrong or a
   recorded scope decision — and write the why in the journal. Commit the fixes.
9. **Update the two docs.** Flip the DoD line's status tag. Append a journal entry.
10. **Back to step 1.**

## 3. Cadence — the answers to "how often"

- **Commit: constantly.** Before running tests, after each green unit, after each
  review fix. Never go ~15 minutes without a commit. A commit is free history, not
  a done-marker; the message explains what was tried and why.
- **Review: every unit.** On that unit's diff, right after it goes green, before
  moving to the next red. Per-unit keeps findings small and local. Do NOT batch a
  single review for many units at the end — that is exactly the gap that left most
  post-collapse M7 work un-reviewed.
- **Live test: start and end of every unit.** Start → find the red. End → confirm
  the line is green and nothing regressed. Fast in-process tests are the inner
  loop between.
- **Checkpoint / handoff: at every journey boundary** (J-SPINE green, J-AUTH
  green, …) or whenever context is getting long. Write a journal summary, update
  the DoD scorecard, commit. Then STOP and surface to Andre — merge is his call.

## 4. Building the live test itself (it doesn't exist yet)

The first unit of all is **writing J-SPINE** (DOD-SPINE-1..7) as a live test that
spawns the real binaries. Until it exists, every other instruction is blind.

- Spawn real binaries on localhost. Real directory, real relay, real daemon(s).
  NO AWS, NO deploy.
- Drive only the public surface an agent uses: `cello register`,
  `cello_initiate_session`, `cello_await_session`, `cello_send`, `cello_receive`,
  `cello_close_session`. The binaries handle the wire/FROST internally.
- It will be almost entirely red at first. That is the map, not a failure.
- Grow it one journey at a time (J-SPINE → J-AUTH → … per the DoD harness section).
  Add a journey's assertions only when you start that journey.
- **Anchor to the binary, not the library.** The test launches the shipped program
  and talks to it; it never imports `createClient` or constructs daemon internals
  in-process. (This is the single discipline whose absence caused the dead-stack
  blindness — a test wired to a named function silently validates dead code; a test
  that runs the program cannot.)

## 5. Hard rules (non-negotiable)

- **One thread. One coder. Andre watching.** No parallel implementation agents.
  Parallel branches are what produced the sprawl that buried this milestone. Only
  read-only subagents (the reviewer, and read-only explorers) may be dispatched.
- **One branch. No sprawl.** Work on the assembly branch (or main once merged). Do
  not spin up new branches/worktrees per unit.
- **Never merge to main. Never push.** Both are Andre's call. Commit locally,
  constantly. (Pushing trustless-cello triggers the 25-30 min live deploy.)
- **Reachability gate stays green.** Daemon never imports `@cello-protocol/client`;
  client-dead file count may only shrink, never grow. No new dead code enters.
- **No deploys as a discovery tool.** Live infra is the FINAL close gate, run once
  at the end with Andre — not a debugging loop. Seam/journey work is in-process
  against local binaries.
- **Vitest: one worker, foreground, timeout, filtered to the package.** Never
  background a test process.
- **No new stories for contained work.** Direct foreground build per the loop.
  Reserve a story only for a Flyway/DB migration, a cross-repo protocol version
  bump needing `@cello-protocol/*` publish + coordination, or genuinely large
  parallel work. (The greenfield Tier-3 items are built via the loop, not as full
  SPARC stories — see §6.)
- **Deferrals get a home.** If something is pushed out, it goes into the DoD with a
  status and a named target — never only into a journal sentence. A milestone may
  not close carrying a silent deferral (postmortem RC-1).

## 6. Greenfield and design-significant units

`MSG-001-3b`, `SESSION-002`, `SESSION-004` client legibility, and the
`SESSION-003` ABSENT-gate re-home are not mechanical. For each:

1. Write a short **design note in the journal FIRST** — the approach, the
   producer/consumer chain, the seam it lands on (daemon, per Option A — never the
   dead `core/client` stack), the SIs it must satisfy. A paragraph, not a document.
2. Then run the normal loop against the live test.

Tier-4 items (`DOD-UP-1/2` — bilateral upgrade, auto-acknowledge) are NOT STORIED.
Before building either, write the story (real story machinery applies — they're
protocol-significant) or explicitly move it to a named future milestone in the DoD.

## 7. Tier-0 invariants are journey assertions, not a separate pass

The cross-cutting invariants (DOD-INV-1..9) are proven by SI/adversarial assertions
woven into each journey — not checked once at the end. When a journey goes green,
confirm its relevant invariants are actually asserted by a test in that journey
(e.g. J-CONTENT must assert relay-can't-read-plaintext; J-UNILATERAL must assert
busy-never-ABSENT and channel-swap-rejected). The reviewer also checks them. An
invariant that nothing asserts is not satisfied — it's assumed, which is how they
broke before.

## 8. What a handoff / checkpoint entry contains

At every journey boundary, or before compaction, append a journal entry with:

- Which journeys are green against the live test (DoD-IDs proven), with the test
  run output, not a claim.
- The exact next red (the lowest non-green DoD line) and the one-sentence target.
- Branch + HEAD commit; whether the reviewer has run on everything up to HEAD.
- Any blocker needing Andre (a decision, a deploy, a merge) — stated explicitly,
  with what's blocked and why.
- Anything found that changes the DoD (a dropped item resurfaced, an invariant that
  needs a test, a Tier-5 ❓ resolved) — and reflect it in the DoD itself.

Verified-green (unit + in-process + live journey) is the only "done." A claim
without a test run is not done. Report failures with their output; never round up.
