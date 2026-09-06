---
name: M15 Public Comment Sweep
type: worklist
date: 2026-09-06
topics: [m15, disclosure, public-repo, comments, security, pre-launch]
status: open
description: >
  Every comment in the PUBLIC cello-client repo that tells a reader something is open, unenforced,
  or fails open. Classified into leave-alone, stale, tracked, and untracked, with the action for
  each. Built so another coding agent can work it item by item without re-deriving the judgement.
---

# The public comment sweep

## Why this list exists

`cello-client` is a public repo. Its comments are unusually dense and unusually candid — that is
deliberate and it is an asset: half of `session-node-manager.ts` is prose explaining why each check
exists, much of it recording a defect that was reintroduced once already, and that prose is what
stops the next refactor quietly deleting a guard.

**The risk is not candour. It is one specific class of comment.**

An evaluator will point a coding agent at this repo before trusting it, and that agent will collect
every sentence of the form *"this is not enforced"*, *"it fails open"*, *"nothing checks this"* into
a single list and hand it over. Three of those four categories are fine. One is not.

| | What it is | Public reading | Action |
|---|---|---|---|
| **A** | A fail-open that is **deliberate, bounded, and says why** | Reads as rigour | **Leave alone** |
| **B** | Describes a gap that has **since been closed** | Advertises a hole you already fixed. The worst kind | **Rewrite** — see the reattachment rule |
| **C** | A **live** gap that is **tracked** | Fine — provided the reader can see it is tracked | Name the designation |
| **D** | A **live** gap that is **not tracked anywhere** | This is a disclosure | File it, then decide |
| **E** | A **step-by-step attack recipe** for a fixed bug | Hands an attacker the method | Keep the finding, cut the recipe |
| **F** | **ORPHANED** — detached from the code it describes | Documents the WRONG member, confidently | **Reattach**, never delete |

### F — ORPHANED comments: added 2026-09-06, found by 036/037-GODFILE

**A category the phrase-based search cannot find, because the sentence is not wrong — it is in the
wrong place.** A doc block gets separated from its member (a method moves, something is inserted
between them), and it then documents whichever member it now sits above.

**Why it earns its own row rather than being filed as untidiness:** a misplaced comment is a local
nuisance while both members are in one file, and becomes a LIE the moment a refactor moves one of
them. Three were found, and one had inverted meaning:

- `session-leaf-records.ts` — *"Never returns null; an unknown session yields an empty tree"* had
  drifted off `getSessionTree` and travelled into a new module, landing above a method whose whole
  contract is returning `undefined` on a miss. The next reader of the genesis code would have read
  the exact inversion of what its own comments spend twenty lines protecting.
- `session-node-manager.ts` — `ingestReceivedContent` and `#markContentUnverifiable` had NO leading
  doc at all; both their blocks were stacked hundreds of lines away above a third method.
- `witness-alerts.ts` — a cap's rationale stayed behind and read as documentation for the wrong
  method.

**How to find them, since grep cannot — and the detector needs calibrating, so here it is measured
rather than asserted.** The cheap mechanical check is two `/** … */` blocks with no code between
them. Run across `core/daemon/src` it returns **~150 candidates, and most are FALSE POSITIVES**: two
blocks layered on one statement *inside a method body* is a deliberate and common style here, not an
orphan.

**The actionable form is narrower: two blocks with no code between them AT CLASS-MEMBER LEVEL.**
That is where a real orphan lives, because the second block is the one the member actually gets and
the first is documenting nothing.

**Then confirm semantically before acting** — does the first block's subject match the member below
it? `held-content.ts` had `@returns true iff the UPDATE was executed` sitting above a method
returning `void` that runs no UPDATE: mechanically flagged, and only reading it proved it.

⚠️ **AND IF THE OWNER CANNOT BE IDENTIFIED, MARK IT — DO NOT GUESS.** Attaching an orphan to a
plausible-looking neighbour is the same defect as leaving it, with the evidence destroyed. One in
`held-content.ts` is marked exactly that way: nearest candidate named, explicitly not attached.

**Action: reattach to the member it describes.** Never delete: the prose is usually correct, and it
is the member it points at that has moved.

## How to use this list

**One item per session. Do not batch.**

For each item:

1. **Verify the classification before acting on it.** The verdicts below were reached by reading the
   comment and its surroundings, not by proving the code. Several say *verify* explicitly. A wrong
   B-verdict rewrites a comment into a lie, which is worse than the comment.
2. **Apply the action for its category.** The categories are not interchangeable; the whole point of
   the split is that three of them are "do nothing".
3. **The reattachment rule — REVISED BY ANDRE 2026-09-06, and the revision narrows it.**

   The rule used to be *"never delete a comment that records a defect; keep the record of what it
   did before."* **That is too broad and it is how these files bloat.** `git log -p` on any line
   already gives the old text, the commit that changed it and the reasoning in the message.
   Duplicating that in the file is a diary, and a diary earns no lines.

   > **Keep the reasoning only when a competent person would plausibly make the same mistake again.
   > Otherwise fix the comment and let git hold the history.**
   >
   > **And when you keep it, write it as a RULE, not a memoir** — *"these checks must stay in this
   > order, because…"* rather than *"this used to be wrong."*

   Two real examples from this codebase, to calibrate:

   - ✅ **Keep** — *"a check that can answer `unusable` before the signature is verified lets a peer
     choose the softer outcome."* Putting the cheap check first is the obvious thing to do. Someone
     will try it again, so this is a guard rail that happens to be phrased in past tense. Rewrite it
     forward: *"the order is decode → signature → signer → what the proof is about, and it is a
     security property, because…"*
   - ❌ **Drop** — *"this comment used to say the columns did not exist. They do now."* Nobody was
     ever going to re-derive that. Pure diary; git has it.

   The memoir framing is also what makes these read as a rap sheet to an outsider, which is the other
   half of what this sweep exists to fix. Forward-looking prose costs the same lines and reads as
   rigour.
4. **Commit per item**, with the file and the category in the message.
5. If an item turns out to be a real, live, untracked gap, **file it as a DoD line and stop** — do
   not fix it in the same pass. Whether it gets fixed before launch is Andre's call, not the
   sweeper's.

**Do not "tidy" the codebase's comment style while you are in here.** The density is intentional.
The job is the categories of sentence above, nothing else.

> ### ⚠️ EVERY LINE NUMBER BELOW IS STALE — find items by their QUOTED TEXT
>
> 036/037-GODFILE split `session-node-manager.ts` from 19,878 lines into fourteen files, so a
> `session-node-manager.ts:9760` in this document may now be a different file entirely. The quoted
> sentences are stable and the file names mostly are not. Where an item has moved, the current homes
> are: authorship → `authorship-verification.ts`, refusals/quarantine/ordering → `inbound-refusals.ts`,
> contacts/settings/transcript → `session-records.ts`, park → `park-recovery.ts`, salt →
> `session-salts.ts`, schema → `session-schema.ts`, SQL → `session-queries.ts`, notices →
> `refusal-notices.ts`, ephemeral keys → `session-ephemerals.ts`, liveness → `session-liveness.ts`,
> witness alerts → `witness-alerts.ts`, held content → `held-content.ts`, genesis/certified leaves →
> `session-leaf-records.ts`, standing receiver → `standing-receivers.ts`.

> ### ⏭️ OWED, and recorded here so it is not lost: the modules `036-GODFILE` extracts
>
> `036-GODFILE`'s Part 0a swept `session-node-manager.ts` **under the OLD rule 3**, which said to keep
> the record of what a comment used to say — so it may have ADDED history lines. The rest of that order
> is pure movement and carries every comment verbatim into new sibling modules, which is correct for a
> refactor (a part that also edited comments would stop being reviewable as a move) and means **those
> new files come out of the campaign never having been read under the revised rule.**
>
> **Cosmetic bloat, not a disclosure risk** — the stale and untracked items in that file were already
> handled. A pass over the extracted modules is owed **after 036 closes**, and is worth doing only if
> someone is in those files anyway. Do not open it as its own unit.

## What was searched

`core/**/*.ts` in `cello-client`, excluding `__tests__`, `*.test.ts` and `dist/`, for: `TODO`,
`FIXME`, `XXX`, `HACK`, `OWED:`, *fails open* / *fail-open*, *is not enforced* / *not yet enforced* /
*enforced nowhere*, *nothing checks|verifies|enforces|stops|prevents*, *nobody checks*, *does not
authenticate*, *cannot be verified*, *is not checked* / *never checked*, *not done|built|wired|
closed|implemented here|yet*, *does not exist yet*, *a later|future unit*, *left open* / *remains
open*, *still missing|absent|unfixed*, *THE BOUND*, *only bounds*, *does not eliminate*.

**`TODO`/`FIXME`/`HACK` returned effectively nothing — two hits, one a false positive on `U+XXXX`.**
This codebase does not defer work in markers; it defers it in prose. That is why the search had to
be phrase-based, and it is why a future sweep must be too.

---

# B — STALE: advertises a hole that is already closed

**Highest priority. These are the ones that cost you something for nothing.**

### B1 · `core/daemon/src/session-node-manager.ts` — ✅ DONE 2026-09-06 (036-GODFILE Part 0a)

> *"Full tamper-evidence (EARS behavior #2) requires cross-checking against the K_local-signed
> content_hash leaf the sender submits to the RELAY on a separate channel; that relay hash-submit
> path is MSG-001's scope and **does not exist yet**. Until MSG-001 lands, a malicious sender that
> sends matching (content, hash) in one frame is not detected here."*

**Why it matters.** This is the single worst sentence in the public repo. It tells a reader that
sender-side tamper evidence is unbuilt, and names the exact bypass. **It is out of date.** The relay
hash-submit path exists (`relay-node.ts` `#processHashSubmit`), the client verifies the sender's own
signature over Structure 1 on every content frame (`#verifyAuthorshipClaim`), and a frame with no
checkable proof is refused (`authorship_proof_absent`).

**Action.** Rewrite to describe what this function does and does not establish *today*, and point at
the checks that now close it. **Under the revised rule 3, do NOT add a line recording that the gap
used to be real** — nobody re-derives that, and git has it. (An earlier version of this order said to
keep it; 036's Part 0a ran under that version, so this file may already carry such a line. Leave it —
removing it is not worth a second pass.)
**Verify first:** that `ingestReceivedContent`'s callers all hold a verified authorship proof.

### B4 · `core/daemon/src/session-node-manager.ts` — `sendContent`'s SCOPE block

**Found 2026-09-06 while verifying B1, and it is the same defect one method over.** `sendContent`'s
doc block still tells a public reader that the send path *"does NOT also submit a K_local-SIGNED
content_hash leaf to the RELAY … that relay hash-submit is MSG-001's scope"*, and that *"because
there is no relay yet"* the sequence number is a local leaf index rather than a relay-assigned one.

**The relay hash-submit path exists** — the same fact that made B1 stale — so the first half is out
of date and the second half's premise is false on its face.

⚠️ **VERIFY THE TWO HALVES SEPARATELY.** B1's lesson is that one stale paragraph can have halves
that went stale at different times: the delivery claim and the ORDERING claim are different
questions, and the ordering one may still be partly true. Rewriting both on one verdict is how a
correction becomes a new false statement.

### B2 · `core/gateway/src/detect/sanitize.ts:8-12`

> *"The RE2 binding is a pending decision, so that step is **not wired here yet**."*

`linear-regex.ts` and `injection-patterns.ts` exist and `initLinearRegex` is called from
`bin/cello-gateway.ts`, so the binding decision was made. **Verify** whether
`scanInjectionPatterns` is actually reached from `screen/inbound.ts` — if it is, the comment is
fully stale; if it is not, the comment is *right about the pipeline and wrong about the reason*, and
should say so.

### B3 · `core/daemon/src/session-ceremony.ts:798`

> *"'single' (pre-DKG) — verify vs the directory node key from the manifest. **Not wired yet.**"*

Reads as an unfinished verification path. In fact a single-key assignment is now **refused by name**
as a downgrade (`assignment-verify.ts`, `assignment_signature_type_downgraded`), so this branch is
not unfinished work — it is a shape that should never arrive. **Verify**, then say that instead.

---

# D — LIVE and UNTRACKED: these are disclosures

**Each of these describes something genuinely open, and none of them has a designation.** The action
is the same for all: confirm, file, then let Andre rank. Do not fix in the sweep.

### D1 · `core/daemon/src/session-ceremony.ts:849-856` — a seal you cannot verify locally

> *"The missing half is the INITIATOR-records-RESPONDER direction: an initiator never learns the
> responder's primary, so when the responder closes first, the initiator cannot verify locally and
> accepts with reason `signer_key_not_held`. Making the directory hand EACH party the other's
> primary … is F2-b — a **cross-repo protocol addition, not done here**."*

**What it means from the user's chair.** Whether you can independently verify your own sealed
receipt depends on *who happened to close first*. If your counterparty closed first, you accept the
certificate on the strength of the connection it arrived over rather than on a signature you
checked. Nothing is wrong with the receipt; you simply cannot prove it yourself.

`F2-b` is named in the comment and appears to exist nowhere else. **This is the most substantive
item on the list.**

### D2 · `core/daemon/src/relay-only.ts:132-137` — relay-only proves less than its name says

> *"⚠️ RESIDUAL … this proves the address CLAIMS a circuit hop, not that the circuit runs through a
> relay we chose. A peer could name a relay we hold no reservation with. Binding the embedded relay
> peer id to our own reservations is the stronger check and is **NOT done here**."*

An operator who turns relay-only on is buying "my address never leaks." The check is a string match
for `p2p-circuit` in the multiaddr. **A setting that does less than its name promises is the kind of
thing that ends up quoted.**

### D3 · `core/daemon/src/trust-signal-store.ts:766-780` — two residuals, both stated as deferred

> *"Note the residual, because it is **NOT closed here**: the directory's JOIN … is case-sensitive
> too, so an uppercase-hex subject that ever got minted would still be invisible THERE."*
>
> *"ACCOUNT-subject rows are deliberately NOT scoped here, and that half is **deferred, not done**.
> … every agent on the daemon may present them. It becomes wrong only when one daemon holds agents
> of two different accounts."*

The second has a stated trigger condition and is therefore a good candidate for *Explicitly Beyond*
rather than the gate. The first spans the portal, the daemon and the directory.

### D4 · `core/daemon/src/agent-id-migration.ts:243-250` — an ordering guarded only by a sentence

> *"`daemon.ts` builds the queue roughly 1,400 lines after it calls `initialize()`, and **nothing
> enforces that distance but a comment saying not to reorder**."*

A silent data-loss condition held off by prose in a file this list has already established is
19,878 lines long and growing. The comment does the right thing (it lists the columns anyway, so the
loss becomes no-loss), but the ordering itself is unguarded. Cheap to close with an assertion at
construction time.

### D5 · `core/daemon/src/session-relay-client.ts:336-342` — one witness is not corroboration

> *"Corroboration would need several relays reporting the same hash sequence, which **does not exist
> yet**."*

Check against `DOD-M15-CORROBORATE-1`, which is referenced in the relay's own comments. If that line
covers this, it belongs in **C**, not here.

---

# C — LIVE and TRACKED: name the designation, change nothing else

These are honest and they are on a list. The only defect is that a reader cannot tell. Add the
designation to the comment so the next agent stops rather than re-filing it.

| Item | Where | Tracked as |
|---|---|---|
| C1 | `directory-bootstrap.ts:23-41` — *"It fails open and quietly"* (step 6 disabled when the URL is not a bundled endpoint byte-for-byte) | `DOD-M15-STEP6-REPLAY-1` (open half) + `DOD-M15-BOOTSTRAP-TLS-1` |
| C2 | `session-node-manager.ts` — the freeze columns exist and **have no writer** | `DOD-M15-FREEZE-STATUS-1` — ✅ NO ACTION NEEDED, verified 2026-09-06: both comments already name it |

---

# E — Attack recipes: keep the finding, cut the method

These describe **fixed** defects, so they are not disclosures. They are procedures.

### E1 · `core/daemon/src/assignment-verify.ts:62-78`

> *"a hostile directory disabled every check below by omitting one field: it put its own
> freshly-minted key in `directory_pubkey`, signed a TBS naming an impostor as the counterparty, and
> the single-key branch verified that signature against that same key and returned ok."*

That is a working method against any implementation that makes the same mistake — including a
reimplementation of this protocol by someone else. The *lesson* (load the registration before
branching on an unsigned field) is what must survive; the four-step procedure does not have to.

**Judgement call, and it is Andre's:** the recipe is also what makes the comment convincing to an
engineer reading the repo to decide whether to trust it. Do not strip these unilaterally. Bring the
list; he rules.

### E2 — the same shape, lower severity

- `session-node-manager.ts:16041-16071` — how a rogue quorum substitutes a counterparty key
- `relay-node.ts` (server repo, not public — no action) — the presence-oracle write-up
- `refusal-reasons.ts:160-178` — how a new refusal code slips past every test

---

# A — Deliberate, bounded, and explained: LEAVE ALONE

Listed so a future sweep does not re-litigate them. Each already carries the bound that makes it
sound. **Touching these makes the repo worse.**

| Where | The fail-open, and why it is right |
|---|---|
| `daemon.ts:2000` | An unknown agent rings rather than being silently muted |
| `close-session-handler.ts:562` | Named as *"the one place in the milestone where that is right"* |
| `document-profile.ts:95-104` | An absent profile enforces nothing; the screening denylist is the floor underneath |
| `protocol-types/structure1.ts:173` | Session-id width deliberately not checked here — checked where it binds |
| `crypto/preauth-capability.ts:11` | Single-use is not enforceable in a signature; enforced downstream at the nonce binder |
| `session-node-manager.ts:4114-4122` | A fail-open default inside a fail-closed gate, unreachable today, guarded defensively |
| `session-node-manager.ts:16210-16240` | The one soft acknowledgement branch, with the full argument for why an attacker gains nothing |
| `session-node-manager.ts:17877` | *"A REAL SHORTFALL AGAINST THE DoD"* — a lost relay circuit is not restored in place. States what the agent does buy (availability), and the ratchet that stops decay |
| `gateway/server.ts:95` | A routing note, not a gap |

## The stated trust bounds — a category of their own

These four are honest statements of the protocol's designed-for limits. They are **not** defects and
must not be softened. They are listed because they will be quoted, and the answer to each should be
ready rather than improvised.

| Where | The bound |
|---|---|
| `outbound-sessions.ts:480-486` | A **threshold** of an agent's own directories, colluding, could sign an assignment naming the wrong counterparty. Caught downstream by the wrong-signer check |
| `assignment-verify.ts:170-180` | On **first contact** the inbound assignment is checked for internal consistency only — *"that does NOT authenticate the directory, and it is not claimed to"* |
| `session-node-manager.ts:7595` | The TOFU pin *"is worth nothing on FIRST contact"* |
| `session-node-manager.ts:16194` | *"a peer can decline to bind by never acknowledging anything"* — it costs them their ratification, it does not falsify ours |

Cross-reference: these are the same rows as the `⊘` list in [[session-correctness-checks]].

---

## Related Documents

- [[session-correctness-checks]] — the full premise map; the `⊘` list there and the bounds table here
  are the same facts from two directions
- [[M15-DEFINITION-OF-DONE]] — `DOD-M15-COMMENT-DISCLOSURE-1` is this document's gate line
- [[launch-plan]] — the public-perception half of this sits under Gate 2
