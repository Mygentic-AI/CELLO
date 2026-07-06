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
| I — Invariants | INV-CONTENTFREE, INV-GATEWAY, INV-PUSHPULL, INV-HONEST-STATES, INV-ONE-PRIMARY | ❌ all |
| 0 — Prerequisites | SPIKE-1, M9INT-1 | ❌ ❌ |
| 1 — LAUNCH GATE | WAKE-1, AUTOSTART-1 (+F5/F18), INBOX-1 (+F4), LIVE-1 | ❌ all |
| 1 — Onboarding riders | ONBOARD-HELP/ERRORS/NEXTSTEP/WARN/LOGNOISE-1 | ❌ all |
| 2 — Reactivity + surface | MSGWAKE-1, SINCESEQ-1, LOGINSTART-1, CONFIG-1 (+F6/F12), CURSOR-1 | ❌ all |
| 3 — Reachability | AWAY-1, CONTACT-1, ABUSE-1, TTL-1, TGDOOR-1 | ❌ all |
| 4 — Async foundation | RELAYWAKE-1, LEAVEMSG-1 | ❌ ❌ |
| 5 — Multi-daemon | PRIMARY-DESIGN-1, PRIMARY-1, POLICY-1, PORTAB-1 | ❌ all |

**Next unit:** DOD-SPIKE-1 — the ~30-min live `claude --channels` spike. The very first action.

**Resume pointer:** read M8C-PROCEDURE §0 read order, then take DOD-SPIKE-1. No code exists yet;
the milestone is greenfield except everything the verification pass proved already live
(daemon dispatch, IPC frames, M9 gateway on `m9-build`, the on-disk Telegram reference).

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

## Related Documents

- [[M8C-SPEC]] — the design
- [[M8C-DEFINITION-OF-DONE]] — the yardstick this board mirrors
- [[M8C-PROCEDURE]] — the runbook
- [[M8C-DECISIONS]] — forks + choices
- [[M8C-MILESTONE-NOTES]] — inventory + verification evidence
