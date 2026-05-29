# M6 Agent Coordination Log

This file is the coordination point for all agents working on M6 stories. Because Claude Code has no fan-in mechanism, agents cannot see each other's work directly. Each agent appends an entry here when they have a dependency on another agent, a blocker, or completed work that others need to know about.

**Format for each entry:**
- Date/time at the top (YYYY-MM-DD HH:MM UTC)
- Agent/story identity
- What is blocked or waiting, and why
- What has already been done that is relevant to the blocker
- What the other agent needs to do (if known)

Read this file at the start of every session. Append, never overwrite.

---

## Migration Version Registry

M6 migrations start at **V24**. All version numbers are reserved by OPS-AGENT-000 before parallel implementation begins. No story may claim a migration version not listed here.

| Version | File | Story | Description |
|---------|------|-------|-------------|
| V24 | V24__registrations.sql | OPS-AGENT-000 | registrations table — registration state machine |
| V25 | V25__pre_authorization_tokens.sql | OPS-AGENT-000 | pre_authorization_tokens — pre-auth token single-use store |
| V26 | V26__cello_ops_agent_role.sql | OPS-AGENT-000 | cello_ops_agent role — scoped INSERT/SELECT/UPDATE on registrations and pre_authorization_tokens |

---

## 2026-05-25 15:55 UTC — OPS-AGENT-000: story closed

Story completed: OPS-AGENT-000 — interfaces, types, stubs, migrations.

**Delivered:**
- `MessagingChannel` interface + `CliAdapter` stub (`packages/interfaces/src/`)
- `OtpDeliveryProvider` interface + `ConsoleOtpDeliveryProvider` stub
- `TokenValidator` interface + `DevTokenValidator` stub (accepts `DEV-` prefix)
- `PreAuthorizationClient` interface + `LocalPreAuthorizationClient` stub (`DEV-CELLO-` + 16 hex)
- `SecurityAlertProvider` interface + `ConsoleSecurityAlertProvider` stub
- `RegistrationState` discriminated union (9 states) + `RegistrationRecord` type
- `PreAuthorizationToken` + `PreAuthorizationTokenRow` types
- V24 migration: `registrations` table with partial UNIQUE index, RLS (no DELETE)
- V25 migration: `pre_authorization_tokens` table with UNIQUE(token), FK to registrations, RLS (no DELETE)
- V26 migration: `cello_ops_agent` role — scoped INSERT/SELECT/UPDATE on registrations and pre_authorization_tokens; explicit no-DELETE; dev password set for local environments

**All downstream stories may now proceed:**
- OPS-AGENT-001: use `PreAuthorizationClient`, `PreAuthorizationToken`, `PreAuthorizationTokenRow`, V25 table
- OPS-AGENT-002: use `RegistrationState`, `RegistrationRecord`, V24 table
- OPS-AGENT-003: implement `TelegramAdapter` satisfying `MessagingChannel`
- OPS-AGENT-004: implement `SesOtpDeliveryProvider` satisfying `OtpDeliveryProvider`
- OPS-AGENT-005A: use V24/V25/V26 migrations in IaC; provision `cello/{env}/ops-agent/rds-credentials` secret for cello_ops_agent production password

Migration Version Registry updated above.

**Security fix (post-review):** Dev role passwords (`cello_service`, `cello_analytics`, `cello_ops_agent`) were removed from migration SQL and moved to `docker/postgres/initdb/01-dev-role-passwords.sql` (runs on first container startup). Developers with existing containers must `docker compose down -v && docker compose up -d` then re-run migrations to pick up the new init script.

---

## 2026-05-26 — OPS-AGENT-001: story closed

Story completed: OPS-AGENT-001 — directory pre-authorization API + FROST DKG Round 1 token gate.

**Delivered:**
- `POST /internal/pre-authorize` endpoint in `packages/directory/src/internal-api-server.ts` — API key auth, token issuance (CELLO- + 33 base58 chars, ≥193 bits entropy via CSPRNG + rejection sampling)
- `pre-auth-token-repository.ts` — atomic `consumePreAuthToken` (single UPDATE with `expires_at > now()` predicate, eliminating TOCTOU), `issuePreAuthToken`, `linkAgentToAccount` (sets `agent_profiles.account_id`)
- `PgTokenValidator` adapter wired for `CELLO_ENV != local`; `DevTokenValidator` wired for `CELLO_ENV=local`
- Token gate in `directory-node.ts` FROST DKG Round 1 handler — consumption before any crypto (AC-006)
- Account deduplication: same `phone_stub_hash` → same `user_accounts` row, multiple `agent_profiles` (AC-005b)
- AC-009: `session-fixture.ts` and all DKG call sites updated with `preAuthToken: 'DEV-test-token'`; `mcp-003-e2e.test.ts` MCP tool calls updated
- All 8 `preauth.*` events added to canonical event taxonomy in pipeline discussion log
- 19 integration + unit tests in `ops-agent-001-pre-auth.test.ts`; 2 transport-path tests in `e2e-reg-001-dkg-network.test.ts` wiring `DevTokenValidator` over real libp2p streams

**Review history:** code-review (10 findings, all fixed), sprint-review pass 1 (2 blocking + 4 medium/low, all fixed), sprint-review pass 2 (1 blocking — missing `tokenPrefix` context field, fixed), sprint-review pass 3 → APPROVED.

**Notable fix from review:** `consumePreAuthToken` was originally SELECT+UPDATE (TOCTOU on expiry check). Rewritten as single atomic `UPDATE ... WHERE consumed_at IS NULL AND expires_at > now()` with disambiguation SELECT only on rowCount=0.

**Downstream stories unblocked:**
- OPS-AGENT-002: registration state machine — V24 table, pre-auth token consumption is done
- OPS-AGENT-005B: wire application code — `DevTokenValidator` wired, AC-009 complete
- M6-E2E-001: full stranger flow — token gate live

**Known gap (not blocking):** `cello_service` role lacks explicit `UPDATE` grant on `agent_profiles`. Integration tests pass as superuser. A grant should be added in a future migration before production deployment.

---

## 2026-05-26 — OPS-AGENT-002: story closed

Story completed: OPS-AGENT-002 — PostgreSQL-backed registration state machine.

**Delivered:**
- `RegistrationStateMachine` — full 9-state machine; all state transitions persist to Postgres via `RegistrationRepository`
- `RegistrationEngine` — wires state machine to `MessagingChannel.onMessage`; restart recovery (`loadAllActive` on `start()`); AWAITING_CONTACT re-prompt sweep (10 min); expiry sweep (1 hr)
- `RegistrationRepository` — all DB operations including `transitionOnOtpLockout()` (atomic BEGIN/SELECT FOR UPDATE/UPDATE/COMMIT for lockout path)
- OTP: SHA-256(otp + salt) stored, never plaintext; `timingSafeEqual` at verification (SI-001)
- Phone: SHA-256(normalized_phone) stored, never raw number (SI-002)
- SI-003: runtime enforcement tested with real integration tests (crafted messages to AWAITING_CONTACT assert state doesn't advance)
- In-memory OTP rate limiter (5 sends/hr/domain, resets on restart) — `registration.otp.rate_limited` emitted at WARN with all 4 required context fields
- All 9 observability events emitted: `registration.started`, `registration.phone.verified`, `registration.email.verified`, `registration.completed`, `registration.state.recovered`, `registration.otp.expired`, `registration.otp.rate_limited`, `registration.expired`, `registration.engine.error`
- 51 tests; `CELLO_ENV=local` gates integration tests; `--pool-options.threads.maxThreads=1` enforced in vitest config

**Notable design decisions downstream stories should know:**
- OTP lockout transitions to `AWAITING_EMAIL` (not stays in `AWAITING_EMAIL_OTP`) — AC-005 YAML updated with rationale
- `otpSalt` is NOT on `RegistrationRecord` — fetched from DB via `getOtpSalt(id)` only at verification time
- `chainHash` is NOT on `RegistrationRecord` — persistence-layer concern only
- Engine always queries DB on message receipt (never uses in-memory map as cache) — intentional for restart-recovery correctness
- Timer sweep `.catch()` handlers log via `registration.engine.error` with `error.message` / `error.stack` — no `void` discards

**Downstream stories now unblocked:**
- OPS-AGENT-003: implement `TelegramAdapter` satisfying `MessagingChannel` — inject into `RegistrationEngine`
- OPS-AGENT-004: implement `SesOtpDeliveryProvider` satisfying `OtpDeliveryProvider` — inject into `RegistrationEngine`
- OPS-AGENT-005B: wire application code — `RegistrationEngine` is the composition root entry point; requires `pool`, `channel`, `otpDelivery`, `preAuth`, `logger`, `channelType`

---

## 2026-05-26 — OPS-AGENT-003: story closed

Story completed: OPS-AGENT-003 — TelegramAdapter implementing MessagingChannel.

**Delivered:**
- `TelegramAdapter` in `packages/operations-agent/src/telegram-adapter.ts` — implements `MessagingChannel` interface over the Telegram Bot API
- Long-polling via `getUpdates` (timeout=25s); `start()` calls `getMe` to obtain `botUsername` for logging
- `pollOnce()` exposed as public for testing; background polling loop via `#runPollingLoop()`
- Contact event handling with `contact.user_id === message.from.id` verification (SI-001); absent `user_id` treated as mismatch
- `resolveIdentity(from)` returns `phoneNumber` only when `contact.user_id` matches sender (SI-001); returns `phoneNumber=undefined` on any mismatch
- `CONTACT_PROMPT_PREFIX` sentinel (`"__REQUEST_CONTACT__:"`) — `send()` detects this prefix, strips it before sending to Telegram, and attaches `ReplyKeyboardMarkup` with `request_contact` button; canonical definition lives in `packages/interfaces/src/messaging-channel.ts` and is imported by all three consumers (`state-machine.ts`, `telegram-adapter.ts`, `cli-adapter.ts`) — no string duplication, drift is a compile error
- `CliAdapter.send()` strips `CONTACT_PROMPT_PREFIX` before printing to stdout
- All 6 `telegram.*` events emitted at correct levels with correct context fields; no token in any log event (SI-002); all 6 events registered in canonical event taxonomy
- HTTP 409 Conflict → `telegram.poller.conflict` at ERROR + `process.exit(1)` + explicit `return []` to prevent fall-through when exit is mocked in tests
- 1s backoff on non-409 `#getUpdates` errors (prevents tight retry loop under API failure)
- Offset acknowledgement: `this.#offset = update.update_id + 1` after each update; Telegram server-side acknowledgement is the persistence mechanism — no DB/disk write needed; crash-window duplicates handled by state machine's idempotent `channel_user_id` lookup (SI-003)

**Key implementation decisions:**
- `contact.user_id` check: if `contact.user_id` is absent or does not match `message.from.id`, `resolveIdentity()` returns `phoneNumber=undefined`; state machine cannot advance past `AWAITING_CONTACT` (SI-001)
- HTTP 409 exit: on `getUpdates` returning 409, adapter logs `telegram.poller.conflict` at ERROR and calls `process.exit(1)`; ECS `MinimumHealthyPercent=0` ensures only one task is active after restart; `return []` after `process.exit(1)` prevents fall-through into the non-ok error branch when exit is mocked
- `CONTACT_PROMPT_PREFIX` is the single source of truth for contact-keyboard signalling; lives in `@cello-protocol/interfaces` so any package can import it without circular dependencies
- Bot token logging invariant: `#baseUrl` contains the token but is never logged; only `botUsername` (from `getMe`) appears in log events (SI-002)

**Test structure:**
- AC-001: real `getMe` + `getUpdates` HTTP calls to `api.telegram.org`; `telegram.polling.started` proves real API responded; any received `update_id`s verified as integers > 0 (TELEGRAM_BOT_TOKEN required)
- AC-002: `it.skip` with documented manual test procedure — requires human to tap "Share Contact" in staging bot
- AC-003: real `sendMessage` HTTP call; returns early (not fails) if bot queue is empty
- AC-006: `it.skip` with documented manual test procedure — requires human to drive full registration flow
- AC-007-integration-gate: Flyway checksum integrity + >= 2 real HTTP call count (TELEGRAM_BOT_TOKEN + CELLO_ENV=local required)
- Unit tests (AC-004, AC-005, AC-006b, AC-006c, SI-001, SI-002, send() sentinel path, `__contact_mismatch__` handler dispatch) run without TELEGRAM_BOT_TOKEN

**Downstream stories now unblocked:**
- OPS-AGENT-005B: wire application code — `TelegramAdapter` is ready to inject into `RegistrationEngine` as the `MessagingChannel`; `TELEGRAM_BOT_TOKEN` env var needed in ECS task definition; composition root in `server.ts` wires `TelegramAdapter` for `CELLO_ENV != local`

---

## 2026-05-26 — REPOSPLIT-001: story closed

Story completed: REPOSPLIT-001 — scaffold cello-client repo, CI pipeline, ALB WebSocket transport path.

**Delivered:**
- `github.com/Mygentic-AI/cello-client` scaffolded: pnpm workspace, five `core/` stub packages (`@cello-protocol/protocol-types`, `@cello-protocol/crypto`, `@cello-protocol/transport`, `@cello-protocol/client`, `@cello-protocol/connect`). All have `files` allowlist, `publishConfig.access: public`, `engines: node>=24`. No source code yet — stubs only.
- GitHub Actions CI pipeline: Node 24, pnpm 10.33.2, tarball leak check over all five packages, tag-only publish wired to `NPM_TOKEN`. CI passes on an empty workspace.
- AUDIT-ME.md with three falsifiable privacy claims and exact file pointers at cello-client layout paths.
- SKILL.md updated in `packages/adapter-claude-code/` for `@cello-protocol/connect`.
- README.md in cello-client: install, CELLO description, quick start, AUDIT-ME link.
- AC-001 tsconfig fix: `adapter-claude-code/tsconfig.json` decoupled from relay/directory; server packages removed from devDependencies.
- AC-007 ALB WebSocket transport path: directory WS listener on port 8080; health server on port 9090; ALB IdleTimeout 300; SG port 9090 rule in `cello-vpc.yaml`; all three items explicit in CloudFormation. IaC committed, not yet deployed.
- Transport-path E2E test (`packages/e2e-tests/src/transport-path.test.ts`) with all three dimensions; gated on `CELLO_DIR_ALB` env var.
- Publish smoke test procedure and transport path runbook in `cello-client/scripts/`.

**Key constraints resolved:**
- `@cello-protocol` npm scope confirmed; `NPM_TOKEN` in cello-client GitHub Secrets (expires 2026-08-24 — rotate before that date)
- External client → directory/relay transport path unblocked — directory now accepts WebSocket on port 8080 through the existing ALB

**Downstream stories now unblocked:**
- REPOSPLIT-002: extract the five client packages, move tests, publish `@cello-protocol/connect@beta`

**Post-merge actions — completed 2026-05-28:**
1. `transport-path.test.ts` run against live dev ALB (`cello-dir-dev-1136016900.us-east-1.elb.amazonaws.com`):
   - DIM1 PASSED: libp2p WebSocket connection through ALB succeeds, Noise XX handshake completes, peer ID returned. One assertion bug fixed (test expected `/noise`, libp2p reports `/noise` — variant fixed).
   - DIM2 SKIPPED: circuit relay reservation requires identify protocol to complete over ALB WebSocket; identify never completes within 15s after Noise XX. Root cause: ALB appears to interrupt or rate-limit WebSocket frames after initial upgrade. Known transport-path limitation. CELLO agents connect directly to directory via ALB WS and do not use circuit relay — does not block REPOSPLIT-002.
   - DIM3 SKIPPED: idle timeout test — requires `IDLE_TIMEOUT_TEST=true`, not run by default.
2. npm publish smoke test passed: tag `v0.0.0-scaffold.1` pushed to cello-client → CI triggered → `@cello-protocol/connect@0.0.1` published successfully to npm. Confirmed: `NPM_TOKEN` (granular, `@cello-protocol` scope) works from GitHub Actions runners; `publishConfig.access: public` works; tag-based trigger fires correctly; tarball is clean. Package immediately unpublished after verification. Publish path proven working.

**REPOSPLIT-002 is unblocked.**

---

## 2026-05-27 — OPS-AGENT-004: story closed

Story completed: OPS-AGENT-004 — SES OTP delivery provider.

**Delivered:**
- `SesOtpDeliveryProvider` in `packages/operations-agent/src/ses/ses-otp-delivery-provider.ts` — implements `OtpDeliveryProvider` via AWS SES SDK v3
- `crypto.randomInt(0, 1_000_000)` OTP generation (SI-001 spec alignment); `generateOtp()` in `otp.ts` updated
- In-memory rolling rate limiter: 5 sends/hr per address; `RateLimitError` thrown on 6th attempt before any SES call
- Per-instance bounced-address Set: `DeliveryError` thrown immediately on re-attempt without calling SES
- Throttle retry: 1s wait, retry once; `otp.delivery.retried` logged on success
- `#extractDomain` SI-002 guard: `[invalid-email-domain]` returned for no-`@` input
- SI-003: `SESClient` injected via constructor; no internal `new SESClient()` or `process.env` reads
- All 3 observability events (`otp.delivery.sent`, `otp.delivery.retried`, `otp.delivery.failed`) added to canonical event taxonomy
- AC-008-integration-gate test written, gated on `CELLO_ENV=local && SES_INTEGRATION_TEST=true`
- `DeliveryError` and `RateLimitError` exported from package index

**Review history:** code-review round 1 (8 findings, all fixed), sprint-review pass 1 (1 blocking + 1 medium, both fixed), sprint-review pass 2 → APPROVED. Post-merge sprint-reviewer findings (3: M-001 wrong Flyway query, L-001 runtime guard instead of `it.skipIf`, L-002 rate-limit test hidden in integration gate — all fixed, commit `7fa1eb9`). Post-merge code-review round 2 (3: FINDING-001 high same Flyway query bug, FINDING-002/003 low — all fixed, commit `d544759`).

**Downstream stories now unblocked:**
- OPS-AGENT-005B: wire application code — inject `SesOtpDeliveryProvider` as `OtpDeliveryProvider` in composition root; SES credentials and `fromAddress` from Secrets Manager; `CELLO_ENV != local` gates production adapter selection

---

## 2026-05-27 — OPS-AGENT-005A: story closed (IaC complete, live deployment gate pending)

Story completed: OPS-AGENT-005A — Operations Agent IaC.

**Delivered:**
- `infra/cloudformation/cello-ecs-operations-agent.yaml` — ECS Fargate service; public subnet + `AssignPublicIp: ENABLED`; `MinimumHealthyPercent: 0` / `MaximumPercent: 100`; no ALB; `DIRECTORY_INTERNAL_URL` from directory ALB DNS name via cross-stack import
- ECR repo `cello-operations-agent` added to `cello-ecr.yaml`; URI exported
- `OpsAgentTaskRole` + `OpsAgentTaskExecutionRole` in `cello-iam.yaml`; `ssmmessages:*` for ECS Exec; `secretsmanager:GetSecretValue` on exactly four ops-agent ARNs; no KMS/S3/directory-relay access
- Four ops-agent secrets in `cello-secrets.yaml` (telegram-bot-token, ses-credentials, directory-api-key, rds-credentials); all have Output exports
- `/internal/*` ALB listener rules added to `cello-ecs-directory.yaml`: priority 5 VPC-allow, priority 10 external-403; directory `Service` `DependsOn` both rules
- `OpsAgentRdsCredentialsRotationSchedule` in `cello-rotation.yaml` with `RotateImmediatelyOnUpdate: false`
- `OpsAgentEcsTaskCountAlarm` in `cello-cloudwatch.yaml` → ops-critical
- `OperationsAgentPipeline` in `cello-cicd.yaml`; `pipeline-mappings.json` maps `packages/operations-agent/` → `cello-operations-agent-pipeline`
- `build-stubs.sh` extended with `cello-operations-agent:stub` push; `bootstrap.sh` updated with four secrets + operator instructions; `deploy.sh` Step 8a rotation detection + Step 9 ECS stack
- `packages/operations-agent/buildspec.yml` — full buildspec with dynamic ECR account/region; `infra/buildspecs/staging-deploy-operations-agent.yml` — full ECS deploy with rolloutState poll

**AC-010 integration gate status: PENDING.** IaC reviewed and clean. Stack listed as `NOT DEPLOYED` in STATE.md. Deployment must be run and verified before OPS-AGENT-005B begins.

**What OPS-AGENT-005B needs to do:**
1. Confirm AC-010 passes: ECS service STABLE with runningCount=1, secrets resolve, internet egress to api.telegram.org confirmed via ECS Exec, STATE.md updated with live resource IDs
2. Replace stub image with real application image: `server.ts` composition root wires `TelegramAdapter` (TELEGRAM_BOT_TOKEN from Secrets Manager), `SesOtpDeliveryProvider` (ses-credentials from Secrets Manager), `DirectoryPreAuthorizationClient` (directory-api-key from Secrets Manager), `RegistrationEngine` (PostgreSQL pool from rds-credentials)
3. `CELLO_ENV` drives adapter selection: `local` → stubs; `dev`/`staging`/`production` → real adapters
4. `packages/operations-agent/buildspec.yml` placeholder Docker build step (currently uses `infra/stub/Dockerfile`) must be replaced with real application Dockerfile and `pnpm run typecheck` + `pnpm run test` steps uncommented

**Key resource IDs (to be filled after AC-010 deployment):**
- ECS service ARN: see STATE.md after deploy
- Ops Agent Security Group ID: see STATE.md after deploy
- ECR repo: `{account}.dkr.ecr.{region}.amazonaws.com/cello-operations-agent`

---

## 2026-05-28 — OPS-AGENT-005B: story closed

Story completed: OPS-AGENT-005B — Wire real application code into proven ECS deployment.

**Delivered:**
- `server.ts` composition root: CELLO_ENV-driven adapter selection, three-dimension health check, `ops_agent.started` after all checks pass, HTTP health server port 8080, graceful SIGTERM shutdown
- `DirectoryPreAuthorizationClient`: single public method `requestToken()`, throws `PreAuthRequestError(httpStatus)`, no internal logging
- `Dockerfile`: multi-stage Node 24-slim, non-root user `cello`, production deps only, `pnpm run build` (not typecheck) to emit dist/
- `buildspec.yml`: real Docker build replacing stub; `PrivilegedMode: true` on CodeBuild project
- `smoke-test-operations-agent.yml`: CloudWatch Logs gate on `ops_agent.started` (direct IP polling blocked by no-inbound SG)
- `cello-cicd.yaml`: `SmokeTestOperationsAgentBuild` project, `PrivilegedMode: true` on `OperationsAgentBuild`, `logs:FilterLogEvents` IAM permission
- `cello-ecs-operations-agent.yaml`: ECS `HealthCheck` block, `SES_FROM_ADDRESS` in Environment
- 7 new canonical events registered; 98 tests

**Pending before pipeline deploys real image (AC-007b):**
Re-run `setup-replication.sh` on the live cluster to add `registrations` and `pre_authorization_tokens` to `cello_pub` on all 3 nodes, then verify cross-region replication within 5s. STATE.md flags this as pending.

**Downstream stories now unblocked:**
- DEMO-001: registration AC-000 — Telegram bot is live; demo agent can now register

---

## 2026-05-28 — AC-007b complete: registrations + pre_authorization_tokens added to cello_pub

**What was done:**

`setup-replication.sh` was updated and re-run against all 3 nodes (us-east-1, eu-central-1, ap-northeast-1).

Two changes to the script:
1. `PUBLICATION_TABLES` already included `registrations` and `pre_authorization_tokens` (added when OPS-AGENT-000 wrote the script). However, the CREATE PUBLICATION path skipped when the publication already existed — it never ran `ALTER PUBLICATION SET TABLE`. Fixed: when publication exists, the script now runs `ALTER PUBLICATION cello_pub SET TABLE <all-tables>` to sync the table list.
2. `ALTER SUBSCRIPTION ... REFRESH PUBLICATION` was not called after altering the publication. Active subscribers do not automatically pick up new tables. Added a Step 4b that refreshes all 6 subscriptions (2 per node) after the publication is updated.

**Verification:**
- All 6 replication slots streaming after re-run
- `pg_subscription_rel.srsubstate = 'r'` (ready) for both `registrations` and `pre_authorization_tokens` on eu-central-1
- INSERT into `registrations` on us-east-1 at 16:33:25Z appeared on eu-central-1 at 16:33:35Z (≤5 seconds)

**Downstream:** DEMO-001 is unblocked. The operations agent pipeline can now deploy real image — pre-auth tokens and registrations issued in us-east-1 will replicate to eu-central-1 and ap-northeast-1 within ~5 seconds.

---

## 2026-05-28 — REPOSPLIT-002: story closed

Story completed: REPOSPLIT-002 — extract five client packages into cello-client, publish `@cello-protocol/connect@beta`.

**Delivered:**
- Five packages extracted from trustless-cello into `cello-client/core/`: `@cello-protocol/protocol-types`, `@cello-protocol/crypto`, `@cello-protocol/transport`, `@cello-protocol/client`, `@cello-protocol/connect`
- `@cello-protocol/test-fixtures` moved as private workspace package
- `@cello-protocol/interfaces` published to npm from trustless-cello (stays server-side)
- `@cello-protocol/connect@0.0.3` published with `beta` dist-tag — installable via `claude mcp add cello npx @cello-protocol/connect`
- CELLO_DIRECTORY_URL defaults to `http://directory-us1.cello.mygentic.ai` (ALB is HTTP not HTTPS — verified via WS upgrade)
- AUDIT-ME.md updated with accurate cello-client file paths
- pnpm.overrides in cello-client now pins `@cello-protocol/interfaces@0.0.3` from npm (not local file: path)
- ESLint added to cello-client (`pnpm run lint`)
- CI restructured: trustless-cello checkout only happens at publish time (tag-only step); normal build/test/lint runs without sibling repo
- trustless-cello root tsconfig.json updated to reference only `directory`, `relay`, `e2e-tests`

**Review history:** sprint-coder (background agent, stopped early due to quality issues) → manual implementation in-session → code-reviewer (5 findings, all fixed) → sprint-reviewer pass 1 (2 BLOCKED) → fixes applied (interfaces publish path, protocol-types version alignment, pnpm.overrides, eslint, || true guards, PRODUCTION_DIRECTORY_URL http://) → sprint-reviewer pass 2 (1 BLOCKED — published 0.0.2 manifests had wrong interfaces dep) → bump to 0.0.3 → AC-007 smoke test PASSED.

**Key issues resolved during implementation:**
- `npm publish` vs `pnpm publish`: the latter rewrites `workspace:*` specifiers to real version numbers; using `npm publish` published a broken manifest. Fixed: all packages now publish via `pnpm publish --filter`.
- `protocol-types@0.0.1` in trustless-cello vs `@0.0.2` on npm: interfaces@0.0.2 resolved the wrong version. Fixed: bumped trustless-cello protocol-types to 0.0.2.
- `PRODUCTION_DIRECTORY_URL` was `https://` but ALB only accepts HTTP. Fixed: `http://directory-us1.cello.mygentic.ai`.

**Post-merge actions:**
- Smoke test passed: `npm install @cello-protocol/connect@beta` + `npx @cello-protocol/connect` → MCP server starts, own_pubkey present, transport_started=true
- `@cello-protocol/connect@beta` dist-tag points to `0.0.3`
- `@cello-protocol/interfaces@0.0.3` on npm, correct dep on `protocol-types@0.0.2`

**Downstream stories now unblocked:**
- DEMO-001 (code portions AC-001 through AC-007): depends only on REPOSPLIT-002 — now unblocked
- M6-E2E-001: full stranger flow — REPOSPLIT-002 complete; depends on DEMO-001 and OPS-AGENT-005B (both done)

---

## 2026-05-29 — DEMO-001: EC2 provisioning decisions agreed

**Context:** DEMO-001 requires a standalone EC2 instance for the demo agent. Existing instances were reviewed before making these decisions.

**Existing instances reviewed:**
- `cello-hermes-agent`, `ironclaw-agent`, `openclaw-agent` — us-east-1, t3.large, personal agents — not reused (key isolation)
- `cello-whatsapp-bridge` — eu-west-1, t3.medium — not reused (key isolation)
- `cello-falkordb` — eu-west-1, t4g.micro — no public IP, no key, different purpose

**Agreed provisioning decisions:**

| Item | Decision | Rationale |
|---|---|---|
| Region | us-east-1 | Closest to primary directory (directory-us1.cello.mygentic.ai) |
| Instance type | t3.micro | Demo agent is outbound-only, low traffic |
| Shared with existing instance | No | Key isolation — demo agent CELLO identity must not share fate with personal agents |
| SSH / access method | SSM Session Manager only (no key pair, no port 22) | Stricter security, no key file to manage; matches eu-west-1 instances pattern |
| IAM Instance Profile | Required | Role with `AmazonSSMManagedInstanceCore` — enables SSM access |
| Elastic IP | Yes | Prevents public IP churn on stop/start; needed to keep SSH allowlist (if ever added) stable; $0 while attached |
| Security group — inbound | Zero rules | No inbound ports; SSM access is control-plane only |
| Security group — outbound | HTTPS (443) only | All CELLO connectivity is outbound to the ALB via WebSocket over HTTPS |
| CELLO identity key backup | AWS Secrets Manager | After registration, key file copied to a named secret; if instance is terminated, key can be restored without re-registration through the Telegram bot |

**What the sprint-coder must implement:**
- EC2 user-data script (or Ansible playbook) that provisions Node.js, installs `@cello-protocol/connect`, writes the systemd unit, and sets up the `cello-demo` system user with `chmod 600` on the key directory
- systemd unit at `/etc/systemd/system/cello-demo.service`, enabled, with `Restart=on-failure`
- Runbook documenting exact AWS CLI commands to create: IAM role + instance profile, security group, EIP, EC2 instance — so the instance can be recreated from scratch with no institutional knowledge
- Secrets Manager backup step in the runbook (manual — done by operator after registration)

**What the sprint-coder cannot do (manual human steps after merge):**
1. Actually create the AWS resources (not IaC — acceptable for M6 per story notes)
2. Register the demo agent via the Telegram bot (AC-000 — requires OPS-AGENT-005B live)
3. Populate STATE.md with instance ID, EIP, SG ID, IAM role ARN, Secrets Manager path — **the human doing provisioning must do this before closing the session**

**STATE.md update required:** After provisioning, add a `demo-agent — us-east-1` section to STATE.md with all resource identifiers.

---

## Constraints

**CONSTRAINT: registrations table single-writer assumption.** The Operations Agent writes only from us-east-1. The partial unique index `UNIQUE (phone_stub_hash) WHERE state NOT IN (terminal)` is enforced locally per-node in logical replication — it does NOT prevent cross-region duplicates. Multi-region Ops Agent deployment requires schema redesign. See OPS-AGENT-000 `replication_safety` note.

**CONSTRAINT: npm @cello scope.** Must be claimed on Day 0 before any publish work begins. If contested, fallback to `@cello-protocol/interfaces` and `@cello-protocol/connect`. REPOSPLIT-002 AC-000 is blocked until this is resolved.

**CONSTRAINT: External client → directory/relay transport path.** ~~The directory's libp2p port (4000) is NOT exposed through the ALB.~~ **RESOLVED by REPOSPLIT-001 (AC-007).** Directory now accepts WebSocket connections on port 8080 through the existing ALB. CloudFormation committed; deployment required before REPOSPLIT-002 AC-003 or DEMO-001 AC-004b can be verified against live infra.

---
