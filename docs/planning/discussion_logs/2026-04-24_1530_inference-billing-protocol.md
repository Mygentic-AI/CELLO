---
name: Inference Billing Protocol
type: discussion
date: 2026-04-24 15:30
topics: [inference, commerce, token-pricing, tokenizer, rate-card, merkle-tree, session-termination, runtime-governance, MCP-tools, privacy, hosted-services]
description: Token-based pricing for specialized inference over CELLO — rate card extension, signed cumulative billing in Merkle leaves, client-side cap enforcement, and three tokenizer verification modes (local, hosted opt-in, trust-only).
---

# Inference Billing Protocol

## Why This Document Exists

Specialized inference is one of the priority Phase 1 verticals — fine-tuned models selling per-query access, "selling your brain." It is the only Phase 1 vertical where the protocol's message-oriented, per-message-settled model meets a buyer population with strong convention expectations: every inference API in the ecosystem prices by tokens, and anything else invites endless debate regardless of whether it makes sense.

The question this log answers: **does CELLO as currently designed support token-based inference billing well, or does the protocol need extension?**

Short answer: yes, it supports it well, and the additions needed are all minor and additive. This log records the mechanism, the verification modes, and the deferred decisions.

---

## Scope

**In scope.** Specialized inference sold agent-to-agent via CELLO — fine-tuned models, analysis models, domain-specific reasoning models. One seller running one model (or a small portfolio) selling per-query access to other agents.

**Out of scope.**
- **General model inference.** CELLO is not competing with OpenRouter, Together, or raw model providers. Specialized sellers only.
- **Token streaming.** Agents do not benefit from token-by-token streaming — streaming exists to give humans the feel of ongoing progress. Agents consume the full response. CELLO remains message-oriented; inference messages are complete-response.
- **Compute correctness proofs.** CELLO proves the bytes exchanged, not the computation performed. A seller who silently swaps models cannot be detected by the protocol. This is a known limitation of every trustless inference market today. Zero-knowledge inference proofs (zkML) would close it but are not production-viable. The commercial doc should acknowledge this honestly; no protocol work addresses it at launch.

---

## Why Token Pricing, Not Flat-Per-Query

Flat-per-query pricing was considered and rejected. Technically, flat pricing is simpler — commit at session start, settle at the known rate per message, no reconciliation. But the inference ecosystem is deeply acculturated to token pricing, and telling a technically-literate buyer "this is flat" invites an endless list of questions: what's my guaranteed token budget, why is it flat, what happens on long responses, and so on. Fighting ecosystem convention here buys nothing the seller actually wants.

Token pricing it is. The positioning is "just like every API you already use, with signed running totals so the count is verifiable."

---

## Caching: Actually Better Than Stateless APIs

One early concern was whether CELLO breaks prompt caching. The opposite is true.

In the HTTP API world, caching exists *because* the client is stateless — it re-sends the full conversation history every turn, and the server's prompt cache recognizes the repeated prefix. CELLO sessions are stateful on both ends: both the buyer's client and the seller's agent maintain the Merkle-chained conversation locally. The buyer sends only the new user turn; the seller appends it to their local history and reconstructs the full prompt for their underlying model. The seller's prompt cache (Anthropic, OpenAI, self-hosted) hits normally because they feed the model the same prefix each turn.

Net effect: buyer saves bandwidth, seller's cache works identically, per-turn pricing can still reflect cache-hit vs cache-miss via the rate card. No protocol change needed. This is strictly better than the stateless-API pattern.

---

## Rate Card Extension

Session establishment already declares commercial terms (see push-publish subscriptions). Inference sessions extend the same structure with an **inference rate card**:

```
InferenceRateCard {
  input_rate_per_1k:   decimal      // e.g. $0.002
  output_rate_per_1k:  decimal      // e.g. $0.006
  model_id:            string       // declared by seller; informational
  tokenizer_id:        string       // mandatory
  tokenizer_hash:      bytes32      // SHA-256 of the canonical tokenizer artifact
  currency:            enum         // USD, USDC, USDT, ETH
  cache_discount:      decimal?     // optional — e.g. 0.1 means cached prefix tokens priced at 10% of input rate
  caps: {
    max_cost_per_message:   decimal?   // optional per-message ceiling
    max_cost_per_session:   decimal?   // optional session ceiling
    max_tokens_per_message: int?       // optional per-message token ceiling
  }
}
```

**Mandatory fields.** `input_rate_per_1k`, `output_rate_per_1k`, `tokenizer_id`, `tokenizer_hash`, `currency`. Without `tokenizer_id` and `tokenizer_hash`, cumulative counts are not reproducible and the whole verification story collapses.

**Binding.** The rate card is part of session policy, signed by both parties at session establishment (FROST session bookend). The card's hash goes in every inference response leaf — the seller cannot retroactively change prices because the signed rate card hash would not match.

**Rate card change = new session.** If a seller wants to change pricing, they close the current session and establish a new one with a new rate card. This matches how every API rate limit and pricing change works and keeps the Merkle chain unambiguous.

---

## Merkle Leaf Schema for Inference Messages

Every inference response leaf carries structured billing metadata alongside the existing leaf fields (sender pubkey, sequence number, content, scan result, prev_root, timestamp).

**Recommended schema for an inference response:**

```
InferenceResponseMetadata {
  input_tokens_this_message:      int
  output_tokens_this_message:     int
  cached_input_tokens_this_message: int?   // optional, if cache_discount used
  cost_this_message:              decimal
  input_tokens_cumulative:        int
  output_tokens_cumulative:       int
  cost_cumulative:                decimal
  rate_card_hash:                 bytes32  // MUST match session rate card
  model_id:                       string
  tokenizer_id:                   string
}
```

Because this is in the signed leaf, cumulative totals are **attested, not reported**. If the seller lies on turn 7, turn 7's leaf is signed evidence in a dispute. The buyer does not have to trust the running total — they can verify each turn's math against the declared rate card and tokenizer.

**Design question: first-class protocol field or application-layer recommendation?**

Making these fields a first-class part of the protocol message schema is cleaner for disputes — the arbitration logic knows where to look. But it bakes one commerce vertical's needs into the message schema, which cuts against the protocol's generality.

**Decision: application-layer recommendation at launch, promote to first-class if the vertical grows.** Sellers who follow the recommended schema get full dispute coverage. Sellers who do not are on their own — they can still sell inference, but disputes fall back to manual arbitration. The schema lives in the commerce documentation alongside push-publish subscription records and purchase attestations.

---

## Client-Side Enforcement: Layer 5 Runtime Governance

Layer 5 of the prompt injection defense architecture already covers "spend/volume/lifetime limits, duplicate detection." Per-session inference cost caps fit there directly — no new enforcement layer.

**What the buyer's client does on each inference response:**

1. Verify the seller's signature on the leaf.
2. Verify `rate_card_hash` matches the session's declared rate card.
3. Optionally re-tokenize the content to verify `input_tokens_this_message` and `output_tokens_this_message` (see tokenizer verification modes below).
4. Compute expected `cost_this_message` from counts and rate card; verify against reported cost.
5. Verify `cumulative` fields equal `previous_cumulative + this_message`.
6. Check `cost_cumulative` against session caps.
7. If any check fails or caps are exceeded → trigger `ABORT-BILLING`.

Step 3 is the only expensive step, and even it is cheap (see tokenizer verification below).

**Spot-check verification.** The buyer's client does not have to re-tokenize every response. Because every count is signed and chained, any lie is permanent evidence. Re-tokenizing 10% of turns randomly plus any turn where the count looks anomalous is enough to make fraud negative-EV for the seller. Same principle as probabilistic auditing in compliance work. The verification mode the buyer chooses (strict, spot-check, trust-only) is a client-side policy, not a protocol field.

---

## New Session Termination Reason: ABORT-BILLING

Existing termination reasons: CLOSE/CLOSE-ACK → SEAL, SEAL-UNILATERAL (timeout), EXPIRE (inactivity), ABORT (security event).

Add **ABORT-BILLING** (or extend ABORT with a billing sub-reason) for:

- Session cost cap exceeded.
- Per-message cost cap exceeded.
- Seller's reported count diverges from the buyer's verification beyond tolerance.
- Rate card hash in a response leaf does not match the session's rate card.

The abort leaf is signed by the buyer, chained into the Merkle tree, and carries a structured reason. Dispute resolution can route ABORT-BILLING cases to the arbitration path with all evidence already present in the chain: rate card, reported counts, the divergence, the cap that was breached.

**Routing in dispute logic.** ABORT-BILLING disputes are deterministic to resolve: rate card is hashed into every leaf, token counts are in every leaf, the tokenizer is declared and reproducible. The arbitrator re-runs the tokenizer over the content, re-computes the math, and the outcome is mechanical. This is the kind of dispute CELLO's architecture resolves cleanly.

---

## Tokenizer Verification: Three Modes

Token counts are tokenizer-dependent — a deterministic bytes→integer mapping. Given the same bytes and the same tokenizer, every participant gets the same count. The question is whether the buyer actually runs the tokenizer, and if so, where.

### Mode 1 — Local (preferred)

Tokenizer runs in the buyer's client, in-process, locally.

**Two sub-patterns:**

- **Bundled.** Client ships with the common tokenizers pre-installed. The universe is small: cl100k_base (GPT-4), o200k_base (GPT-4o), Llama SentencePiece, Mistral, Claude's tokenizer, a handful of HuggingFace BPE variants. Maybe 10–20 tokenizers cover 99% of practical use. Total footprint: roughly 100MB.
- **Lazy download.** Client ships with a hash-pinned manifest of known tokenizers but none pre-installed. When encountering a session declaring `tokenizer_id: o200k_base`, the client fetches it from a pinned URL (CELLO CDN, HuggingFace, or IPFS), verifies against the hash in the manifest, caches it locally, and runs it in-process. Per-tokenizer footprint: 5–10MB.

**Bundling is a deployment choice, not a protocol choice.** Mobile and embedded profiles should default to lazy download or a minimal bundled set. Desktop power users can ship everything. This is a client install-time / settings-level decision.

**Performance.** Tokenization is the cheapest step in the per-message pipeline:

| Step | Rough Cost |
|---|---|
| Network RTT | 50–200ms |
| DeBERTa scan (already required) | 20–100ms |
| Signature verify | 0.5–2ms |
| Merkle leaf hash + chain update | <1ms |
| **Tokenization** | **<1ms** |

Tiktoken and SentencePiece run at millions of tokens per second on a single CPU core. Verifying a 2000-token response takes tens of microseconds. The scan pipeline costs 20–100× more per message than tokenization.

**Privacy.** Full — bytes never leave the client.

### Mode 2 — Hosted CELLO Tokenizer API (opt-in)

For genuinely constrained environments — embedded agents, IoT, edge devices where WASM execution is not available or memory is severely limited — a CELLO-hosted tokenizer API is available as an opt-in service.

**The service contract:**

```
tokenize(content_bytes, tokenizer_id) → SignedTokenCountAttestation {
  tokenizer_id:     string
  tokenizer_hash:   bytes32
  input_byte_hash:  bytes32   // SHA-256 of content_bytes — proves the service processed exactly these bytes
  token_count:      int
  timestamp:        int
  signature:        bytes     // signed by the tokenizer service key
}
```

**Why `input_byte_hash` matters.** The signed response includes a hash of the input bytes, so the buyer's client can confirm the service processed *their exact bytes*. If the service returns a wrong count, the buyer has cryptographic proof. The service becomes a party whose attestations can be disputed via the existing Merkle arbitration pathway — not a new trust root, just another signed actor.

**Zero-retention architecture.** The zero-retention claim has to be architecturally true, not a policy promise. Requirements:

1. **Stateless compute only.** No database, no object storage, no queue. Request → tokenizer runs in-process → response → memory freed. Pure-function shape.
2. **No logging of content.** Logs contain `{request_id, tokenizer_id, byte_count, duration_ms, status}`. Never the bytes. Never the counts (counts plus tokenizer_id leak information).
3. **Ephemeral containers.** Lambda, Cloud Run, or Fargate per-request. Process dies after the request; platform reclaims memory. Zero retention is an infrastructure property, not a promise.
4. **TLS termination inside the compute environment.** Load balancers never see plaintext. Terminate inside the isolated container.
5. **Public attestation of the service itself.** Nitro Enclaves / SGX / equivalent TEE — the zero-retention claim becomes cryptographically verifiable. Weaker version: open-source service image with deterministic builds so third parties can audit that the deployed binary matches the published source. Enclave-backed is nicer; deterministic-build is operationally lighter. Either works.

**Operational concerns.**

- **DoS target.** Unauthenticated, free, arbitrary-bytes endpoints are magnets. Rate-limit per identity_key (identity is already established by FROST session). Consider requiring a small prepaid credit or Sybil-resistance proof. Effectively free for honest use, expensive for abuse.
- **Byte size limits.** Cap at the largest legitimate inference message size (a few MB). Above that is either abuse or misuse.
- **Regional deployment.** Route buyers to nearest region. Align with existing data residency framing — document as a PII-adjacent flow even though bytes are ephemeral.

**Protocol integration.** Exposed as one MCP tool: `tokenize_inference_content(content_bytes, tokenizer_id) → SignedTokenCountAttestation`. The buyer's client calls it when verifying an inference response, feeds the result into Layer 5 runtime governance, and retains the signed attestation locally as dispute evidence. Nothing about Merkle chaining or session structure changes.

**Privacy honesty.** When hosted mode is enabled, CELLO infrastructure sees individual message bytes ephemerally. Not persistent. Not aggregated. Not logged. But it is an expansion of CELLO's data access compared to every other protocol path, which sees only hashes. The buyer opts in per session; the client UI surfaces this clearly ("verification running on CELLO servers"). The commerce doc should be upfront about it rather than burying it.

**Invariant check.** The existing invariant "hash relay, not content relay" describes the directory and relay nodes in their core routing role. The hosted tokenizer is a distinct, optional service — a separate surface that buyers explicitly opt into. The invariant holds for the protocol's core path; the tokenizer service is labeled as an opt-in exception with its own privacy story.

### Mode 3 — Trust-Only

No tokenizer verification at all. Buyer accepts the seller's counts as reported. Disputes fall back to full CELLO arbitration: arbitrator re-runs the tokenizer over the Merkle-chained content, re-computes the math, returns a verdict.

Cheapest mode at runtime. Weakest protection in real time (caps still enforced against reported counts, but wrong counts are not caught until dispute). Appropriate for low-value inference from reputable, high-trust-signal sellers.

### Mode Selection

The verification mode is a **buyer-side client setting**, invisible to the seller. The rate card is identical across modes. The seller sees normal inference messages and normal ABORT-BILLING signals; they do not know whether the buyer is running the tokenizer locally, via the hosted API, or skipping verification.

Sensible defaults:

| Client Profile | Default Mode |
|---|---|
| Desktop power user | Local bundled |
| Mobile / constrained | Local lazy download |
| Embedded / IoT | Hosted opt-in, or trust-only |
| Default for new sessions with high-trust-signal sellers | Spot-check (local, 10% of turns) |
| Default for new sessions with untested sellers | Strict (local, every turn) |

---

## Sequencing

**Launch (Phase 1):**

1. Rate card extension in session policy.
2. Merkle leaf schema for inference responses (recommended, application-layer).
3. Layer 5 runtime governance hooks for inference cost caps.
4. ABORT-BILLING termination reason.
5. Local tokenizer verification (bundled + lazy download). Ship 10–20 tokenizers via hash-pinned manifest.
6. Trust-only mode as a fallback.

**Deferred:**

1. **Hosted tokenizer API.** Built when constrained-client demand is real and the operational footprint is better understood. The design is specified here; building it is future work. Not a day-one dependency.
2. **Promoting the Merkle leaf schema to first-class protocol fields.** If the inference vertical grows and dispute volume justifies it, move the schema from application-layer recommendation to protocol-level. Not a launch decision.

---

## Non-Goals

- Competing with OpenRouter or raw model inference marketplaces.
- Supporting token streaming.
- Proving computation correctness (zkML out of scope).
- Per-message tokenizer negotiation (tokenizer is fixed at session establishment; changes require a new session).

---

## What Did Not Need to Change

For the record — the following existing primitives support inference billing as-is and required no modification:

- Merkle leaf structure (structured metadata already supported).
- FROST session bookends (rate card is part of session establishment).
- Signature and hash chain (every leaf signs as normal).
- Dispute arbitration (Merkle tree + rate card hash + re-tokenization is deterministic).
- Layer 5 runtime governance (cost caps fit the existing spend/volume limit pattern).

The inference-billing work is a set of additions to documented behavior and two small new elements (rate card schema, ABORT-BILLING reason). No redesign of existing primitives.

---

## Open Items

- **Tokenizer allowlist policy.** Should the client refuse sessions that declare a non-standard tokenizer (strict, safer, limits some legitimate sellers), or accept any declared tokenizer and flag as unverifiable (permissive, trust-with-dispute fallback)? Recommend making it a client-side policy setting, not a protocol rule.
- **Rate card change within a session.** Currently: not allowed — close and re-establish. Is there a use case for dynamic rate adjustment mid-session? No obvious one, but worth surfacing if it comes up.
- **Cache discount accounting.** If the seller declares a `cache_discount` for cached prefix tokens, the `cached_input_tokens_this_message` field records how many were cache hits. The seller's reporting of this is trust-based today — the buyer cannot independently verify cache hits without replay infrastructure on their side. Acceptable: the incentive is for the seller to report accurately (higher cache hits = lower bill for the buyer = seller signals honesty). Worth monitoring in practice.
- **Commerce doc update.** The CAC / revenue streams doc should reflect token pricing for specialized inference (it already does — $0.01–$2 per query is compatible with token pricing at realistic rates and response sizes). The framing paragraph should change from "flat per-query" to "token-priced with signed running totals."

---

## Related Documents

- [[end-to-end-flow|CELLO End-to-End Protocol Flow]] — Part 6 (Conversation) and Part 7 (Prompt Injection Defense) cover the Merkle leaf structure and Layer 5 runtime governance this log extends
- [[prompt-injection-defense-layers-v2|Prompt Injection Defense Architecture]] — Layer 5 runtime governance is where inference cost caps are enforced
- [[2026-04-08_1530_message-delivery-and-termination|Message Delivery and Termination]] — session termination protocol that ABORT-BILLING extends
- [[2026-04-18_1407_push-publish-subscription-model|Push-Publish Subscription Model]] — prepaid-credit pattern that token-priced inference reuses
- [[2026-04-18_1620_commerce-attestation-and-fraud-detection|Commerce Attestation and Fraud Detection]] — signed purchase attestations; the inference rate card and response metadata are the inference-specific variant
- [[2026-04-14_1100_cello-mcp-server-tool-surface|CELLO MCP Server Tool Surface]] — the hosted tokenizer API would add one MCP tool to this surface
- [[2026-04-15_0900_session-level-frost-signing|Session-Level FROST Signing]] — rate card binding happens at the FROST session bookend
