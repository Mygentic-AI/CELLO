---
name: 005-IDENTITY-DIRECTORY — Channel registration, directory side
type: micro-work-order
date: 2026-09-02
status: open
source: DOD-M16-IDENTITY-1
depends_on: [004-IDENTITY-WIRE published to npm and promoted — planner/Andre gate]
description: >
  The directory half of channel identity: V64 adds channel + admin_pubkey to agent_profiles
  (immutable, anti-entropy-replicated), registration validates and stores them and echoes
  channel back in register_success, and the directory refuses to broker any session in which
  either participant is a channel. Includes the migration-numbering bump, the AE spec update,
  and the terraform expected-migration-version edit (apply is the planner's).
---

# **<ins>MICRO</ins>** WORK ORDER 005-IDENTITY-DIRECTORY — Channel registration (directory)

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

Order 004 taught the client to ask for a channel identity; the directory currently ignores
the request, which is why 004's clients refuse to complete a channel registration until THIS
order is live. The directory must: store the two immutable facts on the profile, refuse
malformed channel registrations, echo `channel: true` in `register_success` (the echo 004's
client requires), replicate both fields across the consortium — and enforce the first line of
"a channel never converses" by refusing to broker any session where either participant is a
channel.

**Repo: `/Users/andrep/Documents/code/trustless-cello`** (directory + interfaces + e2e). The
wire types come from `@cello-protocol/protocol-types` — **STEP 0 below verifies you have the
version carrying them; if not, STOP** (§5 stop; the planner publishes it, never you).

---

## The work

### 0. Preflight — verify the published types are installed

```bash
cd /Users/andrep/Documents/code/trustless-cello && pnpm install
grep -n "admin_pubkey" node_modules/@cello-protocol/protocol-types/dist/index.d.ts
```
If the grep finds nothing, the 004 package has not been published/promoted — STOP and hand
back. Do not cast, do not redeclare the types locally, do not vendor them.

### 1. Migration — `packages/directory/db/migrations/V64__agent_profiles_channel.sql`

```sql
-- M16 order 005: broadcast-channel identity facts. Both IMMUTABLE after registration —
-- there is no update path by design; a channel is born a channel.
ALTER TABLE agent_profiles ADD COLUMN channel BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE agent_profiles ADD COLUMN admin_pubkey TEXT NOT NULL DEFAULT '';
```
Both columns carry defaults deliberately: the AE required-columns guard punishes NOT NULL
without default, and existing rows are all non-channels.

**The numbering tripwire:** `packages/directory/src/__tests__/migration-numbering.test.ts`
asserts the next free number. Update its `nextFree` expectation from 64 to 65 and add a
one-line comment (`V64 taken by M16 channel identity, this order`) in the same style the
file already uses. Do not touch `OWNED_BY_ANOTHER_BRANCH`.

**The version pin:** edit `infra/terraform/ops-agent.tf` — variable
`ops_agent_expected_migration_version` default `"63"` → `"64"`. **You edit the file only.
Running `terraform apply` is the planner's step and the deploy is not yours** — say so in
the journal. (The recorded 2026-08-31 outage was a bumped file with no apply; the file edit
plus the journal note is your whole obligation.)

### 2. Validation — new file `packages/directory/src/channel-registration.ts`

A pure function so the rules are unit-testable without the node:

```ts
export type ChannelRegistrationCheck =
  | { ok: true; channel: false; adminPubkey: "" }
  | { ok: true; channel: true; adminPubkey: string }
  | { ok: false; detail: string };

/** Validates the channel/admin_pubkey pair off a decoded register_request.
 *  Rules: absent/absent → ok non-channel. channel===true requires admin_pubkey of exactly
 *  64 lowercase hex chars, different from kLocalPubkeyHex. admin_pubkey without
 *  channel===true → refused. channel present but not exactly true → refused. */
export function validateChannelRegistration(
  frame: { channel?: unknown; admin_pubkey?: unknown },
  kLocalPubkeyHex: string,
): ChannelRegistrationCheck;
```

### 3. Registration wiring — `packages/directory/src/directory-node.ts`

In `#processRegisterRequest` (starts ~line 3258):
- Call `validateChannelRegistration(frame, ...)` early, next to the phone-stub validation.
  On `ok: false`: send `register_error` with reason `invalid_channel_registration` (the
  member 004 added) and log `registration.channel.invalid` (fields: `correlationId`,
  `k_local_pubkey`, `detail`).
- The profile literal (~line 3517) gains `channel` and `admin_pubkey` from the check result.
- Where `encodeRegisterSuccess` is called (~line 3534): when `channel` is true, the success
  frame carries `channel: true`. Extend `encodeRegisterSuccess` in
  `packages/directory/src/directory-frames.ts` accordingly, and extend
  `decodeInboundSignalingFrame` (same file) to pass the two new optional register_request
  fields through untyped-to-typed exactly as it passes `reachable_node_ids`.

### 4. Storage — every reader and writer of the profile

- `packages/directory/src/adapters/pg-directory-store.ts`: both `INSERT INTO agent_profiles`
  statements in `setProfile` (~lines 1088 and 1153) gain the two columns; the `loadProfiles`
  boot SELECT (~line 313) gains them; any other `SELECT ... FROM agent_profiles` column list
  in the file that materializes an `AgentProfile` gains them (grep the file for
  `k_local_pubkey, primary_pubkey` column lists).
- `packages/interfaces/src/stubs/in-memory-directory-store.ts`: the stub stores and returns
  the new fields (it holds whole profile objects — verify, adjust only if it projects
  fields).

### 5. Replication — anti-entropy spec

Both fields are IMMUTABLE, so they belong in Tier A:
- `packages/directory/src/ae-table-encoders.ts`: add `"channel"` and `"admin_pubkey"` to
  `AGENT_PROFILES_SPEC.immutableColumns` (~line 49).
- `packages/directory/src/pg-ae-store.ts` (~lines 139-148): mirror whatever the
  `AGENT_PROFILES_SPEC` entry requires for the new columns — read the adjacent table specs
  and match their shape exactly.
- The guard tests will tell you if you missed a spot: `ae-spec-required-columns.test.ts`,
  `ae-spec-schema.test.ts`, `schema-completeness.test.ts` replay migrations against the
  specs. Run them (one file at a time) and fix what they name.

### 6. Broker refusal — a channel never converses, first line

`packages/directory/src/directory-node.ts` already refuses to broker sessions for suspended
agents (the gate near ~line 2487, backed by `#isAgentPaused` ~line 1344 — read both). Add the
same shape of gate for channels: when a `session_request` names an initiator OR a target
whose profile has `channel = true`, refuse the session with the file's existing
session-refusal mechanism and log `session.request.refused_channel_participant` (fields:
`correlationId`, `initiator_pubkey`, `target_pubkey`, `which: "initiator" | "target"`).
Fail-closed like the suspension gate: a profile lookup error refuses rather than proceeds.
Add the store lookup the gate needs (e.g. `isChannelIdentity(kLocalPubkeyHex)`) to
`packages/interfaces/src/directory-store.ts` + the pg adapter + the in-memory stub,
following exactly how `isAgentSuspended` is declared and implemented in all three places.

### 7. Observability

Two new events, named above: `registration.channel.invalid` and
`session.request.refused_channel_participant`, with the listed fields, through the injected
logger. No renames of existing events. No `console.log`.

---

## ⚠️ WHAT MUST NOT CHANGE

- **No profile-update path.** `agent_profiles` is append-only by design (the V9 header says
  so). Do not add an UPDATE, a write-kind, or an endpoint to change `channel` or
  `admin_pubkey` — immutability IS the design, not a v1 shortcut.
- **The broker gate fails CLOSED.** If the profile lookup errors, the session is refused —
  copy the suspension gate's posture. Do not "allow on lookup failure to keep sessions
  working"; that is the silent-fallback shape this milestone's reviews block on.
- **`channel` goes in `immutableColumns`, and NOTHING mutable goes on `agent_profiles`.**
  The repo's own history (the `account_id` column that silently never replicated) is the
  proof; the AE Tier-A hash covers immutable columns only. If you find yourself wanting a
  mutable column here, stop (§5).
- **Do not redeclare or cast around the published types** (step 0). A local
  `as { channel?: boolean }` cast on `AgentProfile` copies the exact smell the repo flags on
  `account_id`.
- **Do not touch the DKG/FROST ceremony code, suspension logic, or any migration below V64.**
- **No backward-compatibility branches.** Old register_requests simply lack the fields —
  `validateChannelRegistration` already handles absent/absent; that is the whole story.

---

## Tests — write ALL of these first, confirm ALL red, then implement

Unit tests in `packages/directory/src/__tests__/m16-channel-registration.test.ts` (mirror the
imports/harness of a neighboring small test in that directory — e.g. the migration-numbering
test). Run one file at a time from `packages/directory/`.

1. `absent/absent is an ordinary registration` — `validateChannelRegistration({}, k)` returns
   `{ ok: true, channel: false, adminPubkey: "" }`.
2. `well-formed channel passes` — `channel: true` + 64-hex admin returns ok with both values.
3. `each malformation is refused` — channel true without admin; admin without channel;
   `channel: "yes"`; `channel: false` present explicitly (still refused — the wire value is
   `true` or absent, per 004); 63-hex admin; uppercase-hex admin; admin equal to the
   registering pubkey. Each returns `ok: false` (assert the `detail` mentions the offending
   field).
4. `profile round-trips through the in-memory store` — setProfile with channel fields,
   getProfile returns them intact; and `isChannelIdentity` on the stub answers true/false
   correctly for channel/non-channel profiles.
5. The **existing guard tests** double as tests for step 5 — run
   `migration-numbering.test.ts`, `ae-spec-required-columns.test.ts`, `ae-spec-schema.test.ts`,
   `schema-completeness.test.ts` and get them green; their red output is your worklist, and
   their green run goes in the journal.

Live/E2E test in `packages/e2e-tests/src/spine/m16-channel-identity.spine.test.ts`, built on
the harness in `packages/e2e-tests/src/spine/live-harness.ts` (`startSpineCluster`,
`provisionAgent`, `startDaemon`, `ipcCall`, `psqlSpine` — read `j-spine.spine.test.ts`
lines ~690-800 for the two-daemon shape to copy):

6. `a channel registers end to end and the row is right` — spin the cluster; provision agent
   "admin" and register it plainly; provision "chan" in a SEPARATE cello home and register it
   over IPC with `channel: true` and admin's pubkey; assert registration succeeds (which, via
   004's client, proves the echo arrived); then
   `psqlSpine("SELECT channel, admin_pubkey FROM agent_profiles WHERE k_local_pubkey='...'")`
   shows `t` and the admin pubkey.
7. `malformed channel registration is refused with the named reason` — register with
   channel but a 10-char admin_pubkey; the IPC result carries
   `invalid_channel_registration`; no row exists for that pubkey.
8. `the directory refuses to broker TO a channel` — a third plain agent attempts
   `cello_initiate_session` targeting the channel's pubkey; the attempt fails, and the
   directory log (the harness captures proc output) contains
   `session.request.refused_channel_participant` with `which: "target"`.

---

## Definition of Done

1. Migration, numbering-test bump, terraform edit, validation module, wiring, storage, AE
   spec, and broker gate all exist as specified.
2. Tests 1–5 green (1–4 red first — journal the red run); guard tests green.
3. **Revert test:** remove the broker gate's target-side check and confirm test 8 goes red;
   restore. Remove `channel` from the INSERT column list and confirm test 6 goes red at the
   SQL assertion; restore. Quote both runs.
4. Gate passes in `trustless-cello`: `pnpm run test` → `pnpm run lint` → `pnpm run typecheck`.
5. **Enforcer:** tests 6–8 ARE the enforcer — the spine harness runs the directory, relay,
   and each daemon as separate OS processes. Quote the passing run's key lines (the psql
   row, the refusal reason, the log event) in the journal.
6. Reviewed by `cello-unit-reviewer` (this file is the spec; give it the commit range),
   every finding fixed, verdict quoted below and in the journal.
7. `status:` flipped to `complete` in the same commit as the verdict.
8. Journal note stating explicitly: **deploy not performed** — the GCP roll,
   `terraform apply`, and the GCP-STATE.md update are the planner's, and registration of
   real channels waits for that roll.

**Not in scope:** deploying (node roll, terraform apply, GCP-STATE.md — planner/Andre);
client-side refusals (order 006); admin-pubkey use (Tier 2 join approval); any epoch or
artifact machinery; the announcements channel itself (Tier 5).

---

## Traps recorded before you start

- **Step 0 is a real gate.** Building against a locally-invented type "to keep moving"
  produces code that typechecks today and breaks the day the real package lands. If the
  types are not installed, STOP.
- **Two INSERT statements, not one.** `setProfile` has a with-account and without-account
  variant; missing the second is invisible until an account-linked registration loses its
  channel flag.
- **The AE guard tests replay ALL migrations from scratch** — they need the local Docker
  postgres. If Docker is not running, START it (M16-PROCEDURE §4.9).
- **The suspension gate is your copy-anchor for step 6** — same lookup shape, same
  fail-closed posture, same three-file interface/adapter/stub pattern. Divergence from it
  needs a reason; you do not have one.
- **The spine tests spawn the cello-client daemon from the SIBLING SOURCE TREE**
  (`CELLO_CLIENT_ROOT` resolves to `../cello-client`), so order 004 must be MERGED there —
  but the directory's own build uses the PUBLISHED package, which is why step 0 checks
  node_modules and not the sibling tree. Two different supply chains; do not conflate them.
- **`session_request` handling is deep in directory-node.ts** — find the suspension check
  near line 2487 and add beside it; do not invent a second dispatch path.

---

## Newly discovered

*(add findings here — symptom, file, one-line consequence, five lines max each; keep going)*
