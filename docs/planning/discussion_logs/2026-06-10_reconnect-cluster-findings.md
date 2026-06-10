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
