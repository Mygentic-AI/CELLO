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

**Do your homework first.** A story written without understanding the surrounding codebase and design history will miss constraints, duplicate existing behavior, or specify something the implementation cannot satisfy. This is not optional prep — it is how you avoid writing a story that fails review.

1. Read `docs/planning/user-story-format.md` — the canonical template and field reference.
2. Read `docs/planning/protocol-map.md` — confirm the domain and milestone for the story.
3. Check `docs/planning/user-stories/{milestone}/` — see what stories already exist and what COORDINATION.md says about migration versions and parallel work.
4. Read `.claude/CLAUDE.md` — the system-wide invariants. Any story you write is subject to every constraint in this file, whether or not the story mentions it.
5. Read `CONTEXT.md` at the repo root — canonical glossary. Use only terms defined here.
6. **If the story touches infrastructure in any way** — CloudFormation templates, `deploy.sh`, ECS task definitions, CI/CD pipelines, `pipeline-mappings.json`, AWS secrets/SSM parameters, Flyway migration versions, or any resource under `infra/` — **read `infra/CLAUDE.md` before writing a single AC.** It contains mandatory rules (migration version sync, pipeline mappings deployment, IaC-only resource creation, STATE.md updates) that directly govern what ACs must require and what the implementation must do. Violations of these rules have caused crash-loops and silent pipeline outages in the past.
6. **Search the discussion logs for anything relevant to the domain you are writing about.** Run:
   ```bash
   grep -rl "<keyword>" docs/planning/discussion_logs/
   ```
   Read any log that covers the mechanism, component, or design decision your story touches. Constraints established in discussion logs often do not appear in CLAUDE.md — they live only in the log. A story author who skips this step will write stories that violate constraints the team already resolved.
7. **Read the relevant implementation files** before writing behavior triggers and ACs. If the story touches `CelloClient`, read the parts of `packages/client/src/client.ts` that the story will change. If it touches the MCP server, read `packages/adapter-claude-code/src/bin/cello-mcp.ts`. ACs written without reading the implementation produce mismatched interface names, wrong type names, and behaviors that can't be tested the way you described.
8. **Check the milestone outline** — read `docs/planning/user-stories/{milestone}/outline.md` for the design decisions and architecture choices that individual stories are expected to honor.

## Ask before you write

After doing your homework, stop and ask the operator any question where the answer will materially change what you write. Do not embed an assumption in an AC when you could ask instead — a wrong assumption baked into a story propagates into implementation and review before it surfaces.

**Questions worth asking before writing:**

- **Scope boundaries** — "The outline says X is out of scope, but AC-003 in the previous story seems to require it. Should this story include it or stub it?"
- **Design decisions not yet made** — "I found two approaches in the discussion logs and neither was chosen. Which one should I spec?"
- **Deferred behavior from prior stories** — "PERSIST-024 left Y as a TODO. Should this story close it, or is it still deferred?"
- **Conflicts between the outline and existing code** — "The outline says the DB path convention is X, but the current code does Y. Which is authoritative?"
- **Test infrastructure gaps** — "This story needs the fixture to support Z. I don't see that in session-fixture.ts. Should I extend it here or write a separate story first?"
- **Milestone close gate implications** — "Does this story need to pass the milestone close gate by itself, or is it only exercised via the E2E story?"

**Do not ask about things you can determine yourself** by reading the code, discussion logs, or CLAUDE.md. The operator's time is for genuine ambiguity — not for questions that five minutes of reading would answer.

**If the operator is not available:** make your assumption explicit at the top of the story's `implementation_notes` — "Assumed X because Y. If this is wrong, the behavior trigger and AC-003 need to change." This makes the assumption visible at review time rather than invisible at implementation time.

---

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

## Shared Interface Completeness — the general rule

**Before writing any AC for a story that introduces or modifies a shared interface, enumerate every producer and every consumer of that interface.** A shared interface is anything multiple components exchange: a database table, a persisted domain object, a registration message, a manifest, a message frame field, an in-memory cache populated by one component and read by another.

The failure pattern is always the same: the story is written from one participant's perspective. The author fixes the presenting problem for the consumer they can see, never asks "who else reads this?", and the other consumers break silently. Stories that enumerate only the presenting consumer are incomplete by definition.

**The question to ask before writing ACs:**
> For every shared datum this story touches — who produces it, and who consumes it? Does each producer have an AC? Does each consumer have an AC?

The three sections below are known cases of this failure, each with its own mechanics. The general rule above applies to all of them and to any case not listed.

---

### Known case 1: Database schema (M5+ rules)

**Trigger:** story introduces or modifies database tables.

**The risk:** a table designed for the story's immediate use cases missing constraints, indexes, or RLS policies that parallel or downstream stories require. Discovered late, after the migration is applied, forcing cascading version renumbers. *(FEDERATION-001/002 — missing UNIQUE constraint discovered only when FEDERATION-002 implemented coordinator logic; V18 already applied, parallel stories had claimed later numbers.)*

**Architecture phase must enumerate:**
1. Every operation the table supports — not just what this story needs
2. Uniqueness constraints for all conflict scenarios
3. Indexes for all query patterns
4. Foreign key relationships with all related tables
5. RLS policies for all access patterns (read-only observers, multi-tenant isolation, append-only)

Document this reasoning in a comment block at the top of the migration file or in the story notes before writing ACs.

**For parallel milestones with DB changes:** one P0 schema-design story reserves all migration version numbers and populates COORDINATION.md's Migration Version Registry before any parallel implementation begins. No downstream story may claim an unregistered version.

**Integration gate AC (required on every migration story):**
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
  notes: "Runs against prior-migrations-applied, not a fresh DB — catches
    the FEDERATION-002 pattern where a previously-applied migration is modified."
```

---

### Known case 2: Persistence serialization (M4+ rules)

**Trigger:** story persists any domain object via JSON, a database adapter, or any serialize/deserialize round-trip.

**The risk:** serialization silently destroys typed fields. Bytes round-trip correctly; the type is gone; the bug surfaces only when a crypto or typed operation tries to use the deserialized value — by then the error is mapped to a generic code with no hint of the real cause. *(PERSIST-005 — `JSON.stringify` on `LocalShare.signingShare: Uint8Array` corrupted the type to a plain object. Byte equality passed. `@noble/curves` threw. The catch returned `directory_below_threshold`.)*

**Every persistence story must include an AC that:**
1. Uses a **real instance** of the domain type — not `randomBytes(N)` or a plain object literal
2. Verifies the deserialized object works in its **actual production use** — for a FROST share: sign something; for a key: encrypt/decrypt; for a connection record: pass it to the handler
3. If persistence survives restarts: **crosses a process restart boundary** — persist in process A, load in a fresh process B, use in process B

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
  notes: "Byte equality is also asserted, but is not sufficient alone —
    type integrity must be verified by exercising the object in production use."
```

Before writing the story, enumerate every field of the domain object being persisted. Any `Uint8Array`, `Buffer`, `BigInt`, `Date`, `Map`, `Set`, or class instance field is a serialization hazard under bare `JSON.stringify/parse`.

---

### Known case 3: Service registration and address propagation

**Trigger:** story changes how a service registers, announces, or publishes its address — relay registration, manifest re-sign, any `relay_register` / `registerWithDirectory` / health-check update flow.

**The risk:** a service has multiple consumers of its address. The story fixes the presenting consumer (the one that was recently broken) and never enumerates the others. Each unaddressed consumer breaks silently on the next address change. *(M6B-006 — fixed relay address propagation for the S3/manifest path. Never enumerated `NetworkRelayAdapter` in the directory as a second consumer. The close gate only verified the manifest path. The adapter broke on every ECS task replacement.)*

**Before writing ACs, answer:** every component that needs to reach [service X] — list them all. For each consumer, the story must include an AC verifying it can reach the service after an address change. The close gate must name and verify each consumer's path independently.

**API field rule:** registration/announcement message fields must name their intent explicitly. Do not reuse an existing field as a carrier for unrelated data. If the relay's current address needs to be known, add a `multiaddr` field — do not parse it out of `healthCheckUrl`. Fields are free; clarity is load-bearing.

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

**Canonical observability YAML format** — use exactly these field names. `fields` and `context` are wrong; they will fail the `/cello-review` Step 4c check.

```yaml
observability:
  events:
    - name: session.started
      level: info
      trigger: "When a session is established between two agents"
      context_fields: [sessionId, agentId, relayId]
      correlationId: true
  error_events:
    - name: session.relay.assignment.failed
      level: warn
      trigger: "When the relay assignment step fails during session setup"
      context_fields: [sessionId, reason, availableRelayCount]
      correlationId: true
  notes: >
    session.started and session.relay.assignment.failed must be added to
    the canonical event taxonomy in
    docs/planning/discussion_logs/2026-05-16_0753_development-pipeline-and-local-iteration.md
    by the implementer of this story.
  alarms:
    - condition: "session.relay.assignment.failed rate > 5% over 5 minutes"
      fires_to: "relay-health CloudWatch alarm"
```

If `alarms` is empty, it must include a `notes` field explaining why no alarm is warranted — a bare `alarms: []` is not acceptable. Example: `alarms: [] # no alarm: this is a synchronous startup op; failure is visible immediately in cello_start_agent return value`

**Observability events must be verified by ACs, not just declared in the observability block.** Listing events in the `observability:` section is metadata for the implementer — it is not a test. For each significant event, there must be a corresponding entry in `acceptance_criteria` with a `then` clause that asserts the event fired with the correct name and context fields. Without an AC, the implementer can omit the log call entirely and every test will still pass.

**What bad observability looks like:**
- Events listed only in the `observability:` block with no AC verifying they fire
- "Errors are logged" in an AC — no event name, no context fields
- `fields: [sessionId]` — wrong field name; must be `context_fields`

**What good observability looks like:**
- An AC with `then: "... AND 'session.started' is logged at INFO with sessionId, agentId, and relayId fields"`
- A separate AC for the error path: `then: "session.relay.assignment.failed is logged at WARN with sessionId, reason, and availableRelayCount"`
- "All log events in the FROST DKG flow carry the same `correlationId` minted when the ceremony is initiated"

---

## Writing Security Invariants

Every SI must pair a `statement` with an `adversarial_condition` that describes a concrete attack or misuse scenario — not a structural assertion.

**Wrong (structural assertion — does not test the invariant):**
```yaml
adversarial_condition: "verified by asserting that alice's KeyProvider reference
  is unreachable from bob's client instance"
```
This just checks that two object references differ. A bug where both clients share the same Map but return different references would pass it.

**Right (adversarial simulation — actually tests the invariant):**
```yaml
adversarial_condition: "a message handler executing on alice's CelloClient
  attempts to retrieve a KeyProvider from the AgentRegistry by name — it can
  only retrieve alice's KeyProvider, not bob's; verified by asserting that
  calling registry.getKeyProvider('bob') from within alice's message handler
  returns alice's key or throws, never bob's"
```

The test must actively trigger the adversarial condition and assert the system resists it. An SI whose adversarial condition is only verified by an absence check ("X is not accessible") is not a test — it is a wish. Name the attack, describe what happens when the attacker succeeds, and assert that it does not succeed.

---

## Step 3: Validate before declaring ready

For each story, run through the Definition of Ready checklist from `user-story-format.md`:

- [ ] **Vault frontmatter is present.** The story YAML must include top-level fields `name`, `type`, `date`, `topics`, `status`, and `description`. These are required for `/cello-link` to index the file into the vault graph. Without them the story is invisible to vault navigation.
- [ ] **System-wide invariants are restated inline, not just linked.** For every mechanism this story specifies, ask: was this mechanism shaped by a constraint in an earlier discussion log or in CLAUDE.md (e.g. cloud-agnostic transport, sovereign node independence, no AWS-specific networking, cross-provider compatibility)? If yes, restate the constraint explicitly in the story's `story`, `behavior`, or `acceptance_criteria` sections — not as a reference link, and **not in `implementation_notes`**. `implementation_notes` is implementer guidance; it is not part of the spec. An implementer who skips notes and reads only behavior + ACs must still encounter every load-bearing constraint. A story that is self-contained enough to implement from must carry the constraints that govern it, not rely on an implementer re-reading prior documents or notes. *Rationale: FEDERATION-001 read the April 11 persistence design document, found it self-contained, reached for VPC Peering as the obvious transport for Postgres replication, and never re-read the April 8 document that established the multi-cloud constraint. The mechanism (Postgres logical replication) was correct; the transport implementation was not. The April 11 document inherited the constraint through the live conversation that produced it — but that inheritance did not survive into the implementation context. One sentence in April 11 would have closed the gap entirely.*
- [ ] Every data field has a named protocol step that produces it
- [ ] At least one E2E story exercises this component's output
- [ ] No AC says "something will call registerX later" — the caller is named
- [ ] `test_type: e2e` ACs specify "real nodes, no mocks"
- [ ] Every `test_type: integration` or `test_type: e2e` AC that describes a multi-party protocol asserts the transport path (stream opens, handler invocations, frame counts) — not only the final return value
- [ ] No AC would pass if `NODE_ENV=test` routed through a stub shortcut instead of the real protocol
- [ ] The story does NOT require implementing a new `makeFixture()` — test infrastructure comes from `packages/e2e-tests/src/session-fixture.ts`; if a new capability is needed, the fixture is extended with a new `opts` field (with a non-breaking default), not replaced or duplicated
- [ ] **If any test in the story requires a pre-registered agent identity, persisted FROST shares in an external directory, or any resource that `createSessionFixture()` cannot provide in-process:** the story's ACs must note that every top-level `describe` block in that test file must be wrapped with `describe.skipIf(!process.env.CELLO_E2E_LIVE)` using the `liveOnly` pattern. Tests using only in-process `createSessionFixture()` nodes do not need this guard. *Rationale: mcp-002 and mcp-003-e2e failed in CI for months with errors indistinguishable from real regressions — masking any actual new failure in those files.*
- [ ] **(M4+ persistence stories)** Real domain instance used in AC (not `randomBytes(N)`), deserialized object verified in production use (not just byte equality), restart boundary crossed if persistence survives restarts. *See "Known case 2: Persistence serialization" above.*
- [ ] **(M4+ adapter stories)** If the story touches any adapter that calls `deserializeRow()` or adds to `BIGINT_COLUMNS`, at least one AC must be a live round-trip type test: write a known BIGINT value to the real database, read it back, and assert `typeof result === 'number'` for each declared column. PERSIST-021 AC-005 is the static map-completeness gate; this live test is the coercion-correctness gate. **Both are required.** *(BIGINT-as-string hit twice in M4 under a "should" policy — a class of bug that recurs under a recommendation will not self-enforce.)*
- [ ] **(M4+)** Every significant state transition has a named log event in `domain.noun.verb` format
- [ ] **(M4+)** Every named log event specifies its required context fields
- [ ] **(M4+)** Async/multi-process flows assert `correlationId` threading through all events in the flow
- [ ] **(M4+)** Every error path has a named error event with sufficient diagnostic context. **Each distinct failure cause must produce a distinct error code or event name** — never map multiple causes to the same error. A catch block that returns `directory_below_threshold` for timeout, exhausted, AND unavailable is a single undifferentiated error: the operator cannot act on it. *Rationale: M6B-002 — three FROST failure modes all surfaced as `directory_below_threshold`, making the error useless for diagnosis.*
- [ ] **(M4+) Lateral catch audit AC required.** If this story touches any package that contains catch blocks with hardcoded reason strings, the story must include an explicit AC requiring the implementer to scan ALL catch blocks in ALL files in that package — not only the files the story changes — and fix any that silently swallow exceptions. The AC must read: "The implementer scans every catch block in `packages/{name}/src/` and either fixes or reports any pre-existing catch that returns a hardcoded reason string without logging the actual exception message." This AC makes the lateral audit mandatory and visible to the reviewer. *Rationale: M6B-002 fixed FROST paths in `directory-node.ts` but a silent swallowing catch in `network-relay-adapter.ts` — same package, untouched by the story — masked the real relay failure reason for months. Neither the story, the coder, nor the reviewer was required to look beyond the changed files.*
- [ ] **Shared interface completeness.** For every shared datum this story touches (registration message, manifest, DB table, persisted object, in-memory cache), all producers and consumers are enumerated and each has its own AC. See the three known cases above; the general rule applies to any case not listed.
  - Registration/address change: every consumer of the service's address has its own AC; close gate names each independently. *(M6B-006 — `NetworkRelayAdapter` uncovered.)*
  - In-memory state derived from DB: AC verifies reconstruction after restart; AC specifies refresh schedule if data can change externally. *(M6B-010 — directory lost in-flight state; M6B-008 — manifest never refreshed.)*
- [ ] **If the story introduces any unbounded resource** — DB connection pool, in-memory map, stream concurrency, queue depth — the story specifies the cap and includes an AC for graceful degradation at the cap. *(M6B-009 — pg pool of 10 exhausted silently.)*
- [ ] **(M4+)** New failure modes introduced by this story have a corresponding alarm threshold AC
- [ ] **(M4+)** All event names appear in (or are proposed additions to) the event taxonomy in [[2026-05-16_0753_development-pipeline-and-local-iteration]]
- [ ] **(M5+ schema stories)** Architecture phase reasoning documented in story notes: all operations the table supports, uniqueness constraints, indexes, foreign keys, RLS policies. Integration gate AC present. For parallel milestones: migration version numbers reserved in COORDINATION.md by a P0 schema-design story before parallel work begins. *See "Known case 1: Database schema" above.*

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

## Cross-Repo Dependency Stories (mandatory from M7)

If the story modifies any code in `cello-client` packages (`core/crypto`, `core/transport`, `core/protocol-types`, `core/client`, `core/adapter-claude-code`), the story **must** include two additional blocking ACs:

**AC-[N]-version-bump:**
```yaml
- id: AC-[N]-version-bump
  given: "All cello-client code changes for this story are implemented and tests pass"
  when: "the implementer runs the version bump procedure in cello-client CLAUDE.md"
  then: |
    - Every modified package has its version incremented in package.json
    - Every package that depends on a modified package has its dependency version updated
    - @cello-protocol/connect is bumped to reflect the net change
    - pnpm install is run and pnpm-lock.yaml is updated
    - git tag v{connect-version} is pushed to origin
    - CI publishes the new version to npm beta dist-tag
    - `npm view @cello-protocol/connect@beta dependencies --json` shows real semver versions (never workspace:*)
  test_type: integration
  component_under_test: cello-client CI
  notes: "This is a hard gate. A story that changes cello-client code without publishing a new version breaks every operator on the stale version."
```

**AC-[N+1]-trustless-cello-dependency-update:**
```yaml
- id: AC-[N+1]-trustless-cello-dependency-update
  given: "The new @cello-protocol/connect version is live on npm beta"
  when: "packages/directory/package.json and packages/relay/package.json in trustless-cello are updated"
  then: |
    - Both package.json files reference the new semver ranges for all modified packages
    - No workspace:* references to @cello-protocol/crypto, transport, protocol-types, or client remain
    - pnpm install is run and pnpm-lock.yaml is updated
    - pnpm run typecheck passes in trustless-cello
    - Commit pushed to trustless-cello main
  test_type: integration
  component_under_test: directory
  notes: "workspace:* resolves to stale local copies post-REPOSPLIT-002. This AC ensures directory and relay run against the published version."
```

**Do not write a cello-client story without both of these ACs.** A story that ships code changes without the version bump and the trustless-cello update creates invisible drift — directory and relay appear to work because they compile against the stale local copy, but they are not running the new code.

---

## After writing stories

Run `/cello-link` to wire the new story files into the vault graph.
