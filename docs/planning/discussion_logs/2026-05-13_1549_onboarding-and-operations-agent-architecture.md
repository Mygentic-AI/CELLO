---
name: Onboarding and Operations Agent Architecture
type: discussion
date: 2026-05-13 15:49
topics: [operations-agent, onboarding, registration, whatsapp, telegram, baileys, OTP, state-machine, bot, deployment, testing, infrastructure, correlation-token, FROST, M6, trust-signals, security-alerts]
description: Architecture of the CELLO Operations Agent — the persistent out-of-band operator channel delivered via WhatsApp and Telegram. M6 ships the registration flow; subsequent milestones add trust signal notifications, security alerts (FALLBACK_CANARY, Not Me), key rotation nudges, and succession notifications. Covers Baileys vs. official WhatsApp Business API, the verification-only registration model (agent self-registers via pre-authorization token), the registration state machine, both ceremony paths, end-to-end testing strategy, and ECS deployment model.
---

# Onboarding and Operations Agent Architecture

## What This Is and Why It Exists

The CELLO Operations Agent is the human operator's persistent out-of-band channel — a WhatsApp and Telegram bot that mediates the full lifecycle of a CELLO agent, from initial registration through ongoing security alerts and trust signal management.

It is M6 in the revised milestone sequence, where M6 ships the registration flow. But registration is the entry point, not the full scope. The Operations Agent is the channel through which the directory reaches the human operator independently of the agent process — which is the critical property. If the agent is compromised, a security alert must reach the operator via a channel the attacker does not control. That channel is the Operations Agent.

**M6 scope (registration):** The Operations Agent makes agent registration a real ceremony rather than a developer bootstrapping a CELLO process from a terminal. Before M6, "registration" means running `cello_register` via the MCP adapter. That is not a product. The Operations Agent changes that: it gives any operator a path from zero to a registered CELLO agent that requires no code, no terminal, and no knowledge of how FROST DKG works internally.

**Post-M6 scope (lifecycle operations):** Security alerts (`FALLBACK_CANARY`, anomaly alerts), emergency "Not Me" revocation, key rotation nudges, succession notifications, and trust signal delivery confirmations all flow through the Operations Agent. These are not onboarding functions — they are the reason the Operations Agent must be a persistent long-running service rather than a one-shot registration tool.

The Operations Agent is **not** part of the directory. It is **not** part of the relay. It is its own deployable with its own codebase, its own process, and its own persistence. It speaks WhatsApp and Telegram inbound; it speaks to the CELLO directory via internal API outbound. The directory's FROST machinery does not change. The Operations Agent is a product shell around the directory's registration and notification APIs.

The architectural principle here matters: the directory's job is protocol and key material. The Operations Agent's job is the human operator's experience. They should not know each other's implementation details.

Critically, the registration path within the Operations Agent is **verification-only**. It proves a real human authorized a registration — via phone OTP and email confirmation — and issues a pre-authorization token as evidence. It does not generate K_local. It does not participate in FROST DKG. The agent does both of those things for itself.

---

## The Two Inbound Channels

### Telegram

Telegram provides a first-class developer experience for bots. The Telegram Bot API is a standard REST API over HTTPS, well-documented, and stable. Long-polling and webhooks are both viable. The test server at `api.telegram.org/bot<token>/test` provides a fully isolated sandbox environment with separate bot tokens and separate user accounts — the test server is never exposed to production traffic.

For the Operations Agent, Telegram is the lower-risk channel. There are no approval gates, no business verification requirements, no risk of the session expiring because a QR code wasn't refreshed. A bot token is a secret. Managing it is straightforward.

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

The Operations Agent's internal architecture treats the messaging channel as a transport layer. The state machine (see below) does not know whether it is receiving input from Baileys or the official API. When the business verification is complete and the official WhatsApp Business API is available:

1. Replace the Baileys adapter with the official API adapter.
2. The session persistence requirement goes away (the official API is stateless from the application's perspective — Meta manages the session).
3. The QR code pairing step disappears from the deployment runbook.
4. The state machine, OTP logic, and directory integration are unchanged.

The migration is a transport swap, not a redesign.

---

## The Bot Is Verification-Only — The Agent Self-Registers

### Why the bot must not participate in key generation

The bot's unique capability is reaching a real human through a channel they own. That is the identity proof. Phone OTP confirms the human controls this phone number. Email verification confirms they control this email address. The bot's job ends there.

K_local generation and DKG participation cannot be delegated to the Operations Agent. The split-key security model only holds if K_local is generated inside the agent process and never leaves it. If the Operations Agent generated K_local — even transiently — it would create a custody moment that violates the model. The entire security claim of CELLO rests on neither the directory nor any third party ever holding K_local. Generating it in the Operations Agent, or in a browser, or anywhere other than the agent process is a fundamental compromise of that claim.

The agent is the only process that should ever hold K_local. The agent must generate it and participate in DKG directly — which is exactly what `cello_register()` already does in M3.

### The bridge: a pre-authorization token

When both phone OTP and email verification are confirmed, the directory issues a **pre-authorization token** — a short-lived, single-use credential that proves the human verification ceremonies completed. The bot delivers this token to the operator via the bot conversation.

The operator configures their agent with the token. The agent calls `cello_register(token)`, presenting it to the directory during the FROST DKG as proof of pre-authorization. The directory accepts the DKG because the token is valid. K_local is generated inside the agent process throughout. The Operations Agent never touches it.

### The resulting split

```
Bot side (human-facing)               Agent side (technical)
─────────────────────────             ──────────────────────────────────
Phone OTP → confirmed
Email link → confirmed
Directory issues pre-auth token
Bot: "Your token: CELLO-XXXXX         Operator: CELLO_REGISTRATION_TOKEN=CELLO-XXXXX
     Configure your agent with it."
                                       Agent: cello_register("CELLO-XXXXX")
                                       FROST DKG runs over libp2p
                                       K_local generated inside agent process
                                       Registration complete
```

### Why this is the right tradeoff

The operator still has a manual step — pasting a token into agent config. But the audience for M6 is agent operators: people running Claude Code sessions or OpenClaw agents who are already doing technical setup. `CELLO_REGISTRATION_TOKEN=xxx` is the same UX as `ANTHROPIC_API_KEY=xxx`. It is a one-time step, not ongoing friction.

The alternative — generating K_local in the Operations Agent or in a browser and exporting it to the agent — trades a small UX rough edge for a genuine security compromise. The trust model is the product's core claim. Weakening it at the first onboarding step is the wrong foundation to build on.

---

## The Registration State Machine

Every in-flight registration is an instance of a state machine. The Operations Agent creates a machine instance when it receives the first message from a new phone number, and it maintains the machine's state across restarts (the M4 persistence dependency).

The two channels diverge during phone acquisition and converge at `PHONE_CONFIRMED`. After that the flow is identical regardless of channel.

**WhatsApp path** — the sender's phone number is available immediately from the Baileys JID (e.g. `15551234567@s.whatsapp.net`). There is no need to ask for it.

```
INITIAL
  ↓  first message received; phone extracted from sender JID
AWAITING_OTP
  ↓  OTP sent as WhatsApp message back to the conversation
PHONE_CONFIRMED
```

**Telegram path** — Telegram bots do not receive the user's phone number automatically. A `request_contact` keyboard button is used to prompt the user to share it. The `message.contact` event that comes back contains a `user_id` field set by Telegram's server — not supplied by the client. Checking that `contact.user_id == message.from.id` (with a `None` guard for the case where `user_id` is absent) is sufficient proof that the phone number belongs to the account sending the message. No OTP step is needed for Telegram. Telegram's own server-side binding is the verification.

```
INITIAL
  ↓  first message received; contact button sent
AWAITING_CONTACT
  ↓  user taps contact button; phone number received via message.contact event
  ↓  assert contact.user_id == message.from.id (None guard required)
PHONE_CONFIRMED
```

**Shared tail** — both paths continue here:

```
PHONE_CONFIRMED
  ↓  bot prompts for email address
AWAITING_EMAIL
  ↓  6-digit OTP sent to email address; operator replies with code
AWAITING_EMAIL_OTP
  ↓  OTP verified
EMAIL_CONFIRMED
  ↓  directory issues pre-authorization token
PRE_AUTH_TOKEN_ISSUED
  ↓  bot delivers token to operator; state machine ends here
```

The email ceremony is a 6-digit OTP delivered to the email address, replied to in the bot chat — the same channel the operator is already in. No web endpoint, no link click, no browser session. 15-minute expiry, max 3 attempts, rate-limited to 5 sends per hour per email address.

The Operations Agent's responsibility ends at `PRE_AUTH_TOKEN_ISSUED`. The FROST DKG happens later, inside the agent process, initiated by the operator. The Operations Agent never knows it happened. The directory knows because it validates the pre-authorization token when the agent presents it during DKG.

Some states have timeout-driven transitions:
- `AWAITING_CONTACT` (Telegram): if the user does not tap the contact button within 10 minutes, re-send the prompt.
- `AWAITING_OTP` (WhatsApp): OTP expires after 10 minutes. Expired → `AWAITING_OTP` reset (prompt to request a new OTP). Max 3 attempts before requiring a new OTP.
- `AWAITING_EMAIL_OTP`: OTP expires after 15 minutes. Expired → `AWAITING_EMAIL_OTP` reset (prompt to request a new code). Max 3 attempts before requiring a new send. Rate-limited to 5 sends per hour per email address.
- `PRE_AUTH_TOKEN_ISSUED`: the token itself has a TTL (e.g. 24 hours) enforced by the directory. After expiry the operator must restart from the beginning — the phone and email ceremonies must be repeated because the authorization lapsed.
- Any state: if the machine is idle for 7 days (configurable), the in-flight record is discarded and the phone number is eligible to start a new registration.

The state machine also handles the portal-first entry point. When a portal-first correlation token is presented via bot message, the machine is initialized from `EMAIL_CONFIRMED` rather than `INITIAL` — the email ceremony was already completed in the portal, so only the phone acquisition and OTP steps remain.

The full state record is persisted in a PostgreSQL table with the state machine instance keyed by the originating phone number hash. (The phone number itself is never stored; the hash is sufficient for de-duplication and correlation.)

---

## Bot-First Path — Message-by-Message Flow

This is the most common path for autonomous agents. The phone acquisition step differs between the two channels; everything from email onward is identical.

### WhatsApp (Baileys)

**Step 1 — First message.** Operator sends any message to the CELLO WhatsApp number. Bot extracts the phone number from the Baileys JID — no need to ask for it. Bot responds with a greeting explaining what CELLO is. If the number is already registered in CELLO, bot says so and stops. Otherwise, bot sends an OTP as a WhatsApp message back to the same conversation and asks for the code.

**Step 2 — OTP verified.** Operator replies with the OTP code. If wrong, bot says so and allows retries (up to 3 attempts before requiring a new OTP). If correct, phone is confirmed. Bot asks for an email address.

### Telegram

**Step 1 — First message.** Operator sends any message or `/start` to the CELLO Telegram bot. Bot responds with a greeting explaining what CELLO is, then sends a `request_contact` keyboard button asking the operator to share their phone number.

**Step 2 — Contact shared.** Operator taps the contact button. Telegram sends a `message.contact` event containing the phone number associated with their Telegram account, with `user_id` set server-side by Telegram. Bot checks `contact.user_id == message.from.id` (with a `None` guard — if `user_id` is absent, the share is rejected). If the check passes, the phone number is confirmed as belonging to the account sending the message. If the number is already registered in CELLO, bot says so and stops. Otherwise, phone is confirmed and bot asks for an email address.

### Shared tail (both channels)

**Email step — Email provided.** Operator replies with an email address. Bot sends a 6-digit OTP to that address (via SES or equivalent) and asks the operator to reply with the code in the bot chat.

**Email OTP verified.** Operator replies with the code. If wrong, bot allows retries (up to 3 attempts before requiring a new send). If correct, the machine transitions to `EMAIL_CONFIRMED`. The directory issues a pre-authorization token.

**Token delivered.** Bot sends a message to the operator with the pre-authorization token and instructions: configure your agent with this token and call `cello_register`. The bot's job is done. The Operations Agent's state machine reaches `PRE_AUTH_TOKEN_ISSUED` and stops.

**Agent self-registers (out of band).** The operator sets the token in their agent configuration. The agent calls `cello_register(token)`. The FROST DKG runs over libp2p between the agent and the directory nodes — K_local is generated inside the agent process, K_server shares are distributed across directory nodes. The directory validates the pre-authorization token during this ceremony and marks it consumed. The Operations Agent is not involved. The agent is now registered and immediately online.

---

## Portal-First Path — Message-by-Message Flow

The portal-first path is used when the human operator begins at the web portal rather than messaging a bot.

**Step 1 — Portal registration.** Operator visits the CELLO web portal and initiates registration. Portal prompts for email address and sends an OTP to it.

**Step 2 — Email OTP verified in portal.** Operator enters the OTP code in the portal. Email is confirmed. Portal issues a **correlation token** — a cryptographically random, short-lived string (32 bytes, base58 encoded, expires in 30 minutes). Portal displays the correlation token and instructs the operator to message the WhatsApp or Telegram onboarding bot with it.

**Step 3 — Correlation token received by bot.** Operator messages the onboarding bot, either including the correlation token directly in their first message or in response to a bot prompt. Bot recognizes the token format, validates it against the portal session (token is looked up in a shared store keyed by the token value), and retrieves the email confirmation from the portal session.

**Step 4 — Phone acquisition.** The channel-specific flow applies. On WhatsApp, the bot already has the phone number from the sender JID and sends the OTP immediately. On Telegram, the bot sends the `request_contact` button, receives the `message.contact` event, and verifies `contact.user_id == message.from.id` — phone confirmed with no OTP needed. The same retry logic as the bot-first path applies.

**Step 5 onwards.** Identical to the shared tail of the bot-first path: email confirmed, pre-authorization token issued, bot delivers the token to the operator.

The two paths are not two implementations. They are two entry points into the same state machine. In both cases the state machine ends at `PRE_AUTH_TOKEN_ISSUED`. The difference is only in the order of arrival and the surface through which each ceremony was completed. The agent self-registers via `cello_register(token)` in both cases.

---

## Internal Architecture

### Services within the Operations Agent

**Message router.** Receives inbound messages from the Telegram webhook and the Baileys event listener. Normalizes them to a common `InboundMessage` type (sender identifier, message text, channel). Dispatches to the state machine handler.

**State machine engine.** Owns all in-flight registration state. Receives normalized messages and transitions state accordingly. Emits outbound message commands. Does not know about Telegram or WhatsApp — it knows about states and transitions.

**OTP service.** Generates and validates one-time passcodes for the WhatsApp channel — the OTP is sent as a bot message via Baileys back to the sender. Telegram does not use an OTP: phone ownership is verified by checking `contact.user_id == message.from.id` on the `message.contact` event, where `user_id` is set server-side by Telegram. No external OTP provider (e.g. Twilio Verify) is needed for either channel. Twilio Verify (or equivalent) is only needed if a third channel (e.g. SMS fallback) is ever added. The service tracks attempt counts per phone number and enforces expiry.

**Email verification service.** Sends 6-digit OTP emails (via SES or equivalent). Tracks attempt counts and send rate per email address. Enforces 15-minute expiry and the 5-sends-per-hour rate limit. The entire ceremony stays within the bot conversation — no web endpoint, no link click.

**Correlation token store.** Stores active correlation tokens keyed by token value, mapping to their associated portal session ID and email confirmation status. TTL-backed (30 minutes). Shared between the portal backend and the Operations Agent — either a shared Redis instance or a shared database table.

**Directory client.** Calls the CELLO directory's pre-authorization API once both phone and email are confirmed. Passes phone hash and email domain. Receives a pre-authorization token in response. Does not participate in FROST DKG and has no knowledge of K_local. The DKG happens later, between the agent and the directory, when the operator runs `cello_register(token)`.

**Message sender.** Sends outbound messages via the appropriate channel adapter (Telegram Bot API or Baileys). Receives outbound commands from the state machine engine.

---

## Testing Strategy

The Operations Agent is a product surface. Per the testing architecture established in the infrastructure alignment discussion, it gets end-to-end tests that run as close gates — not as an afterthought.

### Telegram end-to-end tests

Telegram provides a production-equivalent test environment at `api.telegram.org/bot<token>/test`. Test bot tokens are separate from production tokens. The test environment persists its own state independently from production.

The Telegram end-to-end test suite:
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

The Telegram and WhatsApp codepaths are distinct. Testing one is not testing the other. Both bot flows must have end-to-end test coverage. A Telegram test passing does not imply the WhatsApp path works — they share the state machine but have separate transport adapters, separate bot accounts, and different phone verification mechanisms (server-side `user_id` check for Telegram; OTP via Baileys bot message for WhatsApp).

### Pre-M5 local testing

Both bot test suites can be developed and validated during M6 against locally running CELLO infrastructure. The staging environment is built in M5, which precedes M6 in the roadmap, so staging is available from day one of M6. The end-to-end test suites should be CI-gated against staging from the start of M6 work, not added afterward.

---

## Deployment Model

### Why the Operations Agent is not a Lambda

The canonical CELLO deployment question when adding a new service is: Lambda or ECS?

Lambda is the right answer when the service is stateless, request-scoped, and tolerant of cold starts. Most of CELLO's directory and relay functionality fits that shape.

The Operations Agent does not fit that shape because of Baileys. Baileys requires a **persistent WebSocket connection** to WhatsApp infrastructure. A Lambda function terminates between invocations. A new Lambda invocation cannot resume an existing Baileys session — it would need to re-establish the WebSocket and potentially re-authenticate, which is not reliable. More critically, Baileys session state (the auth credentials) must survive across the process lifecycle. Lambda's ephemeral execution model is incompatible with this.

The Operations Agent must run as a **long-lived process** — an ECS task with a stable container instance and persistent volume for Baileys session state.

This decision applies even though the Telegram side of the Operations Agent would work fine on Lambda. The simplest deployment is one deployable — one ECS task — rather than splitting Telegram to Lambda and WhatsApp to ECS. Operational simplicity favors keeping them together.

When the Operations Agent migrates from Baileys to the official WhatsApp Business API, this constraint disappears. The official API is stateless from the application's perspective. At that point, reconsideration of Lambda deployment is reasonable.

### Baileys session persistence

Baileys session state must survive ECS task restarts. This means:
- Session credentials stored in a mounted EFS volume or in the PostgreSQL database (using a Baileys auth state adapter that writes to Postgres).
- The ECS task is a stateful workload. It must not run multiple instances concurrently (two Baileys sessions against the same WhatsApp number will conflict).
- Rolling deployments must ensure the old instance terminates and flushes its state before the new instance starts.

### Secrets

The Operations Agent requires the following secrets, each managed in AWS Secrets Manager:
- Telegram bot token (production)
- Telegram bot token (staging)
- Baileys WhatsApp session credentials (rotated after initial QR code pairing)
- SES credentials (email verification)
- CELLO directory internal API key (for the registration call)

### Topology

```
                    ┌──────────────────────────────────────────────┐
                    │  CELLO Operations Agent (ECS Task)           │
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
                                     (pre-authorization endpoint)
                                                  │
                                         returns pre-auth token
                                                  │
                                         bot delivers token
                                         to operator via chat
                                                  │
                              ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
                              (registration flow complete at this point)
                              ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
                                                  │
                                    operator: cello_register(token)
                                                  │
                                         FROST DKG over libp2p
                                    (agent ↔ directory, no bot involved)
                                    K_local generated in agent process
```

The Operations Agent never touches K_local. It obtains a pre-authorization token from the directory, delivers it to the operator, and stops. The FROST DKG runs later between the agent and the directory directly.

---

## Open Questions

These are surfaced for a future design session. They are not resolved here.

**1. Migration trigger for the official WhatsApp Business API.**
The Baileys → official API migration is a planned event, not an emergency. But there is no defined trigger. Is it a business milestone (Meta verification completed)? A usage threshold (N registrations/day)? A date-based commitment? The migration should be planned proactively rather than reactively. When does the team commit to starting the migration?

**2. Email verification ownership.**
The email verification flow described here lives in the Operations Agent. The portal also sends email OTP (portal-first path). Should there be one email verification service shared by both, or two implementations? The portal-side email OTP is described in `frontend.md` with its own rate limits and behavior. Duplication is a maintenance risk. A shared email verification service (a library, or a separate microservice) would unify the behavior. What owns it?

**3. Single bot handle or separate handles for registration vs. lifecycle operations.**
The Operations Agent handles both registration (a one-time ceremony for new agents) and ongoing lifecycle operations (security alerts, "Not Me" revocation, key rotation nudges, trust signal confirmations, succession notifications). The question is whether these should share the same bot handle — one WhatsApp number and one Telegram handle for everything — or use separate handles with distinct identities. A single handle means one contact the operator remembers and configures once. Separate handles allow independent deployment and rollout of the lifecycle-operations surface without touching the registration flow, and reduce the blast radius if one surface is disrupted. The security alerting case adds urgency: if the registration bot is temporarily down, does that also silence `FALLBACK_CANARY` alerts? If yes, that is a serious availability concern for the compromise response path.

**4. Abandoned registration cleanup.**
The state machine has a 7-day idle timeout, after which the in-flight record is discarded. But what does "cleanup" mean in practice? If the phone number is partially registered (phone confirmed, email not yet confirmed), is the phone hash released? Can the same phone number start a new registration immediately, or must the 7-day window expire first? The current design doesn't specify the cleanup behavior in detail. This needs a concrete answer before the M6 stories are written.

**5. Pre-authorization API transport: HTTP or libp2p.**
The Operations Agent calls the CELLO directory to obtain a pre-authorization token once phone and email are confirmed. The directory already has a libp2p transport layer for agent-to-directory communication (`/cello/register/1.0.0`). The question is whether the Operations Agent should call the directory over a private HTTP/REST endpoint (simple, easy to firewall, consistent with how other internal services communicate) or establish its own authenticated libp2p connection and call a new protocol stream (consistent with CELLO's internal protocol conventions, but adds implementation complexity for what is a simple internal service call). The choice affects how the Operations Agent authenticates to the directory and how the call is firewalled from the public internet.

**6. Pre-authorization token consumption: on presentation or on success.**
When the agent presents the pre-authorization token during the FROST DKG, the directory must mark the token consumed to prevent replay. The question is *when*: immediately on presentation (the token is burned as soon as the directory sees it, even if the DKG then fails), or on successful DKG completion only (token remains valid for retry if DKG fails mid-ceremony). Consuming on presentation is safer — no replay possible — but means that a transient DKG failure forces the operator back through the bot ceremony for a new token. Consuming on success allows DKG retries without re-verifying, but requires the directory to handle a narrow window where a presented-but-not-yet-consumed token could theoretically be raced. The correct choice depends on how often DKG failures are expected in practice and how painful re-verification would be for operators.

**7. Monorepo placement.**
The Operations Agent is a standalone deployable, not a CELLO protocol component. It calls the directory's internal API, but it does not implement the CELLO protocol itself. Should it live in `packages/operations-agent/` within the CELLO monorepo (convenient, shares tooling and CI, but blurs the line between protocol and product), or in a separate repository (cleaner separation, independent deploy cadence, but adds cross-repo overhead for developers who work across both)? The decision affects how the M6 stories are structured and whether the Operations Agent's tests run in the same CI pipeline as the protocol tests.

---

## Related Documents

- [[2026-05-13_1130_infrastructure-and-product-onboarding-alignment|Infrastructure and Product Onboarding Alignment]] — the discussion that established M6 as the onboarding milestone, the three-tier testing architecture, and the staging environment sequence this document builds on
- [[end-to-end-flow|CELLO End-to-End Protocol Flow]] — §1.1 and §1.2 are the canonical source for the bot-first and portal-first registration paths; this document implements those flows as a concrete state machine
- [[server-infrastructure|CELLO Server Infrastructure Requirements]] — defines the directory's registration API, OTP channel support (WhatsApp/Telegram/WeChat), phone hash uniqueness enforcement, and the FROST DKG the Operations Agent triggers
- [[frontend|CELLO Frontend Requirements]] — defines the portal-first path, the email OTP as correlation token, the registration completion flow, and the WebAuthn/TOTP enrollment warning that follows bot-first registration
- [[2026-04-11_1700_persistence-layer-design|Persistence Layer Design]] — the M4 persistence work that the Operations Agent depends on for durable state machine storage; Baileys session credentials are an additional persistence concern in the same tier
- [[implementation-roadmap|CELLO Implementation Roadmap]] — M6 in the revised sequence; this document provides the architecture that M6 stories will implement
