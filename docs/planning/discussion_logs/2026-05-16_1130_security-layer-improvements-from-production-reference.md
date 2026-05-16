---
name: Security Layer Improvements from Production Reference Analysis
type: discussion
date: 2026-05-16 11:30
topics: [security-architecture, prompt-injection, layer-1, layer-4, layer-5a, redaction, re2, entropy, pii, honey-tokens, audit-log-streaming, policy-approval-gate]
status: active
description: Six concrete improvements to CELLO's six-layer security architecture, derived from studying a production open-source implementation. Covers ReDoS prevention in Layer 1, entropy scoring for encoded payload detection, three missing PII types in Layer 4, honey tokens as an active deception primitive, a policy change approval gate, and making audit log streaming production-concrete.
---

# Security Layer Improvements from Production Reference Analysis

This session reviewed how a mature, production open-source security platform handles problems that CELLO's six-layer design specifies but does not fully close. The findings are not theoretical — they are gaps visible by comparing CELLO's story acceptance criteria against working production code. Six improvements are identified.

---

## Finding 1: Layer 1 pattern matching must use RE2, not native RegExp

**The gap.** CELLO's Layer 1 Step 9 runs attacker-controlled text through regex pattern matching for injection markers. The current stories and design spec do not prescribe which regex engine to use — this omission leaves the implementation open to using Node's built-in `RegExp`, which uses a backtracking algorithm.

**Why it matters.** Backtracking regex engines are vulnerable to ReDoS (Regular Expression Denial of Service). A carefully crafted payload can cause exponential or polynomial backtracking in a complex pattern, making a single message take seconds or minutes to process. This is not hypothetical: injections routinely attempt to exhaust or block the sanitization pipeline rather than pass through it. An attacker who can stall the pipeline for 30 seconds per message has effectively achieved a denial of service on the receiving agent.

RE2 guarantees linear-time execution by construction — it eliminates the entire backtracking attack surface. The tradeoff is that RE2 does not support backreferences or lookaheads, which CELLO's injection patterns do not require.

**Production reference.** The PII library at `backend/src/lib/pii/index.ts` uses `import RE2 from "re2"` for all five PII patterns. Every pattern is a precompiled `new RE2(...)` instance. The `re2` npm package is a Node.js binding to Google's RE2 library and drops in as a `RegExp` replacement.

**What needs to change.** Add a security invariant to CELLO-SCAN-001: Step 9 and all other Layer 1 pattern matching steps shall use an RE2-compatible engine, not `RegExp`. The implementation must never use backtracking regex for attacker-controlled input.

```
https://github.com/Infisical/infisical/blob/main/backend/src/lib/pii/index.ts
```

---

## Finding 2: Layer 1 Step 8 should add Shannon entropy scoring

**The gap.** CELLO's Layer 1 Step 8 uses character-type distribution baselines per source type (ratio of punctuation, digits, unusual Unicode blocks, etc.) to detect anomalous payloads. This catches gross anomalies — 80% punctuation, unusual Unicode concentration — but misses high-entropy blobs that have superficially normal character distributions.

**Why it matters.** A base64-encoded injection payload has a character distribution that appears normal (alphanumeric + `/=+`) but a very high Shannon entropy score — randomness is what distinguishes an encoded payload from prose. Entropy scoring is a standard technique in secret scanning tools for exactly this reason: it detects things that look superficially like text but are actually encoded content.

Adding Shannon entropy as a supplementary signal to Step 8 catches a class of encoded injection payloads cheaply and deterministically, before they reach the more expensive Layer 2 scanner. It does not replace the character-frequency baseline — it complements it. A message that is high-entropy AND anomalous in character distribution is more likely to be adversarial than either signal alone.

**Production reference.** Infisical's secret scanning toolchain (gitleaks under the hood) outputs a Shannon `Entropy` field per finding. The `SecretMatch` type at `backend/src/ee/services/secret-scanning/secret-scanning-queue/secret-scanning-queue-types.ts` includes `Entropy: number`. Gitleaks uses entropy thresholds combined with pattern matching to distinguish real secrets from false positives — the same technique applies to encoded injection payloads.

**What needs to change.** Add entropy scoring to CELLO-SCAN-001 Step 8's behavior: alongside the character-frequency baseline check, compute Shannon entropy of the sanitized text. If entropy exceeds the configured threshold for the source type, increment the suspicion score. The check remains API-call-free and produces no model inference.

```
https://github.com/Infisical/infisical/blob/main/backend/src/ee/services/secret-scanning/secret-scanning-queue/secret-scanning-queue-types.ts
```

---

## Finding 3: Layer 4 PII redaction is missing SSN, credit card numbers, and IP addresses

**The gap.** CELLO's Layer 4 PII redaction (CELLO-REDACT-001) covers personal email addresses, phone numbers, and dollar amounts. Three standard PII categories are absent: US Social Security Numbers, credit card numbers (all major issuers), and IP addresses (both IPv4 and IPv6).

**Why it matters.**
- **IP addresses**: CELLO's own Layer 6 design lists "internal file paths and network topology" as a protected asset. An agent that leaks an internal IP address in outbound content narrows future attack surface — the attacker learns which private ranges are in use, which hosts are reachable. This is called out in the Layer 6 design spec but the corresponding redaction is missing from Layer 4.
- **SSN and credit card numbers**: These appear in contexts where AI agents interact with financial or identity workflows. They are standard PII categories and their absence is a gap relative to any production implementation.

**Production reference.** The PII library at `backend/src/lib/pii/index.ts` covers all five types with precompiled RE2 patterns: EMAIL, PHONE, SSN, CREDIT_CARD, and IP_ADDRESS. The credit card pattern covers Visa, Mastercard, Amex, and Discover. The IP pattern covers both IPv4 and IPv6 including shortened forms. The existing patterns are production-validated and can be adapted directly.

**What needs to change.** Extend CELLO-REDACT-001 behavior and acceptance criteria to include SSN (`[REDACTED_SSN]`), credit card (`[REDACTED_CREDIT_CARD]`), and IP address (`[REDACTED_IP]`) redaction. Add SI-003: the PII redaction module shall cover at minimum the six types defined by this story (email, phone, dollar amounts, SSN, credit card, IP address).

```
https://github.com/Infisical/infisical/blob/main/backend/src/lib/pii/index.ts
```

---

## Finding 4: Honey tokens — an active deception primitive not present in the current design

**The gap.** All of CELLO's six security layers are passive or reactive: they sanitize, scan, block, redact, or audit. None of them actively detect whether a counterparty is exfiltrating content from a conversation. If an attacker successfully manipulates an agent into leaking credentials that appear in the conversation, CELLO has no mechanism to know the leak has been used.

**Why it matters.** Honey tokens change the economics of a successful attack: the attacker who exfiltrates credentials and uses them announces themselves immediately. This is qualitatively different from passive detection — it turns a successful attack into an automatic detection event. For CELLO specifically, this is valuable because message content is P2P and the directory never sees it: if an attacker intercepts or manipulates conversation content, CELLO has limited visibility. A honey token that fires when touched gives signal the protocol would not otherwise have.

**How it would work.** The CELLO client generates fake-but-structurally-valid credentials (API key format, token format) and optionally embeds them in conversation records or agent context. If any party attempts to use them, the backend service (e.g., AWS CloudTrail for fake IAM credentials) fires an alert. This adds an active tripwire to the conversation layer without requiring any change to the cryptographic protocol.

**Production reference.** Infisical's honey token system generates real AWS IAM credentials with zero permissions attached, issues them as decoys, and detects their use via CloudTrail event forwarding. The service is at `backend/src/ee/services/honey-token/`. The architecture is provider-extensible — `honey-token-provider-fns.ts` maps provider types to hook factories. The AWS provider at `backend/src/ee/services/honey-token/aws/` handles credential creation, revocation, and trigger notification.

The trigger notification includes a 24-hour cooldown to prevent notification storms, and a 5-minute tolerance window for signature verification. These are good defaults for CELLO's alerting model.

**Where this fits in CELLO.** This is a new detection primitive, not an extension of any existing layer. It would be designed as Layer 3 complement (something that activates when outbound content reaches a counterparty) or as an operator-level feature of the CELLO Operations Agent. It is not a day-one implementation — but the design should acknowledge its existence and defer it explicitly rather than having the gap go unnoticed.

```
https://github.com/Infisical/infisical/tree/main/backend/src/ee/services/honey-token
https://github.com/Infisical/infisical/blob/main/backend/src/ee/services/honey-token/aws/honey-token-aws-service.ts
```

---

## Finding 5: Connection policy changes should require an approval gate before taking effect

**The gap.** CELLO's enforcement layer (Layer 5a) covers consequences for violations — tombstones, rate limits, voucher penalties, dispute resolution. It does not include a gate on policy mutation itself. An agent's connection policy (`SignalRequirementPolicy`) can be changed and takes effect immediately.

**Why it matters.** If an attacker compromises an agent, their first action is typically to lower defenses — drop signal requirements, open the connection policy to accept anyone. With no approval gate, this change takes effect instantly and silently. By the time the owner notices unusual connections, the attacker has already established sessions under the weakened policy.

An approval gate that requires out-of-band confirmation (WebAuthn, phone confirmation via the CELLO Operations Agent) before a policy change takes effect closes this window entirely. CELLO already has this pattern for key revocation: "Not Me" requires WebAuthn/2FA before K_server is burned. The same invariant should apply to policy changes.

**Production reference.** Infisical's secret approval policy service at `backend/src/ee/services/secret-approval-policy/` implements M-of-N approval for changes to secrets in designated paths. The `getPolicyScore` function determines specificity (exact path scores higher than glob, glob scores higher than catch-all). Any change to a protected secret requires designated approvers to sign off before the change is applied.

The mechanism is policy-first: you declare what requires approval, and the system enforces it. CELLO's analog is: connection policy changes above a threshold of severity (e.g., lowering required trust signals, changing from Selective to Open policy) require WebAuthn confirmation or CELLO Operations Agent phone confirmation before taking effect.

**Where this fits in CELLO.** This extends the Connections domain (Domain 3) and the Compromise & Recovery domain (Domain 6) rather than the six-layer security pipeline. It is a protocol-level enforcement decision, not a client-implementation decision. It should be raised as a new story in those domains rather than added to M9.

```
https://github.com/Infisical/infisical/blob/main/backend/src/ee/services/secret-approval-policy/secret-approval-policy-service.ts
```

---

## Finding 6: Audit log streaming needs to be production-concrete, not aspirational

**The gap.** CELLO-REDACT-004 specifies that blocking decisions go to "an append-only destination the agent process cannot modify." This is correct as a principle but leaves the actual destination unspecified. In practice, an append-only local log file is insufficient for operators who need real-time visibility, alerting, or SIEM integration. The design stops short of specifying how logs reach those systems.

An equally important gap: the credentials required to stream to an external log destination need to be stored somewhere. If they are stored in plaintext, securing the audit log introduces a new credential management problem.

**Production reference.** Infisical's audit log streaming service at `backend/src/ee/services/audit-log-stream/` ships production integrations with Datadog, Splunk, Azure Monitor, Cribl, and custom HTTP endpoints. The key implementation detail: all streaming credentials are encrypted at rest using the KMS service (`kmsService.createCipherPairWithDataKey`) before storage. The `decryptLogStreamCredentials` function decrypts them at stream time. The log destination and encrypted credentials are stored as a single record; the KMS key is separate from the record itself.

This is the pattern CELLO should adopt for the hosted directory operator tier: operators configure a log stream target (their SIEM, Datadog org, etc.), credentials are KMS-wrapped on write and decrypted only at stream time, and blocking decisions stream automatically.

**What needs to change.** CELLO-REDACT-004 should add a production log destination section describing at minimum: (1) local append-only file for single-operator deployments, (2) external streaming for multi-operator or compliance deployments, with streaming credentials KMS-wrapped at rest. The specific SIEM integrations are operator choices, but the encrypted credential pattern is an architectural requirement.

```
https://github.com/Infisical/infisical/tree/main/backend/src/ee/services/audit-log-stream
https://github.com/Infisical/infisical/blob/main/backend/src/ee/services/audit-log-stream/audit-log-stream-service.ts
```

---

## Summary

| Finding | Affected Story | Type | Urgency |
|---|---|---|---|
| RE2 engine for Layer 1 pattern matching | CELLO-SCAN-001 | Gap in existing story SI | High — closes entire ReDoS attack class |
| Entropy scoring in Step 8 | CELLO-SCAN-001 | Extension to existing behavior | Medium — catches class missed by frequency baseline |
| Missing SSN / CC / IP redaction | CELLO-REDACT-001 | Extension to existing story | High — IP leakage contradicts Layer 6 design intent |
| Honey tokens as deception primitive | New story (no home yet) | New design area | Low urgency, high novelty — needs a design session |
| Policy change approval gate | New story in Connections / Recovery domains | Protocol design gap | Medium — no story exists yet |
| Audit log streaming production spec | CELLO-REDACT-004 | Extension to existing story | Medium — needed before hosted operator tier |

Findings 1, 2, and 3 are direct additions to existing M9 stories. Findings 4, 5, and 6 require either new stories or design sessions before stories can be written.

---

## Reference Repository

All production code cited in this document is from the Infisical open-source repository:

```
https://github.com/Infisical/infisical
```

File-level references per finding:

- **Finding 1 (RE2)**: `backend/src/lib/pii/index.ts`
- **Finding 2 (Entropy)**: `backend/src/ee/services/secret-scanning/secret-scanning-queue/secret-scanning-queue-types.ts`
- **Finding 3 (PII gaps)**: `backend/src/lib/pii/index.ts`
- **Finding 4 (Honey tokens)**: `backend/src/ee/services/honey-token/` (directory), `backend/src/ee/services/honey-token/aws/honey-token-aws-service.ts`
- **Finding 5 (Policy approval gate)**: `backend/src/ee/services/secret-approval-policy/secret-approval-policy-service.ts`
- **Finding 6 (Audit log streaming)**: `backend/src/ee/services/audit-log-stream/` (directory), `backend/src/ee/services/audit-log-stream/audit-log-stream-service.ts`

---

## Related Documents

- [[prompt-injection-defense-layers-v2|Prompt Injection Defense Architecture]] — the six-layer architecture this analysis is grounded in; Findings 1–3 and 6 map to specific layers
- [[2026-04-11_1400_security-architecture-layers-and-trust-signal-classes|Security Architecture Layers and Trust Signal Classes]] — the four-layer system model; Finding 5 (policy approval gate) extends Layer 5a
- [[2026-04-08_1900_connection-staking-and-institutional-defense|Connection Staking and Institutional Defense]] — Finding 5's gate pyramid principle extends what is already designed here
- [[2026-04-17_1100_not-me-session-termination|"Not Me" Session Termination]] — the WebAuthn/2FA pattern Finding 5 would extend to policy mutation
