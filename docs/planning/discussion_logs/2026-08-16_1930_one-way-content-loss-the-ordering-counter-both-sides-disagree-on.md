---
name: One-way content loss — the ordering counter both sides disagree on
type: discussion
date: 2026-08-16
topics: [messaging, documents, ordering, content-held, delivery, relay, reconcile, m14b, launch-triage, diagnosis]
description: >
  A live diagnosis of basic messaging failing between two healthy agents. Content flows one way only:
  Miss_Chelly_H receives everything Coder_1 sends; almost nothing she sends is ever delivered. Her
  content DOES reach the receiving daemon and DOES verify — and is then held behind a sequence gap
  that can never close, because the number the gate depends on means something different on each
  side, nothing anywhere requests a missing sequence, and the hold buffer is memory-only and is
  destroyed on teardown. Includes the evidence, the exact mechanism, and why this is confirmation of
  the reconcile-don't-deliver diagnosis rather than a new problem.
---

# One-way content loss — the ordering counter both sides disagree on

## What a user experiences

You send a message. The other side gets it. They reply. **You never see the reply.** Their tool says
delivered. Your inbox is empty. Nothing reports an error to either of you.

You open a shared document. You see **only your own writing**. Their lines are not there and never
will be. Their side shows you as `sync: behind`, which is true and says nothing about why.

Restarting fixes nothing. Resending makes it worse.

## The shape: it is ONE-WAY

This was the finding that made the rest legible. It is not "messaging is broken". It is:

- **Coder_1 → Miss_Chelly_H: works.** Her transcript holds both messages sent to her, complete.
- **Miss_Chelly_H → Coder_1: does not.** Of six things she sent, two arrived, and one of those
  arrived carrying the wrong sequence number.

Same asymmetry on the shared document `93d17b00…d571a3`:

| line | author | on her copy | on his copy |
|---|---|---|---|
| 1 | Coder_1 | ✅ | ✅ |
| 2 | Miss_Chelly_H | ✅ | ❌ **absent** |
| 3 | Coder_1 | ✅ | ✅ |
| 4 | Miss_Chelly_H ("Fresh write") | ✅ | ❌ **absent** |

His copy contains exactly his own writes and nothing of hers. Read live, 2026-08-16 19:3x, after the
directory fault of the same day was fixed and all three nodes rolled.

## The mechanism, end to end

**1. Her direct send never lands.** Every message logs `content.delivery.ttf_expired` exactly 20 s
after `session.content.sent`, then parks at the relay. Every one, every minute. The direct path is
carrying nothing; the relay mailbox is carrying everything.

**2. His side pulls the park successfully.** `content.park.pull.result count=2 / 3 / 16` against
relay `12D3KooWJXHp…`. The content is there and it is retrieved.

> A second relay (`12D3KooWFpvG…`) is pulled by BOTH daemons and returns `count=0` every single time,
> and never receives a deposit. Wasted round trip, not the loss — the split-relay fix holds. Ruled
> out, do not re-chase it.

**3. It verifies, and then it is held.** For every arriving frame:

```
session.content.ordering.recorded
content.recover.verified          ← signature is GOOD
session.content.held              ← and it stops here, forever
```

with the reason in the payload:

```json
{"event":"session.content.held","canonicalSeq":19,"nextExpected":7,"gap":12,"screenedOut":false}
{"event":"session.content.held","canonicalSeq":21,"nextExpected":8,"gap":13,"screenedOut":false}
```

`screenedOut: false` — nothing was rejected on content or policy. The receiver simply refuses to
surface message 19 until it has message 7.

**4. The gap can never close.** The gate is one line — `session-node-manager.ts`:

```ts
const nextExpected = this.getSessionTree(agentName, sessionId).size();
if (canonicalSeq !== undefined && canonicalSeq > nextExpected) { /* hold */ }
```

`nextExpected` is **this side's own tree size**. It advances only by appending. Appending is what is
being refused. So once the tree falls behind the sequence being stamped on arrivals, every subsequent
arrival is held, the tree never grows, and the gap **widens with every new message** — measured going
12 → 13 within minutes. It is a deadlock by construction, not a race.

**5. Nothing ever asks for the missing piece.** There is no resend request, no negative
acknowledgement, no gap-fill, anywhere in the codebase. (`grep` for resend/backfill/nack across the
daemon and protocol-types returns only database-migration code.) The only repair path is "hope the
relay mailbox produces sequence 7". When it does not, the session is finished as a delivery channel
and neither operator is told.

**6. The held content is memory-only, and is destroyed on teardown.**

```ts
#heldContent = new Map<...>   // content is plaintext in memory only — evicted on teardown
```

Teardown logs `session.content.held.discarded` — a loss report the code itself describes as
"unrecoverable by the time we are here". **It fired 20 times on one daemon on 2026-08-16**, e.g.
`{agentName: "Miss_Chelly", canonicalSeqs: [9], treeSize: 8}`. Verified content, destroyed, one slot
short.

## The root cause candidate: the two sides do not agree on the number

The gate depends entirely on `canonicalSeq` meaning the same thing to both parties. It does not.

Same three messages, as each side numbers them:

| message | his transcript | her transcript |
|---|---|---|
| Coder_1's first | **1** | **4** |
| Coder_1's question | **5** | **14** |
| her "RCA noted" ack | **13** | **8** |

And the decisive one: at 19:3x he received a frame reported as **`sequence_number: 17`** whose text is
her message **12** verbatim. The number and the content do not correspond across the boundary at all.

`nextExpected` is a **local tree size**. `canonicalSeq` is supposed to be the **relay's** canonical
ordering (`#witnessedSeq`, DOD-MSG-4, "the RELAY is the ordering authority"). Comparing one against
the other is only valid if the two trees contain the same leaves in the same order. They demonstrably
do not — her tree runs 10+ ahead, because document frames append leaves on her side that never append
on his. **The gate compares a relay-assigned position against a local count and treats the difference
as a missing message.**

That is stated as the leading hypothesis, not as proven. What is proven is that the two numbers
disagree, that the gate is arithmetic on both of them, and that the disagreement is permanent.

## Why this is confirmation, not a new disaster

This is exactly the failure
[[2026-08-14_1155_document-protocol-reconcile-not-deliver]] predicts, in the terms it predicts it:
**two records disagreeing about the same fact**, and a per-recipient ledger that cannot repair itself.
Every element is here — the sender's ledger says delivered, the receiver's reality says nothing
arrived, the substitute signals (ttf expiry, park, retry ceilings) exist only to compensate for a
missing acknowledgement, and the "canonical sequence" that everything hangs on is not canonical.

Under **reconcile — ask what they have and send the difference** — a gap is not a stall. It is a
difference to close at the next contact, computed fresh from what each side actually holds, with no
counter to fall out of step. **This class of failure cannot occur in that design.** That is now an
observation backed by a live reproduction rather than an argument from reading the code.

## Caveat that must not be dropped

2026-08-16 involved heavy manual churn on both machines — daemon restarts, two gateway restarts,
logout/login on both sides, a bridge reinstall, and three directory nodes rolled twice — much of it
while sessions were live. **Sequence divergence is exactly what that churn would produce**, and no
evidence here separates "we churned both sides into this state today" from "this opens on its own".

The measurement that separates them is a **clean run on an untouched system**: fresh session, both
sides stable, nobody touching anything, and watch whether a gap opens. Until that runs, the mechanism
above is established and its *trigger* is not.

Also unresolved on the same day: two of three directory nodes had been going deaf for 40 s at a time
for six days (`DOD-NODE-HEAP-GROWTH-1`, `infra/GCP-STATE.md`). Every document conclusion drawn in
those six days was measured on that substrate.

## Related

- [[2026-08-14_1155_document-protocol-reconcile-not-deliver]] — the design this is evidence for
- [[launch-triage]] — items 16–19 filed the same day
- [[M14B-BUILD-JOURNAL]] — entries 37–46, the defects that prompted the reconsideration
