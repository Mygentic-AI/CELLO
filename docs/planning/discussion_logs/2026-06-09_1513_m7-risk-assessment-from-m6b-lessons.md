---
name: m7-risk-assessment-from-m6b-lessons
type: discussion
date: 2026-06-09
topics: [m7, multi-agent, risk-assessment, libp2p, sqlcipher, retry-queue, nonce, integration-gate, infrastructure-prerequisites]
status: complete
description: >
  Risk assessment for M7 (Multi-Agent MCP Server) drawn from the M6/M6B failure
  patterns. Covers the strategic question of whether to continue or rewrite, the
  decision to continue, and a category-by-category analysis of what M7 is likely
  to hit based on what M6B actually taught us.
---

# M7 Risk Assessment — Lessons from M6 and M6B

## Background

This discussion happened on 2026-06-09, during the final days of M6B. AC-005
(`cello_initiate_session` returning `ok: true`) had just been resolved after
six days of layered infrastructure failures. AC-006 (sealed receipt) was still
in progress.

The question that prompted this session was strategic: **is the methodology
wrong?** After six days of cascading failures, each fix revealing the next
layer, the concern was whether we were falling into the sunk cost fallacy —
clinging to a process-heavy methodology (discussion logs → architecture docs →
user stories → coders → reviewers) when a greenfield rewrite might be faster.

---

## The Strategic Question

The specific failure pattern in M6B was not random:

- Every time one problem was fixed, it revealed the next
- Five distinct failure layers: NAT gateway → stale relay IP → SIGTERM race →
  relay multiaddr missing from manifest → relay_auth_error
- Each layer hid the one below it because the same error codes surfaced for
  multiple underlying causes (`directory_below_threshold` was the canonical
  example from earlier milestones; `relay_unavailable` played the same role
  in M6B)
- 1,500+ USD in token costs, four to five days of work, not yet at the point
  M6 had reached (M6 could connect and conduct a session, M6B couldn't even
  initiate one for most of its duration)

The concern: continuation bias. Sticking to methodology not because it's
working, but because abandoning it feels like admitting failure.

---

## The Decision: Continue

After reading the full planning corpus (end-to-end-flow.md,
server-infrastructure.md, protocol-map.md, brittleness analysis, M6B
coordination log, M5 retrospective), the conclusion was: **the architecture is
sound, the failures were operational, and a rewrite would reproduce the same
problems**.

Key evidence:

1. The brittleness analysis (`2026-06-03_1146`) had already diagnosed both root
   causes precisely before M6B began: location-based addressing (ECS Fargate
   changes IPs on every restart) and permanent connection assumption (streams
   assumed never to drop, no keepalive, no reconnect).

2. Every M6B failure had a specific root cause and a specific fix. These were
   not architectural — they were operational failure modes invisible until real
   multi-process deployment in production.

3. A greenfield rewrite would rediscover NAT gateway requirements, TCP idle
   timeouts, ECS IP instability, and SQLCipher lock contention. These are
   properties of the deployment topology, not this codebase.

4. AC-005 resolved at 09:22 UTC after the relay multiaddr fix. The system
   works. It just required clearing every layer of the infrastructure stack
   before the protocol layer was visible.

The sunk cost framing was also examined: continuation is only sunk-cost
reasoning if the future expected value is negative. With documented root
causes, specific fixes in flight, and a close gate that lists exactly what
needs to pass, the future expected value is positive.

---

## M6B Failure Pattern Summary

Before assessing M7 risks, the M6B failure patterns were catalogued as the
baseline:

**Root cause 1: Location-based addressing.** Every service stored the IP of
the last-seen peer. ECS Fargate doesn't have stable IPs. Any restart silently
breaks everything pointing at the old IP. The libp2p error was swallowed
(`[object Object]`) and the label `relay_unavailable` was all that was visible.

**Root cause 2: Permanent connection assumption.** Streams assumed forever-open.
TCP idle timeouts (~2 minutes) killed them silently. No keepalive, no liveness
check before use, no automatic reconnect.

**Secondary patterns:**
- State that must survive a restart (FROST signer context, agent profiles) not
  restored on cold start — invisible until production restart
- Uint8Array/JSON.stringify corruption — byte arrays serialized as
  `{0:1,1:2,...}` objects, silently wrong until used in a ceremony
- Error codes that cover multiple root causes (the `directory_below_threshold`
  pattern) making logs misleading
- Manual AWS fixes that never made it back into IaC, causing failures to
  resurface in the next deploy

**The AI coder failure mode:** Solves the immediate problem, passes tests in
a single-process environment, closes the story. Structural constraints that
only appear across process boundaries or after restarts are invisible. This
isn't a flaw in the process — it's a known limitation that requires
cross-process integration tests as first-class story artifacts.

---

## M7 Risk Assessment

M7 was read in full (outline.md + all 8 MULTI-*.yaml stories) before producing
this assessment.

### Category 1: Day-1 blockers

**Multiple libp2p nodes, one process — port binding**

Each CelloClient in MULTI-002 gets its own libp2p node. Each node tries to
listen on a port. The existing code almost certainly has a default or hardcoded
listen address. The second agent will try to bind the same port and fail. This
won't appear in any single-agent test. It will be the first thing that breaks
when MULTI-002 tries to start two agents simultaneously.

**SQLCipher schema not multi-agent-aware**

The current schema was designed for one agent per process. Tables like
`agent_key_shares`, `active_sessions`, and anything keyed by agent pubkey live
in one shared DB. If two agents share one SQLCipher file without explicit
partitioning, state from one agent is visible to another agent's queries. Same
class of bug as the cold-start FROST failure — invisible in single-agent
testing, fatal at the integration gate.

### Category 2: Framework fit problems

**MCP per-connection state**

Tool handlers in the MCP SDK are registered globally, not per-connection. The
`cello_use_agent` switching model (MULTI-003) requires knowing which connection
called a tool. The SDK may not expose connection identity cleanly through the
tool handler interface. This is the kind of architectural mismatch where the
design looks clean but the framework doesn't cooperate. Discovered when MULTI-003
tries to route by connection and finds the routing it assumed doesn't exist.

### Category 3: Silent failures that look like different bugs

**libp2p PeerId → K_local pubkey resolution on reconnect**

`peer:connect` gives a libp2p PeerId, not a CELLO pubkey. Resolving that to
a CELLO identity requires the CELLO identification exchange to have completed.
On reconnect, if the exchange hasn't re-run, the `peer:connect` event fires
for a PeerId that can't be mapped to a session owner. The retry queue won't
know whose queued messages to drain. Symptom: "retry queue not draining."
Cause: unresolved PeerId.

**Nonce serialization (the Uint8Array pattern again)**

Nonces are 32 bytes — same type as everything that hit the
Uint8Array/JSON.stringify corruption bug in M6. If the signed envelope wrapper
serialization path hasn't been audited for the same issue, retried messages
will arrive with corrupted nonces and the dedup set will miss them, silently
allowing duplicates. This won't fail loudly — it will fail as "occasional
duplicate messages" under load.

**Directory handling N signaling streams from one process**

Each CelloClient connects independently to the directory. The directory
currently associates one signaling stream per agent pubkey. Two agents from
the same IP connecting simultaneously may hit rate limiting, or the directory
may silently drop the second stream while returning a healthy response. Symptom:
agent B is "online" but never receives anything.

### Category 4: Infrastructure prerequisites

The outline documents two prerequisites for MULTI-008 that must land before
any integration testing:

1. `/agent-lookup` ALB routing rule missing — `cello_request_connection` and
   `cello_initiate_session` with agent_id format will fail until this is deployed.
2. `cello_service` missing `UPDATE` on `agent_profiles` — new agent registrations
   in production will not have `account_id` linked.

The M6B pattern: both are written down, both will be forgotten until they block
a test. Both require a directory deploy (25-30 minutes per region). If not done
before testing begins, MULTI-008's first run fails on agent resolution, not
on any M7 code.

### Category 5: Integration gate complexity

MULTI-008's "simulated network disruption" is the hardest test in M7. It requires:

1. Forcing a libp2p connection closed
2. Verifying `peer:disconnect` fires
3. Messages going to queue
4. `peer:connect` firing on reconnect
5. Queue draining in order
6. Receiver deduplicating correctly

Each step has a failure mode. In M6B, AC-005 + AC-006 surfaced five distinct
bugs and took six days. MULTI-008 is structurally more complex. It should be
treated as the expensive story and given its own diagnostic budget.

---

## Recommendations Before Dispatching Any M7 Coder

1. **Verify libp2p listen address configurability** — before writing MULTI-002.
   Is it hardcoded or configurable? If hardcoded, the multi-node architecture
   requires a change before the first story can pass.

2. **Audit SQLCipher schema for agent-level partitioning** — before MULTI-002.
   Every table needs to be checked: is it keyed by agent pubkey, or is it
   implicitly single-agent?

3. **Deploy infrastructure prerequisites** — before anything:
   - `/agent-lookup` ALB routing rule
   - `GRANT UPDATE ON agent_profiles TO cello_service` (V28 migration)

4. **Verify Yamux keepalive is configured and firing in production** — before
   MULTI-005. The presence detection story depends on these events actually
   arriving. If they're emitted but misconfigured, MULTI-005 will pass in
   isolation and MULTI-006 (retry queue drain) will fail at the integration
   gate — exactly the M6B pattern.

---

## Related

- [[2026-06-03_1146_beta-launch-brittleness-analysis]] — root cause diagnosis
  that predicted the M6B failures
- [[2026-05-25_1100_m5-retrospective-lessons-learned]] — M5 rules that inform
  M7 approach
- [[2026-06-09_AC005-postmortem]] — the specific failure chain that AC-005
  resolved after six days
