# M8B Federation Build — Decisions Log

Every fork hit during the autonomous run is recorded here: timestamp, the fork, the choice, why, and how
to reverse. The rule is **pick the reversible option and keep going** — never block (M8B-PROCEDURE §3a).
Genuine undecidable forks are PARKED (journal + DoD "Parked decisions" + here), never block the run.

## Pre-resolved with Andre (2026-06-29 ~20:00, before he slept)
- **Authorization:** full — dev AWS deploys + npm publish allowed (alpha, solo, no users; recoverable). Not a live grenade.
- **T-of-N coordination:** client-as-coordinator relay (client fans out to N directory nodes, relays DKG round-2; NO directory↔directory).
- **Directory↔relay:** Option B (client carries relay-signed receipts; directory never dials a relay).
- **Cross-node state:** replicate presence + directory_nodes + pickup (pickup→UUID) into cello_pub; sweep gated to owning node.
- **Scope:** widest — T-of-N wiring + share-refresh + relay-signed ordering + Option B + cross-node replication.
- **Proof bar:** local 3-directory spine first → then deploy to dev and prove on the live 3-region cluster.

---

## Decisions made during the run

### 2026-06-29 ~20:10 — RUN — execution model (CORRECTED after re-reading M7-PROCEDURE)
- Fork: my initial plan (sequential branch-per-unit + dispatched coder agents + cron) vs the proven M7 model.
- Chose: **ONE coder thread (the main loop), ONE assembly branch per repo (`m8b-assembly`), read-only
  reviewers only, cron drift-check.** No parallel implementation agents, no per-unit branch sprawl.
- Why: M7-PROCEDURE §5 is explicit — "parallel branches are what produced the sprawl that buried this
  milestone." A dispatched-coder-per-unit plan reintroduces exactly that. The main loop codes; subagents
  are read-only (reviewer / test-attacker / fallback-finder / done-auditor / explorer).
- Reverse: trivial — it's a working-style choice, not a code artifact.

### 2026-06-29 ~20:10 — RUN — deploys authorized but sequenced as the close gate
- Andre authorized dev deploys + npm publish (alpha). Chose to USE them only at the CLOSE GATE: local
  3-directory spine green → publish beta → deploy dev → prove live. Not a discovery loop (M7 lesson:
  "no deploys as a discovery tool"). Reverse: n/a (sequencing only).

### 2026-06-29 ~20:15 — RUN — docs relocated federation-milestone/ → user-stories/m8b/
- Andre: keep DECISIONS (new, liked) + SPEC; fold WORKLOG's status board INTO the build journal (best of
  both). Restructured to the M7 5-doc shape under `docs/planning/user-stories/m8b/`. The old
  `docs/planning/federation-milestone/` folder is removed. Reverse: git history.

### 2026-06-29 ~20:45 — RUN — work directly on main (SUPERSEDES the assembly-branch decision)
- Fork: keep the `m8b-assembly` branch (no-merge-to-main) vs work directly on `main`.
- Chose: **work directly on `main` in both repos.** Merged `m8b-assembly` → main (ff) and deleted it.
- Why: Andre — solo, no other coders, and we're deploying from main anyway, so branch isolation +
  no-merge is pure overhead. Supersedes the earlier "one assembly branch / never merge to main" choice.
- Caveat carried into PROCEDURE §5: a push touching `packages/directory/**` or `packages/relay/**`
  triggers the ~25-30 min CI/CD deploy, so commit often locally but BATCH directory/relay pushes (don't
  push per-commit); cello-client + e2e/spine pushes are free.
- Reverse: branch off main again if ever needed.

### 2026-06-30 ~21:05 — FED-SPINE-001 — stopped a stale worktree postgres holding :5433
- Fork: the spine harness needs local Postgres on `localhost:5433`, but the orphan container
  `trustless-cello-m8-read001-postgres-1` (a long-closed M8-READ-001 worktree, Up 41h) still held
  `0.0.0.0:5433`, so `docker compose up postgres` in the canonical repo failed to bind.
- Chose: `docker stop trustless-cello-m8-read001-postgres-1` to free the port; the canonical
  `trustless-cello` project's postgres then binds 5433 (where the harness expects it).
- Why: M8-READ-001 is closed; the container is a stale leftover. Reversible + correct; never-block.
- Reverse: `docker start trustless-cello-m8-read001-postgres-1` (but it should stay stopped — stale).
  Note: dozens of OTHER `*-postgres-1` containers exist in `Created` (not running) state from old
  worktrees — harmless (they hold no port); a future cleanup could `docker rm` them, not this unit's job.

### 2026-06-30 ~21:55 — FED-MANIFEST-001 — manifest `endpoint` is the node's HTTP bootstrap base
- Fork: a manifest `ConsortiumNode.endpoint` is documented as `wss://host:port`, but the live directory
  resolution path is HTTP `{base}/bootstrap` → multiaddr. To resolve N nodes I need an HTTP bootstrap base
  per node. Reuse `endpoint` vs add a new `bootstrapUrl` field?
- Chose: **reuse `endpoint` as the node's HTTP base for `/bootstrap`** — if it starts `http`, use as-is;
  if `wss://host[:port]`, map → `http://host[:port]`. Spine 3-node manifest sets `endpoint =
  http://127.0.0.1:{healthPort}` (the real bootstrap URL = directoryUrls[i]).
- Why: API-parsimony — `endpoint` already names the node's reachable address; the single-endpoint path
  already treats CELLO_DIRECTORY_URL / PRODUCTION_DIRECTORY_URL as `http://…` bases. Adding a field for
  the same intent is the continuation-bias trap.
- Reverse: if production directories are WSS-only with no HTTP `/bootstrap`, add a dedicated
  `bootstrapUrl` field to the manifest node + the mapping fn. Schema + one function — cheap.

### 2026-06-30 ~21:50 — FED-SPINE-001 — pre-existing j-auth poll failures parked (not a regression)
- Fork: j-auth fails 2/6 (DOD-AUTH-2 poll-refresh + poll-rejects-forged); is it my SPINE-1 harness change?
- Chose: **PARK as pre-existing, continue.** Proven via the M7-baseline harness (`059134d2`) failing the
  same 2 identically. Full record in DoD "Parked decisions". Out of SPINE-1/MANIFEST-1 resolution scope.
- Why: not a federation regression; rabbit-holing a pre-existing M7 manifest-poll bug would stall the
  milestone. Revisit during/after MANIFEST-1 (same manifest area).
- Reverse: n/a (investigation deferral, not a code choice).

### 2026-06-30 ~23:25 — FED-DKG-001 — T-of-N topology + threshold formula + refusal gate
- **Fork A (topology source):** who decides N (and T) for the DKG — the client, a single directory, or
  the signed manifest? **Chose:** the threshold-signed consortium manifest — both client and directory
  derive N = manifest node count from their OWN verified manifest and cross-check; mismatch aborts.
  **Why:** neither party can unilaterally shrink/inflate the quorum (a malicious client can't weaken it,
  a malicious node can't pad it); the officer-signed manifest is the tamper-proof source. **Reverse:**
  change the derivation source in the shared topology helper.
- **Fork B (threshold formula — the genuine fork):** what FROST threshold T? **Chose:** participants =
  N_dirs+1 (client always present); N_dirs=1 → T=2 (current 2-of-2, unchanged); **N_dirs≥2 → T=N_dirs**
  (= max−1: client + any N_dirs−1 directory nodes, tolerates exactly ONE directory outage, no single
  directory mandatory). N_dirs=3 → T=3 of 4 (the DoD's "2-of-3"). **Why:** DOD-INV-NODE requires "kill
  any one of N and the ceremony still completes"; T=max−1 is the tightest threshold meeting that
  (maximizes forge-resistance while tolerating 1 outage). A lower T tolerates more outages but lets fewer
  nodes forge (weaker security). **This is the security/availability knob — change this line if Andre
  wants higher outage tolerance for large N.** T is derived in a shared helper, NOT a manifest field yet.
  **Reverse:** edit the threshold helper; add a signed `signingThreshold` manifest field if a deploy needs
  a configurable T.
- **Fork C (degraded roster):** run the ceremony on whatever resolved, or refuse below quorum? **Chose:**
  REFUSE with a distinct `dkg_below_threshold` error when fewer than T of N directory endpoints resolve.
  **Why:** closes the silent fallback cello-fallback-finder flagged (MANIFEST-1 #1) as HIGH-if-DKG-1-skips
  — a degraded consortium must not silently run a ceremony on too few nodes. **Reverse:** n/a (a
  correctness/security gate, not a preference).

<!-- Append below. Format:
### YYYY-MM-DD HH:MM — <unit-id> — <short title>
- Fork: …  Chose: …  Why: …  Reverse: …
-->
