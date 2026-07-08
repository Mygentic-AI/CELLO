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

### ✅ PHASE 0 RESULTS — run 2026-07-08

**A (Ms_Chelly):** `cello_status` → `{"daemon":"running","directory_signaling":"connected","agents":[
{"name":"CELLO_Feedback","state":"online","selected":false,"standing_receiver_ready":true},
{"name":"CELLO_Support","state":"online","selected":false,"standing_receiver_ready":true},
{"name":"Ms_Chelly","state":"online","selected":true,"standing_receiver_ready":true}],
"interrupted_sessions":[...3 pre-existing entries, incl. the `5749859a…` ghost targeted in Phase 1...],
"active_sessions":[]}` — ✅ online + `standing_receiver_ready: true`, ✅ no `connections` field.
Versions confirmed: CLI `0.0.32` (`~/.npm-global/lib/node_modules/@cello-protocol/cli/package.json`),
connect `0.0.61` (`npx @cello-protocol/connect@beta --version`) — matches the doc's target.

**B (CELLO_Support):** `cello_status` → ✅ online + `standing_receiver_ready: true`, ✅ no
`connections` field. `cello_contact_list {}` → `{"ok":true,"agent":"CELLO_Support","contacts":
[{"pubkey":"178d42...44c","added_at":1783446042779}]}` — ✅ tool exists and returns (**CC-9**);
Ms_Chelly is currently a known contact from prior tests (as expected — removed in Phase 2 step 1).
`cello_contact_add`/`cello_contact_remove` confirmed present in the tool list; `cello_close_session`
confirmed to have a `force` param.

**Both sides mid-session-reconnect note:** partway through this run the cello MCP server on A's side
dropped (`ipc_connection_lost`) and an in-session `/mcp reconnect cello` initially failed, then
succeeded on retry — full tool set (`mcp__cello__*`) came back after the second reconnect attempt,
no Claude Code restart required.

**✅ PHASE 0 PASS — confirmed on both A and B**, daemon `0.0.35` / cli `0.0.32` / connect `0.0.61`.

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

### ✅ PHASE 1 RESULTS — run 2026-07-08

**B (CELLO_Support):**
1. `cello_list_sessions {}` (no `filter` param on this MCP tool — schema differs from the doc's
   `filter: "all"`, returns `open` by default) → `totalMatched: 2`, `5749859a8380d55f98fdd4436ca7ee1d`
   present, `status: "interrupted"`, `messageCount: 1` ✅.
2. Normal close: `cello_close_session { session_id: "5749859a…" }` →
   `{"ok":false,"reason":"seal_interrupted_rejected_by_counterparty","guidance":"The counterparty
   rejected the seal-interrupted request..."}` — trap confirmed, does not cleanly seal ✅.
3. Force close: `cello_close_session { session_id: "5749859a…", force: true }` →
   `{"ok":true,"status":"abandoned","reason":"force_abandoned"}` ✅.
4. `cello_list_sessions {}` → `totalMatched: 1`; `5749859a…` **gone** from open ✅.
5. `dd7493f265fd53dcf5067982fcd15659` (msgCount 6) left untouched, still `status: "interrupted"`,
   still present in the open list ✅ — force-abandon touched only the ghost.

**✅ PHASE 1 PASS — confirmed on B.** Normal close hit `seal_interrupted_rejected_by_counterparty`
(the pre-CC-5 dead end); `force: true` abandoned it cleanly; it left the open list; the real
6-message session was untouched.

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

### ⛔ PHASE 2 RESULTS — run 2026-07-08 — BLOCKED at step 3/4

Step 1 (B removes Ms_Chelly, confirms `contacts: []`) and step 2 (A knocks, session
`11e152ba2ff46ec1f71d2dad9df02de8` returned `ok:true`) completed normally. Step 3 (B confirms
Ms_Chelly still absent) also passed. **Step 4 failed** — B could not engage with the session at all:

- `cello_check_notifications {}` → nothing pending, no unread.
- `cello_receive { session_id: "11e152ba2ff46ec1f71d2dad9df02de8" }` → `{"ok":false,"reason":"session_not_found"}`.
- `cello_list_sessions` (B) → session absent entirely; only the pre-existing `dd7493…` interrupted session shows.
- `cello_status` (A) → session **does** exist, but only on Ms_Chelly's side: `active_sessions:
  [{"sessionId":"11e152ba...","agentName":"Ms_Chelly","counterpartyPubkey":"2ee9bed9...","liveness":"alive"}]`.

**Root cause, confirmed from `~/.cello/daemon.log`:** the session was rejected on Support's inbound
side by the anti-abuse cap, silently:

```
session.inbound.assignment.unverified  sessionId=11e152ba...  agentName=CELLO_Support
session.inbound.accept.failed          sessionId=11e152ba...  agentName=CELLO_Support  reason="abuse_bound_sessions_per_sender"
(repeats once more, second correlationId — retry, same reason)
session.negotiate.assignment.received  agentName=Ms_Chelly
session.node.created                   sessionId=11e152ba...  agentName=Ms_Chelly
session.transport.connected             sessionId=11e152ba...
```

**Findings, in order of what's provable:**

1. **The cap is being enforced on this build** — 2 identical `session.inbound.accept.failed` /
   `abuse_bound_sessions_per_sender` entries for `11e152ba…` at `12:57:32`. This reverses the earlier
   pre-fix result where 4 sequential unknown-sender sessions all sailed through with `ok:true`.
2. **Historical count**: 9 total inbound sessions ever accepted for CELLO_Support; cross-referencing
   session IDs against earlier test steps, at least 6 originated from Ms_Chelly's pubkey: `dd7493…`
   (still interrupted, msgCount 6), `5749859a…` (force-abandoned in Phase 1), and the 4 from the
   earlier abuse-cap test (`e3384957…`, `a2359c8b…`, `42bb8a07…`, `96dc658c…`).
3. All 4 of those abuse-cap-test sessions show `session.node.destroyed` / `reason: "interrupted"` at
   `2026-07-08T12:17:59.6xx` — the same instant `dd7493…` was also interrupted (a shared
   daemon-restart event), not a close/seal/abandon.
4. None of the 4, nor `dd7493…`, show any subsequent close/seal/abandon event — yet none are visible
   in `cello_list_sessions` or `cello_status` anymore either (only `dd7493…` shows as interrupted).

**What can't be proven from logs alone:** whether `abuse_bound_sessions_per_sender` decrements on
interruption/force-abandon, or is a monotonic per-sender counter that never releases. Finding 4 is
suggestive (sessions vanished from view but may still count toward the cap) but not conclusive
without reading the counter's source/DB state.

**Initiator-side signal gap (separate from the cap question):** `cello_initiate_session` returned
`ok:true` with zero indication of the receiver's rejection — both the earlier 4-session ABUSE-1 test
and this one look identical from A's side (all `ok:true`) regardless of whether the receiver actually
accepted. The receiver also gets no notification and no session-list entry for a rejected inbound —
the rejection is invisible to both parties without reading the daemon log directly.

**This blocks Phase 2 as scripted.** Two ways to unblock (not yet decided):
- Force-abandon `dd7493…` too (same as Phase 1) and re-test — but Phase 1 explicitly said to leave it
  alone as "a real interrupted conversation." Doing this now would answer the counter question but
  contaminates that earlier result.
- Use a fresh identity pair for Phase 2 instead of reusing Ms_Chelly/Support, sidestepping the stale
  bound-count entirely.

### ✅ PHASE 2 BLOCK — DIAGNOSED & UNBLOCKED (2026-07-08, from source)

**The counter question is answered: the cap is NOT monotonic.** It is a live DB query —
`COUNT(*) WHERE agent = Support AND counterparty = Ms_Chelly AND status IN ('active','interrupted')`,
cap **3** per unknown sender (`session-node-manager.ts:913`, `ABUSE_MAX_SESSIONS_PER_UNKNOWN_SENDER`
at `:109`). Terminal statuses (`sealed`, `abandoned`) release their slot — Phase 1's force-abandon
of `5749859a…` really did free one.

**Why it still rejected:** Support's DB held **5** counting sessions from Ms_Chelly — `dd7493…`
(interrupted, real) **+ the 4 abuse-test sessions** (`e3384957…`, `a2359c8b…`, `42bb8a07…`,
`96dc658c…`), all flipped to `interrupted` by the shared daemon-restart event (finding 3 above).
5 ≥ 3 → reject. Counting `interrupted` is **deliberate** (D18 reviewer-HIGH fix: otherwise an
attacker evades the bound by disconnecting) — not the bug.

**The actual defect — a gap between two shipped fixes (filed as CC-10):** the CC-5 reaper only
scans `status = 'active'` (`daemon.ts:1758`), so an interrupted 0-received ghost is never reaped;
and `classifySession` maps interrupted + msgCount 0 → `failed`, so such sessions appear in **no
list**. Net effect: invisible, unreapable sessions that permanently consume the sender's abuse
budget. A stranger whose first 3 handshakes die (daemon restart, network) is silently locked out
of that operator forever — a "can't connect" failure, launch-relevant.

**Unblocked (2026-07-08):** all 4 ghosts force-abandoned by full ID over daemon IPC
(`cello_close_session { force: true }` works on any owned non-sealed session even when invisible —
`daemon.ts:3265`). All returned `{ok:true, status:"abandoned", reason:"force_abandoned"}`;
`dd7493…` untouched (still interrupted, msgCount 6). Support's per-sender count for Ms_Chelly
is now **1 of 3** → Phase 2 re-runs as scripted against Support.

**Fix decision (Andre, 2026-07-08): fix it — CC-10.** Extend the reaper's scan to
`('active','interrupted')`, keeping every existing gate (0-received, liveness ≠ alive,
age > TTL). Safe vs the D18 evasion attack: those sessions always have received > 0 on the
victim's side, so they never qualify — a 0-received interrupted session represents zero
delivered abuse. Implement + commit now; **publish cascade held until the A/B run completes**
(one batched cascade; a mid-run daemon restart is exactly the event that mints these ghosts).

### ✅ PHASE 2 RE-RUN RESULTS — run 2026-07-08 — UNBLOCKED, PASS (CC-10 shipped)

CC-10 shipped as daemon `0.0.36` / cli `0.0.33` (tag `v0.0.82`, cello-client commit `79030e3`),
promoted to `latest`, live daemon restarted `14:38:35`. Re-ran Phase 2 as scripted on the new binary,
session `e700842ac52414043d696753cb1c195a`:

1. **A** (`Ms_Chelly`): re-selected agent (daemon restart cleared this connection's selection), then
   `cello_initiate_session` → `{"ok":true,"sessionId":"e700842ac52414043d696753cb1c195a",...}` — knock
   **accepted** this time (vs. the silent `abuse_bound_sessions_per_sender` rejection pre-CC-10).
2. **B** (`CELLO_Support`): `cello_contact_list {}` → `contacts: []` — ✅ Ms_Chelly absent after the knock.
3. **B:** engaged — `cello_check_notifications {}` found the pending session; `cello_receive` timed out
   (A was blocking on receive, nothing to read yet); `cello_get_transcript` showed only the auto-
   "Dispatched." ack (seq 0); `cello_send { content: "Hi Ms_Chelly — support here, how can I help?" }`
   → `{"ok":true,"sequence_number":1,"delivered":true}`. **A** received both the auto-ack (seq 0) and
   the real reply (seq 1) via separate doorbell pushes.
4. **B:** `cello_contact_list {}` → `contacts: [{"pubkey":"178d42...","added_at":1783521835888}]` —
   ✅ Ms_Chelly **now present** — promoted by the reply.

**✅ PHASE 2 PASS (re-run) — confirmed on both A and B.** Knock alone left the stranger unknown; only
the operator's reply promoted her to known (**CC-1** promote-on-reply, confirmed working end-to-end on
the CC-10 build, `1771` tests green, reviewer verdict SPEC FAITHFUL / NO SILENT FALLBACKS / TESTS HAVE
TEETH). **D26 accepted trade** (logged separately): for a stranger who never sends a byte, the cap is
now a 3-per-5-min rate limit instead of a lifetime lock — deliberate, since 0-received means zero
delivered abuse.

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

### ✅ PHASE 3 RESULTS — run 2026-07-08 — ran against CELLO_Feedback, not Support

Run against **CELLO_Feedback** (`da0c73f892648da9c6edae58e2a6b96194bfc27ec3883946fd6d44448253f8b7`)
instead of Support — Support's per-sender bound-session count is still poisoned from the Phase 2
block, so Feedback was used to sidestep it rather than resolve it. Session `9a557bafb4a60be0da26acec348460bd`.

1. **A** (`Ms_Chelly`): `cello_initiate_session` → `ok:true`. First `cello_receive` returned the
   away-auto-reply ("Agent is currently away... queued") — Feedback wasn't attended yet on B's side.
2. **B:** switched to `CELLO_Feedback`, engaged the queued session. ✅ **doorbell fired unprompted on
   both sides** — B saw the pending-session notification then a `cello_message` push on A's Turn 1; A
   saw a `cello_message` push on B's replies throughout, zero polling either direction.
3. **3 turns each way**, alternating `cello_send` → block on `cello_receive`. ✅ **read-before-write
   held** — B hit one `session_not_current` on their first send, resolved exactly per the documented
   workaround (`cello_get_transcript` then retry).
4. **Mutual `[[WRAP]]`**, then `cello_close_session` on both sides. ✅ **sealed_root matches on both
   sides**: `48a468d8af7acf4784778e8111ed0ee6c7e5059767a3f97a3415dbc5fb91d857`, both participants
   `attestation_mode: "live"`.

**Observation (not a failure, flagged by B):** the sealed receipt shows asymmetric bookkeeping —
Ms_Chelly `content_frontier_seq: 8, last_authored_seq: 9`; Feedback `content_frontier_seq: 6,
last_authored_seq: 8`; a `final_message` from Feedback at `seq: 7, answered: false`. Likely seal-
ceremony/close-handshake messages generated automatically when each side called `cello_close_session`
(not unread real content — the 3 real turns each way were already exchanged and acked before either
side wrapped). Not verified against daemon-log ground truth; noted for the record since the sealed
root matching on both sides is the actual integrity proof here, not the seq bookkeeping.

**✅ PHASE 3 PASS — confirmed on both A and B**, run against CELLO_Feedback as a substitute target.

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

### ⚠️ PHASE 4 RESULTS — run 2026-07-08 — PASS with one confirmed bug found

New agent `Ms_Chelly_Hermes` (`77d0c8060d2885c9c9fbc71d0b2092a97bb19c0c3b927a9bcb3d2d53c15c7b43`),
registered via the ops-agent Telegram bot (`CelloConnectStaging`) as a second agent on Andre's
existing account (phone `+971 58 508 9156`).

1. ✅ **CC-7**: `cello --help` opened with what CELLO is + the onboarding path
   (`login → create-agent → register → status`), not a bare command list.
2. **Telegram register** — ✅ **OA-1** confirmed: token message gave a runnable
   `cello register [YOUR_NAME] CELLO-CgcJ88ctZFA6FEqDtw8wMnq462NyA4irS` (token inlined) +
   `cello create-agent [YOUR_NAME]`, never mentions an env var. ✅ OA-2 phone-ask privacy note present
   verbatim ("only irreversible hashes... No one... will ever call you"). ✅ OTP 15-min lifetime stated.
   ❌ **OA-2 O3 not observed**: no "rate-limit... up to an hour" copy appeared anywhere in the
   transcript after invalidation — the bot just says "provide your email address again."
3. ✅ **CC-6**: `register` output's next-step guidance was multi-line, 3 separate bullets.
4. ✅ **CC-2 / CC-8**: immediately after `register` (no logout/login), `cello status` showed
   `Ms_Chelly_Hermes` `state: "online"`, `standing_receiver_ready: true`.
5. ✅ **Receive-cold proof**: from A (`Ms_Chelly`), `cello_initiate_session { target_pubkey:
   "77d0c8060d2885c9c9fbc71d0b2092a97bb19c0c3b927a9bcb3d2d53c15c7b43" }` → `{"ok":true,"sessionId":
   "b563678ea1cfe1a4162c6034f4ffabb9",...}`. Switched this connection's current agent to
   `Ms_Chelly_Hermes` (same daemon, per-connection selection) and confirmed via `cello_status`: session
   `b563678e…` shows `active`/`alive` on **both** sides (`Ms_Chelly_Hermes` ↔ `Ms_Chelly`), and the
   doorbell (`cello_message` push) landed on A's channel unprompted. Hermes received cold, no restart.

**🐛 Bug found — mistyped email during registration has no clean recovery path:**

Transcript (verbatim, Telegram):
1. Bot: "Please enter the same email address you registered with the first time."
2. Andre (typo): `apemmelaar@gmal.com` → bot: "A 6-digit verification code has been sent to
   apemmelaar@gmal.com" — **sent an OTP to a mistyped, non-owned address with no validation that it
   matches the account's on-file email**, despite the bot's own copy requiring "the same email."
3. Andre then typed the *correct* email (`apemmelaar@gmail.com`) into the OTP-code field →
   "Incorrect code. You have 2 attempts remaining." (expected — not a 6-digit code, but there is no
   affordance here to say "actually let me retype the email").
4. Andre sent `/start` (attempting to restart) → bot: "Incorrect code. You have 1 attempt remaining."
   — **`/start` was consumed as a wrong-code guess**, burning an attempt, rather than being treated as
   a restart or rejected without penalty.
5. Andre re-typed the correct email again → "Too many incorrect attempts. Your code has been
   invalidated. Please provide your email address again to get a new code." — only *now* does the bot
   return to email-entry.
6. This repeated once more (typo `apemmelaar@gamil.com` → OTP sent to wrong address again → 3 more
   burned attempts) before the correct email finally got a deliverable OTP and registration completed.

**Root cause, two distinct defects:**
- No match-check between the typed email and the account's on-file email before dispatching an OTP —
  any email-shaped string gets a code sent to it.
- No escape hatch from OTP-entry back to email-entry except exhausting all 3 attempts — and `/start`
  is swallowed as a wrong-code guess instead of being handled as a restart. (Contrast: `/start` sent
  during *email-entry* state was correctly ignored/re-prompted — the inconsistency is state-dependent.)

Andre: *"I managed to figure out how to solve the problem by just deliberately failing. But the whole
three times deliberately failed doesn't even make sense."* — i.e. the only way to correct a typo is to
discover, by trial, that burning 3 OTP attempts is the reset mechanism.

**Not filed as a story yet — triage question open:** onboarding is on the launch-critical path (agent
connect), but this is a recoverable-with-effort papercut, not a hard block (Andre did complete
registration). Needs an explicit call on severity before writing it up as a story.

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
