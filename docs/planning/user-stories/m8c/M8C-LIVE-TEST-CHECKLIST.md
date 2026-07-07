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
- [~] **2b. Inbox** — `cello_check_notifications` returns pending requests + unread messages.
  **PARTIAL 2026-07-07:** `check_notifications` correctly *pulled* a pending session request. Still owed:
  (i) the **unread-message** half (no message was actually delivered in the run), and (ii) the
  **proactive-wake-on-reconnect** question — we preempted it by instructing the check, so we only proved
  the inbox is pullable, not pushed when an agent comes online. Re-test: bring an agent online with
  something waiting and watch whether it surfaces *unbidden*. DOD-INBOX-1 stays 🟡.
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

## Confirm-live pass — everything else that's built
- [ ] **3a. Catch up after away** — `cello_receive({ since_seq })` returns everything missed in one batch.
- [ ] **3b. Login = all agents online** — `cello login` brings every registered agent online at once.
- [ ] **3c. Two windows in sync** — same agent in two sessions; read-before-write (no talking over each other).
- [ ] **3d. Away auto-reply** — unattended agent answers with the away note and queues messages.
- [ ] **3e. Contacts whitelist** — known contact auto-accepts; a stranger gets the limited response.
- [ ] **3f. Anti-spam limits** — oversized / flooding message is capped (per-message, per-session, per-stranger).
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
