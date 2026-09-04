---
name: 026-FORKQUIET — A table that is always moving is not a fork
type: micro-work-order
date: 2026-09-04
status: open
description: >
  021-HEARTBEAT made directory_nodes an anti-entropy table. Every node rewrites its own
  last_heartbeat_at every ~30s, so two nodes can never agree on a hash of a table one of them is
  always mutating — and the fork detector fires antientropy.round.fork_suspected at ERROR every
  three minutes, forever, on a completely healthy fleet. Judge agreement on everything EXCEPT the
  heartbeat column, so a real divergence in that table still alarms.
  CLOSES DOD-M15-FORKQUIET-1.
---

# **<ins>MICRO</ins>** WORK ORDER 026-FORKQUIET — A table that is always moving is not a fork

> ## THE RULES OF A MICRO WORK ORDER
>
> 1. **Read [[M15-PROCEDURE]] IN FULL before you start.** It binds you — the gate, the review
>    dispatch, the invariants, how tests are run. **Do not read `M15-DEFINITION-OF-DONE.md` or
>    `M15-BUILD-JOURNAL.md`**; this order carries everything you need from them.
> 2. **MICRO means small.** One mission. Follow it to its end. **Never grow the mission.**
> 3. **Found something else?** Write it under *Newly discovered* at the foot of this file and
>    **keep going**. Do not fix it. Do not investigate it.
> 4. **500 lines, hard cap.**
> 5. **Standard procedure still applies:** implement → review (`cello-unit-reviewer`) → fix every
>    finding → commit. Commit per fix, push after every commit. **Closing a unit means flipping
>    this file's `status:` frontmatter to `complete` in the SAME commit as the verdict.**
> 6. **Done is done.** When the Definition of Done below is met, stop.

---

## The rule this exists to enforce

**Andre, 2026-09-04**, choosing between two candidate fixes:

> *"Or if the difference is only a heartbeat logging then it's ignored."*

And rejecting the other one himself — slowing the heartbeat to once a minute — because it only makes
the false alarm rarer while degrading the thing the timestamp is *for*.

**One sentence: a difference that is only a heartbeat is not a disagreement.**

---

## What is true today — MEASURED ON THE LIVE FLEET, do not re-derive

Observed 2026-09-04, on the fleet rolled to `1695c1a9` that same morning.

`antientropy.round.fork_suspected` fires at **`level: error`**, on `table: directory_nodes`,
`tier: B`, **every three minutes**, with `consecutive` pinned at 2 and never climbing:

```
09:21:00  09:24:00  09:27:00  09:30:01   … flat, indefinitely
```

The round that raises it reports `planned 1, pulled 1, applied 0` — it pulled a peer's row and
applying it changed nothing, because the local copy was already at least as fresh. The table hash
still differs, because by then the peer has written a newer heartbeat.

**The event's own `reason` field already admits it:**

> *"Tier-B only — may be a benign merge that confirmed the local copy, NOT necessarily divergence"*

### Why it can never converge

`021-HEARTBEAT` made `directory_nodes` a Tier-B anti-entropy table. Every node refreshes its own
`last_heartbeat_at` every ~30 seconds (`V42`'s comment: the read rule treats an agent as online only
if its node's heartbeat is fresh). Two nodes therefore cannot hold an identical snapshot of a table
one of them is continuously mutating. **The fork signature is structurally guaranteed here.**

### Where it lives

`packages/directory/src/ae-sync-service.ts`, around the `forkKeys` computation:

```ts
const forkKeys = unconverged
  .filter((u) => u.pulled > 0 && u.applied === 0)
  .map((u) => `${u.tier}:${u.table}`);
```

`unconverged` is assembled higher in the same function from `result.rounds[].unconverged`; the
per-table entries are produced in the ae-channel layer. **Find the producer before changing the
consumer** — the comparison that decides "unconverged" is the thing this unit changes, not the
`forkKeys` filter.

### What is NOT wrong, and must stay that way

`021` already anticipated the chatty table and keyed the streak **per table**, with a comment saying
so, precisely so one noisy table cannot mask a genuine fork in `agent_suspensions` — the kill switch.
**That design is correct. Do not touch it.** This unit fixes the false positive on
`directory_nodes` itself, nothing else.

---

## Part 1 — Ignore the heartbeat column, NOT the table

> ### 🎯 THIS IS THE DESIGN DECISION OF THE UNIT, and the obvious shortcut is wrong.
>
> The cheap fix is to exclude `directory_nodes` from fork detection. **Do not.** That table does not
> only carry heartbeats — it carries `status`, `region` and `endpoint`. A genuine disagreement where
> one node believes a peer is `active` and another believes it is not is exactly the kind of thing
> the fork detector exists to shout about. Muting the table blinds it.
>
> **Judge convergence on the row EXCLUDING `last_heartbeat_at`.** Then:
>
> - heartbeat-only difference → converged → silent, which is the truth;
> - any difference in `status`, `region`, `endpoint` (or a row present on one node and not the
>   other) → still unconverged → still alarms.

**Mirror the existing chokepoint.** `021` already fixed a related encoding disagreement at the
anti-entropy `SELECT` with `COALESCE(last_heartbeat_at, to_timestamp(0))`, which is the same pattern
`origin_node` uses three entries above it in the same file. **The convergence comparison should be
fixed at that same chokepoint** rather than by a special case bolted onto the fork check — one
`SELECT` feeds both the version hash and the served body, and that is why the original bug existed.

**Replication itself must NOT change.** The heartbeat still replicates; nodes still learn each
other's liveness. Only the *convergence verdict* stops counting the timestamp. If your change causes
heartbeat rows to stop being applied, you have broken `021` — see DoD 3.

---

## Part 2 — Prove it on the fleet, not only in a test

This is server-side. A green vitest does not tell you the alarm stopped.

Deploy per `/cello-deploy-gcp` — **relays first is not relevant here (directory-only change), but the
capacity probe, the node-by-node roll and the health windows all still bind.** Then:

1. **The alarm is gone:** zero `antientropy.round.fork_suspected` on `directory_nodes` over a window
   of at least **15 minutes** — against the measured baseline of one every three minutes. A shorter
   window cannot distinguish "fixed" from "not due yet".
2. **Replication still works:** `antientropy.round.completed` still shows Tier-B `directory_nodes`
   rounds *applying* peer rows. The baseline to beat is **46 rows applied across 47 rounds in ten
   minutes**, measured 2026-09-04.
3. **The detector still works:** see DoD 4.

---

## Definition of Done

1. Convergence for `directory_nodes` is judged excluding `last_heartbeat_at`, at the same chokepoint
   that feeds both the version hash and the served body.
2. **The table is not muted.** A reviewer can see that `directory_nodes` still participates in fork
   detection.
3. **Heartbeat replication is unchanged.** Peer heartbeat rows are still pulled and applied.
4. **The detector still fires on a real divergence in that table.** Prove it with a test that makes
   two nodes disagree on `status` (not on the heartbeat) and asserts `fork_suspected` is raised.
   **This is the line that stops the fix from becoming a mute button**, and a unit that skips it has
   not closed this order.
5. Deployed, and the fleet is quiet: **zero** `fork_suspected` on `directory_nodes` over ≥15 minutes,
   quoted, against the ~1-per-3-minutes baseline above.
6. Directory health after the roll: anti-entropy rounds present in all three zones over a 4-minute
   window. Both relays untouched.
7. `infra/GCP-STATE.md` updated **in the same commit** — what rolled, which instances replaced which,
   the capacity probe result, and the health signal used.
8. **Each new assertion has been made to fail on purpose**, and confirmed to fail for the reason
   expected. **Commit before the mutation loop exists.**
9. Gate passes in trustless-cello. State whether anything publishes.
10. Reviewed by `cello-unit-reviewer`, every finding fixed, verdict quoted below.
11. `DOD-M15-FORKQUIET-1` flipped to ✅ in `M15-DEFINITION-OF-DONE.md`, in the same commit as the
    verdict, and item **3** in that file's *FOUND LIVE 2026-09-04* table updated.

**Not in scope:** changing the heartbeat interval (rejected by Andre — it degrades online/offline
accuracy and only makes the false alarm rarer); the per-table streak design from `021`, which is
correct; any other anti-entropy table; the alerting policies in `alerting.tf` (`fork_suspected` is in
none of them and this unit does not add it).

---

## Traps recorded before you start

**Muting the table is the wrong fix and it will pass every test you are likely to write.** The test
that catches it is DoD 4 — a real `status` divergence that must still alarm.

**Do not slow the heartbeat.** It was considered and rejected: the freshness of that timestamp is how
an agent is judged online, and it does not even eliminate the false alarm.

**Fix it at the SELECT, not at the fork check.** One query feeds both the version hash and the served
body. `021`'s original defect existed because those two disagreed; a special case at the fork check
leaves that shape in place for the next person.

**A 3-minute observation window proves nothing.** The alarm fires once every three minutes. Fifteen
minutes minimum.

**`terraform apply` with no `-target` replaces ALL THREE directory nodes at once.** Roll node by
node. Read `infra/CLAUDE.md` before touching the fleet.

**Probe capacity BEFORE anything is deleted** — the MIG deletes the old instance before creating the
replacement, and a zone with no capacity means the node does not come back.

---

## Review

### Where this work lives
*(worktree paths, branch, and the `COMPOSE_PROJECT_NAME` / `CELLO_PG_HOST_PORT` you used)*

### The roll
*(capacity probe results, instance names before/after, health windows)*

### The rest
*(the ≥15-minute quiet window from DoD 5, the mutation proof from DoD 8, the reviewer's verdict)*

## Newly discovered

*(anything found and NOT acted on, per rule 3)*
