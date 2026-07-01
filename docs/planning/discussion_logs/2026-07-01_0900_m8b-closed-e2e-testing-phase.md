---
name: M8B closed — E2E testing phase kickoff
type: discussion
date: 2026-07-01
topics: [m8b, e2e-testing, m7-retrospective, happy-path, unhappy-path, live-cluster]
status: active
description: >
  Follow-through doc for the post-compaction session. M8B federation milestone is closed (all DoD
  lines ✅). Next phase: thorough end-to-end testing of the live dev cluster covering happy paths,
  unhappy paths, and M7 flows that were never properly validated due to the bugs that drove M8B.
---

# M8B Closed — E2E Testing Phase

## What is done

**M8B federation milestone: FULLY CLOSED.** Every DoD line ✅.

All 8 spine journeys green (j-tofn-dkg, j-sign, j-suspend-tofn, j-relaysig, j-optionb-setup,
j-unilateral, j-presence, j-refresh). DOD-DEPLOY-1 live proof completed 2026-06-30.

**Live proof session:** `0593e9e13077eda80fcaed8e81467e47`
- Local agent Demo2 (`8999608f...`) ↔ EC2 demo agent (`7ab98987...`)
- 4 message rounds, bilateral FROST seal, sealed_root `82028305b2649f6d...`
- Both parties `attestation_mode: "live"`

**Published to latest:**
- crypto 0.0.14, protocol-types 0.0.11, transport 0.0.11
- client 0.0.41, daemon 0.0.19, cli 0.0.17, connect 0.0.53

**Infrastructure:**
- Directory deployed all 3 regions: us-east-1, eu-central-1, ap-northeast-1
- Relay deployed with `CELLO_DIRECTORY_PUBKEYS` (any-directory enabled)
- Demo agent on `i-0ad3e7c22470f266e`, pubkey `7ab98987de127b81dc4013d8c0b7e70b65f95db647e0977d492f41566ec1f910`
- Demo agent uses T-of-N DKG (NOT trusted dealer). Registered via `cello register`.

**CELLO client installed locally:**
- Agent "Demo2", pubkey `8999608f8493e7b65556818ca8571bc6c538b604b716549d41ead9d2b2c1dffd`
- Daemon running, directory connected, cello MCP wired

---

## What is next: E2E testing phase

### Why this phase matters

**M7 was never thoroughly validated end-to-end.** The bugs discovered during M7 live testing were
severe enough that they drove the M8B rewrite (daemon architecture, per-agent signaling, standing
receiver, session node manager, relay receipt store). M7 shipped code that looked right in unit
tests but broke in real multi-process conditions. M8B fixed those bugs, but we have not
systematically walked through M7's user-facing flows to confirm they all work.

**M8B added new complexity.** T-of-N FROST, Option B (client-carried receipts), cross-node
replication, share refresh — none of these have been stress-tested via deliberate unhappy-path
scenarios against the live cluster.

### Testing surface

#### M7 flows to validate (these were the original broken paths)

1. **Basic session + messaging** — initiator sends, receiver gets, both sides see transcript ✓ (partially proven by live proof)
2. **Session interrupted / daemon restart** — initiate session, kill daemon, restart, resume (interrupted_sessions appears in status, cello_receive_session works)
3. **Inbound session (stranger flow)** — someone connects to a running agent without prior arrangement; cello_await_session picks it up
4. **Relay failover** — what happens when the relay the assignment points to is unreachable
5. **Directory reconnect** — kill directory connection mid-session (directory restarts, daemon reconnects, session continues)
6. **Unilateral seal** — one party disappears after closing; other party seals unilaterally; absent party can verify on reconnect
7. **cello_get_transcript** — retrieve full transcript after seal; verify hash chain
8. **cello_get_inclusion_proof** — inclusion proof for a specific message

#### M8B unhappy paths to validate

9. **Node down during DKG** — register a NEW agent while one directory node is unreachable; DKG should complete via surviving T-of-N
10. **Node down during seal** — seal a session while one directory node is unreachable; should still seal
11. **Share refresh** — `cello refresh` on a live agent; post-refresh seal still works; old epoch shares unusable
12. **Any-directory** — initiate session connecting to eu-central-1 or ap-northeast-1 directory (not us-east-1); relay accepts the assignment
13. **Cross-node presence** — agent registered on us-east-1; lookup from eu-central-1 sees them online
14. **Suspension** — suspend an agent via ops bot; FROST ceremony is refused; unsuspend; ceremony proceeds

#### Known parked issues to check

- `standing_receiver_ready: false` in `cello status` (status display bug — daemon.ts:490 hardcodes `state: "registered"`) — may confuse operators even though the SR is actually running
- j-auth poll tests (DOD-AUTH-2 poll refresh / poll rejects forged) were pre-existing failures; check if they're still broken or if M8B inadvertently fixed them

---

## Key file paths

| What | Path |
|------|------|
| M8B DoD (all ✅) | `docs/planning/user-stories/m8b/M8B-DEFINITION-OF-DONE.md` |
| M8B build journal | `docs/planning/user-stories/m8b/M8B-BUILD-JOURNAL.md` |
| M8B spec | `docs/planning/user-stories/m8b/M8B-SPEC.md` |
| Demo agent runbook | `demo/CLAUDE.md` |
| Infra state | `infra/STATE.md` |
| This doc | `docs/planning/discussion_logs/2026-07-01_0900_m8b-closed-e2e-testing-phase.md` |

---

## Standing issues to track

- `cello status` agent state bug: `state` always shows `"registered"` (daemon.ts:490); fix is cosmetic but operator-confusing. Low priority.
- Better error message for empty peer ID at `core/transport/src/node.ts:265` — should say "session_offer_accept may not have arrived" not just "Invalid peer ID". Low priority.
- j-auth poll test failures pre-date M8B; check if they're now fixed or still broken.
- Demo agent service ordering: if cello-daemon and cello-demo restart simultaneously, demo can connect to stale socket. Systemd `After=cello-daemon.service` + `Requires=` should be set to enforce ordering. Currently depends on manual sequencing.
