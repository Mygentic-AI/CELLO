---
name: 003-RELAY — Relay rate limiting, and the idle timer that is off in production
type: micro-work-order
date: 2026-08-24
status: open
description: >
  Three relay paths still have no rate limiting of any kind, and the per-session idle timer exists
  but the production binary never passes it. Add per-peer and per-pubkey limits to the three
  remaining paths, and switch the timer and the relayed-connection caps on. Source: DOD-M15-RELAYABUSE-1.
---

# **<ins>MICRO</ins>** WORK ORDER 003-RELAY — Relay rate limiting and the idle timer

> ## THE RULES OF A MICRO WORK ORDER
>
> 1. **This file is the whole world.** Do not read or write `M15-DEFINITION-OF-DONE.md`,
>    `M15-BUILD-JOURNAL.md`, or any other milestone document. Everything you need is here.
> 2. **MICRO means small.** One mission. Follow it to its end. **Never grow the mission.**
> 3. **Found something else?** Write it under *Newly discovered* at the foot of this file and
>    **keep going**. Do not fix it. Do not open a line for it. Do not investigate it.
> 4. **500 lines, hard cap.** If this file is growing, you are writing detail nobody needs.
>    Minimal without omitting anything. No scratchpad. No narration of what you tried.
> 5. **Standard procedure still applies:** implement → review (`cello-unit-reviewer`) → fix every
>    finding → commit. Commit per fix, push after every commit.
> 6. **Done is done.** When the Definition of Done below is met, stop. Do not look for more.

---

## The problem, plainly

Point a coding agent at the relay and ask *"what stops someone hammering this?"* and the answer is
**nothing**, on most paths. That is the shape of finding that costs trust whether or not anyone ever
exploits it.

Separately, the relay has a per-session idle timer. It is written, it works, and **the production
binary never passes it in** — so the only thing reclaiming sessions is a 24-hour sweep.

## What is already done — do not redo it

Two of the five paths were closed earlier in this milestone:

- **Content-park deposit** — has a per-peer limiter, both halves, reviewed.
- **Liveness query** — scoped to a named participant.

**Read both before you start.** If either turns out not to be as described, record it under *Newly
discovered* and work the three below anyway. Do not go and fix it.

---

## The work

### 1. Rate limiting on the three remaining paths
Per peer **and** per pubkey, on:

- **authentication**
- **hash submission**
- **gap-fill**

### 2. Turn the per-session idle timer on in production
The feature exists. `bin/relay.ts` never passes it. Pass it.

### 3. Restore the caps on relayed connections
The default limit capping a relayed connection's **duration** and **bytes** is deliberately disabled.
Restore both.

---

## Definition of Done

1. Each of the three paths refuses when its limit is exceeded, and the refusal **names its cause** —
   the caller can tell "you are being throttled" from "the relay is down".
2. A throttled caller is told **when** it may retry, and that number comes from the relay rather than
   being guessed by the client.
3. The production relay binary passes the idle timer. Prove it from the binary, not from the config.
4. Relayed connections carry a duration cap and a byte cap.
5. Every new test has been **made to fail on purpose** — revert the fix, confirm it reddens, confirm
   it reddens for the reason you expect.
6. `pnpm run test`, `pnpm run lint`, `pnpm run typecheck` pass.
7. Reviewed by `cello-unit-reviewer`, every finding fixed, verdict quoted below.

**Not in scope:** requiring an assignment (002-RELAY), the admin frame types (004-RELAY),
infrastructure-level flood protection, anything in the directory or the client.

---

## Traps recorded before you start

- **A limit nobody hears is not a limit.** If the refusal only reaches a log line, it is not done.
- **Throttling is not an outage.** Guidance that tells an operator their message was lost, when it was
  queued, is worse than saying nothing. This exact mistake was made and caught earlier in this
  milestone.
- **One definition per refusal string.** Two copies that happen to agree today will drift.
- **Do not weaken an existing assertion to make a new test pass.**

---

## Review

*(Reviewer verdict. One quote. Not a transcript.)*

---

## Newly discovered

*(One or two lines each. Do not act on them.)*
