---
name: Infrastructure and Product Onboarding Alignment
type: discussion
date: 2026-05-13 11:30
topics: [infrastructure, persistence, onboarding, registration, frontend, milestone-roadmap]
description: Discussed the gap between the protocol-centric roadmap (M0-M3) and the need for user-facing product infrastructure. Identified the absence of a persistence layer milestone, onboarding ceremonies, and frontend surfaces. Proposed a reordering of milestones to prioritize persistence and production infrastructure before frontend development.
---

# Infrastructure and Product Onboarding Alignment

## Current State Assessment
- We have completed M0–M3, focusing on protocol substrate, transport (libp2p), and session notarization (Merkle/Relay).
- The current implementation roadmap is essentially a "protocol-only" build schedule. It lacks milestones for:
    - **Registration/Onboarding Product:** Bot/Portal flows, email/phone OTP, and correlation tokens are currently treated as test fixtures/dependencies rather than product features.
    - **Frontend Surfaces:** While `frontend.md` is fully specified, no roadmap milestone allocates effort to build the Web Portal, Mobile App, or Desktop App.
    - **Trust Signaling:** Social OAuth (LinkedIn/GitHub/X) and the oracle-based trust-signal hashing flow are missing from the build sequence.
    - **Persistence:** Real persistence is currently "assumed" via an interface swap (`InMemoryStore` → `SQLCipher`). There is no dedicated milestone for schema migration, data integrity, and backup/recovery (seed phrase management).

## Strategic Shift: Persistence as Foundation
- We need to treat **Persistence** (M4) as the foundation for both the registration/frontend work and the production infrastructure deployment.
- Integrating persistence *now* prevents "architectural drift" where the frontend expects data structures that the protocol team might still be iterating on.

## Revised Milestone Path
- **M4 (Persistence & Durable Identity):** Migrate to SQLCipher/PostgreSQL. Implement seed-phrase key recovery, identity permanence, and tombstone persistence.
- **M5 (Production Infrastructure):** AWS/CDK deployment for directory/relay nodes, external pipeline integration, and multi-process smoke testing.
- **M6 (Onboarding & Registration Product):** Bot/Portal flows, email/phone OTP, and registration product lifecycle.
- **M7 (Portal Surface & Trust Signals):** Web Portal, OAuth oracles, and the asynchronous pickup queue.
- **M8 (Security & Defense):** (Shifted from M4) Prompt Injection Defense, auditability.

## Key Decisions
- **No Parallelism:** We will not run product development in parallel to protocol stabilization. We are following a linear path to ensure foundation (M4/M5) precedes feature (M6/M7) to guarantee product stability.
- **Integration Gates:** Every milestone now closes with a "Live Multi-Process Smoke Test" using the production pipeline (M5).

---

## Related Documents
- [[implementation-roadmap|CELLO Implementation Roadmap]]
- [[server-infrastructure|CELLO Server Infrastructure Requirements]]
- [[frontend|CELLO Frontend Requirements]]
- [[2026-04-11_1700_persistence-layer-design|Persistence Layer Design]]
