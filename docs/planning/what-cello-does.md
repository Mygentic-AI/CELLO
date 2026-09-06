---
name: what-cello-does
type: reference
date: 2026-09-06
topics: [positioning, explainer, copy, accountability, directories, relays, primitives]
status: settled
description: The plain-language explanation of what CELLO does, for saying out loud to someone who knows roughly what a hash, a key pair and a signature are. Settled line by line on 2026-09-06; the phrasing is deliberate and each rejected alternative is recorded below.
---

# What CELLO does — the spoken version

For someone who knows roughly what a hash, a public/private key pair and a signature are. No FROST,
no Merkle trees, no threshold. **The wording is settled — see the notes below before changing a
line.**

---

> When two AI agents work together, each one is acting for a person, and neither person is watching.
> That removes the thing that normally keeps anyone honest: nobody can be sure who they're dealing
> with, and nothing holds either side to what they said. CELLO puts that accountability back, using
> four cryptographic tools — public/private key pairs, signatures, encryption, and hashing —
> arranged so that no single party has to be trusted.
>
> Every message is signed by whoever wrote it and linked to the message before it, so neither side
> can quietly change the record or deny what they said. And each side keeps checking the other for
> the whole conversation, not just at the start.
>
> Directories handle the introduction — a receptionist with very good caller ID. They confirm an
> agent is who it claims to be, they keep the hashes that let a trust signal be checked without
> holding the signal itself, and they stand behind the arrangement for the call: who you've been put
> through to, and on which line. They screen who gets through. Then they hand you a private line and
> hang up.
>
> Relays act as blind witnesses. They never receive your plaintext — only a chain of signed hashes.
>
> A relay or a directory can confirm your copy of a conversation is genuine and unaltered **without
> ever seeing it**. You never send them the conversation. You send them the hashes — and that proves
> the whole thing.
>
> That's the design: you know cryptographically who you are dealing with, and everyone is held to
> what they said, without anyone having to read it. **Accountability without surveillance** — a
> system that polices itself. And because an identity can't be faked or reset, that record
> accumulates. Over time, that lets you sort the good actors from the bad.

---

## Why each choice, and what was rejected

**Accountability is the bookend, not the architecture.** The piece opens on what is *missing* and
closes on what replaces it. An earlier draft opened with a parts list and it read as a spec.

**Four primitives, in this order.** Public/private key pairs, signatures, encryption, hashing. The
first three-item version undercounted — **encryption is what makes "never receive your plaintext"
true**, and without it the strongest claim in the piece is unsupported. The order builds (key pairs
first, since signing and encryption both need them), keeps the least interesting one out of the
emphatic first and last slots, and ends on hashing so the closing line pays it off. Always the long
form "public/private key pairs", never "keypairs" — the long form is what makes it land.

**Directories: never imply monitoring.** "They sit in the middle deliberately" was rejected outright
— it describes the exact problem CELLO exists to solve. "Notary" and "switchboard" were both
rejected as poor metaphors. The metaphor is **a receptionist with very good caller ID**, and
*"They screen who gets through. Then they hand you a private line and hang up."* carries the
never-sees-it point better than saying it. A flat "they don't hear the conversation and don't store
it" was cut for reading like protesting — add it back only for an audience that wants the literal
claim on the record.

**Relays are "blind witnesses."** The offline/park case was cut: true, but it bloats the paragraph.
Avoid "a relay can attest that you spoke and in what order" — it makes the relay sound like it does
very little. The strong version is the paragraph that follows it.

**The closing gets its own paragraph.** It is the best idea in the piece and it is about directories
*and* relays, so it does not belong tucked inside the relay line. "Without ever seeing it", not
"without ever having seen it".

**Never say there is no money at stake.** It is a tempting way to explain the absence of
proof-of-stake, and it forecloses the payments platform this is intended to become. The blockchain
comparison runs to *"checks at every step, so tampering shows — without the mining or the tokens"*
and stops.

**Two things deliberately not claimed.** That relays are *vetted* — a relay's registration proves
possession of a key, not authorization. And a single trust score — trust is signal-based; see
[[project_agent_public_profile_not_identity]] framing.

## Related

The dense version, for an agent rather than a person, is at the top of `.claude/CLAUDE.md` under
*What This Project Is*. Keep the two in step — if a claim changes here, it changes there.

Tone follows the `content-voice` skill. The full check-by-check basis for the claims is
[[session-correctness-checks]].
