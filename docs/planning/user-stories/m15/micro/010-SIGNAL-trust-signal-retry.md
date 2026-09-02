---
name: 010-SIGNAL — A trust signal reaches the directory when one node is down
type: micro-work-order
date: 2026-09-01
status: complete
description: >
  Minting a trust signal fails outright when the directory node this daemon is connected to is
  unreachable, and the operator has to notice and re-run the command. The consortium has three
  nodes. The submission path already documents why a multi-node write is the WRONG fix — the fix is
  to retry across the reconnect, which is safe because the submission id is content-derived.
  Source: DOD-M15-ENDORSE-RETRY-1.
---

# **<ins>MICRO</ins>** WORK ORDER 010-SIGNAL — A trust signal survives one node going away

> ## THE RULES OF A MICRO WORK ORDER
>
> 1. **Read [[M15-PROCEDURE]] IN FULL before you start.** It is the working discipline for this
>    milestone and it binds you — the gate, the review dispatch, the invariants, how tests are run.
>    **Do not read `M15-DEFINITION-OF-DONE.md` or `M15-BUILD-JOURNAL.md`**; this order carries
>    everything you need from them.
> 2. **MICRO means small.** One mission. Follow it to its end. **Never grow the mission.**
> 3. **Found something else?** Write it under *Newly discovered* at the foot of this file and
>    **keep going**. Do not fix it. Do not open a line for it. Do not investigate it.
> 4. **500 lines, hard cap.** Minimal without omitting anything. No scratchpad.
> 5. **Standard procedure still applies:** implement → review (`cello-unit-reviewer`) → fix every
>    finding → commit. Commit per fix, push after every commit.
> 6. **Done is done.** When the Definition of Done below is met, stop. Do not look for more.

---

## The problem, plainly

An operator vouches for someone — mints a trust signal — and the directory node their daemon happens
to be connected to is down or restarting. **The command fails and it is over.** The signal is not
queued, not retried, and nothing tries again. The operator has to notice the failure and run it
again themselves.

There are three directory nodes. Surviving one of them being unavailable is the entire point of
having three. "Mint a trust signal and have it received" is advertised value, so this is a case
where the product visibly fails to deliver something it claims.

---

## ⚠️ THE OBVIOUS FIX IS THE WRONG ONE, AND THE CODE ALREADY SAYS SO

Do not build a client-side multi-node write. `sendSealedSubmission` in
`core/daemon/src/signal-submission.ts` carries this in its own header, and it is a ruled position,
not an accident:

> *"ONE node, deliberately. The daemon holds a single signaling stream, and registration already
> works this way — it sends `register_request` to the connected node and the DIRECTORY fans out to
> the quorum. There is no client-side multi-node write path, and inventing one here would duplicate
> the SignalingManager's reconnect. So 'failover' for a submission is that existing reconnect, and a
> retry afterwards is safe because `submission_id` is content-derived: the same body produces the
> same id, so a second node stores it once and the portal mints once."*

**Read that twice before you design anything.** Three things follow from it:

1. **The failover mechanism already exists** — it is the signaling manager's reconnect, which
   already moves this daemon to another node.
2. **A retry is SAFE**, because the submission id is derived from the content. Sending the same
   submission twice, to two different nodes, stores it once and mints once. You are not risking a
   duplicate endorsement.
3. **So the missing piece is small and specific: nothing retries.** The send fails, the failure is
   returned to the operator, and the work stops there.

**The mission is the retry, not the routing.**

---

## The work

1. **After a send failure that is worth retrying, retry it** — once the signaling stream is
   connected again, whether that is the same node or a different one.
2. **Distinguish what is worth retrying from what is not.** A submission refused on its merits must
   NOT be retried forever; a submission that never reached anybody must be. The send path already
   returns typed failures (`SubmissionSendFailure`) — use them rather than string-matching, and if
   the distinction the types give you is not sharp enough, say so in *Newly discovered* rather than
   widening the types on a guess.
3. **Bound it.** A retry that never gives up is an outage that never gets reported. Give it a
   ceiling and a give-up state, and reuse the discipline already in this codebase rather than
   inventing a second one — the restart seal resolver is the reference for serial, staggered,
   with a give-up stamp.
4. **The operator is told, both times.** When it is retrying, the surface says so rather than
   showing a bare failure. When it gives up, that is a distinct terminal state with a reason and a
   next step, not silence.
5. **Verify the drain gap, and this is a READ, not a change.** When `cello-portal-ingress-drain`
   shipped it was expected to close a gap in the refuse path, and nobody has checked since. Confirm
   from code whether it did. **If it did, record that here in one line and move on. If it did not,
   write it under *Newly discovered* and do NOT fix it** — that is a different unit.

---

## Definition of Done

1. A submission whose send fails because the node is unreachable is retried after reconnect, without
   the operator re-running anything.
2. **The same submission reaching two different nodes is stored once and mints once** — asserted,
   not assumed from the content-derived id. This is the clause that makes the retry safe, so it
   gets a test of its own.
3. A submission refused on its merits is NOT retried.
4. The retry is bounded, and exhausting it produces a named terminal state with a reason and a next
   step.
5. While retrying, the operator-facing surface says so rather than reporting a plain failure.
6. Each of 1–5 has a test, and **each has been made to fail on purpose** — revert the fix, confirm
   it reddens, confirm it reddens for the reason you expect.
7. `pnpm run lint` and `pnpm run typecheck` pass. Tests at the smallest scope that covers what you
   touched — see the machine budget.
8. The drain-gap question of work item 5 is answered in one line in the *Review* section — either
   "closed, verified at `<call site>`" or a *Newly discovered* entry. Not left open.
9. Reviewed by `cello-unit-reviewer`, every finding fixed, verdict quoted below.

**Not in scope, explicitly:** a client-side multi-node write path (ruled against above); changing
how the directory fans out to the quorum; anything in the relay; the endorsement quota, withdrawal
or ingress lines.

---

## Traps recorded before you start

- **Do not duplicate the SignalingManager's reconnect.** If you find yourself writing node
  selection, stop — that is the wrong fix and this order says so twice for a reason.
- **A retry that hides a real refusal is worse than the bug.** The operator must be able to tell
  "the network is flaky, hold on" from "the directory said no."
- **Do not weaken an existing assertion to make a new test pass.**
- **`submission_id` being content-derived is load-bearing for the whole design.** If you change
  anything that feeds it, the idempotency argument collapses and the retry becomes a
  double-endorsement bug. Do not touch it.

---

## Review

**Work item 5 — the drain gap is CLOSED.** Verified at `cello-portal/src/server/trust/submission-ingress.ts`,
`processRow`'s `if (auth.body.op === "refuse")` branch: it dispatches to `handleRefuse` *before* the
mint path, records an outcome and acks, and `cello-portal-ingress-drain` (Cloud Scheduler, every
minute) is what calls the route it lives on.

**Reviewer verdict** (`cello-unit-reviewer`, one pass):

> **SPEC: DEVIATIONS FOUND** — clause 8 missing (drain-gap answer nowhere), clause 2 unverified
> (test uncommitted and unrun), clause 4 terminal state mislabelled. `[blocking]`
> **SILENT FALLBACKS FOUND** — H1 (accepted-during-shutdown loses its only handle) and H2 (shutdown
> drops the queue with no log, against an explicit promise) are both `[blocking]`.
> **ERROR SUBSTITUTION FOUND** — H3 (`attempts_exhausted` for a node refusal) and M5
> (`submission_refused_by_node` for a local condition) are `[blocking]`; both point the operator at
> the directory for causes that are not there.
> **HOLLOW TESTS FOUND** — the exhaustiveness claim has no teeth and its own comment denies it;
> `is SERIAL` and `stop() leaves nothing armed` do not survive a narrow revert.
> **REMOVALS PROVEN** — the single move preserves behavior and touches nothing signed or hashed.

All nine findings fixed, one commit each. Clause 2's portal test was committed and run after the
reviewer took its snapshot (24 passed; mutating away the ingress dedupe reddens it at "expected 2 to
be 1" — the notary asked twice). Clause 8 is answered above.

**Mutation record — 7 caught, and 2 SURVIVED first and were fixed:**

| Mutation | Result |
|---|---|
| disable the enqueue call site | RED with the exact pre-fix payload |
| remove the reconnect wake from `onConnected` | **SURVIVED** — the queue's own timer had delivered it; test rewritten to name the writer, wake pinned separately, then RED |
| add `submission_refused_by_node` to the retryable set | RED in both clause-3 tests |
| drop `in_flight` from `wallet_list_issued` | RED |
| make a local precondition spend the attempt budget | **SURVIVED** — the exhaustion branch is guarded on `!localPrecondition`, so the miscount was invisible; a mixed-sequence test now pins `delivery.attempts`, then RED |
| `localPrecondition = false` | RED in two tests |
| disable the portal's ingress dedupe | RED — "expected 2 to be 1" |

**Gate:** `pnpm run lint` and `pnpm run typecheck` both exit 0. `core/daemon` + `core/cli` +
`core/adapter-claude-code`: **3511 passed, 5 skipped**. Portal `m10b-ingress-1-drain-loop`: 24
passed. Directory `m10b-queue-1-v51-submission-queue` (real Postgres, `CELLO_ENV=local`): 9 passed —
run rather than cited, because it is the per-node half of clause 2.

**Bound worth stating:** clause 2's wording spans two layers and only one of them is cross-node. The
submission queue is **not replicated** (M10B-D21), so two nodes genuinely hold two rows — "stored
once" is a per-node property, and mint-once is the portal's. Both are now asserted where they live.

---

## Newly discovered

*(One or two lines each. Do not act on them.)*

- **The in-process signaling seam runs no reconnect behaviour at all.** Injecting `signalingConnect`
  makes the daemon build `sharedSignaling`, which is constructed with **no `onConnected` callback**.
  So on that seam the standing-receiver re-registration, the park drain and this retry are all
  unreachable — any test that believes it exercised a reconnect there is reading a different writer.
  POST-LAUNCH: it is a test-fidelity gap, not a production path (production always configures
  `directoryEndpointResolver` and gets a per-agent manager that has the callback).

- **`nat-reachability-reservation` R2 is host- and ordering-dependent.** "standing receiver binds
  ROUTABLE by default" binds a real libp2p node on `0.0.0.0` and asserts a non-loopback `/ip4/` is
  enumerated. It failed once inside a 334-file run and passed both alone and on a second identical
  combined run; this machine has exactly one non-loopback IPv4. Nothing in this unit touches
  transport binding. POST-LAUNCH: a test that asserts on host interface enumeration under load will
  go red on a correct implementation.
