---
name: Security Layer V3 — Extensibility, Hook Architecture, and Split Gateway
type: discussion
date: 2026-05-28 10:00
topics: [security-architecture, prompt-injection, extensibility, hooks, webhook, gateway, audit, tamper-evidence, governance, enterprise, split-process, hash-chain, redaction, directory-attestation]
status: active
description: Complete V3 redesign of CELLO's security layer. Introduces a separate security gateway package, two-tier extensibility (data extensions and pipeline hooks), a content hash chain backed by directory attestation, hook capability enforcement, and an enterprise split-deployment model. Supersedes prompt-injection-defense-layers-v2.md as the canonical architecture. Day 1 vs Day 2 scope decided.
---

# Security Layer V3 — Extensibility, Hook Architecture, and Split Gateway

This document is the result of a design session on 2026-05-28 that extended the V2 six-layer prompt injection defense into a fully extensible, auditable, and enterprise-deployable architecture. It supersedes [[prompt-injection-defense-layers-v2]] as the canonical design for M9 implementation.

Read [[prompt-injection-defense-layers-v2]] first — the six base layers are unchanged. This document specifies everything that wraps, extends, and governs them.

---

## The Problem V3 Solves

V2 defines a strong six-layer pipeline. It has two structural gaps that neither pattern libraries nor additional layers can close:

**Gap 1 — No extensibility.** Every operator who wants to augment the security layer must modify CELLO client code. Pattern lists are hardcoded. There is no sanctioned way to add a new detection check, integrate a third-party scanner, or wire in a company-specific redaction rule without forking the codebase. A fork diverges from upstream on every update.

**Gap 2 — The attesting process is inside the trust boundary.** The content hash chain (where each pipeline stage records a hash of the content it saw) is only tamper-evident if the process recording the hashes cannot be compromised. On a personal machine where the operator controls everything, this holds. In an enterprise where an employee or a rogue process could modify the CELLO client code, the entity doing the attesting is inside the attacker's reach. The hash chain proves nothing if you can modify what gets hashed.

V3 closes both gaps: extensibility via a defined plugin architecture, and attestation integrity via process separation.

---

## Architectural Change: The Security Gateway

The security pipeline is extracted from the CELLO client into a **separate process and separate repository**: the CELLO Security Gateway.

```
Employee's machine                       Controlled infrastructure
─────────────────────────────            ────────────────────────────────────
CELLO client                             CELLO Security Gateway
  sends message + metadata  ──────────►  runs the six-layer pipeline
  receives verdict + notes  ◄──────────  returns verdict, notes, transformed content
                                         writes record_hash to directory ──► CELLO Directory
```

The client never writes security attestation records to the directory. The gateway writes them directly. This is the load-bearing property: an attacker who controls the client cannot forge what the gateway attested, because the gateway's directory communication bypasses the client entirely.

### The Interface Contract

```typescript
// Client → Gateway
interface SecurityRequest {
  session_id: string
  message_sequence: number
  source_type: SourceType
  peer_pubkey: string
  content: string
  timestamp: string
  context?: {                          // omitted in message_only mode
    rounds: ConversationRound[]
    rounds_available: number
  }
}

// Gateway → Client
interface SecurityResponse {
  verdict: 'allow' | 'block'
  content: string                      // may differ from request content if redacted
  notes: SecurityNote[]
  record_hash: string                  // hash of the full SecurityPassRecord
  // client stores this locally; gateway has already sent it to directory
}

// Gateway → Directory (client never sees this call)
interface SecurityAttestation {
  session_id: string
  message_sequence: number
  record_hash: string
  timestamp: string
  gateway_pubkey: string               // which gateway instance attested this
}
```

### Deployment Modes

**Personal (local):** Gateway runs as a sidecar process on the same machine. Starts automatically alongside the CELLO client. Same trust domain — no stronger integrity guarantee than V2, but the same pipeline runs and all audit infrastructure works. Default for individual users.

**Enterprise (split control):** IT deploys the gateway on infrastructure they control. CELLO client connects to it over mTLS. `security_gateway: https://gateway.yourcompany.com` in client config. The employee cannot access or modify the gateway process. IT controls code, configuration, permitted hooks, and redaction policy.

**Self-hosted (power user):** Individual runs their gateway on a VPS or home server they trust more than their laptop. Same pattern as enterprise, personally operated.

Config entry: `security_gateway: local | https://hostname`. Everything else is identical across modes.

### Why a Separate Repository

Three reasons beyond organizational cleanliness:

1. **Auditability.** An enterprise security team audits the gateway repo independently of the CELLO protocol stack. Clean surface, defined interface.

2. **Independent deployment lifecycle.** Gateway ships updated pattern libraries, new PII types, hook capability changes without requiring a CELLO client update. Enterprises pin gateway versions independently.

3. **The enterprise fork model.** An enterprise that wants proprietary detection logic forks the gateway repo, not the CELLO client. Their fork stays current by rebasing on upstream gateway. Protocol code is never touched.

Product implication: third parties can build and distribute their own gateway implementations. A security vendor can ship "CELLO Security Gateway — Financial Services Edition" with FINRA/SEC-compliant PII patterns, pre-approved SIEM integrations, and a compliance report generator. The interface contract is the moat.

---

## Two-Tier Extensibility

### Tier 1: Data Extensions (Pattern Augmentation)

Operators drop files at known paths. Loaded and merged at gateway startup. No code required.

```
~/.cello/extensions/layer1-patterns.json    — Step 9 injection patterns
~/.cello/extensions/layer3-secrets.json     — Layer 3 secret format patterns
~/.cello/extensions/layer4-pii.json         — Layer 4 PII redaction patterns
```

Files can also be URLs fetched at startup with a configured TTL:

```yaml
extensions:
  layer1_patterns:
    - path: ~/.cello/extensions/layer1-patterns.json
    - url: https://security.yourcompany.com/cello/patterns.json
      ttl_hours: 24
```

Covers: new jailbreak patterns, company-specific secret formats, internal PII types (employee IDs, project codes), industry-specific redaction requirements. Additive only — cannot remove or override base layer patterns.

### Tier 2: Pipeline Hooks

A hook is a declared extension point that fires at a specific position in the pipeline, calls an external endpoint, and can observe, gate, or redact content. Defined in gateway configuration. Operator-managed.

---

## Pipeline Hook Architecture

### Hook Positions

Direction is implied by position. No separate direction field needed — it is determined by where in the pipeline the hook fires.

| Position | Direction | Content available |
|---|---|---|
| `after_sanitize` | inbound | Sanitized text + Layer 1 detection stats |
| `after_scan` | inbound | Above + Layer 2 score, verdict, categories, evidence |
| `before_gate` | outbound | Outbound message text, destination peer |
| `after_gate` | outbound | Above (only fires if Layer 3 allowed it) |
| `before_deliver` | outbound | Final redacted message, about to leave the system |

Multiple hooks at the same position are supported. They run sequentially in declaration order. The first hook to return `block` stops the chain — subsequent hooks at that position do not fire.

### Hook Modes

**`sync`** — blocks the pipeline. The gateway waits for the hook to return before continuing. Requires `timeout_ms` and `on_timeout`. This is a gate.

**`async`** — fire and forget. The gateway sends the payload and continues immediately. Any response is discarded (the hook cannot influence the pipeline). Used for observe/logging integrations. No timeout required.

There is no async-with-results mode. By the time an async result arrives, the pipeline has moved on and the message has been processed. The mode a hook is configured with is permanent — it cannot be negotiated at call time.

### Hook Capabilities

Every hook declares its capability at registration. The gateway enforces it — responses that exceed the declared capability are rejected and logged as a policy violation.

```typescript
type HookCapability =
  | 'observe'      // async only; no verdict, no transformation
  | 'gate'         // can return allow/block + notes; cannot transform content
  | 'redact'       // can transform content, but only by removal
                   // enforced: output length ≤ input length; no new substrings
```

**The `redact` enforcement rule** is load-bearing. The gateway diffs `transformed_content` against the input before accepting it. Any new substring present in the output that was not present in the input causes the response to be rejected, the hook to be flagged as a policy violation, and the original content to continue through the pipeline (with a `caution` note attached). This closes the extract-strip-reinject attack class: a hook declared as `redact` cannot inject content it stripped.

A `transform` capability (arbitrary content modification) is reserved for Day 2, pending completion of the governance overlay design.

### Hook Configuration Schema

```typescript
interface PipelineHook {
  id: string                          // operator-defined label, unique per gateway instance
  position: HookPosition
  mode: 'sync' | 'async'
  capability: HookCapability
  endpoint: string                    // HTTPS only; HTTP rejected at config load

  auth: {
    type: 'hmac_sha256' | 'bearer'
    // hmac_sha256 (recommended): gateway signs payload with shared secret
    //   header: X-CELLO-Signature: sha256=<hex>
    //   same pattern as GitHub, Stripe, Twilio webhooks
    // bearer: Authorization: Bearer <token>
    //   provided for compatibility with services that don't support HMAC
    secret: string                    // reference to Secrets Manager key, not inline value
  }

  // Required if mode = 'sync'. Must be explicit — no default.
  timeout_ms?: number
  on_timeout?: 'fail_open' | 'fail_closed'

  // Context mode — how much history to include in payload
  // Default: message_only. context_depth requires explicit opt-in.
  context_mode: 'message_only' | { last_n_rounds: number }
  // last_n_rounds N: includes 2N messages (N from each side, interleaved by sequence)
  // Group sessions: all participants' messages included in round order
  // The payload includes rounds_available so the hook knows if the window is truncated

  // Payload field control — omit overrides include if both specified
  omit?: PayloadField[]
}
```

**Auth pattern rationale.** HMAC signatures authenticate both the caller identity and the payload integrity — a tampered payload fails signature verification. Bearer tokens authenticate the caller but not the payload. HMAC is the default; bearer is an explicit opt-in for services that don't support HMAC verification.

### Standard Payload Shape

```typescript
interface HookPayload {
  // Always present
  hook_id: string
  session_id: string
  position: HookPosition
  timestamp: string                   // ISO 8601

  // Current message
  message: {
    content: string                   // sanitized; hooks never receive pre-Layer-1 content
    source_type: SourceType
    peer_pubkey: string
  }

  // Pipeline state — only layers that have already run at this position
  pipeline_state: {
    layer1?: {
      passed: boolean
      detection_stats: Record<string, number>   // per-step signal counts
    }
    layer2?: {
      score: number
      verdict: 'allow' | 'review' | 'block'
      categories: string[]
      evidence: string[]
    }
    layer3?: {
      passed: boolean
      checks_fired: string[]
    }
    layer4?: {
      redactions_applied: string[]    // which types fired, not the values
    }
    // prior_hooks: notes accumulated from hooks that ran before this one at earlier positions
    prior_hooks?: SecurityNote[]
  }

  // Context — only present if context_mode != 'message_only'
  context?: {
    rounds: Array<{
      messages: Array<{
        role: 'self' | 'peer' | string    // string form: 'peer:<pubkey>' for group
        content: string
        timestamp: string
        sequence: number
      }>
    }>
    rounds_available: number          // total rounds in DB; hook knows if window is truncated
  }
}
```

**Hooks never receive pre-Layer-1 content.** This is a hard invariant. A hook receiving raw unsanitized input would be exposed to invisible Unicode, wallet-drain characters, and encoded payloads — the same attack class Layer 1 exists to stop. Layer 1 sanitization is the minimum entry ticket for any hook.

### Hook Response Schema

```typescript
// sync hooks only — async hook responses are discarded
interface HookResponse {
  verdict: 'allow' | 'block'

  // Transformed content — only valid with verdict 'allow' and capability 'redact'
  // If present, pipeline continues with this content instead of the input content
  // If capability is 'gate' and transformed_content is present, response is rejected
  transformed_content?: string

  // Advisory notes — travel with the message to the receiving agent
  // On a blocked message, notes go to audit log only
  notes?: Array<{
    severity: 'info' | 'caution' | 'warning'
    message: string
  }>

  // Audit reason — logged only, never forwarded to agent or peer
  reason?: string
}
```

Any response failing schema validation: treated as `block` if `on_timeout: fail_closed`, `allow` if `fail_open`. Logged as a validation failure either way.

### What the Agent Sees

Notes from the pipeline accumulate through all layers and hooks. They arrive at the agent in the `cello_receive` envelope:

```typescript
interface ReceivedEnvelope {
  content: string                     // final content, post all transformations
  sender_pubkey: string
  session_id: string
  sequence: number

  security_context?: {
    notes: Array<{
      severity: 'info' | 'caution' | 'warning'
      message: string
      source: string                  // 'layer1', 'layer3', 'hook:my-hook-id', etc.
    }>
    transformations_applied: number   // how many stages modified the content
    // agent knows content was modified; does not know what was removed
  }
}
```

The agent's system prompt should be instructed to check `security_context.notes` and treat `caution` and `warning` entries with appropriate skepticism. The message still arrives — notes are advisory, not gates. The `transformations_applied` count tells the agent that it is not seeing the original content, without revealing what was redacted.

---

## Content Hash Chain and Directory Attestation

Every message that passes through the gateway produces one **security pass record**. The record covers all layers and hooks that ran. A hash of the record is submitted to the directory immediately after the pipeline completes — before the verdict is returned to the client.

### Security Pass Record (stored in gateway SQLite)

```typescript
interface SecurityPassRecord {
  session_id: string
  message_sequence: number            // ties to the Merkle leaf sequence
  gateway_pubkey: string
  timestamp: string

  pipeline_entries: Array<{
    position: string                  // 'layer1', 'layer2', 'hook:my-hook', etc.
    outcome: 'clean' | 'blocked' | 'transformed' | 'annotated'
    content_hash_before: string       // hash of content entering this stage
    content_hash_after: string        // hash of content leaving (same if no transform)
    diff_hash?: string                // hash of the diff record (only if transformed)
    notes_count: number               // how many notes were added at this stage
  }>

  final_verdict: 'allow' | 'block'
  record_hash: string                 // hash of this entire record; submitted to directory
}
```

### Diff Records (stored in gateway SQLite, separate table)

When a layer or hook transforms content, a diff record is written:

```typescript
interface SecurityDiffRecord {
  session_id: string
  message_sequence: number
  stage: string                       // which layer/hook made the change
  content_hash_before: string
  content_hash_after: string
  diff: string                        // what was removed (redaction) or what changed
  diff_hash: string                   // hash of this record; referenced by pipeline_entry
}
```

**The diff record contains the actual redacted content** — the PII, the secret, the injection payload. This is sensitive. The hash chain proves *that* a transformation happened without exposing *what* was removed. An enterprise auditor can verify integrity using hashes alone. Access to the diff records is an access control decision for the enterprise, not a CELLO protocol decision.

### Clean Passes Are Also Recorded

If a message passes through every layer and hook with no changes, a security pass record is still written with all `clean` outcomes. That record's hash is still submitted to the directory.

This closes a deletion attack: if someone deletes a diff entry from the gateway SQLite, the pipeline_entry that referenced it changes, which changes the record_hash, which no longer matches the directory entry. You cannot hide a transformation by deleting it. You would also need to forge the directory entry — which the client cannot do, because the gateway wrote it directly.

Gaps are also detectable: if message sequence 47 has no security pass record in the directory log, the nightly verification job flags it.

### Directory Record Type

The gateway submits a new record type to the CELLO directory:

```typescript
// Gateway → Directory
interface SecurityAttestation {
  session_id: string
  message_sequence: number
  record_hash: string
  timestamp: string
  gateway_pubkey: string
}
```

This is a directory API change required for M9. The client never writes security attestations — only the gateway does. This is the architectural invariant that makes split-process deployment meaningful.

---

## Automated Verification (Extended)

The nightly verification job already specified in CELLO-AUDIT-001 is extended with security chain verification:

1. Fetch all security attestations from the directory for the last N days
2. Fetch all security pass records from gateway SQLite for the same window
3. For each record: hash the local record, compare to the directory attestation
4. **Mismatch** → tamper detected; alert
5. **Directory entry with no local record** → local record deleted; alert
6. **Local record with no directory entry** → directory write was suppressed; alert
7. **Gap in message sequence** → a message passed through the gateway with no attestation; alert

This runs without human involvement. For enterprises running split-deployment, this verification can be run by IT on-demand, on a schedule, or as part of a compliance audit. The output is a clean/tampered status per message, per session, per time window.

---

## Hook Tamper Detection

Hooks are a privileged configuration — they receive every message passing through the pipeline. Adding an unauthorized hook is an attack surface. Two mechanisms defend it.

### Portal Notification on Hook Changes

Any write to the hooks configuration (add, modify, disable, delete) is a security event:

1. `hook.config.changed` event fires immediately
2. Out-of-band notification sent via Operations Agent (same channel as "Not Me" and key rotation alerts): *"A pipeline hook was [added/modified/removed] on your CELLO agent. Hook: `[hook_id]` at position `[position]`, mode `[mode]`. Active hooks: [list]. If you didn't do this, tap here to review and disable."*
3. Portal surfaces a persistent banner: "N active third-party hooks" linking to the hook management screen
4. Hook management screen shows: hook ID, position, mode, capability, endpoint domain, created_at, last_modified, created_by identity

**Adding a hook requires WebAuthn confirmation.** Removing a hook is frictionless — it reduces attack surface. Modifying a hook requires WebAuthn (equivalent to removing and re-adding).

**Steady-state visibility:** On every portal login, if any hooks are active, a low-priority persistent banner is shown: "You have N active hooks sending data to external endpoints." Not an alert — ambient awareness. Prevents the slow-boil attack where a hook is added months ago and forgotten.

### Hook Configuration Audit Trail

The hooks table in gateway SQLite has append-only semantics enforced at the application layer: changes are recorded as new rows with `superseded_at` timestamps, not updates to existing rows. The full history of every hook configuration change is queryable. The nightly verification job includes hook configuration in its integrity check.

---

## The No-LLM Invariant

This is a first-class security invariant for the six base layers, explicitly stated:

**The six base layers are vanilla deterministic software. No LLM API calls. No network calls of any kind. The only model inference in the base pipeline is the DeBERTa-v3-small INT8 model in Layer 2, loaded into the gateway process memory at startup. There is no network call during inference.**

Implications:

- **Layer 2 custom endpoint option** (referenced in the M9 overview as a P1 capability) is removed from the base layer. A custom endpoint means a network call during the pipeline, violating the invariant. If an operator wants a different model for Layer 2 scanning, they configure an `after_sanitize` sync hook pointing to their endpoint. The pipeline's deterministic performance characteristics remain intact.

- **Layer 3 ToS self-check** uses DeBERTa or equivalent local inference — not an API call. The spec language "local model" means loaded into process memory, not a call to a hosted model endpoint.

- **Hooks are explicitly exempt.** Hooks run at a defined position, are declared by the operator, and can call whatever they want — LLMs, external APIs, custom models. The invariant governs the base layers, not the extension points.

This gives the gateway a clean performance story: the base pipeline is always fast, always deterministic, always auditable. Observed latency variance is hook latency, not base layer variance. Operators can benchmark the base pipeline independently of their hook configuration.

---

## Ecosystem Integrations

With the hook mechanism in place, named integrations are pre-built hook configurations. These ship as reference files in the gateway repository under `integrations/`:

**DashClaw observe mode:**
```yaml
id: dashclaw-observe
position: after_scan
mode: async
capability: observe
endpoint: https://your-dashclaw.example.com/cello-feed
auth:
  type: hmac_sha256
  secret: ${DASHCLAW_WEBHOOK_SECRET}
context_mode: message_only
```

**n8n workflow trigger:**
```yaml
id: n8n-security-workflow
position: after_sanitize
mode: sync
capability: gate
endpoint: https://your-n8n.example.com/webhook/cello-security
auth:
  type: hmac_sha256
  secret: ${N8N_WEBHOOK_SECRET}
timeout_ms: 3000
on_timeout: fail_open
context_mode: message_only
```

More integrations are added to the library as the community uses the hook mechanism and contributes patterns back.

---

## Day 1 vs Day 2

### Day 1 (M9 implementation scope)

- Separate security gateway package and repository
- Six base layers, unchanged from V2, plus no-LLM invariant as a codified security invariant
- Tier 1 data extensions (pattern files at known paths, URL sources with TTL)
- Content hash chain: security pass records in SQLite, record_hash submitted to directory
- Directory new record type: `SecurityAttestation`
- Hook mechanism: positions, sync/async modes, observe/gate/redact capabilities, HMAC + bearer auth, message_only context, standard payload shape
- `redact` capability with no-inject enforcement (diff comparison before accepting transformed_content)
- Portal notifications on hook add/modify/remove
- Hook configuration audit trail (append-only row semantics)
- Nightly verification extended with security chain integrity checks
- Ecosystem integration reference configs (DashClaw, n8n)

### Day 2 (spec now, implement when needed)

**`transform` capability** — full content transformation beyond removal. Requires the enterprise governance overlay to be complete before it is safe to ship. The `redact` capability covers the primary use case (outbound redaction). Ship `redact` first, observe real usage, then open `transform` once the diff-logging and governance story is complete.

**context_depth / last_n_rounds** — start with `message_only`. Let operators run hooks against real production traffic on `message_only` first. Add depth once privacy implications are understood from actual usage patterns.

**Enterprise governance overlay** — M-of-N approval workflow for hook configuration changes, endpoint allowlist, capability restrictions per deployment. Specified here as the intended design; code when enterprises request it.

```typescript
// Day 2 — spec only
interface HookGovernancePolicy {
  requires_approval: {
    approvers: string[]           // pubkeys of authorized approvers
    min_approvals: number
    approval_window_hours: number
  }
  allowed_capabilities: HookCapability[]
  allowed_positions: HookPosition[]
  max_context_rounds: number
  blocked_payload_fields: PayloadField[]
  endpoint_allowlist?: string[]
}
```

When a governance policy is active, hook additions and modifications enter a `pending` state. The hook does not fire until the required approvers confirm via Operations Agent or portal. Pending hooks are visible to approvers with full configuration detail before they sign off.

---

## Attack Mitigations Summary

| Attack | Mechanism that closes it |
|---|---|
| Unauthorized hook added to exfiltrate messages | Portal notification + WebAuthn on add; hook audit trail |
| Hook with `redact` capability reinjects stripped content | `redact` enforcement: output-only-removes diff check; any new substring rejects response |
| Operator modifies gateway code to skip sanitization | Split-process deployment: employee cannot access enterprise-controlled gateway |
| Operator modifies gateway SQLite to alter diff records | record_hash submitted to directory before client receives response; mismatch detected by nightly job |
| Gateway write to directory suppressed by client | Client never holds this write path; gateway communicates directly |
| Hook at `after_scan` receives raw pre-Layer-1 content | Hard invariant: hooks never receive pre-Layer-1 content; Layer 1 is the entry ticket |
| Layer 1 pattern matching vulnerable to ReDoS | RE2 engine required (no backtracking); security invariant in SCAN-001 |
| Hook deleted from config, archive lost | Append-only row semantics; deletion recorded, not executed |

---

## Open Questions (Not Blocking M9)

**Should the gateway support a `transform` capability with operator-declared transformation contracts?** For example: a hook that declares "I will only transform by removing strings matching this pattern" — essentially a dynamic Tier 1 extension loaded at runtime rather than at startup. This bridges Tier 1 and Tier 2 in an interesting way but adds complexity to the enforcement model.

**Should diff records be encrypted at rest using the agent's identity key?** The diff records contain the actual redacted content. Currently they are stored in gateway SQLite with standard file-level encryption. KMS-wrapped diff records would be consistent with the audit log streaming design (Finding 6 from [[2026-05-16_1130_security-layer-improvements-from-production-reference]]).

**What is the session cleanup contract for context_depth?** When a session ends (seal ceremony), the context stored for hooks should be purged. The timing of this purge relative to the final session audit needs to be specified when context_depth is implemented.

---

## Related Documents

- [[prompt-injection-defense-layers-v2|Prompt Injection Defense Architecture V2]] — the six-layer spec this document wraps; base layers unchanged
- [[2026-04-11_1400_security-architecture-layers-and-trust-signal-classes|Security Architecture Layers and Trust Signal Classes]] — four-layer system model; where the six-layer pipeline sits within the broader security architecture
- [[2026-05-16_1130_security-layer-improvements-from-production-reference|Security Layer Improvements from Production Reference Analysis]] — the six production gaps (RE2, entropy, PII types, honey tokens, policy approval gate, audit log streaming) that informed V3 design; Findings 1–3 and 6 are Day 1 in V3
- [[2026-05-09_1100_dashclaw-m4-competitive-review|DashClaw Competitive Review]] — mission distinction (inbound defense vs outbound governance), production pattern lists, and the two gaps (observe mode, per-peer overrides) that V3's hook mechanism closes
- [[2026-05-21_1456_identity-as-governance-foundation|Identity as the Foundation of Governance]] — why governance with identity is a database row; the strategic frame for why V3's extensibility model is platform-appropriate
- [[user-stories/m9/overview.md|M9 Overview]] — implementation scope; needs updating to reflect V3 architecture
- [[user-stories/m9/attack-corpus-reference.md|M9 Attack Corpus Reference]] — attack technique catalog; unchanged in V3
- [[2026-04-17_1100_not-me-session-termination|"Not Me" Session Termination]] — WebAuthn/2FA pattern that hook add/modify confirmation extends
