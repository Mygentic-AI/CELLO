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
| 3. Guardrail field — INBOUND | ❌ PENDING — cut off by session limit; resume after reset |
| 4. Infisical — whole-repo governance mining | ❌ PENDING — cut off by session limit; resume after reset |

**Resume plan (after the limit resets):** re-dispatch the two pending sweeps with the
same exhaustive prompts (recorded in §3/§4 stubs below), then write §5 (the mapping of
all harvested capability onto CELLO's six layers + governance tier).

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

## §3 — Guardrail field: INBOUND techniques & controls (❌ PENDING)

**Cut off by the account session limit. Re-run after reset.** Exhaustive prompt: catalog
ALL inbound techniques — every LLM Guard INPUT scanner; NeMo input rails; Guardrails AI
input validators; the full prompt-injection/jailbreak technique catalog (direct/indirect,
role-play/DAN, payload splitting, obfuscation/encoding, multi-turn/crescendo,
invisible-Unicode/ASCII-smuggling, many-shot, system-override markers, tool/RAG poisoning),
each with mechanism + control; the COMPLETE Microsoft Presidio entity list (~50, named);
model-based classifiers (Llama Guard, ShieldGemma); red-team tooling (garak, promptfoo).
Output organized as INBOUND techniques & controls, to map onto CELLO Layers 1–2.

---

## §4 — Infisical: whole-repo governance mining (❌ PENDING)

**Cut off by the account session limit. Re-run after reset.** Repo
`/Users/andrep/Documents/code/infisical`. Exhaustive prompt: mine the ENTIRE codebase for
every security/governance concept CELLO could adopt — PII lib (have it: `backend/src/lib/pii/`),
secret-scanning architecture (data-source/resource/findings model, gitleaks/CLI integration,
fingerprinting, dedup, ignore/allowlist, scan lifecycle), audit-logging design (taxonomy,
retention, tamper-evidence, streaming), access control (RBAC/ABAC, permissions, scoping),
approval/change-request workflows (M-of-N, time-bound access), secret lifecycle (rotation,
dynamic secrets, leasing, versioning), encryption-at-rest/KMS/envelope patterns, rate
limiting, input sanitization patterns, webhook HMAC, IP allowlisting, MFA/session. Each with
file path + what it does + how CELLO uses it. Output exhaustive, grouped by theme.

> NOTE: Infisical delegates actual secret *rules* to the `infisical` CLI (which wraps
> gitleaks) via `execFile("infisical", …)` in `secret-scanning-v2-fns.ts` — so the
> rule dictionary is §1 (gitleaks), not the Infisical backend. The Infisical mining is for
> ARCHITECTURE (audit, RBAC, approvals, scan lifecycle, encryption), not the detector list.

---

## §5 — Mapping onto CELLO's six layers + governance (❌ PENDING §3/§4)

To be written once §3 and §4 land. Will map every harvested capability onto: Layer 1
(sanitization — incl. inbound+outbound invisible-Unicode), Layer 2 (scan), Layer 3
(outbound gate — full gitleaks dictionary + generic/entropy + structured-channel scanning +
canary tokens), Layer 4 (redaction — full secret set + Presidio entity expansion), Layer 5
(governor — volume/scope), Layer 6 (deny-all), and the governance/audit/extensibility tier
(Infisical audit/RBAC/approval patterns). Flags which existing M9 stories absorb each
capability and which need NEW stories (invisible-Unicode both directions, canary tokens,
full secret dictionary, expanded entity set, governance workflows).
