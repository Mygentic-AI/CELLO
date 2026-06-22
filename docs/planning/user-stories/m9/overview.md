---
name: M9 Overview — Security and Governance Layer
type: design
date: 2026-06-22
topics: [security-architecture, prompt-injection, redaction, gateway, governance, two-phase, hooks, directory-attestation]
status: active
description: Entry point for M9, the security and governance layer. Points at the current plan (the capability harvest and the Definition of Done). The earlier six-layer framing and the eight SCAN/REDACT/MONITOR story YAMLs are superseded; the mapping is below.
---

# M9 Overview — Security and Governance Layer

M9 is CELLO's security and governance layer. It runs as a **separate gateway program** that
every message passes through. On the way in, it screens for prompt injection. On the way out,
it stops secrets and personal data from leaking. It reports back to the agent what it did to
each message.

## Read these, in order

1. **`M9-CAPABILITY-HARVEST.md`** (this folder) — the decisions. What's in, what's out, the
   governance feedback channel, the config design, and the two-phase build. This is where the
   reasoning lives.
2. **`M9-DEFINITION-OF-DONE.md`** (this folder) — the plan. The two phases, the two end-to-end
   gates, and the full list of stories with a one-line done-condition each.
3. **`discussion_logs/2026-05-28_1000_security-layer-v3-extensibility-and-split-gateway.md`** —
   the gateway internals (the interface contract, the hook design, the record/attestation model).
4. **`discussion_logs/2026-06-21_1600_m9-content-channel-seam-and-entry-plan.md`** — where the
   gateway attaches to the M7 daemon, and the build gate (MSG-001-3b).

## The shape of the plan

- **Two phases.** Phase 1 runs everything locally and is launchable on its own. Phase 2 adds
  the remote (company) gateway and the tamper-proof records. You can stop after Phase 1.
- **Two gates.** Each phase ends with one end-to-end test against the real programs.
- **Build is blocked on M7** (MSG-001-3b increment 3) for the live inbound screening. The
  gateway skeleton and the design can start now.

The story list and done-conditions are in the Definition of Done. Don't duplicate them here.

## Superseded — the old six-layer framing and the eight story YAMLs

The earlier design split M9 into six numbered layers and eight story files. The prune
(2026-06-22) changed that. The eight YAMLs in this folder are **superseded by the Definition
of Done's story list.** Mapping:

| Old story | Old scope | Now |
|---|---|---|
| CELLO-SCAN-001 | Layer 1 sanitization | → **M9-IN-001** (inbound sanitization) |
| CELLO-SCAN-002 | Layer 2 DeBERTa scan | → **M9-IN-002** (inbound injection scan) |
| CELLO-SCAN-003 | Layer 3 outbound gate | → split into **M9-OUT-001/002/003**; its moderation/ToS parts moved to Day 2 (LLM) |
| CELLO-REDACT-001 | Layer 4 redaction | → **M9-OUT-001** (secrets) + **M9-OUT-002** (PII whitelist + warn) |
| CELLO-REDACT-002 | Layer 5 LLM-call governor | **RETIRED** — cut in the prune (governs the agent's own LLM use, upstream of `cello_send`) |
| CELLO-REDACT-003 | Layer 6 deny-all FS/URL | **RETIRED** — cut (upstream tool/sandbox concern) |
| CELLO-REDACT-004 | Audit + verification | → local records **M9-REC-001** (Phase 1) + directory attestation **M9-ATTEST-001** (Phase 2) |
| CELLO-MONITOR-001 | Continuous monitoring | → folded into the **M9-ATTEST-001** check job (Phase 2) |

New stories with no old equivalent: **M9-CORE-001** (gateway skeleton + daemon seam),
**M9-IN-003** (language allowlist), **M9-OUT-004** (rate-limit), **M9-FEED-001** (the
governance feedback channel), **M9-CFG-001** (config storage), **M9-GATE-1** / **M9-REMOTE-001**
/ **M9-GATE-2** (Phase 2).

The full per-story YAML specs are written when each story is picked up for build (the project's
`/cello-story` flow), against the Definition of Done. The two retired YAMLs (REDACT-002,
REDACT-003) describe cut work — do not build from them.

`attack-corpus-reference.md` (this folder) stays as the attack catalog for writing tests.

## Related documents

- [[M9-CAPABILITY-HARVEST]] — the decisions (harvest + prune + governance channel + two-phase build).
- [[M9-DEFINITION-OF-DONE]] — the plan (phases, gates, story list).
- [[2026-05-28_1000_security-layer-v3-extensibility-and-split-gateway|Security Layer V3]] — gateway internals.
- [[2026-06-21_1600_m9-content-channel-seam-and-entry-plan|M9 Content-Channel Seam and Entry Plan]] — the daemon seam + build gate.
- [[2026-05-16_1130_security-layer-improvements-from-production-reference|Security Layer Improvements from Production Reference]] — the gitleaks/RE2/entropy/PII findings, now folded into the harvest.
- [[2026-05-21_1456_identity-as-governance-foundation|Identity as the Foundation of Governance]] — where this sits in the broader governance picture.
