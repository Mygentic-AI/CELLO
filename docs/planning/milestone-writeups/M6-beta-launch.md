---
name: M6 — Beta Launch
type: design
date: 2026-05-26
topics: [milestone, M6, beta-launch, operations-agent, registration, onboarding, telegram, SES, OTP, pre-authorization, database-roles, reposplit, npm-publish]
status: in-progress
description: M6 write-up — CELLO beta launch. Installable @cello-protocol/connect npm package, Telegram registration bot, and end-to-end stranger flow.
---

# M6 — Beta Launch

**Started:** 2026-05-26
**Stories closed:** OPS-AGENT-000, OPS-AGENT-001, OPS-AGENT-002, OPS-AGENT-003, OPS-AGENT-004, REPOSPLIT-001, OPS-AGENT-005A, OPS-AGENT-005B, REPOSPLIT-002, PERSIST-024, DEMO-001
**Stories open:** M6-E2E-001

**Unblocked by OPS-AGENT-002:** OPS-AGENT-003 (Telegram adapter), OPS-AGENT-004 (SES OTP delivery), OPS-AGENT-005B (wire app code)

**Unblocked by REPOSPLIT-001:** REPOSPLIT-002 (extract packages + publish @cello-protocol/connect@beta)

**Unblocked by OPS-AGENT-005A:** OPS-AGENT-005B (wire application code into proven ECS deployment)

**Unblocked by OPS-AGENT-005B:** DEMO-001 (registration AC-000 — bot live in production)

---

## OPS-AGENT-000 — Interface Contracts, Types, Stubs, and Schema Design

Design-and-contract story. No runtime behavior. Establishes the stable interfaces all downstream M6 stories implement against.

**Delivered:**
- 6 TypeScript interfaces in `packages/interfaces/src/`: `MessagingChannel`, `OtpDeliveryProvider`, `TokenValidator`, `PreAuthorizationClient`, `SecurityAlertProvider`, `RegistrationState` discriminated union (9 states) + `RegistrationRecord`
- 5 local stubs in `packages/interfaces/src/stubs/` — zero external dependencies, zero constructor args, usable at `CELLO_ENV=local` with no secrets or AWS credentials
- `PreAuthorizationToken` + `PreAuthorizationTokenRow` types; production token format: `CELLO-` + 33 base58 chars (≥193 bits entropy); dev stub format: `DEV-CELLO-` + 16 hex chars
- `packages/operations-agent/` package scaffold (`@cello-protocol/operations-agent`) — downstream stories implement into this package
- V24 migration: `registrations` table, partial UNIQUE index (active registrations only), chain_hash column, RLS (INSERT/SELECT/UPDATE for both `cello_service` and `cello_ops_agent`; no DELETE on either)
- V25 migration: `pre_authorization_tokens` table, UNIQUE(token) for atomic single-use, FK to registrations
- V26 migration: `cello_ops_agent` PostgreSQL role — scoped to V24/V25 tables only; `GRANT USAGE ON SCHEMA public` required (and present); explicitly denied access to `agent_profiles`, `sessions`, and all key material tables
- `infra/setup-replication.sh` PUBLICATION_TABLES updated to include `registrations` and `pre_authorization_tokens`

**Bugs found during review cycle:**

### 1. `GRANT USAGE ON SCHEMA public` missing from V26
**Symptom:** AC-007b "SELECT on registrations succeeds" assertion would have failed — PostgreSQL denies all queries with `42501: permission denied for schema public` when a role lacks schema USAGE, even if table-level grants are present.
**Fix:** Added `GRANT USAGE ON SCHEMA public TO cello_ops_agent` to V26 before the table grants.
**Rule:** Schema USAGE is a prerequisite for all table access. Table grants alone are insufficient. Every new role needs it explicitly.

### 2. Plaintext dev passwords in migration SQL (V2, V7, V26)
**Symptom:** `PASSWORD 'cello_service_dev'` was in V2 (git-tracked since M4). V26 added the same pattern for `cello_ops_agent`.
**Fix:** Removed PASSWORD clauses from V2, V7, V26. Created `docker/postgres/initdb/01-dev-role-passwords.sql` — sets all three dev passwords on first container startup via Docker initdb hook. Production passwords set by rotation Lambda only.
**Rule:** Never put credentials in migration SQL. Migrations are tracked in git and applied to production via Flyway. Dev passwords belong in the Docker init layer; production passwords belong in Secrets Manager.

### 3. `generateProductionToken` used `.slice(-33)` instead of `.slice(0, 33)`
**Symptom:** The entropy test's reference token generation silently dropped the high-order character when the base58-encoded string exceeded 33 chars. The test still passed (format regex matched, no duplicates), but the reference algorithm was wrong.
**Fix:** Changed to `.slice(0, 33)`. This is the algorithm OPS-AGENT-001 will copy for production token generation — getting it wrong here would have propagated.
**Rule:** When a test implements a reference algorithm that production code will copy, treat it as production code. The test passing doesn't validate the algorithm's correctness.

### 4. `RegistrationRecord` missing `emailDomain` field
**Symptom:** OPS-AGENT-001 and OPS-AGENT-002 both need `emailDomain` to call `requestToken(phoneStubHash, emailDomain)`. The field was in the database schema but not surfaced in the application-layer type.
**Fix:** Added `emailDomain: string | null` to `RegistrationRecord`.

### 5. AC-011 (`packages/operations-agent/` scaffold) and AC-012 (PUBLICATION_TABLES) not delivered in initial commit
Both were in the story YAML but missed in the initial implementation. The sprint-reviewer caught both as blocking findings.
**Rule:** Read the full story YAML before implementing. AC-011 and AC-012 were clearly specified — missing them was a reading failure, not an ambiguity.

---

## OPS-AGENT-001 — Directory Pre-Authorization API + FROST DKG Round 1 Token Gate

Implementation story. Adds the pre-authorization token lifecycle to the directory: issuance via an internal HTTP API, and mandatory consumption at the FROST DKG Round 1 handler. After this story, an agent cannot complete registration without a valid token issued by the Operations Agent after phone+email verification.

**Delivered:**
- `POST /internal/pre-authorize` endpoint (`packages/directory/src/internal-api-server.ts`) — API key authentication, issues `CELLO-` + 33 base58 chars (≥193 bits entropy)
- `packages/directory/src/pre-auth-token-repository.ts` — token generation, atomic consumption, account deduplication (`linkAgentToAccount` now sets `agent_profiles.account_id`)
- `PgTokenValidator` adapter (`packages/directory/src/adapters/pg-token-validator.ts`) — wired for `CELLO_ENV != local`; `DevTokenValidator` wired for `CELLO_ENV=local`
- Token gate in `directory-node.ts` FROST DKG Round 1 handler — consumption before any crypto
- Account deduplication: same `phone_stub_hash` → same `user_accounts` row, multiple `agent_profiles`
- AC-009: `session-fixture.ts` and all DKG call sites updated with `preAuthToken: 'DEV-test-token'`; `mcp-003-e2e.test.ts` MCP tool calls updated — prevents the "47 failing tests" failure pattern from the M5 retrospective
- All 8 `preauth.*` events registered in the canonical event taxonomy

**Review cycle:** code-review (10 findings), sprint-review pass 1 (2 blocking, 4 medium/low), sprint-review pass 2 (1 blocking), sprint-review pass 3 → APPROVED.

**Bugs found during review cycle:**

### 1. Token entropy — `slice(0, 33)` truncated from the high-entropy end
**Symptom:** Base58 encoding of 25 random bytes frequently produces 34–35 characters. `digits.slice(0, 33)` discards the most-significant (leftmost) characters, reducing effective entropy below 193 bits for the majority of random inputs. The test in OPS-AGENT-000's reference implementation used `slice(0, 33)` and was wrong; the production code copied the same mistake.
**Fix:** Replaced with rejection sampling — loop generating 25 random bytes until the base58 encoding is exactly 33 characters. All outputs are then drawn from a uniform distribution over the full 58^33 space.
**Rule:** When a test's reference implementation will be copied into production, treat the algorithm's correctness as a production requirement. Format-regex tests don't catch entropy shortfalls.

### 2. `consumePreAuthToken` SELECT+UPDATE TOCTOU
**Symptom:** The function ran a SELECT to check `expires_at`, then a separate UPDATE without an `expires_at > now()` predicate. A token expiring between the SELECT and the UPDATE could still be successfully consumed (rowCount=1 returned as `ok: true`). The story's behavior spec explicitly described a single atomic UPDATE.
**Fix:** Rewrote as a single statement: `UPDATE ... SET consumed_at = now() WHERE token = $1 AND consumed_at IS NULL AND expires_at > now() RETURNING id, phone_stub_hash, email_domain`. Disambiguation SELECT runs only on rowCount=0.
**Rule:** When a spec says "atomic UPDATE," implement it as a single statement. SELECT+UPDATE is always a TOCTOU regardless of how fast the two round-trips are.

### 3. `parseDkgRound1Response` silently dropped `preauth_error` frames
**Symptom:** When the directory's token gate rejected a Round 1 frame, it sent a `preauth_error` typed frame. The client-side parser only recognized `frost_dkg_round1_response` frames — returning null for everything else. The caller threw a generic `"dkgRound1: invalid response"` with no rejection reason. Downstream stories relying on structured rejection reasons (PRE_AUTH_TOKEN_MISSING etc.) would have received an opaque error.
**Fix:** Extended the parser to handle `preauth_error` frames and propagate the structured `reason` field through `runNetworkDkg` and `client.register()`.
**Rule:** Every frame type the directory can send must be handled by the client parser. An unrecognized frame that returns null silently swallows structured errors.

### 4. AC-002 transport-path gap — gate code never exercised via real libp2p stream
**Symptom:** All tests called `validatePreAuthTokenForDkg` directly against the Postgres pool. No test wired `tokenValidator` into `createDirectoryNode` and sent a DKG Round 1 CBOR frame over the real `/cello/frost/1.0.0` libp2p stream. The gate code in `directory-node.ts`'s stream handler could have been deleted and every test would still pass.
**Fix:** Added `makeDirectoryInstanceWithValidator` helper in `e2e-reg-001-dkg-network.test.ts` wiring `DevTokenValidator`. AC-002a asserts DKG succeeds with a valid `DEV-` token over the real stream. AC-002b asserts the gate rejects a frame with no token, surfacing `PRE_AUTH_TOKEN_MISSING`.
**Rule:** "Integration test" means the full call path from the transport boundary, not just the database function. If the stream handler were a no-op, a test that only exercises the repository function would never catch it.

### 5. `linkAgentToAccount` accepted `agentProfileId` but never used it
**Symptom:** After calling `linkAgentToAccount`, `agent_profiles.account_id` remained NULL. The function created/found the `user_accounts` row and returned the `account_id`, but never executed `UPDATE agent_profiles SET account_id = $1`. The AC-005b test only checked `user_accounts` row count and did not catch the missing link.
**Fix:** Added `UPDATE agent_profiles SET account_id = $1 WHERE k_local_pubkey = $2` as the final step of `linkAgentToAccount`. Updated AC-005b test to assert `agent_profiles.account_id` is set to the correct UUID.
**Rule:** When a test verifies a side effect (account deduplication), it must also verify the primary effect (the FK link). Checking row count without checking the FK column leaves half the contract untested.

### 6. `#pendingPreAuthData` map leaked entries on failed DKG flows
**Symptom:** The map was cleaned up only at the account-linking step in `#processRegisterRequest`. Entries from agents that disconnected after Round 1, hit early-return error paths, or timed out were never evicted — a memory leak in a long-running server process.
**Fix:** Added `this.#pendingPreAuthData.delete(frame.k_local_pubkey)` at all six early-return and error-return paths, and in the DKG timeout handler.
**Rule:** Every map keyed by a per-connection or per-request identifier needs a cleanup path for every exit, not just the success path.

**Known gap (not blocking):** `cello_service` role lacks an explicit `UPDATE` grant on `agent_profiles`. Integration tests pass as superuser; the grant should be added in a future migration before production deployment of account linking.

---

## OPS-AGENT-002 — PostgreSQL-Backed Registration State Machine

Implementation story. The full registration ceremony driven by a state machine persisted to PostgreSQL on every transition. Survives process restarts. Delivers pre-authorization tokens after phone + email verification.

**Delivered:**
- `RegistrationStateMachine` — 9-state machine (INITIAL → AWAITING_CONTACT → PHONE_CONFIRMED → AWAITING_EMAIL → AWAITING_EMAIL_OTP → EMAIL_CONFIRMED → PRE_AUTH_TOKEN_ISSUED + EXPIRED + FAILED) in `packages/operations-agent/src/registration/state-machine.ts`
- `RegistrationRepository` — all Postgres mutations: `insert`, `transition`, `transitionOnOtpLockout`, `touchTimestamps`, `incrementOtpAttempt`, `findActiveByChannelUser`, `loadAllActive`, `findExpiredActive`, `getOtpSalt`; SHA-256 chain hash updated on every write
- `RegistrationEngine` — wires state machine to `MessagingChannel.onMessage`; periodic AWAITING_CONTACT re-prompt sweep (10 min); periodic expiry sweep (1 hr); restart recovery on `start()` via `loadAllActive`
- OTP: `generateOtp` (rejection sampling for uniform distribution), `hashOtp` / `verifyOtp` (SHA-256 + salt, `timingSafeEqual`), `generateOtpSalt` — plaintext never stored (SI-001)
- Phone: `normalizePhone` + `hashPhone` (SHA-256) — raw number never stored (SI-002)
- In-memory rate limiter: 5 OTP sends per email domain per hour, resets on restart (AC-009)
- All 9 observability events emitted at correct levels with all required context fields
- 51 tests across 4 test files; all integration tests require `CELLO_ENV=local` + real Postgres

**Review history:** code-review round 1 (14 findings, all fixed), sprint-review pass 1 (4 blocking — post-lockout dead end, SI-003 hollow tests, non-atomic lockout, COALESCE regression; all fixed), sprint-review pass 2 → APPROVED; code-review round 2 (11 findings, all fixed); code-review round 3 (7 findings, all fixed); sprint-review pass 3 → APPROVED (1 low — dead code); low finding cleaned up immediately.

**Bugs found during review cycle:**

### 1. Post-lockout dead end (AWAITING_EMAIL_OTP with cleared otpHash)
**Symptom:** After 3 incorrect OTP attempts, the implementation cleared `otp_hash` in the DB but left the record in `AWAITING_EMAIL_OTP`. The state machine's `#handleAwaitingEmailOtp` handler had no branch to accept an email address — the user was permanently stuck.
**Fix:** On lockout, transition to `AWAITING_EMAIL` (not stay in `AWAITING_EMAIL_OTP`). Implemented via `transitionOnOtpLockout()` — a single Postgres transaction (`BEGIN/SELECT FOR UPDATE/UPDATE/COMMIT`) that atomically clears OTP fields, resets attempt count, and sets `state = AWAITING_EMAIL`. Story YAML AC-005 updated to document the correct recovery state and rationale.
**Rule:** When invalidating a credential, always land in a state where the user can take action. A state with no valid input handler is a permanent dead end.

### 2. SI-003 tests were hollow — type-level assertions, not runtime enforcement
**Symptom:** The initial SI-003 tests asserted TypeScript type properties (`.state === "AWAITING_CONTACT"`). These tests would pass even if the state machine accepted crafted OTP input in `AWAITING_CONTACT` state — no code path was actually exercised.
**Fix:** Replaced with three real integration tests that send adversarial messages to a live engine against real Postgres and assert the DB state did not advance. Adversarial cases: (1) 6-digit OTP to `AWAITING_CONTACT`, (2) email address to `AWAITING_CONTACT`, (3) CONTACT event with mismatched `user_id`.
**Rule:** Security invariant tests must exercise the runtime path. Type-level assertions do not satisfy "even when a crafted message attempts to..." adversarial conditions.

### 3. `transition()` COALESCE regression — OTP columns never cleared on success path
**Symptom:** `transition()` used `COALESCE($value, column)` for OTP fields, so passing `NULL` (the default) preserved existing values. The EMAIL_CONFIRMED success path called `transition(id, 'EMAIL_CONFIRMED')` without clearing OTP fields — the verified OTP hash remained in the database after completion.
**Fix:** Added `clearOtp: boolean` flag to the `transition()` updates parameter. When `true`, OTP columns are set to `NULL` directly via `CASE WHEN $clearOtp THEN NULL ELSE COALESCE($val, col) END`, bypassing `COALESCE`.
**Rule:** When a DB helper uses `COALESCE` to preserve existing values, any path that requires an explicit clear must have an opt-out mechanism. Default-preserve is correct for most fields; credential fields need an explicit wipe on success.

### 4. Non-atomic lockout — crash window between `incrementOtpAttempt` and `transition`
**Symptom:** The lockout path called `incrementOtpAttempt(id, clearOtp=true)` then `transition(id, 'AWAITING_EMAIL_OTP')` as two separate DB round-trips. A crash between them left the record in `AWAITING_EMAIL_OTP` with a cleared `otp_hash` — the exact dead-end state from Bug 1, reachable via a timing window.
**Fix:** Replaced with `transitionOnOtpLockout(id)` — a single Postgres transaction that atomically clears OTP fields AND transitions state in one operation.
**Rule:** Any write that must appear as a single logical event to the application (credential clear + state transition) must be a single DB transaction. Two round-trips always have a crash window.

### 5. Timer sweep callbacks used `void` — unhandled rejection crashes Node.js 24
**Symptom:** `setInterval(() => { void this.#runExpirySweep(); }, ...)` discards the promise. In Node.js 24, an unhandled rejection in a timer callback terminates the process. Any DB error during a sweep (e.g. transient connectivity) would kill the Operations Agent.
**Fix:** Replaced `void` with `.catch()` handlers that log via `registration.engine.error` with `error.message` and `error.stack`.
**Rule:** Never discard promise results from timer callbacks. Always attach a `.catch()` that logs and swallows — or the first transient error kills the process.

### 6. Expiry check fired before null-hash check — wrong event emitted for cleared OTP
**Symptom:** `#handleAwaitingEmailOtp` checked `otpExpiresAt < now()` before checking `!otpHash`. A record in `AWAITING_EMAIL_OTP` with a cleared `otp_hash` (e.g. after DB repair) and an `otpExpiresAt` of `new Date(0)` would emit `registration.otp.expired` instead of the correct prompt to re-enter email.
**Fix:** Moved the `!otpHash` null-check to fire first, before the expiry check.
**Rule:** Guard against sentinel values before range checks. `new Date(0)` is always less than `now()` — a null/zero field will always trigger the wrong branch if the range check runs first.

### 7. OTP delivered before DB write — unverifiable OTP on delivery success + DB failure
**Symptom:** `sendOtp(email, otp)` was called before `repository.transition(id, 'AWAITING_EMAIL_OTP', { otpHash, ... })`. If the DB write failed after delivery, the user received a valid OTP but the system had no record of it — the user could never verify.
**Fix:** Moved `repository.transition()` to execute first. OTP delivery only proceeds after the DB write succeeds.
**Rule:** Write state before delivering credentials. If delivery fails after the write, the user can retry. If the write fails after delivery, the credential is unverifiable and the user is stuck.

### 8. `registration.started` logged after `transition()` — event lost on transition failure
**Symptom:** `registration.started` was emitted after both `repository.insert()` and `repository.transition(id, 'AWAITING_CONTACT')`. If `transition()` threw, the record existed in the DB (INITIAL state) with no corresponding log event — undetectable without a DB query.
**Fix:** Moved `logger.info("registration.started", ...)` to immediately after `repository.insert()` returns, before `repository.transition()`.
**Rule:** Emit observability events as close as possible to the state change they describe. If a subsequent operation can fail, the event should already be in the log.

---

## REPOSPLIT-001 — Scaffold cello-client Repo + ALB WebSocket Transport Path

Scaffolding story. No package source code moves. Establishes the cello-client repository structure, CI pipeline, operator-facing documentation, and clears the transport path for external clients before any extraction happens.

**Delivered:**

- **cello-client repo** (`github.com/Mygentic-AI/cello-client`): pnpm workspace with five `core/` stub packages (`@cello-protocol/protocol-types`, `@cello-protocol/crypto`, `@cello-protocol/transport`, `@cello-protocol/client`, `@cello-protocol/connect`). Each package has `package.json` (private: false, publishConfig.access: public, files allowlist, engines: node>=24) and `tsconfig.json`. No source code yet — stubs only.
- **GitHub Actions CI pipeline** (`.github/workflows/ci.yml`): Node 24, pnpm 10.33.2, steps install → build → typecheck → test (1 worker) → tarball leak check (all five packages) → publish (tag-only). `NPM_TOKEN` wired via `NODE_AUTH_TOKEN`. CI passes on a skeleton repo with no source files.
- **AUDIT-ME.md**: three verifiable privacy claims with exact file pointers at cello-client layout paths: (1) relay never sees plaintext, (2) K_local never leaves the process, (3) no telemetry. Each claim has a `Verify:` subsection naming 2–4 specific files.
- **SKILL.md** (trustless-cello `packages/adapter-claude-code/`): updated install command (`claude mcp add cello npx @cello-protocol/connect`), M6 tool examples (`cello_register`, `cello_send`, `cello_receive`, `cello_status`).
- **README.md** (cello-client): one-line install, 2–3 sentence CELLO description, quick start (register + send), link to AUDIT-ME.md. No monorepo references.
- **AC-001 tsconfig fix** (trustless-cello): `packages/adapter-claude-code/tsconfig.json` no longer references `../relay` or `../directory`; `exclude: ['src/__tests__']` added; `@cello-protocol/directory` and `@cello-protocol/relay` removed from devDependencies; server-dependent tests migrated to `packages/e2e-tests/`.
- **interfaces/package.json** (trustless-cello): `"private": true` removed, `"files": ["dist/", "package.json"]` added — publishable.
- **AC-007 transport path**: directory adds `/ip4/0.0.0.0/tcp/8080/ws` listener (`CELLO_DIRECTORY_WS_LISTEN_ADDR`); health server moved to port 9090; CloudFormation updated (`cello-ecs-directory.yaml`: health check port 9090, ALB `IdleTimeout: 300`, env var explicit in task definition; `cello-vpc.yaml`: port 9090 ingress rule added to `EcsDirectorySecurityGroup`). Transport-path E2E test (`packages/e2e-tests/src/transport-path.test.ts`) covers all three verification dimensions and is gated on `CELLO_DIR_ALB` env var — skips in CI, runs against live infra manually.
- **Publish smoke test procedure** (`scripts/publish-smoke-test.md`) and **transport path runbook** (`scripts/transport-path-runbook.md`) in cello-client.

**Review cycle:** code-review round 1 (2 critical, 3 high, 3 medium, 3 low — all fixed), sprint-review → APPROVED (2 medium, 2 low, all fixed), code-review round 2 (1 high — wrong CloudWatch log group in runbook, fixed).

**Bugs found during review cycle:**

### 1. ECS Directory security group missing port 9090 rule
**Symptom:** Health server moved from port 8080 to port 9090 (to free 8080 for WebSocket), but no SG rule allowed ALB health check probes to reach port 9090 on the ECS task. The target group would have been marked unhealthy immediately after deployment and the ECS service would fail to stabilise.
**Fix:** Added TCP 9090 ingress rule to `EcsDirectorySecurityGroup` in `cello-vpc.yaml`, scoped to the ALB security group.
**Rule:** Whenever a service port changes, audit every security group that controls access to it. Moving a health check port is not just a container config change — it is a network policy change.

### 2. `CELLO_DIRECTORY_WS_LISTEN_ADDR` absent from CloudFormation task definition
**Symptom:** The directory code defaulted to `/ip4/0.0.0.0/tcp/8080/ws` when the env var was absent — so it worked in practice but the intent was invisible in IaC. Setting the env var to `""` would silently disable the WS listener. A brand-new region deployment from the template would work but without any documented record of the WS listener's port or intent.
**Fix:** Added `CELLO_DIRECTORY_WS_LISTEN_ADDR: /ip4/0.0.0.0/tcp/8080/ws` explicitly to the ECS task definition environment block.
**Rule:** Every behaviour that is required for the service to function must be explicit in IaC, not dependent on a code default. "Works via default" fails the region-expansion test.

### 3. Wrong CloudWatch log group and service in transport-path runbook
**Symptom:** `scripts/transport-path-runbook.md` instructed operators to query `/cello/directory` for `relay.message.forwarded`. Two errors: (1) the actual directory log group is `/ecs/cello-directory-dev`; (2) `relay.message.forwarded` is a relay process event, not a directory event — the relay log group is `/ecs/cello-relay-dev`. An operator following the runbook would look in the wrong place and conclude the relay forwarding path was broken.
**Fix:** Corrected both occurrences to `/ecs/cello-relay-dev`.
**Rule:** When writing manual verification runbooks that reference AWS resource names, verify the names against STATE.md and the CloudFormation templates — do not write from memory.

**Infrastructure notes:**
- CloudFormation changes are committed and merged to main but not yet deployed. The directory ECS deployment will be triggered by the CI/CD pipeline after the next push to origin.
- After the deployment stabilises, run `transport-path.test.ts` against the live ALB to verify all three dimensions of AC-007.
- Push tag `v0.0.0-scaffold.1` to cello-client to execute the AC-008 publish smoke test; unpublish/deprecate immediately after confirming NPM_TOKEN works.

---

## OPS-AGENT-003 — TelegramAdapter: MessagingChannel over Telegram Bot API

Implementation story. Delivers the Telegram transport layer for the Operations Agent registration bot. The `TelegramAdapter` implements the `MessagingChannel` interface and drives the existing `RegistrationEngine` (OPS-AGENT-002) over the real Telegram Bot API. After this story, the registration bot can receive `/start` commands and phone contact events from real Telegram users.

**Delivered:**
- `TelegramAdapter` (`packages/operations-agent/src/telegram-adapter.ts`) — `MessagingChannel` implementation over the Telegram Bot API via long-polling (`getUpdates`, timeout=25s)
- `start()`: calls `getMe` to obtain `botUsername`; logs `telegram.polling.started` at INFO; optionally starts background polling loop
- `pollOnce()`: one `getUpdates` cycle; exposed as public for testing; advances `this.#offset = update_id + 1` after each update; 1s backoff on non-409 errors
- Contact event handling: `contact.user_id === message.from.id` check (SI-001); absent `user_id` treated as mismatch; stores contact in `#lastContactByFrom` for `resolveIdentity()`
- `resolveIdentity(from)`: returns `phoneNumber` only on verified contact; returns `phoneNumber=undefined` on any mismatch or absent `user_id` (SI-001)
- `CONTACT_PROMPT_PREFIX` sentinel (`"__REQUEST_CONTACT__:"`): `send()` detects this prefix, strips it before sending, and attaches `ReplyKeyboardMarkup` with `request_contact` button; canonical definition in `packages/interfaces/src/messaging-channel.ts` — imported by `telegram-adapter.ts`, `state-machine.ts`, and `cli-adapter.ts`; drift is a compile error
- HTTP 409 Conflict: logs `telegram.poller.conflict` at ERROR, calls `process.exit(1)`, then `return []` to prevent fall-through when exit is mocked in tests
- All 6 `telegram.*` events added to canonical event taxonomy; token never appears in any log event (SI-002)

**Test structure:**
- AC-001 (integration, `TELEGRAM_BOT_TOKEN` required): real `getMe` + `getUpdates` HTTP calls; `telegram.polling.started` proves real Telegram API responded; any received `update_id`s verified as integers > 0
- AC-002 (manual `it.skip`): requires human to tap "Share Contact" in staging bot; documented procedure inline
- AC-003 (integration, `TELEGRAM_BOT_TOKEN` required): real `sendMessage` call; returns early if queue empty
- AC-006 (manual `it.skip`): requires human to drive full `/start` → `AWAITING_EMAIL` flow; documented procedure inline
- AC-007-integration-gate: Flyway V1–V26 checksum integrity + >= 2 real HTTP calls (requires `TELEGRAM_BOT_TOKEN` + `CELLO_ENV=local`)
- Unit tests (AC-004, AC-005, AC-006b, AC-006c, SI-001, SI-002, send() sentinel path, `__contact_mismatch__` handler dispatch): run without `TELEGRAM_BOT_TOKEN`; all use mock fetch

**Bugs found during review cycle:**

### 1. AC-001 test used synthetic update_id instead of real Telegram-assigned integer
**Symptom:** The initial AC-001 test injected a synthetic update via `processUpdate()` with a hard-coded `update_id: 1001`. The story AC explicitly states: "the update_id in the getUpdates response is a Telegram-assigned integer that cannot be synthesized by a local stub." The test would pass whether or not any real HTTP call was made.
**Fix:** Restructured AC-001 to call `adapter.start()` (real `getMe`) then `adapter.pollOnce()` (real `getUpdates`). The `telegram.polling.started` event proves `getMe` returned a real response. A spy on `processUpdate` captures any `update_id`s for integer validation.
**Rule:** An integration test must exercise the actual transport boundary. A test that calls only `processUpdate()` with synthetic data is a unit test, not an integration test.

### 2. AC-002 and AC-006 presented as automated when they require human interaction
**Symptom:** The initial tests for AC-002 and AC-006 injected synthetic `processUpdate()` calls with fabricated `user_id` values. The story ACs explicitly state these are transport-level observables that "cannot be synthesized by a local stub."
**Fix:** Converted to `it.skip` with documented manual test procedures.
**Rule:** When a story AC states "cannot be synthesized," the test must either reach the real boundary or be explicitly marked as a manual test with a clear procedure.

### 3. AC-007-integration-gate had no test
**Symptom:** The story's blocking gate AC (Flyway checksum integrity + >= 2 real HTTP calls) had no corresponding test.
**Fix:** Added two `it.skipIf(skipIntegrationGate)` tests: Flyway per-row integrity check and a fetch-wrapper call counter asserting >= 2 real calls to `api.telegram.org`.
**Rule:** Every blocking gate AC must have a test. A gate without a test is not a gate.

### 4. `isContactPromptMessage()` substring coupling — silent breakage on prompt wording change
**Symptom:** Contact-prompt detection used `message.toLowerCase().includes("share your phone number")`. Any change to prompt wording in `state-machine.ts` would silently disable the keyboard — no compile error, no test failure.
**Fix:** Replaced with an explicit `CONTACT_PROMPT_PREFIX = "__REQUEST_CONTACT__:"` sentinel prefixed by the state machine on all contact-prompt `send()` calls. Canonical definition in `@cello-protocol/interfaces`; all consumers import it.
**Rule:** Never couple adapter behavior to the exact wording of messages from application logic. Use an explicit signal the type system can enforce.

### 5. `CONTACT_PROMPT_PREFIX` redeclared as private const in three files
**Symptom:** After the sentinel fix, each file declared its own private copy of `"__REQUEST_CONTACT__:"`. A rename in one place would silently diverge from the others.
**Fix:** Moved canonical declaration to `packages/interfaces/src/messaging-channel.ts` (exported) and re-exported from `index.ts`. All three consumers import from `@cello-protocol/interfaces`. One string literal in the codebase.
**Rule:** A constant shared across packages belongs in the shared package. Private copies are future inconsistencies.

### 6. No unit test for `send()` sentinel behavior
**Symptom:** The sentinel-prefix behavior had no test — a regression would pass the suite silently.
**Fix:** Added `describe("send() — contact prompt sentinel prefix")` with two unit tests: sentinel path (prefix stripped, `reply_markup` attached) and plain path (text unchanged, no `reply_markup`).
**Rule:** Every code path introduced by a fix commit needs a regression test.

### 7. AC-004 and H-002 tests did not assert handler dispatch
**Symptom:** Mismatch tests verified `resolveIdentity()` return value and log output but not that `"__contact_mismatch__"` was delivered to the `onMessage` handler — load-bearing behavior for the state machine's re-prompt logic.
**Fix:** Extended both tests to register an `onMessage` handler, capture arguments, and assert `message === "__contact_mismatch__"`.
**Rule:** Test the side effect, not just the return value.

### 8. HTTP 409 handler fell through into non-ok branch when exit was mocked
**Symptom:** After `process.exit(1)`, the 409 response continued into `if (!response.ok)` in tests — causing double `response.json()`, spurious `telegram.api.error` WARN, and unnecessary 1s backoff sleep.
**Fix:** Added `return []` immediately after `process.exit(1)`. Unreachable in production; prevents fall-through in tests.
**Rule:** Any branch calling `process.exit()` needs an explicit `return` after it for test environments where exit is mocked.

**Downstream stories unblocked:**
- OPS-AGENT-005B: wire application code — `TelegramAdapter` ready to inject into `RegistrationEngine`; `TELEGRAM_BOT_TOKEN` env var needed in ECS task definition; composition root wires `TelegramAdapter` for `CELLO_ENV != local`

---

## OPS-AGENT-004 — SES OTP Delivery Provider

Implementation story. Delivers the email OTP transport layer for the registration state machine. `SesOtpDeliveryProvider` implements the `OtpDeliveryProvider` interface and delivers 6-digit OTPs via AWS SES with in-memory rate limiting, per-instance bounce tracking, and throttle retry. After this story, the registration engine can send real verification codes to operator email addresses.

**Delivered:**
- `SesOtpDeliveryProvider` (`packages/operations-agent/src/ses/ses-otp-delivery-provider.ts`) — `OtpDeliveryProvider` implementation over AWS SES SDK v3
- 6-digit OTP via `crypto.randomInt(0, 1_000_000).toString().padStart(6, '0')` (SI-001: CSPRNG, not `Math.random`)
- In-memory rolling rate limiter: 5 sends/hr per email address; throws `RateLimitError` on 6th attempt without calling SES; `#pruneSendLog` / `#isRateLimited` / `#recordSend` explicitly decoupled (no implicit side-effect coupling)
- Per-instance hard bounce tracking: `Set<string>` of bounced addresses; second call with a bounced address throws `DeliveryError` immediately, no SES call; new instance starts with empty set
- Throttle retry: 1-second wait, retry once; logs `otp.delivery.retried` on success; throws `DeliveryError` on retry failure
- `#extractDomain` guards the no-`@` case: returns `[invalid-email-domain]` instead of the full string (SI-002 defense-in-depth)
- SI-002: every log call uses `emailDomain` (domain only); full `emailAddress` never appears in any log event; verified by SI-002 test that serializes all log arguments and checks for absence of the full address
- SI-003: `SESClient` injected via constructor config; provider contains no internal `new SESClient()` call; no `process.env` reads
- `generateOtp()` in `otp.ts` rewritten from `randomBytes` rejection-sampling to `crypto.randomInt` to match SI-001 spec exactly
- Three observability events added to canonical taxonomy: `otp.delivery.sent`, `otp.delivery.retried`, `otp.delivery.failed`
- `DeliveryError` and `RateLimitError` exported from package index

**Test structure:**
- 20 unit tests covering AC-001 (mock SES, command shape, subject, from, body, log fields), AC-002 (6th send throws before SES), AC-003 (rolling window reset with fake timers), AC-004 (hard bounce + immediate re-attempt DeliveryError), AC-005 (throttle retry success and failure), AC-006 (ConsoleOtpDeliveryProvider), AC-007 (100-sample format check + leading zero), SI-001 (Math.random spy), SI-002 (full address absent in all log calls), SI-003 (injected client used)
- AC-008-integration-gate test gated on `CELLO_ENV=local && SES_INTEGRATION_TEST=true`: real SES sandbox call (MessageId verified), state machine flow to `PRE_AUTH_TOKEN_ISSUED`, expired OTP rejection, rate-limit check

**Bugs found during review cycle:**

### 1. `generateOtp` used `randomBytes` with rejection sampling instead of `crypto.randomInt`
**Symptom:** OPS-AGENT-002 had implemented `generateOtp()` using `randomBytes(4)` with a rejection sampling loop to avoid modulo bias. While cryptographically correct, this diverged from SI-001's explicit spec ("uses `crypto.randomInt(0, 1000000)` with `padStart(6, '0')`"), creating a traceability gap during audits.
**Fix:** Replaced with `crypto.randomInt(0, 1_000_000).toString().padStart(6, '0')` — simpler and self-documenting.
**Rule:** When a security invariant specifies the exact function name, the implementation must use that function. Equivalent-but-different implementations create audit surface.

### 2. `#extractDomain` would log the full email on a no-`@` input
**Symptom:** `email.slice(email.indexOf('@') + 1)` returns the full string when `indexOf` returns -1, since `slice(0)` is the whole string. A malformed input with no `@` would log the raw value — a SI-002 violation.
**Fix:** Added `if (atIndex === -1) return '[invalid-email-domain]'` guard. Malformed inputs are caught upstream by the state machine's email validation, but defense-in-depth is warranted given SI-002 is a hard security invariant.
**Rule:** SI guards must be in the implementation layer, not just in callers. An upstream validation does not eliminate the need for a boundary-level guard on a hard security invariant.

### 3. AC-008-integration-gate had no test body
**Symptom:** The test file contained a comment acknowledging AC-008 but no `describe` or `it` block implementing it. The story's blocking gate had no test.
**Fix:** Added a `describe.skipIf(!isIntegrationEnabled)` block with four parts covering all AC-008 sub-requirements. Guarded on `CELLO_ENV=local && SES_INTEGRATION_TEST=true`.
**Rule:** Every blocking gate AC must have a test. A comment is not a test.

### 4. AC-008-1 used `console.warn` + `return` instead of `it.skipIf`
**Symptom:** The SES sandbox test guarded its skip condition inside the test body with `if (!sandboxRecipient) { console.warn(...); return; }`. A runtime guard means: assertions before the guard can silently pass even when the test was meant to be skipped.
**Fix:** Converted to `it.skipIf(!sandboxRecipient)(...)` at test-definition time. Guard removed from body.
**Rule:** Skip conditions belong at test-definition time, not inside the test body.

### 5. AC-008-4 rate-limit check was hidden inside the integration gate block
**Symptom:** The rate-limit check in AC-008-4 had no external dependencies but lived inside `describe.skipIf(!isIntegrationEnabled)`, so it never ran in CI.
**Fix:** Moved to the top-level unit test suite as `AC-008-4: rate limit (unit, always runs)`.
**Rule:** A test that requires no external system must not be gated behind an integration env var.

### 6. Flyway assertion used the wrong query — could not detect checksum mismatches
**Symptom:** The AC-008 Flyway gate queried `WHERE success = false`. Flyway detects checksum mismatches at startup and throws before writing any row — so no `success = false` entry is ever inserted for this failure mode. The gate was inert against the exact attack it was meant to catch.
**Fix:** Replaced with the per-row pattern from `telegram-adapter.test.ts`: iterate every row in `flyway_schema_history`, assert `success = true` and `checksum != -1`. Added explicit presence checks for V24 and V25.
**Rule:** Before writing a Flyway integrity assertion, verify which failure mode it actually catches. `success = false` catches mid-execution crashes, not post-apply modification. The per-row checksum check catches both.

### 7. `err.name ?? "UnknownError"` passed through empty-string `.name`
**Symptom:** The `??` operator only substitutes for `null`/`undefined`. An error object with `name = ""` would produce an empty `sesErrorType` in log events and `DeliveryError`, yielding confusing diagnostics.
**Fix:** Changed to `err.name || "UnknownError"` so the empty string also falls back to the default.
**Rule:** For user-visible diagnostic strings derived from error properties, use `||` not `??` so both null/undefined and empty string are handled.

**Downstream stories unblocked:**
- OPS-AGENT-005B: wire application code — `SesOtpDeliveryProvider` is ready to inject into `RegistrationEngine` as the `OtpDeliveryProvider`; composition root wires it for `CELLO_ENV != local`; SES credentials and `fromAddress` come from Secrets Manager

---

## OPS-AGENT-005A — Operations Agent Infrastructure (Mitigation A gate)

Infrastructure-only story. Proves the full deployment path — ECR, ECS, Secrets Manager, SGs, IAM, CI/CD pipeline — with the existing shared stub container before any application code touches it. This is the anti-DEPLOY-003 gate: infra proven first, app code wired in 005B.

**Delivered:**
- `infra/cloudformation/cello-ecs-operations-agent.yaml` — ECS Fargate service; public subnet + `AssignPublicIp: ENABLED` (no NAT gateway in cello-vpc; Telegram/SES egress requires public IP); `MinimumHealthyPercent: 0` / `MaximumPercent: 100` (at-most-one Telegram poller invariant); no ALB (outbound poller, not inbound service); `DIRECTORY_INTERNAL_URL` set to directory ALB DNS name via cross-stack import
- `cello-ecr.yaml` extended — `cello-operations-agent` ECR repo added with lifecycle policy and URI export
- `cello-iam.yaml` extended — `OpsAgentTaskRole` and `OpsAgentTaskExecutionRole`: `secretsmanager:GetSecretValue` on exactly the four ops-agent secret ARNs, `ssmmessages:*` for ECS Exec, `logs:*` on ops-agent log group only; no S3, no KMS, no access to directory/relay key material (SI-001)
- `cello-secrets.yaml` extended — four ops-agent secrets as CloudFormation-managed resources with exports; WARNING comments noting re-deploy resets manual secrets to PLACEHOLDER
- `cello-ecs-directory.yaml` updated — `InternalPathVpcAllowRule` (priority 5, VPC CIDR allow) and `InternalPathExternalBlockRule` (priority 10, catch-all 403) protect `/internal/*` from external access; directory `Service` `DependsOn` includes both listener rules (prevents registration window before rules are active)
- `cello-rotation.yaml` extended — `OpsAgentRdsCredentialsRotationSchedule` with `RotateImmediatelyOnUpdate: false`; rotation Lambda already reads `username` dynamically from secret JSON (no hardcoding)
- `cello-cloudwatch.yaml` extended — `OpsAgentEcsTaskCountAlarm` fires to ops-critical when `runningCount < 1`
- `cello-cicd.yaml` extended — `OperationsAgentPipeline` (Build→StagingDeploy→SmokeTest→ProductionDeploy); `pipeline-mappings.json` maps `packages/operations-agent/` to `cello-operations-agent-pipeline`
- `build-stubs.sh` extended — pushes shared stub to `cello-operations-agent:stub` with `--platform linux/amd64`; no new Dockerfile
- `bootstrap.sh` updated — `rds-credentials` uses `put_secret_if_empty`; three manual secrets print `[MANUAL REQUIRED]` operator instructions instead of writing a redundant PLACEHOLDER
- `deploy.sh` updated — Step 8a: automated first-deploy detection (grep for PLACEHOLDER in rds-credentials JSON, trigger `rotate-secret`, poll until complete before deploying ECS stack); Step 9: `cello-ecs-operations-agent` stack; STACK_COUNT accurate (14/15)
- `packages/operations-agent/buildspec.yml` — full CodeBuild buildspec with pnpm install, Docker build from `infra/stub/`, ECR push using dynamic account ID and `${AWS_DEFAULT_REGION}` (no hardcoded account or region)
- `infra/buildspecs/staging-deploy-operations-agent.yml` — full ECS deploy buildspec with `rolloutState` poll loop (15-minute timeout)
- Story YAML corrected: AC-005 updated to include port 80 egress to ALB SG with rationale; AC-006 updated to specify `ssmmessages:*` with explanation that `ecs:ExecuteCommand` is a caller-side action

**Review history:** code-reviewer round 1 (9 findings: 2 critical, 2 high, 3 medium, 2 low — all fixed); sprint-reviewer BLOCKED (3 medium fixed in code, 1 blocking = live deployment gate); code-reviewer round 2 (2 findings: 1 high hardcoded ECR account ID, 1 low stale step reference — both fixed); story YAML corrected.

**AC-010 integration gate status:** PASSED (2026-05-27). All 15 stacks deployed via `deploy.sh dev us-east-1`. `cello-ecs-operations-agent-dev` CREATE_COMPLETE, task-definition rev 1 (stub), runningCount=1, rollout COMPLETED. Secrets resolved: telegram-bot-token (real), directory-api-key (256-bit hex), rds-credentials (rotation Lambda set password). Directory INTERNAL_API_KEY wired and pipeline redeployed (image 1b52c4d). SES credentials remain at PLACEHOLDER (non-blocking for 005B — stub mode until populated).

**Pipeline status (2026-05-28):** Both pipelines fully green — all 5 stages Succeeded:
- `cello-operations-agent-pipeline`: Source→Build→StagingDeploy→SmokeTest→ProductionDeploy (us-east-1 only)
- `cello-directory-pipeline`: Source→Build→StagingDeploy→SmokeTest→ProductionDeploy (us-east-1 + eu-central-1 + ap-northeast-1)

Secondary region fixes required: VPC SG port 9090 rule (REPOSPLIT-001 health port split was only deployed to us-east-1 by deploy.sh), IAM+secrets stacks (ops-agent/directory-api-key permission), ECS directory stacks (INTERNAL_API_KEY + port 9090 health check + real image).

**Bugs found during review cycle:**

### 1. rds-credentials injected as plain env var instead of ECS Secrets ValueFrom
**Symptom:** Initial implementation passed the rds-credentials ARN as a plain `Environment` variable rather than a `Secrets`/`ValueFrom` entry. ECS would not resolve the secret value at task launch — the application would receive the ARN string, not the JSON payload.
**Root cause:** Oversight during initial wiring; the other three secrets were correctly placed in the `Secrets` block.
**Fix:** Removed the plain env var; added `RDS_CREDENTIALS` to the `Secrets`/`ValueFrom` block alongside the other three.
**Rule:** All Secrets Manager values injected into ECS tasks must use `Secrets`/`ValueFrom`. Plain `Environment` entries passing ARN strings require runtime `GetSecretValue` calls and do not benefit from ECS's launch-time secret resolution or IAM execution role scoping.

### 2. Directory ECS Service DependsOn missing listener rules — registration window
**Symptom:** The directory `Service` resource had `DependsOn: HttpListener` only. The two new ALB listener rules also depend on `HttpListener`. CloudFormation would create all three in parallel after `HttpListener`, meaning the ECS service could start registering targets and serving traffic on the default rule before the `/internal/*` protection rules were active.
**Root cause:** `DependsOn` was not updated when the listener rules were added to the template.
**Fix:** Added both `InternalPathVpcAllowRule` and `InternalPathExternalBlockRule` to the directory `Service` `DependsOn` list.
**Rule:** When ALB listener rules protect an endpoint, the ECS `Service` must `DependsOn` those rules. Otherwise there is a deployment window where the unprotected default rule handles requests.

### 3. STACK_COUNT off by one after adding ops-agent stack
**Symptom:** `STACK_COUNT` was not incremented when `cello-ecs-operations-agent` was added, causing incorrect counts in `infra.deploy.started` and `infra.deploy.completed` log events.
**Fix:** Incremented both branches (us-east-1: 14→15, others: 13→14).
**Rule:** When a deploy.sh stack step is added or removed, update `STACK_COUNT` in the same commit.

### 4. OpsAgentRdsCredentialsRotationSchedule missing RotateImmediatelyOnUpdate: false
**Symptom:** `AWS::SecretsManager::RotationSchedule` triggers an immediate rotation on stack create/update by default. At the time `cello-rotation` is updated (early in deploy.sh), the Lambda may still have placeholder code — causing the rotation to fail and the secret to enter FAILED state.
**Fix:** Added `RotateImmediatelyOnUpdate: false`. The first rotation is handled explicitly by deploy.sh Step 8a.
**Rule:** Any `RotationSchedule` resource whose first rotation is managed by a separate deploy-time script must set `RotateImmediatelyOnUpdate: false` to prevent the automatic trigger from racing the script.

### 5. bootstrap.sh wrote PLACEHOLDER back over PLACEHOLDER for manual secrets
**Symptom:** `put_secret_if_empty` with `PLACEHOLDER_POPULATE_VIA_CLI` as the value writes "SET" to the log but achieves nothing — the CloudFormation stack already created the secret with that value. The output was misleading: operators could mistake a SKIP for a successful provision.
**Fix:** Replaced `put_secret_if_empty` calls for the three manual secrets with explicit `[MANUAL REQUIRED]` operator instructions printed to stdout.
**Rule:** bootstrap.sh should print operator instructions for secrets that require manual population, not attempt a write that will always no-op.

### 6. Hardcoded AWS account ID and region in buildspec.yml
**Symptom:** ECR repo URI and docker login target hardcoded `257394457473` and `us-east-1`. A different account or a secondary-region pipeline run would push to the wrong registry or fail to authenticate.
**Fix:** Replaced with `$(aws sts get-caller-identity --query Account --output text)` and `${AWS_DEFAULT_REGION}`.
**Rule:** buildspec.yml files must never hardcode account IDs or regions. Use `get-caller-identity` and `AWS_DEFAULT_REGION` environment variable instead.

**Downstream stories unblocked:**
- OPS-AGENT-005B: wire application code — infra proven with stub; ECS service, secrets, SGs, and pipeline all in place; compose root wires `TelegramAdapter` + `SesOtpDeliveryProvider` + `DirectoryPreAuthorizationClient` for `CELLO_ENV != local`

---

## OPS-AGENT-005B — Wire Real Application Code into Proven ECS Deployment

Wiring story. Takes the proven ECS infrastructure from 005A (stub running, secrets resolving, networking verified) and replaces the stub with the real application image — `server.ts` as the composition root wiring together the state machine (002), TelegramAdapter (003), SES OTP delivery (004), and PreAuthorizationClient (001).

**Delivered:**
- `packages/operations-agent/src/server.ts` — composition root; `CELLO_ENV`-driven adapter selection; three-dimension health check (PostgreSQL connectivity, migration version match, Telegram `getMe`); emits `ops_agent.started` only after all checks pass; HTTP health server on port 8080; graceful SIGTERM shutdown
- `packages/operations-agent/src/directory-pre-auth-client.ts` — `DirectoryPreAuthorizationClient` implementing `PreAuthorizationClient`; exactly one public method (`requestToken()`); throws `PreAuthRequestError` carrying `httpStatus` for structured error logging; no internal logging (caller owns the event)
- `packages/operations-agent/Dockerfile` — multi-stage Node 24-slim; production deps only; non-root user `cello` (uid 1001); `EXPOSE 8080`; builds from monorepo root context for pnpm workspace resolution
- `packages/operations-agent/buildspec.yml` — real image build replacing stub; `pnpm run typecheck` + `pnpm run test` before `docker build`; `PrivilegedMode: true` on CodeBuild project (required for Docker daemon access)
- `infra/buildspecs/smoke-test-operations-agent.yml` — CloudWatch Logs gate polling for `ops_agent.started` event (direct IP polling blocked by no-inbound SG; CloudWatch approach confirms application-level health, not just container liveness)
- `infra/cloudformation/cello-cicd.yaml` — `SmokeTestOperationsAgentBuild` CodeBuild project wired into ops-agent pipeline; `PrivilegedMode: true` on `OperationsAgentBuild`; `logs:FilterLogEvents` IAM permission for smoke test
- `infra/cloudformation/cello-ecs-operations-agent.yaml` — ECS `HealthCheck` block added (`CMD-SHELL curl /health`, 30s interval, 3 retries, 60s startPeriod); `SES_FROM_ADDRESS` added to `Environment` block
- Canonical event taxonomy: 7 new events registered (`ops_agent.started`, `ops_agent.telegram.connected`, `ops_agent.startup.failed`, `ops_agent.health_server.started`, `ops_agent.shutting_down`, `registration.preauth.request.failed`)
- 98 tests (up from 67 unit + 30 integration); SI-001 automated test verifying `@cello-protocol/crypto` absent from `package.json`

**Review history:** sprint-coder committed → code-reviewer round 1 (9 findings, all fixed) → sprint-reviewer BLOCKED (3 blocking) → code-reviewer round 2 (3 findings including 2 pipeline-breaking: missing `PrivilegedMode`, broken smoke test network path) → sprint-reviewer APPROVED (4 medium, 2 low, all fixed).

**Bugs found during review cycle:**

### 1. `DirectoryPreAuthorizationClient` logged AND rethrew on failure — double event, wrong context fields
**Symptom:** The client logged `registration.preauth.request.failed` internally with hardcoded `correlationId: "network-error"` / `"http-error"` and no `registrationId`. The state machine (the correct owner of this event) was never reached for error logging. AC-005 requires `{ registrationId, httpStatus, correlationId }` — two of three fields were wrong or absent.
**Fix:** Removed all logging from `DirectoryPreAuthorizationClient`. Introduced `PreAuthRequestError` carrying `httpStatus`. State machine wraps `requestToken()` in try/catch, logs the event with all three required fields, sends user error message, and returns `EMAIL_CONFIRMED` record unchanged.
**Rule:** When an interface method can fail, the caller (which has request context) owns the failure log event. The implementation only throws a typed error.

### 2. `PrivilegedMode: true` missing on `OperationsAgentBuild`
**Symptom:** CodeBuild standard images cannot access the Docker daemon without `PrivilegedMode: true`. The `buildspec.yml` runs `docker build` and `docker push`. Every pipeline run would have failed at Build stage with "Cannot connect to the Docker daemon" — first discovered post-merge.
**Fix:** Added `PrivilegedMode: true` to `OperationsAgentBuild` CodeBuild project environment.
**Rule:** Any CodeBuild project that runs `docker build` requires `PrivilegedMode: true`. The ops-agent is the only build that runs Docker — all others are TypeScript-only.

### 3. Smoke test polled task public IP — blocked by no-inbound SG rule
**Symptom:** Initial smoke test resolved the ECS task's public IP via ENI and polled `http://{IP}:8080/health`. The ops-agent SG has explicitly no inbound rules. Every smoke test poll would return connection refused, timing out after 90s and failing the pipeline permanently.
**Fix:** Rewrote smoke test to use `aws logs filter-log-events` polling for `ops_agent.started` in the CloudWatch log group. That event fires only after all three health checks pass — a reliable application-level gate that requires no network access to the task.
**Rule:** When an ECS service has no ALB and no inbound SG rules, smoke tests must use CloudWatch Logs or ECS service status APIs, not direct task IP polling.

### 4. `botUsername` always logged as "unknown" in `ops_agent.telegram.connected`
**Symptom:** The event read `process.env["CELLO_BOT_USERNAME"] ?? "unknown"`. `CELLO_BOT_USERNAME` is not set in the ECS task definition. Production would always emit `botUsername: "unknown"`.
**Fix:** Added `get botUsername(): string` getter to `TelegramAdapter`. `checkTelegram()` calls `adapter.start({ skipPolling: true })` which runs `getMe`, then reads `adapter.botUsername` to get the verified value. Threaded through to the log event.
**Rule:** Observability fields that report live system state (bot identity) must come from the verified response, not from environment variables that may be absent.

### 5. `isMain` basename-only comparison — fragile in ESM
**Symptom:** `new URL(import.meta.url).pathname.endsWith(process.argv[1].split("/").pop()!)` compares only the filename component. Any other `server.js` in the project would match.
**Fix:** Replaced with `fileURLToPath(import.meta.url) === process.argv[1]` — the standard ESM main-module idiom.

### 6. Dockerfile ran `typecheck` (no emit) instead of `build` — dist/ never populated
**Symptom:** The production stage `COPY --from=build /app/packages/*/dist` would copy empty directories. The container would start and immediately crash with "Cannot find module".
**Fix:** Changed `pnpm run typecheck` to `pnpm run build` in the Dockerfile build stage so `dist/` is populated before the production stage copies it.

**Pending operational step before real image deploys:**
- Re-run `setup-replication.sh` on the live cluster to `ALTER PUBLICATION cello_pub ADD TABLE registrations, pre_authorization_tokens` on all 3 nodes and verify cross-region replication within 5s (AC-007b). Flagged in `infra/STATE.md`.

**Downstream stories unblocked:**
- DEMO-001: registration AC-000 — Telegram bot is live in production; demo agent can register

---

## REPOSPLIT-002 — Extract Client Packages, Publish @cello-protocol/connect@beta

Extraction and publish story. Permanently moves five packages from the trustless-cello monorepo into the cello-client repo and publishes them to npm, making CELLO installable with a single command: `claude mcp add cello npx @cello-protocol/connect`.

**Delivered:**

- **Package extraction**: `@cello-protocol/protocol-types`, `@cello-protocol/crypto`, `@cello-protocol/transport`, `@cello-protocol/client`, `@cello-protocol/connect` moved from `trustless-cello/packages/` to `cello-client/core/`. `@cello-protocol/test-fixtures` moved as a private workspace package.
- **@cello-protocol/interfaces published**: stays in trustless-cello but is no longer private — published to npm at `0.0.3` so cello-client can consume it as a real dependency.
- **@cello-protocol/connect@beta**: `0.0.3` published with `beta` dist-tag. Install: `claude mcp add cello npx @cello-protocol/connect`.
- **CELLO_DIRECTORY_URL default**: `http://directory-us1.cello.mygentic.ai` — ALB is HTTP, WebSocket upgrade confirmed (`101 Switching Protocols`).
- **trustless-cello post-split**: root `tsconfig.json` references only `directory`, `relay`, `e2e-tests`. Client packages now resolve from npm.
- **cello-client improvements**: ESLint added (`pnpm run lint`), `pnpm.overrides` points to pinned npm version instead of `file:` path (AC-000 satisfied), CI restructured to skip sibling repo checkout on non-publish runs, `|| true` guards on all publish commands for idempotency.
- **AUDIT-ME.md** updated with accurate cello-client file paths. All seven named files verified to exist.
- **564 tests pass** in cello-client (36 test files). **1304 tests pass** in trustless-cello (104 test files).

**AC-007 smoke test result (2026-05-28):**
```
npm install @cello-protocol/connect@beta  → 254 packages installed, zero errors
npx @cello-protocol/connect → MCP server starts
cello_status → { own_pubkey: "3ce94ace...", transport_started: true }
```

**Review history:** Background sprint-coder agent stopped early (quality issues) → in-session implementation → code-reviewer (5 findings, all fixed) → sprint-reviewer pass 1 BLOCKED (workspace:* in published manifest, no lint script) → sprint-reviewer pass 2 BLOCKED (0.0.2 manifests had wrong interfaces dep) → bump to 0.0.3 + additional fixes → AC-007 smoke test PASSED.

**Bugs found during implementation:**

### 1. `npm publish` publishes `workspace:*` literals — install fails for all consumers
**Symptom:** `@cello-protocol/interfaces@0.0.1` was published using `npm publish` (not `pnpm publish`). pnpm rewrites `workspace:*` to real version numbers at publish time; npm does not. The published manifest contained `"@cello-protocol/protocol-types": "workspace:*"`. Any `npm install` or `pnpm add` of the package failed with `EUNSUPPORTEDPROTOCOL` / `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`.
**Fix:** Changed all publish commands to `pnpm publish --filter <package> --no-git-checks`. Only pnpm performs workspace specifier rewriting before uploading the manifest.
**Rule:** In a pnpm workspace, always publish via `pnpm publish`, never `npm publish`. The manifest pnpm uploads is the rewritten one with real version numbers. `npm publish` uploads the raw `package.json` with `workspace:*` intact.

### 2. `protocol-types` version mismatch — interfaces declared a non-existent dep
**Symptom:** `@cello-protocol/protocol-types` in trustless-cello was at version `0.0.1`, but only `protocol-types@0.0.2` exists on npm (published from cello-client). When interfaces was published via pnpm, workspace rewriting resolved `workspace:*` to `0.0.1` — a version that doesn't exist. Installing interfaces would fail with `E404`.
**Fix:** Bumped `protocol-types` in trustless-cello to `0.0.2` to match the published version.
**Rule:** When a package in one repo depends (via `workspace:*`) on a package from another repo that has a different version on npm, the workspace version must match the npm version before publishing.

### 3. `PRODUCTION_DIRECTORY_URL` was `https://` but ALB is HTTP
**Symptom:** The production ALB accepts WebSocket connections on port 80 (HTTP). Port 443 returns `Connection refused`. The default URL `https://directory-us1.cello.mygentic.ai` caused `cello_status` to report `directory_reachable: false` and the MCP server to fail to reach the network.
**Verification:** `curl http://directory-us1.cello.mygentic.ai` with WebSocket upgrade headers returns `HTTP/1.1 101 Switching Protocols`.
**Fix:** Changed default to `http://directory-us1.cello.mygentic.ai`.
**Rule:** Verify the actual protocol and port of deployed infrastructure against STATE.md before baking a URL as a compile-time constant. "Production uses HTTPS" is an assumption — check the ALB listener rules.

### 4. `pnpm.overrides` with `file:` path forced local filesystem resolution
**Symptom:** `pnpm.overrides` in cello-client's root `package.json` pointed to `file:../trustless-cello/packages/interfaces`. This meant `pnpm install` always resolved interfaces from the local filesystem, requiring trustless-cello to be checked out as a sibling. AC-000 requires cello-client to resolve interfaces from npm. Any developer without the sibling layout would have a broken install.
**Fix:** Changed override to `"@cello-protocol/interfaces": "0.0.3"` — the pinned npm version.
**Rule:** `pnpm.overrides` with `file:` paths are a local development convenience that must not be committed to a published package repo. They break installs for anyone without the exact filesystem layout.

### 5. CI publish commands had no `|| true` — version-already-exists breaks the pipeline
**Symptom:** pnpm publish exits non-zero on E409 (version already exists). On the third tag push (`v0.0.2-beta.2`), all packages were at `0.0.2` and already published. Every publish command failed, silently preventing republication with corrected dependencies.
**Fix:** Added `|| true` to all five cello-client publish commands (same as the existing pattern for interfaces).
**Rule:** In an idempotent publish pipeline, all publish commands must use `|| true` to handle the version-already-exists case. E409 is not an error in a pipeline that may be re-run with the same version.

---

## DEMO-001 — Persistent Demo Agent: 4-Message Cryptographic Walkthrough

A standalone Node.js process (not in the monorepo, not in cello-client) that registers as a real CELLO agent on the production network and responds to incoming messages with a hardcoded 4-message sequence explaining the protocol. No LLM, no database, no HTTP server — only `@cello-protocol/connect`.

**Code delivered (merged to main 2026-05-29):**
- `demo/` directory at trustless-cello repo root — standalone npm package with own `package.json`, `tsconfig.json`, `vitest.config.ts`
- `src/message-handler.ts` — pure session state machine; `handleMessage()` never receives message content (SI-002 enforced at type boundary); per-session `Map<string, SessionState>` keyed by `session_id`
- `src/index.ts` — spawns `cello-mcp` binary as subprocess via MCP stdio transport; validates `CELLO_DIRECTORY_MULTIADDR` at startup; checks `registered=true` AND `directory_reachable=true` before logging `demo.started`; `Promise.all` over two concurrent loops (connection requests + message receive)
- `cello-demo.service` — systemd unit (`Restart=on-failure`, dedicated `cello-demo` system user, env.conf drop-in required before start)
- `runbook.md` — full AWS CLI provisioning steps: IAM instance profile (`AmazonSSMManagedInstanceCore`), SG (zero inbound, HTTPS 443 outbound only), EIP, EC2 launch with user-data script, Secrets Manager key backup, systemd start and verification
- 15 unit tests (AC-002b session isolation, AC-002c no double-close, SI-002 content-never-logged, all 4 verbatim messages, delivery failure guard)

**4-message sequence (verbatim from story YAML — not paraphrased):**
1. Welcome + hardcoded nature explanation
2. End-to-end encryption + Noise XX + hash chain
3. Cryptographic audit trail + sealed receipt preview
4. Sign-off + `cello_get_sealed_receipt()` instruction → `cello_close_session`

**Observability events:** `demo.started`, `demo.message.received`, `demo.response.sent`, `demo.connection.failed`, `demo.send.failed`, `demo.close.failed`, `demo.connection_request.failed`, `demo.receive.failed` — all with correct context fields, no message content in any event.

**Review history:** sprint-coder → code-reviewer pass 1 (6 findings) → sprint-reviewer pass 1 APPROVED (1 medium) → code-reviewer pass 2 (4 findings) → sprint-reviewer pass 2 APPROVED (2 low) → 2 low findings fixed immediately → merged.

**Key issues resolved during review:**

### 1. `Promise.race` → `Promise.all` for concurrent loops
Using `Promise.race` meant a loop that resolved (however unlikely) would silently exit the process without logging `demo.connection.failed`. `Promise.all` ensures any unhandled rejection surfaces to the outer catch.

### 2. Startup guard missing `registered=true` and `directory_reachable=true`
Initial code only checked `own_pubkey`. An unregistered agent or a misconfigured instance (missing `CELLO_DIRECTORY_MULTIADDR`) would pass the guard and log `demo.started` while being non-functional. Both checks added; `CELLO_DIRECTORY_MULTIADDR` now fails fast at startup if unset.

### 3. Binary invocation: `command: "node", args: [bin]` → `command: bin, args: []`
Passing the cello-mcp symlink as an argument to `node` works today but breaks if `@cello-protocol/connect` ships a non-JS entry point. The OS resolves the shebang when the binary is the command.

### 4. Session sealed before delivery confirmed
After sending message 4, code unconditionally set `session.sealed = true` and called `closeSession` regardless of whether `client.send()` succeeded. If delivery failed, the peer never received the sign-off but the session was permanently sealed. Fixed: advance position and seal only when `delivered: true`.

**EC2 provisioned (2026-05-29/30):**
- Instance `i-0ad3e7c22470f266e`, EIP `32.196.100.165`, SG `sg-0b8400fa0cedb95da`
- SSM online, Node v24.16.0, dist/ uploaded, systemd enabled (not started)
- STATE.md updated with all resource IDs

**Registration ceremony verified end-to-end (2026-05-30):**
- Ops-agent first real deployment required 17 fixes (see COORDINATION.md 2026-05-30 entry)
- Full flow: /start → phone → email → OTP → token in <60 seconds via @CelloConnectStagingBot
- Token: `CELLO-PAC4QVHhHAkYgNimMAvXBQzQbzvH9JF1i`

**Deployment completed (2026-05-31):**
- Three npm patch releases required: `0.0.5` (PERSIST-024 wiring), `0.0.6` (db/migrations missing from tarball — `files` field only listed `dist/`; SQLCipher migration files were not in the published package, so every startup failed with `SQLITE_CANTOPEN`)
- Two additional issues found during deployment: (1) `cello-demo` user has no home directory — `~/.cello/client.db` default path unwritable; fixed by adding `CELLO_DB_PATH=/opt/cello-demo/data/client.db` to `env.conf`; (2) `register-agent.mjs` did not pass `CELLO_DB_PATH` to the spawned cello-mcp process — fixed before re-running registration
- Two re-registration ceremonies required (first token consumed but FROST share not persisted due to missing migrations; second token persisted successfully after 0.0.6 deploy)
- `demo.started` confirmed in journalctl; restart test (systemctl kill → auto-recover → demo.started again) passed
- AgentID `a2c55e2721f45cfa86cb3417a76e3f7b` published in cello-client README quick-start; `infra/STATE.md` updated

**DEMO-001 is closed. M6-E2E-001 is unblocked.**

### Deployment bugs found:

#### 1. db/migrations not in npm tarball
**Symptom:** Every startup failed with `SQLITE_CANTOPEN` / `ENOENT: no such file or directory, scandir '.../node_modules/@cello-protocol/client/db/migrations'`. The V2 migration file was never found.
**Root cause:** `@cello-protocol/client/package.json` listed only `"files": ["dist/", "package.json"]`. The `db/` directory was never included.
**Fix:** Added `"db/"` to the files allowlist. Bumped `@cello-protocol/client` to `0.0.5` and `@cello-protocol/connect` to `0.0.6`.
**Rule:** Any directory referenced at runtime that lives outside `dist/` must be explicitly in the `files` allowlist. Build-time paths are not runtime paths.

#### 2. cello-demo user has no home directory
**Symptom:** `SQLITE_CANTOPEN: unable to open database file` — cello-mcp tried to create `~/.cello/client.db` but the `cello-demo` system user has no home directory.
**Fix:** Added `CELLO_DB_PATH=/opt/cello-demo/data/client.db` to the systemd env.conf drop-in; created `/opt/cello-demo/data/` owned by `cello-demo`.
**Rule:** System users created with `--no-create-home` have no `$HOME`. Never rely on `homedir()` defaults for service accounts — always set explicit paths via env vars.

#### 3. register-agent.mjs did not forward CELLO_DB_PATH to cello-mcp subprocess
**Symptom:** Even after adding `CELLO_DB_PATH` to env.conf, running `register-agent.mjs` as `cello-demo` user still failed to persist — the script spawns `cello-mcp` with its own env block that did not include `CELLO_DB_PATH`.
**Fix:** Updated `register-agent.mjs` to include `CELLO_DB_PATH: '/opt/cello-demo/data/client.db'` in the spawn env.
**Rule:** Any script that spawns a subprocess with an explicit env block must forward all vars the subprocess needs. `...process.env` alone is not sufficient if the parent env does not yet include the var.

---

---

## PERSIST-024 — Structured Client SQLCipher Schema and Startup State Loading

Reactive story. Discovered during DEMO-001 deployment when `systemctl start cello-demo` failed immediately — the FROST share lived only in a RAM Map (`_localShares`) and was lost on every process restart. The demo agent service could never start because `registered=false` was returned on every boot.

**Delivered:**
- `V2__client_schema_structured.sql` in `cello-client` — drops the V1 `client_store` KV placeholder, creates 18 structured tables covering every piece of durable state: `agents`, `registration_state`, `frost_key_shares`, `ml_dsa_keypairs`, `connection_policy`, `connection_policy_requirements`, `connections`, `endorsements`, `attestations`, `peers`, `sessions`, `session_tree_leaves`, `pending_hashes`, `relay_ack_receipts`, `backup_metadata`, `known_relays`, `pending_connection_requests`, `decided_connection_requests`
- `ClientStatePersistence` class — typed methods for every persist/load operation; SI-enforcing (signing_share and secret_key_blob never logged; db_key derived at runtime from K_local via HKDF, never stored)
- `loadPersistedState()` on `CelloClientImpl` — reloads all in-memory structures before first MCP tool call; `client.startup.state.loaded` emitted after all structures populated
- Full persist hooks wired at every mutation point in `client.ts`: leaf accept, session status transitions (sealing, sealed, seal_deferred, transport_lost, seal_rejected, desynchronized), connections (including Round 2), pending connection requests, policy changes, peers, pending hashes, relay ACK receipts
- `AgentHashQueue.loadPending()` — restores pending hash queue on restart from DB without touching the old KV interface (which throws after V2 migration)
- `cello-mcp.ts` composition root fully wired: derives db_key from identity seed before zeroing it, opens `SQLCipherClientStore`, calls `loadPersistedState()` before `server.connect()`
- `mlDsaKeygenWithBytes()` added to `@cello-protocol/crypto` — returns both the provider and the raw secret blob for DB persistence

**Bugs found during review cycle (7 code review passes):**

### 1. Persistence layer was dead code — `cello-mcp.ts` never wired it
**Symptom:** `SQLCipherClientStore` was constructed and `loadPersistedState()` was implemented, but the composition root never called either. The entire story's behavior was silently a no-op.
**Root cause:** The wiring in `cello-mcp.ts` was omitted — `dbKey` derivation, store construction, and `loadPersistedState()` call were all missing.
**Fix:** Derive `dbKey` from `identityKeyBytes` before zeroing; construct store and persistence; call `loadPersistedState()` before `server.connect()`.
**Rule:** The composition root is the last link in the chain. Always verify it is wired before closing a story.

### 2. `AgentHashQueue.enqueue()` crashed at startup after V2 migration
**Symptom:** An earlier fix attempted to restore pending hashes by calling `AgentHashQueue.enqueue()` at startup. But `AgentHashQueue` uses `ClientStore.set/get`, which throws after V2 drops `client_store`. Any agent with rows in `pending_hashes` would crash on startup — the MCP server never connected.
**Root cause:** `AgentHashQueue` was designed against the V1 KV store. Passing `SQLCipherClientStore` to it post-V2 causes all persistence calls to throw.
**Fix:** Added `loadPending()` to `AgentHashQueue` that pre-populates the in-memory queue from DB-loaded entries, bypassing `ClientStore`. Persistence is now handled by `ClientStatePersistence`; `AgentHashQueue` handles relay protocol mechanics only.
**Rule:** When replacing a persistence mechanism, audit every consumer of the old mechanism. Silent crashes on startup are the most dangerous failure mode.

### 3. Session sequence counters not persisted on leaf accept
**Symptom:** `last_seen_seq`, `last_sent_seq`, and `next_expected_seq` were persisted only on status transitions. A crash between leaf accepts left the reloaded session with stale counters — the next inbound leaf would fail the sequence check, blocking message receipt permanently.
**Fix:** Added `persistSession()` after every sequence counter mutation in `#drainReadyQueue`.
**Rule:** Any field the protocol uses for ordering or deduplication must be persisted immediately after mutation, not batched with status transitions.

### 4. `client.startup.state.loaded` fired before in-memory structures were populated
**Symptom:** AC-013 requires the event to fire "after all in-memory structures populated." It was emitted inside `ClientStatePersistence.loadStartupState()` — before any structure in `CelloClientImpl` was populated.
**Fix:** Removed the emit from `loadStartupState()`. Added it at the end of `loadPersistedState()` in `client.ts`, after FROST, ML-DSA, registration, connections, sessions, peers, and pending requests are all injected.
**Rule:** Events documenting startup completion must fire at the actual completion point, not at the data-loading point.

### 5. Several status transitions never persisted: `transport_lost`, `seal_rejected`, `desynchronized`, Round 2 connection, Round 2 pending round
**Symptom:** Five distinct state mutations updated in-memory but skipped `persistSession()` / `persistConnection()` / `persistPendingConnectionRequest()`. Crashes at these points left the DB and RAM diverged.
**Fix:** Added persist calls at each mutation point.
**Rule:** Every field in the `sessions` schema row is there because some protocol behavior depends on it surviving a restart. If a field is written in RAM, it must be written to DB.

**Review cycle:** 7 code-review passes, 2 sprint-reviewer passes. The first sprint-review pass found AC-001's test was exercising the persistence layer directly rather than `loadPersistedState()` through `CelloClientImpl` — the critical path was untested. Required adding a real-FROST integration test using `trustedDealer` + `loadPersistedState()` on a real `CelloClientImpl` instance.

---

## Related Documents
- [[COORDINATION]] (M6) — migration version registry, downstream story hints
- [[M5-infrastructure-deployment]] — infrastructure state this milestone builds on
- [[CONTEXT]] — canonical glossary

---

## M6-E2E-001 — Stranger Flow Verification (IN PROGRESS)

**Started:** 2026-06-01
**Status:** ACs 001-004 verified. Blocked on M6-DX-001 completing before ACs 005-010.

### Infrastructure fixes deployed during E2E-001 verification

These were not planned stories — they were discovered by actually running the stranger flow:

#### 1. Bootstrap endpoint unreachable (F-003)
**Symptom:** `GET /bootstrap` returned "Only WebSocket connections are supported."
**Root cause:** Port 9090 (health server) not exposed via ALB. Port 8080 only accepts WebSocket upgrades.
**Fix:** Added `BootstrapTargetGroup` (port 9090) and `BootstrapPathRule` (priority 4) to the ALB. ECS `Service` recreated as `DirectoryService` (LogicalId rename) to add a second `LoadBalancers` entry — ECS does not allow updating LoadBalancers on an existing service.
**Rule:** Any new HTTP endpoint on the directory health server requires a corresponding ALB listener rule and target group pointing to port 9090.

#### 2. Directory loses all agent profiles on restart (F-011)
**Symptom:** `target_not_found` for the demo agent after directory service recreation.
**Root cause:** `PgDirectoryStore` uses in-memory Maps for profile lookups but never loads from PostgreSQL at startup. After any restart, every previously registered agent is invisible.
**Fix:** Added `loadProfiles()` to `PgDirectoryStore` — reads all active `agent_profiles` rows at startup. Confirmed: `adapter.profiles.loaded { count: 5 }` on first deploy.
**Broader issue:** The directory holds ~15 in-memory Maps/Sets. Many don't survive restarts. A full audit story is needed post-M6.

#### 3. agent_id not persisted to agent_profiles (F-012)
**Symptom:** `loadProfiles()` crashed with `column "agent_id" does not exist`.
**Root cause:** `agent_id` is generated at registration and kept in memory but never written to the `agent_profiles` table.
**Fix:** V27 migration adds `agent_id TEXT` column (nullable, backfilled by code not by UPDATE to preserve append-only rule). `setProfile()` now writes `agent_id`. `loadProfiles()` reads it with SHA-256 fallback for pre-V27 rows.
**Rule:** Every field in the AgentProfile type must have a corresponding DB column. In-memory-only fields are lost on restart.

#### 4. Directory transport key not persisted — peer ID changes on every restart (F-014)
**Symptom:** Every directory deploy generated a new peer ID, breaking all connected clients.
**Root cause:** `cello-mcp` stores `CELLO_DIRECTORY_MULTIADDR` with a specific peer ID. When the directory restarts with a new transport key, the peer ID changes and all clients fail to connect.
**Fix:** Transport key stored in Secrets Manager (`cello/dev/directory/transport-key`). Directory loads it via `CELLO_DIRECTORY_TRANSPORT_KEY_HEX` env var injected by ECS. Peer ID is now stable across restarts.
**Rule:** Any key that determines a stable identity (peer ID, node pubkey) must be persisted in Secrets Manager, not generated fresh at startup.

#### 5. FROST signer not wired with directoryNodes after restart
**Symptom:** `cello_initiate_session` returned `directory_below_threshold` after MCP server reconnect.
**Root cause:** `loadPersistedState()` in `client.ts` reconstructs `FrostThresholdSigner` with `directoryNodes: undefined`. The signer can verify signatures but cannot participate in FROST ceremonies (which requires routing round-trip frames to the directory). Fixed in M6-DX-001 AC-003.

### npm versioning issues

During the E2E session, `@cello-protocol/connect@0.0.7` was accidentally published to the `latest` dist-tag (tag should have been `beta`). The CI workflow was fixed to default all tag publishes to `beta`; only exact `vX.Y.Z` tags (no suffix) go to `latest`. `latest` was manually reverted to `0.0.6`.

Versions published during M6:
- `0.0.3` — initial REPOSPLIT-002 publish
- `0.0.4` — FROST bootstrap NODE_ENV gate removed
- `0.0.5` — PERSIST-024 wiring
- `0.0.6` — db/migrations in tarball fix (beta, current latest)
- `0.0.7` — bootstrap auto-discovery (accidentally published to latest, reverted)
- `0.0.8` — SQLCipher v6, platform-aware errors, bootstrap auto-discovery (beta)
- `0.0.9` — M6-DX-001 DX fixes (pending M6-DX-001 completion)

### DX findings summary

16 DX issues documented in `E2E-001-findings.md`. The most impactful:
- No `cello_setup_guidance` tool — LLM has no onboarding entry point
- `phone_stub` in `cello_register` — strangers don't know what this is
- 300s monolithic timeout in `cello_request_connection` — silent hang
- Lazy startup not implemented — MCP server blocks Claude Code's 30s timeout on first install
- No startup progress — user sees nothing during 10-20s startup

All addressed in M6-DX-001.
