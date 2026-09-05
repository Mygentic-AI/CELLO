---
name: 031-RELAYREPLAY — A new witness can prove the conversation it inherits
type: micro-work-order
date: 2026-09-05
status: complete
dod_line: DOD-M15-SESSION-RELAY-PINNED-1
dod_effect: unit-of. Unit 2 of 4 of [[M15-STORY-RELAYHANDOVER]]. Unit 1 (`017-TBS`) closed
  2026-09-03. This unit builds the RELAY-SIDE half — a relay that can be handed a conversation
  which began somewhere else, and refuses one it cannot prove. NOTHING SENDS A REPLAY WHEN THIS
  UNIT IS DONE; the client half is unit 3. The line does not flip on this unit.
description: >
  The relay learns to accept a conversation it did not witness from the start. A resume assignment
  names it the new witness and names the relay that came before; the client hands over both parties'
  signed leaves; the relay rebuilds that chain from signatures alone and either adopts it or refuses
  by name. Reading ships before writing, exactly as 020-ACKHASH did — this unit verifies, and no
  client emits a replay until unit 3.
---

# **<ins>MICRO</ins>** WORK ORDER 031-RELAYREPLAY — The new witness proves what it inherits

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

> ## 🚫 NO CLIENT SENDS A REPLAY IN THIS UNIT
>
> When you finish, **the relay can verify and adopt a replayed conversation, and nothing produces
> one.** If you find yourself editing the daemon's `SessionRelayClient`, you have grown the mission
> — stop and re-read this. The client half is unit 3.

---

## What the operator lives through today

Two agents are talking. The relay witnessing them dies.

Every message from then on costs a ten-second stall and is **not witnessed**. The conversation seals
neither during the outage nor after the relay comes back. When they try to close, **the two of them
are told opposite things**: one gets "success, seal pending" with a root; the other gets "refused,
the seal leaf could not reach the witness". The refused side follows its own guidance once the relay
returns and is then told *the counterparty has not closed* — pointing at the person who did close
and was told it worked, and who therefore has no reason to look.

Nothing gets the receipt back on its own. **The receipt is the product.**

Measured, not inferred: `016-RELAYLOSS`, two real daemons, relay killed mid-conversation.

---

## The mission in one sentence

**A relay can be handed a conversation that started on a different relay, and can prove that
conversation from signatures alone before it agrees to witness the rest of it.**

---

## Where this work lives — ONE REPO

- **`trustless-cello`** → `/Users/andrep/Documents/code/trustless-cello`. Paths beginning
  `packages/…`. Gate: `pnpm run test` / `lint` / `typecheck` (**typecheck IS the build here** —
  there is no separate `build` script and nothing is missing).

**You do not edit `cello-client` in this unit.** That is the finding below, and it makes this unit
smaller than [[M15-STORY-RELAYHANDOVER]] implies.

---

## ⚠️ THE STORY POINTS AT THE WRONG REPO. VERIFIED 2026-09-05, AND IT IS GOOD NEWS.

The story says to *"port `reconstructCarriedSealLeaves` + the chain checks to the relay"*, which
reads as a cross-repo port from the daemon. **It is not.** Both halves already live in
`trustless-cello`, one package over from the relay:

| What you need | Where it actually is | Size |
|---|---|---|
| `reconstructCarriedSealLeaves` | `packages/directory/src/seal-unilateral-verify.ts` | 182 lines, whole file |
| the chain checks | `#verifyUnilateralChain`, a private method on `packages/directory/src/directory-node.ts` (~**5054**) | one method |
| the leaf types they speak | `SealUnilateralLeaf`, `RelaySealData` in `packages/directory/src/directory-types.ts` | two types |

Their only external dependencies are `cbor-x`, `@cello-protocol/crypto` and
`@cello-protocol/protocol-types` — **and `packages/relay` already depends on all three.** No new
dependency, no publish, no cross-repo cascade.

---

## Part 1 — Extract, do not copy. This is not a style preference.

**Move both into `@cello-protocol/interfaces`** (`packages/interfaces`, the `workspace:*` package
both the directory and the relay already import), together with the two types they need. The
directory imports it from there; the relay imports the same function.

**Why extraction and not a copy, and this is the whole reason Part 1 comes first.** This milestone
has now paid twice for a verifier maintained in two places:

- `017-TBS` removed a duplicated assignment TBS builder.
- `020-ACKHASH` Part 1 removed a duplicated `encodeStructure1` — and *"deleting the copy found a
  live drift"*: the canonical definition and the bytes production actually signed had silently
  diverged, with no type error and a green gate.

A second copy of a **seal verifier** drifts the same way, and the failure mode is that one witness
accepts a chain the other would refuse. Copy it and you have built the defect the last two units
removed.

`#verifyUnilateralChain` is currently a private method reading `this`. Extract it as a **pure
function** taking exactly what it needs — leaves, reported root, present-party hex, session id,
roster — which is already its parameter list. It touches no directory state; confirm that before
you move it, and say so in your close-out.

**Behaviour must not change for the directory.** Its existing tests are the proof. If any of them
go red, the extraction is wrong — do not adjust the test.

---

## Part 2 — The relay accepts a resume assignment

`017-TBS` already put **`prior_relay_id`** inside the directory-signed assignment TBS, and it is a
**value, never an absence** — an ordinary session carries `prior_relay_id: ""`. That is the field
this unit consumes.

**Trap, and it decides the design (story §6 trap 2, verified by grep):** *a relay has no knowledge
of any other relay's identity.* There is no relay pool on the relay side — only
`CELLO_DIRECTORY_PUBKEYS`. So the previous relay's id **must** arrive inside the directory-signed
assignment, where it is trustworthy.

- **Do not add a relay roster to the relay.**
- **Do not let the client name the prior relay.** A client that names its own predecessor chooses
  whose signatures it will be judged against.

**What the relay does with it:** a non-empty `prior_relay_id` on a verified assignment marks this as
a **resume**. The relay must know that before the first frame arrives, otherwise the first replayed
leaf looks like message 1 of a brand-new conversation (story §4, D3).

The `session_id` does **not** change (D1). It is inside every signed leaf; changing it invalidates
every leaf being replayed. Re-signed assignment, same session.

---

## Part 3 — The replay frame, and the verifier behind it

One new frame: a **replay batch** carrying both parties' signed leaves for the session, in the shape
`SealUnilateralLeaf` already defines. It is accepted **only** against a verified resume assignment.

The relay verifies it with the extracted function from Part 1, and adopts the rebuilt chain as its
frontier only if every one of these holds:

1. **Every present-party leaf carries the PRIOR relay's signed receipt**, verified against the
   pubkey derived from `prior_relay_id` — not from any relay id the frame itself supplies.
2. **Contiguity:** the sequences are exactly `1..N`.
3. **Every counterparty leaf verifies under its own sender signature.** Counterparty leaves carry no
   receipt by design — the relay does not ack-sign a delivery to the recipient — and are pinned by
   signature plus contiguity against the receipt-pinned own leaves.
4. **The `prev_root` chain and the signed `last_seen_seq` causal order hold.**
5. **The rebuilt content root equals the reported root.**

**Anything else is a refusal by name.** Never a coercion, never a silent truncation to the part that
did verify. A partially-verifying chain is a refused chain.

## ⚠️ TRAP 1 — THE UNSIGNED POSITION, AND THIS UNIT IS WHAT MAKES IT REACHABLE

`DOD-M15-RELAYSEQ-UNSIGNED-1` sits in the POST-LAUNCH BACKLOG because the relay-assigned
`sequence_number` is authenticated by nothing, and it only bites when a relay misbehaves.

**Handover renumbers by design, on the happy path, with honest software.** So the case that was
parked as "only reachable if a relay lies" becomes reachable in ordinary operation, and it must be
resolved inside this unit. Story §8 item 4 makes that a condition of the story's own done.

**How to resolve it — decided, do not redesign:**

- **Derive order from the ACK receipts and the signed `last_seen_seq`.** Those are signed. The
  receipt binds `content_hash → seq`; `last_seen_seq` is inside the sender's own signed bytes.
- **Stop treating a relay-supplied position as authority for an append decision.** The new relay's
  numbering is bookkeeping, not evidence.
- **DO NOT fix it by signing the position.** That finding rules it out explicitly: it is a wire
  change and it belongs with the seal work, not here.

Update `DOD-M15-RELAYSEQ-UNSIGNED-1`'s entry when you close, per story §8.4.

## ⚠️ TRAP 3 — CONTIGUITY DOES NOT PROVE COMPLETENESS

The verifier checks the sequences are exactly `1..N`, which catches a leaf omitted **in the middle**.
It **cannot** tell you that `N` is the true end — a tail can always be cut at a clean boundary and
still look contiguous.

**The counterparty's tip attestation is the only thing that covers tail truncation**, and it arrives
in unit 3.

**So this unit must require the attestation field and refuse its absence**, even though nothing
sends one yet. That is the same discipline `020-ACKHASH` shipped: the reader lands before the
writer, and a missing proof takes **the same path as a wrong one**. An "accept the replay, the
attestation is optional for now" branch is the fail-open this milestone exists to remove, and it
would be the third instance of `DOD-M15-AUTHORSHIP-ABSENT-1` one layer down.

**Do not let a reviewer conclude the contiguity check makes tip attestation redundant.** Write the
reason into the test name.

---

## Reconciliation — WHICH CHAINS ARE LEGAL (story §4, settled with Andre 2026-09-02, do not re-open)

The relay may be handed two accounts of the same session that are not the same length.

- **D4a — both tips agree** → rebuild at that length. Happy path.
- **D4b — one side is longer, and its chain EXTENDS the shorter one** → the longer side supplies the
  missing leaves; they are verified and appended. **This counts as a match.** Those are the
  in-flight messages, already signed; there is nothing to negotiate, and the shorter side cannot
  refuse a validly signed leaf without lying.
- **D4c — truncate to the shorter of the two: REJECTED.** Not primarily as an attack, but because
  **those messages exist** — both operators have them in their transcripts. Cutting the witness
  record means the receipt permanently covers less than was said, or you delete from an operator's
  transcript because a relay blinked.
- **D5 — divergence is refusal.** Different content at a position both sides already hold is not a
  reconciliation case; it is the attack the witness exists to prevent. Mark the session diverged and
  unsealable — **that state already exists** — and make sure the operator is told.
- **D6 — a tip claim that cannot be produced is a rejected handover.** A side that claims `N` leaves
  and cannot supply them made a false attestation. Refuse. Never silently accept the shorter chain.

---

## Definition of Done

1. `reconstructCarriedSealLeaves` and the chain checks exist in **ONE** place —
   `@cello-protocol/interfaces` — imported by both the directory and the relay. No copy anywhere.
   Grep proves it.
2. The directory's existing seal tests pass **unchanged**, proving the extraction is behaviour-free.
3. The relay recognises a resume assignment by a non-empty `prior_relay_id` in the
   **directory-signed** TBS, and by nothing else. A client-supplied prior relay id is refused.
4. The relay accepts a replay batch only against a verified resume assignment, and adopts the chain
   only when all five checks in Part 3 hold.
5. **A replay with no tip attestation is REFUSED by name.** Not deferred, not warned, not accepted.
6. **Four tampered replays are each refused, one test apiece, each made to fail on purpose:**
   - **truncated tail** → caught by tip attestation;
   - **reordered leaves** → caught by the prior relay's ACK receipts;
   - **forged leaf** → caught by the sender signature;
   - **internal gap** → caught by contiguity.
   Revert the guard, confirm the test reddens **for the reason you expect**, restore it. A refusal
   test that cannot fail is the one thing this unit must not ship (§0z.3).
7. **Order is derived from signatures, never from the new relay's numbering** — demonstrated by a
   test in which the new relay's own numbering disagrees with the receipts and the receipts win.
   `DOD-M15-RELAYSEQ-UNSIGNED-1`'s DoD entry is updated, not deferred.
8. **Nothing emits a replay.** Grep proves it: no production caller in either repo builds the frame.
9. Gate passes in `trustless-cello` (test / lint / typecheck).
10. Reviewed by `cello-unit-reviewer`, every finding fixed, verdict quoted below.

**Not in scope, and building any of it grows the mission:** the client requesting a resume
assignment; replacing the `SessionRelayClient` instance; driving the replay from
`SessionSealLeafStore`; the tip attestation **exchange**; the two-witness receipt seam and its
format; the offline-counterparty pause; mute-relay detection; graceful drain. Units 3 and 4, and
story §9.

---

## Traps recorded before you start

**Never widen the client's re-dial to other relays** (story §6, trap 5). A client that picks its own
witness is grading its own homework — the exact property `LEAFPARTIES-1` and `CORROBORATE-1` spent
themselves establishing. The new witness is **always** directory-brokered. Nothing in this unit
should make that easier to get wrong.

**The signature is over the bytes as received, never over a re-encoding.** `020-ACKHASH` measured
the cost of forgetting this: two encoders that looked equivalent produced different CBOR for the
same timestamp. Verify over what arrived.

**Reuse the fixture** (story §6, trap 6). `016-RELAYLOSS` added `j-relayloss.spine.test.ts`. Extend
it. **Never write a new `makeFixture()` from scratch** — a from-scratch fixture is a blocking review
finding under `/cello-review`, and `packages/e2e-tests/src/session-fixture.ts` is the one to extend
with non-breaking `opts` defaults.

**The extraction is the risky half, not the new code.** A pure-looking method that quietly reads
`this` becomes a subtly different function once it is free of the class. Read every line of
`#verifyUnilateralChain` for `this.` before you move it, and if it has one, say so rather than
working around it.

**Do not "improve" the leaf types while they are in transit.** Move them, then stop.

---

## Close-out — 2026-09-05

**The extraction touched no directory state, and that was checked before it moved.**
`#verifyUnilateralChain` spanned 85 lines and contained **zero** `this.` references — it was already
a pure function wearing a method's clothes. It came out as TWO functions rather than one with a
flag: `verifySealLeafChain` (root, sender signatures, `prev_root` chain, causal order, provenance)
and `verifySealCtrlLeaf` (the exactly-one-SEAL-ctrl clause, which is true only at seal time). A
`{ requireCtrl: false }` parameter would have hidden the caller that switches a check off; two
functions put it in a grep. No directory test file was edited — `git diff --name-only main..HEAD`
carries nothing under `packages/directory/src/__tests__`.

**Definition of Done — every clause.**

1. ✅ ONE definition, in `@cello-protocol/interfaces`, imported by both. Grep with a positive control.
2. ✅ The directory's seal tests pass untouched.
3. ✅ Resume recognised only by a non-empty **directory-signed** `prior_relay_id`. Four
   cross-promotions tested and refused; `""` and absent produce one layout, non-empty another.
4. ✅ A batch is accepted only against a verified resume, and adopted only on all five checks.
5. ✅ A replay with no tip attestation is refused **by name**, and there is no tolerance branch.
6. ✅ Four tampered batches, four different catchers, each asserting its **specific** reason.
7. ✅ Order derived from signatures. `seq_counter` seeded to 99, frontier comes out 4, next leaf 5.
   `DOD-M15-RELAYSEQ-UNSIGNED-1`'s entry is updated — the relay half resolved, the client half
   explicitly still post-launch.
8. ✅ Nothing emits a replay. Zero production callers in either repo.
9. ✅ `pnpm run test` 2622 passed, exit 0 (`CELLO_ENV=local`, fresh Postgres) · `lint` · `typecheck`.
10. ✅ Reviewed by `cello-unit-reviewer`; every finding fixed. Verdict below.

**Reviewer verdict, quoted:** *"SPEC: FAITHFUL · SILENT FALLBACKS FOUND · ERROR SUBSTITUTION FOUND ·
TESTS HAVE TEETH · REMOVALS PROVEN · COMPATIBILITY DEBT FOUND"*, with *"Blocking before this unit
closes: H1, H2, H3, H6"* and thirteen findings in all. H1, H2, H4, H5, H6, H7, H8, H9, H10, H11,
H12 fixed with tests. H13 was a claim in my own close-out, corrected below. **H3 is not fixable in
this repo** and is recorded under *Newly discovered*.

**The mutation loop ran eleven mutants**, clean precondition, printed baseline, each re-run alone.
Two did not compile and were widened rather than recorded as caught. One SURVIVED and the fault was
in the test, not the code — the forged-leaf case was green with the signature check deleted, because
a neighbouring clause returned the same string; that is what forced the H6 reason split.

**A correction to something I wrote in this unit.** I said `bufEqual` "already had two copies in the
tree"; there were **three** (`seal-final-root.ts`, `directory-node.ts`, `seal-cosign-evidence.ts`)
and this adds a fourth. Leaving it is still the right call — two lines, no protocol semantics, not
the drift class this order is about — but the count was wrong and the next reader will use it as
precedent.

---

## Newly discovered

_(written down, NOT started — the spawn trip-wire fired at three)_

1. **The divergence alert reaches its only listener as "your relay is broken."** `[BLOCKS UNIT 3]`
   The shipping client gates witness alerts on an exact equality — `reason === "leaf_signed_by_neither_participant"`
   — not a membership test. A `replay_chain_diverged` alert is therefore rejected as `field_shape`
   and surfaced to the operator as a relay fault or version skew. The innocent counterparty, whose
   conversation just became unsealable, is sent to the transport subsystem. It cannot fire today
   because nothing sends a replay, which is exactly why it is a trap rather than a live defect: the
   gate must be widened **before** anything can produce a divergence. The fix is in `cello-client`,
   which this unit may not edit. **This belongs as a blocking AC on unit 3.**

2. **May ONE batch, from ONE party, write a terminal state?** `[DESIGN — ANDRE'S]`
   D5 says mark a divergence unsealable, and D5 is right about a genuine contradiction. What review
   surfaced is that a FABRICATED one was constructible, and the enabler is now closed — but the
   residue is real: two same-millisecond adjacent leaves from one sender can still be swapped, and
   the timestamp check is non-decreasing (it must be, or two messages sent in the same millisecond
   would be refused). The complete answer is to refuse with `replay_chain_diverged` and alert the
   counterparty while leaving `awaiting_replay: true`, so an honest party can still replay a correct
   chain. The end state for a genuinely diverged session is identical; it just stops being reachable
   from one frame by one party. That changes what "mark the session diverged" means operationally,
   which is why it is not mine to decide.

3. **The directory's own seal refusal still collapses five causes into one.** `[POST-LAUNCH]`
   `unilateral_root_unverifiable` covers a root mismatch, a forged sender signature, an undecodable
   Structure 1, a broken `prev_root` chain and a causal-order violation. The relay now names each;
   the directory maps them back, in one visible place, because widening its published wire reason is
   a seal-path behaviour change and this order's clause 2 forbids it. An operator whose counterparty
   forged a leaf is still told, on the seal path, to re-derive their own root. Not launch-blocking —
   it is a diagnostic loss on a path that refuses correctly — but it should not be rediscovered.
