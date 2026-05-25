---
name: M6 — Beta Launch
milestone: M6
type: outline
date: 2026-05-25
status: active
topics: [beta, operations-agent, telegram, registration, repo-split, npm-publish, demo-agent, cello-connect, pre-authorization-token, FROST, ECS, state-machine, OTP, email-verification]
description: M6 delivers a beta launch — the minimum for a stranger to install @cello/connect, register via Telegram bot, and have a conversation without cloning the repo or running infrastructure. Three legs: installable client (repo split + npm publish), Telegram Operations Agent (registration ceremony), and demo agent (canned responder on EC2). WhatsApp deferred. Portal-first deferred to M7.
---

# M6 — Beta Launch

## What This Milestone Delivers

The overarching goal: **a stranger who read about CELLO on Reddit can install the client, register their agent, and have a conversation — without cloning the repo or running their own infrastructure.**

Three legs required:

1. **Live network** — directory and relay running in production, reachable at a public endpoint (delivered by M5)
2. **Installable client** — `npm install @cello/connect` connects to that network; no configuration required
3. **Registration via bot** — human messages Telegram bot, proves phone + email, gets a pre-authorization token, sets one environment variable, agent calls `cello_register(token)` — FROST DKG runs, agent is live

First-use experience: the stranger registers two agents and has them talk to each other. Self-contained, no second party needed. Demo agent provides an alternative for those who only want one agent.

At the end of M6:
- `@cello/connect` published on npm, installable via `claude mcp add cello npx @cello/connect`
- Telegram Operations Agent running on ECS, accepting registrations
- Demo agent running on EC2, registered on the network, responding to messages
- Full stranger flow verified end-to-end: install → register → exchange messages → verify tamper-evident record
- Package promoted from `@beta` to `latest` only after E2E gate passes

---

## Scope Boundaries

**In scope:**
- Client package extraction to `cello-client` repo, CI pipeline, npm publish as `@cello/connect@beta`
- `AUDIT-ME.md` — falsifiable privacy claims with exact code pointers, written for AI agent verification
- Telegram bot via official Bot API (bot-first registration path only)
- Registration state machine with PostgreSQL persistence
- Phone verification: Telegram `contact.user_id` server-side check (no OTP needed)
- Email verification: 6-digit OTP via SES, 15-minute expiry, 5 sends/hour rate limit
- Pre-authorization token: issued by directory, single-use, 24-hour TTL
- Directory pre-authorization API (`POST /internal/pre-authorize`)
- Operations Agent ECS deployment (no Baileys session persistence needed — Telegram only)
- Demo agent: minimal EC2, canned response, no LLM, no egress except CELLO MCP tools
- E2E gate: full stranger flow verified before `@beta` → `latest` promotion

**Explicitly out of scope (deferred):**
- WhatsApp / Baileys — persistent ECS session state, QR code pairing, single-instance constraint, no sandbox; same AWS fix-loop risk profile as DEPLOY-003 (deferred indefinitely from M6)
- Portal-first registration path — portal UI is M7; correlation token flow ships with portal
- WeChat — jurisdictional prerequisites not satisfiable
- Lifecycle operations surface (security alerts, Not Me, key rotation) — designed and stubbed, ships post-M6
- Trust signal oracles — M10

---

## Package Name and Install Experience

**`@cello/connect`** — install command: `claude mcp add cello npx @cello/connect`

Rationale: carries the right product meaning (connecting your agent to the network), Stripe Connect analogy is apt, unique on npm, natural install command.

---

## Repo Split

Client packages extract from `trustless-cello` monorepo into the existing `cello-client` stub repo (`github.com/Mygentic-AI/cello-client`). The stub is a blank slate — everything can be replaced.

**Packages that move:**
- `packages/protocol-types` → `core/protocol-types`
- `packages/crypto` → `core/crypto`
- `packages/transport` → `core/transport`
- `packages/client` → `core/client`
- `packages/adapter-claude-code` → `core/adapter-claude-code` (publishes as `@cello/connect`)

**Packages that stay in `trustless-cello`:**
- `packages/directory`
- `packages/relay`
- `packages/e2e-tests`
- All IaC, CI/CD, docs/planning vault

**Security rationale:** Open-sourcing the client without the server code prevents handing attackers a sandbox (IaC + server code + ability to spin up attack instances). The moat is the network, not the client.

**`AUDIT-ME.md`** — required before npm publish. Structured as a series of falsifiable privacy claims with exact code pointers. Written for AI agent investigation: someone can point Claude Code at the repo and verify "does the relay ever see my plaintext?" in 20 minutes. Each claim names the files to read. Standard is not "is this technically true" but "is this verifiably true by an AI investigator with no prior knowledge."

Note on circuit relay: in the NAT traversal fallback case, the relay carries the encrypted stream but not plaintext. Noise encryption is end-to-end. AUDIT-ME.md must make this explicit and traceable.

---

## Adapter Pattern

M6 introduces external dependencies behind interfaces with local stubs, following the pattern established in [[2026-05-16_0753_development-pipeline-and-local-iteration|Development Pipeline and Local Iteration Strategy]].

| Interface | Local Stub | Production Implementation |
|-----------|------------|--------------------------|
| `MessagingChannel` | `CliAdapter` — reads from stdin, writes to stdout | `TelegramAdapter` |
| `OtpDeliveryProvider` | Prints OTP to console | AWS SES email delivery |
| `SecurityAlertProvider` | Logs alert locally | Routes to operator's active messaging channel |
| `TokenValidator` | `DevTokenValidator` — accepts 'DEV-' prefix | Directory validates token during FROST DKG |
| `PreAuthorizationClient` | `LocalPreAuthorizationClient` — returns 'DEV-CELLO-' + hex | `DirectoryPreAuthorizationClient` — calls POST /internal/pre-authorize |

**`MessagingChannel` interface** — single interface, multiple implementations. The state machine engine and all business logic import `MessagingChannel` only. The engine does not know whether it is talking to Telegram, CLI, or a future WhatsApp adapter.

```typescript
interface MessagingChannel {
  send(to: string, message: string): Promise<void>
  onMessage(handler: (from: string, message: string) => void): void
  resolveIdentity(from: string): Promise<ChannelIdentity>
}

type ChannelIdentity = {
  channel: 'telegram' | 'whatsapp' | 'cli'
  phoneNumber?: string   // Telegram: from contact.user_id
  channelUserId: string  // channel-native identifier
}
```

---

## The Operations Agent Is Not Part of the Directory

The Operations Agent is a standalone deployable. It calls the CELLO directory's pre-authorization API, but it does not implement the CELLO protocol itself. It is a product shell around the directory's registration API.

**The directory's job:** protocol and key material.
**The Operations Agent's job:** the human operator's experience.

They do not know each other's implementation details. The path by which an operator proves they are a real human must be isolated from the path by which the agent performs cryptographic key generation.

---

## Registration Is Verification-Only

The Operations Agent proves a real human authorized a registration — via phone and email — and issues a pre-authorization token as evidence. It does not generate K_local. It does not participate in FROST DKG.

**Why:** The split-key security model holds only if K_local is generated inside the agent process and never leaves it.

**The bridge: pre-authorization token.** When both phone and email are confirmed, the directory issues a short-lived, single-use pre-authorization token. The bot delivers it to the operator. The operator sets it in agent config. The agent calls `cello_register(token)`. The directory validates the token during FROST DKG and marks it consumed. K_local is generated inside the agent process throughout.

```
Bot side (human-facing)               Agent side (technical)
─────────────────────────             ──────────────────────────────────
Phone verified (contact.user_id)
Email OTP verified
Directory issues pre-auth token
Bot: "Your token: CELLO-XXXXX"        Operator: CELLO_REGISTRATION_TOKEN=CELLO-XXXXX
                                      Agent: cello_register("CELLO-XXXXX")
                                      FROST DKG runs over libp2p
                                      K_local generated inside agent process
                                      Registration complete
```

---

## Registration State Machine

Every in-flight registration is a state machine instance, keyed by the originating phone number hash (the phone number itself is never stored). Persisted in PostgreSQL; survives restarts.

### Telegram path

```
INITIAL
  ↓  first message or /start received; request_contact button sent
AWAITING_CONTACT
  ↓  user taps contact button; contact.user_id == message.from.id verified
PHONE_CONFIRMED
  ↓  bot prompts for email address
AWAITING_EMAIL
  ↓  6-digit OTP sent to email address via SES
AWAITING_EMAIL_OTP
  ↓  OTP verified
EMAIL_CONFIRMED
  ↓  directory issues pre-authorization token
PRE_AUTH_TOKEN_ISSUED
  ↓  bot delivers token to operator — state machine ends here
```

### State timeouts and retries

- `AWAITING_CONTACT`: re-prompt if no contact shared within 10 minutes
- `AWAITING_EMAIL_OTP`: OTP expires after 15 minutes; max 3 attempts before requiring new send; rate-limited to 5 sends/hour per email address
- `PRE_AUTH_TOKEN_ISSUED`: token TTL 24 hours, enforced by directory; expired token requires full re-verification from `INITIAL`
- Any state: 7-day idle timeout discards in-flight record; phone number eligible for new registration

### Portal-first entry (M7)

When an operator begins at the web portal (M7), the portal completes email verification and issues a portal session. The operator messages the bot. The bot initializes the state machine from `EMAIL_CONFIRMED`. This path is designed but not implemented at M6.

---

## Demo Agent

**Purpose-built on EC2. Minimal. No LLM backend. Canned response.**

Responds to CELLO messages with a fixed string: "CELLO message received. Your conversation is sealed and tamper-evident."

- Locked-down EC2, no egress except CELLO MCP tools
- `@cello/connect` installed, registered on the network
- Near-zero attack surface
- Fully independent from the OPS-AGENT chain — depends only on REPOSPLIT-001

IronClaw and Hermes are extensible multi-channel agents with attack surface. A demo agent that echoes a canned response has near-zero attack surface by construction.

---

## Story Breakdown

### Domains and Stories

**REPOSPLIT domain**
- `REPOSPLIT-001`: Extract client packages to cello-client repo, wire CI pipeline, production endpoint baked in, `AUDIT-ME.md`, publish as `@cello/connect@beta`

**OPS-AGENT domain**
- `OPS-AGENT-000`: Registration interface contracts — `MessagingChannel`, `OtpDeliveryProvider`, `TokenValidator`, `SecurityAlertProvider` interfaces; pre-authorization token schema; registration state machine states as TypeScript types; local stubs for all interfaces; **complete schema design** for all tables the state machine requires (migration version numbers V24+ reserved here)
- `OPS-AGENT-001`: Directory pre-authorization API — `POST /internal/pre-authorize`, token issuance, single-use consumption at FROST DKG presentation
- `OPS-AGENT-002`: Registration state machine — PostgreSQL-backed, Telegram path, state timeouts and retries
- `OPS-AGENT-003`: Telegram adapter — `TelegramAdapter` implementing `MessagingChannel`, phone verification via `contact.user_id`, Telegram sandbox support
- `OPS-AGENT-004`: Email OTP service — SES delivery via `OtpDeliveryProvider`, 6-digit OTP, 15-minute expiry, 5-sends/hour rate limit
- `OPS-AGENT-005A`: Operations Agent IaC — ECR repo, ECS task definition, Secrets Manager wiring (Telegram tokens, SES credentials, directory API key), deployed with stub container returning 200. Infra proven before app code touches it.
- `OPS-AGENT-005B`: Wire application code into proven ECS deployment

**DEMO domain**
- `DEMO-001`: Minimal demo agent — EC2, locked-down (no egress except CELLO MCP tools), CELLO client installed, registered on network, canned response handler

**E2E gate**
- `M6-E2E-001`: Full stranger flow — install `@cello/connect`, register via Telegram bot, exchange messages with demo agent, verify tamper-evident record. Flip package from `@beta` to `latest` only after this passes.

### Dependency Graph

```
OPS-AGENT-000 → OPS-AGENT-001 ───────────────────────────────────────────────┐
              → OPS-AGENT-002 → OPS-AGENT-003 ┐                               │
              →                 OPS-AGENT-004 ┘→ OPS-AGENT-005B ──────────── M6-E2E-001
              → OPS-AGENT-005A ────────────────────────────────→ OPS-AGENT-005B
REPOSPLIT-001 → DEMO-001 (code) ─────────────────────────────────────────────↗
              OPS-AGENT-005B → DEMO-001 (registration / AC-000) ─────────────↗
```

**Parallel from day one:**
- REPOSPLIT-001 structural work (CI, AUDIT-ME.md, README) — starts immediately, zero dependency on M5 close
- OPS-AGENT-000 — starts immediately, zero dependency on M5 close
- OPS-AGENT-001, OPS-AGENT-002, and OPS-AGENT-005A — all parallel after OPS-AGENT-000 merges
- OPS-AGENT-003 and OPS-AGENT-004 — parallel after OPS-AGENT-002 merges
- DEMO-001 code (AC-001 through AC-007) — parallel with entire OPS-AGENT chain, depends only on REPOSPLIT-001
- DEMO-001 registration (AC-000) — requires OPS-AGENT-005B deployed (bot live in production)

---

## Story Structure Mitigations

These are not process intentions — they are encoded as blocking ACs in the stories themselves. See [[2026-05-25_1100_m5-retrospective-lessons-learned]] for the root cause analysis that produced them.

### Mitigation A — OPS-AGENT-005 Split (resolves DEPLOY-003 fix-loop risk)

Split into 005A (IaC stub only, proves deployment path) and 005B (wire app code). Separates "infra works" gate from "code works" gate. Reduces blast radius — infra debugging separated from application debugging.

### Mitigation B — Incremental Integration Gate ACs (resolves E2E integration failure risk)

Each story includes a blocking integration gate AC as its final acceptance criterion.

**Standard AC language (verbatim in every OPS-AGENT story):**

```
AC-[N]: Incremental integration gate — Before this branch merges, run the partial
E2E flow specified above against a local environment with all prior M6 migrations
already applied. Flyway must report zero checksum errors on any migration V24 through
V[N-1]. This AC is blocking. No downstream story may begin implementation until this
story's integration gate AC is verified and the story is merged.
```

**Per-story integration gate checkpoints:**

| Story | What the gate verifies |
|---|---|
| OPS-AGENT-000 | All stubs compile. All migration SQL applies to fresh Postgres. V24+ not claimed by any existing file. |
| OPS-AGENT-001 | `POST /internal/pre-authorize` returns token. Single-use consumption verified. Second use rejected. Flyway clean. |
| OPS-AGENT-002 | State machine driven INIT → COMPLETED against real local Postgres. State survives process restart. Pre-auth token cannot be reused. Flyway clean. |
| OPS-AGENT-003 | Telegram sandbox bot: registration message sent, state machine advances through phone verification to OTP-pending. Flyway clean. |
| OPS-AGENT-004 | OTP delivered to SES sandbox address. Correct OTP advances state. Expired OTP rejected. 6th send/hour returns rate-limit error. Flyway clean. |

### Mitigation C — Schema-Complete OPS-AGENT-000 (resolves migration conflict risk)

OPS-AGENT-000 produces the complete schema design for all tables the registration state machine requires, with migration version numbers V24+ explicitly reserved. No reactive migrations added mid-milestone.

### Mitigation D — Beta Publish Gate in REPOSPLIT-001 (resolves REPOSPLIT complexity risk)

Publish as `@cello/connect@beta`, not `latest`. Promote to `latest` only as an explicit AC in M6-E2E-001 after full stranger flow is verified.

---

## Bootstrap Checklist (M6 Pre-Implementation)

| Item | Status | Notes |
|---|---|---|
| SES us-east-1 production access | Done (2026-05-25) | Domain verified, DKIM + MAIL FROM configured, sandbox lifted |
| SES DNS records (DKIM + MAIL FROM) | Done (2026-05-25) | 3 DKIM CNAMEs + MX/TXT for `mail.mygentic.ai` |
| Production Telegram bot (BotFather) | Done (2026-05-25) | `@CelloConnectBot` — token in Secrets Manager `cello/ops-agent/telegram-bot-token` |
| Staging Telegram bot (BotFather) | Done (2026-05-25) | `@CelloConnectStagingBot` — token in Secrets Manager `cello/ops-agent/telegram-bot-token-staging` |
| Telegram sandbox bot (test API) | N/A | Staging bot (`@CelloConnectStagingBot`) satisfies all OPS-AGENT-003 integration ACs — separate sandbox not needed |
| npm `@cello` scope configured | Pending | Required for REPOSPLIT-001 publish |

---

## Deployment Model

### ECS (not Lambda)

The Operations Agent runs as a long-lived ECS Fargate task. While Telegram alone would work on Lambda, the architecture is designed to accommodate future WhatsApp/Baileys addition (which requires persistent WebSocket connections). One deployable is operationally simpler than a split topology.

No Baileys session persistence required at M6 — Telegram Bot API is stateless HTTP.

### Secrets (Secrets Manager)

- Telegram bot token (production)
- Telegram bot token (staging)
- SES credentials for email verification
- CELLO directory internal API key (for pre-authorization endpoint call)

---

## Directory Pre-Authorization API

New internal endpoint added to the directory in M6:

**`POST /internal/pre-authorize`** — accepts phone hash and email domain from the Operations Agent after both ceremonies complete. Returns a pre-authorization token (short-lived, single-use, 24-hour TTL). Internal network only — not reachable from the public internet.

**Token consumption:** consumed at FROST DKG presentation. On presentation (not on success) — a transient DKG failure requires the operator to get a new token via the bot. Token stored in directory PostgreSQL with `consumed_at` timestamp.

---

## Milestone Close Gate

1. `@cello/connect@beta` published on npm and installable
2. Telegram bot-first registration: operator messages bot → phone verified via `contact.user_id` → email OTP verified → pre-authorization token delivered → agent calls `cello_register(token)` → FROST DKG completes → agent registered
3. Token consumption: pre-authorization token consumed on first use; second attempt returns `PRE_AUTH_TOKEN_CONSUMED`
4. State machine restart: kill Operations Agent mid-registration at `AWAITING_EMAIL_OTP` → restart → operator resumes from same state
5. Demo agent responds to CELLO messages with canned response
6. Full stranger flow: install `@cello/connect` → register via bot → exchange messages with demo agent → verify record
7. Package promoted from `@beta` to `latest` only after gate 6 passes

---

## Current Infrastructure State

- Highest Flyway migration: **V23** (`V23__agent_profiles_account_id.sql`)
- M6 migrations start at: **V24**
- M5 close: in progress at planning time (2026-05-25), SmokeTest passed

---

## Related Documents

- [[2026-05-25_0900_m6-beta-launch-planning]] — full planning session decisions, adversarial analysis, risk mitigations
- [[2026-05-25_1100_m5-retrospective-lessons-learned]] — root cause analysis that produced Mitigations B and C
- [[2026-05-13_1549_onboarding-and-operations-agent-architecture]] — original Operations Agent architecture (WhatsApp + Telegram scope)
- [[2026-05-13_1130_infrastructure-and-product-onboarding-alignment]] — established M6 as the onboarding milestone
- [[end-to-end-flow]] — §1.1 and §1.2 canonical source for registration paths
- [[server-infrastructure]] — directory registration API, OTP channel support, phone hash uniqueness
- [[2026-05-16_0753_development-pipeline-and-local-iteration]] — adapter pattern, composition root, local iteration model
- [[M5-infrastructure-deployment]] — IaC patterns proven in M5 that OPS-AGENT-005A inherits
