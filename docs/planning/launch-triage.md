---
name: Launch Triage
type: triage
date: 2026-07-31
topics: [launch, security, backup, receipt-integrity, kill-switch, daemon-lifecycle, telegram, install, triage, sealed-sessions, wake, relay, observability]
status: open
description: >
  Open items only — not implemented, or implemented but not yet proven live. Ranked by what
  actually goes wrong if left alone, not by build status. Closed items leave entirely; the record
  of what shipped lives in the milestone DoD docs and in `git log` on this file, not here.
---

# Launch Triage

**Open items only — not implemented, or implemented but not yet proven live.** Closed work does not
live here: milestone DoD docs carry the definition-of-done record, git history carries the commits.
This file exists to decide what to do next, not to document what already happened.

**The test:** at launch, if this is not done, will it *fundamentally ruin* a prospective customer —
or is it something they could *forgive*? Ruin = they can't get the core value, or they lose trust.
Most things are forgivable.

# Open — ranked (order decided by Andre, 2026-08-04)

> ## ⚠️ A MARKER ON THIS LIST TRACKS WHOEVER LAST EDITED IT — NOT THE CODE
>
> **Before trusting any ❌, unpack the published artifact or read the running instance.** Items have
> sat marked closed while still broken, and marked open for days after shipping — including one that
> held the top slot on this list for three days while already live. Never trust the marker alone.
>
> How to check, in one line each:
> - **Client fix** → `npm view @cello-protocol/<pkg> dist-tags` to see what's promoted, then
>   `npm pack @cello-protocol/<pkg>@latest` and grep `dist/` to confirm the fix is actually in it.
>   Not the branch, not CI status.
> - **Directory/relay fix** → `gcloud compute instances describe …` and read the image tag off the
>   RUNNING instance. Not `terraform.tfvars`, not `GCP-STATE.md`.
> - **Anything claiming convergence or replication** → query the databases and compare. Row counts and
>   digests can match while the answer a consumer gets differs; ask the view the consumer reads.
>
> **Three states, recorded separately, because conflating them has cost days:**
> **committed** → **published to npm** → **promoted to `latest`** (Andre runs the promotion); and for
> the relay/directory: **committed** → **image built** → **rolled to the fleet**.

### How to actually ship something off this list — for an agent arriving cold

**The code lives in TWO repos and most of this list is the second one.**

| What | Where |
|---|---|
| Directory node, relay, infrastructure, e2e spine tests, this doc | `trustless-cello` |
| Daemon, CLI, MCP shim, crypto, transport — i.e. `DOD-*` client fixes | `cello-client` (separate checkout) |

**To ship a client fix (the usual case):**

1. **Load the `/cello-publish` skill first — every time, for THAT publish.** It is enforced by a hook
   and it is authoritative; the prose in `CLAUDE.md` is reference only. Publishing from memory has
   burned npm versions permanently.
2. Version-cascade, tag, push. CI publishes to the `beta` dist-tag.
3. **Verify against the TARBALL, not CI status** — `npm pack` the package and grep its `dist/`. A
   green build is not evidence the change shipped.
4. **Andre runs the `latest` promotion. Never run it yourself.** Prepare all seven `npm dist-tag add`
   commands and hand them over — all seven, at their current versions, not the subset you changed.

**To ship a relay or directory change:** `gcloud builds submit` at a revision, then `terraform apply`
**with `-target`** for ONE node, wait for it to come up and verify, then the next. An untargeted
apply replaces every node at once. Read `infra/CLAUDE.md` before touching any of it, and update
`infra/GCP-STATE.md` immediately after — not batched.

**Before claiming anything on this list is done:** a green test suite is not evidence. Three separate
defects this week passed every test and failed on live traffic — a document leaf mislabelled on the
wire, a fix whose argument was dropped by the composition root, and a session that could not be
sealed. Where a claim can be checked against a live daemon or the fleet logs, check it.

**Both "run first" diagnoses were resolved 2026-08-04**, same day: the FROST debug-logging report
was **overstated** (ruled out — see [[launch-triage-archive]]), and `DOD-ACCOUNTS-CHAIN-1` was **confirmed as a
real tamper-evidence gap** — it is now **item 1** below.

## 1. Every real registration writes the human-agent binding outside the hash chain

**Designation: `DOD-ACCOUNTS-CHAIN-1`** — 🟢 **THE DEFECT IS FIXED, DEPLOYED, AND THE DATA IS CLEAN.
What is still open is ONE small thing: nothing surfaces `verifyChain` where anyone would see it.**

**Narrowed 2026-08-10, because this line kept reading as though the whole item were outstanding.**
Three of its four parts are done: the writer was fixed and reviewed (`493609dc` + `1aa25164`), it is
deployed on all three nodes, and the data was re-measured today — **11 rows per node, `verifyChain`
VALID on all three**, with the checker proven able to fail before the green was believed. **Do not
repair any row; see the block below.**

**The remainder, and it is the whole of what is left:** `verifyChain("user_accounts")` is exposed on
no health surface, so "is the tamper-evidence actually intact?" can only be answered by hand — IAP
SSH to each node, credentials out of Secret Manager, and a recomputation. That is why a stale "it is
broken" note survived four days here and nearly caused a destructive repair. **Put it on the
ops-agent health output**, or the next person is in the same position.

Two spin-offs stay recorded, neither blocking: `DOD-ACCOUNTS-EMAIL-CHAIN-1` (the email half is stored
but not chained) and a test-isolation defect (several suites `DELETE` from this append-only chained
table, making the `CELLO_ENV=local` suite non-deterministic).

Full root-cause trace and the near-miss where a stale ❌ almost caused a destructive repair:
[[M8C-DEFINITION-OF-DONE]] § `DOD-ACCOUNTS-CHAIN-1`.

---

## 2. A mismatch that makes a conversation unsealable leaves no durable trace

**Designation: `DOD-FRONTIER-MISMATCH-DURABLE-1`** (M8D, 🅿️ parked) — **re-scoped 2026-08-03.** The
original defect under this item (`DOD-FRONTIER-STRAND-1`) is fixed; see [[launch-triage-archive]].
What is left is the detection half.

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

## 3. A daemon shutdown rings the doorbell like an incoming message

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

## 4. There is still no way to back up or recover your identity

**Designation: `DOD-CUSTODY-DAEMON-1`** — ❌ open; demoted from #1 on 2026-08-04 and scoped the same day.

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

## 5. Two sides can hold incompatible beliefs about which terminal path a session is on

**Designation: `DOD-TERMINAL-STATE-DIVERGENCE-1`** — 🟢 **THE CURE IS BUILT AND PUBLISHED,
2026-08-09.** A close that fails now ASKS the directory whether the seal already happened, and
returns the receipt if it does (`daemon 0.0.151`, on `latest` since 2026-08-09). Distinct from
`DOD-FRONTIER-MISMATCH-DURABLE-1`, which covers *leaf* divergence — here the leaves agree and the
statuses do not.

**What's still owed — the whole of what's open.** Nothing asks on the daemon's own initiative: the
pull only fires when an operator hits the stuck state and tries to close or read a receipt, so a
session stranded and never touched again stays stranded — there is no startup sweep. Also,
**sessions sealed before the V58 migration (2026-08-09) can never be served by the pull** — their
`leaf_count`/`legibility` were never recorded, so no verifiable certificate can be reconstructed for
them. This fix prevents future divergence; it does not repair past divergence.

Full root-cause trace, rejected designs and the build: [[M8C-DEFINITION-OF-DONE]] §
`DOD-TERMINAL-STATE-DIVERGENCE-1` (M8C-PROCEDURE §5d, `DOD-INV-PUSHPULL`).

## 6. The daemon logs every connection opening and never one closing

**Designation: `DOD-IPC-DISCONNECT-VISIBLE-1`** — ❌ **OPEN, and deliberately filed as a SMALL one.**
Unranked. **Proposed slot: low — nobody is ruined by this. It is here because it taxes every
investigation that touches attendance, sessions or doorbells, and the tax is invisible until you are
already lost.**

**What it costs.** Not a customer — an operator, and whoever is debugging on their behalf. The
question "is that connection still alive?" cannot be answered from the log at all, because
`daemon.ipc.connected` is emitted on every open and nothing whatsoever is emitted on close. So a
live client and a dead one that was never cleaned up look identical in the record.

**Measured 2026-08-08.** `cello agents` reported `attendance: 3` on an agent Andre believed one
session was using. Answering "are those three real?" took: reading the connect events, correlating
them against `ps` twice, discovering Hermes runs TWO bridges (`gateway` and `serve`, each spawning
its own `cello-mcp` watchdog + shim), and finally killing the gateway to watch the number move. It
dropped 3 → 1 immediately, so the count was correct all along **and the disconnect cleanup works
fine** — none of which could be established from the log.

Two wrong theories were entertained along the way purely because the log could not rule them out: a
miscount in `countAttendance`, and connections outliving their processes.

**The fix is one log line** in the `ipcServer.onDisconnect` handler in `daemon.ts` — `connectionId`,
`clientType`, and the agent it was attending, if any. That last field is what makes it useful:
attendance dropping is currently a silent event, so an agent losing its last attendee — which
changes whether away-messages fire and who receives doorbells — leaves no trace.

**Also worth doing while in there**, same investigation: `cello agents` reports `selected` from the
CALLING connection, so a client asking about its own state through a fresh connection always sees
`false`. Both Andre and the Hermes agent read that as "nothing is selected" during this
investigation, on an agent that had three attendees. The field is correct and the name invites the
misreading; `selected_by_this_connection`, or a note in the payload, would stop it.

**Not a defect in co-attendance itself.** Several sessions attending one agent is deliberate and
permanent (spec §3). What is missing is only the record of it changing.


## 7. A session was silently bound to an agent it never selected — and it was someone else's identity

**Designation: `DOD-AGENT-SELECTION-UNWARRANTED-1`** — ❌ **OPEN, cause NOT established.** Unranked.
**Proposed slot: high, on the security argument below — but it needs the diagnosis before it can be
ranked honestly, because the fix depends on which of two paths did it.**

**What happened, measured 2026-08-08.** A session released its agent with
`cello_stop_using_agent` (`released: CELLO_Coder_1`, confirmed, attendance dropped to 0). The daemon
was then restarted. On reconnect that same session was **acting as `Miss_Chelly`** — a different
agent, belonging to a different session — with no `cello_use_agent` call from it. The daemon
announced it as `agent_current_changed toAgent="Miss_Chelly"` and the connection's own
`cello_agents` reported `selected: true` for that agent.

**Why this is not a bookkeeping bug.** An agent is a cryptographic identity. Anything the session
had sent in that window would have been signed with `Miss_Chelly`'s key and been indistinguishable,
to the counterparty, from the session that legitimately holds it. A release that silently becomes
"you are now someone else" is worse than a release that fails loudly: the operator has been told the
opposite of what is true.

Two properties are missing, and they are separable:
1. **A release must survive a reconnect.** After `cello_stop_using_agent`, a reconnect must attend
   NOTHING until something asks again. Today a daemon restart defeats it.
2. **A connection must never be auto-attached to an agent it did not select.** Resolving to "the
   only agent online" is defensible for a CLI invocation that needs a subject; silently binding a
   live MCP session to an identity it never asked for is not. If a fallback is wanted at all it must
   be explicit in the response, not announced as an accomplished fact.

**The two candidate causes, neither confirmed:**
- **The shim's reconnect replay.** `ipc-proxy.ts` invariant 1 replays `cello_use_agent` after a
  reconnect so routing survives a daemon bounce. If the release does not clear the proxy's stored
  agent — or if it stores one it should not — the replay reinstates a selection the operator ended.
- **A daemon-side fallback.** `cello_stop_using_agent`'s own guidance says that after a release,
  agent-scoped calls without an explicit agent "still resolve to it" when it is the only agent
  online. Something in that family may be binding the connection rather than merely resolving a
  single call.

The persisted `~/.cello/current-agent` file is NOT the cause — it read `CELLO_Coder_1` throughout,
while the connection was bound to `Miss_Chelly`.

**SECOND REPRODUCTION, 2026-08-09, and it failed the OTHER way.** Same connection class, different
trigger: after an `/mcp` reconnect (no daemon restart), a selection that HAD been made was silently
**dropped** — `cello_use_agent Miss_Chelly` had returned `attendance: 1`, and after the reconnect the
connection was attending nothing, with both agents reading `selected: false`.

So the reconnect replay is unreliable in both directions: it reinstates a selection that was ended,
and it discards one that was made. That is one defect with two faces, not two defects, and it
strengthens the diagnosis: the fault is in what the proxy REMEMBERS across a reconnect, not in the
daemon's fallback — a daemon-side fallback could bind a connection but could not un-bind one.

Independently reproduced by the counterparty session on a different connection the same day, so it
is not specific to one client or one machine.

**The dropped direction is an annoyance** — tools answer `no_current_agent` and the operator
notices. **The bound direction is the security case**, unchanged from above: anything sent in that
window is signed by an identity the session never chose, and is indistinguishable to the
counterparty from the real operator of that agent.

**Why it could not be diagnosed from the log, which is its own finding.** The daemon emits
`agent.current.switched` with **no agent name and no reason** — so the record shows that a
connection changed identity and not what it changed to, or why. Two such events fired at 18:22:51,
one second after the reconnect, and neither can be attributed. Fixing that field is a precondition
for diagnosing this, and it is the same blind spot as `DOD-IPC-DISCONNECT-VISIBLE-1` one layer up.

**First diagnostic step:** add the agent name and the trigger (`explicit` | `replay` | `fallback`)
to `agent.current.switched`, then reproduce with a daemon restart after a release. That distinguishes
the two candidates in one run.


## 8. Directory nodes cannot see each other's heartbeats — each believes it is the only one alive

**Designation: `DOD-HEARTBEAT-REPLICATION-1`** — ❌ **OPEN.** Unranked. Previously recorded only as a
footnote on `DOD-RELAY-DIRECTORY-RECONNECT-1` (closed); filed here because it is a live fault in its
own right and was nearly fixed as if it were the cause of something else.

**What is wrong.** `directory_nodes` rows replicate, but `last_heartbeat_at` does not — it is
mutable, and Tier A carries immutable columns only. So every node reads the other two as
never-heartbeated and counts `availableNodes: 1` against `requiredThreshold: 2`. Federation
checkpoints have **never once succeeded** on these containers.

**What it does NOT cause, established by measurement 2026-08-08:** the sealing outage. The degraded
count was already true *during* the seals that worked — `federation.checkpoint.skipped` logged
`availableNodes 1` at 06:47, 06:52, 06:55 and 06:57 UTC, bracketing and interleaving successful
notarizations, one of them one second after a seal completed. A gate cannot be a gate while things
pass through it. Recorded because this was believed to be the cause for several hours and a fix was
about to be built on it.

**Why it still matters at launch.** Checkpointing is how the consortium agrees on shared state.
Nothing that depends on a quorum view can be trusted while every node believes it is alone, and the
failure is invisible — nodes do not report that they cannot see each other.

**⚠️ RE-SCOPED 2026-08-09 — NOT launch-blocking, and the reason should stop this being built in a
hurry.** Both surfaces a user can actually see already ignore the heartbeat, deliberately and since
2026-07-05: discovery reports an agent online on the replicated presence flag alone (`staleHeartbeat`
is recorded for observability and does not change the wire answer), and the portal's agent list had
the same conjunct dropped after it showed a user's working agent as OFFLINE. So a customer sees
nothing from this. The only live consumer is the federation checkpoint, and that machinery is
**parked** (M12-P5) — its tables are deliberately excluded from replication.

What the fix costs is also worth stating before someone starts: `last_heartbeat_at` is mutable, so it
cannot join the Tier-A immutable set. Making it replicate means giving `directory_nodes` a Tier-B
mutable merge with a version column — a new merge table, not a one-line spec edit.

**One stale fact corrected the same day:** a code comment blamed a "BIGSERIAL `id` collision" for the
heartbeat not replicating. That is wrong — `id` is simply not in the spec either. The cause is only
that `last_heartbeat_at` is mutable and Tier A carries immutable columns. Left uncorrected it would
have sent whoever picks this up at the wrong repair.

## 9. A document's agreed content profile is signed into its identity and enforced by nothing

**Designation: `DOD-DOC-PROFILE-1`** (M14) — ⏳ **DELIBERATE SPLIT, recorded here so the gap is
visible from the launch list rather than only from the milestone doc.**

Two parties agree a content profile at the handshake. It is bound into the document id and is
immutable for the document's life — that half works and had to ship first, because rebinding it is
only free before anyone owns a document. **No verb consults it.** An operator who deliberately chose
the restrictive profile gets exactly the protection of one who did not think about it.

Not a break — inbound updates are still screened by the general rules — but the setting is currently
a promise the system does not keep, and it is labelled inert rather than done in the milestone.

**`DOD-DOC-REBUTTAL-1` is the paired deferral** (Andre, 2026-08-05, slipped to the Tier 2 wave,
[[COLLAB-TIER2-DEFINITION-OF-DONE]] — the M14B name passed to multiplayer 2026-08-11): a peer's
refusal cannot be answered, so a genuinely multilingual document fails closed and is resolved by
hand. Identical security, worse ergonomics. Listed for completeness, not as owed work.


## 10. Same-operator standing: two layers exist, and one input can be absent

**Designation: `DOD-SELF-STANDING-NULL-LINKAGE-1`** — ⚠️ **OPEN QUESTION, NOT a confirmed defect.**
Raised 2026-08-09 from an endorsement exercise. Filed because it is a security property and the
answer needs someone who knows registration, not because it is known to be broken.

**First, the part that is NOT a problem, because it was nearly filed as one.** An endorsement between
two of one operator's agents was refused live. The daemon's refusal names *"both your agents on this
machine"*, which looks like it only catches a shared laptop — and the obvious conclusion, that a
second agent on another host would sail through, is WRONG. The daemon check is a deliberate fast
local pre-check; its own comment says the portal *"remains the real enforcer… only it can see account
linkage, and only it can catch two agents under one account on different machines."* And the portal
does: it flags same-operator on **account match OR verified phone-stub match**, the second
specifically to catch the operator who opens a second account. The flag is pinned to the submission
before minting so a re-mint cannot flip it into two notarized endorsements. Two layers, the outer one
decisive.

**The actual question.** The portal computes the flag as:

> issuer resolved AND subject resolved AND ( accountId matches, OR phoneStubHash matches )

Both inputs are nullable — the directory returns `account_id` and `phone_stub_hash` as
possibly-absent, and the code handles null explicitly. So the flag is **false** in two situations
that are not "these are different people":

1. **Both agents have no account and no verified phone.** Nothing links them, so nothing flags them.
2. **The ISSUER does not resolve in the directory at all.** `issuerAgent !== null` is a conjunct, so
   an unresolvable issuer makes the whole expression false — *not same operator* — rather than
   refusing. That is a fail-open on an unknown issuer rather than a fail-closed.

**What I cannot prove from code alone, and what decides it:** whether either state is reachable by an
agent that can actually submit. If submission requires portal authentication, the issuer necessarily
has an account and case 2 is unreachable; case 1 then needs both agents account-bound but
phone-unverified, which may or may not be possible at registration. **Someone who knows the
registration and submission-auth path should answer this rather than someone reading the trust
module.** Nothing here has been demonstrated against a running system.

**✅ ANSWERED 2026-08-10 — case 2 IS reachable, and the answer moved to its own item.** Submission
requires no portal authentication and no registration of any kind: `submission_write` has no
`#requireRegistration` gate, so proving possession of any Ed25519 key is enough. So an unresolvable
issuer is not a theoretical branch — it is one `openssl`-grade key away, and it evaluates to *not the
same operator*. **The fix and the full trace are `DOD-END-ISSUER-REGISTERED-1` (closed); Andre decided
the shape the same day: both parties must resolve or the answer has no teeth.** Case 1 (both agents
account-bound but phone-unverified) is NOT answered and stays open here — it is a narrower hole than
case 2 and is not addressed by that fix, because two registered agents both resolve.

**Why it is worth an answer even if it turns out closed.** "You cannot manufacture standing out of
your own machines" is an argument we make in writing (`[[shared-documents-objection-rebuttal]]`
argument 3) and it is the kind of claim a technical evaluator will probe directly. A conjunct that
evaluates to *not-same-operator* when an input is missing is the shape worth being certain about.

## 11. Signup throttling counts by company, so unrelated people block each other

**Designation: `DOD-OTP-RATELIMIT-KEY-1`** — ❌ **OPEN, filed 2026-08-10** while tracing where the
email domain is used at all. Small, and entirely in one file.

**What a customer hits.** The sixth person from a given email domain to request a verification code
in any hour is refused — *"Too many verification code requests. Please wait up to an hour"* — even
though those six people have nothing to do with each other. The limit is **5 per domain per hour**,
and consumer signups cluster on a handful of domains, so at launch `gmail.com` users would be
throttling each other while a real abuser simply uses more than one domain.

**And it barely limits anyone anyway.** The counter is an in-memory `Map` in the registration bot,
which runs as a single instance — so it **resets on every restart and every deploy**. It was wiped
by the ops-agent deploy on 2026-08-09.

**Why it is keyed this way, which is the interesting part.** It needed something to throttle on and
did not want to hold the address, so it took the domain as the safer-looking half. The trade-off
fails in both directions: too coarse to protect, and too coarse to be safe. Same root shape as the
`account_email_stubs` fork above — a domain standing in for a person — but a different blast radius.

**The fix is smaller than the problem.** One line below the domain extraction the code already
computes the address fingerprint (`hashEmail(email)`) and stores it. Keying the limiter on that
throttles the actual person rather than their employer, holds no new data and leaks nothing the
system does not already keep. Making it durable — a small table in the bot's own database instead of
a `Map` — is what would make it survive a deploy and actually bite.

**Not in the directory, and correctly so:** this lives in the registration bot, which is the signup
backend. Nothing about the fix touches the directory or the protocol.

---

## 12. Interrupted-session sealing is shipped and has never been proven

**Designation: `DOD-TERMINAL-STATE-DIVERGENCE-1`** (verification half) — ⚠️ **SHIPPED, UNPROVEN.**
Unranked. Small, but filed because "shipped" reads as "works" on a list like this one, and here it
does not.

`4759b4b` (daemon 0.0.147) fixed the defect where an interrupted close agreed a signed record with
the counterparty and **never asked anyone to notarize it** — the session reached a mutually signed
state that nobody was ever asked to stamp, and sat there until the relay swept it.

**The fix is deployed and the code path demonstrably runs**: on a real attempt the daemon logged
`session.interrupted.responder.acked` followed by `session.interrupted.seal.leaf.submit_failed` —
that is the request being made, where the previous build logged nothing at all because nothing asked.

**But no interrupted session has ever been sealed with it.** Every stranded session available at the
time predated the 2026-08-08 relay restart, so the relay had already dropped them and answered
`session_not_found`. They were force-closed after confirming no certificate existed on any node.

**What is unproven, precisely:** that an interrupted session whose relay session still EXISTS can be
notarized end to end and produce a receipt. That case has never run.

> ### 🔴 ANSWERED 2026-08-17 — it could never have run, and now it can
> `4759b4b` made the interrupted close SUBMIT a seal leaf. **One leaf can never notarize anything.**
> The relay stamps a chain only once BOTH parties have posted a SEAL ctrl leaf, and the responder
> never posts one — `inbound-seal-request.ts` persists its commitment, acks, and stops. So the
> notarization this item has been waiting to observe was structurally impossible, and no live test
> could ever have produced it.
>
> Worse, the escalation that WOULD have finished the job — the unilateral seal, which asks the
> directory to notarize with the counterparty absent — lived in the close handler's `active` branch,
> below an `interrupted` branch that returns from every exit. **Unreachable.** So an interrupted
> session could not obtain a receipt even when a human closed it by hand, which is the plain-language
> version of *"most of the time we can't even close them"*.
>
> **And there was a second layer, found by the review of the fix.** Even once the escalation ran and
> the directory notarized, the session's ROW never changed: every seal-completion path ends with
> `destroySessionNode(..., "sealed")`, which returns early when the session has no in-memory node
> and writes the status 26 lines below that guard. An interrupted session has no node by
> construction. So the receipt was stored against a row that still said `interrupted` — `cello_sessions`
> showed it stuck, the close verb still refused it by name, and the automatic resolver re-ran the
> whole ceremony on the next boot and then advised force-abandoning a session that already held a
> valid receipt. Fixed in `6e2a9fa`.
>
> **This is why the proof this item asks for would still have looked like a failure even after the
> first fix.** Whoever runs it should assert on the session's STATUS, not only on the certificate.
>
> **🔴 WHY THE PROOF HAS NOT BEEN RUN, and it is not for lack of trying.** It needs two daemons with
> REGISTERED agents, and registration requires a `preAuthToken` *"issued by the CELLO Operations
> Agent (Telegram)"* — a human step only Andre can take. The alternative, running it against his own
> five live agents, would seal his open sessions as a side effect of the test. **So this proof is
> blocked on Andre issuing two pre-auth tokens for throwaway agents**, and that is the whole
> blocker: the code is written, reviewed twice and gated green.
>
> Fixed in `DOD-M12B-INTERRUPTED-ESCALATE-1` (cello-client `af8d4bb`): the escalation is a shared
> helper both branches call. It fires when the two sides agreed OR when the counterparty never
> answered, and **never after a refusal** — a rejection means the trees disagree, and notarizing over
> a stated objection is the one thing a trust layer must not do. Not yet published; the live proof
> this item asks for is still owed and is now actually possible.
>
> Same investigation: **114 of 118 interrupted sessions came from our own shutdown sweep and zero
> from any transport event** — see
> [[2026-08-17_2036_interrupted-sessions-why-they-cannot-resume]].

**How to prove it:** open a session, exchange a few messages, restart the daemon to interrupt it,
then close it — all inside the relay's 24-hour retention. Minutes of work, and it either produces a
receipt or a named failure.


## 13. You cannot retract a trust signal — and the tool says you did

**Designation: `DOD-SIGNAL-REVOKE-BROKEN-1`** — ✅ **FIXED AND PROVEN LIVE 2026-08-11. Retraction
works, on all three nodes, with nobody driving it.**

> ```
> gcp-use1   7fa402bc7d04 | revoked | revocation_rows 1
> gcp-usc1   7fa402bc7d04 | revoked | revocation_rows 1
> gcp-euw1   7fa402bc7d04 | revoked | revocation_rows 1
> ```
> A real `github_id`, revoked from the daemon at 12:57, drained by the **scheduler** at 12:57:02,
> revoked by the portal at 12:57:03, replicated to every node. No hand on the trigger.
>
> **⚠️ The 2026-08-10 version of this entry claimed the same thing and was wrong.** That proof
> (`db4e32c09cf7`) reached all three nodes only because the drain was POSTed by hand. Nothing in the
> system called it — the queue had no consumer at all, so an operator doing exactly the same thing
> would have watched `queued` sit there forever. The defect was one level up from the feature: the
> definition of done said "revoke a signal and show all three databases reading revoked", every verb
> in which belongs to the person testing, so supplying the missing machinery by hand PASSED it. A
> clause has to be an action the OPERATOR takes unattended, or it can be satisfied by the tester
> standing in for the part that does not exist. Fixed by `cello-portal-ingress-drain`
> (Cloud Scheduler, every minute) — see `infra/GCP-STATE.md`.
>
> **This was never revocation-specific.** Endorsements, refusals and withdrawals ride the same queue
> and were failing identically; they just read as latency. Revocation was the first feature whose
> whole value sits on the far side of the drain.
>
> **What an operator gets.** Retracting a signal now actually retracts it, everywhere, and the answer
> is honest at every step: `queued` while it is queued, never `revoked` before it is. Your local copy
> is KEPT until the directory confirms, so a failure leaves you able to retry rather than destroying
> the evidence — which is what the old verb did on every single attempt, while reporting success.
>
> And the things that must NOT be retractable are refused, server-side: your track record, verified
> email and phone. Passkey and authenticator signals are removed by turning the factor off in the
> portal, which revokes them as a consequence.
>
> Full record, including the four failed attempts and why the review could not have caught them:
> [[M10B-DEFINITION-OF-DONE]] § `DOD-END-REVOKE-3`. Found by running it against the live fleet.

> ### What shipped 2026-08-10, and what did not
>
> **Shipped, live:** removing your last passkey now revokes the signal that claims you have one
> (portal `portal-1cb90e7`). Before, that route touched the signal not at all, so removing your only
> passkey left a live signal telling counterparties you still had a factor you no longer had — a
> false claim about a security feature, reachable by simply removing a passkey. TOTP already did this
> correctly; the two now share one implementation.
>
> **Shipped, published (daemon `0.0.157`, pending Andre's promotion):** revoke now refuses signals
> that are not the operator's to destroy, BEFORE signing and BEFORE the unconditional local delete.
> Three categories, decided with Andre: **mandatory** (`track_record`, `email`, `phone`) — a track
> record its subject can delete is worth nothing to anyone, and the other two assert only THAT a
> channel was verified, never the address or number; **security-derived** (`webauthn`, `totp`) —
> mirrors of a portal factor, removed by turning the factor off, never revoked directly, because
> revoking one directly leaves the factor on with no signal and NO WAY to regenerate it; and
> **discretionary** — everything else, the default, so a new signal type never needs a client release.
>
> **NOT fixed — the verb is still broken for the signals that ARE revocable.** All four original
> defects stand: it posts to the health port instead of the internal API, signs as the agent when the
> route needs an enrolled submitter, contacts one node under a comment claiming all three, and returns
> `ok: true` while hard-deleting the local copy regardless. So revoking your GitHub link still fails
> and still lies about it. What changed is only that it can no longer do that to your track record.
>
> **BUILT AND PUBLISHED (daemon `0.0.158`) — refuse-after-accept**, the decision Andre made for
> removing an endorsement you already accepted. Refusal previously worked only while an attestation
> was pending, so once you said yes you were stuck with it being presented. It is refusal rather than
> revocation on purpose: the decision is RECORDED rather than erased, and a refused signal is already
> inert everywhere it is checked.
>
> **The scope was the dangerous half.** A refused signal is inert, so widening refusal without a
> filter would have handed every operator a back door to suppressing their own MANDATORY signals —
> refuse your `track_record` and it stops being presented, achieving by consent exactly what
> revocation is forbidden from doing. Scoped to peer-issued attestations only, filtered on ISSUER and
> deliberately NOT on type: a hostile peer can issue a signal it calls `track_record`, and refusing a
> stranger's claim about you is precisely what the verb is for. Revert-tested — dropping that one
> clause fails two of the eight tests.
>
> **Enforcement note.** The client guard is UX and says so in its own header — the operator owns that
> process. The real enforcement is the portal for mandatory types (server-side, and the only party
> that knows a signal is a track record rather than a GitHub link, since directory `type` is
> deliberately opaque per `DOD-INV-ZERO-BUMP`) and the directory for attestations, where
> `signal_records_effective` already makes a non-issuer's tombstone inert. Unranked. **Proposed slot: high.** This is the retraction verb, and it has never worked.

**What happens to you.** You revoke a trust signal. The tool answers `ok: true` and tells you the
signal is gone. Your local copy IS deleted. **The directory never receives the revocation**, so every
node keeps the signal and keeps serving it to counterparties — and you no longer hold a copy to retry
with. The one operation whose entire purpose is taking something back does nothing, reports success,
and destroys your ability to try again.

**Measured, not inferred.** Revoked `3a6512df…` (an inert, twice-superseded track record) from a live
agent. Before: `superseded` on all three nodes, `signal_revocations` empty everywhere. After: **identical
on all three — still `superseded`, still zero revocation rows** — and the signal gone from the local
wallet. The tool's own response carried the failure and returned success anyway:
`{"ok":true, "removed_locally":true, "directory_results":[{"ok":false,"detail":"not found"}]}`.

**Four defects in one handler** (`core/daemon/src/daemon.ts`, the `cello_trust_signals_revoke` handler):

1. **Wrong port.** It POSTs `/internal/signal/revoke` to the directory's **health** port 9090. The
   route lives on the internal API server, port **8081**. The 404 is what "not found" is.
2. **Wrong identity.** The route's outer check requires an enrolled `submitter`; the daemon signs as
   the AGENT. `authorized_issuers` holds one row and it is the portal's KMS key. The intended path is
   agent → portal → directory, with the agent's authority carried INSIDE the body as
   `revoker_pubkey` + `revoker_signature` (V53). The daemon sends neither.
3. **One node, not three.** `const directoryUrls = [directoryUrl]` sits under a comment that says
   "POST to all directory nodes … all reachable nodes get the tombstone."
4. **`ok: true` unconditionally, and the local delete is unconditional too** — the code comment states
   it: *"Always hard-delete locally regardless of directory result."* The directory results are
   attached to the response and never consulted.

**Why it stayed hidden:** nothing else exercises the path, and the response looks like success. It is
the same shape as every other defect found today — a green answer over a failed operation.

**This is also why the replication half could never be proven.** `signal_revocations` is empty on all
three nodes because no revocation has ever been written by anyone. Five of the Tier-A column
dispositions (`signal_records.is_tombstone`, `.status`, `.revoked_at`, `.revoker_pubkey`,
`.revoker_signature`) rest on the claim that the FACT replicates via `signal_revocations` and the
effective view unions it. That mechanism is correct in code and **has never carried a single row.**
It cannot be proven until this is fixed.

**The fix needs a decision, because it is a design question, not a bug fix:** route revocation
through the portal exactly as submission is routed (the portal is the enrolled submitter and can carry
the agent's inner authorization), or enrol agents to revoke their own signals directly at the
directory. The first matches the existing chokepoint design; the second is fewer hops but widens who
may write to the directory. **Andre's call.** Everything else — the port, the fan-out, and the false
`ok: true` — is unambiguous and should be fixed whichever way that goes.

**Do not "fix" this by making the local delete conditional alone.** The operator must be told the
retraction failed, and the local copy must survive so a retry is possible.


## 14. A directory node goes deaf for 40 seconds at a time, and comes back on its own

**Designation: `DOD-NODE-HEAP-GROWTH-1`** — 🟡 **MITIGATED 2026-08-16, CAUSE NOT ESTABLISHED.**
Unranked. **Proposed slot: high — the mitigation is a delay, not a fix, and when it expires the
failure is "nobody can start a session" with an error that points at the wrong thing.**

**What it costs a customer.** They try to reach another agent and are told the other agent is
offline. The other agent is not offline. Nothing they can do changes it, and nothing they are shown
names anything real. It clears by itself minutes later, which makes it look like the other person's
problem rather than a fault — the worst shape a bug can have for trust in a product whose entire
proposition is reliable agent-to-agent contact.

**Measured 2026-08-16.** The directory process grows about **250 MB/day**. Node sizes its own heap
ceiling from total RAM and then never exceeds it however much is free — **2,240 MB on an 8 GB box**.
At ~80% of that ceiling, V8 stops collecting occasionally and collects continuously: **100% of one
core, sustained, for 40 seconds**, measured as +4,096 CPU ticks over 40 wall-seconds. Collection runs
on the same single thread that serves HTTP, so for those 40 seconds the node answers **nothing** —
confirmed by curling `localhost:9090/bootstrap` **on the node itself** and watching it time out while
the machine sat at load 0.4.

| node | RSS | ceiling | % | uptime | stalling |
|---|---|---|---|---|---|
| `gcp-use1` | 1,805 MB | 2,240 MB | **81%** | 5d 21h | yes |
| `gcp-euw1` | 1,659 MB | 2,240 MB | **74%** | 5d 22h | yes |
| `gcp-usc1` | 538 MB | 4,288 MB | 12% | 10h | no |

`usc1` looked immune only because it had been restarted ten hours earlier.

**What was done.** Heap ceiling raised to 4,096 (live limit 4,288 MB) on all three nodes and all three
rolled — infrastructure record in `infra/GCP-STATE.md`. **That buys roughly two weeks instead of six
days. It does not stop the growth.**

**What is still open, and it is the whole item:** whether the growth is a leak. Evidence so far points
AWAY from client traffic — `use1` (the hardcoded primary every client hits first) and `euw1` (reached
only on failover) sat 9% apart after near-identical uptime, which is not what traffic-driven growth
looks like. Anti-entropy, which every node runs continuously regardless of clients, is the untested
candidate. A 60-second memory sampler now runs on all three nodes; the growth rate across them is the
measurement that decides whether this closes or becomes a real hunt.


## 15. Nothing watches anything — the signal sat at 100× normal for days and nobody was told

**Designation: `DOD-NODE-ALERTING-1`** — ❌ **OPEN.** Unranked. **Proposed slot: high, and cheap —
this is the item that would have made `DOD-NODE-HEAP-GROWTH-1` a one-hour problem instead of a one-day one.**

**What it costs.** Not a customer directly — you. Every fault in this list that happens on a node
happens silently, and is found when someone happens to try something and it fails. There is no
"something is wrong" signal anywhere in the system.

**Measured 2026-08-16.** **There are ZERO alerting policies in the `cello-infra` project.** Meanwhile
the CPU metric — which GCP collects for every VM automatically, with no agent and no setup — read:

| node | CPU |
|---|---|
| `gcp-euw1` | 38–44% |
| `gcp-use1` | 20–23% |
| `gcp-usc1` (healthy) | **0.3–0.4%** |

A node running at a hundred times its healthy idle, for days, on a metric already being recorded.
A single policy on sustained CPU would have caught it within the hour.

**Related and worth doing in the same pass: memory is not collected at all.** GCP records CPU
automatically but memory needs Google's Ops Agent, which Container-Optimized OS does not ship — so
the number that WAS the root cause of `DOD-NODE-HEAP-GROWTH-1` was invisible in monitoring and had to be read by
SSH-ing into each box. A host-level sampler now emits it to Cloud Logging every 60 seconds
(`cello.node.memory`). **Note for anyone adding another one: COS forwards journald to Cloud Logging
at WARNING AND ABOVE ONLY** — the first version logged at info, produced perfect lines that never
left the instance, and cost a second roll of all three nodes to fix.


## 16. `cello status` can tell you a node is unreachable for hours after it recovered

**Designation: `DOD-STATUS-STALE-ROSTER-1`** — ❌ **OPEN.** Unranked. **Proposed slot: alongside
`DOD-NODE-ALERTING-1` — it is small, and it is the reason a real fault took a day to see.**

**What it costs.** Anyone diagnosing anything. `directory_endpoints_unresolved` is the one surface
that names which directory node a daemon cannot reach — and it only updates when a roster sweep runs.
Once the daemon returns to its healthy path it **stops sweeping entirely** (the primary resolves, so
no roster probe is needed), which means the field freezes on whatever the last sweep found and stays
there indefinitely.

**Measured twice on 2026-08-16, on two different machines.** Both daemons sat displaying node
failures stamped mid-roll — `ECONNREFUSED`, timeouts — from minutes that had long passed, while
`curl` from the same machines reached all three nodes in 37–184 ms. Both cleared only after a
logout/login forced a fresh sweep, and both then logged `directory.consortium.resolved 3 / 3`.

Its own guidance text says the reading is point-in-time, which is honest but does not help: the
number that makes it actionable — how old — is the one nobody reads, and a stale failure is
indistinguishable from a live one at a glance.

**The fix is a decision, not a bug fix.** Either sweep on a slow timer even when healthy (costs three
cheap HTTP probes per interval), or make the surface refuse to answer with a reading older than N
minutes rather than presenting a stale one as current. **Do not fix it by hiding the field when
stale** — absent and healthy must not look alike.


## 17. One lost packet drops a directory node from the roster for the whole sweep

**Designation: `DOD-BOOTSTRAP-PROBE-RETRY-1`** — ❌ **OPEN.** Unranked. **Proposed slot: high on the
ruin test — this one fails for a normal user on a normal connection, with no fault anywhere in the
system.**

**What it costs a customer.** Someone on mobile data, hotel wifi, or any lossy link tries to start a
session and is told the other agent is offline. Nothing is wrong with the other agent, the nodes, or
their account. Retrying sometimes works and sometimes does not, which reads as "this product is
flaky" rather than as any specific failure.

**The mechanism.** `fetchBootstrapResult` gives each node **one attempt** with a **5-second**
`AbortController` deadline and **no retry** (`core/daemon/src/directory-bootstrap.ts`). A probe that
loses a packet spends the window inside TCP's retransmit backoff — ~1s, 2s, 4s, 8s — and is abandoned
mid-recovery. The node is then absent from that sweep's roster, and enough absences put the roster
below threshold.

**Measured 2026-08-16 over a mobile link in Africa**, against nodes that answer in 0.7 ms locally: one
request returned after **16.2 seconds** (the retransmit ladder, almost exactly), and another returned
**nothing at all in 30 seconds**. Both would be abandoned at 5 s. Note that raising the deadline alone
does not fix it — the 30-second case still fails — because the win comes from a **fresh connection**,
not a longer wait.

**Suggested shape:** ~3 attempts at ~8 s with a bounded total (~20 s), so it survives a lost packet
but still gives up in bounded time against a node that is genuinely down. Numbers are a decision.

> **The error message is its own defect, and it is shared by `DOD-NODE-HEAP-GROWTH-1`,
> `DOD-STATUS-STALE-ROSTER-1`, and this item.** On 2026-08-16 a
> single user-facing string — **`counterparty_offline`** — was returned for a garbage-collecting node,
> for a short roster, and for a stale gateway on the far side. It names the other agent, which was
> online and reachable in all three cases, and names nothing that was actually broken. Most of a day
> went into the network path before the node was suspected, because the error pointed away from every
> real cause. Whatever else is done here, **a roster that is below threshold must say so** rather than
> borrowing a word about the counterparty.


## 18. A retried message permanently kills the conversation it was retried in

**Designation: `DOD-M12B-SUBMIT-ID-1`** (and the rest of **[[M12B-DEFINITION-OF-DONE]]**) — ❌
**OPEN, cause ESTABLISHED and measured.** Unranked. **Proposed slot: at or near the top — this is
basic messaging between two healthy agents, and it fails silently.**

**What it costs a customer.** They send a message. The other side never sees it, and is never told
anything is wrong. The sender's tool says delivered. From then on **every** later message in that
conversation is silently withheld too, and the shared document stops taking the other person's
edits — you see only your own writing. Nothing recovers it: not restarting, not resending. Resending
makes it worse.

**Measured 2026-08-16.** Nothing is lost in transit — relay sequences 1–55 arrived complete, no
gaps. The content reaches the receiving daemon and its signature verifies. It is then **held** and
never surfaced, because its position is ahead of what the receiver has counted. In one session a
single message consumed **49 canonical positions** (49 receipts, one distinct message, sequence
reaching 98); another was submitted 69 times. Verified content destroyed at teardown
(`session.content.held.discarded`, memory-only, called "unrecoverable" by the code itself) fired
**20 times on one daemon in one day**.

**Why it is self-sustaining.** A retry is submitted as a *new* submission, so the relay — whose
counter is `seq_counter + 1`, unconditional — mints a fresh position for content the receiver
deduplicates and never appends. The receiver's count falls one further behind per retry. Held
content is never acknowledged, so it is retried, which burns another position and widens the gap
that caused it. **The repair mechanism is what makes it unrepairable.**

**It is not the bridge and not documents.** Three of the dead sessions on 2026-08-16 were between
two local agents on one daemon, with no bridge and no network in between.

**The work order is [[M12B-DEFINITION-OF-DONE]]** — a submission id inside the signed frame so a
retransmission is declarable, an idempotent `hash_submit` that returns the original position without
advancing the counter or the relay's own tree, a client that stops re-asking, and position
discipline so a leaf index IS its assigned position. Runbook: [[M12B-PROCEDURE]] (§2f governs the
relay roll — it is a bilateral wire contract). Evidence: [[M12B-BUILD-JOURNAL]] Entry 1.

**One open unknown, carried as `DOD-M12B-ACK-1`:** what stops the FIRST acknowledgement. The spiral
needs one unacknowledged send to start and that first failure was never traced.


## 19. A document you were removed from dials its old readers forever, four times a minute

**Designation: `DOD-DOC-RECONCILE-TERMINAL-1`** — ❌ **OPEN**, but narrower than it was filed. The
2026-08-17 storm this item describes (321 dials in 85 minutes against two documents, 367 pieces of
content held on one daemon in one morning, two agents on one machine unable to hold a conversation
at all) was FIXED the same day it was found — removed-holder check + refusal backoff, verified live
(0 refusals, 0 held on a fresh session). **What's still open is the residual, not the storm:** a
much slower version of the gap still opens (2 holds per 20 minutes, down from 367 per morning), and
its root cause is the same stream-closed error tracked as M12B's top line (`DOD-M12B-ACK-1`) — not
a defect specific to this item. Unranked.

Full investigation — the three stacking defects behind the original storm and the re-scope to "this
is why messaging didn't work at all": [[M12B-DEFINITION-OF-DONE]] § `DOD-DOC-RECONCILE-TERMINAL-1`,
[[M12B-BUILD-JOURNAL]].

## 20. A close doesn't tell you it's waiting, so you force it and forfeit the receipt it was about to earn

**Designation: `DOD-M12B-CLOSE-SILENT-WAIT-1`** — 🟡 **HALF FIXED 2026-08-17.** The wait now
announces itself when it starts — with the deadline and the cost of forcing — and a session mid-seal
shows `sealing` on both status surfaces, so a second window can see the first one working.

**What's still open.** The caller is not answered for up to eleven minutes: `cello_close_session`
waits out `CELLO_SEAL_BILATERAL_TIMEOUT_MS` (default 660,000 ms) before escalating to a unilateral
seal, which then succeeds and produces a real notarized receipt (measured 16:48:55 → 17:00:01, 11m
06s). The wait itself is correct — the problem is that before the announcement shipped, an operator
had no way to distinguish "working" from "broken," and reached for `force: true`, which **forfeits
the exact receipt the wait was about to earn**. 17 sessions were force-closed this way before the
cause was found.

**Why it isn't fully closed.** Answering the caller early would orphan the unilateral escalation that
runs inline after the wait, which changes the close contract and what produces the receipt — that is
a decision, parked rather than taken in passing.

Full trace: [[M12B-DEFINITION-OF-DONE]] § `DOD-M12B-CLOSE-SILENT-WAIT-1`, [[M12B-BUILD-JOURNAL]]
Entry 19.

## 21. A transport hiccup can permanently kill a perfectly healthy conversation

**Designation: `DOD-M12B-TRANSPORT-FAULT-NOT-TERMINAL-1`** — ❌ **OPEN, found 2026-08-19 while
fixing `DOD-RELAY-DIRECTORY-CONNECTION-LIFECYCLE-1` (closed). Upstream of the two items below it,
and the most valuable of the three — fixing this one likely shrinks or removes the other two.**

**What it costs a customer.** Nothing was wrong with their conversation, their agent, or the
messages exchanged. The relay simply could not reach a directory at the moment it tried to notarize
the close — a two-second network blip, a directory mid-restart, a brief outage. The relay treats
that identically to "this seal is invalid, refuse it forever": the conversation is killed,
permanently, over a problem that had nothing to do with the conversation itself.

**The mechanism.** `rejectSeal` (`relay-node.ts:728`) terminalises the session unconditionally on
every path that reaches it, with no branch for "the failure was transport, not merits." M12 Tier
P5's eviction fix (`DOD-M12-CONN-EVICT-1`, closed) removes one PRODUCER of the transport fault that
trips this line — a stale libp2p connection. It does not touch the shape of the bug: any future transport hiccup (a
directory rolling, a capacity outage, an ordinary network blip) still arrives at the same
unconditional kill.

**Why it is upstream of the two items below it.** If a transport fault left the session active and
retryable instead of dead, there would be no falsely-terminal row for `DOD-M12B-TERMINAL-REASON-1` to
misreport, and nothing for `DOD-M12B-PULL-NEVER-RECOVERS-1`'s recovery path to need to find. It is
the root; the other two are downstream symptoms of not having this fix.

**What "fixed" looks like.** `rejectSeal` distinguishes a transport failure (could not reach a
directory) from a merits failure (the directory examined the seal and refused it), and only the
merits case terminalises. A transport failure instead leaves the session active, so the client
retries rather than believing it is over.

## 22. The relay has one word for "sealed" and one word for "gave up," and they are the same word

**Designation: `DOD-M12B-TERMINAL-REASON-1`** — ❌ **OPEN, found 2026-08-19 while fixing
`DOD-RELAY-DIRECTORY-CONNECTION-LIFECYCLE-1` (closed).**

**What it costs a customer.** Two sides of the same dead conversation get told two different
stories, and both are behaving correctly given what they were told. One side believes it holds a
receipt. It holds nothing.

**Measured on session `df2a2a08`.** The relay refused that seal at 04:53 on a transport fault
(`DOD-M12B-TRANSPORT-FAULT-NOT-TERMINAL-1`). The counterparty's next status check got back `session_sealed` — the SAME string the relay
uses for an actual successful notarization — and wrote a terminal "sealed" row at 04:58, six minutes
before its own close attempt even timed out. It holds no certificate, because none was ever
notarized. Meanwhile this side got a different answer (`relay_session_gone`), correctly read it as
transient, and kept the session live.

**The mechanism, verified in source, not inferred:**
```
relay-node.ts:728   rejectSeal(sessionId, _reason) { ... status: "seal_rejected" ... }
relay-node.ts:1077  if (state.status !== "active") { await reply("session_sealed"); return; }
```
`session_sealed` is the reply for EVERY non-active status, `seal_rejected` included — a refused seal
and a notarized one are indistinguishable to the client asking. `rejectSeal` is HANDED the real
cause at its call site (`relay-node.ts:1416`, `dirResult.reason` — `connection_lost: …` for a
transport fault, a directory string for a merits refusal) and discards it: the parameter is
underscore-prefixed and reaches nothing but a `protocolLog` line.

**What "fixed" looks like.** At minimum three distinct terminal reasons — notarized /
refused-permanently / still-in-progress — with a defined meaning for an unrecognised reason, so an
older client fails safely rather than silently misreading a new answer the same way it misreads
this one today. **Wire-visible: the relay must tolerate the new reasons before any client is allowed
to depend on them** (§2f) — the same staged-rollout discipline M12B already uses.

## 23. The one safety net for `DOD-M12B-TERMINAL-REASON-1` has never once caught anything

**Designation: `DOD-M12B-PULL-NEVER-RECOVERS-1`** — ❌ **OPEN, found 2026-08-19 while fixing
`DOD-RELAY-DIRECTORY-CONNECTION-LIFECYCLE-1` (closed). Needs investigation before any fix — not a
quick patch.**

**What it costs a customer.** When a client suspects the counterparty might hold a receipt it was
never told about (exactly the `DOD-M12B-TERMINAL-REASON-1` situation), it can ask the network
directly: "does anyone have a
certificate for this conversation?" That mechanism is the only thing standing between "the relay
said sealed but lied" and "the receipt is gone for good" — and right now nobody knows if it works.

**Measured on this machine's daemon log, 2026-08-19:**

| event | count |
|---|---|
| `seal.certificate.pull.not_found` | **157** |
| `seal.certificate.pull.recovered` | **0** |
| `seal.certificate.pull.malformed` | 1 |
| `seal.certificate.pull.timeout` | 1 |

157 attempts, zero recoveries. Built for `DOD-TERMINAL-STATE-DIVERGENCE-1` — exactly the shape of the
`DOD-M12B-TERMINAL-REASON-1` failure — and every invocation has come back empty. Either the
certificates genuinely are not there (which points back at `DOD-M12B-TRANSPORT-FAULT-NOT-TERMINAL-1`
and `DOD-M12B-TERMINAL-REASON-1`), or the recovery path cannot find records that do exist. Both are
real problems; neither is "it works."

**The trap to avoid.** Do NOT read a `not_found` as proof no certificate exists and start
auto-repairing a terminal row on that signal. Homing moves (`relay.seal.redirected` /
`seal_initiator_not_local` is in this machine's own logs from the same day), the record may sit on
another consortium node entirely, and a grace window may not have elapsed. Treating absence as proof
would risk destroying a genuinely terminal state — strictly worse than the divergence it exists to
repair.

**What "fixed" looks like.** First, establish WHICH of the two explanations above is true — that is
its own measurement, not assumed. Only then does a fix make sense: either the pull is asking the
wrong place, or there really is nothing to find and `DOD-M12B-TRANSPORT-FAULT-NOT-TERMINAL-1` /
`DOD-M12B-TERMINAL-REASON-1` are where the fix belongs instead.

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
daemon, silently lost each other's messages. That defect is now fixed (M8D — see
[[launch-triage-archive]]), but it
was never covered by anything in this item, and multi-*device* remains unbuilt.

## Sign-in and your agent list still read the column that only one node has

**Designation:** `CELLO-REPL-001` (`docs/planning/user-stories/m14/CELLO-REPL-001.yaml`)

**What goes wrong.** Which agents you own, and whether your email is recognised at sign-in, are
answered from a column that lives only on the directory node that registered you. Ask a different
node and it says you have no agents, or that your address is unknown — not an error, just an
authoritative-sounding "no". There are three nodes and a client may reach any of them.

**Why it is NOT ranked for launch.** Because the portal was changed on 2026-08-07 to ask every node
and merge the answers, so an operator sees the right thing today. This item retires that workaround;
it does not create the fix. Nobody is currently ruined by it.

**Why it is not merely tidying.** The replicated tables exist, are backfilled, and are converged
across all three nodes (V59/V60, deployed 2026-08-08) — and exactly ONE caller reads them: the kill
switch, which is why pausing your own agent works again. Four readers were never moved. So the
system now holds two sources of truth for the same binding, one of which is silently node-local, and
the obvious column is the wrong one. That is precisely how this defect arrived: a reader picks the
column, and is correct on the node they happen to test against.

**The ordering matters and is in the story.** Move the four readers, confirm on a converged fleet,
then drop the columns in a SEPARATE release. Dropping with a reader left behind turns a wrong answer
into a crash; dropping before convergence removes the only copy some node holds.

**⚠️ ONE OF THE UNMOVED READERS IS A SECURITY CHECK, found 2026-08-10 by the review of
`DOD-END-ISSUER-REGISTERED-1`. This raises the item above tidying and it was not previously listed.**
The portal's same-operator test — the thing that stops an operator manufacturing standing by having
their own agents endorse each other — is `accountId match OR verified-phone-stub match`. The
phone-stub arm reads a replicated column and is sound. **The account arm reads exactly the node-local
column this item is about**, so whether two co-owned agents are caught by it depends on which node the
portal happened to ask. Measured live for one operator with three agents: `usc1` had 2 linked, `euw1`
1, `use1` 0.

Not a hole on its own — the phone arm still catches the case the check was designed around, and both
agents must be registered — but it means half of a load-bearing security check is currently a coin
flip per node, and nothing says so at the call site. **Searching every node does not fix this** (the
fix shipped for the issuer lookup returns the FIRST node with a hit, which may be the one holding the
NULL link); the reader has to move to the replicated table. That makes this reader the one to move
first when the item is picked up.

**Related:** the kill-switch half of this is DONE and verified live in both directions — an agent
registered on one node can now be paused from another, and a caller asserting someone else's account
is still refused.

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

- **`DOD-TGDOOR-1`** (M8C, 🟡 built and tested, never watched on a real phone) — **REMOVED FROM THE
  LIST 2026-08-10 (Andre). We are not doing this proof.** The doorbell reaches a phone through
  Telegram, and Telegram is what we rely on for that today. **Ship without.**

  Original entry, verbatim, so the move loses nothing: *"still the only Tier-3 unit that can't be
  smoke-tested without a real bot token. The doorbell-to-Telegram feature is built and passes its test
  suite, but has never been watched working end-to-end on an actual phone. Low risk either way; just
  unverified. Flips to done on a live proof, nothing else — minutes with a phone, do it
  opportunistically whenever Andre is at hand."* **That reason — needing a real bot token — is why it
  sat unproven, and it is the fact that did not survive my first pass at this move.**

  Andre's reasoning, recorded because it also answers a question this list does NOT currently ask:
  a Telegram account cannot share a phone number unless one is registered to it, and registering one
  requires passing Telegram's own phone verification — so anyone who can share a number through the
  app had that number verified at some point in the not-too-distant past. Not perfect, and
  **deliberately accepted as more than enough for launch.**

- **`DOD-TESTDAEMON-REAP-1`** (M8C, ❌ raised 2026-07-30) — the test harness leaks its subject
  daemon, which then hammers the dev directory indefinitely. Raised in the same batch as the
  sealed-inbox / logout / mismatch items; the only one of the four not carried here. Dev tooling,
  not a customer-facing defect — ship without.
- **`DOD-SESSION-REAP-1`** (M8C, ❌ backlog) — restart-interrupted sessions accumulate as
  un-sealable cruft. Its own line says cosmetic, not launch-blocking; the reaper must be
  evidence-gated, never age-gated, when it is built. Ship without.
- **`DOD-RETRYQ-STRAND-1`** (M8C, ✅ FIXED 2026-08-06, cello-client `4a796e2` + `a9f2573` — it was
  cheap once diagnosed, so it was done rather than deferred; the ship-without ruling below stands as
  the reasoning, not as a description of current state). A direct-resend row whose session went
  terminal, permanent because the queue's
  only consumer (`drainSession`) has no production caller. **Was ruled ship-without.** The operator IS told
  the send failed (`ok:false` + a WARN), so nothing is lost silently and no trust claim is broken —
  that was the only reading that could have made it blocking. What remains is a pinned health
  metric and an accumulating second copy of message plaintext at rest (inside SQLCipher). Real, but
  forgivable; watch the growth rate, not the single row. The relay parked-content TTL does NOT cover
  it — different store, different side of the wire.
- **Awaiting-ACK park loop** (part of `DOD-RETRYQ-STRAND-1`, ❌ open) — `drainAwaitingToPark` keeps
  the row on every park failure, so two of the five reasons (`no_counterparty`,
  `no_persisted_relay_endpoint`) re-attempt at every boot forever. **Ship without** (Andre,
  2026-08-07): the cost is one WARN per restart per stranded row — no data loss, nothing
  user-visible, no false trust claim. `owning_agent_not_found` was fixed (`b5d340d`) because it is
  the one case provable locally; it is also the rarest, and it is **not** the reported case, so the
  reported defect still loops. Catching the other two means declaring a failure permanent without
  proof, and being wrong deletes a message the sender believes was delivered — which is why AC2
  bans age-gating. **Do not "tidy" this with an age sweep.** A real fix needs a permanent/transient
  signal from the relay, and that is its own unit. An earlier attempt keyed on the SENDER's terminal
  session status was reverted before publish for destroying deliverable content — see the DoD line.
- **`DOD-SPINE-JCONTENT-1`** (M8D, 🅿️) — the live parked-message spine journey is 5/10 green.
  Test-harness debt; the two product defects it surfaced are fixed.

---

## Related Documents

- [[launch-triage-archive]] — closed and withdrawn items formerly tracked here. Check before
  re-filing something as new.
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

---
