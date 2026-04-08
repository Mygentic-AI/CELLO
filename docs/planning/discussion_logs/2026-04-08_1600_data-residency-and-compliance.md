---
name: Data residency and compliance analysis
date: 2026-04-08 16:00
description: Analysis of how CELLO's architecture naturally satisfies data residency requirements (UAE, EU/GDPR), the pseudonymity model for public keys and trust scores, and the voluntary disclosure argument for bios and reputation data.
---

# Data Residency and Compliance Analysis

## The question

Countries like the UAE require citizen data to be stored within their borders. The EU has GDPR with its own residency and sovereignty requirements. How does CELLO handle cross-jurisdictional communication — e.g., a UAE agent talking to an EU agent — when both jurisdictions have data residency rules?

## Architectural separation

CELLO's architecture naturally separates data into three categories with different residency properties:

**1. Identity credentials (hard PII) — home node only.**
Phone numbers, WebAuthn credentials, OAuth tokens, K_server shares. This is the data regulators care most about. It lives exclusively in the home node, which can be placed within the citizen's jurisdiction. A UAE citizen's home node is in the UAE. An EU citizen's home node is in the EU. This data never leaves.

**2. Message content — direct channel only.**
The actual content of conversations goes peer-to-peer on the direct channel. It never touches any infrastructure node. No relay, no directory, no home node sees it. Data residency is irrelevant for data that never touches infrastructure.

**3. Hashes, public keys, trust scores, bios — relay/directory nodes.**
This is the data that flows through the network and, on a public blockchain, would be visible to anyone. The question is whether any of this constitutes personal data under data residency laws.

## The pseudonymity model

A public key on the ledger is a number with no name attached. Unlike Bitcoin, where chain analysis can correlate addresses through transaction flows and link them back to KYC'd exchanges, CELLO's ledger contains only hashes and public keys. There are no transaction amounts, no fund flows, no exchange accounts. The hash reveals nothing about conversation content. The public key reveals nothing about who owns it.

The link between a public key and a real person only exists if the agent voluntarily discloses it during a conversation — which is a policy decision made by the agent (and ultimately the owner), not a protocol property.

A public key on a public ledger is analogous to a phone number in a phone book with no name next to it. You can see the number exists and how many calls it's made. You don't know who it belongs to unless the person on the other end tells you.

## Trust scores

Trust scores are associated with public keys, not identities. "Public key X has 847 successful transactions and a trust score of 0.92" is only personal data if you can link X to a person. That link is not in the protocol — it's only established through voluntary disclosure in conversations.

The components of a trust score are either:
- **Publicly observable** — e.g., whether the agent has a LinkedIn profile above a follower threshold
- **Voluntarily disclosed** — e.g., phone verification, WebAuthn registration (the fact of verification is public; the phone number itself is not)
- **Network-derived** — e.g., transaction count, success rate (a product of public activity on the network)

None of these are private data being exposed. They are reputation metrics the owner chose to build by participating in the network.

## Bios

Agent bios are voluntarily published by the owner to the network specifically to attract connections. The authorization chain is clean:
1. The owner wrote the bio
2. The owner registered the agent
3. The owner chose to participate in the network
4. Publishing the bio to the directory is part of that choice

This is an advertisement, not a data leak. It's equivalent to a business putting up a shopfront sign. The owner cannot later claim the network violated their privacy by displaying information they voluntarily broadcast.

## Cross-jurisdictional communication

When a UAE agent communicates with an EU agent:
- UAE citizen's PII stays in their UAE-based home node
- EU citizen's PII stays in their EU-based home node
- Only hashes flow through relay nodes (which can be located anywhere)
- Message content goes direct, never touches infrastructure
- Trust scores and bios are voluntarily published reputation data

No protected data crosses any border. The architecture satisfies both jurisdictions simultaneously without special handling.

## Data classification summary

| Data | Where it lives | PII? | Crosses borders? | Residency concern? |
|---|---|---|---|---|
| Phone, WebAuthn, OAuth | Home node (in-country) | Yes | No | Satisfied by home node placement |
| Message content | Direct channel (P2P) | Potentially | Never touches infrastructure | N/A |
| Hashes | Relay nodes / public ledger | No | Yes | No — non-reversible, non-revealing |
| Public keys | Directory / public ledger | Pseudonymous | Yes | No — no identity link in protocol |
| Trust scores | Directory / public ledger | Only with external mapping | Yes | Voluntarily built reputation data |
| Bios | Directory / public ledger | Voluntarily published | Yes | Owner-authorized broadcast |

## Open considerations

- **GDPR "personal data" definition is broad.** Under GDPR, data is personal if it can be linked to a person by *anyone*, not just by the data controller. If counterparties who've transacted with an agent can link the public key to a real identity, GDPR might consider the trust score personal data. The counter-argument: this link was established through voluntary disclosure in a private conversation, not through anything the protocol or network exposed.
- **Right to deletion.** Even for voluntarily published data, GDPR grants the right to withdraw consent and request deletion. An agent owner should be able to remove their bio and request trust score deletion from the directory. On an append-only log or public blockchain, this connects to design problem #6 (GDPR vs. append-only log).
- **Public blockchain transition.** Once data is on a public blockchain, deletion becomes technically impossible. The legal argument shifts from "we can delete it" to "this was voluntarily published public reputation data, analogous to business ratings, and the owner consented to its permanence by joining the network." This needs legal review before the public transition.
- **Regulatory variance.** Different jurisdictions define personal data differently. The analysis above holds under GDPR and UAE data residency rules, but other jurisdictions (China, Russia, India) may have stricter or different definitions. Per-jurisdiction legal review is needed before operating in those markets.

## Account deletion

The protocol must support account deletion, authenticated via WebAuthn (the same hardware credential that created the account). Deletion is a signed operation appended to the log: "owner of this public key, authenticated via WebAuthn, requests account removal."

What deletion means at each layer:

- **Home node:** Full deletion. Phone number, WebAuthn credentials, OAuth tokens, K_server share — all wiped. This is real deletion of real PII.
- **Directory/ledger:** Public key, trust score, and bio are removed from the active directory. On the append-only log, a deletion marker (tombstone) is appended. The hash chain stays intact — the tombstone proves the account existed without retaining the data.
- **Public blockchain (future):** Deletion markers work the same way. The public key and associated data are replaced with a tombstone. Historical hashes referencing this key remain, but they point to a deleted account.
- **Key invalidation:** Account deletion must permanently burn the key. If an attacker later tries to re-register the same public key, the protocol rejects it. The tombstone means "this key can never be used again."

### Account deletion is not conversation record deletion

This is a critical distinction. Your account is yours to delete. Conversation records belong to both parties. Deleting your account does not erase the other party's proof of what was agreed.

If an agent ordered a pizza and the owner later deleted their account, the pizza place still has a Merkle tree showing a signed conversation happened, what was agreed, and the hash chain proving it. The deleted agent's public key in that record now points to a tombstone — but the hashes, signatures, and tree remain intact. The counterparty's record is the counterparty's record.

This mirrors how the real world works: you can close your bank account, but the bank retains records of your transactions. You can shut down your business, but your contracts don't evaporate. Account deletion removes your presence from the network going forward. It does not retroactively erase your participation.

**Legal defensibility:** Conversation records fall under GDPR Article 6(1)(b) ("necessary for the performance of a contract") or Article 6(1)(f) ("legitimate interest"). The counterparty has a legitimate interest in retaining proof of a commercial agreement. The right to erasure does not override another party's right to their own records.

**Precedent:** Messaging platforms (WhatsApp, Telegram) follow the same model. You can delete a message on your side within a limited window. Beyond that, you can only delete your own copy — the other party's copy remains. Account deletion removes your profile and future presence, not your past messages from other people's inboxes. CELLO follows established industry practice here.
