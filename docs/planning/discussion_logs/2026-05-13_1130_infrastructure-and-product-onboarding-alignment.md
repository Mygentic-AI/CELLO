---
name: Infrastructure and Product Onboarding Alignment
type: discussion
date: 2026-05-13 11:30
topics: [infrastructure, persistence, onboarding, registration, frontend, milestone-roadmap, testing, cicd, journey-tests, playwright, telegram, whatsapp, cross-framework, product-launch]
description: Strategic discussion identifying the gap between the protocol-centric M0–M3 roadmap and the product infrastructure needed for real deployment. Covers the missing persistence, onboarding, trust signal, and frontend milestones; the three-tier testing architecture; and the principle that journey tests ship inside every product milestone rather than as a separate testing phase.
---

# Infrastructure and Product Onboarding Alignment

## The Problem This Discussion Started With

After completing M0–M3, the protocol substrate is working. Two agents can register, negotiate a connection policy, establish a FROST-signed session, and produce a tamper-proof sealed receipt — all as separate OS processes. The automated test suite has 668 passing tests. The live smoke tests pass.

But when we looked at the implementation roadmap with fresh eyes, we realized it is a **protocol capability roadmap**, not a product roadmap. It describes what the protocol can do, in what order. It has never contained a plan for the product layer that makes the protocol usable by anyone other than an engineer who can manually bootstrap key material and start processes from a terminal.

The gaps are not minor omissions. They are entire verticals of work that have no milestone assigned:

**Registration as a real ceremony.** M3 shipped real FROST DKG, but the OTP is explicitly a stub. The bot-first onboarding path described in `end-to-end-flow.md` — agent messages onboarding bot → phone OTP → email OTP → keys generated — does not exist. Neither the WhatsApp/Telegram bot nor the email verification flow has a milestone assigned. Right now "registration" means a developer running `cello_register` over the MCP adapter. That is not a product.

**Trust signal infrastructure.** The M3 connection policy engine can evaluate `pseudonym_age`. That is the only working signal. The entire stack above it — LinkedIn OAuth, GitHub OAuth, SIM scoring via Twilio Lookup, device attestation via App Attest / Play Integrity / TPM, WebAuthn — is unbuilt. Each signal requires an external API integration, an oracle that verifies and hashes the result, directory-side storage, and client-side presentation logic. The `SignalRequirementPolicy` engine is a gate with no traffic going through it.

**Frontend.** `frontend.md` is fully specified. The web portal, mobile app, and desktop app have no milestone. The current operator procedure is terminal commands documented in a skill file. A human who owns an agent cannot configure connection policy, view the activity log, manage contacts, or do anything without writing code.

**Persistence.** `InMemoryStore` is the only store implementation. Every process restart loses all registrations, connection records, and sealed conversation roots. No schema, no backup, no recovery. A production deployment where any restart is a full reset is not a deployment.

---

## Why These Gaps Are Massive

The structural problem is that **the protocol is not the product**. The product is the combination of:
- Deployed infrastructure that persists state across restarts
- Onboarding flows that a non-developer can follow
- Trust signal machinery that actually populates the signals the policy engine evaluates
- Frontend surfaces through which operators manage their agents

M0–M3 built the underneath part. None of the surrounding structure was ever on the schedule. Getting to the end of M10 as currently written would produce a fully-specified protocol that no one can use without writing code.

The goal of this reordering is to avoid a specific failure mode: building all the functionality, then discovering at launch that the product layer is untested, incomplete, and unknown. That is the "vibebuilt" failure — everything works in isolation but nothing works together in the way a user actually experiences it.

---

## The Revised Milestone Path

The new sequence front-loads the infrastructure that makes the protocol usable, then layers product surfaces on top of it, then returns to the remaining protocol capabilities.

- **M4 — Persistence & Durable Identity:** Migrate `InMemoryStore` to SQLCipher (client) and PostgreSQL (directory/relay). Implement seed-phrase key recovery, identity permanence across restarts, tombstone persistence, and schema migration infrastructure. This is the foundation — nothing above it is stable without it.

- **M5 — Production Infrastructure:** AWS/CDK deployment for directory and relay nodes. External pipeline integration. The staging environment that journey tests run against. Multi-process smoke testing against deployed infrastructure, not in-process Vitest. This is the prerequisite for every downstream close gate.

- **M6 — Onboarding & Registration Product:** Real Telegram and WhatsApp onboarding bots with phone OTP. Email verification. The bot-first and portal-first registration paths from `end-to-end-flow.md`. Real registration replaces the stub everywhere.

- **M7 — Portal Surface & Trust Signals:** Web portal (portal.md surfaces: agent management, connection policy configuration, activity log, contact management). LinkedIn OAuth, GitHub OAuth, and SIM scoring oracles. The async trust signal pickup queue. Device attestation (App Attest, Play Integrity, TPM) where the native app surfaces exist.

- **M8 — Security & Defense:** Prompt Injection Defense (shifted from original M4). Six-layer pipeline: deterministic sanitization, DeBERTa scanner, outbound gate, redaction, runtime governance, access control. Observe mode, per-peer overrides, and block notifications — gaps identified in the DashClaw competitive review.

The original M5–M10 milestones (Discovery & Notifications, Social Trust, Compromise & Recovery, Group Rooms, Commerce, Federation) follow after M8, resequenced as the restored tail of the roadmap.

---

## The Testing Architecture: Three Tiers

The other major gap: CELLO has no name, no designated place, and no story structure for product-level end-to-end tests.

### Naming correction

CELLO has been calling its protocol-level tests "E2E tests" (`CELLO-E2E-001` through `CELLO-E2E-004`, the `e2e-tests/` package). This naming made sense for M0–M3 because testing two real processes exchanging signed messages over real libp2p *was* the entire system — there was no product layer above it. As the product layer grows, those tests are clearly integration-level: they verify components integrate correctly, not that the product works for a user.

We are adopting industry-standard naming going forward:

| Tier | Name | What CELLO has been calling it |
|---|---|---|
| 1 | Unit tests | Unit tests ✓ |
| 2 | Integration tests | "E2E tests" ← rename |
| 3 | End-to-end tests | Doesn't exist yet |

The `e2e-tests/` package will be renamed to `integration-tests/` as a housekeeping task in M4. All story IDs that reference `E2E` (CELLO-E2E-001 through CELLO-E2E-004) retain their IDs for historical continuity but their descriptions will reflect the corrected tier name.

### The three tiers

| Tier | Written from whose perspective | What it proves | Tooling |
|---|---|---|---|
| Unit tests | Library author | This function does what the code says | Vitest |
| Integration tests | Protocol designer | These components integrate correctly over real processes | Vitest + real libp2p nodes |
| **End-to-end tests** | **Operator / end user** | **This workflow works as advertised** | **Playwright, bot APIs, scripted agent sessions, cross-framework agent sessions** |

End-to-end tests drive the actual product surfaces and assert on observable product outcomes. They are the test equivalent of: *Can the user sign up? Can the user validate a LinkedIn profile? Can Agent A connect to Agent B whose policy requires LinkedIn?*

These tests exist in every production application. The goal of this discussion is to build the end-to-end test harness **as we build the functionality** — not as a separate phase afterward. By the time the full product exists, every surface it exposes should already be continuously validated in CI.

---

## The End-to-End Test Surface Map

Different end-to-end tests use different harnesses depending on which product surface they drive. "End-to-end tests" is not synonymous with Playwright:

| Surface | Test approach | Notes |
|---|---|---|
| Web portal | Playwright | Against staging environment |
| Telegram onboarding bot | Telegram Bot API test server | Telegram provides a separate test environment at `api.telegram.org/bot<token>/test` with separate credentials |
| WhatsApp onboarding bot | WhatsApp Business API sandbox | Twilio sandbox or Meta test numbers; more restrictive than Telegram's sandbox |
| Claude Code agent journeys | Scripted MCP tool calls | Two Claude Code sessions executing the journey programmatically — the same mechanism as the M3 live smoke tests, formalized and automated |
| Cross-framework journeys | Claude Code × OpenClaw (and later Hermes, IronClaw) | These are the interoperability proof — if two different frameworks can register, connect, and exchange sealed sessions through the same directory and relay, that's the protocol claim, not just the Claude implementation |

The Telegram and WhatsApp surfaces need both to be tested because their bot implementations have distinct codepaths. Testing one is not testing the other.

The cross-framework dimension is underappreciated in the current roadmap. A Claude Code ↔ OpenClaw journey test is not a nice-to-have — it is the proof that CELLO is a protocol and not a Claude-specific feature. That journey should be a close gate for the adapter milestone that ships the OpenClaw adapter, not deferred.

---

## The Core Principle: End-to-End Tests Ship Inside Milestones

The key structural decision from this discussion:

**End-to-end tests are not a milestone. They are a first-class deliverable inside every product milestone.**

The same discipline already established for the protocol side — "a milestone is not done until the live smoke test passes" — extends upward to every product surface. When M6 ships the Telegram onboarding bot, the Telegram sandbox end-to-end test ships with it, runs in CI, and is a close gate. Not a separate testing effort later. Not "we'll add coverage when the dust settles."

A story that ships a bot flow without shipping the bot sandbox end-to-end test that runs in CI is not done, the same way a protocol story without red-first TDD is not done.

This means by the time the full product exists, CI already contains:
- A staging environment live since M5
- A Playwright suite growing since the portal shipped in M7
- Telegram and WhatsApp sandbox end-to-end tests running since M6
- Claude Code × Claude Code agent end-to-end tests running since M3 (formalized from the existing live smoke test practice)
- Cross-framework end-to-end tests running since the first non-Claude adapter shipped

Nothing is untested at launch. Launch is the day production traffic is pointed at infrastructure that has been continuously validated across all surfaces.

---

## How the End-to-End Architecture Grows With Staging

The most important thing to understand about the E2E architecture is that it does not appear all at once at the end of M5. It grows incrementally, milestone by milestone, in lockstep with the staging environment that each milestone brings online. Some end-to-end tests can begin before staging even exists.

### Before M5: What can be E2E tested without a staging environment

Not all E2E tests require a deployed environment. The agent-to-agent tier in particular can run against locally started processes — the same pattern as the M3 live smoke test, but formalized and scripted for CI. These tests start in M4 and verify that the persistence layer actually survives process restarts: register an agent, kill the process, restart it, assert the registration persists. That is an end-to-end test in the meaningful sense — it drives the product from the outside and asserts on a user-visible outcome — and it requires no staging infrastructure at all.

The Telegram and WhatsApp bot sandbox environments are also largely independent of the CELLO staging deploy. Telegram's test server and the WhatsApp Business sandbox can be pointed at a locally running directory and relay, which means bot end-to-end tests can be written and validated during M6 without waiting for production-grade AWS infrastructure. Staging makes them part of the fully automated CI pipeline, but the tests themselves can be developed and manually validated earlier.

### The staging environment builds incrementally across M4–M7

The staging environment is not a single deliverable that arrives fully formed at the end of M5. It grows as each milestone adds something deployable:

**After M4 (Persistence):** The directory and relay can be deployed with durable storage for the first time. The first staging deploy is minimal — no public access, no bot integration, no portal — but it is a real persistent deployment. Agent-to-agent E2E tests can be pointed at it. The cross-machine integration test (deferred since M0) can finally run against something stable.

**After M5 (Production Infrastructure):** The staging environment becomes the fully automated CI target. AWS/CDK infrastructure is codified. The CI pipeline gains a "deploy to staging" stage between integration tests and E2E tests. Every merge to main deploys to staging and runs the E2E suite against it. The staging environment at this point supports agent-to-agent tests only — no bots, no portal yet.

**After M6 (Onboarding):** The Telegram and WhatsApp bots are deployed to staging. The bot E2E tests move from manually validated to CI-gated. The staging environment's onboarding flow is now testable end-to-end: a scripted test registers a new agent through the Telegram bot, confirms OTP, and asserts the agent appears in the directory.

**After M7 (Portal & Trust Signals):** The web portal is deployed to staging. Playwright tests join the CI pipeline. The full onboarding + portal flow is E2E testable: register via bot, open portal, add LinkedIn signal, verify it appears in connection package. The trust signal oracles (LinkedIn OAuth, GitHub OAuth, SIM scoring) each have their own sandbox credentials and E2E tests.

### The CI pipeline shape at each milestone

```
M4 and earlier
  unit tests → integration tests → [manual] agent-agent E2E (local processes)

M5
  unit tests → integration tests → deploy to staging → agent-agent E2E (staging)

M6
  unit tests → integration tests → deploy to staging → agent-agent E2E
                                                      → bot E2E (Telegram sandbox)
                                                      → bot E2E (WhatsApp sandbox)

M7
  unit tests → integration tests → deploy to staging → agent-agent E2E
                                                      → bot E2E (Telegram + WhatsApp)
                                                      → portal E2E (Playwright)
                                                      → trust signal E2E (OAuth sandboxes)

M8+
  all of M7, plus cross-framework E2E as each new adapter ships
```

Each stage is a gate — a failure in the E2E suite blocks merge. The pipeline does not accumulate tests silently; each milestone adds a new CI gate at the same time it ships the feature that gate validates.

### The test directory structure

As part of the M4 housekeeping rename, the package structure becomes:

```
integration-tests/      # renamed from e2e-tests/ — in-process Vitest against real libp2p
├── m0/
├── m1/
├── m2/
└── m3/

e2e-tests/              # new — runs against staging (or local processes pre-M5)
├── agent-agent/        # Claude Code × Claude Code scripted end-to-end tests (M4+)
├── onboarding/         # Telegram + WhatsApp bot flows — sandbox APIs (M6+)
├── portal/             # Playwright against staging portal (M7+)
├── trust-signals/      # OAuth sandbox flows, SIM scoring sandbox (M7+)
└── cross-framework/    # Claude Code × OpenClaw, Claude Code × Hermes, etc. (per adapter)
```

The `agent-agent/` subdirectory is the first to exist (M4) and the only one that runs without a fully deployed staging environment. Everything else gates on M5 or later.

---

## Key Decisions

1. **Rework the existing implementation roadmap, not a separate document.** Two roadmaps diverge and create cross-document dependencies that get missed. The protocol and product milestones have hard dependencies on each other; they belong in one sequence.

2. **M4–M7 are infrastructure and product milestones.** They precede the remaining protocol milestones (Discovery, Social Trust, Compromise & Recovery, Group Rooms, Commerce, Federation) because they are foundations — persistence, deployment, onboarding, and frontend — not features layered on top of a working system.

3. **No parallelism through M7.** Product milestones must not run in parallel with the infrastructure milestones they depend on. Persistence (M4) must be complete before deployment (M5). Deployment (M5) must be complete before onboarding (M6) can run its journey tests against staging. The risk of building on moving foundations is worse than the cost of sequential execution.

4. **Every product milestone has an explicit end-to-end test close gate.** Each milestone description must name: which end-to-end scenarios must pass, which surface they run against (Telegram sandbox, WhatsApp sandbox, Playwright against staging, scripted agent sessions), and that they run in CI before the milestone is closed.

5. **M5 Production Infrastructure is the load-bearing prerequisite.** Not because features need it, but because the entire journey test architecture needs something to run against. The staging pipeline is the prerequisite for the testing architecture above it.

---

## Related Documents

- [[implementation-roadmap|CELLO Implementation Roadmap]] — the document to be revised based on this discussion
- [[server-infrastructure|CELLO Server Infrastructure Requirements]]
- [[frontend|CELLO Frontend Requirements]]
- [[2026-04-11_1700_persistence-layer-design|Persistence Layer Design]]
- [[2026-05-09_1100_dashclaw-m4-competitive-review|DashClaw M4 Competitive Review]] — M8 Security & Defense gaps identified here
- [[end-to-end-flow|CELLO End-to-End Protocol Flow]] — the onboarding flows that need real milestones
