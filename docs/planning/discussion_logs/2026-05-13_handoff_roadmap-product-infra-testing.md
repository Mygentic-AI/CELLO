---
name: Handoff — Roadmap Product Infrastructure & Testing Strategy
type: discussion
date: 2026-05-13
topics: [handoff, milestone-roadmap, testing, infrastructure, onboarding, persistence, telegram, whatsapp, baileys, e2e-tests]
description: Handoff document summarising the strategic roadmap and testing architecture discussions from 2026-05-13. Covers the decision to resequence M4–M10, the three-tier testing architecture, the onboarding application design, and the unresolved Telegram contact verification question.
---

# Handoff — Roadmap Product Infrastructure & Testing Strategy

**Session date:** 2026-05-13  
**Branch:** `main` (all changes committed, pushed to origin)  
**Last commit:** `2939a8c` (staging architecture ASCII diagram)

---

## What Was Decided This Session

### 1. The implementation roadmap must be rewritten

The existing `implementation-roadmap.md` is a protocol capability roadmap. It has never contained milestones for persistence, production infrastructure, onboarding, or frontend. These are not small gaps — they are entire verticals with no milestone assigned.

The decision: rewrite `implementation-roadmap.md` (not a separate document) with a revised M4–M10 sequence that front-loads infrastructure and product before returning to the remaining protocol capabilities.

**New M4–M8 sequence:**
- M4 — Persistence & Durable Identity (SQLCipher client, PostgreSQL directory/relay, seed phrase recovery)
- M5 — Production Infrastructure (AWS/CDK, staging environment, CI/CD pipeline)
- M6 — Onboarding & Registration Product (Telegram + WhatsApp bots, real OTP, email verification)
- M7 — Portal Surface & Trust Signals (web portal, LinkedIn/GitHub OAuth, SIM scoring)
- M8 — Security & Defense (prompt injection defense, shifted from original M4)

Original M5–M10 (Discovery, Social Trust, Compromise & Recovery, Group Rooms, Commerce, Federation) follow after M8.

**This rewrite has not been done yet.** The discussion is captured but `implementation-roadmap.md` still reflects the old sequence.

### 2. Three-tier testing architecture — with naming correction

CELLO was calling protocol-level tests "E2E tests." These are integration tests. Industry-standard naming adopted:

| Tier | Name | Tooling |
|---|---|---|
| 1 | Unit tests | Vitest |
| 2 | Integration tests | Vitest + real libp2p (currently called "E2E tests") |
| 3 | End-to-end tests | Playwright, bot APIs, scripted agent sessions |

**`e2e-tests/` package to be renamed `integration-tests/` in M4.** Story IDs (CELLO-E2E-001 through CELLO-E2E-004) keep their IDs for historical continuity.

A new `e2e-tests/` package is created for product-level end-to-end tests, structured around surfaces not milestones:
```
e2e-tests/
├── agent-agent/       # Claude Code × Claude Code (M4+, no staging needed)
├── onboarding/        # Telegram sandbox + WhatsApp mock/real (M6+)
├── portal/            # Playwright against staging (M7+)
├── trust-signals/     # OAuth sandboxes (M7+)
└── cross-framework/   # Claude Code × OpenClaw etc. (per adapter)
```

**Core principle:** End-to-end tests ship inside milestones as a close gate — not as a separate testing phase afterward.

### 3. Onboarding application is verification-only — the agent self-registers

The bot does phone OTP + email verification only. It does **not** generate K_local or participate in FROST DKG. When both ceremonies complete, the directory issues a pre-authorization token. The bot delivers it to the operator. The operator configures their agent with the token and calls `cello_register(token)`. FROST DKG runs entirely inside the agent process.

This preserves the split-key security model. The onboarding application never touches K_local.

### 4. Telegram `request_contact` — unresolved but well-researched

Perplexity claimed `contact.user_id == message.from.id` is server-enforced and sufficient for phone verification. The official Telegram Bot API docs do not state this explicitly (`user_id` is marked Optional). A research agent pulled the TDLib/telegram-bot-api source code and found:

- `user_id` in Contact is set by Telegram's server (not the client) — client sends `inputMediaContact` with no `user_id`
- Server populates it by looking up the phone number; absent when number is not registered on Telegram
- A modified client could send an arbitrary contact message but `user_id == from.id` catches the meaningful attack
- The check is considered sufficient by the community with a `None` guard

**The document currently still describes MTProto OTP for Telegram.** The decision to drop it and rely on `contact.user_id == from.id` + None guard was reached but the document has not been updated yet.

---

## Artifacts Created This Session

All committed to `main`:

| Commit | File | What it contains |
|---|---|---|
| `d26deb2` | `docs/planning/discussion_logs/2026-05-13_1130_infrastructure-and-product-onboarding-alignment.md` | Full strategic discussion — gaps in roadmap, revised milestone sequence, three-tier testing architecture, naming correction, incremental staging architecture, ASCII diagram |
| `13257c8` | same | Added incremental E2E architecture section |
| `8bbe88c` | same | Formatting fixes |
| `2939a8c` | same | ASCII staging architecture diagram |

Also committed (by user, not this session):
- `0f9a51c` — `docs/planning/discussion_logs/2026-05-13_1549_onboarding-application-architecture.md` — Detailed onboarding application architecture (Baileys decision, state machine, both paths, testing strategy, deployment model, open questions)

---

## What Needs to Happen Next

### Immediate (next session)

1. **Update `2026-05-13_1549_onboarding-application-architecture.md`** with:
   - Drop MTProto from the Telegram path — replace with `contact.user_id == from.id` + None guard as the phone verification mechanism
   - Simplify Telegram state machine: `INITIAL → AWAITING_CONTACT → PHONE_CONFIRMED` (remove `AWAITING_OTP` from Telegram path)
   - Remove MTProto credentials from the secrets list
   - Add a note about the `user_id is None` guard being mandatory
   - Address the other open issues from the review: directory pre-authorization API transport (HTTP vs libp2p), token consumption on DKG failure, env var vs argument for token presentation, monorepo placement of the onboarding package

2. **Rewrite `docs/planning/implementation-roadmap.md`** — replace M4–M10 with the revised sequence. Each product milestone needs an explicit "End-to-end tests shipped with this milestone" section as a close gate alongside the smoke test gate.

### Open questions not yet resolved

These are in the onboarding architecture document's Open Questions section but worth flagging:

- **Directory pre-authorization API transport** — HTTP endpoint on the directory, or a new libp2p protocol (`/cello/preauth/1.0.0`)? Affects M5 infrastructure stories.
- **Token consumption on DKG failure** — consumed on presentation or on successful completion? Needs a concrete answer before M6 stories are written.
- **Monorepo placement** — is the onboarding application `packages/onboarding/` or a separate repo?
- **Email verification ownership** — one shared service or separate implementations in onboarding app and portal?
- **Single bot vs separate bots** — one WhatsApp number / Telegram handle for registration + operations, or separate?

---

## Key Documents to Read Before Starting

- `docs/planning/discussion_logs/2026-05-13_1130_infrastructure-and-product-onboarding-alignment.md` — the strategic foundation for everything above
- `docs/planning/discussion_logs/2026-05-13_1549_onboarding-application-architecture.md` — onboarding app architecture (needs updates)
- `docs/planning/implementation-roadmap.md` — the document that needs to be rewritten
- `docs/planning/end-to-end-flow.md` — §1.1 and §1.2 for the canonical registration paths

## Suggested Skills

- `/cello-read` — load project context at session start
- `/cello-link` — run after any new discussion logs are added to wire the vault graph
