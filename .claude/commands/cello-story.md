---
name: cello-story
description: Write new CELLO user stories — few, critical, stub-resistant ACs, E2E-first. Write the E2E story before component stories.
---

# /cello-story

Write new CELLO user stories. Two jobs: get the ACs **few and strong**, and keep **E2E-first** ordering (the M1 peer-info gap came from violating it).

## 1. The AC quality bar — read before writing a single AC

**Write the fewest ACs that each pin a real behavior.** The failure mode to avoid is the kitchen sink — an AC for every category, each easy to satisfy, none clearly load-bearing. Three tests every AC must pass:

1. **It traces to the done-condition or a named invariant.** If an AC ladders up to neither, cut it. The DoD done-condition is the anchor; ACs decompose it into the few checks that prove it — they do not enumerate every conceivable property.
2. **It is stub-resistant** (see below). If an implementation could satisfy it while doing the wrong thing, it's a unit assertion wearing an integration label — rewrite it, don't pad three more beside it.
3. **It is one authoritative behavior.** No restating the same property at a different altitude.

**Prefer 5 ACs each hard to fake over 15 each easy to satisfy.** The test-attacker (`cello-test-attacker`) will expose the easy ones as hollow tests downstream — so you pay twice for a kitchen sink. Write them strong the first time.

### Stub-resistance — how to write a `then` clause

The deepest rule: **stories describe production behavior, not test-harness behavior.** The M2/M3 failure was implementation routing through a `NODE_ENV=test` shortcut (`bootstrapKeyShares`, in-process stubs) while every AC passed green — the real multi-party protocol was never exercised.

For every `integration` / `e2e` AC, the `then` clause must **name an observable only reachable via the real path.** Two categories work:
- **Transport evidence** — a stream opened, a protocol handler invoked, a frame sent. A stub never touches the network stack.
- **Cross-process state** — a value held by participant B (a *different* libp2p / DirectoryNode instance) that it could only hold if the wire protocol ran.

Two questions to falsify an AC:
- "Would this pass if `NODE_ENV=test` routed around the real protocol?" If yes → underspecified.
- "Would this pass if the two participants were in different OS processes on different machines?" If no → underspecified.

Stub-resistant: *"...each of the 3 directory instances received a `/cello/frost/1.0.0` stream open from the agent"*; *"...the AgentProfile is queryable from a different DirectoryNode instance than the one that registered it."*
Not stub-resistant: *"returns {registered:true, primary_pubkey}"*; *"DKG completes, primary_pubkey is 32 bytes"* — any in-process stub produces these.

### Then prune

After drafting the ACs, go back through them once:
- **Fake test** — apply the test-attacker question to each: "could an implementation satisfy this while doing the wrong thing?" Weak ones get rewritten stub-resistant, or cut.
- **Trace test** — does it prove the done-condition or guard a named invariant? If neither, cut it.
- **Don't carry what the gate proves.** Production-faithfulness (real wiring, real transport) is proven by the **live gate** — it spawns the real binary and exercises the entrypoint. Do not add per-story boilerplate ACs for "is it wired in" / "did it use the wire" when a journey already covers it.

Fewer, stronger ACs out the other side. That is the goal of this command.

## 2. Before writing — homework

A story written without the surrounding context misses constraints or duplicates behavior. Read:
- `docs/planning/user-story-format.md` — the template + field reference.
- `docs/planning/protocol-map.md` — confirm domain + milestone.
- `docs/planning/user-stories/{milestone}/outline.md`, the existing stories, and `COORDINATION.md`.
- `.claude/CLAUDE.md` (system invariants — every story is subject to them) and `CONTEXT.md` (glossary; use only terms defined there).
- The discussion logs for your domain: `grep -rl "<keyword>" docs/planning/discussion_logs/`. Constraints often live only in a log.
- The implementation files the story will change (real interface/type names — ACs written blind produce wrong names).
- **If the story touches infra** (CloudFormation, `deploy.sh`, ECS, pipelines, SSM, Flyway versions, anything under `infra/`): read `infra/CLAUDE.md` first — its rules govern what the ACs must require.

Then **ask the operator** any question whose answer materially changes what you write (genuine scope/design ambiguity) — but not things five minutes of reading would answer. If the operator is unavailable, make the assumption explicit at the top of `implementation_notes`.

## 3. E2E-first ordering

**Is there an E2E story for this milestone?** (a story with `domain: End-to-End` or `e2e` ACs covering the scenario). If not, **write it first** — do not write component stories until it exists.

The E2E story describes the full scenario from outside: real agents (MCP servers), real relay + directory processes, the complete flow from first tool call to final observable, every data dependency named ("A's peer ID must be known to the directory before step N"). If writing it reveals data that "must be known" with no protocol step that produces it — that's a spec gap; write the missing step as a behavior/AC first.

Then write **one component story per distinct behavior unit**, linking back to the E2E story in `references`. For every output field, name the protocol step that populates it.

## 4. Shared interface completeness — the general rule

**Before writing ACs for a story that introduces or modifies a shared interface** (DB table, persisted object, registration message, manifest, frame field, in-memory cache read by another component), enumerate **every producer and every consumer**. The recurring failure: the story is written from one participant's view, fixes the presenting consumer, never asks "who else reads this?", and the others break silently. Each producer and each consumer needs its own AC.

## 5. The trap lookup — apply only the rows your story triggers

These are the hard-won incident patterns. **Don't add all of them.** Match your story to the trigger and add the one AC that catches that trap — and write that AC *for your story*, don't paste a generic template.

| If your story… | The trap (incident) | The AC it needs |
|---|---|---|
| introduces/modifies a **DB table** | constraints/indexes/RLS missing, found after the migration is applied → version-renumber cascade *(FEDERATION-001/002)* | Architecture-phase schema enumeration (all ops, uniqueness, indexes, FKs, RLS) in story notes; an integration-gate AC that applies the migration **against all prior migrations already applied** (not a fresh DB), zero Flyway checksum errors. Parallel milestone → reserve versions in COORDINATION.md first. |
| **persists a domain object** (JSON / DB round-trip) | serialization silently destroys typed fields; bytes match, type is gone *(PERSIST-005: `JSON.stringify` on a `Uint8Array`)* | one AC using a **real** domain instance (not `randomBytes`), verifying it **works after load** (sign / decrypt / handle — not byte equality), crossing a **restart boundary** if persistence survives restarts. Flag any `Uint8Array` / `Buffer` / `BigInt` / `Date` / `Map` / `Set` field. |
| touches a **DB adapter** with BIGINT columns | BIGINT read back as a string *(PERSIST-021 — hit twice under a "should")* | a live round-trip AC: write a known BIGINT, read it back, assert `typeof === 'number'` per declared column. |
| changes how a service **registers / announces an address** | multiple consumers of the address; only the presenting one is fixed *(M6B-006: `NetworkRelayAdapter` uncovered)* | enumerate every component that dials the service; one AC per consumer; the close gate verifies each path independently. Name address fields explicitly — don't smuggle a multiaddr through `healthCheckUrl`. |
| **sends over a shared long-lived channel** (signaling, relay, IPC, DB conn) | channel dead at send time; surfaces as a generic error far from the cause *(M6B signaling → `directory_below_threshold`)* | an AC that kills the channel before sending and asserts a **distinct** error code; if reconnectable, a second AC for send-after-reconnect. |
| introduces a **long-running process** with health checks | a single `/health` 200 conflates liveness / readiness / startup *(M6B: ECS healthy while the relay had no directory connection)* | an AC distinguishing liveness / readiness / startup — name each precondition, its consumer, and the consumer's action on failure. |
| holds **in-memory state derived from the DB** | lost on restart / stale after an external change *(M6B-010, M6B-008)* | an AC for reconstruction after restart; an AC for a refresh schedule if the data can change externally. |
| introduces an **unbounded resource** (pool, map, queue, stream concurrency) | silent exhaustion *(M6B-009: pg pool of 10)* | the cap is specified, and an AC covers graceful degradation at the cap. |
| introduces a **new runtime component** | implemented + unit-green but never instantiated by the composition root *(M6)* | usually covered by the **live gate** (it spawns the real entrypoint). Only add a wiring AC if no journey exercises this component's path. |
| touches an **MCP tool** | `{ok:false}` with a bare reason the calling LLM can't act on *(M6-E2E-001: `session_not_active`)* | every failure response carries a `guidance` field: what happened, why, what to do next. |
| has any **catch block** in a touched package | silent swallow, or `${error}` → `[object Object]`, or one code for many causes *(M6B-002: three FROST modes → `directory_below_threshold`)* | a **lateral catch audit** AC: scan ALL catch blocks in ALL files in the package (not just changed files); each distinct cause → a distinct code; extract `error.message`, never interpolate the object. |
| needs **external live state** a test can't provide in-process (pre-registered identity, external directory/relay) | CI fails indistinguishably from a real regression *(mcp-002 / mcp-003)* | the ACs note that every top-level `describe` is wrapped `describe.skipIf(!process.env.CELLO_E2E_LIVE)`. In-process `createSessionFixture()` tests do **not** need this. |
| changes **cello-client packages** | code ships without a version bump → operators run stale code | two blocking ACs — see §6. |

## 6. Cross-repo (cello-client) stories — two mandatory ACs

If the story modifies `core/crypto | transport | protocol-types | client | adapter-claude-code`:
- **Version-bump AC:** every modified package bumped; every dependent's dependency version updated; `@cello-protocol/connect` bumped; `pnpm install`; tag `v{connect}` pushed; CI publishes to beta; `npm view @cello-protocol/connect@beta dependencies --json` shows real versions, never `workspace:*`.
- **trustless-cello dep-update AC:** `directory` + `relay` package.json reference the new semver ranges; no `workspace:*` for the five cello-client packages; `pnpm install`; `typecheck` passes; committed to main.

Without both, directory and relay compile green against stale local copies and silently run old code.

## 7. Observability ACs (M4+)

Observability is a first-class AC, not metadata. For each significant state transition:
- a **named event** in `domain.noun.verb` (`session.started`, not "something is logged"), with its **required `context_fields`**;
- a **`correlationId`** asserted on every event in an async / multi-process flow;
- every error path → a named error event with diagnostic context; **distinct cause → distinct event/code**;
- new failure modes → an alarm-threshold AC (or a `notes` line saying why none is warranted).

**Each event needs its own AC** — listing it in the `observability:` block is not a test; without an AC the implementer can drop the log call and every test still passes. Canonical YAML uses `context_fields` (not `fields` / `context`) and `correlationId: true` — wrong field names fail `/cello-review` Step 4c. New names go in the taxonomy in [[2026-05-16_0753_development-pipeline-and-local-iteration]].

## 8. Security invariants

Every SI pairs a `statement` with a **real `adversarial_condition`** — an attack, not a structural check. "assert alice's KeyProvider reference is unreachable from bob" only checks that two references differ. Instead: "a handler on alice's client calls `registry.getKeyProvider('bob')` — it returns alice's key or throws, never bob's." Name the attack, describe what success would look like, assert it does not happen.

## 9. Definition of Ready (the slim gate)

- [ ] Frontmatter present (`name`, `type`, `date`, `topics`, `status`, `description`) — needed for `/cello-link`.
- [ ] ACs pass the §1 quality bar: few, each traces to the done-condition / an invariant, each stub-resistant, each one behavior. **You pruned.**
- [ ] System-wide constraints that shaped any mechanism (sovereign nodes, cloud-agnostic transport, etc.) are restated **inline in story / behavior / ACs** — not only linked, and **not** in `implementation_notes`. *(FEDERATION-001 reached for VPC Peering because the multi-cloud constraint never made it into the implementation context.)*
- [ ] Shared-interface producers and consumers each have an AC (§4).
- [ ] Every trap your story triggers (§5) has its AC — and no trap it doesn't trigger is padded in.
- [ ] Test infra comes from `createSessionFixture()` (extend with a non-breaking `opts` field) — no new `makeFixture()`.
- [ ] Cross-repo ACs present if cello-client changed (§6).

## File naming & after

`docs/planning/user-stories/{milestone}/CELLO-{DOMAIN}-{number}.yaml` — next sequential number in the domain. Run `/cello-link` after writing to wire the file into the vault graph.
