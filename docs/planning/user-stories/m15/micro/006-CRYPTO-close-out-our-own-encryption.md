---
name: 006-CRYPTO — Close out our own encryption layer
type: micro-work-order
date: 2026-08-24
status: complete
description: >
  DONE: the key agreement was reviewed (six findings, all fixed) and given a caller — a throwaway
  keypair is now minted per session, held in memory only, and destroyed at teardown and shutdown.
  NOT DONE, and 007-CRYPTO owns it: nothing exchanges the public halves, so no message body is
  encrypted yet. The title describes the feature, not this order. Source: DOD-M15-KEYAGREE-1.
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

## ⚠️ THIS ORDER IS DONE. THE FEATURE IS NOT. (2026-09-01)

**Read this before believing the `complete` in the frontmatter.** It means *this order's* Definition
of Done is met. It does **not** mean the thing the title describes is delivered: **no message body is
encrypted by CELLO yet**, and every word of *The problem, plainly* below is still true today.
`007-CRYPTO` is what changes that.

That distinction is the whole reason this banner exists. The order was briefly marked `complete`
when only the review was done, which told the next reader the encryption layer was closed out when
nothing called it at all.

**What this order delivered, in two parts, both merged:**
- **Part 1 — the review.** Six findings, three blocking, all fixed, revert proofs recorded.
- **Part 2 — the lifecycle.** The key agreement now has a caller: a throwaway keypair is minted once
  per session on all three activation paths, held in memory only, destroyed everywhere a session's
  entry is dropped and at shutdown, and a revived session re-keys. The session says on its own status
  that CELLO is not encrypting its content, so no reader has to infer it from silence again.

**The feature is 006 + 007 together, and it was scoped with a hole in the middle.** The whole
journey, and who owns each step:

| # | Step | Owner |
|---|---|---|
| 1 | Each side mints a throwaway key when a session opens | 006 ✅ done |
| 2 | The two sides send each other the public halves | **007 — was missing** |
| 3 | Each verifies the half really came from its counterparty | 007 (already scoped) |
| 4 | Both compute the same shared secret | 006 ✅ done |
| 5 | The message body is encrypted with it, and decrypted on arrival | **007 — was missing** |
| 6 | The keys are destroyed when the session closes | 006 ✅ done |

Steps 2, 3 and 5 are ONE wire format and must ship together — split them and a half-upgraded pair
cannot talk. Steps 1 and 6 are purely local and can land first, which is why they stay here.

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

**Part 1 — the review. ✅ DONE, do not repeat.**

1. Run `cello-unit-reviewer` over the key agreement as shipped.
2. Fix every finding.
3. Confirm the tests are real: **each one has been made to fail on purpose** — revert the thing it
   tests, confirm it reddens, confirm it reddens for the reason you expect. A test that stays green
   when you break the code is not a test.

**Part 2 — the key's LIFECYCLE in the daemon. ✅ DONE. Local only; nothing here changed the wire.**

4. **Mint a throwaway keypair when a session opens**, once per session, alongside the salt half that
   is already minted there. Same rule as the salt: minted ONCE, not per reconnect — a fresh key on
   reconnect would leave the two sides deriving against a moving value.
5. **Hold the secret in memory only.** It is never written to the database, never in a backup. That
   is what forward secrecy IS, and it is a ruled decision.
6. **Destroy it when the session closes** — call `destroySessionEphemeral`, and do it AFTER the seal
   ceremony has taken what it needs, not before.
7. **Say what state the session is in**, the way the salt already does: a session whose key never got
   agreed must be visibly so, with a reason an operator can act on. Never a silent gap.

---

## Definition of Done

1. Review pass complete, every finding fixed, verdict quoted below. ✅
2. Every test covering this code has a recorded revert proof. ✅
3. `pnpm run test`, `pnpm run lint`, `pnpm run typecheck` pass. ✅
4. Opening a session mints exactly one throwaway keypair, and reconnecting does **not** mint another. ✅
5. The secret is in memory only: a test asserts it is absent from the database after a session opens. ✅
6. Closing a session zeroes the secret, and it happens after the seal, not before. ✅
7. A session with no agreed key reports that fact with a named reason, on the surface the agent
   reads — not only in the log. ✅
8. Each of 4–7 has a test that has been made to fail on purpose. ✅

**Not in scope:** anything that crosses the wire — the exchange, the signature, and encrypting the
message body are **007-CRYPTO**, and they are one format that ships together. Also not in scope:
anything touching the seal, anything touching the relay.

⚠️ **A revived session RE-KEYS — Decisions Carried #5, and the exchange is 007's.** This secret is
deliberately never persisted, so a session that comes back after a restart mints a fresh keypair and
agrees a new secret, exactly as a new session does. Minting on revival is therefore part of clause 4
above, not an exception to it.

An earlier version of this line said re-keying was ruled out of the gate. That was stale: re-keying
was only ever a problem because the salt used to be derived from this same secret, so a new key meant
a new salt and a transcript half-verifiable under each. This unit decoupled them, which removed the
objection — `session-key-agreement.ts` has said so since.

---

## Traps recorded before you start

- **Do not persist the throwaway secret.** It is deliberately not written to disk. Persisting it
  voids forward secrecy and puts key material into every backup, forever. This is a ruled decision.
- **Do not re-derive the salt from the session key.** Ruled, twice. One exchange, two independent
  values.
- **Both sides contribute to both values.** Never one side minting and sending. A modified client
  could otherwise send the same salt every time and neither side would know.

---

## Review — CLOSED. This half is done; do not repeat it.

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

## Review — part 2, the lifecycle

One pass, `cello-unit-reviewer` on Opus. **Ten findings — five blocking, all ten fixed.** Two were
real holes in the work, and both were on the path sessions ordinarily take rather than a corner.

> "SPEC: DEVIATIONS FOUND — clause 6 is unmet on the terminal path an interrupted session actually
> takes; clause 7 has no test at all; Decisions Carried #5 is not implemented on the real revive
> path. SILENT FALLBACKS FOUND — the idempotence guard silently preserves a stale secret on revive
> instead of re-keying, and nothing says so."

| # | Finding | Fix |
|---|---|---|
| 1 | The agent-facing half had **no test** — mine asserted the daemon record under a docblock claiming otherwise. Deleting the whole whitelist entry left every test green. Fourth instance of this defect in this codebase, inside the fix for it. | `f6cfe1a` |
| 2 | **An interrupted session never zeroed its key.** The destroy rode cache eviction; the relay-blip teardown deliberately does not evict, and the later seal returned early — so the secret stayed resident until the process exited. | `f6cfe1a` |
| 3 | **A revived session kept the old key.** Follows from 2: the idempotence guard found the stale secret and silently preserved it, on the one path where re-keying was explicitly decided. Three comments asserted it re-keyed. | `f6cfe1a` |
| 4 | The "destroy after the seal" test asserted **two adjacent log lines**. Moving the destroy before the ceremony passed it. | `f6cfe1a` |
| 5 | The crypto header had been corrected into the **opposite** false claim — "nothing mints an ephemeral" — which this order made two thirds untrue the same day. | `f6cfe1a` |
| 6–10 | Two activation paths untested; shutdown left secrets in memory; an unreachable branch claimed a database provenance it lacks; the disk tripwire would false-positive on `content_salt`; events carried no correlationId. | `f6cfe1a`, `f19e8bb` |

**Revert proofs.** 8 mutants for this part, each run alone and confirmed to COMPILE first. **Three
survived on the first attempt and each got a real test rather than an excuse:** the idempotence guard
(the test only ever opened a session once), the shutdown zeroing (the map was empty either way, so
presence proved nothing — only a reference the test owns can tell dropping from overwriting), and the
agent-facing whitelist. All three now die.

**Gate.** `lint` ✅ · `typecheck` ✅ · `test` **4626 passed, 1 failed** — `mcp-001` AC-002, the known
pre-existing failure, unrelated.

---

## Newly discovered

*(One or two lines each. Not acted on.)*

- ~~**The key agreement has no production caller.**~~ **RESOLVED by 007-CRYPTO.** It was true when
  this order closed: `deriveSessionSecrets` appeared only in `core/crypto` and its barrel, so nothing
  encrypted a message. 007 gave it one — the daemon derives on a verified inbound ephemeral and the
  result encrypts the message body. Left visible rather than deleted, because the gap it records is
  why the two orders exist in the shape they do.
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
