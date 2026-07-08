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

### ✅ R2 PART A RESULTS — run 2026-07-08 — PASS (via full daemon restart, not `cello_stop_agent` alone)

Staged `S1 = 1baad2a4b63cc6948e6637ee8de10da6` (B clean-counted first, A knocked, sent nothing).
**First attempt:** `cello_stop_agent { name: "Ms_Chelly" }` alone did **not** kill the underlying
libp2p transport on loopback — `S1` stayed `liveness: alive` past 5s TTL, exactly the "awkward on
all-online loopback" case this doc predicted. **Second attempt:** a full daemon restart (`cello logout`
→ `login`, unrelated to this test — done for other reasons) genuinely killed the transport, and the
reaper fired correctly on its own, independently verified from `~/.cello/daemon.log`:

```
15:34:21-22  session.liveness.changed → alive (both sides)
15:38:08     session.liveness.changed → gone (both sides); session.node.destroyed reason=interrupted
15:39:28     session.half_open.reaped  agentName=CELLO_Support  priorStatus=interrupted  ageMs=309405
15:39:28     session.half_open.reaped  agentName=Ms_Chelly      priorStatus=interrupted  ageMs=309404
```

**✅ R2 PART A PASS** — the automatic reaper fired on the next read, on its own, once liveness genuinely
went non-alive, on both sides symmetrically. The earlier "transport lingers" observation was a correct
diagnosis of *why* it hadn't fired yet, not a defect — a real disconnect resolved it exactly as expected.

**R2 Part B — deferred, not attempted.** Staging 3 aged ghosts requires the same genuine-disconnect
condition Part A needed, which `cello_stop_agent` doesn't provide on loopback — reaching it would mean
3 more full daemon restarts, which is disruptive and out of proportion here. Part A already proves the
reap-on-read mechanism live; Part B's remaining claim (reap runs before the accept-cap check) is a
code-path ordering assertion better verified by a targeted unit/integration test than more manual
restarts. Decision: skip Part B this round.

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

### ✅ R3 RESULTS — run 2026-07-08 — PASS, both branches

1. **A:** stopped `CELLO_Support`, `CELLO_Feedback`, `Ms_Chelly_Hermes` — `cello_status` confirmed only
   `Ms_Chelly` `state: "online"`.
2. **A's CLI `cello sessions --open`** turned out **not** to be a valid fresh-unselected-connection
   vehicle — it returned sessions for `CELLO_Support` too, even while offline, meaning the CLI bypasses
   agent-selection scoping entirely rather than exercising it. Used an **MCP reconnect** instead (which
   resets `selected: false` for this connection) as the genuine unselected state.
3. **A**, on the freshly-reconnected, never-`cello_use_agent`'d connection: `cello_list_sessions {}` →
   `{"ok":true,"filter":"open","totalMatched":4,"sessions":[...all scoped to agentName: "Ms_Chelly"...]}`
   — ✅ **auto-resolved the sole online agent**, no `no_current_agent`. A follow-up `cello_status` on the
   same connection showed `Ms_Chelly` still `selected: false` — the resolution is ambient per-call, not
   a permanent bind, so the same connection stayed valid for the contrast step.
4. **A:** `cello_start_agent { name: "CELLO_Support" }` (2 online, none selected) → `cello_list_sessions {}`
   on the same unselected connection → `{"ok":false,"reason":"no_current_agent",...}` — ✅ **the
   ambiguous guard correctly refused to guess** between two candidates.
5. **A:** restored `CELLO_Feedback` and `Ms_Chelly_Hermes`, re-selected `Ms_Chelly` on this connection.

**✅ R3 PASS — confirmed live, both F18 branches**, on an actual unselected MCP connection (not the CLI,
which doesn't exercise this gate at all).

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

### ✅ R4 RESULTS — run 2026-07-08 — PASS

1. **B:** `cello_contact_remove` → `{"ok":true,"removed":false}` (already absent); `cello_contact_list {}`
   → `[]`. Cleared all 3 leftover sessions from Ms_Chelly first (required — they counted toward the cap):
   `14912ff8…` (R5's session, still active) sealed normally (`sealed_root:
   bf306278c40e56adaf6791fb23d9630760adca7d9f365fab82e9f3ff70fbb1a4`); `dd7493…` force-abandoned;
   `e700842…` was already auto-reaped earlier. Confirmed clean: `cello_list_sessions {}` → `totalMatched: 0`.
2. **A:** 3 sequential `cello_initiate_session` calls, all `ok:true`: `0b1882f50d31e3d0cebd49c071d4cff4`,
   `8e21bbc006bc78418c271c150d400337`, `e7771b56fde5211768bd210044e8086d`. `cello_status` confirmed all 3
   `active`/`alive` on **both** sides (A and B).
3. **A:** 4th knock → `{"ok":true,"sessionId":"fb6bbcfc7d3ea9548cc6a399b6e4e81c",...}` — success reported
   regardless, as expected (initiator-signal gap).
4. **B:** `cello_list_sessions {}` → `totalMatched: 3`, `fb6bbcfc…` **absent** — only the prior 3 remain.
   `grep -a "fb6bbcfc7d3ea9548cc6a399b6e4e81c" ~/.cello/daemon.log` → confirmed twice:
   `{"event":"session.inbound.accept.failed","sessionId":"fb6bbcfc...","agentName":"CELLO_Support",
   "reason":"abuse_bound_sessions_per_sender"}`.

**✅ R4 PASS — confirmed on both A and B.** Exactly 3 concurrent unknown-sender sessions admitted; the
4th refused server-side despite A's `ok:true` — the initiator-signal gap directly evidenced here (A had
no way to know the 4th was rejected without B checking the daemon log).

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

### ✅ R5 RESULTS — run 2026-07-08 — PASS (run early, opportunistically, while channels was up)

Session `14912ff8bddfa41cd1a87931672cceb8` (A→B). B did **not** call `cello_receive` beforehand; A sent
`cello_send { content: "doorbell ping" }`. B received the unprompted push with zero preceding poll:

```
<channel source="cello" agent="CELLO_Support" type="cello_message" from="178d420b86be…" session_id="14912ff8bddf…">
CELLO: a new message is waiting (session 14912ff8bddf…, from 178d420b86be…). Call cello_receive to read it.
</channel>
```

B also confirmed the earlier `session_state_changed` push fired unprompted on A's initiate, same
session — both notification types zero-poll. B then called `cello_receive` and confirmed the content
matched ("doorbell ping") exactly.

**✅ R5 PASS — confirmed on both A and B.** Both push types (`session_state_changed`,
`cello_message`) fire unprompted with zero polling; content matches on receive.

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

### ✅ R6 — SATISFIED BY CROSS-REFERENCE, not re-run

Round-1 Phase 4 already reproduced both defects with a full verbatim transcript (registering
`Ms_Chelly_Hermes` as a second agent on Andre's account) — see
[[M8C-LIVE-AB-TEST-PROTOCOL]] Phase 4 results. Nothing about the bug has changed since (not fixed,
not re-scoped), so re-running it here would just repeat the same Telegram flow for no new evidence.
Treated as covered; not re-executed this round.

---

---

# Round-2 additions — no-infra DoD coverage (R7–R12)

These close the DoD lines that need **no infrastructure staging** — just the running daemon, MCP/CLI
calls, and stopping/starting **local** agents. They join R1–R6 above. Everything requiring a relay, a
real Telegram bot, or a second physical daemon is in the sibling doc
[[M8C-AB-TEST-ROUND-3-INFRA-STAGED]]; everything not yet testable (unbuilt / gated) is tracked in
[[M8C-TEST-COVERAGE-LEDGER]], which also carries the **complete DoD → bucket ledger** proving no area
is left uncategorized.

## R7 — LOGINSTART-1: `cello login` auto-starts all agents  ·  🟢 CHANNELS-FREE

**DoD:** `DOD-LOGINSTART-1` — login brings up every registered agent, always completes, enumerates any
failures by reason.
1. `cello logout` → `Daemon stopped.`
2. `cello login` → ✅ output **enumerates every registered agent** started (e.g. "Started 4 agent(s):
   …"), and login **completes** even if one fails (a failed agent is listed with its reason, not a hang).
3. `cello_status` → ✅ all registered agents `state: "online"` with no manual `cello_start_agent`.

**✅ R7 PASS:** one `login` returns every agent online; failures (if any) are named, not silent.

### ✅ R7 RESULTS — run 2026-07-08 — PASS (incidental, from R2's setup restart)

Captured live from the daemon restart done for R2's TTL setup — no need to repeat another disruptive
`logout`/`login` cycle:

```
$ cello logout
Daemon stopped.
$ CELLO_HALF_OPEN_TTL_MS=5000 cello login
Daemon started.
Started 4 agent(s): CELLO_Feedback, CELLO_Support, Ms_Chelly, Ms_Chelly_Hermes.
```

Immediate `cello_status` (A) confirmed all 4 agents `state: "online"` — no manual `cello_start_agent`
calls were made. Login enumerated every registered agent by name in one line; no failures occurred so
the failure-naming branch wasn't exercised, but the success enumeration is confirmed live.

**✅ R7 PASS — confirmed live.** One `login` returned all 4 agents online, named explicitly.

## R8 — TTL-1: inbound session-request expiry  ·  🟢 CHANNELS-FREE  ·  ⚠️ needs a 1-line enabler

**DoD:** `DOD-TTL-1` — a session **request** (not yet accepted) expires after its TTL (24h default),
leaves the queue, and shows as **expired** in INBOX.
**Prereq:** `INBOUND_SESSION_TTL_MS` is a hardcoded const (`daemon.ts:294`) with **no env override**
today — unlike `CELLO_HALF_OPEN_TTL_MS`. To test in-window, add a `CELLO_INBOUND_SESSION_TTL_MS`
override mirroring line 1760 (trivial, ships in the next cascade), then start the daemon with it set to
e.g. `8000`. *(Without the enabler this is a 24h wait — still no infra, just slow.)*
1. Start the daemon with `CELLO_INBOUND_SESSION_TTL_MS=8000 cello login`.
2. **A** (`Ms_Chelly`, a **stranger** to B — remove the contact first): `cello_initiate_session
   { target_pubkey: "<Support>" }` — a request B does **not** accept.
3. **B** (`CELLO_Support`): `cello_check_notifications {}` → ✅ the pending request is present.
4. Wait > 8 s.
5. **B:** `cello_check_notifications {}` → ✅ the request is **gone from pending** and appears under
   `expired_session_requests` (not silently vanished). `~/.cello/daemon.log` shows the lazy reap.

**✅ R8 PASS:** an unaccepted request expires past its TTL, leaves the queue, and is visible as expired.

## R9 — INV-HONEST-STATES: away vs unreachable (no faked third state)  ·  🟢 CHANNELS-FREE

**DoD:** `DOD-INV-HONEST-STATES` — a counterparty sees exactly two non-answer states: **away** (a bona
fide daemon auto-response) or **unreachable** (silence). Nothing fakes a third. *(Opaque privacy mode is
M9-gated — [[M8C-TEST-COVERAGE-LEDGER]]; only transparent-away vs unreachable is testable now.)*
1. **Away:** make `CELLO_Feedback` **online but unattended** — ensure no connection has it selected
   (don't `cello_use_agent` it anywhere). **A** (a **known contact** of Feedback) `cello_initiate_session`
   + `cello_send` to it → then `cello_receive`. ✅ A gets the **away text** auto-reply and the message is
   **queued** (surfaces later as unread on Feedback's inbox).
2. **Unreachable:** `cello_stop_agent { name: "CELLO_Feedback" }`. **A** `cello_initiate_session` to it
   → ✅ **silence / `target_offline`** — and crucially **no away text** (away ≠ unreachable; the two are
   distinguishable).
3. ✅ There is no third, fabricated state (no fake "delivered", no fake presence).

**✅ R9 PASS:** away yields a real auto-response; unreachable yields silence; the two never blur.

### ✅ R9 RESULTS — run 2026-07-08 — PASS

Session `ad6dce43b2db332e5e71849906c72da8` (Ms_Chelly → CELLO_Feedback, an existing known contact).
B confirmed CELLO_Feedback `selected: false` on their connection too before starting (attendance is
daemon-wide, not per-connection, so both sides needed checking).

1. **Away:** `cello_initiate_session` → `ok:true`. First `cello_send` was refused
   `session_not_current` (an unread away-reply to the request itself was already queued — CURSOR's
   read-before-write gate caught it). `cello_receive` → `"Agent is currently away. Your session
   request has been received and queued."` (verbatim request-kind text). Retried `cello_send` → `ok:true`,
   then `cello_receive` → `"Agent is currently away. Your message has been received and will be read
   when the operator returns."` (verbatim message-kind text). Both are the **known-contact** templates,
   not the flat stranger "Dispatched." — confirming the known/unknown branch too. Verified the queue
   claim directly: temporarily attended `CELLO_Feedback` on this connection and called
   `cello_check_notifications {}` → `{"pending_session_requests":[{"session_id":"ad6dce43b2db...",
   "from":"178d42..."}],"unread":[{"session_id":"ad6dce43b2db...","unread_count":1,"last_seq":1}],
   "total_unread":1}` — surfaced exactly as the doc predicted, non-destructively (didn't consume it).
2. **Unreachable:** `cello_stop_agent { name: "CELLO_Feedback" }`, then `cello_initiate_session` →
   `{"ok":false,"reason":"counterparty_unavailable",...}` — **no session created, no away text at
   all**. (Naming note: the doc's working label was `target_offline`; the actual reason string is
   `counterparty_unavailable` — same behavior, different label than expected.) Restored
   `CELLO_Feedback` afterward.
3. No third state observed anywhere — away always produces the real queued auto-reply text; offline
   always produces a clean rejection with nothing fabricated.

**✅ R9 PASS — confirmed live.** Away and unreachable are cleanly distinguishable; both the known-contact
away templates and the request/message distinction hold; the queued message correctly surfaces in the
unattended agent's own inbox.

## R10 — INV-CONTENTFREE: the doorbell carries no message content  ·  🟡 log-inspectable (🔴 for the live push)

**DoD:** `DOD-INV-CONTENTFREE` — every push is a content-free doorbell: `type` + counterparty pubkey +
`session_id` + routing metadata only; message text NEVER rides a push (SI-001). The security assertion
behind R5 — inspect the actual frame, don't just confirm it arrived.
1. A session open between A and B. **A:** `cello_send { session_id, content: "CANARY_9f3c_secret_body" }`.
2. Inspect the doorbell frame:
   - **Channels-free path:** `grep -a "cello_message\|session_state_changed" ~/.cello/daemon.log` (and the
     shim's forwarded frame) → ✅ the pushed payload carries `type` + `session_id` + pubkey + label only.
   - **Live-push path (needs channels):** the `<channel source="cello">` event that lands in B's session.
3. ✅ **`CANARY_9f3c_secret_body` appears NOWHERE** in the pushed frame — only in the content you fetch
   deliberately via `cello_receive` / `cello_get_transcript`.

**✅ R10 PASS:** the doorbell announces *that* a message exists (routing only); the body is never in the push.

## R11 — INV-PUSHPULL: every feature reachable poll-only  ·  🟢 CHANNELS-FREE (this is the point)

**DoD:** `DOD-INV-PUSHPULL` — every push capability has a pull equivalent; a poll-only client reaches
every M8C feature; push loss is always recoverable. This formalizes the whole Round-2 premise.
1. With **channels off** (or simply never reading a doorbell), have **A** open a session and send **3**
   messages to **B** while B does nothing.
2. **B** reconciles entirely by **polling**: `cello_check_notifications {}` → ✅ shows the pending
   session + unread count (the missed doorbells); `cello_receive { session_id, since_seq: 0,
   timeout_ms: 5000 }` → ✅ returns all 3 in order, no dupes/gaps.
3. ✅ B completed the full receive→reply flow with **zero** channel pushes — nothing hard-required the doorbell.

**✅ R11 PASS:** a poll-only operator reached a push feature end-to-end; push is an optimization, not a requirement.

## R12 — Onboarding legibility CLI checks (ERRORS / WARN / LOGNOISE)  ·  🟢 CHANNELS-FREE

**DoD:** `DOD-ONBOARD-ERRORS-1`, `DOD-ONBOARD-WARN-1`, `DOD-ONBOARD-LOGNOISE-1` — the remaining
onboarding riders (HELP top-level + NEXTSTEP already passed in R1 Phase 4). Pure local CLI + log.
1. **ERRORS** — run each bad path, expect a **specific, actionable** message (never silence or a Usage dump):
   - `cello register someagent CELLO_PREAUTH_TOKEN` (bogus literal) → ✅ "that isn't a pre-auth token —
     they start with `CELLO-`" (this was the **R4 silent-output repro** — confirm it now speaks).
   - `cello register no-such-agent CELLO-realtoken…` → ✅ "no agent named X; create it first".
   - `cello register someagent` (missing token) → ✅ "you're missing the pre-auth token" (not the Usage line).
2. **WARN** — inspect a real `register` output → ✅ **no** durable-secret klaxon (the scary warning was
   removed; at most one calm line, or none).
3. **LOGNOISE** — `grep -a directory.signaling.reader.error ~/.cello/daemon.log` → ✅ the routine
   ~40–70 min reconnect churn is logged **quietly / marked expected**, so a healthy daemon doesn't read
   as failing.

**✅ R12 PASS:** onboarding errors are actionable, no fake secret-klaxon, routine churn is quiet.

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
| **R7** LOGINSTART-1 | `cello login` auto-starts all agents, enumerates failures | 🟢 free |
| **R8** TTL-1 | inbound session-request expiry → INBOX (needs a 1-line enabler) | 🟢 free |
| **R9** INV-HONEST-STATES | away (auto-reply) vs unreachable (silence), no faked 3rd state | 🟢 free |
| **R10** INV-CONTENTFREE | doorbell carries routing only; message body never rides the push | 🟡 log / 🔴 live push |
| **R11** INV-PUSHPULL | every push feature reachable poll-only; push loss recoverable | 🟢 free |
| **R12** onboarding legibility | ERRORS actionable, no secret-klaxon, log churn quiet | 🟢 free |

---

## Related
- [[M8C-LIVE-AB-TEST-PROTOCOL]] — Round 1 (all 5 phases PASS on loopback); this doc continues it
- [[M8C-AB-TEST-ROUND-3-INFRA-STAGED]] — the infra-staged sibling (relay / Telegram bot / 2nd daemon)
- [[M8C-TEST-COVERAGE-LEDGER]] — complete DoD → bucket ledger + the not-yet-testable (blocked) scenarios
- [[M8C-DEFINITION-OF-DONE]] — the DoD lines these tests close
- [[M8C-FIX-PLAN]] — RESUME STATE (fix run closed) + the two post-launch follow-ups R4/R6 feed
- [[M8C-DECISIONS]] — D25 (CC-5 reap/force), D26 (CC-10 reaper scope + doorbell-rate residual)
- [[M8C-BUILD-JOURNAL]] — Entry 60 (CC-10), Entry 61 (fix run closed)
