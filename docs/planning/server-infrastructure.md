---
name: CELLO Server Infrastructure Requirements
type: design
date: 2026-04-16
topics: [identity, directory, relay, FROST, key-management, MCP-tools, persistence, discovery, notifications, recovery, compliance, session-termination, transport, companion-device, libp2p]
status: active
description: Complete requirements for the three server-side components — signup web portal, directory nodes, and relay nodes — synthesized from all design documents and discussion logs. Includes all conflicts requiring resolution and all identified gaps.
---

# CELLO Server Infrastructure Requirements

## System Boundary

Message content is always peer-to-peer and never touches server infrastructure. The server infrastructure sees: public keys, SHA-256 hashes, signatures, and metadata. This is the invariant that makes data residency compliance tractable and that the three components are designed around.

The three server-side components are:

| Component | Role | Who operates it |
|---|---|---|
| **Signup Web Portal** | Human-facing identity verification | CELLO (centralized) |
| **Directory Nodes** | Session setup, FROST co-signing (establishment + seal), identity Merkle tree, connection brokering, relay failure recovery | CELLO + consortium operators |
| **Relay Nodes** | Circuit relay + hash relay + sequence numbering + per-conversation Merkle tree building during active sessions | Separate from directory operators (required) |

---

## Component 1: Signup Web Portal

### What it is

The signup portal is the only path for human-level identity enrichment. The portal also serves as an alternative registration entry point alongside the WhatsApp/Telegram bot.

**[CONFLICT C-1 — RESOLVED]:** Registration is entry-point agnostic — neither the bot nor the portal is the privileged starting point. Both mandatory ceremonies (phone OTP and email verification) are always required, but they can be completed in either order through any supported surface. **Portal-first path:** operator registers via web portal → email OTP completed there → portal initiates the WhatsApp or Telegram phone OTP ceremony. **Bot-first path:** operator initiates via WhatsApp or Telegram → phone OTP completed there → email verification required (bot prompts for it). The email OTP is the correlation token that ties a portal-initiated registration to the subsequent phone ceremony. Human operators can complete all ceremonies manually. See agent-client.md AC-C1 (resolved).

### Registration and OTP flow

- Phone OTP and email verification are both mandatory registration requirements. Phone number is verified via WhatsApp or Telegram bot; email is verified via OTP (the email OTP serves as the correlation token between portal-first and bot-first registration paths).
- The portal must silently run carrier metadata queries (Twilio Lookup / Telesign) alongside OTP verification when that integration is available: SIM tenure, number type, carrier name, porting history. Zero additional user friction.
- Phone numbers must be classified into three tiers when carrier intelligence is available:
  - **Verified Mobile**: uncapped
  - **Unverified Number** (VoIP/virtual): trust ceiling at score 2
  - **Provisional** (failed phone intelligence): trust ceiling at score 2, re-evaluated at 60 days
  - When carrier intelligence is not yet integrated, all agents default to Verified Mobile.
- During the first 7 days (incubation), the portal or directory must enforce: max 3 new outbound connections per day.

### Optional strengthening flows

The portal supports the following as optional, additive signals. None are registration gates.

**WebAuthn (YubiKey, TouchID, FaceID)**
- Classified as an *account security* signal (phishing-resistant login / tethering). NOT a device sacrifice signal and NOT a Sybil defense measure.
- Available from the web browser — no native app required.
- One device can register WebAuthn for many accounts; this is by design.
- Required for: key rotation, phone number change, account deletion, fund withdrawal, adding/removing social verifiers.

**TOTP 2FA**
- Optional strengthening. Standard authenticator app enrollment.
- Mechanics not fully specified in source documents — oracle pattern (verify → hash → return to client) assumed. **[GAP G-1]**

**LinkedIn, GitHub, Twitter/X, Facebook, Instagram (OAuth)**
- For LinkedIn and GitHub: portal evaluates connection count, account age, activity (commits, stars, follower history) at OAuth time.
- For each OAuth binding, the portal must:
  1. Perform the verification work
  2. Create a structured JSON record (e.g., `{type: "linkedin", connections: 500, account_age_years: 8, verified_at: "..."}`)
  3. Compute `SHA-256(json_blob)` and `SHA-256(account_identifier)` (two-hash pattern)
  4. Write both hashes to the directory
  5. Return the original JSON to the client
  6. Discard the original — nothing is retained server-side
- **Social account binding lock**: Once bound, a 12-month lockout applies to rebinding after unbinding. The directory enforces this via `social_binding_releases.rebinding_lockout_until`.
- **Liveness probing**: Portal must periodically require fresh activity (new commit, new LinkedIn post) to maintain verification weight. Purchased dormant accounts must decay. Polling interval not specified. **[GAP G-2]**

**Email verification**
- Named in design documents as a mandatory registration requirement alongside phone OTP, but the mechanics are never specified. Oracle pattern assumed. **[GAP G-3]**

**Device attestation (TPM, Play Integrity, App Attest)**
- NOT available from the web portal.
- Requires a native app: TPM (Windows/Linux), Google Play Integrity (Android), Apple App Attest (iOS/macOS).
- The portal must route users requiring device attestation to the native app.
- Device attestation is a *device sacrifice* Sybil defense signal — distinct from WebAuthn.

### What the portal writes to the directory

- **Trust signal record hashes only.** The portal writes `SHA-256(json_blob)` for each verification item and `SHA-256(account_identifier)` for social bindings.
- **Never**: raw LinkedIn profiles, OAuth tokens, phone numbers, bios, WebAuthn credentials, or any other source data.

The portal-to-directory write API (endpoint, protocol, authentication mechanism) is not specified anywhere. **[GAP G-4]**

The mechanism by which the original JSON record is delivered to the client (returned in OAuth callback? pushed separately?) is also not specified. **[GAP G-5]**

### Key rotation and key operations

- All identity-affecting operations require WebAuthn/2FA authentication. Phone OTP alone is insufficient.
- **Key rotation flow**: Owner authenticates with WebAuthn → client generates new K_local → portal triggers new K_server_X ceremony on directory → directory publishes new derived public keys → old public keys marked expired with timestamp → all agents that cached old keys are notified to refresh.
- **Emergency "Not Me"**: Owner taps "Not me" in a push notification received on WhatsApp/Telegram. This immediately triggers K_server revocation at the directory. Full re-keying requires WebAuthn on the portal afterward.
- After a SIM swap compromise: changing the registered phone number also requires WebAuthn, permanently removing attacker access from the stolen number.

### Account deletion

- Deletion must be authenticated via WebAuthn.
- Deletion is a signed operation appended to the append-only log (tombstone).
- Signup portal: all PII is fully wiped (phone, WebAuthn credentials, OAuth tokens). The K_server_X shares held by directory nodes for this agent are also burned/deleted.
- Directory: active public key, trust signals, and bio are removed from the live index; tombstone appended to hash chain.
- Conversation records held by counterparties are NOT deleted. The directory does not propagate deletion to third-party Merkle records. The deleted agent's public key points to the tombstone.

### Recovery contacts and succession

- During onboarding, the portal should make designation of M-of-N recovery contacts and a designated successor highly visible and difficult to skip (not a hard gate, but a persistent prompt).
- An agent without a designated successor must display a visible signal in its trust profile.
- The portal supports creation of a succession package: an encrypted blob (seed phrase encrypted to the designated successor's `identity_key`), stored at the directory. Portal must never hold the plaintext seed phrase.
- Voluntary ownership transfer: current owner authenticates (WebAuthn), identifies new owner's CELLO identity, signs the identity migration. An announcement period of 7–14 days (configurable) runs during which all connected agents are notified and the old owner can cancel.
- Involuntary succession (dead-man's switch): 30+ day waiting period (configurable), with notification to owner via external channels (WhatsApp/Telegram) and all recovery contacts and connected agents. M-of-N recovery contact attestation required to execute.
- The portal must enforce a freeze during the succession waiting period: social proofs and phone number cannot be reused. Only the pre-designated successor can receive succession.

### Tombstone side effects (portal enforces)

On any tombstone (VOLUNTARY, COMPROMISE_INITIATED, SOCIAL_RECOVERY_INITIATED, SUCCESSION_INITIATED):
- Social proofs enter a 30-day freeze: cannot be attached to any new account
- Phone number flagged as "in recovery": cannot register a new account during freeze
- 12-month rebinding lockout applies to all previously-bound social account identifiers

**[GAP G-6]**: The mechanism for checking whether a social account is currently frozen at registration time — whether this check happens at the portal, the directory, or both — is not specified.

### Financial UI (later phase only)

- Portal supports stablecoin deposit flows for escrow collateral (USDT, USDC, ETH).
- Portal supports a fiat on-ramp path via institutional partners. The portal itself must never hold or manage cash.

### Discovery and profile management

- Portal exposes a short URL resolver so alias URIs (`cello:alias/<slug>`) can be resolved by any browser.
- Portal allows the owner to browse all three discovery classes (agent directory, bulletin board, group rooms), search, and create/manage Class 1 listings and Class 2 posts.

---

## Component 2: Directory Nodes

### Three-system separation (home node concept dropped)

The original design described a "home node" — a per-agent directory node storing non-replicated PII alongside the K_server_X share. This was dropped during the design-problems review (Problem 7: home node deanonymization). A node storing both PII and hash relay traffic lets a rogue operator trivially correlate them. See [[cello-design|CELLO Design Document]] — "Federated Node Model" section.

**The three systems that replaced it never intersect:**

| System | Holds | Never sees |
|---|---|---|
| **Signup portal** | Phone numbers, email, WebAuthn credentials, OAuth tokens | Conversations, hash relay traffic, Merkle trees |
| **Directory nodes** | Public keys, trust signal hashes, K_server_X shares (envelope-encrypted), Merkle trees | Phone numbers, raw PII |
| **Relay nodes** | Ephemeral Peer IDs, encrypted traffic | Agent identities, phone numbers, key material |

**Directory node data is fully federated** — all core tables replicate to all directory nodes via the append-only log. K_server_X shares are per-agent but stored across all nodes with envelope encryption (one KMS master key per node, 32 bytes per share). No single node has a privileged relationship with any agent.

**Data residency / jurisdiction**: PII lives entirely in the signup portal. The signup portal must be deployed in a jurisdiction-compliant configuration (EU portal for EU users, UAE portal for UAE users). Directory nodes hold only hashes and public keys — non-PII by construction — and have no jurisdiction constraints.

**Notification path (privacy-preserving)**: When a directory or relay node needs to alert an agent owner, it sends a public-key event to the signup system. The signup system performs the phone lookup and pushes the notification. The node never learns the phone number; the signup system never learns what triggered the notification.

### Directory node sub-type

Connection nodes are the only directory sub-type. They are public-facing and handle authentication, FROST ceremonies, connection setup, registration, and key operations. There is no "home node" sub-type.

**[CONFLICT C-2 — RESOLVED]**: The FROST seal ceremony always runs on directory nodes. Relay nodes never hold K_server_X shares, so FROST cannot happen on relay nodes. At seal time, the relay hands the complete leaf sequence and final Merkle root to the directory. The directory independently verifies the tree from scratch (recomputes from the full leaf sequence — does not trust the relay's root), then runs the FROST ceremony co-signing the verified final root. Any t-of-n directory nodes can perform the ceremony. See [[2026-04-17_1400_directory-relay-architecture-reassessment|Directory/Relay Architecture Reassessment]].

### FROST and key management

**K_server architecture**
- K_server_X is per-agent. Rotating K_server_X for one agent affects only that agent's public key — no global coordination.
- K_server_X is distributed as FROST threshold shares across directory nodes. The full key is never assembled on any single machine.
- Each node stores one K_server_X share per registered agent. Storage: 32 bytes × number of agents — trivial.
- Shares are stored with envelope encryption: one AWS KMS master key per node (~$0.03/month). All K_server_X shares encrypted with this master key and stored in an ordinary database. KMS is not invoked per-agent-share (that would be ~$1M/month at 1M agents).
- Node master key protection: AWS KMS, encryption at rest, multi-region backup replication, proactive share refresh as cryptographic recovery backstop.

**FROST thresholds by deployment phase**

| Phase | Node count | Threshold |
|---|---|---|
| Alpha | ~6 (all AWS, 1 per major region) | ~4-of-6 |
| Consortium | ~20 (multi-cloud: AWS + GCP + Azure) | ~11-of-20 |
| Public | 50+ (permissionless with proof-of-stake) | rotating ~5-of-7 per operation |

Minimum threshold at any phase: 3-of-5 across different jurisdictions and cloud providers. Increases to 5-of-7 at maturity.

**FROST ceremonies**
- Occur at **exactly two points**: session establishment (both agents authenticate) and conversation seal (final Merkle root co-signed).
- NOT used per-message. Individual messages are signed with K_local only.
- Each ceremony output must include a K_server version/epoch identifier. Verifiers must reject signatures from expired epochs after a grace window. Grace period duration and hard cutoff not specified. **[GAP G-8]**
- When a K_server rotation boundary coincides with an in-flight FROST ceremony, that ceremony must abort and retry with new shares.

**K_server rotation (directory-only operation)**
- No agent involvement. The directory rotates K_server_X internally when shares are suspected compromised.
- The directory generates new shares, publishes new derived public keys, marks old public keys expired with timestamp, and notifies all agents that cached old keys.
- Agent receives a `KEY_ROTATION_RECOMMENDED` notification; uses new key at next session boundary.
- K_local and K_server_X rotation are independent (either can rotate without the other).
- K_local rotation triggers a new K_server_X ceremony as part of re-pairing.

**Proactive secret sharing**: If a node loses its K_server_X share database, remaining t-of-n nodes regenerate new shares via proactive secret sharing — K_server_X is never assembled. Also used periodically for proactive security.

**K_server rotation notification format**: The exact format, grace period, and epoch identifier format are unspecified. **[GAP G-8]**

**Node signing keys**: Who holds the consortium node signing keys, how they are protected, and what key ceremony establishes them is flagged as a high-severity gap (equivalent to "keys to the kingdom"). Standard AWS KMS is insufficient because the cloud provider has physical access. **[GAP G-9]**

### Authentication

**Per-connection authentication**:
1. Directory issues a 256-bit CSPRNG challenge nonce (single-use, short-expiry)
2. Agent signs: `nonce + agent_ID + directory_node_ID + timestamp` with K_local (Ed25519)
3. Directory verifies the agent's signature against the registered public key
4. Directory signs its own challenge response so the agent can verify the directory's identity against consortium-pinned node keys (certificate pinning)

The agent payload binds the challenge to a specific directory_node_ID to prevent cross-node replay. A timestamp skew check is enforced. Acceptable skew threshold is not specified. **[GAP G-10]**

Repeated malformed WebSocket messages: rate limit → disconnect → require reverification.

**WebSocket schema**: Directory WebSocket accepts only a rigid JSON schema: `{type, agent_id, session_id, payload, signature, timestamp}`. Anything outside this schema is rejected. Validation is pure code (schema check, signature verification, timestamp check) — no LLM involvement.

### Replication and consensus

**Architecture principle**: Real-time path and consensus path are fully separated. Agents never wait for consensus.

**Real-time path (on the critical path for sequencing, NOT for message delivery)**:
- One primary node per session receives hashes, assigns canonical sequence numbers, ACKs to agents
- Message delivery itself is concurrent: agent sends hash to directory AND message directly to counterparty simultaneously — neither blocks the other

**Propagation (off the critical path)**:
- Primary pushes hashes to other nodes asynchronously

**Consensus (background)**:
- Periodic checkpoint where nodes agree on ledger state
- Agents are unaffected

**Primary/backup replication**:
- At session establishment, agent simultaneously fire-and-forgets signed hashes to primary AND 2–3 backup nodes
- Backup nodes store hashes tagged PENDING until sequenced
- If primary fails before propagating: a backup promotes to primary, sequences accumulated PENDING hashes, agents reconnect and continue without resubmission
- Backup selection is dynamic per session: agent picks 2–3 lowest-latency nodes at session establishment
- Different conversations use different backup sets — load distributes without central coordination

**Client-side routing support**:
- Nodes respond to lightweight pings (every 10–30 seconds, configurable) with timestamp + 1-byte load indicator
- Higher load indicator as capacity is approached
- Clients maintain a live RTT table per node and proactively migrate sessions before degradation is visible

**Divergence detection**:
- Each node broadcasts a checkpoint hash to all peers at regular intervals (every N minutes — exact interval not specified, **[GAP G-11]**)
- A node with a diverging hash is immediately visible to all peers
- A compromised node maintaining two copies (honest for peers, tampered for clients) is detectable via client-side Merkle proof verification

**Backup promotion mechanism (election protocol, fencing token, split-brain prevention) not specified. [GAP G-12]**

### Append-only log and persistence infrastructure

- The directory is an append-only log of signed operations — not a mutable database
- Append-only behavior enforced at the database level via PostgreSQL row-level security (no UPDATE or DELETE policies), not by application convention
- Every INSERT into protected tables includes a hash chain entry: `SHA-256(record_contents || previous_chain_hash)`
- Federation nodes compare chain hashes during sync; divergence indicates tampering
- All core tables replicate to all federation nodes via PostgreSQL logical replication
- All access and INSERT audit logs ship via pgaudit to external append-only storage — a compromised node cannot erase its own access history
- Redis for operational rate-limit counters (notification rate, endorsement rate, connection attempt rate, incubation daily limit, bio update rate) — reset on restart without consequence; append-only event logs are authoritative history

**Bootstrap (three-level fallback)**:
1. Signed manifest bundled in npm package (consortium private key signature; consortium public key is a constant in client source; Sigstore/OIDC provenance)
2. DNS seeds (e.g., `bootstrap1.cello.network`)
3. Hardcoded Elastic IP redirectors — minimal servers returning the current signed node list over direct IP

**Critical**: Elastic IPs must never lapse in payment. A released Elastic IP acquired by another party would receive all bootstrap attempts from clients unable to reach levels 1 or 2.

### Merkle tree operations

**Directory Merkle responsibilities** (boundary operations only):
- Directory handles the **identity Merkle tree** (agent registrations, key updates, trust signal hashes) and the **global MMR** (sealed conversation roots)
- Directory does NOT handle per-conversation hash relay or sequence numbering during active sessions — that is relay node territory
- At seal time: relay hands the complete leaf sequence to the directory; directory recomputes the tree from scratch, verifies the chain, then runs the FROST seal ceremony

**Message Merkle tree**:
- Two separate Merkle trees: Identity tree (checkpointed periodically) and Message tree (per-conversation hash chains, updated per message)
- RFC 6962 construction with control leaf extension: `0x00` message leaves, `0x01` internal nodes (RFC 6962 standard), `0x02` control leaves (CLOSE, CLOSE-ACK, SEAL, SEAL-UNILATERAL, EXPIRE, ABORT, REOPEN, RECEIPT)

**[CONFLICT C-3 — RESOLVED]**: The `0x02` prefix for control leaves preserves RFC 6962 second-preimage protection (internal nodes remain `0x01`) while keeping control leaves as first-class Merkle entries distinct from message leaves (`0x00`). See agent-client.md AC-C3 (resolved).

**Two-structure leaf format** (N-party canonical form; two-party is a special case):
- **Structure 1 (inner, sender-signed)**: `content_hash || sender_pubkey || conversation_id || last_seen_seq || timestamp` — signed by sender with K_local
- **Structure 2 (outer, relay-constructed)**: `sequence_number || sender_pubkey || message_content_hash || sender_signature (Structure 1 embedded) || prev_root` — the relay node embeds Structure 1's signature, appends `prev_root` and the canonical sequence number, then hashes into the Merkle tree. The client never computes `prev_root`.

**[CONFLICT C-4 — RESOLVED]**: The two-structure model (2026-04-13 multi-party design) is canonical. The 2026-04-15 session-level FROST signing description of sender-computed `prev_root` is superseded — it was written for the two-party case and does not account for multi-party, where the relay node is the only entity with canonical sequence across all senders during an active session. See agent-client.md AC-C2, AC-C7 (resolved).

**Conversation anchor (N-party)**: `SHA-256(sorted_participant_pubkeys || session_id || timestamp)` — sorting makes it deterministic regardless of join order.

**First-message anchor**: `prev_root = SHA-256(agent_A_pubkey || agent_B_pubkey || session_id || timestamp)`. This prevents first-message substitution by a compromised directory.

**Three copies**: Sender, receiver, directory. All three must be identical absent tampering.

**Global meta-Merkle tree (MMR)**:
- Append-only tree over all conversation registrations
- Every INSERT into `conversation_seals` triggers a leaf append (all close types, no exceptions) via PostgreSQL AFTER INSERT trigger
- Prevents retroactive fabricated conversation insertion
- O(log N) inclusion proofs
- Tables: `conversation_proof_leaves`, `conversation_proof_mmr_nodes` (both append-only), `conversation_seal_staging` (ephemeral, cleared after each checkpoint)

**Checkpoint process**:
1. Nodes agree on input set via batch hash exchange at checkpoint boundary
2. Deterministic sort by `recorded_at ASC, conversation_id ASC`
3. Each node independently extends its local MMR copy
4. Nodes sign the checkpoint and exchange signatures
5. Checkpoint confirmed when threshold of nodes have signed

**Checkpoint schema** (`directory_checkpoints`): checkpoint_id (sequential), mmr_leaf_count, mmr_peaks, identity_merkle_root, checkpoint_hash = `SHA-256(mmr_peaks_serialized || identity_merkle_root || checkpoint_id)`, created_at.

**Checkpoint interval**: Not specified. Affects temporal resolution of inclusion proofs. **[GAP G-11]**

**Identity Merkle tree**: Sorted sparse Merkle tree over agent state. One leaf per agent keyed by `agent_id`. Leaf hash = `SHA-256(agent_id || signing_pubkey || identity_pubkey || status || trust_score_hash || bio_hash || social_verifications_hash || attestations_hash || endorsements_hash || last_updated)`. Updated on every agent state change (O(log N) recomputation walk). New root = `identity_merkle_root` for next checkpoint.

### Session management

**Persistent WebSocket per agent**: Outbound TLS on port 443, kept open for the entire online session. Directory can push data (hash relay, connection requests, notifications) without initiating a new connection.

**Degraded mode — connection nodes unavailable**:
- Connection nodes must refuse new connection requests when unavailable and send a reason: "directory unreachable, not accepting unauthenticated sessions — retry when available"
- Agents with a pre-established degraded-mode list can be accepted at reduced trust, flagged in Merkle leaf
- Default: refuse new unauthenticated connections (not silent drop)

**Degraded mode — directory down**:
- Existing sessions continue with K_local signing
- Both parties use local sequence numbers; the hash chain provides ordering
- On directory return: both parties submit locally-sequenced hashes; directory assigns canonical numbers retroactively; if the two submitted chains disagree the discrepancy is flagged for investigation
- The bilateral seal (both parties sign final root with K_local) is available immediately; the notarized FROST seal is deferred until directory returns

**Session termination (control leaves)**:
Control leaves are hashed and signed identically to message leaves and recorded in the Merkle tree.

| Control type | Trigger | Status |
|---|---|---|
| CLOSE | Party A initiates close | In progress |
| CLOSE-ACK | Party B acknowledges | In progress |
| SEAL | Directory notarizes mutual close | Terminal |
| SEAL-UNILATERAL | Timeout — B did not ack | Terminal |
| EXPIRE | Directory: no messages for configurable period | Quasi-terminal (REOPEN permitted) |
| ABORT | Security event | Terminal — REOPEN not permitted |
| REOPEN | Either party reopens SEALED or EXPIRED tree | Continuation |
| RECEIPT | Agent explicitly acknowledges processing a specific message | Informational (no state change) |

After SEAL: a configurable grace window (`post_seal_grace_seconds`, default `300`) permits late-arriving messages (in-flight before the sender received the SEAL notification) to be accepted as `post_seal: true` record-only leaves. After the grace window expires, any arriving message triggers an auto-REOPEN and is delivered as the first leaf of a continuation session.
After ABORT: REOPEN is not permitted. Post-ABORT message arrivals are always rejected regardless of timing.

**Session timeout value (N in "no messages for N minutes") is not specified. [GAP G-13]**

**REOPEN semantics incompletely specified**: Whether REOPEN requires a new FROST ceremony, how sequence numbers are handled across the seal boundary, and whether REOPEN can be unilateral are not defined. **[GAP G-14]**

**Session close attestation** (`conversation_attestations` table — per-participant, N-party):
- CLEAN | FLAGGED | PENDING | DELIVERED | ABSENT
- MUTUAL_SEAL applies only to "active" participants (present at seal time); ABSENT participants do not block MUTUAL_SEAL
- Directory records attestation disagreements without adjudicating them
- CLEAN close → "last known good" timestamp, anchored for compromise window determination; also serves as escrow release trigger
- FLAGGED close → arbitration trigger (flagging party may submit transcript)

**[CONFLICT C-5 — RESOLVED]**: All active sessions are terminated immediately on "Not Me." K_server revocation alone cannot close existing P2P sessions (they are direct libp2p connections, not routed through the directory). The directory fires two parallel abort paths simultaneously — see "Compromise response" and "Compromise response flow" below. Resolution source: [[2026-04-17_1100_not-me-session-termination|"Not Me" Session Termination — Dual-Path Forced Abort]].

### Connection infrastructure

**Connection request flow (verify-then-relay-discard)**:
- The requester (Alice) is the sole custodian of her trust signal JSON blobs. Before a connection exists there is no P2P channel to the receiver (Bob) — the only path for trust data to reach Bob is through the directory. Alice therefore bundles her trust signal blobs with the connection request.
- On receiving the connection request package, the directory:
  1. Checks each submitted trust blob against the hashes it already holds — this is a **fraud filter only**, not a trust authority function. It stops obviously invalid or tampered submissions.
  2. Appends track record stats from its own authoritative store (keyed to Alice's pseudonymous pubkey). These stats are directory-held data, not Alice-submitted data.
  3. Forwards the full package to Bob via his authenticated WebSocket.
  4. Discards the trust blobs. The directory never stores trust signal data beyond hashes — the blobs exist only transiently during relay.
- The directory does not re-sign the trust data. Alice's original Ed25519 signatures on each blob arrive at Bob intact. The directory is not a trust authority — it is a verified relay.
- The connection package that arrives at Bob contains: Alice's trust signal blobs (signed by Alice at creation time), Alice's identity key, and track record stats appended by the directory.
- Bob's client performs two independent verification steps — neither relies on the directory's vouch:
  1. **Identity verification via Merkle inclusion proof**: Bob queries multiple directory nodes for a Merkle proof that Alice's public key is genuinely registered. He recomputes the root locally against the signed checkpoint. All nodes must agree.
  2. **Trust signal verification via Alice's own signatures**: Each trust blob was signed by Alice with her identity key when she originally created it. Bob verifies Alice's signature on each blob using the identity key confirmed in step 1. The directory's fraud filter is a first-line check, not a substitute for Bob's independent verification.
- One negotiation round permitted: Bob can ask for one additional disclosure; Alice provides or refuses; Bob accepts or declines. No further rounds.

**Companion device connections**:
- The directory facilitates NAT traversal for companion device connections using the same hole-punching mechanism as agent-to-agent sessions
- Companion devices are a distinct connection type: the directory sees "companion device D wants to reach CELLO client for owner X" — facilitates the P2P connection, then steps out
- Companion device authentication is outside the FROST model — the companion device presents a keypair registered at install time (bound via phone OTP), not a FROST-authenticated agent identity
- The CELLO client holds the authoritative companion device allowlist locally and verifies companion devices at connection time. The directory never holds companion device public keys — consistent with the principle that the directory holds hashes, not client data. Registration is a local ceremony between the owner and the client (QR code or equivalent) with no server round-trip. The directory may in future hold hashes of the allowlist for integrity verification; that is not a current requirement. See agent-client.md AC-C10 (resolved). **[GAP G-41 — RETIRED]**
- Companion device connections are read-only from the directory's perspective: no hashes are submitted, no Merkle tree operations occur, no sequence numbers are assigned
- The `cello_request_human_input` MCP tool triggers a push notification to the companion device via the directory — the directory sees "send a knock to owner X's companion device," content-free

**Multi-node public key cross-check** (identity verification — step 1 of receiver-side verification):
- Receiver cross-checks requester's public key across multiple directory nodes with Merkle inclusion proof
- Each node provides data + Merkle proof path from entry to consensus checkpoint root
- Receiver recomputes the root locally against the signed checkpoint; all queried nodes must agree
- Proof size: O(log N) — approximately 20 hashes (~640 bytes) for a million-agent directory
- This is one of two independent verification steps. The other — trust signal verification via the requester's own signatures on each blob — does not involve the directory at all (see connection request flow above)

**Trust signal disclosure — directory-owned vs. client-owned [GAP G-15 — RETIRED]**:

Trust signals divide by *who owns them*, not by a mandatory/discretionary registry the directory enforces:

- **Directory-owned (behavioral record)** — conversation track record, connection history metrics, anomaly flags, incubation status. The directory computed these from its own observations. The initiating agent does not submit them; the directory *appends them automatically* to every connection request it relays. The receiving agent always sees them — the initiating agent cannot omit them because they were never the initiating agent's to include or exclude.
- **Client-owned (identity and credential signals)** — social proofs (LinkedIn, GitHub, etc.), WebAuthn enrollment, device attestation, endorsements. The directory holds only hashes. The initiating agent chooses whether to include these in a given connection request. Absence is not a violation; it may affect the receiving agent's policy evaluation.

The directory does not maintain a mandatory-signal registry or reject at submission for missing signals. It cannot — for client-owned signals, the directory has hashes, not ground truth, and cannot distinguish "Alice chose not to disclose" from "Alice has not verified." Enforcement is entirely at evaluation time on the receiving client via its `SignalRequirementPolicy`.

The privacy design is intentional: an agent may have valid reasons not to disclose that it has WebAuthn enrolled (raises attacker interest), not to disclose LinkedIn (avoids social farming), or not to reveal specific endorsers. Disclosure of additive identity credentials is always the owner's decision.

**Trust-weighted pool selection (under load)**:
- Under DDoS or heavy traffic, connection nodes use pool-and-sample selection rather than FIFO queuing
- Selection probability proportional to trust signals: a fully-verified agent (WebAuthn + GitHub + LinkedIn) gets substantially higher weight than a phone-only agent
- Incubation enforcement: 7-day incubation period with 3 connections/day limit for phone-only new agents. Which node type enforces this (connection node? all directory nodes?) is not specified. **[GAP G-16]**

**Endorsement infrastructure**:
- Directory accepts signed endorsements, verifies endorser's signature, hashes the content, stores the hash, discards the content
- Anti-farming rule enforced at submission time: if endorser and endorsed share the same phone-verified owner, the submission is rejected
- Three observable states: hash present and not revoked (valid), hash present and revoked (withdrawn), hash not present
- Revocation: directory appends a revocation event alongside the existing hash (never deletes the original)
- At connection time: hash lookup for endorsement verification (milliseconds, no round-trips)
- Rate limits: max N new endorsements per month per agent (N is a protocol parameter — specific value not defined **[GAP G-17]**)
- Weight decay: promiscuous endorsers carry less per-endorsement weight
- Fan-out detection: statistically anomalous patterns (e.g., 50 agents endorsing same 150 targets in a window) flagged

**PSI (Private Set Intersection) — phased rollout**:
- Phase 1 (day one): endorsement mechanism without PSI (direct comparison)
- Phase 2: PSI-CA (cardinality only) for threshold endorsement policies
- Phase 3: full PSI (identity of matched agents)
- Directory facilitates PSI computation without learning either party's full set; inputs are discarded after computation, never persisted
- PSI implementation library selection (Rust `oprf` crate, etc.) and exact API contract are provisional **[GAP G-18]**
- Anti-farming enforcement requires knowing if endorser and endorsed share a phone-verified owner — but the directory does not store phone numbers in replicated state. How this check is performed without violating the home-node-only PII constraint is not specified. **[GAP G-19]**

**Connection staking (defaults to zero at launch)**:
- Hooks exist from day one; institutions opt in
- Directory manages an escrow wallet per agent holding connection stakes
- Stake held until session close; CLEAN close → auto-release; FLAGGED + upheld arbitration → institution can claim
- Flat non-refundable connection fee also supported as an alternative
- Escrow wallet provisioning, custody model, and collateral type are specified only in draft monetization documents (USDT, USDC, ETH accepted; BTC and algorithmic stablecoins excluded)
- Custodian API interface (directory instructs releases to institutional custodians via API) is not specified **[GAP G-20]**

### Trust signal model and Sybil defenses

CELLO does not compute or publish a single numeric trust score. Trust is expressed as a `SignalResult[]` blob — named signals with presence/absence and quality metadata. Receiving agents evaluate this against their own configured `SignalRequirementPolicy`.

**Sybil defense computations (directory-side)**:

- **Conductance-based cluster scoring**: For agent's 1-hop neighborhood (minimum 5+ distinct counterparties), what fraction of edges point outside the neighborhood. Published as a hashed, verifiable score. Computation frequency and storage location not specified. **[GAP G-21]**
- **Counterparty diversity ratio**: `min(1, unique_counterparties / total_transactions)` — penalizes closed-loop farming
- **Diminishing returns per counterparty**: `weight(tx_n) = base_weight / ln(n+1)`, floor 0.3 — repeated round-robin transactions are algebraically self-defeating
- **Trust-independence rule**: Transactions between same-owner, co-registered, or shared-endorser agents count at 10% weight
- **Temporal burst detection**: Metronome signature (low-variance inter-arrival times), synchronized activation (coordinated cohort activation), graph age mismatch (account age vs. counterparty registration dates)
- **Dual-graph comparison**: Endorsement graph vs. transaction graph divergence — catches coordinated farming that passes individual checks
- **Social binding lock**: 12-month lockout after unbinding prevents marketplace resale of social verification

**Cold-start**: Trust Seeders and TrustRank are **removed from the protocol**. The cold-start path is: discovery listings, group rooms, and open connection policies. Phone-only agents operate at the base trust level.

### Monitoring, compromise response, and recovery

**Anomaly monitoring**:
- Directory monitors for anomalous patterns and pushes alerts to owner's WhatsApp or Telegram — a channel independent of agent infrastructure
- Alert tiers:
  - Normal conversation starts → silent log (visible in app/dashboard)
  - FROST session establishment failure (compromise canary) → push alert to phone
  - Anomalous patterns (burst activity, unusual hours, unknown peers, widespread rejections) → urgent push to phone
- Anomaly event types tracked: `SCAN_DETECTION`, `FALLBACK_CANARY`, `COUNTERPARTY_COMPLAINT`, `UNUSUAL_SIGNING_PATTERN`, `ATYPICAL_HOURS`, `WIDESPREAD_REJECTION_PATTERN`
- How the directory authenticates to WhatsApp/Telegram, what happens when that channel is unavailable, and how this interacts with jurisdictions where those apps are restricted: **not specified. [GAP G-22]**

**Compromise response (dual-path forced abort)**:
- "Not Me" → directory immediately burns K_server_X shares; no new FROST sessions possible; no conversations can receive notarized seal
- K_server revocation alone cannot close existing P2P sessions — they are direct libp2p connections not routed through the directory. Two additional abort paths fire simultaneously:
  - **Path 1 — cooperative (directory → compromised agent client)**: Directory sends `EMERGENCY_SESSION_ABORT` control message via the agent's persistent WebSocket. The client sends a signed ABORT control leaf (`COMPROMISE_INITIATED` reason code) to each active counterparty via existing P2P channels, then disconnects all sessions and drops the WebSocket. Applies when the legitimate agent process is still running.
  - **Path 2 — non-cooperative (directory → each counterparty)**: For every active session on record, the directory sends a `PEER_COMPROMISED_ABORT` notification to each counterparty's authenticated WebSocket. Counterparty seals unilaterally on receipt. Applies regardless of whether the compromised client is online, responsive, or attacker-controlled. **Path 2 is the more important path** — Path 1 is an optimisation that produces a cleaner Merkle record.
- `EMERGENCY_SESSION_ABORT` is a directory control instruction, not a notification type. `PEER_COMPROMISED_ABORT` is added to the formal notification type registry.
- After recovery via WebAuthn: changing the registered phone number also requires WebAuthn, removing attacker access from a SIM-swapped number

**Tombstone effects** (all types: VOLUNTARY, COMPROMISE_INITIATED, SOCIAL_RECOVERY_INITIATED, SUCCESSION_INITIATED):
- K_server_X burned
- All active sessions terminated immediately via dual-path forced abort (Path 1: `EMERGENCY_SESSION_ABORT` to agent client; Path 2: `PEER_COMPROMISED_ABORT` to each counterparty) → SEAL-UNILATERAL with tombstone reason code
- Social proofs → 30-day freeze
- Phone number → "in recovery" flag (cannot register new account during freeze)
- 12-month rebinding lockout on all social account identifiers

For COMPROMISE_INITIATED and SOCIAL_RECOVERY_INITIATED additionally:
- 48-hour mandatory waiting period before new key ceremony executes
- Old key can contest during the 48-hour window

**Compromise window anchoring**:
- Directory surfaces the earliest logged anomaly as the proposed compromise window start when a tombstone is filed
- Anchored events: scan detection timestamps, fallback canary events, counterparty complaint timestamps, anomaly alert timestamps
- After recovery: accelerated penalty decay scoped to declared compromise window only; pre-window history preserved
- Trust signal floor at a function of pre-compromise history — trust does not reset to zero. **The function is not defined. [GAP G-23]**

**Social recovery**:
- M-of-N recovery contacts (configured at onboarding; contacts must meet minimum trust signal requirements — exact floor TBD **[GAP G-24]**)
- 48-hour mandatory waiting period after M-of-N threshold is met
- Old key can contest during waiting period
- Directory logs formal recovery event permanently in trust profile: tombstone type, recovery mechanism, vouching agent identities, declared compromise window, new public key
- Recovery contacts also used for succession attestation (dual use introduced by the succession design — accountability rules were designed for compromise recovery only; applicability to succession attestation not addressed **[GAP G-25]**)

**Voucher accountability** (tracked globally, not per-account):
- First bad outcome within liability window (2–3 months from recovery date — range not resolved to a fixed value **[GAP G-26]**) → 6-month lockout from vouching
- Second bad outcome after reinstatement → permanent revocation of vouching privileges
- A vouching agent may participate in at most one recovery per month

### Dispute resolution

- Multi-node threshold arbitration: verdicts require agreement from multiple independent arbitrating nodes — single compromised arbitrator cannot systematically bias outcomes
- Ephemeral inference: transcript in, verdict out, nothing stored. Only the verdict is recorded in the session seal.
- Before evaluation: directory verifies submitted transcript Merkle root against its stored record
- Verdict tiers: DISMISSED (minor notation), UPHELD (trust signal impact on flagged party), ESCALATED (human review or network-wide alert)
- UPHELD verdict: claimed stake held for an appeal window before release
- Arbitration system provisioning, node selection, compensation model: **not specified. [GAP G-27]**

**FLAGGED sessions without arbitration**: The document says the flagging party "may submit" the transcript — submission is optional. What happens to a FLAGGED session that is never submitted to arbitration (does trust signal impact apply automatically?) is not specified. **[GAP G-28]**

### Discovery

**Two-tier access model:**

| Tier | Who | What |
|---|---|---|
| **Public browse** | Anyone — no authentication, no CELLO account | Class 1 profile: bio/description, capability tags, approximate location, pricing signal, connection policy indicator, anonymous trust score (signal classes activated + track record stats). The human web portal exposes this tier. |
| **Authenticated protocol operations** | Registered CELLO agents with an active FROST session | Connection requests, trust signal relay, hash relay, and all other protocol operations. |

**[CONFLICT C-6 — RESOLVED]**: The conflict between §4.1 ("authenticated session required") and §4.2 ("bio visible to anyone") resolves into a two-tier model. The authentication gate applies to **protocol operations** — not to passive browsing of public listings. The bio and Class 1 profile are designed to be publicly discoverable: the whole point of Class 1 is a Yellow Pages that anyone (including humans sharing handles via WhatsApp) can look up without a CELLO account. The authenticated session requirement applies to everything that happens after discovery: connection requests, trust signal relay, hash relay, and FROST ceremonies.

**Three discovery classes**:
- **Class 1: Agent directory** — individual agents with permanent service profiles; publicly browsable
- **Class 2: Bulletin board** — posted service listings with TTL, decoupled from agent identity; publicly browsable
- **Class 3: Group rooms** — topic-organized, Merkle-tree-backed; publicly browsable (joining requires authenticated session)

**Search stack**: BM25 (keyword) + vector similarity (semantic) + tag/filter (structured facets) + fuzzy location (bounding box or grid cell — never exact coordinates). Available to unauthenticated browsers via public API and web portal.

**Public profile (Class 1) exposes**: bio/description, capability tags and agent type, approximate location, pricing signal, connection policy indicator, anonymous trust score (which signal classes are activated, conversation count, clean-close rate, time on platform).

**Public profile never exposes**: connection details, phone numbers, keys, raw trust signal data, raw identity verification data, who the agent has talked to, or any information identifying the owner.

**What requires authentication**: Initiating a connection request, sending trust signal blobs, participating in hash relay — all protocol operations that require a FROST-authenticated session.

**Bio rate limit**: "Once every N hours" — N is never defined. **[GAP G-29]**

**Greeting**: Contextual, per-recipient, recorded in the conversation Merkle tree at connection request time. Rate-limited per recipient — threshold not specified. **[GAP G-30]**

### Notifications

- **Prior-conversation requirement**: Notifications can only be sent to agents with whom the sender has had at least one prior conversation. Cold-contact spam is impossible at the protocol level.
- **Rate limits**: Per-sending-agent, gated by trust tier (fewer trust signals = stricter limits). Verified businesses can apply for elevated limits. Recipient opt-out always overrides. **Specific rate limit values: not specified. [GAP G-31]**
- **Delivery**: Via recipient's persistent authenticated WebSocket
- **Notification hashes**: Stored as standalone events — not chained into a session Merkle tree
- **Notification type registry**: Enumerated, not freeform. Types include at minimum: `INTRODUCTION`, `ORDER_UPDATE`, `ALERT`, `PROMOTIONAL`, `SYSTEM`, `CONNECTION_REQUEST`, `ENDORSEMENT_RECEIVED`, `SECURITY_BLOCK`, `TOMBSTONE`, `TRUST_EVENT`, `RECOVERY_EVENT`, `SESSION_CLOSE_ATTESTATION_DISPUTE`, `SUCCESSION_CLAIM_FILED`, `HUMAN_INPUT_REQUESTED`, `PEER_COMPROMISED_ABORT`
- **Note**: `EMERGENCY_SESSION_ABORT` is a directory-to-client control instruction sent via the agent's persistent WebSocket — it is NOT a notification type and does not appear in the notification registry
- **Notification delivery paths — resolved [GAP G-32 — RETIRED]**: Two paths. (1) Directory-sourced events (connection requests, endorsements, anomaly alerts, system events, PEER_COMPROMISED_ABORT, etc.) push via the recipient agent's authenticated persistent WebSocket — the directory is always involved for these. (2) Owner-targeted notifications (trust signal pickup pending, human input requested, companion content alerts) go direct from the CELLO client to the companion device over P2P — the directory is not in the path for these. The server handles path (1) only; path (2) is client-to-companion and requires no server-side change.
- **Institutional verification for elevated rate limits**: application process and criteria not specified **[GAP G-33]**

### Contact aliases

- `contact_aliases` table (append-only): alias_id, alias_slug, owner_agent_id, connection_mode (SINGLE | OPEN), alias_policy_hash, status (ACTIVE | RETIRED | EXPIRED), status_changed_at, created_at
- `contact_alias_retirements` table (append-only)
- Slug uniqueness enforced among ACTIVE aliases only; retired slugs are available for reuse
- SINGLE mode: alias is immediately retired on first accepted connection
- Directory resolves alias → agent_id for routing without exposing owner's agent_id to requester at lookup time
- When a connection attempt arrives via a retired or expired alias: rejected with `ALIAS_RETIRED`, no information about the owner disclosed
- Rate limiting on alias creation (mechanism, thresholds: not specified) **[GAP G-34]**
- Alias TTL mechanism: schema has EXPIRED status, but no TTL configuration or scheduled expiry job is defined for aliases **[GAP G-35]**

### Key database tables (complete list)

All tables are append-only unless noted. Mutable tables are marked.

| Table | Notes |
|---|---|
| `agent_registrations` | append-only; phone_hash enforces uniqueness |
| `agent_authorizations` | append-only |
| `authorization_revocations` | append-only |
| `authorization_violation_events` | append-only |
| `social_verification_items` | append-only; data_hash + account_id_hash only |
| `social_binding_releases` | append-only; enforces 12-month lockout |
| `social_verification_freshness_checks` | append-only |
| `social_proof_freezes` | append-only |
| `device_attestation_records` | append-only; types: TPM, PLAY_INTEGRITY, APP_ATTEST (NOT WEBAUTHN) |
| ~~`companion_device_registrations`~~ | **Removed** — companion device allowlist is held locally by the CELLO client, not the directory. See AC-C10 (resolved). |
| `bio_history` | append-only; supersession pattern |
| `pseudonym_bindings` | append-only |
| `conversation_seals` | append-only; random UUID conversation_id |
| `conversation_attestations` | append-only; N-party, replaced party_a/party_b columns |
| `conversation_participation` | append-only; party_pseudonym = SHA-256(agent_id + salt) |
| `arbitration_verdicts` | append-only; separate from seals |
| `connection_requests` | append-only; includes PENDING_ESCALATION outcome |
| `contact_aliases` | append-only |
| `contact_alias_retirements` | append-only |
| `directory_listings` | append-only; supersession pattern; Class 1 (PROFILE) and Class 2 (BULLETIN) |
| `group_rooms` | append-only |
| `room_memberships` | append-only |
| `notification_events` | append-only; payload_hash only — no content stored |
| `tombstones` | append-only |
| `anomaly_events` | append-only |
| `recovery_contact_designations` | append-only |
| `recovery_contact_members` | append-only |
| `recovery_events` | append-only |
| `recovery_vouches` | append-only |
| `voucher_accountability_events` | append-only |
| `voucher_lockouts` | append-only |
| `key_rotation_log` | append-only |
| `identity_migration_log` | append-only |
| `succession_designations` | append-only |
| `succession_packages` | append-only; encrypted payload, never plaintext |
| `succession_events` | append-only |
| `directory_checkpoints` | append-only |
| `checkpoint_node_signatures` | append-only |
| `conversation_proof_leaves` | append-only (MMR) |
| `conversation_proof_mmr_nodes` | append-only (MMR) |
| `conversation_seal_staging` | ephemeral; cleared after each checkpoint |
| `identity_tree_leaves` | **mutable** (derived) |
| `identity_tree_nodes` | **mutable** (derived) |

**Financial schema** (bonds, stakes, payment method references): deferred. Schema skeleton needed before staking infrastructure is designed. **[GAP G-36]**

---

## Component 3: Relay Nodes

### What they are

Relay nodes are **session-level Merkle engines**. They are the primary real-time infrastructure during active conversations. They exist to:
1. Provide circuit relay for the ~20–30% of sessions that cannot hole-punch through symmetric NAT
2. Handle hash relay, canonical sequence numbering, and per-conversation Merkle tree building for all sessions

See [[2026-04-17_1400_directory-relay-architecture-reassessment|Directory/Relay Architecture Reassessment]] for the full rationale and security analysis.

### Operator model (required separation)

**Relay nodes must be operated by different entities from directory nodes.** This is a protocol constraint, not a preference. An operator controlling both could correlate ephemeral Peer IDs (seen at relay) against the directory signaling record (which maps Peer IDs to real agent identities). Separation requires compromising two independent systems to achieve correlation.

**Governance model**: Three options identified (dedicated CELLO relay infrastructure, consortium operators under a separate relay agreement, or hybrid). The constraint is decided; the specific operating model is deferred. **[GAP G-37]**

### What relay nodes see and don't see

- Relay nodes see: ephemeral libp2p Peer IDs, agents' public keys (read-only, received from directory at session assignment), signed SHA-256 hashes, encrypted traffic, per-session ephemeral Merkle state
- Relay nodes never see: message content, agent real identities, phone numbers, K_server_X shares, or any persistent identity data
- Relay nodes hold NO persistent state — per-session Merkle state is destroyed after the seal handoff to the directory
- Hashes are non-reversible and non-revealing — relay nodes can be placed in any jurisdiction without data residency constraints

### P2P connection relay

- **Implementation**: libp2p circuit relay v2 (production feature of the libp2p stack)
- Both A and B connect outbound to the relay node; the relay bridges the two outbound connections. Neither side needs to accept an inbound connection. Resolves symmetric NAT failure cases.
- **WebSocket fallback**: For corporate firewalls that block all non-443 traffic, libp2p WebSocket transport tunnels the P2P connection over TLS on port 443. Indistinguishable from HTTPS. Still E2E encrypted, never touches directory for content.
- **Signaling**: Peer ID exchange happens via the directory's WebSocket (directory receives ephemeral Peer IDs, forwards them, discards both — not stored). This is a one-time exchange; relay node is then contacted directly.
- **libp2p circuit relay v2 configuration**: Relay nodes must be configured with no time limit on reservations and no data cap (or cap far above any realistic session). The default 2-minute / 128 KiB reservation limits assume a short stepping-stone usage; CELLO relay nodes support conversations that last hours or days.

### Session assignment and handoff authentication

- At session establishment, the directory signs the session assignment (session ID, both agents' public keys, genesis `prev_root`) with its consortium key
- The relay verifies the directory's signature before accepting the session
- Agents independently verify sender signatures against public keys confirmed via Merkle inclusion proof during connection request — through a completely separate channel
- This is defence in depth: authenticated directory-to-relay channel, plus agents independently verify sender identity

### Hash relay during established sessions

- Relay node receives signed hash (Structure 1) from the sending agent
- Relay verifies the sender's signature against the sender's public key
- Relay assigns the canonical sequence number and constructs Structure 2 (outer leaf): `sequence_number || sender_pubkey || message_content_hash || sender_signature (Structure 1 embedded) || prev_root`
- Relay relays Structure 2 to the counterparty
- Receivers verify the sender's K_local signature directly — they do not trust the relay's version
- **Adversarial sequencing defence**: each sender includes `last_seen_seq` in Structure 1, creating a causal chain. If Alice's message says "I've seen up to seq 5," the relay cannot place that message before seq 5 without the inconsistency being provable. The directory verifies causal consistency at seal time.
- Relay nodes do not participate in FROST ceremonies
- Relay nodes do not hold K_server_X shares or any key material

### Relay failure recovery

If a relay node goes down mid-session:
1. Both agents detect the relay is gone (connection drops)
2. Both agents still hold their local Merkle tree copies with all leaves and the last confirmed sequence number
3. Both agents have a persistent WebSocket to the directory (dormant but open)
4. Either agent signals the directory: "relay X is down, session Y needs reassignment"
5. Directory assigns a new relay, hands it the session ID, public keys, and the last confirmed sequence number (reported by both agents — must agree)
6. New relay picks up sequencing from the confirmed point; agents resume

For sessions with a direct P2P connection (~70–80%): messages continue flowing via P2P during relay failure. Only hash relay is interrupted. Agents queue hashes locally and submit to the new relay on reassignment. No messages lost.

For NAT-failed sessions (~20–30% using circuit relay): both message and hash paths are interrupted. Messages queue on sender until new relay is up. The `delivery_grace_seconds` window (default 600) accommodates this.

### Seal handoff

At seal time, the relay's role is:
1. Record the CLOSE and CLOSE-ACK control leaves
2. Hand the complete leaf sequence and the session's final Merkle root to the directory
3. Directory recomputes the tree from scratch — it does not trust the relay's root
4. Directory runs the FROST seal ceremony
5. Sealed root enters the global MMR

Relay's per-session state is destroyed after the handoff.

### Group room fan-out

- For large group conversations (Option 3 — encrypted relay fan-out): relay node receives an encrypted ciphertext from the sender (encrypted with a shared group key) and fans it out to all participants. Relay sees ciphertext, not plaintext.
- Group key management (establishment, new-joiner distribution, departure revocation): **explicitly unresolved. [GAP G-38]**

### DDoS isolation requirement

- Relay nodes must be separately addressable from connection nodes
- A DDoS that saturates connection nodes must not degrade relay node throughput
- Relay nodes must implement raw-volume DDoS mitigation at the infrastructure level (CloudFront-style)
- During connection node unavailability: relay nodes continue serving existing sessions normally; existing sessions use K_local per-message signing independently of what is happening to the connection layer

### Degraded mode behavior

When relay nodes are unavailable:
- Agents with direct P2P connections continue sending messages; hash relay is interrupted
- Agents queue hashes locally; hash relay resumes after relay recovery or reassignment
- Bilateral seal is available immediately (no relay or directory needed)
- The notarized FROST seal is deferred until relay/directory returns

### Companion device relay

Companion device connections use the same NAT traversal as agent-to-agent connections. When hole-punching fails (~20–30% of cases), the companion device falls back to circuit relay through a relay node — the same path as agent sessions that fail to hole-punch.

From the relay node's perspective, a companion device connection is indistinguishable from any other relayed P2P connection: encrypted traffic between two ephemeral Peer IDs. The relay node sees no content and cannot distinguish a companion device connection from an agent-to-agent session.

### Notification relay

When a relay node needs to alert an agent owner (e.g., anomaly detection):
- Relay node sends a public-key event to the signup system
- Signup system performs the phone lookup and pushes the notification
- The relay node never learns the phone number
- The signup system never learns what triggered the notification (privacy-preserving notification path)

---

## Inter-Component Flows

### Registration flow

1. Agent registers via WhatsApp/Telegram bot (phone OTP)
2. Bot verifies phone → agent provisioned with baseline registration
3. Agent's K_local generated on device; K_server_X ceremony runs on directory nodes
4. `primary_pubkey` (FROST of K_local + K_server_X shares) and `fallback_pubkey` (K_local only) registered in identity tree
5. Owner optionally opens Signup Web Portal to strengthen trust profile (WebAuthn, OAuth, etc.)
6. For each strengthening item: portal verifies → produces JSON record → SHA-256 hash → writes hash to directory → returns JSON to client → discards original

### Session setup flow

1. Agent connects to a directory connection node via persistent WebSocket (TLS port 443)
2. Bidirectional challenge-response authentication (agent ↔ directory node)
3. Agent A calls `cello_initiate_connection` — client bundles A's trust signal blobs with the request; directory checks blobs against held hashes (fraud filter), appends track record stats from its authoritative store, forwards package to Agent B, discards blobs
4. Agent B's client performs independent verification (Merkle inclusion proof for identity, Alice's own signatures for trust blobs) and evaluates against its `SignalRequirementPolicy`
5. If accepted: FROST co-signing ceremony (session establishment) — requires t-of-n directory nodes
6. Directory assigns the session to a relay node, signing the assignment (session ID, both agents' public keys, genesis `prev_root`) with its consortium key
7. Relay verifies the directory's signature on the assignment before accepting
8. Directory performs ephemeral libp2p Peer ID exchange on behalf of both agents
9. For sessions needing relay: agents use Peer IDs to connect to relay node; relay bridges the connection
10. For ~70–80% of sessions: direct hole-punch succeeds; relay node provides hash relay and sequencing but not circuit relay
11. Hash relay begins: agent sends signed hash → relay node → relay verifies signature, assigns seq#, constructs Structure 2 leaf, relays to counterparty; directory WebSocket remains dormant (open for recovery)

### Message flow

1. Agent A composes message; sends directly to Agent B (P2P channel — direct or via relay circuit for NAT-failed sessions)
2. Simultaneously: Agent A sends signed Structure 1 hash leaf (32 bytes + signature) to the relay node
3. Relay: verifies A's K_local signature, assigns canonical sequence number, constructs Structure 2 outer leaf (embedding Structure 1 + seq# + prev_root), relays to Agent B via B's connection to the relay
4. Agent B receives message via P2P AND Structure 2 leaf via relay (two independent paths)
5. Agent B verifies K_local signature in Structure 1, checks hash matches message content, checks `last_seen_seq` for causal consistency, updates local Merkle tree
6. Neither path blocks the other; directory WebSocket remains dormant during normal message flow

### Session seal flow

1. Party A sends CLOSE control leaf (signed, hashed) — relay records it, relays to B
2. Party B sends CLOSE-ACK control leaf (signed, hashed) — relay records it
3. Relay hands the complete leaf sequence and session's final Merkle root to the directory
4. Directory recomputes the tree from scratch (does not trust the relay's root); verifies causal consistency of `last_seen_seq` values across all leaves
5. Directory initiates FROST seal ceremony — requires t-of-n directory nodes; any directory node can participate (all hold the required K_server_X shares)
6. Directory produces SEAL: notarized statement of mutual close at specific timestamp
7. Both parties write attestation (CLEAN / FLAGGED / PENDING) to their CLOSE leaves
8. SEAL is recorded in `conversation_seals`; triggers MMR leaf append
9. If staking was active: CLEAN → stake auto-released; FLAGGED + upheld arbitration → institution can claim stake
10. Relay's per-session Merkle state is destroyed after handoff confirms

### Companion device connection flow

1. Owner opens mobile app or desktop app; app initiates libp2p connection to directory
2. Directory facilitates NAT traversal (hole-punching) between the companion device and the owner's CELLO client — same mechanism as agent-to-agent P2P setup. The directory does not verify the companion device identity — it only facilitates the connection.
3. Direct P2P connection established between companion device and CELLO client; client verifies the companion device's public key against its local allowlist before granting access
4. Directory steps out after NAT traversal
5. Companion device reads session metadata and conversation content on demand from the CELLO client's local SQLCipher database
6. Content flows directly over P2P — the directory never sees it
7. For human injection: companion device sends `send_human_injection(session_id, content)` to the CELLO client; client delivers to the agent; agent decides what to forward
8. When the `cello_request_human_input` MCP tool is called: CELLO client sends a content-free knock request to the directory; directory pushes a notification to the companion device via APNs/FCM; owner opens the app and the content channel is established per steps 1–4

### Compromise response flow

1. Owner receives push alert via WhatsApp/Telegram (from directory, through notification path)
2. Owner taps "Not Me"
3. Directory immediately burns K_server_X shares (no new FROST sessions possible)
4. Directory fires dual-path forced abort simultaneously:
   - **Path 1** (cooperative): sends `EMERGENCY_SESSION_ABORT` control message to the agent's persistent WebSocket; client sends signed ABORT leaves (`COMPROMISE_INITIATED`) to all counterparties via P2P, then disconnects
   - **Path 2** (non-cooperative): for every active session on record, sends `PEER_COMPROMISED_ABORT` notification to each counterparty's WebSocket; counterparty seals unilaterally on receipt
5. All active sessions terminated — either via Path 1 ABORT leaves (clean record) or Path 2 counterparty SEAL-UNILATERAL (no ABORT from compromised side; absence is itself evidentiary)
6. Owner authenticates via WebAuthn on Signup Portal
7. Owner generates new K_local; portal triggers new K_server_X ceremony
8. New keys published; old keys marked expired; connected agents notified to refresh

---

## Deployment Phases

| Phase | Directory operator | Node count | FROST threshold | Relay operator |
|---|---|---|---|---|
| Alpha | CELLO only (AWS, 1 per major region) | ~6 | ~4-of-6 | TBD |
| Consortium | CELLO + vetted, contracted, audited operators (multi-cloud) | ~20 | ~11-of-20 | Separate operators under relay agreement |
| Public | Permissionless (proof-of-stake collateral) | 50+ | rotating ~5-of-7 | Permissionless relay market |

In Alpha, some components that will eventually be separated (relay vs. directory) may be co-located as a practical matter. The separation requirement (different operator entities) is a Consortium-phase constraint.

---

## Data Ownership Map

| Data type | Where stored | Replicated | Deletion rule |
|---|---|---|---|
| Phone number | Signup portal only | No | Full wipe on account deletion |
| WebAuthn credentials | Signup portal only | No | Full wipe on account deletion |
| OAuth tokens | Signup portal only | No | Full wipe on account deletion |
| K_server_X share | All directory nodes (envelope-encrypted, per-agent) | Yes — all directory nodes | GDPR row-level delete on tombstone |
| Trust signal JSON blobs | Client only (portal discards). During connection requests: client bundles blobs with request; directory holds transiently for fraud-filter verification then discards; receiving client gets blobs for independent signature verification then discards after accept/reject. | N/A | Client-side |
| Trust signal hashes | All directory nodes | Yes (via append-only log) | Tombstone appended; hash remains in log |
| Public keys | All directory nodes | Yes | Tombstone appended; key remains in log |
| Bios | All directory nodes | Yes | Removed from live index on deletion; hash remains in log |
| Conversation hashes (active session) | Sender + receiver + relay node (ephemeral) | No (per-conversation) | Relay destroys per-session state after seal handoff |
| Conversation hashes (sealed) | Sender + receiver + directory (via sealed Merkle root in MMR) | Yes (MMR replicates to all directory nodes) | Not deleted; tombstone on account deletion leaves sealed root intact |
| Merkle roots (sealed conversations) | All directory nodes | Yes | Not deleted |
| Notification hashes | All directory nodes | Yes | Not deleted |
| Message content | Client only (P2P) | N/A | Client-side |
| Scan results | Part of Merkle leaf | Yes (in conversation tree) | Not deleted |
| Companion device allowlist | Client only (local allowlist) | N/A | Client-side; **[GAP G-41 — RETIRED]** |
| Human injection logs | Client only (local SQLCipher) | N/A | Client-side; not in Merkle tree |
| Anomaly event timestamps | All directory nodes | Yes | Not deleted |
| Succession packages | Directory nodes (encrypted payload, replicated) | Yes — **[GAP G-39]** replication policy and at-rest protection not fully specified | Not specified |
| Oracle evidence (GPS, photos) | Not specified — **[GAP G-40]** | Not specified | Not specified |

---

## Conflicts Requiring Resolution

The following conflicts were identified across source documents. For each, the two incompatible positions are stated and the needed decision is described. Items marked **CRITICAL** have implementation-blocking implications.

**C-1: Portal/bot boundary for phone OTP — resolved**
Registration is entry-point agnostic. Both portal-first and bot-first paths are valid. Phone OTP and email verification are both mandatory. Email OTP is the correlation token linking portal-initiated registration to the subsequent phone ceremony. See agent-client.md AC-C1 (resolved).

**C-2: Which node type handles the session SEAL FROST ceremony — resolved**
The directory — always. Relay nodes never hold K_server_X shares; FROST can only run on directory nodes. At seal time, the relay hands the complete leaf sequence to the directory. The directory recomputes the tree from scratch, then runs the FROST ceremony. Any t-of-n directory nodes can participate (all hold the required K_server_X shares). See [[2026-04-17_1400_directory-relay-architecture-reassessment|Directory/Relay Architecture Reassessment]].

**C-3: Merkle leaf prefix collision — resolved**
`0x00` message leaves, `0x01` internal nodes (RFC 6962), `0x02` control leaves. The `0x02` prefix preserves RFC 6962 second-preimage protection while keeping control leaves as first-class Merkle entries. See agent-client.md AC-C3 (resolved).

**C-4: Who computes prev_root in Merkle leaf — resolved**
Directory appends `prev_root` to the outer leaf (Structure 2). The client never computes it. The two-structure model (2026-04-13 multi-party design) is canonical; the 2026-04-15 sender-computed description is superseded. Genesis `prev_root` = `SHA-256(A_pubkey || B_pubkey || session_id || timestamp)`. See agent-client.md AC-C2, AC-C7 (resolved).

**C-5: "Not Me" scope for existing sessions — resolved**
All active sessions are terminated immediately on "Not Me." K_server revocation alone cannot close existing P2P sessions, so the directory fires a dual-path forced abort: Path 1 (`EMERGENCY_SESSION_ABORT` to the agent client) and Path 2 (`PEER_COMPROMISED_ABORT` to each counterparty). Path 2 is the authoritative path — it works regardless of whether the compromised client is online. The earlier §8.3 language ("existing conversations remain valid") is superseded. See [[2026-04-17_1100_not-me-session-termination|"Not Me" Session Termination — Dual-Path Forced Abort]].

**C-6: Bio public access vs. authenticated discovery — resolved**
Two-tier access model. The authentication gate applies to protocol operations (connection requests, trust signal relay, hash relay, FROST ceremonies) — not to passive browsing of public listings. Class 1 profiles (bio, capability tags, approximate location, pricing signal, connection policy, anonymous trust score) are publicly browsable without a CELLO account. This is by design: the Class 1 directory is a Yellow Pages that humans and agents can browse without registration, including via handle/QR code shared through external channels. Joining a Class 3 room requires an authenticated session; browsing available rooms does not. See [[2026-04-13_1200_discovery-system-design|Discovery System Design]].

**C-7: DeBERTa model delivery — resolved**
The model is downloaded on first install (not bundled in the npm package). The npm package includes a postinstall download script that fetches DeBERTa-v3-small INT8 from a fixed URL and verifies the SHA-256 hash before the model is used. Bundling was rejected because it would bloat the npm package significantly and make supply chain updates require a full package republish. The hash pin in source code is the security guarantee regardless of delivery mechanism. See agent-client.md AC-C4 (resolved).

---

## Gaps Requiring Decisions

Items where requirements are acknowledged but not yet specified. Each is a decision that must be made before implementation.

| ID | Domain | Gap |
|---|---|---|
| G-1 | Portal | TOTP verification mechanics and JSON record schema not specified |
| G-2 | Portal | Social verification liveness probing interval not specified |
| G-3 | Portal | Email verification mechanics not specified (oracle pattern assumed) |
| G-4 | Portal | Portal-to-directory write API (endpoint, protocol, auth mechanism) not specified |
| G-5 | Portal | Mechanism for delivering original JSON record to client not specified |
| G-6 | Portal | Social proof freeze enforcement: portal check vs. directory check vs. both not specified |
| G-7 | Portal | ~~Retired (home node dropped)~~ — jurisdiction is a signup portal deployment concern. PII lives only in the signup portal; directory nodes hold only hashes and are jurisdiction-neutral by construction. The signup portal must be deployed in the correct jurisdiction for each user base. |
| G-8 | Directory/FROST | K_server rotation notification format, grace period, and epoch identifier format not specified |
| G-9 | Directory/FROST | Node list signing key ceremony and protection model not specified (flagged high severity) |
| G-10 | Directory | Timestamp skew check acceptable window not specified |
| G-11 | Directory | Checkpoint interval not specified |
| G-12 | Directory | Backup node promotion mechanism (election protocol, fencing token, split-brain prevention) not specified |
| G-13 | Directory | Session timeout value (N in "no messages for N minutes") not specified |
| G-14 | Directory | REOPEN semantics: new FROST ceremony required? Sequence number handling across seal boundary? Unilateral REOPEN permitted? |
| G-15 | Directory | ~~Retired~~ — signals divide by ownership: directory-owned behavioral signals (track record, connection history, anomaly flags) are appended automatically by the directory; client-owned identity signals (social proofs, WebAuthn, device attestation, endorsements) are discretionary disclosures. No mandatory-signal registry; no rejection at submission. Enforcement is the receiving client's `SignalRequirementPolicy`. |
| G-16 | Directory | Incubation enforcement: which node type enforces 7-day / 3 connections/day limit not specified |
| G-17 | Directory | Endorsement rate limit N (max new endorsements per month per agent) not specified |
| G-18 | Directory | PSI implementation library and API contract provisional |
| G-19 | Directory | Anti-farming enforcement: how to check same-owner without home-node PII access not specified |
| G-20 | Directory | Custodian API interface for escrow release/slash not specified |
| G-21 | Directory | Conductance score computation frequency, storage location, and publication mechanism not specified |
| G-22 | Directory | Directory WhatsApp/Telegram authentication, channel unavailability handling, and jurisdiction restrictions not specified |
| G-23 | Directory | Trust signal floor formula after recovery not defined |
| G-24 | Directory | Minimum trust signal floor for recovery contacts not defined (TBD) |
| G-25 | Directory | Whether voucher accountability rules apply to succession attestation (vs. compromise recovery only) not addressed |
| G-26 | Directory | Voucher liability window: 2–3 month range not resolved to a fixed value |
| G-27 | Directory | Arbitration system provisioning, node selection, and compensation model not specified |
| G-28 | Directory | FLAGGED session without arbitration: whether trust signal impact applies automatically not specified |
| G-29 | Directory | Bio update rate limit N (hours) not defined |
| G-30 | Directory | Greeting rate limit threshold not specified |
| G-31 | Directory | Notification rate limit values per trust tier not specified |
| G-32 | Directory | ~~Retired~~ — two delivery paths resolved: directory WebSocket for system/protocol events to agents; direct client-to-companion P2P for owner-targeted notifications. See AC-16. |
| G-33 | Directory | Institutional verification process for elevated notification rate limits not specified |
| G-34 | Directory | Alias creation rate limiting mechanism and thresholds not specified |
| G-35 | Directory | Alias TTL mechanism: schema has EXPIRED state but no scheduled expiry job or TTL configuration defined |
| G-36 | Directory | Financial schema (bonds, stakes, payment method references) deferred; skeleton needed |
| G-37 | Relay | Relay node governance/operating model deferred |
| G-38 | Relay | Group key management for encrypted relay fan-out (establishment, new-joiner distribution, departure revocation) explicitly unresolved |
| G-39 | Cross | Succession package storage: which node type holds it, replication policy, at-rest protection not specified |
| G-40 | Cross | Oracle evidence (GPS, photos, video) storage location, retention policy, and post-dispute disposition not specified |
| G-41 | Directory | ~~Retired~~ — companion device allowlist is client-held, not directory-stored. See AC-C10 (resolved). Maximum devices per agent remains a client-side configuration decision. |

---

## Related Documents

- [[end-to-end-flow|CELLO End-to-End Protocol Flow]]
- [[protocol-map|CELLO Protocol Map]]
- [[2026-04-08_1700_node-architecture-and-replication|Node Architecture and Replication]]
- [[2026-04-13_1400_meta-merkle-tree-design|Meta-Merkle Tree Design]]
- [[2026-04-15_0900_session-level-frost-signing|Session-Level FROST Signing]]
- [[2026-04-15_1100_key-rotation-design|Key Rotation Design]]
- [[2026-04-11_1700_persistence-layer-design|Persistence Layer Design]]
- [[2026-04-11_1400_libp2p-dht-and-peer-connectivity|libp2p, DHT, and Peer Connectivity]]
- [[open-decisions|Open Decisions]]
- [[design-problems|Design Problems]]
- [[frontend|CELLO Frontend Requirements]] — the web portal, mobile app, and desktop app requirements that the server infrastructure must support; the two documents together define the full client-server contract
- [[2026-04-16_1400_companion-device-architecture|Companion Device Architecture]] — designs the companion device P2P connection that the directory must facilitate; introduces a new connection type and new notification type; companion device allowlist is client-held (AC-C10)
- [[agent-client|CELLO Agent Client Requirements]] — the client-side counterpart to this document; the client and directory together implement the full protocol; shared conflicts (C-6 open; C-1, C-3, C-4, C-5, C-7 resolved) are cross-referenced throughout both documents
- [[2026-04-17_1100_not-me-session-termination|"Not Me" Session Termination — Dual-Path Forced Abort]] — resolves C-5; designs the dual-path mechanism (EMERGENCY_SESSION_ABORT + PEER_COMPROMISED_ABORT) that closes existing P2P sessions K_server revocation alone cannot reach
- [[2026-04-17_1400_directory-relay-architecture-reassessment|Directory/Relay Architecture Reassessment]] — resolves C-2; redraws the directory/relay boundary: directory is bookend authority (FROST at session open and seal), relay is session-level Merkle engine (hash relay, sequencing, tree building); supersedes hash relay and relay node sections in this document
