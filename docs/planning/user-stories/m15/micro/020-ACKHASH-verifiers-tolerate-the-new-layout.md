---
name: 020-ACKHASH — Every verifier accepts the v2 layout, before anything emits it
type: micro-work-order
date: 2026-09-03
status: open
blocked_on: >
  DoD 9 ONLY — the npm publish of protocol-types and the GCP fleet roll. Both are Andre's to run.
  Code, tests, gate and review are all done; nothing else in this order is outstanding. Deliberately
  NOT flipped to `complete`: a `complete` here reads as "published and deployed", and unit 021 is
  gated on this being LIVE ON THE FLEET, not merged — see the deployment section before the
  Newly discovered list for why starting 021 early costs silent message loss.
description: >
  Structure 1 gains `last_seen_hash` so an acknowledgement binds to CONTENT, not to a position.
  This unit ships the READING half only — relay, directory and daemon all accept a v2 Structure 1
  — and emits nothing. A client-first rollout would have every message in flight refused as
  `signature_invalid`. Source: DOD-M15-WITHHOLD-SEAL-1, top of the M15 priority override.
---

# **<ins>MICRO</ins>** WORK ORDER 020-ACKHASH — Verifiers tolerate the new layout

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

> ## 🚫 NOTHING EMITS THE NEW FIELD IN THIS UNIT
>
> When you finish, **every verifier accepts a v2 Structure 1 and no code produces one.** The
> production builder is untouched. If you find yourself editing the call site that signs a submit,
> you have grown the mission — stop and re-read this. Emitting is unit **021**, and it cannot start
> until this one is DEPLOYED, not merely merged.

---

## The mission in one sentence

**A sender signs `last_seen_seq`, which is a NUMBER — so "I saw position 7" attests to a position and
never to content.** Adding `last_seen_hash` makes the acknowledgement bind to what was actually
received. This unit makes every reader accept the new layout so the emitter can ship safely later.

---

## Where this work lives — ⚠️ YOU EDIT BOTH REPOS

- **`cello-client`** → `/Users/andrep/Documents/code/cello-client`. Paths beginning `core/…`.
  Gate: `pnpm run test` / `lint` / `typecheck` / `build` (this repo HAS a separate build).
- **`trustless-cello`** → `/Users/andrep/Documents/code/trustless-cello`. Paths beginning
  `packages/…` and `docs/…`. Gate: `pnpm run test` / `lint` / `typecheck` (typecheck IS the build
  here — there is no separate `build` script and nothing is missing).

---

## Background — you need exactly this much

**Structure 1 is the sender's signed claim.** Canonical CBOR, and the sender's Ed25519 signature is
over these exact bytes:

```
v1: [1, content_hash(32), sender_pubkey(32), session_id(16), last_seen_seq, timestamp]
```

The same bytes go to **both** the counterparty and the relay — a `hash_submit` carries
`structure1_cbor` verbatim, minus the plaintext body. So one field addition reaches every party.

**The new layout, DECIDED — do not redesign it:**

```
v2: [2, content_hash(32), sender_pubkey(32), session_id(16), last_seen_seq, timestamp, last_seen_hash(32)]
```

- **ADD, never replace.** `last_seen_seq` stays and keeps doing ordering and dedup work.
- **APPEND at index 6.** Every existing positional read (`content_hash` at 1, `last_seen_seq` at 4,
  `timestamp` at 5) keeps its index. Inserting mid-array would silently move `timestamp`.
- **The version tag goes to 2**, and that is what disambiguates — see the collision below.

## ⚠️ THE INDEX-6 COLLISION, and it is why the version tag decides, not the length

**The relay's decoder already accepts SIX OR SEVEN fields.** `DOD-M15-SUBMIT-ID-1` widened it so a
future client could append a *submission id* at index 6, and it shipped the tolerance ahead of any
emitter. **No client emits 7 today** — the production builder encodes 6.

So index 6 is already spoken for by a different meaning. **A length check cannot tell a
submission-id 7-array from an ack-hash 7-array.** Both decoders must therefore branch on
`arr[0]` — the version — and never on length alone. That is exactly why the version tag is field 0:
*"a v1 claim can never read as a v2 one."*

**Rule for this unit:** `length === 7 && version === 2` ⇒ ack-hash layout.
`length === 7 && version === 1` ⇒ the pre-existing submission-id tolerance, unchanged.
Any other combination ⇒ refuse by name, never coerce.

## ⚠️ WHY READING SHIPS BEFORE WRITING, and this is not caution — it is measured

`SUBMIT-ID-1` records what happens otherwise, in its own words: the decoder was `!== 6`, so *"a
client that appended a submission id had every frame refused as `signature_invalid` by any relay not
yet updated — including the one deployed. The relay therefore has to accept the new shape BEFORE any
client emits it; a client-first rollout breaks every message in flight."*

Same trap, same structure, one field over. **Reading first is the whole design of this unit.**

---

## Part 1 — Delete the duplicate builder (do this FIRST)

**There are TWO `encodeStructure1` functions and they are not the same function.**

1. `cello-client/core/protocol-types/src/structure1.ts` — the published one. Its own header says it
   *"has no production caller"* and is kept because it is the only written definition of the field
   order, pinned by `core/protocol-types/test/vectors/structure1-canonical.json`.
2. `cello-client/core/daemon/src/session-relay-client.ts` ~**226** — a second, local copy. **This is
   the one production actually uses** (called at ~**1739**).

So the canonical definition and the shipped bytes are maintained separately, and only a convention
keeps them equal. **That is the exact defect `017-TBS` just removed for the assignment TBS**, and
adding a layout to a copy-pasted builder is how it comes back.

**Do this:** delete the copy in `session-relay-client.ts`, import the published `encodeStructure1`
from `@cello-protocol/protocol-types`, and update the call site. **Behaviour must not change** — the
published encoder takes a named-field object where the local one takes positional arguments, so this
is a call-shape change and nothing else. The two encoders must produce byte-identical v1 output; the
vector file is what proves it.

**Do not change the published encoder's output in this part.** It still emits v1 when you are done.

---

## Part 2 — Teach the published encoder v2, still emitting v1 by default

In `core/protocol-types/src/structure1.ts`:

- `STRUCTURE1_VERSION` stays `1`. Add `STRUCTURE1_VERSION_V2 = 2`.
- `encodeStructure1` gains an **optional** `lastSeenHash`. **Absent ⇒ v1, six fields, byte-identical
  to today. Present ⇒ v2, seven fields.** No caller passes it in this unit.
- Add a decoder — `decodeStructure1` — returning the named fields plus `lastSeenHash: Uint8Array |
  null`, branching on the version as ruled above. **It is exported**, because three of the readers
  below currently hand-roll their own array destructuring and the next layout change should not have
  to find them again.
- Extend `structure1-canonical.json` with a **v2 vector**. The v1 vector's bytes must not change.

## ⚠️ `last_seen_hash` IS A VALUE, NEVER AN ABSENCE

The first message of a session has seen nothing. **That case is a defined 32-byte value, not a
missing field and not a shorter array.**

Use `computeGenesisPrevRoot`'s output for the session — it already exists in
`core/protocol-types/src/session.ts` (~**497**) and is exactly "the agreed starting point of this
two-party chain". Do not invent a second genesis constant, and **do not use 32 zero bytes** — a
constant identical across every session is one an attacker can present for any session.

**Why this matters more than it looks:** a v2 array that omits the field, or a reader that treats an
absent `last_seen_hash` as "fine, skip the check", recreates `DOD-M15-AUTHORSHIP-ABSENT-1` one layer
down — the fail-open where a bad proof is refused and a missing proof is waved through. This unit
must not ship that shape while another unit is removing it. It is the same trap `017-TBS` records:
`high_stakes: false` and `prior_relay_id: ""` are values, not absences.

---

## Part 3 — Every reader accepts v2

**All of these currently assume six fields, or destructure positionally, or both.** Each must accept
a v2 array and keep reading the fields it already reads at their unchanged indices. **None of them
gains a new check on `last_seen_hash` in this unit** — reading is not yet enforcing.

**`trustless-cello`:**

- `packages/relay/src/relay-node.ts` ~**278** (`decodeStructure1`) — currently `length !== 6 &&
  length !== 7`. Becomes version-aware per the rule above. Used at ~**1916**.
- `packages/directory/src/directory-node.ts` ~**6983** (`decodeStructure1Fields`) — currently
  `length !== 6`, so **it refuses a 7-array outright today.** Callers at ~**5074** and ~**5640**.
- `packages/directory/src/seal-legibility.ts` ~**49** (`decodeSignedLastSeenSeq`) — reads index 4.
  Index is unchanged; the length assumption is not.
- `packages/directory/src/seal-final-root.ts` ~**229** (`decodeStructure1Signed`).

**`cello-client`:**

- `core/daemon/src/session-node-manager.ts` — positional decodes at ~**774**, ~**3096**, ~**4599**,
  ~**7566**, ~**9464**, ~**13232**.
- `core/daemon/src/sealed-leaf-set.ts` ~**82**.
- `core/daemon/src/seal-frontier-verify.ts` ~**55–60**.
- `core/daemon/src/session-relay-client.ts` ~**754** (`#isOwnLeaf`), ~**779** (`#captureReceipt`).

**A reader that silently ignores an unknown array length is not "tolerant", it is a fail-open.** A
length or version this build cannot name is refused **by name**, exactly as
`seal-unilateral-verify.ts` refuses an unlisted leaf kind rather than coercing it.

---

## Definition of Done

1. `encodeStructure1` exists in **one** place. `session-relay-client.ts` imports it; its local copy
   is gone; the production call site passes named fields.
2. `encodeStructure1` with no `lastSeenHash` produces **byte-identical** output to today, proven
   against the unchanged v1 vector.
3. `encodeStructure1` with a `lastSeenHash` produces the v2 seven-field array, pinned by a new
   vector.
4. `decodeStructure1` is exported from `protocol-types`, branches on the **version** and not on
   length, and refuses an unnamed shape by name.
5. Every reader in Part 3 accepts a v2 array and returns the same values it returns today for the
   fields it already reads.
6. **A v1 seven-array (submission id) still decodes exactly as it did before.** This is the
   regression that would break the deployed relay.
7. **Each new assertion has been made to fail on purpose.** Revert the version branch and confirm it
   reddens for the reason you expect. Widen a length check to `>= 6` and confirm the refusal test
   catches it. A tolerance test that cannot fail is the one thing this unit must not ship.
8. **Nothing emits v2.** Grep proves it: no production caller passes `lastSeenHash`.
9. `protocol-types` published via `/cello-publish` — **load the skill, every publish is a fresh
   load** — `pnpm install` run, lockfile committed, and `packages/directory` + `packages/relay`
   reference the new version.
10. Gate passes (test / lint / typecheck, plus `build` in `cello-client`) in **both** repos.
11. Reviewed by `cello-unit-reviewer`, every finding fixed, verdict quoted below.

**Not in scope:** emitting the field; verifying that `last_seen_hash` matches anything; the relay
enforcing the chain; the receiver submitting hashes for messages it received; anything about seals.
Those are later units and building them here grows the mission.

---

## Traps recorded before you start

**The duplicate builder is the whole reason Part 1 comes first.** Add the layout to the daemon's
local copy and the published definition drifts silently — no type error, tests green, and the vector
file goes on pinning bytes nobody emits.

**Do not "improve" the array into a map or add a discriminated union.** Both are wire changes beyond
this one and both would break every existing signature. Add the field; leave the shape alone.

**The signature is over the ENCODED BYTES, not over a re-encoding.** Never decode-and-re-encode on a
verification path — the relay's own comment says the encoded bytes are what gets signed and sent.

**A tolerance test that only tests the happy path is vacuous.** The load-bearing tests are the
refusals: an unknown version, an unknown length, and a v1 seven-array that must still work.

**Deployment is not merge.** Unit 021 cannot start until this is live on the fleet. Say so in your
close-out.

---

## Review

`cello-unit-reviewer`, one pass, read-only, no model override. Verdict quoted:

> **SPEC: DEVIATIONS FOUND** — Part 1's *"the two encoders must produce byte-identical v1 output"* is
> deviated. Journaled in commit `d0f3b72` with correct reasoning I independently verified, so it is
> **legal, not blocking** — but rule 3 puts findings in the order's *Newly discovered* section, and it
> is not there. Write it in before the `status:` flip.
>
> **NO SILENT FALLBACKS** — none at HIGH. Two at LOW.
>
> **ERROR SUBSTITUTION FOUND** — F2 and F3, three sites. [blocking] per the rubric: they send the
> operator to the wrong subsystem, and two of them are `catch` blocks naming a cause that can no
> longer occur inside them. All three are one-line renames.
>
> **HOLLOW TESTS FOUND** — F4, one test, [blocking] as a test-quality gap. Every other new test
> survives THE REVERT TEST; the refusal tests and the two v1-seven-array regressions are genuinely
> load-bearing and go red under exactly the mutation that would break the deployed fleet. F5 is a
> separate coverage gap: the encoding production now emits appears in no server-side test.
>
> **REMOVALS PROVEN** — both repos grepped, the `exports` map checked (no subpath export existed),
> the built artifact confirms no orphan, and no test was deleted — the eight were re-pointed.
>
> **NO COMPATIBILITY DEBT** — the v2 branch names the deployment fact that retires it; the float64
> tolerance is live data, not an old version.
>
> **Scope:** you did not grow the mission.

Both judgement calls were independently re-derived and upheld — the reviewer ran the encoder bytes
rather than trusting the commit message, and enumerated all five signature-verification sites to
confirm nothing re-encodes.

**All nine findings dispositioned.** Fixed: F1 (a tenth reader, missed by this order's own list),
F2/F3 (three errors naming their exit point), F5 (the uint64 encoding had no server-side test; the
one test meant to mirror the relay's decoder used `Number()`, which erased the type and is why the
drift survived), F6 (a reason code in a field named `error`), F7 (two undocumented narrowings), F8
(a comment calling the dangerous direction "conservative"), plus the Decision-2 comment that claimed
every consumer compares `session_id` — false for `#captureReceipt`. Deleted: F4, a test that passed
with this unit reverted AND with 021 landed. Recorded not fixed: F9 (below).

## ⚠️ DEPLOYMENT: MERGING 021 EARLY IS SILENT MESSAGE LOSS, NOT A LOUD REFUSAL

The reviewer sharpened this order's own rationale, and the correction matters more than the original.
This order says a client-first rollout means *"every message refused as `signature_invalid`."* **For
this field that is wrong, and the truth is worse.**

The relay as deployed today accepts ANY `protocol_version` and validates index 6 as `1..32 bytes` —
**a 32-byte ack hash passes that.** So a v2 emitter is not refused by the current fleet. It is
accepted, ordered, and its `last_seen_hash` is filed as a **submission id**, which is the
retransmission dedup key (`relay-node.ts` ~2120-2144). Two consecutive messages acknowledging the
same last message from the counterparty — the commonest shape in any conversation — carry the same
`last_seen_hash`, therefore the same dedup key. The second is answered from the first's ack, takes
the first's sequence, and **is never appended to the relay's tree.** The sender sees a valid ack; the
message is gone from the transcript.

So **021 cannot start until this is DEPLOYED on every node**, not merely merged, and the reason is
silent message loss rather than a visible outage.

## Newly discovered

## Newly discovered

_(write findings here and keep going — do not fix them)_

- **⚠️ SPEC DEVIATION — RULED BY ANDRE 2026-09-03, SETTLED, DO NOT RE-OPEN. The canonical uint64
  encoder wins; the wire timestamp moves float64 → uint64.** Presented as three options (keep the
  published encoder / make it match what production actually emitted, editing the canonical vector to
  bless the drift / restore the duplicate builder). He chose the first. The reasoning that decided it:
  nothing anywhere reads `.timestamp`, every decoder in both repos already accepts either form, and
  signatures cover the bytes as sent so no stored message is affected — making the alternative a
  permanent documentation cost paid to avoid a change with no reachable consequence.

  **The two encoders were NEVER byte-identical, so Part 1's "behaviour must not change" could not be
  satisfied as written.**
  The daemon's local copy passed `Date.now()` straight to CBOR, which encodes an integer above
  2^32-1 as a **float64** (`fb4278bcfe56800000`); the published encoder promotes to a **uint64**
  (`1b0000018bcfe56800`), the same idiom `buildSessionEstablishmentTbs` uses. Measured, not inferred.
  **`structure1-canonical.json` has always pinned the uint64 form — so the only vector in either repo
  was pinning bytes production never emitted.** Importing the published encoder therefore moves the
  wire timestamp float64 → uint64. Kept, because the alternative is editing the canonical vector to
  ratify the drift. Verified inert: all five signature-verification sites across both repos verify
  over the bytes as received or stored and never re-encode; every decoder guards `number | bigint`;
  and **nothing anywhere reads `.timestamp`** — the relay reads `session_id`, `content_hash`,
  `sender_pubkey`, `last_seen_seq`, `submission_id`; the directory reads `content_hash` and
  `last_seen_seq`; the daemon reads none. Old float64 leaves in local SQLCipher DBs and relay state
  still verify and still decode.

- **Daemon test fixtures build session ids no relay would accept.** ~20 files under
  `core/daemon/src/__tests__` use a 32-byte session id (`"cc".repeat(32)`); others use the canonical
  16. The wire contract is 16 bytes and both the relay and the directory refuse anything else, so
  those leaves could not survive production. Found because a first cut of `decodeStructure1`
  validated the width and reddened two SEALWIRE authorship tests. Not fixed: enforcing the width
  client-side is a new refusal unrelated to v2, and correcting the fixtures is a separate unit.

- **`seal_payload_malformed` names the wrong subsystem.** In `seal-final-root.ts`, an undecodable
  `structure1_cbor` returns `SEAL_FINAL_ROOT_REASONS.PAYLOAD_MALFORMED` — documented as *"the payload
  bytes are not a decodable SEAL payload"* — when nothing has looked at a SEAL payload. The `detail`
  string is accurate; the reason code is not. Pre-existing; 020-ACKHASH only widens what reaches it
  (an unnamed version now lands there too). Not fixed here: a new reason code ripples into
  `SEAL_FINAL_ROOT_GUIDANCE` and its consumers. The test asserts the detail string so the mislabel
  cannot quietly become about something else.

- **Reviewer F9, for a follow-up unit's AC, not a defect in this one:** trustless-cello now has FOUR
  hand-rolled version branches (`relay-node.ts`, `directory-node.ts`, `seal-final-root.ts`,
  `seal-legibility.ts`) and they already disagree — session-id width enforced in two of four, index-6
  tail validated only by the relay, a `bigint` `last_seen_seq` accepted only by `seal-legibility`.
  Correctly sequenced (the shared decoder cannot be imported until the publish lands), but the stated
  reason for exporting `decodeStructure1` — *"the next layout change should not have to find them
  again"* — is unrealised on exactly the side that had three hand-rolled readers. It should become an
  explicit AC on a follow-up rather than an implication.

- **For the planner, before 021 starts — index 6 becomes EXCLUSIVE.** From 021 onward a v2 claim
  cannot also carry a submission id: the ack hash and the `SUBMIT-ID` dedup key are mutually exclusive
  on the wire. The fixture encodes this (`buildSeal` throws if a spec sets both). 021 is the unit that
  makes it real.

- **Filed by the planner before the unit started, do not investigate:** `DOD-M15-SUBMIT-ID-1`
  widened the relay to accept a seven-field Structure 1 for a submission id, but the production
  builder still encodes six — so the emitter half appears never to have shipped. Whether that is
  deliberate staging or a dropped half is a question for a separate unit.
