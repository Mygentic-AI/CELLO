---
name: 035-SELFCHAIN — Every message links to the one before it
type: micro-work-order
date: 2026-09-05
status: open
dod_line: DOD-M15-SELFCHAIN-1
dod_effect: closes
priority: >
  ⛔ EVERYTHING ELSE STOPS UNTIL THIS IS DONE — Andre, 2026-09-05. No other unit starts, no other
  order is picked up. This is the cornerstone the rest of the protocol has been assuming it had.
description: >
  A sender signs a hash of their OWN previous message, alongside the hash of the last message they
  received. Two links, both inside the signed bytes, both known at signing time. Together they make
  the conversation an immutable chain: no message can be moved without breaking a signature.
---

# **<ins>MICRO</ins>** WORK ORDER 035-SELFCHAIN — Everything chains

## The point, in one sentence

**A conversation is a cryptographic chain, and moving any message in it breaks a signature.**

## What is true today, and why it is not that

A sender signs `last_seen_hash`: the hash of **the last message they received from the counterparty**.

That chains ACROSS the two parties. It does not chain a sender to themselves.

So when one party sends twice in a row, **both of their messages carry the same
`last_seen_hash`** — they both point at the same message from the other side, because nothing
arrived in between. Nothing in the signed bytes distinguishes them, and nothing links the second to
the first.

Position cannot fill the gap: the relay assigns position AFTER the sender has signed, so a sender
can never sign their own position. The relay's receipt pins it — but the receipt goes to the SENDER,
so on a handover the party submitting the history holds no receipt for the counterparty's messages.

**Consequence, measured in `031-RELAYREPLAY`:** two consecutive messages from one party could be
swapped by whoever submits the conversation to a new relay. `031` closed the exploitable path with
the sender's own signed timestamp, which is a workaround and is deletable once this lands.

## The change

**Structure 1 gains `prev_own_hash` at index 7 — v3.**

```
v1: [1, content_hash, sender_pubkey, session_id, last_seen_seq, timestamp]
v2: [2, …the same five…, last_seen_hash]                        ← 020-ACKHASH
v3: [3, …the same five…, last_seen_hash, prev_own_hash]         ← THIS UNIT
```

`prev_own_hash` is the `content_hash` of **this sender's own previous message in this session**.

Both links are known to the sender at signing time. Neither needs the relay.

**Together they lock the whole order:**

- move one of your own messages within your own run → your self-link breaks;
- move a message across the interleaving → the counterparty link breaks;
- insert, drop or forge → already caught by existing checks.

## ⚠️ WHAT REMAINS DISPUTABLE AFTER THIS, AND WHY IT IS NOT A GAP

**Read this before reporting a hole. Sequence is settled by this unit. The TAIL is not, and cannot
be — it is a property of two parties talking, not a defect in the design.**

The chain works because **the act of sending proves what you received.** Every message you send
carries the hash of the last one you got from me. That is what makes my history unforgeable: you
ratified it by continuing the conversation.

It follows that **the last message each side sent has never been ratified by anyone.** Nobody has
replied to it yet. There is nothing that could chain it, because the thing that would chain it is
the counterparty's next message, and it does not exist.

So after this unit:

- **Every message with a reply after it is immutable.** Its position cannot be changed, by either
  party or by a relay, without breaking a signature. **Sequence is never in dispute again.**
- **The unacknowledged tail is the only thing that can be disputed** — and the tools for it already
  exist and are not this unit's job: the relay's ACK receipt witnesses it in the moment, and
  `DOD-M15-WITHHOLD-SEAL-1` is the line that stops a counterparty hiding their last message and
  sealing without it.

**Do not "fix" the tail by chaining it to something.** There is nothing to chain it to. Anyone who
proposes one has not understood that the ratification IS the reply.

## 🚨 A DETECTED TAMPER ESCALATES. IT DOES NOT JUST GET REFUSED.

A broken chain link is not a malformed frame. It means **someone moved a message in a conversation
that two people are relying on**, and the only signature that could have produced it belongs to a
participant. Refusing the frame and moving on is not enough — that is the checked-then-ignored
pattern this milestone exists to remove, applied to the strongest evidence the protocol can produce.

Every detection point does all three:

1. **REFUSE** — the frame is not ingested, not ordered, not witnessed. Security fails loud AND blocks.
2. **TELL BOTH PARTIES BY NAME.** The submitter gets it in the response they are already waiting on.
   **The counterparty gets it from the party that detected it, never routed through the accused** —
   the relay's witness-alert channel already exists for exactly this and is held for a participant
   who is offline. A conversation where one side knows and the other does not is the failure mode.
3. **SAY WHAT TO DO.** A reason code is not an affordance. The message names the conversation, says
   the record has been altered, and says the next step is to confirm out of band — because the next
   step here is outside CELLO.

**The wording is an OBSERVATION, never a verdict.** The same signal is produced by a tampering peer
and by our own software mishandling a chain — say what was detected and that the session is frozen
defensively, and never attribute intent. It must not feed automatically into any trust signal.

**The session freezes.** One proven broken link is evidence about the connection, not about one
message, and it is identity-class rather than sequence-class.

## Decided — do not redesign

1. **APPEND at index 7, never insert.** Indices 1–6 do not move, so every existing reader keeps
   working and the v1/v2 canonical vectors stay byte-identical.
2. **The VERSION decides the layout, never the length.** Index 6 already has two meanings
   (`DOD-M15-SUBMIT-ID-1`'s submission id on a v1 seven-array, `last_seen_hash` on a v2). Add the
   third: `length 8 && version 3`. Anything else is refused BY NAME, never coerced.
3. **`prev_own_hash` IS A VALUE, NEVER AN ABSENCE.** A sender's first message in a session has no
   predecessor, and that case is a defined 32 bytes — `computeGenesisPrevRoot` for the session, the
   same constant `last_seen_hash` already uses for the same reason. Not a missing field, not a
   shorter array, and **not 32 zero bytes** (a constant identical across every session is one an
   attacker can present for any session).
4. **A v3 that omits the field, or a reader that waves an absent one through, is the fail-open this
   milestone exists to remove.** Missing and wrong take the same path.
5. **Do not touch the relay-assigned position.** Signing the position is a different change and this
   one removes the need for it here.

## ⛔ ONE DELIVERABLE. THERE ARE NO PHASES TO REPORT AND NOTHING PARTIAL IS "DONE".

**Andre, 2026-09-05, and this overrides the habit this milestone has built:** *"I don't want it
phased and — oh, we got one done — and then it dies and I didn't know we had to complete the whole
thing. One deliverable."*

This order is finished when a conversation is an immutable chain **in production, end to end, with
the workaround gone.** Not when the readers merge. Not when the emitter merges. Not when the fleet
rolls. All of it, or it is still open.

**Nothing partial gets reported as progress.** No status message says a piece landed. The next thing
Andre hears about this order is that it is done, or that it is blocked on something only he can do.

### The internal execution order — a safety constraint, NOT a set of milestones

`020-ACKHASH` measured what happens if this is done in the wrong order: a client emitting a layout
the deployed verifiers cannot read has **every message refused as `signature_invalid`**, silently,
until the fleet catches up. So the work is sequenced. It is still one deliverable.

1. Every verifier — protocol-types, the relay, the directory, the receiving daemon — ACCEPTS the new
   layout. Nothing emits it yet.
2. Publish, promote, and roll the fleet node by node. **The next step does not begin until this is
   live everywhere, not merely merged.**
3. Production emits it, and **every verifier ENFORCES it. Four places, named, none optional**
   (Andre, 2026-09-05 — *"it's going to touch what comes through the relays, because the relays
   should be checking this"*):

   - **The relay, on every message as it passes through.** `hash_submit` compares the claim against
     the relay's own record of that sender's previous leaf in this session. This is the check that
     catches tampering IN THE MOMENT rather than at seal time, and it is the one an attacker meets
     first.
   - **The receiving daemon, on inbound.** The same check against its OWN tree, with no relay
     involved — so a compromised or colluding relay cannot wave a broken chain through. **And it
     surfaces: the operator is TOLD, in the response they are reading, not in a log file.** See the
     escalation section.
   - **The directory, at seal time.** A chain that does not hold is not notarized.
   - **The relay, on a HANDOVER.** `031-RELAYREPLAY`'s replay path enforces the self link on the
     inherited chain. **This is what the self link was for** — it is the reason the reordering gap
     existed at all, and enforcing it here is what makes the timestamp workaround deletable in
     step 5. A replayed conversation is verified exactly as a live one is.
4. Publish, promote, roll again.
5. **Delete the workaround.** `031-RELAYREPLAY`'s `seal_chain_sender_clock_reversed` check is dead
   once the self-link is enforced. Remove it and the comment describing the gap it covered.

Steps 2 and 4 need Andre only for the `latest` promotion. Everything else runs without stopping.

## Definition of Done

1. `structure1.ts` encodes and decodes v3, and the v1/v2 canonical vectors are unchanged.
2. A v3 canonical vector is added and pinned.
3. A v3 claim missing `prev_own_hash`, or carrying a non-32-byte one, is refused by name.
4. Production emits v3 on every claim, with the session genesis on a sender's first message.
5. The relay, the receiving daemon and the directory each enforce the link independently.
6. A replayed chain with two consecutive same-sender messages swapped is refused because the
   SELF-LINK broke — proven by a test that names that reason, not a neighbouring one.
6a. **Every detection point escalates**, per the section above: refuses, tells BOTH parties, names a
   next step, freezes the session. Proven by a test per detection point that asserts the
   counterparty was told — not merely that the frame was refused.
6b. **A test proves sequence is no longer disputable:** every message that has a reply after it
   cannot be moved without a signature failing, in either direction, by either party.
7. `031-RELAYREPLAY`'s timestamp check is deleted, and its tests still pass on the self-link.
8. Gate green in both repos.
9. **Published, promoted, and the fleet rolled — twice, per the execution order.** A merge is not
   done here; the claim is about production.
10. **The workaround is deleted**, and the suite is green without it.
11. Reviewed by `cello-unit-reviewer`, every finding fixed.

**None of 1–11 is reportable on its own.** The order is `complete` when all of them are true.

## Traps

**Both repos.** `cello-client` (protocol-types, daemon) and `trustless-cello` (relay, directory,
the shared seal-chain verifier). Worktrees in both.

**The genesis value must be per-session.** See decision 3. A shared constant is presentable for any
session and would let a first message be moved between conversations.

**Do not delete the timestamp check before the self-link is enforced everywhere.** Part C is last,
and it is last because a window with neither check is worse than a window with the workaround.

**The producer may not exist.** `033-ACKEMIT`'s Part 0b found the daemon had no assembler for the
thing its DoD assumed. Before writing anything: confirm the daemon can name its own previous
content hash for a session. `lastSeenAck` is the shape to mirror. If it cannot, that is Part 0.

## Newly discovered

_(write findings here and keep going — do not fix them)_
