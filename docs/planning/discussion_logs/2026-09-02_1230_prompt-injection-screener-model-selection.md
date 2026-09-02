---
name: Prompt Injection Screener Model Selection and Gateway Architecture
type: discussion
date: 2026-09-02
topics: [security, prompt-injection, gateway, models, licensing, architecture]
description: >
  Evaluation of lightweight prompt injection screening models for CELLO inbound content screening.
  Disqualifies non-commercial and AGPL-restricted models, reviews CELLO core gateway cascade architecture,
  and recommends patronus-studio/wolf-defender-prompt-injection-small v2 as primary backend screener with
  StackOne Defender as an alternative client edge option.
---

# 2026-09-02 - Prompt Injection Screener Model Selection and Gateway Architecture

## Context and Objective

CELLO screens inbound content before messages or shared documents reach an agent context window. In `cello-client/core/gateway`, screening runs through a deterministic Layer 1 sanitizer and an optional Layer 2 semantic ML classifier.

The legacy default target for Layer 2 was `protectai/deberta-v3-small-prompt-injection-v2`. However, ProtectAI archived `llm-guard` and its associated HuggingFace models in July 2026. Furthermore, DeBERTa v3 small has a 512-token context window limit, higher false positive rates on code and technical markup, and lacks multi-turn or long-context support.

This discussion log evaluates potential replacement models for CELLO's prompt injection screener, filters candidates strictly by commercial licensing, and confirms how the selected models align with CELLO's existing gateway cascade.

---

## Licensing Filter and Disqualifications

Commercial usability without viral license constraints is a strict prerequisite for CELLO core infrastructure. Any model carrying non-commercial clauses, copyleft obligations, or restrictive EULAs is disqualified from CELLO core adoption.

### Disqualified Models

1. **`sheltron-ai/prompt-guard-68m`**
   - License: CC BY-NC 4.0 (Non-commercial).
   - Verdict: Disqualified. Public weights cannot be deployed in commercial products or closed-source enterprise environments without violating license terms.

2. **`VigilGuard/vigil-llm-guard` (VGE PromptGuard v1g)**
   - License: CC BY-NC 4.0 (Non-commercial open weights).
   - Verdict: Disqualified. Commercial use requires purchasing Vigil Guard Enterprise.

3. **`Bastion Soft` (70M Tiny Variant)**
   - License: AGPL-3.0.
   - Verdict: Disqualified. Copyleft terms impose viral open-source licensing constraints on proprietary or enterprise client integrations.

4. **`Bastion Soft` (280M Multilingual Variant)**
   - License: Proprietary Commercial EULA.
   - Verdict: Disqualified for core open-weight baseline. Requires paid commercial software contracts.

5. **`protectai/deberta-v3-small-prompt-injection-v2`** (Legacy baseline)
   - Status: Project archived in July 2026 by ProtectAI.
   - Issues: 512-token context ceiling, English-only, high false positive rate (over-blocks legitimate code, JSON, and markdown formatting).

---

## Detailed Model Evaluation (Commercially Permissive Candidates)

### Candidate 1: `patronus-studio/wolf-defender-prompt-injection-small` (v2) (RECOMMENDED BACKEND)

- **Architecture / Base:** ModernBERT (mmBERT-small fine-tune).
- **License:** Apache 2.0 (Permissive commercial use).
- **Context Window:** 2,048 tokens.
- **Disk / Model Footprint:** 96.3 MB pre-quantized INT8 MatMul with asymmetric INT4 block embeddings (`onnx/int8_int4_embeddings/model.onnx`).
- **CPU Performance:** 5 ms to 15 ms on Apple Silicon / modern CPU; 20 ms to 35 ms for full 2,048-token inputs. Zero GPU dependency.
- **False Positive Handling:** Trained with hard-negative mining (NotInject dataset, documentation, code snippets, benign system prompt phrasing). Achieves 96.67% hard-benign specificity.
- **Why it fits CELLO:**
  - 2,048-token context accommodates P2P agent envelopes, tool invocation returns, and structured document blocks without truncating.
  - Apache 2.0 license permits unencumbered distribution inside `cello-client` and `cello-gateway`.
  - INT8/INT4 ONNX graph runs locally in-process via `onnxruntime` with minimal RAM overhead (~120 MB to 150 MB).

### Candidate 2: `StackOne Defender` (`@stackone/defender`) (RECOMMENDED EDGE / CLIENT OPTION)

- **Architecture / Base:** Fine-tuned MiniLM-L6 multi-head classifier bundled with regex normalization.
- **License:** Apache 2.0 (Permissive commercial use).
- **Context Window:** 512 tokens (operates via sentence-level splitting).
- **Disk / Model Footprint:** ~22 MB bundled ONNX graph inside npm package.
- **CPU Performance:** <10 ms per invocation after warmup.
- **Special Feature:** Multi-head classifier (`minilm-multihead-v5`). Auxiliary head evaluates whether text is meta-discussion or documentation *about* an injection versus an active execution attempt.
- **Why it fits CELLO:**
  - Excellent candidate for lightweight client-side edge screening or MCP tool output pre-filtering where a 22 MB package footprint is preferred.

### Other Commercially Usable Candidates Evaluated

1. **`hlyn-labs/prompt-injection-judge-deberta-70m`**
   - License: Gated Hugging Face access agreement.
   - Architecture: DeBERTa-v3-base compressed to 83 MB INT8 ONNX.
   - Evaluation: High precision (95.84%), but CPU latency (~100 ms on M1) is 5x to 10x slower than ModernBERT ONNX graphs, and context remains capped at 512 tokens.

2. **`meta-llama/Prompt-Guard-86M` / `Llama-Prompt-Guard-2-86M`**
   - License: Llama 3.1 / Llama 4 Community License (Gated).
   - Evaluation: Requires Hugging Face account tokens and Meta license acceptance. Baseline false positive rate of 3% to 5% requires application-specific temperature recalibration.

---

## Review of CELLO's Gateway Multi-Tier Cascade (`cello-client/core/gateway`)

Investigation of `cello-client/core/gateway` confirms that CELLO already implements a multi-tiered screening cascade:

1. **Tier 1: Deterministic Sanitization (`core/gateway/src/detect/sanitize.ts` & `inbound.ts`):**
   * **Unicode & Smuggling:** Strips zero-width codepoints, variation selectors, tag codepoints, and bidi override/isolate characters (`stripInvisible`).
   * **Confusables Normalization:** Applies NFKC normalization plus explicit Cyrillic and Greek to Latin lookalike mapping (`normalizeConfusables`).
   * **Special Token Stripping:** Removes chat-template delimiters (`<|im_start|>`, `[INST]`, etc.).
   * **Decoding Inspection:** Decodes percent-encoding, HTML entities, and `\x`/`\u` escapes for scan-time inspection (`decodeEncoded`).
   * **Language Allowlist:** Checks script allowlists via `screenInboundLanguage`.

2. **Tier 2: Semantic ML Classifier (`core/gateway/src/detect/injection-scanner.ts`):**
   * Pluggable in-process ONNX sequence classification via `InjectionScanner`.
   * Score-governed thresholds (`BLOCK_THRESHOLD = 70`, `FLAG_THRESHOLD = 35`).
   * Graceful degradation: If the model or ONNX runtime is absent, Layer 2 turns off safely while Layer 1 remains active.

---

## Implementation Plan for CELLO Core Gateway

To update CELLO's prompt injection screener:

1. **Update Model Target in `core/gateway`:**
   - Point `model-installer.ts` and `injection-classifier-onnx.ts` to `patronus-studio/wolf-defender-prompt-injection-small` (`onnx/int8_int4_embeddings/model.onnx`).
   - Update model hash verification and tokenizer configuration for ModernBERT / mmBERT.

2. **Expand Context Handling:**
   - Increase gateway token truncation limit from 512 tokens to 2,048 tokens.
   - For long document payloads exceeding 2,048 tokens, use overlapping sliding windows (2,048 tokens with 64-token overlap) and normalized Smooth-Max score aggregation.

3. **Maintain Graceful Degradation:**
   - Preserve the existing policy: If the local ONNX weights are not downloaded, Layer 1 deterministic sanitization continues to enforce, while Layer 2 reports unavailable without jamming message or document transport.
