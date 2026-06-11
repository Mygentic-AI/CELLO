---
name: transport-security-audit-and-libp2p-primitives
type: discussion
date: 2026-06-11
topics: [security, transport, libp2p, frost, ddos, autonat, dht, gossipsub, peer-discovery, connection-gating, relay, trust-model, adversarial-audit]
status: closed
description: >
  Adversarial security audit of CELLO's transport and session layers. Traces the
  actual implementation against design intent. Evaluates Perplexity's libp2p
  primitive recommendations against CELLO's trust philosophy. Identifies one
  HIGH-severity implementation gap (client trusts relay for sender verification)
  and documents the DDoS surface. The Peer ID ephemerality discussion in this
  log led to a fundamental architectural breakthrough — the daemon transport
  model — documented in [[daemon-transport-architecture]].
---

# Transport Security Audit and libp2p Primitives Assessment

## 1. What We Were Investigating

Four questions motivated this session:

1. Can a modified client bypass the directory and directly reach or attack other
   peers on the CELLO network?
2. Which libp2p primitives (AutoNAT, DHT, gossipsub, circuit relay) should CELLO
   adopt, and which contradict the trust model?
3. Does the implementation match the design's security guarantees? (Adversarial
   mindset — do not assume the code matches the docs.)
4. Is there DDoS protection at the transport layer?

The investigation was prompted by a Perplexity conversation that recommended
AutoNAT, Kademlia DHT, gossipsub, and circuit relay as solutions for peer
address management after ECS restarts. The prior discussion log
([[peer-reconnect-libp2p-primitives]]) evaluated these from a "do we need them
for reconnect?" perspective and concluded mostly no. This session evaluates them
from a security and trust model perspective — a fundamentally different question.

---

## 2. The Design Philosophy

CELLO's north star: a completely free, anonymous, peer-to-peer network where any
agent can connect with any other agent. The problem with that ideal is that it
degrades into spam, prompt injection, and a free-for-all. Left alone, people
would begin filtering, creating whitelists, wanting stable identity layers,
wanting third-party reputation directories.

CELLO builds those layers from the beginning. The question that governs every
design decision is: **what are the minimal steps we walk backwards from pure P2P
lawlessness to avoid the free-for-all, while maintaining freedom and privacy?**

Everything stems from that question. The directory is not a centralization
choice — it is the minimum retreat required to prevent the lawless state while
preserving the maximum autonomy for agents.

Applied to this session's questions:

- Features that move toward the open P2P ideal: good.
- Features that add unnecessary centralization or infrastructure dependency: bad.
- Features that undermine the directory's role as trust mediator: dangerous.
- The relay is offered as a convenience, not imposed. Operators who don't want
  content going through infrastructure can fix their own networking (open ports,
  run on a VPS, use AWS). The relay serves the ~20% of sessions that cannot
  hole-punch through symmetric NAT.

---

## 3. Perplexity Recommendations — Evaluated Against Trust Model

Perplexity recommended four libp2p primitives for handling peer address updates
after ECS restarts and for general network health. Assessment:

| Primitive | Verdict | Reasoning |
|---|---|---|
| **AutoNAT** | Adopt (M7) | Self-knowledge only — "am I dialable?" Doesn't expose anyone else's addresses. Precondition for dcutr (already wired into createNode). See [[peer-reconnect-libp2p-primitives]] for full analysis. |
| **Circuit relay** | Already present | `circuitRelayServer()` and `circuitRelayTransport()` are in `createNode`. Correct as-is. |
| **DHT (Kademlia)** | Contradicts model | An open registry where any peer can query for any other peer's address. The directory IS CELLO's curated registry — a DHT would bypass it, handing address information to anyone on the mesh. |
| **Gossipsub** | Contradicts model | Broadcasts "I'm alive at this address" to all topic subscribers. Would give every mesh participant knowledge of every other participant's multiaddr. Destroys address secrecy. |

**Why "build for scale now" doesn't apply here:** The question is not "are we too
small for DHT/gossipsub?" The question is: do these primitives strengthen or
undermine the trust model? DHT and gossipsub enable exactly the address
discovery that the current architecture deliberately prevents. They would be
appropriate for a fully open P2P network with no trust mediation. CELLO is not
that network — the directory mediates trust by design. Adding DHT or gossipsub
without first hardening every stream handler with cryptographic sender
verification would expose clients to direct contact from any mesh participant.

---

## 4. Adversarial Code Audit — What We Actually Have

An adversarial agent was dispatched with explicit instructions: do not trust
function names, do not assume anything works as labeled, follow every delegation
to its real implementation, report what the code actually does.

### 4a. What Is Sound

**FROST ceremony is genuine.**
File: `cello-client/core/crypto/src/frost/frost-threshold-signer.ts`

Uses `@noble/curves/ed25519` `ed25519_FROST` — a real RFC 9591 implementation.
Round 1 commitments, Round 2 partial signatures, per-share verification via
`ed25519_FROST.verifyShare`, aggregation via `ed25519_FROST.aggregate`, final
verification via `ed25519_FROST.verify`. With the current single-directory-node
deployment, DKG produces a **2-of-2** scheme (client + 1 directory node). Both
must participate to produce a valid signature. This is genuinely threshold — not
the 1-of-1 pattern feared.

**SessionAssignment signature verification is correct.**
File: `cello-client/core/client/src/session-manager.ts`, lines 249-285

- Refuses "single" signature type (forces FROST)
- Initiator verifies against locally-held `thresholdSigner.getPrimaryPubkey()`
  (NOT from the frame — cannot be spoofed)
- Builds TBS from canonical fields with domain separation
- Participant B verifies against `assignment.signer_pubkey` (the group pubkey
  delivered by the directory — trust root is the directory)

**Relay enforces participant binding.**
File: `trustless-cello/packages/relay/src/relay-node.ts`

When a client submits a hash:
1. Challenge-response Ed25519 auth (lines 536-543)
2. Participant check: `senderPubkeyHex !== aHex && senderPubkeyHex !== bHex`
   rejects non-participants (lines 713-716)
3. S1 pubkey match: pubkey in Structure 1 must match authenticated connection
   (lines 782-783)
4. S1 signature verification (line 790)

Participant list comes from the directory's `recordAssignment` call, which is
itself verified against the directory's Ed25519 signature (line 409).

**Seal ceremony is genuine.**
File: `trustless-cello/packages/directory/src/directory-node.ts`, lines 2481-2692

The directory at seal time:
1. Rebuilds the Merkle tree from ALL individual leaves (`buildMerkleTree`)
2. Compares recomputed root against relay's declared root — rejects on mismatch
3. Validates each leaf's signature individually (line 2513)
4. Validates the prev_root chain (line 2526)
5. Validates causal consistency (line 2543)
6. Verifies bilateral seal (both participants submitted control leaves)
7. Runs a real FROST ceremony co-signing the verified root

**Cross-check design is working.**
Content frames on `/cello/content/1.0.0` carry NO signature and are deliberately
untrusted. A message is only delivered to the application via `#drainReadyQueue`
after BOTH a content frame AND a relay `leaf_deliver` arrive with matching hashes.
Content without a corresponding relay leaf_deliver is discarded after 30 seconds.

### 4b. What Is Broken

**HIGH: Client does not verify sender pubkey against session counterparty.**
File: `cello-client/core/client/src/relay-stream-manager.ts`, lines 606-654

In `#handleInboundLeafDeliver`:
- Line 606: `senderPubkey` extracted from S2 structure (which comes from relay)
- Line 649: `verify(senderPubkey, s1Cbor, s2.sender_signature)` — verifies
  signature is mathematically valid for the declared pubkey
- Line 654: `isOwnSend = senderHex === myPubkeyHex` — checks if it's "me"
- **NEVER checks** that `senderPubkey === session.counterparty_pubkey`

The `SessionRecord.counterparty_pubkey` field (set from the FROST-signed
SessionAssignment at session establishment) is **never referenced** anywhere in
`relay-stream-manager.ts`.

**Attack scenario:** A compromised relay could forge a `leaf_deliver` frame with
a valid signature from a third-party key (neither participant A nor B). The
client would accept it because:
1. The signature is valid for the declared pubkey (verify passes)
2. It's not `myPubkeyHex` so `isOwnSend = false`
3. No check against `counterparty_pubkey` — accepted

**Practical exploitability:** Requires a compromised relay. The relay itself
correctly enforces participant binding, so a legitimate relay would never produce
such a frame. But CELLO's design principle is: don't trust infrastructure. The
client should independently verify.

**Fix (5 lines):**
```typescript
if (!isOwnSend) {
  const counterpartyHex = Buffer.from(session.counterparty_pubkey).toString("hex");
  if (senderHex !== counterpartyHex) {
    this.#desync(sessionIdHex, "sender_not_session_participant"); return;
  }
}
```

### 4c. What Is Absent (Transport-Level Protections)

- No `connectionGater` on the libp2p node — any peer on the network can connect
  and open streams on `/cello/content/1.0.0`
- No `maxConnections` or `maxInboundConnections` configured
- No per-peer rate limiting or stream limits
- Content stream handler discards the `connection` object (which carries the
  authenticated `remotePeer`), so the handler cannot verify who sent the frame
  even at the transport layer
- No peer scoring or reputation tracking

These are mitigated by the cross-check design (content frames are untrusted and
cannot inject messages without relay confirmation), but they leave the client
vulnerable to resource exhaustion from a flood of junk connections.

---

## 5. The Two-Layer Security Model (As It Actually Exists)

| Threat | Defense | Status |
|---|---|---|
| Impersonation (pretend to be another agent) | K_local signing + FROST binding | Sound (with the 5-line fix) |
| Content injection (inject fake messages into session) | Cross-check design (content + relay leaf must match) | Sound |
| Man-in-the-middle at session start | FROST threshold signature on SessionAssignment | Sound |
| Compromised relay injecting third-party content | Client verifies sender = counterparty | **BROKEN** (5-line fix identified) |
| DDoS / resource exhaustion | Address secrecy + connectionGater + limits | **Partial** — address secrecy exists but no enforcement once address known |
| Address discovery by counterparties | Ephemeral client Peer ID per process lifetime | Working as intended — see §6 |
| Directory impersonation | Bidirectional auth with consortium-pinned keys | **Not yet verified** — see §7 |

---

## 6. DDoS, Address Exposure, and Operator Autonomy

### Address leakage vectors

Even without DHT or gossipsub, addresses can be learned:
1. Session counterparty — must know your address to send content (by design)
2. The relay — you dial it, it sees your address
3. Network-level observation — same WiFi, ISP, packet inspection
4. A previous counterparty who turned hostile after the session
5. A compromised relay leaking client addresses

### Client Peer ID: ephemeral by design, blocked from rotating mid-run

M6B-006 persisted the **relay's** transport key for infrastructure stability —
the relay is a long-lived server and its Peer ID must remain constant across
ECS restarts. The **client** (cello-mcp) transport key is deliberately NOT
persisted.

**Why ephemerality is an active security defense, not an oversight:**

Two threats motivate this:

1. **DDoS / targeted flooding.** Any counterparty who communicates with you
   learns your libp2p multiaddr during the session — they must, in order to
   send content frames. A hostile counterparty can retain that address and dial
   you after the session ends, flooding your node or attempting to probe it.
   An ephemeral Peer ID defeats this: the address they recorded is invalid
   after the next restart.

2. **Peer ID mining.** With stable Peer IDs, observers can systematically
   catalog the network across sessions — correlating a Peer ID seen in session
   A with the same Peer ID seen in session B weeks later, building a persistent
   map of which agents are active, how frequently they communicate, and who
   they talk to. Ephemeral Peer IDs make that map decay on every process
   restart, constraining correlation to a single process lifetime.

**The problem: ephemerality currently means process-scoped, not session-scoped.**

A careful reader might infer that closing a session rotates the Peer ID,
invalidating any address the counterparty recorded. This is not the case.

libp2p creates one node per process with one Peer ID shared across all
sessions. This is an architectural choice in the current implementation
(`createNode` called once at startup in `cello-mcp.ts:392`, stored as
`CelloClientImpl.node`, shared across all sessions via narrow context
interfaces in `client-wiring.ts`). It is not a library constraint — libp2p
supports multiple node instances per process — but changing it would require
significant refactoring and would break relay connection multiplexing (all
sessions currently share one TCP connection to the relay; per-session nodes
would create one TCP connection per session).

The consequence: the Peer ID is stable for the entire lifetime of one cello-mcp
process. A counterparty who learned your address in session A can reach you in
session B as long as the same process is still running — potentially hours or
days later. The Peer ID only rotates on process restart.

**This is a fundamental design gap — resolved. See [[daemon-transport-architecture]].**

The desired property is session-scoped Peer ID rotation: after a session closes,
the address that counterparty recorded becomes invalid. This cannot be achieved
within the current single-node-per-process architecture while supporting
concurrent sessions.

The resolution emerged from this discussion and is documented in full in
[[daemon-transport-architecture]]: a daemon model with two distinct transport
identities — a persistent directory-facing node (same reconnect behavior as
today, Peer ID stable until reconnect) and an ephemeral per-session node
(fresh transport key created when a session is negotiated, torn down when
the session closes). This gives true session-scoped Peer ID ephemerality
without breaking concurrent sessions. It also has direct implications for M7,
which must be redesigned on this foundation. The DB staleness problem (persisted
≠ live) is also addressed in [[daemon-transport-architecture]] as the persistence
model changes substantially under the new architecture.

**Why persistent transport keys are not the answer:**

The temptation is to persist the client transport key (mirroring M6B-006 for
the relay) to survive process restarts cleanly. This would sacrifice both
security properties above — a persistent Peer ID is permanently addressable
by anyone who ever interacted with the operator — while only partially
addressing the reconnect problem. The reconnect problem runs deeper:

**Persisted ≠ live.** The SQLite DB records that two agents once negotiated a
connection. It does not represent live state. After a process restart, multiple
things can be stale simultaneously:

1. **Ephemeral Peer ID** — counterparty's libp2p peer ID changed on their
   restart; in-flight libp2p operations fail even though the connection record
   looks valid.
2. **Stale session records** — `session_id` entries in the DB from a prior run
   have no corresponding in-memory state on the relay; `cello_send` against
   them will fail, but the outcome (silent failure, error, relay rejection) has
   not been fully mapped.
3. **Stale connection records** — `cello_list_connections` returns all DB
   records as `status: active` regardless of whether the counterparty still
   holds the record; there is no liveness check, no keepalive.
4. **Policy staleness** — `initiate_session` skips `request_connection` for
   persisted connections, meaning the target's current policy is never
   re-evaluated.
5. **Re-registration divergence** — if the counterparty re-registers (new FROST
   ceremony → new `primaryPubkey`), the local DB has a record keyed to the
   old pubkey; the directory assigns a ceremony against the new identity, which
   will not match.

Persisting the transport key would fix scenario 1 in isolation but leave 2-5
entirely unresolved — and would sacrifice both DDoS defense and cross-session
unlinkability in the process.

The reconnect issue requires an investigation story that defines what "persisted
connection" means semantically, adds validity checks on DB restore at startup,
and maps the expected behavior for each failure scenario above. This is captured
as a proposed story scope in COORDINATION.md (2026-06-10) and is separate from
M6B-018 (which addresses signaling stream keepalive, not connection record
validity).

### CELLO's security posture (as it should be communicated)

CELLO's value proposition includes comprehensive protection out of the box:
- Identity and impersonation: locked down via FROST + K_local signing
- Man-in-the-middle: locked down via threshold-signed SessionAssignments
- DDoS prevention: sensible defaults (connectionGater, maxConnections) that
  reject unknown peers before any parsing — operators can tune these settings
  up or down based on their needs
- Address hiding: no DHT, no gossipsub, no address broadcasting to the mesh
- Anti-Sybil: layered defenses at registration, connection, and network levels

The connectionGater approach: only accept connections from the directory's Peer
ID, the relay's Peer ID, active session counterparty Peer IDs, and registered
companion devices. Everyone else rejected at the transport layer before the
Noise handshake completes. This is a protocol-level defense that requires no
centralization — the client defends itself.

**What CELLO explicitly does NOT do:** Force all traffic through relays for
"safety." This contradicts the core philosophy. The relay is offered as a
convenience for the ~20% of sessions that cannot hole-punch through symmetric
NAT. Operators who want to keep sessions fully private can open ports or run on
infrastructure with inbound connectivity. Operators who accept the relay
tradeoff do so by choice. CELLO never imposes a centralized solution.

---

## 7. Directory Bidirectional Authentication

**Resolved — see [[implementing-directory-bidirectional-authentication]].**

The design (end-to-end-flow.md §3.1) specifies a 7-step mutual challenge-response.
Steps 1-4 (client→directory) are implemented. Steps 5-6 (directory→client) are not:
the directory sends a plain `signaling_auth_ok` frame with no signature, and the
client trusts any node that responds at the dialled address. No consortium-pinned
node keys exist in the client source.

Full audit, gap analysis, TUF adoption as canonical standard, and four resolved
design questions (root key rotation, manifest replay prevention, revocation
latency SLA, jurisdiction of key holders) are in
[[implementing-directory-bidirectional-authentication]].

---

## 8. Status of Open Items

**Implementation to-dos (no design work needed — just stories):**
1. Land the 5-line counterparty pubkey check in `relay-stream-manager.ts`
2. Add `connectionGater` with peer allowlist — design changes under the new
   daemon architecture (each ephemeral session node only needs to accept its
   one counterparty; simpler and stronger than the shared-node design discussed
   here); full spec in [[daemon-transport-architecture]]
3. Add `maxConnections` / `maxInboundConnections` on the directory-facing node
4. Per-peer stream limits

**Resolved — see [[implementing-directory-bidirectional-authentication]]:**
5. Directory bidirectional authentication — audited; steps 5-6 of the
   handshake unimplemented; TUF adopted as canonical standard; four design
   gaps resolved; story list defined

**Resolved — see [[daemon-transport-architecture]]:**
6. Session-scoped Peer ID ephemerality — daemon model with ephemeral per-session
   nodes is the answer; full design in [[daemon-transport-architecture]]
7. DB staleness / persisted connection semantics — the new architecture changes
   the persistence model substantially; designed in [[daemon-transport-architecture]]
8. AutoNAT milestone placement — M7 is being redesigned; AutoNAT placement is
   addressed in [[daemon-transport-architecture]]

---

## 9. Lessons Documented

### AI coder confirmation bias

AI coders implement what passes tests and satisfies ACs — not necessarily what
the design intended. Three examples from this project:

1. **FROST was designed as t-of-n with multiple directories.** Built as 2-of-2
   with one directory because that's what was available at build time. The AI
   coder made it work within the constraints silently. Discovered by chance
   during an unrelated investigation.

2. **The seal bookend expects multi-directory participation.** Code was written
   against a single directory. The end-to-end seal flow has a gap at the point
   where multiple directory nodes should independently verify.

3. **This audit's Finding 2: sender pubkey verification.** The relay enforces
   participant binding, so all tests pass. The client was supposed to
   independently verify (defense-in-depth, don't trust infrastructure). The AI
   coder's implementation delegates to the relay's enforcement. Tests pass.
   Subsequent AI agents reviewing the code see passing tests and assume
   correctness.

**The pattern:** An AI coder encounters a constraint (only one directory, relay
already checks this). Rather than flagging the gap, it produces code that
satisfies the ACs within the current constraints. Later agents see passing tests
and have confirmation bias toward "this is correct." Only adversarial review with
explicit instruction to distrust passing tests catches these gaps.

---

## 10. Summary of Security Findings

**What's solid (crypto and protocol layer):**
- FROST ceremony: genuine threshold, real RFC 9591
- Session binding: FROST-signed SessionAssignment verified correctly
- Relay enforcement: participant list from directory, challenge-response auth
- Seal: independent Merkle recomputation, genuine FROST co-sign
- Cross-check: content frames untrusted until relay confirms

**What needs fixing (one implementation gap):**
- Client trusts relay for sender identity — 5-line fix to verify counterparty
  pubkey independently

**What needs adding (transport hardening):**
- connectionGater with sensible defaults
- maxConnections / maxInboundConnections
- Per-peer stream limits
- These are standard libp2p configuration — not novel work

**What needs investigating (not yet audited):**
- Directory bidirectional authentication in the signaling path — needs dedicated
  audit session and its own discussion log

**Resolved by this discussion — see [[daemon-transport-architecture]]:**
- Session-scoped Peer ID ephemerality — daemon model with ephemeral per-session
  nodes; M7 redesigned on this foundation; DB persistence model addressed there

---

## References

- [[daemon-transport-architecture]] — architectural breakthrough that emerged from this discussion; daemon model, ephemeral per-session nodes, M7 redesign, DB persistence model
- [[peer-reconnect-libp2p-primitives]] — prior analysis of reconnect mechanisms and libp2p primitive evaluation
- [[2026-06-06_2100_sovereign-node-networking-requirements]] — foundational document on NAT requirements
- [[end-to-end-flow]] — §3.1 authentication, §5.7 session establishment, §6.1 dual-path architecture
- [[agent-client]] — Part 3 (P2P transport), Part 4 (signing and Merkle), Part 5 (prompt injection defense)
- Perplexity conversation (not in vault — covered AutoNAT, DHT, gossipsub, circuit relay, DDoS)
