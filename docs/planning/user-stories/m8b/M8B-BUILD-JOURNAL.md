---
name: M8B Build Journal
type: journal
date: 2026-06-29
milestone: M8B
status: open
description: >
  Append-only build journal for M8B (federation) + the live status board (best-of-both: M7's
  one-entry-per-unit archaeology plus a running status board so a fresh context resumes fast).
  NEVER edit a prior entry; add new entries at the BOTTOM. Pairs with M8B-DEFINITION-OF-DONE.md
  (target), M8B-PROCEDURE.md (runbook), M8B-DECISIONS.md (forks), M8B-SPEC.md (architecture).
---

# M8B Build Journal (append-only) + Status Board

## Status board (update as units land)

| Unit | DoD line | Repo(s) | Status | Notes |
|------|----------|---------|--------|-------|
| FED-SPINE-001 (enforcer, build FIRST) | DOD-SPINE-1 | e2e | 🔨 substrate green | harness spawns 3 sovereign dir nodes (own key/transport/port/DB) — j-tofn GREEN; journey asserts (DKG/seal/suspend) accrue per-unit |
| FED-MANIFEST-001 | DOD-MANIFEST-1 | client+dir | ✅ spine-proven | resolver + daemon resolve+log + 3-node manifest spine proof + pairwise binding + forged-refusal; 3 reviewers clean (fixes: http(s) endpoint contract, severity-graded roster, key guards); j-tofn 4/4 GREEN |
| FED-DKG-001 | DOD-DKG-1 | client+dir | ✅ spine-proven | multi-node 2-of-3 DKG fans to all 3 dirs (j-tofn-dkg GREEN); below-threshold gate + B1 fix (empty-roster refuses, no downgrade); 3 reviewers clean; MEDIUM count-gate parked |
| FED-SIGN-001 | DOD-SIGN-1 | client+dir | ⬜ not started | T-of-N session sign + seal; kill single-key fallback |
| FED-SUSPEND-001 | DOD-SUSPEND-1 | dir | ⬜ not started | quorum-aware refusal |
| FED-REFRESH-001 | DOD-REFRESH-1 | client+dir+crypto | ⬜ not started | share refresh / epoch rollover |
| FED-RELAYSIG-001 | DOD-RELAYSIG-1 | relay+client | ⬜ not started | relay-signed ordering + PERSIST-012 live |
| FED-OPTIONB-SETUP-001 | DOD-OPTIONB-SETUP-1 | dir+relay+client | ⬜ not started | client-presented assignment; kill relay dial |
| FED-OPTIONB-SEAL-001 | DOD-OPTIONB-SEAL-1 | dir+client | ⬜ not started | client-carried receipts; offline seal |
| FED-PRESENCE-001 | DOD-PRESENCE-1 | dir+infra | ⬜ not started | presence + directory_nodes → cello_pub |
| FED-PICKUP-001 | DOD-PICKUP-1 | dir+infra | ⬜ not started | pickup_queue → UUID + cello_pub |
| FED-DEPLOY-001 | DOD-DEPLOY-1 | infra | ⬜ not started | bump+publish, deploy dev, live proof, fix directory-ap1 DNS |

Legend: ⬜ not started · 🔨 in progress · 🟡 unit-green · ✅ spine-proven · 🚀 live-proven

---

## Entries (newest at bottom)

### 2026-06-29 ~20:15 — M8B kickoff (docs complete; no code yet)
**Origin.** A full day of code-grounded investigation (relay_unavailable → the directory→relay same-region
pin; the M7 dead-stack ghost; the 2-of-2 stopgap) converged on one milestone: federation. Andre, awake,
scoped it "wide, wide, wide" with full authorization (dev deploys + npm publish; alpha, solo, recoverable)
and resolved every fork (see M8B-DECISIONS.md): client-as-coordinator T-of-N; Option B for directory↔relay;
replicate presence+pickup; proof on local 3-dir spine → then dev.

**Key code truth (verified, two investigations each side):** the FROST crypto + DKG + signing ceremony are
genuinely T-of-N and LIVE; the 2-of-2 is pure wiring (3 call sites + a single-endpoint resolver + a
placeholder manifest). The client is already the coordinator → T-of-N = client fans out to N directory nodes
(relaying VSS-verifiable round-2 shares), no directory↔directory needed. Share-refresh is the one truly
NOT-BUILT piece. Relay ordering is unsigned (PERSIST-012 stranded in dead core/client). Full §2 in M8B-SPEC.md.

**Produced this session (docs only):** M8B-SPEC.md, M8B-DEFINITION-OF-DONE.md, M8B-PROCEDURE.md, this journal,
M8B-DECISIONS.md. Process corrected mid-setup: an initial branch-per-unit + dispatched-coder plan was scrapped
after re-reading M7-PROCEDURE — M8B follows the proven model (ONE coder thread, ONE assembly branch per repo,
read-only reviewers, cron drift-check). See M8B-DECISIONS.md.

**Next red (first unit of real work).** DOD-SPINE-1 — extend the spine harness to spawn **3 real directory
nodes** locally (today: one). It's the enforcer; until it exists, T-of-N can't be proven. Then DOD-MANIFEST-1.

**Branch / where.** **Work directly on `main`** in both repos (Andre's call ~20:45 — solo, deploying
anyway, no other coders; the `m8b-assembly` branch was merged to main + deleted). Commit often; batch
directory/relay pushes (a push there triggers the ~25-30 min CI/CD deploy).

**Reviewer / blockers.** N/A (docs only). No code, no tests run.

**Resume pointer (pre-compaction, ~20:45).** **Work on `main`** in both repos (no assembly branch —
merged + deleted). Cron heartbeat armed (job `6599d248`, every :17/:47) — **session-only, NOT durable; the verbatim prompt
+ schedule live in M8B-PROCEDURE.md §3b, re-arm from there after any restart/compaction.** The cron fires
the 3 kickoff self-audit questions (no stalling on reversible forks / no unwanted checkpoints / commit
often) then the drift check then advances. cello
MCP reconnected (can drive `cello_*` for live checks). **Currently starting DOD-SPINE-1** = extend
`packages/e2e-tests/src/spine/live-harness.ts` to spawn **3 real directory nodes** (today it spawns ONE).
Harness facts found: the single directory is spawned at `live-harness.ts:455-524` — env block `:462-491`
(`CELLO_DIRECTORY_KEY_FILE` / `CELLO_DIRECTORY_TRANSPORT_KEY_FILE` / `CELLO_DIRECTORY_LISTEN_ADDR` tcp/0 /
`HEALTH_PORT` / optional `CELLO_DIRECTORY_NODE_KEY_HEX` + `CELLO_DIRECTORY_CONSORTIUM_MANIFEST`); a
relay↔directory address cycle is broken by pre-deriving the relay PeerID from a fixed transport seed +
fixed port (`:449-453`); `restartDirectory` re-spawns an identical directory (`:519-524`); the cluster
returns `{directory getter, relay, restartDirectory, directoryUrl, stop}` (`:536-546`). To spawn 3:
each directory proc needs its OWN transport key + key file + health port + listen tcp/0; the DKG +
consortium manifest must enumerate all 3; DECIDE per-node DB vs shared (T-of-N alone needs only that each
node holds its own K_server share → per-node DB is fine; cross-node replication tests (PRESENCE/PICKUP)
need shared/replicated PG — likely a separate harness mode). Write the DOD-SPINE-1 design note in this
journal first (PROCEDURE §6), then red-first on a new `j-tofn.spine.test.ts`.

### 2026-06-30 (overnight) — DOD-SPINE-1 design note (§6) — multi-directory spine harness
**Target (this unit only).** `startSpineCluster` can spawn **N real directory binaries** on localhost
(N=3 for T-of-N), each a sovereign node: own signing key, own transport key (→ distinct PeerID), own
health port, own listen port, **own fresh-migrated Postgres database**. Expose them so a new
`j-tofn.spine.test.ts` can drive a 3-node cluster. DOD-SPINE-1's *own* green deliverable is narrow:
**3 distinct directory nodes come up, each with an independently-migrated DB, relay up, all reachable.**
The deeper J-TOFN assertions (2-of-3 DKG, seal-with-a-node-down, suspend-quorum) are RED and get ADDED
red-first INSIDE their own units (DOD-DKG-1, DOD-SIGN-1, DOD-SUSPEND-1) — not here — so the floor stays
green per unit (PROCEDURE §2.6, §4 "grow it one journey at a time").

**Why per-node DB (not one shared).** Sovereignty (CONTEXT.md): each directory node is independent; in
production each is a different region with its OWN database. T-of-N DKG = each node stores its OWN
K_server share locally — there is no shared store. So N independent fresh-migrated DBs
(`cello_spine_0/1/2`) is the *correct* model, and it's what exposes a cross-node-coupling bug as a
failure instead of hiding it. (Tier C PRESENCE/PICKUP later needs `cello_pub` logical replication
BETWEEN these DBs — a separate harness mode added in those units, NOT now.)

**Producer/consumer chain (what produces what).**
- *Relay PeerID* — pre-derived from a fixed transport seed + fixed port (existing cycle-break, harness
  `:449-453`). Unchanged: still ONE relay. For DOD-SPINE-1 the relay keeps pointing at directory[0] via
  `CELLO_DIRECTORY_MULTIADDR` (its seal-callback wiring, SPINE-7). Option B (Tier B) DELETES that dial —
  not this unit's job; noted so I don't prematurely rip it out.
- *Directory[i] signing key* — `FileKeyProvider.load(dirKeyFile_i)` produces seed+pubkey in the binary's
  format (existing pattern, one per node now). Consumer: each directory binary loads its own key file.
- *Directory[i] DB* — `ensurePostgres(dbNames[])` provisions + fresh-migrates each. Consumer: directory[i]
  reads `DATABASE_URL=…/cello_spine_i`. Distinct DBs ⇒ distinct K_server shares ⇒ true sovereignty.
- *Directory[i] coordinates* — each Proc emits `BootstrapEndpoint` (health/bootstrap up) + `ListenAddr`
  (libp2p multiaddr). Consumer: the daemon's resolver (today single-endpoint; DOD-MANIFEST-1 makes it
  enumerate all N from the signed manifest — that's the NEXT unit, not this one).

**Seam (where the change lands).** `packages/e2e-tests/src/spine/live-harness.ts` ONLY. It is the live
binary harness — no library node construction (the dead-stack discipline). No directory/relay/daemon
SOURCE changes in this unit; T-of-N wiring is DKG/SIGN. This unit is pure test-infra.

**Back-compat (hard constraint — 17 existing spine tests).** Every caller uses `startSpineCluster()` /
`{...}` + `cluster.directory` (singular) + `psqlSpine` (cello_spine) + exported `DATABASE_URL`. Default
`directoryCount: 1` MUST reproduce today's behavior byte-for-byte: single DB named `cello_spine`,
`cluster.directory`/`directoryUrl` as-is, `restartDirectory`/`stop` as-is. Multi-node path is additive:
- New opt `directoryCount?: number` (default 1).
- New cluster fields: `directories: Proc[]`, `directoryUrls: string[]`, `databaseUrls: string[]`
  (`directory`/`directoryUrl` remain = `[0]`). New `psqlSpineN(i, sql)` for per-node DB reads
  (`psqlSpine` stays = node 0 / `cello_spine`).
- DB naming: `count === 1` → `cello_spine` (unchanged); `count > 1` → `cello_spine_${i}`. So the new path
  can't touch the single-node DB the existing suite asserts against.

**SIs this must satisfy.** (1) 3 directory procs run REAL `dist/bin/directory.js` (binary-anchored, no
`createDirectoryNode`). (2) 3 distinct PeerIDs + 3 distinct health ports + 3 distinct DBs (no accidental
sharing). (3) Each DB independently migrated V1→V{N} (matches fresh-region). (4) Orphan-safe: if node k
fails to start, stop nodes 0..k-1 + relay + drop tmp (existing `abort` generalized to N). (5) The whole
M7 suite stays green (default path untouched).

**First red.** `j-tofn.spine.test.ts`: bring up `startSpineCluster({ directoryCount: 3 })`; assert
`directories.length === 3`, 3 distinct listen multiaddrs/PeerIDs, 3 distinct `directoryUrls`, and each
`cello_spine_${i}` reports `flyway_schema_history` present + a sane migration count. RED until the harness
spawns N; GREEN when it does. The T-of-N ceremony assertions come with DKG/SIGN.

### 2026-06-30 ~21:10 — DOD-SPINE-1 substrate GREEN (harness spawns 3 sovereign nodes)
**Delivered.** `startSpineCluster({ directoryCount })` now spawns N real `directory.js` binaries
(default 1 = unchanged M7 behavior). Each node is sovereign: own signing key + transport key (distinct
PeerID) + health/bootstrap port + listen port + OWN fresh-migrated Postgres DB (`cello_spine_${i}`).
New harness surface: `directories[]`, `directoryUrls[]`, `databaseUrls[]`, `psqlSpineN(i,sql)`,
`spineDbUrl()`, `ensurePostgres(dbNames[])`, `psqlDb(db,sql)`. Commit `a42ef342`.

**Proof (real binaries).** `j-tofn.spine.test.ts` GREEN (63.6s): 3 distinct directory PeerIDs, 3 distinct
bootstrap URLs, 3 DBs each migrated V1→V37. Floor: typecheck 0, eslint 0. Back-compat: `j-sig` (single-node;
exercises `restartDirectory`/`directory`-getter/`stop` — the exact refactored accessors) both tests GREEN.
Test-infra only — no directory/relay/daemon source touched, reachability gate untouched.

**Env fix (logged in DECISIONS).** Stopped stale worktree orphan `trustless-cello-m8-read001-postgres-1`
(Up 41h) that held `:5433`; canonical project postgres then bound it. Reversible.

**Status.** FED-SPINE-001 → 🔨 *substrate green* (NOT ✅ — its DoD line requires ALL journeys green:
2-of-3 DKG, seal-with-node-down, suspend-quorum, Option B, cross-node, refresh). Those assertions are
added red-first INSIDE their own units (DKG/SIGN/SUSPEND/…) and grow `j-tofn.spine.test.ts` one journey
at a time. The enforcer now EXISTS; everything downstream proves itself against it.

**Reviewers.** Dispatched (read-only, on `a42ef342`): `feature-dev:code-reviewer` (opus),
`cello-test-attacker`, `cello-fallback-finder`. Findings get fixed before this unit is considered closed.

**Next red.** DOD-MANIFEST-1 — client loads + verifies the FULL set of N directory nodes from a real
threshold-signed consortium manifest (replaces the single-endpoint resolver + placeholder one-node
manifest); rejects forged / under-threshold / rolled-back manifests.

### 2026-06-30 ~21:35 — DOD-SPINE-1 review round (3 read-only reviewers) — all findings fixed
Reviewers on `a42ef342` (all read-only; main loop is the only coder):
- **feature-dev:code-reviewer (opus) → BLOCKED→fixed:** orphan on mid-spawn failure — `new Proc()`
  spawns the child in its ctor but I pushed to `spawnedDirs` only AFTER `waitForLine`; a startup-hang
  timeout (child alive) would escape `abort()`. Fix: push BEFORE the await (`Proc.stop()` no-ops if
  already exited). Everything else (node independence, count=1 back-compat, relay→node0 scoping,
  restart/getter semantics) reviewed clean.
- **cello-test-attacker → HOLLOW→fixed:** the migration assert queried `cello_spine_${i}` by NAME, never
  proving proc i USES DB i (a harness pointing all procs at one DB passes). Replaced with a real DKG
  registration against EACH node's bootstrap URL + cross-DB isolation assert (agent i in DB i, absent
  elsewhere) — catches the `databaseUrls[0]`-for-all bug (a non-zero node's agent would land in DB 0)
  and proves each URL reaches a live, distinct node.
- **cello-fallback-finder → 1 MEDIUM landmine + 2 LOW, fixed; rest fail-loud (verified):** guard added
  (`directoryCount>1 && directoryNodeKeyHex` now throws — would silently give N nodes one identity);
  per-node `DEV_ENVELOPE_KEY` + per-node `audit-${i}.jsonl`. Finder verified DB provisioning, port
  alloc, env DB assignment, abort/stop all fail loud (no silent fallback).

Commit `f019790c`. `j-tofn` GREEN (2 tests, real binaries + 3 real DKGs, 89s). Back-compat `j-sig`
(restart + per-node envelope key) GREEN. typecheck 0, eslint 0. FED-SPINE-001 substrate solid; the
enforcer is trustworthy. Moving to DOD-MANIFEST-1.

**Pre-existing failure found + parked (not a regression).** Running `j-auth` for back-compat surfaced 2
failing tests (DOD-AUTH-2 poll-refresh + poll-rejects-forged) — `waitForLine` timeouts on the daemon's
manifest-POLL events. Proven pre-existing: the M7-baseline harness (live-harness.ts @ `059134d2`) fails
the SAME 2 identically. Out of SPINE-1 scope (manifest-poll auth-refresh ≠ MANIFEST-1 N-endpoint
resolution). Full record in DoD "Parked decisions". Revisit during/after DOD-MANIFEST-1.

### 2026-06-30 ~21:55 — DOD-MANIFEST-1 design note (§6) — manifest-driven N-endpoint resolution
**Target.** The client must RESOLVE the full set of N directory nodes from a verified, threshold-signed
consortium manifest — replacing the single-endpoint resolver (`directory-bootstrap.ts`) + the placeholder
one-node `consortium-manifest.json` — and REFUSE forged / under-threshold / rolled-back manifests. This
is the RESOLUTION layer; the DKG CEREMONY that fans out across those N endpoints is DOD-DKG-1.

**What already exists (verified by Explore map, two-repo):**
- Manifest type `ConsortiumNode {nodeId, pubkey, region, provider, endpoint}` + `ConsortiumManifest
  {version, not_before, expires, nodes[], signatures[]}` (`core/protocol-types/src/manifest.ts`).
- `verifyManifest(manifest, rootKeys, threshold)` — Ed25519, canonical-sorted body, ≥threshold unique
  officer sigs (`core/crypto/src/manifest.ts`). Anti-rollback (version≥lastSeen) + validity window in
  `daemon.ts:353-395`. **So forged / under-threshold / rolled-back rejection is ALREADY BUILT** — today
  it's used for AUTH (verify the one directory's step-6 identity), NOT for resolution.
- Consumers ALREADY take arrays: `registration-manager.ts:263 directoryNodes:[dirNode]`,
  `session-ceremony.ts:166 directoryNodeStubs=[stub]`; `NetworkDirectoryNode` holds
  `directoryMultiaddrs: string[]`. The single-element array is the only thing to widen — but that
  widening (feeding N into `runNetworkDkg`) is DOD-DKG-1, not here.

**The seam (smallest "resolve 1 → resolve N"), this unit:**
- *Seam A — resolver returns N.* New `getDirectoryEndpoints(): Promise<DirectoryEndpoint[]>` built from
  the verified manifest's node set, alongside the existing single `getDirectoryEndpoint` (kept for the
  primary signaling stream until DKG-1 consumes the set). `types.ts:203` gains the array resolver.
- *Seam B — manifest node → dial coordinate.* New `manifestNodesToEndpoints(nodes)`: for each node,
  derive its bootstrap HTTP base from `endpoint`, GET `{base}/bootstrap` → multiaddr, parse peerId
  (reuses `fetchBootstrapMultiaddr`/`parsePeerIdFromMultiaddr`). Returns N `{peerId, multiaddr}`.
- *Seam C (NOT this unit).* Consumers build N `NetworkDirectoryNode` from the N endpoints and pass to the
  ceremony — DOD-DKG-1.

**DECISION (reversible, logged in DECISIONS) — the `endpoint`→bootstrap convention.** Manifest `endpoint`
is documented as a `wss://host:port` libp2p hint, but the live resolution path is HTTP `{base}/bootstrap`
(CELLO_DIRECTORY_URL + PRODUCTION_DIRECTORY_URL are both `http://…`). `manifestNodesToEndpoints` will
treat `endpoint` as the node's HTTP base for `/bootstrap`: if `endpoint` starts `http`, use as-is; if
`wss://host[:port]`, map → `http://host[:port]`. The spine 3-node manifest sets each node's `endpoint =
http://127.0.0.1:{healthPort}` (the real bootstrap URL the harness already exposes as directoryUrls[i]).
Chosen over adding a separate `bootstrapUrl` field (API-parsimony: don't add a field when the existing
one carries exactly the node's reachable address) — but if production proves WSS-only with no HTTP
bootstrap, revert to a dedicated field. Reversible: schema + one mapping fn.

**Producer/consumer chain.** Producer of the N-node set = the verified manifest (file provider /
http-poll). Consumer (this unit) = `getDirectoryEndpoints` → logs the resolved set. Consumer (DKG-1) =
registration/session ceremony. The rejection producers (verifyManifest, anti-rollback) already exist;
this unit must ensure resolution REFUSES to run on an unverified/forged/under-threshold/rolled-back
manifest (no silent fallback to the single hardcoded endpoint — that would be a sovereignty-defeating
silent fallback, exactly the class fallback-finder guards).

**Harness work (e2e-tests).** auth-manifest.ts today exports ONE deterministic directory node keypair;
MANIFEST-1 needs N. Add per-node deterministic keypairs + a 3-node signed-manifest builder. Replace the
SPINE-1 guard (`directoryCount>1 && directoryNodeKeyHex` throws) with real PER-NODE node-identity keys
passed to each directory (`CELLO_DIRECTORY_NODE_KEY_HEX` per node, distinct NODE_ID per node). Build the
3-node manifest AFTER spawn (each node's `endpoint = directoryUrls[i]`), sign it, hand it to the daemon
(`CELLO_CONSORTIUM_MANIFEST`).

**Spine red (J-TOFN, grows).** Daemon configured with the 3-node signed manifest → assert it RESOLVES 3
directory endpoints (logs the resolved set / 3 distinct peerIds matching the 3 directories), reaching
each node's real `/bootstrap`. Plus focused rejection asserts: a forged / under-threshold / version-
rolled-back manifest → daemon refuses to resolve (no fallback to the single hardcoded endpoint). RED
until `getDirectoryEndpoints` + `manifestNodesToEndpoints` exist and the daemon binary is rebuilt.

**Cross-repo note.** Changes land in cello-client (`core/daemon`: directory-bootstrap.ts, types.ts,
manifest wiring). Local iteration rebuilds `core/daemon/dist` (the spine BINS.daemon) — NO publish needed
until DOD-DEPLOY-1. Version bump + publish + trustless-cello package.json update happen at the deploy gate.

### 2026-06-30 ~22:15 — DOD-MANIFEST-1 increments 1+2 done (cello-client, committed)
**Increment 1 — resolver layer (cello-client commit `46cd9e8`).** `directory-bootstrap.ts`:
`mapEndpointToBootstrapBase(endpoint)` (wss→http base) + `manifestNodesToEndpoints(nodes, {fetchFn,logger})`
→ `ConsortiumEndpoint[] {nodeId,pubkey,peerId,multiaddr}`, probing each node's `/bootstrap` in parallel,
AVAILABILITY-AWARE (down node skipped, never a silent single-endpoint substitution). 22/22
directory-bootstrap focused tests GREEN (15 existing + 7 new). typecheck 0, eslint 0.

**Increment 2 — daemon wiring (cello-client commit `1b1a761`).** `daemon.ts startDaemon`: on a VERIFIED
manifest, resolves the full node set + logs `directory.consortium.resolved {declaredNodes, resolvedNodes,
peerIds}`. This is the roster DKG-1 fans out to. Daemon `dist` rebuilt (confirmed via grep). typecheck 0.

**Resume pointer — DOD-MANIFEST-1 increment 3 (the spine proof + harness).** NEXT: extend the SPINE
harness to prove the resolve end-to-end against 3 real binaries.
- `packages/e2e-tests/src/spine/auth-manifest.ts` exports ONE deterministic node keypair
  (`DIRECTORY_NODE_PRIVATE/PUBLIC_KEY_HEX`). ADD **N deterministic node keypairs** (an array/helper, e.g.
  `nodeKeypair(i)`), keeping the existing single export for j-auth back-compat.
- `live-harness.ts`: give each spine directory its OWN `CELLO_DIRECTORY_NODE_KEY_HEX` + distinct `NODE_ID`
  (replace the SPINE-1 guard `directoryCount>1 && directoryNodeKeyHex throws` with real per-node keys —
  the guard was the placeholder for exactly this). Expose each node's node-pubkey + add a helper that
  builds a 3-node signed manifest post-spawn: `nodes[i] = {nodeId_i, pubkey=nodeKeyPub_i, endpoint =
  directoryUrls[i]}` (endpoint = the http bootstrap base, per the DECISIONS convention), signed via
  `makeSignedManifest`. NOTE: configuring the daemon with a manifest turns step-6 ON for the PRIMARY
  signaling connect, so node 0's manifest pubkey MUST equal node 0's node key (else primary connect fails
  step-6) — give all 3 matching per-node keys.
- `j-tofn.spine.test.ts`: new `it()` — start a daemon configured with the 3-node manifest
  (`writeConsortiumManifest` / `manifestEnv` → `startDaemon`), assert it logs `directory.consortium.resolved`
  with `resolvedNodes:3` and the 3 `peerIds` matching the 3 directories' PeerIDs. (The resolve log fires at
  startup right after manifest-verify, BEFORE the primary connect — so it's observable even before any
  ceremony.) Then rejection asserts can reuse j-auth's forged/expired patterns if useful (rejection is
  already covered by the load block + existing j-auth non-poll tests).
- REBUILD already done for the daemon; after harness edits run `j-tofn` (spine), green → 3 reviewers →
  fix → commit. Then DKG-1 threads `consortiumEndpoints` into the ceremony (registration-manager /
  session-ceremony directoryNodes[]).

**Pre-existing j-auth poll failure** still parked (DoD Parked decisions) — revisit during MANIFEST-1 close
or after.

### 2026-06-30 ~22:35 — DOD-DKG-1 prep (read-only, while MANIFEST-1 reviewers run)
Confirmed the DKG ceremony crypto is ALREADY T-of-N capable — DKG-1 is wiring, not new crypto:
- `runNetworkDkg(agentPubkey, {threshold, participants, directoryNodes: NetworkDirectoryNode[], preAuthToken})`
  (`network-directory-node.ts:567+`) fans **round1/round2/round3 across ALL `directoryNodes` via
  `Promise.all`**; `signers = {min: threshold, max: participants+1}` (client always +1). Round-2 already
  routes each node's `othersRound1 = allRound1.filter(j => j !== i+1)` (everyone except itself) — the
  per-node share relay the DoD calls "relays round-2 targetIdentifier shares" is IN PLACE.
- The ONLY limiter is the CALLER: `registration-manager.ts:263` passes `directoryNodes: [dirNode]`
  (single, built from `this.#ctx.getDirectoryEndpoint()`), and `session-ceremony.ts:166`
  `directoryNodeStubs=[stub]`. DKG-1 seam: thread the MANIFEST-1 `consortiumEndpoints` (resolved at
  startup in daemon.ts) into the registration/session ctx, build N `NetworkDirectoryNode` from them, pass
  `directoryNodes: [n0,n1,n2]` with `participants:N` + the chosen threshold.
- The directory SIDE (trustless-cello `directory-node.ts:2309-2310 participants:1, threshold:2`) must
  accept being ONE of N (it already runs round1/2/3 per the stream protocol; verify it doesn't assume
  participants:1). That's DKG-1's directory-side check.
- OPEN for DKG-1 design: the exact T-of-N numbers ("2-of-3": 3 directory nodes + client = 4 participants;
  threshold T such that any T co-sign and 1 node down still completes) + how `consortiumEndpoints` reaches
  the ctx (a new ctx field / setter). Write the DKG-1 design note (§6) before coding, after MANIFEST-1
  reviewers clear.

### 2026-06-30 ~23:05 — DOD-MANIFEST-1 ✅ CLOSED (reviewer-clean, spine-proven)
**3 reviewers (read-only, on the cross-repo diff):** code-reviewer **APPROVED**; test-attacker **TESTS
HAVE TEETH** (all 4 bypasses caught — manifest is load-bearing); fallback-finder found real items (none
clean-HIGH as scoped). **All findings fixed** (cello-client `4b72cfb`, trustless-cello `a971fd62`):
- Endpoint contract pinned http(s)-ONLY (`mapEndpointToBootstrapBase`→null otherwise); a non-http endpoint
  in SIGNED data → distinct `directory.consortium.node.endpoint_invalid` (ERROR), not a silent transient
  skip; no wss-port guessing. (code-reviewer MED + fallback #2)
- Severity-graded roster log: `directory.consortium.none` (ERROR) / `.partial` (WARN) / `.resolved`
  (info) — degraded ≠ healthy. (fallback #1)
- Pairwise nodeId↔peerId binding logged + asserted on the spine. (test-attacker note 1)
- Harness: reject both-keys-set; per-element 64-hex validation. (code-reviewer LOW + fallback #3)
- Added forged-3-node-manifest **refusal** spine test (`7ce93bc3`) — rejection half of the DoD line.

**Proof:** j-tofn **4/4 GREEN** (real binaries: 3 sovereign nodes; sovereign DB isolation via 3 real DKGs;
full 3-node roster resolved w/ pairwise binding; forged manifest refused). Daemon focused 24/24. Floor:
typecheck 0, eslint 0 (both repos); back-compat j-sig 2/2, j-spine 7/7, j-auth 4/6 (2 pre-existing poll
failures unchanged). cello-client commits: `46cd9e8`,`1b1a761`,`4b72cfb`. trustless-cello: `228be9e6`,
`a971fd62`,`7ce93bc3` (+docs).

**⚠️ HANDOFF TO DOD-DKG-1 (load-bearing — fallback-finder #1):** the resolved roster
(`consortiumEndpoints` in daemon.ts) is currently **logged + reserved, NOT consumed** — the daemon's real
ceremonies still use the single `getDirectoryEndpoint`. DKG-1 MUST (a) thread `consortiumEndpoints` into
the registration/session ctx + fan `runNetworkDkg` across all N (seam: `registration-manager.ts:263`
`directoryNodes:[dirNode]` → N nodes; `runNetworkDkg` is already N-capable), AND (b) add the
**threshold-REFUSAL gate** — refuse to run a ceremony when fewer than T of N resolve (else a degraded
consortium silently runs on too few nodes). Without (b), fallback-finder #1 escalates to HIGH. The
directory side (`directory-node.ts:2309 participants:1,threshold:2`) must accept being one of N.

**Resume pointer → DOD-DKG-1.** Next unit. Write the DKG-1 design note (§6) first — see the
"2026-06-30 ~22:35 DOD-DKG-1 prep" entry above for the verified seam. Then red-first on j-tofn
(2-of-3 DKG against 3 real directories; kill a node → still completes). cello-client daemon source +
directory source both change; rebuild daemon dist + (directory is trustless-cello — the spine runs its
built bin, rebuild `packages/directory/dist`). NO publish until DOD-DEPLOY-1.

### 2026-06-30 ~23:25 — DOD-DKG-1 design note (§6) — multi-node DKG (client fans to N, T-of-N)
**Target.** Registration runs a real interactive FROST DKG across the CLIENT + all N consortium
directory nodes (resolved from the manifest in MANIFEST-1), producing ONE group key where each node holds
its OWN K_server share. 2-of-3 (2 of 3 directory nodes + the always-present client) completes; kill any
ONE directory node and DKG/sign still completes (DOD-INV-NODE).

**Verified seam (both sides read):**
- CLIENT — `registration-manager.ts:263` passes `directoryNodes:[dirNode]` (single, from the single
  `getDirectoryEndpoint()`) into `runNetworkDkg`. `runNetworkDkg` (`network-directory-node.ts:567+`) is
  ALREADY N-capable: fans round1/2/3 across all `directoryNodes` via `Promise.all`, routes each node's
  round-2 `othersRound1 = allRound1.filter(j => j !== i+1)`, `max = participants+1` (client). Only client
  change: build N `NetworkDirectoryNode` from `consortiumEndpoints` + pass `participants:N`.
- DIRECTORY — `directory-node.ts:2306` sends `dkg_ready {participants:1, threshold:2}` (the 2-of-2
  hardcode); each node runs its own round1/2/3 on `/cello/frost/1.0.0` and verifies the client's
  primary_pubkey vs its `#pendingDkgCommitments` — BUT line 2348 ALREADY handles "no stored commitment
  (client did DKG with a different node) → accept (multi-node DKG)". Per-node DKG participation already
  works; the hardcoded `participants:1/threshold:2` is the limiter.

**DECISION 1 — topology from the SIGNED MANIFEST, not either party unilaterally (reversible).** Both
client and directory derive N from the threshold-signed manifest they each load+verify (MANIFEST-1).
Neither dictates N — a malicious client can't shrink the quorum, a malicious node can't inflate it. The
directory's `dkg_ready` N/T become DERIVED from its verified manifest (N = node count); the client
cross-checks against its OWN verified manifest; mismatch → abort.

**DECISION 2 — threshold formula (the one genuine fork; RECOMMENDATION, reversible).** FROST participants
= N_dirs + 1 (client always present). Threshold T:
- N_dirs = 1 (single-node back-compat): T = 2 (= max) — current 2-of-2, both mandatory. Unchanged.
- N_dirs ≥ 2: **T = N_dirs** (= max − 1) → client + any (N_dirs−1) directory nodes; tolerates exactly ONE
  directory outage; no single directory node mandatory. N_dirs=3 → T=3 of max=4 (the DoD's "2-of-3").
Rationale: DOD-INV-NODE requires "kill any one of N and the ceremony still completes" — T=max−1 is the
tightest threshold meeting that (maximizes forge-resistance floor while tolerating 1 outage). Lower T
tolerates more outages but lets fewer nodes forge (weaker). **If Andre wants higher outage tolerance for
large N, this is the line to change.** T is DERIVED in a shared helper (client+directory), NOT a manifest
field yet (add a signed `signingThreshold` field only when a real deploy needs a configurable T).

**DECISION 3 — threshold-REFUSAL gate (fallback-finder #1 escalation — MUST land here).** Before the
ceremony, if fewer than T of N directory endpoints resolved (MANIFEST-1's availability-aware roster),
REFUSE with a distinct error (`dkg_below_threshold`; directory already has `directory_below_threshold`)
rather than silently running on too few nodes. Closes the silent fallback flagged HIGH-if-skipped.

**consortiumEndpoints threading.** daemon.ts resolves it at startup (MANIFEST-1, logged only). DKG-1
stashes it on the registration/session ctx (new ctx field + setter, set in startDaemon post-resolve) so
`registration-manager` builds the N `NetworkDirectoryNode`. Re-resolve at ceremony time too (fresh
failover coordinates); the startup resolve becomes validation+warming.

**Spine red (J-TOFN grows).** 2-of-3 DKG: register with a 3-node manifest → assert the ceremony fans to
all 3 (each persists its OWN K_server share — query each `cello_spine_${i}`) + ONE group key. Kill 1
directory → register another → still completes (T-of-N). Below-threshold: only 1 of 3 resolves →
`dkg_below_threshold`. (DOD-SIGN-1/SUSPEND-1 add session-sign + quorum.)

**Cross-repo + build.** Client: `registration-manager.ts`, `session-ceremony.ts`, ctx, T-helper
(cello-client). Directory: `directory-node.ts` dkg_ready derivation + below-threshold (trustless-cello).
Rebuild BOTH dist bins (cello-client `core/daemon/dist`, trustless-cello `packages/directory/dist`). NO
publish/deploy until DOD-DEPLOY-1. Red-first on j-tofn before coding.

**RESUME POINTER (current — DOD-DKG-1 design DONE + falsify-first done; next = IMPLEMENT).** Don't
re-design — the §6 note above + M8B-DECISIONS Forks A/B/C are settled. Falsify-first findings (cello-client):
- `RegistrationContext` (registration-manager.ts:39) exposes singular `getDirectoryEndpoint()`; ADD
  `getConsortiumEndpoints()` (returns the resolved `ConsortiumEndpoint[]` roster, re-resolved from the
  manifest provider for fresh failover coords, empty → single-node fallback to `[getDirectoryEndpoint()]`).
- ctx is built at MULTIPLE daemon.ts sites: ~604 (keystone), ~629/639 (per-agent), ~706/715, ~1587. All
  must supply the new getter. `consortiumEndpoints` resolved at startup (daemon.ts MANIFEST-1 block) needs
  to be reachable there — either stash on a daemon-scoped ref the getters close over, or have the getter
  re-call `manifestNodesToEndpoints(manifestProvider.getCurrentManifest().nodes, …)`.
- registration-manager.ts:263 `directoryNodes:[dirNode]` → map the roster to N `NetworkDirectoryNode`;
  `participants:N`; threshold via the shared T-helper (Fork B: N_dirs≥2 → T=N_dirs). Add the Fork-C
  below-threshold refusal BEFORE `runNetworkDkg` (resolved < T → `dkg_below_threshold`). Same for
  session-ceremony.ts:166.
- Directory (trustless-cello directory-node.ts:2306): derive `dkg_ready {participants:N, threshold:T}`
  from ITS verified manifest (Fork A) instead of the 1/2 hardcode; keep the line-2348 multi-node-accept.
- Build a shared T-helper used by BOTH repos (or duplicate the tiny formula — it's `N_dirs===1?2:N_dirs`).
- Red-first on j-tofn: 2-of-3 DKG fans to 3 dirs (each `cello_spine_${i}` holds its OWN K_server share) +
  ONE group key; kill 1 dir → still completes; only-1-resolves → `dkg_below_threshold`. Rebuild BOTH dist
  bins. Then 3 reviewers. NOTE: the J-TOFN sovereign-isolation test already registers per-node — that
  registration currently uses the SINGLE-node path; once DKG-1 lands it becomes a real multi-node DKG, so
  re-verify that test still holds (it may need the 3-node manifest configured on its daemons too).

### 2026-07-01 ~01:30 — DOD-DKG-1 IMPLEMENTED + spine-proven (reviewers running)
**What landed.** Multi-node FROST DKG fans key-generation across the client + ALL N consortium directory
nodes. Client (cello-client `358f1f2`,`8b520c2`): `RegistrationContext.getConsortiumEndpoints()` (the resolved
roster); `register()` re-resolves it from the verified manifest at ceremony time; registration-manager builds
N `NetworkDirectoryNode` (else single primary endpoint, back-compat) + the **dkg_below_threshold gate**
(resolved roster ≠ directory's declared N ⇒ refuse, since DKG needs all N). Directory (trustless-cello
`35130846`): `dkg_ready` derives `{participants:N, threshold:T}` from ITS OWN `#directoryManifestStore`
(topology consensus); no/1-node manifest → 2-of-2 (back-compat). Harness (`a804af8f`): pre-allocate health
ports + `onDirectoryUrlsReady` hook (a consortium directory reads its manifest at startup, so it's written
with real URLs BEFORE spawn). `runNetworkDkg` was already N-capable — this is the caller + directory wiring.

**Proof.** `j-tofn-dkg.spine.test.ts` GREEN (real binaries): 3-node consortium → real DKG; primary advertises
"3 directory nodes, threshold 3"; ALL 3 directories log "Round 1 commit"; one group key. The below-threshold
gate → deterministic in-process unit test (the spine version was flaky under multi-daemon contention).
Back-compat: j-tofn 4/4, j-spine 7/7, 8/8 registration-manager units. tsc 0, eslint 0.

**The detour (recorded so it's not repeated).** The multi-node DKG worked from the FIRST run, but an async
stdout-capture lag in the test (harness pipes directory stdout; it lags the IPC response) made it look
single-node for ~6 diagnostic iterations — resolved by a 2s settle delay before reading directory logs +
checking DB state. Lesson: when a spine test inspects a child proc's logs right after an IPC call, the logs
may not have flushed; settle or poll first.

**Reviewers (read-only, running).** code-reviewer (opus) + test-attacker + fallback-finder on the cross-repo
diff. ANTICIPATED finding to fix: a silent downgrade — if a manifest IS configured but the roster resolves
EMPTY (all nodes unreachable) the client currently falls back to single-node DKG (and the directory's `?? 1`
does the same if getCurrentManifest is null mid-run). Plan: refuse rather than silently downgrade a
consortium to 2-of-2.

### 2026-07-01 ~02:10 — DOD-DKG-1 ✅ CLOSED (reviewer-clean)
**3 reviewers (read-only, cross-repo diff):** test-attacker **TESTS HAVE TEETH** (the per-directory "Round 1
commit" assertion is per-OS-process, single emission site, real participation required; no cluster-reuse
pollution; gate proves short-circuit-before-runNetworkDkg). code-reviewer **BLOCKED on B1**;
fallback-finder **HIGH (= B1)** + MEDIUM. Everything else verified CORRECT by all three (gate `!==` both
directions, directory dkg_ready derivation + FileDirectoryManifestStore no-throw last-good, threshold
formula no off-by-one, multi-node build, harness back-compat).
- **B1 (BLOCKING) FIXED (cello-client `448e1c9`):** empty roster + manifest configured was silently
  downgrading T-of-N → 2-of-2. `getConsortiumEndpoints()` now returns `ConsortiumEndpoint[] | null` (null =
  no manifest → single-node; array = consortium configured); registration-manager branches on `roster !==
  null`, so an empty roster hits the gate (0 ≠ N) → `dkg_below_threshold`. Unit tests: <N, =[] , >N all
  refuse; null → single-node (dkg_failed on stub, past the gate). 19/19 daemon units; j-tofn-dkg + j-spine
  7/7 GREEN; back-compat held.
- **MEDIUM (count-only gate, identity skew) PARKED** — needs a `manifestVersion` field in the `dkg_ready`
  protocol frame (cross-repo, deliberate). Narrow exposure (both root-key-verified; valid T-of-N over the
  client's verified nodes). Full writeup in DoD "Parked decisions"; code carries a `// NOTE (MEDIUM, parked)`.
- LOW (non-blocking): L1 harness port TOCTOU window (acceptable, localhost); L2 directory accept-primary-
  pubkey-as-is when not in roster (out of scope — follow-up for any-directory signaling, DOD-OPTIONB).

**DOD-DKG-1 ✅.** The DKG is genuinely T-of-N — the milestone's 2-of-2 stopgap is GONE for key generation.
cello-client commits: `358f1f2`,`8b520c2`,`448e1c9`. trustless-cello: `35130846`,`a804af8f` (+docs).

**Resume pointer → DOD-SIGN-1.** Next unit: "T-of-N session signing + seal: client coordinates with any T
of N; one node down ⇒ still signs (exclusion/retry). The single-key fallback (`directory-node.ts:3964`) is
removed/guarded — FROST whenever DKG exists." Seam (analogous to DKG-1): `session-ceremony.ts:166`
`directoryNodeStubs=[stub]` (single) → build N stubs from the consortium roster (thread `getConsortiumEndpoints`
into the session ctx as DKG-1 did for registration). The signer (`FrostThresholdSigner`) already takes
`directoryNodeStubs[]`. THIS is where "kill a node, still signs" gets proven (the T-of-N tolerance the
DKG-1 reviewers correctly said belongs here). Also: the J-TOFN-DKG happy test could be extended to SIGN a
session with a node down. Write the §6 design note first; the threshold T (=N) is already decided (Fork B).
