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
- **`DOD-M12B-ACK-1` is DIAGNOSED, not fixed** (Entry 2): the ack write fails with
  `"Cannot write to a stream that is closed"`, 36 times, one error. Why the stream is closed is
  the remaining work.
- **Relay loss is now Tier R** (Entries 3–4), sequenced AFTER Tier E but constraining Tiers A and B
  from now via the failover-preservation lens. Failover is client-driven permanently;
  `FEDERATION-003`'s predecessor-ACK carry is the sanctioned seam. Also constrains
  `DOD-M12B-RELAY-IDEM-2`.
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


## Entry 2 — The first acknowledgement: traced (2026-08-17)

**`DOD-M12B-ACK-1` diagnosis complete; cause of the closed stream still open.**

### The producer/consumer chain
- **Producer (receiver):** `#sendDeliveryAck` opens a **fresh stream** to
  `entry.counterpartySessionPeerId` on `/cello/content/1.0.0` and writes one
  `content_delivery_ack` frame at `level: "persisted"`. Logs `content.delivery.ack.sent`.
- **Consumer (sender):** `#handleContentStream` reads **exactly one frame per stream**
  (`await iter.next()`, then return), and on `content_delivery_ack` + `persisted` calls
  `#resolveAwaitingAck` — which cancels the TTF timer and logs `content.delivery.acked`.
- A hold is **deliberately never acknowledged**: *"deliberately NOT for a transient hold."*

### The measurement
Per-session event counts from the live daemon log:

| session | ack.sent | acked | **ack.send.failed** | ttf_expired | held |
|---|---|---|---|---|---|
| `9cf17bbe` | 13 | 12 | **19** | 59 | 20 |
| `25f9b36e` | 0 | 0 | 0 | 18 | 36 |
| `01b578eb` | 1 | 1 | 0 | 1 | 1 |

**`content.delivery.ack.send.failed` fired 36 times across the log, with exactly ONE distinct
error, every time:**

```
"Cannot write to a stream that is closed"
```

### What this establishes
The receiver appends and verifies the content, then fails to deliver the acknowledgement because
the stream it just opened is closed. The sender never learns the content landed, its 20-second TTF
expires, it parks and retries — and the retry takes a NEW canonical position. **That is the ignition
step for the spiral in Entry 1**, and it needs no hold to start: the first ack simply never arrives.

Note `25f9b36e` (the Hermes session): **zero acks sent, zero received, 36 holds.** Once everything is
held, nothing is acknowledged by design, so the spiral is self-sustaining there without any further
stream failure.

### What is NOT established — the unit's remaining work
**Why the stream is closed.** Three candidates, none tested:
1. The underlying connection to the counterparty is already gone, so `newStream` returns a stream
   that is closed on arrival.
2. `stream.send(lp.encode.single(frame))` is **not awaited** and the enclosing `#sendDeliveryAck`
   returns, racing the stream's close.
3. The peer closed the inbound direction after sending content, and the ack dial reuses/collides
   with that muxer state.

This is a code question, not a log question. `DOD-M12B-ACK-1` stays ❌ until the cause is proven and
the fix is red-tested.

---

## Entry 3 — Relay loss: no handoff exists, and the record dies silently (2026-08-17)

Raised by Andre, 2026-08-17: *"What happens if a relay goes down or is unreachable? I'm concerned
about the handoff to another relay."* Traced.

### There is no handoff
A session is bound to **one relay for its whole life**. The directory issues a signed
`RelayAssignmentCarry` at establishment which the client presents to its chosen relay
(`FED-OPTIONB-SETUP-001`, Option B). No other relay ever holds that session's `seq_counter`,
`leaf_log`, or `running_root`, so no other relay can adopt it.

### What happens when that relay dies
1. Session state is **in memory only** — the client comment on `relay_session_gone` says it "fires
   for perfectly live sessions whenever the relay restarts, because the relay stores sessions in
   memory."
2. Submissions then hit `relay-node.ts:1075` — `const state = this.#store.getSession(sessionKey);
   if (!state) { await reply("session_not_found"); return; }`.
3. **GOOD: the counter does not restart and re-issue colliding positions.** The relay refuses. That
   failure mode does not exist, and this was worth confirming before assuming the worst.
4. **BAD: the client treats `relay_session_gone` as non-terminal.** It warns and carries on sending
   directly, unwitnessed — so delivery continues while the record stops growing. Already measured
   in-tree, 2026-08-09: *"a session whose relay had sealed it after both away-responders fired ran
   for 68 more minutes and 8 more messages, every send reporting success, against a chain that had
   stopped growing at six leaves."*
5. **No way back.** On reconnect the client deliberately does not re-record the session — the
   assignment is documented as "absent … on the restart/persisted reconnect path (the relay already
   recorded the session at first establishment)." Once the state is lost it cannot be restored, and
   the session can never be witnessed again.

### Bearing on M12B
This does not change the ordering fix, but it constrains `DOD-M12B-RELAY-IDEM-2`: an idempotency
record kept in the same in-memory store inherits exactly this lifetime. If the answer to IDEM-2 is
"do not persist", then `DOD-M12B-CLIENT-REUSE-1` is not defence in depth — it is the only guard that
survives a relay restart, and the DoD must say so plainly.

**Filed as out of M12B scope, needs its own home:** a session whose relay is gone should either
retire loudly or be re-recordable somewhere, rather than continuing to report success against a
chain that stopped growing. Candidate for launch-triage in its own right.


## Entry 4 — Relay failover is client-driven, and the primitive already exists (2026-08-17)

Andre, 2026-08-17, on the Entry 3 finding: *"Relays going down and losing the session is a pretty
important point, but I think it's a different problem. Probably we do it in the same milestone but
we do it after we've completed this… if we're rewriting stuff we probably should rewrite it with
this problem in mind… And given that the relay could just stop functioning at any point, it can't be
the relay handing it over."*

Acted on: the work moved OUT of "Explicitly beyond" and INTO **Tier R**, sequenced after Tier E, with
a standing constraint on Tiers A and B and a matching blocking reviewer lens (procedure §2b,
"failover-preservation").

### The reasoning is already the design
`FEDERATION-003` implements exactly the shape Andre derived from first principles. A submission may
carry `predecessor_relay_id`, `predecessor_relay_signature`, `predecessor_relay_sequence`,
`predecessor_relay_timestamp` (`relay-types.ts:95-98`). The **client** presents the dead relay's
signed ACK; the successor fetches the predecessor's public key from the **directory**
(`getRelayPublicKey`) and verifies `Ed25519.verify(pubKey, buildRelayAckTbs(hash, seq, ts), sig)`
before accepting (`relay-node.ts:1106-1130`). Rejection is unconditional on a bad signature (SI-002,
no fallback). **No relay-to-relay contact anywhere** — the only shape that survives a relay that
simply stops.

### The gap in it — filed as DOD-M12B-RELAY-LOSS-1
After verification the code comments "Predecessor ACK verified — proceed to process the
re-submission", and the path falls through to `const seq = state.seq_counter + 1` on the NEW relay's
own state. **Whether the successor continues numbering from `predecessor_relay_sequence` or restarts
from its own counter is NOT established.** If it restarts, the primitive verifies a handover it
cannot complete. Stated as a gap to trace, not as a defect — this was read, not run.

### Also established, and worth not re-deriving
The relay REFUSES with `session_not_found` when its state is gone (`relay-node.ts:1075-1076`) rather
than restarting its counter and issuing colliding positions. **Colliding positions are not a failure
mode.** The damage from relay loss is silence — a session that keeps reporting success against a
chain that stopped growing — not corruption.
