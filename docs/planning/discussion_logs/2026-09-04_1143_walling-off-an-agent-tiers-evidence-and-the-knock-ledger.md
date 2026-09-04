---
name: Walling off an agent — tiers, evidence, and the knock ledger
type: discussion
date: 2026-09-04
topics: [reachability, tiers, contacts, allowlist, abuse-bounds, evidence, quarantine, inbox, reporting, notifications]
description: Two poles — an agent that wants no callers and doesn't care who called, and one that wants no callers but does care — and why the current tier bounds can serve neither. The delivery cap is also the evidence budget, and there is no per-peer record of who keeps knocking.
---

# Walling off an agent

## The two poles

Andre, 2026-09-04:

> *You have a CELLO deployer who doesn't want to talk to anyone who isn't whitelisted. They also
> don't really care who's calling. Then you have my personal agent, which might not want to receive
> calls from unknown but would like to know who's calling. That sums up the two poles.*

And a third case that sits inside the first:

> *Even in the CELLO deployer agent we still want to know if some malicious agent using a certain
> identity key keeps on trying to contact us. We may want to take action and report them. So even in
> the zero case, we might want the minimal record. Minimal here doesn't mean a message from them. It
> just means evidence that they've reached out to us many times.*

So there are three distinct wants, and they are not the same setting:

| | Deployer | Personal agent |
|---|---|---|
| Let unknown callers **through**? | No | No |
| Let them **leave a message**? | No | Yes — that is how you learn who they are |
| Keep a record they **called**? | **Yes** — to report abuse | Yes |

The deployer's row is the one the current design cannot express. It wants the wall *and* the ledger,
and today the wall is what destroys the ledger.

## Who sets the bar

Settled: **the operator does.** Not us. The job is to make every value reachable on every settable
tier — including zero — and let the operator own the consequences. No `policy.admission` posture, no
hardcoded "allowlist means tier 3 and above," no second acceptance gate. `isAutoAccept` stays
unwired.

## What is in the way

### 1. Zero is refused twice

`bounds.<tier>.max_sessions` cannot be set to 0. The setter's validator refuses it, and — the part
that would bite anyone who only fixed the validator — the **reader refuses it too**: a stored 0 is
treated as corrupt and reverted to the grid default, with a warning. The operator would set the
control, see it stored, see it read back, and still be reachable.

Both rejections cite `INV-TIER-BOUND`, *"a setting cannot REMOVE a bound."* That invariant is about
`Infinity` — an unbounded tier. Zero does not remove a bound; it is the tightest one there is. The
rule conflated the two, and the reader's guard compounds it: for an upper bound, falling back to the
default is failing safe. For a lower bound, reverting 0 to 3 is failing **open**.

Zero is already load-bearing elsewhere — `blocked` is implemented as exactly `0 sessions / 0 bytes`,
and blocking "falls out for free" through the ordinary cap comparison. The mechanism works. It is
only the settings path that forbids reaching it.

### 2. The delivery cap is also the evidence budget

This is the finding that reframes the whole thing.

`max_bytes` currently does two jobs with one number: how much a peer may send you, and how much of a
refused message is kept as evidence. The quarantine store checks the same cap before retaining. So:

- Set it to **0** and a refused message is not merely undelivered — it is **not kept**. The log says
  so: *"this refused message was NOT retained... there is no evidence of it beyond this line."*
- At **any** cap, a message refused *for exceeding the cap* can never be retained, because the
  retention gate applies the identical test the message just failed. It is one of the three refusal
  exits that keep nothing, and structurally it has to be.

The code from `023-REFUSEDEVIDENCE` states the tradeoff outright: **"evidence and delivery share one
monotonic budget, and when evidence wins the conversation stops working."**

That collides with the rule set the day before:

> *Every case where there's something that potentially needs to be reported needs to be stored. It
> just doesn't make it to the LLM.*

Tightening delivery currently tightens retention by the same number. The more you wall an agent off,
the blinder it gets — which is backwards, because the walled-off agent is the one whose callers are
most worth recording.

### 3. There is no per-peer knock record

Two ledgers exist. Neither answers *"who keeps knocking?"*

- **In the inbox, has the pubkey:** an in-memory list, capped at 20 per agent, lost on daemon
  restart.
- **Durable, keeps 200:** records session id, reason, timestamp — **no pubkey**. Built to sweep
  parked content for declined sessions, not to identify callers. Surfaced nowhere.

Every knock gets a fresh directory-assigned session id, so 47 attempts are 47 unrelated rows and the
durable set cannot attribute any of them to a peer. There is no counter, no first-seen, no last-seen.

The cap alarm that would surface repeat pressure is deliberately **suppressed for blocked contacts** —
correct for a capacity alarm nobody can act on, but it means the peer you most want flagged produces
the least signal.

### 4. The stranger greeting points the wrong way

A caller who is not already a contact gets a one-word away reply: **"Dispatched."** The
"leave a message and it will be read when they return" invitation is sent only to known contacts. So
out of the box, a stranger is given nothing that would prompt them to say who they are — which is
precisely what the personal agent needs from them.

This one is configuration, not code: the per-tier away text for `unknown` is settable. It is simply
aimed wrong by default.

## Recommendation

**Split the one number into three things that are currently entangled, and do the ledger first.**

### Phase 1 — The knock ledger, and a notification class that never disturbs

**A refused caller never leaves nothing behind.** Andre, 2026-09-04:

> *I don't think it should maintain nothing. If the walled deployer is being contacted but it's
> always refusing because it's zero sessions, zero bytes, then we should at least maintain the
> metadata records — the public key, time, etc.*

So metadata retention is the **floor**, not a tier of service. At `0 sessions / 0 bytes` the caller
never speaks, and there is no payload to argue about — but the fact of the call, the key that made
it, and when, are always kept.

A durable per-(agent, counterparty) record: first seen, last seen, count, last reason. Content-free.

This is the piece that serves **both poles with one mechanism**, which is why it goes first:

- The deployer, walled to zero, gets *"this key has knocked 47 times"* and nothing else. That is the
  minimal record — evidence of contact, not contact.
- The personal agent gets the same line, plus whatever the caller left.
- It is the durable home for the caller's key, which today survives only in a 20-entry in-memory
  list.
- It is safe by construction: no payload, so no screening surface and no injection path.
- It unblocks reporting. A report needs *"this key, this many times, over this window"* — which
  nothing can currently produce.

#### The notification class: low priority means it never disturbs

> *Provide a kind of low-priority notification. Never disturbs you, but tells you if you check your
> inbox: you have 56 low-priority notifications — or you have 615, and 612 are from the same public
> address.*

Define it by what it must **not** do, because this codebase has a history of records leaking into
agent context by being shaped like work:

- **Never rings the doorbell.** No push, no wake, no Telegram ping. Pull-only, seen when the operator
  looks.
- **Never counts toward unread.** It is not a message and must not inflate anything that reads as
  one.
- **Never reaches agent context unasked.** A refused knock is not a to-do item.

#### Present the concentration, not the list

**615 notifications is noise. "612 of them are from one key" is the finding.** The aggregation is
the product here, not a compressed rendering of it. A flat list of 615 rows trains the operator to
stop looking, which is the same failure the per-session refusal dedup was built to avoid.

So the inbox section is a summary: the total, then the top callers by count with their keys, then
the long tail as a number. That shape reads the same at 6 and at 6,000, and the one-key-dominates
case — the abuse case — is legible at a glance rather than being something the operator has to
notice by scrolling.

It also gives the whitelist loop its natural surface: the key is right there in the summary row, so
*"this one is the person I gave my address to"* becomes a promotion, and *"this one has hit me 612
times"* becomes a report.

⚠️ **Implementation warning.** `cello_check_notifications` returns a flat object assembled at
several distinct `return` sites. A section added to one and missed on another is exactly the
`DOD-M12B-INBOX-TRUTH-1` defect — `refused_session_requests` was present on one branch and absent on
the other, so an agent with any ended-unread history silently stopped being told who it had turned
away. Every return path gets the new section, or none does.

**Depends on nothing.** Do it before making zero reachable, because zeroing sessions today throws
away the only surface that holds the caller's key.

### Phase 2 — Give evidence its own budget

Retention stops sharing the delivery cap. A refusal retains against an evidence budget, not against
the number that governs how much a peer may send.

This is what makes both poles expressible: the deployer can set delivery to zero and still keep
evidence; the personal agent can keep delivery tight without blinding itself. It also closes the
structural hole where a message refused for being too large can never be retained.

**Depends on Phase 1** only in sequencing sense — worth having the ledger's shape settled first so
the two records agree on how a peer is identified.

### Phase 3 — Make zero reachable

Allow `0` on `bounds.<tier>.max_sessions` for the settable tiers. **Both places** — the validator and
the reader that currently reverts it. Keep the refusal byte-identical to every other cap refusal, so
nothing new becomes a distinguishing oracle.

At this point the deployer is one setting: unknown sessions to 0. The wall is up, the ledger still
fills, and the operator chose the number.

### Phase 4 — Aim the stranger greeting

Change what an unknown caller is told, so the personal agent's answering machine actually invites an
introduction. Configuration only, and the wording is the operator's call.

## Deliberately not recommended

- **A `policy.admission` posture.** Ruled out: the operator sets numbers, we do not define a bar.
- **Wiring `isAutoAccept`.** It exists and is `tier >= whitelisted`, with a test that guards it
  stays unwired — if it gains a caller, tier acquires a second acceptance gate and every tier
  description ("tiers govern how much, not whether") becomes false. Zeroing a bound achieves the
  same outcome through the path that already exists.
- **Anything from the `ConnectionPolicy` / `CONNREQ` design.** The types exist — including a literal
  `whitelist` field and modes `open | closed | selective | guarded` — and the directory implements
  its half. **The client half was never written**; the evaluator appears only in comments and the
  daemon has no handler for an inbound connection request. It is a type and a fixture, not a
  feature, and it will read to the next person as a half-built allowlist.

## Open — the operator's call

~~1. The deployer's evidence budget.~~ **Settled 2026-09-04:** metadata is the floor and is always
   kept — key, time, count, reason. Payload retention is not part of the wall; at `0/0` there is no
   payload, and that is the intended shape rather than a limitation.

1. **Ledger retention.** Per-peer counters grow with the number of distinct keys that ever knocked.
   Cap by peer count, by age, or both? A key that knocked once two years ago and a key knocking now
   are not worth the same row.
2. **What the summary shows by default.** Top N callers plus a tail count — what is N, and is the
   tail collapsed by key or just counted?
3. **The stranger greeting wording.** Copy, and therefore Andre's.

## References

`session-node-manager.ts` — `resolveTierBound`, `checkUnknownSenderAcceptanceBound`,
`#quarantineRefusedContent`, `refused_sessions` schema, `isAutoAccept`;
`agent-settings-keys.ts` — `validateSettingValue`; `contacts-tier-migration.ts` — `DEFAULT_TIER_BOUNDS`;
`inbound-sessions.ts` — the inbound refusal path and cap alarm;
`daemon.ts` — `STRANGER_TEXT`; `notification-handlers.ts` — the inbox refusal list and its
multiple return sites (`DOD-M12B-INBOX-TRUTH-1`).
`DOD-M15-REFUSEDEVIDENCE-1` (closed 2026-09-04) for the evidence/delivery budget collision.
