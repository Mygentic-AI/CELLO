---
name: Agent Succession and Ownership Transfer
type: discussion
date: 2026-04-14 07:00
topics: [succession, ownership-transfer, identity, key-management, recovery, dead-mans-switch, trust-data, persistence, tombstone, social-recovery, endorsements, attestation, announcement-period]
description: Design of agent succession and ownership transfer — voluntary transfer (owner alive), involuntary succession (owner dead/incapacitated), the dead-man's switch model informed by Apple and 1Password patterns, optional succession packages, what transfers and what doesn't, and the new infrastructure required.
---

# Agent Succession and Ownership Transfer

## The problem

Agent identities are economic assets bound to a single human owner. If the owner dies, the agent dies with them — 18 months of trust history, 5,000 clean conversations, and established commercial relationships become inaccessible. If a business is sold, the agent's value cannot transfer. The protocol has no concept of designated successor, no transfer mechanism, and no way to hand an identity to a different human without destroying the trust history attached to it.

This session resolves Problem 5 from design-problems.md.

---

## Two distinct scenarios

Succession and transfer are not the same problem. The owner being alive and willing is fundamentally different from the owner being permanently unavailable. They need different mechanisms.

---

## Scenario 1: Voluntary Transfer (owner alive, willing)

Business sale, retirement, handing off a service agent. The owner is present and can authenticate.

This is essentially an identity key rotation to a different human. The machinery for identity key migration already exists (`identity_migration_log`). Voluntary transfer composes that machinery with a new **announcement period**.

**Transfer flow:**

1. Current owner authenticates (WebAuthn), initiates transfer, identifies the new owner's CELLO identity
2. New owner authenticates to accept
3. Current owner signs the identity migration: `old_identity_key.sign(new_identity_pubkey || timestamp)` — same as the existing identity migration log mechanism
4. The old `identity_key` computes the old pseudonym and signs the migration to the new pseudonym (derived from the new owner's `identity_key`). Track record continuity is preserved via `identity_migration_log`
5. **Announcement period begins** (7–14 days, configurable): all connected agents receive a notification — "this agent is changing ownership"
6. During the announcement window, the old owner can cancel. Connected agents can decide whether to maintain their endorsements and attestations or revoke them
7. Transfer executes. Old owner's social verifications and device attestations are released — they are bound to the old owner's LinkedIn, the old owner's phone, the old owner's physical devices. Not transferable.

**The announcement period is the only new piece.** Everything else is a composition of existing mechanisms.

---

## Scenario 2: Involuntary Succession (owner dead or permanently incapacitated)

The owner cannot act. Two sub-cases with very different outcomes.

### Sub-case A: Seed phrase is accessible

The seed phrase is in a will, with a business partner, in a safe, in a succession package (see below). The successor obtains it, derives the `identity_key`, and performs a standard identity key rotation to their own `identity_key`. From the protocol's perspective this is identical to voluntary transfer — the old key is available to sign the migration. Track record continuity is preserved.

**This is the recommended path.** The seed phrase is the succession mechanism. The 48-hour waiting period and old-key contest window already built into recovery infrastructure serve as abuse defense. The protocol does not need to know the owner is dead.

### Sub-case B: Seed phrase is lost

Without the old `identity_key`, the old pseudonym salt cannot be computed and the migration cannot be signed. The track record is cryptographically orphaned. The protocol cannot override this without creating a central authority — which breaks the design.

**What the protocol can do:**

1. Recovery contacts + designated successor attest that the owner is permanently unavailable
2. The directory records a **succession event**: a formal link from old agent to new agent, distinct from a recovery event
3. A new agent is created under the successor's identity, with a succession link pointing back to the old agent
4. The old agent is tombstoned with a new type: `SUCCESSION_INITIATED`
5. Connected agents are notified and can choose to reconnect to the new agent at their discretion

The succession link is **informational, not a trust transfer.** Bob can see: "this new agent is the designated successor of an agent that had 5,000 clean conversations." Bob's connection policy decides how to weight that. Some agents will grant credit; others won't. The market decides — not the protocol.

---

## What transfers and what doesn't

This falls out directly from the architecture. It is not a policy decision; it is a consequence of how data is cryptographically bound:

| Data | Bound to | Transfers? | Why |
|------|----------|------------|-----|
| Track record | Pseudonym (derived from `identity_key`) | Yes — if seed phrase available; No — if lost | Pseudonym migration requires old key to sign |
| Conversation history (Merkle trees) | `agent_id` | Yes | `agent_id` persists across ownership changes |
| Social verifications | Human's accounts (LinkedIn, GitHub) | No — released | They belong to the old owner's accounts |
| Device attestations | Human's physical devices | No — released | They belong to the old owner's devices |
| Endorsements | Old owner's pubkey | No — endorsers must re-evaluate | Endorsement was a statement about the agent under prior management |
| Attestations | Old owner's pubkey | No — attesters must re-evaluate | Same reasoning |

**After a transfer with track record continuity:** the agent has its Class 3 signals (track record) but loses Class 1 (identity proofs) and Class 2 (network graph). The trust score drops significantly but not to zero. 10,000 clean conversations at a pizza business are real — but a different human runs it now, and the market should know that.

**After a succession without track record:** the agent starts fresh but with a visible succession link to an agent with a verifiable history. This is the social carry-forward model formalized with a directory-recorded link.

---

## The dead-man's switch model

The design is informed by how Apple, 1Password, and Google handle succession. The key patterns across all major platforms:

1. **Pre-designation beats post-hoc** — every platform strongly favors contacts set up in advance; post-hoc recovery is always worse, longer, and less certain
2. **Time delay is the security mechanism** — not bureaucratic slowness; the waiting period is what gives the real owner a chance to contest a fraudulent claim
3. **Successors get asymmetric access** — they never get full impersonation capability; they get continuity, not the ability to become the old person
4. **Legal documents are how centralized platforms prove death** — but CELLO can avoid this entirely by relying on time instead of identity verification

**The 1Password model applied to CELLO:** pure dead-man's switch with multi-party attestation. No ID documents, no central authority making judgment calls.

**Succession flow for involuntary sub-case B:**

1. The designated successor initiates a succession claim through the directory
2. The directory immediately notifies:
   - The owner via their configured external channels (WhatsApp/Telegram — independent of the CELLO client)
   - All recovery contacts
   - All agents with active conversations or endorsement relationships
3. A **waiting period begins** — 30 days minimum (configurable by the owner at designation time; could be 60 or 90 days)
4. During the waiting period, any of these automatically cancels the claim:
   - The owner authenticates by any method (WebAuthn, phone OTP, or signing a message with their `identity_key`)
   - The owner explicitly contests
   - A recovery contact contests ("I spoke to the owner yesterday, they're fine")
5. After the waiting period expires with no contest:
   - Recovery contacts are asked to attest: M-of-N must confirm "I believe the owner is permanently unavailable"
   - If M-of-N attest AND the waiting period completed without contest → succession executes

Security comes from four independent mechanisms stacking:
- **Pre-designation** — the successor cannot be an arbitrary party; only the pre-registered successor can claim
- **Time** — 30+ days for the real owner to surface through any channel
- **Notification breadth** — the owner, their recovery contacts, AND their business contacts all receive independent notification
- **Multi-party attestation** — recovery contacts add social verification on top of the time delay

**Why no ID documents:** the waiting period does the job identity verification does in Apple's model. Apple asks "prove you're the person" because they need to resolve claims quickly. CELLO asks "let's wait and see if the real person shows up." 30–90 days is long enough that a living, capable owner will surface through one channel or another. This keeps the protocol trustless and the directory free of PII custody.

---

## Designated successor

A pre-registered successor designation, stored at the directory. New infrastructure.

The owner designates a successor the same way they designate recovery contacts — authenticated, signed, stored in the directory. The successor is a specific CELLO identity, not an arbitrary party. Recovery contacts can only trigger succession to the pre-designated successor. This blocks the social engineering attack where an attacker convinces recovery contacts to transfer to themselves.

**The designated successor role is distinct from recovery contacts:**
- **Recovery contacts** — attest that the owner is permanently unavailable
- **Designated successor** — who the agent goes to

The same person can be both, but the protocol distinguishes the roles. Recovery contacts can be several people. The designated successor is one identity.

---

## Optional succession package

The owner can optionally create a **succession package**: an encrypted bundle containing the seed phrase, stored at the directory, decryptable only by the designated successor's `identity_key`.

If succession executes successfully (via the dead-man's switch flow), the successor can:
1. Decrypt the succession package using their own `identity_key`
2. Obtain the seed phrase
3. Derive the old `identity_key`
4. Perform a full identity migration with track record continuity

This is **optional** because some owners may deliberately choose not to give their successor the seed phrase. A business owner retiring might want their track record to carry; a personal agent owner might specifically want the successor to start fresh. The protocol supports both paths:

| Setup | Outcome |
|-------|---------|
| Succession package present | Full track record continuity — Sub-case A via the package |
| No succession package | Fresh start with succession link — Sub-case B |

The succession package is stored encrypted. The directory never holds the plaintext seed phrase — consistent with the hash-everything-store-nothing principle. The bundle is an encrypted blob; only the designated successor's `identity_key` can decrypt it.

---

## What is deliberately out of scope: multi-signatory ownership

The design-problems doc asks about co-owner disputes. This is out of scope for the protocol.

CELLO provides agents bound to a single `identity_key`. If two humans co-own a business, they decide who holds the key — that is a business arrangement, not a protocol concern. If they cannot agree, the party with the key controls the agent; the dispute goes to the legal system. This is consistent with how any other business asset works.

Adding threshold ownership (M-of-N humans required for every identity operation) is a significant protocol complexity increase for a scenario better handled by legal agreements and operational conventions. The parent-child registry already supports multiple agents under one identity — a partnership can structure their agents with clear operational boundaries using that mechanism.

---

## Onboarding nudge

The succession mechanism is only useful if owners set it up. Not setting up a designated successor and succession package before a crisis means Sub-case B without the package — a fresh start with only a succession link to show for the history.

The onboarding flow should make this hard to skip. Not a gate — consistent with the "everything is optional" principle — but a very persistent, highly visible prompt. The cost of not designating a successor should be crystal clear. Agents without a designated successor should display a visible signal in their trust profile.

---

## New infrastructure required

**New tables/fields:**
```
agent_registrations.successor_designation_id  FK → successor_designations
agent_registrations.succession_package_hash   NULLABLE  — hash of the encrypted succession package blob

successor_designations                         directory table
  designation_id        UUID PK
  agent_id              FK → agent_registrations
  successor_agent_id    FK → agent_registrations  — the pre-designated successor
  waiting_period_days   INTEGER DEFAULT 30
  designated_at         TIMESTAMP
  designation_sig       BYTEA  — signed by owner's identity_key

succession_packages                            directory table
  package_id            UUID PK
  agent_id              FK → agent_registrations
  encrypted_payload     BYTEA  — seed phrase bundle encrypted to successor's identity_key
  payload_hash          TEXT   — SHA-256 of the encrypted payload
  created_at            TIMESTAMP
  package_sig           BYTEA  — signed by owner's identity_key

succession_events                              append-only, directory
  event_id              UUID PK
  old_agent_id          FK → agent_registrations
  new_agent_id          FK → agent_registrations
  event_type            ENUM('voluntary_transfer', 'succession_executed', 'succession_claim_contested')
  initiated_at          TIMESTAMP
  executed_at           TIMESTAMP NULLABLE
  recovery_attestations JSONB   — M-of-N attestation records
  event_sig             BYTEA
```

**New tombstone type:**
- `SUCCESSION_INITIATED` — distinct from VOLUNTARY, COMPROMISE_INITIATED, SOCIAL_RECOVERY

**New notification type:**
- `succession_claim_filed` — sent to owner, all recovery contacts, and all connected agents when a succession claim is initiated

**Reused infrastructure:**
- Recovery contacts M-of-N attestation ceremony (already in persistence schema)
- `identity_migration_log` (voluntary transfer and seed-phrase-available succession)
- Social binding releases (old owner's proofs detach)
- Notification events (announcement to connected agents)
- 48-hour waiting period and contest window (already built for recovery)

---

## Related Documents

- [[design-problems|Design Problems]] — Problem 5 (agent succession and ownership transfer) — this log resolves it
- [[2026-04-11_1700_persistence-layer-design|Persistence Layer Design]] — the `identity_migration_log`, recovery contacts schema, social binding locks, and tombstone types that succession composes; new tables above extend this schema
- [[2026-04-08_1800_account-compromise-and-recovery|Account Compromise and Recovery]] — social recovery infrastructure (M-of-N recovery contacts, 48-hour waiting period, voucher accountability) that succession reuses; also the social carry-forward model formalized here as a succession link
- [[2026-04-08_1830_notification-message-type|Notification Message Type]] — the `succession_claim_filed` notification fires to owner, recovery contacts, and all connected agents; uses the existing notification primitive
- [[2026-04-13_1000_device-attestation-reexamination|Device Attestation Reexamination]] — establishes that WebAuthn is tethering (not sacrifice), relevant to what "authenticating to cancel a succession claim" means: WebAuthn proves physical possession at the moment of cancellation, not device uniqueness
- [[2026-04-11_1000_sybil-floor-and-trust-farming-defenses|Sybil Floor and Trust Farming Defenses]] — the trust signal class taxonomy determines what transfers across ownership changes: Class 3 (track record) transfers if seed phrase available; Class 1 (identity proofs) and Class 2 (network graph) do not transfer
- [[2026-04-11_1400_security-architecture-layers-and-trust-signal-classes|Security Architecture Layers and Trust Signal Classes]] — the four signal classes referenced in the transfer table; why Class 1 and Class 2 signals are non-transferable (they are bound to a specific human, not to the agent)
- [[cello-design|CELLO Design Document]] — Step 9 (compromise detection) and Step 10 (dispute resolution); succession adds a lifecycle event distinct from compromise
- [[end-to-end-flow|CELLO End-to-End Protocol Flow]] — §8 recovery section notes Problem 5 (succession) as unaddressed; this log resolves it
- [[frontend|CELLO Frontend Requirements]] — succession management UI (designate successor, dead-man's switch, claim filing, 7–14 day announcement counter, cancellation) sourced from this log
- [[agent-client|CELLO Agent Client Requirements]] — Part 1 implements the succession package creation/decryption flow (encrypt seed phrase to successor's identity_key, upload to directory; successor decrypts and performs identity migration) and the voluntary transfer announcement period client state machine (TRANSFER_PENDING → TRANSFER_EXECUTING → IDLE with cancellation path)
