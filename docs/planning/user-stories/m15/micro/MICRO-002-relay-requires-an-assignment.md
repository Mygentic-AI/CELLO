---
name: MICRO-002 — No relay service without a directory-issued assignment
type: micro-work-order
date: 2026-08-24
status: open
description: >
  The relay serves anyone holding any Ed25519 keypair. Make it refuse unless the caller presents a
  directory-signed session assignment naming them as a participant, and install the connection gater
  so a circuit address is not dialable by whoever learns it. Source line: DOD-M15-RELAYAUTH-1.
---

# **<ins>MICRO</ins>** WORK ORDER 002 — The relay requires an assignment

> ## THE RULES OF A MICRO WORK ORDER
>
> 1. **This file is the whole world.** Do not read or write `M15-DEFINITION-OF-DONE.md`,
>    `M15-BUILD-JOURNAL.md`, or any other milestone document. Everything you need is here.
> 2. **MICRO means small.** One mission. Follow it to its end. **Never grow the mission.**
> 3. **Found something else?** Write it under *Newly discovered* at the foot of this file and
>    **keep going**. Do not fix it. Do not open a line for it. Do not investigate it.
> 4. **500 lines, hard cap.** If this file is growing, you are writing detail nobody needs.
>    Minimal without omitting anything. No scratchpad. No narration of what you tried.
> 5. **Standard procedure still applies:** implement → review (`cello-unit-reviewer`) → fix every
>    finding → commit. Commit per fix, push after every commit.
> 6. **Done is done.** When the Definition of Done below is met, stop. Do not look for more.

---

## The problem, plainly

Anyone can authenticate to the relay with a throwaway keypair. The relay never asks whether that key
belongs to a real agent, and never asks whether the caller has any business in the session they are
talking about. Its port is open to `0.0.0.0/0`.

**What that costs an operator:** a stranger can hold a circuit address and dial straight through to
an agent, because the libp2p hook that restricts who may dial a reservation holder was never
installed. The direct route was closed earlier in this milestone. This is the same door, other side.

## The settled design — do not re-derive it

**The relay verifies a credential the caller presents. It does NOT query the directory.**

That is a ruled decision, and the reason is that a relay must stay a cheap, stateless signature
verifier that a private enterprise can run standalone. Making it a directory client would break that.
The caller already holds the assignment, so it simply presents it.

---

## The work

### 1. Relay service requires an assignment
Refuse relay service unless the caller presents a directory-signed session assignment naming them as
a participant.

- **Including collecting parked content.** The credential is the assignment from the session those
  messages belong to — the caller already holds it. This is not an exemption, it is a credential
  they already have.

### 2. Verify the authenticating key is a registered agent
Today any Ed25519 keypair authenticates. It must be a key the presented assignment names.

### 3. Install the connection gater on the relay, including the reservation-dial hook
- Reservations are granted to any peer, up to 4096.
- The libp2p hook restricting who may dial **through** to a reservation holder is never installed.
- Gate reservation grants on the same directory-signed credential, and restrict circuit dials to the
  counterparty the assignment names.

### 4. Check before you build — one of these may already be done
The liveness query (`is agent X online?`) was reported as already scoped to a named participant by
earlier work in this milestone. **Read the handler before touching it.** If it is already scoped,
say so and move on. Do not redo it, and do not assume the report is right either — read the code.

---

## Definition of Done

1. A caller with a valid keypair but no assignment is refused relay service — including parked-content
   collection.
2. A caller presenting an assignment that does not name them is refused.
3. A circuit dial from a peer the assignment does not name is refused.
4. Tests cover all three refusals **and** the happy path, and **each test has been made to fail on
   purpose** — revert the fix, confirm it reddens, confirm it reddens for the reason you expect.
5. `pnpm run test`, `pnpm run lint`, `pnpm run typecheck` pass.
6. Reviewed by `cello-unit-reviewer`, every finding fixed, verdict quoted below.

**Not in scope:** rate limiting (MICRO-003), the admin frame types (MICRO-004), any change to the
directory, any change to what the client sends beyond what is needed to present the assignment.

---

## Traps recorded before you start

- **A refusal must be loud and must name its cause.** A relay that silently drops is indistinguishable
  from a relay that is down.
- **Bilateral order.** If the client must send anything new, the relay must accept the new shape
  before any client depends on it, or a mid-roll fleet refuses live sessions.
- **Do not weaken an existing assertion to make a new test pass.**

---

## Review

*(Reviewer verdict. One quote. Not a transcript.)*

---

## Newly discovered

*(One or two lines each. Do not act on them.)*
