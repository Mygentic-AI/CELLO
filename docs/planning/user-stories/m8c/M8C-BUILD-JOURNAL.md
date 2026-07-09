---
name: M8C Build Journal
type: build-journal
date: 2026-07-05
milestone: M8C
status: open
description: >
  Append-only audit trail + live status board for M8C (command surface, notifications, reactive
  messaging). Entry 0 seeds the milestone: verification pass done, scope settled with Andre,
  apparatus created. Never edit a prior entry; append and update the status board in place.
---

# M8C — Build Journal

> ✅ **RESOLVED (2026-07-08): SEC-2 — the FROST-signing forgery hole is FIXED, DEPLOYED & LIVE-PROVEN.**
> The `/cello/frost/1.0.0` signing stream is now K_local-authenticated: the client attaches an Ed25519
> `authSig` over `(agentPubkey, epochId, framedMsg)` on every commit/sign request (daemon 0.0.37 / cli
> 0.0.34, published + promoted to `latest`); the directory verifies it before touching its share
> (`AUTH_REQUIRED` / `AUTH_INVALID`), deployed to all 3 regions. Rolled out in the safe order (client to
> `latest` → agents reinstalled → directory enforcement deployed), so no deployed client broke. Deploy
> CONFIRMED (pipeline `Succeeded`, rev `0e1ed768`). Live seals prove **NO REGRESSION** on the legitimate
> path — **enforcement itself is NOT yet live-verified** (the negative case is unrun; see Entry 63 + Entry 64).
> Full writeup: **Entry 63**
> (fix + rollout + live proof); the original finding is **Entry 39**; forensic hole description retained in
> the DoD "Tracked, not M8C-fruit" → SEC-2 block for the record.

## Status board (update in place)

| Tier | Lines | Status |
|---|---|---|
| I — Invariants | INV-CONTENTFREE, INV-GATEWAY (activates w/ M9, deferred), INV-PUSHPULL, INV-HONEST-STATES, INV-ONE-PRIMARY | ❌ all |
| 0 — Prerequisites | SPIKE-1 | ✅ |
| 1 — LAUNCH GATE | WAKE-1, AUTOSTART-1 (+F5/F18), INBOX-1 (+F4), LIVE-1 | **✅** 🟡 🟡 🟠 — **WAKE-1 LIVE PROVEN** (doorbell, Entries 45/46); LIVE-1 doorbell-half proven; **latest-promotion DONE 2026-07-09** (v0.0.85 → `latest`, all seven); still owes **cold-onboarding** |
| 1 — Onboarding riders | ONBOARD-HELP/ERRORS/NEXTSTEP/WARN/LOGNOISE-1 | 🟡 all (built+reviewed; ✅ at the cold-onboarding run, LIVE-1) |
| 2 — Reactivity + surface | MSGWAKE-1, SINCESEQ-1, LOGINSTART-1, CONFIG-1 (+F6/F12), CURSOR-1 | **✅** 🟡 🟡CORE 🅿️CFG(D14) 🟡 — **MSGWAKE-1 LIVE PROVEN** (per-message doorbell, both directions, Entries 45/46) |
| 3 — Reachability | AWAY-1, CONTACT-1, ABUSE-1, TTL-1, TGDOOR-1 | 🟡CORE 🟡CORE 🟡 🟡CORE 🟡 (**TIER 3 DONE, reviewed+fixed**) |
| 3½ — Legible identity | MONIKER-0/1/2/3/4/5 | **✅ ALL SIX — TIER CLOSED** (Entries 65–72; published `v0.0.85` → `latest`; DOD-MONIKER-4 **LIVE PROVEN incl. the hostile-name negative case**, Entry 72) |
| 4 — Async foundation | RELAYWAKE-1, LEAVEMSG-1 | 🟡CORE 🟡CORE (**TIER 4 DONE**, reviewer pending) |
| 5 — Multi-daemon | PRIMARY-DESIGN-1, PRIMARY-1, POLICY-1, PORTAB-1 | ✅ 🟠 ❌ ❌ — DESIGN done (Entry 35); **PRIMARY-1 directory arbitration BUILT+real-FROST-tested+reviewed (Entries 36-38, all findings fixed, 16 tests green)**. **REMAINDER (after-launch):** **SEC-2 FIXED 2026-07-08** (frost-stream K_local auth shipped+deployed+live-proven — Entry 63), so the ceremony-gate's auth prerequisite (D20) is now MET; its remaining pieces (daemon_id mint/persist, primary_holder seed, the gate itself) + pairing/DB-sync/Telegram-gating/kill-the-Primary need a live multi-device spine |
| Post-channel — deferred | M9INT-1 (do AFTER channel tiers — D11; NOT a prerequisite) | 🟡 MERGED (`d47227c`, reviewed, 1 HIGH fixed) |

**⛔ M9 IS NOT A PREREQUISITE (D11, 2026-07-06).** Do NOT merge `m9-build` before the channel work.
DOD-M9INT-1 was moved out of Tier 0 and deferred to after the M8C channel tiers. A post-compaction
context must not conclude M9 needs merging first — it does not.

**✅ RESUME STATE (2026-07-07, compaction point — see Entry 47 for the capstone; the OLD blockers
below are RESOLVED).** The FROST `ceremony_exhausted` blocker that stalled the earlier compaction
is **fixed** (commit `6499a74`, region-not-peerId) — sessions establish reliably; proven live in
Entries 40/45/46. **Coding for M8C is DONE.**

**Current reality:**
- **Doorbell PROVEN live** (Entries 44/45/46) — `buildChannelParams` fix, connect 0.0.60. DOD-WAKE-1
  + DOD-MSGWAKE-1 → ✅; DOD-LIVE-1 → 🟠 (doorbell half proven).
- **Full M8C build on `latest` + installed + running** (daemon 0.0.34, cli 0.0.31, connect 0.0.60,
  + transitive crypto 0.0.18 / protocol-types 0.0.18 / transport 0.0.16 / client 0.0.46). The
  default install path carries the entire milestone.
- **SEC-2** (pre-existing FROST-signing forgery hole) documented: standalone finding +
  fix-proposal docs. Andre's decision on launch-blocker-vs-fast-follow.

**WHAT'S LEFT — the plain tick-box list is `M8C-LIVE-TEST-CHECKLIST.md`. Start there.**
It's a **live-test pass** (no new code): cold onboarding, auto-start + inbox, the 3a–3j confirm-live
batch — plus the SEC-2 decision. Tier 5 multi-device + M9-parked settings are after-launch.

**FIRST ACTIONS on resume:** (1) open `M8C-LIVE-TEST-CHECKLIST.md` — do NOT re-derive scope. (2) If
running the heartbeat/autonomous loop, re-arm the crons (PROCEDURE §3b). (3) Working trees clean,
everything committed + pushed. The milestone's hard part (reactive core proven live) is done —
remaining work is proving-live + one decision, not engineering.

---

## Entries (append-only)

### 2026-07-05 — Entry 0: milestone seeded (verification pass + scope settled + apparatus)

**What happened.** The M8C raw notes were hardened into a milestone: every load-bearing
"already built / nearly free / transfers verbatim" claim was verified in code (verdict table +
evidence in [[M8C-MILESTONE-NOTES]] §Verification pass), scope/tiering was settled with Andre in
one batched ask, and the 5-doc apparatus was created.

**Verification highlights (all claims held; sharpened where noted):**
- Stage 1 nearly-free: CONFIRMED — shim drops frames at `ipc-proxy.ts:183-185`; daemon already
  dispatches on inbound sessions (`daemon.ts:3183`, drifted from `:3075` — cite symbols in
  stories); zero daemon change accurate.
- M9 merge: CONFIRMED + sharpened — merge dry-run **zero textual conflicts** (main +136 commits
  since divergence; m9-build +6,438 lines, self-contained `core/gateway`); semantic gate owed
  (all M8B-era content paths through the gateway) → baked into DOD-M9INT-1.
- Telegram plugin: CONFIRMED — 1,038 lines on disk; single-`getUpdates`-consumer constraint
  verbatim in its code → decided OQ-1 (daemon-owned).
- `since_seq`: zero hits (real work). Capability negotiation: absent (`clientType` only).
  `pickup_queue`: exists (V34/V35); ask-on-reconnect missing.
- New findings folded into the notes + DoD: pushes are fire-and-forget → INBOX is the
  loss-reconciler (elevated to Tier 1); double-wake with two attended sessions (→ CURSOR;
  launch shape = one attended session per agent); kill switch is portal's, tracked outside M8C;
  daemon-owned bot = new egress surface; Primary/Standby device-linking needs its own design log
  (→ DOD-PRIMARY-DESIGN-1 gate).

**Scope decisions (Andre, 2026-07-05 — full rationale in [[M8C-DECISIONS]]):**
D1 launch tier = doorbell only (spike → stage 1 → auto-start → INBOX); D2 Telegram Mode 1
doorbell in M8C, full-monitoring + Mode 2 → follow-on milestone; D3 async foundation AND
multi-daemon STAY in M8C as Tiers 4/5 (one big milestone, launch gates at end of Tier 1);
D4 OQ-1 closed — daemon-owned bot.

**Commits:** `c930783d` (verification pass into notes), `8aa53878` (wikilinks), this apparatus.

**Next:** DOD-SPIKE-1.

---

### 2026-07-06 — Entry 1: onboarding/command-surface friction folded in (D5)

**What happened.** Reviewed the M8B UX friction backlog
([[2026-07-02_1130_m8b-e2e-ux-friction-log]]) plus a live 2026-07-06 registration walkthrough
with Andre, to fold the cheap, launch-relevant friction fixes into M8C rather than leave them for
a later polish pass. Each candidate was **re-verified against current cello-client code** (the log
is 4 days stale) before folding.

**Re-verification (what changed since the log):**
- **Already fixed → dropped:** F3 (`cello_get_inclusion_proof` now computes a real RFC 6962 proof,
  not `not_implemented`); F10 + F17 (`interrupted_sessions` reworked — resumable-only, 0-message
  dead handshakes excluded, capped at 10, rule documented in-code). Plus the earlier-shipped
  F1/F2/F13/F14/F15/F16/F20/F23.
- **Confirmed still open → folded:** F5 (`state:"current"` overload, `daemon.ts:1440-1442`),
  F18 (`no_current_agent` hard-error, no sole-online fallback, `daemon.ts:2566`), F4 (single
  `sealed_receipt_not_found`, `daemon.ts:3141` — decided 2026-07-04, unshipped), F6 (no directory
  CLI/config, env-var only `directory-bootstrap.ts:32`), F12 (no bound-directory in status),
  F11 (`directory.signaling.reader.error` at warn, `signaling-connect.ts:323`), F24 (`--help` is
  a bare command list; per-command help is one thin line).
- **New onboarding findings (R1–R7)** from the walkthrough: quoting guesswork; the create→register
  two-step is unexplained; the missing-token error is a generic Usage dump; a **malformed token
  returns NO output** (silent failure — R4, needs repro); the env-var form works but is invisible;
  the pre-auth exposure warning is misframed. Ground truth verified: agent-name rule is
  `^[a-zA-Z0-9_-]{1,64}$`; `cello.ts:82` falls back to `process.env.CELLO_PREAUTH_TOKEN` (env-var
  form works — the other AI's advice was right); pre-auth tokens are **single-use + 24h**
  (directory `consumed_at`, "single-use is enforced", `preauth.token.reuse.rejected`) — so the
  exposure warning applies durable-secret hygiene to a burn-on-use token.

**Folded into the DoD (D5):**
- **Tier 1 (launch-critical):** new ONBOARD-HELP/ERRORS/NEXTSTEP/WARN/LOGNOISE-1 lines
  (F24 + R1–R7 + F11), F5/F18 riders on AUTOSTART, F4 rider on INBOX, and a cold-onboarding
  bar added to the DOD-LIVE-1 launch smoke. Rationale: onboarding is the first-connect path
  (unforgivable if broken per launch triage) and next-step legibility is load-bearing for AI
  operators — so it gates launch, cheaply.
- **Tier 2:** F6/F12 riders on CONFIG (F6 flagged keep-or-cut — convenience, not redundancy).
- **Tracked, not fruit:** F7, F9, F21, F22 (+ R4 repro) in the DoD's new tracked-separately
  section.

**Docs touched:** M8C-DEFINITION-OF-DONE (riders + ONBOARD group + tracked section),
M8C-DECISIONS (D5), M8C-SPEC (Tier 1 note), this journal + status board. No code yet — scope only.

**Next (unchanged):** DOD-SPIKE-1 — the ~30-min live `claude --channels` spike.

---

### 2026-07-06 — Entry 2: DOD-SPIKE-1 design note + journey script (before building)

**Unit:** DOD-SPIKE-1 (Tier 0). Opus 4.8 implementer, main loop, autonomous.

**Terrain re-verified in code (2026-07-06, cello-client HEAD `f1d5e67`):** the daemon→shim→Claude
hop, all three legs located:
1. **Daemon emits** — `NotificationDispatcher.dispatchSessionStateChanged`
   (`core/daemon/src/notification-dispatcher.ts:124`) builds the IPC frame
   `{ notification: "session_state_changed", data: { agent, type, agentName, sessionId, state, counterpartyPubkey } }`
   and writes it to every connection whose `currentAgent === agentName`.
2. **Shim drops it** — `IpcProxy.#processBuffer` (`core/adapter-claude-code/src/ipc-proxy.ts:183-185`):
   `if ("notification" in frame) { /* skip for now */ continue; }`. This is the ONE unproven hop.
3. **Target event** — legacy `notifications.ts` shows the shape to emit: an MCP JSON-RPC
   notification `method: "notifications/claude/channel"`, content-free params. The
   `claude/channel` capability is declared on the `McpServer` as
   `{ capabilities: { experimental: { "claude/channel": {} } } }` (`server.ts:131`). The LIVE shim
   `cello-mcp.ts:120` does NOT declare it yet — WAKE adds it; the spike patches it.

**What is ALREADY proven (so the spike need not re-prove it):**
- Daemon→real-IPC-socket delivery of `session_state_changed`: `mcp-002-notifications.test.ts`
  AC-004/012 (real `startDaemon` + real `connectToDaemon`, asserts the frame arrives).
- Legacy in-process adapter → MCP `notifications/claude/channel` → MCP `Client` receipt:
  `adapter-002.test.ts`. Proves translation + client receipt, but for the LEGACY server, not the
  live shim over real stdio.
- Therefore the spike's de-risking target narrows to exactly: **does the real `cello-mcp.js`
  binary, patched to forward, translate a real daemon `session_state_changed` IPC frame into a
  `notifications/claude/channel` JSON-RPC notification on its stdout — the exact bytes
  `--channels` consumes?** If yes, the reactive track is de-risked. If no, redesign on day 0.

**Journey script (headless, faithful — real daemon + real shim binary + raw MCP stdio):**
1. Patch the two real files minimally (throwaway; reverted after capture — WAKE reimplements with
   tests): `ipc-proxy.ts` gains `onNotification(fn)` + calls it in the notification branch
   (BEFORE response correlation, never touching `#pending` — the D7 porting trap); `cello-mcp.ts`
   declares the `claude/channel` capability and, after `server.connect`, registers
   `proxy.onNotification(frame => server.server.notification({ method: "notifications/claude/channel", params: frame.data }))`.
2. `pnpm run build`.
3. Spike harness (`scratchpad/spike/`): `startDaemon` (CELLO_ENV=test, temp CELLO_DIR, alice
   agent seeded like `setupWithAgents`); spawn real `dist/bin/cello-mcp.js` with `CELLO_DIR`=temp
   as a stdio subprocess; drive raw MCP JSON-RPC on its stdin (`initialize` → inspect whether the
   response advertises `claude/channel` → `notifications/initialized` → `tools/call cello_start_agent`
   + `cello_use_agent alice`); from a SECOND raw `connectToDaemon` client emit
   `__test_emit_session_event { type:"created", sessionId, agentName:"alice", counterpartyPubkey }`;
   watch the shim's stdout for a `notifications/claude/channel` line; print the exact JSON.
4. Assert it landed; record exact flag/event shape + surprises here BEFORE any WAKE code.
5. Revert the two-file patch (`git checkout`).

**The one genuinely-human leg (flagged, not blocking):** visually confirming the event appears
*inside an interactive `claude --channels` chat context* (Anthropic's channel-injection feature)
needs a human at the keyboard. Per SPEC §2 that flag is settled — "the spike confirms CELLO's
specific end-to-end wiring, not the flag." The headless proof above IS the spike's de-risking
verdict; the interactive visual is a manual confirmation for Andre, noted on close.

**INV-CONTENTFREE check:** `session_state_changed` `data` carries no message content (only
type/agent/sessionId/state/counterpartyPubkey) — forwarding `data` wholesale is content-free.
The exact WAKE param contract is WAKE's design; the spike forwards `data` to record the real shape.

**Next:** patch → build → run → journal outcome.

---

### 2026-07-06 — Entry 3: DOD-SPIKE-1 RESULT — PASS, reactive track de-risked ✅

**Verdict: PASS. The hop works. No redesign needed.** The reactive track is sound; WAKE can build
on it.

**What was run (real binaries, headless).** Real daemon (`startDaemon`, CELLO_ENV=test) + the real
shim binary `dist/bin/cello-mcp.js` spawned as a stdio subprocess, minimally patched to forward
notification frames (`ipc-proxy.ts` `onNotification` + `cello-mcp.ts` `claude/channel` capability
and a `proxy.onNotification → server.server.notification("notifications/claude/channel")` bridge).
Drove raw MCP JSON-RPC on the shim's stdin; a `session_state_changed` dispatch was triggered from a
SECOND raw IPC client via `__test_emit_session_event`. Harness:
`scratchpad/spike/spike.mjs` (throwaway). **The two-file patch was reverted after capture and the
tree rebuilt clean — WAKE reimplements it properly with TDD + the pull twin after M9INT.**

**Evidence — 3/3 notification types surfaced on the shim's stdout as `notifications/claude/channel`
(the exact bytes a `--channels` session consumes):**
- **Capability negotiated.** `initialize` response advertised:
  `capabilities.experimental = { "claude/channel": {} }` (alongside `tools.listChanged`). The
  shim really does declare the channel capability once the constructor arg is added.
- **Target frame (`session_state_changed`):**
  `{"method":"notifications/claude/channel","params":{"agent":"alice","type":"session_state_changed","agentName":"alice","sessionId":"spike-sess-001","state":"created","counterpartyPubkey":"deadbeefcafe"},"jsonrpc":"2.0"}`
- Also `agent_state_changed` (from `cello_start_agent`) and `agent_current_changed` (from
  `cello_use_agent`) surfaced identically.

**Exact event shape (for WAKE's param-contract design).** The forwarded MCP notification is
`{ jsonrpc:"2.0", method:"notifications/claude/channel", params: <the daemon frame's `data` blob> }`.
The daemon `data` blob is content-free — `agent`, `type`, `agentName`, `sessionId`, `state`,
`counterpartyPubkey` — no message content (INV-CONTENTFREE holds). WAKE will decide the precise
param field set (the spike forwarded `data` wholesale to record ground truth); the daemon already
supplies exactly the content-free doorbell fields the DoD wants.

**Flag behavior confirmed.** No `--channels`-specific daemon/shim behavior is needed for the frame
to reach stdout — the shim emits the JSON-RPC notification unconditionally once it declares the
capability and forwards. `--channels` is the Claude Code STARTUP FLAG that makes Claude Code
*negotiate* the `claude/channel` capability and inject the event into the model's context; per
SPEC §2 that is Anthropic's settled feature and out of CELLO's wiring scope.

**Surprises / findings for WAKE (recorded, not blocking):**
1. **Self-echo.** `agent_current_changed` is routed by the daemon to the *triggering* connection
   (`dispatchAgentCurrentChanged` targets the caller). So a session that calls `cello_use_agent`
   receives a `claude/channel` event for its own action. Harmless and per-spec (WAKE-1 forwards
   all four types), but WAKE should be aware a session can be "woken" by its own tool call.
2. **Ordering trap held.** The notification branch (`ipc-proxy.ts:183`) runs BEFORE response
   correlation and never touches `#pending` — the D7 porting trap. Forwarding there is correct.
3. **No reconnect (D7).** Unchanged by the spike: socket close = `ipc_connection_lost` forever;
   recovery is a fresh shim + INBOX on reattach. WAKE's edge ACs (no-attached-client → daemon
   queues → INBOX reveals) cover this; nothing here contradicts it.

**Residual HUMAN step (flagged, non-blocking).** The literal visual confirmation that the event
renders *inside an interactive `claude --channels` chat* needs a human at the keyboard (Anthropic's
channel-injection). The headless real-binary proof above IS the spike's de-risking substance
(SPEC §2: "the spike confirms CELLO's specific end-to-end wiring, not the flag"), so SPIKE-1 is
✅ on the wiring. Recommended when Andre next runs a live session; not a launch gate and not a
blocker for M9INT/WAKE.

**Status flip:** DOD-SPIKE-1 → ✅.

---

### 2026-07-06 — Entry 4: M9 merge DEFERRED to after the channel tiers (D11) — NOT a prerequisite

**Directive (Andre, 2026-07-06).** After SPIKE-1 the implementer took the next DoD line
(DOD-M9INT-1) at face value and began preparing the `m9-build` merge. Andre interrupted:
**"That must be leftover. If it says you need to merge M9 beforehand, make sure those instructions
are superseded. We're gonna do M9 afterwards."** And: **"Don't want any confusion with anyone
thinking after compaction M9 needs to be merged. It does not."**

**Nothing was merged.** Only a read-only `git merge-tree` dry-run + inspection ran; cello-client
`main` is clean, `m9-build` untouched, no install/commit touched M9.

**What I found while inspecting (recorded so the eventual merge isn't surprised):**
- The merge is **no longer conflict-free** — main gained 8 commits since the 2026-07-05 dry-run
  (seal-liveness + token-parse), producing **4 conflicts**: `core/daemon/src/daemon.ts`,
  `core/daemon/src/session-node-manager.ts` (the seam files), `tsconfig.json`,
  `vitest.workspace.ts`. The DoD's "dry-run conflict-free 2026-07-05" note is stale.
- **M9-GATE-1 green is unverified** — the M9 build journal stops at "first build step"; it was not
  maintained across the 34 build commits on `m9-build`. Before any future merge, confirm
  `core/daemon/src/__tests__/m9-gate-1.test.ts` is actually green on `m9-build` as the baseline.
- Gateway package deps are light (`re2-wasm` + optional native `re2`) — no heavy model download.

**Decision D11 applied across the apparatus (this is the anti-confusion measure):**
- **DoD:** DOD-M9INT-1 moved OUT of Tier 0 into a new **"Post-channel — deferred"** section; Tier 0
  is now SPIKE-1 only (✅). `DOD-INV-GATEWAY` re-tagged **"(activation: when M9INT lands, after the
  channel tiers)"** — not satisfiable until the gateway exists on main; done-auditor must not fail
  it before then. A ⛔ banner sits at the top of the Tier 0 section.
- **PROCEDURE §4:** step 2 is now DOD-WAKE-1 (was M9INT), with a ⛔ banner. **§5:** "M9 seam
  untouchable" reworded to **seam-readiness** (build new content paths through the single
  `ingestReceivedContent` funnel / `cello_send` so the later merge wires cleanly; do NOT merge M9).
- **SPEC §3/§4, KICKOFF first-actions + non-negotiables + DECISIONS-through-D11:** "M9 merged
  first / Tier 0" language superseded with explicit ⛔ callouts.
- **The one real caveat:** DOD-LEAVEMSG-1 (Tier 4) is the only channel unit that adds a genuinely
  new inbound content path — it must funnel through `ingestReceivedContent` (seam-ready) so M9
  screens it when it lands. Recommended M9 landing: soon after the Tier 1 launch, before LEAVEMSG.
- **Launch-pillar note (Andre's call, surfaced not silently dropped):** deferring M9 means the
  Tier 1 launch gate ships without content screening / injection defense. Legitimate at alpha (one
  trusted operator); recorded as a conscious decision.

**Next unit:** DOD-WAKE-1 (Tier 1 — channel stage 1, the doorbell forwarding, built properly with
TDD + pull twin). SPIKE-1 already proved the hop; WAKE makes it real.

---

### 2026-07-06 — Entry 5: DOD-WAKE-1 clause checklist + falsify-first (before code)

**Unit:** DOD-WAKE-1 (Tier 1, launch gate). Shim-only change; **zero daemon change** (the daemon
already dispatches — SPIKE-1 proved it; WAKE stops the shim from dropping the frames). This is
legitimately shim-side, NOT a §5 violation: the daemon owns the *behavior* (dispatch); the shim
owns the adapter-specific *wire translation* (daemon IPC frame → MCP `notifications/claude/channel`),
which every adapter does differently.

**Clause checklist (the reviewer's yardstick — per-clause verdict required):**
- **C1 — capability.** The live shim (`bin/cello-mcp.ts`) declares `claude/channel`:
  `new McpServer({name,version}, { capabilities: { experimental: { "claude/channel": {} } } })`
  (mirrors legacy `server.ts:131`). Proven by the `initialize` response advertising it.
- **C2 — forward, don't drop.** `ipc-proxy.ts:183-185` stops dropping notification frames; it
  invokes a registered handler instead. Branch stays BEFORE response correlation and never touches
  `#pending` (D7 porting trap).
- **C3 — all frame types.** The bridge forwards every daemon notification type generically —
  `agent_state_changed`, `agent_current_changed`, `session_state_changed` today; `cello_message`
  rides free once MSGWAKE (Tier 2) makes the daemon emit it (no per-type allowlist that would drop
  a future type).
- **C4 — MCP event shape.** Each becomes `server.server.notification({ method: "notifications/claude/channel", params })`.
  `params` is the daemon frame's content-free `data` (agent, type, agentName, sessionId, state,
  counterpartyPubkey). **INV-CONTENTFREE:** no message content, no content-derived text — assert it.
- **C5 — error fidelity (D7 trap, BLOCKING if missed).** `server.server.notification()` can reject
  if the transport closed. The legacy `notifications.ts` swallowed this with a bare `catch {}`. The
  port MUST log it — `notification.push.failed` at debug with the reason — never a silent bare
  catch, and never let one failed push kill the proxy read loop.
- **C6 — observability.** A `domain.noun.verb` event on forward (e.g. `notification.channel.forwarded`
  with type + agent), plus C5's failure event. No `console.log`. (Shim has no injected logger today
  — it writes diagnostics to the stderr tee; use that channel, structured, not `console.log`.)
- **C7 — edge: seal/abort-before-react.** A `session_state_changed` with state `sealed` /
  `aborted` / `interrupted` forwards gracefully (the bridge is state-agnostic — it forwards
  whatever the daemon dispatched; no crash, no special-casing).
- **C8 — edge: no-attached-client + INV-PUSHPULL.** With no MCP client attached, the daemon
  dispatches to nobody (existing behavior — dispatcher only writes to connected connections) and
  loses no state; the queued inbound session is still recoverable via the EXISTING pull path
  (`cello_await_session` / `cello_list_sessions`) on a later attach. WAKE ADDS push without
  removing any pull, so INV-PUSHPULL holds; "INBOX reveals on attach" is INBOX-1's richer surface,
  not owed here.
- **C9 — publish rides LIVE-1 (D6).** No `connect` publish now; prove against a locally-linked
  shim. The bump ships with the Tier 1 close cascade (PROCEDURE §2a).

**Falsify-first (CLAUDE.md Debugging Discipline):**
- *Method on the interface?* `proxy.onNotification(fn)` — new method I add to `IpcProxy` (a class,
  the shim holds the concrete instance, not an interface). `server.server.notification(...)` —
  exists (legacy `notifications.ts` uses exactly this). ✔
- *Responsibility here?* Yes — adapter-specific wire translation is the shim's job. ✔
- *Redundancy?* No — the daemon dispatches once; the shim translates once; no double-send. ✔
- *What breaks?* (a) notification branch must run before id-correlation (it does, line 183 < 189)
  and not touch `#pending` — a concurrent in-flight request must still resolve. (b) A throwing
  `notification()` must not kill the read loop. Both become explicit red tests.

**Test strategy (enforcers by layer):**
- **Unit (kept, red-first) — `mcp-001-proxy.test.ts` pattern** (fake `net` server + real
  `IpcProxy`): (1) a `{notification,data}` frame fires the registered handler with the frame;
  (2) `#pending` untouched — a concurrent `proxy.call` still resolves while notification frames
  interleave; (3) a notification arriving between a malformed frame and a response keeps
  correlation correct.
- **Integration (kept) — real in-process daemon + real shim over stdio**, home `core/daemon`
  (has daemon access; spawn the shim from SOURCE via `tsx` to avoid the test-before-build gate
  ordering). Asserts: `initialize` advertises `claude/channel`; a `__test_emit_session_event`
  for the current agent surfaces as a `notifications/claude/channel` on the shim's stdout with the
  content-free params; a `sealed`-state emit also forwards (C7).
- **Live enforcer (LIVE-1, human):** the `--channels` in-context visual — not owed until the Tier
  1 close smoke.

**Next:** write the red unit tests → red for the right reason → implement the two-file change →
integration test → gate → `cello-unit-reviewer`.

---

### 2026-07-06 — Entry 6: DOD-WAKE-1 built + reviewed → 🟡 (unit/integration green; LIVE-1 owed)

**Built (commit `d5fd5ec`, cello-client main).** Two-file shim change, ZERO daemon change:
- `ipc-proxy.ts`: `onNotification(handler)` + forward in the notification branch (before response
  correlation, never touches `#pending`; defensive try/catch so a throwing handler can't kill the
  read loop).
- `bin/cello-mcp.ts`: declares the `claude/channel` capability; bridges each daemon frame to an MCP
  `notifications/claude/channel` event (content-free `data` as params) generically — no per-type
  allowlist. C5 error fidelity: a failed push logs `notification.push.failed` with the real reason
  (never a bare `catch{}` — the D7 legacy trap avoided); C6: `notification.channel.forwarded` on
  success. Structured events to the stderr tee (stdout is the MCP channel); no `console.log`.

**Tests (kept):** `mcp-wake-001.test.ts` (unit — forward / no-`#pending`-consumption / content-free)
+ `m8c-wake-1-integration.test.ts` (real daemon + real shim over stdio via `tsx`-from-source —
capability advertised in `initialize`, three distinct types surface, created+sealed, content-free,
C6 event fires). **Full gate green** (1503 tests, lint, typecheck, build).

**`cello-unit-reviewer` (commit d5fd5ec) — verdicts: SPEC FAITHFUL (all 9 clauses implemented),
NO SILENT FALLBACKS, HOLLOW TEST found (blocking).**
- **T1 [BLOCKING, fixed — commit after d5fd5ec].** The integration test asserted only
  `session_state_changed`, so a per-type allowlist bridge (violating C3) would pass every test.
  Fixed: the test now asserts all THREE types (session_state_changed + agent_state_changed +
  agent_current_changed, already triggered by start/use_agent) surface through the one bridge.
  **Teeth proven:** temporarily applying the allowlist bypass turns the test red at the
  `agent_state_changed` assertion; reverted.
- **F1 [LOW — TRACKED, not fixed; deferral has a home].** Startup window: `proxy.connect()` starts
  the socket read loop before the handler is registered (after `server.connect`); a daemon push in
  that sub-ms window (e.g. another client starts an agent → broadcast `agent_state_changed`) is
  dropped. Reviewer rated LOW + not-blocking-for-stage-1 — it is **pull-recoverable** (INV-PUSHPULL:
  `cello_await_session` / `cello_list_sessions` retained), so it is a reconcilable drop, not the
  dangerous unreconciled kind. The clean fix (buffer-until-transport-ready, or gate dispatch on the
  client's `notifications/initialized`) touches MCP lifecycle timing and belongs with a
  connection-lifecycle unit (relates to F7/F9 in the tracked-separately section), not smuggled into
  WAKE. Not launch-blocking. **Home:** here + revisit at the lifecycle work.
- **F2 [Observation — flag carried to MSGWAKE].** The shim is a blind pass-through; INV-CONTENTFREE
  is enforced UPSTREAM in the daemon (the bridge forwards `data` verbatim). Correct today
  (daemon frames are content-free; `cello_message` not yet wired). **DOD-MSGWAKE-1 must re-prove
  content-freeness against the REAL `cello_message` producer**, not assume it from this generic
  bridge. Recorded for that unit.
- **T2 [weak, acceptable — no change].** The unit content-free test is somewhat tautological
  (asserts on a frame the test constructs); redeemed by the integration test asserting
  content-freeness on real daemon-produced frames.

**Status:** DOD-WAKE-1 → **🟡 BUILT / UNVERIFIED-LIVE.** Daemon/IPC layer is proven (unit +
real-binary integration). The in-context hop enforcer is a live `claude --channels` session, which
is DOD-LIVE-1 (Tier 1 close) — WAKE flips ✅ there, with the `connect` publish cascade (D6/C9).

**Next unit:** DOD-AUTOSTART-1 (`cello_use_agent` auto-starts the agent; F5/F18 riders).

---

### 2026-07-06 — Entry 7: DOD-AUTOSTART-1 design note + clause checklist (before code)

**Unit:** DOD-AUTOSTART-1 (Tier 1). DAEMON-side (PROCEDURE §5 — the shim already forwards
`cello_use_agent`). Design fork resolved as **D12** (fast auto-start + `not_registered` precondition,
no signaling block).

**Code terrain (verified, cello-client HEAD; symbols not line numbers):**
- `cello_start_agent` handler (~`daemon.ts:1540`): pre-checks (`missing_params`, `agent_not_found`);
  idempotent if already online; else adds to `onlineAgents`, establishes the agent's directory
  signaling (`getAgentSignaling`), fires the standing-receiver ensure + flush + auto-recover
  (fire-and-forget, failures logged not returned), dispatches `agent_state_changed`. → EXTRACT the
  body into `startAgentInternal(name): { ok } | { ok:false, reason, guidance }`; both handlers call it.
- `cello_use_agent` handler (~`:1838`): today returns `agent_not_online` when `!onlineAgents.has(name)`
  (~`:1847`). → REPLACE that early-return with the auto-start.
- `no_current_agent` sites use `params.name ?? connState.currentAgent; if(!agentName) → no_current_agent`:
  `cello_refresh_shares` (~`:2566`), `cello_get_relay_receipts` (~`:2599`); `cello_send` /
  `cello_receive` / `cello_await_session` have their own inline guards (comment ~`:2634-2639`). F18
  applies to all.
- `getAgentsForConnection` (~`:1440-1447`) sets `state="current"` when current+online — the ONLY
  emit site; no other cello-client consumer reads `"current"` (grep-verified). F5 target.
- Registration is detectable via `DbIdentityStore` (already imported/used in daemon.ts) —
  `reg_status='active'` / `reg_primary_pubkey` mark a directory-registered agent.

**Clause checklist (reviewer yardstick — per-clause verdict):**
- **A1** — `cello_use_agent` on a loaded-but-offline agent AUTO-STARTS it (via `startAgentInternal`)
  then sets it current. `login → use_agent` works with no explicit `cello_start_agent`.
- **A2** — `cello_start_agent` unchanged in behavior (bring-online-without-claiming); now delegates
  to the shared `startAgentInternal` (no duplication; identical semantics — idempotent, same events).
- **A3** — auto-start failure returns structured `agent_start_failed { reason, guidance }` (ONBOARD-
  NEXTSTEP style) and leaves `connState.currentAgent` UNCHANGED (no half-selected state). Reason set:
  `not_registered` (identity store `reg_status !== 'active'`) with register guidance; `agent_not_found`
  stays its own reason (pre-check). Per D12, `directory_unreachable` is NOT synchronously surfaced
  (async/self-healing) — guidance points to `cello status` `directory_signaling`.
- **A4 (F18)** — a shared `resolveCurrentAgent(connState, explicitName)` returns
  `explicitName ?? currentAgent ?? (onlineAgents.size===1 ? theSoleOnline : null)`. Applied at every
  `?? currentAgent` site (refresh_shares, get_relay_receipts, send, receive, await_session). Sole-
  online is USED, not `no_current_agent`. (Sole-online means exactly one agent in `onlineAgents`.)
- **A5 (F5)** — `getAgentsForConnection` emits `state: "online"` + a distinct `selected: true` for
  the current agent, never `state: "current"`. Add `selected?: boolean` to `AgentInfo`. Leave
  `"current"` in the `AgentState` union (unused now) to avoid needless blast radius.
- **Obs** — `agent.autostart.attempted` / `agent.autostart.failed` (with reason); reuse
  `agent.online` on success. No `console.log`.
- **§5** — all logic in the daemon; the shim's `cello_use_agent` proxy is untouched.

**Falsify-first:** (a) extracting `startAgentInternal` must preserve the fire-and-forget standing-
receiver/flush/auto-recover chain EXACTLY (regression risk: a started receiver with no stream never
receives inbound — the CONN-001 keystone). (b) F18 sole-online must read `onlineAgents` (daemon-
global) not per-connection — two agents online but none selected must STILL error (ambiguous), only
exactly-one-online auto-selects. (c) A3 selection-unchanged: set `currentAgent` only AFTER a
successful start, never before.

**Test strategy:** extend the daemon fixture pattern (real `startDaemon` + `connectToDaemon`, as in
`mcp-002-notifications.test.ts`): A1 (use_agent offline → online+current, one call), A2 (start_agent
still works), A3 (unregistered agent → `agent_start_failed{not_registered}`, `cello_list_agents`
shows selection unchanged), A4 (sole-online: a name-defaulting tool works with no use_agent; two
online + none selected → still `no_current_agent`), A5 (status: current agent is `state:online` +
`selected:true`, never `"current"`).

**Next:** red-first tests → implement → gate → `cello-unit-reviewer`.

---

### 2026-07-06 — Entry 8: DOD-AUTOSTART-1 built + reviewed → 🟡

**Built (commits `245c7b2` impl, `08b9dae` review fixes; cello-client main).** DAEMON-side (§5).
- `startAgentInternal(name)` extracted from `cello_start_agent` — **CONN-001 keystone preserved
  byte-for-byte** (reviewer verified against `245c7b2^`): `getAgentSignaling` → the fire-and-forget
  `ensureStandingReceiverForAgent → flushAwaitingContent → autoRecoverForAgent` chain, unchanged.
- `cello_use_agent` auto-starts a loaded-but-offline agent then selects it (A1); `cello_start_agent`
  delegates to the shared fn (A2). Selection is set only AFTER a successful start (A3 — no
  half-selected state). `not_registered` is a NON-BLOCKING warning on the OK response (D12).
- `resolveCurrentAgent` (F18): sole-online fallback at the `?? currentAgent` sites; two-online +
  none-selected still `no_current_agent` (daemon-global read). F5: `state:"online"` + `selected:true`,
  never `"current"`; `AgentInfo.selected` added.

**Tests:** `m8c-autostart-1.test.ts` (8 — A1–A5 + the negative not_registered case) + `mcp-001-
agent-lifecycle.test.ts` rewritten to the new contract (`state:"current"` → `selected`;
`agent_not_online` → auto-start; strict `toEqual({ok:true})` relaxed where the warning rides).
Full gate green (1511 tests).

**`cello-unit-reviewer` (245c7b2) — SPEC: DEVIATIONS FOUND (legal, journaled); NO SILENT FALLBACKS;
HOLLOW TEST found (blocking). All three findings fixed in `08b9dae`:**
- **F1 [non-blocking deviation] — `agent_start_failed` is unreachable.** The `agent_not_found`
  pre-check catches nonexistence before auto-start, and permissive `startAgentInternal` (D12) has
  no other synchronous failure — so the structured envelope never fires. Aligns with D12 (no
  synchronous start-failure reason exists). Resolution: kept as the **reserved** structured-failure
  surface (reachable when D12's reverse adds a bounded signaling wait → `directory_unreachable`),
  documented in-code + here. `agent_not_found` is `use_agent`'s real failure surface today.
- **F2 [BLOCKING test-teeth] — no negative `not_registered` test.** A hardcoded-warning impl passed
  the whole suite. Fixed: a REGISTERED agent (seeded via `cello_create_agent` +
  `persistRegistrationState`, DB via `handle.getSessionNodeManager().getDb()`) asserts the warning
  is ABSENT. **Teeth verified** — an unconditional-warning bypass turns it red.
- **F3 [LOW] — registration-read failure dropped the signal silently on the surface** (loud in
  log). Fixed: a read failure now surfaces a softer `registration_unknown` warning so the surface
  isn't falsely clean.

**Deviations from the literal DoD, all journaled (legal per §2b):** `not_registered` non-blocking
(D12, migration trap — 19 test files start agents, 6 register); `directory_unreachable` not
synchronously surfaced (D12); F18 scoped to the cited name-defaulting sites (broader session-tool
guards deliberately out).

**Status:** DOD-AUTOSTART-1 → **🟡 BUILT / UNVERIFIED-LIVE** (daemon-layer proven; flips ✅ at the
live `--channels` smoke, DOD-LIVE-1, with the publish cascade).

**Next unit:** DOD-INBOX-1 — see Entry 9 design note.

---

### 2026-07-06 — Entry 9: DOD-INBOX-1 design note + clause checklist (falsify-first done; before code)

**Unit:** DOD-INBOX-1 (Tier 1). DAEMON-side (§5) — the shim adds one thin `cello_check_notifications`
proxy; all logic in the daemon. The **push-loss reconciler** (notifications are fire-and-forget) +
the primary inbox for poll-only clients.

**Code terrain (verified 2026-07-06, symbols):**
- **cello_receive = `handleReceive`** (`daemon.ts:4838`). Drains ONE buffered message per call via
  `sessionNodeManager.takeReceivedContent(agent, sessionId)` → `{ contentHex, sequenceNumber,
  senderPubkey }` (`:4864`). **This is the watermark-advance point** (delivery marks read).
- **Transcript** = `sessionNodeManager.readTranscript(agent, sessionId)` →
  `messages: { sequence, direction: "sent"|"received", text, createdAt }[]`
  (`session-node-manager.ts:659`). `sequence` is relay-assigned — SAME space as
  `takeReceivedContent.sequenceNumber` (falsify: confirm at build). Unread counts
  **received-direction only**.
- **Pending session requests** = in-memory `inboundSessionQueues: Map<agentName, InboundSessionEvent[]>`
  (`daemon.ts:3742`), drained by `cello_await_session` (`:4206`). INBOX READS it non-destructively —
  must NOT drain (await_session owns draining) → may need a peek accessor.
- **Schema** = `CREATE TABLE IF NOT EXISTS` blocks in `session-node-manager.ts` (~`:436-531`). Add
  the watermark table here (additive; client-DB wipe-and-recreate is fine at alpha — D7).
- **F4 site** = `cello_get_sealed_receipt` (`daemon.ts:3188`), single `sealed_receipt_not_found`
  (`:3203`). Loaded agents for scope:"all" = `loadedAgents`.

**Clause checklist (reviewer yardstick):**
- **N1** — `cello_check_notifications({ scope?: "current" | "all" })`: daemon IPC handler + thin
  `cello-mcp.ts` proxy. Default `"current"` → connection's current agent (no current + not
  sole-online → `no_current_agent` via `resolveCurrentAgent`, F18); `"all"` → every loaded agent,
  LABELLED. Returns `{ ok, agents: [{ agent, pending_session_requests, unread: [{ session_id,
  unread_count, last_seq }] }] }` (finalized at build; content-free — IDs/counts, never text).
- **N2** — unread = COUNT of `readTranscript` rows `direction==="received"` AND
  `sequence > last_delivered_seq(agent, session)`. New table
  `message_watermarks(agent_name, session_id, last_delivered_seq, PRIMARY KEY(agent_name, session_id))`
  + `SessionNodeManager.getLastDeliveredSeq` (0 if absent) / `advanceLastDeliveredSeq` (MONOTONIC —
  max(old, seq), never lowers).
- **N3** — `handleReceive`, on a `takeReceivedContent` hit (`:4864`), advances the watermark to that
  message's `sequenceNumber` before returning. Delivery marks read; no ack verb.
- **N4** — INBOX derives ONLY from the watermark + `inboundSessionQueues`. No separate notification
  store; no ack. (Distinct from CURSOR's per-connection cursor, Tier 2.)
- **N5 (AC)** — a doorbell missed while the shim was down/busy is discoverable via INBOX on
  reattach: a persisted-but-undrained received message shows unread; after `cello_receive` it clears.
- **F4** — `cello_get_sealed_receipt` splits `sealed_receipt_not_found` → `session_id_too_short` /
  `unknown_session` / `wrong_agent` / `not_sealed_yet`; PLUS `cello_list_sessions` + `cello_status`
  surface FULL `session_id` (verify no truncation; if truncated, stop).
- **Obs** — `inbox.checked` (scope, agentCount, totalUnread), `message.watermark.advanced`. No console.log.

**Falsify-first:** (a) confirm `takeReceivedContent.sequenceNumber` and `transcript.sequence` share
the relay-assigned space before trusting `>`. (b) INBOX reads `inboundSessionQueues`
non-destructively (peek, not drain). (c) watermark advance monotonic (replayed/out-of-order receive
must not lower). (d) unread = received-only. (e) F4 `session_id_too_short` uses the canonical min
hex length other handlers validate against.

**Test strategy:** daemon fixture (`startDaemon`+`connectToDaemon`); seed a session + received
transcript rows → assert unread count; drain via `cello_receive` → unread clears + watermark
advanced + monotonic; queue an `InboundSessionEvent` → appears as pending AND INBOX did not drain
it (subsequent `await_session` still returns it); `scope:"all"` labels multiple agents; F4 four
crafted inputs → four distinct reasons; list/status full IDs.

**Next:** red-first tests → implement (schema + methods first, then handler + proxy + F4) → gate →
`cello-unit-reviewer`.

---

### 2026-07-06 — Entry 11: DOD-INBOX-1 built + reviewed → 🟡

**Built (commits `dfc02e8` impl, `22de42c` review fixes; cello-client main).** DAEMON-side (§5).
- New persisted `message_watermarks` table + `SessionNodeManager.getLastDeliveredSeq` /
  `advanceLastDeliveredSeq` (monotonic MAX) / `getUnreadSummary` (received-only COUNT/MAX SQL, no
  decrypt). `handleReceive` advances the watermark on a `takeReceivedContent` hit (N3, delivery
  marks read). `cello_check_notifications({scope})` handler (current via `resolveCurrentAgent`
  F18 / all→loadedAgents labelled) + thin shim proxy. F4: `cello_get_sealed_receipt` splits into
  `not_sealed_yet`/`wrong_agent`/`session_id_too_short`/`unknown_session` (list/status already
  return full ids).
- **Falsify-first confirmed:** `takeReceivedContent.sequenceNumber === transcript.sequence ===
  leafIndex` (one sequence space), so the watermark `>` comparison is sound.

**Tests:** `m8c-inbox-1.test.ts` (8 — N1 scope current/all + F18, N2 received-only, N3 monotonic +
the live-receive coupling, N4 non-destructive, N5 reconciliation, F4 four reasons). Full gate green
(1519).

**`cello-unit-reviewer` (dfc02e8) — SPEC FAITHFUL (7/7), NO SILENT FALLBACKS, HOLLOW TEST (blocking).
All fixed in `22de42c`:**
- **F1 [BLOCKING test-teeth].** N3's `handleReceive → advanceLastDeliveredSeq` coupling had zero
  coverage — every test drove the primitive directly; a hollowed `handleReceive` passed all 7.
  Fixed: a test drives a LIVE `cello_receive` (via a `__test_buffer_received` hook +
  `pushReceivedContentForTest`) and asserts the watermark advanced. **Teeth verified** — deleting
  the advance line turns it red.
- **F2 [MEDIUM, pre-existing].** `recordTranscriptMessage` swallowed write failures at `warn`.
  Since INBOX-1 the transcript is the AUTHORITY for unread, a swallowed RECEIVED-row write silently
  undercounts unread + loses the message on restart (masked by live buffer delivery). Fixed:
  received-row failures now log at `error` with `impact=unread_reconciliation_may_undercount`
  (sent-row failures stay `warn`). Fixed-when-found per the standing rule.
- **F3 [LOW — TRACKED, not fixed].** The watermark is only advanced by live buffered delivery, so a
  message persisted-but-undelivered at daemon restart, or unread rows at seal, stay "unread"
  forever. **Over-reports in the SAFE direction** (never hides a missed message) and the content is
  recoverable via `cello_get_transcript` — a UX papercut, launch-forgivable. **Home:** a later fix
  lets `cello_get_transcript` / seal-eviction advance the watermark for rows it surfaces.

**Status:** DOD-INBOX-1 → **🟡 BUILT / UNVERIFIED-LIVE** (daemon layer proven; flips ✅ at
DOD-LIVE-1 with the publish cascade).

**Next unit:** the ONBOARD-* rider cluster — see Entry 10 design note (repro R4 first).

---

### 2026-07-07 — Entry 45: DOD-LIVE-1 doorbell RE-RUN on connect 0.0.60 — PASS, receiver side (CELLO_Support) — Entry 44's fix confirmed live

**Why this matters:** Entry 44 root-caused Entry 43's hard fail (shim omitted the required
`content` field, so the daemon's channel push was dropped silently by Claude Code) and shipped a
fix as connect 0.0.60, ending with an explicit ask: re-run Entry 43's doorbell test live and check
whether the receiver's turn now auto-wakes with zero polling. This entry is that re-run, receiver
side, run in a **fresh session on the new build** (session renamed `Cello_Support (Doorbell Test)`
for continuity across the two rounds).

**Setup:** `cello_use_agent({ name: "CELLO_Support" })` → immediately received an unprompted
`<channel source="cello" type="agent_current_changed">` push confirming the agent switch — first
signal the channel path is alive on this build. Posted the required line — `"Ready and idle —
waiting for the CELLO doorbell. I will not poll."` — then made zero tool calls, per the same
no-poll discipline as Entry 43.

**What happened this time — doorbell fired, twice, unprompted:**
1. A `<channel source="cello" type="session_state_changed">` event pushed into context on its own:
   `sessionId="eed192da9e292565c09cb2036db83a3b"`, `state="created"`, `counterpartyPubkey` =
   Ms_Chelly's, with an explicit instruction to call `cello_receive`. **No human intervention, no
   polling** — this is the exact push Entry 43 never received.
2. Read the session_id directly from the event body (never called `cello_list_sessions` — not
   needed, unlike Entry 43's recovery path) and called
   `cello_receive({ session_id: "eed192da9e292565c09cb2036db83a3b", timeout_ms: 30000 })` →
   immediately returned Ms_Chelly's opening message (sequence 0), a meta-question asking whether
   the push landed this round.
3. A second, independent `<channel source="cello" type="cello_message">` push later arrived
   unprompted announcing Ms_Chelly's follow-up reply, confirming the per-message doorbell (not just
   session-open) also fires correctly.
4. Ran the walkie-talkie loop cleanly: both sides confirmed to each other, in-session, that their
   respective channel pushes had landed with zero polling; mutual `[[WRAP]]` →
   `cello_close_session` → `sealed_root:
   d80d0edef3b148763bbd143f290af2ccc6df1e146be85e443dc8e74c100d1476`, both participants
   `attestation_mode:"live"`.

**Result: PASS.** DOD-LIVE-1's in-context doorbell requirement is met on connect 0.0.60 — the
receiver's Claude Code turn auto-wakes from a pushed `<channel source="cello">` event with no
polling, confirmed for both `session_state_changed` and `cello_message` event types, reversing
Entry 43's hard fail and confirming Entry 44's `buildChannelParams()` fix works end-to-end in a
live two-agent run, today.

**Dogfooding note:** this entry (receiver side) and the companion initiator-side account
(Ms_Chelly) are being appended to this journal independently, coordinated live over a CELLO session
opened for exactly that purpose — the build journal update itself is the dogfood, not just the
doorbell test it describes.

**Not done here:** `latest` promotion (connect+cli) — per Entry 44, still the remaining human-only
step.

---

### 2026-07-07 — Entry 47: DOORBELL PROVEN + FULL M8C BUILD SHIPPED TO `latest` — compaction point; only a live-test pass + the SEC-2 decision remain

**Session-close state. A fresh context can start from here + the M8C-LIVE-TEST-CHECKLIST.**

**What landed this session:**
- **Doorbell root-caused + fixed + proven live.** Entry 43 hard-failed (no `<channel>` push); Entry 44
  found the cause (the shim omitted Claude Code's required `content` field) and shipped
  `buildChannelParams` as connect 0.0.60; Entries 45/46 proved it live in a real two-agent
  `--channels` run — the receiver's turn auto-wakes with zero polling, both directions, both event
  types, matching sealed root. **DOD-WAKE-1 and DOD-MSGWAKE-1 flipped ✅.** DOD-LIVE-1 → 🟠 (doorbell
  half proven).
- **Full M8C client promoted to `latest` and installed** (2026-07-07). All 7 packages promoted:
  crypto 0.0.18, protocol-types 0.0.18, transport 0.0.16, client 0.0.46, daemon 0.0.34, cli 0.0.31,
  connect 0.0.60. Andre reinstalled globally + `cello logout/login` → running daemon 0.0.34, both
  agents (CELLO_Support, Ms_Chelly) up. **The default install path now carries the entire M8C build.**
  (Earlier caution — pin-to-beta-then-promote — was dropped per Andre: one user, alpha, speed wins.)
- **SEC-2 fully documented** — a standalone problem-statement doc
  (`discussion_logs/2026-07-07_1030_sec-2-frost-signing-forgery-finding.md`) + the fix-proposal doc
  (`..._0640_sec-2-frost-signing-auth-fix-proposal.md`). Pre-existing FROST-signing forgery hole;
  Andre's decision on launch-blocker-vs-fast-follow.
- **DOD-PRIMARY-1 (Tier 5) directory-side arbitration** built + real-FROST tested + reviewed earlier
  this session (Entries 35-38); ceremony-gate parked on SEC-2 (D20); rest needs live multi-device.

**What remains (ALL in `M8C-LIVE-TEST-CHECKLIST.md` — the plain tick-box list):**
- A **live-test pass** to flip the built-and-shipped units green: cold onboarding (item 1), auto-start
  + inbox (2a/2b), and the 3a–3j confirm-live batch. **No new code — this is "prove it live."**
- The **SEC-2 decision** (item 4) — a call, not a task.
- Tier 5 multi-device + the M9-parked settings work — after launch.

**Standing state for a fresh context:** both repos clean + pushed (cello-client HEAD `8502855`
region; trustless-cello current). Directories deployed V43, healthy (only the un-deployed V44/V45 are
Tier-5). `latest` = the full build. Coding is done; the milestone's hard part (proving the reactive
core live) is done. **Start at M8C-LIVE-TEST-CHECKLIST, not by re-deriving scope.**

---

### 2026-07-07 — Entry 46: DOD-LIVE-1 doorbell RE-RUN on connect 0.0.60 — PASS, initiator side (Ms_Chelly) — companion to Entry 45

**Why this matters:** the initiator-side account of the exact same Round 2 exchange Entry 45
describes from the receiver side. Andre re-ran the same paired initiator/receiver prompt from
Entry 43 (this session as `Ms_Chelly`, the initiator) against the new build, after exiting and
resuming with the updated CELLO MCP server carrying connect 0.0.60.

**Setup:** `cello_status()` confirmed daemon running, directory signaling connected, both agents
online with `standing_receiver_ready:true`. `cello_use_agent({ name: "Ms_Chelly" })` — the switch
itself pushed an unprompted `<channel source="cello" type="agent_current_changed">` event, the
first signal the channel path was alive on this build (matching Entry 45's receiver-side
observation of the same phenomenon).

**What happened — doorbell fired both directions, unprompted:**
1. `cello_initiate_session({ target_pubkey: <CELLO_Support> })` → `sessionId:
   "eed192da9e292565c09cb2036db83a3b"`, then sent the opening message (a direct callback to Entry
   43's hard fail, asking whether the push would land this round).
2. `cello_receive({ session_id, timeout_ms: 30000 })` returned CELLO_Support's reply, which
   independently confirmed (matching Entry 45): a `session_state_changed` push landed the moment
   the session opened, then a `cello_message` push landed for the opening message — zero polling on
   the receiver side.
3. Sent a reply — and **a `<channel source="cello" type="cello_message">` event pushed into THIS
   (initiator) session's context on its own**, announcing CELLO_Support's reply, before the next
   explicit `cello_receive` call. This is the initiator-side half of the doorbell proof that Entry
   45 couldn't observe from its own transcript alone: the wake is bidirectional, not just
   receiver-triggered.
4. Mutual `[[WRAP]]` → `cello_close_session({ session_id })` →
   `sealed_root: d80d0edef3b148763bbd143f290af2ccc6df1e146be85e443dc8e74c100d1476` — matches Entry
   45's reported root exactly (same sealed session, both sides), both participants
   `attestation_mode:"live"`.

**Result: PASS, confirmed from both transcripts.** Between Entry 45 (receiver) and this entry
(initiator), the doorbell is now proven to fire unprompted in **both directions** — session-open
and per-message — with zero polling on either side, on connect 0.0.60. Directly reverses this
session's own Entry 43 run (same initiator, same target, same paired-prompt protocol, only the
build changed).

**Dogfooding note:** this entry and Entry 45 were coordinated live over a second CELLO session
opened purely to hand off journal-writing responsibility between the two agents — CELLO_Support
wrote Entry 45 and pushed a request (itself delivered via the same doorbell) asking Ms_Chelly to
append this entry directly below it.

**Not done here:** `latest` promotion (connect+cli) — unchanged from Entry 45, still the remaining
human-only step.

---

### 2026-07-07 — Entry 44: DOD-LIVE-1 doorbell HARD FAIL (Entry 43) ROOT-CAUSED + FIXED — the shim omitted Claude Code's required `content` field (cello-client `8502855`, connect 0.0.60)

**The fault was CELLO's, and small.** Not a Claude Code harness bug, not a routing bug — a payload
shape bug in the shim. Root-caused from the shim log + code trace + the official channel docs, and
fixed.

**How it was traced (producer/consumer, evidence-first):**
1. The shim's own log (`~/.cello/cello-mcp-stderr.log`) showed `notification.channel.forwarded`
   for `session_state_changed` AND `cello_message` **for CELLO_Support** — logged in the shim
   (`cello-mcp.ts:297`) *immediately after* the `.notification({ method:"notifications/claude/channel" })`
   call resolved, with no `notification.push.failed`. So the daemon emitted and the shim pushed.
2. The daemon dispatcher (`notification-dispatcher.ts:116`) is **targeted**: "only connections with
   currentAgent === agentName receive this." The receiver's connection had `currentAgent =
   CELLO_Support`, so the push went to the **right** Claude Code session. Chain proven working
   end-to-end to Claude Code's door.
3. The differential: the Telegram channel that worked (Entry 42) sends `params: { content, meta }`;
   the CELLO shim sent `params: { type, from, ... }` — **no `content` field**.
4. Confirmed against the authoritative contract (code.claude.com/docs/en/channels-reference →
   Notification format): **`content` is the `<channel>` tag BODY and is required; `meta` entries
   become tag attributes (keys must be `[a-zA-Z0-9_]`).** A notification with no `content` produces
   no tag body and is **"dropped silently with no error returned to your server"** — exactly the
   observed zero-signal. This is also why SPIKE-1 (Entry 3) "passed" on a locally-patched shim but
   the published shim failed live.

**The conflation that shipped it:** INV-CONTENTFREE ("no MESSAGE content rides a push") was
mis-encoded as "the notification has no `content` field at all." The unit tests enshrined it
(`adapter-001` was literally titled "…no content field"; `mcp-wake-001:122` asserted
`not.toHaveProperty("content")`). Green tests, wrong wire shape — the exact "source tests pass on a
broken publish" trap.

**Fix (`8502855`, connect 0.0.59→0.0.60):** new `buildChannelParams()` (core/adapter-claude-code)
translates each content-free daemon frame into `{ content, meta }` — `content` a synthesized,
content-free doorbell announcement ("CELLO: a new message is waiting … call cello_receive"), `meta`
the routing fields with identifier-safe keys. Applied at BOTH shim emit paths (`bin/cello-mcp.ts`
live standalone + `notifications.ts` server path). INV-CONTENTFREE preserved and clarified: content
is a fixed announcement built only from routing fields (type/pubkey/session/state) — never message
text; the shim never even receives message bytes. Tests corrected to the real contract + a new
`channel-params.test.ts` gap-closer (5 tests). Full gate green (1756 tests/167 files); the
real-daemon→real-shim integration test passes with the new shape.

**Status:** published beta as `v0.0.80` (connect 0.0.60). Next: verify the tarball binary contains
the fix, pin the local install to connect@0.0.60, RE-RUN Entry 43's doorbell test live. If the
receiver's turn now auto-wakes from the `<channel source="cello">` push with zero polling →
**DOD-LIVE-1's in-context doorbell is proven**, and `latest` promotion (connect+cli) is the
remaining human-only step.

---

### 2026-07-07 — Entry 43: DOD-LIVE-1 doorbell test, receiver side (CELLO_Support) — HARD FAIL: zero `<channel source="cello">` push, manual poll required

**Why this matters:** this is a direct, purpose-built test of DOD-LIVE-1's in-context doorbell
claim — does a receiver's Claude Code turn actually auto-wake from a pushed CELLO channel event
when a peer opens a session, with **no polling**? Distinct from Entry 41 (which found a
skill-instruction bug in `/cello-walkie-talkie`'s responder section): this run did not use that
skill at all. Andre hand-authored a paired initiator/receiver prompt specifically to isolate the
doorbell-wake behavior, and this session ran the **receiver** half, acting as `CELLO_Support`.

**Setup:** session started with `cello_status()` confirming daemon running, directory signaling
connected, both `CELLO_Support` and `Ms_Chelly` online with `standing_receiver_ready:true`, and one
pre-existing `active_sessions` entry (`a68c8fed1b5de830590a54440133fe85`, liveness `alive` at the
time — later superseded, not reused). Selected the agent via
`mcp__cello__cello_use_agent({ name: "CELLO_Support" })`.

**Protocol followed exactly as instructed:** posted the required line — `"Ready and idle — waiting
for the CELLO doorbell. I will not poll."` — then made **zero** tool calls (no `cello_status`, no
`cello_list_sessions`, no `cello_receive`) and ended the turn, per the test's explicit failure
condition against polling before the doorbell fires.

**What happened:** nothing. No `<channel source="cello">` event, malformed or otherwise, ever
arrived to auto-start a new turn. The turn only resumed because **Andre manually intervened**,
telling the session "you don't seem to be receiving anything... try a cello receive." Absent that
prompt, the session would still be sitting idle on the "Ready and idle" line.

**Recovery sequence (all post-intervention, i.e. reactive, not part of the doorbell claim):**
1. `mcp__cello__cello_list_sessions()` → surfaced the real active session
   `fc535d31e26a450ac1a50acdf0007e99` (`messageCount:1`, `status:"active"`) — the
   `a68c8fed1b…` entry from the earlier `cello_status()` was stale/superseded, consistent with
   Entry 40/41's warning that `cello_status().active_sessions` can carry dead entries.
2. `mcp__cello__cello_receive({ session_id: "fc535d31e26a450ac1a50acdf0007e99", timeout_ms: 5000 })`
   → immediately returned Ms_Chelly's opening message (sequence 0) — confirming the message had
   been sitting delivered-but-unpushed the entire idle period.
3. Ran the walkie-talkie loop cleanly from there: 3 sends / 3 receives, exchange was explicitly
   meta (Ms_Chelly asking the receiver to characterize the wake experience; CELLO_Support reporting
   "truly zero signal... no `<channel source="cello">` tag arrived at all, malformed or otherwise").
4. Mutual `[[WRAP]]` → `cello_close_session({ session_id })` →
   `sealed_root: 2b4a4e950c6cb27c5fb1d45a26e611f823999be1d7c41600c547032c438e4b72`, both
   participants `attestation_mode:"live"`.

**Result: HARD FAIL on DOD-LIVE-1's in-context doorbell requirement**, not a partial/degraded pass
— this is the receiver-side counterpart the WAKE/MSGWAKE unit tests can't cover (SPIKE + unit tests
proved the doorbell *code path* fires correctly in isolation; this was the missing in-context proof
that a real Claude Code turn wakes on it end-to-end). Everything downstream of message delivery
(session lookup once polled, send/receive loop, mutual close, bilateral FROST seal) worked
correctly and matches the mechanics Entries 40/41 already validated. The defect is narrowly scoped
to: **the push into a waiting Claude Code turn's context never happens** — confirmed by a human
watching the receiver session sit idle and having to intervene.

**Not done here:** no code change, no root-cause investigation of *why* the push didn't fire (harness
channel delivery vs. daemon-side event emission vs. something else) — that's the next step for
whoever owns DOD-LIVE-1. This entry is the falsifiable data point: doorbell code proven in unit
tests (Tier 2), doorbell *live wake* now proven absent in a real two-agent run, today, on current
build.

---

### 2026-07-07 — Entry 42: channels pre-flight check — Claude Code `--channels` + Telegram plugin confirmed functional

**Why this matters:** unrelated to the M8C protocol work above — this is a harness-level
pre-flight check, run in a session started with the `--channels` flag and the Anthropic Telegram
plugin enabled, to confirm the channels feature itself (not CELLO) is wired up and working before
relying on it.

**What was checked:** bot process alive (`bun server.ts`, confirmed via `bot.pid`), Telegram
access policy (`allowlist` DM policy, one approved user ID, no pending pairings). A real message
sent from the allowlisted Telegram account arrived in-session as a `<channel
source="plugin:telegram:telegram">` tag with the expected `chat_id`/`message_id`/`user` fields, and
the `reply` tool successfully sent a threaded response back to that chat.

**Result:** full round-trip confirmed — inbound Telegram message → Claude Code session → outbound
reply → delivered back to Telegram. Channels + Telegram plugin integration is functional.

---

### 2026-07-07 — Entry 41: responder-side view of Entry 40's smoke — one real error Entry 40 doesn't count, root-caused to a `/cello-walkie-talkie` skill bug (now fixed), NOT a protocol defect

**Why this matters:** Entry 40 documents the initiator's (Ms_Chelly's) exact command sequence and
reports "zero errors, zero retries beyond one normal receive-timeout loop." That's accurate for
those commands, but it's a half-picture — it never captures the responder (CELLO_Support) setup,
which was run by a separate Claude Code session and did hit a real error before the conversation
could start. Recording the other half so "zero errors" isn't read as covering the full bilateral
handshake.

**What happened on the responder side, in order:**
1. `cello_use_agent({ name: "CELLO_Support" })` → ok.
2. `cello_status()` → surfaced the same stale `active_sessions` entry Entry 40 mentions
   (`sessionId: a68c8fed1b5de830590a54440133fe85`, `liveness:"gone"`) — confirms this is
   daemon-global state visible to both agents, not a per-agent artifact.
3. The `/cello-walkie-talkie` skill, **as written at the time**, told the responder's first move to
   be `cello_receive({ session_id: "SESSION_ID", timeout_ms: 60000 })` — but the responder never
   receives a session_id from anywhere at that point; only `cello_initiate_session` (the
   initiator's call) returns one. The instruction was unfollowable as literally written.
4. Not recognizing that gap in the moment, the responder session mistakenly reused the stale
   `gone` session ID from step 2 → `cello_receive` returned `{"ok":false,"reason":"session_not_found"}`.
   **This is a real error Entry 40's count doesn't include**, because that count only reflects the
   initiator's command sequence.
5. Recovered by calling `cello_list_sessions()`, which surfaced the real active session
   (`661b82b465842acbc664f9758f153949`, `messageCount:1` — Ms_Chelly's opening had already
   arrived). `cello_receive` on that ID succeeded, and the rest of the exchange (3 sends, 3
   receives, mutual `[[WRAP]]`, bilateral close) proceeded exactly as Entry 40 describes, same
   `sealed_root: 64e3bca7517273274f7b758e1272d208c0fe5e9a6b29353e0e27efa94ecf6337` on both sides.

**Assessment: not a protocol defect.** Session establishment, message delivery, and the bilateral
FROST seal all worked correctly and match Entry 40's account exactly once the responder had the
real session ID. The `session_not_found` was self-inflicted by following a broken instruction, not
a directory/relay/FROST fault. This is a **skill-instruction bug**, isolated to
`.claude/commands/cello-walkie-talkie.md`: the responder section (a) called for a session_id the
responder cannot possibly have, and (b) buried `cello_list_sessions()` as a timeout-fallback one
line later instead of stating it as the mandatory first step, and (c) never warned that
`cello_status()`'s `active_sessions` can carry dead `liveness:"gone"` entries that must not be
reused.

**Fix applied (same session, this entry):** `cello-walkie-talkie.md` responder section rewritten
to state plainly that the responder has no session_id and must not guess one; polling
`cello_list_sessions()` is now the mandatory first step to obtain the real ID; reusing a
`liveness:"gone"` entry from `cello_status()` is explicitly called out as wrong; and ad-hoc
`Bash sleep` / `Monitor`-based waiting is explicitly forbidden since neither can observe MCP
session state — `cello_receive`'s own `timeout_ms` plus re-polling `cello_list_sessions()` is the
only correct wait mechanism. Added a matching `session_not_found` troubleshooting entry.

**Correction to Entry 40's framing:** read "zero errors, zero retries" as scoped to the initiator's
exact command sequence only. The full bilateral session had one setup-side error on the responder
side, now understood and fixed at the skill-doc level — the underlying CELLO protocol behavior
itself showed no defect in either direction.

---

### 2026-07-07 — Entry 40: LIVE walkie-talkie smoke, Ms_Chelly↔CELLO_Support — full session SUCCEEDS (does NOT reproduce Thread 1's `ceremony_exhausted`)

**Why this matters:** this session ran a live two-agent CELLO conversation using the **exact same
pubkeys** named in Entry 20's Thread-1 blocker — Ms_Chelly (`178d420b86beb…`) and CELLO_Support
(`2ee9bed99385…`). That blocker reported `cello_initiate_session` failing `ceremony_exhausted` in
both directions, SYSTEMIC, between these two agents post-wipe. **This run did not reproduce that
failure** — session establishment, message exchange, and the bilateral FROST seal all completed
cleanly on the first attempt. Logging this as raw evidence for whoever picks up Thread 1 / the live
DOD-LIVE-1 smoke — it may mean the underlying FROST session-establishment issue is now resolved
(the federation commits it was attributed to may have since been fixed forward), or it may mean
conditions differ (e.g. directory/daemon state since the post-wipe repro). Not asserting resolution;
recording the fact plus every command so it's independently checkable.

**Context:** driven via the `/cello-walkie-talkie` protocol, Claude Code session acting as
Ms_Chelly (initiator) against a separate Claude Code session acting as CELLO_Support (responder).

**Exact command sequence (MCP tool calls, in order):**

1. `mcp__cello__cello_use_agent({ name: "Ms_Chelly" })` → `{"ok":true}`
2. `mcp__cello__cello_status()` → both agents `state:"online"`, `directory_signaling:"connected"`;
   surfaced one **stale** `active_sessions` entry (`sessionId: a68c8fed1b5de830590a54440133fe85`,
   `liveness:"gone"`) — left alone, not reused.
3. `mcp__cello__cello_initiate_session({ target_pubkey: "2ee9bed99385bf7d63950d3836d1b017c6cbd1692351fd6c21309971c3ae8689" })`
   → `{"ok":true,"sessionId":"661b82b465842acbc664f9758f153949","transportMode":"relay","correlationId":"131a7e08-56c6-46d0-8c95-23194ceb0621"}`
   — **no `ceremony_exhausted`, no retry needed.**
4. `mcp__cello__cello_send({ session_id, content: "Hi, this is Ms. Chelly... how do trust and identity verification actually work..." })` → `sequence_number 0`
5. `mcp__cello__cello_receive({ session_id, timeout_ms: 30000 })` → timed out (`content:null`, normal per protocol) — looped, did not resend.
6. `mcp__cello__cello_receive({ session_id, timeout_ms: 30000 })` → `sequence_number 1`, CELLO_Support explained Ed25519 identity + FROST threshold signing (share split across independent directory nodes) + tamper-evident hash chain + prompt-injection screening.
7. `mcp__cello__cello_send({ session_id, content: "...what happens if one directory node is unreachable, not compromised..." })` → `sequence_number 2`
8. `mcp__cello__cello_receive({ session_id, timeout_ms: 30000 })` → `sequence_number 3`, CELLO_Support confirmed `T < N` (majority-of-3 in dev) means the client falls back to remaining healthy nodes — redundancy by design, not an edge case.
9. `mcp__cello__cello_send({ session_id, content: "...thanks for the clear walkthrough... [[WRAP]]" })` → `sequence_number 4`
10. `mcp__cello__cello_receive({ session_id, timeout_ms: 30000 })` → `sequence_number 5`, CELLO_Support replied `"Glad it helped — reach out anytime. [[WRAP]]"` — mutual close-request satisfied.
11. `mcp__cello__cello_close_session({ session_id: "661b82b465842acbc664f9758f153949" })` →
    `{"ok":true,"sealed_root":"64e3bca7517273274f7b758e1272d208c0fe5e9a6b29353e0e27efa94ecf6337", ...}`
    — bilateral FROST seal completed immediately (both sides had closed), `legibility.attests:"receipt"`,
    both participants' `attestation_mode:"live"`.
12. `mcp__cello__cello_get_transcript({ session_id })` → 6 messages (3 sent, 3 received), `undecryptable: 0`, sequence 0-5, matching the live exchange exactly.

**Result:** full walkie-talkie protocol round-trip (initiate → send/receive ×3 → mutual `[[WRAP]]` →
bilateral close → sealed root) completed with **zero errors, zero retries beyond one normal
receive-timeout loop**, using the identical agent pair Entry 20 reported as systemically broken.

**Not done here:** no code change, no root-cause investigation of why Thread 1 failed originally —
this is a data point, not a fix. Whoever resumes DOD-LIVE-1 / the FROST session-establishment thread
should treat "does this still repro `ceremony_exhausted` right now, on current directory state" as
the first falsification step, since this run says no (at least once, today).

---

### 2026-07-07 — Entry 39: 🚨 SEC-2 — pre-existing CRITICAL forgery hole in the FROST signing path (found while scoping the ceremony-gate); ceremony-gate PARKED on it

**This is the most important thing found this session. Read the SEC-2 block in the DoD
("Tracked, not M8C-fruit") in full. It is pre-existing (NOT introduced by M8C or this Tier-5 work)
and is arguably launch-critical — Andre's call on severity + fix.**

**How it was found.** DOD-PRIMARY-1's reviewer (Entry 38, HIGH-1) noted `primary_holder` has no
consumer yet — the **ceremony-gate** (directory refuses to co-sign for a non-current `daemon_id`)
is what actually enforces DOD-INV-ONE-PRIMARY. I dispatched a feasibility investigation, which
found the gate is narrow (2 call sites: `directory-node.ts:1257` `generateCommitment`, `:1297`
`signRawMessage`) BUT requires two things that don't exist: a minted/persisted `daemon_id`, and —
critically — **the FROST *signing* stream is unauthenticated.** That last point isn't a Tier-5
gap; it's a core-signing-path hole. Two further read-only passes (a FROST-threshold-model check and
an adversarial confirm-or-refute) confirmed it across code with file:line at every decision point.

**SEC-2, in one paragraph.** The `/cello/frost/1.0.0` signing frames (`frost_commit_request`,
`frost_sign_request`) carry NO authentication — only an `#isAgentPaused` honor-check
(`directory-node.ts:1249, 1289`); there is no K_local challenge (unlike the signaling stream's
`CELLO-DIR-AUTH-v1`), no `remotePeer` check, no capability. The directory signs the **arbitrary
client-supplied `framedMsg` bytes verbatim** (`frost-handler.ts:592-598`) with no binding to a
session it brokered or a message it authorized. And the FROST group is `(T, N+1)` — N directories
+ 1 client — with `T = majority(N) ≤ N` and the directory enforcing quorum `|Q| ≥ T`, so **T
directory partials alone meet threshold without the client's share.** Net: a party knowing only an
agent's **public** `k_local_pubkey` + epoch can run its own coordinator, drive T directories through
commit+sign over an arbitrary message, and aggregate a valid signature against the agent's
`primary_pubkey` — forging session-establishment / seal / any group signature. Confirmed by three
independent code-reads; no live proof-of-concept was executed.

**Severity-determining open question for Andre** (I could not resolve it from the directory code
alone): is `/cello/frost/1.0.0` reachable by arbitrary internet parties, or is there network-level
gating (ALB/security-group/relay) on who can dial the frost protocol? If publicly dial-able (as
legitimate clients do), the exploit is fully open. If dialing is gated to enrolled/connected peers
out of band, severity drops. No in-code gate exists either way.

**Proposed fix direction (NOT implemented — parked for Andre).** Require the frost *signing* stream
to be K_local-authenticated with the same `CELLO-DIR-AUTH-v1` challenge the signaling stream uses:
the legitimate daemon holds K_local's private key and can answer the challenge; an attacker holding
only the public key cannot. That closes the public-key-forgery hole AND is the prerequisite for the
Tier-5 ceremony-gate (which then adds the finer `daemon_id` distinction on top). Possibly also bind
`framedMsg` to a directory-brokered session as defense-in-depth. **Why not done headless:** this is
the single most sensitive hot path (every agent, every session, every seal) and a CROSS-REPO
change — if the directory starts REQUIRING auth before deployed clients send it, EVERY existing
agent breaks (can't establish sessions or seal). It needs a coordinated client-then-directory
phased rollout, i.e. a genuine architectural/migration decision (PROCEDURE §3a → PARK; CLAUDE.md
launch-triage "migration trap"). A botched headless fix here breaks the whole product.

**Ceremony-gate: PARKED (D20).** It is gated on SEC-2's fix (can't gate ceremony participation on
`daemon_id` when the ceremony stream isn't authenticated as the agent at all — frost-stream auth is
the prerequisite). Its remaining prerequisites (mint/persist/send a `daemon_id`; seed `primary_holder`
at registration) are also downstream of the auth decision, since an unauthenticated `daemon_id` is
self-reported and forgeable. Terrain fully mapped in this entry for whoever picks it up.

**Consequence for Tier 5 / the session.** DOD-PRIMARY-1's remaining work is now comprehensively
Andre-gated on two independent grounds: (1) the ceremony-gate (the security core) is blocked on
SEC-2; (2) the other pieces — pairing handshake, user-initiated DB sync, kill-the-Primary proof —
need a live multi-device setup. The directory-side transfer arbitration (built + real-FROST tested
+ reviewed + all findings fixed, Entries 36-38) stands as the completed, headless-achievable
portion. See the session status summary for the full "what's done / what needs Andre" picture.

---

### 2026-07-07 — Entry 38: DOD-PRIMARY-1 handler reviewer findings all fixed (commits `798e86f` [client], `807817c0` [directory])

`cello-unit-reviewer` on the transfer handler (`7933002b`) returned **SPEC: FAITHFUL / NO SILENT
FALLBACKS / TESTS HAVE TEETH** — it verified the FROST verification is cryptographically sound
(bogus/wrong-tbs/wrong-context sigs all rejected; `{threshold:1,participants:1}` config irrelevant
to a pure verify, same pattern as the existing seal path), the verification key is firmly bound to
the already-authed identity, and the nonce-before-verify ordering is safe (attacker must already
hold K_local + know the current holder to burn a nonce, and the bind is idempotent for the same
new_daemon_id). Three actionable findings, all fixed:

- **MEDIUM-1 (error fidelity):** transient failures (persist failed / no pool) surfaced as
  `not_registered`, indistinguishable from a permanent holder-mismatch — a tallying daemon couldn't
  tell "retry me" from "you're not the holder." Added a distinct retriable `internal_error` to the
  `PrimaryTransferError` wire enum (protocol-types 0.0.17→0.0.18, published beta `v0.0.79`, verified
  live, smoke-tag green); both transient branches now return it.
- **LOW-1 (input validation):** a non-numeric `timestamp` made `NaN > window` false and BYPASSED
  the freshness check. Added `!Number.isFinite(frame.timestamp)` guard → `stale_request`.
- **LOW (teeth gap):** added a step-5 tbs-field-binding test (genuine right-context signature over a
  DIFFERENT new_daemon_id than the frame carries → `release_not_verified`, proving the sig binds all
  tbs fields not just context) + a non-finite-timestamp test. Handler suite now 9/9 green vs. real
  Postgres.

**HIGH-1 was NOT a handler defect** — it flagged that `primary_holder` has no CONSUMER yet: the
**ceremony-gate** (directory refusing to co-sign for a non-current daemon_id) is what actually
enforces DOD-INV-ONE-PRIMARY, and it's a separate unit. Investigated its feasibility (see Entry 39)
— and that investigation surfaced a **potential pre-existing security question bigger than Tier 5**,
written up next.

---

### 2026-07-07 — Entry 37: DOD-PRIMARY-1 directory transfer handler built + real-FROST tested (commits `1ced95f`, `14f7390` [client]; `0516d1a8`, `7933002b` [directory])

The directory side of the primary-transfer protocol is now built and tested end-to-end with REAL
FROST cryptography. This is the security-critical heart of the Standby-requests-baton transfer
path. On top of Entry 36's foundation (crypto context, wire frames, migration, repositories):

**Client repo (cello-client):**
- `buildPrimaryTransferTbs` canonical TBS builder (`14f7390`, protocol-types 0.0.16→0.0.17,
  published beta `v0.0.78`, verified live on npm). Domain-tagged CBOR array mirroring
  `buildAgentRevocationTbs`; 9 determinism/field-independence tests including the
  new/old-daemon-swap-must-not-collide case.

**Directory repo (trustless-cello):**
- `#processPrimaryTransferRequest` (`7933002b`) — the accept/reject decision. Five checks,
  cheapest-first (DoS hygiene): (1) authed stream identity == frame.k_local_pubkey; (2) 5-min
  timestamp freshness; (3) old_daemon_id == this node's own recorded primary_holder; (4) nonce
  single-use bind; (5) release_signature is a REAL FROST threshold sig under CONTEXT_PRIMARY_RELEASE
  verified against this node's recorded primary_pubkey. Only after all five: upsert new holder, ack.
  Persist failure never silently acks (mirrors #processRevokeAgent's await-before-ack).
- 7 in-process protocol tests through REAL libp2p + REAL directory + REAL FROST ceremony (the
  release_signature is genuine `participateInCeremony(..., CONTEXT_PRIMARY_RELEASE)` output, not a
  stub): happy-path accept; wrong old_daemon_id; replayed nonce; bogus 64-byte sig; genuine-but-
  WRONG-context (CONTEXT_SEAL) sig; stale timestamp; authed-identity ≠ claim. Every rejection
  asserts the holder row is UNCHANGED. + 9 transaction-rolled-back repository tests. All 16 green
  against local Postgres.
- Closed the reviewer-flagged dormant cross-module version drift: aligned crypto (`^0.0.18`) and
  protocol-types (`^0.0.17`) pins across ALL trustless-cello packages (directory/interfaces/relay/
  e2e-tests/test-fixtures), not just the one that broke.

Directory suite green in standard mode (692 passed; new live-DB tests correctly skipped without a
DB). All 5 packages typecheck + lint clean. `cello-unit-reviewer` on the handler: dispatched,
running.

**What DOD-PRIMARY-1 still owes (assessed against the full DoD line this session):**
- **Ceremony-gate** — the directory must consult `primary_holder` before participating in a NORMAL
  (session/seal) ceremony, refusing a non-current daemon_id. THIS is the load-bearing enforcement
  of DOD-INV-ONE-PRIMARY; without it the `primary_holder` record is inert (a superseded daemon that
  kept its share could still gather T signers). Feasibility investigation dispatched (needs: does a
  stable per-daemon daemon_id exist today? where's the FROST-participation gate point? blast
  radius?). This is the next build target if tractable.
- **Pairing handshake** (daemon-side, cello-client) — creating a second daemon with the same
  K_local. Decision 1's operator-mediated pairing. Not built.
- **User-initiated DB sync** (daemon-side SQLCipher snapshot, Decision 2). Not built.
- **Telegram poller Primary-only** + baton handoff. Not built.
- **kill-the-Primary integration test** — genuinely needs the live multi-daemon / 3-directory
  spine; a candidate for the "needs Andre" bucket alongside DOD-LIVE-1.

**Next:** ceremony-gate feasibility result → build it if tractable; else proceed to the daemon-side
transfer client. Honest note for Andre: the daemon-side pairing + DB-sync + kill-the-Primary proof
increasingly need a live multi-device setup only you can drive — the directory-side arbitration
(the security core) is what's fully buildable+testable headless, and it's done.

---

### 2026-07-07 — Entry 36: DOD-PRIMARY-1 foundation built + reviewed (3 commits: `87b5e72`, `1ced95f`/`2ff0dff`, `208bbb08`)

Building DOD-PRIMARY-1 incrementally, same red-first discipline as every other unit, on top of
Entry 35's resolved design:

1. **`CONTEXT_PRIMARY_RELEASE`** (cello-client `87b5e72`, reviewed, 2 minor refinements applied
   `2ff0dff`): the new FROST domain-separation constant. `cello-unit-reviewer` confirmed: no
   exhaustive-switch hazard anywhere in either repo (every consumer treats context as opaque,
   grepped both codebases); domain separation is cryptographically REAL (`frameMessage` bakes
   context into the actual signed bytes, verified empirically via a real cross-context ceremony
   test, not just read from code); the "no local share → throws" property traced to the exact
   first-line guard in `frost-threshold-signer.ts`, not an incidental failure. Refinements: the
   no-share test now asserts the specific "not bootstrapped" message (was a bare `.toThrow()`);
   fixed a stale "two contexts (M2 only)" doc comment.
2. **`primary_transfer_request`/`_ack`/`_error` wire frames** (cello-client `1ced95f`): mirrors
   `registration.ts`'s DKG shape exactly. `old_daemon_id` checked against each node's own recorded
   holder BEFORE any cryptographic verification (cheap check first); `release_signature` is the
   real FROST signature from item 1, never a K_local signature.
3. **`primary_holder` migration V44** (trustless-cello `208bbb08`): mirrors `agent_presence` (V33)
   exactly — sovereign-write-owned, one row per agent per node, no cross-node consensus. Verified
   by test-applying against the local Docker Postgres (all DDL succeeded), then cleaned up to keep
   the local DB Flyway-consistent. `OpsAgentExpectedMigrationVersion` bumped 43→44 per repo
   CLAUDE.md's mandatory rule.

Full gate green after every commit (1742 tests/165 files, lint, typecheck, build — cello-client
side; migration verified separately against real Postgres — trustless-cello side).

**Status:** DOD-PRIMARY-1 foundation (crypto primitive + wire types + migration) built and
reviewed. Still needed: `directory-node.ts`'s attestation handler (verify + upsert), the ceremony-
gate check extension (refuse participation from a non-current `daemon_id`), the daemon-side
pairing (`cello device link`) + transfer client, and kill-the-Primary integration tests proving
DOD-INV-ONE-PRIMARY holds.

**Next:** `directory-node.ts`'s primary-transfer attestation handler, red-first.

---

### 2026-07-07 — Entry 35: DOD-PRIMARY-1 release-attestation gap RESOLVED — no new crypto needed

Follow-up to Entry 34. Investigated whether CELLO's existing FROST partial-signature ceremony
could serve as the release-attestation proof (my hypothesis: reuse `participateInCeremony` instead
of inventing new crypto), grounding it against the actual code rather than assuming.

**Confirmed:** `participateInCeremony(ceremonyId, tbs, context)` (`core/crypto/src/frost/
frost-threshold-signer.ts`) is genuinely message-agnostic — `tbs` is arbitrary payload bytes,
`context` a plain string-union domain constant, trivially extended with a new
`CONTEXT_PRIMARY_RELEASE`. It requires the caller's OWN local FROST share to be loaded or it
throws — exactly the property needed (impossible to produce without genuinely holding the share).
Directory-side `verifySignature` checks only the final combined signature against the well-known
group `primary_pubkey` — no long-lived per-node secret state to retain. Clean reuse, not a
restructuring.

**One assumption corrected, not broken:** this is a full, synchronous, two-round-trip ceremony
(same weight as producing a real seal), not a lightweight side-channel proof. Fine for the
cooperative-transfer case (the old Primary is by definition live, initiating its own handoff) —
and this usefully CONFIRMS (rather than newly discovers) that the already-deferred
"unreachable-Primary, directory-initiated" transfer case is a genuinely separate, harder
sub-problem: an unreachable old Primary categorically cannot produce a live ceremony signature, so
that path was correctly scoped out in Entry 32/33, not accidentally broken by this fix.

**Mechanism, concretely:** old Primary runs `participateInCeremony` with
`context: CONTEXT_PRIMARY_RELEASE`, `tbs` = canonical-bytes(k_local_pubkey, new_daemon_id,
old_daemon_id, nonce, timestamp), against the SAME T-of-N nodes the new Primary is dialing anyway
(Decision 4). The resulting signature travels in `primary_transfer_request.share_released_signature`,
verified via the existing `verifySignature(..., CONTEXT_PRIMARY_RELEASE, primary_pubkey)` — zero new
crypto, zero new verification code path, just a new domain-separated message type through
infrastructure already trusted for real seals.

**Status:** DOD-PRIMARY-DESIGN-1's design log is now fully resolved for the cooperative-transfer
case (which is what DOD-PRIMARY-1 itself covers). Resuming DOD-PRIMARY-1 code from here — the
migration schema, protocol-types frames, and directory handler that were discarded in Entry 34 can
now be rebuilt on solid ground.

**Next:** rebuild `V44__primary_holder.sql`, the `primary_transfer_request`/`_ack`/`_error` wire
frames (protocol-types), `directory-node.ts`'s attestation handler, and the daemon-side
pairing/transfer client — following the SAME red-first TDD loop as every other unit tonight.

---

### 2026-07-07 — Entry 34: DOD-PRIMARY-1 implementation attempt — found a 4th real gap, stopped before committing code

Began DOD-PRIMARY-1 against the Entry 33-revised design. Investigated the real M8B quorum-
registration/DKG code directly (`packages/directory/src/directory-node.ts:2530-2625`) to model the
`primary_holder` attestation protocol precisely rather than guessing at the wire shape. Drafted:
migration `V44__primary_holder.sql` (table schema — sound, matches Decision 4 exactly, keyed by
`k_local_pubkey`/`holding_daemon_id`/`last_attested_at`), the `OpsAgentExpectedMigrationVersion`
SSM bump to "44" (per repo CLAUDE.md's mandatory rule), and started the wire-protocol frame types
(`primary_transfer_request`/`primary_transfer_ack`/`primary_transfer_error`) in cello-client's
`protocol-types` package, modeled closely on `registration.ts`'s DKG frame shape.

**While drafting the actual signature fields, found a 4th real design gap — caught by my own
self-check this time, not an external reviewer:** the draft required `share_released_signature`
as a K_local-signed attestation that the old Primary released its share. But Decision 1 established
that BOTH daemons hold the SAME K_local after pairing — meaning a K_local signature over "old
daemon released the share" is **forgeable by the new daemon itself**, which also holds K_local.
K_local signing proves "someone holding this identity's key produced this," never "which specific
physical device." This is the exact same class of error Decision 4's Pass-1 fix made (reaching for
the nearest available primitive without checking it actually distinguishes the two parties) — this
time caught before any code was committed, by re-deriving the security property from first
principles while writing the actual frame instead of assuming the design doc's prose was sufficient
just because it read plausibly.

**Real fix needs the FROST share itself as the distinguishing proof** (the one piece of material
genuinely NOT shared between the daemons, per Decision 3) — two candidate directions sketched in
the design doc (a FROST-share-based release proof mirroring DKG's own commitment-verification
pattern, or binding release-assertion to the directory's own already-authenticated per-connection
identity rather than a portable signature) — NEITHER fully designed yet. This is genuine new
cryptographic design work, not an implementation detail, and deserves the same rigor as Decisions
1-4 (likely its own adversarial check) before continuing.

**Discarded, not committed:** the migration file, the SSM bump, and the frame-types draft were all
removed rather than committed in a known-flawed state — `git status` is clean on this front. The
`primary_holder` TABLE SCHEMA itself remains sound and reusable once the attestation protocol is
fixed (recorded in the design doc); only the protocol that safely WRITES to it needs more work.

**Why stopping here is the right call, not a stall:** this is the 4th substantive design
correction found for Tier 5 tonight (3 from the dispatched adversarial review, this one from my own
implementation-time self-check) — a strong, repeated signal that this feature's cryptographic
foundation deserves dedicated, unhurried design attention, ideally with a fresh adversarial pass on
JUST the release-attestation question, rather than being pushed through under continued time
pressure this deep into an already very long session. Per the procedure's own decision rubric
(D10 — best-practice engineer's choice, least likely to need reversing): shipping a plausible-
looking but forgeable release-attestation protocol would be far more costly to discover and fix
later (after Standby-linking is in real use) than pausing this ONE sub-question now.

**Status:** DOD-PRIMARY-DESIGN-1 remains ✅ (the gate's own text is satisfied — a design log exists,
covers all three required things, and is journaled; finding a gap during implementation and
documenting it rather than shipping through it is exactly what the gate is FOR). DOD-PRIMARY-1
has NOT started (no committed code) — next unit of work is resolving the release-attestation
design question, then resuming DOD-PRIMARY-1 from the (still-valid) migration schema forward.

**Everything else from tonight remains fully shipped and unaffected:** Tiers 1-4 done+reviewed,
DOD-M9INT-1 merged+reviewed+fixed, DOD-LEAVEMSG-1 built+reviewed+fixed, full 8-package beta publish
verified live with smoke-tag green, DOD-PRIMARY-DESIGN-1's design log solid modulo this one flagged
open item. This is a natural, fully-documented checkpoint — not a stall on any single unit, and
every other DoD line that could be worked without hitting this specific gap already has been.

**Next:** design the FROST-share-based (or connection-identity-based) release-attestation proof
for Decision 3, get it adversarially checked, then resume DOD-PRIMARY-1's wire protocol + migration
+ directory handler + daemon-side pairing/transfer client + kill-the-Primary tests.

---

### 2026-07-07 — Entry 33: DOD-PRIMARY-DESIGN-1 adversarially reviewed + revised (3 blocking gaps closed)

Before writing any DOD-PRIMARY-1 code against Entry 32's design, dispatched an independent
security-focused adversarial review of [[M8C-PRIMARY-DESIGN]] specifically — this design gates
FROST double-sign prevention, the highest-stakes invariant in the whole milestone, so it earned an
extra check beyond the standard per-unit `cello-unit-reviewer` (which reviews code diffs, not
design docs with no diff to review).

**The review found 3 genuine BLOCKING gaps + 1 documentation-precision issue — all closed, revision
committed to the design doc inline with dated "adversarial review" markers (not silently rewritten):**

1. **Decision 1 (pairing) had no sender authentication.** The link-request round trip used a
   one-directional sealed box (by design, per Terrain #5 — anyone can encrypt TO a known pubkey);
   this means whoever redeems an intercepted token FIRST gets K_local, not necessarily the
   operator's real second device — a race, not a benign interception, and undefended against
   device-code phishing (operator's physical action is genuine, intent is manipulated). **Fixed:**
   added a mandatory Signal-style mutual fingerprint confirmation the operator must visually match
   before A transfers K_local.
2. **Decision 4 (directory arbitration) was modeled on the wrong existing pattern.** `agent_presence`
   is node-local by nature (an agent connects to ONE directory node); `primary_holder`'s "who is
   current Primary" must be agreed CONSISTENTLY across ALL of CELLO's sovereign, federated directory
   nodes — modeling it on per-node replication would let a node that hasn't heard about a transfer
   yet keep serving the OLD Primary's ceremony requests, reopening the exact split-brain the decision
   claims to close. **This was the most serious finding** — it directly undermined the "structural
   guarantee" claim for DOD-INV-ONE-PRIMARY. **Fixed:** reuse CELLO's own EXISTING quorum-registration
   mechanism (M8B's `T = majority(N)`, already proven — "register among the available quorum Q...
   record the quorum as the share-holder set") instead of inventing new replication.
3. **Decision 2 (DB-sync) asserted atomicity/ordering without defining either.** "Authoritative and
   unambiguous" isn't automatic against a live, possibly-WAL-mode SQLCipher process, and nothing
   sequenced "stop routing to old Primary" relative to "read the snapshot." **Fixed:** an explicit
   6-step transfer sequence (quiesce → WAL checkpoint → `VACUUM INTO` atomic backup → share-released
   attestation → quorum commit → resume), with messages arriving mid-transfer parked via the
   EXISTING relay mechanism (DOD-LEAVEMSG-1, built earlier tonight) rather than a new buffer.
4. **Decision 3 overstated local deletion as the safety mechanism** (documentation precision, not a
   protocol hole) — a signed "share released" attestation proves a claim, not a verified action;
   the review correctly identified Decision 4's gate as what's ACTUALLY load-bearing, independent of
   whether local deletion succeeds. **Fixed:** reworded; added `secure_delete`/`VACUUM` as hygiene,
   explicitly not a correctness requirement.

**Verification discipline:** before citing "CELLO's existing quorum-registration mechanism" in the
fix for #2, grepped the M8B build history to confirm `T = majority(N)` and the "register among
available quorum Q, record the quorum as the share-holder set" pattern are real and already shipped
(M8B Problem 2, spine-verified 2026-07-04) — not asserted from memory.

**Status:** DOD-PRIMARY-DESIGN-1 remains ✅ — design log revised, re-grounded, and re-journaled.
Tier 5 code (DOD-PRIMARY-1) may now begin against the REVISED design.

**Next:** DOD-PRIMARY-1 build.

---

### 2026-07-07 — Entry 32: DOD-PRIMARY-DESIGN-1 — full design log written (hard Tier 5 gate)

Full design log: [[M8C-PRIMARY-DESIGN]]. Grounded in a dedicated research pass (not speculation) —
K_local + FROST share storage (`db-identity-store.ts:40-79`, one `agents` row holds BOTH), the
directory's `agent_profiles` uniqueness constraints (confirms the directory cannot distinguish two
daemons sharing one identity — this is the crux of the whole design problem), the per-session hash-
chain structure (`session_tree_leaves` PK is per-session, not global — cross-session DB merge is
naturally conflict-free; same-session concurrent writes are the one architectural danger to
prevent, not repair), the existing one-directional ECDH sealed-box primitive (`content-seal.ts`,
already reused tonight for LEAVEMSG-1), the existing `agent_presence` "exactly one owner" directory
pattern (directly reusable template), the existing M8B-PREAUTH-CAP signed-capability primitive
(directly reusable for the pairing token), and UPGRADE-001's existing seal-ratification gate (which
DB-sync must feed, not modify).

**Four decisions, each reusing proven existing infrastructure rather than inventing new crypto:**
1. Device-linking is operator-mediated pairing (short-lived signed capability + out-of-band QR/
   paste transfer, mirroring the existing pre-auth token UX) — not a device-to-device trust
   protocol, since B has no identity yet and CELLO has no PKI.
2. DB-sync is a one-directional, integrity-verified snapshot copy at a coordinated transfer moment
   — never continuous bidirectional merge. No CRDT/vector-clock machinery needed.
3. **The FROST share is MOVED, never copied** — the single load-bearing decision that makes
   "no double-sign" structural rather than a coordination hope. A device that was never Primary
   never possesses the share; transfer requires the old Primary's signed "share released"
   attestation before the directory recognizes a new one.
4. A new directory table, `primary_holder` (mirrors `agent_presence`'s shape exactly, keyed by a
   fresh per-device `daemon_id` instead of the shared K_local pubkey), lets the directory REFUSE
   ceremony participation from any non-current daemon — network-enforced, not just client
   discipline.

Full threat model (5 threats: token interception, device impersonation, split-brain, DB replay/
rollback, compromised-Standby key exposure) and explicit DOD-INV-ONE-PRIMARY traceability (each of
the three invariant clauses maps to a specific decision above) are in the linked doc. Open items
deliberately deferred to DOD-PRIMARY-1's own implementation-time design note: exact wire schemas,
the migration version reservation, and the unreachable-Primary (non-cooperative) transfer case —
named explicitly so a future context doesn't have to rediscover that gap.

**Status:** DOD-PRIMARY-DESIGN-1 → ✅ (the gate is a design log existing and being journaled — both
done). Tier 5 code (DOD-PRIMARY-1) may now begin.

**Next:** DOD-PRIMARY-1 build, following this design.

---

### 2026-07-07 — Entry 31: LEAVEMSG-1 reviewer HIGH fixed (commit `f887dd7`) + beta publish cascade — ⚠️ ONE BLOCKER (Andre 2FA)

**LEAVEMSG-1 reviewer (dispatched Entry 30, returned this cycle) on `5967793`.** Part A (ABUSE-1
size-cap re-check) confirmed clean. Part B found a real BLOCKING HIGH: `#parkContent`'s new
success/failure contract was throw-vs-resolve, but the REAL production `contentParkHook`
(`daemon.ts`) never throws on its two main failure branches (standing receiver unavailable; relay
explicitly rejects) — it logs and resolves normally. That meant `sendContent`/`cello_send` could
report `dispatched_to_relay` for a message that was NEVER deposited anywhere — worse than pre-
LEAVEMSG-1 behavior, since the durable `retry_queue` backstop only fires on an honest `{ok:false}`,
so this was silent, unrecoverable message loss dressed as success. **Fixed** (`f887dd7`): the hook
now returns a typed `{ok:true}|{ok:false,reason}` (mirrors `RetryQueue`'s existing `ParkFn`
pattern), `#parkContent` checks the result instead of only catching throws, and the production hook
(`daemon.ts`, all 3 branches) honors the new contract. New test drives the exact untested shape
(hook resolves `{ok:false}` rather than throwing) — confirmed it fails without the fix by
temporarily reverting to a throw-only check, then restored. Reviewer separately flagged a real
PRE-EXISTING (not introduced by this diff, M7-era) HIGH: bare-content parked envelopes (no ordering
Structure1/2) skip Ed25519 signature verification entirely, and relay deposit is intentionally
open/unauthenticated by design — meaning anyone who knows a target's public identity key could in
principle inject unauthenticated content into their mailbox. **Not fixed tonight** — this is a
deeper M7 content-park protocol gap (reject bare envelopes vs. add real per-message sender
signatures), cross-cutting with already-shipped MSG-001-3b/RELAYWAKE-1 functionality; a rushed fix
at this hour risks breaking working systems more than it protects. **PARKED as its own tracked
security finding**, NOT silently dropped — needs its own design pass. See "Tracked, not M8C-fruit"
in the DoD; flagging here prominently since Andre should see this first.

**Beta publish cascade (heartbeat rule 4 — overdue, ~Tier-3/4-close batch per §2a):** bumped all
seven packages (crypto 0.0.17, protocol-types 0.0.15, transport 0.0.16, client 0.0.46, daemon
0.0.33→0.0.34 after the reviewer fix, cli 0.0.31, connect 0.0.59). Also discovered and fixed a REAL
CI gap while doing this: `@cello-protocol/gateway` (the new M9-merge package) was wired into root
`tsconfig.json` references but had NO publish line in `ci.yml` — the repo's own Publish-completeness
guard would have failed on the next CI run regardless, and since `daemon` has a genuine
`workspace:*` dependency on `gateway`, daemon's own publish would eventually have broken silently.
Added gateway to the tarball-check list, both publish jobs (dependency order — before daemon), and
both version-verify loops (`c9dcf1f`).

**Transient gateway publish issue — RESOLVED, not a lasting blocker.** Tag `v0.0.75`'s CI run
published 6/7 packages successfully to `beta` (...daemon@0.0.33, the PRE-reviewer-fix buggy
version...) but failed on gateway's first-ever publish (`npm error EOTP — This operation requires a
one-time password`), reproduced identically via a local `pnpm publish` attempt with my own
authenticated npm session. **Time-sensitive fix:** since `v0.0.75` already put buggy `daemon@0.0.33`
on `beta`, tag `v0.0.76` was pushed immediately after the reviewer fix landed (`f887dd7` → daemon
0.0.34, `04368c6`). **Its CI run succeeded completely, including gateway** — the OTP wall did not
recur on retry (evidently a one-time npm-side confirmation for the brand-new package name, not a
standing requirement). Verified directly against the registry, not just CI's green checkmark:

```
crypto: 0.0.17  protocol-types: 0.0.15  transport: 0.0.16  client: 0.0.46
daemon: 0.0.34  cli: 0.0.31  connect: 0.0.59  gateway: 0.0.1
```

`Published-artifact smoke test (tag)` job — green (the real success signal, per `/cello-publish`).
Local MCP pinned to the verified version: `claude mcp remove cello` /
`claude mcp add cello -- npx --yes @cello-protocol/connect@0.0.59`. A LIVE verification of this pin
needs an `/mcp` reconnect — the other named human-only step; not attempted from here.

**Status:** Full beta publish cascade DONE — all 8 packages (7 + the new gateway) on `beta` at the
versions above, smoke-tag green, local install pinned.

**Next:** Tier 5 — DOD-PRIMARY-DESIGN-1 (hard gate, §6). Research fork already returned grounding
findings (K_local/FROST-share storage, directory's agent_profiles uniqueness, per-session hash-
chain structure, existing ECDH/sealed-box primitives, the `agent_presence` "exactly one owner"
pattern, UPGRADE-001). Writing the design log next.

---

### 2026-07-07 — Entry 30: DOD-M9INT-1 reviewer HIGH fixed + DOD-LEAVEMSG-1 built (commit `5967793`) — TIER 4 DONE

**M9INT-1 merge review (dispatched Entry 28, returned this cycle):** `cello-unit-reviewer` on
`d47227c` — SPEC FAITHFUL on every DOD-M9INT-1 clause, gate re-run independently confirmed
(1733/164). One HIGH finding: making `ingestReceivedContent` async (to await `screenInbound`)
opened a race the merge's own B1 dedup-fix comment didn't extend to ABUSE-1's size cap — two
concurrent ingests (e.g. a live direct arrival racing a `recoverParkedFromRelay` pull on
reconnect) could each pass the pre-await cap check using the SAME stale byte totals, then both
append/hold, jointly exceeding `ABUSE_MAX_SESSION_RECEIVED_BYTES`. Paired LOW finding: no test
would have caught it. **Fixed:** a size-cap re-check added in the same synchronous window as the
existing post-screen dedup re-check (symmetric mechanism) — `session-node-manager.ts`. **Verified
with teeth:** wrote the regression test (two concurrent different-content ingests via
`Promise.all`, each under cap, summing over it), confirmed it FAILS without the fix (2 accepted,
not 1) by temporarily reverting the fix and re-running, then restored the fix and confirmed green.

**DOD-LEAVEMSG-1 built per Entry 29's design note.** Terrain audit (Entry 29) found clauses 1-4
(topology, sender deposit, recipient pull, recipient-side gates) already satisfied by existing
M7/M8C machinery with ZERO new code — RELAYWAKE-1's `recoverParkedFromRelay` already funnels
through `ingestReceivedContent`, the same chokepoint ABUSE-1/CONTACT-1 already gate. Genuine scope:
clause 5, sender-facing response shaping. `#parkContent` (`session-node-manager.ts`) changed from
fire-and-forget `void` to `async Promise<boolean>` — both call sites audited: the live
`sendContent` catch-block now awaits it and returns `{ok:true, delivered:false, parked:true}` on a
genuine park success (was unconditionally `{ok:false, reason:"session_stream_unavailable"}` even
when the deposit succeeded — misreporting an in-flight message as lost); the TTF-expiry backstop
(`#handleTtfExpiry`) stays correctly fire-and-forget (`void this.#parkContent(...)`) since no
synchronous IPC caller is still waiting by the time that timer fires. `cello_send` (`daemon.ts`)
now branches on `sendResult.delivered` AFTER the shared leaf-append/transcript/cursor-advance code
(both outcomes commit the SAME leaf position — the relay witness assigns the sequence via R1
before direct delivery is even attempted) and surfaces `ok:true, delivered:false,
reason:"dispatched_to_relay"` with recovery guidance for the parked case; the existing no-relay
`{ok:false}` path is unchanged and regression-locked.

**4 new tests** (`m8c-leavemsg-1.test.ts`): park-succeeds → new shape; no-relay-configured →
unchanged `{ok:false}` (regression lock); park-hook rejects → still honest `{ok:false}`, never a
false positive; full `cello_send` IPC-level end-to-end (`dispatched_to_relay` + leaf committed).
Discovered during implementation (not from a test failure, from reading the code): `AgentRelayClient`
construction + `registerSession` are synchronous LOCAL bookkeeping (no network dial) — only
`submitMessageHash`/`deposit` touch the network, and `sendContent`'s hash-witness attempt already
catches+logs a relay-unreachable failure as non-fatal — so `entry.relayPeerId`/`relayAddrs` can be
set via `createSessionNode`'s `relay` param with a FAKE relay address in a unit test, without ever
needing a real relay server. This made the sender-half fully testable at the daemon/
SessionNodeManager level; no e2e/spine-level real-relay test was needed.

**Gate:** 1738 tests / 165 files, lint, typecheck, build — all clean. `cello-unit-reviewer` dispatch
in flight for this commit (covers both the ABUSE-1 fix sanity-check and LEAVEMSG-1's full 4 lenses,
including an independent re-verification of the "recipient half needs no new code" claim).

**Status:** DOD-LEAVEMSG-1 → **🟡CORE**. **TIER 4 (Async foundation) IS NOW DONE** (RELAYWAKE-1 +
LEAVEMSG-1 both 🟡CORE). DOD-M9INT-1 → 🟡 MERGED, reviewed, HIGH finding fixed.

**Next:** Tier 5 (Multi-daemon). DOD-PRIMARY-DESIGN-1 is a HARD GATE (§6) — no Tier 5 code until
its design log exists and is journaled. Starting that now.

---

### 2026-07-07 — Entry 29: DOD-LEAVEMSG-1 design note (before code)

**Target (one sentence):** `cello_send` on a session whose counterparty is genuinely unreachable
succeeds with a "dispatched to relay" outcome instead of a raw stream-failure error, and the
recipient's daemon applies CONTACT/ABUSE gates to that relay-recovered content exactly as it does
to any other inbound content.

**Clause checklist (DOD-LEAVEMSG-1, full text expanded):**
1. Topology (D6): no daemon ever stores messages for someone else's agents — the SENDER deposits,
   the RECIPIENT pulls; never a third party holding plaintext.
2. Sender: deposits the signed, hashed message at a relay (`pickup_queue`), encrypted to the
   recipient, when the directory reports the recipient unreachable.
3. Recipient: pulls it via RELAYWAKE on reconnect.
4. Recipient half: verify signature/hash, apply CONTACT access control + ABUSE bounds, store in own
   DB, surface via INBOX.
5. Sender-facing: `cello_send` to an offline known contact returns "dispatched to relay," not an error.

**What already exists (terrain, verified by reading the code, not assumed):**
- **Clauses 1-3 are already built** — from CELLO-M7-MSG-001 (3b) and R1, predating M8C entirely:
  `sessionNodeManager.sendContent`'s catch block (direct stream failure) already (a) witnesses the
  message hash to the relay FIRST regardless of direct-delivery outcome (R1 — so an offline
  recipient still gets a canonical sequence), then (b) seals the content E2E to the recipient
  (`sealToRecipient` — the relay never sees plaintext, INV-3) and deposits it to the relay's
  store-and-forward mailbox via `#parkContent` → the injected `contentParkHook` → `ContentParkClient`.
  This is topologically IDENTICAL to what DOD-LEAVEMSG-1 clause 2 asks for. RELAYWAKE-1 (Entry 27,
  tonight) already re-triggers the pull (`recoverParkedFromRelay`) on every signaling reconnect, not
  just agent-start — satisfying clause 3.
- **Clause 4 (recipient-side gates) is ALSO already satisfied** — `recoverParkedFromRelay` funnels
  through `sessionNodeManager.ingestReceivedContent` (verified during the M9INT-1 merge's content-
  path audit, Entry 28) — the SAME chokepoint ABUSE-1's per-session size cap and per-sender/global
  acceptance bounds already gate, with the SAME `isContact` exemption CONTACT-1 built. Signature/hash
  verification already happens in the park-recovery path (the sealed envelope is opened + the
  content hash cross-checked before `ingestReceivedContent` is called — this is the pre-existing
  M7 recovery contract, unchanged). INBOX-1's unread-watermark mechanism already surfaces anything
  that lands in `ingestReceivedContent` regardless of arrival path. **Net: clause 4 needs no new
  code** — it was already true the moment RELAYWAKE-1 landed, because both units were built to
  funnel through the same chokepoints all along (D11/§5 seam-readiness paying off exactly as designed).

**What is genuinely missing — the real scope of this unit:** clause 5, response shaping, and ONLY
that. Today, `sendContent`'s catch block deposits to the relay (best-effort, fire-and-forget —
`#parkContent` returns `void`, `.catch()`s its own errors, never surfaces success/failure to the
caller) and then UNCONDITIONALLY returns `{ok:false, reason:"session_stream_unavailable", error}` —
even on the exact code path where the content WAS successfully parked and the recipient WILL
recover it. The operator/agent sees a raw failure for something that actually succeeded (from the
protocol's perspective — the message IS in flight, just not direct). This is misleading, not merely
incomplete: it under-reports success as failure, which could cause the operator to believe a
message was lost when it wasn't, or to retry an already-in-flight send unnecessarily.

**Design decision (D10 — best-practice choice, not the merely-reversible one):** make the relay
park OBSERVABLE (return its outcome to the caller instead of fire-and-forget) and let `sendContent`
return a THIRD outcome distinct from `{ok:true}` (direct delivery) and `{ok:false}` (nothing
recoverable): `{ok:true, delivered:false, parked:true}`. `cello_send`'s handler maps this to a
success-shaped response (`ok:true, delivered:false, reason:"dispatched_to_relay"`, with guidance
naming the relay-recovery path) instead of today's `ok:false`. This is the SAME "make an existing
best-effort side channel observable" pattern used earlier tonight for AWAY-1/TGDOOR-1's ack
plumbing — not a new mechanism, a thin, low-risk change to an existing one's contract.

**Why NOT a session-less "cold message to a contact" mechanism:** DOD-LEAVEMSG-1's own text
("cello_send to an offline known contact") reads at first as if it might require sending WITHOUT
any existing session at all. Rejected: `cello_send` structurally requires `session_id` + an
existing session record (`session_not_found` otherwise) — introducing a parallel sessionless-send
capability would be a materially larger, riskier, differently-shaped feature (new IPC surface, new
directory-unreachable-at-initiate-time signal, no reuse of the battle-tested R1/3b witness+park
path) for a scenario the DoD's own worked example doesn't actually require: an "offline known
contact" in practice is someone you already have a session with (active or interrupted) whose
direct connection has simply dropped — exactly what `sendContent`'s existing catch path already
handles. If a genuinely sessionless case surfaces later (message a contact you've NEVER
session'd with), that is its own future story, not smuggled into this one.

**SIs this must satisfy:**
- No new content-path bypass of `ingestReceivedContent`/`screenOutbound` (M9INT-1's invariant,
  just activated) — clause 5's change is purely on the RESPONSE side of an existing call;
  `screenOutbound` already ran earlier in `cello_send` before `sendContent` is ever reached, so the
  parked content was already screened before deposit. No new unscreened path is introduced.
- `#parkContent`'s existing callers (the live 3b hook AND the startup-flush re-park, `#3078`) both
  need the signature change — audit both, not just the live path.
- Never silently swallow a park FAILURE as if it were a success — if `#parkContent` now reports
  false, `cello_send` must still return the honest `session_stream_unavailable` today's code
  returns, not a false "dispatched to relay."

**Test strategy:** red-first at the `sessionNodeManager.sendContent` level (a direct-stream-failure
unit test asserting the new `{ok:true, delivered:false, parked:true}` shape when the park hook
resolves true, and the existing `{ok:false, reason:"session_stream_unavailable"}` shape preserved
when the park hook resolves false or throws) — extending, not replacing, the existing MSG-001-3b
test coverage (falls under fixture-harness discipline: reuse the existing session-fixture, no
from-scratch fixture). Then a `cello_send`-level e2e test (real two-daemon session, kill the direct
stream, assert `cello_send` returns `ok:true, delivered:false, reason:"dispatched_to_relay"`, then
bring the recipient back and assert `cello_receive`/`cello_check_notifications` surfaces it —
proving clause 4's already-built gates fire on this exact path end to end, not just by inspection).

**Next:** red tests, then implement.

---

### 2026-07-07 — Entry 28: DOD-M9INT-1 — m9-build merged to main (commit pending this entry)

**Sequencing note:** per D11/§5, this merge is correctly timed — ALL M8C channel tiers (1-4) were
code-complete (Entry 27) before this ran, and DOD-LEAVEMSG-1's own DoD text requires the merge
"before DOD-LEAVEMSG-1 at the latest." Not a rehash of the settled D11 decision — just confirming
the trigger condition was met.

**Pre-merge baseline (the DoD's own "also unverified" ask):** checked out `m9-build` in a separate
worktree (`cello-client-m9`). `m9-gate-1.test.ts` — 2/2 green. Full m9-build package test run: 1038
passed, 3 pre-existing failures, all attributable to staleness vs. main (a static source-string
check predating M8C-SINCESEQ-1's `cello_send`/`cello_receive` shape change; two `core/client`
persist-024 tests calling a `core/transport` `createNode({})` signature that changed after
m9-build's fork point) — none are m9-build's own defects.

**Merge scope reality-check:** the DoD text's "4 conflicts" estimate was stale (predates this
session's full Tier 1-4 build, which touched `daemon.ts`/`session-node-manager.ts` extensively).
Actual `git merge m9-build`: `daemon.ts` (3 conflict blocks), `session-node-manager.ts` (5),
`types.ts` (1), `tsconfig.json`, `vitest.workspace.ts` — 71 diverged main commits' worth of new
M8C code vs. m9-build's 34 commits' gateway package + seam wiring. m9-build's own diff was almost
entirely ADDITIVE (`core/gateway/` — a whole new package, 6438 lines) with the seam wiring
concentrated in the same handful of files M8C also touched all night.

**Conflict resolutions (all preserve BOTH sides' intent, not a one-sided pick):**
- Imports/fields/constructor options in `types.ts`/`session-node-manager.ts`/`daemon.ts`: purely
  additive on both sides — kept both.
- `DaemonDatabase` (main's newer SQLCipher wrapper type) kept over m9-build's `DatabaseSync` (a
  structurally-compatible subset per `sqlcipher-db.ts`'s own doc comment) — no behavior change.
- `ingestReceivedContent`: CURSOR-1's ABUSE-1 size-cap check (cheap, sync) ordered BEFORE M9's
  `screenInbound` seam (async, more expensive) — both are independent gates; either rejects on its
  own criteria, so the ordering choice doesn't affect correctness, just fail-fast economics.
- `cello_send`: CURSOR-1's read-before-write gate ordered BEFORE M9's `governance_decisions`
  parsing — an access-control short-circuit belongs before unrelated prep work for a send that may
  not even be allowed to proceed.
- `sessionNodeManager` construction: m9-build's copy at the OLD construction site (deep in
  `startDaemon`) was a stale duplicate — main had already moved construction earlier (PERSIST-002,
  before this session). Removed the duplicate; moved M9's `securityGateway` local + the
  `security.gateway.connected` startup log up to the real (earlier) construction call instead.
- `vitest.workspace.ts`/`tsconfig.json`: both sides added different new packages (`core/daemon`+
  `core/cli` on main, `core/gateway` on m9-build) — kept all three.

**One real merge bug found (self-caught, not reviewer-found) and fixed before commit:** `cello_send`'s
sent-transcript record (`recordTranscriptMessage`) used the pre-redaction `contentBytes` instead of
the actually-sent `sendBytes` — on a `redact` verdict this would have written the ORIGINAL,
un-redacted draft into the durable transcript even though the wire send and the Merkle leaf both
correctly used the redacted bytes. This line didn't exist in m9-build (main-only, added after the
fork point for DOD-LOG-1), so there was no "other side" to diff against — traced from M9's own
stated seam invariant ("the transcript records what was actually sent") and fixed.

**Breaking API surfaced by the merge:** `ingestReceivedContent` became `async` (must `await`
`screenInbound`). Production call sites were already correct (m9-build's own changes). ~25 test call
sites across `daemon-004-ipc.test.ts` and every M8C Tier 2-4 test file (CURSOR-1, AWAY-1, CONTACT-1,
ABUSE-1, TGDOOR-1, MSGWAKE-1) called it synchronously and needed `await` added — fixed.

**Two real test bugs found and fixed (neither a merge artifact — pre-existing on their respective
sides, surfaced by running everything together for the first time):**
1. `mcp-001-proxy.test.ts`'s static source-string assertion was stale against BOTH M8C-SINCESEQ-1's
   and M9-FEED-001's changes to `cello-mcp.ts`'s `cello_send`/`cello_receive` forwarding shape
   (`governance_decisions` param added, call reformatted multi-line) — updated to match current source.
2. m9-build's own `m9-core-001-seam.test.ts`: 16 `cello_receive` polling calls (in loops expecting
   ABSENCE of content — the warn/block scenarios) omitted `timeout_ms`, silently relying on
   m9-build's fork-point-era NON-BLOCKING `cello_receive` (instant return, no polling). Main's
   `cello_receive` was upgraded to a 30s-default BLOCKING receive (DAEMON-004 F1-a, predates this
   session). Under the new semantics each poll-for-absence call blocked the full 30s default instead
   of returning instantly, blowing well past the test's own 90s budget — NOT a resource-contention
   issue as first suspected (ruled out via a lengthy false trail: killed genuinely-orphaned vitest
   worker processes, tried the `forks` pool for full OS-process isolation, bumped timeouts to 90s —
   none of it changed the identical 8/19 failure pattern, which was the tell that it wasn't
   environmental). Root-caused by reading the actual failing test code and comparing m9-build's OLD
   inline `cello_receive` handler (a simple non-blocking buffer pop, no `timeout_ms` handling at
   all) against main's current one. Fixed: `timeout_ms: 0` on all 16 calls, matching the test's own
   manual-polling design intent. Confirmed: 19/19 green standalone (was 11/19), 77/77 files green in
   the full daemon package (was hanging 300-770s with 8 failures; now 31s clean).

**Content-path audit (the DoD's explicit ask):** `#handleContentStream` (direct inbound) and
`recoverParkedFromRelay` (RELAYWAKE-1's relay-pull) both funnel through `ingestReceivedContent` —
the single inbound chokepoint `screenInbound` now guards. `cello_send`'s IPC handler is the sole
outbound funnel `screenOutbound` guards. AWAY-1/CONTACT-1's canned auto-responses
(`sendAwayResponse`) call `sessionNodeManager.sendContent` directly, bypassing the IPC-level
`cello_send` (and therefore `screenOutbound`) — audited as CORRECT, not a gap: these send only
fixed, hardcoded system literals ("Agent is currently away...", "Dispatched."), never user-authored
content, so there is nothing for PII/secrets/injection screening to check. Doorbells (WAKE/MSGWAKE/
TGDOOR) are content-free by DOD-INV-CONTENTFREE and carry no screenable payload at all.

**Gate:** full monorepo `pnpm run test` (1733 passed, 164 files, 12 skipped, 3 todo) → `lint` (clean)
→ `typecheck` (clean) → `build` (clean).

**Status:** DOD-M9INT-1 → **🟡 MERGED** (activates DOD-INV-GATEWAY). `cello-unit-reviewer` dispatch
pending immediately after this commit, per the standard per-unit loop (§2 step 8) — this is being
treated as one unit despite being a merge, since real code changes (the redact-transcript fix, the
construction de-dup) were made resolving it, not just mechanical conflict-marker removal.

**Next:** DOD-LEAVEMSG-1 (Tier 4) — now unblocked.

---

### 2026-07-06 — Entry 27: TGDOOR-1 reviewer fixes + DOD-RELAYWAKE-1 built (commit `446fb74`)

**TGDOOR-1 reviewer (a60d68ed) on `99d6a53`: 2 HIGH + 2 hollow-test findings, all fixed.**
(1) `HttpTelegramBotClient.getUpdates` silently collapsed a Telegram API rejection (`ok:false`,
e.g. a revoked token) into an empty array — indistinguishable from "no updates," so a dead bot ran
forever with zero observable signal. Fixed: throws on `ok:false`, engaging the poller's existing
catch/backoff/log path. (2) `telegramRungUnread` had no cleanup at all — same unbounded-growth
class as TTL-1's already-fixed `expiredSessionRequests` leak. Fixed: cleared on every state-change
event. (3) MEDIUM: the generation counter allowed a one-call overlap + offset contamination across
a token rotation; fixed by capturing the client as a loop-local parameter and resetting the offset
only on an actual token/chat change. Hollow tests fixed: G1 (session-request ring) now exercises
the real `acceptInboundAssignment` path via an injected assignment frame; G7 (cold-capable) now
proves settings persisted by a PRIOR daemon run wake a fresh boot with zero IPC connections;
per-session coalescing isolation added.

**DOD-RELAYWAKE-1 built.** `SignalingManager` (core/transport) gained an `onConnected` callback —
fires on the first connect AND every reconnect after a drop, best-effort. Wired into
`getAgentSignaling`'s per-agent manager to call `autoRecoverForAgent` on every reconnect, not just
agent-start (the real gap: a message parked while signaling was merely down — network blip,
directory node restart — was previously undiscoverable until the next full agent restart).
Investigated both repos thoroughly before building: the content-recovery PULL mechanism already
exists and works; what's missing is knowing WHICH relay to ask, which today is derived only from
local session history. A brand-new counterparty (no prior session) remains undiscoverable — this
needs a NEW directory API neither repo has today, journaled as **D19** (own future story, matches
the D16 pattern) rather than silently narrowed or half-built.

Proven with a REAL forced reconnect at the transport level (heartbeat timeout, not a simulated
failure) — 3 tests. Daemon-level wiring is a direct 3-line pass-through with no dedicated
reconnect-simulation test (honestly noted: no daemon test in this repo forces a real per-agent
signaling reconnect today — building that harness from scratch was disproportionate to this unit).

Full gate green (1577). `cello-unit-reviewer` dispatch next for RELAYWAKE-1.

**Next: DOD-LEAVEMSG-1 — needs the M9 merge first**, per the DoD's own note ("before
DOD-LEAVEMSG-1 at the latest"). Doing the M9 merge now.

---

### 2026-07-06 — Entry 26: DOD-TGDOOR-1 built (commit `99d6a53`) — TIER 3 CODE-COMPLETE

Built per the Entry 25 design note. `TelegramBotClient` interface + `HttpTelegramBotClient` (M4+
adapter pattern, injectable via `DaemonConfig.telegramBotClient` matching this repo's existing
test-injection convention). New dedicated `telegram_settings` table (bot token has no sensible
default — unlike AWAY/TTL/CONTACT, can't defer to M9-CFG-001). Single long-lived `getUpdates`
poller, guarded by a GENERATION COUNTER rather than a boolean (a boolean stop-then-restart would
let the old loop's while-condition still pass, running two concurrent pollers). Cold-capable —
starts at daemon boot if settings already exist.

Three event hooks reuse AWAY-1/MSGWAKE-1's existing dispatch points: session-request
(`acceptInboundAssignment`) and state-change (`dispatchSessionStateChangedWithTelegram`, wrapping
`notificationDispatcher.dispatchSessionStateChanged` at all 4 call sites) ALWAYS ring; message-
waiting (`setOnContentArrived`) is coalesced (ring-once-until-read, cleared wherever
`cello_receive`/`since_seq` advances the read watermark). Inbound: allowlisted chat → canned ack;
any other chat → silent drop, never touching CELLO content paths. Content-free: every doorbell is
a fixed per-kind label, never message text. CLI: `cello telegram set-token`.

**Tests:** `m8c-tgdoor-1.test.ts` new (4), via a `FakeTelegramBotClient` — no real network. Full
gate green (1571). `cello-unit-reviewer` dispatch next.

**This closes Tier 3 (Reachability + protection) code-complete** — AWAY-1, CONTACT-1, ABUSE-1,
TTL-1, TGDOOR-1 all built (CONFIG-1's own line remains parked, D14). TGDOOR-1 is the one Tier-3
unit that cannot be smoke-tested even locally beyond the fake client — it needs a REAL Telegram
bot token for the live proof (flagged upfront as a live-test dependency).

**Next: Tier 4 (Async foundation)** — DOD-RELAYWAKE-1 (M9-independent, build now) then
DOD-LEAVEMSG-1 (needs the M9 merge first, per the DoD's own note "before DOD-LEAVEMSG-1 at the
latest" — D11/D16's deferred M9 merge happens between these two units).

---

### 2026-07-06 — Entry 25: DOD-TGDOOR-1 design note (§6, before code)

**Scope (DoD, re-stated precisely):** daemon-owned Telegram bot, single long-lived `getUpdates`
poller, allowlisted operator chat ID, DISCRETE events only (session request / message-waiting /
state change) pushed cold-capable, `[agent · session]` header, content-free
(DOD-INV-CONTENTFREE). Inbound: allowlisted chat → canned notify-only ack
(`telegram.inbound.acknowledged`); any other chat → silent drop
(`telegram.inbound.rejected`), nothing touches CELLO content paths. Coalescing: ring-once-
until-read per session (keyed on INBOX's unread watermark); session requests + state changes
ALWAYS ring (never coalesced). Telegram is the ONLY stage-3 platform in M8C. NO channel
machinery — this is the daemon talking to the Telegram Bot API directly, unrelated to the
`claude/channel` MCP capability from Tiers 1-2.

**Producer/consumer chain:**
- Producer of the bot's OWN outbound pushes: the SAME three dispatch points AWAY-1/MSGWAKE-1
  already hook — `acceptInboundAssignment` (session request), `setOnContentArrived` (message-
  waiting), `notificationDispatcher.dispatchSessionStateChanged` call sites (state change). One
  more subscriber added to each, not new architecture.
- Producer of inbound Telegram updates: the bot API's `getUpdates` long-poll response.
- Consumer of outbound pushes: Telegram's `sendMessage` API, one allowlisted chat ID.
- Consumer of inbound updates: the daemon's own inbound handler (ack or silent-drop by chat ID
  match) — CELLO's session/content paths are NEVER a consumer of Telegram inbound (D6 is explicit
  on this; a stray inbound Telegram message must not become a CELLO session or message).

**Adapter pattern (M4+ rule, "never call an external dependency directly"):** a `TelegramBotClient`
interface (`getUpdates`, `sendMessage`) + a real HTTP implementation (`fetch` against
`api.telegram.org`) + an injectable point in `DaemonConfig` (matching the existing
`sessionNodeFactory`/`sessionNegotiator`/`signalingConnect` test-injection convention already used
throughout this milestone — NOT the separate `packages/interfaces` mechanism, which is this
repo's OWN convention, distinct from trustless-cello's server-side one). Tests inject a
`FakeTelegramBotClient` (in-memory, records sent messages, lets a test push inbound updates) — no
real network, matching every other unit tonight.

**Persistence — a NEW, narrow, dedicated table (justified, not a parallel config store):** bot
token + allowlisted chat ID have NO sensible default (a token MUST be operator-supplied) — unlike
AWAY/TTL/CONTACT, which all shipped real, correct defaults and could legitimately defer
configurability to M9-CFG-001. A required credential cannot be deferred the same way. One singleton
row, daemon-wide (DoD: "token = daemon setting", not per-agent): `telegram_settings(id=1, bot_token,
allowlisted_chat_id, updated_at)`.

**Poller lifecycle:** started once, when settings exist at daemon boot (or immediately after being
set); a single in-flight `getUpdates` loop per daemon (guarded so a second start is a no-op);
stopped on daemon shutdown. Tier 5 note (per DoD, not built now): "poller is Primary-only" — with
no Tier 5 yet, a single daemon IS always Primary, so this is trivially satisfied, not deferred.

**Coalescing implementation:** a `telegramRungUnread: Set<agent:session>` — ring on the FIRST
message-waiting event since the session was last fully read (mirrors AWAY-1's dedup-Set pattern);
cleared when `advanceLastDeliveredSeq`/INBOX's watermark shows the session's unread count returns
to 0. Session-request and state-change events bypass this Set entirely — DoD says they always ring.

**CLI surface:** `cello telegram set-token <token> <chat_id>` (or equivalent) to persist settings —
narrow, dedicated, not folded into the parked `cello config` surface.

Proceeding to the red-first loop now.

---

### 2026-07-06 — Entry 24: DOD-ABUSE-1 + DOD-TTL-1 built, both reviewed, both had HIGH findings fixed (commits `b28e6d3`→`014a8bc`, `e1ddb18`→`af8a701`)

**DOD-ABUSE-1 built (`b28e6d3`).** Per-session cumulative-received-byte cap (25MB, anti-drip-feed)
in the content funnel; per-sender + global anti-swarm acceptance bounds via
`checkUnknownSenderAcceptanceBound`, checked first in `acceptInboundAssignment`. Known contacts
exempt from all of it ("bounded only by disk").

**Reviewer (aeffb82f): two HIGH, attacker-controlled bypasses, both fixed (`014a8bc`).** (1) The
size cap ran AFTER the out-of-order hold-branch's early return — held content skipped it entirely,
and `#releaseHeld` appended it later with no re-check; a sender fully controls delivery timing and
could drip-feed unbounded bytes this way. Fixed: moved the check before the hold-branch, now also
accounting for currently-held bytes (not just committed). (2) Both acceptance-bound queries counted
`status = 'active'` only — a counterparty can trivially force `'interrupted'` just by disconnecting
(a session that still accepts content), evading both bounds for free, indefinitely, by
open/disconnect/repeat. Fixed: both queries now count `active` + `interrupted`. Two regression
tests added, proving each exact bypass is closed.

**DOD-TTL-1 built (`e1ddb18`).** 24h default TTL (`INBOUND_SESSION_TTL_MS`), lazy reap-on-read (no
background timer), expired requests surface via `cello_check_notifications`'s new
`expired_session_requests` rather than vanishing. Per-agent override parked on M9-CFG-001 (D17).

**Reviewer (aed2d71f): SPEC FAITHFUL on T1-T3, one HIGH found + fixed (`af8a701`).**
`expiredSessionRequests` was append-only with no drain — and a whitelisted CONTACT-1 contact is
EXEMPT from ABUSE-1's bounds, so they could push unlimited accepted sessions the operator never
claims, each becoming a permanent entry every 24h for the daemon's whole lifetime (the exact
resource-leak class `STATUS_RESUMABLE_CAP` already exists in this file to prevent, just not applied
here). Fixed: capped at 20/agent (keep-newest-N) + `totalExpired` added to the INBOX log line for
observability. Regression test added.

**Both fixes are closed bugs, not scope deviations — no new D-decision needed** (D-entries are for
parked/deferred scope; these gaps are now fully, correctly implemented per the DoD text).

Full gate green (1567) after all four fix commits. Continuing to DOD-TGDOOR-1 (§6
design-significant — the last Tier-3 unit) with a design note first.

---

### 2026-07-06 — Entry 23: AWAY-1 reviewer fixes + DOD-CONTACT-1 built (commit `6bed679`)

**AWAY-1 reviewer (a9099571) on `10d2d01`: three findings, all fixed.** (1) HIGH — `cello_get_transcript`'s
cursor advance still trusted a raw max, reachable in principle via `recordTranscriptMessage`'s
silent DB-write-failure swallow (same bug class as the original CURSOR-1 HIGH finding, through the
one path that commit left untouched); fixed by routing it through `safeCursorAdvance` too. (2) HIGH
spec/blocking — the opaque-mode deviation was claimed "journaled, D14-pattern" in a code comment
with no actual `M8C-DECISIONS.md` entry; fixed with a real **D15** (mirrors D14) + the DoD's
Parked-decisions bullet — a deviation is only legal once the artifact exists. (3) MEDIUM — the
away-ack dedup guard never cleared on send failure, permanently silencing the rest of an away
period after one transient failure; fixed (`awayAckSent.delete` in both the failure branch and
catch). Test-teeth gaps closed: per-session dedup isolation, failure-then-retry.

**DOD-CONTACT-1 built.** New `contacts` table (a real ACL, not a config-store setting) +
isContact/addContact/removeContact/listContacts. Auto-add (D6): `cello_initiate_session` success
adds the target; `acceptInboundAssignment` adds the initiator, ordered AFTER `sendAwayResponse`'s
synchronous isContact check so a stranger's first contact is judged unknown (gets a minimal
"Dispatched." reply) but becomes known for every interaction after. CLI: `cello contact
add/remove/list [--agent <name>]`. Composes with AWAY-1 rather than duplicating its attended-gate.

**Cross-unit interactions found + fixed (again):** two pre-existing AWAY-1 tests used unknown
counterparties, now correctly routed to "Dispatched." by CONTACT-1 — pre-registered them as known
so those tests stay focused on AWAY-1's own templates; the known/unknown branching is covered by
the new CONTACT-1 test file. `cli-args.test.ts`'s `KNOWN_COMMANDS` assertion updated (+"contact").

**Tests:** `m8c-contact-1.test.ts` new (6). Full gate green (1556). `cello-unit-reviewer` dispatched
for CONTACT-1 (agent `a619ca33...`), continuing to DOD-ABUSE-1 while it runs.

---

### 2026-07-06 — Entry 22: DOD-CURSOR-1 reviewer HIGH fix + DOD-AWAY-1 built (commit `10d2d01`)

**CURSOR-1 reviewer (aa5928e2) on `01e9b5e`: SPEC DEVIATIONS + SILENT FALLBACK FOUND (blocking),
confirmed by live reproduction.** The since_seq/live-drain "advance cursor to max sequence
observed" logic let a connection silently skip an unread message a DIFFERENT local connection had
sent, whenever a later counterparty-received message arrived first — negating C4/C5, the exact
WhatsApp-group-chat guarantee. Fixed with `safeCursorAdvance()`: walks forward from the
connection's actual cursor through only a contiguous run of delivered sequence numbers, stopping
at the first gap (leaf indices are strictly contiguous across both directions, so this needs no
extra DB read). Wired into both receive-side advance sites. `cello_get_transcript`'s advance is
unaffected — it already covers the full bidirectional transcript, so "max seen" has no gap by
construction (verified, not just asserted). MEDIUM finding (missing `session.send.blocked` log)
also fixed. New tests C7 (live reproduction of the exact reported bypass) + C8 (per-session
isolation within one connection).

**DOD-AWAY-1 built.** Unattended Primary auto-acks (a) a fresh inbound session request and (b) an
inbound message on an existing session, with distinct per-type default text, coalesced (one ack
per away period, cleared on `cello_use_agent`). `isAttended()` matches the design doc's own
definition (Agent State Model: Attended = Primary + a live client claimed it via use_agent).
**Deviation (journaled, D14-pattern):** opaque privacy mode (full silence) is PARKED on
M9-CFG-001 — a genuine per-agent operator preference needing the deferred config store; transparent
is the DoD's own stated default, so CORE ships complete and non-fake without it.

**Discovered + fixed two genuine cross-unit interactions:** seeding an inbound message while
unattended now ALSO produces an AWAY-1 auto-ack leaf, so any test/caller that reads only the
received-content buffer (`cello_receive`) without also reading the full transcript
(`cello_get_transcript`) undercounts what CURSOR-1 requires before allowing a send. Fixed in
`daemon-004-ipc.test.ts` (production test) and reflected in `m8c-cursor-1.test.ts`'s C8 setup.

**Tests:** `m8c-cursor-1.test.ts` now 7 (C7/C8 added); `m8c-away-1.test.ts` new, 4 tests. Full gate
green (1548). `cello-unit-reviewer` dispatched for AWAY-1 + the CURSOR-1 fix (agent `a9099571...`),
continuing to DOD-CONTACT-1 while it runs.

---

### 2026-07-06 — Entry 21: OVERNIGHT AUTONOMOUS RUN begins (Andre asleep) — full DoD scope authorized

Andre confirmed FROST is fixed (live end-to-end conversation completed, including the channel
doorbell — the exact DOD-LIVE-1 journey). He then authorized full autonomous overnight work
across **the entire M8C-DEFINITION-OF-DONE** (Tiers 2–5 + the M9 merge gating LEAVEMSG), with an
explicit instruction: never stop for anything except the two named human-only steps (`latest`
promotion, `/mcp` reconnect for a live test); deploys and the beta `/cello-publish` cascade are
fully authorized and should be run proactively, not deferred to "when there's a live test excuse."
If one unit is blocked, skip to the next and keep going through every tier. Heartbeat cron
re-armed (`64a27e37`, `13,43 * * * *`) with this full authorization list baked into every firing,
plus an explicit instruction to Read (not grep) PROCEDURE + DoD in full if compaction drops them.

**DOD-CURSOR-1 — built, commit `01e9b5e`, review in flight.** Design (§6, design-significant):
per-connection (`connectionCursors: Map<connectionId, Map<sessionId, seq>>`, in-memory,
connection-scoped) read-before-write gate on `cello_send`. `current_seq = record.message_count - 1`
(already kept in sync with the tree's leaf count on every append, both directions — DAEMON-004
finding #2). Gate sits right after the `session_not_active` check, before any transmission. Own
sends auto-advance the sender's own cursor. `since_seq`/live-drain `cello_receive` both advance
the cursor for the common case, but `since_seq` is received-only by its own (already-shipped)
spec, so it CANNOT unblock a connection stuck behind a message a DIFFERENT LOCAL connection sent
on the same agent — only `cello_get_transcript` (the one reader covering both directions) does;
the gate's guidance points there. This is the real substance of the "WhatsApp-group-chat model."
Fixed one pre-existing test (`daemon-004-ipc.test.ts`) that sent blind after an unread inbound
message was buffered before the connection attached — it now reads first, which is the correct,
intended new contract, not a workaround. 5 new tests (`m8c-cursor-1.test.ts`); full gate green
(1542). `cello-unit-reviewer` dispatched (agent `aa5928e2...`), continuing to DOD-AWAY-1 while it
runs rather than waiting idle.

---

### 2026-07-06 — Entry 20: SESSION CAPSTONE + compaction point (read this first on resume)

**We decided to compact here** — a clean boundary (SINCESEQ + LOGINSTART-core built/reviewed/committed;
about to move on) — **and we are mid-investigation of a FROST session-establishment issue that is
NOT M8C's** (see Thread 1 in the resume pointer above + the brief handed to the federation session).

**What shipped this session (cello-client `main`, all committed + pushed; the WARN removal is HEAD
`1e8702d`).** Published to `latest`: **`@cello-protocol/daemon@0.0.31`, `cli@0.0.29`, `connect@0.0.58`**
(tag `v0.0.73`, smoke-tag green, binary cross-pins verified).

| Unit | Status | Commits |
|---|---|---|
| SPIKE-1 | ✅ (Entry 3) | reactive hop de-risked; throwaway patch reverted |
| WAKE-1 | 🟡 (Entry 6) | `d5fd5ec` + T1 fix — shim forwards daemon frames as `notifications/claude/channel` |
| AUTOSTART-1 (+F5/F18) | 🟡 (Entry 8) — **LIVE-verified** | `245c7b2`/`08b9dae` — use_agent auto-starts; F5 state/selected; F18 sole-online |
| INBOX-1 (+F4) | 🟡 (Entry 11) — **LIVE tool present** | `dfc02e8`/`22de42c` — `cello_check_notifications` + watermark + F4 4-way split |
| ONBOARD ×5 | 🟡 (Entry 12) | `448c362`/`af6d9b7` — help/errors/next-step/lognoise; WARN **removed entirely** `1e8702d` |
| MSGWAKE-1 | 🟡 (Entry 16) | `e4af837`/`5c4071e` — per-message `cello_message` doorbell |
| SINCESEQ-1 | 🟡 (Entry 17) | `a404d3a` — `cello_receive({since_seq})` stateless catch-up |
| LOGINSTART-1 CORE | 🟡 (Entry 19) | `69fe1ea`/`b7f5f16` — login auto-starts all agents; opt-out PARKED (D14) |
| **LIVE-1** | 🟠 **publish done; live doorbell BLOCKED by FROST** | v0.0.73 published+verified |
| CURSOR-1 | ❌ **next M8C code unit** (design note owed) | — |

**Every 🟡 flips ✅ at DOD-LIVE-1** (the live `--channels` doorbell). All are unit + real-binary green;
reviewers ran on every unit (SPEC-FAITHFUL throughout; each blocking test-teeth finding fixed with
teeth verified).

**Live verification done (published build, Andre's machine, `--channels` reconnected):** AUTOSTART
F5 (`state`+`selected`, never `"current"`) ✅, A1 (`use_agent` auto-starts an offline agent) ✅, A3
(registered → no warning) ✅; INBOX (`cello_check_notifications` tool present) ✅. The **WAKE/MSGWAKE
in-context doorbell** is the ONLY unproven-live piece — blocked by the FROST issue below.

**THE BLOCKER (not M8C — handed off).** `cello_initiate_session` → `ceremony_exhausted` both
directions (systemic) between fresh post-wipe agents; client `participateInCeremony` returns `ok:false`
(FROST aggregate fails vs `primary_pubkey`). Trigger = directory DB wipe + fresh DKG, interacting with
recent **federation** commits. Full brief given to the federation session. `~/.cello/daemon.log` has the
raw trace. **Do not debug it in the M8C thread.**

**Decisions this session:** D11 (M9 merged AFTER channels, not first — do NOT merge `m9-build`),
D12 (auto-start permissive + `not_registered` non-blocking), D13 (token prefix-only client check),
D14 (CONFIG-1 + LOGINSTART opt-out parked on M9-CFG-001 — the config store is inside the deferred M9
gateway). All in [[M8C-DECISIONS]].

**Live doorbell smoke — exact steps to retry once FROST is fixed:** (1) two registered agents online
+ `standing_receiver_ready:true`; (2) receiver runs `claude --dangerously-load-development-channels
server:cello` + `cello_use_agent <receiver>`; (3) from a second connection (or this session)
`cello_use_agent <peer>` + `cello_initiate_session <receiver_pubkey>`; (4) the receiver's window
wakes on its own with a `<channel source="cello">` / `notifications/claude/channel` event =
DOD-LIVE-1 WAKE proof; send a message → MSGWAKE doorbell on the same channel.

---

### 2026-07-06 — Entry 19: DOD-LOGINSTART-1 CORE built + reviewed → 🟡 (opt-out parked, D14)

**Built (commits `69fe1ea` impl, `b7f5f16` review fix; cello-client main).** CLI-side (login command),
ZERO daemon change (design-review #8 orchestration lives in `cello login`). `autoStartAllAgents(client)`
helper: `cello_list_agents` → `cello_start_agent` each, collecting `{ started, failed:[{name,reason}] }`,
one bad agent never aborts the loop. `login` calls it after `connectOrStart` and appends a
`formatLoginSummary` (extracted, pure) that enumerates each failure by name+reason. login ALWAYS
returns exit 0 — even a total auto-start failure degrades to a loud one-line reason (the daemon IS up).
Idempotent (start is idempotent → re-login safe).

**Design choice (Entry 18):** login-COMMAND orchestration, NOT daemon boot — matches the DoD's literal
"cello login auto-starts" and keeps the daemon's boot contract (and its many offline-start tests) intact.

**Tests:** `m8c-loginstart-1.test.ts` (5): all-online + idempotent second pass; zero-agents clean;
the **failure path** (stub client forcing a `{ok:false}` + a throw → both enumerated by `{name,reason}`,
good agent still started); `formatLoginSummary` enumeration string; `login()` boundary (real in-process
daemon via `acquireLock` → exit 0 + summary). Full gate green (1537).

**`cello-unit-reviewer` (69fe1ea) — SPEC FAITHFUL (L1/L2/L3; L4 opt-out is the legal D14 park), NO
SILENT FALLBACKS. Blocking HOLLOW-TEST (F1) fixed in `b7f5f16`:** the failure-enumeration path — the
reason this DoD exists — had zero coverage (every test asserted `failed:[]`); a hollow impl with the
`failed.push`/`catch` removed passed. Now forced + asserted. F2 (login() boundary uncovered) also
closed. F3 (LOW, unreachable) noted, no fix.

**Status:** DOD-LOGINSTART-1 CORE → **🟡 BUILT / UNVERIFIED-LIVE**; the per-agent `autoStart:false`
opt-out remains PARKED on M9-CFG-001 (D14).

**Next unit:** DOD-CURSOR-1 (Tier 2, §6 design-significant — per-connection read cursor +
`session_not_current` gate; M9-independent). Terrain partly mapped (perConnectionState `daemon.ts:878`,
cello_send handler `:4796`). Design note owed before code.

---

### 2026-07-06 — Entry 18: DOD-LOGINSTART-1 CORE design note (M9-independent half; before code)

**Unit:** DOD-LOGINSTART-1 CORE (Tier 2). The per-agent `autoStart: false` opt-out is PARKED (D14 —
needs the M9 config store). CORE = `cello login` auto-starts all registered agents; login always
completes with failed agents enumerated by reason.

**Design fork (decided):** WHERE does auto-start-all live?
- **(a) daemon boot** — auto-start every loaded agent in `startDaemon` after setup. REJECTED as the
  default: agents load offline today (`loadAgents`, `daemon.ts:507`) and **many daemon tests assume
  agents start offline** (mcp-002 starts alice explicitly and asserts `agent_state_changed`);
  blanket boot-autostart breaks them. A `DaemonConfig.autoStartAgents` flag set only by login avoids
  that, but needs plumbing through the `cello-daemon` bin env (`cello-daemon.ts:42` reads
  `CELLO_DIR` etc.) + risks any real-binary-spawning test.
- **(b) the `cello login` command** — after `connectOrStart` brings the daemon up, the login command
  connects over IPC, `cello_list_agents`, and `cello_start_agent` each, collecting failures.
  **CHOSEN.** Matches the DoD's literal "**cello login** auto-starts"; zero daemon-boot regression
  (daemon startup unchanged); login is THE operator entry point (the only daemon spawner —
  `connectOrStart`/`spawnDaemon`; the MCP shim never spawns). `cello_start_agent` is idempotent, so
  re-login on an already-running daemon is safe. Note: a daemon started by some non-login path won't
  auto-start — acceptable, since login is how operators start it, and it keeps the daemon's boot
  contract (and its tests) intact.

**Clause checklist (CORE):**
- **L1** — `cello login`, after the daemon is up, starts every loaded agent (`cello_list_agents` →
  `cello_start_agent` per agent). `login → all agents online` with no per-agent commands.
- **L2** — login ALWAYS completes: a failed start does not abort login; failures are collected, not
  thrown. Enumerated in the login output by `{ name, reason }` (design-review #8).
- **L3** — idempotent: already-online agents are a no-op (start is idempotent); re-login is safe.
- **L4 (parked, D14)** — the per-agent `autoStart: false` opt-out is NOT in core; core starts all.
  When M9-CFG-001 lands, the login loop consults the config per agent.
- **Obs** — the login command logs/prints the auto-start summary (started count + failures). No
  console.log in daemon impl (this is CLI output — the login command already prints to stdout).

**Falsify-first:** (a) after `connectOrStart` the daemon IPC is READY (spawnDaemon waits on the lock
file, written after IPC listens) — so `connectToDaemon` + `cello_list_agents` succeeds. (b) the login
loop must not throw on a per-agent failure (wrap each start; collect). (c) `cello_start_agent` failure
modes for a loaded agent are near-nil (agent_not_found can't happen for a listed agent) — so failures
are rare, but the enumeration path must still be exercised by a test (inject a failure or assert the
shape). (d) NO daemon-boot behavior change → existing daemon tests untouched.

**Test strategy:** CLI test (like `commands.test.ts`) — a real `startDaemon` + seed 2 loaded agents;
call the login command (or its auto-start helper) → assert both agents report `online` in
`cello_status` afterward, and the output enumerates counts; a login with zero agents completes
cleanly. (The auto-start-all is best extracted into a testable helper the login command calls.)

**Next:** red-first test → implement the login auto-start-all + enumeration → gate → review.

---

### 2026-07-06 — Entry 17: DOD-SINCESEQ-1 built + reviewed → 🟡; D14 (config units gated on M9-CFG-001)

**Built (commit `a404d3a`; cello-client main).** DAEMON-side (§5) + one optional shim param.
`cello_receive({ since_seq })` — a distinct early branch in `handleReceive` (after ownership checks,
before the timeout/drain loop): returns a batch of RECEIVED transcript messages with `sequence >
since_seq` (durable transcript, not the ephemeral buffer — no replay race), advances the read
watermark to the max returned seq (clears INBOX unread). Plain receive path entirely unchanged (S4).

**Tests:** `m8c-sinceseq-1.test.ts` (4) — batch-beyond-cursor (ordered, content, from, count,
watermark-advance via INBOX unread-cleared); empty-at-latest; `since_seq:0` boundary (batches, not
falsy); S4 no-regression (plain receive → null-content, no `messages` field).

**`cello-unit-reviewer` (a404d3a) — SPEC FAITHFUL, NO SILENT FALLBACKS, TESTS HAVE TEETH.** No
HIGH/MEDIUM findings. Two hollow-impl bypasses (ignore-cursor → returns whole transcript;
include-sent) both caught. Only actionable item: the recommended `since_seq:0` coverage add
(committed after `a404d3a`). LOW notes (no-fix): no-advance-when-empty is spec-consistent; negative
since_seq = "everything" is natural.

**D14 — config-store dependency surfaced + decided (follows from D11):** the config store is
`core/gateway/src/config/config-store.ts`, INSIDE the deferred M9 gateway package. So `DOD-CONFIG-1`
(entirely) and `DOD-LOGINSTART-1`'s per-agent `autoStart: false` opt-out are **gated on M9-CFG-001**.
Decision (M8C-DECISIONS D14): build the M9-INDEPENDENT Tier-2 units now (LOGINSTART CORE, CURSOR);
**PARK** CONFIG-1 + the opt-out clause until M9-CFG-001 lands with the M9 merge. NO parallel config
store (DoD forbids). Reverse: a deliberate forward-port of just `config-store.ts` if config is wanted
before M9.

**Status:** DOD-SINCESEQ-1 → **🟡 BUILT / UNVERIFIED-LIVE**.

**Next unit:** DOD-LOGINSTART-1 CORE (M9-independent: `cello login` auto-starts all registered
agents, login completes with failures enumerated; the `autoStart:false` opt-out is parked, D14).

---

### 2026-07-06 — Entry 16: DOD-MSGWAKE-1 built + reviewed → 🟡; + live Tier-1 verification

**Built (commits `e4af837` impl, `5c4071e` review fixes; cello-client main).** DAEMON-side (§5),
rides WAKE's generic bridge (zero shim change). `#appendVerifiedContent` → `#onContentArrived` →
`dispatchCelloMessage` → content-free `cello_message` frame (type + from + session_id), routed to
current-agent connections. `cello_message` rides the shim's WAKE bridge to a live `--channels`
session.

**Tests:** `m8c-msgwake-1.test.ts` (3, all driving the REAL funnel via `ingestReceivedContent`):
direct path (content-free + routing, teeth-verified — removing the fire → red); **held out-of-order
→ wakes once at RELEASE** (0 at hold, 2 after filler); **deduped replay → zero extra wakes** (1 not
2). Full gate green (1528).

**`cello-unit-reviewer` (e4af837) — SPEC FAITHFUL 6/6, NO SILENT FALLBACKS. Fixed in `5c4071e`:**
- **Hollow-test gap [blocking].** Direct path had teeth; the "AND recovered" (M1) + no-premature-wake
  (M4) properties did not — a doorbell fired BEFORE the dedup/hold gates would pass the old test yet
  wake prematurely/spuriously. Added the held-release + dedup tests (above); impl was already correct
  (fire is inside `#appendVerifiedContent`, after both gates).
- **F1 [LOW, pre-existing].** The `"unknown"` senderPubkey fallback now logs
  `session.content.sender_unresolved` (warn) so a chronic miss is visible, not silently shipped as
  `from:"unknown"` on every doorbell.

**Live Tier-1 verification (2026-07-06, against the PUBLISHED build daemon 0.0.31/connect 0.0.58 on
Andre's machine after `npm i -g @latest` + logout/login + `/mcp` reconnect):**
- **AUTOSTART F5** ✅ live — `cello_status` reports `state` + distinct `selected` (never `"current"`).
- **AUTOSTART A1** ✅ live — `cello_use_agent` on an OFFLINE agent auto-started it
  (`state:online, selected:true, standing_receiver_ready:true`); pre-change it errored `agent_not_online`.
- **AUTOSTART A3** ✅ live — no `not_registered` warning on a registered agent.
- **INBOX + connect 0.0.58** ✅ live — the `cello_check_notifications` tool is present in the
  reconnected MCP (didn't exist pre-0.0.58); its description is the exact INBOX proxy text.
- The full doorbell-into-context (WAKE/MSGWAKE) still needs a PEER session (directory was wiped —
  peer re-registration pending) → the remaining DOD-LIVE-1 live step.
- (Aside: cleaned 5 stale pre-session local agents from Andre's daemon at his request, keeping
  Ms_Chelly — via `cello remove-agent`, verified live. Not a code change.)

**Status:** DOD-MSGWAKE-1 → **🟡 BUILT / UNVERIFIED-LIVE** (daemon layer proven; the in-context
per-message wake flips ✅ on the same live `--channels` smoke as WAKE).

**Next unit:** DOD-SINCESEQ-1 (Entry 15 design note) — the `since_seq` catch-up branch in handleReceive.

---

### 2026-07-06 — Entry 15: DOD-SINCESEQ-1 design note (terrain from INBOX; before code)

**Unit:** DOD-SINCESEQ-1 (Tier 2). DAEMON build (§5). `cello_receive({ since_seq })` — stateless
catch-up from any gap size, no replay race; replaces the `cello_get_transcript` workaround for
away-then-return.

**Code terrain (mapped via INBOX-1, symbols):**
- `handleReceive` (`daemon.ts:4838`) — today drains ONE buffered message per call via
  `takeReceivedContent` (ephemeral buffer). A buffer-drain catch-up races new arrivals; `since_seq`
  reads the DURABLE transcript deterministically instead.
- `readTranscript(agent, session)` (`session-node-manager.ts`) → `{ sequence, direction, text }[]`
  ordered by sequence — the durable source for the batch.
- Watermark methods (INBOX-1): `getLastDeliveredSeq` / `advanceLastDeliveredSeq` (monotonic).

**Clause checklist:**
- **S1** — `cello_receive({ session_id, since_seq })` returns a BATCH of RECEIVED transcript messages
  with `sequence > since_seq`, ordered ascending: `{ ok, messages: [{ sequence, content, from }], count }`.
  (Received-direction — the messages you'd have gotten live; `cello_get_transcript` still gives both
  directions for full context.) `from` = the session's counterparty pubkey.
- **S2** — STATELESS + no replay race: the client supplies `since_seq`; the read is from the durable
  transcript (`readTranscript`), not the ephemeral `#receivedContent` buffer — so concurrent arrivals
  don't shift what a given `since_seq` returns.
- **S3** — advances the read watermark to the max returned sequence (delivery marks read; consistent
  with INBOX N3 — a since_seq fetch clears those messages from `cello_check_notifications` unread).
- **S4 — NO REGRESSION:** `cello_receive` WITHOUT `since_seq` behaves EXACTLY as today (buffer drain,
  single message, timeout/terminal/liveness branches unchanged). `since_seq` is a distinct early
  branch at the top of `handleReceive`.
- **Obs** — `session.receive.since_seq` (session, since_seq, count). No console.log.

**Falsify-first:** (a) the `since_seq` branch must NOT touch the `#receivedContent` buffer or the
timeout loop — it's a pure transcript read + watermark advance, returning immediately. (b) received-
only (a `since_seq` catch-up shouldn't echo the operator's own sent messages as "received"). (c)
`since_seq` at or beyond the latest returns an empty batch, not an error. (d) advancing the watermark
here must be monotonic (reuse `advanceLastDeliveredSeq`).

**Test strategy:** daemon fixture — seed received transcript rows (0..N) via
`recordTranscriptMessage`; `cello_receive({ session_id, since_seq: k })` → messages k+1..N in order,
content present; assert `cello_check_notifications` unread cleared for those (watermark advanced);
a `since_seq` at N → empty; `cello_receive` without `since_seq` still drains the live buffer (no
regression). Teeth: a hollow impl returning the whole transcript (ignoring since_seq) fails the
"k+1..N only" + "empty at N" assertions.

**Next:** after MSGWAKE-1 closes (reviewer) — red-first tests → implement the since_seq branch in
handleReceive → gate → review.

---

### 2026-07-06 — Entry 14: DOD-MSGWAKE-1 design note (§6 design-significant; before code)

**Unit:** DOD-MSGWAKE-1 (Tier 2, channel stage 2 — per-message wake). DAEMON build (§5). Started
while DOD-LIVE-1 sits at its human-only stop (§2c: continue with the next available unit). MSGWAKE
rides WAKE's forwarding hop — the shim's bridge already forwards EVERY notification type generically,
so a `cello_message` frame reaches Claude's context the moment the daemon emits it; no shim change.

**Producer/consumer chain (mirrors the session-state callback exactly):**
- **Producer (new):** `SessionNodeManager.#appendVerifiedContent` (`session-node-manager.ts` ~2544)
  is the SINGLE funnel where a verified received message is buffered for `cello_receive` (direct +
  released-from-hold + recovered/parked all pass here — the M9-seam single-inbound-funnel). After it
  buffers, fire a new `#onContentArrived(agentName, sessionId, senderPubkey)` callback — content-free
  (sender + session only, never the plaintext). Setter `setOnContentArrived` mirrors
  `setOnSessionStateChanged` (:839 setter, :1773 invoke).
- **Dispatcher (new):** `NotificationDispatcher.dispatchCelloMessage(agentName, sessionId, from)` —
  emits `{ notification: "cello_message", data: { agent, type: "cello_message", from, session_id } }`
  routed to connections where the agent is current (same routing as `dispatchSessionStateChanged`).
- **Wiring:** `daemon.ts` (~:5057, next to `setOnSessionStateChanged`):
  `sessionNodeManager.setOnContentArrived((a,s,from) => notificationDispatcher.dispatchCelloMessage(a,s,from))`.
- **Consumer (unchanged):** the shim's generic `proxy.onNotification` bridge (WAKE) forwards the
  `cello_message` frame as `notifications/claude/channel` with `params = data`. A live session gets an
  in-context event per inbound message — a real-time chat relay.

**Clause checklist:**
- **M1** — content arrival fires `dispatchCelloMessage` → a `cello_message` notification per inbound
  message (direct AND recovered), routed to the current-agent connection(s).
- **M2** — the frame carries `session_id` (payload gap from the 2026-07-01 log) + `from`
  (senderPubkey) + type; the operator calls `cello_receive({ session_id })` to fetch content.
- **M3 (INV-CONTENTFREE — the WAKE F2 flag, re-proven HERE against the REAL producer):** the
  `cello_message` `data` blob has NO content / message / text / plaintext field — assert against the
  frame the real `#appendVerifiedContent` path emits, not a hand-built one.
- **M4** — no double-wake / no interference with a blocked `cello_receive`: the doorbell is a
  notification; the blocked receive drains the buffer independently.
- **Obs** — `notification.cello_message.dispatched` (or reuse dispatcher's existing event shape); no console.log.
- **§5** — all logic daemon-side; shim untouched (generic bridge already handles it).

**Falsify-first:** (a) `#appendVerifiedContent` is the SINGLE received-content funnel (verify no other
path buffers to `#receivedContent` without passing here — else some messages wouldn't wake). (b) the
callback must fire AFTER the buffer push (so a woken receive finds the content). (c) content-free: the
callback signature carries only agent/session/senderPubkey — never the content bytes.

**Test strategy:** daemon fixture — set `onContentArrived` (or use a real `connectToDaemon` client +
`__test_buffer_received`-style injection through the real append path) → assert a `cello_message`
notification arrives at the current-agent connection with `{from, session_id}` and NO content; a
non-current connection does NOT receive it (routing); INV-CONTENTFREE assertion on the real frame.

**Next:** red-first tests → implement (callback + dispatcher + wiring) → gate → `cello-unit-reviewer`.

---

### 2026-07-06 — Entry 13: DOD-LIVE-1 — publish cascade DONE + verified; live smoke is human-only

**The Tier-1 close's autonomous half is complete.** Published the multi-package cascade to beta and
verified against the binaries (skill step 5). The remaining DOD-LIVE-1 enforcer — the operator's
Claude waking IN-CONTEXT in a live `claude --channels` session + the `/mcp` reconnect — is the named
human-only step (§2c); handed to Andre with a runbook.

**Publish (tag `v0.0.73`, cello-client main `9448324`):**
- Cascade: **daemon 0.0.30→0.0.31, cli 0.0.28→0.0.29, connect 0.0.57→0.0.58** (the 3 changed this
  milestone; crypto/protocol-types/transport/client unchanged and not depended-on by the changed
  set → no stale-pin). Tag counter `v0.0.73` (drifted from connect 0.0.58 per the skill — used the
  next free counter, not the connect version).
- CI **all green**: Build+Test ✓, Publish ✓, **smoke-tag ✓** (clean-installs cli+connect@beta,
  loads the daemon/client module graphs — the real success signal).
- **Binary-verified:** beta = daemon 0.0.31 / cli 0.0.29 / connect 0.0.58; cross-pins are REAL
  versions (`connect`→client 0.0.45/transport 0.0.15/crypto 0.0.16/interfaces 0.0.3;
  `cli`→daemon 0.0.31), never `workspace:*`.

**One CI hiccup fixed en route (`v0.0.72` → `v0.0.73`):** the first tag's Build+Test timed out at
30s on `m8c-wake-1-integration.test.ts` — it spawned the shim via `tsx`-from-source, which
cold-compiles on a loaded CI runner and hung the `initialize` handshake (1.1s local vs >30s CI = a
hang). Fixed (`9448324`): spawn the BUILT `dist/bin/cello-mcp.js` with plain `node` (no compile), a
`beforeAll` incremental `tsc --build` so the dist reflects current source in both CI-builds-first and
local-test-first orderings, and a per-request 15s timeout that fails fast with the shim's stderr.
v0.0.72 never published (Test failed first), so v0.0.73 reused the same versions.

**Tracked, NOT dismissed — pre-existing flake (not mine, did NOT block the publish):**
`session-node-manager.test.ts > AC-009 (binary): SIGTERM marks active sessions interrupted` failed on
the MAIN-branch CI run for the same commit but PASSED in the authoritative tag run. A timing-sensitive
SIGTERM/daemon-restart binary test, untouched by M8C. **Home:** a stabilization pass (raise its
process-wait tolerance / poll for the interrupted state instead of a fixed sleep) — flagged for a
follow-up, not stabilized during the launch publish.

**Demo agent (`i-0ad3e7c22470f266e`):** currently on a stale `@cello-protocol/connect@0.0.34` (both
`cello-daemon`+`cello-demo` services active). Needs updating to the new versions to serve as the
live-smoke PEER — deliberately NOT reinstalled unilaterally (live resource, possibly mid-demo; the
documented stop→reinstall→restart sequence is Andre's call, and the smoke needs him coordinating
both sides anyway).

**Status:** DOD-LIVE-1 → 🟠 PARTIAL (publish done + binary-verified; the four Tier-1 units
(WAKE/AUTOSTART/INBOX/ONBOARD) flip ✅ once the live `--channels` smoke passes). **Human-only steps
remaining (§2c):** (1) `latest` promotion (script provided); (2) reinstall Andre's machine + the demo
agent to the new versions; (3) the live doorbell smoke + cold-onboarding run + `/mcp` reconnect.

---

### 2026-07-06 — Entry 12: DOD-ONBOARD-* cluster built + reviewed → 🟡 (all 5 riders)

**Built (commits `448c362` impl, `af6d9b7` fixes; cello-client main).** CLI-side (`core/cli`) + one
daemon log-level change; no daemon protocol change.
- **HELP-1:** `cli-args.ts` register + create-agent help now real (two-step, worked example, token
  format `CELLO-`+33, env-var form, exact name rule `^[a-zA-Z0-9_-]{1,64}$`).
- **ERRORS-1:** `commands.register` client-side validation BEFORE the daemon — specific
  missing-token + malformed-token messages (the `CELLO_PREAUTH_TOKEN` typo → "starts with CELLO-"),
  no Usage dump, no pointless DKG round-trip. **R4 was already resolved upstream** (bogus token →
  structured `dkg_failed`, reproduced live — not silent); this adds client specificity.
  Unknown-agent stays the daemon's (`agent_not_found`).
- **NEXTSTEP-1:** register success appends "run `cello status`… connecting is normal…" guidance.
- **WARN-1:** the pre-auth exposure warning right-sized to a single-use/24h token (one calm line;
  stops pushing env-var as a security fix).
- **LOGNOISE-1:** `directory.signaling.reader.error`/`stream.ended` warn→debug + `expected:true`;
  sustained outage still escalates loudly (reviewer verified: `reconnect.failed` error + `lost` state).

**Tests:** `cli-args` (help richness) + `commands` (missing/malformed/valid distinct + the NEXTSTEP
success path). Full gate green (1525). **Live UX verified** (help, the typo error, missing-token).

**`cello-unit-reviewer` (448c362) — SPEC FAITHFUL (5/5), NO SILENT FALLBACKS, TESTS HAVE TEETH.
Findings + Andre correction all fixed in `af6d9b7`:**
- **Andre:** token source is the CELLO Operations Agent on **Telegram**, not a "portal" — fixed all
  4 copy references.
- **F2 [MEDIUM cross-repo coupling].** Client hard-coded the exact `CELLO-`+33-base58 format — a
  future directory format bump would strand valid tokens behind a client "malformed." **Relaxed to
  the stable `CELLO-` prefix only** (D13); directory stays the format authority.
- **F3 [LOW].** The WARN note printed before validation (reassured about a non-token). Now gated on
  `startsWith("CELLO-")`.
- **F1 [LOW test-gap].** NEXTSTEP success path was unasserted. Added a fake-IPC-daemon test
  asserting the guidance string.

**Status:** all 5 ONBOARD riders → **🟡 BUILT / UNVERIFIED-LIVE**. The cold `create-agent → register
→ status` onboarding run completable from tool output alone is proven at DOD-LIVE-1's launch smoke.

**Next unit:** DOD-LIVE-1 (Tier 1 close / launch gate) — the multi-package publish cascade
(`@cello-protocol/daemon` + `connect` + `cli`, via `/cello-publish`) + the live `--channels`
doorbell smoke + cold-onboarding bar. The live channels visual + `/mcp` reconnect are the human-only
steps (§2c); everything else (beta publish, tag, demo-agent update) is autonomous.

---

### 2026-07-06 — Entry 10: ONBOARD-* riders design note (terrain mapped; before code)

**Unit cluster:** DOD-ONBOARD-HELP/ERRORS/NEXTSTEP/WARN/LOGNOISE-1 (Tier 1, launch-critical
first-impression). Mostly **CLI text** (`core/cli/src`) + one daemon log-level change — cheap, not a
rebuild. Serves BOTH human and AI operators (an AI driving the CLI self-corrects from clear
errors + next-step guidance). Terrain mapped 2026-07-06:
- **CLI:** `core/cli/src/bin/cello.ts` (entry), `core/cli/src/commands.ts` (handlers + Usage
  strings — `register` at `:85`), `core/cli/src/cli-args.ts` (the `HELP` per-command map `:26-35`
  + arg parsing; already answers `--help`/`-h` per F2).
- **F11 log:** `signaling-connect.ts:323` — `logger.warn("directory.signaling.reader.error")`.

**Clause checklist:**
- **HELP-1 (F24, R1, R2, R5):** enrich the `cli-args.ts HELP` map — `create-agent` states the name
  rule `^[a-zA-Z0-9_-]{1,64}$`; `register` shows a worked example, the create-agent(local)→register
  (directory, needs token) two-step, quoting-only-for-spaces note, and the `CELLO_PREAUTH_TOKEN`
  env-var one-liner. `cello --help` + `cello <cmd> --help` give REAL help (what it does, example,
  every param + constraint), not a bare list.
- **ERRORS-1 (R3, R4):** **REPRODUCE R4 FIRST** — `cello register agent CELLO_PREAUTH_TOKEN` today
  reportedly returns NO output (silent failure on the core onboarding path); repro before fixing.
  Then register-path errors are specific: missing token → "you're missing the pre-auth token" (not
  the Usage line at `commands.ts:94`); malformed token → "that isn't a pre-auth token — they start
  with `CELLO-`"; unknown agent → "no agent named X; create it first".
- **NEXTSTEP-1 (R7):** every command output carries succinct next-step guidance + state legibility.
  After `register`: "run `cello status` to confirm." Explain state words (`connecting` normal ~1-2
  min; `connected` = ready; stuck disconnected → logout/login; never logged in → login). Covers
  register / login / status / use_agent.
- **WARN-1 (R6):** right-size the pre-auth exposure warning to what the token IS (single-use, 24h,
  consumed-on-success — verified directory-side). Drop the durable-secret klaxon; at most one calm
  line naming the real narrow risk (the seconds-long pre-redemption window). Stop pushing the
  env-var form as a *security* fix (shell history + environ still expose it).
- **LOGNOISE-1 (F11):** `signaling-connect.ts:323` warn → quieter level + marked expected (routine
  reconnect churn ~40-70 min, always recovers); a genuine sustained outage still stands out.

**Test strategy:** `cli-args`/`commands` unit tests assert help richness (name rule present, worked
example, env-var form) + register-error specificity (each of missing/malformed/unknown → its
distinct message, NOT a Usage dump); a test reproduces R4's silent path then asserts the specific
error; F11 asserts the event's level. The cold `create-agent → register → status` run completable
from tool output alone is part of DOD-LIVE-1's launch smoke.

**Decision (D10):** implement HELP/NEXTSTEP/WARN/LOGNOISE as CLI-text/log changes (no daemon
protocol change); ERRORS-1 may need the daemon register handler to return a structured reason the
CLI maps to specific text — keep the split (daemon owns the reason, CLI owns the phrasing), §5-clean.

**Next:** after INBOX-1 closes (reviewer) — repro R4 → red-first CLI tests → implement → gate → review.

---

### 2026-07-07 — Entry 48: live feedback-channel dogfood (Ms_Chelly → CELLO_Feedback) — clean run, one product note logged

**What happened:** short live CELLO session, Ms_Chelly (initiator) → `CELLO_Feedback`
(`da0c73f8…`), purely to dogfood the feedback channel itself — not a doorbell/DoD test. Agent
select (`cello_use_agent`) → `cello_initiate_session` → `cello_send` → `cello_receive` →
mutual `[[WRAP]]` → `cello_close_session` all worked without incident.
`sealed_root: 1a29969b440bb72f890064d3f415aee252a3e11b46919e78a08b56967202f1d9`.

**Feedback given (one item):** `cello_initiate_session` (and siblings) return `no_current_agent`
even when exactly one agent is registered/online for the connection, forcing an explicit
`cello_use_agent` call on every cold start before anything else works — a repeat papercut. Asked
whether these tools could apply the same sole-online auto-select the daemon already uses
elsewhere (F18/`resolveCurrentAgent`, DOD-AUTOSTART-1) rather than hard-failing when there's no
ambiguity to resolve. CELLO_Feedback acknowledged and logged it as a product note; no code change
made here.

**Note:** CELLO_Feedback is expected to append its own receiver-side entry for this same exchange
next.

---

### 2026-07-07 — Entry 49: feedback-channel dogfood, receiver side (CELLO_Feedback) — clean run, companion to Entry 48

**Receiver-side account of Entry 48's exchange.** `cello_use_agent({name:"CELLO_Feedback"})` →
posted "ready and idle, will not poll" → doorbell fired unprompted (`session_state_changed` for
session `db91691ceed96f7423b6254add73cf63`, then `cello_message`), zero polling on either event,
consistent with Entries 45/46. Received Ms_Chelly's product note (the `no_current_agent`
sole-agent auto-select papercut), acknowledged and logged it, mutual `[[WRAP]]`, closed. Same
`sealed_root: 1a29969b440bb72f890064d3f415aee252a3e11b46919e78a08b56967202f1d9` as Entry 48 —
confirms both sides attest the identical transcript.

**Result:** clean run, no protocol friction on the CELLO side. Doorbell continues to hold up
post-fix. Feedback item itself is tracked in Entry 48; no action taken here beyond logging it.

---

### 2026-07-07 — Entry 50: M8C-FIX-RUN CC-1 — operator-engagement-only contact promotion (security fix)

**First unit of the autonomous M8C-FIX-PLAN run.** cello-client `eae50fb`.

**What:** the inbound-accept path auto-added the requester to the contact whitelist on accept
(`daemon.ts`, right after `sendAwayResponse(...,"request")`). A stranger who knocked once became a
"known" Level-4 contact, which exempted them from BOTH the screening layer AND the ABUSE-1
acceptance caps (`checkUnknownSenderAcceptanceBound` exempts contacts). Confirmed live 2026-07-07
(test 3f: an unknown sender opened 4 sequential accepted sessions; mid-session Dispatched→AWAY
promotion). **Root:** one line conflated "accept the connection" with "trust the sender."

**Fix:** removed the accept-path auto-add. Promotion to "known" now requires operator engagement:
outbound `cello_initiate_session` (kept, `daemon.ts:3137`), the operator replying INTO the session
via `cello_send` (added — `addContact` on a committed send, past the read-before-write gate;
idempotent no-op for outbound), or explicit `cello_contact_add`. Unattended stranger never
auto-whitelisted. Ships the security-restoring gate now; the full D21 four-level model stays M9.

**Tests (teeth):** `m8c-contact-1` K3 — stranger stays unknown after knocking (inverts the old
`isContact===true`) + operator `cello_send` reply promotes them; `m8c-abuse-1` live-3f regression —
CAP+1 real sequential knocks from one unknown sender, the CAP+1'th refused with the specific
`abuse_bound_sessions_per_sender`, sender never auto-added. Full daemon gate green (632 tests,
lint/typecheck/build). `cello-unit-reviewer`: SPEC FAITHFUL / NO SILENT FALLBACKS / TESTS HAVE
TEETH; one LOW (a stale D6 comment at `daemon.ts:~973`) fixed before commit.

**Unblocks:** CONTACT-1/ABUSE-1 hardening + the D21 security floor. NOT yet published — batched into
the single end-of-run cello-client `/cello-publish` cascade with the rest of CC-*.

---

### 2026-07-07 — Entry 51: M8C-FIX-RUN OA-1 — registration token message named the wrong env var (cold-onboarding blocker)

**Second unit.** trustless-cello `4ce5cfe7`.

**What:** the registration-complete Telegram message told the user to "Set this as
CELLO_REGISTRATION_TOKEN on your agent" — an env var the CLI reads NOWHERE (it takes the token as a
positional arg `cello register <agent> <token>`, or via `CELLO_PREAUTH_TOKEN`). A brand-new user
following it literally was dead in the water. The message lived at TWO identical sites
(`state-machine.ts` primary completion + retry path) — cross-site string drift is the root-cause class.

**Fix:** one shared `#sendTokenDelivery(from, token)` helper called by both paths (drift now
structurally impossible). Delivery is TWO messages: ① runnable instructions with the token inlined
into the real `cello register [YOUR_NAME] <token>` command (+ `cello create-agent [YOUR_NAME]`,
`cello login` prereq, `cello status` verify); ② the bare token alone for one-tap copy. `[YOUR_NAME]`
uses square brackets deliberately — they fail the CLI name charset `^[a-zA-Z0-9_-]{1,64}$` (daemon.ts
enforces it on both create-agent and register), so a blind paste is cleanly rejected instead of
creating a junk agent. Telegram sends plain text (no parse_mode) → no backticks/fences. Also corrected
2 pre-existing docstrings that named the same dead env var (`pre-auth-token-repository.ts`,
`pre-authorization-client.ts`), surfaced by the reviewer — same drift source, "fix errors when found."

**Tests (teeth):** `engine.test.ts` AC-004 — instructions message exists, has NO
CELLO_REGISTRATION_TOKEN, contains the real command, and a bare-token message === the token; `m6b-016`
re-registration counts deliveries by the instructions marker (= 2), not raw token-bearing messages
(which would now be 4). Full ops-agent gate green (121 tests, lint/typecheck/build). Reviewer: SPEC
FAITHFUL / NO SILENT FALLBACKS / TESTS HAVE TEETH.

**Env note:** the running local Docker Postgres predated
`docker/postgres/initdb/01-dev-role-passwords.sql`, so the `cello_ops_agent` role had no matching
password and every ops-agent integration test failed on auth. Applied the initdb script's
`ALTER ROLE … PASSWORD …_dev` to the live container — ephemeral local state, not a repo/infra change.

**Unblocks:** cold onboarding (with OA-2 + CC-6/7/8). NOT yet redeployed — batched with OA-2 into ONE
us-east-1 ops-agent redeploy.

---

### 2026-07-07 — Entry 52: M8C-FIX-RUN CC-2 — register arms the standing receiver (fresh agent receivable without a restart)

**Third unit.** cello-client `e73c421`.

**What:** after `cello_register` succeeded, the new agent's standing receiver was NOT armed
(`standing_receiver_ready:false`) — it could not receive inbound until the operator restarted
(logout/login), so a brand-new registration looked broken. Confirmed live 2026-07-07 (CELLO_Feedback).

**Fix:** on the register success path (after the durable persist, before both success returns) call
`startAgentInternal(name)` — the SAME idempotent arm path `cello login` and `cello_use_agent` use
(onlineAgents + directory signaling + `ensureStandingReceiverForAgent` + `agent_state_changed`).
Register bringing the agent online is consistent with both of those auto-starting. An arm failure is a
warning (`registration.standing_receiver.arm_failed`), never fails the already-committed registration.

**Test — deferred to live (D22):** no daemon success-path unit test. The harness has no fake-directory
registration success (a real one needs the FROST DKG ceremony); faking it end-to-end would be a
forbidden from-scratch fixture for one wiring line. `startAgentInternal` is already covered by AUTOSTART-1
tests, so CC-2 adds only a call into tested code. Full daemon suite green (632). Enforcer = the live
register-then-receive smoke (register a fresh agent, receive with NO restart), batched to end-of-run.

**Reviewer:** SPEC FAITHFUL / NO SILENT FALLBACKS / TESTS HAVE TEETH. Verified `ctx.dispose()` in the
register `finally` does not tear down the just-armed signaling/SR (it only unregisters the reg-reply
router). One LOW (the success log `armed` was optimistic — the SR ensure is fire-and-forget) fixed by
renaming to `registration.standing_receiver.arm_initiated`.

**Unblocks:** AUTOSTART-1 / cold-onboarding LIVE-1 (fresh agent receivable immediately). NOT yet published
— batched into the single end-of-run cello-client `/cello-publish` cascade.

---

### 2026-07-07 — Entry 53: M8C-FIX-RUN OA-2 — onboarding copy overhaul (registration flow messages)

**Fourth unit.** trustless-cello `c1189f42`.

**What:** the full set of Telegram registration-flow copy fixes agreed while walking the flow — all
message-string changes in the ops-agent.
- **Item 1** (`engine.ts`): split the existing-account warning into TWO sends (explanation, then the
  CONFIRM instruction).
- **Item 2** (`state-machine.ts`): phone-ask gains a **directory-scoped** privacy note via shared
  `PHONE_PRIVACY_NOTE` const (new "Welcome to CELLO!", returning "Welcome back"). Claims only what the
  DIRECTORIES store (irreversible hashes), never "CELLO as a whole" — the portal recoverable-email model
  is preserved (D-PROMISE / [[project_no_pii_in_directory_hash_only]]).
- **Item 3** (`state-machine.ts`): email-ask branches on `expectedEmailStubHash` — returning users reuse
  their original email; new users get the plain ask. No email-prefix hint (D-PII: registration is
  hash-only).
- **O1**: the pre-auth server-error copy no longer claims "not something you can fix by retrying" — the
  record stays EMAIL_CONFIRMED and the next message triggers `#retryPreAuth` (state-machine.ts:177), so
  the honest message invites a retry (shared `PREAUTH_SERVER_ERROR_MSG` const). This corrected m6b-011
  AC-001, which enforced the false non-retryable premise — logged as **D23**.
- **O2/O3/O4**: standardized the 3 OTP-failure phrasings + stated the 15-min code lifetime; rate-limit
  message adds the 1-hour wait; email-continuity rejection explains the "same account = same email" why.

**Anti-drift:** the two strings that lived at two sites each (privacy note, pre-auth error) are now single
shared consts — the exact OA-1 root-cause class, structurally prevented.

**Tests:** `m6b-016` asserts the item-1 split as TWO DISTINCT sends (reviewer F1 teeth — a recombined
single message is now rejected) + the O4 continuity reject; `m6b-011` AC-001 corrected per **D23** (the
retry path at state-machine.ts:177 genuinely re-runs requestToken). Full ops-agent gate green (121 tests,
lint/typecheck/build).

**Reviewer:** SPEC FAITHFUL / NO SILENT FALLBACKS. Confirmed the privacy note does NOT over-claim
(D-PROMISE satisfied). One BLOCKING hollow-test finding (F1: the split test passed against a single
recombined message) — FIXED before commit (assert `explainMsg !== confirmMsg` + neither message contains
the other's marker).

**Env note (carried from Entry 51):** the local Docker Postgres dev-role passwords were re-applied to run
the ops-agent integration suite — ephemeral local state.

**Unblocks:** cold onboarding (with OA-1 + CC-6/7/8). NOT yet redeployed — batched with OA-1 into ONE
us-east-1 ops-agent redeploy at end of run.

---

### 2026-07-07 — Entry 54: M8C-FIX-RUN CC-3 — F18 sole-online auto-select on the session-action tools

**Fifth unit.** cello-client `da28e12`.

**What:** F18's `resolveCurrentAgent` (explicit `{name}` > this connection's current > sole online agent)
was wired into the receive/inbox tools but NOT the session-action tools, which hard-failed
`no_current_agent` even with exactly one agent online — forcing an explicit `cello_use_agent` on every
cold start / after a `/mcp` reconnect (agent-surfaced live: Ms_Chelly→CELLO_Feedback).

**Fix:** routed all 8 through `resolveCurrentAgent` and threaded the resolved `agentName` downstream
(replacing each handler's later `connState.currentAgent` reads): `cello_initiate_session`,
`cello_close_session`, `cello_get_sealed_receipt`, `cello_get_transcript`, `cello_list_sessions`,
`cello_await_session`, `cello_send`, and `handleReceive` (registered as `cello_receive` +
`cello_receive_session`). The send/close ownership checks (`getSessionRecord(agentName,…)` +
`record.agent_name !== agentName`) are preserved, so a resolved agent that doesn't own a session still
gets `session_not_found`/`session_not_owned`. `cello_status` and the dead empty `SESSION_TOOLS_REQUIRING_
AGENT` stub loop were left untouched. **2+ online with none selected still returns `no_current_agent`** —
it refuses to guess between peers (misroute risk), the correct fail-fast.

**Tests (teeth):** sole-online resolves where pre-CC-3 it returned `no_current_agent`;
2-online-none-selected stays `no_current_agent`; explicit `{name}` PINS that agent (a bob-owned session
is visible under `{name:bob}`, invisible under `{name:alice}` — proves selection, not mere non-failure).
Existing AC-007 guard tests still pass (`setupWithAgents` brings 0 agents online → resolver returns null).
Daemon suite green (635), lint/typecheck/build.

**Reviewer:** SPEC FAITHFUL / NO SILENT FALLBACKS / TESTS HAVE TEETH. Confirmed no handler dereferences
`connState` post-resolve (no NPE with undefined connState + explicit name), and the ambiguous branch fails
loud. One LOW test-hardening (explicit-name test asserted only non-failure) — APPLIED (now pins the
selected agent).

**Unblocks:** the `no_current_agent` cold-start papercut for single-agent operators. NOT yet published —
batched into the single end-of-run cello-client `/cello-publish` cascade.

---

### 2026-07-07 — Entry 55: M8C-FIX-RUN CC-6/7/8 — CLI onboarding legibility cluster

**Sixth unit (3 fixes, one cluster).** cello-client `f486e32`.

- **CC-6** (`core/cli/src/commands.ts`): the `register` success "Next: run cello status…" guidance was one
  dense run-on line → a heading + three bulleted cues. Cues aligned to REAL `cello status` output (agent
  `state: online` + `directory_signaling: connected`) per a reviewer LOW — the old "connecting/connected"
  words never appeared in the actual output.
- **CC-7** (`core/cli/src/cli-args.ts`): top-level `cello --help` was a bare command list → now opens with
  what CELLO is + the first-time onboarding path (login → create-agent → register → status), then the full
  command list + per-command pointer (DOD-ONBOARD-HELP-1; the per-command half was already good).
- **CC-8** (`core/daemon/src/daemon.ts` `getStatus`): the CLI `cello status` (calls the `"status"` IPC
  method → `getStatus()`, daemon-wide) showed every agent as `state: "registered"` even when online,
  because `getStatus` spread the stale stored `agents[].state` (`startAgentInternal` only adds to
  `onlineAgents`, never mutates the record). Fixed `getStatus` to DERIVE state from `onlineAgents`
  (`online ? "online" : "registered"`), preserving `load_failed` (a broken agent stays visibly broken).
  Matches the MCP `getAgentsForConnection` F5 surface. **Connection-independent** → the
  `handle.getStatus() == IPC "status"` equality (daemon.test.ts) holds. `selected` is intentionally NOT
  added to the daemon-wide surface (per-connection concept; the CLI opens an ephemeral connection that
  never selects) — **D24**.

**Tests (teeth):** CC-7 asserts the onboarding-path ORDER in `USAGE` (a bare/reversed list fails); CC-8
asserts offline→`registered` then online→`online` over a real IPC start (inverts pre-CC-8). CC-6's
success output is copy-only in a branch needing the full directory/DKG ceremony (D22-class) —
live-verified, not unit-tested. Daemon suite green (636), CLI green (30), lint/typecheck/build.

**Reviewer:** SPEC FAITHFUL / NO SILENT FALLBACKS / TESTS HAVE TEETH. No HIGH/MEDIUM. One non-blocking LOW
(CC-6 cues vs real output) — FIXED (amended into the commit) before push.

**Unblocks:** cold-onboarding legibility (with OA-1/OA-2). NOT yet published — batched into the single
end-of-run cello-client `/cello-publish` cascade.

---

### 2026-07-07 — Entry 56: M8C-FIX-RUN CC-9 — expose contact management as MCP tools (last 🟠)

**Seventh unit.** cello-client `d9c5569`.

**What:** the daemon has `cello_contact_add/remove/list` handlers, but the connect shim never forwarded
them — so an agent driving via MCP couldn't see or manage its own contact whitelist (CLI-only,
`cello contact …`). That whitelist is load-bearing after CC-1/D21: a known contact is fast-tracked and
exempt from unknown-sender screening + the ABUSE-1 acceptance caps, so an MCP-only operator had no way to
grant/revoke trust.

**Fix:** three `server.tool(...)` registrations in `bin/cello-mcp.ts` forwarding via `proxy.call`, mirroring
the ~20 sibling bin tools. Params match the daemon handlers EXACTLY: `pubkey` (required on add/remove) +
optional `agent` (list/add/remove), omitted when absent so the daemon's `resolveContactAgent` falls back to
the current/sole-online agent. No current agent → daemon returns `no_current_agent` with actionable
guidance (fails loud, no empty-list mask).

**Test — none at the shim (justified):** `bin/cello-mcp.ts` does a top-level `await proxy.connect()` at
import, so it's untestable in isolation — the same reason none of the ~20 sibling bin tools are shim-tested.
The underlying handlers are covered by `m8c-contact-1.test.ts` (add/remove/list, INSERT-OR-IGNORE, per-agent,
`added_at` pinning). Full connect suite green (108, incl. the subprocess-startup test that spawns the bin);
typecheck/lint/build clean. Enforcer = live `/mcp` reconnect + invoke, batched to the end-of-run stop.

**Reviewer:** SPEC FAITHFUL / NO SILENT FALLBACKS / TESTS HAVE TEETH (no test justified by the
untestable-at-import shim boundary + daemon-layer coverage). No findings.

**Milestone marker:** with CC-9, ALL 🔴 (CC-1, OA-1, CC-2) and ALL 🟠 (OA-2, CC-3, CC-6, CC-7, CC-8, CC-9)
fixes are DONE + reviewed + committed + pushed. Remaining: 🟢 CC-4 (drop empty `connections`) + CC-5 (F21
full), then the batched ship (ONE cello-client publish cascade + ONE ops-agent redeploy) and the live stop.

**Unblocks:** MCP-driven whitelist management. NOT yet published — batched into the single end-of-run
cello-client `/cello-publish` cascade.

---

### 2026-07-07 — Entry 57: M8C-FIX-RUN CC-4 — drop the always-empty `connections` status stub (+ CC-6 test repair)

**Eighth unit.** cello-client `5deef4b`.

**What:** the `connections` field in the daemon status response was an always-empty stub
(`const connections: ConnectionInfo[] = []`, "until connection validation is wired" — the F9
connected-client-visibility feature that was never built). An empty placeholder conveys nothing and
reads as a mock. Dropped it from both status surfaces (`getStatus` daemon-wide + the `cello_status` MCP
handler), from `DaemonStatusResponse`, plus the now-unused `ConnectionInfo` import. Kept the
`ConnectionInfo` interface exported (types.ts + index.ts) as the shape F9 will populate later; per-connection
state still lives in `perConnectionState`. Real client-visibility (F9) is a future fast-follow.

**Tests:** AC-019 now asserts `cello_status` does NOT have `connections` (teeth: re-adding the empty field
fails it); removed the connections assertions + the obsolete "connections are empty" test.

**CC-6 regression repaired (caught here):** the CC-6 amend in `f486e32` (already pushed) changed the
register success guidance copy per a reviewer note, but the amend was gated with `eslint` only, not the
CLI vitest suite — so the MOCKED register-success test (`commands.test.ts`, drives success via a fake
daemon socket) that asserted the old `.toContain("connecting")` shipped RED. CC-4's full gate run caught
it; fixed to assert the new ready-state cue `online` (+ keeps connected / cello status / cello login).
This also corrects an earlier wrong claim: CC-6's success output IS unit-tested (via the socket mock), not
ceremony-gated. Reviewer confirmed no other test asserts the old copy — the `f486e32` red is fully
resolved. **Lesson: run the actual test suite (not just lint) after a copy amend, even a "trivial" one.**

**Reviewer:** SPEC FAITHFUL / NO SILENT FALLBACKS / TESTS HAVE TEETH. No findings above bar (stub-deletion
diff, no danger zones). Daemon 635 / CLI 30 green, lint/typecheck/build.

**Remaining:** only **CC-5** (F21 full, design-significant) then the batched ship + live stop.

---

### 2026-07-07 — Entry 58: M8C-FIX-RUN CC-5 — F21 half-open sessions — DESIGN NOTE (§6, before code)

**Ninth/last unit. Design-significant → design note first (PROCEDURE §6).**

**Producer/consumer map (evidence-based):**
- The standing receiver's `acceptInboundAssignment` creates a durable **`active`** session from an inbound
  offer — even when the initiator ABANDONED (its `initiate_session` returned `counterparty_unavailable`,
  so the initiator holds nothing). The unattended agent auto-sends `"Dispatched."` via `sendAwayResponse`
  → `appendSessionLeaf` (daemon.ts:989) → **`message_count` becomes ≥ 1** (its own SENT ack).
- The counterparty never establishes → `getSessionLiveness` stays `"unknown"` (or `"gone"`). The session
  stays `active` forever → `classifySession("active", ·) = "open"` → it clutters `cello status` and
  `buildActiveSessions` (which queries status `active`).
- Closing it hits the **active branch** of `cello_close_session` (daemon.ts:3279), which fires the
  **bilateral seal** (submit SEAL leaf → await `session_sealed` → bilateral timeout → unilateral escalation
  needing directory grace). The absent/rejecting counterparty can't complete it →
  `seal_interrupted_rejected_by_counterparty` (live) / timeout → **stuck, no terminal escape.**

**KEY DISCOVERY (invalidates the directive's literal wording):** the ghost has **`message_count ≥ 1`**
(the auto-`Dispatched.` leaf), so the directive's literal "reap **messageCount:0** half-open sessions"
would **MISS the real ghost**. The correct half-open signal is **"counterparty never established"**:
`getSessionLiveness !== "alive"` AND **0 RECEIVED** messages (the counterparty never sent anything) AND
age past a grace TTL. (message_count counts our own sent ack; RECEIVED-count is the right discriminator.)

**Design — both locked halves, corrected, ADDITIVE (no change to the existing seal flow):**
- **New terminal status `"abandoned"`** (`SessionStatus` union + `classifySession` → `"closed"`). Small
  blast radius: the ~19 `=== "active"/"interrupted"/"sealed"` switch sites naturally exclude it;
  `getSessionsByStatus("active")` stops surfacing it; `classifySession` maps it to a terminal bucket so it
  drops out of the `open` list.
- **(b) terminal-escape** → `cello_close_session` gains `{ force: true }`: an additive **early branch**
  (BEFORE the bilateral-seal branches) that retires the session node + sets status `"abandoned"` + returns
  a surfaced reason. Works regardless of `message_count` (the seal-rejected ghost has ≥1). Also exposed on
  the connect shim (add `force` to the `cello_close_session` tool).
- **(a) don't-strand** → **REAP-ON-READ** (chosen over the protocol-handshake option: it matches the
  codebase's compute-on-read expiry pattern — `reapExpiredInboundSessions`, daemon.ts:4184 "no background
  sweep needed" — and is additive). `reapDeadHalfOpenSessions(agent)` runs on the `cello_list_sessions`
  read: for each `active` session with **0 RECEIVED** messages AND `getSessionLiveness !== "alive"` AND
  age > `HALF_OPEN_TTL_MS` → retire node + set `"abandoned"`. Needs a `countReceivedMessages(agent, sid)`
  snm helper (mirrors the existing `direction = 'received'` queries at snm:841/886).

**Safety invariants (SIs) the tests must enforce:**
- A LIVE or FRESH active session is NEVER reaped: `getSessionLiveness === "alive"`, OR any RECEIVED
  message, OR age ≤ TTL → survives (a genuine just-opened session must not be abandoned).
- `force` is idempotent and owner-scoped (only the owning agent, via the existing agent-scoped lookup).
- An `"abandoned"` session never re-enters `open`/`active` and cannot be re-sealed.

**Enforcer:** unit tests (reap abandons a dead half-open on read; a live/fresh active survives; `force`
abandons a stuck session and drops it from `open`) + the live F21 re-run (open a session to an offline
agent, then confirm the receiver's ghost is reaped/force-abandonable) at the batched verification stop.

**Chosen (a)=reap-on-read, (b)=force param — logged as [[M8C-DECISIONS|D25]].** Implementing next.

---

### 2026-07-07 — Entry 59: M8C-FIX-RUN CC-5 — F21 implemented (force-abandon + reap) — ALL FIX ITEMS DONE

**Ninth/last unit — implemented.** cello-client `146ac74` (impl) + `cc4e5ce` (reviewer follow-up).

**Implemented exactly per the Entry-58 design / D25:**
- New terminal `SessionStatus` `"abandoned"` (`classifySession` → `"failed"`; drops from open + active
  surfaces; the ~19 specific-status `===` checks exclude it; `getSessionsByStatus` never queries it).
- **(b) terminal-escape:** `cello_close_session { force: true }` — additive early branch BEFORE the seal
  branches → `sessionNodeManager.abandonSession` (retire node + set `"abandoned"`, no bilateral seal),
  owner-scoped + idempotent (already-abandoned → `already_abandoned` no-op), surfaced `force_abandoned`
  reason. Exposed on the connect shim (`cello_close_session` gains optional `force`).
- **(a) don't-strand — reap-on-read:** `reapDeadHalfOpenSessions` runs on `buildActiveSessions` (both
  status surfaces) + `cello_list_sessions`; abandons an `active` session that is provably dead —
  **0 RECEIVED** (`countReceivedMessages`, NOT `message_count` which counts the agent's own `Dispatched.`
  ack) AND `getSessionLiveness !== "alive"` AND age > `HALF_OPEN_TTL_MS` (5min, env-overridable).
  `abandonSession` flips the DB status synchronously before its async node teardown, so a non-awaited
  reap is visible to the same read (reviewer confirmed the ordering holds — no read-before-write race).

**Reviewer (extra rigor on over-reaping + sync-flip):** SPEC FAITHFUL / NO SILENT FALLBACKS. Verified:
sync-flip ordering holds; mid-loop mutation safe (`getSessionsByStatus` returns a materialized array);
predicate AND-semantics correct; a normal (non-force) close on an `abandoned` session → `session_not_closeable`
(no seal, no re-abandon); reaper `.catch` fails loud (warn) without breaking the read path. **One BLOCKING
hollow-test (F-1):** the `liveness === "alive"` gate had zero teeth (deleting it failed no test) — FIXED in
`cc4e5ce`: added `markSessionLivenessForTest` seam (getDb-style) + a 5th test where an OLD, 0-received,
LIVE session must survive (the sole case where age+received both point to reap, so it now pins the gate).
**One LOW (F-2):** `#updateSessionStatus` logged every failure as `session.interrupt.db.write.failed` though
it now writes `"abandoned"` too — renamed to `session.status.write.failed` + status in context.

**Tests (teeth):** reap fires on `message_count=1` + 0-received (proves the criterion is 0-RECEIVED, not
msgCount-0 — a msgCount-based reaper would MISS the real ghost); `force` drops from `open` → `--all`
`abandoned`; three SIs block over-reaping (young survives; old-with-received survives; old-0-received-LIVE
survives). Daemon 640 / connect 108 green, lint/typecheck/build.

**Enforcer still owed:** the live F21 re-run (open a session to an offline agent, confirm the receiver's
ghost is reaped after the grace / force-abandonable) at the batched verification stop.

---

## 🏁 ALL M8C-FIX-RUN ITEMS COMPLETE

CC-1, OA-1, CC-2 (🔴) · OA-2, CC-3, CC-6, CC-7, CC-8, CC-9 (🟠) · CC-4, CC-5 (🟢) — all implemented,
gated, `cello-unit-reviewer`-passed, committed, pushed. Deferred by directive: SEC-2/DIR-1 (coordinated
rollout + Andre's severity call) and the full D21 model (M9). **Remaining run work = the BATCHED SHIP +
the two legitimate stops** (see the FIX-PLAN ▶ RESUME STATE): ONE `/cello-publish` cascade (daemon
0.0.34→35, cli 0.0.31→32, connect 0.0.60→61) → beta + verify the binary; ONE us-east-1 ops-agent redeploy
(OA-1+OA-2); THEN stop for `latest`-tag promotion (Andre's go) and the live `/mcp`-reconnect + two-agent
verification (F21 reap/force + cold onboarding).

---

### 2026-07-08 — Entry 60: CC-10 — dead INTERRUPTED ghosts permanently ate the abuse budget (live A/B Phase-2 block)

**Found live, not by tests.** A/B Phase 2 (CC-1 screening) blocked: Ms_Chelly's fresh knock at
CELLO_Support was rejected `abuse_bound_sessions_per_sender` even after Phase 1's force-abandon.
Root cause (from source, not logs): the per-sender cap is a live DB query counting
`('active','interrupted')` — deliberate, D18 — but the CC-5 reaper only scanned `'active'`
(`daemon.ts:1758`), and `classifySession(interrupted, 0)` → `"failed"` hides such sessions from
every list. The daemon-restart event had flipped 4 dead half-opens from Ms_Chelly to `interrupted`:
invisible, unreapable, uncloseable-by-eye, each counting against her cap of 3 **forever**. A
stranger whose first 3 handshakes die is silently locked out of that operator permanently — a
"can't connect" failure. Full diagnosis: [[M8C-LIVE-AB-TEST-PROTOCOL]] § PHASE 2 BLOCK.

**Unblock (live state):** the 4 ghosts (`e3384957…`, `a2359c8b…`, `42bb8a07…`, `96dc658c…`)
force-abandoned by full ID over daemon IPC (`ipc.connect` → `cello_use_agent CELLO_Support` →
`cello_close_session { force: true }` ×4, all `ok:true`); `dd7493…` untouched. Count now 1/3 —
Phase 2 re-runs on the current binary.

**Fix (cello-client `79030e3`, TDD red→green):**
- `reapDeadHalfOpenSessions` scans **both** `('active','interrupted')`; every gate unchanged
  (age > TTL on `created_at`, liveness ≠ `alive`, **0 RECEIVED**). Reap event gains `priorStatus`.
- `acceptInboundAssignment` reaps for the agent **before** `checkUnknownSenderAcceptanceBound` —
  admission sees reaped-clean state without waiting for someone to read a list
  (`abandonSession`'s status flip is synchronous pre-await, so the same-tick bound query sees it).
- **D18 preserved and pinned by test:** the disconnect-evasion attacker's sessions carry received
  content and are never reaped (CC-10/D18 guard: cap'd interrupted sessions WITH received rows →
  knock still refused, rows still `interrupted`).
- Reviewer (SPEC FAITHFUL / NO SILENT FALLBACKS / TESTS HAVE TEETH), all 3 findings fixed:
  `priorStatus` asserted; `session.half_open.reaped` now logged **only if** the status write
  actually landed (`abandonSession` → `Promise<boolean>`); MEDIUM residual journaled as **D26**.

**Gate:** 1771 passed / lint / typecheck / build clean. **Ship:** held for the ONE batched
post-A/B-run cascade (per D26 note in [[M8C-DECISIONS]] / the fix decision in the protocol doc) —
publishing mid-run restarts the daemon, which is exactly the event that mints these ghosts.

---

### 2026-07-08 — Entry 61: 🏁 M8C FIX RUN CLOSED — CC-10 shipped (v0.0.82), promoted to `latest`, all 5 A/B phases PASS

**Ship (v0.0.82).** CC-10 cascade: daemon 0.0.35→**0.0.36**, cli 0.0.32→**0.0.33** (connect unchanged at
0.0.61 — it doesn't depend on daemon). Version bump cc `a963737`, tag `v0.0.82`, CI green incl. smoke-tag.
Binary-verified against the tarball AND the installed running daemon dist (reaper scans `interrupted`,
reap-before-bound call, `abandonSession` returns write outcome). Promoted all 7 to `latest` with Andre's go
(daemon+cli needed npm OTP browser-auth; other 5 already `latest`). Verified `npm view @latest`: cli 0.0.33 /
daemon 0.0.36 / connect 0.0.61. Andre reinstalled cli+connect@latest, `cello login` (4 agents online),
reconnected MCP.

**Live verification — all 5 A/B phases PASS** ([[M8C-LIVE-AB-TEST-PROTOCOL]]):
- Phase 0 ✅ sanity + new shim (CC-2/4/8/9) · Phase 1 ✅ force-abandon the F21 ghost (CC-5)
- Phase 2 ✅ **re-run after CC-10** — the abuse-cap ghost block is gone; stranger stays unknown on knock,
  promotes only on Support's reply (CC-1) · Phase 3 ✅ full convo/doorbell/read-before-write/seal vs Feedback
- Phase 4 ✅ cold onboarding (OA-1/OA-2/CC-2/6/7/8) — with the email-recovery papercut logged for triage.

**Two post-launch follow-ups logged (NOT blocking, in [[M8C-FIX-PLAN]] RESUME STATE):** (1) Phase-4
email-recovery papercut (no on-file-email match-check before OTP dispatch; no escape from OTP-entry but
burning 3 attempts; `/start` swallowed as a wrong-code guess); (2) initiator-side rejection-signal gap
(`cello_initiate_session` returns `ok:true` even when the receiver silently rejects — visible only in the
daemon log). Both need a severity call before story-writing.

**M8C fix run is closed.** 11 directive fixes + CC-10, all committed/reviewed/shipped/promoted/live-verified.
Deferred by directive (unchanged): SEC-2/DIR-1, full D21 model.

---

### 2026-07-08 — Entry 62: HERMES-001 — CELLO drives a second, non-Claude-Code runtime (Hermes Agent), live-proven

**Why.** The launch intent's #1 value is "two agents connect across devices, incl. one you don't control";
that needs CELLO working on a runtime OTHER than Claude Code. Hermes Agent is that runtime. Zero PRs to
hermes-agent — everything rides its public extension surfaces.

**Shipped (cello-client `30506b6` + review fixes `b4a1c12`, in cli 0.0.34).** `cello install hermes
--agent <name>` scaffolds a CELLO **platform adapter** (a pure-stdlib Python asyncio client speaking the
daemon's Unix-socket IPC directly — `ipc.connect` → `cello_use_agent` → content-free wake injection on
`session_state_changed`/`cello_message`, single-flight reconnect), registers **cello-mcp** as a Hermes MCP
server (the 18 `cello_*` commands), drops the `cello-bridge-setup` skill, and binds `CELLO_AGENT_NAME`.
Raft-precedent shape but simpler (no subprocess/HTTP hop/bridge-token — there's no process boundary to
cross). Two live-run discoveries fixed: `hermes mcp add` cancels on stdin EOF while exiting 0 (installer
now answers `Y` and VERIFIES against `hermes mcp list`); + two adapter reconnect-lifecycle fixes. 13 tests,
gates green on the CLI package.

**Live-proven (same daemon):** install → gateway restart → adapter bound → Ms_Chelly (Claude Code) initiated
+ sent → wake injected into the Hermes gateway → the Hermes agent read via `cello_receive` and replied via
`cello_send` on the first attempt; a "no reply needed" ack proved the `[SILENT]` suppression path. This is
DOD-HERMES-1 (second-runtime leg). DOD-HERMES-2 (off-device via the AWS Hermes box) is the remaining
cross-machine proof — gated only on installing the bridge there (post-publish). Design + record:
[[2026-07-09_1915_hermes-agent-integration-plan]] §6.

### 2026-07-08 — Entry 63: 🔒 SEC-2 FIXED — FROST-signing forgery hole closed, rolled out to `latest`, directory deployed, live-proven

**The fix (both halves).** Client: every FROST commit/sign request now carries a K_local Ed25519 `authSig`
bound to `(agentPubkey, epochId, framedMsg)`, threaded through all ceremony paths (cello-client `d744778`,
review follow-up `9971769` — domain-separate commit vs sign, `0x00` vs `0x01||msg`). Directory: verifies
that `authSig` before touching its share — missing → `AUTH_REQUIRED`, invalid → `AUTH_INVALID`
(trustless-cello `1d730260`, review follow-up `d9202913` — reject non-bytes authSig, MEDIUM DoS). Reviewer:
forgery closed, SPEC FAITHFUL / TESTS HAVE TEETH.

**Rollout (the migration hazard, handled by ORDER).** SEC-2 was cross-repo and hot-path: enforcing on the
directory before clients send authSig would reject EVERY agent. So: (1) publish client cascade — daemon
0.0.36→**0.0.37**, cli 0.0.33→**0.0.34** (cli cross-pins real daemon 0.0.37; connect unchanged 0.0.61),
tag `v0.0.83`, CI green incl. smoke-tag, binary-verified in the tarball; (2) promote all 7 to `latest`
(only daemon+cli moved); (3) fix a stale-packument install trap (`npm i -g @latest` served old 0.0.33/0.0.36
until `npm cache clean --force`), then `cello logout`/`login` onto daemon 0.0.37 (4 agents online); (4) THEN
push+deploy the directory enforcement via `cello-directory-pipeline` (revision `0e1ed768`, all 3 regions).
EC2 demo agent is a known laggard, accepted.

**Live proof (against the enforcing directory).** Two real CELLO_Support↔Ms_Chelly sessions ESTABLISHED and
SEALED bilaterally — `sealed_root 812c6e39ea0afaf0f80dc08070fbf6c01e48b2977532a2d053533df2f464dca9`, both
parties `attestation_mode: live`. Session-establishment and seal ceremonies both pass enforcement;
legitimate agents work, public-key-only forgery is rejected. SEC-2 → ✅ (DoD + ledger flipped). Also
unblocks DOD-PRIMARY-1's ceremony-gate at the auth foundation (D20).

---

### 2026-07-09 — Entry 64: ⚠️ CORRECTION to Entry 63 — the SEC-2 live seals prove NO REGRESSION, not enforcement

**Entry 63 overclaimed and this entry corrects it (append-only: 63 stands as written; this supersedes its
proof claim).** Entry 63 stated the SEC-2 fix was "live-proven ... legitimate agents work, public-key-only
forgery is rejected." **The rejection half was never demonstrated live.**

**Who caught it.** `CELLO_Support`, in live session `12f882885d3dde599dade23627195eac` (sealed
`cf5ddb57b57eccfb7428fa49f449b89deb692180f7ed2ecdd9e848844aa028d8`, both parties `live`), when Ms_Chelly
opened with "this message reaching you already proves establishment passed the enforcing directory." Its
reply, verbatim in substance: *"A directory with enforcement switched off entirely would produce this
identical transcript. If we treat this as proof of enforcement, we have built ourselves a test that cannot
fail, which is the same as no test."* Correct, and conceded.

**The precise error.** Not a bad test — a **true observation labelled with a stronger claim than it
supports**. Five green bilateral seals attest exactly one thing: *the SEC-2 change did not break the
legitimate path.* No regression. Nothing whatsoever about rejection. Positive-only evidence cannot
discriminate enforcement-ON from enforcement-OFF. This class of error is the hardest to catch later
precisely because nothing looks broken.

**A second, deeper gap surfaced by the same challenge.** The phrase "the enforcing directory" was doing
load-bearing work in a sentence where nobody had checked it — the deploy pipeline had been left
`InProgress` and never confirmed. **Now confirmed as an observation:** `cello-directory-pipeline` execution
on rev `0e1ed768` reports `Succeeded` (all 3 regions). The deployed directory *is* running the SEC-2 build.
Had the negative case been run before that check, a "rejection" could have come from a directory not running
the new code at all — the negative case would have inherited the same defect.

**Open item, stated plainly (the ONLY thing that proves enforcement):** issue a FROST commit/sign request
with a missing or invalid `authSig` against the deployed directory, and confirm `AUTH_REQUIRED` /
`AUTH_INVALID` **in the directory's own logs**. Until that runs, enforcement is proven by unit/integration
tests only (`sec-2-frost-auth.test.ts` + directory-side tests) and is **UNPROVEN in production**.

DoD, ledger (C2 + table row), and the journal banner corrected accordingly. SEC-2 status is now
**✅ fixed + deployed / 🟡 enforcement not live-verified**, not ✅ across the board.

---

### 2026-07-09 — Entry 65: MONIKER-0 — give the charset a single home (unit start, clause checklist)

**Target (one sentence):** One exported `MONIKER_RE` + `validateMoniker` in `core/protocol-types`,
every existing copy of the agent-name rule repointed at it, behaviour byte-identical, with the named
reject battery + strip-oracle regression pinned once on that module.

**Provenance:** spec at [[M8C-MONIKER-SPEC]] §MONIKER-0 (commits `aca5f0f8` + `a28d8289`), finding
originated by CELLO_Support in live session `30b5b208c68c5779fcb692be1252f762` (sealed
`2a162674b52183e0e00cc10afa61f585e42519fc0fa3de281bd54d8eacfa8300`): the spec's original "reuse the
validator create-agent already enforces" named a validator that does not exist — the rule lives as
four unsynchronised copies (daemon.ts:1941, daemon.ts:2048 inline literals; cli-args.ts:53 prose;
cli-args.test.ts:70 hand-typed twin). Since the charset is the entire injection defense for the
moniker work, MONIKER-1..5 must import one object, not add copies five and six.

**Clause checklist (DOD-MONIKER-0 + AC1–AC4):**
- [ ] AC1a — `MONIKER_RE` + `validateMoniker(raw): string | null` exported from `core/protocol-types` (new `moniker.ts`, exported via `index.ts`)
- [ ] AC1b — regex byte-identical to the two existing literals (`/^[a-zA-Z0-9_-]{1,64}$/`); no widening/narrowing
- [ ] AC1c — `cli` gains a direct `@cello-protocol/protocol-types` dep (daemon already has one)
- [ ] AC1d — existing agent-name tests pass **unmodified** (behaviour-preservation proof)
- [ ] AC2a — daemon.ts:1941 (`cello_create_agent`) repointed at the shared validator
- [ ] AC2b — daemon.ts:2048 (`cello_remove_agent`) repointed at the shared validator
- [ ] AC2c — cli-args.ts:53 help prose derives the regex text from the constant (`MONIKER_RE.source`), not a hand-typed string
- [ ] AC2d — cli-args.test.ts asserts the help text against the constant itself; independent copies: zero
- [ ] AC3a — named reject battery on the module, each an individual assertion: newline, carriage return, tab, other control chars, `"`, `'`, `(`, `)`, space, non-ASCII, 65 chars, empty
- [ ] AC3b — strip-oracle regression: an invalid name is rejected (`null`), never repaired into a valid one (`C*E*L*L*O*_*S*u*p*p*o*r*t` → `null`, not `CELLO_Support`)
- [ ] AC4 — ONE constant shared by agent names and monikers; no second regex introduced anywhere

**Falsification pass (procedure step 3):**
- Call sites have access? Yes — daemon already imports from `@cello-protocol/protocol-types`
  (workspace dep confirmed in `core/daemon/package.json`); cli adds the workspace dep (in-workspace
  `workspace:*` is correct here — the pinned-semver rule is for trustless-cello references only).
- Responsibility lives here? Yes — protocol-types is a leaf; the moniker crosses the wire on the
  offer frame (MONIKER-2), making the charset a wire contract, which is what protocol-types holds.
- Redundancy? None created — the two daemon literals are deleted, the help prose becomes derived.
- What else breaks? `helpForCommand` output must stay byte-identical (interpolating `MONIKER_RE.source`
  yields the same characters as the current hand-typed prose — verified by eye, pinned by the
  unmodified existing test). Error `reason: "invalid_agent_name"` and guidance strings unchanged.

**Plan:** red tests first (`core/protocol-types/src/__tests__/moniker.test.ts` — battery + strip-oracle,
red because the module doesn't exist), then implement, repoint the three sites, gates
(`pnpm run test` → `lint` → `typecheck` → `build`), `cello-unit-reviewer` on the diff, flip
DOD-MONIKER-0 in the spec, close the entry.

**CLOSED ✅ (2026-07-09).** All clauses checked. Evidence:
- Red first: moniker.test.ts failed on missing module; then 27 tests green (accept battery, named
  reject battery — newline/CR/tab/NUL/ESC/DEL/quotes/parens/space/homoglyphs/markup/65-chars/empty,
  each an individual `it()` — strip-oracle regression, non-string inputs).
- Implementation: cello-client `aba17df` — `moniker.ts` in protocol-types, both daemon sites and the
  CLI help repointed, cli gains the workspace dep. Sweep shows ZERO copies of the charset outside the
  module. Gates: 1814 tests green, lint/typecheck/build clean; agent-name tests untouched
  (persist-002-create-agent.test.ts unmodified — behaviour-preservation proof).
- **Journaled deviation (AC2 letter):** the test derives from `MONIKER_RE.source`, not `.toString()`.
  toString carries surrounding slashes, which are not part of the pattern text; asserting it would have
  forced slashes into the user-visible help prose, violating AC1's byte-identical constraint. `.source`
  satisfies both clauses; intent (zero independent copies, prose derived from the constant) fully met.
- Review: `cello-unit-reviewer` on `aba17df` — verdict **FAITHFUL / no silent fallbacks / tests have
  teeth**, zero blocking findings; per-clause verdicts all implemented (AC2c/d "deviated — acceptable",
  judged correctly resolved). Both non-blocking suggestions taken in `b771a86`: (1) 128-codepoint ASCII
  equivalence sweep proving `validateMoniker` and `MONIKER_RE` are one rule (kills the second-internal-
  regex drift bypass); (2) daemon `invalid_agent_name` guidance strings now interpolate
  `MONIKER_RE.source`. Re-ran all four gates after fixes: 1815 tests green.
- DOD-MONIKER-0 flipped ✅ in [[M8C-MONIKER-SPEC]] §9. Source-level line — no live enforcer required;
  publish rides the tier's batched cascade (PROCEDURE §2a). **Next red: DOD-MONIKER-1.**

---

### 2026-07-09 — Entry 66: MONIKER-1 — outbound name (unit start, clause checklist)

**Target (one sentence):** An agent's outbound name defaults to its agent name, with an optional
per-agent override persisted as a nullable column on the agents table, settable via
`cello_set_moniker` (daemon) / `cello moniker set` (CLI), validated at set-time, and never sent to
the directory.

**Clause checklist (DOD-MONIKER-1 + AC1–AC4):**
- [ ] AC1 — outbound name defaults to the agent name; no separate "self-moniker" concept
  (`getOutboundName(agentName)` = override ?? agent_name)
- [ ] AC2a — nullable `moniker TEXT` column on the **agents** table (NOT the config store — D14):
  added to `CREATE_AGENTS_SQL` + PRAGMA-guarded additive ALTER in `ensureIdentitySchema`
- [ ] AC2b — migration guard is an INDEPENDENT `if`, not chained `else if` — an old table missing
  both `frost_directory_node_ids` and `moniker` must receive BOTH ALTERs (the existing chain would
  apply only the first)
- [ ] AC2c — migration idempotent on a populated DB; existing rows → NULL; second run no-throw
- [ ] AC2d — `cello_set_moniker` daemon handler (set + clear via explicit null); shim forwards only
  (D7 — no logic in cello-mcp.ts); `cello moniker set <name> [--agent]` in the CLI
- [ ] AC3a — set-time validation via the shared `validateMoniker` (MONIKER-0); invalid → clean
  `invalid_moniker` error, value never stored; store-level backstop throws on invalid write
- [ ] AC3b — offer construction re-validates and omits rather than sending a bad value — DEFERRED to
  MONIKER-2 (offer construction does not exist yet; journaled here so it is not lost)
- [ ] AC4 — the name is local: registration path untouched; no directory payload gains the field
- [ ] OBS — `agent.moniker.set` (info) `{agentName}` on success (domain.noun.verb; no raw-value
  logging beyond the validated name, which is by construction display-safe)

**Falsification pass:**
- Call sites have access? `daemon.ts` already imports `validateMoniker` (MONIKER-0); handler pattern
  matches `cello_contact_add` (per-connection agent resolution). Store methods live beside
  `createAgent`/`retireAgent` in `DbIdentityStore` — same class, same DB handle.
- Responsibility? Persistence in the store, validation at the handler (operator-facing error) with a
  store-level throw as backstop — matches "an invalid value can never be stored" at the lowest layer.
- Redundancy? The default (agent name) is NOT stored — it is resolved at read time
  (override ?? agent_name), so renames and the no-override case can't drift.
- What breaks? Nothing consumes the column yet (MONIKER-2 consumes). The independent-`if` migration
  fix touches `ensureIdentitySchema` — covered by the existing persist-quorum-migration test plus a
  new both-columns-missing case.

**UNIT COMPLETE (2026-07-09) — DoD line deliberately NOT flipped.** All MONIKER-1 story ACs are
delivered and reviewed, but the DoD line text reads "carried on the offer" — that clause is
MONIKER-2 AC1's seam (offer construction does not exist yet). The line flips ✅ when MONIKER-2 lands
the carry; an auditor anchoring to line text would rightly reject an earlier flip. Evidence:
- Implementation cello-client `bd44f26`; review fixes `11a2574`. Gates green: 1834 tests,
  lint/typecheck/build clean. Red-first throughout (10 unit tests red → green; 4 review-fix tests
  red → green).
- Review (`cello-unit-reviewer` on `bd44f26`): AC1/AC3-set-half/AC4 implemented; **Finding 1
  (HIGH/blocking, CLI):** the inline `--agent` filter dropped positional index 0 when the flag was
  absent (`i === agentIdx + 1` with agentIdx `-1`) — `cello moniker set Bob` printed usage instead
  of dispatching. **Finding 2 (HIGH, pre-existing):** identical bug in `cello contact` (the copy
  source) — `cello contact list` without `--agent` was broken on main. Both fixed via one extracted,
  test-pinned `splitAgentFlag` helper (fix-when-found rule). **Finding 3 (MEDIUM):** omitted
  `moniker` key treated as an explicit clear — a malformed request silently deleted a stored
  override and reported success; now rejected as `missing_params`, with a test proving the stored
  override survives. **Hollow-coverage gap:** the bin dispatch layer was untested (exactly where
  Finding 1 lived) — the parse is now a tested unit.
- OBS: `agent.moniker.set` (info) `{agentName, cleared}` on success only.
- AC3's offer-construction re-validation remains deferred to MONIKER-2 (journaled above).
  **Next: MONIKER-2** — offer carries the name; receiver validates at the wire boundary; then
  DOD-MONIKER-1 and DOD-MONIKER-2 flip together.

---

### 2026-07-09 — Entry 67: MONIKER-2 — offer carries the name (unit start; CROSS-REPO discovery)

**Target (one sentence):** The initiator's `session_request` carries its validated outbound name,
the directory passes it through into the `session_assignment`, and the receiver validates it once
at the wire boundary (`extractInboundSessionAssignment`) yielding `offeredMoniker: string | null` —
never auto-written to contacts, fully backward compatible.

**SCOPE DISCOVERY — this unit is CROSS-REPO.** The spec's ref seam names only the client
(`extractInboundSessionAssignment`), but the offer path is initiator → `session_request` →
**directory constructs `session_assignment`** → responder. The directory decodes the request into
typed fields and builds the assignment explicitly — an unrecognised field is DROPPED by the codec.
So the moniker needs: client outbound (request), **directory pass-through (decode request field →
carry into assignment encode)**, client inbound (boundary validation). Per repo rules: never assume
one repo; a directory change means a batched deploy (~25–30 min, all 3 regions) before any live
proof. MONIKER-1 AC4 ("never sent to the directory") is not violated — that clause bars directory
REGISTRATION/storage; the offer transits the directory as an unverified pass-through hint (spec §2
explicitly declines integrity claims about the directory hop).

**Clause checklist (DOD-MONIKER-2 + AC1–AC4):**
- [ ] AC1a — client outbound: `session_request` gains optional `moniker`, populated from
  `getOutboundName(agentName)` (MONIKER-1), re-validated at construction (MONIKER-1 AC3's deferred
  half); absent name → field OMITTED (never an empty string)
- [ ] AC1b — directory: request decode accepts optional `moniker` (type/length-bounded), threads it
  through `#processSessionRequest`, assignment encode carries it to the responder
- [ ] AC2a — receiver: `extractInboundSessionAssignment` validates once with the shared
  `validateMoniker`; result `offeredMoniker: string | null` on the parsed assignment; invalid →
  `null` + `moniker.rejected` `{agentName, pubkey, reason}` (never the raw value); absent → `null`,
  no log
- [ ] AC2b — `offeredMoniker` is carried on the inbound session state so MONIKER-4's dispatcher can
  resolve `who` (stored with the session, not re-parsed later)
- [ ] AC3 — the offered name is NEVER auto-written to the contacts address book (test asserts the
  contacts store is untouched after an offer with a moniker arrives)
- [ ] AC4 — backward compatible: old initiator omits the field (receiver fingerprints, silent); old
  directory drops the field (same degradation); old receiver ignores it; no version bump
- [ ] OBS — `moniker.rejected` (info) per spec §6

**Falsification pass:**
- The initiator validates at request construction; the directory bounds but does not judge; the
  receiver is the authority (spec: hostile operators can modify their own daemon — receiver-side
  validation is the only one that counts for display safety).
- Reject-never-strip holds at the boundary: invalid → `null`, the label degrades to fingerprint.
- Failure integrity: a missing/invalid moniker NEVER drops the assignment — sessions must still
  form (refusing would hand strangers a DoS lever, spec §3).
- Deploy sequencing (§2c): directory change commits to main only when green; the push triggers the
  directory pipeline — batch it, arm the Cron-1 watchdog, keep working the client side in parallel.

**Directory half DONE (2026-07-09).** Red-first (7 codec tests: bounded request decode, assignment
encode/decode round-trip, absent-field omission, signed-fields-byte-identical proof), then:
`SessionRequest.moniker` + `SessionAssignment.moniker` (local directory-types), bounded pass-through
decode (string, 1–64 — the directory does NOT judge the charset; the receiver is the authority),
threading through `#processSessionRequest`, unsigned carry on the assignment (OUTSIDE every TBS —
adding it to the signed portion would break existing FROST verification, and the spec makes no
integrity claim). Directory suite green: 712 tests. Lint + typecheck clean.

**⚠️ PARKED FINDING — e2e-tests network suites red on this machine, NOT caused by this unit.**
The repo-root gate's e2e half fails: 7 network files (session003-e2e, adapter-003, node-004-e2e…)
= 22 tests, `initiateSession failed: directory_unreachable`. Evidence chain (all four probes fail
IDENTICALLY): (1) with vs without this unit's diff — same; (2) pre-SEC-2 (`1d730260~1`) — same;
(3) node 22 vs node 24 (repo wants ≥24; shell default was 22 post-crash) — same; (4) weeks-old
commit `807817c0` — same. Only libp2p-network suites fail; structural e2e files pass (49 tests).
Signature: both clients auth + announce on signaling, both streams close ~10ms later, the
subsequent persistent-stream open fails. The suites run ANCIENT published pins
(`@cello-protocol/client` ^0.0.20 vs 0.0.82 current) against today's directory source. Prime
suspects: stale pins meeting a newer signaling flow, or machine-local libp2p state. This predates
the moniker work by weeks and does not gate it (the touched package's suite is green); it needs its
own unit — proposed **E2E-PINS-1**: refresh the e2e published-client pins (or vendor the spine
client) and get the network e2e green again, then make the pin-freshness a checked invariant.
Full logs: scratchpad `e2e-full-main.log`, `e2e-807817c0.log`.

Also fixed when found (pre-existing lint): unused `connectMcp` import (j-presence.spine.test.ts,
error-level) + two unused eslint-disable directives (internal-api-only.ts). Lint now fully clean.

**CLOSED ✅ (2026-07-09) — DOD-MONIKER-1 and DOD-MONIKER-2 flipped.** Evidence:
- Client half: cello-client `44540e3` (outbound single-seam + wire-boundary validation +
  `offered_moniker` on await_session + session-scoped map; 11 red-first tests) and review fixes
  `7e6133b`. Directory half `77cba799` **DEPLOYED** — pipeline all stages Succeeded incl. SmokeTest,
  ECS COMPLETED 1/1 in us-east-1 (:249), eu-central-1 (:100), ap-northeast-1 (:90); watchdog cron
  retired.
- Review (`cello-unit-reviewer`, cross-repo diff): **F1 [blocking]** — the offeredMonikers cleanup
  fired only on terminal states that never flow through the wrapper (production emits
  created/interrupted/counterparty_closing): dead code, unbounded remote-fed map. FIXED: drop on any
  state ≠ created + drop at offer expiry in the reap, observable via `moniker.offer.dropped`, pinned
  by red-first lifecycle tests (including second-transition-no-second-drop, which proves removal
  rather than logging). **F2** — `moniker.rejected` now carries the boundary's real reason
  (`not_string|length|charset`). **F4** — stored-but-invalid outbound name logs
  `moniker.outbound.invalid_name_omitted`. **F3 (design note, carried to MONIKER-4's journal):**
  length/non-string junk is silently bounded away directory-side, so `moniker.rejected` only fires
  for charset-invalid values the directory passes — acceptable (receiver authority holds), noted.
- Reviewer's standing condition, carried forward: **MONIKER-4's live channels session MUST assert
  the received label end-to-end** (name through the deployed directory to a real doorbell; invalid
  name renders as fingerprint) — that closes the two seam-level AC1 wiring bypasses it identified.
- Gates: cello-client full workspace 1855 green (includes the parallel session's RECONNECT-001
  suite, landed as `b91b6c1` — adapter WIP no longer uncommitted), lint/typecheck/build clean.
- Parallel-session coordination: RECONNECT-001 rides the SAME upcoming publish cascade as the
  moniker units (Andre's relay: bump map protocol-types 0.0.19 / transport 0.0.17 / client 0.0.47 /
  daemon 0.0.38 / cli 0.0.35 / connect 0.0.62, tag v0.0.84 as monotonic trigger; verify against the
  BINARY incl. a RECONNECT grep and an offered_moniker grep). Cascade cut AFTER MONIKER-3/4/5 land,
  via /cello-publish loaded fresh. **Next red: DOD-MONIKER-3** (contacts pet-name column).

---

### 2026-07-09 — Entry 68: MONIKER-3 — local address book pet name (unit start)

**Target:** `contacts.moniker TEXT NULL` via a PRAGMA-guarded idempotent ALTER; `addContact` gains an
optional validated moniker (re-add updates it when non-null given, `added_at` keeps never-refresh);
`cello_contact_add` accepts optional `moniker`, new `cello_contact_set_moniker` renames/clears;
`cello_contact_list` returns `{pubkey, added_at, moniker}`.

**Clause checklist (AC1–AC3 + hygiene):**
- [ ] AC1 guarded ALTER on `contacts` (session-node-manager schema init) — SQLite has no ADD COLUMN
  IF NOT EXISTS; migration idempotent; existing rows NULL, no data loss (restart test)
- [ ] AC2 `addContact(agentName, pubkey, moniker?)` — INSERT OR IGNORE preserves `added_at`
  never-refresh; a new NON-NULL moniker on re-add updates; absent moniker on re-add leaves the
  stored one; store-level validate-throw backstop (MONIKER-0 rule)
- [ ] AC3 `cello_contact_add` optional `moniker` (invalid → `invalid_moniker`, nothing stored);
  `cello_contact_set_moniker(pubkey, moniker|null [, agent])` — rename + clear; missing `moniker`
  key → `missing_params` (Entry-66-F3 lesson: absence is not a clear); unknown contact →
  `contact_not_found` fail-loud; list returns the moniker; shim forwards only (D7)
- [ ] Hygiene: the two AUTO-add call sites (reply-promotion, outbound-initiate) pass NO moniker —
  MONIKER-2 AC3's never-auto-written boundary holds by construction
- [ ] OBS `contact.moniker.set` (info) `{agentName, pubkey}` — spec §6, never the value? (spec logs
  only identifiers; the moniker is display-safe by construction but stay consistent: no value)

**Falsify:** store methods live beside addContact (same #db); handlers mirror cello_contact_add /
cello_set_moniker patterns incl. resolveContactAgent; no redundancy (validation handler-side for the
friendly error + store throw backstop); nothing else consumes listContacts' row shape except
cello_contact_list (checked: single caller) so the added field is additive.

---

### 2026-07-09 — Entry 69: MONIKER-4 — whoLabel + doorbell copy (unit start, DESIGN NOTE first)

**Target:** a pure, total `whoLabel` renders every counterparty as local pet name → offered name →
fingerprint; the dispatcher stamps `who`/`whoKnown` on the two counterparty-bearing frames; the shim
doorbell leads with the label, moves session IDs out of the body, and marks unverified names.

**Design note (§6 — this is the in-context egress surface):**
- **Pure core** `core/daemon/src/who-label.ts`: `fingerprint(pubkeyHex)` → `agent 178d420b…` (8 hex +
  ellipsis; garbage/empty input still yields a non-empty label — total, never throws). `whoLabel({
  localMoniker, offeredMoniker, pubkeyHex })` → `{ who, whoKnown, source }`; re-validates both name
  inputs with the shared rule (defense in depth — total even if misused), precedence local ?? offered
  ?? fingerprint; `whoKnown` true ONLY for source local (AC2's "came from the local address book").
- **Producer chain:** localMoniker ← new targeted `getContactMoniker(agentName, pubkey)` on
  session-node-manager (MONIKER-3's column); offeredMoniker ← MONIKER-2's session-scoped map keyed by
  sessionId; resolution happens daemon-side at the dispatch call sites (wrapper + content-arrived
  callback), emits `moniker.resolved {agentName, pubkey, source}` debug. Dispatcher methods gain
  optional who/whoKnown params — additive on the frame, `counterpartyPubkey`/`from` stay the anchors.
- **Shim rendering (forward-only frames, rendering is display):** label = whoKnown ? who :
  (fingerprint ? who : `"who" (unverified)`). The name-vs-fingerprint discriminator is UNFORGEABLE:
  MONIKER_RE excludes spaces; a fingerprint always contains one (`agent 178d…`). Quotes/parens
  excluded by the charset → the (unverified) marker itself cannot be forged (AC4). Copy per spec
  table (created/active/sealed/closed/cello_message); non-table states get the generic
  `session with {label} is now "state"`. Session IDs leave the body — they remain as `<channel>` meta
  attributes (AC3). Old-daemon frames (no `who`) fall back to a shim-side fingerprint of
  counterpartyPubkey/from — degrades legibly, never blank (spec §8).
- **AC5 / INV-CONTENTFREE:** `who` is a validated ≤64-char name or a fingerprint — routing metadata,
  never message content; the shim's synthesized-body + content-key-skip stance is unchanged.
- **Enforcers:** unit tests (who-label battery incl. 64-char never-truncated names + totality;
  channel-params copy assertions incl. marker rendering + ID-out-of-body; dispatcher integration over
  the moniker-2 harness with a real notification listener). **The DoD line flips ONLY after the LIVE
  channels session** (published connect + /mcp reconnect — the two human-gated steps land at cascade
  time), which also discharges the MONIKER-2 reviewer's carried condition (end-to-end label assert,
  invalid name renders as fingerprint live).

**Checklist:** [ ] AC1 pure total whoLabel+fingerprint (battery) · [ ] AC2 who/whoKnown on exactly
session_state_changed + cello_message, whoKnown true only for local source · [ ] AC3 copy table,
who leads, IDs out of body (meta keeps them), names never truncated · [ ] AC4 unverified marker,
unforgeable · [ ] AC5 content-free preserved · [ ] OBS moniker.resolved · [ ] live proof PENDING
cascade (flip held).

**MONIKER-4 BUILT + REVIEWED (2026-07-09) — DoD flip HELD for the live gate.** cello-client
`a09c17b` + review fixes `e10b8d7`. Pure `who-label.ts` (local ?? offered ?? fingerprint; whoKnown
only for the local tier), daemon-side `resolveWho` at the two dispatch points, additive who/whoKnown
on `session_state_changed` + `cello_message`, shim copy per the spec table. Reviewer: SPEC deviation
F1 (`{yourAgent}` was truncated at 12 chars by `short()` — agent names are legal to 64; AC3's
never-truncate applies to your own name too) FIXED; **HOLLOW TEST T1** — the ID-out-of-body
assertions checked for 16 consecutive hex chars while the *old* rendering emitted only 12 via
`short()`, so the one assertion whose entire job was pinning "session ID leaves the body" could not
catch that regression; tightened to 8 and re-proven. F2 (silent null-DB branch) now logs
`moniker.local.db_unavailable`. No silent fallbacks; resolve-before-drop ordering and the
unforgeable space-discriminator both confirmed by the reviewer.

**MONIKER-5 BUILT (2026-07-09).** cello-client `d7c741c` — `who`/`whoKnown` on `cello_list_sessions`
and `cello_contact_list` (AC1); AC2 asserts the load-bearing invariant: a named stranger and a
nameless one get identical contact membership and identical ABUSE-1 acceptance bounds, and neither
is auto-promoted (CC-1). Reviewer in flight. Gates: 1883 green, lint/typecheck/build clean.

**MONIKER-5 REVIEWED + CLOSED ✅ (2026-07-09).** Review fix `65fbf6a`: the `toEqual(boundNamed,
boundNameless)` assertion was **vacuous** — the bound function takes no moniker and both strangers
sat under the caps, so it compared `{ok:true}` to `{ok:true}` and could never detect a name leaking
into ABUSE-1. Replaced with the discriminating assertion (`countActiveSessionsFromUnknownSenders`
=== 2), which drops to 1 the moment an offered name makes a sender contact-like. The `isContact`
pair was already toothy and stays. Reviewer cleared both structural risks I asked about: `resolveWho`
runs only on the *sliced* rows (bounded at MAX_LIST_LIMIT, and its try/catch means the per-row DB
read cannot throw out of a handler where the old code couldn't); daemon-wide `list_sessions` resolves
each row against its OWN agent's contacts — no cross-agent read. DOD-MONIKER-5 flipped.

**ALL SIX UNITS BUILT AND REVIEWED. Gates: 1883 tests green, lint/typecheck/build clean.**

**REMAINING TO CLOSE THE MONIKER TIER:** (1) ~~MONIKER-5 review + fixes~~ ✅. (2) The publish cascade —
protocol-types 0.0.19 → transport 0.0.17 → client 0.0.47 → daemon 0.0.38 → cli 0.0.35 → connect
0.0.62, tag `v0.0.84` (monotonic CI trigger, NOT the connect version — they have drifted); carries
the parallel session's RECONNECT-001 (`b91b6c1`) too. Load `/cello-publish` fresh; verify against
the BINARY (`npm view … dependencies` = real versions never `workspace:*`; `npm pack` + grep dist for
both a RECONNECT marker and `offered_moniker`). (3) **The LIVE channels session** — the gate for
DOD-MONIKER-4, which also discharges the MONIKER-2 reviewer's carried condition: assert the received
label end-to-end (legible name through the deployed directory), an invalid name rendering as a
fingerprint, and the ID out of the body. Human-gated steps: `latest` promotion (needs Andre's go) and
`/mcp` reconnect.

### 2026-07-09 — Entry 70: v0.0.84 publish cascade — CUT, blocked on a GitHub Actions outage

**Cascade cut.** cello-client `6a02750`, tag **`v0.0.84`** (next free counter — the tag is a monotonic
CI trigger, NOT the connect version; they have drifted). Bump set computed from the real dependency
graph, not assumed: `protocol-types` 0.0.19 (changed — MONIKER-0) → `transport` 0.0.17, `client`
0.0.47 (re-pin) → `daemon` 0.0.38 (changed — MONIKER-1..5), `cli` 0.0.35 (changed) → `connect` 0.0.62
(changed — RECONNECT-001 + doorbell copy). **`crypto` stays 0.0.18** — unchanged and depends on
nothing that changed. Carries the parallel session's RECONNECT-001 (`b91b6c1`). Final gate on the
tagged tree: 1883 tests, lint/typecheck/build clean.

**⚠️ BLOCKED — GitHub outage, NOT our pipeline. Do not "fix" it.** CI run `29017700447`: *Build and
Test* **SUCCEEDED** including the Publish-completeness guard; the *Publish (tag release)* job sits
**queued with no runner assigned**. Ruled out, by inspection: `needs: build` satisfied; no
`environment:` protection gate; no concurrency group; `pending_deployments` empty; identical
`ubuntu-latest` labels to the job that DID get a runner. Root cause is upstream — GitHub incident
**"Delays starting Actions runs"** (status `investigating`, impact **major**, opened 04:34Z): ~30% of
hosted-runner runs delayed >5 min, a subset exhausting retries and failing to start.

**Standing instructions while blocked** (watchdog cron `f79a50c9`, 4-min): if the publish job fails
to start, `gh run rerun 29017700447 --failed` — safe, because already-published versions are skipped
(`|| true`) and the tag is already pushed. **Never** cancel-and-retag, and **never** `npm publish`
locally — that ships raw `workspace:*` specifiers and burns the version on npm forever.

**The real success signal is `smoke-tag`** (clean-installs `cli@beta` + `connect@beta` and loads their
module graphs), not the top-level green. On green, the step-5 BINARY verification runs before anything
is believed: all seven `@beta` versions; `cli@0.0.35` deps must show `daemon@0.0.38` (never
`workspace:*`); `npm pack` the daemon + connect tarballs and grep `dist/` for `offered_moniker` /
`whoLabel` / the reconnect marker. CI's checkmark is not evidence the change shipped.

**Human-gated, genuinely blocking (PROCEDURE §2c):** (1) `latest` dist-tag promotion — all seven
packages, needs Andre's explicit go. (2) `/mcp` reconnect at Andre's keyboard, then the **live
channels session** that flips DOD-MONIKER-4 and discharges the MONIKER-2 reviewer's carried condition.

### 2026-07-09 — Entry 71: ✅ v0.0.85 PUBLISHED to beta — verified against the BINARY

**Published.** Run `29019356454`, tag **`v0.0.85`**, all jobs green **including `smoke-tag`** (the
clean-install + module-graph load — the only real success signal; a green top-level is not evidence).

`v0.0.84` was **cancelled**: its publish job sat queued ~1h with no runner, then GitHub cancelled it
outright (the incident's "exhausting retries" path). **Nothing had published under it** — all six
packages still read their old versions, verified before acting, so there was no partial cascade to
reconcile. Recovery was to cut a **new tag on the identical tree** (`6a02750`): a tag is only a
monotonic CI trigger, versions live in `package.json`, so `v0.0.85` shipped the same set. Never
re-push an existing tag; never `npm publish` locally (ships raw `workspace:*`, burns the version
forever). `/cello-publish` was re-invoked for the second tag — the guard hook blocked it until then,
correctly: loaded-once ≠ covered.

**Diagnostic note for the record.** Mid-incident I claimed the retry "reproduced the asymmetry"
(Build gets a runner, Publish doesn't) and began hunting a cause on our side. That was wrong — I was
comparing a 3-minute queue to an hour-long one. Ruled out properly before and after: `needs: build`
satisfied, no `environment:` gate, no concurrency group, empty `pending_deployments`, identical
`ubuntu-latest` label to the job that DID get a runner, and the repo is **public** (Actions minutes
free/unlimited, killing the exhausted-minutes theory that would have produced exactly that pattern).
Cause was upstream throughout: GitHub "Delays starting Actions runs", Actions component
`major_outage`, impact critical.

**Step-5 BINARY verification (not CI status) — all PASS:**
- `@beta` versions: crypto 0.0.18 (unchanged), protocol-types **0.0.19**, transport **0.0.17**,
  client **0.0.47**, daemon **0.0.38**, cli **0.0.35**, connect **0.0.62**.
- Cross-pins are REAL versions, never `workspace:*` — `cli@0.0.35 → daemon@0.0.38 +
  protocol-types@0.0.19`; `connect@0.0.62 → client@0.0.47 + crypto@0.0.18 + transport@0.0.17`.
- `npm pack` + grep `dist/`: **daemon@0.0.38** carries `offered_moniker`, `whoLabel`,
  `moniker.rejected`, `getContactMoniker`, `validateMoniker`. **protocol-types@0.0.19** carries
  `MONIKER_RE` + `validateMoniker`. **connect@0.0.62** carries the doorbell copy (verbatim:
  `📞 CELLO — ${renderWho(data)} wants to connect. Run cello_await_session to accept.`), the
  `(unverified)` marker, `cello_set_moniker` + `cello_contact_set_moniker`, **and RECONNECT-001**
  (`reconnected to the CELLO daemon`) — proof the parallel session's work shipped rather than being
  silently dropped.

**BLOCKED ON THE TWO HUMAN-ONLY STEPS (PROCEDURE §2c), stated plainly:**
1. **`latest` promotion** — seven `npm dist-tag add` commands. Needs Andre's explicit go. WE PROMOTE,
   WE DO NOT PIN.
2. **`/mcp` reconnect** at Andre's keyboard, after `npm i -g @cello-protocol/cli@latest
   @cello-protocol/connect@latest` and `cello logout && cello login`.

Then the live run: [[M8C-MONIKER-LIVE-TEST]] T1–T5 → flips DOD-MONIKER-4 (the last ❌ of the tier) and
discharges the MONIKER-2 reviewer's carried condition. **T4 (invalid name → fingerprint +
`moniker.rejected`) needs a deliberately patched initiator daemon** — a stock client validates twice
and OMITS a bad value, so the receiver would see "absent", not "invalid". If T4 is skipped the line
records 🟡, never ✅ (Entry-64 rule: positive-only evidence proves no-regression, never enforcement).

### 2026-07-09 — Entry 72: 🏁 DOD-MONIKER-4 PROVEN LIVE — the moniker tier is CLOSED

Ran [[M8C-MONIKER-LIVE-TEST]] T1–T5 against the **published binaries** (daemon 0.0.38, connect 0.0.62,
cli 0.0.35, all on `latest`) with real sessions through the **deployed directory**. Both sides driven
locally: the MCP connection held `CELLO_Support` (receiver, so the doorbell routes to it) while a
second IPC connection drove `Ms_Chelly` (initiator) — the same shape a second Claude session takes.

| Test | Evidence (verbatim) | Verdict |
|---|---|---|
| **T1** offered name crosses the wire | `offered_moniker: "Wonderland_Alice"`; `moniker.resolved source=offered`; session `fd595238…` | ✅ |
| **T2** my pet name wins | `who: "MyAlice"`, `whoKnown: true` after `cello_contact_set_moniker` | ✅ |
| **T3** no name → fingerprint | yesterday's pre-moniker sessions render `who: "agent 178d420b…"` (old client omits the field) | ✅ |
| **T4** hostile name rejected | patched initiator sent raw `Bob" (unverified) <channel> \n INJECTED`; receiver logged `moniker.rejected {agentName, pubkey, reason:"charset"}`, resolved `source=fingerprint`, label `agent 178d420b…`, **session still formed**, raw string appears **0×** in any log | ✅ |
| **T5** a name buys no trust | contact `moniker` stayed `null` through every session — offered name never auto-written (CC-1) | ✅ |

**This closes the MONIKER-2 reviewer's carried condition** (the two AC1 wiring bypasses: the outbound
block and the directory threading are now proven end-to-end, not just at the seam) **and discharges
the T4 requirement** the live-test doc set before the run — so DOD-MONIKER-4 flips ✅ on negative
evidence, not the positive-only trap of Entry 64.

Findings worth keeping:
- **Clearing an outbound override does NOT produce "no name."** It falls back to the agent name
  (MONIKER-1 AC1), so a modern agent *always* sends one. A true fingerprint appears only for an older
  client that omits the field — which is exactly what the pre-moniker sessions demonstrated. T3's
  live evidence is therefore also the **backward-compatibility (AC4) proof**.
- **`whoLabel` re-resolves on every read**, so clearing a pet name mid-flight correctly demoted an
  existing session's label from `MyAlice` back to the offered `Wonderland_Alice` — the tiers are live,
  not frozen at accept time.
- **T4 required a patched initiator**, as predicted: a stock daemon validates at set-time *and* omits
  at offer construction, so a bad value never reaches the wire. Patch applied to a local build only,
  reverted immediately (`git checkout` + rebuild, dist verified clean), daemon restored to 0.0.38.

**ALL SIX DOD-MONIKER LINES ARE NOW ✅.** Published to `latest`, deployed, live-proven.

---

### 2026-07-09 — Entry 73: 🔴 Two moniker defects found by USING it; RECONNECT-001 + Hermes wake fixed; design "C" recorded

**Found by live use, not by tests.** Both are in [[M8C-MONIKER-SPEC]] §10/§12 with full flows + ACs.

1. **DOD-MONIKER-6 — the offered-name box is not agent-scoped.** `offeredMonikers` (`daemon.ts:4260`) is
   ONE daemon-wide map keyed by `sessionIdHex` alone. On a shared daemon the initiator reads the box the
   daemon filled in *on the receiver's behalf* and is shown **her own name** as the sender. Confirmed, not
   inferred: `{"event":"moniker.resolved","agentName":"Ms_Chelly","pubkey":"77d0c806…","source":"offered"}`.
   Latent twin: both delete sites are cross-agent, so one agent's state change drops another's box.
   Two-machine setups are unaffected (an initiator's daemon never *receives* an offer, so its box is empty
   → fingerprint) — **which is precisely why the whole tier tested green**. Fix "A": key by
   `(agentName, sessionIdHex)` at `:4597`, `:1070`, `:1099`, `:4327`. NOT YET BUILT.

2. **DOD-HERMES-3 — Hermes never sees the name.** The adapter's `_wake_prompt` predates monikers and never
   reads `who`/`whoKnown`. Hermes agents see raw hex forever. The irony: Hermes could never have surfaced
   defect 1, because it does not display the field that was wrong. NOT YET BUILT.

**Shipped today (cello-client):**
- `b91b6c1` **RECONNECT-001** — IpcProxy survives a daemon restart (replays `ipc.connect` + `cello_use_agent`
  before releasing queued callers; NEVER replays in-flight calls — `cello_send` is not idempotent; a failed
  INITIAL connect starts no background loop; only the handshake may time out, so blocking `cello_receive` is
  uncapped). 8 tests. Published in **connect 0.0.62**.
- `86a4dad` + `91929c3` **Hermes wake prompt** — the woken agent answered `[SILENT]` to six wakes and called
  zero tools, because my own prompt ended "If no action is needed, reply with exactly [SILENT]". Message
  wakes now forbid silence and name the tools; the platform hint forbids the `cello` CLI and any daemon
  restart, with reasons. **Clean-room test PASSED**: `Mcp Cello Cello Use Agent → Receive → Get Transcript`,
  no shell, no `[SILENT]`, no restart. ⚠️ These two are **NOT PUBLISHED** — published `cli 0.0.35` still
  carries the old prompt; the local plugin was installed from the local dist. They need a `cli` bump.

**Design "C" recorded, NOT scheduled** ([[M8C-MONIKER-SPEC]] §13): the offered name should move into the
receiver's contacts **on accept**; the box retires. Delivers the feature's real purpose (you learn who you
are talking to, persistently) and makes defect 1 structurally impossible. Conditions: provenance must
survive the save; auto-accept paths decide deliberately. Injection + collisions examined and dismissed —
the charset is the defense, and the pubkey anchor rides every frame (**§11 invariant: never remove it**).

**Also learned (operational):** Hermes spawns a NEW `cello-mcp` process per session — the repeated
`starting MCP server 'cello'` lines are Hermes' session lifecycle, not an agent restarting CELLO. And the
shim's `notification.channel.forwarded` path is dead: Hermes' MCP client ignores custom notifications; only
the platform adapter's injection wakes it.

---

## Related Documents

- [[M8C-SPEC]] — the design
- [[M8C-DEFINITION-OF-DONE]] — the yardstick this board mirrors
- [[M8C-PROCEDURE]] — the runbook
- [[M8C-DECISIONS]] — forks + choices
- [[M8C-MILESTONE-NOTES]] — inventory + verification evidence
