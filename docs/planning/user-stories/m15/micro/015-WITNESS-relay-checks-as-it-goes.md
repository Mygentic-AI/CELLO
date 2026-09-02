---
name: 015-WITNESS — The relay verifies every hash as it passes, not when asked
type: micro-work-order
date: 2026-09-02
status: open
description: >
  The relay already receives every signed message hash and already holds both participants' real
  pubkeys. It checks nothing until seal time. Verify each hash against the two expected keys as it
  arrives — the same check the directory already runs, triggered early — so detecting a forged
  message does not depend on the receiving client, which is the party most able to lie about it.
  Source: DOD-M15-CORROBORATE-1.
---

# **<ins>MICRO</ins>** WORK ORDER 015-WITNESS — The relay checks signatures as they pass

> ## THE RULES OF A MICRO WORK ORDER
>
> 1. **Read [[M15-PROCEDURE]] IN FULL before you start.** It is the working discipline for this
>    milestone and it binds you — the gate, the review dispatch, the invariants, how tests are run.
>    **Do not read `M15-DEFINITION-OF-DONE.md` or `M15-BUILD-JOURNAL.md`**; this order carries
>    everything you need from them.
> 2. **MICRO means small.** One mission. Follow it to its end. **Never grow the mission.**
> 3. **Found something else?** Write it under *Newly discovered* at the foot of this file and
>    **keep going**. Do not fix it. Do not investigate it.
> 4. **500 lines, hard cap.** Minimal without omitting anything.
> 5. **Standard procedure still applies:** implement → review (`cello-unit-reviewer`) → fix every
>    finding → commit. Commit per fix, push after every commit. **Closing a unit means flipping
>    this file's `status:` frontmatter to `complete` in the SAME commit as the verdict.**
> 6. **Done is done.** When the Definition of Done below is met, stop.

---

## The problem, plainly

A stranger cannot inject content into a conversation any more — the receiving client verifies who
signed each message and freezes the session if the signature is wrong.

**That fix created its own gap: the detector is also the most likely liar.**

The receiving client is the party best positioned to notice a forged message. It is also the party
that, if compromised, could **fabricate** the accusation — claim a signature mismatch that never
happened, and produce a permanent record saying its counterparty tried to forge a message.

**So a detection that only the accuser can see is not enough.** We need a witness whose copy of what
the sender signed never passes through the accuser's hands at all.

**The relay is exactly that witness, and it already has everything required:**

- it is bound to the session with **both participants' real pubkeys**;
- it **already receives every signed hash**;
- verifying a signature against a known pubkey **never requires reading content**, so this stays
  inside the blind-witness design that the whole relay rests on.

It just doesn't look until seal time.

---

## The work

1. **Verify each submitted hash against the two expected participant keys as it arrives**, rather
   than only when a seal is adjudicated. **No new cryptography** — this is the identical check the
   directory already performs at seal time, triggered early. Find that check and reuse it.
2. **Detection is not enforcement.** On a mismatch, alert the affected daemon. Consider — and decide
   in writing — whether the relay should also refuse to keep relaying a session it has flagged. State
   the choice and the reason; do not leave it implied by the code.
3. **The alert reaches a person.** A flagged session that only produces a relay log line has not
   solved the problem this unit exists for: the whole point is a record the accused party's client
   cannot suppress. Per the procedure's *"this guard fires, who hears it?"* rule.
4. **Say what one relay's word is worth.** One relay is one witness. This becomes a real detection
   layer only with fan-out to several relays, which is a separate line. Do not overclaim in any
   operator-facing wording — write what a single witness establishes, and no more.

---

## ⚠️ WHAT MUST NOT CHANGE

- **The relay must not read content.** If the check needs plaintext, it is the wrong check — a
  signature verifies against a hash and a pubkey. Anything else breaks the guarantee the product is
  sold on.
- **The relay must not become the arbiter.** Freezing locally is always safe for a client, because
  it limits only what that client trusts. **The accusatory record is what must not be asserted
  unilaterally** — by the client OR by one relay.
- **Do not add a per-message round trip.** The relay already holds the keys; this is a local
  verification on a frame it is already handling. If your design introduces a network call per hash,
  it is the wrong design.

---

## Definition of Done

1. Every submitted hash is verified against the two expected participant keys **as it arrives**.
2. A hash signed by neither participant is detected at submission time, not at seal time.
3. The affected daemon is alerted, and the alert reaches the operator with a cause.
4. **The detection does not depend on the accusing client's cooperation** — asserted by a test where
   the receiving client reports nothing at all and the relay still flags it. This is the clause the
   unit exists for.
5. The relay still reads no content — no plaintext is required anywhere on the new path.
6. Whether a flagged session keeps being relayed is decided and written down, with its reason.
7. Any operator-facing wording states what ONE witness establishes, without implying more.
8. Each of 1–6 has a test, and **each has been made to fail on purpose** — revert the fix, confirm
   it reddens, confirm it reddens for the reason you expect.
9. **The enforcer runs as separate OS processes.** Vitest green is necessary, never sufficient.
10. Gate passes (test / lint / typecheck) in every repo touched.
11. Reviewed by `cello-unit-reviewer`, every finding fixed, verdict quoted below.

**Not in scope:** fanning the hash sequence out to several relays (a separate line); the seal's own
verification (`012-SEAL`); leaf/participant constraints (`014-LEAVES`); anything that would require
the relay to read message content.

---

## Traps recorded before you start

- **A false accusation is worse than a missed detection here.** If the check can fire on a healthy
  session, it is a weapon rather than a safeguard. Be certain about which key set is expected before
  flagging anything.
- **Do not weaken an existing assertion to make a new test pass.**
- **The relay is on the hot path for every message.** A verification per hash is cheap; anything that
  blocks, allocates per message, or reaches the network is not.
- **No compatibility branch.** No users. If the new check makes an older submission shape invalid,
  delete the older shape rather than tolerating both.

---

## The decision this order asked for: a flagged session KEEPS BEING RELAYED

**Written here as well as at `#flagUnwitnessedLeaf`, because the order asked for the choice and the
reason, not for the code to imply it.**

The relay refuses the submission and goes on carrying the session. Three reasons, in order of weight:

1. **There is nothing left to protect.** The leaf was refused before a sequence was allocated, so it
   never entered the tree and the conversation record is exactly what it was a moment earlier.
2. **A teardown is a weapon in a way a refusal is not.** Anyone who can authenticate to the relay and
   name a session id could then end any conversation with one frame. The order's own trap says a
   false accusation is worse than a missed detection; a false teardown is worse still, because it
   costs the honest pair the thing they came for and needs no accusation at all.
3. **One relay is not the arbiter.** Freezing is safe for a *client* — it limits only what that
   client trusts. A relay that stops carrying traffic imposes its verdict on both parties, including
   the one it has no observation about. So the relay reports and the two clients decide.

**What one witness establishes, stated once so nothing downstream overclaims it:** that THIS relay
received a submission on that session and refused it because the signature verified against neither
participant key. Not who sent it. Not that anyone acted in bad faith. There is no second witness to
check it against — fanning the hash sequence out to several relays is a separate line — and the
operator-facing guidance says exactly that rather than implying a finding.

**And the bound on the holding half:** an alert for an offline participant is held in the relay's
memory and re-delivered on their next authenticated connection. A relay restart loses it. That is
the same durability the delivery queue has, and it is worth naming rather than leaving as an implied
guarantee.

---

## Review

*(Reviewer verdict goes here. One quote. Not a transcript.)*

---

## Newly discovered

*(One or two lines each. Do not act on them.)*
