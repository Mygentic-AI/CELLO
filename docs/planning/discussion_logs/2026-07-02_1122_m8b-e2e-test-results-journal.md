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
| 2 | Session interrupted (EC2) | D | ✅ PASS (protocol) / ⚠️ GAP (observability) | Daemon DID detect peer drop instantly: `session.liveness.changed liveness:"gone"` at 10:04:32.250Z (same second as kill). BUT not surfaced to operator — `cello_receive` timed out `content:null`, `cello_status` did not list it interrupted. Transport had upgraded relay→direct, so this tested direct-path detection. See F16. |
| 6 | Unilateral seal (EC2) | D | 🔬 IN PROGRESS (grace wait) | **Part A** (stop `cello-demo` only): seal completed **BILATERAL**, both `live` — daemon co-signs autonomously; app-down ≠ unilateral (finding). **Part B** (stop `cello-daemon`): `cello_close_session` → `seal_counterparty_pending` — unilateral seal is gated by a **600s delivery-grace window**; SEAL leaf recorded; awaiting grace to retry. See F19/F20. |
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

**Next:** keep EC2 daemon DOWN, wait out the ~600s grace window, retry `cello_close_session
(47d83ad1)` → expect a UNILATERAL seal (counterparty marked absent/unilateral, not `live`), then
restore EC2.
