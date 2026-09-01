---
name: 006-CRYPTO — Close out our own encryption layer
type: micro-work-order
date: 2026-08-24
status: complete
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

One pass, `cello-unit-reviewer` on Opus. **Six findings — three blocking, all six fixed.**

> "I am not rubber-stamping this. The crypto primitives themselves are in good shape — the a3ae519
> lesson was genuinely carried into the salt module and the byte-pinning there is the strongest work
> in the unit. The defects are all one layer out, in the state machine and the wiring: a liveness
> loop that two honest daemons reach after one ordinary write failure, and two places where a
> distinction the code went to deliberate trouble to preserve is dropped one call before the person
> who needs it."

| # | Finding | Fix |
|---|---|---|
| 1 | **Two healthy daemons trade salt frames forever** after one failed persist plus a reconnect. F14's latch closed one fixed point and opened its mirror, and its comment asserted the safety it had lost. Measured: 24 repairs, no terminal state. One libp2p stream each per round trip, for the life of the session. | `f166ed0` |
| 2 | The peer's **storage fails and we tell our operator their counterparty is fine**, with a remedy that cannot work. All four `adoptionClosed` reasons collapsed into one sentence one call before the operator. | `5e64b59` |
| 2b | The suspended branch had the same hardcode, and a mutation proved **nothing was watching it**. | `96f1060` |
| 3 | The session listing reported **`salted` at the exact moment the session stopped salting** — and because the field is emitted only when false, the agent saw nothing, which reads as "not unsalted". The refused case is the one the field exists for. | `01b680c` |
| 4 | The **PQ transcript's position was pinned by nothing**, and its position is the entire reason it was added early. Two mutants measured byte-identical on every pinned vector. | `ebc811e` |
| 5 | Four shipped comments in a **public repo** still describe the two-output derivation this unit deleted — one inside an operator-facing error string, one refuted by a test 60 lines below it. Rewritten, not deleted. | `0f0741e` |
| 6 | A counterparty could **write text that reads as CELLO's own log line** — peer-chosen label, uncapped, interpolated into a `detail` the operator reads as our diagnosis. | `a4d55f2` |

**DoD 2 — revert proofs.** 17 mutants, each run alone, each confirmed to COMPILE first (a mutant that
fails typecheck is not caught), each checked against the test it was aimed at:

- **salt module (5/5 caught):** XOR combiner · inverted sort · peer all-zero check removed · fingerprint
  reduced to a salt prefix · HMAC replaced by length-extendable concatenation.
- **key agreement (6/6 caught):** pubkey binding dropped · inverted sort · sessionId unbound · PQ extra
  ignored · bit-255 check removed · destruction made a no-op.
- **the six fixes above (6/6 caught):** including both transcript mutants the review measured as
  surviving, which now die.

**DoD 3 — gate.** `lint` ✓ · `typecheck` ✓ (this is the build) · `test` **4599 passed, 1 failed** —
`mcp-001-agent-lifecycle` AC-002, the known pre-existing failure, unrelated: `cello_start_agent` now
returns a `guidance` field that its exact-match assertion predates.

---

## Newly discovered

*(One or two lines each. Not acted on.)*

- **The key agreement has no production caller.** `deriveSessionSecrets`, `generateSessionEphemeral`
  and `destroySessionEphemeral` appear only in `core/crypto` and its barrel — verified with a positive
  control (`deriveSessionSalt` returns 11 files including live daemon code). So the salt half is wired
  and working, and the encryption half never encrypts a message; nothing destroys an ephemeral at
  close. This is deliberate sequencing — the identity binding (007-CRYPTO) comes first — and the file
  now says so instead of reading as done. Wiring it is a separate order and a wire change.
- **`SALT_ADOPTION_CLOSED` is a dead export** (`session-salt-agreement.ts`). Exactly one occurrence
  repo-wide: its own declaration. The wire uses `SALT_ADOPTION_LABELS.*`. Left alone — removing an
  export from a published package is not this order's business.
- **An orphaned docstring** in `session-node-manager.ts`: the block describing the
  `setSaltContributionForTest` seam is separated from it by the whole `runAutoAcknowledgeGateForTest`
  definition, so it now reads as documenting the wrong function.
- **A second-mover grinding residual on the salt.** HKDF stops the second mover forcing a chosen
  value (that was the XOR break), but they can still grind ~2^k work for k bits of influence.
  Removing it needs commit-then-reveal. Accepted residual; the reviewer flagged it as worth one line
  in the module header, not a defect.
- **Editing tooling can silently turn a `.ts` file binary.** Writing a control-character regex class
  put a literal NUL in `session-salt-agreement.ts` twice, and `grep` then reported *no matches* for
  symbols that were present — indistinguishable from "unused". Caught both times only by running a
  positive control. The fix filters by code point so no escape appears in the source.
