---
name: A2A Interoperability and Strategic Positioning
type: discussion
date: 2026-05-13 20:44
topics: [competitive-strategy, A2A, Google, interoperability, identity, FROST, positioning, bridge, transport]
description: Strategic stance on Google's Agent2Agent protocol — CELLO does not adopt A2A's format or identity model. Instead, CELLO provides an A2A bridge that makes CELLO agents reachable from the A2A ecosystem. A CELLO-to-CELLO session provides guarantees A2A structurally cannot match, and that gap is permanent. Documents the philosophical divergence, the bridge architecture, and why the "upgrade layer" positioning is more durable than feature parity.
---

# A2A Interoperability and Strategic Positioning

## The Stance

CELLO does not adopt A2A's wire format or identity model. CELLO provides an **A2A bridge** that makes CELLO agents reachable from the A2A ecosystem. Any A2A-native agent can call a CELLO agent as if it were an ordinary A2A endpoint. But when two CELLO agents communicate directly, the session provides guarantees that A2A structurally cannot give — and that gap is permanent, not a roadmap item for Google to close.

This is not a "me too" positioning. It is the upgrade layer posture: CELLO agents are compatible with A2A the way HTTPS servers are compatible with HTTP clients. The compatibility surface is real. The differentiation is irreducible.

---

## What A2A Is and What It Does Well

Google's Agent2Agent protocol defines a clean application-layer format for agent-to-agent task invocation. The `Message` structure — `TextPart`, `FilePart`, `DataPart` — is sensible. The task lifecycle (submitted → working → completed/failed) maps well to how agent work actually flows. The streaming SSE model handles long-running tasks gracefully. Google has clearly thought carefully about the ergonomics of agent interoperability at scale, and the A2A ecosystem will grow.

The Google team is not building A2A naively. They understand agent trust is a problem. They will add verification features over time.

---

## Where A2A Cannot Go

A2A's identity model is OAuth/OIDC: a centralized authority — Google Identity, or an OAuth provider you configure — vouches for the agent. The agent presents a token. The receiving agent trusts the issuer.

This is a fundamentally centralized model. No amount of iteration changes that structural fact. If Google issues the identity, Google can revoke it, impersonate it, or compel it to be revoked by a third party. For an agent making low-stakes decisions this is acceptable. For an agent signing contracts, authorizing financial transactions, or participating in accountability-sensitive workflows, the question "who ultimately authorized this?" has a different answer under OAuth than under FROST.

**CELLO's FROST split-key model means no single party — including CELLO — can unilaterally sign for an agent.** The agent's K_local and the directory's K_server shares are generated independently and never combined. A signed session record requires both. This is not a feature that can be added to A2A. It requires a different identity architecture from the ground up.

Three properties follow from this that A2A cannot match structurally:

**1. Non-repudiation with no trusted third party.** A CELLO session produces a Merkle-rooted audit record co-signed by both agents at the FROST bookends. Neither agent can deny participation. Neither can retroactively modify the transcript. No central authority needs to vouch for this — the cryptographic structure is self-evident. An A2A task log requires trusting the platform that recorded it.

**2. Compromise detection independent of the agent process.** The FALLBACK_CANARY fires when the directory detects two competing FROST participation attempts. This is only possible because CELLO's identity is split — an attacker with K_local alone cannot sign a valid session record without the directory's cooperation, and attempting to do so triggers the canary. A2A's OAuth model has no equivalent signal: a stolen token looks exactly like a legitimate one.

**3. Identity that survives platform transitions.** A CELLO agent's identity is anchored to a FROST keypair and a verified phone number, not to a platform account. If Google changes their OAuth model, deprecates a token format, or an operator's Google account is suspended, an A2A agent loses its identity. A CELLO agent's identity is platform-independent.

---

## The Bridge Architecture

CELLO agents expose an A2A-compatible endpoint as an optional capability. From the outside it looks like any A2A agent: it accepts A2A task requests, responds with A2A message structures, streams SSE for long-running tasks. An A2A-native agent calling a CELLO agent has zero integration burden.

What actually happens on the CELLO side:

- The inbound A2A request is received at the bridge adapter
- The adapter initiates a CELLO session with the CELLO agent
- The A2A task payload is carried as session content
- The CELLO agent processes it and responds
- The bridge serializes the response back to A2A format and returns it

When the counterparty is also CELLO-registered, the session is fully bookended: FROST-signed at open and close, Merkle-chained throughout, tamper-evident. The A2A application layer runs inside a CELLO trust envelope.

When the counterparty is A2A-only (not CELLO-registered), the session runs without the FROST bookends. The CELLO agent processes the task normally but the session record is unverified on the counterparty side. The CELLO agent knows the session is downgraded. It can apply a stricter policy to unverified counterparties — or refuse entirely if the policy requires it. This is a first-class configuration choice, not an edge case.

```
A2A-native agent                        CELLO agent
      │                                      │
      │  POST /a2a/tasks/send                │
      │─────────────────────────────────────>│
      │                                      │ ← A2A bridge adapter
      │                                      │   wraps in CELLO session
      │                                      │   (unverified — no FROST bookend)
      │                                      │   policy: allow or reject
      │  A2A task response (SSE)             │
      │<─────────────────────────────────────│

CELLO agent A                           CELLO agent B
      │                                      │
      │  CELLO session open (FROST bookend)  │
      │─────────────────────────────────────>│
      │                                      │
      │  A2A-formatted content over CELLO    │
      │<────────────────────────────────────>│
      │                                      │
      │  CELLO session close (FROST bookend) │
      │─────────────────────────────────────>│
      │  ← tamper-evident Merkle record      │
      │    neither party can deny            │
      │    no third party needed             │
```

---

## The Positioning

**Not:** "CELLO is built on A2A."
**Not:** "CELLO is an alternative to A2A."
**Yes:** "CELLO agents speak A2A. When two CELLO agents talk to each other, the conversation is cryptographically accountable. A2A doesn't do that and can't — it would have to become a different protocol."

The HTTPS analogy is the right one to deploy publicly. Any HTTP client can reach an HTTPS server. Nobody argues HTTPS is unnecessary because HTTP already exists. The upgrade layer provides something the base layer structurally cannot. CELLO is that upgrade layer for agent trust.

The Google engineers are not building A2A carelessly. They will add trust features. But their trust features will be OAuth-based, centralized, and platform-dependent — because that is what Google can build and what fits their ecosystem. It is not a weakness in their judgment; it is a structural consequence of who they are. CELLO's decentralized, split-key model is not a feature Google can ship. The philosophical divergence is durable.

---

## What This Means for the Roadmap

The A2A bridge is not M6. It is a post-M7 concern — after the registration and trust signal infrastructure is in place, there is a surface to expose to A2A. The bridge adapter sits in front of the CELLO agent's session layer and translates A2A requests into CELLO sessions. It is not a large piece of work, but it should not be built until the session layer it wraps is production-stable.

The right milestone for an A2A bridge is roughly M9 or M10 — after the security layer (M8) ships and CELLO agents have a full trust profile that an A2A counterparty can discover. The bridge without the trust profile is just an HTTP adapter. The trust profile is what makes the bridge compelling.

---

## Open Questions

**1. A2A agent card — what CELLO trust data should be surfaced.**
A2A's `AgentCard` is the discovery artifact: it lists capabilities, skills, authentication requirements, and endpoint URLs. A CELLO agent's AgentCard should surface their trust profile — verified phone, email domain, trust signals, Class 1 listing data — in a standard A2A-readable form. The question is how much of the CELLO trust model maps cleanly to A2A's capability vocabulary, and whether new A2A extensions are needed to carry CELLO-specific fields.

**2. Policy for unverified (A2A-only) counterparties.**
When an A2A-native agent calls a CELLO agent, the session is unverified on the counterparty side. The CELLO agent's connection policy applies — but the current policy model (`cello_set_policy`, `SignalRequirementPolicy`) is designed for CELLO-to-CELLO sessions where both agents have trust signals. A policy model for "what do I accept from A2A-only counterparties?" needs to be defined. The simplest answer is a global threshold: require at least verified phone (a CELLO agent on the other side) to engage, with an explicit opt-in for unverified counterparties.

**3. Whether CELLO should publish an A2A extension spec.**
If CELLO agents carry trust data that A2A doesn't natively model, CELLO could publish an A2A extension spec — a standardized way to embed CELLO trust signals in an A2A AgentCard. This positions CELLO as a contributor to the A2A ecosystem rather than a fork, while establishing CELLO's trust model as the reference for what A2A trust should look like. The risk is that it accelerates Google adding native trust features that close the gap. The opportunity is that it anchors CELLO terminology and concepts in the A2A vocabulary before Google defines that space.

---

## Related Documents

- [[cello-initial-design|CELLO Design Document]] — original competitive landscape analysis; CELLO's trust model and why centralized alternatives are structurally insufficient
- [[end-to-end-flow|CELLO End-to-End Protocol Flow]] — §3 (session layer) and §6 (FROST bookends) define the session model the A2A bridge wraps; §8.4 (platform transports) describes the pattern of layering CELLO trust on top of existing message platforms
- [[2026-05-09_1100_dashclaw-m4-competitive-review|DashClaw Competitive Review]] — adjacent competitive analysis; the framework integration patterns documented in §4.4 are relevant when building the A2A bridge adapter
- [[server-infrastructure|CELLO Server Infrastructure Requirements]] — the directory's Class 1 public listing data is what surfaces in the A2A AgentCard; the registration API is what the bridge uses to verify counterparty identity
