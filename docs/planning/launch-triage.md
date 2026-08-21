---
name: Launch Triage
type: triage
date: 2026-07-31
topics: [launch, security, backup, receipt-integrity, kill-switch, daemon-lifecycle, telegram, install, triage, sealed-sessions, wake, relay, observability]
status: open
description: >
  The launch punch list. Ranked by what actually goes wrong if left alone, not by build status.
  Plain-language explanation + designation for each item, so this doc works as both a punch list
  and a lookup table into the DoD docs. Open items carry contiguous numbers and renumber when
  something closes; cross-references use names, not numbers, so they survive it.

  The full day-by-day ranking history (2026-07-31 through 2026-08-20 — every re-rank, correction,
  and item added or moved) lives in `git log -- docs/planning/launch-triage.md` rather than here.
  One lesson from that history worth carrying forward without reading the log: **this doc's marker
  tracks whoever last edited the file, not the code** — multiple items sat ❌ for days after
  shipping, one of them while holding the top slot for three days. Before trusting any ❌, verify
  against the published artifact or the running fleet (see the banner at the top of the open list
  for how).

  2026-08-21 (Andre: "shorten this file"): closed items moved to [[launch-triage-archive]]
  (~1,150 lines), this changelog trimmed, and the largest OPEN narrative entries (item 5, item 22)
  compressed to conclusion + pointer. Content unchanged, only relocated or trimmed of
  already-superseded investigation detail. Same day: item 33 (`DOD-RELAY-DIRECTORY-CONNECTION-
  LIFECYCLE-1`) moved from 🟠 unproven to ✅ — the repair fired on a real stale connection during a
  live test and the seal it was blocking returned a receipt. See the item itself for the trace.
---

# Launch Triage

# 🔴 TOP OF THE LIST — CONVERSATIONS CANNOT BE RELIABLY CLOSED (2026-08-19, Andre)

**Sessions work again. Closing them does not.** The 2026-08-17 block below returned us to two agents
holding a conversation, and it is all ✅. This one is about the act that conversation ends with.

**Ruled launch-blocking by Andre, 2026-08-19**, and the reason is not that a receipt is a nice
artifact to point at — that would be a papercut. It is that **you cannot reliably close a session.**
The user sees a close hang for eleven minutes and then fail, or sees no seal, and concludes the
product does not work. CELLO's claim is a cryptographically undisputed record of what was said
between two agents; the close is the only moment that claim is redeemed. **If you cannot seal, the
basic value has not been delivered.**

| Rank | What it blocks | Item | Board line |
|---|---|---|---|
| **1** ✅ | Closing a conversation fails about a third of the time and the receipt is unrecoverable — 38 refused seals against 11 successful, with an exact discriminator. The relay's connection to the directory is closed and the code that exists to repair it cannot. **Cause found, fixed, reviewed twice, LIVE on all five nodes since 2026-08-19 14:00 UTC, and PROVEN 2026-08-21 — the repair fired on real traffic and the seal it was blocking returned a receipt.** | 33 | `DOD-RELAY-DIRECTORY-CONNECTION-LIFECYCLE-1` → M12 Tier P5 |

> ### 🟠 WHAT IS DONE, AND THE ONE THING THAT IS NOT
> **Done and verified.** The cause is traced into libp2p's source: `dial()` returns an EXISTING
> registered connection whenever its socket status reads `open` and never inspects the muxer, so the
> relay's redial handed the same dead object back on all 38 failures. Evict-then-dial shipped in all
> three places that had the defect (relay→directory, directory→relay, directory↔directory
> anti-entropy). Published, promoted, and rolled node-by-node to all five nodes, each verified on
> `cello/{directory,relay}:c703b3aa` by inspecting the instance.
>
> **Sealing is confirmed working after the roll** — two live seals, both verified in the DIRECTORY
> logs rather than taken from an agent's report: roots `3e39affe…` and `9e7a624a…`. Zero seal
> rejections, zero broker-unreachable, zero `evict.unavailable` since. One piece is proven on
> production traffic: `heldForMs` now carries real durations (up to 451,614ms) instead of capping at
> the 30-second probe interval.
>
> **NOT done: the fix has never been exercised.** The repair path has not fired once — three
> directory restarts during the roll produced ZERO `relay.directory.connection.stale`, because a
> de-registered disconnect is the benign case and the next dial genuinely rebuilds. **Both live
> seals ran over freshly restarted links, which is the case that has ALWAYS worked.** Every observed
> failure needed an aged connection. Nothing here shows the defect is gone.
>
> **The signal that would settle it**, and the only one: a `relay.directory.connection.stale`
> carrying `eviction: "evicted"` and `recovered: true`, with the seal that triggered it returning a
> receipt. Until one occurs this stays 🟠. **A quiet fleet is not evidence** — the old relay ran
> 2h29m clean before failing.
>
> Three further defects were found on the way, because they are relay↔client contract rather than
> relay↔directory. **Given their own ranked entries 2026-08-20** — items 34–36 below — rather than
> living only as a footnote here. Also filed in [[M12B-DEFINITION-OF-DONE]] under "Owed follow-ups".
>
> ### ✅ ADDED LATER THE SAME DAY — the instrument, and what it changes about silence
> **A second roll (all five nodes, `0d00e3bf`, transport `0.0.63`) shipped the observability half.**
> The muxer status — the state the failure actually lives in, which libp2p keeps internal and which
> nothing could previously see — is now exposed, and the relay's 30-second probe logs a death AT
> THE MOMENT IT HAPPENS rather than when the next seal trips over it. **Six of six relay→directory
> links confirm `readable: true`**, so the detector is provably watching rather than silently blind.
> An unrecoverable failure now also reaches Telegram, scoped to failures only.
>
> **This changes what silence means, which is the point.** Before today, no news proved nothing. Now
> `relay.directory.muxer.died` never appearing over days — with `readable: true` proving the
> instrument was awake — is genuine evidence the fix is holding. That inversion was Andre's argument
> when he overruled a narrower proposal, and it is the reason this item can sit open honestly rather
> than being called done or watched blindly.
>
> **Was 🟠 for one reason:** the repair had never executed. Six directory restarts across two rolls
> produced zero stale connections, and it cannot be induced — there is no supported way to put a
> connection into the failing state from outside libp2p — so it could only close on a real
> occurrence, not a drill.
>
> ### ✅ PROVEN 2026-08-21 — the occurrence happened, and the repair held
> Two days after the roll, with no restart in between, a real relay→directory connection went stale
> during an ordinary conversation opened specifically to test whether the fleet had gone stale
> (`CELLO_Coder_1` ↔ `Miss_Chelly_H`, session `2bd33101…`, ~02:19 UTC):
>
> ```
> 02:19:05.692  relay.directory.connection.stale   reason: connection_lost: operation aborted due to timeout
> 02:19:06.132  relay.directory.connection.opened
> 02:19:06.246  relay.directory.redial.outcome     eviction: evicted   recovered: true
> ```
>
> `eviction: "evicted"` and `recovered: true` — the exact two fields named above as the only
> acceptable evidence. The seal riding on that connection completed:
> `sealed_root: 2bfb48c5c7aaecc099c035334df8747fa95e420af65daaf058048ea31f4cfeaa`, both participants
> `attestation_mode: "live"`. Read from Cloud Logging on `cello-infra`, not taken from an agent's
> report. Full detail on `DOD-M12-CONN-PROVE-1` in [[M12-DEFINITION-OF-DONE]].
>
> **What this does not close:** `DOD-M12-CONN-DIR-RELAY-1`, the directory's own end of the same class
> of defect, has not independently fired and stays open (unranked, not launch-blocking on its own —
> see [[M12-DEFINITION-OF-DONE]] Tier P5).

**This block outranks the 2026-08-04 ranking below**, on the same terms the 2026-08-17 block did.
Item 33 keeps its number and its position in the body of the list — the doc's numbers are stable and
cross-references use names, so the rank lives here rather than in a renumbering.

**Working it:** Tier P5 in [[M12-DEFINITION-OF-DONE]] is fully closed — cause, fix, roll, instrument,
alerting and the live-fire proof are all ✅. `DOD-M12-CONN-PROVE-1` discharged 2026-08-21. Items
34–36 below are the residual: what happens when a seal DOES fail, which this occurrence did not
exercise.

# 🔴 SECOND — SESSIONS DO NOT WORK (2026-08-17, Andre) — ALL CLEARED

**The core problem is that we cannot conduct a session at all.** Everything in this block was found
on 2026-08-17 and all of it is being cleared today. **This block outranks the 2026-08-04
ranking below**, which is otherwise untouched and still stands on its own terms.

Ordered by what returns us to two agents holding a conversation — and sequenced so each step is
debuggable. The organising principle came out of 2026-08-17 itself: **make the surfaces truthful and
the spine quiet BEFORE debugging the hard one.** Most of that day was lost to a noisy spine and
status fields that lied.

| Rank | What it blocks | Item | Board line |
|---|---|---|---|
| **1** ✅ | A send is refused and doing exactly what the error says fails forever — six consecutive failed sends. Sending works again. | 32 | `DOD-M12B-SIGNAL-GUIDANCE-1` |
| **2** ✅ | You cannot trust what the inbox says about a session; already-accepted sessions report as pending. Cost hours, and it lies precisely when something is wrong. | 26 | `DOD-M12B-INBOX-TRUTH-1` |
| **3** ✅ | You believe you are talking to a person when you are not — the away reply is indistinguishable from a human answer. | 27 | `DOD-M12B-AWAY-MARK-1` |
| **4** ✅ | Background document sync floods the spine, rings the doorbell, pushes your phone, and resets its own backoff — the amplifier behind the storm. | 23 | `DOD-M12B-DELIVERY-QUIET-1` |
| **5** ✅ | **THE BLOCKER — messages parked instead of delivering, and acknowledgements never arrived.** One error, *"Cannot write to a stream that is closed"*, broke both. **Cause found and fixed 2026-08-17: libp2p caps inbound streams per protocol per connection at 32, and the receiving handler read one frame and returned without closing — so every message and every receipt left a half-open stream that was never released. Measured: exactly 32 successful opens before the first failure, on both affected sessions. A session that could not send also went on reporting `alive` for 70 minutes; it now reports `impaired` and says what became of the message.** | 22 | `DOD-M12B-ACK-1` |
| **6** ✅ | Content you received is destroyed, so one hiccup kills a conversation permanently. Turns fatal into recoverable. **Fixed 2026-08-17: held messages are written to disk keyed on the position the relay gave them, so a restart brings them back at the right place instead of throwing them away — 24 were destroyed on one daemon in one morning. When a session ends for good they move to the annex, where you can still read them, rather than becoming rows nothing can reach.** | 24 | `DOD-M12B-STRAND-1` |
| **7** ✅ | Your agent stops accepting sessions entirely — sessions that can neither seal nor be destroyed fill the per-sender cap. **Fixed 2026-08-17: `cello status` now shows which sessions cannot close and why — how many messages are waiting to arrive, how many you already hold, and how long the oldest has been waiting — instead of making you try to close each one to find out. It also says plainly when it cannot tell, rather than calling a session safe to close when closing it is irreversible.** | 30 (+21) | `DOD-M12B-SEAL-STUCK-1` |
| **8** ✅ | Nothing enforces that a message lands where the relay says. **Fixed 2026-08-17: your own messages now take the position the relay gave them instead of whatever slot happened to be next — the message still goes out immediately, only its place in the record waits. Review caught that the first build was off by one and would have held every message ever sent, forever.** | 25 | `DOD-M12B-INDEX-1` |
| **9** ✅ | One connection blip degrades that conversation for life, silently, because nothing ever re-dials. **Fixed 2026-08-17: the next thing you send reconnects, once, and only when it is actually needed — never on a timer, because a timer is what caused the storm at rank 10.** | 28 | `DOD-M12B-REDIAL-1` |
| **10** ✅ | Cleaning up a stuck session makes it worse — the far side is never told and keeps calling. **Fixed 2026-08-17: they are told, and they stop calling. They do NOT lose their receipt over it — review caught that the first build let anyone destroy their counterparty's notarized receipt just by hanging up, and that the fix undid itself a third of a second later.** | 29 | `DOD-M12B-ABANDON-NOTIFY-1` |
| **11** ✅ | The daemon can refuse to exit, so recovery needs manual intervention. **Fixed 2026-08-17: it stops dialling peers on the way out, and every step of the shutdown now has a time limit — a stuck connection or a half-open socket can no longer hold the whole daemon open past the point where `cello logout` says it has gone.** | 31 | `DOD-M12B-SHUTDOWN-1` |

## 🔴 FOUND AFTER THE ELEVEN — the two that actually stopped a conversation (2026-08-17)

Both found by running a real end-to-end test between two of Andre's own agents on the promoted
build. **The eleven ranks did NOT stop two agents talking; these did.** With them out of the way the
same test passed clean: 0 held, 0 discarded, 0 send failures, 0 accept failures, `delivered: true`.

**A. `DOD-CAP-SELF-HEAL-1` (item 21) — ✅ FIXED 2026-08-17.** The bound now counts sessions the
COUNTERPARTY ended, not ones our own restart, shutdown or kill switch ended — so finished
conversations no longer lock out the person you had them with. D18 is intact and was verified path
by path: no counterparty-controllable action produces an excused row. Stated plainly because it is a
real change in the guarantee: the bound is now *concurrent with amnesty at every restart*, not
all-time. The operator is also told when their own cap fires, once per peer per window, naming which
sessions to close and how many. The refusal itself stays byte-identical across tiers — a first
attempt put the counts on the refusal object and the repo's own no-oracle test caught it. → M12B
Entry 19. **Original defect, for the record:**
Two of Andre's own agents could not open a session at all: `session.inbound.accept.failed
reason=abuse_bound_sessions_per_sender`. The receiving agent held 5 FINISHED conversations
(`interrupted`, 22–90 messages each) with the caller, against a stranger cap of 3. They are never
reaped — correctly, since D18 requires interrupted sessions with received content to count — so the
bound is all-time rather than concurrent. **Every pair of agents that has ever talked three times can
never talk again, and every restart makes it worse.** The caller is told nothing: its send returns
`ok` with "dispatched to relay", and the receiving side then sweeps the parked message as
`counterparty_unknown` and deletes it. A success message for a conversation that never existed.

**B. `DOD-M12B-CLOSE-SILENT-WAIT-1` — 🟡 HALF FIXED 2026-08-17.** The wait now announces itself when
it starts, with the deadline and the cost of forcing, and a session mid-seal shows `sealing` on both
status surfaces — so a second window can see the first one working. **Still open:** the caller is
still not answered for up to eleven minutes. Answering early would orphan the unilateral escalation
that runs inline after the wait, which changes the close contract and what produces the receipt —
parked as a decision, not taken in passing. → M12B Entry 19. **Original defect:**
Not a hang: `CELLO_SEAL_BILATERAL_TIMEOUT_MS` defaults to 660,000 ms, and the close waits it out
before escalating to a unilateral seal — which then succeeds and produces a real notarized receipt
(measured 16:48:55 → 17:00:01, 11m 06s). The wait is correct. The silence is not: nothing tells the
caller it is happening, so an operator concludes it is broken and reaches for `force: true` — which
forfeits the exact receipt the wait was about to earn. That is what happened: 17 sessions were
force-closed because the first normal close looked dead. Full trace in M12B Build Journal Entry 18.

---

> **✅ ALL ELEVEN RANKS ARE DONE (2026-08-17)** — built, reviewed by `cello-unit-reviewer`, every
> finding fixed, merged to cello-client `main`, gate green on exit code, and **published to `beta`**
> (daemon `0.0.170`, cli `0.0.177`, connect `0.0.150`; tag `v0.0.244`, smoke-tag green, verified by
> grepping the tarballs). **NOT YET ON `latest`** — the promotion is Andre's to run, and until he
> does no operator has any of it, including his own running daemon. The seven commands are in M12B
> Build Journal Entry 16. **No relay or directory change, so no fleet roll.** Verdicts quoted in
> M12B Build Journal Entries 9, 12, 13, 14 and 15. Rank 4's first build did not work at all and was caught by
> review, and rank 5 drew 16 findings across two reviews — every one fixed before the tag flipped.

**Ranks 1–4 are deliberately ahead of the blocker at 5.** They are all small, they touch different
files from the send path so they cannot collide with it, and together they buy a quiet spine and
honest surfaces to debug rank 5 on. Debugging rank 5 without them is what 2026-08-17 was.

**Verification gate after rank 5:** re-run the 20-minute live measurement. The baseline to beat is
**55 reconcile attempts / 2 holds / 20 direct-send failures**. If holds do not reach zero, stop —
ranks 6 onward assume rank 5 worked.

**Dependency notes.** 7 depends on 6 (a session that can resolve its gap can seal). Ranks 5–9 all
touch the session manager and must be sequential, one commit each. Ranks 1–4 are independent of each
other and of everything else. **One publish at the end, not eleven** — every item here is
client-side.

**Already FIXED on 2026-08-17 and therefore not ranked:** the document sync retry storm
(`DOD-SYNC-REFUSAL-BACKOFF-1`, item 22's engine), the parked send that recorded no reason, and the
unlogged counterparty identity. Item 22 stays open only for its stream defect, which is rank 5.

---


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

> ## ⚠️ A MARKER ON THIS LIST TRACKS WHOEVER LAST EDITED IT — NOT THE CODE
>
> **Before trusting any ❌, unpack the published artifact or read the running instance.** This is the
> single most expensive failure mode this document has. On 2026-08-09–10 alone, **eight** items sat on
> the ranked list while already finished — including the one holding the **top slot**, which had been
> live on operators' machines for three days. Two infrastructure facts recorded here were stale the
> same way, and one of them (a machine type) would have aimed a node roll at the instance type that
> caused the August capacity outage.
>
> How to check, in one line each:
> - **Client fix** → `npm pack @cello-protocol/daemon@latest` and grep `dist/`. Not the branch, not CI.
> - **Directory/relay fix** → `gcloud compute instances describe … ` and read the image tag off the
>   RUNNING instance. Not `terraform.tfvars`, not `GCP-STATE.md`.
> - **Anything claiming convergence or replication** → query the databases and compare. Row counts and
>   digests can match while the answer a consumer gets differs; ask the view the consumer reads.
>
> **Three states, recorded separately, because conflating them has cost days:**
> **committed** → **published to npm** → **promoted to `latest`** (Andre runs the promotion); and for
> the relay/directory: **committed** → **image built** → **rolled to the fleet**.
>
> **Currently promoted — the `v0.0.229` cascade IS on `latest`, read off npm 2026-08-10 06:41 UTC:**
> connect `0.0.140`, cli `0.0.163`, daemon `0.0.156`, gateway `0.0.28`, crypto `0.0.44`, transport
> `0.0.50`, protocol-types `0.0.48`. **`latest` == `beta` on all seven — nothing is pending.** This
> carries `DOD-DOC-WATCH-1` (the selective document nudge), which was committed-but-unshipped for a day.
>
> Twice in one morning this line was wrong in opposite directions: it listed the BETA numbers under the
> word "promoted" (reads as "operators have it" for a build nobody had), and then, once corrected, went
> stale within the hour when the promotions actually ran. **Read it off npm; do not trust the numbers
> here.** `npm view @cello-protocol/<pkg> dist-tags` — seven packages, ten seconds.
> **Directory:** `63f7c4e5` on all three nodes, read off the running instances 2026-08-10 (this line
> said `1f9281f1` for an hour after the roll). **Relay:** `0cf04b0c` on both, verified the same way.

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
was **overstated** (ruled out — see Addressed), and `DOD-ACCOUNTS-CHAIN-1` was **confirmed as a
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
but not chained) and the test-isolation defect below.

<details><summary>The original defect, kept because it is the evidence and the diagnosis</summary>

Raised 2026-07-13. **Diagnosed 2026-08-04: possibility (a) confirmed — a real tamper-evidence gap,
not a test artifact.**

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

**🟡 BUILT + REVIEWED 2026-08-06** — `493609dc` + `1aa25164`, branch `dod/accounts-chain-1`.
Confirmed on live data first (the real row's hash IS the standalone digest). One writer now:
`resolveOrCreateAccount` on the store, locking before the existence check so the chain cannot fork;
`resolveAccountId` deleted. The recorded repro is green.

**DEPLOYED, and the ONE ROW residual is GONE — RE-MEASURED 2026-08-10. Nothing is owed from Andre.**
🚨 **DO NOT REPAIR THAT ROW. There is no longer a broken one, and both of the repairs this item used
to recommend would now be the first damage the table has taken.** Measured twice an hour apart by
dumping every row from all three live databases and recomputing the chain: **11 rows on each node,
`verifyChain` VALID on all three**, including position 1 on `gcp-usc1` — the row recorded here as
broken.

The 2026-08-06 check that found it was run when the table held **one** row; ten more were written on
2026-08-07 and position 1's stored hash is now the chained value. Whether the deployed fix rewrote it
or the original computation was wrong is not established, and does not change the answer: the running
database is ground truth.

**Why this needed saying loudly rather than quietly corrected.** A second session read this line on
2026-08-10, believed a row was still broken, and was about to repair it with admin credentials —
correctly, by the letter of what was written here. **Deleting position 1 breaks the ten rows behind
it**, because each row's hash is computed over the previous row's stored hash; `verifyChain`'s own
AC-005 says a deleted row is detected as a sequence gap. That option was the gentler-sounding of the
two ("let anti-entropy re-replicate it chained") and it would have manufactured the exact failure this
item exists to remove, on a clean table. The other option is a no-op at best and a chain break at
worst. **A stale ❌ on this list is not a harmless overstatement — it is an instruction.**

**The reasoning that made it Andre's call still stands, and is why nothing was broken:** rewriting a
`chain_hash` in an append-only tamper-evidence table, using admin credentials to bypass the RLS that
deliberately denies the app user `UPDATE`, is *the exact operation the chain exists to detect*.

**Still owed alongside it:** surface `verifyChain("user_accounts")` on the ops-agent health output,
or "still red on the origin node" gets closed and forgotten. Steps in [[M8C-DEFINITION-OF-DONE]]. Two spin-offs recorded there:
`DOD-ACCOUNTS-EMAIL-CHAIN-1` (the email half of the binding is stored but not chained), and a
test-isolation defect — several suites `DELETE` from this append-only chained table, which makes the
`CELLO_ENV=local` suite non-deterministic (36 vs 30 failures across two runs of the same tree).

</details>

---

## 2. A mismatch that makes a conversation unsealable leaves no durable trace

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

<details><summary>Full investigation — root cause, the rejected designs, the migration correction,
and the build. Kept for history; the reasoning generalizes to any push-without-a-pull-twin defect
(M8C-PROCEDURE §5d, `DOD-INV-PUSHPULL`).</summary>

**Designation (historical): ** — 🟡 **PARTIALLY ADDRESSED 2026-08-06.**
**Mitigation SHIPPED** (cello-client `3e59b53` + `5e1a9af`, unit-reviewed): the guidance deadlock is
broken, so an agent is no longer walked from two individually-true answers into a force-abandon that
destroys its own half of the receipt. That was the mechanism by which a *recoverable* divergence
became a *permanent* one on 2026-08-06 — the loss was caused by the escape, not by the missed frame.
**The CURE — the `seal_certificate_request` pull — was designed and, as of 2026-08-06, NOT built** (see the design
and its corrected cost below: it needs V58, the SSM bump, and a directory deploy, and it cannot
repair sessions sealed before that migration). Divergences will still OCCUR until the pull twin
ships; they will simply stop being self-inflicted-permanent. Still ❌ as a defect, raised 2026-08-05, **ROOT-CAUSED
2026-08-06 on the live Hermes daemon (see below) — no longer "a resolution path is owed"; the fix
shape is now known and is a push/pull-twin gap, not a protocol redesign.** **Proposed rank:
slot #2, right after item 1 (`DOD-LOGOUT-EXIT-1`), pending Andre confirmation — added 2026-08-06.**
Reasoning: this is the one item in this pair that attacks the notarization guarantee itself — a real
conversation can end up permanently unsealable, forcing a receipt-forfeiting force-abandon. Rare
trigger, but the failure shape is ruin-class: a receipt that was promised never exists, silently. No
resolution path is known yet (stated below), so ranking it high commits to open-ended discovery work,
not a scoped fix — flagging that trade explicitly rather than deciding it here.
Distinct from `DOD-FRONTIER-MISMATCH-DURABLE-1`, which covers *leaf* divergence. Here **the leaves
agree and the statuses do not.**

Session `dcd0aadc…` could never produce a receipt and had to be force-abandoned with no notarized
record. It has no `frontier.mismatch` and no `leaf_count_mismatch` anywhere in its log. What it has:

```
09:45:59.336  node.destroyed  reason="sealing"          ← peer believes it is sealing
12:14:52.190  rejected  session_not_interrupted         ← first refusal, 2.5h later
12:17:53.946  rejected  session_not_interrupted         ← retry
12:33:46      request.reaped_terminal  status="abandoned"
```

The peer considered it *sealing*; the initiator still listed it as *interrupted*. **Neither side could
complete:** you cannot seal-interrupted a session the peer considers sealing, and the peer cannot
finish sealing without a counterparty that is gone. The refusal string was literally accurate and
still useless.

**Why it needs its own item.** Miss_Chelly's M12-P14 pre-seal gate reads local frontier state to
refuse signing a chain that is provably short — it would not fire here, because nothing is short.
The `DOD-SEALED-INBOX-2` rename helps (`session_already_sealed` at 12:14 would have saved an
afternoon) but only makes the state *legible*, not *completable*.

## ROOT CAUSE FOUND 2026-08-06 — the seal is announced on a channel that can be down, and the announcement has no pull twin

Traced on the live Hermes EC2 daemon against a second, independent instance of this defect: session
`9014d071…`, `Miss_Chelly_H` (responder) ↔ `CELLO_Coder_1` (initiator). Every fact below is from
`~/.cello/daemon.log` on that box, not inferred.

**The ceremony completed. The announcement did not arrive.**

```
07:37:45.833  session.seal.leaf.submitted        seq 5     ← Miss_Chelly_H signs its half
07:37:45.833  session.relay.leaf.delivered       seq 5     ← and it is delivered
07:37:45.834  session.seal.autoacknowledged      responderPubkey=698bf453…
07:37:49.321  session.liveness.changed           gone
              …nothing further for this session for 6 hours…
```

`CELLO_Coder_1` holds a valid bilateral receipt for it (`sealed_root 85bcc15f…80d22bb`) listing
**both** participants as `attestation_mode: "live"` — so the seal really is bilateral and really is
notarized. Miss_Chelly_H's own row, meanwhile, never left `interrupted`.

**Why.** `session.sealed.received` appears **14 times** in that daemon's log and **zero** times for
this session. The completion frame never arrived. It could not have: 90 seconds before the seal,

```
07:36:01.616  transport.autonat.unavailable  directorySignalingStatus="reconnecting"
```

and no `directory.signaling.connected` follows before 07:40. **The seal CEREMONY runs over the
session/relay channel — which was healthy, hence the delivered leaf. The seal COMPLETION is pushed
over the agent's authenticated DIRECTORY SIGNALING stream — which was down.** Two different
channels; only one of them has to be up for the directory to consider the seal complete and for the
counterparty to get a valid receipt.

`registerSessionSealedListener` (`core/daemon/src/seal-coordinator.ts`) consumes `session_sealed`
via `signaling.registerInboundHandler` — a **push, with no re-delivery and no reconciliation**. A
frame that arrives while the stream is down is simply never seen. Nothing ever asks again.

**The deadlock is a closed loop of individually-correct answers.** Both sides of it are working as
designed, which is why it survived inspection:

| call | answer | its guidance |
|---|---|---|
| `cello_close_session` | `session_already_sealed` (true — the counterparty *is* sealed) | "fetch it with `cello_sealed_receipt`" |
| `cello_sealed_receipt` | `not_sealed_yet` (also true — no *local* certificate) | "Close it with `cello_close_session`" |

`cello_sealed_receipt` reads the LOCAL certificate store only (`session-read-handlers.ts:113`), and
the local certificate is written only by the push that was missed. So the two commands point at each
other forever. The operator's only exit is `--force`, which **forfeits a receipt that provably
exists** — which is exactly what happened on 2026-08-06, converting a recoverable divergence into a
permanent one.

**This violates an invariant M8C already carries.** `M8C-PROCEDURE` §5d: *"Every push needs its pull
twin in the same unit (DOD-INV-PUSHPULL)."* `session_sealed` is a push with no pull twin. It also
fails §5a **ABSENT IS NOT FINE**: the absence of the frame is read as "nothing happened" rather than
"I do not know — go ask."

**The fix shape, and why it is smaller than it looks.** Give `session_sealed` its pull twin: when a
session is locally non-terminal but the counterparty or directory reports it sealed — and on startup
reconciliation of `interrupted` sessions — **fetch the seal certificate and verify it locally**
rather than waiting to have been told. This does not require trusting the directory:
`verifyBilateralSealCertificate` already exists and already validates the FROST signature over the
legibility-bound TBS, and the same function the push path uses can validate a pulled certificate
unchanged. The missing piece is the request, not the cryptography.

Two constraints on that fix:
1. **Never let a pull mark a session sealed on the directory's say-so alone.** The certificate must
   verify locally, exactly as on the push path — otherwise a lying directory could retire a session
   that never sealed.
2. **`--force` must stop being the escape hatch for this state.** While a counterparty reports
   `session_already_sealed`, force-abandon should refuse (or at minimum warn hard): it destroys the
   local half of a receipt that exists and is fetchable.

## The open question is now ANSWERED, and the directory half is worse than the client half

**No certificate-fetch verb exists.** The complete set of frames the directory accepts from a client
(`decodeInboundSignalingFrame`, `directory-frames.ts:511`) is: `signaling_auth_response`,
`register_request`, `revoke_agent`, `dkg_complete`, `primary_transfer_request`, `connection_request`,
`connection_response`, `disclosure_request`, `disclosure_response`, `discovery_lookup`,
`peer_info_announce`, `manifest_poll_request`, `ping`, `session_request`, `session_offer_accept`,
`session_offer_reject`, `seal_attempt`, `seal_frost_signature`, `seal_unilateral`,
`seal_upgrade_request`, `seal_interrupted_request`, `seal_interrupted_ack`,
`seal_interrupted_rejection`, `submission_write`, `submission_results_request`, `trust_signal_ack`.
Nothing reads a seal certificate. **So this spans BOTH repos and needs a directory deploy.**

**The directory already knows about this defect and logs it at ERROR.** `#deliverOrEnqueue`
(`directory-node.ts:5537-5558`) carries the diagnosis in its own comment:

> "`notification_queue` is per-node and is NOT in the anti-entropy set, and `drainNotifications` only
> fires for a peer authenticating on THIS node — so a participant homed elsewhere never receives
> this. … by this point the seal IS notarized and durable, so there is nothing to retry. The agent
> holds a session it believes failed, against a receipt that exists."

It emits `seal.result.undelivered` at ERROR with `consequence: "the seal is durable but this
participant was not told"`. **A re-delivery mechanism does exist** — `drainNotifications` fires on
signaling auth and re-sends `session_sealed` (`directory-node.ts:2049-2065`). It just cannot work,
for a reason the live log makes concrete.

**Clients ROAM across nodes, and the queue does not.** Miss_Chelly_H's signaling connections on
2026-08-05:

```
05:13:26 → gcp-euw1
07:28:27 → gcp-usc1     ← connected here, dropped before the 07:37:45 seal
16:44:55 → gcp-euw1     ← reconnected HERE, nine hours later
18:48:23 → gcp-use1
```

Three connections, three different nodes. The seal's notification was enqueued on whichever node
adjudicated it; the client next authenticated somewhere else and drained an empty queue. **With N
nodes this misses roughly (N-1)/N of the time and never self-corrects** — it is the normal case, not
an edge case. Per-node delivery state is simply the wrong shape for a client that is free to pick a
node, which is the sovereign-node design working as intended.

## Design — the pull twin (`DOD-INV-PUSHPULL`, M8C-PROCEDURE §5d)

**The data is already everywhere it needs to be.** `seal_notarizations` is a **Tier-A anti-entropy
table** (`pg-ae-store.ts:149-154`, `hash-chain.ts:264`), so every node already replicates every
notarization. The certificate the stranded client needs is sitting on the very node it just
authenticated to. Only the *request* is missing. The directory's own comment reaches the same
conclusion: *"the receipt can be LEARNED locally and does not need this cross-node push at all."*

**Rejected alternative — put `notification_queue` into anti-entropy.** AE is append-only/LWW; a
delivery queue is defined by its deletes. Replicating it invites double-delivery and needs per-node
drain dedup, to solve a problem the already-replicated `seal_notarizations` solves with no new
state.

**Rejected alternative — push all unseen notarizations on auth.** Requires the directory to track
what each client has seen, which is per-node delivery state again — the same shape that failed —
or an unbounded "every sealed session for this agent" scan on every connect.

**The design.**

1. **Directory — new inbound verb `seal_certificate_request { session_id }`**, answered by
   `seal_certificate_response` carrying the stored notarization, or a named `not_found`. Served from
   `seal_notarizations`, so ANY node can answer regardless of which one adjudicated. The requester
   must be a participant in that session — a certificate names both parties and must not be a public
   lookup by session id.
2. **Client — call it at the three moments the deadlock is discovered**, never on a timer:
   `cello_close_session` receiving `session_already_sealed`; `cello_sealed_receipt` finding a session
   row with no local certificate; and startup reconcile of `interrupted` sessions.
3. **Verify locally, always.** `verifyBilateralSealCertificate` already validates the FROST signature
   over the legibility-bound TBS and is what the push path uses — a pulled certificate goes through
   the identical check. No new cryptography is required. (But see the CORRECTION below: the fields
   that TBS covers are not all persisted today, so this is not as cheap as this line first implied.)
4. **`--force` must stop being the escape hatch.** While a counterparty or directory reports the
   session sealed, force-abandon should refuse (or warn hard): it destroys the local half of a
   receipt that exists and is fetchable. This is what turned a recoverable divergence into a
   permanent one on 2026-08-06.

**Security invariants this must satisfy.**
- *A pulled certificate is never trusted on the directory's say-so.* It is recorded only if
  `verifyBilateralSealCertificate` passes; otherwise the session stays as it is and the failure is
  named. A lying directory must not be able to retire a session that never sealed.
- *The lookup is participant-scoped.* A non-participant asking for a session id learns nothing —
  same answer as a session that does not exist, so the verb cannot be used to probe which session
  ids exist.

### CORRECTION (same session, before any code): a migration IS required, and the fix is NOT retroactive

The paragraph that stood here said *"No migration: `seal_notarizations` already holds everything the
response needs."* **That was asserted without reading the schema, and it is false.** Checked:

| Field the certificate needs | Stored? |
|---|---|
| `session_id`, `sealed_root`, `close_timestamp`, `frost_signature` | ✅ `seal_notarizations` (V12) |
| `participant_a/b_pubkey`, `seal_type` | ✅ `seal_notarizations` (V12/V31) |
| **`leaf_count`** | ❌ nowhere |
| **`signer_pubkey`** (the initiator's group public key) | ❌ nowhere |
| **`legibility`** | ❌ nowhere |

`conversation_seals` (V2) does not hold them either — it has `merkle_root`, `close_type`,
`participant_count`, `seal_date`, and no leaf count or legibility. All three missing fields are
**bound into the TBS** that `verifyBilateralSealCertificate` hashes (that binding is the whole point
of M7 legibility-TBS-binding: tampered legibility must break the signature). A response missing them
cannot be verified, and an unverifiable certificate is exactly what must never be accepted.

**So the design gains a migration and loses its retroactivity:**

- **V58** adds `leaf_count`, `signer_pubkey`, `legibility` to `seal_notarizations`, and the seal
  write path populates them — the values all exist in memory at `processSeal` time (`pending.leafCount`,
  `primaryPubkey`, `pending.legibility`); they are simply discarded today.
- **`OpsAgentExpectedMigrationVersion` must move to 58** in `cello-ssm-parameters.yaml` in the same
  change — omitting it crash-loops the ops-agent on a fresh deploy (repo CLAUDE.md, non-negotiable).
- **Sessions sealed BEFORE V58 can never be served by the pull.** Their `leaf_count`/`legibility`
  were never recorded, so no verifiable certificate can be reconstructed for them. `9014d071…` and
  every existing stranded session stay stranded. **This fix prevents future divergence; it does not
  repair past divergence, and it must not be described as if it does.**

That last point changes what to do about the sessions already in this state: the honest handling is
to surface them accurately (a session the counterparty reports sealed, for which no local receipt
can ever be produced) rather than to keep force-abandoning them — and to stop `--force` presenting
itself as the fix.

**Cost, corrected.** One new frame pair, a schema migration + the SSM parameter bump, the seal write
path, one participant-scoped read, three client call sites, a publish cascade, and a directory
deploy (~25–30 min, all three regions).

**Triage note.** This is no longer a small unit, and it buys protection against *future* occurrences
only. Whether that clears the launch bar is Andre's call — recorded here rather than assumed, and
the "smaller than it looks" framing from the paragraph above is withdrawn.

**Provenance worth keeping.** This was initially closed as "not a second root cause — an artifact of
our own force-abandon two minutes earlier." That explanation is correct for `4c28edcd` and was
generalised onto `dcd0aadc`, which nobody had separately traced. The log refutes it in one line:
`dcd0aadc`'s first refusal is 12:14:52.190, and the earliest `force_abandoned` *anywhere* in the log
is 12:16:56.995 — two minutes later, on a different session. **Both corrections in that exchange ran
the same direction: a verified explanation travelling to a case nobody had traced.** Worth reading
before trusting any single-case diagnosis in this area.


## BUILT 2026-08-09 — and it was smaller than this item implied

**The asking already existed.** `seal-certificate-pull.ts` on the client, `seal_certificate_request`
served by every directory node, both shipped earlier. It was wired to exactly ONE caller: reading a
receipt (`cello_sealed_receipt`).

It was NOT wired to the close — which is where an operator is actually stranded. They are not reading
a receipt; they are trying to end a conversation, and the close fails in a way indistinguishable from
"it has not sealed yet".

So the work was not building the pull. It was **asking at the moment someone is stuck**.

**What changes for an operator.** A close that fails for a reason that could mean "already sealed
elsewhere" now asks once. If a certificate comes back AND verifies against its FROST signature, the
close SUCCEEDS and hands over the receipt — the thing they were trying to do simply works. If there
is genuinely none, the answer says **`asked_none_exists`**, which is a different fact from never
having asked and is the one needed before a force-abandon.

**Three judgements, recorded so they are not "simplified" later:**
- **Scoped to reasons where a seal could plausibly exist** — the counterparty rejecting our request
  because IT considers the session finished, a unilateral timeout, or the relay calling the session
  terminal. Asking on every failure would put a directory round trip in front of refusals that fail
  precisely because nothing was sealed.
- **The directory is not trusted for the answer.** The certificate is re-verified before anything is
  recorded, which is what makes serving it from any node safe.
- **Wrapped, not patched into each exit.** The handler has six failure returns; a seventh would be
  added without the recovery.

**One real bug caught mid-change by the vocabulary audit:** the wrapper first read `cello_session_id`
— the MCP TOOL's field name. The shim renames it, so over IPC the field is `session_id`: it would
have found nothing and silently skipped every recovery, with no test failing for it. Now pinned by a
test.

**Still not covered:** a daemon that has never tried to close a stranded session does not ask on its
own. There is no startup sweep. The recovery is triggered by the operator's action, not by the
daemon noticing.

**PUBLISHED and promoted** — shipped in `daemon 0.0.151` and on `latest` since 2026-08-09. (This line
read "not yet published" for a day after it was.) **What keeps this item open is the residual, not the
pull:** nothing asks on the daemon's own initiative, so a session stranded and never touched again
stays stranded. There is no startup sweep.

</details>

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
for diagnosing this, and it is the same blind spot as item 15 one layer up.

**First diagnostic step:** add the agent name and the trigger (`explicit` | `replay` | `fallback`)
to `agent.current.switched`, then reproduce with a daemon restart after a release. That distinguishes
the two candidates in one run.


## 8. Directory nodes cannot see each other's heartbeats — each believes it is the only one alive

**Designation: `DOD-HEARTBEAT-REPLICATION-1`** — ❌ **OPEN.** Unranked. Previously recorded only as a
footnote on item 14; filed here because it is a live fault in its own right and was nearly fixed as
if it were the cause of something else.

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
same operator*. **The fix and the full trace are item 14 (`DOD-END-ISSUER-REGISTERED-1`); Andre decided
the shape the same day: both parties must resolve or the answer has no teeth.** Case 1 (both agents
account-bound but phone-unverified) is NOT answered and stays open here — it is a narrower hole than
case 2 and is not addressed by item 14's fix, because two registered agents both resolve.

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


## 15. You cannot retract a trust signal — and the tool says you did

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


## 16. A directory node goes deaf for 40 seconds at a time, and comes back on its own

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


## 17. Nothing watches anything — the signal sat at 100× normal for days and nobody was told

**Designation: `DOD-NODE-ALERTING-1`** — ❌ **OPEN.** Unranked. **Proposed slot: high, and cheap —
this is the item that would have made item 16 a one-hour problem instead of a one-day one.**

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
the number that WAS the root cause of item 16 was invisible in monitoring and had to be read by
SSH-ing into each box. A host-level sampler now emits it to Cloud Logging every 60 seconds
(`cello.node.memory`). **Note for anyone adding another one: COS forwards journald to Cloud Logging
at WARNING AND ABOVE ONLY** — the first version logged at info, produced perfect lines that never
left the instance, and cost a second roll of all three nodes to fix.


## 18. `cello status` can tell you a node is unreachable for hours after it recovered

**Designation: `DOD-STATUS-STALE-ROSTER-1`** — ❌ **OPEN.** Unranked. **Proposed slot: with or just
below item 17 — it is small, and it is the reason a real fault took a day to see.**

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


## 19. One lost packet drops a directory node from the roster for the whole sweep

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

> **The error message is its own defect, and it is shared by items 16, 18 and 19.** On 2026-08-16 a
> single user-facing string — **`counterparty_offline`** — was returned for a garbage-collecting node,
> for a short roster, and for a stale gateway on the far side. It names the other agent, which was
> online and reachable in all three cases, and names nothing that was actually broken. Most of a day
> went into the network path before the node was suspected, because the error pointed away from every
> real cause. Whatever else is done here, **a roster that is below threshold must say so** rather than
> borrowing a word about the counterparty.


## 20. A retried message permanently kills the conversation it was retried in

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


## 21. Your agent stops accepting sessions and is never told which limit it hit

**Designation: `DOD-CAP-SELF-HEAL-1`** — ❌ **OPEN.** Unranked. **Proposed slot: high — it takes an
agent offline for conversations, it is invisible from every surface, and it gets worse with every
restart until nothing connects.**

**What it costs a customer.** Their agent simply stops being reachable by someone it was talking to
fine an hour ago. No error, no warning, no entry in any status output. The other side gets a session
that appears to open and then silently absorbs everything sent into it. Restarting the daemon —
the obvious thing to try — **makes it worse**, for the reason below.

**Two defects, and they compound.**

> ### ✅ (a) FIXED 2026-08-17 — and it was a SYMPTOM, which matters more than the fix
> `DOD-CAP-SELF-HEAL-1` (cello-client `d5be086`, beta only) took both halves: an interruption is now
> labelled with WHO caused it, so our own restarts and the operator's kill switch stop being charged
> to the peer; and an interrupted session untouched for 2 h stops counting whatever the label, which
> is the half that clears an existing backlog — attribution only works forward, and every row written
> before the column existed reads NULL. The bound is now *concurrent, with amnesty at every restart
> and after 2 h*, rather than all-time. D18 survives because the disconnect-evasion attack is a RATE:
> churn faster than the window and everything you churn is recent and still counts.
>
> **But the caps were never the disease.** The cap filled because interrupted sessions have no exit —
> and 114 of 118 of them came from our own shutdown sweep, not from any transport event. See
> [[2026-08-17_2036_interrupted-sessions-why-they-cannot-resume]] and item 21 above. **Do not do more
> cap work.**

**(a) A cap meant for LIVE sessions counts DEAD ones, and nothing reaps them.** The per-sender
bound is enforced by `countActiveSessionsForCounterparty`, whose SQL is
`status IN ('active', 'interrupted')`. An `interrupted` session is what a daemon restart leaves
behind — graceful shutdown marks every live session interrupted. They are never cleared, so **every
restart permanently tightens the limit** until an agent pair cannot open a session at all. Measured
2026-08-16: `CELLO_Coder_1` held **4 of an allowed 5** against `CELLO_Support`, of which the majority
were interrupted rather than live. The cap fired at 05:03 and the pair could not connect. Both agents
were on the SAME machine.

**(b) The refusal reaches nobody who can act on it.** Logged as `session.inbound.refusal.silent`,
reason `abuse_bound_sessions_per_sender`.

> **The outward silence is CORRECT and must be preserved.** A refused peer must not learn WHY it was
> refused — the tier design deliberately routes a BLOCKED sender through the same reason and the same
> path as an over-cap UNKNOWN one specifically so there is **no distinguishing oracle**. Do not
> "fix" this by telling the sender.
>
> **The INWARD silence is the defect.** The operator whose own cap was hit is told nothing, and is
> the only party who can clear it. Andre, 2026-08-17: *"when any cap is hit, the person whose cap is
> triggered should have been notified — a session was refused because you've hit your limit, do X to
> clear it. Without these kinds of affordances, an agent will have no idea how to solve its own
> problems, no idea how to self-heal."*

**The principle, which is bigger than this cap.** An agent cannot self-heal against a limit it is
never told it hit. Every cap in the system should be audited against this: when it fires, does the
party who owns the limit learn (1) that it fired, (2) which limit, and (3) the specific action that
clears it? Today this one answers none of the three. A cap without an affordance is an outage with
extra steps.

**What a fix needs, at minimum:**
- **Reap or exclude dead sessions.** Either interrupted sessions stop counting toward a live-session
  cap, or they are reaped on a schedule. Prefer excluding — an interrupted session is not evidence
  of abuse, which is what the cap exists to bound.
- **Tell the receiving operator, on their own surface.** A notification and a `cello status` line:
  which counterparty, which limit, how many are held, and the verb that clears it.
- **Keep the sender's view unchanged.** Same silent refusal, same non-distinguishing reason.
- **Cleanup must not force a false choice.** Today clearing an interrupted session is either a
  proper close (both sides sign, receipt kept) or `--force` (abandons it and FORFEITS the receipt).
  Sessions carrying 47, 81 and 104 real messages should not need their notarized receipt destroyed
  to unblock a cap.

**Related, same night, same shape:** items 16–20. A guard that refuses without telling the party who
could act is the recurring defect this list keeps rediscovering.


## 22. A document you were removed from dials its old readers forever, four times a minute

**Designation: `DOD-DOC-RECONCILE-TERMINAL-1`** — ❌ **OPEN**, but narrower than it was filed. The
2026-08-17 storm this item describes (321 dials in 85 minutes against two documents, 367 pieces of
content held on one daemon in one morning, two agents on one machine unable to hold a conversation
at all) was FIXED the same day it was found — removed-holder check + refusal backoff, verified live
(0 refusals, 0 held on a fresh session). **What's still open is the residual, not the storm:** a
much slower version of the gap still opens (2 holds per 20 minutes, down from 367 per morning), and
its root cause is the same stream-closed error tracked as M12B's top line (`DOD-M12B-ACK-1`) — not
a defect specific to this item. Unranked.

<details><summary>Full investigation — the three stacking defects behind the original storm, the
re-scope to "this is why messaging didn't work at all," and what was ruled out by measurement. Kept
for history.</summary>

**What it costs a customer.** Their agent starts opening conversations by itself. Session requests
arrive from agents nobody is driving, the operator's own agent keeps coming back online after being
stopped, and the notifications do not stop. Every one of these sessions is opened, refused, and left
lying around, so the per-sender session cap fills with junk — which is item 21, reached without the
customer doing anything at all. From the outside it reads as the product having lost its mind.

**Measured 2026-08-17 on one daemon, over 85 minutes: 321 document-sync attempts, against exactly
two documents, refused 321 times, zero successes** — about four dials per minute, each one
establishing a fresh session.

**It runs with nothing attending.** The sync worker lives in the daemon and fires on a timer. It was
observed dialing while all three agents on that daemon reported `attendance: 0` — no window, no
session, no operator action. Standing receivers on the same daemon then auto-accept, which is why
sessions appear in pairs between local identities and why an agent comes back online by itself.

**Three defects, and they stack.**

**(a) A terminal refusal is ignored.** The peer's refusal carries `"terminal": true` and says in
words *"there is nothing further to reconcile."* The sender asked **105 more times**. The flag that
exists to end the exchange is not read.

**(b) A holder that was REMOVED still tries to sync.** The same document reports this agent's
standing as `removed`, with the tool's own guidance stating that its edits no longer publish and the
others' no longer arrive. A removed holder has, by that definition, nothing to sync — and it is the
one doing the dialing.

**(c) A non-terminal refusal retries forever with no backoff and no ceiling.** The second document
refuses a would-be holder as not-a-party, deliberately marked non-terminal ("reconcile again after
your inviter's entries spread"). The admission never spread. **79 attempts**, fixed interval,
nothing escalates and nothing gives up.

**The fix.** Honour the terminal flag — retire that document/peer pair permanently on first receipt.
Never schedule a sync for a document whose local standing is `removed`. Give non-terminal refusals
exponential backoff and a ceiling that surfaces to the operator instead of a fixed-interval retry
with no end.

**Immediate mitigation used 2026-08-17:** taking the dialing agents offline stops it, because the
worker loses the ability to establish sessions. Deleting the dead document copy also stops it but
destroys the only remaining copy of its history, so it is not the default move.

---

### ⬆️ RE-SCOPED 2026-08-17, LATER THE SAME DAY — this was not a wasted-dial problem. It was why basic messaging did not work at all.

**Two agents on ONE machine could not hold a conversation, and this is why.** The entry above
described the dialing. The dialing was the engine; here is what it drove.

**What it cost, in one morning on one daemon.** **367 pieces of verified content held and never
shown. 8 released. 24 destroyed.** Two percent of what arrived was delivered. Both directions. No
error raised anywhere — each side saw an empty inbox and assumed the other had not written.

**The chain, measured end to end.**
1. Two documents could never reconcile. Refused **321 times in 85 minutes, 0 successes.**
2. The sweep never backed off, because it could only see whether the frame was SENT. **105 refusals
   carried an explicit terminal flag** and were asked again anyway.
3. Every attempt pushes ack frames, and **each frame takes a position in the CONVERSATION's
   sequence line** — deliberate, since a document sender that skips its leaf starves its own
   inbound. One session: **3 real messages, 41 document frames, 43 positions.**
4. The receiving side falls behind, and the strict-in-order gate **holds every later message**.
5. Nothing can ever say "I am missing position N, resend" — no such protocol exists — so a gap only
   closes by luck, and where held content was destroyed it **never closes**.
6. Each attempt also opens a session, which consumes the pre-warmed standing receiver and mints a
   replacement: **53 sessions → 63 receiver rebuilds.** The pre-warm design is correct; it was
   driven far past its intended rate.
7. And every session the worker opened **failed to seal** — 25 opened, 25 blocked — because a chain
   holding content cannot be co-signed. They never close, and they accumulate into item 21's cap.

**FIXED 2026-08-17** — cello-client branch `m12b/reconcile-removed-holder` (`0650181` removed-holder
check, `b1322c2` refusal backoff), full gate green. **Verified live on the fixed build: a message
delivered directly, 0 parked, 0 held on the new session, 0 refusals.**

**⚠️ RE-MEASURED 20 MINUTES LATER, AND THAT WAS A SNAPSHOT.** The same session then showed **2 holds
and 20 direct-send failures**. The refusal storm stays fixed (0, against 321) and acknowledgements
now work (31 sent / 31 acked, against 36 straight failures) — but **the gap still opens, just far
more slowly: 2 holds in 20 minutes instead of 367 in a morning.** This fix removed the ENGINE, not
the DEFECT, and this item must not be read as "messaging works now". Existing sessions carrying a
gap are NOT repaired and are not expected to be.

**Still open, and now the highest-value line in M12B:** messages were reaching the relay instead of
the peer because the direct send fails with `"Cannot write to a stream that is closed"` — the same
error, verbatim, as the 36 acknowledgement failures already recorded there. One defect in two
places; see `DOD-M12B-ACK-1`. Until 2026-08-17 that catch discarded its error, so **212 parks
recorded no reason at all** (`7d36cfb` fixes that).

**Three explanations killed by measurement — do not re-run them:** the standing receiver is NOT
being torn down excessively (6 genuine teardowns in 2.5 h); there is NO stale peer identity (opening
the stream succeeds — the failure is on the write); the connection is NOT missing or dead (the test
session logged `liveness: alive, path: direct` 9.5 seconds before its send parked).

**A THIRD document, and a lesson about half-states (2026-08-17).** Once the two broken documents
were dealt with, the largest single source of sync frames turned out to be a document that had been
**invited and never accepted** — 30 appearances against the stranger document's 15, and the removed
one's zero. A document sitting in a half-state is not inert; it generates traffic. Both
invited-never-accepted documents were refused the same day to quiet the spine. **The important
consequence:** with zero refusals and purely legitimate sync, the holds still appeared — so the
remaining defect is NOT an artifact of one operator's broken documents. Any session with enough
frames will reach it.

**Carried investigation, after the fixes are live (Andre, 2026-08-17):** document sync frames share
the conversation's sequence line. That is deliberate and is being **left alone for now** —
separating them changes what the tree contains, and the tree root is what the seal signs over, so it
risks existing receipts. But it is the condition that let a background sync failure strand
foreground conversation. **Re-open if any gap appears on a session after the flood fix is live.**

**Related:** item 21 (the cap this fills, reached with the customer doing nothing), and
[[M12B-DEFINITION-OF-DONE]] — whose founding diagnosis this corrects. M12B believed the positions
were burned by retransmissions; its planned submission-id fix would not have deduplicated these
frames, because each is a genuinely distinct send. That milestone could have shipped in full,
including a relay fleet roll, and two agents still could not have talked.

</details>

## 23. A document syncing in the background rings your doorbell — and your phone

**Designation: `DOD-DOC-QUIET-DELIVERY-1`** — ❌ **OPEN, traced 2026-08-17.** Unranked. **Raised by
Andre: "these kind of notifications should really go to the inbox and not to notification storms."**

**What it costs a customer.** Their agent lights up with "someone wants to connect" for sessions no
human opened — a document syncing in the background. During the 2026-08-17 storm those pings were
constant, and every one of them read exactly like a person starting a conversation. **They also go
to Telegram**, so a background document sync can push a notification to the operator's phone.

**The mechanism.** A session being created dispatches `session_state_changed` with `state:
"created"` and then `sendTelegramDoorbell(...)`. **Nothing distinguishes a session a person opened
from one the document delivery worker opened to push a frame.** The inbox already has the right
surface for this — `document_notices`, whose own guidance says *"Nothing is waiting on a reply"* —
but delivery does not use it; it rings the conversation doorbell instead.

**And there is a feedback loop, which is the more serious half.** The same code path, on
`state === "created"`, calls `reconcileScheduler.onReachable(...)` — which by design **resets the
backoff to zero** and immediately attempts a reconcile for every shared document ("a session coming
up IS the party-became-reachable signal"). So:

1. Document delivery opens a session.
2. Session creation resets the reconcile backoff and fires a fresh sweep.
3. The sweep delivers more frames, which opens more sessions.
4. Each one rings the doorbell and pushes Telegram on the way past.

**This partially defeats `DOD-SYNC-REFUSAL-BACKOFF-1`**, shipped the same day: a refusal now sets a
backoff, and the next session creation wipes it. Measured after that fix: **55 reconcile attempts in
20 minutes** despite the backoff being in place, though with zero refusals. The backoff fix is still
correct and still removed the refusal storm — it simply cannot hold against a reset it does not
control.

**DECIDED 2026-08-17 (Andre): exempt delivery-opened sessions from the reachability trigger.**
Chosen over the two alternatives that were on the table — rate-limiting the trigger, and stopping
delivery from opening sessions at all. Carried as `DOD-M12B-DELIVERY-QUIET-1` in
[[M12B-DEFINITION-OF-DONE]], with the full trace in [[M12B-BUILD-JOURNAL]] Entry 7.

**Why this option.** The trigger is correct in general and the code says why: a backoff models "they
do not answer", and a session coming up is proof they just did. That reasoning holds only when the
PEER opened the session. When delivery opened it, the signal is our own outbound act reflected back —
nothing is learned about the peer, and the backoff being wiped may be the one that peer's own refusal
set seconds earlier. Rate-limiting would blunt a trigger that is right; stopping delivery opening
sessions is a much larger change to how documents move.

**The trap, and the test that catches it.** The exemption must key on **who opened the session**, not
on what kind of frame is being sent. Key it on frame kind and a peer who dials in to sync stops
triggering a reconcile — which removes the very thing that makes sync prompt and trades a visible
storm for invisible staleness. That is the worse defect, because nothing reports it. The signal
already exists (`acquireSession` returns `sessionOpened: true` for a session delivery opened) and
needs threading, not inventing. Tests must assert BOTH directions: a delivery-opened session neither
resets backoff nor rings the doorbell; a peer-opened session still does both.

**How it is judged.** Re-run the 20-minute live measurement against the 55-attempts / 0-refusals
baseline, and confirm a document still syncs promptly after a peer comes back online. **Fewer
attempts with a matching rise in sync latency is the failure mode, not the success criterion.**

**Related:** item 22 (the storm this made unbearable), `DOD-SYNC-REFUSAL-BACKOFF-1` in
[[M14B-DEFINITION-OF-DONE]] (the fix this undercuts), and item 21 (the cap these sessions fill).

## 24. A message you already received is destroyed, and that conversation never recovers

**Designation: `DOD-M12B-STRAND-1`** (+ the resend-protocol scope call) — ❌ **OPEN.** Unranked.
**Proposed slot: at or near the top — this is content loss, not delay.**

**What it costs a customer.** Someone sends them a message. It arrives, it verifies, it is withheld
because it is ahead of what their side has counted — and then it is **deleted** when the session
tears down. Nothing recovers it: not restarting, not reconnecting, not asking the sender to resend.
From then on every later message in that conversation is withheld too. Both people see silence, and
neither is told anything is wrong.

**Measured 2026-08-17 on one daemon in one morning:** 367 pieces of verified content held, 8
released, **24 destroyed**. Two percent delivered.

**Why it is permanent, not slow.** Two things compound. Held content is memory-only and dies at
teardown — the code calls its own log line *"a LOSS REPORT, not a fix; the content is unrecoverable
by the time we are here."* And **no resend request exists** anywhere in the protocol: nothing can say
*"I am missing position N, send it again."* So a gap can only be prevented, never repaired.

**Two candidate fixes, and they are not equivalent.** Making holds durable is local and cheap and
turns "dead forever" into "recovers on reconnect". A resend protocol is a wire change and a fleet
roll. **Andre ruled 2026-08-17: build durable holds first, then re-measure before deciding whether
the resend protocol is needed at all** — the re-measurement criteria are written into
[[M12B-DEFINITION-OF-DONE]] under "Owed follow-ups".

## 25. Nothing checks that a message lands where the relay says it should

**Designation: `DOD-M12B-INDEX-1`** — ❌ **OPEN.** Unranked.

**What it costs a customer.** Nothing visible, until it costs them a receipt. The position a message
occupies is what the seal signs over, so if the two sides put the same message at different
positions, the conversation still reads fine and the tamper-proof receipt at the end is worthless.

**The mechanism.** The whole ordering design assumes a party's leaf index IS its relay-assigned
position — `session-node-manager.ts` names it "the leaf-index === sequence invariant" — and
**nothing enforces it**. The send path has the assigned position in hand and appends at the tail
regardless.

**Why it matters more after the 2026-08-17 findings.** Every defect in item 22 was a violation of
exactly this invariant that no code was watching for. This is the guard that would have caught the
whole class, and it is the difference between "we fixed the burner we found" and "a burner cannot
open a gap unnoticed again".

## 26. Your inbox says a session is waiting to be accepted when it was accepted already

**Designation: `DOD-M12B-INBOX-TRUTH-1`** — ❌ **OPEN, found 2026-08-17.**

**What it costs a customer.** Their agent looks at the inbox, sees sessions listed under
`pending_session_requests`, and reasonably concludes nobody accepted them — so it waits, or tries to
accept, or reports to its operator that the other side never answered. All of it is wrong. The
session was accepted before the notice was ever created, the messages are readable right now, and
`cello_await_session` only clears the notice.

**Cost measured today:** hours of investigation, and a confident report to the operator that the two
sides disagreed about whether a session existed. **They never disagreed.** The project's own skill
file already states it: *"Inbound sessions are auto-accepted by the standing receiver — there is no
separate accept step."*

**Fix.** Additive: per-entry `accepted: true` and guidance saying the session is already readable.
No wire change, no migration, no existing test broken.

## 27. An away agent answers in a way that reads as a person being there

**Designation: `DOD-M12B-AWAY-MARK-1`** — ❌ **OPEN, found 2026-08-17.**

**What it costs a customer.** They open a session and get a reply. The reply is an ordinary message
at a real position, so their agent treats it as contact and carries on — sending into a conversation
no human will read until whenever. Nothing in the payload says "this was a machine".

**Measured today:** two agents spent a morning exchanging each other's away auto-responders while
both sides looked live and both operators believed a conversation was underway.

**Fix, and the thing not to do.** Mark the reply so the receiving side can recognise it. Do **not**
remove the away path — it exists on purpose, and "reachable but nobody home" is a designed state.
The existing helper only runs on the sending side and cannot recognise a configured away message.

## 28. A dropped connection is never re-dialled, and the conversation quietly goes the long way round

**Designation: `DOD-M12B-REDIAL-1`** — ❌ **OPEN, found 2026-08-17.**

**What it costs a customer.** One connection blip — sleep, wifi change, a relay hiccup — and that
conversation silently drops onto the slow path for the rest of its life. Messages still arrive, up to
**five minutes** later, via a round trip to another region. Nothing tells either side.

**The mechanism.** Only the initiator dials, once, at setup. The send path never dials — it requires
an already-open connection. There is no re-dial anywhere: not when liveness goes to `gone`, not on
signaling reconnect, not on agent offline→online, not in the drain hook.

**Note:** this is NOT the cause of the 2026-08-17 parking (that is item 22's stream defect). It was
found while ruling that out, and it is a standing fragility in its own right.

## 29. Ending a session on your side leaves the other side calling forever

**Designation: `DOD-M12B-ABANDON-NOTIFY-1`** — ❌ **OPEN, found 2026-08-17.**

**What it costs a customer.** They clear out a stuck session. It disappears from their side. The
other party's agent never learns, keeps retrying delivery into it, and keeps re-dialling to
re-establish — so the operator who cleaned up now gets a stream of connection requests from agents
nobody is driving, with no way to tell where they come from.

**This is what produced the 2026-08-17 "notification storm"** that read as the system going berserk,
and it cost a long stretch of the day before the cause was understood. The existing guidance warns
that the receipt is forfeited. It does not warn that the far side will keep calling.

**Fix.** Either signal the abandon, or give the surviving half a way to detect and retire itself.

## 30. Sessions that can never close pile up until your agent stops accepting new ones

**Designation: `DOD-M12B-SEAL-STUCK-1`** — ❌ **OPEN, found 2026-08-17.**

**What it costs a customer.** Their agent gradually stops being reachable, with no error and nothing
in any status output — item 21's cap, reached without them doing anything at all.

**The mechanism.** A session holding content cannot seal, correctly: a chain with a gap cannot be
co-signed. But there is no path OUT — it can neither seal nor be destroyed, so it stays open
forever. **Measured 2026-08-17: 25 sessions opened by the document worker, 25 seals blocked, 0
closed.** Every one holds a slot against the per-sender bound.

**Depends on** item 24 (durable holds). A session that can resolve its gap can seal; one that cannot
needs a defined exit.

## 31. The daemon can refuse to shut down

**Designation: `DOD-M12B-SHUTDOWN-1`** — ❌ **OPEN, found 2026-08-17.**

**What it costs a customer.** They stop CELLO. The command reports it did not complete. The process
keeps running with its socket already removed — so every tool says the daemon is down while it is
still up, still opening outbound sessions, still writing to the database. Restarting cleanly requires
finding and signalling the process by hand.

**Measured 2026-08-17:** `cello logout` timed out at 5 seconds; the process was alive **30+ seconds**
later and the log shows it was still running document reconcile **sweeps during shutdown**. It took a
signal to exit. A shutdown that keeps starting new outbound work is not draining.

## 32. An error message tells you to do the wrong thing, and following it fails forever

**Designation: `DOD-M12B-SIGNAL-GUIDANCE-1`** — ❌ **OPEN, found 2026-08-17.**

**What it costs a customer.** A send is refused. The refusal explains exactly what to do. Doing it
produces the identical refusal — every time, with no other clue. The obvious conclusion is that the
product is broken.

**The mechanism.** `cello_send` requires a `signal` parameter (`over` / `standby` / `wrap`). The
refusal says *"Every cello_send message must end with one of: [[OVER]] …"*, which reads as an
instruction to append a token to the message text. It is not.

**Measured 2026-08-17: six consecutive failed sends** across two agents and three sessions, initially
diagnosed and reported as a protocol defect. The guidance must name the parameter.

**Related:** this list's recurring finding — an error that names its exit point rather than its cause
— applied to guidance rather than to a reason string.

## 33. Closing a conversation fails about a third of the time, and the receipt is gone for good

**Designation: `DOD-RELAY-DIRECTORY-CONNECTION-LIFECYCLE-1`** — ✅ **PROVEN LIVE 2026-08-21.** See
the top-of-list block above for the occurrence: a real connection went stale two days after the roll,
was evicted and redialed (`eviction: "evicted"`, `recovered: true`), and the seal riding on it
returned a receipt. The description below is the original diagnosis and stays accurate as history —
it is what made the fix possible.

**Original entry, OPEN as measured 2026-08-19:**
**This is `DOD-RELAY-DIRECTORY-RECONNECT-1` (item 14) recurring after it was marked ✅ on 2026-08-08.**
The redial that item added is real and does run. It is not sufficient.

**What it costs a customer.** They finish a conversation and close it. Nothing comes back for eleven
minutes, then the close reports a timeout. There is no receipt, on either side, and there never will
be — the transcript stays permanently one leaf short of sealable. Nothing before the close warns
them: every message sent, every message arrived, both agents looked healthy the whole way. The
product's central promise is a notarized record of what was said, and it is the closing act — the
only moment the promise is redeemed — that fails.

**Measured across 49 seal attempts, 2026-08-18 05:00 → 2026-08-19 09:30 UTC:**

| | attempts | relay found its connection to the adjudicating directory CLOSED |
|---|---|---|
| Rejected | 38 | **38** |
| Sealed | 11 | **0** |

No exception in either direction.

**What "closed" means, precisely, because the word has misled this investigation twice.** The relay
asks its held connection for a new stream and libp2p answers
`connection_lost: The connection muxer is "closed" and not "open"`. That is a statement about an
object in the relay's memory. **It is not a statement about the directory.** At every one of those
moments the directory was up, serving other clients, notarizing other sessions and answering lookups;
a TCP probe from inside the relay container reached all three directories on 8080. **No directory was
ever down. This is a connection-lifecycle defect in the relay process, not a directory availability
problem** — and reading it as the latter is what sent two separate investigations to the wrong tier.

**The measurement that rules out an idle timeout.** On 2026-08-18 the same relay process sealed
successfully through `gcp-usc1` at **07:58:03** and was refused by the same directory at **08:00:11**.
No restart, no deploy, and nothing touched that connection in between: **128 seconds from working to
closed, while idle.** Age-based and idle-based explanations are dead. So is "it goes bad and stays
bad until restarted" — that success sits between two failures.

**The fallback is not a fallback.** When the brokering directory's connection is closed, the relay
retries against `relay_primary_directory`, which is `gcp-use1` for both relays. The relays could not
reach `gcp-use1` on **any** attempt for over ten hours on 2026-08-18 — 220 failures an hour, logged
the whole time. The backup path was the most reliably broken connection either relay had. Two of the
four observed customer-visible failures died there rather than at the broker.

**Nothing connected the alarm to the consequence.** `relay.directory.connection.stale` fired roughly
**220 times an hour for more than ten hours** and no one saw it. The signal was not missing; it was
unwatched and unattached to any user-visible meaning. Meanwhile `relay.health.check.passed` was green
throughout — that is the *directory* checking whether the relay's machine answers, the opposite
direction, and it can never go red for this. Two investigations cited it as evidence the relay was
fine. **It should be renamed to say which side it tests.** This is item 17 (`nothing watches
anything`) with a concrete, already-emitting signal to hang an alert on.

**Symptoms of this item, filed here so they are not raised as separate faults:**

- `session_incomplete` with `missing_leaves: 1`. When the relay refuses a seal it stops forwarding,
  so the counterparty's closing leaf never arrives and every retry reports incomplete.
- `seal_unilateral_timeout` after eleven minutes.
- A counterparty answering `session_already_sealed` for a session no node ever notarized.

**Two things that are NOT this item and need their own fix:**

1. **The unilateral escalation, the promised backstop, failed 3 for 3** with
   `unilateral_root_unverifiable`. The eleven-minute wait tells the operator in capitals that it
   "escalates to a unilateral seal and produces a real receipt. It is working." In all three observed
   cases it produced nothing. Five separate checks return that one reason, so the log cannot say
   which failed.
2. **A close can report failure on a session that sealed.** On 2026-08-19 session `21eebf70` was
   notarized at 07:19:25.686 (root `a50c1c53`, receipt present on both machines) and a second close —
   entered at 07:19:24.641, before the seal landed — read the status once as `active`, spent 2.4
   seconds reconnecting, and by the time it looked the session had been sealed for 1.4 seconds. It
   never re-read, waited the full eleven minutes, and reported a timeout. Its recovery pull came back
   `missing_certificate_fields` from a certificate that was already in its own database. This is
   deterministic, not intermittent, and it is the reason a "failure" count can include a session that
   worked.

**What is NOT known, and what would settle it.** Why the connection object closes. The relay logs the
corpse and never the death — there is no libp2p connection-lifecycle logging on the relay at all, so
we cannot tell whether the directory closed it, the connection manager pruned it, or a timeout fired.
`relay.directory.redial.outcome` (deployed 2026-08-19 06:15 UTC) separates the three candidate
mechanisms on the next failure and has one sample so far, a recovery. **The missing evidence is
connection open/close events with peer and reason, on the relay.** Until those exist, any account of
the cause is inference.

**Do not read the current quiet as a fix.** Since the relay VMs were replaced at 06:15 UTC there have
been ten consecutive receipts. The old relay had a clean run of 2 hours 29 minutes on 2026-08-18 that
ended in failure. Nothing yet distinguishes "fixed" from "between deaths".

**Method note for whoever picks this up.** Report only connections the logs actually make. Two prior
diagnoses of this fault were wrong in the same way — a plausible narrative arc drawn between events
the data never linked. The 38/38 table above is a count, not a story, and it is the only part of this
entry that has survived an adversarial pass unchanged.

## 34. A transport hiccup can permanently kill a perfectly healthy conversation

**Designation: `DOD-M12B-TRANSPORT-FAULT-NOT-TERMINAL-1`** — ❌ **OPEN, found 2026-08-19 while
fixing item 33. Upstream of items 34 and 35 below, and the most valuable of the three — fixing this
one likely shrinks or removes the other two.**

**What it costs a customer.** Nothing was wrong with their conversation, their agent, or the
messages exchanged. The relay simply could not reach a directory at the moment it tried to notarize
the close — a two-second network blip, a directory mid-restart, a brief outage. The relay treats
that identically to "this seal is invalid, refuse it forever": the conversation is killed,
permanently, over a problem that had nothing to do with the conversation itself.

**The mechanism.** `rejectSeal` (`relay-node.ts:728`) terminalises the session unconditionally on
every path that reaches it, with no branch for "the failure was transport, not merits." M12 Tier
P5's eviction fix (item 33) removes one PRODUCER of the transport fault that trips this line — a
stale libp2p connection. It does not touch the shape of the bug: any future transport hiccup (a
directory rolling, a capacity outage, an ordinary network blip) still arrives at the same
unconditional kill.

**Why it is upstream of items 35 and 36.** If a transport fault left the session active and
retryable instead of dead, there would be no falsely-terminal row for item 35 to misreport, and
nothing for item 36's recovery path to need to find. It is the root; the other two are downstream
symptoms of not having this fix.

**What "fixed" looks like.** `rejectSeal` distinguishes a transport failure (could not reach a
directory) from a merits failure (the directory examined the seal and refused it), and only the
merits case terminalises. A transport failure instead leaves the session active, so the client
retries rather than believing it is over.

## 35. The relay has one word for "sealed" and one word for "gave up," and they are the same word

**Designation: `DOD-M12B-TERMINAL-REASON-1`** — ❌ **OPEN, found 2026-08-19 while fixing item 33.**

**What it costs a customer.** Two sides of the same dead conversation get told two different
stories, and both are behaving correctly given what they were told. One side believes it holds a
receipt. It holds nothing.

**Measured on session `df2a2a08`.** The relay refused that seal at 04:53 on a transport fault (item
34). The counterparty's next status check got back `session_sealed` — the SAME string the relay
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

## 36. The one safety net for item 35 has never once caught anything

**Designation: `DOD-M12B-PULL-NEVER-RECOVERS-1`** — ❌ **OPEN, found 2026-08-19 while fixing item
33. Needs investigation before any fix — not a quick patch.**

**What it costs a customer.** When a client suspects the counterparty might hold a receipt it was
never told about (exactly item 35's situation), it can ask the network directly: "does anyone have a
certificate for this conversation?" That mechanism is the only thing standing between "the relay
said sealed but lied" and "the receipt is gone for good" — and right now nobody knows if it works.

**Measured on this machine's daemon log, 2026-08-19:**

| event | count |
|---|---|
| `seal.certificate.pull.not_found` | **157** |
| `seal.certificate.pull.recovered` | **0** |
| `seal.certificate.pull.malformed` | 1 |
| `seal.certificate.pull.timeout` | 1 |

157 attempts, zero recoveries. Built for `DOD-TERMINAL-STATE-DIVERGENCE-1` — exactly the shape of
item 35's failure — and every invocation has come back empty. Either the certificates genuinely are
not there (which points back at items 34 and 35), or the recovery path cannot find records that do
exist. Both are real problems; neither is "it works."

**The trap to avoid.** Do NOT read a `not_found` as proof no certificate exists and start
auto-repairing a terminal row on that signal. Homing moves (`relay.seal.redirected` /
`seal_initiator_not_local` is in this machine's own logs from the same day), the record may sit on
another consortium node entirely, and a grace window may not have elapsed. Treating absence as proof
would risk destroying a genuinely terminal state — strictly worse than the divergence it exists to
repair.

**What "fixed" looks like.** First, establish WHICH of the two explanations above is true — that is
its own measurement, not assumed. Only then does a fix make sense: either the pull is asking the
wrong place, or there really is nothing to find and items 34/35 are where the fix belongs instead.

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

# Addressed — off the open list

**Moved to [[launch-triage-archive]] on 2026-08-21** (20 items, ~1,150 lines) to keep this file a
working punch list rather than a history. Everything there is dispositioned — fixed, deployed and
verified, or withdrawn as never having been a real defect. Nothing was rewritten in the move; it's
the same text at a new address. Check there before re-filing something as new.

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

---
