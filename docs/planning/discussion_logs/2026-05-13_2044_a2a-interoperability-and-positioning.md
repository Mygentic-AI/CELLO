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

There is no such thing as an unverified CELLO counterparty. Every CELLO agent has completed phone and email verification at registration — those are the baseline, not optional. What varies is what the agent has verified beyond that baseline: LinkedIn, GitHub, WebAuthn device, SIM score, endorsements. The trust score is the machine-readable expression of that signal inventory. A phone-and-email-only agent has a low trust score; a fully-verified agent has a high one. Both are verified participants. Both are accountable.

This matters for the bridge. An A2A-native agent calling a CELLO agent is, by definition, not a CELLO participant. They have no phone verification, no email verification, no FROST identity, no trust score. The receiving CELLO agent's connection policy determines whether it will engage — and the connection policy already supports this: the owner sets minimum signal requirements, and an agent presenting no signals is simply below the threshold. This is not an edge case; it is the normal operation of the policy system applied to a non-participant caller.

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

**1. What surfaces in the A2A AgentCard — bio vs. trust score.**
A2A's `AgentCard` is the discovery artifact: capabilities, skills, authentication requirements, endpoint URL. CELLO has two distinct things that could go there, and they must not be conflated.

The **bio** is operator-written. The agent (or its operator) chooses what to say about itself — what it does, what kinds of conversations it accepts, its domain. It is not verified. It is not a trust signal. It is self-description, and it belongs in the AgentCard's `description` field or equivalent.

The **trust score** is separately derived from verified signals — phone, email, LinkedIn, GitHub, WebAuthn device, SIM score, endorsements. The agent does not write its trust score; the directory computes it from the signal inventory. These two things must be represented as distinct fields in any AgentCard mapping. An A2A consumer that conflates "what the agent says about itself" with "what has been independently verified about this agent" is missing the point of the trust system.

The open question is whether A2A's existing vocabulary is sufficient to carry both, or whether a CELLO extension field is needed.

**2. Communication policy and sanctions.**
The CELLO connection policy already handles "what will I accept." The receiving agent sets a `SignalRequirementPolicy` — minimum trust signals required to connect, categories of interaction it will and will not engage in. An agent that attempts an interaction outside the declared policy is not simply filtered; they are sanctioned. The record of the violation is in the tamper-evident session log. This is a meaningfully stronger posture than A2A's model, where a caller that violates expectations has no accountability trail.

The open question for the bridge is how the connection policy expresses the distinction between "CELLO participant below my threshold" and "A2A-only caller with no CELLO identity at all." These may warrant different policy responses — an agent with a low trust score is a participant who chose not to invest in verification; an A2A-only caller is not a participant at all. The policy model should be able to distinguish them.

**3. Whether CELLO should publish an A2A extension spec.**
If CELLO agents carry trust data that A2A doesn't natively model, CELLO could publish an A2A extension spec — a standardized way to embed the trust score, signal inventory, and bio distinction in an A2A AgentCard. This positions CELLO as a contributor to the A2A ecosystem rather than a fork, and anchors CELLO's trust vocabulary before Google defines that space. The risk is that it accelerates Google adding native trust features that narrow the gap. The opportunity is that the spec itself demonstrates what a real trust model looks like versus OAuth, putting Google in the position of responding to a published standard rather than defining one.

---

## Related Documents

- [[cello-initial-design|CELLO Design Document]] — original competitive landscape analysis; CELLO's trust model and why centralized alternatives are structurally insufficient
- [[end-to-end-flow|CELLO End-to-End Protocol Flow]] — §3 (session layer) and §6 (FROST bookends) define the session model the A2A bridge wraps; §8.4 (platform transports) describes the pattern of layering CELLO trust on top of existing message platforms
- [[2026-05-09_1100_dashclaw-m4-competitive-review|DashClaw Competitive Review]] — adjacent competitive analysis; the framework integration patterns documented in §4.4 are relevant when building the A2A bridge adapter
- [[server-infrastructure|CELLO Server Infrastructure Requirements]] — the directory's Class 1 public listing data is what surfaces in the A2A AgentCard; the registration API is what the bridge uses to verify counterparty identity
