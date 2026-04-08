# CELLO Protocol Adversarial Security Review

## 1. Man-in-the-Middle Attacks

### 1.1 Dual-Path MITM: Attacker Controls Both Hash Relay and Message Path

**Severity:** Critical

**Attack vector:** Active MITM who controls network infrastructure between both agents and the directory (e.g., corporate proxy, ISP-level, compromised router on shared network segment)

**Attack description:**
1. Agent A sends hash H(M) to directory over WebSocket (Step 7, line 467-477)
2. Agent A sends message M to Agent B over the message transport
3. Attacker intercepts message M on the message path, replaces with M'
4. Attacker intercepts hash H(M) on the WebSocket path, replaces with H(M')
5. Directory stores H(M'), relays H(M') to Agent B
6. Agent B receives M', computes H(M'), compares to relayed H(M') -- match
7. Agent B believes M' is authentic

The entire MITM defense rests on the assumption that hash path and message path are independent (line 483: "Hash travels a different path than the message"). But if an attacker controls the network segment between Agent A and the outside world, **both paths originate from the same network egress point**. The "different path" is a logical separation, not a physical one.

**Detectability:** Undetectable by Agent B. The directory stores H(M') which is internally consistent. Agent A's local Merkle tree contains H(M), so a Merkle root comparison between A and the directory would eventually reveal the divergence -- but only if A explicitly requests a root comparison, which the protocol does not specify as mandatory per-message.

**Impact:** Complete message integrity failure. Attacker can modify any message content while maintaining cryptographic consistency from B's perspective.

**Mitigation:** The hash must be **signed by Agent A** before submission. The protocol mentions signatures on connection requests (line 323: "Request carries Agent A's original signature") but the hash relay flow in Step 7 does not explicitly state that the hash submitted to the directory is signed by the sender. If the hash leaf includes `sender_pubkey` and is signed (line 489-498), and if the directory verifies this signature before relaying, then the attacker cannot replace H(M) with H(M') without also forging A's signature. **Design gap: the doc must explicitly specify that the hash submitted to the directory is signed by the sender's key and that the directory verifies this signature before storing/relaying.**

### 1.2 Compromised Directory Node as MITM

**Severity:** Critical

**Attack vector:** Compromised consortium node operator

**Attack description:**
1. Agent A's home node is compromised
2. Agent A sends signed hash H(M) to the compromised node
3. The compromised node withholds H(M) and does not relay it to Agent B
4. The compromised node fabricates a different hash H(M') and relays it to Agent B
5. Agent B receives real message M from A, computes H(M), but the relayed hash is H(M')
6. Agent B concludes the message was tampered with -- false positive, destroying trust between A and B

Alternatively, the compromised node relays the correct hash but records a different hash in its own tree, creating evidence that can be weaponized in dispute resolution.

**Detectability:** Agent B would detect a hash mismatch and flag tampering. But the actual tampering was by the directory, not the message path. Agent A's local tree would have H(M), the directory's tree would have something else. This would surface during Merkle root comparison, but blame attribution is ambiguous.

**Impact:** Denial of service (false tampering alerts), destruction of trust relationships, manipulation of dispute resolution outcomes.

**Mitigation:** The signed hash from Agent A should be relayed verbatim to Agent B. Agent B should verify A's signature on the hash directly, not trust the directory's version. If the directory modifies the hash, it can't forge A's signature. The doc mentions that connection requests carry end-to-end signatures (line 323, line 900), but does not explicitly state that **hash relay messages carry end-to-end signatures that the receiver verifies independently of the directory**. **Design gap: specify that hash relay payloads are end-to-end signed by the sender and verified by the receiver against the sender's public key, making directory forgery detectable.**

### 1.3 DNS Poisoning to Redirect WebSocket Connections

**Severity:** High

**Attack vector:** DNS poisoning (local network, resolver, or cache poisoning)

**Attack description:**
1. Attacker poisons DNS to resolve directory node hostnames to attacker-controlled IP
2. Agent connects via WebSocket to the fake directory
3. If TLS certificate validation is not strict (e.g., agent uses a custom CA store, or the attacker has a valid cert for a similar domain), the agent authenticates to the fake directory
4. Fake directory performs challenge-response, but it now holds the agent's session
5. Fake directory can selectively relay, modify, or withhold hashes

**Detectability:** If TLS certificate pinning is used, the connection fails immediately (detectable). Without pinning, undetectable unless the agent verifies checkpoint hashes against other nodes.

**Impact:** Complete compromise of the agent's directory session. All hash relay, connection requests, and discovery queries are under attacker control.

**Mitigation:** TLS certificate pinning for directory node connections. The open question about node bootstrap (line 1058: "how does the client get its initial list of trusted directory nodes?") is security-critical. **Design gap: the doc does not specify TLS certificate pinning, node identity verification beyond TLS, or a secure bootstrap mechanism for the initial node list.**

### 1.4 TLS Interception via Compromised CA or Corporate Proxy

**Severity:** High

**Attack vector:** Corporate MITM proxy with installed root CA, or compromised public CA

**Attack description:**
1. Corporate environment installs a root CA on all machines
2. Proxy terminates TLS for all WebSocket connections, including to directory nodes
3. Proxy can read, modify, or selectively relay all hash relay traffic
4. Agent's split-key signing still works (K_local is local), but hash integrity is compromised

**Detectability:** Certificate pinning would detect this. Without pinning, undetectable at the application layer.

**Impact:** Same as 1.3 -- full control over the hash relay channel.

**Mitigation:** Certificate pinning. Additionally, the SDK should verify the directory node's identity using the node's consortium signing key, not just TLS. **Design gap: no specification of certificate pinning or out-of-band node identity verification.**

---

## 2. Replay Attacks

### 2.1 Cross-Conversation Connection Request Replay

**Severity:** High

**Attack vector:** Passive observer who captured a previous connection request, or compromised directory node with historical data

**Attack description:**
1. Agent A sends a signed connection request to TravelBot through the directory (Step 5, line 318-324)
2. Attacker captures this signed request (from network observation or compromised node logs)
3. Days later, attacker replays the connection request to TravelBot
4. TravelBot receives what appears to be a valid, signed connection request from Agent A
5. TravelBot may accept, establishing a session that Agent A did not initiate

**Detectability:** Agent A would not know a connection was established in its name. TravelBot would see a valid request. If out-of-band notifications work correctly (Step 9), Agent A's owner would be notified -- but the doc says normal conversation starts are "silent log" (line 579), not push alerts.

**Impact:** Impersonation. An attacker can initiate connections on behalf of any agent whose connection request was previously observed.

**Mitigation:** Connection requests must include a nonce, timestamp, and target agent ID, all within the signed payload. The directory must reject requests with stale timestamps or reused nonces. **Design gap: the doc does not specify what fields are included in the signed connection request payload, whether nonces are used, or what the timestamp validity window is.**

### 2.2 Cross-Conversation Message Replay

**Severity:** Medium

**Attack vector:** Passive observer or compromised directory node

**Attack description:**
1. In conversation C1, Agent A sends message M with sequence number 5
2. Attacker records the signed message and its hash
3. In a new conversation C2 between A and B, attacker injects the recorded message
4. The sequence number prevents replay within C1, but the leaf format (line 489-498) does not include a conversation/session identifier
5. If B's Merkle tree for C2 is at sequence 5, the replayed message might be accepted

**Detectability:** The `prev_root` field (line 498) chains to the previous state, so the replayed message's `prev_root` would not match C2's current root. This provides some protection. However, the very first message of a conversation (sequence 1) has no meaningful `prev_root` to chain to.

**Impact:** Limited due to `prev_root` chaining for messages after the first, but the first message of any conversation is potentially replayable.

**Mitigation:** Include a session/conversation identifier in the leaf format. Include the initial handshake nonce or session establishment token in the first message's signed payload. **Design gap: the leaf format (line 489-498) does not include a conversation or session identifier.**

### 2.3 Challenge-Response Nonce Replay

**Severity:** Medium

**Attack vector:** Compromised directory node or network observer

**Attack description:**
1. Agent authenticates to the directory via challenge-response (Step 3, line 222-228)
2. Directory sends nonce N, agent signs N with K_local, directory verifies
3. If the nonce N is predictable or reusable across nodes, an attacker could replay the signed nonce to another node
4. The doc says "random challenge (nonce)" but does not specify: minimum entropy, scope (must include node ID), expiration, single-use guarantee

**Detectability:** If nonces are properly scoped and single-use, replay fails immediately. If not, undetectable.

**Impact:** Session hijacking on a different directory node -- attacker authenticates as the victim agent.

**Mitigation:** Nonces must include the target node's identity, a timestamp, and be cryptographically random (minimum 256 bits). They must be single-use and expire within seconds. **Design gap: nonce generation, scoping, and expiration requirements are not specified.**

---

## 3. Timing Attacks

### 3.1 Hash-Message Ordering Exploitation

**Severity:** Medium

**Attack vector:** Active network attacker with ability to delay packets

**Attack description:**
1. The protocol flow (line 467-477) shows: hash sent to directory (step 2), then message sent to B (step 4), then directory relays hash to B (step 5)
2. The expected ordering is: B receives hash from directory, then receives message, then compares
3. What if the message arrives before the hash? Does B buffer the message? For how long?
4. An attacker who can delay the hash relay (e.g., by slowing the WebSocket path) can create a window where B has received a message but has no hash to verify against
5. During this window, the attacker could send a modified message on the same path, hoping B accepts the first-arrived version
6. Alternatively, if B has a timeout and accepts messages without hash verification after T seconds, the attacker just needs to delay the hash beyond T

**Detectability:** If B logs timing discrepancies, detectable in retrospect. Real-time detection depends on implementation.

**Impact:** Message integrity bypass during the hash-arrival gap.

**Mitigation:** The SDK must buffer incoming messages and not deliver them to the agent until hash verification completes. There must be a hard timeout after which the message is rejected (not accepted without verification). **Design gap: the doc does not specify the expected ordering, buffering behavior, or timeout policy for hash-message synchronization.**

### 3.2 Traffic Analysis via Hash Relay Timing

**Severity:** Medium

**Attack vector:** Passive observer of directory traffic, or compromised directory node

**Attack description:**
1. The directory sees every hash arrive with a timestamp and agent ID
2. By correlating hash submission times between two agents, the directory (or anyone with access to its logs) can reconstruct conversation patterns: who talks to whom, when, how often, message frequency, conversation duration
3. Even with encrypted WebSocket transport, the directory **must** see agent IDs and timestamps to function -- this is inherent to the architecture
4. A compromised consortium node operator can build a complete social graph of all agents using their node

**Detectability:** Undetectable by agents -- this is metadata the directory needs to function.

**Impact:** Privacy violation. Complete social graph construction. Conversation pattern analysis.

**Mitigation:** This is partially acknowledged in the doc but not addressed. Possible mitigations: traffic padding (agents send dummy hashes at regular intervals), onion routing of hash relay through multiple nodes, or mixing/batching hashes to obscure timing. **Design gap: the doc acknowledges privacy concerns implicitly ("The service never sees message content") but does not address metadata privacy at all.**

### 3.3 Side-Channel Timing in Split-Key Operations

**Severity:** Low

**Attack vector:** Co-located process on the same machine, or precise network timing measurement

**Attack description:**
1. Split-key signing requires combining K_local + K_server (line 920-930)
2. The agent requests K_server shares from two directory nodes and combines locally
3. The time to request, receive, and combine shares varies based on network latency to each node
4. A co-located attacker could measure timing differences in the signing operation to infer which nodes hold shares
5. More critically: if the threshold combination operation has data-dependent timing (not constant-time), the attacker could recover key material

**Detectability:** Extremely difficult to detect.

**Impact:** Low probability of key recovery, but information leakage about node-share assignments.

**Mitigation:** All cryptographic operations must be constant-time. K_server share requests should be padded to uniform timing. **Design gap: no specification of constant-time requirements for cryptographic operations.**

---

## 4. WebSocket Exploitation

### 4.1 Connection Exhaustion (Slowloris-Style)

**Severity:** High

**Attack vector:** Any network participant (no authentication required to initiate WebSocket handshake)

**Attack description:**
1. The directory maintains persistent WebSocket connections with all online agents (line 228-229)
2. An attacker opens thousands of WebSocket connections to the directory node
3. Each connection completes the HTTP upgrade but sends data very slowly (one byte per 30 seconds), keeping the connection alive
4. The directory's connection pool is exhausted
5. Legitimate agents cannot connect or maintain their sessions
6. This is a pre-authentication attack -- the attacker doesn't need valid credentials

**Detectability:** Detectable via connection monitoring (many connections from same IP, connections with minimal data transfer). But distributed slowloris from a botnet is harder to detect.

**Impact:** Denial of service against the directory node. Agents cannot authenticate, discover, or relay hashes.

**Mitigation:** Connection rate limiting per IP. Require the challenge-response authentication to complete within a strict timeout (e.g., 5 seconds). Close connections that don't authenticate within the timeout. Use connection-level keepalive with aggressive timeouts. **Design gap: the doc mentions a strike system for malformed messages (line 697) but does not address pre-authentication connection exhaustion.**

### 4.2 WebSocket Session Token Management

**Severity:** High

**Attack vector:** Network observer or compromised CDN/proxy

**Attack description:**
1. After challenge-response authentication (Step 3), the agent has an "authenticated session" (line 229)
2. The doc does not specify how this session is maintained. Options: the WebSocket connection itself is the session (connection loss = re-auth required), or a session token is issued
3. If a session token is issued and transmitted in WebSocket frames, an attacker who captures the token can hijack the session
4. If the WebSocket connection itself is the session, TLS protects it -- but reconnection after network disruption requires full re-authentication, which the doc doesn't address

**Detectability:** If session tokens are used, token theft is undetectable until the legitimate agent attempts to use the same session. If connection-based sessions are used, the hijack would disconnect the legitimate agent (detectable).

**Impact:** Session hijacking allows the attacker to submit hashes, receive connection requests, and act as the agent on the directory.

**Mitigation:** WebSocket connections should be the session (no bearer tokens). Reconnection should require re-authentication. If session tokens are necessary for reconnection, they must be short-lived, bound to the client's TLS session, and single-use. **Design gap: session management after authentication is completely unspecified.**

### 4.3 WebSocket Frame Fragmentation

**Severity:** Low

**Attack vector:** MITM with ability to modify WebSocket frames

**Attack description:**
1. The doc specifies a "rigid JSON schema" for WebSocket messages (line 686-695)
2. WebSocket frames can be fragmented -- a single logical message can arrive in multiple frames
3. If the JSON parser accepts partial frames and processes them before the full message is assembled, an attacker could inject content between fragments
4. Most WebSocket libraries handle reassembly correctly, but custom implementations might not

**Detectability:** Would manifest as malformed JSON or schema validation failures.

**Impact:** Low -- likely caught by JSON schema validation. But could cause parser crashes or undefined behavior in edge cases.

**Mitigation:** Ensure the WebSocket implementation fully reassembles fragmented messages before passing to JSON parser. Set maximum message size limits. **This is an implementation concern more than a protocol gap, but the doc should specify maximum message sizes.**

---

## 5. Race Conditions

### 5.1 Simultaneous Message Sequence Number Collision

**Severity:** High

**Attack vector:** Normal operation (no attacker needed) or deliberate timing by malicious agent

**Attack description:**
1. Agent A and Agent B are in a conversation
2. Both send a message at approximately the same time
3. Both assign the next sequence number based on their local state
4. If A is at sequence 5 and B is at sequence 5, both might assign sequence 6
5. The directory receives two hashes with sequence 6 from different senders
6. The Merkle trees diverge: A's tree has A's message at seq 6, B's tree has B's message at seq 6
7. The directory has to pick an ordering, but the protocol doesn't specify a deterministic tie-breaking rule

The doc acknowledges this (line 1065: "Race conditions -- what if both agents send simultaneously?") but does not resolve it.

**Detectability:** Immediately detectable -- Merkle roots diverge across all three parties.

**Impact:** Merkle tree corruption. The three copies (sender, receiver, directory) cannot agree on the tree structure. Dispute resolution becomes impossible for this conversation.

**Mitigation:** Sequence numbers must be global to the conversation, not per-sender. Options: (a) the directory assigns sequence numbers to hashes as they arrive (first-come-first-served), (b) use Lamport timestamps, (c) use the hash submission timestamp at the directory as the canonical ordering. **Design gap: acknowledged in open questions but unresolved. This is a correctness bug, not an edge case.**

### 5.2 Connection Accept/Revoke Race

**Severity:** High

**Attack vector:** Timing-dependent, could be exploited by an attacker who can trigger both events

**Attack description:**
1. Agent A sends a connection request to Agent B
2. Simultaneously (or just after), Agent A's owner taps "Not me" to revoke K_server
3. Agent B's SDK is processing the connection request -- verifying A's signature against A's primary public key
4. The directory revokes A's K_server, which changes A's primary public key
5. Depending on timing: B might accept the connection with a key that was valid at verification time but is now revoked, or B's verification might fail mid-process

**Detectability:** B would not know the key was revoked if the revocation propagates after B's verification completed.

**Impact:** B establishes a session with an agent whose key has been revoked (possible compromise scenario). Or B rejects a valid request due to mid-flight revocation.

**Mitigation:** Key revocation must include a "revoked-at" timestamp. The connection request must include a "signed-at" timestamp. B should reject connections where the signature timestamp is too close to (or after) the revocation timestamp. Alternatively, connection acceptance should re-verify the key immediately before finalizing. **Design gap: no specification of how key revocation interacts with in-flight operations.**

### 5.3 Key Rotation During Active Signing

**Severity:** Medium

**Attack vector:** Normal operation during scheduled K_server rotation

**Attack description:**
1. The directory rotates K_server on a schedule (line 377-384: "Monday: K_server_v1, Tuesday: K_server_v2")
2. Agent A is mid-conversation, about to sign a message with K_local + K_server_v1
3. The directory rotates to K_server_v2
4. Agent A signs with K_server_v1, but the directory now expects K_server_v2
5. The signature verification fails -- the message appears to be fallback-signed (K_local only) or invalid

**Detectability:** Would appear as a sudden drop from primary to fallback signing -- triggering the compromise detection system (false alarm).

**Impact:** False compromise alerts. Potential session disruption. If the owner panics and taps "Not me," the agent is unnecessarily revoked.

**Mitigation:** Key rotation must have an overlap period where both K_server_v1 and K_server_v2 are valid. The agent must be notified of rotation and must acknowledge before the old key is invalidated. **Design gap: no specification of rotation overlap period, agent notification, or grace period.**

### 5.4 Hash Submission During Checkpoint Computation

**Severity:** Medium

**Attack vector:** Normal operation or deliberate timing

**Attack description:**
1. The directory periodically checkpoints the identity Merkle tree (line 835-836)
2. While a checkpoint is being computed, new hashes arrive for the message Merkle tree
3. If the checkpoint computation locks state, incoming hashes may be dropped or delayed
4. If the checkpoint computation does not lock state, the checkpoint might include a partial state

**Detectability:** Dropped hashes would be detected by the sender (their local tree and the directory tree diverge). Partial state would cause checkpoint hash divergence between nodes.

**Impact:** Temporary integrity gaps or checkpoint desynchronization between nodes.

**Mitigation:** Use snapshot isolation or copy-on-write for checkpoint computation. Incoming hashes should continue to be accepted and queued during checkpointing. **Design gap: no specification of how checkpointing interacts with ongoing message tree updates. Note: the identity tree and message tree are described as separate (line 838-839), which helps, but concurrent access semantics are unspecified.**

---

## 6. Selective Withholding by Directory

### 6.1 Hash Relay Suppression

**Severity:** Critical

**Attack vector:** Compromised directory node

**Attack description:**
1. Agent A sends message M to Agent B and hash H(M) to the directory (Step 7)
2. The compromised directory node receives H(M) but does not relay it to Agent B
3. Agent B receives message M but has no hash to verify against
4. From B's perspective, this is indistinguishable from a scenario where A never submitted a hash (possible protocol violation by A) or where the message was injected by a third party
5. B cannot determine whether A or the directory is at fault

**Detectability:** B knows it received a message without a corresponding hash. But B cannot determine the cause. A can prove they submitted the hash (they have it in their local tree), but only if B asks A directly -- and B may not trust A at this point.

**Impact:** Destruction of trust between A and B. The directory can selectively sabotage any conversation. In the extreme, a compromised node can make any agent appear to be violating the protocol.

**Mitigation:** Agents should connect to multiple directory nodes simultaneously for hash relay. A hash is considered relayed when received from at least one node. If a message arrives without a hash from any node within a timeout, the message is quarantined (not rejected) and A is asked to re-submit the hash via an alternate node. **The doc describes multi-node architecture for identity verification (line 345-348) but does not specify multi-node hash relay.** **Design gap: hash relay appears to use a single node path, creating a single point of failure and trust.**

### 6.2 Selective Hash Delay

**Severity:** High

**Attack vector:** Compromised directory node

**Attack description:**
1. Directory receives hash from A, delays relay to B by minutes or hours
2. B receives messages but cannot verify them in real-time
3. If B's policy is to buffer messages until hash arrives, the delay causes denial of service
4. If B's policy is to accept messages after a timeout, the delay creates a verification gap
5. The directory can selectively delay hashes for specific agent pairs, creating targeted disruption

**Detectability:** B observes delayed hash arrivals. Pattern analysis could reveal that delays correlate with a specific directory node. But attributing the delay to the node vs. network conditions is difficult.

**Impact:** Targeted denial of service or verification gap exploitation.

**Mitigation:** Hash relay SLAs with maximum acceptable delay. If hash does not arrive within T milliseconds of message receipt, the SDK queries alternate nodes. Agents should timestamp their hash submissions, and the relay should include the original submission timestamp (signed by A) so B can detect artificial delay. **Design gap: no SLA or timing expectations specified for hash relay.**

### 6.3 Selective Evidence Presentation in Disputes

**Severity:** Critical

**Attack vector:** Compromised directory node operator with access to dispute resolution

**Attack description:**
1. Step 10 (line 613-619) describes the directory's Merkle tree as "the golden source" for dispute resolution
2. A compromised node operator could present a selectively pruned or modified tree during disputes
3. The operator could omit specific messages that are unfavorable to a party they want to protect
4. Since the identity Merkle tree checkpoints are consensus-verified, the operator cannot modify the identity tree -- but the **message tree** checkpoint/consensus mechanism is not described

**Detectability:** The disputing parties have their own local trees and can compare. But if one party's local tree has been lost or damaged (device failure), the directory's tree is the only remaining record.

**Impact:** Fraudulent dispute resolution. The "arbitration without surveillance" guarantee is broken if the arbiter is compromised.

**Mitigation:** Message tree roots must also be checkpointed across multiple nodes with consensus verification. The dispute resolution process must require agreement from multiple nodes, not a single node's tree. **Design gap: the multi-node consensus mechanism is described for the identity tree but not explicitly for the message tree. Line 838-839 separates the two trees but doesn't specify whether message tree roots are included in cross-node checkpoints.**

---

## 7. P2P Transport Attacks (libp2p)

### 7.1 Fake Peer ID Injection via Compromised Directory

**Severity:** Critical

**Attack vector:** Compromised directory node

**Attack description:**
1. On connection acceptance (line 421-432), both agents generate ephemeral libp2p peer IDs
2. Peer IDs are "exchanged through directory (one-time, not stored)"
3. A compromised directory node intercepts A's peer ID and replaces it with the attacker's peer ID
4. B connects to the attacker's libp2p node, believing it is A
5. The attacker can now intercept all P2P messages between A and B
6. If the attacker also replaces B's peer ID when sending to A, the attacker becomes a full MITM

**Detectability:** If peer IDs are signed by the agents' CELLO keys, B can verify A's peer ID signature. If peer IDs are unsigned, undetectable.

**Impact:** Complete MITM on the P2P connection. All messages are visible to and modifiable by the attacker.

**Mitigation:** Ephemeral peer IDs must be signed by the agent's CELLO identity key. The receiving agent must verify this signature before connecting. The peer ID exchange should include a mutual challenge-response to establish that both ends know each other's CELLO public keys. **Design gap: the doc says peer IDs are "exchanged through directory" but does not specify signing, verification, or mutual authentication of peer IDs.**

### 7.2 Eclipse Attack

**Severity:** Medium

**Attack vector:** Network-level attacker who controls routing around a target agent

**Attack description:**
1. Attacker controls the network infrastructure around Agent B (e.g., same corporate network, same ISP)
2. Attacker blocks all P2P connections to B except those from attacker-controlled nodes
3. B can only communicate through attacker-controlled relays
4. All messages to/from B are visible to the attacker
5. The attacker can selectively drop, delay, or modify messages

**Detectability:** B may notice connectivity issues. If B connects to multiple directory nodes over WebSocket (which traverse different network paths), it can detect that P2P connections are being blocked.

**Impact:** Full surveillance and control of B's P2P communications.

**Mitigation:** The fallback to platform transports (Slack/Discord/TG) provides an alternative path. The SDK should detect persistent P2P failures and alert the owner. Agents should periodically verify connectivity through multiple independent paths. **Partially mitigated by the multi-transport architecture, but the doc does not specify automatic failover or eclipse detection.**

### 7.3 NAT Traversal Failure as Denial of Service

**Severity:** Medium

**Attack vector:** Network attacker or restrictive NAT environment

**Attack description:**
1. libp2p uses hole-punching for NAT traversal
2. The doc acknowledges this concern (line 1050-1051: "how often does hole punching fail in practice?")
3. An attacker on the same network as an agent can block hole-punching packets (STUN/TURN traffic)
4. The agent cannot establish direct P2P connections
5. If no TURN relay fallback exists, the agent is denied P2P connectivity entirely

**Detectability:** Agent detects connection failures. The cause (deliberate blocking vs. NAT incompatibility) is hard to distinguish.

**Impact:** Denial of P2P connectivity. Agent must fall back to platform transports (if configured) or is unable to communicate.

**Mitigation:** TURN relay as mandatory fallback. The doc's open question about this is security-relevant: the relay must be operated by trusted infrastructure (directory nodes or consortium members), and relayed traffic must still be end-to-end encrypted. **Design gap: TURN fallback is an open question, not a specified part of the protocol.**

---

## 8. Platform Transport Attacks

### 8.1 Message Modification by Platform

**Severity:** High

**Attack vector:** Platform behavior (no attacker needed -- this is inherent to using platform transports)

**Attack description:**
1. Agent A sends a CELLO-signed message through Slack (line 438-456)
2. Slack modifies the message: link unfurling adds preview text, markdown rendering changes formatting, message length limits truncate content, special characters are escaped
3. Agent B receives the Slack-modified message
4. B hashes the modified message -- hash doesn't match the hash relayed through the directory
5. The hash verification fails: B concludes the message was tampered with

This is not an attack but a systemic issue with platform transports. Every platform modifies messages in some way.

**Detectability:** B detects a hash mismatch. The cause (platform modification vs. MITM) is ambiguous.

**Impact:** False tampering alerts on every message modified by the platform. Could render platform transports unusable for CELLO.

**Mitigation:** The CELLO message must be encoded in a platform-invariant format before transmission. Options: Base64-encode the signed message as the Slack message body, use a Slack attachment/block with raw content, or define a canonical serialization that survives platform formatting. The hash must be computed on the pre-encoding content, and B must decode before hashing. **Design gap: the doc does not address platform message modification at all. This is a critical implementation concern for platform transports.**

### 8.2 Platform as Additional Attack Surface

**Severity:** Medium

**Attack vector:** Compromised Slack workspace, Discord server, or Telegram group

**Attack description:**
1. Agent communicates via a Slack workspace
2. Slack workspace admin can: read all messages, modify messages via API, delete messages, impersonate bot users
3. Even with CELLO hashing, a compromised workspace admin can mount denial-of-service by deleting messages before the receiving agent processes them
4. Workspace admin can also observe all message content (unlike the directory, which only sees hashes)

**Detectability:** Message deletion is detectable (A has a hash for a message B never received). Content observation is undetectable.

**Impact:** Privacy violation (platform sees content that the directory never does). Message deletion as denial of service.

**Mitigation:** For sensitive communications, the doc already recommends P2P transport (line 418: "Cross-org, sensitive data, no platform dependency"). The doc should explicitly warn that platform transports sacrifice content confidentiality and provide weaker integrity guarantees. Consider end-to-end encryption of message content even over platform transports (currently not specified). **Design gap: the doc does not address end-to-end encryption of message content. The privacy guarantee ("service never sees content") applies to the directory but not to platform transports.**

---

## 9. Denial of Service

### 9.1 Connection Request Flooding Against Target Agent

**Severity:** High

**Attack vector:** Any registered agent (or many Sybil agents with phone numbers)

**Attack description:**
1. Attacker registers many agents (phone numbers are "expensive to fake at scale" but not impossible -- VoIP numbers, SMS services)
2. Each agent sends connection requests to the target agent
3. If the target agent's policy is "Selective" or "Guarded" (line 396-403), each request requires processing and potentially owner notification
4. Owner is flooded with notifications via WhatsApp/Telegram
5. If the target agent's policy is "Open," each request triggers session establishment, consuming resources

**Detectability:** Highly detectable -- sudden spike in connection requests from unknown agents.

**Impact:** Resource exhaustion on the target agent. Notification flooding to the owner. In "Open" mode, potential resource exhaustion from session establishment.

**Mitigation:** Rate limiting on incoming connection requests per agent. The directory should enforce limits on how many connection requests a single agent can send per time window. Progressive backoff for agents sending many requests. Target agents should have configurable rate limits. **Design gap: the doc does not specify rate limiting for connection requests, only for malformed WebSocket messages (line 697).**

### 9.2 Hash Relay Flooding

**Severity:** High

**Attack vector:** Compromised agent or attacker with valid credentials

**Attack description:**
1. An authenticated agent submits millions of hashes to the directory
2. Each hash must be stored, added to the Merkle tree, and relayed
3. Merkle tree recomputation for each new leaf has O(log n) cost, but at millions of hashes per second, the cumulative cost is significant
4. The directory node's storage and compute are exhausted

**Detectability:** Detectable via rate monitoring -- a single agent submitting hashes at an unrealistic rate.

**Impact:** Directory node degradation or failure. Affects all agents using that node.

**Mitigation:** Per-agent hash submission rate limiting. No agent should submit more than X hashes per minute (tied to reasonable conversation rates). The strike system (line 697) should apply to hash flooding. **Design gap: rate limits are mentioned for malformed messages but not for volume of valid messages.**

### 9.3 Checkpoint Computation Bombing

**Severity:** Medium

**Attack vector:** Indirect -- attacker floods the directory with operations to make checkpointing expensive

**Attack description:**
1. Attacker registers and modifies many agents rapidly (profile changes, trust score updates)
2. Each modification is an entry in the append-only log (line 825-831)
3. Checkpoint computation must hash the entire current state
4. With millions of entries between checkpoints, checkpointing becomes expensive
5. If checkpointing blocks other operations, the directory is degraded during checkpointing

**Detectability:** Detectable via monitoring of log growth rate and checkpoint duration.

**Impact:** Increased checkpoint time. If checkpointing is synchronous, temporary service degradation.

**Mitigation:** Rate limiting on profile modifications. Incremental checkpointing (only rehash changed subtrees). Asynchronous checkpointing that doesn't block operations. **Partially addressed by the existing rate limit on bio changes (line 287: "can only be updated once every X hours") but the general principle of rate-limiting all directory mutations is not specified.**

---

## 10. Privacy and Metadata Leakage

### 10.1 Social Graph Construction by Directory Operators

**Severity:** High

**Attack vector:** Any directory node operator (no compromise needed -- this is inherent to the architecture)

**Attack description:**
1. The directory knows: which agents are online (WebSocket sessions), who sends connection requests to whom, who accepts, and every hash relay with timestamps
2. From this metadata alone, a node operator can construct a complete social graph: who talks to whom, how frequently, at what times, conversation durations
3. This is available to every consortium node operator as a function of their role
4. Combined with public agent profiles (capabilities, bios), this enables detailed commercial intelligence

**Detectability:** Undetectable -- this is metadata the directory requires to function.

**Impact:** Complete surveillance of communication patterns without seeing content. Commercially valuable. Potentially subpoena-able.

**Mitigation:** This is an inherent architectural limitation. Partial mitigations: (a) hash relay through random nodes (agent doesn't always use home node for relay), (b) traffic padding, (c) mixing networks, (d) policy/legal controls on what operators can retain. The doc should be transparent about this limitation. **Design gap: the doc claims "Privacy by architecture" (line 1005) but this only applies to message content, not metadata. The metadata exposure is significant and unacknowledged.**

### 10.2 Hash Correlation Across Recipients

**Severity:** Medium

**Attack vector:** Directory node operator

**Attack description:**
1. Agent A sends the same message M to Agent B and Agent C (e.g., a broadcast announcement)
2. H(M) is the same for both recipients (assuming the hash is only over message content)
3. The directory sees the same hash submitted for two different conversations
4. The directory can infer that A sent identical messages to B and C

However, looking at the leaf format (line 489-498), the hash includes `sender_pubkey`, `sequence_number`, `prev_root`, and `timestamp`, which would differ across conversations. So the leaf hashes would differ even for identical message content.

**Detectability:** Not applicable if leaf format includes per-conversation fields.

**Impact:** Likely mitigated by the leaf format including conversation-specific fields. But this depends on whether the hash sent to the directory is the full leaf hash or just `hash(message_content)`. **Design gap: the doc does not clearly specify whether the hash relayed to the directory is the full leaf hash (including all fields) or just the message content hash. If it's only the content hash, correlation is possible.**

### 10.3 Deanonymization Through Traffic Analysis

**Severity:** Medium

**Attack vector:** Passive network observer (ISP, nation-state)

**Attack description:**
1. Agent connects to directory nodes via WebSocket over TLS
2. A passive observer can see: source IP of the agent, destination IP of directory nodes, connection timing, volume of encrypted traffic
3. By correlating traffic volumes and timing between two agents' connections to the directory, the observer can infer which agents are communicating
4. For P2P connections (libp2p), the observer can directly see which IP addresses connect to each other

**Detectability:** Undetectable by agents.

**Impact:** Deanonymization of agent operators. Mapping of agent IP addresses to physical locations and identities.

**Mitigation:** VPN/Tor usage (out of CELLO's scope but could be recommended). For P2P connections, the use of TURN relays obscures the direct IP-to-IP relationship. The doc should note that IP-level anonymity is not a goal of the protocol. **Design gap: no threat model discussion around network-level observers.**

---

## 11. Additional Protocol-Level Findings

### 11.1 Split-Key Without Specified Scheme

**Severity:** High (design gap, not direct attack)

**Attack vector:** Implementation vulnerability

**Attack description:**
The doc describes split-key signing throughout (K_local + K_server) but does not specify the cryptographic scheme. The open questions (line 1054-1056) ask "which scheme? Shamir's secret sharing? ECDSA threshold signatures?" This is not just an implementation detail -- the security properties differ dramatically:

- **Shamir's secret sharing** requires reconstructing the full key somewhere (the agent's machine during signing), meaning the full key exists in memory temporarily
- **ECDSA threshold signatures** never reconstruct the full key -- each party computes a partial signature
- **Ed25519 threshold signatures** are more complex and less mature

If Shamir's is used, the agent's machine has the full signing key in memory during every signing operation, making it extractable by a local attacker (malware, memory dump).

**Detectability:** N/A -- this is a design decision, not an attack.

**Impact:** The security guarantees of split-key signing depend entirely on the scheme chosen. With Shamir's, the split-key provides no protection against local key extraction during signing.

**Mitigation:** Specify the threshold signing scheme. If the goal is that the full key never exists in one place, use ECDSA or EdDSA threshold signatures (not secret sharing). **Critical design gap.**

### 11.2 K_server Caching Creates Attack Window

**Severity:** High

**Attack vector:** Local machine compromise

**Attack description:**
1. The doc mentions K_server caching (line 1055: "K_server caching policy -- how long can a session key be cached before re-auth?")
2. If K_server shares are cached on the agent's machine for performance, an attacker who compromises the machine can extract both K_local and cached K_server shares
3. With both, the attacker can produce primary-key signatures -- bypassing the "canary" system entirely
4. The attacker appears as a fully trusted agent, not a fallback-only (compromised) agent

**Detectability:** Undetectable by the protocol's compromise detection system (Step 9), which relies on fallback-only signing as the canary signal.

**Impact:** Complete identity theft with no canary signal. The attacker can sign messages as the victim with full trust.

**Mitigation:** K_server shares should never be cached on the agent's machine. Each signing operation should require a fresh request to the directory nodes. If caching is necessary for latency, the cache must be very short-lived (seconds, not minutes) and stored in a secure enclave (TPM, SGX) if available. **The doc flags this as an open question but does not identify the security implication of getting it wrong.**

### 11.3 No End-to-End Encryption

**Severity:** High (design gap)

**Attack vector:** Any observer of the message transport

**Attack description:**
1. The entire CELLO protocol provides integrity (hashing, signing) and non-repudiation (Merkle trees) but does not provide confidentiality
2. Messages travel in plaintext (or whatever the transport provides) -- CELLO does not add encryption
3. For P2P transport (libp2p), libp2p's built-in encryption (Noise protocol) likely provides confidentiality, but this is not specified in the CELLO doc
4. For platform transports, the platform can read all message content
5. For any transport, a MITM at the transport layer can read content

The doc's privacy claim ("The service never sees message content" -- line 484) is true for the directory but misleading about the overall protocol's privacy properties.

**Detectability:** N/A -- content is visible to any transport-layer observer.

**Impact:** No confidentiality guarantee. Anyone who can observe the message transport (not just the hash relay) can read message content.

**Mitigation:** Add end-to-end encryption as a protocol layer. At connection acceptance, agents should perform a Diffie-Hellman key exchange (authenticated by their CELLO keys) and encrypt all message content. The hash should be computed on the plaintext before encryption. **Design gap: end-to-end encryption is not part of the protocol.**

### 11.4 Unspecified Message-Hash Binding

**Severity:** High (design gap)

**Attack vector:** Compromised sender

**Attack description:**
1. Agent A sends message M to Agent B and hash H(X) to the directory, where X != M
2. Agent B receives M, computes H(M), receives H(X) from directory -- mismatch
3. B flags a tamper alert. But A deliberately caused this to frame the directory or transport as compromised
4. Alternatively: A sends H(M) to directory but sends M' to B, then later claims it sent M (using the directory's hash as evidence)

**Detectability:** B detects the mismatch but cannot determine whether A or the transport is responsible.

**Impact:** A malicious sender can cause false tamper alerts or create ambiguous evidence trails.

**Mitigation:** The message itself should carry the hash (or a hash commitment) signed by A. B receives the message and its signed hash together, verifies A's signature on the hash, then checks that the message matches. The directory's copy serves as a third-party record, not the primary verification mechanism. **Design gap: the protocol assumes honest senders -- a sender that deliberately submits mismatched hashes can cause confusion.**

### 11.5 No Specified Revocation Propagation Time

**Severity:** Medium

**Attack vector:** Attacker who has stolen K_local, racing against revocation

**Attack description:**
1. Owner detects compromise and taps "Not me" -- K_server is revoked (line 587-588: "milliseconds")
2. But revocation must propagate to all nodes in the consortium
3. During propagation, some nodes still consider the old K_server valid
4. The attacker can race to nodes that haven't received the revocation yet, requesting K_server shares and signing
5. The doc says revocation happens "in milliseconds" for the home node, but cross-node propagation time is unspecified

**Detectability:** After propagation completes, any signatures produced during the window can be identified by timestamp.

**Impact:** During the propagation window, the attacker can continue to produce valid split-key signatures.

**Mitigation:** Revocation must be propagated to all nodes synchronously (blocking until acknowledged) before the revocation is confirmed to the owner. Or: nodes should refuse to issue K_server shares if they haven't received a heartbeat from the revoking node within T seconds. **Design gap: revocation propagation across the consortium is not specified.**

---

## Summary of Critical Findings

| # | Finding | Severity | Category |
|---|---------|----------|----------|
| 1.1 | Dual-path MITM when attacker controls agent's network egress | Critical | Protocol |
| 1.2 | Compromised directory node can forge/withhold hash relay | Critical | Trust model |
| 6.1 | Hash relay suppression by compromised node -- single point of failure | Critical | Architecture |
| 6.3 | Message tree not included in cross-node consensus | Critical | Architecture |
| 7.1 | Fake peer ID injection during P2P setup | Critical | Protocol |
| 11.1 | Split-key scheme unspecified -- security properties unknown | Critical | Design gap |
| 11.3 | No end-to-end encryption in the protocol | High | Design gap |
| 11.4 | Sender can deliberately submit mismatched hash/message | High | Protocol |
| 2.1 | Connection request replay across conversations | High | Protocol |
| 4.1 | Pre-authentication WebSocket connection exhaustion | High | DoS |
| 5.1 | Simultaneous message sequence number collision | High | Correctness |
| 5.2 | Connection accept/revoke race condition | High | Race condition |
| 8.1 | Platform message modification breaks hash verification | High | Integration |
| 10.1 | Complete social graph visible to all node operators | High | Privacy |

The most systemic issue is that several critical security properties (end-to-end signing of hash relay, end-to-end encryption, peer ID authentication, multi-node hash relay) are not specified in the protocol but are necessary for the threat model the document claims to address. The hash relay architecture assumes honest directory nodes for integrity, which contradicts the federated trust model's goal of not trusting any single operator. The protocol's integrity guarantees are strong against external attackers when the directory is honest, but degrade significantly against a compromised consortium member -- precisely the scenario federation is designed to protect against.