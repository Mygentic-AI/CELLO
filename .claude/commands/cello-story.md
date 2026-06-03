---
name: cello-story
description: Write new CELLO user stories following E2E-first ordering. Always write the E2E story before component stories.
---

# /cello-story

Use this command to write new CELLO user stories. It enforces E2E-first ordering — the process failure that led to the M1 peer info gap.

## The foundational rule — read this before writing a single AC

**Stories must describe production behavior, not test-harness behavior.**

This is the failure mode that surfaced in M2 and M3: implementation code routes through a `NODE_ENV=test` shortcut (e.g. `bootstrapKeyShares`, `MockRelayAdapter`, in-process stubs) and all ACs pass green — but the real multi-party protocol was never exercised. The live smoke test then fails because the production path was never implemented.

**For every AC with `test_type: integration` or `test_type: e2e`:**

1. Ask: *"Would this AC pass if `NODE_ENV=test` routed around the real protocol?"* If yes, the AC is underspecified — it tests result, not behavior.
2. Ask: *"Would this AC pass if the two participants were in different OS processes on different machines with no shared memory?"* If no, the AC is underspecified.
3. For ACs describing a multi-party protocol (DKG ceremony, FROST rounds, stream handshake, libp2p dial): **the AC must assert the transport path was used** — not just that the final return value is correct. Assert that the protocol handler was invoked, the stream was opened, or the round-trip frame count is correct. A test that only checks the return value cannot satisfy an AC claiming real network ceremony.

**How to write a stub-resistant `then` clause:**

The `then` clause determines whether a hollow test can satisfy the AC. Apply this rule when composing it:

> **Name an observable that is only reachable via the real protocol path.**

The two observable categories that work:
- **Transport evidence** — a stream was opened, a protocol handler was invoked, a frame was sent over the wire. These cannot be faked by an in-process stub because the stub never touches the network stack.
- **Cross-process state** — a value held by participant B (directory, relay, counterparty) that it could only have received via the protocol. If B is a separate libp2p instance, the only way it holds the value is if the wire protocol ran.

Examples of `then` clauses that are stub-resistant:
> "...AND each of the 3 directory node instances received at least one `/cello/frost/1.0.0` stream open from the agent node (not from shared memory)"

> "...AND the directory's `AgentProfile` for this agent is queryable from a *different* `DirectoryNode` instance than the one that processed the registration (proving it was persisted, not held in-process)"

> "...AND `bootstrapKeyShares` was NOT the code path taken — verified by the test running with `NODE_ENV` unset or by asserting stream open count > 0 on each directory node"

Examples of `then` clauses that are NOT stub-resistant (these allow hollow tests):
> "Returns `{ registered: true, primary_pubkey }`" — any stub can return this shape.

> "The DKG ceremony completes and primary_pubkey is 32 bytes" — `trustedDealer` produces this in-process.

> "A subsequent FROST signature verifies against primary_pubkey" — also satisfiable in-process via `bootstrapKeyShares`.

**The test that verifies a result-only `then` clause will always pass via a stub.** If you cannot name a transport-level or cross-instance observable in the `then` clause, the AC is not specifying integration behavior — it is specifying unit behavior with an inflated `test_type` label.

This rule exists because: the test harness is hermetic and perfectly blind to real-world setup requirements. Unit/integration tests that pass in a single process tell you nothing about whether the protocol works between separate processes.

---

## Before writing any story

1. Read `docs/planning/user-story-format.md` — the canonical template and field reference.
2. Read `docs/planning/protocol-map.md` — confirm the domain and milestone for the story.
3. Check `docs/planning/user-stories/{milestone}/` — see what stories already exist.

## Step 1: Is there an E2E story for this milestone?

Look for a story with `domain: End-to-End` or `test_type: e2e` ACs that cover the scenario you're about to specify.

**If no E2E story exists for this milestone: write it first. Do not write component stories until it exists.**

The E2E story describes the full scenario from the outside:
- Two real agents (running as MCP servers)
- Real relay and directory nodes (running as processes)
- The complete protocol flow from first tool call to final observable outcome
- Every data dependency named explicitly: "Agent A's peer ID and listen addresses must be known to the directory before step N"

If writing the E2E story reveals data that "must be known" without a named protocol step that produces it — **that is a spec gap. Write the missing step as a behavior/AC before proceeding.**

## Step 2: Write component stories

For each protocol step or component behavior the E2E story requires:
- Write one component story per distinct behavior unit
- In the component story's `references`, link back to the E2E story that exercises it
- For every data field in the story's output: name the protocol step that populates it in the behavior section

**Red flag check before writing each component story:**
- Does a method exist to store/produce this data? → Who calls it in the live flow? Name the caller explicitly.
- Is a field described in the output shape? → Which AC describes how it gets populated, not just that it's present?

## Database Schema Stories (M5+ rules)

If the story introduces new database tables or modifies existing ones, apply these rules extracted from the M5 retrospective:

### Rule 1: Thoroughly Assess Schema Requirements

During the Architecture phase, reason through **all use cases** that will touch the table — not just the immediate story's requirements.

**Example from M5:** FEDERATION-001 created `checkpoint_node_signatures` without the `UNIQUE (checkpoint_id, node_id)` constraint. Only when FEDERATION-002 implemented coordinator logic did the gap surface. By then V18 was applied and parallel stories had claimed later version numbers, forcing cascading renumbers.

**The question to ask:** "If three nodes are cross-signing, what prevents duplicate signatures?" should have been asked in FEDERATION-001, not discovered in FEDERATION-002.

**For schema stories, the Architecture phase must:**
1. List every operation the table will support (not just what this story needs)
2. Identify all uniqueness constraints by reasoning through conflict scenarios
3. Specify indexes for every query pattern (not just the obvious one)
4. Check foreign key relationships with all related tables (including ones not in this milestone)
5. Validate RLS policies cover all access patterns (read-only observers, multi-tenant isolation, append-only constraints)

### Mitigation C: Schema-Complete-First for Parallel Milestones

If the milestone has parallel stories that will all touch the database, **one story must produce the complete schema design before any parallel implementation begins.**

**M6 example:** OPS-AGENT-000 is a P0 design story that:
- Defines all TypeScript interfaces
- Writes all migration SQL for the registration state machine
- Reserves all migration version numbers (V24+)
- Populates the Migration Version Registry in COORDINATION.md
- Gates all downstream stories (001-005B) on AC-010 passing

This eliminates reactive mid-milestone migrations and version number conflicts.

### Mitigation B: Integration Gate ACs with Flyway Verification

Every database story that adds or modifies migrations must include a blocking integration gate AC as its final acceptance criterion.

**Standard AC language for migration stories:**

```yaml
- id: AC-[N]-integration-gate
  given: "All migration SQL files produced by this story"
  when: "applied to a local PostgreSQL instance that already has all prior
    M{N} migrations applied (V1 through V[N-1])"
  then: "Flyway reports zero checksum errors on any migration; the new
    migration(s) apply cleanly; all tables, indexes, constraints, and RLS
    policies are created as specified"
  test_type: integration
  component_under_test: directory
  notes: "This is the Mitigation B integration gate AC. It must pass before
    this branch merges. No downstream story may begin implementation until
    this story's integration gate AC is verified and the story is merged."
```

**Key constraint:** The AC runs against an environment with prior migrations **already applied** — not a fresh database. A fresh database will not catch the FEDERATION-002 pattern where a previously-applied migration gets modified.

### Migration Version Registry (parallel milestones only)

For milestones with parallel database work, the COORDINATION.md must include a Migration Version Registry table:

```markdown
## Migration Version Registry

M{N} migrations start at **V{X}**. All version numbers are reserved by
{SCHEMA-DESIGN-STORY-ID} before parallel implementation begins. No story
may claim a migration version not listed here.

| Version | Story | Table/Purpose |
|---|---|---|
| V{X} | {STORY-ID} | {table_name} — {purpose} |
| V{X+1} | {STORY-ID} | {table_name} — {purpose} |
```

The schema-design story (e.g., OPS-AGENT-000) populates this registry as part of its integration gate AC. No downstream story may add a migration not listed here.

---

## Persistence Serialization Stories (M4+ rules)

If the story persists any domain object — via JSON, a database adapter, or any serialize/deserialize round-trip — apply these rules. This failure class is silent: the bytes come back correctly, the structural checks pass, and the bug only surfaces when a crypto or typed operation tries to use the deserialized value.

**The PERSIST-005 incident (2026-06-02):** `PersistentShareStore` used `JSON.stringify` to serialize `LocalShare`, which contains `FrostSecret.signingShare: Uint8Array`. `JSON.stringify` converts `Uint8Array` to `{"0":1,"1":2,...}`. `JSON.parse` restores a plain object — not a `Uint8Array`. `@noble/curves` `signShare()` threw on the plain object. The catch mapped it to `AGENT_NOT_BOOTSTRAPPED`, which surfaced as `directory_below_threshold`. The shares were written. The shares were loaded. The bytes matched. The type was gone.

**The rule:** Any story that serializes a typed domain object must include an AC that:

1. Uses a **real instance** of the domain object — not `randomBytes(N)`, not a plain object literal. If the real type has a `Uint8Array` field, the test must use the real type with a real `Uint8Array` in that field.
2. Verifies the loaded object can be **used for its actual purpose** after deserialization — not just that `bytes_in === bytes_out`. For a FROST share: sign something. For a key: encrypt/decrypt. For a connection record: pass it to the handler that consumes it.
3. If the persistence survives process restarts, **at least one AC must cross a restart boundary**: persist in process A, load in a fresh process B, use in process B.

**The test that only checks `bytes_in === bytes_out` is testing the encryption layer, not the domain correctness.** It will pass even when the type is corrupted. Both checks are required — but byte equality alone is not sufficient.

**What a passing serialization AC looks like:**

```yaml
- id: AC-[N]-serialization-round-trip
  given: "A real [DomainObject] instance constructed via its normal production
    path (e.g. the output of a DKG ceremony, not a plain object literal)"
  when: "the object is serialized, persisted, the process is restarted,
    the object is loaded and deserialized"
  then: "the deserialized object can be passed to [the operation that consumes it]
    and that operation succeeds — verified by [specific observable: a signature
    verifies, a decryption succeeds, a handler returns without error]"
  test_type: integration
  component_under_test: [component]
  notes: "Byte equality between original and deserialized bytes is also
    asserted, but is not sufficient alone — type integrity must be verified
    by exercising the deserialized object in its actual production use."
```

**The broader concern:** Any adapter that calls `JSON.stringify/parse` on an object containing `Uint8Array`, `Buffer`, `BigInt`, `Date`, `Map`, `Set`, or any class instance is a serialization hazard. Before writing the story, enumerate every field in the domain object being persisted and confirm the serialization format preserves its type through the round-trip.

---

## Observability ACs (mandatory from M4)

Every story that touches M4+ code must include explicit observability acceptance criteria. Observability is not an implementation detail — it is a first-class AC like any other.

**For each significant state transition in the story, the ACs must specify:**

1. **Named log event** — the exact event name in `domain.noun.verb` format. "Something is logged" is not an AC. `session.started` is.
2. **Required context fields** — the minimum fields the log event must carry. Example: `session.started` requires `{ sessionId, agentId, relayId, principalType }`.
3. **Correlation ID** — for any async or multi-process flow, the AC must assert that a `correlationId` minted at flow initiation is present on every log event in that flow.
4. **Error path coverage** — every error path in the story has a named error event with enough context to diagnose without a debugger. Example: `session.relay.assignment.failed` with `{ sessionId, reason, relayId }`.
5. **Alert thresholds** — for any new failure mode introduced by this story, an AC specifies the CloudWatch alarm condition. Example: "a `session.relay.assignment.failed` rate > 5% over 5 minutes fires the relay-health alarm."

**Event naming convention:** `domain.noun.verb` — e.g. `frost.dkg.round1.complete`, `session.seal.failed`, `relay.health.degraded`. Check the event taxonomy in [[2026-05-16_0753_development-pipeline-and-local-iteration]] before inventing new names. Add new names to the taxonomy rather than using ad-hoc strings.

**The Logger interface:**
```typescript
interface Logger {
  info(event: string, context: Record<string, unknown>): void
  warn(event: string, context: Record<string, unknown>): void
  error(event: string, error: Error, context: Record<string, unknown>): void
}
```

Events go through the `Logger` interface, not `console.log`. The implementation is injected via the composition root — never imported directly.

**What bad observability ACs look like:**
- "Errors are logged" — no event name, no context fields
- "The session start is observable" — too vague to verify
- "Logs include the session ID" — event name still missing

**What good observability ACs look like:**
- "`session.started` is logged at INFO with `{ sessionId, agentId, relayId }` within the session establishment path"
- "If relay assignment fails, `session.relay.assignment.failed` is logged at WARN with `{ sessionId, reason, availableRelayCount }`"
- "All log events in the FROST DKG flow carry the same `correlationId` minted when the ceremony is initiated"

---

## Step 3: Validate before declaring ready

For each story, run through the Definition of Ready checklist from `user-story-format.md`:

- [ ] **System-wide invariants are restated inline, not just linked.** For every mechanism this story specifies, ask: was this mechanism shaped by a constraint in an earlier discussion log or in CLAUDE.md (e.g. cloud-agnostic transport, sovereign node independence, no AWS-specific networking, cross-provider compatibility)? If yes, restate the constraint explicitly in the story's `story`, `behavior`, or `acceptance_criteria` sections — not as a reference link, and **not in `implementation_notes`**. `implementation_notes` is implementer guidance; it is not part of the spec. An implementer who skips notes and reads only behavior + ACs must still encounter every load-bearing constraint. A story that is self-contained enough to implement from must carry the constraints that govern it, not rely on an implementer re-reading prior documents or notes. *Rationale: FEDERATION-001 read the April 11 persistence design document, found it self-contained, reached for VPC Peering as the obvious transport for Postgres replication, and never re-read the April 8 document that established the multi-cloud constraint. The mechanism (Postgres logical replication) was correct; the transport implementation was not. The April 11 document inherited the constraint through the live conversation that produced it — but that inheritance did not survive into the implementation context. One sentence in April 11 would have closed the gap entirely.*
- [ ] Every data field has a named protocol step that produces it
- [ ] At least one E2E story exercises this component's output
- [ ] No AC says "something will call registerX later" — the caller is named
- [ ] `test_type: e2e` ACs specify "real nodes, no mocks"
- [ ] Every `test_type: integration` or `test_type: e2e` AC that describes a multi-party protocol asserts the transport path (stream opens, handler invocations, frame counts) — not only the final return value
- [ ] No AC would pass if `NODE_ENV=test` routed through a stub shortcut instead of the real protocol
- [ ] The story does NOT require implementing a new `makeFixture()` — test infrastructure comes from `packages/e2e-tests/src/session-fixture.ts`; if a new capability is needed, the fixture is extended with a new `opts` field (with a non-breaking default), not replaced or duplicated
- [ ] **(M4+ persistence stories)** If the story serializes any domain object to JSON, a database column, or any other format: (a) at least one AC uses a **real instance** of the domain type (not `randomBytes(N)`), (b) at least one AC verifies the deserialized object works in its **actual production use** (sign, decrypt, pass to handler — not just byte equality), and (c) if the persistence survives restarts, at least one AC crosses a **process restart boundary**. *Rationale: PERSIST-005 used `JSON.stringify` on `LocalShare.signingShare: Uint8Array`, which JSON corrupts silently to a plain object. Bytes round-tripped correctly; the type did not. The bug only surfaced when `@noble/curves` tried to use the value.*
- [ ] **(M4+ adapter stories)** If the story touches any adapter that calls `deserializeRow()` or adds to `BIGINT_COLUMNS`, at least one AC must be a live round-trip type test: write a known BIGINT value to the real database, read it back, and assert `typeof result === 'number'` for each declared column. A static gate (PERSIST-021 AC-005) checks map completeness; this test checks coercion correctness. Both are required. *Rationale: BIGINT-as-string hit twice in M4 (initial integration tests + first live session) under a "should" policy. A class of bug that recurs under a recommendation is evidence the recommendation won't self-enforce.*
- [ ] **(M4+)** Every significant state transition has a named log event in `domain.noun.verb` format
- [ ] **(M4+)** Every named log event specifies its required context fields
- [ ] **(M4+)** Async/multi-process flows assert `correlationId` threading through all events in the flow
- [ ] **(M4+)** Every error path has a named error event with sufficient diagnostic context
- [ ] **(M4+)** New failure modes introduced by this story have a corresponding alarm threshold AC
- [ ] **(M4+)** All event names appear in (or are proposed additions to) the event taxonomy in [[2026-05-16_0753_development-pipeline-and-local-iteration]]
- [ ] **(M5+ schema stories)** If the story adds or modifies database tables, the Architecture phase reasoning is documented in the story notes: all operations the table supports, uniqueness constraints with conflict scenarios, indexes for all query patterns, foreign key relationships, RLS policy coverage
- [ ] **(M5+ parallel milestones with DB changes)** If the milestone has parallel database work, one P0 schema-design story exists that reserves all migration version numbers and populates the Migration Version Registry in COORDINATION.md before any parallel implementation begins
- [ ] **(M5+ migration stories)** The story includes a blocking integration gate AC that applies migrations to a PostgreSQL instance with all prior migrations already applied and verifies zero Flyway checksum errors

## What the shared fixture already covers

Before writing test infrastructure into a story's ACs or notes, check whether `packages/e2e-tests/src/session-fixture.ts` already covers it. Current capabilities (as of M3):

| Capability | How to request |
|---|---|
| Relay + directory + 2 agents + FROST for A | `createSessionFixture()` (default) |
| MCP server+client pair for each agent | `opts.withMcp: true` |
| FROST bootstrapped for B (B can initiate) | `opts.bootstrapB: true` |
| Real DKG registration for both agents | `opts.register: true` |
| Connection policy on A or B | `opts.policyA` / `opts.policyB` |
| Directory connection gate (SESSION-006) | `opts.requireConnectionGate: true` |
| Registration required on directory | `opts.requireRegistration: true` |
| Round-2 disclosure timeout for B | `opts.round2TimeoutMs: N` |
| B's evaluate call count (transport evidence) | `opts.trackEvaluateCount: true` |
| B accepts a pubkey without policy eval | `opts.whitelist: [pubkeyHex]` |
| Directory↔relay via /cello/directory-relay/1.0.0 (NODE-004) | `opts.networkRelay: true` |

If a story needs infrastructure beyond this list, the implementer must extend the fixture with a new `opts` field — not write a new fixture function.

## File naming

```
docs/planning/user-stories/{m0|m1|m2|...}/CELLO-{DOMAIN}-{number}.yaml
```

Use the next sequential number within the domain. Check existing files to avoid collisions.

## After writing stories

Run `/cello-link` to wire the new story files into the vault graph.
