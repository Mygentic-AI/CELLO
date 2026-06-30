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
| FED-SIGN-001 | DOD-SIGN-1 | client+dir | ✅ spine-proven | T-of-N seal: ≥2 dirs FROST-sign, kill-a-participant still seals, FROST-not-single-key (j-sign teeth); 3 reviewers clean (B1 fixed: session-signing store reconstruction); restart-path + REFRESH cache parked |
| FED-SUSPEND-001 | DOD-SUSPEND-1 | dir+crypto | ✅ spine-green, 3 reviewers clean | j-suspend-tofn green (103s): 2-suspended ⇒ block w/ EXACT `ceremony_exhausted`+retry; 1-suspended ⇒ nodes 0,2 sign while node 1 emits FRESH refusal (route-AROUND proven); agent B signs through 1,2 ⇒ agent-scoped. Fixes: signer commit-round per-stub exclusion + per-node timeout/deadline (bcea30a/5cd2da2), directory nonce-replace (87d226c2, consume-once confirmed by all 3). Fallback HIGH made LOUD: frost.suspension.uncheckable + hasAgentProfile. Production quorum-binding → PRESENCE-1 (Tier C) |
| FED-REFRESH-001 | DOD-REFRESH-1 | client+dir+crypto | ✅ spine-GREEN, 6 reviewers clean | Zero-constant PSS, group key UNCHANGED. J-REFRESH spine GREEN: refresh twice → digest CHANGES (proves rotation, kills the no-op) + group pubkey==P1 + all dirs applied + post-refresh seals. crypto published 0.0.13; daemon runNetworkRefresh + runAgentRefresh + cello refresh CLI; directory refreshRound1/2 (durable persist before epoch advance) + getMaxEpoch (expiry survives restart, unit-tested). 6 reviewers (3 crypto SOUND + 3 wiring no-blocking); fixed digest-teeth/HIGH-1/HIGH-2/M2/L7 + stale SUSPEND-1 nonce tests. directory 661/661, daemon 453/453, crypto 254/254, back-compat green. PARKED: cross-party atomicity (2-phase commit) + forward-secrecy delete — alpha fail-loud+manual-re-refresh |
| FED-RELAYSIG-001 | DOD-RELAYSIG-1 | relay+client | ✅ spine-GREEN, 3 reviewers clean | Daemon PORT (relay-side ACK signing already live). relay-receipt-store.ts (verifyRelayAck + evaluateRelayAck + RelayReceiptStore, keyed on the attestation POSITION agent/session/seq, immutable) wired into session-relay-client #captureReceipt (verify→store; forged ACK rejected + rejects the submit) + cello receipts. J-RELAYSIG spine GREEN: A→B send → relay signs → daemon verifies + stores → cello receipts returns it AND the test re-verifies the Ed25519 signature. 3 reviewers: fixed position-key HIGH, verify-gates-store wiring test (blocking), loud silent-drops. daemon 458/458, 5 receipt units, back-compat j-sign green. Parked: registered-relay check → OPTIONB-SEAL; witnessed-bit. NO directory change (held for deploy unaffected) |
| FED-OPTIONB-SETUP-001 | DOD-OPTIONB-SETUP-1 | dir+relay+client | 🔨 investigation DONE, design decided (Design A), implementing | THE BUG: directory dials relay (recordAssignment dir-node.ts:3135) + relays[0]/#relay pin. Design A (journal §05:00): relay verifies the per-node relayDirSig vs ANY of N directory node pubkeys from the consortium manifest (no directory-consortium FROST key exists; frostedSig is the AGENT's session auth, relayDirSig is the directory's relay auth). 4 steps: relay manifest-verify (additive) → directory sends relay_directory_signature to client → client carries record_assignment + DELETE the dial → j-optionb-setup spine (zero dir→relay calls + non-node-0 directory works). NOT started coding |
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

### 2026-07-01 ~02:30 — DOD-SIGN-1 design note (§6) — T-of-N session signing + seal
**Target.** Session signing + seal use a real T-of-N FROST ceremony across the consortium: the client
coordinates with ANY T of N directory nodes; **kill one node ⇒ it still signs** (exclusion/retry). The
directory's M1 **single-key notarization fallback** is removed/guarded — FROST whenever a DKG group key
exists. This is where the "no single node mandatory" invariant gets its SIGNING proof (DKG-1 proved key
generation; the kill-a-node tolerance the DKG-1 reviewers deferred is proven HERE).

**Verified seam (both sides read):**
- CLIENT — `session-ceremony.ts:154-167` builds ONE `directoryNodeStubs=[stub]` from
  `deps.getDirectoryEndpoint()` (single), then `new FrostThresholdSigner({threshold, participants,
  directoryNodeStubs}, …)`. The signer ALREADY takes `directoryNodeStubs[]`, and `share.threshold/
  participants` come from the persisted FROST share — which after DKG-1 is N/T. So the client change
  mirrors DKG-1 EXACTLY: thread `getConsortiumEndpoints` into `CeremonyWiringDeps` (it has
  `getDirectoryEndpoint` at :96; add the roster getter), build N stubs (each `setBootstrapContext`),
  pass them all. The signer's `participateInCeremony` then coordinates T-of-N. The same null-vs-empty
  refusal discipline from DKG-1 B1 applies (manifest configured + empty roster ⇒ refuse, not single-stub).
- DIRECTORY — `directory-node.ts:3974`: the seal looks up `initiatorPrimaryPubkey =
  #primaryPubkeys.get(initiatorHex)`; if NULL → **M1 single-key notarization** (`#keyProvider.sign`),
  "rejected by M2 clients." The recurring CELLO bug (memory `[[project_relay_directory_any_to_any]]` +
  the seal-receipt investigation): `#primaryPubkeys` is a SEPARATE in-memory map NOT seeded from the
  persisted store (`agent_profiles.primary_pubkey`), so even after a real DKG the seal can fall to
  single-key. SIGN-1 directory work: (a) SEED `#primaryPubkeys` from the store (or read the store at
  seal time) so the FROST path is taken whenever a DKG group key exists; (b) GUARD the single-key
  fallback — when a DKG key exists it must NEVER single-key-sign (refuse / error), the fallback only for
  genuinely-no-DKG legacy/test envs (and even that is M2-rejected).

**DECISION (reversible) — keep the single-key fallback ONLY for the no-DKG path, guarded.** Don't delete
it outright (it serves pure-SESSION-003 test envs); instead guard: if a primary_pubkey EXISTS for the
initiator (DKG happened) the directory MUST FROST-seal — a null `#primaryPubkeys` lookup when the store
HAS the primary_pubkey is the bug to fix (seed it), not a legitimate fallback trigger. Log distinctly if
the fallback ever fires with a DKG present (should be impossible after the seeding fix).

**Spine red (J-TOFN-DKG grows, or a new J-SIGN).** After the 3-node DKG: open a session, send, and SEAL
→ assert the seal is a real T-of-N FROST signature (not single-key; the directory logs the FROST seal
ceremony, NOT `M1 single-key notarization`) + verifies against the group key. Then KILL one directory
node and seal again → still completes (T-of-N exclusion/retry). The kill-a-node spine assert is the
DOD-INV-NODE proof for signing.

**Cross-repo + build.** Client: `session-ceremony.ts` + `CeremonyWiringDeps` wiring in daemon.ts
(cello-client). Directory: `directory-node.ts` `#primaryPubkeys` seeding + the seal FROST/single-key
guard (trustless-cello). Rebuild BOTH dist bins. Falsify-first DONE (this note). Red-first on the spine
before coding. The threshold (T=N, Fork B) + topology-from-manifest (Fork A) are already decided.

### 2026-07-01 ~03:00 — DOD-SIGN-1 IMPLEMENTED both sides (spine proof + reviewers remain)
**Client (cello-client `33338f9`).** `CeremonyWiringDeps.getConsortiumEndpoints()` (async, manifest-
resolved at ceremony time, null=no-manifest); `reconstructThresholdSigner` builds ONE stub per
consortium node so the FrostThresholdSigner coordinates the signing/seal ceremony across all N (reaches
any T, excludes a down node). Null roster → single primary (back-compat). The share's threshold T is
FIXED, so a degraded roster makes signing FAIL — never forges a lower-threshold sig (single-stub fallback
safe). Shared `resolveConsortiumRoster` closure wired into all 4 wireSession/wireSeal sites. j-spine 7/7.
**Directory (trustless-cello `861c7aef`).** `#resolvePrimaryPubkey` helper — the seal/sign read sites
now fall back from the in-memory `#primaryPubkeys` cache to the persisted store
(`getProfile().primary_pubkey`) on a miss + re-seed. Fixes the recurring "unseeded in-memory map → seal
single-keys after restart / on a non-registration node" bug. M1 single-key fires ONLY with no profile.
j-spine DOD-SPINE-7 + j-loopback bilateral seal GREEN (FROST-notarized). Both dist bins rebuilt.

**RESUME POINTER — DOD-SIGN-1 remaining = the spine PROOF + reviewers (implementation is DONE + back-compat
green).** Write a T-of-N SEAL spine test (extend `j-tofn-dkg.spine.test.ts` or new `j-sign`): on the 3-node
consortium, register TWO agents (multi-node DKG each), `cello_initiate_session` A→B, send, both close →
SEAL. Assert: (1) the directory logs a real FROST seal ceremony across the consortium, NOT `M1 single-key
notarization` (grep the directory output for the FROST-seal path / absence of single-key); (2) byte-identical
sealed_root verifies against the group key; (3) KILL one directory node and seal another session → still
completes (T-of-N — the DOD-INV-NODE signing proof the DKG-1 reviewers deferred here). **LESSON FROM DKG-1
(critical):** the harness captures directory stdout via async pipe `data` events that LAG the IPC response —
`await sleep(2000)` (or poll) BEFORE reading directory logs, else a working multi-node ceremony looks
single-node. Then 3 reviewers (code-reviewer opus + test-attacker + fallback-finder) on the SIGN-1 diff
(`33338f9`,`861c7aef` + the spine test); fix findings; flip DOD-SIGN-1 → ✅. Both dist already rebuilt.
Two-agent-session-seal-on-consortium is heavy (like j-loopback on the 3-node cluster) — budget for it.

### 2026-07-01 ~04:30 — DOD-SIGN-1 ✅ CLOSED (reviewer-clean)
**3 reviewers (read-only, cross-repo).** test-attacker **HOLLOW** (my negative "no single-key" assert was
hollow — single-key path logs only generic "Sealed —"); code-reviewer **BLOCKED on B1**; fallback-finder
**no HIGH** (verified the impl is genuinely T-of-N — `participateInCeremony` fails `reachable<T-1` and
`aggregate` needs ≥T shares, so a degraded roster FAILS, never forges; client refuses single-key seals).
**All fixed** (cello-client `2b53cf0`, trustless-cello `75bfc98e`):
- **B1 (BLOCKING):** the seal got the `#resolvePrimaryPubkey` store-fallback but session-establishment
  signing (`#processSessionRequest`) hard-failed `frost_signer_not_configured` when `#thresholdSigners`
  was wiped (directory restart). Symmetric fix: reconstruct the `ClientDelegatedSigner` from the
  persisted group key on a cache miss. (The recurring "restart state loss disease.")
- **test-attacker F1/F2/F3 (blocking):** j-sign now asserts POSITIVELY — a directory logs "FROST seal
  ceremony" (F1, FROST-not-single-key); ≥2 distinct directories emit `frost_stream.sign_request` (F2,
  T-of-N participation — single-node/single-key touches one); and the kill targets a directory PROVEN to
  have participated, so the seal completing proves a survivor reached threshold (F3).
- **fallback-finder F1 (MEDIUM):** both single-key seal paths now WARN (`seal.single_key.anomaly`) when a
  profile EXISTS but yields no primary (split-brain anomaly) instead of a normal "Sealed".
- **fallback-finder F3 / code-reviewer note (LOW):** client warns on configured-but-empty roster +
  documented the intentional single-stub asymmetry with DKG-1.

**Proof.** j-sign GREEN (teeth). Back-compat: j-spine sign+seal, j-loopback, j-tofn-dkg, 32 daemon units.
tsc 0, eslint 0. **Parked (DoD):** the store-fallback RESTART path is fixed-in-code + back-compat-green +
correct-by-symmetry but not end-to-end spine-exercised (j-sign doesn't restart node 0); the
`#resolvePrimaryPubkey` cache-invalidation is DOD-REFRESH-1's job.

**DOD-SIGN-1 ✅.** Both DKG and signing/seal are now genuinely T-of-N — the 2-of-2 stopgap is GONE from
the entire core ceremony path. cello-client: `33338f9`,`2b53cf0`. trustless-cello: `861c7aef`,`c96f75e7`,`75bfc98e`.

**Resume pointer → DOD-SUSPEND-1.** Next: "Quorum-aware refusal: with ≥ N−T+1 nodes honoring a suspension
no signature forms; with fewer it still signs — proving threshold-refusal ≠ single-node-refusal." This is
DIRECTORY-side (trustless-cello). Seam: the directory already has `agent_suspensions` (j-suspend tests a
single-node suspend → `directory_below_threshold` per the file header). Falsify-first: find where a
suspended agent's K_server share is WITHHELD (the directory refuses to partial-sign for a paused agent —
file header `directory-node.ts:1072` "refuses its FROST share for a PAUSED agent, so no threshold forms").
For T-of-N: if ≥ N−T+1 directories honor the suspension, the ceremony can't reach T → no signature; if
fewer honor it, the remaining T still sign. The proof (DOD-SUSPEND-1) is the threshold arithmetic: suspend
on enough nodes ⇒ refuse; suspend on too few ⇒ still signs. Memory `[[project_threshold_t_of_n_not_2_of_2]]`:
suspend/burn = account-authorized replicated revocation flag every node honors, NOT "one node withholds".
Write the §6 design note first. The consortium topology (N, T) + the per-node DKG shares are already in place.

### 2026-07-01 ~04:50 — DOD-SUSPEND-1 design note (§6) — quorum-aware refusal (mechanism EXISTS; prove the arithmetic)
**Target.** Prove threshold-refusal ≠ single-node-refusal: with ≥ (enough) directories honoring a
suspension the ceremony can't reach T → NO signature; with fewer, the survivors still sign.

**Verified seam (falsify-first DONE).** The suspend mechanism is ALREADY built + T-of-N-by-design:
- `#isAgentPaused(agentPubkey)` (`directory-node.ts:1080`) reads the REPLICATED `agent_suspensions` via
  `#store.isAgentSuspended`, FAILS CLOSED (read error → refuse). Comment 1071-1078: "every node
  INDEPENDENTLY honors the replicated flag — NOT one mandatory node withholding; other healthy nodes
  still serve (availability)." Exactly the sovereign T-of-N model.
- TWO honor layers: (1) the INITIATOR gate — `#processSessionRequest` refuses `agent_suspended` if the
  initiator's OWN node sees it paused (`:1876-1894`; this is what j-suspend single-node proves); (2) the
  PER-NODE SHARE refusal — each directory's FROST round handler refuses its share for a paused agent
  (`:1198`, `:1237`). Layer (2) is the threshold arithmetic.
- **No implementation needed** — the mechanism is complete. DOD-SUSPEND-1 = the SPINE PROOF of layer (2).

**The threshold arithmetic (N=3, T=3 = client + any 2 of 3 directories).** To form a signature the client
needs 2 directory shares. To BLOCK: ≥ 2 of 3 directories must refuse (only ≤1 left ⇒ client+1 < T). To
still sign: ≤ 1 directory refuses (≥ 2 left). So: **suspend on 2 → block; suspend on 1 → still signs.**

**Key test trick.** The INITIATOR gate (layer 1) fires FIRST and is single-node (the initiator's node 0's
view). To exercise layer (2)'s ARITHMETIC, suspend on nodes 1 & 2 but NOT node 0 — node 0 doesn't gate, so
the ceremony PROCEEDS to FROST signing, where nodes 1,2 refuse their shares → client+node0 = 2 < T → the
assignment can't be signed → initiate fails (a below-threshold reason, NOT `agent_suspended`). Then
un-suspend node 2 (only node 1 suspended) → nodes 0,2 sign → T reached → initiate succeeds.

**Spine red (new j-suspend-tofn or extend).** 3-node consortium; register A (multi-node DKG) + target X.
Set `agent_suspensions(paused=true)` on cello_spine_1 AND cello_spine_2 (via psqlSpineN, keyed by A's
agent_id on EACH node's DB — the replicated flag, set per-node in the spine since there's no live
replication). A `cello_initiate_session(X)` → FAILS (can't reach T; reason ≠ agent_suspended since node 0
isn't paused). Then clear node 2's flag → initiate → SUCCEEDS. Proves 2-suspend-blocks, 1-suspend-doesn't.
Note: A's agent_id may differ per node DB (each ran its own registration?) — actually registration writes
agent_profiles only on the node that ran the reply (node 0); nodes 1,2 may NOT have A's profile/agent_id.
FALSIFY THIS during implementation: if nodes 1,2 lack A's agent_profiles row, `isAgentSuspended` keys on
agent_id which won't exist there → the suspend flag can't be set the same way. May need to key the
suspension by k_local_pubkey, or seed agent_profiles on all nodes, or the share-refusal keys on a
different identifier. CHECK how `#isAgentPaused(agentPubkey)` maps agentPubkey→suspension (it takes the
AGENT PUBKEY, not agent_id — so agent_suspensions may be keyed/joined via agent_profiles; verify the
per-node lookup works when only node 0 has the profile). This is the one real unknown — resolve it
red-first. NO directory code change expected unless this lookup gap surfaces.

### 2026-07-01 ~05:40 — DOD-SUSPEND-1 — block-half PROVEN; route-around gap FOUND (the real finding)
**Resolved the unknowns + built the proof.** `isAgentSuspended` JOINs agent_suspensions→agent_profiles
per node; only node 0 has A's profile after registration, so I added `copyAgentProfileBetweenNodes`
(cross-DB COPY excluding id+account_id) to SEED A's profile to nodes 1,2 — works (`COPY 1`). j-suspend-tofn
(`baf2cfa7`) GREEN for the BLOCK half: no-suspension ⇒ A signs; **suspend on 2 of 3 directories ⇒ NO
signature** (NOT agent_suspended — a real THRESHOLD block via the per-node `#isAgentPaused` share refusal,
suspending nodes 1,2 not node 0 so the single-node initiator gate doesn't pre-empt).

**THE FINDING (non-obvious, reshapes SUSPEND-1):** a SINGLE suspended directory ALSO blocks
(`ceremony_exhausted`), not just ≥2. Per the DoD a sub-threshold suspension (1 of 3, below N−T+1=2) MUST
still sign (the 2 healthy directories reach T) — "threshold-refusal ≠ single-node-refusal." So
DOD-SUSPEND-1 needs a CRYPTO-LAYER FIX in the FROST signer's route-around, NOT just a proof. Marked
`it.todo`; the suite stays green.

**Mechanism (for the fix).** The suspended directory sends `{frost_sign_response, ok:false,
reason:"AGENT_SUSPENDED"}` then closes the stream (`directory-node.ts:1239`). The signer
(`cello-client/core/crypto/src/frost/frost-threshold-signer.ts`) loops `for attempt < maxRetries`
(`:378`), EXCLUDES a stub that returns `null`/timeout (`:471`) or an invalid share (`:490`) into
`ceremonyExcluded`, and retries with a fresh set. It exhausts on 1-suspended instead of routing to {0,2}.

**RESUME POINTER — DOD-SUSPEND-1 route-around fix (diagnose THEN fix the signer).** Run j-suspend-tofn
with the `it.todo` un-skipped + capture the `[CLIENT-DEBUG]` stderr (the harness captures it — grep the
daemon/directory output for "FrostThresholdSigner"). Check, in order: (1) `#DEFAULT_MAX_RETRIES`
(`frost-threshold-signer.ts:279`) — is it ≥2? if 1, a single exclusion can't retry → bump it (cheap fix).
(2) Does `NetworkDirectoryNode.signRound` (`network-directory-node.ts:181`) return `null` on the
`{ok:false, reason:"AGENT_SUSPENDED"}` frame (→ excluded) or does it throw/return garbage that isn't
excluded? If the refusal isn't mapped to null/exclude, map it. (3) Does the per-attempt stub SELECTION
honor `ceremonyExcluded` (does it re-pick the excluded node 1)? (4) Does the COMMITMENT round
(generateCommitment) also get refused + excluded, or does it build a commitmentList including node 1 that
then can't sign? Likely fix: ensure a refusal (AGENT_SUSPENDED) is treated EXACTLY like a timeout (exclude
+ retry) at BOTH commitment and sign rounds, and maxRetries ≥ N (so it can exclude up to N−T+1 and still
retry). This is a cello-client/core/crypto change (rebuild + re-run j-suspend-tofn). The block-half is
already proven; the fix makes 1-suspended sign, closing "threshold ≠ single-node." Then 3 reviewers.

### 2026-07-01 ~01:40 — DOD-SUSPEND-1 ✅ — route-around fixed, 3 reviewers clean, spine green
**The route-around gap (above) is fixed and the unit is closed.** Root cause was diagnosed via
`[CLIENT-DEBUG]`: (a) the COMMIT round did NOT exclude a refusing stub (only the sign round did), so a
suspended node 1 stayed in `selected` every attempt; (b) the directory's `generateCommitment` rejected an
honest coordinator's retry with `NONCE_ALREADY_PENDING`, cascading the survivors. Two fixes:
- **client `bcea30a`** — commit round gathers PER-STUB (not Promise.all) and excludes a refusing/failing
  stub into `ceremonyExcluded`, mirroring the sign round, so a sub-threshold suspension routes to survivors.
- **directory `87d226c2`** — `generateCommitment` REPLACES a still-pending nonce on retry (the unconsumed
  nonce never signed, so dropping it is safe) instead of refusing.

**Reviewers (3, all clean).** code-reviewer **APPROVED**; test-attacker + fallback-finder both
independently traced the nonce-safety and confirmed **no reuse path** — `signRawMessage` deletes the
pending nonce (`frost-handler.ts:573`) BEFORE `signShare` (`:587`) with no `await` between, so consume is
atomic and a replaced nonce is provably never signed. Findings fixed this round:
- **F1 (blocking)** — the block assertion was `not.toBe("agent_suspended")` (accepts ~18 transient
  reasons, no retry). Now asserts the EXACT `ceremony_exhausted` (client-side `DIRECTORY_BELOW_THRESHOLD`
  → delegated null signature → directory `CEREMONY_EXHAUSTED` → wire `ceremony_exhausted`) + retry-wrapped
  on `standing_receiver_unavailable` to close the retry asymmetry.
- **F2 (blocking)** — no positive control that node 1 actually REFUSED during the route-around. Now
  asserts node 1's own DB shows A suspended AND a FRESH `frost.ceremony.refused.revoked` for A fires during
  the signs ceremony (windowed `Proc.countLines` delta + 2s capture-lag settle). Proves survivors routed
  AROUND a genuinely-refusing node, not that node 1 was never selected.
- **F3 (high)** — refusal not proven agent-scoped. Now a second agent B (created via `cello create-agent`
  — `cello_create_agent` is NOT on the MCP surface; `provisionAgent` writes a pre-daemon key the live
  daemon never rescans), seeded to nodes 1,2 and not suspended, STILL signs through those same nodes while
  A is suspended there ⇒ refusal scoped to A, not the node going dark (sovereign-node redundancy invariant).
- **fallback HIGH** — single-node profile replication makes `isAgentSuspended` JOIN to zero rows ⇒ sign
  blind. Made LOUD: `DirectoryStore.hasAgentProfile` + a `frost.suspension.uncheckable` warn whenever a
  node participates in a ceremony for an agent it cannot check. Observability-only (never a gate; the
  fail-CLOSED read remains the control). Production quorum-binding still needs PRESENCE-1 replication —
  now alarmable, not silent.
- **code-reviewer IMPORTANT** — the new commit round had no per-node timeout/deadline (the sign round
  has both); a hung directory would stall the ceremony forever (availability-invariant violation). Now
  mirrors the sign round: deadline check + `Promise.race` per-node timeout, treat timeout as a refusal
  (`5cd2da2`). Also dropped 36 `[CLIENT-DEBUG]` raw-stderr lines (M4+ logger-rule).

**Gates green:** crypto frost units 23/23; j-suspend-tofn 103s green; back-compat j-sign (T-of-N +
node-down) + j-tofn-dkg (2-of-3 DKG) green. Held at +N unpushed on both repos (directory changes batched
for the DOD-DEPLOY-1 gate; cello-client crypto/daemon dist rebuilt locally for the spine).

**RESUME POINTER → DOD-REFRESH-1.** Next unit: "Proactive share refresh / resharing + real epoch
rollover: a refresh rotates all shares to a new epoch, old shares no longer sign, group pubkey unchanged;
a node compromised in epoch e holds nothing usable in e+1." This is client+dir+crypto. NOTE two parked
items REFRESH-1 must resolve (Parked decisions in the DoD): (1) `#resolvePrimaryPubkey` cache keys on the
agent at fixed `:epoch:1` and never invalidates — after a rollover it will serve a STALE group key (fails
LOUD via seal-verify reject, but must invalidate on rotation); (2) the FROST epoch identifier is currently
pinned (`cacheKey = agent:epochId`) — a real rollover must advance it. Write the REFRESH-1 design note
(§6) first, falsify-first, then red on the spine (j-refresh: register → refresh → old-epoch share rejected,
new-epoch signs, group pubkey byte-identical). The crypto file `frost-threshold-signer.ts` + directory
`frost-handler.ts` (both just touched here) are the surface; the nonce/epoch machinery is fresh in context.

### 2026-07-01 ~02:10 — DOD-REFRESH-1 design note (§6) — proactive share resharing (PSS), group key UNCHANGED
**Investigation done (Explore map + key-rotation-design.md + @noble API).** The design is settled — NO
fork to park; this is the standard zero-constant-term proactive secret sharing (Herzberg et al. 1995),
the mechanism `2026-04-15_1100_key-rotation-design.md` already chose (lines 60-64: "remaining t-of-n nodes
collectively regenerate shares without ever assembling K_server_X … periodic refresh invalidates leaked
shares"). DOD-REFRESH-1 is the PERIODIC-refresh case: rotate ALL shares to epoch e+1, old shares dead,
**group pubkey byte-identical**.

**Why PSS and not re-DKG.** Plain `ed25519_FROST.DKG.round1` picks a RANDOM constant term → a fresh DKG
produces a DIFFERENT group key (commitments[0]). The DoD requires the group key UNCHANGED, so re-DKG is
out. Trusted-dealer resharing is out (reconstructs the secret at one party = sovereign-node violation).
PSS is the only construction that satisfies all three: same group key, no party ever holds the joint
secret, old shares die.

**The math (each party = client + each directory node, T-of-N over the joint FROST key f, f(0)=joint
secret, party i holds s_i=f(i)):**
1. Each party i generates a degree-(T-1) polynomial δ_i with **constant term ZERO**:
   `ed25519_FROST.utils.generateSecretPolynomial(signers, secret=0n, …)` → coeffs + VSS commitments C_i.
   C_i[0] = 0·G = the curve IDENTITY — this is the cryptographic PROOF the refresh does not shift the secret.
2. Each party i evaluates δ_i at every participant identifier j (`δ_i(j) = Σ_k coeffs[k]·j^k mod L` via
   `utils.Fn`) and sends the sub-share δ_i(j) to party j (plus broadcasts C_i).
3. Each party j VERIFIES every received sub-share against the sender's commitments (VSS: δ_i(j)·G ==
   Σ_k j^k·C_i[k]) AND asserts **C_i[0] == identity** (rejects any party trying to shift the secret), then
   computes its new share `s'_j = s_j + Σ_i δ_i(j) mod L`.
4. New polynomial f' = f + Σ_i δ_i has f'(0) = f(0) + Σ 0 = joint secret ⇒ **commitments[0] (group key)
   UNCHANGED**; the individual shares are fresh, so an attacker holding epoch-e s_i cannot combine it with
   epoch-(e+1) shares s'_j to sign (the polynomials are inconsistent).

**@noble/curves@2.2.0 primitives (real, no shortcut — cite in code):** `utils.generateSecretPolynomial`
(zero-constant δ), `utils.Fn` (field mul/add mod L for evaluation), `validateSecret`/VSS Appendix C.2 for
the sub-share check, `combineSecret` (TEST-ONLY: assert the joint secret is identical pre/post refresh),
`DKG.round1/2/3` structure is the wiring template (orchestration mirrors `runNetworkDkg`).

**Surfaces to build (4 layers):**
- **crypto** (`core/crypto/src/frost/`): a NEW `frost-resharing.ts` — `generateRefreshContribution(signers,
  myId, allIds)` → {subSharesById, commitments}; `verifyRefreshContribution(commitments, signers)` (assert
  C[0]==identity + degree); `applyRefresh(oldSecret, receivedSubShares, allCommitments, signers)` →
  newSecret. Pure, deterministic-testable with `combineSecret`. RED-FIRST HERE (no Docker, fast).
- **daemon** (`core/daemon/src/network-directory-node.ts`): `runNetworkRefresh(agentPubkey, fromEpoch)` —
  mirrors `runNetworkDkg`'s 3-round fan-out (broadcast C_i + route sub-shares + apply), advances client
  `_localShares` + persists via db-identity-store, sets node bootstrap context to epoch e+1.
- **directory** (`packages/directory/src/frost-handler.ts` + `directory-node.ts`): refresh frame handlers
  (mirror dkgRound{1,2,3}); on apply, `storeShare(agent, :epoch:(N+1))`, `#currentEpoch.set(agent, N+1)`,
  persist the new encrypted share (`agent_key_shares`, new epoch_id row), and — NEW — **persist
  #currentEpoch** (today in-memory only) so a restart doesn't forget the rollover and re-accept epoch N.
- **cache invalidation (DoD parked, MANDATORY here):** `#resolvePrimaryPubkey` keys on agent at fixed
  `:epoch:1` and never invalidates. The group key is UNCHANGED by PSS so the cached value stays correct —
  BUT the epoch advance must invalidate/re-seed any epoch-keyed state. Confirm: group pubkey cache is
  safe (same bytes); the EPOCH itself is what advances. Audit `#primaryPubkeys` + the client seal cache for
  any epoch assumption and invalidate on rollover.

**J-REFRESH (the spine proof, red-first on the 3-dir spine):** register A (multi-node DKG, epoch 1) →
capture group pubkey P1 → run refresh → (a) group pubkey P2 == P1 byte-identical; (b) a sign/seal with A
SUCCEEDS post-refresh (new epoch-2 shares sign); (c) a sign attempt pinned to epoch 1 returns
`EPOCH_EXPIRED` (old shares dead); (d) — the compromise-recovery teeth — an OLD epoch-1 share combined
with NEW epoch-2 shares CANNOT produce a valid signature (a node compromised in e holds nothing usable in
e+1). Falsify-first: assert the refresh is not a no-op (epoch-1 shares must actually stop working) and not
a re-DKG (P2 must equal P1, not just "some valid key").

**FALSIFICATION (before any code):** (1) Does `generateSecretPolynomial` accept `secret=0n` and return a
commitment whose [0] is the identity? VERIFY empirically in the red test first — if it rejects a zero
secret, evaluate the contribution polynomials with an explicit zero constant via `utils.Fn` directly.
(2) Are participant identifiers in refresh the SAME derivation as DKG (`Identifier.derive(nodeId)` for
dirs, the client identifier)? They MUST match or the sub-share evaluation lands on the wrong points.
(3) Is T (threshold) for the refresh polynomials the SAME T as the group? PSS requires δ_i degree = T-1 so
the refreshed sharing keeps the same reconstruction threshold.

**RESUME → DOD-REFRESH-1 increment 1: RED-FIRST crypto.** Write `core/crypto/src/__tests__/frost-resharing.test.ts`:
trustedDealer a 3-of-3 key → P1=combineSecret → run the PSS refresh in-process across the parties →
assert combineSecret(new shares)==P1 (secret preserved), new shares ≠ old shares, and a mixed old+new
share set does NOT reconstruct. Confirm red (no frost-resharing.ts yet), then implement until green, then
gate, then 3 reviewers, then wire daemon/directory, then J-REFRESH on the spine.

### 2026-07-01 ~02:25 — DOD-REFRESH-1 falsification PROBE — construction pivot (the design note's #1 unknown, resolved)
**Ran the falsification probe before any code (CLAUDE.md debugging discipline).** Result: the design's
assumed building block is WRONG and is now pivoted — caught at zero cost.

- **`generateSecretPolynomial(signers, secret=0)` THROWS** `invalid scalar: expected 1 <= sc < curve.n` —
  @noble rejects a zero constant term. So I CANNOT generate the zero-constant refresh polynomial via that
  helper. **Pivot:** build δ_i MANUALLY: `coefficients = [0n, c_1, …, c_{T-1}]` with `c_k =
  Fn.fromBytes(utils.randomScalar())`, degree T−1; commitments `= [Point.ZERO, c_1·G, …, c_{T-1}·G]`.
- **Confirmed primitives (all present, real):** `ed25519_FROST.utils.Fn` (IField: `fromBytes` LE→bigint,
  `ORDER`=L, add/mul/create), `utils.randomScalar()` (32B), `ed25519.Point` (`.BASE`, `.multiply(scalar)`,
  `.add`, `.ZERO`, `.toBytes()`→32, `.equals`). `Point.ZERO.toHex()` = `0100…00` ← this is exactly the
  commitment[0] value that PROVES the zero constant term (group secret unchanged).
- **Identifiers are 32-byte LITTLE-ENDIAN scalar hex:** `trustedDealer` ids are `0100…`, `0200…`, `0300…`
  = scalars 1,2,3; `Fn.fromBytes(bytes('0300…'))` === `3n`. So the polynomial evaluation point for party j
  is `Fn.fromBytes(hexToBytes(j.identifier))` — same identifier space as DKG.
- **`combineSecret(shares, signers)` round-trips** → use it as the TEST oracle: secret(before) ==
  secret(after refresh) proves the group key is preserved without ever assembling it in production.

**Locked construction (frost-resharing.ts):**
- `generateRefreshContribution(signers, allIds)` → δ = [0n, random…] degree T−1; `subShares[j] = Σ_k
  coeffs[k]·x_j^k mod L` (Horner, `Fn`); `commitment = [ZERO, c_1·G, …]`.
- `verifyRefreshContribution(commitment, signers)` → assert length===T, `commitment[0]===Point.ZERO.toBytes()`
  (the zero-constant proof), each a valid point.
- `applyRefresh(oldShare, received[], signers)` → for my id j: VSS-check each `δ_i(j)·G == Σ_k x_j^k·C_i[k]`
  + commitment[0]==identity, then `newShare = oldScalar + Σ_i δ_i(j) mod L`.

RED test next: `core/crypto/src/__tests__/frost-resharing.test.ts` — trustedDealer 3-of-3 → refresh →
combineSecret(new)==combineSecret(old), new≠old, mixed old+new does NOT reconstruct, VSS rejects a
tampered/non-zero-constant contribution.

### 2026-07-01 ~03:05 — DOD-REFRESH-1 increment 1 (crypto core) ✅ — 3 reviewers clean, construction SOUND
**frost-resharing.ts hardened + committed (893fc9c).** All 3 crypto reviewers independently verified the
zero-constant PSS construction is mathematically SOUND (code-reviewer checked it line-by-line against the
@noble/curves@2.2.0 FROST source: secret preservation, the `commitment[0]==identity ⟺ a_0≡0` proof via G's
prime order, the Feldman VSS Horner, the identity/zero-scalar guards being exact-not-exploitable, and the LE
field round-trip). Findings all at the contract boundary, fixed:
- **Completeness gate** (fallback HIGH + code-reviewer MEDIUM-LOW): `applyRefresh([])` returned the OLD share
  as a "successful" refresh (dead-share no-op); partial/divergent sets silently diverged the joint key.
  `RefreshContribution` now carries `fromId`; `applyRefresh(…, expectedParticipantIds)` rejects empty /
  partial / duplicate / out-of-roster sets. A proactive refresh, like DKG, needs EVERY shareholder.
- **Test 4 hollow** (test-attacker BLOCKING): only tampered `commitment[0]=G`, so a verify rejecting only G
  passes while accepting 2G (real shift). Strengthened: 2G + random point + e2e shift through applyRefresh.
- **Non-triviality** (code-reviewer LOW): reject the all-identity zero polynomial (free-rider, no randomness).
- **Zero identifier** (code-reviewer LOW): `identifierScalar` rejects 0 (mirrors noble `validateIdentifier`).
- **EQUIVOCATION (code-reviewer MEDIUM — load-bearing for the wiring):** the local primitive verifies each
  sub-share only against the commitment in its OWN list. A malicious party can EQUIVOCATE — send party A
  `(C,δ_A)` and party B a different internally-consistent `(C',δ_B)`, both with `commitment[0]=identity` —
  so both pass locally but A,B land on DIFFERENT polynomials (Δ_A≠Δ_B): no secret shift, but the quorum can
  no longer reconstruct/sign. The core CANNOT detect this alone (needs cross-party agreement). Docstring
  corrected (was overclaiming) + precondition documented. **→ the daemon `runNetworkRefresh` MUST run an
  ECHO/AGREEMENT round: every party broadcasts `H(commitment_i)` it received from each contributor i and
  ABORTS on any mismatch, before applyRefresh. This is a mandatory part of the wiring increment, not
  optional.** Prove it in J-REFRESH (an equivocating directory must abort the refresh, not diverge the key).

**RESUME → DOD-REFRESH-1 increment 2 (daemon + directory wiring).** Template: `runNetworkDkg`
(network-directory-node.ts:567-751) — the 3-round fan-out is the shape. `runNetworkRefresh(agentPubkey,
fromEpochN)`: (R1) every party generates its contribution + broadcasts commitment digests (echo round);
(R2) route each δ_i(j) sub-share to party j + verify the echo agreement; (R3) each party applyRefresh →
new share at epoch N+1. Directory: refresh frame handlers mirror dkgRound{1,2,3}; on apply storeShare(agent,
`:epoch:(N+1)`), `#currentEpoch.set(agent, N+1)`, persist the new encrypted share row (agent_key_shares,
new epoch_id — table already has UNIQUE(agent_id,epoch_id)), and RELOAD `#currentEpoch` from the MAX
epoch_id in agent_key_shares on startup (no new migration — the share rows ARE the epoch record). Client:
rotate `_localShares` + db-identity-store `frost_*` columns to the new epoch. Trigger: a client-coordinated
op (CLI `cello refresh <agent>` / MCP tool) — reversible design choice, testable from the spine.

### 2026-07-01 ~03:20 — DOD-REFRESH-1 ✅ — PSS refresh, 6 reviewers clean, J-REFRESH spine GREEN
**The hardest crypto unit is closed.** Zero-constant-term proactive secret sharing (Herzberg 1995) over
the joint FROST key: every shareholder adds a degree-(T−1) polynomial with constant term 0, so the group
public key is BYTE-IDENTICAL while every share rotates. Built across 4 layers + published crypto 0.0.13.

**6 reviewers total.** 3 on the crypto core (frost-resharing.ts) — all found the construction SOUND
(code-reviewer verified line-by-line vs the @noble/curves@2.2.0 source); fixed the completeness gate,
non-triviality, zero-identifier, equivocation precondition, hollow Test-4. 3 on the wiring — NO blocking,
equivocation defense confirmed (uniform relay: the client narrows each contribution's subShares per
recipient but relays the IDENTICAL commitment to all, so a directory can't equivocate). Fixed:
- **test-attacker BLOCKING** — the spine couldn't distinguish a real refresh from a relabel-only NO-OP
  (group key, epoch, applied-log all invariant to a no-op). Exposed `verifying_shares_digest` (public
  s_j·G, SI-001-safe); J-REFRESH now refreshes TWICE and asserts the digest CHANGED — the one observable
  that proves the shares actually rotated. The cryptographic "compromised in e → nothing in e+1" is proven
  in the crypto unit suite (a mixed old+new share set does NOT reconstruct).
- **HIGH-1 (durable persist)** — `refreshRound2` was fire-and-forget; a restart could lose the new-epoch
  share → client/directory epoch split. Now async + AWAITs `storeShareDurable` BEFORE advancing the epoch,
  fail-loud on persist failure (old-epoch share untouched ⇒ safe retry).
- **HIGH-2 (expiry survives restart)** — `#currentEpoch` is in-memory; a restart lost it ⇒ old shares would
  re-sign. `#isExpiredEpoch` now falls back to `ShareStore.getMaxEpoch` (the reloaded shares ARE the durable
  epoch record). New restart-survival unit test (fresh handler over a store holding epoch 2 rejects epoch 1).
- **M2** — `runAgentRefresh` asserts the post-refresh group key == the KNOWN pre-refresh key (catches a
  uniform secret-shift the cross-node check can't). **L7** — structured `persist_failed` reason.
- **Gate-miss caught:** the SUSPEND-1 nonce-replace (87d226c2) had left 2 directory unit tests asserting the
  old `NONCE_ALREADY_PENDING` — stale since SUSPEND-1 (the spine+crypto passed but this directory unit suite
  wasn't re-run). Updated to the reviewer-confirmed new behavior. Lesson: run the affected package's UNIT
  suite, not just the spine, after a behavior change.

**Gates:** crypto 254/254 (12 resharing incl. a real post-refresh FROST signature), daemon 453/453,
directory 661/661, J-REFRESH spine GREEN (2-refresh digest-change), back-compat j-sign + j-tofn-dkg green.
Parked (DoD): cross-party atomicity (needs a 2-phase refresh-commit protocol) + forward-secrecy old-share
delete — alpha tolerates fail-loud + manual `cello refresh` re-drive.

**Held unpushed:** trustless-cello directory changes batched for the DOD-DEPLOY-1 gate (each directory push
triggers a ~25-30 min deploy). cello-client crypto is already published (0.0.13) + on main.

**RESUME → DOD-RELAYSIG-1.** Next unit (Tier B, relay+client): "Relay signs its ordering record (Structure2)
+ PERSIST-012 signed-ACK + immutable receipt store ported from dead `core/client` into the live daemon;
client verifies + durably stores the receipt; a forged sequence is rejected." Per the "assume code exists"
discipline: the receipt store + Structure2 signing likely exist in the dead `core/client` (pre-REPOSPLIT) —
LOCATE and adapt into the live daemon rather than rewrite. Falsify-first, red on the spine (j-relaysig:
relay signs an ordering record → client verifies + stores → a tampered sequence number is rejected).

### 2026-07-01 ~04:05 — DOD-RELAYSIG-1 ✅ — relay-receipt client port, J-RELAYSIG spine GREEN, 3 reviewers clean
**A daemon-side PORT, not greenfield.** The relay already signs its ordering-record ACK (Structure2,
PERSIST-012, relay-node.ts:1129); the verify+store logic existed in the dead pre-REPOSPLIT `core/client`;
the live daemon received the ACK (session-relay-client.ts) but never verified or stored it. Ported into the
live daemon: `relay-receipt-store.ts` (verifyRelayAck + evaluateRelayAck + RelayReceiptStore) wired into
`#captureReceipt` + `cello receipts` query path. J-RELAYSIG spine GREEN (A→B send → relay signs → daemon
verifies + durably stores → `cello receipts` returns it, and the test independently re-verifies the Ed25519
signature end-to-end).

**3 reviewers — all findings fixed:**
- **code-reviewer HIGH (the important one):** the receipt PK was `(hash_hex, agent_pubkey)`, but
  `content_hash` binds only the plaintext — identical messages ("ok") get the SAME hash at DIFFERENT valid
  sequences, so `INSERT OR IGNORE` silently DROPPED legitimate attestations + broke the per-session query.
  Re-keyed on the attestation POSITION `(agent_pubkey, session_id, sequence_number)` with the hash as
  payload: repeated content is kept, the query is correct, and immutability now defends the REAL threat (a
  relay rewriting the hash at an already-assigned position; equivocation logged loud). Lesson: a content
  hash is NOT a unique ordering key — the position is.
- **test-attacker BLOCKING:** `#captureReceipt`'s verify-gates-store WIRING was untested (delete the gate,
  everything stayed green — the spine only proved "something stored"). Extracted a pure `evaluateRelayAck`
  (store|unsigned|bad_relay_id|invalid_signature) and a direct unit test proving a forged/non-binding
  signature → `invalid_signature`, never stored. Lesson: test the daemon's USE of the predicate, not just
  the predicate.
- **fallback-finder #1/#3/#4:** silent drops made loud (debug/warn/error), and a signed-but-INVALID ACK now
  REJECTS the submit (`relay_ack_signature_invalid`) so the send doesn't settle ok on an unverified
  sequence (it still completes via the direct path — sovereign-node redundancy).
- **Sound (verified):** TBS byte-for-byte cross-repo agreement, `unhex(relay_id)` invalid-point safety,
  ACK→pending FIFO pairing, forged-sequence rejection.

**Gates:** daemon 458/458, 5 receipt unit tests, J-RELAYSIG spine GREEN, back-compat j-sign green.
Parked (DoD): the authoritative registered-relay check is DOD-OPTIONB-SEAL-1's (the directory verifies each
receipt's relay vs its registration at seal) — RELAYSIG-1 delivers the CLIENT side; + a send-result
witnessed-bit (observability follow-on). NO directory/relay code change — the held trustless-cello batch is
unaffected; cello-client pushed.

**RESUME → DOD-OPTIONB-SETUP-1.** Next (Tier B, dir+relay+client): "Client presents the directory-signed
assignment to its chosen relay; relay verifies vs the group key; recordAssignment/#relay pin DELETED.
Session establishes with NO directory→relay dial; any relay the client picks works; relays[0] pin +
restart-breakage gone." THIS is the any-relay/any-directory core (the recurring relay_unavailable root
cause — memory project_relay_directory_any_to_any: us-east-1 pins recordAssignment to relays[0]=ap1). The
client must carry the FROST-signed assignment to its chosen relay; the relay verifies vs the consortium
group key; DELETE the directory→relay dial + the relays[0] pin. Assume-code-exists: locate recordAssignment
/ the relays[0] pin / #relay in the directory + relay, and the assignment-carry path. This touches the
DIRECTORY + RELAY (deploy batch) — falsify-first, red on the spine (j-optionb: establish a session with
ZERO directory→relay calls; any relay the client picks works).

### 2026-07-01 ~05:00 — DOD-OPTIONB-SETUP-1 — investigation COMPLETE + design decided (pre-compaction)
**The Explore agent died on an API connection drop mid-scan; I mapped the surface by hand.** Findings (all
file:line verified):

**THE BUG (M8B-SPEC.md:38):** the DIRECTORY dials the relay to register the session assignment —
`recordAssignment` over port 4001, SG-locked to the same-region directory, pinned to `relays[0]`
(alphabetical = ap1, often unreachable); only a local relay re-registration repoints it → breaks on every
directory restart. THIS is the recurring `relay_unavailable` (memory project_relay_directory_any_to_any).

**Exact code:**
- DELETE: `directory-node.ts:3135` `const recorded = await this.#relay.recordAssignment(relayAssignment)`
  inside `#processSessionRequest` (the directory→relay dial). + the `#relay` (RelayAdapter, :443) /
  `#relayEndpoint` (:444) pin + the updateMultiaddr restart-workaround (:907-914). `network-relay-adapter.ts`
  is the RPC adapter to delete as a directory→relay path.
- The directory builds the relay assignment at `directory-node.ts:3115-3134`: relay TBS =
  CBOR([session_id, initiatorPubkey, targetPubkey, session_timestamp, (initiator_session_peer_id,
  counterparty_session_peer_id) when both present]); `relayDirSig = #keyProvider.sign(relayTbs)` (:3125) —
  a PER-NODE signature (NOT FROST). `#keyProvider` IS the directory's per-node identity/step-5 signing key
  (:335/:442/:470) == the manifest node pubkey.
- The CLIENT-facing `session_assignment` frame (:3186) carries a DIFFERENT signature: `directory_signature
  = frostedSig` (:3093) — the INITIATOR's FROST establishment signature over
  `buildSessionEstablishmentTbsM7` (:3003, covers session_id + both pubkeys + both session peer ids/addrs +
  timestamp + transport_mode). This is the AGENT authorizing the session (signed with the initiator's
  primary_pubkey), NOT a directory authorization of the relay assignment.
- RELAY side: `relay-node.ts:485-508` `recordAssignment` verifies `directory_signature` over the relay TBS
  vs a SINGLE `#directoryPubkey` (from env `CELLO_DIRECTORY_PUBKEY`, relay.ts:73 → relay-node.ts:225/508).
  The relay ALREADY has a `record_assignment` FRAME handler (:370-407) — a CLIENT can present
  {session_id, participant_a/b, session_timestamp, assignment_signature} and the relay verifies it. But the
  CLIENT (daemon) does NOT send it today (grep empty) — only the directory dials it. Client relay flow:
  `session-relay-client.ts` `#connect`(:415)→`#authenticate`(:460) sends only `relay_auth_response`
  (K_local proof), NO assignment.
- SPINE: the relay's `CELLO_DIRECTORY_PUBKEY = dir0Pubkey` (live-harness.ts:668) → pinned to node 0 only =
  the any-directory blocker.

**DESIGN DECISION (Design A — per-node relay sig verified vs the consortium MANIFEST):** There is NO
directory-consortium FROST group key — the agent's primary_pubkey FROST key authorizes the SEAL, not the
relay assignment; the directories hold per-node keys + the agents' K_server shares. So the SPEC's "relay
verifies vs the consortium group key" is realized as **"verify the directory's per-node relayDirSig vs ANY
of the N directory node pubkeys in the threshold-signed consortium manifest"** — that IS the directory
authorization, and any consortium directory can grant relay service. The agent's FROST establishment sig
(frostedSig) authorizes the SESSION (peer↔peer), the per-node relayDirSig authorizes the RELAY ASSIGNMENT.
Implementation (3 components — order matters to avoid breaking the live flow):
  1. **Relay (additive, safe first):** load the consortium manifest (`CELLO_CONSORTIUM_MANIFEST` +
     `CELLO_CONSORTIUM_ROOT_KEYS`, same as directories/client) → the N directory node pubkeys; in
     `recordAssignment`, verify `directory_signature` vs ANY of them (keep the single `#directoryPubkey` as
     a fallback for back-compat / unmanifested relays).
  2. **Directory:** include the relay assignment (relayDirSig + the relay-TBS fields: session peer ids) in
     the CLIENT-facing `session_assignment` frame, so the client can carry it. (The client already gets the
     session_id/participants/peer ids; ADD the relayDirSig as a new field, e.g. `relay_directory_signature`
     — name it explicitly per feedback_api_parsimony, never reuse `directory_signature` which is frostedSig.)
  3. **Client (session-relay-client):** after `#authenticate`, send a `record_assignment` frame to the
     chosen relay carrying {session_id, participant_a/b, session_timestamp, session peer ids,
     assignment_signature = relay_directory_signature}. THEN DELETE the directory→relay dial (:3135) + the
     `#relay` pin.
  4. **Spine (j-optionb-setup):** prove a session establishes with ZERO directory→relay calls (assert the
     directory log has NO recordAssignment dial; the relay logs an assignment_ok from the CLIENT), and —
     the any-directory teeth — the relay verifies an assignment signed by a NON-node-0 directory (give the
     relay the 3-node manifest, route the session-request through node 1 or 2).
Falsify-first: confirm the client today receives the session peer ids in the assignment frame (it needs
them for record_assignment); confirm `#keyProvider`.getPublicKey() == the manifest node-0 pubkey (the spine
currently works only because dir0Pubkey == #keyProvider's pubkey for node 0).

**RESUME → DOD-OPTIONB-SETUP-1 implementation (Design A above).** Start with the relay manifest verification
(additive/safe), then the directory client-facing relay sig, then the client carry + delete the dial, then
the j-optionb-setup spine. Touches DIRECTORY + RELAY + protocol-types (deploy batch — held). After SETUP:
OPTIONB-SEAL-1 (the hardest remaining — directory rebuilds + verifies the Merkle tree OFFLINE from
client-carried relay receipts + FROST-seals, NO directory→relay getSealLeaves/confirmSeal). Per the
Opus-priority decision, do SETUP + SEAL on Opus before PRESENCE/PICKUP/DEPLOY.

### 2026-07-01 ~05:00 — DOD-OPTIONB-SETUP-1 — IMPLEMENTED, spine GREEN (j-optionb-setup + j-relaysig), reviewers in progress
**The any-relay/any-directory cutover.** Deleted the directory→relay `recordAssignment` dial (the
`relays[0]`-pinned, SG-locked, restart-breaking `relay_unavailable` root cause — memory
project_relay_directory_any_to_any). The directory now signs a per-node relay-assignment signature and
ships it INSIDE the client-facing `session_assignment`; the CLIENT presents it to ITS chosen relay; the
relay verifies it against the consortium directory pubkey SET. Design A + the 2 refinements, exactly as
decided in M8B-DECISIONS.md. Files (both repos):
- **protocol-types** `session.ts`: `relay_directory_signature?` on `SessionAssignmentCommon` (distinct
  from `directory_signature` = the FROST session-establishment sig; this authorizes the RELAY ASSIGNMENT).
- **directory** `directory-node.ts`: keep the relayDirSig compute, attach it to the client-facing
  assignment (cast — the pinned published protocol-types type lacks the field until the DEPLOY-1 bump);
  DELETE `this.#relay.recordAssignment(...)` (3135) + the `#relayAuthenticated` flag. `directory-frames.ts`
  `encodeSessionAssignment`: include `relay_directory_signature` (it WHITELISTS fields — this was the
  bug, see below). `#relay`/getSealLeaves/confirmSeal stay for OPTIONB-SEAL-1.
- **relay** `relay-node.ts`: `#directoryPubkeys[]` (consortium set); `recordAssignment` verifies the TBS
  vs ANY of them; NEW `#processClientRecordAssignment` handler on the authenticated CLIENT stream (no
  admin-auth — authority is the assignment_signature vs the consortium set; fail loud `assignment_invalid`
  /`relay.assignment.rejected`). `relay-frames.ts`/`relay-types.ts`: `client_record_assignment` frame +
  decode. `bin/relay.ts`: parse `CELLO_DIRECTORY_PUBKEYS` (comma-hex, fallback single).
- **client** `session-relay-client.ts`: `AgentRelayClient.registerSession` takes the assignment carry;
  `#doRecord` sends `client_record_assignment` + awaits `assignment_ok` (single-in-flight on `#submitChain`,
  stream-reset on timeout like submit); `#doSubmit` records before the first hash_submit; `#dispatch`
  handles `assignment_ok`/`assignment_invalid`. `RelayConnectParams` + `buildRelayConnectParams`
  (daemon.ts) thread participant pubkeys/timestamp/peer-ids/sig; `session-node-manager.ts` passes it.
- **spine** `live-harness.ts`: relay gets all 3 node pubkeys via `CELLO_DIRECTORY_PUBKEYS`.
  `j-optionb-setup.spine.test.ts`: routes the session through a NON-node-0 directory; asserts the relay
  records `source:client` + a node-1-signed assignment is accepted (any-directory teeth).

**THE BUG (producer gap, caught by j-relaysig regressing):** `encodeSessionAssignment` WHITELISTS the
fields it encodes — my directory cast set `relay_directory_signature` on the object, but the encoder
silently DROPPED it before the wire. The client always parsed `undefined` → no carry → no record → relay
never learned the session → hash_submit rejected → no receipt. Fixed by adding the field to the encoder.
Lesson: a frame encoder that whitelists is a silent field-drop trap — adding a field to the type/object
is not enough; the encoder must include it. The spine (j-relaysig, which had nothing to do with Option B
on its face) was the enforcer that caught it.

**Falsify-first confirmed:** the spine sessions are RELAY-mode by default (`CELLO_ENV=local` →
`LocalTransportSelectorStub` → `dialable:false`), so the path is exercised without forcing anything.

**Gates:** relay 165/165 (incl. 3 new client_record_assignment unit tests: any-directory accept,
forged-signature reject `directory_signature_invalid`, hash_submit-after-record), daemon 458/458,
directory 660/660 (5 obsolete dial-contract tests rewritten to Option B, 1 retired warn-regression),
typecheck + lint clean, reachability gate green. **J-OPTIONB-SETUP spine GREEN + J-RELAYSIG back-compat
GREEN.** Commits: trustless `12780b2e` (feat) `3805ef5f` (directory tests) `c3471d3a` (relay tests);
cello-client `55f2b28`. Held unpushed (directory+relay → DOD-DEPLOY-1 batch); cello-client unpushed too.

**Reviewers (read-only):** `cello-fallback-finder` DONE — NO HIGH (the crypto verify is mandatory + fails
CLOSED; no forged/non-consortium assignment can look healthy, no send settles ok without a witness on the
sender path). 3 MEDIUM + 2 LOW, all about DIAGNOSABILITY of intended degradation — ALL FIXED: (#1) parser
silently dropped a present-but-malformed sig → daemon `buildRelayConnectParams` now warns
`session.relay.assignment.signature.missing` when transport_mode=relay but no sig (the only signal on a
pure receiver); (#3) missing `CELLO_DIRECTORY_PUBKEYS` silently disabled any-directory → relay now logs
`relay.startup.consortium-directories` {count, anyDirectory}; (#4) stale "relay has registered it" comment
fixed; (#2/#5) the intended unwitnessed-degrade is now diagnosable via #1's warn. `feature-dev:code-reviewer`
(opus) + `cello-test-attacker` still in flight — fixes + final gate re-run + DoD ✅ flip pending their return.

**RESUME → finish DOD-OPTIONB-SETUP-1:** fold in code-reviewer + test-attacker findings, re-run the
gate (relay+daemon+directory units + j-optionb-setup + j-relaysig), commit, flip the DoD line to ✅
SPINE-PROVEN + status board, THEN start DOD-OPTIONB-SEAL-1 (the hardest remaining — directory rebuilds +
verifies the Merkle tree OFFLINE from client-carried relay receipts + FROST-seals, deleting the
getSealLeaves/confirmSeal directory→relay calls; `#relay` adapter fully removable after that completes
DOD-INV-NO-DIR-RELAY).

### 2026-07-01 ~05:25 — DOD-OPTIONB-SETUP-1 ✅ COMPLETE — all 3 reviewers in, every finding fixed, full gate GREEN
Completion delta to the ~05:00 entry above. **code-reviewer (opus): APPROVED**, no blocking/high. Fixed:
- **M1 (real bug):** `#doRecord` reset the SHARED relay stream on a CLEAN `assignment_invalid`, not just on
  timeout — tearing down sibling sessions' in-flight submits + storming re-presents (esp. if a relay is
  misconfigured without `CELLO_DIRECTORY_PUBKEYS`). Now distinguishes `rejected` (terminal: mark
  `recordRejected`, do NOT reset the healthy stream, stop retrying) / `timeout` (reset for FIFO safety,
  transient) / `closed` (stream dropped, transient). cello-client `1c8a1af`.
- **L3:** relay `#processClientRecordAssignment` binds the authed client to session participation
  (reject `not_a_participant` loud) — spine-verified the relay-auth pubkey == the assignment participant for
  both A and B. **L4:** settle `#pendingRecord` on stream-gone/close (no 10s hang). **L6:** stale comment +
  AC-011 title fixed. **M2:** `CELLO_DIRECTORY_PUBKEYS` IaC wiring is a hard DEPLOY-1 dep — parked + startup
  log added. **L5:** informational, no change.
**test-attacker: "TESTS HAVE TEETH"** (no hollow bypass — the relay frame suite rejects forged/non-consortium
sigs, accepts a non-node-0 member, proves the recorded session functions). Closed both under-coverage gaps:
3 relay `client_record_assignment` unit tests (any-directory accept / forged reject / hash_submit-after-record),
2 daemon `#doRecord` tests (idempotency + assignment_invalid surfaced), 2 directory encoder regression-guards
(relay_directory_signature present⇒on-wire / absent⇒off-wire — guards the whitelist-drop bug).
**fallback-finder: NO HIGH** (verify is mandatory + fails CLOSED). Fixed the diagnosability MEDIUMs:
`session.relay.assignment.signature.missing` warn (relay-mode w/o sig), `relay.startup.consortium-directories`
log, stale comment.

**Final gate (all GREEN):** relay 165/165, daemon 460/460, directory 662/662, typecheck+lint clean,
reachability gate green, **J-OPTIONB-SETUP + J-RELAYSIG spine GREEN**. Commits: trustless `12780b2e`
`3805ef5f` `c3471d3a` `a9af89c3`; cello-client `55f2b28` `1c8a1af`. DoD flipped ✅ SPINE-PROVEN;
DOD-INV-NO-DIR-RELAY → 🟠 PARTIAL (recordAssignment gone; getSealLeaves/confirmSeal pending SEAL-1).
Held unpushed (directory+relay → DOD-DEPLOY-1 batch); cello-client unpushed too (no publish yet).

**RESUME → DOD-OPTIONB-SEAL-1** (the hardest remaining, Opus-priority). "Client carries relay-signed
receipts to the directory; directory rebuilds + verifies the tree OFFLINE and FROST-seals (T-of-N);
`getSealLeaves`/`confirmSeal` directory→relay calls deleted. Full seal with NO directory→relay connection;
chain + strict-in-order preserved; tampered/omitted receipt rejected." This completes DOD-INV-NO-DIR-RELAY
(then the `#relay` adapter + `#relayEndpoint` + updateMultiaddr workaround are all removable) and consumes
the RELAYSIG-1 client receipts at the seal. Assume-code-exists: the directory's seal path
(`#relay.getSealLeaves` at directory-node.ts:3394, `confirmSeal` at :3744/:4315, `rejectSeal` :4253) + q
the relay's `get_seal_leaves`/`confirm_seal`/`reject_seal` frames are the surface to replace with a
client-carried-receipts offline rebuild. Red-first on a j-optionb-seal spine (seal with zero directory→relay
calls; tamper/omit a receipt → rejected).

### 2026-07-01 ~05:40 — DOD-OPTIONB-SEAL-1 — DESIGN NOTE (procedure §6, design-significant; investigation complete)
**Goal:** "Client carries relay-signed receipts to the directory; directory rebuilds + verifies the tree
OFFLINE and FROST-seals (T-of-N); `getSealLeaves`/`confirmSeal` directory→relay calls deleted. Full seal
with NO directory→relay connection; chain + strict-in-order preserved; tampered/omitted receipt rejected."
Completes DOD-INV-NO-DIR-RELAY (then `#relay`/`#relayEndpoint`/updateMultiaddr are all removable).

**Investigation (file:line verified):**
- There are TWO seal paths in the directory:
  1. **Bilateral** (`#processSealAttempt` directory-node.ts:3239 → `processSeal` :3932): the seal request frame
     ALREADY carries `leaves` + `merkle_root` (directory-node.ts:974-986). The directory verifies the
     client-supplied root by recomputing it. **No directory→relay call here — already Option B-shaped.**
  2. **Unilateral** (`#processSealUnilateral` :3314, counterparty ABSENT): the `seal_unilateral` frame carries
     only `reported_root` (no leaves), so the directory DIALS the relay `getSealLeaves` (:3383) to fetch the
     leaf chain, then `#verifyUnilateralChain` (:3537) rebuilds the tree + checks it == reported_root, then
     FROST-notarizes with B absent. **THIS is the directory→relay dial to delete.**
- Relay `getSealLeaves` (relay-node.ts:661): returns `state.leaf_log` (the Structure2 leaves the relay
  witnessed) + `merkle_root` rebuilt from the relay's own session state. `confirmSeal` (:684):
  cleanup + `destroySession`. `rejectSeal` (:693): mark `seal_rejected`. **confirmSeal/rejectSeal are pure
  relay housekeeping — the relay's idle-session sweep (`#idleSweepInterval`, already live) reclaims a
  post-seal session with no directory call, so these two are DELETABLE under Option B.**

**Design (the hard part — the unilateral offline rebuild):**
- The `seal_unilateral` frame must CARRY the witnessed leaf chain + the relay's signatures, so the directory
  rebuilds + verifies OFFLINE. Source on the client: the daemon's OWN session tree (the Structure2 leaves it
  built as it sent/received) + the RELAYSIG-1 `RelayReceiptStore` (the relay's signed ordering receipts:
  content_hash + sequence_number + relay_id + signature, keyed by (agent, session, sequence)).
- The directory's offline verification (replaces the relay's word with the relay's SIGNATURE — sovereign-node
  invariant): (a) rebuild the Merkle tree from the carried leaves, assert root == reported_root; (b) for each
  leaf, verify the relay receipt signature over the relay TBS (the relay attested THIS content_hash at THIS
  sequence) — a tampered/omitted leaf fails; (c) strict-in-order: sequences are contiguous + monotonic (no
  gap = no omission), and the hash chain (prev_root linkage) holds. The directory must know the relay's
  ack-signing pubkey to verify — carried in / resolvable from the receipts (relay_id = hex(pubkey)); the
  AUTHORITATIVE registered-relay check (is relay_id the directory-registered relay for this session?) is the
  piece RELAYSIG-1 explicitly deferred HERE (DoD RELAYSIG-1 Parked).
- **OPEN (first impl step, falsify-first):** confirm the daemon's seal-unilateral send path + what it has in
  hand (does it already hold the Structure2 leaves + the receipts for the session?), and define the exact
  carry fields on `seal_unilateral` (leaves + per-leaf relay receipt {seq, relay_id, signature, timestamp}).
  Then: directory `#verifyUnilateralChain` takes the carried leaves+receipts (no `getSealLeaves`); delete the
  `#relay.getSealLeaves`/`confirmSeal`/`rejectSeal` calls; after all directory→relay calls are gone, remove
  the `#relay` adapter + `#relayEndpoint` + updateMultiaddr (907-914) + the `network-relay-adapter.ts` RPC path.
- **SIs:** the directory NEVER dials the relay at seal (DOD-INV-NO-DIR-RELAY complete); a tampered leaf
  (wrong content_hash), an omitted leaf (sequence gap), or a forged relay signature → seal REJECTED; the
  chain + strict-in-order gate stay the floor; relay never sees plaintext (only hashes — unchanged).
- **Seam:** the LIVE daemon (session-relay-client / session-node-manager) + the live directory — NOT the dead
  core/client. Touches directory + relay (delete) + daemon + protocol-types (seal_unilateral frame fields) →
  deploy batch (held). Red-first on a j-optionb-seal spine: a unilateral seal completes with ZERO
  directory→relay calls; tamper/omit a carried receipt → the seal is refused.
