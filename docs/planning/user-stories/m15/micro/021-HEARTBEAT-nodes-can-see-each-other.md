---
name: 021-HEARTBEAT — Directory nodes can see each other's heartbeats
type: micro-work-order
date: 2026-09-03
status: open
description: >
  Every directory node reads the other two as never-heartbeated and counts availableNodes 1 against
  requiredThreshold 2, so the federated 2-of-3 checkpoint has NEVER ONCE SUCCEEDED and every receipt
  is confirmed on one node's own say-so. The fix is a third entry in a two-entry Tier-B list, and
  the mechanism it needs already exists and already carries a table of the same shape.
  CLOSES DOD-M15-HEARTBEAT-1.
---

# **<ins>MICRO</ins>** WORK ORDER 021-HEARTBEAT — Nodes can see each other

> ## THE RULES OF A MICRO WORK ORDER
>
> 1. **Read [[M15-PROCEDURE]] IN FULL before you start.** It binds you — the gate, the review
>    dispatch, the invariants, how tests are run. **Do not read `M15-DEFINITION-OF-DONE.md` or
>    `M15-BUILD-JOURNAL.md`**; this order carries everything you need from them.
> 2. **MICRO means small.** One mission. Follow it to its end. **Never grow the mission.**
> 3. **Found something else?** Write it under *Newly discovered* at the foot of this file and
>    **keep going**. Do not fix it. Do not investigate it.
> 4. **500 lines, hard cap.**
> 5. **Standard procedure still applies:** implement → review (`cello-unit-reviewer`) → fix every
>    finding → commit. Commit per fix, push after every commit. **Closing a unit means flipping
>    this file's `status:` frontmatter to `complete` in the SAME commit as the verdict.**
> 6. **Done is done.** When the Definition of Done below is met, stop.

> ## 🎯 THIS ORDER CLOSES A DoD LINE — `DOD-M15-HEARTBEAT-1`

---

## What this costs the operator

**A sealed receipt is meant to be countersigned by several independent directory nodes, so nobody
has to trust any one of them. Today it is signed by one.**

Each node reads the other two as never-heartbeated, counts `availableNodes: 1` against
`requiredThreshold: 2`, logs `federation.checkpoint.skipped`, and returns. **The federated
checkpoint has never once succeeded in production.**

**Receipts still finish** — a separate local, single-node checkpoint path writes the row
unilaterally on a scheduler, which is why inclusion proofs resolve. **So this is not "receipts are
broken."** What is missing is the property the product is sold on: that the receipt does not rest on
one node's word. **Established by measurement — do not re-derive:** this did NOT cause the sealing
outage; the degraded count was already true during seals that worked.

**Why it is in the gate rather than after launch** (Andre, 2026-09-03): *"Anything that's going to
change the tables in the directories I'd rather build now, because we don't want to invalidate or do
a whole lot of backward-compatibility work once we have users."* A schema change is cheapest against
an empty database and never gets cheaper.

---

## Where this work lives — ONE REPO

- **`trustless-cello`** → `/Users/andrep/Documents/code/trustless-cello`. Everything is here, under
  `packages/directory/`. Gate: `pnpm run test` / `lint` / `typecheck` — **`typecheck` IS the build**
  in this repo (`tsc --build`, it emits); there is no separate root `build` script and none is
  missing.
- **`cello-client`** → you do not touch it. **This publishes NOTHING.**

**Docker must be running** for the directory suite (RLS and the hash-chain constraints are
database-level; a mock cannot catch a broken policy).

---

## The trace — done, do not re-derive it

**The cost note on the DoD line is right that this needs a Tier-B mutable merge with a version
column, and it leaves a false impression: it reads as though the MECHANISM must be built. It must
not. Tier-B exists, and already carries a table of exactly this shape.**

- `packages/directory/src/pg-ae-store.ts` **470**: `const TIER_B = [SUSPENSIONS, PRESENCE]`.
- `PRESENCE` (**416**) is `agent_presence` — a mutable, per-key, merged-across-nodes record with
  `last_seen_at` / `updated_at`, resolved by wall-clock last-writer-wins. **Structurally what a
  heartbeat is.** It is your template: `spec`, `keyColumn`, `select`, `merge`, `rowToBody`,
  `toVersionRow`, `validateBody`.
- `packages/directory/src/ae-mutable-version.ts` **67**: `PRESENCE_VERSION_SPEC`, and **73**:
  `TIER_B_SPECS = [SUSPENSION_VERSION_SPEC, PRESENCE_VERSION_SPEC]`.
- The wire protocol, the digest exchange, the version-map request and the merge plumbing are all
  live in `ae-channel.ts` / `anti-entropy-engine.ts`. **You add a table to a working mechanism.**

**Where heartbeats live today:** `directory_nodes.last_heartbeat_at`, added by
`V33__agent_presence.sql:50` (`ALTER TABLE directory_nodes ADD COLUMN last_heartbeat_at TIMESTAMPTZ`).
The table (`V17__directory_nodes.sql`) is `node_id` (unique), `region`, `endpoint`, `status`,
`created_at`, plus that column. **`directory_nodes` is not replicated at all today** — that is the
whole defect.

**The consumer:** `packages/directory/src/checkpoint-coordinator.ts` **~488** — the threshold check
that returns `null` and logs `federation.checkpoint.skipped`.

---

## Part 1 — The migration

**Next version is `V65`.** Add whatever the merge needs — at minimum a version/update column so a
Tier-B merge is deterministic, following what `agent_presence` does. Read `V33` and `V38`
(`presence_replication`) before writing it: `V38` exists because a permissions gap meant the
heartbeat UPDATE was not actually allowed, and **the same RLS trap applies to anything you add**.

**Check whether an ops-agent expected-migration-version needs bumping alongside it.** The rule was
written for the AWS CloudFormation path (`cello-ssm-parameters.yaml`), which is superseded by GCP —
**verify against `infra/GCP-STATE.md` whether an equivalent exists now, and say what you found in
the Review.** Do not assume either way.

---

## Part 2 — The Tier-B entry

Add a third spec in `ae-mutable-version.ts` and a third entry in `pg-ae-store.ts`'s `TIER_B`,
following `PRESENCE` line for line.

- **Key:** `node_id`.
- **`versionColumns` MUST match exactly what the merge consults.** The spec's own header says so,
  and `SUSPENSION_VERSION_SPEC` deliberately omits `updated_at` because its merge forbids wall-clock
  input, while `PRESENCE_VERSION_SPEC` includes it because its merge is wall-clock LWW. **Decide
  which yours is, then make the two agree.** A spec that lists a column the merge ignores (or omits
  one it consults) produces version hashes that disagree about rows that are identical, and the
  nodes pull each other forever.
- **The merge:** a heartbeat is a freshness signal, so the freshest wins. Write it as its own
  function next to `presence-merge`, not inline.
- **TIMESTAMPTZ → absolute UTC epoch millis on the wire**, exactly as `PRESENCE`'s `select` does
  (`EXTRACT(EPOCH FROM …)*1000)::bigint`) — **no `AT TIME ZONE`.** Two nodes in different regions
  hashing local time is a divergence that will look like corruption.

---

## Part 3 — Prove the checkpoint actually confirms

**This is the deliverable. A green unit test that nodes replicate heartbeats is NOT this line.**

The line's claim is that the federated checkpoint has never succeeded. Closing it means it now does:
`federation.checkpoint.confirmed` observed, with the signing nodes named, against real nodes — not
`federation.checkpoint.skipped`.

Use the existing federation suite / spine journey rather than a new harness (a from-scratch fixture
is a blocking review finding). If the only honest way to observe it is a live multi-node run, say so
and record what you ran.

---

## Part 4 — The wrong comment

**A code comment blames a "BIGSERIAL `id` collision" for this.** It is wrong and would send the next
repairer at the wrong fix. **Rewrite it to say what is actually true — do not delete it.** (A
comment asserting a property the code lacks is how defects survive review here; the rule is rewrite,
never delete.)

---

## Definition of Done

1. `directory_nodes` replicates between nodes as a Tier-B table: a node that was down comes back and
   learns the others' heartbeats without a restart.
2. **`federation.checkpoint.confirmed` is OBSERVED**, with `signingNodes` naming more than one node,
   and the run output quoted. Not `skipped`.
3. `versionColumns` and the merge agree, with a test that fails if a column is added to one and not
   the other.
4. The migration applies cleanly on a database with V1…V64 already applied — **Flyway reports zero
   checksum errors on the prior migrations**, not just a green fresh build.
5. The BIGSERIAL comment is rewritten, and the Review says what the ops-agent migration-version
   check turned up.
6. **Each new assertion has been made to fail on purpose.** Revert the Tier-B entry, confirm the
   replication test reddens for the reason you expect, restore it.
7. Gate passes in trustless-cello. **Nothing published.**
8. Reviewed by `cello-unit-reviewer`, every finding fixed, verdict quoted below.
9. `DOD-M15-HEARTBEAT-1` flipped to ✅ in `M15-DEFINITION-OF-DONE.md`, in the same commit as the
   verdict.

**Not in scope:** the local single-node checkpoint path (it works and is why receipts finish); the
claims ledger wording about what a receipt is countersigned by (a separate line); anything about
relays.

---

## Traps recorded before you start

**Do not lower `requiredThreshold` to make the checkpoint pass.** `T = majority(N)` is settled and
non-negotiable. A threshold of 1 means one node can complete a ceremony alone, which is a security
violation regardless of whether tests pass. If you find yourself editing `requiredThreshold: 2`,
stop.

**Do not add `last_heartbeat_at` to a Tier-A immutable set.** It is mutable; Tier-A is content
addressed and would treat every heartbeat as a new record forever.

**Never modify an applied migration.** V65 is yours; V1–V64 are history. If V65 turns out wrong,
write V66.

**`node:sqlite` is forbidden in this project.** Not relevant to the directory (it is Postgres), but
noted because the daemon side of the fleet uses SQLCipher and the rule is absolute.

**ANOTHER LANE IS RUNNING.** `022-REFUSALVISIBLE` is in `cello-client`, so it cannot touch your
files — but it may bring up Postgres. **Export a `COMPOSE_PROJECT_NAME` unique to your worktree AND
a unique `CELLO_PG_HOST_PORT`.** The port alone does NOT isolate you: both worktrees derive the same
compose project name, the second lane silently reuses the first's container on the first's port, and
the failure reads as a killed container rather than a collision. Measured 2026-09-03.

---

## Review

### Where this work lives
*(worktree path, branch, and the `COMPOSE_PROJECT_NAME` / `CELLO_PG_HOST_PORT` you used)*

### The rest
*(the `federation.checkpoint.confirmed` output, the migration-guard result, the ops-agent finding,
the mutation proof from DoD 6, the reviewer's verdict)*

## Newly discovered

*(anything found and NOT acted on, per rule 3)*
