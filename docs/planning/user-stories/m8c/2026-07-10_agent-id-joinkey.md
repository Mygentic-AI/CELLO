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

The June-26 incident was a **purge** (delete local, directory keeps it → desync; or `TRUNCATE` → broken
replication). **This is purely additive** — `ADD COLUMN` + backfill from data already local + re-point the
joins. No `DELETE`, no `TRUNCATE`, no row leaves the machine, no value the directory replicates changes
(pubkey, `session_id`, leaf hashes all untouched; `agent_name` stays as a display column). **Nothing to
sync, because nothing the directory can see moves.** And the retire-reuse orphans need no purge either —
once joined on `agent_id`, a new same-named agent (different `agent_id`) simply never matches them; the
dead rows sit inert. **The hazard closes without a single delete** — the opposite of what burned us.

## Acceptance criteria

- **AC1 — WIRE PROOF (do this first, it gates everything).** Prove `agent_name` never crosses the wire.
  Grep every frame encoder/decoder (`core/transport/src/signaling-manager.ts`, `core/transport/src/node.ts`,
  `core/protocol-types/src/*.ts`, the directory's `directory-frames.ts`) and every CBOR-encoded payload:
  `agent_name` / `agentName` must appear in **zero** wire structures — only the pubkey and `session_id`
  identify parties on the wire. A test asserts it (snapshot of encoded frames contains no agent-name
  field). *If this fails, the whole "client-only" premise is wrong and STOP — re-scope.*
- **AC2 — additive migration.** Idempotent PRAGMA-guarded `ALTER TABLE … ADD COLUMN agent_id` on all six
  tables, backfilled from the local `agents` table (`agent_name → agent_id`, current mapping). **No
  `DELETE`, no `TRUNCATE`, no `DROP`.** One transaction; the migration verifies its own completeness
  (every row has a non-null `agent_id`) before the daemon serves. A half-applied SQLCipher migration is
  unrecoverable — fail loud and roll back, never half-commit.
- **AC3 — re-point the joins.** Every `WHERE agent_name = …` / `PRIMARY KEY (agent_name, …)` / `JOIN` on
  the six tables uses `agent_id`. `agent_name` remains only in `SELECT`-for-display. Enforce with the
  CLAUDE.md rule ("join on `agent_id`, never the mutable `agent_name`").
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
