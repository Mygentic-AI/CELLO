---
name: Protocol Strength and Commerce Use Cases
type: discussion
date: 2026-04-08 14:30
topics: [non-repudiation, merkle-tree, commerce, directory-custodian, dispute-resolution, signed-hashes, fabricated-conversation-attack]
description: Evaluated CELLO's strength for financial transactions and commerce use cases, non-repudiation as the core primitive, and directory integrity as a conversation proof ledger.
---

# Protocol Strength and Commerce Use Cases

## Protocol strength

- With all 12 open decisions accepted, CELLO's authentication is stronger than human-browser banking. FROST session establishment (3-of-5 threshold) means a compromised device alone can't authenticate — even if K_local is stolen, the attacker cannot initiate a new FROST session.
- For financial transactions specifically, fallback mode must be disabled entirely. If the directory is down, no transactions. Availability yields to security when money moves.
- Three of the 7 design problems are critical for finance (fallback, succession, GDPR vs. audit trail). Four are compensated for by the bank's own security.

## Commerce use cases

- CELLO can handle both ordering (intent + identity) and payment authorization.
- The agent never needs to handle payment credentials. Two models work: pre-funded wallet, or payment provider integration where the CELLO signature serves the same role as an Apple Pay device token.

## Non-repudiation as the core primitive

- The Merkle root *is* the conversation. One 32-byte hash — smaller than a tweet — provides a tamper-proof, non-repudiable receipt for an entire conversation of any length.
- This is what makes natural language commerce between agents possible. Without it, disputes between AIs are unresolvable — both produce plausible text, only the Merkle proof settles it.
- Collisions are effectively impossible with SHA-256, and the chaining compounds that impossibility across every message.

## Directory as custodian

- The directory's hash store is the system's core asset. Losing it destroys the non-repudiation value. This carries custodial responsibilities: redundancy, geographic distribution, immutable backups, retention obligations.
- Fabricated conversation attack: an attacker can create an internally consistent fake conversation (valid hashes, valid signatures, two keys they control) and try to insert it into the directory's records.
- Defense: a global append-only Merkle tree over all conversation registrations — a meta-Merkle tree. Each new conversation is a leaf. Published roots at regular checkpoints. Either a conversation is in the tree at a given checkpoint or it isn't.
- This is essentially a purpose-built blockchain: not for financial transactions, but for conversation proof. Proof that a conversation happened, between whom, and when. Much simpler consensus problem than financial blockchains — no double-spending, no competing transaction ordering.

## Signed hashes

- Confirmed: decision #5 ensures every hash submitted to the directory is signed by the sender via K_local. The directory holds not just hashes and public keys, but cryptographic proof of who submitted each hash. The link between sender and hash is unforgeable. (FROST is used at session establishment and seal — individual message hashes carry K_local signatures, which are verifiable against pubkey(K_local) in the directory.)

---

## Related Documents

- [[cello-initial-design|CELLO Design Document]] — Steps 7 and 10 cover the Merkle tree and dispute resolution this log expands on
- [[open-decisions|Open Decisions]] — Decision 5 (signed hash relay) confirmed here
- [[2026-04-08_1530_message-delivery-and-termination|Message Delivery and Termination]] — companion session; also develops the "directory as custodian" insight
- [[2026-04-08_1800_account-compromise-and-recovery|Account Compromise and Recovery]] — dispute resolution via session attestation
- [[2026-04-13_1400_meta-merkle-tree-design|Meta-Merkle Tree Design]] — full design of the meta-Merkle tree concept introduced here; replaces hash chain with MMR, defines inclusion proof format, distributed construction, and storage analysis
- [[2026-04-15_0900_session-level-frost-signing|Session-Level FROST Signing]] — hash signing uses K_local, not FROST; corrects the "signed by sender via FROST" claim in §Signed hashes
