---
name: M9 Security & Governance Gateway — Milestone Write-up
type: milestone-writeup
date: 2026-06-23
milestone: M9
status: phase-1-launch-complete
topics: [security, gateway, governance, injection, pii, secrets, config, records, milestone]
description: >
  What M9 (the security and governance gateway) delivered: Phase-1 is launch-complete — 11 of 12
  stories gate-green through the real spawned gateway process, with the DeBERTa semantic scanner
  (IN-002 part 2) deferred by decision until the model + runtime infra are ready, and Phase-2
  (remote gateway + directory attestation) a named future phase. Living document; append as the
  deferred and Phase-2 work lands.
---

# M9 — Security & Governance Gateway

## What M9 is

M9 is CELLO's security and governance layer: a **separate program** (`@cello-protocol/gateway`) that
screens every message a node sends and receives. The daemon holds only a thin two-method interface
(`SecurityGatewayClient`) and two call sites — `screenOutbound` at `cello_send`, `screenInbound` at
`ingestReceivedContent`. All detection lives in the gateway, so the company (split) deployment — where
an employee controls the daemon but not the gateway — is an add, not a rewrite.

M9 is built in **two phases** (M9-CAPABILITY-HARVEST §9):

- **Phase 1 — local.** The gateway runs on the operator's machine next to the daemon. All detection,
  the block/redact/warn governance channel, config, and records run locally. **This is the launchable
  version, and it is complete** (one deferred sub-story; see below).
- **Phase 2 — non-local.** Run the gateway as a standalone service reached over mTLS, and attest record
  fingerprints to the directory for cross-node tamper detection. Deliberately deferred — "add later,
  when a customer needs it." Not built.

## Status at a glance

| | Story | State |
|---|---|---|
| ✅ | **M9-CORE-001** | gateway skeleton + the `SecurityGatewayClient` seam (the two daemon call sites) |
| ✅ | **M9-IN-001** | inbound Layer 1 — deterministic sanitize (invisible-char strip, RE2 Step-9 injection patterns, entropy, encoded-payload decode, special-token strip, size cap) |
| 🟡½ | **M9-IN-002** | inbound Layer 2 — DeBERTa semantic scanner. Part 1 done; **part 2 (the model + runtime glue) DEFERRED by decision** |
| ✅ | **M9-IN-003** | inbound language allowlist (English default; confident non-English held) |
| ✅ | **M9-OUT-001** | outbound secrets — the full 222-rule gitleaks dictionary + generic-entropy catch-all, typed `[REDACTED:rule]` placeholders |
| ✅ | **M9-OUT-002** | outbound PII — whitelist (silent pass) + warn; a contact dump warns once |
| ✅ | **M9-OUT-003** | outbound exfiltration — invisible-char egress strip, encoded-payload check, image-exfil neutralize, injection-artifact-in-output → block |
| ✅ | **M9-OUT-004** | outbound per-agent rate limiting (distinct `rate_limited` reason + guidance) |
| ✅ | **M9-FEED-001** | the governance feedback channel — four `cello_send` outcomes, never-hang, and the stateless `governance_decisions` re-send (SI-002) |
| ✅ | **M9-CFG-001** | the gateway's own versioned config store — append-only, hash-chained, tighten-free / loosen-confirmed |
| ✅ | **M9-REC-001** | local security-pass records — every screened message recorded, hash-chained, tamper-evident |
| ✅ | **M9-GATE-1** | the Phase-1 end-to-end gate (one machine) |

**Phase-1: 11/12 gate-green; the 12th deferred by decision → Phase-1 is launch-complete.**

Verification baseline at write-up: gateway and daemon test suites green (**gateway 131 + daemon 395**,
confirmed at write-up time), lint + typecheck clean across gateway, daemon, and adapter.
Every ✅ above was ruled **EARNED** by an independent `cello-done-auditor` running the suites cold —
not on a maker's say-so.

---

## What was delivered

### Inbound screening
- **Deterministic (live):** Layer 1 sanitizes every inbound message — strips invisible/smuggled Unicode,
  normalizes confusable lookalikes, scans for known injection patterns on a **ReDoS-safe RE2 engine**
  (native `re2` preferred, `re2-wasm` fallback), scores entropy, decodes encoded payloads for *detection*
  (never for delivery — a review fix), strips chat-template special tokens, and caps size. IN-003 holds a
  confidently non-English message with a legible note; "ok thanks" is not held.
- **Semantic (part 1 + the seam):** the score→verdict logic (≥70 block / ≥35 flag / <70 deliver, the
  score governing over any model label), the consent-gated model installer (size-verified, no-bundle),
  and a **pluggable `InjectionClassifier` seam** wired live. With no model loaded, Layer-2 is simply off
  and Layer-1 still runs — the gateway degrades gracefully, never fails closed on a missing optional model.
- **Single inbound funnel (INV-5):** direct arrivals, recovered/parked content, and held-then-released
  out-of-order content all pass the same `ingestReceivedContent` screen. Proven by a real spawned gateway
  driving the daemon's own recover-loop call (GATE-1).
- **Terminal vs transient blocks:** a detector rejecting the content (non-English / injection / oversized)
  is *terminal* — the daemon records a leaf binding the original content hash and acks (the sender stops),
  but never delivers it. A fail-closed block from an unreachable gateway is *transient* — no leaf, no ack,
  the sender redelivers when the gateway recovers.

### Outbound screening
- **Secrets (OUT-001):** the complete 222-detector gitleaks dictionary on RE2, a keyword pre-filter, a
  value-level false-positive layer (stopwords / allow-regexes / per-rule entropy), typed
  `[REDACTED:<rule>]` placeholders, and a generic keyword-proximity + entropy catch-all for un-enumerated
  formats. The credential is redacted before anything leaves; the peer gets the placeholder.
- **PII (OUT-002):** a whitelist pre-seedable from the operator's registered identity (own contact passes
  silently); non-whitelisted PII warns; a bulk dump is one high-severity warn.
- **Exfiltration (OUT-003):** invisible-char egress strip, encoded-payload check, zero-click image-exfil
  neutralization, and an injection-artifact-in-output → hard block.
- **Rate limiting (OUT-004):** per-agent identity, distinct `rate_limited` reason + actionable guidance.

### The governance feedback channel (FEED-001)
The LLM always learns what happened to its message and why, synchronously, within a deadline — a timeout
is a verdict, not a hang (INV-6). The four `cello_send` outcomes: clean → sent; redact → sent in altered
form (the leaf binds the sent bytes); warn → not sent, with flags; block → not sent, with named causes.
The **stateless re-send**: the agent re-calls `cello_send` with the same content plus a
`governance_decisions` map (`{flagId: redact | allow_once | allow_always}`). flagIds are derived from
(category, value), so a decision applies only to the exact value it was computed for. `allow_once` /
`allow_always` are honored **only when the gateway's `autonomous_override` is on** — the agent's only
autonomous lever is `redact`; it can never self-authorize sending flagged PII (SI-002). A rejected
decision re-warns the whole send — nothing goes out half-decided.

### The gateway's own state (INV-4)
- **Config (CFG-001):** a versioned, append-only, hash-chained store in the gateway's own DB file
  (node:sqlite). The §7 governance asymmetry is the security core — **tightening a guard is free;
  loosening one (enable autonomous override, add a whitelist value, raise/remove the rate cap, allow
  another language) requires explicit confirmation.** Each setting defaults to its tightest value, so an
  empty config never silently loosens. The live gateway reads the store as source-of-truth.
- **Records (REC-001):** the gateway records what it did to every message — clean / redacted / blocked /
  warned, inbound and outbound — hash-chained for tamper-evidence. A clean pass is recorded too: an absent
  record for a delivered message is itself evidence of suppression. The fingerprint computed here is
  exactly what Phase-2 attests to the directory.

---

## Bugs found and fixed

Every story went through `feature-dev:code-reviewer` + `cello-test-attacker`, and every status flip
through `cello-done-auditor`. Across the milestone that surfaced real security holes — found and fixed
before any flip. The notable ones:

**Terminal-block Merkle ordering (code-review HIGH).**
- *Symptom:* a terminal-blocked inbound message could diverge the two parties' Merkle roots.
- *Root cause:* the first cut appended the tamper-evidence leaf in *arrival* order, bypassing the
  DOD-MSG-4 strict-in-order gate — so a terminal block arriving out of canonical order landed at the wrong
  index, diverging the roots by *position* (not just count) and failing the bilateral seal cross-check.
- *Fix:* route the terminal block through the same held/ordering machinery as a delivered message — held
  at its canonical index when out of order, leafed when the gap fills — but leaf *without* buffering for
  the agent (a `screenedOut` marker).
- *Rule:* a leaf added for chain parity must obey the canonical sequence, not arrival order; "ordering is
  moot for the agent" does not mean "moot for the chain."

**Outbound fail-OPEN on a redact without content (code-review MEDIUM).**
- *Symptom:* a `redact` verdict that arrived without the redacted bytes would send the *original* draft.
- *Root cause:* the daemon's `modified` flag fell back to the original on `content === undefined`.
- *Fix:* treat redact-without-content as a fail-closed block (`redact_without_content`), guarded by a
  fault-injection seam test.
- *Rule:* every branch on the send path defaults to the closed side; the one place that didn't was the one
  that leaked the pre-redaction content.

**The §7 config gate was open at its edges (code-review B1/H1/H2).**
- *Symptom:* the config store shipped empty, so its edge cases were the common path — and they leaked.
- *Root causes + fixes:* (B1) the *first* set of any key was free, so first-enabling `autonomous_override`
  or seeding a whitelist bypassed the loosen gate entirely → fixed with a per-key tightest baseline that
  the first set is classified against. (H1) the tamper hash excluded `confirmed` and `direction` — the
  governance payload — so a forged "unconfirmed → confirmed" loosen still verified → both now bound in the
  fingerprint. (H2) `rate_window_ms` was always neutral, so shrinking the window loosened the rate for
  free → a shorter window is now a loosen.
- *Rule:* a security gate's *default/empty* state is its most-exercised state; classify against the
  intended baseline, and bind every governance-relevant field into the tamper-evidence hash.

**Records lost their flow id and their error-path audit (code-review HIGH/MEDIUM).**
- *Symptom:* every production record stored an empty `correlationId`; a screener fault produced a blocked
  message with no audit record.
- *Root causes + fixes:* the bin's record helper never read `req.correlationId` → threaded it through and
  live-asserted it. A screener throw escaped to the server's outer catch, outside the record store's scope
  → the bin now catches the fault, records the `screen_error` block (best-effort, never silently swallowed),
  and returns it.
- *Rule:* the audit trail must bind the flow id and must cover the error path, or a Phase-2 attestation
  signs over an incomplete record.

**Hollow tests (cello-test-attacker, every one fixed).** The attacker repeatedly found tests that asserted
only the happy path — a hash chain proven only on an intact log (a `verifyChain(){return true}` would pass),
an all-or-nothing rule never tested for a mixed re-send, "no rate slot on a warn" unasserted, the ack half
of terminal-vs-transient unproven, inbound recording with no live producer test. Each was closed with a
test that actually exercises the adversarial condition (raw-DB tampering on every bound field, a
mixed-rejection leak case, a real rate-limit, the ack event, a both-gateways inbound proof).

Earlier in the milestone, three more were fixed the same way: a dedup→append concurrency window reopened by
the `await screenInbound` (closed with a post-await re-check), an inbound decoder that *delivered* decoded
text and corrupted legitimate URLs (decode made detection-only), and a rate limiter that consumed slots for
not-sent messages (peek vs record).

---

## What this unblocks

- **Launch.** Phase-1 is the whole security layer running locally — deterministic inbound screening, full
  outbound screening, the warn/redact/block governance channel, local config, and local tamper-evident
  records. The product can launch on it today.
- **Phase 2 without rework.** Because Phase-1 built the interfaces (the `SecurityGatewayClient` seam, the
  config/record stores, the record fingerprint), the remote (company) gateway and directory attestation
  are adds, not rewrites.

---

## Deferred and future (named, not dropped)

**Deferred by decision — M9-IN-002 part 2 (the DeBERTa semantic scanner).** Andre's call (2026-06-23):
download the 568 MB model and line up the transformers.js runtime infra first, then build part 2 *with*
that infra rather than blind. What remains is the concrete classifier (transformers.js over the local
ONNX) + the gated real-inference test (AC-001/002/SI-001). What exists: the scanner verdict logic, the
consent-gated installer, and the pluggable seam wired live (absent model → Layer-2 off, graceful). Open
sub-decision at build time: the runtime install mechanism — lean opt-in/lazy to keep the client small,
matching the model-not-bundled call. **Append this section's outcome here when it lands.**

**Phase 2 — non-local (not built; add when a customer needs it).**
- **M9-REMOTE-001** — run the gateway as a standalone service the daemon reaches over mTLS.
- **M9-ATTEST-001** — tamper-proof records: the gateway sends record fingerprints to the directory. A new
  directory `security_attestations` table (the first new Flyway migration since M5; bump
  `OpsAgentExpectedMigrationVersion`), the gateway-writes-directly path, and the check job that detects
  tamper / deletion / suppression / gaps. Until this ships, do not market the product as "tamper-proof" —
  that claim only becomes true once records are attested to the directory.
- **M9-GATE-2** — the non-local end-to-end gate.

**Day-2 — named and parked** (each with a home in the DoD): the hook engine (the seam an operator points a
policy-LLM or third-party scanner at), moderation (LLM-judgment only, via the hook engine — never
first-party CELLO logic), the override policy engine, expanded PII (full Presidio + country IDs),
financial redaction, output-volume cap, canary/honey tokens, SIEM streaming, and enterprise M-of-N approval.

---

## Invariants held

INV-1 no-LLM base (the only model is the local DeBERTa scanner, no network call) · INV-2 not a moderation
tool (identity / injection / exfiltration only) · INV-4 the gateway owns its config + records, never the
daemon · INV-5 the single inbound funnel · INV-6 the feedback channel never lies and never hangs · INV-7
error discipline (named events, actionable guidance, injected logger) · INV-8 sovereign nodes (Phase-2
attestation is hash-chained, RLS, region/provider-independent). INV-3/INV-8's Phase-2 portions land with
Phase 2.
