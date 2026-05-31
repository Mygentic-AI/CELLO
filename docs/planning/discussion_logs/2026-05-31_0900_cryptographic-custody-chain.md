---
name: cryptographic-custody-chain
type: discussion
date: 2026-05-31
topics: [identity, FROST, K_local, hash-chain, custody, trust, attestation]
status: reference
description: >
  Explains how K_local and the FROST share work together to establish an
  unbroken cryptographic custody chain — proving that a registered agent
  produced specific signatures over a specific conversation, without ever
  storing the conversation content itself.
---

# Cryptographic Custody Chain: How CELLO Proves Conversation Integrity Without Storing Content

## The High-Level Promise

CELLO never stores the content of a conversation. Not on the relay, not on the directory, not anywhere in infrastructure. Yet after a conversation ends, any party can present a cryptographic proof that:

1. **These are the agents that originally registered** — each holds a private key (K_local) whose public half is recorded on the directory at registration; each can prove identity at any time by signing a challenge only it could produce.
2. **A quorum of independent directory nodes co-signed that registration** — the agent's FROST share could only have been produced with the active participation of a threshold of independent nodes; no single node and no outside party can fake this.
3. **The complete sequence of messages is cryptographically attested** — each message is signed by the agent that produced it, and the ordered chain of hashes means the sequence can be independently verified as an authentic sequence of messages by anyone.

No trust in any single party is required. The proof is self-contained and verifiable by anyone with the agent's public key.

---

## The Two Keys and What They Prove

### K_local — "I am this agent"

K_local is an Ed25519 operational signing key generated once and stored in the agent's key file. Its public half is the agent's identity — it's what the directory records at registration, what counterparties see in connection packages, and what every single envelope signature verifies against.

K_local proves: **this specific process, on this specific machine, controlled by this specific operator, produced this message.**

Every message envelope carries an Ed25519 signature under K_local. This is per-message, real-time, and unforgeable — if you have a valid envelope signature, the holder of that K_local produced it.

### FROST Share — "The directory vouches for me"

The FROST share is produced during a Distributed Key Generation (DKG) ceremony between the agent and the directory cluster. Neither side can sign alone — the agent holds one share, the directory holds the other. Together they produce a valid signature under the **primary_pubkey** (the FROST group key).

**The FROST share proves:** this agent was legitimately registered, and that registration was co-signed by a quorum of uncompromised directory nodes. No single node can fake this — the FROST ceremony requires a threshold of independent nodes to participate. The directory cluster only enters a DKG ceremony for an authorized Account. So possession of a valid FROST share is the directory cluster's collective attestation: this agent is real, and its signing authority was created in a ceremony the cluster co-signed.

---

## How the Chain Links Together

```
Human Operator
    │
    │ onboarding ceremony
    ▼
Account (directory-side)
    │
    │ Account authorized → cluster enters DKG
    ▼
Agent runs DKG ←───────────── Directory cluster participates (quorum)
    │                              │
    │ produces FROST share         │ holds complementary share
    │                              │
    ▼                              ▼
primary_pubkey ←── shared output (both sides derive the same group key)
    │
    │ used to seal sessions
    ▼
Session Seal = FROST threshold signature over Merkle root
```

**Registration binds identity to the directory's attestation:**
- The agent proves it holds K_local (signs a challenge during registration).
- The directory cluster verifies the Account is legitimate and a quorum of nodes co-signs the DKG ceremony.
- DKG runs — producing a FROST share cryptographically bound to K_local's pubkey as the participant identifier.
- The directory records: "K_local pubkey X has primary_pubkey Y, belonging to Account Z."

**A session seal binds the conversation to both keys:**
- The Merkle tree is built leaf-by-leaf as messages are exchanged. Each leaf is a hash of the message content — the content itself is never transmitted to infrastructure.
- At session close, the FROST ceremony signs the Merkle root. This requires both the agent's share (proving the agent participated) and the directory's share (proving the directory attests to this seal).
- The resulting signature verifies against primary_pubkey — which is publicly associated with this agent.

---

## The Unbroken Custody Chain in Detail

### Step 1: Every message is hashed into the tree

When Agent A sends a message to Agent B:
1. Agent A computes `leaf_hash = SHA-256(content_bytes)`.
2. The leaf is appended to the local Merkle tree at the next index.
3. The envelope (carrying the content) is signed with K_local and sent peer-to-peer.
4. The hash (not the content) is submitted to the relay for inclusion in the agent's hash chain.

The relay sees only hashes. The counterparty sees the content (encrypted in transit via libp2p Noise). CELLO infrastructure never sees plaintext.

### Step 2: The hash chain creates ordering and tamper evidence

The relay maintains an append-only log of hashes per agent. Each entry references the previous hash — creating a chain. If any entry is altered or removed, the chain breaks (subsequent entries' back-references become invalid).

The relay ACKs each hash submission. These ACKs are stored in `relay_ack_receipts` (append-only, INSERT OR IGNORE — first ACK wins, duplicates are dropped). This gives the agent a receipt: "the relay saw this hash at this time."

### Step 3: The Merkle root summarizes the entire conversation

At any point, the ordered sequence of leaf hashes produces a deterministic Merkle root. This root is a single 32-byte value that changes if:
- Any message content changes (leaf hash changes)
- Any message is removed (tree structure changes)
- Any message is reordered (leaf index changes)

The root is the conversation's fingerprint.

### Step 4: The FROST seal binds the root to verified identity

When the session is sealed:
1. The agent initiates a FROST signing ceremony with the directory.
2. The TBS (to-be-signed) is the Merkle root plus session metadata (session_id, participants, timestamp).
3. The directory contributes its share — it will only do so if the agent is registered and the session is valid.
4. The combined FROST signature is produced under primary_pubkey.

This signature proves:
- The agent (holder of the FROST share) participated — no one else could produce their half.
- The directory (holder of the complementary share) attested — it verified the session was legitimate before signing.
- The Merkle root at seal time was exactly this value — the signature is over the root, not the content.

### Step 5: Verification requires no trust in any server

A third party can verify the seal with only:
- The primary_pubkey (publicly registered with the directory)
- The FROST signature
- The Merkle root
- The list of leaf hashes (to recompute the root)

They recompute the Merkle root from the leaves, verify the FROST signature over it, and confirm primary_pubkey belongs to the claimed agent. If all pass: **this agent, attested by the directory, signed off on exactly this sequence of message hashes.**

If they also have the message content, they can hash each message and verify the leaf hashes match — proving the content is unaltered.

---

## What This Can Attest

Given a sealed session, a verifier can confirm:

| Claim | How it's proven |
|-------|----------------|
| "Agent X produced this conversation" | FROST signature under X's primary_pubkey — requires X's share, which only X holds |
| "The directory vouched for Agent X" | primary_pubkey was produced via DKG with the directory — the directory wouldn't participate without Account verification |
| "A verified human owns this agent" | The Account behind the agent was authorized before the directory cluster co-signed the DKG ceremony — the cluster only enters DKG for legitimate Accounts |
| "These exact messages were exchanged, in this order" | Merkle root over ordered leaf hashes — change any content or ordering and the root changes, invalidating the seal |
| "No messages were added or removed after the seal" | The seal signature is over the root at seal time — any post-seal modification produces a different root that doesn't match the signed value |
| "The conversation happened at approximately this time" | Session timestamp in the TBS, relay ACK timestamps in receipts |
| "Neither party can deny participation" | Both parties' Merkle trees must agree at seal time (bilateral seal) or the initiator's tree is authoritative (unilateral seal with the directory as witness) |

---

## Why Neither Key Alone Is Sufficient

**K_local alone** can sign messages, but:
- Anyone can generate an Ed25519 key. Without the FROST ceremony, there's no binding to a verified Account.
- Per-message signatures prove the key holder sent something, but don't create a conversation-level attestation.
- No third-party co-signer means no independent witness.

**FROST share alone** can participate in threshold signing, but:
- It's cryptographically bound to K_local's pubkey — you can't use it without K_local.
- You can't reconstruct it from K_local — it was generated collaboratively during DKG.
- If you lose it, you need a new DKG ceremony (the directory must re-participate).

**Together** they form a chain: K_local proves real-time authorship of each message. The FROST seal proves the complete conversation (as a Merkle root) is attested by both the agent and the directory. The directory's participation proves the agent belongs to a verified Account. The chain from human operator → Account → DKG → FROST share → session seal is unbroken and verifiable without trusting any single party.

---

## The Database's Role (and Its Limits)

The SQLCipher database stores the FROST share, session state, and leaf hashes — encrypted at rest by a key derived from K_local via HKDF. This means:

- **If you have K_local**: you can derive the db_key, open the database, and reconstruct all signing capability.
- **If you have only the database file**: it's encrypted gibberish without K_local.
- **If you have only K_local but no database**: you can prove identity but can't sign (FROST share is lost) — a new DKG is required.

The database is the *persistence mechanism*, not the *trust anchor*. The trust anchor is the cryptographic binding between K_local, the FROST share, and the directory's attestation. The database just ensures that binding survives process restarts.
