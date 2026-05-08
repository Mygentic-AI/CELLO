---
name: Shared State as Protocol Primitive — CRDTs in CELLO
type: discussion
date: 2026-05-08 16:12
topics: [collaborative-state, CRDT, shared-documents, Goals, P2P-sync, workflow-coordination, non-repudiation, field-level-authority]
status: active
description: Design discussion on making shared collaborative state (Goals) a first-class CELLO protocol primitive using CRDTs, Merkle-notarized operation logs, and field-level write authority — grounded in a real-world retail equity purchase workflow at a financial services firm.
---

# Shared State as Protocol Primitive — CRDTs in CELLO

## Context

CELLO's messaging layer provides peer-to-peer communication with non-repudiation and identified counterparties. But a key use case is multi-person workflows where participants need to **maintain shared state** — like a Goal object tracking a retail equity purchase through 8 phases and 8 different roles at a financial services firm.

The question: should CELLO have a first-class primitive for shared collaborative documents, or should agents exchange diffs ad-hoc via messages?

This discussion explores making **shared state a protocol primitive** — where the CRDT operation log *is* the Merkle tree, and CELLO's existing guarantees (signed operations, hash relay, FROST seals, dispute resolution) apply to document mutations exactly as they apply to messages.

---

## The Genesis: Perplexity Discussion on P2P Shared State

Earlier exploration (https://www.perplexity.ai/search/9f4c20d3-cb6d-4a96-9026-1934b4f2fc32) covered:

- **CRDTs vs OT**: CRDTs enable true P2P (no central server); OT requires a server for coordination. Google Docs, Figma, Notion all use OT with central servers. CRDTs are the choice for local-first and P2P systems (Linear, Automerge, Yjs).
- **Conflict resolution**: CRDTs automatically resolve concurrent edits via mathematical properties (commutativity, associativity, idempotency). Different fields need different merge strategies: last-write-wins (LWW), multi-value register (MVR), OR-sets, counters.
- **Sync protocol gap**: Libraries like Yjs/Automerge provide state vectors and diff encoding, but don't solve peer discovery or catch-up protocol. That's application-specific.
- **Byzantine fault tolerance**: Add digital signatures to CRDT operations. Each mutation is signed by the author's private key. Prevents forgery, tampering, and equivocation.

---

## CELLO Already Solves the Hard Parts

The Perplexity discussion identified the unsolved problems in pure P2P CRDT systems:

1. **Peer discovery** — "How do two agents find each other when they come online?"
2. **Rendezvous** — "Who has the latest state for workflow X?"
3. **Identity** — "Who wrote this operation? Can I trust it?"
4. **Catch-up** — "I was offline, how do I get what I missed?"

CELLO already handles all of these:

- **Directory** — agents announce when they come online; the directory is the rendezvous layer
- **Identity** — FROST-authenticated sessions; every agent is directory-verified before they can write
- **Non-repudiation** — signed operations with K_local; Merkle tree as tamper-proof audit trail
- **Hash relay** — directory sequences operations and notarizes state checkpoints without seeing content

What CELLO would add: wrap the CRDT with protocol-level guarantees. The operation log becomes the Merkle tree. Participants are authenticated. Mutations are signed. Disputes are resolvable by comparing trees.

---

## Three Write Patterns

Not all fields are created equal. Different kinds of data need different conflict resolution strategies.

### Pattern 1: Unilateral Writes (Pure CRDT)

Fields where only one agent has write authority, or where writes are append-only.

**Examples from retail equity purchase workflow:**
- `context.freeBalance` — only CRM agent queries this (from fund management system)
- `context.executionPrice` — only Equity Ops Lead receives this (from broker email)
- `parallel_tasks[7.2].status` — only Settlement Staff A (cash processing) writes this
- `journal[]` — append-only; everyone adds their own entries, nobody edits others'

**Merge behavior:** Automatic and silent. Different agents writing different fields merge cleanly. Append-only collections (journal, broker confirmations array) merge via union.

**CELLO enforcement:** Schema declares which agent can write each field. Operations are validated on receipt — if settlement_securities tries to write `parallel_tasks[7.2].status` (owned by settlement_cash), the operation is rejected.

### Pattern 2: Bilateral Transitions (Two Signatures Required)

State changes that require consent, not just notification.

**Examples:**
- **Approval/rejection** — Portfolio Manager must explicitly approve or reject; the workflow can't auto-advance without their decision
- **Amendments** — changing the order quantity mid-flow requires authorization (proposer + authorizer)

**Not really bilateral:**
- **Handoffs** — these are *signals* (responsibility is transferring), not permission requests. Miriam finishes Phase 3, writes "Phase 3 complete, advancing per template," and Robert's agent picks it up on next sync. No acknowledgement required — the workflow template pre-authorizes the transition.

**CELLO enforcement:** For genuine bilateral transitions (approval, amendment), the state change only becomes valid when both signed leaves exist in the Merkle tree. The directory can enforce this at seal time — if only one signature exists, the transition is incomplete.

### Pattern 3: Genuinely Contested (Design Smell)

Two agents both try to unilaterally write the same field with different values while disconnected.

**Reality:** In a well-designed workflow schema, this shouldn't happen. The NICO shared-context document explicitly declares who **Sees** and who **Sets** each field. At any moment, exactly one agent has write authority for any given field.

If you find a genuinely contested field in your schema, it probably means:
- The field should be bilateral (require consent)
- The field should be scoped (each agent writes *their* value, effective value is derived)
- The workflow design has a flaw (unclear ownership)

---

## Field-Level Write Authority (The Schema is the Contract)

The schema isn't just field names and types. It's an **access control document** declaring, per field:

**1. Write authority** — who can mutate this field and under what condition?

```yaml
journal[]:
  write_authority: any_participant
  operation: append-only
  constraint: own_entries_only

currentOwner:
  write_authority: currentOwner  # whoever owns the current phase
  operation: advance-via-template

context.brokerConfirmations[]:
  write_authority: equity_ops_lead
  operation: append-only
  # Note: Robert can append at any time, regardless of current phase

tasks[].status:
  write_authority: assignee_only
  operation: forward-only  # pending → in_progress → completed
```

**2. Operation type** — what kind of writes are allowed?

- `append-only` — add, never edit or delete prior entries
- `set-once` — written at creation, immutable thereafter
- `owner-write` — only designated owner can set
- `bilateral` — requires proposal + acknowledgement
- `derived` — computed, not directly writable
- `forward-only` — state machine; transitions are one-way

**3. Validity conditions** — state machine constraints

```yaml
status.stage:
  valid_transitions:
    request_capture → funds_verification → order_entry → order_batching → ...
```

**Validation on receipt:** When an agent receives a CRDT operation (signed leaf), it doesn't blindly merge. It validates:
- Is this agent allowed to write this field right now?
- Is this the correct operation type?
- Is the state transition valid?

Invalid operations are **rejected** and **logged**. Because operations are signed, you know who tried an invalid write — that's a trust signal event.

---

## The Reality: Chaos and Concurrency

The discussion initially presented handoffs too rigidly — as if the "current owner" holds a global lock and nobody else can touch the Goal.

**Real workflow:**
- Equity Ops Lead gets broker confirmation from Broker A at 1:30 PM → appends to `context.brokerConfirmations[]`
- Settlement starts at 3:00 PM based on first two broker confirmations
- Broker C's confirmation arrives at 5:30 PM → Equity Ops Lead appends it
- Settlement decides "we can fit this one in" and processes it

**All concurrent. No conflict. No lock.**

Why? Because these are writes to **different fields** by **different authorized agents**:

| Field | Writer | When |
|-------|--------|------|
| `context.brokerConfirmations[]` | Equity Ops Lead | Anytime a broker email arrives |
| `parallel_tasks[7.2].status` | Settlement Staff A | During cash processing |
| `parallel_tasks[7.3].status` | Settlement Staff B | During securities processing |
| `journal[]` | any participant | Append-only, concurrent |

The CRDT merges these automatically. The "handoff" isn't a lock — it's a signal. `currentOwner` changes from CRM to Equity Ops to Settlement to Finance, but that's about **responsibility for the next major decision**, not exclusive write access.

Field-level write authority (declared in the schema) allows multiple agents to write simultaneously to their respective fields.

---

## How This Differs from DynamoDB (Current Cello Agent Model)

**DynamoDB today:**
- Central source of truth
- Agents poll for updates
- Writes go to one place; reads come from one place
- Works offline: agent writes locally, syncs when reconnected

**P2P CRDT model:**
- Each agent holds a local copy
- No central source of truth
- Agents sync with each other (via CELLO session + directory-assisted discovery)
- Works offline: agent writes locally, syncs with any peer when reconnected

**Key insight:** The mental model is almost identical. The current owner completes their phase, their agent writes the state update, others see it when they sync. The only difference is *where* the update goes: DynamoDB vs. peer sync via CELLO.

---

## Does Offline Counterparty Block Writes?

**Question:** The Order Entry agent finishes Phase 3 and writes "Phase 3 complete, handing to Trade Execution." The Trade Execution agent is offline. Is that a problem?

**Answer:** No. The write is immediately durable on the Order Entry agent's copy. The Trade Execution agent will sync whenever it comes online — from the Order Entry agent, or from any other peer who already has the update. The CELLO directory handles "Trade Execution just came online, who has the latest state for workflow X?" via peer discovery and rendezvous.

The offline peer doesn't block the write. It only delays their awareness of it — exactly like DynamoDB (where the Trade Execution agent would poll and see the update whenever it next queries).

---

## The Protocol Design

### Shared State as First-Class CELLO Object

Rather than CELLO being a transport that happens to carry Goal sync messages, the shared document becomes a native protocol concept:

- **CRDT operation log = Merkle tree** — every mutation is a signed leaf
- **FROST-sealed checkpoints** — threshold-signed snapshots of document state at close/seal time
- **Existing session model** — two (or more) agents, authenticated, discovered via directory
- **Hash relay** — directory sees operation hashes, never document content
- **Dispute resolution** — compare Merkle trees; prove what was said/changed

### Operation Leaf Format

Similar to message leaves, but for CRDT operations:

```
Structure 1 (inner, sender-signed with K_local):
  TBS: [protocol_version, operation_hash, sender_pubkey, document_id, last_seen_seq, timestamp]
  ↳ operation_hash  ← SHA-256(0x04 || CRDT operation)
  ↳ document_id     ← 16-byte shared document identifier
  sender_signature  ← Ed25519 over canonical CBOR of the TBS array

Structure 2 (outer, relay-constructed):
  [sequence_number, sender_pubkey, operation_hash, sender_signature, operation_type, prev_root]
  ↳ operation_type  ← field identifier + operation (e.g., "journal.append", "status.stage.advance")
  ↳ prev_root       ← chains to previous state
```

Leaf hash = `SHA-256(0x04 || canonical_CBOR(Structure 2))`

Domain separation: `0x00` for message leaves, `0x04` for CRDT operation leaves.

### Schema Contract Format

The schema is protocol-enforceable access control:

```yaml
document_type: goal
version: 1

fields:
  context.freeBalance:
    type: number
    write_authority: currentOwner
    write_phase: [funds_verification]
    operation: set-once-per-phase
    
  status.stage:
    type: enum
    write_authority: currentOwner
    operation: advance-via-template
    valid_transitions:
      request_capture → funds_verification → order_entry → order_batching → ...
      
  journal[]:
    type: array<JournalEntry>
    write_authority: any_participant
    operation: append-only
    constraint: own_entries_only
    
  context.brokerConfirmations[]:
    type: array<BrokerConfirmation>
    write_authority: equity_ops_lead
    operation: append-only
    
  parallel_tasks[7.2].status:
    type: enum
    write_authority: settlement_cash
    operation: forward-only
    valid_transitions:
      pending → in_progress → completed
```

On operation receipt, the client validates:
1. Is the signer allowed to write this field right now? (Check write_authority)
2. Is this the correct operation type? (Check operation constraint)
3. Is the state transition valid? (Check valid_transitions if present)

Invalid operations are rejected. The signed operation is itself evidence — logged for trust signals and dispute resolution.

---

## Integration with Existing CELLO Mechanisms

### Session Model

Shared documents are established via CELLO sessions. The session establishment ceremony (FROST) threshold-attests all participants' K_local pubkeys. You can't write to a CELLO shared document without going through session establishment first.

### Merkle Tree & Seals

The operation log is the Merkle tree. FROST seal at document close co-signs the final Merkle root — just like conversation seals. The sealed root proves document state at that point in time. Non-repudiation applies.

### Discovery & Rendezvous

The directory tracks which agents participate in which documents. When an agent comes online and needs to sync document X, the directory provides peer list. Agents sync via state vectors and diffs (Yjs protocol over CELLO session transport).

### Dispute Resolution

Compare Merkle trees (Alice's copy, Bob's copy, directory's relay copy). If disputed: provide plaintext operations, verify hashes, prove who wrote what. Same mechanism as message disputes.

---

## Why This is Different from the Mainstream

**Google Docs, Figma, Notion** — all use central servers with OT. The server is the product. Users depend on it; it sees everything.

**CELLO's promise** — you own your data, your agent owns its state, collaboration happens between peers without a platform mediating everything. Hash relay so directory never sees content. Client-side trust data. Keys never leave the client.

P2P shared state is the natural extension of this principle into collaborative workflows. It's architecturally hard to copy by incumbents who've built businesses on centralized servers. It serves users (financial services, healthcare) whose workflows involve data they can't put on someone else's server.

The technical difficulty of CRDTs is the price of entry — and a moat.

---

## The Workflow as Proof of Concept

The retail equity purchase workflow is real — grounded in discovery sessions at a financial services firm. Eight roles, eight phases, conditional branching, parallel execution, external dependencies (brokers), chaotic timing.

The shared-context document already maps who **Sees** and who **Sets** each field. It's 80% of the way to a protocol-enforceable schema. The workflow is inherently sequential-with-handoffs and clear ownership boundaries — ideal for CRDT + CELLO.

### What the Protocol Would Enforce

**Field-level write rules:**
- CRM writes `context.freeBalance` only during funds_verification phase
- Equity Ops appends to `context.brokerConfirmations[]` at any time
- Settlement agents each write their own parallel task statuses
- Journal is append-only by any participant

**State machine constraints:**
- `status.stage` advances only via valid transitions (request_capture → funds_verification → ...)
- `tasks[].status` can only move forward (pending → in_progress → completed)

**Authorization checks:**
- Portfolio Manager's approval/rejection is validated against their identity
- CRM can't write settlement fields; settlement can't write CRM fields

**Audit trail:**
- Every mutation is a signed leaf in the Merkle tree
- FROST seal attests to final state
- Disputes are resolvable by comparing trees

---

## Open Questions for Design

1. **Multi-party (>2) documents** — how does FROST ceremony scale? Does every participant co-sign session establishment, or is there a coordinator model?

2. **Dynamic membership** — if a new person joins mid-workflow (e.g., alternate portfolio manager), how do they join the session and sync the document?

3. **Schema versioning** — if the workflow template changes, how do in-flight Goals handle schema migration?

4. **Partial access** — can participants see only certain fields (e.g., Finance sees totals but not client names)? Or is shared document all-or-nothing?

5. **Performance** — FROST ceremonies are expensive. For high-frequency workflows, is session-per-document sustainable, or do we need session pooling / long-lived sessions?

6. **External participants** — brokers aren't CELLO agents. How do broker confirmations (email-based) enter the signed operation log?

---

## CRDT Library Choice: Yjs vs Automerge

Follow-up Perplexity discussion explored the practical choice between the two mature CRDT libraries.

### Initial Analysis: Case for Yjs

The first pass favored Yjs based on infrastructure alignment and performance:

**Yjs strengths:**
- **10–100× faster** than Automerge in benchmarks for intensive workloads
- **Compact binary encoding** — reduced sync overhead, better memory efficiency
- **State vector primitives** — `encodeStateVector` / `encodeStateAsUpdate` map directly to CELLO's catch-up protocol
- **Production proven** — Linear uses Yjs for workflow coordination (exactly CELLO's use case)
- **Cultural fit** — CELLO already uses CBOR, Merkle trees, binary encoding; Yjs's binary-first model is architecturally aligned

**Initial recommendation**: Start with Yjs. Performance headroom for multi-agent, high-frequency workflows. Translation layer (Y.Map → JSON schema) is manageable overhead.

### Reconsidering: The Deployment Reality

Three critical counterarguments emerged:

**1. Inference time dominates sync time**

The "high-frequency updates" assumption doesn't match the actual usage pattern:
- **Real-time editing** (Google Docs, whiteboarding): many ops per second, Yjs's speed matters
- **Workflow coordination** (CELLO): Agent A completes phase, hands to Agent B. Agent B spends 2+ minutes in LLM inference before responding.

Updates are **batch-oriented, minutes apart** — not real-time concurrent editing. Yjs's 10–100× speed advantage (10ms vs 100ms sync) is noise compared to minutes of inference. The performance benefit doesn't matter in this use case.

**2. Translation layer erodes performance gains**

Yjs's speed is at the CRDT layer. But users define **JSON/YAML schemas**, so the full path is:
```
User JSON → Y.Map translation → CBOR → network → CBOR → Y.Map → User JSON
```

The translation steps add overhead. Yjs is still faster at the core, but the gap narrows when you account for the abstraction layer you'd build anyway.

**3. Single-client deployment, not SaaS scale**

The performance argument assumed "server handling 200 workflows simultaneously." The actual deployment:
- One user's agent participating in 5–10 workflows over time
- Not 200 concurrent agents hammering one server
- Client-side libraries running locally

Memory efficiency still matters, but the "massive scale" justification doesn't apply. It's one client syncing with 2–8 peers per workflow.

### Revised Recommendation: Lean Toward Automerge

Given the deployment reality, **Automerge's strengths become more relevant**:

**1. JSON-native model** — no translation layer between user schemas (JSON/YAML) and CRDT operations. Users define field-level write authority in JSON; Automerge operations work directly on JSON-like objects.

**2. Conflict inspection built-in** — `getConflicts()` surfaces which fields are in conflict, making it easier to build the schema validation UX: "Agent A changed `approval.status`, Agent B also changed it — here's how your schema says to resolve it."

**3. Full history by default** — workflow accountability benefits from audit trail of "who changed what when" without building it yourself. Useful for dispute resolution and trust signals.

**4. Performance penalty is acceptable** — the 10–100× difference doesn't matter when:
   - Updates are minutes apart (batch-oriented handoffs)
   - LLM inference takes 2+ minutes per response
   - Single-client deployment, not server scale

**Trade-offs we're accepting**:
- Larger snapshots (more history retained) — manageable on modern hardware, configurable retention policies
- Slower CRDT operations — noise compared to inference time

**Why this fits CELLO better**:
- Schema-driven validation is the make-or-break UX — Automerge's JSON-native model makes that easier to build and explain
- Conflict inspection aligns with field-level write authority validation
- History/audit trail supports non-repudiation and dispute resolution (existing CELLO principles)
- Performance penalty doesn't hurt the actual workflow patterns (sequential handoffs, not real-time collaboration)

**The shift**: Initial recommendation overweighted performance for a use case where it doesn't matter. Automerge's ergonomics and conflict-awareness better serve CELLO's schema-driven, accountability-focused workflow coordination.

---

## Next Steps

1. **Write ADR** — Document the decision to make shared state a first-class CELLO primitive, including Automerge as the CRDT implementation (pending final validation)
2. **Spec the schema format** — Define YAML/JSON schema for field-level write authority and operation types
3. **Extend Merkle leaf format** — Domain separation for CRDT operation leaves (`0x04`)
4. **Define sync protocol** — Automerge state vector exchange, diff encoding, catch-up on reconnect
5. **Map to workflow fixture** — Express the retail-equity-purchase shared-context document as a protocol-enforceable schema
6. **Milestone placement** — Slot as M9 (after M8 Group Rooms, before M10 Commerce)

---

## Related Documents

- [[protocol-map|CELLO Protocol Map]] — top-level protocol orientation
- [[end-to-end-flow|CELLO End-to-End Protocol Flow]] — messaging, identity, Merkle trees, FROST seals
- [[cello-initial-design|CELLO Design Document]] — original vision and 10-step trust chain
- [[graph-based-workflows-architecture|Graph-Based Workflows Architecture]] (cello-agent) — Goals, workflows, handoffs in the centralized model
- [[goal-schema|Goal Schema]] (cello-agent) — JSON schema for Goal objects with phases, parties, tasks, journal
- [[retail-equity-purchase workflow|Retail Equity Purchase Workflow]] (cello-agent) — real NICO workflow used as concrete example
- [[shared-context|Retail Equity Purchase Shared Context]] (cello-agent) — actor analysis and field-level access patterns
