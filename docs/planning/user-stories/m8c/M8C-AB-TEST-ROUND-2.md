---
name: M8C A/B Test — Round 2 (cross-machine + channels-free deeper checks)
type: protocol
date: 2026-07-08
milestone: M8C
status: ready
topics: [live-test, verification, a-b-protocol, cross-machine, channels, cc-1, cc-3, cc-5, cc-10, abuse-1, doorbell, onboarding, oa-1, oa-2]
description: >
  Round-2 A/B test protocol after all 5 Round-1 phases passed on loopback. Covers the scenarios
  Round-1 left as optional or never touched: a real second party on a DIFFERENT machine, CC-10's
  automatic reaper live, CC-3 sole-online, the ABUSE-1 cap, the doorbell push, and reproducing the
  Phase-4 onboarding bug. Every test is tagged CHANNELS-REQUIRED or CHANNELS-FREE so it can be run
  during a window where the channels capability is temporarily unavailable. Live stack: daemon 0.0.36
  · cli 0.0.33 · connect 0.0.61.
---

# M8C A/B Test — Round 2

Round-1 ([[M8C-LIVE-AB-TEST-PROTOCOL]]) proved all 11 fixes + CC-10 on **single-daemon loopback**.
Round 2 covers what Round-1 left optional or never touched, and is written so the **channels-free**
tests can run even while the channels capability is temporarily down.

## The one thing to understand: channels = the doorbell

- The CELLO **channel** is the daemon pushing an *unprompted* event (`cello_message`,
  `session_state_changed`) into a live Claude Code session — the single `daemon → shim → Claude`
  channel. That push **is** the doorbell.
- If channels is down, **the doorbell won't fire** — but every MCP tool call still works, and you
  substitute **polling**: `cello_receive { session_id, timeout_ms }` blocks for a frame,
  `cello_check_notifications {}` lists what's pending. These are ordinary request/response tool calls,
  not channel pushes, so they need no channel.
- **Telegram is NOT a channel** (the daemon speaks the Bot API directly to your phone), so onboarding
  tests are unaffected by channels state either way.

**Poll-mode cheat sheet** — wherever a Round-1 step said "the doorbell fires, no polling," do this:

| Push (channels up) | Poll substitute (channels down) |
|---|---|
| `cello_message` arrives unprompted | `cello_receive { session_id, timeout_ms: 30000 }` |
| "you have a pending session" doorbell | `cello_check_notifications {}` (call it yourself) |
| `session_state_changed` on peer's initiate | `cello_list_sessions {}` / `cello_status` |

## Identities (reuse from Round-1)

| Role | Agent | Pubkey |
|---|---|---|
| local initiator | `Ms_Chelly` | `178d420b86beb79d2cd819647368d3e24739dcfa526a95f32c0e95ba3bc3e44c` |
| local receiver | `CELLO_Support` | `2ee9bed99385bf7d63950d3836d1b017c6cbd1692351fd6c21309971c3ae8689` |
| local alt receiver | `CELLO_Feedback` | `da0c73f892648da9c6edae58e2a6b96194bfc27ec3883946fd6d44448253f8b7` |
| second local agent | `Ms_Chelly_Hermes` | `77d0c8060d2885c9c9fbc71d0b2092a97bb19c0c3b927a9bcb3d2d53c15c7b43` |
| **remote party** | EC2 demo agent | **rotates — fetch live (R1 prereq); never trust STATE.md** |

`cello_use_agent { name }` is per-connection. Note: `cello_list_sessions {}` on the MCP tool returns
**open** sessions only (no `filter` param live); use `cello_status` to see `active_sessions` +
`interrupted_sessions`. A session that has been reaped/abandoned simply **disappears** from both —
that absence is the observable.

## Recommended order for a channels-down window

**R2 → R1 → R3 → R4** (all channels-free), plus **R6** if you want the onboarding evidence.
Save **R5** (doorbell) for when channels is back — it's the only test that genuinely needs it, and
it's already green from Round-1 Phase 3.

---

## R1 — Cross-machine: your agent ↔ a real remote agent  ·  🟢 CHANNELS-FREE (poll)

**The actual launch scenario:** connect and talk to an agent you do **not** control, running on a
different machine/network. Loopback proved the plumbing; this proves the product.

**Prereq — confirm the remote agent's LIVE identity (its pubkey rotates):**
```bash
# Read the demo instance's daemon log for the current agent.online pubkey.
CMD_ID=$(aws ssm send-command --instance-ids i-0ad3e7c22470f266e \
  --document-name AWS-RunShellScript --region us-east-1 \
  --parameters '{"commands":["grep -a agent.online $(ls -t /root/.cello*/daemon.log /home/*/.cello/daemon.log 2>/dev/null | head -1) | tail -3"]}' \
  --output text --query 'Command.CommandId')
sleep 5 && aws ssm get-command-invocation --command-id $CMD_ID \
  --instance-id i-0ad3e7c22470f266e --region us-east-1 \
  --query 'StandardOutputContent' --output text
```
Record the pubkey as **`P_demo`**. Also confirm the responder is up (the `cello-demo` service must be
running so the remote side answers). *If the demo is down, substitute your own second device (two agents
you control on two machines) — same launch value.*

**A (local — drive `Ms_Chelly`):**
1. `cello_use_agent { name: "Ms_Chelly" }`.
2. `cello_initiate_session { target_pubkey: "<P_demo>" }` → note **`S`**. ✅ `ok: true`.
   *(If `target_offline`: the pubkey is stale — re-fetch `P_demo` from the demo daemon log.)*
3. `cello_send { session_id: "<S>", content: "Hello from Ms_Chelly — cross-machine turn 1" }`.
4. **Poll for the reply (no doorbell):** `cello_receive { session_id: "<S>", timeout_ms: 30000 }`
   → ✅ the remote agent's reply frame returns across the wire.
5. Repeat **2 more turns** (send → poll-receive). ✅ each round-trips machine-to-machine.
6. **Close & seal:** send a final `[[WRAP]]`; after the remote also wraps,
   `cello_close_session { session_id: "<S>" }` (no `force` — a real session seals).
   ✅ `session_sealed`; `cello_get_sealed_receipt { session_id: "<S>" }` → a `sealed_root` present.

**✅ R1 PASS:** a message sent from your machine reached an agent you don't control on another machine;
its reply came back **by polling** (channels-free); the session **sealed with a matching root on both
sides** — the cross-machine hash-chain agreement, not just local echo.
**Proves:** the fundamental value — two agents connect and communicate when you control only one of them.

---

## R2 — CC-10 automatic reaper, live  ·  🟢 CHANNELS-FREE

CC-10 was proven by unit tests + the **manual** force-abandon that unblocked Phase 2. This watches the
**automatic** path fire live: dead 0-received half-opens self-abandon (reap-on-read) and get cleared
before the acceptance cap so a previously-locked-out stranger gets in (reap-before-bound).

**Setup — fast grace TTL** (default is 5 min; shorten to 5 s):
```bash
cello logout
CELLO_HALF_OPEN_TTL_MS=5000 cello login   # daemon inherits the env; grace window now 5 s
```
Reconnect the MCP (`/mcp`). *(You can skip the env override and use the real 5-min TTL — just wait
longer.)* The reaper only touches a **non-live** session, so the counterparty must actually go away.

**Part A — reap-on-read:**
1. **B** (`CELLO_Support`): `cello_contact_remove { pubkey: "178d42…Ms_Chelly" }`; `cello_contact_list {}`
   → `[]` (start from a clean count).
2. **A** (`Ms_Chelly`): `cello_initiate_session { target_pubkey: "2ee9be…Support" }` → note **`S1`**.
   **Send nothing** (0 received on B's side).
3. **A:** `cello_stop_agent { name: "Ms_Chelly" }` → A's node leaves, so B's `S1` loses liveness.
4. **Wait > 5 s** (past TTL).
5. **B:** `cello_status` (or `cello_list_sessions {}`). ✅ **`S1` is GONE** from active/open — abandoned
   on this read. Confirm in `~/.cello/daemon.log`: `session.half_open.reaped { priorStatus, ageMs }`.

**Part B — reap-before-bound (the headline):**
6. Stage **3** aged dead ghosts from Ms_Chelly: repeat {`cello_start_agent Ms_Chelly` → knock B →
   `cello_stop_agent Ms_Chelly`} three times, then **wait > 5 s**. B now holds 3 aged, 0-received,
   non-live sessions from Ms_Chelly (this is the exact "locked-out stranger" state).
7. **A:** `cello_start_agent { name: "Ms_Chelly" }`, `cello_use_agent { name: "Ms_Chelly" }`, then a
   **4th** `cello_initiate_session { target_pubkey: "2ee9be…Support" }`.
   ✅ It is **ACCEPTED**, not rejected — the accept path reaped the 3 dead ghosts before the cap check.
   `~/.cello/daemon.log` shows **3× `session.half_open.reaped`** then `session.inbound.accepted`, with
   **no** `abuse_bound_sessions_per_sender`.

**✅ R2 PASS:** dead 0-received half-opens auto-abandon on read (A) and are cleared before the acceptance
cap so a previously-blocked stranger is admitted (B) — CC-10's automatic behavior, live, no manual force.
**Proves:** CC-10 end-to-end. (The D18 guard — a *content-bearing* interrupted session must NOT reap —
is separately unit-pinned; it can't be freed here.)
**Reality note:** if loopback keeps liveness `alive` even after `cello_stop_agent` (transport lingers),
that's the "awkward on all-online loopback" case Round-1 flagged — the genuinely-remote peer from **R1**
(one you can actually disconnect) is the cleaner stage for this.

---

## R3 — CC-3 sole-online auto-resolve, live  ·  🟢 CHANNELS-FREE

With exactly **one** agent online and **none** selected on a connection, session tools resolve that
lone agent instead of failing `no_current_agent` (F18). Unit-verified in Round-1; here it's live.

1. Stop three of the four agents so only one is online (e.g. keep `Ms_Chelly`):
   `cello_stop_agent { name: "CELLO_Support" }`, `…Feedback`, `…Ms_Chelly_Hermes`.
   `cello_status` → only `Ms_Chelly` `state: "online"`.
2. Open a **fresh connection that has NOT run `cello_use_agent`** — reconnect the MCP, or use the CLI
   (it opens an ephemeral, unselected connection).
3. `cello_list_sessions {}` (or `cello_status`). ✅ it **returns for `Ms_Chelly`** — NOT
   `{ reason: "no_current_agent" }`.
4. **Contrast (the ambiguous guard still holds):** `cello_start_agent { name: "CELLO_Support" }` so 2
   are online, none selected. `cello_list_sessions {}` on the unselected connection → ✅ now
   `no_current_agent` (it must NOT guess between two).
5. Restore: `cello_start_agent` the remaining agents.

**✅ R3 PASS:** 1 online + none selected → auto-resolves the sole agent; 2 online + none selected →
`no_current_agent`. Both F18 branches, live.

---

## R4 — ABUSE-1 acceptance cap, live  ·  🟢 CHANNELS-FREE

One unknown sender may hold at most **3** concurrent sessions with an agent; the 4th is refused. This is
the anti-spam cap the old inbound auto-add used to defeat (pre-CC-1).

1. **B** (`CELLO_Support`): make Ms_Chelly a stranger and start from a **clean count** —
   `cello_contact_remove { pubkey: "178d42…Ms_Chelly" }`; `cello_contact_list {}` → `[]`. Clear any
   leftover ghosts first (run **R2 Part A**, or force-abandon stragglers) so the per-sender count is 0.
2. **A** (`Ms_Chelly`): `cello_initiate_session { target_pubkey: "2ee9be…Support" }` **three times**
   (a fresh session each). Keep A **online** (don't stop it — these must stay live/counting).
   ✅ all 3 accepted; `cello_status` (A) shows 3 active sessions to Support.
3. **A:** a **4th** `cello_initiate_session { target_pubkey: "2ee9be…Support" }`.
   - From A's side it returns `ok: true` (**the initiator-signal gap** — a known follow-up; A can't
     see the rejection).
   - The truth is in **B's** `~/.cello/daemon.log`: `session.inbound.accept.failed` /
     `reason: "abuse_bound_sessions_per_sender"`, and B's `cello_list_sessions {}` shows **no** 4th
     session from Ms_Chelly.
4. Cleanup: force-abandon or seal the 3; re-add Ms_Chelly (`cello_contact_add`) if continuing.

**✅ R4 PASS:** exactly 3 concurrent unknown-sender sessions admitted; the 4th refused (in B's daemon log;
absent from B's session list).
**Proves:** the anti-spam cap. **Note:** this is where the **initiator-side signal gap** is most visible —
A sees `ok: true` regardless of the receiver's refusal. Capture it as evidence for that follow-up.

---

## R5 — Doorbell (unprompted push)  ·  🔴 CHANNELS-REQUIRED — run when channels is back

The one test that genuinely needs channels: prove the daemon injects a `cello_message` into a **live**
session with **zero** polling — the channel itself. (Already green in Round-1 Phase 3; this is a re-confirm.)

1. **A** and **B** both bound (`cello_use_agent`), a session open between them (A initiates).
2. **B does NOT call `cello_receive`.** **A:** `cello_send { session_id, content: "doorbell ping" }`.
3. ✅ On **B**'s side a `cello_message` notification appears **unprompted** — that's the channel firing.
   Likewise `session_state_changed` surfaces on A's initiate with no poll.

**✅ R5 PASS:** the message surfaces on the peer with no poll call. **Proves:** the single CELLO channel
(daemon → shim → Claude). Low priority; do it only to re-confirm once channels returns.

---

## R6 — Onboarding email-recovery bug (characterize for triage)  ·  🟢 CHANNELS-FREE (needs Telegram)

Not a fix to verify — this **reproduces** the Phase-4 papercut with verbatim copy so its severity can be
judged before it's written as a story. Needs the ops-agent Telegram bot (`CelloConnectStaging`).

1. `/start` the registration bot.
2. Share phone when asked (the directory-privacy note should appear — OA-2).
3. At the email step, **deliberately typo** the address (e.g. `yourname@gmal.com`).
   - 🐛 **Defect 1:** the bot sends an OTP to the mistyped address with **no check** that it matches the
     account's on-file email. Capture the exact "code sent to …" message.
4. Try to recover **without** burning attempts: type the *correct* email into the code field, then send
   `/start`.
   - 🐛 **Defect 2:** the correct-email entry is treated as a wrong code ("attempts remaining"), and
     `/start` is **also** consumed as a wrong-code guess (burns an attempt) instead of restarting.
     Record each message + the attempts-remaining countdown.
5. Note the only working recovery: exhaust all 3 attempts → "code invalidated, provide email again" →
   only now can you re-enter the correct email.

**✅ R6 "PASS" (characterization):** both defects reproduced with verbatim bot copy — confirming (a) no
on-file-email match before OTP dispatch, (b) no escape from OTP-entry except burning all 3 attempts +
`/start` swallowed. **Produces the evidence for the severity/triage call; fixes nothing.**

---

## Round-2 coverage map

| Test | Proves | Channels |
|---|---|---|
| **R1** cross-machine | the launch scenario (connect to an agent you don't control, another machine) | 🟢 free (poll) |
| **R2** CC-10 auto reaper | dead-ghost self-abandon + reap-before-bound admits a locked-out stranger | 🟢 free |
| **R3** CC-3 sole-online | F18 auto-resolve (1 online) + ambiguous guard (2 online) | 🟢 free |
| **R4** ABUSE-1 cap | 3-session per-unknown-sender cap; 4th refused | 🟢 free |
| **R5** doorbell | the single daemon→shim→Claude channel (unprompted push) | 🔴 required |
| **R6** onboarding bug | reproduces the email-recovery papercut for triage | 🟢 free (Telegram) |

---

## Related
- [[M8C-LIVE-AB-TEST-PROTOCOL]] — Round 1 (all 5 phases PASS on loopback); this doc continues it
- [[M8C-FIX-PLAN]] — RESUME STATE (fix run closed) + the two post-launch follow-ups R4/R6 feed
- [[M8C-DECISIONS]] — D25 (CC-5 reap/force), D26 (CC-10 reaper scope + doorbell-rate residual)
- [[M8C-BUILD-JOURNAL]] — Entry 60 (CC-10), Entry 61 (fix run closed)
