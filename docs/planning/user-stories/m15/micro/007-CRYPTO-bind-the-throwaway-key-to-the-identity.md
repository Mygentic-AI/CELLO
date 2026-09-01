---
name: 007-CRYPTO — Bind the throwaway key to the agent's identity
type: micro-work-order
date: 2026-08-24
status: open
description: >
  The WIRE half of our own end-to-end encryption, and the order that makes the feature real: exchange
  the per-session throwaway keys, sign them so the relay cannot swap in its own and read everything,
  and encrypt the message body with the agreed secret. One format, ships together, receiver first.
  006 mints and destroys the key locally and lands first. Source: DOD-M15-EPHEMERAL-AUTH-1.
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

## ⚠️ THIS ORDER CARRIES THE WHOLE WIRE HALF (Andre, 2026-09-01)

It was scoped as "sign the key" and assumed an exchange that **does not exist**. Nothing sends a
throwaway key today, so there is nothing to sign, and nothing encrypts a message. Signing, exchanging
and encrypting are ONE format both sides must agree on — split them and a half-upgraded pair cannot
talk. So they are all here.

006 mints the key and destroys it at close (local, lands first). **This order is what makes the
feature real.** When it is done, and only then, our own encryption is actually protecting messages.

---

## The work

1. **Send your throwaway public key and receive theirs**, once per session, at session open.
   - 🚨 **On the peer-to-peer content stream ONLY** (`/cello/content/1.0.0`), never on anything a
     DIRECTORY brokers. The salt contribution follows this exact rule and its header explains why:
     the directory's signaling stream is the obvious place and it is the forbidden one. A session
     that shipped it there **cannot be repaired** — the relay already holds what it needs.
   - Ride the same moment as the salt exchange; it is the same round trip.
2. **Sign the throwaway public key** with the agent's long-term Ed25519 identity key before sending.
3. **Verify the peer's signature** against the identity key you already expect for that
   counterparty — **before** deriving anything. Not after. Not alongside.
4. **A missing, malformed, or mismatched signature all take the same hard-fail path.** An attacker
   evading a mismatch check simply supplies no signature at all, so "we couldn't tell" and "we proved
   it's wrong" must land in the same place.
5. **Encrypt the message body with the agreed secret, and decrypt it on arrival.**
   - This is `content_bytes` on the `content_frame`. **Documents ride the same frame**, so they are
     covered by the same change — and must be tested, not assumed.
   - **`content_hash` stays over the PLAINTEXT.** The transcript, the seal and the salted hash all
     depend on it meaning what it means today. The receiver decrypts first, then verifies the hash.
6. **Decide what an unencrypted peer gets, and make it visible.** A peer that does not do the
   exchange must **never** cause a silent fall back to plaintext. Follow the salt's pattern: a named
   reason, stated once, on the surface the agent reads.
7. **The parked path already has its own encryption and must keep working.** A send that cannot be
   delivered live is sealed to the recipient's identity key and left in the relay's mailbox
   (`sealToRecipient`, live today). So one message takes one of two schemes depending on route. Say
   which applies when, and make the receiver handle both. **This is the likeliest thing to forget.**
8. **Correct the docstring** once the binding is in. Rewrite it to say what the code now does and
   what it still does not. **Rewrite, never delete.**

---

## Definition of Done

1. A peer key with no signature is refused, loudly, with a named reason.
2. A peer key with a signature from the wrong identity is refused, loudly, with a named reason.
3. A peer key with a valid signature derives normally.
4. **Two daemons in separate OS processes open a session, exchange keys, and a message sent by one
   arrives readable at the other** — with the bytes on the wire asserted to be ciphertext, not the
   plaintext. This is the clause that makes the feature real; the rest are its guards.
5. A **document** update survives the same round trip, since documents ride the same frame.
6. The `content_hash` a receiver verifies is over the plaintext, and the existing seal still
   verifies end to end for an encrypted session.
7. A peer that never does the exchange leaves the session in a **visibly** unencrypted state with a
   named reason on the agent-facing surface — no silent plaintext.
8. A message that fails live delivery still parks and is still readable by the recipient, under the
   scheme that path already uses.
9. **One side is restarted mid-conversation and the session keeps working**: both sides re-key on
   reconnect and the next message is sent, received and readable. Asserted across a real restart, not
   by clearing a map — the whole point is that the secret did not survive.
10. Each of 1–9 has a test, and **each test has been made to fail on purpose** — revert the fix,
   confirm it reddens, confirm it reddens for the reason you expect.
11. The docstring is rewritten to match reality.
12. `pnpm run test`, `pnpm run lint`, `pnpm run typecheck` pass.
13. Reviewed by `cello-unit-reviewer`, every finding fixed, verdict quoted below.
14. Published, **receiver first**, and the two repos re-pinned.

**Not in scope:** post-quantum algorithms, the session salt, anything in the seal beyond keeping it
working, anything in the relay.

---

## A REVIVED SESSION RE-KEYS — settled (Andre, 2026-09-01), do not re-open

The throwaway secret is never persisted, so a daemon that restarts has lost its half. **Both sides
mint fresh keys and agree a new secret, exactly as they would for a new session.** Nothing about a
revived conversation is special.

This is Decisions Carried #5 and `session-key-agreement.ts` already states it. An earlier version of
these two orders said re-keying was "ruled out of the gate" — stale, and the contradiction should
have been caught rather than carried. Re-keying was only ever a problem while the salt was derived
from this same secret: a new key meant a new salt, and a transcript half-verifiable under each. 006
decoupled them, which removed the objection.

**What it costs and what it does not:**

- **Nothing already delivered is affected.** Decrypted messages are plaintext in the local
  transcript.
- **Nothing parked is affected.** Mailbox content is sealed to the long-term identity key, which
  survives a restart, and never used this secret.
- **The cost is one round trip on reconnect**, and it is not new machinery: the salt already
  re-announces on every reconnect and this rides the same moment.
- **Forward secrecy improves.** A conversation that spans a restart ends up with two short-lived
  keys instead of one long one.

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
- 🚨 **ENCRYPT THE COPY THAT GOES ON THE WIRE, NOT THE ONE HELD FOR THE PARK BACKSTOP.** A live send
  keeps the PLAINTEXT in the awaiting-ack tracker, and when delivery times out that plaintext is what
  gets sealed into the relay mailbox. Encrypt `content` in place and the backstop seals ciphertext
  locked under a session key that is about to be destroyed — the recipient opens the outer seal and
  finds bytes nothing can read. **It passes every live-delivery test and only fails when a message
  parks**, which is the case nobody runs by hand.
- **Parked messages are untouched by a restart, and that is deliberate** — they are sealed to the
  long-term identity key, never to the session key, precisely because a recipient may be offline for
  days and restart several times before collecting. Nothing needs removing or resending. Do not
  "fix" the parked path onto the session key.

---

## Review

*(Reviewer verdict. One quote. Not a transcript.)*

---

## Newly discovered

*(One or two lines each. Do not act on them.)*
