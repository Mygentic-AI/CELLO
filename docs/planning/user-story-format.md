---
name: CELLO User Story Format
type: design
date: 2026-04-16
topics: [user-stories, EARS, requirements, TDD, testing, specification]
status: active
description: Formal specification for CELLO user stories — unified template combining user story intent with EARS behavioral rigor, designed for TDD with AI coders.
---

# CELLO User Story Format

This document defines the formal template for all CELLO user stories. Every story — whether the actor is a human owner, an AI agent, a client library, or a server node — uses the same template with the same rigor.

---

## Design Principles

1. **One template for all actors.** The actor is a field, not a template selector. A human registering WebAuthn and a directory node assigning sequence numbers both get the same structure.
2. **Intent and behavior are both always present.** The user story sentence captures why. The EARS behaviors capture what, precisely. Neither is optional.
3. **Every criterion is a test.** Acceptance criteria map to positive tests. Security invariants map to negative tests. Degraded behaviors map to failure-condition tests. A TDD agent reads the story and writes tests directly from it.
4. **Domains are work units.** Each domain is scoped to a session's worth of work for an AI coder — roughly 8-20 stories. An agent can be told "work on this domain" and have a completable scope.

---

## Actor Taxonomy

| Actor | Code | Description | Interacts via |
|---|---|---|---|
| Human Owner | `OWNER` | The person who owns and controls the agent | Web portal (Next.js), phone notifications (WhatsApp/Telegram) |
| AI Agent | `AGENT` | The AI agent using CELLO to communicate | MCP tools (`cello_send`, `cello_scan`, etc.) |
| CELLO Client | `CLIENT` | The client library running on the agent's machine | Autonomous — handles crypto, signing, scanning, transport |
| Directory Node | `DIR` | A federated directory/relay server node | Server-side — auth, FROST ceremonies, hash relay, replication |
| Counterparty | `COUNTER` | The other agent/client in a protocol interaction | Via the protocol — connection requests, messages, attestations |
| Consortium Operator | `OPS` | A node operator managing directory infrastructure | Node management tools, monitoring, vetting |

A single story has one primary actor. Other actors may appear in the behavior and acceptance criteria as participants in the interaction.

---

## Domain Taxonomy

Domains are scoped to work units — small enough for an AI coder to complete in a session, large enough to be coherent. Each domain maps to one or more sections of the protocol map.

| Domain | Code | Scope | Primary components |
|---|---|---|---|
| Cryptographic Primitives | `CRYPTO` | Ed25519 keypair generation/signing/verification, SHA-256 with domain separation, key serialization | crypto |
| Registration & Onboarding | `REG` | Phone OTP, email, K_local generation, directory listing creation | client, directory |
| Trust Enrichment | `ENRICH` | WebAuthn, TOTP 2FA, OAuth providers (LinkedIn, GitHub, etc.), device attestation | web-portal, client, directory |
| Trust Evaluation | `EVAL` | Signal evaluation, SignalRequirementPolicy, no-numeric-score model, hash-everything verification | client, directory |
| Anti-Sybil | `SYBIL` | Conductance scoring, diminishing returns, provisional period, carrier signals, endorsement rate limiting | directory |
| Authentication | `AUTH` | Challenge-response, FROST session establishment, mutual auth, nonce management | client, directory |
| Connection Requests | `CONNREQ` | Sending/receiving requests, trust data relay, selective disclosure, one-round negotiation | client, directory |
| Connection Policies | `CONNPOL` | Acceptance rules (Open/Selective/Guarded/etc.), endorsement requirements, verification freshness gates | client, web-portal |
| Endorsements & Attestations | `ENDORSE` | Pre-computed endorsements, general attestations, revocation, anti-farming, bootstrapping | client, directory |
| PSI | `PSI` | Private Set Intersection for endorsement verification, PSI-CA and full PSI variants | client, directory |
| Connection Staking | `STAKE` | Escrow mechanics, flat fees, gate pyramid, stake release via session attestation | directory, client |
| Message Exchange | `MSG` | Dual-path hash relay, signed hashes (embedded + relay), direct channel delivery | client, transport |
| Merkle Trees | `MERKLE` | RFC 6962 construction, identity tree, message tree, MMR, checkpoint, inclusion proofs | client, directory |
| Session Lifecycle | `SESSION` | Termination (CLOSE/SEAL/ABORT/EXPIRE/REOPEN), session close attestations (CLEAN/FLAGGED/PENDING) | client, directory |
| Notifications | `NOTIF` | Fire-and-forget messages, type registry, filtering rule engine, rate limits, prior conversation requirement | client, directory |
| Multi-Party Conversations | `MULTI` | N-party ordering, serialized/concurrent modes, GossipSub, receive windows, group seals | client, transport |
| Scanning Pipeline | `SCAN` | Layers 1-2 (inbound sanitization + LLM scanner), Layer 3 (outbound gate + terms-violation self-check) | client |
| Redaction & Governance | `REDACT` | Layer 4 (redaction pipeline), Layer 5 (runtime governance), Layer 6 (access control) | client |
| Discovery & Search | `DISC` | Agent directory, bulletin board, group rooms, BM25 + vector search, bio, greeting | directory, web-portal |
| Contact Aliases | `ALIAS` | Revocable identifiers, alias creation/revocation, alias-routed connection requests | client, directory |
| Compromise Detection | `DETECT` | Activity monitoring, anomaly alerts, FROST canary, burst detection, unknown peer alerts | directory |
| Emergency Response | `EMERG` | "Not Me" revocation, K_server burn, tombstone creation, freeze effects | directory, client |
| Recovery | `RECOVER` | Social recovery (M-of-N), voucher accountability, trust floor, accelerated decay, carry-forward | directory, web-portal |
| Key Rotation | `KEYROT` | K_local rotation, K_server rotation, epoch management, envelope encryption | client, directory |
| Succession | `SUCC` | Voluntary transfer, dead-man's switch, succession package, announcement period | directory, web-portal |
| Node Operations | `NODE` | Replication, consensus, checkpoint, node health, backup promotion, node removal | directory, relay |
| Data Residency & Deletion | `DATA` | Home node PII isolation, cross-border hash-only, account deletion, tombstone semantics | directory |
| Degraded Mode | `DEGRADE` | Client behavior during outage, degraded-mode list, whitelist, reconciliation on recovery | client |
| MCP Tool Surface | `MCP` | The 33 agent-facing MCP tools, tool schemas, error responses | client |
| Web Portal | `PORTAL` | Owner-facing UI for all human operations — dashboard, settings, monitoring | web-portal |
| Dispute Resolution | `DISPUTE` | Arbitration flow, ephemeral inference, verdict tiers, threshold arbitration | directory |

---

## Template

```yaml
# ─── Identity ───────────────────────────────────────────────
id: CELLO-{DOMAIN_CODE}-{number}
domain: {domain name}
actor: OWNER | AGENT | CLIENT | DIR | COUNTER | OPS
priority: P0 | P1 | P2
components:
  - {affected system components: client, web-portal, directory, relay, transport}

# ─── Intent ─────────────────────────────────────────────────
# Human-readable purpose. Always present, even for system actors.
story: >
  As the {actor},
  I want to {goal}
  so that {benefit}.

# ─── Behavior (EARS) ───────────────────────────────────────
# Formal specification of what happens. Always present, even for human actors.
# Uses EARS patterns: event-driven, state-driven, unwanted, ubiquitous, optional.
behavior:
  - trigger: "{When / While / If / Where} {precondition, event, state, or error}"
    action: "the {component} shall {specific, measurable action}"

# ─── Acceptance Criteria ────────────────────────────────────
# Each criterion maps 1:1 to a test case.
acceptance_criteria:
  - id: AC-{number}
    given: "{precondition / initial state}"
    when: "{action, event, or trigger}"
    then: "{observable, verifiable outcome}"
    test_type: unit | integration | e2e
    component_under_test: {component}

# ─── Security Invariants ───────────────────────────────────
# Conditions that must NEVER be violated. Each generates a negative test.
# Omit section if none apply.
security_invariants:
  - id: SI-{number}
    statement: "The {component} shall never {prohibited behavior}"
    adversarial_condition: "even when {specific attack scenario or failure mode}"
    test_type: unit | integration | e2e
    component_under_test: {component}

# ─── Degraded Behavior ─────────────────────────────────────
# What happens when infrastructure is unavailable. Each generates a failure-condition test.
# Omit section if none apply.
degraded_behavior:
  - id: DB-{number}
    condition: "While {infrastructure component} is unavailable"
    fallback: "the {component} shall {fallback behavior} instead of {normal behavior}"
    test_type: integration | e2e
    component_under_test: {component}

# ─── Observability (M4+ stories only) ─────────────────────
# Named log events, required context fields, and alerting for this story.
# Omit for M0–M3 stories. Required for any story touching M4+ code.
observability:
  events:
    - name: "{domain.noun.verb}"          # e.g. session.started
      level: info | warn | error
      trigger: "{when this event fires}"
      context_fields: [{field1}, {field2}]  # minimum fields required
      correlationId: true | false           # must this event carry a correlationId?
  error_events:
    - name: "{domain.noun.verb.failed}"
      level: warn | error
      trigger: "{error condition}"
      context_fields: [{field1}, {reason}]
  alarms:
    - condition: "{CloudWatch alarm condition, e.g. error rate > 5% over 5 min}"
      fires_to: "{alert channel}"

# ─── References ─────────────────────────────────────────────
references:
  protocol_map: "{domain from protocol-map.md}"
  end_to_end_flow: "{section reference, e.g. §6.1}"
  discussion_logs:
    - "{YYYY-MM-DD_HHMM_slug}"
  # Optional extensions — include when relevant:
  attack_corpus: "{path and section of attack-corpus-reference.md, e.g. §1, §2}"
  external_sources:
    - "{URL — description of what it provides for testing this story}"
```

---

## Milestone Story Ordering

**E2E stories are written first. Component stories are derived from them.**

This ordering is mandatory. It prevents spec gaps where a component story describes the output shape of a data structure without specifying the protocol step that populates it.

### The Rule

1. **Write the E2E story first.** For each milestone, the first story written describes the full scenario from the outside: two real agents, real nodes, real network. It traces the complete protocol flow and identifies every data dependency.

2. **Derive component stories from the E2E story.** For each step in the E2E story that requires implementation, write a component story. A component story is not ready to write until its E2E parent exists.

3. **A component story must be exercised by at least one E2E story.** If you cannot point to an E2E story whose scenario requires the component story's behavior, the component story is either premature or the E2E story is incomplete.

4. **Data fields in component stories must trace to a protocol step.** If a component story says "the assignment shall contain `peer_id`", the E2E story must contain an AC that names the step that populates it. "The directory learns the agent's peer ID when..." must appear somewhere.

### What this prevents

The class of bug where:
- A component produces a data structure with the right *shape*
- A test pre-populates the data to satisfy the shape
- No test verifies that the *protocol flow* produces the data
- The field is empty in production

---

## Definition of Ready / Definition of Done

These checklists prevent AI coders from pulling incomplete stories or declaring premature completion.

### Definition of Ready (before starting work)

A story is ready to pull when:
- [ ] All behavior statements are unambiguous — a developer unfamiliar with the protocol can understand what to build
- [ ] Acceptance criteria are complete — happy path, error paths, and edge cases covered
- [ ] Security invariants specify the adversarial condition, not just the prohibition
- [ ] Degraded behaviors specify both the fallback and what normal behavior it replaces
- [ ] References to end-to-end-flow and discussion logs are verified (sections exist and are current)
- [ ] Dependencies on other stories are identified (e.g., "requires CELLO-AUTH-001 to be implemented first")
- [ ] **For component stories:** at least one E2E story exists that exercises this component's output end-to-end
- [ ] **For component stories with data fields:** every field has a named protocol step that populates it (no "something will call this later")
- [ ] **(M4+)** Every significant state transition has a named log event in `domain.noun.verb` format with required context fields specified
- [ ] **(M4+)** Async/multi-process flows specify correlationId threading
- [ ] **(M4+)** Every error path has a named error event with sufficient diagnostic context
- [ ] **(M4+)** New failure modes have a corresponding alarm threshold specified

### Definition of Done (before marking complete)

A story is done when:
- [ ] Every acceptance criterion (`AC-*`) has a corresponding passing test
- [ ] Every security invariant (`SI-*`) has a corresponding negative test that simulates the adversarial condition
- [ ] Every degraded behavior (`DB-*`) has a corresponding test that simulates the failure condition
- [ ] All tests pass in CI
- [ ] No security invariant from other stories in the same domain is broken by the implementation
- [ ] Code compiles/type-checks cleanly (no new warnings)
- [ ] **For `test_type: e2e` ACs:** the test runs against real nodes (relay + directory running as processes), not mocks. A test that spins up in-process fakes does not satisfy an e2e AC.
- [ ] **(M4+)** All log events specified in the `observability` block are present in the implementation with correct event names and context fields
- [ ] **(M4+)** No `console.log` in implementation code — all output goes through the injected `Logger` interface
- [ ] **(M4+)** correlationId is threaded through every event in flows that specify it

### Milestone Close Gate

A milestone is closed only when:
- [ ] All stories in the milestone are done per the above checklist
- [ ] The milestone's E2E story scenario has been run live: real relay, real directory, real MCP server processes, real agent tool calls
- [ ] The live run produced the expected observable outcomes (session established, messages exchanged, etc.)
- [ ] Any failures discovered in the live run became new stories and were resolved before close

Committing code does not close a milestone. The live run closes it.

---

## Field Reference

### id
Format: `CELLO-{DOMAIN_CODE}-{number}`. The domain code comes from the Domain Taxonomy table. Numbers are sequential within a domain. Example: `CELLO-MSG-003`.

### domain
The work-unit domain this story belongs to. Must match a domain in the Domain Taxonomy.

### actor
The primary actor who initiates or is responsible for the behavior. One actor per story. Other actors may appear in acceptance criteria.

### priority
- **P0**: Must have for the protocol to function. Blocking for any implementation.
- **P1**: Must have before launch. Important but not structurally blocking.
- **P2**: Should have. Can be deferred without breaking the protocol.

### components
Which system components are involved. Used to filter stories by codebase:
- `client` — CELLO client library (Node/TypeScript)
- `web-portal` — Owner-facing frontend (Next.js)
- `directory` — Directory node server
- `relay` — Relay node server
- `transport` — libp2p, platform transports (Slack/Discord/Telegram), Bluetooth

### story
The user story sentence. Always in the form "As the {actor}, I want {goal} so that {benefit}." This captures intent and justification. It is present for every actor type — system actors have goals too ("As the CLIENT, I want to verify the embedded signed hash so that tampered messages never reach the agent's LLM").

### behavior
One or more EARS-pattern statements. These are the technically precise specification of what happens. Five patterns are available:

| Pattern | Template | Use when |
|---|---|---|
| **Event-driven** | When {event}, the {component} shall {action} | Something triggers a response |
| **State-driven** | While {state holds}, the {component} shall {action} | Behavior depends on ongoing condition |
| **Unwanted behavior** | If {error/failure}, then the {component} shall {response} | Handling errors and exceptions |
| **Ubiquitous** | The {component} shall {action} | Always true, no trigger needed |
| **Optional** | Where {feature is enabled}, the {component} shall {action} | Feature-gated behavior |

A single story often has multiple behaviors — the happy path, the error path, and the edge cases.

### acceptance_criteria
Given/When/Then format. Each criterion has:
- **id**: `AC-{number}`, sequential within the story. Used to trace to test cases.
- **given/when/then**: The test specification.
- **test_type**: `unit` (isolated component), `integration` (multiple components or external services), `e2e` (full protocol flow).
- **component_under_test**: Which component the test exercises. Allows filtering by codebase.

### security_invariants
Conditions that must never be violated, even under adversarial conditions. Each has:
- **id**: `SI-{number}`, sequential within the story.
- **statement**: What must never happen.
- **adversarial_condition**: The specific attack or failure mode this guards against. Forces the test to simulate the attack, not just verify normal behavior.
- **test_type** and **component_under_test**: Same as acceptance criteria.

### degraded_behavior
What happens when infrastructure is unavailable. Each has:
- **id**: `DB-{number}`, sequential within the story.
- **condition**: What's unavailable.
- **fallback**: What the component does instead, and what normal behavior it replaces.
- **test_type** and **component_under_test**: Same as acceptance criteria.

### references
Traces the story back to the design documentation:
- **protocol_map**: Which domain in protocol-map.md this relates to.
- **end_to_end_flow**: The specific section (e.g., §6.1) for the deep reference.
- **discussion_logs**: The discussion log files that informed this requirement.

---

## Example: Complete Story

```yaml
id: CELLO-MSG-003
domain: Message Exchange
actor: CLIENT
priority: P0
components:
  - client
  - transport

story: >
  As the CELLO Client,
  I want to verify every incoming message against its embedded signed hash
  so that tampered or forged messages are rejected before reaching the agent's LLM.

behavior:
  - trigger: "When a message arrives on the direct channel"
    action: "the client shall extract the embedded signed hash, hash the message content (SHA-256), and verify the sender's Ed25519 signature against their registered public key"
  - trigger: "When the computed hash does not match the embedded hash"
    action: "the client shall reject the message, log a tampering event with the message hash and sender ID, and alert the owner"
  - trigger: "When the sender's signature verification fails"
    action: "the client shall reject the message and log a signature verification failure"
  - trigger: "When a message arrives without an embedded signed hash"
    action: "the client shall reject the message unconditionally"

acceptance_criteria:
  - id: AC-001
    given: "A message arrives with a valid embedded signed hash"
    when: "The client hashes the content and verifies the signature"
    then: "The hash matches, signature verifies, and the message is accepted into the local Merkle tree"
    test_type: unit
    component_under_test: client

  - id: AC-002
    given: "A message arrives with a hash that does not match the content"
    when: "The client hashes the content"
    then: "The hash mismatch is detected, the message is rejected, and a tampering event is logged"
    test_type: unit
    component_under_test: client

  - id: AC-003
    given: "A message arrives with a valid hash but an invalid sender signature"
    when: "The client verifies the signature against the sender's registered public key"
    then: "The signature check fails, the message is rejected, and a signature failure is logged"
    test_type: unit
    component_under_test: client

  - id: AC-004
    given: "A message arrives without any embedded signed hash"
    when: "The client inspects the message envelope"
    then: "The message is rejected unconditionally without further processing"
    test_type: unit
    component_under_test: client

  - id: AC-005
    given: "A valid message arrives on the direct channel AND the same hash arrives via the directory relay"
    when: "Both paths deliver successfully"
    then: "The client cross-checks both hashes, confirms they match, and records the message in the Merkle tree with the directory-assigned sequence number"
    test_type: integration
    component_under_test: client

security_invariants:
  - id: SI-001
    statement: "The client shall never pass a message to the agent's LLM without first verifying its embedded signed hash"
    adversarial_condition: "even when the directory relay independently confirms the hash"
    test_type: unit
    component_under_test: client

  - id: SI-002
    statement: "The client shall never accept a message signed by an expired or revoked public key"
    adversarial_condition: "even when the message content and hash are otherwise valid"
    test_type: integration
    component_under_test: client

degraded_behavior:
  - id: DB-001
    condition: "While the directory relay is unavailable"
    fallback: "the client shall still verify the embedded signed hash from the direct channel and accept the message locally; reconciliation with the directory is deferred until the relay recovers"
    test_type: integration
    component_under_test: client

references:
  protocol_map: "Conversations"
  end_to_end_flow: "§6.1"
  discussion_logs:
    - "2026-04-08_1530_message-delivery-and-termination"
    - "2026-04-08_1430_protocol-strength-and-commerce"
```

---

## How a TDD Agent Uses This

1. **Receive a domain assignment**: "Work on Message Exchange (`MSG`) for the client component."
2. **Load all stories** in that domain where `components` includes `client`.
3. **For each story, write failing tests first**:
   - One test per acceptance criterion (`AC-*`), using the Given/When/Then as the test structure.
   - One negative test per security invariant (`SI-*`), simulating the adversarial condition and asserting the prohibited behavior does not occur.
   - One failure-condition test per degraded behavior (`DB-*`), simulating the outage and asserting the fallback activates.
4. **Implement until all tests pass.**
5. **The test IDs trace back to story IDs**, so coverage is auditable: every `CELLO-MSG-003:AC-001` maps to a test, which maps to a requirement, which maps to a design decision in the protocol map.

---

## Related Documents

- [[protocol-map|CELLO Protocol Map]] — top-level orientation; domains here map to protocol map domains
- [[end-to-end-flow|CELLO End-to-End Protocol Flow]] — the deep canonical reference stories are derived from
- [[server-infrastructure|Server Infrastructure Requirements]] — server-component requirements with conflicts and gaps that user stories must account for
- [[cello-initial-design|CELLO Design Document]] — original architecture and vision
