---
name: MICRO-004 — Three admin frame types with no sender
type: micro-work-order
date: 2026-08-24
status: open
description: >
  The directory→relay admin stream accepts four frame types. Only one has a caller. Delete the two
  that provably have none, and check the deployed fleet before touching the third. Source:
  DOD-M15-RELAYADMIN-DEAD-FRAMES-1.
---

# **<ins>MICRO</ins>** WORK ORDER 004 — Three admin frame types with no sender

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

The relay accepts four commands from a directory over `/cello/directory-relay/1.0.0`. Three of them
have nothing anywhere that sends them.

Fully written, authenticated, accepted code with no caller reads as abandoned work to anyone auditing
a public repo — and this repo is read by people deciding whether to trust us. They are also live
surface: each is accepted on a publicly dialable relay.

## What was already measured — take this as given, do not re-derive it

| Frame | Status |
|---|---|
| `discard_session` | **LIVE.** Called from `directory-node.ts:2766` on a stream close before the session is fully established. **This is why the handler itself is kept.** |
| `confirm_seal` | **No caller at all.** The relay's idle sweep reclaims the post-seal session. |
| `reject_seal` | **No caller at all.** Same. |
| `record_assignment` | **The directory no longer dials it** — recording moved to the client. **But see the trap below.** |

---

## The work

### 1. Delete `confirm_seal` and `reject_seal`
Handler, types, and any test asserting their behaviour. These have no caveat.

### 2. `record_assignment` — CHECK THE DEPLOYED FLEET FIRST
**Do not delete it on the strength of "the client path replaced it."** The relay may still be
recording sessions from older directories mid-roll, and the client path was the replacement, not a
proven-complete migration.

- Read the running fleet. Establish whether any deployed directory still sends it.
- **Still sent by anything deployed → leave it, and write one line here saying so.** That is a
  complete and correct outcome for this order.
- **Provably unsent → delete it** the same way as the other two.

### 3. Keep `discard_session`
It is load-bearing. Do not touch it.

---

## Definition of Done

1. `confirm_seal` and `reject_seal` are gone — handler, types, tests.
2. `record_assignment` is either deleted with the fleet evidence written down, or kept with the fleet
   evidence written down. **Either is done. A guess is not.**
3. `discard_session` still works. Prove it with a test that exercises it.
4. **Nothing else was deleted.** Paste the diff stat and confirm.
5. `pnpm run test`, `pnpm run lint`, `pnpm run typecheck` pass.
6. Reviewed by `cello-unit-reviewer`, every finding fixed, verdict quoted below.

**Not in scope:** replay protection on the admin stream (ruled out of the gate), the admin stream's
directory key set, anything in MICRO-002 or MICRO-003.

---

## Traps recorded before you start

- **This line's parent was WRONG once already.** It said the whole handler had no caller and should be
  deleted. It had one — the production directory — and deleting it would have broken every session
  teardown. **Measure per frame type. Do not generalise from one of them to the others.**
- **"No caller" means you looked in both repos.** A relay-side orphan is often one half of a
  cross-package protocol whose sender lives in the directory.
- **Deleting a source file does not remove its built artifact.** Assert absence against the built
  output, not the source tree.

---

## Review

*(Reviewer verdict. One quote. Not a transcript.)*

---

## Newly discovered

*(One or two lines each. Do not act on them.)*
