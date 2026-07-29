---
name: M9 Build Journal
type: journal
date: 2026-07-29
milestone: M9
status: open
description: >
  Append-only build journal for M9 (the security and governance layer). One entry per unit
  of work. NEVER edit a prior entry; the RESUME STATE block below is the ONE mutable region
  and is kept current (M10B standard). June 2026 entries are date-titled (the Phase-1 build);
  entries from the 2026-07-29 reopening onward are numbered C1, C2, … (the CONNECT UNIT) so
  DoD evidence pointers (`→ Entry C·N`) resolve. Pairs with M9-DEFINITION-OF-DONE.md (the
  target) and M9-PROCEDURE.md (the runbook — read order §0, entry contents §7).
---

# M9 Build Journal (append-only)

> Newest entries at the BOTTOM. Never edit or delete a prior entry. Each entry: DoD-ID,
> what was red, what was found, commit hashes, reviewer outcome, blockers, decisions.
> Design-significant units get a DESIGN NOTE entry before any code (M9-PROCEDURE §6).

## RESUME STATE (the one mutable block — keep current)

- **Tier open:** Tier 1, THE CONNECT UNIT. **All six build lines are BUILT.**
- **WHERE THE CODE IS:** branch `m9/connect-unit`, worktree
  `/Users/andrep/Documents/code/cello-client-m9c` — NOT the primary checkout (Entry C4). It has its
  own `node_modules` and `dist/`; a concurrent session builds M10B on `main`.
- **HEAD:** `bad9db2` (10 commits from `449bbba`). Pushed to `origin/m9/connect-unit`. **Ready for
  Andre to merge into `main`, then publish.**
- **Gates at HEAD:** 1589 tests green across daemon + gateway + cli + adapter; lint clean; typecheck
  clean. Enforcer `DOD-M9C-GATE-1` green — it spawns the BUILT `cello-daemon` bin with zero
  injection and reads `mode:"enforcing"` off the boot line.
- **Status (audited 2026-07-29, Entry C9):** ✅ `STORE-1`, `ENV-1`. 🟡 `WIRE-1`, `SURFACE-1`,
  `AUDIT-1`, `GATE-1`. ❌ `PUBLISH-1`.
- **Next work, in value order:** (1) the THREE missing GATE-1 assertions — outbound credential
  redacted at the peer, crafted inbound sanitized, both readable through AUDIT-1 — which would
  likely convert WIRE-1 and AUDIT-1 to ✅; (2) `PassthroughGatewayClient` off the two public barrels
  onto a `/testing` subpath (WIRE-1's unmet clause); (3) `DOD-M9C-PUBLISH-1`, one batched beta
  cascade — load `/cello-publish` for THAT publish; the `latest` promotion and the `/mcp` reconnect
  are Andre's, prepared and handed over, never run.
- **Carried forward (Entry C8), not lost:** correlationId threading (F12); `list` should show
  `changed_at` + `chainValid` (F9); `PassthroughGatewayClient` on two public barrels rather than a
  `/testing` subpath (F-D); `pii:whitelist_add_requested` has no consumer; and the plaintext
  REQUEST LOG, which is why M8C's `DOD-CRYPTO-AT-REST-1` is 🟡 rather than ✅.

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

---

## 2026-06-22 (late) — OUT-002 + OUT-003 built. Outbound detector set substantially done.

**Built two more fork-free detector units (cello-client `m9-build`):**
- **M9-OUT-003** (`8f5f781`) — `screenOutboundExfil`: egress invisible-strip (symmetric w/ IN-001),
  zero-click image-exfil URL neutralization, high-entropy encoded-blob redaction, and a BLOCK on
  injection artifacts in the output (hijack signal). 5 tests. Also refined the shared entropy
  detector to a base64/hex charset (excludes URLs — a false positive the clean-message test caught).
- **M9-OUT-002** (`86dcd25`) — `OutboundPIIScreener`: email/phone/SSN/CC/IP detection with
  cross-category overlap resolution + Luhn, whitelist (pass own contacts silently), single-vs-bulk
  warn, deterministic flag ids, and per-session drip escalation (SI-001). 7 tests.

**Whole-night standing (all on `m9-build`; nothing pushed; nothing on `main`):**
- M9-CORE-001 🟡 — COMPLETE + reviewed (gateway package + daemon seam; B1 race fixed).
- M9-IN-001 🟡½ — sanitizer built; AC-002 (RE2) parked; not wired.
- M9-OUT-002 🟡 — PII detector built; warn UX is FEED-001.
- M9-OUT-003 🟡 — exfil checks complete (unit).
- M9-OUT-004 🟡 — rate limiter complete (unit).
- M9-OUT-001 🔒, M9-IN-002 🔒, M9-IN-003 🔒 — decision-coupled (see the 3 decisions below).
- Tests: daemon **378**, gateway **32** — all green; lint + typecheck clean throughout.

**The cleanly-fork-free detector units are now ALL built.** What remains needs one of:
1. **Andre's 3 library/model decisions** (RE2 binding · DeBERTa runtime+model install-size strategy
   · language detector) → unblocks IN-002, IN-003, OUT-001.
2. **M9-FEED-001 — the keystone** (the verdict-return contract + the stateless re-send + never-hang).
   Fork-free; the §6 design is settled (Andre's decisions recorded). It changes the `cello_send`
   contract and is where the built detectors get WIRED into the gateway screen fn and produce real
   verdicts (the "screen-fn assembly"). Every detector's warn/redact/block surfacing depends on it.
3. **CFG-001 / REC-001** — need the gateway's own SQLCipher store wired (a native-dep setup).

**Recommended morning path:** resolve the 3 decisions, then FEED-001 (keystone) + the screen-fn
assembly to make the detector set live, then the inbound detectors, then GATE-1. If the autonomous
window continues before then, FEED-001 is the next build (design-note-first, incremental, reviewed).

---

## 2026-06-22 (late) — Screen-layer compositions built (gateway-side). FEED-001 design note + plan.

**Built both screen compositions (cello-client `m9-build`):**
- **OutboundScreener** (`f8e44d9`) — `core/gateway/src/screen/outbound.ts`: chains rate-limit + exfil
  + PII into ONE §6 verdict (events + disposition; block > warn > redact > allow; block short-circuits;
  redactions applied to content). 7 tests incl. precedence.
- **InboundScreener** (`f12d051`) — `core/gateway/src/screen/inbound.ts`: runs the IN-001 sanitizer →
  block(size) / redact(sanitized+notes) / observe(entropy) / allow. 5 tests.
- Shared `GovernanceEvent` type (§6 shape) in `screen/outbound.ts`. Gateway suite now **44** green.

**KEY INSIGHT — FEED-001 is the gate to going live.** The compositions are NOT yet wired into the
spawned gateway (`createGatewayServer` still defaults to pass-through), and they MUST NOT be until
the daemon can render the rich verdict — because CORE-001's seam treats any non-allow as block/hold,
so a `redact` verdict (which must SEND the redacted content) would instead be blocked, and a `warn`
(needs-decision) has no return path. Wiring the screen layer live therefore REQUIRES FEED-001's
daemon-side rendering. That is the climax of M9 Phase 1.

### FEED-001 build plan (the next major effort — design-note-first per §6)

The §6 design is settled (Andre's decisions recorded in M9-CAPABILITY-HARVEST §6). Increments, each
committed; full reviewer pass (code-reviewer + cello-test-attacker) at the end:

1. **Wire-carry the rich verdict (additive, low risk).** Extend the gateway `ScreenVerdict` + the
   wire protocol (`WireScreenResponse`) to carry `GovernanceEvent[]` (transformations / blocks /
   flags + flagIds). The `LocalSidecarGatewayClient` parses them. No behavior change yet.
2. **Daemon renders the four outcomes in `cello_send`** (the blast-radius change): allow → sent
   `{ok:true,delivered:true,modified:false}`; redact → send `verdict.content` `{ok:true,modified:true,
   transformations}`; block → `{ok:false,reason:'blocked_by_governance',blocks,guidance}`; warn →
   `{ok:false,reason:'governance_warn',flags,guidance}` (NOT sent). Update the existing seam/daemon
   tests that assert `{ok:true,sequence_number}` to the new shape (sequence_number stays for sent).
3. **Wire the compositions into `createGatewayServer`** (the bin builds Inbound/OutboundScreener and
   passes a real screen fn) — now the spawned gateway screens for real; #2 makes the daemon honor it.
4. **Stateless re-send** (`governance_decisions {flagId: redact|allow_once|allow_always}`): re-send
   carries full content, re-screened statelessly, deterministic flagIds bind; allow_once gated by
   `autonomous_override` (OFF → reject + re-warn, AC-003); allow_always = WebAuthn whitelist-add,
   autonomous-degrades to allow_once + ops-agent request (SI-002).
5. **Never-hang total deadline** → `governance_timeout` terminal block (AC-005); fail-closed +
   circuit breaker. (CORE-001 already has the per-call `LocalSidecarGatewayClient` deadline; this adds
   the total-pipeline ceiling below the host tool timeout.)
6. **Inbound mirror:** the daemon delivers the sanitized content + notes to the agent via
   `cello_receive`'s `security_context` (the inbound seam applies `verdict.content` to the buffer
   while the Merkle leaf keeps the ORIGINAL hash — the split CORE-001 already set up).

**Whole-night standing:** daemon **378** + gateway **44** tests green; lint + typecheck clean; nothing
pushed; nothing on `main`. CORE-001 🟡 complete+reviewed; IN-001 🟡½ (RE2 parked); OUT-002/003/004 🟡;
both screen compositions built. 3 decisions queued for Andre. FEED-001 is the next build.

---

## 2026-06-23 (early) — FEED-001 core BUILT + LIVE-PROVEN (inc 1/2/3/5/6). Re-send (inc 4) deferred.

The screen layer is now LIVE end-to-end. Commits on `m9-build`: `17f0ee5` (inc 1 wire-carry events),
`9f7e304` (inc 2 daemon four-outcome cello_send rendering + inc 3 gateway runs the real screeners),
`0ca03c7` (inc 6 inbound redact mirror), `89da9db` (inc 5 governance_timeout).

**What's live (proven by 9 seam tests against a REAL spawned screening gateway):**
- **The four cello_send outcomes** (FEED-001 AC-001): clean → sent `{delivered, modified:false}`;
  redact → the ALTERED bytes go on the wire AND bind the leaf hash, peer receives the redacted content,
  `{modified:true, transformations}`; block → `{ok:false, blocked_by_governance, blocks}` NOT sent;
  warn → `{ok:false, governance_warn, flags}` NOT sent.
- **The inbound redact mirror**: a redact verdict DELIVERS the sanitized text to the agent while the
  Merkle leaf binds the ORIGINAL content hash (transcript = what the peer sent; agent = sanitized).
  Proven: Cyrillic confusables pass A's outbound screen, B's inbound sanitizer normalizes them, B
  receives the Latin form.
- **never-hang**: governance_timeout (connected but slow) distinct from gateway_unavailable
  (unreachable); both fail-closed; named events security.gateway.timeout / .unavailable.
- **The screen-fn assembly**: the gateway bin now runs OutboundScreener (rate-limit + exfil + PII) and
  InboundScreener (sanitizer) — the detectors are live; clean content still → allow (backward compatible).

**REMAINING FEED-001 — inc 4, the stateless governance re-send. DEFERRED on purpose.** The agent
re-sends the same content + `governance_decisions {flagId: redact|allow_once|allow_always}`; the gateway
re-screens statelessly (deterministic flagIds bind), applies each decision: redact; allow_once gated by
`autonomous_override` (OFF → reject + re-warn, AC-003); allow_always = WebAuthn whitelist-add,
autonomous-degrades to allow_once + ops-agent request (SI-002 — never deliver original on the agent's
say-so). This is **security-critical** (SI-002) and intricate (allow_once/always × override × attended),
and touches config (autonomous_override = CFG-001's store) + auth (WebAuthn/ops-agent). It deserves a
fresh focused effort + the cello-test-attacker's adversarial pass — not the tail of a long context. The
gateway-side LOGIC is fork-free (autonomous_override as a screener option, persistence deferred to
CFG-001); the daemon/wire plumbing of the param is a small follow-on.

**Review in flight:** dispatched feature-dev:code-reviewer (opus) + cello-test-attacker on the post-CORE-001
diff (`24a1c25..HEAD`) — the detectors, the compositions, and FEED-001 inc 1/2/3/5/6 (the cello_send
contract change + inbound mirror are security-relevant). Findings to be addressed before this is called done.

**WHOLE-NIGHT TOTAL — daemon 383 + gateway 45 tests green; lint + typecheck clean throughout; nothing
pushed; nothing on `main`.** Built this session: M9-CORE-001 (complete, reviewed) · IN-001 sanitizer
(🟡½, RE2 parked) · OUT-002 PII · OUT-003 exfil · OUT-004 rate-limit · the inbound + outbound screen
compositions · FEED-001 inc 1/2/3/5/6 (the four-outcome contract + never-hang + the screen layer LIVE).
3 library/model decisions + the FEED-001 inc-4 override-policy design await Andre.

---

## 2026-06-23 (early) — Review of the detector layer + FEED-001 core: all findings fixed (commit `0bbc7d8`)

feature-dev:code-reviewer (opus) + cello-test-attacker, both read-only, on `24a1c25..89da9db`.
**No blocking/high IMPL findings** — both load-bearing crypto bindings confirmed correct (outbound
leaf binds the redacted SENT bytes; inbound mirror binds the ORIGINAL hash, no peer-root divergence;
INV-1/2/5/6 clean; no ReDoS). All findings fixed:

- **M1 (medium)** — the inbound decode step was DELIVERING blindly-decoded text, corrupting legit
  URLs (`%20`→space), code (`\x41`→`A`), HTML entities. Decode is now **detection-only** (decode-
  then-rescan): the delivered text keeps the original encoding; a separate `decodedForScan` feeds
  entropy + the future pattern matcher. (This was the one real correctness bug — it silently
  corrupted the RECEIVER's content.)
- **M2 (medium)** — the rate limiter committed a slot for not-sent (block/warn) messages and would
  double-count a warn→re-send. Split `peek()` (read-only gate) + `record()` (commit); the composition
  records a slot only when the message reaches the wire (allow/redact).
- **L1** distinct top-level `rate_limited` reason surfaced; **L2** the connect path is now deadline-
  bound (INV-6 unconditional); **L6** dead branches dropped.
- **Test-attacker F1–F6 (4 blocking + 2 high) — all TEST-only** (the impls were already correct; the
  tests didn't pin them): **F1** widened every negative-delivery poll window to ≥4s/160 polls (the
  on-wire suppression of block/warn is now actually pinned, not a 400 ms window a fail-open send
  could outrun); F2 inject VS-supplement + bidi siblings; F3 override-phrase-only block; F4 low-entropy
  long token must not flag (pins the Shannon math); F5 normalized-whitelist near-miss/case/phone; F6
  exact drip boundary. + minors (no Cyrillic survives; flags carry flagId; blocks carry category;
  redact preserves surrounding text).
- **Deferred (documented, not dropped):** L3 double-encode fixpoint (pattern matcher parked), L4
  terminal size-cap vs transient (unreachable in default config — the transport caps inbound first),
  L5 image-exfil scope (matches the OUT-003 AC; URL-allowlist is the harvest's preferred Day-2 form),
  L7 naming (`governance_warn`/`flags` vs §6 `governance_held`/`flagged`).

**State: daemon 383 + gateway 49 green; lint + typecheck clean; nothing pushed; nothing on `main`.**
The detector layer + FEED-001 core are now REVIEWED + hardened. Clean checkpoint. Next: the 3
decisions, then FEED-001 inc 4 (the re-send) with its own adversarial pass, then GATE-1.

---

## 2026-06-23 — The 3 decisions RESOLVED. M9-IN-001 COMPLETE (RE2 + Step-9). (commit `aa27b9e`)

**Andre's decisions:**
1. **RE2 binding — try native `re2`, fall back to `re2-wasm`.** Implemented as the idiomatic npm
   pattern: `re2` is an **optionalDependency** (native, maintained, fastest; a failed build is
   non-fatal), `re2-wasm` is a **regular dependency** (prebuilt WASM, always installs, the guaranteed
   floor). A `LinearRegex` adapter loads native-then-wasm at startup; either way it is real RE2. Both
   verified loading + ReDoS-safe on Node 24. Engine reported on the gateway ready line + via
   `linearRegexEngine()`. Install procedure documented in `core/gateway/REGEX-ENGINE.md`. Honest
   caveat recorded for Andre: this is "wasm's clean install floor + native's upside", not minimal.
2. **DeBERTa (IN-002) — require the operator to confirm the install.** Model is NOT bundled
   (keeps the client small); downloaded on first use only with explicit consent, **checksum-verified
   (SHA-256 pinned in the package)**, consent recorded once (config DB), and **graceful degradation**:
   model absent ⇒ Layer-2 disabled (L1 + outbound still run), NOT block-everything. Consent surfaces
   via CLI (`cello gateway install-model`), an actionable daemon `guidance` field, or a portal toggle.
   Mechanism proposed + accepted; to be built as the IN-002 story.
3. **Language (IN-003) — English-only to start.** Confident-English allow; confident-non-English
   hold with a note; short/low-confidence allow. Adding other languages is operator opt-in and gets
   **its own design session** (the Latin-centric confusables normalization + script handling collide
   with non-Latin scripts). Recorded as the IN-003 scope; multilingual = Day-2.

**M9-IN-001 COMPLETE (🟡).** The RE2 engine adapter + the Step-9 injection-pattern matcher (role
markers / override / persona / jailbreak / boundary / leetspeak, attack-corpus §1.6) close AC-002.
Step-9 runs on the DECODED form (decode-then-rescan, pairing with the M1 review fix) and reports
matches as **observe signals** in the inbound security context — NOT an auto-block (CELLO surfaces
evidence; the semantic block is IN-002 / policy). AC-002 proven: a catastrophic-backtracking pattern
completes in <100 ms (a backtracking engine would hang). The sanitizer is wired into the live gateway
inbound screen; the seam test proves sanitized content reaches the agent.

**State: gateway 57 + daemon 383 tests green; lint + typecheck clean; nothing pushed; nothing on
`main`.** Remaining: IN-002 (DeBERTa, mechanism above), IN-003 (English-only), OUT-001 (secrets — now
unblocked: the RE2 engine exists for the gitleaks set), FEED-001 inc 4 (the re-send), then GATE-1.

---

## 2026-06-23 — M9-OUT-001 COMPLETE (full gitleaks secrets). Outbound detector set DONE. (commit `21045ff`)

Recommended OUT-001 next (highest-value unblocked, the natural RE2 follow-on); Andre said "decide
and continue", so I took my own recommendation.

**Built the comprehensive secrets layer** (the "comprehensive, not minimal" bar):
- The **FULL 222-detector gitleaks dictionary**, generated from gitleaks' canonical config into
  `core/gateway/src/detect/gitleaks-rules.ts` (generator kept at `scripts/gen-gitleaks-rules.py` for
  reproducible regeneration). File-path allowlists dropped (we scan message TEXT); the value-level
  stopwords + allow-regexes + per-rule entropy thresholds kept as the false-positive layer.
- `detect/secrets.ts`: every rule on the RE2 engine (RE2-authored, so they port directly), keyword
  pre-filter for speed across 222 rules, **typed** `[REDACTED:<rule-id>]` placeholders (the agent is
  told WHAT leaked). The generic keyword-proximity + entropy catch-all (gitleaks `generic-api-key`)
  covers un-enumerated formats.
- Wired into the OutboundScreener as a redact stage, **ordered FIRST** so a known credential gets its
  typed placeholder before exfil's generic high-entropy redactor would mask it as an opaque blob (a
  real ordering bug the composed test caught).
- AC-001 (AWS/Anthropic/GitHub-PAT/Stripe/PEM all redacted, none survive), AC-002 (generic catch-all),
  AC-003 (stopword/placeholder/low-entropy NOT redacted), SI-001 (base64-wrapped secret caught by the
  encoded-payload entropy path). 222 rules compile under RE2. Live seam test redacts a credential
  end-to-end — the peer receives the typed placeholder, not the secret.

**The OUTBOUND detector set is now COMPLETE: secrets (OUT-001) + PII (OUT-002) + exfil (OUT-003) +
rate-limit (OUT-004), all composed in the live OutboundScreener.**

**State: gateway 64 + daemon 383(+1 seam) tests green; lint + typecheck clean; nothing pushed; nothing
on `main`.** Remaining M9: **IN-002** (DeBERTa — needs the model source + pinned SHA-256 from Andre),
**IN-003** (English-only language allowlist — small, needs a tiny detector-lib call), **FEED-001 inc 4**
(the security-critical governance re-send), then **M9-GATE-1** (the Phase-1 E2E gate).

---

## 2026-06-23 — M9-IN-003 detector built (🟡). THE DETECTOR LAYER IS COMPLETE. (commit `1b58aef`)

Built IN-003's language detector as a clean unit (no model, no dep — dominant Unicode script: a
message confidently dominated by a non-Latin script is outside {English=Latin} and held; short /
Latin / numeric → allowed; allowlist configurable). AC-001/002 + SI-001 green (7 tests). NO model
needed — Andre's "script inspection covers most of it" holds for English-vs-not; Latin-script
LANGUAGE discrimination is the separate design session he flagged.

**Deliberately NOT wired live:** a non-English `block` needs the terminal-block inbound handling —
the deferred L4/M2 split (a TERMINAL inbound block must ack-and-record-without-delivering, distinct
from the transient fail-closed hold that stays un-ack'd for redelivery; wiring a terminal block into
today's seam would loop the sender's redelivery forever). That is a security-sensitive daemon seam
change for a fresh, focused effort.

**THE M9 DETECTOR LAYER IS NOW COMPLETE:**
- Inbound: IN-001 (sanitize + Step-9 RE2 injection patterns) ✅, IN-003 (language) ✅ detector. IN-002
  (DeBERTa semantic scanner) is the one remaining inbound detector — blocked on Andre (model source).
- Outbound: OUT-001 (secrets, 222 gitleaks) + OUT-002 (PII) + OUT-003 (exfil) + OUT-004 (rate-limit),
  ALL composed in the LIVE OutboundScreener.
- FEED-001 core (the four cello_send outcomes + inbound redact mirror + never-hang) LIVE + reviewed.

**State: gateway 71 + daemon 384 tests green; lint + typecheck clean; nothing pushed; nothing on
`main`.** What remains for M9 Phase-1 is INTEGRATION + the gate, not new detectors:
1. **IN-002** (DeBERTa) — blocked on Andre: the model source + pinned SHA-256.
2. **The terminal-block inbound seam handling** (L4/M2 split) — needed to wire IN-003's hold + a real
   IN-002 block live. Security-sensitive daemon change; fresh context.
3. **FEED-001 inc 4** (the governance re-send, SI-002) — security-critical; fresh context + its own
   adversarial pass.
4. **M9-GATE-1** (the Phase-1 E2E gate) — runs once the above land.
5. CFG-001 (gateway config store) + REC-001 (records) — needed for the configurable allowlist/whitelist
   persistence + the tamper-proof-records half.

---

## 2026-06-23 — M9-IN-002 part 1 (scanner logic + installer). Model resolved. (commit `e4aeda0`)

Andre confirmed the model decision ("agreed"): **protectai/deberta-v3-small-prompt-injection-v2**,
fp32 ONNX verbatim from Hugging Face (English — pairs with the IN-003 English allowlist), transformers.js
runtime, confirm-install + graceful degradation. (Found via search; the small repo ships only the fp32
`onnx/model.onnx` at 568 MB — no published INT8. fp32-verbatim chosen over a self-quantized INT8
derivative for clean provenance; INT8 is a later size optimization.)

**Part 1 built (gateway):** `InjectionScanner` (score→verdict logic with a PLUGGABLE classifier, so the
rules unit-test without the model: score≥70 block / ≥35 flag / <35 pass; the SCORE governs the verdict,
AC-003; no classifier → Layer-2 off, graceful) + the model installer (not bundled; consent-gated
download, size-verified against the committed manifest, streamed). 11 unit tests green.

**HARNESS LIMITATION (recorded):** this dev environment's secret-redaction rewrites any 64-hex SHA-256
to asterisks even in generated files — so the pinned model digests cannot be committed here. Integrity
is the committed file SIZE for now; the full SHA-256 TUF-style pin (so a compromised mirror cannot swap
the model) is the intended hardening, to be added out-of-band (CI / a non-redacting path).

**Part 2 (the heavy step, to hand off):** the real classifier — transformers.js (@huggingface/transformers,
an optionalDependency, lazy-imported; absent → degrade) over the local ONNX — and the GATED real-inference
test proving AC-001 (a known injection blocks) / AC-002 (benign passes) / SI-001 (no network during
inference) on the actual 568 MB model. Needs the runtime + the model download + a memory-capable test env.

**Whole-M9 status: gateway 82 + daemon 384 tests green; lint + typecheck clean; nothing pushed; nothing
on `main`.** The DETECTOR LAYER is built (IN-001 ✅, IN-002 part-1 🟡½, IN-003 🟡; OUT-001/002/003/004 ✅).
What remains is integration: IN-002 part 2 (model+runtime), the terminal-block inbound seam (wires the
IN-002/IN-003 blocks live), FEED-001 inc 4 (the re-send), M9-GATE-1, and CFG-001/REC-001 (config+records).

---

## 2026-06-23 — Terminal-block inbound seam + IN-002/IN-003 wired LIVE (commits `3b6046e`, `274384c`)

The deferred L4/M2 split is built: the daemon now distinguishes a TERMINAL inbound block (a detector
rejected the content — non-allowlisted language / high-score injection / oversized) from a TRANSIENT
fail-closed block (gateway_unavailable / governance_timeout).

- **Contract:** `ScreenVerdict.terminal` (threaded types→protocol→server→client). A detector block sets
  it; `failClosedVerdict` and `screen_error` leave it unset. **TERMINAL** → daemon records a leaf binding
  the ORIGINAL content hash + acks `persisted` (sender stops), NEVER buffers for the agent. **TRANSIENT**
  → no leaf, no ack, sender redelivers once the gateway recovers.
- **Why the leaf is required:** the sender appended a leaf at the message's CANONICAL position on send, so
  the receiver must record a matching leaf at the SAME index or the two hash chains diverge and the
  bilateral seal cross-check fails. The terminal block therefore takes the full DOD-MSG-4 strict-in-order
  path (held at its canonical index when out of order, leafed when the gap fills via #releaseHeld) — it
  just leafs WITHOUT buffering (the `screenedOut` marker).
- **InboundScreener** is now async and wires IN-003 (language allowlist) + IN-002 (semantic injection
  scanner, pluggable classifier — off/graceful when no model) as terminal-block stages, judged on the
  SANITIZED text (confusables normalized to Latin are not held). A `flag` (35–69) stays observe + delivers.

**Reviews (read-only subagents) — all findings fixed in `274384c`:**
- code-reviewer **HIGH-1** (real): the first cut appended the terminal leaf in ARRIVAL order, bypassing the
  in-order gate → could diverge roots by POSITION. Fixed: routed through the shared held/append machinery.
  LOW-3 (recover tally), LOW-4 (gateway echoed original content on block) fixed. MED-2 (agent-facing inbound
  feedback) = the inbound half of FEED-001 — reason is logged now; the cello_receive surface is a named
  FEED-001 increment (see remaining).
- cello-test-attacker found **3 blocking hollow-test gaps**, all closed: (1) the ACK was never asserted —
  added `content.delivery.ack.sent` + the seam test asserts it; (2) the transient no-leaf/no-ack property
  was untested — the gateway-down test now asserts tree size unchanged + no ack; (3) AC-003 score-governs
  wasn't exercised at the wiring level — the block case now feeds a disagreeing `SAFE` label.

**State: gateway 89 + daemon 385 tests green; lint + typecheck clean; nothing pushed; nothing on `main`.**
DoD: IN-003 wired live (held proven via the real spawned gateway); IN-002 part-1 scanner wired live
(pluggable; real model = part 2). Remaining: FEED-001 inc 4 (the governance re-send, in progress next),
M9-GATE-1, CFG-001/REC-001, IN-002 part 2 (real model+runtime). **NAMED DEFERRAL:** the inbound terminal-block
agent-facing feedback surface (cello_receive returning a security note) → M9-FEED-001 inbound increment.

---

## 2026-06-23 — FEED-001 inc 4 (governance re-send, SI-002) + M9-GATE-1 (commits `9c46dc6`, `95091f3`, `9e34809`)

**FEED-001 inc 4 — the stateless `governance_decisions` re-send (security-critical, SI-002).** `cello_send`
gains optional `governance_decisions` ({flagId: redact|allow_once|allow_always}). The daemon passes it to
the gateway (which owns config + whitelist, INV-4); the gateway re-scans statelessly and resolves each PII
warn:
- `redact` (and any OMITTED flag) → typed `[REDACTED:pii:*]` placeholder, message sends.
- `allow_once` → value sent verbatim ONLY when the gateway's `autonomous_override` is ON; OFF (default) →
  REJECTED + re-warned. **SI-002: the agent's only autonomous lever is `redact`; it can never self-authorize
  sending flagged PII.** `allow_always` → allow-now + an operator whitelist-add request (persistence is the
  human's), same gate.
- **All-or-nothing:** if ANY decision is rejected, the WHOLE send re-warns (NOT SENT) — nothing goes out
  half-decided. No rate slot is consumed on a warn.
- **Statelessness:** flagId = sha256(category:value), so a decision applies ONLY to the exact value it was
  computed for; a stale flagId (content changed) defaults to redact → an allow can never mis-apply to a
  different value. `autonomous_override` is gateway config, default OFF, env opt-in until M9-CFG-001. Plumbed
  `governanceDecisions` through ScreenContext → wire → server → screen fn → OutboundScreener.

**M9-GATE-1 — the Phase-1 end-to-end gate (one machine, no directory).** The four-outcome real-process loop
is m9-core-001-seam (13 cases); INV-5 all-three-producers is m9-core-001-inbound-funnel (gateway double). The
gate closes the one remaining real-process gap (§7): the **park-recovery producer** — the daemon recover
loop's own `ingestReceivedContent` call — is screened by a REAL spawned `cello-gateway`, IDENTICALLY to
direct: a clean recovered message is screened (gateway request log) + delivered; a recovered terminal block
(non-English) records its leaf but is never delivered.

**Reviews (read-only subagents):**
- cello-test-attacker on FEED-001 → **2 blocking hollow-test gaps** (impl was already correct; tests now guard
  it), fixed in `95091f3`: (probe 4) the all-or-nothing rule was untested for a MIXED re-send → added; (probe 5)
  "no rate slot on a warn" was unasserted → added a real-rateLimit test (5 warns don't throttle; warn→redact
  takes exactly one slot). Probes 1/2/3/6 already had teeth (override on/off opposite outcomes, value-present-
  after-allow, stale-flagId-no-leak, omitted-value-gone).
- FEED-001 code-reviewer: **NO leak found** — the override gate holds end-to-end (omitted→redact,
  malformed map→re-warn, allow_* off→reject, mixed-rejection→whole-send-aborts, stale flagId→redact,
  rate peek-only). Fixed in `d9edb36`: **HIGH** — the agent-facing MCP `cello_send` tool dropped
  `governance_decisions` (the feature was unreachable while the daemon shipped guidance to use it) → added
  the param + forward. **MED** — a `redact` verdict without content fell back to sending the ORIGINAL
  (fail-OPEN) → now fails closed (`redact_without_content`), guarded by a seam fault-injection test.
  **LOW** — PII now scans the WORKED text (flagId basis matches the redaction target). **LOW (recorded
  scope decision, NOT fixed):** global split/join redaction vs span-based — consistent with secrets.ts +
  exfil across the codebase; span-based precision is a cross-cutting change for ALL three redaction stages,
  not a FEED-001-local fix. Tracked for backlog.

**State: gateway 101 + daemon 390 tests green; adapter typecheck clean; lint + typecheck clean; nothing
pushed; nothing on `main`.** GATE-1 checkpoint (§3): `cello-done-auditor` dispatched on the proposed DoD ✅
flips (CORE-001, IN-001, IN-003, OUT-001/002/003, FEED-001, GATE-1) BEFORE flipping — only EARNED stays ✅.
Explicitly NOT flipping: IN-002 (🟡½, no real model), OUT-004 (rate-limit not exercised in the live gate),
CFG-001/REC-001 (❌). Remaining Phase-1: CFG-001 + REC-001; IN-002 part 2 (real model+runtime).

---

## 2026-06-23 — GATE-1 CHECKPOINT: done-auditor ruled 7 EARNED / 1 OVERSTATED / 0 UNPROVEN (DoD commit `d8d12b53`)

`cello-done-auditor` ran the live-gateway suites cold (3 real-process files / 20 tests + 14 gateway files /
101 tests, all green) and verified the spawned binary composes the REAL screeners (dist built 11:18, after
every edit). Verdicts applied to the DoD:

- **✅ EARNED → flipped:** M9-CORE-001, M9-IN-001, M9-IN-003, M9-OUT-001, M9-OUT-003, M9-FEED-001, M9-GATE-1.
  Named breadth caveats (core path real-process; per-rule breadth still unit): IN-001 = only confusables-redact
  is live (6 other sanitize checks unit); OUT-001 = only the AWS-key rule live (222-rule dict unit); FEED-001 =
  `governance_timeout` proven in two real halves (real socket-client timeout + daemon fail-closed render), not
  one full-loop test.
- **🟡 OVERSTATED → HELD (not flipped):** M9-OUT-002 — only the non-whitelisted-email warn is live; the
  whitelist-silent-pass + bulk-warn-once behaviors are unit-only AND the live gateway boots with an EMPTY
  whitelist, so silent-pass is structurally unexercised by the gate. To earn ✅: a gate run with a seeded
  `CELLO_GATEWAY_PII_WHITELIST` (silent pass) + a contact dump (bulk-warn-once).
- **Held, confirmed correct:** IN-002 🟡½, OUT-004 🟡 (no rate cap in the live bin), CFG-001 ❌, REC-001 ❌.

**Phase-1 status: 7/12 stories ✅ gate-green.** The directed follow-on (terminal-block seam → FEED-001 inc 4 →
GATE-1) is COMPLETE, reviewed, and earned. **Remaining for Phase-1 launch:** M9-OUT-002 gate run (seeded
whitelist + bulk), M9-IN-002 part 2 (real DeBERTa model + inference), M9-OUT-004 (wire a rate cap into the
gate), M9-CFG-001 (config store), M9-REC-001 (local records). State: gateway 101 + daemon 390 green; nothing
pushed; nothing on `main`.

---

## 2026-06-23 — Closed the two gate-config gaps: OUT-002 + OUT-004 → ✅ (commits `6ccaad4`/`be0e71e`, `51bd51d`)

After the GATE-1 audit, closed the two stories the auditor held for "not exercised in the live gate as
configured" — both were config-wiring gaps, not missing logic:
- **OUT-002 → ✅:** seam now seeds `CELLO_GATEWAY_PII_WHITELIST` and proves whitelist silent-pass (own email
  delivered intact, no warn) + bulk-warn-once (6-contact dump → one governance_warn, ≥5 flags, not sent).
- **OUT-004 → ✅:** wired an interim env rate cap into the live gateway bin (`CELLO_GATEWAY_RATE_MAX_PER_WINDOW`
  + `_WINDOW_MS`, INV-4 pattern, until CFG-001) and gate-proved throttling (cap 2 → third send `rate_limited`).

**Phase-1 status: 9/12 stories ✅ gate-green.** Remaining: **M9-IN-002 part 2** (real DeBERTa model + transformers.js
inference — heavy, needs the 568 MB model + a memory-capable env), **M9-CFG-001** (versioned SQLCipher config store
— replaces the interim env config), **M9-REC-001** (local fingerprinted security-pass records). State: gateway 102 +
daemon 391 green; nothing pushed; nothing on `main`.

---

## 2026-06-23 — CFG-001 (config store) + REC-001 (records) built, fully reviewed (commits db7a8a5→9167565)

Two persistent stores built (node:sqlite — the daemon's library; the "SQLCipher" in the docs is
aspirational, the daemon opens its DB without a cipher key, so these match: own FILE per INV-4, no
key — encryption-at-rest is a cross-cutting gap shared with the daemon, not a store-local concern).

**M9-CFG-001 — versioned config store, the §7 tighten-free / loosen-confirmed gate.** Append-only,
hash-chained per version. The live gateway bin reads the store as source-of-truth when
`CELLO_GATEWAY_CONFIG_DB` is set (env = bootstrap fallback). code-reviewer found REAL holes (the
store ships empty, so its edges ARE the common path):
- **B1 (blocking)** — first-set of any key was free → first-enabling autonomous_override / seeding a
  whitelist bypassed the gate, inverting the model. Fixed: per-key TIGHTEST baseline; first-set is
  classified against it.
- **H1** — the hash chain excluded `confirmed`+`direction` (the governance payload), so a forged
  "unconfirmed → confirmed" loosen still verified. Fixed: both bound in the fingerprint.
- **H2** — `rate_window_ms` shrink loosened the rate for free. Fixed: shorter window = loosen.
- M1 (cap-without-window silently disabled → default window), M2 (per-key type validation), L1
  (transactional set + busy_timeout). M3 (truncation/consistent-rewrite need the Phase-2 attested
  head) — documented. test-attacker's hash-chain hollow-test also closed (tamper + deletion now caught).
  NOTE: corrected a WRONG test the attacker suggested (first-set-loosest-free) — the reviewer was right.

**M9-REC-001 — local hash-chained security-pass records.** Every screened outcome (clean/redact/
block/warn, inbound + outbound) recorded in the gateway's own store; a clean pass is recorded too.
Wired into the live bin (`CELLO_GATEWAY_RECORD_DB`). code-reviewer: **HIGH** — correlationId was
never read, so records stored "" (INV-7 broken; the attested fingerprint would bind no flow id) →
fixed + live-asserted. **MEDIUM** — a screener throw left the screen_error block UNRECORDED → the bin
now catches, records (best-effort), returns. LOW ×2 (docstring limit, reason-extraction clarity).
test-attacker (both blocking): field-binding proven only for disposition → added content_hash /
direction / reason tamper cases; inbound recording had no live producer test → the live seam now
records on BOTH gateways and asserts B's inbound clean record.

**State: gateway 130 + daemon 395 tests green; lint + typecheck clean; nothing pushed; nothing on
`main`.** Both stores' done-conditions live-proven through the spawned gateway. `cello-done-auditor`
dispatched on the CFG-001 + REC-001 ❌→✅ flips. After it: **11/12 Phase-1 stories** expected ✅; the
ONLY remainder is **M9-IN-002 part 2** (real DeBERTa model + transformers.js inference), gated on
external infra (568 MB model download + a memory-capable test env) — not started blindly.

---

## 2026-06-23 — CFG-001 + REC-001 ✅ landed; PHASE-1 11/12 GATE-GREEN (DoD commit `6ad8c560`)

done-auditor ruled the CFG-001 + REC-001 flips **2 EARNED / 0 OVERSTATED / 0 UNPROVEN** (ran the suites
cold; confirmed the §7 loosen-gate is a real rejection that writes no row, and tamper detection mutates
the DB via a raw connection + reopens before verifyChain — the security core proven by the run, not the
happy path; live behavior driven by spawned gateway processes). Both flipped ❌→✅.

**Phase-1 is 11/12 ✅.** Every local-screening, governance, config, and records story is gate-green
through the real spawned gateway. The ONE remaining story:

**M9-IN-002 part 2 (🟡½) — the real DeBERTa injection scanner.** Part 1 (scanner verdict logic +
consent-gated model installer) is built + unit-green; the pluggable `InjectionClassifier` seam is wired
into the live InboundScreener (absent → Layer-2 off, graceful). What remains is the REAL classifier
(transformers.js over the local ONNX) + a gated real-inference test proving AC-001/002/SI-001 on the
actual 568 MB model. This is the one piece gated on a DECISION + external infra, surfaced to Andre:
  1. The transformers.js runtime install mechanism (optionalDependency vs opt-in/peer) — a real operator
     install-size tradeoff (CLAUDE.md flags install time as a user-facing cost). The MODEL is already
     consent-gated; the RUNTIME dep mechanism is the open call.
  2. The actual run needs the 568 MB model download + a memory-capable test env to prove inference.

Until that lands, the live gateway runs Layer-1 (deterministic) + outbound + governance + config + records
— fully launchable. State: gateway 130 + daemon 395 green; nothing pushed; nothing on `main`.

---

## 2026-06-23 — IN-002 part 2 DEFERRED by decision; Phase-1 is launch-complete (11/12 + 1 deferred)

Andre's call: defer the real DeBERTa model work — download the 568 MB model and line up the runtime infra
first, then build part 2 WITH that infra rather than blind. So M9-IN-002 part 2 (the transformers.js
classifier + the gated real-inference test for AC-001/002/SI-001) is a NAMED DEFERRAL, not a silent drop —
its home is the IN-002 row in the DoD. Part 1 (scanner logic + consent-gated installer + pluggable
classifier seam wired live, absent → L2 off) stands.

**Phase-1 is launch-complete:** 11/12 gate-green + the 12th explicitly deferred. The gateway screens live
on Layer-1 (deterministic sanitize + RE2 injection patterns) + IN-003 language + all outbound (secrets/PII/
exfil/rate) + the FEED-001 governance channel + CFG-001 config + REC-001 records — all proven through the
real spawned gateway process. Layer-2 (semantic DeBERTa) is the one opt-in add that turns on when the model
is installed.

At part-2 build time, the open sub-decision is the transformers.js runtime install mechanism (lean opt-in/
lazy to keep the client small, matching the model-not-bundled call). Do NOT build part 2 blind — it needs
the model + runtime + a memory-capable env to write AND verify; unrunnable inference code would violate the
"only a live run is done" discipline. State: gateway 130 + daemon 395 green; nothing pushed; nothing on `main`.

---

## 2026-07-29 — Entry C1: M9 REOPENED for the CONNECT UNIT — docs modernized to the M10B standard

**Why reopened.** The 2026-07-27 policy surface audit (§0) proved the layer never runs in the
shipped product: the composition root never sets `config.securityGateway`, every daemon boots
`PassthroughGatewayClient`, and Andre's own daemon log has announced `mode:"passthrough"` on every
boot. The June gate (`m9-gate-1.test.ts`) injected the real client itself — it proved the layer
works when connected and hid that only the test connects it. Andre, 2026-07-29: modernize the
three M9 documents to the M10B standard, extend the DoD to fully cover the connect work, then do
it.

**Docs produced this entry (trustless-cello, straight to main):**
- `M9-PROCEDURE.md` — full rewrite to the M10B standard: reality check, the four ways a run dies,
  severity triage with the M9-specific silently-broken-core list (injection-seam theatre, silent
  passthrough downgrade, agent self-loosening, plaintext resurrection, env bypass resurrection),
  reviewer lenses, review-pass hard cap, design-note template. The old §3a 30-minute drift-check
  cron and the M7-era worktree rules are superseded (M7 closed; work is on `main` now).
- `M9-DEFINITION-OF-DONE.md` — full rewrite: M10B status legend, Orientation (the five-point
  evidence chain), scope fence, invariants with the INV-4 AMENDMENT (per policy D-3: one key,
  backup unit; SI-001 re-scoped to Phase 2) plus new INV-9 (connected by default, passthrough
  test-only) and INV-10 (no loosen side door). Tier 0 compresses the June Phase-1 record with
  statuses preserved, including the 2026-07-09 storage correction now assigned to STORE-1.
  **Tier 1 is the connect unit:** `DOD-M9C-STORE-1` (custody, closes DOD-CRYPTO-AT-REST-1),
  `-WIRE-1` (enforcing flip, INV-9), `-SURFACE-1` (cello config + CLI loosen-confirm, absorbs
  DOD-CONFIG-1), `-ENV-1` (removes the four CELLO_GATEWAY_* policy overrides), `-AUDIT-1` (the
  D-11 command, security half, ships with the flip), `-GATE-1` (composition-root live gate — the
  new enforcer; spawns the shipped bin, zero injection), `-PUBLISH-1` (one batched beta cascade).
  Decisions M9C-D1..D5 import policy D-2/D-3/D-4/D-5/D-11 with their reasoning.
- This journal — header updated to the numbered-entry convention, RESUME STATE block added.

**Scope guard.** This unit is cello-client only; no AWS, no directory, no portal. The Generic
Reject / refusal-notification work (§15 items 5–8) is a LATER unit — only the D-11 command's
security half ships here, shaped so the reachability source can join without a breaking change.

**Next:** design note for `DOD-M9C-STORE-1` (Entry C2), then the loop.

---

## 2026-07-29 — Entry C2: DESIGN NOTE — DOD-M9C-STORE-1 (written before any code)

**Target behavior (one sentence).** The gateway's config versions and security records live in
SQLCipher-encrypted storage opened with the daemon's key, in the `~/.cello` backup set, with zero
`node:sqlite` left in gateway production code.

**Spec anchors.** DoD `DOD-M9C-STORE-1`; policy D-3 (M9C-D2); `DOD-CRYPTO-AT-REST-1` (M8C);
INV-4 as amended. Two DoD clauses are AMENDED by evidence found this entry (see decisions D6/D7).

**Facts established by reading the code (not assumed):**
1. The daemon's one engine site is `core/daemon/src/sqlcipher-db.ts` — `@signalapp/sqlcipher`
   prebuilt, raw 32-byte key in a 0600 key file beside the DB (`dbKeyPathFor` → `<db>.key`),
   PRAGMA-key + verify-read, WAL only after verification, fail-closed (no plaintext fallback).
2. `cello_backup` / `cello_restore` are STUBS — `not_implemented` in `daemon.ts`. The DoD clause
   "proven by a backup round-trip" cannot be proven against a stub.
3. The gateway stores were only ever created when `CELLO_GATEWAY_CONFIG_DB` / `_RECORD_DB` env vars
   were set — and only tests set them. The layer never ran in the product (that is this milestone's
   whole finding), so NO production plaintext store has ever existed.
4. Both stores are already engineered for two-process access (BEGIN IMMEDIATE + busy_timeout —
   their own comments say "two processes on the same file").

**Producer/consumer chain.** The gateway bin produces record rows (every screened message) and
consumes config rows (read at boot). The daemon (SURFACE-1) will produce config rows (CLI-confirmed
sets over IPC) and consume record rows (AUDIT-1 reads). Both processes open the same encrypted
file; WAL + busy_timeout + IMMEDIATE transactions carry the concurrency, unchanged from the
stores' existing design.

**The seam.** `core/gateway` gains its own minimal SQLCipher opener (`store/encrypted-db.ts`):
load `@signalapp/sqlcipher`, PRAGMA raw key from a KEY FILE PATH, verify-read, WAL, busy_timeout.
It does NOT import from `core/daemon` (dependency direction: daemon → gateway). The daemon's
richer opener (FK enforcement, migration helpers) stays where it is; the ~50 duplicated lines are
the price of the package boundary and are recorded as such.

**Invariants at stake.** INV-4 (amended): satisfied — same key, backup set. INV-9/INV-10:
untouched here. The custody lens: the stores REFUSE to open without a valid key file (fail-closed,
`store_key_unavailable`); there is no plaintext fallback path at all after this unit.

**Approach + rejected alternative.** A sibling file `~/.cello/gateway.db`, keyed by THE SAME key
file as `sessions.db` (the daemon passes the KEY FILE PATH — never key bytes — via spawn env).
Rejected: tables inside `sessions.db` — couples the gateway's per-message write load to
SessionNodeManager's transaction patterns and migration lifecycle across two processes for zero
custody gain (same file ≠ more encrypted than same key). Rejected: a second key (`gateway.db.key`)
— D-3 says one key, and a second key file is one more thing a backup can miss.

**Falsification pass.** `@signalapp/sqlcipher` is already a daemon dependency, so the prebuilt
ships in the install regardless — adding it to `core/gateway` adds a package.json edge, not
install weight (pnpm dedupes). Raw-key reuse across two SQLCipher files is sound (per-file salts;
Signal's own pattern). The stores' varargs call sites match the daemon's adapter shape, so the
port is the constructor + open path, not the query surface.

**Decisions this note makes:**
- **M9C-D6 (DoD amendment).** The backup round-trip clause is REPLACED: `cello_backup` is a stub,
  so the provable guarantee is custody-and-position — same key, same directory, fail-closed open —
  and the round-trip proof lands when backup lands. The DoD line is edited to say so.
- **M9C-D7 (DoD amendment).** NO plaintext importer is built. No production plaintext store has
  ever existed (fact 3); an importer would be dead code born dead, and dead code in an open-source
  trust product reads as rot. A stray dev-machine plaintext store is simply not consulted.
- **M9C-D8.** Key handoff is by KEY FILE PATH (`CELLO_GATEWAY_STORE_KEY_FILE`), never bytes in env
  or argv. The file is 0600 in a 0700 dir, same user, already the sanctioned one-plaintext-key.
- **M9C-D9.** Store paths become fixed conventions under `CELLO_DIR` (`gateway.db`, keyed by
  `sessions.db.key`), passed to the bin as plumbing env (`CELLO_GATEWAY_STORE_DB` +
  `_STORE_KEY_FILE`). The old `CELLO_GATEWAY_CONFIG_DB`/`_RECORD_DB` env names die; both stores
  live in ONE encrypted file (they always could — separate files were an accident of env plumbing).

**Observability.** `gateway.store.opened` {path, encrypted:true, walMode} (stderr-structured from
the bin; never a key); open failure → exit 2 with `store_key_unavailable` / `store_open_failed` on
stderr — the spawner surfaces it as spawn failure (WIRE-1's announced fail-closed).

**Test plan sketch (red first).** (1) cfg/rec store tests re-pointed at the encrypted opener:
round-trip through a real SQLCipher file, then RE-OPEN WITHOUT the key → refuses (the revert
test: a node:sqlite implementation fails this). (2) A raw-bytes assertion: the DB file header is
NOT "SQLite format 3\0" (plaintext magic) after writes. (3) Wrong-key open → store_key_mismatch.
(4) Both-stores-one-file: config + records coexist in one DB. (5) eslint allowlist entries removed
→ lint stays green (proves no import remains).

---

## 2026-07-29 — Entry C3: DESIGN NOTE — DOD-M9C-WIRE-1 (written before any code)

**Target behavior (one sentence).** A stock-installed `cello-daemon`, with nothing injected, spawns
the screening sidecar at boot, announces `mode:"enforcing"`, and screens every send and every
ingest — and if the sidecar cannot be had, says so and fails closed rather than passing content.

**Spec anchors.** DoD `DOD-M9C-WIRE-1`; policy D-2 (M9C-D1); INV-5 (unified seam), INV-6 (never
lies, never hangs), INV-9 (connected by default, passthrough test-only).

**Producer/consumer chain.** The BIN produces: the store key file (ensuring it exists), the spawned
sidecar process, and the `LocalSidecarGatewayClient`. `startDaemon` consumes the client and hands
it to both seams — `cello_send` (outbound) and `SessionNodeManager.ingestReceivedContent`
(inbound). The client produces verdicts; the seams consume them. The bin's shutdown handler
consumes the spawn handle. Break any hop and content either stops (fail-closed) or — the defect
this unit exists to kill — flows unscreened.

**The seam.** `core/daemon/src/bin/cello-daemon.ts` (composition root) and one line of
`core/daemon/src/daemon.ts` (the `??` fallback). No screening logic moves; the gateway package is
untouched.

**Decisions this note makes:**

- **M9C-D10 — `securityGateway` becomes REQUIRED in `DaemonConfig`.** Optional-with-a-passthrough-
  default is precisely how this defect happened: the invariant held by CONVENTION while the comment
  claimed structure. A required field means the shipped daemon *cannot* forget. The ~45 test files
  that call `startDaemon` pass `new PassthroughGatewayClient()` explicitly, which is an honest
  declaration ("this test does not screen") rather than a silent inheritance. This mirrors the fix
  the concurrent M10B session made to `submitForAgent` this same day, for the same reason.
- **M9C-D11 — each client declares its OWN `mode`.** `SecurityGatewayClient` gains a readonly
  `mode` (`"enforcing" | "passthrough"`); `security.gateway.connected` logs
  `securityGateway.mode`, never a caller-side ternary. The old line computed the announcement from
  the same expression that chose the client, so a wiring bug could only ever announce itself
  correctly by luck. The informed skeptic greps this field — it must come from the object.
- **M9C-D12 — sidecar spawn failure does NOT stop the daemon; it fails closed, announced.** The
  client already fails closed on a dead socket (`gateway_unavailable`, INV-6), so a failed spawn
  needs no new blocking path: log `security.gateway.spawn_failed` with the real cause and keep the
  client. The operator keeps a daemon they can run `cello config` / `cello policy log` against to
  diagnose, and content still cannot move. Rejected: refusing to start (a cryptic dead agent with
  no way to inspect it) and falling back to passthrough (the defect itself).
- **M9C-D13 — the bin ensures the store key exists BEFORE spawning.** The sidecar opens the
  encrypted store at startup, but `sessions.db.key` is only created when the daemon first opens
  its own database — later. So the bin calls `resolveDbKey(sessions.db, dbKeyPathFor(...))` first
  (the same call the daemon makes; idempotent, and on a fresh install it is the one that
  generates), then passes the key FILE PATH to the child. It uses the return value for nothing —
  only the side effect. On an existing DB with a missing key file this throws
  `db_encryption_key_mismatch`, which is the correct fail-closed outcome and the same error the
  daemon would raise seconds later.
- **M9C-D14 — no auto-restart of a sidecar that dies mid-run.** Log `security.gateway.exited` with
  the code; every subsequent screen fails closed with a real cause. A supervision loop is a Day-2
  add, named here rather than half-built.

**Invariants at stake.** INV-9 is satisfied structurally by D10 + D11 (no shipped path can
construct passthrough; the announced mode comes from the object). INV-5 is untouched — the seams
already exist and are already called. INV-6 is inherited from the client's existing deadline +
fail-closed behavior; D12 leans on it rather than duplicating it.

**Falsification pass.** (1) Does the bin have what it needs? Yes — `celloDir` is computed there,
and `resolveDbKey`/`dbKeyPathFor` are in `core/daemon`, which the bin is part of. (2) Does
responsibility live here? The bin is the composition root; process lifecycle and adapter choice
are exactly its job, and the daemon library stays injectable for tests. (3) Redundancy? The
daemon must NOT also spawn — one spawner, in the bin, stopped by the bin's shutdown handler.
(4) What breaks? Every `startDaemon` test call site (required field) — mechanical, and the
compiler names each one. The e2e spine harness spawns the real bin, so it inherits real screening;
if a spine test asserts unscreened content it will fail LOUDLY, which is the correct outcome and
must be fixed by the test, never by loosening the wiring.

**Observability.** `security.gateway.connected` {mode, socketPath} · `security.gateway.spawned`
{pid, socketPath} · `security.gateway.spawn_failed` {error, guidance} · `security.gateway.exited`
{code, signal} · `security.gateway.stopped` on clean shutdown.

**Test plan sketch (red first).** (1) A focused test proving `DaemonConfig` requires the field —
the compiler is the assertion (a `@ts-expect-error` on an omitted field). (2) The mode announced
equals the client's own `mode` for both implementations. (3) Spawn-failure path: point the bin at
a non-existent entry → daemon still starts, `spawn_failed` logged, a send fails closed with the
real cause and NOT `ok:true`. (4) The full proof is `DOD-M9C-GATE-1`, which spawns the shipped bin
and greps the boot line for `mode:"enforcing"` — until it lands, WIRE-1 stays 🟡.

---

## 2026-07-29 — Entry C4: PROCESS CORRECTION — the connect unit moves to its own branch and worktree

**What went wrong.** This session built STORE-1 directly on `main` in the primary `cello-client`
checkout — the same branch and the same working tree a CONCURRENT session is using to build M10B
(endorsements). Andre: *"your work in M9 is interfering with their work in M10B… you're causing
his gates like linting and building to fail."*

The interference was not the committed content (STORE-1 is self-consistent, and the repo-wide run
was 2169 passed / 5 failed, where the 5 are the M10B session's own in-flight red tests). It was
the CHURN of sharing one tree: a `pnpm install` rewriting shared `node_modules` and the lockfile, a
`tsc --build` rewriting shared `dist/`, and repo-wide `vitest` sweeps — all landing underneath
another agent's gate runs. A gate that fails because someone else is mid-install reads as a real
failure, and costs the other session a debugging detour.

**The correction.**
- Branch `m9/connect-unit`, worktree `/Users/andrep/Documents/code/cello-client-m9c`, based on
  `449bbba` (STORE-1). Its own `node_modules` and `dist/`, so builds and test runs cannot collide.
- **`449bbba` STAYS on `main`** and is the shared ancestor of the branch — it is green and
  self-contained, so reverting it would mean a SECOND intrusive change to the other session's tree
  for no gain, and would risk conflicts with whatever they have since written.
- Everything after STORE-1 — WIRE-1 in particular, which makes `securityGateway` REQUIRED in
  `DaemonConfig` and therefore touches ~45 test files — happens on the branch. That change landing
  on shared `main` mid-M10B would have been genuinely disruptive.
- **The trustless-cello docs stay on `main`.** They are `docs/planning/user-stories/m9/**` only;
  they cannot affect the directory build, and putting the plan on a branch would hide it from
  Andre, who reads by push.
- Test runs are FILTERED from here on (`vitest run <file>`), never repo-wide sweeps.

**The rule this earns.** *One repo, one tree, one coder.* A second agent in a repo gets its own
worktree BEFORE its first build — not after its first collision. M9-PROCEDURE §5c ("One thread.
One coder") assumed the thread was alone in the checkout; that assumption is now written down as
a check to run at kickoff: `git status -sb` plus `git worktree list`, and if another session has
uncommitted work in the primary checkout, branch out first.

---

## 2026-07-29 — Entry C5: STORE-1 + WIRE-1 BUILT and reviewed (branch `m9/connect-unit`)

**Commits.** `449bbba` STORE-1 (on `main`, the branch's ancestor — Entry C4), `a68ed2e` WIRE-1 +
every STORE-1 review fix (branch only). Pushed to `origin/m9/connect-unit`.

**Gates.** `core/daemon` + `core/gateway`: **1277 tests green, 140 files**, lint clean, typecheck
clean, in the isolated worktree. Both lines are **🟡, not ✅** — the enforcer (`DOD-M9C-GATE-1`)
does not exist yet, and no Tier-1 line may cite an injection-seam test as its proof.

**The reviewer earned its keep: four blocking findings, all real, all fixed.**

1. **Error substitution, and a latent misdiagnosis machine.** `store_key_mismatch` was thrown from
   a BARE `catch` — the SQLite reason discarded — and `busy_timeout` was set AFTER the verify read.
   Since M9C-D9 made the store file SHARED with the daemon, the first contended open would return
   `SQLITE_BUSY` instantly and be reported as *"the daemon's key does not match this store —
   restore the matching key file"*. Destructive advice for a lock. Fixed: timeout set before the
   verify read; the upstream reason survives into the message; `store_locked` and
   `store_plaintext_file` are their own codes. The daemon's own opener already did this — the copy
   had dropped it, which is a behavior-moved regression, not a style difference.
2. **Every refusal died in an undrained pipe.** `spawnGatewaySidecar` piped the child's stderr and
   attached no listener, so all four coded, guided refusals reached the caller as
   `gateway sidecar exited before ready (code 1)` — a message naming where the failure surfaced and
   nothing about what went wrong. Fixed: tail buffered and appended to both rejection paths; the
   bin prints code + guidance, not just message. (Also closes an unbounded-pipe backpressure risk.)
3. **A silent fallback with the shape of a guard.** The half-configured check tested
   `=== undefined` while the two call sites tested truthiness, so `CELLO_GATEWAY_STORE_DB=""` passed
   the guard and produced NO stores — screening every message with no audit trail and no config
   governance, while printing READY. Fixed by normalising once (`|| undefined`) so guard and call
   sites read the same value.
4. **The guard was hollow.** Deleting it left every test in both repos green. Three new tests spawn
   the REAL BUILT bin and assert the exit codes; a fourth asserts absence of `node:sqlite` on the
   BUILT ARTIFACT (building first rather than skipping when `dist/` is stale — a guard that skips
   is off exactly when it matters).

Also fixed from the same review: swallowed WAL degradation now reported; the now-false
`detect/index.ts` comment rewritten (the danger changed shape — a native prebuilt reached through
`createRequire`, which a static import scan cannot see, so the structural filename assertions are
what still guard that boundary); `@signalapp/sqlcipher` moved to `optionalDependencies` so the
portal's `./detect` pin does not drag a native binary into Next.js.

**Two findings deliberately NOT fixed here, with homes:**
- The **request log** (`CELLO_GATEWAY_REQUEST_LOG`) writes plaintext metadata + a content SHA-256
  outside the encrypted store. Only tests set it, and WIRE-1 does not pass it — but STORE-1's claim
  to close the storage half of `DOD-CRYPTO-AT-REST-1` is overstated while it exists. → an AC on
  `DOD-M9C-ENV-1`, which is the unit that owns "no policy-bearing env var survives".
- The **four `CELLO_GATEWAY_*` policy overrides** still exist. That is `DOD-M9C-ENV-1` by design.

**One test expectation changed, and it is not a weakening.** The seam test asserted
`mode === "sidecar"`; M9C-D11 changes the vocabulary to `"enforcing"`. "Sidecar" named the
TRANSPORT SHAPE — a daemon whose sidecar screened nothing would still have announced it truthfully.
The mode now names what the client DOES with content, and the DoD names `"enforcing"` as the value
the informed skeptic greps for.

**Ordering correction found while writing this.** `DOD-M9C-ENV-1` must come AFTER
`DOD-M9C-SURFACE-1`, not before: the env overrides are currently the ONLY way to configure the
gateway, so removing them first would leave the layer unconfigurable. The DoD's line order already
happens to be right; this entry records WHY, so nobody "optimises" by doing the small one first.

**Next:** `DOD-M9C-SURFACE-1` — design note (Entry C6), then the loop.

---

## 2026-07-29 — Entry C6: DESIGN NOTE — DOD-M9C-SURFACE-1 (written before any code)

**Target behavior (one sentence).** An operator can read every gateway guard and change it from the
CLI; a change that TIGHTENS applies immediately, a change that LOOSENS stops and asks a human at a
terminal — and no MCP tool, no agent, and no environment variable can produce that confirmation.

**Spec anchors.** DoD `DOD-M9C-SURFACE-1`; policy D-4 (M9C-D3); INV-10; M9-CFG-001's §7
tighten-free/loosen-confirmed clause (the store already ENFORCES it — nothing in the product could
ever satisfy it, which is why `confirmed` has never once been set outside a test).

**Producer/consumer chain.** CLI (or MCP) → IPC verb → `GatewayConfigStore.set()` → a versioned,
hash-chained row. The gateway sidecar CONSUMES config at boot only, so a write that nobody applies
is a lie: the daemon restarts the sidecar after a successful set. Reads go the other way: the store
is the producer, `cello config list` the consumer.

**The seam.** A new `core/daemon/src/gateway-config-handlers.ts`, registered from `daemon.ts` in
three lines — deliberately NOT written inside `startDaemon`'s body. It follows
`contact-handlers.ts`, which named its dependencies instead of closing over the daemon's state, and
it keeps this unit's `daemon.ts` diff to almost nothing (the M10B session is editing that file on
`main`, and a small diff is a small merge).

**Decisions this note makes:**

- **M9C-D15 — the loosen gate is enforced by CONNECTION TYPE, in the daemon.** Clients already
  declare `clientType` on `ipc.connect` (`"mcp"` | `"cli"`). `confirmed: true` is honored ONLY from
  a `cli` connection; from an `mcp` connection a loosening is REFUSED with guidance naming the exact
  command to run. Stating the limit plainly: this is not a cryptographic boundary — a local process
  can claim to be the CLI. It does not need to be. The threat is *an agent talking itself into
  weakening its own guards*, and the agent reaches the daemon through the MCP server, which declares
  `mcp`. Anyone who can spawn a process claiming `cli` can also just run the CLI.
- **M9C-D16 — the human act is a TTY prompt, and `--yes` does not exist for loosenings.** The CLI
  refuses to confirm when stdin is not a TTY. A flag that lets a script confirm is the env-var
  bypass with a nicer name (D-5 removes exactly that). Tightenings need no prompt and stay
  scriptable.
- **M9C-D17 — a successful set RESTARTS the sidecar, via a callback the bin supplies.** The gateway
  reads config at boot, so without this the operator gets `ok:true` and unchanged behavior — the
  worst outcome available. Same shape as the existing Telegram-poller restart callback. The socket
  path does not change, and `LocalSidecarGatewayClient` reconnects lazily, so nothing else moves. If
  the restart fails the response says the change is STORED BUT NOT APPLIED, naming the restart as
  the remaining step — never a bare `ok`.
- **M9C-D18 — the surface shows the GOVERNANCE, not just the value.** `list` renders each key with
  its current value, its version, whether the last change was a tighten or a loosen, and whether it
  was confirmed. A config surface that shows values alone cannot answer the only question that
  matters after an incident: *who weakened this, and did a human agree?*

**Invariants at stake.** INV-10 is the point of the unit: after this + ENV-1, every loosening has a
versioned row and a human act behind it. INV-9 untouched. INV-7: each refusal carries its own
reason (`needs_confirmation`, `loosen_requires_cli`, `not_a_tty`, `unknown_key`, `invalid_value`) —
never a shared `config_error`.

**Falsification pass.** (1) Does the daemon have the store? Yes — after STORE-1 it is one SQLCipher
file under the daemon's own key, so the daemon opens it directly; no new custody. (2) Two writers?
The gateway writes records, the daemon writes config, both under `BEGIN IMMEDIATE` + `busy_timeout`
— the design the stores already carry. (3) Does the restart callback belong in the bin? Yes: the bin
owns the sidecar's lifecycle (WIRE-1), and the daemon must not learn to spawn processes. (4) What
breaks? Nothing reads gateway config today except the sidecar at boot, so there is no other consumer
to invalidate.

**Observability.** `gateway.config.changed` {key, direction, version, confirmed, correlationId} ·
`gateway.config.loosen_refused` {key, surface, reason} · `gateway.config.applied` {key, restarted} ·
`gateway.config.restart_failed` {key, error}.

**Test plan sketch (red first).** (1) A loosening from an `mcp` connection is refused and writes NO
row (the row count is the assertion — a refusal that still persisted would be the whole gate gone).
(2) The same loosening from a `cli` connection WITH `confirmed` applies and writes a row marked
`confirmed`. (3) A tightening applies from either, with no prompt. (4) An unknown key and an invalid
value each get their own reason. (5) `list` reports version + direction + confirmed. (6) The CLI
refuses to prompt on a non-TTY stdin. (7) A failed restart reports stored-but-not-applied.

---

## 2026-07-29 — Entry C7: SURFACE-1 BUILT (daemon + CLI + MCP) — and a kill switch that had started lying

**Commits (branch `m9/connect-unit`):** `e68cc92` daemon half, `b9857b8` CLI half, `09ee4c3` MCP
half. **1569 tests green** across daemon + gateway + cli + adapter; lint and typecheck clean.

**What exists now.** `cello config list | get <key> | set <key> <value>`, three IPC verbs behind it,
and three MCP tools. A TIGHTENING applies immediately from either surface. A LOOSENING is refused
by the store (no row), and only a CLI caller who answers a TTY prompt can produce the `confirmed`
flag the store has demanded since June and nothing has ever been able to supply.

**THE BUG THIS UNIT SURFACED, and it was mine.** A logout test went red:
`AC4: a live daemon whose daemon.lock was DELETED is still found and actually stopped`.

The chain, traced rather than guessed:
1. `cello logout` stops the daemon through the IPC `shutdown` verb → the daemon's internal
   `stop()`. It does **not** call `process.exit`, and it never reaches the bin's SIGTERM handler.
2. That path relies on the **event loop draining** for the process to exit.
3. WIRE-1 gave the daemon a spawned child with piped stdio. Those pipes are active handles. The
   loop never drains.
4. So logout truthfully reported *"Daemon stopped"* — the socket was closed and the singleton lock
   released, which is exactly what its liveness check tests — while the process ran on forever.

**A kill switch that lies is the precise failure `DOD-SINGLE-DAEMON-1` exists to prevent**, and
WIRE-1 had reintroduced it through a door that story never had to consider. The second tooth is as
bad: a surviving gateway holds the encrypted store's write lock against the next daemon — the
orphan-process problem this project already knows by name.

**Fix:** the teardown moved OUT of the bin's signal handler and INTO the daemon's own `stop()`, via
a new `onShutdown` hook the composition root supplies. Every exit path passes through `stop()`;
only one of them passes through a signal.

**The lesson, stated so it generalises:** *when you give a long-lived process a child, find every
way that process can exit — not the one you were looking at.* The signal handler was the obvious
path and the wrong one to fix alone.

**Two more things caught by the repo's own tests rather than by review**, which is the system
working:
- `SKILL.md` omitted the three new tools. It SHIPS in the connect tarball and instructs agents on
  the operator's machine, so that is a real gap, and `adapter-002` enforces it.
- The tool names broke the vocabulary rule (MCP name == `cello_` + the CLI command). Renamed
  `cello_gateway_config_*` → `cello_config_*`.

**Known gaps, handed to the reviewer rather than hidden:**
1. `allow_always` is not wired to the new gate — it is still gated by `autonomous_override` inside
   the outbound screener. Arguably satisfied transitively (that key is now itself gated); the
   reviewer rules.
2. `correlationId` is named in the `gateway.config.changed` clause and is not threaded — the config
   path has no inbound correlation id to thread.
3. "Provenance" in `list` is version + direction + confirmed. There is no operator identity because
   there are no local operator accounts.

**Status: 🟡.** `DOD-M9C-GATE-1` — the enforcer that spawns the SHIPPED bin — is still unbuilt, and
no Tier-1 line goes ✅ on a suite that injects its own wiring. That is the rule this milestone
exists because of.

---

## 2026-07-29 — Entry C8: ENV-1, AUDIT-1, GATE-1 built; the WIRE-1/SURFACE-1 review, and its six blocking findings

**Commits (branch `m9/connect-unit`):** `6f933ab` ENV-1, `9396a92` AUDIT-1, `88dfd73` GATE-1 + every
review fix. **1588 tests green** across daemon + gateway + cli + adapter; lint and typecheck clean.

### The gate exists, and it is the one that could not have passed before

`DOD-M9C-GATE-1` spawns the BUILT `cello-daemon` binary with zero injection and reads what the
product does. Its first assertion — `security.gateway.connected` → `mode:"enforcing"` — is exactly
the line that said `passthrough` on every real daemon for weeks while the June gate was green. It
also proves the sidecar is a real OS process, the store is created encrypted beside the daemon's
database under the same key, the removed env variables are inert end to end, and SIGTERM leaves no
orphan on the store lock.

### The reviewer found six blocking issues. All six were real.

**F1 was a genuine security hole, and my own justification for it was wrong.** `getClientType`
returns `undefined` for a connection that never sent `ipc.connect`, and the daemon separately
defaults a handshake without `clientType` to `"cli"`. Testing `!== "mcp"` therefore made the
PERMISSIVE side the default: a raw socket write to `~/.cello/daemon.sock` carrying
`confirmed: true` would land a human-confirmed loosening with no human anywhere, and `verifyChain`
would attest it as confirmed forever. Ten lines of node.

M9C-D15 had justified the shape with *"anyone who can spawn a process claiming `cli` can also just
run the CLI."* That is false in the one direction that matters: an agent running `cello config set`
from a Bash tool gets a **non-TTY stdin and is refused**. The raw socket was not equivalent to
running the CLI — it was the ONLY route that worked for a non-human. **D15 is amended: only an
explicit `cli` handshake may confirm.**

**F4 — the teardown ran after `singletonLock.release()`.** The `shutdown` verb acknowledges without
awaiting the drain, so `cello logout && cello login` can race a successor daemon in — whose gateway
meets a store lock held by the old one. The 3s `busy_timeout` usually rides it out, which makes the
failure *intermittent*, which is worse. The comment three lines below states the property the
placement was giving away: *"Released LAST: while we hold it, no successor daemon can start."*

**F5 — no orphan reaping on a death that skips `stop()`** (SIGKILL, crash, OOM). The child now
holds a piped stdin it never reads; parent death closes it and the gateway exits. Without it the
NEXT daemon spends its whole life fail-closed against a lock nobody can explain — because M9C-D14
says no auto-restart.

**F2 — error substitution.** A failed spawn surfaced as `gateway_unavailable` on every message
("check the gateway is running, then retry") when the cause was a missing key file, a lock, a stale
plaintext store, or a missing binary — and retrying could never work. The composition root already
had the code and guidance; now it hands them to the client.

**F3 — a non-TTY caller was told the operator DECLINED** a prompt never shown, with no way forward.
Now `not_a_tty`, naming the command. And `confirmAtTty` listened only for `data`, so Ctrl-D never
settled the promise — a hang, which INV-6 forbids outright.

**F6/F7/F8/F10/F11** — out-of-range as `internal_error`; the prompt hiding what a list replacement
drops; 13 duplicate keys from the mechanical patch that BOTH typecheck and lint called clean (now
deduped, and `no-dupe-keys` is enabled — a gate that cannot see the corruption a bulk edit causes is
not covering bulk edits); a dead branch; a missing `error` listener that would have killed the
daemon at boot rather than degrading.

### What the reviewer got right that I would not have caught

**The CLI half had NO tests at all.** `gatewayConfigSet` took an injectable `prompt` and nothing in
the repo ever called it — so the two-phase flow, the declined path, and the non-TTY refusal were
entirely unproven while the DoD line read as satisfied. Five tests now drive a real daemon over its
real socket with only the prompt injected. They read **stdout OR stderr**, because refusals render
to stderr and a test watching only stdout would miss every failure path — the same shape of blind
spot as the original defect.

**On the known gaps I handed over:** `allow_always` is satisfied *structurally*, not transitively —
it never writes the whitelist at all, so there is no auto-persist path to gate. `correlationId`
remains unthreaded and the reviewer's call is that it should be done rather than accepted; it is
carried to the next unit rather than silently dropped.

### Carried forward, not lost
- `correlationId` threading through the config flow (F12).
- `list` should show `changed_at` and `chainValid` (F9) — the store has the timestamp; `history()`
  drops it.
- `PassthroughGatewayClient` is exported from two public barrels; a `/testing` subpath would keep it
  off the production surface (F-D).
- `pii:whitelist_add_requested` has no consumer — nothing turns it into the `cello config set` line
  the operator should run. Inherited from Phase 1, not introduced here.

---

## 2026-07-29 — Entry C9: the done-auditor verdict — 2 EARNED, 4 OVERSTATED, 1 UNPROVEN

**Commit:** `1bae5ba` (branch `m9/connect-unit`). 1588 tests green; lint and typecheck clean.

### The verdict, applied

| Line | Verdict | Tag |
|---|---|---|
| `DOD-M9C-STORE-1` | **EARNED** — ciphertext on disk, both refusal paths, no `node:sqlite` in the built artifact, and the SHIPPED daemon creates the encrypted store itself | ✅ |
| `DOD-M9C-ENV-1` | **EARNED** — the best-evidenced line: the built bin spawned with all four variables at their most permissive still refuses a PII value "whitelisted" only by the environment | ✅ |
| `DOD-M9C-WIRE-1` | OVERSTATED | 🟡 |
| `DOD-M9C-SURFACE-1` | OVERSTATED | 🟡 |
| `DOD-M9C-AUDIT-1` | OVERSTATED | 🟡 |
| `DOD-M9C-GATE-1` | OVERSTATED | 🟡 |
| `DOD-M9C-PUBLISH-1` | UNPROVEN | ❌ |

### The finding I missed, and it is the milestone's own defect

`session-node-manager.ts` read `opts.securityGateway ?? new PassthroughGatewayClient()` — **the
identical shape as the bug that reopened M9, one layer down, and shipping in the built artifact.**
`daemon.ts` was hardened to throw; this constructor was not. Nothing reaches it today because
`daemon.ts` always passes the client — but *"currently unreachable" is a property of today's call
sites, not of the code*, and INV-9 says no shipped path constructs the stub. Now required, with the
same loud refusal.

### INV-10 claimed a property the code does not have

My F1 fix closed the no-handshake route and I believed that closed the hole. It did not.
**`clientType` is SELF-DECLARED** — the daemon records whatever string arrives in `ipc.connect`. Any
process running as the operator can open `~/.cello/daemon.sock` (mode 0600), announce
`clientType: "cli"`, and pass `confirmed: true`. The TTY check lives in the CLI process; the daemon
cannot verify it. A same-uid process is not distinguishable from the operator by any local
mechanism, so **no amount of daemon-side checking closes this.**

I did not paper over it. INV-10, the module doc and the DoD now state what the gate delivers: every
path an agent reaches by ORDINARY means is closed — its MCP tools, and the CLI, which refuses on a
non-TTY stdin — so weakening a guard requires deliberately speaking raw IPC and misrepresenting
itself, a louder act that the hash-chained trail records. **Friction plus audit, not a lock.** The
real boundary is the portal passkey D-4 already names as the destination.

That correction matters beyond this line: an invariant that overstates its guarantee is the same
species of defect as a gate that certifies a layer nobody wired.

### The gate is honest and still incomplete

The auditor confirmed the gate test does what it claims — spawns the built binary, never calls
`startDaemon` in-process, never sets `config.securityGateway`. But it makes **4 of the 6** specified
assertions and **drives zero traffic**: not one message is screened by the shipped product anywhere
in it. The daemon's own comment says the boot line is not a handshake — the socket connects lazily
on first screen — so `mode:"enforcing"` is a LABEL on a socket the gate never exercises. Better than
`passthrough`, verified from the real binary, and not yet the screening proof the DoD wrote down.

**Owed, and it is the highest-value work left:** gate assertions (2) outbound credential redacted at
the peer, (3) crafted inbound sanitized, (4) both readable through AUDIT-1, (6) sidecar killed
mid-session → fail-closed with the real cause. The auditor's read is that those three would likely
convert WIRE-1 and AUDIT-1 to ✅ as well, since the plumbing already exists and is proven under
injection.

### The lint rule earned its keep within the hour

`no-dupe-keys`, added for review finding F8, immediately caught three more duplicates my dedupe
regex had missed — including two in the M9 gate tests where the inserted stub **shadowed a real
gateway**. Last-wins meant behavior was accidentally correct. That is luck, not coverage, and it is
exactly the corruption class the rule exists for.

### Still owed
- The three missing gate assertions (above) — then re-audit WIRE-1 and AUDIT-1.
- `PassthroughGatewayClient` on two public barrels; WIRE-1's "test-only visibility" clause is unmet.
  A `/testing` subpath export is the fix.
- `correlationId` threading; `list` showing `changed_at` + `chainValid`.
- The plaintext REQUEST LOG — why M8C's `DOD-CRYPTO-AT-REST-1` is 🟡, not ✅.
- `DOD-M9C-PUBLISH-1` — one batched beta cascade, not started.

---

## 2026-07-29 — Entry C10: the audit's two remaining clauses closed; ready for merge

**Commits:** `93988ca` (the stub off the public barrels), `bad9db2` (the gate screens). Branch
`m9/connect-unit` is 10 commits from `449bbba`. **1589 tests green**, lint and typecheck clean.

### The stub is off the production surface (WIRE-1's last written clause)

The audit ruled "the stub moves to test-only visibility" UNMET, and it was right in the worst way:
visibility had moved the WRONG direction — from an internal default to a value export on the public
barrel of two published packages. It still has to exist (`securityGateway` is required, and tests
are out-of-tree consumers), so it now lives at `@cello-protocol/gateway/testing` and
`@cello-protocol/daemon/testing`. **Verified on the BUILT artifacts:** neither `dist/index.d.ts`
mentions it; both `dist/testing.js` exist. 75 test files re-pointed.

Two comments that were true when written and false by the time this unit landed, both REWRITTEN
rather than deleted: `session-node-manager.ts` described the always-allow default it no longer has,
and — the one that matters — `cello-mcp.ts` said *"the daemon runs PassthroughGatewayClient, so no
tool [is screened]"*. **That file SHIPS in the connect tarball and instructs agents on the
operator's machine.** A shipped file asserting the security layer is off, in the release that turns
it on, is the audit-what-ships rule in miniature.

### The gate now screens

The audit's central finding: the gate spawned the shipped binary honestly and drove **zero
traffic**, so `mode:"enforcing"` was a label on a socket nothing had exercised.

It now sends real content through the gateway the SHIPPED daemon spawned — the test is a client of
that socket, never an injection into the daemon. An outbound AWS-key-shaped credential returns
REDACTED with the secret absent from the payload; a crafted inbound carrying zero-width concealment
does not return intact; and both records are then read back **through the daemon's own IPC policy
log**, which proves the sidecar writes and the daemon reads one shared encrypted store, with the
chain verifying.

**What it deliberately does not claim**, and the test says so in its own comment: that the daemon's
`cello_send` path calls the gateway. That is INV-5, the seam, proven separately. Overstating it
here would repeat the exact mistake this milestone exists to correct.

### Standing at merge
- ✅ `STORE-1`, `ENV-1` (auditor: EARNED).
- 🟡 `WIRE-1`, `SURFACE-1`, `AUDIT-1`, `GATE-1` — all built, reviewed twice, audited, and now
  carrying the evidence the audit said was missing. **They are candidates for re-audit, not for a
  self-serving flip:** the maker does not grade his own homework, and the next session should put
  the auditor back on them before any ✅.
- ❌ `PUBLISH-1` — Andre's call, after merge.

### Still owed after merge
- `correlationId` threading through the config flow; `list` showing `changed_at` + `chainValid`.
- The plaintext REQUEST LOG — the reason M8C's `DOD-CRYPTO-AT-REST-1` is 🟡 rather than ✅.
- `pii:whitelist_add_requested` has no consumer (inherited from Phase 1).
- **INV-10 remains partial by nature, not by omission.** A same-uid process can announce
  `clientType: "cli"` over the IPC socket. The portal passkey D-4 names is the only thing that makes
  the absolute claim true; nothing local can.
