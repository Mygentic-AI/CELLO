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
  DOD-SEALED-INBOX-2 (shared consumers); ranking not yet decided. Same day, after a cross-check with
  Miss_Chelly (daemon side, M12-P13/P14): item 12 gained a second entry point (counterparty_unknown,
  78 of 121 loops) and an agreed disposition policy; added DOD-TERMINAL-STATE-DIVERGENCE-1 (item 13),
  also unranked — sessions that strand on incompatible terminal STATE rather than divergent leaves.
  2026-08-08: added DOD-RELAY-DIRECTORY-RECONNECT-1 (item 14), also unranked — the relay silently
  loses its directory connection, never reconnects, and passes its health check while sealing nothing
  fleet-wide. Restored by a manual restart; the defect is untouched.
  2026-08-09: added six. DOD-IPC-DISCONNECT-VISIBLE-1 (15) — every connection open is logged and no
  close is. DOD-AGENT-SELECTION-UNWARRANTED-1 (16) — a session bound to an agent it never selected,
  now with a SECOND reproduction failing the opposite way (a reconnect dropped a selection that had
  been made). DOD-WITNESS-STALL-1 (17) — a conversation can silently stop being recordable while
  every message still delivers; measured at 12 held against 6 witnessed, frozen 68 minutes; proposed
  at or near the top. DOD-HEARTBEAT-REPLICATION-1 (18) and DOD-SIGNAL-REPLICATION-1 (19), previously
  footnotes on item 14, filed as faults in their own right. DOD-DOC-PROFILE-1 (20), the
  agreed-but-unenforced content profile. And the verification half of DOD-TERMINAL-STATE-DIVERGENCE-1
  (21) — interrupted-session sealing is shipped and has never once been proven.
  2026-08-09 (later): DOD-WITNESS-STALL-1 moved to Addressed the same day it was ranked #1 — cause and
  symptom fixed, published and proven live, recovery built. A finished item must not hold the top slot.
  Open items renumbered again; DOD-SEALED-INBOX-2 is now item 1. Residual work sits on item 12.
  2026-08-09 (pre-compaction pass): DOD-RELAY-DIRECTORY-RECONNECT-1 corrected to ✅ — it was deployed
  and verified on 2026-08-08 and the marker never moved for a day. DOD-TERMINAL-WAKE-1 moved to
  Addressed, fixed 2026-08-06 and left in the open list for three days. Added a standing
  BUILT-BUT-NOT-SHIPPED banner at the top of the open list, because green here means the code is
  fixed and says nothing about whether an operator has it — the close-time seal pull is committed and
  unpublished right now. Renumbered again.
  2026-08-09, RANKING CHANGED (Andre): `DOD-WITNESS-STALL-1` is now **item 1**. `DOD-LOGOUT-EXIT-1`
  held the top slot while already fixed and has moved to Addressed — a finished item at the top of a
  ranked list hides whatever is actually next. Open items renumbered contiguously; the four filed
  today shifted from 18–21 to 17–20. Cross-references use designations, not numbers, so they survive
  this.
  2026-08-09 (end of day): DOD-DOC-TYPES-1 SHIPPED and promoted (daemon 0.0.152 / connect 0.0.136)
  and moved to Addressed — filed and closed the same day; open items renumbered again and the list now
  ends at 18. Building it found three live defects that were not what the item was about: plaintext was
  admitted with a dead diff, and a JSON document would have flip-flopped forever between two key
  orderings, each side publishing the other's rendering back as a real signed edit.
  2026-08-09: added DOD-DOC-JSON-1 (item 21) — agents can share prose but not STRUCTURED data, which
  Andre identifies as the use case shared documents exist for. Refused at both ends today because it
  was half-built and losing content silently; building it is three verbs plus a per-key merge.
  2026-08-09 (overnight): DOD-SEALED-INBOX-2 corrected to ✅ — it was the top open item and it had
  ALREADY BEEN LIVE for three days, shipped in the daemon 0.0.134 cascade. Verified by unpacking the
  published daemon@latest, not by reading the branch. That is the third entry this week to sit ❌
  while fixed, so the pattern is now the finding: **an item's marker here tracks whoever last edited
  this file, not the code.** Before trusting any ❌, unpack the published artifact.
  2026-08-10 (later): DOD-END-ISSUER-REGISTERED-1 moved to Addressed — fixed, reviewed and deployed
  to the portal the same day it was raised. It was marked ✅ IN PLACE and left sitting at the bottom of
  the ranked list, which is the same failure as leaving a ❌ on finished work: the list stops being a
  list of what to do. **Marking is not moving.** Open list now 12.
  2026-08-10: DOD-TGDOOR-1 REMOVED from the list (Andre) — we are not doing the on-a-real-phone
  proof; the doorbell rides Telegram and that is what we rely on. Moved to "Left off this list on
  purpose" with the reasoning, not to Addressed, because it was never fixed — it was declined.
  DOD-EMAIL-STUB-FORK-1 moved to Addressed, fixed the same day it was found. DOD-ACCOUNTS-CHAIN-1
  narrowed: the defect is fixed, deployed and the data measured clean on all three nodes, so the only
  thing still open on it is that verifyChain is on no health surface. Open list now 13.
  2026-08-10 (later): added DOD-EMAIL-STUB-FORK-1 as item 1 — the fork alarm, once taught to name its
  table, found a real one on its first round: one email key bound to two different accounts, one node
  disagreeing with the other two. Junk row deleted on all three nodes and the alarm is quiet. Tracing
  WHY the domain was in play at all found DOD-OTP-RATELIMIT-KEY-1 (item 13): signup throttling counts
  5 per DOMAIN per hour, so unrelated gmail users would block each other at launch, while the counter
  is in memory and resets on every deploy. Also established what `email_domain` was for — nothing
  grants on it, it was a pre-V30 leftover, and its only live use is that rate limiter.
  2026-08-10, STRUCTURAL PASS: EIGHT finished or withdrawn items were still sitting in the ranked
  list, three of them fixed the night before and never marked. All eight moved to Addressed and the
  open list renumbered contiguously 1–12. Moved: DOD-SEALED-INBOX-2 (which held the TOP slot),
  DOD-SIGNALING-LIVENESS-1, D-ENVVAR, the plugin dead-end, "online does not mean reachable" (both
  halves), DOD-RELAY-DIRECTORY-RECONNECT-1, DOD-SIGNAL-REPLICATION-1, and DOD-SIGNAL-STATUS-
  REPLICATION-1 — the last as WITHDRAWN, not fixed: it was filed on a reading of the raw status
  column and the three nodes in fact return identical answers, so it was never a defect.
  Also corrected four stale claims INSIDE items: the relay item told you a deploy was owed under its
  own ✅ header, the accounts-chain item still asked for a deploy that had happened (its real residual
  is one row, reserved for Andre), the seal-certificate pull read "not yet published" a day after it
  shipped, and the BUILT-BUT-NOT-SHIPPED banner listed versions long superseded. The banner is now a
  standing instruction to verify against the artifact rather than a snapshot that goes stale.
  2026-08-10, VERIFICATION PASS over all 12 open items, against the published tarballs, the running
  instances and the live databases — never the branch. FOUR were already fixed and shipped: the
  shutdown doorbell (item 4), the document content profile (item 11, which landed THREE DAYS BEFORE
  the item was filed), and both halves of the agent-selection item's asked-for diagnosis (item 9).
  ONE was never true as written: item 8 says no connection close is ever logged, and Andre's own daemon
  log holds 3,300 of them, emitted since 2026-06-12 — the real residual is that the line names no
  client type and no agent. ONE item's blocking residual is GONE: the accounts-chain repair reserved
  for Andre (item 2) is unnecessary — the chain was recomputed by hand on all three live databases,
  11 rows each, valid everywhere including the node that held the bad row. Confirmed still open and
  accurately described: items 3, 5, 6, 7, 10 and 13. Added item 14 (`DOD-END-ISSUER-REGISTERED-1`) —
  item 12's open question, answered, and the answer is the fail-open one.
  Banner corrected twice in the same pass: it listed the BETA versions under the word "promoted", and
  its directory tag went stale within the hour when the fork-alarm roll landed mid-verification.
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

**Designation: `DOD-TERMINAL-STATE-DIVERGENCE-1`** — 🟢 **THE CURE IS BUILT 2026-08-09.** A close
that fails now ASKS the directory whether the seal already happened, and returns the receipt if it
does. Detail at the end of this item; the history below is kept because it is what made the shape
legible.

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

**`DOD-DOC-REBUTTAL-1` is the paired deferral** (Andre, 2026-08-05, slipped to M14B): a peer's
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

## Anyone can vouch for their own agent using a key they made thirty seconds ago

**Moved here 2026-08-10.** Raised, decided, built, reviewed and deployed the same day — it never
needed to sit on the ranked list overnight. Body carried across verbatim below.


**Designation: `DOD-END-ISSUER-REGISTERED-1`** (M10B) — ✅ **FIXED, REVIEWED AND LIVE 2026-08-10.**
Raised, decided, built, reviewed and deployed the same day. Filed from the verification pass on this
list; it is the answer to the open question that used to sit on the same-operator item, and the answer
was the fail-open one.

> **Live** as portal image `portal-6ac77b8` (Cloud Run rev `cello-portal-00011-z49`, 100% traffic),
> verified by grepping the pulled image rather than by trusting the build. Portal-only — no migration,
> no wire change, no client cascade, no node roll.
>
> **The review caught a blocker inside the fix, and it was worse than the defect.** Refusing an
> unresolvable issuer is terminal — the submission is deleted. But the lookup stopped at the FIRST
> directory node, and a newly registered agent exists on only one node for about a minute. So an
> operator who endorsed someone shortly after registering would have had that endorsement
> **destroyed outright, with neither side told** — roughly two times in three. The original defect
> minted something wrong; this would have silently thrown work away. Now every node is asked before
> anyone is called a stranger. **The identical bug had already taken sign-in down on 2026-08-07**, and
> the write-up was sitting a few lines above the function nobody had moved.
>
> Shipped with it: a refusal now actually **reaches the agent that submitted it**. Every rejection
> reason had been written only to the portal's own private table, so from the operator's chair an
> endorsement was accepted and then silently ceased to exist.

**What an operator can do today.** An endorsement is one agent vouching in writing for another — the
thing a stranger reads to decide whether to trust you. Endorsing your own second agent is supposed to
be caught: the portal compares the two, finds one account or one verified phone behind both, and
stamps the endorsement so the recipient is told in plain words that it is one person vouching for
their own agent and is worth nothing as independent corroboration.

**The stamp is skipped entirely if the endorser is nobody.** Submitting an endorsement requires no
registration at all — proving you hold *some* key is enough, unlike starting a conversation or
requesting a connection, both of which check. So: make a fresh key, never register it, sign an
endorsement of your own registered agent, send it. The agent being endorsed resolves (that side IS
required to be registered); the endorser does not resolve, because it is not anybody. The comparison
that needs both sides never runs — and the answer that comes out is a clean **"not the same
operator"**, not "cannot tell". The endorsement is minted, notarized, and that false answer is frozen
into it permanently. Repeat as often as you like.

**What the counterparty sees.** Nothing. The warning paragraph is expressed by its ABSENCE, and the
endorser is shown to them only as `peer-claimed` — no name, no key. They cannot tell an endorsement
from an established agent with a long history apart from one written by a key minted during the
conversation.

**Why it is currently harmless, and why that is not much of a softening.** Nothing acts on the count
yet — the "minimum number of endorsements before you may talk to me" feature is deliberately switched
off, correctly, because nobody has endorsements on day one. That is the entire mitigation: the
feature that would be exploited is off. The moment it is switched on, the fabricated endorsements are
already notarized and permanent.

**The fix, decided by Andre 2026-08-10 and built the same day: the endorser must resolve too.** Both
parties must already be registered agents in the directory, or the same-operator answer has no teeth.
An unresolvable issuer is refused by name rather than minted, mirroring the refusal the subject side
already gets. Refusal rather than a flag, because a flag would assert "these two are one operator" —
exactly what cannot be known when one side is unidentifiable.

**The test that matters is the revert test.** Asserting "it was rejected" would have passed WITHOUT
the fix, because the old behaviour also produced a result — it minted one. So the load-bearing
assertion is that nothing reaches the notary at all; run against the unfixed code it fails with the
endorsement already notarized. That is the exploit reproduced in a test rather than described in a
paragraph.

**One property this depends on, worth stating because breaking it turns the fix into an outage.** The
lookup returns "not registered" only when the directory says so; an unreachable consortium raises an
error and leaves the submission queued. So refusing on "not registered" cannot refuse a legitimate
endorsement while the fleet is down. Full detail, including the defense-in-depth option deliberately
not taken, is on the DoD line.

**Not demonstrated against a running system** — traced through code and confirmed in the directory's
own comments. Worth knowing because "you cannot manufacture standing out of your own machines" is an
argument we make in writing ([[shared-documents-objection-rebuttal]] argument 3), so it is the kind of
claim a technical evaluator probes directly.




## One email address maps to two different accounts, depending on which node you ask

**Moved here 2026-08-10 — FIXED THE SAME DAY IT WAS FOUND.** The junk row was deleted from all three
nodes (`DELETE 1` on each), leaving the one legitimate row identical everywhere. Verified after: the
fork alarm went silent and every round reports `0 planned / 0 pulled / 0 applied` — full convergence,
the terminal state this table had not reached since 2026-08-08.

**The row was garbage, not a real collision.** Its key was the bare domain `mygentic.ai` where a
SHA-256 address fingerprint belongs. Tracing every writer established that the live registration path
sends a proper hash — the signed capability field is *named* `email_domain` but has carried the
fingerprint since V30 — so no code path produces this. It was almost certainly written by hand
against the database. **Nothing needed fixing in the code.**

**Why it is still worth reading:** it is the only Tier-A fork the fleet has ever had, and it is what
proved the fork alarm works once it can name a table. It also cost a wrong call — see the corrected
claim on the trust-signal replication entry below.

<details><summary>Original entry, kept because the measurement is the evidence</summary>


**Designation: `DOD-EMAIL-STUB-FORK-1`** — ❌ **OPEN, found 2026-08-10** by the fork alarm, one round
after it was taught to name the table. Present since **2026-08-08**.

**What an operator would hit.** Sign-in asks "which account owns this email?". Two of your three
directory nodes answer `c9a1d4a0…`; the third answers `b2e1c705…`. Same key, two different accounts,
and nothing resolves it — these rows are insert-if-absent, so each node keeps the copy it wrote first
and neither can overwrite the other. Which identity you are treated as depends on which node your
client happened to reach.

**Measured on the three live databases:**

| Node | `mygentic.ai` maps to | Written |
|---|---|---|
| `gcp-euw1` | `b2e1c705-d1c9-47b0-8baa-dec29cef3bcf` | 2026-08-08 05:52:26Z |
| `gcp-use1` / `gcp-usc1` | `c9a1d4a0-4dd7-4653-99d0-a1dad607c396` | 2026-08-08 05:58:50Z |

Both accounts exist on all three nodes, so this is two accounts each claiming the same address, six
minutes apart, on different nodes — not a replication gap.

**A second defect is visible in that key, and it may be the cause.** `email_stub_hash` is supposed to
be a SHA-256 stub — the other row in the table is a proper 64-hex value. This one is the literal
string **`mygentic.ai`**, a bare domain. Something wrote a raw domain where a hash belongs. If two
different sign-ups both reduced to the domain, they would collide by construction, which would
explain two accounts claiming one key. **Establish that before repairing the row** — repairing the
data while the writer still produces domains just recreates it.

**Why it is ranked here.** It is the identity binding, it is silently wrong, and it is exactly the
class the portal's 2026-08-07 "ask every node and merge" workaround exists to paper over — that
workaround makes the disagreement invisible rather than resolving it. It is also the only confirmed
Tier-A fork in the fleet.

**Do not repair the row unilaterally.** Same reasoning as the accounts-chain item below: choosing
which of two accounts owns an address is a decision about someone's identity, not a cleanup.

---


</details>


## The inbox says sessions are sealed when they are not

**Moved here 2026-08-10.** It held the TOP slot on the ranked list while already live on operators' machines — the exact thing this list must never do.

**Designation: `DOD-SEALED-INBOX-2`** — ✅ **FIXED AND LIVE.** Shipped in the daemon `0.0.134`
cascade and on `latest` ever since; confirmed 2026-08-09 by unpacking the published
`@cello-protocol/daemon@latest` (`0.0.155`) — `ended_unread` is in `dist/`, `sealed_unread` is
absent from it entirely, each row carries its real `status` plus `notarized`, and the shipped
receptionist skill and agent both read the new field. **This entry stayed ❌ for three days after the
work was already on operators' machines** — the DoD line and this doc were both flipped on 2026-08-09.

**What it means from the operator's chair:** the inbox no longer tells you a conversation is
notarized when it isn't. Each ended conversation now says how it actually ended, and an agent
reading it is told in the payload — not just in prose it might skip — to check `notarized` before
ever repeating "this is sealed" to you.

<details><summary>Original problem statement, kept for history</summary>

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

</details>

---

## Dead signaling streams go undetected — build the liveness mitigation, timebox the trace

**Moved here 2026-08-10.** Root cause fixed and deployed; the mitigation this item asked for was deliberately not built because the cause it mitigated is gone.

**🟡 ROOT CAUSE FOUND AND FIXED 2026-08-06** — `9910ff12` + `259b4b59`, branch
`dod/accounts-chain-1`, DoD line opened as **`DOD-SIGNALING-LIVENESS-1`** in
[[M8C-DEFINITION-OF-DONE]]. The trace half landed first, so **the client-side liveness probe was
deliberately NOT built** — it would have been a mitigation for a cause now removed.
The mechanism: the directory's `#streams` delete guard (`get(pubkey) === stream`) protects the
NEWEST stream, not the one the client is using — so an agent's own second stream, on closing,
deregistered it while the first stayed open and kept answering pings. The heartbeat is
*structurally* blind to this (the ping handler never reads `#streams`), which is why it caught 42 of
3,556 stream deaths. The reviewer found the production trigger: the daemon's roster loop opens a
visiting connection to the agent's **own home node** and tears it down, so every sweep was a chance
to deregister. Three follow-ons carried forward on the DoD line (remove the trigger client-side;
evict on send failure — the only real liveness signal, currently discarded; and split the
`target_offline` label, which sent the original investigation at the wrong subsystem for 25 minutes).

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

## The Telegram sign-up messages give wrong or unclear instructions

**Moved here 2026-08-10.** Fixed 2026-08-09 and proven by Andre's own live registration through the bot.

**Designation: `D-ENVVAR`** — ✅ **FIXED 2026-08-09, PROVEN LIVE.** Shipped in ops-agent image
`ops-01b5fd5e` and confirmed by Andre registering through the bot himself.

**The previous "fix" had shipped a SECOND wrong command, and a test was pinning it.** `D-ENVVAR` was
recorded as fixed on 2026-07-07: it replaced "set `CELLO_REGISTRATION_TOKEN`" — an env var the CLI
reads nowhere — with **`cello register`, which is not a CLI verb either** (the registry names
`register-agent`). So the literal follower this rewrite exists for still hit an unknown command, and
had done since July. The defect was not unnoticed; it was *confirmed* by a passing test.

It also assumed a CLI the user had no way to have, and stopped at `cello status` — leaving a
registered agent Claude Code could not see, because nothing mentioned the plugin or the `--channels`
flag. **The message is now the whole cold-start path in four steps** (install → create + register →
plugin + `/mcp` reconnect → channels), pinned by tests including a negative match on `cello register`
not followed by `-agent`.

**One near-miss worth keeping:** the ops-agent asserts an exact schema version at startup and calls
`exit(1)` on a mismatch, at `min = max = 1`. It was pinned at 57 while the nodes were at 62 — drifting
for nine days, logging a warning nobody read. **Shipping the copy fix alone would have taken the
registration bot down**, and it is the only thing that issues a registration capability to a human.
Bumped in the same apply.

<details><summary>Original problem statement, kept for history</summary>

The registration bot tells a new user to set something that doesn't exist, among a few other unclear
or inconsistent messages along that flow. A literal first-time follower gets stuck with no next
step. Not a security issue — a bad first impression. Fixing it is tedious rather than hard: several
message rewrites plus the tests that check the exact wording, in one repo.

Same class as the plugin-install item below — a first-time user hits a dead end with wrong or no
instructions. The two want one pass.

</details>

---

## Installing the plugin strands a new user at `daemon_not_running` with no signpost

**Moved here 2026-08-10.** Fixed 2026-08-09; shipped in connect 0.0.137 and promoted.

**Designation:** [[2026-07-30_1423_cello-claude-code-plugin-and-channels-allowlist]] — ✅ **FIXED
2026-08-09**, shipped in `connect 0.0.137` and promoted.

**It was worse than "a dead end with no signpost".** With no daemon, `cello-mcp` wrote one stderr
line and exited, so the MCP server showed as **failed and there were no `cello_*` tools at all** — a
new user never even reached a tool error that could explain anything. That one line said "run
`cello login`", naming a binary the plugin does not install. **There was no test on that path**,
which is how it survived; there is now one that spawns the real built binary against an empty
`CELLO_DIR`, including an ordering assertion that the install instruction precedes `cello login`.

The message now names the install, the `/mcp` reconnect, and the setup skill.

<details><summary>Original problem statement, kept for history</summary>

**Narrowed 2026-08-04:** the launch-sized item is the failure path, not the install.

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

</details>

---

## "Online" does not mean reachable

**Moved here 2026-08-10.** Both halves are done — the diagnosis surface and the state word — shipped in daemon 0.0.155 / cli 0.0.162 / connect 0.0.139 and promoted.

**✅ BOTH HALVES FIXED AND PROMOTED 2026-08-09** — the diagnosis surface (`b22cfd5`) and the state
word itself (`d4247c1`), shipped in `daemon 0.0.155` / `cli 0.0.162` / `connect 0.0.139`.

**What an operator gets.** `online` now means somebody is actually there to answer. An agent that is
running but has no attendee reads **`unattended`** — a real operational condition that used to be
invisible and that caused a live defect: `DOD-WITNESS-STALL-1` happened precisely because BOTH sides
were unattended, both away responders fired, and the away flow ends a session, so two agents sealed a
conversation nobody was having. And an unreachable directory is now named on the surface an operator
actually runs, with counts (`reachable / declared / required`) and the time the reading was taken.

**Two things this broke, both invisible to the compiler, both caught and fixed before publish.**
Narrowing `online` silently changed the meaning of every `state === "online"` check **because the
string stayed valid** — `cello settings set` began refusing healthy agents. The answer is
`isAgentRunning`, exported from the daemon: it answers the question callers actually have — *may I
claim this agent, or did the operator stop it* — and includes `connecting`, because a directory still
coming up is normal a minute after registering and local commands never needed one. **Never
re-introduce a bare `state === "online"` to mean "usable".** The second was reading signaling status
from the per-agent map only, ignoring the shared-manager path, so every agent read `connecting`.

**One rung is BUILT and deliberately NOT EMITTED.** `unregistered` is in the type but `hasFrostShare`
is hardcoded true, because the truthful signal is whether the DKG left a FROST share, and every test
fixture creates agents without one — switching it on relabels ~29 tests, and the alternative
(fabricating share material in fixtures) plants fake crypto material a later reader takes for real.
Turning it on is a one-line change and NOT a second wire change.

**Spin-off, still open and filed nowhere else: the daemon does not auto-start agents.** `cello login`
does it afterwards, so a daemon spawned by the MCP shim leaves every agent unable to receive
anything — and `stopped` does not yet strictly mean "you stopped it".

<details><summary>The full design record and the original evidence, kept for history</summary>

Two things kept the cause hidden:

- **`directory_endpoints_unresolved` was on the MCP `cello_status` tool only** — not on the
  daemon-wide status the CLI `cello status` prints, which is the one an operator at a terminal runs
  and the one that was run during the incident. Both surfaces now build from the same block, and a
  test asserts they are equal so they cannot drift apart again.
- **It was empty at the moment it mattered.** The startup sweep resolves the roster at boot, logged a
  partial/none COUNT, and discarded which node failed and why. Nothing else resolves a roster until a
  ceremony runs, so the block stayed empty through exactly the window where someone whose sessions
  are all failing goes looking. The sweep now keeps its findings and seeds the routing store. A later
  sweep REPLACES the seed, so a recovered node drops out rather than lingering as a stale complaint.

**The state word — design SETTLED with Andre 2026-08-09 and BUILT the same day.** It touched the most
surfaces of anything outstanding (the shipped skills, the Hermes assets, the CLI, every test keyed on
`=== "online"`), so it got its own change and its own review.

Today: `AgentState = "registered" | "online" | "current" | "load_failed"`. `current` is already
redundant — selection is a separate `selected` boolean, so a state value for it is two sources of
truth for one fact. The agreed ladder, worst-fact-first, every value a fact about THAT agent:

`load_failed` → `unregistered` → `stopped` → `paused` → `connecting` → `unattended` → `online`

- **`unregistered`**, not `local_only` (Andre): "local only" describes a symptom that could equally
  be a failure to reach the directory. State the fact — it has never been registered.
- **`stopped`**, because the only way in should be that you stopped it. **It is not true yet:** the
  daemon does NOT auto-start agents (`daemon.ts:389`); `cello login` does it afterwards via
  `autoStartAllAgents`. When the daemon is spawned by the MCP shim instead — whenever Claude Code
  starts with no daemon running — nothing starts the agents, so they read as stopped when nobody
  stopped them, and none of them can receive anything. **Spin-off: start agents on daemon boot, not
  only from `cello login`.** Own fix; same shape as the class this item is about.
- **`unattended`** — ready to receive, nobody home to answer. Its own rung because it is a real
  operational fact that was invisible: `DOD-WITNESS-STALL-1` happened precisely because BOTH sides
  were unattended, both away responders fired, and the away flow ends a session. The word already
  means this in our own vocabulary.
- **`online`** — ready AND at least one attendee. The final good state, per Andre.

**`isolated` was proposed and REJECTED (Andre) — and the objection kills the idea, not the word.** A
consortium below threshold affects EVERY agent equally, so it was never a property of an agent;
stamping it on each one attributes a system fault to the wrong thing. It moves to a daemon-level
block, stated exactly, because the counts are what answer the question:

```
"directory": { "reachable": 1, "declared": 3, "required": 2, "state": "below_threshold" }
```

`ok` (all reachable) · `degraded` (some unreachable, still ≥ threshold — sessions work, redundancy
reduced; its own value so the field does not cry wolf for the case that is fine) · `below_threshold`
(no session can form). **`below_threshold` reuses the exact string of the error the operator already
sees** when a session dies, so status and error share one vocabulary instead of needing translation.

**The accepted trade:** an agent can read `online` while `directory.state` is `below_threshold`. That
is correct attribution, and it only avoids the original lie if the directory block is impossible to
miss — so `cello status` must LEAD with it whenever it is not `ok`, rather than leaving it a field
partway down a JSON dump.

---

The original entry, kept because it is the evidence:

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

</details>

---

## The relay stops being able to notarize, never recovers, and reports itself perfectly healthy

**Moved here 2026-08-10.** Deployed and verified 2026-08-08; it sat in the open list for two days after the deploy.

**Designation: `DOD-RELAY-DIRECTORY-RECONNECT-1`** — ✅ **DEPLOYED AND VERIFIED 2026-08-08.** Both
relays rolled to `relay:0cf04b0c` node-by-node (use1 19:37 UTC, euw1 19:41), each registered with all
three directories after its roll, and a real cross-machine session sealed on each before the next was
touched. Recorded in `infra/GCP-STATE.md`. This line stayed 🟠 for a day after the deploy because
nobody updated it — the deploy happened, the marker did not move.

**Still open underneath it (2026-08-09):** the health check written here asks *"can this relay reach a
directory"*. It does NOT ask *"is the chain still growing"*, and those are independent — see the
witnessing stall in Addressed, where witnessing froze while the directory link was fine. A check that
cannot go red for the failure being suffered is not a check for that failure.

- **The reconnect** — `0d9568a5` (Miss_Chelly). `#openDirectoryStream` redials a stale connection
  and retries once instead of refusing the seal, and the dial errors are logged instead of being
  discarded by an empty `catch {}`.
- **The noticing** — `relay-service-lifecycle.ts` + `bin/relay.ts`. `/health` reports whether this
  relay can reach a directory rather than a constant built at startup, and a 30s probe asks while
  nobody is watching. The probe runs the SAME transport a seal runs, so it repairs the connection on
  the way; a probe over any other route can be green while the route that matters is dead.

  **It ALWAYS answers 200, and that is deliberate — the first version did not, and it was
  dangerous.** `/health` is what the directories poll to decide relay POOL MEMBERSHIP, and
  `defaultPingFn` counts any non-2xx as a failed check. A 503 on "cannot reach a directory" would
  have withdrawn relays for a fault that does not stop them carrying sessions — and since the cause
  is shared, all relays fail together and the pool empties. That converts *conversations cannot be
  sealed* into *conversations cannot be started*, fleet-wide: strictly worse than the incident this
  item exists to fix, and the same shape as the pool-emptying outage found the same day (relays
  publishing a public health URL behind a VPC-only port). Degradation is reported as
  `status: "degraded"` plus the directory block in the body, and as
  `relay.directory.connection.lost` at ERROR. **If an autohealer should ever act on this it needs
  its own signal that pool membership does not read — never this status code.**
- ~~**Still owed: the deploy.**~~ **DONE** — both relays run `relay:0cf04b0c`, which carries this and
  the "never answer non-2xx" correction below. Verified 2026-08-10 from the running instances. This
  bullet contradicted the item's own ✅ header for two days.
- **Not addressed:** splitting `directory_unavailable` into distinct reasons at every call site
  (partially done — `directory_not_connected` now separates our own wiring from the network), and
  `relay.seal.broker.unreachable` still logs a WARNING on the success path.

**What a customer experiences.** They finish a conversation and close it. Nothing comes back. No
error, no receipt, no explanation — the close simply hangs for about seven minutes and then reports
a timeout. Every subsequent conversation does the same, for every user, on every machine, until an
operator notices and restarts a server by hand. The receipt is the product; this makes the product
produce nothing while claiming to be fine.

**Measured 2026-08-08.** Three conversations sealed normally between 06:43 and 06:57 UTC. From 09:23
onward, nothing sealed at all — five attempts across two machines, cross-node and same-machine,
documents and plain chat, on two different client builds. A relay restart at 11:07:45 fixed it
immediately: the next close returned a notarized receipt (`ff534c48…`). Between those points nobody
deployed anything and nothing on the network changed.

**Why it took a morning to find, which is itself part of the defect.**

- The relay logs `relay.seal.broker.unreachable` as a WARNING on **every seal, including successful
  ones** — it fired 4 seconds before the seal that worked. Both agents chased it as the cause.
- `directory_unavailable` is one string covering opposite failures: the relay's own node reference
  being absent, a dial timeout, and a non-Error throw. One of those is a bug and one is the network,
  and they want opposite fixes.
- **The health check cannot see it.** It returns `{status:'ok', relayId}` statically. A relay that
  cannot notarize a single session passes every probe, so nothing alerts and no autohealer acts.
- Three plausible causes were proposed and each was disproved by measurement: the schema migration
  (three seals succeeded on it an hour after it deployed), the replication threshold
  (`availableNodes:1` was already true *during* the working seals), and a dial backoff window (one
  attempt came 67 minutes after the previous one and still failed in 1ms).

**What the evidence says it is.** The failure is instantaneous — 1 millisecond from
`broker.resolved` to `unreachable`, and 1 more to `rejected`. Nothing goes on the wire. Meanwhile
the same relay keeps serving client traffic normally throughout, so it is not globally out of
capacity. It is one connection — relay to its configured directory — that is established at boot
(`connect(relayResult.node)` in `bin/relay.ts`, right after node startup), works, dies silently, and
is never re-established. There is no reconnect, no keepalive, and no health check on it.

**The fix has three parts, and the first two are the ones that matter:**
1. **Re-establish the connection instead of failing forever.** Whatever drops it will drop it again;
   the missing recovery is the actual defect.
2. **Make the health check test what the relay is for.** A relay that cannot reach a directory must
   fail its probe, so the autohealer replaces it instead of leaving it up and mute.
3. Split `directory_unavailable` into distinct reasons, and stop logging a warning on the success
   path.

**Related but separate, both found the same day and both still open:** directory nodes do not
replicate `last_heartbeat_at`, so every node counts itself as the only live one
(`availableNodes:1` against `requiredThreshold:2`) and federation checkpoints have never succeeded;
and `signal_records` anti-entropy fails every round on a `scanner_version` NOT NULL violation.
Neither causes this item — both were disproved as the cause by measurement — but both are live
faults. Miss_Chelly owns them.


## Trust-signal replication fails every round, and the fork alarm climbs

**Moved here 2026-08-10.** Fixed, deployed to all three nodes, and verified against the live databases.

**Designation: `DOD-SIGNAL-REPLICATION-1`** — ✅ **FIXED, DEPLOYED AND VERIFIED IN PRODUCTION
2026-08-09.** Directory image `aa31516a`, all three nodes rolled.

**What an operator gets now:** a trust signal minted on any node reaches the other two. Before this,
which signals a counterparty could see depended on which of the three directory nodes their client
happened to pick — and nothing said so.

**Verified on the live databases, not from the logs alone.** All **17** `signal_records` rows are now
present on all three nodes with byte-identical hashed content, and **every** Tier-A table has
identical row counts across the fleet (profiles 14, seals 93, notarizations 94, attestations 186,
claim codes 4, …). Tier-B is converged too (presence 2900 rows / 4 online, suspensions 0 on all
three). `antientropy.apply.failed` was still firing at 20:33:09Z mid-roll with the exact not-null
message and has fired **zero** times since the last node came up, across hundreds of rounds.

**The cause was one missing column.** `scanner_version` is `TEXT NOT NULL` with no default and was
absent from the Tier-A spec; `applyTierA` inserts exactly the spec's columns, so every apply failed
by construction. Fixed by adding it to the hashed set — it must be hashed, not merely carried,
because it is the submitter's unverifiable scanned-clean assertion and is forgeable outside a
signature. A new static guard replays the migrations and fails any Tier-A spec that omits a column
the schema requires; across all 18 tables it finds exactly this one.

**⚠️ THE FORK ALARM WAS RIGHT, AND MY "IT IS NOISE" CALL WAS WRONG — corrected 2026-08-10.**
It was firing on a **real fork in `account_email_stubs`**, filed below as its own item. It is not
this item's defect, and it is not caused by the fix above; it has been there since 2026-08-08.

**How I got it wrong, because the method is the lesson.** I dumped all 17 Tier-A tables off two nodes
and reported them byte-identical. The dumps were fine; **my comparison was not.** Each table's rows
came back as one multi-line block, and the script split the whole output on newlines, so it kept only
the FIRST row of every table and silently discarded 651 lines. The forked row sorted second. Diffing
the raw files — which I had on disk the whole time — shows the difference immediately. **A verifier
that drops data silently is worse than no verifier: it produced a confident all-clear.**

**The alarm could not have told me, and that is the fixed part.** It reported counts and never the
table, so the only way to answer "which table" was a database-wide diff — the very thing I got wrong.
`round.completed` and `fork_suspected` now carry an `unconverged` breakdown naming the tier, table
and per-table counts, plus a plain-language reason distinguishing a genuine Tier-A fork from a benign
Tier-B merge. Shipped in directory image `63f7c4e5`, all three nodes. **It named the table in the
first round after the first node came up.**

<details><summary>Original problem statement, kept for history</summary>

`signal_records` anti-entropy has never worked: **1530 consecutive apply failures**, every one
`null value in column "scanner_version" violates not-null constraint`. The column is NOT NULL and is
not in the replicated set, so every apply fails by construction.

**What an operator would see.** Trust signals present on the node that minted them and absent
elsewhere — so which signals a counterparty sees depends on which directory node answers. The fork
alarm climbing (39 consecutive at the time of measurement) is a consequence, not a separate fault,
and it trains whoever watches it to ignore a real fork later.

</details>

**A second defect was found by the unit review and fixed the same night — the fix had ARMED it.**
`revokeSignal` writes a revocation as a row in `signal_records` carrying `is_tombstone=true`,
`status='revoked'` and placeholder fields; none of those columns is in the replicated set. Once apply
started working, a tombstone would land on the peers as `is_tombstone=false, status='active'` — a
revocation arriving as an **active notarization**, which would then satisfy the deliver gate's
load-bearing `AND is_tombstone = false` on two nodes of three. Nothing was corrupted only because
production holds no revocations yet. Fixed with a per-table wire filter and deployed in a second roll
(`1f9281f1`).

---

## A superseded trust signal still reads as current on two nodes out of three

**Moved here 2026-08-10 as WITHDRAWN, not fixed** — it was never a real defect and should not have been filed.

**Designation: `DOD-SIGNAL-STATUS-REPLICATION-1`** — ⬇️ **WITHDRAWN AS FILED, 2026-08-10. This was
NOT a user-visible defect and I should not have reported it as one.**

**What I checked, and what I failed to check.** I read the raw `status` COLUMN off the three
databases, saw 7 rows `superseded` on `gcp-euw1` and `active` on the other two, and reported that a
counterparty would get a different answer depending on which node they asked. **Nothing reads that
column for a decision.** Every consumer reads `signal_records_effective`, whose `effective_status`
DERIVES supersession from `supersedes_hash` — a column that IS replicated — via
`EXISTS (SELECT 1 FROM signal_records s WHERE s.supersedes_hash = r.signal_hash AND NOT revoked)`.
The stored column is only a fallback branch behind that.

**Verified 2026-08-10 on all three live nodes:** `signal_records_effective` returns **identical**
`effective_status` for all 17 signals on every node — 10 `active`, 7 `superseded`, row for row. There
is no divergence in the answer anyone actually gets.

**What is left is a stale bookkeeping column on the two replicas**, and it is worth one line rather
than an item: the origin node UPDATEs `status` when a signal is superseded, and that UPDATE does not
travel, so a replica's raw column reads `active` for a signal the view correctly calls `superseded`.
Harmless today because the view is the only reader. It is a **trap for a future reader** who queries
`signal_records.status` directly, and the honest place for it is a comment on the column, not a
ranked launch item.

**The lesson, which is the reusable part:** I read the storage and reported it as the behaviour. The
question was never "do the columns match" — it was "do the three nodes give the same answer", and
those are different queries. Check the view a consumer reads, not the table underneath it.

**Mechanically, why the column differs at all:** `status` is mutable, so it is correctly excluded from
the replicated set — revoking a signal must not change its hash, or the directory could never find
the signal it just revoked (V46). The origin node UPDATEs it; the UPDATE does not travel. The view
was built knowing this, which is why it derives the answer instead of reading the column.


## A write deleted a peer's edit it never saw — and the record called it deliberate

**Designation: `DOD-DOC-STALE-WRITE-1`** — ✅ **SHIPPED 2026-08-09**, `daemon 0.0.154`, promoted,
and **PROVEN LIVE across two machines** (laptop ↔ Hermes EC2): a stale write was refused naming all
three lines it would have destroyed, and read → re-apply → write then published first time.
Found by running the two-machine document test, not by reading code.

**What used to happen to you.** You read a shared document. You think for a minute. Your
counterparty's paragraph arrives during that minute — your copy gains it silently, which is the
feature working. You send your version back, and `cello_doc_write` takes the COMPLETE text, so the
version you read a minute ago no longer contains their paragraph. The daemon concludes you deleted
it and publishes that deletion, signed. **Both copies converge on it and neither of you is told.**

**Measured on the laptop's own log: their update admitted at `12:35:41.807`, the write that erased
it published at `12:35:42.033`.** A 226ms window, hit on the first HTML test anyone ran.

**The lost text was the smaller harm.** The documented way to REJECT a peer's change is to publish a
change reversing it — the same operation. Nothing distinguished them, so the signed record attributed
an accident as a deliberate rejection of your counterparty's work, in the system whose whole claim is
that the trail cannot be disputed later.

**What happens now.** If the document moved under you and your text would remove something you never
saw, the write is refused, and the refusal carries **what changed and the current text** — so you act
while it is still preventable, rather than your counterparty finding it gone hours later.

It stays quiet otherwise: if no peer update arrived since you last looked, your view is current by
construction and nothing is checked. And **a removal of something you HAVE read is allowed, and
recorded as deliberate** — which is the second refusal `[[shared-documents-objection-rebuttal]]`
argument 2 says the product lacks, now an explicit act rather than one inferred from an absence.

**The first attempt was wrong and two existing tests caught it.** Editing a line removes the old
line's text, so consulting only the read mark refused ordinary edits. A guard that fires on normal
work is worse than no guard, because it gets switched off. "Held" is now what you last read *or*
wrote, and the whole check is gated on whether anything actually arrived.

## Nested fields in a shared JSON document did not merge — one edit vanished

**Designation: `DOD-DOC-JSON-NESTED-1`** — ✅ **SHIPPED 2026-08-09**, `daemon 0.0.154`, promoted,
and **PROVEN LIVE across two machines**: concurrent edits to two flags inside one nested block, one
raised and one cleared, both survived and both copies ended byte-identical.
Raised by Miss_Chelly while assessing whether a JSON document can carry a multi-actor workflow.

**What used to happen.** Two people edit two different fields inside the same nested block at the
same time — one raises a settlement failure, the other clears a funds hold — and **one edit
disappears from both machines**, silently. A nested object was stored as a single opaque value, so
two writes to two fields were two writes to one thing.

**The asymmetry was the danger, not the depth.** The diff walks the full depth and reports dotted
paths, so every surface told you the structure was understood at field granularity — which invites
nesting exactly where several people write, and then names the field that vanished.

Nested objects now merge per key at any depth. **Arrays stay atomic deliberately** — element-level
merge interleaves two concurrent edits into an order neither party wrote, and an array's order is
content. The consequence is recorded rather than hidden: **a journal must not be an array**, because
two simultaneous entries lose one. Keyed as a map it merges for free.

**Still open, and it is a claim rather than code:** `append_only` is whole-document, and a workflow
record needs a mutable status — so the map shape buys ordering and merge but **not tamper-evidence**.
Nobody should be told "this keeps a tamper-evident audit trail" until field-level authorization or a
separate linked append-only journal ships.

## Document types: JSON and HTML were missing, and plaintext's diff was dead

**Designation: `DOD-DOC-TYPES-1`** (was `DOD-DOC-JSON-1`) — ✅ **SHIPPED 2026-08-09**, `daemon 0.0.152`
/ `connect 0.0.136`, promoted. Filed and closed the same day.

**What a customer can do now that they could not.** Share **structured data**. Two agents can hold a
JSON document and edit **different fields at the same time** — one sets `owner`, the other sets `due`,
both survive. That per-key merge is the entire reason to want structured data in a CRDT, and it is why
`json` could not simply be line-merged. `html` also lands, and a `text` document is finally written as
`.txt` rather than `.md`.

**Three defects were found while building it, all live in the shipped build at the time:**

- **`plaintext` was admitted and its diff was dead.** It could be proposed, accepted and co-edited,
  and `cello_doc_diff` answered *"this build renders diffs for markdown, text, json"*. Two type lists
  in two files had drifted and nothing failed. One registry now; every list derived.
- **A JSON document would have flip-flopped forever.** Key order in the CRDT is insertion order, so
  two peers holding an identical document rendered different files. Publish diffs the FILE, so a
  peer's key arriving reordered the whole thing and that reordering published as a rewrite of every
  line — each side sending the other's ordering back as a real signed edit, indefinitely. This would
  have surfaced on the first real use of the feature.
- **A re-ordered nested block counted as a changed value**, so a formatter's tidy-up published a
  change nobody made and beat the peer's real edit to that key.

All three trace to one thing: the CRDT determines the map STATE, not the STRING it is printed as.
Keys now sort recursively; **arrays never sort**, because an array's order is content.

**The design points settled with Andre, recorded so they are not re-opened:** schema-free for V1;
**CBOR considered and declined** — it buys canonical bytes the deterministic serialiser already gives
and costs the property that a human or an agent can open the file and read it; the serialiser is a
present-tense need rather than insurance, because the moment anyone quotes the document everyone must
produce the same bytes.

**And a pattern that needs no code — paste-and-agree.** A seal attests that messages were exchanged,
deliberately NOT that anyone agreed with them; the certificate says so itself, and agreement is meant
to be a separate signed act. Pasting the rendered document into a message and getting an explicit
"yes, I agree" back IS that act, and puts both statements in the sealed tree — attesting the VALUES,
not just the update chain.

**CORRECTED — do NOT carry the document's internal root hash, which is what this note first said.**
[[shared-documents-objection-rebuttal]] rules it out for launch and is right: a stable canonical root
is the deferred tier, so two copies that are semantically identical can still hash differently, and
both parties would go hunting a difference that does not exist. The deterministic serialiser shipped
in `DOD-DOC-TYPES-1` makes the rendered TEXT canonical; it does not make the internal root canonical,
and conflating the two is the mistake.

**Hash the pasted bytes instead.** The thing being agreed to is the text in the message, so hash
exactly that and put the digest in the message. "The text" is then unambiguous and tamper-evident
inside the sealed record with no canonicalization required. The receiver's job is to compare the
paste against their own copy before agreeing — and for JSON to parse both and compare structurally
rather than by eye, so formatting noise does not read as disagreement.

Full record: [[M14-DEFINITION-OF-DONE]] § `DOD-DOC-TYPES-1`, [[M14-BUILD-JOURNAL]] Entry 38.

**Moved here 2026-08-09** — fixed 2026-08-06 and left in the open list for three days.

## A sealed session's unread messages rang the doorbell as live work

**Designation: `DOD-TERMINAL-WAKE-1`** — ✅ **FIXED 2026-08-06** (cello-client `2bc0764` + `cdb8bc7`;
the second entry point was already shipped by M12-P17/P18 before this pass). **Both entry points are
now closed:**

- *Entry point 1 (this pass).* `cello_receive` already checked terminal first — but through
  `peekTerminalMarker`, reading `#sessionTerminal`, an in-memory Map written only by
  `destroySessionNode` and never loaded from the DB. The `sealed` row survives a restart; the marker
  does not, so the guard answered `null` and the durable read below it delivered the old message as
  live. **The restart was not incidental to the repro — it was the mechanism.** Now falls through to
  the durable status. Revert-tested across a real daemon restart: without it the suite fails with the
  `[[STANDBY EST:15m]]` directive delivered as live content — the live incident, reproduced.
- *`abandoned` had the same harm with no restart at all (review F1).* The committed guard in
  `#appendVerifiedContent` rejected only `sealed`/`seal_interrupted_pending`, so late content for a
  force-abandoned session was accepted — leaf appended, doorbell rung, away-response and Telegram
  fired. Fixed at the guard rather than the marker: suppressing only the delivery would leave the
  wake ringing with nothing behind it.
- *Entry point 2 was already done.* `sealed_session_annex`, the `session_committed` disposition
  (annex strictly before confirm-delete), the M12-P18 `counterparty_unknown` sweep, and the
  `actionable: false` operator-read surface all pre-date this pass. All four disposition constraints
  met.

Watermark untouched throughout — the seal attests what each side actually consumed, so the messages
stay honestly unread and in the notarized transcript. They just stop ringing the bell. Residual: the
annex field is named `post_seal_annex`, which is imprecise for an abandoned session (no seal to be
"post"); the guidance text is accurate, so renaming is deferred as a wire change with its own
migration.

**Original entry, kept for the record. Proposed rank: slot beside
item 2 (`DOD-SEALED-INBOX-2`), pending Andre confirmation — added 2026-08-06.** Same code surface,
different defect, meant to land in one pass. Ranked below `DOD-TERMINAL-STATE-DIVERGENCE-1`: this one
confuses (self-concealing false confidence) but the sealed transcript stays valid; nothing is lost.

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

**Second entry point, found 2026-08-05 — the disposition problem is twice the size it looks.** The
same never-terminal pathology reaches the mailbox by a second route. On the Hermes EC2 daemon,
`content.recover.ingest_failed` fired 121 times on two sessions, each looping one content hash
forever because verified-but-refused content is deliberately never confirm-deleted:

| reason | count | session |
|---|---|---|
| `counterparty_unknown` | 78 | `6aa3f24b…` |
| `session_committed` | 43 | `34a6edbf…` |

One defect, two guards. **Fixing only the `session_committed` branch leaves the larger half looping.**
The fix belongs at the disposition layer, not per-guard.

**Disposition policy — agreed with Miss_Chelly (daemon side, M12-P14) on 2026-08-05: confirm-delete
AND surface as inert history, in a post-seal annex outside the sealed tree.** Never discard silently
(that makes the loss quiet instead of noisy); never present as actionable. Four constraints, settled
in the same exchange:

1. **Inertness must be structural, not advisory** — the load-bearing one. The observed failure was an
   agent *obeying* a directive out of a sealed session. If the annex sits anywhere a wake path or an
   inbox count can reach, the bug relocates rather than dies. Not in any wake path, not in any
   pending total, never auto-injected into agent context; reachable only by explicit operator read.
   If "history is not a work queue" is a convention rather than a property of where the data lives,
   the next agent reads the field name and not the doc comment — which is exactly how
   `DOD-SEALED-INBOX-2` produced a false "it's sealed" claim relayed to an operator as fact.
2. **It must not borrow the seal's vocabulary.** Annex content is verified but not covered by
   `sealed_root` — a weaker evidentiary tier, needing its own word at the field name.
3. **Durable annex write strictly before confirm-delete.** A crash between them converts a noisy loop
   into permanent silent loss.
4. **Key on (recipient pubkey, content hash), session attribution optional.** `counterparty_unknown`
   cannot resolve a session, but the park envelope is signed (SEC-1) so the signer is still
   verifiable — and that key is what the relay mailbox already uses. This is what gives the 78
   unattributable entries a terminal disposition on the same path as the 43 attributable ones.

The annex must live outside the sealed tree: any post-seal append changes `sealed_root` and
invalidates the notarization. Confirmed on both sides.

---


**Moved here 2026-08-09**, the same day it was ranked #1 — cause and symptom are both fixed,
published and proven on live traffic, and the recovery is built. It should not hold the top slot
while finished; that is what hid the previous occupant. Residual work lives on item 12
(`DOD-TERMINAL-STATE-DIVERGENCE-1`): the pull is built but NOT yet in a published build, and nothing
asks on the daemon's own initiative — recovery needs an operator action, so a session stranded and
never touched again stays stranded.

## A conversation could silently stop being recordable

**Designation: `DOD-WITNESS-STALL-1`** — 🟠 **ROOT-CAUSED AND HALF-FIXED 2026-08-09.** The safety net
is shipped (daemon 0.0.149); the CAUSE is `DOD-TERMINAL-STATE-DIVERGENCE-1`'s missing pull twin and
is still open. **Ranked item 1 by Andre.**

**THE CAUSE, from the relay's own log — not inferred.** The session was SEALED three seconds after it
opened:

    01:13:34  seq 1 doc · seq 2 msg
    01:13:35  seq 3 doc · seq 4 msg · seq 5 CTRL · seq 6 msg
    01:13:36  seq 7 CTRL  →  relay.seal.broker.resolved  →  certificate built and delivered

Two distinct-sender CTRL leaves are exactly what triggers notarization. **Both agents were unattended,
both away-responders fired, and the away flow ENDS a session** — so each side submitted a seal ctrl
leaf within a second of the other. It froze at six because that is where the count stood when it was
sealed, not because six is a limit. Everything the two agents then discussed happened on a
conversation the relay had already closed.

**Neither daemon learned, because the seal completion is pushed with no pull twin** — that is
`DOD-TERMINAL-STATE-DIVERGENCE-1` (item 13), and it is not adjacent to this defect, it is half of it.

**THE SILENCE IS FIXED (daemon 0.0.149, tag v0.0.221).** The daemon knew all along: every send
submitted its leaf, got `session_sealed` back, logged
`session.relay.hash.submit.failed`, and continued — that branch treated every relay miss as a
transient degradation. Correct for a relay briefly unreachable, where the sequence is recovered
later; wrong for a seal, where there is no later. Terminal refusals (`session_sealed`,
`session_not_found`) are now enumerated, not pattern-matched, and FAIL the send with guidance naming
the cause. An operator now learns at their next send rather than at close, hours of work later.

**THE CAUSE IS ALSO FIXED NOW (daemon 0.0.150, tag v0.0.222), as `DOD-AWAY-MUTUAL-SEAL-1`.** The
trigger needs BOTH sides unattended at once — isolated by the counterparty session. Each away
responder answers the other's, and the second arrival looks exactly like "a caller who ignored the
leave-a-message instruction", so the one-shot rule fires on BOTH sides and each initiates a seal. The
one-shot is right about a human who keeps typing and wrong about another away responder. An away
auto-reply is now recognised and ends the exchange quietly instead of minting a seal.

Matched on EXACT text, never a substring — silencing a real message would be a worse failure than the
one being fixed — and the texts live in one place the sender and detector both read, because a second
copy is how a reworded away message stops being recognised and the loop returns. A wire marker is the
better long-term answer but is a wire change, and this fires precisely when talking to a peer we do
not control.

**THE ASKING IS NOW BUILT TOO (2026-08-09, item 13).** A failed close asks the directory whether the
seal already happened and returns the receipt if it does. So all three layers of this failure are
covered: the cause (away agents no longer seal), the symptom (a send that cannot be recorded fails
loudly), and the recovery (a stranded session can find its own receipt).

**WHAT IS STILL OWED:** nothing asks on the daemon's own initiative. Recovery is triggered by an
operator action — a close or a receipt read. A session stranded and never touched again stays
stranded, and there is no startup sweep.

**TWO HYPOTHESES KILLED, recorded so nobody re-runs them.** *A ceiling at six* — a control run on the
same relay build tracked exactly through 1, 2, 4, 6, 8, 10, 12 and sealed with `leaf_count: 13`.
*A daemon restart* — a restart INTERRUPTS sessions loudly and the client then refuses to send, so it
can never be the silent path (established independently by the counterparty session). The away
auto-responder, which both of us had dismissed, was the trigger.

**What a customer experiences.** They hold a long working conversation. Every message sends. Every
message arrives. Nothing warns, nothing errors, both sides look completely normal. Then they close
it — and there is no receipt, and there can never be one, because the chain stopped growing hours
ago. The work is already done by the time it announces itself.

**Measured 2026-08-09**, on a live session between two agents on this machine:

| | |
|---|---|
| Messages held by the operator | 12 |
| Leaves the relay had witnessed | **6** |
| Duration frozen | 68 minutes, across 8 further messages |
| Delivery during that time | `delivered: true` on every one, including the messages discussing it |

The first close attempt reported 7 held / 6 witnessed; an hour and five messages later it reported
12 held / 6 witnessed. **The relay was delivering and not witnessing** — the same path for a client,
evidently not the same operation for the relay. The seal is computed over witnessed leaves, so the
session cannot be notarized and force is the only exit, which forfeits the receipt permanently.

**Why this is worse than the outage it followed.** `DOD-RELAY-DIRECTORY-RECONNECT-1` (item 14) failed
LOUDLY: closes hung, nothing sealed anywhere, and two people knew within minutes. This one costs a
real conversation before it says anything.

**A CONTROL RUN RULES OUT THE OBVIOUS EXPLANATIONS, AND REPRODUCES NOTHING.** A fresh session on the
same relay build, sampled after every exchange rather than only at the end:

held/witnessed of one/one, two/two, four/four, **six/six**, eight/eight, ten/ten, twelve/twelve —
exact at every step, then sealed first time with `leaf_count: 13`.

- **Not a ceiling at six.** The control crossed six without pausing, minutes after the other session
  froze there.
- **Not "it never tracked".** Witnessing was exact from the second sample.
- **Not the away auto-responder.** The control had no auto-replies and behaved perfectly.

What survives is an **event attached to one session**. What the control does NOT do is reproduce the
failure, and a control that behaves is weaker evidence than a reproduction that misbehaves.

**The two candidate triggers**, both present in the failing session and absent from the control: it
survived a **daemon restart mid-conversation**, and it **opened with both sides unattended and
auto-replying**. The next experiment is a fresh session with a deliberate daemon restart halfway.

**The broken session is deliberately being left open and unsealed** as the only known artefact.

**This makes item 14's health check the wrong shape.** That check asks "can this relay reach a
directory". This failure asks "is the chain still growing", and they are independent: witnessing
froze while the directory link was fine and delivery stayed green. **The health check written for
item 14 would report the frozen relay perfectly healthy.** A check that cannot go red for the
failure being suffered is not a check for that failure.


**Moved here 2026-08-09.** It was ranked #1 while already ✅ fixed, which is the one thing a
ranked list must not do — the top slot is what gets worked, and a finished item sitting in it hides
whatever is actually next.

## Logging out said the daemon had stopped while it was still on the network

**Designation: `DOD-LOGOUT-EXIT-1`** — ✅ FIXED 2026-08-06 (cello-client `4dfc3cd`).
`onStopped({ok,error})` fires as `stop()`'s last act and the binary wires
it to `process.exit`; `daemonGone()` additionally requires the pid to be gone, not just handles;
`cello status` names `broken_shutdown`. Individual event-loop holders (Telegram poll, libp2p
teardown, untimed dials) remain follow-on work — the process-level kill switch is fixed, the
survivor list below is not yet exhaustively closed.

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

## Filed 2026-08-09 from the `DOD-SIGNAL-REPLICATION-1` unit review — three guard gaps, none armed

Recorded here rather than built, because none of them is live breakage and the two that were live
(the tombstone crossing as an active signal, and the parser dropping multi-`ADD COLUMN` clauses) were
fixed and deployed the same night. **These three are the ones deliberately left.**

**A. The required-column guard is blind to the class that produced the tombstone bug.**
`ae-spec-required-columns.test.ts` fails a Tier-A spec that omits a NOT NULL column *with no default*.
`is_tombstone` is `NOT NULL DEFAULT false` — semantically required, mechanically satisfied — so the
guard not only misses it, its own anti-vacuum assertion pins it as a column that must **not** be
reported. The right addition is a second assertion: every NOT-NULL-**with**-default column absent
from a spec must carry a written justification naming what supplies the truth on a receiving node.
Measured, the class is ~30 columns over 17 tables, and most fall into two mechanical groups
(surrogate `id`, arrival timestamps like `created_at`/`linked_at`/`attested_at`). The ones that would
need a real answer are `status` on `agent_profiles`, `authorized_issuers`, `signal_records` and
`directory_nodes`, plus `signal_records.is_tombstone` — which is exactly the set worth writing down.

**B. Tier-B has no equivalent guard at all.** `agent_suspensions.authorized_by_account` is
`UUID NOT NULL`, supplied from a body whose validator explicitly permits null. Unreachable from an
honest peer, but a hostile authenticated one sending null gets an uncaught throw out of `applyTierB`
— on the kill-switch table.

**C. Nullable-but-semantically-required columns replicate as NULL, unguarded.**
`directory_nodes.endpoint` is nullable and excluded, so a node learned purely by replication arrives
with no endpoint. Pre-existing and outside that diff; listed as the second example of the class in A.

**Also worth knowing, unrelated to the above:** 30 DB-backed directory tests fail against a local
Docker Postgres under `CELLO_ENV=local` (accounts-chain, account-001, MMR, federation-002,
internal-api-auth, pg-pool). **Pre-existing** — verified by running them at `532e5bbe`, before any of
that night's code. The default `pnpm run test` path skips them and is green at 1090.

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
