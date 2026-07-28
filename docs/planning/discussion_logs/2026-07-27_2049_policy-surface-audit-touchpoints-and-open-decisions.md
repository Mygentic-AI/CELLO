---
name: policy-surface-audit-touchpoints-and-open-decisions
type: discussion
date: 2026-07-27
topics: [policy, screening, contacts, tiers, security-governance-layer, config, settings, storage, control-surface, m7, m8, m8b, m8c, m9, m10, m11]
status: active
description: >
  Audit of every point in CELLO where a policy is supposed to exist — inbound admission, trust-signal
  admission, the security and governance layer, relay/offline, directory/federation — with what is built,
  what is planned, and what is missing, verified against the code rather than the plan. Includes the
  finding that the security and governance layer is never instantiated in the shipped daemon (live proof:
  `security.gateway.connected mode:"passthrough"`), Andre's storage invariant (everything lives in the
  database, full stop), and the corrected list of open design decisions, each written with enough context
  to be recognisable months later.
---

# Policy Surface Audit — touchpoints and open decisions

## Why this document exists

Andre, 2026-07-27:

> There are a number of different points where there are supposed to be policies in place. For example,
> the policies around accepting an inbound session request. What is the level of this person? Are they in
> the blocked category, unknown, whitelisted, VIP? What's your policy? Do you have policies for a specific
> person or address? And on the governance layer, what's your policy regarding what must be included and
> what's not. We haven't done this work. We've thought about it, we've planned it, we've created the
> appropriate places to insert these things, but we haven't actually done it.

That assessment is broadly right, with one important correction and one important exception:

- **The correction.** More is *built* than the framing suggests — the contact tier system, the
  tier-graduated abuse bounds, the away-message resolution ladder, and the trust-signal floor are all
  built, reviewed, and in some cases live-certified.
- **The exception, and it is a large one.** The **security and governance layer is built and completely
  disconnected.** Not partially wired — never instantiated. See §0.

The scope of this audit: milestones M7, M8, M8B, M8C, M9, M10, M11, the policy-bearing discussion logs,
and then every claim checked against the code in `cello-client` and `trustless-cello`.

## A note on naming

This document says **"the security and governance layer"** because that is what Andre calls it and it is
what the thing is. The code and the older planning documents call it **"the gateway"** (`core/gateway`,
`SecurityGatewayClient`, `screenInbound`/`screenOutbound`, `spawnGatewaySidecar`, `M9-CFG-001`'s "the
gateway owns its config"). *Gateway* is a vague word that has caused real ambiguity — in the M9 documents
it means, variously, the screening program, the process boundary, and the config owner. Where a code
symbol is quoted below the original name is kept, because that is what greps for.

---

## 0. The finding that precedes everything else

**The security and governance layer never runs in the shipped product.**

Andre's mental model going into this session was *"the security layer is always on — when you log in it's
already on."* The seam is always on. The layer behind it is not connected to anything.

### The evidence

1. `core/daemon/src/daemon.ts:248`
   ```ts
   const securityGateway: SecurityGatewayClient = config.securityGateway ?? new PassthroughGatewayClient();
   ```
   `PassthroughGatewayClient` is an always-allow stub. It returns a verdict so the seam has something to
   consume; it screens nothing.

2. `config.securityGateway` is the **only** injection point. The daemon's composition root
   (`core/daemon/src/bin/cello-daemon.ts`) never sets it — the `startDaemon({...})` call passes
   `celloDir`, `socketPath`, `lockFilePath`, `maxConnections`, `version`, `logger`,
   `directoryEndpointResolver`, the manifest deps, `registryPubkey`, `registryPollScheduler`. No gateway.

3. `LocalSidecarGatewayClient` — the real adapter, the one that talks to the screening process over its
   socket — is constructed in exactly four places, **all of them test files**:
   `m9-gate-1.test.ts`, `m9-core-001-seam.test.ts`, `gateway-sidecar.test.ts`, and its own definition.

4. `spawnGatewaySidecar` — the function that launches the screening process — has **zero** non-test
   callers.

5. **Live proof, from Andre's own daemon log** (`~/.cello/daemon.log`, every boot, most recent
   2026-07-25):
   ```json
   {"level":"info","event":"security.gateway.connected","mode":"passthrough","ts":"2026-07-25T05:41:14.011Z"}
   ```
   The daemon announces its own mode at startup. It has been saying `passthrough` all along.

### What this means concretely

Everything M9 built is inert in the product: inbound sanitization (invisible-character strip, RE2
patterns, entropy scoring, encoded-payload decode), the injection matcher, the language allowlist,
outbound secret detection and redaction (the full 222-rule gitleaks dictionary), the PII whitelist and
bulk-dump warning, outbound rate limiting, the four governance dispositions, the config store, and the
hash-chained security-pass records. All of it is written, unit-green, and gate-green. None of it executes.

### How this got marked done

`M8C-DEFINITION-OF-DONE` → `DOD-M9INT-1` is ✅ with the note *"gateway switched on, seam green."* The
gate it cites, `m9-gate-1.test.ts`, spawns a real screening process and injects a real
`LocalSidecarGatewayClient` — **the test does the wiring the product doesn't.** So the gate proved the
layer works when connected, and nobody noticed that only the test connects it. The DoD line is about the
*seam*; the seam genuinely is wired and genuinely does call `screenInbound`/`screenOutbound` at
`ingestReceivedContent` and `cello_send`. It calls them on a stub.

This is the single highest-value item in this document. It is not a build — everything it needs already
exists. It is wiring.

---

## 1. Inbound admission — "who gets in, and how loudly"

### 1.0 The two design documents contradict each other

This must be resolved before any of §1 can be specified, so it goes first.

- **`discussion_logs/2026-07-07_1700_four-level-screening-policy.md`** (2026-07-07, Andre, `status:
  decided`). Four levels of unknown-sender treatment, escalating by notification intrusiveness:
  **L1 Ignore** (silence — *"not queued, no notification, no trace"*), **L2 Queue-silent**, **L3 Queue +
  notify-on-return**, **L4 Fast-track**. Known contacts are always L4; for unknown senders the operator
  picks 1/2/3.

- **`user-stories/m8c/2026-07-08_inbound-state-matrix.md`** (2026-07-08, one day later, `status: active`)
  opens by declaring the first document replaced: *"This document completely replaces that 1D model."* It
  is a 4×4 matrix — sender relationship (Unknown / Known / Whitelisted / VIP) against receiver
  availability (Offline / Online-DND / Online-Unattended / Online-Attended) — and it explicitly forbids
  silence: *"We cannot just silently drop the TCP connection (opaque silence). Doing so breaks the
  network's UX by leaving the sender hanging."* Its answer is the **Generic Reject**: a cryptographic
  rejection receipt saying *"this agent does not accept inbound connection requests and will not see your
  request."*

L1 and Generic Reject are mutually exclusive answers to the same question. Neither document acknowledges
the conflict. What actually shipped is the *data model* of the second document (the tier column, the
bounds grid, the away-message ladder) and the *behaviour* of neither.

### 1.1 The touchpoints

| # | Touchpoint | State | Kind | Evidence |
|---|---|---|---|---|
| 1.1 | Sender tier `blocked < unknown < known < whitelisted < vip` | ✅ built | data + setting | `core/daemon/src/contacts-tier-migration.ts` |
| 1.2 | Tier-graduated abuse bounds (max concurrent sessions per sender, max received bytes per session), INV-TIER-BOUND — a tier may raise a bound, never remove one | ✅ built, operator-overridable | setting | `session-node-manager.ts`, `agent-settings-keys.ts` |
| 1.3 | A BLOCKED sender is refused indistinguishably from an unknown one (cap 0 — same refusal path, no oracle) | ✅ built | code | `session-node-manager.ts:1401` |
| 1.4 | `isContact()` split into `isKnown()` (display) / `isAutoAccept()` (policy); promotion to `known` happens on **engagement**, not on the standing receiver's automatic accept | ✅ built (DEC-AB-3) | code | address-book build log |
| 1.5 | Away-text resolution: per-contact → per-tier → agent-default → system default, total and deterministic; the resolved text is screened outbound | ✅ built | setting + code | `resolveAwayMessage` |
| 1.6 | **Receiver availability state machine** — the matrix needs four states | ❌ only *attended* vs *not attended* exists. **There is no DND / "closed" state at all.** | code | — |
| 1.7 | **The 4×4 matrix itself** | ❌ not implemented. Today's behaviour: accept if under the tier's bound, and vary the wording of the auto-ack by tier. | code | — |
| 1.8 | **`Generic Reject` protocol frame** | ❌ not built. Refusals happen server-side while the initiator still sees `ok:true` — proven live in `M8C-AB-TEST-ROUND-2` R4 (a 4th session was refused with `abuse_bound_sessions_per_sender` and the initiator was told it succeeded). | protocol | — |
| 1.9 | L1 Ignore / opaque privacy mode | ❌ parked (M8C D15) — *and contradicted by 1.0* | setting | — |
| 1.10 | L3 notify-on-return (proactive wake when the operator comes back) | ❌ the one genuinely new primitive in the 4-level design; also what the M8C "2b" live test needed | code | — |
| 1.11 | Per-agent selector for how unknown senders are treated | ❌ parked on `DOD-CONFIG-1` (M8C D14) | setting | — |
| 1.12 | Session-request TTL | ✅ 24h hardcoded, expiry visible via the inbox; per-agent configurability parked (M8C D17) | setting | — |
| 1.13 | **Blocking is inbound-only** — `initiate_session` does not refuse a BLOCKED target. The tier is read there, but only to decide whether to *disclose trust signals* (KNOWN+ gets them). | ❌ asymmetry | code | `outbound-sessions.ts:183` |
| 1.14 | Operator-in-the-loop accept | ❌ none. There is no accept/decline tool in the 28-tool MCP surface. The standing receiver accepts everything under bound; the operator finds out afterwards. | code | MCP tool list |

### 1.2 What the tier work already fixed

Worth recording, because it was the sharpest live defect of the M8C era and it is closed. The
2026-07-07 log documents that the **inbound-accept path auto-added the requester to the contact
whitelist** (`daemon.ts:4418`), so any stranger who knocked once was promoted to fast-track forever —
which defeated the screening layer *and* the ABUSE-1 anti-spam caps simultaneously (a removed Ms_Chelly
opened four sequential sessions to CELLO_Support with no refusal). DEC-AB-3 replaced accept-promotes with
engagement-promotes, and the tiered bounds replaced "known contacts are exempt entirely." Both root
causes are gone.

---

## 2. Trust-signal admission (M10)

| # | Touchpoint | State | Kind |
|---|---|---|---|
| 2.1 | `SignalRequirementPolicy` — the deterministic floor. Predicates on **envelope fields only** (type string, issuer_kind, count, expiry, revocation, age). LLM/config discretion layers on top and may only *restrict*, never widen. | ✅ built (`DOD-FLOOR-1`) | policy code |
| 2.2 | Selective disclosure by tier when presenting signals | ✅ built (KNOWN+ receives them) | code |
| 2.3 | Round-2 demand bundle — the receiver may answer "fine, but also provide X"; then accept or decline, no third round | ✅ built | protocol |
| 2.4 | **Who sets the floor?** `DEFAULT_UNKNOWN_POLICY` is a hardcoded constant. There is no per-agent, per-tier floor an operator can express. | ❌ | setting |
| 2.5 | Freshness (spec §14.7): past-TTL + directory unreachable → disclosed staleness, *"tier policy decides — established contacts proceed, unknowns are refused"* | ⚠️ the tier policy it defers to does not exist | policy code |
| 2.6 | Revocation — an endorser withdraws; a receiver who already accepted the signal must be able to learn it is no longer vouched for | ❌ open (address-book design §5) | protocol |

---

## 3. The security and governance layer (M9)

Everything here is downstream of §0. It is all built; none of it runs.

| # | Touchpoint | State | Kind |
|---|---|---|---|
| 3.1 | Versioned config store: append-only rows, hash-chained fingerprints, **tighten-free / loosen-needs-confirmation** | ✅ built (`core/gateway/src/config/config-store.ts`) — but only consulted when `CELLO_GATEWAY_CONFIG_DB` is set, and nothing sets it | code |
| 3.2 | **The config key space is five keys**: `autonomous_override`, `pii_whitelist`, `language_allow`, `rate_max_per_window`, `rate_window_ms` | ⚠️ every other guard is hardcoded and therefore not expressible as policy at all: which inbound checks run, entropy thresholds, the 70/35 injection-score cut-offs, size caps, block-vs-flag | setting |
| 3.3 | **Environment variables sit underneath the store as defaults** — `cfg("autonomous_override", process.env["CELLO_GATEWAY_AUTONOMOUS_OVERRIDE"] === "1")`. So `CELLO_GATEWAY_AUTONOMOUS_OVERRIDE=1` loosens a guard with no confirmation and no versioned row. | ❌ hole in the loosen-confirm gate | code |
| 3.4 | `DOD-CONFIG-1` — `cello config list/get/set` | ❌ parked (M8C D14). No `config` command exists in the CLI. | control surface |
| 3.5 | The human-confirmation channel for a loosening (M9-CFG-001 says "WebAuthn in the real flow") | ❌ the store enforces a `confirmed` flag; nothing in the product produces one | control surface |
| 3.6 | `allow_once` / `allow_always` re-send decisions | 🟡 plumbed end-to-end (MCP tool param → daemon → `OutboundScreener.applyDecisions`). `allow_once` is honoured only when `autonomous_override` is on. `allow_always` is defined as *persist to the whitelist* = a config loosening = needs 3.5, which doesn't exist. | policy code |
| 3.7 | Override policy engine — CASL deterministic rules for when `allow_*` is permitted, plus an isolated LLM judge for the residual | ❌ named and parked as Day 2 | policy code (LLM) |
| 3.8 | **Hook engine** — operator-supplied checks at defined positions, HMAC auth, observe/gate/redact capabilities | ❌ Day 2. **This is the only extension point in the entire system for an operator's own policy — including any LLM-based policy. Nothing else accepts one.** | policy code (LLM seam) |
| 3.9 | Language allowlist (English default, confident-only, allow on short/low-confidence) | 🟡 built + unit-tested, not wired live — needs terminal-block inbound handling | setting |
| 3.10 | DeBERTa injection scanner | 🟡 verdict logic + installer built; the real model deferred by decision (568 MB, to be built *with* the runtime infra, not blind) | policy code (model) |
| 3.11 | Config and records written **unencrypted, outside the encrypted database** | ❌ `DOD-CRYPTO-AT-REST-1` — see §6, Andre has now ruled on this | storage |
| 3.12 | INV-2 — *"not a moderation tool."* No toxicity / sentiment / bias / emotion / topic policing. The layer defends identity, injection, and data exfiltration only. Moderation is Day 2, via the hook engine or upstream in the agent, **never first-party CELLO logic.** | ✅ stated boundary | product position |

---

## 4. Offline and relay

| # | Touchpoint | State | Kind |
|---|---|---|---|
| 4.1 | Relay store-and-forward eligibility **by tier** — the matrix grants only Whitelisted and VIP the privilege of occupying relay space for an offline recipient; Unknown and Known get a Generic Reject | ❌ this is the safe form of closing the D19 hole; the relay-park authentication is designed (`m8c/2026-07-12_sec-1-relay-park-authentication-design.md`), the tier gate is not | protocol + policy |
| 4.2 | Who answers on behalf of a fully offline agent — the matrix's first column requires the **relay** to evaluate the receiver's policy | ❌ requires the policy to be *published* somewhere the relay can read it. That surface does not exist, and it is a privacy question in its own right (§7, D-13). | protocol |
| 4.3 | Operator-pushed blocklist to the relay, so blocked traffic dies before it reaches the operator's machine | ❌ design only (`discussion_logs/2026-07-04_edos_rate_limiting.md`) | protocol |

**Context for 4.x:** every screening level from L2 upward only queues if the agent was **online (even if
unattended)** when the stranger knocked. A fully offline agent bounces the sender with
`counterparty_unavailable` and nothing is queued. So "I'll check my messages when I come back" only ever
catches what arrived while the daemon was up. For a support-style agent taking cold inbound around the
clock, this is the whole game.

---

## 5. Directory and federation

| # | Touchpoint | State | Kind |
|---|---|---|---|
| 5.1 | **Suspension = the kill switch.** Portal suspends → directories refuse to participate in FROST signing → the compromised agent cannot act. | ✅ built (M8 LEVER-001), step-up gated, burn-never-erases — but **never live-verified end-to-end**. It is launch-triage item #9 and part of the safe-launch bar. Harness anchor exists: `j-suspend-tofn`. | policy code |
| 5.2 | Step-up authentication per sensitive operation; the recoverable TOTP floor; factor removal requires step-up | ✅ built + live-proven both directions (M8 AUTH-002/006) | policy code |
| 5.3 | Registration admission — who may register at all | ⚠️ de facto the M11 waitlist, which is portal-side. The directory itself is permissionless by design. | product position |
| 5.4 | Directory / relay rate limiting keyed on **cryptographic identity** rather than IP | ❌ nothing built. The design (`2026-07-04_edos_rate_limiting.md`) covers per-agent limits, global circuit breakers, reputation-scaled limits, and hard blocklists — all for the "agent sells a service and a looping counterparty drains its LLM credits" case. | policy code |
| 5.5 | Service-contract / rate-policy publication in the directory manifest (*"max 5k tokens/day per DID; unverified DIDs max 500"*) | ❌ design only | protocol |
| 5.6 | Presence visible to whitelisted contacts only | ❌ deferred (M8C D16). Verified: the directory has **zero** awareness of contacts — the whitelist is client-local. Gating presence needs a new cross-repo protocol *and* a privacy model for what the directory learns about an agent's contact list. | protocol |
| 5.7 | Threshold `T = majority(N)` | ✅ **SETTLED — never reopen** | product position |

---

## 6. Storage — Andre's ruling, 2026-07-27

> **"Everything should be in the database, because the database is what we would back up. Anything that's
> not in the database is a mistake. It was probably a decision made by an agent without understanding the
> invariant."**
>
> **"All the settings, everything. There is nothing that is outside of it."**

This settles what I had listed as an open question ("one policy store or two?"). It is not open. The
invariant is:

> **INV-POLICY-STORAGE — every setting and every policy lives in the database. The database is the backup
> unit. State outside it is a defect, not a design choice.**

Different **tables** by usage is fine and expected — reachability policy and screening policy are
different domains and will not share a table. Different **files outside the database** is not.

### What violates this today

1. **The security and governance layer's config store and record store** — `core/gateway/src/config/
   config-store.ts` and `records/record-store.ts` open plaintext `node:sqlite`, a separate file from the
   daemon's encrypted database. Tracked as `DOD-CRYPTO-AT-REST-1` in `M8C-DEFINITION-OF-DONE`. Both files
   carry a comment justifying plaintext on the grounds that "the daemon does the same" — which stopped
   being true on 2026-06-25. This is exactly the case Andre describes: an agent's decision that did not
   understand the invariant. Note also that `node:sqlite` is separately VERBOTEN in this project.

2. **The `~/.cello/` loose-file inventory.** Beyond the two databases (`client.db`, `sessions.db`) the
   directory holds `current-agent` (a settings-shaped file — the selected agent, plain text),
   `consortium-manifest.json`, and four key files (`key`, `directory-key`,
   `directory-transport-key`, `sessions.db.key`). The key files are a genuine chicken-and-egg exception —
   the key that opens the database cannot live inside the database it opens — but they should be named as
   a deliberate exception rather than left as ambient state. `current-agent` and the manifest have no such
   excuse.

3. **State is already split across two databases** (`client.db` and `sessions.db`) before any of this.
   Worth an explicit decision about which one is the settings home rather than letting a third appear.

### The tension this creates — and it is real

M9's `INV-4` says the layer's config lives in *"its own SQLCipher file (same library as the daemon,
**separate file + separate key** — no ATTACH to the daemon DB)"*, and `M9-CFG-001`'s security invariant
`SI-001` states the config store *"shall not be readable or writable with the daemon's key."* The threat
model behind that is the **company deployment**: the employee controls the daemon but must not be able to
weaken the guards their employer set. Separate key = a compromised or merely disgruntled client cannot
open the policy store.

Andre's invariant says one backed-up database. `SI-001` says a separate key the daemon does not hold.
Both are correct about their own threat, and they cannot both be satisfied naively. This is now design
decision **D-3** below — the only genuinely open part of the storage question.

---

## 7. Control surfaces

Andre, 2026-07-27:

> **"Regarding how you update things and what's the user interface — I think that's more about the control
> plane or the control surface. You've got a control surface for the governance layer. You may have a
> separate one for the security layer. You've got a control surface for the general agent settings around
> the contact list or the address book and incoming sessions."**

So: **storage is unified (one database, several tables); control surfaces are plural and domain-specific.**
That is the right split — a shared store does not imply a shared UI, and the three domains have genuinely
different audiences and different confirmation requirements.

### The three (or four) control surfaces

| Surface | Governs | Exists today? |
|---|---|---|
| **Agent / reachability settings** — tiers, per-tier bounds, away texts, TTL, unknown-sender treatment | who reaches me and how loudly | 🟡 **partly.** `cello_settings_get/set` + `cello settings get\|set` exist and cover `bounds.<tier>.{max_sessions,max_bytes}`, `away.default`, `away.tier.<tier>`. `cello_contact_set_tier` / `set_away` / `set_moniker` cover per-contact. Nothing covers TTL, unknown-sender treatment, or the trust-signal floor. |
| **Address book** — who these people are, what they've done with me, what others say about them | identity and provenance | ✅ `cello_contacts` + the sessions JOIN (sealed count, last spoke) |
| **Security layer** — what gets inspected, redacted, blocked on the way in and out | content safety | ❌ **nothing.** No CLI, no MCP tool, no portal. The five config keys are reachable only by setting an environment variable or writing the SQLite file by hand. |
| **Governance layer** — the loosen/tighten gate, `autonomous_override`, the whitelist, the audit of what policy did | who may weaken a guard, and the record of it | ❌ **nothing.** `DOD-CONFIG-1` is the parked story for this. |

Whether "security" and "governance" want one surface or two is D-4. The distinction that makes them
plausibly separate: the security surface is *"what do I inspect"* and is edited routinely; the governance
surface is *"who may reduce what I inspect, and prove it"* and is edited rarely, under confirmation, with
an audit trail. Different cadence, different risk, arguably different audience (in the company case,
literally different people).

### The lesson that produced this section

`DOD-SETTINGS-SURFACE-1` was added to M8C **after** the address-book work was declared done, because the
done-auditor caught that `cello_settings_get/set` existed only as daemon IPC — the tier-bound overrides
and per-tier away messages had shipped operator-*unreachable*. Andre's call at the time: *don't ship dead
features.* The security and governance layer is currently in precisely that state, one level worse: not
just unreachable, but unrunning.

---

## 8. Open design decisions

Each one states where it comes from, what exists, and what actually turns on it.

### D-1 — Do we allow silence, or must every inbound always get a definitive answer?

**Where this comes from.** `2026-07-07_1700_four-level-screening-policy.md` L1 Ignore: *"Silence. Not
queued, no notification, no trace. I don't want you entering my life in any way."* Then
`2026-07-08_inbound-state-matrix.md`, one day later, declaring itself the replacement: *"We cannot just
silently drop the TCP connection... they don't know if the relay is broken, their connection dropped, or
if they are being ignored."*

**What exists.** Neither. Today an unknown sender under the bound is accepted and gets an auto-ack; over
the bound they are refused server-side and told `ok:true`.

**The question.** Is total silence an option an operator may choose, or does every inbound always receive
a definitive response (accept / answering machine / reject)?

**What turns on it.** Whether L1 gets built at all; whether the `Generic Reject` frame is mandatory or one
option among several; and whether a blocked sender can distinguish "blocked" from "offline" (the matrix
argues they must not — a different response would be a membership oracle anyone could probe).

---

### D-2 — Reconnecting the security and governance layer: what is the default, and can it be turned off?

**Where this comes from.** §0 of this document. This supersedes the vaguer version of the question I asked
first ("on by default or opt-in"), which was unclear because it presumed a choice that doesn't exist yet —
the layer isn't connected either way.

**What exists.** `PassthroughGatewayClient`, always. Live-confirmed in Andre's daemon log.

**The questions, in order.**
1. Reconnecting it is not a decision — it's a defect fix. Assume yes.
2. When it is connected, **what happens to a false positive?** A secret-detection rule fires on a message
   that isn't a secret; the message is redacted or not sent. Is that acceptable at launch, given the
   layer has never run against real traffic and the 222-rule dictionary has only ever been exercised by
   tests?
3. **May an operator turn it off?** If yes, that is itself the largest possible loosening and belongs
   behind D-5's confirmation. If no, a bad rule is unfixable without a client upgrade.
4. Does the screening process live and die with the daemon, or run independently? (M9 Phase 2's
   `M9-REMOTE-001` presumes it can be remote; Phase 1 spawns it as a child.)

**What turns on it.** Whether the security layer is real at launch, and whether a false positive is a
papercut or a wall.

---

### D-3 — One database and one backup, versus a policy store the daemon's key cannot open

**Where this comes from.** Andre, 2026-07-27: *"Everything should be in the database, because the database
is what we would back up. Anything that's not in the database is a mistake."* Versus M9 `INV-4` and
`M9-CFG-001` `SI-001`: the layer's config lives in *"a separate file and key from the daemon's,"* and
*"shall not be readable or writable with the daemon's key"* — adversarial condition: *"even when a
compromised client holding the daemon's SQLCipher key tries to open the gateway config DB, the open
fails."*

**What exists.** Neither. The config and record stores are plaintext `node:sqlite` in a separate file —
so today they satisfy *neither* invariant: not backed up, and not protected.

**The question.** How do we get one backup unit and a policy store an employee-controlled daemon cannot
silently weaken? Options worth weighing: one encrypted database with a second key for the policy tables
(if SQLCipher permits it cleanly — it may not); one database, one key, and accept that the anti-employee
threat model is a Phase-2 / remote-layer concern rather than a local one; or a separate encrypted file
that `cello_backup` explicitly includes.

**What turns on it.** Whether `DOD-CRYPTO-AT-REST-1` is a one-line fix or a design change; and whether
CELLO can honestly make the company claim ("the employee controls the daemon but not the policy") at
launch or must defer it with M9 Phase 2.

**Note.** The launch-relevant half is not in doubt: the stores must move into the encrypted database and
into the backup. Only the second-key question is genuinely open.

---

### D-4 — One control surface or several, and what is a "human confirmation"?

**Where this comes from.** Two threads that meet. Andre, 2026-07-27: *"You've got a control surface for the
governance layer. You may have a separate one for the security layer. You've got a control surface for the
general agent settings."* And `M9-CFG-001`'s behaviour clause: *"When the change loosens a guard (disable
a check, enable autonomous_override, add a hook, expand an allowlist), the gateway shall require operator
confirmation before applying it"* — with the implementation note *"tighten-free / loosen-confirmed
(WebAuthn in the real flow)."*

**What exists.** The store enforces the asymmetry: it classifies every change as tighten / loosen / neutral
and **rejects a loosening outright** unless a `confirmed` flag is set. Nothing in the product ever sets
that flag, because there is no surface at all — no `cello config` command, no portal page, no MCP tool.

**Concretely, a "loosening" means one of:** adding your own email address to the PII whitelist so it stops
being flagged on the way out; raising or removing the outbound message rate cap; adding a language to the
inbound allowlist; or enabling `autonomous_override`, which lets the agent self-authorise sending a value
the layer flagged, with no human present.

**The questions.**
1. How many surfaces — one settings surface, or separate ones for reachability / security / governance?
2. At launch, what physically produces the `confirmed` flag? The portal-with-WebAuthn the spec assumes does
   not connect to this layer. Is a CLI prompt a sufficient "human"? If an LLM agent can type into the CLI,
   is it?
3. If nothing can produce it at launch, then **no guard can ever be loosened** — including un-whitelisting
   your own email address from redaction. Is that acceptable, or does it make the layer unusable the first
   time it misfires? (This is the same failure mode as D-2 question 2, reached from the other side.)

---

### D-5 — Environment variables can loosen a guard with no confirmation and no record

**Where this comes from.** `core/gateway/src/bin/cello-gateway.ts` reads config as
`cfg("autonomous_override", process.env["CELLO_GATEWAY_AUTONOMOUS_OVERRIDE"] === "1")` — the store is
consulted first, and the environment variable is the fallback. Same pattern for the PII whitelist, the
rate cap, and the rate window.

**What exists.** Env fallbacks for four of the five config keys. `M9-OUT-004`'s note calls this an
"interim env config."

**The question.** Are `CELLO_GATEWAY_*` overrides permitted in a shipped build at all? They bypass the
entire tighten/loosen gate — no confirmation, no versioned row, no hash-chained fingerprint, nothing to
attest in Phase 2. Anyone who can set an environment variable can disable a guard invisibly.

**What turns on it.** The credibility of the whole loosen-confirm mechanism. A gate with a documented
bypass is not a gate.

---

### D-6 — Does DND exist, and does VIP bypass it?

**Where this comes from.** `2026-07-08_inbound-state-matrix.md` dimension 2: *"Online (Closed / Do Not
Disturb): the daemon is running and capable of connection, but the operator's policy says I am not
accepting sessions right now."* And key structural decision 2: *"The VIP tier's primary mechanical purpose
is bypassing the Online (Closed) policy block."*

**What exists.** Nothing. The daemon knows *attended* vs *unattended* (`isAttended`) and that is all.

**The questions.** Is DND per-agent or per-daemon? Does it survive the argument that already governs tier
bounds — Andre, 2026-07-10: *"a VIP can be compromised, and a VIP is the most valuable thing to compromise,
precisely because trust is where exemptions accumulate. The trust gradient and the scrutiny gradient must
not point the same way."* VIP-bypasses-DND is exactly an exemption accumulating at the top tier.

**What turns on it.** Half the matrix — two of its four columns are availability states that do not exist.

---

### D-7 — Is blocking symmetric?

**Where this comes from.** Found in code during this audit, not in any design document.
`outbound-sessions.ts:183` reads the target's tier when you initiate a session — but only to decide
whether to attach trust signals (KNOWN+ receives them). A BLOCKED target is dialled normally.

**The question.** Should `cello_initiate_session` refuse to connect to a pubkey you have blocked, or is
blocking deliberately inbound-only ("I don't want to hear from you" ≠ "I never want to contact you")?

**What turns on it.** Small, but it is the kind of asymmetry that reads as a bug to anyone auditing the
code — and cello-client is open source and read by evaluators.

---

### D-8 — What is the launch default floor for an unknown sender?

**Where this comes from.** `M10-DEFINITION-OF-DONE` `DOD-T2-JOURNEY-1`, the live journey that closed
M10 Tier 2: *"stranger C with zero signals gets undefined trust_signals + DEFAULT_UNKNOWN_POLICY evaluates
to `pass: false`."* That is the shipped default.

**What exists.** A hardcoded `DEFAULT_UNKNOWN_POLICY`, no operator surface to change it (D-4), no per-tier
variant (2.4).

**The question.** If that default becomes a live inbound gate, **a stranger with no trust signals cannot
reach anyone.** That is the exact opposite of the launch intent in the repo's own triage rule: *two agents
connect and communicate, including when the other belongs to a friend, partner, acquaintance, or someone
you just heard about.* At the same time it is the entire point of a trust layer that a stranger presenting
nothing is treated differently from one presenting a verified credential.

**What turns on it.** Whether the trust-signal floor is *enforced* at launch or *observed and surfaced* at
launch. Enforcement without an operator surface to relax it is a locked door with no key (see D-4.3).

---

### D-9 — Away messages are outbound disclosures to strangers

**Where this comes from.** `2026-07-10_contact-address-book-design.md` §3b: *"An away message is
operator-authored text sent to an unknown sender. It is an outbound disclosure: 'I am away until Thursday'
tells a stranger when your agent is unattended."*

**What exists.** The resolution ladder is built, and the resolved text **is** screened through the outbound
path (so it can't leak a secret). Nothing prevents the *content* being a disclosure the operator didn't
think through.

**The question.** May a per-tier away text be served to senders below `known` at all? Should the system
default for unknown senders stay deliberately uninformative?

---

### D-10 — Who grants VIP, and can a counterparty influence their own tier?

**Where this comes from.** The address-book design introduces `vip` as the top tier but never says who
grants it. Meanwhile §5 describes introductions and endorsements — signals arriving *from* the counterparty
or their vouchers.

**The question.** Is tier strictly a local operator decision, or can any inbound artefact (an introduction
from a whitelisted contact, a portal-verified credential, a directory-issued clean history) promote
someone automatically? Given DEC-AB-3 deliberately removed automatic promotion on accept, re-introducing
automatic promotion through the trust-signal path would undo that decision by another route.

---

### D-11 — Is there an operator-visible record of what policy did?

**Where this comes from.** `M9-REC-001` built exactly this for the security layer: every screened message
produces a hash-chained record of what was done to it (clean / redacted / blocked / warned). Nothing
equivalent exists for **reachability** decisions — refusals, tier gates, TTL expiries, away responses.

**The question.** Should there be one surface answering *"what did my policy do this week, and to whom?"*
covering both domains?

**What turns on it.** Policy nobody can audit is policy nobody can trust — including the operator who set
it. The observability events already exist (`contact.tier.changed`, `session.inbound.refused.tier`,
`contact.away.resolved`); what's missing is a way to read them that isn't `grep daemon.log`.

---

### D-12 — Does the hook engine move up?

**Where this comes from.** `M9-DEFINITION-OF-DONE` Day 2 list: *"Hook engine — operator-supplied checks at
defined positions, HMAC auth, the observe/gate/redact capabilities, redact-no-inject enforcement. **This is
the seam an operator points a policy-LLM or a third-party scanner at.**"*

**The question.** Andre's framing for this audit was that *not all of these are LLM-based policies — some
are settings.* That's right, and worth making explicit: almost everything in this document is a setting or
deterministic code. The hook engine is the **only** place an LLM-based or operator-authored policy can
attach. INV-3 is deliberate about this: *"Anything needing judgment is not in the base pipeline."*

So: does any launch-era use case require operator-authored policy, or is deterministic-only genuinely
sufficient for launch?

---

### D-13 — Publishing policy so the relay can act on it

**Where this comes from.** The matrix's first column (receiver Offline) says *"Handled by Relay"* — the
relay must decide, on the operator's behalf, whether to reject a stranger or hold a message for a
whitelisted sender. And `2026-07-04_edos_rate_limiting.md` proposes service providers *"publish their
rate-limit policies in their Service Contract/Manifest on the CELLO Directory."*

**The question.** Any policy the relay or directory enforces must be published to them — which means
telling federated infrastructure something about your contact list. This is the same privacy problem that
deferred `DOD-CONTACT-1`'s presence-visibility clause (M8C D16: *do we sync raw pubkeys? a hash? per-node
or federated?*), and it collides with the standing rule that the directory holds no PII.

**What turns on it.** Whether offline reachability for whitelisted senders (4.1) is buildable at all
without a new protocol surface and a privacy decision.

---

### D-14 — Trust-signal revocation

**Where this comes from.** Address-book design §5, listed under "open questions — deliberately not answered
here": *"An endorser may withdraw. The directory holds the hash; withdrawal must be expressible, and a
receiver must be able to learn that a signal it once accepted is no longer vouched for."*

Left here as a marker; not launch work.

---

### D-15 — Does the directory ever see endorsement plaintext?

**Where this comes from.** Address-book design §5, flagged 🔐: to check that what a holder presents matches
the stored hash, the directory must hash what is presented — so it holds the text **transiently** even
though it persists only the hash. The alternative keeps it blind: the initiator sends the signal directly
to the receiver, and the receiver asks the directory *"is hash H a valid signal about pubkey X issued by
Y?"* Same guarantee, strictly less exposure.

**What turns on it.** The precision of the no-PII-in-the-directory claim, which is a stated product
position. *"Worth deciding before implementation"* — and implementation has since happened, so this needs
checking against what M10 actually shipped rather than re-decided from scratch.

---

## 9. Suggested shape of the work

Three units, in dependency order. Not a schedule — a dependency graph.

**POL-0 — connect the security and governance layer.**
The composition root instantiates the real client and spawns the screening process; the config and record
stores move into the encrypted database and into the backup (`DOD-CRYPTO-AT-REST-1`, INV-POLICY-STORAGE);
environment-variable loosening is removed or demoted (D-5). Everything it switches on already exists and is
gate-green — this is wiring, not construction. Gated on D-2 and D-3.

**POL-1 — the control surfaces.**
`DOD-CONFIG-1` plus whatever D-4 decides about how many surfaces there are and what produces the
confirmation flag. Also closes the gaps in the reachability surface (TTL, unknown-sender treatment,
trust-signal floor). Without this, everything POL-0 switches on is unadjustable — which is worse than off
the first time a rule misfires.

**POL-2 — the inbound matrix.**
Availability states including DND, the `Generic Reject` frame, the per-(tier × state) response table, L3
notify-on-return, and relay eligibility by tier. Gated on D-1, D-6, D-13.

**A triage note, in the repo's own terms.** POL-0 is the unforgivable one: shipping a trust product whose
security layer is a no-op is exactly what a technical evaluator finds by reading the open-source client.
POL-1 is close behind, because a guard you cannot adjust is a guard that will eventually block something
real. POL-2 is a genuine feature build and most of its sixteen cells are forgivable at launch — today's
behaviour (accept under bound, answer with an away message) is a working, if blunt, policy.

---

## Related Documents

- [[2026-07-07_1700_four-level-screening-policy]] — the 4-level model; L1 Ignore; the auto-add-on-knock
  finding (since fixed by DEC-AB-3)
- [[2026-07-08_inbound-state-matrix]] — the 4×4 replacement; Generic Reject; DND; the relay column
- [[2026-07-10_contact-address-book-design]] — the data model; INV-TIER-SCREEN and INV-TIER-BOUND; the
  away-message ladder; trust signals §5
- [[2026-07-10_address-book-implementation-spec]] / [[2026-07-10_address-book-build-log]] — what was
  actually built, and DEC-AB-1..4
- [[M9-DEFINITION-OF-DONE]] — the layer's story list, INV-1..8, and the 2026-07-09 status correction on
  plaintext storage
- [[M9-CAPABILITY-HARVEST]] — §6 the governance channel, §7 the config architecture, §9 the two phases
- [[M9-CFG-001]] — the versioned store, tighten-free/loosen-confirmed, SI-001
- [[M8C-DECISIONS]] — D14 (CONFIG-1 parked), D15 (opaque mode parked), D16 (presence ACL deferred),
  D17 (TTL configurability parked), D19 (offline relay gap), D21 (the 4-level policy)
- [[M8C-DEFINITION-OF-DONE]] — DOD-CONTACT-1, DOD-AWAY-1, DOD-CONFIG-1, DOD-M9INT-1,
  DOD-CRYPTO-AT-REST-1, DOD-SETTINGS-SURFACE-1
- [[M10-DEFINITION-OF-DONE]] — DOD-FLOOR-1, DOD-PRESENT-1, DOD-VERIFY-1, DOD-T2-JOURNEY-1
- [[2026-07-04_edos_rate_limiting]] — identity-bound rate limiting; published service contracts
- [[2026-07-04_1630_launch-triage-backlog]] — item 9, the kill switch, still unverified

---

## 10. Decisions taken — 2026-07-28 (Andre)

Walked through one at a time, in dependency order rather than document order.

### D-2 — DECIDED: enforce, everything except the DeBERTa model

Reconnect the security and governance layer in **enforcing** mode. Every guard that is built runs and
acts: inbound sanitization, outbound secret redaction, PII whitelist + bulk-dump warn, rate limiting,
language allowlist. The DeBERTa injection model stays deferred (it is not built — the real classifier
was deferred by decision on 2026-06-23 pending the 568 MB model + runtime infra).

Ship the minimal operator escape hatch in the **same unit** — enforcing without a way to relax a
misfiring rule is the one combination that can strand you (see D-4).

**Andre's stated concern:** *"I have ongoing development everywhere and I'm concerned — because I thought
this was already flipped on — that I'm going to start experiencing errors and I won't know if they're the
result of the new code or this flip."* Mitigation, recorded so it isn't rediscovered: the daemon prints
`security.gateway.connected {mode}` on every boot, so which build had it on is determinable from the log,
and every screening decision writes a record with reason + correlationId. Attribution is a grep, not a
guess. Flip on a quiet branch and read a day of records before it reaches working daemons.

### D-3 — DECIDED: local policies in the client database; the enterprise scanner owns its own

- **Local:** policies live in the client's encrypted database. One key. Covered by backup.
- **Enterprise:** the scanning machine holds its own policies, on its own machine. It never reaches back
  to the client's database.

Same code, two homes. What is dropped: today's design puts a "the daemon isn't allowed to read this"
store *on the same laptop*, which never worked — whoever owns the laptop can simply not run the scanner.
`SI-001`'s guarantee is real but only enforceable when the scanner is on a machine the operator does not
control, i.e. `M9-REMOTE-001`. Amend `SI-001`'s scope in writing so this reads as correcting an
over-claim, not dropping a requirement.

**Andre's recollection, confirmed correct:** the motivation for the split was always the enterprise case —
an enterprise may run inbound/outbound screening on a machine they control while users work locally. That
architecture is right and is why the local simulation of it is unnecessary.

**Open, deliberately not decided (Phase 2):** when the remote scanner is unreachable, does the local daemon
fail closed (no screening, no messages) or continue? Fail-closed is enterprise-correct and collides with
CELLO's availability invariant. Name it before the enterprise build, not during.

### D-4 — DECIDED: CLI prompt now, passkey later

A change that makes you *less* protected (stop redacting my email, raise the send limit, enable autonomous
override) requires a human confirmation the store already enforces and nothing in the product can currently
produce. At launch the operator confirms **in the CLI**; the portal passkey flow replaces it when the
portal connects to this layer. Rationale: one user, and the alternative is that a misfiring rule can never
be fixed.

**Control surfaces:** keep the two that exist (agent settings, contacts) and add **one** for the security
layer. Not three.

### D-5 — DECIDED: remove environment-variable overrides from shipped builds

Security settings come from the database only. The four `CELLO_GATEWAY_*` overrides bypass the D-4
confirmation gate entirely — no confirmation, no versioned row, no fingerprint to attest. Tests inject
config directly and do not need the env path. A gate with a published bypass is not a gate.

### D-1 — DECIDED: a refusal is always definite, and never comes from the LLM

Resolves the contradiction between the 4-level policy (L1 Ignore = silence) and the inbound state matrix
(never leave a sender hanging). **The matrix wins: no silent drops.**

Andre's clarifications, which are the substance of the decision:

1. **This is not "every unknown sender gets a no."** Unknown senders may well be accepted — that is a
   policy choice. The rule is only that *when* the answer is no, it is a **definite** no.
2. **Blocked always means no. Unknown may or may not**, depending on the configured policy.
3. **A refusal never involves the LLM.** It is deterministic and decided before anything reaches the model.
4. **A security-scan result can produce a no** — but the line between *"redact this and carry on"* (accept
   the session, drop or redact the content) and *"this is bad enough we are not taking the call"* (a
   deterministic refusal) is **not yet defined**. Defining which findings fall on which side is its own
   piece of work, and it is new scope not previously tracked anywhere.

Supporting fact that settles the privacy objection to always-answering: the directory already tells any
querier whether an agent is online (the same finding that deferred `DOD-CONTACT-1`'s presence clause,
M8C D16). Silence therefore hides nothing that is not already public.

### D-6 — DECIDED: no Do-Not-Disturb state at launch

Away mode already delivers the substance — the operator is not interrupted, the sender is not left
hanging. Skipping DND drops the inbound matrix from sixteen cells to twelve and parks the VIP-bypass
question rather than shipping it. **VIP remains a limits/priority tier with no bypass power** — consistent
with INV-TIER-BOUND and with Andre's rule that the trust gradient and the scrutiny gradient must not point
the same way.

### D-7 — DECIDED: blocked is a wall inbound, a stop sign outbound

**One flag, two behaviours**, because the risk differs by direction: inbound you are defending against
*them*; outbound you are defending against *your own agent* being talked into it.

- **Inbound:** absolute. A blocked sender gets a definite no. No override.
- **Outbound:** your agent REFUSES and tells you why — *"you blocked them on ⟨date⟩; to call anyway, run
  this."*
- **The override makes ONE call and expires. It does NOT unblock them.** Unblocking stays a separate,
  deliberate act.
- **Both the refusal and the override are logged**, so "I called someone I had blocked" leaves a trail.

Rejected: a second `blocked_outbound` setting (needless), and no-override-at-all (forces an unblock the
operator may not want).

### D-8 — DECIDED: the default floor is verified email + verified phone

Not "require nothing." **Andre: it is impossible to have truly nothing** — every registered agent holds two
automatic trust signals, a verified email and a verified phone. You cannot sign up without them.
**Absence of those two therefore means a rogue agent, not a shy stranger**, and is the correct thing for
the floor to refuse.

**Collision found while deciding this, and fixed by the same decision:** disclosure is currently gated at
`tier >= KNOWN` (`outbound-sessions.ts:183`), so an unknown sender presents NOTHING — and would fail a
floor asking for the two things they actually have. Both sides behave correctly and first contact becomes
impossible. So:

- **Baseline signals (email + phone) are always presented, to everyone.** They are the price of admission,
  not a selective disclosure.
- **Everything else stays operator-chosen** (see the disclosure policy below).

To confirm at build time: presenting these must prove *"this agent has a verified email"* without
revealing the address — that is what the no-PII rule requires and what makes always-present safe.

### D-8a — DECIDED: outbound trust-signal disclosure policy (Andre, stated directly)

- Per-send controls to include or omit individual signals **already exist**.
- **Default: everything goes out.**
- **For any signal with an anonymous and an identified variant, the default is the ANONYMOUS one.**
  Identified means it carries the account name (e.g. your GitHub handle, so someone can go look at it);
  anonymous attests to properties of the account without naming it.

**Defect logged against this policy:** the current `tier >= KNOWN` disclosure gate contradicts "everything
goes out by default" — it sends a stranger nothing at all. The gate's instinct is backwards for first
contact: withholding from someone you already distrust is reasonable, withholding from someone who has
never met you just means they cannot verify you. Fix with D-8's baseline split.

### D-9 — CLOSED, not a decision: the away-message ladder is already specified and built

The question was badly framed ("custom text for strangers, yes or no"). Andre: *"I thought we agreed
there's a canned message by the system and you can change that canned message. But you can also set it for
different tiers."* Correct — `DOD-AWAY-TIER-1` shipped exactly that, four levels resolved most-specific
first and guaranteed total:

```
per-contact message  >  per-tier message  >  agent default  >  system default (code)
```

So the unknown tier already has its own slot. Nothing to decide. The only residual is what wording ships
as the system default text.

### D-10 — DECIDED: a sender can never raise their own tier

Tier is always the operator's call. Trust signals and introductions may INFORM and may PROMPT — *"Alice was
introduced by Bob, whom you've whitelisted. Promote her?"* — but only the operator changes a tier. Rejected:
automatic promotion on a strong signal or a trusted introduction, which would reopen (by another route)
exactly the hole DEC-AB-3 closed when it removed accept-promotes, and would make an operator you trust into
a lever for promoting strangers into your inner tier.

### D-11 — DECIDED: build one small "what did my policy do" command

A single list, newest first, with reasons: refusals, redactions, blocks, tier gates, away responses. The
events already exist; this reads them. Deliberately not a dashboard.

**Ships with the D-2 enforcement flip** — it is the concrete answer to Andre's attribution worry ("will I
know whether a new error came from the flip?"). Policy nobody can audit is policy nobody can trust,
including the operator who set it.

---

## 11. D-12 — TABLED (2026-07-28). The one architectural decision, deliberately not made under pressure

Andre: *"This is such a critical architectural decision. I need to piece through it carefully, and the
environment is just not conducive."* Recorded in full so resuming costs nothing.

### The picture I did not have, in Andre's words

The inbound pipeline, end to end:

1. **Deterministic security scan** — hidden control characters, encodings. (M9 Layer 1.)
2. **Classifier model** — is this prompt injection? (DeBERTa; deferred, D-2.)
3. **Relationship** — are they in the address book, at what tier? Decides whether the call proceeds.
4. **Deterministic trust-signal check** — *"I want to see these types of trust signals."* Cheap, mechanical;
   exists to avoid paying for evaluation you don't need.
5. **LLM evaluation of the operator's own policy** — **written in markdown and stored in the database**
   (not a file), applied to what the sender presented.

**Step 5 is the goal, not a Day-2 extra.** My original D-12 ("should we build an LLM policy seam at
launch?") was the wrong question — it treated the destination as optional. Correcting that framing is the
main output of this exchange.

Andre also notes the LLM's job here is small and well-bounded — it is **not** reading the sender's message.
It sees: the contact overlap, the endorsements offered, the trust signals offered, and the operator's own
written policy. *"You decide."* And: *"as inference gets cheaper and models get better, I think this is
going to be the better approach. But cheap deterministic scanning should also be possible."*

### The actual problem

Configuring a deterministic rules engine is too hard for most users — *"even myself, who designed it."*
The failure mode is a product nobody can set up: too much focus, too much thinking, so nothing works and
they leave. But the alternatives are unattractive too: a **scoring system** is rejected (CELLO does not
hand people arbitrary numbers — see [[2026-04-14_1500_deprecate-trust-seeders-and-trustrank]]), and
LLM-for-everything gives up the cheap path.

Worked example, Andre's: endorsements are coming. If you and I have overlapping contacts, does that
**negate** the need for a registered, aged GitHub and X account — or at least one of the two?

### What was established before tabling

- **Substitution is scoring in disguise.** The moment a policy says "A *or* B", you must say what each is
  worth. That is weights, and weights are the scoring system being avoided. As prose the same rule is one
  sentence and needs no numbers. This is the reason the split below is natural rather than arbitrary.
- **The proposed line:** *facts* stay deterministic (signed, unexpired, unrevoked, baseline present, tier —
  no substitution, no judgment, nearly free); anything *substitutable* goes to prose + LLM, because that is
  precisely where the score would have been.
- **Who writes what:** the user writes prose; the system writes rules; never the reverse. Most operators
  write nothing and run on the default (verified email + phone, blocked stays blocked, known fast-tracked).
- **Determinism by observation, not specification** (proposed, undecided): after the LLM decides the same
  way enough times, offer to harden it — *"you've admitted seven people who shared two or more contacts;
  make that automatic?"* The operator gets a deterministic rule they never authored and can trust, because
  they watched it happen.
- **Cost shape:** the LLM call fires only for a stranger who cleared the cheap gates — per first contact,
  not per message. Known contacts never reach it.
- **Failure shape:** if the LLM is unavailable, fall back to the deterministic floor and **queue**, never
  admit.

### THE QUESTION, stated for the resumed session

> **When the deterministic floor and the LLM policy disagree, may the LLM ADMIT someone the floor's
> preferences turned away — or is the floor final, with the LLM only ever able to narrow?**

- **Floor final** (what `DOD-FLOOR-1` specifies today: *"LLM discretion layers on top and may only
  RESTRICT"*) — predictable and cheap, but one badly-worded rule silently blocks good people forever, and
  the smarter layer never sees them. This is the brittleness Andre named.
- **LLM may admit** — the floor becomes a fast path rather than a wall; a bad rule is recoverable. Costs an
  inference on the cases the floor would have rejected.

Note that deciding "LLM may admit" is a **change to `DOD-FLOOR-1` as shipped**, not a new build on top of
it — the restriction is already written into the spec and the code.
