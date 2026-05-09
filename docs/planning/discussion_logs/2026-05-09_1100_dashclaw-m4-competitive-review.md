---
name: DashClaw Competitive Review — M4 Security Layer
type: discussion
date: 2026-05-09 11:00
topics: [prompt-injection, security, m4, outbound-gate, redaction, Layer1, Layer3, Layer6, notifications, policy, configuration]
description: Comparative review of DashClaw's shipped governance/security implementation against CELLO's planned M4 prompt injection defense layer. Identifies what to adopt, what to defer, and two genuine gaps in the M4 design.
---

# DashClaw Competitive Review — M4 Security Layer

## Why We Looked at This

DashClaw (https://github.com/ucsandman/DashClaw, cloned to `/Users/andrep/Documents/code/DashClaw/`) is a shipped, production-tested policy firewall for AI agents. The core insight: they have done it, we are planning it. The value isn't just what they implemented — it's what their production bugs, filed design decisions, and actual code teach us about the problem space before we build.

The review was structured progressively: first understanding what DashClaw is, then reading the actual implementation files, then comparing against CELLO M4's planned architecture.

---

## Mission Distinction — The Key Reframe

The most important outcome of this review is understanding where the missions overlap and where they diverge.

**DashClaw's mission**: Govern what the agent *does to the world*. A human-in-the-loop approves agent actions before they execute. The threat model is the agent misbehaving — taking actions it shouldn't, costing too much, acting outside its authorization envelope. The guard evaluates outbound tool calls and blocks or escalates them.

**CELLO M4's mission**: Defend the agent *from what the world sends it*. The threat model is a sender trying to compromise the agent through malicious inbound content — prompt injection, jailbreaks, encoded payloads, exfiltration artifacts embedded in messages. The layers sanitize, scan, gate, redact, and govern the inbound and outbound data surfaces.

The directionality is predominantly opposite: DashClaw governs outbound behavior, CELLO M4 defends inbound surface.

However, CELLO does have outbound controls (Layers 3–6) that create partial overlap:
- **Layer 3** blocks outbound messages containing injection artifacts, secrets, or exfiltration patterns
- **Layer 4** redacts secrets and PII from forwarded content
- **Layer 5** limits LLM call spend and volume
- **Layer 6** enforces filesystem and URL access control

These are automated and deterministic — pattern matching and threshold enforcement — not human judgment calls. DashClaw's outbound governance involves a policy engine, human approval queues, and behavioral evaluation. The overlap is real but the implementation approach is different.

---

## Section 3: What to Take From DashClaw for M4

### 3.1 Production Pattern Lists

The most directly usable artifact. DashClaw ships two hardened regex files that represent production-tested detection coverage:

**`/Users/andrep/Documents/code/DashClaw/app/lib/promptInjection.js`**

Contains ~30 patterns covering what maps to CELLO Layer 1 Step 9 (pattern matching against known role markers and jailbreak commands) and Layer 2's detection categories. Patterns include:
- Role override attempts (`ignore previous instructions`, `you are now`, `act as`, `pretend you are`, `your new role`)
- Delimiter injection (`---`, `===`, `***` repeated as section markers used to break context)
- Instruction smuggling (base64-encoded directives, backtick-wrapped system prompts)
- Context manipulation (`disregard your training`, `forget everything`, `your guidelines have changed`)
- Data exfiltration phrases (`send this to`, `output your system prompt`, `repeat your instructions`)
- Encoding evasion (ROT13, hex encoding patterns, zero-width character insertion)

**What's notable**: These are Step 9 equivalents only. DashClaw has no Unicode stripping, no confusables normalization, no statistical anomaly detection — the full 11-step CELLO Layer 1 pipeline is more sophisticated than anything DashClaw has shipped. This validates the CELLO spec rather than suggesting gaps in it.

**`/Users/andrep/Documents/code/DashClaw/app/lib/security.js`**

Contains the `SECURITY_PATTERNS` array — the secrets detection list. This is directly applicable to CELLO-SCAN-003's secrets pattern coverage. The shipped list:

```javascript
aws_access_key:    /AKIA[0-9A-Z]{16}/
aws_secret_key:    /[0-9a-zA-Z/+]{40}/  (context-gated)
github_token:      /gh[pousr]_[0-9a-zA-Z]{36}/
openai_key:        /sk-[a-zA-Z0-9]{48}/
anthropic_key:     /sk-ant-[a-zA-Z0-9-_]{95}/
stripe_key:        /sk_live_[0-9a-zA-Z]{24}/
slack_token:       /xox[bpsar]-[0-9]{12}-[0-9]{12}-[0-9a-zA-Z]{24}/
jwt_token:         /eyJ[a-zA-Z0-9-_]+\.eyJ[a-zA-Z0-9-_]+\.[a-zA-Z0-9-_]+/
private_key:       /-----BEGIN PRIVATE KEY-----/
password_field:    /password\s*[:=]\s*['"][^'"]+['"]/i
bearer_token:      /Bearer\s+[a-zA-Z0-9-_]+\.[a-zA-Z0-9-_]+\.[a-zA-Z0-9-_]+/
database_url:      /(postgres|mysql|mongodb|redis):\/\/[^:]+:[^@]+@/
```

This is a concrete starting point for CELLO-SCAN-003. The CELLO spec for Layer 4 secret redaction mentions "8 common formats" but doesn't enumerate them. DashClaw's list is the most directly usable reference we have from a production-hardened source.

### 3.2 Destructive Command Deny-List

**`/Users/andrep/Documents/code/DashClaw/hooks/dashclaw_agent_intel/bash_classifier.py`**

The `destructive_command_validation` submodule provides a production-validated deny-list relevant to CELLO Layer 6 (filesystem and URL access control). DashClaw's shipped destructive command classifications:

- Fork bombs: `:(){ :|:& };:` and variants
- Database destruction: `DROP TABLE`, `DROP DATABASE`, `TRUNCATE TABLE`
- Disk wiping: `mkfs` (reformat filesystem), `dd with of=/dev/sd*` (raw disk write)
- Recursive deletion: `rm -rf /`, `rm -rf ~`, `rm -rf *` at root or home paths
- System path writes via `sed -i` on files under `/etc/`, `/usr/`, `/sys/`
- Path traversal: `../` sequences, `~` home directory shortcuts in untrusted input

Risk base scores assigned by intent in the classifier:
```python
readonly:     5
write:        35
destructive:  90
network:      40
system_admin: 75
```

CELLO Layer 6's deny-all posture with an allowlist approach is architecturally stronger than DashClaw's risk-scoring approach — but the destructive command list itself is a useful reference for what to test against.

### 3.3 Fail-Closed on Exception

**`/Users/andrep/Documents/code/DashClaw/hooks/dashclaw_pretool.py`** — `handle_guard_unavailable()` function

DashClaw's production experience confirms: when the guard throws an exception or is unreachable, the default behavior is to block, not to allow. The hook exits with a non-zero code. `failClosed=true` is the default in `openclaw.plugin.json`.

CELLO Layer 1 already specifies this: "If any step throws an unhandled exception, Layer 1 blocks by default and logs the error as a detection event. The client never passes through content on exception — it fails closed."

DashClaw's production deployment validates this choice. No change needed, but the confirmation is useful — this is a non-obvious default that some implementations get wrong.

### 3.4 Observe Mode

**`/Users/andrep/Documents/code/DashClaw/hooks/dashclaw_pretool.py`** — `DASHCLAW_HOOK_MODE=observe` branch

DashClaw ships an observe mode: when `DASHCLAW_HOOK_MODE=observe`, the hook evaluates the request, logs what would have been blocked, but exits 0 (allows through). This is used for:
1. Policy rollout validation — running new rules against real traffic before enabling enforcement
2. False positive assessment — understanding what a new pattern list would block before committing
3. Staged deployment — enabling observe on a subset of agents while others run full enforcement

CELLO M4 currently has no equivalent. The first time Layer 1's 11-step pipeline runs on a real agent's traffic, there is no way to evaluate its impact without enabling it at full enforcement. For operators deploying CELLO on agents with existing workloads (security-focused agents, agents that discuss code, agents that handle diverse content), this is a real deployment risk.

Proposed addition: a single `cello_configure` flag — `injection_defense_mode: observe | enforce`. In `observe` mode, all layers run their full evaluation, log what would have been blocked, but allow content through. This is a single-story addition to `agent-client.md` Part 5.

---

## Section 4: What Not to Take for M4 (But Worth Documenting for Later)

These items were identified during the review. They are not M4 stories — they either cross into governance territory, exceed current scope, or require dependencies that don't exist yet. They are documented here because we may revisit them.

### 4.1 HITL Approval, Approval Scoping, Human-Actor Audit Log

**DashClaw reference**: `app/api/approvals/[actionId]/route.js`, `app/lib/repositories/actions.repository.js`, `app/lib/audit.js`

DashClaw implements:
- Per-action human approval (allow/deny via dashboard, Telegram bot, Discord DM)
- Approval scoping — the `authorization_scope` column exists in `action_records` for once/session/forever scoping, though the code is not yet implemented (the column is selected in `listActions` but never evaluated)
- Human-actor audit log — a separate `activity_logs` table recording what *people* did as governance actors, distinct from what agents did

**Why not M4**: These are governance layer concerns. The question "should this agent be allowed to take this action?" is different from "is this content safe to receive or send?". CELLO M4 is an automated security pipeline; HITL approval introduces human latency into the message flow. If CELLO later builds a governance layer above M4 — closer to DashClaw's model — these patterns would be directly applicable.

**Potential future home**: A hypothetical CELLO governance layer would need exactly this — an approval queue integrated with the escalation system (which CELLO already has for connection requests), approval scoping against the contact list, and a human-actor audit trail separate from the agent activity log.

### 4.2 Behavioral Anomaly Detection via Vector Embeddings

**DashClaw reference**: `app/lib/guard.js` — `behavioral_anomaly` policy type

DashClaw's guard supports a `behavioral_anomaly` policy that uses pgvector embeddings to compare current agent behavior against historical patterns. A new action that is semantically dissimilar from prior approved actions can be flagged or blocked. This is a form of learned baseline — the system gets better at identifying unusual behavior over time.

**Why not M4**: This requires a vector database, baseline training data, and ongoing model maintenance. It is significantly more sophisticated than CELLO's planned Layer 2 (DeBERTa-v3-small for classification) and is a different threat model — behavioral drift rather than content injection. The computational and operational overhead is not appropriate for a day-one security layer.

**Potential future home**: If CELLO ever builds anomaly detection into the directory's behavioral monitoring (which already tracks conductance scores, temporal burst detection, and unusual signing patterns), a similar vector-embedding approach could inform those signals. The directory's existing behavioral analysis is the natural integration point, not the client-side injection defense layer.

### 4.3 Layer 5 Cost Policy Controls

**DashClaw reference**: `app/api/actions/[actionId]/route.js` PATCH handler, `packages/openclaw-plugin/src/index.ts` token attribution

DashClaw tracks token costs per action, attributes tokens across tool calls using a `distributeEvenly` function with exact integer preservation, and can require approval for actions exceeding a cost threshold. The `cost_estimate` field in `action_records` is auto-derived from tokens when not explicitly provided.

Notable implementation detail from `src/index.ts`:
```typescript
// Cache pricing — 90% discount applied
const cacheReadEffective = Math.round((usage.cacheRead ?? 0) * 0.1);
const tokens_in = (usage.input ?? 0) + (usage.cacheWrite ?? 0) + cacheReadEffective;

// Exact integer distribution across tool calls
function distributeEvenly(total: number, n: number): number[] {
  const base = Math.floor(total / n);
  const remainder = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < remainder ? 1 : 0));
}
```

**Why not M4**: CELLO Layer 5 is already defined as a spend limit and call volume governor — engineering hygiene against billing runaway. Expanding it to policy-driven approval gates crosses into governance. CELLO's inference billing protocol (milestone M3+) handles cost tracking at the session level via the `InferenceRateCard` and `ABORT-BILLING` mechanism — that is the correct home for cost policy controls in CELLO, not the injection defense layer.

**Potential future home**: The cache pricing discount formula and the exact integer distribution across multiple tool calls are implementation details worth referencing when CELLO builds detailed token attribution for the inference billing layer.

### 4.4 OpenClaw Plugin Architecture (Framework Integration Pattern)

**DashClaw reference**: `packages/openclaw-plugin/src/index.ts`, `packages/openclaw-plugin/openclaw.plugin.json`

DashClaw ships as an OpenClaw gateway plugin — a long-lived TypeScript process that intercepts every tool call through four lifecycle events: `before_tool_call`, `after_tool_call`, `llm_output`, `agent_end`. This is architecturally different from CELLO's client (an MCP server) and from DashClaw's Claude Code hook (a Python subprocess).

Key design decisions visible in the plugin implementation:
- State between `before_tool_call` and `after_tool_call` is held in an in-memory `Map` (not temp files, as the hook model requires)
- Memory cap at `MAX_TURN_RUNS = 1000` entries with eviction of oldest on overflow — preventing memory growth in long-lived processes
- Two ID spaces: `guard_decisions` IDs (prefix `act_gd_`) vs `action_records` IDs — `waitForApproval` requires the action_records ID, not the guard_decisions ID. A production bug (`BUG-02`) was filed when this was confused.
- `close_if_running` contract on the PATCH endpoint — fields that close a running action (`status`, `output_summary`, `timestamp_end`) are gated to `status = 'running'`; token/cost/model fields apply unconditionally so late patches still land
- Shared `action_type` vocabulary: `deploy/security/apply/review/api/build/other` — consistent across all framework integrations for policy portability

**Why not M4**: CELLO doesn't currently have a plugin/gateway architecture. The agent calls MCP tools directly; the CELLO client is the MCP server. When CELLO eventually builds framework integrations for Hermes Agent, OpenClaw, and similar systems, this plugin pattern is the reference implementation. The lifecycle event model, the state management approach, and the two-ID-spaces caution are all directly relevant to that future work.

---

## Section 5: Genuine M4 Gaps Identified

### Gap 1: Real-Time Block Notifications

**Current state**: When Layer 1 or Layer 3 fires, CELLO logs the event to the local SQLCipher database and surfaces it in `cello_status` / `cello_poll_notifications`. The owner sees it in the portal activity log — but only if they go look. There is no push notification on a block event.

**DashClaw comparison**: `app/lib/actionAlerts.js` fires a Discord webhook notification immediately on every `blocked` or `high_risk` event. The operator sees it in real time. The alert channel is separate from the approval channel — a webhook URL, not a bot DM.

**CELLO already has the infrastructure**: WhatsApp/Telegram/WeChat as an out-of-band channel is configured via `cello_configure` and used for escalation and anomaly alerts. Adding a block notification is a small extension — the directory already sends `SECURITY_BLOCK` events, the question is whether the client also triggers an out-of-band push for Layer 3 blocks (currently it does not; the `SECURITY_BLOCK` notification covers Layer 1 inbound blocks but the Layer 3 outbound gate has no equivalent push).

**Proposed change**: When Layer 3 fires and blocks an outbound message, the client emits a `SECURITY_BLOCK` event (subtype: `layer3_outbound`) alongside the existing log entry. The notification path already handles this type — the extension is in the client's Layer 3 block handler, not in the notification infrastructure.

**Impact**: `agent-client.md` Part 5 (Layer 3), `server-infrastructure.md` notification type registry (subtype addition), `frontend.md` activity log display. Small story.

### Gap 2: Per-Peer Defense Policy Overrides

**Current state**: The defense layers are global. Layer 1's 11 steps run on all inbound content regardless of source. Layer 3's pattern list fires on all outbound content regardless of destination. The only configuration surface is `cello_configure` for global thresholds (Layer 2 review/block scores).

**The practical problem**: An agent that works in AI security research, code review, or educational content about prompt injection will generate constant false positives on Layer 1 Step 9 (which matches injection command patterns) and potentially Layer 2. With no per-peer adjustment, the only recourse is to lower the global threshold — which weakens the defense for all other peers.

**DashClaw comparison**: `app/lib/guard.js` supports per-policy overrides at the action level. `openclaw.plugin.json` `highRiskTools` is a per-tool risk score override. `tool_recognizer.py` `DASHCLAW_GOVERNED_CATEGORIES` is an env-var override for which tool categories are governed. The pattern throughout is: sensible defaults with a principled override mechanism.

**The contact list already has the shape for this**: `agent-client.md` Part 7 shows the contact record:

```
contact_list[]
  policy_override  — custom SignalRequirementPolicy for this specific agent
```

This `policy_override` is for connection acceptance policy. The concept of "this peer gets different treatment" is already designed — it just doesn't extend to the defense layers.

**Proposed addition**: A `defense_policy_override` field on the contact record:

```typescript
interface DefensePolicyOverride {
  layer1_step_mask?: number[]    // which Layer 1 steps to skip for this peer
  layer2_threshold_review?: number  // override the review threshold (default 35)
  layer2_threshold_block?: number   // override the block threshold (default 70)
  layer3_exempt?: boolean           // skip Layer 3 outbound gate for this peer
  layer4_exempt?: boolean           // skip Layer 4 redaction for this peer
}
```

The portal needs a "trusted peer exception" view — accessible from the connection detail page. The agent can also configure it via `cello_configure` in a per-peer block.

**Critical constraint**: Per-peer overrides must be owner-configured, never agent-configurable autonomously. An agent that could modify its own defense policy overrides in response to peer requests would be trivially exploitable. The override lives in the local contact record, which is owner-managed (portal or `cello_configure` with owner auth).

**Impact**: `agent-client.md` Part 7 (contact list schema), Part 5 (each layer checks override before evaluating), `frontend.md` (per-peer defense exception UI in connection management), `server-infrastructure.md` (no changes — purely client-side). Medium story.

---

## Decisions Made in This Session

1. DashClaw's production pattern lists (`promptInjection.js`, `security.js`) should be reviewed when writing CELLO-SCAN-003 and CELLO-REDACT-004 acceptance criteria. They are not authoritative — CELLO's spec is more comprehensive — but they are a useful baseline for what production systems actually block.

2. Observe mode (Gap deferred to a new story) is a pre-M4 deployment story. It should be specced before any M4 implementation begins so that operators can validate Layer 1 coverage against real traffic.

3. Per-peer defense policy overrides (Gap 2) need a story. This is not large, but the absence creates a forcing function: agents with sophisticated use cases cannot tune the defense without degrading it globally.

4. The governance layer concerns (HITL approval, behavioral anomaly detection, cost policy gates) are explicitly not M4 scope. If CELLO ever builds a governance layer above the security layer, this document is the reference for what DashClaw has shipped and what gaps exist in their implementation.

5. The OpenClaw plugin architecture section (4.4) is the reference for framework integration work when CELLO builds plugins for Hermes Agent, OpenClaw, and similar gateway products. The two-ID-spaces bug and the close_if_running contract are worth reading before starting that work.

---

## Related Documents

- [[prompt-injection-defense-layers-v2|Prompt Injection Defense Architecture]] — the primary spec this review informs; Sections 3–4 here map directly to its six layers and identify gaps in the current design
- [[attack-corpus-reference|M4 Attack Corpus Reference]] — DashClaw's `promptInjection.js` and `security.js` pattern lists are a production baseline for the attack corpus used in CELLO-SCAN-003 and CELLO-REDACT-004
- [[agent-client|CELLO Agent Client Requirements]] — Part 5 specifies all six defense layers; Part 7 contains the contact list schema that Gap 2 (per-peer overrides) extends
- [[server-infrastructure|CELLO Server Infrastructure Requirements]] — notification type registry where a new `SECURITY_BLOCK` subtype for Layer 3 outbound blocks needs to be added (Gap 1)
- [[frontend|CELLO Frontend Requirements]] — the connection management section where the per-peer defense exception UI would live (Gap 2)
