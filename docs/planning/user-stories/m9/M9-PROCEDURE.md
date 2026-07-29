---
name: M9 Procedure — How to Work the Milestone
type: procedure
date: 2026-07-29
milestone: M9
status: open
topics: [m9, security-governance-layer, gateway, connect-unit, procedure, runbook, sqlcipher, config-surface]
description: >
  The operating runbook for M9, the security and governance layer — modernized 2026-07-29 to the
  M10B standard and reopened for the CONNECT UNIT. The layer was built and gate-green in June 2026;
  the 2026-07-27 policy surface audit proved it never runs in the shipped product (live daemon log:
  security.gateway.connected mode:"passthrough"). This reopening wires it in (D-2), moves its stores
  into the encrypted database (D-3), gives it a control surface with the CLI confirm (D-4), removes
  the environment-variable bypass (D-5), and ships the "what did my policy do" command (D-11).
  SELF-CONTAINED — no other milestone's procedure needs to be read. Read FIRST, then
  M9-DEFINITION-OF-DONE.
---

# M9 Procedure — How to Work the Milestone

## REALITY CHECK — read before anything
One user: Andre, also the only developer. CELLO is **alpha — no production, no real users.**
- **Never gate/hedge/ask permission on a CODE change.** Correctness + security fixes ship immediately.
- **Do not invent decisions for Andre.** "Should I do this code work?" is always yes.
- **DO pause for a GENUINE design fork** (materially different architectures) — but in autonomous
  mode you PARK it (DoD "Parked" section + journal), never block.
- **The publish cascade to beta is authorized** (via /cello-publish, never from memory). This unit
  touches **no AWS**: it is cello-client code plus docs. If a session finds itself reaching for AWS,
  stop and re-read the scope fence — that is a sign of drift, not a task.

### THE FOUR WAYS A RUN DIES — hard rules, not advice

**1. FINISHING SOMETHING IS NOT A STOPPING CONDITION.** The instant a unit goes green, reviewed,
committed, and the DoD tag is flipped, **pull the next red DoD line and start it in the same turn.**
Nothing releases you; there is no gate. The only legitimate stopping points: the milestone tier is
closed, or you are hard-blocked on a human-only step (§2c) *and* every other DoD line is too.

**2. NEVER ASK A QUESTION in autonomous mode.** `AskUserQuestion` stops the session dead. The
decisions this unit needs were all taken on 2026-07-28 (policy audit §10: D-2, D-3, D-4, D-5, D-11).
Something genuinely new: verifiable → verify it; has a best practice → take it and log an `M9C-D*`
decision; genuinely undecidable → PARK and pull the next line.

**3. THE CRON IS A DEFIBRILLATOR, NOT A METRONOME.** It exists only to restart a stalled session.
If you are working when it fires, it changes nothing — keep going. "Waiting for the next cron tick"
is itself the bug it exists to prevent.

**4. COMMIT AND PUSH CONSTANTLY — never >~15 min.** Every fix, every doc update, every green unit.
Push after every commit; never batch pushes (Andre reviews by push). Detailed messages — the why,
the forensics, the decision.

## THE MILESTONE IN ONE PARAGRAPH
M9 built the whole security and governance layer in June 2026 and proved it end-to-end (M9-GATE-1,
2026-06-23): inbound sanitization, the injection matcher, the language allowlist, outbound secret
redaction (the full 222-rule gitleaks dictionary), PII whitelist + bulk-dump warn, rate limiting,
the four governance dispositions, the versioned tighten-free/loosen-confirmed config store, and the
hash-chained security-pass records. **All of it is inert in the product.** The daemon's composition
root never sets `config.securityGateway`, so every shipped daemon falls back to
`PassthroughGatewayClient` — an always-allow stub — and has announced `mode:"passthrough"` on every
boot. The gate that closed M9 did the wiring itself (it injected a real client), so it proved the
layer works *when connected* and hid that only the test connects it. **This reopening is the CONNECT
UNIT: wiring, custody, surface, and gate integrity — not construction.** Everything it switches on
already exists and is gate-green.

**The five decisions of record (policy audit §10, 2026-07-28 — do not re-litigate):**
- **D-2** — reconnect in **enforcing** mode, everything except the DeBERTa model (which stays
  deferred). Ship the operator escape hatch in the same unit.
- **D-3** — local policies live in the client's **encrypted database: one key, covered by backup**.
  The separate-key/`SI-001` guarantee relocates to the remote scanner (M9-REMOTE-001, Phase 2);
  the local simulation of it is dropped as unenforceable theatre.
- **D-4** — a loosening requires a human confirmation: **CLI prompt now, passkey later.** Keep the
  two existing control surfaces (agent settings, contacts) and add **one** for the security layer.
- **D-5** — the `CELLO_GATEWAY_*` policy overrides are **removed from shipped builds**. Security
  settings come from the database only. A gate with a published bypass is not a gate.
- **D-11** — one small **"what did my policy do"** command — a single list, newest first, with
  reasons. It ships WITH the enforcement flip: it is the answer to the attribution worry ("is this
  new error the flip or my other work?").

## 0a. Severity triage (spend effort top-down, never invert)
1. **CORE JOB.** A stock-install daemon — the shipped bin, no test injection — boots with the
   screening sidecar running, screens every outbound send and every inbound ingest, redacts a real
   secret, sanitizes a crafted inbound, records both, and announces its mode truthfully. If broken
   or missing → top priority.
2. **SILENTLY-BROKEN CORE / SECURITY HOLE.** Looks done but the kernel is missing. **Most dangerous
   category — it is the exact failure mode that caused this reopening.** For this unit specifically:
   - **Injection-seam theatre** — a gate or test that constructs the gateway client itself and
     injects it proves nothing about the product. The enforcer must anchor to the SHIPPED
     composition root (`core/daemon/src/bin/cello-daemon.ts`), spawning the real binary.
   - **Silent passthrough downgrade** — any path where sidecar spawn/connect failure quietly falls
     back to passthrough or otherwise lets content flow unscreened. Fail-closed and ANNOUNCED, or
     it is the old defect with extra steps.
   - **Agent self-loosening** — any surface an LLM can drive (MCP tool, IPC verb) that can produce
     the loosen-confirmation. The confirm is a human at a TTY (D-4). An MCP path that loosens is
     the whole gate defeated.
   - **Plaintext resurrection** — gateway config or records reachable as plaintext on disk after
     STORE-1, or a new `node:sqlite` import anywhere. The ESLint allowlist only ever SHRINKS.
   - **Env bypass resurrection** — a removed `CELLO_GATEWAY_*` override quietly resurfacing (in
     spawn plumbing, in a test helper that leaks into prod paths, in a default).
3. **Real non-core gaps.** 4. **Hardening / polish.**

Informed-skeptic test before calling anything done: would someone who deeply understands this say it
works — or that the kernel is missing? (For M9 the informed skeptic reads `~/.cello/daemon.log` and
looks at the `mode` field. That is the bar.)

## 0. Read order (every session)
1. This procedure.
2. [[M9-DEFINITION-OF-DONE]] — **Orientation first**, then the lowest non-✅ line = next unit;
   Decisions + Parked.
3. [[M9-BUILD-JOURNAL]] — the RESUME STATE block + the last entries.
4. **Decisions-of-record:** [[2026-07-27_2049_policy-surface-audit-touchpoints-and-open-decisions]]
   — §0 (the finding), §10 (D-2..D-5, D-11 with Andre's reasoning), §14 (the settings register),
   §15 (the work list this unit implements items 1–4 + 8 of).
5. **Background only when a unit needs it:** [[M9-CAPABILITY-HARVEST]] (the June design decisions),
   the V3 gateway internals log (2026-05-28), the daemon-seam log (2026-06-21). Do NOT re-derive
   settled design from these — they predate the D-3 amendment.
Then start the loop (§2).

## 1. The artifacts
| Artifact | Role |
|---|---|
| **M9-DEFINITION-OF-DONE** | The **yardstick + sole status authority** — ordered, status-tagged, carries Decisions + Parked. Flip tags in place; one line of evidence + `→ Entry C·N`, never an essay. |
| **M9-BUILD-JOURNAL** | The **audit trail + evidence home** — append-only, dated entries; the connect-unit series is numbered `C1, C2, …` so DoD pointers resolve. Full proofs, forensics, run output live HERE. Keep the RESUME STATE block at the top current. |
| **The composition-root live gate** | **Enforcer.** Spawns the real `cello-daemon` binary (the shipped bin, zero injection) plus its real sidecar, and drives real `cello_send` / inbound ingest through it. THE lesson of this milestone: a test that does the wiring itself certifies nothing. `DOD-M9C-GATE-1` is this gate; connect-unit lines are ✅ only when it is green. |
| **The existing M9 suites** | The June unit + seam tests stay green throughout — they prove the layer still works; the new gate proves the product actually runs it. |

## 2. The core loop (one unit = one DoD line)
1. **Find the red** — lowest non-✅ DoD line. Don't skip ahead.
2. **State the target** — one sentence of observable behavior, PLUS expand the full DoD line (every
   clause) into a clause checklist in the journal. That checklist is what the reviewer receives.
3. **Falsify first** (CLAUDE.md Debugging Discipline) — call site has the method on the INTERFACE?
   Responsibility lives here? Redundancy? What else breaks? Only then code.
4. **Red-first** — assertion in the live gate and/or a focused in-process test. Red for the right
   reason (apply the revert test). No mocks for crypto.
5. **Implement** — minimum change to green; nothing speculative. Design-significant units get their
   design note FIRST (§6).
6. **Floor holds** — `pnpm run test` → `lint` → `typecheck` → `build` in cello-client. Vitest ONE
   worker, foreground, timeout, filtered. Never background a test process.
7. **Commit** (constantly — §3). Push.
8. **Review — ONE read-only reviewer on the unit's diff: `cello-unit-reviewer`, NO model override.**
   The dispatch supplies: the DoD line VERBATIM, the clause checklist, the diff, the repo. Include
   the standing M9 lenses (§2b). Fix EVERY finding; commit fixes. **One pass; two is the hard cap**
   (§3). **`cello-unit-reviewer` is the ONLY review agent this project uses** — see §3.
9. **Update docs** — flip the DoD tag (+ one-line evidence + journal pointer), append the journal
   entry, commit, push.
10. Back to 1 — in the same turn.

## 2a. Repos — where work lands
**Center of gravity: cello-client.** Everything in the connect unit is client code:
- `core/gateway` — the stores (SQLCipher move), the bin (env-override removal), spawn plumbing.
- `core/daemon` — the composition root (`src/bin/cello-daemon.ts`) + `startDaemon` wiring; sidecar
  lifecycle; the config IPC verbs; backup/restore coverage of the new store.
- `core/cli` — `cello config …`, the loosen confirm prompt, the D-11 policy-log command.
- `core/adapter-claude-code` — the MCP read/tighten surface (parity per §5; loosening is CLI-only
  BY DESIGN — that asymmetry is a decision, not a parity bug).

**trustless-cello: docs only** (this folder + the policy audit + STATE.md untouched). **No directory
work, no portal work, no AWS.** A unit that thinks it needs another repo's code states why in its
journal checklist before touching it.

Standing client rules: new tables/columns key on `agent_id` never `agent_name`; SQLCipher only
(`node:sqlite` VERBOTEN — the allowlist in `eslint.config.mjs` only shrinks); the client is a heavy
local node (install size, process lifecycle, client-side migrations all matter); extend the existing
fixtures, never write a from-scratch `makeFixture()`.

## 2b. Reviewer dispatch — standing M9 lenses
Include these verbatim in every `cello-unit-reviewer` dispatch for this milestone:
- **Composition-root lens.** Flag any test presented as proof of product behavior that injects
  `config.securityGateway` or constructs `LocalSidecarGatewayClient` itself. Injection-seam tests
  are fine as unit tests; they are BLOCKING when cited as the enforcer.
- **Fail-closed lens.** Flag any path where the gateway being absent/unspawnable/timed-out lets
  content flow unscreened or reports success. A timeout is a verdict (block + reason), never a hang,
  never a pass (INV-6). Degraded paths are ANNOUNCED via a named event.
- **Self-loosening lens.** Flag any machine-drivable path (MCP, IPC, env, config file) that can
  produce or bypass the loosen confirmation. The confirm is an interactive human act (D-4).
- **Custody lens.** Flag any gateway state written outside SQLCipher-encrypted storage covered by
  backup, and any `node:sqlite` import. Assert absence on the BUILT artifact, not source.
- **Error substitution.** An exit-point label (`gateway_error`) standing in for the real cause
  (`sidecar_spawn_failed`, `config_db_locked`) is a finding; the upstream reason must survive in
  the payload.
- **The revert test.** For every new test: would it still pass if the fix were reverted?

## 2c. Publish sequencing
**Load `/cello-publish` for THIS publish — every publish, never from memory.** Loading it earlier in
the session does not count (hook-enforced). Batch the whole connect unit into ONE cascade at the
end (gateway → daemon → cli → adapter/connect as the dependency graph requires), publish to
**beta**, verify the BINARY (`npm view … dependencies` — real versions, never `workspace:*`), pin
the local install, VERIFY the pin (`claude mcp get cello`).

**Two human-only steps, DEFERRED never awaited:** the `latest` promotion (prepare + `--dry-run` +
hand to Andre) and the `/mcp` reconnect. Journal them and keep working.

## 3. Cadence
- **Commit constantly** — never >~15 min without one; push after every commit. Docs commit straight
  to main in trustless-cello; client code commits to main in cello-client.
- **Review every unit** on its diff, right after green. Never batch reviews.

> ### 🚨 ONE REVIEW PASS PER ARTIFACT. TWO IS THE ABSOLUTE MAXIMUM. HARD CAP.
> Reviewers always find something; an unbounded review loop has no termination condition. One pass;
> a second ONLY if the first found a defect that changed the artifact's shape. There is no third.
> Remaining findings become ACs on the units they affect. (The cost of violating this:
> `DOD-END-ARCH-1`, 2026-07-28 — five passes, an entire overnight session, zero lines of code.)

- **Live gate at start + end of every unit** once `DOD-M9C-GATE-1` exists; before that, the unit's
  focused suite.
- **Checkpoint at the tier boundary:** journal summary, commit, push. Keep the RESUME STATE block
  at the top of the journal current — it is an obligation, not a habit.

> ### 🚫 `cello-done-auditor` IS RETIRED. DO NOT DISPATCH IT.
> **`cello-unit-reviewer` is the only review agent this project uses.** The done-auditor predates
> the current process: it expects a milestone backed by full user stories and ACs, and it re-runs
> long suites to re-derive verdicts the per-unit review already produced. Pointing it at this
> milestone burns a large number of tokens to re-litigate work that was already reviewed.
>
> Andre, 2026-07-29, after I dispatched it twice in one session: *"We don't use this agent anymore
> at all… We only use one agent, which is the unit reviewer."* I had copied the tier-boundary step
> out of [[M10B-PROCEDURE]] without checking whether the agent was still in use, so a stale
> convention propagated into a fresh document and then into two dispatches. **If a procedure tells
> you to dispatch a review agent other than `cello-unit-reviewer`, that procedure is out of date —
> fix it rather than following it.**
>
> **On flipping status tags without it:** the per-unit reviewer is the check. Beyond that, a tag is
> earned by the ENFORCER'S OUTPUT, quoted in the journal — not by a second opinion. If the evidence
> does not read as sufficient, the honest move is to leave the line 🟡 and say why.

## 3a. Autonomous-mode rules
**NEVER `AskUserQuestion`.** Decision rubric: verifiable → verify; best practice → take it, log an
`M9C-D*` in the DoD Decisions section, proceed (redo > block); genuinely undecidable → PARK and pull
the next line. Arm the heartbeat cron at kickoff; re-arm after every restart/compaction. The cron
prompt is §3b of M10B-PROCEDURE adapted verbatim — defibrillator, not metronome; self-audit; commit;
never end a turn idle; `CronDelete` itself when the tier closes.

## 5. Hard rules (non-negotiable)

### 5a. The M9 invariants (amended 2026-07-29 — the DoD is authoritative)
- **INV-1 No-LLM base** — the detection pipeline is deterministic; the only model is the (deferred)
  DeBERTa scanner. Judgment work is Day 2, via hooks or upstream — never in the base.
- **INV-2 Not a moderation tool** — no toxicity/sentiment/topic policing, in or out.
- **INV-4 (AMENDED per D-3)** — the gateway owns its config and records **in SQLCipher storage
  opened with the daemon's key, inside the backup unit.** The old separate-file/separate-key clause
  and `M9-CFG-001 SI-001` are re-scoped to the remote gateway (Phase 2): on a machine the operator
  controls, a store the daemon "cannot read" was never enforceable — whoever owns the laptop can
  simply not run the scanner. The amendment is recorded in the DoD Decisions section; treat any
  document still asserting local separate-key protection as superseded.
- **INV-5 Unified seam** — all inbound passes `ingestReceivedContent`; all outbound passes
  `cello_send`. No content path bypasses the gateway, including recovered park content.
- **INV-6 The feedback channel never lies and never hangs** — every `cello_send` returns a terminal
  verdict within a deadline; a timeout is a verdict (block + reason), not a hang.
- **INV-7 Error discipline** — distinct code per failure cause; actionable `guidance`; injected
  logger, no `console.log`; `domain.noun.verb` events; correlationId threading.
- **INV-9 (NEW) Connected by default, passthrough is test-only** — no shipped code path constructs
  `PassthroughGatewayClient`; a daemon that cannot screen does not pretend it can (fail-closed,
  announced). The mode the daemon announces at boot is the mode it is actually in.
- **INV-10 (NEW) The loosen gate has no side door** — every loosening flows through the versioned
  store's confirm gate, produced only by an interactive human act. No env var, no MCP tool, no IPC
  verb, no config-file import can loosen silently.

### 5b. Recurring defect classes
- **ABSENT IS NOT FINE.** A guard whose input is missing/unreadable/unrecognized REFUSES; a default
  that lets the caller proceed is a security defect even if currently unreachable. Degradations that
  availability genuinely requires are ANNOUNCED (named event) and journaled — never silent.
- **ERRORS NAME THEIR CAUSE, NOT THEIR EXIT POINT.** Would this message send a competent operator
  to the right subsystem?
- **NO CONSUMER, NO SHIP.** Every new field/event/knob needs a named consumer in the same unit.
- **NO ARCHAEOLOGY COMMENTS.** State the constraint the current code cannot show; rewrite rather
  than delete the load-bearing part. Present tense, imperative. (The two store files' "the daemon
  does the same" plaintext justification — false since 2026-06-25 — is the cautionary example; it
  dies with STORE-1.)
- **DEADNESS IS PROVEN BY DELETION, NOT BY GREP** — grep both repos, read the `exports` map, delete,
  run both gates. Triage deleted tests by SUBJECT. `rm -rf core/*/dist` → build → test when files
  move or die: `tsc --build --clean` does not remove orphans, and a warm-tree publish re-ships them.
- **MEASURE BEFORE QUOTING A NUMBER.**

### 5c. Process
- **One thread. One coder (the main loop). NO parallel implementation agents.** Read-only subagents
  only — `cello-unit-reviewer` or an explorer. Never a second review agent (see §3).
- **🚨 CHECK FOR A SECOND AGENT IN THE CHECKOUT BEFORE THE FIRST BUILD.** Run `git status -sb` and
  `git worktree list` at kickoff. If another session has uncommitted work in the primary checkout,
  **create your own branch AND worktree before you build anything** — not after the first
  collision. Sharing a tree means sharing `node_modules`, `dist/`, and the lockfile: a `pnpm
  install` or a repo-wide `vitest` sweep lands underneath the other agent's gate run and fails it
  for reasons that have nothing to do with their code, which costs them a debugging detour.
  Learned the hard way on 2026-07-29 against the M10B session (Entry C4). **This unit's home is
  branch `m9/connect-unit`, worktree `/Users/andrep/Documents/code/cello-client-m9c`.**
- **Filtered test runs only** (`vitest run <file>`), never a repo-wide sweep, even in your own
  worktree — it is minutes of CPU for a signal a filtered run gives in seconds.
- Commit often, push every commit.
- **MCP/CLI parity for reads and tightenings; loosening is CLI-only BY DESIGN (D-4)** — record the
  asymmetry where the parity checker will see it, so it reads as a decision, not a gap. Parity of
  names is not parity of calls: verify the wired parameter names end-to-end (the M10B SURFACE-1
  lesson — the verbs were dead on both surfaces from one wrong parameter name).
- **Vitest: one worker, foreground, timeout, filtered.**
- **Deferrals get a home** — DoD Parked + journal. No silent deferral.

## 6. Design-significant units — design note in the journal FIRST, then the loop
Each of these gets a design note before any code (template below — it names the unit's FULL
observability event set; the reviewer verifies implementation against it):
- **`DOD-M9C-STORE-1`** — the custody move. Must decide: which encrypted home (a table set inside
  an existing daemon DB vs a sibling SQLCipher file under the same key — weigh two-process write
  contention against "one database"; both satisfy D-3's actual test, which is the backup unit);
  how the key reaches the sidecar (never argv, never world-readable); what happens to an existing
  plaintext store (one-time import, then the plaintext file is deleted); whether the hash chains
  restart at a genesis row recording the import.
- **`DOD-M9C-WIRE-1`** — the connect. Must decide: sidecar lifecycle (spawn at daemon boot, dies
  with the daemon; orphan handling given the SQLite-lock discipline); the boot sequence and
  readiness handshake; the exact fail-closed behavior when spawn or the socket fails (daemon up,
  screening calls fail closed with cause, announced event) and its user-visible surface.
- **`DOD-M9C-SURFACE-1`** — the control surface. Must decide: command grammar; how the confirm
  prompt renders a loosening (what changes, from what, to what); the MCP refusal message for a
  loosening (actionable, names the CLI command); how `allow_always` (a persisted loosening) rides
  the same gate.

### The design-note template (use this structure)

```markdown
### 2026-MM-DD — Entry C·N: DESIGN NOTE — DOD-M9C-<UNIT> (written before any code)

**Target behavior (one sentence).**
**Spec anchors.** DoD line clauses + the policy-audit decision (D-n) each implements; RFCs for any
crypto touched. A clause nothing pins gets called out as a decision this note makes.
**Producer/consumer chain.** Who produces each new thing, who consumes it, what breaks at each hop.
**The seam.** Exactly where this meets existing code (files/interfaces); what it must NOT know.
**Invariants at stake.** Which INV-* this unit could violate and the design property preventing each
— for this milestone, always address INV-9 and INV-10 explicitly.
**Approach + rejected alternative.** 3–6 sentences, plus at least ONE alternative and why it lost.
**Falsification pass.** Interface has the method? Responsibility lives here? Redundancy? What breaks?
**Decisions this note makes.** Numbered; material ones graduate to the DoD Decisions section.
**Observability.** The FULL `domain.noun.verb` event set, context fields, correlationId threading,
error paths.
**Test plan sketch.** The red-first assertions and which enforcer proves the unit.
```

## 7. What a checkpoint/handoff entry contains
Which DoD lines are ✅ WITH the enforcer-run output (not a claim); the exact next red + one-sentence
target; HEAD commits (both repos) + whether the reviewer ran to HEAD; published versions if a
cascade shipped; anything parked; anything that changes the DoD. Keep the journal RESUME STATE block
current.

---

## Related Documents

- [[M9-DEFINITION-OF-DONE]] — the yardstick + sole status authority
- [[M9-BUILD-JOURNAL]] — audit trail + evidence home (connect-unit entries numbered C1…)
- [[2026-07-27_2049_policy-surface-audit-touchpoints-and-open-decisions]] — decisions-of-record:
  §0 the finding, §10 D-2..D-5 + D-11, §14 the settings register, §15 the work list
- [[M9-CAPABILITY-HARVEST]] — the June design decisions (background; predates the D-3 amendment)
- [[M8C-DEFINITION-OF-DONE]] — `DOD-CRYPTO-AT-REST-1` (the custody defect this unit closes) and
  `DOD-CONFIG-1` (the parked surface this unit builds)
- [[M10B-PROCEDURE]] — provenance of this document's standard (this one is self-contained)
