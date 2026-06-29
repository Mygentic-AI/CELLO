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
| FED-MANIFEST-001 | DOD-MANIFEST-1 | client+dir | ⬜ not started | signed N-node manifest + N-endpoint resolver |
| FED-DKG-001 | DOD-DKG-1 | client+dir | ⬜ not started | multi-node DKG (2-of-3) |
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
