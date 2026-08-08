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

# Tier B programme — COMPLETE

> **Updated 2026-08-08.** All six items are closed. Items 2 and 6 were left open overnight and were
> finished the following morning after Andre pushed back — correctly — on the difference between
> explaining a problem and fixing it, and between recording a disagreement and resolving it.

## What landed

| # | Item | State |
|---|---|---|
| 1 | `agent_profiles.account_id` → append-only link | **V59 committed** |
| 3 | The unassessed attestation pair | **V61 committed** |
| 4 | `user_accounts.email_stub_hash` → append-only fact | **V60 committed** |
| 5 | Reconcile the two contradicting documents | **Committed** |
| 2 | Revocation propagation | **V62 committed** |
| 6 | Remaining Tier B tables | **Settled — four will NOT be built, see below** |

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

### How it was fixed — V62

Adding those columns to `SIGNAL_RECORDS_SPEC` would rehash every existing row and make all three
nodes report divergence on data that never changed (the trap V58 documents). So the fact moved to
its own append-only table, `signal_revocations`, and `signal_records` was left untouched. The view
now reads "is there a tombstone" and "who revoked" from the UNION of the local tombstone and the
replicated fact.

Every branch is the V54/V55 logic unchanged in meaning. That mattered more than usual: a missed
revocation leaves a withdrawn signal reading as live, and two earlier versions of this expression
failed open. The COALESCE guarding `ARRAY_AGG` over zero rows is preserved verbatim, and there is
still deliberately no "NULL revoker ⇒ revoked" branch.

**Validated against a real Postgres, which is why it shipped rather than stayed a proposal.** All 18
`DOD-REVOKE-1` tests pass, including both exact-pubkey authority cases — the ones separating "a
submitter key cannot tombstone an agent's record it does not own" from "the issuer's own withdrawal
still revokes". Every unit test here stubs the pool and cannot tell those apart.

Running it that way also caught a bug in the migration itself: `revoker_signature` declared TEXT when
the source column is BYTEA. It compiled, it migrated, and it failed at the first real revocation
with `invalid byte sequence for encoding UTF8: 0x00`.

**Still outstanding, and deliberately separate:** `authorized_issuers.status`. Enrolment replicates;
withdrawal does not, so revoking a compromised issuer key leaves it active on every node that did
not process the revocation. Same shape of fix, not yet done.

## Item 6 — smaller than it looked, and one piece is not really item 6

The design named eight Tier-B tables. The accurate tally:

| Table | State |
|---|---|
| `agent_suspensions` | Built |
| `agent_presence` | Built |
| `directory_nodes` | **Solved differently** — moved to Tier A |
| `capability_claim_codes` | **Solved differently** — moved to Tier A, after it broke Telegram registration in production |
| `pre_authorization_tokens` | **Will not be built** — no security property gained |
| `sessions` | **Will not be built** — delivery state |
| `pickup_queue` | **Will not be built** — see below |
| `pending_notifications` | **Will not be built** — see below |

**`pre_authorization_tokens` is low value.** The design's own note says the cross-node double-spend
window is unchanged by replicating it, because the nonce binder is the real gate. Replicating it
buys tidiness, not a security property.

**The question was whether a queued message strands cross-node. It does — and replicating the queue
is still the wrong fix.**

`#deliverOrEnqueue` calls `enqueueNotification` on the ADJUDICATING node, and `pending_notifications`
is node-local, so a seal result for a participant homed elsewhere is never collected. Confirmed by
reading the path, not inferred.

But the repair is written two lines above that call, by whoever hit it first:

> `seal_notarizations` IS a Tier-A anti-entropy table, so the stranded participant's OWN home node
> already receives the notarization — the receipt can be LEARNED locally and does not need this
> cross-node push at all.

So the pattern that supersedes the design's Tier-B rules is **replicate the FACT, let the client
learn it**. Replicating delivery state would invite double-delivery to solve something that needs no
push. That is what V58 builds, and it is why `pickup_queue`, `pending_notifications` and `sessions`
stay node-local. `pre_authorization_tokens` stays local on the design's own admission — the nonce
binder is the real double-spend gate.

**Tier B is finished, not abandoned.** What would reopen it: a fact a client cannot learn from
replicated state and must therefore be pushed. Every case so far has turned out to be learnable.

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

## Open

- **`authorized_issuers.status`** — withdrawal of a compromised issuer key still does not propagate.
  Same shape as V62; not done.
- **The seal ceremony past the routing fix** — both sides commit and no notarization follows.
  Belongs to the terminal-state work on the other branch, not here.
