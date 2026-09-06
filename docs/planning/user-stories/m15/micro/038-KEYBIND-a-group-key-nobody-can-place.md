---
name: 038-KEYBIND — A group key nobody can place
type: micro-work-order
date: 2026-09-06
status: complete
dod_line: DOD-M15-KEYBIND-1
dod_effect: closes
description: >
  An agent has two keypairs — K_local (the published 64-hex) and the FROST group keypair from its
  DKG. The session assignment is signed by the CALLER's group key and carries that key in
  signer_pubkey. Nothing binds the two, so on first contact the responder verifies the signature
  against a key the same document supplied, then writes it down as the counterparty's identity
  forever. Have K_local sign the binding at the tail of registration, carry it, and check it.
  CLOSES DOD-M15-KEYBIND-1.
---

# **<ins>MICRO</ins>** WORK ORDER 038-KEYBIND — A group key nobody can place

> ## THE RULES OF A MICRO WORK ORDER
>
> 1. **Read [[M15-PROCEDURE]] IN FULL before you start.** It binds you — the gate, the review
>    dispatch, the invariants, how tests are run. **Do not read `M15-DEFINITION-OF-DONE.md` or
>    `M15-BUILD-JOURNAL.md`**; this order carries everything you need from them.
> 2. **MICRO means small.** One mission. Follow it to its end. **Never grow the mission.**
> 3. **Found something else?** Write it under *Newly discovered* at the foot of this file and
>    **keep going**. Do not fix it. Do not investigate it.
> 4. **500 lines, hard cap.**
> 5. **No backward compatibility.** The directories are wiped before launch and there are no users.
>    An absent binding is a REFUSAL, never a tolerated legacy shape. Do not write a compat branch.
> 5a. **⛔ DO NOT EDIT `session-node-manager.ts`.** Order 037 is restructuring it in a live worktree.
>    Nothing this order needs is in there — the pin lives in `session-queries.ts`, and the manager
>    holds only delegating one-liners. If you believe you need to touch that file, **stop and say
>    so**; you have almost certainly found a different problem than the one this order describes.
> 6. **Standard procedure still applies:** implement → review (`cello-unit-reviewer`) → fix every
>    finding → commit. Commit per fix, push after every commit. **Closing a unit means flipping this
>    file's `status:` frontmatter to `complete` in the SAME commit as the verdict.**
> 7. **Done is done.** When the Definition of Done below is met, stop.

---

## The rule this exists to enforce

**Andre, 2026-09-06**, arriving at it himself after an hour of pushing back on the audit:

> *"We can definitely say that this session is intended for these two identities, because we have
> local A and B. But we really can't prove that local A was the one who did the frost ceremony.
> Because we don't have anything to check against group key G."*

---

## What is true today — read in code 2026-09-06, do not re-derive

**An agent holds two keypairs.** They are created at different times, by different mechanisms, and
only one of them is published.

| | `K_local` | The group keypair |
|---|---|---|
| Minted | locally, **before** registration (`db-identity-store.ts`, lifecycle `created`) | by the DKG, jointly |
| Private half | a seed, yours alone | **never exists** — only shares (`frost_signing_share`) |
| Public half | the **64-hex identity** operators paste around | `frost_primary_pubkey`, identical for all participants |
| Job | asserts who you are | what threshold signatures verify under |

A FROST DKG cannot produce `K_local` as its group key — the group key is the sum of every
participant's commitment, so by construction it is nobody's existing key. **The two-key structure is
inherent, not a design slip.** What is missing is the link between them.

### The circularity, in the code

`verifyInboundAssignment` (`assignment-verify.ts` ~183-241) takes `expectedSignerHex`. On first
contact there is no pin, so it is `null`, and:

```ts
const verifyAgainst = expectedSignerHex !== null ? Buffer.from(expectedSignerHex, "hex") : signer;
```

`signer` is `assignment.signer_pubkey` — a field of the very document being verified. The signature
therefore always verifies. Its `mode: "internal"` return is honest about this; the function's own
header comment states the bound. **It catches a tampered frame. It establishes nothing about who
signed.**

`inbound-sessions.ts` ~956 then calls `recordCounterpartyPrimary`, writing that signer into
`sessions.counterparty_primary_pubkey`. `getPinnedCounterpartyPrimary` reads it back for every later
session, keyed on the counterparty's K_local. **A wrong first contact is a wrong pin, and every
session after it verifies beautifully.**

> ⚠️ **Both live in `session-queries.ts` (~407 and ~1060), NOT in `session-node-manager.ts`** — order
> 037 already extracted them, and the manager keeps only one-line delegating wrappers. **This order
> therefore has no business editing `session-node-manager.ts` at all**, which is what makes it safe
> to run alongside 037. See the rules above.

### Why the initiator is fine and the receiver is not

Calling out: the assignment must be signed by **your own** group key, which you hold locally from
your own DKG (`assignment_signer_not_this_agent`). You can check it.

Receiving a cold call: you hold no copy of theirs. There is nothing to compare against. **The gap is
one-directional.**

### The same gap, other direction — closed by the same field

`session-ceremony.ts` ~851 records it: the responder learns the initiator's group key from the
assignment, but **the initiator never learns the responder's**. So when the responder closes first,
the initiator cannot verify the seal certificate and accepts it `verified:false` /
`signer_key_not_held`. Filed there as F2-b. **One binding closes both directions. Doing them
separately is two wire changes instead of one.**

---

## Part 1 — Mint the binding at the tail of registration

`K_local` signs a statement naming the group key. It can only happen here: at agent creation `G`
does not exist yet, and this is the one moment both keys are on the machine together.

- Domain-separated context — a new constant beside the existing FROST contexts, not a reused one.
- The signed bytes bind **the K_local public key and the group public key together**. Signing `G`
  alone lets a valid binding be lifted onto another identity.
- Produced once, persisted locally beside the share, and uploaded with the registration.
- **No re-DKG, ever.** An agent that already exists holds both keys and can produce this on demand.
  Key refresh preserves the group key (`session-ceremony.ts` ~452 aborts if the primary changes), so
  it is signed once for the life of the agent.

## Part 2 — Carry it

- **Directory:** a column on the agent profile, a migration, and the value returned wherever an
  agent's identity is served.
- **Wire:** a field on the session assignment (`protocol-types`), carried in both directions so the
  initiator learns the responder's group key too — that is the F2-b half.
- The carrier is **untrusted by construction**: the binding is a signature by a key no directory
  holds, so a hostile directory can neither forge it nor swap it. It can only withhold it, which
  Part 3 turns into a refusal.

## Part 3 — Check it, and refuse without it

In `verifyInboundAssignment`, **before** the signature check:

1. Verify the binding against `participant_a.pubkey` — the counterparty's K_local, which is on the
   assignment and is the value the operator was given out of band.
2. Only then verify the assignment signature under the bound group key.
3. **Absent binding → REFUSE by name.** Failed binding → REFUSE by name, distinctly.

`expectedSignerHex = null` must stop meaning "verify against yourself". The pin becomes a
consistency check over time rather than the sole authority on first contact.

## Part 4 — Three ways to get this wrong, ruled out in writing

1. **Signing `G` alone.** A binding that does not name the K_local it belongs to can be replayed
   under a different identity. Bind both.
2. **Letting a directory sign the binding instead.** That converts "unverifiable" into "a directory
   says so" and one dishonest directory still gets through. The whole value is that the signer is a
   key **no directory holds**. A directory signature on the assignment is worth adding separately as
   defence in depth; it is **not** this line and must not be substituted for it.
3. **Tolerating an absent binding.** That is fail-open, and it reproduces exactly the state this
   order exists to end. Rule 5 above.

---

## Definition of Done

1. `K_local` signs a binding over `(K_local pubkey, group pubkey)` under a new domain-separated
   context, at the tail of registration, persisted locally.
2. The directory stores it and serves it; the migration is written.
3. The assignment carries it, **in both directions**, so each party learns the other's group key.
4. `verifyInboundAssignment` verifies the binding against `participant_a.pubkey` before verifying
   the assignment signature.
5. An **absent** binding refuses with its own named reason and guidance. A **failed** binding
   refuses with a different named reason.
6. First contact no longer verifies a signature against a key the same frame supplied — there is no
   surviving path where `verifyAgainst` comes from the document under verification.
7. The initiator records the responder's group key, and a responder-first seal verifies locally
   instead of returning `signer_key_not_held`.
8. Tests: a first-contact assignment with a **forged** group key is refused; with a **missing**
   binding is refused; with a valid binding is accepted; and a responder-first seal verifies.
9. Gate green (`pnpm run test`, `lint`, `typecheck`), reviewer verdict quoted, version cascade
   published per `/cello-publish`.

---

## Explicitly out of scope

- Adding a directory signature to the assignment (defence in depth, separate line — see Part 4.2).
- `DOD-M15-ASSIGN-TARGET-1` (comparing the assignment's counterparty to the one the operator typed)
  and `DOD-M15-CEREMONY-BLIND-1`. Adjacent, both client-side only, neither blocked by this.
- Any change to the threshold, the DKG itself, or key refresh.

---

## Newly discovered

*(append here; do not fix)*

### The nullable apparatus on the directory side outlives its reason at the wipe — POST-LAUNCH

**Found by the unit review, recorded so the debt has an owner rather than living as six quiet
branches nobody exercises.**

`decodeInboundSignalingFrame` REJECTS a `dkg_complete` with no `key_binding`, so after the
pre-launch wipe **no profile row that can exist has a NULL there**. Nothing can produce one. Yet
these are all live and must be maintained:

- `agent_profiles.key_binding` is nullable with no backfill (V65)
- two `...(row.key_binding ? … : {})` reads and two `?? null` writes in `pg-directory-store.ts`
- the three conditional emits in `encodeSessionAssignment`
- the `session.key_binding.unavailable` block in `#processSessionRequest`, plus the two
  `getProfileWithReadThrough` round-trips it adds
- `key_binding?: string` on `AgentProfile`, documented as being optional for pre-038 rows
- the `pg-ae-store.ts` exemption, reasoned entirely from "NULL only for a pre-column origin row"

It is the branch **without** the new protection, and it is the one no test covers. The column has to
be nullable *now* — V65 runs against a dev directory that already holds rows — so this is not
something this order could have avoided.

**Classification: POST-LAUNCH.** A customer never reaches it: after the wipe every agent registers
through the path that requires the binding, so the null branches are unreachable rather than
merely unlikely. The work is `SET NOT NULL`, dropping the six conditionals, and deleting the
warning block, and it can only be done after the wipe.

### `decodeOutboundSignalingFrame` silently dropped all three new fields

Caught by the first directory test written against the real wire bytes. It is an allowlist decoder
with no production caller today, but it is exported from the package index, so anything decoding an
assignment through it would have received a frame with no bindings and refused a session that was
fine. **Fixed in this order** rather than deferred — it is inside the unit's own diff.
