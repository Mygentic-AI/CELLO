---
name: M8B E2E UX friction log
type: discussion
date: 2026-07-02
topics: [m8b, e2e-testing, ux, friction, operator-experience, developer-experience]
status: active
description: >
  Running log of EVERY operator/developer friction point encountered during the M8B E2E testing
  phase. Co-equal mission with the testing itself (Andre's directive 2026-07-02): friction is a
  priceless signal for turning a good product into a great one. Record ALL of it — discoverability
  gaps, confusion, multi-step workarounds, restart/lifecycle pain, ambiguous errors, and "seemed
  like it wasn't working" moments — even friction that was solved. Solving friction does NOT mean
  it shouldn't be recorded; the number of steps it took to solve IS the friction.
---

# M8B E2E UX Friction Log

**Directive (Andre, 2026-07-02):** Friction logging is as important as finding/solving issues.
Do not omit a friction point because "it didn't seem that bad" — that is not our judgment to make.
Note frequently, durably (must survive compaction). Friction includes:
- Things that were hard or required many steps (even if solved).
- Things that were working but *didn't seem like they were working*.
- Things where the next step was genuinely unclear (**confusion friction**).

This log is NOT a fix list. We are recording, not fixing (yet).

**Scope note (Andre, 2026-07-02):** the EC2 demo agent is NOT merely a test instrument — it is a
**production onboarding surface**. Every new user connects to it right after signup as their first
proof that their own stack works ("send a message, get a response — your install is good"), and it
gates the beta→latest promotion. So friction/bugs that manifest on the demo agent are
**production-facing onboarding defects**, not test-rig quirks. Most are rooted in the
client/daemon/directory (the demo is the canary that takes continuous stranger traffic), so the
fixes land in the product — which helps every operator, not just the demo.

Severity tags: `discoverability` · `confusion` · `lifecycle/restart` · `error-message` · `stability` · `cleanup`

Companion to [[2026-07-02_1122_m8b-e2e-test-results-journal]] and
[[2026-07-01_0900_m8b-closed-e2e-testing-phase]].

---

## F1 — `cello refresh` is an undiscoverable CLI subcommand · `discoverability`

**Context:** Testing #11 (share refresh). The CLI usage string is:
`Usage: cello <login|logout|status|register|create-agent|remove-agent|sessions>` — `refresh` is
**not listed**. I only discovered `cello refresh <agent>` works because `cello refresh --help`
returned `agent_not_found: No agent named '--help'` — i.e. it parsed `--help` as an agent argument,
revealing the subcommand exists.

**Friction:** An operator has zero way to discover share refresh exists. Proactive key refresh is a
security-relevant operation; it being invisible in `--help` means most operators will never run it.

**Improvement idea (not fixing now):** Add `refresh` to the usage string; add a short description.

---

## F2 — CLI subcommands have no `--help`; flags parse as positional args · `confusion` · `error-message`

**Context:** Same discovery path. `cello refresh --help` treated `--help` as the agent name and
returned `{"ok":false,"reason":"agent_not_found","guidance":"No agent named '--help'. Create +
register it first."}`. Tried `cello refresh-shares`, `cello rotate`, etc. — all fell back to the
top-level usage string with no indication of correct syntax.

**Friction:** No per-subcommand help. A wrong flag is silently coerced into a positional argument
and produces a misleading "agent not found" error rather than a usage hint.

**Improvement idea:** Support `--help`/`-h` on every subcommand; reject unknown flags with a usage
message instead of coercing them into arguments.

---

## F3 — `cello_get_inclusion_proof` MCP tool exists but returns `not_implemented` · `confusion`

**Context:** Testing #8. The tool is exposed in the MCP surface and callable, but returns
`{"ok":false,"reason":"not_implemented"}`. (Known/tracked gap — the crypto tree exists, only the
tool wiring is missing.)

**Friction:** A tool that appears in the tool list but does nothing is confusion friction — an
operator will try it, get nothing, and not know if they did something wrong or it's unbuilt. A
tool that isn't ready is arguably better hidden than exposed as a dead end.

**Improvement idea:** Either hide the tool until wired, or have its description explicitly say
"(not yet available)".

---

## F4 — `cello_get_sealed_receipt` rejects short session IDs with an ambiguous error · `error-message`

> **DECISION (2026-07-04, Andre) — do BOTH, skip prefix-matching:**
> 1. **Never truncate on copy-from surfaces.** `cello_list_sessions` and `cello status` show the **full**
>    session ID (the places you're meant to copy from), so what you see pastes back. Logs may still truncate.
> 2. **Split the error anyway.** Replace the single `sealed_receipt_not_found` with distinct reasons —
>    `session_id_too_short` (miscopy), `unknown_session`, `wrong_agent` (receipt is keyed per-agent),
>    `not_sealed_yet` — and stop advising `cello_close_session` for a session that is already sealed.
> Skip Option 3 (git-style unique-prefix lookup): unnecessary once IDs aren't truncated, and it adds an
> ambiguity edge case. Small fix; the receipt is core value, so it's worth doing right.

**Context:** Testing #8. Called `cello_get_sealed_receipt(session_id: "a001ca74")` (an abbreviated
ID copied from the plan doc). Got `{"ok":false,"reason":"sealed_receipt_not_found","guidance":"No
sealed certificate is recorded for this session. It may not be sealed yet, or the session_id is
wrong — close it with cello_close_session..."}`.

**Friction:** (a) Partial/abbreviated session IDs are not accepted, but the tool doesn't say that —
it says "not found," conflating "wrong ID / not full-length" with "not sealed yet." (b) The
guidance suggests calling `cello_close_session` on a session that may belong to a different agent.
The operator can't tell which of three very different causes applies.

**Improvement idea:** Distinguish "malformed/too-short session_id" from "session not sealed" from
"unknown session" in the error reason. Consider accepting unique prefixes.

---

## F5 — `cello status` reports one agent `registered` and one `online` — unclear which is usable · `confusion`

**Context:** Baseline. `cello status` showed Agent-1 `state: "online"` and Demo2 `state:
"registered"` on the same healthy daemon. (Known cosmetic bug — daemon.ts:490 hardcodes state; see
plan doc.)

**Friction:** From a cold operator's view, two agents in different states with no explanation reads
as "one of these is broken." Had to `cello_start_agent('Demo2')` before `cello_use_agent('Demo2')`
would work (it failed with `agent_not_online` first). The status display and the actual
startability are not obviously connected.

**Improvement idea:** Fix the hardcoded state so `state` reflects reality; or add a hint in status
like `"online agents can send/receive; registered agents need cello_start_agent first"`.

---

## F6 — No user-facing way to choose a directory node · `discoverability` · `confusion`

> **STATUS (2026-07-04) — the SPOF is FIXED; this is the residual MANUAL layer.** Automatic directory
> failover shipped + live-verified 2026-07-03 (FINDING-4: kill us1 → client runs on eu1/ap1 `verified:true`;
> survives 2 of 3 down — STATE.md 2026-07-03). What remains here is *deliberate* selection: no CLI flag to
> pick a node (still env-var `CELLO_DIRECTORY_URL` only). Convenience/visibility, NOT redundancy.

**Context:** Testing #12/#13 (any-directory / cross-node). To route through eu-central-1 or
ap-northeast-1 instead of the default us-east-1, there is **no CLI flag and no config setting**.
The only lever is the env var `CELLO_DIRECTORY_URL`, which I found only by grepping the
cello-client source (`core/daemon/src/directory-bootstrap.ts:31`, defaults to
`http://directory-us1.cello.mygentic.ai`). It is not documented in `cello --help`, the MCP config,
or any operator-facing doc I've seen.

**Friction:** For a "federated system with sovereign nodes" whose entire value proposition is
node choice/redundancy, the client's node selection is invisible and hard-coded to one region by
default. Discovering how to point elsewhere required reading TypeScript source. This is significant
friction against the core sovereign-node promise.

**Improvement idea:** Surface directory selection as a first-class, documented control (CLI flag +
config), and ideally auto-select/failover across the manifest's node set rather than a single baked
default.

---

## F7 — Changing directory requires a full daemon restart, which drops all MCP connections · `lifecycle/restart`

> **STATUS (2026-07-04) — applies to MANUAL switching only.** Automatic failover needs NO restart: the
> daemon reroutes around a dead directory live (FINDING-4 roster-aware resolver, verified 2026-07-03). The
> restart pain remains only if an operator wants to *deliberately* pin a different node via
> `CELLO_DIRECTORY_URL`. It is no longer on the redundancy path.

**Context:** Testing #12/#13. `CELLO_DIRECTORY_URL` is read only at daemon startup
(`resolveDirectoryUrl(process.env)`), and the daemon is a **standalone, manually-started process**
(pid 83645: `.../@cello-protocol/daemon/dist/bin/cello-daemon.js`) — **not** managed by launchd or
systemd, so nothing restarts it automatically. It is shared by multiple MCP client connections.
Changing the bootstrap directory therefore requires: kill the daemon → restart with the new env →
every connected MCP client (including the live Claude session driving the test) loses its socket
and must reconnect (`/mcp`) → re-`cello_start_agent` each agent (standing receivers are lost).

**Friction:** There is no `cello daemon restart`, no `cello daemon reload`, and no way to change
directory without a disruptive full-stack bounce that also strands other sessions on the shared
daemon. This blocked #12/#13 from running inline — they now require a human to drive the `/mcp`
reconnect. **This is the single biggest friction point so far.**

**Improvement idea:** (a) A supported `cello daemon restart`/`reload` command. (b) Make directory
selection changeable without killing the daemon. (c) Consider per-agent or per-session directory
binding so one config change doesn't bounce every connection. (d) Auto-reattach MCP clients after a
daemon restart.

---

## F8 — `claude mcp get cello` is inconsistent (returned config, then "no server") · `stability` (harness-side)

**Context:** While planning the #12 config change. First `claude mcp get cello` returned the full
config (`Scope: Local config`). Minutes later, from the same cwd, `claude mcp get cello` →
"No MCP server named 'cello'." The cello tools were connected and working the entire time.

**Friction:** This is Claude Code MCP-CLI flakiness rather than CELLO itself, but it directly
undermines confidence in managing the cello MCP server via the CLI — which is the exact operator
workflow for reconfiguring the directory (F6/F7). Made me distrust the config-edit path and pivot
to hand-managing the daemon.

**Improvement idea:** (Harness) investigate `claude mcp get` scope resolution. (CELLO) reduce
reliance on MCP-config edits for reconfiguration (see F7).

---

## F9 — Orphan MCP/daemon processes accumulate on the shared daemon · `cleanup` · `lifecycle/restart`

**Context:** `ps` showed two `cello-mcp` + `npm exec @cello-protocol/connect` process pairs: one
from a prior session (10:03 PM, apparently abandoned) and one from the current session, both
attached to the single daemon (83645). CELLO's own CLAUDE.md warns that "orphan processes compete
for the [SQLite] lock and corrupt ceremony state."

**Friction:** There is no visibility into who is connected to the daemon and no cleanup path for
stale connections. An operator running multiple Claude sessions over time silently accumulates
connections against one stateful daemon, with a documented corruption risk and no `cello daemon
connections` / `cello daemon gc` to inspect or reap them.

**Improvement idea:** Surface connected clients in `cello status`; provide a cleanup command; or
detect and warn on stale connections.

---

## F10 — Interrupted sessions accumulate with no cleanup path · `cleanup`

**Context:** Baseline `cello status` listed 3 `interrupted_sessions` on Demo2 (counterparty
`bc94ead6…`) dating to 2026-06-29 / 07-01 — leftovers from prior testing.

**Friction:** Interrupted sessions pile up in status output indefinitely. There's no obvious
operator action to resolve, resume, or clear them, so `cello status` grows noisier over time and
it's unclear whether these represent recoverable work or dead state.

**Improvement idea:** A way to list/resume/discard interrupted sessions; auto-expire very old ones;
or clarify in status whether they are actionable.

---

## F11 — Background signaling churn: periodic disconnect/reconnect looks like breakage · `stability` · `confusion`

**Context:** The daemon log shows recurring cycles roughly every 40–70 min:
`directory.signaling.reader.error` (`"The operation was aborted due to timeout"` /
`"signaling_closed"`) → `directory.signaling.disconnected` (`"Cannot write to a stream that is
closed"`) → `directory.signaling.reconnecting` → `connected`. Also repeated
`directory.bootstrap.unavailable` → `using_last_known` warnings earlier in the day.

**Friction:** To an operator tailing logs, this reads as an unstable/failing connection even though
the daemon recovers each time. It's unclear whether these disconnects are expected keepalive
churn or a real problem. "Working but doesn't look like it's working" = confusion friction. The
`bootstrap.unavailable` warnings are especially alarming-looking.

**Improvement idea:** Downgrade expected reconnect churn to debug/info with a clear "(expected)"
note; distinguish a genuine sustained outage from routine stream cycling; confirm whether the
~hourly disconnect is intended.

---

## F12 — `/mcp` reconnect does NOT change the directory; no signal of which node you're on · `confusion` · `lifecycle/restart`

> **STATUS (2026-07-04) — auto-failover shipped; VISIBILITY still open.** The client now fails over
> directories automatically and logs `directory.bootstrap.failover` (FINDING-4, verified 2026-07-03). The
> residual gap is purely visibility: `cello status` still does NOT show which node you're currently bound
> to. That's the open item here — not the SPOF, which is fixed.

**Context:** For #12/#13 the operator (Andre) ran a `/mcp` reconnect expecting it to switch the
client to a different directory. It did not — and reasonably so: `/mcp` reconnect only re-attaches
the MCP client to the **already-running** daemon (still pid 83645, still bootstrapped to
`directory-us1` per `~/.cello/daemon.log`). Directory is fixed at *daemon* startup, and the daemon
lifecycle is fully decoupled from the MCP-client lifecycle.

**Friction:** (a) A knowledgeable operator's mental model was "reconnect = re-pick directory," which
is wrong — strong evidence the mechanism is non-obvious. (b) There is **no operator-visible
indication of which directory the client is currently bound to** — `cello status` does not show the
active directory URL/region/peerId. The only way I could confirm us1 was grepping the daemon log.
Combined with F6/F7, an operator literally cannot tell, from any supported surface, which sovereign
node they are talking to.

**Improvement idea:** Show the bound directory (URL + region + peerId + manifest version) in
`cello status`. Make directory switching an explicit command with clear feedback, distinct from MCP
reconnect.

---

## F5-CORRECTION — agent `state` field conflates lifecycle with per-connection selection · `confusion`

**Correction to F5:** My initial F5 attributed the `registered`/`online` display to the known
daemon.ts:490 hardcode bug. That was inaccurate — Demo2 correctly transitioned
`registered` → `online` after `cello_start_agent`, so the field *does* track lifecycle. However a
real confusion remains: after `cello_use_agent('Demo2')`, `cello status` showed **Agent-1:
`online`** and **Demo2: `current`**. Both are online; `current` only means "selected for this
connection." So the single `state` field multiplexes two orthogonal concepts (lifecycle state vs.
this-connection selection). An operator seeing one agent `online` and another `current` cannot tell
that both are equally ready — it reads as a difference in health/readiness.

**Improvement idea:** Separate the fields, e.g. `state: online` + `selected: true`, rather than
overloading `state` with the value `current`.

---

## F13 — `cello_initiate_session` returns `ok` even when the counterparty aborts the offer · `error-message` · `confusion`

**Context:** Testing #2. `cello_initiate_session(EC2 demo)` returned
`{"ok":true,"sessionId":"09fa513e…","transportMode":"relay"}`. But the EC2 side had already
**aborted** the offer (`session.offer.abort` / `session.inbound.accept.failed`). The initiator got
a success with a session ID for a session the receiver never accepted. The failure only surfaced
later, on `cello_send`, as `session_stream_unavailable`.

**Friction:** `initiate_session` reports success before the counterparty has accepted, producing a
false-positive session. The operator believes they have a live session; they actually have a
one-sided phantom. Discovering the truth required a failed send plus reading the *remote* daemon
log over SSM — not available to a normal operator at all.

**Improvement idea:** Either make `initiate_session` await counterparty accept before returning ok,
or return a `pending`/`unconfirmed` state and surface the abort back to the initiator (e.g.
`session.offer.aborted` pushed to the initiator with the reason).

---

## F14 — Standing receiver silently dies after one session; agent looks healthy but is deaf · `stability` · `confusion` (**reliability finding**)

**Context:** Testing #2. All inbound sessions to the EC2 demo agent failed with
`reason: "standing_receiver_unavailable"`. Timeline from the EC2 daemon log:
- 08:35:43 `daemon.started` (pid 23890); 08:35:48 `agent.online` + `session.node.created`
  standing_receiver `c78f0509` (peer `12D3KooWJLz8…`).
- 09:02:47 inbound session `a6a2f9af` **consumes** that same peer `12D3KooWJLz8…` (the standing
  receiver becomes the session). Session succeeds (this is the "live acceptance test PASSED" from
  the last commit).
- **No new `session.node.created` for a standing receiver afterward.** Daemon never restarted
  (both services `ActiveEnterTimestamp` = 08:35).
- 09:37+ every inbound offer → `standing_receiver_unavailable`.

**Root cause (evidence-based):** the standing receiver is consumed when it becomes a session and is
**not re-armed** afterward. Net effect: the demo agent accepts exactly **one** inbound session per
daemon lifetime, then goes permanently deaf — while `systemctl is-active` reports both
`cello-daemon` and `cello-demo` as `active` and `cello status` looks healthy.

**Friction / severity:** This is the worst kind — "looks like it's working but isn't." No
operator-visible signal that the agent can no longer receive. CLAUDE.md already lists
`standing_receiver_unavailable` as a known first-suspect with a manual restart fix, but the
underlying *one-session-then-deaf* behavior (if confirmed as a re-arm gap rather than intended) is a
real availability bug that directly violates the "availability is a first-class protocol concern"
invariant. Also means #2 and #6 each need a fresh EC2 daemon restart (only one inbound session
per lifetime).

**CONFIRMED as a bug (2026-07-02, after reading the daemon source):** the daemon *does* intend to
re-arm — `session-node-manager.ts:903` "If we consumed this agent's standing receiver, spin up a
replacement (async — do NOT await)" (see also daemon.ts:3081, :3213). So a replacement receiver is
supposed to be rebuilt after each consumption. On the EC2 demo agent it did **not** happen: after
session `a6a2f9af` consumed the receiver at 09:02:47, no replacement `session.node.created` ever
appeared, and every later inbound offer got `standing_receiver_unavailable`. The async replacement
either never fired or failed silently. This is a real daemon bug, not intended behavior — and given
the demo's production onboarding role (Scope note above) it is **the highest-impact defect found**:
only the FIRST new user per daemon lifetime can verify their install; everyone after gets a failed
first experience with zero visible cause. The demo's own code is correct (it runs a continuous
`cello_await_session` loop) — the gap is entirely in the daemon's `#createStandingReceiver`
replacement path.

**Fix location:** `cello-client` `core/daemon/src/session-node-manager.ts` (the async replacement
around :903 / `#createStandingReceiver` :2916+). Must also fail LOUD — the silent failure is what
made this invisible.

**ROOT-CAUSE UPDATE (2026-07-02 15:14):** the replacement DID fire and DID log —
`session.node.create.failed — EADDRINUSE 0.0.0.0:4001` (EC2 journald, 09:02:47.911). The consumed
receiver keeps the fixed `CELLO_LISTEN_ADDR` port as the session node, so the immediate re-arm
cannot bind; there is no retry after failure; and the inbound path only polls readiness without
ever re-invoking ensure (nor does session teardown re-arm when the port frees). Diagnosis + fix
spec: [[2026-07-02_1514_m8b-fix-briefs-cascade-1]] Brief 2.

**Improvement idea:** Re-arm the standing receiver immediately after it is consumed (and after each
session seals). Surface standing-receiver health in `cello status` (the parked
`standing_receiver_ready` field should reflect reality). Emit an alarm-worthy log event when an
agent that should be receiving has no armed receiver.

**✅ SHIPPED + VERIFIED LIVE (daemon 0.0.22 / cli 0.0.20, 2026-07-02):** cascade-1 fix — re-arm on
all teardown paths + ensure-on-demand on the inbound path + bounded retry + loud
`session.standing_receiver.dead` + per-agent `standing_receiver_ready` in `cello_status`.
**Re-verified on the demo agent this session** with two *sequential* sessions (A → clean close → B),
NO restart between: both accepted, both sealed bilaterally (roots `ad6c7bb0…`, `56403328…`). On
0.0.20 session B returned `standing_receiver_unavailable`. Deployment confirmed: demo daemon
`ExecMainStart 16:19:55` > 0.0.22 install `16:19:54`; the new `standing_receiver.dead (attempts:4)`
event fires on the demo. **Method note:** an initial re-verify that *killed* the demo daemon instead
of closing the session did NOT exercise the fix (re-arm lives on the teardown path) — the valid test
is sequential clean-close. **Residual → see F22 below:** fixed port 4001 means no armed receiver
*during* an active session; recovery is teardown/on-demand only (fine sequential, gap concurrent).

---

## F15 — `assignment.unverified` warning fires on HEALTHY sessions, masking the real cause · `error-message` · `confusion`

**Context:** While diagnosing F14, every inbound offer logged
`session.inbound.assignment.unverified` with `note: "FROST assignment signature verification
deferred to SESSION-004 re-home"`. This warning also appears on the **successful** 09:02 session —
so it is benign deferred-verification noise, not a failure. It sat directly above the real cause
(`standing_receiver_unavailable`) and initially looked like the culprit (I nearly chased a
relay/manifest signature-verification rabbit hole).

**Friction:** A `warn`-level event that fires on every session including healthy ones trains
operators to either ignore warnings or misdiagnose. It actively misled the first pass of diagnosis.

**Improvement idea:** Downgrade the deferred-verification note to `debug`, or clearly mark it
`(expected until SESSION-004)`, so it doesn't read as the failure reason sitting next to real
aborts.

---

## F16 — Counterparty `gone` is detected by the daemon but never surfaced to the operator · `confusion` · `stability` (**observability gap**)

**Context:** Testing #2. When the EC2 counterparty daemon was killed mid-session, the local daemon
detected it **immediately** — `session.liveness.changed … liveness:"gone", observedBy:
"session_node"` at the same second. But nothing reached the operator:
- `cello_receive_session` returned `{content:null}` — a plain timeout, byte-for-byte
  indistinguishable from "the peer is alive but hasn't sent anything yet."
- `cello_status.interrupted_sessions` did **not** include the session, even minutes later.

**Friction:** The operator has no way to learn their counterparty dropped. The information exists
in the daemon (the `liveness:"gone"` event) but is not exposed through any MCP surface. "Working but
looks like it isn't" in reverse: it's *broken but looks like it's just quiet.* For a protocol whose
whole point includes tolerating peer failure, the operator-facing signal for peer failure is
missing.

**Improvement idea:** Surface liveness transitions to the operator: make `cello_receive` return a
distinct `session_interrupted`/`counterparty_gone` result (not a null timeout); reflect live
liveness in `cello_status` per session; consider a push/event so a waiting operator is told the
peer went away rather than waiting out the full timeout.

**✅ SHIPPED + VERIFIED LIVE (daemon 0.0.22 / cli 0.0.20, 2026-07-02):** `cello_receive_session` now
returns `{content:null, reason:"counterparty_gone", liveness:"gone"}` with actionable guidance, and
`cello_status.active_sessions` lists the session with `liveness:"gone"`. Re-verified operator-side
this session (Agent-1 ↔ demo, counterparty daemon killed mid-session at 16:37:38Z → both surfaces
reported it). Both were silent on 0.0.20.

---

## F17 — `cello_status.interrupted_sessions` semantics are unclear and inconsistent with liveness · `confusion`

**Context:** Testing #2. Many sessions logged `liveness:"gone"` (7f50d4a1, a6a2f9af, 09fa513e,
091d2786, …) yet only three unrelated old sessions (`bc94ead6…`, messageCount 8) appear in
`interrupted_sessions`. So `interrupted_sessions` ≠ "sessions whose peer is gone." Its actual
inclusion rule (apparently: interrupted *with pending/unsent message state*) is undocumented and not
obvious from the field name.

**Friction:** An operator reading `cello_status` cannot tell what `interrupted_sessions` means or
trust it as "these are the sessions that broke." It shows stale entries from days ago while a
session that just lost its peer is absent.

**Improvement idea:** Define and document the inclusion rule; or split into
`interrupted_sessions` (peer gone, resumable) vs `pending_delivery` (queued unsent). Age out stale
entries.

---

## F18 — Per-connection "current agent" selection is silently lost (e.g. after `/mcp` reconnect) · `confusion`

**Context:** Testing #2. After the `/mcp` reconnect, `cello_initiate_session` failed with
`no_current_agent` even though I had selected Agent-1 earlier in the session. The current-agent
selection is per-connection ephemeral state and was silently reset; had to `cello_use_agent` again.

**Friction:** No warning that the selection was cleared; the next tool call just fails. Minor, but
one more "why did this stop working" moment after a reconnect (compounds F12).

**Improvement idea:** Persist/restore the selected agent across reconnects, or have tools that need
a current agent fall back to the sole online agent when there's exactly one candidate.

---

## F19 — "Stop cello-demo" does not remove the counterparty from sealing (daemon co-signs autonomously) · `confusion` (mental-model / docs)

**Context:** Testing #6. Stopping `cello-demo` (the app) on the EC2 agent and then closing from the
local side produced a **bilateral** seal (both parties `attestation_mode: "live"`) — because the
`cello-daemon` co-signs the FROST seal on its own, independent of the app. The plan (and the
implicit operator mental model) assumed stopping the demo app would take that party "offline" for
sealing. It doesn't.

**Friction:** The `cello-demo` (application) vs `cello-daemon` (protocol node) split is load-bearing
but non-obvious. An operator reasoning about "is my counterparty online?" or "will this seal
unilaterally?" will get it wrong if they think in terms of the app. The demo runbook and docs should
make explicit that the **daemon** is what participates in sealing; killing the app changes nothing
about seal participation.

**Improvement idea:** Document the daemon-vs-app responsibility split prominently; consider surfacing
in `cello status` which layer is up. Reframe #6's test method in the plan to target the daemon.

---

## F20 — Grace-window "too early" error hides the remaining wait time from the operator · `error-message`

**Context:** Testing #6 Part B. `cello_close_session` on a peer-gone session returned
`seal_counterparty_pending` with guidance "Retry after the grace period" — but **no duration**. The
directory actually computes and returns `remaining_seconds` in its `seal_unilateral_too_early` frame
(`directory-frames.ts:1126`), and the default window is 600s (`directory-node.ts:616`), but none of
that reaches the operator through the MCP tool. I had to read the source to learn it's a 10-minute
wait.

**Friction:** "Retry later" with no "how much later" is a poor experience — the operator can't tell
if it's 20 seconds or 10 minutes, so they either poll blindly or give up. The information exists one
layer down and is simply not propagated.

**Improvement idea:** Surface `remaining_seconds` (and the total grace window) in the
`cello_close_session` response so the operator knows exactly when to retry, e.g. "unilateral seal
available in ~9m48s."

---

## F21 — Stuck `seal_pending_bilateral` is undiagnosable; unilateral rejection paths are silent · `error-message` · `confusion` (paired with FINDING-1)

**Context:** FINDING-1. When the unilateral seal fails to finalize, `cello_close_session` returns
`seal_pending_bilateral` with "retry if the session remains unsealed" — the same response forever,
with no reason, no progress indicator, and no terminal state. The operator cannot tell whether it
will eventually finalize, is retrying usefully, or is permanently dead. The directory's
`#processSealUnilateral` (`directory-node.ts:3315`) has ~5 distinct rejection branches that each
`return` silently (some log an error server-side, but nothing actionable reaches the client).

**Friction:** A stuck seal is a black box. "Retry forever" is not a state. There is no way, from any
operator surface, to learn *why* a unilateral seal isn't completing — I had to read directory source
to even know a unilateral path exists. For a receipt the operator may legally rely on, silent
non-completion is serious.

**Improvement idea:** Give `cello_close_session` a terminal failure state with a reason surfaced from
the directory's rejection branch (e.g. `unilateral_root_unverifiable`, `participants_unknown`,
`session_state_lost`). Emit client + directory events for each unilateral-seal attempt and its
outcome. Consider a bounded retry with a clear "gave up / manual escalation" result.

---

## (running — append new entries below as encountered)

## F23 — Unilateral seal returns `ok` + root but the receipt is unretrievable and the response carries no certificate · `stability` · `error-message` (paired with FINDING-3)

> **✅ RESOLVED 2026-07-02 (daemon 0.0.23, rolled into 0.0.24 `latest`) — LIVE-VERIFIED.** The
> context below documents the **0.0.22** state (the bug that motivated FINDING-3). It is fixed:
> `cello_close_session` on a unilateral seal now returns the legibility inline (counterparty
> `attestation_mode:"absent"`) AND `cello_get_sealed_receipt` returns the durable cert
> (`sealed_root 3dd19ab4…`). Do NOT read the "Context" below as current live state. See the
> FINDING-3 RESOLVED banner in the test-results journal (session `e3c167bd`, directory `6f66557`).
> Residual live-unverified item is FINDING-6 (absent party **B**'s receipt), tracked separately.

**Context:** Re-verifying FINDING-1 on daemon 0.0.22. `cello_close_session` on a peer-gone session
past the grace window now succeeds unilaterally (`ok:true, seal_type:"unilateral", sealed_root:…`) —
the deadlock is gone. But the operator then hits two dead ends: (a) the close response is thin
(`sealed_root` + `seal_type` only — no `participants`/`legibility` block that the bilateral close
returns inline), and (b) `cello_get_sealed_receipt` returns `sealed_receipt_not_found` (verified 3×).
The daemon log shows the unilateral path verifies the cert (`session.unilateral.certificate.verified`)
but skips the bilateral `session.sealed.received` persist step, so nothing lands in the receipt store.

**Friction / severity:** The whole reason to close unilaterally is to walk away with a receipt you can
rely on when your counterparty vanished. Getting `ok:true` + a root but then being unable to retrieve
the certificate — via either the response or `cello_get_sealed_receipt` — is a "looks done, isn't"
gap on a legally-relevant artifact. It reads as success but leaves the operator empty-handed.

**Improvement idea:** Persist the verified unilateral certificate to the same store the bilateral
`sealed.received` handler writes, so `cello_get_sealed_receipt` returns it; and/or return the full
certificate inline in the unilateral `cello_close_session` response (participants with the
counterparty recorded ABSENT, legibility block) exactly as the bilateral close does. See FINDING-3.

---

## F22 — Standing receiver binds a fixed port (4001); no armed receiver exists *during* an active session · `stability` (F14-adjacent, concurrency)

**Context:** Verifying the F14 re-arm fix on daemon 0.0.22. The standing receiver and the active
session node share the fixed `CELLO_LISTEN_ADDR` port 4001. When an inbound session is accepted the
standing receiver *becomes* the session and keeps 4001, so the immediate re-arm cannot bind
(`session.node.create.failed — EADDRINUSE 0.0.0.0:4001`), retries 4× and fires
`session.standing_receiver.dead`. A fresh receiver is created only once that session tears down (or
on-demand for the next inbound). Observed live this session: during session `747c922f` the demo's
re-arm died EADDRINUSE while the session was active; after a later session's clean close it re-armed
and served the next one (F14 pass).

**Friction / severity:** For **sequential** onboarding (one user connects, verifies, disconnects)
this is fine — recovery-on-teardown covers it. But a **concurrent** second inbound arriving *while a
session is active* hits a window with no armed receiver, and the on-demand ensure would itself face
the same port conflict against the live session node. The demo is a production onboarding surface
taking continuous stranger traffic, so two near-simultaneous signups is realistic. Not a regression
(0.0.20 was worse — deaf after one, forever) and not blocking, but the fixed-port design effectively
caps the demo at one concurrent session.

**Improvement idea:** Give the standing receiver its own listen port distinct from session nodes (or
bind ephemeral and advertise the address via the directory), so a ready receiver can coexist with an
active session and concurrent inbound is served without a teardown dependency. Pairs with the
durable-escalation follow-up already noted for FINDING-1.

---

## Related Documents

- [[2026-07-02_1122_m8b-e2e-test-results-journal|M8B E2E test-results journal]] — companion record of the tests that generated every friction entry here; carries the consolidated fix backlog ranking F1–F21.
- [[2026-07-01_0900_m8b-closed-e2e-testing-phase|M8B closed — E2E testing phase kickoff]] — the testing-phase plan this log runs alongside; the friction directive (co-equal mission) was set at its kickoff.
- [[2026-07-02_1514_m8b-fix-briefs-cascade-1|M8B fix briefs — cascade 1]] — F13/F14/F16/F20 (+ riders F1/F2/F15) resolved to root causes and implementation-ready fix specs.
- [[2026-07-02_1640_m8b-cascade-1-implementation-and-publish|M8B cascade 1 — implementation, publish, live verification]] — F13/F14/F16/F20 and riders F1/F2/F15 FIXED and live-verified (daemon 0.0.21 / cli 0.0.19); F5/F6/F7/F9/F10/F12/F17/F18/F21 remain open (design/directory batches).
