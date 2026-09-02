---
name: 004-IDENTITY-WIRE — Channel registration, client side of the wire
type: micro-work-order
date: 2026-09-02
status: open
source: DOD-M16-IDENTITY-1
description: >
  A channel is a registered CELLO identity. This order is the cello-client half: the
  register_request / RegisterSuccess / AgentProfile wire types gain channel and admin_pubkey,
  the daemon can register a channel over IPC (fields travel the exact path phone_stub already
  travels), the flag is persisted locally so the daemon knows which of its own identities are
  channels, and a channel registration FAILS LOUDLY unless the directory echoes the flag back.
  The directory half is order 005; the never-converses enforcement is order 006.
---

# **<ins>MICRO</ins>** WORK ORDER 004-IDENTITY-WIRE — Channel registration (client side)

> ## THE RULES OF A MICRO WORK ORDER
>
> 1. **Read [[M16-PROCEDURE]] IN FULL before you start.** It binds you: the gate, the watchdog
>    cron (§4a — arm it now), the review dispatch, one session = one order. **Do not read
>    `M16-DEFINITION-OF-DONE.md`, `M16-BUILD-JOURNAL.md`, or any design log** — this order
>    carries everything you need.
> 2. **MICRO means small.** One mission. Never grow it.
> 3. **Found something else?** *Newly discovered* at the foot, five lines, keep going.
> 4. **500 lines, hard cap** on this file.
> 5. **Standard procedure applies in full:** tests first (all red) → implement (all green) →
>    review (`cello-unit-reviewer`) → fix every finding → commit per fix, push per commit.
>    Flip `status:` to `complete` in the SAME commit as the verdict.
> 6. **Done is done.**

---

## The problem, plainly

An M16 broadcast channel is not a lightweight object — it is a **full registered CELLO
identity** (same ceremony, same cost — the registration cost IS the spam defense), marked by
two facts recorded at registration and never changed: `channel = true`, and the
`admin_pubkey` of the agent that administers it. Nothing on the wire can carry those facts
today. This order adds them on the client side.

**Repo: `/Users/andrep/Documents/code/cello-client`.** The directory does not learn to store
or validate these fields until order 005 — which is exactly why the loud-failure rule below
exists: until 005 is deployed, a directory will ignore the new fields, and a channel that
silently registered as a plain agent would be a corrupt identity nobody notices. The client
therefore **requires the directory to echo `channel: true` in `register_success`** and fails
the registration if the echo is missing.

**The copy-anchor for the whole order:** the `phone_stub` parameter already travels the exact
path these two fields need — CLI/IPC boundary → `register-handler.ts` → `registration-manager.ts`
→ the `register_request` frame. At every step, put `channel` / `admin_pubkey` beside
`phone_stub` and mirror its handling.

---

## The work

### 1. Wire types — `core/protocol-types/src/registration.ts`

- `interface RegisterRequest` gains:
  ```ts
  /** True when this identity is a broadcast channel (publish-only; never converses).
   *  Immutable after registration. Omitted entirely for ordinary agents. */
  channel?: true;
  /** Hex-encoded 32-byte pubkey of the administering agent. REQUIRED when channel is set;
   *  must be absent otherwise. Immutable after registration. */
  admin_pubkey?: string;
  ```
- `interface AgentProfile` gains (non-optional — the profile always states both):
  ```ts
  /** True when this identity is a broadcast channel. Immutable. */
  channel: boolean;
  /** Hex admin pubkey when channel === true; "" otherwise. Immutable. */
  admin_pubkey: string;
  ```
- The `RegisterSuccess` interface (same file) gains:
  ```ts
  /** Echoed by the directory when the profile was stored with channel = true. A client
   *  registering a channel MUST refuse success without this echo. */
  channel?: true;
  ```
- `type RegisterErrorReason` gains one member: `| "invalid_channel_registration"` with a
  comment: `// channel/admin_pubkey fields malformed or inconsistent`.

### 2. Frame send — `core/daemon/src/registration-manager.ts`

`RegistrationManager.register(phoneStub = "", preAuthToken?)` gains a third parameter
`channelOpts?: { channel: true; adminPubkeyHex: string }`. In the `register_request` frame
built at the "Step 5" send (where `phone_stub` is set), add:
`...(channelOpts ? { channel: true, admin_pubkey: channelOpts.adminPubkeyHex } : {})`.

Before sending, validate: `adminPubkeyHex` must be exactly 64 lowercase hex chars and must
differ from the registering identity's own `k_local_pubkey` (a channel cannot administer
itself). On violation return `{ error: "invalid_channel_registration" }` without sending.

**The echo check:** where the manager handles the `register_success` frame, add — if
`channelOpts` was given and the frame's `channel` field is not exactly `true`, treat the
registration as FAILED: return
`{ error: "directory_missing_channel_support" }`, and do NOT persist the identity as
registered. Emit log event `registration.channel.echo_missing` (fields: `correlationId`,
`k_local_pubkey`) at error level through the injected logger beside the existing failure
logging.

### 3. IPC surface — `core/daemon/src/register-handler.ts`

The `cello_register` IPC handler's params gain `channel?: boolean` and
`adminPubkeyHex?: string`. Validation at the handler (before invoking the manager):
`channel` must be `true` or absent; if `channel` is true, `adminPubkeyHex` is required; if
`channel` is absent, `adminPubkeyHex` must be absent. On violation reply with the handler's
existing error shape, reason `invalid_channel_registration`. Pass a well-formed
`channelOpts` through to `RegistrationManager.register`.

### 4. Local persistence — the daemon must know its own channels

Follow how the registered identity's existing fields are persisted after `register_success`:

- `core/daemon/src/registration-persistence.ts`: `RegistrationStateRecord` gains
  `channel: boolean` and `admin_pubkey: string` (default `false` / `""`), written by both
  `FileRegistrationPersistence` and the DB variant.
- `core/daemon/src/db-identity-store.ts`: extend the identity schema in
  `ensureIdentitySchema` with two columns on the agents table — `channel INTEGER NOT NULL
  DEFAULT 0`, `admin_pubkey TEXT NOT NULL DEFAULT ''` — using the file's existing idempotent
  DDL pattern (the daemon DB has no Flyway; mirror how the file's other conditional DDL is
  done). Thread the fields through `AgentRow` and the read/write paths.
- Add one accessor where `AgentRow` readers live: `isChannelAgent(agentName: string):
  boolean` (false for unknown agents — an unknown agent is not a channel; it is refused by
  other gates). Order 006 consumes this; build it here so 006 touches no schema.

### 5. Observability

Exactly one new event (`registration.channel.echo_missing`, step 2). The existing
registration events gain no renames; the new fields flow through whatever registration
logging already prints. No `console.log` anywhere.

---

## ⚠️ WHAT MUST NOT CHANGE

- **No silent downgrade — this is the one the unit exists to prevent.** If the directory
  does not echo `channel: true`, the registration FAILS. Do not register the identity as a
  plain agent "so the user has something," do not warn-and-continue, do not retry without
  the flag. Test 6 proves the failure path.
- **`channel` and `admin_pubkey` are immutable.** No setter, no update path, no IPC verb to
  change them. If you find yourself writing one, stop (§5).
- **Do not add CLI flags** — the operator-facing command surface is Tier 5. IPC only.
- **Do not touch the DKG ceremony, `network-directory-node.ts`, or any FROST code.** The
  ceremony is identical for channels; only the frame fields and persistence change.
- **Ordinary registration frames are unchanged**: when `channelOpts` is absent, the frame
  must not contain the new keys at all (spread-when-present, never `channel: false` on the
  wire). Test 2 pins this.
- **No backward-compatibility shims** (M16-PROCEDURE §0) — but note the echo check is
  fail-loud sequencing, not a compat branch: it exists so 004-before-005 cannot corrupt.

---

## Tests — write ALL of these first, confirm ALL red, then implement

Extend the EXISTING test files — do not create parallel ones:
`core/daemon/src/__tests__/registration-manager.test.ts`,
`core/daemon/src/__tests__/registration-handler.test.ts`,
`core/daemon/src/__tests__/registration-persistence.test.ts`. Copy each file's existing
stub/seam pattern for driving frames (they already fake the signaling seam and the
`register_success` path — reuse those helpers, extending their options non-breakingly if
needed). **`core/daemon/tsconfig.test.json` lists test files explicitly** — these files are
already listed, which is another reason to extend rather than add files. Run one file at a
time: `pnpm vitest run src/__tests__/registration-manager.test.ts` from `core/daemon/`.

In registration-manager.test.ts:
1. `channel registration sends channel and admin_pubkey in register_request` — capture the
   sent frame; assert `frame.channel === true` and `frame.admin_pubkey` equals the given hex.
2. `ordinary registration frame carries neither key` — register without channelOpts; assert
   `"channel" in frame === false` and `"admin_pubkey" in frame === false`.
3. `self-administered channel is refused before sending` — adminPubkeyHex equal to the
   registering identity's own pubkey → returns `error: "invalid_channel_registration"` and
   NO frame was sent (assert the capture is empty).
4. `malformed admin pubkey is refused before sending` — 63 hex chars, and 64 chars with an
   uppercase letter: each returns `invalid_channel_registration`, nothing sent.
5. `register_success WITH the echo persists channel fields` — drive a full fake flow where
   `register_success` carries `channel: true`; assert the persisted record has
   `channel === true` and the admin pubkey.
6. `register_success WITHOUT the echo fails the registration` — same flow, echo absent:
   result is `error: "directory_missing_channel_support"`, NOTHING was persisted (assert the
   persistence stub recorded no identity), and the `registration.channel.echo_missing` event
   was logged. **This is the clause the unit exists for.**

In registration-handler.test.ts:
7. `channel without adminPubkeyHex is refused` — reason `invalid_channel_registration`.
8. `adminPubkeyHex without channel is refused` — same reason.
9. `well-formed channel params reach the manager` — assert the manager stub received
   `channelOpts` with both values.

In registration-persistence.test.ts:
10. `records default to non-channel` — a record written without the new fields reads back
    `channel === false`, `admin_pubkey === ""` (both persistence impls).
11. `channel fields round-trip` — write `channel: true` + a pubkey, read back, both intact;
    and `isChannelAgent` returns true for that agent, false for another seeded agent.

---

## Definition of Done

1. All type, frame, handler, persistence, and accessor changes above exist, exactly as
   specified.
2. All eleven tests exist, went red first (journal the red run), now green.
3. **Revert test:** delete the echo check (step 2's failure branch) and confirm test 6 goes
   red because registration succeeded when it must not; restore. Delete the
   self-administration check and confirm test 3 goes red; restore. Quote both runs.
4. Gate passes in `cello-client`: `pnpm run test` → `pnpm run lint` → `pnpm run typecheck`.
5. **Enforcer (separate OS processes):** using the repo's own real-daemon spawn helper
   (`core/daemon/src/__tests__/helpers/spawn-real-daemon.ts`, as `binary.test.ts` uses it),
   add ONE test that spawns the real daemon binary and calls `cello_register` over IPC with
   `channel: true` but no `adminPubkeyHex`, asserting the exact
   `invalid_channel_registration` error comes back over the socket. (A full live channel
   registration against a real directory is order 005's enforcer — the directory cannot echo
   yet.) Quote the run.
6. Reviewed by `cello-unit-reviewer` (this file is the spec; give it the commit range),
   every finding fixed, verdict quoted below and in the journal.
7. `status:` flipped to `complete` in the same commit as the verdict.

**Not in scope:** the directory's storage, validation, echo, and broker refusal (order 005 —
blocked on this order being published, a planner/Andre step; you end at
committed-and-pushed); refusing to initiate/accept sessions as a channel (order 006); CLI
flags and MCP tools (Tier 5); admin-pubkey *use* (join approval — Tier 2); npm publishing.

---

## Traps recorded before you start

- **The echo check is the unit.** Every other change is plumbing; the failure branch in step
  2 is the difference between "channels exist" and "channels silently don't." Write test 6
  first.
- **`register_success` frames are plain decoded records** — read the echo defensively
  (`frame.channel === true`, nothing truthy-loose).
- **`core/daemon/tsconfig.test.json` lists test files explicitly.** You are extending listed
  files, so nothing to add — but if you DO create a new test file for the enforcer (DoD 5),
  it must be added there or it silently escapes the build.
- **Persistence has TWO implementations** (file and DB). Test 10/11 run both; changing one
  and not the other is exactly the half-migration smell this repo documents.
- **Do not invent a `channel: false` wire value.** Absent means false. Test 2 pins it.
- **`@claude-flow/testing`, not `vitest`, for describe/it/expect; `setupV3Tests()`.**

---

## Newly discovered

*(add findings here — symptom, file, one-line consequence, five lines max each; keep going)*
