---
name: 006-NOCONVERSE — A channel never converses (daemon-side refusals)
type: micro-work-order
date: 2026-09-02
status: open
source: DOD-M16-IDENTITY-1
depends_on: [004-IDENTITY-WIRE merged in cello-client]
description: >
  The daemon-side half of "a channel never converses": a daemon refuses to INITIATE a session
  when the acting identity is a channel, and refuses an INBOUND session assignment addressed
  TO one of its channel identities — using the local channel flag order 004 persisted, through
  the existing refusal machinery (new REFUSAL_REASONS member, guidance forced by the total
  map). The directory's broker refusal (005) is the first line; this is the receiver-side
  line that holds even if a directory fails to gate.
---

# **<ins>MICRO</ins>** WORK ORDER 006-NOCONVERSE — A channel never converses

> ## THE RULES OF A MICRO WORK ORDER
>
> 1. **Read [[M16-PROCEDURE]] IN FULL before you start.** It binds you: the gate, the watchdog
>    cron (§4a — arm it now), the review dispatch, one session = one order. **Do not read
>    `M16-DEFINITION-OF-DONE.md`, `M16-BUILD-JOURNAL.md`, or any design log.**
> 2. **MICRO means small.** One mission. Never grow it.
> 3. **Found something else?** *Newly discovered* at the foot, five lines, keep going.
> 4. **500 lines, hard cap** on this file.
> 5. **Standard procedure applies in full:** tests first (all red) → implement (all green) →
>    review (`cello-unit-reviewer`) → fix every finding → commit per fix, push per commit.
>    Flip `status:` to `complete` in the SAME commit as the verdict.
> 6. **Done is done.**

---

## The problem, plainly

A channel is an identity that PUBLISHES and never converses. Order 005 makes the directory
refuse to broker such sessions; this order makes the daemon that HOLDS a channel identity
refuse on its own authority — the enforcement that does not depend on any remote party doing
its job. Two doors close:

1. **Outbound:** a session can never be *initiated as* a channel. The channel's own daemon
   is the only place that key lives; it refuses at the IPC entry.
2. **Inbound:** a session assignment naming one of this daemon's channel identities as the
   receiving participant is refused through the existing refusal machinery, exactly like the
   other inbound refusals.

**Repo: `/Users/andrep/Documents/code/cello-client`, all in `core/daemon`.** Order 004 gave
you the fact you need: `isChannelAgent(agentName)` on the identity store, plus the persisted
`channel` flag. This order only consumes it — no schema changes here.

---

## The work

### 1. Refusal vocabulary — `core/daemon/src/refusal-reasons.ts`

Add ONE member to `REFUSAL_REASONS`:
```ts
SESSION_TO_CHANNEL_IDENTITY: "session_to_channel_identity",
```
`REFUSAL_GUIDANCE` is a TOTAL map over `RefusalReason` — the compiler forces an entry. Write:
`"This identity is a broadcast channel. Channels publish; they do not hold sessions. To reach
the operator behind it, open a session with the channel's admin agent instead."`

### 2. Outbound refusal — `core/daemon/src/initiate-session-handler.ts`

At the entry of the `cello_initiate_session` handler, after the acting agent is resolved and
before any directory traffic: if `isChannelAgent(<acting agent>)`, reply with the handler's
existing error shape, error code `channel_cannot_initiate`, guidance
`"This agent is a broadcast channel and cannot open sessions. Publish to the channel
instead, or act as a non-channel agent."`, and emit `session.initiate.refused_channel`
(fields: `correlationId`, `agent_name`) via the injected logger. The handler's deps must
gain access to the accessor — thread it the same way the handler's other
identity-store-backed deps are threaded (read the deps interface at the top of the file and
mirror).

### 3. Inbound refusal — `core/daemon/src/inbound-sessions.ts`

In `handleInboundSessionAssignment`, AFTER the assignment-signature verification block
(which ends around line 1357 — the refusals there are your copy-anchor) and BEFORE the
`inboundInFlight` idempotency add (~line 1408): if the resolved local agent
(`participant_b`) is a channel per `isChannelAgent(localAgent.name)`, call
`refuseInboundSession({ agentName, sessionIdHex, counterpartyPubkeyHex:
parsed.participantAPubkeyHex, reason: REFUSAL_REASONS.SESSION_TO_CHANNEL_IDENTITY,
offeredDialer: offered, correlationId, ... })` — copy the exact argument shape of the
`INBOUND_ASSIGNMENT_INVALID` refusal a few lines above, changing only the reason. Placement
is load-bearing: gating on a VERIFIED assignment (the file's own comment at ~1273 states the
rule — gating on an unverified document relocates trust rather than closing it).
`createInboundSessions`'s deps interface gains the accessor, threaded from where the deps
are built (grep for the one construction site of `InboundSessionDeps`).

### 4. Observability

One new event (`session.initiate.refused_channel`, fields above). The inbound side needs NO
new event: `refuseInboundSession` already logs and records through the standing machinery —
the new reason value flows through it. Do not add a duplicate log line beside it.

---

## ⚠️ WHAT MUST NOT CHANGE

- **Do not bypass `refuseInboundSession`.** A bare `return` with a log line loses the
  durable refusal record, the dialer revocation, and the counterparty notice that the
  machinery provides — the review measures this by checking the refusal lands in
  `recordRefusedSession`. Use the machinery.
- **Do not check earlier than the signature verification.** The `session_offer` frame has no
  counterparty pubkey and the pre-verification frame is unauthenticated; the slot named in
  step 3 is the correct one and it is not yours to move.
- **`isChannelAgent` answers about LOCAL agents only.** Do not attempt to determine whether
  the REMOTE counterparty is a channel — the daemon has no trustworthy source for that fact
  (the directory refuses those at broker time, order 005; the subscription-state check for
  known channels is Tier 2). Building a guess here would be the silent-wrongness shape.
- **No new IPC verbs, no CLI, no schema changes.** Two refusals, one reason, one guidance
  string, one event. That is the entire surface.
- **Do not weaken the two-connection fixture's defaults** — extend its `opts` non-breakingly
  (the fixture's own docstring states the rule).

---

## Tests — write ALL of these first, confirm ALL red, then implement

Use `core/daemon/src/__tests__/helpers/two-connection-fixture.ts` (read its docstring; extend
`TwoConnectionFixtureOpts` with an optional `channelAgents?: string[]` that marks listed
agents as channels in the seeded identity store — default absent, nothing changes for the
other ~dozen consumers) and `core/daemon/src/__tests__/helpers/signed-assignment.ts` for
building verified inbound assignments. New test file
`core/daemon/src/__tests__/m16-noconverse.test.ts` — **add it to
`core/daemon/tsconfig.test.json`'s `files` list or it silently escapes the build.** Run it
alone: `pnpm vitest run src/__tests__/m16-noconverse.test.ts` from `core/daemon/`.

1. `initiating as a channel is refused at the IPC entry` — fixture with
   `channelAgents: ["chan"]`; drive the initiate handler as "chan"; assert the exact error
   code `channel_cannot_initiate`, the guidance string is present, and the
   `session.initiate.refused_channel` event was captured — and assert NO directory frame was
   sent (the fixture's fake node/seam captured nothing outbound).
2. `initiating as a plain agent still works past the gate` — same fixture, initiate as
   "alice"; assert the refusal error does NOT occur (the attempt proceeds to whatever the
   fixture's fake signaling does next — assert it got that far, e.g. an outbound frame was
   attempted). Pins that the gate reads the flag rather than refusing everyone.
3. `a verified inbound assignment TO a channel is refused with the named reason` — fixture
   with a channel agent; build a signed assignment naming it as participant_b (via
   signed-assignment helper); drive `handleInboundSessionAssignment`; assert
   `recordRefusedSession` recorded reason `session_to_channel_identity` (read it back the
   way the fixture exposes the store), and no inbound session was enqueued.
4. `the same assignment to a NON-channel agent is accepted` — identical drive against
   "alice"; the session is accepted/enqueued. Pins the polarity (this is the fixture-shape
   check: the breaking case and its neighbor, distinguished only by the flag).
5. `the refusal fires AFTER signature verification` — an assignment to the channel with an
   INVALID signature refuses with the signature reason (`inbound_assignment_invalid` /
   pinned-key reason per the helper's options), NOT with `session_to_channel_identity`.
   Order of gates is observable and pinned.
6. `guidance is total` — `REFUSAL_GUIDANCE[REFUSAL_REASONS.SESSION_TO_CHANNEL_IDENTITY]` is
   a non-empty string mentioning "admin" (guards the entry against being emptied later; the
   compiler guards its existence, not its content).

---

## Definition of Done

1. Reason + guidance, both refusal sites, deps threading, and the event exist as specified.
2. All six tests exist, went red first (journal the red run), now green; the new test file
   is in `core/daemon/tsconfig.test.json`.
3. **Revert test:** remove the inbound gate and confirm tests 3 and 5 go red (5 for the
   right reason — the channel refusal no longer masks anything); restore. Remove the
   outbound gate and confirm test 1 goes red; restore. Quote both runs.
4. Gate passes in `cello-client`: `pnpm run test` → `pnpm run lint` → `pnpm run typecheck`.
5. **Enforcer (separate OS processes):** using
   `core/daemon/src/__tests__/helpers/spawn-real-daemon.ts` (as `binary.test.ts` does),
   spawn the real daemon with a seeded channel identity (seed via the identity store before
   spawn, or the seed-agents helper if it carries the flag after 004), call
   `cello_initiate_session` as the channel over the real IPC socket, and assert the exact
   `channel_cannot_initiate` error crosses the socket. Quote the run in the journal.
6. Reviewed by `cello-unit-reviewer` (this file is the spec; give it the commit range),
   every finding fixed, verdict quoted below and in the journal.
7. `status:` flipped to `complete` in the same commit as the verdict.

**Not in scope:** the directory's broker refusal (005); refusing sessions FROM known channel
pubkeys at a subscriber (Tier 2, with subscription state — a clause on the SUBSTATE line);
publish/subscribe machinery of any kind; MCP tool surface; npm publishing.

---

## Traps recorded before you start

- **Test 5 is the one a hollow implementation passes accidentally** — if you put the gate
  before verification, tests 1–4 stay green and only 5 catches it. Write 5 exactly as
  specified: invalid signature + channel target, assert the signature reason wins.
- **The deps interfaces are the contract** — `initiate-session-handler.ts` and
  `createInboundSessions` both take deps objects; add the accessor to the INTERFACE and
  thread it at the construction site. A direct import of the store into the handler skips
  the seam and will be flagged.
- **`refuseInboundSession` needs `offeredDialer`** — the `offered` value is in scope at the
  slot (it was fetched for the dialer-mismatch check ~line 1196); pass it, don't refetch.
- **Extend the fixture via `opts` with a non-breaking default** — a from-scratch fixture is
  a blocking review finding by standing rule.
- **`@claude-flow/testing`, not `vitest`; `setupV3Tests()`; new test file into
  `tsconfig.test.json`.**

---

## Newly discovered

*(add findings here — symptom, file, one-line consequence, five lines max each; keep going)*
