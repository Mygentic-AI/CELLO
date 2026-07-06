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

## Status board (update in place)

| Tier | Lines | Status |
|---|---|---|
| I — Invariants | INV-CONTENTFREE, INV-GATEWAY (activates w/ M9, deferred), INV-PUSHPULL, INV-HONEST-STATES, INV-ONE-PRIMARY | ❌ all |
| 0 — Prerequisites | SPIKE-1 | ✅ |
| 1 — LAUNCH GATE | WAKE-1, AUTOSTART-1 (+F5/F18), INBOX-1 (+F4), LIVE-1 | 🟡 🟡 ❌ ❌ |
| 1 — Onboarding riders | ONBOARD-HELP/ERRORS/NEXTSTEP/WARN/LOGNOISE-1 | ❌ all |
| 2 — Reactivity + surface | MSGWAKE-1, SINCESEQ-1, LOGINSTART-1, CONFIG-1 (+F6/F12), CURSOR-1 | ❌ all |
| 3 — Reachability | AWAY-1, CONTACT-1, ABUSE-1, TTL-1, TGDOOR-1 | ❌ all |
| 4 — Async foundation | RELAYWAKE-1, LEAVEMSG-1 | ❌ ❌ |
| 5 — Multi-daemon | PRIMARY-DESIGN-1, PRIMARY-1, POLICY-1, PORTAB-1 | ❌ all |
| Post-channel — deferred | M9INT-1 (do AFTER channel tiers — D11; NOT a prerequisite) | ❌ deferred |

**⛔ M9 IS NOT A PREREQUISITE (D11, 2026-07-06).** Do NOT merge `m9-build` before the channel work.
DOD-M9INT-1 was moved out of Tier 0 and deferred to after the M8C channel tiers. A post-compaction
context must not conclude M9 needs merging first — it does not.

**Next unit:** DOD-INBOX-1 — `cello_check_notifications({ scope })`: the push-loss reconciliation
mechanism + primary inbox for poll-only clients (unread watermark `last_delivered_seq`; a missed
doorbell is discoverable via INBOX on reattach) + the F4 rider (split `sealed_receipt_not_found`
into distinct reasons; full session IDs on copy surfaces). DAEMON-side (§5). SPIKE-1 ✅, WAKE-1 🟡,
AUTOSTART-1 🟡 (both flip ✅ at LIVE-1). M9INT DEFERRED (D11) — not a gate.

**Resume pointer:** SPIKE-1 ✅ (Entry 3), WAKE-1 🟡 (Entry 6 — built commit `d5fd5ec`, unit +
real-binary integration green, reviewer SPEC-FAITHFUL, flips ✅ at LIVE-1's live `--channels`
session). M9INT is DEFERRED (Entry 4 / D11) — NOT next, NOT a gate. Read M8C-PROCEDURE §0 read
order, then take DOD-AUTOSTART-1.

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

**Next unit:** DOD-INBOX-1 (`cello_check_notifications` — push-loss reconciler + F4 rider).

---

## Related Documents

- [[M8C-SPEC]] — the design
- [[M8C-DEFINITION-OF-DONE]] — the yardstick this board mirrors
- [[M8C-PROCEDURE]] — the runbook
- [[M8C-DECISIONS]] — forks + choices
- [[M8C-MILESTONE-NOTES]] — inventory + verification evidence
