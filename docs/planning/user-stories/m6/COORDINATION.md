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

---
