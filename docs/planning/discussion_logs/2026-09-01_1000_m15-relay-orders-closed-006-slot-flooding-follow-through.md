---
name: M15 relay micro orders closed; 008-RELAY slot flooding is next — follow-through
type: discussion
date: 2026-09-01
status: current
topics: [m15, relay, micro-work-orders, reservations, slot-flooding, relayauth, relayabuse, compaction, follow-through]
description: >
  All four M15 relay micro orders (002/003/004/005) are closed and merged. The next unit is
  008-RELAY, an agent cannot flood a relay's reservation slots, whose full design was worked out in
  conversation on 2026-09-01 and written into the order. This carries the exact state, the design
  decisions and why the rejected options were rejected, and the one filing problem to resolve first.
---

# M15 relay orders closed; 008-RELAY is next (2026-09-01)

## Read these first, in this order

1. `docs/planning/user-stories/m15/M15-PROCEDURE.md` — the SOP. Still governs.
2. **`docs/planning/user-stories/m15/micro/008-RELAY-reservation-slot-flooding.md`** — the next unit.
   It is self-contained: both attacks, the token, the slot accounting, two non-negotiables, a build
   checklist, and its own DoD.
3. This document, for what spans the orders and for the reasoning that did not fit in 006.

> ⚠️ The micro-order rules forbid reading or writing `M15-DEFINITION-OF-DONE.md` and
> `M15-BUILD-JOURNAL.md`. That fence is why this is a discussion log. Do not "fix" that.

## Exact state

| Repo | Branch | HEAD |
|---|---|---|
| trustless-cello | `main` | `5ad6ad58` (this document's own commit) |
| cello-client | `main` | `9d1ee85` |

Both level with origin. **No open branches** — every M15 relay branch is merged. cello-client's tree
is clean; trustless-cello's carries the OTHER LANE's uncommitted `packages/operations-agent/` work,
so commit by explicit path and never `git add -A`.

| Order | Status |
|---|---|
| `002-RELAY-requires-an-assignment.md` | **complete** — but see the moved work item below |
| `003-RELAY-rate-limiting-and-idle-timer.md` | **complete** |
| `004-RELAY-admin-dead-frames.md` | **complete** |
| `005-RELAY-checked-then-ignored-sweep.md` | **complete** |
| `008-RELAY-reservation-slot-flooding.md` | **open — this is the next unit** |

## ✅ The order number collision is RESOLVED — it is `008-RELAY`

It was created as `006-RELAY` while `006-CRYPTO-close-out-our-own-encryption.md` already existed (and
`007-CRYPTO` after it), so "start 006" was ambiguous. **Andre ruled on 2026-09-01: one flat sequence
across all lanes, so it is renamed to `008-RELAY-reservation-slot-flooding.md`.** References in this
document and in 002/003 were updated in the same commit. If you see "006" for slot flooding anywhere,
it predates the rename.

## What is DONE (all merged to `main` in both repos)

- **002** — the relay refuses a circuit dial unless it holds a directory-signed assignment naming
  both peers. Two review passes; the second refused the merge on three blocking findings, all fixed.
- **003** — rate limiting on auth and hash_submit, the idle timer wired on in production, circuit
  duration/byte caps restored. Eight re-review findings fixed.
- **004** — three dead admin frame types deleted. Re-reviewed on Opus; four findings fixed.
- **005** — checked-then-ignored sweep of the relay package. Security conclusion confirmed on
  re-review; four items fixed.

**Two pre-existing test failures, neither ours, both re-confirmed on 2026-09-01. Do not chase them.**
- trustless-cello: `expect-present-enforcer.test.ts` flagging `j-suspend-tofn.spine.test.ts:279`.
- cello-client: `mcp-001-agent-lifecycle.test.ts` AC-002. Verified independently, not just trusted:
  `daemon.ts` is untouched by any M15 relay branch and the field it trips on is already on `main`.

Gate at close: **2350 passing** (trustless-cello, `CELLO_ENV=local` with Postgres up), **4582**
(cello-client), plus the two above.

## 002's second work item was MOVED, not done

002's work section had three items. **Item 2 — "verify the authenticating key is a registered agent"
— was never implemented.** It is now Part 1 of 008-RELAY. Closing 002 did not close that work.

**How it went missing is the reusable lesson: 002's Definition of Done had no clause for it.** All
six clauses passed and all six were about something else, so the order read as fully done while a
third of its stated work was untouched. A work item with no DoD clause is invisible to the gate meant
to catch exactly that. **When writing 006's own DoD, check every work item has a clause.**

## The 006 design, and why the rejected options were rejected

Recorded so nobody re-derives the dead ends. The order itself carries the design; this is the trail.

**Two attacks, and the second only appears once the first is closed.**
1. Mint 4096 keypairs, take every slot. Proving key possession proves you hold *a* key, nothing more.
2. Once that is closed: open 4096 sessions between two agents you own, one message down each, and
   take the table again with slots that no "unused slot" cap counts.

**Rejected, with reasons:**
- *Per-peer or per-pubkey limits* — the attacker varies both; the limits are never approached.
- *Cap reservations held by peers that have not proven key possession* — **withdrawn after being
  proposed.** Their throwaway keys are real keys, so they authenticate, cancel their own revoke
  timer, and leave the unproven pool within seconds. It bounds nothing and risks denying brand-new
  agents.
- *Require a session assignment (002's clause 2 as originally written)* — chicken-and-egg. An
  assignment only exists after a session; a brand-new agent has none at the moment it first needs one.
- *Relay asks the directory per reservation* — puts a round trip on the reservation path and forces a
  relay that cannot reach a directory to choose between refusing everyone and failing open.

**Chosen: a token issued at agent start.** The directory already marks an agent online over a
persistent signaling stream *before* the standing receiver asks any relay for a slot. It issues a
short-lived token bound to the agent's public key at that moment; the client presents it; the relay
verifies one signature against directory keys it already holds. No round trip, no chicken-and-egg.

**A rule was relaxed to get here, and Andre asked that it not be dramatised.** 002 carries "the relay
does not query the directory" as settled design. It is a preference for keeping that unit focused,
not a prohibition — the relay already registers with the directory, submits seals, and asks it for
other relays' public keys. Prefer not to; fine where it helps.

## Facts established in conversation that 006 depends on

- **Slots are requested at `cello_start_agent`**, not at session time, and again each time a receiver
  is promoted into a session (a replacement is built behind it). So one agent legitimately holds
  roughly one slot per live conversation plus one waiting.
- **Activity is a sounder signal than session bindings** for "is this slot in use". The relay carries
  the traffic so it cannot be wrong about it, and it is sound *because* nothing can flow until the
  assignment was presented. Binding-based classification is wrong in three ordinary cases: the
  session never touched that relay, the assignment arrived late, or the session ended while the
  reservation lingered.
- **Activity alone needs a demotion path**, or a slot that once carried traffic is exempt forever.
  The 24h session idle timer is that path — which makes that number load-bearing for this attack,
  where it previously was not.
- **Every daemon restart consumes a fresh slot** and the old one is held for its full TTL, because
  the peer id changes and the relay cannot tell it is the same agent. That is an ordinary bug, not an
  attack, and the token is what makes it fixable.
- **A relay restart wipes all reservations and session bindings**; parked mail and the vouched-key
  list survive on disk. Counting must survive being reset to zero, which is fine — it rebuilds from
  what actually happens.
- **After a relay restart a resuming session and a fresh standing receiver ARE distinguishable** —
  the resuming one re-presents its assignment. But today that re-presentation is *reactive*, fired by
  a failed submit rather than by reconnecting. **006 requires making it part of reconnect**, which
  removes the ambiguity entirely.
- **The 4096 ceiling is ours.** libp2p ships 15, which caused a real outage. Not to be reverted, but
  it is a number we chose.

## Still open, separate from 006

**Session bindings on a gating relay are cleared only by the 24h idle timer.** A relay that gated a
dial but never witnessed the session sees no seal, so a past counterparty can hold a valid dial
permission for up to a day after a conversation ends. Raised, not fixed, not in 006's scope.

## The three things most worth not forgetting

1. **Refusing too eagerly is the failure mode in this area, not refusing too little.** Every outage
   here came from denying a legitimate agent its slot. 006 encodes this as reap-before-refuse and
   "when unsure whether a slot is in use, treat it as in use."
2. **A refusal that only reaches the relay's log does not exist.** 006's DoD makes this testable by
   asserting on what the CLIENT surfaced, not what the relay logged — and requires an affordance with
   every refusal, because people do not know what sessions they have open.
3. **A confident comment is how these defects survive.** 004's re-review found a rewritten protocol
   header that asserted something false in a milestone that is deleting code from that protocol. The
   old header was merely incomplete; the rewrite was assertive, wrong, and DoD-stamped.
