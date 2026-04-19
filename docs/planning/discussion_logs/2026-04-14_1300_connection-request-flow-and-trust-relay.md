---
name: Connection Request Flow — Trust Data Relay and Selective Disclosure
type: discussion
date: 2026-04-14 13:00
topics: [connection-request, trust-data, directory-relay, selective-disclosure, privacy, connection-policy, ephemeral-data]
description: Definitive design for how connection requests are brokered through the directory, how trust data is verified and forwarded, the one-round negotiation limit, and the mandatory vs. discretionary trust signal framework.
---

# Connection Request Flow — Trust Data Relay and Selective Disclosure

## Context

Multiple documents describe pieces of the connection request flow — how Alice, having discovered Bob, initiates contact. The technical transport (directory WebSocket routing, ephemeral libp2p peer ID exchange on acceptance) is well-established across [[cello-design|CELLO Design Document]] Step 5–6, [[2026-04-11_1400_libp2p-dht-and-peer-connectivity|libp2p, DHT, and Peer Connectivity]], and [[end-to-end-flow|End-to-End Flow]]. What was underdefined: exactly what data travels with the connection request, how the directory verifies it, and what Alice can or cannot withhold.

This log resolves those gaps.

---

## The Connection Request Flow

### Phase 1 — Request Submission

Alice sends a connection request to the directory via her persistent authenticated WebSocket. The request includes:

- Alice's identity (public key, agent ID)
- Alice's original Ed25519 signature on the request
- An optional greeting message
- **Alice's trust scores — the actual values, not just hashes**

The directory already holds hashes of Alice's trust scores (per the [[2026-04-08_1930_client-side-trust-data-ownership|client-side trust data ownership]] model). It verifies the submitted scores against those hashes, confirming that Alice is not misrepresenting her own reputation. This is the directory adding attestation value: it is not merely relaying, it is vouching that the data is authentic.

The directory does not re-sign the request. Alice's original signature travels intact.

### Phase 2 — Forwarding

The directory forwards the verified request to Bob via Bob's persistent authenticated WebSocket. Bob's agent now has:

- Alice's identity and signature (verifiable against her public key)
- Alice's trust scores (verified by the directory against its hashes)
- The greeting message (which Bob's client runs through Layer 1 sanitization before surfacing)

Bob's agent evaluates the request against its configured connection acceptance policy: trust score floor, endorsement requirements, whitelist/blacklist, verification freshness, staking requirements. In most cases, this is sufficient to make a decision.

### Phase 3 — One Round of Negotiation

Bob gets **one opportunity** to ask for additional information. This covers cases where the trust scores are sufficient to pass the floor but Bob wants more detail before committing. For example:

- A social verification score shows Alice has a verified LinkedIn account. Bob's agent asks for the actual LinkedIn username so it can be inspected.
- An endorsement count shows Alice has 4 connection endorsements. Bob's agent asks to see the endorser identities.

Alice receives the request and either **provides or refuses** the additional information. Refusal is not a trust event — it is Alice exercising her right to privacy. But Bob factors the refusal into his decision.

Bob then **accepts or declines** the connection. That is the end of the negotiation. There are no further rounds. The one-round limit prevents the pre-connection phase from becoming a de facto conversation channel and bounds the directory's relay burden.

### Cleanup — Ephemeral Data Policy

Once the accept/reject decision is made, all trust data the directory held in memory during the relay is cleared. It is never persisted to disk. The directory returns to its baseline state: hashes only.

This extends to a **general architectural principle**: any time the directory handles actual data (not hashes) for the purpose of verification or relay, that data is forwarded and then cleared from memory. The directory never accumulates plaintext trust data. Its persistent store contains only hashes.

---

## Mandatory vs. Discretionary Trust Signals

Not all trust signals are under Alice's control. The protocol distinguishes between signals that Alice must disclose and signals she may choose to share or withhold.

### Mandatory signals — behavioral track record

Alice cannot withhold signals that reveal behavioral history. These exist specifically to prevent agents from hiding evidence of poor conduct:

- **Conversation track record** — number of completed conversations, number of issue-free sessions, number of disputes, dispute outcomes. This is the core behavioral signal. An agent with 50 flagged sessions cannot hide that by choosing not to disclose it.
- **Connection history metrics** — total connections, successful connections, connection refusal rate. Patterns of behavior are not optional disclosures.

The principle: **if the signal could reveal undesirable behavior, Alice does not get to suppress it.** The protocol enforces this — the directory will not forward a connection request that omits mandatory signals.

### Discretionary signals — additive credentials

Alice can choose whether to share signals that are purely additive — things that make her look more trustworthy but whose absence is not inherently negative:

- **Social account verifications** — LinkedIn, GitHub, etc. The directory has verified these exist and hashed the usernames. Alice can choose to include the verification status (verified: yes/no) or even the actual username. But she is not obligated to.
- **Device linking status** — whether Alice has linked a hardware device. Useful signal, but absence just means she hasn't set it up.
- **Endorsement details** — Alice can share that she has N endorsements, but may choose not to reveal the specific endorsers for privacy reasons.
- **External credential attestations** — professional certifications, business verifications. Alice presents them if they help her case.

The principle: **the absence of an additive signal might be interpreted negatively by Bob — that is Bob's right — but Alice's choice not to disclose it is not itself a trust event.** She is declining to share a credential, not hiding misconduct.

### Interpretation asymmetry

Bob's policy may treat the absence of discretionary signals differently depending on context:

- An open institution (hospital) might accept connections with only mandatory signals — discretionary signals are nice-to-have.
- A high-security service might require specific discretionary signals (e.g., "must have at least one verified social account") as part of its connection policy. Alice's refusal to provide them results in a declined connection — her choice, but the consequence is clear.

The protocol provides the mechanism. The policy is Bob's to configure.

---

## Open Questions

1. **Full signal classification.** Every trust signal in the protocol needs to be explicitly classified as mandatory or discretionary. This requires a comprehensive review of all signal types — the two categories above are the principle, but the specific assignments need a dedicated pass.

2. **Directory enforcement of mandatory signals.** The directory must verify that a connection request includes all mandatory signals before forwarding. What happens if Alice's client is modified to omit them? The directory has hashes for all signals — it knows what it expects. A request missing mandatory signals is rejected at submission. But this means the directory must maintain a list of which signal types are mandatory, which is a protocol-level registry.

3. **Versioning of mandatory signals.** As the protocol evolves, new signal types may be added. If a new mandatory signal is introduced, agents that pre-date it won't have it. Grace period? Grandfathering? This interacts with protocol versioning.

4. **Negotiation round abuse.** The one-round limit is clean but could Bob's "additional information request" be weaponized to extract information? Bob asks for Alice's LinkedIn username with no intent to accept — just harvesting social accounts. Mitigations: the request itself is signed and logged (non-repudiation), and patterns of requesting-then-rejecting could be a trust score event.

5. **Partial disclosure within mandatory signals.** Can Alice disclose that she has a conversation track record but redact specific entries? Or is it all-or-nothing? For mandatory signals, all-or-nothing seems correct — partial disclosure of behavioral data defeats the purpose.

---

## Related Documents

- [[cello-design|CELLO Design Document]] — Step 5 (connection request routing) and Step 6 (connection acceptance policy, session establishment); this log resolves the trust data relay gap between those steps
- [[end-to-end-flow|End-to-End Flow]] — §5 connection request flow; carries Alice's signature intact through the directory
- [[2026-04-08_1930_client-side-trust-data-ownership|Client-Side Trust Data Ownership]] — the hash-everything-store-nothing model that this log's relay pattern depends on; the directory verifies against hashes and discards the data
- [[2026-04-11_1400_libp2p-dht-and-peer-connectivity|libp2p, DHT, and Peer Connectivity]] — the ephemeral peer ID exchange that happens after acceptance; this log covers everything before that point
- [[2026-04-10_1000_connection-endorsements-and-attestations|Connection Endorsements and Attestations]] — endorsement details are a discretionary signal; the pre-computed endorsement flow is what Bob is checking against
- [[2026-04-08_1900_connection-staking-and-institutional-defense|Connection Staking and Institutional Defense]] — the gate pyramid that evaluates the trust data this log specifies; staking requirements are checked in Phase 2
- [[2026-04-08_1830_notification-message-type|Notification Message Type]] — introduction notifications are the fallback when pre-computed endorsements are insufficient
- [[2026-04-11_1000_sybil-floor-and-trust-farming-defenses|Sybil Floor and Trust Farming Defenses]] — the trust signals being relayed here include the PPP-adjusted bond and social verification scores designed there
- [[2026-04-13_1200_discovery-system-design|Discovery System Design]] — discovery is the step immediately preceding this flow; Alice finds Bob's public profile, then this log's flow begins
- [[2026-04-14_1000_contact-alias-design|Contact Alias Design]] — alias-based connection requests route through this same flow but the directory resolves the alias without exposing the target's agent ID
- [[2026-04-14_1100_cello-mcp-server-tool-surface|CELLO MCP Server Tool Surface]] — `cello_initiate_connection` and `cello_accept_connection` / `cello_decline_connection` implement this flow; `cello_verify` provides the trust data that travels with the request
- [[2026-04-11_1700_persistence-layer-design|Persistence Layer Design]] — the `connection_requests` table with `outcome`, `rejection_reason`, `via_alias_id`, and `escalation_expires_at` fields is the storage layer for this flow; the ephemeral data policy (directory discards plaintext after relay) is the complement to that append-only schema
- [[frontend|CELLO Frontend Requirements]] — connection request flow UI (trust data selective disclosure, mandatory vs. discretionary signal presentation, accept/decline/escalate controls) sourced from this log
- [[server-infrastructure|CELLO Server Infrastructure Requirements]] — the directory's verify-then-relay-discard pattern for connection requests is specified there; provisional period cap of 25/day (G-16) enforced by directory at FROST session establishment
- [[2026-04-18_1357_connection-bond-usage-and-policy|Connection Bond Usage and Policy]] — adds mandatory intent declaration requirement to connection requests and policy-first flow; stated intent is Merkle-logged and forms the basis for bond claims
