---
name: M16 Build Journal
type: journal
date: 2026-09-02
milestone: M16
status: open
topics: [m16, broadcast, channels, journal, evidence]
description: >
  Append-only evidence record for M16 (broadcast channels). Per unit, four entries: tests red,
  gate green, enforcer run, reviewer verdict — each a few lines plus pasted output. NEW-FINDING
  entries (five lines max) and their same-day dispositions also live here. The DoD is the
  scoreboard; this is where the proof lives.
---

# M16 Build Journal

Append-only. Newest entries at the bottom. Entry format per M16-PROCEDURE §4.10 and §5a.

---

## 2026-09-02 — Milestone opened

DoD (22 lines, count frozen), procedure, and this journal created from the 2026-08-23 design log
plus the 2026-09-02 decision addendum (decisions 22–35). No work orders issued yet — Tier 0 work
orders are the planner's next step.

## 2026-09-02 — Tier 0 micro orders 001–006 issued (planner)

Written against a three-agent recon of the real code in both repos (crypto/tree/seal machinery;
registration/profile path; receiver gate + protocol-types layout). Notes that bind later work:

- **Five orders became six at a real seam:** the identity line splits at the npm boundary —
  004 (cello-client wire/IPC/persistence) must be **published and promoted (planner/Andre)**
  before 005 (directory) can build; 006 (daemon-side refusals) needs only 004 merged. 005's
  step 0 verifies the installed types and STOPs if absent.
- **Recon facts recorded so nobody re-derives them:** consistency proofs exist NOWHERE in
  cello-client (001 adds them beside `merkle.ts`, which is already RFC-6962-shaped —
  promotion, not duplication); the house CBOR encoder is deterministic for ARRAYS only, domain
  slot 0, one-encoder guard test; `core/crypto` and `core/daemon` list test files explicitly in
  `tsconfig.test.json` (a missing entry silently escapes the build) while `core/protocol-types`
  has no such file; `trust-signal.ts` already imports `hash` from `@cello-protocol/crypto`, so
  the "leaf package" comment in `connection-package.ts` is stale; there is NO client-side
  directory-profile fetch and NO profile-update endpoint (profiles are append-only by design);
  V64 is the next free directory migration and `migration-numbering.test.ts` +
  `infra/terraform/ops-agent.tf` both pin the number.
- **Planner rulings embedded in the orders (refining decision 31):** `channel` and
  `admin_pubkey` are IMMUTABLE, set at registration only — no update path in v1 (admin
  transfer → post-M16 backlog); a channel registration fails LOUDLY unless the directory
  echoes `channel: true` (guards the 004-before-005 window); no assignment-TBS change — the
  receiver-side check for REMOTE channels moves to SUBSTATE-1 (clause added to that DoD line),
  since subscription state is the only trustworthy local source, while 005 (directory broker
  refusal, both directions, fail-closed) and 006 (never initiate as / never accept to a local
  channel) close the rest.
- **Sequencing:** 001, 002 independent (two lanes possible); 003 after 002; 004 anytime; 005
  after 004-published (and its deploy — terraform apply + node roll + GCP-STATE.md — stays
  with the planner); 006 after 004-merged.
