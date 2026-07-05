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

## Story B — client architecture map (from Explore, 2026-07-05; CORRECTS the design doc's client pointers)

**CRITICAL correction:** the design doc's item-3 client sites `signaling-manager.ts:258/357/576` are the **DEAD legacy standalone SDK** (`@cello-protocol/client` `core/client/src/signaling-manager.ts`) — daemon.ts:903 explicitly calls that stack dead. Do NOT edit it. The LIVE daemon path:
- **Directory connection:** `SignalingManager` from `@cello-protocol/transport` (`core/transport/src/signaling-manager.ts`). Holds status/queue/heartbeat/reconnect + `_currentStream`; does NOT do auth itself. `sendRaw(frame)` (:306) sends; `registerInboundHandler` (:764 dispatch) receives; `stop()` (:388) tears down; `get status()` (:293). Privately tracks `_currentDirectoryNodeId` (:228, set :701 from `ConnectResult.directoryNodeId`) — **NO public getter → must add one** (mirror `get status()`).
- **Auth handshake (the ONE live auth-response site):** `core/daemon/src/signaling-connect.ts` `createSignalingConnect(deps)` (:133) returns a `connect()` closure that builds a FRESH libp2p node + dials + 7-step handshake each call; `signaling_auth_response` constructed at **:192-196**. Deps: `getDirectoryEndpoint()` (→ `DirectoryEndpoint {peerId,multiaddr}`, :82), `getAuthIdentity()` (`{keyProvider,pubkeyHex}`), `logger`, `challengeVerifier?`, `publishNode?`. **Visiting flag = add a `visiting?` deps field, set true only for the visiting factory; the auth-response at :192 includes it.**
- **Per-agent connection cache:** `perAgentSignaling: Map<string,AgentSignaling>` (daemon.ts:636); built by `getAgentSignaling(name,kp,pubkey)` (:650). Do NOT put the visiting connection in this map.
- **Negotiator (inline object, daemon.ts:914-1015):** `.negotiate()` → `getAgentSignaling(...).signaling` → `waitForSignalingConnected` (:748) → `registerInboundHandler` for `session_assignment`/`session_request_error` (:965) → `signaling.sendRaw({type:"session_request",...})` (:970) → decode via `parseSessionAssignment`/`sessionRequestErrorReason` (`core/daemon/src/session-assignment-parser.ts`). **For cross-node: negotiate over the VISITING SignalingManager instead of the home one — parameterize/extract.**
- **Frame codec (client):** encode = inline object literal to `sendRaw({type:"discovery_lookup",target_pubkey})`; decode = new parse helpers in `session-assignment-parser.ts` mirroring `parseSessionAssignment` (→ `parseDiscoveryLookupResult`) + `sessionRequestErrorReason` allow-list (→ `discoveryLookupErrorReason`).
- **Manifest→endpoint:** `resolveConsortiumRoster()` (daemon.ts:459) → `ConsortiumEndpoint {nodeId,pubkey,peerId,multiaddr}` (directory-bootstrap.ts:75). `owning_node_id` (e.g. "aws-eu-central-1") matches `ConsortiumEndpoint.nodeId` (= manifest `ConsortiumNode.nodeId`). Find by nodeId → build `DirectoryEndpoint{peerId,multiaddr}`. Not found → `discovery_node_unresolvable`.
- **Visiting connection recipe:** `new SignalingManager({ connect: createSignalingConnect({ getDirectoryEndpoint:()=>fixedEndpoint, getAuthIdentity:()=>sameAgentIdentity, visiting:true, logger }), maxReconnectAttempts: 0-1 })`; use once (sendRaw + registerInboundHandler); `stop()` after handoff. Refcount by nodeId.
- **Error union:** SDK strict union `InitiateSessionResult.reason` at `core/client/src/types.ts:231` (add counterparty_offline|unknown_agent|discovery_node_unresolvable); daemon-side reasons are loose strings (just construct them). Protocol-type precedent for a real error frame: `core/protocol-types/src/revocation.ts` (already has `unknown_agent`).
- **Same-node shortcut:** `if (homeSignaling.currentDirectoryNodeId === owningNodeId)` → negotiate on home, ZERO visiting connections.

## Story B — ceremony-over-visiting-connection (the connection-aware-dispatch edge, RESOLVED)

The broker's delegated-signer FROST round-trip (`ceremony_request`→`ceremony_result`, which produces the assignment's FROST signature) rides the INITIATOR's stream to the broker = the VISITING connection. So the visiting SignalingManager MUST have `wireSessionCeremonyHandler` registered (session-ceremony.ts:314/:599 → participateInCeremony → sendRaw ceremony_result; the client runs the actual ceremony over its OWN roster via getConsortiumEndpoints, independent of the broker). getAgentSignaling (daemon.ts:696) wires it on the home connection.

**Visiting connection needs ONLY:** (1) `wireSessionCeremonyHandler({...signaling: visitingMgr, getConsortiumEndpoints: resolveConsortiumRoster, getNode:()=>visitingNodeRef,...})`; (2) the ad-hoc session_request→assignment/error handler (in the extracted runSessionRequest). NOT needed on visiting: wireSealCeremonyHandler / wireSessionOfferHandler / session_sealed & unilateral listeners / trust_signal_pickup / wirePerAgentSessionInbound — those are for the agent's HOME/target role and the seal (client-coordinated over own roster, needs nothing from the visiting connection). Design confirms: hold visiting through setup (until session_assignment arrives — the ceremony round-trip completes within that window), stop() after. Seal later over own roster.

**Refcounting is moot:** the negotiator has a per-agent single-flight (`negotiationInProgress`), so one agent can't have two concurrent cross-node setups. Per-negotiation visiting connection (open → use → stop), no shared-connection refcount needed. Note it.

## Story B re-pin decision (flag at publish)
trustless-cello `packages/directory` pins `@cello-protocol/client@^0.0.31` (caret on 0.0.x LOCKS the patch → exactly 0.0.31; already stale vs published 0.0.43). The directory's frame codec is SELF-CONTAINED (Story A edited `packages/directory/src/directory-frames.ts` directly) — it does NOT consume the client's discovery-frame mirror. So publishing the Story B client cascade does NOT functionally require re-pinning + redeploying the directory (a 25-30 min deploy) for cross-node to work. Decision at publish: cascade-publish the client (client→daemon→cli/connect), update the local install for Story C, but do NOT trigger an extra directory redeploy solely for the client-version bump unless a functional need appears. (Not a workspace:* violation — already a pinned semver.)

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

## Story A — finalized architecture (SPARC "A", verified against code 2026-07-05)

**Interface additions (`packages/interfaces/src/directory-store.ts`), both land with stub + pg impl:**
1. `getProfileWithReadThrough(kLocalPubkeyHex: string, correlationId?: string): Promise<AgentProfile | undefined>` — cache hit → return; miss → DB point-read `agent_profiles WHERE k_local_pubkey=$1 AND status='active'`, mirror `loadProfiles` row-map (agent_id fallback, `profile:{}`), populate all THREE maps (localKey, primaryKey, agentId), return; DB miss → undefined. Log `directory.profile.read_through {pubkey:short, result:"cache_hit"|"read_through_found"|"read_through_miss", correlationId}`.
2. `getAgentPresenceForDiscovery(kLocalPubkeyHex: string, nodeFreshnessMs: number): Promise<{ hasRow: boolean; rawOnline: boolean; owningNodeId: string | null; nodeFresh: boolean }>` — point-read `agent_presence` LEFT JOIN `directory_nodes` for heartbeat freshness. Stub is in-memory.

**Presence freshness:** export `PRESENCE_NODE_FRESHNESS_MS = 120_000` from `agent-presence-repository.ts`; `internal-api-server.ts` (local const today) + discovery both import it (one source of truth).

**`#resolvePrimaryPubkey` → async read-through.** All 5 call sites are in async methods (2983 processSessionRequest, 3601 processSealUnilateral, 4075 processSealUpgradeRequest, 4274 processSeal, 4425 processSealFrostSignature) — add `await`. The read-through warms the cache so the adjacent `getProfile(...)!==undefined` checks at 3605/4281 hit for the same pubkey.

**`#processConnectionRequest`:** fetch `senderProfile` ONCE at top via `await getProfileWithReadThrough(senderHex, cid)`; reuse for the requireRegistration gate (was `hasProfile` @2674) AND the sender context (was `getProfile` @2704). Target gate @2681 stays sync (`hasProfile`) — the target is home on the broker, always cache-warm. Registration existence check @2441 stays sync (miss-is-expected). Revoke-self @2370 left sync (not a cross-node session path — noted deferred FINDING-8 facet).

**Discovery handler `#processDiscoveryLookup(stream, targetHex, cid)`** (new `else if (parsed.type==="discovery_lookup")` in the authenticated dispatch ~2040): `getProfileWithReadThrough` → undefined ⇒ `unknown_agent`; else `getAgentPresenceForDiscovery(target, PRESENCE_NODE_FRESHNESS_MS)` → `hasRow && rawOnline && nodeFresh` ⇒ `online` + `[owningNodeId]`; `rawOnline && !nodeFresh` ⇒ `offline` (log `reason:"owning_node_dark"`); else ⇒ `offline`. Store throw ⇒ `discovery_lookup_error {reason:"lookup_failed"}` + `directory.discovery.lookup.failed`, never abort stream. Log `directory.discovery.lookup {targetShort, state, owningNode, correlationId}`.

**Frames (`directory-types.ts` + `directory-frames.ts`):** decode `discovery_lookup {target_pubkey:bytes(32)}`; encode `discovery_lookup_result {target_pubkey, state, owning_node_ids:string[]}` + `discovery_lookup_error {reason}`. Add `DiscoveryLookup` to `InboundSignalingFrame` union.

**Visiting flag (item 3):** `SignalingAuthResponse.visiting?: boolean`; decode `o["visiting"]===true?true:undefined` (TBS unchanged — not signature-bound); `let visiting=false` in the stream handler set from `resp.visiting`; gate `#recordPresence("online")` @1649 and `#recordPresence("offline")` @2209 behind `!visiting`. `#streams` set/delete unchanged.

**Testing:** pure-unit (run in `pnpm run test`): frame codec round-trips; discovery 3-state handler logic via `InMemoryDirectoryStore`; read-through via stub; visiting codec. pg-backed `describeLive` (CELLO_ENV=local + Docker): real read-through after boot-load (FINDING-8), visiting presence-skip on connect+disconnect. Docker is being brought up to run these; Story C is the live gate.

## Story A implementation — DONE (directory-side), pending review + deploy

**Code (all directory-side; client mirror is Story B):**
- Item 0: `getProfileWithReadThrough` + `getAgentPresenceForDiscovery` on `DirectoryStore` (interface + `AgentPresenceLookup` type + barrel export); stub impls (+ `setPresenceForDiscovery` test seam); pg impls (read-through mirrors `loadProfiles` mapping, populates all 3 caches; presence read delegates to new `readPresenceForDiscovery` free fn). `#resolvePrimaryPubkey` → async read-through; 5 call sites `await`ed. `#processConnectionRequest` → one read-through up front (gate + sender context). `PRESENCE_NODE_FRESHNESS_MS` exported from repo, internal-api imports it.
- Item 1: `discovery_lookup` decode + `discovery_lookup_result`/`_error` encoders (directory-frames + directory-types); `resolveDiscoveryState` pure resolver (`discovery-lookup.ts`); `#processDiscoveryLookup` handler wired into the authenticated dispatch; logs `directory.discovery.lookup`/`.failed`.
- Item 3 dir half: `visiting?` on `signaling_auth_response` (decode, TBS unchanged); `let visiting` scoped in the stream handler; gates BOTH `#recordPresence` writes (connect @auth hook, disconnect @finally); `#streams` unchanged; logs `directory.auth.visiting`.

**Tests — 28 new, all green (+ full directory suite 689/0 in the real `pnpm run test` gate):**
- `cross-node-discovery-frames.test.ts` (10) — codec round-trips + visiting decode. Pure.
- `cross-node-discovery-state.test.ts` (6) — the 3-state decision table. Pure.
- `cross-node-discovery-pg.live.test.ts` (6, describeLive) — real-schema read-through incl. **FINDING-8 (register AFTER boot-load → getProfile misses, read-through hits)** + presence read (online/dark/offline/no-row).
- `cross-node-discovery-handler.test.ts` (6) — discovery handler 3-state over the REAL wire (in-memory), + pg-backed **visiting presence integrity = Story C scenario 2 at unit level** (normal auth writes / visiting auth skips / visiting connect+disconnect over another-node-owned row leaves it untouched — proves both gates).

**Gate:** `pnpm run test` (no CELLO_ENV) 689/0 ✓ · lint 0 errors ✓ · typecheck `tsc --build` ✓ · (no separate `build` script in repo). Under `CELLO_ENV=local` ~118 pre-existing infra-heavy live/docker tests fail (need real multi-region infra / container orchestration) — NOT my changes: all 28 cross-node tests + sampled untouched live tests (writeapi-001, read-001) pass; the real gate is `vitest run` without CELLO_ENV.

**Design decision recorded — resolve-throw on DB error (fail-fast, consistent):** `#resolvePrimaryPubkey` is now async and can throw on a read-through DB error (cache-miss + DB blip). It does NOT catch/return-undefined (that would silently mask a DB error as "no profile" → single-key, the exact silent fallback the design forbids). A throw propagates like the pre-existing adjacent `await hasConnection`/`await isAgentSuspended` in the same method → `uncaughtException` handler → directory exit 1 → ECS restart → client fails over. This is the established DB-down posture and satisfies the sovereign-node availability invariant. No special-casing added (would be inconsistent). Reviewers asked to confirm.

**Local dev DB note:** the docker-compose local pg had a dirty 6-week-old volume stuck at V29 (Flyway V30 partial + a V17 checksum drift). `docker compose down -v && up` re-migrated clean to V41. Not a code/migration change.

## Status log
- **2026-07-05 0655** — Journal created. Read design doc + CONTEXT.md + STATE.md + infra/CLAUDE.md in full. Both repos clean on main. Recon complete. Docker brought up + local DB reset to V41.
- **2026-07-05 ~0930** — Story A directory-side code + 28 tests complete, gate green. Dispatched both mandatory reviewers on the uncommitted diff.
- **2026-07-05 ~0950** — Story A committed `bafed51a`, pushed to origin. **Directory pipeline `cello-directory-pipeline` (us-east-1) InProgress** for `bafed51a` — batched deploy of items 0+1+3-dir-half to all 3 regions (~25-30 min). Pre-change health check GREEN (6/6 ECS 1/1, 6/6 DNS). After deploy: MANDATORY relay cascade (restart all 3 relays to re-register) + update STATE.md + re-sign manifests if relay IPs changed. Then Story C can run against live. Writing Story B (cello-client) during the deploy window.
- **2026-07-05 ~0945** — **Both reviewers CLEAN, no blocking findings.** code-reviewer: nothing ≥80 confidence; error quality, async migration (5 awaits), read-through mapping, visiting gating (no cross-stream leakage), test coverage all verified correct. cello-fallback-finder: **NO SILENT FALLBACKS**, no HIGH; all 6 suspect paths fail loud. Non-blocking notes DEFERRED (not fixed — scope/settled-design discipline): (a) dark-node logged at info per design; (b) resolve-throw on session/seal DB error is unhandled-rejection→crash→restart, but pre-existing & consistent with adjacent `await hasConnection`, and NEVER fabricates success — adding a new `session_request_error{lookup_failed}` would bleed into client compat (Story B); (c) `#processRevokeAgent` self-revoke still sync getProfile — out of Story A scope, matches doc's "leave miss-is-expected sync". Committing Story A directory-side; next: batched directory deploy (all 3 regions).
</content>
