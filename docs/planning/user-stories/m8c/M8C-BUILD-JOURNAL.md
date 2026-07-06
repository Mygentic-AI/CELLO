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

## Related Documents

- [[M8C-SPEC]] — the design
- [[M8C-DEFINITION-OF-DONE]] — the yardstick this board mirrors
- [[M8C-PROCEDURE]] — the runbook
- [[M8C-DECISIONS]] — forks + choices
- [[M8C-MILESTONE-NOTES]] — inventory + verification evidence
