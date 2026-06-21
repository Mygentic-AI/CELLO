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
