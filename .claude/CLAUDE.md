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

**⏳ Deferred — M8B Sprint B (registration availability). Do not lose these.** Sprint A shipped quorum registration on 2026-07-04 (register among the available directories, not all-N; kill a node → registration still succeeds). Still owed:
- **Threshold policy — OPEN DECISION (Andre):** registration uses `T = majority(N)`, which lets a bare majority of *directory operators alone* forge a signature offline (the old all-N code required every directory). Inherent to any T<N (§9's "10-of-15" accepts it). One-line change to tighten (`ceil(2N/3)` or `N-1`). **It is baked into every agent that registers — decide before real agents register at scale.**
- **Enrollment (Problem 3):** a node that was down/absent during a DKG holds **no share** and can't co-sign for that agent until it gets one via a *resharing ceremony* (shares are secret, never replicated). Needs a signed "may-enroll" credential each holder verifies independently — mirror the pre-auth capability pattern.
- **Absent-node reconcile:** a node that stayed up but wasn't in the quorum should pick up an agent's identity from replication into memory without a restart (today the in-memory profile cache only loads at boot).
- **Optional hardening:** FROST binds a slot to a public label, not node identity — a stolen decrypted share works on any node (possession = authority). Add FROST-stream identity auth + slot→identity binding for defense-in-depth.

Full plan, findings, and trail: `docs/planning/user-stories/m8b/2026-07-04_0556_tofn-registration-availability-quorum-enrollment-plan.md`.

---

## Required Reading

**Read `CONTEXT.md` at the repo root before any implementation work.** Canonical glossary — terms, package structure, interface contracts. Using terms not defined there is a bug.

---

## Quick Commands

**Gate sequence (run in order before every commit):**
```bash
pnpm run test
pnpm run lint
pnpm run typecheck
pnpm run build
```

**Local dev (requires Docker):**
```bash
docker compose up -d          # Start Postgres
CELLO_ENV=local pnpm run dev  # Start directory or relay locally
```

**Check published package versions:**
```bash
npm view @cello-protocol/connect@beta version
npm view @cello-protocol/client@beta version
```

**Demo agent (EC2 us-east-1, instance `i-0ad3e7c22470f266e`):**
```bash
# Run a command on the demo agent instance
CMD_ID=$(aws ssm send-command --instance-ids i-0ad3e7c22470f266e \
  --document-name AWS-RunShellScript --region us-east-1 \
  --parameters '{"commands":["YOUR COMMAND"]}' --output text --query 'Command.CommandId')
sleep 5 && aws ssm get-command-invocation --command-id $CMD_ID \
  --instance-id i-0ad3e7c22470f266e --region us-east-1 \
  --query 'StandardOutputContent' --output text

# Proper restart sequence — daemon must be ready before demo connects
systemctl stop cello-demo && systemctl stop cello-daemon && sleep 2
systemctl start cello-daemon && sleep 5 && systemctl start cello-demo
```

---

## Repository Structure

CELLO spans five repositories:

- **`trustless-cello`** (`/Users/andrep/Documents/code/trustless-cello`) — directory node, relay node, infrastructure (CloudFormation/IaC), operations agent, e2e tests, CI/CD pipelines. This is the server-side and infrastructure repo.
- **`cello-client`** (`/Users/andrep/Documents/code/cello-client`) — protocol core (`core/client`), cryptography (`core/crypto`), transport (`core/transport`), and all adapters (`core/adapter-claude-code`, etc.). This is what operators install and run locally.
- **`cello-portal`** (`/Users/andrep/Documents/code/cello-portal`) — the operator-facing portal web app (Next.js). Where registered users manage their agent, connections, and settings.
- **`corp-cello-site`** (`/Users/andrep/Documents/code/corp-cello-site`) — the public-facing corporate/marketing site for CELLO and Mygentic AI (Next.js + Tailwind).

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

**Directory deploys take ~25-30 minutes.** All 3 regions (us-east-1, eu-central-1, ap-northeast-1) deploy in parallel. Total wall-clock time: 25-30 minutes from push to all-regions-live (ALB deregistration delay reduced to 30s in M6B-007). Never trigger a directory deploy without batching ALL pending directory changes into a single commit first. Shipping fixes one at a time multiplies the cost by the number of fixes.

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

## Debugging Discipline — Non-Negotiable

These rules exist because the opposite patterns have repeatedly cost days of investigation. They are mandatory, not suggestions.

### The Four Failure Modes to Avoid

**1. Error messages are not root causes.** An error string describes where the failure surfaced, not why it happened. `transport_unavailable`, `directory_unreachable`, `relay_auth_error` — these are labels on the exit point. The cause is upstream. Never treat an error message as an explanation. Always ask: what produced this error, what did it check, what returned false or threw?

**2. The first log line that looks suspicious is rarely the cause.** Logs from failing systems are full of noise and downstream symptoms. A thrown exception at line 449 does not mean line 449 is broken — it means a precondition set earlier was wrong. Chase the precondition, not the throw site.

**3. Narrating a hypothesis as fact is the default failure mode.** The moment an agent says "the relay stream has closed or timed out" from a single error message, it has committed to a hypothesis and will filter all subsequent evidence through it. All you know is what the error message says. State that and nothing more until you have evidence.

**4. Analyze in terms of producers and consumers.** Every object, method, or value in a failure path has a producer (who sets it, initializes it, populates it) and a consumer (who reads it, checks it, fails on it). When something is missing or wrong, trace both directions: who should have produced this, and did they? That is the correct diagnostic frame — not "what does this line do?"

### Required Diagnostic Protocol

When investigating a failure:

1. State only what the evidence shows. "Error X was returned" — not "X happened because Y."
2. Map the failure path as a numbered flow: what called what, what checked what, what returned what.
3. Identify the specific precondition that was violated — not the line that threw.
4. Trace the producer of that precondition: who sets it, when, under what conditions.
5. State explicitly what you cannot prove from code alone, and what additional evidence would resolve it.
6. Only after steps 1–5: propose a hypothesis, marked as a hypothesis.

Do not propose a fix until the hypothesis is stated and the producer/consumer chain is mapped.

### Before implementing any fix — mandatory falsification step

Before writing a single line of code, attempt to prove the fix is wrong. Specifically:

1. Does the proposed call site have access to the required method? Check the interface, not just the class. A method that exists on a class is not available to a caller that holds a context interface — verify the interface exposes it.
2. Does the fix location match where responsibility actually lives? The reconnect path is the reference implementation. If the initial path and reconnect path diverge, ask why — the divergence may be intentional.
3. Would the fix create redundancy? If the caller sets a value and the method now also sets it, one of them is wrong about where responsibility lives.
4. What breaks if this fix is applied? Test the fix mentally against at least one other call site.

Only after failing to falsify: propose the fix and state which falsification attempts you made.

### Demo agent: standing receiver is the first suspect

When a live session fails (`standing_receiver_unavailable`, empty `counterparty_session_peer_id`,
`Invalid peer ID: ""`), check for `session.node.created` in the daemon log before tracing code.
The standing receiver is created only when `cello_start_agent` reaches the daemon — not at startup.

Healthy daemon startup sequence:
`agent.signaling.created` → `directory.signaling.connected` → `agent.online` → `session.node.created`

If `agent.online` is absent, `cello_start_agent` never reached this daemon instance (stale socket
from a simultaneous restart). Fix: stop both services, start daemon, wait 5s, start demo.

### When asked to "prove it"

Format the proof as a numbered flow. Include:
- The consume path (what fails and why, step by step)
- The produce path (what should have set the precondition, and whether it did)
- The gap (exactly where the producer failed to produce)
- What you cannot prove from code alone

---

## npm Publishing — @cello-protocol/connect

**Always run `/cello-publish` before publishing.** The skill at `trustless-cello/.claude/commands/cello-publish.md` is the authoritative procedure. Do not publish from memory or from the prose below — the skill supersedes this section.

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

## Cross-Repo Dependency Management — Non-Negotiable

CELLO is split across two repos. `trustless-cello` (server-side) depends on packages published from `cello-client`. The five packages that originate in `cello-client` are:

- `@cello-protocol/crypto`
- `@cello-protocol/transport`
- `@cello-protocol/protocol-types`
- `@cello-protocol/client`
- `@cello-protocol/connect`

**`workspace:*` references to cello-client packages in trustless-cello are a bug.** `workspace:*` resolves to the local copy in the pnpm workspace. After REPOSPLIT-002, the local copies in `trustless-cello/packages/crypto/`, `packages/transport/`, etc. are stale and no longer maintained. Using `workspace:*` means directory and relay run against old code silently. There is no type error. Tests pass. The bug is invisible until something breaks in production.

**The correct reference format is a pinned semver range:**
```json
"@cello-protocol/crypto": "^0.0.7",
"@cello-protocol/transport": "^0.0.4",
"@cello-protocol/protocol-types": "^0.0.3",
"@cello-protocol/client": "^0.0.20"
```

**Interfaces stays local.** `@cello-protocol/interfaces` is maintained in `trustless-cello` and is the only package that remains as `workspace:*` — it is not a cello-client package.

**Before any story that changes cello-client packages:**

1. Check the current published versions on npm: `npm view @cello-protocol/crypto@beta version` (and transport, protocol-types, client, connect).
2. The story's ACs must include an explicit version bump AC: "After implementation, `@cello-protocol/connect` is bumped to `X.Y.Z` in cello-client, tagged, and published to beta. `trustless-cello/packages/directory/package.json` and `trustless-cello/packages/relay/package.json` are updated to reference the new versions. `pnpm install` is run to update the lockfile."
3. Never write a story that changes cello-client behavior without also specifying the version bump and the trustless-cello package.json update as blocking ACs.

**Dead pipelines (cleanup pending):** `cello-crypto-pipeline`, `cello-transport-pipeline`, `cello-client-pipeline`, `cello-protocol-types-pipeline` in `cello-cicd.yaml` still watch `packages/crypto/`, `packages/transport/` etc. in trustless-cello. These paths are stale post-REPOSPLIT — no code changes will ever land there. These pipelines trigger on ghost changes and waste CI resources. They must be removed from `cello-cicd.yaml` and from `pipeline-mappings.json`, and `deploy-lambdas.sh dev filter` must be run after.

---

## Slash Commands

- **`/cello-read`** — Use at session start. Loads current project state without reading everything.
- **`/cello-sprint M4`** — Implementation briefing for a milestone. For M4+, loads adapter/observability context.
- **`/cello-story`** — Write new user stories. Enforces E2E-first ordering and observability ACs.
- **`/cello-review STORY-ID`** — Review a completed implementation. Verifies AC coverage, SI coverage, observability implementation, fixture discipline, gate sequence.
- **`/cello-link`** — Run after adding or modifying documents. Wires new files into the vault graph via wikilinks.
- **`/cello-chat`** — Enter a CELLO peer-to-peer conversation session. Update after each milestone.

---

## Compaction Protocol

When Andre says "prepare for compaction" or "compact following the compaction protocol", produce
three artifacts in this order:

**1. Follow-through document — MANDATORY, non-negotiable.**

You CANNOT rely on `/compact` to preserve the details the next context needs. The lossy summary
drops exact state, decisions, IDs, and rationale. Before compacting, you MUST have a committed,
human-readable document that a fresh context can read cold and immediately be productive. This is
not optional — no follow-through doc means no compaction.

For milestone work, the build journal serves this role — but you must verify it is fully current
(latest entry reflects actual live state, nothing is left uncommitted). For non-milestone work,
write a dedicated follow-through doc (e.g. `docs/planning/discussion_logs/YYYY-MM-DD_HHMM_slug.md`)
with: what is done, what is next, decisions made and why, exact IDs/hashes/versions, and any
standing background machinery (crons, watchdogs). Commit it before running `/compact`.

**2. Compaction directive for `/compact`.** Four sections:
- **KEEP VERBATIM** — facts the lossy summary must not paraphrase (branch/commit hashes, exact IDs, live status, standing rules)
- **SUMMARIZE BRIEFLY** — background that can point to docs instead of being re-derived
- **DISCARD** — turn-by-turn dialogue, intermediate tool output, resolved back-and-forth
- **Follow-on instruction** — one paragraph: what the next context should do first

**3. Post-compaction kickoff prompt.** Must always open with the three implementation pillars by
full path — the milestone **PROCEDURE**, **DEFINITION-OF-DONE**, and the **latest BUILD-JOURNAL
entry** — then the follow-through doc by path + section, and a first verification step.

Good compact moments: a section/part is complete, reviewers have run, about to move to something
new. Never mid-task.

---

## Discussion Log Conventions

Filename: `docs/planning/discussion_logs/YYYY-MM-DD_HHMM_short-slug.md`

Required frontmatter: `name`, `type: discussion`, `date`, `topics`, `description`.

Run `/cello-link` after committing.
