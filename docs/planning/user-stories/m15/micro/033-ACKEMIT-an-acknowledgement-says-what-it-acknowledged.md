---
name: 033-ACKEMIT — Production signs what it saw, not merely where it was
type: micro-work-order
date: 2026-09-05
status: open
dod_line: DOD-M15-WITHHOLD-SEAL-1
dod_effect: closes
dod_effect_note: >
  The EMITTER half. `020-ACKHASH` shipped the reading half and is LIVE — fleet on `eccc9cbc` across
  all five nodes, client published and promoted (`protocol-types@0.0.69`, `daemon@0.0.189`,
  `connect@0.0.164`, `cli@0.0.196`). That deploy gate is satisfied; ONE precondition survives and is
  Part 0 below.
deploy_gate: >
  ⚠️ THE READER THAT MATTERS IS THE COUNTERPARTY'S DAEMON, NOT THE FLEET. A daemon on a build older
  than `daemon@0.0.189` reads a v2 acknowledgement as v1 and files `last_seen_hash` as a SUBMISSION
  ID — the retransmission dedup key. Two consecutive messages acknowledging the same last message
  carry the same value, so the second is answered from the first's ack, takes its sequence, and is
  never appended. THAT IS SILENT MESSAGE LOSS, NOT A LOUD REFUSAL. Confirm every live agent is
  upgraded before this ships. Part 0 is that confirmation and it is blocking.
description: >
  A sender signs `last_seen_seq`, which is a NUMBER — "I saw position 7" attests to a position and
  never to content, so the chain people believe exists is really two signatures meeting at the
  relay. Withhold the relay's half and a signed acknowledgement is an unbacked number, which is how
  a counterparty seals one message short. This unit makes production emit `last_seen_hash` and makes
  the acknowledgement hold with no relay involved at all.
---

# **<ins>MICRO</ins>** WORK ORDER 033-ACKEMIT — The acknowledgement binds to what was said

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

## What the operator lives through

Somebody does something to them in a conversation — an injection attempt, a wallet drain — and then
wants the paper trail not to contain it. Today there are two ways out, and **both work**:

- **Force close.** Refuse to take part in any closing ceremony. The victim is left with a local log
  and no notarised receipt.
- **Truncate.** Seal unilaterally at N−1, omitting the attacker's last message. Every leaf validly
  signed, nothing false — only something missing.

**Andre ruled this BLOCKS LAUNCH, 2026-09-03:** *"The receipt is the product. A path that lets the
guilty party remove themselves from it is not a papercut."*

**And his argument is the fix:** to attack you at all, they had to send you a properly formed
message, signed by them and chained to the one before. **You hold their signature.** You cannot
forge it and they cannot disown it. So you must be able to seal unilaterally **including** their
message, whatever they do afterwards.

---

## The root cause, and it is not where anyone looked first

A sender signs `Structure1`:

```
v1: [1, content_hash(32), sender_pubkey(32), session_id(16), last_seen_seq, timestamp]
```

**`last_seen_seq` is a NUMBER.** "I saw position 7" attests to a *position*, never to *content*.

So the chain people believe exists is really **two signatures meeting at the relay**: the
counterparty signs *"I saw position 7"*, and the relay's receipt (`buildRelayAckTbs` =
content_hash ‖ seq ‖ timestamp) signs *"position 7 held hash X"*. **The relay is load-bearing for the
acknowledgement itself**, not merely for ordering — which is exactly why withholding a submit breaks
it: with no receipt, a signed `last_seen_seq` is an unbacked number.

**`prev_root` does not rescue it.** It is signed by neither party and not by the relay, whose receipt
covers content hash, sequence and timestamp only.

**And only the sender ever submits a hash.** `submitMessageHash` has one production caller, on the
send path — nothing submits a hash for a message *received*. So on a direct connection a malicious
client delivers message N, never witnesses it, the relay's account genuinely ends at N−1, and a
truncated seal **agrees with the witness**.

---

## The mission in one sentence

**Production signs `last_seen_hash` alongside `last_seen_seq`, so an acknowledgement binds to what
was actually received and holds with no relay involved at all.**

---

## Where this work lives — ⚠️ YOU EDIT BOTH REPOS

- **`cello-client`** → `/Users/andrep/Documents/code/cello-client`. Paths beginning `core/…`.
  Gate: `pnpm run test` / `lint` / `typecheck` / `build` (this repo HAS a separate build).
- **`trustless-cello`** → `/Users/andrep/Documents/code/trustless-cello`. Paths beginning
  `packages/…` and `docs/…`. Gate: `pnpm run test` / `lint` / `typecheck` (typecheck IS the build
  here — there is no separate `build` script and nothing is missing).

---

## What `020-ACKHASH` already built — do not rebuild any of it

The layout is **decided and shipped as a reader**. Do not redesign it.

```
v2: [2, content_hash(32), sender_pubkey(32), session_id(16), last_seen_seq, timestamp, last_seen_hash(32)]
```

- `encodeStructure1` lives in **one** place — `core/protocol-types/src/structure1.ts` — and already
  takes an **optional** `lastSeenHash`. **Absent ⇒ v1, six fields, byte-identical to today. Present
  ⇒ v2, seven fields.** No production caller passes it. **You are that caller.**
- `decodeStructure1` is exported, branches on the **version** and never on length, and refuses an
  unnamed shape by name.
- Every reader in both repos accepts a v2 array: the relay, the directory (three sites), and the
  daemon.
- `structure1-canonical.json` pins both a v1 and a v2 vector.

**`ADD, never replace`.** `last_seen_seq` stays and keeps doing ordering and dedup work. Position and
content-binding, both signed, side by side.

---

## Part 0 — FALSIFY THREE THINGS BEFORE WRITING A LINE. Blocking.

Each of these makes the unit either smaller or unsafe, and each is checkable in minutes.

**0a — Is every live agent on `daemon@0.0.189` or newer?** See `deploy_gate` above: an older reader
files `last_seen_hash` as a submission id and the message is silently lost. Enumerate the live
agents — Andre's local daemons, the demo agent on EC2, the Hermes-side agents, `cello-hostile-client`
on GCP — and record the build each is running. **If any is behind, STOP AND REPORT.** That is stop
reason 1 (a manual operation only Andre can do). Do not ship the emitter around it.

**0b — Does the daemon already ASSEMBLE a carried leaf for a message that arrived with NO relay
ordering record?** The DoD flags this as *"check before scoping"*. The verifier would accept one —
the unilateral path is deliberately asymmetric, and **carrying the attacker's signed message with no
receipt is exactly the case the design anticipates**:

> your OWN leaves each need a relay receipt (your signature covers content, not sequence, so without
> receipts you could renumber yourself), while the COUNTERPARTY's leaves carry no receipt at all and
> are pinned by their own sender signature plus contiguity against your receipt-pinned leaves.

**If the client already builds that leaf, this requirement holds TODAY and the seal half of this
unit is nothing.** Answer it in your close-out either way, with the call site.

**0c — Does anything, anywhere, emit a submission id?** Verified 2026-09-05: `grep` for
`submissionId` / `submission_id` in `core/daemon/src/session-relay-client.ts` returns **nothing**.
`DOD-M15-SUBMIT-ID-1` widened the relay to *accept* a seven-field Structure 1 for a submission id,
but the production builder still encodes six — so its emitter half appears never to have shipped.

**This matters because from this unit onward, index 6 becomes EXCLUSIVE:** a v2 claim cannot also
carry a submission id. The two are mutually exclusive on the wire, and the shared fixture already
encodes that (`buildSeal` throws if a spec sets both). **This unit is what makes it real.** Confirm
the grep yourself and record it — if something does emit one, stop and report rather than choosing
which of the two wins.

---

## Part 1 — Emit it

**The production call site is in `core/daemon/src/session-relay-client.ts`** (the builder was
unified into the published encoder by `020-ACKHASH` Part 1; the call site passes named fields).

- Pass `lastSeenHash` on every send. It is **no longer optional in production** — a v1 emission from
  this point is a regression, not a fallback.
- The value is the **content hash of the last message this sender actually received** from the
  counterparty, taken from the same store that already supplies `last_seen_seq`. If those two ever
  disagree about which message they mean, that is the defect this unit exists to remove — assert
  they agree, do not paper over it.

## ⚠️ `last_seen_hash` IS A VALUE, NEVER AN ABSENCE

The first message of a session has seen nothing. **That case is a defined 32-byte value — not a
missing field, not a shorter array, and not a fallback to v1.**

Use `computeGenesisPrevRoot`'s output for the session (`core/protocol-types/src/session.ts` ~**497**)
— it already exists and is exactly *"the agreed starting point of this two-party chain"*.

- **Do not invent a second genesis constant.**
- **Do not use 32 zero bytes.** A constant identical across every session is one an attacker can
  present for any session.

A reader that treats an absent `last_seen_hash` as *"fine, skip the check"* recreates
`DOD-M15-AUTHORSHIP-ABSENT-1` one layer down — the fail-open where a bad proof is refused and a
missing proof is waved through. **This unit is closing that class, not adding to it.**

---

## Part 2 — Enforce it, and the relay gets this for free

**No new frame and no new wire field.** A `hash_submit` already carries `structure1_cbor` verbatim —
the identical signed claim minus the plaintext body — so the witness can enforce the chain live, the
way `DOD-M15-CORROBORATE-1` already verifies every hash on arrival rather than on request.

**The relay:** on each submit, check that the claimed `last_seen_hash` matches the content hash it
holds at `last_seen_seq` for that session. A mismatch is a **refusal by name**, and — per
`DOD-M15-NO-SILENT-REFUSAL-1` and Andre's standing rule — **the operator is told.** Not a log line
and nothing else; that was the finding `DOD-M15-RELAYABUSE-1` shipped and the Opus re-review caught.

**The counterparty daemon:** the same check on receipt, because **this is the half that needs no
relay.** It is the whole point of the fix — the acknowledgement holds bilaterally, which closes the
line at its root instead of adding a witness to work around it.

**The refusal must name what was observed, never an inferred conclusion** (`DOD-M15-ERRSTRING-1`):
"acknowledged hash does not match the message at that position", not "peer is malicious".

---

## Part 3 — The enforcer

**The journey, and it is the DoD line's own:** *a counterparty that withholds its last message
cannot produce a seal the other side's evidence does not contradict.*

Two daemons, real binaries, separate OS processes. The attacker sends message N and never witnesses
it. The victim seals unilaterally. **The receipt contains message N**, pinned by the attacker's own
signature, and the attacker's truncated account is contradicted by evidence they signed themselves.

**Reuse the fixture.** Extend `packages/e2e-tests/src/session-fixture.ts` with non-breaking `opts`
defaults. **Never write a new `makeFixture()` from scratch** — that is a blocking review finding
under `/cello-review`.

---

## Definition of Done

1. Part 0's three questions are answered in the close-out **with evidence**: the build of every live
   agent, the carried-leaf call site (or its absence), and the submission-id grep.
2. Production emits v2 on every send. **Grep proves no production path still emits v1**, and a test
   asserts the emitted bytes are seven fields with version 2 — not that "it did not refuse".
3. The first message of a session carries the **session's genesis value**, not zeros and not an
   absent field. A test pins the exact bytes.
4. The relay refuses a submit whose `last_seen_hash` does not match the content hash it holds at
   `last_seen_seq`, **by name**, and **the operator is told** — not only the log.
5. The counterparty daemon performs the same check **with no relay involved**, and a test proves it
   on a direct session with no witness at all. This is the clause the line exists for.
6. **Index 6 is exclusive:** a v2 claim carrying a submission id is refused, not coerced.
7. **The enforcer journey passes as separate OS processes**, output quoted: a withheld last message
   still lands in the victim's unilateral receipt.
8. **Each new assertion has been made to fail on purpose** (§0z.3). Revert the emitter and confirm
   the byte-shape test reddens. Revert the relay check and confirm the mismatch test reddens.
   Revert the daemon check and confirm the no-relay test reddens. Each **for the reason you
   expect**.
9. **The four hollow-test questions answered in the close-out** (§2). Ask #4 hardest: *did I assert
   the OUTCOME or the mechanism's shadow?* `not.toBeNull()` on a decode is a shadow — **name the
   value**. That exact mistake was made on `DEAD-WIRE-FIELD-1` by someone who had just read the
   four questions.
10. `protocol-types` / `daemon` / `connect` / `cli` published via **`/cello-publish` — load the
    skill, every publish is a fresh load**; `pnpm install` run, lockfile committed, and
    `packages/directory` + `packages/relay` reference the new versions.
11. Gate passes (test / lint / typecheck, plus `build` in `cello-client`) in **both** repos, and the
    change is verified present in the BUILT artifact, not only in source.
12. Reviewed by `cello-unit-reviewer`, every finding fixed, verdict quoted below.

**Not in scope, and each is its own unit:**
- **The receiver submitting a hash for what it received.** Defence in depth, explicitly *"weaker than
  the root fix and worth having anyway"* — a follow-on, not this unit. This unit closes the line at
  its root; that one adds a belt.
- **Forcing relay-only routing for high-stakes sessions.** The pairing is available (`high_stakes`
  landed in the signed assignment in `017-TBS`, relay-only routing is already an operator setting)
  and it is a policy decision, not this unit's.
- `DOD-M15-RELAYSEQ-UNSIGNED-1` — owned by `031-RELAYREPLAY`.
- Anything about relay handover, reachability, or the seal roster.

---

## Traps recorded before you start

**Shipping this before every live agent is upgraded is SILENT MESSAGE LOSS.** Not a refusal, not an
outage — a sender who sees a valid ack for a message that was never appended. Part 0a is blocking
for that reason and for no other.

**The signature is over the ENCODED BYTES, not over a re-encoding.** Never decode-and-re-encode on a
verification path. `020-ACKHASH` measured what happens when two encoders look equivalent and are
not: the daemon's copy passed `Date.now()` straight to CBOR as a **float64**, the published encoder
promotes to **uint64**, and the only canonical vector in either repo had always pinned bytes
production never emitted.

**Do not "improve" the array into a map or a discriminated union.** Both are wire changes beyond this
one and both break every existing signature. Emit the field; leave the shape alone.

**A property asserted only by a COMMENT is not asserted.** `DOD-M15-SUBMIT-ID-1`'s key was documented
as sender-scoped with no test, and the attack was reachable by ordinary participation. If you write
"this binds the acknowledgement to content", there is a test under it or the sentence comes out.

**Do not let a green gate stand in for the journey.** Vitest green ≠ done for this line — the
milestone close gate requires the live multi-process run, and the property here (a counterparty who
withholds) cannot be produced by an in-process test that controls both sides' code.

---

---

## Part 0 close-out — answered before any code was written

### 0a — Is every live agent on `daemon@0.0.189` or newer? **YES. Not a stop.**

Each row proved three separate things: the installed version, that the RUNNING process is that build
(package mtime earlier than process start), and that the v2 reader is physically in the shipped
artifact (`last_seen_hash` present in `protocol-types/dist/structure1.js`), not merely implied by a
version string.

| Agent host | daemon | protocol-types | v2 reader in `dist/` | running build proved |
|---|---|---|---|---|
| Andre's laptop | 0.0.189 | 0.0.69 | ✅ | installed 12:12:28, process started 12:15:04 |
| Hermes EC2 `i-06db70df6b3e32207` | 0.0.189 | 0.0.69 | ✅ | installed 10:13:56, process started 10:14:10 |
| `cello-hostile-client` (GCP `us-east1-d`) | 0.0.189 | 0.0.69 | ✅ | installed 10:26:24, process started 10:27:57 |
| Demo agent EC2 `i-0ad3e7c22470f266e` | — | — | — | **STOPPED — not a live agent** |

Published `latest` and `beta` both read `daemon@0.0.189` / `protocol-types@0.0.69`, so no live agent
is behind the reader.

**The connect shim is not a Structure 1 reader.** `@cello-protocol/connect@0.0.164` (the four npx
MCP shims on the laptop and the two on Hermes) contains no `structure1` or `decodeStructure1` in its
built `dist/`; positive control — the same `dist/` yields hits for `cello_send`. It proxies over IPC
and the daemon is the only decoder, so the shim version does not participate in this gate.

**⚠️ ONE THING TO HAND ANDRE, and it is not a blocker.** The demo agent is STOPPED, so it cannot be
queried and it is not live. Whatever build it holds is from before 2026-07-31. **Upgrade it before
it is next started** (`npm i -g @cello-protocol/cli@latest`, then the documented daemon-then-demo
restart) — starting it un-upgraded after this unit ships puts an old reader back on the wire, which
is the silent-message-loss case this order's `deploy_gate` describes.

### 0b — Does the daemon already assemble a carried leaf for a message that arrived with NO relay ordering record? **NO.**

Two distinct questions hide in this one, and the answers differ:

- **A carried leaf with no relay RECEIPT — YES, and it has shipped.** `session-relay-client.ts`
  stores the counterparty's leaf from `leaf_deliver` with `relay_id` / `relay_timestamp` /
  `relay_signature` all absent. That is exactly the asymmetry the design anticipated.
- **A carried leaf with no relay ORDERING RECORD — NO.** `SessionSealLeafStore.store()` has exactly
  two writers, both inside the relay client: the own-leaf site on `hash_submit_ack`, and the
  counterparty site on `leaf_deliver`. Both require the relay to have spoken, and the counterparty
  site additionally requires the relay-supplied `structure2_cbor` — which is `NOT NULL` in the carry
  schema. A message the attacker delivered over the direct content stream and never submitted
  produces **no carry leaf at all**.

**So the seal half of this unit is NOT nothing.** The consume path confirms it end to end: the
unilateral seal builds `seal_leaves` from `getSealCarry` and the local pre-flight refuses a gap with
`seal_carry_noncontiguous` — so a withheld LAST message does not even produce a gap. It truncates
the chain at N−1 and the seal proceeds, agreeing with the witness. That is the attack, intact.

**Consequence for this unit, stated rather than absorbed:** DoD clause 7's enforcer journey ("a
withheld last message still lands in the victim's unilateral receipt") needs a producer that does
not exist — building a carry leaf from the content frame's own `structure1_cbor` +
`sender_signature`, plus a directory-side verifier that accepts a counterparty leaf carrying no
Structure 2. That is a second mission and a wire change. It is written up under *Newly discovered*
and it is not built here. Everything Parts 1 and 2 describe — the mission sentence — is.

### 0c — Does anything, anywhere, emit a submission id? **NO. The grep is confirmed.**

`submissionId` / `submission_id` in `core/daemon/src/session-relay-client.ts` returns nothing;
positive control on the same file returns 30 hits for `structure1`, so the search could see.

Widened across both repos, every hit is the **M10B sealed trust-signal submission queue** — a
different concept that never touches Structure 1: `protocol-types/src/submission.ts`, the directory's
`submission_queue` table and frames, and the CLI/MCP display of them. The only Structure-1
submission-id code anywhere is the relay's READER (`relay-node.ts`, `DOD-M15-SUBMIT-ID-1`) and a
test fixture that hand-builds a v1 seven-array. **Its emitter half never shipped.**

**Index 6 is therefore free to become exclusive**, and from this unit it is: v1+7 keeps meaning
submission id, v2+7 means `last_seen_hash`, and nothing can carry both.

## Newly discovered

_(write findings here and keep going — do not fix them)_

### 1. A message that arrived with no relay ordering record can never enter a receipt — the carry-leaf producer is missing

**Found answering Part 0b; NOT fixed here.** `SessionSealLeafStore.store()` has two writers and both
live inside the relay client. The counterparty writer runs on `leaf_deliver` and needs the
relay-supplied `structure2_cbor`, which the carry schema declares `NOT NULL`. So when a counterparty
delivers a message over the direct content stream and never submits its hash, the victim holds the
message, holds the counterparty's signature over it, and **still cannot put it in a receipt** — the
unilateral seal is built from `getSealCarry`, and that message is not in it.

**What the operator lives through:** somebody says the thing they later want removed, declines to
witness it, and the victim's notarised receipt ends one message early — every leaf validly signed,
nothing false, the last thing said simply absent.

**Classification: BLOCKS LAUNCH is Andre's to grant (§0z.4), so this is written up and not claimed.**
It is the second half of `DOD-M15-WITHHOLD-SEAL-1`'s own journey, so my read is that it belongs in
the gate; the frozen-gate rule says I do not put it there myself.

**What it needs, so the size is visible rather than guessed:** a producer that builds a carry leaf
from the content frame's own `structure1_cbor` + `sender_signature`; a nullable `structure2_cbor` in
the carry schema; and a directory-side offline verifier that accepts a counterparty leaf with no
Structure 2, pinning it by the sender's signature and contiguity instead. That last part is a wire
change and it is why this is not folded into 033.

**This unit is what makes it possible.** With `last_seen_hash` signed, the victim's own next
message — and the counterparty's own subsequent acknowledgements — bind to the withheld message's
content, so a carried leaf built from the frame has something to be checked against.
