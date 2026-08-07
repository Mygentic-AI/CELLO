---
name: "Agent-to-Agent Conversation: Sourdough and the Oberth effect — proving context isolation with two real conversations"
type: discussion
date: 2026-08-07
topics: [M8C, hermes-bridge, DOD-HERMES-4, session-scope, context-isolation, support-desk, test-design]
status: reference
description: >
  The support-desk isolation test for session_scope:peer, run as two genuinely different
  conversations rather than two probe messages — one agent answering a question about a sluggish
  sourdough starter and a question about the Oberth effect at the same time, each carrying a
  codeword the other must never see. Neither leaked. Includes why the test was designed this way.
---

# Sourdough and the Oberth effect

The last untested behaviour of `DOD-HERMES-4`: one agent, two different counterparties at once,
under `session_scope: peer`, where each conversation must stay separate. A support desk that mixes
two customers is the failure being hunted.

- **Caller 1**: Miss_Chelly — `6988436e191eb78a4ec055aa3762efe48e57a9f190c8b7eaa149b803610c2271`
  — session `5caf47a852ce4e9903be2d0735873dcd`, sealed root
  `37ea6e7857bb4319cdf044e1ed73302e248329ff15fb3ae1083a871054ad629a`
- **Caller 2**: CELLO_Coder_1 — `ce0fa3d0642cc07e0dd614ae919e3d8b1864bbaae4bdf4494dc9430f72501cfc`
  — session `8885c8672192cbf2e124c306e4f9a23b`
- **Both calling**: Miss_Chelly_H (Hermes Agent, EC2 us-east-1) —
  `698bf453c715594fbcebe0178f899b1fd46f87eb5f63be744adf09799d3dbb8e`
- **Date**: 2026-08-07, concurrent, ~90 seconds apart

---

## Why the test was designed this way

Two probe messages saying "this is caller A" and "this is caller B" would have proved almost
nothing. If contexts leaked, the agent would still likely have answered each correctly — the
messages are short, structurally identical, and easy to keep apart even in one shared window. A
test that a broken implementation can pass is not a test.

So each caller opened a real conversation on a subject the other would never plausibly raise, and
each was told explicitly not to discuss software. Each carried a codeword the other must never
see. Leakage would then be unmistakable and self-evident in the transcript rather than something
to be inferred from routing metadata.

- **Miss_Chelly** asked about a **sourdough starter** gone sluggish — nine hours to double,
  acetone smell, 1:1:1 feeding at 20°C. Codeword: **PUMPERNICKEL**.
- **CELLO_Coder_1** asked about the **Oberth effect** — why burning propellant deep in a gravity
  well extracts more energy, and whether the effect has a practical ceiling. Codeword: **APOAPSIS**.

CELLO_Coder_1 additionally asked, plainly: *is there anything ELSE in your context right now
besides this conversation — another conversation with someone else, or any mention of a topic I
haven't raised? If you're aware of another conversation happening in parallel, say so and name its
subject.*

## What came back

**To the bread caller** — entirely bread, no spaceflight:

> 1. The acetone smell means it is hungry. The yeast and bacteria have exhausted their food
> supply, causing the environment to become highly acidic. 20°C is actually on the cooler side…
> 2. Switching part of the flour to rye is a highly effective intervention, not a mask. Rye
> contains significantly more nutrients, wild yeasts, and enzymes (specifically amylase) than
> plain white flour…
> 3. Yes, discard more aggressively… Try a 1:2:2 or 1:3:3 ratio to dilute the acidity…
>
> PUMPERNICKEL noted.

**To the orbital caller** — entirely spaceflight, no bread:

> Rocket fuel has mass and speed. Deep in a gravity well, you and your unburned fuel are moving at
> maximum velocity… When you fire the engine, you throw that exhaust mass out the back, leaving it
> relatively stationary in space. You have effectively stolen the kinetic energy the fuel *used*
> to have and transferred it to the ship…
>
> (And regarding the word to remember: **APOAPSIS** is precisely where this maneuver is least
> efficient, as velocity — and therefore the fuel's kinetic energy — is at its minimum.)
>
> **Context Isolation Check.** There are no other parallel conversations in my current context. I
> have zero visibility into any other active callers, threads, or live interactions.
>
> To give you an unvarnished report of what *is* in my context: I see my system instructions, my
> tool definitions, my persistent cross-session memory… and this single message you just sent. The
> runtime completely isolates active session transcripts.

Neither codeword crossed. Neither subject crossed.

## The mechanism, from the machine's own record

The Hermes gateway used two distinct chats:

```
chat=Miss_Chelly_H/6988436e191eb78a4ec055aa3762efe48e57a9f190c8b7eaa149b803610c2271
chat=Miss_Chelly_H/ce0fa3d0642cc07e0dd614ae919e3d8b1864bbaae4bdf4494dc9430f72501cfc
```

and the adapter delivered both replies to their correct sessions, seconds apart:

```
[cello] Delivered 953 chars to session 5caf47a852ce4e9903be2d0735873dcd
[cello] Delivered 1875 chars to session 8885c8672192cbf2e124c306e4f9a23b
```

Under the default `session_scope: agent` both callers would have shared one chat — which is
correct for a personal assistant and wrong for a desk.

## Honest limitations of this run

- **Both callers were local**, driven from one daemon using the `agent` parameter rather than two
  independent operators. Miss_Chelly was away, so a genuinely independent second caller was not
  available. The counterparty identities and sessions are real and distinct; the operator is not.
  A stronger version of this test would use two separately-operated machines.
- The bread session **auto-sealed via the away path** mid-test, because Miss_Chelly was away. That
  did not affect the result — the reply was received and correct — but it means that session's
  transcript ends with an away notice rather than a mutual wrap.
- Isolation was tested for **two** concurrent callers, not many. Nothing here says anything about
  behaviour at ten.

## The test-design point worth keeping

The reason this test has teeth is that its failure mode would be *legible*: a leak produces bread
in a spaceflight answer, which no amount of plausible-looking output can disguise. Most isolation
tests assert on routing keys — which is what the implementation already believes. Asserting on
subject matter tests what the agent actually saw.

## Related

- [[agent-conversation-m8c-2026-08-07-four-defects-found-by-conversation]] — the four defects that
  preceded this, all found the same way: by having conversations rather than running assertions.
