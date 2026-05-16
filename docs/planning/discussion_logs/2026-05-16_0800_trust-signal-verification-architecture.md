---
name: Trust Signal Verification Architecture
type: discussion
date: 2026-05-16 08:00
topics: [trust-signals, social-verification, oauth, browser-harness, community-verification, M7]
status: active
description: Architecture for verifying social trust signals — OAuth proof of account ownership, browser-based profile extraction, and the longer-term community-driven oracle model.
---

# Trust Signal Verification Architecture

## The Problem

Trust signals require verifying that an agent's operator actually controls the social accounts they claim. Two distinct sub-problems:

1. **Proof of ownership**: does this person control this LinkedIn / GitHub / X account?
2. **Profile extraction**: what does that account look like — age, followers, connections, history?

These are separate concerns and need separate solutions.

---

## Proof of Ownership: OAuth

**Decision**: Passport.js with per-provider strategies.

Rationale:
- Most battle-tested Node OAuth library. Strategies for GitHub, LinkedIn, and X are mature.
- Not a full IAM solution — no session management, no user tables, no RBAC. Just the OAuth handshake.
- Maps cleanly onto the adapter interface pattern.

This is a **one-shot proof ceremony**, not authentication. The user initiates it, we get the token, we extract the handle, we're done. No refresh tokens. No ongoing identity management.

**Interface:**
```typescript
interface TrustSignalProofProvider {
  initiateProof(agentId: string): Promise<string>  // returns redirect URL
  handleCallback(code: string, state: string): Promise<TrustOwnershipProof>
}

type TrustOwnershipProof = {
  provider: 'github' | 'linkedin' | 'x'
  handle: string
  provenAt: Date
}
```

Local stub returns a hardcoded `TrustOwnershipProof` without hitting any real OAuth provider.

---

## Profile Extraction: Browser Harness Agent

**Decision**: a read-only trust auditor agent using browser harness against a pre-authenticated real account.

The auditor agent:
- Gets handed a provider and handle
- Navigates to the public profile
- Extracts the signals we care about
- Returns structured data
- No interaction, no side effects, purely read-only

**Interface:**
```typescript
interface TrustAuditorAgent {
  audit(provider: 'github' | 'linkedin' | 'x', handle: string): Promise<TrustSignalData>
}

type TrustSignalData = {
  provider: string
  handle: string
  auditedAt: Date
  signals: {
    accountAgeMonths?: number
    followersCount?: number
    connectionsCount?: number
    publicPostsCount?: number
    verifiedBadge?: boolean
    // provider-specific fields added as needed
  }
}
```

Local stub returns hardcoded `TrustSignalData` without launching a browser.

**Existing browser harness skills:**
- GitHub: `domain-skills/github/scraping.md` — ready
- LinkedIn: `domain-skills/linkedin/invitation-manager.md` — authenticated navigation proven, profile scraping skill needs to be written
- X: no skill exists — needs to be built from scratch

**Provider priority for M7**: GitHub first (skill exists, API is open, account age and follower count available without special permissions). LinkedIn second. X last.

---

## The Two-Step Pattern

Proof of ownership and profile extraction are **always asynchronous**. The OAuth handshake happens synchronously during the operator's setup flow. The browser harness audit runs in the background after the operator has moved on.

The trust signal record models this explicitly:
- `provenAt` — timestamp when OAuth proof completed
- `auditedAt` — timestamp when browser harness extraction completed
- Signals are populated only after audit completes

The trust signal is not usable until both timestamps exist.

---

## The Pre-Authenticated Account

The browser harness agent uses a real, pre-authenticated account for each provider. This is production infrastructure, not a dev credential:

- Stored in Secrets Manager
- Browser session/cookie state persisted in a browser profile
- Rotated if flagged or rate-limited by the provider

**Single account is a bootstrap limitation.** At low onboarding volume this is acceptable. At scale — hundreds or thousands of agents onboarding per day — a single account will be rate-limited and eventually flagged. The community-driven model (see below) is the long-term solution.

---

## Future: Community-Driven Verification Oracle

At scale, verification becomes a community responsibility modeled loosely on an oracle network with economic incentives.

**How it works:**
- Agents opt in to the verifier pool
- When an operator requests a trust signal verification, the system randomly selects N opted-in agents from the pool
- Each agent independently runs the same audit: navigate to the public profile, extract the signals, return structured data
- Results are compared for consensus

**Why random selection matters:**
- Two independently selected agents that don't appear connected to each other must both return matching results
- The system periodically runs spot-checks using its own infrastructure agent to validate verifier accuracy
- Operators whose signals don't match what they know to be true will complain — this catches beneficiary-side fraud

**The residual attack surface:**
For fraud to succeed, an attacker needs: their malicious agent to be randomly selected, a colluding second agent to also be randomly selected, neither to be caught by spot-checks, and the beneficiary to stay silent. This requires pre-seeding the verifier pool with colluding agents (a Sybil attack) and coordinating with the beneficiary. The Sybil floor from M10 — conductance scoring and provisional periods — makes pool seeding expensive. The attack surface after all defenses is narrow: a sophisticated, patient, well-resourced adversary. Not the primary threat model.

**Verifier eligibility requirements (to be designed):**
- Must have passed their own trust signal verification first — you cannot verify others until you are verified
- Provisional period before joining the pool — new agents have no pool weight
- Reputation score based on verification accuracy history
- Economic incentive: micropayment per completed audit via M9 commerce layer

**Sequencing**: community verification requires M9 (commerce/micropayments) and M10 (social trust/Sybil floor) to be meaningful. It is not an M7 feature. The `TrustAuditorAgent` interface is designed so the community implementation is a drop-in replacement for the single-agent crawler — same interface, different implementation.

**Note**: significant design work remains before implementing the community oracle model. Economic incentive structure, verifier vetting requirements, consensus threshold, and dispute resolution all need dedicated design sessions. Flag for a future discussion log when approaching M10.

---

## Decisions Summary

| Decision | Choice |
|----------|--------|
| OAuth library | Passport.js |
| Profile extraction | Browser harness read-only agent |
| Provider order | GitHub → LinkedIn → X |
| Timing model | Async two-step: proof synchronous, audit background |
| Bootstrap implementation | Single pre-authenticated account per provider |
| Long-term implementation | Community oracle with economic incentives (post-M9/M10) |
| Interface design | `TrustAuditorAgent` is swap point between bootstrap and community model |
