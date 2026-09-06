---
name: 041-INGESTATTRIB — Who sent this, and are these bytes theirs
type: micro-work-order
date: 2026-09-06
status: open
dod_line: DOD-M15-GODFILE-1
dod_effect: unit-of
description: >
  The first phase of the ingest chain — everything up to and including "we know who sent this and
  the bytes hash to what they claimed". Six refusals, ~350 lines, out into its own function taking
  IngestState. Unit 2 of 5. Requires 040.
---

# **<ins>MICRO</ins>** WORK ORDER 041-INGESTATTRIB

> 1. **Read [[M15-PROCEDURE]] IN FULL.** 2. **ONE MISSION.** 3. Found something else? Record under
> *Newly discovered* and keep going. 4. Implement → `cello-unit-reviewer` → fix every finding →
> commit. 5. Flip `status:` in the SAME commit as the verdict.
>
> ⛔ **BLOCKED ON 040.** Without `IngestState` this phase needs seven arguments and returns six.

## The phase, exactly

From the top of `ingestReceivedContent` to the sender-pubkey guard. In order:

| what it establishes | refuses with |
|---|---|
| there is a session row for this id | `session_orphaned` |
| the session is not already committed | `session_committed` |
| the frame names a hash algorithm we can read | `content_hash_alg_unknown` |
| we can compute that hash (the salt is available) | `content_hash_salt_unavailable` |
| the bytes hash to what the sender claimed | `content_hash_mismatch` |
| we know who the counterparty is | `sender_unresolved` |

**Produces:** `record`, `contentHashHex`, `evidence`, `algResolved`, `computed`, `entry`,
`senderPubkey`. **Consumes:** nothing but the arguments and `IngestState`.

## ⚠️ THE ORDER OF THESE IS A SECURITY PROPERTY

The same rule 036 protected in `authorship-verification.ts`, one layer out: **a check that can
answer before the sender is known lets a peer choose which refusal they get.** `session_orphaned`
and `content_hash_mismatch` say different things to an operator and retain different evidence.
Reordering them for tidiness is a behaviour change. **The sequence above is the contract.**

## The mission

Move the phase into `ingest-attribution.ts` as one function `(state, deps) => IngestState | Refusal`.
Guards keep their order, their conditions, their comments and their refusal reasons verbatim.

## Definition of Done

- [ ] The six refusals fire on the same inputs, in the same order, with the same reasons.
- [ ] The quarantine/evidence retention on each path is unchanged — **`#quarantineRefusedContent` is
      called at the same point relative to the notice**, because 023's rule is that the claim about
      an artifact is made AFTER the write, never before it.
- [ ] Full suite green, **zero test files modified**, `build:clean` from scratch.
- [ ] `J-SPINE` 7/7.
- [ ] `status:` → `complete` in the same commit as the verdict.

## Traps

1. **`evidence` is built for the orphan branch and read again by later refusals.** It is not local to
   the first guard. Check every reader before moving it.
2. **The orphan branch's triage reads signals the SENDER DOES NOT CONTROL** — their signature, our
   address book, our transcript rows. If a move makes any of those reachable from the frame, the
   probe-confirmation defect 024 closed is back.
3. `#quarantineRefusedContent` bounds retention at the UNKNOWN tier on the orphan path because there
   is no contact row. Do not "improve" it into looking up a tier it cannot have.

## Newly discovered
