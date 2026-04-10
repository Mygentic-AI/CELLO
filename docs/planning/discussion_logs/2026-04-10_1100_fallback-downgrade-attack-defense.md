---
name: Fallback Downgrade Attack Defense
type: discussion
date: 2026-04-10 11:00
topics: [fallback-mode, connection-policy, DDoS, degraded-mode, relay-nodes, whitelist, client-policy, sybil-defense]
description: Three-part mechanism closing the fallback downgrade attack — relay node separation, random pool selection, and a tiered client-side degraded-mode policy with asymmetric whitelist knowledge.
---

# Fallback Downgrade Attack Defense

This session addresses Design Problem 1 — the fallback mode downgrade attack — and arrives at a three-part mechanism that closes it without adding cryptographic complexity.

## The attack, restated

An attacker who has stolen K_local can force the split-key scheme to be irrelevant by DDoS-ing the directory nodes. Once agents can't reach the directory, fallback to K_local-only signing kicks in — and the attacker can impersonate the legitimate agent. At scale, a directory outage causes mass fallback, the compromise canary fires for every agent simultaneously (signal-to-noise goes to zero), and panicked owners mass self-revoke via "Not me."

## Two distinct DDoS problems

There are actually two separate DDoS vectors, requiring different treatments:

1. **Hammering** — raw volume attacks against publicly-facing infrastructure. This is a solved problem (CloudFront-style DDoS mitigation, rate limiting, anycast). CELLO inherits standard solutions here.

2. **Resource-tying** — flooding the connection layer with requests to make it unavailable for legitimate agents trying to establish new authenticated sessions. This is the vector that actually enables the fallback attack.

---

## Part 1: Relay node separation

Once a session is established through a connection node, it is handed off to relay nodes that serve only authenticated, ongoing sessions.

- **Connection nodes** — public-facing, handle new connection requests, authentication, registration, key operations. The noisy surface.
- **Relay nodes** — handle hash relay and Merkle tree operations for established sessions only. Not directly reachable from cold inbound traffic. Only reachable via already-authenticated sessions.

**What this buys:** A DDoS against connection nodes cannot reach relay nodes. Existing sessions stay on split-key and continue normally — they don't fall back because the relay infrastructure isn't under attack. The attacker must take down two distinct, differently-addressable infrastructure layers to force fallback on any established session.

**Residual gap:** New sessions. If connection nodes are overwhelmed, a new agent trying to establish a session can't get through. This is addressed by Part 3.

---

## Part 2: Random pool selection for new connections

When connection nodes are under load — whether from DDoS or legitimate heavy traffic — incoming connection requests go into a pool and are randomly sampled rather than processed FIFO.

**Why this matters:** FIFO queuing lets a flood create a hard wall. If an attacker sends 90% of requests, they block 90% of legitimate users reliably. With random selection, they still only get selected 90% of the time — 10% of legitimate users still get through. To block 99% of legitimate users they need 99% of traffic. The cost of the attack scales proportionally with its effectiveness, and it can never achieve a guaranteed wall.

This also removes the incentive structure for the attack. The attacker cannot reliably guarantee the directory appears down for any specific target. Their goal — forcing fallback for a particular agent — becomes probabilistic rather than certain.

---

## Part 3: Tiered degraded-mode policy with asymmetric whitelist knowledge

### The inversion

The current fallback assumption is: degraded mode = lower trust but still accept. This is wrong. **A degraded state is a reason to raise your guard, not lower it.** The client already has the signal — it maintains persistent connections to multiple nodes and pings them. If it can't reach a quorum, it knows it's in degraded mode. No inference needed.

**Default during degraded mode: refuse new unauthenticated connections.** The client signals a clear reason to the inbound requester — "directory unreachable, not accepting unauthenticated sessions" — so legitimate agents know to retry. Not a silent drop.

### Two separate lists

The client maintains two distinct lists, each configurable independently:

**Whitelist** — agents given preferential treatment under normal authenticated conditions. Can be a fairly long list. Does not automatically confer degraded-mode access.

**Degraded-mode list** — agents the owner trusts enough to talk to when directory authentication is completely unavailable. Expected to be much shorter. This is a stronger statement of trust: "even without the directory confirming who you are, I'm confident enough in this relationship to proceed."

An agent can be on both lists, one but not the other, or neither. The overlap is entirely the owner's decision.

**Default policy stack during degraded mode:**

| Inbound agent | Default behavior |
|---|---|
| On degraded-mode list | Accept (at reduced trust, flagged in Merkle leaf) |
| On whitelist only | Refuse — degraded mode, retry when directory is available |
| Unknown | Refuse — degraded mode |

The degraded-mode accept is still flagged — it is not a clean-trust session. The Merkle leaf records that the session was established without directory authentication. Both parties know this.

### Asymmetric whitelist knowledge

The client tracks only its own lists — who it has decided to trust. It does not track which other agents have listed it. There is no "reverse whitelist" and none is built.

**Security consequence:** An attacker who compromises the machine gets no map of who to target. They don't know which agents would accept a degraded-mode connection from the impersonated agent. They have to probe blindly — contact many agents, most of whom will refuse, burning resources and generating detectable noise in the process.

**Privacy consequence:** An agent owner cannot see who has them on their whitelist or degraded-mode list. That information belongs to the other party. Whitelist composition is private by design. Membership only reveals itself at the moment of contact — the other client accepts or refuses based on its own policy. It is never stored, never surfaced, never queryable.

This converts the attack from surgical (contact exactly the agents who will respond) to brute-force (try everyone, incur cost and noise). Not impossible, but meaningfully more expensive.

---

## What this closes

The three-part mechanism addresses the attack at every stage:

- If the attacker DDoSes connection nodes: relay node separation means existing sessions don't fall back. Random pool selection means new legitimate connections still trickle through.
- If fallback is somehow triggered for a new session: the target agent's client defaults to refusing unauthenticated connections. The attacker can't reach anyone who hasn't pre-authorized them on a degraded-mode list — a narrow, pre-identified set that requires the attacker to have already been in a known relationship.
- If the attacker is on the degraded-mode list: the session is accepted but flagged. The Merkle leaf records the degraded state. It is not a clean-trust session and cannot be used as one.

**Protocol provides primitives, clients decide policy.** CELLO provides the detectable degraded-state signal and the enforcement hooks. The tiered list structure and per-agent defaults are client policy — configurable, not mandated. This is the same principle applied in the gate pyramid for institutional defense.

---

## Related Documents

- [[design-problems|Design Problems]] — this log directly addresses Problem 1 (fallback mode as downgrade attack)
- [[cello-design|CELLO Design Document]] — Step 6 (connection acceptance policies) and Step 9 (graceful degradation); relay node separation extends the federated directory architecture
- [[2026-04-08_1700_node-architecture-and-replication|Node Architecture and Replication]] — primary/backup replication model; relay nodes extend this architecture
- [[2026-04-08_1900_connection-staking-and-institutional-defense|Connection Staking and Institutional Defense]] — the gate pyramid this degraded-mode policy extends; same principle of inference-free filtering at every layer
- [[2026-04-08_1830_notification-message-type|Notification Message Type]] — the whitelist/blacklist mechanism this log extends with a degraded-mode tier
- [[2026-04-10_1200_psi-for-endorsement-intersection|PSI for Endorsement Intersection]] — PSI and the asymmetric whitelist principle here are complementary defenses; PSI prevents contact graph leakage during connection attempts
