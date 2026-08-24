---
name: 006-CRYPTO — Close out our own encryption layer
type: micro-work-order
date: 2026-08-24
status: open
description: >
  The per-session key agreement is written but has never been reviewed. Review it, fix every
  finding, close it. Do not extend it — the identity binding is 007-CRYPTO and is deliberately a
  separate order. Source: DOD-M15-KEYAGREE-1.
---

# **<ins>MICRO</ins>** WORK ORDER 006-CRYPTO — Close out our own encryption

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

Live messages today are protected by libp2p's encryption, not ours. That means we cannot move to
quantum-resistant algorithms on our own schedule — we move when libp2p moves, using whatever they
pick.

That matters now rather than later because of **harvest-now-decrypt-later**: someone recording
relayed traffic today can decrypt it when quantum capability arrives. Every conversation that crosses
a home router is relayed, so it is recordable today, at a fixed set of endpoints. Adding the layer
later does not protect what already went over the wire.

**The code for this is written.** It has never been through a review pass. That is the whole job.

## What was built — take this as given

- Each side mints a fresh throwaway keypair per session, they agree a shared secret, and the
  throwaways are destroyed at session close. **Not** a key derived from the two long-term identity
  keys — that would give the same key forever and kill forward secrecy.
- The derivation **accepts a second shared secret from day one**, before there is a post-quantum
  contribution to put in it. Adding hybrid PQ later is then mixing in a second value, not a rewrite.
- The session salt is a **separate value agreed in the same exchange** — not derived from the key.
  The key must be destroyed at close; the salt must survive for the life of the session. Tying them
  together tied "must be forgotten" to "must be kept". Do not re-couple them.

---

## The work

1. Run `cello-unit-reviewer` over the key agreement as shipped.
2. Fix every finding.
3. Confirm the tests are real: **each one has been made to fail on purpose** — revert the thing it
   tests, confirm it reddens, confirm it reddens for the reason you expect. A test that stays green
   when you break the code is not a test.

---

## Definition of Done

1. Review pass complete, every finding fixed, verdict quoted below.
2. Every test covering this code has a recorded revert proof.
3. `pnpm run test`, `pnpm run lint`, `pnpm run typecheck` pass.

**Not in scope:** binding the throwaway key to the agent's identity — that is **007-CRYPTO** and it
is a separate order on purpose. Also not in scope: re-keying a revived session (ruled out of the
gate), anything touching the seal, anything touching the relay.

---

## Traps recorded before you start

- **Do not persist the throwaway secret.** It is deliberately not written to disk. Persisting it
  voids forward secrecy and puts key material into every backup, forever. This is a ruled decision.
- **Do not re-derive the salt from the session key.** Ruled, twice. One exchange, two independent
  values.
- **Both sides contribute to both values.** Never one side minting and sending. A modified client
  could otherwise send the same salt every time and neither side would know.

---

## Review

*(Reviewer verdict. One quote. Not a transcript.)*

---

## Newly discovered

*(One or two lines each. Do not act on them.)*
