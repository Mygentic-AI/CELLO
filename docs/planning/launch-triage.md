---
name: Launch Triage
type: triage
date: 2026-07-31
topics: [launch, security, backup, receipt-integrity, kill-switch, daemon-lifecycle, telegram, install, triage, sealed-sessions, wake]
status: open
description: >
  The launch punch list. Ranked by what actually goes wrong if left alone, not by build status.
  Plain-language explanation + designation for each, so this doc works as both a punch list and a
  lookup table into the DoD docs. Re-ranked 2026-08-04 by Andre: the order below is the decided
  priority, not a first pass. Four items moved to a new "Post-launch" section — needed eventually,
  not for launch. Open items carry contiguous numbers and renumber when something closes;
  cross-references use names, not numbers, so they survive it.
  2026-08-05: added DOD-TERMINAL-WAKE-1 (item 12) as unranked — a sealed session's unread messages
  ring the doorbell as live work and an agent acted on an expired directive. Slot proposed beside
  DOD-SEALED-INBOX-2 (shared consumers); ranking not yet decided.
---

# Launch Triage

**Refreshed 2026-07-31, restructured 2026-08-04, re-ranked 2026-08-04 (Andre).** The ranking below
is now the decided order. Four items (multi-device, endorsement retry, the floor, endorsement
withdraw/refuse/quota) moved to **Post-launch — needed eventually, not for launch**. Three scoping
decisions were made in the same pass and are recorded on their items: the sealed-inbox fix is a
**one-pass rename** (no two-stage plan), the dead-signaling-streams item is **split** into a
mitigation build and a timeboxed trace, and backup/restore is scoped to **export + overwrite-restore**
with merge explicitly deferred.

**Context that changed since the last pass: M12 is complete.** The merge and cutover are done and
CELLO now runs fully on the GCP infrastructure (three directory nodes). Notes below that treated M12
as future have been corrected in place.

**The test, unchanged:** at launch, if this is not done, will it *fundamentally ruin* a prospective
customer — or is it something they could *forgive*? Ruin = they can't get the core value, or they
lose trust. Most things are forgivable.

**How to use this:** work the ranked list top to bottom. (The two "run first" diagnoses this
section used to carry were both resolved 2026-08-04 — one became ranked item 3, one was ruled out;
see the notes below.)

---

# Open — ranked (order decided by Andre, 2026-08-04)

**Both "run first" diagnoses were resolved 2026-08-04**, same day: the FROST debug-logging report
was **overstated** (ruled out — see Addressed), and `DOD-ACCOUNTS-CHAIN-1` was **confirmed as a
real tamper-evidence gap** — it is now ranked item 3 below (proposed slot; Andre confirms).

## 1. Logging out says the daemon stopped while it is still on the network

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

**Decided 2026-08-04 (Andre): one pass, including the rename.** The earlier plan deferred renaming
`sealed_unread` → something status-neutral (`ended_unread`) because it is a wire change for the shim
and the receptionist skill. Pre-launch, with one operator and a greenfield cutover behind us, is the
only time a wire change is free — deferring it is exactly the migration trap this doc warns about.
Do the rename, the per-row `status`, and the corrected guidance string together, now.

---

## 3. Every real registration writes the human-agent binding outside the hash chain

**Designation: `DOD-ACCOUNTS-CHAIN-1`** — ❌ open, raised 2026-07-13, **diagnosed 2026-08-04:
possibility (a) confirmed — a real tamper-evidence gap, not a test artifact.** Proposed slot; Andre
confirms the rank.

`user_accounts` — the table that binds a human to an agent — has two writers, and production uses
the wrong one. The registration path (`directory-node.ts:3170`, step 6 after DKG) calls
`resolveAccountId` (`pre-auth-token-repository.ts:511`), which does a bare `INSERT` with
`chain_hash = SHA-256(account_id || phone_stub_hash)` — a standalone hash, not the chain format
(`SHA-256(serialize(record) || previous_chain_hash)` from the genesis constant, under advisory
lock). The chained writer that ACCOUNT-001 built for exactly this table —
`PgDirectoryStore.createAccount` via `insertWithChain` — has **zero production callers**; only
tests exercise it.

Consequences: `verifyChain("user_accounts")` fails on any database where a real registration has
ever happened — which is why the ops-agent suite reddened the directory suite. Worse, because
verification is *always* red on this table, actual tampering would be indistinguishable from the
baseline: tamper-evidence on the human-agent binding is currently nonfunctional, silently.

Fix shape: route `resolveAccountId`'s insert through the chain writer while preserving the
lookup-or-create dedup semantics (the advisory lock `insertWithChain` already takes makes
check-then-insert race-free, replacing the `ON CONFLICT DO NOTHING` + readback dance). Existing
unchained rows: the GCP directories are greenfield with a handful of post-cutover registrations, so
rechaining or reseeding the table is cheap now and becomes a migration later — the usual trap.

---

## 4. Dead signaling streams go undetected — build the liveness mitigation, timebox the trace

**Designation:** [[2026-07-31_1200_incident-standing-receiver-not-reregistered-on-reconnect]] — no
DoD line, **needs one opened.** Recorded 2026-08-03 as a decision to skip on the grounds that the M12
cutover would make the class moot. That premise was checked 2026-08-04 and is false, so this is a
real open item. **Split 2026-08-04 (Andre): the launch item is the mitigation build; the root-cause
trace is timeboxed, not open-ended** — as one blob this was a rabbit hole.

The 2026-07-31 incident: an agent reported online on every surface — `cello status`, the daemon, the
directory's own database — while nothing could reach it, silently, for ~25 minutes, recovering only
on a daemon restart.

**The launch half — a liveness check on the *registration*, not the socket.** The directory's
`#streams` entry for the agent disappeared server-side. The client observed nothing — no disconnect,
therefore no reconnect, therefore no re-authentication, therefore nothing repopulated that map. The
transport stream was genuinely alive, so the 15 s ping / 15 s pong heartbeat had nothing to report.
A periodic re-register (or a registration echo the client verifies) converts "25 minutes of silent
blackout" into "self-heals within one check interval" — which is what the launch test demands.

**The timeboxed half — the untraced mystery.** Why the server-side `#streams` entry vanished was
never traced. Named threads to pull: why the directory drops a `#streams` entry with no
client-observable event, and the untraced `The operation was aborted due to timeout` reader errors
(2,061), which read like an `AbortSignal` on our side but are not raised in `signaling-manager.ts`.
If the timebox expires without an answer, the mitigation stands on its own and the trace parks.

**Why the earlier fix does not cover this.** Daemon `0.0.105` (`2e734a1`) re-registers the standing
receiver on signaling reconnect, and it is still wired (`daemon.ts:614`). The incident log's own
CORRECTION explains why that is a different hole: `targetStreamFound` reads the directory's
`#streams` map, which is populated at **auth** time and is not the standing receiver —
re-registering one does not repopulate the other. And `onConnected` fires on a reconnect, while the
client's first disconnect came 23 minutes *after* the failure.

**Why the cutover does not clear it — verified 2026-08-04.** The skip was conditional: the class
only dies if the cutover changes the **client-to-node** link. [[M12-ANTI-ENTROPY-DESIGN]] §8 names
the client protocol explicitly under *"What this design does NOT change"*, and the mesh replaces the
**node-to-node** layer. Presence replicating perfectly does not revive a dead client stream — every
node just agrees the agent is owned by a node that cannot reach it. No code has changed on either
side since the incident (`signaling-manager.ts`, `signaling-connect.ts`, `directory-node.ts`; the
four `#streams` mutation sites are as they were).

**The parked-mailbox mitigation does NOT apply — checked 2026-08-04.** The failure is a **session
request** answered `target_offline`, which `outbound-sessions.ts:664` retries a bounded number of
times and then surfaces as `counterparty_offline`. The session never forms, so no message ever
parks. There is nothing to drain.

Same shape as the logout item and the "online does not mean reachable" item: the visible state and
the network behaviour disagree, and the operator believes the visible one.

---

## 5. The Telegram sign-up messages give wrong or unclear instructions

**Designation: `D-ENVVAR`** (+ the rest of Phase 1 in `M8C-ONBOARDING-IMPROVEMENTS`)

The registration bot tells a new user to set something that doesn't exist, among a few other unclear
or inconsistent messages along that flow. A literal first-time follower gets stuck with no next
step. Not a security issue — a bad first impression. Fixing it is tedious rather than hard: several
message rewrites plus the tests that check the exact wording, in one repo.

Same class as the plugin-install item below — a first-time user hits a dead end with wrong or no
instructions. The two want one pass.

---

## 6. Installing the plugin strands a new user at `daemon_not_running` with no signpost

**Designation:** [[2026-07-30_1423_cello-claude-code-plugin-and-channels-allowlist]] — **needs a DoD
line opened.** **Narrowed 2026-08-04:** the launch-sized item is the failure path, not the install.

The plugin is the official install route. Installing it copies files and runs nothing: the MCP shim
arrives lazily, but the `cello` binary and the daemon do not. A new user installs, sees the tools,
calls one, and gets `daemon_not_running` — a dead end with no next step. The `setup` skill is the
only thing that closes that gap today, and nothing points at it.

The earlier framing ("install should give you a working CELLO") pulls toward an install hook — which
would have a plugin install start a long-running process holding key material and a network
identity, a much bigger claim on a user's machine than a plugin install normally makes. That
decision stays deliberately unresolved. **The launch fix is smaller: the `daemon_not_running`
failure path names the fix** ("run the setup skill") so a first-time user is never stranded without
a next step. A message change plus a doc line, sharing a pass with the Telegram item above.

---

## 7. "Online" does not mean reachable

`cello status` shows an agent as `online` with `standing_receiver_ready: true` whenever its signalling
connection is up — even when the daemon cannot resolve a single directory endpoint and no session can
possibly form.

**Found the hard way, 2026-07-31.** After the infra wake, this host held a stale DNS cache (hibernate
deletes the ALBs; wake recreates them with new IPs). libp2p kept connecting off the bundled manifest,
so all five agents reported healthy while every cross-node session died. It surfaced in sequence as
`counterparty_offline`, then `directory_below_threshold`, then `ceremony_exhausted` — three errors
naming three different subsystems, none of them the cause. `dns_error` was in the daemon log 26 times
per node from startup and never reached the operator.

The immediate trigger turned out to be the AWS→GCP migration (now complete), and the DNS surfacing
is being handled separately. What stays open is the status word itself: an agent that cannot hold a
session should not render identically to one that can.

**Cost if unfixed:** roughly an hour, every time, and the first conclusion is always "the protocol is
broken."

---

## 8. A mismatch that makes a conversation unsealable leaves no durable trace

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
undercuts precisely the "a week unnoticed" concern that made this item severe. Of the two options
written into the DoD line, **prefer derive-on-read from the persisted seal-rejection record** — it
cannot drift from the evidence, where a written flag can.

**One inherited caveat, carried from the receipt-drift fix:** three paths still end unwitnessed
(relay down, terminal assignment rejection, retry exhaustion), so **relay position is not total** and
anything keyed on it must not assume it is.

---

## 9. A daemon shutdown rings the doorbell like an incoming message

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

## 10. Telegram phone notifications are built and tested, but never proven on a real phone

**Designation: `DOD-TGDOOR-1`** — 🟡 *(still the only Tier-3 unit that can't be smoke-tested without
a real bot token)*

The doorbell-to-Telegram feature is built and passes its test suite, but has never been watched
working end-to-end on an actual phone. Low risk either way; just unverified. Flips to done on a live
proof, nothing else — minutes with a phone, do it opportunistically whenever Andre is at hand.

---

## 11. There is still no way to back up or recover your identity

**Designation: `DOD-CUSTODY-DAEMON-1`** — demoted from #1 on 2026-08-04; scoped the same day. (Renumbered #10→#11 when the accounts-chain item landed.)

`backup` and `restore` exist as commands, but nothing behind them works — call either one and it
reports "not implemented." If your machine is lost, stolen, or dies, that agent and everything it
knows is gone permanently. No safety net exists today. The logic has to move out of the chat-tool
layer and into the daemon as an actual capability.

**Why it ranks last among real work:** its failure mode fires only on device loss, and a day-one
user with no accumulated endorsements or history loses a re-registration, not the product. The
kill-switch and false-claim items above fire for every user immediately.

**Scope, decided 2026-08-04 (Andre):** the launch shape is smaller than the old framing implied.
- **Backup** = exporting the (SQLCipher) database for transport. Not hard.
- **Restore V1** = overwrite the existing database on the target device. Simple.
- **Merge** — restoring onto a device that has its own live state — is the genuinely costly part,
  and it is **explicitly deferred**. Launch ships export + overwrite-restore; merge gets its own
  item when it earns one.

Confirmed still open as of 2026-07-30 — M9B's closure note records that `cello_backup` and
`cello_restore` remain stubs, and that a round-trip proof is owed to whoever builds them.

---

## 12. A sealed session's unread messages ring the doorbell as live work, and agents act on them

**Designation: `DOD-TERMINAL-WAKE-1`** — ❌ open, raised 2026-08-05. **Unranked — slot proposed, not
decided.** Proposed to sit beside `DOD-SEALED-INBOX-2`: same code surface, different defect.

Messages that were still unread when a session sealed stay unread forever — correctly. The seal
attests what each side actually consumed (`content_frontier_seq` per participant,
`final_message.answered`), so advancing the watermark at seal would falsify the receipt. **That
behaviour is right and is not what this item asks to change.** The messages are also still in the
notarized transcript; they are leaves in the tree. Nothing is missing from the record.

The defect is downstream and purely presentational: those messages are surfaced as **pending,
actionable work** with no signal that the session is terminal. Nothing can be appended to a sealed
session, so there is no action any agent can take — but the wake is indistinguishable from a live
inbound message, and an agent reading one has no way to tell it is answering a conversation that
ended hours ago.

**Observed live 2026-08-05** on the Hermes-bridged agent `Miss_Chelly_H`. Three sessions sealed in
the morning all re-fired as wakes six to eight hours later:

| Session | Sealed | Re-fired |
|---|---|---|
| `9014d071…` | 07:37:45 (`seal.autoacknowledged`) | 13:44:45 |
| `82c2d10c…` | 05:53:19 (`node.destroyed reason:"sealed"`) | 14:19:27 |
| `b9fed6e5…` | 06:19:16 (seal verified) | 14:19:27 |

**Why this is more than noise.** The `9014d071` message carried a directive — *"I am about to take
my receiver down deliberately; when I ask, send one message even though I look unreachable. Do not
seal. `[[STANDBY EST:15m]]`"*. The agent read it as live, announced it was standing by, and waited
on a counterparty whose daemon held no record of the session at all. Its 15-minute standby had
expired roughly six hours earlier. **An agent obeying an expired instruction from a terminal session
is a correctness failure, not a cosmetic one** — and it is self-concealing, because the agent
reports a perfectly coherent status ("standing by as asked") that happens to be about a dead
conversation.

**Diagnosis signature:** `message.watermark.advanced` firing with a *fresh* timestamp for an old
`sequence`, on a session whose last real event was a seal. Confirm terminality with
`grep <sessionId> ~/.cello/daemon.log | grep -E "seal|node.destroyed|liveness"`.

**Shape of the fix — not "advance the watermark at seal."** A terminal session must not generate an
actionable wake or count as pending work. The message stays honestly unread on the record; it just
stops ringing the bell. This shares consumers with `DOD-SEALED-INBOX-2` (`notification-handlers.ts`,
`session-read-handlers.ts`, `session-node-manager.ts`, and the shipped
`plugins/cello/skills/receptionist/SKILL.md`), so the two are worth doing in one pass — that item's
per-row `status` is a precondition for this one, since a consumer cannot suppress what it cannot
distinguish.

**Triage note, stated plainly:** this needs a daemon restart plus unread-at-seal to trigger, and the
blast radius is a confused agent rather than lost or corrupted data — so it does not obviously fail
the ruin test on its own. What argues for it is the pairing: it lands on the same files as a ranked
item, and "agent confidently acts on an expired instruction" is the kind of thing a technical
evaluator reads as unsound in a trust product. Ranking is Andre's call.

---

# Post-launch — needed eventually, not for launch

**Moved here 2026-08-04 (Andre).** Not on the launch punch list; none fails the ruin test. Kept
whole so nothing has to be re-derived when one comes due.

## Running the same agent from two devices at once is mostly unbuilt

**Designation: `DOD-PRIMARY-1`** (+ `DOD-POLICY-1`, `DOD-PORTAB-1`) — deliberately out of scope

The design exists and the directory-side security core is built and tested, but the enforcement that
stops two devices fighting over control isn't wired in, the handshake between your two devices
doesn't exist, syncing between them doesn't exist, and no failover test has been run.

Note the launch intent's "your own two agents across devices" is two *identities* on two devices —
which works. This item is one identity on two devices: a different thing, correctly deferred.

**Correction to an earlier pass**, which closed this item with "one agent on one device works
completely fine without any of it." That was false at the time: two *sessions* on one device, on one
daemon, silently lost each other's messages. That defect is now fixed (M8D — see Addressed), but it
was never covered by anything in this item, and multi-*device* remains unbuilt.

## A failed endorsement submission is not retried

**Designation: `DOD-END-SUBMIT-1`** (one remaining handed-forward AC) + one of `DOD-END-SURFACE-1`'s
nine clauses.

If the directory node you send an endorsement to is down, the submission fails and you run the
command again. There is no automatic failover to another node, even though the consortium has three.
A papercut, not a loss — nothing is destroyed and the error names the cause. Andre triaged it as
ship-without on 2026-07-31.

## The trust-signal floor is built and deliberately switched off

**Designation: `DOD-FLOOR-1`**

The floor is the "minimum bar to talk to me" — a counterparty must present N signals, or a particular
type, before a session is accepted. It is implemented and unit-tested, and NOTHING CALLS IT. That is
correct for launch: switching it on with any default would start refusing counterparties who have no
signals yet, which is everybody on day one. There is no launch work here at all.

**This is an M10 line, not M10B.** It sat on the M10B list because M10B produces the `same_operator`
flag the floor's counting rule consumes (`DOD-END-COUNT-1`) — M10B produced it correctly and proved
it live; the consumer lives here. Recorded 2026-07-31 so it stops being re-discovered as endorsement
debt.

**When it matters:** the first time an operator wants to be selective about who reaches them. Not
before there are signals worth demanding.

## Endorsements cannot be withdrawn, refused-drained, or quota-limited

**Designations: `DOD-END-WITHDRAW-1`, `DOD-END-INGRESS-1`, `DOD-END-QUOTA-1`** — all ❌ in
[[M10B-DEFINITION-OF-DONE]]. **Ruled post-launch 2026-08-04 (Andre)**, same logic as their siblings
above: endorsements are the secondary layer, and at launch there are almost no endorsements to
withdraw, no refusals to drain, and quota abuse needs volume that won't exist day one.

An issuer cannot withdraw an endorsement they issued; nothing consumes the `refuse` op (the portal
drain); issuance quota is unenforced and invisible. Each is recorded in M10B as one line of work
once its mechanism exists. Of the three, quota is the one with a safety edge (unbounded issuance) —
first to revisit if endorsement volume appears.

---

# Parked as node-expansion gates, not launch items

**`DOD-FROST-PARALLEL-1`** — session setup walks the directory roster one node at a time. Its own
analysis puts it over the acceptable-latency bar at three or four directories. **M12 is complete and
the GCP consortium runs the same N=3 as the AWS one did, so the bar was not newly crossed by the
cutover** (the old note tied this to M12 as a future milestone — stale, corrected 2026-08-04). It
comes due when a fourth node is added, alongside the enrollment gate below.

**Enrollment / absent-node service** — M8B Sprint B "Enrollment (Problem 3)" + absent-node
reconcile. Ruled 2026-08-03 (Andre): not a launch item. The AWS-era instance is superseded outright
— the GCP cutover went greenfield by decision (fresh agents, fresh DKGs, wiped directories, no
identity migration, [[M12-CUTOVER-CHECKLIST]]), so no launch agent carries a DKG that ran during a
node outage. What survives is structural and cloud-agnostic: shares never replicate (`SHARES-LOCAL`)
and no resharing ceremony exists, so a node added *after* an agent's DKG can never serve that agent.
Plan for the day it matters:
[[2026-07-04_0556_tofn-registration-availability-quorum-enrollment-plan]].

---

# Left off this list on purpose

Recorded so they stop being re-found by every sweep:

- **`DOD-TESTDAEMON-REAP-1`** (M8C, ❌ raised 2026-07-30) — the test harness leaks its subject
  daemon, which then hammers the dev directory indefinitely. Raised in the same batch as the
  sealed-inbox / logout / mismatch items; the only one of the four not carried here. Dev tooling,
  not a customer-facing defect — ship without.
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
  **Residue lives on the open mismatch-trace item:** three paths still end unwitnessed, so relay
  position is not total.
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
  depended on. **The detection remainder is still open as the mismatch-trace item.**
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

- **FROST debug logging in production — overstated, ruled out 2026-08-04.** The report (recorded
  inside `DOD-FROST-PARALLEL-1`) said the directory floods production logs with `frost.debug.*` and
  raw `[DEBUG]` lines "carrying share and nonce internals." Audited every emit site
  (`frost-handler.ts`, `persistent-share-store.ts`, `directory-node.ts`, plus a repo-wide hunt for
  any logger/stdout line touching `share.secret`, `signingShare`, or nonce values): **no secret
  material is logged anywhere.** Every line emits types, lengths, key *names*, counts, and truncated
  public identifiers (`agentShort`, epoch IDs, peer-ID prefixes) — the pattern is
  `shareSecretIsUint8Array: true`, never the bytes. Nonce *commitments* appear only on the wire,
  where FROST defines them as public. The sites last changed 2026-07-29, before the GCP images were
  built, so the audit reflects production. What remains is **noise, not security**: ~30 info-level
  debug events per ceremony plus raw `process.stdout.write` `[DEBUG]` lines that bypass the injected
  logger (against the M4 logging rule). That is post-launch cleanup — gate or strip them when
  `DOD-FROST-PARALLEL-1` is picked up at node expansion.

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
- [[M8D-DEFINITION-OF-DONE]] — the co-attendance and frontier lines, and the parked debt on the
  mismatch-trace item
- [[M8C-ONBOARDING-IMPROVEMENTS]] — the Telegram/CLI onboarding checklist
- [[2026-07-31_1043_two-sessions-one-agent-co-attendance]] — the receipt-integrity cluster and the
  co-attendance decision, with the build order at the top
- [[2026-07-30_1423_cello-claude-code-plugin-and-channels-allowlist]] — the plugin-install and
  shutdown-doorbell items
- [[2026-07-31_1200_incident-standing-receiver-not-reregistered-on-reconnect]] — the dead-signaling
  item, with the measurements and the open questions
- [[protocol-map]] — where these fit relative to the overall milestone sequence
