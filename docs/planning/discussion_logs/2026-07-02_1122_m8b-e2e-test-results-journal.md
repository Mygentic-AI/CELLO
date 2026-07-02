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

## Results table

| # | Scenario | Phase | Status | Result summary |
|---|----------|-------|--------|----------------|
| 8 | cello_get_inclusion_proof | A | ✅ CONFIRMED (known gap) | Returns `not_implemented` — "not yet implemented in the daemon". Matches plan doc. |
| 11 | Share refresh | A | ✅ PASS | `cello refresh Demo2` → epoch 2. Fresh Demo2↔Agent-1 session sealed post-refresh, bilateral, both `attestation_mode: live`. Signing survives share rotation. |
| 12 | Any-directory routing | A | ⏸ BLOCKED (needs reconnect) | Requires restarting local daemon with `CELLO_DIRECTORY_URL=eu1/ap1` → drops MCP conns → needs Andre's `/mcp` reconnect. Deferred until Andre available. See friction F6/F7. |
| 13 | Cross-node presence | A | ⏸ BLOCKED (needs reconnect) | Same daemon-restart dependency as #12; will run together. Plan: while bootstrapped to eu1, initiate local Demo2 → EC2 demo agent (home=us1) to prove cross-node presence resolution. |
| 14 | Suspension | B | ⬜ pending | |
| 2 | Session interrupted (EC2) | D | 🔬 IN PROGRESS | Live session `091d2786` (Agent-1↔EC2) established after re-arming EC2 standing receiver (see F14). Killed EC2 `cello-daemon` at 10:04:32Z. Local side did NOT detect interruption within 20s (receive timed out `content:null`; session absent from `interrupted_sessions`). Watching for delayed relay detection. |
| 6 | Unilateral seal (EC2) | D | ⬜ pending | |
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
