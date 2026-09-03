---
name: 024-ORPHANTRIAGE — A message for a conversation we never had
type: micro-work-order
date: 2026-09-03
status: open
description: >
  A message arrives for a session this daemon holds no record of. Today the operator is told to ask
  the counterparty to start a new one — which, when this is a stranger probing a peer ID, is the
  attacker's goal: getting you to make contact and confirm you are there. There are exactly TWO
  actions ever warranted, and which one applies is decided by evidence the daemon already holds and
  currently ignores. CLOSES DOD-M15-ORPHANTRIAGE-1.
---

# **<ins>MICRO</ins>** WORK ORDER 024-ORPHANTRIAGE — A message for a conversation we never had

> ## THE RULES OF A MICRO WORK ORDER
>
> 1. **Read [[M15-PROCEDURE]] IN FULL before you start.** It binds you — the gate, the review
>    dispatch, the invariants, how tests are run. **Do not read `M15-DEFINITION-OF-DONE.md` or
>    `M15-BUILD-JOURNAL.md`**; this order carries everything you need from them.
> 2. **MICRO means small.** One mission. Follow it to its end. **Never grow the mission.**
> 3. **Found something else?** Write it under *Newly discovered* at the foot of this file and
>    **keep going**. Do not fix it. Do not investigate it.
> 4. **500 lines, hard cap.**
> 5. **Standard procedure still applies:** implement → review (`cello-unit-reviewer`) → fix every
>    finding → commit. Commit per fix, push after every commit. **Closing a unit means flipping
>    this file's `status:` frontmatter to `complete` in the SAME commit as the verdict.**
> 6. **Done is done.** When the Definition of Done below is met, stop.

---

## What is wrong today

`022-REFUSALVISIBLE` made `session_orphaned` visible, and the guidance it shipped is wrong:

> *"ask the counterparty to start a NEW session"*

**Andre, 2026-09-03:**
> *"I don't think you should be advising them to ask the counterparty to start a new session. The
> most likely reason for this is actually a form of attack. Let's say that you figure out that this
> peer ID exists, and now you try to hit it with something that gets it to contact you to say 'hey,
> you're wrong.'"*

Telling the operator to make contact **is the probe succeeding**. A stranger who guessed or
harvested a peer ID learns that somebody is home and that their agent responds — from a message that
was refused.

---

## THE RULE: there are exactly TWO actions, and never a third

**Andre, 2026-09-03:**
> *"The decision comes down to one of two things. Report to CELLO, or reach out using the public key
> to the other entity. And those are the only two actions you should take. And whether to reach out
> depends on whether we can verify they are a known contact in their address book. And if they are a
> known contact and this was an ongoing conversation until this point, then a separate session with
> them — and it must be a separate session — is warranted."*

**A. Report to CELLO.** The default, and the only action when the sender cannot be established.
**B. Reach out to them, in a SEPARATE session.** Only when every condition below holds.

Anything else — waiting, replying into this session, deleting, ignoring — is not an option to offer.

---

## The evidence the daemon already holds and currently throws away

**`ingestReceivedContent` takes `verifiedAuthorship?: { senderPubkey, senderSig }`.** The orphan
branch is the FIRST check in that method and returns before ever looking at it. So the daemon has
the answer and does not use it.

**Falsify this before building on it** (`CLAUDE.md` Debugging Discipline): the caller computes
`verifiedAuthorship` in `#recordFrameOrdering`, which verifies the signature **and matches the signer
to this session's counterparty**. With no session there may be no counterparty to match against, so
the value may arrive `undefined` for a reason that has nothing to do with the sender. **Read that
path and state in the journal what `verifiedAuthorship` actually contains on an orphaned session
before you write a single branch on it.** If it is always absent, this unit's first job is making
the signature verifiable independently of the session lookup — say so and do that.

### The three signals, in order of what they prove

**1. Is the message SIGNED, and does the signature verify against the public key it carries?**

**This is the gate. Everything else is meaningless without it.**

> **Andre:** *"If this is a public key with an unsigned message, then it does not prove that person
> sent it. So even if it's in their contact list, it proves nothing. It means nothing to send a
> message unless it includes a public key and the message is signed and you can prove that it was
> signed by that public key."*

Unsigned, or a signature that does not verify → **you know nothing about who sent it.** A claimed
pubkey is a string anyone can type. Action A only.

Signed and verifying → the sender **holds the private key** for that public key. That is all it
proves, and it is enough to act on.

> ⚠️ **AND IT DOES NOT PROVE THE OWNER SENT IT.** Anyone can mint a keypair, so a verified signature
> from an unknown key proves only that a key exists. Even a verified signature from a KNOWN key
> proves possession, not legitimacy — the key may be stolen. The guidance must never say "this is
> from X"; it says "this was signed by the key you know as X."

**2. Is that public key a contact you have had a session with?**

Unknown → a stranger who can sign is still a stranger. Action A only.
Known → Action B becomes available.

**3. Was there an ongoing conversation up to this point?**

> **Andre:** *"The evidence that this might be a technical error increases if they've had an ongoing
> message that was working correctly. It doesn't mean it's legit — it may be somebody trying to break
> in mid-conversation, maybe they've gained access to the relay. But it does increase the probability
> that they are."*

A sequence number consistent with a conversation that was working raises the probability of a
technical fault over an attack. **It raises probability; it does not establish anything.** The
wording must not present it as proof.

> **⚠️ THE STRONGER SIGNAL IS NOT BUILT YET.** `last_seen_hash` in `Structure1` — the N−1 content
> hash beside the sequence number — is decided (see `DOD-M15-ACKHASH-1`) and IS IN FLIGHT IN ANOTHER
> LANE. It is not landed, so **do not build on it**. When it lands, a verifying chain link becomes
> the third signal and this guidance should say so. Note it as a follow-up; do not wait for it.

---

## Part 1 — The triage, and what the operator is told

Compute the three signals at the orphan branch and put them **in the notice**, as fields the agent
can branch on and as prose the operator can act on:

- the sender's public key (verbatim, full — never truncated)
- whether the message was signed and the signature verified
- whether that key is a known contact, and your own name for them if you have one
- whether the position is consistent with an ongoing conversation

**Then name ONE action, never two.** An affordance list of both is a menu, and a menu is what
produces the wrong choice.

**Unsigned, or unknown key:**
> Report it. Do not contact them. Making contact is what this kind of message is for.

**Signed, verifying, known contact:**
> This was signed by the key you know as *(name)*. Reaching out is reasonable — **in a NEW
> conversation, never this one** — and it is worth doing, because if they say they sent nothing,
> that is how you both find out their key is being used by someone else.

> **The valuable outcome, in Andre's words, and it belongs in the guidance:** *"You reach out to your
> friend Bob who has that public key and Bob says 'no, I didn't — what the fuck, somebody has my
> private key,' which is a good thing to uncover, because then they can pause or burn the agent
> identity."*

**AND THE DEFAULT, IN THE MESSAGE ITSELF — Andre, 2026-09-03:**
> *"The message should say: when in doubt, report it."*

It is not a tiebreaker for the code, it is a sentence the operator reads. The three signals are
probabilistic — a known key can be stolen, a consistent position can be forged mid-conversation, and
an operator who is unsure has no way to resolve it from here. **Reporting costs them nothing and
costs an attacker their anonymity, so uncertainty resolves to report.** Put it in the guidance for
the reach-out case too, where the temptation to act alone is highest.

**Why a separate session and not this one:** there is no session here to reply into. The one named
in the message does not exist on this machine, and treating the message as an invitation to open the
one it names is the probe succeeding by a different route.

---

## Part 2 — "Report to CELLO" must name something real

**Andre, 2026-09-03:**
> *"Instead of saying report it to the relay, you should say it should be reported to CELLO. And what
> we're going to do is set up an agent called CELLO_Reporting, which is where you report suspect or
> malicious behavior. So that's this agent reaching out to another agent to say this thing is going
> on. And then it becomes our issue to deal with."*

**It does not exist yet.** Invariant 4 forbids naming a verb that resolves to nothing, so this unit
must either build the reachable minimum or say plainly that reporting is not yet available.

The shape: a CELLO agent, `CELLO_Reporting`, that any operator's agent can open a session with and
send a report to. **The reporting mechanism is CELLO itself** — one agent talking to another — which
is the product demonstrating its own use, and needs no new transport.

**Decide and record which of these this unit does:**

- **(a)** Provision `CELLO_Reporting` (that exact name), publish its pubkey in the guidance, and have the operator's
  agent open a session and send the report. Reachable end to end.
- **(b)** State in the guidance that reporting is not yet available and what to do meanwhile.

**(a) is the answer if the agent can be provisioned inside this unit's scope.** If it cannot — if it
needs infrastructure, a published identity, or a decision only Andre can make — take (b), say so in
one line, and park (a) with a trigger. **Do not ship a guidance sentence naming a verb nobody can
perform.**

---

## Part 3 — Prove it end to end

Extend an existing spine journey — **do not write a new harness**. Two real daemons as separate OS
processes:

1. A message for a session the receiver has no record of, **unsigned** → the notice names no contact
   verb at all, and says report.
2. The same, **signed by a key the receiver does not know** → still report, still no contact verb.
3. The same, **signed by a key the receiver HAS a contact for** → the notice offers reaching out, in
   a NEW conversation, and says the signature proves key possession rather than identity.
4. In every case the message is not delivered, and the sender is not acknowledged.

**Case 3 is the one that must not be faked by seeding a contact row and asserting prose.** Sign with
a real key, verify with the real verifier, and assert the branch was taken because the signature
verified — not because a fixture said "known".

---

## Definition of Done

1. The orphan branch computes and records: sender public key, signature verified yes/no, known
   contact yes/no, position consistent yes/no.
2. **Unsigned or unverifiable → the notice offers exactly ONE action: report.** No contact verb
   appears anywhere in it. **Prove it with a test that greps the rendered guidance**, because this
   is the whole point of the unit and prose is where it will regress.
3. **Unknown key → the same.** A stranger who can sign is still a stranger.
4. **Known contact + verified signature → reaching out is offered, explicitly in a NEW
   conversation**, with the wording that the signature proves key possession, not identity, and with
   the key-compromise outcome named.
4b. **EVERY case, including that one, carries "when in doubt, report it."** Assert it in the
   rendered guidance for all three cases — it is the sentence that catches the operator who is
   unsure, and the reach-out case is where it is most needed and most likely to be dropped.
5. No guidance anywhere says or implies "this message is from X". Signed means signed by a key.
6. Reporting names something reachable, or says plainly that it is not yet available — decided in
   Part 2 and recorded in the journal with the reason.
7. The journey in Part 3 is green, run as separate OS processes, output quoted.
8. **Each new assertion has been made to fail on purpose**, and confirmed to fail for the expected
   reason. **Commit before the mutation loop exists** — 022 lost six fixes to a loop's `git checkout`
   running against an uncommitted tree.
9. Gate passes in cello-client. State whether anything publishes.
10. Reviewed by `cello-unit-reviewer`, every finding fixed, verdict quoted below.
11. `DOD-M15-ORPHANTRIAGE-1` flipped to ✅ in `M15-DEFINITION-OF-DONE.md`, in the same commit as the
    verdict.

> **⚠️ REPORTING NEEDS SOMETHING TO SEND, AND TODAY THERE IS NOTHING.** Every refusal discards the
> message — `023-REFUSEDEVIDENCE` is the unit that retains it. This unit owns WHO to tell and WHAT to
> advise; that one owns the artifact existing. **Neither is useful alone**: an action that says
> "report it" with nothing to attach is an instruction the operator cannot carry out. If 023 has not
> landed when this runs, say in the guidance that the message itself was not retained.

**Not in scope:** `last_seen_hash` (another lane, and this unit must not wait for it); whether the
standing receiver should have accepted the connection at all (below); what CELLO does with a report
once it has one.

---

## Traps recorded before you start

**Never offer both actions.** Two options is a menu, and the operator picks the friendly one. One
signal set, one action.

**A verified signature is not an identity.** Every sentence must survive the question *"and what if
the key was stolen?"* — "signed by the key you know as Bob" survives it; "from Bob" does not.

**Do not truncate the public key.** The operator may need to paste it, compare it, or report it. A
`6988436e…` abbreviation is unusable for all three.

**The absence of a signature must not read as an absence of information.** "Not signed" is a
finding, and a strong one — say it as a finding, not as a missing field.

**`agent_name` is a display label.** Key on `agent_id`.

**ANOTHER LANE MAY BE RUNNING.** If you bring up Postgres, export a `COMPOSE_PROJECT_NAME` unique to
your worktree AND a unique `CELLO_PG_HOST_PORT` — the port alone does not isolate you.

**Work in a PAIRED worktree.** The spine harness resolves `../cello-client` from the trustless-cello
root, so a lone cello-client worktree runs the MAIN checkout's `dist`. Create `<lane>/cello-client`
and `<lane>/trustless-cello` as siblings. And a new worktree is a new permission root — load
`/worktree-permissions` before creating one.

---

## Review

### Where this work lives
*(worktree paths, branch, and the `COMPOSE_PROJECT_NAME` / `CELLO_PG_HOST_PORT` you used)*

### The rest
*(the journey output, the mutation proof from DoD 8, the reviewer's verdict)*

## Newly discovered

*(anything found and NOT acted on, per rule 3)*

**Recorded at creation, NOT part of this unit:**

- **Should the standing receiver have accepted this connection at all?** Andre, 2026-09-03: *"their
  standing receiver, which shouldn't receive messages from anyone they're not expecting."* A message
  for a session that does not exist arrived over a connection that was accepted. This unit triages
  the message; it does not ask why the door opened. That is a separate question and it may already
  be covered by the assignment-verification work.
