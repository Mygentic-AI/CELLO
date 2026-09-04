---
name: 029-AUTHORSHIP — No passport, no entry
type: micro-work-order
date: 2026-09-04
status: open
dod_line: DOD-M15-AUTHORSHIP-ABSENT-1
dod_effect: closes
description: >
  A message whose authorship proof is PRESENT AND WRONG freezes the session. A message with NO proof
  is ingested and delivered, unchecked. The reason is that the sender's signature is only ever
  delivered inside the RELAY's structure, so refusing on its absence would make the relay a
  precondition for reading mail. Split them — carry the sender's signature on the content frame
  beside its own signed bytes, mandatory; leave the relay's sequence soft.
  CLOSES DOD-M15-AUTHORSHIP-ABSENT-1.
---

# **<ins>MICRO</ins>** WORK ORDER 029-AUTHORSHIP — No passport, no entry

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

---

## The rule this exists to enforce

**Andre, 2026-09-03**, on being shown it:

> *"I show up with my passport and the photo doesn't match, I'm blocked. But if I arrive at
> immigration with no passport, they let me through."*

**Ruled BLOCKS the same day.** It undoes the guarantee the product is sold on: not that a stranger
gets in — the sender is still the authenticated peer on the session — but that **you can prove who
wrote each line of the transcript.** Today you can prove it for most lines, and "most" is not what a
receipt is for.

---

## What is true today — read in code 2026-09-04, do not re-derive

**`session-node-manager.ts`, the inbound content frame.** The frame carries `structure1_cbor` (the
sender's own signed bytes) and `structure2_cbor` (the relay's committed record). The branch:

```ts
if (s1Cbor instanceof Uint8Array && s2Cbor instanceof Uint8Array) {
  const ordering = this.#recordFrameOrdering(...);
  if (ordering.fatal) { await this.#freezeOnIdentityFailure(...); return; }   // present and wrong
  ...
} else {
  this.#logger.info("session.content.ordering.absent", { ... });              // absent → carry on
}
```

**Both structures, or neither.** `else` fires when either is missing, and the message is ingested
with no check on who wrote it. The code says so itself, in a comment the next reader will find:

> *"the per-message signer check is **opt-in for the sender** — a party that passed the peer gate and
> wants to avoid the comparison simply omits the proof."*

### Why it was built this way, and where the reasoning stops

**The sender's signature is only ever DELIVERED inside the relay's structure.** In
`#recordFrameOrdering` the signature is read as `s2[3]` — index 3 of **Structure 2**, which the relay
produces. So a receiver cannot check authorship without a relay record, and refusing on its absence
would make the relay a precondition for reading your mail. **That reasoning is sound.**

**It stops one field short, and the send path proves it.** In `session-relay-client.ts` ~1747 the
sender does this, locally, with no relay involved:

```ts
const structure1 = encodeStructure1({ contentHash, senderPubkey, sessionId, lastSeenSeq, timestamp });
const signature  = await this.#keyProvider.sign(structure1);
const frame = encodeCbor({ type: "hash_submit", structure1_cbor: structure1, sender_signature: signature, ... });
```

**The `hash_submit` frame already carries `structure1_cbor` and `sender_signature` as two separate
top-level fields.** The signature has never needed the relay. What ties them together is that
`encodeStructure1` + `sign` run **inside the submit**, so on the relay-degraded path — where no
submit happens — the sender simply never builds them, and `SubmitResult.sender_signature` is
documented as *"undefined on the relay-degraded path, where no submit happens and there is nothing to
sign."* **There is something to sign. Nobody signs it.**

### The chain, both directions

- **Producer (send):** `session-relay-client.ts` builds + signs Structure 1 **only as a by-product of
  the relay submit**. `session-node-manager.ts` ~8625 stamps `orderingS1` / `orderingS2` onto the
  content frame — both `undefined` when there was no submit. **The content frame has no
  `sender_signature` field at all.**
- **Consumer (receive):** `#recordFrameOrdering` (~15048) reads the signature out of Structure 2,
  verifies it against the pubkey inside Structure 1, then matches that signer to the session's
  counterparty. Both failures are already FATAL and correct. It never runs when Structure 2 is absent.

---

## Part 1 — Carry the signature on the content frame

**Mirror the shape the submit frame already uses.** Not a new pattern — the same pairing, one frame
along.

- **Send:** build and sign Structure 1 on **every** outbound content frame, including when the relay
  submit did not happen. Stamp `sender_signature` onto the content frame beside `structure1_cbor`.
- **Receive:** verify authorship from `structure1_cbor` + `sender_signature` **alone** — signature
  valid, and signer matches this session's counterparty. Keep both existing FATAL verdicts exactly as
  they are.
- **Sequence stays soft and stays where it is.** `structure2_cbor` still supplies the position when
  present, and its absence still falls back to the witness stream. **Do not make position mandatory.**

## Part 2 — Absence becomes a refusal

An inbound content frame with no usable authorship proof is **refused by name**, not ingested.

- Refuse **by name**, with an affordance (Invariant 4). The operator must learn a message was turned
  away and why — this is the `NO-SILENT-REFUSAL-1` rule, already shipped, and a new silent refusal
  would walk straight back into it.
- **Keep `session.content.ordering.absent` meaning what it says.** After this unit the only thing
  that can be absent is the *sequence*, so the event is about position, not identity. Rewrite its
  comment; do not delete it.
- **Do NOT freeze the session on absence.** Freezing is for a proof that FAILED — a positive
  identity fault. An absent proof is a refusal of that message. Conflating them turns a version skew
  into an incident.

---

## Part 3 — Deployment. Read before you write code.

**This is a wire change, and the question "who upgrades first" has bitten this milestone twice.**

**Ruling for this unit: emit and enforce together, in one unit.** The reasoning, so it is not
re-opened:

- **There is no population to strand.** `NOTCARRIED-REFUSE-1`'s precedent, in this milestone:
  *"nothing is registered against a client that predates the carry, so the older shape was deleted
  rather than supported alongside the new one."* Same here.
- **The failure mode if two machines upgrade out of step is VISIBLE, not silent** — an un-upgraded
  sender's message is refused **by name**, at the receiver, loudly. That is the exact opposite of
  `020-ACKHASH`, whose split into two units was forced because *its* skew cost silent message loss.
  A visible refusal is safe to ship in one piece; silence is not. **Do not cite 020 as a reason to
  split this one — read why 020 split.**
- **Both of Andre's agents must be on the new build.** They are on different machines (laptop and the
  Hermes EC2 box). Say so in the Review section; it is a cascade note, not a phase.

---

## Part 4 — Three ways to get this wrong, ruled out in writing

**Wrong fix 1 — "make Structure 2 mandatory."** That is the fix the original reasoning correctly
refuses: it makes the relay a precondition for reading your mail, so an honest peer on a degraded
path is silenced. The whole point is that the two facts separate.

**Wrong fix 2 — "move the signature into Structure 1."** Structure 1 is the bytes being SIGNED. A
signature cannot be inside its own signed payload, and Structure 1's field order is signed over —
touching it is a v3 of a structure that just went to v2. The signature goes **beside** it on the
frame, exactly as `hash_submit` already does.

**Wrong fix 3 — "verify only when the field happens to be there."** That is today's defect with a
new field name. Absence must take a hard-fail path, or the check stays opt-in for the sender.

---

## Definition of Done

1. **Every outbound content frame carries `sender_signature` over its `structure1_cbor`**, including
   on the relay-degraded path where no submit happened.
2. **The receiver verifies authorship from `structure1_cbor` + `sender_signature` alone**, with no
   dependence on `structure2_cbor`. Both existing FATAL verdicts (bad signature; signer is not the
   counterparty) still fire, unchanged.
3. **A frame with no usable authorship proof is REFUSED BY NAME and not ingested** — and the operator
   is told, through the refusal surface `NO-SILENT-REFUSAL-1` already built. It does **not** freeze
   the session.
4. **Position is still soft.** A frame with a valid signature and no `structure2_cbor` is **accepted**
   and falls back to the witness stream for its position. Prove this case explicitly — it is the one
   the original design was protecting and the one a careless fix breaks.
5. **The comment that states the defect is rewritten, not deleted** (*"the per-message signer check is
   opt-in for the sender…"*). It is the sentence a reader with a coding agent finds; it must now
   describe what the code does.
6. **Each new assertion has been made to fail on purpose** and confirmed to fail for the reason
   expected. **Commit before the mutation loop exists.** The load-bearing mutant: delete the
   absent-proof refusal and the suite must go red.
7. **Enforcer — unit:** a message arriving with no authorship proof is refused by name, with a test
   that reddens when the refusal is removed. Plus DoD 4's accept-without-position case.
8. Gate passes in cello-client. State whether anything publishes — it does (client cascade; no
   directory/relay roll), and note that both of Andre's agents must take it.
9. Reviewed by `cello-unit-reviewer`, every finding fixed, verdict quoted below.
10. `DOD-M15-AUTHORSHIP-ABSENT-1` flipped to ✅ in `M15-DEFINITION-OF-DONE.md` **in the same commit
    as the verdict**, and `python3 docs/planning/user-stories/m15/tools/dod-order-sync.py` exits 0.

**Not in scope:**
- **`WITHHOLD-SEAL-1`** — the counterparty who never submits a hash at all, so the relay's account
  honestly ends one short. Different line, different unit, and it composes with this one; do not
  reach for it.
- **`RELAYSEQ-UNSIGNED-1`** — that the relay-assigned position is unauthenticated. POST-LAUNCH. This
  unit deliberately leaves position soft and unsigned.
- **Signing the sequence, or any change to `Structure1`'s field order.** `020-ACKHASH` just took it
  to v2 and the emitter unit is still owed. Stay off it.
- **The park path.** `#recordFrameOrdering` has a second caller with `source: "park"`
  (~12852). Check what it passes and make sure this change does not break parked recovery — but do
  **not** extend the mandatory-signature rule to the park envelope in this unit. If the park path
  cannot supply the field, record it under *Newly discovered* and leave the park branch as it is.

---

## Traps recorded before you start

**`#recordFrameOrdering` HAS TWO CALLERS.** The content frame (~15523) and the park path (~12852,
`source: "park"`). Read both before changing its signature or its return type. A change that assumes
one caller is how this file has broken before.

**`session-node-manager.ts` IS YOURS OUTRIGHT for this unit.** It has one owner by standing
agreement, because two lanes editing it once produced a commit that does not typecheck on its own —
`submitLeaf` took four parameters at that commit and a call site passed five, and `git bisect` across
that range still will not build. Two other lanes are running (`027` in `core/gateway/src`, `028` in
`core/daemon/src/content-park*.ts`); neither touches this file. **Do not stray into theirs.**

**A plain object is not an `Error`.** The transport throws `{ reason, peerId, message }` literals.
`instanceof Error` is false and `String(err)` gives `"[object Object]"` — the defect `019` fixed.
`extractErrorMessage` is the tool.

**Refuse ≠ freeze.** DoD 3 is a refusal of one message. `#freezeOnIdentityFailure` is for a proof that
failed. Getting this backwards turns every un-upgraded peer into an incident.

**Do not cite `020-ACKHASH` as a reason to split this into two units** without reading Part 3. 020
split because its skew cost SILENT MESSAGE LOSS. This one's skew costs a named refusal.

**ANOTHER LANE MAY BE RUNNING.** If you bring up Postgres, export a `COMPOSE_PROJECT_NAME` unique to
your worktree **as well as** a unique `CELLO_PG_HOST_PORT` — the port alone does not isolate you,
because both worktree directories are named `trustless-cello` and compose derives the same project
name (measured, `019` *Newly discovered* #1).

**Work in a PAIRED worktree** — `<lane>/cello-client` and `<lane>/trustless-cello` as siblings, and
load `/worktree-permissions` before creating one.

---

## Review

### Where this work lives
*(worktree paths, branch, and the `COMPOSE_PROJECT_NAME` / `CELLO_PG_HOST_PORT` you used)*

### The rest
*(the refusal proof from DoD 3, the accept-without-position proof from DoD 4, the mutation proof,
the cascade note from DoD 8, the reviewer's verdict)*

## Newly discovered

*(anything found and NOT acted on, per rule 3 — e.g. what the park path passes)*
