---
name: Documents — reconcile, don't deliver
type: discussion
date: 2026-08-14
topics: [documents, collaborative-state, architecture, simplification, crdt, amendment-chain, delivery, first-principles, m14b]
description: >
  A first-principles reconsideration of the collaborative document protocol. The feature contains
  three ideas — a signed chain, converging content, and reconciling the two between holders — and we
  implemented them as roughly seven. The proposal is to replace push-and-track delivery with
  comparison-based reconciling, fold proposals and endings into the chain, and delete the four
  parallel delivery mechanisms. Net effect is substantially less code, one bug class eliminated by
  construction, and five open design decisions dissolved rather than answered. Includes what is
  lost, and the one question that must be settled before any code is written.
---

# Documents — reconcile, don't deliver

## Why this exists

Andre's read, 2026-08-14, and it is correct: *"I don't understand it, and I am the original author
of it. And if I don't understand it, how is a user ever going to understand it?"*

The collaborative document feature grew by accretion. Each unanticipated problem was met with a
fix, each fix created a surface the next problem could hide behind, and the result is a protocol
whose author cannot hold it in his head. That is the finding. Not the individual defects — the
shape.

This document does not propose fixing the defects. It proposes removing the place they live.

## 1. What a collaborative document actually is

Stripped to first principles, there are **three** ideas:

1. **A chain.** Who holds this document, who governs it, what its rules are, and when it ended.
   Append-only, signed, ordered. This is the trust product.
2. **Content.** The text. Yjs already converges concurrent edits; that problem is solved and is not
   ours.
3. **Reconciling.** Two holders comparing where each has got to, and closing the gap.

Everything else in the current implementation is a special case of one of these three, built
separately.

## 2. What we implemented instead

| We built | It is really |
|---|---|
| A proposal, with its own offer/accept/refuse/answer handshake | The chain's first entry |
| An invite, with a *second* offer/accept/answer handshake carrying history | Another chain entry |
| `close` and `kill` as signed frames outside the chain, with their own delivery and their own agreement bookkeeping | Chain entries |
| A per-recipient delivery ledger for content — rows, attempts, sends, backoff, abandonment, acks | Reconciling |
| A second, weaker delivery path for membership changes (no retry, no ack) | Reconciling |
| A third, weaker delivery path for endings (no retry, no ack) | Reconciling |
| A fourth, private notion of route liveness inside the session layer | Reconciling |

Seven mechanisms. Three ideas.

**Consequence, and it is the whole story:** every bug this feature has produced — not merely the
recent ones — has the identical shape. **Two records disagreeing about the same fact.** The
sender's ledger versus the receiver's reality. One derivation of "who holds this" versus another.
The list surface versus the worker. Local session status versus the relay's.

Because two of the four delivery paths had no acknowledgement at all, we then invented substitutes
for one: send ceilings, "retired versus acknowledged", proof-by-inference. That machinery exists
solely to compensate for a missing signal. It is not function; it is scar tissue.

## 3. The proposed model

> **Stop recording what we have sent. Ask what they have, and send the difference.**

When two holders make contact — or immediately, on a nudge:

1. Each says where it has got to: its position in the chain, and its content state.
2. Each sends what the other lacks: **chain entries first, then content.**
3. Both apply what they received.

That is the entire protocol at the transport boundary.

**The nudge is an optimisation, not a mechanism.** When you commit an edit we poke the other side so
it feels instant. If the poke is lost, nothing is broken — the next contact reconciles anyway.
Nothing is load-bearing except the comparison.

**One ordering rule, and only one:** the chain before the content that depends on it. Whether an
edit may be applied is a question about the chain, so the chain must be current first. Both travel
in the same exchange, so the window in which they can disagree does not exist.

### The states an edit passes through

Andre asked for this explicitly. The honest list is short:

1. **Authored** — you change text. Yjs.
2. **Committed** — the update is in your content state, locally, durably.
3. **Reconciled with holder X** — X's content state now includes it.
4. **Applied** — X merged it. Yjs.

There is no "queued", no "sent", no "acknowledged", no "abandoned". Those are not states of an edit;
they are states of a *ledger*, and the ledger is what we are removing. Step 3 is not a state we
store — it is a comparison we can perform at any time.

### What replaces the delivery surface

Per holder, one honest line: **in sync**, or **behind by N since T**, or **not seen since T**.

Nothing correctness-critical is stored per peer. Last-seen and last-known-position are a display
cache; if they are wrong or missing, the next exchange corrects them. This is the property that
eliminates the bug class: **there is no second record to fall out of step with the first.**

## 4. Every failure case, folded in

The test of an architecture is whether the hard cases need special handling. Under reconciling they
are not cases at all:

- **The holder is offline.** Nothing happens. When they return, the comparison shows a gap and
  closes it. There is no retry to schedule because nothing is pending — only a difference that still
  exists.
- **A daemon restarts.** Irrelevant. The answer is computed, not remembered.
- **The relay lost the session.** Open another. Asking twice is harmless; reconciling is idempotent
  by construction.
- **The relay parked the frame rather than delivering it.** Also harmless, and — importantly — no
  longer needs to be distinguished. Either they have it at the next comparison or they do not.
- **Someone joins mid-life.** They are simply very far behind. Same exchange, from zero. The
  bespoke "carry the whole history in the offer" path disappears.
- **Someone is removed.** We stop reconciling with them. That *is* removal. No pending rows to drop,
  no delivery to stop, no chasing them with an ending.
- **Someone ends the document.** The ending is a chain entry, so it travels like everything else. No
  separate frame, no separate delivery, no separate confirmation, no send ceiling.
- **A chain that will not decode.** Reconciling refuses and says so. It cannot silently render a
  removed holder as healthy, because there is no per-holder flag to be absent.

## 5. Security — the adversary-owns-their-daemon lens

This is the project's blocking lens and the model must be argued against it, not assumed past it.

**Entitlement is evaluated at the moment of exchange, against your own chain.** This is *stronger*
than what we have. Today the recipients of an update are decided when the delivery rows are seeded;
a membership change afterwards requires explicit logic to drop or add rows, and that logic is
exactly where the recent removal and invite defects lived. Under reconciling, the question "may this
peer have this?" is asked fresh every time, by each side, from its own signed chain. **Removal takes
effect immediately and everywhere, with no code that has to remember to act.**

- A peer lying about their position ("I have nothing") gets sent content they are already entitled
  to. Wasteful at worst; no trust consequence.
- A peer cannot obtain a document they are not a participant in, because *we* derive participants
  from *our* chain before answering.
- A peer cannot forge chain entries: the signature requirements are unchanged.
- A removed peer that asks to reconcile is refused by our own derivation, not by a flag someone had
  to remember to set.
- Inbound content is still screened for injection on arrival. How it arrived is irrelevant to that.

**Notarisation is untouched.** Edits still travel inside sessions, leaves are still witnessed, and
the sealed receipt is unchanged. What disappears is the document layer's private opinion about
delivery — not the cryptographic record.

## 6. What gets deleted

- The per-recipient delivery ledger and all four of its variants.
- Attempt counters, send counters, backoff schedules, abandonment, retry ceilings.
- The content acknowledgement frame, and the invented substitutes for the two paths that lacked one
  (proof-by-epoch, retired-versus-acknowledged, unconfirmed reporting).
- The second consent handshake — proposals and invites become one act.
- The control-frame path in its entirety: signing, fan-out, per-holder reporting, close settlement
  bookkeeping.
- The relay vocabulary that leaked into document logic: sealed, parked, gone, unwitnessed. The
  document layer stops knowing these words.
- The duplicate derivations of "who holds this" and "am I removed".
- Most of the delivery-status surface: several fields collapse into one sync line.

## 7. What is kept

The signed chain. The rule that an edit's author must have been entitled to write it. Yjs. Sessions
and the relay as transport, with their receipts. That is the product, and none of it is what we are
untangling.

## 8. What we lose — honestly

**Un-sending a change you regret.** There is a withdraw today: an edit not yet delivered can be
pulled back. With no queue there is nothing to pull back from. The correction becomes another edit,
as `git revert` is to rewriting history. It is worth noting the current feature is a race and
therefore unreliable — but it does sometimes work, and afterwards it never would. **This is a
product decision, not a technical one.** If wanted, it can be built later as an explicit, honest
verb rather than a race, at real cost.

**Placing a change into a chosen sealed record.** There is a designed ability to direct an edit into
a specific conversation so the discussion and the change land in one receipt. Reconciling uses
whatever route is available. Nothing calls this today — it is an intention, not a working feature —
but it is a real audit idea and it would go.

**A blunt "this will never arrive" alarm.** Today something can be declared undeliverable, with
instructions to republish. That softens to "behind, last seen three days ago". For a peer who has
genuinely gone, "behind" understates it. Mitigated by showing the age prominently.

**Not a loss, despite appearances:** ending by agreement. "Every current participant has said they
are done" is a question asked of the chain, not bookkeeping that must be maintained. It gets
cleaner, because the answer is derived rather than tracked.

## 9. The one question that must be settled FIRST

**Does stamping each edit with a governance epoch do any security work?**

Today every content envelope names an epoch and is refused if it does not match the receiver's. That
coupling is the source of most of the awkward states — edits that name a version you have not heard
of, edits that name one you have moved past, and the whole terminal-versus-retryable vocabulary
around them. Under reconciling it has nowhere to occur, because the chain syncs first.

My reading is that the stamp is not doing security work: the signature identifies the author, and
the chain says whether that author was entitled to write. But **I have not proven it**, and it is the
single place where being wrong is expensive rather than inconvenient. Specifically, to check:

- Can a removed holder replay an edit authored while they were a member, and should they be able to?
  (Forward-only removal suggests refusing it is correct — but that is a policy question with a
  right answer, and it should be decided rather than inherited from a field.)
- Does anything else in the trust story read that epoch as evidence?

**No code is written until this is answered.**

## 10. Sequencing

Phases, in dependency order:

1. **Settle §9.** Analysis only, no code.
2. **The chain becomes the single home for governance and endings.** `close` and `kill` become
   entries; the settle becomes a derivation.
3. **One consent handshake.** A proposal is the chain's genesis; an invite is an entry. One offer
   shape, one accept, one answer.
4. **The reconcile exchange.** Position in, difference out, chain before content.
5. **Delete the four delivery paths** and replace the delivery surface with the sync line.
6. **Re-point the enforcers.** The three-daemon spine tests are the acceptance bar and must exercise
   reconciling, not delivery.

Compatibility is not a constraint: all holders upgrade together, and essentially no documents exist.
That window is open precisely because the feature has no users yet, and it closes the day a real
workflow depends on one.

## 11. What this does to the M14B board

Five currently-parked decisions **dissolve** rather than being answered, because every one of them is
a question about the ledger:

- reconciling a document that already diverged
- whether ending a document flushes or abandons its queued content
- whether a send may report success when its record was never witnessed
- reaping sessions that delivery has routed around
- (partially) the delivery doorbell, since a reconcile exchange has a purpose the opener knows

That is the strongest evidence the diagnosis is right. **A good simplification does not answer your
open questions; it deletes them.**

## Related

- [[M14B-DEFINITION-OF-DONE]] — the board this reshapes
- [[M14B-BUILD-JOURNAL]] — Entries 37–46, the defects that prompted the reconsideration
- [[2026-08-10_2116_multiplayer-artifacts-joining-an-existing-document]] — the spec this supersedes
  in its delivery half; its governance half stands
