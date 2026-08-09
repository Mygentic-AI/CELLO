---
name: replication-gap-what-m12-left-unfinished
type: discussion
date: 2026-08-07
topics: [anti-entropy, replication, m12, migration, directory, tier-b, kill-switch, trust-signals]
description: >
  Why "such-and-such isn't replicating" keeps recurring. The AWS Postgres mesh replicated 21
  tables; M12's anti-entropy ported 4, and was expanded to 11 only after registration broke in
  production. Tier B — the mutable half — was specified for 8 tables and built for 2. This is the
  inventory of what is stranded, what each one breaks, and what it takes to finish.
---

# The replication gap — what M12 left unfinished

## The one-paragraph answer

Nothing here was a decision to stop replicating. **The AWS deployment replicated 21 tables through
a Postgres mesh. M12 replaced that with anti-entropy covering 4.** Seven more were added on
2026-07-31 — not by design review, but because registration broke in production and someone traced
it to `capability_claim_codes` being one of the missing ones. The design also specified a second
tier for mutable data across 8 tables; **2 were built.** Every "X isn't replicating because it's
excluded" is a face of that one unfinished implementation, which is why fixing them one at a time
has felt like whack-a-mole and why it has now happened at least four times.

## How we got here

| Stage | Tables replicating |
|---|---|
| AWS, before the migration | **21** (Postgres mesh) |
| M12 anti-entropy as first shipped | **4** |
| After the 2026-07-31 registration incident | 11 Tier A |
| Tier B (mutable) — specified | 8 |
| Tier B — **built** | **2** (`agent_suspensions`, `agent_presence`) |

The code says this in its own words, above the specs that were added in the incident:

> The AWS Postgres mesh replicated 21 tables. Only 4 were ported to AE. The remaining 15 were
> noticed on 2026-07-31 when registration broke because `capability_claim_codes` was one of them.

## Why the recurrence is structural, not bad luck

**Tier A replicates immutable columns only.** That is not a limitation to work around — it is what
makes Tier A safe: insert-if-absent by natural key, content-addressed, no merge logic, no way for
a lagging peer to overwrite anything.

The consequence is that **every column that can change was excluded by construction**, each with a
note saying it belongs in Tier B. Tier B then stopped at two tables. So the replicated set is
precisely "the half that never changes", and all live state — links, statuses, revocations — is
stranded on whichever node wrote it.

That is why the symptom is always the same sentence, and why it appears in unrelated features.

## Three kinds of exclusion, and only one of them is fine

The distinction matters, and the codebase is careful about it in one place and silent in another.

### 1. Deliberate and sound — node-local by design

`sessions`, `pickup_queue`, `pending_notifications` (per-node delivery state);
`registrations`, `pre_authorization_tokens` (per-node Telegram state machine);
`conversation_seal_staging` (ephemeral, consumed during the seal ceremony);
`directory_checkpoints`, `checkpoint_node_signatures` (parked with M12-P5).

**Caveat worth resolving:** the M12 design doc assigns `sessions`, `pickup_queue`,
`pending_notifications`, `pre_authorization_tokens` and `capability_claim_codes` explicit Tier B
merge rules — including a bounded-GC tombstone scheme for the queues specifically to stop a lagging
peer resurrecting deleted ciphertext. The code calls the same tables "node-local by design". One of
those two documents is wrong, and nothing records which decision superseded which.
`capability_claim_codes` has already moved from that list into Tier A, which suggests the code's
list was not authoritative.

### 2. Stranded mutable state — specified to replicate, never wired

This is the category that has cost the day.

| Stranded | Verified consequence |
|---|---|
| `agent_profiles.account_id` | **The kill switch fails on 2 of 3 nodes.** Pause/burn asks "does this agent belong to this account?" against a link that is only on the registering node. A node without it answers `403 not_owner` — a deliberate refusal, so the client correctly stops and does NOT try elsewhere. Live: of one operator's 3 agents, use1 had 0 linked, usc1 2, euw1 1. |
| `agent_profiles.account_id` | **The same-operator check for endorsements loses a leg.** `INV-NO-SELF-STANDING` tests same-account OR same-phone-stub. The account half silently never fires on a node lacking the link. The phone stub replicates and currently catches it — the two independent checks have quietly become one, and the result is pinned permanently into the notarized hash. |
| `user_accounts.email_stub_hash` | Sign-in impossible; the `email` trust signal silently skipped. Both fixed today on the read side. |
| `agent_profiles.status` | Agent active/revoked state is node-local. (`agent_revocations` is a separate append-only table and DOES replicate — see "the pattern that works".) |
| `authorized_issuers.status`, `revoked_at` | **Revoking a compromised issuer key does not propagate.** The key stays active on every node that did not process the revocation. Enrolment does replicate; withdrawal does not. |
| `signal_records.status`, `revoked_at`, `is_tombstone`, `revoker_pubkey`, `revoker_signature` | **Trust-signal revocation state is node-local.** Needs assessment (below) — but it already settles an open design question: `activeAmong` must NOT treat "any node says active" as active, because that rule would resurrect revoked signals. |

### 3. Never assessed at all — and the code says so honestly

`conversation_participation` and `conversation_attestations`. The comment is worth quoting because
it refuses to launder an oversight into a decision:

> They are listed separately from the block above on purpose. Everything there was weighed and
> excluded; these two were never considered.

The consequence is already written down: `recordConversationSeal` writes the seal header and both
of these in ONE transaction, but only the header replicates. **A node that receives a seal by
anti-entropy learns neither who took part nor what was attested** — and `analytics-job` derives
`pseudonym_stats` and `graph_edges` from exactly those two tables, so **the track-record surface
differs per node with nothing reporting it.**

This was predicted independently from the outside: "another likely one is attestations or
endorsements." Both are in this category.

## "So what if they're mutable? Why not just build them?"

They should be built. Mutable replication is harder than append-only for one reason, and it is not
effort: **a wrong merge rule is worse than no replication.** Append-only replication cannot corrupt
anything — the worst case is a row arrives late. A bad merge rule actively destroys correct state,
converges the whole consortium onto the wrong value, and does it silently.

The two concrete traps, both already solved in the design doc:

- **Wall-clock last-write-wins is unsafe for the kill switch.** A clock-skewed node could
  **un-pause a suspended agent**. The design forbids wall-clock merges there and uses a monotonic
  `suspension_seq` instead — while explicitly permitting wall-clock LWW for `agent_presence`,
  because a wrong presence self-heals on the next connect edge and a wrong un-pause does not.
- **Naive insert-if-absent resurrects deleted ciphertext.** For the queue tables, a peer that has
  not yet seen an ACK re-inserts the row it already delivered. The design's answer is ack
  tombstones with a bounded GC window that strictly exceeds max plausible peer lag.

So the answer to "is there a reason not to build them" is **no** — the reason they are hard is that
each needs its merge rule to be right, and the design already states each rule. This is
implementation against an existing spec, not new design work.

## The pattern that already works — worth copying rather than inventing

`agent_revocations` replicates completely and correctly. It does so because **the mutation is
expressed as an append-only fact in its own table** rather than as a status column on an existing
row. Tier A then carries it for free, with no merge rule and no skew hazard.

Every stranded case above kept its mutation as a column UPDATE. Where a mutation is genuinely
one-way (revoked, consumed, redeemed, linked), converting it to an append-only fact is cheaper and
safer than writing a merge rule — and it is the shape this codebase already proves.

## What today's read-side fixes were, and what they become

Four portal fixes today compensated for gaps in this list rather than fixing them:

1. account lookup by email hash — asks every node instead of the first
2. agent list — collects from every node and unions
3. account facts — merged across nodes so `email` is not skipped
4. track-record fetch — tries each node

**If `agent_profiles.account_id` and `user_accounts.email_stub_hash` replicate, 1–3 become
redundant** (harmless, but no longer load-bearing). They are worth keeping as defence in depth,
because a node that is behind on anti-entropy has the same shape as a node that never had the data.

**The kill switch cannot be fixed this way and proves the point.** It is a WRITE whose
authorization depends on non-replicated state. No read strategy helps.

## Sequenced plan

Ordered by what breaks worst, not by effort.

**1. `agent_profiles.account_id`** — unblocks the kill switch and restores the second leg of the
self-endorsement check. The design already assigns it "Tier B rules". Needs a backfill for links
that already differ across nodes (live today). Consider the append-only-fact shape instead of a
mutable column, per the pattern above.

**2. Revocation propagation** — `authorized_issuers.status` and `signal_records` revocation. Both
are security-relevant in the same direction: a withdrawal that does not propagate leaves authority
alive somewhere. Also the precondition for making `activeAmong` safe to fan out.

**3. `conversation_participation` + `conversation_attestations`** — the unassessed pair. Assess
first: they may belong with the seal header as one Tier A record (the design says the seal and its
children should travel as ONE record, which would fix "the standing defect where children never
replicated"). This is what makes track-record consistent across nodes.

**4. `user_accounts.email_stub_hash`** — lower urgency now that the portal reads across nodes, but
it is the difference between sign-in working and sign-in working *by luck of node ordering*.

**5. Reconcile the two documents** — the design doc's Tier B list versus the code's "node-local by
design" list. Whichever is right, one of them is actively misleading, and this exact ambiguity is
what let 15 tables go missing without anyone noticing for three months.

**6. The remaining Tier B tables** — per the design's merge rules, once 1–3 are done and the
pattern is established.

## The check that would have caught all of this

There is no test that asserts the replicated set matches an intended set. Every gap in this
document was found by a user hitting a broken feature, or by someone reading the code for an
unrelated reason.

A single test that enumerates every table and column and requires each to be either replicated or
explicitly listed as node-local *with a reason* would have failed on day one of M12 — and would
have caught `conversation_attestations`, which no human has yet decided about.

---

## Related Documents

- [[2026-08-09_0436_sharing-a-sealed-conversation|Sharing a Sealed Conversation]] — proposes a new
  share-permission table that must replicate so any node can answer the permission question. Exactly
  the replicate-or-node-local decision this log shows has been getting made by omission, and a
  chance to make one deliberately for once.
