---
name: cello-audit-session
description: Full paper-trail audit of a sealed CELLO session. Verifies local transcripts (both agents), sealed receipts, Merkle tree hash chain, relay witness events, FROST ceremony logs, and directory DB records. Use after any session to confirm all layers performed correctly.
---

# CELLO Session Audit — Full Paper Trail Verification

Given a session ID (from `cello_close_session` or `cello_sessions`), this skill verifies every layer of the CELLO trust infrastructure recorded the session correctly.

**Input:** A session ID (32-char hex, e.g. `a001ca741aab521cbeb2b254edeb9583`).

If no session ID is provided as argument, check `cello_sessions` for the most recently sealed session.

---

## Layer 1: Local Transcripts (both agents)

Both participants should have independent, matching transcripts stored in their local encrypted SQLite.

### Step 1a — Get initiator's transcript

Switch to the initiating agent (`cello_use_agent` if needed), then:

```
cello_transcript({ session_id: SESSION_ID })
```

Record:
- Number of messages
- Sequence numbers
- Direction labels (sent/received)
- The full message list

### Step 1b — Get target's transcript

Switch to the target agent (`cello_use_agent`), then:

```
cello_transcript({ session_id: SESSION_ID })
```

### Step 1c — Verify consistency

**PASS criteria:**
- Same number of messages on both sides
- Sequence numbers match (0, 1, 2, ...)
- Direction is mirrored: initiator's `sent` = target's `received` and vice versa
- No `undecryptable` messages (field should be 0)
- Timestamps are within a few milliseconds of each other (same daemon, so near-identical)

Report:
```
LAYER 1 — Local Transcripts:
  Message count:     N (both sides)
  Sequence range:    0 to N-1
  Direction mirror:  PASS/FAIL
  Undecryptable:     0 (both sides)
  Timestamp drift:   <max ms difference>
  VERDICT: PASS/FAIL
```

---

## Layer 2: Sealed Receipt

Both agents should have the same sealed receipt with a matching `sealed_root`.

### Step 2a — Get both receipts

For each agent:
```
cello_sealed_receipt({ session_id: SESSION_ID })
```

### Step 2b — Verify consistency

**PASS criteria:**
- Both return `ok: true`
- `sealed_root` is identical on both sides (64-char hex)
- `legibility.participants` lists both agents' pubkeys
- Both participants have `attestation_mode: "live"` (bilateral seal)
- `legibility.attests` is `"receipt"` (not agreement)
- `participant_count` matches the number of participants in legibility block

Report:
```
LAYER 2 — Sealed Receipt:
  sealed_root:       <hex> (matches: PASS/FAIL)
  attestation_mode:  both "live" (PASS/FAIL)
  participants:      <count>
  attests:           receipt
  VERDICT: PASS/FAIL
```

---

## Layer 3: Daemon Log — Hash Chain Progression

The daemon log at `~/.cello/daemon.log` records every tree append event, showing the Merkle root growing monotonically.

### Step 3a — Extract tree append events

```bash
grep "SESSION_ID" ~/.cello/daemon.log | grep "session.tree.appended"
```

### Step 3b — Verify hash chain

**PASS criteria:**
- `leafIndex` values grow monotonically (0, 0, 1, 1, 2, 2, 3, 3, ...)
  - Pairs are expected: one per agent (both agents compute the same root)
- `newRootHex` changes with each new leaf index (tree is not static)
- Paired events (same leafIndex) have identical `newRootHex` (both agents agree)
- No gaps in leaf indices

Report:
```
LAYER 3 — Hash Chain:
  Leaves recorded:   N
  Root progression:  <list of roots per leaf index>
  Agent agreement:   PASS/FAIL (both compute same root at each step)
  Monotonic growth:  PASS/FAIL
  VERDICT: PASS/FAIL
```

---

## Layer 4: Daemon Log — Relay Witness

Every message passes through the relay, which signs an ordering receipt.

### Step 4a — Extract relay events

```bash
grep "SESSION_ID" ~/.cello/daemon.log | grep "relay.hash\|relay.leaf\|delivery.acked"
```

### Step 4b — Verify relay witness

**PASS criteria:**
- Every content message has a `session.relay.hash.submitted` event
- Every submitted hash has matching `session.relay.leaf.delivered` events for BOTH participants
- `leafKind: 0` = content leaf, `leafKind: 2` = seal leaf
- Every content hash has a `content.delivery.acked` event (application-level ACK)
- Sequence numbers are monotonically increasing
- The number of content leaves matches the message count from Layer 1

Report:
```
LAYER 4 — Relay Witness:
  Hashes submitted:     N
  Leaves delivered:     N × 2 (both parties)
  Delivery ACKs:        N
  Seal leaves:          2 (bilateral) or 1 (unilateral)
  Sequence continuity:  PASS/FAIL
  VERDICT: PASS/FAIL
```

---

## Layer 5: Daemon Log — FROST Seal Ceremony

The seal ceremony is the cryptographic finalization. Both parties submit seal leaves, participate in a FROST threshold signing ceremony, verify the resulting signature, and tear down their ephemeral session nodes.

### Step 5a — Extract seal events

```bash
grep "SESSION_ID" ~/.cello/daemon.log | grep "seal\|frost\|sealed\|node.destroyed"
```

### Step 5b — Verify ceremony

**PASS criteria:**
- `session.seal.leaf.submitted` — at least one (bilateral = two, one per party)
- `session.seal.ceremony.participated` with `ok: true`
- `session.seal.frost.signature.sent` — signature share was sent
- `session.sealed.signature.checked` with `verified: true` (at least one, ideally both sides)
- `seal.certificate.frontier.verified` — frontier verification passed
- `session.seal.completed` with `role: "bilateral"` and a `sealedRoot` matching Layer 2
- `session.node.destroyed` with `reason: "sealed"` (ephemeral nodes torn down cleanly)
- The `sealedRoot` in the completion event matches the `sealed_root` from Layer 2

Report:
```
LAYER 5 — FROST Seal Ceremony:
  Seal leaves submitted:   N (expect 2 for bilateral)
  Ceremony participated:   ok=true
  Signature verified:      true
  Frontier verified:       true
  Sealed root matches:     PASS/FAIL (vs Layer 2)
  Nodes destroyed:         N (reason: sealed)
  Role:                    bilateral/unilateral
  VERDICT: PASS/FAIL
```

---

## Layer 6: Directory Database (Server-Side)

The directory stores the authoritative server-side record. Query the us-east-1 directory DB.

**Prerequisites:** AWS credentials with ECS exec access to `cello-dev` cluster.

### Step 6a — Query `sessions` table

Use the `/cello-db-query` skill pattern:

```sql
SELECT session_id, owning_node_id, initiator_pubkey_hex, target_pubkey_hex, created_at, chain_hash
FROM sessions
WHERE session_id = 'SESSION_ID_WITH_DASHES'
```

Note: The directory stores session IDs as UUIDs with dashes (e.g. `a001ca74-1aab-521c-beb2-b254edeb9583`). Insert dashes at positions 8-4-4-4-12 from the flat hex.

### Step 6b — Query `conversation_seals` table

```sql
SELECT conversation_id, merkle_root, close_type, participant_count, seal_date, chain_hash
FROM conversation_seals
WHERE conversation_id = 'SESSION_ID_WITH_DASHES'
```

### Step 6c — Query `conversation_proof_leaves` table

```sql
SELECT leaf_index, leaf_hash, seal_merkle_root, mmr_position, recorded_at
FROM conversation_proof_leaves
WHERE session_id = 'SESSION_ID_WITH_DASHES'
ORDER BY leaf_index
```

### Step 6d — Verify directory records

**PASS criteria:**
- Session exists with correct `initiator_pubkey_hex` and `target_pubkey_hex`
- `conversation_seals.merkle_root` matches the `sealed_root` from Layer 2
- `close_type` is `MUTUAL_SEAL` (bilateral) or `UNILATERAL_SEAL`
- `participant_count` matches Layer 2 participant count
- `conversation_proof_leaves.seal_merkle_root` matches the sealed root
- At least one proof leaf exists (the seal leaf committed to the directory's MMR)

Report:
```
LAYER 6 — Directory Database:
  Session record:        EXISTS/MISSING
  Initiator matches:     PASS/FAIL
  Target matches:        PASS/FAIL
  Seal record:           EXISTS/MISSING
  Merkle root matches:   PASS/FAIL (vs Layer 2 sealed_root)
  Close type:            MUTUAL_SEAL/UNILATERAL_SEAL
  Proof leaves:          N
  MMR committed:         PASS/FAIL
  VERDICT: PASS/FAIL
```

---

## Layer 7: Session Transport Metadata

Additional verification of the session establishment and transport layer.

### Step 7a — Extract transport events

```bash
grep "SESSION_ID" ~/.cello/daemon.log | grep "session.node.created\|session.transport\|session.liveness\|session.inbound"
```

### Step 7b — Verify transport

**PASS criteria:**
- `session.node.created` for both agents (distinct `sessionPeerId` values)
- `session.liveness.changed` with `liveness: "alive"` for both sides
- `session.transport.connected` showing the peer address used
- `session.inbound.accepted` for the target agent (received the session offer)
- Both `sessionPeerId` values are different from each other (distinct ephemeral nodes)

Report:
```
LAYER 7 — Transport:
  Ephemeral nodes:     2 (distinct PeerIDs: PASS/FAIL)
  Liveness:            both alive
  Transport mode:      direct/relay
  Inbound accepted:    PASS/FAIL
  VERDICT: PASS/FAIL
```

---

## Final Audit Report

Compile all layers into a single report:

```
═══════════════════════════════════════════════════════
CELLO SESSION AUDIT — SESSION_ID
═══════════════════════════════════════════════════════

Layer 1 — Local Transcripts:       PASS/FAIL
Layer 2 — Sealed Receipt:          PASS/FAIL
Layer 3 — Hash Chain:              PASS/FAIL
Layer 4 — Relay Witness:           PASS/FAIL
Layer 5 — FROST Seal Ceremony:     PASS/FAIL
Layer 6 — Directory Database:      PASS/FAIL
Layer 7 — Transport:               PASS/FAIL

───────────────────────────────────────────────────────
OVERALL VERDICT:                   PASS/FAIL
═══════════════════════════════════════════════════════

Provability statement:
  Every message is hashed into a Merkle tree.
  The relay witnessed and signed ordering receipts for each message.
  Both participants independently verified the tree root.
  The final root was FROST threshold-signed by the directory consortium.
  The directory stored the seal in its append-only MMR.
  The transcript, receipt, and directory all agree on the same sealed_root.

  sealed_root: <hex>
  FROST signature: verified by both parties
  Directory MMR position: <N>
```

---

## Troubleshooting

**`cello_transcript` returns empty messages:**
Session may not have been sealed yet. Only sealed sessions have durable transcripts.

**`cello_sealed_receipt` returns `not_found`:**
The session was interrupted, not sealed. Check `cello_status` for `interrupted_sessions`.

**`cello_get_inclusion_proof` returns `not_implemented`:**
This MCP tool is not yet wired. The cryptographic machinery (tree, root, seal) exists and is verifiable via the daemon log and directory DB — the user-facing extraction tool is pending.

**Daemon log is empty for this session:**
The daemon log may have been cleared between the session and this audit. The sealed receipt and directory records are still authoritative.

**Directory DB returns no rows:**
Check the session ID format (needs UUID dashes). Also verify which region the session's `owning_node_id` belongs to — query that region's directory DB, not necessarily us-east-1.

**`undecryptable` count > 0:**
Messages were received but could not be decrypted. This indicates a key mismatch or corruption. The session sealed anyway (it hashes the encrypted envelope, not the plaintext), but content is partially lost.

**Sequence numbers have gaps:**
The relay assigns sequence numbers. Gaps indicate lost messages (network drop between relay and recipient). The hash chain still covers all messages the relay witnessed, but the recipient may have fewer messages than the sender.

**Both agents show the same `direction` for a message:**
Bug in transcript recording. Both should mirror (one says sent, other says received). Report as a test failure.
