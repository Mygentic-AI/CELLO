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

#### Scenario 0: Multi-agent local communication (M7 daemon use case)

**STATUS: ✅ PASS (2026-07-01)**

Two agents (Demo2 + Agent-1) on the same daemon, communicating via `cello_use_agent` switching.
Tested twice: once as a structured 4-message exchange (session `a001ca74`), once as an autonomous
agent-to-agent conversation on a topic (session `7f50d4a1`). Full 7-layer audit performed on the
first session. Conversation proof committed.

Evidence:
- Bidirectional messaging (both directions, multiple rounds)
- Bilateral FROST seal (both sessions)
- Transcript retrieval (both agents independently, matching)
- Sealed receipt (identical on both sides)
- Relay witness (all hashes submitted, delivered to both, ACKed)
- Hash chain (monotonic growth, both agents agree at each step)
- Directory DB (session record + conversation_seals + proof_leaves)
- Ephemeral nodes torn down after seal

---

#### Testable locally (same daemon, no second device needed)

| # | Scenario | Status | Notes |
|---|----------|--------|-------|
| 1 | **Basic session + messaging** | ✅ PASS | Proven by Scenario 0 |
| 7 | **cello_get_transcript** | ✅ PASS | Both agents retrieved matching transcripts |
| 8 | **cello_get_inclusion_proof** | ❌ NOT IMPLEMENTED | Tool returns `not_implemented` — cryptographic machinery exists but MCP tool not wired |
| 9 | **Node down during DKG** | ✅ ADDRESSED + SPINE-VERIFIED (M8B Problem 2, 2026-07-04) | Was the **all-N registration gap**: a node down → registration REFUSED (never completed). Now registers among the available quorum Q (Q ≥ t). Spine GREEN (`j-tofn-dkg`, real 3 nodes): kill 1 of 3 → registers among the 2-node quorum. Deployed all 3 regions (`bb02899`), client beta `v0.0.69`. Live-AWS demo pending (dev N=3 needs t=2 / cluster N>3 — optional). See results journal + [[2026-07-04_0556_tofn-registration-availability-quorum-enrollment-plan]]. |
| 10 | **Node down during seal** | ⚠️ CODE-ADDRESSED, not live-verified | Seal now targets the recorded quorum Q (persist-Q); survive-node-down is DOD-SIGN-1 (`j-sign`) + exclude-and-retry. A live seal by a quorum-registered agent WITH a directory down still to run. |
| 11 | **Share refresh** | ⬜ not tested | `cello refresh` against live cluster, then seal post-refresh |
| 12 | **Any-directory (non-us-east-1)** | ✅ VERIFIED (FINDING-4 failover, 2026-07-03) | Directory selection is now AUTOMATIC (roster-aware failover), not a manual reconnect. Killed us1 → client ran on eu1 `verified:true`; killed eu1 → ap1 `verified:true`. See STATE.md 2026-07-03 + results journal. |
| 13 | **Cross-node presence** | ✅ COVERED (FINDING-4 failover, 2026-07-03) | Client ran signaling/relay/ceremony against non-home eu1/ap1 during failover; dedicated non-home presence probe not separately logged. |
| 14 | **Suspension** | ⬜ not tested | Suspend via the front-end portal, verify FROST refused, unsuspend, verify FROST proceeds |

#### Better with a separate daemon (EC2 demo agent)

| # | Scenario | Status | Why separate device is better |
|---|----------|--------|-------------------------------|
| 2 | **Session interrupted** | ⬜ not tested | Same daemon = both agents die together. With EC2: stop cello-daemon on EC2, local side receives `session_interrupted` from relay independently. |
| 3 | **Stranger flow** | ⬜ not tested | Locally, both agents share a daemon process (implicitly "known"). With EC2: truly unknown remote party initiates TO local agent via `cello_await_session`. |
| 5 | **Directory reconnect** | ⬜ not tested | Both local agents share one signaling connection. Separate daemons let you test asymmetric reconnect scenarios. (Still testable locally by restarting a directory ECS task — both agents experience it identically.) |

#### Requires a separate device (EC2 demo agent mandatory)

| # | Scenario | Status | Why |
|---|----------|--------|-----|
| 6 | **Unilateral seal** | ⬜ not tested | One party must disappear while the other remains alive. Same daemon = both die. Test: start session with EC2 demo → stop cello-demo on EC2 → seal from local side unilaterally. |
| 4 | **Relay failover** | ⬜ not tested | Requires killing the relay mid-session. Both local agents experience the same failure simultaneously. (Only one relay exists, so local vs remote is equivalent — but conceptually separate daemons would expose asymmetric failure.) |

---

#### Known parked issues to check

- `standing_receiver_ready: false` in `cello status` (status display bug — daemon.ts:490 hardcodes `state: "registered"`) — may confuse operators even though the SR is actually running
- j-auth poll tests (DOD-AUTH-2 poll refresh / poll rejects forged) were pre-existing failures; check if they're still broken or if M8B inadvertently fixed them
- `cello_get_inclusion_proof` returns `not_implemented` — MCP tool not wired (cryptographic tree exists, sealed root is valid, tool just isn't connected)

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
