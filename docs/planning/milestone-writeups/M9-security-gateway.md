---
name: M9 — Security Gateway
type: milestone-writeup
date: 2026-06-21
updated: 2026-07-12
milestone: M9
status: deferred (parked post-harvest, pending M8C completion)
description: >
  M9 defines a deterministic, local-first security and governance layer that sits between the daemon 
  and the agent. It provides prompt injection defense, secret redaction, and policy enforcement.
---

# M9 — Security Gateway

**Status:** Planned and designed. Implementation currently deferred until after M8C.

M9 introduces the security and governance layer. Following the capability harvest, M9 is split into two phases: Phase 1 (local, launchable version) and Phase 2 (remote/company gateway with tamper-proof records).

## Architecture & Invariants
- **Deterministic Base:** The pipeline uses regex, entropy scoring, and a lightweight, in-process INT8 DeBERTa injection scanner. There are no network calls and no LLM-judgment in the base path.
- **Not Moderation:** The layer defends against identity spoofing, prompt injection, and data exfiltration (secrets/PII). It does not police toxicity, sentiment, or topic.
- **Unified Seam:** All inbound content passes `ingestReceivedContent`; all outbound passes `cello_send`. The gateway hooks these exact two points.
- **Feedback Channel:** Every `cello_send` returns a terminal verdict (observe / redact / block / warn) with actionable guidance. It never hangs.
- **Local Sovereignty (Phase 1):** The gateway owns its config and records in its own local SQLCipher file, ensuring operators/companies can control policies independently of the agent's daemon.

## Next Steps
The gateway integration branch (`m9-build`) is ready for semantic gating. Once M8C concludes, `DOD-M9INT-1` will merge the gateway seam into `cello-client` `main`, activating the pipeline.
