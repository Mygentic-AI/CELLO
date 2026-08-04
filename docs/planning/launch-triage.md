---
name: Launch Triage
type: triage
date: 2026-07-31
topics: [launch, security, backup, receipt-integrity, kill-switch, daemon-lifecycle, telegram, install, triage]
status: open
description: >
  The launch punch list. Ranked by what actually goes wrong if left alone, not by build status.
  Plain-language explanation + designation for each, so this doc works as both a punch list and a
  lookup table into the DoD docs. Restructured 2026-08-04: the open items carry contiguous numbers
  1–14 and everything addressed has been lifted out of the ranking into a single section at the end,
  so the list reads as work-remaining rather than as a mixed log. Ranking is a first pass; Andre
  sets the real priority.
---

# Launch Triage

**Refreshed 2026-07-31, restructured 2026-08-04.** Two items that had been left in the ranking with
a ✅ next to them (receipt drift, co-attendance) are now in **Addressed — off the open list** at the
bottom, together with the items closed in earlier passes. Open items renumber contiguously whenever
something closes; cross-references point at names, not numbers, so they survive it.

**The test, unchanged:** at launch, if this is not done, will it *fundamentally ruin* a prospective
customer — or is it something they could *forgive*? Ruin = they can't get the core value, or they
lose trust. Most things are forgivable.

**How to use this:** read top to bottom, then tell me the real priority order — the ranking below
is my first pass, not a decision.

**2026-08-04:** item 13's parked decision was checked against the completed M12 cutover and the
premise it rested on did not hold — it is an open item again, unranked. See that item.

**2026-08-03 sweep addendum:** a pass over the DoD docs and July discussion logs added items 13, 14,
the re-verify note on the unsealable-conversation item,
and the "left off this list on purpose" section. One item found by the sweep was already fixed
without its DoD line knowing (`DOD-SIGTERM-FLAKE-1`, busy-timeout fix 2026-07-31 — line corrected to
🟡, never was a triage item).

---

# Open — ranked

## 1. There is still no way to back up or recover your identity

**Designation: `DOD-CUSTODY-DAEMON-1`**

`backup` and `restore` exist as commands, but nothing behind them works — call either one and it
reports "not implemented." If your machine is lost, stolen, or dies, that agent and everything it
knows is gone permanently. No safety net exists today. The work is real: the logic has to move out
of the chat-tool layer and into the daemon as an actual capability.

Confirmed still open as of 2026-07-30 — M9B's closure note records that `cello_backup` and
`cello_restore` remain stubs, and that a round-trip proof is owed to whoever builds them.

---

## 2. The inbox says sessions are sealed when they are not

**Designation: `DOD-SEALED-INBOX-2`** — ❌ open, raised 2026-07-30

The inbox is the one surface that asserts a session is notarized, and for three of the four statuses
it applies that label to, the assertion is false. Only `sealed` is actually notarized; `abandoned`,
`interrupted` and `seal_interrupted_pending` are not.

Found live: a session was reported under "sealed with unread messages" while three other surfaces
said it was interrupted and had never sealed. **The agent reading the inbox repeated "it's sealed"
to the operator as fact.** It took a direct "is it actually sealed?" to catch, because nothing in
the system contradicts the label unless you go and ask a second surface.

For a product whose entire proposition is verifiable trust, the failure mode here is not a wrong
label — it is the product making a false claim about notarization and an agent relaying it onward.

**Diagnosed 2026-07-31 — the fix is small and the location is exact.**
`session-node-manager.ts:1005` defines `#TERMINAL_STATUSES` as
`('sealed','abandoned','seal_interrupted_pending','interrupted')`. `getSealedUnread` (`:1039`)
selects on that set, so it returns all four — correctly, they are all terminal-with-unread. The
defect is downstream: `notification-handlers.ts:99` labels the whole set *"These sessions are sealed
with unread messages"*, and the field is named `sealed_unread`. **The name is half the false claim**
— an agent reading the JSON says "sealed" without ever reaching the guidance string.

Three consumers to change plus its test: `notification-handlers.ts`, `session-read-handlers.ts`,
`session-node-manager.ts`, and `plugins/cello/skills/receptionist/SKILL.md` (which ships, so it
instructs agents directly — audit what ships, not only what compiles).

Smallest correct fix: return each row's `status` alongside the count, and make the guidance state
that only `sealed` is notarized. Renaming the field to something status-neutral (`ended_unread`) is
the honest version, but it is a wire change for the shim and the receptionist skill, so it wants its
own pass rather than riding a doc update.

---

## 3. Logging out says the daemon stopped while it is still on the network

**Designation: `DOD-LOGOUT-EXIT-1`** — ❌ open, raised 2026-07-30

After `cello logout`, `cello status` reports `stopped` and every local handle is correctly released
— but the process is still alive, still holding an established connection to a directory node, and
still polling. Observed running 20+ seconds later and only exiting when killed by hand. Logout's own
help text promises it "waits until it has actually exited."

This matters beyond an orphaned process. A launch requirement is that a kill switch is in place, and
this is the kill switch silently not working: the visible state says off, the network behaviour says
on. An operator who has logged out reasonably believes nothing of theirs is reachable. It also hides
itself — because the handles *are* released, every local check agrees with the lie.

Worth noting this is the second appearance of a shape an earlier pass already celebrated as fixed:
the review of the double-daemon fix caught that the shutdown command was trusting the same broken
logic. The class came back through a different door.

---

## 4. A mismatch that makes a conversation unsealable leaves no durable trace

**Designation: `DOD-FRONTIER-MISMATCH-DURABLE-1`** (M8D, 🅿️ parked) — **re-scoped 2026-08-03.** The
original defect under this item (`DOD-FRONTIER-STRAND-1`) is fixed; see Addressed. What is left is
the detection half.

The original shape: two byte-identical messages in one session, and the receiving side treats the
second as a redelivery and refuses to record it. The two sides then permanently disagree about how
many messages exist, neither will co-sign a close, and the session can never produce a receipt. One
live session sat in that state **for a week** before anyone noticed, because nothing detects a
mismatch until someone attempts a close.

The dedup is now keyed on relay-assigned position rather than content, so the strand itself is
closed. But the mismatch flag is held **in memory and dies on every daemon restart** — which
undercuts precisely the "a week unnoticed" concern that made this item severe. Two cheap options are
already written into the DoD line: derive it on read from the persisted seal-rejection record, or
write it to the existing `sessions` row.

**One inherited caveat, carried from the receipt-drift fix:** three paths still end unwitnessed
(relay down, terminal assignment rejection, retry exhaustion), so **relay position is not total** and
anything keyed on it must not assume it is.

---

## 5. Installing the plugin does not give you a working CELLO

**Designation:** [[2026-07-30_1423_cello-claude-code-plugin-and-channels-allowlist]] — **needs a DoD
line opened.**

The plugin is the official install route. Installing it copies files and runs nothing: the MCP shim
arrives lazily, but the `cello` binary and the daemon do not. A new user installs, sees the tools,
calls one, and gets `daemon_not_running`. The `setup` skill is the only thing that closes that gap
today.

This is a first-impression item rather than a safety one, and it is deliberately unresolved — the
obvious fix (an install hook) would have a plugin install start a long-running process holding key
material and a network identity, which is a much bigger claim on a user's machine than a plugin
install normally makes. But it is the same class as the Telegram sign-up item below, which is
already tracked, so it should be tracked too rather than living only in a discussion log.

---

## 6. The Telegram sign-up messages give wrong or unclear instructions

**Designation: `D-ENVVAR`** (+ the rest of Phase 1 in `M8C-ONBOARDING-IMPROVEMENTS`)

The registration bot tells a new user to set something that doesn't exist, among a few other unclear
or inconsistent messages along that flow. A literal first-time follower gets stuck with no next
step. Not a security issue — a bad first impression. Fixing it is tedious rather than hard: several
message rewrites plus the tests that check the exact wording, in one repo.

---

## 7. A daemon shutdown rings the doorbell like an incoming message

**Designation:** [[2026-07-30_1423_cello-claude-code-plugin-and-channels-allowlist]] — **needs a DoD
line opened.**

When the daemon exits, its shutdown is forwarded through the notification channel with the same
generic shape as a real doorbell. From inside a session there is no way to tell "you have a message"
from "your daemon just died." An agent following the contract calls the inbox, gets
`daemon_not_running`, and reports a protocol failure — the actual event goes unreported and the
diagnosis starts in the wrong place.

Two candidate fixes, both small: don't forward shutdown through the channel at all, or give it
distinguishable metadata so the event says what happened.

---

## 8. Telegram phone notifications are built and tested, but never proven on a real phone

**Designation: `DOD-TGDOOR-1`** — 🟡 *(still the only Tier-3 unit that can't be smoke-tested without
a real bot token)*

The doorbell-to-Telegram feature is built and passes its test suite, but has never been watched
working end-to-end on an actual phone. Low risk either way; just unverified. Flips to done on a live
proof, nothing else.

---

## 9. Running the same agent from two devices at once is mostly unbuilt

**Designation: `DOD-PRIMARY-1`** (+ `DOD-POLICY-1`, `DOD-PORTAB-1`) — deliberately out of scope

The design exists and the directory-side security core is built and tested, but the enforcement that
stops two devices fighting over control isn't wired in, the handshake between your two devices
doesn't exist, syncing between them doesn't exist, and no failover test has been run. Still
deliberately out of scope.

**Correction to an earlier pass**, which closed this item with "one agent on one device works
completely fine without any of it." That was false at the time: two *sessions* on one device, on one
daemon, silently lost each other's messages. That defect is now fixed (M8D — see Addressed), but it
was never covered by anything in this item, and multi-*device* remains unbuilt.

---

## 10. A failed endorsement submission is not retried

**Designation: `DOD-END-SUBMIT-1`** (one remaining handed-forward AC) + one of `DOD-END-SURFACE-1`'s
nine clauses.

If the directory node you send an endorsement to is down, the submission fails and you run the
command again. There is no automatic failover to another node, even though the consortium has three.

**Why it is here and not fixed:** it is a papercut, not a loss — nothing is destroyed and the error
names the cause. Andre triaged it as ship-without on 2026-07-31.

---

## 11. The trust-signal floor is built and deliberately switched off

**Designation: `DOD-FLOOR-1`**

The floor is the "minimum bar to talk to me" — a counterparty must present N signals, or a particular
type, before a session is accepted. It is implemented and unit-tested, and NOTHING CALLS IT. That is
correct for launch: switching it on with any default would start refusing counterparties who have no
signals yet, which is everybody on day one.

**This is an M10 line, not M10B.** It sat on the M10B list because M10B produces the `same_operator`
flag the floor's counting rule consumes (`DOD-END-COUNT-1`) — M10B produced it correctly and proved
it live; the consumer lives here. Recorded 2026-07-31 so it stops being re-discovered as endorsement
debt.

**When it matters:** the first time an operator wants to be selective about who reaches them. Not
before there are signals worth demanding.

---

## 12. "Online" does not mean reachable

`cello status` shows an agent as `online` with `standing_receiver_ready: true` whenever its signalling
connection is up — even when the daemon cannot resolve a single directory endpoint and no session can
possibly form.

**Found the hard way, 2026-07-31.** After the infra wake, this host held a stale DNS cache (hibernate
deletes the ALBs; wake recreates them with new IPs). libp2p kept connecting off the bundled manifest,
so all five agents reported healthy while every cross-node session died. It surfaced in sequence as
`counterparty_offline`, then `directory_below_threshold`, then `ceremony_exhausted` — three errors
naming three different subsystems, none of them the cause. `dns_error` was in the daemon log 26 times
per node from startup and never reached the operator.

The immediate trigger turned out to be the AWS→GCP migration, and the DNS surfacing is being handled
separately. What stays open is the status word itself: an agent that cannot hold a session should not
render identically to one that can.

**Cost if unfixed:** roughly an hour, every time, and the first conclusion is always "the protocol is
broken."

---

## 13. Dead signaling streams go undetected — the mesh did NOT supersede it

**Designation:** [[2026-07-31_1200_incident-standing-receiver-not-reregistered-on-reconnect]] — no
DoD line, **needs one opened.** Recorded 2026-08-03 as a decision to skip on the grounds that the M12
cutover would make the class moot. **That premise was checked 2026-08-04 and is false**, so this is a
real open item again rather than a parked decision.

The 2026-07-31 incident: an agent reported online on every surface — `cello status`, the daemon, the
directory's own database — while nothing could reach it, silently, for ~25 minutes, recovering only
on a daemon restart.

**A fix shipped for this incident and it closes a different hole.** Daemon `0.0.105` (`2e734a1`)
re-registers the standing receiver on signaling reconnect, and it is still wired (`daemon.ts:614`).
The incident log's own CORRECTION explains why that is not this defect: `targetStreamFound` reads the
directory's `#streams` map, which is populated at **auth** time and is not the standing receiver —
re-registering one does not repopulate the other. The trigger is wrong too: `onConnected` fires on a
reconnect, and the client's first disconnect came 23 minutes *after* the failure.

**The actual mechanism, and why the heartbeat does not catch it.** The directory's `#streams` entry
for the agent disappeared server-side. The client observed nothing — no disconnect, therefore no
reconnect, therefore no re-authentication, therefore nothing repopulated that map. The transport
stream was genuinely alive, so the 15 s ping / 15 s pong heartbeat had nothing to report. **What is
missing is a liveness check on the *registration*, not on the socket.** Why the server-side entry
vanished was never traced.

**Verified 2026-08-04: no code has changed on either side since.** No commits to
`signaling-manager.ts`, `signaling-connect.ts`, or the directory's `directory-node.ts`; the four
`#streams` mutation sites are as they were.

**The cutover verification, run 2026-08-04 — it does not clear this.** The skip was conditional: the
class only dies if the cutover changes the **client-to-node** link. [[M12-ANTI-ENTROPY-DESIGN]] §8
names the client protocol explicitly under *"What this design does NOT change"*, and the mesh replaces
the **node-to-node** layer. Presence replicating perfectly does not revive a dead client stream —
every node just agrees the agent is owned by a node that cannot reach it. **The detection defect
survives the cutover verbatim.**

**The parked-mailbox mitigation does NOT apply — checked 2026-08-04.** The original escape clause
also allowed the class to die if recovery leaned on the parked-mailbox drain, leaving the operator
with delayed delivery rather than a blackout. It does not: the failure is a **session request**
answered `target_offline`, which `outbound-sessions.ts:664` retries a bounded number of times and
then surfaces as `counterparty_offline`. The session never forms, so no message ever parks. There is
nothing to drain.

**So the severity stands as written.** A silent unreachability with every surface reporting `online`
is the same shape as the logout item (item 3) and the reachability item (item 12): the visible state
and the network behaviour disagree, and the operator believes the visible one. Andre ranks it.

**Named threads to pull first** when the work starts: why the directory drops a `#streams` entry with
no client-observable event, and the untraced `The operation was aborted due to timeout` reader errors
(2,061), which read like an `AbortSignal` on our side but are not raised in `signaling-manager.ts`.

---

## 14. Endorsements cannot be withdrawn, refused-drained, or quota-limited

**Designations: `DOD-END-WITHDRAW-1`, `DOD-END-INGRESS-1`, `DOD-END-QUOTA-1`** — all ❌ in
[[M10B-DEFINITION-OF-DONE]]. **Accepted onto the list 2026-08-03 (Andre)** — this list carries their
siblings (items 10, 11), and these now stand as open items alongside them.

An issuer cannot withdraw an endorsement they issued; nothing consumes the `refuse` op (the portal
drain); issuance quota is unenforced and invisible. Each is recorded in M10B as one line of work
once its mechanism exists. Ranking within the list is Andre's, like everything above.

---

# Needs a decision or a diagnosis, not a build

**`DOD-ACCOUNTS-CHAIN-1` — unknown severity, cheap to resolve, worth resolving before ranking it.**
A hash-chain verification fails on the table that binds a human to an agent, but only when the
ops-agent test suite has run against the same database. Either the ops-agent registration flow
writes rows outside the chain mechanism — a real tamper-evidence gap in production, which would put
this near the top of the list — or the test's whole-table scope is too strong for a shared dev
database, which makes it nothing. The repro is recorded. Do not close it by scoping the test down
until the first possibility is ruled out.

**FROST debug logging in production.** Recorded inside `DOD-FROST-PARALLEL-1` and never triaged on
its own: the directory is reported to flood production CloudWatch with `frost.debug.*` and raw
`[DEBUG]` lines "carrying share and nonce internals." Nobody has assessed what is actually in those
lines. Threshold-signature nonce material in a log store deserves its own look rather than a
footnote in a performance ticket — if the report is accurate it is a security item; if it's
over-stated it costs half an hour to say so.

**`DOD-FROST-PARALLEL-1` itself is an M12 dependency, not a launch item.** Session setup walks the
directory roster one node at a time. That costs nothing at today's single directory, but its own
analysis puts it over the acceptable-latency bar at three or four directories — which M12 crosses
while adding GCP nodes. Flagged here so it isn't lost; it belongs to that milestone, not this list.

---

# Left off this list on purpose

Recorded so they stop being re-found by every sweep:

- **`DOD-TESTDAEMON-REAP-1`** (M8C, ❌ raised 2026-07-30) — the test harness leaks its subject
  daemon, which then hammers the dev directory indefinitely. Raised in the same batch as items 2–4;
  the only one of the four not carried here. Dev tooling, not a customer-facing defect — ship
  without.
- **`DOD-SESSION-REAP-1`** (M8C, ❌ backlog) — restart-interrupted sessions accumulate as
  un-sealable cruft. Its own line says cosmetic, not launch-blocking; the reaper must be
  evidence-gated, never age-gated, when it is built. Ship without.
- **`DOD-SPINE-JCONTENT-1`** (M8D, 🅿️) — the live parked-message spine journey is 5/10 green.
  Test-harness debt; the two product defects it surfaced are fixed.

---

# Addressed — off the open list

Everything below has been dispositioned and is **not** work-remaining. Kept for lookup and so the
same defect isn't re-discovered as new.

## Fixed and verified

- **Sealed receipts were missing the conversation's opening message** — `DOD-FIRSTMSG-WITNESS-1`.
  ✅ **Shipped 2026-07-31**, daemon `0.0.106` / cli `0.0.109`, verified in the tarball, J-END 10/10.
  A first message sent before relay registration completed was rejected and never counted, leaving
  the local record one position ahead of the relay's for the life of the conversation — and the
  certificate is built only from what the relay witnessed, so the receipt covered the conversation
  *minus its opening message* and still verified. Fired 16/16 when the first message beat
  registration, and only when both agents were on one machine — squarely the solo-multi-agent daily
  case. The responder now presents the relay assignment itself, so the first message is genuinely
  witnessed rather than re-ordered. Reviewed twice; the blocking finding was that the one line that
  IS the fix had no test — reverting it left the whole suite green. Closed and revert-tested.
  **Residue lives on open item 4:** three paths still end unwitnessed, so relay position is not
  total.
- **Two windows on one agent silently stole each other's messages** — `DOD-COATTEND-VISIBLE-1`
  (detection) plus `DOD-COATTEND-1`, `-CATCHUP-1`, `-SENDWINDOW-1` (the redesign). ✅ **M8D closed
  2026-08-02, all six lines proven live** on cli `0.0.122` / daemon `0.0.119` / connect `0.0.116`.
  Both halves shipped, not just the cheap one: delivery no longer pops a shared queue (a sibling
  reading takes nothing away), the send path re-checks the frontier immediately before the wire, and
  `cello_transcript` is the documented catch-up door. Attendance rides **every** read surface, not
  only the doorbell — the first live run failed exactly there, and the review then caught that the
  first fix covered 4 of 12 exits while the commit, comment and journal all claimed "every". The
  closing proof was an unscripted question into a second window, which volunteered co-attendance and
  its operational consequence on its own.
  **Deliberately unchanged, do not "fix" later:** the counterparty sees one agent with no session
  ordinal — leaking window structure across the wire buys nothing. And two windows of one agent do
  not gate each other at send time; the principal is the agent, not the socket.
- **A conversation could become permanently unsealable, silently** — `DOD-FRONTIER-STRAND-1`, ACs
  1–3 ✅. Duplicate detection is keyed on relay-assigned position instead of message content
  (cello-client `a54f548`, drift fix `6e314b7`), landing right behind the receipt-drift fix it
  depended on. **The detection remainder is still open as item 4.**
- **`SEC-1`** — a stranger could plant a message in your mailbox using only your public key. Fixed,
  reviewed, published and promoted 2026-07-12. The design pass found the relay itself was the party
  best placed to exploit it; parked messages are now signed before deposit and pickup verifies.
- **`DOD-DAEMON-CLEANUP-1` / `DOD-SINGLE-DAEMON-1`** — two daemons could run against one database,
  and the obvious fix could kill the real one. Fixed 2026-07-13 with a real POSIX lock.
- **`SEC-2`** — the defense against forged signing requests had never been watched rejecting one.
  Proven live 2026-07-12 against the real directory, confirmed in the server-side log.
- **`DOD-CRYPTO-AT-REST-1`** — the security-screening layer kept its records and settings in a
  plaintext database. Fully closed 2026-07-30 by M9B; both stores now live in one SQLCipher file.
- **`DOD-CONFIG-1`** — parked settings knobs waiting on a store that didn't exist. Absorbed
  2026-07-29 into M9B's config surface. What remains is a product decision about merging two config
  surfaces, not a missing mechanism.

## Ruled out without a fix

- **A node absent during an agent's DKG can never serve that agent** — M8B Sprint B "Enrollment
  (Problem 3)" + absent-node reconcile. **Ruled 2026-08-03 (Andre): not a launch item.** The AWS-era
  instance is superseded outright — the GCP cutover went greenfield by decision (fresh agents, fresh
  DKGs, wiped directories, no identity migration, [[M12-CUTOVER-CHECKLIST]]), so no launch agent
  carries a DKG that ran during a node outage. What survives is structural and cloud-agnostic: shares
  never replicate (`SHARES-LOCAL`) and no resharing ceremony exists, so a node added *after* an
  agent's DKG can never serve that agent. That is a **node-expansion gate** — the same category this
  list parks `DOD-FROST-PARALLEL-1` under. Plan for the day it matters:
  [[2026-07-04_0556_tofn-registration-availability-quorum-enrollment-plan]].

## The old "already solid" list — a lesson worth keeping

An earlier pass ended with eight things marked "confirmed working, no action needed." Five days of
deliberate defect-hunting found real bugs in four of them — the read-before-reply guard (fixed by
M8D above), auto-away-replies firing before the caller had spoken and again on a closing message
(fixed 2026-07-23/24), session requests whose session had already closed sitting in the pending queue
forever (fixed 2026-07-22), and a sealed session's final message showing unread with no way to clear
it (fixed).

That list was a snapshot of confidence rather than a record of verification, and it did not survive
contact with someone looking. **It has not been reinstated, and shouldn't be** — a claim that
something needs no action is worth exactly the enforcer behind it, and these had none.

---

## Related Documents

- [[M8C-DEFINITION-OF-DONE]] — full technical detail and status for every designation above
- [[M8D-DEFINITION-OF-DONE]] — the co-attendance and frontier lines, and the parked debt on item 4
- [[M8C-ONBOARDING-IMPROVEMENTS]] — the Telegram/CLI onboarding checklist (item 6)
- [[2026-07-31_1043_two-sessions-one-agent-co-attendance]] — the receipt-integrity cluster and the
  co-attendance decision, with the build order at the top
- [[2026-07-30_1423_cello-claude-code-plugin-and-channels-allowlist]] — items 5 and 7
- [[2026-07-31_1200_incident-standing-receiver-not-reregistered-on-reconnect]] — item 13, with the
  measurements and the open questions the cutover verification must answer
- [[protocol-map]] — where these fit relative to the overall milestone sequence
