# CELLO — Claude Code Guide

## What This Project Is

CELLO is a peer-to-peer identity and trust layer for agent-to-agent communication: split-key signing (FROST), tamper-evident hash chains, and prompt-injection defense — without trusting a centralized platform.

`docs/planning/` is an **Obsidian vault** — the primary design record. All architectural decisions and discussion logs live here.

---

## Required Reading

**Read `CONTEXT.md` at the repo root before any implementation work.** Canonical glossary — terms, package structure, interface contracts. Using terms not defined there is a bug.

---

## Vault Structure

```
docs/planning/
├── protocol-map.md          # Start here — 9 protocol domains, readiness, key discussion logs
├── end-to-end-flow.md       # Canonical narrative — every domain in one story
├── discussion_logs/         # YYYY-MM-DD_HHMM_slug.md — one file per design session
└── user-stories/            # m0/ m1/ … — story YAML files per milestone
```

Every document needs YAML frontmatter: `name`, `type`, `date`, `topics`, `status`, `description`.

---

## SPARC Development Process — Non-Negotiable

CELLO is financial trust infrastructure. Every story, every package, every time.

Full process: `docs/planning/day-0-agent-driven-development-plan.md`

**Five phases in order:**

**S — Specification:** Read the full story YAML first. Stories must describe production behavior — every AC must pass if participants are in different OS processes on different machines.

**P — Pseudocode:** Write pseudocode before any implementation. Crypto code must cite the RFC (Ed25519 → RFC 8032, FROST → RFC 9591).

**A — Architecture:** Define TypeScript interfaces and confirm package boundaries before coding.

**R — Refinement (TDD, absolute rule):** Write all tests first → confirm all red → implement → confirm all green. No implementation before red tests exist. No mocks for crypto operations.

**C — Completion gate (in order):** `pnpm run test` → `pnpm run lint` → `pnpm run typecheck` → build → code review (`feature-dev:code-reviewer` agent) → commit with story ID.

**Milestone close gate:** No milestone closes until a live multi-process smoke test passes. Vitest green ≠ done.

**Test fixture discipline:** Never write a new `makeFixture()` from scratch. Use and extend `packages/e2e-tests/src/session-fixture.ts`. Add `opts` fields with non-breaking defaults. Enforced by `/cello-review` — from-scratch fixture is blocking.

---

## Infrastructure State — Mandatory

**`infra/STATE.md` is the authoritative record of what exists in AWS.** It lists every deployed stack, its status, last deployed date, and all key resource identifiers.

**You must read `infra/STATE.md`** before any session involving deployment, AWS resources, IaC changes, or anything that depends on knowing what infrastructure exists.

**You must update `infra/STATE.md`** if your session deploys, modifies, or tears down any AWS infrastructure:
- If you ran `./infra/deploy.sh` — STATE.md is updated automatically.
- If you made any direct AWS change (console, CLI, manual stack operation) — update STATE.md by hand and commit it before closing the session.

A session that changes AWS infrastructure without updating STATE.md is incomplete. Any agent that skips this is creating exactly the kind of undocumented manual state that IaC exists to prevent.

---

## M4+ Development Model

M4 introduces external systems (PostgreSQL, KMS, ECS, relay WAL). The inner loop stays fast only with deliberate discipline. See full decisions in `docs/planning/discussion_logs/2026-05-16_0753_development-pipeline-and-local-iteration.md`.

**Adapter pattern — mandatory.** Every external dependency is behind an interface in `packages/interfaces/` with a local stub in `packages/interfaces/stubs/`. Never call AWS directly from application code. Interface boundary is narrow — add to it only when a specific failing test or production behavior requires it.

**Composition root.** All adapters are instantiated in `server.ts`. `CELLO_ENV` drives selection (`local` | `dev` | `staging` | `production`). App fails at startup with a clear error if any required adapter configuration is missing.

**Interface name precision.** `EnvelopeKeyProvider` encrypts K_server_X shares at rest via KMS (introduced M4). `SigningKeyProvider` is the client-side Ed25519 signing interface (introduced M0). These are distinct — confusing them is a type error and a security error.

**Logger — injected, never imported directly.** No `console.log` in implementation code. Events use `domain.noun.verb` taxonomy (e.g. `session.started`, `frost.dkg.round1.complete`). The canonical taxonomy lives in the pipeline discussion log above. Correlation IDs are minted once per async flow and threaded through every event in that flow.

**Observability ACs are first-class.** Every M4+ story must specify: named log events, required context fields per event, correlationId threading for async flows, error path coverage, and alarm thresholds for new failure modes. `/cello-story` enforces this at write time. `/cello-review` Step 4c verifies implementation matches ACs exactly. Missing events, wrong names, missing fields, and `console.log` in implementation are blocking findings.

**Local Postgres via Docker Compose — not mocked.** RLS, pgaudit, and hash chain constraints are database-level constructs. A mock database cannot catch a broken RLS policy.

**CI/CD: AWS CodePipeline V2 + Lambda router.** Path-based triggers via `cello-pipeline-filter` Lambda (data-driven JSON mappings config). Native CodePipeline V2 path filtering was evaluated and rejected — coarse glob behavior, tooling lagged API. IaC discipline: everything in AWS exists in IaC; one template per service, environment as parameter.

**NEVER push Docker images from local.** All image pushes happen exclusively through the CI/CD pipeline (CodeBuild). If images need to exist in other regions, use ECR cross-region replication — never `docker push` from a local machine. No exceptions.

---

## Operational Discipline — M5 Rules

These rules are extracted from the M5 retrospective (`docs/planning/discussion_logs/2026-05-25_1100_m5-retrospective-lessons-learned.md`). They are mandatory, not optional.

### Migration Integrity

1. **Never modify a migration file after it has been applied to any environment.** Extract changes to a new migration. A modified migration causes Flyway checksum mismatches that crash every container until manually resolved.

2. **Push to origin immediately after each merge.** Never batch multiple merges before pushing — this triggers all downstream pipelines simultaneously and defeats path-based CI filtering.

3. **Integration gate ACs run against an environment with prior migrations already applied.** A fresh database does not catch migration modification patterns. Each story's final AC must verify Flyway reports zero checksum errors on all prior migrations (V1 through V[N-1]).

4. **Schema design is complete before parallel implementation begins.** For multi-story milestones with database changes, one story (e.g., OPS-AGENT-000) produces the complete schema design and reserves all migration version numbers before any parallel work starts. No reactive mid-milestone migrations.

### Coordination and Documentation

5. **Every parallel milestone gets a COORDINATION.md.** Format: date/time, agent/story identity, what is blocked and why, what has already been done, what the other agent needs to do. Read it at the start of every session. Append, never overwrite. Location: `docs/planning/user-stories/m{N}/COORDINATION.md`.

6. **Milestone write-ups are incremental.** Write `docs/planning/milestone-writeups/M{N}-{slug}.md` as a living document. Each story appends a section when it closes. Format: what was delivered, bugs found and fixed (Symptom / Root cause / Fix / Rule), what this unblocks. The write-up is archaeology done in real time, not a post-hoc summary.

### Infrastructure Discipline

7. **After any manual AWS fix, update IaC and redeploy.** Never leave "works but isn't in IaC" state. Every fix must pass the region-expansion test: "would this work in a brand-new region with zero manual steps?" Examples from M5: envelope key secrets, IAM role region suffixes, CloudWatch dashboard conditions, bootstrap placeholder handling.

8. **Deployment and code work stay in foreground.** Use the loop skill (cron) with 3-minute intervals to monitor long-running pipelines. Only read-only reviewers (`code-reviewer`, `sprint-reviewer`) may be dispatched as subagents. Background agents lose the context thread and miss real-time ECS service events.

9. **ECS ALB deployments exceed `aws ecs wait` 10-minute timeout.** The built-in wait command has a hard 10-minute limit that cannot be extended. ALB target deregistration delay (300 seconds per target) causes multi-region deployments to exceed this. Use custom poll loops checking the ECS deployment `rolloutState` field every 30 seconds for up to 15 minutes.

---

## Slash Commands

- **`/cello-read`** — Use at session start. Loads current project state without reading everything.
- **`/cello-sprint M4`** — Implementation briefing for a milestone. For M4+, loads adapter/observability context.
- **`/cello-story`** — Write new user stories. Enforces E2E-first ordering and observability ACs.
- **`/cello-review STORY-ID`** — Review a completed implementation. Verifies AC coverage, SI coverage, observability implementation, fixture discipline, gate sequence.
- **`/cello-link`** — Run after adding or modifying documents. Wires new files into the vault graph via wikilinks.
- **`/cello-chat`** — Enter a CELLO peer-to-peer conversation session. Update after each milestone.

---

## Discussion Log Conventions

Filename: `docs/planning/discussion_logs/YYYY-MM-DD_HHMM_short-slug.md`

Required frontmatter: `name`, `type: discussion`, `date`, `topics`, `description`.

Run `/cello-link` after committing.
