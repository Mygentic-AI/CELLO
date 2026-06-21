---
name: M9 Capability Harvest — Everything Usable from gitleaks, Infisical, and the Guardrail Field
type: reference
date: 2026-06-21
milestone: M9
status: in-progress
description: >
  The comprehensive harvest for M9's security & governance layer. Mandate (Andre,
  2026-06-21): NOT a triaged minimal set — bring in EVERYTHING usable, inbound and
  outbound, from gitleaks (full 222-detector ruleset), the Infisical repo (whole-repo
  governance mining), and the LLM-guardrail field (every inbound + outbound technique).
  Assembled from three deep sweeps. TWO sweeps (inbound field catalog, Infisical
  whole-repo) were cut off by the account session limit and are marked PENDING with a
  resume plan — do not treat their sections as complete.
---

# M9 Capability Harvest

**Operating principle (this whole effort):** comprehensiveness IS the quality bar for a
security layer. Every credential type or exfil vector left out is a hole. Bring in
everything usable; sequence later. (See memory `feedback_comprehensive_not_minimal`.)

## Status of the three sweeps

| Sweep | Status |
|---|---|
| 1. gitleaks — full ruleset + engine | ✅ COMPLETE (below, §1) |
| 2. Guardrail field — OUTBOUND | ✅ COMPLETE (below, §2; from the 2026-06-21 outbound scan) |
| 3. Guardrail field — INBOUND | ✅ COMPLETE (below, §3) |
| 4. Infisical — whole-repo governance mining | ✅ COMPLETE (below, §4) |

**All four sweeps complete.** §5 maps everything onto CELLO's six layers + governance tier.

---

## §1 — gitleaks: the complete detection capability (✅)

Source `/tmp/gitleaks-ref/config/gitleaks.toml` (default config, minVersion v8.25.0).
**License: MIT** — adopt freely, retain the copyright notice. RE2 engine (no
lookaround/backrefs) — same engine CELLO already uses for the Infisical PII patterns.

**Adopt the whole thing, not a subset.** 222 detectors. CELLO's current Layer 3/4 names ~7.

### All 222 detectors by category

**Cloud / IaaS (10):** aws-access-token (`AKIA|ASIA|…`), aws-amazon-bedrock-api-key-long-lived (`ABSK`), aws-amazon-bedrock-api-key-short-lived, gcp-api-key (`AIza`), azure-ad-client-secret (`…Q~…`), alibaba-access-key-id (`LTAI`), alibaba-secret-key, yandex-access-token (`t1.`), yandex-api-key (`AQVN`), yandex-aws-access-token (`YC`).

**AI / LLM providers (8):** anthropic-admin-api-key (`sk-ant-admin01-`), anthropic-api-key (`sk-ant-api03-`), openai-api-key (`sk-…T3BlbkFJ…`), cohere-api-token, huggingface-access-token (`hf_`), huggingface-organization-api-token (`api_org_`), perplexity-api-key (`pplx-`), privateai-api-token.

**Version control (24):** github-app-token (`ghu_/ghs_`), github-fine-grained-pat (`github_pat_`), github-oauth (`gho_`), github-pat (`ghp_`), github-refresh-token (`ghr_`); gitlab-cicd-job-token (`glcbt-`), gitlab-deploy-token (`gldt-`), gitlab-feature-flag-client-token (`glffct-`), gitlab-feed-token (`glft-`), gitlab-incoming-mail-token (`glimt-`), gitlab-kubernetes-agent-token (`glagent-`), gitlab-oauth-app-secret (`gloas-`), gitlab-pat (`glpat-`), gitlab-pat-routable, gitlab-ptt (`glptt-`), gitlab-rrt (`GR1348941`), gitlab-runner-authentication-token (`glrt-`), gitlab-runner-authentication-token-routable, gitlab-scim-token (`glsoat-`), gitlab-session-cookie (`_gitlab_session=`); bitbucket-client-id, bitbucket-client-secret; sourcegraph-access-token (`sgp_`).

**Payment / fintech / crypto-exchange (24):** stripe-access-token (`sk_/rk_ live/test`), square-access-token (`EAAA/sq0atp-`), coinbase-access-token, bittrex-access-key, bittrex-secret-key, kraken-access-token, kucoin-access-token, kucoin-secret-key, plaid-api-token (`access-…`), plaid-client-id, plaid-secret-key, finicity-api-token, finicity-client-secret, finnhub-access-token, flutterwave-encryption-key, flutterwave-public-key (`FLWPUBK_`), flutterwave-secret-key (`FLWSECK_`), gocardless-api-token (`live_`), freshbooks-access-token, lob-api-key, lob-pub-api-key, duffel-api-token (`duffel_`), shippo-api-token (`shippo_`), easypost-api-token (`EZAK`), easypost-test-api-token (`EZTK`).

**Communications / messaging / email / webhooks (33):** slack-app-token (`xapp-`), slack-bot-token (`xoxb-`), slack-config-access-token, slack-config-refresh-token, slack-legacy-bot-token, slack-legacy-token, slack-legacy-workspace-token, slack-user-token (`xoxp-`), **slack-webhook-url**, **microsoft-teams-webhook**, telegram-bot-api-token (`{digits}:A…`); discord-api-token, discord-client-id, discord-client-secret; facebook-access-token, facebook-page-access-token (`EAAM/EAAC`), facebook-secret; twitter-access-secret, twitter-access-token, twitter-api-key, twitter-api-secret, twitter-bearer-token (`A…`); mailchimp-api-key (`…-us##`), mailgun-private-api-token (`key-`), mailgun-pub-key (`pubkey-`), mailgun-signing-key, sendgrid-api-token (`SG.`), sendinblue-api-token (`xkeysib-`), intercom-api-key; messagebird-api-token, messagebird-client-id, sendbird-access-id, sendbird-access-token, mattermost-access-token, gitter-access-token, twitch-api-token, beamer-api-token (`b_`), flickr-access-token.

**Databases / data-infra (12):** planetscale-api-token (`pscale_tkn_`), planetscale-oauth-token (`pscale_oauth_`), planetscale-password (`pscale_pw_`), clickhouse-cloud-api-secret-key (`4b1d`), databricks-api-token (`dapi`), confluent-access-token, confluent-secret-key, airtable-api-key, airtable-personnal-access-token (`pat….`), mapbox-api-token (`pk.`), maxmind-license-key (`_mmk`), kubernetes-secret-yaml (`kind: Secret` + base64 — path-gated).

**Package registries (9):** npm-access-token (`npm_`), pypi-upload-token (`pypi-AgEI…`), rubygems-api-token (`rubygems_`), clojars-api-token (`CLOJARS_`), nuget-config-password (path-gated), artifactory-api-key (`AKCp`), artifactory-reference-token (`cmVmd`), jfrog-api-key, jfrog-identity-token.

**Monitoring / observability / CI quality (19):** datadog-access-token, new-relic-browser-api-token (`NRJS-`), new-relic-insert-key (`NRII-`), new-relic-user-api-id, new-relic-user-api-key (`NRAK-`), grafana-api-key (`eyJrIjoi…`), grafana-cloud-api-token (`glc_`), grafana-service-account-token (`glsa_`), sentry-access-token, sentry-org-token (`sntrys_`), sentry-user-token (`sntryu_`), sumologic-access-id (`su`), sumologic-access-token, dynatrace-api-token (`dt0c01.`), codecov-access-token, sonar-api-token (`squ_/sqp_/sqa_`), snyk-api-token, cisco-meraki-api-key.

**PaaS / hosting / infra / secrets-mgmt (30):** heroku-api-key, heroku-api-key-v2 (`HRKU-AA`), netlify-access-token, digitalocean-access-token (`doo_v1_`), digitalocean-pat (`dop_v1_`), digitalocean-refresh-token (`dor_v1_`), scalingo-api-token (`tk-us-`), flyio-access-token (`fo1_/fm…`), fastly-api-token, cloudflare-api-key, cloudflare-global-api-key, cloudflare-origin-ca-key (`v1.0-`), pulumi-api-token (`pul-`), hashicorp-tf-api-token (`.atlasv1.`), hashicorp-tf-password (path-gated), octopus-deploy-api-key (`API-`), droneci-access-token, travisci-access-token, harness-api-key (`pat./sat.`), settlemint-application-access-token (`sm_aat_`), settlemint-personal-access-token (`sm_pat_`), settlemint-service-access-token (`sm_sat_`), vault-batch-token (`hvb.`), vault-service-token (`hvs.`), doppler-api-token (`dp.pt.`), 1password-secret-key (`A3-`), 1password-service-account-token (`ops_eyJ`), infracost-api-token (`ico-`), prefect-api-token (`pnu_`), defined-networking-api-token (`dnkey-`), openshift-user-token (`sha256~`).

**Private keys & crypto material (5):** **private-key** (PEM `-----BEGIN … PRIVATE KEY-----`), pkcs12-file (`.p12/.pfx` path), age-secret-key (`AGE-SECRET-KEY-1`), **jwt** (`ey….ey….sig`), jwt-base64 (`ZXlK…`).

**Generic / high-entropy catch-alls (4 + sidekiq pair):** **generic-api-key** (the universal catch-all — see engine §1b), curl-auth-header (Authorization in curl), curl-auth-user (`curl -u user:pass`), sidekiq-secret / sidekiq-sensitive-url (`{8hex}:{8hex}` contribsys).

**Misc SaaS (35):** adafruit-api-key, adobe-client-id, adobe-client-secret (`p8e-`), algolia-api-key, asana-client-id, asana-client-secret, atlassian-api-token (`ATATT3`), authress-service-client-access-key, contentful-delivery-api-token, dropbox-api-token, dropbox-long-lived-api-token, dropbox-short-lived-api-token (`sl.`), etsy-access-token, frameio-api-token (`fio-u-`), freemius-secret-key (path), hubspot-api-key, launchdarkly-access-token, linear-api-key (`lin_api_`), linear-client-secret, linkedin-client-id, linkedin-client-secret, looker-client-id, looker-client-secret, nytimes-access-token, notion-api-token (`ntn_`), okta-access-token (`00…`), postman-api-token (`PMAK-`), rapidapi-access-token, readme-api-token (`rdme_`), shopify-access-token (`shpat_`), shopify-custom-access-token (`shpca_`), shopify-private-app-access-token (`shppa_`), shopify-shared-secret (`shpss_`), squarespace-access-token, typeform-api-token (`tfp_`), zendesk-secret-key, intra42-client-secret (`s-s4t2…`), twilio-api-key (`SK…`).

### §1b — Engine features to adopt wholesale

- **`[[rules]]` structure:** `id`, `description`, `regex` (RE2), `secretGroup` (which capture group is the secret), `entropy` (min Shannon entropy of the extracted group — the biggest false-positive lever, 1.0–4.5 in this config), `keywords` (lowercase substring **pre-filter** — the regex only runs if a keyword is present; the performance backbone at 222 rules), `path` (path regex; some rules are path-only), `[[rules.required]]` (composite rules — primary fires only if auxiliary rules match within `withinLines`/`withinColumns` proximity).
  Pipeline order to replicate: **keywords pre-filter → regex → secretGroup extraction → entropy gate → allowlist suppression → (composite proximity) → finding.**
- **`generic-api-key` — the novel-secret catch-all (the single most important rule to port).** Matches any secret-ish trigger word (`access|auth|api|credential|creds|key|passwd|password|secret|token`) within ~50 chars before an assignment operator (`=`,`:`,`=>`,`||`,`?=`,`,`), captures a 10–150-char value (or base64 ≥12), and requires **entropy ≥ 3.5**. This catches credentials for services with no dedicated detector. Ships with three false-positive layers: (1) drop pure-word captures (`^[a-zA-Z_.-]+$`); (2) a large `regexTarget="match"` exclusion alternation (`api_version`, `public_key`, `csrf_token`, `*_endpoint/url`, …); (3) a **~1,400-entry stopword list** of common dev nouns checked against the extracted secret.
- **Allowlist mechanism (precision layer — porting rules without it floods false positives):** global `[[allowlists]]` + per-rule `[[rules.allowlists]]`; suppress on ANY match; `condition` OR/AND; `paths`, `commits`, `regexes` + **`regexTarget`** (`secret`|`match`|`line` — the key knob: value-allowlisting vs context-allowlisting), `stopwords` (substring vs extracted secret), `targetRules` (apply a shared allowlist to named rules).
- **Global allowlist + stopwords concept (reusable assets):** placeholder-value stripping (`true/false/null`, `$VAR`, `${{ }}`, `{{ }}`, `%s`, repeated chars), binary/lockfile/vendored-path skips, and the ~1,400-word stopword denylist. The stopword list is the cheapest precision mechanism (substring check, no regex) — adopt verbatim and grow from your own false positives.

### §1c — Adoption notes for a chat/message context (vs gitleaks' native git-scanning)

- **Port verbatim (the large majority):** all prefix/format rules — they match the token shape itself, context-independent, high precision (`sk-ant-*`, `ghp_`, `AKIA`, `AIza`, `xoxb-`, `hf_`, PEM private key, JWT, `shpat_`, `SG.`, …). Keep their keyword pre-filter (pure performance).
- **Tune entropy/keywords before porting:** the keyword-proximity family (`(?i)…VENDOR…=…value`) + `generic-api-key` + `curl-auth-*` assume `key = "value"` source idioms. In prose, raise the entropy gate (to ~3.5–4) and KEEP the full stopword + allowlist layer; for `generic-api-key` these are mandatory, not optional. Consider entropy ~4 for chat.
- **Drop / replace path-only rules:** `pkcs12-file`, `freemius-secret-key`, `nuget-config-password`, `hashicorp-tf-password`, `kubernetes-secret-yaml` rely on filenames; replace path gates with content gates or drop. The global allowlist's path entries also don't apply — replace with message-appropriate suppression (e.g. don't double-scan fenced code blocks, ignore known placeholders).
- **Keep regardless:** the global placeholder-stripping regexes and the stopwords concept — content-based, exactly what prevents prose false positives.

**Net for CELLO:** populate "the configured secret pattern set" (the empty extension point already named in SCAN-003 + REDACT-001) with the FULL gitleaks ruleset, port the `generic-api-key` + entropy + stopword machinery (reusing the Layer-1 entropy scorer), and bring the allowlist precision layer. That takes secret coverage from ~7 to 222 + a catch-all for the unknown.

---

## §2 — Guardrail field: OUTBOUND techniques & controls (✅)

From the 2026-06-21 outbound scan. CELLO Layer 3 already specifies the URL/markdown/HTML/CSS
exfil pattern set (AC-005..007) — solid. The output-scanner reference and the gaps:

**Reference output scanners:** LLM Guard outputs — `sensitive` (Presidio+regex secrets/PII), `malicious_urls`, `url_reachability`, `regex`, `ban_code`, `ban_competitors`, `ban_substrings`, `ban_topics`, `bias`, `code`, `deanonymize`, `factual_consistency`, `gibberish`, `json`, `language`, `no_refusal`, `reading_time`, `relevance`, `sentiment`, `toxicity`. NeMo output rails + Presidio detect/mask. Guardrails AI: `DetectPII`, `secrets_present`, `competitor_check`, toxic/profanity/gibberish/NSFW. Rebuff + Vigil: **canary tokens** (sentinel in system prompt; block on appearance → prompt-leak detection).

**Outbound vectors to cover (ranked by risk for an agent↔agent channel):**
1. **Invisible-Unicode / ASCII smuggling** (Tags block U+E0000–E007F, variant selectors, zero-width) — invisible on the wire, survives human review, the *receiving* agent re-interprets it. CELLO strips inbound (Layer 1) but NOT outbound → asymmetric hole. Fix: strip Tags/variant-selector/zero-width on egress.
2. **Markdown/HTML image zero-click exfil** — CELLO specifies it; verify the pattern set is complete and prefer URL **domain allowlist** over pattern-blocking.
3. **Tool-call / structured-arg / envelope-metadata leakage** — if Layer 3 scans only prose, structured channels are unscreened. Fix: scan tool args / JSON / metadata too.
4. **Encoded-payload exfil (base64/hex)** — defeats format-regex. Fix: outbound entropy + decode-then-rescan (same entropy mechanism as gitleaks generic rule — converges).
5. **System-prompt / instruction leakage** — fix: canary tokens (cheap, deterministic).
6. **Hyperlink exfil** — CELLO specifies it; domain allowlist.
7. **PII beyond 5 types** — adopt Presidio's ~50-entity set (see §3 PENDING for the full list).
8. **Output-volume / bulk-dump anomaly** — no volume check; fits the Layer 5 governor.
9. **Deterministic toxicity/bias** alongside the (bypassable) LLM self-check.

Sources: protectai/llm-guard, NeMo Guardrails (Presidio), Guardrails AI Hub, Rebuff, Vigil,
Embrace The Red (markdown-image + ASCII-smuggling), Cisco (Unicode tag injection), OWASP
LLM02/05/06 2025.

---

## §3 — Guardrail field: INBOUND techniques & controls (✅)

Defenses applied to content ARRIVING at an agent (Layers 1–2). Bring all of it in.

### §3a — Input scanners by library (the reference sets to mirror)

**LLM Guard — 16 input scanners:** Anonymize (Presidio+DeBERTa NER PII redact+vault), BanCode, BanCompetitors, BanSubstrings, BanTopics (zero-shot NLI), Code (per-language), EmotionDetection, Gibberish, **InvisibleText** (zero-width/tag chars — no model), Language (allowlist), **PromptInjection** (`protectai/deberta-v3-base-prompt-injection-v2`), Regex, **Secrets** (Yelp detect-secrets), Sentiment (VADER), TokenLimit (tiktoken), Toxicity.

**NeMo Guardrails — input side:** input rails (mask/reject/pass, `parallel:True`); `self_check_input` (main LLM judges, yes=block, fail-closed); **jailbreak heuristics** — Length/Perplexity (threshold 89.79) + Prefix/Suffix Perplexity (1845.65, catches GCG suffixes); model-based jailbreak (random-forest on arctic-embed + NemoGuard JailbreakDetect NIM); Presidio detect/mask on input. Shipped integrations: Llama Guard 3 / ShieldGemma / Nemotron Content Safety, ActiveFence, AutoAlign, Fiddler, Prompt Security, Cisco AI Defense, Pangea, CrowdStrike, GCP Text Moderation, Clavata, GLiNER-PII, Private AI, Regex, HF classifier.

**Guardrails AI Hub — input validators:** DetectJailbreak (MiniLM embeddings + RoBERTa + saturation detector), DetectPromptInjection (wraps Rebuff), Arize Dataset Embeddings, UnusualPrompt (LLM-judge); ToxicLanguage/ToxicLanguageLLM, ProfanityFree, NSFWText, GibberishText; DetectPII/GuardrailsPII/SecretsPresent; RestrictToTopic, SensitiveTopics, BanList; hosted LlamaGuard 7B / ShieldGemma 2B.

**Rebuff — 4 layers (canonical injection defense):** (1) heuristics (verb×adjective×object combinatorial, SequenceMatcher, thr 0.75); (2) dedicated detection LLM (thr 0.90); (3) **vector DB of prior attacks** (Pinecone, top_k=20, thr 0.90); (4) **canary tokens** (8-hex in invisible HTML comment; appearance in output = injection confirmed; `log_leakage` feeds the vector DB → self-hardening).

**Vigil:** YARA signatures, vector-DB similarity (ChromaDB), transformer injection scanner (deberta), prompt-response similarity (goal-hijack), 16-char canary tokens, relevance, sentiment.

### §3b — Injection / jailbreak technique catalog (25, each with its control)

Taxonomies: HackAPrompt (2311.16119), Greshake indirect (2302.12173), Spotlighting (2403.14720), Instruction Hierarchy (2404.13208), OWASP GenAI, MITRE ATLAS.

1. **Direct injection** ("ignore previous…") → instruction-hierarchy, spotlighting, input classifier. 2. **Context-termination** (fake end-delimiter) → datamarking, randomized/secret delimiters. 3. **Prefix/repetition/style injection** → hierarchy, repetition heuristics. 4. **Indirect injection via retrieved content** (RAG/web/email/docs/tool output/image-alt — can "worm") → segregate+mark untrusted, dual-LLM/quarantine+CaMeL, output-action gating, lethal-trifecta rule. 5. **Confused-deputy / RAG poisoning** → provenance/authorization, permission-aware retrieval, source allowlist. 6. **DAN/persona** → persona-robust refusal, DAN-corpus classifiers. 7. **Virtualization/story framing** → intent-level classification, output filter. 8. **Crescendo** (multi-turn escalation) → conversation-level monitoring, cumulative-trajectory filter. 9. **Many-shot** (long-context faux dialogues) → context-length-aware safety, scrub demonstration blocks. 10. **Skeleton Key** (augment-not-replace) → output filter regardless of "warning" framing. 11. **Context overflow/saturation** → length limits, truncation. 12. **Payload splitting/Defined-Dictionary** → evaluate fully-resolved prompt, output filter, dual-LLM. 13. **Encoding/cipher** (base64/hex/ROT13/Morse/leetspeak) → decode-then-filter, refuse high-entropy non-NL input, classify decoded result. 14. **Translation/low-resource-language** → multilingual classifiers, translate-then-filter, flag mismatch. 15. **Typos/glitch tokens** → normalization, tokenizer-aware filter, semantic classifier. 16. **ASCII smuggling / Unicode Tags (U+E0000–E007F) / zero-width / homoglyph / bidi** → **Unicode normalization + stripping before the model**, char-range allowlist, homoglyph canonicalization. 17. **Special-token / chat-template spoofing** (`[SYSTEM]`, `<|im_start|>`, `### Instruction`) → strip/escape reserved tokens at serialization, spotlighting. 18. **Instruction-in-data ("data as code")** → dual-LLM/quarantine, CaMeL, provenance. 19. **Tool/function-call/MCP poisoning** (description+schema+return-value) → least-privilege tool allowlist, app-holds-tokens, human-in-loop, sign/pin MCP servers. 20. **Multimodal injection** (image text/OCR/white-on-white/EXIF/audio) → OCR+same filters+spotlighting on extracted content. 21. **Refusal suppression / affirmative priming** → output classifiers on content not phrasing. 22. **Prompt leaking / system-prompt extraction** → never put secrets in system prompt, output filter for echo, canary tokens. 23. **GCG adversarial suffixes** → **perplexity filters** (canonical), paraphrasing/retokenization, SmoothLLM. 24. **Best-of-N / random augmentation** → rate limiting / repeated-query monitoring, input normalization. 25. **Competing-objectives / mismatched-generalization / recursive** → robust alignment, intent classification, output gating.

### §3c — Microsoft Presidio: the FULL entity set (~95, doubles the docs' ~50)

Authoritative source = `predefined_recognizers/` (docs lag). **Global:** CREDIT_CARD (Luhn), CRYPTO (BTC), DATE_TIME, EMAIL_ADDRESS, IBAN_CODE (mod-97), IP_ADDRESS, MAC_ADDRESS, NRP, LOCATION, PERSON, PHONE_NUMBER, MEDICAL_LICENSE (DEA), URL. **USA:** ABA_ROUTING_NUMBER, US_BANK_NUMBER, US_DRIVER_LICENSE, US_ITIN, US_MBI, US_NPI, US_PASSPORT, US_SSN. **UK:** UK_NHS (mod-11), UK_NINO, UK_PASSPORT, UK_POSTCODE, UK_VEHICLE_REGISTRATION, UK_DRIVING_LICENCE. **ES:** ES_NIF, ES_NIE, ES_PASSPORT. **IT:** IT_FISCAL_CODE, IT_DRIVER_LICENSE, IT_VAT_CODE, IT_PASSPORT, IT_IDENTITY_CARD. **DE:** BSNR, FUEHRERSCHEIN, HANDELSREGISTER, HEALTH_INSURANCE, ID_CARD, KFZ, LANR, PASSPORT, PLZ, SOCIAL_SECURITY, TAX_ID, TAX_NUMBER, VAT_ID. **PL:** PESEL. **SG:** NRIC_FIN, UEN. **AU:** ABN, ACN, TFN, MEDICARE. **IN:** PAN, AADHAAR (Verhoeff), VEHICLE_REGISTRATION, VOTER, PASSPORT, GSTIN. **FI:** PERSONAL_IDENTITY_CODE. **CA:** SIN (Luhn). **KR:** RRN, FRN, BRN, DRIVER_LICENSE, PASSPORT. **NG:** NIN, VEHICLE_REGISTRATION. **TH:** TNIN. **TR:** NATIONAL_ID, LICENSE_PLATE. **PH:** TIN. **ZA:** ID_NUMBER (Luhn). **SE:** PERSONNUMMER, ORGANISATIONSNUMMER. **Medical NER:** DISEASE_DISORDER, MEDICATION, THERAPEUTIC_PROCEDURE, CLINICAL_EVENT, BIOLOGICAL_ATTRIBUTE/STRUCTURE, FAMILY_HISTORY, HISTORY.
**Architecture to adopt:** AnalyzerEngine → RecognizerRegistry → NlpEngine (spaCy/Stanza/Transformers NER); PatternRecognizer (regex) + `validate_result()` **checksum hooks** (Luhn / mod-97 / mod-11 / Verhoeff); **LemmaContextAwareEnhancer** (boosts score on nearby context words like "SSN:", "card"); deny-list recognizers; extensible via subclass / ad-hoc / RemoteRecognizer / GLiNER zero-shot.

### §3d — Model-based classifiers (4 distinct types — not substitutes)

- **Meta Prompt Guard (the inbound-relevant one):** Prompt-Guard-86M v1 (mDeBERTa, **3 labels BENIGN/INJECTION/JAILBREAK** — INJECTION=untrusted third-party content, JAILBREAK=direct user → maps exactly onto CELLO's relayed-vs-direct trust split); Llama-Prompt-Guard-2-86M (multilingual, ~92ms, binary); **Llama-Prompt-Guard-2-22M (DeBERTa-xsmall, ~19ms, CPU — lowest-overhead inline)**.
- **Meta Llama Guard** (harm taxonomy, NOT injection): v3 14 categories S1–S14 (⚠️ S-codes shift across versions — pin the model). **Google ShieldGemma** (harm: dangerous/harassment/hate/sexual; v2 image).
- **deepset/deberta-v3-base-injection** (INJECTION/LEGIT), **protectai/deberta-v3-base-prompt-injection v1/v2** (SAFE/INJECTION — LLM Guard's default), fmops DistilBERT, Epivolis Hyperion, Vijil ModernBERT.
- **Attack generators (CI gate, NOT runtime):** garak (probes: promptinject, dan, encoding, latentinjection, suffix, gcg, sysprompt_extraction, leakreplay, xss, smuggling…); promptfoo red-team (plugins + strategies: base64/hex/rot13/homoglyph/best-of-n/crescendo/citation…). **Commercial guards:** Lakera Guard (+ Gandalf/PINT), Azure Prompt Shields, AWS Bedrock Guardrails PROMPT_ATTACK, GCP Model Armor, HiddenLayer, Cisco/Robust Intelligence.

**Directly applicable to CELLO Layers 1–2 (per-message, inline, no-LLM-friendly):** the small encoder classifiers — **Llama Prompt Guard 2 22M (DeBERTa-xsmall, ~19ms, CPU)** + protectai/deepset DeBERTa — align with the existing M8/M9 DeBERTa-v3-small INT8 Layer-2 design. Prompt Guard v1's INJECTION-vs-JAILBREAK split = "untrusted relayed content vs direct operator input." Llama Guard / ShieldGemma add an orthogonal harm-category axis.

---

## §4 — Infisical: governance architecture (✅)

The secret RULES live in gitleaks (§1; Infisical shells out via `execFile("infisical","scan")`).
This is the ARCHITECTURE harvest — patterns, with file path + CELLO use.

1. **Secret-scanning lifecycle** (`ee/services/secret-scanning-v2/`) — `DataSource→Resource→Scan→Finding` model; status enum `unresolved/resolved/false-positive/ignore`; `execFile` (no shell — injection-safe), exit-77 = "found" treated as success; **the secret value is stripped before persistence** (store rule+offset+fingerprint+location, never the payload); fingerprint = natural-key dedup that **preserves triage status across re-scans**; BullMQ queue + per-source distributed lock; full-scan vs diff-scan; provider-factory map. *CELLO:* governance findings as `agent→session→scan→violation`; store rule+offset of an injection finding, NEVER the malicious prompt; full-vs-diff = periodic agent re-eval vs per-message hook; per-node lock (sovereignty); severity (rule) vs disposition (4-state) separated.

2. **Audit logging + SIEM** (`ee/services/audit-log*`) — **~606-member typed event enum**, each event with a strongly-typed metadata interface (compile-time "required context fields"); table partitioned by `createdAt`; actor model; retention TTL + batched prune. **GAP: NOT hash-chained or signed — trust-the-database.** Pluggable SIEM streaming factory (Splunk/Datadog/Azure/Cribl/custom; KMS-encrypted creds; SSRF + CRLF-injection guards; `allSettled`; 5s never-throw); Redis-buffered ClickHouse micro-batch. *CELLO:* copy the typed taxonomy (turns observability ACs into compile-time guarantees) + the streaming factory; **CELLO improvement = chain+sign the stream so the SIEM is a verifying party**; never let an event vanish without a chain entry/tombstone. This unsigned-audit gap is exactly what CELLO's directory hash chain closes.

3. **Access control — CASL ABAC** (`ee/services/permission/`, `lib/casl/`) — `{action, subject, conditions}`; per-subject action enums (even `DescribeSecret` vs `ReadValue` split); packed rules in DB, concatenated **deny-last** (explicit deny wins); Handlebars `{{identity.metadata.x}}` interpolation = ABAC; two-level scope (org vs project = separate ability objects); **`validatePermissionBoundary` = a CASL-subset prover: you cannot grant a privilege you don't hold** (escalation-proof delegation, ~318 lines); assume-privilege (re-auth every request). *CELLO:* the authorization primitive for connection-policy / "who may request what of a peer"; packed CASL connection policies in local SQLite, deny-last so a revoked-trust signal overrides any allow; **the boundary-prover is a drop-in escalation-proof check for agent→sub-agent delegation**; assume-privilege re-done with FROST/Ed25519 signing, not a shared secret.

4. **Approval workflows** (`services/approval-policy/`) — three enums `Request/Step/Grant` (the request is the workflow; the **Grant is the authorization, carrying `expiresAt`+status**); M-of-N + sequential steps (parallel within a step); secret change-requests = **git-PR semantics** (staged diff, **three-way conflict detection on merge**, edit resets prior reviews); break-glass = bypasser allowlist + mandatory reason + loud fan-out audit; `Soft/Hard` enforcement; most-specific-wins policy scoping (deterministic score → all nodes resolve the same policy without coordination). *CELLO:* the workflow scaffolding around the existing FROST crypto; `PolicyChangeRequest→Grant`; keep FROST `t` (crypto) decoupled from `requiredApprovals` (governance); **staged-changeset + conflict-on-merge directly answers CELLO's known policy-change-approval-gate need**; Soft/Hard separates root-key governance (Hard/TUF) from operational policy; mutation-invalidates-partial-signatures defeats sign-benign-then-swap.

5. **Secret lifecycle** (`ee/services/secret-rotation-v2/`, `dynamic-secret/`, `folder-commit/`) — rotation: **two-slot make-before-break** (`activeIndex` flip → no signing gap) + callback-inversion transactionality; **delayed-queue-job AS the TTL timer** (`jobId=leaseId`, `delay=expiry`); versioning (monotonic rows; restore = new forward version); **point-in-time = a git-style commit graph** (commits + change-rows + periodic materialized checkpoints + delta-replay; `revertCommit` never rewrites history); RE2 reference resolver with **permission-check during resolution**. *CELLO:* rotation-factory for FROST-share/transport/signing-key rotation; two-slot = share rotation without a signing gap (per-node, sovereign); job-as-TTL = time-bound grants/sessions without polling; **the commit-graph + signed-checkpoints + delta-replay is the near-perfect tamper-evident state-history template — upgrade the plain `commitId` to a hash-chained, node-signed id; `reconstructState` proves an agent's past share-state for disputes.**

6. **Encryption & key hierarchy** (`lib/crypto/`, `services/kms/`) — 4-level envelope (env→root→org/project KMS→DEK); **closure-bound DEK** (plaintext key never escapes the encrypt/decrypt closure); blob `[IV(12)|ct|tag(16)|version(3)]`; FIPS singleton-swap **keeping the wire format** (mixed-FIPS federation interop); PQC **signatures** (ML-DSA/SLH-DSA via side-OpenSSL, graceful fallback) — **no ML-KEM (gap)**; external-KMS 4-method provider (AWS+GCP, **no Azure — gap**); HSM root-wrap + encrypt-then-HMAC + `CKR_PIN_INCORRECT` bail; KMIP. *CELLO:* closure-bound DEK for `EnvelopeKeyProvider`; version as a named parsed field; copy the external-KMS provider and **add the Azure provider** (Choice invariant); FIPS swap behind `SigningKeyProvider`; **extend PQC to ML-KEM (FIPS 203) for transport — CELLO's real quantum exposure is key-agreement (harvest-now-decrypt-later), which Infisical hasn't addressed**; do NOT copy the 128-bit utf8 legacy key.

7. **Abuse / webhooks / MFA / IP / sharing / honey tokens** — rate limiting (named presets, Redis-shared cross-region, per-plan dynamic `max`, **key on token not IP**); **RE2 everywhere + `sanitizeString(tokens)` error-redaction (~40 sites) + AST-allowlist for templates + DNS-resolve-every-hop SSRF**; webhook HMAC **`t=<ts>,v1=<sig>` over `ts.body` + `timingSafeEqual` + 5-min window** (the repo's strongest scheme); **version-counter revocation** (increment invalidates all outstanding JWTs — no denylist); `setItemWithExpiryNX` single-use nonce/OTP claim; `DUMMY_HASH` constant-time (no existence oracle); IP allowlist via kernel `net.BlockList`; secret-sharing (256-bit opaque id, encrypt-at-rest, expiry + **atomic view-count decrement**, password); **honey tokens** (`ee/services/honey-token/` — a decoy zero-privilege credential planted as a real-looking secret; detection via CloudTrail→subscription-filter→trigger; **one-alert-per-24h cooldown**; `t=,v1=` signed trigger). *CELLO:* rate-limit keyed on peer-id/agent-identity, limits signed into the manifest; `sanitizeString` before ANY error reaches an MCP `guidance` field or the ops agent; standardize ALL signed callbacks on `t=,v1=`; **version-counter revocation = "Not Me"/rotation/succession as one increment, instant across regions, no shared denylist**; `setItemWithExpiryNX` extends the existing nonce-dedup; **honey tokens answer the known CELLO story need — a decoy identity/share, the directory/relay IS the tripwire (no central phone-home), trigger = a hash-chain event + ops-agent alert, federated so no SPOF.**

8. **Bonus — the AI-MCP governance gateway** (`ee/services/ai-mcp-endpoint/`) — Infisical already proxies agent/MCP traffic through a governed endpoint that enforces: **tool allowlisting (default-deny)**, **RE2 PII request/response redaction** (`lib/pii/index.ts` — the exact EMAIL/PHONE/SSN/CREDIT_CARD/IP_ADDRESS set; **validates CELLO's Layer 1/4 plan directly**), per-call activity log, generic-error-to-client (no leakage), OAuth+PKCE. **This is almost exactly CELLO's M9 gateway shape.** Plus gateway/relay **mTLS** (per-org ephemeral CA hierarchy, KMS-wrapped TTL'd per-identity relay creds) → directly reusable for CELLO relay-node security.

**Cross-cutting primitives (clean drop-ins):** RE2 everywhere untrusted input is parsed; `timingSafeEqual` + `DUMMY_HASH`; `setItemWithExpiryNX`; version-counter revocation; enum→factory dispatch maps (scanning/rotation/KMS/SIEM/honey); closure-bound key material; job-as-TTL + signed-checkpoint+delta-replay state history; the `t=,v1=` signing scheme for all callbacks. **The one categorical CELLO win:** Infisical's audit log is unsigned — CELLO's directory hash chain is strictly better.

---

## §5 — The prune pass: what we actually keep (decision framework)

§1–§4 are the **laundry list** (gather-everything, done). This section is the **decision
layer** — read through and keep only what we truly want or need. It is NOT a "bring it all
in" mapping. Decisions are made WITH Andre, capability by capability, story by story.
Seeded below with Andre's stated principles + early calls (2026-06-21); the rest is filled
in during the collaborative read-through.

### Design principles (Andre)

1. **Not onerous.** A normal message must go out with near-zero customization. If guardrails
   force the operator to configure exceptions just to talk to a peer, that's a failure.
2. **Balanced default posture.** The most obvious / lowest-harm checks are ALLOWED by
   default; the most onerous / highest-harm are OFF by default (opt-in).
3. **Every block is legible + recoverable.** When anything is blocked or redacted, the
   sender is told WHAT, WHY, and given an explicit option + instructions to unblock/override.
4. **Inbound ≠ outbound.** Inbound (protect THIS agent from injection) can be stricter and
   more automatic; outbound (govern what leaves) must not mangle legitimate messages.

### Early prune calls (Andre)

- **Tool allowlists → OUT / N/A.** By the time `cello_send` runs, the LLM has already
  decided and called the tool — CELLO is not an MCP tool-mediating proxy, so Infisical's
  tool-allowlist (and the field's "tool governance") doesn't map to the send path. *(A
  distinct "what a peer may request of you" capability model belongs to connection-policy /
  Layer 6 — a different mechanism, not this.)*
- **Path detection → detect-and-NOTE, default-allow.** Sending a colleague a shared-folder
  path is a legitimate everyday message; blunt path-blocking breaks real use. Heuristically
  distinguish internal-secret paths (`/var/secrets/...`) but default to allow + note, not
  block. (Nitty-gritty to work out.)
- **KEEP (core, non-negotiable):** outbound PII + secret protection; inbound injection
  defense. These are the spine; everything else is weighed against principles 1–2.

### Open decisions for the read-through (each a real choice, with options)

- **A. Outbound response model — per detected category, pick:** (a) block whole message;
  (b) full redact → `[REDACTED_SECRET]`; (c) partial mask (first4/last4); (d) pass + warn.
  *Andre's question: redact-and-indicate? first4/last4? does it ever block the whole
  message?* — Proposed starting point: redact-and-indicate for PII/secrets (full placeholder
  in the DELIVERED text; first4/last4 surfaced to the SENDER as a note so they know which
  item was caught — not in the delivered message); block-whole-message reserved for the
  narrow case where the message is primarily an exfiltration/attack and redaction can't make
  it safe; always with unblock instructions. Decide per category.
- **B. Block vs redact for secrets.** CELLO's current SCAN-003 BLOCKS on a secret while
  REDACT-001 also redacts it (SI-003 says redaction ≠ blocking). Reconcile: which categories
  block, which redact?
- **C. Default-on vs default-off per capability.** Tag every §1–§4 capability: on-by-default
  / opt-in / out — against principles 1–2.
- **D. Partial-reveal safety.** first4/last4 is safe for long high-entropy keys but leaks
  short/low-entropy secrets. Decide the reveal policy per category (probably: type label +
  last4 only, never first chars for short secrets).
- **E. Inbound strictness.** How automatic/strict on inbound (where onerousness matters less
  because it protects the operator, and the sender — not the operator — bears any friction).

> This section is intentionally undecided. It is the agenda for the prune, not its outcome.

---

## §6 — The governance feedback channel (decision, Andre 2026-06-21)

**Decision:** the governance layer is not silent. Every action it takes on a message is
reported back to the calling LLM, so the LLM always knows the delta between *what it sent*
and *what actually left*. The mechanism is a **publish channel, structurally like the
injected Logger** — any outbound stage (base layer or hook) can publish a governance event;
each event is **blocking or non-blocking**.

### The publish primitive (parallel to `Logger`)

An injected `GovernanceChannel` (sender-side). Each stage calls `publish(event)`; the
pipeline driver aggregates, decides control flow by disposition, and renders the result.
**One publish, three consumers:** (1) control flow, (2) the `cello_send` result to the LLM,
(3) the security pass record / hash chain (audit). This is why it mirrors logging — producers
are decoupled; they don't know how the event is consumed.

```
GovernanceEvent {
  stage:       string         // 'layer4.redact.secret', 'hook:acme-dlp'
  disposition: 'observe' | 'redact' | 'block'   // non-blocking | non-blocking-mutating | blocking
  category:    string         // 'secret:openai_api_key', 'pii:email', 'exfil:image_url', 'path'
  reason:      string         // LLM-readable why
  senderDetail?: string       // e.g. type label + last-4 fingerprint (sender's view only)
  guidance:    string         // what the LLM can do next, incl. how to override
  override?:   string         // per-item handle the LLM passes on retry to force THIS item
}
```

### Disposition → behavior

- **`observe`** (non-blocking) — advisory note; message unaffected. (paths, dollar amounts,
  lone entropy hits — Tier 3.)
- **`redact`** (non-blocking, mutating) — message altered; the event records what/why; the
  delivered message carries a typed placeholder. (PII, secrets — Tier 1.)
- **`block`** (blocking) — first block short-circuits the pipeline; message never leaves.
  (primary-exfiltration / compromised-output — Tier 2.)

### What the LLM receives from `cello_send`

- **Blocked:** `{ ok: false, reason: 'blocked_by_governance', blocks: GovernanceEvent[], guidance }`
  — "this message was NOT sent; blocked for these reasons …"; it never left the LLM, so the
  LLM knows it failed and why, and how to override.
- **Redacted (delivered):** `{ ok: true, delivered: true, modified: true, transformations: GovernanceEvent[], guidance }`
  — message went out in ALTERED form; the LLM knows the exact delta, so it can adapt future
  behavior and explain to the counterparty ("sending this, but the system redacted the API
  key"). *(Specifics to the SENDER — not just a count. V3's receiver envelope gives the
  receiver a count + notes; this is the sender-side surface V3 under-specifies.)*
- **Clean:** `{ ok: true, delivered: true, modified: false }`.

### Relationship to V3

V3's `SecurityResponse {verdict, content, notes, record_hash}` is the gateway→client
contract; the `GovernanceChannel` is the **internal publish primitive that produces it**, and
the `cello_send` tool result is the **client→LLM surface** V3 leaves thin on the sender side.
This fills that gap and gives the pipeline the same producer/consumer decoupling logging has.
**General mechanism, both directions:** inbound governance reports to the receiving LLM via
the `cello_receive` `security_context` (already in V3); this §6 is the outbound mirror.

### Sub-decisions still open

- **Counterparty-visible redaction marker?** The AGENT can narrate the redaction itself (from
  the feedback); should the SYSTEM also leave a minimal marker (`[redacted by sender policy]`)
  so the receiver isn't confused by a gap? (Lean yes, minimal.)
- **Override granularity:** per-item `override` handle (force just the false positive, keep
  other redactions) vs whole-message `force:true`. (Lean per-item.)
- **One bus or two?** Governance events are a typed subset that ALSO route to the caller +
  hash chain; likely one publish primitive, governance-tagged, not a separate Logger.

### Blocking vs non-blocking — RESOLVED (Andre 2026-06-21): BLOCKING

`cello_send` blocks on the governance verdict (clean/redacted/blocked) and returns it inline.
Network DELIVERY stays async (the existing ACK ladder / retry queue); a human-approval HOLD
is the one async escape hatch (returns `held`+handle, resolved later).

**The never-hang guarantee (what makes blocking safe).** A blocking call must always return a
terminal result inside a hard deadline — a timeout is a *verdict*, not a hang. Same discipline
as DOD-SIG-1 ("distinct reason + guidance, bounded, never silent/hang") and SCAN-003 SI-002
("check failure → block, never pass"), applied to slowness as well as errors:

1. **Per-stage bounds.** Sync hooks: `timeout_ms`+`on_timeout` (V3). Base layers: RE2
   (linear-time — kills the ReDoS hang class) + bounded DeBERTa compute + per-stage watchdog.
2. **One total-pipeline deadline** — a single wall-clock ceiling for the whole outbound pass;
   no stage bug or input can exceed it.
3. **CELLO's total deadline sits BELOW the agent host's tool-call timeout** — so CELLO always
   answers first with an actionable verdict, never a generic host-level "tool timed out."
4. **IPC/transport hops bounded** — cello-mcp→daemon→gateway each timed out →
   `gateway_unavailable` / `daemon_timeout` + guidance.
5. **Timeout/error → terminal §6 event** — `disposition: block`, `reason: governance_timeout`
   (or `gateway_unavailable`) + guidance + override handle. The LLM always gets a structured
   answer.
6. **Fail-closed by default, made rare + loud.** Timeout → block (fail-open would enable a
   DoS-to-bypass: induce a timeout to slip content past unscreened). Kept non-onerous via
   rare timeouts (per-stage bounds + RE2 + fast deterministic base) + a **circuit breaker**
   (persistent gateway timeouts → short-circuit to fail disposition immediately + ops-agent
   alert "governance degraded") + operator-tunable degraded-mode policy per deployment
   (personal may fail-open low-harm checks; enterprise fails closed).
