---
name: 029-AUTHORSHIP — No passport, no entry
type: micro-work-order
date: 2026-09-04
status: complete
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

Paired worktree, branch `m15/029-authorship` in both repos:
`/Users/andrep/Documents/code/m15-029/cello-client` and
`/Users/andrep/Documents/code/m15-029/trustless-cello`. **No Postgres was brought up** — this unit is
entirely client-side, so neither `COMPOSE_PROJECT_NAME` nor `CELLO_PG_HOST_PORT` was needed.
`/Users/andrep/Documents/code/m15-029` was added to `.claude/settings.local.json` before the
worktrees were created.

### What changed, in one paragraph

**Send:** `#signOwnContentClaim` builds and signs a v1 Structure 1 for every outbound content frame,
including the relay-degraded path where no submit happens, and the frame carries `sender_signature`
beside `structure1_cbor`. `structure2_cbor` is DROPPED whenever we build our own — the relay's
committed copy of the signature verifies only against the exact Structure 1 that was submitted, so
pairing it with a locally built one would freeze an honest counterparty. **Receive:**
`#verifyAuthorshipClaim` is the single verifier for both callers and takes the signature as an
argument rather than digging it out of a structure, which is the whole of the fix. Missing,
unreadable, and signed-over-other-content take one path — refused by name, not ingested. Both FATAL
verdicts still freeze. `#recordFrameOrdering` answers only the question it is named for; its
authorship fields had one consumer and it no longer reads them.

### DoD 3 — the refusal, proved

`★ NO sender_signature: refused BY NAME, not ingested, and the operator is told` drives the real
inbound handler with a frame that is perfect except for the signature. The operator's notice:

> **STOPPED ON PURPOSE. This copy was refused and the message itself was not kept. IT MAY STILL REACH
> YOU BY THE OTHER ROUTE: refusing sends back no acknowledgement, so their agent parks a copy in the
> relay mailbox and this side accepts that one on the strength of the mailbox envelope — delivered,
> but with no proof of who wrote that individual message. Almost always their CELLO build is older
> than this one… Ask which version they are running, and tell them to upgrade… If they are on the
> SAME version as you, that explanation does not hold: confirm with them OUT OF BAND before opening
> another session.**

It reaches BOTH operator doors — `cello_check_notifications` (`takeAgentContentRefusals`) and
`cello_receive` (`takeContentRefusals`) — as well as the `session.content.refused` ERROR. It does
**not** freeze: `★ absence REFUSES the message; it does NOT freeze the session`.

### DoD 4 — position stays soft, proved

`★ a valid signature with NO structure2_cbor is ACCEPTED and ingested` — no refusal, one received
transcript row, and `session.content.ordering.absent` still fires, now naming POSITION. The
daemon-004 sibling proves the same thing through `LoopbackFakeNode` with a real counterparty
keypair. **Mutant M7** (make Structure 2 mandatory) reddens four tests across both files, which is
what makes this clause load-bearing rather than stated.

### DoD 6 — the mutation loop

`/tmp/claude-501/mut029-final2.log`. Refuses a dirty tree (`git status --porcelain`), prints a
baseline (35 passed) before the first mutant, typechecks every mutant, and records WHICH assertion
reddened. **Nine mutants, nine CAUGHT:**

| Mutant | Caught by |
|---|---|
| M1 absent proof waved through (**the load-bearing one**) | the passport case is ingested again; refusal notice absent |
| M2 unreadable Structure 1 → soft unmatched signer | `★ an UNREADABLE structure1_cbor is refused` |
| M3 `sender_signature` dropped from the outbound frame | `★ the frame still carries structure1_cbor + sender_signature` |
| M4 no local signing on the relay-degraded path | same, plus the identity-key test |
| M5 content-hash binding dropped | `★ a signature over DIFFERENT content is refused` |
| M6 a refuted proof refuses instead of freezing | 5 tests across both files |
| M7 position made mandatory | 4 tests — the DoD 4 guard |
| M8 the park reconciliation silenced (review H1) | `★ the refused message arrives via the relay mailbox` |
| M9 the sent row loses its proof again (review M3) | `★ … the frame still carries…` (authorship assertion) |

**M1 needed widening to compile**, and the first run recorded it as `DOES NOT COMPILE — proves
nothing` (rule 4). The guard being deleted is also what NARROWS `s1Cbor` for the call below it, so
the mutant is applied as a pair with the cast that narrowing used to supply. The reviewer flagged
that the claim was not backed by the log; it is now — the loop applies the pair itself and the
recorded verdict is CAUGHT.

### DoD 8 — the gate, and what publishes

`vitest run` 4,879 passed / 11 skipped across 427 files; `eslint core/*/src` clean;
`pnpm run typecheck` (`tsc --build` + six test projects) clean. An earlier full run had two failures
— `core/cli` `commands.test.ts` login and `core/daemon` `binary.test.ts` — both fixed wall-clock
waits on spawning the daemon binary while three lanes ran suites concurrently; both passed in
isolation and pass in the final run. Neither path is touched by this diff.

**This publishes.** It is a client-side wire change: `sender_signature` is a new top-level key on
`content_frame`, a client↔client frame the relay never sees. **No directory or relay roll is
needed** — the directory's seal verification reads `s2.sender_signature` out of Structure 2 and is
untouched. The cascade is `/cello-publish` for cello-client (load the skill, every publish), and
**both of Andre's agents must take the new build** — they are on different machines (laptop and the
Hermes EC2 box). Emit and enforce ship together, per Part 3: a skewed pair costs a NAMED REFUSAL,
not silent loss.

### DoD 9 — the reviewer's verdict, in its own words

`cello-unit-reviewer`, one pass, no model override. It was killed mid-run by a session rate limit
and resumed; the verdict below is from the completed run.

> **SPEC: DEVIATIONS FOUND** — clause 3 (H1, `[blocking]`: refused on the direct path, ingested
> through park, with an operator notice asserting the opposite) and clause 6 (the load-bearing
> mutant's proof is not in the recorded evidence; the property holds by inspection, the record does
> not).
>
> **SILENT FALLBACKS FOUND** — H1 is `[blocking]`: the direct-path refusal is announced and the
> park-path admission is not, so the weaker guarantee is indistinguishable from the stronger one and
> the announcement is actively false. M3 is the quieter half of the same shape.
>
> **ERRORS NAME THEIR CAUSE** — four distinct upstream conditions, four distinct surfaced names…
> No error substitution anywhere in this diff.
>
> **HOLLOW TESTS FOUND** — T1 `[blocking]`: "★ absence REFUSES the message; it does NOT freeze the
> session" is green on `origin/main` and **does not survive the revert test**. T2 is a
> self-comparing tautology. Every other new test survives the revert test.
>
> **REMOVALS PROVEN** — deadness established by call-site enumeration on a private method plus an
> unchanged public wrapper, cross-checked against both repos and the `exports` map, not by a grep of
> the symbol.
>
> **COMPATIBILITY DEBT FOUND** — LOW only: no live branch exists for an older version, but four
> comments (H2) and one reason-string collision now describe a shape the code left behind.

**Findings and disposition — 2 blocking, 8 total. Every one fixed except M4, which is a new item:**

| | Finding | Disposition |
|---|---|---|
| **H1** | `[blocking]` the refusal announced "nothing was stored" while the park route delivers the same message | **fixed** — guidance rewritten to say what is true of this path; content-hash-keyed memo fires `content.recover.authorship_refusal_reconciled`; park path deliberately unchanged. Mutant M8. |
| **T1** | `[blocking]` the no-freeze test was green before the fix | **fixed** — it asserts the refusal too |
| **H2** | four comments still named `#recordFrameOrdering` as the verifier, incl. the `sender_sig` column | **fixed** — all four rewritten, none deleted |
| **M3** | the sent row dropped the proof this unit had just produced | **fixed** — `sentAuthorship` set from the local claim, verified before stored. Mutant M9. |
| **M4** | the authorship claim is not bound to the SESSION id | **NOT fixed — new item, see below** |
| **L5** | refused content discarded with nothing said about it | **fixed** — the guidance says the message was not kept |
| **L6** | `B_PUB` held alice's own key on a session with no peer | **fixed** |
| **L7** | two `#recordFrameOrdering` arms unreachable from the content caller, live from park | **no action, by design** — recorded so nobody deletes them |
| **T2** | an assertion comparing a constant to itself | **fixed** |
| **T3** | `hasStructure1` / `hasSenderSignature` unasserted | **fixed** — new test |

One test outside the reviewer's list also had to be rewritten, caught by the suite after the M3 fix:
`★ an UNWITNESSED send stores no proof` asserted the world this unit changed. Rewritten, not
deleted — the half it was really protecting (never a placeholder that makes an unprovable row look
provable) is now held by a verify rather than a null check.

## Newly discovered

*Found and NOT acted on, per rule 3. **The §0z.2 spawn trip-wire is TRIPPED — three items**, and
Andre ruled on all of them: item 3 shipped as `029b`, items 1 and 2 as `029c`, and item 4 — the
only one needing a hostile relay — stays open by his explicit exclusion. Item 5 is a note, not a
defect. The vein
is producing PRODUCTION DEFECTS, not test hygiene: all of these are live behaviours an operator or a
counterparty can reach.*

**1. The inbound encryption refusals file no inbox notice — the operator never sees them.**
`session-node-manager.ts`'s content-stream handler refuses three ways before authorship is ever
checked — `content_encryption_absent_or_unknown`, `no_session_key`, `decrypt_failed`. All three log
at ERROR with a good `impact` and `guidance`, and **none of them calls `noteContentRefusal`**, so
none reaches `cello_receive` or `cello_inbox`. From the operator's chair the conversation simply
goes quiet and they conclude the other person stopped replying — which is precisely the defect
`DOD-M15-NO-SILENT-REFUSAL-1` exists to close, in the same file, on the same path, three refusals
above the one this unit added. **Classification: POST-LAUNCH** under §0z.4 — it is a missing surface
on an existing correct refusal, not a security hole a customer reaches, and the forensic record is
intact.

> ### ✅ **RULED IN AND BUILT — Andre, 2026-09-05: *"Fix all but the one that needs a hostile relay."*** (branch `m15/029c-silent-refusals`, merged)
>
> All three now file a refusal notice as well as the ERROR, through one `#refuseInboundContent` doing
> both surfaces. Five of the six new tests are RED against `main`, so the notice genuinely reached
> nobody before. The forensic ERROR is asserted too — a "fix" that moved the sentence out of the log
> into the notice would satisfy the operator and destroy the record.
>
> **What the review caught, and it is the part worth keeping.** The new wording told the operator a
> refused message may still arrive through the relay mailbox. Opening a mailbox copy needs
> `KeyProvider.openContentSeal`, which is OPTIONAL — a threshold or signing-only provider does not
> implement it, an agent loaded without a provider has none, and `content-park.ts` refuses both. That
> is the SAME condition `no_local_identity` reports. So on the one refusal that names a missing local
> identity, **both routes are shut by one cause, permanently**, and the operator was told to wait for
> a delivery that could never run — `DOD-M15-AUTHORSHIP-ABSENT-1`'s own H1 defect, one refusal up the
> same function. The sentence is chosen from `#mailboxRouteAvailable` now, and the alternative says
> so plainly. **The test that let it through asserted the sentence was PRESENT, never that it was
> true.**
>
> Also fixed from that review: the promise is closed by a reconciliation the two sibling refusals
> already had (`content.recover.refusal_reconciled`, widened from the authorship-only one); the
> receive path had been showing SEND-path guidance, so an operator who could not open an incoming
> message read advice about their own outbound mail; and a content-key fault reported itself as
> `direct_send`, sending the operator to inspect a connection that was working.
>
> **And it turned up a live defect on `main` that had nothing to do with this item.** The
> `DOD-M15-AUTHORSHIP-ABSENT-1` refusal notice — the one this order quotes verbatim as its DoD 3
> evidence — was reaching operators beginning `NaNcopy in the relay mailbox…`. Splitting that
> guidance in two dropped a string literal and left the `+` that had joined it, which is a UNARY PLUS
> on the next string: `+"REACH YOU BY…"` is `NaN`. The only assertion on it was `/upgrade/i`, and
> "tell them to upgrade" survives at the tail — so a substring match stayed green on a sentence that
> had lost its head. It now pins what the notice OPENS with.

**2. The send path reads the session key, then seals the body several `await`s later.**
`#contentEncryptionState` is read once; `#openContentStream` (and now the signing) run between that
read and `sealSessionContent`. A content key agreed with the counterparty inside that window leaves
this side sealing under the key it captured while the far side has moved on, and **every message is
refused as `decrypt_failed`** — a false tamper report on honest content. Measured, not reasoned
about: it is what reddened four live-libp2p fixtures here, and both daemons logged
`session.key.agreed` before the refusal. Signing was moved above the key read so this unit does not
widen the window, but the window is pre-existing and still open. **Classification: POST-LAUNCH** —
it needs a real re-key mid-send to fire, which today happens only in the first seconds of a session.

> ### ✅ **RULED IN AND BUILT with item 1** (same branch, merged)
>
> The key is read in the statement immediately before `sealSessionContent`, with nothing between
> them. The pre-stream check stays as a fail-fast preflight — failing before a stream is opened is
> worth one extra read — and a key that vanishes between the two throws with its own named cause, so
> a log reader can tell "never had one" from "had one and lost it mid-send".
>
> The test drives the re-key from INSIDE `newStream`, which is where the `await` sits and the only
> place a test can stand to see this (a non-breaking `onNewStream` hook on the fixture's `FakeNode`).
> It asserts what the counterparty experiences: the body opens under the key that was current when it
> was sealed, and not under the one the send started with. RED against the previous commit.
>
> ⚠️ **IT CLOSES THE LOCAL WINDOW, NOT THE CLASS.** The sender still seals at T and the receiver
> decrypts at T+flight, so a re-key landing in THAT interval produces the same false tamper report.
> What is removed is the half this side controls; the rest is a property of there being two machines.

**3. The authorship claim is bound to the content and the signer, and NOT to the session** (review
M4). `decodeStructure1` yields `fields.sessionId` and nothing compares it to the session the frame
arrived on, so a claim the counterparty signed in session X verifies unchanged in session Y for the
same content hash — a message they really wrote, replayed into a different conversation with them.
Inherited from `#recordFrameOrdering`, which never checked it either, but this unit is the moment
that claim became the only thing standing between a message and the transcript, so the missing
binding is now load-bearing. The tell is visible in the diff: `#signOwnContentClaim` encodes the
full session id while the new test fixture encodes `subarray(0, 16)`, and nothing notices, because
the field is unread.

> ### ✅ **RULED IN AND BUILT — Andre, 2026-09-04: *"Do it now."*** (branch `m15/029b-session-binding`, merged)
>
> **Proved before enforced, because getting it wrong refuses every message on every live session in
> both directions.** The signed value and the compared value derive from ONE session id per side, by
> construction: initiator `sessionId = hex(assignment.session_id)` + `relayParams.sessionIdBytes =
> assignment.session_id`; responder `acceptSession(parsed.sessionIdHex)` +
> `sessionIdBytes = Buffer.from(parsed.sessionIdHex,"hex")`; direct/persisted
> `relaySessionIdBytes = Buffer.from(sessionId,"hex")`. The two names exist because one keys the
> in-memory maps and one goes on the wire. The reviewer attacked this proof hardest and it stood.
>
> `#verifyAuthorshipClaim` compares the signed `session_id` against the session's own, and a
> mismatch is **refused by name (`authorship_wrong_conversation`), not frozen** — the signature
> verified and the signer is the counterparty; what is wrong is the conversation.
>
> **The review's blocking finding was the ORDER, and it is the part worth remembering.** The binding
> ran BEFORE the signature was verified. Everything returning `unusable` refuses the message and
> lets the session live; everything returning `refuted` freezes it. So a peer could pick the softer
> outcome — a garbage signature, or a valid signature by a MITM's own key, PLUS one flipped
> unauthenticated byte of `session_id` — and the freeze never fired. **The session-open MITM
> detection was switchable off by the party it exists to detect.** Order is now decode → SIGNATURE →
> SIGNER → what the proof is about, matching `seal-frontier-verify`. Measured red against the
> pre-fix source, not argued.
>
> Second blocking finding: the replay reached the operator under the generic wording — *"unreadable,
> or signed over different content"* (neither true) and *"tell them to upgrade"*. A replayed
> signature is not a version problem. It has its own impact and guidance now, naming out-of-band
> confirmation, and a test asserts the guidance does NOT mention upgrading.
>
> **Five fixtures were signing a session id that was not the session's — three of them 16 ZERO
> bytes.** They sign the real id now, which is what production signs. Eleven mutants, eleven caught.
> Gate: 4,881 tests, lint, typecheck.

**4. The relay leaf handler reads a counterparty Structure 1 without binding the session** (found by
the `029b` review). `session-node-manager.ts` decodes a relay-delivered counterparty leaf and calls
`recordWitnessedSequence` on it without comparing `session_id` — so a malicious or confused relay
could set a witnessed position from a leaf belonging to another conversation. Pre-existing, gated
behind trusting the relay, and outside `029b`'s stated scope. Recorded because `029b` established
that read everywhere else and this is the one place it did not reach. **Classification:
POST-LAUNCH** — it needs a hostile relay, and the position it corrupts is soft by design.
**Andre, 2026-09-05: explicitly EXCLUDED** from the 029c batch — *"fix all but the one that needs a
hostile relay."* It stays open, and it is the only one of the four that does.

**5. What the park path passes** (not a defect — the order asked for this explicitly). `recordOrderingRecord`
(`source: "park"`) calls `#recordFrameOrdering` only when the envelope carries BOTH
`structure1Cbor` and `structure2Cbor`, and consumes `.seq` alone; it never read the authorship
fields, which is what made removing them a clean deletion. The park envelope has no
`sender_signature` field of its own — recovered mail proves its sender by the envelope's signature
over `(session_id, recipient_pubkey, content_hash)`, verified in `authenticateParkedEntry` before
anything is unsealed. The mandatory-signature rule was NOT extended there, per the order.
