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

## Step 3: Validate before declaring ready

For each story, run through the Definition of Ready checklist from `user-story-format.md`:

- [ ] Every data field has a named protocol step that produces it
- [ ] At least one E2E story exercises this component's output
- [ ] No AC says "something will call registerX later" — the caller is named
- [ ] `test_type: e2e` ACs specify "real nodes, no mocks"
- [ ] Every `test_type: integration` or `test_type: e2e` AC that describes a multi-party protocol asserts the transport path (stream opens, handler invocations, frame counts) — not only the final return value
- [ ] No AC would pass if `NODE_ENV=test` routed through a stub shortcut instead of the real protocol
- [ ] The story does NOT require implementing a new `makeFixture()` — test infrastructure comes from `packages/test-fixtures/src/session-fixture.ts`; if a new capability is needed, the fixture is extended with a new opt, not replaced

## File naming

```
docs/planning/user-stories/{m0|m1|m2|...}/CELLO-{DOMAIN}-{number}.yaml
```

Use the next sequential number within the domain. Check existing files to avoid collisions.

## After writing stories

Run `/cello-link` to wire the new story files into the vault graph.
