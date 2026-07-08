---
name: M8C A/B Test — Round 3 (infrastructure-staged)
type: protocol
date: 2026-07-08
milestone: M8C
status: ready
topics: [live-test, verification, a-b-protocol, relay, leavemsg, relaywake, telegram, tgdoor, offline-delivery, async, infra-staging]
description: >
  Round-3 A/B tests that CANNOT be run against the plain running system — each needs infrastructure
  staged or toggled: a reachable relay + a genuinely-offline recipient on a separate daemon
  (LEAVEMSG-1 / RELAYWAKE-1), the relay turned OFF to prove honest degradation, or a real Telegram bot
  token + allowlisted chat (TGDOOR-1). This is the whole "asynchronous / offline delivery" category the
  synchronous Round-1/2 tests structurally cannot reach. Pairs with Round-2 (no-infra) and the coverage
  ledger.
---

# M8C A/B Test — Round 3 (infrastructure-staged)

Round-1/2 exercise the **synchronous, both-parties-reachable** axis. This doc covers what needs
**infrastructure staged or toggled** — the offline / store-and-forward category, plus the Telegram
doorbell. Each test names its staging prerequisite up front.

**Why these can't be no-infra:** parking a message needs a **reachable relay** + the recipient reported
**unreachable by the directory**, and on single-daemon loopback both agents share one daemon (no
directory round-trip, no relay hop). So the offline path structurally requires a **second daemon** that
goes offline and a **relay** that holds the frame — that is staging, not a tool call. The Telegram
doorbell needs a **real bot token** configured as a daemon setting.

**Staging inventory (confirm before starting):**
- **Relay node** deployed + reachable — check `infra/STATE.md` for the relay stack + endpoint; the
  sender's daemon must have a **persisted relay endpoint** (established by a prior relayed session with
  the counterparty — `daemon.ts:1626` returns `no_persisted_relay_endpoint` otherwise).
- **A second daemon** for the recipient: either a second machine, the **EC2 demo agent**
  (`i-0ad3e7c22470f266e`, stop/start `cello-demo` via SSM), or a second local `CELLO_HOME` + socket.
- **Telegram** (S3 only): a real bot token + the operator's allowlisted chat ID set as daemon settings.

**Channels note:** none of these *require* channels — receive-side reconciliation is polled
(`cello_check_notifications` / `cello_receive { since_seq }`), and the Telegram doorbell is Bot-API, not
a channel. So Round 3 is runnable during a channels-down window too.

---

## S1 — LEAVEMSG-1 + RELAYWAKE-1: offline delivery happy path  ·  🟢 CHANNELS-FREE  ·  🏗️ relay + 2nd daemon

**DoD:** `DOD-LEAVEMSG-1` (sender parks at a relay when the recipient is unreachable) +
`DOD-RELAYWAKE-1` (recipient pulls parked frames on reconnect). **The core "message an agent whose
daemon is asleep, it lands when they wake" promise — the whole missing category.**

**Roles:** **A** = sender (your local `Ms_Chelly`). **B** = recipient on a **separate daemon** (EC2 demo
agent, or a second local daemon). A and B must already be **known contacts** with a **prior relayed
session** (so A's daemon holds B's relay endpoint).

**Setup:**
1. Confirm A ↔ B are contacts and have transacted at least once through the relay (so
   `relay_endpoint` is persisted for that counterparty on A's side).
2. Confirm the relay is up (`infra/STATE.md`).

**Steps:**
3. **Take B fully offline** — stop B's daemon (not just its agent): on EC2,
   `systemctl stop cello-demo && systemctl stop cello-daemon` via SSM; or `cello logout` on B's second
   daemon. Verify from A's side that B is unreachable (the directory will report it).
4. **A** (`Ms_Chelly`): `cello_send { session_id: "<A↔B session>", content: "Offline test — ping while
   you sleep" }`.
   - ✅ Returns **`{ ok: true, delivered: false, parked: true }`** / `dispatched_to_relay` (NOT an error,
     NOT a fake `delivered: true`). `~/.cello/daemon.log` shows the park deposit succeeded.
5. **Bring B back** — start B's daemon (`systemctl start cello-daemon && … cello-demo`, or `cello login`).
6. **B**, on reconnect, **pulls without any prompt from A**: `~/.cello/daemon.log` (B) shows the
   RELAYWAKE pull (`recoverParkedFromRelay` / autoRecover). **B:** `cello_check_notifications {}` → ✅ the
   parked message surfaces as unread; `cello_receive { since_seq: 0 }` → ✅ returns the exact message A sent.
7. ✅ Cross-check integrity: the content B pulled equals what A parked; the transcript sequence is
   consistent (the relay witness assigned the seq before delivery).

**✅ S1 PASS:** A sent to an **offline** B and got an honest "parked at relay" (not fake-delivered); B,
on waking, pulled the message via the relay with no live handshake — asynchronous delivery end-to-end.

---

## S2 — LEAVEMSG-1 honest degradation: relay OFF  ·  🟢 CHANNELS-FREE  ·  🏗️ relay toggled OFF

**DoD:** the `DOD-LEAVEMSG-1` reviewer-HIGH honesty contract — when the park **fails** (no relay), the
send must return an **honest `{ ok: false }`** so the retry-queue backstop fires; it must NEVER report
`parked: true` for a message that was never deposited (silent loss dressed as success).

**Staging:** make the relay **unreachable** — turn off the relay node, OR point the daemon at a dead
relay endpoint, OR block the relay circuit address. Recipient B offline as in S1.

**Steps:**
1. B offline (S1 step 3). Relay **down/unreachable**.
2. **A:** `cello_send { session_id: "<A↔B session>", content: "should not be fake-parked" }`.
   - ✅ Returns an **honest failure** — `{ ok: false, reason: … }` (e.g. `no_persisted_relay_endpoint` /
     `deposit_failed` / `standing_receiver_unavailable`), **NOT** `parked: true`.
   - ✅ The message enters the **retry queue** (the backstop that only fires on an honest `{ok:false}`);
     `~/.cello/daemon.log` shows the retry enqueue, not a park-success.
3. Restore the relay + bring B back → ✅ the retry-queue flush eventually delivers (or re-parks) it —
   nothing was silently dropped.

**✅ S2 PASS:** with the relay down, the send fails **honestly** and is retry-queued; no message is ever
reported parked/delivered when it wasn't. *(This is the exact regression the LEAVEMSG-1 `f887dd7` fix
locked — worth proving live because a false success here is unrecoverable data loss.)*

---

## S3 — TGDOOR-1: Telegram doorbell to the operator's phone  ·  🟢 CHANNELS-FREE (Bot API)  ·  🏗️ real bot token

**DoD:** `DOD-TGDOOR-1` — daemon-owned bot pushes **discrete, content-free** doorbell events (session
requests, messages-waiting, state changes) to the allowlisted operator chat, **including cold** (no live
agent session). `[agent · session]` header; content never rides; ring-once-until-read coalescing.

**Staging:** a real Telegram bot token + the operator's chat ID configured as daemon settings
(`telegram_settings`), allowlisted. This is the ONE Tier-3 unit that can't be smoke-tested even locally
beyond the fake-client unit tests.

**Steps:**
1. Configure the daemon's Telegram settings (bot token + allowlisted chat ID). Confirm the single
   `getUpdates` poller starts (`~/.cello/daemon.log`).
2. **Cold doorbell** — with **no live agent session / terminal attached**, have **A** (another agent, or
   the demo) `cello_initiate_session` to your agent.
   - ✅ Your **phone** receives a Telegram message: a **session-request** doorbell with the
     `[agent · session]` header — and **it arrives cold** (no Claude Code window open).
3. **Message-waiting** — A sends a message into that session.
   - ✅ Phone gets a **messages-waiting** doorbell. ✅ It carries **no message content** (routing/label
     only — `DOD-INV-CONTENTFREE`). ✅ **Coalescing:** a second unread message in the same session does
     **not** ring again until you read (`cello_receive`); a new **session request** or **state change**
     always rings.
4. **Inbound rejection** — send `/anything` to the bot **from the allowlisted chat** → ✅ a canned
   notify-only one-liner (logged `telegram.inbound.acknowledged`); from **any other chat** → ✅ silent
   drop (`telegram.inbound.rejected`). Nothing you type enters CELLO content paths.

**✅ S3 PASS:** discrete content-free doorbells reach the phone (incl. cold); coalescing rings once per
unread session; inbound is ack-or-drop, never a content path.

---

## Round-3 coverage map

| Test | Proves | Staging |
|---|---|---|
| **S1** LEAVEMSG-1 + RELAYWAKE-1 | offline recipient → park at relay → pull on reconnect (async delivery) | relay up + 2nd daemon offline |
| **S2** LEAVEMSG-1 degradation | relay down → honest `{ok:false}` + retry-queue, never fake-parked | relay toggled OFF |
| **S3** TGDOOR-1 | cold content-free doorbell to phone; coalescing; ack-or-drop inbound | real bot token + allowlisted chat |

**Not here (can't be tested yet — unbuilt / gated):** multi-device Primary/Standby (device linking),
session portability, M9 screening/injection defense, one-Primary invariant, config surface, SEC-2 fix.
All tracked with unblock conditions in [[M8C-TEST-COVERAGE-LEDGER]].

---

## Related
- [[M8C-AB-TEST-ROUND-2]] — the no-infra sibling (R1–R12)
- [[M8C-TEST-COVERAGE-LEDGER]] — complete DoD → bucket ledger + blocked scenarios
- [[M8C-DEFINITION-OF-DONE]] — Tier 3 (TGDOOR), Tier 4 (RELAYWAKE, LEAVEMSG)
- [[M8C-BUILD-JOURNAL]] — Entry 25/26 (TGDOOR-1), Entry 27 (RELAYWAKE-1), Entry 29/30 (LEAVEMSG-1)
- [[M8C-DECISIONS]] — D19 (RELAYWAKE brand-new-counterparty parked)
