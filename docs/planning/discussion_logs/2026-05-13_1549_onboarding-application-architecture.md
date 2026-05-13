---
name: Onboarding Application Architecture
type: discussion
date: 2026-05-13 15:49
topics: [onboarding, registration, whatsapp, telegram, baileys, OTP, state-machine, bot, deployment, testing, infrastructure, correlation-token, FROST, M6]
description: Detailed architecture of the M6 onboarding application — a standalone service that owns the WhatsApp and Telegram registration surface. Covers the Baileys vs. official WhatsApp Business API decision, the registration state machine, both ceremony paths, the testing strategy for Baileys E2E, and deployment model implications driven by Baileys' persistent WebSocket requirement.
---

# Onboarding Application Architecture

## What This Is and Why It Exists

The onboarding application is M6 in the revised milestone sequence. It is the product surface that makes agent registration a real ceremony rather than a developer bootstrapping a CELLO process from a terminal.

Before M6, "registration" means running `cello_register` via the MCP adapter. That is not a product. The onboarding application changes that: it gives any operator (human or autonomous) a path from zero to a registered CELLO agent that requires no code, no terminal, and no knowledge of how FROST DKG works internally.

The onboarding application is **not** part of the directory. It is **not** part of the relay. It is its own deployable with its own codebase, its own process, and its own persistence for in-flight registration state. It speaks WhatsApp and Telegram inbound; it speaks to the CELLO directory via internal API outbound. The directory's FROST machinery does not change. The onboarding application is a product shell around the existing registration API.

The architectural principle here matters: the directory's job is protocol and key material. The onboarding application's job is user experience. They should not know each other's implementation details.

---

## The Two Inbound Channels

### Telegram

Telegram provides a first-class developer experience for bots. The Telegram Bot API is a standard REST API over HTTPS, well-documented, and stable. Long-polling and webhooks are both viable. The test server at `api.telegram.org/bot<token>/test` provides a fully isolated sandbox environment with separate bot tokens and separate user accounts — the test server is never exposed to production traffic.

For the onboarding application, Telegram is the lower-risk channel. There are no approval gates, no business verification requirements, no risk of the session expiring because a QR code wasn't refreshed. A bot token is a secret. Managing it is straightforward.

No special library is required beyond a standard Telegram Bot API HTTP client.

### WhatsApp — The Hard One

The official WhatsApp Business API (Meta Cloud API or on-premise deployment) is the production-grade path for any serious WhatsApp integration. It requires a Meta Business Account, business verification, and approval. For development and early deployment, this approval process is a blocking dependency — one that could take weeks and has no guaranteed outcome for a new product. Waiting for it before any bot functionality exists is not viable.

**Baileys** (`@whiskeysockets/baileys`) is the practical alternative for the M6 build. It is an open-source TypeScript library that implements the WhatsApp Web protocol rather than the official API. It connects to WhatsApp via a QR-code-scanned session — the same mechanism as WhatsApp Web in a browser. Once the session is established, Baileys gives full message send and receive capability without any Meta approval.

### Why Baileys for M6

The decision is pragmatic, not permanent:

- **No approval gate.** A Baileys session can be up in minutes. The official API can take weeks.
- **TypeScript-native.** The CELLO codebase is TypeScript throughout. No language mismatch, no wrapper layer.
- **Full message parity.** Baileys provides the same send/receive capabilities the official API provides, for the use case here.
- **The migration path is clear.** When the business is verified and volume justifies the API tier, the migration is a swap of the transport layer. The state machine, OTP logic, and directory integration are identical between Baileys and the official API. The bot's internal architecture is designed to make this swap straightforward.

### Baileys Constraints to Track

These are not blockers for M6, but they are risks that need to be understood before they become incidents:

**Session persistence is non-negotiable.** Baileys stores authentication state (session credentials, encryption keys) in files or a database that must survive across restarts. If the Baileys session is lost, the WhatsApp number becomes inaccessible until someone physically re-scans a QR code. This is not recoverable programmatically. The M4 persistence work (SQLCipher for the client, PostgreSQL for the directory) establishes the persistence discipline. Baileys session state is another instance of the same requirement.

**No official SLA.** Baileys is maintained by the community. WhatsApp has changed their protocol in ways that broke Baileys sessions in the past. This has happened before and will happen again. The risk window is usually short — the community typically has a fix within days — but there is a window. Production usage of Baileys carries this tail risk.

**Rate limits are unwritten.** The official WhatsApp Business API publishes rate limit rules. Baileys does not. WhatsApp Web limits exist but are not documented. Exceeding them can result in the phone number being temporarily flagged or — in persistent cases — banned. For the registration use case (low-volume, human-paced interactions), this is a low risk. It would become relevant if the bot were ever used for bulk messaging.

**QR code initial setup.** The first session requires physically scanning a QR code from a phone that holds the target WhatsApp number. This is a one-time setup step, not an ongoing operational burden. But it means the initial deployment is not fully automated — a human must be present to scan. This needs to be in the deployment runbook.

### The Migration Path

The onboarding application's internal architecture treats the messaging channel as a transport layer. The state machine (see below) does not know whether it is receiving input from Baileys or the official API. When the business verification is complete and the official WhatsApp Business API is available:

1. Replace the Baileys adapter with the official API adapter.
2. The session persistence requirement goes away (the official API is stateless from the application's perspective — Meta manages the session).
3. The QR code pairing step disappears from the deployment runbook.
4. The state machine, OTP logic, and directory integration are unchanged.

The migration is a transport swap, not a redesign.

---

## The Registration State Machine

Every in-flight registration is an instance of a state machine. The onboarding application creates a machine instance when it receives the first message from a new phone number, and it maintains the machine's state across restarts (the M4 persistence dependency).

The states:

```
INITIAL
  ↓  first message received
AWAITING_PHONE
  ↓  operator provides phone number
AWAITING_OTP
  ↓  OTP sent; waiting for operator to reply with code
PHONE_CONFIRMED
  ↓  OTP verified
AWAITING_EMAIL
  ↓  bot prompts for email address
AWAITING_EMAIL_CONFIRM
  ↓  verification email sent; waiting for operator to click link
EMAIL_CONFIRMED
  ↓  email link clicked
AWAITING_DKG
  ↓  onboarding app calls directory registration API
DKG_IN_PROGRESS
  ↓  directory FROST DKG completes
COMPLETE
```

Some states have timeout-driven transitions:
- `AWAITING_OTP`: OTP expires after 10 minutes. Expired → `AWAITING_OTP` reset (prompt to request a new OTP).
- `AWAITING_EMAIL_CONFIRM`: email link expires after 24 hours. Expired → `AWAITING_EMAIL` (prompt to re-provide email).
- Any state: if the machine is idle for 7 days (configurable), the in-flight record is discarded and the phone number is eligible to start a new registration.

The state machine also handles the portal-first entry point. When a portal-first correlation token is presented via bot message, the machine is initialized from `EMAIL_CONFIRMED` rather than `INITIAL` — the email ceremony was already completed in the portal, so only the phone OTP steps remain.

The full state record is persisted in a PostgreSQL table with the state machine instance keyed by the originating phone number hash. (The phone number itself is never stored; the hash is sufficient for de-duplication and correlation.)

---

## Bot-First Path — Message-by-Message Flow

This is the most common path for autonomous agents. The agent (or its human operator) initiates contact with the onboarding bot.

**Step 1 — First message.** Operator sends any message to the CELLO onboarding bot (WhatsApp or Telegram). Bot responds with a greeting explaining what CELLO is and what the registration process involves. Bot asks for the operator's phone number.

**Step 2 — Phone number provided.** Operator replies with a phone number. Bot validates the format. If invalid, bot asks again. If the number is already registered in CELLO, bot says so and stops. If valid and new, bot sends an OTP to that phone number via Twilio Verify (or equivalent OTP provider) and asks for the code.

**Step 3 — OTP verified.** Operator replies with the OTP code. If wrong, bot says so and allows retries (up to 3 attempts before requiring a new OTP). If correct, bot acknowledges phone confirmation and asks for an email address.

**Step 4 — Email provided.** Operator replies with an email address. Bot sends a verification link to that address (via SES or equivalent) and asks the operator to click it.

**Step 5 — Email link clicked.** Operator clicks the link in their email. The link contains a one-time token that the onboarding application's web endpoint verifies. On success, the machine transitions to `EMAIL_CONFIRMED`.

**Step 6 — Key generation.** The onboarding application calls the CELLO directory's registration API: phone hash + email domain. The directory runs the FROST DKG ceremony — the agent generates K_local locally; the directory distributes K_server shares across directory nodes. This step is opaque to the operator. It happens in the background.

**Step 7 — Confirmation.** Bot sends a confirmation message containing the agent's CELLO pseudonym and a link to the portal where the operator can complete their trust profile and configure connection policy. Registration is complete. The agent is immediately online.

---

## Portal-First Path — Message-by-Message Flow

The portal-first path is used when the human operator begins at the web portal rather than messaging a bot.

**Step 1 — Portal registration.** Operator visits the CELLO web portal and initiates registration. Portal prompts for email address and sends an OTP to it.

**Step 2 — Email OTP verified in portal.** Operator enters the OTP code in the portal. Email is confirmed. Portal issues a **correlation token** — a cryptographically random, short-lived string (32 bytes, base58 encoded, expires in 30 minutes). Portal displays the correlation token and instructs the operator to message the WhatsApp or Telegram onboarding bot with it.

**Step 3 — Correlation token received by bot.** Operator messages the onboarding bot, either including the correlation token directly in their first message or in response to a bot prompt. Bot recognizes the token format, validates it against the portal session (token is looked up in a shared store keyed by the token value), and retrieves the email confirmation from the portal session.

**Step 4 — Phone OTP.** Bot asks the operator for their phone number and sends an OTP. Steps 2–3 from the bot-first path follow.

**Step 5 onwards.** Identical to steps 6–7 of the bot-first path.

The two paths are not two implementations. They are two entry points into the same state machine. In both cases the state machine ends in `EMAIL_CONFIRMED + PHONE_CONFIRMED` before calling the directory API. The difference is only in the order of arrival and the surface through which each ceremony was completed.

---

## Internal Architecture

### Services within the onboarding application

**Message router.** Receives inbound messages from the Telegram webhook and the Baileys event listener. Normalizes them to a common `InboundMessage` type (sender identifier, message text, channel). Dispatches to the state machine handler.

**State machine engine.** Owns all in-flight registration state. Receives normalized messages and transitions state accordingly. Emits outbound message commands. Does not know about Telegram or WhatsApp — it knows about states and transitions.

**OTP service.** Generates and validates one-time passcodes. Backed by Twilio Verify (or equivalent). Tracks attempt counts per phone number. Enforces expiry.

**Email verification service.** Sends verification emails (via SES or equivalent). Generates one-time verification links. Validates link clicks at the web endpoint. Enforces expiry.

**Correlation token store.** Stores active correlation tokens keyed by token value, mapping to their associated portal session ID and email confirmation status. TTL-backed (30 minutes). Shared between the portal backend and the onboarding application — either a shared Redis instance or a shared database table.

**Directory client.** Calls the CELLO directory's internal registration API once both phone and email are confirmed. Passes phone hash and email domain. Receives the agent's pseudonym in response. Does not participate in FROST DKG directly — it triggers it via the directory API and receives the result.

**Message sender.** Sends outbound messages via the appropriate channel adapter (Telegram Bot API or Baileys). Receives outbound commands from the state machine engine.

---

## Testing Strategy

The onboarding application is a product surface. Per the testing architecture established in the infrastructure alignment discussion, it gets end-to-end tests that run as close gates — not as an afterthought.

### Telegram end-to-end tests

Telegram provides a production-equivalent test environment at `api.telegram.org/bot<token>/test`. Test bot tokens are separate from production tokens. The test environment persists its own state independently from production.

The Telegram E2E test suite:
- Creates a scripted "user" session using the Telegram test API.
- Sends messages to the test bot instance.
- Asserts on bot replies at each step of the flow.
- Completes a full bot-first registration through the test bot.
- Asserts the registration appears in the (locally running or staging) CELLO directory.

These tests can be written and validated during M6 against a locally running directory and relay. They move to the fully automated CI pipeline in M5 when the staging environment is available.

### WhatsApp / Baileys end-to-end tests — the hard problem

There is no Telegram-equivalent test sandbox for WhatsApp. The WhatsApp Business API sandbox (Twilio Sandbox for WhatsApp or Meta test numbers) exists but requires setup and is not the same as Baileys. Baileys connects to real WhatsApp infrastructure using a real phone number's session.

Two approaches, each with a different tradeoff:

**Option A — Dedicated test phone number.** Provision a dedicated WhatsApp number for CI (a real SIM or a number that supports WhatsApp). The CI pipeline uses Baileys to connect as the *user* side and sends scripted messages to the test bot instance. This is authentic — it tests the real Baileys transport end-to-end, including all the session state persistence and reconnection logic. The cost is that the test is fragile (depends on WhatsApp infrastructure availability) and requires a real phone number credential in CI secrets.

**Option B — Mock Baileys transport.** Inject a fake Baileys transport adapter in the test environment. Messages are exchanged in-process or over a local socket rather than through WhatsApp infrastructure. The test exercises the state machine, OTP logic, and directory integration — but not Baileys itself. CI is fast and reliable. The cost is that Baileys breakage would not be caught by CI; it would be caught in manual pre-release testing or in production.

**Recommended approach for M6.** Use a hybrid:
- Option B (mock transport) for CI end-to-end tests. They run on every merge and gate deployments. They prove the state machine and integration logic.
- Option A (real Baileys session against a test phone number) for pre-release smoke tests, run manually before any production deployment that includes Baileys changes. These are not CI-gated — they are a deployment checklist item.

This is the right tradeoff because the Baileys failure mode most likely to occur in production (WhatsApp protocol update breaking the session) is not preventable via CI. It requires monitoring and a rapid-response deployment. CI tests are better spent proving the state machine is correct and the directory integration works.

### Both channels need independent tests

The Telegram and WhatsApp codepaths are distinct. Testing one is not testing the other. Both bot flows must have end-to-end test coverage. A Telegram test passing does not imply the WhatsApp path works — they share the state machine but have separate transport adapters, separate bot accounts, and separate OTP configuration paths.

### Pre-M5 local testing

Both bot test suites can be developed and validated during M6 against locally running CELLO infrastructure. The staging environment (M5) is not required for bot development or test authoring. It is required to make the tests CI-gated. The sequencing is: build and validate locally during M6, move to CI-gated in M5's staging environment.

---

## Deployment Model

### Why the onboarding application is not a Lambda

The canonical CELLO deployment question when adding a new service is: Lambda or ECS?

Lambda is the right answer when the service is stateless, request-scoped, and tolerant of cold starts. Most of CELLO's directory and relay functionality fits that shape.

The onboarding application does not fit that shape because of Baileys. Baileys requires a **persistent WebSocket connection** to WhatsApp infrastructure. A Lambda function terminates between invocations. A new Lambda invocation cannot resume an existing Baileys session — it would need to re-establish the WebSocket and potentially re-authenticate, which is not reliable. More critically, Baileys session state (the auth credentials) must survive across the process lifecycle. Lambda's ephemeral execution model is incompatible with this.

The onboarding application must run as a **long-lived process** — an ECS task with a stable container instance and persistent volume for Baileys session state.

This decision applies even though the Telegram side of the onboarding application would work fine on Lambda. The simplest deployment is one deployable — one ECS task — rather than splitting Telegram to Lambda and WhatsApp to ECS. Operational simplicity favors keeping them together.

When the onboarding application migrates from Baileys to the official WhatsApp Business API, this constraint disappears. The official API is stateless from the application's perspective. At that point, reconsideration of Lambda deployment is reasonable.

### Baileys session persistence

Baileys session state must survive ECS task restarts. This means:
- Session credentials stored in a mounted EFS volume or in the PostgreSQL database (using a Baileys auth state adapter that writes to Postgres).
- The ECS task is a stateful workload. It must not run multiple instances concurrently (two Baileys sessions against the same WhatsApp number will conflict).
- Rolling deployments must ensure the old instance terminates and flushes its state before the new instance starts.

### Secrets

The onboarding application requires the following secrets, each managed in AWS Secrets Manager:
- Telegram bot token (production)
- Telegram bot token (staging)
- Baileys WhatsApp session credentials (rotated after initial QR code pairing)
- Twilio Verify API credentials (OTP delivery)
- SES credentials (email verification)
- CELLO directory internal API key (for the registration call)

### Topology

```
                    ┌──────────────────────────────────────────────┐
                    │  Onboarding Application (ECS Task)           │
                    │                                              │
  WhatsApp user ──→ │  Baileys WebSocket ──→ Message Router        │
  Telegram user ──→ │  Telegram Webhook  ──→    │                  │
                    │                           ↓                  │
                    │                    State Machine Engine       │
                    │                        ↑   │                 │
                    │              Postgres   │   │  OTP Service    │
                    │            (state)  ────┘   ↓                │
                    │                       Email Verification      │
                    │                         Service              │
                    │                             │                │
                    └─────────────────────────────┼────────────────┘
                                                  ↓
                                         CELLO Directory API
                                         (registration endpoint)
```

The onboarding application does not directly participate in FROST DKG. It triggers the directory's registration endpoint and relays the result back to the operator. The cryptographic ceremony is entirely inside the directory.

---

## Open Questions

These are surfaced for a future design session. They are not resolved here.

**1. Migration trigger for the official WhatsApp Business API.**
The Baileys → official API migration is a planned event, not an emergency. But there is no defined trigger. Is it a business milestone (Meta verification completed)? A usage threshold (N registrations/day)? A date-based commitment? The migration should be planned proactively rather than reactively. When does the team commit to starting the migration?

**2. Email verification ownership.**
The email verification flow described here lives in the onboarding application. The portal also sends email OTP (portal-first path). Should there be one email verification service shared by both, or two implementations? The portal-side email OTP is described in `frontend.md` with its own rate limits and behavior. Duplication is a maintenance risk. A shared email verification service (a library, or a separate microservice) would unify the behavior. What owns it?

**3. Single bot or separate bots for new registration vs. existing agent management.**
The current design assumes one bot per channel (one WhatsApp number, one Telegram handle) that handles all bot-mediated interactions — registration for new agents and, eventually, operational commands from existing agents (key rotation nudges, "Not Me" revocation, succession claim notifications, etc.). Are these better served by separate bots with distinct handles? A single bot means a single contact for users, but the surface grows over time. Two bots means clearer separation of concerns and less risk that an operational command is confused with a registration flow, but requires users to know about two bots.

**4. Abandoned registration cleanup.**
The state machine has a 7-day idle timeout, after which the in-flight record is discarded. But what does "cleanup" mean in practice? If the phone number is partially registered (phone confirmed, email not yet confirmed), is the phone hash released? Can the same phone number start a new registration immediately, or must the 7-day window expire first? The current design doesn't specify the cleanup behavior in detail. This needs a concrete answer before the M6 stories are written.

---

## Related Documents

- [[2026-05-13_1130_infrastructure-and-product-onboarding-alignment|Infrastructure and Product Onboarding Alignment]] — the discussion that established M6 as the onboarding milestone, the three-tier testing architecture, and the staging environment sequence this document builds on
- [[end-to-end-flow|CELLO End-to-End Protocol Flow]] — §1.1 and §1.2 are the canonical source for the bot-first and portal-first registration paths; this document implements those flows as a concrete state machine
- [[server-infrastructure|CELLO Server Infrastructure Requirements]] — defines the directory's registration API, OTP channel support (WhatsApp/Telegram/WeChat), phone hash uniqueness enforcement, and the FROST DKG the onboarding application triggers
- [[frontend|CELLO Frontend Requirements]] — defines the portal-first path, the email OTP as correlation token, the registration completion flow, and the WebAuthn/TOTP enrollment warning that follows bot-first registration
- [[2026-04-11_1700_persistence-layer-design|Persistence Layer Design]] — the M4 persistence work that the onboarding application depends on for durable state machine storage; Baileys session credentials are an additional persistence concern in the same tier
- [[implementation-roadmap|CELLO Implementation Roadmap]] — M6 in the revised sequence; this document provides the architecture that M6 stories will implement
