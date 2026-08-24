---
name: 007-CRYPTO — Bind the throwaway key to the agent's identity
type: micro-work-order
date: 2026-08-24
status: open
description: >
  Nobody signs the per-session throwaway key, so the relay can swap both sides' keys for its own and
  read everything. Sign it with the agent's identity key and verify the peer's before deriving.
  Source: DOD-M15-EPHEMERAL-AUTH-1.
---

# **<ins>MICRO</ins>** WORK ORDER 007-CRYPTO — Bind the throwaway key to the identity

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

Our own encryption works like this: you mint a throwaway key, they mint a throwaway key, you swap
them, and you both mash them together into the same shared secret. The secret itself never goes over
the wire.

**Nobody signs the throwaway key.** So when one arrives, you have no way to tell it came from your
counterparty rather than from whoever is carrying the traffic.

**What that costs an operator, step by step:**

1. You send your throwaway key. The relay is in the middle.
2. The relay keeps yours and sends the counterparty **its own** key instead.
3. It does the same in the other direction.
4. It now shares one secret with you and a different one with them.
5. It decrypts everything you send, reads it, re-encrypts it, and passes it on. Neither side sees
   anything wrong.

So the layer stops someone recording traffic and cracking it later. **It does not stop the relay.**
And we run the relays — so the guarantee is currently "trust us", which is the exact thing CELLO
exists so nobody has to do.

**Our own source code says so.** `session-key-agreement.ts` carries a section titled *"WHAT THIS DOES
NOT DEFEND AGAINST, stated plainly"*. That is honest and it stays — but it also means anyone reading
the public repo finds this in about a minute.

---

## The work

1. **Sign the throwaway public key** with the agent's long-term Ed25519 identity key before sending
   it.
2. **Verify the peer's signature** against the identity key you already expect for that
   counterparty — **before** deriving anything. Not after. Not alongside.
3. **A missing, malformed, or mismatched signature all take the same hard-fail path.** An attacker
   evading a mismatch check simply supplies no signature at all, so "we couldn't tell" and "we proved
   it's wrong" must land in the same place.
4. **Correct the docstring** once the binding is in. Rewrite it to say what the code now does and
   what it still does not. **Rewrite, never delete.**

---

## Definition of Done

1. A peer key with no signature is refused, loudly, with a named reason.
2. A peer key with a signature from the wrong identity is refused, loudly, with a named reason.
3. A peer key with a valid signature derives normally.
4. Each of those three has a test, and **each test has been made to fail on purpose** — revert the
   fix, confirm it reddens, confirm it reddens for the reason you expect.
5. The docstring is rewritten to match reality.
6. `pnpm run test`, `pnpm run lint`, `pnpm run typecheck` pass.
7. Reviewed by `cello-unit-reviewer`, every finding fixed, verdict quoted below.

**Not in scope:** re-keying a revived session (ruled out of the gate), post-quantum algorithms, the
session salt, anything in the seal, anything in the relay.

---

## Traps recorded before you start

- **This is a bilateral wire change.** The receiver must tolerate the new field before any sender
  emits it, or a half-upgraded pair cannot talk. Receiver first.
- **Where the identity key comes from matters.** Use the counterparty identity the client asked for,
  not a value the directory or relay handed back — otherwise you have moved the trust rather than
  closed it.
- **There is an existing tamper check** that refuses a degenerate peer key. A signature now catches
  that too, but **do not remove the existing refusal** without proving the signature covers the same
  case — it is enforcing a separate ruled requirement.
- **Do not weaken an existing assertion to make a new test pass.**

---

## Review

*(Reviewer verdict. One quote. Not a transcript.)*

---

## Newly discovered

*(One or two lines each. Do not act on them.)*
