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
2. **Rename is structurally blocked.** The `agents` table would rename in one `UPDATE`; the six children
   orphan all history. Rename and this defect are the *same work*.
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

- **AC1 — WIRE PROOF, NETWORK-scoped (do this first, it gates everything).** Prove `agent_name` never
  crosses a **network** frame — the p2p signaling protocol and the directory protocol. Grep every network
  frame encoder/decoder (`core/transport/src/signaling-manager.ts`, `core/transport/src/node.ts`,
  `core/protocol-types/src/*.ts`, the directory's `directory-frames.ts` / `directory-types.ts`) and every
  CBOR-encoded network payload: `agent_name` / `agentName` must appear in **zero** of them — only the
  pubkey and `session_id` identify parties over the network. A test asserts it, named for the network
  scope. *If this fails, the "client-only, no directory desync" premise is wrong — STOP and re-scope.*
  **Explicitly OUT of scope: the local `daemon↔gateway↔MCP-shim` IPC** (`core/gateway/src/protocol.ts`,
  `types.ts`, `server.ts`, `client.ts`; adapter-claude-code `lock-file.ts`, `channel-params.ts`), where
  `agent_name` is pervasive and **correct** — it is one-machine, one-operator addressing/display that no
  peer or directory ever sees (`cello_use_agent { name }`). It is safe there for a structural reason worth
  the test's rationale: local IPC resolves **only active** agents, and the partial unique index makes
  active names unique — so the retire-reuse ambiguity that poisons the six session tables (which keep
  *retired* rows) cannot arise on the IPC path. The defect is specifically that the tables join on a name
  *across the retired boundary*; IPC never crosses it.
- **AC2 — full transactional table rebuild (NOT a shortcut).** `agent_name` is in all six composite PKs,
  and SQLite cannot alter a PK, so each table is rebuilt: create the new table keyed on `agent_id`,
  `INSERT INTO new SELECT …` copying every row with `agent_id` backfilled from the local `agents` table
  (`agent_name → agent_id`), drop the old, rename. **All six rebuilds in ONE `BEGIN…COMMIT`** — SQLite DDL
  is transactional, so a crash rolls the entire migration back atomically. The migration verifies its own
  completeness (every row has a non-null `agent_id`; row counts match pre/post) **before commit**, and
  fails loud rather than half-commit. Idempotent (skip if already rebuilt).
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
- **AC5 — no other unmigrated children.** `REMOVE-001` half-migrated; incomplete migrations rarely miss
  exactly one table. Enumerate every table with an `agent_name` column and confirm all six (and no more)
  are covered. If a seventh exists, it is in scope.
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
