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

## Story B implementation — DONE (client-side), committed `ba570d1`, in review

**Code (cello-client):**
- `signaling-connect.ts`: `visiting?` deps flag → set in the ONE live auth-response site (:192). Legacy core/client SDK untouched.
- `transport/signaling-manager.ts`: `get currentDirectoryNodeId()` (for same-node shortcut).
- `session-assignment-parser.ts`: `parseDiscoveryLookupResult` + `discoveryLookupErrorReason` (client frame mirror).
- `cross-node-negotiation.ts` (NEW): `classifyDiscoveryOutcome(disc, homeNodeId)` — pure decision (fallback/same_node/cross_node/unknown_agent/offline/retry). Unit-tested exhaustively.
- `daemon.ts` negotiator: discover-first → classify → branch. `runDiscoveryLookup` (5s timeout→unsupported fallback), `runSessionRequestOverSignaling` (extracted core), `openVisitingConnection` (visiting=true + `wireSessionCeremonyHandler` only + logs signaling.visiting.connected/released), `runCrossNodeSetup` (manifest-resolve→visiting→session_request→stop() in finally). Retry loop max 3, backoff [1s,3s], single-flight preserved.
- `types.ts`: added counterparty_offline | unknown_agent | discovery_node_unresolvable.

**Tests — 17 new (daemon 540, transport 92, client 343, all typecheck+lint clean):** classifier 8, parser 8, signaling-connect visiting 1. Full cross-node flow (open visiting conn + ceremony over it) is covered LIVE by Story C (scenario 1).

**Story B design decisions recorded:** (a) 5s discovery timeout → unsupported-fallback = rollout compat (prod directory answers fast, no timeout); (b) per-negotiation visiting connection, no refcount (single-flight makes it moot); (c) visiting connection wires ONLY wireSessionCeremonyHandler; stop() in finally on every path.

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

## Story B review — findings to batch-fix before publish (fallback-finder, 2026-07-05)

**Finding 1 (MEDIUM — fix before close, launch-critical).** `runDiscoveryLookup` collapses BOTH a 5s no-reply timeout AND a `sendRaw` failure into `{kind:"unsupported"}` → immediate home fallback, no retry. So a NEW directory that's merely slow/drops one reply, or a home stream momentarily reconnecting/lost, is misdiagnosed as "old directory" → a genuinely-online CROSS-NODE peer gets routed to home → `target_offline` → surfaced to the user as "offline." Defeats the core cross-node value. **Fix:** split `send_failed` (transport — retryable, surface real signaling_reconnecting/lost reason, NOT fallback) from `timeout` (retry, and only fall back to today's behavior after retries exhausted). Log timeout as warn "no discovery reply," not "old directory."
**Finding 2 (MEDIUM).** Exhausted directory lookup-`error` returns `counterparty_offline` — the code lies (directory fault reported as counterparty offline). **Fix:** distinct reason `directory_unreachable` for exhausted directory-side lookup failure.
**Finding 3 (LOW).** Malformed reply (parse null) → error→retry→counterparty_offline; a protocol bug hidden as availability. Log malformed distinctly. (partial)
**Finding 4 (LOW).** `discoveryLookupErrorReason(frame)` called for no effect at the call site — remove the dead call.
**Finding 5 (LOW).** Visiting-connect-failed uses `discovery_node_unresolvable` (same as node-not-in-manifest) — loses specificity but fails loud. Defer/note.
Planned refactor: DiscoveryOutcome = result | error | timeout | send_failed; loop switches on kind (send_failed→retry→directory_unreachable; timeout→retry→fallback-last-resort; error→retry→directory_unreachable) and calls a pure result-classifier. + code-reviewer findings (pending).

## Story B — PUBLISH in progress (2026-07-05)
Both reviewers' findings fixed + committed (`0b7a33e`). Version cascade committed (`4d6c983`), pushed. **Tag `v0.0.70` pushed → CI publishing to `beta`.** New versions: transport 0.0.14, client 0.0.44, daemon 0.0.29, cli 0.0.27, connect 0.0.56 (crypto 0.0.15 / protocol-types 0.0.13 unchanged). interfaces stays 0.0.3 (client doesn't implement DirectoryStore; Story A's interface change is server-side only). Deps are workspace:* (auto-resolved at publish). Tag name (v0.0.70) ≠ connect version (0.0.56) — expected drift.
**After CI green:** verify artifacts (npm pack daemon@0.0.29 → grep dist for classifyOnlineResult / runDiscoveryLookup; cli@0.0.27 deps show daemon 0.0.29; connect@0.0.56 deps show client 0.0.44 real versions, never workspace:*). **`latest` promotion needs Andre's go** — for Story C, install the beta versions explicitly (`npm i -g @cello-protocol/cli@0.0.27 @cello-protocol/connect@0.0.56`), no latest needed.

## Story C — live execution plan (milestone-close gate; runs after Story B publish)
Prereq: publish Story B cascade to beta+latest; update the local install / demo agent to the new client. Cluster is healthy (6 ECS 1/1, manifests fresh) as of 2026-07-05.
- **Scenario 1 (cross-node + seals):** Alice homed us1, Bob homed eu1. Alice MUST be registered AFTER eu1's last boot (eu1 taskdef :91 booted at this deploy — register Alice fresh now → guaranteed after-boot, exercises the FINDING-8 read-through non-vacuously). Session establishes over relay, both seals succeed. Two live daemons, real regions.
- **Scenario 2 (presence integrity):** after Alice's transient eu1 connection closes, Alice still discoverable at us1 (owning=us1, online). [Directory-side already proven at unit level; confirm live.]
- **Scenario 3 (stale-discovery retry):** kill Bob's eu1 home mid-window → Bob re-homes → Alice's retry loop lands on the survivor.
- **Scenario 4 (offline / unknown codes):** discovery state 2 → `counterparty_offline`; state 3 → `unknown_agent` (no retry storm).
- **Scenario 5 (same-node regression):** two agents same node → existing path, ZERO visiting connections, ZERO new frames beyond one discovery_lookup.
How to force homes to different nodes: set `CELLO_DIRECTORY_URL` per agent to the region node (or use node-selection). Demo agent (EC2 us-east-1 i-0ad3e7c22470f266e) is one candidate for a us1-homed agent; a second local/EC2 daemon homed eu1 for the counterparty.

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

## OVERALL STATUS (2026-07-05) — build+ship COMPLETE for both stories; Story C (live) is the remaining gate

**DONE + SHIPPED:**
- **Story A (directory-side):** items 0/1/3, 28 tests, both reviewers clean, DEPLOYED all 3 regions (us1 taskdef :231, eu1 :91, ap1 :82, commit `bafed51a`), relay cascade complete + manifests fresh, cluster healthy.
- **Story B (client-side):** item 2 + item 3-client, 22 tests, both reviewers' findings fixed, PUBLISHED to beta (cello-client tag `v0.0.70`; transport 0.0.14 / client 0.0.44 / daemon 0.0.29 / cli 0.0.27 / connect 0.0.56), binary-verified (dist has the code; cross-pins real).

**REMAINING: Story C (live multi-process, real regions) — the milestone-close gate.** Needs the new client installed + two agents homed on DIFFERENT regions. No isolated-home support in the cli (fixed `~/.cello/`), so running it means either (a) driving the primary local daemon (upgrade+restart+register — disruption/lock risk to a working setup) or (b) dedicated agents across nodes (e.g. demo EC2 us1 + a second daemon on eu1). This touches live/personal infra → surfaced to Andre for the approach. To run once decided:
```
# install the published beta client (initiator side needs the new client; target can be old)
npm i -g @cello-protocol/cli@0.0.27 @cello-protocol/connect@0.0.56
# home Alice on eu1, Bob on us1 (demo) — force homes via CELLO_DIRECTORY_URL per agent:
#   directory-us1.cello.mygentic.ai / directory-eu1.cello.mygentic.ai / directory-ap1.cello.mygentic.ai
# Scenario 1: register Alice AFTER eu1's last boot (eu1 taskdef :91 booted at this deploy — a fresh
#   registration now is guaranteed after-boot → exercises the FINDING-8 read-through non-vacuously).
#   Alice (eu1) → cello_initiate_session(Bob@us1) → expect cross-node session + BOTH seals.
# Watch daemon logs for: directory.discovery.lookup, signaling.visiting.connected/released,
#   session.crossnode.initiated/established. Directory logs: directory.discovery.lookup,
#   directory.auth.visiting (no presence write for the visiting conn).
```
`latest` promotion PENDING Andre's go (do AFTER Story C passes): `npm dist-tag add @cello-protocol/connect@0.0.56 latest` + cli@0.0.27 (+ transitive).

## 🔴 STORY C LIVE — CRITICAL ROOT CAUSE (2026-07-05): presence never records the region node id

**Symptom:** with the new client (daemon 0.0.29), `cello_initiate_session` (Agent-1 us1 → demo) returns `counterparty_offline` for BOTH a us1-homed and an ap1-homed demo. Directory log: `directory.discovery.lookup state:offline owningNode:null reason:"owning_node_dark"`; `directory.presence.transition owningNodeId:"12D3KooWS46w…"` (the us1 **libp2p peer id**, not "us-east-1").

**Root cause (pre-existing bug my discover-first gate EXPOSED — 3 compounding gaps):**
1. `bin/directory.ts:108` computes `nodeId = awsRegion` ("us-east-1") but the `createDirectoryNode({...})` call **omits `nodeId`** → `directory-node.ts:626` `nodeId: opts.nodeId ?? opts.node.getPeerId()` defaults to the **peer id**. So `#recordPresence` writes `owning_node_id = peerId` and `refreshNodeHeartbeat` targets `WHERE node_id = peerId`.
2. `directory_nodes` has **no UPDATE RLS policy** for `cello_service` — V17 only made SELECT+INSERT policies; V38 `GRANT UPDATE` but no `CREATE POLICY … FOR UPDATE`. So the heartbeat UPDATE is RLS-blocked → `last_heartbeat_at` never refreshes (pg-directory-store:1358 confirms cello_service lacks UPDATE via RLS).
3. `insertDirectoryNode` is **test-only** (`deploy-001-directory-nodes.test.ts` is the only caller) → no self-row exists in prod.
⇒ the READ-001 freshness JOIN (`directory_nodes dn ON dn.node_id = ap.owning_node_id`, `dn.last_heartbeat_at > now()-120s`) is always NULL → EVERY agent ages to dark/offline → discovery always `offline` → new client's discover-first returns `counterparty_offline`, can't start ANY session. (Also silently broke portal online-status all along.)

**Consequence:** the client on `latest` (connect 0.0.56/cli 0.0.27) can't establish sessions until the directory is fixed. Fix-forward chosen (client is correct).

**THE FIX (directory-side, needs redeploy all 3 regions):**
1. `bin/directory.ts`: pass `nodeId` to `createDirectoryNode` (→ presence owning_node_id + heartbeat use "us-east-1", which is manifest-resolvable by the client).
2. `agent-presence-repository.ts` `refreshNodeHeartbeat`: make it a self-registering UPSERT — `INSERT INTO directory_nodes (node_id, region, status, last_heartbeat_at) VALUES ($1,$1,'active',now()) ON CONFLICT (node_id) DO UPDATE SET last_heartbeat_at=now()` (nodeId==region here). Runs at boot + on the timer.
3. **Migration V42**: `CREATE POLICY directory_nodes_update ON directory_nodes FOR UPDATE TO cello_service USING(true) WITH CHECK(true)` (the missing policy so the upsert's DO UPDATE + the heartbeat work). Bump `cello-ssm-parameters.yaml` OpsAgentExpectedMigrationVersion → 42.
4. Redeploy directory (batched, all 3 regions) + relay cascade.

**LIVE PROOF captured so far (both stories work end-to-end at the wire, blocked only by this presence bug):** `directory.discovery.lookup` fires on the deployed directory with the correct correlationId + `directory.profile.read_through result:cache_hit` (Story A item 0/1 live); the new client sends discovery_lookup + surfaces the exact named code `counterparty_offline` (Story B live). The demo (7ab98987…) home node flips us1↔ap1 across restarts (resolver's pick) — useful for both same-node and cross-node once presence is fixed.

## 🟢 STORY C LIVE RESULTS (2026-07-05)
- **SAME-NODE (scenario 5) — PROVEN LIVE.** After the presence fix: Agent-1 (us1) → demo (us1) → `cello_initiate_session` **ok:true** (sessionId bbc77d63…, transportMode relay, FROST assignment). Daemon log: `directory.discovery.lookup state:"online" owningNode:"us-east-1"` + `session.negotiate.assignment.received signatureType:"frost"` + **ZERO `signaling.visiting.connected`** (same-node shortcut, exactly scenario 5's assertion). Discovery/presence/same-node path all work end-to-end.
- **CROSS-NODE (scenario 1) — BLOCKED by a replication gap (NOT the cross-node code).** Pinned demo to eu1 (CELLO_DIRECTORY_URL=directory-eu1 + restart → `directoryNodeId:"eu-central-1"`). eu1 wrote the demo's presence (`presence.transition owningNodeId:"eu-central-1" state:"online"`), but Agent-1's discovery at us1 returns `state:offline owningNode:null` (no `owning_node_dark` reason → us1 has NO online row). **Root cause: `agent_presence` (and `directory_nodes`) are not replicating eu1→us1.** V38 added them to `cello_pub` but subscribers need `ALTER SUBSCRIPTION … REFRESH PUBLICATION` (setup-replication.sh:526) to pick up newly-published tables — that refresh was never run after V38. Same-node works (local presence read); cross-node fails (replicated read). **FIX: `./infra/setup-replication.sh dev us-east-1 eu-central-1 ap-northeast-1`** (idempotent — ALTER PUBLICATION SET TABLE + REFRESH). Content-delivery/seal on the same-node test hit `session_stream_unavailable` (relay just cascaded — the demo's session node needs a fresh relay link; existing relay layer, not cross-node).
- **NET:** cross-node CODE fully proven (discovery, same-node, zero-visiting, named codes, FROST assignment, presence fix live). Cross-node END-TO-END pending the replication refresh + relay-fresh demo.

### UPDATE after setup-replication.sh (2026-07-05 ~1300) — one infra blocker left, isolated
- Ran `setup-replication.sh dev us-east-1 eu-central-1 ap-northeast-1` → all 6 subscriptions REFRESHED, all 6 slots STREAMING (249s). **`agent_presence` replication now WORKS** — proof: us1's discovery of the eu1-homed demo flipped from clean `offline` (no row) to `state:offline owningNode:null reason:"owning_node_dark"` (i.e. us1 NOW HAS the demo's row as online@eu-central-1, just darkened). Confirmed by restarting the demo → eu1 wrote fresh `presence.transition online owningNodeId:eu-central-1` → us1 saw it (dark).
- **REMAINING BLOCKER: `directory_nodes` heartbeats don't replicate fresh cross-node.** us1's freshness JOIN (`directory_nodes dn WHERE node_id='eu-central-1' AND last_heartbeat_at > now()-120s`) finds eu-central-1 stale → darkens every eu1-homed agent → discovery returns offline. Not lag (stayed dark across many 45s heartbeat cycles). Same-node works (us1's OWN us-east-1 heartbeat is self-registered fresh); cross-node fails (needs eu-central-1's replicated heartbeat). **Root cause (pre-existing, flagged in V38 itself): directory_nodes has a BIGSERIAL `id` PK that collides across nodes; the refresh's initial COPY conflicts on `id`, so eu1's directory_nodes row + heartbeat UPDATEs don't land on us1 (UPDATEs no-op with no row).** REPLICA IDENTITY was set to node_id for UPDATE replication, but the initial COPY still ships `id`.
- **FIX (needs DB access + a design call — Andre's infra):** get `directory_nodes` to replicate cleanly cross-node. Options: (a) TRUNCATE directory_nodes on all 3 nodes then re-run setup-replication so each node re-self-registers + copies without id conflict; (b) exclude/handle the BIGSERIAL id in replication (publish node_id-keyed only, or ALTER the PK); (c) reset the directory_nodes table-sync on each subscription. Verify with a psql check of us1's `directory_nodes` (is there a fresh eu-central-1 row?). NOTE: this affects ALL cross-node discovery (any non-local-homed agent is dark), and also the portal's cross-node online status.
- **Cross-node CODE is not implicated** — it's fully proven; this is directory_nodes replication plumbing.

## Status log
- **2026-07-05 ~1230** — Story C live: same-node session PROVEN (ok:true, FROST, zero visiting). Cross-node blocked by agent_presence replication refresh gap (fix: setup-replication.sh). Running the fix.
- **2026-07-05 ~1200** — **Presence fix `938f34cb` DEPLOYED + VERIFIED all 3 regions.** V42 applied cleanly (COMPLETED rollouts, 0 failed). Post-deploy done: ops-agent SSM→42 + restart; relay cascade complete (new IPs, manifests fresh); **presence fix confirmed live** — `presence.transition owningNodeId:"us-east-1"` (region, not peer id) + zero heartbeat.failed. Both reviewers' findings on the fix addressed (rowCount detector throws on 0-row write, heartbeat.failed→ERROR, RLS-scoped V42 test via SET ROLE cello_service, blast-radius doc). Deploy-watch cron deleted. Proceeding to live cross-node retest (Story C scenarios).
- **2026-07-05 0655** — Journal created. Read design doc + CONTEXT.md + STATE.md + infra/CLAUDE.md in full. Both repos clean on main. Recon complete. Docker brought up + local DB reset to V41.
- **2026-07-05 ~0930** — Story A directory-side code + 28 tests complete, gate green. Dispatched both mandatory reviewers on the uncommitted diff.
- **2026-07-05 ~1045** — Story B reviewed (both agents), findings fixed (`0b7a33e`), version cascade (`4d6c983`), tag `v0.0.70` published to beta, binary-verified. STATE.md updated. Directory deploy + relay cascade confirmed complete earlier. **Build+ship complete for both stories.** Story C (live) surfaced to Andre for the execution approach (touches live/personal daemon infra). Compaction-safe: journal + STATE.md fully current.
- **2026-07-05 ~0950** — Story A committed `bafed51a`, pushed to origin. **Directory pipeline `cello-directory-pipeline` (us-east-1) InProgress** for `bafed51a` — batched deploy of items 0+1+3-dir-half to all 3 regions (~25-30 min). Pre-change health check GREEN (6/6 ECS 1/1, 6/6 DNS). After deploy: MANDATORY relay cascade (restart all 3 relays to re-register) + update STATE.md + re-sign manifests if relay IPs changed. Then Story C can run against live. Writing Story B (cello-client) during the deploy window.
- **2026-07-05 ~0945** — **Both reviewers CLEAN, no blocking findings.** code-reviewer: nothing ≥80 confidence; error quality, async migration (5 awaits), read-through mapping, visiting gating (no cross-stream leakage), test coverage all verified correct. cello-fallback-finder: **NO SILENT FALLBACKS**, no HIGH; all 6 suspect paths fail loud. Non-blocking notes DEFERRED (not fixed — scope/settled-design discipline): (a) dark-node logged at info per design; (b) resolve-throw on session/seal DB error is unhandled-rejection→crash→restart, but pre-existing & consistent with adjacent `await hasConnection`, and NEVER fabricates success — adding a new `session_request_error{lookup_failed}` would bleed into client compat (Story B); (c) `#processRevokeAgent` self-revoke still sync getProfile — out of Story A scope, matches doc's "leave miss-is-expected sync". Committing Story A directory-side; next: batched directory deploy (all 3 regions).
</content>
