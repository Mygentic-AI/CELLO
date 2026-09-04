---
name: 014-LEAVES — Is every message in a sealed conversation tied to the two participants?
type: micro-work-order
date: 2026-09-02
status: complete
dod_line: DOD-M15-LEAFPARTIES-1
dod_effect: closes
description: >
  The seal checks that the final two control entries came from two distinct participants. Nobody has
  ever confirmed the same constraint applies to the CONTENT leaves — the actual messages. This is a
  VERIFY-FIRST unit: answer the question with evidence, and only then decide whether there is
  anything to fix. Source: DOD-M15-LEAFPARTIES-1.
---

# **<ins>MICRO</ins>** WORK ORDER 014-LEAVES — Answer the question, then fix only if the answer is bad

> ## THE RULES OF A MICRO WORK ORDER
>
> 1. **Read [[M15-PROCEDURE]] IN FULL before you start.** It is the working discipline for this
>    milestone and it binds you — the gate, the review dispatch, the invariants, how tests are run.
>    **Do not read `M15-DEFINITION-OF-DONE.md` or `M15-BUILD-JOURNAL.md`**; this order carries
>    everything you need from them.
> 2. **MICRO means small.** One mission. Follow it to its end. **Never grow the mission.**
> 3. **Found something else?** Write it under *Newly discovered* at the foot of this file and
>    **keep going**. Do not fix it. Do not investigate it.
> 4. **500 lines, hard cap.** Minimal without omitting anything.
> 5. **Standard procedure still applies:** implement → review (`cello-unit-reviewer`) → fix every
>    finding → commit. Commit per fix, push after every commit. **Closing a unit means flipping
>    this file's `status:` frontmatter to `complete` in the SAME commit as the verdict.**
> 6. **Done is done.** When the Definition of Done below is met, stop.

> ## 🔬 THIS IS A VERIFY-FIRST UNIT, AND THAT IS THE WHOLE POINT
>
> **Do not start by writing a fix.** The question has never been answered, and the honest outcomes
> are three: it is already constrained (close it, with the proof); it is not (fix it); or it is
> constrained by something incidental that would not survive a refactor (pin it with a test).
>
> **A clean "already covered, here is why" is a complete and successful outcome for this unit.** It
> is not a wasted night — it retires a security question that has been open since the T-of-N review
> and is currently carried as unknown.

---

## The question, plainly

A sealed conversation is a list of leaves: the messages, then two control entries that close the
ceremony.

**What is checked today** (read it yourself in `verifySealLeaves`, `packages/directory/src/directory-node.ts`):
the last two control leaves are a ceremony pair from two **distinct participants**, and the ceremony
**closes the log** — nothing may be appended after the second one.

**What has never been confirmed:** whether every **earlier content leaf** — the actual messages — is
independently constrained to that same pair of people, or whether it is merely internally
self-consistent.

**Why it matters, in user terms.** If it is not constrained, a sealed conversation could contain a
message from someone who was not in the conversation, and the receipt would still verify. The
document says "here is what these two people said to each other," and a third voice is inside it.

**Scope discipline, carried from the original finding:** this does not change the bound of the
already-known MITM scenario — in that case the two participants the record shows are simply A and M
throughout. It is a **distinct unresolved question**, not a restatement of a known one. Do not
inflate it into the MITM finding, and do not dismiss it because that finding exists.

---

## The work

**Part 1 — ANSWER IT. This part is not optional and comes first.**

1. Trace what constrains the sender of a **content** leaf, from the leaf's own signed bytes through
   every check that runs before a seal is certified. Both repos.
2. Answer, with evidence rather than inference: **can a leaf signed by a key that is neither
   participant end up under a certified root?**
3. Answer the near-miss version too: **can a leaf signed by ONE of the participants but belonging to
   a DIFFERENT session end up there?** A cross-session graft is the same class of defect and is
   easier to reach.
4. **Write the answer down in the Review section either way**, with the call sites. State plainly
   what you could not establish from code alone.

**Part 2 — only if Part 1 says it is not constrained.**

5. Constrain it, at the point the seal is certified, using the participant pair the session
   assignment already names. Reuse the existing check rather than writing a second one.
6. A leaf outside the pair means the seal is **refused**, with a named reason that reaches the
   operator — not a warning beside a certified receipt.

**Part 3 — regardless of the answer.**

7. **Pin it with a test.** If it is already constrained, the test asserts that a foreign-signed leaf
   is refused, so a later refactor cannot quietly remove the constraint. **A property nothing
   asserts is a property you will lose.** If the constraint turns out to be incidental — a side
   effect of some other check rather than a deliberate one — say so explicitly, because incidental
   protections are the ones refactors delete.

---

## Definition of Done

1. The question is **answered with evidence**, and the answer is written in the Review section with
   its call sites: is every content leaf constrained to the session's two participants?
2. The cross-session variant is answered too.
3. What could not be established from code alone is stated, not glossed.
4. **If unconstrained:** a leaf outside the participant pair causes the seal to be refused, with a
   named reason that reaches the operator.
5. **A test pins the property either way**, and it has been made to fail on purpose — revert the
   constraint (or, if it was already there, remove it) and confirm the test reddens for the expected
   reason.
6. If the protection turns out to be incidental rather than deliberate, that is stated in the Review
   section in those words.
7. Gate passes (test / lint / typecheck) in every repo touched.
8. Reviewed by `cello-unit-reviewer`, every finding fixed, verdict quoted below.

**Not in scope:** the bilateral approval path (`012-SEAL`); the solo-seal trigger (`013-ABSENCE`);
the relay's live checking (`015-WITNESS`); the MITM finding, which is already bounded and recorded.

---

## Traps recorded before you start

- **Do not report a grep as an answer.** "I searched and found no check" is a hypothesis. Trace the
  call path, or construct the leaf and watch what happens.
- **Do not weaken an existing assertion to make a new test pass.**
- **`verifySealLeaves` is narrower than its name suggests.** It validates the ceremony pair and that
  the ceremony closes the log. Do not read it as a general leaf validator; that assumption is
  probably how this question stayed open.
- **If the answer is "already safe", resist adding a fix anyway.** Adding a redundant check to feel
  productive gives two places to keep correct. The test is the deliverable in that case.

---

## Review

### The answer to Part 1: NO. It was not constrained — and what protected it was incidental.

**Where the constraint actually lived.** A content leaf's sender was constrained in exactly one
place in the whole system: the relay refuses a `hash_submit` whose authenticated sender is neither
`participant_a` nor `participant_b` — `#processHashSubmitLocked` in `packages/relay/src/relay-node.ts`,
reason `not_a_participant`. That is a live-path check at submit time.

> ⚠️ Cited by FUNCTION and REASON, not by line. `015-WITNESS` landed in this file while this unit was
> blocked on the shared test slot and moved that gate from 1854 to 1908, adding a signature-based
> witness check above it. A line number in a shared checkout is stale by the time it is read.

**Nothing re-checked it at certification.** Walking the seal path in order:

1. `processSeal`'s per-leaf loop (`packages/directory/src/directory-node.ts:5255-5305`) verifies
   `verify(s2.sender_pubkey, structure1_cbor, s2.sender_signature)`. That is **self-consistency**:
   the leaf names a key and the signature holds under that key. It says nothing about whether the
   key is in the conversation.
2. `verifySealLeaves` (`directory-node.ts:6507`) examines only the closing ceremony pair and that
   the ceremony closes the log. The trap in this order was right — its name is wider than its job.
3. `verifySealFinalRoots` (`packages/directory/src/seal-final-root.ts`) had a
   `SENDER_NOT_PARTICIPANT` check, and it sat behind `if (leaf.kind !== "ctrl") continue` **and**
   behind `if (bytes === undefined) continue`. So it could never see a message leaf, and it did not
   run at all when nothing was carried.

**The thing that did catch an injected content leaf was arithmetic, not identity — and the
protection was INCIDENTAL rather than deliberate.** An extra content leaf changes
`rootOverNonCtrlLeaves`, so a participant's carried `final_root` stops matching and the verdict is
`ROOT_DISAGREES`. Nobody wrote that to constrain leaf authorship; it falls out of the root
comparison. Stating it in the words the order asks for: **this protection is incidental, and
incidental protections are the ones refactors delete.**

**And the attacker held its off-switch.** `content_bytes` is supplied by whoever assembles the leaf
array. Omit it and the verdict is `NOT_CARRIED`, which `directory-node.ts:5425-5449` deliberately
tolerates during the rollout — correctly, and with its own follow-on already named. So the party
that injects the leaf is the same party that can turn off the only thing that would have noticed.
That is the *who controls the absence* shape, reached from a second direction.

**Who the adversary is, precisely.** Not only a rogue relay. `seal_submission` arrives on the
directory-relay admin stream (`directory-node.ts:1200-1235`), which authenticates only
`relay_register` — `validateSealSubmissionLeaves`' own header says the frame is *"accepted from any
dialer"*. A stranger who knows a session id can hand a directory a leaf array.

### The cross-session variant: also unconstrained, at BOTH layers.

Structure 1's signed TBS is `[protocol_version, content_hash, sender_pubkey, session_id,
last_seen_seq, timestamp]` — **the sender's own Ed25519 signature already says which conversation
the leaf was produced for.** The check was available for free and nobody made it:

- **Relay:** `#processHashSubmitLocked` decodes Structure 1 and checks `s1.sender_pubkey` against
  the authenticated peer (`relay-node.ts:1948`) — and never compares `s1.session_id` to
  `frame.session_id`.
- **Directory:** `decodeStructure1Fields` (`directory-node.ts:6397`) decodes `session_id`,
  length-validates it to 16 bytes, and **returns it to two loops that use only `content_hash` and
  `last_seen_seq`.** The field was read and dropped.

`prev_root` and `sequence_number` live in Structure 2, which the assembler builds, so the chain and
causal checks cannot catch a graft either.

### What could not be established from code alone

- **Whether any live deployment has ever received a foreign leaf.** That needs the directories' logs,
  not the source. Nothing in the tree records the sender set of a certified seal in a queryable form.
- **Whether an honest client would notice after the fact.** Each side compares the certified root
  against its own tree, so a graft should surface there — but that is the *client's* reaction to an
  already-signed certificate, and I did not exercise it. The certificate is issued either way.
- **The relay's own `s1.session_id` gap on the live path.** I traced that it is unchecked; I did not
  establish what an honest counterparty's daemon does with a delivered leaf whose signed session id
  is not the session it arrived on.

### The fix

`verifyLeafProvenance(leaves, sessionId, participants?)` in `seal-final-root.ts` checks two facts for
**every** leaf: the sender is one of the session's two participants, and the leaf's own signed bytes
name the session being sealed. It is the existing check widened, not a second one — the ctrl-only
copy inside the payload loop is gone.

- **Bilateral:** called first in `verifySealFinalRoots`, ahead of the carried-payload walk, so the
  assembler cannot disable it by sending less.
- **Unilateral:** called in `#verifyUnilateralChain` **after** the per-leaf signature loop. The
  position is the precondition: until the signatures verify, `sender_pubkey` is a field the assembler
  filled in, and asking whether it is a participant asks the assembler about itself.

The refusal reaches the operator by three surfaces: the returned reason (`seal_sender_not_participant`
/ `seal_leaf_session_mismatch`) travels to the relay, is stored as `seal_rejected_reason`, and comes
back to the client on its next submit as `hash_submit_error{reason:"seal_refused", detail:<reason>}`;
`session_seal_rejected` goes to the participants' streams; and `seal.final_root.refused` logs at
error with the guidance string. The participants' frame now says `seal_leaves_invalid` rather than
`merkle_root_mismatch` — telling two people their roots disagree, when the finding was a stranger's
leaf, sends them to compare transcripts over an injection.

### The bound, stated rather than claimed away

When the adjudicating node did not assign the session, `#sessionParticipants` is empty and the roster
falls back to the keys derived from the array under suspicion. There the **addition** of a third
voice is still refused — three distinct keys do not fit in a pair of two — but a **substitution** is
not. That is pre-existing and tracked as `DOD-M15-SEALROSTER-FEDERATED-1`. The session half holds on
that path regardless: it is anchored to a signature the assembler cannot forge.

### The test, and being made to fail on purpose

`packages/directory/src/__tests__/dod-m15-leafparties-1.test.ts` — 8 tests through the **real**
`processSeal` and the **real** unilateral handler, with **no SEAL payload carried anywhere**, which is
the shape that certified.

Two mutants, in an isolated worktree on a clean tree, each typechecked before running and each re-run
alone:

| Mutant | Result |
|---|---|
| Discard the bilateral verdict in `verifySealFinalRoots` | the 4 bilateral refusal tests red — all `expected true to be false` on `result.ok`, i.e. **the seal certified**. Honest case green. **All 3 unilateral tests green.** |
| Discard the unilateral verdict in `#verifyUnilateralChain` | the 2 unilateral refusal tests red — `expected [] to have a length of 1`, i.e. **no verification failure was logged at all**. **All 5 bilateral tests green.** |

Neither mutant's red came from the other's path, so the two call sites are independently covered.

### What the review changed, after the first pass

Five findings, all fixed, and one of them was a live security hole this unit had walked past:

- **A stranger could unilaterally seal a session they were not in.** `#processSealUnilateral` never
  checked that the SUBMITTER is a participant. S sends `seal_unilateral` for A↔B's session carrying
  `[S msg, S ctrl]`; `absentPartyHex` resolves to A by its else-branch; every signature is S's own and
  real; one ctrl leaf, from the submitter; root matches. **Proven, not argued:** with the fix reverted,
  `session.unilateral.notarized` fires — the directory signs a receipt over A and B's session naming S.
  Now `unilateral_not_a_participant`, which names the caller rather than blaming a leaf a layer down.
- **The test seam was hiding it.** `triggerSealUnilateralWithLeavesForTest` overwrote
  `#sessionParticipants` with the submitter as initiator, so the only case that matters was
  unconstructible and the missing guard unnoticeable. The seam is non-destructive now.
- **The degraded-roster refusal accused an innocent participant.** Falling back to the first two
  distinct senders of the suspect array puts the intruder *inside* the roster: on `[A, S, A, B]` the
  pair is `[A, S]` and the refusal named **B**. Right verdict, false accusation. The module is handed
  `null` now and says only what it can know — the signer count, and that naming the intruder is not
  possible from here.
- **The participants' own frame was untested** and survived reverting.
- **The roster parameter was optional and unbounded**; now required and typed as a pair.

### Clause 7, stated rather than glossed: the spine seal journeys could NOT exercise this

`j-spine` and `j-unilateral` were run against the real binaries. **Neither reaches the seal.** Both
fail earlier, at relay authentication — `relay.auth.online_token.missing` ×14–18,
`session.relay.auth.failed` ×8, `relay.reservation.denied` ×6, then a standing receiver with no
reservation. That is the online-token path (`DOD-M15-RELAYSLOTS-1` / `DOD-M15-RELAYAUTH-1`), in the
relay and the client; this diff touches neither, and the failure happens before any leaf is submitted.
**Zero of this unit's new refusal reasons appear in either run**, which is the honest measure of what
those runs proved about it: nothing.

So the property is verified against **hand-built Structure 1 bytes, not bytes a real client signed.**
I tried to establish a clean before/after baseline and failed: the baseline worktree run had no reach
(it could not resolve the client binaries, whose path is relative to the real checkout), so it is not
offered as evidence. **This is the one thing about this unit that a live run has not seen.**

### Gate

`packages/directory` 1168 passed / exit 0 · `pnpm run lint` exit 0 · `pnpm run typecheck`
(`tsc --build`, emits) exit 0.

The ROOT suite has 4 failures, none in this diff and each traced rather than assumed: three
`relay-node` assertions broken by `015-WITNESS`'s new reason code (`git log -S` → commit `3680d6b0`),
and the hidden-lane count guard moving 37→39 because that unit added `j-witness.spine.test.ts` and
`j-ciphertext.spine.test.ts` is untracked. Four further suites fail to collect on a
`@claude-flow/testing` resolution drift in the shared checkout. This unit's two commits touch three
files, all under `packages/directory`, and no manifest.

### Mutation record — five mutants, each typechecked, each re-run alone

| Mutant | Result |
|---|---|
| bilateral provenance verdict discarded | 4 bilateral refusals red (`ok` was **true** — certified); 3 unilateral **green** |
| unilateral provenance verdict discarded | 2 unilateral refusals red (no failure logged at all); 5 bilateral **green** |
| submitter guard deleted | the stranger test red — refused, but with the wrong-layer reason |
| submitter guard **and** roster reverted | **`session.unilateral.notarized` fires** — the hole, demonstrated |
| degraded roster guesses `[pA, pB]` again | detail red, and it named `leaf 3 (ctrl, sender 64d6…)` — participant B |

No mutant's red came from another's path.

### Reviewer verdict

> **SPEC: DEVIATIONS FOUND** … **ERROR SUBSTITUTION FOUND** — H2 … the refusal names a participant as
> the intruder. The reason code is truthful; the sentence the operator reads is not. **HOLLOW TESTS
> FOUND** — H1 (the roster fix is unreddenable and the seam prevents a test), H4 (the participant-facing
> reason survives revert) … **REMOVALS PROVEN** … **NO COMPATIBILITY DEBT**
>
> *"Not rubber-stamping: this diff touches crypto provenance and I found four things worth fixing, one
> of which (H1) is a security fix currently protected by nothing but the author's attention."*

All five findings fixed and each pinned by a mutant above. The deviations were the write-up clauses
(1/2/3/6) — the answer existed only in code comments when the reviewer read the tree; it is in this
section now, including the word *incidental* the DoD asks for literally.

---

## Newly discovered

*(One or two lines each. Do not act on them.)*

- **The relay never compares a leaf's SIGNED `session_id` to the session it is being submitted to.**
  `#processHashSubmitLocked` checks `s1.sender_pubkey` against the authenticated peer and stops there,
  so a participant can submit a leaf signed for another conversation and the relay witnesses it live.
  The directory now refuses to certify such a seal, so the consequence is a conversation that cannot
  seal rather than a false receipt — but the relay's own witness record is polluted.
- **`s1.sender_pubkey` and `s2.sender_pubkey` are never compared at the directory.** Harmless today
  (the signature must verify under `s2`'s copy, so the real author is `s2`'s), but the signed field is
  read and dropped, which is the shape that produced this unit's defect.
- **Every refusal on the unilateral seal path logs and returns with no frame to the client.** Not
  introduced here — it is true of every reason on that path, including the pre-existing ones. The
  client waits for `seal_unilateral_confirmed` or `seal_unilateral_too_early` and gets neither, so the
  operator experiences a timeout that reads as the network. This diff adds two more reasons to that
  silent set.
- **A cross-session leaf now makes a conversation permanently unsealable.** The directory refuses what
  the relay still accepts, and the relay's `leaf_log` is append-only — so one such submit destroys that
  conversation's receipt for good. Refusing is still the right trade, but the check belongs at the
  point of injection too: refuse one submit loudly rather than the whole conversation silently, later.
  Relay work, and `015-WITNESS` is already in that file.
- **The live spine seal journeys are red on `main`** at relay authentication, before any seal —
  `relay.auth.online_token.missing` → `relay.reservation.denied`. Nothing in this unit touches it.
