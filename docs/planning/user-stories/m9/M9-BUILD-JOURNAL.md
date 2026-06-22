---
name: M9 Build Journal
type: journal
date: 2026-06-21
milestone: M9
status: open
description: >
  Append-only build journal for M9 (the security gateway). One entry per unit of work.
  NEVER edit a prior entry. This is the live-state + audit-trail follow-through doc: a
  fresh context reads the last few entries to resume. Pairs with M9-DEFINITION-OF-DONE.md
  (the target) and M9-PROCEDURE.md (the runbook). See M9-PROCEDURE.md §0 for read order
  and §1 for what each entry must contain.
---

# M9 Build Journal (append-only)

> Newest entries at the BOTTOM. Never edit or delete a prior entry. Each entry: DoD-ID,
> what was red, what was found, commit hashes, reviewer outcome, blockers, decisions.
> (M9-PROCEDURE.md §1, §9.)

---

## 2026-06-21 — M9 planning complete (no code yet)

**State.** M9 is opened for planning, not building. The canonical gateway design (V3,
2026-05-28) already exists; what was missing — and what blocked a clean start — was where
the gateway attaches to the daemon's content channel. That is now settled.

**Produced this session (docs only, committed to trustless-cello `main`):**
- `discussion_logs/2026-06-21_1600_m9-content-channel-seam-and-entry-plan.md` — the entry
  plan: the daemon seam, the MSG-001-3b co-design, the dependency gate, the doc apparatus.
- `M9-DEFINITION-OF-DONE.md` — the yardstick. Every M9 requirement pulled from V3 + the
  overview + the eight story YAMLs + the production-gap analysis, ordered, status-tagged,
  mapped to six live journeys (J-SCREEN → J-ATTEST).
- `M9-PROCEDURE.md` — the runbook (three artifacts, the red-driven loop, cadence, M9
  hard rules, the dependency gates).
- `M9-BUILD-JOURNAL.md` — this file.

**The seam (settled, code-verified on `m7-rehome`).** The daemon calls the gateway twice:
- OUTBOUND `screenOutbound` at `cello_send` (`daemon.ts:2616`), before
  `sessionNodeManager.sendContent` (`session-node-manager.ts:1406`). Park deposit carries
  already-sealed ciphertext, already screened at `sendContent` — no second egress.
- INBOUND `screenInbound` at `ingestReceivedContent` (`session-node-manager.ts:1548`),
  before the `#receivedContent` buffer `cello_receive` (`daemon.ts:2707`) drains.

**The co-design decision (with the MSG-001-3b coder, 2026-06-21).** Increment 3's
recovery path routes `pull → openSealed (in-daemon) → ingestReceivedContent`, the SAME
inbound funnel as direct receive — NOT handing ciphertext to the agent. Otherwise parked/
recovered messages would reach the agent unscanned (injection bypass). The coder confirmed
this is their plan, made the leaf-append dedup-aware (chokepoint stays unconditional —
scan + cross-check + buffer always run), and **LOCKED the single-inbound-funnel acceptance
criterion** into MSG-001-3b increment 3 (trustless-cello commit `bc047c7`). The inbound
seam has NO schema dependency (only the outbound startup-flush park does). Recorded in
memory `project_m9_content_channel_seam`.

**Dependency gates (M9-PROCEDURE §8).**
1. **J-SCREEN seam (M9-SCREEN-SEAM / INV-3) is 🔒 on MSG-001-3b increment 3** landing with
   its LOCKED AC. Until then the recovered-park-content path can bypass the gateway.
2. **Hook-governance UX (M9-HOOKGOV-1) is 🔒 on M8** (portal). The hook engine + audit
   trail still ship in M9; only the portal-surfaced UX waits.
3. **Unblocked now:** the gateway repo/package skeleton, the `SecurityGatewayClient`
   interface + local stub, and the `SecurityAttestation` directory-schema *design*.

**Open decisions to resolve before/at the relevant journey (flagged in the DoD/entry plan):**
1. `message_sequence` binding — recovery path is sequence-then-content (sequence at hash-
   witness; content later). M9-ATTEST keys on the `appendSessionLeaf` leaf index; must not
   assume content+sequence land atomically on the park path.
2. fail-open vs fail-closed when the gateway is unreachable — per-deployment policy; the
   daemon hook home is `ingestReceivedContent` (one inbound place).
3. The eight existing story YAMLs (SCAN/REDACT/MONITOR) predate V3 + the daemon — each
   needs a rewrite-pass note stating its daemon seam (`ingestReceivedContent` /
   `sendContent`), not the dead `client` package.

**Next red (the first unit of actual work — once Andre opens the build).** Per
M9-PROCEDURE §5/§8, start with the unblocked scaffolding, not a gated journey: stand up
the gateway repo/package skeleton + the `SecurityGatewayClient` adapter (the two daemon
call sites wired to a no-op local stub) + the `SecurityAttestation` schema design. Then,
when MSG-001-3b increment 3 lands, write **J-SCREEN** as the first live journey (Layer 1
inbound + the recovered-park-content seam assertion).

**Reviewer outcome / blockers.** N/A (docs only this entry). No code, no tests run.
Nothing merged, nothing pushed beyond the planning docs (Andre's call to open the build).

---

## 2026-06-22 — Correction: planning was NOT complete; full design pass done; still no build

The entry above said "planning complete." That was premature. A full design pass happened
after it, all of it design, none of it build. No code has been written for M9. This entry
brings the journal current.

**What happened (2026-06-21 → 06-22):**
- **Capability harvest.** Gathered everything usable from gitleaks (all 222 secret detectors
  + the engine), the whole Infisical repo (governance architecture), and the LLM-guardrail
  field (inbound + outbound). In `M9-CAPABILITY-HARVEST.md` §1–§4.
- **Prune.** Went capability by capability and decided what's in / opt-in / out / Day-2.
  Cut: tool allowlists, Layer 5 (LLM-call governor), Layer 6 (deny-all FS/URL), all content
  moderation. The scoping invariant: CELLO is not a moderation tool. In §5, §7.
- **Governance feedback channel.** Designed how the gateway reports back to the LLM: the four
  dispositions (observe / redact / block / warn), blocking `cello_send` with a never-hang
  guarantee, the stateless re-send flow with `governance_decisions`, the PII whitelist + warn
  model. In §6.
- **Config architecture.** The gateway owns its own SQLCipher DB (separate file/key), versioned,
  tighten-free / loosen-confirmed. In §7.
- **Two-phase build.** Phase 1 = local, launchable, ends at Gate 1. Phase 2 = remote gateway +
  tamper-proof records, ends at Gate 2. In §9.

**Docs rewritten to match (committed to main):**
- `M9-DEFINITION-OF-DONE.md` — rewritten to the two-phase plan with the full story list +
  one-line done-conditions (commit `7725e2ab`). The old six-journey (J-SCREEN → J-ATTEST)
  structure is gone.
- `overview.md` — rewritten as a pointer to the harvest + DoD, with the mapping from the eight
  old SCAN/REDACT/MONITOR YAMLs to the new stories (`7725e2ab`).
- `M9-CAPABILITY-HARVEST.md` — §9 added (`14f966c8`).

**State now.** M9 is design-complete. No build. The eight old story YAMLs are superseded at the
plan level (mapped in the DoD/overview); the individual new-story YAMLs are written at build
time, one at a time, not now.

**Blocked on.** MSG-001-3b increment 3 (M7) for the live inbound screening. The gateway skeleton
and the outbound/feedback slice do not depend on M7 and could start early, but that splits focus
from M7, which is the launch blocker.

**Next.** When M7 unblocks, build Phase 1 starting with M9-CORE-001 (gateway skeleton + the
daemon seam). Nothing to do in this journal until a build unit actually starts.
