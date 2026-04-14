---
name: libp2p, DHT, and Peer Connectivity
type: discussion
date: 2026-04-11 14:00
topics: [transport, libp2p, DHT, peer-discovery, NAT, relay-nodes, routing, directory, peer-identity, architecture, merkle-tree, websocket, bootstrap, certificate-pinning, npm-distribution]
description: Technical feasibility vetting of the full CELLO connection stack — bootstrap discovery, directory authentication, ephemeral Peer IDs, three-layer NAT traversal, dual-path hash relay, and the Merkle chain as implicit ACK. Each step traced to known technology.
---

# libp2p, DHT, and Peer Connectivity

This log documents the technical vetting of CELLO's transport layer. The goal is to confirm that the design vision and technical feasibility align at every step — so that implementation does not discover architectural problems after the fact. Each mechanism is traced to known, proven technology.

---

## The System Layer Model

CELLO's architecture divides cleanly into four layers. These were established during this session and provide the organizing framework for all transport discussion below.

1. **Transport / crypto** — how agents find directory nodes, establish connections, exchange messages with cryptographic guarantees. The subject of this document.
2. **Node integrity** — how the network defends itself from structural attacks: DDoS, Sybil resistance, farming detection, rate limiting. Protects the *network*.
3. **Client protection** — prompt injection defense, content scanning, the gate pyramid. Protects the *individual agent's reasoning process*. Distinct goal from layer 2: a fully defended network with no client protection still allows a trusted sender to manipulate a receiving agent through message content.
4. **Trust signals** — the four classes (identity proofs, network graph, track record, economic stake) used to evaluate the trustworthiness of a connection or agent.

Layers 2 and 3 are intentionally separate because they defend different surfaces. Layer 2 points outward at attackers; layer 3 points inward at received content.

---

## Part 1: Bootstrap — How a Client Finds Its First Directory Node

A brand new client knows nothing about the network. It needs to find a directory node before anything else can happen. This is the bootstrap problem. Every serious P2P network (Bitcoin, Ethereum, IPFS) solves it the same way: a layered fallback chain.

### The three-level fallback chain

**Level 1 — Signed manifest (bundled with client)**

A JSON file listing current directory nodes, signed by the consortium's private key, bundled inside the npm package. Verification is fully local: the consortium's public key is a constant in the client source code. No network request required to verify. If anyone tampers with the manifest — changing a node address, inserting a rogue node — the signature verification fails immediately and the client rejects it.

The client tries the nodes in this manifest first on every startup. If they are reachable, bootstrap is complete. The manifest can be updated without a full client release via the npm update path.

**Level 2 — DNS seeds**

If all manifest nodes are unreachable (manifest is stale, nodes have been decommissioned), the client falls back to resolving well-known DNS names (`bootstrap1.cello.network`, etc.). DNS records can be updated by the consortium as nodes change — no client release required. Fails only when DNS itself is unavailable.

**Level 3 — Hardcoded Elastic IP redirectors**

If DNS is also unavailable (blocked, hijacked, infrastructure failure), the client falls back to raw IP addresses hardcoded in the client binary. These are not full directory nodes — they are minimal bootstrap servers whose only function is: receive a connection, return the current signed node list. One or two AWS Elastic IPs maintained by the consortium. The response is the same signed manifest as Level 1, served over a direct IP connection that bypasses DNS entirely.

These servers are trivially cheap to operate (small EC2 instance, reserved Elastic IP) and must never lapse in payment — a released Elastic IP acquired by someone else would receive every bootstrap attempt from clients that can't reach Levels 1 or 2.

### Why this layering is about resilience, not security

Nothing in the bootstrap mechanism is secret. The DNS names are public. The Elastic IPs are public. Security does not come from hiding how you find nodes — it comes from what happens after you find one.

**Certificate pinning + bidirectional authentication** is the actual security mechanism. When the client connects to any node found through any of the three levels, authentication is bidirectional:

- Client proves its identity via challenge-response (Ed25519, signs a nonce bound to agent ID + directory node ID + timestamp)
- Directory proves it is a legitimate consortium node by signing its own challenge response against consortium keys pinned in the client

An attacker who operates a rogue IP, hijacks DNS, or tampers with the manifest cannot produce a valid signature for the consortium's pinned keys. The authentication step rejects them. Getting you to connect to a rogue node is useless if you verify it cryptographically before trusting it.

### The TypeScript trust anchor

The CELLO client is a TypeScript npm package. The consortium's public key is a constant in the source. The security of that constant depends on the npm package being authentic.

**Solution: npm pinned distribution with package provenance.**

- The client is published to npm at a specific pinned version (`@cello/mcp-server@1.2.3`)
- npm stores the sha512 checksum of the package tarball in the registry
- On install, npm verifies the downloaded package against that checksum — any tampering, including by npm infrastructure or CDN, fails verification
- The checksum is recorded in `package-lock.json`, committed to source control
- npm package provenance (via Sigstore/OIDC) proves the package was built from a specific commit in a specific CI pipeline

The trust chain: CI pipeline → signed npm package → checksum-verified install → public key constant in source. Modifying the public key requires modifying the package, which changes the checksum, which fails verification.

---

## Part 2: The Directory Connection

### Persistent bidirectional WebSocket

On startup, the client establishes an outbound WebSocket connection (TLS, port 443) to its chosen directory node. This connection:

- Is initiated by the client (outbound) — works through any NAT, looks like HTTPS
- Stays open for the entire online session
- Is **bidirectional** — once established, the directory can push data to the client at any time through the same connection without initiating a new connection

This bidirectionality is critical and resolves the apparent "inbound" problem: the directory never needs to reach the client at a new address. All directory-to-client communication — hash relay, connection requests, notifications — travels through the client's existing persistent WebSocket. Like a phone call: the client dialled, the line is open, the directory can speak without redialling.

### Bidirectional challenge-response authentication

On WebSocket connection:

1. Client identifies itself: "I am Agent X"
2. Directory sends a nonce (256-bit CSPRNG, single-use, short expiry)
3. Client signs: `sign(nonce + agent_id + directory_node_id + timestamp, K_local)`
4. Directory verifies signature against registered public key
5. Client verifies the directory's identity: directory signs its own challenge response; client checks against consortium's pinned node keys
6. Authenticated session established — both sides have verified each other

Neither side trusts the other until both have verified. A rogue node fails step 5.

### Ephemeral Peer IDs — how CELLO differs from standard libp2p

Standard libp2p derives a stable Peer ID from the node's long-term public key. CELLO does not use this model. CELLO agents use **ephemeral Peer IDs** — generated fresh for each session.

The stable identity in CELLO is the agent's long-term key pair (the FROST keys used for message signing and directory authentication). The Peer ID is a transport-layer session handle, not an identity. Generating a fresh Ed25519 key pair per session is computationally trivial (microseconds).

**Privacy benefit:** A passive observer watching network traffic sees different Peer IDs for each session and cannot correlate "Agent X's session on Monday" with "Agent X's session on Tuesday" without access to the directory.

**Privacy cost (known, scoped):** The directory knows the mapping from stable identity to current ephemeral Peer ID, because the directory handles the signaling (see Part 3). This is the home node deanonymization problem (Design Problem 7) — the ephemeral scheme protects against external observers, not against the home node operator. This is a known, scoped risk.

---

## Part 3: Establishing a P2P Session Between Agents

This section covers what happens after Agent B accepts Agent A's connection request.

### Step-by-step

**1. Both clients generate ephemeral key pairs**

Both A's client and B's client independently generate a fresh Ed25519 key pair. The public key becomes the ephemeral libp2p Peer ID for this session. On session end, both key pairs are destroyed. No record of the Peer IDs is retained.

**2. Both clients start libp2p listeners and run AutoNAT**

Each client starts a libp2p listener on a local port and runs AutoNAT — asking nearby nodes "can you reach me at this address?" — to discover what external address the internet sees for them. This handles NAT: the client learns its public-facing address, if any.

**3. Signaling via directory WebSocket**

The directory's existing WebSocket connections serve as the signaling channel — the same role a STUN/ICE server plays in WebRTC:

```
A → directory (WebSocket):  "My ephemeral Peer ID is X, candidate addresses: [...]"
Directory → B (WebSocket):  forwards A's Peer ID and addresses
B → directory (WebSocket):  "My ephemeral Peer ID is Y, candidate addresses: [...]"
Directory → A (WebSocket):  forwards B's Peer ID and addresses
Directory discards both. Not stored.
```

Now A knows how to reach B and vice versa. The directory's role in signaling is complete.

**4. NAT traversal — three-layer fallback**

P2P connection is attempted in order:

**Layer 1: Direct P2P over UDP/TCP (DCuTR hole punching)**

libp2p's DCuTR protocol: both peers attempt to connect to each other simultaneously. The simultaneous outbound packets punch holes in both NATs, and the crossing packets open a direct path.

Success rate in practice: ~70–80% for home and standard office networks. Fails for symmetric NAT (see below).

**Layer 2: Circuit relay**

When hole punching fails, a circuit relay is used. Both A and B connect outbound to a relay node. The relay bridges the two outbound connections. Neither side needs to accept an inbound connection.

**Why this works when direct P2P fails — symmetric NAT:**

Most home routers use cone NAT: A gets the same external port regardless of destination. Hole punching works because B can predict A's port. Symmetric NAT assigns A a *different external port for every different destination*. When A coordinates the hole punch via a relay, A uses port 50001 for the relay. When B then tries to reach A directly, A's NAT assigns a different port (50002) for B's IP — the prediction fails, the connection is rejected.

Circuit relay sidesteps this: A connects outbound to relay (port 50001), B connects outbound to relay (port 50002), the relay bridges the two connections. No port prediction required. Both connections are outbound from A and B's perspective — any NAT allows them.

**Layer 3: libp2p WebSocket transport over port 443**

Some corporate firewalls block all non-443 traffic entirely. libp2p supports WebSocket as a transport, tunneling the P2P connection over TLS on port 443. This passes through essentially every network because it is indistinguishable from HTTPS. The connection is still P2P (between A and B directly or via relay), still end-to-end encrypted, still never touching the directory for message content.

**Technical feasibility confirmation:** All three layers are implemented in libp2p's existing stack. DCuTR, circuit relay, and WebSocket transport are production features. No novel technology required.

### Relay node architecture

Circuit relay nodes are separate from directory nodes and are operated by different entities. This is a protocol constraint, not a preference.

**Privacy rationale:** The relay node sees the ephemeral Peer IDs of A and B and encrypted traffic (not content). The directory sees the mapping from real agent identity to current ephemeral Peer ID — it handled the signaling. An operator controlling both can correlate: look up the ephemeral Peer ID in the directory signaling record, resolve it to a real identity, and link the relay session to that identity. Separating relay and directory means this correlation requires compromising two independent systems.

**Performance rationale:** Directory nodes handle signaling, hash relay, and authentication across many concurrent sessions. Circuit relay nodes are latency-sensitive forwarding infrastructure sitting in the connection path for the ~20–30% of sessions that cannot hole-punch. The resource profiles differ. Combining them degrades both: relay traffic competes with hash relay and signaling for the same resources. Separation also lets relay capacity scale independently of directory capacity.

**Who operates relay nodes:** The specific model (dedicated CELLO relay infrastructure, Consortium-phase directory operators under a separate relay agreement, or a hybrid) is a governance and operations decision for later phases. The constraint is the separation itself — relay and directory must not be the same operator entity.

---

## Part 4: The Dual-Path Architecture During a Session

Once the P2P connection is established, two parallel paths run simultaneously for the life of the session.

**Message path — P2P only:**
```
A → B directly (via libp2p P2P connection)
```
The directory never sees message content. The directory never touches this path. This is the core privacy guarantee — architectural, not a promise.

**Hash path — via directory WebSocket:**
```
A → directory (A's persistent WebSocket): signed hash of message
Directory → B (B's persistent WebSocket): hash + canonical sequence number
```

Both paths carry the same signed hash. A embeds the signed hash in the P2P message AND sends it independently to the directory. The directory assigns a canonical sequence number (the authoritative ordering of the conversation) and pushes it to B via B's WebSocket.

**B's verification on receiving a message:**
1. Receives message + embedded signed hash via P2P
2. Receives hash + sequence number from directory via WebSocket
3. Computes `SHA-256(received message)` locally
4. Compares to hash received from directory
5. Match → no man-in-the-middle, message is authentic
6. Mismatch → reject, log as trust event, escalate

**Why the inbound direction is not a problem:**

The directory does not initiate a new connection to push hashes to B. It pushes through B's existing persistent WebSocket — the same outbound connection B established at login. The NAT tracks this connection as an active session and allows traffic in both directions. No new inbound connection is required.

---

## Part 5: The Merkle Chain as Implicit ACK

A separate per-message acknowledgment protocol is not needed. The Merkle chain provides implicit cumulative acknowledgment automatically.

Every message leaf includes `prev_root` — the hash of the entire conversation state up to that point:

```
leaf = SHA-256(
  0x00                    ← leaf node marker (RFC 6962)
  sender_pubkey
  sequence_number
  message_content
  scan_result
  prev_root              ← hash of entire prior conversation history
  timestamp
)
```

When B sends a response, B's message includes a `prev_root` that chains through A's last message. This is a signed cryptographic assertion: "I built this message on top of a conversation tree that includes A's message with this exact hash." It is not just an acknowledgment of one message — it is a cumulative verification of the entire conversation history up to that point.

If B had received a tampered message, B's independently computed `prev_root` would diverge. That divergence becomes immediately visible when B's hash arrives at the directory.

**No separate ACK mechanism is needed.** Mid-conversation, every outbound message from either party implicitly verifies all prior messages.

### The last message problem

The implicit ACK requires a response. The final message in any conversation has no response and therefore no implicit ACK. If A sends the last message, B has not cryptographically acknowledged receiving it.

**Solution: the CLOSE/CLOSE-ACK protocol.**

1. Party A sends a CLOSE control leaf (signed, hashed, includes `prev_root` chaining through all messages, carries A's CLEAN or FLAGGED attestation)
2. Party B receives it, sends CLOSE-ACK (also signed, hashed, includes `prev_root` chaining through A's final message and A's CLOSE leaf, carries B's independent CLEAN or FLAGGED attestation)
3. Directory notarizes the close — both parties' final hashes recorded, directory signs a SEAL

B's CLOSE-ACK is the terminal acknowledgment. It includes `prev_root` that chains through A's final message. This makes A's final message as provable as every other message in the chain.

**SEAL-UNILATERAL:** If B never sends CLOSE-ACK, A submits the close to the directory unilaterally. The directory records the conversation as "closed by A, unacknowledged by B." This is a permanent record that the final ACK never came — meaningful for dispute resolution.

The closing handshake is not ceremony. It is the mechanism that gives the final message the same non-repudiation guarantee as every message before it.

### Summary of ACK coverage

| Scenario | Acknowledgment mechanism |
|---|---|
| Mid-conversation message | Implicit via `prev_root` in next outbound message |
| Final message (CLOSE received and ACKed) | Explicit via CLOSE-ACK including `prev_root` |
| Final message (B disappears) | SEAL-UNILATERAL records missing ACK permanently |

---

## Part 6: Technical Feasibility Assessment

Each mechanism in the transport layer has been traced to known, production-ready technology:

| Mechanism | Technology | Status |
|---|---|---|
| Signed manifest verification | Ed25519 signature verification | Standard cryptography |
| DNS seed discovery | Standard DNS resolution | Universally available |
| Certificate pinning + bidirectional auth | Challenge-response, Ed25519 | Standard protocol design |
| npm package integrity | npm checksum + Sigstore provenance | Production npm feature |
| Persistent bidirectional WebSocket | WebSocket protocol (RFC 6455) | Universal |
| Ephemeral Peer ID generation | Ed25519 key generation | Microsecond operation |
| Directory as signaling channel | WebSocket message relay | No novel technology |
| AutoNAT address discovery | libp2p AutoNAT | Production libp2p feature |
| DCuTR hole punching | libp2p DCuTR | Production libp2p feature |
| Circuit relay fallback | libp2p circuit relay v2 | Production libp2p feature |
| WebSocket transport over port 443 | libp2p WebSocket transport | Production libp2p feature |
| Dual-path hash relay | Two independent channels per session | Standard networking |
| Merkle chain with prev_root | SHA-256 chaining | Standard cryptography |
| CLOSE/CLOSE-ACK protocol | Signed control leaves | Designed, no novel tech |

**NAT traversal success rate:** DCuTR hole punching succeeds for approximately 70–80% of home and standard office networks. The remaining ~20–30% is covered by circuit relay. libp2p WebSocket transport over port 443 handles the edge cases (corporate restrictive firewalls). Combined coverage is effectively universal.

---

## Open Questions

1. **Ephemeral Peer ID performance at scale:** Ed25519 key generation is microseconds, but spinning up a full libp2p instance per session may have overhead at high connection volumes. Needs profiling.

2. **Session resumption within a short window:** If an agent briefly disconnects and reconnects (network hiccup), should it receive the same ephemeral Peer ID or a new one? Matters for in-flight message delivery. Currently unspecified.

3. **Bootstrap manifest update cadence:** How often is the signed manifest updated? What is the process when a directory node is decommissioned?

---

## Related Documents

- [[2026-04-11_1400_security-architecture-layers-and-trust-signal-classes|Security Architecture Layers and Trust Signal Classes]] — the four-layer system model that situates this document as Layer 1; the layer taxonomy and trust signal classes that the transport layer serves
- [[end-to-end-flow|CELLO End-to-End Protocol Flow]] — comprehensive protocol narrative; the transport mechanics described here underpin the connection and session phases
- [[2026-04-08_1530_message-delivery-and-termination|Message Delivery and Termination]] — delivery failure modes across the dual-path architecture; the Merkle chain and CLOSE/CLOSE-ACK mechanics described here are the transport foundation for that document's failure tree
- [[cello-design|CELLO Design Document]] — Step 3 (directory authentication), Step 6 (session establishment, dual-path hash relay), Step 7 (Merkle tree, prev_root, CLOSE/CLOSE-ACK), Federation section (node architecture, home node model)
- [[2026-04-10_1100_fallback-downgrade-attack-defense|Fallback Downgrade Attack Defense]] — relay/connection node separation as DDoS defense; the node separation principle described here parallels the relay/directory separation question
- [[2026-04-08_1930_client-side-trust-data-ownership|Client-Side Trust Data Ownership]] — hash-everything-store-nothing constraint; the dual-path architecture (hash to directory, message P2P) is the transport implementation of this principle
- [[2026-04-08_1700_node-architecture-and-replication|Node Architecture and Replication]] — primary/backup replication, WebSocket infrastructure, three-phase node deployment
- [[prompt-injection-defense-layers-v2|Prompt Injection Defense Layers]] — the client protection layer (layer 3 of the system model); operates after message delivery, before agent processing
- [[2026-04-11_1700_persistence-layer-design|Persistence Layer Design]] — the persistent bidirectional WebSocket enables the live directory query (pseudonym → track record stats) central to the track record model; key provider abstraction addresses how agents manage local data across deployment contexts
- [[2026-04-13_1500_multi-party-conversation-design|Multi-Party Conversation Design]] — extends the two-party dual-path transport here to N-party; evaluates full mesh P2P, GossipSub, and encrypted relay for group message delivery; directory WebSocket fan-out for the hash path
- [[2026-04-14_1300_connection-request-flow-and-trust-relay|Connection Request Flow — Trust Data Relay and Selective Disclosure]] — defines everything that happens before the ephemeral peer ID exchange here; trust data relay and one-round negotiation precede the signaling handshake
