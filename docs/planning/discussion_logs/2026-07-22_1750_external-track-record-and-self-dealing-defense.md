---
name: external-track-record-and-self-dealing-defense
type: discussion
date: 2026-07-22
topics: [trust-signals, track-record, anti-farming, sybil-defense, zero-bump-extensibility, graph-analytics, psi]
status: active
description: Design session — filtering self-dealing from track records by leveraging phone_stub_hash linkage, and contextualizing this defense within the broader Sybil and graph-analytic stack.
---

# External Track Record & Self-Dealing Defense

## Context

Class 3 `track_record` trust signals rely on `session_count` and `clean_close_rate` to establish an agent's history. A vulnerability exists where a single operator can spin up two agents under the same account and farm closed sessions back-and-forth, inflating their metrics without engaging in legitimate, external collaboration. 

This log documents the solution: utilizing the existing directory `phone_stub_hash` operator linkage to compute an `external_track_record` signal, and how this fits inside the wider CELLO security stack alongside graph analytics and PSI.

## 1. The Operator Linkage Mechanism

The directory database already holds the necessary state to detect self-dealing. In `V9__agent_profiles.sql`, the `agent_profiles` table stores the `phone_stub_hash` alongside the agent's keys (`k_local_pubkey`, `primary_pubkey`). This hash acts as the dedicated public account identifier. Every agent created by the same operator shares the identical `phone_stub_hash`.

We have prior precedent for using this mechanism: the **Same-Owner Rule** (`2026-04-10_1000_connection-endorsements-and-attestations.md`) prevents same-owner agents from issuing Class 2 connection endorsements. We can apply this exact same concept to track-record computations.

## 2. Minting an "External Track Record" Signal

Rather than altering the existing `track_record` signal (which remains an all-inclusive baseline metric), the portal will mint a *second* trust signal specifically for external usage.

1. **Directory Internal API Update**:
   The internal API route (`GET /internal/track-record/:agentPubkeyHex`) in `internal-api-server.ts` is updated to compute two sets of metrics. By joining the `agent_profiles` table twice (once for Participant A, once for Participant B), we compute a filtered `external_session_count` using the constraint: `ap_a.phone_stub_hash != ap_b.phone_stub_hash`.

2. **Zero-Bump Extensibility**:
   Per the M10 architecture (`M10-TRUST-SIGNAL-STORAGE-AND-CREATION.md`), introducing this requires no client or directory protocol upgrades. The portal's background job (DOD-TRACK-1) simply begins minting an additional envelope:
   - `type: "external_track_record"`
   - Self-describing payload: *"This agent has completed X session(s) with counterparties outside its own account."*
   
   Because payloads are self-describing, the client UI will seamlessly project this new signal to users with no frontend code changes required.

## 3. Defense in Depth: The "Two Phone Numbers" Loophole

A determined attacker might attempt to bypass the `phone_stub_hash` filter by purchasing two or more SIM cards and operating multiple accounts. This is an expected threat and is mitigated by the multiplicative cost of CELLO's layered defense architecture:

### Layer 2: Graph Analytics (Anti-Farming)
If an attacker scales multiple accounts to farm sessions, their network topology betrays them:
- **Conductance-based cluster scoring**: The farm creates an insular cluster where almost all edges point inward. The analytics job flags the lack of external leakage. Organic networks (like a 10-person office) naturally "leak" to external vendors and partners, maintaining healthy conductance.
- **Graph Isomorphism**: To maximize ROI, an attacker's endorsement graph and transaction graph often perfectly overlap (a high-entropy signature compared to the messy, asymmetric shapes of organic human networks).
- **Temporal Variance / Diminishing Returns**: Scripted sessions exhibit metronomic timing and repeated counterparty interactions, both of which are penalized or flagged by the directory's internal analytics.

### Layer 4: Private Set Intersection (PSI) and Endorsements
Even if a farm successfully artificially inflates its `external_track_record` and evades structural detection, its signals hold zero value against localized, subjective agent policies:
- **PSI (Mutual Contacts)**: If a user's connection policy requires a shared mutual contact, the attacker's farm is useless. The cryptographically secure intersection will return `0`, and the connection will drop.
- **Class 2 Endorsements**: As structurally asymmetric signals, true connection endorsements cannot be farmed from the inside. An attacker's internally-generated metrics hold no weight when faced with a policy demanding a real-world vouch from a node the user actually trusts.

## Conclusion

The `external_track_record` perfectly bridges the gap between raw activity metrics and meaningful reputation. By stacking this operator-aware filter with Layer 2 graph analytics and Layer 4 subjective endorsements, CELLO ensures that building fake reputation remains exponentially more expensive than earning it organically.