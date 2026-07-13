---
name: daemon-refactor-plan
type: implementation
date: 2026-07-13
topics: [daemon, refactor, seams, closure-capture, code-review, m8c]
status: ready-to-execute
description: >
  Execution plan for decomposing core/daemon/src/daemon.ts (6,255 lines in ONE function, 46 IPC
  handlers, 73 shared locals). The job is NOT "make the file shorter" — it is converting implicit
  closure capture into explicit dependencies. Grounded in measured numbers, not estimates. Carries
  the guard asymmetries the measurement already exposed, the DO-NOT-CUT list, and the open decisions.
  A refactor IS a code review: every anomaly it surfaces is a finding to log, never noise.
---

# `daemon.ts` — the refactor plan

> **Pinned to `cello-client` main `1365e05` and `trustless-cello` main `ef83d327` (2026-07-13).**
> Every line number below is valid **only** against those commits. **`trustless-cello` main is
> MOVING** — another agent pushed `ef83d327` (`DOD-SESSION-NAME-1` / `DOD-AGENT-PARAM-1`). **Pull
> before starting**, and read `DOD-AGENT-PARAM-1` first: it sounds like it touches agent selection,
> which is exactly the code changed in `resolveCurrentAgent` (§6.3 below).

---

## 0. Where things stand (read this first)

**Phase 0 and Phase 1 of the reduction work are DONE and on main.** The dead-code purge, the
comment archaeology, and six defects are shipped. See
[[2026-07-13_dead-code-and-defect-reduction-workplan]] for that work; this document is what comes
next and does not depend on re-reading it.

**Net effect so far:** production code 34,722 → **24,636 lines (−29%)**; 32 dead files → 1
(survivor is `core/test-fixtures/src/index.ts`, dead by design); the entire M6-era in-process
client (`core/client`, 25,577 lines across 52 files) is gone.

**Coverage — measured for the first time on 2026-07-13** (it had never been run; there is still no
coverage provider in the repo, it was installed temporarily and reverted):

| | |
|---|---|
| Statements / Lines | **75.34%** (15,298 / 20,303) |
| Branches | 79.78% |
| Functions | 86.92% |
| **`daemon.ts`** | **66% — 1,434 uncovered lines**, more than the next three files combined |

`daemon.ts` is not badly covered because anyone neglected it. It is badly covered because **you
cannot reach one branch without standing up the whole daemon.** That is a property of the file's
shape, and it is what this refactor fixes.

---

## 1. The core problem, named

> **`daemon.ts` is one function.** `startDaemon` opens at **:303** and returns at **:6558** —
> **6,255 lines in a single function body.** All **46** IPC handlers, the seal machinery, the
> inbound-session queue, the Telegram poller and the discovery negotiator are **closures over 73
> shared locals** (12 of them mutable `let`). No classes. No modules. No parameters.

That one fact is *both* why the file is unsplittable today *and* what the refactor IS:

> ### The job is converting implicit closure capture into explicit dependencies.

Nothing can be extracted until the thing it silently captures is **named and passed**. This is also
why the file keeps growing: **adding** a handler costs nothing (close over more state); **extracting**
one costs everything (enumerate what it touches). **The gradient points the wrong way. That is the
thing to fix** — not the line count.

---

## 2. The prologue is copy-pasted ~20 times

Measured on `1365e05`:

| pattern | occurrences |
|---|---:|
| `perConnectionState.get(connectionId)` | **26** |
| `loadedAgents.find` | 7 |
| `no_current_agent` | **18** |
| `resolveCurrentAgent(` | 13 |
| `getSessionRecord(` | 11 |
| `session_not_found` | 7 |
| `session_not_owned` | **3** |

---

## 3. ❌ THE GUARD ASYMMETRIES — RETRACTED. They do not exist.

**This section originally claimed the review payload of the whole refactor. It was wrong, and the
error was mine.** Re-measured against `1365e05` on 2026-07-13:

| the claim | the truth |
|---|---|
| "26 read connection state, only **18** guard `no_current_agent`" | **All 13 `resolveCurrentAgent` call sites guard**, immediately. The 8 "missing" ones return the shared constant `NO_CURRENT_AGENT_RESPONSE` — invisible to a grep for the literal string. |
| the 10 contacts/settings handlers "don't resolve an agent" | They resolve through `resolveContactAgent` (`daemon.ts:6135`), which **guards internally**. The prologue is already factored — twice. |
| "11 fetch a session record, only **3** check `session_not_owned`" | `getSessionRecord(agentName, sessionId)` is **keyed on the agent**. Ownership is enforced **structurally, by the query key** — you cannot read another agent's session. The 3 explicit returns exist to give a *better error message*, not to perform a missing check. |

**Zero unguarded handlers. Zero unowned session reads.** The numbers in §2 are raw token counts; they
were never evidence of an asymmetry, and reading them as one was the defect.

### The rule this cost us
> **A count of a string is not a count of a behaviour.** A shared constant, a helper, or an enforcing
> key makes a guard invisible to grep while leaving it perfectly present. This is the same
> false-negative that nearly deleted the live `ed25519_FROST` re-export during Phase 0 — the second
> time in two days. **Read the call sites. `M8C-PROCEDURE` §5c ("verification, not assertion") exists
> for exactly this, and this document violated it.**

**Consequence: Unit 1 (the handler decorator) is CANCELLED — not deferred.** Its entire justification
was "force the asymmetries into the open." With the guards uniform and already helper-factored, what
remains is a decorator that saves ~40 lines and surfaces no bugs. Cosmetic. The triage rule says no.

*What survives is §1, which was never a grep result:* `startDaemon` really is **6,255 lines in one
function**, really is **66% covered**, and really is unsplittable because 46 handlers close over 73
shared locals. **The seams (D, A1+C, B) deliver that, and their value never depended on §3.**

*(Andre, 2026-07-13: "these refactorings are actually good as a kind of code review." Still true —
the first thing this one reviewed was the plan for it.)*

---

## 4. Execution order

Each unit: TDD → full gate → `cello-unit-reviewer` (**dispatch Lens 5 explicitly — it fires on
diffs that MOVE code, and lenses 1–4 have nothing to bite on here**) → fix every finding → commit.

**Behavior preservation IS the spec.** A refactor has no DoD clause, but it has an implicit one:
*nothing changes.* Anything whose behavior moves is a finding unless journaled.

### ~~Unit 1 — the handler decorator~~ — **CANCELLED 2026-07-13. See §3.** Its justification was the
guard asymmetries; there are none. Start at Seam D.

### ✅ Unit 2 — Seam D: bootstrap / manifest / consortium — **DONE 2026-07-13** (`719b2be`)
`daemon.ts:395-553` → `core/daemon/src/consortium-bootstrap.ts`. **`daemon.ts` −150/+25.**

Extracted as **two** functions, not one, and the split is load-bearing: `startDaemon` must be able
to **refuse to start between them** (ADV-002). The refusal closes the DB and releases the singleton
lock — both the daemon's, neither the module's — and it must happen **before** the manifest poll
starts, or a refused startup **leaks a live timer**. Fusing them would drag the lock into the module
or leak the timer.

**The payoff is coverage, not line count.** Every failure branch in that block — a clock outside the
validity window, an anti-rollback hit, a load that throws, a roster that only partly resolves — could
previously be reached ONLY by standing up a whole daemon. That is *why* `daemon.ts` sits at 66%. They
are now 17 ordinary unit tests. Two had no direct coverage at all before: a **partial roster still
verifies** (one node down must not strand the rest — the redundancy invariant), and an **empty roster
logs at ERROR**, never buried at info. Reviewer (Lens 5) confirmed behavior preservation
statement-by-statement and proved the dropped `consortiumEndpoints` local dead by reference scan.

### Unit 3 — Seam A1 + C: the address book (~690 lines) — **NEXT**
Straight-line startup that **already returns one object** (`{consortiumEndpoints, manifestVerified,
directoryEndpointResolver, stopHttpManifestPoll}`). Captures almost nothing. **Risk: LOW.** Proves
the module-extraction pattern on the easiest possible target.

### Unit 3 — Seam A1 + C: the address book (~690 lines)
`A1` = contacts / tiers / monikers / settings / telegram store **out of `session-node-manager`**
(~430; needs only `#db`, `#logger`, `#requireAgentId` — **zero** coupling to session runtime).
`C` = their 8 IPC handlers out of `daemon.ts` (~263). They pair naturally. **Risk: LOW / LOWEST.**

### Unit 4 — Seam B: the seal cluster out of `daemon.ts` (~1,250 lines)
The big one, and its boundary is **already half-drawn**: its state is already seal-private
(`sealKey`, `sealInterruptedInProgress`, `pendingSealWaiters`, `pendingUnilateralWaiters`,
`sealUpgradeInFlight`) and it **already takes an injected callback** (`recoverContent`). It already
has siblings on disk: `session-ceremony.ts`, `seal-upgrade.ts`, `seal-frontier-verify.ts`.
**Risk: LOW-MED.**

### Then reassess
Seams E (telegram, ~205), F (discovery, ~380), G (standing receiver, ~230), H (content park, ~250),
I (inbound-session machinery, ~630 — **calls out to nine things; do this late, if at all**).

---

## 5. ⛔ DO NOT CUT — and why

- **Signaling wiring** (`perAgentSignaling` / `signalingFor` / `sendOver`). This is the daemon's
  **nervous system** — read by seal, inbound, discovery, send and register. It is the **hub, not a
  leaf.** Cutting it means threading a signaling facade into every other module.
- **`cello_send` / `cello_close_session`.** They inline the cursor gate, the gateway/governance call,
  seal-flow dispatch, transcript append, telegram clear and retry enqueue.
- **Connection state / cursors / watermarks.** Keyed on the IPC server's `connectionId`, consumed at
  **26 sites**.
- **The inbound content state machine in SNM** (`ingestReceivedContent` / `#appendVerifiedContent` /
  `#releaseHeld` / `recordWitnessedSequence`) — five mutually-recursive mutable maps.
- **Relay client vs session node** — both key off fields *inside* `ActiveSessionEntry`; extracting
  "relay" splits the entry itself.

---

## 6. Open decisions — NOT the coder's to make

### 6.1 §1.8 — the step-6 challenge nonce is REPLAYABLE (the one real open security item)
The nonce in the signed TBS is chosen by the **directory itself** (`signaling-connect.ts:189`), and
`verifyChallenge` (`transport/manifest-stubs.ts:118`) does an Ed25519 verify and **nothing else** —
no freshness check, no nonce-reuse check. So **every input to the TBS except the agent's own pubkey is
chosen by the party being authenticated.** Anyone who has observed one genuine step-6 proof for a
given agent can replay that exact tuple forever and pass.

This defeats step 6 in precisely the threat model its own comment names — *"defeats a /bootstrap MITM
redirecting failover to a rogue directory."* A rogue directory brings its own libp2p key (Noise is
happy) and replays a captured proof to satisfy the manifest check.

**The fix is a protocol change touching the directory** (the challenge must be client-contributed).
**Andre's to schedule. Not to be done inside the refactor.**

*(Note: the `return {}` that SKIPS step 6 entirely for a directory outside the bundled roster is
**sound and deliberate** — local dev and the e2e harness run their own directory, whose pubkeys the
bundle cannot describe. That is not the bug.)*

### 6.2 §1.7 — RETRACTED. Do not spend time on it.
It was flagged as *"one of these two is wrong — a human must decide."* **That was an error.** The
libp2p type definition answers it: `Stream.close()` is a **half-close** — *"the stream itself will
remain readable until the remote end also closes its writable end."* So `send → close → read` and
`send → read → close` are **both correct**. Neither is broken. A cosmetic consistency cleanup at most.

### 6.3 Interaction risk with `DOD-AGENT-PARAM-1`
`resolveCurrentAgent` (`daemon.ts:~2107`) now refuses the sole-online fallback for a connection whose
selection was **taken away** (`clearedAgent`), while preserving it for a connection that **never
chose** (test N1 pins that as intended). Another agent's `DOD-AGENT-PARAM-1` may touch the same
selector. **Read it before Unit 1.**

### 6.4 Still parked from the reduction plan
`§2.2` connection-package functions (zero production consumers — keep the TYPE?); `§2.4`
`registerRelayStream` (an **unwired feature**, not scaffolding — deleting it removes relay-driven
interrupt detection); `§3` `cello_get_inclusion_proof` (**half-built, not superseded** — the directory
MMR pipeline is live, the Merkle crypto is live and tested, the daemon handler was never rebuilt after
M6→M7. Implement, or unregister?).

---

## 7. Standing traps — each of these has bitten, most more than once

1. **`dist/` orphans.** `tsc --build` NEVER removes orphaned outputs, and `tsc --build --clean` does
   **not** either. A warm tree keeps compiling and **packing** files whose source you deleted.
   **Order is: `rm -rf core/*/dist core/*/*.tsbuildinfo` → BUILD → TEST.** *Not* clear-then-test —
   several tests spawn the **real built daemon binary** out of `dist/`, and clearing it first fails
   ~1,000 tests for a reason that has nothing to do with your change. (This exact mistake was made
   while merging Phase 1. The procedure wording says "before any build that follows a deletion" and
   should be tightened to spell out the order.)
2. **Deadness is proven by DELETION, not by grep.** Both repos + the `exports` map (which **IS** a
   consumer) + a red build. An empty grep is suspect, not conclusive.
3. **Triage tests by SUBJECT-UNDER-TEST, never by file.** A test may drive **live** code through a
   **dead** driver.
4. **The revert test.** *Would this test still pass if the fix were reverted?* If yes, it is not
   coverage — whatever its name says.
5. **`main` is moving.** Another agent is active in `trustless-cello`. Pull first.
6. **🚨 TWO AGENTS, ONE WORKING TREE — this bit me on Seam D. WORK IN A WORKTREE.**
   CELLO_Support was working in the **same** `cello-client` checkout. `HEAD` moved under me mid-edit
   (`1365e05` → `7d5ec7a`), and my first Seam D edit was built on the **stale** `daemon.ts` — it
   **silently reverted** their `DOD-AGENT-PARAM-1` guidance strings. **The net line-stat
   (`30+/152-`) hid it perfectly**: the diff looked exactly like the block I meant to move. Two
   failing tests were the only signal, and my first instinct was to attribute them to *their*
   in-flight work. **I checked instead of attributing, and the check is what found it** — they
   *passed* without my change. Fix was to discard my copy, `git checkout HEAD -- daemon.ts`, and
   re-apply the block on the correct parent.
   - **A net line-stat is not a diff review.** A revert and an extraction can net out to the same
     numbers. Read the `+`/`-` lines, or diff the specific strings you did not intend to touch.
   - **"That test isn't mine" is a hypothesis, not a finding.** Prove it: stash your change and run
     the test. If it passes without you, it *is* yours.
   - This is [[feedback_failing_test_must_be_fixed_not_attributed]] and [[M8C-PROCEDURE]] §5c earning
     their keep on the same day, on the same change.

## 8. The gate (run in order, every unit)

```
pnpm run test → pnpm run lint → pnpm run typecheck → pnpm run build
```

Add `--coverage` and **watch `daemon.ts` move off 66%.** That number is the only honest scoreboard
for this work — line count is not.

---

## Related

- [[2026-07-13_dead-code-and-defect-reduction-workplan]] — Phases 0-1 (done); §5 is the seam analysis
  this plan executes
- [[M8C-PROCEDURE]] — §5a-5c now carry the earned rules (absent-is-not-fine; errors name their cause,
  not their exit point; deadness by deletion; measure before quoting)
- `.claude/agents/sparc/cello-unit-reviewer.md` — **Lens 5** (removal & refactor integrity) and
  **Lens 3(a2)** (error substitution) were added for exactly this work
