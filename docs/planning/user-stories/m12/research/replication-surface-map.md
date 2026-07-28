---
name: M12 research — replication and mutable-table surface map
type: research
date: 2026-07-28
milestone: M12
status: complete
topics: [m12, anti-entropy, replication, kill-switch, mmr, research]
description: >
  Explorer-produced inventory (2026-07-28) of the 21-table publication set, mutable-table
  lifecycles, the kill-switch path, the MMR/checkpoint machinery, sequence staggering, and the
  directory_nodes anomaly root-cause. Input to DOD-AE-DESIGN-1. File:line refs are to that
  day's main.
---

# Replication surface map (design input for DOD-AE-DESIGN-1)

## Designer-critical findings (the ten that change the design)

1. **Table-wide hash chains fork by construction under multi-master.** `insertWithChain` orders by local `id`; staggered sequences + replication make each node's predecessor arrival-dependent. Already knowingly broken: "seal_notarizations … its chain is never verified → no fork" (setup-replication.sh:168). Fix direction: per-row/per-subject chains (the `registrations` pattern converges) or rely on the MMR.
2. **The existing checkpoint cross-signing CANNOT reach threshold in the live mesh.** The MMR tables (`conversation_proof_leaves`, `_mmr_nodes`) are NOT replicated, so each node's peaks differ, `computeCheckpointHash` differs, and `verifyAndSign` refuses (`federation.checkpoint.proposal.hash_mismatch`). The checkpoint machinery was never a working commitment over replicated state. Also: `identity_merkle_root` is a permanently-empty slot (read back from the previous row, never computed).
3. **`burned=true` drives irreversible local share destruction** (`directory-node.ts:1207-1215` → `destroyShares`). Any sync that can deliver a spurious burn destroys key material permanently. `burned` is monotonic (merged with OR) — the ONLY safely-mergeable field; `paused` under naive LWW on `updated_at` can un-pause on clock skew.
4. **The kill-switch honor-check fails OPEN on missing profile** (JOIN to agent_profiles → zero rows → "not suspended" → sign blind; documented at directory-node.ts:1218-1232) but fails CLOSED on DB error (`#isAgentPaused` returns true on throw). Preserve exactly that asymmetry; close the missing-profile hole.
5. **`primary_holder` must NEVER sync** (V44:7-16 is explicit): each node holds only what a daemon directly attested to it; replication would let a superseded daemon resurrect. Sovereign-local by design.
6. **`pickup_queue` hard-DELETEs sealed ciphertext on ACK** on purpose. A resync that re-inserts deleted rows resurrects ciphertext the protocol promised to destroy (and re-arms the hash_mismatch poison pill). Deletion must dominate in the merge.
7. **The anti-entropy-friendly pattern already exists in-repo: `signal_records`** — content-addressed composite PK `(signal_hash, accepting_node)`, revocation as INSERT tombstone, supersession derived from row existence (V46 view), explicitly because replicated UPDATEs are dropped when they beat their target row (F4). Copy this shape.
8. **`conversation_seals`' children (`conversation_participation`, `conversation_attestations`) are NOT in the publication** despite same-transaction writes + FKs → remote-homed seal detail is structurally broken TODAY. The sync set must include them (or the seal payload must carry them).
9. **FKs are not enforced on today's subscriber** (`session_replication_role = replica`, measured — V46:85-87). App-level sync re-enables enforcement → arrival order matters or FKs need deferral in the apply transaction.
10. **`directory_nodes` single-row anomaly root cause** (answers the standing question): BIGSERIAL id collision on pre-stagger rows + with `REPLICA IDENTITY USING INDEX`, an UPDATE for a row the subscriber lacks is SILENTLY DROPPED (same F4 class), so a once-missed row never heals; compounded by a missed `REFRESH PUBLICATION` after V38 (recorded in the M8B build journal). Nodes DO self-register (heartbeat upsert, agent-presence-repository.ts:123-140, 45s interval).

## Also load-bearing

- `setup-replication.sh` is CURRENTLY UN-RUNNABLE: PUBLICATION_TABLES still lists `identity_tree_entries`, dropped by V48 — `ALTER PUBLICATION … SET TABLE` fails on any ≥V48 database. (The mesh being retired makes this moot, but it proves the script is already rotten.)
- Natural-key inventory: staggering (SEQ_INCREMENT=1000) exists ONLY for the ten BIGSERIAL-id tables; nine tables already have natural/UUID keys. Sync on natural keys ⇒ the entire staggering mechanism can be deleted. Caveat: BIGSERIAL `id` is load-bearing for chain ORDER — resolved by finding 1.
- Sovereignty markers already exist: `owning_node_id` (agent_presence, sessions, pickup_queue), `accepting_node` (signal_records), `coordinator_node_id`. Key ownership off these, don't invent new provenance.
- RLS/GRANTs make append-only physical: `cello_service` CANNOT update/delete conversation_seals, seal_notarizations, checkpoints, revocations, user_accounts, relay_registrations; `authorized_issuers` is SELECT-only to the app on purpose. The sync writer inherits these constraints.
- `pgaudit.log = all` cluster-wide: sync chatter multiplies audit log volume — scope pgaudit or budget for it.
- No triggers, no cascades, one view (`signal_records_effective`) across all 48 migrations. All logic is app-side.
- `agent_suspensions` ordering column is `updated_at` only; suspension is insert→update, never delete. `agent_presence` is high-churn LWW-safe on `updated_at`; its online upsert legitimately overwrites `owning_node_id` (ownership migrates — part of the value).
- Single-flip tables (`pre_authorization_tokens.consumed_at`, `capability_claim_codes.redeemed_at`): divergence = once-per-node consumption, explicitly accepted in-code because the real single-use gate is the (unreplicated) nonce binder.
- Kill-switch consult sites (all local-DB): directory-node.ts 1340 (commit), 1395 (sign), 1685 (refresh), 2196 (brokering). Write path: POST /internal/agent-write → agent-write-repository.ts:45-80; `revocation_flag` is the only accepted write kind.

## Full per-table inventory

(Explorer report, verbatim classification — table name | class | conflict key | ordering | producers | consumers.)

1. `agent_profiles` — append + 1 mutable col (`account_id`) | UNIQUE k_local_pubkey / primary_pubkey / agent_id | id, created_at | pg-directory-store.ts:857,896 (ON CONFLICT DO NOTHING); update pre-auth-token-repository.ts:543 | suspension JOIN :350, hasAgentProfile :365, agent-write-repository.ts:27, presence :191
2. `conversation_seals` — append-only (RLS INSERT+SELECT) | UNIQUE conversation_id | id + chain_hash | insertWithChain :700 | analytics :422,:452; internal-api :707
3. `conversation_seal_staging` — mutable+deleted (ephemeral) | UNIQUE session_id | id, recorded_at | mmr-store.ts:180 ins, :236 upd, :366 del; pg-directory-store.ts:1945 del | checkpoint svc + :1869
4. `seal_notarizations` — append-only | UNIQUE (session_id, seal_type) V31 | id + chain_hash | insertWithChain :548,:567 | internal-api :706; dedup directory-node.ts:4070,4263
5. `directory_checkpoints` — append-only | UNIQUE checkpoint_id | id + chain_hash | mmr-store.ts:342 AND pg-directory-store.ts:1722 (two incompatible writers; the latter reuses peak_hash for checkpoint_hash) | :1897-1929
6. `checkpoint_node_signatures` — append-only, NOT chained | UNIQUE (checkpoint_id, node_id) | id, signed_at | :1617 | :1637
7. `relay_registrations` — append + deregistered_at update (chain-excluded) | UNIQUE relay_id | id + chain_hash | :2074 | :2046,:2088
8. `sessions` — append + mutable participant cols | UNIQUE session_id | id + chain_hash | ins :1574,:2268; upd :2251 | :1559,:1585,:2240,:2313
9. `pending_notifications` — insert+delete (no UPDATE grant) | PK notification_id UUID | created_at | pg-notification-queue.ts:72 ins, :166 del | :114,:154
10. `user_accounts` — append-only chained | PK account_id UUID, UNIQUE phone_stub_hash | id + chain_hash | :953; pre-auth :511 | :967 etc.
11. `registrations` — MUTABLE, PER-ROW chain (converges) | PK id UUID; partial UNIQUE phone_stub_hash | updated_at + row chain | ops-agent repository.ts:305+ | ops-agent state machine
12. `pre_authorization_tokens` — single-flip consumed_at | PK id UUID, UNIQUE token | issued_at/consumed_at | :149,:221 ins; :308 atomic consume | :308
13. `agent_revocations` — append-only tombstone | PK agent_id | revoked_at | :319 (DO NOTHING) | in-mem index :338; directory-node.ts:2188
14. `agent_suspensions` — MUTABLE kill switch | PK agent_id | updated_at; `burned` monotonic (OR-merge) | agent-write-repository.ts:52 clear, :70 upsert | :350,:377,:383; presence :193
15. `identity_tree_entries` — DROPPED (V48) — still listed in the script (bug)
16. `agent_presence` — MUTABLE high-churn | PK k_local_pubkey | last_seen_at/updated_at | presence-repo :38,:60,:78 | :99,:185
17. `directory_nodes` — MUTABLE heartbeat upsert | UNIQUE node_id; REPLICA IDENTITY USING INDEX | last_heartbeat_at | presence-repo :125 (only prod writer; :123-140 self-register upsert, 45s) | :103 JOIN, :1527
18. `pickup_queue` — insert+delete (ciphertext, DELETE dominates) | PK id UUID (V39); partial UNIQUE (agent_id, signal_kind) WHERE acked_at IS NULL | created_at, owning_node_id | agent-write-repository.ts:109 ins; pickup-repository.ts:54,:64 del | :26 drain
19. `capability_claim_codes` — single-flip redeemed_at | PK code | created_at/redeemed_at | pre-auth :252 ins, :566 redeem | :566
20. `signal_records` — append + amend via tombstone/derivation (THE PATTERN) | composite PK (signal_hash, accepting_node) | created_at/revoked_at | signal-write.ts:271 ins, :293 supersede, :632 revoke-tombstone | view signal_records_effective
21. `authorized_issuers` — operator-only (app: SELECT only) | PK pubkey | added_at/revoked_at | migrations/ops only | signal-write.ts:143

**Not in the publication but same-transaction/FK-coupled:** conversation_participation, conversation_attestations (→ finding 8); conversation_proof_leaves / _mmr_nodes / _leaf_checkpoints (→ finding 2); primary_holder (→ finding 5); registry_documents, nonce-binding tables, connections, connection_requests, analytics.

**Kill-switch quotes** (verbatim, for the design's security section):
- `#isAgentPaused` (directory-node.ts:1186): store throw → `return true; // fail closed`
- Query (pg-directory-store.ts:350): `SELECT 1 FROM agent_suspensions s JOIN agent_profiles p ON p.agent_id = s.agent_id WHERE p.k_local_pubkey = $1 AND s.paused = true LIMIT 1` — and `rows.length`, never `rowCount ?? 0`.
- The gap (directory-node.ts:1218-1232): missing local profile → JOIN resolves "not suspended" → node signs blind; `frost.suspension.uncheckable` is observability-only.
- Burn merge (agent-write-repository.ts:74): `burned = agent_suspensions.burned OR EXCLUDED.burned`.
