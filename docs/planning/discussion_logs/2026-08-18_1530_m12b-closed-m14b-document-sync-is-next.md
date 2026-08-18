---
name: M12B closed, and why the next work is document sync
type: discussion
date: 2026-08-18
topics: [m12b, m14b, revival, document-sync, sealing, launch-triage, follow-through]
description: >
  Follow-through document. M12B's three cases are built and PROVEN LIVE with two real agents.
  The live test then exposed why an ordinary conversation cannot seal — background document sync
  writes into the conversation's own hash chain — which is M14B work, now filed there as two ruled
  lines. Read this cold to know exactly where things stand and what to do next.
---

# Where things stand, 2026-08-18

## M12B — DONE. All three cases proven live, not just green in CI.

| Case | What it is | Result |
|---|---|---|
| **A** | One side goes away and comes back | ✅ **8 seconds** (was 3 minutes) |
| **B** | Network drop / reconnect | ✅ proven by a real outage — Andre's phone died, ~100s unattended recovery, **zero sessions interrupted** |
| **C** | Daemon restart → session ends with a receipt | ✅ ran live 2026-08-18 07:55 UTC |

Evidence lives in `M12B-BUILD-JOURNAL` Entries 41–48. **Entry 48 carries the measurement that
settles case A** and the real-outage case B result.

**The principle M12B produced, ruled by Andre after six failed live rounds:**
> **A revived session must be indistinguishable from a freshly established one.**
> Anything establishment does that revival does not is a defect.

Establishment does five things: build the node, register the content handler, wire liveness,
**connect the relay witness**, dial the counterparty. Revival did three. The missing relay witness
was the single cause of three symptoms being chased separately (no doorbell, 3-minute delivery,
sends that could not park). A parity test now derives the step list from establishment itself.

**Still open in M12B, both non-blocking polish:**
- Direct re-dial after a break — why delivery is 4–8s instead of ~1s (everything routes via relay).
- `counterparty_gone` guidance says the peer "may have crashed", says no more content will arrive,
  and recommends sealing — while content sits at the relay. Following it strands a verified message.

## Published and promoted

`v0.0.252` → **latest**: connect `0.0.152`, cli `0.0.184`, daemon `0.0.177`, gateway `0.0.38`,
crypto `0.0.54`, transport `0.0.60`, protocol-types `0.0.58`. Verified against the tarball, not CI.

**UNPUBLISHED, on main only:** `40e62ea` (leaf-triggers-fetch, cello-client). Andre was last running
the LOCAL build for it. To put him back on npm: `cello logout && cello login`. To run the local build:
`cello logout` then `node /Users/andrep/Documents/code/cello-client/core/cli/dist/bin/cello.js login`.

## THE FINDING THAT REDIRECTS THE WORK

Test 2 passed on delivery (102s → 4s) and then **neither side could seal**. Symmetric
`session_incomplete`, `missing_leaves: 2`, each side missing exactly one position from the other.

**Cause, measured on the live store:** 24 documents still marked `active` (oldest 2026-08-07, none
created that day). A reconcile sweep fires every ~2 minutes per document and writes an `ack` frame
into **whatever session those two agents currently have open**. Each frame takes a position in the
CONVERSATION's hash chain. On the test session: **34 relay positions, 2 of them real messages.** The
sweep had run 1,803 times.

**This was already documented** — launch-triage **item 22**, written 2026-08-17, which:
- states the sequence-sharing is deliberate and was **deferred**: *"separating them changes what the
  tree contains, and the tree root is what the seal signs over, so it risks existing receipts"*
- records that no resend-by-position protocol exists: *"nothing can ever say 'I am missing position
  N, resend'… a gap only closes by luck"*
- warns the 2026-08-17 fix **removed the engine, not the defect**
- set the tripwire: ***"re-open if any gap appears on a session after the flood fix is live"***

**That tripwire fired 2026-08-18. Andre ruled: fix it.**

**Consequence for `40e62ea`:** the leaf-triggered fetch pulls the agent's mailbox. It CANNOT request
a specific missing position, because no such request exists. It will never close a gap. It is not
wrong, but it is not the fix.

## THE WORK, in order — all in M14B

Andre's ranking, 2026-08-18. Everything else in M14B is multiplayer features — **skip for now.**

1. **`DOD-DOC-PUSH-NOT-POLL-1`** — sync only on an actual pending change, never on a bare timer.
   Cheapest, no receipt-shape consequence, stops the bleeding on its own. Old documents go quiet
   immediately.
2. **`DOD-DOC-SEQUENCE-SEPARATE-1`** — document frames get their own sequence space, out of the
   conversation tree the seal signs. **This is what unblocks sealing.** Accepted cost, to be stated
   not hidden: a session sealed before this change has document frames baked into the root its
   receipt covers; one sealed after does not.
3. **`DOD-MP-DELIVERY-QUIET-1`** — background sync must not ring the doorbell / push the phone.
4. **`DOD-MP-SWEEP-ALIVE-1`** — the delivery sweep must not silently stop.

1 and 2 fix *"two agents cannot get a receipt."* 3 and 4 fix *"the system spams you then quietly dies."*

Lines 1 and 2 were filed in `M14B-DEFINITION-OF-DONE` by commit `1608defd`, immediately above
`## Related Documents`.

## Standing rules that cost real time when forgotten

- **Live tests: a FRESH session every run.** A daemon restart destroys the old session's transport
  identity — correct behaviour, and it confounded two rounds before anyone noticed.
- **Brief the other window, never script it.** Miss_Chelly reading a response carefully and
  reporting "no change" is what caught the guidance defect.
- **The reviewer finds what the gate cannot.** On 2026-08-18 it found three HIGHs in work already
  called done, one of them worse than the bug it replaced (a retry drain that would have parted the
  hash chain permanently — now deliberately unwired, with the reason recorded at the call site).
- **A fake kinder than reality proves nothing.** A test fake whose `stop()` always worked passed
  against the broken code; libp2p's returns immediately unless the node is `'started'`.
