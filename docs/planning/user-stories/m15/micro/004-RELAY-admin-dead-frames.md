---
name: 004-RELAY — Three admin frame types with no sender
type: micro-work-order
date: 2026-08-24
status: complete
dod_line: DOD-M15-RELAYADMIN-DEAD-FRAMES-1
dod_effect: closes
description: >
  The directory→relay admin stream accepts four frame types. Only one has a caller. Delete the two
  that provably have none, and check the deployed fleet before touching the third. Source:
  DOD-M15-RELAYADMIN-DEAD-FRAMES-1.
---

# **<ins>MICRO</ins>** WORK ORDER 004-RELAY — Three admin frame types with no sender

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
>    finding → commit. Commit per fix, push after every commit. **Closing a unit means flipping
>    this file's `status:` frontmatter to `complete` in the SAME commit as the verdict** — the
>    two are one fact, and eight orders in a row have shipped with them disagreeing.
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

1. ✅ `confirm_seal` and `reject_seal` are gone — handler (`relay-node.ts`), types
   (`directory-relay-types.ts`), tests (AC-004/AC-005 in both
   `directory-relay-protocol.test.ts` and `network-relay-adapter.test.ts`).
2. ✅ `record_assignment` **deleted**, fleet evidence: the directory stopped dialing it in commits
   `12780b2e` (2026-06-30, Option B client-presented assignments) and `cff53b73` (2026-06-30,
   seal-broker cutover deleted confirmSeal/rejectSeal dials too). Every directory image ever
   recorded in `infra/GCP-STATE.md` (earliest `dir-8fc23d86`/`dir-d35d0a1d`, rolled 2026-08-03, over
   a month after removal; current fleet `e0aae57a`, rolled 2026-08-24) has both commits as
   ancestors (`git merge-base --is-ancestor`, confirmed). No AWS directory survives either (AWS
   protocol stack deleted 2026-08-06). No deployed fleet version, past or present, has ever sent
   `record_assignment` since the removal. Cross-repo grep of `cello-client` for all four frame
   names found zero hits (positive-controlled against `client_record_assignment`, which IS sent).
3. ✅ `discard_session` still works — `AC-002` in both `directory-relay-protocol.test.ts` (relay
   side, wire-level) and `network-relay-adapter.test.ts` (directory side, via the real adapter over
   a real relay) exercise it unmodified; both green.
4. ✅ Nothing else deleted. Diff stat:
   ```
    packages/directory/src/__tests__/network-relay-adapter.test.ts    | 263 ++-------------
    packages/relay/src/__tests__/directory-relay-protocol.test.ts     | 365 ++-------------------
    packages/relay/src/directory-relay-types.ts                       |  54 +--
    packages/relay/src/relay-node.ts                                  |  95 ++----
    packages/relay/src/relay-types.ts                                 |   7 +-
    5 files changed, 99 insertions(+), 685 deletions(-)
   ```
   All five files are the relay's admin-frame handler/types/docs and the two test files that
   exercised the wire round-trip from each side of it. Necessitated but not anticipated by the
   original scope: `network-relay-adapter.test.ts` (directory package) had to change too, because
   its AC-001/004/005 dialed a REAL relay over the REAL wire and broke the moment the relay's
   dispatch was removed — see *Newly discovered* for what was deliberately left alone there.
5. ✅ `pnpm run lint` — clean (0 errors). `pnpm run typecheck` (`tsc --build`, emits `dist/`) —
   clean. `pnpm run test` — 1754 passed / 609 skipped / 1 failed; the 1 failure
   (`expect-present-enforcer.test.ts` flagging `j-suspend-tofn.spine.test.ts:279`) is **pre-existing
   on `main`**, confirmed via `git stash` + re-run before any of this unit's changes, unrelated
   subsystem (TOFN suspend spine test), not touched by this diff. Both touched test files: 7/7 and
   7/7 green.
6. ✅ Reviewed by `cello-unit-reviewer`, verdict quoted below. One finding (this file not yet
   updated with evidence) — fixed by this edit.

**Not in scope:** replay protection on the admin stream (ruled out of the gate), the admin stream's
directory key set, anything in 002-RELAY or 003-RELAY.

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

> One finding, procedural rather than behavioral: the code, tests, and deadness proof for
> DOD-M15-RELAYADMIN-DEAD-FRAMES-1 are all independently verified correct —
> `confirm_seal`/`reject_seal` fully removed, `record_assignment` deadness proven against commit
> history, GCP fleet dates, and a cross-repo grep (not just the coder's narrative),
> `discard_session` still proven live, no other frame touched, no silent fallback or error
> substitution introduced, and all three modified/rewritten tests confirmed to still prove what
> they claim (14/14 green, independently re-run). The single gap is that the work order file
> itself was never updated with the fleet evidence, diff stat, and "newly discovered" note its own
> DoD requires — that's a documentation-only blocker, not a code defect. — `cello-unit-reviewer`

Fixed: this file, same commit.

---

### ⚠️ OPUS RE-REVIEW (2026-08-31) — the deletion is SOUND; it left three problems behind

Commissioned because this unit **and its first review were both run on Sonnet**, and the two sibling
units re-reviewed on Opus (003 and 005) both turned up real defects the Sonnet pass missed.

> **The deletion itself is sound** — I re-derived the deadness independently and it holds on both the
> code-path and fleet-dated lens. But the unit left three real problems behind, and one of them is a
> landmine for the next deletion unit in this same milestone. The Sonnet review missed all four.
> — `cello-unit-reviewer` (Opus)

**Deadness re-derived, and on stronger evidence than the order itself gave.** The reviewer added a
proof the order never made: `packages/relay/package.json` exposes exactly one export (`"."`), and
`directory-relay-types.ts` is not re-exported from `src/index.ts` — so the deleted interfaces were
never on the package's public surface and no by-name import anywhere can break. It also reproduced
the fleet claim six-for-six against every recorded image plus the live tfvars pin. Deleted-test
triage: all five, no live coverage orphaned.

**ALL FOUR FIXED 2026-08-31.**

1. **The rewritten header stated something false, assertively, with a DoD stamp on it.** It said
   `discard_session` "remains the one live directory→relay dial". The relay handles **three** live
   frames on that protocol, and the other two sit ten and thirty lines below the branches this unit
   deleted. The type unions were worse: `DirectoryToRelayFrame = DiscardSessionFrame` asserted a
   single-frame protocol, and `DirectoryRelayResponse` omitted three responses the relay actually
   sends. Nothing consumes either union, which is exactly why being wrong cost nothing until someone
   believed it. **This was the top finding because this milestone is running a deletion campaign:**
   the next unit to read that header would have concluded `get_session_liveness` was dead, and
   deleting it silently breaks the ABSENT attestation. The unit reproduced the exact mistake its own
   first trap warns about — do not generalise from the frames you looked at to the ones you did not.
   - **Correction to the reviewer, verified at the call sites:** it named `get_seal_leaves` as live.
     It is not. The relay handles it and the directory adapter still implements the sender, but
     **no directory calls it** — Option B rebuilds the chain from client-carried leaves
     (`directory-node.ts:4473`, `seal-unilateral-verify.ts`). It is the same shape as the three
     frames deleted here. Recorded below, not acted on.
2. **The receiver was gone; the sender was still fully wired, documented, and silent.** On this
   unit's own stated axis — abandoned-looking code in a public repo — the repo came out WORSE than
   before: sender and receiver used to match, and afterwards the directory kept three
   apparently-working senders whose header still promised `assignment_ok` / `confirm_ok` / `reject_ok`
   responses no relay will ever send. `confirmSeal` and `rejectSeal` swallowed the failure in a bare
   `catch {}` — no log, no return value. All three now refuse by name and send nothing.
3. **The relay refused an authenticated directory frame and wrote nothing down.** `stream.abort()`
   does not throw locally, so even the catch below it never ran, and a libp2p reset carries no reason
   across the wire — the event left no trace on either machine. Meanwhile the directory reported
   `relay_unavailable` for a relay that was up, authenticating, and answering every other frame: an
   exit-point label pointing at the network for a wire-protocol narrowing. Now logged at warn, naming
   the frame type and version skew as the likely cause.
4. **Nothing tested the behaviour the deletion introduced.** Every surviving test passed identically
   with all three handlers restored — the deletion was not self-defending. Now covered on both sides,
   and revert-tested: restoring the `confirm_seal` handler reddens the new test with *"promise
   resolved { type: confirm_ok } instead of rejecting"* while the other eight stay green.

**✅ CLOSED 2026-09-01.** Deletion complete and merged. Re-reviewed on Opus (the only unit in this
milestone still resting on a Sonnet verdict); all four findings fixed and revert-tested.

---

## Newly discovered

- `packages/directory/src/network-relay-adapter.ts` still defines `recordAssignment()`,
  `confirmSeal()`, `rejectSeal()` methods that construct the now-retired `record_assignment` /
  `confirm_seal` / `reject_seal` wire frames. They are dead (`directory-node.ts` never calls them)
  but were left in place: the `RelayAdapter` interface in `directory-node.ts` requires them as
  non-optional, and removing them would mean changing that interface plus every other
  implementer — a bigger, cross-cutting unit, not a micro one.
- One pre-existing test failure on `main`, unrelated to this order:
  `packages/e2e-tests/src/__tests__/expect-present-enforcer.test.ts` flags an un-exempted
  `.toMatch` on a possibly-absent subject at `j-suspend-tofn.spine.test.ts:279`. Confirmed present
  before this unit's changes via `git stash` + re-run.
- **`get_seal_leaves` is the same shape as the three frames this order deleted** — relay handler at
  `relay-node.ts:680`, sender at `network-relay-adapter.ts:261`, and **no directory caller** since
  Option B moved unilateral sealing to client-carried leaves (`directory-node.ts:4473`,
  `seal-unilateral-verify.ts`). A candidate for the next deletion pass; not touched here.
- **`getSessionLiveness` maps EVERY failure to `"unknown"`** (`network-relay-adapter.ts`), including
  the relay answering `auth_invalid`. `"unknown"` is a legitimate protocol value the directory feeds
  into an ABSENT attestation, so a relay refusing our authentication is indistinguishable from a
  relay that genuinely does not know. A live path, not a retired one — the checked-then-ignored shape
  005-RELAY hunts, sitting just outside its fence.
- The premise inherited from the milestone DoD, "the relay accepts four commands from a directory",
  was never true — it is six. Worth correcting at the source; this order did not re-derive it.
