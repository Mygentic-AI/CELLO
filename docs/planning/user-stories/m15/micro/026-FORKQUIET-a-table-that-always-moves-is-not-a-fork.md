---
name: 026-FORKQUIET — A table that is always moving is not a fork
type: micro-work-order
date: 2026-09-04
status: complete
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

### What the fix turned out to be

**The mechanism, measured rather than assumed.** A node rewrites its OWN `directory_nodes` row every
~30 s, so it always holds a strictly fresher heartbeat for itself than any peer does. That row's
version hash therefore differs from the peer's every round; it is pulled every round; the LWW merge
correctly confirms the local copy already won; and nothing applies. The verdict was
`pulled > 0 && applied === 0` — exactly that shape. **For an LWW table the old verdict could never
mean anything**, which is why the event's own `reason` field already admitted it might be benign.

**The verdict now comes from the STORE, per table**, because only the store knows which of a table's
columns a merge is able to settle:

| table | rule | why |
|---|---|---|
| `directory_nodes` | per RECORD, on the `status` witness; the heartbeat is not read | a witness disagreement belongs to one row and no sibling can vouch for it |
| `agent_suspensions`, `agent_presence` | per TABLE — divergent only when the table applied NOTHING | unchanged from M12; see the F2 note below for why this matters |

**`status` had to start travelling.** It replicated NOWHERE before this unit — not in the Tier-A
`immutableColumns`, not in the Tier-B `versionColumns` — so DoD 4 was literally unreachable without
putting it on the wire. It now rides the same Tier-B `SELECT` that already carried `021`'s
`COALESCE` fix, which is the one place the version hash and the served body are guaranteed to agree.
**The merge never takes it from the peer and the `UPDATE` never writes it**, so no peer can move our
`status`, `region` or `endpoint` — the Tier-A/Tier-B split that `021` built is intact.

### Where this work lives

Worktree `/Users/andrep/Documents/code/m15-026/trustless-cello`, branch `m15/026-forkquiet`, merged
to `main` as `12c493ff`. Local Postgres was the shared `docker compose` stack on :5433 (no
`COMPOSE_PROJECT_NAME` override needed — no other lane held it).

### The roll

Directory-only, so the relays were deliberately NOT rolled (`relay_image_tag` stays `1695c1a9`).
Image `12c493ff`, built from the SHA on origin, never from the local tree.

**Capacity probed BEFORE anything was deleted**, all three (zone, machine-type) pairs — the MIG
deletes before it creates, and these templates pin both IPs so they cannot surge:
`✅ us-east1-d / n2-standard-2`, `✅ us-central1-a / e2-standard-2`, `✅ europe-west1-c / e2-standard-2`.

| node | before → after | health after (euw1 / usc1 / use1, 4-min window) |
|---|---|---|
| `gcp-usc1` | `cello-gcp-usc1-zw6x` → `cello-gcp-usc1-pzxw` | 13 / 16 / 15 |
| `gcp-euw1` | `cello-gcp-euw1-9kd6` → `cello-gcp-euw1-8103` | 11 / 8 / 14 |
| `gcp-use1` | `cello-gcp-use1-tr2g` → `cello-gcp-use1-7kb6` | euw1 absent at 4 min, **6 / 7 / 12 on a 5-minute re-read** |

That last row is the documented short-window artefact, not a sick node — re-read before concluding
anything. Each node was confirmed serving before the next was touched, and the running image was
verified from **instance metadata**, not the tag.

**DoD 5 — the fleet is quiet. Window `13:11:27Z` → `13:27:48Z` (16 minutes): ZERO
`antientropy.round.fork_suspected`.** Baseline 13 in the preceding hour; last one ever seen
`13:03:01Z`. **Positive control:** the same query at 3-hour freshness returns 43, so the zero is a
real zero rather than a search that could not see.

**DoD 3 on the live fleet — replication unchanged.** 10 minutes of `antientropy.round.completed`:
**59 rounds / 67 rows applied**, against a pre-roll **60 rounds / 73 rows applied** measured the
same way.

**The mixed-version refusal fired exactly as the code comment predicted and cleared itself.** A new
node pulling `directory_nodes` from an un-rolled one gets a body with no `status` and refuses it
loudly rather than falling back: two `antientropy.round.table_failed` events, at 13:09 and 13:10,
both inside the roll, **zero since**. The user-visible cost is nil and that was verified rather than
assumed — both read surfaces dropped the heartbeat-freshness conjunct, so no agent reads offline
while heartbeats are briefly not replicating.

### The rest

**DoD 8 — the mutation loop: 17 mutants, ALL killed.** The loop refused a dirty tree
(`git status --porcelain`, which covers staged and untracked, not `git diff`), printed a baseline
before the first mutant, and **typechecked + linted every mutant before running it** — two were
reported BROKEN and widened rather than counted as catches. Every kill was re-run alone.

**Three mutants survived first, and each exposed a real gap:**
1. `M3b` — the merge's TIE branch `status` pin. My tie test used identical heartbeat strings, so the
   tiebreak always returned the local side and the pin was invisible. The branch is reachable: a peer
   sending `1e2` against `100` ties numerically and sorts higher, and `validateBody` requires only a
   string. Fixed test, mutant died.
2. `M6` — reverting the engine's push condition made `verdictOrThrow` fire, the throw was contained
   as a per-table failure, and my *"zero `fork_suspected`"* assertion was satisfied by a table that
   had **stopped reconciling altogether**. *"It did not alarm"* is a shadow. The test now also
   asserts no `antientropy.round.table_failed`.
3. Four store-rule mutants survived because the sync-service harness re-implements the verdict by
   hand. Closed by three new live-pg tests against the real schema.

**DoD 9 — the gate.** `pnpm run test` at root with `CELLO_ENV=local`: **2585 passed, 232 files,
exit 0**. `lint` clean, `tsc --build` clean. **Nothing publishes** — no cello-client package changed;
this is `packages/directory` only.

**DoD 10 — reviewer verdict.** Two passes, the hard cap.

> **Pass 1:** *"SPEC: DEVIATIONS FOUND … Blocking before the roll: F2 (decide and journal, or revert
> to per-table for the two untouched tables) and F3 (the reason text)."* — 2 HIGH, 3 MEDIUM, 2 LOW.
> All fixed.

The two blocking ones were mine and both were real:
- **F2** — I claimed my rule reproduced the pre-existing one for `agent_suspensions` and
  `agent_presence`. It did not: the old rule was per TABLE, mine was per RECORD, which is strictly
  more sensitive and would have put **the kill switch** on the same false alarm this unit exists to
  remove. Fixed by the two-granularity design above, pinned by regression tests at both the engine
  and the real-schema store layers.
- **F3** — my replacement alarm text (*"a real disagreement, not a stale copy"*) is true for
  `directory_nodes` and **false** for the other two, where divergence means precisely that the peer
  IS stale. It would have sent an operator hunting a fork in the kill switch over replication lag.
  The store now says which verdict applies; the engine refuses to label a divergence the store did
  not classify rather than defaulting to either.

> **Pass 2 (delta only):** *"SPEC: FAITHFUL … TESTS HAVE TEETH — every new test in the delta survives
> the revert test, two of them I re-verified by mutation myself … **Safe to deploy.** F2, F3, F4 and
> F6 are properly fixed, and the F2 regression in particular is now pinned at both the engine and the
> real-schema store layers rather than only against a stub."*

Pass 2 verified the `rounds ?? 1` bound independently (two production call sites, neither overrides)
and confirmed the witness-less rule is exactly the pre-existing expression. Its four remaining notes
are non-blocking and recorded below.

## Newly discovered

*Per rule 3 — found, NOT acted on.*

1. **`status` has no producer, so `directory_nodes` is now EFFECTIVELY SILENT, not watched.** Nothing
   in CELLO writes a status other than `'active'`: the only production writer is
   `refreshNodeHeartbeat`, whose conflict branch touches only the heartbeat; `insertDirectoryNode` is
   test-only; and a Tier-A apply takes the column's DB default, which is also `'active'`. The same is
   true of the Tier-A half — the sole writer sets `region = node_id`, so every node computes an
   identical content hash. **The mechanism is kept and tested** (deleting it is the mute button this
   order forbids, and a drain/decommission path would trip it the day one exists), but the bound is
   written into `directory-node-heartbeat-merge.ts` so nobody reports it as active surveillance.
2. **`agent_presence` carries the same structural shape this unit fixed.** Its `versionColumns`
   include two wall-clock LWW timestamps, so a peer holding a staler row is pulled-without-applied
   every time. It does not fire today only because presence changes on an EVENT rather than a timer,
   so the streak rarely reaches 2. Out of scope (*"any other anti-entropy table"*). Worth its own
   line if it ever starts alarming.
3. **Tier-A's alarm still cannot name the row, and its verdict is over-claimed** (reviewer F8).
   `applyTierA` returns a COUNT, so the engine cannot say WHICH record failed to insert, and it
   labels every Tier-A shortfall `content_fork` — but a record also fails to insert on a malformed
   BYTEA, an FK violation, or any pg error, which is not a fork at all. Pre-existing (main's text said
   the same sentence); the fix is a return-shape change to `applyTierA`, not a round-three edit.
4. **`verdictOrThrow` freezes the fork streak for EVERY table against that peer** (reviewer F9), via
   the pre-existing `failures.length > 0 → leave every streak untouched`. Only a buggy store can reach
   it and it is ERROR-loud every round. The clean fix is to make it a type-level impossibility (a
   discriminated union on `divergent`) and delete the function.
5. **One full-root gate run reddened `dod-m15-chainroundtrip-1` once and never reproduced** — not on
   two later full-root runs, and not when I deliberately restored the sibling failure that ran
   alongside it. My diff touches no hash-chained table and adds no writes to one. Recorded rather than
   attributed; if it recurs, the shared dev database's accumulated state is the first thing to check.
