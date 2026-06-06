# CELLO — Claude Code Guide

## What This Project Is

CELLO is a peer-to-peer identity and trust layer for agent-to-agent communication: split-key signing (FROST), tamper-evident hash chains, and prompt-injection defense — without trusting a centralized platform.

**CELLO is a federated system with sovereign nodes.** Every directory node runs in a different geographic region, independently. Nodes are distributed across cloud providers (AWS, GCP, Azure) for resilience, but there are only three cloud providers and many regions — multiple nodes will share a cloud provider, just never a region. When Andre says "add a node," he means add a node in a new region. There is no reason to run two nodes in the same region — if the region goes down, both go down, which defeats the entire purpose. Do not make assumptions that default to single-region scaling patterns. Every infrastructure, cost, and architecture decision must be evaluated through the lens of: one node = one region = one independent deployment.

**Sovereign node invariant — non-negotiable.** Directory nodes are sovereign by design. Their independence serves three distinct purposes that must all be preserved simultaneously:

- **Security** — no single node can complete a threshold ceremony alone. A compromised node cannot forge signatures. Any implementation that allows a single node to produce a valid ceremony output is a security violation, regardless of whether tests pass.
- **Redundancy** — the client tolerates node failures. If a node is unreachable, the client falls back to others. The threshold is specifically designed to survive node outages. Any implementation that assumes all nodes are always available, or that silently fails when a node is down rather than routing around it, violates this invariant.
- **Choice** — operators are not locked to a single cloud provider or region. The client selects from available nodes. Any implementation that introduces provider-specific networking, hardcodes endpoints, or makes cross-provider deployment impossible violates this invariant.

**Availability and fallback are first-class protocol concerns, not operational nice-to-haves.** Health checks, manifest polling, failover logic, and graceful degradation are load-bearing features. Deferring them is not acceptable. An implementation that works only when all nodes are healthy is incomplete.

`docs/planning/` is an **Obsidian vault** — the primary design record. All architectural decisions and discussion logs live here.

---

## Required Reading

**Read `CONTEXT.md` at the repo root before any implementation work.** Canonical glossary — terms, package structure, interface contracts. Using terms not defined there is a bug.

---

## Repository Structure

CELLO is split across two repositories:

- **`trustless-cello`** (`/Users/andrep/Documents/code/trustless-cello`) — directory node, relay node, infrastructure (CloudFormation/IaC), operations agent, e2e tests, CI/CD pipelines. This is the server-side and infrastructure repo.
- **`cello-client`** (`/Users/andrep/Documents/code/cello-client`) — protocol core (`core/client`), cryptography (`core/crypto`), transport (`core/transport`), and all adapters (`core/adapter-claude-code`, etc.). This is what operators install and run locally.

Stories that touch both repos (e.g. a protocol change that requires a directory update AND a client update) require worktrees in both repos. The workflow creates them automatically. Never assume a change is confined to one repo until you have read both sides.

---

## The Client Is a Heavy Local Node — Not a Thin Wrapper

Most MCP servers are thin wrappers around an HTTP API: they receive a tool call, make an HTTP request, return the result. Upgrading the server is transparent to the client — operators notice nothing.

**cello-mcp is fundamentally different.** It is a locally-installed protocol node that runs on the operator's machine and contains:
- Cryptographic operations (Ed25519 signing, FROST ceremony participation)
- A libp2p transport layer with persistent peer identity
- A local SQLite database (SQLCipher) holding key shares, session state, and conversation history
- FROST share state tied to specific directory nodes

This has consequences that must be understood before making any implementation decision:

- **Process lifecycle is the operator's concern.** cello-mcp is a long-running process that holds a SQLite write lock. Orphan processes compete for the lock and corrupt ceremony state. There is no server-side process manager cleaning this up.
- **Install time and install size matter.** Operators wait for `npm install` on every version bump. A dependency that compiles from source adds 20-40 seconds to every install. This is a user-facing cost, not an abstract metric.
- **Upgrades are not transparent.** A breaking protocol change requires every operator to upgrade their local binary before they can communicate with updated peers. There is no server-side rollout. Compatibility is a bilateral contract between client versions.
- **Database migration is client-side.** Schema changes to the local SQLite DB must be applied on the operator's machine. Migrations that fail silently or corrupt existing data are unrecoverable without manual intervention.
- **Patterns for stateless HTTP wrappers do not apply.** If an implementation decision feels natural for a thin HTTP-wrapper MCP server, pause and ask whether it still makes sense for a stateful local process with crypto, a DB, and a persistent network identity.

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

## Infrastructure Rules — Non-Negotiable

**Read `infra/CLAUDE.md` before any infrastructure work.** It contains detailed rules for CloudFormation, deploy.sh, SSM parameters, and ECS configuration. The following are the most critical:

**Never create AWS resources manually that CloudFormation should manage.** Manual creation causes `ResourceAlreadyExists` failures on the next deploy.sh run. If emergency creation is necessary, import it into the CFN stack or delete it before the next deploy.

**deploy.sh is the only deployment mechanism for CFN stacks.** CI/CD pipelines only swap Docker images — they do NOT deploy CloudFormation. Any change to `infra/cloudformation/*.yaml` requires running deploy.sh.

**Every migration story must update `cello-ssm-parameters.yaml`.** When adding a new `V{N}` Flyway migration, update the `OpsAgentExpectedMigrationVersion` default value to `{N}`. Failure to do this causes the ops-agent to crash-loop on fresh deployments.

**Transport keys are unique per region.** Never copy a transport key between regions. Generate fresh values with `openssl rand -hex 32`.

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

**Directory deploys take ~1 hour.** A single directory deploy = 3 sequential regions (us-east-1 → eu-central-1 → ap-northeast-1), each ~20-25 minutes. Total realistic time: 60-75 minutes from push to all-regions-live. Never trigger a directory deploy without batching ALL pending directory changes into a single commit first. Shipping fixes one at a time multiplies the cost by the number of fixes.

---

## Operational Discipline — M5 Rules

These rules are extracted from the M5 retrospective (`docs/planning/discussion_logs/2026-05-25_1100_m5-retrospective-lessons-learned.md`). They are mandatory, not optional.

### Migration Integrity

1. **Thoroughly assess schema requirements before writing the migration.** The FEDERATION-002 incident wasn't caused by modifying V18 — it was caused by FEDERATION-001 shipping V18 incomplete. When FEDERATION-002 discovered the missing UNIQUE constraint, V18 was already applied and parallel stories had claimed V20/V21/V22. Extracting to V20 forced renumbering cascades. Rule: during the Architecture phase, validate the schema design against all stories that will use it. If a migration is incomplete, the cost isn't local — it's borne by every downstream story. Never modify an applied migration; but more importantly, get it right the first time.

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

## npm Publishing — @cello-protocol/connect

**NEVER run `npm publish`.** Use `pnpm publish` via CI only. `npm publish` ships raw `workspace:*` specifiers → broken package → version burned forever.

**How to publish — full version bump procedure:**

When changing code in any `core/*` package, bump ALL affected packages AND update dependency versions:

1. Identify which packages have changed (e.g. `core/crypto`, `core/client`, `core/adapter-claude-code`)
2. Bump the version in each changed package's `package.json`
3. Update the dependency version in every package that depends on the changed ones:
   - `core/client` depends on `core/crypto` — update `@cello-protocol/crypto` version in client's deps
   - `core/adapter-claude-code` depends on `core/client` and `core/crypto` — update both
4. Run `pnpm install` to update `pnpm-lock.yaml`
5. Commit all changes
6. `git tag v{connect-version}` then `git push origin v{connect-version}`
7. CI handles: build → typecheck → lint → test → tarball checks → `pnpm publish`

**Example:** changing `core/crypto` and `core/client`:
- crypto: 0.0.4 → 0.0.5
- client: 0.0.8 → 0.0.9, and update `"@cello-protocol/crypto": "0.0.5"` in client's dependencies
- connect: 0.0.16 → 0.0.17, and update both `"@cello-protocol/client": "0.0.9"` and `"@cello-protocol/crypto": "0.0.5"` in connect's dependencies

**Dist-tags:** CI publishes everything to `beta`. Promotion to `latest` is manual: `npm dist-tag add @cello-protocol/connect@X.Y.Z latest`. Only do this after explicit user approval.

**After every publish, verify:**
```bash
npm view @cello-protocol/connect@beta dependencies --json
# Must show real versions (0.0.X), NEVER "workspace:*"
```

**To update a local install**, pin the exact version:
```
claude mcp remove cello
claude mcp add cello -- npx --yes @cello-protocol/connect@0.0.11
```

**Never tell users to run `npx clear-npx-cache`.** It wipes every npx-installed tool. Pinning a new version is sufficient.

**`claude mcp add` syntax:** Use `--` to separate claude's flags from npx's flags, otherwise `--yes` is misinterpreted.

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
