---
name: M8C Live-Test Checklist
type: checklist
date: 2026-07-07
milestone: M8C
description: >
  The plain, tick-box list of what's left to LIVE-TEST to flip M8C to done. Everything below is
  built + published to `latest` — this is the "prove it live" pass, not coding. For the detailed
  per-line status/evidence, see M8C-DEFINITION-OF-DONE; this doc is the fast checklist.
---

# M8C — Live-Test Checklist

Everything here is **built and on `latest`** (as of 2026-07-07). Running the test = flip it green.
No new code needed. Detail lives in M8C-DEFINITION-OF-DONE; this is the quick list.

## ✅ Already proven live
- [x] Core session — two agents connect, exchange messages, seal (Entries 40/45/46)
- [x] Doorbell: session-open wake (WAKE-1) + per-message wake (MSGWAKE-1), both directions (Entries 45/46)
- [x] Full M8C build promoted to `latest` + installed + running (daemon 0.0.34)

## Launch gate — do these to close the launch bar
- [~] **1. Cold onboarding** — as a brand-new operator (with a fresh pre-auth token), do
  `create-agent → register → status` using only what the tool output tells you, no docs/source.
  (Flips DOD-LIVE-1 and the five ONBOARD-* riders.)
  - **2026-07-07 — WALKED LIVE. CLI mechanics PROVEN** (agent `CELLO_Feedback` created→registered→status,
    all from the command guidance alone). But the **gate is NOT yet met**: the current Telegram handoff
    still says `CELLO_REGISTRATION_TOKEN` (a var the CLI doesn't read) → a fresh user following it literally
    is blocked. The full walk surfaced a batch of fixes (copy + the `register` receiver-arming bug + F18
    gaps + the `connections` stub) collected in **[[M8C-ONBOARDING-IMPROVEMENTS]]**. Gate flips ✅ when that
    onboarding mini-sprint ships (ops-agent copy redeploy + one cello-client publish).
- [x] **2a. Auto-start on select** — `cello_use_agent` on an OFFLINE agent brings it online by itself.
  **PROVEN LIVE 2026-07-07** (Agent B: `use_agent CELLO_Support` offline→online, push fired, no start call).
  DOD-AUTOSTART-1 flipped ✅ (success path; failure-path edge not exercised).
- [x] **2b. Inbox** — `cello_check_notifications` returns pending requests + unread messages.
  **PROVEN LIVE 2026-07-07 (Phase 3/4 screening run):** on CELLO_Support, `check_notifications` returned
  BOTH the pending session request AND the unread **message** (`total_unread:1`, `unread:[{dd7493…, count
  1, last_seq 1}]`), **discovered on reattach** (Support was unattended/on-Feedback when the message
  arrived, then switched back). Push-loss reconciliation holds end-to-end. DOD-INBOX-1 → ✅. *(The separate
  proactive-wake-on-return — L3 in D21 — remains unbuilt; that's a different primitive, not INBOX-1.)*
- **Phase 3/4 screening run (2026-07-07) — what else it proved / broke:**
  - **DOD-AWAY-1 (3d) → ✅CORE** — unattended Support auto-replied the AWAY text (seq 2) + queued the message.
  - **DOD-CURSOR-1 → ✅** — read-before-write gate fired live: Ms_Chelly's `send` refused `session_not_current`
    + `current_seq:0`/`last_read_seq:-1` + guidance until she `receive`d Support's unread seq-0 reply. *(The
    DoD had this ❌ NOT BUILT — stale; it's built and now proven. Two-attended-windows scenario not run.)*
  - **DOD-CONTACT-1 gating fired** — known vs unknown produced different acks ("Dispatched" vs AWAY text).
  - **🚨 D21 auto-add hole — CONFIRMED LIVE:** Ms_Chelly (removed→unknown) knocked → "Dispatched." (seq 0,
    unknown) → **auto-re-added** (`added_at 1783442938087`) → her next message got the KNOWN AWAY text (seq
    2). Screening touched one frame, then she was whitelisted. Her content was **accepted + queued
    regardless** (delivered, seq 1) — **no content screening exists today**, only ack wording differs.
- **Finding (leave-a-message, 3i/3j) — NOT proven; an UNRESOLVED inconsistency (do not over-explain it):**
  - **Facts only:** Ms_Chelly's `initiate_session` to the OFFLINE CELLO_Support returned
    `counterparty_unavailable` (no session on her side, no message sent). Yet after Support came online,
    `check_notifications` showed a PENDING session request from Ms_Chelly on session `5749859a`, whose only
    content is an OUTBOUND `"Dispatched."` from Support — and NO inbound message from Ms_Chelly.
  - **RESOLVED (2026-07-07, code-verified):** the receiver's **standing receiver creates a durable
    session** (`status:active`) from an inbound offer — and auto-adds the contact (daemon.ts:4418) + sends
    `"Dispatched."` — **even when the initiator's `initiate_session` failed/abandoned** (`counterparty_
    unavailable` on the sender side). So the sender has nothing while the receiver holds a **half-open
    session**. That half-open session **cannot be cleanly closed**: `cello_close_session` on an `active`
    session (daemon.ts:3250) fires a **bilateral seal that awaits the (absent) counterparty** → it times
    out. It also survived a logout/login. This is a real bug (F21 stuck-seal family): (a) the receiver
    shouldn't strand a durable session from an abandoned offer, and/or (b) there needs a way to
    force-abandon a half-open session. NOTE: `close_session` is scoped to the CURRENT agent
    (daemon.ts:3176) — you must `use_agent` the owning agent before closing, else `session_not_owned`.
  - **Exact error (2026-07-07, Support genuinely `selected:true`):** `cello_close_session` on `5749859a`
    returns **`seal_interrupted_rejected_by_counterparty`** — Support's seal request reaches Ms_Chelly's
    daemon, which ACTIVELY REJECTS it (she has no matching session). This **disconfirms the "switching
    agents breaks close" hypothesis** (the session WAS found on the owner; the failure is at the seal
    step, not the lookup) and confirms the half-open cause. No terminal escape exists → the ghost session
    is un-closeable today. Practical: skip it; a fresh knock is a new session_id and doesn't collide.
  - **Unverified context (do NOT state as fact):** `"Dispatched."` is CONTACT-1's minimal response to an
    UNKNOWN sender, and contacts are PER-AGENT — Ms_Chelly's prior chat was with CELLO_*Feedback* (a
    different agent's whitelist), so nothing implies she is/isn't in CELLO_*Support*'s. Support's contact
    list was NOT checked.
  - So 3i/3j remain unproven. Per the LEAVEMSG design the clean leave-a-message case is a KNOWN contact
    with an existing session (`cello_send` parks) — that specific case is what still needs a live run.
- **Finding (status legibility):** MCP `cello_status` shows `state:"online"` + `selected` (F5 live), but the
  **CLI** `cello status` still shows `"registered"` with no `selected` — CLI/MCP status diverge; the human-
  facing CLI is the stale one. Fold into the onboarding sprint (F5/CLI).

## Moniker tier (M8C-MONIKER-0..5) — built + reviewed 2026-07-09, awaiting the live run
- [ ] **Legible doorbell** — the full protocol lives in [[M8C-MONIKER-LIVE-TEST]] (T1–T5). Flips
  DOD-MONIKER-4 and discharges the MONIKER-2 reviewer's carried condition. Gated on: `v0.0.84`
  published + verified against the BINARY, promoted to `latest` (Andre's go), `/mcp` reconnect.
  **Note T4** — proving the receiver's invalid-name reject path needs a *deliberately patched
  initiator daemon*; a stock client validates twice and omits the bad value, so the receiver would
  see "absent", not "invalid". If T4 is skipped the line records 🟡, never ✅ (Entry-64 rule:
  positive-only evidence proves no-regression, never enforcement).

## Confirm-live pass — everything else that's built
- [x] **3a. Catch up after away** — `cello_receive({ since_seq })` returns everything missed in one batch.
  **PROVEN LIVE 2026-07-07:** 3 messages piled up (seq 3/4/5); one `cello_receive({since_seq:2})` returned
  all 3 in a batch, in order, received-only, no dupes/gaps/polling. DOD-SINCESEQ-1 → ✅. (Doorbell also
  fired 3× — MSGWAKE per-message reconfirmed.)
- [ ] **3b. Login = all agents online** — `cello login` brings every registered agent online at once.
- [ ] **3c. Two windows in sync** — same agent in two sessions; read-before-write (no talking over each other).
- [ ] **3d. Away auto-reply** — unattended agent answers with the away note and queues messages.
- [ ] **3e. Contacts whitelist** — known contact auto-accepts; a stranger gets the limited response.
- [~] **3f. Anti-spam limits** — oversized / flooding message is capped (per-message, per-session, per-stranger).
  **3f run 2026-07-07 — the ≤3-per-unknown-sender session cap DID NOT HOLD (confirmed defect).** An unknown
  Ms_Chelly (removed from Support) opened **4 sequential sessions** to Support — ALL accepted, no ABUSE
  rejection on #4 — and she was auto-re-added (`added_at 1783446042779`). Root cause = the D21 auto-add:
  `checkUnknownSenderAcceptanceBound` exempts contacts (session-node-manager.ts:937), and auto-add promotes
  the sender to "known" at session-1 accept, so sessions 2–4 bypass the cap. The 25 MB per-session byte cap
  is likewise per-session + exempts known (impractical to trip by hand). **So the auto-add-on-knock defeats
  BOTH screening AND anti-spam — same root bug, one easy fix.** (Aftermath: Support now holds 6 open
  half-open sessions — accumulating F21 debris.)
- [ ] **3g. Request expiry** — an unanswered session request shows expired after the TTL (24h).
- [ ] **3h. Telegram alerts** — a phone ping fires on a real event. *(Needs a real Telegram bot token.)*
- [ ] **3i. Grab-on-reconnect** — a message parked while offline is pulled automatically on reconnect.
- [ ] **3j. Leave a message** — send to an offline contact; it waits at a relay and arrives when they return.

## Decision (not a test)
- [ ] **4. SEC-2** — the FROST signing forgery hole: launch-blocker or fast-follow? (See the SEC-2 finding + fix-proposal docs.) Your call.

## After launch (not blocking M8C launch)
- [ ] **5. Multi-device (Tier 5)** — same agent on two devices, one Primary at a time. Directory side built+tested; ceremony-gate blocked on SEC-2; needs a two-device test.
- Parked to M9 by decision: the settings system (CONFIG-1) + opt-out/opaque/presence-visibility/TTL-override sub-clauses (D14–D19).

---
## Related
- [[M8C-DEFINITION-OF-DONE]] — per-line status + evidence
- [[M8C-BUILD-JOURNAL]] — the audit trail
