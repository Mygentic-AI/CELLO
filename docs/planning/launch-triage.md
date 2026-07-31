---
name: Launch Triage
type: triage
date: 2026-07-31
topics: [launch, security, backup, receipt-integrity, kill-switch, daemon-lifecycle, telegram, install, triage]
status: open
description: >
  The launch punch list, refreshed 2026-07-31. Ranked by what actually goes wrong if left alone,
  not by build status. Plain-language explanation + designation for each, so this doc works as
  both a punch list and a lookup table into M8C-DEFINITION-OF-DONE. Supersedes the 2026-07-12
  pass: four of those nine items are closed, two of its claims turned out to be false, and five
  days of defect-hunting (2026-07-26 → 31) added a receipt-integrity cluster that outranks
  everything that was on the original list. Ranking is a first pass; Andre sets the real priority.
---

# Launch Triage

**Refreshed 2026-07-31.** The previous pass was written 2026-07-12 and had drifted: four of its
nine items shipped, one changed shape, and two of its statements were falsified by later work.
This is a current pass, not an append.

**The test, unchanged:** at launch, if this is not done, will it *fundamentally ruin* a prospective
customer — or is it something they could *forgive*? Ruin = they can't get the core value, or they
lose trust. Most things are forgivable.

**How to use this:** read top to bottom, then tell me the real priority order — the ranking below
is my first pass, not a decision.

---

## What changed since the last pass

Four items closed: the relay-mailbox forgery hole (`SEC-1`), the double-daemon bug
(`DOD-SINGLE-DAEMON-1`), the unproven forged-signing-request defense (`SEC-2`), and the
unencrypted security-screening records (`DOD-CRYPTO-AT-REST-1`, fully closed 2026-07-30 by M9B).
One changed shape: the parked settings knobs (`DOD-CONFIG-1`) were absorbed into M9B's config
surface on 2026-07-29 and are no longer waiting on a store that doesn't exist.

**Two claims in the old pass were wrong**, both corrected below: that the read-before-reply guard
was confirmed working, and that "one agent on one device works completely fine" without the
multi-device feature. See the last section.

---

# Open — ranked

## 1. ✅ FIXED — Sealed receipts are missing the conversation's opening message

**Designation: `DOD-FIRSTMSG-WITNESS-1`** — ✅ **SHIPPED 2026-07-31**, daemon `0.0.106` / cli
`0.0.109`, verified in the tarball, J-END 10/10. The responder now presents the relay assignment
itself, so the first message is genuinely witnessed rather than re-ordered. Reviewed twice; the
blocking finding was that the one line that IS the fix had no test — reverting it left the whole
suite green. That is closed and revert-tested.

**Carry forward to item 5:** three paths still end unwitnessed (relay down, terminal assignment
rejection, retry exhaustion), so **relay position is not total** and item 5's dedup rekey cannot
assume it is.

**Original entry follows.**

When a conversation's very first message is sent before the relay has finished registering the
session, the relay rejects it and never counts it. The daemon keeps the message anyway — losing
content is worse than mis-ordering it — so from then on the local record sits exactly one position
ahead of the relay's, for the life of that conversation.

That was written off as a bookkeeping wrinkle until we established what the certificate is actually
built from: **only the messages the relay witnessed.** The un-witnessed first message is, by
definition, the one that never got in. So the sealed receipt for an affected conversation is a
receipt over the conversation *minus its opening message* — and it is still issued, and still
verifies, and nothing anywhere reconciles the two records.

It fires 16 times out of 16 whenever the first message beats registration and the conversation
continues. It only happens when both agents are on the same machine, because local delivery is
instant while relay registration is a round trip to another region — which means it lands squarely
on the solo-multi-agent case that is both the daily use and the demo.

A trust product can survive clunky UX. It cannot survive a receipt that quietly isn't over the whole
conversation. The fix is producer-side and contained: make the first message wait for registration,
or resubmit once registration lands.

---

## 2. There is still no way to back up or recover your identity

**Designation: `DOD-CUSTODY-DAEMON-1`** *(carried unchanged from the last pass — still open)*

`backup` and `restore` exist as commands, but nothing behind them works — call either one and it
reports "not implemented." If your machine is lost, stolen, or dies, that agent and everything it
knows is gone permanently. No safety net exists today. The work is real: the logic has to move out
of the chat-tool layer and into the daemon as an actual capability.

Confirmed still open as of 2026-07-30 — M9B's closure note records that `cello_backup` and
`cello_restore` remain stubs, and that a round-trip proof is owed to whoever builds them.

---

## 3. The inbox says sessions are sealed when they are not

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

## 4. Logging out says the daemon stopped while it is still on the network

**Designation: `DOD-LOGOUT-EXIT-1`** — ❌ open, raised 2026-07-30

After `cello logout`, `cello status` reports `stopped` and every local handle is correctly released
— but the process is still alive, still holding an established connection to a directory node, and
still polling. Observed running 20+ seconds later and only exiting when killed by hand. Logout's own
help text promises it "waits until it has actually exited."

This matters beyond an orphaned process. A launch requirement is that a kill switch is in place, and
this is the kill switch silently not working: the visible state says off, the network behaviour says
on. An operator who has logged out reasonably believes nothing of theirs is reachable. It also hides
itself — because the handles *are* released, every local check agrees with the lie.

Worth noting this is the second appearance of a shape the last pass already celebrated as fixed: the
review of the double-daemon fix caught that the shutdown command was trusting the same broken logic.
The class came back through a different door.

---

## 5. A conversation can become permanently unsealable, silently

**Designation: `DOD-FRONTIER-STRAND-1`** — ❌ open, raised 2026-07-30, root cause corrected 2026-07-31

If two messages in a session happen to be byte-identical, the receiving side treats the second as a
redelivery of the first and refuses to record it. The sender has it; the receiver doesn't. From that
point the two sides permanently disagree about how many messages exist, so neither will co-sign a
close, and the session can never produce a receipt. The only exit is force-abandon, which forfeits
the notarization.

One live session sat in this state for a week before anyone noticed — nothing detects a mismatch
until someone attempts a close, and the refusal message points at the counterparty rather than
naming the disagreement.

The specific producer that caused the observed case (a duplicated away autoresponse) is already
fixed, so this is latent rather than actively bleeding — which is why it ranks below the items above
despite being severe. But the *check* is unchanged, it compares content across both parties'
messages, and two instances of the same model answering the same prompt make an identical reply far
likelier than the human baseline. It gets likelier precisely as same-model agent-to-agent traffic
grows, which is the wedge.

**Sequencing note:** the intended fix is to key duplicate detection on the relay-assigned position
instead of the content. That inherits a broken key until item 1 is fixed, because a drifted
conversation's two sides don't agree on position. Item 1 first, structurally — not just by priority.

---

## 6. Two windows on one agent silently steal each other's messages

**Designation:** [[2026-07-31_1043_two-sessions-one-agent-co-attendance]] §2 — **needs a DoD line
opened.** Only the detection half belongs at launch; the redesign is a separate milestone (M8D).

Run two Claude sessions against the same agent and a message arrives: one session gets it, the other
is told nothing arrived, and neither is told the other exists. The wake-up is broadcast to every
attached session but the message itself sits in a single queue that the first reader empties. The
loser's answer is word-for-word identical to a quiet counterparty, and the plain receive path writes
nothing to the log on either outcome, so the theft leaves no trace anywhere.

The full fix changes delivery semantics across several surfaces and earns its own milestone. **What
belongs at launch is the cheap half:** make "nothing arrived" and "another session took it"
different answers, carry the attendance count on attach and status, and log the receive on both
outcomes. That converts a silent, trust-destroying failure into a visible one with an obvious
workaround, which is the difference between ruin and forgive.

---

## 7. Installing the plugin does not give you a working CELLO

**Designation:** [[2026-07-30_1423_cello-claude-code-plugin-and-channels-allowlist]] — **needs a DoD
line opened.**

The plugin is the official install route. Installing it copies files and runs nothing: the MCP shim
arrives lazily, but the `cello` binary and the daemon do not. A new user installs, sees the tools,
calls one, and gets `daemon_not_running`. The `setup` skill is the only thing that closes that gap
today.

This is a first-impression item rather than a safety one, and it is deliberately unresolved — the
obvious fix (an install hook) would have a plugin install start a long-running process holding key
material and a network identity, which is a much bigger claim on a user's machine than a plugin
install normally makes. But it is the same class as item 8 below, which is already tracked, so it
should be tracked too rather than living only in a discussion log.

---

## 8. The Telegram sign-up messages give wrong or unclear instructions

**Designation: `D-ENVVAR`** (+ the rest of Phase 1 in `M8C-ONBOARDING-IMPROVEMENTS`) *(carried
unchanged — still open)*

The registration bot tells a new user to set something that doesn't exist, among a few other unclear
or inconsistent messages along that flow. A literal first-time follower gets stuck with no next
step. Not a security issue — a bad first impression. Fixing it is tedious rather than hard: several
message rewrites plus the tests that check the exact wording, in one repo.

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

**Designation: `DOD-TGDOOR-1`** — 🟡 *(carried unchanged — still the only Tier-3 unit that can't be
smoke-tested without a real bot token)*

The doorbell-to-Telegram feature is built and passes its test suite, but has never been watched
working end-to-end on an actual phone. Low risk either way; just unverified. Flips to done on a live
proof, nothing else.

---

## 11. Running the same agent from two devices at once is mostly unbuilt

**Designation: `DOD-PRIMARY-1`** (+ `DOD-POLICY-1`, `DOD-PORTAB-1`) — deliberately out of scope

The design exists and the directory-side security core is built and tested, but the enforcement that
stops two devices fighting over control isn't wired in, the handshake between your two devices
doesn't exist, syncing between them doesn't exist, and no failover test has been run. Still
deliberately out of scope.

**Correction to the previous pass**, which closed this item with "one agent on one device works
completely fine without any of it." That is not true, and item 6 is why: two *sessions* on one
device, on one daemon, silently lose messages. That is a different failure from this one and is not
covered by anything here.

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

# Closed since the last pass

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
  2026-07-29 into M9B's config surface. What remains is a product decision about merging two
  config surfaces, not a missing mechanism.

---

# On the old "already solid" list

The previous pass ended with a list of eight things marked "confirmed working, no action needed."
Five days of deliberate defect-hunting found real bugs in four of them:

- **the read-before-reply guard** — the guarantee holds for a single session, but two sessions on
  one agent do not gate each other, and the scenario had never been run. Still open (item 6).
- **auto-away-replies** — fired before the caller had said anything, and fired a second time on a
  closing message, injecting a duplicate into the sealed transcript. Fixed 2026-07-23/24.
- **session-request expiry** — requests whose session had already closed stayed in the pending queue
  forever. Fixed 2026-07-22.
- **catching up on what you missed** — a sealed session's final message could show as unread with no
  way to clear it. Fixed.

That list was a snapshot of confidence rather than a record of verification, and it did not survive
contact with someone looking. **It has not been reinstated in this pass, and shouldn't be** — a
claim that something needs no action is worth exactly the enforcer behind it, and these had none.

---

## 12. A failed endorsement submission is not retried

If the directory node you send an endorsement to is down, the submission fails and you run the
command again. There is no automatic failover to another node, even though the consortium has three.

**Why it is here and not fixed:** it is a papercut, not a loss — nothing is destroyed and the error
names the cause. Andre triaged it as ship-without on 2026-07-31. It is `DOD-END-SUBMIT-1`'s one
remaining handed-forward AC and one of `DOD-END-SURFACE-1`'s nine clauses.

---

## 13. The trust-signal floor is built and deliberately switched off

`DOD-FLOOR-1` is the "minimum bar to talk to me" — a counterparty must present N signals, or a
particular type, before a session is accepted. It is implemented and unit-tested, and NOTHING CALLS
IT. That is correct for launch: switching it on with any default would start refusing counterparties
who have no signals yet, which is everybody on day one.

**This is an M10 line, not M10B.** It sat on the M10B list because M10B produces the `same_operator`
flag the floor's counting rule consumes (`DOD-END-COUNT-1`) — M10B produced it correctly and proved
it live; the consumer lives here. Recorded 2026-07-31 so it stops being re-discovered as endorsement
debt.

**When it matters:** the first time an operator wants to be selective about who reaches them. Not
before there are signals worth demanding.

---

## 14. "Online" does not mean reachable

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

## Related Documents

- [[M8C-DEFINITION-OF-DONE]] — full technical detail and status for every designation above
- [[M8C-ONBOARDING-IMPROVEMENTS]] — the Telegram/CLI onboarding checklist (item 8)
- [[2026-07-31_1043_two-sessions-one-agent-co-attendance]] — items 1, 5 and 6; the receipt-integrity
  cluster and the co-attendance decision, with the build order at the top
- [[2026-07-30_1423_cello-claude-code-plugin-and-channels-allowlist]] — items 7 and 9
- [[protocol-map]] — where these fit relative to the overall milestone sequence
