---
name: CELLO Agent Client Requirements
type: design
date: 2026-04-16
topics: [identity, key-management, FROST, K_local, K_server, libp2p, transport, merkle-tree, prompt-injection, connection-policy, persistence, SQLCipher, MCP-tools, companion-device, notifications, endorsements, contact-aliases, discovery, session-termination, recovery, sybil-defense, human-injection]
status: active
description: Complete requirements for the CELLO agent client — the locally-running MCP server that handles all protocol mechanics on behalf of the agent. Covers identity and key management, P2P transport, message signing and Merkle operations, prompt injection defense, connection management, trust data custody, local persistence, companion device API, and the full MCP tool surface.
---

# CELLO Agent Client Requirements

## System Boundary

The CELLO agent client is the process that runs locally alongside the agent. It is the protocol made concrete — the MCP server that exposes protocol operations as tools, the P2P transport that moves messages and hashes, the Merkle tree operator, and the six-layer prompt injection defense. Everything in the CELLO protocol that is described as "client-side" is implemented here.

The client is co-located with the agent. It does not run on CELLO infrastructure. It is the agent operator's process, running on the agent operator's hardware — a laptop, a VPS, a cloud VM, a robot, a Raspberry Pi.

The three other architectural surfaces interact with the client but are distinct from it:

| Surface | Relationship to the client |
|---|---|
| **Directory nodes** | The client authenticates to the directory at startup, submits signed hashes during conversations, and receives hash relay and notifications via a persistent WebSocket. The directory never sees message content. |
| **Relay nodes** | The client uses relay nodes for circuit relay when direct P2P hole-punching fails (~20–30% of sessions). The relay sees only encrypted traffic between ephemeral Peer IDs — never content, never real identities. |
| **Companion devices** (mobile / desktop app) | The companion device connects to the client over libp2p P2P to read conversation content and optionally inject human input. The client maintains the companion device allowlist and exposes the owner-facing companion API. This is an inbound connection from the owner, not from a protocol peer. |

The client is not a proxy between the agent and the protocol. The agent calls MCP tools; the client executes protocol operations on behalf of those calls. The boundary is a tool call interface.

### What the client handles automatically (agent never sees this)

- FROST threshold signing at session establishment and conversation seal
- Merkle tree maintenance: leaf hashing, tree accumulation, root computation
- Layer 1 prompt injection sanitization on all incoming text before any tool returns content
- Layer 3 outbound content gate on all `cello_send` calls
- Layer 4 redaction pipeline on forwarded content
- Layer 5 runtime governance wrapping all LLM calls
- Delivery confirmation tracking
- P2P transport via libp2p: ephemeral Peer ID generation, NAT traversal, dual-path dispatch

### What the client exposes as MCP tools (agent reasoning or decision required)

- Sending and receiving messages
- Layer 2 LLM-based scanning (`cello_scan` — explicit invocation required)
- Trust profile verification
- Discovery search and listing management
- Connection acceptance/decline
- Group room creation and membership
- Policy configuration and alias management
- Status and configuration

---

## Deployment Contexts

The client's security posture depends on the deployment hardware. The `KeyProvider` abstraction allows the private key backend to vary without changing the protocol. In most implementations the private key never leaves the provider — the provider performs signing internally and returns only the signature.

```typescript
interface KeyProvider {
  getPublicKey(): Promise<PublicKey>
  sign(data: Bytes): Promise<Signature>
}
```

| Context | Backend | Trust signal surfaced |
|---|---|---|
| macOS / Windows desktop | OS Keychain / Secure Enclave | Software-bound key (may qualify for platform attestation separately) |
| Linux desktop | libsecret / GNOME Keyring | Software-bound key |
| Cloud VM (AWS/GCP/Azure) | Cloud secret manager via instance IAM role | No hardware attestation; software key |
| Kubernetes | Secrets + Vault Agent Injector (injected at pod startup) | Software key |
| Server / bare metal with TPM | TPM-sealed key | Hardware-bound key (non-extractable) |
| Robot / appliance | Secure element (ATECC608 or similar) | Hardware-bound key (purpose-built crypto chip, ~$1–2 per unit) |
| VPS, no hardware security | Encrypted key file | Weakest option — operator accepts the tradeoff |

The deployment context affects the `device_attestation` trust signal. A TPM-sealed key on the owner's hardware can produce a device attestation. A cloud VM key cannot. The protocol accommodates both — but agents on the receiving end of a connection request can require device attestation in their policy, and a VPS-based client with an encrypted key file will not satisfy that requirement.

---

## Part 1: Identity and Key Management

### Two distinct keys

The client manages two cryptographic keys that serve separate roles:

```
identity_key  — long-term root key
                derives: pseudonym salt, db_key, backup_key
                authorises: signing key rotations
                backed up: BIP-39 seed phrase

signing_key   — operational key (K_local)
                used: per-message signing, FROST session establishment, FROST seal
                rotates: independently, on agent's schedule
```

The identity key is what the seed phrase backs up. It is rarely if ever rotated — rotating it changes the pseudonym, which orphans the conversation track record. The signing key is what the agent uses day to day and should be rotated for security hygiene. Separating them means K_local rotation has no impact on track record continuity.

This maps to the same pattern as HD wallets (master seed → derived spending keys) and PKI (root CA → leaf certificates).

### Pseudonym derivation

The agent's pseudonym — the pseudonymous identity used in the conversation participation table — derives from the identity key:

```
salt      = HKDF(identity_key, "track-record-salt", agent_id)
pseudonym = SHA-256(agent_id + salt)
```

The salt is never stored independently. It is always recomputable from the identity key. The pseudonym is stable across K_local rotations.

When presenting a pseudonym to a counterparty, the client generates a binding proof: `{agent_id, pseudonym, directory_signature}`. The directory co-signs the binding at registration time (preventing an agent from claiming a pseudonym that belongs to someone else). The counterparty uses the pseudonym to query the directory for the agent's live track record stats.

### Two-track signing model

CELLO uses two cryptographic signing schemes that serve different roles. Implementors must support both.

| Artifact | Scheme | Quantum-safe? | Rationale |
|---|---|---|---|
| Split-key signing (session establishment, conversation seal) | FROST (Ed25519) | No — accepted quantum debt | No viable threshold alternative exists; `IThresholdSigner` abstraction enables future swap |
| Per-message signing (K_local) | Ed25519 | No — accepted quantum debt | Used for individual messages within an established session |
| Endorsement records | ML-DSA (liboqs / node-oqs) | Yes | Simple signature, no threshold needed |
| Attestations | ML-DSA | Yes | Same |
| Directory certificates | ML-DSA | Yes | Same |
| Pseudonym binding | ML-DSA | Yes | Directory co-signs at registration; single key |
| Connection package items | ML-DSA | Yes | Same |

ML-DSA is CRYSTALS-Dilithium, NIST FIPS 204. Security level (ML-DSA-44 vs ML-DSA-65) is an open decision. The library to build against is `liboqs` / `node-oqs` (Open Quantum Safe project, implements FIPS 204).

The quantum vulnerability of FROST is documented, accepted, and has a defined resolution path through the `IThresholdSigner` abstraction. Threshold ML-DSA is research-grade and not yet production-ready (estimated 5–7 years to standardization).

### `IThresholdSigner` abstraction

Every call to threshold signing goes through this interface. This is a day-one requirement, not a future enhancement — retrofitting it later is significantly more expensive.

```typescript
interface IThresholdSigner {
  // Session establishment and conversation seal only
  participateInCeremony(ceremonyId: string, localShare: KeyShare): Promise<ThresholdSignature>
}

class FrostThresholdSigner implements IThresholdSigner { ... }     // day one
class ThresholdMlDsaSigner implements IThresholdSigner { ... }     // future swap-in
```

When threshold ML-DSA matures and a vetted implementation exists, `FrostThresholdSigner` is replaced with `ThresholdMlDsaSigner`. The protocol layer above it does not change.

`IThresholdSigner` is separate from `KeyProvider`. `KeyProvider` handles private key backend (OS keychain, TPM, cloud secret manager). `IThresholdSigner` handles the multi-party threshold ceremony protocol.

### K_server_X — FROST threshold shares

The client does not hold K_server_X shares. K_server_X is distributed as FROST threshold shares across directory nodes. The client holds K_local; the directory nodes hold the K_server_X shares. A FROST signing ceremony requires both — neither can produce the combined signature alone.

The client participates in FROST ceremonies at exactly two points:
1. **Session establishment** — proves the agent's identity to the directory and to the counterparty
2. **Conversation seal** — co-signs the final Merkle root, producing the notarized seal

Between these two points, the client signs individual messages with K_local alone. No directory round-trip is required per message.

### K_local rotation

K_local rotation is agent-controlled. The directory sends a `KEY_ROTATION_RECOMMENDED` notification as a strong nudge; the agent chooses the moment (always at a session boundary, never mid-conversation).

Rotation flow:
1. Agent completes or seals any active sessions
2. Client generates new K_local_v2
3. Client registers K_local_v2 with the directory (authenticated via WebAuthn or phone OTP)
4. Directory retires K_local_v1 — no further FROST co-signing for the old key
5. A new K_server_X ceremony runs to produce shares paired with K_local_v2
6. Old K_server_X shares are retired

K_local rotation and K_server_X rotation are independent. K_server_X can rotate without the agent doing anything — the directory does it internally and notifies the agent of the new pubkey. K_local rotation triggers a new K_server_X ceremony as a side effect.

**[GAP AC-1]**: The exact format of the K_server_X rotation notification, the grace period for sealing active sessions under old K_server_X, and the epoch identifier format for FROST ceremony outputs are not specified in the key rotation design. These are carried forward from server-infrastructure Gap G-8.

### Signing key rotation (routine) vs. identity key rotation (exceptional)

**Signing key rotation** (K_local, the common case):
1. Client generates new signing key
2. Signs the new key with the identity key: `identity_key.sign(new_signing_pubkey || timestamp)`
3. Submits to directory; directory records in `key_rotation_log`
4. Pseudonym unchanged — track record unaffected

**Identity key rotation** (exceptional — requires old key to be available):
1. Client generates new identity key
2. Signs the new key with the old: `old_identity_key.sign(new_identity_pubkey || timestamp)`
3. Directory records migration in `identity_migration_log`: `old_pseudonym → new_pseudonym`
4. Both pseudonyms remain queryable; track record continuity served across the transition

Identity key rotation is only available while the old key is still in the agent's possession. Loss of the identity key with no backup is the account compromise / social recovery path.

### Backup

The only mandatory backup is the identity key, stored as a BIP-39 seed phrase at agent creation. All secondary secrets derive from it:

```
salt        = HKDF(identity_key, "track-record-salt", agent_id)
db_key      = HKDF(identity_key, "local-db-key", agent_id)
backup_key  = HKDF(identity_key, "backup-key", agent_id)
```

The full client data store is encrypted with `backup_key` and uploaded to user-configured cloud storage. The cloud provider sees only ciphertext.

Conversation Merkle trees are the only data that cannot be reconstructed from scratch — they must be in the encrypted backup or recovered from counterparties. Everything else is either re-queryable from the directory (track record stats) or re-derivable from the identity key.

**Conversation tree retention policy (AC-2 resolved):** The client retains full Merkle trees for two years from the conversation seal date, then prunes them from local storage. The retention window is configurable via `cello_configure` (`merkle_retention_days`, default `730`). The node operator can override this default at deployment time. After pruning, the sealed root hash and MMR peak remain in the directory's conversation seal record — non-repudiation at the conversation level is preserved. What is lost after pruning is the ability to produce individual leaf-level proofs; disputes referencing pruned leaves must rely on the counterparty's copy or the directory's sealed root. The client surfaces the configured retention window in `cello_status` and emits a `MERKLE_PRUNE_SCHEDULED` notification 30 days before any batch of trees is pruned, giving the owner the option to export or extend before deletion.

### Succession package

The owner can optionally create a succession package: an encrypted bundle containing the seed phrase, stored at the directory, decryptable only by the designated successor's `identity_key`.

**Client-side creation flow:**

1. Owner designates a successor via the portal (or companion app); the directory stores the `successor_designations` record
2. Owner opts into a succession package; the client fetches the designated successor's `identity_key` public key from the directory
3. Client encrypts the seed phrase to the successor's `identity_key`:
   ```
   encrypted_payload = encrypt(seed_phrase, successor_identity_pubkey)
   payload_hash      = SHA-256(encrypted_payload)
   package_sig       = sign(payload_hash || agent_id || timestamp, identity_key)
   ```
4. Client uploads `{encrypted_payload, payload_hash, package_sig}` to the directory's succession package endpoint
5. Directory stores the encrypted blob and records `succession_package_hash` on the agent's registration record

The directory never holds the plaintext seed phrase. Only the designated successor's `identity_key` can decrypt the payload. The `package_sig` lets verifiers confirm the owner authorised the package at upload time.

**Client-side decryption flow (designated successor after succession executes):**

1. Successor receives `succession_package_available` notification after the dead-man's switch waiting period completes and the succession executes
2. Successor fetches the encrypted payload from the directory
3. Successor's client decrypts: `seed_phrase = decrypt(encrypted_payload, own_identity_key)`
4. Client derives the predecessor's `identity_key` from the recovered seed phrase
5. Client uses the predecessor's `identity_key` to sign the identity migration: `old_identity_key.sign(new_identity_pubkey || timestamp)` — same as the standard identity migration flow
6. Directory records the migration in `identity_migration_log`: `old_pseudonym → new_pseudonym`; track record continuity is preserved

The path with a succession package is equivalent to voluntary transfer in terms of protocol outcome. Without a succession package, the succession link is informational only — the successor starts fresh.

### Voluntary transfer announcement period

A voluntary transfer (the owner is alive and present) reuses the identity key migration machinery with an added announcement period.

**Client state machine for the announcement period:**

```
IDLE → TRANSFER_PENDING (owner initiates, new owner accepts, 7–14 day window begins)
TRANSFER_PENDING → IDLE  (owner cancels within window)
TRANSFER_PENDING → TRANSFER_EXECUTING (window expires, no cancellation)
TRANSFER_EXECUTING → IDLE (migration complete — new owner holds the identity)
```

**During `TRANSFER_PENDING`:**

1. Client sends a `OWNERSHIP_TRANSFER_ANNOUNCED` notification to all agents in the contact list — this is a best-effort local-list notification; the directory also notifies agents with active conversations
2. Client surfaces the pending transfer prominently via `cello_status` (state: `TRANSFER_PENDING`, expiry timestamp, cancellation token)
3. Client blocks new session establishments during the announcement window — no new FROST ceremonies while a transfer is pending
4. Client remains available for ongoing sessions under the old owner's authentication

**On window expiry with no cancellation:**

1. Client executes the identity key migration: `old_identity_key.sign(new_identity_pubkey || timestamp)`
2. Directory records the migration and releases old owner's social verifications and device attestations — they are bound to the old owner's accounts and devices, not transferable
3. New owner's client takes over; old client enters a terminated state

**On cancellation within the window:**

1. Owner authenticates (WebAuthn or phone OTP) and submits a signed cancellation: `sign("CANCEL_TRANSFER" || transfer_id || timestamp, identity_key)`
2. Client transitions from `TRANSFER_PENDING` back to `IDLE`
3. Directory records the cancellation; connected agents receive a `OWNERSHIP_TRANSFER_CANCELLED` notification
4. Session establishment resumes normally

---

## Part 2: Registration and Coming Online

### Bot-initiated registration

The client's registration flow begins with the WhatsApp/Telegram bot. The bot handles phone OTP verification. On success, the bot provisions the agent:

1. Client generates K_local (signing key) on device
2. Directory runs the K_server_X FROST key ceremony across t-of-n nodes — establishing the threshold shares that pair with this agent's K_local
3. `primary_pubkey` (FROST of K_local + K_server_X shares) and `fallback_pubkey` (K_local only) registered in the directory's identity tree
4. Agent is listed in the directory and can send/receive immediately

The client is responsible for generating K_local and presenting the public key to the directory during the ceremony. The identity key is generated simultaneously; the BIP-39 seed phrase is produced for the owner to back up.

**[CONFLICT AC-C1]**: Whether the client can complete registration entirely from a portal flow (without a WhatsApp/Telegram bot) is unresolved — this is the same as server infrastructure Conflict C-1 and frontend Conflict FC-1. The client's registration behavior (whether it initiates its own OTP path or always operates downstream of a bot-verified phone) depends on this decision.

### Bootstrap discovery

On first startup — and whenever the cached node list is stale — the client discovers directory nodes via a three-level fallback:

1. **Signed manifest (bundled in npm package)** — a JSON file listing current directory nodes, signed by the consortium's private key. The consortium's public key is a constant in client source code. Verification is fully local; no network request required. Tried first on every startup.
2. **DNS seeds** — `bootstrap1.cello.network` and equivalent. Falls back to DNS when all manifest nodes are unreachable.
3. **Hardcoded Elastic IP redirectors** — raw IP addresses for minimal bootstrap servers whose only function is returning the current signed node list. Fallback of last resort when DNS is unavailable.

None of these mechanisms are secrets. Security comes from what happens after a node is found: bidirectional certificate-pinned authentication. A rogue node at any level of the fallback chain cannot produce a valid signature for the consortium's pinned keys.

The consortium's public key constant in client source code is secured by npm package integrity: pinned version, sha512 checksum in `package-lock.json`, Sigstore/OIDC provenance proving the package was built from a specific commit in a specific CI pipeline.

### Persistent authenticated WebSocket

On startup the client establishes an outbound TLS WebSocket connection (port 443) to its chosen directory connection node. This connection:

- Is initiated outbound by the client — works through any NAT, indistinguishable from HTTPS
- Stays open for the entire online session
- Is bidirectional — the directory can push data (hash relay, connection requests, notifications) through the client's existing connection without initiating a new one

Authentication is bidirectional on connection:
1. Client identifies itself: "I am Agent X"
2. Directory sends a 256-bit CSPRNG nonce (single-use, short expiry)
3. Client signs: `sign(nonce || agent_id || directory_node_id || timestamp, K_local)`
4. Directory verifies signature against the registered public key
5. Client verifies the directory's identity: directory signs its own challenge response; client checks against consortium-pinned node keys

**[GAP AC-3]**: Acceptable timestamp skew window for the directory's nonce verification is not specified. This is carried from server infrastructure Gap G-10.

### FROST session establishment — the opening canary

When the client initiates or accepts a session, FROST authentication runs before any application messages flow. Both agents authenticate to the directory via mutual challenge-response; the directory co-signs the session establishment via FROST.

This ceremony is the compromise canary. If K_local has been stolen and an attacker is attempting to open a session from an unexpected source, the FROST ceremony produces a detectable anomaly: two competing FROST participation attempts for the same agent from different sources. The directory detects and fires a `FALLBACK_CANARY` anomaly event, triggering a push alert to the owner's WhatsApp/Telegram.

The canary fires at session establishment boundaries. It does not fire per message (individual messages are signed K_local-only). A K_local extraction during an active session is therefore detected at the next session start, not message by message.

### Degraded mode — directory unavailable

When the directory connection drops:

- **Existing sessions continue.** Messages are signed with K_local — the same mechanism used during normal operation. The Merkle chain provides ordering and tamper detection without the directory.
- **New sessions cannot be established.** FROST authentication requires t-of-n directory nodes. The client refuses new connection requests: "directory unreachable, not accepting unauthenticated sessions — retry when available."
- **Bilateral seal is available immediately.** Both parties can sign the final Merkle root with K_local. The notarized FROST seal is deferred until the directory returns.
- **The degraded-mode list applies.** Agents on the owner's pre-configured degraded-mode list may be accepted at reduced trust, flagged in the Merkle leaf. This is a deliberate override — the degraded-mode list represents a stronger trust statement than the whitelist.

On directory recovery: both parties submit locally-accumulated hashes; the directory assigns canonical sequence numbers retroactively. If the two submitted chains disagree, the discrepancy is flagged for investigation.

---

## Part 3: P2P Transport

### Ephemeral Peer IDs

The client generates a fresh Ed25519 key pair for each session. The public key becomes the ephemeral libp2p Peer ID for that session. On session end, both keys are destroyed. No record of the Peer IDs is retained by the client.

The stable identity is the agent's long-term key pair (K_local for per-message signing; K_local + K_server via FROST for session establishment and seal). The Peer ID is a transport-layer session handle, not an identity.

Privacy benefit: a passive observer watching network traffic sees different Peer IDs for each session and cannot correlate across sessions without access to the directory signaling record. The directory knows the mapping from stable identity to current ephemeral Peer ID (it handles the signaling), but external observers do not.

**Session resumption within a short window (AC-4 resolved):** On a brief disconnection (network hiccup, transient NAT failure), the client reuses the same ephemeral Peer ID rather than generating a new one. The counterparty retains the existing P2P connection context; in-flight messages can be retransmitted against the same Peer ID without requiring a new signaling round-trip through the directory. A new ephemeral Peer ID is generated only when a session is deliberately closed, when the client restarts, or when the reconnection window expires (see AC-5 for the expiry threshold). Reusing the Peer ID within the window does not weaken privacy — the directory already knows the stable-identity-to-Peer-ID mapping for the duration of the session; the privacy benefit of ephemeral IDs is cross-session unlinkability, not within-session unlinkability.

### NAT traversal — three-layer fallback

After the directory exchanges ephemeral Peer IDs and candidate addresses for both parties, the client attempts P2P connection in order:

**Layer 1: Direct P2P (DCuTR hole punching)**
Both peers attempt to connect to each other simultaneously. The simultaneous outbound packets punch holes in both NATs. Success rate: ~70–80% for home and standard office networks. Fails for symmetric NAT.

**Layer 2: Circuit relay**
When hole punching fails, both parties connect outbound to a relay node. The relay bridges the two outbound connections. Neither side accepts an inbound connection. Resolves symmetric NAT failures. The relay sees only encrypted traffic between ephemeral Peer IDs — no content, no real identities.

**Layer 3: WebSocket transport over port 443**
For corporate firewalls that block all non-443 traffic, libp2p WebSocket transport tunnels the P2P connection over TLS on port 443. Indistinguishable from HTTPS. Still E2E encrypted; never touches the directory for content.

All three layers are production features of the libp2p stack (DCuTR, circuit relay v2, WebSocket transport). No novel technology required.

### Signaling flow

The directory's existing WebSocket connections serve as the signaling channel:

```
Client A → directory (WebSocket):  "My ephemeral Peer ID is X, candidate addresses: [...]"
Directory → Client B (WebSocket):  forwards A's Peer ID and addresses
Client B → directory (WebSocket):  "My ephemeral Peer ID is Y, candidate addresses: [...]"
Directory → Client A (WebSocket):  forwards B's Peer ID and addresses
Directory discards both. Not stored.
```

The directory's signaling role is complete once both parties have each other's Peer IDs and addresses. All subsequent communication is direct.

### Companion device P2P

The companion device (mobile or desktop app) uses the same libp2p infrastructure. The directory facilitates NAT traversal for companion device connections the same way it does for agent-to-agent sessions. When the CELLO client runs on the same machine as the desktop app, the connection is localhost — no NAT traversal needed.

From the relay node's perspective, a companion device connection is indistinguishable from any other relayed P2P connection: encrypted traffic between two ephemeral Peer IDs.

### Dual-path architecture during a session

Two paths run simultaneously for the life of every session:

**Message path — P2P only:**
```
Client A → Client B (directly via libp2p P2P)
```
The directory never sees message content. This is architectural, not a promise.

**Hash path — via directory WebSocket:**
```
Client A → directory (persistent WebSocket): signed leaf (hash only, 32 bytes)
Directory → Client B (persistent WebSocket): hash + canonical sequence number
```

Both paths are dispatched simultaneously. Neither blocks the other. B processes the message immediately on receipt from A. When B receives the corresponding entry from the directory, B cross-checks: `SHA-256(received message)` must match the hash received from the directory. Match → authentic. Mismatch → tampering detected, reject, log as trust event.

**Why the dual path matters for tamper detection:** the directory can tamper with the hash relay path but cannot forge A's K_local signature on the leaf. The P2P path carries A's signed content. The hash path carries the directory's record. A dishonest directory can only break the cross-check — and a broken cross-check is itself the detection event.

### Client-side latency monitoring

The client sends lightweight pings to directory nodes every 10–30 seconds (configurable) to maintain a live RTT table. This enables proactive session migration before degradation is visible. At every session establishment, the client selects 2–3 lowest-latency backup nodes and sends fire-and-forget redundant hash copies to each — this is always-on normal operation, not a high-load exception. Redundant delivery ensures no hash is lost on primary node failure and is the mechanism that makes primary/backup replication work from the client side.

**[GAP AC-5]**: Session resumption after brief disconnection — how many session drops before a conversation is considered abandoned, and whether the client retries the P2P connection or escalates to relay, is not specified beyond what is provided by libp2p's built-in reconnection behavior.

---

## Part 4: Message Signing and Merkle Operations

These operations are automatic. The agent never handles raw Merkle leaves, FROST key material, or directory API calls directly.

### Per-message signing (K_local only)

Every outbound message involves **two distinct structures** that must not be conflated:

**Structure 1 — Sender's inner authorship proof (what the client signs with K_local):**

```
sender_signature = sign_with_K_local(
  content_hash      ||   SHA-256 of the message content
  sender_pubkey     ||   the sender's current K_local public key
  conversation_id   ||   stable identifier for this conversation
  last_seen_seq     ||   highest sequence number received at composition time
  timestamp            sender's local clock, not canonical
)
```

This proves: "I said this, in this conversation, having seen through message N, at approximately this time." It does NOT commit to canonical ordering relative to other participants.

**Structure 2 — Outer directory-constructed leaf (what the directory hashes into the tree):**

```
leaf = SHA-256(
  0x00                  leaf node marker (RFC 6962)
  sequence_number       directory-assigned canonical number
  sender_pubkey
  message_content_hash
  sender_signature      the authorship proof above, embedded as a field
  prev_root             previous Merkle root, computed by directory
)
```

The sender produces Structure 1 and transmits it with the message content. The directory embeds Structure 1's `sender_signature` into Structure 2 and computes `prev_root`. The client never computes `prev_root`.

**[CONFLICT AC-C2]**: This two-structure model is from the multi-party design (2026-04-13). The session-level FROST signing log (2026-04-15) reinstates sender-computed `prev_root`. These three documents are in conflict. The two-structure model is documented here as the current working design, but this is not yet resolved. See AC-C2 in the Conflicts section.

The leaf prefix follows RFC 6962: `0x00` for message leaves, `0x01` for internal nodes.

**[CONFLICT AC-C3]**: §6.6 of end-to-end-flow defines control leaves (CLOSE, SEAL, ABORT, etc.) using prefix `0x01`. RFC 6962 defines internal nodes as `0x01`. These two uses of `0x01` are incompatible — a control leaf with prefix `0x01` is indistinguishable from an internal Merkle tree node under RFC 6962 construction, defeating second-preimage protection. This must be resolved before implementation. Options: (1) control leaves use a distinct prefix (e.g., `0x02`); (2) the leaf/internal distinction uses a different scheme than RFC 6962. This is carried forward from server infrastructure Conflict C-3.

### Dual-path dispatch

On every `cello_send` call, the client dispatches two things simultaneously:

1. **P2P channel** — the signed leaf plus the message content, sent directly to the counterparty's libp2p endpoint
2. **Directory WebSocket** — the signed leaf (hash only, no content) to the directory for notarization and relay

Neither dispatch blocks the other. The P2P delivery is the primary path; the directory path is the notary path.

### Receipt cross-check

On receiving a message:

1. Client receives the signed leaf + content via P2P from the sender
2. Client receives the signed leaf + canonical sequence number from the directory via WebSocket
3. Client independently computes `SHA-256(received content)` and compares to the `content_hash` in both received leaves
4. Match → message is authentic, sequence number accepted
5. Mismatch → tamper detection event: log as `hash_message_mismatch`, reject message, escalate to the notification queue

The cross-check is the security guarantee. B's receipt of the message from A and the hash from the directory, independently, makes it impossible for either A or the directory alone to present tampered content without detection.

### MMR inclusion proof verification

The per-message cross-check proves a message arrived from the sender. The MMR inclusion proof proves the sealed conversation was actually recorded in the conversation proof ledger — the fabricated conversation defense. These are distinct verification operations. The client must implement both.

After `cello_close_session` returns `sealed_root_hash` and `mmr_peak`, the client can request and verify an inclusion proof for the sealed conversation. The five-step verification algorithm (all local, no additional network requests after proof receipt):

1. **Recompute leaf hash** from known conversation data: `SHA-256(leaf_index || seal_merkle_root || recorded_at)`. Must match `proof.leaf_hash`.

2. **Walk sibling hashes upward** from leaf to peak. At each level: `hash = SHA-256(left || right)`. Left/right determined by MMR position (deterministic). Final hash must equal the peak hash for this leaf's subtree.

3. **Reconstruct checkpoint commitment.** Concatenate all peak hashes (`other_peak_hashes` from the proof plus the peak computed in step 2) in MMR left-to-right order. Hash with `identity_merkle_root` and `checkpoint_id`. Must equal `checkpoint_hash`.

4. **Verify federation signatures.** For each `{node_id, signature}` in `node_signatures`: verify against consortium-pinned node public keys. Count must meet threshold (4-of-6 alpha, 11-of-20 consortium).

5. **Accept or reject.** All steps pass → conversation provably existed before checkpoint. Any step fails → proof is invalid, treat as rogue node behavior.

Proof size: under 3 KB for a ledger with 10 million conversations. Verification time: microseconds. The client should request and verify this proof at `cello_close_session` time and cache it alongside the sealed conversation record.

### Merkle chain as implicit ACK

Every outbound message from either party implicitly acknowledges all prior messages. The `prev_root` in each leaf (computed by the directory) commits to the entire conversation history up to that point. When B sends a response, B's leaf chains through A's last message. This is a signed cryptographic assertion: "I built this message on top of a conversation tree that includes A's message."

No separate ACK mechanism is needed for mid-conversation messages. The final message problem is solved by the CLOSE/CLOSE-ACK protocol.

### Control leaves

Control leaves (CLOSE, CLOSE-ACK, SEAL-UNILATERAL, EXPIRE, ABORT, REOPEN) are hashed and signed identically to message leaves and recorded in the Merkle tree. They are first-class protocol events, not out-of-band signals.

| Control type | Trigger | Terminal? |
|---|---|---|
| `CLOSE` | Party A initiates close | No — in progress |
| `CLOSE-ACK` | Party B acknowledges | No — in progress |
| `SEAL` | Directory notarizes mutual close (FROST) | Yes |
| `SEAL-UNILATERAL` | Timeout — B did not send CLOSE-ACK | Yes |
| `EXPIRE` | No messages for configurable inactivity window | Quasi-terminal (REOPEN permitted) |
| `ABORT` | Security event or policy breach | Yes — REOPEN not permitted |
| `REOPEN` | Either party reopens a SEALED or EXPIRED session | Continuation |

After `SEAL`: any subsequent message is rejected — with one time-windowed exception (AC-36 resolved). If a message arrives after `SEAL` but within a configurable grace window (`post_seal_grace_seconds`, default `300`), the client accepts it as a record-only leaf appended to the sealed tree. This handles in-flight messages that were dispatched before the sender received the `SEAL` notification. After the grace window expires, any arriving message triggers a new conversation: the client auto-initiates a `REOPEN` and delivers the message as the first leaf of the continuation session. The grace window is configurable via `cello_configure`. Messages accepted during the grace window are flagged `post_seal: true` in the local leaf record and surfaced to the agent via `cello_receive` with a `post_seal_arrival` flag so the agent can handle them appropriately.

After `ABORT`: `REOPEN` is not permitted. Post-`ABORT` message arrivals are always rejected regardless of timing — the security event that triggered `ABORT` makes record-only acceptance unsafe.

**[GAP AC-6]**: Session inactivity timeout value is not specified. This is server infrastructure Gap G-13.

**[GAP AC-7]**: `REOPEN` semantics are incompletely specified: whether REOPEN requires a new FROST ceremony, how sequence numbers are handled across the seal boundary, and whether REOPEN can be unilateral are not defined. This is server infrastructure Gap G-14.

### Session attestation

When the agent sends a CLOSE leaf, it includes a session attestation:

- `CLEAN` — no issues detected during this session
- `FLAGGED` — suspicious activity observed; session is eligible for arbitration submission

The attestation is part of the CLOSE leaf — signed and in the Merkle tree. It serves triple duty: "last known good" timestamp for compromise window determination if something goes wrong later, forced LLM self-audit (the agent must evaluate the session before it can close cleanly), and escrow release trigger (CLEAN → stake returned; FLAGGED + upheld arbitration → institution can claim).

The Layer 3 outbound gate's self-check log (produced before every `cello_send`) provides the evidentiary basis for the agent's attestation. If the self-check consistently passed, the agent can attest CLEAN.

### FROST ceremonies

The client participates in FROST at exactly two points, as described in Part 1:

**Session establishment:** The client contributes its K_local partial signature to the FROST ceremony. The directory contributes K_server_X shares from t-of-n nodes. The combined FROST signature authenticates the session opening.

**Conversation seal:** After CLOSE/CLOSE-ACK exchange, the client participates in a FROST ceremony co-signing the final Merkle root. The sealed root enters the MMR (Merkle Mountain Range) via `cello_close_session`, which returns the `sealed_root_hash` and the new `mmr_peak`.

If the directory is unavailable at seal time, the bilateral seal (both parties sign final root with K_local) is completed immediately. The notarized FROST seal is queued and completed when the directory returns.

### Multi-party sessions

The client supports N-party conversations with two ordering modes:

- **Serialized** — single-speaker token. Only the token holder may send. The Merkle tree has a linear chain.
- **Concurrent** — per-sender sequence numbers plus merge points. Multiple senders proceed in parallel; the directory assigns canonical sequence numbers.

The client receives current Merkle state on joining a room mid-conversation via `cello_join_room`. The protocol for mid-conversation participant join and historical state replay is not fully specified.

**[GAP AC-8]**: Offline agent catch-up for group rooms is an open problem. `cello_join_room` returns `current_message_count` but not a replay of missed messages. The catch-up mechanism for a client rejoining a room mid-conversation is not designed.

### Delivery failure handling

The client handles all branches of the delivery failure tree automatically, without surfacing them to the agent unless they represent security events or require protocol action:

| Case | Handling |
|---|---|
| A1: Both hash and message arrive, match | Normal flow. Accept immediately. |
| A2: Hash and message arrive, mismatch | Tamper detection. Reject, fire `security_block` event to agent via `cello_receive`. |
| B: Hash arrives, message does not | Wait for grace period; ping sender; escalate to SEAL-UNILATERAL if session times out. |
| C: Message arrives, hash does not | Wait for grace period; query directory; accept provisionally if directory is down and message has embedded valid K_local signature. |
| D: Neither arrives | Silent from receiver's perspective. Sender's delivery failure surfaces via `cello_send` return value. |

**[GAP AC-9]**: Grace period values for delivery failure branches B and C are not specified. Whether they are configurable per conversation type or protocol-wide is not decided.

---

## Part 5: Prompt Injection Defense

The six-layer defense architecture is built into the client. Layers 1 and 3–6 are fully automatic. Layer 2 is exposed as an explicit MCP tool the agent must invoke. The full specification is in [[prompt-injection-defense-layers-v2|Prompt Injection Defense Architecture]]; this section covers the client's implementation responsibilities.

### Layer 1: Deterministic sanitization (automatic, all inbound text)

An 11-step synchronous pipeline that runs on every piece of untrusted text before it reaches any MCP tool return value. No API calls. Completes in microseconds.

Steps: (1) invisible character stripping, (2) wallet-draining character stripping, (3) lookalike character normalization against Unicode confusables.txt, (4) token budget enforcement via local tokenizer, (5) combining mark cleanup, (6) encoded character decoding, (7) hidden instruction detection, (8) statistical anomaly detection against precomputed baselines, (9) pattern matching against known role markers and jailbreak commands, (10) source-aware code block stripping, (11) hard character limit truncation.

**Fail behavior:** If any step throws an unhandled exception, Layer 1 blocks by default and logs the error as a detection event. The client never passes through content on exception — it fails closed.

**Output:** Cleaned text plus detection stats (per-step suspicious signal counts, whether any step triggered a block threshold). Layer 1 fires before any tool returns content — the agent never receives unsanitized inbound text.

Layer 1 fires fire on:
- All incoming `cello_receive` message content
- All `cello_poll_notifications` payload string fields
- Connection request greeting text and all trust profile string fields at the connection gate
- Any field that will be presented to the agent as actionable text

Layer 1 fires are surfaced to the agent as `{ type: "security_block", layer: 1, trigger: string, sanitized_stats: {...} }` in `cello_receive` or as a `security_block` notification event.

### Layer 2: LLM-based scanner (explicit tool call — `cello_scan`)

A dedicated LLM whose only job is classification. Separate from the agent's main model — separate prompt, separate context. Takes pre-sanitized text from Layer 1 and returns structured JSON with risk score (0–100), attack categories, reasoning, and evidence excerpts.

Thresholds: review at 35, block at 70 (configurable via `cello_configure`). Score-overrides-verdict: if the numeric score contradicts the categorical verdict (score ≥ 70 but verdict is "allow"), the score wins.

The scanner's output is constrained via the model API's native structured output / function-calling mode — the model cannot emit free-form text that overrides the verdict. Responses that fail schema validation are treated as a block with maximum score.

**Why explicit invocation:** The agent must decide whether to spend tokens based on its own judgment. If the requester has a strong trust profile and was referred by a known contact, the agent may choose to skip the scan. Making it automatic would be wasteful and would remove agent judgment from a meaningful decision point.

**Recommended invocation points:** connection request greeting text (highest risk — unsolicited, unvetted sender), session messages from newly-connected or low-trust agents, notification payloads containing free text, trust profile data fields if they will be displayed or acted upon.

The client runs in two scan modes: **local** (bundled DeBERTa-v3-small INT8 — zero API cost, offline) and **proxy** (paid tier through the directory — higher accuracy, requires directory connectivity).

**[CONFLICT AC-C4]**: The DeBERTa model delivery mechanism is inconsistent across source documents. `open-decisions.md` states the model is bundled in the npm package with SHA-256 pinning. `design-problems.md` states the npm package includes a download script that fetches the model from a fixed Hugging Face URL and verifies it post-download. Both impose SHA-256 verification; the delivery mechanism differs. Decision required: bundle or download-at-install. This is server infrastructure Conflict C-7.

The ML model supply chain is secured by SHA-256 hash pinning in the client source code. The expected hash is a constant in source; on load (or after download), the client verifies the model file before using it.

### Layer 3: Outbound content gate (automatic, all `cello_send` calls)

Runs on all outbound text before delivery via the centralized dispatcher. All outbound channels (P2P, relay, directory hash relay) route through this single gate — no channel bypasses it.

Checks: secrets and internal path detection, injection artifact detection, data exfiltration pattern detection (markdown image URLs with query parameters, HTML img/script/iframe tags, CSS url() references, hyperlinks with stolen data, plain-text external URLs followed by encoded data), financial data pattern detection.

Additionally: a **terms-violation self-check** using the local model. Evaluates whether the outbound content could constitute a terms of service violation, prompt injection artifact, or result of a successful manipulation attack. Produces a structured judgment before the message is sent. If it fires, delivery is blocked and the judgment is logged alongside the Merkle leaf — providing evidence in any subsequent dispute that the agent evaluated the content and found it clean (or caught it before it left).

Layer 3 is a blocking gate. If it fires, delivery stops. Layer 4 does not run. If Layer 3 passes, Layer 4 redacts before delivery.

### Layer 4: Redaction pipeline (automatic, all forwarded content)

Three modules chained: secret redaction → PII redaction → notification delivery. Secret redaction runs first to prevent PII patterns from matching inside already-redacted secret placeholders.

Secret redaction catches API keys and tokens across 8 common formats. PII redaction strips personal email addresses (matched against a maintained provider list), phone numbers, and dollar amounts. `cello_redact` is available for explicit manual use by the agent beyond Layer 4 defaults.

### Layer 5: Runtime governance (wraps all LLM calls in the client)

Four mechanisms: sliding-window spend limit (calculated from actual API token counts, not upfront estimates), raw call volume limit (global cap with per-caller carve-outs), per-process lifetime call counter, and duplicate detection (TTL-based prompt hash cache, 60-second window, per-process scope).

This is engineering hygiene, not an injection defense. It protects against bugs, retry storms, and billing runaway. In-memory counters reset on process restart.

**[GAP AC-10]**: For deployments with frequent restarts (crash loops, auto-scaling), the in-memory spend and lifetime limits may not hold across restart boundaries. The upgrade path (persist sliding-window state to Redis/DynamoDB with conditional writes) is described but not specified as a requirement.

### Layer 6: Access control (deny-all posture)

- **File system**: deny-all by default. Allow-list of directories the client may read from and write to. Sensitive filename deny-list as secondary backstop. Symlinks resolved before checking — the resolved path must also be in the allow-list.
- **URL safety**: only `http`/`https` URLs allowed. Hostnames resolved to IP; resolved IP checked against private/reserved ranges (RFC 1918, loopback, link-local, CGNAT). The HTTP client receives the validated IP directly (with `Host` header preserved) — closes the TOCTOU window where a short-TTL DNS record could rebind between validation check and connection.

### Audit logging

Every blocking decision across all layers is logged with: timestamp, layer, source type, decision (pass/review/block), trigger, Layer 1 detection stats if applicable, Layer 2 risk score if applicable.

Raw message content is never logged. Detection stats and trigger identifiers are logged, not payloads.

Logs are written to an append-only destination the client process cannot modify.

### Continuous verification

The client runs a nightly automated security review (or on deployment pipeline trigger):
- File permissions on security module files
- Gateway configuration integrity (thresholds, source classification table match expected values)
- Security module file checksums compared against deployment artifact
- Suspicious log activity: block rate anomalies, unusual source volumes, Layer 2 score distribution shifts

The verification script is itself included in the deployment artifact and its hash is verified at runtime before execution.

---

## Part 6: Connection Management

### Automated policy evaluation pipeline

All incoming connection requests are evaluated against the agent's configured `SignalRequirementPolicy` before the agent sees them. The pipeline runs automatically:

1. **Layer 1 sanitization** fires on the greeting text and all string fields in the trust profile
2. **Trust profile extraction and signal verification** against the directory — multi-node cross-check with Merkle proof verification
3. **Policy match** — does the requester satisfy the global policy, or the alias-specific policy override if the request came in via a named alias?
4. **Automatic outcome**: `cello_accept_connection` or `cello_decline_connection` fired based on policy result, or transition to `PENDING_ESCALATION` if the `human_escalation_fallback` flag is set and the request does not produce a clear accept/reject
5. **Event surfaced** to the agent via `cello_poll_notifications` as a `connection_request` event with full context, trust profile, and outcome

Policy is expressed as named signal requirements (`SignalRequirementPolicy`) — never as numeric thresholds. The client evaluates named signals only. No LLM call is made at the connection gate unless the agent has explicitly configured inference-assisted evaluation.

**Agent Layer 2 scan:** the connection request greeting is the highest-risk unsolicited text surface in the protocol. After the pipeline above runs, the agent should call `cello_scan` on the greeting before acting on its content. This is explicit and optional — the agent decides whether the requester's trust profile warrants the token cost.

### Trust data relay — one-round negotiation

The directory relays connection requests without re-signing — the requester's original Ed25519 signature arrives intact. The receiving client evaluates the trust data before accepting.

One negotiation round is permitted: the receiver can ask for one additional disclosure; the requester provides it or refuses; the receiver accepts or declines. No further rounds.

The client enforces the mandatory vs. discretionary signal distinction. Mandatory signals must always be included in a connection request; their absence causes the request to be rejected at submission. Discretionary signals are owner's choice — the owner may withhold them while sharing only the count.

**[GAP AC-11]**: The complete classification of all signal types as mandatory or discretionary has not been produced. This is a known open item (server infrastructure Gap G-15). The client cannot enforce the mandatory/discretionary split until the full classification exists. Additionally, what happens when a new mandatory signal is introduced and pre-existing agents lack it (grace period? grandfathering?) is unresolved.

All actual trust data held in memory during relay is cleared after the accept/reject decision — never persisted to disk. The directory's persistent store holds only hashes.

### Human escalation path

When the policy includes a `human_escalation_fallback` flag and a request reaches `PENDING_ESCALATION` state:

1. Client transitions the request to `PENDING_ESCALATION` in `connection_requests` (with `escalation_expires_at` set)
2. Client fires a notification to the configured escalation channel: WhatsApp, Telegram, or Slack webhook (configured via `cello_configure`)
3. The owner reviews the pending request in the escalation channel or via the web portal / mobile app push notification
4. Owner responds ACCEPT or DECLINE
5. The channel callback triggers `cello_accept_connection` or `cello_decline_connection`
6. Client appends a `CONNECTION_ESCALATION_RESOLVED` notification to the queue
7. If `escalation_expires_at` passes without a response: request auto-declines

The client must handle the mobile app push path and the WhatsApp/Telegram path as equivalent — both produce identical outcomes via the same `cello_accept_connection` / `cello_decline_connection` calls.

**[CONFLICT AC-C5]**: Whether the native push path and the WhatsApp/Telegram path are parallel redundant channels (both fire for every escalation) or a primary/fallback hierarchy (push supersedes WhatsApp/Telegram once the app is installed) is not decided. This is the same as frontend Conflict FC-3. The client's escalation channel dispatch behavior depends on this decision.

### Alias-routed connections

When a connection request arrives via a named alias (`via_alias_id` is non-null in the request), the client:

1. Loads the alias-specific `SignalRequirementPolicy` override (if configured for this alias) and applies it instead of the global policy
2. Surfaces the `context_note` for this alias in the escalation notification (if the request reaches `PENDING_ESCALATION`) so the owner knows which context the requester came from
3. Retires the alias immediately after the first accepted connection if `connection_mode == SINGLE`

If the request arrives via an alias that has since been retired: reject with `ALIAS_RETIRED`. No information about the owner is disclosed.

### Degraded-mode connection policy

When the directory is unreachable, the client enforces the anti-downgrade rule: **directory unavailability is a reason to refuse new connections, not accept weaker ones.** New connection requests from agents not on the degraded-mode list are refused with a clear reason: "directory unreachable — retry when available."

The degraded-mode list is a shorter, stronger trust statement than the whitelist:
- **Whitelist** — agents that receive preferential treatment during normal operation (auto-accept, skip escalation queue)
- **Degraded-mode list** — a subset of trusted agents the owner explicitly permits to connect even when FROST authentication is unavailable

An agent on the whitelist is not automatically on the degraded-mode list. The owner must explicitly designate agents for degraded-mode access, and the designation represents a higher trust statement. The lists are private — their composition is never surfaced to other agents.

Connections accepted during degraded mode are flagged in the Merkle leaf.

---

## Part 7: Trust Data Custody

### The oracle pattern

The client is the sole custodian of trust signal data. The directory holds hashes. The client holds original content. This applies to all trust signals without exception.

When CELLO verifies a social account (LinkedIn, GitHub, etc.), the portal:
1. Performs the verification work
2. Creates a structured JSON record
3. Hashes: `SHA-256(json_blob)` and `SHA-256(account_identifier)` (two-hash pattern)
4. Writes both hashes to the directory
5. Returns the original JSON record to the client
6. Discards the original

The client stores the JSON blob. The directory stores the hashes. The directory cannot reconstruct the data from its hashes. If the client loses the blob, re-verification via OAuth re-creates it — the hash changes (new verification time), but the signal class (LinkedIn, GitHub, etc.) is the same.

### Two-hash pattern — selective identity disclosure

Each social verification produces two independent hashes:

- `account_id_hash = SHA-256(platform_account_identifier)` — proves which account
- `data_hash = SHA-256(verified_data_blob)` — proves what was verified

This separation allows attribute-only disclosure. The client can present the data blob and its hash — "I have a LinkedIn account that is 8 years old with 4,000 followers" — without revealing which LinkedIn account it is. If the receiving agent's policy requires identity proof, the client additionally presents the account identifier and its hash. That reveal is the owner's choice, not a protocol default.

The client enforces this distinction at connection time: for each signal, the owner's configured mandatory/discretionary flag (once fully specified — **[GAP AC-11]**) determines whether the account identifier is included automatically or withheld unless requested.

### Pseudonym binding proof

When initiating a connection, the client generates a minimal signed proof:

```json
{
  "agent_id":             "alice_id",
  "pseudonym":            "Y",
  "directory_signature":  "signs(agent_id || pseudonym)"
}
```

This is permanent — it does not expire and carries no stats. The counterparty uses pseudonym Y to query the directory live for current track record stats. The client cannot present stale data because it is not presenting the data — the directory is the authoritative source.

### Endorsement and attestation records

The client holds the signed endorsement and attestation records it has received. The directory holds only the `endorsement_hash` and `attestation_hash` for each.

On connection request: the client presents signed records; the counterparty verifies by hash lookup against the directory (milliseconds, no round-trips to the endorser).

The client tracks:
- Endorsements received (signed record + directory-verified hash)
- Endorsements issued (client holds its own signed endorsement records)
- Attestations received

Endorsement revocation: the directory appends a revocation event alongside the existing hash. The client, on receiving a revocation notification, marks the corresponding record as revoked in local storage.

**[GAP AC-12]**: `cello_request_endorsement` and `cello_revoke_endorsement` are explicitly flagged as missing from the 33-tool MCP surface. The client has no implemented tool surface for requesting endorsements from contacts or revoking endorsements the agent has issued. These require at minimum two new MCP tools and corresponding client logic.

### Client-side contact list

The contact list is entirely local — never sent to the directory.

```
contact_list[]  — client only
  peer_agent_id
  display_name          — local alias
  policy_override       — custom SignalRequirementPolicy for this specific agent
  whitelist: bool       — auto-accept regardless of trust profile
  degraded_mode: bool   — accept even when directory is unreachable
  blocked: bool
  first_seen: timestamp
```

The `degraded_mode` flag is deliberately separate from `whitelist`. "I always accept you" is different from "I accept you even when I can't verify anything." Separation is intentional.

### Recovery contact obligations

When the client receives a `RECOVERY_CONTACT_DESIGNATED` notification, it records the designation locally:

```
recovery_contact_for[]   — client only
  principal_agent_id
  m_threshold
  designated_at
```

This is the authoritative source for "who am I a recovery contact for?" — the client does not need to query the directory to answer this question. When a `RECOVERY_ATTESTATION_REQUESTED` notification arrives, the client matches it against this table to surface the pending request. The agent's explicit in-client action to sign the attestation is the only thing that counts toward the M-of-N threshold.

---

## Part 8: Local Persistence

### Database

SQLCipher provides transparent AES-256 encryption of the local SQLite database file. It protects against at-rest attacks: stolen device, backup extraction, cold forensics. It does not protect against runtime compromise — when the client is running, the database is open and the key is in memory. SQLCipher is the recommended option but not mandatory; operators choose based on deployment context.

The `db_key` is derived from the identity key:
```
db_key = HKDF(identity_key, "local-db-key", agent_id)
```

### What the client stores

The client's database has three tiers of data:

**Protocol-mirrored data** — mirrors what the directory records for this agent; held by both sides. The client's copy is the authoritative source for dispute resolution and non-repudiation:
- Conversation Merkle trees (full leaf sequence, not just the sealed root)
- Session seal records (close type, attestation, sealed root hash, MMR peak)
- Social verification JSON blobs (the only copy — directory holds only hashes)
- Endorsement and attestation signed records
- Notification event payloads (directory holds only payload hashes)
- Trust signal JSON blobs

**Local-only data** — never sent to the directory:
- Contact list (whitelist, degraded-mode list, blocked list, policy overrides, display names)
- Alias context records (`context_note`, `shared_at_locations`, `connection_count` — the private metadata about where the alias was shared)
- Recovery contact obligations (who this agent is designated to help recover)
- Human injection log entries (see Companion Device API section)

**Derived / cached data** — can be reconstructed from the above or from the directory:
- Pre-computed pseudonym stats cache (for connection request self-presentation)
- Cached counterparty trust profiles (refreshed periodically)

### Conversation log entry types

Every entry in the conversation log has a `merkle_leaf_hash` field:

| Entry type | Direction | `merkle_leaf_hash` | In protocol record? |
|---|---|---|---|
| `agent_sent` | out | populated | Yes — in Merkle tree |
| `agent_received` | in | populated | Yes — in Merkle tree |
| `session_event` | local | populated | Yes — control leaves are in Merkle tree |
| `human_injected` | local | `null` | No — local only |
| `human_requested` | local | `null` | No — local only |

The `merkle_leaf_hash` discriminator is the single field distinguishing protocol entries (verifiable against the directory) from local-only entries (private to the owner's machine). Human injection events are never in the protocol record — the other agent never knows a human was involved.

Example conversation with human injection:

| seq | type | content | merkle_leaf_hash |
|---|---|---|---|
| 1 | `agent_received` | "Can you approve the revised terms?" | `a3f7...` |
| 2 | `human_injected` | "Yes, accept those terms" | `null` |
| 3 | `agent_sent` | "Confirmed, we accept the revised terms" | `9c2b...` |

### Append-only enforcement

Core conversation tables are append-only. The client never deletes or modifies sealed Merkle leaf records. This matches the directory's append-only guarantee — if the client's record diverges from the directory's, the discrepancy is detectable via Merkle proof.

Mutable tables (contact list, cached trust profiles) are explicitly identified as derived or local-preference state and are not part of the non-repudiation record.

### Encrypted cloud backup

The full client data store is encrypted with `backup_key` (derived from the identity key) and uploaded to user-configured cloud storage. The cloud provider sees only ciphertext.

The backup includes conversation Merkle trees — the one category of data that cannot be reconstructed from scratch from the directory or re-derived from the identity key.

---

## Part 9: Companion Device API

The companion device API is a separate surface from the MCP tool surface. It is:
- Accessible only over authenticated libp2p P2P from registered companion devices
- Not exposed to agents via MCP tools
- Not accessible from the directory or any CELLO infrastructure
- Read-only for content, with a narrow write path for human injection

### Companion device allowlist

The client maintains an allowlist of authorized companion device public keys. Each entry represents a device whose keypair was generated at app install time and registered via phone OTP verification (same phone number as the registered agent).

Only registered companion devices can establish a P2P companion connection. The directory facilitates NAT traversal for the companion connection (hole-punching, the same mechanism as agent-to-agent connections) but does not verify the companion device keypair — the client does that directly.

**[GAP AC-13]**: The companion device registration ceremony — how the companion device public key is provisioned to the client's allowlist during app install — is not fully specified. Whether this uses a dedicated registration flow distinct from device attestation enrollment, or piggybacks on the same path, is not decided. This is carried from frontend Gap F-43.

**[GAP AC-14]**: Maximum number of companion devices per agent is not specified. The companion device registry table in the server infrastructure (`companion_device_registrations`) has no cardinality constraint documented.

### Owner-facing API

Three operations, accessible only from registered companion devices:

#### `list_sessions()`

Returns session metadata list (no content). This is lightweight — always loads quickly even on slow connections.

```
Returns:
  Session[]
    session_id
    counterparty_agent_id (or room_id for group sessions)
    status:   active | sealed | aborted | expired
    message_count
    opened_at
    closed_at?
    seal_type?
```

#### `fetch_session_content(session_id)`

Returns the full conversation log for one session on demand — both protocol entries (with `merkle_leaf_hash`) and local-only entries (with `merkle_leaf_hash = null`). Content is fetched when the owner taps a session; not pre-loaded.

```
Returns:
  ConversationEntry[]
    seq
    entry_type:   agent_sent | agent_received | session_event | human_injected | human_requested
    direction:    in | out | local
    content
    merkle_leaf_hash?   — null for local-only entries
    timestamp
```

#### `send_human_injection(session_id, content)`

Delivers owner input to the agent as a special input signal: "your owner wants this in the conversation." The agent receives it and decides what to do — pass it verbatim, wrap it with context, use it as an instruction, or ignore it.

The client:
1. Validates the session is active
2. Delivers the content to the agent via the agent's input channel (not via `cello_receive` — this is out-of-band from the CELLO message flow)
3. Records a `human_injected` entry in the local conversation log with `merkle_leaf_hash = null`

The human injection is never sent to the counterparty directly. It is an input to the agent. Whatever the agent sends to the counterparty enters the Merkle tree as a normal `agent_sent` entry.

**[GAP AC-15]**: The mechanism by which the client delivers the human injection content to the agent's input channel is not specified. For Deployment Model B (channel-based agents such as OpenClaw, ZeroClaw), the channel adapter handles this. For Deployment Model A (direct MCP agents), the delivery path is not designed — `cello_receive` returns protocol messages, not owner-injected content. A separate notification or input mechanism is needed.

### Notification channel — `cello_request_human_input`

The `cello_request_human_input` MCP tool is agent-facing (not companion-device-facing). When the agent calls it:

1. Client sends a content-free knock request to the directory via the persistent WebSocket
2. Directory pushes a push notification to the companion device via APNs (iOS) / FCM (Android): "Your agent is requesting input"
3. Owner opens the app; companion P2P connection is established
4. Owner sees conversation context via `fetch_session_content`
5. Owner responds via `send_human_injection`

The directory sees "send a knock to owner X's companion device" — no content, no context, just a signal. The knock is the `HUMAN_INPUT_REQUESTED` notification type in the directory's notification type registry.

Alternatively, the agent can reach the owner via the configured WhatsApp/Telegram channel without using `cello_request_human_input`. Both paths produce the same outcome from the agent's perspective: owner input delivered via the injection mechanism.

### Client offline behavior for companion connections

If the companion device attempts to connect and the client is unreachable (laptop off, VPS down, network partitioned):

- The app displays "unable to reach client" — nothing more
- No cached state is served
- No "last synced" timestamp is shown
- No attempt to reach the client through alternate paths

The companion app is a live viewer. If there is nothing to view, it says so. The owner determines why the client is unreachable and resolves it themselves.

---

## Part 10: Notification Handling

### Notification delivery to the agent

The client maintains a notification queue. Events arrive from two sources:

- **Directory** — pushed via the persistent authenticated WebSocket. Includes: incoming connection requests, endorsement received/revoked, system events (directory reachability, K_local degraded mode, key rotation nudge), anomaly alerts, tombstone/trust/recovery/succession events.
- **Client-generated** — Layer 1 security blocks, Layer 3 outbound gate fires, delivery failure escalations, `PENDING_ESCALATION` outcomes, `CONNECTION_ESCALATION_RESOLVED` events.

The agent polls this queue via `cello_poll_notifications`. Events are returned in receipt order. The agent acknowledges events by passing `ack_previous: true` on the next poll.

**[GAP AC-16]**: Whether notifications must route through the directory or can go peer-to-peer is explicitly unresolved (server infrastructure Gap G-32). The client's notification delivery path — and therefore the latency and availability characteristics of notifications — depends on this decision.

### Notification type registry

The client implements the complete notification type registry. Types are enumerated, not freeform:

| Type | Source | Description |
|---|---|---|
| `connection_request` | Directory | Incoming connection request — trust profile, greeting (Layer 1 sanitized before queuing — no unsanitized user content reaches the agent), scan_result, via_alias? Agent may call `cello_scan` on greeting before accepting. |
| `connection_accepted` | Directory | An outbound request the agent sent was accepted |
| `connection_declined` | Directory | An outbound request was declined |
| `connection_escalation_resolved` | Client | Human escalation resolved (accepted / declined / timed out) |
| `endorsement_received` | Directory | Another agent endorsed the caller |
| `endorsement_revoked` | Directory | A previously received endorsement was revoked |
| `attestation_received` | Directory | Another agent issued an attestation |
| `room_invite` | Directory | Invited to a group room |
| `security_block` | Client (Layer 1) | Layer 1 fired on a received message |
| `system` | Directory / client | Directory reachability change, K_local degraded mode entry/exit, key rotation nudge |
| `tombstone` | Directory | A connected identity has been tombstoned |
| `trust_event` | Directory | A connected agent's trust status has changed |
| `recovery_event` | Directory | A recovered identity is re-entering the network |
| `session_close_attestation_dispute` | Directory | A counterparty has filed a dispute against a session |
| `succession_claim_filed` | Directory | A succession claim has been filed against this agent |
| `human_input_requested` | Client | Internal signal used to coordinate the `cello_request_human_input` knock delivery |

### Escalation channel routing

When a `connection_request` event produces `PENDING_ESCALATION`, the client routes notification to the owner via the configured escalation channels from `ServerConfig.escalation_channels`:

```
escalation_channels:
  whatsapp?:      phone number or recipient identifier
  telegram?:      chat ID or recipient identifier
  slack_webhook?: Slack incoming webhook URL
```

The notification must include: the requester's handle, top trust signals (named, never a numeric score), the greeting text (post-Layer-1), the time remaining before auto-decline.

The owner's response via any configured channel must route back to the client and trigger `cello_accept_connection` or `cello_decline_connection`. The exact callback mechanism for each channel is not specified in source documents. **[GAP AC-17]**

---

## Part 11: MCP Tool Surface

The client exposes 35 tools (the 33 from the canonical tool surface, plus `cello_request_human_input` and `cello_acknowledge_receipt`). The full tool specifications — parameters, return types, and usage guidance — are in [[2026-04-14_1100_cello-mcp-server-tool-surface|CELLO MCP Server Tool Surface]]. This section covers the client's implementation responsibilities for each group.

### Deployment models

The client's behavior is identical across deployment models. The calling pattern differs; the implementation does not.

**Model A — Direct MCP agents** (Claude Code, Codex, Gemini CLI): The agent drives the conversation loop. It calls `cello_send` to send and `cello_receive` to wait. `cello_receive` blocks (long-poll) while the libp2p P2P channel listens underneath. On message arrival the tool returns immediately; on timeout it returns `{type: "timeout"}`.

**Model B — Channel-based agents** (OpenClaw, NanoClaw, ZeroClaw, Hermes-Agent, PicoClaw): CELLO is one channel among several in a multi-channel framework. The channel adapter drives the protocol loop — calling `cello_receive` on behalf of the agent, dispatching responses via `cello_send`. The agent defines handlers; the adapter dispatches.

### Tool group summary

| Group | Tools | Count |
|---|---|---|
| Session / Conversation | `cello_send`, `cello_receive`, `cello_initiate_session`, `cello_close_session`, `cello_abort_session`, `cello_resume_session`, `cello_list_sessions`, `cello_acknowledge_receipt` | 8 |
| Security | `cello_scan`, `cello_report`, `cello_redact`, `cello_block_agent` | 4 |
| Trust / Identity | `cello_verify`, `cello_get_trust_profile`, `cello_check_own_signals` | 3 |
| Discovery & Listings | `cello_search`, `cello_create_listing`, `cello_update_listing`, `cello_renew_listing`, `cello_retire_listing` | 5 |
| Connection Management | `cello_initiate_connection`, `cello_accept_connection`, `cello_decline_connection`, `cello_disconnect` | 4 |
| Group Conversations | `cello_create_room`, `cello_join_room`, `cello_leave_room` | 3 |
| Notifications | `cello_poll_notifications` | 1 |
| Policy & Configuration | `cello_manage_policy`, `cello_configure` | 2 |
| Status | `cello_status` | 1 |
| Contact Aliases | `cello_create_alias`, `cello_list_aliases`, `cello_retire_alias` | 3 |
| Human Input | `cello_request_human_input` | 1 |
| **Total** | | **35** |

### Key client-side implementation notes per group

**Session / Conversation:** `cello_send` dispatches dual-path simultaneously (P2P + directory hash relay); applies Layer 3 outbound gate and Layer 4 redaction before delivery; the `leaf_hash` return value is the Merkle leaf hash for the sent message. `cello_receive` applies Layer 1 sanitization to all incoming text before returning content; returns a `security_block` sentinel if Layer 1 fires rather than passing unsanitized text. `cello_close_session` participates in the FROST seal ceremony; returns `sealed_root_hash` and `mmr_peak`. `cello_acknowledge_receipt` provides explicit causal commitment: the agent calls it with a `leaf_hash` to record that it has processed a specific message and that any subsequent messages from this agent are causally downstream of that receipt. The client writes a signed `RECEIPT` control leaf into the Merkle tree (same construction as other control leaves) and submits the hash to the directory. Designed for high-stakes multi-party and commerce scenarios where implicit ACK via the Merkle chain is insufficient — e.g., an agent must prove it received an offer before it made a counter-offer. Calling `cello_acknowledge_receipt` is always optional; the default implicit ACK behaviour (Merkle chain) remains the norm for all other sessions.

**Security:** `cello_scan` invokes the Layer 2 LLM scanner; the client is responsible for enforcing structured output mode and schema validation. `cello_report` submits a signed trust incident report to the directory; the client signs with K_local before submission.

**Trust / Identity:** `cello_verify` performs multi-node cross-check with Merkle proof verification; returns `SignalResult[]` — never a numeric score. `cello_get_trust_profile` returns the agent's own trust profile as it appears to the directory. `cello_check_own_signals` queries the local trust signal store to list all signal states.

**Discovery:** `cello_search` queries the directory's BM25 + vector similarity + tag/filter stack; requires an active authenticated session. `cello_create_listing` writes to the directory's `directory_listings` table; the client signs the listing creation.

**Connection Management:** `cello_accept_connection` and `cello_decline_connection` are normally called automatically by the policy evaluation pipeline; the agent calls them explicitly for escalated cases where the human owner has responded. `cello_initiate_connection` accepts target by agent_id, handle, or alias URI — the client resolves the alias to an agent_id at connection time.

**`connection_request` event routing (AC-64 resolved):** Incoming connection requests surface exclusively via `cello_poll_notifications`, never via `cello_receive`. The `connection_request` notification payload includes the requester's trust signals and the greeting text — but the greeting has already passed through the Layer 1 deterministic sanitization pipeline before the event is queued. The agent therefore sees a sanitized greeting and can evaluate it before deciding to accept. If the agent wants deeper assurance, it calls `cello_scan` on the greeting text before calling `cello_accept_connection` — this is the recommended invocation point for Layer 2 and is explicitly optional. `cello_receive` is session messages only: it is not called until after acceptance, and the greeting is not re-delivered through it. This separation preserves the security invariant: no unsanitized user-generated content ever reaches the agent through either tool.

**Policy & Configuration:** `cello_manage_policy` reads and writes the `SignalRequirementPolicy` — the client validates that the policy is expressed as named signal requirements, never as numeric thresholds. `cello_configure` updates `ServerConfig` including escalation channels, scan sensitivity, P2P bootstrap nodes, and degraded mode behavior.

**Status:** `cello_status` must distinguish two qualitatively different states: "directory unreachable — existing sessions continue" (`k_local_only: true`) vs. "agent locked — no new sessions possible" (post-"Not Me" K_server revocation, not currently a separate status field in the tool surface).

**[GAP AC-18]**: `cello_status` currently returns `k_local_only: boolean` but does not distinguish between (a) directory temporarily unreachable and (b) agent deliberately locked after "Not Me" K_server revocation. These are meaningfully different operational states. The status tool should surface this distinction.

**Contact Aliases:** `cello_create_alias` writes to the directory's `contact_aliases` table and to the client's local `contact_alias_records` table (the `context_note` and `shared_at_locations` fields are local-only). `cello_retire_alias` appends a revocation event to the directory log.

**Human Input:** `cello_request_human_input` sends a content-free knock to the directory, which pushes a push notification to registered companion devices. See Part 9 for the full flow.

### Canonical tool names

The following names are canonical and supersede inconsistencies in earlier documents:

| Canonical | Supersedes |
|---|---|
| `cello_scan` | `cello_scan_message` (cello-design.md) |
| `cello_search` | `cello_find_agents` (cello-design.md) |
| `cello_send` | `cello_send_message` (cello-design.md) |
| `cello_verify` | `cello_check_trust` (cello-design.md) |

---

## Cross-Cutting Client Flows

### Registration and first-use

1. Owner initiates registration via WhatsApp/Telegram bot — phone OTP, baseline provisioning
2. Client generates K_local and identity key; BIP-39 seed phrase produced for owner to back up
3. K_server_X FROST ceremony runs; primary and fallback public keys registered in directory
4. Client performs bootstrap discovery and establishes persistent authenticated WebSocket
5. Owner visits web portal to optionally strengthen trust profile (WebAuthn, OAuth, device attestation)
6. Portal returns trust signal JSON blobs to client; client stores; directory holds hashes only

### Session setup

1. Both agents are online with persistent authenticated WebSockets to their respective directory nodes
2. Agent A calls `cello_initiate_connection` — directory relays connection request to Agent B
3. Client B runs the automated policy evaluation pipeline (Layer 1 → signal verification → policy match)
4. If auto-accepted: Agent B's client calls `cello_accept_connection`; FROST session establishment ceremony runs
5. Directory performs ephemeral Peer ID exchange on behalf of both clients
6. NAT traversal attempted (DCuTR → relay → WebSocket/443)
7. Direct P2P connection established; dual-path dual dispatch begins

### Message flow

1. Agent A calls `cello_send(session_id, content)`
2. Client A applies Layer 3 outbound gate + Layer 4 redaction
3. Client A builds Merkle leaf (content hash + sender_pubkey + conversation_id + last_seen_seq + timestamp)
4. Client A dispatches simultaneously: content + signed leaf to B via P2P; signed leaf to directory via WebSocket
5. Directory assigns canonical sequence number, records in message tree, relays hash + seq# to B's WebSocket
6. Client B receives message + signed leaf via P2P AND hash + seq# from directory
7. Client B applies Layer 1 sanitization to content; cross-checks hash; updates local Merkle tree
8. If Layer 1 fires: `cello_receive` returns `security_block` sentinel instead of message content

### Session seal

1. Agent A calls `cello_close_session(session_id)`
2. Client A sends a signed CLOSE control leaf (includes A's CLEAN or FLAGGED attestation)
3. Client B receives CLOSE via P2P and from directory; Client B sends CLOSE-ACK (includes B's attestation)
4. Directory initiates FROST seal ceremony; both clients participate
5. `cello_close_session` returns `sealed_root_hash` and `mmr_peak`
6. Session enters terminal state; subsequent messages are rejected
7. If directory is unavailable: bilateral seal completes immediately; notarized FROST seal deferred

### Key rotation

1. Directory sends `KEY_ROTATION_RECOMMENDED` notification to agent
2. Agent/operator decides to rotate (typically at the next session boundary)
3. Client seals any active sessions
4. Owner authenticates via WebAuthn or phone OTP at the portal
5. Client generates new K_local_v2
6. Client registers K_local_v2 with directory; directory retires K_local_v1
7. New K_server_X ceremony runs paired with K_local_v2; old K_server_X shares retired
8. Client stores new K_local; old K_local securely deleted

### Compromise detection and "Not Me"

1. Directory detects anomaly (e.g., FROST session establishment failure from unexpected source)
2. Directory fires `FALLBACK_CANARY` anomaly event; pushes push notification to owner's WhatsApp/Telegram
3. Owner taps "Not Me" in mobile app or portal
4. Mobile app sends revocation request to home node; K_server_X shares immediately burned
5. No new FROST sessions possible — all new connection requests rejected
6. Owner authenticates with WebAuthn at portal; generates new K_local; new K_server_X ceremony
7. New keys published; connected agents receive key refresh notification

### Companion device connection

1. Owner opens mobile app or desktop app
2. App initiates libp2p connection; directory facilitates NAT traversal between companion device and client
3. Client verifies companion device keypair against allowlist
4. Direct P2P established; companion reads `list_sessions()` — metadata only, always fast
5. Owner taps a session; `fetch_session_content(session_id)` returns full log including local-only entries
6. If owner types a message: `send_human_injection(session_id, content)` → client delivers to agent
7. Owner closes app → P2P connection drops; no content persisted on companion device

---

## Data Ownership Map

| Data | Client holds | Directory holds | Other |
|---|---|---|---|
| Identity key (K_local) | Yes — in KeyProvider | No | BIP-39 seed phrase backup |
| K_server_X shares | No | Yes — distributed as FROST threshold shares across nodes | — |
| Trust signal JSON blobs | Yes — sole copy | No — hashes only | Portal discards after returning to client |
| Public keys | Yes | Yes — in identity tree | Both hold |
| Pseudonym + binding proof | Yes | Yes — directory co-signs binding | Both hold |
| Conversation Merkle trees | Yes — full leaf sequence | Yes — sealed root hash in MMR | Both hold; client has the full tree; directory has the sealed root |
| Session attestations | Yes — in local log | Yes — in `conversation_attestations` table | Both hold |
| Endorsement signed records | Yes — sole copy | No — hashes only | — |
| Attestation signed records | Yes — sole copy | No — hashes only | — |
| Notification payloads | Yes — sole copy | No — payload hashes only | — |
| Contact list | Yes — local only | No | Never sent to directory |
| Alias context notes | Yes — local only | No | `context_note` is local-only; alias registry entry is in directory |
| Recovery contact obligations | Yes — local only | No | Client records on receiving `RECOVERY_CONTACT_DESIGNATED` notification |
| Human injection logs | Yes — local only | No | `merkle_leaf_hash = null`; not in protocol record |
| Bio text | Yes | No — hash only | Portal discards after return |
| Track record stats | No — derived | Yes — authoritative | Client queries live at connection time |
| Message content | Yes (P2P) | No | P2P only; directory never sees content |
| Scan results | Yes — in local leaf | Yes — embedded in Merkle leaf | Both hold (scan result is part of the signed leaf) |

---

## Conflicts Requiring Resolution

**AC-C1: Bot vs. portal boundary for registration**
The client's registration path depends on whether registration always begins with the WhatsApp/Telegram bot or whether a portal-only path exists. See server infrastructure Conflict C-1 and frontend Conflict FC-1. Until resolved, the client cannot implement a definitive registration flow.

**AC-C2: Who computes `prev_root` in Merkle leaf** *(three-way conflict — NOT RESOLVED)*
- Earlier design (2026-04-08): Sender includes `prev_root` in the signed leaf.
- Middle design (2026-04-13, multi-party): Sender signs only the authorship proof; directory appends `prev_root`.
- Later design (2026-04-15, session-level FROST signing): Sender-computed `prev_root` reinstated — the log explicitly states "A builds a signed Merkle leaf containing: hash(message), prev_root (committing to all previous messages), and A's K_local signature over the leaf."
- The prior resolution (2026-04-13 supersedes) is now contradicted by the 2026-04-15 document. Requires explicit decision. See also [GAP AC-21] (genesis `prev_root` initialization value).

**AC-C3: Merkle leaf prefix collision**
RFC 6962 internal nodes use prefix `0x01`. §6.6 of end-to-end-flow assigns prefix `0x01` to control leaves (CLOSE, SEAL, ABORT, etc.). These are incompatible. The client cannot implement the Merkle tree correctly until this is resolved. See server infrastructure Conflict C-3.

**AC-C4: DeBERTa model delivery — bundled vs. downloaded**
- `open-decisions.md`: model bundled in npm package, SHA-256 pinned.
- `design-problems.md`: download script in npm package fetches from a fixed Hugging Face URL, hash-verified post-download.
Both impose SHA-256 verification; delivery mechanism differs. See server infrastructure Conflict C-7.

**AC-C5: Native push vs. WhatsApp/Telegram escalation relationship**
Whether the two escalation channels are parallel redundant paths (both fire) or a primary/fallback hierarchy (app supersedes WhatsApp/Telegram once installed) is not decided. Affects the client's escalation dispatch logic. See frontend Conflict FC-3.

**AC-C6: "Not Me" scope for existing sessions**
- §8.3: Existing conversations signed with K_local alone remain valid after "Not Me" K_server revocation.
- §8.4: All active sessions receive SEAL-UNILATERAL with tombstone reason code on any tombstone.
The client's behavior on receiving a K_server revocation event is directly contradicted across two sections. Decision required before the client can implement the "Not Me" response path. See server infrastructure Conflict C-5.

**AC-C7: Leaf inner authorship proof vs. outer directory leaf — two separate structures**
- Part 4 uses "Merkle leaf" to refer both to the sender's inner signed payload (content_hash, sender_pubkey, conversation_id, last_seen_seq, timestamp) and to the outer directory-constructed leaf (sequence_number, sender_pubkey, message_content_hash, sender_signature, prev_root) per multi-party design §4.
- These are two distinct data structures. The document conflates them throughout (cross-cutting message flow, leaf format specification). Implementors cannot construct the correct leaf format without a clear separation between what the sender signs and what the directory hashes.
- Requires explicit two-structure specification before implementation. See multi-party-conversation-design.md §4.

**AC-C8: Escalation resolution routing — client callback vs. home node proxy**
- agent-client.md Part 6, step 5: "The channel callback triggers `cello_accept_connection` or `cello_decline_connection`" — the callback routes directly to the client.
- frontend.md cross-surface escalation flow, step 7: "The decision is submitted to the home node, which calls `cello_accept_connection` or `cello_decline_connection`" — the home node is an intermediary.
- These are architecturally incompatible. The CELLO client is on the agent operator's private hardware; a home-node-to-client call is unusual and not described elsewhere. Decision required.

**AC-C9: Directory role during connection request relay — relay vs. verify-and-vouch**
- agent-client.md Part 6: "The directory relays connection requests without re-signing."
- connection-request-flow-and-trust-relay.md: The directory verifies submitted trust scores against its held hashes before forwarding — "it is not merely relaying, it is vouching that the data is authentic."
- Whether the receiver's Merkle proof check (pipeline step 2) is redundant given directory pre-verification, or essential because the directory is untrusted, needs explicit statement.

**AC-C10: Companion device identity verification — client vs. directory**
- agent-client.md Part 9: "The directory does not verify the companion device keypair — the client does that directly."
- server-infrastructure.md: "The directory must maintain a registry of authorized companion device public keys per agent."
- Who performs the verification (client allowlist vs. directory registry) is contradicted. Decision required.

**AC-C11: "Not Me" revocation from desktop tray — unhoused capability**
- frontend.md Surface 4: Desktop app system tray includes "Not Me / Emergency" shortcut, routed through the companion connection.
- agent-client.md Part 9: The companion device API exposes only `list_sessions()`, `fetch_session_content()`, and `send_human_injection()` — no revocation endpoint.
- Emergency revocation from the desktop companion has no path in the companion API. Either the API needs a revocation endpoint, or the desktop tray routes via a different channel. Decision required.

---

## Gaps Requiring Decisions

| ID | Area | Gap |
|---|---|---|
| AC-1 | Key management | K_server_X rotation notification format, grace period duration, and epoch identifier format not specified |
| AC-2 | Persistence | ~~Resolved~~ — 2-year default (`merkle_retention_days: 730`), configurable per deployment. Sealed root hash and MMR peak survive pruning; leaf-level proofs do not. 30-day `MERKLE_PRUNE_SCHEDULED` notice before deletion. |
| AC-3 | Transport | Acceptable timestamp skew window for directory nonce verification not specified |
| AC-4 | Transport | ~~Resolved~~ — reuse same ephemeral Peer ID on brief disconnect; new ID generated only on deliberate close, restart, or reconnection window expiry (AC-5). |
| AC-5 | Transport | How many P2P session drops before conversation is considered abandoned; retry vs. escalate to relay behavior |
| AC-6 | Merkle | Session inactivity timeout value not specified |
| AC-7 | Merkle | REOPEN semantics: new FROST ceremony required? Sequence numbers across seal boundary? Unilateral REOPEN permitted? |
| AC-8 | Group rooms | Offline catch-up for group rooms not designed: client rejoining mid-conversation receives `current_message_count` but no replay mechanism |
| AC-9 | Delivery | Grace period values for delivery failure Cases B and C not specified; whether configurable per conversation type or protocol-wide not decided |
| AC-10 | Layer 5 | Runtime governance state persistence across restarts: in-memory counters reset on restart; upgrade path to Redis/DynamoDB not specified as a requirement |
| AC-11 | Connection | Complete mandatory vs. discretionary signal classification not produced; versioning/grandfathering for new mandatory signals not designed |
| AC-12 | Endorsements | `cello_request_endorsement` and `cello_revoke_endorsement` MCP tools are missing from the tool surface; client logic for requesting and revoking endorsements not designed |
| AC-13 | Companion | Companion device registration ceremony (how keypair is provisioned to client allowlist during app install) not fully specified |
| AC-14 | Companion | Maximum number of companion devices per agent not specified |
| AC-15 | Companion | Human injection delivery mechanism to agent input channel for Deployment Model A (direct MCP) not designed; `cello_receive` returns protocol messages, not owner-injected content |
| AC-16 | Notifications | Whether notifications route through directory or can go peer-to-peer is explicitly unresolved |
| AC-17 | Notifications | Escalation channel callback mechanism (how owner's WhatsApp/Telegram/Slack response routes back to client to trigger accept/decline) not specified |
| AC-18 | Status | `cello_status` does not distinguish between "directory temporarily unreachable" and "agent locked post-Not-Me revocation"; these are meaningfully different states |
| AC-19 | Registration | Incubation period (7-day, 3 outbound connections/day for phone-only agents) not mentioned anywhere; client must track incubation state locally and enforce outbound rate limits |
| AC-20 | Registration | Email verification is a mandatory registration requirement (per server-infrastructure) but is entirely absent from the client — not in registration flow, trust signal types, data ownership map, or storage tiers |
| AC-21 | Merkle | Genesis `prev_root` initialization value not specified. open-decisions.md Decision 7 defines it as `hash(agent_A_pubkey \|\| agent_B_pubkey \|\| session_id \|\| timestamp)`. Without this, independent implementations diverge at the first message of every conversation. Blocked by AC-C2 resolution |
| AC-22 | Merkle | `scan_result` is listed in the data ownership map as part of the signed Merkle leaf, but the leaf construction spec in Part 4 does not include it as a field. libp2p-dht-and-peer-connectivity.md explicitly includes `scan_result` in the leaf format |
| AC-23 | Merkle | Degraded-mode leaf construction unspecified: `last_seen_seq` is defined as "the last sequence number received from the directory" — which is unavailable when the directory is unreachable. How the client constructs valid leaves during degraded operation is not specified |
| AC-24 | Merkle | Degraded-mode session flag ("flagged in Merkle leaf") has no specified leaf field. The Merkle leaf structure in Part 4 has no `degraded_mode_session` field or equivalent |
| AC-25 | Merkle | MMR inclusion proof verification not described. Client must implement the five-step inclusion proof algorithm (recompute leaf → walk sibling hashes → reconstruct checkpoint → verify federation signatures → accept/reject) for fabricated conversation defense. Distinct from per-message cross-check |
| AC-26 | Merkle | `mmr_peak` return from `cello_close_session` is inconsistent with batched checkpoint MMR construction: seals accumulate in staging between checkpoints, so the peak at seal time is from the last checkpoint, not this conversation. The meaning of `mmr_peak` at return time needs clarification |
| AC-27 | Merkle | ABORT and EXPIRE conversations must also enter the MMR per meta-merkle-tree-design.md (all INSERT into `conversation_seals` triggers MMR append). Whether `cello_close_session` participates in MMR insertion for ABORT and EXPIRE closes is not specified |
| AC-28 | Merkle | Multi-party tree anchor formula not described. Source replaces two-party anchor with `SHA-256(sorted_participant_pubkeys \|\| session_id \|\| timestamp)`. Mid-conversation participant joins trigger a re-anchor control leaf. Neither the anchor formula nor the re-anchor control leaf type appears in the control leaves table |
| AC-29 | Merkle | LLM receive window for group rooms (silence threshold, max accumulation window, direct-address override; controlled by `room_config` fields `silence_threshold_ms` and `max_accumulation_ms`) is entirely absent. This is a client-side mechanism the agent uses to participate in group rooms |
| AC-30 | Merkle | Serialized-mode group room dispatch: dual-path simultaneous dispatch does not apply. In serialized mode, the client submits to the directory send queue; there is no P2P direct send before sequencing. A different dispatch path per ordering mode is required |
| AC-31 | Merkle | Three-tier group message content delivery topology not described: full mesh P2P (2–5 participants), GossipSub (5–15+), encrypted relay fan-out (any size). Client must select topology based on participant count |
| AC-32 | Merkle | Per-participant attestation table for multi-party seals not described. Source replaces `party_a_attestation`/`party_b_attestation` with a `conversation_attestations` table and adds `DELIVERED` (transport ACK received, no output) and `ABSENT` (participant went offline/removed) states. Client must submit per-participant rows at seal time |
| AC-33 | Merkle | `DELIVERED`→`ABSENT` transition timeout unspecified for group room participants. AC-6 covers bilateral inactivity timeout only |
| AC-34 | Merkle | Control message priority in serialized mode: whether ABORT or FLAGGED control leaves can bypass the send queue is an open design question not surfaced in the gaps list |
| AC-35 | Merkle | Delivery Case B: hash-arrives-first-then-message handling path is absent. The delivery failure table only covers message-arrives-first (Case C) for the asymmetric case. session-level-frost-signing.md identifies directory-first arrival as a common case requiring distinct handling |
| AC-36 | Merkle | ~~Resolved~~ — within `post_seal_grace_seconds` (default 300s, configurable): accept-and-record as `post_seal: true` leaf. After window: auto-REOPEN, deliver as first leaf of new conversation. Post-ABORT arrivals always rejected. |
| AC-37 | Merkle | Resend vs. replay attack disambiguation not addressed. When the client retries delivery, the recipient needs a mechanism to distinguish retransmission from injected replay. Not carried forward as a gap |
| AC-38 | Merkle | ~~Resolved~~ — `cello_acknowledge_receipt` added as tool 35. Writes a signed `RECEIPT` control leaf; optional explicit causal commitment for commerce/multi-party scenarios. Implicit Merkle-chain ACK remains the default. |
| AC-39 | Merkle | Bilateral seal protocol incomplete: bilateral seal requires both parties to sign the final root AND exchange attestations per session-level-frost-signing.md. The attestation exchange step when the directory is unavailable is not described |
| AC-40 | Crypto | ML-DSA signature scheme not mentioned. quantum-resistance-design.md specifies ML-DSA (not Ed25519) for all non-threshold signatures: endorsements, attestations, directory certificates, pseudonym bindings, connection package items. Client must implement two verification paths |
| AC-41 | Crypto | `IThresholdSigner` abstraction interface not required. quantum-resistance-design.md mandates this interface (`FrostThresholdSigner` → `ThresholdMlDsaSigner`) as the mechanism for the quantum migration path. `KeyProvider` covers private key operations but not threshold signing |
| AC-42 | Crypto | Device attestation scope misframed in Deployment Contexts table. Attestation is about the owner's personal devices (iPhone, MacBook, TPM hardware), not the deployment infrastructure. A cloud VM agent whose owner has linked their iPhone carries full attestation. The table implies VPS agents cannot have device attestation, which is wrong per device-attestation-reexamination.md |
| AC-43 | Crypto | WebAuthn not distinguished from device attestation in registration flow step 5. WebAuthn is a tethering/account-security signal; it is not a device sacrifice mechanism and does not produce stable device identifiers for Sybil deduplication. The distinction must be explicit (see device-attestation-reexamination.md) |
| AC-44 | Crypto | Mid-session compromise canary gap not stated: the canary fires at session establishment boundaries only, not per message. A K_local extraction during an active session is not detected until the next session start. This is an operational security gap the document implies is covered but is not |
| AC-45 | Crypto | npm pinned-version installation requirement missing. open-decisions.md Decision 11 specifies the install command must use a pinned version (`npx @cello/mcp-server@1.2.3`) not latest, to prevent compromised npm publish from affecting all agents on restart |
| AC-46 | Transport | AutoNAT step absent from session establishment flow. libp2p-dht-and-peer-connectivity.md specifies each client runs AutoNAT ("can you reach me at this address?") before signaling candidate addresses to the directory. Without AutoNAT, reported external addresses are wrong and hole-punch success rate degrades |
| AC-47 | Transport | ~~Resolved~~ — always-on at every session establishment. Client selects 2–3 lowest-latency backup nodes and sends fire-and-forget redundant hash copies unconditionally, not only under high load. |
| AC-48 | Transport | Node load indicator in ping response not described. node-architecture-and-replication.md specifies ping packets return a single-byte load indicator used for load-aware node routing. agent-client.md describes RTT-only routing |
| AC-49 | Transport | Home node deanonymization risk not stated. The directory knows the stable-identity-to-ephemeral-Peer-ID mapping because it handles signaling. agent-client.md's ephemeral Peer ID privacy description implies stronger privacy than the design provides |
| AC-50 | Transport | Signaling behavior with respect to multi-node topology unspecified: if signaling goes only to the primary node, a primary failure mid-establishment leaves backup nodes unaware of ephemeral Peer IDs |
| AC-51 | Transport | Client behavior when all three bootstrap levels fail is unspecified |
| AC-52 | Transport | Relay node hash relay role creates a three-path architecture not reflected in agent-client.md's dual-path model. server-infrastructure.md relay node section describes relay nodes forwarding signed hash payloads to receiving agents during established sessions. The client's dual-path model must account for this third path |
| AC-53 | Connections | Gate pyramid message-level gate (Gate 2: valid signature, rate limit per sender, message size limit, notification type policy check) absent from client requirements. This is a client-side DDoS/flood defense for open institutions |
| AC-54 | Connections | Connection staking entirely absent from Part 6. Gate 1 of the gate pyramid is a stake requirement check. Client must enforce stake policy at the connection gate, check escrow balance, and trigger escrow release on CLEAN close. None of this is in Part 6 |
| AC-55 | Connections | PSI (Private Set Intersection) completely absent from client requirements — no mention, no gap marker, not in related documents. Client is an active participant in the OPRF blinding step for endorser intersection. Phase 2 but needs a design stub and related documents pointer |
| AC-56 | Connections | Negotiation round abuse logging: the one-round negotiation request should be logged as a non-repudiable event. Requesting-then-rejecting patterns feed into trust scoring per connection-request-flow-and-trust-relay.md open question #4. Not currently a requirement |
| AC-57 | Connections | Mandatory signal partial disclosure: what exactly constitutes "including" a mandatory signal is not specified. The source document tentatively concludes all-or-nothing, but the client enforcement logic depends on this definition |
| AC-58 | Connections | Social account binding lock: once a GitHub/LinkedIn account is bound, it cannot be rebound for 12 months. This is a client-side enforcement obligation per sybil-floor-and-trust-farming-defenses.md. Not mentioned in Part 7 |
| AC-59 | Connections | Endorsement dual-dispatch: when issuing an endorsement, the client sends the signed record to both the endorsed agent (P2P) and the directory (hash registration) simultaneously. This dispatch architecture is not described for when AC-12 tools are built |
| AC-60 | Notifications | Fire-and-forget notification outbound gate: client must enforce prior-conversation requirement before sending a notification. No MCP tool for outbound notification send is defined (no `cello_send_notification` or equivalent) |
| AC-61 | Notifications | Inbound notification filter stack absent: three-layer receiver-side filter (global type rules, per-sender overrides, whitelist/blacklist precedence) not described. This must be LLM-free to prevent compute DoS |
| AC-62 | Notifications | Agent-to-agent notification types (`introduction`, `order-update`, `alert`, `promotional`) absent from the notification type registry. These are the most common application-layer types per notification-message-type.md |
| AC-63 | Notifications | Outbound notification signing path not described. Fire-and-forget notifications are not session messages — they produce a single-entry directory record, not a Merkle leaf. The signing and hash submission path for this structure is absent |
| AC-64 | Notifications | ~~Resolved~~ — `connection_request` surfaces via `cello_poll_notifications` only. Greeting is included but Layer 1 sanitized before queuing. Agent evaluates greeting + trust signals, optionally calls `cello_scan`, then accepts/declines. `cello_receive` is session messages only; greeting is not re-delivered. |
| AC-65 | Notifications | `cello_retire_alias` behavior with in-flight connection requests not specified. Source states: accepted connections complete; unacted requests are rejected on alias retirement. This behavior belongs in the Part 11 implementation note for `cello_retire_alias` |
| AC-66 | Notifications | Alias-scoped policy variants not described in `cello_manage_policy` implementation note. Alias policies are named variants scoped to one alias, distinct from the global policy. The tool's Part 11 note is incomplete |
| AC-67 | Notifications | `list_sessions()` pagination/retention window unspecified. On long-running agents, returning full session history will violate the "always loads quickly" guarantee. Neither a window nor pagination is defined |
| AC-68 | Notifications | Tamper detection notification type missing. frontend.md activity log requires a distinct event type for hash–message mismatch (Case A2 tamper detection). `security_block` is defined as Layer 1 only and does not cover message-level tamper events |
| AC-69 | Notifications | No tamper detection notification type for `trust_event` level mismatch. Case A2 delivery failure fires `security_block` via `cello_receive` per Part 4, but `security_block` in the registry is labeled Layer 1 only — the label contradicts the Part 4 description |
| AC-70 | Persistence | Client-side hash chain on INSERT not required. persistence-layer-design.md specifies a running `chain_entry = SHA-256(record_contents \|\| previous_chain_hash)` on all protected tables. agent-client.md's append-only enforcement uses application convention only — weaker than the cryptographic chain the source requires |
| AC-71 | Persistence | Social verification freshness records not in persistence tier. persistence-layer-design.md defines `social_verification_freshness_checks` table (checked_at, check_result: FRESH/STALE/FAILED). Client holds the only copy; directory holds only the hash. Without freshness records, the oracle pattern breaks for freshness signals |
| AC-72 | Persistence | Companion device allowlist schema not defined anywhere. The allowlist is a security boundary but has no documented schema (device name, registered_at, revocation mechanism, binding proof reference) in any requirements document |
| AC-73 | Persistence | Push notification channel independence from P2P content channel not stated in client offline behavior section. When the CELLO client is unreachable, APNs/FCM push notifications (including "Not Me" emergency) continue working. The current framing implies all companion communication fails when the client is offline |
| AC-74 | Persistence | `cello_request_human_input` routing when both companion and WhatsApp/Telegram are configured: does the client send a knock only to the companion device, or also to the escalation channel? If the companion is unreachable and no WhatsApp/Telegram fallback fires, the agent's input request is silently lost |
| AC-75 | Persistence | Companion app install while CELLO client is offline: keypair registration ceremony requires the client to be reachable to update the allowlist. This failure mode is unaddressed |
| AC-76 | Persistence | Discovery search results (`cello_search`) not listed as a Layer 1 fire surface. Bio text and capability tags are user-generated strings that will be presented to the agent as actionable text |
| AC-77 | Recovery | Three tombstone types (VOLUNTARY, COMPROMISE_INITIATED, SOCIAL_RECOVERY_INITIATED) not specified in client. Client must set the correct type on initiation and react differently to each incoming type |
| AC-78 | Recovery | Voucher accountability enforcement absent: client has no mechanism to check its own vouching lockout status before signing a `RECOVERY_ATTESTATION_REQUESTED`, and no behavior for refusing to sign while locked out |
| AC-79 | Recovery | Client post-recovery state transition unspecified: what the client does after its own recovery completes (clear locked state, present recovery record in `cello_status`, reconnect to prior contacts at reduced trust) is not described |
| AC-80 | Recovery | Compromise window presentation and owner contest flow absent: client has no mechanism to receive, display, or contest the proposed compromise window when a tombstone is filed |
| AC-81 | Recovery | Succession package creation (encrypt seed phrase to successor's identity key, upload blob to directory) and decryption (successor uses own identity key to decrypt, then performs identity migration) are client-side crypto operations with no coverage. The Part 8 backup section and related documents mention succession only by reference |
| AC-82 | Recovery | Voluntary transfer announcement period client state machine absent: client must notify connected agents, maintain cancellable state, and execute or abort transfer on expiry. No client behavior is specified for the 7–14 day announcement period |
| AC-83 | Recovery | Asymmetric whitelist knowledge not stated as an explicit prohibition. The client must never store or cache information about which agents have it on their whitelists. Easy to accidentally violate; must be an explicit requirement |
| AC-84 | Recovery | Arbitration submission flow has no MCP tool. `cello_report` submits a trust incident report; there is no tool for submitting a FLAGGED session transcript to threshold arbitration, checking arbitration status, or receiving an arbitration verdict notification type |

---

## Related Documents

- [[protocol-map|CELLO Protocol Map]]
- [[2026-04-14_1100_cello-mcp-server-tool-surface|CELLO MCP Server Tool Surface]] — full tool specifications; this document covers the client's implementation responsibilities, not the tool parameter schemas
- [[prompt-injection-defense-layers-v2|Prompt Injection Defense Architecture]] — full 6-layer specification; the client implements all six layers
- [[end-to-end-flow|CELLO End-to-End Protocol Flow]] — deep canonical narrative; the client implements Parts 1–8
- [[cello-design|CELLO Design Document]] — original architecture; trust chain steps 3–10 are all client-side
- [[2026-04-15_0900_session-level-frost-signing|Session-Level FROST Signing]] — FROST at session/seal only; defines the current signing model the client implements
- [[2026-04-15_1100_key-rotation-design|Key Rotation Design]] — per-agent K_server_X, independent rotation, envelope encryption; defines the key management model
- [[2026-04-11_1400_libp2p-dht-and-peer-connectivity|libp2p, DHT, and Peer Connectivity]] — transport layer; bootstrap discovery, ephemeral Peer IDs, NAT traversal, dual-path architecture
- [[2026-04-11_1700_persistence-layer-design|Persistence Layer Design]] — complete schema; client-side tables (SQLCipher, contact list, alias records, recovery contact obligations, backup) are defined here alongside directory-side tables
- [[2026-04-16_1400_companion-device-architecture|Companion Device Architecture]] — companion device P2P connection, human injection, local persistence model; all implemented by the client
- [[2026-04-14_1300_connection-request-flow-and-trust-relay|Connection Request Flow and Trust Relay]] — definitive connection request flow; trust data relay and one-round negotiation
- [[2026-04-13_1500_multi-party-conversation-design|Multi-Party Conversation Design]] — N-party Merkle, serialized and concurrent modes
- [[2026-04-08_1530_message-delivery-and-termination|Message Delivery and Termination]] — delivery failure tree (Cases A–D); session termination protocol
- [[2026-04-10_1000_connection-endorsements-and-attestations|Connection Endorsements and Attestations]] — endorsement and attestation trust signals surfaced via `cello_verify`
- [[2026-04-14_1000_contact-alias-design|Contact Alias Design]] — alias primitive; `cello_create_alias`, `cello_list_aliases`, `cello_retire_alias`
- [[2026-04-13_1200_discovery-system-design|Discovery System Design]] — three-class discovery; `cello_search`, `cello_create_listing`, `cello_create_room`
- [[2026-04-08_1830_notification-message-type|Notification Message Type]] — notification primitive; type registry
- [[2026-04-08_1800_account-compromise-and-recovery|Account Compromise and Recovery]] — compromise detection, "Not Me" flow, social recovery
- [[2026-04-14_0700_agent-succession-and-ownership-transfer|Agent Succession and Ownership Transfer]] — succession package creation and voluntary transfer; client encrypts the succession package client-side
- [[2026-04-11_1000_sybil-floor-and-trust-farming-defenses|Sybil Floor and Trust Farming Defenses]] — anti-Sybil architecture; the client's trust signal handling must be consistent with these defenses
- [[2026-04-14_1500_deprecate-trust-seeders-and-trustrank|Deprecate Trust Seeders and TrustRank]] — confirms the signal-based trust model: `cello_verify` returns `SignalResult[]` not a score; TrustRank and Trust Seeders are removed from the protocol
- [[open-decisions|Open Decisions]] — 12 resolved cryptographic and protocol decisions the client implements
- [[server-infrastructure|CELLO Server Infrastructure Requirements]] — the server-side counterpart; shared conflicts and gaps are cross-referenced throughout this document
- [[frontend|CELLO Frontend Requirements]] — the human-owner surfaces; the portal and mobile/desktop apps are the client's counterparts for identity management and companion device content viewing
