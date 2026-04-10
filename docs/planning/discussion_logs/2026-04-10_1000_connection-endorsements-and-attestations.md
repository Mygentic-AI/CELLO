---
name: Connection endorsements and attestations
date: 2026-04-10 10:00
description: Pre-computed endorsement system replacing just-in-time introductions, attestation as a general primitive, anti-farming rules, and bootstrapping new agents via existing networks.
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
