---
name: Backward Compatibility and Upgrade Notification Strategy
type: discussion
date: 2026-06-03 16:00
topics: [backward-compatibility, versioning, upgrade-path, notification, automated-agents, protocol-versioning, deprecation, beta-readiness]
status: decided
description: >
  Design decisions for how CELLO handles breaking changes, version enforcement,
  and operator notification — with particular focus on the automated agent scenario
  where no human is watching. Defines three categories of change (security break,
  protocol addition, protocol mutation), the version negotiation contract, and a
  layered notification strategy.
---

# Backward Compatibility and Upgrade Notification Strategy

## Context

This log follows directly from [[2026-06-03_1146_beta-launch-brittleness-analysis]]. The
global install pattern (`npm install -g @cello-protocol/connect`, stable binary name) solves
the *mechanics* of upgrading. This log addresses what happens when users haven't upgraded —
how they find out, and how badly things break in the meantime.

Two problems, stated clearly:

1. **How do operators learn they need to upgrade?** Especially automated agents running on
   EC2 or GCP instances with no human actively watching.

2. **Can things degrade gracefully if they haven't upgraded?** Or does a breaking change
   immediately sever all connections from older clients?

These are separate problems with separate solutions. The automated agent scenario is the one
that makes both harder.

---

## The Notification Problem

### The structural advantage CELLO has

Most local tools have no notification channel — the binary runs offline and has no way to
reach back to the operator. CELLO is different: **the directory knows every registered agent,
and the client connects to the directory on every meaningful operation**. Version detection
can happen server-side, at connection time, and the warning can be injected into the response
of whatever operation the client was already attempting.

For Claude Code users this is close to ideal. A structured error response from
`cello_initiate_session`:

```json
{
  "ok": false,
  "reason": "client_outdated",
  "current_version": "0.0.22",
  "minimum_version": "0.0.30",
  "message": "Your CELLO client is outdated and cannot connect. Run: npm install -g @cello-protocol/connect@latest",
  "release_notes_url": "https://github.com/Mygentic-AI/cello-client/releases/tag/v0.0.30"
}
```

Claude Code's LLM reads this response and surfaces it in plain English. The tool response
*is* the notification, and the LLM is the delivery mechanism. No separate notification
channel needed for interactive Claude Code users.

### Telegram as a redundant channel for automated agents

For automated agents — the operator who set up 20 EC2 instances in January and moved on —
the tool response alone is insufficient because nobody is reading it. The Telegram bot has a
direct channel to the human who registered. When the directory detects an outdated client
version, it should trigger a one-time Telegram message to that agent's registered phone:

> "Your CELLO agent [ID shortened] is running an outdated version (0.0.22) and can no longer
> connect to the directory. Minimum required: 0.0.30. To upgrade: npm install -g
> @cello-protocol/connect@latest on the machine running the agent."

**Critical design constraint: once per agent per version floor, not once per call.** If every
`cello_send` triggers a Telegram message, operators get flooded and tune it out immediately.
The rule: send when `client_version < new_minimum_version` AND `last_notified_version <
new_minimum_version`. Once the notification is sent, suppress until the minimum version
increases again.

### Why the Telegram channel still has a gap

Some operators registered via Telegram because it was the required channel, never intend to
use Telegram again, and will not see the message. The notification strategy must be layered:

1. **Structured error on every API call** — captured by any log aggregator (CloudWatch,
   Datadog, PagerDuty). Even unmonitored systems eventually produce alerts on sustained errors.

2. **Telegram message** — reaches the human who registered; one message per agent per version
   floor.

3. **Process exit at EOL** — if the binary knows it is past its end-of-life version, it
   prints a clear error to stderr and exits with code 1. The EC2 instance's process supervisor
   (systemd, ECS restart policy) attempts restart, fails, and the "service has been down for
   N hours" alert fires from existing infrastructure monitoring. This converts a silent failure
   into a loud one.

4. **Directory dashboard / agent fleet status** (longer term) — a page showing every
   registered agent's last-seen timestamp, client version, and connection status. Operators
   can audit their fleet. Not required for beta but important before broader launch.

No single mechanism is reliable for the distracted operator. Together they are hard to miss.

---

## Three Categories of Change

Breaking changes are not all the same. The response to each is different.

### Category 1: Security breaks

**Examples:** Vulnerability that allows forging a session assignment, leaking K_local,
bypassing the pre-auth token gate.

**Policy:** Hard rejection, short window. When the directory detects a client version with
a known security vulnerability, it rejects the connection immediately with a structured error.
The deprecation window for security breaks is measured in days, not months. Graceful
degradation is not appropriate here — running a compromised client is worse than being
offline.

**Enforcement:** Directory maintains a `rejected_before_version` map per endpoint. Clients
below that version receive `{ reason: "security_vulnerability", ... }` and cannot proceed.

### Category 2: Protocol additions

**Examples:** New optional tool (`cello_request_more_disclosure`), new field in a response
that old clients ignore, new session feature that old clients transparently skip.

**Policy:** Fully backward compatible, no action required from operators. Old clients that
don't understand new fields ignore them. The directory accepts connections from both old and
new clients. This is the default for all non-security changes and should be the design goal
for every new feature.

**Design rule:** New fields are always optional with sensible defaults. New tool types are
announced in the tools list; old clients that don't call them are unaffected. The directory
never requires a new field that old clients don't send.

### Category 3: Protocol mutations

**Examples:** Renaming a field, changing a message's wire format, removing a deprecated
endpoint, changing authentication semantics.

**Policy:** Deprecation window — old behavior continues to work for a defined period while
new behavior is available in parallel. Then the old behavior is cut at a specific version
floor, with a well-publicized date. The window for non-security mutations is **30 days**
during the beta and early launch period.

90 days is the right number for mature software with enterprise customers who have change
control processes. At launch with a small user base, 30 days is sufficient and the
maintenance burden of running dual behavior for longer would actively slow development.
If user growth makes 30 days untenable, revisit. That's a good problem to have.

**Pattern:** The server supports both old and new behavior simultaneously during the window.
This is real engineering cost — it requires test suites that validate both old and new
behavior, which is significant overhead for a small team. 30 days limits the window in
which that overhead accumulates.

---

## Version Negotiation at Connection Time

The structural piece that makes all of the above work. When a client connects to the
directory, it announces its protocol version in the handshake. The directory responds with:
- The minimum version it accepts
- The current latest version
- Whether the client's version is deprecated (warning), at minimum (ok), or below minimum
  (rejected)

Client and directory then operate at the intersection of what both support. This is the same
model HTTP/2 used to coexist with HTTP/1.1 during the transition period.

**The client version is the binary version, not a separate protocol version number.** Keeping
one version number (the npm package version) as the authoritative identifier is simpler and
less prone to drift. The directory maps version ranges to capability sets.

---

## The Automated Agent Scenario in Full

The hardest case: an operator set up 20 agents on EC2 in January. It's June. A breaking
change was released in April. Nobody noticed. The agents are silently failing.

No single mechanism fully solves this. Layered:

| Layer | What it does | Reliability |
|---|---|---|
| Structured error in every API response | Captured by any log aggregator | High if any monitoring exists |
| Telegram notification | Reaches the human who registered | Medium — operator may not watch Telegram |
| Binary exits at EOL | Converts silent failure to loud crash | High if process supervisor + uptime alerting |
| Fleet status dashboard | Operator audits all agents | Requires operator to check proactively |

The binary-exits-at-EOL layer deserves emphasis because it works with existing infrastructure.
Every EC2 operator already has some form of "service is down" alerting — if not, they will
notice when their agents stop doing work. An agent that exits loudly is far better than an
agent that runs forever while silently failing every FROST ceremony.

---

## What This Means for the Upgrade Path Decision

The global install + binary name pattern ([[2026-06-03_1146_beta-launch-brittleness-analysis]])
is correct. Adding version negotiation and EOL enforcement to the binary requires no change
to the install mechanism — it's code inside `cello-mcp.ts` that checks `currentVersion`
against whatever the directory advertises at connection time.

The sequence for a breaking change release:

1. Directory begins advertising `minimum_version: X.Y.Z` in the version negotiation handshake
2. Directory begins injecting `client_outdated` warnings into responses from clients below X.Y.Z
3. Directory triggers Telegram notifications to agents below X.Y.Z (once per agent)
4. At EOL date: directory rejects connections from clients below X.Y.Z
5. Binary at version below X.Y.Z begins printing EOL warning and exiting on startup (this
   requires the binary to know its own EOL — either hardcoded at build time or fetched from
   the directory before starting)

Steps 1–3 are the deprecation window. Step 4 is enforcement. Step 5 is belt-and-suspenders
for agents that lost directory connectivity entirely.

---

## Decided Policy

All policy questions are resolved:

- **Deprecation window:** 30 days for protocol mutations during beta and early launch. Revisit
  only when user growth makes it a real constraint.

- **EOL behavior:** Always exit with code 1. No degraded operation. See the reasoning above —
  a crashed process generates an alert; a silently degraded process generates confusion.

- **Version floor granularity:** Global minimum version. One number, one policy, applies to
  all operations. Per-endpoint granularity adds maintenance overhead and testing burden with
  no benefit at current scale. The multi-directory FROST cutover (Stream 3) is a named
  exception — treated as a major version bump with its own pre-announcement, not handled via
  per-endpoint logic.

- **Who controls the version floor:** Andre controls it, full stop. No consortium governance
  question exists at this stage. One day it may become shared infrastructure, but that
  decision is years away and should not be designed for now.

- **Notice period:** Minimum 30 days, with case-by-case extension for genuinely large changes.
  30 days for a wire format rename. Potentially 60 days for the multi-directory FROST cutover
  that requires every agent to re-register. Andre decides what warrants more — there is no
  fixed formula. Two-stage: pre-announcement at T-30 (Telegram + GitHub release notes), then
  enforcement notification at T-0 for agents that still haven't upgraded.

- **Security break classification rule:** If the old behavior is exploitable by a third party
  acting with correct protocol intent, it is a security break (days window). If the risk only
  materializes through active malice by one of the two parties or internal protocol failure,
  it is a mutation (30-day window). When in doubt, classify as security break.

- **Security breaks as a bundling opportunity:** A security break creates the one moment users
  accept mandatory upgrade friction. Bundle aggressively — any non-security changes that are
  near-ready should be accelerated into the same release. Users upgrade once, get everything,
  and the dual-behavior maintenance burden for multiple pending changes collapses simultaneously.
  This requires a fast release process; the Stream 1 reliability work (faster deploys) is a
  prerequisite for doing this well under time pressure.

---

## Related Documents

- [[2026-06-03_1146_beta-launch-brittleness-analysis]] — upgrade mechanics (global install
  pattern), connection resilience, infrastructure brittleness
- [[CONTEXT]] — canonical glossary; agent identity, session, registration definitions
- [[M6-beta-launch]] — M6 write-up; DX issues including F-002 (SQLCipher compile timeout)
  and the stale-process DB lock deadlock that makes version-pinned npx unworkable
