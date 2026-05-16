---
name: M9 Overview — Security Scanning, Redaction, Governance
type: design
date: 2026-05-16
topics: [security-architecture, prompt-injection, scanning, redaction, layer-1, layer-2, layer-3, layer-4, layer-5, layer-6, audit-logging, continuous-verification]
status: active
description: Implementation scope, story structure, known gaps, and rewrite guidance for the M9 security milestone covering CELLO's six-layer prompt injection defense.
---

# M9 Overview — Security Scanning, Redaction, and Governance

M9 implements CELLO's six-layer prompt injection defense as running code in the `client` package. When M9 is complete, every message processed by a CELLO client passes through a deterministic sanitization pipeline, an LLM-based scanner, an outbound gate, a redaction pipeline, an LLM call governor, and deny-all access control — with every blocking decision logged to an append-only audit record and a nightly verification job watching for configuration drift.

**Before implementing any story in this milestone, read:**
- `docs/planning/prompt-injection-defense-layers-v2.md` — the canonical six-layer spec; stories are implementations of sections in that document
- `docs/planning/discussion_logs/2026-04-11_1400_security-architecture-layers-and-trust-signal-classes.md` — the four-layer system model and why each layer exists
- `docs/planning/discussion_logs/2026-05-16_1130_security-layer-improvements-from-production-reference.md` — six gaps identified after the stories were written; stories need to be updated before implementation

---

## Layer-to-Story Map

| Layer | What it does | Story |
|---|---|---|
| Layer 1 | 11-step deterministic sanitization (no API calls) | CELLO-SCAN-001 |
| Layer 2 | LLM-based injection scanner (DeBERTa local; custom endpoint P1) | CELLO-SCAN-002 |
| Layer 3 | Outbound gate — secrets, artifacts, exfiltration, ToS self-check | CELLO-SCAN-003 |
| Layer 4 | Redaction pipeline — secrets then PII, in order | CELLO-REDACT-001 |
| Layer 5 | LLM call governor — spend, volume, lifetime, dedup | CELLO-REDACT-002 |
| Layer 6 | Deny-all filesystem + DNS rebind-safe URL validation | CELLO-REDACT-003 |
| Audit & verification | Append-only logging + nightly checksum/drift verification | CELLO-REDACT-004 |
| Continuous monitoring | Agent-scheduled audit script, independent of agent state | CELLO-MONITOR-001 |

---

## Story Naming Problems

The current story naming has drifted from the layer structure. **Before implementation, stories should be renamed:**

- **CELLO-REDACT-002** is Layer 5 (call governance) — not redaction. Rename to `CELLO-GOV-001`.
- **CELLO-REDACT-003** is Layer 6 (access control) — not redaction. Rename to `CELLO-ACCESS-001`.
- **CELLO-REDACT-004** is audit logging and continuous verification — not redaction. Rename to `CELLO-AUDIT-001`.
- **CELLO-MONITOR-001** overlaps significantly with CELLO-REDACT-004's continuous verification section. The two stories should be reconciled: CELLO-AUDIT-001 specifies what the nightly job checks; CELLO-MONITOR-001 specifies how the agent schedules it. This separation is defensible but the overlap in AC should be cleaned up.

**Also:** All stories reference the attack corpus at `docs/planning/user-stories/m4/attack-corpus-reference.md`. The file lives at `docs/planning/user-stories/m9/attack-corpus-reference.md`. Every story references the wrong path.

---

## Gaps Identified After Stories Were Written

Six gaps were found by comparing the M9 stories against production security implementations. These gaps need to be incorporated into the stories before implementation. The full analysis is in:

`docs/planning/discussion_logs/2026-05-16_1130_security-layer-improvements-from-production-reference.md`

### Gap 1: ReDoS attack class not closed in CELLO-SCAN-001 (Layer 1)

Layer 1 Step 9 pattern matching uses regex on attacker-controlled text. The current stories and design do not specify the regex engine. Node's built-in `RegExp` is vulnerable to ReDoS — a crafted payload can make pattern matching take seconds per message.

**Required change:** Add a security invariant to CELLO-SCAN-001: all regex used in the sanitization pipeline shall use RE2 (the `re2` npm package), not native `RegExp`. RE2 guarantees linear-time execution regardless of input.

### Gap 2: Step 8 misses encoded payload class in CELLO-SCAN-001 (Layer 1)

Step 8's character-frequency baseline detects gross anomalies (80% punctuation) but misses high-entropy blobs (base64 encoded payloads have a normal-looking character distribution but very high Shannon entropy).

**Required change:** Add Shannon entropy scoring as a supplementary check in Step 8's behavior. If entropy exceeds the configured threshold for the source type, increment the suspicion score. No API call, no model inference — it is a deterministic calculation over the text.

### Gap 3: Three PII types missing from CELLO-REDACT-001 (Layer 4)

The current redaction pipeline covers: personal email, phone numbers, dollar amounts. Missing: SSN, credit card numbers, and IP addresses.

**The IP gap is the most important.** CELLO's own Layer 6 design lists "internal file paths and network topology" as protected assets. If an agent leaks an internal IP address in outbound content, that narrows future attack surface. The redaction layer should catch this before it leaves the system.

**Required change:** Extend CELLO-REDACT-001 (will be renamed CELLO-GOV-001... correction: extend CELLO-REDACT-001 as written) to add SSN (`[REDACTED_SSN]`), credit card (`[REDACTED_CREDIT_CARD]`), and IP address (`[REDACTED_IP]`) to the PII redaction module. Add three new acceptance criteria.

### Gap 4: Honey tokens — new deception primitive, no story exists

CELLO has no active deception capability. A honey token layer would generate fake-but-structurally-valid credentials, embed them in agent context or conversation records, and detect their use via external service alerts (e.g., AWS CloudTrail for IAM-format decoys). This turns a successful exfiltration into an automatic detection event.

**Not an M9 item.** This needs a design session before a story can be written. Flag for a separate milestone or as a Domain 5/6 extension. The gap should be tracked so it does not disappear.

### Gap 5: Policy change approval gate — no story exists

If an attacker compromises an agent, their first move is to lower the connection policy. The current design has no gate on policy mutation: changes take effect immediately. An approval gate requiring WebAuthn or CELLO Operations Agent phone confirmation before policy changes take effect would close this window.

**Not an M9 item.** This is a protocol-level decision in Domains 3 (Connections) and 6 (Compromise & Recovery). It extends the "Not Me" WebAuthn/2FA pattern already designed for K_server revocation. Needs a story in those domains.

### Gap 6: Audit log streaming is aspirational, not concrete in CELLO-REDACT-004

CELLO-REDACT-004 (to be renamed CELLO-AUDIT-001) says logs go to "an append-only destination." For single-operator deployments this is a local file. For multi-operator or compliance deployments, logs need to reach a SIEM. The story does not specify how — or how the streaming credentials are secured.

**Required change:** Add a production log destination section to CELLO-REDACT-004: (1) local append-only file as default, (2) external streaming target for operator deployments, with streaming credentials KMS-wrapped at rest and decrypted only at stream time. This does not need SIEM-specific integrations at M9 — it needs the architectural pattern to be specified.

---

## Dependency Order

Layer sequencing is an architectural invariant, not a preference: 1 → 2 → 3 → 4 → 5 (wraps all LLM calls including Layer 2 scanner) → 6. **Layer 5 must be implemented before Layer 2** because Layer 5 wraps every LLM call system-wide, including the scanner.

Implementation order: CELLO-SCAN-001 → CELLO-REDACT-002 (Layer 5 governor) → CELLO-SCAN-002 (Layer 2 scanner) → CELLO-SCAN-003 (Layer 3 gate) → CELLO-REDACT-001 (Layer 4 redaction) → CELLO-REDACT-003 (Layer 6 access) → CELLO-REDACT-004 (audit/verification) → CELLO-MONITOR-001 (scheduling).

The governor must exist before the scanner so that the scanner's LLM calls are governed from the start.

---

## What E2E Looks Like When M9 Is Done

A message arrives at the CELLO client from an external source:
1. **Layer 1 (CELLO-SCAN-001)**: 11-step deterministic pipeline runs. Invisible Unicode stripped, wallet-drain checked, lookalikes normalized, encoded payloads decoded, injection patterns matched. Any step throws → block. All steps complete → sanitized text + detection stats.
2. **Layer 2 (CELLO-SCAN-002)**: DeBERTa scanner classifies the sanitized text. Score + verdict returned. Score overrides verdict if contradictory. Score ≥ 70 → block. Score ≥ 35 → review flag. Score < 35 → pass.
3. Message reaches the agent's LLM with scan_result embedded.
4. Agent produces outbound response.
5. **Layer 5 (CELLO-REDACT-002)**: Outbound passes through the call governor (already wrapped every LLM call).
6. **Layer 3 (CELLO-SCAN-003)**: Outbound dispatcher checks secrets, injection artifacts, exfiltration patterns, financial data, ToS self-check. Any check fires → block.
7. **Layer 4 (CELLO-REDACT-001)**: Secret redaction → PII redaction → delivery.
8. Every blocking decision written to audit log (CELLO-REDACT-004). Nightly job verifies no drift.

Throughout: **Layer 6 (CELLO-REDACT-003)** silently denies any filesystem or URL access outside the allow-list, independently of the message flow.

---

## Related Documents

- [[prompt-injection-defense-layers-v2|Prompt Injection Defense Architecture]] — canonical six-layer spec; all M9 stories implement sections of this document
- [[2026-04-11_1400_security-architecture-layers-and-trust-signal-classes|Security Architecture Layers and Trust Signal Classes]] — why each layer exists; the four-layer security model that contains the six-layer prompt injection defense
- [[2026-05-16_1130_security-layer-improvements-from-production-reference|Security Layer Improvements from Production Reference Analysis]] — six gaps to address before implementing M9 stories
- `attack-corpus-reference.md` — (same directory) the attack technique catalog stories reference; read before writing tests
