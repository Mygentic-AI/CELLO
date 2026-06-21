---
name: M9 Definition of Done
type: definition-of-done
date: 2026-06-21
milestone: M9
status: open
description: >
  The single consolidated "what M9 done actually means" checklist. Assembled from the
  V3 canonical gateway design, the M9 overview + eight story YAMLs (SCAN-001/002/003,
  REDACT-001..004, MONITOR-001), the production-reference gap analysis, and the
  M9-content-channel-seam entry plan. Every requirement is pulled here into one ordered
  list, mapped to a live test journey (J-SCREEN → J-ATTEST) the test must drive against
  the real shipped binaries (cello-gateway + cello-daemon + directory + relay). This
  document is the YARDSTICK; the live binary test is the ENFORCER. Status tags are the
  current honest ground truth, not aspirations.
---

# M9 — Definition of Done

## How to use this

- This document is the **target**: the six-layer pipeline run as a separate gateway
  process, hooked into the daemon's content channel, with a directory-attested hash chain.
- The **live binary test** is what proves each line. A DoD line is "done" only when its
  journey is green against the real `cello-gateway` / `cello-daemon` / directory / relay
  binaries — not when a unit test against an internal function passes. M7 proved this:
  vitest-green ≠ done.
- **Canonical design:** `discussion_logs/2026-05-28_1000_security-layer-v3-extensibility-and-split-gateway.md` (gateway internals) + `discussion_logs/2026-06-21_1600_m9-content-channel-seam-and-entry-plan.md` (the daemon seam + dependency gate).

## Status legend

- ✅ **PROVEN LIVE** — journey green against the real binaries; reviewed.
- 🟡 **BUILT / UNVERIFIED-LIVE** — code exists but never run live multi-process.
- 🟠 **PARTIAL** — one half built, the other missing.
- ❌ **NOT BUILT** — greenfield; only a story YAML, or nothing.
- ⬜ **NOT STORIED** — designed, no story written yet.
- 🔒 **BLOCKED** — gated on a named dependency (M7 content path / M8 portal).

> Everything below is ❌/🔒 today. M9 has not started building. The seam, gate, and
> journey decomposition are settled (entry plan); the gateway repo does not yet exist.

---

## Tier 0 — Cross-cutting invariants (must hold in EVERY journey)

- **M9-INV-1 — No-LLM base pipeline.** The six base layers are deterministic; the only
  inference is DeBERTa-v3-small INT8 loaded into gateway memory at startup; no network
  calls in the base pipeline. Hooks are the only exempt extension point. *(V3 "No-LLM
  invariant")* — ❌
- **M9-INV-2 — Split-process attestation integrity.** The gateway writes the
  `SecurityAttestation` to the directory directly; the client NEVER holds that write
  path. A compromised client cannot forge what the gateway attested. *(V3 "Security
  Gateway")* — ❌
- **M9-INV-3 — Unified daemon seam.** All inbound content (direct + recovered park)
  passes `ingestReceivedContent`; all outbound passes `sendContent`. M9 hooks exactly
  these two; no content path bypasses the gateway. *(entry plan; MSG-001-3b LOCKED AC)* —
  🔒 (on MSG-001-3b increment 3)
- **M9-INV-4 — Redact no-inject.** A `redact`-capability hook's output only removes:
  output length ≤ input, no new substring; any violation rejects the response + flags the
  hook + passes original content with a `caution` note. *(V3 "redact enforcement")* — ❌
- **M9-INV-5 — Hooks never receive pre-Layer-1 content.** Layer 1 sanitization is the
  entry ticket for any hook. *(V3 hook payload invariant)* — ❌
- **M9-INV-6 — Hash chain completeness.** Every message — clean or transformed — produces
  one security pass record whose `record_hash` is submitted to the directory; gaps in
  message sequence are detectable. *(V3 "Clean passes are also recorded")* — ❌
- **M9-INV-7 — Error discipline + observability.** Distinct code per failure cause;
  `error.message` never `[object Object]`; actionable `guidance` on every gateway/daemon
  failure surfaced to an agent; injected Logger, no `console.log`; `correlationId` threaded
  (shared with the daemon's send/receive flow id); `domain.noun.verb` events. *(M4+/M7
  rules)* — ❌
- **M9-INV-8 — Sovereign nodes.** The directory `security_attestations` table is
  hash-chained, RLS-enforced, region/provider-independent; no shared-state assumption.
  *(CLAUDE.md sovereign invariant)* — ❌

---

## Tier 1 — Inbound screening spine (J-SCREEN + J-SCAN)

The first journeys: content arriving from a peer is screened before the agent sees it.
Hooks at `after_sanitize` / `after_scan`. Daemon call site: `screenInbound` at
`ingestReceivedContent`.

### Layer 1 — deterministic sanitization (CELLO-SCAN-001)

- **M9-SCAN1-1 — 11-step sanitization runs inbound.** Invisible-Unicode strip, wallet-drain
  check, lookalike normalization, encoded-payload decode, injection-pattern match. Any step
  throws → block; all complete → sanitized text + per-step detection stats. — ❌
- **M9-SCAN1-2 — RE2 engine for pattern matching.** No backtracking regex anywhere in
  Layer 1 (ReDoS-safe); a security invariant of SCAN-001. *(prod-gap Finding 1)* — ❌
- **M9-SCAN1-3 — Entropy scoring (Step 8).** High-entropy segment detection contributes a
  signal. *(prod-gap Finding 2)* — ❌
- **M9-SCAN1-4 — security_context to the agent.** `cello_receive` returns the V3
  `ReceivedEnvelope.security_context` (notes + `transformations_applied`); the sanitized
  form is what the agent sees. — ❌

### Layer 2 — injection scanner (CELLO-SCAN-002)

- **M9-SCAN2-1 — DeBERTa-v3-small INT8, in-process.** Loaded at gateway startup; classifies
  the sanitized text; score + verdict + categories + evidence; no network call during
  inference (INV-1). Score overrides verdict on contradiction (≥70 block, ≥35 review,
  <35 pass). Pre-downloaded model only — no training. *(SCAN-002; [[project_m8_deberta_scope]])* — ❌
- **M9-SCAN2-2 — No custom-endpoint in the base layer.** A different scanner model is an
  `after_sanitize` sync hook, not a base-layer network call (INV-1). *(V3)* — ❌

### The seam (M7 dependency — the load-bearing line)

- **M9-SCREEN-SEAM — Recovered park content is screened identically.** A message parked
  while the recipient was offline, then pulled, passes the SAME inbound chokepoint
  (`ingestReceivedContent`) and the SAME Layer 1/2 screening as a direct message, BEFORE
  `cello_receive` returns it — proven by the recovered message carrying its security_context
  and never arriving as raw ciphertext around the funnel. *(entry plan; MSG-001-3b LOCKED
  AC `bc047c7`)* — 🔒 (on MSG-001-3b increment 3)

---

## Tier 2 — Outbound governance (J-GATE / J-REDACT)

Content the agent is about to send, screened before it leaves. Hooks at `before_gate` /
`after_gate` / `before_deliver`. Daemon call site: `screenOutbound` at `cello_send`,
before `sendContent`. A block ⇒ no send, no leaf, session stays active.

### Layer 3 — outbound gate (CELLO-SCAN-003)

- **M9-GATE-1 — Outbound checks.** Secrets, injection artifacts, exfiltration patterns,
  financial data, ToS self-check (local inference, no API call — INV-1). Any check fires →
  block with distinct code + guidance. — ❌

### Layer 4 — redaction (CELLO-REDACT-001)

- **M9-REDACT-1 — Secret then PII redaction, in order.** Secrets first, then PII; delivery
  proceeds with redacted content; `transformations_applied` reflects the count. — ❌
- **M9-REDACT-2 — PII coverage includes SSN / credit-card / IP.** The three production PII
  types are present, not just the original set. *(prod-gap Finding 3)* — ❌

### Layer 5 — call governor (CELLO-REDACT-002)

- **M9-GOV-1 — LLM call governor.** Spend, volume, lifetime, dedup caps wrap every LLM
  call; over-cap → ABORT with distinct code + guidance. — ❌

### Layer 6 — deny-all access control (CELLO-REDACT-003)

- **M9-DENY-1 — Deny-all filesystem + DNS-rebind-safe URL validation.** Filesystem/URL
  access outside the allow-list is silently denied, independent of message flow. — ❌

---

## Tier 3 — Extensibility (J-HOOK)

### Tier 1 data extensions

- **M9-EXT-1 — Pattern-file + URL extensions.** `layer1-patterns.json`,
  `layer3-secrets.json`, `layer4-pii.json` at known paths; URL sources with TTL; merged at
  startup; additive only (cannot remove/override base patterns). *(V3 Tier 1)* — ❌

### Tier 2 pipeline hooks

- **M9-HOOK-1 — Hook engine: positions + modes.** `after_sanitize` / `after_scan` /
  `before_gate` / `after_gate` / `before_deliver`; multiple hooks per position run in
  declaration order; first `block` stops the chain. `sync` (gates, requires `timeout_ms` +
  `on_timeout`) vs `async` (fire-and-forget, response discarded). *(V3)* — ❌
- **M9-HOOK-2 — Capabilities enforced.** `observe` (async only) / `gate` / `redact`;
  responses exceeding declared capability rejected + logged as policy violation. — ❌
- **M9-HOOK-3 — Redact no-inject enforcement (INV-4).** Gateway diffs transformed_content
  vs input; any new substring → reject + flag + original continues with a `caution` note. — ❌
- **M9-HOOK-4 — HMAC + bearer auth.** HTTPS-only endpoints (HTTP rejected at config load);
  HMAC-SHA256 default (payload integrity), bearer opt-in; secret by reference, not inline. — ❌
- **M9-HOOK-5 — Standard payload + message_only context.** V3 `HookPayload` shape; hooks
  never receive pre-Layer-1 content (INV-5); `message_only` default (`context_depth` is Day 2). — ❌

---

## Tier 4 — Attestation & verification (J-ATTEST)

- **M9-ATTEST-1 — Security pass record in gateway SQLite.** One per message covering all
  layers + hooks that ran; per-stage `content_hash_before/after`; clean passes recorded too
  (INV-6). *(V3 "Security Pass Record")* — ❌
- **M9-ATTEST-2 — record_hash → directory `SecurityAttestation` (NEW migration).** Submitted
  to the directory BEFORE the verdict returns to the client; the gateway writes it directly
  (INV-2). Owns the FIRST new Flyway migration since M5: hash-chained, RLS, sovereign-
  faithful `security_attestations` table + ingest API; `OpsAgentExpectedMigrationVersion`
  bumped; `cello-ssm-parameters.yaml` updated. Cross-repo deploy (~25-30 min). — ❌ (DB/migration story)
- **M9-ATTEST-3 — Diff records.** Separate gateway-SQLite table holding the actual removed
  content (PII/secret/payload); the hash chain proves THAT a transform happened without
  exposing WHAT; access control on diffs is an enterprise decision. — ❌
- **M9-VERIFY-1 — Nightly verification extended (CELLO-REDACT-004).** Compares directory
  attestations vs gateway records; flags tamper (hash mismatch), deletion (directory entry,
  no local record), suppression (local record, no directory entry), and sequence gaps.
  Includes audit-log streaming production spec. *(prod-gap Finding 6)* — ❌
- **M9-MONITOR-1 — Continuous monitoring (CELLO-MONITOR-001).** Agent-scheduled audit
  script independent of agent state. — ❌

---

## Tier 5 — Hook governance & tamper detection (M8-gated)

- **M9-HOOKGOV-1 — Portal notification + WebAuthn on hook change.** Any hook add/modify/
  remove fires `hook.config.changed` + an out-of-band Operations Agent notification; adding/
  modifying a hook requires WebAuthn; portal shows active-hook banner. *(V3 "Hook Tamper
  Detection")* — 🔒 (on M8 portal). The hook ENGINE + audit trail ship in M9 (Tier 3 / below);
  only the portal-surfaced UX is M8-gated.
- **M9-HOOKGOV-2 — Hook config audit trail.** Append-only row semantics in gateway SQLite
  (changes as new rows with `superseded_at`); included in the nightly integrity check. — ❌

---

## Tier 6 — Day 2 (SPEC ONLY — named home, not silent deferral)

Explicitly parked to Day 2 per V3, so M9 carries no silent deferral (RC-1):

- **M9-DAY2-1 — `transform` hook capability** (arbitrary content modification). Needs the
  enterprise governance overlay first. Ship `redact` in M9; open `transform` later. — ⬜
- **M9-DAY2-2 — `context_depth` / `last_n_rounds`** for hooks. Start `message_only`; add
  depth once privacy implications are understood from real usage. — ⬜
- **M9-DAY2-3 — Enterprise governance overlay** (M-of-N hook-change approval, endpoint
  allowlist, per-deployment capability/position limits). Also the standalone "policy change
  approval gate" gap. Spec in V3; code when an enterprise requests it. *(prod-gap Finding 5)* — ⬜
- **M9-DAY2-4 — Honey tokens.** New story needed; not in any current YAML. *(prod-gap
  Finding 4; [[project_m9_security_gaps]])* — ⬜ NOT STORIED

---

## Deployment modes (must all work)

- **Personal (local sidecar):** gateway starts alongside the daemon; `security_gateway:
  local`; same trust domain. Default. — ❌
- **Enterprise (split control):** gateway on IT-controlled infra; client connects over
  mTLS; `security_gateway: https://...`; employee cannot modify the gateway. — ❌
- **Self-hosted:** same as enterprise, personally operated. — ❌

---

## The verification harness (DoD → live test journeys)

Each journey spawns the **real binaries** on localhost (no AWS deploy), reusing the M7
J-SPINE cluster + a gateway sidecar. In build order:

1. **J-SCREEN** → M9-SCAN1-*, M9-SCREEN-SEAM (+ INV-3/5). Inbound Layer 1; recovered park
   content screened identically. *(gated on MSG-001-3b inc. 3)*
2. **J-SCAN** → M9-SCAN2-* (+ INV-1). Inbound Layer 2 DeBERTa INT8, in-process.
3. **J-GATE** → M9-GATE-1. Outbound Layer 3 blocks exfiltration before `sendContent`.
4. **J-REDACT** → M9-REDACT-*, M9-GOV-1, M9-DENY-1. Outbound redaction (SSN/CC/IP),
   governor abort, deny-all.
5. **J-HOOK** → M9-EXT-1, M9-HOOK-* (+ INV-4/5). One sync `gate` + one async `observe`
   hook, HMAC auth, redact no-inject enforcement, pattern-file extension.
6. **J-ATTEST** → M9-ATTEST-*, M9-VERIFY-1, M9-MONITOR-1 (+ INV-2/6). record_hash to the
   directory; nightly job detects tampered/deleted/suppressed/gapped records;
   client-cannot-forge proven.

Every journey's tests keep running in later journeys. The harness only grows.

---

## The bottom line

- M9 has NOT started building — every line is ❌/🔒.
- **Unblocked now:** the gateway repo/package skeleton, the `SecurityGatewayClient`
  adapter + local stub, and the `SecurityAttestation` schema *design*. Start here while
  the seam is gated.
- **Gated:** J-SCREEN's seam line (M9-SCREEN-SEAM / INV-3) on MSG-001-3b increment 3;
  hook-governance UX (M9-HOOKGOV-1) on M8.
- M9 owns the FIRST new directory Flyway migration since M5 (M9-ATTEST-2) — a real
  DB/migration + cross-repo deploy story.

M9 is done when journeys J-SCREEN through J-ATTEST are green against the real binaries,
every Tier-0 invariant holds, all three deployment modes work, and every Tier-6 item is
built or explicitly Day-2-parked (not silently deferred — that is RC-1).
