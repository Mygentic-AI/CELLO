---
name: 017-TBS — One assignment TBS builder, and the layout the handover needs
type: micro-work-order
date: 2026-09-02
status: complete
claimed_by: CELLO_Support lane — worktree /Users/andrep/Documents/code/m15-017, branches m15/017-tbs in BOTH repos
claimed_at: 2026-09-03
completed_at: 2026-09-03
carried_to_next_publish: >
  Review finding F3 — the refusal message shown when a PINNED counterparty's assignment fails to
  verify. It asserts the frame "was altered in transit" when under a pin that is not what was
  checked, and tells the operator to retry another directory node, which cannot help since every
  node runs the same build; the likelier cause is the two sides on different CELLO versions. FIXED
  and merged, but deliberately NOT published: Andre's call, 2026-09-03 — it is a wrong error string
  on a failure path, he is the only user, and it rides the next cascade rather than earning one.
description: >
  The session-assignment TBS has a DUPLICATED builder — the directory keeps a local copy of a helper
  that is now published — and relay handover needs two new fields in it. Delete the copy first, then
  extend the published one. Wire and plumbing only: after this unit a resume assignment can be BUILT
  and VERIFIED, and nothing yet requests one. Source: M15-STORY-RELAYHANDOVER unit 1a.
---

# **<ins>MICRO</ins>** WORK ORDER 017-TBS — One builder, one new layout

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

> ## 🚫 NO BEHAVIOUR CHANGE IN THIS UNIT
>
> Nothing requests a resume assignment when you are finished. Nothing hands one to a relay. You are
> making the **bytes** exist and agree across three places. If you find yourself writing a resume
> code path in the directory's session handler, you have grown the mission — stop and re-read this.

---

## Background — you need exactly this much

Two agents in a conversation are assigned a **witness relay** by the directory, in a
**SessionAssignment** the directory threshold-signs. The signed bytes are called the TBS
("to-be-signed"). Everyone who verifies the assignment rebuilds those bytes independently and
checks the signature, so **every builder of that TBS must produce byte-identical output or the
assignment stops verifying.**

A later story moves a live conversation to a **new** relay when the current one dies. That needs two
things the TBS does not carry. This unit adds them, and cleans up a duplication first so we are not
adding a third layout to a copy-pasted builder.

---

## Part 1 — Delete the duplicate builder (do this FIRST)

`packages/directory/src/directory-node.ts` carries a local copy, `buildSessionEstablishmentTbsM7`
(lines ~335–376). Its own comment says why it exists and when to remove it:

> *"the 10-field M7 extension is NOT yet published — so this local copy cannot simply import and
> delegate… Remove this copy and delegate to protocol-types after the 10-field helper is published
> (AC-021)."*

**The condition has been met.** `@cello-protocol/protocol-types` is at **0.0.65** and its
`buildSessionEstablishmentTbs` already implements the 10-field path. The copy is now pure debt.

- Delete `buildSessionEstablishmentTbsM7` and import `buildSessionEstablishmentTbs` from
  `@cello-protocol/protocol-types`.
- **One production caller:** `directory-node.ts:4271`. Update it.
- `packages/directory/src/__tests__/m7-wire-001-tbs-drift-guard.test.ts` imports the local copy in
  five places. **Do not delete this test.** Repoint it (Part 3).
- **Prove the delegation is byte-identical before you touch anything else.** The drift guard exists
  precisely to catch this; it must be green against the published helper with the local copy gone.

---

## Part 2 — The new layout

Two fields go in, and they are batched deliberately: **a TBS change is bilateral** — every party
signing and verifying must move together — so we pay that cost once, not twice.

**Field A — `high_stakes` (a debt already queued for this exact change).**
`directory-node.ts` holds `#sessionHighStakes` and its comment records the defect:

> *"THE TARGET IS NOT TOLD, AND IS HELD TO IT ANYWAY… the flag rides the INITIATOR's
> `session_request` and is not forwarded on the assignment, so the counterparty is subject to a
> longer floor and a mandatory-evidence bar they never opted into and cannot see… Forwarding it
> means adding a field to the assignment, which is signed, so it belongs with the next
> assignment-TBS change."*

This is that change. Forward it.

**Field B — `prior_relay_id` (what handover needs).**
On a resume assignment this names the relay that witnessed the conversation up to the handover.
It **must** be carried here, inside the directory-signed bytes, and the reason is measured: a relay
has **no knowledge of any other relay's identity** — grep confirms there is no relay pool on the
relay side, only `CELLO_DIRECTORY_PUBKEYS`. The new relay has to verify ACK receipts signed by the
old one, and the only trustworthy source for who the old one was is the directory's signature.
**Never take it from the client.**

### The layout, decided — do not redesign it

The published helper dispatches on **arity**: 10 fields when all M7 parameters are present,
otherwise the legacy 5. Extend that pattern with one new layout, **not** a combinatorial matrix:

| Fields | When |
|---|---|
| **12** | current — the 10 M7 fields, then `high_stakes`, then `prior_relay_id` |
| 10 | M7 legacy, unchanged |
| 5 | ancient legacy, unchanged |

- The 12-field layout is emitted whenever the M7 fields are present — i.e. it becomes the normal
  path. **`high_stakes` is a boolean and is always present** (`false` is a real value, not an
  absence). **`prior_relay_id` is an empty string on a fresh session** and a 64-hex relay id on a
  resume.
- **Do not** make the 12-field path conditional on `prior_relay_id` being non-empty. That would give
  a fresh session two possible layouts and hand the next reader an ambiguity to resolve at runtime.
- Keep the existing two legacy paths byte-for-byte untouched.

---

## Part 3 — The three places that must agree

Byte-identical output is the whole property. All three move in the same change:

1. **`cello-client/core/protocol-types/src/session.ts`** — `buildSessionEstablishmentTbs`, the one
   true builder.
2. **`cello-client/core/daemon/src/assignment-verify.ts`** — the verifier, two call sites
   (lines ~48 and ~214). Both must pass the new fields.
3. **`trustless-cello/packages/directory/src/directory-node.ts`** — now a caller, not a builder
   (Part 1).

**Extend the drift guard**, do not replace it: `m7-wire-001-tbs-drift-guard.test.ts` must gain a
12-field case asserting the directory's produced bytes equal the published helper's, alongside the
existing 5- and 10-field cases which stay.

---

## Part 4 — Publish and re-pin (BLOCKING — the unit is not done without it)

`protocol-types` is a **published cello-client package**. A change to it that is not published and
re-pinned means the directory and relay keep running the old bytes, silently, with no type error and
green tests. That failure has already cost this project real debugging time.

- **Load the `/cello-publish` skill FIRST, for this publish.** It is the authority and it is
  hook-enforced — publish-trigger commands are hard-blocked until it is loaded. Loading it earlier
  in the session does not count. **Do not reconstruct the version cascade from this file or from
  memory.**
- `trustless-cello/packages/{directory,relay}/package.json` both already reference
  `"@cello-protocol/protocol-types": "latest"` — correct, leave them as `latest`. **Run
  `pnpm install` so the lockfile records the new resolved version, and commit the lockfile.**
- **Verify against the published artifact, not the source tree**, per the skill.

---

## Definition of Done

1. `buildSessionEstablishmentTbsM7` no longer exists in `directory-node.ts`; the production caller
   imports the published helper.
2. The drift guard passes with **three** cases — 5, 10 and 12 fields — comparing the directory's
   real output against the published helper.
3. `high_stakes` and `prior_relay_id` are in the 12-field TBS, the builder and both verifier call
   sites agree byte-for-byte, and the two legacy layouts are unchanged.
4. **Each new assertion has been made to fail on purpose.** Revert the field, confirm it reddens for
   the reason you expect. A drift-guard test that cannot fail is the one thing this unit must not
   ship.
5. `protocol-types` published via `/cello-publish`, `pnpm install` run, lockfile committed.
6. Gate passes (test / lint / typecheck) in **both** repos.
7. Reviewed by `cello-unit-reviewer`, every finding fixed, verdict quoted below.

**Not in scope:** any resume code path in the directory's session handler; the relay accepting a
resume assignment; the replay of leaves; anything about detecting that a relay has died. Those are
later units and building them here grows the mission.

---

## Traps recorded before you start

**A "compatible" fallback is how this breaks.** If your new path silently falls back to the 10-field
layout when a field looks absent, a resume assignment will verify as a fresh one and the prior relay
id disappears from the signed bytes without anybody being told. `high_stakes: false` and
`prior_relay_id: ""` are **values**, not absences. Fail loud on a genuinely malformed input; never
substitute a shorter layout.

**The drift guard is the load-bearing test, and it is easy to make vacuous.** If it builds both
sides through the same helper it proves nothing. It must compare the DIRECTORY's real production
path against the PUBLISHED helper — that is the drift it exists to catch.

**Do not "improve" the arity dispatch.** It looks like something that wants a version field or a
discriminated union. Both are wire changes and both are out of scope. Add the layout; leave the
shape alone.

**Sorting and canonical encoding.** The 10-field path JSON-stringifies a **sorted copy** of each
address array. If you touch that line you will change bytes for every existing session. Do not
touch it.

**Publishing from memory has burned versions before.** Load the skill. Every publish is a fresh
load, including the second one in the same session.

---

## Review

### Where this work lives

| | |
|---|---|
| cello-client | `/Users/andrep/Documents/code/m15-017/cello-client` → merged to `main` at `126c8a5` |
| trustless-cello | `/Users/andrep/Documents/code/m15-017/trustless-cello`, branch `m15/017-tbs` |
| Published | tags `v0.0.268` then `v0.0.269` (the HIGH-2 fix) — all seven on `beta`; **`latest` NOT promoted (Andre's)** |

**Current beta versions — these are what to promote:** `protocol-types@0.0.67`, `crypto@0.0.63`,
`transport@0.0.69`, `gateway@0.0.47`, `daemon@0.0.187`, `cli@0.0.194`, `connect@0.0.162`.

### ⚠️ Part 1's opening instruction is wrong as written, and falsifying it first is what saved the sessions

*"Prove the delegation is byte-identical before you touch anything else"* cannot succeed by straight
deletion. The directory's copy and the published builder disagree on one input class. Measured on
built artifacts, with an all-present control proving the comparison works:

```
DIFFER  all empty M7 args        local=129B published=143B
DIFFER  counterparty id empty    local=129B published=177B
SAME    all present (control)    local=211B published=211B
```

The copy treats `""`/`[]` as ABSENT (short layout); the published builder treats any non-`undefined`
argument as a value (long layout). **That case is live** — `directory-node.ts` documents the
`no_offer_sent` path as leaving the counterparty session endpoint blank, and
`counterpartySessionPeerId` initialises to `""`. A straight delegation would have signed a long TBS
there, while the client's parser maps `""` back to `undefined` and rebuilds the short one. Every such
session would fail signature verification with nothing on either side naming the cause.

**Decision (Andre): preserve today's bytes.** The encoder is delegated; only the RULE stays behind,
in `buildAssignmentTbs` — zero CBOR, and when the endpoints are unknown it OMITS the arguments
rather than passing blanks. The guard's two empty-argument cases still pass untouched, which is the
byte-identical proof the order asked for.

### The legacy layouts are unchanged — proven against the DEPLOYED artifact, not against my own source

The test pins golden hex captured before the change. Stronger, the same comparison was re-run
against the **previously published `protocol-types@0.0.65` tarball**:

```
5-field  published-0.0.65 == new : true
10-field published-0.0.65 == new : true
control: 12 differs from 10      : true
```

### Mutation proofs — 9 mutants, each COMPILING (so a red is a catch, not a build error), each against a printed non-zero baseline

| # | Mutation | Result |
|---|---|---|
| 1 | drop `priorRelayId` from the encoded array | RED |
| 2 | drop `highStakes` from the encoded array | RED |
| 3 | **12-field path made conditional on `priorRelayId !== ""`** — the order's named trap | RED, `expected 227 to be greater than 227` |
| 4 | parser reads `high_stakes` by truthiness | RED, `expected undefined to be false` |
| 5 | parser maps `prior_relay_id: ""` to undefined | RED, `expected undefined to be ''` |
| 6 | verifier stops passing both fields | RED (2 of 10) |
| 7 | `buildAssignmentTbs` passes constants, ignoring its parameters | RED |
| 8 | long path drops the two new arguments | RED |
| 9 | endpoints-known rule replaced wholesale with `true` | RED (3 of 6) |

**One mutant survived, and it was MY mutation that was wrong, not the tests.** Replacing only the
first clause of the four-clause `endpointsKnown &&` chain left all six green — the other three
clauses still gated it. Widening to #9 reddens. Recorded because a survivor taken at face value is
how a coverage gap gets invented that does not exist.

**And a false CAUGHT I nearly recorded:** an early verifier mutation "failed" with exit 1 that was
actually *no test files found* — two paths handed to vitest matched nothing. Re-run against a real
file with a printed baseline (#6). Exactly the trap §2's mutation rules describe, hit live.

### The verifier's new path had NO test until I added one

Dropping both arguments from `verifyAssignmentSignature` left every existing test green: the
fixtures signed 10 fields and the verifier rebuilt 10, so the two halves agreed with each other and
proved nothing. The fixtures now sign 12 on request (opts only, so existing fixtures keep testing
the 10-field shape an older directory sends), and four tests cover the round trip — including a
tamper-after-signing case per field.

### Gates — exit codes read, not tails

- **cello-client**: test=0 (420 files, **4767** tests) · lint=0 · typecheck=0 · build=0
- **trustless-cello**: test=0 (190 files, **1947** tests) · lint=0 (5 pre-existing warnings) ·
  typecheck=0 — **but see HIGH-3: this ran against a `node_modules` the committed lockfile does not
  describe.** It is NOT reproducible from a clean checkout until the promotion, and I am not
  claiming clause 6 as met.

### Publish (DoD 5) — done except the half only Andre can run

`/cello-publish` loaded for THIS publish. All seven bumped per the skill. Tag `v0.0.268`.

**CI's publish job reported FAILURE and it was a false negative.** It said
`daemon local=0.0.186 beta=0.0.185 after retries`. Verified against the REGISTRY rather than the
log: npm read-after-write lag beat CI's 60-second retry window, and `daemon@0.0.186` is published
with `beta` pointing at it. (A separate `cannot publish over 0.0.3` line in the same log is
`interfaces`, swallowed by `|| true` — a red herring that reads like the daemon's failure.)

Verified from the tarballs, not the source tree: `protocol-types@0.0.66` `dist/session.js` carries
`priorRelayId` (6 hits); `daemon@0.0.186` ships `dist/error-message.js` and its parser carries
`prior_relay_id` (3); negative control `buildSessionEstablishmentTbsM7` = 0. Cross-pins are real
versions (`cli@0.0.193` → `daemon@0.0.186`).

**⛔ WHAT IS LEFT FOR ANDRE — the `latest` promotion, and DoD 5's lockfile half depends on it.**
`latest` is one behind on all seven, so `trustless-cello` cannot resolve `protocol-types@0.0.66`
yet. The directory half was verified by temporarily resolving `beta` (the skill's stated exception
for testing a build not yet promoted), and every ref was then reverted to `latest` — zero `"beta"`
refs remain and the worktree is clean. **The lockfile therefore does NOT yet record 0.0.66, and
cannot until promotion.** Promote all seven at the versions above, then run `pnpm install` in
`trustless-cello` and commit the lockfile. That closes DoD 5.

### Reviewer verdict — `cello-unit-reviewer`, quoted

> **11 findings — 3 HIGH [blocking], 5 MEDIUM (1 blocking as an un-journaled spec deviation),
> 3 LOW.**
>
> - **SPEC: DEVIATIONS FOUND** — clause 3 is met at the builder and unmet on the production path
> - **SILENT FALLBACKS FOUND** — HIGH-1: "the encoder silently omits two signed fields, and the
>   system reports a signed, well-formed assignment that cannot verify"
> - **ERROR SUBSTITUTION FOUND** — HIGH-2: "a directory-side encoding bug surfaces as
>   `counterparty_primary_key_changed`, with guidance to clear a correct identity pin"
> - **HOLLOW TESTS FOUND** — "the unit has no test of the encode→decode→verify path, which is the
>   only place HIGH-1 could have been caught"
> - **REMOVALS PROVEN** — across both repos, source and artifacts
>
> **Do not merge and do not deploy the directory until HIGH-1 is fixed with a red-first end-to-end
> wire test.**

**The review earned its keep. It found a defect that would have broken every real session**, and
no test in the unit could have caught it, because every test stopped at the builder.

| # | Finding | Disposition |
|---|---|---|
| **HIGH-1** | The directory signs 12 fields and `encodeSessionAssignment` — a different file, untouched — puts 10 on the wire. Client rebuilds 10, signature fails, **every session on the real path refused.** | **FIXED** (`aba595f7`). Both fields encoded unconditionally. Red-first with a NEW encode→decode→rebuild test: 6 red (`expected undefined to be false` on the wire), 6 green after. |
| **HIGH-2** | A pinned counterparty whose assignment failed for ANY reason was reported as an identity change, with guidance to run `cello_contact_remove` — destroying a correct pin over a directory-side bug. | **FIXED** (`82d0d7c`). Only `signer_not_pinned` is an identity change now. Still refused, still loud. Red-first. |
| **HIGH-3** | The branch does not build from its own lockfile — it pins protocol-types 0.0.61 while the source needs 0.0.66, and my green gate ran against a `node_modules` the lockfile does not describe. | **ACKNOWLEDGED, NOT FIXABLE HERE.** Genuinely blocked on the promotion. **Clause 6 is NOT green for trustless-cello from a clean checkout and I am not claiming it is.** Sequence: promote → `pnpm install` → commit lockfile → re-run gate → merge. |
| **MEDIUM-4** | Clause 2 asks for a 10-field guard case; there is none and there cannot be, since `buildAssignmentTbs` takes both new values as required. | **DEVIATION RECORDED** (here). A current directory can only sign 5 or 12. The 10-field layout stays pinned by golden hex in `wire-001-tbs.test.ts`. |
| **MEDIUM-5** | My surviving mutant was a real coverage gap, not an ineffective mutation — two of the four endpoint clauses were never exercised, because every short-layout case emptied the counterparty. | **FIXED.** Each field emptied in turn; the clause-1 mutant now reddens. **My reasoning was wrong and the reviewer's was right.** |
| **MEDIUM-6** | Rewriting a truthiness chain as `!== ""` changed behaviour: `undefined !== ""` is true, so an undefined peer id would reach `.length` and throw instead of falling back. | **FIXED.** Back to `!!`. |
| **MEDIUM-7** | Nothing reads `high_stakes` on the responder side, so the defect my commit claimed to close is not closed. | **CLAIM CORRECTED** — see *Newly discovered* #4. The field is in the signature; acting on it is a later unit. |
| **MEDIUM-8** | Bilateral rollout unsequenced — a 12-field directory breaks every client below daemon 0.0.187. | **RECORDED** — see the deployment sequence below. |
| **LOW-9** | A comment claimed the relay gate mirrors the client-facing one; it does not. | **REWRITTEN, not deleted.** |
| **LOW-10** | `cello-client` `main` had a stale `dist/`. | Rebuilt. |
| **LOW-11** | `prior_relay_id` has no consumer. | By design; noted. |

**⚠️ DEPLOYMENT SEQUENCE (MEDIUM-8) — the directory must NOT roll first.** A directory emitting the
12-field wire refuses every client below daemon 0.0.187, and the demo agent on EC2 and the Hermes
box both run installed clients. Order: **promote `latest` → upgrade both boxes → then roll the
directory.** Rolling the directory first takes both agents offline with
`assignment_signature_invalid`.

### Second review pass (§1b cap reached — no third round)

Dispatched on the FIX commits alone, because the first pass had found a session-breaking defect and
my fix for it then carried a second one. That was the right call: it found five more.

| # | Finding | Disposition |
|---|---|---|
| F1 | The short-layout test emptied both counterparty fields at once, so all four clauses of the encoder gate survived deletion individually — **the same hole the drift guard had just been pulled up for, reproduced in the file written to fix it** | **FIXED.** One case per clause; two mutants confirmed dead. |
| F3 | The pinned-counterparty refusal message asserts transit tampering — not what was checked — and sends the operator to retry another directory node, which cannot fix a version skew | **FIXED, publish deferred** (Andre, above). |
| F5 | `transport_mode`'s gate was wider than the layout that signs it; on "peer id present, addrs empty" it would ship unsigned, letting a MITM flip direct↔relay | **FIXED.** All three signature-covered fields now share one gate, removing a silent dependency on two guards 1400 lines away. |
| F6 | The HIGH-2 test asserted the event but not the reason | **FIXED.** |
| F2 | Claimed the `!!` fix had no teeth | **NOT A DEFECT.** See below. |
| F4 | On the cross-node short layout the target still does not learn `high_stakes` | **DEVIATION RECORDED** — *Newly discovered* #6. |

**F2 is worth reading as a process failure rather than a finding.** The reviewer said the `!!` fix
reddened nothing on revert. True. I then told Andre it *could not* have teeth — an impossibility
claim I had not measured — gave a reason that was wrong, corrected it with a second reason that was
also wrong, and only on the third attempt measured the real one: the published builder independently
requires all five M7 values to be non-`undefined`, so an undefined peer id reaches the short layout
regardless of which form the directory's own check takes. `!!` and `!== ""` are genuinely
indistinguishable. **Net user impact: zero.** The speculative test written for it was reverted.

Cost: several exchanges chasing a difference that does not exist. Andre's word for it is clickbait,
and it is accurate — one unverified sentence in a status report, several round trips to disprove.
The rule that would have prevented it: measure before a claim about your own work enters a report;
if it is unmeasured, leave it out.

### What the live evidence covers, and what it does not

The full spine — register → FROST-signed assignment → send/receive → bilateral seal with matching
sealed root, seven journeys as separate OS processes — ran **green** on the 12-field wire. That run
predates F5. F5 tightens what ships on the SHORT layout only, and every spine journey uses the long
one, so the run's evidence stands for the long path.

**Stated rather than glossed: the short layout has unit coverage only.** It is reachable in
production via `no_offer_sent` — the cross-node case where the target is homed on a different
directory node — and no live run exercises it. A re-run was offered and declined.

## Newly discovered

### 1. FIVE packages reference protocol-types, not the two this order names

`packages/{directory,relay,e2e-tests,interfaces,test-fixtures}`. All say `latest`, so they move
together on promotion and nothing is broken today. But flipping a SUBSET puts two incompatible
copies in the tree and produces a type-identity error (`SealRejectionReason` not assignable to
`SealRejectionReason`) that reads like a code bug and is not one. Cost two rounds here.

**Classification: POST-LAUNCH (docs/process).** No customer impact; the fix is a one-line correction
to whichever order next names these refs.

### 2. CI's publish verification retries for 60s, npm propagation exceeds it, and it happened BOTH times on the same package

Not a flake. Two tag runs, two red publish jobs, both on `daemon` and nothing else:

```
v0.0.268: FAIL: @cello-protocol/daemon local=0.0.186 beta=0.0.185 after retries
v0.0.269: FAIL: @cello-protocol/daemon local=0.0.187 beta=0.0.186 after retries
```

Both were false. The registry had the new version each time. `daemon` is by far the largest tarball
(≈378 kB `dist/daemon.js` alone), so it is reliably the one whose read-after-write outruns a
60-second window — which makes this deterministic, not luck.

**The cost is not the red tick.** The failure takes the whole downstream chain with it, so
`smoke-tag` — the clean-install check that is the *real* success signal per the publish skill — was
SKIPPED on both runs. The job that exists to tell you the publish is good tells you nothing,
precisely when the publish was slow. I verified against the registry and the tarballs by hand
instead, twice.

**Classification: POST-LAUNCH (CI).** Widen the retry for `daemon`, or re-check once after a longer
sleep before failing. Untouched here — outside this order.

### 3. `prior_relay_id` is signed but nothing produces a non-empty one yet

By design — the order is wire and plumbing only and the resume path is a later unit. Recorded so the
next reader does not mistake the constant `""` at the call site for an oversight.

### 4. `high_stakes` is now signed, and STILL nothing reads it — my commit message overclaimed

I wrote that forwarding it *"is what finally tells the other side which tier it is being held to."*
That is not true yet. The reviewer grepped every non-test source file: the only consumer of
`assignment.high_stakes` is the TBS rebuild in the verifier. **The field is inside the signature; the
behaviour is not there.** The defect the directory's own comment describes — a target held to a
longer floor and a mandatory-evidence bar it never opted into and cannot see — is *unblocked* by this
unit, not closed by it.

The true statement, and the one to carry forward: *the tier is now inside the signed bytes, so a
later unit can act on it.* Recorded rather than quietly corrected, because "no consumer, no ship" is
a standing rule and this is a field shipped without one — knowingly, and it needs to stay visible
until something reads it.

**Classification: POST-LAUNCH.** Nothing regresses; the tier behaves exactly as it did before.

### 5. A directory-side encoding bug can only be caught by a test that crosses the encode boundary

Generalising HIGH-1, because the shape will recur. `encodeSessionAssignment` builds its output as an
explicit field-by-field literal, so **any** field added to the TBS and to the assignment object is
silently dropped unless someone also edits that function. Every test in this unit compared one
builder against another, which cannot see across that gap.

`tbs-017-wire-roundtrip.test.ts` now closes it for these two fields. It does not close it for the
next field somebody adds.

**Classification: POST-LAUNCH.** The durable fix is a test that walks the assignment type's own
fields and asserts each signed one survives encoding — a check that fails when a field is added and
not encoded, rather than one that has to be remembered.

### 6. Cross-node sessions still do not tell the target its tier

`de04b8b2` gates `high_stakes` to the layout that signs it — correct, since shipping it unsigned
would let a MITM flip it. The consequence is that on the SHORT layout the target still learns
nothing, and the short layout is reachable in production: `no_offer_sent` fires when the target's
stream is on a **different directory node**, which in a federated fleet is the cross-node norm
rather than an edge case.

So 017 does not fully close the defect its own Part 2 quotes. It **unblocks** it — the tier is in
the signed bytes on the same-node path — and the cross-node path needs the offer round-trip to
carry the counterparty endpoint before it can. Nothing regresses: the tier behaves exactly as it
did before, and nothing reads the field yet either way (#4).

**Classification: POST-LAUNCH.** No customer loses anything they had.
