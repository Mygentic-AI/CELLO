---
name: M8C Live A/B Test Protocol
type: protocol
date: 2026-07-08
milestone: M8C
topics: [live-test, verification, a-b-protocol, cc-1, cc-2, cc-3, cc-4, cc-5, cc-6, cc-7, cc-8, cc-9, oa-1, oa-2, f21, screening, contacts, onboarding]
description: >
  The full two-agent (A/B) live verification protocol for the M8C fix run — every shipped fix
  (CC-1…CC-9, OA-1/OA-2) exercised end-to-end on the published `latest` binaries. Single-daemon
  loopback: A drives Ms_Chelly, B drives CELLO_Support/CELLO_Feedback, two Claude Code windows on
  one daemon. Each phase = A steps + B steps + a ✅ PASS bar + which fix it proves.
---

# M8C Live A/B Test Protocol

## Setup (both windows, once)

Both A and B are Claude Code sessions on the **same machine / same daemon** (loopback). Confirmed
running on `@latest`: connect **0.0.61** · cli **0.0.32** · daemon **0.0.35**. All 3 agents online,
`standing_receiver_ready: true`.

**Identities (pubkeys):**
| Role | Agent | Pubkey |
|---|---|---|
| **A** (outsider / initiator) | `Ms_Chelly` | `178d420b86beb79d2cd819647368d3e24739dcfa526a95f32c0e95ba3bc3e44c` |
| **B** (operator / receiver) | `CELLO_Support` | `2ee9bed99385bf7d63950d3836d1b017c6cbd1692351fd6c21309971c3ae8689` |
| **B** (alt receiver) | `CELLO_Feedback` | `da0c73f892648da9c6edae58e2a6b96194bfc27ec3883946fd6d44448253f8b7` |

**Bind each window to its agent first:**
- **A:** `cello_use_agent { name: "Ms_Chelly" }`
- **B:** `cello_use_agent { name: "CELLO_Support" }`

`cello_use_agent` is **per-connection** — each window selects independently; they don't fight.

**How to run:** Andre conducts, advancing phase by phase. Within a phase, do A's steps and B's steps
in the numbered order (the cello messages are the sync channel). Each phase ends with a **✅ PASS** bar
— confirm it before moving on. Report FAIL loudly with the exact tool output.

---

## Phase 0 — Sanity + the new shim loaded (CC-4, CC-8, CC-2, CC-9)

**A & B:** `cello_status`
- ✅ each selected agent shows `state: "online"` + `standing_receiver_ready: true` (**CC-2**, **CC-8**).
- ✅ the response has **no `connections` field** (**CC-4** — the empty stub is gone).

**B:** `cello_contact_list {}`
- ✅ the tool **exists and returns** (this MCP tool did not exist before this run → **CC-9** loaded).

**A & B:** confirm `cello_contact_list`, `cello_contact_add`, `cello_contact_remove`, and a `force`
param on `cello_close_session` are all present in the tool list (the new connect 0.0.61 shim).

---

## Phase 1 — CC-5 / F21: force-abandon a stuck half-open ghost

Target the real ghost from earlier testing: **`5749859a8380d55f98fdd4436ca7ee1d`** on CELLO_Support
(msgCount 1 = only its own auto-"Dispatched." — a dead handshake Ms_Chelly abandoned; it is
`interrupted`/resumable-looking and cannot be sealed, the classic F21 trap).

1. **B** (`CELLO_Support`): `cello_list_sessions { filter: "all" }` → note `5749859a…` is present.
2. **B:** try a **normal** close first to see the trap:
   `cello_close_session { session_id: "5749859a8380d55f98fdd4436ca7ee1d" }`
   - Expected: it does NOT cleanly seal (times out / `seal_interrupted_*` / `session_not_closeable`) —
     this is the pre-CC-5 dead end. *(If it errors, that's the point; continue.)*
3. **B:** the terminal escape — force it:
   `cello_close_session { session_id: "5749859a8380d55f98fdd4436ca7ee1d", force: true }`
   - ✅ returns `{ ok: true, status: "abandoned", reason: "force_abandoned" }`.
4. **B:** `cello_list_sessions { filter: "open" }` → ✅ `5749859a…` is **gone** from open.
   `cello_list_sessions { filter: "all" }` → ✅ `5749859a…` now shows `status: "abandoned"`.
5. **B:** leave **`dd7493…` (msgCount 6) alone** — it's a real interrupted conversation, correctly still
   resumable. ✅ force-abandon touched only the ghost, not the real session.

**Reap-on-read note (CC-5 part a):** the automatic reaper abandons an **active**, 0-*received*, non-live
half-open once it ages past 5 min. It's covered by unit tests and fires on any real dead half-open
(offline-counterparty case); it's awkward to stage on this all-online loopback, so **force-abandon is the
live proof here.** *(To watch the reaper live: with the daemon started under `CELLO_HALF_OPEN_TTL_MS=5000`,
create an active half-open to an offline peer, wait, then `cello_list_sessions` → it flips to `abandoned`.)*

**✅ PHASE 1 PASS:** normal close couldn't clear the ghost; `force: true` abandoned it; it left the open
list; the real 6-message session was untouched.

---

## Phase 2 — CC-1 screening + CC-9 contact management (the headline security fix)

**Goal:** prove a stranger who knocks is **NOT** auto-whitelisted, and becomes known **only** when the
operator engages. Ms_Chelly is currently a known contact of Support (from prior tests), so first make her
a stranger again.

1. **B** (`CELLO_Support`): `cello_contact_list {}` → if Ms_Chelly (`178d42…`) is listed, remove her:
   `cello_contact_remove { pubkey: "178d420b86beb79d2cd819647368d3e24739dcfa526a95f32c0e95ba3bc3e44c" }`
   - ✅ `{ ok: true, removed: true }`. `cello_contact_list {}` → Ms_Chelly **absent**. She is now unknown.
2. **A** (`Ms_Chelly`): knock — open a session to Support:
   `cello_initiate_session { target_pubkey: "2ee9bed99385bf7d63950d3836d1b017c6cbd1692351fd6c21309971c3ae8689" }`
   - Note the returned `session_id`. A may get an auto-ack; that's fine.
3. **B:** `cello_contact_list {}`
   - ✅ **Ms_Chelly is STILL absent** — the inbound knock did **NOT** auto-add her. *(This is the whole
     fix: pre-CC-1 she'd already be back in the list here.)*
4. **B:** now the operator ENGAGES — read and reply into that session:
   - `cello_check_notifications {}` → see the pending session / unread from `178d42…`.
   - `cello_receive { session_id: "<the id from step 2>", timeout_ms: 5000 }` (read A's frame).
   - `cello_send { session_id: "<the id>", content: "Hi Ms_Chelly — support here, how can I help?" }`
5. **B:** `cello_contact_list {}`
   - ✅ **Ms_Chelly is NOW present** — a committed reply promoted her to known (**CC-1 promote-on-reply**).

**Optional deeper check — anti-spam (ABUSE-1):** first re-remove Ms_Chelly (step 1). Then **A** opens
**4 sequential** sessions to Support (`cello_initiate_session` ×4, new each time). ✅ Ms_Chelly stays
absent from Support's contacts throughout, and Support refuses the 4th unknown-sender session (visible in
the daemon log as `session.inbound.accept.failed` / `abuse_bound_sessions_per_sender`). Restores the cap
that the old auto-add defeated. *(Re-add her afterward — `cello_contact_add`, or just reply — so Phase 3
runs as a known contact.)*

**✅ PHASE 2 PASS:** a knock alone left the stranger unknown; only the operator's reply promoted her;
`cello_contact_list/remove/add` all worked over MCP (**CC-9**).

---

## Phase 3 — Core session + doorbell + read-before-write (regression + CC-3)

Now Ms_Chelly is a known contact. Run a real conversation, batting back and forth (walkie-talkie turn
rule: **one send → always block on receive**; two mutual `[[WRAP]]` closes to end → seal).

1. **A** (`Ms_Chelly`): `cello_initiate_session { target_pubkey: "2ee9be…Support" }` → note `session_id`.
2. **B** (`CELLO_Support`): ✅ **doorbell fires unprompted** — a `session_state_changed` (and, on A's
   first message, a `cello_message`) notification arrives with **zero polling**. `cello_check_notifications`
   confirms the pending session if needed.
3. **Bat back and forth (≥3 turns each):**
   - **A:** `cello_send { session_id, content: "Turn 1 from Ms_Chelly" }` → then **block**:
     `cello_receive { session_id, timeout_ms: 30000 }`.
   - **B:** on the doorbell, `cello_receive { session_id, timeout_ms: 30000 }` → reply
     `cello_send { session_id, content: "Turn 1 from Support" }` → then block on `cello_receive`.
   - Continue alternating. ✅ every message arrives via the doorbell, **no polling**; no talking over each
     other (the **read-before-write** gate refuses a send until you've `cello_receive`d the latest — if you
     ever get `session_not_current`, `cello_get_transcript { session_id }` then retry the send).
4. **Close & seal:** each side sends a final `[[WRAP]]` and, after both have, `cello_close_session
   { session_id }` (no force — a real session seals). ✅ both get `session_sealed`; `cello_get_sealed_receipt
   { session_id }` shows the same `sealed_root` on both sides.

**CC-3 note (sole-online F18):** with 3 agents online, session tools require a selected agent (each window
already did `cello_use_agent`) — the *ambiguous* branch is correct here. The sole-online auto-resolve
(1 agent online, none selected → still works) is a single-agent-daemon scenario, unit-test-verified; to
see it live, stop two agents (`cello_stop_agent` ×2) so exactly one is online, open a fresh window
**without** `cello_use_agent`, and call `cello_list_sessions` → ✅ it resolves the sole agent instead of
`no_current_agent`.

**✅ PHASE 3 PASS:** doorbell both directions with no polling; ordered exchange with read-before-write;
clean bilateral seal.

---

## Phase 4 — Cold onboarding (OA-1, OA-2, CC-2, CC-6, CC-7, CC-8) — *optional, needs Telegram*

Prereq: the ops-agent Telegram bot reachable + a way to start a fresh registration. Do this as a
**brand-new operator** (fresh agent name), using only what the tool/bot output tells you — no docs.

1. **Top-level help (CC-7):** `cello --help` → ✅ opens with what CELLO is + the onboarding path
   (`login → create-agent → register → status`), not a bare command list.
2. **Telegram register:** run the bot's registration flow (`/start` → share phone → email → OTP).
   - ✅ **OA-2 item 2:** the phone ask carries the directory-scoped privacy note (hashes only; "no one will
     ever call you"). ✅ **OA-2 O2/O3:** OTP message states the 15-min lifetime; rate-limit says "up to an hour".
   - ✅ **OA-1:** the token message gives a **runnable** `cello register [YOUR_NAME] <token>` (token inlined)
     + `cello create-agent [YOUR_NAME]` — and **never** says "set CELLO_REGISTRATION_TOKEN".
3. **Create + register** following that message exactly:
   `cello create-agent <NewName>` → `cello register <NewName> <token>`.
   - ✅ **CC-6:** the `register` output's next-step guidance is multi-line (status cues on separate bullets).
4. **CC-2 — the key one:** immediately (no logout/login) `cello status`.
   - ✅ `<NewName>` shows `state: "online"` (**CC-8**) **and `standing_receiver_ready: true`** — the fresh
     agent can receive right away, with **no restart** (pre-CC-2 it was `false` until login).
5. **Prove receive works cold:** from window **A**, `cello_initiate_session { target_pubkey: <NewName pubkey> }`
   → ✅ `<NewName>` receives the doorbell / can `cello_receive` — without ever having been restarted.

**✅ PHASE 4 PASS:** the Telegram copy is accurate and runnable; a freshly-registered agent is immediately
receivable.

---

## Summary — fix → phase map

| Fix | Proven in |
|---|---|
| **CC-1** stranger-stays-unknown + promote-on-reply | Phase 2 |
| **CC-2** register arms the receiver | Phase 0 (all `true`) + Phase 4 step 4 |
| **CC-3** F18 sole-online | Phase 3 note (single-agent variant) |
| **CC-4** dropped empty `connections` | Phase 0 |
| **CC-5** F21 force-abandon (+ reap note) | Phase 1 |
| **CC-6** register next-step multi-line | Phase 4 step 3 |
| **CC-7** top-level `cello --help` | Phase 4 step 1 |
| **CC-8** CLI status shows `online` | Phase 0 + Phase 4 |
| **CC-9** contact tools on MCP | Phase 0 + Phase 2 |
| **OA-1** token env-var copy | Phase 4 step 2 |
| **OA-2** onboarding copy overhaul | Phase 4 step 2 |
| core doorbell / read-before-write / seal (regression) | Phase 3 |

---

## Related
- [[M8C-FIX-PLAN]] — the fixes + ▶ RESUME STATE (ship + verification checklist this doc executes)
- [[M8C-LIVE-TEST-CHECKLIST]] — prior live evidence + what was proven before the fixes
- [[2026-07-07_1700_four-level-screening-policy]] — CC-1 / D21 screening model
- [[M8C-DECISIONS]] — D22–D25 (the design decisions behind CC-2/OA-2/CC-8/CC-5)
