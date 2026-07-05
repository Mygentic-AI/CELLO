---
name: cross-node-counter-collision-reset-fix-plan
type: implementation-plan
date: 2026-07-05
topics: [federation, logical-replication, bigserial-collision, sequence-staggering, database-reset, seal, mmr, cross-node]
status: planned
description: Fix the BIGSERIAL sequence-collision that breaks cross-node writes on non-primary directory nodes, via a full fresh database reset + growth-safe staggered sequences. Safe by construction (replication torn down before any wipe — avoids the 2026-06-25/26 truncate-cascade incident).
---

# Cross-Node Counter Collision — Reset + Staggered-Sequence Fix Plan

## Problem (verified, not inferred)

Replicated tables use `id BIGSERIAL PRIMARY KEY`. Postgres logical replication **copies rows but never advances the subscriber's sequence**. So a node that received its rows via replication (rather than writing them locally) has a sequence counter parked far below the real max id. Its **next local INSERT draws an id that already exists → duplicate-key on `_pkey` → the write fails.**

- Same code on every node; the difference is counter state. us1 wrote the rows → its counter is caught up (works). eu1/ap1 received them via replication → their counters are stuck near 1 (collide on first local write).
- **Live impact:** the cross-node seal `b970bdfe` (brokered on eu1) failed to persist `conversation_seals` (`conversation_seals_pkey` dup) and failed the MMR write (`conversation_seal_staging_pkey` dup, which rolled back `appendSeal`). eu1's MMR is empty as a result; us1's MMR is healthy (20 leaves).
- **Ground-truth diagnostic (2026-07-05):** collision-primed on eu1 — `conversation_seals`, `conversation_seal_staging`, `sessions`, `agent_profiles`, `user_accounts`, `relay_registrations`. `directory_checkpoints`/`checkpoint_node_signatures` empty (primed on first write). us1 clean. **ap1 subscription wedged at ~3590 apply-errors.**

Same class as `directory_nodes` (worked around via Option A) and `pickup_queue` (staggered `INCREMENT BY 3` in V34). This surfaced now because cross-node made a non-us1 node write these tables for the first time.

## What is NOT broken (so we don't over-fix)
- **Per-seal integrity** = the FROST signature in `seal_notarizations` — self-verifying, no chain needed. Intact.
- **Per-node MMR** (`conversation_proof_leaves`/`_mmr_nodes`) — not replicated, per-node, verified locally on inclusion-proof. Works on us1; suppressed on eu1 only by the collision above.
- **Per-table hash chains** (conversation_seals, sessions, …) — chained on write but the generic `verifyChain(table)` has **no production caller**; never verified live. Fork-harmless.
- **Federated checkpoint** (`checkpoint-coordinator.ts`: one coordinator writes, threshold co-signs, replicated) — the real "no node can forge the whole list" guarantee. **Built + wired but has produced ZERO checkpoints — dormant.** Single-writer by design → no fork. Out of scope here; separate future activation.

## Decision
Full fresh database reset (all test data — keep nothing) + growth-safe staggered sequences. Cleaner and simpler than fix-in-place: on empty tables `RESTART WITH {offset}` is trivially correct, and it also clears the wedged ap1 subscription and all cruft in one pass.

### Counter scheme (growth-safe — not tied to node count)
Fixed `INCREMENT BY 1000` (chosen once, supports up to 1000 nodes), per-region offset: us1→1, eu1→2, ap1→3, next→4… Adding a node is free and touches no existing node. Lives in `setup-replication.sh`, keyed by region.

## Safety — why this is NOT a repeat of 2026-06-25/26
That incident: a TRUNCATE ran while replication was **live** → deletes replicated → cascaded to nodes missing those rows → system broke. **This plan tears replication down BEFORE any wipe.** With zero subscriptions, no DML/TRUNCATE can propagate. Replication is rebuilt only after every node is clean and empty. The disaster's precondition (live replication during destructive ops) is removed.

## Plan (phased)

**Phase 0 — Prep**
- Lock the scheme (`INCREMENT BY 1000`, region→offset map).
- Un-pin the demo agent from eu1 (revert the temporary systemd override).
- Read `infra/STATE.md` and `infra/CLAUDE.md` first.

**Phase 1 — Tear down replication (all 3 nodes)**
- Drop every subscription on every node. **Verify zero subscriptions remain on all nodes** before touching any data. Nodes are now decoupled.

**Phase 2 — Wipe (each node independently)**
- TRUNCATE all data tables on each node (schema + Flyway migrations stay intact). Nothing replicates (no subscribers). Include per-node MMR tables.

**Phase 3 — Stagger sequences (each node)**
- For every BIGSERIAL table: `ALTER SEQUENCE … RESTART WITH {region offset} INCREMENT BY 1000`. Codify in `setup-replication.sh` (idempotent, region-keyed).

**Phase 4 — Rebuild replication (from empty)**
- Recreate publication — **add `seal_notarizations`** so seals federate (safe: staggered ids; its chain is never verified → no fork).
- Recreate subscriptions (initial copy from empty = instant, zero conflicts).
- Verify 0 apply-errors on all three.

**Phase 5 — Verify end-to-end (live, multi-process)**
- Register an agent **on eu1** → no collision.
- Cross-node seal → lands in eu1's MMR **and** `conversation_seals` **and** replicates to us1.
- `seal_notarizations` for the seal is retrievable from a non-broker node.
- All 3 subscriptions healthy; counters staggered.

## Consequence
Every existing agent (demo, Agent-1, …) must **re-register** afterward — `agent_profiles` is wiped. Local keys untouched; they just re-enroll (M8B quorum flow). Acceptable — all test data.

## Fixes in one pass
Collision (live bug) · wedged ap1 subscription · `seal_notarizations` federation gap. Dormant federated checkpoint remains a separate future activation.

## ✅ EXECUTION RESULT (2026-07-05, commit `4328fcb1` + reset)

**Fix committed** (`4328fcb1`): setup-replication.sh Step 5c staggering (residue-safe, TOCTOU table-lock,
positive STAGGER_DONE marker, serial-discovery by nextval default) + seal_notarizations in publication.
Reviewed by feature-dev:code-reviewer + cello-fallback-finder; every finding fixed before commit.

**Full reset executed, safe by construction:**
- Phase 1: dropped all 6 subs + 6 slots + publications. **Safety gate verified: 0 replication objects on
  every node BEFORE any truncate** (no 2026-06-25 cascade — replication was fully down first).
- Phase 2: TRUNCATEd all data tables on all 3 nodes (kept flyway_schema_history).
- Phase 3+4: re-ran setup-replication.sh → 6 slots streaming, publication=18 tables incl seal_notarizations.
- Verified: sequences staggered (conversation_seals/seal_notarizations/sessions last_value = **1/2/3 by node**),
  **all subscriptions 0 apply-errors** (ap1 un-wedged from 3590+).

**Fix PROVEN LIVE — direct test on the exact table that collided (`conversation_seals`):**
- Insert on eu1 → **id=2** (eu1 residue), insert on us1 → **id=1** (us1 residue).
- **All 3 nodes see BOTH rows, no `_pkey` collision** — the precise scenario that failed pre-fix now
  works bidirectionally. Deletes also replicated cleanly to all nodes (the 2026-06-25 failure mode is gone).
- Live cross-node write of `agent_presence` (demo on eu1) also replicated to us1.

**Follow-up (the documented consequence, NOT a fix gap):** all agents must **re-register** — their
`agent_profiles` were wiped, and startup only writes presence, not a profile (no auto-reconcile — that's
the deferred "absent-node reconcile" M8B item; there is no register MCP tool, it's the portal/ceremony
flow). A full end-to-end cross-node SEAL re-test is gated on that re-registration. The underlying
collision fix is proven directly at the DB level, so the seal will federate once agents re-register.

## Artifacts / touch points
- `infra/setup-replication.sh` — add per-region sequence staggering + `seal_notarizations` in publication.
- A reset runbook/script (idempotent, region-aware) for Phases 1–4.
- `infra/STATE.md` — update after each discrete action.
- Build journal — append results.
