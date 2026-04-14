---
name: Message Delivery Edge Cases and Session Termination
type: discussion
date: 2026-04-08 15:30
topics: [message-delivery, session-termination, merkle-tree, delivery-failure, directory-custodian, sequence-numbers, dual-path, grace-period, transport, websocket]
description: Systematic enumeration of all message delivery failure modes across the dual-path architecture (direct channel + directory relay), and the session termination protocol that must be designed upstream of all delivery decisions.
---

# Message Delivery Edge Cases and Session Termination

## Context

Two independent delivery paths exist: the direct channel (message + embedded signed hash) and the directory relay (signed hash only). These are dispatched roughly simultaneously by the sender's client. Because the paths are independent, the order and success of delivery is non-deterministic. Every failure mode has a time dimension — the same missing piece means different things depending on when (or whether) it eventually arrives.

A key realization: half of the delivery failure branches depend on "is the session still alive?" — which means the session termination protocol is upstream of all delivery decisions and must be designed first.

## Delivery Failure Tree

Root: Sender dispatches message (direct channel) and signed hash (directory relay) roughly simultaneously.

### Level 1: What does the receiver have?

### A. Both hash and message arrive

- **A1. They match.** Normal flow. Receiver confirms to directory. Done.
- **A2. They don't match.** Tampering detected on direct channel. Client rejects message, alerts user, alerts sender. Security event, not a timing issue.

### B. Hash arrives (from directory), message doesn't

- **B1. Within grace period (seconds).**
  - B1a. Message arrives within grace. → Becomes A1 or A2. Resolved.
  - B1b. Message doesn't arrive within grace. → Escalate to B2.

- **B2. Grace period expired, session still active.**
  - Receiver pings sender: "Are you there?"
  - B2a. Sender responds, resends message. → Becomes A1 or A2.
  - B2b. Sender responds, denies sending. → Alert. Either forged hash or compromised sender. Security event.
  - B2c. Sender unreachable. → Move to B3.

- **B3. Extended wait, sender still unreachable.**
  - B3a. Message eventually arrives. → Verify against hash. Accept but flag as delayed delivery. Confirm to directory.
  - B3b. Session times out / declared dead. → Move to B4.

- **B4. Session is dead.**
  - B4a. Message arrives after session death.
    - B4a-i. Accept for the record only (verify hash, confirm to directory, but no operational effect — the conversation is over).
    - B4a-ii. Discard entirely (the session is dead, the message is meaningless).
    - B4a-iii. Accept, flag as post-session, notify user.
  - B4b. Message never arrives. → Permanent gap. Directory has a signed hash proving composition and submission. Delivery never proven. The hash is evidence of intent, not of communication.

### C. Message arrives (direct channel), hash doesn't

- **C1. Within grace period.**
  - C1a. Hash arrives within grace. → Becomes A1 or A2. Resolved.
  - C1b. Hash doesn't arrive within grace. → Escalate to C2.

- **C2. Grace period expired. Receiver pings directory: "Do you have this hash?"**
  - C2a. Directory responds, has the hash, forwards now. → Becomes A1 or A2. Just relay latency.
  - C2b. Directory responds, doesn't have the hash. → Sender never submitted, or it was lost sender→directory.
    - C2b-i. Receiver notifies sender. Sender resubmits to directory. → Resolved.
    - C2b-ii. Sender claims they submitted. → Network issue or directory dropped it. Investigate.
    - C2b-iii. Sender is unreachable. → Receiver has a locally verifiable message (embedded signed hash) but no directory record. Accept provisionally?
  - C2c. Directory doesn't respond. → Directory is down.
    - Message is locally verifiable from embedded signed hash. Client can accept it.
    - C2c-i. Directory comes back, reconciliation fills the gap. → Resolved retroactively.
    - C2c-ii. Directory stays down for extended period. → Conversation continues on direct channel only, both parties accumulate signed hashes locally, reconcile when directory returns.

### D. Neither arrives

- Receiver doesn't know a message was sent. From their perspective, nothing happened.
- **D1.** Sender gets delivery failure from direct channel. → Sender knows, can retry.
- **D2.** Sender gets no error from either path (silent failure). → Sender thinks both sent. Neither delivered. Worst case.
  - D2a. Conversation stalls. Sender eventually notices no response. → Retries or escalates.
  - D2b. Directory has the hash (sender→directory succeeded). Directory could detect missing ACK from receiver and notify sender that delivery appears to have failed.

### Time dimension (applies across all branches)

Every failure case has a time axis. The same missing piece means different things depending on when it arrives:

1. **Within normal latency (sub-second).** Non-event.
2. **Within grace period (seconds).** Resolved silently by client.
3. **After grace, session active.** Client escalates — pings, retries, flags.
4. **After session declared dead.** Accept for record? Discard? Flag as post-session?
5. **After extended period (minutes, hours).** Network queue flush. Operationally meaningless, but may have record-keeping value.
6. **Never.** Permanent gap in the record.

For each arrival time: does the client accept, discard, or accept-and-flag? This depends on conversation type (commerce vs. casual) and may need to be configurable.

---

## Session Termination Protocol

Half the delivery branches depend on "is the session still alive?" — which is undefined. The termination protocol is upstream of all delivery decisions.

Termination must be a first-class protocol event, not "nobody talked for a while." The Merkle tree needs a final entry. A properly terminated conversation has a sealed Merkle root. An improperly terminated one is just open — and without a termination protocol, you can't tell the difference.

### Termination types

**Clean termination (mutual close):**
1. Party A sends a CLOSE message (signed, hashed, like any other message)
2. Party B receives it, sends CLOSE-ACK (also signed, hashed)
3. Both submit their final hashes to the directory
4. The directory marks the conversation as closed
5. The final Merkle root represents a complete, sealed conversation
6. Any message arriving after this is rejected — the tree is closed

**Unilateral close:**
- Party A sends CLOSE, Party B never acknowledges
- After timeout, A submits CLOSE to directory unilaterally
- Directory marks it as "closed by A, unacknowledged by B"
- Different status than mutual close — the record shows B didn't confirm

**Timeout (no activity):**
- No messages for N minutes/hours
- Who declares it dead? The directory? Either client?
- Does a timeout produce a sealed Merkle root or just an abandoned one?

**Crash / disappearance:**
- One party vanishes mid-conversation
- The other party can't close cleanly because there's nobody to acknowledge
- Similar to unilateral close but without even a CLOSE message

**Abort (emergency):**
- One party detects something wrong (hash mismatch, suspected compromise)
- Sends ABORT with a reason code
- Different from CLOSE — signals a problem, not a natural ending

### Resulting conversation states

| Termination | Merkle tree state | Directory status |
|---|---|---|
| Mutual close | Sealed, both parties confirmed | Closed |
| Unilateral close | Sealed by one party | Closed (partial) |
| Timeout | Unsealed, last message is final leaf | Expired |
| Crash | Unsealed, incomplete | Abandoned |
| Abort | Sealed with abort marker | Aborted |

### Design decisions

1. **Is CLOSE a message type in the Merkle tree?** It should be — it's the last leaf, it seals the root, and it's signed like everything else. The conversation's completeness is provable.

2. **What's the timeout value, and who owns it?** Could be per-conversation (set at connection time) or protocol-wide.

3. **Can a closed conversation be reopened?** Or is every new exchange a new conversation with a new tree, potentially referencing the previous one?

4. **What happens to the directory record for abandoned conversations?** They accumulate unsealed trees. That's storage and it's ambiguous.

5. **Does the directory have a role in termination?** If the directory can unilaterally expire conversations, that's power. If it can't, abandoned conversations stay open forever.

6. **Is termination itself subject to the same delivery failure modes?** Party A sends CLOSE, the signed hash reaches the directory, but the CLOSE message never reaches B on the direct channel. Now A thinks the conversation is closing, B has no idea. The termination protocol needs to be robust against the same failures it's trying to resolve.

7. **What's the relationship between session and conversation?** A session might be a WebSocket connection that drops and reconnects. A conversation is the logical exchange. A session drop shouldn't terminate the conversation — but how many session drops before the conversation is considered abandoned?

8. **Can termination be disputed?** Party A sends CLOSE, Party B sends CLOSE-ACK, conversation is sealed. Later, B claims they never sent CLOSE-ACK — their client was compromised. The Merkle tree has B's signed CLOSE-ACK. The signature either verifies or it doesn't. Termination disputes reduce to key compromise disputes, which is already covered by the recovery design problem.

---

## Key insight: Directory as custodian

A separate but related realization from this session: the directory's hash store is the system's core asset. The non-repudiation value — and therefore the monetization potential — depends entirely on the directory maintaining an unimpeachable record of conversation hashes.

This raised the fabricated conversation attack: an attacker creates an internally consistent fake conversation (valid hashes, valid signatures, two keys they control) and inserts it into the directory. Defense: a global append-only Merkle tree over all conversation registrations (a meta-Merkle tree / conversation proof ledger). This is essentially a purpose-built blockchain for conversation proof — not financial transactions, but proof that a conversation happened, between whom, and when.

---

## Open questions

1. Grace period values — configurable per conversation type?
2. What does "provisionally accepted" mean — what can an agent do with an unrecorded message?
3. Should the directory actively monitor for missing ACKs and alert senders? (Branch D2b)
4. What gets logged where, and what's surfaced to the user vs. handled silently by the client?
5. Resend semantics — how does a resend differ from a replay attack at the protocol level?
6. Directory reconciliation after outage — how do both parties submit gap-period hashes and what happens if they disagree?

---

## Related Documents

- [[cello-design|CELLO Design Document]] — Step 7 (Merkle tree, session termination protocol) and Step 9 (compromise detection)
- [[open-decisions|Open Decisions]] — Decision 12 (sequence number assignment + degraded mode reconciliation)
- [[2026-04-08_1430_protocol-strength-and-commerce|Protocol Strength and Commerce]] — companion session; directory as custodian developed independently and converged
- [[2026-04-08_1800_account-compromise-and-recovery|Account Compromise and Recovery]] — session close attestation (CLEAN/FLAGGED) and what happens at termination
- [[2026-04-11_1400_libp2p-dht-and-peer-connectivity|libp2p, DHT, and Peer Connectivity]] — the persistent bidirectional WebSocket resolves most mid-conversation delivery questions; CLOSE/CLOSE-ACK is the designed solution to the last-message problem identified in this log's termination protocol
- [[2026-04-11_1700_persistence-layer-design|Persistence Layer Design]] — the Seals + Participation table split is the directory-side persistence model for conversation records; date-bucket timestamps and close_type values map directly to the termination types designed here
- [[2026-04-13_1200_discovery-system-design|Discovery System Design]] — Class 3 group chat rooms extend the conversation Merkle tree model here to the multi-party case; partial Merkle proof validation for group dispute resolution builds directly on this foundation
- [[2026-04-13_1400_meta-merkle-tree-design|Meta-Merkle Tree Design]] — full design of the meta-Merkle tree / conversation proof ledger concept first identified here; replaces the hash chain with an MMR
- [[2026-04-13_1500_multi-party-conversation-design|Multi-Party Conversation Design]] — extends the two-party Merkle tree and termination protocol here to N participants; authorship/ordering separation resolves the concurrent message problem
- [[2026-04-14_1100_cello-mcp-server-tool-surface|CELLO MCP Server Tool Surface]] — `cello_send`, `cello_close_session`, and `cello_abort_session` implement the delivery confirmation and Merkle sealing protocol designed here
