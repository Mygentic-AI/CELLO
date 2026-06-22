---
name: 2026-06-22_1745_strict-in-order-content-recovery
type: discussion
date: 2026-06-22
topics: [content-delivery, recovery, ordering, DOD-MSG-4, DOD-MSG-8, relay-mailbox, delivery-ack]
status: decided
description: >
  Decision on DOD-MSG-4 (recovery instead of desync). Instead of building gap-repair
  machinery for out-of-order message arrival, the receiver enforces strict in-order
  delivery: it only accepts the next expected sequence, holds anything ahead, and fetches
  the missing message from the relay mailbox. This reuses the existing delivery-ack + park
  design and removes the need for slot-reservation and resend-from-sender. The only case
  it cannot recover is true loss (sender crashed before ack or park) — that is DOD-MSG-8.
---

# Strict in-order content recovery — DOD-MSG-4 decision

## The decision (plain)

The receiver (B) processes messages strictly in order. It only accepts the next expected
sequence number. If a message arrives out of order — say B is on 2 and a direct message 4
shows up before 3 — B holds 4 and goes and gets 3 first. B fetches 3 from the relay mailbox.
Once 3 is in place, B accepts 4.

We do NOT build the "gap repair" machinery that was the alternative:
- No reserving an empty slot for a missed message and filling the content in later.
- No "ask the sender to resend" step.

Both of those only existed to repair an out-of-order arrival after the fact. Strict in-order
prevents the out-of-order arrival, so there is nothing to repair.

## Why this works — the existing sender guarantee

We already built the sender to know whether each message landed. After A sends a message
directly, A waits for a "persisted" delivery acknowledgment from B (DOD-MSG-1 / AC-001). If
that ack does not come within the time-to-flush window, A parks the message in B's relay
mailbox (the store-and-forward backstop). So every message A sends is in one of two known
states:

1. **acknowledged** — B has it, and A knows B has it.
2. **not acknowledged → parked** — sitting in B's relay mailbox, waiting for B to pull it.

There is no "vanished" state in normal operation. That is exactly what makes strict in-order
safe: when B needs the next message, it is guaranteed to be fetchable — B either already has
it, or it is in the mailbox. The mailbox IS the resend; B does not need to ask A to resend.

## The one case strict-in-order cannot recover — DOD-MSG-8

If A crashes after sending message 3 directly but before either receiving B's ack OR parking 3
to the relay, then 3 is genuinely lost. This is not a recovery problem; it is irreducible loss.
The right behavior is honesty, not repair: B seals the session recording that 3 was sent but
never received (its content frontier excludes it), and a late-arriving 3 after the seal is
rejected — it never re-enters a sealed session. That is DOD-MSG-8, which builds on the content
frontier already delivered in J-LEGIBILITY / SESSION-004.

## Why this is better than the gap-repair alternative

- Simpler and more correct: one ordering rule ("catch up, then go live") instead of a
  reconciliation mechanism that has to reason about gaps, placeholder leaves, and resends.
- Reuses what exists (delivery ack + relay park), rather than adding a new protocol piece.
- The hard cases collapse: out-of-order is prevented, and the only unfetchable case is real
  loss, which DOD-MSG-8 handles honestly.

## What to build

1. **Strict in-order on the receiver.** B tracks the next expected sequence. A directly-arriving
   message whose sequence is ahead of "next expected" is held, not appended. B fetches the
   missing in-between sequence(s) from the relay mailbox first, appends in order, then releases
   the held message(s).
2. **Catch-up-before-live on reconnect.** When B reconnects, it must know it has pulled
   everything the relay holds for it up to the current sequence before it treats new direct
   messages as live. The relay assigns the sequence numbers, so it can tell B "you are current
   as of sequence N"; B holds live messages until it reaches N. The genuine work here is a
   gate-and-counter (definition of "caught up"), far smaller than the gap-repair machinery.
3. **DOD-MSG-8** then handles the residual true-loss case on the existing frontier.

This is the live-binary target for the next J-CONTENT increment.
