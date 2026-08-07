---
name: tier-b-programme-state
type: discussion
date: 2026-08-07
topics: [anti-entropy, replication, tier-b, kill-switch, revocation, migrations, m12]
description: >
  State of the six-item replication programme after an overnight run. Four landed (V59–V61 plus the
  documentation reconciliation); two are deliberately unimplemented with the reason and the fix
  shape recorded. Nothing is deployed — the node roll is left for an operator.
---

# Tier B programme — overnight state

## What landed

| # | Item | State |
|---|---|---|
| 1 | `agent_profiles.account_id` → append-only link | **V59 committed** |
| 3 | The unassessed attestation pair | **V61 committed** |
| 4 | `user_accounts.email_stub_hash` → append-only fact | **V60 committed** |
| 5 | Reconcile the two contradicting documents | **Committed** |
| 2 | Revocation propagation | **NOT implemented** — see below |
| 6 | Remaining Tier B tables | **Assessed, not implemented** — see below |

Gate on every commit: full directory suite green (1285 tests), lint 0 errors, typecheck clean.

**Nothing is deployed.** Rolling the directory nodes is one-at-a-time with a real `GET /bootstrap`
200 between each; the threshold tolerates exactly one node down, and us-central1 hit
`ZONE_RESOURCE_POOL_EXHAUSTED` on 2026-08-06. That is not a thing to do unattended.

## Item 2 — revocation propagation. Worse than the original write-up said

The original finding was "revocation state doesn't replicate". Reading the code, it is worse than
that: **revocation replicates as corruption.**

Revocation is already append-only in shape — `revokeSignal` writes a tombstone row keyed
`(signal_hash, 'revoke:' + node)`. That row therefore has its own natural key and DOES replicate.
But `applyTierA` inserts only the spec's `immutableColumns`, and `is_tombstone`, `status`,
`revoker_pubkey` and `revoker_signature` are not among them. So on the receiving node the tombstone
lands with `is_tombstone` defaulted to **false** and `status` defaulted to **'active'**.

Two consequences, both bad:

1. The revocation has no effect — `signal_records_effective` decides revocation from `is_tombstone`
   and the revoker columns, none of which arrived.
2. The tombstone now counts as a REAL row in that view's aggregations, so its placeholder
   descriptive fields pollute `subject_kind` / `issuer_kind` / `type` for that signal — the exact
   thing `is_tombstone` exists to prevent, per the comment above the query that sets it.

### Why it was not fixed tonight

The obvious fix — add those columns to `SIGNAL_RECORDS_SPEC.immutableColumns` — is wrong. It changes
the content address of **every existing row**, so all three nodes would report divergence on data
that never changed. That is the trap V58 documents and sidesteps by creating a new table.

So the real fix is a new append-only table for revocation facts plus a change to
`signal_records_effective`. That view decides whether a trust signal reads as revoked, and its own
comments record two prior fail-open regressions in that expression:

> "an earlier version of this expression failed OPEN"
> "I re-introduced it while writing this migration and the regression test caught it"

A fail-open here means a revoked trust signal reads as live. That is not a thing to improvise
unsupervised at midnight, and the standing rule — a wrong replication rule is worse than none —
applies most sharply where the rule decides authority.

### The shape it should take

- New Tier-A table, natural key `(signal_hash, revoker_pubkey)`, all columns immutable.
- `signal_records_effective` consults it instead of the tombstone columns.
- The existing `signal_records` hashed set is left alone, so no historical row rehashes.
- `authorized_issuers.status` needs the same treatment: enrolment replicates today, **withdrawal
  does not**, so revoking a compromised issuer key leaves it active on every node that did not
  process the revocation.

## Item 6 — smaller than it looked, and one piece is not really item 6

The design named eight Tier-B tables. The accurate tally:

| Table | State |
|---|---|
| `agent_suspensions` | Built |
| `agent_presence` | Built |
| `directory_nodes` | **Solved differently** — moved to Tier A |
| `capability_claim_codes` | **Solved differently** — moved to Tier A, after it broke Telegram registration in production |
| `pre_authorization_tokens` | Not built — low value, see below |
| `sessions` | Not built — owner-wins, needs judgement |
| `pickup_queue` | Not built — see below |
| `pending_notifications` | Not built — see below |

**`pre_authorization_tokens` is low value.** The design's own note says the cross-node double-spend
window is unchanged by replicating it, because the nonce binder is the real gate. Replicating it
buys tidiness, not a security property.

**`sessions` needs a judgement call.** Owner-wins means the row's `owning_node_id` is authoritative
and non-owners insert-if-absent only. Reasonable, but it interacts with re-homing, and getting it
wrong means two nodes disagreeing about who owns a live session.

**`pickup_queue` and `pending_notifications` are the same question as the signaling audit's biggest
unknown**, and that connection is the most useful thing in this section. The cross-node signaling
audit flagged `#deliverOrEnqueue` as its highest-priority unclassified site: it degrades to a QUEUE
when no stream is present, which is the right shape — but the queue is node-local and an agent polls
its own home node, so a frame enqueued on the sender's node for a recipient homed elsewhere may
never be collected.

That is message delivery, and it cannot be fixed by the visiting-connection pattern that fixed the
seal — a queued item is collected later, when no transient connection exists. It needs either the
replicated queue this item describes (with the bounded-GC tombstone scheme, designed precisely so a
lagging peer cannot resurrect deleted ciphertext) or delivery routed to the recipient's home node at
enqueue time.

**Verify whether it actually strands before building either.** If it does, it outranks everything
else in both programmes.

## The seal fix, since it ran alongside this

**The routing defect is fixed and proven.** Closing a stranded cross-node session now reaches the
counterparty: their daemon logged `session.interrupted.responder.acked` and ours
`session.interrupted.pending`, where every previous attempt returned
`seal_interrupted_counterparty_unavailable` with their daemon logging nothing at all.

**The seal did not complete.** Both sides sit at `seal_interrupted_pending` and no notarization
exists on any node. That is a different step, past the routing, and plausibly the defect the other
branch is fixing (the notarization is durable but the closing side is never told). Not chased.

Three client rounds were needed because each fix was shipped before being proven end to end:

1. Lifting the status gate — necessary, but the broker map is empty after the restart that creates
   the interrupted state.
2. Discovery to find the counterparty's node — correct, and verified working in logs.
3. Sending over that connection — a visiting connection makes us REACHABLE FROM a node; it does not
   change where we SEND.

One session of the four was closed (`3672a625…`, 2 messages). The other three are untouched.

## What needs an operator

1. **Roll the three directory nodes** so V59–V61 apply. One at a time, `GET /bootstrap` 200 between
   each, per `infra/CLAUDE.md`. A full `terraform apply` replaces all three at once and takes the
   consortium out.
2. **After the roll, confirm the backfills unioned.** The links and stubs are per-node today; each
   node backfills what it holds and anti-entropy unions them. The check that matters:
   `agent_account_links` should hold all three of the operator's agents on all three nodes, where
   `agent_profiles.account_id` holds 0, 2 and 1.
3. **Then re-test the kill switch** — pausing an agent from a node that did not register it is the
   thing that was broken.

## Open decisions

- **Item 2's fix shape** — new table + view change, as above. Security-relevant; wants review.
- **Whether `#deliverOrEnqueue` strands cross-node** — determines whether item 6's queue work is
  urgent or cosmetic.
- **`sessions` owner-wins** — needs a decision about re-homing before it is built.
