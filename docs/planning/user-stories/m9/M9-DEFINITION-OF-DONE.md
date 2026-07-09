---
name: M9 Definition of Done
type: definition-of-done
date: 2026-06-22
milestone: M9
status: open
description: >
  What "done" means for M9, the security and governance layer. Rewritten 2026-06-22 to
  match the decisions in M9-CAPABILITY-HARVEST.md (the harvest + the prune + the governance
  feedback channel + the two-phase build). This replaces the earlier six-layer/J-SCREEN
  version, which predated those decisions. This is the plan: the two phases, the two
  end-to-end gates, and the full list of stories with a one-line done-condition each.
---

# M9 — Definition of Done

## How to read this

- M9 is built in **two phases** (see M9-CAPABILITY-HARVEST.md §9). Phase 1 runs everything
  locally and is launchable on its own. Phase 2 adds the remote (company) gateway and the
  tamper-proof records. You can stop after Phase 1.
- Each phase ends with one **end-to-end gate** — a test that spawns the real programs and
  proves the whole loop. A story is "done" only when its piece works and the phase gate is
  green. Unit tests passing is not done (M7 proved that).
- **Source of decisions:** M9-CAPABILITY-HARVEST.md (§5–§9 = the prune, the governance
  channel, the config architecture, the two-phase build). **Gateway internals:**
  `discussion_logs/2026-05-28_1000_security-layer-v3-extensibility-and-split-gateway.md`.
  **Daemon seam:** `discussion_logs/2026-06-21_1600_m9-content-channel-seam-and-entry-plan.md`.

## Status legend

- ✅ done and gate-green · 🟡 built, gate not yet run · ❌ not built · 🔒 blocked on a named dependency.
- Everything is ❌ today. M9 has not started building.

## The build gate (still holds)

The live build is blocked on **MSG-001-3b increment 3** (M7) — the unified inbound funnel,
so recovered/parked content passes the same inbound point as direct content. Design work and
the gateway skeleton can start now; the inbound screening cannot be proven live until that lands.

---

## Invariants (must hold everywhere)

- **INV-1 — No-LLM base.** The detection pipeline is deterministic. The only model is the
  DeBERTa injection scanner, loaded into gateway memory; no network calls in the base path.
- **INV-2 — Not a moderation tool.** No toxicity / sentiment / bias / emotion / topic policing,
  in or out. The layer defends identity, injection, and data exfiltration only.
- **INV-3 — Deterministic base (Phase 1) vs LLM-judgment (Day 2).** Anything needing judgment
  (moderation, fuzzy policy) is not in the base pipeline. It is Day 2, done by the agent
  upstream or an operator's own policy-LLM via a hook.
- **INV-4 — The gateway is the enforcer; it owns its config and records.** Config and records
  live in the gateway's own SQLCipher file (same library as the daemon, separate file + key),
  never the daemon's. In the company setup the employee controls the daemon but not the gateway.
- **INV-5 — Unified daemon seam.** All inbound content passes `ingestReceivedContent`; all
  outbound passes `cello_send`. The gateway hooks exactly these two points; no content path
  goes around it. (This is the M7 dependency.)
- **INV-6 — The feedback channel never lies and never hangs.** Every `cello_send` returns a
  terminal verdict within a deadline. A timeout is a verdict (block + reason), not a hang. The
  LLM always learns what happened to its message and why.
- **INV-7 — Error discipline.** Distinct code per failure cause; real error text, never
  `[object Object]`; an actionable `guidance` field on every failure the agent sees; injected
  logger, no `console.log`; `domain.noun.verb` events.
- **INV-8 — Sovereign nodes (Phase 2).** The directory `security_attestations` table is
  hash-chained, RLS-enforced, region/provider-independent. No shared-state assumption.

---

## Phase 1 — local. The launchable version.

The gateway runs on the user's machine next to the daemon. All detection and the
block/redact/warn handling run locally. Config and records are local. Ends at **Gate 1**.

| Story | What it builds | Done when | Replaces |
|---|---|---|---|
| **M9-CORE-001** | Gateway program skeleton + the `SecurityGatewayClient` interface + the daemon seam (`screenInbound` at `ingestReceivedContent`, `screenOutbound` at `cello_send`). Local sidecar mode. | A message round-trips through the gateway and back, with a no-op pass, across the real daemon↔gateway boundary. | new |
| **M9-IN-001** | Inbound Layer 1 — deterministic sanitization: invisible-character strip, RE2 patterns, entropy scoring, encoded-payload decode, special-token strip, size/length cap. | Each check fires on a crafted input and the sanitized text + notes reach the agent via `cello_receive`. | SCAN-001 |
| **M9-IN-002** | Inbound Layer 2 — DeBERTa injection scanner (pre-downloaded INT8, in-process). | A known injection is scored and blocked; a clean message passes; no network call. | SCAN-002 |
| **M9-IN-003** | Inbound language allowlist (English default) via a small n-gram detector; confident-only, allow on short/low-confidence; flagged message held with a legible note. | A confident non-English message is held with guidance; "ok thanks" is not. | new |
| **M9-OUT-001** | Outbound secret detection + redaction: the full gitleaks dictionary + the generic-entropy catch-all. Redact-by-default. | Each secret type is redacted; a novel high-entropy key is caught; the LLM is told what was redacted. | SCAN-003 / REDACT-001 (part) |
| **M9-OUT-002** | Outbound PII: the whitelist (pre-seeded from registered identity) + the warn flow. Individual PII passes; bulk is a high-severity warning. | Whitelisted value passes silently; a non-whitelisted email warns; a contact dump warns once. | REDACT-001 (part) |
| **M9-OUT-003** | Outbound exfiltration checks: invisible-character egress strip, encoded-payload check, zero-click image-exfil pattern, injection-artifacts-in-output → block. | Each fires correctly; ordinary links pass; an injection artifact in output blocks the message. | SCAN-003 (part) |
| **M9-OUT-004** | Outbound message rate-limiting, keyed on agent identity. | Over-rate sends are throttled with a distinct reason + guidance. | new |
| **M9-FEED-001** | The governance feedback channel: the four dispositions (observe / redact / block / warn), blocking `cello_send`, the never-hang guarantee (per-stage + total deadline below the host timeout, timeout-is-a-verdict, fail-closed + circuit breaker), the publish channel, and the stateless re-send flow with `governance_decisions` (redact / allow_once / allow_always, gated by `autonomous_override`). | All four dispositions return correct terminal results; a warn round-trips via re-send; a forced timeout returns a block-verdict, never hangs. | new (the §6 design) |
| **M9-CFG-001** | Config storage: the gateway's own local SQLCipher DB, versioned (append-only rows), with tighten-free / loosen-needs-confirmation. Portal/CLI/file-import front-ends. | A setting change is versioned and attested-ready; loosening a guard requires confirmation; tightening is free. | new |
| **M9-REC-001** | Local security-pass records: the gateway records what it did to each message (clean / redacted / blocked / warned), and computes a fingerprint of each record. (The cheap half of #5; sending to the directory is Phase 2.) | Every message produces a record with a fingerprint; clean passes are recorded too. | REDACT-004 (part) |
| **M9-GATE-1** | **End-to-end gate, one machine.** Send a message → screened → secret redacted / injection blocked / warning handled → LLM gets the right answer. A message comes in → screened. | The whole loop is green against the real daemon + gateway on one machine. No directory attestation. | new |

> 🔴 **STATUS CORRECTION (2026-07-09) — CFG-001 and REC-001 did NOT ship the storage they specify.**
> The row above says "the gateway's own local **SQLCipher** DB", and CFG-001's behavior clause says "its own
> SQLCipher database (a separate file and key from the daemon's)". The shipped code is
> `new DatabaseSync(dbPath)` — plaintext `node:sqlite`, no cipher key (`core/gateway/src/config/config-store.ts`,
> `core/gateway/src/records/record-store.ts`). REC-001 inherits it by storing into "CFG-001's DB or a sibling".
> Both files justify plaintext with a comment claiming the daemon does the same; that stopped being true on
> 2026-06-25. **Do not treat these two as done on the storage clause.**
>
> The remediation is tracked OUTSIDE M9 — as `DOD-CRYPTO-AT-REST-1` in
> [[M8C-DEFINITION-OF-DONE]] — because it is local data-custody (the daemon's SQLCipher domain), not the
> screening layer M9 owns. This note exists only so nobody closes CFG-001/REC-001 believing the store is
> encrypted. It is not.

**Retired (cut in the prune — do not build):**
- **REDACT-002** (Layer 5, LLM-call governor) — out; that governs the agent's own LLM use, upstream of `cello_send`.
- **REDACT-003** (Layer 6, deny-all filesystem/URL) — out; upstream tool/sandbox concern.
- The moderation parts of SCAN-003 (toxicity / topic / ToS content judgment) — moved to Day 2 (LLM).

---

## Phase 2 — non-local. Add later, when a customer needs it.

Two separable pieces, each ending at **Gate 2**.

| Story | What it builds | Done when |
|---|---|---|
| **M9-REMOTE-001** | Run the gateway as a standalone service; the daemon reaches it over mTLS; config lives with the remote gateway. (The interface from M9-CORE-001 makes this a new implementation, not a rewrite.) | A daemon on one machine is screened by a gateway on another, over mTLS. |
| **M9-ATTEST-001** | #5 — tamper-proof records: the gateway sends record fingerprints to the directory. New directory `security_attestations` table (the first new Flyway migration since M5; bump `OpsAgentExpectedMigrationVersion`), the gateway-writes-directly path, and the check job that detects tamper / deletion / suppression / gaps. | A record's fingerprint is on the directory; a tampered or deleted local record is caught by the check. |
| **M9-GATE-2** | **End-to-end gate, non-local.** The gateway runs on a separate machine, the daemon connects over mTLS, a message is screened remotely, and a record is attested to the directory and verified. | The whole non-local loop is green. |

---

## Day 2 — named and parked (not silently dropped)

Built only when needed. Each has a home:
- **Hook engine** — operator-supplied checks at defined positions, HMAC auth, the observe/gate/redact capabilities, redact-no-inject enforcement. This is the seam an operator points a policy-LLM or a third-party scanner at. (V3 hook design.)
- **Moderation** — toxicity / topic / content-policy. LLM-judgment only; via the hook engine or upstream in the agent. Never first-party CELLO logic.
- **Override policy engine** — CASL deterministic rules for when `allow_once`/`allow_always` are permitted, plus an isolated LLM judge for the residual. (M9-CAPABILITY-HARVEST §6 Future.)
- **Expanded PII set** (full Presidio ~95 + country IDs), **financial redaction**, **output-volume cap**, **canary tokens** (opt-in; operator must place the canary in their own system prompt).
- **SIEM streaming** (provider integrations; the event shape is streaming-ready from Phase 1).
- **Honey tokens** (own story), **enterprise M-of-N approval**, **`transform` hook capability**, **`context_depth` for hooks**.

---

## The bottom line

- **Phase 1 = launch.** Build M9-CORE-001 through M9-GATE-1. That is the whole security layer
  running locally: detection, the warn/redact/block feedback channel, local config, local records.
- **Phase 2 = company + tamper-proof.** M9-REMOTE-001 and M9-ATTEST-001, then M9-GATE-2. Small,
  and addable later without rework, because Phase 1 builds the interfaces.
- **Blocked on:** MSG-001-3b increment 3 (M7) for the live inbound screening. Skeleton and design
  can start now.
- Until #5 (M9-ATTEST-001) is built, do not market the product as "tamper-proof" — that claim
  only becomes true once records are attested to the directory.

---

## Related Documents

- [[M8C-DEFINITION-OF-DONE]] — DOD-M9INT-1 is the committed home for the m9-build merge + seam
  wiring (Tier 0 of M8C); the semantic gate re-runs this DoD's gate against the merged daemon
- [[2026-06-21_1600_m9-content-channel-seam-and-entry-plan|M9 Content-Channel Seam and Entry Plan]] — the daemon attachment point the merge wires
