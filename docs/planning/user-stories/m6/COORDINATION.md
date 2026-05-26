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

## Constraints

**CONSTRAINT: registrations table single-writer assumption.** The Operations Agent writes only from us-east-1. The partial unique index `UNIQUE (phone_stub_hash) WHERE state NOT IN (terminal)` is enforced locally per-node in logical replication — it does NOT prevent cross-region duplicates. Multi-region Ops Agent deployment requires schema redesign. See OPS-AGENT-000 `replication_safety` note.

**CONSTRAINT: npm @cello scope.** Must be claimed on Day 0 before any publish work begins. If contested, fallback to `@cello-protocol/interfaces` and `@cello-protocol/connect`. REPOSPLIT-002 AC-000 is blocked until this is resolved.

**CONSTRAINT: External client → directory/relay transport path.** The directory's libp2p port (4000) is NOT exposed through the ALB. The relay is on a private IP with no external path. All M0-M4 tests ran in-process. Before REPOSPLIT-002 AC-003 or DEMO-001 AC-004b can pass, the transport layer must support external clients connecting via WebSocket through the ALB. See REPOSPLIT-002 `transport_path_prerequisite` implementation note for resolution options.

---
