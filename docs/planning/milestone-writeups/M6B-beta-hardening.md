---
name: M6B — Beta Hardening
type: milestone-writeup
date: 2026-06-10
topics: [milestone, M6B, hardening, relay, directory, networking, operations, registration, refactor]
status: closed
description: >
  M6B write-up — unplanned hardening milestone spawned by M6 beta launch pain.
  18 stories over 7 days. Eliminated orphan processes, opaque error messages,
  fragile relay infrastructure, and the startup-order dependency between directory
  and relay. The milestone's dominant story is the relay→directory connectivity
  saga that consumed most of the week and produced the rules now baked into infra/CLAUDE.md.
---

# M6B — Beta Hardening

**Started:** 2026-06-03
**Closed:** 2026-06-10
**Stories closed:** M6B-001 through M6B-014, M6B-016, M6B-017, M6B-019 (17 merged)
**Stories open:** M6B-015 (rename, ready to implement), M6B-018 (signaling keepalive, story not yet written)

---

## Why This Milestone Exists

M6 shipped working code on 2026-05-31. Proving that it worked — running M6-E2E-001 — took until 2026-06-10. The code was not the problem. Seven days of operational pain were.

Three failure patterns repeated across every debugging session:

**1. Debugging amnesia.** The same root causes recurred with no memory: stale K_server shares, orphan processes stealing FROST ceremonies, dead signaling streams. Error messages were useless — `directory_below_threshold` covered every FROST failure; `seal_deferred` gave no indication why; `relay_unavailable` masked TCP-level errors. Every broken session was 2–4 hours of log archaeology to rediscover the same root cause.

**2. Deploy cascades.** The relay had no stable identity — every ECS task replacement generated a new peer ID and a new private IP. This stalened the S3 manifest, broke the directory's in-memory relay address, and required manual manifest updates and directory restarts to recover. The directory restart disconnected all clients, which often required a relay restart, which requried another manifest update. One deploy triggered three manual follow-up actions.

**3. Process accumulation.** Every new Claude Code session started a new `cello-mcp` process. The SQLite write lock was never released. After a day of debugging, 7 orphan processes competed for FROST ceremonies. The only fix was `pkill -f cello-mcp`.

M6B was not planned. It was created on 2026-06-03 to absorb the PREP stories that had been queued before M7 and add the new stories that emerged from the E2E testing sessions. It grew from 13 stories at creation to 18 by close.

---

## The Dominant Story: relay→directory Connectivity

The single most expensive problem across M6 and M6B was the relay not being able to reach the directory. It had four distinct root causes that compounded over the course of the week, each masking the next:

**Layer 1 — No NAT gateway (M6B-014).**
The relay runs in a private ECS subnet with no outbound internet access. The directory's public ALB was unreachable. After the nuclear reset (2026-06-05/06), the relay registered via a manual SG rule pointing directly at the directory's private IP — which broke on the next directory task replacement.

The fix: added a NAT gateway to the VPC. Relay in the private subnet can now reach the directory's public DNS hostname. `deploy.sh` updated to construct `CELLO_DIRECTORY_MULTIADDR` from SSM at deploy time using the DNS hostname, not a hardcoded IP.

**Layer 2 — Stale IP in `NetworkRelayAdapter` (relay_unavailable).**
The directory's `NetworkRelayAdapter` held the relay's private IP in memory. When the relay ECS task was replaced and received a new IP, the directory kept dialing the dead container. The underlying TCP error (`EHOSTUNREACH`) was serialized as `[object Object]` and swallowed — only `relay_unavailable` was visible. This had been the recurring failure mode across all of M6/M6B.

Fix (commit `a60ac4e`): relay sends a `multiaddr` field in the `relay_register` frame. Directory calls `updateMultiaddr()` on the adapter when registration arrives. Self-healing from this point — every relay task replacement triggers a re-registration that updates the dial address.

**Layer 3 — Missing manifest fields (relay_auth_error).**
After the relay fix, `cello_initiate_session` returned `relay_auth_error`. The ceremony completed and `session_assignment` arrived — but the client couldn't open a libp2p stream to the relay. The S3 manifest was missing `multiaddrs` and `peerId` fields — only `healthCheckUrl` was being written. `pickRelay()` in the directory fell back to `wss://relay-us1.cello.mygentic.ai` (not dialable as libp2p) and the hex Ed25519 key (not a libp2p PeerId).

Fix (commit `7c6a493`): `reSignManifestForRelay` now writes `relayEntry.multiaddrs` and `relayEntry.peerId` from the `multiaddr` field in the `relay_register` frame. Manifest now contains all fields clients need to establish a relay connection.

**Layer 4 — Startup-order dependency between directory and relay (M6B-019).**
Even after all the above fixes, the directory could not reach the relay after its own restart unless the relay also restarted to re-register. The `updateMultiaddr()` mechanism only fires when the relay sends a `relay_register` frame — which only happens at relay startup. Directory restart → stale in-memory address → `relay_unavailable` until relay restart.

Fix (M6B-019): SSM node registry. `deploy.sh` writes `/cello/{env}/nodes/{role}/aws-{region}` parameters (hostname, peerId, port, transport, status). Directory reads these at startup, constructs DNS multiaddrs from stable hostnames, and pre-populates both the relay pool manifest and `NetworkRelayAdapter`. The directory can reach the relay immediately after any restart regardless of whether the relay has re-registered. `CELLO_RELAY_MULTIADDR` removed from ECS task definitions. The startup-ordering dependency is eliminated.

**Verified end-to-end (2026-06-10):** directory restarted without restarting the relay. Directory read SSM at startup. Relay re-registered ~90s later. `cello_initiate_session` returned `ok: true`. Full bilateral seal completed. The operational rule "restart the relay after every directory redeploy" is now obsolete.

---

## What the Week Actually Looked Like

### Day 1 (2026-06-03): Scope set, first stories merged

M6B milestone created. 13 stories extracted from the M7 PREP domain plus the COORDINATION format established. M6B-001 (PID lock) and M6B-002 (ceremony error propagation) both already sprint-reviewed and APPROVED. Attempted to run M6-E2E-001 AC-005/006 — failed because M6B infrastructure stories were incomplete.

Seven root causes of that failure, all preventable by the stories in the queue:
relay pool unavailable (M6B-006/008), hardcoded relay IP (M6B-006), orphan processes (M6B-001), npx 30s compile timeout (M6B-013), no manifest auto-reload (M6B-008), stale FROST share (M6B-002), manual ECS patching (discipline violation).

### Day 2 (2026-06-03/04): Rapid merge week — 9 stories in two days

M6B-001, 002, 004, 005, 006, 007, 008, 012, 013 all merged. The first wave of infrastructure fixes shipped: PID lock file, WAL mode, relay auto-registration, relay WebSocket ALB, manifest poll loop, pre-built SQLCipher.

### Day 3 (2026-06-05/06): Nuclear reset and REPOSPLIT-002

The accumulated manual ECS patches (wrong task defs, manual SG rules, hardcoded IPs) were irreconcilable. The decision: recreate all ECS stacks from current IaC. All directory, relay, and ops-agent stacks recreated from scratch. Database wiped for a clean re-registration baseline.

REPOSPLIT-002 was completed in this window: `workspace:*` references to cello-client packages replaced with pinned semver, stale package source directories deleted, dead CodePipelines removed. The Dockerfiles still referenced the deleted local directories — a second fix commit was required. Both directory and relay pipelines triggered and completed all 3 regions.

After the reset: relay still wouldn't register with the directory. Root cause: no NAT gateway. The relay in the private subnet couldn't reach the directory's public ALB. M6B-014 story written and implemented.

### Day 4 (2026-06-07): NAT gateway + relay health check deadlock

M6B-014 deployed NAT gateway. Route53 A records for all 3 directory hostnames were missing (deleted by `purge_stale_dns_record()` running unconditionally against a healthy stack — a deploy.sh bug). Fixed: guard added to check CFN stack status before purging. All 3 A records manually recreated. All 3 relays registered.

Secondary incident: a failed attempt to make the relay health endpoint return 503 until registered caused an ECS deadlock — the health check used to decide task liveness was now returning 503 at startup, so ECS killed tasks before they could register. 29 tasks failed in a loop across all 3 regions. Fix: revert, `/health` always returns 200 (process liveness), registration is background behavior.

M6B-016 (registration data integrity) and M6B-015 (rename) written and sprint-reviewed.

### Day 5 (2026-06-08): Stale IP identified, SIGTERM race fixed, M6B-017 merged

The relay `relay_unavailable` root cause finally identified: `NetworkRelayAdapter` held a static private IP that went stale on every relay task replacement. The underlying TCP error had been swallowed as `[object Object]` for the entire M6/M6B period. Three regression tests added.

Simultaneous diagnosis: M6B-001's SIGTERM handler was `process.exit(0)` — immediate exit on lock file kill. Every new Claude Code session killed the prior process, tearing down libp2p mid-ceremony. Fixed with 4-second graceful shutdown poll.

M6B-017 (client.ts structural refactor) merged: 6,198-line `client.ts` extracted into 6 focused manager classes. All 319 tests pass unmodified.

### Day 6 (2026-06-09): First successful session initiation. Then AC-006 root cause.

`cello_initiate_session` returned `{ok: true}` at 09:22 UTC. Six days after the first attempt.

The final layer: S3 manifest was missing `multiaddrs` and `peerId` fields. `reSignManifestForRelay` only wrote `healthCheckUrl`. One commit, ~20 lines.

By evening: AC-006 root cause identified. The bilateral seal protocol requires two SEAL ctrl leaves from distinct senders. The responder's `seal-manager.ts:132` guard rejected `"sealing"` status — treating "the counterparty has started sealing" as an invalid state rather than the trigger to complete the local half. Guard expanded to allow `"sealing"`.

### Day 7 (2026-06-10): M6B-019 + M6-E2E-001 closed

M6B-019 (SSM node registry) deployed. Directory reads relay DNS multiaddrs from SSM at startup. Full E2E verification: directory restarted without restarting the relay; `cello_initiate_session` succeeded. Bilateral seal completed.

M6-E2E-001 closed. All 10 ACs verified. M6 milestone marked closed.

Fault injection investigation completed (5 scenarios, `reconnect-cluster-findings.md`). Root cause of Scenario 5 (bootstrap null at laptop wake) documented as the priority item for M6B-018.

---

## Bugs Found and Rules Created

The complete bug log is in COORDINATION.md. The rules that were permanently added to `infra/CLAUDE.md` and `CLAUDE.md`:

### Infrastructure rules

**Never use `Default: ""` for a parameter that enables critical service behaviour.**
The health check deadlock (Day 4) was caused by `CELLO_DIRECTORY_MULTIADDR` having `Default: ""`, which made relay registration silently absent on fresh deployments.

**Never set a raw `/ip4/` address in any ECS task definition.**
All inter-service addresses must use DNS hostnames (`/dns4/`). A raw IP is a landmine that detonates on the next container replacement. This rule was violated on Day 2 when a manual ECS task def was created with a hardcoded private IP — it crashed the relay two days later when the directory task was replaced.

**The health check must reflect process liveness, not application readiness.**
ECS uses the health check to decide whether to keep the task running. Using it to gate on application state (registration complete, migrations current) causes deadlocks where ECS kills the task before it can complete the check.

**`purge_stale_dns_record()` must check CFN stack status before purging.**
Running unconditionally deletes records owned by a healthy stack. CFN compares against its internal state, sees no diff, and does nothing. Records stay gone.

### Debugging rules

**Log the underlying error, not just the label.**
`relay_unavailable` was the label. `EHOSTUNREACH to 10.0.85.235:4001` was the cause. One line of logging cost us multiple sessions. Every catch block must log `err.message`.

**Manifest fields must be populated at registration, not health-check time.**
`reSignManifestForRelay` only wrote `healthCheckUrl` on health state transitions. `multiaddrs` and `peerId` were never written. The relay registered once at startup — that is the moment to write all fields.

**Reject external diagnoses until independently verified.**
On Day 5, a pasted diagnosis (directory bound to 127.0.0.1 only) was accepted without independent verification and consumed 90 minutes before the real cause (hardcoded private IP in task def) was found. Continuation bias is real and expensive.

---

## Numbers

| Metric | Value |
|--------|-------|
| Stories merged | 17 |
| Stories open at close | 2 (M6B-015 ready, M6B-018 not written) |
| npm versions published | 0.0.25 through 0.0.42 (18 versions) |
| `@cello-protocol/connect` at close | 0.0.42 (`@latest`) |
| Flyway migrations shipped | V28 (GRANT UPDATE), V29 (session participants), V30 (email_stub_hash, channel_identities) |
| `client.ts` lines at start | 6,198 |
| `client.ts` lines at close | 594 (facade) |
| Total manager class lines (M6B-017) | ~5,600 across 11 files |
| Relay→directory root cause layers | 4 (no NAT, stale IP, missing manifest fields, startup-order dependency) |
| Days from first E2E attempt to success | 7 |

---

## What M6B Proved

Before M6B, CELLO had working protocol code that was operationally fragile. After M6B:

- Any new Claude Code session starts cleanly — no orphan processes, no lock file conflict
- The relay and directory are self-healing after restarts in either direction
- Session initiation doesn't require knowing which container a service is running in
- The S3 manifest is the single source of truth for relay addresses, always current
- Error messages tell operators what to do, not just what went wrong

M6B also completed the M6-E2E-001 close gate: the full stranger flow (install → register → exchange → seal) ran in under 5 minutes. The protocol works end-to-end against production infrastructure.

---

## What Remains

**M6B-015 — Rename operations-agent → portal-backend.**
Ready to implement. M6B-016 is deployed healthy. All IaC, source code, Secrets Manager paths, SSM parameters, ECR, IAM, CloudWatch, CodePipeline, buildspecs, and docs covered in the story YAML.

**M6B-018 — Signaling stream keepalive + reconnect.**
Investigation report complete (`M6B-018-investigation-report.md`) with revised scope:
1. Bootstrap retry on null at startup (~10 lines) — the Scenario 5 fix
2. Unconditional reconnect loop on signaling stream close (design already complete in the report)
3. Relay `onPeerDisconnect` → re-register with the directory (~15 lines, existing hook, existing method)
4. Ping/pong keepalive (lowest priority — infrastructure failures masked this as more urgent than it is)

Story YAML not yet written — depends on M6B-017 being fully wired (signaling call sites delegated to `SignalingManager`). That is now done.

---

## Related Documents

- [[user-stories/m6b/COORDINATION]] — full coordination log; 1,400 lines of real-time archaeology
- [[user-stories/m6b/outline]] — story breakdown, dependency graph, close gate
- [[user-stories/m6b/M6B-018-investigation-report]] — signaling keepalive design and revised scope
- [[milestone-writeups/M6-beta-launch]] — the post-mortem that M6B was built to address
- [[discussion_logs/2026-06-10_1856_reconnect-cluster-findings]] — fault injection investigation; Scenario 2 satisfies M6-E2E-001 AC-010
- [[discussion_logs/2026-06-10_2000_peer-reconnect-libp2p-primitives]] — AutoNAT/dcutr analysis; AutoNAT is an M7 concern
- [[discussion_logs/2026-06-06_2100_sovereign-node-networking-requirements]] — engineering analysis behind M6B-014
