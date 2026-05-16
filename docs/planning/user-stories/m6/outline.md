---
name: M6 — Operations Agent
milestone: M6
type: outline
date: 2026-05-15
status: active
topics: [operations-agent, onboarding, registration, whatsapp, telegram, baileys, OTP, state-machine, bot, pre-authorization-token, FROST, ECS, testing, correlation-token, email-verification, lifecycle-operations]
description: M6 delivers the CELLO Operations Agent — the persistent out-of-band operator channel via WhatsApp (Baileys) and Telegram. Registration becomes a real ceremony: phone OTP, email OTP, pre-authorization token issued to the operator, agent self-registers via cello_register(token). Bot-first and portal-first paths both supported. ECS deployment with Baileys session persistence. Full E2E test suite (Telegram sandbox CI-gated, WhatsApp hybrid approach).
---

# M6 — Operations Agent

## What This Milestone Delivers

M6 turns registration from a developer terminal exercise into a product. Before M6, "registration" means an engineer running `cello_register` over the MCP adapter with no human ceremony. That is not a product.

After M6, any operator can register a CELLO agent by messaging a bot on WhatsApp or Telegram. Phone ownership is verified through the channel itself (OTP via WhatsApp, Telegram's server-side `contact.user_id` check). Email ownership is verified via 6-digit OTP in the same bot conversation. The directory issues a pre-authorization token. The operator configures their agent with the token. The agent calls `cello_register(token)` — FROST DKG runs between the agent and the directory, K_local is generated inside the agent process, and the agent is registered.

The Operations Agent is also the foundation for the entire post-registration operator lifecycle: security alerts (`FALLBACK_CANARY`), emergency "Not Me" revocation, key rotation nudges, succession notifications, and trust signal delivery confirmations. M6 ships the registration flow. The lifecycle operations surface is designed and stubbed — it ships in subsequent milestones.

At the end of M6:
- WhatsApp bot (Baileys) and Telegram bot both operational on staging and production
- Bot-first and portal-first registration paths both complete
- Pre-authorization token flow working end-to-end: bot issues token, agent presents it during FROST DKG, directory validates and consumes it
- Telegram E2E tests running in CI against staging
- WhatsApp: mock-transport E2E tests in CI, Baileys smoke tests in pre-release checklist
- Registration state machine persisted in PostgreSQL, surviving restarts

## Scope Boundaries

**In scope:**
- WhatsApp bot via Baileys
- Telegram bot via official Bot API
- Bot-first registration path (both channels)
- Portal-first registration path (both channels) — requires portal correlation token from directory
- Registration state machine with full persistence
- Phone verification: OTP via WhatsApp bot message; Telegram `contact.user_id` server-side check
- Email verification: 6-digit OTP, 15-minute expiry, 5 sends/hour rate limit, bot-channel delivery
- Pre-authorization token: issued by directory, single-use, 24-hour TTL
- Directory pre-authorization API (new internal endpoint)
- ECS deployment with Baileys session persistence (EFS volume or Postgres-backed auth state adapter)
- End-to-end test suites: Telegram sandbox (CI-gated), WhatsApp hybrid (mock transport CI, Baileys smoke manual)

**Explicitly out of scope:**
- WeChat — jurisdictional prerequisites (Chinese business entity, ICP licensing) not satisfiable at M6; designed into architecture but adapter not built until prerequisites met
- Official WhatsApp Business API — migration from Baileys is a planned event, not M6 scope; Baileys is the M6 implementation
- Lifecycle operations surface (security alerts, Not Me, key rotation nudges, succession) — designed and stubbed, ships post-M6
- Portal UI — M7 scope; the portal-first correlation token endpoint on the directory side is built in M6 (the portal-first bot path must work), but the portal UI itself is M7
- Trust signal oracles (LinkedIn, GitHub, SIM scoring) — M7

---

## Adapter Pattern

M6 introduces three new external dependencies. Each is behind an interface with a local stub implementation. This follows the pattern established for all external dependencies in [[2026-05-16_0753_development-pipeline-and-local-iteration|Development Pipeline and Local Iteration Strategy]].

| Interface | Local Stub | Production Implementation |
|-----------|------------|--------------------------|
| `MessagingChannel` | `CliAdapter` — reads from stdin, writes to stdout | `BaileysAdapter` (WhatsApp), `TelegramAdapter` |
| `OtpDeliveryProvider` | Prints OTP to console | AWS SES email delivery |
| `SecurityAlertProvider` | Logs alert locally | Routes to operator's active messaging channel |
| `TokenValidator` | Hardcoded dev token → fixed Principal | Directory JWT validation |

**`MessagingChannel` interface** — single interface, multiple implementations. The state machine engine and all business logic import `MessagingChannel` only. The engine does not know whether it is talking to Baileys, Telegram, or the CLI adapter.

```typescript
interface MessagingChannel {
  send(to: string, message: string): Promise<void>
  onMessage(handler: (from: string, message: string) => void): void
  resolveIdentity(from: string): Promise<ChannelIdentity>
}

type ChannelIdentity = {
  channel: 'whatsapp' | 'telegram' | 'wechat' | 'cli'
  phoneNumber?: string   // WhatsApp: from Baileys JID; Telegram: from contact.user_id
  channelUserId: string  // channel-native identifier
}
```

**WeChat accommodation:** `MessagingChannel` is designed to accommodate WeChat as a first-class channel from the start — the `channel` discriminant includes `'wechat'` even though `WeChatAdapter` is not built at M6. The interface must not be designed around only two channels.

**`CliAdapter` as the CI test transport:** the "fake Baileys transport" described in prior documents is the `CliAdapter`. It is a real implementation of `MessagingChannel` over stdin/stdout — not a mock. The state machine exercises identical logic paths regardless of which adapter is loaded.

**`SecurityAlertProvider`** is designed and stubbed at M6 for the lifecycle operations that ship in later milestones. The stub logs locally. The production implementation routes to the operator's active messaging channel via the same `MessagingChannel` interface.

---

## The Operations Agent Is Not Part of the Directory

The Operations Agent is a standalone deployable. It calls the CELLO directory's pre-authorization API, but it does not implement the CELLO protocol itself. It is a product shell around the directory's registration and notification APIs.

**The directory's job:** protocol and key material.
**The Operations Agent's job:** the human operator's experience.

They do not know each other's implementation details. This separation matters for security: the path by which an operator proves they are a real human must be isolated from the path by which the agent performs cryptographic key generation. The Operations Agent proves identity. The agent performs key generation. These must not be the same process.

---

## Registration Is Verification-Only

The Operations Agent is verification-only. It proves a real human authorized a registration — via phone and email — and issues a pre-authorization token as evidence. It does not generate K_local. It does not participate in FROST DKG.

**Why:** The split-key security model holds only if K_local is generated inside the agent process and never leaves it. Generating K_local in the Operations Agent — even transiently — creates a custody moment that violates the model. The entire security claim of CELLO rests on neither the directory nor any third party ever holding K_local.

**The bridge: pre-authorization token.** When both phone and email are confirmed, the directory issues a short-lived, single-use pre-authorization token. The bot delivers it to the operator. The operator sets it in agent config. The agent calls `cello_register(token)`. The directory validates the token during FROST DKG and marks it consumed. K_local is generated inside the agent process throughout. The Operations Agent never knows the DKG happened.

```
Bot side (human-facing)               Agent side (technical)
─────────────────────────             ──────────────────────────────────
Phone verified (channel-specific)
Email OTP verified
Directory issues pre-auth token
Bot: "Your token: CELLO-XXXXX"        Operator: CELLO_REGISTRATION_TOKEN=CELLO-XXXXX
                                      Agent: cello_register("CELLO-XXXXX")
                                      FROST DKG runs over libp2p
                                      K_local generated inside agent process
                                      Registration complete
```

---

## The Three Inbound Channels

### Telegram

Telegram provides a first-class bot development experience. The Telegram Bot API is a standard REST API over HTTPS. Long-polling and webhooks are both viable. A test server at `api.telegram.org/bot<token>/test` provides a fully isolated sandbox with separate bot tokens and separate user accounts — never exposed to production traffic.

For phone verification: Telegram bots do not receive the user's phone number automatically. The bot sends a `request_contact` keyboard button. The `message.contact` event that comes back contains a `user_id` field set server-side by Telegram. Checking `contact.user_id == message.from.id` (with a `None` guard for absent `user_id`) is sufficient proof that the phone number belongs to the account sending the message. No OTP step needed — Telegram's server-side binding is the verification.

### WhatsApp — Baileys

The official WhatsApp Business API (Meta Cloud API) is the production-grade path but requires Meta Business Account verification — weeks of approval with no guaranteed outcome for a new product. Baileys (`@whiskeysockets/baileys`) is the M6 implementation.

Baileys implements the WhatsApp Web protocol. It connects via a QR-code-scanned session — same mechanism as WhatsApp Web. Once established, full message send/receive is available with no Meta approval gate. It is TypeScript-native (matching the CELLO codebase throughout). The migration path to the official API is a transport swap, not a redesign.

For phone verification: the sender's phone number is available immediately from the Baileys JID (e.g., `15551234567@s.whatsapp.net`). The OTP is sent as a WhatsApp message back to the same conversation.

**Baileys constraints to track:**
- Session persistence is non-negotiable: Baileys auth state (credentials, encryption keys) must survive restarts. Loss requires physical QR code re-scan. Stored in EFS volume or Postgres-backed auth state adapter.
- No official SLA: WhatsApp has broken Baileys sessions in the past; community fix window typically days.
- Rate limits unwritten: documented limits don't exist. Low-volume registration use case is low risk.
- Initial QR code setup requires a human physically present to scan. One-time setup step — in deployment runbook, not automated.
- Single instance only: two Baileys sessions against the same WhatsApp number will conflict. ECS task count fixed at 1; rolling deployments must ensure old instance terminates before new one starts.

### WeChat — Deferred

WeChat is designed into the architecture as a first-class channel (transport adapter pattern accommodates it) but the adapter is not built at M6. The unofficial path (`itchat`, `wechaty` web puppet) is effectively closed — Tencent restricted web login from ~2019. The WeChat Official Account API requires a Chinese business entity and ICP licensing. These prerequisites are not satisfiable at M6.

### The Migration Path

The Operations Agent treats the messaging channel as a transport layer. The state machine does not know whether input arrives from Baileys or the official API. When business verification is complete and the official WhatsApp Business API is available: replace the Baileys adapter with the official API adapter. Session persistence requirement disappears. QR code pairing disappears from the deployment runbook. State machine, OTP logic, and directory integration are unchanged.

---

## Registration State Machine

Every in-flight registration is a state machine instance, keyed by the originating phone number hash (the phone number itself is never stored). Persisted in a PostgreSQL table; survives restarts.

### WhatsApp path

```
INITIAL
  ↓  first message received; phone extracted from Baileys JID
AWAITING_OTP
  ↓  OTP sent back to operator via WhatsApp message
PHONE_CONFIRMED
```

### Telegram path

```
INITIAL
  ↓  first message or /start received; request_contact button sent
AWAITING_CONTACT
  ↓  user taps contact button; contact.user_id == message.from.id verified
PHONE_CONFIRMED
```

### Shared tail (both channels)

```
PHONE_CONFIRMED
  ↓  bot prompts for email address
AWAITING_EMAIL
  ↓  6-digit OTP sent to email address
AWAITING_EMAIL_OTP
  ↓  OTP verified
EMAIL_CONFIRMED
  ↓  directory issues pre-authorization token
PRE_AUTH_TOKEN_ISSUED
  ↓  bot delivers token to operator — state machine ends here
```

### State timeouts and retries

- `AWAITING_CONTACT` (Telegram): re-prompt if no contact shared within 10 minutes
- `AWAITING_OTP` (WhatsApp): OTP expires after 10 minutes; max 3 attempts before requiring new OTP
- `AWAITING_EMAIL_OTP`: OTP expires after 15 minutes; max 3 attempts before requiring new send; rate-limited to 5 sends/hour per email address
- `PRE_AUTH_TOKEN_ISSUED`: token TTL 24 hours, enforced by directory; expired token requires full re-verification from `INITIAL`
- Any state: 7-day idle timeout discards in-flight record; phone number eligible for new registration

### Portal-first entry

When an operator begins at the web portal (M7), the portal completes email verification and issues a correlation token (32 bytes, base58 encoded, 30-minute TTL). The operator messages the bot with the correlation token. The bot initializes the state machine from `EMAIL_CONFIRMED` — email ceremony already complete in portal, only phone acquisition and OTP steps remain.

The two entry points (bot-first, portal-first) are two entry points into the same state machine — not two implementations.

---

## Internal Architecture

### Services within the Operations Agent

**Message router.** Receives inbound messages from the Telegram webhook and Baileys event listener. Normalizes to a common `InboundMessage` type (sender identifier, message text, channel). Dispatches to the state machine handler. Does not contain business logic.

**State machine engine.** Owns all in-flight registration state. Receives normalized messages, transitions state, emits outbound message commands. Does not know about Telegram or WhatsApp.

**OTP service.** Generates and validates one-time passcodes for the WhatsApp channel (OTP sent via Baileys bot message). Telegram does not use OTP — phone ownership is verified by `contact.user_id` check. Tracks attempt counts per phone number, enforces expiry.

**Email verification service.** Sends 6-digit OTP emails via SES. Tracks attempt counts and send rate per email address. Enforces 15-minute expiry and 5-sends/hour rate limit. The entire ceremony stays in the bot conversation — no web endpoint, no link click.

**Correlation token store.** Stores active portal-first correlation tokens (token value → portal session ID + email confirmation status). TTL-backed (30 minutes). Shared between the portal backend and the Operations Agent — shared Redis instance or shared PostgreSQL table.

**Directory client.** Calls the CELLO directory's pre-authorization API once both phone and email are confirmed. Passes phone hash and email domain. Receives pre-authorization token. Does not participate in FROST DKG.

**Message sender.** Sends outbound messages via the appropriate channel adapter (Telegram Bot API or Baileys). Receives outbound commands from the state machine engine.

---

## Deployment Model

### ECS, not Lambda

Baileys requires a **persistent WebSocket connection** to WhatsApp infrastructure. Lambda terminates between invocations; a new Lambda invocation cannot resume an existing Baileys session. Baileys session state must survive across the process lifecycle — incompatible with Lambda's ephemeral execution model.

The Operations Agent runs as a long-lived ECS Fargate task with a stable container instance and persistent storage for Baileys session state. This applies even though the Telegram side would work fine on Lambda — one deployable is operationally simpler than a split Lambda/ECS topology.

When the Operations Agent migrates from Baileys to the official WhatsApp Business API, this constraint disappears and Lambda reconsideration is reasonable.

### Baileys session persistence

Baileys session state stored via one of:
- Mounted EFS volume: straightforward, but adds EFS dependency
- Postgres-backed auth state adapter: consistent with existing persistence infrastructure; preferred

ECS task count fixed at 1. Rolling deployments: old instance must terminate and flush state before new instance starts — prevents two Baileys sessions against the same WhatsApp number conflicting.

### Secrets (Secrets Manager)

- Telegram bot token (production)
- Telegram bot token (staging)
- Baileys WhatsApp session credentials (rotated after initial QR code pairing)
- SES credentials for email verification
- CELLO directory internal API key (for pre-authorization endpoint call)

---

## Directory Pre-Authorization API

New internal endpoint added to the directory in M6:

**`POST /internal/pre-authorize`** — accepts phone hash and email domain from the Operations Agent after both ceremonies complete. Returns a pre-authorization token (short-lived, single-use, 24-hour TTL). This endpoint is on the internal network only — not reachable from the public internet.

**Token consumption:** consumed at FROST DKG presentation. On presentation (not on success) — a transient DKG failure requires the operator to get a new token via the bot rather than allowing an unconsumed token to persist. Token is stored in the directory's PostgreSQL with `consumed_at` timestamp.

**Portal correlation token endpoint:** `POST /internal/portal-correlation-token` — issued by the directory when the portal completes email verification, returned to the portal frontend, presented to the Operations Agent bot.

---

## End-to-End Testing

### Telegram — CI-gated via sandbox

Telegram provides a production-equivalent test environment at `api.telegram.org/bot<token>/test` with separate bot tokens and separate user accounts. The Telegram E2E test suite:
- Creates a scripted "user" session using the Telegram test API
- Sends messages to the test bot instance
- Asserts on bot replies at each step of the state machine
- Completes a full bot-first registration through the test bot
- Asserts the registration (pre-authorization token issued) appears in the (staging) CELLO directory

These tests run in CI against staging, blocking merge on failure.

### WhatsApp — Hybrid approach

No Telegram-equivalent sandbox for WhatsApp exists. Two-tier approach:

**Option B (mock transport) for CI:** Inject a fake Baileys transport adapter in the test environment. Messages exchanged in-process or over a local socket. Exercises the state machine, OTP logic, and directory integration — but not Baileys itself. CI-gated, runs on every merge.

**Option A (real Baileys session) for pre-release:** A dedicated test phone number with a Baileys session. CI pipeline uses Baileys to connect as the user side and sends scripted messages to the test bot instance. Tests the real Baileys transport end-to-end, including session state persistence. Runs manually as a deployment checklist item before any production deployment that includes Baileys changes.

This is the right tradeoff: the Baileys failure mode most likely in production (WhatsApp protocol update breaking the session) is not preventable via CI. It requires monitoring and rapid-response deployment. CI tests prove the state machine and integration logic.

### Both channels need independent tests

Telegram and WhatsApp have distinct codepaths (separate transport adapters, separate phone verification mechanisms). Testing one is not testing the other.

### Bot-first and portal-first both tested

Both entry paths into the state machine have explicit test coverage. A portal-first test: issue a correlation token via the directory's portal correlation endpoint, message the bot with it, complete phone acquisition, assert token issued. This path exercising the shared state machine and the correlation token store.

---

## CI Pipeline Shape at M6 Close

```
unit tests → integration tests → deploy to staging
  → agent-agent E2E (scripted Claude Code sessions)
  → bot E2E — Telegram sandbox (CI-gated)
  → bot E2E — WhatsApp mock transport (CI-gated)
```

WhatsApp Baileys smoke test (real phone number, Baileys session) added to deployment checklist — run manually before any production deployment touching Baileys code.

---

## Milestone Close Gate

Standard SPARC gate sequence plus:

1. WhatsApp bot-first registration: operator messages WhatsApp number → phone OTP received and verified → email requested → email OTP received and verified → pre-authorization token delivered to operator → agent calls `cello_register(token)` → FROST DKG completes → agent registered in directory
2. Telegram bot-first registration: same flow with Telegram `request_contact` replacing OTP for phone verification
3. Portal-first path: directory issues correlation token → operator messages bot with token → phone acquisition completes → pre-authorization token delivered → agent self-registers
4. Token consumption: pre-authorization token consumed on first use; second `cello_register` attempt with same token returns `INVALID_TOKEN`
5. State machine restart: kill Operations Agent mid-registration at `AWAITING_EMAIL_OTP` → restart → operator resumes from same state
6. Telegram E2E test suite passing in CI against staging
7. WhatsApp mock-transport E2E test suite passing in CI
8. WhatsApp Baileys smoke test passing (pre-release checklist item, manually run)

---

## Open Questions (Resolved Design — Details for M6 Stories)

**Monorepo placement.** The Operations Agent is a standalone deployable. `packages/operations-agent/` within the CELLO monorepo is the path of least resistance — shares tooling and CI. The alternative (separate repo) adds cross-repo overhead. Decision: monorepo placement, separate package.

**Email verification ownership.** The Operations Agent sends email OTP. The portal (M7) also sends email OTP. Should they share one email verification service (library or microservice) or have two implementations? Duplication is a maintenance risk. Decision to make when writing M7 stories — flag for review when the portal email path is designed.

**Single bot handle vs. separate handles.** One WhatsApp number and one Telegram handle for registration + lifecycle operations, or separate handles? Single handle: one contact the operator remembers. Separate handles: independent deployment and rollout of lifecycle operations, reduced blast radius. Critical concern: if the registration bot is down, does that also silence `FALLBACK_CANARY` security alerts? If yes, that is an availability problem for the compromise response path. Resolve before lifecycle operations ship.

**Pre-authorization API transport.** HTTP (internal only, easy to firewall) or libp2p protocol stream (consistent with CELLO's internal conventions, more implementation complexity). Decision affects how the Operations Agent authenticates to the directory. HTTP is the pragmatic choice for M6.

---

## Dependencies

- M5 complete — ECS infrastructure, staging environment, CI pipeline gate in place before M6 deploys
- M4 complete — PostgreSQL persistence for state machine storage; Baileys auth state persistence follows same discipline
- Directory pre-authorization API must be built as part of M6 (new endpoint, not pre-existing)
- SES (or equivalent) email sending configured in the AWS account

---

## Related Documents

- [[2026-05-13_1549_onboarding-and-operations-agent-architecture|Onboarding and Operations Agent Architecture]] — full architecture reference: Baileys vs. official API, registration state machine, ceremony paths, testing strategy, deployment model, lifecycle operations scope
- [[2026-05-13_1130_infrastructure-and-product-onboarding-alignment|Infrastructure and Product Onboarding Alignment]] — established M6 as the onboarding milestone, three-tier testing architecture, principle that E2E tests ship inside milestones
- [[end-to-end-flow|CELLO End-to-End Protocol Flow]] — §1.1 and §1.2 canonical source for bot-first and portal-first registration paths
- [[2026-05-14_1853_milestone-sequence-revision|Milestone Sequence Revision]] — sequencing decisions placing M6 here
- [[server-infrastructure|CELLO Server Infrastructure Requirements]] — directory registration API, OTP channel support, phone hash uniqueness enforcement, FROST DKG
- [[frontend|CELLO Frontend Requirements]] — portal-first path, email OTP as correlation token, registration completion flow
- [[2026-04-11_1700_persistence-layer-design|Persistence Layer Design]] — M4 persistence work the Operations Agent depends on for durable state machine storage
