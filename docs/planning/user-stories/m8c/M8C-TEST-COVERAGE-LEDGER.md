---
name: M8C Test Coverage Ledger
type: reference
date: 2026-07-08
milestone: M8C
status: ready
topics: [test-coverage, definition-of-done, verification, blocked-tests, primary, m9, sec-2, ledger]
description: >
  The complete ledger mapping EVERY M8C Definition-of-Done line to a test bucket, so no area is left
  uncategorized. Buckets: ALREADY-PROVEN (live already), A = no-infra (Round-2), B = infra-staged
  (Round-3), C = BLOCKED (not testable until code lands / a gate clears), OUT = out of this DoD's scope.
  The second half details every Category-C scenario with its unblock condition — the third document
  Andre asked for when a scenario fits neither A (no-infra) nor B (infra-staged).
---

# M8C Test Coverage Ledger

Purpose: **no area untested = no area uncategorized.** Every DoD line below sits in exactly one bucket.

## Buckets

- **✅ PROVEN** — already live-verified (Round-1, the earlier [[M8C-LIVE-TEST-CHECKLIST]], or a build entry).
- **A — no-infra** → [[M8C-AB-TEST-ROUND-2]] (R1–R12): running daemon + MCP/CLI + local agent stop/start.
- **B — infra-staged** → [[M8C-AB-TEST-ROUND-3-INFRA-STAGED]] (S1–S3): relay, real Telegram bot, 2nd daemon.
- **C — BLOCKED** → detailed below: cannot be tested until code is built or a gate (SEC-2 / M9) clears.
- **OUT** — not this DoD's scope (belongs to the portal or a follow-on milestone).

## The complete DoD → bucket ledger

| DoD line | DoD status | Bucket | Where / why |
|---|---|---|---|
| **INV-CONTENTFREE** | ✅ | ✅ PROVEN | R10 (canary absent from log + live push frame, both sides) |
| **INV-PUSHPULL** | ✅ | ✅ PROVEN | R11 (poll-only reconciliation, 3 msgs, zero pushes consumed) |
| **INV-HONEST-STATES** | ✅CORE | ✅ PROVEN | R9 (away vs unreachable, transparent path); opaque-mode half → C (D15) |
| **INV-GATEWAY** | ❌ | **C** | M9 screening not merged/active (D11) |
| **INV-ONE-PRIMARY** | ❌ | **C** | needs PRIMARY-1 (unbuilt + SEC-2-gated) |
| **SPIKE-1** | ✅ | ✅ PROVEN | Entry 3 |
| **WAKE-1** | ✅ | ✅ PROVEN | R1 Ph3 + R5 re-confirm |
| **AUTOSTART-1** (F18/F5) | ✅ | ✅ PROVEN | checklist 2a; F18=CC-3 (R3), F5=CC-8 (R1 Ph0) — failure-path edge → A (R7-adjacent) |
| **INBOX-1** | ✅ | ✅ PROVEN | checklist 2b + R11 |
| **ONBOARD-HELP-1** | 🟡 | ✅ PROVEN | top-level CC-7 (R1 Ph4 s1) + per-command earlier |
| **ONBOARD-ERRORS-1** | ✅ | ✅ PROVEN | R12 (all 3 bad paths, incl. the R4 bad-token silent-output repro — now speaks) |
| **ONBOARD-NEXTSTEP-1** | ✅ | ✅ PROVEN | R1 Ph4 |
| **ONBOARD-WARN-1** | ✅ | ✅ PROVEN | R12 (no secret-klaxon in a real register output) |
| **ONBOARD-LOGNOISE-1** | ✅ | ✅ PROVEN | R12 (reconnect churn is `debug`+`expected:true`, quieter than the ❌ description assumed) |
| **LIVE-1** (Tier-1 gate) | 🟠 | ✅ PROVEN* | doorbell + cold onboarding done; *email-recovery papercut = triage follow-up |
| **MSGWAKE-1** | ✅ | ✅ PROVEN | R1 Ph3 |
| **SINCESEQ-1** | ✅ | ✅ PROVEN | checklist 3a + R11 |
| **LOGINSTART-1** | ✅CORE | ✅ PROVEN | R7 (login enumerated + started all 4 agents; failure-path branch unexercised, no failure occurred) |
| **CONFIG-1** (+F6/F12) | ❌ | **C** | M9-CFG-001 store not built (D14) |
| **CURSOR-1** | ✅ | ✅ PROVEN | R1 Ph3 (read-before-write); two-attended-windows edge → A option |
| **AWAY-1** | ✅CORE | ✅ PROVEN | checklist 3d + R9; opaque-mode/custom-text → C (D15) |
| **CONTACT-1** | 🟡CORE | ✅ PROVEN | R1 Ph2 (CC-1); "presence-to-contacts" → C (D16), "privacy silence" → C (D15) |
| **ABUSE-1** | ✅ | ✅ PROVEN | R4 (per-sender cap, exactly 3 admitted + 4th refused server-side) + R2 (CC-10 interaction) |
| **TTL-1** | 🟡CORE | **A** | R8 — SKIPPED this round (Andre: not worth a code change + ship cascade just to test-window an expiry check); needs 1-line env enabler; per-agent override → C, D17 |
| **TGDOOR-1** | 🟡 | **B** | S3 (real bot token) |
| **RELAYWAKE-1** | 🟡CORE | **B** | S1; brand-new-counterparty case → C (D19) |
| **LEAVEMSG-1** | 🟡CORE | **B** | S1 (happy) + S2 (honest degradation) |
| **PRIMARY-DESIGN-1** | ✅ | ✅ PROVEN | design doc (Entry 32) |
| **PRIMARY-1** | 🟠 | **C** | daemon pairing + ceremony-gate unbuilt; SEC-2-gated (D20) |
| **POLICY-1** | ❌ | **C** | not built |
| **PORTAB-1** | ❌ | **C** | not built |
| **M9INT-1** | 🟡 | **C** | deferred post-channel (D11) |
| **SEC-2** (FROST forgery) | 🚨 | **C** | pre-existing CRITICAL; needs coordinated cross-repo fix (not a "test") |
| **SEC-1** (relay-park auth) | flagged | **C** | pre-existing; own security design pass |
| Kill switch | — | **OUT** | portal/platform scope, not the cello-client DoD (CLAUDE.md) |
| F7/F9/F21*/F22 | tracked | **OUT** | "Tracked, not M8C-fruit" — own stories (*F21 partly addressed by CC-5/CC-10) |

Every line is in a bucket. A + B are the runnable next tests; C is the blocked set below; PROVEN and
OUT need no further Round work.

---

# Category C — blocked / not-yet-testable (with unblock conditions)

These fit **neither** A (no-infra) **nor** B (infra-staged): the code isn't built, or a gate blocks it.
Listed so nothing is "just untested" — each has an explicit unblock. **None is a Tier-1 launch blocker**
except where noted (SEC-2).

## C1 — Multi-device: Primary/Standby device linking  ·  `DOD-PRIMARY-1`, `POLICY-1`, `PORTAB-1`, `INV-ONE-PRIMARY`
The "**your own identity on two devices**" scenario (distinct from Round-2 R1, which is two *different*
identities on two machines). Link a second daemon to the same agent; exactly one Primary; baton transfer;
kill-the-Primary holds INV-ONE-PRIMARY; session portability (close on A → sync → resume on B).
- **Why blocked:** the directory-side arbitration is built + Postgres-tested, but the **daemon-side
  pairing handshake**, the **ceremony-gate** (the actual INV-ONE-PRIMARY enforcement), user-initiated DB
  sync, and Telegram Primary-only gating are **not built**; POLICY-1/PORTAB-1 are greenfield.
- **Unblock:** build the daemon pairing handshake + ceremony-gate — which is itself **gated on SEC-2**
  (you can't gate ceremony participation on `daemon_id` when the ceremony stream isn't authenticated as
  the agent). Then a live multi-daemon spine test (a "needs Andre" kill-the-Primary proof). See D20.

## C2 — FROST signing-path authentication  ·  `SEC-2`  ·  🚨 possibly launch-blocking
Not a feature test — a **pre-existing CRITICAL forgery hole**: the `/cello/frost/1.0.0` signing frames are
unauthenticated, the directory ALB is internet-facing, and `T` directory partials reach threshold without
the client's share → a party knowing only an agent's **public** key can forge signatures (seals, session
establishment). Affects **every** agent; not introduced by M8C.
- **Unblock / fix:** require the frost signing stream to be K_local-authenticated with the existing
  `CELLO-DIR-AUTH-v1` challenge (+ optionally bind `framedMsg` to a directory-brokered session). This is
  a **coordinated cross-repo phased rollout** (client-then-directory) — enforcing auth before deployed
  clients send it breaks every existing agent. A genuine migration decision (PROCEDURE §3a → PARK).
- **Launch call owed (Andre):** severity + whether it blocks launch. It is also the prerequisite for C1's
  ceremony-gate.

## C3 — M9 content gateway: screening + injection defense  ·  `DOD-M9INT-1`, `INV-GATEWAY`
The "**relatively safe**" launch pillar (screening, prompt-injection defense) — `screenInbound` at
`ingestReceivedContent`, `screenOutbound` at `cello_send`, m9 semantic gate green.
- **Why blocked:** `m9-build` is merged in a working branch (Entry 28) but the activation (DOD-M9INT-1)
  is **deferred post-channel** (D11) and its gateway isn't live on main.
- **Unblock:** land DOD-M9INT-1 (recommended before LEAVEMSG-1's new inbound path). Then screening/
  injection tests become runnable (a Round-4, mostly no-infra: feed a PII/secret/injection payload,
  assert redact/block at the seam).

## C4 — Config surface  ·  `DOD-CONFIG-1` (+F6/F12) and the config-gated clauses of AWAY-1 / CONTACT-1 / TTL-1
`cello config list/get/set`; away-text override + opaque privacy mode; contact "privacy silence" +
"presence to contacts only"; per-agent TTL override; directory-node selection setting.
- **Why blocked:** all gated on **M9-CFG-001's versioned config store**, which lives inside the deferred
  M9 package (D14/D15/D16/D17). No parallel store allowed.
- **Unblock:** M9-CFG-001 lands (with the M9 merge). Then a mostly no-infra Round: set each M8C-introduced
  setting, confirm read/write + tighten-free/loosen-confirm enforcement.

## C-tracked — separate stories (not M8C test lines)
`F7` (daemon restart/reload, change directory without bouncing), `F9` (connected-client visibility +
stale-connection reap), `F22` (standing receiver on its own port), `SEC-1` (relay-park bare-content auth
gap). Each is its own story with its own design surface — recorded here so they're not mistaken for
"untested M8C areas." `F21` (stuck-seal terminal state) is partly addressed by CC-5/CC-10.

---

## How this satisfies "no area untested"
- Everything **runnable now** → Round-2 (A) or Round-3 (B), each an A/B-steps test with a PASS bar.
- Everything **already proven** → marked PROVEN with its evidence pointer.
- Everything **not yet runnable** → Category C with an explicit unblock condition (build X / land M9 /
  fix SEC-2), so it's tracked, not forgotten.
- Everything **outside this DoD** → marked OUT with its owner.

No DoD line is unaccounted for.

---

## Related
- [[M8C-DEFINITION-OF-DONE]] — the source of every line in the ledger
- [[M8C-AB-TEST-ROUND-2]] — Category A (no-infra) tests
- [[M8C-AB-TEST-ROUND-3-INFRA-STAGED]] — Category B (infra-staged) tests
- [[M8C-LIVE-AB-TEST-PROTOCOL]] — Round 1 (the fix-run phases, all PASS)
- [[M8C-DECISIONS]] — D11/D14–D20 (the parks + gates behind Category C)
