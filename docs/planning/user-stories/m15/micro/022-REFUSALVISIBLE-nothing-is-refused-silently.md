---
name: 022-REFUSALVISIBLE — Nothing is refused silently
type: micro-work-order
date: 2026-09-03
status: open
description: >
  Three refusal reasons reach the operator; NINE do not, including the screener block — the moment
  the product catches the attack it exists to catch. The three that ARE wired live in an in-memory
  map and surface only on the receive path, so an agent nobody is attending loses them and a daemon
  restart drops them. Make the notice durable and put it in the inbox, then wire the other nine.
  CLOSES DOD-M15-NO-SILENT-REFUSAL-1.
---

# **<ins>MICRO</ins>** WORK ORDER 022-REFUSALVISIBLE — Nothing is refused silently

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

> ## 🎯 THIS ORDER CLOSES A DoD LINE — `DOD-M15-NO-SILENT-REFUSAL-1`
>
> **Part 1 alone flips NOTHING.** It builds the mechanism; no new refusal reaches an operator until
> Part 2 wires them. An order that stops after Part 1 has done the invisible half. **Both parts, or
> the line stays open.**

---

## The rule this exists to enforce

**Andre, 2026-09-03:**
> *"Things shouldn't be silently refused. If you're refusing someone for something, your human
> operator should know about it."*

---

## Where this work lives — ONE REPO

- **`cello-client`** → `/Users/andrep/Documents/code/cello-client`. Paths beginning `core/…` are
  here, and **everything you edit is here.** Gate: `pnpm run test` / `lint` / `typecheck`, plus
  `pnpm run build` (this repo HAS a separate build).
- **`trustless-cello`** → `/Users/andrep/Documents/code/trustless-cello`. You edit only this order
  file, at the end. The journey in Part 3 runs from this root.

**This publishes NOTHING.** `core/daemon` is not one of the five published packages and no wire
format changes. **Do not bump a version, do not tag, do not publish.**

---

## What happens to you today

Somebody sends you a message. We refuse it — the screener catches an injection aimed at your agent,
or they crossed their size budget, or we could not establish who sent it. **You are told nothing.**
It is a line in a log file you have no reason to open.

**And even the three refusals that ARE wired are wired weakly:**

- They live in an **in-memory `Map`** (`#contentRefusals`), not a table. **A daemon restart drops
  them.**
- They surface only via `refusalsField` on the **receive path for that session**. So if you have
  switched to another agent, or nobody is attending that agent at all, **nothing surfaces** — and
  `cello_inbox` does not show them either.

That second half is the case Andre raised: *a connection is live, the daemon is up, but nobody is
attending that agent.* A notice that only arrives if someone happens to call receive on that exact
session is a log line with extra steps.

---

## The trace — done, do not re-derive it

**Wired today (3), all in `core/daemon/src/session-node-manager.ts`:**
`noteContentRefusal` at **8435**; call sites at **8650** (`content_hash_alg_unknown`), **8706**
(`content_hash_salt_unavailable`), **8730** (`content_hash_mismatch`). Drained by `refusalsField`
in `core/daemon/src/session-content-handlers.ts` at **~62–79**.

**The precedent to copy is already in the tree and does it properly:** `contact_rename_notices`
(`session-node-manager.ts` **~2766**) — a durable SQLCipher table, **keyed on `agent_id`** (the
stable key), surfaced as its own inbox category in `core/daemon/src/notification-handlers.ts`
(**267**, **305**, **348**). Refusals are the ones doing it the weaker way.

**Two properties the current code paid for and you MUST NOT lose** — both are documented in
`takeContentRefusals` at **8488**:

1. **Per-CONSUMER surfacing.** Two MCP windows attending one agent is ordinary. Under a single
   `surfaced` flag the first reader consumed the notice and the second was told nothing,
   permanently. Reading must stay non-destructive to other readers.
2. **Order-of-magnitude re-announce.** A reason re-announces when its count grows 1 → 10 → 100,
   marked `repeat: true`. The first refusal is the signal, the ninetieth is noise, but a skew that
   swallowed hundreds must still be visible.

---

## Part 1 — Make the notice durable, and put it in the inbox

**Follow `contact_rename_notices` exactly.** A new SQLCipher table, created the same inline way
(`CREATE TABLE IF NOT EXISTS`), **keyed on `agent_id` — never `agent_name`.** The existing map is
keyed on `agentName`, which is a mutable display label; moving to a table fixes that too.

The table must carry, per (agent_id, session_id, reason): the reason, impact, guidance, the count,
and **per-consumer read state** so property 1 above survives. Rename notices do not need that (they
clear on operator action), so this table is slightly richer than its template — that is expected.

**Add a `refusals` section to the inbox** alongside `rename_notices`, in `notification-handlers.ts`,
spread into BOTH inbox shapes (**305** and **348**) the way `documentSection` and `witnessSection`
are. **Keep `refusalsField` on the receive path working** — this adds a door, it does not move one.

**Carry `REFUSAL_GUIDANCE` across verbatim** (`session-content-handlers.ts` **~81**). It is well
written, it is the sentence that makes the notice actionable, and a previous unit's own note records
that a catch-up door destroyed exactly this guidance once already.

---

## Part 2 — Wire the nine (this is the half that flips the line)

Each of these is a refusal a counterparty's message can hit today with the operator told nothing.
**Call `noteContentRefusal` at each, with an `impact` and a `guidance` that say what the operator
should do.** All are in `session-node-manager.ts` between **8528** and **9200** unless noted.

| Reason | What the operator must be told |
|---|---|
| `inbound_screen_blocked` | **The one the product is about.** We caught something aimed at your agent and blocked it. Terminal block is at **~8919–8967** — it leafs, it acks, it never notes. |
| `governance_timeout` / `gateway_unavailable` | A TRANSIENT block: nothing recorded, nothing acked, so the sender will redeliver. Say that, so silence is not read as delivery. |
| `session_size_limit_exceeded` | **Every later message from that person is refused for the rest of this session.** From your chair they simply stop replying. |
| `session_committed` | The session is sealed; their message can never land here. |
| `session_orphaned` | Same shape. |
| `sender_unresolved` | We could not establish who sent it. |
| `transcript_write_failed` | Our own storage failed and the message is gone. |
| `delivery_impaired` / `content_undeliverable` | Carried on an earlier unit's pass-2 list and never surfaced. |

**⚠️ `counterparty_gone` is NOT in that table, deliberately — it needs a FIX, not a notice.** It
currently tells the operator their peer *"may have crashed or gone offline — call
`cello_close_session` to seal"* while the daemon holds the real reason in memory. **It hands them a
network story for a verification fault and steers them toward sealing**, which is a nudge into
exactly the truncated close `DOD-M15-WITHHOLD-SEAL-1` describes. **Rewrite that string to say what
was actually observed** (`DOD-M15-ERRSTRING-1`'s rule: name what was observed, never an inferred
conclusion), and surface it like the rest. **Fixing the silence and leaving this string is shipping
the worse half.**

**The cap SIZE is not in scope.** 25 MB is the lowest tier and known contacts get more. Andre's
point is the silence. **Do not raise the cap.**

---

## Part 3 — Prove it end to end

Extend an existing spine journey — **do not write a new harness** (`session-fixture.ts` /
`live-harness.ts`; a from-scratch fixture is a blocking review finding).

The journey must show, with two real daemons as separate OS processes:

1. A message that trips the screener produces an **operator-visible** refusal naming the cause.
2. **The notice survives the operator not being there:** the receiving agent is switched away from
   (or its daemon restarted) and the refusal is still visible afterwards through `cello_inbox`.
   That second half is the whole point of Part 1 and it is what the current in-memory map fails.

---

## Definition of Done

1. Refusal notices are durable in a SQLCipher table keyed on `agent_id`, survive a daemon restart,
   and appear in `cello_inbox` as their own category.
2. Per-consumer surfacing and the order-of-magnitude re-announce both still hold. **Prove it:** two
   consumer ids, both told; and a count crossing 10 re-announces with `repeat: true`.
3. All nine reasons in Part 2 call `noteContentRefusal` with an impact and a guidance.
4. `counterparty_gone` no longer asserts a crash it has not established, and no longer steers the
   operator to seal on a verification fault.
5. The journey in Part 3 is green, run as separate OS processes, output quoted.
6. **Each new assertion has been made to fail on purpose.** Remove one `noteContentRefusal` call,
   confirm the journey reddens for the reason you expect, restore it.
7. Gate passes in cello-client. **Nothing published.**
8. Reviewed by `cello-unit-reviewer`, every finding fixed, verdict quoted below.
9. `DOD-M15-NO-SILENT-REFUSAL-1` flipped to ✅ in `M15-DEFINITION-OF-DONE.md`, in the same commit as
   the verdict.

**Not in scope:** whether the SENDER is told their message was refused (a real question, and
Andre's — telling a legitimate sender is right, telling someone probing the screener helps them tune
it); `DOD-M15-SEALREJECT-MUTE-1`, the same principle at the seal door, which keeps its own line.

---

## Traps recorded before you start

**A push is not a fix.** If you find yourself sending a real-time notification to whoever is
attending, stop. The case this order exists for is *nobody is attending that agent*. Durable first,
and the inbox is the door.

**Do not put refusals in `unread`.** A refusal is not a message from your counterparty — it is the
daemon reporting something that did NOT arrive. Its own category, like `rename_notices`.

**Storage does not guarantee the human hears it.** The notice lands in an AGENT's inbox and an agent
can see it and say nothing. That is why `REFUSAL_GUIDANCE` must survive the move intact and the new
inbox section needs guidance of its own.

**`agent_name` is a display label.** Key on `agent_id`. Never put `agent_name` in a PRIMARY KEY,
JOIN or WHERE — the existing map keying on it is the bug, not the pattern.

**ANOTHER LANE IS RUNNING.** `021-HEARTBEAT` is in `trustless-cello`, so it cannot touch your files
— but if you run anything that brings up Postgres, **export a `COMPOSE_PROJECT_NAME` unique to your
worktree AND a unique `CELLO_PG_HOST_PORT`.** The port alone does NOT isolate you: both worktrees
derive the same compose project name, the second lane silently reuses the first's container, and the
failure reads as a killed container rather than a collision. Measured 2026-09-03.

---

## Review

### Where this work lives
*(worktree path, branch, and the `COMPOSE_PROJECT_NAME` / `CELLO_PG_HOST_PORT` you used)*

### The rest
*(the journey output, the mutation proof from DoD 6, the reviewer's verdict)*

## Newly discovered

*(anything found and NOT acted on, per rule 3)*
