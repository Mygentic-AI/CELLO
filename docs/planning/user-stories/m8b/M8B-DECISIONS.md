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

<!-- Append below. Format:
### YYYY-MM-DD HH:MM — <unit-id> — <short title>
- Fork: …  Chose: …  Why: …  Reverse: …
-->
