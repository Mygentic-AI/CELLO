---
name: 009-PROOF — An operator can prove one message sits under a sealed root
type: micro-work-order
date: 2026-09-01
status: complete
description: >
  `cello_get_inclusion_proof` is a stub that returns not_implemented. Build it: given a message,
  return a proof that it sits under the root the directory actually notarized — and a verify path
  that a third party can run. The Merkle primitives already exist; this is wiring plus the hard
  parts nobody has done, which are the SALT and the CERTIFIED root. Source: DOD-M15-INCLUSION-1.
---

# **<ins>MICRO</ins>** WORK ORDER 009-PROOF — Prove a message is in the sealed conversation

> ## THE RULES OF A MICRO WORK ORDER
>
> 1. **Read [[M15-PROCEDURE]] IN FULL before you start.** It is the working discipline for this
>    milestone and it binds you — the gate, the review dispatch, the invariants, how tests are run.
>    **Do not read `M15-DEFINITION-OF-DONE.md` or `M15-BUILD-JOURNAL.md`**; this order carries
>    everything you need from them.
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

CELLO's whole product is the receipt: a notarized record of a conversation. Today an operator can
hold that receipt and prove **a** conversation was sealed. They cannot point at one message in it and
prove **that message** is inside.

`cello_get_inclusion_proof` is registered as a tool, is visible to every operator and every agent
that lists the tools, and returns:

```
{ ok: false, reason: "not_implemented",
  guidance: "'cello_get_inclusion_proof' is not yet implemented in the daemon." }
```

**What that costs:** the receipt is currently all-or-nothing. You can say "this conversation was
notarized." You cannot say "and here is the proof that the sentence you are disputing is in it,
unaltered." For a product sold as a notary, the second sentence is the one that matters.

---

## What already exists — do NOT rebuild any of it

Read these before writing a line. Three of the four pieces are built and tested.

| Piece | Where | State |
|---|---|---|
| Merkle proof generation | `core/crypto/src/merkle.ts` → `inclusionProof(tree, index)` | ✅ built |
| Merkle proof verification | `core/crypto/src/merkle.ts` → `verifyInclusion(...)` | ✅ built |
| The session's leaf tree | `core/daemon/src/session-tree.ts` → `SessionTree` | ✅ built. Has `indexOfHash(hashHex)`, `hashAt(index)`, `leaves()`, `size()`, `rootHex()` |
| The handler | `core/daemon/src/daemon.ts`, the `not_implemented` stub loop | ❌ **this is the work** |

> 🚨 **A second Merkle implementation is an automatic blocking finding.** If the proof is generated
> by anything other than `inclusionProof`, the proof and the seal can drift and nobody will notice
> until a real dispute. Same rule for verification.

---

## The two hard parts, which are the actual mission

Wiring the handler is an afternoon. These two are why this is a unit and not a chore.

### 1. The proof must be against the CERTIFIED root, not the local tree

`SessionTree.rootHex()` is **this daemon's own** view. A proof that verifies against it proves only
that this machine is self-consistent — which is worth nothing to a third party, because the machine
is the thing under suspicion.

**The proof must verify against the root the directory notarized and signed.** That certificate is
what the operator already holds; it is what `cello_sealed_receipt` returns.

- Resolve the sealed certificate for the session, and use **its** root as the thing the proof lands
  on.
- **If the local tree's root and the certified root disagree, REFUSE.** Do not emit a proof against
  the local root with a warning. A proof that quietly proves the wrong thing is worse than no proof
  — and this divergence has its own meaning elsewhere in the product, so it must be named, not
  smoothed over.
- **If the session is not sealed yet, refuse with a distinct reason.** "Not sealed" and "sealed but
  your copy disagrees" are completely different situations for the operator and must not share a
  reason string.

### 2. The content hash is SALTED, so a proof over the hash is not a proof about the message

The leaf is a content hash, and that hash is now `HMAC-SHA256(salt, 0x00 ‖ content)` — not a plain
SHA-256 — where the salt is agreed once per session and stored on the session record.

**Consequence:** a proof over the leaf hash proves "this opaque hash is in the tree." Binding it to
an actual message means the verifier can recompute the hash from the plaintext, which needs the
salt.

- The proof output must carry enough for a verifier to **recompute the leaf hash from the message
  bytes** — which means the salt travels with the proof, and the algorithm is named rather than
  assumed.
- **Use the daemon's own hashing function.** There is one (`wire-content-hash.ts`, `contentHashFor`).
  Do not re-derive the HMAC in the handler. A second implementation of the hash is the same defect
  class as a second Merkle, and this exact mistake has already been made once in a journey fixture.
- **Assume SALTED. Do not build an unsalted path.** There are no users and no production data, so
  there is no stock of old unsalted sessions to be compatible with — supporting one is work with no
  beneficiary, and the procedure's alpha-cost lens makes that a blocking finding, not a nicety.
  Write the proof for the salted case, and if an unsalted session turns up, **refuse it by name** so
  it is visible rather than silently proved under a weaker scheme. Record it under *Newly
  discovered*; do not grow a branch for it.

> ⚠️ **Do not "fix" the salt problem by leaving the salt out and calling the proof "about the hash".**
> That is technically true and useless: it is a proof about a number, and the operator's question is
> about a sentence.

---

## The work

1. **Implement the handler.** Remove `cello_get_inclusion_proof` from the `not_implemented` stub
   loop and give it a real handler. Leave the loop in place if any other tool still needs it —
   check before deleting the loop itself.
2. **Input:** the session, and the message being proved. Accept whatever identifies a message
   unambiguously on this codebase's own terms — read how the transcript addresses a message rather
   than inventing a new identifier.
3. **Output:** the leaf index, the proof path, the certified root, the hash algorithm and salt (when
   salted), and the session it belongs to. Enough that a verifier holding the message bytes and the
   certificate needs nothing else.
4. **A verify path a third party can actually run.** A proof nobody can check is a data structure,
   not a proof. Expose verification the same way the tool is exposed, and make it work from the
   proof + the message bytes + the certificate alone — **no access to this daemon's database.**
5. **Refusals name their cause and say what to do**, in the shape the rest of this codebase uses:
   not sealed yet; message not in this session; local tree disagrees with the certificate.

---

## Definition of Done

1. A message in a sealed session yields a proof, and the verify path accepts it.
2. **The proof verifies against the CERTIFIED root** — asserted by verifying against the root taken
   from the certificate, not from the local tree.
3. A message that is NOT in the session is refused, with a named reason.
4. A session that is not yet sealed is refused, with a DIFFERENT named reason.
5. A local tree that disagrees with the certified root refuses rather than emitting a proof.
6. **A tampered message fails verification.** Change one byte of the message bytes and the verify
   path must reject — this is the assertion that proves the whole feature does its job.
7. A tampered proof path fails verification.
8. A salted session produces a working proof whose output names the algorithm and carries the salt.
   **An unsalted session is refused by name** — no compatibility branch (see the alpha-cost note
   above).
9. The proof verifies with **no access to the daemon's database** — from proof + message + certificate
   alone. Prove it in the test by constructing the verifier from those three inputs only.
10. Each of 1–9 has a test, and **each has been made to fail on purpose** — revert the fix, confirm
    it reddens, confirm it reddens for the reason you expect.
11. `pnpm run lint` and `pnpm run typecheck` pass. Tests: the packages you touched, smallest scope
    first — see the machine budget above.
12. **The MCP tool description matches what it now does.** It has been advertising a feature that
    returned `not_implemented`; if the description overstates or understates the new behaviour, fix
    it. A false claim in a shipped tool description is a blocking finding in this project.
13. Reviewed by `cello-unit-reviewer`, every finding fixed, verdict quoted below.

**Not in scope:** changing the seal, the certificate format, or the wire; proving inclusion across
sessions; anything in the directory or the relay; the `not_implemented` stubs for any other tool.

---

## Traps recorded before you start

- **A proof against your own root proves nothing.** The machine generating the proof is the machine
  a sceptic distrusts. Land it on the notarized root or it is theatre.
- **Do not weaken an existing assertion to make a new test pass.**
- **Do not write a second Merkle or a second content-hash implementation.** Both exist. Two
  implementations drift, and the drift shows up as a lost dispute, not as a failing test.
- **`not_implemented` is currently HONEST.** Whatever you ship must be at least as honest. If some
  case cannot be proved yet, refuse it by name — do not return a proof that only works when the
  caller does not look closely.
- **Check the tool description before you finish.** This repo fails builds on claims that outrun the
  code, and this tool's description is a claim.

---

## Review

`cello-unit-reviewer`, one pass, ten findings — all fixed:

> **SPEC: FAITHFUL** … **NO SILENT FALLBACKS** … **ERROR SUBSTITUTION FOUND** — [blocking] F5 …
> **HOLLOW TESTS FOUND** — [blocking] F1 (the seal→table wiring survives full deletion with the
> suite green) and F7 … **REMOVALS PROVEN.**
>
> "I am not rubber-stamping this: it is the strongest unit I have read in this milestone, and F1 is
> still the kind of gap that ships a feature which works in vitest and returns
> `certified_leaves_not_carried` on every real session."

It also confirmed the load-bearing claim independently, from the directory source rather than from
my comments: the certified root is built over **every** leaf including ctrl, `final_root` is the
non-ctrl root, and `SessionTree.rootHex()` equals the second. A literal reading of DoD clause 5
(compare the two roots) would have refused every session; the prefix check is the only workable one.

A `cello-fallback-finder` pass ran first and produced six more, also all fixed. The two that
mattered were one shape: **a refusal that asserted the most benign of four causes.**

---

## Newly discovered

*(One or two lines each. Do not act on them.)*

- **The verifier has no CLI twin, and it is the half that most needs one.** `cello_verify_inclusion_proof`
  reads no session and no database precisely so a SCEPTIC can run it — and a sceptic is likelier to
  have a terminal than an MCP client. Exempted in `capability-registration-inversion.test.ts` with
  that reason stated.
- **The party that was ABSENT at seal time can never issue a proof.** The signed leaves ship only on
  the present party's confirm frame (`FINDING-5`), so the absent side holds a receipt it cannot prove
  anything against. Refused by name (`certified_leaves_unavailable`) with guidance to ask the
  counterparty, but the asymmetry is real and undisclosed anywhere else.
- **A salt read FAILURE and a genuinely unsalted session are the same `null`.** `#getSessionSalt`
  returns null for a transient DB read error as well as for absence, so `session_unsalted`'s guidance
  can tell an operator something false about their own session.
- **`seal-coordinator.ts` still carries pre-LEG-2 backward-compat branches** ("no frontier_leaves
  shipped (an older directory)"). With no users and no deployed old directories, those are branches
  with no beneficiary.
- **The tool name is already spoken for in the other repo.** PERSIST-017 specifies
  `cello_get_inclusion_proof` as the **MMR checkpoint** proof — pending before the sealed root is
  anchored, the full MMR proof after (`packages/directory/src/mmr-store.ts`, still `test.todo`), and
  `.claude/commands/cello-chat.md` described that behaviour to operators. Two different proofs, one
  name, and the MMR surface now has none.
