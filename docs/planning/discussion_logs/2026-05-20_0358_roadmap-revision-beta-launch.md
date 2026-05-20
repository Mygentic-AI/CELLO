---
name: Roadmap Revision - Beta Launch Sprint (June 3rd)
type: plan
date: 2026-05-20
topics: [roadmap, beta, sprint-planning, onboarding, multi-agent]
status: active
description: Strategic roadmap revision to achieve beta-user launch by EOD June 3rd, shifting focus from protocol capabilities to product-layer delivery across four 3.5-day sprints.
---

# Roadmap Revision: Beta Launch Sprint (June 3rd)

## 1. The Problem
The current milestone roadmap is capability-centric (M0–M14), focusing on protocol depth rather than product usability. We have a working protocol substrate (M0–M3) and persistence foundation (M4), but zero product infrastructure (Onboarding, Identity management, Portal UI). Without these, the protocol is usable only by engineers via terminal commands. To reach a beta-ready state where users can self-register, manage multi-agent accounts, and configure policy, the roadmap must be re-sequenced into a product-first delivery flow.

## 2. Sprint Math
*   **Timeframe:** May 20 – June 3 (15 calendar days).
*   **Capacity:** 14 coding days (assuming 1 rest day/week).
*   **Velocity:** 3.5 days per milestone.
*   **Deliverable:** 4 milestones (4 * 3.5 = 14 days).
*   **Launch Buffer:** June 1–3 (3 days) reserved for E2E hardening and final beta validation.

## 3. Four-Sprint Beta Roadmap

| Sprint | Milestone | Focus |
| :--- | :--- | :--- |
| **1** | **M5** | **Production Infrastructure:** Deploy 6-region RDS federation; CI/CD pipeline; Schema migration for `AccountID` (Multi-Agent Support). |
| **2** | **M6** | **Onboarding Product:** Bot-led registration (Phone/Email OTP); Automated `AccountID` + `AgentID` provisioning; Identity anchoring. |
| **3** | **M7** | **Portal Skeleton:** Authentication (WebAuthn/TOTP); Dashboard (Agent Health, Signal feed); Multi-Agent Account management. |
| **4** | **M8** | **Beta Hardening:** Security Pipeline (DeBERTa/Sanitization); "Not Me" trigger; Account-level trust aggregation verification. |

## 4. Execution Strategy
*   **Product-Bridge:** Portal login uses a standard magic link sent to the M6-verified email address, immediately followed by WebAuthn/PIN enrollment on first login. The bot's sole responsibility is issuing the Pre-Authorization token used by the agent CLI for its local FROST ceremony.
*   **Multi-Agent First:** All backend/schema work in M5 and M6 must support the `1:N Account-to-Agent` architecture from day one.
*   **Integration Gates:** Every sprint includes its own automated end-to-end test suite as a hard close gate, preventing "product-layer" regressions as we build.
*   **Constraint:** The development loop is sequential (M5→M6→M7→M8). No milestone is considered complete until it passes its live, multi-process E2E smoke test in the staging environment.
