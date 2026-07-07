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
- **Finding (leave-a-message, 3i/3j):** Ms_Chelly (a NEW counterparty, unknown to CELLO_Support)
  `initiate_session` to the OFFLINE CELLO_Support hard-failed `counterparty_unavailable` — no message was
  ever sent; the relay-park path did not engage. Consistent with the **D19 parked** limitation (new-
  counterparty + offline recipient needs the unbuilt relay-discovery API). Run was racy (support came
  online mid-attempt), leaving a ghost half-open session with an auto-sent `"Dispatched."` (CONTACT-1) that
  the customer's side never sees — worth a look. So 3i/3j are NOT proven; the clean leave-a-message case is
  KNOWN-contact-with-an-existing-session (cello_send parks), not new-counterparty-cold.
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
