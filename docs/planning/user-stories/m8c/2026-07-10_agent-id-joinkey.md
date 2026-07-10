---
name: agent-id-joinkey
type: story
date: 2026-07-10
topics: [schema, agent_id, agent_name, migration, join-key, retire-reuse, rename, sovereignty, privacy, mutable-fk]
status: active
description: >
  Finish the migration REMOVE-001 started. The six M7 session tables join on `agent_name` — a mutable,
  reusable-after-retirement display label — while the stable primary key `agent_id` sits unused. Carry
  `agent_id` into those tables as the join key and demote `agent_name` to a display attribute. Purely
  client-side, purely additive (no DELETE, no purge), so it cannot desync the directory. Fixes the
  retire-reuse history-bleed and unblocks agent rename, both without deleting a row.
---

# DOD-AGENT-ID-JOINKEY-1 — join on the stable key

## The defect (not a naive choice — an incomplete migration)

`agent_name` (`Ms_Chelly`, `CELLO_Support`) was the **original primary key** of the `agents` table —
the identity store says so verbatim: *"PRE-REMOVE-001 `agents` table (agent_name PK, no agent_id)."* At
M7, joining the session tables on `agent_name` was **correct**: it was the key.

`REMOVE-001` (`0064d95`) then added `agent_id` as a stable surrogate PK **specifically to make names
reusable** (retire-and-keep frees the name). It migrated the parent `agents` table. It did **not**
migrate the six child tables — which still join on the column that had just become a *mutable, reusable
attribute*. Worse, the same commit wrote the guardrail comment *"the human name … is a mutable
ATTRIBUTE"* while leaving six foreign keys pointing at it. **A stated invariant, contradicted by the code
beneath it** — the recurring shape of this milestone's bugs, here in schema form.

**Split-brain, in one database:**
- `agents` table → PK `agent_id`; `agent_name` is a mutable attribute (partial-unique among non-retired).
- Six session tables → join on `agent_name`.

The name is a mutable attribute and a foreign key at the same time. That is the whole defect.

### The six tables (all `core/daemon/src/session-node-manager.ts`)

`sessions`, `seal_interrupted_artifacts`, `session_tree_leaves`, `transcript`, `message_watermarks`,
`contacts` — every one has `agent_name TEXT NOT NULL` in its `PRIMARY KEY`, and none carries `agent_id`.

**SEVENTH TABLE (found by AC5, 2026-07-10): `retry_queue`** (`core/daemon/src/retry-queue.ts`). It carries
`agent_name` (nullable — legacy direct-retry rows are not agent-scoped) and scopes live `DELETE`s by it.
Chronology confirms it is not later contagion but a child `REMOVE-001` skipped: `retry_queue.agent_name`
landed 2026-06-22 (`b31c5bd`, DOD-LOOP-1), `REMOVE-001` on 2026-06-26 (`0064d95`). **`REMOVE-001`
half-migrated SEVEN tables.** `retry_queue` carries a latent HIGH bug the other six do not — see the
callout below.

> 🔴 **HIGH — silent cross-agent data loss in `retry_queue` (fixed as part of this unit).** DOD-LOOP-1 added
> `agent_name` *"so two of the operator's agents can hold awaiting content for the SAME session_id on one
> daemon without colliding,"* but never added the agent to the table's uniqueness constraint, still
> `UNIQUE(session_id, nonce_hex)` (line 120) — and for awaiting rows `nonce_hex` IS the content hash. Two
> local agents, same session, identical content → the second `INSERT` collides, is **swallowed** by a
> `try/catch` that logs `message.retry.persist.failed` and falls through to an in-memory fallback commented
> *"still re-parkable this run."* The second agent's content is never persisted and is **gone on the next
> daemon restart**, while the first agent's identical row survives. The comment asserts a guarantee the
> constraint denies — the same *report-the-intent-not-the-outcome* disease as SENDRAW-1 and LOGOUT-WAIT-1.
> **Reachable now:** Ms_Chelly ↔ CELLO_Support is a two-local-agent session, the exact DOD-LOOP-1 case.
> Re-keying `retry_queue` on `agent_id` makes the correct constraint `UNIQUE(agent_id, session_id,
> nonce_hex)` fall out for free; the swallowing catch is made loud in the same unit.

## The confirmed hazards (self-inflicted, single-machine — no remote actor)

`agent_name` **never crosses the wire as identity** — a counterparty is pubkey-identified, always. So the
only actor who can trip this is the operator or a local DB/restore operation.

1. **Retire-reuse history bleed.** `removeAgent` keeps all session/transcript/contact rows and **frees the
   name** (partial unique index covers only non-retired). Create a new agent with a retired one's name —
   fresh `agent_id`, **fresh pubkey** — and its every `WHERE agent_name = …` query returns the dead
   identity's rows: its transcript, its contacts, and its interrupted sessions. Resuming one of those
   would try to seal/co-sign with a *different keypair* — FROST-share mismatch and a divergent seal chain,
   not merely stale data. Directly violates the sovereign-identity model: two distinct pubkeys must share
   nothing.
2. **Rename is structurally blocked.** The `agents` table would rename in one `UPDATE`; the children orphan
   all history. Rename and this defect are the *same work*. **A note the rename story must inherit (not this
   unit's problem):** because `agent_name` is the default outbound moniker (AC1b), a rename **changes the
   label counterparties see on the next session offer** — a wire-visible effect of a purely local op. Rename
   must decide deliberately: re-declare the agent to the world, or pin the old name as an explicit moniker
   to keep the outward label stable? Counterparties who set their own pet name are unaffected (pubkey-pinned).
3. **Restore collision (UNVERIFIED — flag it).** `cello_restore` inserts agent rows. Restoring a backup
   containing `Ms_Chelly` onto a daemon that already has a *different* active `Ms_Chelly` either fails
   (data loss) or slips two active agents under one name — the collision the partial index exists to
   prevent, via a path that may not honour it. **Not verified.** Once the join is on `agent_id`, it is
   structurally impossible either way.

## Why this is safe where June-26 was not

**It is solely client-side, and it deletes nothing.** Verified 2026-07-10:
- **The directory has no `agent_name` column** (grep empty). It keys agents by `k_local_pubkey`
  (`agent_presence`) and its own `agent_id`/`account_id` (`agent_profiles`). It has never known local
  agent names — consistent with the **PII-free directory** privacy policy: a human-chosen name is exactly
  the identifying label the federated (possibly-public) directory is designed never to hold.
- **Five of the six tables are purely client-local.** The only session-derived data at the directory is
  the MMR tamper-evidence (`conversation_proof_leaves`, keyed by `session_id` + `leaf_hash`) — **not
  `agent_name`**, untouched by this change.

The June-26 incident was a **purge** (delete local content, directory keeps it → desync; or `TRUNCATE` →
broken replication). **This destroys no data and syncs nothing.** `agent_name` sits in all six composite
PRIMARY KEYs, and **SQLite cannot alter a PK** — so this is a per-table *rebuild* (create the new table
keyed on `agent_id`, copy every row across with the backfilled id, drop the old, rename), not a bare
`ADD COLUMN`. That rebuild is **data-preserving**: every row is copied before the old table is dropped, it
runs inside one atomic `BEGIN…COMMIT` (SQLite DDL is transactional — a crash rolls the whole thing back),
and **no row content is destroyed, nothing leaves the machine, and no value the directory replicates
changes** (pubkey, `session_id`, leaf hashes untouched; the directory keys on `k_local_pubkey` and has no
`agent_name`). **Nothing to sync, because nothing the directory can see moves.** The retire-reuse orphans
need no purge either — once joined on `agent_id`, a new same-named agent (different `agent_id`) never
matches them; the dead rows sit inert. **The hazard closes without destroying a row.**

**Do the FULL fix now — reject the "leave the PK" shortcut.** A cheaper version (add `agent_id`, re-point
only the queries, leave `PRIMARY KEY (agent_name, …)` in place) is **not** zero-impact: the schema would
still read `PRIMARY KEY (agent_name, …)` six times, which is the exact misleading artifact that propagated
this defect — the next table gets copied "to match." And the migration risk that would justify the
shortcut is **near-zero right now**: one operator, on a machine whose SQLCipher DB is wipeable without loss.
Every future operator makes the table rebuild *more* dangerous, so deferring it schedules the riskiest
step for the worst time. Rebuild the PKs now, while the only database it can break is one we would happily
wipe.

## Acceptance criteria

- **AC1 — PROVE NO WIRE FRAME IDENTIFIES A PARTY BY NAME (do this first, it gates everything).**
  ⚠️ **The premise is true; the naive wording is FALSE and dangerous — an agent's NAME *does* cross the
  wire.** When an agent has no MONIKER-1 override, its `agent_name` IS the default outbound moniker
  (`db-identity-store.ts:369`, `getOutboundName() → moniker ?? agent_name`), and the moniker rides the
  session-offer frame (MONIKER-2). Observed live all session: `offered_moniker: "Ms_Chelly"`,
  `"CELLO_Support" (self-declared)`. **Do not "prove agent_name never crosses the wire" — it does.** A test
  written to that false claim would grep, find `offered_moniker`, conclude failure, and "fix" it by cutting
  the `?? agent_name` fallback — **deleting the shipped MONIKER-1/2 feature to satisfy a mis-worded AC.** A
  wrong AC is worse than a missing one: it recruits a diligent implementer into breaking something.
  - **(a)** No frame encoder/decoder in `core/transport/src`, `core/protocol-types/src`, or the directory's
    `directory-frames.ts` / `directory-types.ts` declares a field **named** `agent_name` / `agentName`.
    Parties are identified by **pubkey and `session_id` only**. (Grep confirmed empty 2026-07-10.)
  - **(b)** The single path by which an agent's *name* reaches the wire is `offered_moniker` — the MONIKER-1
    default. It is a **self-declared display label**: `MONIKER_RE`-bounded, rendered `(self-declared)` to
    the receiver, **pinned-to-pubkey** by the receiver's contact store, never a lookup key, never a join
    key, and **never persisted by the directory** (which forwards it and has no `agent_name` column —
    PII-free policy). It is display, not identity, and is **out of scope of this migration**: the local
    join key changes; the wire label does not. **Assert (b) POSITIVELY** so no future reader severs the
    moniker to make a test pass.
  - *The premise this defends — changing the local DB join key cannot desync the directory or confuse a
    counterparty — HOLDS: this migration alters not one byte on the wire.*
  - **Out of scope, and correct:** the local `daemon↔gateway↔MCP-shim` IPC uses `agent_name` pervasively
    for one-machine addressing/display (`cello_use_agent { name }`). Safe because IPC resolves **only
    active** agents and active names are unique (partial index) — the retire-reuse ambiguity that poisons
    the seven tables (which keep *retired* rows) cannot arise where the boundary is never crossed.
- **AC2 — full transactional table rebuild (NOT a shortcut).** `agent_name` is in all six composite PKs,
  and SQLite cannot alter a PK, so each table is rebuilt: create the new table keyed on `agent_id`,
  `INSERT INTO new SELECT …` copying every row with `agent_id` backfilled from the local `agents` table
  (`agent_name → agent_id`), drop the old, rename. **All six rebuilds in ONE `BEGIN…COMMIT`** — SQLite DDL
  is transactional, so a crash rolls the entire migration back atomically. The migration verifies its own
  completeness **before commit** (row counts match pre/post), and fails loud rather than half-commit.
  Idempotent (skip if already rebuilt).
  **Completeness rule differs for `retry_queue` (nullable `agent_name`):** the six `NOT NULL` tables assert
  *every* row has a non-null `agent_id`. `retry_queue`'s legacy direct-retry rows store `NULL`
  `agent_name` (not agent-scoped — true, must survive), so its rule is: a non-null `agent_name` MUST
  resolve to an `agent_id` or ABORT; `NULL` stays `NULL`. Completeness = zero rows where `agent_name IS
  NOT NULL AND agent_id IS NULL`.
  **Explicitly rejected:** the "add `agent_id`, re-point queries, leave the PK" shortcut. It leaves
  `PRIMARY KEY (agent_name, …)` in the schema — the misleading artifact that propagated this defect — and
  defers the risky rebuild to when there are operators whose DBs cannot be wiped. Do it fully now, while
  the only database it can break is one we would happily wipe (one operator, wipeable).
- **AC3 — `agent_name` is demoted to a plain non-key column.** After the rebuild it appears in **no**
  `PRIMARY KEY`, no `JOIN`, no `WHERE`-match, no index used for scoping — only in `SELECT`-for-display.
  Every `WHERE agent_name = …` across `session-node-manager.ts` and `daemon.ts` (a large surface — grep
  exhaustively; missing one is a silent scoping bug no type-checker catches) now scopes by `agent_id`.
  Enforce with the CLAUDE.md rule ("join on `agent_id`, never the mutable `agent_name`").
- **AC4 — retire-reuse is closed, proven.** Red-first: create agent A, generate sessions/transcript/
  contacts, retire A, create a NEW A (same name, new pubkey), assert the new A sees **none** of the old
  A's rows. Must fail on today's `agent_name` join and pass on the `agent_id` join.
- **AC5 — no other unmigrated children. ✅ DONE: found `retry_queue` (seven, not six).** Enumerated from
  the LIVE schema (not this doc's list) including `.sql` migrations. The seventh, `retry_queue`, is in
  scope with its own sub-requirements: re-key to `agent_id`, adopt `UNIQUE(agent_id, session_id,
  nonce_hex)`, **make the swallowing persist-failure catch LOUD**, and fix the `#positionCounters` keying
  inconsistency (`session_id` in `loadFromDb` vs `#ak(agentName, sessionId)` in `enqueueAwaitingContent`).
  It gets its OWN red-first test, distinct from AC4: two local agents (distinct `agent_id` + pubkey), same
  `session_id`, identical content → assert BOTH persist AND survive a restart; must FAIL today. Confirmed
  correct-as-is: `agents`, `trust_signals` (already `agent_id`), `telegram_settings` (singleton),
  `session_seal_leaves` + `relay_ack_receipts` (keyed on stable `agent_pubkey`), `session_seen_nonces`,
  `manifest_state`; and `client/db/migrations/V2` where `agent_name` is a plain column under `PRIMARY KEY
  (pubkey)`.
- **AC6 — restore collision resolved.** Settle AC's §3 unknown: `cello_restore` must not create two active
  agents under one name, and with `agent_id` joins a name collision on restore cannot bleed history.
- **SI/observability.** The migration logs `daemon.migration.agent_id_backfill` with per-table row counts;
  a backfill that leaves any null `agent_id` is a loud failure, never a silent skip.

## Scope, ordering, triage

- **Client-side only** (`cello-client core/daemon`). No directory change, no deploy, no `deploy.sh`.
- **Blocks the address-book work.** The [[2026-07-10_contact-address-book-design]] tables (`contacts` +
  new columns, and the `trust_signals` table FK'd to a contact) must be **born against `agent_id`**, or
  they grow this defect new roots. Do this migration first, or design the address-book tables on `agent_id`
  from the start.
- **Not launch-blocking, not CELLO_Support's queue now.** The trigger is an operator retiring and
  recreating a same-named agent on one machine — nobody does that at launch (one user, stable agents). But
  it is close to unforgivable on "do I trust this with my identity", it is **contagious** (every new
  table copied "to match" deepens it), and it is cheapest to fix before the address-book and trust-signal
  tables land on top of it.

## Related Documents

- [[2026-07-10_contact-address-book-design]] — blocked on this; its tables must key on `agent_id`.
- [[M8C-DEFINITION-OF-DONE]] — `DOD-INV-ONE-PRIMARY` (the cross-machine identity invariant this echoes).
- Repo `.claude/CLAUDE.md` — "Database — join on the STABLE key, never the mutable one" (the standing rule).
