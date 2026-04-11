---
name: Connection Endorsements and Attestations
type: discussion
date: 2026-04-10 10:00
topics: [endorsements, attestations, web-of-trust, anti-farming, bootstrapping, connection-policy, pre-computed, revocation, sybil-defense]
description: Pre-computed endorsement system replacing just-in-time introductions, attestation as a general primitive, revocation model, anti-farming rules, and bootstrapping new agents via existing networks.
---

# Connection Endorsements and Attestations

## The problem with just-in-time introductions

The current web-of-trust introduction model works like this: Alice contacts Charlie, who requires an introduction. Alice finds a mutual contact Bob, asks Bob to introduce her in real time, Bob sends a notification to Charlie. The problem: Bob must be available, a real-time negotiation must happen, and if it requires any inference it burns tokens. This is a speed bump that scales poorly.

The solution is to move endorsements out of the connection-time critical path and make them pre-computed.

## Two distinct primitives

### Connection endorsement

A connection endorsement is a signed, binary statement from one agent about another: "I know this person and have had no issues with them." It may optionally carry a short context string ("I've worked with Alice, she is professional and trustworthy") but the statement itself is binary — it either exists or it doesn't. There is no partial endorsement.

Connection endorsements are checked programmatically at the connection gate. They are a trust primitive the protocol understands.

### Attestation

An attestation is the general primitive: a signed, hashable, portable statement from one agent about another. The content is freeform — a service review, a professional reference, a certification, a conditional endorsement ("I vouch for Bob specifically as a plumber — I've hired him twice"), anything. The subject stores it, presents it as part of their trust profile, and third parties can verify it against the directory's hash.

Attestations are informational, not gated. They are not checked programmatically at the connection layer. A connection endorsement is a specific type of attestation — but the protocol distinguishes between the two because only connection endorsements affect connection acceptance policy.

**Naming summary:**
- `connection_endorsement` — protocol-level, checked at the connection gate
- `attestation` — general primitive, informational, part of the trust profile

## Pre-computed endorsement flow

Endorsements are gathered ahead of time, not at the moment of connection.

```
Alice asks Bob to endorse her (client can negotiate this autonomously, optionally via local LLM)
  → Bob agrees
  → Bob signs the endorsement (Alice's public key, Bob's public key, optional context, timestamp)
  → Bob sends the signed endorsement to Alice AND to the directory
  → Directory verifies Bob's signature, hashes the endorsement, stores the hash, discards the content
  → Alice stores the endorsement + the hash
  → Directory holds only the hash
```

This follows the same hash-everything-store-nothing pattern as all other trust data. The directory cannot leak who endorsed whom — it holds hashes.

## Verification at connection time

When Alice contacts Charlie, no real-time calls to endorsers are needed:

```
Alice contacts Charlie
  → Charlie's client computes: intersection of "agents I know" and "agents who endorsed Alice"
  → Alice provides her connection endorsements for the relevant agents
  → Charlie's client verifies each endorsement against the directory hash
  → Pure hash lookup — no inference, no calling out to endorsers, no endorser availability required
  → Accept or decline based on configured policy
```

Bob does not need to be online. Bob does not need to be aware the connection is happening. The endorsement is already stored and verified.

## Privacy-preserving intersection — PSI

The intersection computation above has a privacy leak. Without a privacy-preserving mechanism, either Alice must reveal her full endorser list to Charlie, or Charlie must reveal his full contact list to Alice. Either direction leaks information: an attacker making a connection attempt could use even a refused connection to harvest Charlie's contact graph, then target those people for manufactured endorsements in a future attempt.

**Private Set Intersection (PSI)** lets the computation happen without either party learning the other's full set. Only the intersection is output. The directory acts as a natural PSI facilitator — it mediates the blinded hash comparison without retaining either party's inputs.

Two variants serve different policy types:
- **PSI-CA (cardinality only)** — for threshold policies ("I need at least N endorsers in common"). Reveals only the count, not which agents matched. Lower implementation cost.
- **Full PSI** — for content-verified policies ("I need endorsement from a specific known agent"). Reveals which agents matched, allowing Charlie to fetch and verify the actual endorsement content.

PSI is not a day-one requirement. The endorsement mechanism ships first; PSI is added in a second phase when endorsement policies are in production use. Full design in [[2026-04-10_1200_psi-for-endorsement-intersection|PSI for Endorsement Intersection]].

## Revocation

Bob can revoke any endorsement or attestation he has issued at any time. Revocation follows the append-only log model — the hash is never deleted. A revocation is a new directory event appended to the log: "Bob revokes endorsement [hash]."

This means there are three distinct states a verifier can observe:

| State | Meaning |
|---|---|
| Hash present, not revoked | Valid, active endorsement |
| Hash present, revoked | Real endorsement, subsequently withdrawn |
| Hash not present | Never issued, or data integrity failure |

The distinction between "revoked" and "never existed" matters. If Alice presents an endorsement and the directory shows the hash never existed, that is a sign of fraud or fabrication. If the hash exists but is revoked, the endorsement was genuine but withdrawn — a meaningfully different situation.

**Notification:** When Bob revokes, the directory notifies Alice's client. The client should remove the endorsement from its local store. Alice is not technically forced to — but any recipient who checks against the directory will see the revocation. Presenting a revoked endorsement fails verification immediately and is a trust score event.

Revocation applies equally to connection endorsements and attestations.

## Bootstrapping a new agent

When creating a new agent (second agent, business agent, service agent), the cold-start problem is solvable via the existing network:

```
Alice has Agent1 (established, well-connected)
Alice creates Agent2 (new, zero endorsements)
  → Agent1's client asks Alice's contacts to endorse Agent2
  → Contacts review and agree (via lightweight negotiation — can be inference-free or local LLM)
  → Endorsements accumulate before Agent2 starts accepting connections
  → Agent2 launches with a set of pre-built connection endorsements
```

This turns the problem from "prove yourself from scratch" to "port your reputation to a new identity." The network does the bootstrapping work.

## Anti-farming rule: same-owner agents cannot issue connection endorsements

Without a constraint, an owner could create ten agents and have them all endorse each other, manufacturing a fake endorsement network at zero cost.

**Rule:** Connection endorsements between agents with the same owner are invalid. The directory enforces this at submission time — it knows the owner (phone hash) of every agent. If endorser and endorsed share an owner, the submission is rejected. The endorsement is never stored, never hashed, never usable.

This makes the attack impossible at the protocol level:

- Alice creates Agent1 and Agent2 under the same phone number
- Agent1 attempts to endorse Agent2 as a connection endorsement
- Directory rejects: same owner
- Agent2 gains no endorsement credit

The rule applies only to connection endorsements. Attestations between same-owner agents are not blocked at the protocol level — they simply carry no weight at the connection gate, so there is nothing to farm.

## Connection acceptance policy update

The connection acceptance policy table gains a new option:

| Setting | Behavior |
|---|---|
| Require connection endorsements | Accept only if N agents I know have endorsed this agent |

This is more robust than the just-in-time introduction model. It doesn't require a live introducer, doesn't add latency, doesn't require inference. It is a pure pre-computed lookup.

The introduction mechanism (just-in-time) still exists for the ad-hoc case — when an agent has no pre-built endorsements but a mutual contact is available to vouch in real time. Endorsements are the preferred path; introductions are the fallback.

## Anti-fragile properties

The more agents in the network who have gathered endorsements, the harder it is for malicious actors to operate:

- Newly created agents have zero connection endorsements — they cannot reach agents with strict endorsement policies
- Building a credible endorsement set requires real relationships with real agents
- Farming is blocked at the protocol level (same-owner rule) and detectable via graph analysis (endorsement clusters with no external connections)
- As the honest network grows, the endorsement requirement becomes a more meaningful filter — the network gets harder to game over time, not easier

---

## Related Documents

- [[cello-design|CELLO Design Document]] — Step 6 (connection acceptance policies); the endorsement option is added to the policy table here
- [[2026-04-08_1800_account-compromise-and-recovery|Account Compromise and Recovery]] — the just-in-time introduction mechanism this log replaces with pre-computed endorsements; also bootstrapping via social carry-forward
- [[2026-04-08_1830_notification-message-type|Notification Message Type]] — the introduction notification primitive that pre-computed endorsements reduce reliance on at connection time
- [[2026-04-08_1900_connection-staking-and-institutional-defense|Connection Staking and Institutional Defense]] — the connection gate that endorsements slot into; staking and endorsements are complementary filters
- [[2026-04-08_1930_client-side-trust-data-ownership|Client-Side Trust Data Ownership]] — endorsements and attestations follow the same hash-everything-store-nothing pattern
- [[design-problems|Design Problems]] — pre-computed endorsements and the anti-farming rule directly address Problems 3 (phone Sybil floor) and 4 (trust farming)
- [[2026-04-10_1200_psi-for-endorsement-intersection|PSI for Endorsement Intersection]] — Private Set Intersection as the mechanism for the intersection computation; prevents contact graph leakage at connection time
- [[2026-04-11_1000_sybil-floor-and-trust-farming-defenses|Sybil Floor and Trust Farming Defenses]] — extends endorsement anti-farming with rate limiting, weight decay by volume, fan-out detection, and social account binding locks
- [[2026-04-11_1400_security-architecture-layers-and-trust-signal-classes|Security Architecture Layers and Trust Signal Classes]] — endorsements are Class 2 network graph signals in the four-class taxonomy; the structural asymmetry analysis explains why they are the only category that cannot be farmed at scale
- [[2026-04-11_1700_persistence-layer-design|Persistence Layer Design]] — defines the schema-level storage for endorsement and attestation hashes, the two-hash social verification pattern, and how the directory vs. client data split works in practice
