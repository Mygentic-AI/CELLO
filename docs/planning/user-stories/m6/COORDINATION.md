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

**Post-merge actions required before REPOSPLIT-002 can begin:**
1. Push trustless-cello main to origin — triggers CI/CD pipeline and ECS directory deployment
2. Monitor directory ECS deployment (use loop skill at 3-minute intervals)
3. After deployment stabilises, run `transport-path.test.ts` against the live ALB to verify AC-007 all three dimensions
4. Push tag `v0.0.0-scaffold.1` to cello-client, verify `@cello-protocol/connect@0.0.0-scaffold.1` publishes successfully, then immediately unpublish/deprecate

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

## Constraints

**CONSTRAINT: registrations table single-writer assumption.** The Operations Agent writes only from us-east-1. The partial unique index `UNIQUE (phone_stub_hash) WHERE state NOT IN (terminal)` is enforced locally per-node in logical replication — it does NOT prevent cross-region duplicates. Multi-region Ops Agent deployment requires schema redesign. See OPS-AGENT-000 `replication_safety` note.

**CONSTRAINT: npm @cello scope.** Must be claimed on Day 0 before any publish work begins. If contested, fallback to `@cello-protocol/interfaces` and `@cello-protocol/connect`. REPOSPLIT-002 AC-000 is blocked until this is resolved.

**CONSTRAINT: External client → directory/relay transport path.** ~~The directory's libp2p port (4000) is NOT exposed through the ALB.~~ **RESOLVED by REPOSPLIT-001 (AC-007).** Directory now accepts WebSocket connections on port 8080 through the existing ALB. CloudFormation committed; deployment required before REPOSPLIT-002 AC-003 or DEMO-001 AC-004b can be verified against live infra.

---
