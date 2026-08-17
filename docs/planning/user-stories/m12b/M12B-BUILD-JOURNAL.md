---
name: M12B Build Journal
type: build-journal
date: 2026-08-17
milestone: M12B
status: open
topics: [m12b, relay, ordering, idempotency, build-journal]
description: >
  Append-only audit trail for M12B (the relay↔client ordering defect — idempotent submission and
  position discipline). Entries at END OF FILE only; the RESUME STATE block at the top is the only
  thing overwritten in place. Full proofs, reviewer verdicts, and run output live here — the DoD
  stays a scoreboard.
---

# M12B Build Journal

## RESUME STATE (overwrite in place — the ONLY mutable block)

- **NEXT ACTION: `DOD-M12B-TRACE-1`** — name the resubmitter with file/line evidence. No code
  ships from Tier T. Do not write a fix that compares two counters until TRACE-2 has listed all
  three of them.
- **Nothing is built.** Every DoD line is ❌. The only artefact that exists is the pinned
  regression test, committed deliberately red (see Entry 1).
- **HEAD at milestone open:** trustless-cello `2ee4dec5`, cello-client `7384489`.
- **Published versions:** unchanged — no publish has happened for this milestone.
- **Relay fleet:** unchanged. No M12B relay roll has occurred. When one does, §2f of the procedure
  governs it: relay tolerates the new field FIRST, one push per roll, node by node, poll a real
  `GET /bootstrap` 200 before touching the next.

---

## Entry 1 — The investigation that opened this milestone (2026-08-16 → 08-17)

**Not a build entry.** This records what was measured before any unit existed, so the first coder
does not repeat it. Full narrative:
[[2026-08-16_1930_one-way-content-loss-the-ordering-counter-both-sides-disagree-on]].

### How it presented
A session between two healthy agents could not be opened, reported as `counterparty_offline` — an
error naming the one component that was working. Roughly a day went into the network path, a
directory-node fault, and two withdrawn hypotheses before the messaging spine was suspected at all.

### What was measured, and how

| Claim | How it was established |
|---|---|
| Nothing is lost in transit | Relay sequences **1–55 delivered, complete run, zero gaps** for one session |
| Content arrives and verifies, then is refused | `content.recover.verified` → `session.content.held` on every frame, `screenedOut: false` |
| The gap widens by arithmetic | Holds at `(3,2) (4,2) (6,3) (7,3) (9,4) (10,4) (12,5) (13,5) (15,6) (16,6) (18,7) (19,7)` |
| The same message takes many positions | `cello relay-receipts`: session `f54e0d07` — **49 receipts, ONE distinct message, max sequence 98**; `1fbb7a72` — 76 receipts, 2 messages, max 157; one hash submitted **69 times** |
| Verified content is destroyed | `session.content.held.discarded` fired **20 times on one daemon in one day** |
| The counter is blind | `relay-node.ts`: `const seq = state.seq_counter + 1`, unconditional per accepted `hash_submit` |
| The relay counts a retry as a real leaf | Same block appends to `leaf_log` and advances `tree_stack` / `running_root` |
| The failure is one-way | Her transcript held everything sent to her; his held 3 of 6 sent by her. Shared document `93d17b00…`: his copy contained his own two lines and neither of hers |

### The false invariant
`session-node-manager.ts` states what the dedup path and the hold gate both rest on:

> *"The relay already assigns every submission a unique position: a REDELIVERY carries the same
> position, a genuinely new identical message carries a NEW one. So a duplicate is the same hash AT
> THE SAME POSITION — never the same hash anywhere."*

One identical hash holds 49 different positions. The premise is false in production.

### Two hypotheses asserted and withdrawn — recorded so they are not re-run
1. **"The relay counts two leaves per exchange while the local tree counts one."** Extrapolated
   from twelve consecutive holds and stated as mechanism. The aggregate refutes it: 55 relay
   sequences against 74 appends across two trees.
2. **"The split relay is the problem."** Ruled out — both daemons deposit to the same relay; the
   second returns `count=0` on every pull and never receives a deposit. Wasted round trip, not a
   loss. **Do not re-chase it.**

### What was NOT established
**Why the first acknowledgement fails.** The spiral needs exactly one unacknowledged send to start.
Held content is deliberately never acknowledged, and a 20-second TTF timer fires on every send in
production logs — but whether the first ack is never sent, never arrives, or arrives late was not
determined. That is `DOD-M12B-ACK-1`, and it is the one unknown left in the chain.

### Artefact left behind
`core/daemon/src/__tests__/msg-001-strict-in-order.test.ts` gained a regression that reproduces the
defect in three ingests: deliver a message, redeliver it at a NEW position, send a genuinely new
one — the new one is verified and stranded (`expected 1 to be 2`). Committed **`it.fails` on
purpose** (cello-client `7384489`) so the gate stays green and the test starts FAILING the moment
the defect is fixed. That flip is `DOD-M12B-ENFORCE-1`.

No fix shipped with it, deliberately: all three routes change what the Merkle tree contains, and
the root is what the seal signs over — the wrong choice silently invalidates receipts.

### The design that came out of it (Andre, 2026-08-17)
An idempotency key on the submission. The sender is the only party that knows whether it is
retrying, so it declares it and the relay enforces it; the relay keeps deciding the number and
simply stops issuing a second one for the same declared act. His framing, kept because it names the
deeper gap: *"there is a role for the relay to tell the daemon, hey you're full of shit, this is the
same submission."* Today the relay has no way to disagree with a client about anything.

Held back from that design, and now a Decision Carried: this is **correctness hardening, not
adversary defence.** A client that wants to burn positions can mint fresh submission ids and the
relay cannot stop it. What it buys is that an honest daemon with a bug can no longer silently
corrupt ordering.
