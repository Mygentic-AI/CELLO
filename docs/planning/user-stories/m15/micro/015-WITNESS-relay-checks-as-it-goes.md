---
name: 015-WITNESS — The relay verifies every hash as it passes, not when asked
type: micro-work-order
date: 2026-09-02
status: complete
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

### The three bounds on the holding half, stated rather than implied

Two of these came out of the fallback hunt, and both are limits I am choosing to accept rather than
defects I am leaving — the difference matters, so they are written where a reader will meet them.

1. **The relay's hold does not survive a relay restart.** An alert for an offline participant sits
   in the relay's memory until they next authenticate. GCP rolls relay nodes on every deploy, so
   anything still waiting dies with the process. The durable copy is the relay operator's log.
2. **The client's notice does not survive a daemon restart.** `recordRelayWitnessAlert` holds the
   list in memory, and the relay's copy is already gone by then (its queue drains destructively). So
   an alert observed, delivered, and never read before a restart is lost from the inbox — the
   daemon's own log still has it, and so does the relay's. **Persisting it needs a client-side
   schema migration on operator machines, which is more than this order.** Recorded under *Newly
   discovered* rather than built.
3. **A cross-session replay is refused but not witnessed.** A participant lifting one of their OWN
   validly-signed leaves out of another conversation is caught (`leaf_session_mismatch`) and refused
   with a named reason, but no alert goes to the counterparty: the leaf verifies under a real
   participant key, so `leaf_signed_by_neither_participant` would be a false statement about it and
   a second alert reason is a wire change this order did not ask for. Also under *Newly discovered*.

---

## Review

`cello-unit-reviewer`, one pass:

> **SPEC: DEVIATIONS FOUND** — clause 8 [blocking]: clause 3's operator surface has no test and so
> was never made to fail on purpose … **HOLLOW TESTS FOUND** — [blocking]: "the alert does not close
> the session" passes with the whole feature reverted … I am not rubber-stamping: F1 (the cap
> inversion) and F3 (the unsigned alert) are the two that decide whether this unit does the job it
> was written for.

Nine findings, all fixed: F1 the client's notice cap kept the newest and handed back the mute button
the relay's queue removes; F2 an alert could name any session, including one carried by another
relay; F3 the alert was unsigned, so the recipient could not show anyone what the relay said; F4 a
comment claimed a durability the code does not have; F5 two live refusal reasons lost their only
tests when three were re-pointed; F6 a leaf signed for a DIFFERENT conversation was being sequenced
here; F7 an unreadable alert reached no operator surface; F8 an undecodable frame was answered
`signature_invalid`; F9 the guidance said nothing about what an absent alert means. Plus both
blocking test findings and three LOWs.

`cello-fallback-finder` (dispatched per §2d — this unit touches a verification path):

> **SILENT FALLBACKS FOUND.** HIGH 1 is the blocking one — it is a live path (restart, then seal) on
> which the relay's held observation is destroyed at both ends and the operator is shown a clean
> inbox.

HIGH 1 fixed (the unplaceable report now reaches the neutral surface); MEDIUM 2 and 3 and all three
LOWs fixed; HIGH 2 and MEDIUM 1 are the bounds recorded above.

---

## Newly discovered

---

**A witness notice does not survive a daemon restart.** The alert list is in memory and the relay's
copy is spliced away on delivery, so an observation delivered and not read before a restart is gone
from the inbox. Persisting it needs a client-side schema migration. POST-LAUNCH: an operator loses a
rare notice they still have in the daemon log, not the ability to communicate.

**A cross-session replay attempt reaches no counterparty.** `leaf_session_mismatch` is refused and
logged on the relay only. Alerting on it needs a second witness-alert reason on the wire.
POST-LAUNCH: nothing is sequenced either way, so the record stays correct; what is missing is the
independent notice.

**`decodeStructure1` tolerates six OR seven elements** and the comment justifies it by "every client
in the field today" (`DOD-M15-SUBMIT-ID-1`). Nothing names the deployment fact that would retire the
six-element shape. Noted by the reviewer, not acted on.
