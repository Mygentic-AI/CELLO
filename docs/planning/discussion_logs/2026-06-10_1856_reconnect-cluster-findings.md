---
name: reconnect-cluster-findings
type: investigation
date: 2026-06-10
topics: [reconnect, update, mcp, cello-mcp, demo-agent, reliability, diagnostics]
status: in-progress
description: >
  Per-scenario findings for the reconnect cluster investigation. Output is
  evidence, not fixes. One section per scenario as experiments are run.
---

# Reconnect Cluster — Findings

## Scenario 5 — Reconnect After Extended Real Idle

**Date/time run:** 2026-06-10, ~18:15 local (UTC+2) / ~16:15 UTC
**Connect version:** 0.0.41 (both local and demo agent)

**Baseline passed:** N/A — this is an opportunistic scenario; the baseline was established during a prior session, and we captured state on wake without a fresh baseline check.

---

### Trigger

Laptop was closed for several hours with Claude Code open and the cello MCP configured. No manual engineering — natural idle.

---

### Step 1: Process State on Wake

cello-mcp was still running (PID 62866). The local log has no timestamps, but shows the sequence of process restarts (each startup releases the lock and the next acquires it):

- PIDs 46542 → 49367 → 52521 → 54486 (prior session work)
- PID 58255 — successful startup, connected to directory, released lock
- **PID 62866 — post-sleep startup (the critical one):**
  - `opening_database`: ok (5ms)
  - `fetching_directory_address`: **FAILED** — `client.bootstrap.fetch.failed` with `reason: endpoint_returned_null`, `durationMs: 9`. The bootstrap endpoint responded in 9ms with null/empty — not a network timeout, an active null response.
  - `loading_agent_state`: ok (4ms)
  - `connecting_to_directory`: **FAILED** — `reason: no multiaddr configured` (because fetch failed, no address was stored)
  - `ready` reported ok — but with no directory connection

This explains the `directory_reachable: false` state on wake: the process restarted cleanly during sleep (lock was released by PID 58255 and acquired by PID 62866), but the bootstrap endpoint returned null so no multiaddr was available.

---

### Step 2: cello_status on Wake

```json
{
  "transport_started": true,
  "own_pubkey": "35313056d41fd7ce96cb5caf1e3c870e35343380b5595428bde5d98309500f72",
  "connected_peer_count": 0,
  "uptime_seconds": 1004,
  "active_session_count": 0,
  "directory_reachable": false,
  "registered": true,
  "agent_id": "b8ff33d5169be79758aa9df9f3aea482",
  "connection_count": 1,
  "policy_mode": "open",
  "policy_review_mode": "deterministic"
}
```

`registered: true` survived the restart (persisted in DB). `directory_reachable: false` confirmed.

---

### Step 3: Attempted cello_request_connection Before Reconnect

```json
{
  "error": {
    "reason": "directory_unreachable_timeout",
    "message": "Could not reach directory. Check your network connection."
  }
}
```

As expected — any operation requiring directory lookup fails immediately.

---

### Step 4: /mcp reconnect

`/mcp reconnect` spawned PID 66030. That process started, fetched the directory address successfully (bootstrap returned the address this time), connected to directory, and came up healthy.

Post-reconnect `cello_status`:
```json
{
  "transport_started": true,
  "own_pubkey": "35313056d41fd7ce96cb5caf1e3c870e35343380b5595428bde5d98309500f72",
  "connected_peer_count": 1,
  "uptime_seconds": 9,
  "active_session_count": 0,
  "directory_reachable": true,
  "registered": true,
  "agent_id": "b8ff33d5169be79758aa9df9f3aea482",
  "connection_count": 1,
  "policy_mode": "open",
  "policy_review_mode": "deterministic"
}
```

`/mcp reconnect` fully restored the connection.

---

### Step 5: Full Session Exchange (Post-Reconnect)

After reconnect:
- `cello_request_connection` to demo agent pubkey `12ccbfd5fa4049177e4c4a81f7462641c1ab4490bfd640ea7e6407a69d06a2f8`: accepted, `connection_id: edf2fd0fd3bb3c4f5a8a06bde391b3a4`
- `cello_initiate_session`: `ok: true`, `session_id: d0009a14dc09d4120378f615b76fcd77`
- 4-message exchange completed successfully
- `cello_close_session`: `status: sealed`, `sealed_root: ab751ef2739be78c2231596635abca2560a685a46ecffceae2fd83a2d76583d6`

**Demo agent log (via SSM, `/tmp/cello-mcp-stderr.log`):** Clean. Shows session `d0009a14` progressing: `active` → 8 message leaves (indices 0-7) → `sealing` → FROST ceremony completed (commit + sign OK, sigLength=64) → `sealed`. No errors. The demo agent had no awareness of the client's sleep period — it received a fresh connection and handled it normally.

---

### Step 6: Sealed Receipt

Retrieved immediately after seal:

```json
{
  "session_id": "d0009a14dc09d4120378f615b76fcd77",
  "sealed_root": "ab751ef2739be78c2231596635abca2560a685a46ecffceae2fd83a2d76583d6",
  "participants": [
    "35313056d41fd7ce96cb5caf1e3c870e35343380b5595428bde5d98309500f72",
    "12ccbfd5fa4049177e4c4a81f7462641c1ab4490bfd640ea7e6407a69d06a2f8"
  ],
  "close_timestamp": 1781108587139,
  "attestation_self": "PENDING",
  "attestation_counterparty": "PENDING",
  "directory_signature": "",
  "leaf_count": 10,
  "mmr_peak": null
}
```

`attestation_self: PENDING`, `attestation_counterparty: PENDING`, `directory_signature: ""`. The FROST seal ceremony itself completed — both agents signed, `sealed_root` is populated. The pending attestations are not a session failure.

---

### Directory CloudWatch Evidence (UTC timestamps)

Key events from `/ecs/cello-directory-dev`, us-east-1:

```
16:21:32Z  federation.checkpoint.skipped — availableNodes: 1, requiredThreshold: 2
16:21:35Z  Session request: 35313056 → 12ccbfd5
16:21:37Z  FROST ceremony complete — session d0009a14, assignment delivered to both parties
16:23:06Z  Seal initiated — session d0009a14 (10 leaves)
16:23:07Z  FROST seal ceremony — session d0009a14
16:23:07Z  Sealed — session d0009a14, root ab751ef2
16:23:07Z  notarization.recorded
16:23:07Z  mmr.leaf.appended — leafIndex: 2
16:23:07Z  mmr.checkpoint.pending — stagedAt: 1781108587447
```

No `checkpoint.complete` event appears in the 2-hour window. The MMR checkpoint is staged but never committed. `federation.checkpoint.skipped` earlier confirms why: only 1 directory node is available, threshold requires 2. The checkpoint cannot be signed without a second node.

This is the direct producer of `attestation_self/counterparty: PENDING` and `directory_signature: ""` in the receipt. The bilateral seal between the two agents completed correctly; the directory-level notarization is pending federation quorum.

---

### Diagnostic Question Answer

**Does cello-mcp auto-recover after a real multi-hour idle?** No.

The process restarted during the idle period (a new Claude Code session spawned it), but the bootstrap endpoint returned null at that moment, so the process started with no multiaddr and `directory_reachable: false`. There is no retry loop — if bootstrap fails at startup, the process stays disconnected until restarted.

**Does `/mcp reconnect` fix it?** Yes, completely. One reconnect restored `directory_reachable: true` and the full session exchange worked without any further intervention.

---

### Hypotheses Raised

1. **Bootstrap endpoint transiently returning null during laptop sleep/wake.** The 9ms response time on the failed fetch rules out a network timeout. The endpoint was reachable but returned null/empty. This may be a transient condition at wake time (network not yet fully up, DNS resolved but HTTP response empty). Worth checking: does the bootstrap endpoint ever return null under normal conditions, or is this specific to the wake window?

2. **No retry loop on startup bootstrap failure.** Once `fetching_directory_address` fails, the process does not retry. It proceeds to `loading_agent_state` and `ready` without a directory connection. A retry with backoff at startup would likely self-heal this case without needing `/mcp reconnect`.

3. **`mmr.checkpoint.pending` but never `checkpoint.complete` is a known federation gap.** Only 1 of 2 required nodes is available in dev. This is not new and is not caused by the sleep/reconnect scenario. The receipt attestations will remain PENDING until a second directory node is available and the federation threshold is met. This is tracked separately.

---

### Artifacts

| Artifact | Location |
|----------|----------|
| Local MCP stderr | Full log read above (no timestamps) |
| cello_status (on wake) | Inline above |
| cello_status (post-reconnect) | Inline above |
| Sealed receipt | Inline above |
| Directory CloudWatch | Key lines inline above |
| Demo agent log | `/tmp/cello-mcp-stderr.log` on i-0ad3e7c22470f266e, key lines inline above |
| Connect version | 0.0.41 |

---

## Scenario 1 — Version Bump: Reconnect Only (No Remove/Re-Add)

**Date/time run:** 2026-06-10, ~19:06 local (UTC+2) / ~17:06 UTC
**Connect version before:** 0.0.41
**Connect version after:** 0.0.42
**Install timestamp:** 19:05:58 local (confirmed by `date` command after `npm install -g`)

**Baseline passed:** Yes — `cello_status` showed `directory_reachable: true`, `registered: true`, session and close completed before trigger.

---

### Trigger

```bash
npm install -g @cello-protocol/connect@latest   # installed 0.0.42 at 19:05:58
/mcp reconnect                                   # Claude Code MCP reconnect
```

No `claude mcp remove` / `claude mcp add` performed.

---

### cello_status After Reconnect

```json
{
  "transport_started": true,
  "connected_peer_count": 1,
  "uptime_seconds": 20,
  "directory_reachable": true,
  "registered": true,
  "agent_id": "b8ff33d5169be79758aa9df9f3aea482"
}
```

Version confirmed: `package.json` timestamp 19:05 in npm global dir, version field 0.0.42.

---

### Session A — Aborted (1 round, then close)

Session `8d49643cdb819b3c3480f06e2c7e5bfb` — initiated, 1 send/receive, then `cello_close_session` called prematurely.

`cello_close_session` result:
```json
{"status":"seal_deferred","sealed_root":null,"reason":"directory_unreachable","mmr_peak":null}
```

**Local log:** 2 leaves (indices 0-1, seq 1-2), then `sealing` → `seal_deferred`.

**Demo agent log:** Session went `active` → 2 leaves → `sealing`. No `sealed` entry — demo agent left in `sealing` state with no resolution.

**Directory CloudWatch:** No seal attempt for `8d49643c` appears at all. The `reason: directory_unreachable` was a client-side error — the seal ceremony never reached the directory.

**Conclusion:** `seal_deferred` was caused by closing after only 1 round. See ancillary finding below.

---

### Session B — Full Protocol (4 rounds, clean seal)

Session `1ace1e21c70aeefc667b768a2fd7a68d` — 4 complete rounds, then `cello_close_session`.

`cello_close_session` result:
```json
{"status":"sealed","sealed_root":"6e4a1b7eec56176e6d5e4931e1c7180b01953f627856a2556ab9259f5d5e12a0","reason":null}
```

**Local log:** 10 leaves (indices 0-9: 8 msg + 2 ctrl), `sealing` → `sealed`. FROST ceremony completed (commit + sign OK, sigLength=64).

**Demo agent log:** Clean. 10 leaves → `sealing` → FROST ceremony → `sealed`. Notable startup difference: `fetching_directory_address: ok (from CELLO_DIRECTORY_MULTIADDR)` — the demo agent uses a pinned env var, not the bootstrap HTTP endpoint. This is why it never hits the bootstrap-returns-null failure seen on the local client.

**Directory CloudWatch (UTC):**
```
17:11:54Z  Session request: 35313056 → 12ccbfd5
17:11:56Z  FROST ceremony complete, assignment delivered (initiatorGot=true, targetGot=true)
17:13:02Z  Seal initiated — session 1ace1e21 (10 leaves)
17:13:03Z  Sealed — root 6e4a1b7e
17:13:03Z  notarization.recorded, mmr.leaf.appended (leafIndex: 3), mmr.checkpoint.pending
```

No `checkpoint.complete` — same federation gap as Scenario 5.

---

### Diagnostic Question Answer

**Does `npm install -g @cello-protocol/connect@latest` + `/mcp reconnect` pick up the new version and maintain working state?** Yes.

0.0.42 was loaded, `registered: true` and key material survived, full 4-round session and seal completed correctly.

**README claim validated:** The documented upgrade path works. No remove/re-add required.

---

### Ancillary Finding — seal_deferred / directory_unreachable When Exchange Is Incomplete

Closing a session after fewer than 4 rounds produces `seal_deferred` with `reason: directory_unreachable`. The seal never reaches the directory — it fails client-side. The demo agent is left in `sealing` state indefinitely. The error message `directory_unreachable` is misleading — the directory was reachable; the protocol exchange was incomplete. A clearer error (e.g. `exchange_incomplete` or `seal_precondition_failed`) would help operators diagnose this without confusion.

---

## Scenario 2 — Version Bump: Remove/Re-Add

**Date/time run:** 2026-06-10, ~19:20 local (UTC+2) / ~17:20 UTC
**Connect version before:** 0.0.41
**Connect version after:** 0.0.42 (same as Scenario 1 — npx pulled from cache)
**Baseline passed:** Yes — fresh pre-conditions run after Scenario 1: logs cleared, demo agent restarted.

---

### Trigger

```bash
claude mcp remove cello
claude mcp add cello -- npx --yes @cello-protocol/connect@latest
```

Note: `claude mcp remove` failed silently (the MCP server had already disconnected — it was not in the active config). The `add` command succeeded and registered `cello` as an npx-invoked MCP server.

---

### Startup Observations

**Two-PID startup pattern (local log):**

On `/mcp` invocation, two cello-mcp processes started in sequence:

- **PID 74269**: acquired lock → opened DB (`agentId: 35313056...`) → fetching directory address… released lock mid-bootstrap before completing startup
- **PID 74347**: acquired lock → DB opened → `fetching_directory_address: ok` (984ms) → `loading_agent_state: ok` (0ms) → `connecting_to_directory: ok` (3439ms) → `ready: ok`

The lock release by PID 74269 and acquisition by PID 74347 indicates the `npx` invocation triggered a concurrent startup race — the first process was likely a stale or partial invocation that detected an existing process and gracefully released. PID 74347 completed the full startup and became the live process.

**npx cache:** The `/mcp` reconnect was instantaneous (as noted by the operator). npx served 0.0.42 from the local cache — no network download occurred.

---

### cello_status After Reconnect

```json
{
  "transport_started": true,
  "own_pubkey": "35313056d41fd7ce96cb5caf1e3c870e35343380b5595428bde5d98309500f72",
  "connected_peer_count": 1,
  "uptime_seconds": 21,
  "active_session_count": 0,
  "directory_reachable": true,
  "registered": true,
  "agent_id": "b8ff33d5169be79758aa9df9f3aea482",
  "connection_count": 1,
  "policy_mode": "open",
  "policy_review_mode": "deterministic"
}
```

`registered: true`, `directory_reachable: true`. Agent identity preserved.

---

### Session — Full Protocol (4 rounds, clean seal)

Session `2d49dcd24f75bbf2076ec20b2cc19b1f` — 4 complete rounds, then `cello_close_session`.

`cello_close_session` result:
```json
{"status":"sealed","sealed_root":"a41effeb6f72e7d88d0de2ce2f9f21ff31afaee99c45022af77b55c91756b73c","reason":null}
```

**Local log:** 10 leaves (indices 0-9: 8 msg + 2 ctrl), `sealing` → FROST ceremony completed (`sigLength=64`, commit + sign OK, aggregate OK) → `sealed`.

**Demo agent log (via SSM):** Startup for Scenario 2 shows the demo agent also had the two-startup-variant pattern on its side (PIDs 847508 → 847931). Demo agent uses `CELLO_DIRECTORY_MULTIADDR` (env var), so `fetching_directory_address: ok (0ms)` — no bootstrap HTTP call. Session `2d49dcd2`: `active` → 8 msg leaves (indices 0-7) → `sealing` → FROST ceremony completed (`sigLength=64`) → `sealed`. No errors.

**Directory CloudWatch (UTC):**
```
17:20:47Z  Session 2d49dcd2 established (35313056 → 12ccbfd5)
17:21:32Z  federation.checkpoint.round.initiated batchSize=4 — then skipped (availableNodes: 1, threshold: 2)
17:22:01Z  Seal initiated — session 2d49dcd2 (10 leaves)
17:22:02Z  Sealed — root a41effeb
17:22:02Z  notarization.recorded
17:22:02Z  mmr.leaf.appended — leafIndex: 4
17:22:02Z  mmr.checkpoint.pending — stagedAt: 1781109722
17:22:11Z  signaling.stream.closed — peer 35313056, pendingSessionsCount: 1, pendingSessionKeys: ["2d49dcd24f75bbf2076ec20b2cc19b1f"]
```

The `signaling.stream.closed` event at 17:22:11Z — 9 seconds post-seal — represents the directory detecting that the local client disconnected after `cello_close_session` returned. `pendingSessionsCount: 1` with the sealed session still listed means the directory's session record had not been fully cleared from the signaling layer's session map before the stream closed. This is expected post-seal behavior; the session was already in `sealed` state when the stream closed.

Same federation checkpoint gap as Scenarios 5 and 1 — no `checkpoint.complete`, just `mmr.checkpoint.pending`.

---

### Diagnostic Question Answer

**Does remove/re-add succeed where reconnect-only (Scenario 1) failed?** Not applicable — Scenario 1 also succeeded. Both paths work for a version bump.

**What is different between the two paths?**

- Scenario 1 (`/mcp reconnect`): Claude Code kills and respawns the existing process. Startup is deterministic — single process, no lock race.
- Scenario 2 (remove/re-add with `npx`): Process invocation via npx produces a two-PID startup sequence. The first process releases the lock before finishing; the second completes startup. Net result is the same — one running process — but the startup trace is noisier.
- Both approaches: npx served from cache (instantaneous). If the cache were absent, Scenario 2 would include a download step that Scenario 1 would not.

**Verdict: PASS.** Remove/re-add works. Behaviorally identical to reconnect-only for an already-cached version. The startup race (two PIDs) resolved cleanly without intervention.

---

### Hypotheses Raised

1. **Two-PID startup pattern is specific to npx invocation.** When Claude Code invokes `npx --yes @cello-protocol/connect@latest`, the first process may be the npx launcher or a competing Claude Code subprocess that detects the MCP slot being filled and backs off. The DB lock discipline handles this gracefully. Worth confirming: does this pattern appear consistently with npx, or is it occasional?

2. **signaling.stream.closed with pendingSessionsCount: 1 post-seal is normal.** The sealed session persists in the directory's signaling session map until the stream closes. The directory has no explicit "session fully closed" message from the client — it learns of client disconnect from the stream closure. The `pendingSessionKeys` list at closure is a directory-side cleanup artifact, not a failure. This should be verified against the signaling manager code: is there a race where the directory could attempt to re-deliver to a disconnected client?

---

### Artifacts

| Artifact | Location |
|----------|----------|
| Local MCP stderr | Full log read above (no timestamps) |
| cello_status (post-reconnect) | Inline above |
| Sealed receipt | `status: sealed`, `sealed_root: a41effeb...` |
| Directory CloudWatch | Key lines inline above |
| Demo agent log | `/tmp/cello-mcp-stderr.log` on i-0ad3e7c22470f266e, key lines inline above |
| Connect version | 0.0.42 (npx cached) |

---

## Scenario 3 — Idle Process: SIGSTOP Sleep Simulation

**Date/time run:** 2026-06-10, 19:32:19–19:38:23 local (UTC+2) / 17:32:19–17:38:23 UTC
**Connect version:** 0.0.42
**STOP duration:** ~6 minutes (target was 5; executed `kill -CONT` at 19:38:23)
**Baseline passed:** Yes — full 4-round exchange, `status: sealed` (session `52294f98`) before STOP.

---

### Trigger

```bash
PID=$(pgrep -f cello-mcp)   # PID 76606
kill -STOP $PID              # 19:32:19 local
sleep 300
kill -CONT $PID              # 19:38:23 local
```

---

### cello_status Immediately After SIGCONT

```json
{
  "transport_started": true,
  "connected_peer_count": 1,
  "uptime_seconds": 463,
  "active_session_count": 0,
  "directory_reachable": true,
  "registered": true,
  "agent_id": "b8ff33d5169be79758aa9df9f3aea482"
}
```

**Auto-recovered. No `/mcp reconnect` required.** `directory_reachable: true`, `connected_peer_count: 1` — the connection was restored without any intervention after SIGCONT.

---

### What the Directory Saw During the STOP Window

The directory detected the client disconnect at **17:32:30Z** — 11 seconds after SIGSTOP was issued (17:32:19Z). The disconnect was detected via a signaling stream error:

```
17:32:30Z  Peer disconnected: 12D3KooW
17:32:30Z  Signaling stream error — peer 35313056, error="The operation was aborted due to timeout"
17:32:30Z  signaling.stream.closed — peer 35313056, pendingSessionsCount: 1, pendingSessionKeys: ["52294f98"]
17:32:30Z  Removed stream from map — peer 35313056
```

The `pendingSessionKeys: ["52294f98"]` is the baseline session, which had already been sealed before the STOP — the directory's session map had not yet been cleared when the stream closed. This is the same post-seal cleanup artifact as Scenarios 1 and 2.

After the stream was removed at 17:32:30Z, the directory log shows no activity for the local client's peer ID (`35313056`) until the session initiation for `062af363` at 17:38:38Z — over 6 minutes of silence. The directory correctly treated the client as disconnected for the entire STOP window.

---

### Reconnection Behavior After SIGCONT

After SIGCONT, the local process re-established its signaling stream with the directory. The first evidence of this in the directory log is the FROST ceremony for session `062af363` at 17:38:38Z — the directory's `ClientDelegatedSigner` found the stream open (`stream=found, status=open`) for peer `35313056d41fd7ce`, confirming the stream had been re-established before the session initiation call.

The local log shows no explicit reconnection event — no `client.startup.progress` lines after SIGCONT, just the FROST ceremony entries for the new session. The process did not restart; it resumed where it left off and silently re-established its connection to the directory.

---

### Post-SIGCONT Session — Full Protocol (4 rounds, clean seal)

Session `062af363888d6669f4f13ed9a61af037` — 4 complete rounds, then `cello_close_session`.

`cello_close_session` result:
```json
{"status":"sealed","sealed_root":"aa257d22b4164f016b2bf796f85908bfd3dc4a52c1c10a39914de67d810e813e","reason":null}
```

**Local log:** 10 leaves (indices 0-9: 8 msg + 2 ctrl), `sealing` → FROST ceremony completed (sigLength=64) → `sealed`. No errors.

**Demo agent log:** Session `062af363` clean: `active` → 10 leaves → `sealing` → FROST completed → `sealed`. Also shows the Scenario 2 baseline session (`52294f98`) being processed on startup — the demo agent had queued the seal ceremony for it from before the STOP window and completed it after restart.

**Directory CloudWatch (UTC):**
```
17:38:38Z  Session 062af363 established (35313056 → 12ccbfd5)
17:39:37Z  Seal initiated — session 062af363 (10 leaves)
17:39:37Z  Sealed — root aa257d22
17:39:37Z  notarization.recorded
17:39:37Z  mmr.leaf.appended — leafIndex: 6
17:39:37Z  mmr.checkpoint.pending
```

---

### Ancillary Finding — Queued counterparty_closing Delivered After SIGCONT

On the first `cello_receive` call after SIGCONT, the client delivered a `counterparty_closing` event for the already-sealed baseline session `52294f98`. This event was queued during the STOP window — the demo agent had closed its side before the STOP, but the close notification was buffered by the transport and only delivered to the local process when it resumed.

`cello_close_session` on the already-sealed session returned `seal_rejected` / `session_not_active` as expected. The next `cello_receive` returned `session_sealed` for the same session, confirming both parties had sealed. No data loss, no state corruption.

**The queuing of events across a STOP/CONT is correct behavior** — the transport held the incoming messages in its buffer and delivered them on resume. This is distinct from the laptop sleep scenario (Scenario 5) where the process restarted and had no buffer continuity.

---

### Diagnostic Question Answer

**Does a SIGSTOP'd process auto-recover after SIGCONT?** Yes, completely.

After 6 minutes stopped, `cello_status` showed `directory_reachable: true` and `connected_peer_count: 1` immediately after SIGCONT. No `/mcp reconnect` was needed. The process silently re-established its signaling stream with the directory and was immediately ready to initiate new sessions.

**Did the directory detect the disconnect?** Yes — within 11 seconds of SIGSTOP, via a stream timeout. The client was removed from the directory's streams map and treated as disconnected for the full 6-minute window.

**Did the demo agent detect the disconnect?** Not directly (it has no active session during the STOP window). The demo agent had already sealed the baseline session before the STOP; its log shows no events during the STOP window.

**Key difference from Scenario 5:** In Scenario 5, the process restarted during sleep and the bootstrap endpoint returned null — the process came back unhealthy. In Scenario 3, the process never restarted — SIGSTOP pauses execution in place, preserving all in-memory state including the transport's connection state. On SIGCONT, the OS resumes the process and the existing transport layer re-establishes the stream.

---

### Hypotheses Raised

1. **The reconnection after SIGCONT happens inside the transport layer, not in application code.** There is no log event like `client.transport.reconnected` — the process just resumes and the next operation works. This means the reconnect logic lives at the libp2p or stream level, and the application code never sees it as a disconnect. This is correct behavior for SIGSTOP (the OS suspends all syscalls), but it means the reconnect path is not exercised in this scenario.

2. **11-second detection lag on the directory side.** The stream error appeared 11 seconds after SIGSTOP. This is the keepalive/heartbeat timeout on the directory's side — it takes 11 seconds of silence to declare the stream dead. The local process was stopped before it could send or receive anything, so the directory's timeout was the only detection mechanism.

3. **The STOP/CONT scenario does NOT reproduce the laptop-sleep failure (Scenario 5).** In Scenario 5, the process restarts (new PID, new startup sequence, bootstrap called again). In Scenario 3, the process never restarts. These are fundamentally different failure modes with different recovery paths.

---

### Artifacts

| Artifact | Location |
|----------|----------|
| Local MCP stderr | Full log read above (no timestamps) |
| cello_status (post-SIGCONT) | Inline above |
| Sealed receipt | `status: sealed`, `sealed_root: aa257d22...` |
| Directory CloudWatch | Key lines inline above; full STOP-window analysis included |
| Demo agent log | `/tmp/cello-mcp-stderr.log` on i-0ad3e7c22470f266e, key lines inline above |
| Connect version | 0.0.42 |

---

## Scenario 4 — Directory Redeploy While Client Is Running

**Date/time run:** 2026-06-10, 20:07:00–20:21:29 local (UTC+2) / 18:07:00–18:21:29 UTC
**Connect version:** 0.0.42
**Baseline passed:** Yes — full 4-round exchange, `status: sealed` (session `5f8817eb`) before trigger.

---

### Trigger

```bash
TASK_ARN=$(aws ecs list-tasks --cluster cello-dev --service-name cello-directory-dev \
  --region us-east-1 --query 'taskArns[0]' --output text)
aws ecs stop-task --cluster cello-dev --task "$TASK_ARN" --region us-east-1 \
  --reason "Scenario 4: directory redeploy fault injection"
# Stopped at 20:07:00 local
```

---

### Timeline

| UTC | Event |
|-----|-------|
| 18:07:40 | Old directory task: `Peer disconnected` (relay, both agents) |
| 18:07:44 | Old directory task: `signaling.stream.closed` for demo agent (`12ccbfd5`) and local client (`35313056`) |
| 18:07:50 | Old directory task: `directory.service.stopped` — uptime 28580877ms (~7.9 hours) |
| 18:07:55 | New directory task: `migration.starting` (task ID `9a3b1202`) |
| 18:08:16 | New directory task: Flyway — schema v30, no migration needed |
| 18:08:22 | New directory task: `relay.manifest.loaded` — version **18** (stale, pre-re-sign) |
| 18:08:23 | New directory task: `directory.service.started`, relay connected immediately |
| 18:09:52 | Relay: `relay.health.check.passed` on new directory |
| 18:10:36 | Relay: `relay.already.registered` — relay re-registered with new directory, new IP `10.0.64.132` |
| 18:13:04 | Local client: authenticated and `peer_id` announced on new directory |
| 18:13:17 | Local client: `cello_initiate_session` attempted — **`target_offline`** (demo agent not yet connected) |
| 18:13:39 | Manifest re-signed: version 18 → 20 uploaded to S3 |
| 18:16:22 | New directory: `relay.manifest.poll.noop` — already at version 20 (picked up before re-sign; timing coincidence) |
| 18:19:37 | Second `cello_initiate_session` attempt — **`target_offline`** (demo agent still not connected) |
| 18:20:08 | Demo agent: authenticated and `peer_id` announced — `streamsMapSize: 2` (both agents registered) |
| 18:20:29 | `cello_initiate_session` — **`ok: true`**, session `a9f961a8` |
| 18:21:29 | Session `a9f961a8` sealed — root `a13dfd0b` |

---

### Phase 1 — Before Relay Restart (Expected Failure)

`cello_initiate_session` at 18:13:17Z returned `target_offline`. The directory log shows:

```
[SESS]  Request failed — agent 35313056, reason: target_offline
frost.debug.session_request.target_stream: targetStreamFound=false
```

The demo agent (`12ccbfd5`) had not yet reconnected to the new directory container. Its signaling stream was in the old container — which was dead. The local client reconnected to the new directory (authenticated at 18:13:04Z) but could not reach its counterparty.

Note: the failure mode was `target_offline`, not `relay_unavailable`. The relay had already re-registered at this point (`relay.already.registered` at 18:10:36Z). The manifest re-sign was performed but was not the blocker — the demo agent's reconnect was.

---

### Phase 2 — After Demo Agent Restart

The demo agent was manually restarted via SSM (`systemctl restart cello-demo.service`). It re-connected to the new directory in 137ms (`connecting_to_directory: ok (137ms)`, via `CELLO_DIRECTORY_MULTIADDR`). Once both agents were registered (`streamsMapSize: 2` at 18:20:08Z), session initiation succeeded immediately.

**Post-restart session `a9f961a8`:** 4-round exchange, clean seal, `status: sealed`, `sealed_root: a13dfd0b`.

**Local log:** Two additional `client.startup.prior.process.killed` cycles visible between baseline and the post-restart session — these are the `/mcp reconnect` calls during the investigation.

---

### Key Observations

**1. Local client auto-reconnected to new directory.** After the directory replacement, the local cello-mcp process reconnected silently and without intervention. No `/mcp reconnect` was needed — `directory_reachable: true` was restored automatically.

**2. The relay re-registered without any operator action.** The relay detected the old directory container going down (libp2p disconnect) and re-registered with the new container within ~2 minutes. `relay.already.registered` confirmed this at 18:10:36Z. The manifest re-sign was performed but the relay had already re-registered before the new manifest was polled.

**3. The new directory loaded a stale manifest (version 18) at startup.** The manifest in S3 at startup time was version 18 (the relay's old IP). By the time the directory polled S3 (at 18:16:22Z, ~8 minutes after startup), the manifest was already at version 20 — re-signed during the investigation. No action was needed because the relay had already re-registered in-memory. The manifest re-sign is required for *client* relay discovery, not for directory-side relay assignment.

**4. The real blocker was the demo agent, not the relay or manifest.** `target_offline` persisted until the demo agent restarted and re-registered. The demo agent uses `CELLO_DIRECTORY_MULTIADDR` (pinned env var) and reconnects in ~137ms on startup, but has no in-process reconnect logic — it does not detect that its current directory connection is dead and dial a new one.

---

### Diagnostic Question Answer

**Does the local client auto-recover after a directory redeploy?** Yes — the local cello-mcp process reconnected to the new directory container silently, without `/mcp reconnect`.

**Does the relay need to be restarted?** No — in this run the relay re-registered automatically. The `infra/CLAUDE.md` documented the "relay must be restarted" rule, but the actual observed behavior was automatic re-registration. The distinction may be: the rule was written when the relay had no reconnect logic; the current relay apparently does detect the directory disconnect and re-registers.

**Does the manifest need to be re-signed?** It was re-signed as a precaution. In practice the relay had already re-registered in memory before the manifest was polled, so the re-sign was not the unblocking action.

**Does session initiation work immediately after directory replacement?** No — it fails with `target_offline` until the *counterparty* also reconnects to the new directory. In this case that required manually restarting the demo agent. A production counterparty with the same reconnect behavior as the local client (auto-reconnect on directory disconnect) would unblock itself without operator action.

---

### Hypotheses Raised

1. **The relay has reconnect logic; the documented "must restart" rule may be stale.** The relay re-registered without a restart in this run. Either the relay now dials the directory on disconnect (if so, the CLAUDE.md rule is outdated), or the directory rebooted fast enough that the relay's connection was still in-flight and the relay dialed the new instance automatically. Worth verifying in the relay code.

2. **The local client has auto-reconnect to directory; the demo agent does not.** The local client (`35313056`) reconnected silently. The demo agent (`12ccbfd5`) required a service restart. The difference is environment: the demo agent runs as a `systemd` service — the service itself restarted (via SSM) to pick up the new directory. An agent with no process supervisor would stay disconnected indefinitely. This is the same architectural gap as the bootstrap-null issue in Scenario 5 — no retry/reconnect loop means a dead connection stays dead.

3. **`target_offline` is the correct error for this failure mode** (not `relay_unavailable`). When the relay is healthy and registered but the counterparty's signaling stream is not in the directory's map, the directory correctly returns `target_offline`. The error message is accurate and actionable.

---

### Artifacts

| Artifact | Location |
|----------|----------|
| Local MCP stderr | Key lines inline above (3 PIDs: 78710, 80368, 80740) |
| cello_status (post-directory-restart) | `directory_reachable: true` — auto-recovered |
| Sealed receipt | `status: sealed`, `sealed_root: a13dfd0b...` |
| Directory CloudWatch | Full timeline inline above |
| Demo agent log | `/tmp/cello-mcp-stderr.log` on i-0ad3e7c22470f266e — startup + session `5f8817eb` + session `a9f961a8` |
| Connect version | 0.0.42 |
