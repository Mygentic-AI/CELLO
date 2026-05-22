# M5 Agent Coordination Log

This file is the coordination point for all agents working on M5 stories. Because Claude Code has no fan-in mechanism, agents cannot see each other's work directly. Each agent appends an entry here when they have a dependency on another agent, a blocker, or completed work that others need to know about.

**Format for each entry:**
- Date/time at the top (YYYY-MM-DD HH:MM UTC)
- Agent/story identity
- What is blocked or waiting, and why
- What has already been done that is relevant to the blocker
- What the other agent needs to do (if known)

Read this file at the start of every session. Append, never overwrite.

---

## 2026-05-22 15:30 UTC — SECOPS-001 agent

**Story completed:** SECOPS-001 (S3AuditLogShipper) — merged to `main`, pushed to `origin/main` at commit `7e37f5b`.

**Blocking issue found during deployment — not caused by SECOPS-001:**

The `cello-directory-pipeline` CodeBuild build is failing on `pnpm install --frozen-lockfile` with this error:

```
[ERR_PNPM_OUTDATED_LOCKFILE] Cannot install with "frozen-lockfile" because
pnpm-lock.yaml is not up to date with packages/adapter-claude-code/package.json

Failure reason:
The importer resolution is broken at dependency "@claude-flow/testing":
version "3.0.0-alpha.6" doesn't satisfy range "*"
```

This was already broken before SECOPS-001 landed — it is a pre-existing lockfile mismatch in `packages/adapter-claude-code/`. SECOPS-001 did update `pnpm-lock.yaml` (the `@aws-sdk/client-s3` dependency), but the root cause is `@claude-flow/testing` version `3.0.0-alpha.6` not satisfying the `"*"` range in `adapter-claude-code/package.json`.

**What needs to happen:**

Whoever owns `packages/adapter-claude-code/` (likely the agent working on DEPLOY-002 or DEPLOY-003, which builds the real Docker image) needs to fix this before any pipeline can pass. The fix is one of:

1. Run `pnpm install` locally in the repo root (no `--frozen-lockfile`) to regenerate `pnpm-lock.yaml` with the correct resolution for `@claude-flow/testing`, then commit the updated lockfile.
2. Or update `adapter-claude-code/package.json` to pin `@claude-flow/testing` to exactly `3.0.0-alpha.6` instead of `"*"`, then regenerate the lockfile.

**What SECOPS-001 still needs after the lockfile is fixed:**

Once the pipeline passes, `deploy.sh dev us-east-1` should be run to update the `cello-cicd-dev` CloudFormation stack — this makes the `CELLO_AUDIT_BUCKET=cello-audit-logs-dev-us-east-1` env var permanent in the `DirectoryBuild` CodeBuild project (it was applied manually via AWS CLI as a temporary measure; the IaC fix is in the SECOPS-001 merge commit but the stack has not been re-deployed yet).

**No other deployment steps required for SECOPS-001** — this story adds no new CloudFormation resources. The S3 bucket, IAM roles, and ECS cluster all exist from DEPLOY-001A.

---

## 2026-05-22 — SECOPS-004 agent

**Story completed:** SECOPS-004 (Credential Rotation, ACM Auto-Renewal, and Key Generation) — merged to `main`, deployed to dev/us-east-1. All stacks CREATE_COMPLETE. Stack count is now 12.

**Waiting on: DEPLOY-004**

DEPLOY-004 needs to add a build/deploy stage to the CI/CD pipeline that packages and deploys `infra/lambda/rds-rotation/handler.py` to AWS whenever that path changes.

**Why:**

The `cello-dev-rds-rotation` Lambda is live in AWS but running inline placeholder code that raises `NotImplementedError`. The real handler exists at `infra/lambda/rds-rotation/handler.py`. CloudFormation intentionally deployed the placeholder — the CFN template explicitly states the CI/CD pipeline is responsible for updating the function code post-deploy.

Until DEPLOY-004 adds this stage and it runs once, SECOPS-004's AC-002 (trigger rotation, verify new credential authenticates against RDS) and AC-003 (ECS picks up new credential without task restart) cannot be verified.

**Background DEPLOY-004 needs:**

- Lambda function name: `cello-${ENVIRONMENT}-rds-rotation` (e.g. `cello-dev-rds-rotation`)
- Source path: `infra/lambda/rds-rotation/handler.py`
- Runtime: Python 3.12
- Dependency: `psycopg2-binary` — must be bundled in the deployment zip or provided as a Lambda layer
- The function is already fully configured (VPC, env vars, IAM role, Secrets Manager invoke permission) — only the function code needs to be updated
- Deploy command pattern: `aws lambda update-function-code --function-name cello-${ENV}-rds-rotation --zip-file fileb://rotation.zip`
- Pipeline trigger: when `infra/lambda/rds-rotation/` changes in the repo

**Impact if not done:**

The 30-day automated rotation will fire and fail with `NotImplementedError`. The `rds-credentials` secret will not rotate — a security compliance gap against SI-001 (30-day rotation requirement).

---

## 2026-05-22 18:30 UTC — FEDERATION-001 agent

**Story completed:** FEDERATION-001 (Federation schema migration and session ownership enforcement) — merged to `main` at commit `9ac5186`. Worktree and branch deleted.

**No deployment step required for this story.** FEDERATION-001 is application code + a Flyway migration (V18). The migration runs automatically when the ECS directory tasks next start (Flyway runs at startup). No `deploy.sh` call needed.

**What was delivered:**

- `packages/directory/db/migrations/V18__federation_schema.sql` — creates the `sessions` table (`session_id UUID NOT NULL UNIQUE`, `owning_node_id TEXT NOT NULL`, `chain_hash TEXT NOT NULL`); adds `mmr_peaks`, `identity_merkle_root`, `checkpoint_hash`, `coordinator_node_id` to `directory_checkpoints`; completes the `checkpoint_node_signatures` stub with `checkpoint_id UUID NOT NULL FK`, `node_id TEXT NOT NULL`, `node_signature TEXT NOT NULL`, `signed_at TIMESTAMPTZ NOT NULL`.
- `PgDirectoryStore`: `writeSession` (with SI-001 application-layer ownership pre-check), `getSessionOwner`, `verifyReplicatedRow` (throws on hash mismatch so callers can halt replication), `verifyPgTypes` (queries a DATE literal to catch multi-region type parser misconfiguration at startup).
- `DirectoryStore` interface: 3 new methods wired through to `InMemoryDirectoryStore` stubs.
- `hash-chain.ts`: `signed_at` added to `ALWAYS_EXCLUDED_FROM_CHAIN`.
- 620-line integration test suite. All local-testable ACs pass. Six `describe.skip` stubs document deferred E2E work.

**Waiting on: FEDERATION-E2E-001 (future story)**

The following ACs from FEDERATION-001 cannot be tested in the Docker Compose local environment. They are deferred to `CELLO-FEDERATION-E2E-001`, which must provision a two-node RDS environment with PostgreSQL logical replication:

- AC-003: replicated row appears on node-2 within 5 seconds
- AC-004: non-owning node does not write hash chain entries for a session it doesn't own
- AC-007: chain entry count frozen after owning node stops
- AC-010: `pg_stat_replication` shows two active slots per node, lag under 10s
- SI-002: replication slot naming convention (`cello_{env}_{source}_{target}`)
- SI-003: `cello_replication` role has REPLICATION privilege only (requires the role to exist — see SECOPS-004 or FEDERATION-001A for provisioning)

The `describe.skip` stubs in `packages/directory/src/__tests__/federation-001.test.ts` are ready to enable once the multi-node test environment exists.

**Dependency on DEPLOY-004 (pipeline must pass for V18 to reach ECS):**

SECOPS-001's entry above documents a pnpm lockfile mismatch breaking CodeBuild. Until that is resolved, the `cello-directory-pipeline` cannot build and push a new image, so V18 will not reach the ECS tasks. FEDERATION-001 itself has no additional pipeline dependency beyond what SECOPS-001 already described.
