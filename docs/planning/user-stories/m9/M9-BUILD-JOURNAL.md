---
name: M9 Build Journal
type: journal
date: 2026-06-21
milestone: M9
status: open
description: >
  Append-only build journal for M9 (the security gateway). One entry per unit of work.
  NEVER edit a prior entry. This is the live-state + audit-trail follow-through doc: a
  fresh context reads the last few entries to resume. Pairs with M9-DEFINITION-OF-DONE.md
  (the target) and M9-PROCEDURE.md (the runbook). See M9-PROCEDURE.md §0 for read order
  and §1 for what each entry must contain.
---

# M9 Build Journal (append-only)

> Newest entries at the BOTTOM. Never edit or delete a prior entry. Each entry: DoD-ID,
> what was red, what was found, commit hashes, reviewer outcome, blockers, decisions.
> (M9-PROCEDURE.md §1, §9.)

---

## 2026-06-21 — M9 planning complete (no code yet)

**State.** M9 is opened for planning, not building. The canonical gateway design (V3,
2026-05-28) already exists; what was missing — and what blocked a clean start — was where
the gateway attaches to the daemon's content channel. That is now settled.

**Produced this session (docs only, committed to trustless-cello `main`):**
- `discussion_logs/2026-06-21_1600_m9-content-channel-seam-and-entry-plan.md` — the entry
  plan: the daemon seam, the MSG-001-3b co-design, the dependency gate, the doc apparatus.
- `M9-DEFINITION-OF-DONE.md` — the yardstick. Every M9 requirement pulled from V3 + the
  overview + the eight story YAMLs + the production-gap analysis, ordered, status-tagged,
  mapped to six live journeys (J-SCREEN → J-ATTEST).
- `M9-PROCEDURE.md` — the runbook (three artifacts, the red-driven loop, cadence, M9
  hard rules, the dependency gates).
- `M9-BUILD-JOURNAL.md` — this file.

**The seam (settled, code-verified on `m7-rehome`).** The daemon calls the gateway twice:
- OUTBOUND `screenOutbound` at `cello_send` (`daemon.ts:2616`), before
  `sessionNodeManager.sendContent` (`session-node-manager.ts:1406`). Park deposit carries
  already-sealed ciphertext, already screened at `sendContent` — no second egress.
- INBOUND `screenInbound` at `ingestReceivedContent` (`session-node-manager.ts:1548`),
  before the `#receivedContent` buffer `cello_receive` (`daemon.ts:2707`) drains.

**The co-design decision (with the MSG-001-3b coder, 2026-06-21).** Increment 3's
recovery path routes `pull → openSealed (in-daemon) → ingestReceivedContent`, the SAME
inbound funnel as direct receive — NOT handing ciphertext to the agent. Otherwise parked/
recovered messages would reach the agent unscanned (injection bypass). The coder confirmed
this is their plan, made the leaf-append dedup-aware (chokepoint stays unconditional —
scan + cross-check + buffer always run), and **LOCKED the single-inbound-funnel acceptance
criterion** into MSG-001-3b increment 3 (trustless-cello commit `bc047c7`). The inbound
seam has NO schema dependency (only the outbound startup-flush park does). Recorded in
memory `project_m9_content_channel_seam`.

**Dependency gates (M9-PROCEDURE §8).**
1. **J-SCREEN seam (M9-SCREEN-SEAM / INV-3) is 🔒 on MSG-001-3b increment 3** landing with
   its LOCKED AC. Until then the recovered-park-content path can bypass the gateway.
2. **Hook-governance UX (M9-HOOKGOV-1) is 🔒 on M8** (portal). The hook engine + audit
   trail still ship in M9; only the portal-surfaced UX waits.
3. **Unblocked now:** the gateway repo/package skeleton, the `SecurityGatewayClient`
   interface + local stub, and the `SecurityAttestation` directory-schema *design*.

**Open decisions to resolve before/at the relevant journey (flagged in the DoD/entry plan):**
1. `message_sequence` binding — recovery path is sequence-then-content (sequence at hash-
   witness; content later). M9-ATTEST keys on the `appendSessionLeaf` leaf index; must not
   assume content+sequence land atomically on the park path.
2. fail-open vs fail-closed when the gateway is unreachable — per-deployment policy; the
   daemon hook home is `ingestReceivedContent` (one inbound place).
3. The eight existing story YAMLs (SCAN/REDACT/MONITOR) predate V3 + the daemon — each
   needs a rewrite-pass note stating its daemon seam (`ingestReceivedContent` /
   `sendContent`), not the dead `client` package.

**Next red (the first unit of actual work — once Andre opens the build).** Per
M9-PROCEDURE §5/§8, start with the unblocked scaffolding, not a gated journey: stand up
the gateway repo/package skeleton + the `SecurityGatewayClient` adapter (the two daemon
call sites wired to a no-op local stub) + the `SecurityAttestation` schema design. Then,
when MSG-001-3b increment 3 lands, write **J-SCREEN** as the first live journey (Layer 1
inbound + the recovered-park-content seam assertion).

**Reviewer outcome / blockers.** N/A (docs only this entry). No code, no tests run.
Nothing merged, nothing pushed beyond the planning docs (Andre's call to open the build).

---

## 2026-06-22 — Correction: planning was NOT complete; full design pass done; still no build

The entry above said "planning complete." That was premature. A full design pass happened
after it, all of it design, none of it build. No code has been written for M9. This entry
brings the journal current.

**What happened (2026-06-21 → 06-22):**
- **Capability harvest.** Gathered everything usable from gitleaks (all 222 secret detectors
  + the engine), the whole Infisical repo (governance architecture), and the LLM-guardrail
  field (inbound + outbound). In `M9-CAPABILITY-HARVEST.md` §1–§4.
- **Prune.** Went capability by capability and decided what's in / opt-in / out / Day-2.
  Cut: tool allowlists, Layer 5 (LLM-call governor), Layer 6 (deny-all FS/URL), all content
  moderation. The scoping invariant: CELLO is not a moderation tool. In §5, §7.
- **Governance feedback channel.** Designed how the gateway reports back to the LLM: the four
  dispositions (observe / redact / block / warn), blocking `cello_send` with a never-hang
  guarantee, the stateless re-send flow with `governance_decisions`, the PII whitelist + warn
  model. In §6.
- **Config architecture.** The gateway owns its own SQLCipher DB (separate file/key), versioned,
  tighten-free / loosen-confirmed. In §7.
- **Two-phase build.** Phase 1 = local, launchable, ends at Gate 1. Phase 2 = remote gateway +
  tamper-proof records, ends at Gate 2. In §9.

**Docs rewritten to match (committed to main):**
- `M9-DEFINITION-OF-DONE.md` — rewritten to the two-phase plan with the full story list +
  one-line done-conditions (commit `7725e2ab`). The old six-journey (J-SCREEN → J-ATTEST)
  structure is gone.
- `overview.md` — rewritten as a pointer to the harvest + DoD, with the mapping from the eight
  old SCAN/REDACT/MONITOR YAMLs to the new stories (`7725e2ab`).
- `M9-CAPABILITY-HARVEST.md` — §9 added (`14f966c8`).

**State now.** M9 is design-complete. No build. The eight old story YAMLs are superseded at the
plan level (mapped in the DoD/overview); the individual new-story YAMLs are written at build
time, one at a time, not now.

**Blocked on.** MSG-001-3b increment 3 (M7) for the live inbound screening. The gateway skeleton
and the outbound/feedback slice do not depend on M7 and could start early, but that splits focus
from M7, which is the launch blocker.

**Next.** When M7 unblocks, build Phase 1 starting with M9-CORE-001 (gateway skeleton + the
daemon seam). Nothing to do in this journal until a build unit actually starts.

---

## 2026-06-22 — Story-authoring pass DONE; M7 unblocked; READY TO BUILD (pre-compaction handoff)

This is the resume point. Read this entry first, then M9-PROCEDURE.md (top to bottom — note
the REALITY-CHECK-style alpha discipline is M7's; M9's hard rules are §5) and the DoD.

**Story pass complete.** All 15 new M9 stories written to the new `/cello-story` bar (few,
strong, stub-resistant ACs; honest test_type per altitude — gate=cross-process, seam=integration,
detectors=unit, storage=integration round-trip). Committed on `main` (local, NOT pushed):
- Phase 1: M9-GATE-1 (E2E, 7 ACs), M9-CORE-001 (skeleton+seam), M9-IN-001/002/003 (sanitize/
  DeBERTa/language), M9-OUT-001/002/003/004 (secrets/PII-warn/exfil/rate-limit), M9-FEED-001
  (feedback channel), M9-CFG-001 (config), M9-REC-001 (records).
- Phase 2: M9-GATE-2, M9-REMOTE-001 (mTLS), M9-ATTEST-001 (directory attestation + migration).
- The 8 old SCAN/REDACT/MONITOR YAMLs were RETIRED (deleted; mapping in overview.md).
Commits: `4ac57a1f`, `30c70ad0`, `a96e2f8d`, `092d21c7` (deletions). Story-pass only — no push.

**M7 dependency LANDED — M9 is buildable.** The unified inbound funnel (MSG-001-3b) is
live-proven: BOTH direct AND recovered/parked content route through `ingestReceivedContent`
(recover path `source:park`, cello-client `a42b72d`; j-content 8/8 green). That is exactly the
single-inbound-funnel M9-GATE-1 AC-005/SI-001 needed. The one open M7 item — Finding 2
(relay-signed sequence, decision pending Andre) — is a content-path hardening, orthogonal to
M9's screening seam; NOT an M9 blocker.

**Seam line-number drift (verify at build time).** M9-CORE-001 cites
`session-node-manager.ts:1406/1548` and `daemon.ts:2616` from earlier this week; the M7
content-ordering work changed those files, so the lines have moved. The FUNCTIONS (the seam)
still exist — the falsify-first step (Procedure §2.3) re-locates them.

**WORKTREE REQUIREMENT (Andre, 2026-06-22).** Build M9 in its OWN worktree + branch, NEVER on
`main` and NEVER in the M7 thread's checkout — M7 is being finished by a separate coder on
`main` in the primary trustless-cello dir. (Procedure §5.) The other coder also has uncommitted
files on `main` (relay/e2e); stage only M9 files.

**FIRST BUILD STEP (post-compaction).**
1. Create the M9 worktree + branch in **cello-client** (the first unit's home — daemon seam +
   the new gateway package), e.g. `git worktree add ../cello-client-m9 -b m9-build`. Add a
   trustless-cello M9 worktree later for the e2e gate.
2. Build **M9-CORE-001** (gateway skeleton + the two seam call sites: `screenOutbound` at
   `cello_send`, `screenInbound` at `ingestReceivedContent`) with a pass-through gateway — the
   DoD's first Phase-1 story. Red-first against the live gate, per Procedure §2.
3. Then down the Phase-1 list toward Gate 1 (M9-GATE-1). The M7-gated gate ACs (recovered-content
   seam) are now unblocked.

**State.** trustless-cello `main` (local). cello-client `main` has the daemon. Nothing pushed.
Drift-check cron (Procedure §3a) is NOT yet running — it starts when the build opens; create it
as part of the first build step.

---

## 2026-06-22 — Build opened: M9-CORE-001 design note (§6) — the seam + the gateway program

Build is open. Worktrees: code in `cello-client-m9` [m9-build], M9 docs in `trustless-cello-m9`
[m9-build] (both off the same HEAD; M9 doc commits land in the docs worktree, code in the code
worktree — nothing on `main`, nothing in the M7 thread's primary checkouts). Drift cron (§3a)
running: job `504a0df8`, every 30 min.

**Seam re-located (the cited line numbers had drifted — Procedure §2.3 falsify-first done).**
- `cello_send` handler → `daemon.ts:3213`; it calls `sessionNodeManager.sendContent` at `daemon.ts:3262`.
- `cello_receive` handler → `daemon.ts:3305` (drains via `takeReceivedContent`).
- `sendContent` → `session-node-manager.ts:1721`; `ingestReceivedContent` → `session-node-manager.ts:2001`.
- The agent-facing buffer `#receivedContent` is populated ONLY in `#appendVerifiedContent`
  (`session-node-manager.ts:2145`, buffer write at :2160), called from `ingestReceivedContent`
  (:2109) and `#releaseHeld` (:2188), drained by `takeReceivedContent` (:2201).

**Seam placement (the design decision).**
- **Outbound** → in the `cello_send` handler, after the 1 MB size cap, immediately before the
  `sessionNodeManager.sendContent` call (`daemon.ts:3262`). Matches the documented seam ("at
  cello_send, before sendContent") and AC-001 ("screenOutbound ran ahead of sendContent on the
  wire"). On a non-allow verdict the handler returns WITHOUT calling sendContent — nothing on the
  wire, session stays usable.
- **Inbound** → inside `#appendVerifiedContent`, AFTER the transcript leaf append (`appendSessionLeaf`,
  :2153) and BEFORE the `#receivedContent` buffer write (:2160). Rationale: `#appendVerifiedContent`
  is the SINGLE point every delivered byte passes through, on every arrival path — direct stream,
  held-then-released (ordering), and recovered-park (the M7 funnel, `daemon.ts:2038` →
  `ingestReceivedContent` → here). Gating the outer `ingestReceivedContent` would MISS held content
  (it early-returns at :2092 before reaching the append) — gating the buffer-write chokepoint cannot
  be bypassed. This is exactly what AC-002 asks: "before the content enters the #receivedContent
  buffer that cello_receive drains." The leaf (the tamper-evident record of what the peer actually
  sent) is unaffected by screening; screening governs only what reaches the AGENT — which is the
  correct split for later block/redact dispositions.

**Architecture (the adapter, per the mandatory adapter pattern).**
- New package **`core/gateway`** (`@cello-protocol/gateway`) — the SEPARATE gateway program. It owns:
  the `SecurityGatewayClient` interface + verdict/wire types; `PassthroughGatewayClient` (in-process,
  always-allow — the backward-compat default so the ~40 existing daemon/SNM tests keep passing); the
  `LocalSidecarGatewayClient` (Unix-domain-socket framed-JSON client with a per-call deadline +
  fail-closed); the gateway SERVER (`createGatewayServer`) + the `bin/cello-gateway` entry; and a
  `spawnGatewaySidecar` helper for the composition root / tests. AC-003 (no security-PIPELINE logic
  in `core/daemon`) holds — the daemon imports only the interface + the passthrough default + the
  verdict types and calls the two seams; all detection (later stories) lives in `core/gateway`. The
  interface/client/passthrough are not "pipeline logic," so they may live in `core/gateway` and be
  imported — keeps the daemon clean. Dep direction: `core/daemon → core/gateway` (the gateway is a
  leaf). Publish ripple (Andre pushes later): `core/gateway` becomes a dep of whatever bundles the
  daemon into `@cello-protocol/connect` for local-sidecar mode — noted, not actioned.
- **IPC = framed JSON-RPC over a Unix domain socket.** Chosen because it makes the Phase-2 remote
  gateway a transport swap (socket → mTLS) behind the SAME `SecurityGatewayClient`, not a rewrite —
  the story's stated goal. The client connects to a given UDS path (lifecycle — spawning the sidecar
  — is a composition-root concern via `spawnGatewaySidecar`; the M9-CORE-001 test spawns the real
  gateway bin and points the client at its socket, satisfying "the gateway PROCESS received the
  content over the real channel, observed in the gateway's own request log").
- **Injection.** `DaemonConfig.securityGateway?: SecurityGatewayClient` (`types.ts:138`), threaded to
  the SNM constructor (`session-node-manager.ts:299`, used by the inbound seam) and held by the daemon
  (outbound seam). Optional; defaults to `PassthroughGatewayClient`. SI-001 holds: a no-op pass-through
  still RETURNS a verdict (allow) — backward-compat is "always-allow verdict," not "no verdict."
  Fail-closed (SI-001/DB-001) is specifically a CONFIGURED gateway going unreachable → `gateway_unavailable`
  + guidance (outbound returns, inbound holds — buffer not populated).

**Never-hang (INV-6, foundation only here).** `LocalSidecarGatewayClient` carries a per-call deadline;
a timeout or connect-failure resolves to a fail-closed verdict, never a hang. The full four-disposition
contract + re-send is M9-FEED-001; M9-CORE-001 lays only the allow / fail-closed floor.

**Test plan (red-first, Procedure §2/§4 — anchor to the program).** Model on
`seam-4-daemon-orchestration.test.ts` (two real daemons over loopback libp2p, driven through the IPC
`cello_send`/`cello_receive` path) + spawn the REAL `core/gateway` bin as a child on a temp UDS with a
JSONL request log. AC-001: after `cello_send`, the gateway's request log shows the outbound screen and
it preceded the wire send. AC-002: after delivery + `cello_receive`, the request log shows the inbound
screen and the buffer was not drained before it. AC-003: a static scan asserts `core/daemon` holds no
detector/scanner/redactor module. SI-001/DB-001: omit/kill the gateway → `cello_send` returns
`gateway_unavailable`; inbound holds (no buffer populate).

**Next.** Architecture phase: create `core/gateway` skeleton (package + interface + type stubs that
compile but are unimplemented), so the integration test compiles and goes RED for the right reason.
Then implement to green.

---

## 2026-06-22 — M9-CORE-001 BUILT (🟡, gate not yet run) — reviewed, all findings fixed

**What shipped (cello-client `m9-build`, commits `78d0191`, `62bf7a9`, `bfa905c`, `86050bc`, `24a1c25`).**
- New `@cello-protocol/gateway` package — the separate gateway program: `SecurityGatewayClient`
  interface + verdict types, `PassthroughGatewayClient` (always-allow default), length-prefixed-JSON
  wire protocol + `FrameDecoder`, `createGatewayServer` (UDS + pluggable screen fn + request log),
  `LocalSidecarGatewayClient` (per-call deadline, fail-closed), `spawnGatewaySidecar` + `bin/cello-gateway`.
- Daemon seam: outbound screen in `cello_send` before `sendContent`; inbound screen inside
  `ingestReceivedContent` (now async) at the single buffer chokepoint. Injection via
  `DaemonConfig.securityGateway`, default passthrough (pre-M9 daemons unchanged).
- Wired `core/gateway` into the workspace (root tsconfig refs, vitest workspace, daemon dep + project ref).

**Gate (its own ACs, not the phase gate).** 378 daemon tests + 7 gateway tests green; lint, typecheck,
build clean. The seam is proven against a REAL spawned gateway process (`m9-core-001-seam.test.ts`):
AC-001/002 happy path with content-fingerprint proof; SI-001/DB-001 outbound fail-closed (nothing on
the wire) and inbound fail-closed (nothing to the agent); AC-003 import-allowlist. INV-5 pinned at the
SNM layer (`m9-core-001-inbound-funnel.test.ts`): direct/recover, held, and release paths all screen.

**Review (feature-dev:code-reviewer opus + cello-test-attacker, both read-only). All resolved.**
- **B1 [blocking]** — the inbound `await` reopened the previously-atomic dedup→append section: two
  concurrent same-hash ingests (direct retry + park-recovery on reconnect) could double-append a leaf
  → root divergence. Fixed with a post-await dedup re-check; deterministic regression test (slow gateway
  forces the interleave, asserts one leaf).
- **TA1 [blocking test]** — inbound funnel was only proven on the direct path. Added SNM-level
  blocking/counting-gateway tests for recover + held + release (kills the screen-in-stream-handler-only
  and screen-after-hold bypasses).
- **TA2 [blocking test]** — AC-003 was a non-recursive class-name scan; replaced with a recursive
  import-allowlist (forbids the daemon importing the gateway server/screen symbols).
- **H1 [high]** — added the story's `security.gateway.connected` (startup, mode) and
  `security.gateway.unavailable` (error, direction/reason/correlationId); asserted in the seam tests.
- **M1 [medium]** — `server.stop()` hung with a live client connection; track + destroy sockets.
- **M2 [medium] — reasoned scope decision (NOT silently dropped).** The reviewer's "always append the
  leaf" would BREAK fail-closed redelivery: a TRANSIENT gateway outage must NOT commit a leaf, or dedup
  swallows the sender's redelivery and the agent never gets the message. M9-CORE-001's only block is
  transient fail-closed, so screen-before-append (no leaf) is correct. The terminal-block case (record
  the leaf + ack so the sender stops, gate only the agent buffer) lands with the first real block
  verdict — **owned by M9-IN-002**. Captured in a code comment at the inbound seam.
- **L2** guidance wording (recovery is sender redelivery, not a local re-screen). **L4** spawn force-timer
  cleared on early exit. **TA4** request log carries a `contentSha256` fingerprint (identity, not length).
- **L1 / L3 (forward, noted):** L1 — the outbound allow path sends the original bytes; `redact` (which
  sends `verdict.content`) is wired in **M9-FEED-001**. L3 — the retry-queue flush re-sends already-
  screened-allow content without re-screening; a policy change between screen and flush won't re-apply —
  revisit in **M9-FEED-001 / M9-OUT-***.

**Deferred to the composition root / gate (not a CORE-001 gap):** the production daemon bin spawning the
sidecar + eager-connect is proven by **M9-GATE-1** (the Phase-1 local E2E). M9-CORE-001 wired the seam +
injection and proved it with a test-spawned gateway.

**Status.** M9-CORE-001 → 🟡 (built, own ACs green; Phase-1 gate M9-GATE-1 not yet run). Nothing pushed;
nothing on `main`.

**Next.** M9-IN-001 (inbound Layer-1 deterministic sanitization) — the first detector, plugs into
`createGatewayServer`'s screen fn. Attack corpus present (`attack-corpus-reference.md`). Unit altitude:
real malicious input → real verdict, RE2 mandatory, no network/model.

---

## 2026-06-22 — M9-IN-001 sanitizer built (partial, 🟡); 3 library/model decisions queued for Andre

**Built (cello-client `m9-build`, commit `9878c8d`).** `core/gateway/src/detect/sanitize.ts` — the
inbound Layer-1 sanitizer, a pure no-model/no-network function (INV-1) covering the dependency-free
steps: size cap (AC-005), invisible/smuggled-Unicode strip (AC-001/SI-001 — Tags block, zero-width,
BOM, soft hyphen, variation selectors, bidi controls; zero smuggled codepoints survive even split
across runs), confusables (NFKC + Cyrillic/Greek map), encoded-payload decode (HTML/percent/\x/\u),
Shannon-entropy scoring (AC-003), special-token strip (AC-004). 8 unit tests with real corpus
payloads; gateway typecheck + lint + 15 tests green.

**Status: M9-IN-001 is partial (🟡).** What's NOT done and why:
- **AC-002 (RE2 injection-pattern match) — PARKED on a decision.** Needs a linear-time RE2 engine.
- The sanitizer is **not yet wired** into the gateway inbound screen fn — that needs the inbound
  verdict assembly (sanitize → scan → verdict) + the seam content-transform plumbing (deliver
  sanitized text to the agent while the Merkle leaf keeps the original hash). Lands with M9-IN-002
  and is proven by M9-GATE-1.

### ⚠️ DECISIONS FOR ANDRE (morning) — the inbound detector library/model stack

These three all touch the **install-size priority** in CLAUDE.md (the gateway ships bundled with the
client for local-sidecar mode, so its deps hit `npm install`). I parked them rather than guess:

1. **RE2 binding (M9-IN-001 AC-002).** `re2@1.25.0` — native (Google RE2 via node-gyp; maintained;
   ships prebuilt binaries for common platforms, compile fallback otherwise) vs `re2-wasm@1.0.2` —
   prebuilt WASM, **zero compile** (your install-size priority) but **unmaintained since ~2021**.
   Tradeoff: maintenance/supply-chain (favors native) vs install size (favors WASM). My lean: native
   `re2` for a security pattern engine, IF its prebuilts cover our targets so there's no compile.
2. **DeBERTa scanner runtime + model (M9-IN-002).** Pre-downloaded DeBERTa-v3-small INT8 (per the
   M8 scope memory) + an ONNX runtime (`onnxruntime-node`, native). The **model file is large**
   (tens-to-hundreds of MB) — a real install-size question: bundle it in the client? lazy-download on
   first use? ship it only with the remote/Phase-2 gateway and skip local inbound L2 for the
   individual launch? This is the biggest install-size call in M9.
3. **Language detector (M9-IN-003).** A small pure-JS n-gram detector (e.g. `franc`, ~tens of KB,
   no native) for the English-allowlist. Low-risk; likely just pick `franc` — confirming it's
   acceptable.

**Plan while these are parked.** Keep building the dependency-free detectors in the same phase:
M9-OUT-001 (outbound secret detection — gitleaks-style ANCHORED patterns, plain RegExp is safe, no
ReDoS/RE2 needed) is fully completable tonight. M9-FEED-001 (the verdict-return feedback channel) is
also fork-free and completes CORE-001's stubbed outbound verdict handling. I'll do OUT-001 next; the
inbound stories (IN-002/IN-003) wait on the decisions above.

---

## 2026-06-22 — M9-OUT-004 built (🟡, complete unit). OUT-001 reclassified as decision-coupled.

**Reclassified OUT-001.** Doing M9-OUT-001 to the bar (the FULL 222-detector gitleaks dictionary,
which is RE2-authored) couples it to BOTH the parked RE2-binding decision AND a large
rule-port data task — so it is NOT cleanly fork-free tonight. Deferred with the other detectors.

**Built M9-OUT-004 (cello-client `m9-build`, commit `e028b38`) — a complete, fork-free unit.**
`core/gateway/src/detect/rate-limit.ts` — `OutboundRateLimiter`, a per-agent-identity sliding-window
limiter (keyed on the agent identity, never a source IP), pure in-memory, deterministic via an
injectable clock. AC-001 (N+1th throttled with a distinct `rate_limited` reason + retry-after; a
throttled attempt consumes no slot) and AC-002 (under-cap never throttled/delayed) both green, plus
window-slide and per-agent-isolation tests. 5 unit tests; gateway 20 tests + lint + typecheck green.
The throttle verdict surfaces through CORE-001's outbound never-hang seam; the screen-fn assembly
(detector chain → verdict) is M9-GATE-1's job.

**Standing (all on `m9-build`, nothing pushed, nothing on `main`):**
- M9-CORE-001 🟡 — complete + reviewed (the gateway package + daemon seam).
- M9-IN-001 🟡½ — sanitizer built; AC-002 (RE2) parked; not yet wired into the screen fn.
- M9-OUT-004 🟡 — complete.
- Tests: daemon 378, gateway 20 — all green.

**Decisions waiting on Andre (see the prior entry):** (1) RE2 binding, (2) DeBERTa runtime+model
install-size strategy, (3) language detector. These gate the in-phase-order inbound detectors.

**Recommended next (Andre's call in the morning):** resolve the 3 decisions → unblocks IN-002/IN-003
and OUT-001 (full gitleaks). The remaining fork-free keystone is **M9-FEED-001** (the verdict-return
feedback channel: the four dispositions, never-hang deadlines, the stateless re-send with
`governance_decisions`) — it completes CORE-001's stubbed redact/warn handling and every detector's
return path depends on it. It is intricate (it changes the `cello_send` contract), so it is the next
thing I will take on if the autonomous window continues, building it red-first with the design note
first per Procedure §6 and the full reviewer pass.
