---
name: 025-REFUSALTERMINAL — A refusal that can never succeed stops, and the count is true
type: micro-work-order
date: 2026-09-04
status: open
description: >
  A message refused because the conversation is CLOSED is retried forever — measured at 232,056
  refusal events over 62 hours, ~2 per second, on one message, growing daemon.log to 484 MB. The
  receiver holds a leaf it can never resolve, because resolving it means ingesting content that is
  refused every time, and nothing marks the refusal permanent. The operator's own inbox reported
  that as "58". Make a provably-permanent refusal stop the work, and make the number honest.
  CLOSES DOD-M15-REFUSALTERMINAL-1.
---

# **<ins>MICRO</ins>** WORK ORDER 025-REFUSALTERMINAL — A refusal that can never succeed stops

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

**Andre, 2026-09-04**, on being shown the loop:

> *"Yes, a message refused should stop being retried."*

**One sentence for the whole unit: a refusal that CANNOT succeed must stop the work, not repeat it.**

---

## What is true today — MEASURED IN PRODUCTION, do not re-derive

Found on Andre's own laptop on 2026-09-04, in live traffic, not by review.

`CELLO_Coder_1` had a canary message aimed at a conversation `CELLO_Support` had already closed.
Every copy is refused `session_committed`. A committed session is signed and cannot be added to, so
**no retry of any kind can ever succeed.** It retried anyway:

| | |
|---|---|
| first occurrence | `2026-09-01T20:43:21Z` |
| still running at | `2026-09-04T10:33` — **62 hours** |
| refusal log events for that one session | **232,056** (~6 per cycle, so ~38,600 cycles) |
| rate, measured over three 30-second windows | **~2 per second**, flat |
| `daemon.log` | **484 MB** |
| what `cello_inbox` told the operator | `times: 58` |
| evidence rows retained | **1** — `023`'s dedup held perfectly under this |

**IT SURVIVED DAEMON RESTARTS.** The 62 hours span several. **This is the single most important fact
in this order**: an in-memory marker does not fix it. Whatever marks the refusal permanent must be
durable, or the loop resumes on the next `cello login`.

### The cycle, exactly

Every ~3 seconds, all of it on the **RECEIVER**:

```
session.content.leaf_unresolved.fetch        ← the backstop fires
content.recover.verified                     ← the bytes arrive and verify
session.content.cross_check.failed           ← reason: session_committed
session.content.quarantine.duplicate         ← 023's dedup, working
content.recover.annex.salt_unavailable       ← ERROR, every cycle
```

### The producer/consumer, mapped

- **Consumer:** `#scheduleLeafFetchIfUnresolved(agentName, sessionId, contentHashHex)` in
  `core/daemon/src/session-node-manager.ts`. It returns early if
  `this.#resolvedContent.get(key)?.has(contentHashHex)`. Otherwise it sets a timer that calls
  `#fireParkedDrain(agentName, "witnessed_leaf_unresolved")`.
- **Producer of the stop condition:** `#markContentResolved(...)`, whose own docstring says it is
  *"Called wherever content actually lands."*
- **The gap:** refused content never *lands*, so `#markContentResolved` is never called, so
  `#resolvedContent` never gains the hash, so the next redelivery schedules another fetch. Forever.

**`cello_dismiss` does NOT stop it** — measured before and after, 60 events per 30 s either side. The
only thing that stopped it was `cello_set_agent_offline`.

> ⚠️ **`CELLO_Support` IS OFFLINE RIGHT NOW** as the only available mitigation. Bringing it back
> online before this unit ships restarts the loop. **Bring it back online as the last step of this
> unit and confirm the loop does not return** — that is DoD 7.

---

## Part 1 — A terminal refusal is a NEW concept, and it is not "resolved"

**Do not reuse `#markContentResolved` for this.** "Resolved" means *we have the content*. A refused
message is the opposite: we have it and are never accepting it. Overloading the name makes a later
reader believe refused content was delivered.

Add a sibling — `#markContentTerminallyRefused(agentName, sessionId, contentHashHex)` — that:

- cancels any pending leaf-fetch timer for that `(agent, session, contentHash)`, exactly as
  `#markContentResolved` does;
- records the fact **durably**, not in a `Set` on the instance;
- causes `#scheduleLeafFetchIfUnresolved` to return early for that content hash, forever.

### The terminal set is EXACTLY ONE reason, and widening it is out of scope

```
TERMINAL_REFUSAL_REASONS = { "session_committed" }
```

**Justification, which must survive review:** a committed session carries a signature over its
contents. Nothing can be appended to it by anyone, including the counterparty, including us. There is
no future state in which this content is accepted. That is the bar for "terminal".

**DO NOT ADD ANY OTHER REASON**, however obviously permanent it looks. Each of the tempting ones
fails the bar for a reason worth writing down:

| Reason | Why it is NOT in the set |
|---|---|
| `content_hash_mismatch` | The fetch is *by content hash*. A later fetch may retrieve a correct copy from a different relay. Retrying can succeed. |
| `sender_unresolved` | The sender may become resolvable — a profile arrives, a directory syncs. Retrying can succeed. |
| `session_orphaned` | `024-ORPHANTRIAGE` owns this path and decides its disposition. Not yours. |
| `session_size_limit_exceeded` | Looks monotonic, and the cap *is*. But the bound is a setting, and an operator raising it must un-stick the conversation. |
| the screener's transient block | Transient is in its name. |

If you believe another reason belongs, write it under *Newly discovered* and **do not add it**.

### Durability — pick the store, and say which in the journal

The marker must survive a daemon restart. `023-REFUSEDEVIDENCE` already writes a durable quarantine
row per `(session, reason, bytes)` and already dedups on it — that row is the natural source of
truth, and consulting it costs no new schema. **Take that if it works.** If it does not, add the
smallest durable record that does, and say in the journal which you took and why.

**Key on `agent_id`, never `agent_name`.**

---

## Part 2 — The count the operator sees must not be a lie

`cello_inbox` returned `times: 58` while the true figure was four orders of magnitude larger. The
code is not "wrong" — `times: r.count` in `core/daemon/src/notification-handlers.ts` reports a
counter that is **drained when the inbox is read** (`session-content-handlers.ts`: *"the operator is
told once per reason per session"*). So 58 was refusals *since the last read*.

**The defect is the prose, and the prose is load-bearing.** The guidance ships this sentence:

> *"`times` is how many messages that reason has refused on that session — a large number means the
> cause is still live, not that it happened once."*

That claims a lifetime figure. It is a since-you-last-looked figure. An operator — or an agent
deciding whether to escalate — reads 58 and concludes "minor". The real answer was "this has been
running for two and a half days and has written half a gigabyte".

**The fix, pre-decided:**

1. Report **both** numbers. `times` keeps its drain semantics and gains a companion lifetime total
   from the durable record. Name them so neither can be mistaken for the other.
2. **Rewrite the guidance sentence to say what each number is.** It must be impossible to read the
   smaller number as a lifetime count.
3. `repeat: true` currently means *"you have been told about this and it has grown by an order of
   magnitude"* — check that claim still holds against whichever number it compares, and correct it
   if it does not.

> ⚠️ **This is operator-facing COPY.** Draft the new guidance sentence, put it in the Review section
> below, and **do not consider the unit closed on wording alone** — Andre owns copy. Ship the
> mechanism; flag the words for him.

---

## Definition of Done

1. A refusal whose reason is in `TERMINAL_REFUSAL_REASONS` cancels the pending leaf fetch and
   prevents any future one for that content hash.
2. **The marker is durable.** Prove it: mark, restart the daemon (or reconstruct the manager from the
   store), and show no fetch is scheduled. **A test that only exercises an in-memory `Set` does not
   close this line** — the production loop crossed several restarts.
3. `session_committed` is the only member of the set, and the code says why in a comment a reviewer
   can check.
4. **A non-terminal refusal still retries.** Prove the fix did not silence the healthy case: a
   transient refusal must still schedule its fetch.
5. `cello_inbox` reports both the since-last-read count and a lifetime total, and the guidance names
   which is which.
6. Nothing interpolates refused content into a log line, an error, a path or a prompt.
7. **The live loop is gone.** Bring `CELLO_Support` back online, wait 3 minutes, and show **zero**
   events for session `dcec3c3fb9856065d2f27b4673f0f40a` — against the ~120/minute baseline recorded
   above. Quote the before and after.
8. **Each new assertion has been made to fail on purpose**, and confirmed to fail for the reason
   expected. **Commit before the mutation loop exists.**
9. Gate passes in cello-client. State whether anything publishes.
10. Reviewed by `cello-unit-reviewer`, every finding fixed, verdict quoted below.
11. `DOD-M15-REFUSALTERMINAL-1` flipped to ✅ in `M15-DEFINITION-OF-DONE.md`, in the same commit as
    the verdict, and the row for items **1 and 2** in that file's *FOUND LIVE 2026-09-04* table
    updated.

**Not in scope:** the per-peer knock ledger (its own design, see the 2026-09-04 walling-off log);
widening the terminal set; `024-ORPHANTRIAGE`'s unknown-session disposition; the heartbeat fork alarm
(`026`).

---

## Traps recorded before you start

**An in-memory marker looks like it works and does not.** The whole defect crossed daemon restarts.
If your test restarts nothing, it proves nothing.

**"Resolved" and "terminally refused" are different facts.** Collapsing them tells a future reader
that refused content was delivered.

**Do not widen the terminal set to be helpful.** A reason wrongly marked terminal silently drops a
message that would have arrived on the next try — the failure this unit creates if it overreaches,
and it is worse than the loop.

**The count fix is not a code fix.** The number was accurate for what it measured; the sentence
describing it was false. Changing the number without changing the sentence moves the lie.

**`agent_name` is a display label.** Key on `agent_id`.

**ANOTHER LANE MAY BE RUNNING.** If you bring up Postgres, export a `COMPOSE_PROJECT_NAME` unique to
your worktree AND a unique `CELLO_PG_HOST_PORT`.

**Work in a PAIRED worktree** — `<lane>/cello-client` and `<lane>/trustless-cello` as siblings, and
load `/worktree-permissions` before creating one.

---

## Review

### Where this work lives
*(worktree paths, branch, and the `COMPOSE_PROJECT_NAME` / `CELLO_PG_HOST_PORT` you used)*

### Proposed guidance copy for Andre
*(the rewritten `times` sentence — mechanism ships, wording is his)*

### The rest
*(the before/after event counts from DoD 7, the mutation proof from DoD 8, the reviewer's verdict)*

## Newly discovered

*(anything found and NOT acted on, per rule 3)*
