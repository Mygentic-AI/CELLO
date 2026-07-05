---
name: cross-node-session-establishment-build-journal
type: build-journal
date: 2026-07-05
topics: [cross-node, session-establishment, discovery, visiting-auth, presence, federation, build-journal]
status: active
description: Living build journal for cross-node session establishment (Stories A/B/C). Follow-through doc — a fresh context reads this cold and is immediately productive. Anchored to the settled design 2026-07-04_1730_cross-node-session-topology.md.
---

# Cross-node session establishment — build journal

**Design (settled, implementation-ready):** `docs/planning/discussion_logs/2026-07-04_1730_cross-node-session-topology.md` — read IN FULL. Every contract in its "Implementation specification" section is a decision, not a suggestion.

## The three stories

- **Story A — directory-side (trustless-cello).** Item 0 (profile read-through), item 1 (discovery handler + frames), item 3 directory half (visiting flag gates BOTH presence writes). **ONE batched directory deploy** (all 3 regions, ~25–30 min).
- **Story B — client-side (cello-client).** Item 2 (discover-first flow + visiting-connection manager), item 3 client half (visiting flag at all THREE construction sites). Version cascade + publish.
- **Story C — five live acceptance scenarios**, multi-process, real regions. Vitest green ≠ done. This is the milestone-close gate.

## Build items (from the design doc)

- **Item 0 — profile read-through (prerequisite, FINDING-8).** New async `getProfileWithReadThrough(kLocalPubkeyHex): Promise<AgentProfile|undefined>` on `DirectoryStore` (`getProfile` is sync — can't add DB I/O inside it). Stub implements as `async () => this.getProfile(...)`. Pg impl: cache hit → return; miss → point-read `agent_profiles WHERE k_local_pubkey=$1 AND status='active'` → populate BOTH maps (`#profilesByLocalKey`, `#profilesByPrimaryKey`) → return; DB miss → undefined. Migrate `#resolvePrimaryPubkey` (→ async) + the visiting-legit call sites; leave miss-is-expected sync (registration existence check). Log `directory.profile.read_through` (pubkey short, hit/miss, correlationId).
- **Item 1 — discovery frame + handler.** Post-auth on the existing signaling stream. Req `{type:"discovery_lookup", target_pubkey:bytes}`; Resp `{type:"discovery_lookup_result", target_pubkey:bytes, state:"online"|"offline"|"unknown_agent", owning_node_ids:string[]}` (non-empty only when online, len 1 until k-knob). Handler: existence read → no row → `unknown_agent`; row → presence point-read; `online=true` AND owning-node heartbeat fresh (READ-001) → `online`+owning node; else `offline`. Dark-node (state 4) collapses to `offline` on wire, logged server-side `reason:"owning_node_dark"`. DB error → `{type:"discovery_lookup_error", reason:"lookup_failed"}` (+ `.failed` log), never fabricate offline/unknown, never abort the stream. Log `directory.discovery.lookup` / `.failed`.
- **Item 3 — visiting flag.** Add optional `visiting?:boolean` to `signaling_auth_response`. Client sets true ONLY on the transient connection (three sites in `signaling-manager.ts`). Not signature-bound (TBS unchanged). Directory: thread `visiting` to BOTH presence writes — connect + disconnect — skipping both when set. `#streams` set/delete unchanged.

## Retry / error contract (client, Story B)
- Always discover first on `cello_initiate_session`. Same-node shortcut if `owning_node_ids` includes current node → today's path, ZERO visiting connections.
- `target_offline` after discovery said online → re-discover → retry, **max 3 attempts, backoff 1s/3s**, then surface state 2.
- MCP error codes (never collapse): state2/retries-exhausted → `counterparty_offline`; state3 → `unknown_agent`; manifest-resolution failure for discovered node → `discovery_node_unresolvable`; DB lookup error → retryable (same as target_offline); old-directory unknown-frame → fall back to today's local-only behavior.
- Visiting-connection manager: daemon-held `node_id → {connection, refcount}`. Acquire on setup start (reuse if present), release on handoff-complete/failure/escalation. Idle safety-net timeout ~5min.

## Sequencing
Items 0+1+3-directory-half = ONE batched directory deploy (all regions). Client publishes AFTER. New client must tolerate old directory during rollout gap (unknown `discovery_lookup` frame → fall back).

## Published package versions at start (2026-07-05)
crypto 0.0.15 · protocol-types 0.0.13 · transport 0.0.13 · client 0.0.43 · daemon 0.0.28 · cli 0.0.26 · connect 0.0.55. (all on `latest` per STATE.md v0.0.69)

Version cascade for Story B: bump `core/client` → `core/daemon` → `core/cli`/`core/connect`; re-pin published `@cello-protocol/client` in `trustless-cello/packages/directory` (never workspace:*).

## Live acceptance scenarios (Story C)
1. Cross-node: Alice us1 / Bob eu1 — session + both seals. **Alice registered AFTER broker eu1 last booted** (else FINDING-8 masked).
2. Presence integrity: after Alice's transient eu1 conn closes, Alice still discoverable at us1 (owning=us1, online).
3. Stale-discovery retry: kill Bob's home mid-window → re-home → retry lands on survivor.
4. Known-but-offline / unknown-agent → `counterparty_offline` / `unknown_agent` (exact codes; no retry storm on state 3).
5. Same-node regression: two agents same node → existing path, ZERO visiting connections, ZERO new frames beyond one `discovery_lookup`.

## Code sites (verified 2026-07-05 against design doc; re-verify line numbers before edit — files evolve)
- `packages/interfaces/src/directory-store.ts:213` — `getProfile` (sync). Add `getProfileWithReadThrough` after it.
- `packages/interfaces/src/stubs/in-memory-directory-store.ts` — stub impl.
- `packages/directory/src/adapters/pg-directory-store.ts` — `getProfile` (~:1041), `loadProfiles` (~:230), existence read (~:365), maps `#profilesByLocalKey`/`#profilesByPrimaryKey`.
- `packages/directory/src/directory-node.ts` — `#processSessionRequest` (~:2926, sibling to model), auth hook (~:1647–1649 → `#recordPresence`), disconnect presence write (~:2209), `#resolvePrimaryPubkey` (~:2321).
- `packages/directory/src/agent-presence-repository.ts` — presence point-read; READ-001 heartbeat-freshness (~:99); upsert-on-connect (~:29).
- `packages/directory/src/directory-frames.ts` / `directory-types.ts` — frame encode/decode; auth decoder (~:378).
- cello-client `core/client/src/signaling-manager.ts` — auth response frame construction (three sites ~:258, :357, :576).
- cello-client `core/daemon/src/daemon.ts` — `cello_initiate_session` (~:2400); `signaling-connect.ts` — `connect()` (~:134), auth handshake (~:236).
- cello-client `core/daemon/src/directory-bootstrap.ts` — `manifestNodesToEndpoints`.

## Status log
- **2026-07-05 0655** — Journal created. Read design doc + CONTEXT.md + STATE.md + infra/CLAUDE.md in full. Both repos clean on main. Starting Story A (SPARC: S done via design doc; beginning A-phase reconnaissance of exact code sites).
</content>
