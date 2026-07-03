---
name: M8B E2E test-results journal
type: discussion
date: 2026-07-02
topics: [m8b, e2e-testing, live-cluster, test-results, resilience]
status: active
description: >
  Live running journal of the M8B post-close E2E testing phase. One row per scenario from the
  testing plan (2026-07-01_0900_m8b-closed-e2e-testing-phase.md), updated as each test runs.
  Records baseline, results, evidence, and any bugs found. Companion to the plan doc.
---

# M8B E2E Test-Results Journal

Companion to [[2026-07-01_0900_m8b-closed-e2e-testing-phase]] (the plan). This is the running
record of what was actually tested and what happened.

Testing constraints: single interactive Claude session. Counterparties available = (a) two local
agents on one daemon via `cello_use_agent`, (b) the EC2 demo agent (`i-0ad3e7c22470f266e`,
`7ab98987…`) as a separate daemon on a separate device. Scenarios needing a genuinely independent
second operator are deferred to the future Hermes-instance device.

## Order of execution

A (safe) → B (reversible) → D (EC2, self-contained) → C (directory node-down, cascade restore) →
E (relay failover). Rationale: safe-to-expensive. Directory node-down and relay failover carry a
documented restore cascade (see plan doc + `infra/CLAUDE.md`), so they run last and batched.

## Pre-flight baseline — 2026-07-02 11:20 CAT

- ✅ All 6 ECS services 1/1 `COMPLETED` (directory + relay × us-east-1, eu-central-1, ap-northeast-1)
- ✅ All 6 DNS names resolve (directory-us1/eu1/ap1, relay-us1/eu1/ap1)
- ✅ **3 relays exist** (relay-us1/eu1/ap1) — the plan doc's "only one relay exists" note is STALE.
  Relay failover is therefore per-region, not global.
- ✅ Local daemon running, directory signaling connected. Agents: Agent-1 (`c51bb002…`, online),
  Demo2 (`8999608f…`, registered).
- ✅ EC2 demo agent: `cello-daemon` + `cello-demo` both `active`.
- Note: 3 stale interrupted sessions on Demo2 (counterparty `bc94ead6…`, from 2026-06-29/07-01) —
  leftovers from prior testing, not relevant to this phase.

## SESSION PAUSE STATE (2026-07-02 ~12:30 CAT)

**Done:** #8 (✅ known gap), #11 (✅), #2 (✅ protocol / ⚠️ observability gap), #6 (⚠️ FINDING-1 —
unilateral seal never completes). 21 friction entries (F1–F21) + FINDING-1 logged. 5 commits.

**Blocked on Andre:**
- #12/#13 (any-directory / cross-node): need local daemon restarted onto `CELLO_DIRECTORY_URL=eu1`.
  A plain `/mcp` reconnect is NOT enough (F12) — the daemon process must restart with the env set.
  Full procedure in the #12/#13 detail section below.
- #14 (suspension): driven via the front-end portal (not the Telegram ops bot) — not driveable autonomously.
- Phase C (#9/#10/#5 node-down) + Phase E (#4 relay failover): disruptive to shared dev infra;
  awaiting explicit go-ahead. Restore cascade + pre/post health-check discipline documented.

**Live infra state:** cluster untouched & healthy (baseline still valid — all 6 ECS 1/1, all DNS
ok, 3 relays). Local daemon still on us1, pid 83645. EC2 demo agent healthy (daemon+demo active,
standing receiver armed after last restart).

**Loose ends (non-blocking):** stuck session `47d83ad1` (unsealable, FINDING-1); phantom sessions
`09fa513e` + `ffcba2f7` (aborted-offer, my side thinks open); 3 old interrupted Demo2 sessions
(`bc94ead6…`). None affect further testing.

## CONSOLIDATED FIX BACKLOG (ranked)

Derived from FINDING-1/2 + friction F1–F21. "Scope" = where the fix physically lands. Because the
demo agent runs verbatim published code (see architecture-verified section), every `product` fix
below helps ALL operators, not just the demo. Full detail per row is in the friction log.

> **CASCADE-1 STATUS (2026-07-02) — supersedes the per-row "DIAGNOSED" notes below.**
> Shipped to **daemon 0.0.22 / cli 0.0.20** (now `latest`) and closed: **FINDING-1** (row 2),
> **F14/FINDING-2** (row 1), **F13** (row 3), **F16** (row 4), **F20** (row 7), **F1/F2** (row 8),
> **F15** (row 10). **Live-verified this session:** F14 (demo re-arm — two sequential sealed
> sessions, no restart) and F16 (operator `counterparty_gone` + `active_sessions` liveness).
> FINDING-1 operator-side re-verify = **T2, pending** (this session). New this session:
> **F22** (fixed-port 4001 → only one concurrent session) and the **durable-escalation** follow-up
> (FINDING-1 mark is in-memory only). Still OPEN (future design/directory batches): rows 5, 6, 9 +
> F9/F10 and F21/offer-reject forwarding. Full record: [[2026-07-02_1640_m8b-cascade-1-implementation-and-publish]].

| # | Issue | Symptom | Fix location | Scope |
|---|-------|---------|--------------|-------|
| 1 | **F14 / FINDING-2 — standing receiver not re-armed** | Demo (any always-on receiver) goes deaf after ONE inbound session → `standing_receiver_unavailable`; both services still `active` (silent). | **DIAGNOSED 2026-07-02 — see [[2026-07-02_1514_m8b-fix-briefs-cascade-1]] Brief 2.** Root cause: fixed-port EADDRINUSE on immediate re-arm + no retry + inbound path never calls ensure. | product (daemon) |
| 2 | **FINDING-1 — unilateral seal never completes** | Counterparty daemon crashes mid-session → `cello_close_session` stuck in `seal_pending_bilateral` forever; no certificate. | **DIAGNOSED 2026-07-02 — 100% client-side; directory behaved correctly. See [[2026-07-02_1514_m8b-fix-briefs-cascade-1]] Brief 1.** Retry path can never reach the unilateral escalation (`daemon.ts:2421` vs `:2429`). | product (daemon) |
| 3 | **F13 — false success on initiate** | `initiate_session` returns `ok`+sessionId even when counterparty aborts the offer; failure only shows on later `send`. | client/daemon — await accept or return `pending`. | product (client) |
| 4 | **F16 — counterparty-gone invisible** | Daemon detects `liveness:gone` instantly but operator gets a null `receive` timeout; `cello_status` omits it. | client/daemon — surface liveness in `receive` + `status`. | product (client) |
| 5 | **F7 — directory change needs full daemon restart** | Changing `CELLO_DIRECTORY_URL` requires killing the shared daemon → drops all MCP conns + standing receivers. No `cello daemon restart`. | `cello-client` daemon lifecycle. | product (daemon) |
| 6 | **F6/F12 — directory selection invisible** | No CLI/config to pick a node (only undocumented env var); `cello status` doesn't show the bound directory. | client CLI + `cello_status`. | product (client) |
| 7 | **F20/F21 — grace/stuck-seal undiagnosable** | `seal_..._pending` hides `remaining_seconds`; stuck seal has no terminal state/reason. | client surface `remaining_seconds`; terminal failure reason from directory branch. | product (client+dir) |
| 8 | **F1/F2 — CLI discoverability** | `cello refresh` absent from usage; no `--help` on subcommands; wrong flags parse as agent names. | `@cello-protocol/cli`. | product (CLI) |
| 9 | **F5-CORR/F17/F18 — status/state UX** | `state` conflates lifecycle vs `current` selection; `interrupted_sessions` inclusion rule unclear; current-agent lost on reconnect. | daemon `cello_status` + connection state. | product (daemon) |
| 10 | **F3/F4/F11/F15 — noise & dead ends** | `inclusion_proof` tool returns `not_implemented`; ambiguous `sealed_receipt` error; signaling-churn + `assignment.unverified` warnings look like failures on healthy sessions. | hide/mark tool; error messages; log levels. | product (client+dir) |
| — | **F9/F10 — orphan/interrupted accumulation** | Stale MCP connections + old interrupted sessions pile up with no visibility/cleanup. | daemon. | product (daemon) |
| — | **Systemd ordering** | ALREADY FIXED on deployed EC2 unit; only sync stale repo `demo/cello-demo.service`. | demo repo (trivial). | demo |
| — | **F8 — `claude mcp get` flaky** | Not CELLO — Claude Code MCP CLI. | harness | n/a |

**Recommended first fix:** #1 (F14) — highest user impact, known location, silent-failure smell,
and it's been forcing an EC2 restart between every live test. It's a `cello-client` change → full
SPARC + version-bump/publish cascade (per repo CLAUDE.md npm-publish rules).

## POST-COMPACTION KICKOFF (read these first)

1. **Plan/scope:** `docs/planning/discussion_logs/2026-07-01_0900_m8b-closed-e2e-testing-phase.md`
   (the test matrix + which tests need a separate device).
2. **This journal** — read **SESSION PAUSE STATE**, **CONSOLIDATED FIX BACKLOG**, **FINDINGS**,
   and **Demo agent architecture — VERIFIED** above.
3. **Friction log:** `docs/planning/discussion_logs/2026-07-02_1130_m8b-e2e-ux-friction-log.md`
   (F1–F21, the co-equal deliverable — Andre: friction logging is as important as the testing;
   keep appending, never omit a friction point).
4. **First action = verify live state (nothing may have changed, but confirm):**
   - Cluster health: 6 ECS services 1/1 + 6 DNS resolve + 3 relays (baseline was clean).
   - Local daemon: `cello_status` → daemon running, directory_signaling connected, agents Demo2
     (`8999608f…`) + Agent-1 (`c51bb002…`). Daemon was pid 83645 on **us1** (`CELLO_DIRECTORY_URL`
     default). Current-agent selection may need re-`cello_use_agent`.
   - EC2 demo agent (`i-0ad3e7c22470f266e`, `7ab98987…`): daemon+demo `active`, standing receiver
     armed — but per F14 it goes deaf after ONE inbound session, so restart before each live test:
     `stop demo → stop daemon → start daemon → wait 5s → start demo`.
5. **Then:** await Andre's decision — **fix F14 first** (recommended, in `cello-client`) OR continue
   the test matrix (#12/#13 need Andre's daemon-restart-onto-eu1; #14 is driven via the front-end portal;
   Phase C node-down + Phase E relay-failover need go-ahead + the documented restore cascade).

## Results table

| # | Scenario | Phase | Status | Result summary |
|---|----------|-------|--------|----------------|
| 8 | cello_get_inclusion_proof | A | ✅ CONFIRMED (known gap) | Returns `not_implemented` — "not yet implemented in the daemon". Matches plan doc. |
| 11 | Share refresh | A | ✅ PASS | `cello refresh Demo2` → epoch 2. Fresh Demo2↔Agent-1 session sealed post-refresh, bilateral, both `attestation_mode: live`. Signing survives share rotation. |
| 12 | Any-directory routing | A | ⏸ BLOCKED (needs reconnect) | Requires restarting local daemon with `CELLO_DIRECTORY_URL=eu1/ap1` → drops MCP conns → needs Andre's `/mcp` reconnect. Deferred until Andre available. See friction F6/F7. |
| 13 | Cross-node presence | A | ⏸ BLOCKED (needs reconnect) | Same daemon-restart dependency as #12; will run together. Plan: while bootstrapped to eu1, initiate local Demo2 → EC2 demo agent (home=us1) to prove cross-node presence resolution. |
| 14 | Suspension | B | ⬜ pending | |
| 2 | Session interrupted (EC2) | D | ✅ PASS + RE-VERIFIED on 0.0.22 | Detection was always instant (`liveness:"gone"`); the F16 observability GAP is now FIXED. Re-verified 2026-07-02 on daemon 0.0.22: killing the EC2 counterparty (16:37:38Z) → `cello_receive_session` returns `reason:"counterparty_gone", liveness:"gone"` + guidance, and `cello_status.active_sessions` lists the session `liveness:"gone"` (both silent on 0.0.20). Bonus: F14 demo re-arm verified — 2 sequential sessions A→close→B, no restart, both sealed bilaterally (`ad6c7bb0…`,`56403328…`). See F16 (resolved) + F22 (residual). |
| 6 | Unilateral seal (EC2) | D | ✅ FINDING-1 FIXED (0.0.22) / ✅ FINDING-3 FIXED + LIVE-VERIFIED (0.0.23, directory 6f66557) | **2026-07-02 ~21:35 UTC (0.0.23):** unilateral close now returns legibility inline (counterparty `attestation_mode:"absent"`) AND `cello_get_sealed_receipt` returns the durable cert (`sealed_root 3dd19ab4…`) — FINDING-3 closed end-to-end. History ↓. Re-verified 2026-07-02 on 0.0.22: `cello_close_session` on a peer-gone session (`747c922f`, past the 600s grace) now returns `ok:true, seal_type:"unilateral"` (root `80e61434…`) — the call that deadlocked in `seal_pending_bilateral` forever on 0.0.20. Local daemon log confirms `session.seal.completed` + `session.unilateral.certificate.verified`. **BUT** `cello_get_sealed_receipt` returns `sealed_receipt_not_found` (3× over ~2 min; bilateral control retrieves fine) — the unilateral path skips the bilateral `session.sealed.received` storage step, so the verified cert is never persisted to the receipt store. Operator gets success but cannot retrieve the receipt. See **FINDING-3**. |
| 9 | Node down during DKG | C | ⬜ pending | |
| 10 | Node down during seal | C | ⬜ pending | |
| 5 | Directory reconnect | C | ⬜ pending | |
| 4 | Relay failover | E | ⬜ pending | |

Deferred to Hermes device: #3 stranger flow, any true two-independent-operator bilateral run.

**Blocked on Andre's `/mcp` reconnect:** #12, #13 (need local daemon restart onto eu1/ap1). Left the
daemon untouched on us1 while Andre is away. Restore/run procedure captured under #12 detail below.

**A dedicated UX friction log is now being maintained** at
[[2026-07-02_1130_m8b-e2e-ux-friction-log]] — co-equal mission with the testing. 11 entries so far.

### #12 / #13 — planned procedure (when Andre is back for `/mcp` reconnect)

Directory selection lever is env var `CELLO_DIRECTORY_URL` (default `directory-us1`; source:
`cello-client/core/daemon/src/directory-bootstrap.ts:31`). No CLI/config lever exists (friction F6).
Daemon reads it only at startup and is a standalone manual process (friction F7).

1. Set the override so a fresh daemon bootstraps eu1 (method TBD with Andre — either MCP-config env
   + `/mcp` reconnect, or hand-launch daemon with the env). Target:
   `CELLO_DIRECTORY_URL=http://directory-eu1.cello.mygentic.ai`.
2. Kill current daemon (pid was 83645; verify current pid) so the fresh one takes the lock.
3. Andre runs `/mcp` reconnect → cello tools re-attach to the eu1 daemon.
4. Verify `directory.bootstrap.resolved directoryUrl:...directory-eu1...` in `~/.cello/daemon.log`.
5. `cello_start_agent` Demo2 + Agent-1.
6. **#12:** seal a local Demo2↔Agent-1 session — proves FROST coordinated by a non-home (eu1) node.
7. **#13:** initiate Demo2 → EC2 demo agent (`7ab98987…`, home us1) — proves eu1 resolves presence
   of a us1-registered agent (cross-node presence + any-directory relay assignment).
8. **RESTORE:** remove the override, kill daemon, `/mcp` reconnect → verify bootstrap back on us1.
   Re-`cello_start_agent` both agents. Confirm `cello status` healthy.

---

## Per-test detail

### #8 — cello_get_inclusion_proof — ✅ CONFIRMED known gap (2026-07-02 11:22)

Called `cello_get_inclusion_proof(session_id, content_hash)`. Response:
```
{"ok":false,"reason":"not_implemented",
 "guidance":"'cello_get_inclusion_proof' is not yet implemented in the daemon.
             This feature will be available in a future milestone."}
```
Matches the plan doc's known gap: cryptographic tree exists and sealed roots are valid, but the MCP
tool is not wired to the daemon. No regression, expected state. Nothing to fix here — this is a
tracked future-milestone item.

### #11 — Share refresh — ✅ PASS (2026-07-02 11:2x)

`cello refresh` is a real but **unlisted** CLI subcommand (`cello <login|logout|status|register|
create-agent|remove-agent|sessions>` omits it). Syntax: `cello refresh <agent>`.

1. `cello refresh Demo2` →
   ```
   {"ok":true,"epoch":2,
    "primary_pubkey":"fee19f7eb1d1afab8ad363222437403b5551b0f0c2f90e647e9061257e31d628",
    "verifying_shares_digest":"ece834d617841d62c72f64c2bce8180e3b78f43948aaf64c101bce57e6c1e3bb"}
   ```
   Epoch bumped to 2. `primary_pubkey` is the FROST group verifying key (distinct from Demo2's
   identity key `8999608f…`) — preserved across refresh, which is the correctness invariant
   (otherwise all prior seals become unverifiable).
2. Post-refresh proof: started Demo2, initiated session `9ce4edf0…` → Agent-1 (relay transport),
   exchanged 2 messages bidirectionally, closed.
3. Seal succeeded: `sealed_root: 062f934822f2064e…`, both participants `attestation_mode: "live"`,
   bilateral. **Threshold signing works against the rotated (epoch-2) shares.**

No bug. Note for operators: `refresh` is missing from the CLI usage string — minor UX gap worth
adding to the usage line.

### #2 — Session interrupted (EC2) — ✅ PASS (protocol) / ⚠️ observability gap (2026-07-02 ~12:0x)

**Setup friction first:** the EC2 standing receiver was found dead (accepts one inbound session
per daemon lifetime — see F14). Restored via the documented `stop demo → stop daemon → start daemon
→ wait 5s → start demo` sequence; a fresh `session.node.created` (standing receiver) confirmed armed.

**Test:** established a live bilateral session `091d2786` (Agent-1 → EC2 demo). Sent msg (seq 0),
received the demo agent's hardcoded welcome (seq 1) — confirmed live. Then `systemctl stop
cello-daemon` on EC2 at 10:04:32Z (this also cascaded `cello-demo` to inactive).

**Result — protocol layer PASS:** local daemon log shows, at `10:04:32.250Z` (same second as the
kill):
```
session.liveness.changed sessionId:091d2786… counterpartyPubkey:7ab98987…
  transportPath:"direct" liveness:"gone" observedBy:"session_node"
```
Interruption detection works and is immediate.

**Result — observability GAP:** that `liveness:"gone"` is not exposed to the operator via MCP:
- `cello_receive_session` returned `{content:null}` (a plain timeout — indistinguishable from
  "no message yet"). No `session_interrupted` / `liveness_gone` signal.
- `cello_status.interrupted_sessions` did NOT list `091d2786` (even 2+ min later). That list only
  seems to hold sessions interrupted with pending message state (the 3 stale `bc94ead6…` entries,
  messageCount 8), not idle sessions whose peer went `gone`.

So an operator whose counterparty vanishes gets **silence**, not a signal. Recorded as friction F16.

**Note — transport upgrade:** despite `initiate` reporting `transportMode:"relay"`, the session
upgraded to a **direct** libp2p connection (`session.transport.connected addr:/ip4/32.196.100.165/
tcp/4001/…`). So this exercised direct-path liveness detection. The relay-mediated interruption
path (peer reachable only via relay, relay signals the drop) was NOT exercised and remains untested
— worth a dedicated follow-up (would need to force relay-only transport).

**EC2 restored** afterward (daemon+demo active, standing receiver re-armed).

### #6 — Unilateral seal (EC2) — 🔬 IN PROGRESS (2026-07-02 ~12:1x)

The plan's method ("stop `cello-demo`") turned out to be the wrong lever; the real lever is the
counterparty **daemon**. Two sub-tests:

**Part A — stop `cello-demo` only (app), daemon stays up.** Session `b4c56ae3` (Demo2↔EC2),
one message each way, then `systemctl stop cello-demo`, then `cello_close_session`. Result: seal
**succeeded BILATERALLY** — `sealed_root 65840db8…`, BOTH participants `attestation_mode: "live"`.
**Finding:** stopping the app does NOT take the counterparty out of the seal — the EC2 **daemon**
co-signs the FROST seal autonomously (the app is only the message responder; the protocol node holds
the share and attests receipt on its own). This is defensible (the daemon did faithfully receive the
transcript) but means "stop cello-demo" cannot produce a unilateral seal. Friction F19.

**Part B — stop `cello-daemon` (full peer removal).** Restarted EC2 (fresh standing receiver),
session `47d83ad1` (Demo2↔EC2), one message each way, then `systemctl stop cello-daemon` at
10:13:13Z, then `cello_close_session`. Result:
```
ok:false, reason:"seal_counterparty_pending"
"Your SEAL leaf is recorded, but the counterparty has not closed and the directory's
 delivery-grace window has not yet elapsed, so a unilateral seal is not yet allowed."
```
So the unilateral seal path **exists and is correctly gated** by a directory-side delivery-grace
window. Default `deliveryGraceSeconds = 600` (10 min) — `directory-node.ts:616`; the directory
returns a `seal_unilateral_too_early` frame with `remaining_seconds`
(`directory-frames.ts:1126`), but the MCP guidance does NOT surface the number (friction F20).

**Part B outcome (after the 600s wait):** retried `cello_close_session(47d83ad1)` — response
changed from `seal_counterparty_pending` to:
```
ok:false, reason:"seal_pending_bilateral"
"Your SEAL leaf is recorded (auto-acknowledged) and the bilateral seal is completing, but it did
 not finalize within the wait window. ... retry cello_close_session if the session remains unsealed."
```
Retried 4× over ~12 min — **always `seal_pending_bilateral`, never finalized.** Restored the EC2
`cello-daemon` (counterparty back online) and retried — **still `seal_pending_bilateral`** (the
restored daemon is a new instance; the old session `47d83ad1` is not resumed, so it cannot co-sign).
The session is permanently unsealable via `cello_close_session`. No unilateral certificate obtained.

Local daemon log confirms: my SEAL leaf was submitted at 10:13:31Z (`session.seal.leaf.submitted
seq 3`), after the peer went `gone` (10:13:12Z). The counterparty never submitted a SEAL leaf (it
was killed before closing). Nothing finalized after.

**See FINDING-1 below** — the directory is capable of a genuine counterparty-absent unilateral seal
(`#processSealUnilateral`, `directory-node.ts:3315`), but the client's close flow never reaches it.

**EC2 restored** (daemon+demo active, standing receiver re-armed). Session `47d83ad1` left unsealed
(stuck); phantom sessions `09fa513e`, `ffcba2f7` from earlier failed-initiate attempts also linger.

---

## Demo agent architecture — VERIFIED (2026-07-02)

Confirmed the demo agent runs the real shipped stack, not a divergent build (Andre wanted his
mental model checked):
- **EC2 installed versions == npm `latest` exactly:** connect 0.0.53, client 0.0.41, daemon 0.0.20,
  cli 0.0.18, crypto 0.0.14, transport 0.0.11. Daemon `ExecStart` runs the published
  `@cello-protocol/daemon` package in `node_modules` (not vendored/dev).
- **No forked internals:** `demo/src/index.ts` imports only the MCP SDK + its own
  `message-handler.js`; it spawns the published `cello-mcp` (connect) shim over stdio MCP and drives
  the SAME tool surface Claude Code uses (`cello_start_agent`, `cello_use_agent`, `cello_status`,
  `cello_await_session`, `cello_receive`, `cello_send`, `cello_close_session`).
- **Behavior:** auto-accepts every inbound session, replies with a hardcoded 4-message sequence by
  position (content-blind, SI-002), then seals via `cello_close_session`.
- **Caveat:** launched via systemd units rather than `cello login` / Claude auto-spawn — same
  binaries, different launch mechanism.

**Implication:** demo failures = real bugs in the shipped client/daemon, affecting any operator
doing the same flow. F14 lives in published daemon 0.0.20 (and was NOT covered by the "Finding 1 +
F2-a" fixes that shipped in 0.0.20). This strengthens FINDING-1/FINDING-2 and F13/F16.

## FINDINGS (functional, beyond friction)

### FINDING-1 — Unilateral seal never completes when a counterparty daemon crashes mid-session (client stuck in `seal_pending_bilateral`)

**Severity:** high — directly exercises the "availability/redundancy is a first-class protocol
concern" invariant. A party that loses its counterparty cannot obtain its receipt.

**Repro:** session established Demo2↔EC2; `systemctl stop cello-daemon` on EC2 (counterparty crashes
WITHOUT closing); wait past the 600s delivery-grace window; `cello_close_session` on the local side.

**Expected:** after grace, a genuine unilateral seal — a certificate signed by the present party's
threshold with the counterparty recorded ABSENT (the directory's `#processSealUnilateral` /
SESSION-002 does exactly this: reconstructs client-carried seal leaves, verifies the root, FROST-
notarizes with the counterparty absent, records `gone → ABSENT`).

**Actual:** `cello_close_session` stays in `seal_pending_bilateral` indefinitely (4 retries /
~12 min); no certificate is ever produced. Restoring the counterparty daemon does not help.

**Analysis (hypotheses, unconfirmed):** the client's close flow is not transitioning from bilateral
completion to sending a `seal_unilateral` request after grace; OR it sends one and the directory
silently rejects it — `#processSealUnilateral` has many silent `return` paths (unknown session /
`lastActivity == null`, participants unknown, carried-leaf reconstruction fail, root verify fail),
none of which surface a reason to the client. Needs: client close-flow trace + directory logs
showing whether a `seal_unilateral` frame was received and which guard rejected it.

**RESOLVED — ROOT CAUSE CONFIRMED (2026-07-02 15:14, diagnosis pass):** the FIRST hypothesis, and
it is 100% client-side; the directory behaved correctly throughout. The unilateral escalation
(`daemon.ts:2429+`) is reachable ONLY on the same call that first submits the SEAL leaf. Every
retry gets `responder_seal_already_submitted` from the idempotency mark
(`session-node-manager.ts:2062`), which carries no `reportedRootHex`, so the retry dead-ends at
`daemon.ts:2421` → `seal_pending_bilateral`, never reaching `:2429`. The client never sent a
second `seal_unilateral` frame (zero "unilateral" strings in the entire local daemon log).
Full producer/consumer chain, falsification checks, fix spec, and red-first tests:
[[2026-07-02_1514_m8b-fix-briefs-cascade-1]] Brief 1.

**Note:** this is distinct from #2 (interruption *detection* works). Here *detection* works
(`liveness:gone`) but *unilateral finalization* does not.

### FINDING-2 — Demo agent onboarding is broken after the first user (standing receiver not re-armed)

**Severity:** highest user-facing impact of this session. The demo agent is the **production
onboarding surface** — every new signup connects to it to confirm their stack works (`demo/
CLAUDE.md`). Because the daemon's standing receiver is not re-armed after it's consumed by one
session (see friction F14, confirmed against `session-node-manager.ts:903`), the demo agent serves
exactly **one** new user per daemon lifetime, then returns `standing_receiver_unavailable` to
everyone after — a silently-broken first experience with no visible cause. Both systemd services
report `active` throughout.

**ROOT CAUSE CONFIRMED (2026-07-02 15:14, diagnosis pass):** NOT a silently-failing async
replacement — the replacement fired and logged `session.node.create.failed — EADDRINUSE
0.0.0.0:4001` (EC2 journald 09:02:47.911). Three compounding gaps: (1) fixed-port collision —
the consumed receiver keeps `CELLO_LISTEN_ADDR` port 4001 as the session node, so the immediate
re-arm can never bind; (2) `#ensureStandingReceiver` does not retry after a create failure;
(3) the inbound path (`waitForStandingReceiver`, `daemon.ts:3220`) only polls readiness — it
never invokes ensure, and `destroySessionNode` doesn't re-arm when the port frees. Local dev
never repros because non-fixed-port receivers bind ephemeral loopback (`daemon.ts:262-266`).
Full chain + fix spec: [[2026-07-02_1514_m8b-fix-briefs-cascade-1]] Brief 2.

**Where the fixes land (evidence-based):**
- **Standing-receiver re-arm (critical):** `cello-client` `core/daemon/src/session-node-manager.ts`
  — the async replacement (~:903 / `#createStandingReceiver` :2916+) failed silently on EC2. Fix +
  make replacement failure LOUD. This is a **daemon/product** fix that benefits every operator.
- **Systemd ordering:** ALREADY FIXED on the deployed EC2 unit — it has `After=cello-daemon.service`
  + `Requires=cello-daemon.service` (the repo's `demo/cello-demo.service` is stale and should be
  updated to match). No action needed on the instance.
- **False-success on connect (F13):** a new user connecting while the receiver is deaf gets
  `initiate_session` → `ok` + a session id, then silence — the worst onboarding signal. Client fix.
- **Counterparty-gone invisible (F16):** if the demo drops mid-verification the user sees a hang,
  not a signal. Client fix.

**Framing correction (Andre):** the demo agent is a live product surface, not just a test rig — so
these are production onboarding defects. The demo is the canary; the fixes belong in the
client/daemon/directory and help all operators.

**✅ SHIPPED + VERIFIED (daemon 0.0.22, 2026-07-02):** re-arm fix live-verified on the demo this
session (two sequential sessions, no restart — see friction F14 + results row #2). Residual: F22
(fixed-port 4001 caps concurrent sessions).

### FINDING-3 — Unilateral seal completes but its certificate is not retrievable (`cello_get_sealed_receipt` → `not_found`)

> **✅ RESOLVED & LIVE-VERIFIED 2026-07-02 ~21:35 UTC.** Fixed across both repos and shipped:
> directory `6f66557` (legibility in the `seal_unilateral_confirmed` frame) live in all 3 regions;
> daemon `0.0.23` (persist via `recordSealCertificate` + return legibility inline on
> `cello_close_session`) on npm `latest`. Live acceptance from the local daemon 0.0.23: fresh session
> `e3c167bd` (local `8999608f…` → demo agent `7ab98987…`), counterparty taken offline, close after
> grace → `seal_type:"unilateral"` **with legibility inline** (counterparty `attestation_mode:"absent"`,
> local `"live"`); **`cello_get_sealed_receipt` returned the durable cert** (`sealed_root 3dd19ab4…`) —
> no longer `sealed_receipt_not_found`. Both halves of the original gap (no inline cert, no retrievable
> cert) are closed. Reviewer Critical-1 (durable Pg payload) fixed; Critical-2 → [[#FINDING-6]] (absent-party
> B-side persistence, tracked). See [[2026-07-02_1807_m8b-cascade-2-finding3-implementation-and-deploy-plan|cascade-2 implementation + deploy record]].

**Severity:** high — negates the *purpose* of the FINDING-1 fix. The point of a unilateral seal is
that a party who loses its counterparty can still obtain a **durable, retrievable receipt** it can
rely on. Here the close succeeds but the receipt cannot be fetched afterward.

**Repro (2026-07-02, daemon 0.0.22):** session `747c922f` peer-gone since 16:37:38Z; after the 600s
grace, `cello_close_session` → `{ok:true, sealed_root:"80e61434…", seal_type:"unilateral"}`.
`cello_get_sealed_receipt(747c922f)` → `{ok:false, reason:"sealed_receipt_not_found"}` on **3
attempts over ~2 min**. Bilateral control (session `48a48833`, same run) retrieves its full
certificate fine — so this is unilateral-specific, not a general retrieval bug or propagation lag.

**Evidence (local daemon log — producer/consumer):**
- Bilateral close emits `session.sealed.received` → `session.sealed.signature.checked` →
  `seal.certificate.frontier.verified` — the receive-and-store path that populates the sealed-receipt
  store the retrieval tool reads.
- Unilateral close emits `session.unilateral.certificate.verified` **instead**, and **none** of the
  `session.sealed.received` storage events. The cert is verified in-flight but never persisted.
- Consumer `cello_get_sealed_receipt` reads that store → finds nothing → `not_found`.

**Also:** the unilateral `cello_close_session` response is thin — `{sealed_root, seal_type}` only, with
no `participants`/`legibility`/`attestation_mode` block (bilateral returns the full inline cert). So
the operator gets **neither** an inline certificate **nor** a retrievable one.

**Test framing (confirmed intent):** T2 is a *genuine* unilateral-seal test — the counterparty
daemon was deliberately killed (full peer removal) and never returned past the grace window.
Unilateral is the CORRECT intended outcome here; a bilateral seal in this scenario would itself be a
bug (the group co-signing for a provably-absent party — the F19 concern). So FINDING-3 is a gap in
*intended unilateral behavior*, not a symptom of a missed bilateral seal.

**ROOT CAUSE CONFIRMED (code, 2026-07-02, `cello-client` `core/daemon/src/daemon.ts`):**
- Bilateral persists the receipt: `daemon.ts:1886` `recordSealCertificate(agentName, sidHex, rootHex, JSON.stringify(legibility))`,
  read back by `cello_get_sealed_receipt` via `getSealCertificate` (`daemon.ts:2607`).
- The unilateral confirmation handler (`daemon.ts:1943–1974`) verifies the cert
  (`session.unilateral.certificate.verified`), destroys the session node, and resolves the waiter
  with the root only — it **never calls `recordSealCertificate`** (grep: that call exists at exactly
  ONE line in the file). So the unilateral cert is **not persisted at all** → `sealed_receipt_not_found`.
- Deeper: the `seal_unilateral_confirmed` frame carries only
  `sealed_root/frost_signature/leaf_count/close_timestamp/signature_type` — **no legibility object**.
  There is no participant/ABSENT cert client-side to persist even if the call were added.

**Fix target = intended behavior (not just the symptom):** a unilateral close must yield the same
durable, legible receipt a bilateral close does, with the counterparty recorded **ABSENT**. That
needs (1) a legibility cert on the unilateral path — most likely the directory including it in the
`seal_unilateral_confirmed` frame (it already computes `gone → ABSENT` in `#processSealUnilateral`),
and (2) the client persisting it via `recordSealCertificate` + returning it inline in the
`cello_close_session` response. Client + directory change → cascade-2. Distinct from the reviewer's
in-memory-escalation residual (that's surviving a daemon restart between retries; this is
persisting/exposing the receipt at all).

**Does NOT undo FINDING-1:** the seal now COMPLETES (it never did on 0.0.20). But the receipt is not
yet a retrievable artifact, so the feature is functionally incomplete for its intended purpose.
Paired friction: F23.

**RESOLVED (cascade-2, 2026-07-02) — for the PRESENT party.** Two coordinated changes, TDD + full
gates + live spine (real binaries + Postgres) all green:
- **Directory** (`trustless-cello/packages/directory`): `#processSealUnilateral` derives the
  receipt-not-assent legibility via `buildSealLegibility` (present party `live`, counterparty `absent`)
  and — because a received-only counterparty authors no leaf — appends a synthetic zero-frontier
  `absent` participant so the counterparty is ALWAYS named. Threaded through both the single-key and
  FROST completion paths; attached to the cert on `seal_unilateral_confirmed` AND
  `seal_unilateral_notification`, and (reviewer Critical 1) carried on the **durable** Pg
  notification-queue payload too (`legibility_cbor_hex`, byte-lossless). New event
  `session.unilateral.legibility.built`.
- **Client daemon** (`cello-client/core/daemon`): the unilateral confirmation handler now
  `normalizeLegibility`s the frame's legibility and `recordSealCertificate`s it (before node destroy),
  and `cello_close_session` returns it inline — so `cello_get_sealed_receipt` returns a durable receipt
  with the counterparty ABSENT.
- **Live proof (spine):** `A seals while B is GONE` — close returns `legibility` inline with B recorded
  `absent`, and `cello_get_sealed_receipt(A)` returns the persisted cert (was `sealed_receipt_not_found`).
- **Provenance (ship condition, met):** the unilateral legibility is DIRECTORY-attested, not co-signed
  by the counterparty nor client-re-derived — explicitly marked via per-participant `attestation_mode`
  (`absent` = directory-attested), never presented as client-verified. Not cryptographic bilateral
  parity. SI-002 hardening tracked as [[#FINDING-5 — Unilateral seal legibility is directory-attested, not client-re-derived (SI-002 asymmetry)|FINDING-5]].
- **Absent party's own retrieval** (B's `cello_get_sealed_receipt` on reconnect) is NOT yet wired
  client-side — tracked as FINDING-6. The directory already ships the cert to B; only the client
  persistence remains (client-only, no further directory deploy).

### FINDING-4 — No entry-point directory failover: the signaling dialer ignores the resolved consortium roster (bootstrap SPOF)

> **✅ RESOLVED & LIVE-VERIFIED 2026-07-03 — daemon `0.0.25` / cli `0.0.23` on `latest`.**
> **The original analysis below was WRONG on one key point.** It claimed "the client already holds the
> other nodes' addresses; the dialer refuses to dial them." The live kill-us1 test (2026-07-03) proved
> the opposite: the resolver logic was correct (`staleFallback:false` → us1 resolves to `null`), but
> **the consortium roster was EMPTY** — the daemon never loaded a manifest (only a fake 1-node staging
> placeholder existed in-repo; dev directories served `/manifest`→503). The failover pump was wired to
> an empty well. **Proper fix (no band-aid):** a real signed consortium manifest of the 3 sovereign
> directories is now COMPILED INTO the client and loaded BY DEFAULT, WITH step-6 directory identity auth
> (defeats a `/bootstrap` MITM redirecting failover to a rogue node), gated on `CELLO_DIRECTORY_URL`
> being a bundled node so local dev / the spine harness stay on the M6 path. Directories deployed with
> `CELLO_DIRECTORY_NODE_KEY_HEX` so they sign the step-6 challenge (officer key
> `cello/dev/consortium/officer-key-0`; pubkey `8e9b99…64199` pinned in the client; regenerate via
> `infra/scripts/sign-consortium-manifest.mjs`). **Verified live:** killed us1 → failover to eu1
> `verified:true`; killed eu1 → failover to ap1 `verified:true`; survives 2 of 3 directories down; the
> bundled default proven on a fresh `npm i -g @latest` (no env). 521 daemon tests + the j-spine DoD
> enforcer pass. **Remaining gap:** [[#FINDING-7 — Session ceremonies are home-node-bound (`ceremony_exhausted` on a fallback directory)|FINDING-7]].

**Severity:** high — a direct violation of the sovereign-node **redundancy** invariant ("if a node
is unreachable, the client falls back to others"). The configured/default directory node (us1) is a
single point of failure for client startup: if it is unreachable, the client cannot come online at
all — even though it already holds the addresses of the other nodes.

**Evidence chain (`cello-client`, confirmed by code read 2026-07-02):**
- Single entry coordinate: `resolveDirectoryUrl()` returns `CELLO_DIRECTORY_URL` or the hardcoded
  `PRODUCTION_DIRECTORY_URL = "http://directory-us1.cello.mygentic.ai"`
  (`core/daemon/src/directory-bootstrap.ts`). No list of alternates.
- The client DOES know the other nodes: the consortium manifest is a **bundled JSON file**
  (`core/transport/src/manifest-interfaces.ts:43`), and at startup `manifestNodesToEndpoints` probes
  each node's `/bootstrap` and resolves the reachable ones into `consortiumEndpoints`
  (`daemon.ts:403`) — so eu1/ap1 resolve even when us1 is down.
- BUT the signaling dialer `createSignalingConnect` (`core/daemon/src/signaling-connect.ts`) consults
  ONLY `getDirectoryEndpoint()` (the single us1 resolver). Its deps type has **no** roster/consortium
  field at all. On failure it throws → `SignalingManager` reconnects → resolves the SAME single us1
  URL → retries forever.
- `signaling-manager.ts` has ZERO references to the roster (`getConsortiumEndpoints`); the roster is
  consumed only by the ceremony/registration fan-out, which needs an already-established signaling
  connection — useless precisely when us1 (the signaling entry) is the down node.

**Net:** the client comes up, verifies the bundled manifest, resolves eu1/ap1 as alive — and still
can't get online, because the signaling connection only ever dials us1. No signaling → no
`agent.online` → nothing works. The failover *data* and ~90% of the machinery exist; the last wire
(dial a reachable roster member when the primary is down) was never connected. So it is NOT "the
client can't find the others" — it is "the client holds the others and refuses to dial them."

**Fix (to reach intended behavior):** the signaling endpoint resolver / `connect()` should draw from
the resolved `consortiumEndpoints` roster — try the configured node first, rotate to any reachable
roster member on connect/reconnect failure. Roster is already computed and the manifest is bundled →
wiring change in `signaling-connect.ts` + the endpoint resolver, no new protocol. **Caveat:** the
fix's *sufficiency* depends on any-directory routing (presence / relay-assignment / ceremony against
a non-home node) working end-to-end — untested (#12/#13). Verifying the fix (kill us1 → client fails
over to eu1 → completes a real session/seal) simultaneously runs #12/#13/#5.

**Status:** to be fixed in `cello-client` after FINDING-3 lands (both are daemon-package changes →
batch into one publish). Reshapes #8: down a **non-us1** node for the threshold test until this ships.

### FINDING-5 — Unilateral seal legibility is directory-attested, not client-re-derived (SI-002 asymmetry)

**Severity:** medium (security hardening) — a scoped deviation from the stated invariant "the client
does NOT trust the directory for the frontier VALUE, only for transporting signed bytes it
re-checks." Bounded surface: affects only the legibility **frontier metadata**, not the sealed
content (the `sealed_root` is FROST-signed and client-verified per SI-003).

**Context:** surfaced by the FINDING-3 implementer. In the bilateral seal the client re-derives each
party's `content_frontier_seq` from the signed leaves it carried and REJECTS an inflated directory
frontier (`daemon.ts` DOD-LEG-2 / `reDeriveFrontiers` / `findInflatedFrontier`). In the unilateral
seal the counterparty can't co-sign, so the legibility cert is FROST-notarized by the **directory
consortium only**, and the client does not re-derive it → the directory is trusted for the frontier
values on the receipt-of-last-resort.

**Threat model:** a compromised/buggy directory consortium inflates the ABSENT party's
received-frontier — forging evidence that the absent party received content it didn't, on exactly the
receipt a wronged party relies on and which the absent party isn't present to contest. (The present
party's OWN frontier is self-evident to it; the exposed value is the absent party's.)

**Why separable (the real asymmetry):** bilateral re-derivation works because both parties' signed
leaves are present. Unilaterally, the present party can re-derive its OWN frontier from carried
leaves, but the ABSENT party's received-frontier evidence may live with the absent party (its acks)
who never provided it — so part of it may be **inherently** directory-attested, not a simple reuse of
the bilateral guard.

**Ship condition (FINDING-3, agreed 2026-07-02):** ships scoped IFF the cert makes provenance
explicit — the ABSENT party's values are unmistakably marked directory-attested
(`attestation_mode: ABSENT`), never presented as client-verified. No silent seam.

**Hardening (this finding):** re-derive every frontier the present party CAN from leaves it holds (at
least its own) and reject/override inflation; directory-attest only the genuinely un-derivable
remainder, explicitly marked. Fold in the running code-reviewer's verdict on this exact point — if it
judges the frontier-trust exploitable enough to block, this escalates from follow-up to
must-fix-now.

**Status:** tracked security follow-up to FINDING-3 (which ships the retrievable receipt now).
`cello-client` daemon + directory. **Reviewer verdict (2026-07-02, code-reviewer on the cascade-2
diff):** "defensible to ship this fix first (a durable receipt existing at all is strictly better
than the prior total absence), but it should not be presented as bilateral parity — it is not
cryptographically equivalent." → does NOT escalate to must-fix-now; stays a follow-up. FINDING-3
ships with provenance made explicit (per-participant `attestation_mode`; the absent party is `absent`,
never presented as client-verified), satisfying the agreed ship condition.

### FINDING-6 — Absent party's unilateral receipt is not persisted client-side on reconnect (`cello_get_sealed_receipt` → `not_found` for B)

**Severity:** medium — surfaced by the cascade-2 code-reviewer (Critical 2). FINDING-3 gives the
**present** party (the one who closed) a durable, retrievable receipt. The **absent** party (B) learns
of the seal via `seal_unilateral_notification` on reconnect — the directory now ships the legibility
on that frame over **both** delivery paths (in-memory `#pendingNotifications` **and**, per the
reviewer's Critical 1, the durable Pg `#notificationQueue` via `legibility_cbor_hex` — fixed in
cascade-2). BUT the client-side handler for `seal_unilateral_notification` is
`registerUnilateralUpgradeListener` → `attemptSealUpgrade` (the DOD-UP-1 bilateral-upgrade path); it
never calls `recordSealCertificate`. So B's `cello_get_sealed_receipt` still returns
`sealed_receipt_not_found` even though the notification now carries the cert.

**Why separable (not folded into FINDING-3):** B's receipt semantics are entangled with the upgrade
flow, and getting them right needs its own design — (1) B **cannot** channel-independently verify the
unilateral cert's FROST signature (it lacks the initiator's group key; `attemptSealUpgrade` notes this
and accepts R1 on the authenticated Noise channel), so B's receipt has a **different trust basis** than
A's; (2) B should arguably persist a receipt only **after** it recovers + integrity-verifies the
content behind R1 (the KERNEL gate) — persisting before that risks a receipt for content B couldn't
verify (a new "looks-done-but-isn't"); (3) on a **successful** upgrade the seal becomes bilateral and
B should get the **bilateral** receipt (but `seal_upgrade_confirmed` carries no legibility today
either). A naive `recordSealCertificate` in the notification handler would also silently no-op if B has
no local `sessions` row (the stub-session lifecycle for a reconnecting absent party).

**Fix sketch:** in the notification handler, after the KERNEL content-recovery/verify gate passes,
`normalizeLegibility(frame["legibility"])` + `recordSealCertificate` against B's (possibly stub)
session row; on a successful upgrade, prefer persisting the bilateral cert; add `legibility` to
`seal_upgrade_confirmed`. Needs a red spine test: B reconnects post-restart → drains the durable
notification → `cello_get_sealed_receipt(B)` returns the cert with A recorded present and B's own
recovered frontier.

**Status:** tracked follow-up to FINDING-3. `cello-client` daemon (+ possibly `seal_upgrade_confirmed`
on the directory). The directory half (legibility on the notification, both paths) already shipped in
cascade-2, so no further directory deploy is required to land FINDING-6 — it is a client-only change.

### FINDING-7 — Session ceremonies are home-node-bound (`ceremony_exhausted` on a fallback directory)

**Severity:** high — the second half of the sovereign-node **redundancy** invariant. FINDING-4 restores
the ability to COME ONLINE against a fallback directory (verified `verified:true`), but the ability to
**transact** (open a session, seal) against that fallback is NOT restored.

**Surfaced by the FINDING-4 live failover test (2026-07-03).** With the daemon failed over to ap1
(us1+eu1 killed, ap1 `verified:true`), a `cello_initiate_session` between two local agents reproducibly
returned `ceremony_exhausted` (2 attempts, ~stable signaling). The session offer/accept succeeded
(`session.offer.accepted`), but `session.ceremony.participated … ok:false` — the FROST session ceremony
failed against the non-home directory.

**Root-cause hypothesis (unconfirmed from directory logs; consistent with the architecture):** the
directory co-signs the session seal with a per-agent server-side share (`K_server`) created at
registration and held by the agent's HOME directory (us1 for these agents). Shares are NOT replicated
across the sovereign nodes, so a fallback directory (ap1) cannot complete the threshold ceremony →
`ceremony_exhausted`. Per infra/STATE.md this is blocked on the **unbuilt T-of-N protocol** (the daemon
is the 2-of-2 stopgap; strict T-of-N across the consortium is not implemented).

**Why separable from FINDING-4:** FINDING-4 is the bootstrap/roster SPOF (you couldn't even come online
if your primary was down — total failure). That is fixed and is a strict, necessary improvement.
FINDING-7 is the deeper "any-directory ceremony" layer (#12/#13) that the FINDING-4 brief explicitly
flagged as *"untested — the fix's sufficiency depends on any-directory routing working end-to-end."* It
is a milestone-scale protocol effort (share replication or true T-of-N), not a client wiring change.

**Status:** OPEN. Tracked gap; not fixed. Blocks the "transact on a fallback directory" case (#12
any-directory routing, #13 cross-node presence-to-seal). FINDING-4 shipped without it because coming
online + directory auth is a genuine, verified improvement on its own.

---

## FINDING-4/5/6 — SHIPPED + DIRECTORY-DEPLOYED (2026-07-02 ~20:55 UTC)

Cascade-2 is live. All three fixes were code-complete + reviewed (2 rounds each) + gated
(cello-client 1457 tests, lint, typecheck, build green); then:

- **cello-client → beta AND latest.** daemon `0.0.24`, cli `0.0.22` (connect unchanged `0.0.53`);
  tag `v0.0.65`, CI smoke-tag green. Binary-verified against the npm tarball: all four symbols present
  in daemon `dist/` (`createRosterAwareEndpointResolver`, `checkUnilateralFrontier`,
  `recordSealCertificateEnsuringRow`, `upgradeAbsentToRecovered`); `cli@0.0.22` → `daemon 0.0.24`
  (real pin, not `workspace:*`). Andre promoted `cli`+`daemon` to `latest` and reinstalled/reconnected
  his local stack during the session.
- **Directory deployed (FINDING-5 only — client-only for F4/F6).** `cello-directory:7c66ba2` in all 3
  regions via `cello-directory-pipeline` (exec `096d5486`, Succeeded); sequential ProductionDeploy, all
  rolled COMPLETED + steady, 0 crash loops. Verified genuine per-region health (not merely "in progress").
- **Mandatory relay cascade done.** All 3 relays force-new-deployed → re-registered with their new
  directory tasks → manifests re-signed with the new relay IPs: us-east-1 `10.0.71.218` (v49),
  eu-central-1 `10.1.66.92` (v21), ap-northeast-1 `10.2.96.205` (v12); each directory refreshed the
  manifest + is health-checking the new IP (1-6ms). 6/6 ECS 1/1, 6/6 DNS resolve. Details in `infra/STATE.md`.

**Remaining (Andre's — live, disruptive):** FINDING-4 kill-us1 failover (also exercises #12/#13/#5;
restore per `infra/CLAUDE.md`) and FINDING-6 B-reconnect → `cello_get_sealed_receipt(B)`.

---

## Related Documents

- [[2026-07-01_0900_m8b-closed-e2e-testing-phase|M8B closed — E2E testing phase kickoff]] — the plan doc this journal executes; test matrix, phases, and restore-cascade discipline.
- [[2026-07-02_1130_m8b-e2e-ux-friction-log|M8B E2E UX friction log]] — co-equal deliverable; F1–F21 referenced throughout this journal live there in full.
- [[2026-07-02_1514_m8b-fix-briefs-cascade-1|M8B fix briefs — cascade 1]] — root-cause diagnoses + implementation-ready fix specs for FINDING-1, F14, F13, F16 and riders (the fix backlog's top rows, resolved to exact code).
- [[2026-07-01_2215_final-message-receive-race-and-initiator-verified-false|Final-message receive race + verified:false]] — prior session's findings; its fixes shipped as daemon 0.0.20 and its acceptance test is session `a6a2f9af` — the same session whose receiver-consumption exposed F14 here.
- [[2026-07-02_1640_m8b-cascade-1-implementation-and-publish|M8B cascade 1 — implementation, publish, live verification]] — the fix backlog's top rows (FINDING-1, F14, F13, F16 + riders) shipped as daemon 0.0.21 / cli 0.0.19 and re-verified live against the demo agent.
