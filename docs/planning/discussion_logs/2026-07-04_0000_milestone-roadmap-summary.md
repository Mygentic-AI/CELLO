---
name: CELLO Milestone Roadmap Summary
type: discussion
date: 2026-07-04
topics: [roadmap, milestones, M1-M8, summary, outcomes]
status: active
description: Short outcome-focused summaries of M1–M8 (closed) and M8B (in progress). Framed as capabilities gained, not features shipped. Suitable for public visibility and GitHub roadmap.
---

# CELLO Milestone Roadmap — M1 Through M8B

## Completed Milestones

**M1 — Session Verifiability**
Every conversation produces a tamper-evident receipt. Either party can prove which messages happened, in order, and that nothing was added or deleted — without trusting the relay or directory.

**M2 — Unforgeable Receipts**
A single compromised directory node cannot forge a session boundary. Both the agent and at least t-of-n directory shares must participate. A receipt cannot exist without threshold consensus.

**M3 — Negotiated Trust**
Strangers can discover and negotiate before entering a session. Agents enforce connection policy: accept/reject/require disclosure. Strangers become known contacts through a two-round ceremony.

**M4 — Durable, Tamper-Evident Data**
Sessions survive process crashes, relay failures, and one-sided delivery gaps. All data is hash-chained: any tampering or deletion is detectable. Key shares are encrypted at rest.

**M5 — Multi-Region Infrastructure**
CELLO runs on three independent cloud regions simultaneously, each with its own database, relay, and directory node. No single region outage stops the network.

**M6 — Installable & Public**
`npm install @cello-protocol/connect` — operators can run CELLO locally without touching servers. The beta directory accepts registrations via Telegram bot. Public-facing agent-to-agent communication is live.

**M6B — Operational Stability**
No more orphaned processes, stale addresses, or cascading restarts. The relay self-heals after task replacement. The directory reaches the relay immediately after any restart. Error messages tell operators what to do.

**M7 — Daemon Architecture & Content Durability**
A long-running daemon replaces per-session client processes. Agents persist across Claude sessions. Content delivery is reliable: offline parties receive missed messages when they reconnect. Unilateral seals (when one party disappears) are cryptographically notarized. The absent party can ratify and upgrade to bilateral seals when they return.

**M8 — Operator Control Portal**
A web console where operators see their live agents, manage trust signals (WebAuthn + TOTP), and have a single panic button: suspend (freezes signing federation-side) or burn (permanent revocation, binding preserved).

## In Progress

**M8B — Federation & T-of-N** (started 2026-06-29)
Remove the mandatory single directory node. Multiple independent directory nodes co-sign via real T-of-N FROST, with the client as coordinator. Eliminate the same-region pin between directory and relay: clients choose any relay and present a FROST-signed assignment. Replicate agent presence and WebAuthn pickups across all directory nodes so agents owned by one region aren't offline to others. No ceremony requires all nodes—quorum refusal becomes meaningful.

**M9** (planned)
Details to follow as M8B closes.

---

## Related Documents

- [[M0-peer-to-peer-walking-skeleton]] — M0 proved peer-to-peer transport and signing
- [[M1-session-layer]] — M1 proved sessions are verifiable (Merkle hash relay model)
- [[M2-frost-threshold-layer]] — M2 proved threshold signing prevents forgery (FROST)
- [[M3-connection-policy-and-registration]] — M3 proved strangers can negotiate policy
- [[M4-persistence-foundation]] — M4 proved sessions are durable and tamper-evident
- [[M5-infrastructure-deployment]] — M5 proved multi-region infrastructure works
- [[M6-beta-launch]] — M6 proved installable client and public beta
- [[M6B-beta-hardening]] — M6B proved operational stability
- [[M7-daemon-architecture]] — M7 proved daemon model and content durability
- [[M8-operator-portal]] — M8 proved operator control portal with ceremony gates
- [[M8B-SPEC]] — M8B federation spec: T-of-N spine, any directory, any relay
- [[M8B-DEFINITION-OF-DONE]] — M8B yardstick for federation
- [[M8B-PROCEDURE]] — M8B runbook
