---
name: Beta Launch Brittleness Analysis — Root Causes and Remediation Path
type: discussion
date: 2026-06-03 15:00
topics: [infrastructure, brittleness, libp2p, peer-routing, connection-resilience, MCP, upgrade-path, sovereign-nodes, beta-readiness, architecture]
status: decided
description: >
  Post-M6 structural analysis of why the system is brittle under normal operational
  events (deploys, restarts, version bumps). Traces two root causes — location-based
  addressing and permanent-connection assumptions — through specific evidence from the
  M6 write-up, commits, and code. Defines three work streams for remediation and
  gives an honest assessment of beta readiness.
---

# Beta Launch Brittleness Analysis — Root Causes and Remediation Path

## Context

This log was written at the close of M6-E2E-001 verification, after roughly 72 hours of
continuous E2E testing produced ~108 commits (40 in the last 72 hours, 260+ across M6 total).
The question being answered: why does every deploy or version bump create a cascade of manual
interventions, and what is the right level of abstraction to fix it?

The M6 write-up documents the specific failures. This log is the structural analysis: what
pattern connects them, and what would have to be different for them not to recur.

---

## The Two Root Causes

### Root Cause 1: Services are addressed by location, not by identity

Every CELLO service is addressed by IP address or IP-embedded multiaddr. This is the single
source of most of the brittleness documented in M6.

**How it works today:**

- The directory is addressed by its ALB DNS name. Stable — ALB is the one thing that doesn't
  change IP on restart.
- The relay is addressed by its task's private IP. ECS Fargate does not have stable IPs. Every
  restart produces a new task with a new private IP.
- The client stores `CELLO_DIRECTORY_MULTIADDR` containing the directory's peer ID baked in
  at install time.
- The relay manifest in S3 stores `healthCheckUrl` as a direct task IP.
- The directory stores `CELLO_RELAY_MULTIADDR` as an env var in the ECS task definition —
  IP + peer ID of the relay at the time of last manual update.

**What breaks when anything restarts:**

Every service restart breaks every pointer that encoded the old IP. Since peer IDs were also
not persisted until mid-M6, every restart also changed the peer ID, making even stable DNS
names insufficient because clients validate the peer ID in the multiaddr.

This is not a theoretical concern. From the M6 write-up:

> **Relay manifest staleness (Infrastructure Brittleness section):** "Relay manifest
> `healthCheckUrl` contained `http://10.0.117.145:4000/health`, broke when relay redeployed
> May 28. Fixed by re-signing manifest with new IP `10.0.21.210:4000`."

> **Relay transport key not persisted (Infrastructure Brittleness section):** "Every relay
> redeploy generates a fresh transport key and therefore a new libp2p peer ID. The directory's
> `CELLO_RELAY_MULTIADDR` env var and the relay manifest `healthCheckUrl` both encode the
> old IP+peer-ID and break immediately. Observed twice during M6 E2E testing; required manual
> manifest re-sign + directory task def update + directory restart each time."

> **Directory loses all agent profiles on restart (F-011):** "After any restart, every
> previously registered agent is invisible." — `target_not_found` for the demo agent
> after the directory service was recreated.

The relay transport key fix landed in commit `5308958` (`feat(relay): persist transport key
via Secrets Manager`) and `9beed74` (`feat(relay): add CELLO_RELAY_WS_LISTEN_ADDR`). The
directory transport key fix was earlier (`cello/dev/directory/transport-key` via Secrets
Manager). These are correct partial fixes — they stabilize peer IDs so at least the identity
doesn't change on restart. But they don't fix the IP problem. A relay with a stable peer ID
and a new IP still breaks every other service that cached the old IP.

**The deeper architectural issue:**

CELLO uses libp2p. libp2p was designed precisely to solve this problem. A libp2p peer is
identified by its peer ID (derived from its keypair). Its location (multiaddr, IP) is
*discovered separately* via peer routing — the Kademlia DHT, mDNS, or a bootstrap node.
The peer ID is stable; the location is a runtime fact that the network knows.

Right now CELLO uses libp2p for transport and crypto (Noise XX, stream multiplexing,
protocol negotiation) but it bypasses the peer routing layer entirely. Service addresses
are distributed as static configuration: env vars baked into ECS task definitions
(`CELLO_RELAY_MULTIADDR`, `DIRECTORY_INTERNAL_URL`), S3 manifest files, compiled-in
defaults (`http://directory-us1.cello.mygentic.ai`), and the `claude mcp add cello ...`
command line.

This is the architectural mismatch at the root of the problem. The transport layer is
peer-to-peer; the addressing layer is client-server.

**What sovereign nodes should look like operationally:**

A directory node restarts. It has a stable keypair (and therefore a stable peer ID, now
that Secrets Manager backing is in place). When it comes up, it announces its new IP to
the DHT using that stable peer ID. The relay, which tracks the directory by peer ID, does
a routing lookup: "where is peer 12D3KooW...?" — gets the new IP back from the DHT —
reconnects. The clients do the same. The relay manifest becomes unnecessary because the
relay's location is a live DHT fact, not a static document.

This is M8/M9 scope work. But it eliminates an entire class of operational burden that will
not go away with point fixes.

---

### Root Cause 2: Connections are treated as permanent

Every stream opened by CELLO is implicitly assumed to remain open and usable. No keepalive,
no liveness check before use, no automatic reconnect, no process exit on permanent loss.

This assumption fails silently in production wherever TCP or WebSocket idle timeouts apply —
which is everywhere after ~2 minutes of stream inactivity.

The evidence from M6 is exhaustive:

**Seal ceremony blocked (AC-006, M6 write-up):**

> "The SEAL frame sent from the demo agent over the signaling stream went into a dead
> connection silently. The directory never received it, never sent `seal_verified`, and the
> demo agent's 15-second `seal_verified` wait timed out → `seal_deferred`."
>
> "The drop was not random. During message exchange (steps 4–8), the demo agent was
> communicating entirely with the relay via P2P content delivery. The signaling stream to the
> directory was idle for ~2 minutes. The underlying TCP/WebSocket connection was killed
> (likely by an intermediate network device or the libp2p layer detecting a stale connection),
> and nothing detected or recovered from this."
>
> "None of the `[CLIENT-DEBUG]` lines from `frost-threshold-signer.ts` appear — the FROST
> ceremony never started."

This is the most direct example. The code in `client.ts` `closeSession()` sends the SEAL
frame and awaits `seal_verified`, but never checks if `#persistentSignalingStream` is still
alive. The pattern for reconnect already exists at lines 1795–1800 in `initiateUnilateralSeal`
— it just wasn't applied to `closeSession`. Fix 1 documented in the write-up is: check stream
liveness, reconnect if needed, then send. Fix 2: retry `seal_deferred` after reconnection.

**Stale MCP process / SQLCipher DB lock deadlock (M6 write-up):**

> "The long-running cello-mcp process loses its libp2p connection to the directory after
> hours of uptime. It continues running but is functionally dead (`directory_reachable: false`,
> FROST ceremonies fail). It does NOT exit — no crash, no timeout, no self-restart. The
> process keeps the SQLCipher DB file exclusively locked."
>
> "When `/mcp` reconnects, the new cello-mcp process opens SQLCipher at startup. SQLCipher
> holds a write lock; the stale old process holds the same lock. The new process waits —
> startup time balloons from 2–3s to 20–40s. Claude Code's 30-second MCP connection timeout
> fires before startup completes."
>
> "Observed sequence (2026-06-03): Session started ~03:30 UTC; cello-mcp process uptime grew
> to 14,000+ seconds."

The stale process had been running for ~4 hours with a dead directory connection, invisible
to the user, preventing any new process from starting. `pkill -f cello-mcp` resolved it in
3 seconds. The fix is two parts: (a) the MCP server should exit (code 1) when the directory
connection drops permanently after N reconnect attempts, and (b) SQLCipher WAL mode so a new
process can at least start its read-heavy startup while the old process's write lock is still
held.

**Signaling stream drop — agents go silent after directory restart:**

> "When the directory restarts, every connected agent's signaling stream drops. The agents
> don't automatically reconnect. Result: agents are invisible to connection requests and
> session initiation silently fails with `target_offline`. Requires manual restart of each
> agent service."

The demo agent's `Restart=on-failure` systemd directive handles process crashes. A silent
stream drop without a crash doesn't trigger it. The process is alive; it just can't do
anything. The permanent fix requires the MCP server to detect the dead stream (via keepalive
ping) and exit so the OS restarts it. This is the same fix as the DB lock issue —
one fix addresses both.

**FROST signer missing bootstrap context after restart (M6-DX-001, AC-003):**

A subtler version of the same root cause. After the process exits and restarts,
`loadPersistedState()` constructs `FrostThresholdSigner` with `directoryNodes: undefined`.
The signer can verify signatures but cannot route ceremony frames back to the directory.
This went undetected because all tests run within a single process lifetime — the restart
boundary was never exercised. Commit `0.0.14` fixed the immediate issue, but the underlying
pattern — "this object was constructed correctly in one process, but its internal state that
came from live connections isn't re-established in the next process" — is a recurring failure
mode.

---

## The MCP Upgrade Experience Is a Third, Separate Issue

The `claude mcp remove cello / claude mcp add cello -- npx --yes @cello-protocol/connect@X.Y.Z`
workflow is separate from infrastructure brittleness. It's the result of three combined decisions:

1. **Version pin in the install command.** `@cello-protocol/connect@0.0.22` means the user
   owns the version. Upgrading requires remove + re-add with the new version number.

2. **SQLCipher write lock on the old process** (see Root Cause 2 above). Even if remove/re-add
   weren't needed, the old process holds the DB lock and blocks the new one.

3. **30-second MCP timeout.** SQLCipher native compilation takes 20-40 seconds on first
   install on some platforms. Even after the lock issue is resolved, a platform that hits
   this timeout will appear permanently broken.

The correct end state for upgrades is: drop the version pin (use `npx @cello-protocol/connect`
without a version), fix the DB lock via WAL mode + process exit on dead connection, and the
upgrade path becomes: `/mcp reconnect`. No remove, no re-add, no terminal command.

Claude Code does have a built-in "update MCP server" flow, but it only works for registered
MCP configurations, not ad-hoc `npx` invocations. The current install command format:
`claude mcp add cello -- npx --yes @cello-protocol/connect@0.0.22` is not compatible with
that flow. A version-unpinned install would be.

---

## Why the Individual Fixes Didn't Change the Underlying Model

M6 produced dozens of correct individual fixes. Every fix in the write-up is accurate.
But looking at the pattern:

- Commit `5308958`: relay transport key → Secrets Manager. Correct. Stabilizes peer ID.
  Doesn't fix IP-based addressing.
- Commit `40543d5`: relay SG port 4001 from directory. Correct. Fixes one missing network rule.
  Still assumes static topology.
- Commit `bf4c24b`: update `CELLO_RELAY_MULTIADDR` in directory task def to current relay
  peer ID. Correct for today. Will break again on next relay redeploy.
- Commit `b526ce0`: read `EXPECTED_MIGRATION_VERSION` from env. Correct. Eliminates one
  code-change-per-migration. Still hardcoded in IaC.
- Commit `1a21b65`, `272eb34`: Uint8Array preservation through JSON. Correct. Fixes a
  latent corruption bug.
- `loadProfiles()` on startup (F-011, M6-DX-001 AC-010). Correct. Fixes one in-memory-only
  structure. There are ~15 such structures in `PgDirectoryStore` — the write-up notes this
  explicitly: "A full audit story is needed post-M6."

The pattern: each fix patches the specific symptom encountered. None of them addresses the
class of failures. After all these fixes, the next relay redeploy will still require updating
`CELLO_RELAY_MULTIADDR` in the directory task def. The next version bump will still risk the
DB lock deadlock until WAL mode and process exit are implemented. The next idle session will
still risk seal failure until the stream keepalive lands.

This is not a criticism of the fixes — they were correct and necessary. It's an observation
about leverage. The structural changes (libp2p peer routing, keepalive + exit on dead
connection, WAL mode) each eliminate an entire class of failures rather than one instance.

---

## The FROST DKG Gap as a Process Failure of the Same Class

The single-directory FROST implementation (`participants: 1, threshold: 2` at
`packages/directory/src/directory-node.ts:1463`, introduced in commit `9b7ed86`, May 11 2026)
is a different category of problem — correctness, not reliability. But it exemplifies the
same pattern: an AI coder solved the problem in front of them (make the FROST DKG compile and
pass tests with the infrastructure available at M3) without raising the structural constraint
(AC-006 requires 3 directory nodes; only 1 exists) as a blocker.

The write-up puts it plainly:
> "the coder could not have satisfied AC-006 with what existed, and the correct response was
> to raise it as a blocker requiring a deferral decision. Instead the constraint was silently
> reduced to the minimum the library would accept, the tests passed, and the story was reviewed
> and merged."

The operational consequence: three sovereign directory nodes running at ~$156/node/month
(~$470/month) under the assumption they were collectively producing federated FROST
guarantees. The infrastructure cost is not wasted entirely — the three nodes serve federation
and checkpoint cross-signing. But the core sovereign node property has never been delivered
for any registration or session ceremony in the system's history.

The fix requires milestone-scoped work touching registration, session establishment, seal,
K_server_X storage, and client orchestration. It is not blocking beta if "beta" means a
small group of developers testing the protocol. It is blocking any public claim about
sovereign FROST ceremonies.

Process change: `cello-sprint` now requires raising a blocker when the environment cannot
satisfy an AC's structural contract. `cello-review` now verifies implementation constants
against AC-specified structural values. See commits `dee781c` and `ea72180`.

---

## The Three Work Streams

These are distinct and should not be collapsed into one milestone.

### Stream 1 — Connection Resilience (Blocking for any beta)

All fixes to existing code; no architectural change required. This is what separates
"breaks every deploy" from "self-heals in seconds."

- **Signaling stream keepalive + reconnect:** 30-second ping on `#persistentSignalingStream`.
  On missed pong after N attempts: attempt reconnect with exponential backoff. On permanent
  loss: exit(1) so the OS/ECS restarts the process. Every current silent-drop failure goes away.

- **Exit on permanent directory connection loss:** Same pattern for the MCP binary.
  A dead cello-mcp process that holds the DB lock and can't be restarted is worse than a
  crash. Exit cleanly; let Claude Code restart.

- **SQLCipher WAL mode:** Concurrent readers while one writer is active. New process startup
  is read-heavy; WAL mode lets it complete startup even if the old process still holds a write
  transaction. Eliminates the deadlock window.

- **Relay auto-registers on startup:** Relay dials directory at startup and calls
  `relay_register` regardless of whether `CELLO_RELAY_MULTIADDR` is set. When registration
  succeeds, directory re-signs and re-uploads the manifest automatically.

- **`RelayPoolManager` polls S3 periodically:** No directory restart needed when manifest
  updates.

- **All IaC that was manually created during M6 E2E testing committed and deployed:**
  `/agent-lookup` ALB rule, port-8081 internal API target group, ALB SG ingress rule for
  port 8081. Currently exist as manual AWS resources only (noted in write-up: "NOT in IaC").

- **Drop version pin from install command:** `npx @cello-protocol/connect` without a version.
  Always fetches latest beta. Upgrade path becomes `/mcp reconnect`.

### Stream 2 — Libp2p Peer Routing (M8/M9)

Replace manual/static addressing with DHT-based peer discovery. Services track each other
by peer ID; location is a live network fact.

- All services announce to a shared bootstrap/DHT node at startup.
- Client resolves directory by peer ID, not by compiled-in DNS.
- Relay resolves directory by peer ID, not by `CELLO_RELAY_MULTIADDR`.
- Relay manifest becomes a fallback for new clients with no existing peer table, not the
  primary routing mechanism.

This eliminates the class of "service redeployed, all pointers to it broke" failures
permanently. Design story required first.

### Stream 3 — Multi-Directory FROST (Milestone-scoped, parallel track)

Design story first specifying: `dkg_ready` frame extension, client-side N-stream DKG
orchestration, directory-to-directory round-2 share exchange mechanism, K_server_X split
storage, quorum-based session and seal ceremonies, failure mode definitions. See
[[2026-06-03_1200_frost-dkg-single-directory-gap]] for the full scoping.

---

## Beta Readiness Assessment

The current system can support ~10 developers who will tolerate manual intervention when
something breaks and have a direct channel to report issues. It cannot support beta users
who are not developers — because a version bump or directory deploy will produce invisible
failures with no self-recovery and no user-visible explanation.

The specific table:

| Event | Current behavior | After Stream 1 |
|---|---|---|
| Directory redeploys | Relay breaks, all agent profiles lost, need manual restart of all agents | Agent profiles survive (loadProfiles), agents reconnect automatically |
| Relay redeploys | Directory RELAY_MULTIADDR stale, session initiation fails, need manifest re-sign + directory restart | Relay re-registers on startup, manifest auto-updates |
| cello-mcp process goes stale | New session gets 30s timeout, need `pkill -f cello-mcp` | Stale process exits on dead connection, Claude Code restarts it |
| cello-mcp version bump | Remove + re-add + sometimes pkill | `/mcp reconnect` |
| Seal ceremony during idle session | `seal_deferred`, no recovery | Stream liveness check + reconnect before seal |

After Stream 1, the system is deployable to a developer beta: users who install it once and
have it work through normal operational events without manual intervention.

After Stream 2, the system is deployable to a non-developer beta: no configuration required
beyond `claude mcp add cello npx @cello-protocol/connect`, and no manual intervention
required when any CELLO infrastructure changes.

After Stream 3, the positioning claim is fully true. Until then it's directionally accurate
but not technically complete.

---

## On Iteration Penalty and the AI Coder Pattern

M6 produced ~260 commits. Many of them are fixes for issues introduced by the previous fix.
The write-up catalogues this honestly: OPS-AGENT-002 required 3 sprint-reviewer passes and 3
code-reviewer passes. REPOSPLIT-002 required 2 BLOCKED sprint-reviewer results before
APPROVED. PERSIST-024 required 7 code-review passes. 

The AI coder pattern is: solve the immediate problem, pass the tests, close the story. This
is excellent for implementation speed on well-specified stories. It is a liability for
structural constraints — like "the system must be addressable by identity, not location"
or "connections are ephemeral, not permanent" — because those constraints don't show up as
failing tests in a single-process test environment. They show up at 03:30 UTC when a cello-mcp
process has been running for 14,000 seconds and Claude Code can't reconnect.

The lesson is not to write longer acceptance criteria. It's to make the structural invariants
visible at test time: integration tests that restart processes, that simulate relay redeploys,
that exercise the DB lock scenario. Tests that cross process boundaries are the class of test
that would have caught every persistent bug found in M6 E2E. They were not required by any
story. The post-M6 missing integration test list in the write-up names exactly four:

1. DKG → restart → session initiation (would have caught cold-start shares AND Uint8Array serialization)
2. Notification delivery to offline agent (Uint8Array corruption in notification_queue)
3. Ops-agent after directory redeploy (DIRECTORY_INTERNAL_URL breakage)
4. Schema version bump — ops-agent startup

All four cross a process or deployment boundary. None were written. These should be a
first-class story type going forward: **restart invariant stories** that exist solely to
prove a specific cross-boundary property, not to deliver new features.

---

## Related Documents

- [[M6-beta-launch]] — full M6 write-up with per-story evidence for every bug mentioned here
- [[2026-06-03_1200_frost-dkg-single-directory-gap]] — multi-directory FROST scoping
- [[2026-06-01_1600_m6-dx-issues-and-resolutions]] — DX issue list from E2E-001 session
- [[2026-05-16_0753_development-pipeline-and-local-iteration]] — adapter pattern decisions; the test isolation choices that made cross-boundary bugs harder to catch
- [[CONTEXT]] — canonical glossary; sovereign node definition
