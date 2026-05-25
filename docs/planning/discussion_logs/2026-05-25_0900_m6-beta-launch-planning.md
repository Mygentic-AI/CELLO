---
name: M6 Beta Launch Planning — Roadmap, Red Team, and Story Structure
type: discussion
date: 2026-05-25
topics: [m6, beta, roadmap, red-team, pre-mortem, steelman, stories, repo-split, operations-agent, demo-agent, npm-publish, integration-gate, flyway, migrations]
status: active
description: Full planning session for M6 beta launch by June 3rd. Covers goal alignment, story breakdown, dependency graph, adversarial analysis (pre-mortem + red team), steelman, story structure mitigations, and — added post-retrospective — resolved attack dispositions, OPS-AGENT-000 story YAML decision, and Mitigation B incremental integration gate AC language with per-story Flyway checkpoints. Highest-migration version at session close is V23 — M6 migrations start at V24.
---

# M6 Beta Launch Planning — 2026-05-25

## Context

- Today is May 25, 2026
- M5 (FEDERATION-E2E-001) is ~85% complete — ProductionDeploy in progress at session time, SmokeTest passed
- Working days remaining to June 3rd: **9** (May 25–29, 31, June 1–3; May 30 off)
- me-central-1 (UAE) is down indefinitely due to regional infrastructure issues — off the table for all planning

---

## Goal Alignment

The overarching goal: **a stranger who read about CELLO on Reddit can install the client, register their agent, and have a conversation — without cloning the repo or running their own infrastructure.**

Working backwards, the three legs required:

1. **Live network** — directory and relay running in production, reachable at a public endpoint
2. **Installable client** — `npm install @cello/connect` connects to that network; no configuration required
3. **Registration via bot** — human messages Telegram bot, proves phone + email, gets a pre-authorization token, sets one environment variable, agent calls `cello_register(token)` — FROST DKG runs, agent is live

First-use experience: the stranger registers two agents and has them talk to each other. Self-contained, no second party needed. Demo agent provides an alternative for those who only want one agent.

---

## Key Decisions Made

### Package Name
**`@cello/connect`** — install command: `claude mcp add cello npx @cello/connect`

Rationale: carries the right product meaning (connecting your agent to the network), Stripe Connect analogy is apt, unique on npm, natural install command. "Overloaded ecosystem" downside judged minor — no real confusion risk in practice.

### Repo Split
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

**`AUDIT-ME.md`** — required before npm publish. A file structured as a series of falsifiable privacy claims with exact code pointers. Written for AI agent investigation: someone can point Claude Code at the repo and verify "does the relay ever see my plaintext?" in 20 minutes. Each claim names the files to read. Standard is not "is this technically true" but "is this verifiably true by an AI investigator with no prior knowledge."

Example structure:
```
Claim: The relay never sees your message content in plaintext.
Verify:
- packages/transport/src/... — Noise encryption configured here
- packages/transport/src/... — circuit relay fallback invoked here
- Encryption wraps the stream before it reaches any relay node
```

Note on circuit relay: in the NAT traversal fallback case, the relay carries the encrypted stream but not plaintext. Noise encryption is end-to-end. AUDIT-ME.md must make this explicit and traceable.

### WhatsApp Deferred
Telegram only for M6. WhatsApp/Baileys deferred — persistent ECS session state, QR code pairing, single-instance constraint, no sandbox. These have the same AWS fix-loop risk profile as DEPLOY-003. Not worth the risk for beta.

### Demo Agent
**Purpose-built on EC2. Minimal. No LLM backend. Canned response.**

Rationale: IronClaw and Hermes are extensible multi-channel agents with attack surface. A demo agent that responds to CELLO messages with a canned string ("CELLO message received. Your conversation is sealed and tamper-evident.") has near-zero attack surface. Locked-down EC2, no egress except CELLO MCP tools.

Claude Code agent acceptable for M6 **internal testing only** (cron loop limitations don't matter for a test harness).

### SES
- eu-west-1 (Ireland) — production access request submitted day one of M6
- me-central-1 was configured in February but region is down indefinitely
- Risk of SES approval delay accepted — will monitor email and respond quickly to AWS requests

### M6 as One Milestone
All three legs (repo split, Operations Agent, demo agent) required for the "stranger can try it" close gate. Splitting into two milestones means neither delivers a complete experience. Stays as M6.

---

## M6 Story Breakdown

### Domains and Stories

**REPOSPLIT domain**
- `REPOSPLIT-001`: Extract client packages to cello-client repo, wire CI pipeline, production endpoint baked in, `AUDIT-ME.md`, publish as `@cello/connect@beta`

**OPS-AGENT domain**
- `OPS-AGENT-000`: Registration interface contracts — `MessagingChannel`, `OtpDeliveryProvider`, `TokenValidator`, `SecurityAlertProvider` interfaces; pre-authorization token schema; registration state machine states as TypeScript types; local stubs for all interfaces; **complete schema design** for all tables the state machine requires (migration version numbers V24+ reserved here)
- `OPS-AGENT-001`: Directory pre-authorization API — `POST /internal/pre-authorize`, token issuance, single-use consumption at FROST DKG presentation
- `OPS-AGENT-002`: Registration state machine — PostgreSQL-backed, Telegram path + portal-first entry, state timeouts and retries
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
OPS-AGENT-000 → OPS-AGENT-001 ──────────────────────────────────────────────┐
              → OPS-AGENT-002 → OPS-AGENT-003 ┐                              │
                                OPS-AGENT-004 ┘→ OPS-AGENT-005A → 005B ──── M6-E2E-001
REPOSPLIT-001 → DEMO-001 ────────────────────────────────────────────────────↗
```

**Parallel from day one:**
- REPOSPLIT-001 structural work (CI, AUDIT-ME.md, README) — starts today, zero dependency on M5 close
- OPS-AGENT-000 — starts today, zero dependency on M5 close
- OPS-AGENT-001 and OPS-AGENT-002 — parallel after OPS-AGENT-000 merges
- OPS-AGENT-003 and OPS-AGENT-004 — parallel after OPS-AGENT-002 merges
- DEMO-001 — parallel with entire OPS-AGENT chain, depends only on REPOSPLIT-001

---

## Bootstrap Checklist (M6 Pre-Implementation)

| Item | Status | Notes |
|---|---|---|
| SES eu-west-1 production access request | Submit day one | Hard blocker for OPS-AGENT-004 |
| Production Telegram bot (BotFather) | Pending | Token → Secrets Manager |
| Staging Telegram bot (BotFather) | Pending | Token → Secrets Manager |
| Telegram sandbox bot (test API) | Pending | `api.telegram.org/bot<token>/test` |
| npm `@cello` scope configured | Pending | Required for REPOSPLIT-001 publish |

---

## Risk Analysis and Mitigations

### Pre-Mortem (imagining June 4th failure)

1. M5 didn't close May 25th — bleeds into M6 window
2. REPOSPLIT-001 harder than expected — pnpm workspace, TS project refs, CI from scratch
3. OPS-AGENT-005A/B becomes another DEPLOY-003 — AWS fix loops
4. SES approval delayed — OPS-AGENT-004 blocked
5. E2E gate catches multi-system integration failure — everything works in isolation, nothing works together
6. Federation migrations conflict — OPS-AGENT-002 claims version number already used
7. Demo agent underscoped — needs LLM backend, Bedrock credentials, attack surface

### Red Team (active attack on the plan)

Most dangerous chain: **Attack 1 + Attack 3 (OPS-AGENT-005) + Attack 5 (E2E gate)** — M5 bleeds a day, OPS-AGENT-005A/B burns two days in fix loops, E2E gate catches integration failures. Arrive at June 3rd with everything working in isolation and nothing working end-to-end.

### Steelman (why it ships)

- M5 IaC pattern proven — OPS-AGENT-005A is not DEPLOY-003 because we already paid that tax
- Pure TypeScript stories (OPS-AGENT-000 through 004) move at AI coder speed
- Telegram is a standard REST API with a sandbox — no Baileys session state complexity
- Two parallel tracks from day one — REPOSPLIT and OPS-AGENT-000 start immediately
- Bootstrap checklist exists — no mid-sprint surprise blockers
- Demo agent is purposely minimal — no LLM, no egress, canned response

### Story Structure Mitigations (must be encoded in stories, not just verbal)

**Mitigation A — OPS-AGENT-005 split (resolves Attack 3)**
Split into 005A (IaC stub only, proves deployment path) and 005B (wire app code). Separates "infra works" gate from "code works" gate. Eliminates the DEPLOY-003 pattern of debugging both simultaneously.

**Mitigation B — Incremental E2E validation (resolves Attack 5)**
Each story must include a completion criterion: run the partial end-to-end flow up to that story's boundary before merging. By the time M6-E2E-001 runs formally, it's verifying integration of already-proven pieces. Must appear as explicit ACs, not just process intention.

**Mitigation C — Schema-complete OPS-AGENT-000 (resolves Attack 6)**
OPS-AGENT-000 is not just interface contracts — it also produces the complete schema design for all tables the registration state machine requires, with migration version numbers V24+ explicitly reserved. No reactive migrations added mid-milestone. This is the lesson from M4's PERSIST-018/019/020 reactive additions that forced FEDERATION-003, PERSIST-023, and ACCOUNT-001 to renumber.

**Mitigation D — Beta publish gate in REPOSPLIT-001 (resolves Attack 2)**
REPOSPLIT-001 AC: publish as `@cello/connect@beta`, not `latest`. Promote to `latest` only as an explicit AC in M6-E2E-001 after full stranger flow is verified. Must be an AC in the story, not a verbal agreement.

---

## Revised Milestone Sequence (M6 onwards)

| Milestone | Delivers |
|---|---|
| **M6** | Beta launch — installable client, Telegram registration, demo agent |
| **M7** | Portal skeleton — magic link + WebAuthn auth, agent dashboard, basic management |
| **M8** | Prompt injection defense — DeBERTa pipeline, before discovery opens the network |
| **M9** | Discovery and notifications — bio, search, contact aliases |
| **M10** | Trust signals — LinkedIn, GitHub, phone, device attestation |
| **M11** | Social trust — endorsements, Sybil floor |
| **M12** | Compromise and recovery — Not Me, social recovery, key rotation |
| **M13** | Group rooms |
| **M14** | Commerce |
| **M15** | Federation |

M8 (prompt injection) moved earlier than original roadmap — security story must be credible before discovery opens the network to strangers.

---

## Resolved Since Initial Write

### OPS-AGENT-000 Is Its Own Story YAML
OPS-AGENT-000 gets a full story YAML with ACs and sprint-reviewer gate. It produces concrete artifacts (TypeScript interfaces, migration version reservations, state machine type definitions) that a sprint-coder runs against and a sprint-reviewer checks. The schema-completeness check is the AC. A sprint-reviewer must approve OPS-AGENT-000 before any parallel implementation story begins.

### All Seven Adversarial Attacks Resolved

| Attack | Disposition |
|---|---|
| 1 — M5 bleeding | Assumption accepted. SmokeTest passed, ProductionDeploy in final cycle at session time. |
| 2 — REPOSPLIT complexity | Mitigation D — beta publish gate AC in REPOSPLIT-001. |
| 3 — OPS-AGENT-005 fix loop | Mitigation A — 005A/B split. See retrospective for full root cause analysis. |
| 4 — SES approval delay | Acceptable risk. Historical turnaround under 24h with responsive email monitoring. |
| 5 — E2E integration failure | Mitigation B — incremental integration gate ACs per story. |
| 6 — Migration conflict | Mitigation C — schema-complete OPS-AGENT-000 with V24+ reserved. |
| 7 — Demo agent underscoped | Prior Telegram agent experience, backup options (IronClaw/Hermes), fully independent from OPS-AGENT chain. |

### Mitigation B — Incremental Integration Gate AC Language

The root cause analysis for Attack 3 and Attack 5 is documented in [[2026-05-25_1100_m5-retrospective-lessons-learned]]. The short version: FEDERATION-002 modified V18 after it was applied, causing a Flyway checksum crash that surfaced inside DEPLOY-002/003 instead of at the source. The fix-loop happened in the wrong story.

Mitigations B and C address the root cause. Mitigation A reduces the blast radius if B and C fail.

**Standard AC language (included verbatim as the final AC in every OPS-AGENT story):**

```
AC-[N]: Incremental integration gate — Before this branch merges, run the partial
E2E flow specified above against a local environment with all prior M6 migrations
already applied. Flyway must report zero checksum errors on any migration V24 through
V[N-1]. This AC is blocking. No downstream story may begin implementation until this
story's integration gate AC is verified and the story is merged.
```

The Flyway check runs against an environment with prior migrations already applied — not a fresh database. A fresh database will not catch migration modification.

**Per-story integration gate checkpoints:**

| Story | What the gate verifies |
|---|---|
| OPS-AGENT-000 | All stubs compile. All migration SQL applies to fresh Postgres. V24+ not claimed by any existing file. |
| OPS-AGENT-001 | `POST /internal/pre-authorize` returns token. Single-use consumption verified. Second use rejected. Flyway clean. |
| OPS-AGENT-002 | State machine driven INIT → COMPLETED against real local Postgres. State survives process restart. Pre-auth token cannot be reused. Flyway clean. |
| OPS-AGENT-003 | Telegram sandbox bot: registration message sent, state machine advances through phone verification to OTP-pending. Flyway clean. |
| OPS-AGENT-004 | OTP delivered to SES sandbox address. Correct OTP advances state. Expired OTP rejected. 6th send/hour returns rate-limit error. Flyway clean. |

---

## Open Items

- M6 outline document to be written incorporating all of the above
- Implementation roadmap (`docs/planning/implementation-roadmap.md`) to be updated with revised milestone sequence M6–M15
- M6 story YAMLs to be written: REPOSPLIT-001, OPS-AGENT-000 through 005B, DEMO-001, M6-E2E-001

## Related Analysis

- [[2026-05-25_1400_reposplit-001-investigation]] — full pre-implementation investigation for REPOSPLIT-001: test dependency problem, interfaces/test-fixtures placement decisions, cello-client repo state, CI pipeline design, AC-004 endpoint gaps, SI enforcement, post-split trustless-cello state, and prerequisites checklist

---

## Current Infrastructure State

- Highest Flyway migration: **V23** (`V23__agent_profiles_account_id.sql`)
- M6 migrations start at: **V24**
- M5 ProductionDeploy: in progress at session time, SmokeTest passed
