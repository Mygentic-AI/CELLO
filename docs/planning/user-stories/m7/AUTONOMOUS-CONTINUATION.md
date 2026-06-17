---
name: m7-autonomous-continuation
type: handover
date: 2026-06-17
topics: [m7, daemon, keystone, autonomous, overnight, registration]
status: active
description: >
  Standing instructions for an autonomous overnight session (fired by a one-shot
  cron at 22:10 on 2026-06-17, after Andre's quota reset). Andre is asleep / out of
  quota and cannot give instructions. This doc is the authority for what to do,
  what NOT to do, and how to leave the work for morning review.
---

# M7 Daemon Build — Autonomous Continuation Instructions

You are running unattended. Andre set up a one-shot cron to fire you at ~22:10 local
because his quota was exhausted and he went to bed. There will be NO human to answer
questions. Act with discipline, stay strictly inside the safe envelope below, and
leave an excellent morning report. **Overnight + milestone (M7) + dev/staging =
proceed without asking** — but only within the hard limits in §3.

## 0. First thing — read these, in order
1. This document, fully.
2. `docs/planning/user-stories/m7/DAEMON-MIGRATION-AUDIT-AND-HANDOVER.md` — §10 (Execution
   Plan), §7b (Decision log), §9 (code anchors). The source of truth for the build.
3. The keystone commits already on the branch (see §1) — `git log` them to see what's done.
4. `~/.claude/.../memory/MEMORY.md` standing rules (commit often, worktrees, no micro-stories,
   assume-code-exists, deployment discipline, vitest one-worker).

## 1. Where the work stands (as of 2026-06-17 ~21:00)
- **Keystone Parts 1 & 2 are DONE, reviewed, all findings fixed.**
  - Repo: `cello-client`. Branch: **`CELLO-M7-KEYSTONE`**. Worktree:
    `/Users/andrep/Documents/code/cello-client/.claude/worktrees/CELLO-M7-KEYSTONE`.
    Branched from `main` @ `9fcb2bf`. **NOT merged** (Andre merges).
  - Commits: `758e0eb` (dialer `signaling-connect.ts`), `7794443` (entrypoint wiring),
    `e8d3ee9` (tests), `903433d` (Opus code-review fixes H1/M1/L1–L4).
  - Gate green: 222 daemon tests, lint, typecheck. Wire format confirmed a faithful
    port of the M6 `#doOpen` handshake. The daemon now builds a real `signalingConnect`
    from a `/bootstrap` resolver + the primary loaded-agent identity, exactly like M6
    connected (step-6 directory verification OFF — the M6 backward-compat path).
- **Key reframing (Andre, 2026-06-17):** M6 worked end-to-end (DKG, agents talking,
  relay, seal). The consortium-manifest officer ceremony is NOT a keystone gate — it is
  opt-in hardening. M7's real goal is concurrency/plurality: multi-agent + multi-session
  in one daemon. Do not re-treat the manifest as a blocker.

## 2. What to build tonight — in priority order
Work top-down. Each item: its OWN worktree + branch off `cello-client` main, code-only,
reviewer subagent, commit constantly. Do as many as you can; quality over quantity.

1. **Action 2 — Registration in the daemon (HIGHEST VALUE, do this first).**
   Port `core/client/src/registration-manager.ts` (RegistrationManager, ~250 lines,
   behind a narrow `RegistrationContext`) + `network-directory-node.ts` (`runNetworkDkg`,
   `NetworkDirectoryNode`) into the daemon. Expose a `cello_register` IPC tool + a `cello
   register` CLI command (note `core/cli` already exists — the architecture is CLI-first;
   MCP is an adapter). Build `RegistrationContext` from daemon internals: the keystone
   signaling stream, the daemon libp2p node, K_local keyProvider, the daemon SQLite
   persistence, `mlDsaKeyFile`. Flow (REG-001): pre-auth token → `register_request` over
   signaling → `dkg_ready` → `runNetworkDkg` → `dkg_complete` → `register_success` →
   persist FROST share + ML-DSA keypair + registration state under `~/.cello/agents/<name>/`.
   Multi-agent: invokable once per agent; ALWAYS via Telegram, NO parent/child ceremony.
   **Capture-now-or-lose-it:** persist the agent→user linkage at registration (using it is
   future work). Verify-don't-trust: READ the actual `registration-manager.ts` first; it may
   not lift as cleanly as the audit claims — if a seam is dirty, note it and adapt, don't rebuild.
   New worktree: `.claude/worktrees/CELLO-M7-REGISTRATION`, branch `CELLO-M7-REGISTRATION`.

2. **DAEMON-004 seal fix** (branch `CELLO-M7-DAEMON-004` already exists, cello-client, 6
   commits, NOT merged, has a seal bug). The seal at `daemon.ts:handleActiveSealFlow` sends
   a `seal_request` frame the directory has no handler for and returns ok:true without
   sealing. Reuse the SESSION-001 interrupted-seal plumbing (`seal_interrupted_request`/
   `_ack` + the FROST ceremony; reference `daemon.ts:975-1003`). Also fix `message_count`
   never incrementing on send/receive (`session-node-manager.ts:833`/`:941`). This needs the
   keystone connection (now built) — but do NOT deploy to test it; unit-level + the morning
   live test covers it. Work on the existing branch (do not start from scratch).

3. **Connections + long-poll receive** (code-only ports, own branch
   `CELLO-M7-CONN-RECEIVE`). Port `acceptConnection` + `evaluateConnectionPackage`
   (pass-through, NO trust layer, NO whitelist) and the blocking long-poll `cello_receive`
   (`mcp-server.ts:703` → `receiveMessageAsync`, SESSION-007). Likely overlaps DAEMON-004's
   send/receive — reconcile, don't duplicate.

Do NOT do: Part 3 (directory "proves itself" / consortium manifest) — it needs a directory
deploy, which is forbidden tonight (§3). You MAY write Part-3 CODE on a branch if you exhaust
1–3, but never deploy it.

## 3. HARD LIMITS — do not cross these unattended
- **NO deployments of any kind.** No `deploy.sh`, no CloudFormation, no `aws` CLI mutations,
  no ECS/SSM/Secrets changes, no infra. Deployment is foreground-only, with Andre. Infra
  changes are live grenades.
- **NO `docker push` from local. Ever.** Image pushes only via CI/CD.
- **NO merging to main. NO `git push` to origin.** All work stays on its branch locally.
  Andre merges and pushes. (Updating local docs/WORKLOG is fine — commit, don't push.)
- **NO new stories, NO workflows.** Direct foreground builds on branches only
  (`[[feedback_no_micro_stories]]`).
- **NO new crons/loops.** You are a single one-shot autonomous session; work continuously in
  this run. (Reviewer subagents will re-invoke you on completion — that's expected.)
- **Vitest: foreground only, ONE worker** (`--pool=threads --poolOptions.threads.maxThreads=1
  --poolOptions.threads.minThreads=1`), always with a timeout. NEVER background a test process
  (it drains the battery). Filter to the package under test.
- **Reviewer = `feature-dev:code-reviewer` with `model:'opus'`** (it pins Sonnet otherwise),
  read-only subagent, AFTER each unit. Fix EVERY finding at every severity (dispute only if a
  finding is actually wrong or a known scope decision — and write down why).
- **Assume code exists; verify against the real code before writing.** Most gaps are
  "built but doesn't fit the daemon," not "never built."
- If you hit anything irreversible, ambiguous, or that needs a human decision or a deploy:
  **STOP that item, write the blocker into §5 of this doc, and move to the next item.** Never
  guess on irreversible/ambiguous things.

## 4. Gate sequence per unit (in order)
`vitest (one worker, foreground)` → `lint (npx eslint <changed files>)` → `typecheck
(pnpm --filter <pkg> typecheck)` → reviewer subagent → fix all findings → commit. Commit
constantly (before tests, after each unit, after each fix). Commit messages explain what +
why. Co-author trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## 5. STATUS + MORNING REPORT (Andre reads this first)

**All human-readable times in this doc are LOCAL (Andre's timezone = CAT, UTC+2). The cron
schedules are also local. The heartbeat below uses EPOCH SECONDS for the staleness math so it is
timezone-proof and cross-platform (macOS + Linux both support `date +%s`).**

**Machine-readable status — keep these lines current; the watchdog (§6) greps them:**

```
STATUS: IN_PROGRESS
LAST_UPDATE: 1781724900   # epoch seconds — 2026-06-17 21:35 CAT
```

STATUS is one of: `NOT_STARTED` | `IN_PROGRESS` | `BLOCKED` | `COMPLETE`.
- Set `IN_PROGRESS` when you begin work; refresh `LAST_UPDATE` to `$(date +%s)` (epoch seconds)
  on every commit and at the start/end of each task — this is your heartbeat. Append a
  `# ... CAT` comment with the local time for human readers.
- Set `BLOCKED` if you stop on something needing a human/deploy (and record why below).
- Set `COMPLETE` only when ALL of §2's tasks are done (or done-or-blocked with nothing left to
  attempt). Once COMPLETE, every later watchdog fire is a cheap no-op.

Keep a running log below: each task → branch, commits (hashes), gate status, reviewer outcome,
what's done, what's blocked and WHY, and any decision needed from Andre. Be honest about
failures — show the output.

### Run log
- 2026-06-17 21:14 CAT — Interactive session (Andre present) started **Action 2 — registration in the
  daemon**. Worktree: `.claude/worktrees/CELLO-M7-REGISTRATION`, branched off **`CELLO-M7-KEYSTONE`**
  (@ 903433d), NOT main — registration depends on the keystone (`signaling-connect.ts` etc. live only on
  the keystone branch). **STACKING RULE: Actions 2/3/4 that build on the keystone must branch off
  `CELLO-M7-KEYSTONE`, not main, until Andre merges the keystone.**
- 2026-06-17 21:17 CAT — **Action 2 scoping (verified against real source — READ THIS before porting):**
  - Port source: `core/client/src/registration-manager.ts` (302 lines, clean). The `register()` flow:
    ML-DSA keygen → `openPersistentSignalingStream` → `register_request {phone_stub, k_local_pubkey,
    ml_dsa_pubkey}` → await `dkg_ready {epochId, participants, threshold}` → `runNetworkDkg(kLocalBytes,
    {threshold, participants, directoryNodes:[NetworkDirectoryNode], preAuthToken})` → `dkg_complete
    {primary_pubkey}` → await `register_success {agent_id, primary_pubkey}` → persist FROST share +
    ML-DSA keypair + RegistrationState. Also handles `already_registered` short-circuits.
  - Seam = `RegistrationContext` (lines 26-43). Frames map onto the transport `SignalingManager`:
    use `sendRaw(frame)` for register_request/dkg_complete; route inbound `dkg_ready`/`register_success`
    via `registerInboundHandler` to the pending resolvers (setPendingDkgReadyResolve/RegisterResolve).
  - **DESIGN WRINKLE (the real work): `RegistrationContext.node` (the libp2p node) is needed by
    `runNetworkDkg` → `NetworkDirectoryNode` to open FROST streams to the directory. But keystone Part 2
    creates the directory-facing node PRIVATELY inside `signaling-connect.ts` connect() — it is NOT
    exposed.** M6 had one node shared by signaling + DKG; the daemon split signaling behind the transport
    manager with a private node.
  - **RECOMMENDED APPROACH (Andre steered toward this; confirm if he left a different note):** make the
    daemon own the "current directory-facing node". Refactor signaling-connect so the daemon mints a fresh
    node, passes it INTO connect() (instead of connect creating it), and retains the reference; on each
    reconnect it mints a fresh node and updates the reference. Result: one-node-per-daemon (exposed to
    registration/FROST/seal) AND fresh-key-per-connect (Peer-ID rotation per the 2026-06-11 architecture).
    `RegistrationContext.node` returns the daemon's current node. Build `cello_register` IPC tool + `cello
    register` CLI (core/cli exists). Persist agent under `~/.cello/agents/<name>/`; capture agent→user link.
  - Next concrete step: do that signaling-connect refactor FIRST (small), then port RegistrationManager +
    NetworkDirectoryNode into the daemon behind a daemon-built RegistrationContext. Reviewer + gate per unit.
- 2026-06-17 21:27 CAT — ✅ **node-exposure unblocker DONE** (commit `3796e3e` on `CELLO-M7-REGISTRATION`).
  Chose the additive `publishNode` callback (not "daemon mints node") — cleaner, keeps keystone's
  fresh-node-per-connect intact. signaling-connect publishes the live node on connect / null on close;
  daemon holds it and exposes `DaemonHandle.getDirectoryNode()` (null unless signaling connected). 222
  daemon tests pass, lint+typecheck green. **NEXT (the big port, not yet started):**
  1. Copy `core/client/src/registration-manager.ts` + `network-directory-node.ts` into `core/daemon/src/`
     (adapt imports; `Logger` from daemon types; node from `getDirectoryNode()`).
  2. Build a daemon `RegistrationContext`: `node` = `getDirectoryNode()` (require signaling connected);
     `keyProvider` = the registering agent's K_local; signaling frames (register_request/dkg_complete)
     via `signalingManager.sendRaw`; route inbound `dkg_ready`/`register_success` via
     `signalingManager.registerInboundHandler` to the pending resolvers; `persistence` = daemon SQLite;
     `getDirectoryEndpoint` = the bootstrap resolver's last value; `mlDsaKeyFile` per agent.
  3. Expose `cello_register` IPC tool (ipc-server) + `cello register` CLI (core/cli). Persist agent under
     `~/.cello/agents/<name>/`; capture agent→user link (capture-now-or-lose-it).
  4. Tests (red-first ideally) + reviewer (model:'opus') + gate. Commit per unit.
  Verify-don't-trust: READ `network-directory-node.ts` before porting — confirm runNetworkDkg's node
  usage + preAuthToken path; it may need adaptation to the daemon's single shared node.
- 2026-06-17 21:35 CAT — ✅ **network-directory-node.ts verified (751 lines).** Design holds end-to-end:
  `NetworkDirectoryNode` takes the libp2p node via its CONSTRUCTOR (`opts.node`, line 68) and opens
  `/cello/frost/1.0.0` streams on it (newStream/dial); `runNetworkDkg(agentPubkeyHex, {threshold,
  participants, directoryNodes:[NetworkDirectoryNode], preAuthToken})` runs 3 rounds, threading
  `preAuthToken` into round 1 (OPS-AGENT-001, mandatory M6+). PORT PLUGS STRAIGHT IN: construct
  `NetworkDirectoryNode({ node: getDirectoryNode()!, directoryPeerId, directoryMultiaddrs, logger })`.
  No node-sharing adaptation needed beyond getDirectoryNode(). The remaining port (copy 2 files in,
  build RegistrationContext, cello_register IPC+CLI, tests) is one focused unit — ideal for the
  overnight run or a fresh quota window. Checkpoint is clean: everything committed, branches stacked.

## 6. WATCHDOG PROTOCOL (for the 23:00–04:00 every-30-min cron)
<!-- Extended through 04:xx: the 22:10 run's quota window resets ~03:10, so the
     watchdog must keep firing past that to catch the reset and resume. -->

You may be fired by the watchdog cron whose only job is to recover the run if it was stopped by
an Anthropic API block, quota exhaustion, or any other halt. Spend MINIMAL tokens on the
happy path. When fired by the watchdog:

1. `grep -E "^(STATUS|LAST_UPDATE):" docs/planning/user-stories/m7/AUTONOMOUS-CONTINUATION.md` — one cheap read.
2. If `STATUS: COMPLETE` → reply exactly `watchdog: complete, nothing to do` and STOP. Do not read
   anything else, do not run tools.
3. If `STATUS: IN_PROGRESS` AND fresh — `LAST_UPDATE` (epoch) is < 1200s before now: compute
   `now=$(date +%s)`, stale if `now - LAST_UPDATE > 1200` — then the main run is probably alive and
   mid-flight (cron only fires when idle, e.g. waiting on a reviewer subagent). Reply
   `watchdog: run active, standing by` and STOP — do NOT start a second driver.
4. Otherwise (`BLOCKED`, or `IN_PROGRESS` but stale ≥1200s, or `NOT_STARTED`) → the run stalled or
   never started. RESUME: read this doc fully, set `STATUS: IN_PROGRESS`, refresh `LAST_UPDATE`, and
   continue §2's tasks from where the run log shows you left off, within §3's hard limits. (If it was
   `BLOCKED` on a true human/deploy blocker, leave it blocked and move to the next attemptable task.)
